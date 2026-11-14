/**
 * The LinkedIn fetch leg's ORCHESTRATION (browser-walk migration, design
 * 2026-11-11; split by N042b): one shared browser context for the whole
 * walk, the FR-5 surface shuffle, the runPool surface walk, the shared
 * 5-15 s pacing gate, the drain arms, the join priority halt > leg-dead >
 * all-faulted, and stamp-at-slot-write.
 *
 * The browser-context factory and the three tagged-error families live in
 * linkedin-context.ts; the surface walk and its tuning constants live in
 * linkedin-walk.ts. This module keeps the profile-dir resolver, the walk's
 * deps object, the pacing gate, and the orchestration loop.
 *
 * The walk reuses runPool — verified contract: runPool RETURNS VOID
 * (src/pool.ts:33-52), so results ride caller-owned side arrays indexed
 * by the claim index, the worker stays total for surface faults, and
 * leg-dead/halt abort via the repo's drain-then-throw shape (judgePosts
 * fallback pool, src/judge.ts; fast-workflow-runtime D11). A shared
 * per-walk pacing gate (5-15 s between NAVIGATIONS, any surface) keeps
 * the global navigation rate identical to a sequential walk — the
 * anti-bot rate is pacing-bound, not width-bound. Intra-surface
 * Load-more clicks ride the ~2.5 s settle window and never trip the gate.
 *
 * Testability: importing this module never loads Playwright — the one
 * dynamic await import lives inside makeLinkedInContextFactory
 * (linkedin-context.ts) — and the offline suite injects structural
 * ContextLike doubles.
 */
import type { Surface } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import type { RandomFn } from "./linkedin-behavior.js";
import type { CaptureSink } from "./linkedin-capture.js";
import {
  type LinkedInContextFactory,
  allSurfacesFaulted,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
  makeLinkedInContextFactory,
} from "./linkedin-context.js";
import { walkLinkedInSurface } from "./linkedin-walk.js";
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

// The re-export facade (N042b). Eight symbols keep their old import path so
// three scripts and four test files stay unedited:
//   scripts/fetch-linkedin.ts, scripts/probe-linkedin.ts,
//   scripts/watch-linkedin.ts, src/index.ts,
//   tests/linkedin-fetch.test.ts, tests/fetch-linkedin.test.ts,
//   tests/probe-linkedin.test.ts, tests/watch-linkedin.test.ts.
//
// REMOVAL NOTE (run #7): re-point those imports at ./linkedin-context.js and
// ./linkedin-walk.js, then delete this block. The N012 class is "export with
// no cross-module importer" — every symbol below has one, so the facade is
// knip-safe. It must NOT grow: makeLinkedInContextFactory, the two UA
// constants, and the production factory have no importer from this
// specifier.
export {
  type LinkedInContextFactory,
  allSurfacesFaulted,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
};
export { SCROLL_JS } from "./linkedin-walk.js";
/** One configured linkedin surface (raw keyword string, never a URL). */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;

/** Injectable sleep for the pacing gate (judge.ts trailing-param idiom). */
export type SleepFn = (ms: number) => Promise<void>;

/** Walk width. The pacing gate, not this number, bounds the navigation rate. */
export const LINKEDIN_FETCH_CONCURRENCY = 2;

/** Pace floor: minimum spacing between page navigations, shared across surfaces (§13.3). */
export const PACE_MIN_MS = 5_000;

/**
 * Pace ceiling: EXCLUSIVE upper bound of the spacing draw (the anti-
 * restriction profile's 5-15 s band, design 2026-11-09). floor() keeps a
 * draw at most MAX - 1 ms, mirroring the wake-cadence bounds.
 */
export const PACE_MAX_MS = 15_000;

/** Loop-bound default (the config scrollRounds key overrides; the Threads walk carries the same fallback). */
const LINKEDIN_DEFAULT_SCROLL_ROUNDS = 8;

/**
 * The persistent profile the login helper maintains (scripts/login-linkedin.ts:34).
 * The walk reuses it rather than opening a fresh browser with the harvested
 * cookie pair — see the factory's REVISED note and the design's Key
 * Discoveries.
 */
export const LINKEDIN_PROFILE_DIR = "C:/loker-secrets/linkedin-chromium-profile";

/**
 * Resolve the persistent profile the walk opens (N053). The env override is
 * the operator's escape hatch when the profile lives on another drive; the
 * literal stays the default, so an unset env behaves exactly as today.
 *
 * Every PC consumer resolves through this one function — the tick, the
 * probe, the login helper, the reset helper — so an override can never
 * split the profile between the browser that logs in and the browser that
 * walks.
 */
