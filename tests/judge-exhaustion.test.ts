/**
 * judge-exhaustion suite (N080): resolveBlockedPick's D4 flavor split over
 * fake RotationState fixtures — the release wake re-picks at ZERO budget
 * charge, the cooldown park is the only budget draw (charge-before-sleep:
 * earliest + 500ms jitter), a spent budget is the exhaustion terminal, a
 * fully blocked quiet pool is terminal (the D11 dead-pool guard), and a
 * quiet pool with a free seat falls to the trailing terminal.
 * LlmAccount imports from the judge-account.ts leaf (N092).
 * The fixture mirrors tests/judge-rotation.test.ts's canonical
 * freshState shape (it moves to judge-helpers in Phase 5; a .test.ts file
 * cannot be imported across files).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmAccount } from "../src/judge-account.js";
import { resolveBlockedPick } from "../src/judge-exhaustion.js";
import type { RotationState } from "../src/judge-rotation.js";

const ACCOUNTS: LlmAccount[] = [
  { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
  { baseUrl: "https://two.api/v1", apiKey: "k2", model: "m2" },
];

const NOW = Date.UTC(2026, 10, 19, 5, 0, 0);
const inertSleep = async (): Promise<void> => {};

function state(overrides: Partial<RotationState> = {}): RotationState {
  return {
    accounts: ACCOUNTS,
    cooldownUntil: new Map(),
    ceilings: new Map(),
    blocked: new Map(),
    inFlight: new Map(),
    healthMarks: new Map(),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: 180_000,
    ...overrides,
  };
}

describe("resolveBlockedPick", () => {
  it("re-picks true at ZERO budget charge when a release is outstanding", async () => {
    const s = state({ inFlight: new Map([[0, 1]]) });
    const pending = resolveBlockedPick(s, () => NOW, inertSleep);
    await new Promise((resolve) => setImmediate(resolve)); // the waiter registers
    const waiter = s.ceilingWaiters[0];
    if (typeof waiter !== "function") {
      assert.fail("the release waiter never registered");
    }
    waiter(); // the release fires
    assert.equal(await pending, true);
    assert.equal(s.waitBudgetRemainingMs, 180_000);
  });

  it("parks on the cooldown within budget — charge-before-sleep (earliest + 500ms jitter)", async () => {
    const s = state({ cooldownUntil: new Map([[0, NOW + 4_000]]) });
    let tick = NOW;
    const result = await resolveBlockedPick(
      s,
      () => tick,
      async (ms) => {
        tick += ms; // the injected sleep advances the injected clock
      },
    );
    assert.equal(result, true);
    assert.equal(s.waitBudgetRemainingMs, 180_000 - 4_500);
  });

  it("returns false when the wait budget is spent — the exhaustion terminal", async () => {
    const s = state({ cooldownUntil: new Map([[0, NOW + 60_000]]), waitBudgetRemainingMs: 0 });
    assert.equal(await resolveBlockedPick(s, () => NOW, inertSleep), false);
    assert.equal(s.waitBudgetRemainingMs, 0);
  });

  it("returns false on a fully blocked quiet pool (the D11 dead-pool guard)", async () => {
    const s = state({
      blocked: new Map([
        [0, "refused: 503"],
        [1, "refused: 401"],
      ]),
    });
    assert.equal(await resolveBlockedPick(s, () => NOW, inertSleep), false);
  });

  it("returns false on a quiet pool with a merely free seat (the trailing terminal)", async () => {
    const s = state({ blocked: new Map([[0, "refused: 503"]]) });
    assert.equal(await resolveBlockedPick(s, () => NOW, inertSleep), false);
  });
});
