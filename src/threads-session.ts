/**
 * Threads session resolution (Phase 8).
 *
 * The authenticated fetch replays a Playwright storageState document
 * exported from a real browser login. The document travels base64-encoded
 * in the THREADS_SESSION_STATE environment variable (a GitHub Actions
 * secret): it is account-equivalent, so it never enters the repo and never
 * enters state/seen-posts.json. The decoded document is written to an OS
 * temp file that Playwright loads as the browser context's storage state.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_NAMES } from "./config.js";

/** Minimal shape check for a Playwright storageState document. */
export function isValidStorageState(doc: unknown): boolean {
  if (doc === null || typeof doc !== "object") return false;
  const cookies: unknown = (doc as { cookies?: unknown }).cookies;
  return Array.isArray(cookies) && cookies.length > 0;
}

/**
 * Decode the base64 session secret and write it to a temp file.
 * Returns the file path, or null when the secret is unset or invalid —
 * callers fall back to the logged-out fetch.
 */
export async function resolveSession(
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const raw: string | undefined = env[ENV_NAMES.threadsSession];
  if (raw === undefined || raw.trim() === "") return null;

  let doc: unknown;
  try {
    doc = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    console.warn(
      "session: THREADS_SESSION_STATE is not valid base64 JSON — using the logged-out fetch",
    );
    return null;
  }
  if (!isValidStorageState(doc)) {
    console.warn(
      "session: THREADS_SESSION_STATE carries no cookies — using the logged-out fetch",
    );
    return null;
  }

  const dir = await mkdtemp(join(tmpdir(), "loker-session-"));
  const filePath = join(dir, "storage-state.json");
  await writeFile(filePath, JSON.stringify(doc), "utf8");
  return filePath;
}
