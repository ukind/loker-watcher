/**
 * Account-pool rotation primitives for the LLM judge (F010): the cooldown
 * map state, the tagged exhaustion error, and the park helper — moved
 * verbatim from judge.ts. Behavior is unchanged; only module ownership and
 * visibility differ (the helpers gain export).
 *
 * Cooldown model: an HTTP 429 is account-local. The account cools for a
 * flat 60 seconds (first-write-wins) and every dispatch skips accounts
 * that are still cooling — there is no sticky pointer. When every account
 * is cooling the caller parks through a shared wait budget and, once the
 * budget is spent, converts to the tagged RotationExhausted error carrying
 * a pool-ordered failure record.
 *
 * Spread model (D1/D6): the pick starts at the dispatch dial
 * (dispatchCounter % pool size) and skips cooling AND at-ceiling accounts,
 * so consecutive claims land on consecutive accounts — the first N
 * dispatches of a run hit N distinct hosts up to the pool's ceilings. A
 * claim moves the dial just past the claimed account; an undefined pick
 * never moves it. A pick blocked while a release is outstanding (some
 * account still has calls in flight) parks its dispatcher on the
 * release-waiter queue at ZERO budget charge: the shared park budget and
 * the exhaustion alarm stay exclusive to quiet-pool cooldown parks
 * (D4). A fresh cooldown stamp also wakes the queue — it shrinks effective
 * capacity — while a first-write-wins re-stamp changes nothing and wakes
 * nobody.
 *
 * Health circuit (the provider-health boundary): the state carries the
 * health marks, the per-tick probe ledger, and the outcome ledger as plain
 * fields — the outcome shape is a plain inline union structurally equal to
 * the judge-health module's AccountTickOutcome, and NO import of that
 * module exists, keeping this module's zero-runtime-import identity. The
 * pick applies the cap and the half-open probe INLINE as plain field
 * reads; the cap threshold pairs with that module's
 * HARD_FAIL_TICKS_TO_CAP via the local HEALTH_CAP_STREAK constant (the
 * two MUST stay equal).
 */
// Type-only imports (D5): verbatimModuleSyntax erases them, so judge.ts and
// judge-dispatch.ts can import this module's runtime symbols with no runtime
// cycle. SleepFn moved to judge-dispatch.ts with judgePost (N042a) — the
// default `sleepFn: SleepFn = sleep` lives there now.
import type { TickOutcomes } from "./judge-health.js";
import type { LlmAccount } from "./judge.js";
import type { SleepFn } from "./sleep.js";
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
 * Consecutive hard-failed ticks that cap an account at ceiling 1 — the
 * paired twin of the judge-health module's HARD_FAIL_TICKS_TO_CAP (no
 * import exists: this module reads plain state fields only, the D5
 * boundary). The two MUST stay equal; both doc sites say so.
 */
const HEALTH_CAP_STREAK = 2;

/**
 * Run-level rotation state, owned by judgePosts and shared by reference with
 * every worker — the same closure-shared mutable pattern as the `next` batch
 * cursor (read and advance with no await between). There is no sticky
 * pointer: every dispatch scans FROM the dispatch dial (dispatchCounter %
 * poolSize), skipping accounts that are cooling, blocked, OR at their
 * in-flight ceiling; a claim moves the dial just past the claimed
 * account, so consecutive dispatches land on consecutive hosts.
 */