export function resolveLinkedInProfileDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env[ENV_NAMES.linkedinProfileDir]?.trim();
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : LINKEDIN_PROFILE_DIR;
}
/**
 * The walk's options (N054): the ten positional parameters collapsed into
 * one object, the `FetchTickDeps` idiom (scripts/fetch-linkedin.ts:87-140)
 * — optional fields with "Default: ..." JSDoc, defaults resolved at the top
 * of the function. `surfaces` stays the first positional parameter: the
 * empty-surface guard reads first, and the 36 test call sites change only
 * their tail.
 *
 * `contextFactory` is the one field declared `| undefined`: both PC scripts
 * forward their own optional `deps.contextFactory` straight through, and
 * `exactOptionalPropertyTypes` forbids assigning `undefined` to a plain
 * optional field.
 */
export interface FetchLinkedInDeps {
  /** Persistent profile the browser opens. Default: LINKEDIN_PROFILE_DIR. */
  profileDir?: string;
  /**
   * Browser-context factory. Default: `makeLinkedInContextFactory(profileDir)`
   * — built from the RESOLVED profile dir, so the override reaches the
   * browser (N053). The old module-level production factory captured the
   * literal at import time and ignored this argument.
   */
  contextFactory?: LinkedInContextFactory | undefined;
  /** Load-more click ceiling. Default: LINKEDIN_DEFAULT_SCROLL_ROUNDS. */
  scrollRounds?: number;
  /** Injectable sleep for the pacing gate. Default: defaultSleep. */
  sleepFn?: SleepFn;
  /** Clock for the pacing gate and the capture stamps. Default: Date.now. */
  now?: () => number;
  /** Jitter draw for the pacing gate and the FR-5 shuffle. Default: Math.random. */
  rng?: RandomFn;
  /**
   * The probe's Load-more click floor: the dry exit may not fire before this
   * many clicks have landed. Default: 0 (no floor — the tick's shape).
   */
  minClicks?: number;
  /**
   * Seen ids feeding the consecutive-seen stop. Default: a FRESH empty set
   * per call — the old default expression's per-call evaluation, preserved.
   */
  seenIds?: ReadonlySet<string>;
  /**
   * Capture sink. Default: undefined — capture DISABLED. The PC scripts pass
   * `makeFsCaptureSink()` explicitly, so `npm test` never writes
   * `captures/` into the repo.
   */
  captureSink?: CaptureSink;
}

interface PacingGate {
  readonly wait: () => Promise<void>;
}

/**
 * Shared pacing gate: every page NAVIGATION starts PACE_MIN_MS or more
 * after the previous one, regardless of which surface issued it. The slot
 * is RESERVED BEFORE SLEEPING — the stamp advances synchronously on entry,
 * so concurrent workers can never compute the same wake time and fire a
 * burst; with width 2 the navigations still space PACE_MIN_MS apart
 * globally (pacing-bound, not width-bound, D11). A per-walk closure (not
 * module state): two ticks must not inherit each other's stamp, and each
 * test run gets a fresh gate.
 */
function makePacingGate(
  now: () => number,
  sleepFn: SleepFn,
  rng: RandomFn = Math.random,
): PacingGate {
  let nextFreeAt = Number.NEGATIVE_INFINITY;
  return {
    wait: async () => {
      const slotAt = Math.max(now(), nextFreeAt);
      // The gap is a fresh uniform draw in [PACE_MIN_MS, PACE_MAX_MS) per
      // reservation — randomized spacing, same reserve-before-sleep shape.
      nextFreeAt = slotAt + Math.floor(PACE_MIN_MS + rng() * (PACE_MAX_MS - PACE_MIN_MS));
      const waitMs = slotAt - now();
      if (waitMs > 0) {
        await sleepFn(waitMs);
      }
    },
  };
}

const defaultSleep: SleepFn = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
/**
 * Walk every configured linkedin surface through the session browser:
 * ONE context for the whole walk (opened from the synthesized session
 * document, closed on every path), one paced navigation plus up to
 * `scrollRounds` Load-more clicks per surface, one log line per surface
 * (empty-is-success, defb8af). Surface faults warn + skip; leg-dead
 * aborts the tick whole via drain-then-throw; a checkpoint aborts via
 * the halt channel (the latch, not the episode marker); when EVERY
 * surface faulted, the tagged AllSurfacesFaulted throws — the caller
 * decides the write (D13: a partial fault still publishes the survivors).
 *
 * FR-5 (shuffled surface order): Fisher-Yates over {surface, index}
 * pairs with the injected rng — the navigation dispatch order varies per
 * tick while perSurface keeps ORIGINAL indexes, so the flat() reassembly
 * order stays input-order structural no matter how the shuffle lands.
 *
 * deps.contextFactory defaults to a factory built from the RESOLVED profile
 * dir (the persistent profile, headed); the PC scripts and the offline
 * suite inject explicitly.
 *
 * deps.seenIds (seen-stop, design 2026-11-13): the tick's seen set feeding
 * the consecutive-seen stop; the empty default never stops, the
 * pre-seen-stop behavior.
 * deps.captureSink (capture-first, design 2026-11-13): undefined = capture
 * disabled — the offline suite passes nothing and nothing writes; the PC
 * scripts pass the production fs sink. The per-tick ordinal counter is
 * minted here and shared across every surface walk (D7).
 */
