/**
 * The judge's dispatch core (N042a + N060): the shared HTTP retry loop and
 * both wrappers. The shared vocabulary, the availability predicate, the
 * exhaustion record, and the blocked-pick policy live in judge-shared.ts and
 * judge-exhaustion.ts; the sleep seam lives in sleep.ts. Behavior unchanged.
 *
 * Every bulk verdict is validated per item. Items missing or malformed in
 * the bulk response fall back to the single-post judgePost (2 attempts).
 * HTTP 429 is account-local: the account cools for a flat 60 seconds
 * (first-write-wins — a 429 costs 60 seconds, not more) and every dispatch
 * starts at the dispatch dial — the next account after the last claim —
 * skipping accounts that are cooling or at their probe-measured in-flight
 * ceiling, so the first N dispatches of a run land on N distinct hosts.
 * An all-at-ceiling pick (nothing cooling) waits for the next release at
 * ZERO budget charge; only cooldown parks draw the shared 3-minute wait
 * budget and can convert to the exhaustion alarm. A 5xx is retried on the
 * same account with bounded backoff before the batch is deferred; a
 * transport error defers immediately without cooling anything.
 *
 * Cycle doctrine (the judge-rotation.ts:38-40 idiom): the ONE import from
 * ./judge.js is type-only, erased by verbatimModuleSyntax. judge.ts imports
 * this module's runtime symbols, so a runtime edge back would close a real
 * cycle. judgePost defaults sleepFn to sleep from ./sleep.js (N060).
 */
import type { ReasoningEffort } from "./config-file.js";
import { resolveBlockedPick } from "./judge-exhaustion.js";
import { stampFailure, stampSuccess } from "./judge-health.js";
import { parseBulkVerdicts, parseVerdict } from "./judge-parse.js";
import { buildBulkMessages, buildMessages } from "./judge-prompts.js";
import {
  type RotationState,
  claimAccount,
  coolAccount,
  pickEligibleAccount,
  releaseAccount,
  rotationExhausted,
} from "./judge-rotation.js";
import {
  type AttemptDirective,
  type BatchOutcome,
  type ContentDecision,
  type DispatchOutcome,
  type DispatchWarns,
  allAvailabilityBlocked,
  exhaustionRecord,
  normalizeEndpoint,
  terminalFailureReason,
} from "./judge-shared.js";
// Type-only back-edge (the judge-rotation.ts:38-40 idiom): verbatimModuleSyntax
// erases it, so judge.ts can import this module's runtime symbols with no
// runtime cycle. LlmAccount stays in judge.ts — moving it would create
// type-only back-edges from three LEAF modules into the FUNNEL group.
import type { LlmAccount } from "./judge.js";
import { type SleepFn, sleep } from "./sleep.js";
import type { JudgeVerdict, Post } from "./types.js";
/**
 * Per-request timeout. 15s was never validated from a GitHub runner: run
 * 40264368939 timed out every batch and every fallback call at exactly
 * 15.0s. Phase 0 measures the real latency from the runner and confirms
 * this value.
 */
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * HTTP statuses worth retrying on the SAME account: the endpoint is alive
 * but busy. 429 is handled separately — it is account-local and rotates to
 * the next account instead of waiting.
 */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
