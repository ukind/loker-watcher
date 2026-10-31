/**
 * Shared pure helpers for the judge suites (D3, F015): the six fixture
 * helpers every judge suite file would otherwise duplicate, moved verbatim
 * from tests/judge.test.ts. Doubles and mock-fetch factories stay per-suite
 * on purpose — only these pure values are shared. Type-only imports (D5):
 * erased at runtime, and the tests/*.test.ts glob never executes this file.
 */
import type { LlmAccount } from "../src/judge.js";
import type { Post } from "../src/types.js";

// The keyword list is a required judge parameter (D3): every case below passes
// an explicit list, mirroring how index.ts feeds config.keywords to the judge.
export const KEYWORDS = ["frontend", "fullstack", "react", "next.js"];

/** A healthy one-account pool for tests that never touch rotation. */
export const singleAccount: LlmAccount[] = [
  { baseUrl: "https://mock.api/v1", apiKey: "test-key", model: "test-model" },
];

/** Chat-completions success body carrying one message content string. */
export function ok(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Post ids are 19-digit numeric strings — never Number-coerced. */
export const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

export function bulkPost(id: string): Post {
  return {
    platform: "threads",
    id,
    text: `Hiring a frontend developer — post ${id}`,
    author: "techco",
    permalink: `https://www.threads.com/@techco/post/${id}`,
    timestamp: "2026-10-24T00:00:00.000Z",
  };
}

/** Bulk verdict body covering exactly the given ids. */
export function bulkContent(ids: readonly string[]): string {
  return JSON.stringify(
    Object.fromEntries(ids.map((id) => [id, { relevant: true, locationOk: true }])),
  );
}
