/**
 * Account availability pre-check (FR1/FR2): one tiny chat-completions
 * call per LLM_ACCOUNTS account, all in parallel, before any judge
 * batch. The signal is answerability — any non-empty message content
 * passes; every other outcome (429, terminal status, transport throw,
 * timeout, unusable answer) marks that account unavailable for the run
 * as an AccountFailure carrying the judge's own reason vocabulary, so
 * the exhaustion message and email compose the causes with zero
 * translation.
 *
 * The check owns NO rotation: no RotationState, no pick, no cooldown,
 * no retry ladder, no health writes — one parallel one-shot per
 * account with a hard per-account abort. It NEVER throws (the degrade
 * doctrine, the loadAccountCeilings/loadAccountHealth family): a fault
 * before dispatch begins degrades to "all accounts available" with a
 * `degraded: true` flag and exactly one warning naming the cause, and
 * the run proceeds unfiltered. A per-account fault after dispatch IS
 * the signal and becomes that account's failure reason, never a
 * degrade.
 *
 * Import surface: the two wire helpers are runtime imports —
 * src/judge-dispatch.ts exports them for exactly this caller (the F006
 * buildBulkMessages drift-proofing precedent), no cycle exists (the
 * dispatch module never imports this one), and both are pure functions.
 * Everything else is type-only.
 */
import { normalizeEndpoint, terminalFailureReason } from "./judge-dispatch.js";
import type { LlmAccount } from "./judge.js";
import type { AccountFailure } from "./types.js";

/**
 * Hard per-account abort for the tiny probe — the module's own
 * constant. The judge's 60s REQUEST_TIMEOUT_MS is a measured
 * batch-latency contract (src/judge.ts:73-78) the pre-check must not
 * couple to; ~10s bounds the whole stage's wall clock, because every
 * account is probed in parallel.
 */
const AVAILABILITY_TIMEOUT_MS = 10_000;

/**
 * The probe payload's messages: the smallest request that proves the
 * endpoint can answer. The payload itself carries NO response_format —
 * that rider is bulk-path-only (src/judge.ts:680-682) — and NO
 * reasoning_effort: the signal is answerability, and forcing a
 * reasoning model to think spends latency inside the abort.
 * temperature: 0 mirrors both judge payloads.
 */
const PROBE_MESSAGES: Array<{ role: string; content: string }> = [
  { role: "user", content: "Reply with the single word: ok." },
];

/** Result of the availability pre-check for one account pool. */
export interface AvailabilityResult {
  /** One entry per refused account, pool order, 1-based numbers. */
  readonly failures: readonly AccountFailure[];
  /**
   * True when the check itself faulted and the run proceeds UNFILTERED
   * (all-available degrade). False means the per-account verdicts are
   * trustworthy.
   */
  readonly degraded: boolean;
}

/**
 * Probe every account once, in parallel. Never throws.
 *
 * Two-layer contract: anything after the first dispatch begins is
 * per-account DATA — a fetch rejection, a non-ok status, an unparsable
 * or empty answer each become that account's failure reason (Layer 1).
 * Anything before it is a checker FAULT — the wrapper degrades to
 * all-available with `degraded: true` and one console.warn naming the
 * cause verbatim (Layer 2). Promise.allSettled never rejects, so the
 * wrapper catch fires only for module-code faults around the
 * orchestration; a hostile fetchFn that throws still lands per-account
 * (the throw happens inside the probe's async body).
 */
export async function checkJudgeAvailability(
  accounts: readonly LlmAccount[],
  fetchFn: typeof fetch = fetch,
): Promise<AvailabilityResult> {
  try {
    const settled = await Promise.allSettled(
      accounts.map((account) => probeAccount(account, fetchFn)),
    );
    const failures: AccountFailure[] = [];
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") continue;
      const account = accounts[index];
      if (account === undefined) continue; // settled mirrors accounts — unreachable
      failures.push({
        account: index + 1,
        baseUrl: account.baseUrl,
        reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    }
    return { failures, degraded: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`availability: pre-check faulted — running unfiltered (${message})`);
    return { failures: [], degraded: true };
  }
}

/**
 * One tiny chat-completions probe. Resolves when the account answered
 * with any non-empty message content; rejects with the account's
 * failure reason as the error message, in the judge's vocabulary:
 * "HTTP 429" / "HTTP 401 — key dead" (terminalFailureReason),
 * "network error: <message>" (transport and timeout), and
 * "unusable answer: <message>" (a 200 whose body or content cannot
 * serve as an answer).
 */
async function probeAccount(account: LlmAccount, fetchFn: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchFn(normalizeEndpoint(account.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify({
        model: account.model,
        messages: PROBE_MESSAGES,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`network error: ${message}`);
  }
  if (!response.ok) {
    throw new Error(terminalFailureReason(response.status));
  }
  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unusable answer: ${message}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("unusable answer: missing message content");
  }
}
