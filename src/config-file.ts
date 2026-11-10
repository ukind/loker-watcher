/**
 * watcher.config.json — the source of truth for what the watcher watches.
 *
 * The operator edits this one committed file to add a keyword, a candidate
 * term, a tag, a profile page or a search URL. No code change and no Actions
 * variable is involved. A missing or malformed file fails the run loudly: a
 * silent fallback to built-in defaults would let a typo keep watching the
 * wrong thing, which is the failure mode this module exists to remove.
 */
import { readFile } from "node:fs/promises";
import { CONFIG_PATH } from "./config.js";

/** One surface to sample. `tag` builds the tag-page URL; `url` is verbatim;
 * `linkedin` stays a valid config value whose raw keyword string the PC
 * fetch leg consumes directly (it never resolves to a URL here). */
export type Surface =
  | { type: "tag"; value: string }
  | { type: "url"; value: string }
  | { type: "linkedin"; value: string };

/** A surface resolved to the URL Playwright loads, plus its log label. */
export interface ResolvedSurface {
  /** Always "threads": LinkedIn rides the PC fetch leg and never resolves here. */
  platform: "threads";
  /** Log label: `tag/hiring`, or the full URL for a `url` surface. */
  label: string;
  /** Absolute URL to load. */
  url: string;
  /** The raw surface type (email-per-surface stamp, design D2): results
   *  carry their own identity past any list compaction downstream. */
  type: "tag" | "url";
  /** The raw surface value exactly as configured. */
  value: string;
}

/** Reasoning effort level for the LLM judge's chat-completions calls. */
export type ReasoningEffort = "low" | "medium" | "high";

/** Per-platform switches for the two acquisition legs. */
export interface PlatformFlags {
  /** Fetch + judge the PC leg pushed LinkedIn payload. */
  linkedin: boolean;
  /** Walk the Threads surfaces. */
  threads: boolean;
}

/** Shape of watcher.config.json. */
export interface WatcherConfig {
  keywords: string[];
  candidateTerms: string[];
  /** Terms that veto a post the judge would otherwise accept. Absent -> []. */
  negativeKeywords: string[];
  surfaces: Surface[];
  platforms: PlatformFlags;
  recencyHours: number;
  reasoningEffort: ReasoningEffort;
  scrollRounds: number;
}

const ALLOWED_KEYS = [
  "keywords",
  "candidateTerms",
  "negativeKeywords",
  "surfaces",
  "platforms",
  "recencyHours",
  "reasoningEffort",
  "scrollRounds",
] as const;

const THREADS_HOST = "www.threads.com";

/**
 * FR-8 (design 2026-11-09): exactly 5 linkedin surfaces — the PC leg's
 * account-safety arithmetic (worst-case wake-ups x surfaces x one page vs
 * the daily GET budget) assumes the fleet stays at five. The count is the
 * invariant, not the keywords: an operator may swap a surface's value,
 * never grow the fleet.
 */
const LINKEDIN_SURFACE_COUNT = 5;

/**
 * Read and validate the config file. Throws with the path and the offending
 * key when the file is missing, unparsable, or fails any rule below.
 */
export async function loadWatcherConfig(filePath: string = CONFIG_PATH): Promise<WatcherConfig> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "unknown";
    throw new Error(
      `config: cannot read ${filePath} (${code}) — this file is the source of truth for surfaces, keywords, candidate terms and the recency window`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`config: ${filePath} is not valid JSON: ${message}`);
  }

  return validateConfig(parsed, filePath);
}

