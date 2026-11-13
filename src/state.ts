/**
 * Persistence state management (FRD #6, #8, #9, D6, D7, D8).
 *
 * Persists seen Threads post ids in state/seen-posts.json to deduplicate
 * future runs. Schema v2 (D6/D7): seenPostIds maps every post id to the ISO
 * instant it was first seen, so zero-match runs can persist judged ids and
 * prune-on-load keeps the map bounded. v1 files (a bare id array) migrate on
 * load with every firstSeenAt stamped at the migration moment. Guarantees
 * atomic writes via sibling temp-file + rename. Gated by NEW ids: the disk
 * write is strictly skipped when there is nothing unseen to add, keeping the
 * state file byte-identical on those runs (FRD #9, D8).
 */
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_PATH } from "./config.js";
import type { Post } from "./types.js";

/**
 * Persistence state schema for loker-watcher (FRD #6, D6-D8).
 * version 2: seenPostIds maps a post id to the ISO instant it was first
 * seen. Carries version for forward schema migrations.
 */
export interface AppState {
  version: number;
  seenPostIds: Record<string, string>;
}

/** Result of a saveState operation indicating if disk was modified. */
export interface SaveStateResult {
  saved: boolean;
  state: AppState;
  addedCount: number;
}

export const CURRENT_STATE_VERSION = 2;

/** Return a fresh empty initial state object. */
function createInitialState(): AppState {
  return {
    version: CURRENT_STATE_VERSION,
    seenPostIds: {},
  };
}

/** ISO instant for one epoch-millisecond reading. */
function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Validate and migrate raw parsed JSON to the current AppState schema.
 * v1 (an id array) migrates to a v2 map with every firstSeenAt stamped at
 * the injected migration moment; a valid v2 map round-trips unchanged.
 * Throws when data is corrupted or cannot be safely migrated — every
 * message names the fault.
 */
export function migrateState(raw: unknown, nowMs: number): AppState {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("state: invalid state format, expected an object");
  }

  const record = raw as Record<string, unknown>;
  const version = record.version;

  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error(`state: invalid or missing schema version: ${String(version)}`);
  }

  if (version === 1) {
    const rawIds = record.seenPostIds;
    if (!Array.isArray(rawIds)) {
      throw new Error("state: seenPostIds must be an array");
    }

    const seenPostIds: Record<string, string> = {};
    const firstSeenAt = toIso(nowMs);
    for (const item of rawIds) {
      let id: string;
      if (typeof item === "string" && item.length > 0) {
        id = item;
      } else if (typeof item === "number" && Number.isSafeInteger(item)) {
        id = String(item);
      } else {
        throw new Error(`state: invalid post ID in seenPostIds: ${String(item)}`);
      }
      seenPostIds[id] = firstSeenAt;
    }
    return { version: CURRENT_STATE_VERSION, seenPostIds };
  }

  if (version === 2) {
    const rawMap = record.seenPostIds;
    if (rawMap === null || typeof rawMap !== "object" || Array.isArray(rawMap)) {
      throw new Error("state: seenPostIds must be an object");
    }
    const seenPostIds: Record<string, string> = {};
    for (const [id, value] of Object.entries(rawMap)) {
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new Error(`state: invalid seenPostIds entry for post ID "${id}"`);
      }
      seenPostIds[id] = value;
    }
    return { version: CURRENT_STATE_VERSION, seenPostIds };
  }

  throw new Error(`state: unsupported schema version: ${version}`);
}

/**
 * Drop seen entries strictly older than the recency window (D6): an entry
 * survives when its firstSeenAt is at or after now - recencyHours. An
 * undefined, non-finite, or non-positive window keeps everything — a caller
 * without a window never loses data to pruning.
 */
export function pruneState(
  state: AppState,
  recencyHours: number | undefined,
  nowMs: number,
): AppState {
  if (recencyHours === undefined || !Number.isFinite(recencyHours) || recencyHours <= 0) {
    return state;
  }
  const cutoff = nowMs - recencyHours * 3_600_000;
  const seenPostIds: Record<string, string> = {};
  for (const [id, firstSeenAt] of Object.entries(state.seenPostIds)) {
    const seenAtMs = Date.parse(firstSeenAt);
    if (Number.isFinite(seenAtMs) && seenAtMs >= cutoff) {
      seenPostIds[id] = firstSeenAt;
    }
  }
  return { version: state.version, seenPostIds };
}

/**
 * Load the state file from disk, then migrate and prune (D6/D7).
 * Returns the empty v2 state when the file does not exist (ENOENT).
 * Throws when the file cannot be read or contains invalid JSON/schema.
 */
export async function loadState(
  filePath: string = STATE_PATH,
  recencyHours?: number,
  nowMs: number = Date.now(),
): Promise<AppState> {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    return pruneState(migrateState(parsed, nowMs), recencyHours, nowMs);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return createInitialState();
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`state: failed to load state from ${filePath}: ${message}`);
  }
}

