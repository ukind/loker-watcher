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
  DEFAULT_WAKE_MAX_MS,
  DEFAULT_WAKE_MIN_MS,
  HALT_CHECKPOINT_REASON,
  HALT_RATE_LIMIT_REASON,
  resolveLinkedInWakeBand,
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
  it("pins the floor at exactly the injected min when rng returns 0", () => {
    assert.equal(
      sampleTickDelayMs(55 * 60_000, 65 * 60_000, () => 0),
      55 * 60_000,
    );
  });

  it("stays strictly under the injected ceiling as rng approaches 1", () => {
    const delay = sampleTickDelayMs(55 * 60_000, 65 * 60_000, () => 0.999999999);
    assert.ok(delay >= 55 * 60_000);
    assert.ok(delay < 65 * 60_000);
  });

  it("keeps a seeded sweep inside the injected band and never repeats one value", () => {
    const rng = seededRng(2026_11_09);
    const draws = new Set<number>();
    for (let i = 0; i < 1_000; i += 1) {
      const delay = sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng);
      assert.ok(delay >= 55 * 60_000, `too small: ${delay}`);
      assert.ok(delay < 65 * 60_000, `too big: ${delay}`);
      draws.add(delay);
    }
    assert.ok(draws.size > 1, "jitter collapsed to a single value");
  });

  it("proves ceiling exclusivity is a draw property, not a constant property", () => {
    const rng = seededRng(2026_11_09);
    const draws = new Set<number>();
    for (let i = 0; i < 1_000; i += 1) {
      const delay = sampleTickDelayMs(55 * 60_000, 60 * 60_000, rng);
      assert.ok(delay >= 55 * 60_000, `too small: ${delay}`);
      assert.ok(delay < 60 * 60_000, `too big: ${delay}`);
      draws.add(delay);
    }
    assert.ok(draws.size > 1, "jitter collapsed to a single value");
  });

  it("collapses the degenerate 60/60 default band to one constant draw", () => {
    const rng = seededRng(2026_11_09);
    for (let i = 0; i < 1_000; i += 1) {
      assert.equal(sampleTickDelayMs(DEFAULT_WAKE_MIN_MS, DEFAULT_WAKE_MAX_MS, rng), 3_600_000);
    }
  });

  it("defaults both bounds to the flat 60-minute band", () => {
    assert.equal(DEFAULT_WAKE_MIN_MS, 3_600_000);
    assert.equal(DEFAULT_WAKE_MAX_MS, 3_600_000);
  });
});

describe("resolveLinkedInWakeBand", () => {
  it("converts minutes to ms bounds", () => {
    assert.deepEqual(resolveLinkedInWakeBand(55, 65, "watcher.config.json"), {
      minMs: 3_300_000,
      maxMs: 3_900_000,
    });
  });

  it("passes a degenerate band through", () => {
    assert.deepEqual(resolveLinkedInWakeBand(60, 60, "watcher.config.json"), {
      minMs: 3_600_000,
      maxMs: 3_600_000,
    });
  });

  it("resolves a partial band against the 60 default", () => {
    assert.deepEqual(resolveLinkedInWakeBand(55, 60, "watcher.config.json"), {
      minMs: 3_300_000,
      maxMs: 3_600_000,
    });
    assert.deepEqual(resolveLinkedInWakeBand(60, 90, "watcher.config.json"), {
      minMs: 3_600_000,
      maxMs: 5_400_000,
    });
  });

  it("throws on min > max, naming both keys and their values", () => {
    assert.throws(
      () => resolveLinkedInWakeBand(70, 60, "watcher.config.json"),
      /"linkedinWakeMinMinutes" \(70\) must not exceed "linkedinWakeMaxMinutes" \(60\)/,
    );
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
