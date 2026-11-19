#!/usr/bin/env node
// PostToolUse feedback hook: formats the file an agent just edited with Biome.
// Reads one JSON event on stdin. Never blocks: always exits 0.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let event;
try {
  event = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const file = String(event?.tool_input?.file_path ?? "");
if (!/\.(ts|tsx|js|mjs|cjs|json)$/.test(file) || !existsSync(file)) process.exit(0);

// Defense-in-depth keep (N072): the spawn below no longer runs through a
// shell, so cmd.exe cannot tokenize the path — but the allowlist still
// blocks exotic paths (option-looking leading dashes) and its test pin
// depends on it.
if (!/^[A-Za-z0-9 _.()/\\:+-]+$/.test(file)) {
  console.error(`format-on-edit: skipped (path outside the allowlist): ${file}`);
  process.exit(0);
}

// N072: spawn node + Biome's JS launcher directly — no shell. The old
// spawn ran `npx` under shell:true; npx is npx.cmd on Windows and Node
// >= 22 refuses .cmd targets without a shell (EINVAL, the CVE-2024-27980
// mitigation), so the no-shell form needs a real executable target.
const biomeJsBin = fileURLToPath(
  new URL("../../node_modules/@biomejs/biome/bin/biome", import.meta.url),
);
const result = spawnSync(process.execPath, [biomeJsBin, "format", "--write", file], {
  stdio: "ignore",
});
if (result.error) {
  console.error(`format-on-edit: could not run Biome: ${result.error.message}`);
} else if (result.status !== 0) {
  console.error(`format-on-edit: Biome exited ${result.status} (format skipped)`);
}
process.exit(0);
