/**
 * The LinkedIn login helper (Phase 7, operator feedback 2026-11-05:
 * least-manual setup). Opens a HEADED Chromium with a persistent profile
 * OUTSIDE the repo; the OPERATOR logs in by hand (2FA included); the
 * helper polls the jar for the li_at + JSESSIONID pair, writes the cookie
 * file atomically, and appends/updates the LINKEDIN_COOKIES_FILE line in
 * <cwd>/.env so the probe and the loop run with zero env setup.
 *
 * This is NOT the deleted headless credential login (f571904, removed in
 * bf6594c — 2FA dead-end, live-confirmed): no credentials pass through
 * this script and no login is automated. The human performs the login in
 * a real browser (DOCUMENTATION.md §2.4 VERIFIED interactive login — the
 * lowest account-flag risk: the browser fingerprint is yours).
 *
 * The persistent profile is the less-manual win on refresh days: a
 * still-signed-in jar is harvested WITHOUT a new login, so refreshing a
 * dead session is re-running this one command while the loop keeps
 * running — the next tick heals.
 *
 * Entry-guarded main (index.ts idiom): importing the module stays
 * side-effect free — no browser opens on import.
 */
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { ENV_NAMES } from "../src/config.js";
import { envWithDotEnv, upsertDotEnvLine } from "../src/env-file.js";
import { stateTempPath } from "../src/state.js";

/** Where the cookie pair lands when LINKEDIN_COOKIES_FILE is unset everywhere. */
export const DEFAULT_COOKIE_PATH = "C:/loker-secrets/linkedin-cookies.json";

/** Persistent browser profile (outside the repo): a signed-in jar skips the login on refresh runs. */
export const DEFAULT_PROFILE_DIR = "C:/loker-secrets/linkedin-chromium-profile";

/**
 * The feed URL the helper lands on at open and RE-VISITS before any close —
 * the mandatory warm-up (verified protocol 2026-11-12: close-without-feed
 * tripped the checkpoint twice; feed-first passed twice).
 */
export const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";

/** Feed warm-up settle: the session rests on the loaded feed before the browser may close. */
export const FEED_SETTLE_MS = 5_000;

/** Poll cadence for the cookie jar. */
export const POLL_INTERVAL_MS = 2_000;

/** The operator gets 5 minutes for the login (2FA included) before the gate exits. */
export const LOGIN_TIMEOUT_MS = 300_000;

/** The harvested pair, verbatim from the jar — JSESSIONID keeps its quotes; the session module canonicalizes. */
export interface LinkedInCookiePair {
  liAt: string;
  jsessionid: string;
}

/** The browser-context seam the offline suite injects (no headed Chromium in tests). */
export interface LoginContext {
  cookies: (url: string) => Promise<Array<{ name: string; value: string }>>;
  /**
   * The mandatory pre-close feed warm-up (verified 2026-11-12): navigate to
   * LINKEDIN_FEED_URL and let it settle. Optional so existing offline doubles
   * stay assignable — the production default always supplies it.
   */
  gotoFeed?: () => Promise<void>;
  close: () => Promise<void>;
}

/** Harvest the pair from one jar snapshot; null until BOTH cookies are present and non-empty. */
export function findSessionCookies(
  cookies: ReadonlyArray<{ name: string; value: string }>,
): LinkedInCookiePair | null {
  const liAt = cookies.find((cookie) => cookie.name === "li_at")?.value ?? "";
  const jsessionid = cookies.find((cookie) => cookie.name === "JSESSIONID")?.value ?? "";
  if (liAt.trim() === "" || jsessionid.trim() === "") return null;
  return { liAt, jsessionid };
}

/**
 * Atomic cookie-file write (sibling unique temp + rename, the state.ts
 * precedent): a crashed harvest never leaves a partial cookie file for
 * the next command to misread.
 */
/**
 * Atomic cookie-file write (sibling unique temp + rename, the state.ts
 * precedent): a crashed harvest never leaves a partial cookie file for
 * the next command to misread. `harvestedAt` is the machine-written FR-0
 * provenance stamp — an ISO-8601 instant the CALLER computes from its own
 * clock (pinned-clock rule: the clock never enters this writer), recorded
 * verbatim beside the pair. The fetchTick gate requires it; nothing here
 * or in the session resolver age-checks it.
 */
export async function writeCookieFile(
  pair: LinkedInCookiePair,
  filePath: string,
  harvestedAt: string,
): Promise<void> {
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, Date.now());
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      tempPath,
      `${JSON.stringify({ ...pair, harvestedAt }, null, 2)}
`,
      "utf8",
    );
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort temp cleanup
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`login-linkedin: cookie write failed for ${filePath}: ${message}`);
  }
}

export interface LoginHelperDeps {
  /** Context opener. Default: headed launchPersistentContext (own playwright quarantine site). */
  openContext?: () => Promise<LoginContext>;
  /** Cookie file target. Default: LINKEDIN_COOKIES_FILE from the merged env, else DEFAULT_COOKIE_PATH. */
  cookiePath?: string;
  /** The .env document to upsert. Default: <cwd>/.env. */
  dotEnvPath?: string;
  /** Environment for the cookie-path default. Default: envWithDotEnv(). */
  env?: Record<string, string | undefined>;
  pollMs?: number;
  timeoutMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Keep the browser open after a successful harvest: the operator drives it by hand; Enter closes it. */
  keepOpen?: boolean;
  /** The Enter wait for keep-open. Default: a stdin readline (production only — tests inject). */
  enterWait?: () => Promise<void>;
}

