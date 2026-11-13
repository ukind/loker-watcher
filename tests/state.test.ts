import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type AppState,
  CURRENT_STATE_VERSION,
  diffNew,
  diffNewIds,
  loadState,
  migrateState,
  pruneState,
  readSeenIdSet,
  saveState,
  stateTempPath,
  writeStateAtomic,
} from "../src/state.js";
import type { Post } from "../src/types.js";

// Files live in the OS temp dir; the suite cleans up once (offline test rule).
let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

// Pinned clock (UTC): 2026-10-26T09:14:00.000Z.
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const STATE: AppState = {
  version: CURRENT_STATE_VERSION,
  seenPostIds: { "1": iso(NOW - HOUR), "2": iso(NOW - HOUR) },
};

const post = (id: string): Post => ({
  platform: "threads",
  id,
  text: `post ${id}`,
  author: "tester",
  permalink: `https://www.threads.com/@tester/post/${id}`,
  timestamp: iso(NOW - HOUR),
});

/** Temp state file path; seeds the file with raw JSON when given. */
async function tempStateFile(name: string, initial?: unknown): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-state-"));
  const path = join(dir, name);
  if (initial !== undefined) {
    await writeFile(path, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  }
  return path;
}

describe("saveState", () => {
  it("skips the disk write when newIds is empty", async () => {
    const path = await tempStateFile("empty-gate.json"); // no file exists yet
    const result = await saveState(STATE, [], path);
    assert.equal(result.saved, false);
    assert.equal(result.addedCount, 0);
    await assert.rejects(() => readFile(path, "utf8"), /ENOENT/); // file never created
  });

  it("skips the disk write when every id is already seen", async () => {
    const path = await tempStateFile("all-seen.json", STATE);
    const before = await readFile(path, "utf8");
    const result = await saveState(STATE, ["1", "2"], path);
    assert.equal(result.saved, false);
    assert.equal(result.addedCount, 0);
    assert.equal(await readFile(path, "utf8"), before); // byte-identical
  });

  it("records only the unseen ids, stamped by the injected clock, and round-trips through loadState", async () => {
    const path = await tempStateFile("positive.json", STATE);
    const result = await saveState(STATE, ["2", "3"], path, NOW);
    assert.equal(result.saved, true);
    assert.equal(result.addedCount, 1);
    assert.equal(result.state.version, CURRENT_STATE_VERSION);
    assert.deepEqual(result.state.seenPostIds, {
      "1": iso(NOW - HOUR),
      "2": iso(NOW - HOUR),
      "3": iso(NOW),
    });
    const reloaded = await loadState(path);
    assert.equal(reloaded.version, CURRENT_STATE_VERSION);
    assert.deepEqual(reloaded.seenPostIds, result.state.seenPostIds);
  });
});

describe("diffNew", () => {
  it("keeps only posts whose id is absent from the v2 map, in input order", () => {
    const posts = [post("1"), post("2"), post("3")];
    assert.deepEqual(
      diffNew(STATE, posts).map((p) => p.id),
      ["3"],
    );
  });
});

describe("diffNewIds", () => {
  it("keeps only unseen ids, deduped, in input order", () => {
    assert.deepEqual(diffNewIds(STATE, ["2", "3", "3", "4"]), ["3", "4"]);
  });
});

describe("migrateState", () => {
  it("migrates a v1 id array to a v2 map stamped at the migration moment", () => {
    const migrated = migrateState({ version: 1, seenPostIds: ["a", 123] }, NOW);
    assert.equal(migrated.version, CURRENT_STATE_VERSION);
    assert.deepEqual(migrated.seenPostIds, {
      a: iso(NOW),
      "123": iso(NOW),
    });
  });

  it("round-trips a valid v2 map unchanged", () => {
    const raw = { version: 2, seenPostIds: { a: iso(NOW - 5 * HOUR), b: iso(NOW) } };
    assert.deepEqual(migrateState(raw, NOW), raw);
  });

  it("throws when a v1 seenPostIds is not an array", () => {
    assert.throws(
      () => migrateState({ version: 1, seenPostIds: { a: iso(NOW) } }, NOW),
      /seenPostIds must be an array/,
    );
  });

  it("throws naming the item when a v1 entry is neither string nor safe integer", () => {
    assert.throws(() => migrateState({ version: 1, seenPostIds: [true] }, NOW), /invalid post ID/);
  });

  it("throws when a v2 seenPostIds is not an object", () => {
    assert.throws(
      () => migrateState({ version: 2, seenPostIds: ["a"] }, NOW),
      /seenPostIds must be an object/,
    );
  });

  it("throws naming the id when a v2 timestamp is unparseable", () => {
    assert.throws(
      () => migrateState({ version: 2, seenPostIds: { a: "not-a-date" } }, NOW),
      /invalid seenPostIds entry for post ID "a"/,
    );
  });

  it("throws on a missing, fractional, or unsupported version", () => {
    assert.throws(() => migrateState({}, NOW), /invalid or missing schema version/);
    assert.throws(
      () => migrateState({ version: 1.5, seenPostIds: [] }, NOW),
      /invalid or missing schema version/,
    );
    assert.throws(
      () => migrateState({ version: 99, seenPostIds: {} }, NOW),
      /unsupported schema version: 99/,
    );
  });
});

