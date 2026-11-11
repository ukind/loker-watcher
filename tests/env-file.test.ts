/**
 * Offline suite for the .env auto-load (Phase 7).
 *
 * Pins the parser shape (KEY=VALUE, comments, blanks, quoted values,
 * malformed-line warn+skip) and the merge contract: .env fills ONLY unset
 * keys, the real environment always wins, a missing .env is a quiet no-op,
 * and an unreadable .env never throws. Zero real cwd: cwd is injected and
 * fixtures live in OS temp.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ENV_NAMES } from "../src/config.js";
import { DOT_ENV_PATH, envWithDotEnv, parseDotEnv, upsertDotEnvLine } from "../src/env-file.js";

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function envDir(content?: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-env-file-"));
  // A fresh cwd per case: one test's .env must never leak into the next
  // case (the "missing .env" and "unreadable .env" pins need a clean dir).
  const cwd = await mkdtemp(join(dir, "case-"));
  if (content !== undefined) {
    await writeFile(join(cwd, DOT_ENV_PATH), content, "utf8");
  }
  return cwd;
}

/** A plain work file in the suite's OS-temp dir (upsert pins write any path, not only .env). */
async function workPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-env-file-"));
  return join(dir, name);
}

describe("parseDotEnv", () => {
  it("parses KEY=VALUE, skips comments and blanks, strips one quote pair", () => {
    const parsed = parseDotEnv(
      [
        "# a comment",
        "",
        "LINKEDIN_COOKIES_FILE=C:/loker-secrets/linkedin-cookies.json",
        'SAMPLE_BIN="C:/tools/sample/sample.exe"',
        "QUOTED='single'",
        "EMPTY=",
      ].join("\n"),
    );
    assert.deepEqual(parsed, {
      LINKEDIN_COOKIES_FILE: "C:/loker-secrets/linkedin-cookies.json",
      SAMPLE_BIN: "C:/tools/sample/sample.exe",
      QUOTED: "single",
      EMPTY: "",
    });
  });

  it("warns once per malformed line, names file and line, and skips it", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const parsed = parseDotEnv("GOOD=1\nnot-a-pair\n#fine\n=NOKEY");
    assert.deepEqual(parsed, { GOOD: "1" });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? "", /\.env line 2 is not KEY=VALUE/);
    assert.match(lines[1] ?? "", /\.env line 4 is not KEY=VALUE/);
  });
});

describe("envWithDotEnv", () => {
  it("fills ONLY unset keys from .env; the real environment wins conflicts", async () => {
    const cwd = await envDir("FROM_FILE=a\nSHARED=from-file\n");
    const merged = envWithDotEnv({ SHARED: "from-env" }, cwd);
    assert.equal(merged.FROM_FILE, "a");
    assert.equal(merged.SHARED, "from-env");
  });

  it("returns the input untouched when .env is missing (quiet normal)", async () => {
    const cwd = await envDir();
    const env = { ONLY: "env" };
    assert.equal(envWithDotEnv(env, cwd), env);
  });

  it("never throws on an unreadable .env (a directory in the way)", async () => {
    const cwd = await envDir();
    await mkdir(join(cwd, DOT_ENV_PATH));
    const merged = envWithDotEnv({ ONLY: "env" }, cwd);
    assert.equal(merged.ONLY, "env");
  });
});

describe("upsertDotEnvLine", () => {
  // Pins hoisted here from tests/login-linkedin.test.ts (Phase 9): the
  // writer moved to src/env-file.ts verbatim, so its pins moved with it.
  it("creates the file with the line when absent", async () => {
    const path = await workPath("env-1");
    assert.equal(
      await upsertDotEnvLine(path, ENV_NAMES.linkedinCookiesFile, "C:/x/cook.json"),
      true,
    );
    assert.equal(await readFile(path, "utf8"), `${ENV_NAMES.linkedinCookiesFile}=C:/x/cook.json\n`);
  });

  it("replaces an existing line without duplicating it", async () => {
    const path = await workPath("env-2");
    await writeFile(path, `OTHER=1\n${ENV_NAMES.linkedinCookiesFile}=C:/old.json\n`, "utf8");
    assert.equal(await upsertDotEnvLine(path, ENV_NAMES.linkedinCookiesFile, "C:/new.json"), true);
    const text = await readFile(path, "utf8");
    assert.ok(text.includes("C:/new.json"));
    assert.ok(!text.includes("C:/old.json"));
    assert.equal(text.match(new RegExp(ENV_NAMES.linkedinCookiesFile, "g"))?.length, 1);
  });

  it("writes nothing when the line already carries the value", async () => {
    const path = await workPath("env-3");
    assert.equal(await upsertDotEnvLine(path, ENV_NAMES.linkedinCookiesFile, "C:/same.json"), true);
    assert.equal(
      await upsertDotEnvLine(path, ENV_NAMES.linkedinCookiesFile, "C:/same.json"),
      false,
    );
    const text = await readFile(path, "utf8");
    assert.equal(text.match(new RegExp(ENV_NAMES.linkedinCookiesFile, "g"))?.length, 1);
  });
});
