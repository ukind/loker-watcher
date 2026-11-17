/**
 * Behavioral policy machines for the PC-local LinkedIn leg (the
 * anti-restriction profile, design 2026-11-09; the daily GET budget
 * machine deleted by the browser-walk migration 2026-11-11; the
 * working-hours window deleted 2026-11-15 — every tick runs any day,
 * any hour): the jittered wake cadence and the halt-latch reason
 * vocabulary.
 *
 * Extraction idiom (src/judge-rotation.ts:5-7): pure machines + constants
 * live here; IO and policy placement stay at the consumer
 * (scripts/fetch-linkedin.ts wires the preflight band,
 * scripts/watch-linkedin.ts wires the loop cadence). The module is
 * IO-free: dates and rng draws arrive as arguments, so the offline suite
 * pins every edge with zero doubles.
 *
 * Wake-cadence arithmetic (the account-safety bound): 1440 minutes per
 * local day; wake-ups per local day = 1440 / linkedinWakeMinMinutes (the
 * configured floor — 24 at the 60-minute default; the historic 28-minute
 * floor gave 52, the number older docs quote). Each wake walks at most
 * 5 surfaces x (1 navigation + scrollRounds Load-more clicks). The click
 * cap rides the walk (src/linkedin-fetch.ts).
 */

/**
 * The jitter draw seam: a Math.random-shaped function over [0, 1). The
 * codebase's first rng seam — injected everywhere so the offline suite
 * pins bounds and permutations without ambient randomness.
 */
export type RandomFn = () => number;

/** One validated wake band, converted to whole milliseconds. */
export interface LinkedInWakeBand {
  /** Uniform draw lower bound, inclusive. */
  minMs: number;
  /** Uniform draw upper bound, EXCLUSIVE — a Math.random contract never returns 1. */
  maxMs: number;
}

/**
 * Default wake floor in ms: 60 minutes, the bare-runLoop fallback when
 * the deps omit the bound (the rng ?? Math.random idiom). The operator
 * value lives in watcher.config.json (linkedinWakeMinMinutes); these
 * constants only keep the offline suite's bare calls hermetic.
 */
export const DEFAULT_WAKE_MIN_MS = 3_600_000;

/**
 * Default wake ceiling in ms, EXCLUSIVE: 60 minutes, the bare-runLoop
 * fallback. Equal to the floor, so the default band is flat — every draw
 * is exactly 3,600,000 ms with no special-casing (max - min === 0
 * collapses).
 */
export const DEFAULT_WAKE_MAX_MS = 3_600_000;

/**
 * One uniform draw in [minMs, maxMs), whole milliseconds (floor, never
 * round — rounding could land ON the exclusive ceiling). rng() === 0
 * pins the floor exactly; exactly one rng() call per draw (the transcript
 * oracle depends on exact stream consumption); the ceiling is exclusive
 * because RandomFn is [0, 1); a degenerate band (minMs === maxMs)
 * collapses every draw to exactly minMs with no special-casing. The loop
 * logs the delay in minutes plus the band.
 */
export function sampleTickDelayMs(minMs: number, maxMs: number, rng: RandomFn): number {
  return Math.floor(minMs + rng() * (maxMs - minMs));
}

/**
 * Loop-side pairwise gate over the two validated config keys (the readers
 * in src/config-file.ts guarantee integers >= 1 and the 60 defaults; this
 * owns ONLY the cross-key rule, so a broken band exit-1s the PC loop
 * alone — the hosted run, the probes, and the one-shot tick load the same
 * config but never call this). The two-key message extends the config
 * module's error vocabulary with both keys and their values.
 */
export function resolveLinkedInWakeBand(
  minMinutes: number,
  maxMinutes: number,
  filePath: string,
): LinkedInWakeBand {
  if (minMinutes > maxMinutes) {
    throw new Error(
      `config: ${filePath} "linkedinWakeMinMinutes" (${minMinutes}) must not exceed "linkedinWakeMaxMinutes" (${maxMinutes})`,
    );
  }
  return { minMs: minMinutes * 60_000, maxMs: maxMinutes * 60_000 };
}

/**
 * Canonical reason string a 429 writes into the halt-latch flag and its
 * alarm (FR-7). One constant, two readers (flag content, email body), so
 * the latch file's content always explains itself.
 */
export const HALT_RATE_LIMIT_REASON =
  "HTTP 429 rate limit — LinkedIn told this account to slow down";

/**
 * Canonical reason string a security checkpoint or login wall writes into
 * the halt-latch flag and its alarm (FR-7, browser-walk migration
 * 2026-11-11). One constant, two readers (flag content, email body), so
 * the latch file's content always explains itself. The message names the
 * one remedy: a re-harvest.
 */
export const HALT_CHECKPOINT_REASON =
  "LinkedIn security checkpoint or login wall — re-harvest the session (npm run login-linkedin)";
