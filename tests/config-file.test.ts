import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { loadWatcherConfig, resolveSurfaces } from "../src/config-file.js";

const VALID = {
  keywords: ["react"],
  candidateTerms: ["developer"],
  surfaces: [{ type: "tag", value: "hiring" }],
  recencyHours: 72,
};

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function writeConfig(value: unknown): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-config-"));
  const path = join(dir, "watcher.config.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

/** Write a file verbatim, for the cases that must NOT be valid JSON. */
async function writeRawConfig(text: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-config-"));
  const path = join(dir, "watcher.config.json");
  await writeFile(path, text, "utf8");
  return path;
}

describe("loadWatcherConfig — happy path", () => {
  it("loads the committed config file", async () => {
    const config = await loadWatcherConfig("watcher.config.json");
    assert.ok(config.keywords.length > 0);
    assert.ok(config.surfaces.length > 0);
    assert.equal(config.recencyHours, 72);
  });

  it("keeps every configured surface", async () => {
    const config = await loadWatcherConfig("watcher.config.json");
    const tags = config.surfaces.filter((s) => s.type === "tag");
    const urls = config.surfaces.filter((s) => s.type === "url");
    assert.ok(tags.length >= 3);
    assert.ok(urls.length >= 2);
  });
});

describe("loadWatcherConfig — failures", () => {
  it("throws when the file is missing", async () => {
    await assert.rejects(
      () => loadWatcherConfig("watcher.config.does-not-exist.json"),
      /source of truth/,
    );
  });

  it("throws when the file is not JSON", async () => {
    const path = await writeRawConfig("{ not json");
    await assert.rejects(() => loadWatcherConfig(path), /is not valid JSON/);
  });

  it("rejects an unknown top-level key", async () => {
    const path = await writeConfig({ ...VALID, keyword: ["react"] });
    await assert.rejects(() => loadWatcherConfig(path), /unknown key "keyword"/);
  });

  it("rejects an empty surfaces array", async () => {
    const path = await writeConfig({ ...VALID, surfaces: [] });
    await assert.rejects(() => loadWatcherConfig(path), /surfaces.*must not be empty/);
  });

  it("rejects an empty keywords array", async () => {
    const path = await writeConfig({ ...VALID, keywords: [] });
    await assert.rejects(() => loadWatcherConfig(path), /keywords.*must not be empty/);
  });

  it("rejects an unknown surface type", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "profile", value: "hiresflow" }],
    });
    await assert.rejects(() => loadWatcherConfig(path), /surface "type" must be/);
  });

  it("rejects a non-threads.com URL", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "url", value: "https://example.com/feed" }],
    });
    await assert.rejects(() => loadWatcherConfig(path), /must be https:\/\/www\.threads\.com/);
  });

  it("rejects a relative URL", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "url", value: "/@hiresflow" }],
    });
    await assert.rejects(() => loadWatcherConfig(path), /not an absolute URL/);
  });

  it("rejects a non-positive recencyHours", async () => {
    const path = await writeConfig({ ...VALID, recencyHours: 0 });
    await assert.rejects(() => loadWatcherConfig(path), /recencyHours.*positive/);
  });

  it("allows an empty candidateTerms array", async () => {
    const path = await writeConfig({ ...VALID, candidateTerms: [] });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.candidateTerms, []);
  });
});

describe("resolveSurfaces", () => {
  it("builds the tag-page URL and label", () => {
    const resolved = resolveSurfaces([{ type: "tag", value: "hiring" }]);
    assert.deepEqual(resolved, [
      { label: "tag/hiring", url: "https://www.threads.com/tag/hiring" },
    ]);
  });

  it("uses a url surface verbatim", () => {
    const url = "https://www.threads.com/@hiresflow";
    const resolved = resolveSurfaces([{ type: "url", value: url }]);
    assert.deepEqual(resolved, [{ label: url, url }]);
  });

  it("percent-encodes a tag that needs it", () => {
    const resolved = resolveSurfaces([{ type: "tag", value: "a b" }]);
    assert.equal(resolved[0]?.url, "https://www.threads.com/tag/a%20b");
  });
});
