/**
 * Behavioral policy machines for the PC-local LinkedIn leg (the
 * anti-restriction profile, design 2026-11-09): the working-hours window,
 * the jittered wake cadence, the daily GET budget, and the halt-latch
 * reason vocabulary.
 *
 * Extraction idiom (src/judge-rotation.ts:5-7): pure machines + constants
 * live here; IO and policy placement stay at the consumer
 * (scripts/fetch-linkedin.ts wires the preflight band and the budget
 * wrapper, scripts/watch-linkedin.ts wires the loop cadence). The module
 * is IO-free: dates, rng draws, and persisted state arrive as arguments,
 * so the offline suite pins every edge with zero doubles.
 *
 * Worst-case arithmetic (the account-safety invariant): the window is 13
 * hours = 780 minutes; at the 28-minute floor that is at most 28 wake-ups
 * x 5 surfaces x 1 page = 140 voyager GETs per local day — under the 150
 * daily budget (FR-9). Both bounds live here so the invariant reads in
 * one place.
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
 * The hard daily GET budget (FR-9), in code: 150 voyager GETs per LOCAL
 * day across all surfaces. Worst-case walk arithmetic (28 wake-ups x 5
 * surfaces) stays under it; the budget exists so a mis-configured future
 * cannot silently multiply the volume.
 */
export const DAILY_GET_BUDGET = 150;

/**
 * The budget machine's persisted shape — the whole content of
 * state/linkedin-get-budget.json (untracked, PC-local, same discipline as
 * the leg-dead marker: repo-local, persistent, never committed).
 */
export interface DailyBudgetState {
  /** LOCAL "YYYY-MM-DD" the count belongs to; a different key is a new day. */
  readonly localDate: string;
  /** GETs reserved so far on that local date. */
  readonly count: number;
}

/** The absent-file state: nothing reserved, no day attached. */
export function freshBudget(): DailyBudgetState {
  return { localDate: "", count: 0 };
}

/**
 * The LOCAL calendar key for `at` — "YYYY-MM-DD" in the machine's local
 * zone. Never toISOString(): that is UTC and would roll the day at 07:00
 * local in UTC+7. Two-digit padding keeps keys comparable as strings.
 */
export function localDateKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * True when one more GET fits under `limit` on local date `key`. A state
 * stamped for a PREVIOUS day (or the fresh state) is always allowed — the
 * new day's first reserve starts a fresh count, so there is no explicit
 * reset step and local midnight rolls the budget for free (FR-9).
 */
export function budgetAllows(
  state: DailyBudgetState,
  key: string,
  limit: number = DAILY_GET_BUDGET,
): boolean {
  if (state.localDate !== key) return true;
  return state.count < limit;
}

/**
 * Reserve ONE GET on local date `key`, returning the NEXT state — pure,
 * no mutation of the caller's object. The wrapper pairs budgetAllows +
 * budgetReserve inside ONE synchronous window (no await between) and
 * persists the result BEFORE the GET leaves: a crash between reserve and
 * GET over-counts, the safe direction (under-fetch, never over).
 */
export function budgetReserve(state: DailyBudgetState, key: string): DailyBudgetState {
  const base = state.localDate === key ? state.count : 0;
  return { localDate: key, count: base + 1 };
}

/**
 * Canonical reason string a 429 writes into the halt-latch flag and its
 * alarm (FR-7). One constant, two readers (flag content, email body), so
 * the latch file's content always explains itself.
 */
export const HALT_RATE_LIMIT_REASON =
  "HTTP 429 rate limit — LinkedIn told this account to slow down";

/**
 * Canonical reason string a spent daily budget writes into the halt-latch
 * flag and its alarm (FR-7).
 */
export const HALT_BUDGET_REASON =
  "daily GET budget spent — fetching halts until the latch is cleared";
