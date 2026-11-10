/**
 * Payload hand-off between the PC fetch leg and the hosted watch run
 * (design D5/D9/D13): the PC loop writes fetched raw posts to
 * state/linkedin-posts.json (atomic temp+rename, the state.ts precedent)
 * and pushes that single path; the hosted run reads it here.
 *
 * Four failure classes, ALL degrading to threads-only runs (D13 — a
 * LinkedIn fault can never fail a run; the alarm duty for leg faults
 * lives where the fault originates, the PC leg):
 *
 * - absent (ENOENT): the PC-off / never-ran state is NORMAL — one quiet
 *   log line, leg "absent".
 * - stale (over PAYLOAD_MAX_AGE_MS): one log line naming the age, leg
 *   "stale".
 * - malformed envelope (invalid JSON, unknown version, posts not an
 *   array): one warn naming the reason, leg "malformed".
 * - malformed rows: dropped + counted, leg stays "ok".
 *
 * Every class stays operator-visible in run logs; nothing is silent.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Surface } from "./config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "./config.js";
import { stateTempPath } from "./state.js";
import type { Post } from "./types.js";

/** Envelope version; bump on a shape change, keep the reader tolerant.
 *  v2 (email-per-surface): rows may carry surfaces stamps. */
export const PAYLOAD_VERSION = 2;

/** Twice the 10-minute cadence: a payload older than this reads as stale. */
export const PAYLOAD_MAX_AGE_MS = 1_800_000;

/** What the PC loop writes: a self-describing, versioned post envelope. */
export interface PayloadEnvelope {
  version: number;
  writtenAt: string;
  posts: Post[];
}

/** LinkedIn leg state for the heartbeat/digest lines (D6/D13). */
type LegStatus = "ok" | "stale" | "absent" | "malformed";

/** The leg state minus the posts — rides HeartbeatStats and the digest. */
export interface LegLine {
  status: LegStatus;
  /** Age/reason detail for the log and email lines; absent-state omits it. */
  detail?: string;
}

/** What the watch-side reader returns: posts + the leg state (D6/D13). */
export interface PayloadRead {
  posts: Post[];
  /** The leg state; mirrors LegLine.status for the heartbeat/digest lines. */
  leg: LegStatus;
  /** Age/reason detail; omitted when none rides (exactOptionalPropertyTypes). */
  detail?: string;
}

const ACTIVITY_URN_RE = /^urn:li:activity:\d{9,}$/;

/** One surface stamp inside a payload row (email-per-surface). */
function isValidStamp(stamp: unknown): stamp is Surface {
  if (stamp === null || typeof stamp !== "object") return false;
  const entry = stamp as Record<string, unknown>;
  return (
    (entry.type === "tag" || entry.type === "url" || entry.type === "linkedin") &&
    typeof entry.value === "string" &&
    entry.value.length > 0
  );
}

/**
 * The stamp is optional on a v2 row (legacy-shaped rows stay valid) but a
 * PRESENT stamp must be a well-formed Surface[] — one malformed stamp fails
 * the whole row (drop + count, the module doctrine).
 */
function stampsAreValid(value: unknown): value is Surface[] {
  return value === undefined || (Array.isArray(value) && value.every(isValidStamp));
}

/** Per-row shape contract: a row that fails any check is dropped + counted. */
function isValidRow(value: unknown): value is Post {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.platform === "linkedin" &&
    typeof row.id === "string" &&
    ACTIVITY_URN_RE.test(row.id) &&
    typeof row.text === "string" &&
    row.text.length > 0 &&
    typeof row.author === "string" &&
    row.author.length > 0 &&
    typeof row.permalink === "string" &&
    row.permalink.length > 0 &&
    typeof row.timestamp === "string" &&
    !Number.isNaN(Date.parse(row.timestamp)) &&
    stampsAreValid(row.surfaces)
  );
}

/**
 * Write the payload atomically (sibling unique temp + rename, the
 * writeStateAtomic shape): a crashed tick never leaves a partial payload.
 */
export async function writePayloadAtomic(
  posts: readonly Post[],
  filePath: string = LINKEDIN_PAYLOAD_PATH,
  now: () => number = Date.now,
): Promise<void> {
  const envelope: PayloadEnvelope = {
    version: PAYLOAD_VERSION,
    writtenAt: new Date(now()).toISOString(),
    posts: [...posts],
  };
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, now());
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort temp cleanup
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`payload: atomic write failed for ${filePath}: ${message}`);
  }
}

/**
 * Read + validate the payload. Never throws (D13): every failure class
 * resolves to a threads-only PayloadRead with its leg state and log line.
 * `now` is injectable so the staleness boundary is testable.
 */
export async function readPayloadPosts(
  filePath: string = LINKEDIN_PAYLOAD_PATH,
  now: () => number = Date.now,
): Promise<PayloadRead> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT"
    ) {
      console.log("linkedin: no payload — threads-only run");
      return { posts: [], leg: "absent" };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`linkedin: payload unreadable — ${message} — threads-only run`);
    return { posts: [], leg: "malformed", detail: `unreadable: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`linkedin: payload not valid JSON — ${message} — threads-only run`);
    return { posts: [], leg: "malformed", detail: `not valid JSON: ${message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn("linkedin: payload is not a JSON object — threads-only run");
    return { posts: [], leg: "malformed", detail: "envelope is not an object" };
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== PAYLOAD_VERSION) {
    const detail = `unknown version ${String(envelope.version)} (expected ${PAYLOAD_VERSION})`;
    console.warn(`linkedin: payload ${detail} — threads-only run`);
    return { posts: [], leg: "malformed", detail };
  }

  const writtenAt = envelope.writtenAt;
  const writtenMs = typeof writtenAt === "string" ? Date.parse(writtenAt) : Number.NaN;
  const ageMs = now() - writtenMs;
  if (!Number.isFinite(writtenMs) || !Number.isFinite(ageMs) || ageMs > PAYLOAD_MAX_AGE_MS) {
    const age = Number.isFinite(ageMs)
      ? `${Math.max(0, Math.round(ageMs / 3_600_000))}h old`
      : "carries an unreadable writtenAt";
    console.log(`linkedin: payload stale (${age}) — threads-only run`);
    return { posts: [], leg: "stale", detail: `payload ${age}` };
  }

  if (!Array.isArray(envelope.posts)) {
    console.warn("linkedin: payload posts is not an array — threads-only run");
    return { posts: [], leg: "malformed", detail: "posts is not an array" };
  }
  const posts: Post[] = [];
  let dropped = 0;
  for (const row of envelope.posts) {
    if (isValidRow(row)) {
      posts.push(row);
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`linkedin: payload carried ${dropped} malformed row(s) — dropped`);
  }
  return {
    posts,
    leg: "ok",
    detail: `payload ${Math.max(0, Math.floor(ageMs / 60_000))} min old`,
  };
}
