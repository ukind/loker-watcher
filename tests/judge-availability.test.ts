import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkJudgeAvailability } from "../src/judge-availability.js";
import type { LlmAccount } from "../src/judge.js";
import { fiveAccounts, ok, singleAccount } from "./judge-helpers.js";

/** HTTP status with an empty body — the non-ok responses the probe must classify. */
const status = (code: number): Response => new Response(null, { status: code });

/** Recording fetch double: a FRESH Response per call (bodies are single-use), each request captured. */
function fetchReturning(make: () => Response): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; body: unknown; init: RequestInit }>;
} {
  const calls: Array<{ url: string; body: unknown; init: RequestInit }> = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const rawBody = typeof init?.body === "string" ? init.body : "{}";
    calls.push({ url: String(url), body: JSON.parse(rawBody) as unknown, init: init ?? {} });
    return make();
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** Host-routing fetch double: each host substring maps to a Response factory. */
function fetchByHost(routes: Record<string, () => Response>): {
  fetchFn: typeof fetch;
  urls: string[];
  calls: unknown[];
} {
  const urls: string[] = [];
  const calls: unknown[] = [];
  const fetchFn = (async (url: unknown) => {
    const target = String(url);
    urls.push(target);
    calls.push(target);
    for (const [host, make] of Object.entries(routes)) {
      if (target.includes(host)) return make();
    }
    throw new Error(`unexpected probe url: ${target}`);
  }) as typeof fetch;
  return { fetchFn, urls, calls };
}

/** Rejecting fetch double — transport faults and timeouts, no real timers. */
function fetchRejecting(message: string): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as typeof fetch;
}

describe("checkJudgeAvailability", () => {
  it("all accounts answering marks none failed and nothing degraded", async () => {
    const { fetchFn, calls } = fetchReturning(() => ok("ok"));
    const result = await checkJudgeAvailability(fiveAccounts, fetchFn);
    assert.deepEqual(result, { failures: [], degraded: false });
    assert.equal(calls.length, fiveAccounts.length);
  });

  it("every account is probed even when earlier probes fail", async () => {
    const { fetchFn, calls } = fetchByHost({
      "account-one": () => status(429),
      "account-two": () => ok("ok"),
      "account-three": () => status(503),
    });
    const result = await checkJudgeAvailability(fiveAccounts.slice(0, 3), fetchFn);
    assert.equal(calls.length, 3);
    assert.deepEqual(
      result.failures.map((failure) => [failure.account, failure.reason]),
      [
        [1, "HTTP 429"],
        [3, "HTTP 503"],
      ],
    );
    assert.equal(result.degraded, false);
  });

  it("an HTTP 429 renders the judge's cooling reason", async () => {
    const { fetchFn } = fetchReturning(() => status(429));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "HTTP 429");
  });

  it("a dead key renders the key-dead reason", async () => {
    const { fetchFn } = fetchReturning(() => status(401));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "HTTP 401 — key dead");
  });

  it("a 5xx renders its HTTP status", async () => {
    const { fetchFn } = fetchReturning(() => status(503));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "HTTP 503");
  });

  it("a rejecting transport renders network error: <message> — timeout included, no real timers", async () => {
    const fetchFn = fetchRejecting("The operation was aborted due to timeout");
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "network error: The operation was aborted due to timeout");
  });

  it("a 200 with an unparsable body renders unusable answer: <message>", async () => {
    const { fetchFn } = fetchReturning(() => new Response("not json", { status: 200 }));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.match(failure.reason, /^unusable answer: /);
  });

  it("a 200 without message content renders unusable answer: missing message content", async () => {
    const { fetchFn } = fetchReturning(
      () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
    );
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "unusable answer: missing message content");
  });

  it("empty message content counts as unusable", async () => {
    const { fetchFn } = fetchReturning(() => ok("   "));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "unusable answer: missing message content");
  });

  it("the probe payload is tiny: model + messages + temperature, no response_format, no reasoning_effort", async () => {
    const { fetchFn, calls } = fetchReturning(() => ok("ok"));
    await checkJudgeAvailability(singleAccount, fetchFn);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call !== undefined);
    assert.deepEqual(Object.keys(call.body as Record<string, unknown>).sort(), [
      "messages",
      "model",
      "temperature",
    ]);
    const headers = call.init.headers as Record<string, string>;
    const account = singleAccount[0];
    assert.ok(account !== undefined);
    assert.equal(headers.Authorization, `Bearer ${account.apiKey}`);
    assert.ok(call.init.signal instanceof AbortSignal);
  });

  it("the probe URL normalizes a bare base URL and tolerates a full endpoint", async () => {
    const accounts: LlmAccount[] = [
      { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
      { baseUrl: "https://two.api/v1/chat/completions", apiKey: "k2", model: "m2" },
    ];
    const { fetchFn, urls } = fetchByHost({ api: () => ok("ok") });
    const result = await checkJudgeAvailability(accounts, fetchFn);
    assert.deepEqual(result, { failures: [], degraded: false });
    assert.deepEqual(urls, [
      "https://one.api/v1/chat/completions",
      "https://two.api/v1/chat/completions",
    ]);
  });

  it("a checker fault degrades to all-available with exactly one warning naming the cause", (t) => {
    const warn = t.mock.method(console, "warn", console.warn.bind(console));
    t.mock.method(Promise, "allSettled", () => {
      throw new Error("boom");
    });
    return (async () => {
      const { fetchFn, calls } = fetchReturning(() => ok("ok"));
      const result = await checkJudgeAvailability(singleAccount, fetchFn);
      assert.deepEqual(result, { failures: [], degraded: true });
      // Dispatch began BEFORE the mock faulted: .map() invokes probeAccount
      // (and fetchFn) synchronously up to its first await, so the wrapper
      // catch fires after one probe call. The Layer 1/Layer 2 boundary
      // describes real faults, not this injection.
      assert.equal(calls.length, 1);
      assert.equal(warn.mock.callCount(), 1);
      const line = String(warn.mock.calls[0]?.arguments[0]);
      assert.match(line, /availability: pre-check faulted/);
      assert.match(line, /boom/);
    })();
  });

  it("an empty pool is trivially available without touching the transport", async () => {
    const fetchFn = fetchRejecting("must not be called");
    const result = await checkJudgeAvailability([], fetchFn);
    assert.deepEqual(result, { failures: [], degraded: false });
  });
});
