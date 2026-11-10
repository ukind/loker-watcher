/**
 * Rotation suite (F015): the cooldown, park-budget, and exhaustion cases
 * moved intact from tests/judge.test.ts along the F010 seam — the whole
 * describe("judgePost") plus the nine rotation-flavored judgePosts
 * integration cases.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { judgePost } from "../src/judge-dispatch.js";
import {
  type RotationExhausted,
  type RotationState,
  claimAccount,
  coolAccount,
  earliestCooldown,
  hasOutstandingRelease,
  isRotationExhausted,
  pickEligibleAccount,
  releaseAccount,
  rotationExhausted,
  waitCeilingSlot,
} from "../src/judge-rotation.js";
import { type LlmAccount, judgePosts } from "../src/judge.js";
import type { AccountFailure, Post } from "../src/types.js";
import {
  KEYWORDS,
  bulkContent,
  bulkPost,
  fiveAccounts,
  id19,
  ok,
  singleAccount,
} from "./judge-helpers.js";

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
 *  waitBudgetRemainingMs literal mirrors the module-private WAIT_BUDGET_MS.
 *  ceilings default: an empty map reads as ceiling 1 per account (the
 *  pick's ?? 1 floor) — the same degrade as an absent ceilings file. */
function freshState(
  accounts: LlmAccount[],
  ceilings: ReadonlyMap<number, number> = new Map(),
  blocked: ReadonlyMap<number, string> = new Map(),
): RotationState {
  return {
    accounts,
    cooldownUntil: new Map(),
    ceilings,
    blocked,
    inFlight: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: 180_000,
    healthMarks: new Map(),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
  };
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
    platform: "threads",
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
      if (content.includes("Judge each post below")) {
        return ok("{}"); // answered, zero verdicts — every post falls back
      }
      return new Response("Too Many Requests", { status: 429 }); // both accounts cool
    }) as unknown as typeof fetch;

    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch, "medium", {
        ceilings: new Map([
          [0, 2],
          [1, 2],
        ]),
        now: Date.now,
        sleepFn: inertSleep,
      });
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
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch, "medium", {
      ceilings: new Map([
        [0, 2],
        [1, 2],
      ]),
      now: Date.now,
      sleepFn: inertSleep,
    });
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
  it("caps the burst: one dispatch per account at ceiling 1, record stays pool-ordered", async () => {
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
      await judgePosts(posts, threeAccounts(), KEYWORDS, mockFetch, "medium", {
        ceilings: new Map([
          [0, 1],
          [1, 1],
          [2, 1],
        ]),
        now: Date.now,
        sleepFn: inertSleep,
      });
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    const failures = (caught as RotationExhausted).failures;
    assert.deepEqual(
      failures.map((f) => f.account),
      [1, 2, 3],
    );
    assert.ok(failures.every((f) => f.reason === "HTTP 429"));
    // Ceiling-1 caps bind: each account dispatched EXACTLY once before the
    // pool went fully cooling — the surplus workers parked on the release
    // queue at zero budget charge, then re-routed into the budget park.
    const count = (key: string): number => auths.filter((auth) => auth.includes(key)).length;
    assert.equal(count("key-1"), 1);
    assert.equal(count("key-2"), 1);
    assert.equal(count("key-3"), 1);
  });
  it("cycles the dispatch dial back to account 1 after a full lap — consecutive dispatches land on consecutive accounts", async () => {
    const state = freshState(twoAccounts());
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    await judgePost(bulkPost(id19(1)), state, KEYWORDS, mockFetch, "medium", Date.now);
    await judgePost(bulkPost(id19(2)), state, KEYWORDS, mockFetch, "medium", Date.now);
    await judgePost(bulkPost(id19(3)), state, KEYWORDS, mockFetch, "medium", Date.now);
    assert.match(auths[0] ?? "", /key-1$/);
    assert.match(auths[1] ?? "", /key-2$/);
    assert.match(auths[2] ?? "", /key-1$/); // the dial wrapped after a full lap
    assert.equal(state.dispatchCounter, 3 % 2); // the dial sits just past the last claim
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
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch, "medium", {
      ceilings: new Map([[0, 1]]),
      now: now,
      sleepFn: inertSleep,
    });
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
      if (content.includes("Judge each post below")) {
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
      await judgePosts(posts, singleAccount, KEYWORDS, mockFetch, "medium", {
        ceilings: new Map([[0, 4]]),
        now: now,
        sleepFn: inertSleep,
      });
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

describe("dispatch spread: the dial, the caps, and the zero-charge ceiling wait", () => {
  /** Recording fetch: pushes "host key", answers bulk by echoing listed ids. */
  function spreadAnswering(auths: string[]): typeof fetch {
    return (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
        (match) => match[1] ?? "",
      );
      return ok(bulkContent(ids));
    }) as unknown as typeof fetch;
  }

  it("first 5 judge calls of a 50-post run hit 5 distinct accounts (FRD acceptance)", async () => {
    const posts = Array.from({ length: 50 }, (_, i) => bulkPost(id19(i + 1))); // 5 batches
    const auths: string[] = [];
    const result = await judgePosts(
      posts,
      fiveAccounts,
      KEYWORDS,
      spreadAnswering(auths),
      "medium",
      {
        ceilings: new Map(fiveAccounts.map((_, i) => [i, 1] as const)),
      },
    );
    assert.equal(result.judged.length, 50);
    assert.deepEqual(result.skippedPostIds, []);
    assert.equal(new Set(auths.slice(0, 5)).size, 5);
  });

  it("per-account peaks stay at or under the ceilings across both judge phases", async () => {
    const posts = Array.from({ length: 30 }, (_, i) => bulkPost(id19(i + 1))); // 3 batches
    const peaks = new Map<number, number>([
      [0, 0],
      [1, 0],
    ]);
    const inFlight = new Map<number, number>([
      [0, 0],
      [1, 0],
    ]);
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const index = String(url).includes("account-one") ? 0 : 1;
      const current = (inFlight.get(index) ?? 0) + 1;
      inFlight.set(index, current);
      peaks.set(index, Math.max(peaks.get(index) ?? 0, current));
      await new Promise<void>((resolve) => setTimeout(resolve, 1)); // let peers enter
      inFlight.set(index, (inFlight.get(index) ?? 1) - 1);
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each post below")) {
        return ok("{}"); // bulk answers empty — every post falls back
      }
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch, "medium", {
      ceilings: new Map([
        [0, 2],
        [1, 1],
      ]),
    });
    assert.equal(result.judged.length, 30);
    assert.deepEqual(result.skippedPostIds, []);
    // Both hosts used (the dial spread), neither host over its ceiling.
    assert.ok((peaks.get(0) ?? 0) >= 1);
    assert.ok((peaks.get(1) ?? 0) >= 1);
    assert.ok((peaks.get(0) ?? 0) <= 2, `account 1 peaked at ${peaks.get(0)} > ceiling 2`);
    assert.ok((peaks.get(1) ?? 0) <= 1, `account 2 peaked at ${peaks.get(1)} > ceiling 1`);
  });

  it("an all-at-ceiling pick parks with ZERO budget charge and wakes on release", async () => {
    const state = freshState(singleAccount, new Map([[0, 1]]));
    let releaseFirst!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const mockFetch = (async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) return gate;
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };

    const first = judgePost(
      bulkPost(id19(1)),
      state,
      KEYWORDS,
      mockFetch,
      "medium",
      Date.now,
      inertSleep,
    );
    const second = judgePost(
      bulkPost(id19(2)),
      state,
      KEYWORDS,
      mockFetch,
      "medium",
      Date.now,
      inertSleep,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 1)); // first in flight; second parked

    assert.equal(state.waitBudgetRemainingMs, 180_000); // zero budget charge
    assert.deepEqual(sleeps, []); // no park sleep fired
    assert.equal(state.ceilingWaiters.length, 1);

    releaseFirst(ok('{"relevant": true, "locationOk": true}'));
    assert.deepEqual(await first, { relevant: true, locationOk: true });
    assert.deepEqual(await second, { relevant: true, locationOk: true });
    assert.equal(state.waitBudgetRemainingMs, 180_000); // still untouched after the wake
    assert.equal(state.ceilingWaiters.length, 0);
  });

  it("skips the designated account when the dial lands on the cooling one", async () => {
    const state = freshState(twoAccounts());
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    state.cooldownUntil.set(0, Date.now() + 60_000); // the DESIGNATED seat (dial 0) is cooling
    const verdict = await judgePost(bulkPost(id19(1)), state, KEYWORDS, mockFetch, "medium");
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
    assert.match(auths[0] ?? "", /key-2$/); // the scan skipped past the cooling designated seat
    assert.equal(state.dispatchCounter, 2); // the claim moved the dial past account 2
  });
});

