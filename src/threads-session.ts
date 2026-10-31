/**
 * Session resolution for both watched platforms (Phase 8; extended for
 * LinkedIn).
 *
 * An authenticated walk replays a Playwright storageState document
 * exported from a real browser login. The document travels base64-encoded
 * in a session environment variable (a GitHub Actions secret): it is
 * account-equivalent, so it never enters the repo and never enters
 * state/seen-posts.json. The decoded document is written to an OS temp
 * file that Playwright loads as the browser context's storage state.
 *
 * The variable name is a parameter defaulting to the Threads var, so one
 * resolver serves THREADS_SESSION_STATE and LINKEDIN_SESSION_STATE. A null
 * return means "no usable session"; what happens next is the caller's
 * policy — Threads falls back to the logged-out walk, LinkedIn surfaces
 * are skipped with a warn (an anonymous LinkedIn page hits an authwall,
 * never a logged-out walk).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ENV_NAMES } from "./config.js";

/** Minimal shape check for a Playwright storageState document. */
export function isValidStorageState(doc: unknown): boolean {
  if (doc === null || typeof doc !== "object") return false;
  const cookies: unknown = (doc as { cookies?: unknown }).cookies;
  return Array.isArray(cookies) && cookies.length > 0;
}

/**
 * Decode the named base64 session secret and write it to a temp file.
 * Returns the file path, or null when the secret is unset or invalid.
 * Warn messages interpolate the variable name so an operator sees which
 * secret is bad.
 */
export async function resolveSession(
  env: Record<string, string | undefined> = process.env,
  envName: string = ENV_NAMES.threadsSession,
): Promise<string | null> {
  const raw: string | undefined = env[envName];
  if (raw === undefined || raw.trim() === "") return null;

  let doc: unknown;
  try {
    doc = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    console.warn(`session: ${envName} is not valid base64 JSON — continuing without it`);
    return null;
  }
  if (!isValidStorageState(doc)) {
    console.warn(`session: ${envName} carries no cookies — continuing without it`);
    return null;
  }

  const dir = await mkdtemp(join(tmpdir(), "loker-session-"));
  const filePath = join(dir, "storage-state.json");
  await writeFile(filePath, JSON.stringify(doc), "utf8");
  return filePath;
}

/**
 * Delete the OS temp dir behind a resolved session file path (F019).
 * Best-effort by contract — temp cleanup is one of the sanctioned
 * never-fails-the-run calls: a leaked temp dir must not turn a run whose
 * real work succeeded into a failed one. A missing dir is a silent no-op
 * (force ignores ENOENT: the logged-out path never made one, or the dir
 * is already gone); any other removal fault warns with the path and
 * resolves.
 */
export async function cleanupSessionDir(sessionPath: string): Promise<void> {
  const dir = dirname(sessionPath);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`session: failed to remove session dir ${dir} — ${message}`);
  }
}
