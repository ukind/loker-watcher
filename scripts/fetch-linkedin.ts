/**
 * One LinkedIn fetch tick (PC-local leg, design D5/D7; browser-walk
 * migration 2026-11-11):
 *
 *   cookies → browser walk → payload write → single-path push
 *
 * The push mirrors scripts/commit-state-rebase.sh's discipline, scoped to
 * the payload path: add ONLY state/linkedin-posts.json, no-op guard,
 * commit, pull --rebase origin main, push, one retry on rejection. The bot's
 * commit-back runs the same discipline on a disjoint path, and each
 * file has exactly one writer, so an exact-simultaneous push pair costs
 * the loser one retry — never a lost update. Run from a DEDICATED clone of
 * main: the checkout preflight (guardCheckout) enforces branch main + a
 * clean tree BEFORE cookies, the walk, or any browser navigation — a dirty
 * tree wedges the rebase only AFTER a live fetch is burned, and a non-main
 * branch would push the payload to the wrong ref. The rebase doubles as
 * the loop's own code auto-update.
 *
 * Leg-dead: ONE alarm email per episode (edge-detected via a repo-local
 * marker file beside the payload — never OS temp: a reboot or temp-cleaner
 * must not erase the episode and re-alarm a still-dead leg), then exit 1
 * for this one-shot entry. The loop
 * (scripts/watch-linkedin.ts) catches and keeps running — a cookie-file
 * refresh self-heals on a later tick. Best-effort alarm policy: a broken
 * GMAIL_* configuration must not mask the exit code.
 *
 * Entry-guarded main (index.ts idiom): importing fetchTick stays
 * side-effect free.
 */
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH, STATE_PATH } from "../src/config.js";
import { resolveEmailConfig, sendHaltAlarm, sendLegDeadAlarm } from "../src/email.js";
import { envWithDotEnv } from "../src/env-file.js";
import { isWithinWorkingHours } from "../src/linkedin-behavior.js";
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedInContextFactory,
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-fetch.js";
import { writePayloadAtomic } from "../src/linkedin-payload.js";
import { type LinkedInCookies, resolveLinkedInCookies } from "../src/linkedin-session.js";
import { readSeenIdSet } from "../src/state.js";
import type { Post } from "../src/types.js";

/** Injectable git runner: args → exit code + git's own merged output (never rejects). */
export type GitRunner = (args: readonly string[]) => Promise<{ code: number; output: string }>;

const execFilePromised = promisify(execFile);

/** The real git on PATH; exported for the suite's read-only spawn pins. */
export const realGit: GitRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFilePromised("git", [...args], { windowsHide: true });
    return {
      code: 0,
      output: `${stdout}
${stderr}`.trim(),
    };
  } catch (error) {
    // execFile rejects on a nonzero code with {stdout, stderr} attached;
    // both channels merge into one trimmed output either way.
    const raw = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    const code = typeof raw.code === "number" ? raw.code : 1;
    const output = `${String(raw.stdout ?? "")}
${String(raw.stderr ?? "")}`.trim();
    return { code: Number.isInteger(code) ? code : 1, output };
  }
};

/** Outcome of one tick; the loop and tests assert on it. */
export interface FetchTickResult {
  wrote: boolean;
  pushed: boolean;
  postCount: number;
}

export interface FetchTickDeps {
  /** Pre-resolved config. Default: loadWatcherConfig() — fail-visible. */
  config?: WatcherConfig;
  /** Pre-resolved cookies. Default: resolveLinkedInCookies(env). */
  cookies?: LinkedInCookies;
  /**
   * Browser-context factory for the walk (the LinkedInContextFactory seam).
   * Default: the walk module's own production factory (headless Chromium,
   * the session document in). The walk opens and closes the context on
   * every path — the tick owns no browser lifecycle of its own.
   */
  contextFactory?: LinkedInContextFactory;
  /** Payload location. Default: LINKEDIN_PAYLOAD_PATH (the pushed path). */
  payloadPath?: string;
  /** Git runner. Default: the real git on PATH. */
  git?: GitRunner;
  /** Environment for the resolvers. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Episode alarm. Default: sendLegDeadAlarm, best-effort (warn on failure). */
  alarm?: (reason: string) => Promise<void>;
  /** Episode marker file. Default: repo-local beside the payload (survives restarts). */
  markerPath?: string;
  /**
   * Seen-posts state file for the walk's seen-stop (design 2026-11-13).
   * Default: STATE_PATH — the committed seen file the hosted bot writes
   * back. The offline suite injects a temp path to stay hermetic.
   */
  seenPath?: string;
  /** Clock for the payload stamp. Default: Date.now. */
  now?: () => number;
  /** Halt-latch flag file. Default: repo-local beside the payload (survives restarts). */
  latchPath?: string;
  /** Jitter draw for the walk pacing + shuffle. Default: Math.random. */
  rng?: () => number;
  /** Halt-latch alarm. Default: sendHaltAlarm, best-effort (warn on failure). */
  haltAlarm?: (reason: string) => Promise<void>;
  /**
   * Bypass the working-hours window gate. Default: false (the gate is on).
   * The offline suite injects true so a tick can run at any pinned clock;
   * production never sets it.
   */
  bypassWindow?: boolean;
}

