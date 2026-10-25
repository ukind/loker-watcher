/**
 * LLM relevance and location judge for candidate Threads posts (FRD #4, #5, D3).
 *
 * Uses an OpenAI-compatible chat completions endpoint (global fetch, no SDK
 * dependency). Calls the endpoint once per candidate post with strict JSON output:
 * {"relevant": boolean, "locationOk": boolean}.
 *
 * Retries once on HTTP failure or JSON parse error. If both attempts fail, the
 * post is skipped for this run, logged visibly, and omitted from state (D3).
 */
import { ENV_NAMES } from "./config.js";
import type { JudgeVerdict, Post } from "./types.js";

const REQUEST_TIMEOUT_MS = 15_000;

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

/**
 * Build the chat completion messages for a given post.
 */
function buildMessages(post: Post): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content:
        "You are an automated evaluation filter for developer job alerts. " +
        "You determine if a social media post is a genuine job opening for frontend or fullstack web development, " +
        "and whether the position is in Indonesia or remote.",
    },
    {
      role: "user",
      content: `Analyze the following Threads post by @${post.author}:\n\n\\"${post.text}\\"\n\nDetermine two criteria:\n1. relevant: true ONLY if the post is a hiring announcement or job opening for frontend, fullstack, or closely adjacent web developer roles (e.g. React, Vue, Next.js, TypeScript, Node.js web development). Set false if it is a job seeker seeking work, an internship inquiry, training promotion, or non-web engineering role.\n2. locationOk: true ONLY if the job is located in Indonesia (e.g. Jakarta, Bali, Surabaya, hybrid in ID), or explicitly remote / work from anywhere. Set false if the role is on-site or hybrid in another country with no remote option.\n\nRespond with ONLY a raw JSON object matching this schema:\n{"relevant": boolean, "locationOk": boolean}`,
    },
  ];
}

/**
 * Judge a single post with up to 1 retry on HTTP or parsing failure.
 * Returns the verdict on success, or null if both attempts fail.
 */
export async function judgePost(
  post: Post,
  config: JudgeConfig,
  fetchFn: typeof fetch = fetch,
): Promise<JudgeVerdict | null> {
  const endpoint = config.baseUrl.endsWith("/chat/completions")
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const payload = {
    model: config.model,
    messages: buildMessages(post),
    temperature: 0,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchFn(endpoint, {
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
 * Sequentially evaluate candidate posts.
 * Collects successful verdicts and tracks skipped IDs (D3).
 */
export async function judgePosts(
  candidates: readonly Post[],
  config: JudgeConfig,
  fetchFn: typeof fetch = fetch,
): Promise<JudgeBatchResult> {
  const judged: JudgedPost[] = [];
  const skippedPostIds: string[] = [];

  for (const post of candidates) {
    const verdict = await judgePost(post, config, fetchFn);
    if (verdict !== null) {
      judged.push({ post, verdict });
    } else {
      skippedPostIds.push(post.id);
      console.warn(`judge: skipped post ${post.id} after retry failed`);
    }
  }

  return { judged, skippedPostIds };
}