/**
 * Read the full-history seen-id set for the PC walk's seen-stop (design
 * 2026-11-13): every key of seenPostIds, unpruned — a pruned id is
 * recency-ineligible hosted-side anyway, so the stop fires earliest with
 * no clock dependency. Degrade-everything (the loadAccountCeilings
 * posture, src/judge-ceilings.ts:93-121): an absent, unreadable, or
 * malformed file warns exactly once and yields an empty set — a broken
 * seen file must never fail a fetch tick, it only costs the stop.
 *
 * The stat pre-probe exists because loadState swallows ENOENT internally
 * (its empty-state return): the absent file is worth its own warn line in
 * the PC clone, where seen-posts.json is committed data and its absence
 * means the clone predates the bot's first commit-back.
 */
export async function readSeenIdSet(filePath: string = STATE_PATH): Promise<ReadonlySet<string>> {
  try {
    await stat(filePath);
  } catch (error) {
    const isEnoent =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT";
    const message = error instanceof Error ? error.message : String(error);
    if (isEnoent) {
      console.warn(`state: ${filePath} absent — seen-stop set is empty (every mint counts fresh)`);
    } else {
      console.warn(`state: ${filePath} unreadable (${message}) — seen-stop set is empty`);
    }
    return new Set();
  }
  try {
    const state = await loadState(filePath);
    return new Set(Object.keys(state.seenPostIds));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`state: ${filePath} malformed — seen-stop set is empty (${message})`);
    return new Set();
  }
}

/**
 * Filter posts, returning only those not yet present in state.seenPostIds.
 * Maintains input order.
 */
export function diffNew(state: AppState, posts: readonly Post[]): Post[] {
  if (posts.length === 0) return [];
  const seenSet = new Set(Object.keys(state.seenPostIds));
  return posts.filter((post) => !seenSet.has(post.id));
}

/**
 * Filter an array of post IDs, returning only those not yet in state.seenPostIds.
 * Maintains input order and dedupes new IDs.
 */
export function diffNewIds(state: AppState, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const seenSet = new Set(Object.keys(state.seenPostIds));
  const result: string[] = [];
  const added = new Set<string>();
  for (const id of ids) {
    if (!seenSet.has(id) && !added.has(id)) {
      result.push(id);
      added.add(id);
    }
  }
  return result;
}

/**
 * Mint a distinct sibling temp path inside the given dir (never os.tmpdir):
 * dot + injected ms + random + .tmp. Two calls with the same clock still
 * differ — the 20478d1 bug shipped ONE literal temp name shared by every
 * write, so a crashed write could leave a name the next write then clobbered.
 */
export function stateTempPath(dir: string, nowMs: number = Date.now()): string {
  const random = Math.random().toString(36).slice(2) || "0";
  return join(dir, `.${nowMs}.${random}.tmp`);
}

/**
 * Write state to disk atomically using a sibling temporary file and rename.
 * Guarantees that a crash or error during write leaves the target file
 * byte-identical (FRD #9, D8). The temp name comes only from stateTempPath —
 * a distinct sibling per write — and every failure path (directory creation,
 * content write, rename) cleans the temp file up and rejects naming the
 * target.
 */
export async function writeStateAtomic(
  state: AppState,
  filePath: string = STATE_PATH,
  nowMs: number = Date.now(),
): Promise<void> {
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, nowMs);
  const jsonContent = `${JSON.stringify(state, null, 2)}\n`;

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, jsonContent, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup of temp file
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`state: atomic write failed for ${filePath}: ${message}`);
  }
}

/**
 * Save new post IDs to the state file (FRD #6, #9, D6-D8).
 *
 * Fresh ids are stamped with the injected clock (firstSeenAt) and merged
 * into the v2 map. GATED: writes to disk only when newIds contains at least
 * one unseen id; an empty or all-seen list performs NO disk write. Returns
 * SaveStateResult indicating whether a write took place and the updated state.
 */
export async function saveState(
  currentState: AppState,
  newIds: readonly string[],
  filePath: string = STATE_PATH,
  nowMs: number = Date.now(),
): Promise<SaveStateResult> {
  const freshIds = diffNewIds(currentState, newIds);

  if (freshIds.length === 0) {
    return {
      saved: false,
      state: currentState,
      addedCount: 0,
    };
  }

  const seenPostIds: Record<string, string> = { ...currentState.seenPostIds };
  const firstSeenAt = toIso(nowMs);
  for (const id of freshIds) {
    seenPostIds[id] = firstSeenAt;
  }
  const nextState: AppState = { version: CURRENT_STATE_VERSION, seenPostIds };

  await writeStateAtomic(nextState, filePath, nowMs);

  return {
    saved: true,
    state: nextState,
    addedCount: freshIds.length,
  };
}