/** Bounded backoff for a retryable status. Total added latency: 7s. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
/**
 * The shared HTTP retry loop behind judgeBatch and judgePost (F008).
 * Per attempt, in order: pool scan at the loop top BEFORE the first await
 * (starting at the dispatch dial — or the pinned 5xx seat — skipping
 * cooling AND at-ceiling accounts); on an undefined pick, split the two
 * blocked flavors (D4) — an active cooldown parks through the shared
 * budget (a spent budget returns "exhausted" at the loop top, OUTSIDE the
 * try — D6), and an all-at-ceiling pick waits on the release queue at
 * ZERO budget charge; then claim in the same sync window as the pick and
 * run the attempt inside a release-guarded try (the finally covers every
 * exit: answered, deferred, rewind, backoff, retry, transport, throw).
 * The status ladder — 429 cools the account and rewinds, a 5xx backs off
 * on the SAME account when backoff5xx is set (the handler pins the seat —
 * the post-sleep re-pick starts there, so a 5xx never rotates), and every
 * other non-ok status goes to the wrapper's statusFailure warn — returns
 * an AttemptDirective instead of acting, so the finally releases the slot
 * BEFORE the backoff sleep runs and BEFORE the rewind re-picks (D7: the
 * ceiling counts HTTP requests in flight, not backoff waits).
 *
 * Wrapper-owned divergence (the eight analyzer-inventoried axes): the
 * payload (response_format rides the bulk path only), the attempt bound,
 * whether 5xx gets same-account backoff or an immediate retry, whether a
 * transport error defers the call (batch) or spends an attempt (post),
 * the warn strings (D2: byte-identical operator log), and the content
 * handler that parses the answer and decides resolve/retry/defer.
 *
 * "attemptsExhausted" is the post wrapper's `return null` exit (both
 * attempts spent on wrapper retry decisions); the batch ladder never
 * falls through — every branch resolves, rewinds, or returns — so its
 * wrapper maps this member to "unanswered", the typed equivalent of the
 * old trailing return.
 */