describe("rotation primitives: dial, claim/release, ceiling waiters", () => {
  it("pick starts at the dial and wraps; claim moves the dial past the claimed account", () => {
    const state = freshState(threeAccounts());
    state.dispatchCounter = 4; // 4 % 3 = 1 — the scan starts at account 2
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 1);
    claimAccount(state, 1);
    assert.equal(state.dispatchCounter, 2);
    assert.equal(state.inFlight.get(1), 1);
  });

  it("an undefined pick never moves the dial (D6)", () => {
    const state = freshState(twoAccounts());
    state.dispatchCounter = 1;
    state.cooldownUntil.set(0, 10_000);
    state.cooldownUntil.set(1, 20_000);
    assert.equal(pickEligibleAccount(state, 5_000), undefined);
    assert.equal(state.dispatchCounter, 1);
  });

  it("the pick skips at-ceiling accounts even when they are not cooling", () => {
    const state = freshState(
      twoAccounts(),
      new Map([
        [0, 1],
        [1, 1],
      ]),
    );
    state.inFlight.set(0, 1);
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 1);
  });

  it("release decrements, wakes the queue, and clamps at zero", async () => {
    const state = freshState(singleAccount);
    claimAccount(state, 0);
    const woke = waitCeilingSlot(state);
    let resolved = false;
    void woke.then(() => {
      resolved = true;
    });
    releaseAccount(state, 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(resolved, true);
    assert.equal(state.inFlight.get(0), 0);
    releaseAccount(state, 0); // double release: clamp, no crash
    assert.equal(state.inFlight.get(0), 0);
  });

  it("waitCeilingSlot resolves on a fresh coolAccount stamp, not on a re-stamp", async () => {
    const state = freshState(twoAccounts());
    const first = waitCeilingSlot(state);
    let firstWoke = false;
    void first.then(() => {
      firstWoke = true;
    });
    coolAccount(state, 0, 1_000); // fresh stamp wakes the queue (D4)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(firstWoke, true);

    const second = waitCeilingSlot(state);
    let secondWoke = false;
    void second.then(() => {
      secondWoke = true;
    });
    coolAccount(state, 0, 2_000); // already cooling: first-write-wins, no wake
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(secondWoke, false);
    releaseAccount(state, 0); // wake the parked waiter so no handle dangles
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  it("earliestCooldown returns the earliest active expiry and ignores expired ones", () => {
    const state = freshState(threeAccounts());
    state.cooldownUntil.set(0, 5_000);
    state.cooldownUntil.set(2, 3_000);
    state.cooldownUntil.set(1, 1_000); // expired at now 2_000
    assert.equal(earliestCooldown(state, 2_000), 3_000);
    assert.equal(earliestCooldown(state, 6_000), undefined);
  });
});

describe("health-circuit pick: the inline half-open probe", () => {
  it("a capped account is dispatchable until its probe claims it, then blocked", () => {
    const state = freshState(twoAccounts());
    state.healthMarks.set(0, 2);
    const first = pickEligibleAccount(state, 0);
    assert.equal(first?.index, 0); // the probe seat is open
    claimAccount(state, 0);
    assert.equal(state.probedThisTick.has(0), true);
    state.cooldownUntil.set(1, 10_000); // block the only other seat
    assert.equal(pickEligibleAccount(state, 0), undefined); // half-open: probe spent
  });

  it("a successful probe frees the tick — the account rejoins at its COMMITTED ceiling", () => {
    const state = freshState(twoAccounts(), new Map([[0, 8]]));
    state.healthMarks.set(0, 2);
    claimAccount(state, 0); // the probe
    assert.equal(state.probedThisTick.has(0), true);
    // stampSuccess's in-run effect (the judge-health helper, Phase 4 call
    // sites): the mark and the probe slot delete together.
    state.healthMarks.delete(0);
    state.probedThisTick.delete(0);
    state.cooldownUntil.set(1, 10_000); // block the other seat — the loop measures seat 0 only
    // Rejoined at the committed ceiling 8: the pick keeps returning the
    // seat until inFlight reaches 8.
    let claims = 1; // the probe claim already sits in inFlight
    while (pickEligibleAccount(state, 0) !== undefined) {
      claimAccount(state, 0);
      claims += 1;
    }
    assert.equal(claims, 8);
    assert.equal(state.inFlight.get(0), 8);
  });

  it("an uncapped account ignores the probe ledger entirely", () => {
    const state = freshState(twoAccounts());
    state.probedThisTick.add(0); // dispatched earlier this tick, NOT capped
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 0);
  });

  it("the cap reads at HEALTH_CAP_STREAK — a streak of 1 neither caps nor registers a probe", () => {
    const state = freshState(twoAccounts(), new Map([[0, 2]]));
    state.healthMarks.set(0, 1);
    claimAccount(state, 0);
    assert.equal(state.probedThisTick.has(0), false); // below the threshold: no probe registered
    state.cooldownUntil.set(1, 10_000); // block the other seat
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 0); // still dispatchable at the committed ceiling
  });
});