export interface LoginHelperResult {
  cookiePath: string;
  dotEnvUpdated: boolean;
}

async function openDefaultContext(profileDir: string): Promise<LoginContext> {
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "msedge",
    headless: false,
    viewport: null,
  });
  const page = await context.newPage();
  await page.goto(LINKEDIN_FEED_URL, { waitUntil: "domcontentloaded" });
  return {
    cookies: (url) => context.cookies(url),
    gotoFeed: async () => {
      await page.goto(LINKEDIN_FEED_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(FEED_SETTLE_MS);
    },
    close: async () => {
      await context.close();
    },
  };
}

/**
 * The CLI keep-open decision (the --auto-close seam, Phase 5): the
 * standalone entry holds the browser open until Enter by DEFAULT - the
 * operator drives the session by hand before close (the verified
 * protocol). --auto-close restores the pre-Phase-5 fire-and-close
 * behavior for scripted runs. Exported so the offline suite pins both
 * arms (the repo rule: export the logic, not a side effect).
 */
export function keepOpenForArgv(argv: readonly string[]): boolean {
  return !argv.includes("--auto-close");
}
async function waitForEnter(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  await rl.question("");
  rl.close();
}

/**
 * Run the helper: open the headed context, poll the jar until the pair
 * appears (or the budget dies), write the cookie file + the .env line,
 * close the context in finally. Timeout throws fail-visibly; Ctrl-C or a
 * closed window surfaces as a poll error with the same contract.
 */
export async function runLoginHelper(deps: LoginHelperDeps = {}): Promise<LoginHelperResult> {
  const env = deps.env ?? envWithDotEnv();
  const fromEnv = env[ENV_NAMES.linkedinCookiesFile]?.trim();
  const cookiePath =
    deps.cookiePath ?? (fromEnv !== undefined && fromEnv !== "" ? fromEnv : DEFAULT_COOKIE_PATH);
  const dotEnvPath = deps.dotEnvPath ?? join(process.cwd(), ".env");
  const pollMs = deps.pollMs ?? POLL_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const sleepFn =
    deps.sleepFn ??
    ((ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const now = deps.now ?? Date.now;
  const keepOpen = deps.keepOpen === true;
  const openContext = deps.openContext ?? (() => openDefaultContext(DEFAULT_PROFILE_DIR));

  const context = await openContext();
  try {
    console.log(
      "login-linkedin: browser open — log in to LinkedIn by hand (2FA included); waiting for the session...",
    );
    const deadline = now() + timeoutMs;
    let pair = findSessionCookies(await context.cookies("https://www.linkedin.com"));
    while (pair === null) {
      if (now() >= deadline) {
        throw new Error(
          `login-linkedin: no LinkedIn session appeared within ${Math.round(timeoutMs / 60_000)} min — complete the login (2FA included) in the opened window, then re-run`,
        );
      }
      await sleepFn(pollMs);
      pair = findSessionCookies(await context.cookies("https://www.linkedin.com"));
    }
    await writeCookieFile(pair, cookiePath, new Date(now()).toISOString());
    console.log(`login-linkedin: session captured — ${cookiePath}`);
    const dotEnvUpdated = await upsertDotEnvLine(
      dotEnvPath,
      ENV_NAMES.linkedinCookiesFile,
      cookiePath,
    );
    console.log(
      dotEnvUpdated
        ? `login-linkedin: ${dotEnvPath} updated with ${ENV_NAMES.linkedinCookiesFile}`
        : `login-linkedin: ${dotEnvPath} already carries the ${ENV_NAMES.linkedinCookiesFile} line`,
    );
    // MANDATORY feed warm-up (verified protocol 2026-11-12): the session
    // rests on the loaded feed before the browser may close — the kicking
    // sequence (close without the feed visit) tripped the checkpoint twice,
    // the feed-first sequence passed twice. A failed visit warns loudly and
    // never discards a good harvest (the cookie file is already written).
    const gotoFeed = context.gotoFeed;
    if (gotoFeed !== undefined) {
      console.log("login-linkedin: mandatory feed warm-up — loading the feed before close");
      try {
        await gotoFeed();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`login-linkedin: feed warm-up FAILED — ${message} (harvest kept)`);
      }
    }
    if (keepOpen) {
      console.log("login-linkedin: browser stays OPEN — search and scroll LinkedIn by hand now");
      console.log(
        "login-linkedin: while this window is open the profile is LOCKED — do NOT run probe/fetch/watch",
      );
      console.log("login-linkedin: press Enter in this terminal to close the browser");
      const enterWait = deps.enterWait ?? waitForEnter;
      try {
        await enterWait();
      } catch (error) {
        // A piped or agent-mediated stdin has no Enter to deliver: the
        // readline rejects AFTER the cookie file is written, so the raw
        // rejection reads like a failed harvest. Rethrow with the remedy —
        // fail-loud stays (the no-TTY-check decision stands: this is error
        // handling at the failure site, not a check before it).
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `login-linkedin: no TTY on stdin — the harvest landed at ${cookiePath}; re-run from a real terminal to close the browser (readline said: ${detail})`,
        );
      }
    }
    return { cookiePath, dotEnvUpdated };
  } finally {
    await context.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLoginHelper({ keepOpen: keepOpenForArgv(process.argv) }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`login-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