async function dispatchLlmCall<T>(options: {
  state: RotationState;
  fetchFn: typeof fetch;
  now: () => number;
  sleepFn: SleepFn;
  buildPayload: (account: LlmAccount) => Record<string, unknown>;
  maxAttempts: number;
  backoff5xx: boolean;
  deferOnTransport: boolean;
  warns: DispatchWarns;
  onContent: (
    rawContent: string | undefined,
    accountNo: number,
    attemptNo: number,
  ) => ContentDecision<T>;
}): Promise<DispatchOutcome<T>> {
  const {
    state,
    fetchFn,
    now,
    sleepFn,
    buildPayload,
    maxAttempts,
    backoff5xx,
    deferOnTransport,
    warns,
    onContent,
  } = options;
  // A 5xx backoff pins its seat: after the sleep the retry re-picks
  // STARTING at the backed-off account — a 5xx never rotates (the
  // endpoint was busy; the account is not the problem). Cleared by the
  // very next pick.
  let pinnedStart: number | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // Pool scan at the top of every attempt, BEFORE the first await — the
    // same sync window as the old pointer read. attemptIndex is the
    // dispatch-time observation — the account this call actually hit —
    // and is what the cool guard stamps and the finally releases.
    const picked = pickEligibleAccount(state, now(), pinnedStart);
    pinnedStart = undefined;
    if (picked === undefined) {
      // The blocked-pick flavor split (D4/D11) lives in judge-exhaustion.ts
      // (resolveBlockedPick): it composes only rotation primitives and the
      // availability predicate, so the policy sits with the vocabulary it
      // decides on. false = the pool is dead — the exhaustion terminal.
      if (!(await resolveBlockedPick(state, now, sleepFn))) {
        return { status: "exhausted" };
      }
      attempt -= 1; // the wait is not a retry — do not spend an attempt
      continue;
    }
    const { index: attemptIndex, account } = picked;
    // Claim in the same sync window as the pick (no await between): the
    // in-flight count rises before the request leaves, and the dial moves
    // to the next account — the proactive spread (D1/D6). The matching
    // release runs in the finally below, so every exit path frees the
    // slot exactly once.
    claimAccount(state, attemptIndex);
    const directive = await (async (): Promise<AttemptDirective<T>> => {
      try {
        const response = await fetchFn(normalizeEndpoint(account.baseUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.apiKey}`,
          },
          body: JSON.stringify(buildPayload(account)),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          if (response.status === 429) {
            coolAccount(state, attemptIndex, now());
            warns.cooling(attemptIndex + 1);
            // Rewind AFTER the finally frees the slot (D7). The pick
            // cannot return a cooling account, so each 429 iteration
            // cools a distinct account; once the pool is fully cooling-
            // or-at-ceiling the loop-top flavor split takes over, bounded
            // by the park budget or by release wakes (the request timeout
            // bounds every wait).
            return { action: "rewind" };
          }
          if (
            backoff5xx &&
            RETRYABLE_STATUSES.has(response.status) &&
            attempt < RETRY_DELAYS_MS.length
          ) {
            // Busy upstream, same account: report the backoff, sleep
            // AFTER the finally frees the slot (D7).
            const delay = RETRY_DELAYS_MS[attempt] ?? 0;
            warns.backingOff?.(attemptIndex + 1, response.status, delay, attempt + 1);
            return { action: "backoff", delayMs: delay };
          }
          warns.statusFailure(attemptIndex + 1, attempt + 1, response.status, response.statusText);
          // Terminal for this call: spent backoff or a non-retryable
          // status. The stamp records the REAL cause (the mid-backoff
          // branch above never stamps — a 5xx that recovers within backoff
          // must not count against the account; a success later would
          // overwrite the ledger anyway, last outcome wins).
          stampFailure(state, attemptIndex, terminalFailureReason(response.status));
          // Spent backoff or a non-retryable status: defer the batch whole
          // (its posts stay unseen and retry next run); the post ladder
          // spends the attempt instead.
          return backoff5xx ? { action: "defer" } : { action: "retry" };
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const decision = onContent(
          data.choices?.[0]?.message?.content,
          attemptIndex + 1,
          attempt + 1,
        );
        if (decision.action === "resolve") {
          if (decision.countsSuccess) {
            // The success stamp flips the ledger to ok (last outcome wins),
            // frees the half-open probe slot, and lifts the in-run cap — the
            // account rejoins at its committed ceiling for the rest of the
            // tick. A parse-miss resolve stamps NOTHING: a model failure is
            // not an account outcome.
            stampSuccess(state, attemptIndex);
          }
          return { action: "answered", value: decision.value };
        }
        if (decision.action === "defer") {
          return { action: "defer" };
        }
        // "retry": spend another attempt — only where the wrapper said so.
        return { action: "retry" };
      } catch (error) {
        // A transport error is not an account problem: nothing cools. The
        // batch defers the whole call (a dead socket predicts a dead
        // fallback); the post spends an attempt and retries.
        const message = error instanceof Error ? error.message : String(error);
        warns.transportError(attemptIndex + 1, attempt + 1, message);
        stampFailure(state, attemptIndex, `network error: ${message}`);
        return deferOnTransport ? { action: "defer" } : { action: "retry" };
      } finally {
        // The release gate: freed on answered, deferred, rewind, backoff,
        // retry, and thrown — every claim terminates here.
        releaseAccount(state, attemptIndex);
      }
    })();
    // Act on the directive OUTSIDE the release gate: the slot is free
    // while the backoff sleeps and while the rewind re-picks (D7).
    if (directive.action === "answered") {
      return { status: "answered", value: directive.value };
    }
    if (directive.action === "defer") {
      return { status: "unanswered" };
    }
    if (directive.action === "rewind") {
      attempt -= 1;
      continue;
    }
    if (directive.action === "backoff") {
      await sleepFn(directive.delayMs);
      // Pin the seat for the retry (same-account 5xx): the sleep ran with
      // the slot free (D7); the re-pick starts here, and if a concurrent
      // 429 cooled the seat or its ceiling filled during the sleep, the
      // scan skips it like any other blocked account. The attempt is
      // spent — the RETRY_DELAYS_MS bound gates exactly as before.
      pinnedStart = attemptIndex;
    }
    // "retry" (and the spent backoff above): the attempt is spent — fall
    // through to the next attempt.
  }
  return { status: "attemptsExhausted" };
}
/**
 * One bulk call for up to BATCH_SIZE posts against the next dispatchable
 * account (the dial scan).
 *
 * HTTP 429 is account-local: the account cools for COOLDOWN_MS
 * (first-write-wins) and the same call re-picks past every cooling account
 * with NO backoff wait. When every account is cooling the batch reports
 * "exhausted" and judgePosts throws after the join.
 *
 * A 5xx keeps the existing bounded same-account backoff (1s, 2s, 4s): the
 * endpoint is alive but busy, so seconds cost less than a deferred batch.
 * A transport error still defers immediately — no retry, no fallback, no
 * rotation: a rate limit says this account is spent, a dead socket says
 * the network path is broken.
 *
 * Returns "answered" with whatever the container parsed into (including an
 * empty Map — a parse miss is a model failure, so the caller falls back per
 * item), "unanswered" on a spent budget / non-retryable status / transport
 * error, or "exhausted" when rotation ran out of accounts.
 *
 * Thin wrapper (F008): the payload, the warn strings, and the bulk ladder
 * decisions ride the shared dispatchLlmCall core.
 */
export async function judgeBatch(
  batch: readonly Post[],
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch,
  batchIndex: number,
  now: () => number,
  sleepFn: SleepFn,
  reasoningEffort: ReasoningEffort = "medium",
  negativeKeywords: readonly string[] = [],
): Promise<BatchOutcome> {
  // Built once, outside the retry loop: the prompt does not change between
  // attempts. The account (model + key + base URL) is read fresh per
  // attempt inside the core, because a 429 rotation swaps it mid-loop.
  const messages = buildBulkMessages(batch, keywords, negativeKeywords);
  const outcome = await dispatchLlmCall<Map<string, JudgeVerdict>>({
    state,
    fetchFn,
    now,
    sleepFn,
    buildPayload: (account) => ({
      model: account.model,
      messages,
      temperature: 0,
      reasoning_effort: reasoningEffort,
      // response_format is a rider on the bulk path ONLY: the single-post
      // fallback payload does not send it (design scope boundary).
      response_format: { type: "json_object" },
    }),
    maxAttempts: RETRY_DELAYS_MS.length + 1,
    backoff5xx: true,
    deferOnTransport: true,
    warns: {
      cooling: (accountNo) => {
        console.warn(`judge: batch ${batchIndex} account ${accountNo} HTTP 429 — cooling`);
      },
      backingOff: (accountNo, status, delayMs, attemptNo) => {
        console.warn(
          `judge: batch ${batchIndex} account ${accountNo} (${batch.length} posts) HTTP ${status} — retrying in ${delayMs}ms (attempt ${attemptNo}/${RETRY_DELAYS_MS.length})`,
        );
      },
      statusFailure: (accountNo, _attemptNo, status, statusText) => {
        console.warn(
          `judge: batch ${batchIndex} account ${accountNo} (${batch.length} posts) HTTP ${status} ${statusText} — skipping batch (posts stay unseen and retry next run)`,
        );
      },
      transportError: (accountNo, _attemptNo, message) => {
        console.warn(
          `judge: batch ${batchIndex} account ${accountNo} (${batch.length} posts) request error: ${message} — skipping batch (posts stay unseen and retry next run)`,
        );
      },
    },
    onContent: (rawContent, accountNo) => {
      if (typeof rawContent !== "string") {
        console.warn(
          `judge: batch ${batchIndex} account ${accountNo} (${batch.length} posts) missing message content — skipping batch (posts stay unseen and retry next run)`,
        );
        return { action: "defer" };
      }
      const verdicts = parseBulkVerdicts(rawContent);
      if (verdicts === null) {
        console.warn(
          `judge: batch ${batchIndex} account ${accountNo} (${batch.length} posts) failed to parse bulk verdicts: ${rawContent.slice(0, 100)} — falling back to single-post calls (up to 2 attempts per post)`,
        );
        // A parse miss is a model failure, not a transport one: report the
        // call answered-empty so the caller falls back per item. It stamps
        // NOTHING on the health ledger (countsSuccess: false) — a broken
        // model must not clear a dead account's streak or open the episode.
        return { action: "resolve", value: new Map(), countsSuccess: false };
      }
      return { action: "resolve", value: verdicts, countsSuccess: true };
    },
  });
  if (outcome.status === "answered") {
    return { status: "answered", verdicts: outcome.value };
  }
  if (outcome.status === "exhausted") {
    return { status: "exhausted" };
  }
  // "attemptsExhausted" is unreachable for the batch ladder (every branch
  // resolves inside the loop) — the old trailing return, kept as the mapping.
  return { status: "unanswered" };
}
/**
 * Judge a single post with up to 1 retry on HTTP or parsing failure.
 * Returns the verdict on success, or null if both attempts fail.
 *
 * HTTP 429 cools the account exactly like judgeBatch (no backoff); the
 * cooldown does not spend a fallback attempt. When every account is
 * cooling and the shared budget is spent, dispatchLlmCall returns its
 * "exhausted" member and THIS wrapper throws the tagged RotationExhausted
 * error — at wrapper level, outside any try the core owns (both core
 * catches are total transport converters and would swallow the throw).
 * judgePost runs in judgePosts' parallel fallback pool, whose workers
 * catch the throw, stop claiming work, and re-throw after the join
 * (drain-then-throw, same as the bulk phase). Other failures keep the
 * original status-agnostic retry.
 *
 * Thin wrapper (F008): the payload, the warn strings, and the post ladder
 * decisions ride the shared dispatchLlmCall core.
 */
export async function judgePost(
  post: Post,
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
  now: () => number = Date.now,
  sleepFn: SleepFn = sleep,
  negativeKeywords: readonly string[] = [],
): Promise<JudgeVerdict | null> {
  const messages = buildMessages(post, keywords, negativeKeywords);
  const outcome = await dispatchLlmCall<JudgeVerdict>({
    state,
    fetchFn,
    now,
    sleepFn,
    buildPayload: (account) => ({
      model: account.model,
      messages,
      temperature: 0,
      reasoning_effort: reasoningEffort,
      // No response_format here: the rider is bulk-only (design scope).
    }),
    maxAttempts: 2,
    backoff5xx: false,
    deferOnTransport: false,
    warns: {
      cooling: (accountNo) => {
        console.warn(`judge: post ${post.id} account ${accountNo} HTTP 429 — cooling`);
      },
      statusFailure: (accountNo, attemptNo, status, statusText) => {
        console.warn(
          `judge: post ${post.id} attempt ${attemptNo}/2 account ${accountNo} HTTP ${status} ${statusText}`,
        );
      },
      transportError: (accountNo, attemptNo, message) => {
        console.warn(
          `judge: post ${post.id} attempt ${attemptNo}/2 account ${accountNo} request error: ${message}`,
        );
      },
    },
    onContent: (rawContent, accountNo, attemptNo) => {
      if (typeof rawContent !== "string") {
        console.warn(
          `judge: post ${post.id} attempt ${attemptNo}/2 account ${accountNo} missing message content`,
        );
        return { action: "retry" };
      }
      const verdict = parseVerdict(rawContent);
      if (verdict === null) {
        console.warn(
          `judge: post ${post.id} attempt ${attemptNo}/2 account ${accountNo} failed to parse JSON verdict: ${rawContent.slice(0, 100)}`,
        );
        return { action: "retry" };
      }
      return { action: "resolve", value: verdict, countsSuccess: true };
    },
  });
  if (outcome.status === "exhausted") {
    // D6: thrown at wrapper level, OUTSIDE the core's try — a throw inside
    // would be swallowed by the total transport catches.
    throw rotationExhausted(exhaustionRecord(state), undefined, state.accounts.length);
  }
  if (outcome.status === "answered") {
    return outcome.value;
  }
  // attemptsExhausted: both attempts spent (the old `return null`).
  // "unanswered" never occurs for the post ladder.
  return null;
}
