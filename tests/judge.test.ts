import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type JudgeConfig,
  judgePost,
  judgePosts,
  parseBulkVerdicts,
  parseVerdict,
  resolveJudgeConfig,
} from "../src/judge.js";
import type { Post } from "../src/types.js";

// The keyword list is a required judge parameter (D3): every case below passes
// an explicit list, mirroring how index.ts feeds config.keywords to the judge.
const KEYWORDS = ["frontend", "fullstack", "react", "next.js"];

/** Chat-completions success body carrying one message content string. */
function ok(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
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
  it("extracts config from valid env", () => {
    const env = {
      LLM_BASE_URL: "https://api.openai.com/v1",
      LLM_API_KEY: "secret-key",
      LLM_MODEL: "gpt-4o-mini",
    };
    const config = resolveJudgeConfig(env);
    assert.deepEqual(config, {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret-key",
      model: "gpt-4o-mini",
    });
  });

  it("throws when required env variables are missing", () => {
    assert.throws(() => resolveJudgeConfig({}), /missing required environment variables/);
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

  const sampleConfig: JudgeConfig = {
    baseUrl: "https://mock.api/v1",
    apiKey: "test-key",
    model: "test-model",
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
      sampleConfig,
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
      sampleConfig,
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
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(callCount, 2);
    assert.equal(verdict, null);
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
  const sampleConfig: JudgeConfig = {
    baseUrl: "https://mock.api/v1",
    apiKey: "test-key",
    model: "test-model",
  };

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

  it("judges ten posts with a single bulk call", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => bulkPost(id19(i + 1)));
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      return ok(bulkContent(posts.map((p) => p.id)));
    };

    const result = await judgePosts(
      posts,
      sampleConfig,
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
      sampleConfig,
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
      sampleConfig,
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
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 3); // 1 bulk (no batch retry) + 2 fallback attempts
    assert.equal(result.judged.length, 1);
    assert.equal(result.judged[0]?.post.id, good.id);
    assert.deepEqual(result.skippedPostIds, [bad.id]);
  });

  it("routes a wholly failed batch through the fallback without a batch retry", async () => {
    const posts = [bulkPost(id19(1)), bulkPost(id19(2))];
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("Bad Gateway", { status: 502 }); // the one batch attempt
      }
      return ok('{"relevant": true, "locationOk": true}');
    };

    const result = await judgePosts(
      posts,
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 3); // 1 batch + 2 fallbacks — no second batch call
    assert.equal(result.judged.length, 2);
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

    await judgePosts([a, b], sampleConfig, KEYWORDS, mockFetch as unknown as typeof fetch);
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0]?.includes('"response_format":{"type":"json_object"}'));
    // "next.js" occurs only in the serialized keyword list — a discriminating token.
    assert.ok(bodies[0]?.includes("next.js"));
    assert.ok(!bodies[1]?.includes('"response_format"')); // fallback payload carries no rider
    assert.ok(bodies[1]?.includes("next.js")); // and the fallback system message
  });
});