describe("pruneState", () => {
  it("drops entries strictly older than the window and keeps the cutoff entry", () => {
    const state: AppState = {
      version: CURRENT_STATE_VERSION,
      seenPostIds: {
        fresh: iso(NOW),
        edge: iso(NOW - 72 * HOUR), // exactly at the cutoff — kept (>= cutoff)
        older: iso(NOW - 72 * HOUR - 1), // one millisecond past — dropped
        ancient: iso(NOW - 30 * 24 * HOUR),
      },
    };

    const pruned = pruneState(state, 72, NOW);
    assert.equal(pruned.version, CURRENT_STATE_VERSION);
    assert.deepEqual(pruned.seenPostIds, {
      fresh: iso(NOW),
      edge: iso(NOW - 72 * HOUR),
    });
  });

  it("keeps everything when the window is undefined, non-finite, or non-positive", () => {
    const state: AppState = {
      version: CURRENT_STATE_VERSION,
      seenPostIds: { a: iso(NOW - 1000 * HOUR) },
    };
    assert.deepEqual(pruneState(state, undefined, NOW), state);
    assert.deepEqual(pruneState(state, Number.NaN, NOW), state);
    assert.deepEqual(pruneState(state, 0, NOW), state);
  });
});

describe("loadState", () => {
  it("returns the empty v2 state when the file does not exist", async () => {
    const path = await tempStateFile("absent.json");
    assert.deepEqual(await loadState(path, 72, NOW), {
      version: CURRENT_STATE_VERSION,
      seenPostIds: {},
    });
  });

  it("migrates a seeded v1 file to v2 stamped at the load clock", async () => {
    const path = await tempStateFile("legacy.json", { version: 1, seenPostIds: ["a"] });
    const state = await loadState(path, 72, NOW);
    assert.equal(state.version, CURRENT_STATE_VERSION);
    assert.deepEqual(state.seenPostIds, { a: iso(NOW) });
  });

  it("prunes a seeded v2 file against the recency window", async () => {
    const path = await tempStateFile("stale.json", {
      version: 2,
      seenPostIds: { keep: iso(NOW - HOUR), drop: iso(NOW - 100 * HOUR) },
    });
    const state = await loadState(path, 72, NOW);
    assert.deepEqual(state.seenPostIds, { keep: iso(NOW - HOUR) });
  });
});

describe("readSeenIdSet", () => {
  it("warns exactly once and returns an empty set when the file is absent", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await tempStateFile("seen-absent.json"); // unseeded: no file exists yet
    assert.deepEqual(await readSeenIdSet(path), new Set());
    assert.equal(warns.mock.callCount(), 1);
  });

  it("warns exactly once and returns an empty set when the JSON is malformed", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await tempStateFile("seen-broken.json");
    await writeFile(path, "{ not json", "utf8");
    assert.deepEqual(await readSeenIdSet(path), new Set());
    assert.equal(warns.mock.callCount(), 1);
  });

  it("warns exactly once and returns an empty set when the envelope is the wrong shape", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await tempStateFile("seen-shape.json", { version: 99, seenPostIds: {} });
    assert.deepEqual(await readSeenIdSet(path), new Set());
    assert.equal(warns.mock.callCount(), 1);
  });

  it("returns every key unpruned — an entry older than any window survives (full history)", async () => {
    const path = await tempStateFile("seen-full.json", {
      version: CURRENT_STATE_VERSION,
      seenPostIds: {
        fresh: iso(NOW),
        ancient: iso(NOW - 1000 * HOUR), // would die under any recency prune
      },
    });
    const ids = await readSeenIdSet(path);
    assert.equal(ids.size, 2);
    assert.ok(ids.has("fresh"));
    assert.ok(ids.has("ancient"));
  });

  it("round-trips with saveState: every saved id lands in the set", async () => {
    const path = await tempStateFile("seen-round.json");
    await saveState({ version: CURRENT_STATE_VERSION, seenPostIds: {} }, ["a", "b"], path, NOW);
    const ids = await readSeenIdSet(path);
    assert.deepEqual([...ids].sort(), ["a", "b"]);
  });
});

describe("stateTempPath", () => {
  it("returns distinct sibling paths across writes (the 20478d1 contract)", () => {
    const first = stateTempPath("state-dir", NOW);
    const second = stateTempPath("state-dir", NOW);
    assert.notEqual(first, second); // distinct per write — never one literal temp path
    assert.match(basename(first), /^\.\d+\.[a-z0-9]+\.tmp$/u);
    assert.equal(dirname(first), "state-dir"); // inside the given dir, never os.tmpdir()
    assert.equal(dirname(second), "state-dir");
  });

  it("renders the injected clock as the ms component of the name", () => {
    const name = basename(stateTempPath("state-dir", NOW));
    assert.ok(name.startsWith(`.${NOW}.`), name);
  });
});

describe("writeStateAtomic", () => {
  it("removes the temp file and names the target when rename fails", async () => {
    const seeded = await tempStateFile("rename-fail.json", STATE);
    const base = dirname(seeded);
    const target = join(base, "target-is-a-directory");
    await mkdir(target); // a directory at the target path forces rename to fail

    await assert.rejects(
      () => writeStateAtomic(STATE, target),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^state: atomic write failed for /);
        assert.ok(error.message.includes("target-is-a-directory"));
        return true;
      },
    );
    const leftovers = (await readdir(base)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []); // cleanup ran — no orphan temp file
  });

  it("names the target when the state directory cannot be created", async () => {
    const seeded = await tempStateFile("mkdir-fail.json", STATE);
    const base = dirname(seeded);
    const blockedDir = join(base, "blocked-file");
    await writeFile(blockedDir, "a file, not a directory", "utf8");
    const target = join(blockedDir, "state.json");

    await assert.rejects(
      () => writeStateAtomic(STATE, target),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^state: atomic write failed for /);
        assert.ok(error.message.includes("state.json"));
        return true;
      },
    );
  });
});
