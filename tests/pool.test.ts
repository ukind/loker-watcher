/**
 * runPool suite (N080): claim positionality, the width clamp, the empty
 * no-op, the concurrency cap, and the join contract — a rejecting worker
 * propagates (the caller owns the error), width 0 runs nothing (the caller
 * owns the floor; judgePosts wraps its width in Math.max(1, ...)).
 * judge-parse skeleton: pure leaf, no doubles beyond closures.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPool } from "../src/pool.js";

describe("runPool", () => {
  it("delivers the ORIGINAL index with each item", async () => {
    const seen: Array<[string, number]> = [];
    await runPool(["x", "y", "z"], 3, async (item, index) => {
      seen.push([item, index]);
    });
    assert.deepEqual(
      seen.sort((a, b) => a[1] - b[1]),
      [
        ["x", 0],
        ["y", 1],
        ["z", 2],
      ],
    );
  });

  it("runs every item exactly once across concurrent workers", async () => {
    const counts = new Map<string, number>();
    await runPool(["a", "b", "c", "d", "e"], 2, async (item) => {
      counts.set(item, (counts.get(item) ?? 0) + 1);
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.deepEqual([...counts.entries()].sort(), [
      ["a", 1],
      ["b", 1],
      ["c", 1],
      ["d", 1],
      ["e", 1],
    ]);
  });

  it("caps concurrent workers at the width", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5, 6], 2, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    assert.equal(peak, 2);
  });

  it("clamps the width to the item count — 10 over 2 items peaks at 2", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool([1, 2], 10, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
    });
    assert.equal(peak, 2);
  });

  it("runs an empty list as a no-op", async () => {
    let calls = 0;
    await runPool([], 4, async () => {
      calls += 1;
    });
    assert.equal(calls, 0);
  });

  it("width 0 runs nothing — the caller owns the floor (judgePosts Math.max(1, ...))", async () => {
    let calls = 0;
    await runPool([1, 2, 3], 0, async () => {
      calls += 1;
    });
    assert.equal(calls, 0);
  });

  it("propagates a rejecting worker (the caller owns the error)", async () => {
    await assert.rejects(
      () =>
        runPool([1, 2, 3], 2, async (item) => {
          if (item === 2) throw new Error("worker fault");
        }),
      /worker fault/,
    );
  });
});
