/**
 * LinkedIn transport gate (design D8, the probe-judge pattern; rebuilt on
 * the browser walk, migration 2026-11-11): drive the SAME production stack
 * — the cookie resolver, the headed persistent-profile Chromium context
 * factory, the content-search browser walk with its flagship-web response
 * join — against the first configured linkedin surface, one real browser
 * page.
 *
 * Exit 1 on a checkpoint or login wall (the walk's tagged halt), a dead
 * session (no flagship-web response within the liveness window — the
 * tagged leg-dead), every surface faulted, or fewer than 10 posts. The
 * probe writes nothing: no payload, no push, no latch, no episode
 * marker — it is a read-only diagnostic the fetch tick never consults.
 *
 * Entry-guarded main (the login-linkedin.ts idiom): importing the module
 * stays side-effect free — no config load, no cookie read, no browser.
 * runProbe is the exported seam the offline suite and the operator chain
 * drive: gate failures THROW (the fetchTick model), so every caller owns
 * its exit and can name the gate. The two local gates (floor,
 * no-surfaces) are TAGGED so this file's CLI wrapper prints today's
 * exact lines and callers can classify them.
 *
 * Operator protocol (Nov 1 research rule): run twice >=6h apart with the
 * stored cookies only before trusting the loop; re-run after every
 * session re-harvest (npm run login-linkedin).
 *
 * Usage: npx tsx scripts/probe-linkedin.ts   (needs LINKEDIN_COOKIES_FILE;
 * runs from the repo root — it loads watcher.config.json at startup)
 */
import { pathToFileURL } from "node:url";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { envWithDotEnv } from "../src/env-file.js";
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedInContextFactory,
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-fetch.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";

/**
 * The probe's Load-more click floor (live rehearsal 2026-11-11): the dry
 * exit may not fire before this many clicks have landed, so one probe run
 * samples several pagination bodies instead of stopping at the first.
 */
const PROBE_MIN_CLICKS = 5;

/** The probe's post floor: pagination must prove out across several bodies. */
const PROBE_MIN_POSTS = 10;

// --- the probe's two local gates: the halt/legDead idiom (name constant +
//     factory + type guard), local to this file because only the probe
//     defines these failure modes ---

export const PROBE_FLOOR = "ProbeFloorError";

/** Thrown when the walk minted fewer than PROBE_MIN_POSTS posts. */
export interface ProbeFloor extends Error {
  name: string;
}

export function probeFloor(): ProbeFloor {
  const error = new Error(
    "probe: fewer than 10 posts — pagination did not prove out (need >= 10 across several bodies)",
  ) as ProbeFloor;
  error.name = PROBE_FLOOR;
  return error;
}

export function isProbeFloor(error: unknown): error is ProbeFloor {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === PROBE_FLOOR
  );
}

export const PROBE_NO_SURFACES = "ProbeNoSurfacesError";

/** Thrown when the config carries no linkedin surface for the probe to walk. */
export interface ProbeNoSurfaces extends Error {
  name: string;
}

export function probeNoSurfaces(): ProbeNoSurfaces {
  const error = new Error(
    "probe: no linkedin surfaces configured in watcher.config.json",
  ) as ProbeNoSurfaces;
  error.name = PROBE_NO_SURFACES;
  return error;
}

export function isProbeNoSurfaces(error: unknown): error is ProbeNoSurfaces {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === PROBE_NO_SURFACES
  );
}

export interface ProbeDeps {
  /** Pre-resolved config. Default: loadWatcherConfig() — fail-visible. */
  config?: WatcherConfig;
  /** Environment for the cookie preflight. Default: envWithDotEnv(). */
  env?: Record<string, string | undefined>;
  /** Browser-context factory. Default: the walk module's own production factory. */
  contextFactory?: LinkedInContextFactory;
  /** The walk's Load-more click floor. Default: PROBE_MIN_CLICKS. */
  minClicks?: number;
  /** Clock for the elapsed report. Default: Date.now. */
  now?: () => number;
}