describe("blocked mask: pre-check-refused seats never dispatch", () => {
  it("skips a blocked seat and lands the claim on the next free account", () => {
    const state = freshState(twoAccounts(), new Map(), new Map([[0, "HTTP 429"]]));
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 1); // seat 0 refused — the scan moved past it
    claimAccount(state, 1);
    assert.equal(state.dispatchCounter, 2); // the dial moved past the CLAIM, not the skip
    assert.equal(state.inFlight.get(0), undefined); // the blocked seat was never claimed
  });

  it("returns undefined when every seat is blocked and never moves the dial (D6)", () => {
    const state = freshState(
      threeAccounts(),
      new Map(),
      new Map([
        [0, "HTTP 429"],
        [1, "network error: socket hang up"],
        [2, "unusable answer: missing message content"],
      ]),
    );
    state.dispatchCounter = 1;
    assert.equal(pickEligibleAccount(state, 0), undefined);
    assert.equal(state.dispatchCounter, 1); // an undefined pick never moves the dial
  });

  it("a blocked seat never spends the half-open probe — the mask outranks the health circuit", () => {
    const state = freshState(twoAccounts(), new Map(), new Map([[0, "HTTP 401 — key dead"]]));
    state.healthMarks.set(0, 2); // capped: its first dispatch would be the tick's probe
    state.cooldownUntil.set(1, 10_000); // block the only other seat
    // Seat 0 is refused AND capped: without the mask line the pick would
    // return it as the half-open probe. With the line, nothing dispatches.
    assert.equal(pickEligibleAccount(state, 0), undefined);
    assert.equal(state.probedThisTick.size, 0); // the probe was never spent
  });

  it("a pinned startAt on a blocked seat skips it like any other", () => {
    const state = freshState(twoAccounts(), new Map(), new Map([[1, "HTTP 503"]]));
    const picked = pickEligibleAccount(state, 0, 1); // the same-account retry pins seat 1
    assert.equal(picked?.index, 0); // the pinned seat is refused — the scan wrapped past it
  });
});