/**
 * Episode marker BESIDE THE PAYLOAD (repo-local, persistent): present = the
 * alarm already fired for this episode. OS temp was rejected 2026-11-04 —
 * a reboot or temp-cleaner erased it, and a still-dead leg after a PC
 * restart re-alarmed, breaking one-alarm-per-episode exactly when the
 * operator needs quiet. state/ in the dedicated clone is loop-owned and
 * persistent; the flag is untracked (pushPayload stages only the payload
 * path; the bot commits only seen-posts.json), so rebase never touches it.
 */
const DEFAULT_MARKER = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-leg-dead.flag");

/**
 * The operator-cleared halt latch (FR-7): present = fetching is blocked until
 * the operator deletes it. Repo-local beside the payload, same discipline as
 * the episode marker — a reboot or temp-cleaner must not erase it.
 */
export const DEFAULT_LATCH = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-halt.flag");

async function markerExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Send the leg-dead alarm ONCE per episode: the marker file edges the
 * healthy→dead transition, so a 144-tick dead day emails once. Every dead
 * tick still warns in the run log.
 */
export async function handleLegDeadEpisode(
  reason: string,
  deps: FetchTickDeps = {},
): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  const env = deps.env ?? process.env;
  if (await markerExists(marker)) {
    console.warn(`fetch-linkedin: leg still dead — ${reason} (alarm already sent this episode)`);
    return;
  }
  await writeFile(
    marker,
    `${reason}
`,
    "utf8",
  );
  console.error(`fetch-linkedin: LEG DEAD — ${reason}`);
  const alarm =
    deps.alarm ??
    (async (alarmReason: string) => {
      try {
        await sendLegDeadAlarm(alarmReason, resolveEmailConfig(env));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch-linkedin: alarm not sent — ${message}`);
      }
    });
  await alarm(reason);
}

/** Clear a prior episode marker on a healthy tick (the dead→healthy edge). */
async function clearEpisodeMarker(deps: FetchTickDeps): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  if (await markerExists(marker)) {
    await rm(marker, { force: true });
    console.log("fetch-linkedin: leg recovered — episode cleared");
  }
}

/**
 * The halt latch: present = the operator must clear it (FR-7). Same
 * read-file discipline as the episode marker's exists probe.
 */
async function latchPresent(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Trip the latch once: the flag's content IS the reason, so the file
 * always explains itself. First-write-wins — a second trip never rewrites
 * an existing flag.
 */
async function tripLatch(path: string, reason: string): Promise<void> {
  if (await latchPresent(path)) return;
  await writeFile(
    path,
    `${reason}
`,
    "utf8",
  );
}

/**
 * Best-effort latch alarm: a broken GMAIL_* configuration warns and never
 * masks the tick outcome (the leg-dead alarm's policy, verbatim).
 */
function defaultHaltAlarm(
  env: Record<string, string | undefined>,
): (reason: string) => Promise<void> {
  return async (reason) => {
    try {
      await sendHaltAlarm(reason, resolveEmailConfig(env));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`fetch-linkedin: latch alarm not sent — ${message}`);
    }
  };
}
/**
 * Dedicated-clone preflight (D5, Phase 10): the push discipline assumes a
 * clean checkout of main. A dirty tree kills the rebase AFTER a live fetch;
 * a non-main branch silently pushes the payload to the wrong ref (the
 * hosted run reads main). Both fail here — before cookies, the walk, or
 * any browser navigation — naming what is wrong and the remedy. Two git
 * reads, zero network.
 */
export async function guardCheckout(git: GitRunner): Promise<void> {
  const head = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.output.split(/\r?\n/)[0] ?? "";
  if (head.code !== 0 || branch !== "main") {
    throw new Error(
      `fetch-linkedin: this checkout is on branch "${branch || "unknown"}", not main — the payload push would land on the wrong ref and the hosted run would never read it. Run the loop from a DEDICATED clone of main (README: PC operations)`,
    );
  }
  const status = await git(["status", "--porcelain"]);
  if (status.code !== 0 || status.output !== "") {
    const paths = status.output.split("\n");
    const names = paths.slice(0, 5).join("; ");
    throw new Error(
      `fetch-linkedin: this checkout is not clean (${paths.length} path(s): ${names}) — uncommitted edits break the rebase AFTER a live fetch. Run from a dedicated clone of main with a clean tree (README: PC operations)`,
    );
  }
}

/**
 * Commit + push ONLY the payload path with the rebase+retry discipline.
 * The rebase replays the payload commit onto origin/main; a conflict on
 * the payload path is impossible while it has one writer, so a failure
 * aborts loudly instead of skipping (the bot's whitelist never applies —
 * its seen-posts.json replay touches a disjoint path). Every failure
 * message carries git's own output — the real cause (e.g. "cannot pull
 * with rebase: You have unstaged changes") can never masquerade as a
 * misdiagnosed conflict again.
 */
export async function pushPayload(
  git: GitRunner,
  postCount: number,
  filePath: string = LINKEDIN_PAYLOAD_PATH,
): Promise<void> {
  await git(["add", filePath]);
  const staged = await git(["diff", "--cached", "--quiet"]);
  if (staged.code === 0) {
    console.log("git: payload unchanged; nothing to commit");
    return;
  }
  // The commit exit code IS checked: an unconfigured git identity in a
  // fresh dedicated clone is the classic first-tick failure, and skipping
  // the check would let rebase+push succeed while pushing NOTHING — a
  // silent no-op tick reporting pushed=true (fail-visible doctrine).
  const commit = await git(["commit", "-m", `linkedin: payload ${postCount} post(s)`]);
  if (commit.code !== 0) {
    throw new Error(
      `git: payload commit failed — configure the clone's git identity first (git config user.name + user.email) — git said: ${commit.output || "(no output)"}`,
    );
  }
  let lastFailure = "";
  const attempt = async (): Promise<boolean> => {
    const rebase = await git(["pull", "--rebase", "origin", "main"]);
    if (rebase.code !== 0) {
      lastFailure = rebase.output;
      console.error(`git: rebase failed — aborting — git said: ${rebase.output || "(no output)"}`);
      await git(["rebase", "--abort"]);
      return false;
    }
    const push = await git(["push"]);
    if (push.code !== 0) lastFailure = push.output;
    return push.code === 0;
  };
  const pushed = (await attempt()) || (await attempt());
  if (!pushed) {
    throw new Error(`git: payload push failed twice — git said: ${lastFailure || "(no output)"}`);
  }
  console.log("git: pushed payload commit");
}

