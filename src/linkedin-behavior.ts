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
 * Worst-case arithmetic (the account-safety bound): 1440 minutes per
 * local day; at the 28-minute floor that is at most 52 wake-ups per
 * local day, and each wake walks at most 5 surfaces x (1 navigation
 * + scrollRounds Load-more clicks). The click cap rides the walk
 * (src/linkedin-fetch.ts).
 */

/**
 * The jitter draw seam: a Math.random-shaped function over [0, 1). The
 * codebase's first rng seam — injected everywhere so the offline suite
 * pins bounds and permutations without ambient randomness.
 */
export type RandomFn = () => number;

/** Wake floor: 28 minutes. Uniform draw lower bound, inclusive. */
export const WAKE_MIN_MS = 28 * 60_000;

/**
 * Wake ceiling: 33 minutes. Exclusive — a Math.random contract never
 * returns 1, so floor() keeps every draw at most MAX - 1 ms and a tick can
 * never sit exactly at the ceiling. The payload staleness amendment
 * (PAYLOAD_MAX_AGE_MS 30 -> 40 min) clears this worst case with margin.
 */
export const WAKE_MAX_MS = 33 * 60_000;

/**
 * One uniform draw in [WAKE_MIN_MS, WAKE_MAX_MS), whole milliseconds
 * (floor, never round — rounding could land ON the exclusive ceiling).
 * rng() === 0 pins the floor exactly; the loop logs the delay in minutes.
 */
export function sampleTickDelayMs(rng: RandomFn): number {
  return Math.floor(WAKE_MIN_MS + rng() * (WAKE_MAX_MS - WAKE_MIN_MS));
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
