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
import { runLoop, startLoop } from "../scripts/watch-linkedin.js";
import type { WatcherConfig } from "../src/config-file.js";
import { DEFAULT_WAKE_MIN_MS, sampleTickDelayMs } from "../src/linkedin-behavior.js";
import { legDead } from "../src/linkedin-context.js";

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Minimal valid config for the startLoop suite (the loop reads only the wake keys off it). */
const BASE_CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: [],
  negativeKeywords: [],
  surfaces: [{ type: "linkedin", value: "#hiring react" }],
  platforms: { linkedin: true, threads: true },
  recencyHours: 72,
  reasoningEffort: "low",
  scrollRounds: 1,
  linkedinWakeMinMinutes: 60,
  linkedinWakeMaxMinutes: 60,
};

describe("runLoop cadence", () => {
  it("sleeps the seeded rng draws in an injected band — never the old fixed 600 s", async () => {
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
      linkedinWakeMinMs: 55 * 60_000,
      linkedinWakeMaxMs: 65 * 60_000,
      maxIterations: 4,
    });
    assert.equal(calls, 4);
    assert.equal(sleeps.length, 4);
    // The transcript IS the oracle: recompute the draws with the same seed
    // over the same injected band.
    const rng2 = seededRng(2026_11_09);
    const expected = [
      sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng2),
      sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng2),
      sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng2),
      sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng2),
    ];
    assert.deepEqual(sleeps, expected);
    for (const ms of sleeps) {
      assert.ok(ms >= 55 * 60_000 && ms < 65 * 60_000, `out of band: ${ms}`);
      assert.notEqual(ms, 600_000);
    }
    assert.ok(new Set(sleeps).size > 1, "band collapsed to one draw");
  });

  it("defaults to a flat 60-minute wake when no bounds are injected", async () => {
    const sleeps: number[] = [];
    await runLoop({
      tick: async () => {},
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      rng: seededRng(2026_11_09),
      maxIterations: 4,
    });
    assert.equal(sleeps.length, 4);
    for (const ms of sleeps) {
      assert.equal(ms, DEFAULT_WAKE_MIN_MS);
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

  it("logs the wake delay in minutes, a local wall-clock wake time, and the band", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    await runLoop({
      tick: async () => {},
      sleepFn: async () => {},
      rng: () => 0,
      now: () => new Date(2026, 9, 26, 13, 5).getTime(),
      maxIterations: 1,
    });
    const line = log.mock.calls.map((call) => String(call.arguments[0])).join("\n");
    assert.match(line, /next wake in ~60 min/);
    assert.match(line, /\(14:05 local\)/);
    assert.match(line, /\(band 60-60 min\)/);
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

  it("keeps running when the leg-dead handler itself faults (N064)", async (t) => {
    const warn = t.mock.method(console, "warn", console.warn.bind(console));
    let calls = 0;
    await runLoop({
      tick: async () => {
        calls += 1;
        if (calls === 1) throw legDead("HTTP 401 {} — dead li_at session");
      },
      sleepFn: async () => {},
      onLegDead: async () => {
        throw new Error("marker write failed");
      },
      maxIterations: 2,
    });
    assert.equal(calls, 2); // the loop survived the handler fault
    assert.match(
      String(warn.mock.calls[0]?.arguments[0]),
      /watch-linkedin: leg-dead handler FAILED — marker write failed/,
    );
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

describe("startLoop", () => {
  it("carries a band config through to in-band sleeps", async () => {
    const sleeps: number[] = [];
    await startLoop({
      config: {
        ...BASE_CONFIG,
        linkedinWakeMinMinutes: 55,
        linkedinWakeMaxMinutes: 65,
      },
      tick: async () => {},
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      rng: seededRng(2026_11_09),
      maxIterations: 4,
    });
    assert.equal(sleeps.length, 4);
    for (const ms of sleeps) {
      assert.ok(ms >= 55 * 60_000 && ms < 65 * 60_000, `out of band: ${ms}`);
    }
    assert.ok(new Set(sleeps).size > 1, "band collapsed to one draw");
  });

  it("carries a 60/60 config through to flat 60-minute sleeps", async () => {
    const sleeps: number[] = [];
    await startLoop({
      config: BASE_CONFIG,
      tick: async () => {},
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      rng: seededRng(2026_11_09),
      maxIterations: 4,
    });
    assert.equal(sleeps.length, 4);
    for (const ms of sleeps) {
      assert.equal(ms, DEFAULT_WAKE_MIN_MS);
    }
  });

  it("warns once naming PAYLOAD_MAX_AGE_MS when the band floor reaches it (N091)", async (t) => {
    const warn = t.mock.method(console, "warn", console.warn.bind(console));
    await startLoop({
      config: {
        ...BASE_CONFIG,
        linkedinWakeMinMinutes: 45,
        linkedinWakeMaxMinutes: 60,
      },
      tick: async () => {},
      sleepFn: async () => {},
      rng: seededRng(2026_11_09),
      maxIterations: 1,
    });
    const lines = warn.mock.calls.map((call) => call.arguments.join(" "));
    const fresh = lines.filter((line) => /PAYLOAD_MAX_AGE_MS/.test(line));
    assert.equal(fresh.length, 1);
    assert.match(fresh[0] ?? "", /freshness rule/);
  });

  it("stays quiet when the band floor is below the freshness bound (N091)", async (t) => {
    const warn = t.mock.method(console, "warn", console.warn.bind(console));
    await startLoop({
      config: {
        ...BASE_CONFIG,
        linkedinWakeMinMinutes: 15,
        linkedinWakeMaxMinutes: 45,
      },
      tick: async () => {},
      sleepFn: async () => {},
      rng: seededRng(2026_11_09),
      maxIterations: 1,
    });
    const lines = warn.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.filter((line) => /PAYLOAD_MAX_AGE_MS/.test(line)).length, 0);
  });

  it("rejects a broken band naming both keys and values", async () => {
    await assert.rejects(
      () =>
        startLoop({
          config: {
            ...BASE_CONFIG,
            linkedinWakeMinMinutes: 70,
            linkedinWakeMaxMinutes: 60,
          },
          tick: async () => {},
          sleepFn: async () => {},
          maxIterations: 1,
        }),
      /"linkedinWakeMinMinutes" \(70\) must not exceed "linkedinWakeMaxMinutes" \(60\)/,
    );
  });
});
