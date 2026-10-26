/**
 * Judge latency probe. Run inside GitHub Actions (workflow_dispatch only)
 * to measure how long the configured LLM endpoint really takes from a
 * runner. The plan's 15s timeout was validated only on a developer machine;
 * run 40264368939 proved the runner path is slower.
 *
 * Usage:
 *   LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... npx tsx scripts/probe-judge.ts
 * Exits 1 when any call fails, so a dead endpoint fails the step loudly.
 */
import { ENV_NAMES } from "../src/config.js";
import type { Post } from "../src/types.js";

const KEYWORDS = ["frontend", "fullstack", "web developer", "react", "typescript"];

/** Synthetic posts at realistic Threads length, so token counts match production. */
function syntheticPost(index: number): Post {
  return {
    id: `90000000000000000${index}`,
    author: `probe${index}`,
    permalink: `https://www.threads.com/@probe${index}/post/90000000000000000${index}`,
    timestamp: "2026-10-26T00:00:00.000Z",
    text: `Lowongan kerja probe post ${index}. We are hiring a frontend developer with React and TypeScript experience. Jakarta or remote. Kirim lamaran ke DM kami. Fresh graduate welcome, minimal 1 tahun pengalaman.`,
  };
}

/** The production bulk prompt shape: keyword criterion plus id+text pairs. */
function bulkMessages(posts: readonly Post[]): Array<{ role: string; content: string }> {
  const listing = posts
    .map((post) => `id ${post.id} by @${post.author}:\n"${post.text}"`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: `You are an automated evaluation filter for job alerts. A post is relevant when it is a genuine job opening related to at least one of these keywords: ${JSON.stringify(KEYWORDS)}. You also determine whether the position is in Indonesia or remote.`,
    },
    {
      role: "user",
      content: `Judge each Threads post below against the criteria.\n\n${listing}\n\nDetermine two criteria per post:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above.\n2. locationOk: true ONLY if the job is located in Indonesia, or explicitly remote.\n\nRespond with ONLY a raw JSON object mapping EACH post id above to its verdict:\n{"<post id>": {"relevant": boolean, "locationOk": boolean}}`,
    },
  ];
}

/** Time one call; return true when it answered with a JSON object. */
async function timed(
  label: string,
  payload: unknown,
  baseUrl: string,
  apiKey: string,
): Promise<boolean> {
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    const elapsed = Date.now() - started;
    const ok = response.ok && body.includes("{");
    console.log(
      `probe: ${label} — ${elapsed}ms — HTTP ${response.status} ${ok ? "OK" : "NO JSON"}`,
    );
    return ok;
  } catch (error) {
    const elapsed = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`probe: ${label} — ${elapsed}ms — FAILED: ${message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const baseUrl = process.env[ENV_NAMES.llmBaseUrl]?.trim();
  const apiKey = process.env[ENV_NAMES.llmApiKey]?.trim();
  const model = process.env[ENV_NAMES.llmModel]?.trim();
  if (!baseUrl || !apiKey || !model) {
    console.error(
      `probe: missing ${ENV_NAMES.llmBaseUrl}, ${ENV_NAMES.llmApiKey}, or ${ENV_NAMES.llmModel}`,
    );
    process.exit(1);
  }

  const minimal = await timed(
    "minimal call (one short message)",
    {
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      temperature: 0,
    },
    baseUrl,
    apiKey,
  );

  const ten = Array.from({ length: 10 }, (_, i) => syntheticPost(i + 1));
  const bulkPayload = {
    model,
    messages: bulkMessages(ten),
    temperature: 0,
    response_format: { type: "json_object" },
  };
  const bulk = await timed(
    "bulk call (10 posts, production prompt shape)",
    bulkPayload,
    baseUrl,
    apiKey,
  );
  const again = await timed(
    "bulk call again (10 posts, variance check)",
    bulkPayload,
    baseUrl,
    apiKey,
  );

  console.log(
    `probe: summary — minimal=${minimal ? "ok" : "fail"} bulk=${bulk ? "ok" : "fail"} bulkAgain=${again ? "ok" : "fail"}`,
  );
  if (!minimal || !bulk || !again) {
    process.exit(1);
  }
}

await main();
