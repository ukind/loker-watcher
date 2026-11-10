/**
 * Offline suite for the behavioral policy machines (design 2026-11-09).
 *
 * Local Date constructors throughout — every pin is zone-independent: the
 * local (Y, M, D, ...) constructor and the local getters round-trip in any
 * timezone. No files, no doubles, no ambient clock: the module is pure,
 * so this suite is its whole contract.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DAILY_GET_BUDGET,
  HALT_BUDGET_REASON,
  HALT_RATE_LIMIT_REASON,
  WAKE_MAX_MS,
  WAKE_MIN_MS,
  WINDOW_END_HOUR,
  WINDOW_START_HOUR,
  budgetAllows,
  budgetReserve,
  freshBudget,
  isWithinWorkingHours,
  localDateKey,
  sampleTickDelayMs,
} from "../src/linkedin-behavior.js";

/** 2026-10-26 is a Monday; Oct 31 is the Saturday, Nov 1 the Sunday. */
const MONDAY = { y: 2026, m: 9, d: 26 };

const at = (y: number, m: number, d: number, hour: number, min = 0, sec = 0, ms = 0): Date =>
  new Date(y, m, d, hour, min, sec, ms);

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("isWithinWorkingHours", () => {
  it("admits 08:00:00.000 exactly and rejects 07:59:59.999", () => {
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 8)), true);
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 7, 59, 59, 999)), false);
  });

  it("admits 20:59:59.999 and rejects 21:00:00.000 — the end is exclusive", () => {
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 20, 59, 59, 999)), true);
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 21)), false);
  });

  it("rejects Saturday and Sunday even at midday", () => {
    assert.equal(isWithinWorkingHours(at(2026, 9, 31, 12)), false);
    assert.equal(isWithinWorkingHours(at(2026, 10, 1, 12)), false);
  });

  it("rejects a Friday late-evening tick past the window", () => {
    assert.equal(isWithinWorkingHours(at(2026, 9, 30, 21, 30)), false);
  });

  it("admits every weekday hour from the start hour to one under the end hour", () => {
    for (let hour = WINDOW_START_HOUR; hour < WINDOW_END_HOUR; hour += 1) {
      assert.equal(isWithinWorkingHours(at(2026, 9, 28, hour)), true, `hour ${hour}`);
    }
  });
});

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

describe("localDateKey", () => {
  it("formats a local date zero-padded as YYYY-MM-DD", () => {
    assert.equal(localDateKey(at(2026, 8, 5, 13)), "2026-09-05");
  });

  it("reads the LOCAL calendar, not UTC — local midnight keeps its own date", () => {
    // Local 00:30 on Oct 26 is a different UTC date in every zone east of
    // UTC; the local-constructor/local-getter round-trip pins the date.
    assert.equal(localDateKey(at(MONDAY.y, MONDAY.m, MONDAY.d, 0, 30)), "2026-10-26");
  });
});

describe("budgetAllows / budgetReserve", () => {
  it("allows the fresh state on any key", () => {
    assert.equal(budgetAllows(freshBudget(), "2026-10-26"), true);
  });

  it("allows count 149 and blocks count 150 at the default budget", () => {
    const key = "2026-10-26";
    let state = freshBudget();
    for (let i = 0; i < DAILY_GET_BUDGET; i += 1) {
      assert.equal(budgetAllows(state, key), true, `GET ${i + 1}`);
      state = budgetReserve(state, key);
    }
    assert.equal(state.count, DAILY_GET_BUDGET);
    assert.equal(budgetAllows(state, key), false);
  });

  it("blocks at a custom limit", () => {
    const key = "2026-10-26";
    const state = budgetReserve(budgetReserve(freshBudget(), key), key);
    assert.equal(budgetAllows(state, key, 2), false);
    assert.equal(budgetAllows(state, key, 3), true);
  });

  it("rolls over at local midnight: a spent budget never blocks the new day", () => {
    const yesterday = { localDate: "2026-10-25", count: DAILY_GET_BUDGET };
    assert.equal(budgetAllows(yesterday, "2026-10-26"), true);
    const reserved = budgetReserve(yesterday, "2026-10-26");
    assert.deepEqual(reserved, { localDate: "2026-10-26", count: 1 });
  });

  it("accumulates within one day and never mutates the caller's state", () => {
    const key = "2026-10-26";
    const frozen = Object.freeze({ localDate: key, count: 5 });
    const next = budgetReserve(frozen, key);
    assert.deepEqual(frozen, { localDate: key, count: 5 });
    assert.deepEqual(next, { localDate: key, count: 6 });
  });
});

describe("halt latch reason vocabulary", () => {
  it("exports two non-empty, distinguishable canonical reasons", () => {
    assert.ok(HALT_RATE_LIMIT_REASON.length > 0);
    assert.ok(HALT_BUDGET_REASON.length > 0);
    assert.notEqual(HALT_RATE_LIMIT_REASON, HALT_BUDGET_REASON);
  });
});
