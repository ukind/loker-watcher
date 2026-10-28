/**
 * LLM relevance and location judge for candidate Threads posts (FRD #4, #5, D3).
 *
 * Uses an OpenAI-compatible chat completions endpoint (global fetch, no SDK
 * dependency). Candidates are judged in bulk: up to BATCH_SIZE posts per
 * call, the configured keyword list serialized into the system message as
 * the relevance criterion, and an id-keyed verdict object as the answer:
 * {"<post id>": {"relevant": boolean, "locationOk": boolean}}. The bulk
 * payload sets response_format {"type":"json_object"} so a conforming
 * endpoint constrains decoding to valid JSON; a proxy silently dropping the
 * field degrades to plain parsing with no behavior change.
 *
 * Every bulk verdict is validated per item. Items missing or malformed in
 * the bulk response fall back to the single-post judgePost (2 attempts).
 * HTTP 429 is account-local: the account cools for a flat 60 seconds
 * (first-write-wins — a 429 costs 60 seconds, not more) and every dispatch
 * scans the pool from account 1, skipping accounts that are still cooling.
 * A 5xx is retried on the same account with bounded backoff before the
 * batch is deferred; a transport error defers immediately without cooling
 * anything. When every account is cooling the run parks in-loop (a shared
 * 5-minute wait budget — ride out rate limits per batch) and, when the
 * budget is spent, throws the tagged RotationExhausted error with a
 * pool-ordered record (one exhaustion email, exit 1 — surfaced by
 * index.ts). Batches drain through a bounded pool of workers
 * sized by the concurrency argument (JUDGE_CONCURRENCY, absent 4) and
 * reassemble in input order. Posts the bulk response misses fall back to
 * the single-post judgePost through a second pool at the same width, under
 * a per-run FALLBACK_CALL_BUDGET on single-post calls. A post that fails
 * both stages, or never reaches the fallback once the budget is spent, is
 * skipped for this run, logged visibly, and omitted from state (D3: it
 * stays unseen and retries next run).
 */
import type { ReasoningEffort } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import type { AccountFailure, JudgeVerdict, Post } from "./types.js";

/**
 * Per-request timeout. 15s was never validated from a GitHub runner: run
 * 40264368939 timed out every batch and every fallback call at exactly
 * 15.0s. Phase 0 measures the real latency from the runner and confirms
 * this value.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** Posts per bulk judge call. Module constant by design — no config key. */
const BATCH_SIZE = 10;

/**
 * Bulk calls in flight at once when the caller passes no width. Ships at
 * 4 - the agreed floor, low enough for the lowest documented Z.AI tier.
 * The probe's ramp reads the real ceiling; paste that reading into
 * JUDGE_CONCURRENCY in .github/workflows/watch.yml. Z.AI publishes no
 * number and adjusts the limit dynamically, so the 429 account rotation
 * below is what keeps a stale or optimistic value from costing a run its
 * digest.
 */
const DEFAULT_JUDGE_CONCURRENCY = 4;

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
 * HTTP statuses worth retrying on the SAME account: the endpoint is alive
 * but busy. 429 is handled separately — it is account-local and rotates to
 * the next account instead of waiting.
 */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
/** Bounded backoff for a retryable status. Total added latency: 7s. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/**
 * Flat cooldown for a rate-limited account. First-write-wins: while an
 * account is cooling, a second 429 never extends the window — a 429 costs
 * 60 seconds, not more. Unmeasured values stay constants.
 */
const COOLDOWN_MS = 60_000;

/**
 * Shared in-run park budget: the total time both judge phases may spend
 * parked on cooling accounts before the run converts to the exhaustion
 * alarm. Drawn down charge-before-sleep, re-charged with the actual
 * elapsed after wake. Unmeasured value stays a constant.
 */
const WAIT_BUDGET_MS = 300_000;

/**
 * Wake-time jitter. Workers parked on the same earliest expiry would wake
 * and re-dispatch in a thundering herd; a small constant spread smooths
 * that. Unmeasured value stays a constant.
 */
const WAKE_JITTER_MS = 500;

