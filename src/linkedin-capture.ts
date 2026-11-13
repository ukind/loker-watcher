/**
 * The LinkedIn raw-body capture sink (capture-first precondition, design
 * 2026-11-13): every intercepted flagship-web response body lands as ONE
 * atomic JSON file under captures/<UTC session stamp>/<padded ordinal>-<keyword-slug>.json
 * so scripts/replay-linkedin.ts can re-analyze the walk offline.
 *
 * Contract, in order:
 * - The sink WRITES; it never decides policy. A failed write rejects with
 *   the target named (the writePayloadAtomic shape) — the walk's
 *   captureOnce call owns the failure policy.
 * - captureOnce is the fire-and-forget seam the listener arms use: a sink
 *   rejection NEVER rejects the walk. The first failure per surface walk
 *   warns once (the handleLegDeadEpisode one-alarm-per-episode discipline,
 *   scaled down to a log line); later failures stay quiet.
 * - The session stamp mints LAZILY on the first capture, so a walk whose
 *   pages fire no bodies creates no directory at all.
 *
 * Testability: the sink is a plain injectable closure — the offline suite
 * passes a tmp root (mkdtemp) or a recording fake; production builds it
 * once per tick/probe from LINKEDIN_CAPTURES_ROOT (src/config.ts). A
 * sink-less walk captures nothing, so npm test never writes into the repo.
 *
 * exactOptionalPropertyTypes: the matched-only envelope fields (minted,
 * fresh) are OMITTED via conditional spread — never undefined-assigned
 * (the surfaces-stamp precedent, src/types.ts:28).
 */
import { mkdir, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LINKEDIN_CAPTURES_ROOT } from "./config.js";
import { stateTempPath } from "./state.js";

/** Envelope schema for one captured response body. Bumped on a shape change. */
export const CAPTURE_SCHEMA_VERSION = 1;

/**
 * Retention for the captures root (follow-up 2026-11-13): after each write
 * the sink prunes session-stamp directories beyond the newest N — at the
 * working-hours tick cadence (~24-28 walks per weekday, 2-6 MB per walk)
 * capture scratch would otherwise grow by roughly 1-3 GB/month on the PC
 * with no alarm when the disk fills (D4's own silent-void rationale).
 */
export const CAPTURE_KEEP_SESSIONS = 20;

/** Session-stamp directory shape (sessionStamp's output). */
const SESSION_DIR_RE = /^\d{8}T\d{6}Z$/;

/**
 * The metadata envelope INSIDE each capture file: the walk's facts at the
 * moment the body landed. `url` is FULL — only the unmatched arm's LOG
 * LINE truncates to 80 chars (src/linkedin-fetch.ts), never the record.
 */
export interface CaptureRecord {
  /** Envelope version (CAPTURE_SCHEMA_VERSION), independent of PAYLOAD_VERSION. */
  schemaVersion: number;
  /** ISO instant of the capture (the injected walk clock). */
  capturedAt: string;
  /** The walk label, "linkedin/<keyword>" — the keyword is the slug material. */
  label: string;
  /** 1-based per-walk ordinal, incremented synchronously in the listener. */
  ordinal: number;
  /** Matched-body count at capture time (liveness context; matched arm only). */
  received: number;
  /** FULL response URL. */
  url: string;
  /** HTTP status (the walk captures 200 matched bodies; unmatched can be any). */
  status: number;
  /** LINKEDIN_RESPONSE_RE match — the mint arm (true) vs the diagnostic arm (false). */
  matched: boolean;
  /** The verbatim response body. */
  body: string;
  /** Matched arm only: posts the parser minted (conditional spread — omitted when unmatched). */
  minted?: number;
  /** Matched arm only: posts that were NEW after urn dedupe (conditional spread). */
  fresh?: number;
}

/**
 * The sink seam the walk receives. A sink MAY reject — captureOnce turns
 * that into the warn-once policy; it must never be awaited by the walk.
 */
export type CaptureSink = (record: CaptureRecord) => Promise<void>;

/**
 * Warn-once state for one surface walk: the page-local unit that owns the
 * listener. Created per walkLinkedInSurface invocation.
 */