function validateConfig(parsed: unknown, filePath: string): WatcherConfig {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`config: ${filePath} must contain a JSON object`);
  }
  const record = parsed as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `config: ${filePath} has unknown key "${key}" — allowed keys: ${ALLOWED_KEYS.join(", ")}`,
      );
    }
  }

  const keywords = readStringArray(record.keywords, "keywords", filePath, true);
  const candidateTerms = readStringArray(record.candidateTerms, "candidateTerms", filePath, false);
  const negativeKeywords = readNegativeKeywords(record.negativeKeywords, filePath);
  const surfaces = readSurfaces(record.surfaces, filePath);
  const platforms = readPlatforms(record.platforms, filePath);
  const recencyHours = readRecencyHours(record.recencyHours, filePath);
  const reasoningEffort = readReasoningEffort(record.reasoningEffort, filePath);
  const scrollRounds = readScrollRounds(record.scrollRounds, filePath);

  return {
    keywords,
    candidateTerms,
    negativeKeywords,
    surfaces,
    platforms,
    recencyHours,
    reasoningEffort,
    scrollRounds,
  };
}

function readStringArray(
  value: unknown,
  key: string,
  filePath: string,
  requireNonEmpty: boolean,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`config: ${filePath} "${key}" must be an array`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`config: ${filePath} "${key}" must contain only non-empty strings`);
    }
    out.push(item);
  }
  if (requireNonEmpty && out.length === 0) {
    throw new Error(`config: ${filePath} "${key}" must not be empty`);
  }
  return out;
}

function readSurfaces(value: unknown, filePath: string): Surface[] {
  if (!Array.isArray(value)) {
    throw new Error(`config: ${filePath} "surfaces" must be an array`);
  }
  if (value.length === 0) {
    throw new Error(`config: ${filePath} "surfaces" must not be empty`);
  }
  const out: Surface[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(
        `config: ${filePath} "surfaces" entries must be objects with a "type" and a "value"`,
      );
    }
    const entry = item as Record<string, unknown>;
    const type = entry.type;
    const surfaceValue = entry.value;
    if (type !== "tag" && type !== "url" && type !== "linkedin") {
      throw new Error(
        `config: ${filePath} surface "type" must be "tag", "url", or "linkedin", got ${JSON.stringify(type)}`,
      );
    }
    if (typeof surfaceValue !== "string" || surfaceValue.trim().length === 0) {
      throw new Error(`config: ${filePath} surface "value" must be a non-empty string`);
    }
    if (type === "url") {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(surfaceValue);
      } catch {
        throw new Error(
          `config: ${filePath} surface "value" is not an absolute URL: ${surfaceValue}`,
        );
      }
      if (parsedUrl.protocol !== "https:" || parsedUrl.host !== THREADS_HOST) {
        throw new Error(
          `config: ${filePath} surface URL must be https://${THREADS_HOST}/... — got ${surfaceValue}`,
        );
      }
    }
    out.push({ type, value: surfaceValue });
  }
  const linkedinCount = out.filter((surface) => surface.type === "linkedin").length;
  if (linkedinCount !== LINKEDIN_SURFACE_COUNT) {
    throw new Error(
      `config: ${filePath} has ${linkedinCount} linkedin surfaces — exactly ${LINKEDIN_SURFACE_COUNT} are required (the PC leg's daily GET budget assumes it); keep the five-surface spread`,
    );
  }
  warnDuplicateSurfaces(out, filePath);
  return out;
}

/**
 * Duplicate configured surfaces (design D7): two identical entries produce
 * one group key downstream, hence one email. The load stays valid — the
 * warn names the duplicate so the operator can clean the config.
 */
