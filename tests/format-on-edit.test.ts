import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Black-box pins for the format-on-edit hook (registered PostToolUse
// "Edit|Write" in .claude/settings.json). Gate order: JSON parse (fail-open)
// → extension + existsSync → charset allowlist → spawn. The hook sets
// stdio:"ignore" and ignores biome's exit status (it checks only
// result.error), so file-content mutation is the only honest observable for
// the format path; the hostile pin asserts the warn + no-mutation instead.
const HOOK = fileURLToPath(new URL("../scripts/hooks/format-on-edit.js", import.meta.url));

function runHook(input: string) {
  return spawnSync(process.execPath, [HOOK], { input, encoding: "utf8" });
}

describe("format-on-edit hook", () => {
  it("formats a real temp .ts file — content mutation is the pin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lw-format-on-edit-"));
    try {
      const target = join(dir, "unformatted.ts");
      await writeFile(target, "const x=1", "utf8");
      const run = runHook(JSON.stringify({ tool_input: { file_path: target } }));
      assert.equal(run.status, 0);
      const after = await readFile(target, "utf8");
      assert.notEqual(after, "const x=1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a hostile path: exits 0, warns, never formats", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lw-format-on-edit-"));
    try {
      // The file must exist: the existsSync gate exits silently otherwise,
      // and this pin would pass vacuously.
      const target = join(dir, "bad&name.ts");
      await writeFile(target, "const x=1", "utf8");
      const run = runHook(JSON.stringify({ tool_input: { file_path: target } }));
      assert.equal(run.status, 0);
      assert.match(run.stderr, /skipped \(path outside the allowlist\)/);
      assert.equal(await readFile(target, "utf8"), "const x=1"); // biome never ran
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails open on unreadable stdin", () => {
    assert.equal(runHook("not json").status, 0);
  });

  it("exits silently when the file does not exist (existsSync gate)", () => {
    // A hostile NONEXISTENT path: the existsSync gate fires before the
    // charset allowlist, so the miss stays silent (exit 0, empty stderr).
    const run = runHook(JSON.stringify({ tool_input: { file_path: "x&calc.ts" } }));
    assert.equal(run.status, 0);
    assert.equal(run.stderr, "");
  });
});
