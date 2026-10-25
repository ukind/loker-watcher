import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterRecent } from "../src/recency.js";
import type { Post } from "../src/types.js";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

function post(id: string, hoursAgo: number): Post {
  return {
    id,
    text: `post ${id}`,
    author: "tester",
    permalink: `https://www.threads.com/@tester/post/${id}`,
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  };
}

describe("filterRecent", () => {
  it("keeps posts inside the window and drops older ones", () => {
    const posts = [post("1", 1), post("2", 71), post("3", 73), post("4", 500)];
    assert.deepEqual(
      filterRecent(posts, 72, NOW).map((p) => p.id),
      ["1", "2"],
    );
  });

  it("keeps a post exactly at the cutoff", () => {
    assert.equal(filterRecent([post("edge", 72)], 72, NOW).length, 1);
  });

  it("returns everything when the window is not positive", () => {
    const posts = [post("1", 10_000)];
    assert.equal(filterRecent(posts, 0, NOW).length, 1);
    assert.equal(filterRecent(posts, -5, NOW).length, 1);
    assert.equal(filterRecent(posts, Number.NaN, NOW).length, 1);
  });

  it("drops posts with unparseable timestamps", () => {
    const broken: Post = { ...post("bad", 0), timestamp: "not-a-date" };
    assert.equal(filterRecent([broken], 72, NOW).length, 0);
  });

  it("handles an empty list", () => {
    assert.deepEqual(filterRecent([], 72, NOW), []);
  });
});
