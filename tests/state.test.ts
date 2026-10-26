import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { type AppState, CURRENT_STATE_VERSION, loadState, saveState } from "../src/state.js";

// Files live in the OS temp dir; the suite cleans up once (offline test rule).
let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

const STATE: AppState = { version: CURRENT_STATE_VERSION, seenPostIds: ["1", "2"] };

/** Temp state file path; seeds the file when an initial state is given. */
async function tempStateFile(name: string, initial?: AppState): Promise<string> {
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

  it("records only the unseen ids and round-trips through loadState", async () => {
    const path = await tempStateFile("positive.json", STATE);
    const result = await saveState(STATE, ["2", "3"], path);
    assert.equal(result.saved, true);
    assert.equal(result.addedCount, 1);
    const reloaded = await loadState(path);
    assert.equal(reloaded.version, CURRENT_STATE_VERSION);
    assert.deepEqual(reloaded.seenPostIds, ["1", "2", "3"]);
  });
});