/** Sleep that a test can skip by injecting a fake timer. Exported as the
 *  production default for the WatcherDeps.sleepFn seam (src/index.ts). */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Injectable wait seam: production is the module sleep; tests pass an inert recorder. */
type SleepFn = (ms: number) => Promise<void>;

/** One LLM account from the LLM_ACCOUNTS pool (ordered; index 0 is tried first). */
export interface LlmAccount {
  baseUrl: string;
  apiKey: string;
  model: string;
}

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
}

/**
 * Parse JUDGE_CONCURRENCY (the repo's first numeric env read).
 *
 * Absent or blank -> DEFAULT_JUDGE_CONCURRENCY: local runs and the probe
 * job never set the variable, and watch.yml carries the probe-measured
 * value for production. Present but not a positive integer -> throw naming
 * the variable: a typo must not silently run at the default width
 * (fail-visible - same rule as parseLlmAccounts below).
 */
export function parseJudgeConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_JUDGE_CONCURRENCY;
  }
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `judge: ${ENV_NAMES.judgeConcurrency} must be a positive integer, got "${raw}"`,
    );
  }
  return value;
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
 * Extract and validate a JudgeVerdict from raw LLM response text.
 * Tolerates surrounding markdown code fences and whitespace.
 */
export function parseVerdict(content: string): JudgeVerdict | null {
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const jsonStr = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.relevant === "boolean" &&
      typeof parsed.locationOk === "boolean"
    ) {
      return {
        relevant: parsed.relevant,
        locationOk: parsed.locationOk,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Chat-completions URL from a base URL, tolerating a full endpoint. */
function normalizeEndpoint(baseUrl: string): string {
  return baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/** Validate one unknown bulk item as a JudgeVerdict; null when malformed. */
function readVerdict(item: unknown): JudgeVerdict | null {
  if (item === null || typeof item !== "object") {
    return null;
  }
  const record = item as Record<string, unknown>;
  if (typeof record.relevant === "boolean" && typeof record.locationOk === "boolean") {
    return { relevant: record.relevant, locationOk: record.locationOk };
  }
  return null;
}

/**
 * Build the chat completion messages for one single-post fallback call.
 * The keyword list replaces the old hardcoded frontend/fullstack criterion.
 */
function buildMessages(
  post: Post,
  keywords: readonly string[],
): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content: `You are an automated evaluation filter for job alerts. A post is relevant when it is a genuine job opening related to at least one of these keywords: ${JSON.stringify(keywords)}. You also determine whether the position is in Indonesia or remote.`,
    },
    {
      role: "user",
      content: `Analyze the following Threads post by @${post.author}:\n\n\"${post.text}\"\n\nDetermine two criteria:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above. Set false if it is a job seeker seeking work, an internship inquiry, a training promotion, or an unrelated role.\n2. locationOk: true ONLY if the job is located in Indonesia (e.g. Jakarta, Bali, Surabaya, hybrid in ID), or explicitly remote / work from anywhere. Set false if the role is on-site or hybrid in another country with no remote option.\n\nRespond with ONLY a raw JSON object matching this schema:\n{"relevant": boolean, "locationOk": boolean}`,
    },
  ];
}

/**
 * Build the chat completion messages for one bulk batch: the keyword list
 * is the criterion (system message), the id+text pairs are the data (user
 * message). The model must echo each post id as an object key.
 */
function buildBulkMessages(
  candidates: readonly Post[],
  keywords: readonly string[],
): Array<{ role: string; content: string }> {
  const listing = candidates
    .map((post) => `id ${post.id} by @${post.author}:\n"${post.text}"`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: `You are an automated evaluation filter for job alerts. A post is relevant when it is a genuine job opening related to at least one of these keywords: ${JSON.stringify(keywords)}. You also determine whether the position is in Indonesia or remote.`,
    },
    {
      role: "user",
      content: `Judge each Threads post below against the criteria.\n\n${listing}\n\nDetermine two criteria per post:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above. Set false if it is a job seeker seeking work, an internship inquiry, a training promotion, or an unrelated role.\n2. locationOk: true ONLY if the job is located in Indonesia (e.g. Jakarta, Bali, Surabaya, hybrid in ID), or explicitly remote / work from anywhere. Set false if the role is on-site or hybrid in another country with no remote option.\n\nRespond with ONLY a raw JSON object mapping EACH post id above to its verdict, exactly like:\n{"<post id>": {"relevant": boolean, "locationOk": boolean}}`,
    },
  ];
}

