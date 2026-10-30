/**
 * Rotation suite (F015): the cooldown, park-budget, and exhaustion cases
 * moved intact from tests/judge.test.ts along the F010 seam — the whole
 * describe("judgePost") plus the nine rotation-flavored judgePosts
 * integration cases.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type RotationExhausted,
  type RotationState,
  isRotationExhausted,
} from "../src/judge-rotation.js";
import { type LlmAccount, judgePost, judgePosts } from "../src/judge.js";
import type { Post } from "../src/types.js";
import { KEYWORDS, bulkContent, bulkPost, id19, ok, singleAccount } from "./judge-helpers.js";

/** Two-account pool with distinct hosts — tests branch on URL, never call order. */
function twoAccounts(): LlmAccount[] {
  return [
    { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
    { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
  ];
}

/** Three-account pool — the scan-dedup test needs a third rung so a vacuous
 * scan (which cascades the pool through one worker) is exposed. */
function threeAccounts(): LlmAccount[] {
  return [
    { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
    { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
    { baseUrl: "https://account-three.api/v1", apiKey: "key-3", model: "model-3" },
  ];
}

/** Fresh run-level state for direct judgePost calls. Canonical copy — the
 * waitBudgetRemainingMs literal mirrors the module-private WAIT_BUDGET_MS.
 * tests/judge.test.ts keeps a
 * mirroring copy for the residual its that call it directly (the two
 * reasoning_effort cases and the F022 single-post case). */
function freshState(accounts: LlmAccount[]): RotationState {
  // waitBudgetRemainingMs mirrors the module-private 3-minute WAIT_BUDGET_MS.
  return { accounts, cooldownUntil: new Map(), waitBudgetRemainingMs: 180_000 };
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

  it("judgePost cools a 429'd account and retries on the next without spending a fallback attempt", async () => {
    const state = freshState(twoAccounts());
    const auths: string[] = [];
    let tick = 0;
    const now = (): number => tick;
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (String(url).includes("account-one")) {
        tick = 1_000; // the 429 lands at t=1s; account 1 cools until t=61s
        return new Response("Too Many Requests", { status: 429 });
      }
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const verdict = await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now);
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
    assert.equal(auths.length, 2); // the cooling account is skipped, never retried
    assert.match(auths[0] ?? "", /account-one\.api .*key-1$/);
    assert.match(auths[1] ?? "", /account-two\.api .*key-2$/);
    assert.equal(state.cooldownUntil.get(0), 61_000); // first write: 1_000 + COOLDOWN_MS
  });

  it("judgePost throws the tagged error with a pool-ordered record when every account is cooling", async () => {
    const state = freshState(twoAccounts());
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", Date.now, inertSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    const failures = (caught as RotationExhausted).failures;
    assert.deepEqual(
      failures.map((f) => f.account),
      [1, 2],
    ); // pool order, 1-based
    assert.ok(failures.every((f) => f.reason === "HTTP 429"));
  });

  it("re-stamps an expired cooldown so a cooled account becomes dispatchable again", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    // An expired entry is dispatchable again; the fresh 429 re-stamps it.
    state.cooldownUntil.set(0, Date.now() - 1_000);
    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", Date.now, inertSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    const restamped = state.cooldownUntil.get(0);
    assert.ok(restamped !== undefined && restamped > Date.now());
  });

  it("charges the shared wait budget per park and dies when the budget is spent", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    // Hand-stepped clock; each wake re-dispatches, the fresh 429 re-stamps,
    // and the next park charges again. Each park sleeps earliest expiry +
    // the 500ms wake jitter: three parks drain 180_000 (60_500 + 60_500 +
    // 59_000 — the third caps at the remaining 59_000), the budget hits 0,
    // and the next park refuses — the terminal throw. Expectations couple
    // to WAKE_JITTER_MS.
    let tick = 0;
    const now = (): number => tick;
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      tick += ms; // waking costs exactly the slept time
      return Promise.resolve();
    };
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now, inertSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(sleeps, [60_500, 60_500, 59_000]);
    assert.equal(state.waitBudgetRemainingMs, 0);
    // Complete record at budget death: one entry per account.
    const failures = (caught as RotationExhausted).failures;
    assert.equal(failures.length, state.accounts.length);
  });

  it("re-charges the actual elapsed after a slow wake, draining the budget faster", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    let tick = 0;
    const now = (): number => tick;
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      tick += ms + 5_000; // every wake overshoots by 5s — the park eats it
      return Promise.resolve();
    };
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now, inertSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    // Two 60_500 parks + 5s re-charges leave 49_000; the third park caps
    // at it — the overshoot bought less wait, and the next park refuses
    // exactly as in the exact-wake case.
    assert.deepEqual(sleeps, [60_500, 60_500, 49_000]);
    assert.equal(state.waitBudgetRemainingMs, 0);
  });

  it("keeps the wait budget shared across calls — a spent budget parks nowhere", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    let tick = 0;
    const now = (): number => tick;
    const inertSleep = (ms: number): Promise<void> => {
      tick += ms;
      return Promise.resolve();
    };
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now, inertSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    assert.equal(state.waitBudgetRemainingMs, 0);
    // A second call on the same state gets no park at all: budget spent,
    // terminal throw immediately — both judge phases draw this one cell.
    const sleeps: number[] = [];
    const countingSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    caught = undefined;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now, countingSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(sleeps, []);
  });

  it("never parks while an account is eligible — zero sleeps, zero budget drawn", async () => {
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
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    const tick = 0;
    const now = (): number => tick;
    const verdict = await judgePost(
      samplePost,
      state,
      KEYWORDS,
      mockFetch,
      "medium",
      now,
      inertSleep,
    );
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
    assert.deepEqual(sleeps, []); // an eligible account never parks
    assert.equal(state.waitBudgetRemainingMs, 180_000); // and never draws budget
  });
});

