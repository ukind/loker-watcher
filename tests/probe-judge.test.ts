/**
 * Offline replay of the probe's leg classifier (F005, 2026-11-15): the
 * old includes("{") check counted any 2xx carrying a brace as a good leg,
 * so an error envelope or an HTML interstitial inflated committed ceilings
 * for the next 8 hours. The gate now requires the production answer
 * envelope; these cases pin it. Importing scripts/probe-judge.js here is
 * the entry-guard pin — a side-effecting import would read
 * watcher.config.json and launch the live probe.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timed } from "../scripts/probe-judge.js";
import type { LlmAccount } from "../src/judge.js";

/** One account; the trailing slash pins the endpoint normalization. */
const ACCOUNT: LlmAccount = {
  baseUrl: "https://probe.api/v1/",
  apiKey: "key",
  model: "model",
};

/** The minimal production answer envelope. */
const ANSWER = JSON.stringify({
  choices: [{ message: { role: "assistant", content: "ok" } }],
});

/**
 * Fetch double: answers every call with the given body + status and records
 * the request URLs. Returns real Response objects (the suite's idiom).
 */
function fetchAnswering(body: string, status = 200) {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL) => {
    urls.push(String(input));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

describe("timed — the probe leg classifier (F005)", () => {
  it("a 2xx answer envelope is ok", async () => {
    const { fetchFn } = fetchAnswering(ANSWER);
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), { kind: "ok" });
  });

  it("a 2xx JSON error envelope is a failed leg — the includes-brace bug", async () => {
    const { fetchFn } = fetchAnswering(JSON.stringify({ error: { message: "quota" } }));
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), {
      kind: "failed",
      message: "response carried no chat-completions envelope",
    });
  });

  it("a 2xx non-JSON body is a failed leg", async () => {
    const { fetchFn } = fetchAnswering("<html>interstitial</html>");
    assert.equal((await timed("leg", {}, ACCOUNT, fetchFn)).kind, "failed");
  });

  it("a 2xx envelope with whitespace-only content is a failed leg", async () => {
    const blank = JSON.stringify({ choices: [{ message: { content: "   " } }] });
    const { fetchFn } = fetchAnswering(blank);
    assert.equal((await timed("leg", {}, ACCOUNT, fetchFn)).kind, "failed");
  });

  it("HTTP 429 is refused, not failed — the account is busy", async () => {
    const { fetchFn } = fetchAnswering("{}", 429);
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), {
      kind: "refused",
      status: 429,
    });
  });

  it("HTTP 401 is refused — classifyDead turns it into auth-dead", async () => {
    const { fetchFn } = fetchAnswering("{}", 401);
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), {
      kind: "refused",
      status: 401,
    });
  });

  it("a transport throw is a failed leg carrying the error message", async () => {
    const fetchFn = (async () => {
      throw new Error("socket hung up");
    }) as unknown as typeof fetch;
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), {
      kind: "failed",
      message: "socket hung up",
    });
  });

  it("posts to the normalized chat-completions endpoint", async () => {
    const { fetchFn, urls } = fetchAnswering(ANSWER);
    await timed("leg", {}, ACCOUNT, fetchFn);
    assert.deepEqual(urls, ["https://probe.api/v1/chat/completions"]);
  });

  it("logs the NO ENVELOPE token for a failed 2xx leg", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const { fetchFn } = fetchAnswering(JSON.stringify({ error: {} }));
    await timed("account 1 (https://probe.api/v1/) minimal call", {}, ACCOUNT, fetchFn);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some(
        (line) =>
          line.includes("account 1 (https://probe.api/v1/) minimal call") &&
          line.includes("NO ENVELOPE"),
      ),
    );
  });
});