/**
 * Parse a bulk verdict response into an id-keyed Map.
 *
 * Returns null (container-level failure) ONLY when the whole response is
 * unrecoverable: no braces, invalid JSON, or a non-object container. A
 * malformed item is simply absent from the Map — never a batch failure.
 * Ids stay strings (Post.id exceeds Number.MAX_SAFE_INTEGER — never
 * Number()-coerced); a Map also neutralizes hostile keys such as
 * "__proto__". Never throws.
 */
export function parseBulkVerdicts(content: string): Map<string, JudgeVerdict> | null {
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const verdicts = new Map<string, JudgeVerdict>();
    for (const [id, item] of Object.entries(parsed)) {
      const verdict = readVerdict(item);
      if (verdict !== null) {
        verdicts.set(id, verdict);
      }
    }
    return verdicts;
  } catch {
    return null;
  }
}

/**
 * Result of one bulk call: a parsed container, no usable answer, or a pool
 * exhausted mid-batch (every account rate-limited; judgePosts throws).
 */
type BatchOutcome =
  | { status: "answered"; verdicts: Map<string, JudgeVerdict> }
  | { status: "unanswered" }
  | { status: "exhausted" };

/**
 * First dispatchable account, scanning the pool in order from account 1 —
 * the batch-local cursor. A missing or expired entry makes an account
 * dispatchable; an active cooldown (expiry > now) skips it. Synchronous and
 * pre-await: the caller dispatches inside the same sync window as the old
 * pointer read.
 */
