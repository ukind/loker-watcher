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
 * HTTP 429 is account-local: the judge rotates to the next LLM_ACCOUNTS
 * account with no backoff wait. A 5xx is retried on the same account with
 * bounded backoff before the batch is deferred; a transport error defers
 * immediately without rotating. When every account is exhausted the run
 * throws the tagged RotationExhausted error (one exhaustion email, exit 1 —
 * surfaced by index.ts). Batches drain through a bounded pool of
 * JUDGE_CONCURRENCY workers and reassemble in input order, so the worst
 * case is ceil(N/BATCH_SIZE) concurrent calls plus at most BATCH_SIZE
 * sequential fallbacks per affected batch. A post that fails both stages
 * is skipped for this run, logged visibly, and omitted from state (D3: it
 * stays unseen and retries next run).
 */
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
 * Bulk calls in flight at once. Ships at 4 — the agreed floor, low enough
 * for the lowest documented Z.AI tier. Phase 0's ramp reads the real
 * ceiling; raise this to that reading. Z.AI publishes no number and
 * adjusts the limit dynamically, so the account rotation on 429 below is
 * what keeps a stale or optimistic value from costing a run its digest.
 */
const JUDGE_CONCURRENCY = 4;

/**
 * HTTP statuses worth retrying on the SAME account: the endpoint is alive
 * but busy. 429 is handled separately — it is account-local and rotates to
 * the next account instead of waiting.
 */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
