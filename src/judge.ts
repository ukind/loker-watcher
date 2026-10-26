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
 * A retryable HTTP status (429, 5xx) is retried with bounded backoff before
 * the batch is deferred; a transport error defers immediately — a rate
 * limit is not a transport failure. Batches drain through a bounded pool
 * of JUDGE_CONCURRENCY workers and reassemble in input order, so the worst
 * case is ceil(N/BATCH_SIZE) concurrent calls plus at most BATCH_SIZE
 * sequential fallbacks per affected batch. A post that fails both stages
 * is skipped for this run, logged visibly, and omitted from state (D3: it
 * stays unseen and retries next run).
 */
import { ENV_NAMES } from "./config.js";
import type { JudgeVerdict, Post } from "./types.js";

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
 * adjusts the limit dynamically, so the 429 backoff below is what keeps a
 * stale or optimistic value from costing a run its digest.
 */
const JUDGE_CONCURRENCY = 4;

/** HTTP statuses worth retrying: the endpoint is alive but refusing or busy. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Bounded backoff for a retryable status. Total added latency: 7s. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/** Sleep that a test can skip by injecting a fake timer. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface JudgeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
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
 * Resolve LLM configuration from the environment dictionary.
 * Throws when any mandatory variable is missing or blank.
 */
export function resolveJudgeConfig(
  env: Record<string, string | undefined> = process.env,
): JudgeConfig {
  const baseUrl = env[ENV_NAMES.llmBaseUrl]?.trim();
  const apiKey = env[ENV_NAMES.llmApiKey]?.trim();
  const model = env[ENV_NAMES.llmModel]?.trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push(ENV_NAMES.llmBaseUrl);
  if (!apiKey) missing.push(ENV_NAMES.llmApiKey);
  if (!model) missing.push(ENV_NAMES.llmModel);

  if (missing.length > 0) {
    throw new Error(`judge: missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model: model!,
  };
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

/** Result of one bulk call: a parsed container, or no usable answer. */
type BatchOutcome =
  | { status: "answered"; verdicts: Map<string, JudgeVerdict> }
  | { status: "unanswered" };

/**
 * One bulk call for up to BATCH_SIZE posts, with a bounded retry for
 * retryable statuses (429, 500, 502, 503, 504): the endpoint is alive but
 * refusing or busy, so seconds of backoff cost less than a deferred batch
 * at concurrency. Budget: RETRY_DELAYS_MS — 1s, 2s, 4s; once it is spent
 * the batch reports "unanswered".
 *
 * Returns "unanswered" when the endpoint did not produce a usable response
 * (a spent retry budget, a non-retryable HTTP failure, a request error, or
 * missing message content). A transport error gets zero retries: it
 * predicts fallback failure — the same endpoint answers the per-item calls
 * no faster — so the caller defers the whole batch instead of firing up to
 * 2*BATCH_SIZE more doomed calls. Measured on run 40264368939: one 15s
 * batch timeout cascaded into 20 more timeouts and burned 6.5 of the job's
 * 10 minutes for ~10 posts.
 *
 * Returns "answered" with whatever the container parsed into, including an
 * empty Map when the model answered with unparseable text. A parse-level
 * miss is a model failure, not a transport failure: the simpler single-post
 * prompt has a real chance, so the caller falls back per item.
 */
async function judgeBatch(
  batch: readonly Post[],
  config: JudgeConfig,
  keywords: readonly string[],
  fetchFn: typeof fetch,
  batchIndex: number,
): Promise<BatchOutcome> {
  // Built once, outside the retry loop: the prompt does not change between
  // attempts, so rebuilding it per attempt would waste work for nothing.
  const payload = {
    model: config.model,
    messages: buildBulkMessages(batch, keywords),
    temperature: 0,
    // Rider on the bulk path ONLY: the single-post fallback call keeps its
    // original payload shape (design scope boundary).
    response_format: { type: "json_object" },
  };

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetchFn(normalizeEndpoint(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        // A rate limit or a busy upstream is not a transport failure: the
        // same endpoint answers the retry. Back off and try again, and
        // defer only once the budget is spent.
        if (RETRYABLE_STATUSES.has(response.status) && attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 0;
          console.warn(
            `judge: batch ${batchIndex} (${batch.length} posts) HTTP ${response.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
          );
          await sleep(delay);
          continue;
        }
        console.warn(
          `judge: batch ${batchIndex} (${batch.length} posts) HTTP ${response.status} ${response.statusText} — skipping batch (posts stay unseen and retry next run)`,
        );
        return { status: "unanswered" };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string") {
        console.warn(
          `judge: batch ${batchIndex} (${batch.length} posts) missing message content — skipping batch (posts stay unseen and retry next run)`,
        );
        return { status: "unanswered" };
      }

      const verdicts = parseBulkVerdicts(rawContent);
      if (verdicts === null) {
        console.warn(
          `judge: batch ${batchIndex} (${batch.length} posts) failed to parse bulk verdicts: ${rawContent.slice(0, 100)} — falling back to single-post calls (up to 2 attempts per post)`,
        );
        return { status: "answered", verdicts: new Map() };
      }
      return { status: "answered", verdicts };
    } catch (error) {
      // A transport error still defers immediately — no retry, no fallback.
      // A dead socket predicts a dead fallback; a rate limit does not.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `judge: batch ${batchIndex} (${batch.length} posts) request error: ${message} — skipping batch (posts stay unseen and retry next run)`,
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
 * Kept as the fallback stage of the bulk path: same 2-attempt loop, same
 * warn lines, same payload shape — only the keyword-guided criterion and
 * the keywords parameter are new.
 */
export async function judgePost(
  post: Post,
  config: JudgeConfig,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<JudgeVerdict | null> {
  const payload = {
    model: config.model,
    messages: buildMessages(post, keywords),
    temperature: 0,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchFn(normalizeEndpoint(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        console.warn(
          `judge: post ${post.id} attempt ${attempt}/2 HTTP ${response.status} ${response.statusText}`,
        );
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const rawContent = data.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string") {
        console.warn(`judge: post ${post.id} attempt ${attempt}/2 missing message content`);
        continue;
      }

      const verdict = parseVerdict(rawContent);
      if (verdict !== null) {
        return verdict;
      }

      console.warn(
        `judge: post ${post.id} attempt ${attempt}/2 failed to parse JSON verdict: ${rawContent.slice(0, 100)}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`judge: post ${post.id} attempt ${attempt}/2 request error: ${msg}`);
    }
  }

  return null;
}

/**
 * Judge candidate posts in ~BATCH_SIZE-post bulk calls; every item the bulk
 * response misses or mangles falls back to the single-post judgePost.
 * Collects successful verdicts and tracks skipped IDs (D3). Never throws:
 * every LLM failure lands in skippedPostIds, so a bad endpoint cannot kill
 * the run before the digest and state stages.
 *
 * Batches drain through a bounded pool of JUDGE_CONCURRENCY workers, and
 * each result slot is indexed by batch number so the output reassembles in
 * input order even when batches finish out of order. A batch the endpoint
 * did not answer is deferred whole (see judgeBatch): its posts stay unseen
 * and retry on the next run. The worst case is therefore ceil(N/BATCH_SIZE)
 * concurrent calls plus at most BATCH_SIZE sequential fallbacks per
 * affected batch.
 */
export async function judgePosts(
  candidates: readonly Post[],
  config: JudgeConfig,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<JudgeBatchResult> {
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
      outcomes[index] = await judgeBatch(batch, config, keywords, fetchFn, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JUDGE_CONCURRENCY, batches.length) }, worker));

  const judged: JudgedPost[] = [];
  const skippedPostIds: string[] = [];
  for (const [index, batch] of batches.entries()) {
    const outcome = outcomes[index];
    if (outcome === undefined) continue;
    if (outcome.status === "unanswered") {
      for (const post of batch) skippedPostIds.push(post.id);
      console.warn(
        `judge: skipped batch ${index} of ${batch.length} post(s) after an unanswered bulk call; they stay unseen and retry next run`,
      );
      continue;
    }
    for (const post of batch) {
      const fromBulk = outcome.verdicts.get(post.id);
      const verdict = fromBulk ?? (await judgePost(post, config, keywords, fetchFn));
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