function pickEligibleAccount(
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
function coolAccount(state: RotationState, accountIndex: number, nowMs: number): void {
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
function failuresFromCooldowns(state: RotationState): AccountFailure[] {
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
async function parkUntilEligible(
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

/**
 * One bulk call for up to BATCH_SIZE posts against the first dispatchable
 * account.
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
 */
async function judgeBatch(
  batch: readonly Post[],
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch,
  batchIndex: number,
  now: () => number,
  sleepFn: SleepFn,
  reasoningEffort: ReasoningEffort = "medium",
): Promise<BatchOutcome> {
  // Built once, outside the retry loop: the prompt does not change between
  // attempts. The account (model + key + base URL) is read fresh per
  // attempt below, because a 429 rotation swaps it mid-loop.
  const messages = buildBulkMessages(batch, keywords);

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    // Pool scan at the top of every attempt, BEFORE the first await — the
    // same sync window as the old pointer read: nothing can interleave
    // between the pick and the fetch dispatch. attemptIndex is the
    // dispatch-time observation — the account this call actually hit — and
    // is what the cool guard stamps when the 429 comes back.
    const picked = pickEligibleAccount(state, now());
    if (picked === undefined) {
      // Every account is cooling: park until the earliest expiry (charging
      // the shared wait budget) and re-pick; a spent budget converts to the
      // terminal outcome here at the loop top, OUTSIDE the try below — a
      // throw from the 429 arm would be swallowed by the catch and misread
      // as a transport error.
      if (!(await parkUntilEligible(state, now, sleepFn))) {
        return { status: "exhausted" };
      }
      attempt -= 1; // the park is a wait, not a retry — do not spend an attempt
      continue;
    }
    const { index: attemptIndex, account } = picked;
    const payload = {
      model: account.model,
      messages,
      temperature: 0,
      reasoning_effort: reasoningEffort,
      // response_format is a rider on the bulk path ONLY: the single-post
      // fallback payload does not send it (design scope boundary).
      response_format: { type: "json_object" },
    };
    try {
      const response = await fetchFn(normalizeEndpoint(account.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${account.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status === 429) {
          coolAccount(state, attemptIndex, now());
          console.warn(`judge: batch ${batchIndex} account ${attemptIndex + 1} HTTP 429 — cooling`);
          // Rewind: the retry re-picks past every cooling account. The pick
          // cannot return a cooling account, so each 429 iteration cools a
          // distinct account and the loop stays bounded by the pool size
          // (re-arming an expired entry mid-call needs a full 60s stall,
          // which the request timeout bounds per attempt).
          attempt -= 1;
          continue;
        }
        // Busy upstream, same account, bounded backoff; defer once spent.
        if (RETRYABLE_STATUSES.has(response.status) && attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 0;
          console.warn(
            `judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) HTTP ${response.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
          );
          await sleepFn(delay);
          continue;
        }
        console.warn(
          `judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) HTTP ${response.status} ${response.statusText} — skipping batch (posts stay unseen and retry next run)`,
        );
        return { status: "unanswered" };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string") {
        console.warn(
          `judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) missing message content — skipping batch (posts stay unseen and retry next run)`,
        );
        return { status: "unanswered" };
      }

      const verdicts = parseBulkVerdicts(rawContent);
      if (verdicts === null) {
        console.warn(
          `judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) failed to parse bulk verdicts: ${rawContent.slice(0, 100)} — falling back to single-post calls (up to 2 attempts per post)`,
        );
        return { status: "answered", verdicts: new Map() };
      }
      return { status: "answered", verdicts };
    } catch (error) {
      // A transport error still defers immediately — no retry, no fallback,
      // no rotation. A dead socket predicts a dead fallback; it is not an
      // account problem, so the pointer does not move.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) request error: ${message} — skipping batch (posts stay unseen and retry next run)`,
      );
      return { status: "unanswered" };
    }
  }
  // Unreachable: every branch above returns. Present so the function has a
  // single exit type and a future early-break cannot fall through.
  return { status: "unanswered" };
}

/**
 * Judge a single post with up to 1 retry on HTTP or parsing failure.
 * Returns the verdict on success, or null if both attempts fail.
 *
 * HTTP 429 cools the account exactly like judgeBatch (no backoff); the
 * cooldown does not spend a fallback attempt. When every account is
 * cooling, the loop-top guard throws the tagged RotationExhausted error —
 * judgePost runs in judgePosts' parallel fallback pool, whose workers
 * catch the throw, stop claiming work, and re-throw after the join
 * (drain-then-throw, same as the bulk phase). Other failures keep the
 * original status-agnostic retry.
 */
export async function judgePost(
  post: Post,
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
  now: () => number = Date.now,
  sleepFn: SleepFn = sleep,
): Promise<JudgeVerdict | null> {
  const messages = buildMessages(post, keywords);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const picked = pickEligibleAccount(state, now());
    if (picked === undefined) {
      // Every account is cooling: park until the earliest expiry (charging
      // the shared wait budget) and re-pick; a spent budget converts to the
      // terminal throw here at the loop top, OUTSIDE the try below — the
      // catch converts anything thrown to a logged transport outcome.
      if (!(await parkUntilEligible(state, now, sleepFn))) {
        throw rotationExhausted(failuresFromCooldowns(state));
      }
      attempt -= 1; // the park is a wait, not a retry — do not spend an attempt
      continue;
    }
    const { index: attemptIndex, account } = picked;
    const payload = {
      model: account.model,
      messages,
      temperature: 0,
      reasoning_effort: reasoningEffort,
    };
    try {
      const response = await fetchFn(normalizeEndpoint(account.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${account.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status === 429) {
          coolAccount(state, attemptIndex, now());
          console.warn(`judge: post ${post.id} account ${attemptIndex + 1} HTTP 429 — cooling`);
          // Rewind: the retry re-picks past every cooling account; the
          // loop-top guard throws when the pick finds none (never here —
          // a throw inside this try would be swallowed by the catch).
          attempt -= 1;
          continue;
        }
        console.warn(
          `judge: post ${post.id} attempt ${attempt}/2 account ${attemptIndex + 1} HTTP ${response.status} ${response.statusText}`,
        );
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const rawContent = data.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string") {
        console.warn(
          `judge: post ${post.id} attempt ${attempt}/2 account ${attemptIndex + 1} missing message content`,
        );
        continue;
      }

      const verdict = parseVerdict(rawContent);
      if (verdict !== null) {
        return verdict;
      }

      console.warn(
        `judge: post ${post.id} attempt ${attempt}/2 account ${attemptIndex + 1} failed to parse JSON verdict: ${rawContent.slice(0, 100)}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `judge: post ${post.id} attempt ${attempt}/2 account ${attemptIndex + 1} request error: ${msg}`,
      );
    }
  }

  return null;
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
 * Batches drain through a bounded pool of `concurrency` workers, and each
 * result slot is indexed by batch number so the output reassembles in
 * input order even when batches finish out of order. Bulk misses drain
 * through a second `concurrency`-wide fallback pool under a per-run
 * FALLBACK_CALL_BUDGET; the cursor claims work in input order, so budget
 * exhaustion starves the tail. Both result lists come out in candidate
 * input order.
 *
 * Rotation state lives in this frame: a cooldown map plus the shared park
 * budget, shared by reference with every worker exactly like the next
 * cursor below — all reads and writes are synchronous, so four workers
 * stay coherent without locks. There is no sticky pointer: every dispatch
 * scans from account 1 and skips cooling accounts, so a batch that starts
 * after an account's cooldown expires lands back on account 1.
 */
export async function judgePosts(
  candidates: readonly Post[],
  accounts: readonly LlmAccount[],
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
  concurrency: number = DEFAULT_JUDGE_CONCURRENCY,
  now: () => number = Date.now,
  sleepFn: SleepFn = sleep,
): Promise<JudgeBatchResult> {
  const state: RotationState = {
    accounts,
    cooldownUntil: new Map(),
    waitBudgetRemainingMs: WAIT_BUDGET_MS,
  };

  const batches: Post[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  // One result slot per batch, filled by whichever worker takes it. Indexing
  // by slot (not pushing) is what keeps the output in input order once the
  // batches finish out of order.
  const outcomes: Array<BatchOutcome | undefined> = Array.from({ length: batches.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= batches.length) return;
      const batch = batches[index];
      if (batch === undefined) continue;
      outcomes[index] = await judgeBatch(
        batch,
        state,
        keywords,
        fetchFn,
        index,
        now,
        sleepFn,
        reasoningEffort,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));

  // Drain-then-throw: the join above let every in-flight batch finish, so
  // the failure record is complete. Throwing here (not inside a worker)
  // keeps sibling workers from mutating the record after the snapshot and
  // leaves the unjudged posts unseen — index.ts turns the error into the
  // exhaustion email and exit 1; state is never reached.
  if (outcomes.some((outcome) => outcome?.status === "exhausted")) {
    throw rotationExhausted(failuresFromCooldowns(state));
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
  // `concurrency` wide, under a per-run FALLBACK_CALL_BUDGET. The cursor
  // claims work in input order, so a spent budget starves the tail —
  // never a random middle. A RotationExhausted throw from judgePost stops
  // the workers (drain-then-throw): the join below re-throws the tagged
  // error with the complete failure record, and unjudged posts stay
  // unseen — index.ts turns it into the exhaustion email and exit 1.
  if (fallbackWork.length > 0) {
    let next = 0;
    let budget = FALLBACK_CALL_BUDGET;
    let exhausted = false;
    const fallbackWorker = async (): Promise<void> => {
      for (;;) {
        const workIndex = next;
        next += 1;
        if (workIndex >= fallbackWork.length || exhausted) return;
        if (budget <= 0) return; // budget spent — surplus posts stay unseen (D3)
        budget -= 1;
        const item = fallbackWork[workIndex];
        if (item === undefined) continue;
        try {
          const verdict = await judgePost(
            item.post,
            state,
            keywords,
            fetchFn,
            reasoningEffort,
            now,
            sleepFn,
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
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, fallbackWork.length) }, fallbackWorker),
    );
    if (exhausted) {
      throw rotationExhausted(failuresFromCooldowns(state));
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
  return { judged, skippedPostIds };
}
