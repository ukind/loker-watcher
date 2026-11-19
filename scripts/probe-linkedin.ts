/**
 * LinkedIn transport gate (design D8, the probe-judge pattern; rebuilt on
 * the browser walk, migration 2026-11-11): drive the SAME production stack
 * — the cookie resolver, the headed persistent-profile Chromium context
 * factory, the content-search browser walk with its flagship-web response
 * join — against the configured linkedin keywords IN CONFIG ORDER, one
 * real browser page per keyword. First pass wins: the probe passes on the
 * first keyword that clears the post floor; a thin or faulted keyword
 * logs one line and the walk moves on.
 *
 * Exit 1 on a checkpoint or login wall (the walk's tagged halt), a dead
 * session (no flagship-web response within the liveness window — the
 * tagged leg-dead), or when EVERY keyword is thin or faulted (the floor
 * terminal names each keyword and its count). The
 * probe writes no tracked state — no payload, no push, no latch, no
 * episode marker: it is a read-only diagnostic the fetch tick never
 * consults. Its ONE write is the capture harness's gitignored scratch
 * (captures/<UTC session stamp>/, design 2026-11-13): diagnostic evidence
 * replayed offline by scripts/replay-linkedin.ts, never committed.
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
import { type LinkedinSurface, type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { envWithDotEnv } from "../src/env-file.js";
import { type CaptureSink, makeFsCaptureSink } from "../src/linkedin-capture.js";
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import { fetchLinkedInPosts, resolveLinkedInProfileDir } from "../src/linkedin-fetch.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

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

/** Thrown when NO configured keyword cleared PROBE_MIN_POSTS (every keyword thin or faulted). */
export interface ProbeFloor extends Error {
  name: string;
}

export function probeFloor(message: string): ProbeFloor {
  const error = new Error(message) as ProbeFloor;
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
  /**
   * Capture sink for the walk (capture-first, design 2026-11-13). Default:
   * the production fs sink under captures/<UTC session stamp>/ — gitignored
   * scratch (D5: the probe stays read-only for TRACKED state; the captures
   * are diagnostic evidence). Passing nothing means CAPTURE TO DISK: the
   * offline suite injects a recording sink in its walk-driving cases.
   */
  captureSink?: CaptureSink;
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
 * One keyword that did not clear the post floor, carried to the terminal
 * line: a thin walk records its post count, a faulted walk records the
 * (faulted) marker with count 0.
 */
interface SkippedSurface {
  readonly value: string;
  readonly count: number;
  readonly faulted: boolean;
}

/**
 * Run the probe: resolve config, preflight the cookie file (presence/parse
 * only — the browser rides the persistent PROFILE, not this document),
 * then walk the configured linkedin keywords in CONFIG ORDER, one
 * fetchLinkedInPosts call per keyword, read-only. First pass wins: the
 * first keyword minting >= PROBE_MIN_POSTS posts resolves the run with
 * THAT attempt's count and wall clock. A keyword below the floor (thin)
 * or one whose walk faulted (AllSurfacesFaulted, faulted === 1) logs one
 * line and the loop moves on; the walk's tagged halt and leg-dead rethrow
 * INSTANTLY, as does any plain error (a contextFactory or close failure
 * recurs for every keyword — skipping would burn N launches to reach the
 * same wall). When every keyword is thin or faulted, the floor terminal
 * throws the probeFloor tag with one line naming each keyword and its
 * count. Every failure THROWS — the caller maps them (the fetchTick
 * model).
 */
export async function runProbe(deps: ProbeDeps = {}): Promise<ProbeResult> {
  const config = deps.config ?? (await loadWatcherConfig());
  const surfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  if (surfaces.length === 0) {
    throw probeNoSurfaces();
  }
  // The merged env, resolved once: .env fills ONLY unset keys, the real
  // shell wins — an .env-only setup reaches the browser leg unaided.
  const env = deps.env ?? envWithDotEnv();
  // Preflight only (REVISED 2026-11-11T18:40+0700): the cookie file must
  // exist and parse, but the browser rides the persistent PROFILE, not
  // this document. resolveLinkedInCookies throws fail-visibly on a
  // missing or malformed file, which is the check worth keeping.
  resolveLinkedInCookies(env);
  const minClicks = deps.minClicks ?? PROBE_MIN_CLICKS;
  const now = deps.now ?? Date.now;
  // Hoisted ABOVE the loop: the production sink mints its session stamp
  // lazily on first capture — inside the loop it would mint one stamp
  // (and one captures/<stamp>/ directory) PER KEYWORD.
  const captureSink = deps.captureSink ?? makeFsCaptureSink();
  const skipped: SkippedSurface[] = [];
  // Duplicates walk as listed (D4): a repeated keyword reuses its capture
  // slug and overwrites the earlier capture — accepted;
  // warnDuplicateSurfaces already warns at config load.
  for (const surface of surfaces) {
    console.log(
      `probe: browser walk — content search for "${surface.value}" (scrollRounds ${config.scrollRounds}, minClicks ${minClicks}, headed on the persistent profile)`,
    );
    // Per-keyword clock: elapsedMs is the WINNING attempt's duration.
    const started = now();
    let posts: Post[];
    try {
      // The undefined contextFactory selects the walk module's own production
      // factory (the persistent profile, headed, the Playwright import lazy
      // inside it) — the same lazy-default the tick suite pins.
      // minClicks: the probe must sample several pagination bodies, not stop
      // at the first dry exit — each body carries ~3 posts (live rehearsal
      // 2026-11-11), so the floor proves the pagination leg works.
      // scrollRounds stays the ceiling.
      posts = await fetchLinkedInPosts([surface], {
        profileDir: resolveLinkedInProfileDir(env),
        contextFactory: deps.contextFactory,
        scrollRounds: config.scrollRounds,
        now,
        minClicks,
        // seenIds stays unset: the probe never stops on seen ids, it needs the
        // full walk. sleepFn and rng stay unset: the production defaults.
        captureSink,
      });
    } catch (error) {
      // Halt and leg-dead abort the run instantly, and a plain error
      // rethrows too: a factory failure recurs for every keyword, so
      // skipping would burn N launches to reach the same wall.
      if (isHalt(error) || isLegDead(error) || !isAllSurfacesFaulted(error)) {
        throw error;
      }
      // Fault-skip: one line naming the keyword and the aggregate, then
      // the next keyword.
      console.log(`probe: ${surface.value} faulted — ${error.message}; trying the next surface`);
      skipped.push({ value: surface.value, count: 0, faulted: true });
      continue;
    }
    if (posts.length < PROBE_MIN_POSTS) {
      // Thin-skip: a normal return below the floor is not a fault — one
      // line naming the keyword and its count, then the next keyword.
      console.log(
        `probe: ${surface.value} — ${posts.length} post(s), below the ${PROBE_MIN_POSTS}-post floor; trying the next surface`,
      );
      skipped.push({ value: surface.value, count: posts.length, faulted: false });
      continue;
    }
    console.log(`probe: ${posts.length} post(s)`);
    console.log("probe: all checks passed");
    return { postCount: posts.length, elapsedMs: now() - started };
  }
  // The floor terminal: every keyword thin or faulted. The probeFloor tag
  // keeps the CLI's bare-print arm; the message names each keyword.
  const report = skipped
    .map((entry) =>
      entry.faulted ? `${entry.value} 0 (faulted)` : `${entry.value} ${entry.count}`,
    )
    .join(", ");
  throw probeFloor(`probe: no linkedin surface cleared ${PROBE_MIN_POSTS} posts — ${report}`);
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
