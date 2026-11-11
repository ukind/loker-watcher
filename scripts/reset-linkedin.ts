/**
 * The LinkedIn session reset (design 2026-11-09, the FR-0 companion — the
 * operator's escape hatch for a bad or flagged harvest; the kept budget
 * ledger reporting removed by the browser-walk migration 2026-11-11).
 *
 * Deletes the three artifacts a stale or flagged session leaves behind so
 * the operator can start clean with ONE command:
 *
 *   1. the cookie file (LINKEDIN_COOKIES_FILE, else DEFAULT_COOKIE_PATH)
 *   2. the persistent browser profile (DEFAULT_PROFILE_DIR)
 *   3. the operator-cleared halt latch (the fetch-linkedin.ts DEFAULT_LATCH)
 *
 * Every path is reported; a missing path is a no-op, not an error — the
 * command is idempotent and safe to re-run. The .env line is left alone:
 * it still points at the cookie path the next login harvest will write.
 *
 * The latch path imports from scripts/fetch-linkedin.ts — one source of
 * truth for the state path (a reset that deleted a flag the fetch leg
 * does not read would leave a reset that did not take).
 *
 * Entry-guarded main (the login-linkedin.ts idiom): importing the module
 * stays side-effect free — nothing is deleted on import.
 */
import { rm, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ENV_NAMES } from "../src/config.js";
import { envWithDotEnv } from "../src/env-file.js";
import { DEFAULT_LATCH } from "./fetch-linkedin.js";
import { DEFAULT_COOKIE_PATH, DEFAULT_PROFILE_DIR } from "./login-linkedin.js";

export interface ResetLinkedInDeps {
  /** Environment for the cookie-path default. Default: envWithDotEnv(). */
  env?: Record<string, string | undefined>;
  /** Cookie file target. Default: LINKEDIN_COOKIES_FILE from the merged env, else DEFAULT_COOKIE_PATH. */
  cookiePath?: string;
  /** Browser profile dir. Default: DEFAULT_PROFILE_DIR. */
  profileDir?: string;
  /** Halt-latch flag. Default: DEFAULT_LATCH (exported by fetch-linkedin.ts). */
  latchPath?: string;
  /** Injectable remover. Default: rm(path, { recursive: true, force: true }). */
  remove?: (path: string) => Promise<void>;
}

export interface ResetLinkedInResult {
  /** Paths that existed and were removed. */
  removed: string[];
  /** Paths that did not exist (quiet no-op). */
  absent: string[];
}

async function existsAt(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete the cookie file, the browser profile, and the halt latch, in that
 * order, reporting every outcome. Idempotent: a missing path lands in
 * `absent`, never an error; a deletion that truly fails throws naming the
 * path and the entry wrapper turns it into exit 1.
 */
export async function resetLinkedIn(deps: ResetLinkedInDeps = {}): Promise<ResetLinkedInResult> {
  const env = deps.env ?? envWithDotEnv();
  const fromEnv = env[ENV_NAMES.linkedinCookiesFile]?.trim();
  const cookiePath =
    deps.cookiePath ?? (fromEnv !== undefined && fromEnv !== "" ? fromEnv : DEFAULT_COOKIE_PATH);
  const profileDir = deps.profileDir ?? DEFAULT_PROFILE_DIR;
  const latchPath = deps.latchPath ?? DEFAULT_LATCH;
  const remove =
    deps.remove ?? ((path: string): Promise<void> => rm(path, { recursive: true, force: true }));

  const removed: string[] = [];
  const absent: string[] = [];
  for (const [label, target] of [
    ["cookie file", cookiePath],
    ["browser profile", profileDir],
    ["halt latch", latchPath],
  ] as const) {
    if (!(await existsAt(target))) {
      absent.push(target);
      console.log(`reset-linkedin: ${label} not present — ${target}`);
      continue;
    }
    try {
      await remove(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`reset-linkedin: could not remove the ${label} at ${target} — ${message}`);
    }
    removed.push(target);
    console.log(`reset-linkedin: removed ${label} — ${target}`);
  }
  return { removed, absent };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetLinkedIn().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`reset-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
