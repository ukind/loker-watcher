#!/usr/bin/env node
// PostToolUse feedback hook: formats the file an agent just edited with Biome.
// Reads one JSON event on stdin. Never blocks: always exits 0.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

let event;
try {
  event = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const file = String(event?.tool_input?.file_path ?? "");
if (!/\.(ts|tsx|js|mjs|cjs|json)$/.test(file) || !existsSync(file)) process.exit(0);

// The spawn runs with shell:true (npx is npx.cmd on Windows), so cmd.exe
// tokenizes `file`. Reject any path carrying a character outside this
// allowlist — the class excludes every cmd.exe metacharacter.
if (!/^[A-Za-z0-9 _.()/\\:+-]+$/.test(file)) {
  console.error(`format-on-edit: skipped (path outside the allowlist): ${file}`);
  process.exit(0);
}

const result = spawnSync("npx", ["biome", "format", "--write", file], {
  stdio: "ignore",
  shell: true,
});
if (result.error) console.error(`format-on-edit: could not run Biome: ${result.error.message}`);
process.exit(0);
