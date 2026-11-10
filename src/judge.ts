/**
 * The LLM judge orchestration (FRD #4, #5, D3): the account-pool pipeline
 * around the dispatch seam (src/judge-dispatch.ts).
 *
 * Candidates are judged in bulk: judgePosts slices them into ~BATCH_SIZE
 * batches and drains them through a bounded pool of workers sized by the
 * pool's total in-flight budget — the sum of the per-account ceilings,
 * resolved by index.ts and passed in. Bulk misses fall back to the
 * single-post judgePost through a second pool at the same width, under a
 * per-run FALLBACK_CALL_BUDGET on single-post calls. A post that fails
 * both stages, or never reaches the fallback once the budget is spent,
 * is skipped for this run, logged visibly, and omitted from state (D3:
 * it stays unseen and retries next run).
 *
 * The dispatch mechanics — the HTTP retry core, 429 cooldowns, the
 * dispatch dial, 5xx backoff, the park budget, the health circuit — live
 * in src/judge-dispatch.ts and src/judge-rotation.ts. judgePosts owns
 * the RotationState literal shared by reference with every worker, and
 * throws the tagged RotationExhausted error drain-then-throw after the
 * join (one exhaustion email, exit 1 — surfaced by index.ts). Results
 * reassemble in candidate input order.
 */

import type { ReasoningEffort } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import {
  type BatchOutcome,
  type SleepFn,
  exhaustionRecord,
  judgeBatch,
  judgePost,
  sleep,
} from "./judge-dispatch.js";
import { HARD_FAIL_TICKS_TO_CAP, type TickOutcomes, readTickOutcomes } from "./judge-health.js";
import { type RotationState, isRotationExhausted, rotationExhausted } from "./judge-rotation.js";
import { runPool } from "./pool.js";
import type { JudgeVerdict, Post } from "./types.js";

/** Posts per bulk judge call. Module constant by design — no config key. */
const BATCH_SIZE = 10;
/**
 * Single-post fallback calls one run may spend. Advisor-fixed: the
 * historical cascade (run 40264368939) burned 6.5 job-minutes walking
 * degraded batches serially, and an unbounded parallel fallback would bill
 * unboundedly instead. The pool bounds wall-clock; this constant bounds
 * total spend. The budget counts single-post CALLS, not HTTP requests:
 * rotation can turn one call into up to M requests (M = pool size — a 429
 * spends no attempt), so worst-case requests are 40×M while billed calls
 * stay <= 40. Unmeasured values stay constants — raise it only with a
 * probe- or runner-measured reason.
 */
const FALLBACK_CALL_BUDGET = 40;

/**
 * Shared in-run park budget: the total time both judge phases may spend
 * parked on cooling accounts before the run converts to the exhaustion
 * alarm. Drawn down charge-before-sleep, re-charged with the actual
 * elapsed after wake.
 *
 * Sized by arithmetic from measured numbers (F023), not a new probe: the
 * 480s job cap minus the 60-100s setup prologue (checkout + npm ci +
 * Playwright install; the watch.yml ms-playwright cache removes 30-60s of
 * it) minus the 60s abort tail leaves ~320-360s for the fetch stage,
 * judge waves, and parks. The LinkedIn fetch term left this budget
 * entirely (2026-11-04): the leg runs on the developer PC and this job
 * only reads its pushed payload — the fetch measurement note moved to
 * the PC-loop docs in README.md. A 180s park budget keeps
 * the exhaustion alarm ~1-2 min inside the 8-minute envelope, and the run
 * still dies before the next 10-minute tick queues.
 */
const WAIT_BUDGET_MS = 180_000;

