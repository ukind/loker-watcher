import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Black-box: the hook runs as a bare subprocess exactly as .claude/settings.json
// registers it (PreToolUse, Bash) — no import, no mocking. process.execPath
// because the shebang is inert on Windows.
const GATE = fileURLToPath(new URL("../scripts/hooks/gate-destructive.js", import.meta.url));

function runGate(input: string) {
  return spawnSync(process.execPath, [GATE], { input, encoding: "utf8" });
}

describe("gate-destructive hook", () => {
  it("denies rm -rf and names the rule on stderr", () => {
    const command = "rm -rf build/";
    const run = runGate(JSON.stringify({ tool_input: { command } }));
    assert.equal(run.status, 2);
    assert.match(run.stderr, /recursive force delete \(rm -rf\)/);
  });

  it("denies a force push", () => {
    const command = "git push origin main --force";
    const run = runGate(JSON.stringify({ tool_input: { command } }));
    assert.equal(run.status, 2);
    assert.match(run.stderr, /force push/);
  });

  it("denies git reset --hard", () => {
    const command = "git reset --hard HEAD~1";
    const run = runGate(JSON.stringify({ tool_input: { command } }));
    assert.equal(run.status, 2);
    assert.match(run.stderr, /git reset --hard/);
  });

  it("denies a compound command hitting DROP TABLE (case-insensitive) first", () => {
    const command = "psql -c 'Drop Table users'; mkfs -t ext4; echo x > state/seen-posts.json";
    const run = runGate(JSON.stringify({ tool_input: { command } }));
    assert.equal(run.status, 2);
    assert.match(run.stderr, /DROP TABLE/);
  });

  it("fails open on unreadable stdin", () => {
    assert.equal(runGate("not json").status, 0);
  });

  it("allows a benign command (allow path, distinct from fail-open)", () => {
    const command = "npm test";
    const run = runGate(JSON.stringify({ tool_input: { command } }));
    assert.equal(run.status, 0);
  });
});
