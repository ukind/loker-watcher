/**
 * Offline suite for the payload hand-off (design D9/D13).
 *
 * Pins all four failure classes — absent (ENOENT → quiet null-equivalent),
 * stale (over-age across the injected-clock boundary), malformed envelope
 * (invalid JSON / unknown version / posts not an array), malformed rows
 * (drop + count) — plus the atomic round trip (write → read, no temp
 * litter). The reader cannot silently drop rows or throw while this suite
 * is green.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import {
  PAYLOAD_MAX_AGE_MS,
  PAYLOAD_VERSION,
  type PayloadEnvelope,
  readPayloadPosts,
  writePayloadAtomic,
} from "../src/linkedin-payload.js";
import type { Post } from "../src/types.js";

const T0 = Date.UTC(2026, 9, 26, 9, 14, 0);
const MINUTE = 60_000;

const post = (n: number): Post => ({
  platform: "linkedin",
  id: `urn:li:activity:${(BigInt(T0 - n * MINUTE) << 22n).toString()}`,
  text: `post ${n}`,
  author: `author ${n}`,
  permalink: `https://www.linkedin.com/posts/x-${n}`,
  timestamp: new Date(T0 - n * MINUTE).toISOString(),
});

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function payloadPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-payload-"));
  return join(dir, name);
}

async function seedEnvelope(path: string, envelope: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

const envelopeFor = (posts: Post[], writtenAt = T0): PayloadEnvelope => ({
  version: PAYLOAD_VERSION,
  writtenAt: new Date(writtenAt).toISOString(),
  posts,
});

describe("writePayloadAtomic / readPayloadPosts round trip", () => {
  it("round-trips the envelope: posts survive, leg ok, detail carries the age", async () => {
    const path = await payloadPath("round-trip.json");
    await writePayloadAtomic([post(1), post(2)], path, () => T0);
    const read = await readPayloadPosts(path, () => T0 + 1 * MINUTE);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(1), post(2)]);
    assert.equal(read.detail, "payload 1 min old");
  });

  it("leaves no temp litter behind (atomic write)", async () => {
    const path = await payloadPath("atomic.json");
    await writePayloadAtomic([post(3)], path, () => T0);
    const entries = await readdir(join(path, ".."));
    assert.ok(entries.every((entry) => !entry.endsWith(".tmp")));
  });

  it("uses the fixed repo path beside STATE_PATH by default", () => {
    assert.equal(LINKEDIN_PAYLOAD_PATH, "state/linkedin-posts.json");
  });
});

describe("readPayloadPosts failure classes (D13)", () => {
  it("class: absent — ENOENT resolves quietly to a threads-only read", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const read = await readPayloadPosts(await payloadPath("never-written.json"), () => T0);
    assert.deepEqual(read, { posts: [], leg: "absent" });
    assert.equal(read.detail, undefined);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: no payload — threads-only run/.test(line)));
  });

  it("class: stale — over-age resolves to leg stale naming the age", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const path = await payloadPath("stale.json");
    await seedEnvelope(path, envelopeFor([post(1)]));
    const read = await readPayloadPosts(path, () => T0 + PAYLOAD_MAX_AGE_MS + 1);
    assert.equal(read.leg, "stale");
    assert.deepEqual(read.posts, []);
    assert.match(read.detail ?? "", /payload .*h old/);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: payload stale/.test(line)));
  });

  it("stale boundary: a payload exactly PAYLOAD_MAX_AGE_MS old is still ok", async () => {
    const path = await payloadPath("boundary.json");
    await seedEnvelope(path, envelopeFor([post(1)]));
    const read = await readPayloadPosts(path, () => T0 + PAYLOAD_MAX_AGE_MS);
    assert.equal(read.leg, "ok");
  });

  it("class: malformed — invalid JSON resolves to leg malformed naming the reason", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await payloadPath("bad-json.json");
    await writeFile(path, "{not json", "utf8");
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /not valid JSON/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: payload not valid JSON/.test(line)));
  });

  it("class: malformed — an unknown version is rejected, not floored", async () => {
    const path = await payloadPath("bad-version.json");
    await seedEnvelope(path, { ...envelopeFor([post(1)]), version: 99 });
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /unknown version 99/);
  });

  it("class: malformed — a non-object envelope is rejected", async () => {
    const path = await payloadPath("not-object.json");
    await seedEnvelope(path, [post(1)]);
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /not an object/);
  });

  it("class: malformed — a posts field that is not an array is rejected", async () => {
    const path = await payloadPath("posts-not-array.json");
    await seedEnvelope(path, {
      version: PAYLOAD_VERSION,
      writtenAt: new Date(T0).toISOString(),
      posts: "nope",
    });
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /posts is not an array/);
  });

  it("class: rows — malformed rows are dropped and counted, leg stays ok", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await payloadPath("mixed-rows.json");
    const junk = {
      platform: "linkedin",
      id: "not-a-urn",
      text: "",
      author: "a",
      permalink: "p",
      timestamp: "nope",
    };
    await seedEnvelope(path, envelopeFor([post(1), junk as unknown as Post, post(2)]));
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(1), post(2)]);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /payload carried 1 malformed row/.test(line)));
  });

  it("never throws on any garbage input", async () => {
    const path = await payloadPath("garbage.json");
    await writeFile(path, "\x00\x01binary junk", "utf8");
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.deepEqual(read.posts, []);
  });
});