/** One LLM account from the LLM_ACCOUNTS pool (ordered; index 0 is tried first). */
export interface LlmAccount {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Parse the LLM_ACCOUNTS pool from an environment record. The value is a
 * JSON array of {baseUrl, apiKey, model} objects, tried in order. Throws
 * with an error naming LLM_ACCOUNTS when the variable is missing, blank,
 * unparsable, not an array, empty, or when any item fails a rule — modeled
 * on the fail-visible rules in src/config-file.ts.
 */
export function parseLlmAccounts(env: Record<string, string | undefined>): LlmAccount[] {
  const raw = env[ENV_NAMES.llmAccounts]?.trim();
  if (!raw) {
    throw new Error(`judge: missing required environment variable: ${ENV_NAMES.llmAccounts}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`judge: ${ENV_NAMES.llmAccounts} is not valid JSON: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`judge: ${ENV_NAMES.llmAccounts} must be a JSON array of account objects`);
  }
  if (parsed.length === 0) {
    throw new Error(`judge: ${ENV_NAMES.llmAccounts} must not be empty`);
  }

  const accounts: LlmAccount[] = [];
  for (const [i, item] of parsed.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(
        `judge: ${ENV_NAMES.llmAccounts}[${i}] must be an object with "baseUrl", "apiKey", and "model"`,
      );
    }
    const record = item as Record<string, unknown>;
    const read = (key: string): string => {
      const value = record[key];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`judge: ${ENV_NAMES.llmAccounts}[${i}].${key} must be a non-empty string`);
      }
      return value.trim();
    };
    accounts.push({ baseUrl: read("baseUrl"), apiKey: read("apiKey"), model: read("model") });
  }
  return accounts;
}

export interface JudgedPost {
  post: Post;
  verdict: JudgeVerdict;
}

export interface JudgeBatchResult {
  judged: JudgedPost[];
  skippedPostIds: string[];
  /** Per-account dispatch outcomes of the run — index.ts flushes them into
   *  the health file (judge-health flushTickHealth) and the heartbeat/
   *  digest degraded line reads the capped set. */
  outcomes: TickOutcomes;
}

/**
 * Resolve the LLM account pool from the environment dictionary.
 * Delegates to parseLlmAccounts — throws naming LLM_ACCOUNTS when the
 * variable is missing, blank, unparsable, or fails any per-account rule.
 */
export function resolveJudgeConfig(
  env: Record<string, string | undefined> = process.env,
): readonly LlmAccount[] {
  return parseLlmAccounts(env);
}

/**
 * FR3 options for judgePosts. Fields declare `field?: T` under
 * exactOptionalPropertyTypes — absence hits the destructure default; an
 * explicit `undefined` is a compile error (the omit-when-absent doctrine).
 * fetchFn and reasoningEffort deliberately stay POSITIONAL on judgePosts
 * (implementer's choice recorded per FR3: ~19 test re-points instead of
 * ~36 — the deep-tail suites keep passing them as today). Module-private:
 * exporting it would trip the knip 0/0 gate.
 */
interface JudgePostsOptions {
  /** Probe-measured in-flight ceilings (0-based index -> ceiling). */
  ceilings?: ReadonlyMap<number, number>;
  /** Injected clock (recency, prune, stamps, the park budget). */
  now?: () => number;
  /** Injected park wait (the judge seam's production default). */
  sleepFn?: SleepFn;
  /** Seed marks from the committed health file (index.ts). */
  healthMarks?: ReadonlyMap<number, number>;
  /** The availability pre-check's refusal mask (0-based index -> reason). */
  blocked?: ReadonlyMap<number, string>;
  /** The negative-keyword veto list (config negativeKeywords). */
  negativeKeywords?: readonly string[];
}

