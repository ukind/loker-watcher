import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { cleanupSessionDir, isValidStorageState, resolveSession } from "../src/threads-session.js";

const VALID = Buffer.from(
  JSON.stringify({
    cookies: [{ name: "sessionid", value: "x", domain: ".threads.com", path: "/" }],
    origins: [],
  }),
  "utf8",
).toString("base64");

describe("isValidStorageState", () => {
  it("accepts a document with a non-empty cookies array", () => {
    assert.equal(isValidStorageState({ cookies: [{}] }), true);
  });

  it("rejects documents without cookies", () => {
    assert.equal(isValidStorageState({ cookies: [] }), false);
    assert.equal(isValidStorageState({}), false);
    assert.equal(isValidStorageState(null), false);
    assert.equal(isValidStorageState("nope"), false);
  });
});

describe("resolveSession", () => {
  it("returns null when the secret is unset or blank", async () => {
    assert.equal(await resolveSession({}), null);
    assert.equal(await resolveSession({ THREADS_SESSION_STATE: "   " }), null);
  });

  it("returns null for a secret that is not base64 JSON", async () => {
    assert.equal(await resolveSession({ THREADS_SESSION_STATE: "!!!not-base64!!!" }), null);
  });

  it("returns null when the document carries no cookies", async () => {
    const empty = Buffer.from(JSON.stringify({ cookies: [] }), "utf8").toString("base64");
    assert.equal(await resolveSession({ THREADS_SESSION_STATE: empty }), null);
  });

  it("writes a valid storageState file and returns its path", async () => {
    const path = await resolveSession({ THREADS_SESSION_STATE: VALID });
    assert.ok(path !== null);
    const doc = JSON.parse(await readFile(path, "utf8")) as {
      cookies: Array<{ name: string }>;
    };
    assert.equal(doc.cookies[0]?.name, "sessionid");
  });
});

describe("cleanupSessionDir", () => {
  it("removes the session dir that resolveSession created", async () => {
    const path = await resolveSession({ THREADS_SESSION_STATE: VALID });
    assert.ok(path !== null);
    await stat(path); // the storage-state file exists before cleanup
    await cleanupSessionDir(path);
    await assert.rejects(() => stat(path), /ENOENT/); // file gone
    await assert.rejects(() => stat(dirname(path)), /ENOENT/); // the dir with it
  });

  it("tolerates a missing dir silently", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const missing = join(tmpdir(), "loker-session-gone", "storage-state.json");
    await cleanupSessionDir(missing); // resolves — force ignores ENOENT
    assert.equal(warns.mock.calls.length, 0); // silence is part of the contract
  });
});
