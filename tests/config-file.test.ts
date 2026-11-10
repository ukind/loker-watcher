import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { loadWatcherConfig, resolveSurfaces } from "../src/config-file.js";

const VALID = {
  keywords: ["react"],
  candidateTerms: ["developer"],
  surfaces: [
    { type: "tag", value: "hiring" },
    { type: "linkedin", value: "hiring indonesia" },
    { type: "linkedin", value: "hiring jakarta" },
    { type: "linkedin", value: "hiring developer indonesia" },
    { type: "linkedin", value: "hiring engineer jakarta" },
    { type: "linkedin", value: "react indonesia" },
  ],
  platforms: { linkedin: true, threads: true },
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
    // Operator-editable committed data (c56569c/a493b8c flipped threads to
    // false): pin the stable half — linkedin must stay on (the PC leg feeds
    // the hosted run) — and accept either threads value.
    assert.equal(config.platforms.linkedin, true);
    assert.equal(typeof config.platforms.threads, "boolean");
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

  it("defaults negativeKeywords to [] when absent", async () => {
    const path = await writeConfig({ ...VALID });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.negativeKeywords, []);
  });

  it("accepts a non-empty negativeKeywords array", async () => {
    const path = await writeConfig({ ...VALID, negativeKeywords: ["internship", "outsourcing"] });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.negativeKeywords, ["internship", "outsourcing"]);
  });

  it("allows an empty negativeKeywords array", async () => {
    const path = await writeConfig({ ...VALID, negativeKeywords: [] });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.negativeKeywords, []);
  });

  it("rejects a non-array negativeKeywords", async () => {
    const path = await writeConfig({ ...VALID, negativeKeywords: "internship" });
    await assert.rejects(() => loadWatcherConfig(path), /negativeKeywords.*must be an array/);
  });

  it("rejects a blank negativeKeywords item", async () => {
    const path = await writeConfig({ ...VALID, negativeKeywords: ["   "] });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /negativeKeywords.*must contain only non-empty strings/,
    );
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

  it("fails visibly when a linkedin surface reaches resolveSurfaces (the PC fetch leg consumes them raw)", () => {
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

describe("platforms", () => {
  it("rejects a missing platforms block", async () => {
    const path = await writeConfig({ ...VALID, platforms: undefined });
    await assert.rejects(() => loadWatcherConfig(path), /"platforms" must be an object/);
  });

  it("rejects a missing platforms.linkedin member", async () => {
    const path = await writeConfig({
      ...VALID,
      platforms: { threads: true },
    });
    await assert.rejects(() => loadWatcherConfig(path), /"platforms\.linkedin" is required/);
  });

  it("rejects a missing platforms.threads member", async () => {
    const path = await writeConfig({
      ...VALID,
      platforms: { linkedin: true },
    });
    await assert.rejects(() => loadWatcherConfig(path), /"platforms\.threads" is required/);
  });

  it("rejects a non-boolean platforms.linkedin member", async () => {
    const path = await writeConfig({
      ...VALID,
      platforms: { linkedin: "yes", threads: true },
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /"platforms\.linkedin" must be a boolean, got "yes"/,
    );
  });

  it("rejects a non-boolean platforms.threads member", async () => {
    const path = await writeConfig({
      ...VALID,
      platforms: { linkedin: true, threads: 1 },
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /"platforms\.threads" must be a boolean, got 1/,
    );
  });

  it("accepts both platforms off", async () => {
    const path = await writeConfig({
      ...VALID,
      platforms: { linkedin: false, threads: false },
    });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.platforms, { linkedin: false, threads: false });
  });

  it("accepts each single platform off", async () => {
    for (const platforms of [
      { linkedin: false, threads: true },
      { linkedin: true, threads: false },
    ]) {
      const path = await writeConfig({ ...VALID, platforms });
      const config = await loadWatcherConfig(path);
      assert.deepEqual(config.platforms, platforms);
    }
  });
});

describe("exactly five linkedin surfaces (FR-8, slice 6)", () => {
  const FIVE = [
    { type: "linkedin", value: "hiring indonesia" },
    { type: "linkedin", value: "hiring jakarta" },
    { type: "linkedin", value: "hiring developer indonesia" },
    { type: "linkedin", value: "hiring engineer jakarta" },
    { type: "linkedin", value: "react indonesia" },
  ];

  it("accepts exactly five linkedin surfaces and keeps their values", async () => {
    const path = await writeConfig({ ...VALID, surfaces: FIVE });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.surfaces, FIVE);
  });

  it("accepts five linkedin surfaces mixed with threads surfaces", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [
        { type: "tag", value: "hiring" },
        ...FIVE,
        { type: "url", value: "https://www.threads.com/@hiresflow" },
      ],
    });
    const config = await loadWatcherConfig(path);
    assert.equal(config.surfaces.filter((s) => s.type === "linkedin").length, 5);
    assert.equal(config.surfaces.length, 7);
  });

  it("rejects four linkedin surfaces", async () => {
    const path = await writeConfig({ ...VALID, surfaces: FIVE.slice(0, 4) });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /4 linkedin surfaces — exactly 5 are required/,
    );
  });

  it("rejects six linkedin surfaces", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [...FIVE, { type: "linkedin", value: "engineer indonesia" }],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /6 linkedin surfaces — exactly 5 are required/,
    );
  });

  it("rejects zero linkedin surfaces", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [
        { type: "tag", value: "hiring" },
        { type: "url", value: "https://www.threads.com/@hiresflow" },
      ],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /0 linkedin surfaces — exactly 5 are required/,
    );
  });

  it("keeps the committed spread at the FRD five", async () => {
    const config = await loadWatcherConfig("watcher.config.json");
    const linkedin = config.surfaces.filter((s) => s.type === "linkedin").map((s) => s.value);
    assert.deepEqual(linkedin, [
      "hiring indonesia",
      "hiring jakarta",
      "hiring developer indonesia",
      "hiring engineer jakarta",
      "react indonesia",
    ]);
  });
});
