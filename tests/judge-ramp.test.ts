/**
 * The ramp suite (N080): classifyResponse's N065 gate, rampLevel's
 * tallies, and findConcurrencyCeiling's three verdicts — all offline over
 * scripted fetchFn doubles (fakeFetch from judge-helpers). No network, no
 * sleeps: a refused level IS the ceiling signal.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RAMP_MAX,
  classifyResponse,
  findConcurrencyCeiling,
  rampLevel,
} from "../src/judge-ramp.js";
import { fakeFetch, ok } from "./judge-helpers.js";

const ACCOUNT = { baseUrl: "https://one.api/v1", apiKey: "k", model: "m" };
const PAYLOAD = { messages: [{ role: "user", content: "probe" }] };

/** The counting refusal double: ok for the first `refuseFrom - 1` calls, 429 after. */
function refuseFromCall(refuseFrom: number): typeof fetch {
  let n = 0;
  return fakeFetch(() => {
    n += 1;
    if (n >= refuseFrom) return new Response("busy", { status: 429 });
    return ok("{}");
  });
}

describe("classifyResponse", () => {
  it("reads a real completion as ok (JSON + choices)", () => {
    const outcome = classifyResponse(200, JSON.stringify({ choices: [{ message: {} }] }));
    assert.deepEqual(outcome, { kind: "ok" });
  });

  it("fails a 2xx without choices — the N065 gate (refusal prose with a brace is not ok)", () => {
    const outcome = classifyResponse(200, "refused: {rate limited}");
    assert.equal(outcome.kind, "failed");
  });

  it("fails a 2xx with non-JSON body", () => {
    const outcome = classifyResponse(200, "<html>busy</html>");
    assert.equal(outcome.kind, "failed");
  });

  it("classifies non-2xx as refused (data, not failure)", () => {
    const outcome = classifyResponse(429, "ratelimited");
    assert.deepEqual(outcome, { kind: "refused", status: 429 });
  });
});

describe("rampLevel", () => {
  it("tallies per-kind outcomes across parallel calls", async (t) => {
    t.mock.method(console, "log", console.log.bind(console));
    let n = 0;
    const fetchFn = fakeFetch(() => {
      n += 1;
      if (n === 2) return new Response("busy", { status: 429 });
      return ok("{}");
    });
    const result = await rampLevel(3, PAYLOAD, ACCOUNT, "account 1", fetchFn);
    assert.equal(result.ok, 2);
    assert.equal(result.refused, 1);
    assert.equal(result.failed, 0);
    assert.ok(result.ms >= 0);
  });
});

describe("findConcurrencyCeiling", () => {
  it("reads the ceiling below the first refused level (6 clean calls then refusal -> 4)", async (t) => {
    t.mock.method(console, "log", console.log.bind(console));
    // Levels 2 and 4 fire 6 clean calls; level 8's first call refuses.
    assert.equal(await findConcurrencyCeiling(PAYLOAD, ACCOUNT, "account 1", refuseFromCall(7)), 4);
  });

  it("returns 0 when any call fails (broken endpoint, not a ceiling)", async (t) => {
    t.mock.method(console, "log", console.log.bind(console));
    // Level 2's first call is clean; its second call throws — a failed
    // call is a broken endpoint, not a ceiling.
    let n = 0;
    const flaky = fakeFetch(() => {
      n += 1;
      if (n >= 2) throw new Error("socket dropped");
      return ok("{}");
    });
    assert.equal(await findConcurrencyCeiling(PAYLOAD, ACCOUNT, "account 1", flaky), 0);
  });

  it("returns RAMP_MAX when every level is fully clean (2..32)", async (t) => {
    t.mock.method(console, "log", console.log.bind(console));
    const fetchFn = fakeFetch(() => ok("{}"));
    assert.equal(await findConcurrencyCeiling(PAYLOAD, ACCOUNT, "account 1", fetchFn), RAMP_MAX);
  });
});
