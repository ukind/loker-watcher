/**
 * Offline suite for the behavioral policy machines (design 2026-11-09;
 * the budget suites deleted by the browser-walk migration 2026-11-11).
 *
 * Local Date constructors throughout — every pin is zone-independent: the
 * local (Y, M, D, ...) constructor and the local getters round-trip in any
 * timezone. No files, no doubles, no ambient clock: the module is pure,
 * so this suite is its whole contract.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HALT_CHECKPOINT_REASON,
  HALT_RATE_LIMIT_REASON,
  WAKE_MAX_MS,
  WAKE_MIN_MS,
  sampleTickDelayMs,
} from "../src/linkedin-behavior.js";

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("sampleTickDelayMs", () => {
  it("pins the floor at exactly 28 minutes when rng returns 0", () => {
    assert.equal(
      sampleTickDelayMs(() => 0),
      WAKE_MIN_MS,
    );
    assert.equal(WAKE_MIN_MS, 28 * 60_000);
  });

  it("stays strictly under the 33-minute ceiling as rng approaches 1", () => {
    const delay = sampleTickDelayMs(() => 0.999999999);
    assert.equal(WAKE_MAX_MS, 33 * 60_000);
    assert.ok(delay >= WAKE_MIN_MS);
    assert.ok(delay < WAKE_MAX_MS);
  });

  it("keeps a seeded sweep inside [floor, ceiling) and never repeats one value", () => {
    const rng = seededRng(2026_11_09);
    const draws = new Set<number>();
    for (let i = 0; i < 1_000; i += 1) {
      const delay = sampleTickDelayMs(rng);
      assert.ok(delay >= WAKE_MIN_MS, `too small: ${delay}`);
      assert.ok(delay < WAKE_MAX_MS, `too big: ${delay}`);
      draws.add(delay);
    }
    assert.ok(draws.size > 1, "jitter collapsed to a single value");
  });
});

describe("halt latch reason vocabulary", () => {
  it("exports two non-empty, mutually distinguishable canonical reasons", () => {
    assert.ok(HALT_RATE_LIMIT_REASON.length > 0);
    assert.ok(HALT_CHECKPOINT_REASON.length > 0);
    assert.notEqual(HALT_RATE_LIMIT_REASON, HALT_CHECKPOINT_REASON);
  });

  it("names the one remedy in the checkpoint reason (a re-harvest)", () => {
    assert.match(HALT_CHECKPOINT_REASON, /login-linkedin/);
  });
});
