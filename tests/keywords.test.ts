import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterPostsByKeywords, matchesKeywords } from "../src/keywords.js";
import { loadWatcherConfig } from "../src/config-file.js";
import {
  judgePost,
  judgePosts,
  parseVerdict,
  resolveJudgeConfig,
  type JudgeConfig,
} from "../src/judge.js";
import type { Post } from "../src/types.js";

// The keyword list is a required parameter (Phase 10): watcher.config.json is
// the only source, so every case below passes the shipped list explicitly.
const CONFIG = await loadWatcherConfig("watcher.config.json");

describe("matchesKeywords", () => {
  it("matches common frontend and fullstack keywords", () => {
    assert.equal(matchesKeywords("We are hiring a Frontend Developer!", CONFIG.keywords), true);
    assert.equal(matchesKeywords("Looking for a full-stack engineer", CONFIG.keywords), true);
    assert.equal(matchesKeywords("Full Stack Developer needed immediately", CONFIG.keywords), true);
    assert.equal(matchesKeywords("Senior React dev wanted", CONFIG.keywords), true);
    assert.equal(matchesKeywords("Vue and Nuxt specialist needed", CONFIG.keywords), true);
    assert.equal(matchesKeywords("Next.js project open for contract", CONFIG.keywords), true);
    assert.equal(matchesKeywords("TypeScript / Node.js backend/frontend", CONFIG.keywords), true);
  });

  it("performs case-insensitive matching", () => {
    assert.equal(matchesKeywords("HIRING REACT DEVELOPER", CONFIG.keywords), true);
    assert.equal(matchesKeywords("vue.js programmer", CONFIG.keywords), true);
    assert.equal(matchesKeywords("Typescript Enthusiast", CONFIG.keywords), true);
    assert.equal(matchesKeywords("FRONT-END LEAD", CONFIG.keywords), true);
  });

  it("matches keywords embedded with punctuation or slashes", () => {
    assert.equal(matchesKeywords("Stack: React/Vue/Svelte", CONFIG.keywords), true);
    assert.equal(matchesKeywords("#frontend #reactjs", CONFIG.keywords), true);
    assert.equal(matchesKeywords("Web Dev (remote)", CONFIG.keywords), true);
  });

  it("handles compound variants such as reactjs and nodejs", () => {
    assert.equal(matchesKeywords("Looking for ReactJS engineer", CONFIG.keywords), true);
    assert.equal(matchesKeywords("Backend in NodeJS", CONFIG.keywords), true);
    assert.equal(matchesKeywords("NextJS fullstack", CONFIG.keywords), true);
  });

  it("rejects non-tech and non-matching job posts", () => {
    assert.equal(matchesKeywords("HIRING ‼️ Barista Waiter", CONFIG.keywords), false);
    assert.equal(matchesKeywords("HIRING!! CHATTER VA", CONFIG.keywords), false);
    assert.equal(matchesKeywords("Safety, Health and Environmental Officer Site Supervisor", CONFIG.keywords), false);
    assert.equal(matchesKeywords("Marketing manager needed in Bali", CONFIG.keywords), false);
    assert.equal(matchesKeywords("Graphic designer for clothing brand", CONFIG.keywords), false);
  });

  it("returns false for empty text or empty keywords", () => {
    assert.equal(matchesKeywords("", CONFIG.keywords), false);
    assert.equal(matchesKeywords("React developer", []), false);
  });

  it("supports a custom keyword list", () => {
    assert.equal(matchesKeywords("Python Django dev", ["python", "django"]), true);
    assert.equal(matchesKeywords("React dev", ["python", "django"]), false);
  });
});

describe("filterPostsByKeywords", () => {
  it("filters a list of posts down to matching ones", () => {
    const posts: Post[] = [
      {
        id: "1",
        text: "Hiring React developer in Jakarta",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        id: "2",
        text: "Hiring Barista in Bandung",
        author: "cafeindonesia",
        permalink: "https://www.threads.com/@cafeindonesia/post/2",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
      {
        id: "3",
        text: "Looking for Vue.js & TypeScript engineer (remote)",
        author: "startup",
        permalink: "https://www.threads.com/@startup/post/3",
        timestamp: "2026-10-24T02:00:00.000Z",
      },
    ];

    const filtered = filterPostsByKeywords(posts, CONFIG.keywords);
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0]?.id, "1");
    assert.equal(filtered[1]?.id, "3");
  });
});

describe("matchesKeywords with the shipped config", () => {
  it("rejects the non-tech hiring posts in the tag-page fixture", () => {
    assert.equal(matchesKeywords("HIRING ‼️ Barista Waiter", CONFIG.keywords), false);
    assert.equal(matchesKeywords("HIRING!! CHATTER VA", CONFIG.keywords), false);
    assert.equal(
      matchesKeywords("Safety, Health and Environmental Officer", CONFIG.keywords),
      false,
    );
  });

  it("accepts a frontend posting", () => {
    assert.equal(
      matchesKeywords("Hiring React developer in Jakarta", CONFIG.keywords),
      true,
    );
  });
});

describe("parseVerdict", () => {
  it("parses clean JSON objects", () => {
    const verdict = parseVerdict('{"relevant": true, "locationOk": false}');
    assert.deepEqual(verdict, { relevant: true, locationOk: false });
  });

  it("parses markdown code fenced JSON", () => {
    const raw = "```json\n{\"relevant\": true, \"locationOk\": true}\n```";
    assert.deepEqual(parseVerdict(raw), { relevant: true, locationOk: true });
  });

  it("parses JSON with surrounding conversational text", () => {
    const raw = "Here is the verdict: {\"relevant\": false, \"locationOk\": false}. Let me know!";
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
    assert.throws(
      () => resolveJudgeConfig({}),
      /missing required environment variables/,
    );
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

    const verdict = await judgePost(samplePost, sampleConfig, mockFetch as unknown as typeof fetch);
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

    const verdict = await judgePost(samplePost, sampleConfig, mockFetch as unknown as typeof fetch);
    assert.equal(callCount, 2);
    assert.deepEqual(verdict, { relevant: false, locationOk: true });
  });

  it("returns null after two failed attempts", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount += 1;
      return new Response("Server Error", { status: 500 });
    };

    const verdict = await judgePost(samplePost, sampleConfig, mockFetch as unknown as typeof fetch);
    assert.equal(callCount, 2);
    assert.equal(verdict, null);
  });
});

describe("judgePosts", () => {
  it("batches posts and records skipped IDs on failure", async () => {
    const posts: Post[] = [
      {
        id: "101",
        text: "Hiring Next.js dev",
        author: "nextco",
        permalink: "https://www.threads.com/@nextco/post/101",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        id: "102",
        text: "Failing post",
        author: "badco",
        permalink: "https://www.threads.com/@badco/post/102",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
    ];

    const mockFetch = async (_url: unknown, options: unknown) => {
      const opts = options as { body: string };
      if (opts.body.includes("Failing post")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"relevant": true, "locationOk": true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await judgePosts(
      posts,
      { baseUrl: "https://mock.api/v1", apiKey: "k", model: "m" },
      mockFetch as unknown as typeof fetch,
    );

    assert.equal(result.judged.length, 1);
    assert.equal(result.judged[0]?.post.id, "101");
    assert.deepEqual(result.skippedPostIds, ["102"]);
  });
});