/**
 * Judge candidate posts in ~BATCH_SIZE-post bulk calls; every item the bulk
 * response misses or mangles falls back to the single-post judgePost.
 * Collects successful verdicts and tracks skipped IDs (D3).
 *
 * Throws the tagged RotationExhausted error when every LLM_ACCOUNTS account
 * has been rate-limited (drain-then-throw: in-flight batches finish first,
 * so the carried failure record is complete). Every other LLM failure still
 * lands in skippedPostIds, so a flaky endpoint cannot kill the run.
 *
 * Batches drain through a bounded pool of `width` workers — the pool's
 * total in-flight budget, the sum of the per-account ceilings passed in —
 * and each result slot is indexed by batch number so the output reassembles
 * in input order even when batches finish out of order. Bulk misses drain
 * through a second fallback pool at the same width under a per-run
 * FALLBACK_CALL_BUDGET on single-post calls; the cursor claims work in
 * input order, so budget exhaustion starves the tail. Both result lists
 * come out in candidate input order.
 *
 * Rotation state lives in this frame: cooldowns, the per-account in-flight
 * counts under the passed ceilings, and the dispatch dial, shared by
 * reference with every worker exactly like the next cursor below — all
 * claim and release mutations are synchronous, so the workers stay
 * coherent without locks. There is no sticky pointer: every dispatch
 * starts at the dial and skips cooling or at-ceiling accounts, and a claim
 * moves the dial to the next account (the proactive spread, D1/D6).
 *
 * Refused seats ride in on `options.blocked` (0-based index
 * -> the availability pre-check's refusal reason): the pick skips them, the
 * pool width excludes them, and the exhaustion record appends them with
 * their real reasons. An ALL-blocked pool exhausts immediately (the D11
 * guard) instead of parking on the timerless ceiling wait — production
 * never sends one (index.ts pre-checks and skips the judge stage), so a
 * non-empty mask here is the direct-caller and degraded-run shape the
 * exported core must survive on its own. The negativeKeywords veto list
 * tail-appends last (D4): both pool workers forward it into the builders'
 * system message.
 */
