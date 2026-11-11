/**
 * Offline suite for the session reset command (design 2026-11-09).
 *
 * Real files on OS temp: the suite creates the three delete targets (the
 * cookie file, the persistent profile dir, the halt-latch flag), runs the
 * reset over injected paths, and pins the contract — the three targets
 * gone and absent targets a quiet no-op. Nothing inside the repo is
 * touched. (The kept budget-ledger reporting died with the budget
 * machine — browser-walk migration, slice 5.)
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { resetLinkedIn } from "../scripts/reset-linkedin.js";

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function target(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-reset-linkedin-"));
  return join(dir, name);
}

describe("resetLinkedIn", () => {
  it("deletes the cookie file, the profile dir, and the halt latch", async () => {
    const cookiePath = await target("cookies.json");
    const profileDir = await target("chromium-profile");
    const latchPath = await target("linkedin-halt.flag");
    await writeFile(cookiePath, '{"liAt":"AQE","jsessionid":"ajax:1"}\n', "utf8");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "jar"), "x", "utf8");
    await writeFile(latchPath, "LinkedIn security checkpoint\n", "utf8");

    const result = await resetLinkedIn({ cookiePath, profileDir, latchPath });
    assert.deepEqual(result, {
      removed: [cookiePath, profileDir, latchPath],
      absent: [],
    });
    for (const path of [cookiePath, profileDir, latchPath]) {
      await assert.rejects(() => stat(path), /ENOENT/);
    }
  });

  it("is a quiet no-op when every target is already absent", async () => {
    const cookiePath = await target("absent-cookies.json");
    const profileDir = await target("absent-profile");
    const latchPath = await target("absent-halt.flag");
    const result = await resetLinkedIn({ cookiePath, profileDir, latchPath });
    assert.deepEqual(result, {
      removed: [],
      absent: [cookiePath, profileDir, latchPath],
    });
  });

  it("uses the merged env for the cookie path when no override rides", async () => {
    const cookiePath = await target("env-cookies.json");
    await writeFile(cookiePath, "{}\n", "utf8");
    const profileDir = await target("env-profile");
    const latchPath = await target("env-halt.flag");
    const result = await resetLinkedIn({
      env: { LINKEDIN_COOKIES_FILE: cookiePath },
      profileDir,
      latchPath,
    });
    assert.deepEqual(result.removed, [cookiePath]);
    assert.deepEqual(result.absent, [profileDir, latchPath]);
  });
});
