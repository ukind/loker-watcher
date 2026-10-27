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

/** One surface to sample. `tag` builds the tag-page URL; `url` is verbatim. */
export type Surface = { type: "tag"; value: string } | { type: "url"; value: string };

/** A surface resolved to the URL Playwright loads, plus its log label. */
export interface ResolvedSurface {
  /** Log label: `tag/hiring`, or the full URL for a `url` surface. */
  label: string;
  /** Absolute URL to load. */
  url: string;
}

/** Reasoning effort level for the LLM judge's chat-completions calls. */
export type ReasoningEffort = "low" | "medium" | "high";

/** Shape of watcher.config.json. */
export interface WatcherConfig {
  keywords: string[];
  candidateTerms: string[];
  surfaces: Surface[];
  recencyHours: number;
  reasoningEffort: ReasoningEffort;
}

const ALLOWED_KEYS = [
  "keywords",
  "candidateTerms",
  "surfaces",
  "recencyHours",
  "reasoningEffort",
] as const;

const THREADS_HOST = "www.threads.com";

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
  const surfaces = readSurfaces(record.surfaces, filePath);
  const recencyHours = readRecencyHours(record.recencyHours, filePath);
  const reasoningEffort = readReasoningEffort(record.reasoningEffort, filePath);

  return { keywords, candidateTerms, surfaces, recencyHours, reasoningEffort };
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
    if (type !== "tag" && type !== "url") {
      throw new Error(
        `config: ${filePath} surface "type" must be "tag" or "url", got ${JSON.stringify(type)}`,
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
  return out;
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

/** Resolve configured surfaces to the URLs Playwright loads. */
export function resolveSurfaces(surfaces: readonly Surface[]): ResolvedSurface[] {
  return surfaces.map((surface) =>
    surface.type === "tag"
      ? { label: `tag/${surface.value}`, url: tagPageUrlFor(surface.value) }
      : { label: surface.value, url: surface.value },
  );
}

/** Tag-page URL. Kept local so src/config.ts no longer owns surface policy. */
function tagPageUrlFor(tag: string): string {
  return `https://www.threads.com/tag/${encodeURIComponent(tag)}`;
}