/** Bounded backoff for a retryable status. Total added latency: 7s. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/** Sleep that a test can skip by injecting a fake timer. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One LLM account from the LLM_ACCOUNTS pool (ordered; index 0 is tried first). */
export interface LlmAccount {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Run-level rotation state, owned by judgePosts and shared by reference with
 * every worker — the same closure-shared mutable pattern as the `next` batch
 * cursor (read and advance with no await between). `index` only moves
 * forward; `failures` records every account rotation left behind.
 */
export interface RotationState {
  readonly accounts: readonly LlmAccount[];
  index: number;
  readonly failures: AccountFailure[];
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
 * Advance the pool pointer past a rate-limited account. Compare-and-set:
 * the caller passes the DISPATCH-TIME index (the account its call actually
 * hit), so four workers that all 429'd on account 1 produce exactly one
 * advance and one failure record — the later completers no-op because the
 * pointer already moved. Without this guard the pointer would advance once
 * per 429 and skip accounts nobody has tried. Returns true when an account
 * remains to try.
 */
function rotateOnRateLimit(state: RotationState, failedIndex: number): boolean {
  if (state.index === failedIndex) {
    const failed = state.accounts[failedIndex];
    if (failed !== undefined) {
      state.failures.push({
        account: failedIndex + 1,
        baseUrl: failed.baseUrl,
        reason: "HTTP 429",
      });
    }
    state.index += 1;
  }
  return state.index < state.accounts.length;
}

/**
 * One bulk call for up to BATCH_SIZE posts against the current account.
 *
 * HTTP 429 is account-local: the failure is recorded, the pool pointer
 * rotates to the next account (compare-and-set — concurrent 429s advance
 * once), and the same call retries there with NO backoff wait. When the
 * pool is empty the batch reports "exhausted" and judgePosts throws after
 * the join.
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
): Promise<BatchOutcome> {
  // Built once, outside the retry loop: the prompt does not change between
  // attempts. The account (model + key + base URL) is read fresh per
  // attempt below, because a 429 rotation swaps it mid-loop.
  const messages = buildBulkMessages(batch, keywords);

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    // Pointer read at the top of every attempt, BEFORE the first await:
    // rotation advances synchronously inside the 429 branch, so nothing can
    // interleave between this read and the fetch dispatch (same discipline
    // as the next cursor in judgePosts). attemptIndex is the dispatch-time
    // observation — the account this call actually hit — and is what the
    // compare-and-set consumes when the 429 comes back.
    const attemptIndex = state.index;
    const account = state.accounts[attemptIndex];
    if (account === undefined) {
      return { status: "exhausted" };
    }
    const payload = {
      model: account.model,
      messages,
      temperature: 0,
      // Rider on the bulk path ONLY: the single-post fallback call keeps its
      // original payload shape (design scope boundary).
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
        // Account spent: record, rotate, retry the same call on the next
        // account immediately. The CAS consumes attemptIndex — the account
        // this call actually hit — so a worker whose account was already
        // rotated away by a peer is a no-op, not a second advance. The
        // rotation does not spend the backoff budget (attempt is rewound),
        // because rotation replaces the wait.
        if (response.status === 429) {
          const rotated = rotateOnRateLimit(state, attemptIndex);
          console.warn(
            `judge: batch ${batchIndex} account ${attemptIndex + 1} HTTP 429 — ${rotated ? `rotating to account ${state.index + 1}` : "no account left"}`,
          );
          if (!rotated) {
            return { status: "exhausted" };
          }
          attempt -= 1;
          continue;
        }
        // Busy upstream, same account, bounded backoff; defer once spent.
        if (RETRYABLE_STATUSES.has(response.status) && attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 0;
          console.warn(
            `judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) HTTP ${response.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
          );
          await sleep(delay);
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
 * HTTP 429 rotates the pool pointer exactly like judgeBatch (no backoff);
 * the rotation does not spend a fallback attempt. Running out of accounts
 * throws the tagged RotationExhausted error — judgePost runs sequentially
 * in judgePosts' reassembly loop (after the join), so the throw surfaces
 * directly. Other failures keep the original status-agnostic retry.
 */
export async function judgePost(
  post: Post,
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<JudgeVerdict | null> {
  const messages = buildMessages(post, keywords);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptIndex = state.index;
    const account = state.accounts[attemptIndex];
    if (account === undefined) {
      throw rotationExhausted(state.failures);
    }
    const payload = {
      model: account.model,
      messages,
      temperature: 0,
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
          const rotated = rotateOnRateLimit(state, attemptIndex);
          console.warn(
            `judge: post ${post.id} account ${attemptIndex + 1} HTTP 429 — ${rotated ? `rotating to account ${state.index + 1}` : "no account left"}`,
          );
          if (!rotated) {
            throw rotationExhausted(state.failures);
          }
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
 * Batches drain through a bounded pool of JUDGE_CONCURRENCY workers, and
 * each result slot is indexed by batch number so the output reassembles in
 * input order even when batches finish out of order. A batch the endpoint
 * did not answer is deferred whole (see judgeBatch): its posts stay unseen
 * and retry on the next run.
 *
 * Rotation state lives in this frame (run-sticky): after a failover every
 * later call in the run uses the new account, and the next run starts on
 * account 1 again. The pointer and failure list are shared by reference
 * with every worker exactly like the next cursor below — all reads and
 * advances are synchronous, so four workers stay coherent without locks.
 */
export async function judgePosts(
  candidates: readonly Post[],
  accounts: readonly LlmAccount[],
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<JudgeBatchResult> {
  const state: RotationState = { accounts, index: 0, failures: [] };

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
      outcomes[index] = await judgeBatch(batch, state, keywords, fetchFn, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JUDGE_CONCURRENCY, batches.length) }, worker));

  // Drain-then-throw: the join above let every in-flight batch finish, so
  // the failure record is complete. Throwing here (not inside a worker)
  // keeps sibling workers from mutating the record after the snapshot and
  // leaves the unjudged posts unseen — index.ts turns the error into the
  // exhaustion email and exit 1; state is never reached.
  if (outcomes.some((outcome) => outcome?.status === "exhausted")) {
    throw rotationExhausted(state.failures);
  }

  const judged: JudgedPost[] = [];
  const skippedPostIds: string[] = [];
  for (const [index, batch] of batches.entries()) {
    const outcome = outcomes[index];
    if (outcome === undefined) continue;
    if (outcome.status !== "answered") {
      // unanswered (normal defer) or exhausted (already thrown above — kept
      // for type safety): the batch's posts stay unseen.
      for (const post of batch) skippedPostIds.push(post.id);
      console.warn(
        `judge: skipped batch ${index} of ${batch.length} post(s) after an unanswered bulk call; they stay unseen and retry next run`,
      );
      continue;
    }
    for (const post of batch) {
      const fromBulk = outcome.verdicts.get(post.id);
      const verdict = fromBulk ?? (await judgePost(post, state, keywords, fetchFn));
      if (verdict !== null) {
        judged.push({ post, verdict });
      } else {
        skippedPostIds.push(post.id);
        console.warn(`judge: skipped post ${post.id} after bulk miss and retry`);
      }
    }
  }
  return { judged, skippedPostIds };
}