export interface RotationState {
  readonly accounts: readonly LlmAccount[];
  /** 0-based account index -> expiry reading from the injected `now`. */
  readonly cooldownUntil: Map<number, number>;
  /** 0-based account index -> probe-measured in-flight ceiling (>= 1;
   *  resolveCeilings floors every pool account at 1). Read-only here —
   *  writing the file is the probe's job, the run only enforces. */
  readonly ceilings: ReadonlyMap<number, number>;
  /** 0-based account index -> the availability pre-check's refusal
   *  reason for this run (the blocked-index mask). Set once when the
   *  state is built and never mutated in-run: a refused account sits
   *  out the WHOLE tick, unlike a cooldown that expires mid-run. The
   *  value carries the real cause in the judge's own vocabulary, so
   *  the exhaustion record and the email compose it with zero
   *  translation. An empty map is the no-mask normal: every account
   *  available. */
  readonly blocked: ReadonlyMap<number, string>;
  /** 0-based account index -> dispatched-and-unfinished calls. A claim
   *  increments before the request leaves; the attempt's finally releases,
   *  so every exit path frees its slot exactly once. */
  readonly inFlight: Map<number, number>;
  /** 0-based account index -> hard-failed streak, seeded by index.ts from
   *  the health file. MUTABLE in-run: a successful probe DELETES the entry
   *  so the account rejoins at its committed ceiling for the rest of the
   *  tick (the judge-health stampSuccess helper). The pick reads it here;
   *  only the end-of-tick flush writes the FILE. */
  readonly healthMarks: Map<number, number>;
  /** Accounts already probe-dispatched this tick (the half-open gate):
   *  a capped account is dispatchable until its first claim registers it
   *  here, then blocked until a success frees it. Resets naturally per
   *  judgePosts call — one tick. */
  readonly probedThisTick: Set<number>;
  /** 0-based account index -> the account's LAST dispatch outcome this
   *  tick. The judge core stamps hard failures with their real cause and
   *  successes (the judge-health stamp helpers, Phase 4 call sites); the
   *  unified exhaustion record and the end-of-tick flush derive from it.
   *  Plain union — structurally the judge-health AccountTickOutcome. */
  readonly outcomeLedger: Map<number, { kind: "ok" } | { kind: "hard-failed"; reason: string }>;
  /** Dispatch dial: the pick scans from dispatchCounter % poolSize; a
   *  claim moves it just past the claimed account (D6: an undefined pick
   *  never moves it). Zero starts the run at account 1. */
  dispatchCounter: number;
  /** Resolve fns of dispatches parked on an all-at-ceiling pick. The next
   *  release (or a fresh cool-down) resolves every waiter; each re-picks
   *  and the losers re-park — zero budget charge (D4). */
  readonly ceilingWaiters: Array<() => void>;
  /** Shared park budget: the total wait both judge phases may draw before
   *  the run converts to the exhaustion alarm. */
  waitBudgetRemainingMs: number;
}

/** Name tag for the pool-exhausted error; test with isRotationExhausted. */
const ROTATION_EXHAUSTED = "RotationExhaustedError";

/** The tagged error judgePosts throws when every LLM_ACCOUNTS entry failed. */
export interface RotationExhausted extends Error {
  name: typeof ROTATION_EXHAUSTED;
  /** One entry per account that failed, in the order rotation left them. */
  failures: AccountFailure[];
  /** The tick's per-account outcomes — the health flush rides the error to
   *  main's catch. Absent when the error was built without one (standalone
   *  judgePost exhaustion; tests constructing the type bare). */
  health?: TickOutcomes;
}

/** Build a pool-exhausted error carrying the per-account record. With
 *  poolSize the message is pool-truthful — "X of N LLM_ACCOUNTS accounts
 *  failed" (X can sit under N: a seat that was merely saturated or still
 *  healthy when the budget died never enters the record). Without it the
 *  legacy "all X" form stands — bare test-constructed errors keep
 *  today's wording. */
export function rotationExhausted(
  failures: readonly AccountFailure[],
  health?: TickOutcomes,
  poolSize?: number,
): RotationExhausted {
  const detail = failures.map((f) => `account ${f.account} (${f.baseUrl}): ${f.reason}`).join("; ");
  const summary =
    poolSize === undefined
      ? `judge: all ${failures.length} LLM_ACCOUNTS account(s) exhausted`
      : `judge: ${failures.length} of ${poolSize} LLM_ACCOUNTS accounts failed`;
  const error = new Error(`${summary} — ${detail}`) as RotationExhausted;
  error.name = ROTATION_EXHAUSTED;
  error.failures = [...failures];
  if (health !== undefined) {
    error.health = health;
  }
  return error;
}

