#!/usr/bin/env node
// PreToolUse gate hook: blocks destructive shell commands before they run.
// Reads one JSON event on stdin. Exit 2 denies the tool call.

import { readFileSync } from "node:fs";

const RULES = [
  [/\brm\s+-[a-z]*r[a-z]*f/i, "recursive force delete (rm -rf)"],
  [/\bgit\s+push\b[^|;&]*--force/i, "force push"],
  [/\bgit\s+reset\s+--hard\b/i, "git reset --hard"],
  [/\bdrop\s+table\b/i, "DROP TABLE"],
  [/\bmkfs\b/i, "mkfs"],
  [/state[\\/]seen-posts\.json\s*(>|>>)/, "truncate the state file in place"],
];

let event;
try {
  event = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // unreadable event: fail open, never block
}

const command = String(event?.tool_input?.command ?? "");
for (const [pattern, why] of RULES) {
  if (pattern.test(command)) {
    console.error(`Blocked by gate-destructive hook: ${why}. Ask the user before running this.`);
    process.exit(2);
  }
}
process.exit(0);