export async function fetchTick(deps: FetchTickDeps = {}): Promise<FetchTickResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const config = deps.config ?? (await loadWatcherConfig());
  const surfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  if (surfaces.length === 0) {
    console.log("fetch-linkedin: no linkedin surfaces configured — nothing to do");
    return { wrote: false, pushed: false, postCount: 0 };
  }
  // The anti-restriction preflight band (design 2026-11-09; the budget step
  // deleted by the browser-walk migration 2026-11-11) runs BEFORE the
  // checkout guard: a gated no-op costs zero git spawns, zero cookie reads,
  // and zero browser navigations. Order: window -> latch.
  const latchPath = deps.latchPath ?? DEFAULT_LATCH;
  const rng = deps.rng ?? Math.random;
  const at = new Date(now());
  if (deps.bypassWindow !== true && !isWithinWorkingHours(at)) {
    console.log(
      "fetch-linkedin: outside the working window (Mon-Fri 08:00-21:00 local) — nothing to do",
    );
    return { wrote: false, pushed: false, postCount: 0 };
  }
  if (await latchPresent(latchPath)) {
    console.log(
      "fetch-linkedin: HALT LATCH present — fetching is blocked until the operator deletes it",
    );
    return { wrote: false, pushed: false, postCount: 0 };
  }
  // The checkout preflight runs BEFORE the cookie resolver: a mis-homed
  // checkout costs zero navigations and writes nothing. The loop catches
  // this plain error and keeps running (a mis-homed loop warns every 10
  // min instead of burning live fetches); the one-shot entry exits 1.
  await guardCheckout(deps.git ?? realGit);
  const cookies = deps.cookies ?? resolveLinkedInCookies(env);
  // FR-0 (design 2026-11-09): the dedicated-account gate — the cookie file must
  // carry the machine-written "harvestedAt" stamp; presence required, age never
  // checked. A stampless file is a hand-exported or legacy file: fail BEFORE
  // the walk opens a browser or any navigation leaves, naming the one remedy
  // (a re-harvest). The loop treats this like any plain tick fault (warn +
  // keep running); the one-shot entry exits 1.
  if (cookies.harvestedAt === undefined) {
    throw new Error(
      'fetch-linkedin: the cookie file carries no machine-written "harvestedAt" stamp — run "npm run login-linkedin" to re-harvest the session (README: PC operations)',
    );
  }
  // The seen-stop set (design 2026-11-13): the full-history seen ids feed
  // the walk's consecutive-seen stop. Outside the fault try BY CONTRACT:
  // readSeenIdSet degrades to an empty set on every fault, so the walk's
  // fault vocabulary stays browser-shaped (halt / leg-dead / all-faulted
  // only) — a broken seen file costs the stop, never the tick.
  const seenIds = await readSeenIdSet(deps.seenPath ?? STATE_PATH);
  let posts: Post[];
  try {
    // The walk owns the browser: it opens one context on the persistent
    // PROFILE and closes it on every path, so the tick has no dispose arm
    // of its own. scrollRounds (the config knob shared with the Threads
    // walk) bounds the Load-more clicks per surface; the factory defaults
    // to the walk module's production profile factory (headed).
    //
    // REVISED 2026-11-11T18:40+0700: the resolved cookies above are a
    // PREFLIGHT only (the harvestedAt gate). The browser rides the profile,
    // not the cookie document — a fresh browser with the document gets a
    // page with no Load-more button.
    posts = await fetchLinkedInPosts(
      surfaces,
      LINKEDIN_PROFILE_DIR,
      deps.contextFactory,
      config.scrollRounds,
      undefined,
      now,
      rng,
      0, // minClicks — the tick carries no click floor (the probe owns PROBE_MIN_CLICKS)
      seenIds,
    );
  } catch (error) {
    // The halt arm (FR-7): a security checkpoint or login wall trips the
    // operator-cleared latch, alarms once (best-effort), and lands as a
    // quiet-zeros no-op — the loop keeps running, fetching nothing.
    if (isHalt(error)) {
      await tripLatch(latchPath, error.reason);
      console.error(`fetch-linkedin: HALT LATCH TRIPPED — ${error.reason}`);
      await (deps.haltAlarm ?? defaultHaltAlarm(env))(error.reason);
      return { wrote: false, pushed: false, postCount: 0 };
    }
    // All-faulted walk (Phase 8, b2): an all-faulted tick is a tagged no-op
    // — quiet zeros, payload/git/episode-marker untouched, so the hosted
    // reader keeps scoring the LAST GOOD payload instead of a fresh empty
    // one. Leg-dead is NOT caught here: it re-throws and the entry/loop
    // callers own the alarm policy.
    if (isAllSurfacesFaulted(error)) {
      console.warn(
        `fetch-linkedin: all ${error.faulted} linkedin surface(s) faulted — payload not touched, last good payload preserved`,
      );
      return { wrote: false, pushed: false, postCount: 0 };
    }
    throw error;
  }
  const payloadPath = deps.payloadPath ?? LINKEDIN_PAYLOAD_PATH;
  await writePayloadAtomic(posts, payloadPath, now);
  console.log(`payload: wrote ${posts.length} post(s) — ${payloadPath}`);
  await pushPayload(deps.git ?? realGit, posts.length, payloadPath);
  await clearEpisodeMarker(deps);
  return { wrote: true, pushed: true, postCount: posts.length };
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The merged env: .env fills ONLY unset keys, the real shell wins. The
  // fetchTick default stays process.env for the offline tests' injection.
  fetchTick({ env: envWithDotEnv() }).catch(async (error: unknown) => {
    if (isLegDead(error)) {
      await handleLegDeadEpisode(error.reason);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`fetch-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
