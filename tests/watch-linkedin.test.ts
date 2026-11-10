/**
 * Offline suite for the always-on loop (design 2026-11-09, Slice 2): the
 * jittered cadence transcript under a seeded rng, the two tick-fault arms
 * (leg-dead routes to the episode handler; anything else warns and the
 * loop continues), and the iteration cap. "The loop never exits on
 * leg-dead" is the exit-contract pin this suite owns.
 *
 * Importing scripts/watch-linkedin.ts in this file IS the entry-guard
 * pin: a side-effecting import would start the real loop and hang the
 * suite on the real fetchTick.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLoop } from "../scripts/watch-linkedin.js";
import { WAKE_MAX_MS, WAKE_MIN_MS, sampleTickDelayMs } from "../src/linkedin-behavior.js";
import { legDead } from "../src/linkedin-fetch.js";

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("runLoop cadence", () => {
  it("sleeps the seeded rng draws — never the old fixed 600 s", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await runLoop({
      tick: async () => {
        calls += 1;
      },
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      rng: seededRng(2026_11_09),
      maxIterations: 4,
    });
    assert.equal(calls, 4);
    assert.equal(sleeps.length, 4);
    // The transcript IS the oracle: recompute the draws with the same seed.
    const rng2 = seededRng(2026_11_09);
    const expected = [
      sampleTickDelayMs(rng2),
      sampleTickDelayMs(rng2),
      sampleTickDelayMs(rng2),
      sampleTickDelayMs(rng2),
    ];
    assert.deepEqual(sleeps, expected);
    for (const ms of sleeps) {
      assert.ok(ms >= WAKE_MIN_MS && ms < WAKE_MAX_MS, `out of band: ${ms}`);
      assert.notEqual(ms, 600_000);
    }
  });

  it("ticks first, sleeps after — the first tick is immediate", async () => {
    const order: string[] = [];
    await runLoop({
      tick: async () => {
        order.push("tick");
      },
      sleepFn: async () => {
        order.push("sleep");
      },
      rng: () => 0,
      maxIterations: 1,
    });
    assert.deepEqual(order, ["tick", "sleep"]);
  });

  it("the iteration cap terminates runLoop — cap 0 runs nothing", async () => {
    let calls = 0;
    await runLoop({
      tick: async () => {
        calls += 1;
      },
      sleepFn: async () => {},
      maxIterations: 0,
    });
    assert.equal(calls, 0);
  });

  it("logs the wake delay in minutes and a local wall-clock wake time", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    await runLoop({
      tick: async () => {},
      sleepFn: async () => {},
      rng: () => 0,
      now: () => new Date(2026, 9, 26, 14, 5).getTime(),
      maxIterations: 1,
    });
    const line = log.mock.calls.map((call) => String(call.arguments[0])).join("\n");
    assert.match(line, /next wake in ~28 min/);
    assert.match(line, /\(14:33 local\)/);
  });
});

describe("runLoop fault arms", () => {
  it("routes a leg-dead tick to the episode handler and keeps running", async () => {
    const reasons: string[] = [];
    let calls = 0;
    await runLoop({
      tick: async () => {
        calls += 1;
        if (calls === 1) throw legDead("HTTP 401 {} — dead li_at session");
      },
      sleepFn: async () => {},
      onLegDead: async (reason) => {
        reasons.push(reason);
      },
      maxIterations: 2,
    });
    assert.equal(calls, 2); // the loop continued past the dead tick
    assert.deepEqual(reasons, ["HTTP 401 {} — dead li_at session"]);
  });

  it("warns on any other fault and keeps running", async (t) => {
    const warn = t.mock.method(console, "warn", console.warn.bind(console));
    let calls = 0;
    await runLoop({
      tick: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
      },
      sleepFn: async () => {},
      maxIterations: 2,
    });
    assert.equal(calls, 2);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0]?.arguments[0]), /watch-linkedin: tick FAILED — boom/);
  });
});