describe("pool-truthful exhaustion wording (D9)", () => {
  const failures: AccountFailure[] = [
    { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
    { account: 2, baseUrl: "https://api.b.com/v1", reason: "network error: socket hang up" },
  ];

  it("with poolSize the message reads X of N accounts failed", () => {
    const error = rotationExhausted(failures, undefined, 3);
    assert.match(error.message, /^judge: 2 of 3 LLM_ACCOUNTS accounts failed — /);
    assert.ok(error.message.includes("account 1 (https://api.a.com/v1): HTTP 429"));
    assert.ok(
      error.message.includes("account 2 (https://api.b.com/v1): network error: socket hang up"),
    );
  });

  it("without poolSize the legacy all-X form stands (bare test-constructed errors)", () => {
    const error = rotationExhausted(failures);
    assert.match(error.message, /^judge: all 2 LLM_ACCOUNTS account\(s\) exhausted — /);
  });

  it("the judgePosts throw site passes the pool size — the caught error reads 2 of 2", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = (async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each post below")) {
        return ok("{}"); // answered, zero verdicts — every post falls back
      }
      return new Response("Too Many Requests", { status: 429 }); // both accounts cool
    }) as unknown as typeof fetch;
    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch, "medium", {
        ceilings: new Map([
          [0, 2],
          [1, 2],
        ]),
        now: Date.now,
        sleepFn: inertSleep,
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    assert.match(
      (caught as RotationExhausted).message,
      /^judge: 2 of 2 LLM_ACCOUNTS accounts failed — account 1 \(https:\/\/account-one\.api\/v1\): HTTP 429/,
    );
  });

  it("a saturated healthy seat rescues rewound 429 batches through the free release queue — zero budget draw", async () => {
    // The paid-park regression (watch episode 2026-11-07..09): under
    // cooldown-first ordering, the rewound dispatcher drew the shared
    // budget while the healthy seat was merely saturated, and three parks
    // spent the whole 180s cell — "1 of 2 exhausted" with a seat that
    // never failed. Exhaustion in that shape is now impossible by design:
    // the rewound dispatcher waits on the release queue for free, and the
    // survivor's release hands it the freed slot. The D9 pool-truthful
    // wording keeps its throw-site proof in the "2 of 2" case above.
    const posts = Array.from({ length: 20 }, (_, i) => bulkPost(id19(i + 1))); // 2 batches, 2 workers
    const allIds = posts.map((post) => post.id);
    let releaseSurvivor!: (response: Response) => void;
    const survivorGate = new Promise<Response>((resolve) => {
      releaseSurvivor = resolve;
    });
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    let accountOneCalls = 0;
    let accountTwoCalls = 0;
    let survivorReleased = false;
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      const requestedIds = [...new Set(content.match(/\d{19}/g) ?? [])];
      if (String(url).includes("account-one")) {
        accountOneCalls += 1;
        return new Response("Too Many Requests", { status: 429 });
      }
      accountTwoCalls += 1;
      if (!survivorReleased) {
        survivorReleased = true;
        return survivorGate; // the healthy seat saturates: held until the test releases it
      }
      return ok(bulkContent(requestedIds));
    }) as unknown as typeof fetch;

    // Release the held dispatch once the rewound dispatcher has parked on
    // the release queue — a real tick, offline-safe.
    const releaser = setTimeout(() => releaseSurvivor(ok(bulkContent(allIds))), 50);
    try {
      const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch, "medium", {
        ceilings: new Map([
          [0, 1],
          [1, 1],
        ]),
        now: Date.now,
        sleepFn: inertSleep,
      });
      assert.deepEqual(sleeps, []); // the free queue served the rewind — zero budget charge
      assert.equal(accountOneCalls, 1); // the 429 leg ran exactly once
      assert.equal(accountTwoCalls, 2); // batch two, then the rescued batch one
      assert.equal(result.judged.length, 20); // every post judged anyway
      assert.deepEqual(result.skippedPostIds, []);
    } finally {
      clearTimeout(releaser);
    }
  });
});

describe("hasOutstandingRelease (the flavor split's free-park gate)", () => {
  it("reads true while a claim is outstanding and false once it releases", () => {
    const state = freshState(twoAccounts());
    assert.equal(hasOutstandingRelease(state), false);
    claimAccount(state, 0);
    assert.equal(hasOutstandingRelease(state), true);
    releaseAccount(state, 0);
    assert.equal(hasOutstandingRelease(state), false);
  });

  it("reads true with in-flight on any seat, false on an all-idle pool", () => {
    const state = freshState(threeAccounts());
    claimAccount(state, 2);
    assert.equal(hasOutstandingRelease(state), true);
    releaseAccount(state, 2);
    state.inFlight.set(1, 0); // an explicit zero entry is still idle
    assert.equal(hasOutstandingRelease(state), false);
  });
});
