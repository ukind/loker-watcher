/**
 * Persistence state management (FRD #6, #8, #9, D8).
 *
 * Persists seen Threads post IDs in state/seen-posts.json to deduplicate
 * future runs. Guarantees atomic writes via sibling temp-file + rename.
 * Gated by match count: disk write is strictly skipped when 0 new matches
 * occur, keeping the state file byte-identical on no-match runs (FRD #9, D8).
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_PATH } from "./config.js";
import type { Post } from "./types.js";

/**
 * Persistence state schema for loker-watcher (FRD #6, D8).
 * Carries version: 1 for forward schema migrations.
 */
export interface AppState {
  version: number;
  seenPostIds: string[];
}

/** Result of a saveState operation indicating if disk was modified. */
export interface SaveStateResult {
  saved: boolean;
  state: AppState;
  addedCount: number;
}

export const CURRENT_STATE_VERSION = 1;

/** Return a fresh empty initial state object. */
export function createInitialState(): AppState {
  return {
    version: CURRENT_STATE_VERSION,
    seenPostIds: [],
  };
}

/**
 * Validate and migrate raw parsed JSON to the current AppState schema.
 * Throws when data is corrupted or cannot be safely migrated.
 */
export function migrateState(raw: unknown): AppState {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("state: invalid state format, expected an object");
  }

  const record = raw as Record<string, unknown>;
  const version = record["version"];

  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new Error(
      `state: invalid or missing schema version: ${String(version)}`,
    );
  }

  if (version === 1) {
    const rawIds = record["seenPostIds"];
    if (!Array.isArray(rawIds)) {
      throw new Error("state: seenPostIds must be an array");
    }

    const seenPostIds: string[] = [];
    for (const item of rawIds) {
      if (typeof item === "string" && item.length > 0) {
        seenPostIds.push(item);
      } else if (typeof item === "number" && Number.isSafeInteger(item)) {
        seenPostIds.push(String(item));
      } else {
        throw new Error(
          `state: invalid post ID in seenPostIds: ${String(item)}`,
        );
      }
    }

    return {
      version: 1,
      seenPostIds,
    };
  }

  throw new Error(`state: unsupported schema version: ${version}`);
}

/**
 * Load the state file from disk.
 * Returns initial empty state when the file does not exist (ENOENT).
 * Throws when the file cannot be read or contains invalid JSON/schema.
 */
export async function loadState(
  filePath: string = STATE_PATH,
): Promise<AppState> {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    return migrateState(parsed);
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
    throw new Error(
      `state: failed to load state from ${filePath}: ${message}`,
    );
  }
}

/**
 * Filter posts, returning only those not yet present in state.seenPostIds.
 * Maintains input order.
 */
export function diffNew(state: AppState, posts: readonly Post[]): Post[] {
  if (posts.length === 0) return [];
  const seenSet = new Set(state.seenPostIds);
  return posts.filter((post) => !seenSet.has(post.id));
}

/**
 * Filter an array of post IDs, returning only those not yet in state.seenPostIds.
 * Maintains input order and dedupes new IDs.
 */
export function diffNewIds(
  state: AppState,
  ids: readonly string[],
): string[] {
  if (ids.length === 0) return [];
  const seenSet = new Set(state.seenPostIds);
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
 * Write state to disk atomically using a sibling temporary file and rename.
 * Guarantees that a crash or error during write leaves the target file
 * byte-identical (FRD #9, D8).
 */
export async function writeStateAtomic(
  state: AppState,
  filePath: string = STATE_PATH,
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempPath = join(
    dir,
    `.\${Date.now()}.\${Math.random().toString(36).slice(2)}.tmp`,
  );
  const jsonContent = JSON.stringify(state, null, 2) + "\n";

  try {
    await writeFile(tempPath, jsonContent, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup of temp file
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `state: atomic write failed for ${filePath}: ${message}`,
    );
  }
}

/**
 * Save new post IDs to the state file (FRD #6, #9, D8).
 *
 * GATED: Only writes to disk when newIds contains at least 1 new unseen ID.
 * If newIds is empty or all IDs are already seen, NO disk write occurs.
 * Returns SaveStateResult indicating whether a write took place and the updated state.
 */
export async function saveState(
  currentState: AppState,
  newIds: readonly string[],
  filePath: string = STATE_PATH,
): Promise<SaveStateResult> {
  const freshIds = diffNewIds(currentState, newIds);

  if (freshIds.length === 0) {
    return {
      saved: false,
      state: currentState,
      addedCount: 0,
    };
  }

  const nextState: AppState = {
    version: currentState.version,
    seenPostIds: [...currentState.seenPostIds, ...freshIds],
  };

  await writeStateAtomic(nextState, filePath);

  return {
    saved: true,
    state: nextState,
    addedCount: freshIds.length,
  };
}