/** What a passed probe reports to its caller (the chain, the offline suite). */
export interface ProbeResult {
  postCount: number;
  elapsedMs: number;
}

/**
 * Run the probe: resolve config, pick the FIRST configured linkedin
 * surface, preflight the cookie file (presence/parse only — the browser
 * rides the persistent PROFILE, not this document), walk the surface
 * read-only, and enforce the 10-post floor. Resolves with the post count
 * and the elapsed wall clock on pass. Every failure THROWS — the walk's
 * tagged gate errors (halt, leg-dead, all-faulted) keep their names, the
 * two local gates carry theirs, and the cookie resolver's plain error
 * passes through: the caller maps them all (the fetchTick model).
 */
export async function runProbe(deps: ProbeDeps = {}): Promise<ProbeResult> {
  const config = deps.config ?? (await loadWatcherConfig());
  const surfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  if (surfaces.length === 0) {
    throw probeNoSurfaces();
  }
  const surface = surfaces[0] as LinkedinSurface;
  // The merged env, resolved once: .env fills ONLY unset keys, the real
  // shell wins — an .env-only setup reaches the browser leg unaided.
  const env = deps.env ?? envWithDotEnv();
  // Preflight only (REVISED 2026-11-11T18:40+0700): the cookie file must
  // exist and parse, but the browser rides the persistent PROFILE, not
  // this document. resolveLinkedInCookies throws fail-visibly on a
  // missing or malformed file, which is the check worth keeping.
  resolveLinkedInCookies(env);
  const minClicks = deps.minClicks ?? PROBE_MIN_CLICKS;
  console.log(
    `probe: browser walk — content search for "${surface.value}" (scrollRounds ${config.scrollRounds}, minClicks ${minClicks}, headed on the persistent profile)`,
  );
  const now = deps.now ?? Date.now;
  const started = now();
  // The undefined contextFactory selects the walk module's own production
  // factory (the persistent profile, headed, the Playwright import lazy
  // inside it) — the same lazy-default the tick suite pins.
  // minClicks: the probe must sample several pagination bodies, not stop
  // at the first dry exit — each body carries ~3 posts (live rehearsal
  // 2026-11-11), so the floor proves the pagination leg works.
  // scrollRounds stays the ceiling.
  const posts = await fetchLinkedInPosts(
    [surface],
    LINKEDIN_PROFILE_DIR,
    deps.contextFactory,
    config.scrollRounds,
    undefined, // default sleep
    deps.now, // Date.now when unset — the exact production call shape
    undefined, // Math.random
    minClicks,
  );
  const elapsedMs = now() - started;
  console.log(`probe: ${elapsedMs}ms — ${posts.length} post(s)`);
  if (posts.length < PROBE_MIN_POSTS) {
    throw probeFloor();
  }
  console.log("probe: all checks passed");
  return { postCount: posts.length, elapsedMs };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The exact CLI contract, arm for arm: the walk's tagged arms keep
  // today's byte-for-byte lines, the two local gates print their already-
  // prefixed message bare — the same line the pre-refactor script printed
  // — and the fallback keeps the FAILED wrapper.
  runProbe().catch((error: unknown) => {
    if (isHalt(error)) {
      console.error(`probe: HALT — ${error.reason}`);
      process.exit(1);
    }
    if (isLegDead(error)) {
      console.error(`probe: LEG DEAD — ${error.reason}`);
      process.exit(1);
    }
    if (isAllSurfacesFaulted(error)) {
      console.error(`probe: FAILED — ${error.message}`);
      process.exit(1);
    }
    if (isProbeNoSurfaces(error)) {
      console.error(error.message);
      process.exit(1);
    }
    if (isProbeFloor(error)) {
      console.error(error.message);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`probe: FAILED — ${message}`);
    process.exit(1);
  });
}