/** Type guard for the pool-exhausted error (this codebase has no classes). */
export function isRotationExhausted(error: unknown): error is RotationExhausted {
  return error instanceof Error && error.name === ROTATION_EXHAUSTED;
}

/**
 * First dispatchable account, scanning FROM the dispatch dial —
 * dispatchCounter % pool size — wrapping the pool once. The proactive
 * spread: consecutive claims land on consecutive accounts, so the first
 * N dispatches of a run hit N distinct hosts. An account is dispatchable
 * when it is neither cooling (expiry > nowMs), blocked (the
 * availability pre-check's refusal), nor at its in-flight ceiling.
 * Synchronous and pre-await: the caller claims inside the same sync
 * window as this read. The pick NEVER advances the dial (D6) —
 * claimAccount does, and only for a fresh claim.
 *
 * startAt pins the scan's FIRST seat (the same-account 5xx retry): a
 * start hint, not a guarantee — a cooling, blocked, or at-ceiling
 * pinned seat is skipped like any other, and an undefined pick still
 * leaves the dial untouched.
 */
export function pickEligibleAccount(
  state: RotationState,
  nowMs: number,
  startAt?: number,
): { index: number; account: LlmAccount } | undefined {
  const poolSize = state.accounts.length;
  const start = startAt ?? state.dispatchCounter % poolSize;
  for (let offset = 0; offset < poolSize; offset += 1) {
    const index = (start + offset) % poolSize;
    const account = state.accounts[index];
    if (account === undefined) continue;
    const expiry = state.cooldownUntil.get(index);
    if (expiry !== undefined && expiry > nowMs) continue;
    // The blocked-index mask: a seat the availability pre-check refused
    // sits out the whole run. Ahead of the health circuit on purpose —
    // the probe is a dispatch, and a refused seat must not dispatch.
    if (state.blocked.has(index)) continue;
    // Health circuit, INLINE plain-field reads (no judge-health import):
    // a capped account runs at effective ceiling 1 and is half-open — its
    // first dispatch of the tick is the probe; further picks stay blocked
    // until a success frees it (stampSuccess deletes the mark AND the
    // probe slot, rejoining at the COMMITTED ceiling).
    const capped = (state.healthMarks.get(index) ?? 0) >= HEALTH_CAP_STREAK;
    if (capped && state.probedThisTick.has(index)) continue;
    const ceiling = capped ? 1 : (state.ceilings.get(index) ?? 1);
    if ((state.inFlight.get(index) ?? 0) >= ceiling) continue;
    return { index, account };
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
    // D4: a fresh 429 shrinks effective capacity — parked ceiling waiters
    // re-pick against the new landscape and re-route into the budget park
    // when a cooldown now blocks them. An already-cooling account changes
    // nothing (first-write-wins), so it wakes nobody.
    wakeCeilingWaiters(state);
  }
}

/**
 * Resolve every parked ceiling waiter: a release or a fresh cool-down
 * changed the pick landscape. Wake is a re-pick OPPORTUNITY, not a
 * guaranteed slot — the losers re-park through waitCeilingSlot. Private:
 * wake sites are exactly releaseAccount and coolAccount's fresh stamp.
 */
function wakeCeilingWaiters(state: RotationState): void {
  const waiters = state.ceilingWaiters.splice(0);
  for (const resolve of waiters) resolve();
}

/**
 * Claim a picked account in the caller's sync window: the in-flight count
 * rises BEFORE the request leaves, and the dial moves just past this
 * account so the next scan starts on the next seat (the spread). Pair
 * every claim with a releaseAccount in a finally — the release gate is
 * what keeps the counts honest across every exit path (D7).
 */
