/**
 * The judge's shared wire vocabulary (N060): the two URL/reason helpers, the
 * six dispatch types, the availability predicate, and the exhaustion record —
 * moved verbatim out of judge-dispatch.ts. Behavior is unchanged; only module
 * ownership differs.
 *
 * The seam pair (sleep/SleepFn) does NOT live here: it is cross-domain
 * (fetch-threads.ts and src/index.ts import it), so it moved to src/sleep.ts.
 * judge-rotation.ts keeps its ZERO-RUNTIME-IMPORT identity — nothing here is
 * imported by rotation; the one-way runtime edges run into rotation (the
 * blocked-pick policy in judge-exhaustion.ts composes rotation primitives).
 */
import { HARD_FAIL_TICKS_TO_CAP, buildFailuresFromLedger } from "./judge-health.js";
import type { RotationState } from "./judge-rotation.js";
import type { AccountFailure, JudgeVerdict } from "./types.js";

/**
 * Chat-completions URL from a base URL, tolerating a full endpoint.
 * Exported (F006 drift-proofing precedent): the availability pre-check
 * (src/judge-availability.ts) probes the exact production URL shape
 * instead of a hand-copy that has already drifted from it.
 */
export function normalizeEndpoint(baseUrl: string): string {
  return baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * The real-cause string a terminal non-ok status stamps on the ledger.
 * 401/403 mean the key is dead — the alarm should say so, not just the
 * status code. Exported so the availability pre-check renders the SAME
 * reason vocabulary verbatim, keeping the exhaustion message and email
 * composable with zero translation.
 */
export function terminalFailureReason(status: number): string {
  return status === 401 || status === 403 ? `HTTP ${status} — key dead` : `HTTP ${status}`;
}

/**
 * True when the pick found nothing BECAUSE every seat is permanently dead
 * this tick: the availability pre-check refused it (the blocked mask — a
 * refused seat never dispatches, so no release can ever come from it), or
 * the health circuit blocked it (capped, probe spent and drained). With
 * an empty mask this is exactly the pre-mask health predicate — the
 * no-mask behavior is unchanged — and with a mask it is the D11 guard: an
 * all-blocked (or blocked-plus-health-dead) pool exhausts immediately at
 * zero budget charge instead of parking forever on the timerless
 * waitCeilingSlot. An uncapped seat always makes progress on a release,
 * so it can never permanently block the pool — this is what keeps the
 * zero-charge ceiling wait alive for a healthy saturated pool. No
 * cooldown is active at the call site (the flavor split checks that
 * first). Plain field reads; inline by design (judge-rotation owns no
 * mask or health concept — the boundary).
 */
export function allAvailabilityBlocked(state: RotationState): boolean {
  return state.accounts.every((_, index) => {
    if (state.blocked.has(index)) return true;
    const capped = (state.healthMarks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP;
    if (!capped) return false;
    return state.probedThisTick.has(index) && (state.inFlight.get(index) ?? 0) === 0;
  });
}

/**
 * Result of one bulk call: a parsed container, no usable answer, or a pool
 * exhausted mid-batch (every account rate-limited; judgePosts throws).
 */
export type BatchOutcome =
  | { status: "answered"; verdicts: Map<string, JudgeVerdict> }
  | { status: "unanswered" }
  | { status: "exhausted" };

/**
 * Decision a wrapper's content handler returns for one attempt's answer:
 * accept the value (resolve — the call is answered), spend another attempt
 * (retry), or end the call unanswered (defer).
 */
export type ContentDecision<T> =
  | { action: "resolve"; value: T; countsSuccess: boolean }
  | { action: "retry" }
  | { action: "defer" };
// countsSuccess marks a genuine model answer: a parse-miss resolve counts
// NEITHER success nor failure — a model failure is not an account outcome
// (the research's non-health boundary).

/**
 * Outcome of one dispatched LLM call. The all-cooling terminal is RETURNED
 * (D6), never thrown inside the core: both catches below are total
 * transport converters, so a throw would be swallowed (a batch would skip
 * silently; a post would burn an attempt on a dead pool). The wrapper maps
 * "exhausted" to its own terminal — outside any try the core owns.
 */
export type DispatchOutcome<T> =
  | { status: "answered"; value: T }
  | { status: "unanswered" }
  | { status: "exhausted" }
  | { status: "attemptsExhausted" };

/**
 * One attempt's decision, returned from inside the release-guarded try so
 * the finally frees the slot BEFORE the loop acts (D7: the ceiling counts
 * HTTP requests in flight, not backoff waits — the 5xx sleep and the 429
 * rewind both run with the slot released). "rewind" re-picks WITHOUT
 * spending an attempt (a 429 cooled the account); "retry" spends one
 * (the post ladder's non-retryable status, its transport error, and its
 * content retry); "backoff" sleeps delayMs after the release, then
 * retries the same account.
 */
export type AttemptDirective<T> =
  | { action: "answered"; value: T }
  | { action: "defer" }
  | { action: "rewind" }
  | { action: "backoff"; delayMs: number }
  | { action: "retry" };

/**
 * The dispatcher's warn events. Strings are wrapper-owned (D2: byte-exact
 * operator-log compatibility); the core owns only WHEN each fires.
 * accountNo and attemptNo are 1-based display numbers.
 */
export interface DispatchWarns {
  /** A 429 cooled the account; the retry re-picks past every cooling one. */
  cooling: (accountNo: number) => void;
  /** 5xx backoff on the SAME account — called only when backoff5xx is set. */
  backingOff?: (accountNo: number, status: number, delayMs: number, attemptNo: number) => void;
  /** A non-429 HTTP status the call will not back off on. */
  statusFailure: (accountNo: number, attemptNo: number, status: number, statusText: string) => void;
  /** A transport error (dead socket, timeout, unparsable body). */
  transportError: (accountNo: number, attemptNo: number, message: string) => void;
}

/**
 * The exhaustion record, in pool order, from three sources: the ledger's
 * real causes first (cooling-only accounts carry "HTTP 429" inside
 * buildFailuresFromLedger), then any availability-refused seat — its
 * probe ran before the tick began, the refusal is the freshest evidence,
 * and the seat never dispatched, so the ledger cannot explain it — then
 * any capped account neither source explained (a probe that answered
 * unusably stamps nothing, but the alarm must still name the account).
 * Non-empty at every throw site by construction: every arm fires only on
 * seats the earlier sources did not list (src/email.ts:181-182 renders
 * null on an empty record while exit 1 still fires — the exact
 * silent-alarm this prevents).
 */
export function exhaustionRecord(state: RotationState): AccountFailure[] {
  const record = buildFailuresFromLedger(state);
  const listed = new Set(record.map((failure) => failure.account));
  for (const [index, account] of state.accounts.entries()) {
    const reason = state.blocked.get(index);
    if (reason !== undefined && !listed.has(index + 1)) {
      record.push({ account: index + 1, baseUrl: account.baseUrl, reason });
      listed.add(index + 1);
    }
  }
  for (const [index, account] of state.accounts.entries()) {
    const capped = (state.healthMarks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP;
    if (capped && !listed.has(index + 1)) {
      record.push({
        account: index + 1,
        baseUrl: account.baseUrl,
        reason: "capped by provider health",
      });
      listed.add(index + 1);
    }
  }
  // Pool order across ALL sources: the ledger walk is already in pool
  // order, but the appendices land after it — the stable sort
  // re-establishes the pool-ordered record buildFailuresFromLedger's doc
  // promises (the old cooldown-map builder guaranteed the same).
  record.sort((a, b) => a.account - b.account);
  return record;
}
