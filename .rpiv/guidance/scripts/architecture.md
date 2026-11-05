# scripts/ — production commit-back script, endpoint probe + agent hooks

## Responsibility
Seven files, deliberately separate from src/ (the production watcher): `commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of watch.yml's Commit state step, executed by the only hosted write path; `probe-judge.ts` measures the LLM endpoint's latency and concurrency ceiling from an Actions runner; `fetch-linkedin.ts` + `watch-linkedin.ts` + `probe-linkedin.ts` are the PC-local LinkedIn leg (tick, loop, gate); `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/ — the arrow points one way: scripts → src (the probe is a "zero-edit site" of judge.ts's API, measuring the EXACT production prompt).

## Invokers
- **commit-state-rebase.sh**: watch.yml's Commit state step only — invoked EXACTLY ONCE (`bash scripts/commit-state-rebase.sh`, the bare last line; bot identity + the no-op guard stay in YAML). The single retry lives inside the script
- **probe-judge.ts**: the dispatch-only `probe` GATE job in watch.yml, or locally `npx tsx scripts/probe-judge.ts` (needs `LLM_ACCOUNTS`; loads `watcher.config.json` at startup, so run from the repo root)
- **fetch-linkedin.ts / watch-linkedin.ts / probe-linkedin.ts / login-linkedin.ts**: run via `npm run fetch-linkedin` / `watch-linkedin` / `probe-linkedin` / `login-linkedin` from a DEDICATED clone of main; exit contracts: tick = leg-dead exits 1 after the episode alarm, loop = never exits on leg-dead, probe = gate exit 1, login = exit 1 on timeout/no session
- **hooks/**: `.claude/settings.json` only — PreToolUse matcher `Bash` → gate, PostToolUse matcher `Edit|Write` → formatter. NOT husky: husky runs only `lint-staged`

## Structure
```
commit-state-rebase.sh       # bash, set -e self-owned; OUTSIDE typecheck + lint + lint-staged
                             #   (biome never sees .sh); LF-pinned by .gitattributes; offline
                             #   spawnSync-tested by tests/commit-state-rebase.test.ts
probe-judge.ts               # .ts, top-level await; imports loadWatcherConfig (keywords + reasoningEffort for the
                             #   real payload), buildBulkMessages + resolveJudgeConfig (+ Post type) from src;
                             #   INSIDE typecheck + lint + lint-staged
fetch-linkedin.ts            # .ts, entry-guarded (imports fetchTick side-effect free); exports fetchTick /
                             #   pushPayload / handleLegDeadEpisode; tick = fetch → payload → add ONLY
                             #   state/linkedin-posts.json → commit → pull --rebase → push, ONE retry
                             #   (realGit injectable); INSIDE typecheck + lint + lint-staged
watch-linkedin.ts            # .ts, always-on loop: one tick + 600s sleep; leg-dead → ONE alarm per episode
                             #   (repo-local marker beside the payload) + continue; INSIDE typecheck + lint
probe-linkedin.ts            # .ts, top-level await gate: cookie resolver → transport → one small voyager page;
                             #   INSIDE typecheck + lint + lint-staged
login-linkedin.ts            # .ts, entry-guarded (imports runLoginHelper side-effect free); exports runLoginHelper /
                             #   findSessionCookies / upsertDotEnvLine / writeCookieFile; HEADED persistent-profile
                             #   login assist (INTERACTIVE — the operator logs in by hand; no headless re-login);
                             #   writes the cookie file atomically + the .env line; INSIDE typecheck + lint + lint-staged
hooks/gate-destructive.js    # plain .js for bare node (instant start, no tsx); INSIDE lint ONLY — lint-staged's
hooks/format-on-edit.js      #   *.ts glob never matches .js; hooks are covered by npm run lint + their own tests
```

## Probe: refused ≠ failed; the ramp reads the ceiling
```typescript
type ProbeOutcome = { kind: "ok" } | { kind: "refused"; status: number } | { kind: "failed"; message: string };
// refused (HTTP 429 etc.) is a concurrency SIGNAL; failed (network error, 2xx without JSON) is a BROKEN endpoint.
for (const level of [2, 4]) {                 // never fires a level the previous one ruled out
  /* rampLevel: `level` parallel bulk calls — the exact production prompt (buildBulkMessages), REAL captured captions */
  if (result.failed > 0) return 0;            // broken endpoint → ceiling 0 → probe exits 1
  if (result.ok < level) return level / 2;    // ceiling = last fully-clean level — no floor, no Math.max
}
return 4;                                     // only a fully clean 2→4 ramp reads 4
```

## Exit-code contracts are the interface
```
commit-state-rebase.sh      exit 0 = pushed; exit 1 = non-state conflict abort or second push
                            failure — watch.yml's step shell consumes it with no wrapper