export async function fetchLinkedInPosts(
  surfaces: readonly LinkedinSurface[],
  deps: FetchLinkedInDeps = {},
): Promise<Post[]> {
  // An empty surface list must never launch a browser: the callers guard
  // surfaces.length > 0, and this early return keeps the invariant local
  // (a zero-surface walk opens no context and closes nothing).
  if (surfaces.length === 0) return [];
  // Defaults resolved once, at the top (the FetchTickDeps idiom). The
  // profile dir resolves BEFORE the factory default so the override reaches
  // the browser (N053). The walk itself never reads the environment: the
  // callers resolve it and pass it in.
  const profileDir = deps.profileDir ?? LINKEDIN_PROFILE_DIR;
  const contextFactory = deps.contextFactory ?? makeLinkedInContextFactory(profileDir);
  const scrollRounds = deps.scrollRounds ?? LINKEDIN_DEFAULT_SCROLL_ROUNDS;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const rng = deps.rng ?? Math.random;
  const minClicks = deps.minClicks ?? 0;
  const seenIds = deps.seenIds ?? new Set<string>();
  const captureSink = deps.captureSink;
  // REVISED 2026-11-11T18:40+0700: the browser opens on the persistent
  // profile, not a synthesized cookie document. The cookie file is a
  // preflight validity check in the CALLERS (resolveLinkedInCookies throws
  // on a missing/malformed file before the walk is reached).
  const context = await contextFactory(profileDir);
  const gate = makePacingGate(now, sleepFn, rng);
  // Shared per-tick capture ordinal (D7): one counter across every surface
  // walk, incremented synchronously in the response listener — filenames
  // stay unique and arrival-ordered within the session stamp.
  const captureOrdinal = { value: 0 };
  const order = surfaces.map((surface, index) => ({ surface, index }));
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  // Side arrays indexed by the ORIGINAL surface index — runPool returns
  // void (src/pool.ts:33-52); reassembly order comes from the filter+flat walk.
  const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
  let faultedCount = 0;
  let deadReason: string | undefined;
  let haltReason: string | undefined;

  try {
    await runPool(order, LINKEDIN_FETCH_CONCURRENCY, async (entry) => {
      const surface = entry.surface;
      const label = `linkedin/${surface.value}`;
      try {
        // Drain checks: stop claiming the moment a halt or leg-dead is
        // flagged; the join re-throws once.
        if (deadReason !== undefined || haltReason !== undefined) return;
        await gate.wait();
        if (deadReason !== undefined || haltReason !== undefined) return;
        const posts = await walkLinkedInSurface(
          context,
          surface,
          label,
          scrollRounds,
          minClicks,
          seenIds,
          captureSink,
          captureOrdinal,
          now,
        );
        // Stamp at the slot write (email-per-surface): the surface is a
        // LinkedinSurface, so type is always "linkedin" here. Fresh post
        // objects — the walk's parsed array is never mutated.
        perSurface[entry.index] = posts.map((post) => ({
          ...post,
          surfaces: [{ type: surface.type, value: surface.value }],
        }));
      } catch (error) {
        if (isHalt(error)) {
          // The checkpoint terminal drains like a leg-dead but lands in
          // the halt arm at the join — the account-safety latch, whose
          // alarm the operator must clear (design 2026-11-09).
          haltReason ??= error.reason;
          console.warn(`fetch: ${label} HALT — ${error.reason}`);
          return;
        }
        if (isLegDead(error)) {
          // Drain-then-throw (judgePosts D11 shape): flag, stop claiming,
          // re-throw once after the join. The tick aborts whole — partial
          // posts are discarded, never half-written.
          deadReason ??= error.reason;
          console.warn(`fetch: ${label} LEG DEAD — ${error.reason}`);
          return;
        }
        faultedCount += 1; // fault arm only; the halt/leg-dead arms return above
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch: ${label} FAILED — ${message}`);
      }
    });
  } finally {
    await context.close();
  }

  // Halt outranks leg-dead at the join: a checkpoint is the account-
  // safety terminal; a same-walk dead session still self-heals.
  if (haltReason !== undefined) {
    throw halt(haltReason);
  }
  if (deadReason !== undefined) {
    throw legDead(deadReason);
  }
  if (surfaces.length > 0 && faultedCount === surfaces.length) {
    throw allSurfacesFaulted(faultedCount);
  }
  return perSurface.filter((entry): entry is Post[] => entry !== undefined).flat();
}