function warnDuplicateSurfaces(surfaces: readonly Surface[], filePath: string): void {
  const seen = new Set<string>();
  const warned = new Set<string>();
  for (const surface of surfaces) {
    const key = `${surface.type}|${surface.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    if (warned.has(key)) continue;
    warned.add(key);
    console.warn(
      `config: ${filePath} duplicate surface ${surface.type} "${surface.value}" — watched once; delete the extra entry from "surfaces"`,
    );
  }
}

/**
 * Required per-platform switches: an absent block, a missing member, or a
 * non-boolean member each fail with the path and the key. Which platforms
 * run is an operator decision, so there is no default to fall back to.
 * Extra members inside the block are ignored (the readSurfaces precedent).
 */
function readPlatforms(value: unknown, filePath: string): PlatformFlags {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `config: ${filePath} "platforms" must be an object with "linkedin" and "threads" boolean members`,
    );
  }
  const record = value as Record<string, unknown>;
  const linkedin = record.linkedin;
  if (linkedin === undefined) {
    throw new Error(
      `config: ${filePath} "platforms.linkedin" is required — true watches the platform, false skips it`,
    );
  }
  if (typeof linkedin !== "boolean") {
    throw new Error(
      `config: ${filePath} "platforms.linkedin" must be a boolean, got ${JSON.stringify(linkedin)}`,
    );
  }
  const threads = record.threads;
  if (threads === undefined) {
    throw new Error(
      `config: ${filePath} "platforms.threads" is required — true watches the platform, false skips it`,
    );
  }
  if (typeof threads !== "boolean") {
    throw new Error(
      `config: ${filePath} "platforms.threads" must be a boolean, got ${JSON.stringify(threads)}`,
    );
  }
  return { linkedin, threads };
}

function readRecencyHours(value: unknown, filePath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`config: ${filePath} "recencyHours" must be a positive number`);
  }
  return Math.floor(value);
}

function readReasoningEffort(value: unknown, filePath: string): ReasoningEffort {
  if (value === undefined) {
    return "medium";
  }
  if (typeof value !== "string") {
    throw new Error(
      `config: ${filePath} "reasoningEffort" must be one of "low", "medium", "high", got ${JSON.stringify(value)}`,
    );
  }
  const normalized = value.toLowerCase();
  if (normalized !== "low" && normalized !== "medium" && normalized !== "high") {
    throw new Error(
      `config: ${filePath} "reasoningEffort" must be one of "low", "medium", "high", got ${JSON.stringify(value)}`,
    );
  }
  return normalized;
}

/** Scroll-round bound for both walks; defaults to the Threads-measured 8. */
const DEFAULT_SCROLL_ROUNDS = 8;

/**
 * Optional scroll knob: absent -> the measured default, present but not a
 * whole number >= 1 -> fail with the path and key. Flooring a walk length
 * silently changes operator intent, so fractions are rejected, not floored.
 */
function readScrollRounds(value: unknown, filePath: string): number {
  if (value === undefined) {
    return DEFAULT_SCROLL_ROUNDS;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `config: ${filePath} "scrollRounds" must be an integer >= 1, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Optional negative-keyword veto list: absent -> [], present but not an
 * array of non-empty strings -> fail with the path and key. The judge
 * appends the veto sentence only when the list is non-empty, so [] and
 * absence are the same no-veto state.
 */
function readNegativeKeywords(value: unknown, filePath: string): string[] {
  if (value === undefined) {
    return [];
  }
  return readStringArray(value, "negativeKeywords", filePath, false);
}

/**
 * Resolve configured surfaces to the URLs Playwright loads. Only threads
 * surfaces resolve: linkedin entries stay valid config, but the PC fetch
 * leg (src/linkedin-fetch.ts) consumes their raw value, so the caller
 * partitions them out first — one reaching this function is a wiring bug
 * and fails visibly.
 */
export function resolveSurfaces(surfaces: readonly Surface[]): ResolvedSurface[] {
  return surfaces.map((surface): ResolvedSurface => {
    if (surface.type === "linkedin") {
      throw new Error(
        `linkedin surface "${surface.value}" reached resolveSurfaces — a wiring bug: partition linkedin surfaces out before resolving (the PC fetch leg takes their raw value)`,
      );
    }
    if (surface.type === "tag") {
      return {
        platform: "threads",
        label: `tag/${surface.value}`,
        url: tagPageUrlFor(surface.value),
        type: surface.type,
        value: surface.value,
      };
    }
    return {
      platform: "threads",
      label: surface.value,
      url: surface.value,
      type: surface.type,
      value: surface.value,
    };
  });
}

/** Tag-page URL. Kept local so src/config.ts no longer owns surface policy. */
function tagPageUrlFor(tag: string): string {
  return `https://www.threads.com/tag/${encodeURIComponent(tag)}`;
}