probe-judge.ts              exit 1 on any failed leg, auth-dead 401/403, or ceiling < 1 — the probe job is a gate, so this reddens the dispatch run
fetch-linkedin.ts           exit 1 on leg-dead (after the ONE episode alarm) or a failed push — the one-off entry
curl/watch entries          watch-linkedin.ts never exits on leg-dead; probe-linkedin.ts exits 1 on leg-dead/short/fault (gate)
login-linkedin.ts           exit 1 on timeout (no session within the budget) or a failed poll/context — one alarm-free operator gate
gate-destructive.js         exit 2 = DENY the tool call (reason on stderr); unreadable stdin → exit 0 (fail-open, never block)
format-on-edit.js           ALWAYS exit 0 — post-edit feedback only, can never veto an edit
```

## Hooks: one stdin JSON event, registered in .claude/settings.json
```javascript
// scripts/hooks/gate-destructive.js — PreToolUse, matcher "Bash"
const event = JSON.parse(readFileSync(0, "utf8"));   // try/catch: parse failure → exit 0 (fail-open)
const command = String(event?.tool_input?.command ?? "");
for (const [pattern, why] of RULES) {         // [regex, reason] pairs — includes state/seen-posts.json truncation
  if (pattern.test(command)) { console.error(`Blocked by gate-destructive hook: ${why}. Ask the user first.`); process.exit(2); }
}
process.exit(0);                              // allow
// format-on-edit.js (PostToolUse, "Edit|Write"): extension + existsSync gate, then a charset-allowlist gate
// (^[A-Za-z0-9 _.()/\\:+-]+$ — hostile path → one-line warn, exit 0, NO spawn — cmd.exe tokenizes the path
// because the biome spawn runs shell:true), then spawnSync("npx", ["biome", "format", "--write", file],
// { stdio: "ignore", shell: true }) → ALWAYS exit 0; only result.error is checked, never the child's status.
```

**Caveats:**
- The probe walks EVERY `LLM_ACCOUNTS` entry (~6 calls each) — a rotten key in the pool fails the gating probe job loudly
- Weak success check: a 2xx body counts as ok if it merely `includes("{")` — no verdict parsing
- Gate regexes are a seatbelt, not a sandbox: `git push -f` evades, `--force-with-lease` is caught, `tee` evades the state-file rule

<important if="you are running the judge probe or changing judge concurrency">
## Running the Judge Probe and Applying the Reading
1. Env: `LLM_ACCOUNTS` = JSON array of `{baseUrl, apiKey, model}` (every account is walked; each must pass)
2. Run: Actions → watch → Run workflow (dispatch runs the probe job), or locally `npx tsx scripts/probe-judge.ts` from the repo root (it loads `watcher.config.json` at startup)
3. It measures per account: a minimal call, a 10-post bulk call twice (variance; production `buildBulkMessages` + real keywords + reasoningEffort), then the 2→4 ramp (~6 calls total)
4. Read each account's summary line `probe: account N (<baseUrl>) — minimal=… bulk=… bulkAgain=… ceiling=N` — no floor; a failed, auth-dead (401/403), or broken-ramp (ceiling 0) account exits 1; 429-refused legs are busy, not dead
5. Apply: paste N into the quoted `JUDGE_CONCURRENCY` literal in watch.yml's Run watcher step, updating its `probe run <id>` evidence comment
6. Semantics downstream: `parseJudgeConcurrency` — absent/blank → 4, present-but-invalid → throws (fail-visible)
</important if>

<important if="you are adding a hook script">
## Adding a Hook Script
1. Create `scripts/hooks/<name>.js` — plain .js run by bare `node`; import `readFileSync` from `node:fs`
2. Read ONE JSON event on stdin (`JSON.parse(readFileSync(0, "utf8"))`); on parse failure exit 0 — fail-open, never block
3. Pull the field defensively: `String(event?.tool_input?.<field> ?? "")` — `command` for Bash events, `file_path` for Edit/Write
4. Decide the exit-code contract up front: gating (PreToolUse) → exit 2 denies, 0 allows; feedback (PostToolUse) → always 0
5. Side effects need a guard chain first: extension/existence gate, then a charset allowlist before any `shell: true` spawn (cmd.exe tokenizes the path on Windows)
6. Register in `.claude/settings.json` under the right event with a matcher regex and `"command": "node scripts/hooks/<name>.js"`
7. Add a black-box test `tests/<name>.test.ts` (spawnSync, exit-code pins — see `.rpiv/guidance/tests/architecture.md`) and keep `npm run lint` green (lint-staged never runs on hooks)
8. Sanity-test by piping a fake event: `echo '{"tool_input":{"command":"rm -rf /"}}' | node scripts/hooks/<name>.js`
</important if>
