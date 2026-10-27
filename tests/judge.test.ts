import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type LlmAccount,
  type RotationExhausted,
  type RotationState,
  isRotationExhausted,
  judgePost,
  judgePosts,
  parseBulkVerdicts,
  parseJudgeConcurrency,
  parseLlmAccounts,
  parseVerdict,
  resolveJudgeConfig,
} from "../src/judge.js";
import type { Post } from "../src/types.js";

// The keyword list is a required judge parameter (D3): every case below passes
// an explicit list, mirroring how index.ts feeds config.keywords to the judge.
const KEYWORDS = ["frontend", "fullstack", "react", "next.js"];

/** A healthy one-account pool for tests that never touch rotation. */
const singleAccount: LlmAccount[] = [
  { baseUrl: "https://mock.api/v1", apiKey: "test-key", model: "test-model" },
];

/** Two-account pool with distinct hosts — tests branch on URL, never call order. */
function twoAccounts(): LlmAccount[] {
  return [
    { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
    { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
  ];
}

/** Three-account pool — the CAS test needs a third rung so a vacuous
 * guard (which cascades the pool through one worker) is exposed. */
function threeAccounts(): LlmAccount[] {
  return [
    { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
    { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
    { baseUrl: "https://account-three.api/v1", apiKey: "key-3", model: "model-3" },
  ];
}

/** Fresh run-level state for direct judgePost calls. */
function freshState(accounts: LlmAccount[]): RotationState {
  return { accounts, index: 0, failures: [] };
}

/**
 * Fetch that records "host Authorization" per call, always 429s account-one
 * and bulk-answers account-two by echoing the ids in the prompt. Tests
 * branch on the URL (distinct host per account), never on call order.
 */
function accountTwoAnswering(auths: string[]): typeof fetch {
  return (async (url: unknown, options?: unknown): Promise<Response> => {
    const headers = (options as { headers: Record<string, string> }).headers;
    auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
    if (String(url).includes("account-one")) {
      return new Response("Too Many Requests", { status: 429 });
    }
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
      (match) => match[1] ?? "",
    );
    return ok(bulkContent(ids));
  }) as unknown as typeof fetch;
}

/** Chat-completions success body carrying one message content string. */
function ok(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Post ids are 19-digit numeric strings — never Number-coerced. */
const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

function bulkPost(id: string): Post {
  return {
    id,
    text: `Hiring a frontend developer — post ${id}`,
    author: "techco",
    permalink: `https://www.threads.com/@techco/post/${id}`,
    timestamp: "2026-10-24T00:00:00.000Z",
  };
}

/** Bulk verdict body covering exactly the given ids. */
function bulkContent(ids: readonly string[]): string {
  return JSON.stringify(
    Object.fromEntries(ids.map((id) => [id, { relevant: true, locationOk: true }])),
  );
}

describe("parseVerdict", () => {
  it("parses clean JSON objects", () => {
    const verdict = parseVerdict('{"relevant": true, "locationOk": false}');
    assert.deepEqual(verdict, { relevant: true, locationOk: false });
  });

  it("parses markdown code fenced JSON", () => {
    const raw = '```json\n{"relevant": true, "locationOk": true}\n```';
    assert.deepEqual(parseVerdict(raw), { relevant: true, locationOk: true });
  });

  it("parses JSON with surrounding conversational text", () => {
    const raw = 'Here is the verdict: {"relevant": false, "locationOk": false}. Let me know!';
    assert.deepEqual(parseVerdict(raw), { relevant: false, locationOk: false });
  });

  it("returns null for malformed or non-boolean JSON", () => {
    assert.equal(parseVerdict("not json"), null);
    assert.equal(parseVerdict('{"relevant": "yes", "locationOk": true}'), null);
    assert.equal(parseVerdict('{"relevant": true}'), null);
    assert.equal(parseVerdict(""), null);
  });
});

describe("resolveJudgeConfig", () => {
  it("returns the parsed account pool from LLM_ACCOUNTS", () => {
    const accounts = resolveJudgeConfig({
      LLM_ACCOUNTS: JSON.stringify([
        { baseUrl: "https://api.openai.com/v1", apiKey: "secret-key", model: "gpt-4o-mini" },
      ]),
    });
    assert.deepEqual(accounts, [
      { baseUrl: "https://api.openai.com/v1", apiKey: "secret-key", model: "gpt-4o-mini" },
    ]);
  });

  it("throws naming LLM_ACCOUNTS when the variable is missing", () => {
    assert.throws(() => resolveJudgeConfig({}), /LLM_ACCOUNTS/);
  });
});

describe("parseLlmAccounts", () => {
  it("parses a valid pool in order, trimming fields", () => {
    const accounts = parseLlmAccounts({
      LLM_ACCOUNTS: JSON.stringify([
        { baseUrl: " https://api.a.com/v1 ", apiKey: " key-a ", model: " model-a " },
      ]),
    });
    assert.deepEqual(accounts, [
      { baseUrl: "https://api.a.com/v1", apiKey: "key-a", model: "model-a" },
    ]);
  });

  it("throws naming LLM_ACCOUNTS when the variable is missing or blank", () => {
    assert.throws(() => parseLlmAccounts({}), /LLM_ACCOUNTS/);
    assert.throws(() => parseLlmAccounts({ LLM_ACCOUNTS: "   " }), /LLM_ACCOUNTS/);
  });

  it("throws with the parser message when the JSON is malformed", () => {
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: "{not json" }),
      /LLM_ACCOUNTS.*not valid JSON/s,
    );
  });

  it("throws naming LLM_ACCOUNTS when the value is not an array or is empty", () => {
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: JSON.stringify({ baseUrl: "x" }) }),
      /LLM_ACCOUNTS.*must be a JSON array/s,
    );
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: "[]" }),
      /LLM_ACCOUNTS.*must not be empty/s,
    );
  });

  it("throws naming the index for a non-object item", () => {
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: JSON.stringify(["nope"]) }),
      /LLM_ACCOUNTS\[0\]/,
    );
  });

  it("throws naming the index and field for a missing or blank field", () => {
    const missing = JSON.stringify([{ baseUrl: "https://a", apiKey: "k" }]);
    assert.throws(() => parseLlmAccounts({ LLM_ACCOUNTS: missing }), /LLM_ACCOUNTS\[0\]\.model/);
    const blank = JSON.stringify([{ baseUrl: "https://a", apiKey: "  ", model: "m" }]);
    assert.throws(() => parseLlmAccounts({ LLM_ACCOUNTS: blank }), /LLM_ACCOUNTS\[0\]\.apiKey/);
  });
});