export interface CaptureWarnState {
  warned: boolean;
}

/**
 * UTC session stamp for the captures directory: 2026-11-13T04:24:35.000Z
 * reads 20261113T042435Z — Windows-safe (no colon), sorts lexically.
 */
export function sessionStamp(now: () => number = Date.now): string {
  return new Date(now())
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Filename slug from a walk label's KEYWORD: the "linkedin/" prefix is
 * stripped first, then lowercase, non-alphanumeric runs fold to one hyphen,
 * trimmed, capped at 40 chars (re-trimmed), empty -> "surface". A keyword
 * like "#hiring indonesia" reads "hiring-indonesia"; a degenerate keyword
 * (pure emoji or CJK text sanitizes to nothing) reads "surface" — reachable
 * and collision-safe, because the padded ordinal keeps names unique within
 * the session stamp.
 */
export function surfaceSlug(label: string): string {
  const keyword = label.startsWith("linkedin/") ? label.slice("linkedin/".length) : label;
  const slug = keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "surface";
}

/**
 * The production sink: atomic whole-file writes (sibling temp via
 * stateTempPath + rename, the writePayloadAtomic shape) under
 * <root>/<session stamp>/<padded ordinal>-<slug>.json. The ordinal pads to
 * 3 digits so lexical order IS arrival order past 10 files. The session
 * stamp mints on the FIRST capture — a body-less walk creates no directory.
 * Retention (follow-up 2026-11-13): after every successful write the sink
 * prunes session-stamp directories beyond the newest CAPTURE_KEEP_SESSIONS
 * — best-effort; a failed prune never fails the capture that just landed.
 * A failed write cleans the temp file and rejects naming the target;
 * captureOnce owns the warn policy.
 */
export function makeFsCaptureSink(
  root: string = LINKEDIN_CAPTURES_ROOT,
  now: () => number = Date.now,
  // Testability (the best-effort-prune pin): inject a throwing readdir to
  // prove a failed prune never fails the capture that just landed — the
  // ESM namespace cannot be monkey-patched (non-configurable properties).
  readdirFn: (path: string) => Promise<string[]> = readdir,
): CaptureSink {
  let session: string | undefined;
  return async (record: CaptureRecord): Promise<void> => {
    session ??= sessionStamp(now);
    const dir = join(root, session);
    const target = join(
      dir,
      `${String(record.ordinal).padStart(3, "0")}-${surfaceSlug(record.label)}.json`,
    );
    const tempPath = stateTempPath(dir, now());
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      await rename(tempPath, target);
    } catch (error) {
      try {
        await unlink(tempPath);
      } catch {
        // Best-effort temp cleanup (the writePayloadAtomic arm)
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`capture: atomic write failed for ${target}: ${message}`);
    }
    // Retention (follow-up 2026-11-13): keep only the newest
    // CAPTURE_KEEP_SESSIONS session stamps. A failed prune NEVER fails the
    // capture — the write already landed (the best-effort temp-cleanup
    // idiom); the next successful prune cleans up.
    try {
      const stale = (await readdirFn(root))
        .filter((name) => SESSION_DIR_RE.test(name))
        .sort()
        .slice(0, -CAPTURE_KEEP_SESSIONS);
      for (const name of stale) {
        await rm(join(root, name), { recursive: true, force: true });
      }
    } catch {
      // best-effort: never converts a landed capture into a sink failure
    }
  };
}

/**
 * Fire-and-forget capture with the first-failure-warns-once policy: the
 * sink's rejection NEVER propagates (the listener arms' page-close-race
 * catches stay the only swallows in the walk). The first rejection warns
 * once naming the error; later rejections stay quiet — a persistently
 * broken sink must not spam every body, and a fully silent sink would void
 * the capture precondition invisibly (the replay would find nothing).
 */
export function captureOnce(
  sink: CaptureSink,
  record: CaptureRecord,
  state: CaptureWarnState,
): void {
  void sink(record).catch((error: unknown) => {
    if (state.warned) return;
    state.warned = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `linkedin-capture: sink failed (first this walk; further failures stay quiet) — ${message}`,
    );
  });
}