export function claimAccount(state: RotationState, accountIndex: number): void {
  const current = state.inFlight.get(accountIndex) ?? 0;
  state.inFlight.set(accountIndex, current + 1);
  state.dispatchCounter = accountIndex + 1;
  // The half-open probe ledger: a capped account's dispatch IS its probe
  // for this tick. Registered at claim time in the same sync window as
  // the pick; a later success deletes the entry, freeing the rest of the
  // tick at the committed ceiling (the judge-health stampSuccess).
  if ((state.healthMarks.get(accountIndex) ?? 0) >= HEALTH_CAP_STREAK) {
    state.probedThisTick.add(accountIndex);
  }
}

/**
 * Release a claimed account: the in-flight count falls and every ceiling
 * waiter wakes to re-pick the freed landscape. The clamp keeps a
 * bookkeeping bug from driving the count negative; it must stay a clamp —
 * release runs in a finally, where a throw would replace the caller's
 * original error.
 */
export function releaseAccount(state: RotationState, accountIndex: number): void {
  const current = state.inFlight.get(accountIndex) ?? 0;
  state.inFlight.set(accountIndex, Math.max(0, current - 1));
  wakeCeilingWaiters(state);
}

/**
 * Park one dispatch until the next release (or fresh cool-down) changes
 * the pick landscape. ZERO budget charge: an all-at-ceiling pick has no
 * expiry to wait on, so this wait never draws the shared park budget and
 * can never convert to the exhaustion alarm (D4). The caller registers
 * inside the same sync window as the pick-undefined observation — the
 * push lands before the first await, so no release can slip past
 * unobserved. Steady state is safe: the caller parks only while a release
 * is outstanding (in-flight somewhere), and every claim's
 * release wakes the queue, so the wait resolves on real network events —
 * no timer, no polling.
 */
export function waitCeilingSlot(state: RotationState): Promise<void> {
  return new Promise((resolve) => {
    state.ceilingWaiters.push(resolve);
  });
}

/**
 * Earliest ACTIVE cooldown expiry (> nowMs), or undefined when nothing is
 * cooling — the caller's flavor split for an undefined pick on a quiet
 * pool (D4): an expiry here means park on the shared budget (the cooldown path, the
 * only road to the exhaustion terminal); no expiry means every account is
 * merely at its ceiling (the zero-charge ceiling wait). parkUntilEligible
 * reads the same computation.
 */
export function earliestCooldown(state: RotationState, nowMs: number): number | undefined {
  let earliest: number | undefined;
  for (const expiry of state.cooldownUntil.values()) {
    if (expiry <= nowMs) continue;
    if (earliest === undefined || expiry < earliest) {
      earliest = expiry;
    }
  }
  return earliest;
}

/**
 * True when any account has dispatched-and-unfinished calls. Every claim's
 * finally releases — and every fresh cooldown stamp wakes the queue — so a
 * true reading guarantees the release-waiter queue a wake: the flavor
 * split may park a dispatcher on waitCeilingSlot at zero budget charge
 * instead of drawing the shared cooldown budget. Plain field reads;
 * synchronous; the boundary twin of allAvailabilityBlocked's idle check.
 */
export function hasOutstandingRelease(state: RotationState): boolean {
  for (const count of state.inFlight.values()) {
    if (count > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Wait until the earliest ACTIVE cooldown expiry (plus jitter), charging
 * the shared wait budget. Returns true when the park ran and the caller
 * may re-pick; false when the budget is already spent (or, typed-only,
 * when no cooldown is active — the caller's flavor split makes that
 * unreachable). Never throws: the park runs at the loop top, OUTSIDE the
 * try, so a wait can never be misrouted through a catch.
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
  // The caller parks only on an undefined pick WITH an active cooldown
  // and a quiet pool (no release outstanding), so earliest is defined at
  // this point; the typed fallback keeps the
  // function total — it reads as a spent budget, the conservative terminal.
  const earliest = earliestCooldown(state, startedAt);
  if (earliest === undefined) {
    return false;
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
