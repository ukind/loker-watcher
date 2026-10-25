import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { isValidStorageState, resolveSession } from "../src/threads-session.js";

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
