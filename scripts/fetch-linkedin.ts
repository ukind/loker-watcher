/**
 * One LinkedIn fetch tick (PC-local leg, design D5/D7):
 *
 *   cookies → transport → voyager walk → payload write → single-path push
 *
 * The push mirrors scripts/commit-state-rebase.sh's discipline, scoped to
 * the payload path: add ONLY state/linkedin-posts.json, no-op guard,
 * commit, pull --rebase origin main, push, one retry on rejection. The bot's
 * commit-back runs the same discipline on a disjoint path, and each
 * file has exactly one writer, so an exact-simultaneous push pair costs
 * the loser one retry — never a lost update. Run from a DEDICATED clone of
 * main: the checkout preflight (guardCheckout) enforces branch main + a
 * clean tree BEFORE cookies, transport, or any voyager GET — a dirty tree
 * wedges the rebase only AFTER a live fetch is burned, and a non-main
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
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import { resolveEmailConfig, sendLegDeadAlarm } from "../src/email.js";
import { envWithDotEnv } from "../src/env-file.js";
import {
  type LinkedinSurface,
  type Transport,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isLegDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import { writePayloadAtomic } from "../src/linkedin-payload.js";
import { type LinkedInCookies, resolveLinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

/** Injectable git runner: args → exit code + git's own merged output (never rejects). */
export type GitRunner = (args: readonly string[]) => Promise<{ code: number; output: string }>;

const execFilePromised = promisify(execFile);

/** The real git on PATH; exported for the suite's read-only spawn pins. */
export const realGit: GitRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFilePromised("git", [...args], { windowsHide: true });
    return { code: 0, output: `${stdout}\n${stderr}`.trim() };
  } catch (error) {
    // execFile rejects on a nonzero code with {stdout, stderr} attached;
    // both channels merge into one trimmed output either way.
    const raw = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    const code = typeof raw.code === "number" ? raw.code : 1;
    const output = `${String(raw.stdout ?? "")}\n${String(raw.stderr ?? "")}`.trim();
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
  /** Opened transport. Default: resolveLinkedInTransport(env, cookies). The caller owns a provided transport. */
  transport?: Transport;
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
  /** Clock for the payload stamp. Default: Date.now. */
  now?: () => number;
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
  await writeFile(marker, `${reason}\n`, "utf8");
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
 * Dedicated-clone preflight (D5, Phase 10): the push discipline assumes a
 * clean checkout of main. A dirty tree kills the rebase AFTER a live fetch;
 * a non-main branch silently pushes the payload to the wrong ref (the
 * hosted run reads main). Both fail here — before cookies, transport, or
 * any voyager GET — naming what is wrong and the remedy. Two git reads,
 * zero network.
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
  // The checkout preflight runs BEFORE the cookie/transport resolvers: a
  // mis-homed checkout costs zero voyager GETs and writes nothing. The loop
  // catches this plain error and keeps running (a mis-homed loop warns
  // every 10 min instead of burning live fetches); the one-shot entry exits 1.
  await guardCheckout(deps.git ?? realGit);
  const cookies = deps.cookies ?? resolveLinkedInCookies(env);
  const transport = deps.transport ?? (await resolveLinkedInTransport(env, cookies));
  let posts: Post[];
  try {
    // The bare GET rides the walk (never the Transport object — the walk
    // disposes any Transport it receives); disposal is this finally's job alone.
    posts = await fetchLinkedInPosts(surfaces, cookies, transport.get);
  } catch (error) {
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
  } finally {
    // The caller owns a provided transport; a locally opened one dies here.
    if (deps.transport === undefined) await transport.dispose();
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