describe("parseJudgeConcurrency", () => {
  it("defaults to 4 when the variable is absent", () => {
    assert.equal(parseJudgeConcurrency(undefined), 4);
  });

  it("defaults to 4 when the variable is blank", () => {
    assert.equal(parseJudgeConcurrency(""), 4);
    assert.equal(parseJudgeConcurrency("   "), 4);
  });

  it("parses a positive integer with surrounding whitespace", () => {
    assert.equal(parseJudgeConcurrency("8"), 8);
    assert.equal(parseJudgeConcurrency(" 16 "), 16);
  });

  it("throws naming the variable for zero, negative, fractional, or non-numeric values", () => {
    for (const bad of ["0", "-2", "2.5", "abc", "4px"]) {
      assert.throws(() => parseJudgeConcurrency(bad), /JUDGE_CONCURRENCY/);
    }
  });
});

describe("judgePost", () => {
  const samplePost: Post = {
    id: "100",
    text: "Hiring React developer in Jakarta",
    author: "techco",
    permalink: "https://www.threads.com/@techco/post/100",
    timestamp: "2026-10-24T00:00:00.000Z",
  };

  it("returns parsed verdict on successful API response", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"relevant": true, "locationOk": true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const verdict = await judgePost(
      samplePost,
      freshState(singleAccount),
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
  });

  it("retries on first failure and succeeds on second attempt", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response("Bad Gateway", { status: 502 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"relevant": false, "locationOk": true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const verdict = await judgePost(
      samplePost,
      freshState(singleAccount),
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(callCount, 2);
    assert.deepEqual(verdict, { relevant: false, locationOk: true });
  });

  it("returns null after two failed attempts", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount += 1;
      return new Response("Server Error", { status: 500 });
    };

    const verdict = await judgePost(
      samplePost,
      freshState(singleAccount),
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(callCount, 2);
    assert.equal(verdict, null);
  });

  it("judgePost rotates on a 429 without spending a fallback attempt", async () => {
    const state = freshState(twoAccounts());
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (String(url).includes("account-one")) {
        return new Response("Too Many Requests", { status: 429 });
      }
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const verdict = await judgePost(samplePost, state, KEYWORDS, mockFetch);
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
    assert.deepEqual(
      state.failures.map((f) => f.account),
      [1],
    );
    assert.equal(state.index, 1);
    assert.equal(auths.length, 2);
  });

  it("judgePost throws the tagged error when rotation runs out mid-fallback", async () => {
    const state = freshState(twoAccounts());
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    await assert.rejects(
      () => judgePost(samplePost, state, KEYWORDS, mockFetch),
      (error: unknown) => isRotationExhausted(error),
    );
    assert.deepEqual(
      state.failures.map((f) => f.account),
      [1, 2],
    );
  });
});

describe("parseBulkVerdicts", () => {
  it("parses an id-keyed verdict object into a Map", () => {
    const verdicts = parseBulkVerdicts(
      '{"7224638912743920001": {"relevant": true, "locationOk": false}}',
    );
    assert.equal(verdicts?.size, 1);
    assert.deepEqual(verdicts?.get("7224638912743920001"), { relevant: true, locationOk: false });
  });

  it("tolerates code fences and surrounding text", () => {
    const raw = [
      "Here you go:",
      "```json",
      '{"1": {"relevant": false, "locationOk": true}}',
      "```",
      "Done.",
    ].join("\n");
    const verdicts = parseBulkVerdicts(raw);
    assert.deepEqual(verdicts?.get("1"), { relevant: false, locationOk: true });
  });

  it("keeps 19-digit ids exact, never Number-coerced", () => {
    const id = "7224638912743920001";
    const verdicts = parseBulkVerdicts(
      JSON.stringify({ [id]: { relevant: true, locationOk: true } }),
    );
    assert.ok(verdicts?.has(id));
  });

  it("keeps hostile keys as data, not prototype pollution", () => {
    const verdicts = parseBulkVerdicts('{"__proto__": {"relevant": true, "locationOk": true}}');
    assert.deepEqual(verdicts?.get("__proto__"), { relevant: true, locationOk: true });
  });

  it("drops malformed items without failing the batch", () => {
    const verdicts = parseBulkVerdicts(
      '{"1": {"relevant": true, "locationOk": true}, "2": {"relevant": "yes"}, "3": "broken"}',
    );
    assert.equal(verdicts?.size, 1);
    assert.ok(verdicts?.has("1"));
    assert.equal(verdicts?.has("2"), false);
  });

  it("returns an empty Map when the container parses but no item is valid", () => {
    const verdicts = parseBulkVerdicts('{"relevant": true}');
    assert.ok(verdicts !== null);
    assert.equal(verdicts.size, 0);
  });

  it("returns null for unrecoverable containers", () => {
    assert.equal(parseBulkVerdicts("not json"), null);
    assert.equal(parseBulkVerdicts(""), null);
    assert.equal(parseBulkVerdicts("[1, 2, 3]"), null);
    assert.equal(parseBulkVerdicts("no braces here"), null);
  });
});

describe("judgePosts", () => {
  /**
   * Bulk-answering fetch that records the in-flight call peak in `state`.
   * Answers every batch by echoing the ids it finds in the request prompt,
   * so no post falls back and the call count stays at one per batch.
   */
  function measuredFetch(state: { inFlight: number; peak: number }) {
    return async (_url: unknown, options?: unknown): Promise<Response> => {
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1)); // let peers enter
      state.inFlight -= 1;
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
        (match) => match[1] ?? "",
      );
      return ok(bulkContent(ids));
    };
  }

  /**
   * Bulk calls answer unparseable text (every post falls back); single-post
   * calls answer a valid verdict. Discriminates by the bulk prompt's
   * distinctive opening. Records call count and the in-flight peak, so the
   * fallback pool's width is observable. Uses the singleAccount pool, so
   * rotation never fires and every call carries key "test-key".
   */
  function bulkMissThenAnswer(state: { inFlight: number; peak: number; calls: number }) {
    return async (_url: unknown, options?: unknown): Promise<Response> => {
      state.calls += 1;
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1)); // let peers enter
      state.inFlight -= 1;
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("I cannot judge these posts."); // answered-but-unparseable: every post falls back
      }
      return ok('{"relevant": true, "locationOk": false}');
    };
  }

  it("judges ten posts with a single bulk call", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => bulkPost(id19(i + 1)));
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      return ok(bulkContent(posts.map((p) => p.id)));
    };

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 1);
    assert.equal(result.skippedPostIds.length, 0);
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts.map((p) => p.id),
    );
    assert.ok(result.judged.every((j) => j.verdict.relevant && j.verdict.locationOk));
  });

  it("chunks fifteen posts into two bulk calls", async () => {
    const posts = Array.from({ length: 15 }, (_, i) => bulkPost(id19(i + 1)));
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      return ok(bulkContent(posts.map((p) => p.id)));
    };

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 2);
    assert.equal(result.judged.length, 15);
    assert.equal(result.skippedPostIds.length, 0);
  });

  it("falls back to the single-post call only for items missing from the bulk response", async () => {
    const a = bulkPost(id19(1));
    const b = { ...bulkPost(id19(2)), text: "Second post text" };
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return ok(bulkContent([a.id])); // bulk covers a only — b is missing
      }
      return ok('{"relevant": false, "locationOk": true}');
    };

    const result = await judgePosts(
      [a, b],
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 2); // one bulk + one fallback — a is never re-judged
    assert.equal(result.judged.length, 2);
    assert.deepEqual(result.skippedPostIds, []);
    assert.deepEqual(result.judged.find((j) => j.post.id === b.id)?.verdict, {
      relevant: false,
      locationOk: true,
    });
  });

  it("skips a post whose bulk verdict is missing and fallback fails twice", async () => {
    const good = bulkPost(id19(1));
    const bad = { ...bulkPost(id19(2)), text: "Failing post" };
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return ok(bulkContent([good.id])); // bulk misses the bad post
      }
      return new Response("Internal Server Error", { status: 500 }); // fallback 500s twice
    };

    const result = await judgePosts(
      [good, bad],
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 3); // 1 bulk (no batch retry) + 2 fallback attempts
    assert.equal(result.judged.length, 1);
    assert.equal(result.judged[0]?.post.id, good.id);
    assert.deepEqual(result.skippedPostIds, [bad.id]);
  });

  it("defers a wholly unanswered batch without firing fallback calls", async () => {
    const posts = [bulkPost(id19(1)), bulkPost(id19(2))];
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      // A non-retryable status defers on the first attempt — a bad request
      // will not fix itself. The retryable 429/5xx paths have their own
      // tests below.
      return new Response("Forbidden", { status: 403 });
    };

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 1); // one batch attempt, zero retries, zero fallback calls
    assert.equal(result.judged.length, 0);
    assert.deepEqual(
      result.skippedPostIds,
      posts.map((p) => p.id),
    );
  });

  it("defers a batch whose request times out", async () => {
    const posts = [bulkPost(id19(1)), bulkPost(id19(2))];
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      throw new Error("The operation was aborted due to timeout");
    };

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 1); // a transport error defers with zero retries
    assert.equal(result.judged.length, 0);
    assert.deepEqual(
      result.skippedPostIds,
      posts.map((p) => p.id),
    );
  });

  it("still falls back per item when the batch answers with unparseable text", async () => {
    const a = bulkPost(id19(1));
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return ok("I cannot judge these posts."); // answered, but not JSON
      }
      return ok('{"relevant": true, "locationOk": true}');
    };

    const result = await judgePosts(
      [a],
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 2); // one batch + one fallback — a parse miss is not a transport failure
    assert.equal(result.judged.length, 1);
    assert.deepEqual(result.skippedPostIds, []);
  });

  it("sends the json_object rider and the keyword criterion on the bulk call only", async () => {
    const a = bulkPost(id19(1));
    const b = bulkPost(id19(2));
    const bodies: string[] = [];
    const mockFetch = async (_url: unknown, options?: unknown) => {
      bodies.push((options as { body: string }).body);
      if (bodies.length === 1) {
        return ok(bulkContent([a.id])); // b falls back
      }
      return ok('{"relevant": true, "locationOk": true}');
    };

    await judgePosts([a, b], singleAccount, KEYWORDS, mockFetch as unknown as typeof fetch);
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0]?.includes('"response_format":{"type":"json_object"}'));
    // "next.js" occurs only in the serialized keyword list — a discriminating token.
    assert.ok(bodies[0]?.includes("next.js"));
    assert.ok(!bodies[1]?.includes('"response_format"')); // fallback payload carries no rider
    assert.ok(bodies[1]?.includes("next.js")); // and the fallback system message
  });

  it("peaks at exactly the configured concurrency for a 280-post backlog", async () => {
    const posts = Array.from({ length: 280 }, (_, i) => bulkPost(id19(i + 1))); // 28 batches
    const width = 4;
    const state = { inFlight: 0, peak: 0 };
    const mockFetch = measuredFetch(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      width,
    );
    assert.equal(state.peak, width); // exactly the passed width, never more
    assert.equal(result.judged.length, 280);
    assert.deepEqual(result.skippedPostIds, []);
  });

  it("peaks at min(concurrency, batches) in-flight calls for a short list", async () => {
    const posts = Array.from({ length: 25 }, (_, i) => bulkPost(id19(i + 1))); // 3 batches
    const width = 2;
    const batchCount = Math.ceil(posts.length / 10); // BATCH_SIZE mirror
    const state = { inFlight: 0, peak: 0 };
    const mockFetch = measuredFetch(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      width,
    );
    assert.equal(state.peak, Math.min(width, batchCount));
    assert.equal(result.judged.length, 25);
  });

  it("drains fallback-needed posts through a pool at the configured width, in input order", async () => {
    const posts = Array.from({ length: 20 }, (_, i) => bulkPost(id19(i + 1))); // 2 batches
    const width = 3;
    const state = { inFlight: 0, peak: 0, calls: 0 };
    const mockFetch = bulkMissThenAnswer(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      width,
    );

    // The bulk phase peaks at 2 (two batches) — only the fallback pool can
    // reach the configured width.
    assert.equal(state.peak, width);
    assert.equal(state.calls, 2 + 20); // 2 bulk + 20 single-post calls
    assert.equal(result.judged.length, 20);
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts.map((p) => p.id),
    );
    // every verdict carries the fallback shape, not a bulk echo
    assert.ok(result.judged.every((j) => j.verdict.relevant && !j.verdict.locationOk));
    assert.deepEqual(result.skippedPostIds, []);
  });

  it("spends the 40-call fallback budget, then leaves the surplus unseen in input order", async () => {
    const posts = Array.from({ length: 50 }, (_, i) => bulkPost(id19(i + 1))); // 5 batches
    const state = { inFlight: 0, peak: 0, calls: 0 };
    const mockFetch = bulkMissThenAnswer(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );

    assert.equal(state.calls, 5 + 40); // 5 bulk + the 40-call budget, never more
    assert.equal(result.judged.length, 40); // FALLBACK_CALL_BUDGET posts judged
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts
        .slice(0, 40)
        .map((p) => p.id), // the budget feeds the head of the input order
    );
    assert.deepEqual(
      result.skippedPostIds,
      posts
        .slice(40)
        .map((p) => p.id), // the tail starves, in order
    );
  });

  it("keeps input order when one parallel fallback fails among successes", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("I cannot judge these posts.");
      }
      if (content.includes(id19(5))) {
        return new Response("Internal Server Error", { status: 500 }); // both attempts fail
      }
      return ok('{"relevant": true, "locationOk": false}');
    };

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );

    assert.equal(result.judged.length, 9);
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts.filter((p) => p.id !== id19(5)).map((p) => p.id),
    );
    assert.deepEqual(result.skippedPostIds, [id19(5)]);
  });

  it("drain-then-throw: a pool exhausted mid-fallback rejects judgePosts with the complete record", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = (async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("{}"); // answered, zero verdicts — every post falls back
      }
      return new Response("Too Many Requests", { status: 429 }); // rotation burns both accounts
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch);
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as RotationExhausted).failures.map((f) => f.account),
      [1, 2],
    );
  });

  it("defers K in-flight batches whole when a burst demotes the first wave at width > 1 (1d4faed)", async () => {
    const posts = Array.from({ length: 30 }, (_, i) => bulkPost(id19(i + 1))); // 3 batches
    const width = 2;
    const state = { inFlight: 0, peak: 0 };
    // Mirror of the suite's spent-backoff defer pin: bulk calls for the
    // first wave's batches always fail retryable, so both batches exhaust
    // backoff and defer whole at the same time; the third batch answers
    // on its first try.
    const burstIds = new Set([id19(1), id19(11)]); // one id per demoted batch
    const mockFetch = async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (!content.includes("Judge each Threads post below")) {
        return ok('{"relevant": true, "locationOk": false}');
      }
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1)); // let peers enter
      state.inFlight -= 1;
      if ([...burstIds].some((id) => content.includes(id))) {
        return new Response("Internal Server Error", { status: 500 });
      }
      // Real bulk shape: an id->verdict map for exactly the listed ids, so
      // the surviving batch is judged through the bulk path, never the fallback.
      const answer: Record<string, { relevant: boolean; locationOk: boolean }> = {};
      for (const id of content.match(/\b\d{16,}\b/g) ?? []) {
        answer[id] = { relevant: true, locationOk: false };
      }
      return ok(JSON.stringify(answer));
    };

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      width,
    );

    // The burst defers BOTH first-wave batches whole: their 20 posts are
    // skipped in input order, none is judged, and the surviving batch
    // reassembles in input order.
    assert.ok(state.peak <= width);
    assert.equal(result.judged.length, 10);
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts.slice(20).map((p) => p.id),
    );
    assert.deepEqual(
      result.skippedPostIds,
      posts.slice(0, 20).map((p) => p.id),
    );
  });

  it("keeps candidate order when batches resolve out of order", async () => {
    const posts = Array.from({ length: 40 }, (_, i) => bulkPost(id19(i + 1))); // 4 batches
    const resolvers: Array<(response: Response) => void> = [];
    const mockFetch = async (): Promise<Response> =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      });
    const pending = judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    // Wait until all four workers have parked their batch call.
    await new Promise<void>((resolveQueued) => {
      const wait = (): void => {
        if (resolvers.length === 4) resolveQueued();
        else setTimeout(wait, 1);
      };
      wait();
    });
    // Resolve the last batch first; batch 1 defers on a non-retryable status.
    for (let i = resolvers.length - 1; i >= 0; i -= 1) {
      if (i === 1) {
        resolvers[i]?.(new Response("Forbidden", { status: 403 }));
        continue;
      }
      const batchIds = posts.slice(i * 10, (i + 1) * 10).map((p) => p.id);
      resolvers[i]?.(ok(bulkContent(batchIds)));
    }
    const result = await pending;

    const expectedJudged = [...posts.slice(0, 10), ...posts.slice(20)].map((p) => p.id);
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      expectedJudged,
    );
    assert.deepEqual(
      result.skippedPostIds,
      posts.slice(10, 20).map((p) => p.id),
    );
  });

  it("rotates to account 2 on the first 429 with no backoff wait", async () => {
    const posts = [bulkPost(id19(1))];
    const auths: string[] = [];
    const started = Date.now();
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, accountTwoAnswering(auths));
    const elapsed = Date.now() - started;
    assert.equal(result.judged.length, 1);
    assert.match(auths[0] ?? "", /account-one\.api .*key-1$/);
    assert.match(auths[1] ?? "", /account-two\.api .*key-2$/);
    assert.ok(elapsed < 500, `rotation must not sleep — took ${elapsed}ms`);
  });

  it("keeps the sticky pointer across the fallback phase", async () => {
    const a = bulkPost(id19(1));
    const b = { ...bulkPost(id19(2)), text: "Second post text" };
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (String(url).includes("account-one")) {
        return new Response("Too Many Requests", { status: 429 });
      }
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
        response_format?: unknown;
      };
      // Bulk calls answer the FIRST listed id only, so the second post falls
      // back; a single-post call (no response_format rider) answers itself.
      if (body.response_format === undefined) {
        return ok('{"relevant": true, "locationOk": true}');
      }
      const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
        (match) => match[1] ?? "",
      );
      return ok(bulkContent(ids.slice(0, 1)));
    }) as unknown as typeof fetch;
    const result = await judgePosts([a, b], twoAccounts(), KEYWORDS, mockFetch);
    assert.equal(result.judged.length, 2);
    assert.equal(auths.length, 3); // 429 call, bulk call, fallback call
    assert.match(auths[0] ?? "", /key-1$/);
    assert.ok(auths.slice(1).every((auth) => auth.includes("key-2")));
  });

  it("retries a 5xx on the same account with backoff, never rotating", async () => {
    const posts = [bulkPost(id19(1))];
    const auths: string[] = [];
    let calls = 0;
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      calls += 1;
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (calls === 1) {
        return new Response("Bad Gateway", { status: 502 });
      }
      return ok(bulkContent(posts.map((p) => p.id)));
    }) as unknown as typeof fetch;
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch);
    assert.equal(calls, 2); // one 502 + one same-account retry (~1s real sleep)
    assert.equal(result.judged.length, 1);
    assert.ok(auths.every((auth) => auth.includes("key-1"))); // a 5xx never rotates
  });

  it("defers a batch on a transport error without rotating", async () => {
    const posts = [bulkPost(id19(1))];
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch);
    assert.equal(result.judged.length, 0);
    assert.deepEqual(
      result.skippedPostIds,
      posts.map((p) => p.id),
    );
    assert.equal(auths.length, 1); // zero retries
    assert.match(auths[0] ?? "", /key-1$/); // the pointer never moved
  });

  it("advances the pointer exactly once per account under concurrent 429s", async () => {
    const posts = Array.from({ length: 40 }, (_, i) => bulkPost(id19(i + 1))); // 4 batches
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      return new Response("Too Many Requests", { status: 429 });
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await judgePosts(posts, threeAccounts(), KEYWORDS, mockFetch);
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    const failures = (caught as RotationExhausted).failures;
    // The compare-and-set proof: exactly one failure per account, in pool
    // order.
    assert.deepEqual(
      failures.map((f) => f.account),
      [1, 2, 3],
    );
    assert.ok(failures.every((f) => f.reason === "HTTP 429"));
    // Every account was tried by MORE THAN ONE worker: a vacuous guard
    // (fresh index read beside the compare) lets the first completer
    // cascade the whole pool alone — one key-2 and one key-3 call — while
    // a true compare-and-set sends every parked worker forward together.
    const count = (key: string): number => auths.filter((auth) => auth.includes(key)).length;
    assert.ok(count("key-2") >= 2, `account 2 dispatched ${count("key-2")} time(s)`);
    assert.ok(count("key-3") >= 2, `account 3 dispatched ${count("key-3")} time(s)`);
    // Pointer monotonicity: no call on a lower account's key after the
    // first call on a higher one.
    const firstKey2 = auths.findIndex((auth) => auth.includes("key-2"));
    const lastKey1 = auths.map((auth) => auth.includes("key-1")).lastIndexOf(true);
    assert.ok(firstKey2 > lastKey1);
    const firstKey3 = auths.findIndex((auth) => auth.includes("key-3"));
    const lastKey2 = auths.map((auth) => auth.includes("key-2")).lastIndexOf(true);
    assert.ok(firstKey3 > lastKey2);
  });
});
