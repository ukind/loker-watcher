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

  it('defaults reasoningEffort to "medium" when absent', async () => {
    const path = await writeConfig({ ...VALID });
    const config = await loadWatcherConfig(path);
    assert.equal(config.reasoningEffort, "medium");
  });

  it("normalizes reasoningEffort case-insensitively", async () => {
    const path = await writeConfig({ ...VALID, reasoningEffort: "HIGH" });
    const config = await loadWatcherConfig(path);
    assert.equal(config.reasoningEffort, "high");
  });

  it("rejects an invalid reasoningEffort value", async () => {
    const path = await writeConfig({ ...VALID, reasoningEffort: "extreme" });
    await assert.rejects(() => loadWatcherConfig(path), /reasoningEffort/);
  });

  it("rejects a non-string reasoningEffort value", async () => {
    const path = await writeConfig({ ...VALID, reasoningEffort: 123 });
    await assert.rejects(() => loadWatcherConfig(path), /reasoningEffort/);
  });

  it("allows an empty candidateTerms array", async () => {
    const path = await writeConfig({ ...VALID, candidateTerms: [] });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.candidateTerms, []);
  });

  it("accepts a linkedin surface", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "linkedin", value: "#hiring" }],
    });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.surfaces, [{ type: "linkedin", value: "#hiring" }]);
  });

  it("rejects an empty linkedin surface value", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "linkedin", value: "   " }],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /surface "value" must be a non-empty string/,
    );
  });

  it("rejects a non-string linkedin surface value", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "linkedin", value: 123 }],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /surface "value" must be a non-empty string/,
    );
  });
});

describe("resolveSurfaces", () => {
  it("builds the tag-page URL and label", () => {
    const resolved = resolveSurfaces([{ type: "tag", value: "hiring" }]);
    assert.deepEqual(resolved, [
      {
        platform: "threads",
        label: "tag/hiring",
        url: "https://www.threads.com/tag/hiring",
      },
    ]);
  });

  it("uses a url surface verbatim", () => {
    const url = "https://www.threads.com/@hiresflow";
    const resolved = resolveSurfaces([{ type: "url", value: url }]);
    assert.deepEqual(resolved, [{ platform: "threads", label: url, url }]);
  });

  it("percent-encodes a tag that needs it", () => {
    const resolved = resolveSurfaces([{ type: "tag", value: "a b" }]);
    assert.equal(resolved[0]?.url, "https://www.threads.com/tag/a%20b");
  });

  it("fails visibly when a linkedin surface reaches resolveSurfaces (the SDK fetcher consumes them raw)", () => {
    assert.throws(
      () => resolveSurfaces([{ type: "linkedin", value: "#hiring" }]),
      /linkedin surface "#hiring" reached resolveSurfaces/,
    );
  });
});

describe("scrollRounds", () => {
  it("defaults to 8 when absent", async () => {
    const path = await writeConfig({ ...VALID });
    const config = await loadWatcherConfig(path);
    assert.equal(config.scrollRounds, 8);
  });

  it("accepts a positive integer", async () => {
    const path = await writeConfig({ ...VALID, scrollRounds: 5 });
    const config = await loadWatcherConfig(path);
    assert.equal(config.scrollRounds, 5);
  });

  it("rejects a fractional value", async () => {
    const path = await writeConfig({ ...VALID, scrollRounds: 5.5 });
    await assert.rejects(() => loadWatcherConfig(path), /"scrollRounds" must be an integer >= 1/);
  });

  it("rejects zero", async () => {
    const path = await writeConfig({ ...VALID, scrollRounds: 0 });
    await assert.rejects(() => loadWatcherConfig(path), /"scrollRounds" must be an integer >= 1/);
  });

  it("rejects a non-numeric value", async () => {
    const path = await writeConfig({ ...VALID, scrollRounds: "five" });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /"scrollRounds" must be an integer >= 1, got "five"/,
    );
  });
});
