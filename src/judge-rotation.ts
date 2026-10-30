/**
 * Account-pool rotation primitives for the LLM judge (F010): the cooldown
 * map state, the tagged exhaustion error, and the park helper — moved
 * verbatim from judge.ts. Behavior is unchanged; only module ownership and
 * visibility differ (the four helpers gain export).
 *
 * Model: an HTTP 429 is account-local. The account cools for a flat 60
 * seconds (first-write-wins) and every dispatch scans the pool from
 * account 1, skipping accounts that are still cooling — there is no sticky
 * pointer. When every account is cooling the caller parks through a shared
 * wait budget and, once the budget is spent, converts to the tagged
 * RotationExhausted error carrying a pool-ordered failure record.
 */
// Type-only import (D5): verbatimModuleSyntax erases it, so judge.ts can
// import this module's runtime symbols with no runtime cycle.
import type { LlmAccount, SleepFn } from "./judge.js";
import type { AccountFailure } from "./types.js";

/**
 * Flat cooldown for a rate-limited account. First-write-wins: while an
 * account is cooling, a second 429 never extends the window — a 429 costs
 * 60 seconds, not more. Unmeasured values stay constants.
 */
const COOLDOWN_MS = 60_000;

/**
 * Wake-time jitter. Workers parked on the same earliest expiry would wake
 * and re-dispatch in a thundering herd; a small constant spread smooths
 * that. Unmeasured value stays a constant.
 */
const WAKE_JITTER_MS = 500;

/**
 * Run-level rotation state, owned by judgePosts and shared by reference with
 * every worker — the same closure-shared mutable pattern as the `next` batch
 * cursor (read and advance with no await between). There is no sticky
 * pointer: every dispatch scans the pool from account 1 and skips accounts
 * that are still cooling, so a batch that starts after an account's cooldown
 * expires lands back on account 1.
 */
export interface RotationState {
  readonly accounts: readonly LlmAccount[];
  /** 0-based account index -> expiry reading from the injected `now`. */
  readonly cooldownUntil: Map<number, number>;
  /** Shared park budget: the total wait both judge phases may draw before
   *  the run converts to the exhaustion alarm. */
  waitBudgetRemainingMs: number;
}

/** Name tag for the pool-exhausted error; test with isRotationExhausted. */
export const ROTATION_EXHAUSTED = "RotationExhaustedError";

/** The tagged error judgePosts throws when every LLM_ACCOUNTS entry failed. */
export interface RotationExhausted extends Error {
  name: typeof ROTATION_EXHAUSTED;
  /** One entry per account that failed, in the order rotation left them. */
  failures: AccountFailure[];
}

/** Build a pool-exhausted error carrying the per-account record. */
export function rotationExhausted(failures: readonly AccountFailure[]): RotationExhausted {
  const error = new Error(
    `judge: all ${failures.length} LLM_ACCOUNTS account(s) exhausted — ${failures
      .map((f) => `account ${f.account} (${f.baseUrl}): ${f.reason}`)
      .join("; ")}`,
  ) as RotationExhausted;
  error.name = ROTATION_EXHAUSTED;
  error.failures = [...failures];
  return error;
}

/** Type guard for the pool-exhausted error (this codebase has no classes). */
export function isRotationExhausted(error: unknown): error is RotationExhausted {
  return error instanceof Error && error.name === ROTATION_EXHAUSTED;
}

/**
 * First dispatchable account, scanning the pool in order from account 1 —
 * the batch-local cursor. A missing or expired entry makes an account
 * dispatchable; an active cooldown (expiry > now) skips it. Synchronous and
 * pre-await: the caller dispatches inside the same sync window as the old
 * pointer read.
 */
export function pickEligibleAccount(
  state: RotationState,
  nowMs: number,
): { index: number; account: LlmAccount } | undefined {
  for (const [index, account] of state.accounts.entries()) {
    const expiry = state.cooldownUntil.get(index);
    if (expiry === undefined || expiry <= nowMs) {
      return { index, account };
    }
  }
  return undefined;
}

/**
 * Stamp a rate-limited account as cooling until now + COOLDOWN_MS.
 * First-write-wins: an account that is ALREADY cooling keeps its earlier
 * expiry, so a burst of concurrent 429s dedups to one window and cannot
 * extend it. An expired entry re-stamps cleanly (it is no longer cooling).
 */
export function coolAccount(state: RotationState, accountIndex: number, nowMs: number): void {
  const existing = state.cooldownUntil.get(accountIndex);
  if (existing === undefined || existing <= nowMs) {
    state.cooldownUntil.set(accountIndex, nowMs + COOLDOWN_MS);
  }
}

/**
 * Build the exhaustion record from the cooldown map, in pool order — one
 * AccountFailure per cooldown-map entry, 1-based `account` per src/types.ts.
 * Entry existence (not current expiry) is the criterion: a map entry proves
 * the account was rate-limited THIS run, and drain-then-throw can outlive a
 * 60s window, so a freshness filter could shrink or empty the record and
 * revive the empty-record email-silent path in src/email.ts. Throw sites
 * fire only when the pick found nothing — every account carries an entry —
 * so the record is non-empty by construction.
 */
export function failuresFromCooldowns(state: RotationState): AccountFailure[] {
  const failures: AccountFailure[] = [];
  for (const [index, account] of state.accounts.entries()) {
    if (state.cooldownUntil.has(index)) {
      failures.push({ account: index + 1, baseUrl: account.baseUrl, reason: "HTTP 429" });
    }
  }
  return failures;
}

/**
 * Wait until the earliest cooldown expiry (plus jitter), charging the
 * shared wait budget. Returns true when the park ran and the caller may
 * re-pick; false when the budget is already spent — the caller converts
 * to its terminal outcome. Never throws: the park runs at the loop top,
 * OUTSIDE the try, so a wait can never be misrouted through a catch.
 *
 * Charge-before-sleep: the full pessimistic wait comes off the budget
 * up front, so peers parking concurrently see the remaining budget, not
 * a stale one. After the wake only the OVERSHOOT (actual elapsed beyond
 * the charge — scheduling delay) is deducted further; an undershoot is
 * not refunded. The cell clamps at zero and the next park refuses.
 */
export async function parkUntilEligible(
  state: RotationState,
  now: () => number,
  sleepFn: SleepFn,
): Promise<boolean> {
  if (state.waitBudgetRemainingMs <= 0) {
    return false;
  }
  const startedAt = now();
  // Called only when the pick found nothing, so the map is non-empty.
  let earliest = Number.POSITIVE_INFINITY;
  for (const expiry of state.cooldownUntil.values()) {
    if (expiry < earliest) {
      earliest = expiry;
    }
  }
  const waitMs = Math.max(0, earliest + WAKE_JITTER_MS - startedAt);
  const charge = Math.min(waitMs, state.waitBudgetRemainingMs);
  state.waitBudgetRemainingMs -= charge;
  await sleepFn(charge);
  const elapsed = now() - startedAt;
  const overspend = Math.max(0, elapsed - charge);
  state.waitBudgetRemainingMs = Math.max(0, state.waitBudgetRemainingMs - overspend);
  return true;
}
