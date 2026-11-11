/**
 * Behavioral policy machines for the PC-local LinkedIn leg (the
 * anti-restriction profile, design 2026-11-09; the daily GET budget
 * machine deleted by the browser-walk migration 2026-11-11): the
 * working-hours window, the jittered wake cadence, and the halt-latch
 * reason vocabulary.
 *
 * Extraction idiom (src/judge-rotation.ts:5-7): pure machines + constants
 * live here; IO and policy placement stay at the consumer
 * (scripts/fetch-linkedin.ts wires the preflight band,
 * scripts/watch-linkedin.ts wires the loop cadence). The module is
 * IO-free: dates and rng draws arrive as arguments, so the offline suite
 * pins every edge with zero doubles.
 *
 * Worst-case arithmetic (the account-safety bound): the window is 13
 * hours = 780 minutes; at the 28-minute floor that is at most 28 wake-ups
 * per local day, and each wake walks at most 5 surfaces x (1 navigation
 * + scrollRounds Load-more clicks). The window lives here; the click cap
 * rides the walk (src/linkedin-fetch.ts).
 */

/**
 * Local hour the working window opens at (inclusive): Mon-Fri 08:00-21:00
 * local (FR-1). Unmeasured values stay constants.
 */
export const WINDOW_START_HOUR = 8;

/**
 * Local hour the working window closes at — EXCLUSIVE, so 21:00:00.000 is
 * already outside. The half-open [start, end) pair makes the 20:59/21:00
 * boundary unambiguous.
 */
export const WINDOW_END_HOUR = 21;

/**
 * True when `at` falls inside the working window: Monday-Friday, local
 * 08:00 <= time-of-day < 21:00. Every read is LOCAL — never UTC — so the
 * window tracks the operator's clock. The weekday guard uses getDay()
 * (0 = Sunday, 6 = Saturday); 1-5 is the Mon-Fri band. Boundary pins:
 * 07:59:59.999 false, 08:00:00.000 true, 20:59:59.999 true, 21:00:00.000
 * false.
 */
export function isWithinWorkingHours(at: Date): boolean {
  const day = at.getDay();
  if (day < 1 || day > 5) return false;
  const hour = at.getHours();
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

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