describe("judgePosts rotation: cooling, parking, exhaustion", () => {
  it("drain-then-throw: every account cooling rejects judgePosts with the complete pool-ordered record", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = (async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("{}"); // answered, zero verdicts — every post falls back
      }
      return new Response("Too Many Requests", { status: 429 }); // both accounts cool
    }) as unknown as typeof fetch;

    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePosts(
        posts,
        twoAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        4,
        Date.now,
        inertSleep,
      );
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as RotationExhausted).failures.map((f) => f.account),
      [1, 2],
    );
  });
  it("cools to account 2 on the first 429 with no backoff wait", async () => {
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
  it("skips a still-cooling account when the fallback scan restarts at account 1", async () => {
    // The bulk call 429s account 1, lands on account 2, and answers the
    // FIRST listed id only, so the second post falls back. The fallback
    // scan restarts at account 1, finds it still cooling, and dispatches
    // account 2 — the observable dispatch order is unchanged; the
    // mechanism is the map, not a pointer.
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
    const delays: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    };
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
    const result = await judgePosts(
      posts,
      twoAccounts(),
      KEYWORDS,
      mockFetch,
      "medium",
      4,
      Date.now,
      inertSleep,
    );
    assert.equal(calls, 2); // 502 retry — injected delay, not real
    assert.deepEqual(delays, [1_000]); // RETRY_DELAYS_MS[0]
    assert.equal(result.judged.length, 1);
    assert.ok(auths.every((auth) => auth.includes("key-1"))); // a 5xx never rotates
  });
  it("defers a batch on a transport error without cooling any account", async () => {
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
    assert.match(auths[0] ?? "", /key-1$/); // the scan never moved — nothing cooled
  });
  it("cools each account once under concurrent 429s and keeps the record pool-ordered", async () => {
    const posts = Array.from({ length: 40 }, (_, i) => bulkPost(id19(i + 1))); // 4 batches
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      return new Response("Too Many Requests", { status: 429 });
    }) as unknown as typeof fetch;

    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePosts(
        posts,
        threeAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        4,
        Date.now,
        inertSleep,
      );
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    const failures = (caught as RotationExhausted).failures;
    // The synthesizer's proof: exactly one record per account, in pool
    // order — the map collapsed every concurrent 429 into one cooling
    // window per account, and every account was still cooling at the
    // terminal conversion.
    assert.deepEqual(
      failures.map((f) => f.account),
      [1, 2, 3],
    );
    assert.ok(failures.every((f) => f.reason === "HTTP 429"));
    // The dispatch cascade still visited later accounts from more than one
    // worker: a vacuous scan (one worker walking the pool alone) would
    // serialize the burst behind a single worker.
    const count = (key: string): number => auths.filter((auth) => auth.includes(key)).length;
    assert.ok(count("key-2") >= 2, `account 2 dispatched ${count("key-2")} time(s)`);
    assert.ok(count("key-3") >= 2, `account 3 dispatched ${count("key-3")} time(s)`);
    // Per-worker monotonicity: no call on a lower account's key after the
    // first call on a higher one — cooling windows outlive the burst.
    const firstKey2 = auths.findIndex((auth) => auth.includes("key-2"));
    const lastKey1 = auths.map((auth) => auth.includes("key-1")).lastIndexOf(true);
    assert.ok(firstKey2 > lastKey1);
    const firstKey3 = auths.findIndex((auth) => auth.includes("key-3"));
    const lastKey2 = auths.map((auth) => auth.includes("key-2")).lastIndexOf(true);
    assert.ok(firstKey3 > lastKey2);
  });
  it("restarts at account 1 once the cooldown expires (batch-local scan)", async () => {
    const posts = Array.from({ length: 30 }, (_, i) => bulkPost(id19(i + 1))); // 3 batches
    const auths: string[] = [];
    let tick = 0;
    const now = (): number => tick;
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      const firstId = content.match(/\b\d{16,}\b/)?.[0] ?? "";
      const batch = Math.floor(posts.findIndex((p) => p.id === firstId) / 10);
      if (String(url).includes("account-one") && batch === 0) {
        tick = 1_000; // the 429 lands at t=1s; account 1 cools until t=61s
        return new Response("Too Many Requests", { status: 429 });
      }
      // Each answered call completes later in wall-clock time: batch 0's
      // answer still lands inside the cooldown window, batch 1's lands
      // after it — so batch 2's dispatch scan finds account 1 eligible.
      tick = batch === 0 ? 2_000 : 62_000;
      const ids = [...content.matchAll(/id (\d+) by @/g)].map((match) => match[1] ?? "");
      return ok(bulkContent(ids));
    }) as unknown as typeof fetch;
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch, "medium", 1, now);
    assert.equal(result.judged.length, 30);
    assert.match(auths[0] ?? "", /key-1$/); // batch 0 first try
    assert.match(auths[1] ?? "", /key-2$/); // batch 0 retry after the 429
    assert.match(auths[2] ?? "", /key-2$/); // batch 1 at t=2s — account 1 still cooling
    assert.match(auths[3] ?? "", /key-1$/); // batch 2 at t=62s — scan restarts at account 1
  });
  it("parks through an all-cooling window and completes the backlog with zero real delay", async () => {
    const posts = Array.from({ length: 20 }, (_, i) => bulkPost(id19(i + 1))); // 2 batches
    const auths: string[] = [];
    const sleeps: number[] = [];
    let tick = 0;
    const now = (): number => tick;
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      tick += ms; // the park wakes exactly at expiry — zero real delay
      return Promise.resolve();
    };
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      const ids = [...content.matchAll(/id (\d+) by @/g)].map((match) => match[1] ?? "");
      if (tick < 60_000) {
        tick += 100; // first-wave 429s land slightly later
        return new Response("Too Many Requests", { status: 429 });
      }
      return ok(bulkContent(ids)); // everything after the park answers
    }) as unknown as typeof fetch;
    const result = await judgePosts(
      posts,
      twoAccounts(),
      KEYWORDS,
      mockFetch,
      "medium",
      1,
      now,
      inertSleep,
    );
    assert.equal(result.judged.length, 20);
    assert.deepEqual(result.skippedPostIds, []);
    // Exactly one park: earliest expiry (60_100) + the 500ms wake jitter,
    // charged from startedAt 200. Zero real delay — the whole wait is the
    // inert sleep's call log.
    assert.deepEqual(sleeps, [60_400]);
    // Wave 1: both accounts 429 (key-1, key-2); the park rides out the
    // window; the retry and batch 2 land back on account 1.
    assert.match(auths[0] ?? "", /key-1$/);
    assert.match(auths[1] ?? "", /key-2$/);
    assert.match(auths[2] ?? "", /key-1$/); // post-park retry
  });
  it("rejects judgePosts when the fallback phase dies on a spent budget", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = (async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("{}"); // answered, zero verdicts — every post falls back
      }
      return new Response("Too Many Requests", { status: 429 });
    }) as unknown as typeof fetch;
    let tick = 0;
    const now = (): number => tick;
    const inertSleep = (ms: number): Promise<void> => {
      tick += ms;
      return Promise.resolve();
    };

    let caught: unknown;
    try {
      await judgePosts(posts, singleAccount, KEYWORDS, mockFetch, "medium", 4, now, inertSleep);
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as RotationExhausted).failures.map((f) => f.account),
      [1],
    );
  });
});