export async function judgePosts(
  candidates: readonly Post[],
  accounts: readonly LlmAccount[],
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
  options: JudgePostsOptions = {},
): Promise<JudgeBatchResult> {
  const {
    ceilings = new Map<number, number>(),
    now = Date.now,
    sleepFn = sleep,
    healthMarks = new Map<number, number>(),
    blocked = new Map<number, string>(),
    negativeKeywords = [],
  } = options;
  const state: RotationState = {
    accounts,
    cooldownUntil: new Map(),
    ceilings,
    blocked: new Map(blocked),
    inFlight: new Map(),
    healthMarks: new Map(healthMarks),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: WAIT_BUDGET_MS,
  };

  const batches: Post[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  // Pool width = the pool's total in-flight budget: the sum of the
  // per-account ceilings, minus every availability-refused seat (a
  // refused seat can never dispatch, so capacity spent on it would only
  // park its worker). No overall clamp (D1) — the caps ARE the width —
  // and the floor keeps a hand-built empty map (tests) from spawning zero
  // workers. The new Map() default is the same degrade as an absent
  // ceilings file: every account floors at 1 (the pick's ?? 1 floor);
  // index.ts always passes the resolved map.
  const width = Math.max(
    1,
    [...ceilings.entries()].reduce((sum, [index, ceiling]) => {
      if (state.blocked.has(index)) return sum;
      const capped = (state.healthMarks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP;
      return sum + (capped ? 1 : ceiling);
    }, 0),
  );

  // One result slot per batch, filled by whichever worker takes it. Indexing
  // by slot (not pushing) is what keeps the output in input order once the
  // batches finish out of order.
  const outcomes: Array<BatchOutcome | undefined> = Array.from({ length: batches.length });
  // Cursor, width clamp, and join live in runPool (F007); the worker stays
  // total — judgeBatch resolves an outcome union, never throws.
  await runPool(batches, width, async (batch, index) => {
    outcomes[index] = await judgeBatch(
      batch,
      state,
      keywords,
      fetchFn,
      index,
      now,
      sleepFn,
      reasoningEffort,
      negativeKeywords,
    );
  });

  // Drain-then-throw: the join above let every in-flight batch finish, so
  // the failure record is complete. Throwing here (not inside a worker)
  // keeps sibling workers from mutating the record after the snapshot and
  // leaves the unjudged posts unseen — index.ts turns the error into the
  // exhaustion email and exit 1; state is never reached.
  if (outcomes.some((outcome) => outcome?.status === "exhausted")) {
    throw rotationExhausted(
      exhaustionRecord(state),
      readTickOutcomes(state),
      state.accounts.length,
    );
  }

  // Reassembly walk (input order): bulk verdicts fill their slots at once;
  // bulk misses queue for the parallel fallback pool below. A batch the
  // endpoint did not answer is deferred whole — its slots stay undefined
  // (skipped), and it consumes no fallback budget.
  const slots: Array<JudgeVerdict | undefined> = Array.from({ length: candidates.length });
  const fallbackWork: Array<{ post: Post; slot: number }> = [];
  let candidateIndex = 0;
  for (const [index, batch] of batches.entries()) {
    const batchStart = candidateIndex;
    candidateIndex += batch.length;
    const outcome = outcomes[index];
    if (outcome === undefined) continue;
    if (outcome.status !== "answered") {
      // unanswered (deferred: spent backoff, non-retryable status, or
      // transport error). The exhausted arm cannot appear here — it is
      // thrown after the bulk join above — but the union keeps it typed.
      console.warn(
        `judge: skipped batch ${index} of ${batch.length} post(s) after an unanswered bulk call; they stay unseen and retry next run`,
      );
      continue;
    }
    for (const [i, post] of batch.entries()) {
      const fromBulk = outcome.verdicts.get(post.id);
      const slot = batchStart + i;
      if (fromBulk !== undefined) {
        slots[slot] = fromBulk;
      } else {
        fallbackWork.push({ post, slot });
      }
    }
  }

  // Parallel capped fallback: the slot-array + shared-cursor pool idiom,
  // `width` wide, under a per-run FALLBACK_CALL_BUDGET. The cursor
  // claims work in input order, so a spent budget starves the tail —
  // never a random middle. A RotationExhausted throw from judgePost stops
  // the workers (drain-then-throw): the join below re-throws the tagged
  // error with the complete failure record, and unjudged posts stay
  // unseen — index.ts turns it into the exhaustion email and exit 1.
  if (fallbackWork.length > 0) {
    let budget = FALLBACK_CALL_BUDGET;
    let exhausted = false;
    // runPool claims in order; the stop flags ride this closure exactly as
    // before — each check runs at the top of an invocation, in the same sync
    // window as the claim, so no call starts after exhaustion is flagged.
    // The slot write keeps the CARRIED index (item.slot), never runPool's
    // claim index — reassembly order comes from the join-then-walk below.
    await runPool(fallbackWork, width, async (item) => {
      if (exhausted) return; // stop claiming; the join re-throws below
      if (budget <= 0) return; // budget spent — surplus posts stay unseen (D3)
      budget -= 1;
      try {
        const verdict = await judgePost(
          item.post,
          state,
          keywords,
          fetchFn,
          reasoningEffort,
          now,
          sleepFn,
          negativeKeywords,
        );
        if (verdict !== null) {
          slots[item.slot] = verdict;
        } else {
          console.warn(`judge: skipped post ${item.post.id} after bulk miss and retry`);
        }
      } catch (error) {
        if (isRotationExhausted(error)) {
          exhausted = true; // stop claiming; the join re-throws below
          return;
        }
        throw error;
      }
    });
    if (exhausted) {
      throw rotationExhausted(
        exhaustionRecord(state),
        readTickOutcomes(state),
        state.accounts.length,
      );
    }
    const starved = Math.max(0, fallbackWork.length - FALLBACK_CALL_BUDGET);
    if (starved > 0) {
      console.warn(
        `judge: fallback call budget ${FALLBACK_CALL_BUDGET} spent — ${starved} post(s) never fell back; they stay unseen and retry next run`,
      );
    }
  }

  // Assembly (input order): filled slots are the judged posts, undefined
  // slots (deferred batches, fallback failures, starved tail) are the
  // skipped ids.
  const judged: JudgedPost[] = [];
  const skippedPostIds: string[] = [];
  for (const [index, verdict] of slots.entries()) {
    const post = candidates[index];
    if (post === undefined) continue;
    if (verdict !== undefined) {
      judged.push({ post, verdict });
    } else {
      skippedPostIds.push(post.id);
    }
  }
  return { judged, skippedPostIds, outcomes: readTickOutcomes(state) };
}
