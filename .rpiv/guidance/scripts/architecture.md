# scripts/ — production commit-back script, endpoint probe + agent hooks

## Responsibility
Eight files, deliberately separate from src/ (the production watcher): `commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of BOTH commit-back steps (watch.yml's Commit state, the probe job's Commit ceilings), executed by the hosted write paths; `probe-judge.ts` measures the LLM endpoint's latency and per-account ceiling, then writes them to `state/judge-ceilings.json` (live-only, BEFORE the dead-account gate) from an Actions runner; `fetch-linkedin.ts` + `watch-linkedin.ts` + `probe-linkedin.ts` are the PC-local LinkedIn leg (tick, loop, gate); `login-linkedin.ts` is the headed cookie harvest; `setup-curl-impersonate.ts` is the one-command curl-impersonate setup (checksum-pinned download + .env wire); `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/ — the arrow points one way: scripts → src (the probe is a "zero-edit site" of judge.ts's API, measuring the EXACT production prompt).

## Invokers
- **commit-state-rebase.sh**: TWO invokers, one call each — watch.yml's Commit state step and the probe job's Commit ceilings step (`bash scripts/commit-state-rebase.sh`, the bare last line; bot identity + the no-op guard stay in YAML). The single retry lives inside the script
- **probe-judge.ts**: the dispatch-only `probe` GATE job in watch.yml, or locally `npx tsx scripts/probe-judge.ts` (needs `LLM_ACCOUNTS`; loads `watcher.config.json` at startup, so run from the repo root)
- **fetch-linkedin.ts / watch-linkedin.ts / probe-linkedin.ts / login-linkedin.ts / setup-curl-impersonate.ts**: run via `npm run fetch-linkedin` / `watch-linkedin` / `probe-linkedin` / `login-linkedin` / `setup-curl` from a DEDICATED clone of main; exit contracts: tick = leg-dead exits 1 after the episode alarm, loop = never exits on leg-dead, probe = gate exit 1, login = exit 1 on timeout/no session, setup-curl = exit 1 on any failure (every message names the playwright escape hatch)
- **hooks/**: `.claude/settings.json` only — PreToolUse matcher `Bash` → gate, PostToolUse matcher `Edit|Write` → formatter. NOT husky: husky runs only `lint-staged`

## Structure
```
commit-state-rebase.sh       # bash, set -e self-owned; OUTSIDE typecheck + lint + lint-staged
                             #   (biome never sees .sh); LF-pinned by .gitattributes; offline
                             #   spawnSync-tested by tests/commit-state-rebase.test.ts; conflict
                             #   skips = set membership over the two committed state files
probe-judge.ts               # .ts, top-level await; imports loadWatcherConfig (keywords + reasoningEffort for the
                             #   real payload), buildBulkMessages + resolveJudgeConfig (+ Post type) from src;
                             #   writes state/judge-ceilings.json (writeCeilingsAtomic + JUDGE_CEILINGS_PATH,
                             #   live-only before the dead gate); INSIDE typecheck + lint + lint-staged
fetch-linkedin.ts            # .ts, entry-guarded (imports fetchTick side-effect free); exports fetchTick /
                             #   pushPayload / handleLegDeadEpisode / guardCheckout; tick = preflight
                             #   (guardCheckout: branch main + clean porcelain, BEFORE cookies/transport/
                             #   any voyager GET) → fetch → payload → add ONLY state/linkedin-posts.json
                             #   → commit → pull --rebase → push, ONE retry (realGit injectable; every
                             #   failure carries git's own merged output); INSIDE typecheck + lint + lint-staged
watch-linkedin.ts            # .ts, always-on loop: one tick + 600s sleep; leg-dead → ONE alarm per episode
                             #   (repo-local marker beside the payload) + continue; INSIDE typecheck + lint
probe-linkedin.ts            # .ts, top-level await gate: cookie resolver → transport → one small voyager page;
                             #   INSIDE typecheck + lint + lint-staged
login-linkedin.ts            # .ts, entry-guarded (imports runLoginHelper side-effect free); exports runLoginHelper /
                             #   findSessionCookies / writeCookieFile; HEADED persistent-profile
                             #   login assist (INTERACTIVE — the operator logs in by hand; no headless re-login);
                             #   writes the cookie file atomically + the .env line (upsertDotEnvLine imported
                             #   from src/env-file.ts since the Phase 9 hoist); INSIDE typecheck + lint + lint-staged
setup-curl-impersonate.ts    # .ts, entry-guarded; exports runSetupCurl / pinned constants (lexiforest v2.3.2 assets
                             #   + release-published sha256 digests) / SETUP_CURL_ESCAPE_HATCH; already-configured
                             #   short-circuit → platform gate → fetch + sha256 pin → OS tar extract → exe walk → .env
                             #   upsert; EVERY failure names the playwright escape hatch; INSIDE typecheck + lint + lint-staged
hooks/gate-destructive.js    # plain .js for bare node (instant start, no tsx); INSIDE lint ONLY — lint-staged's
hooks/format-on-edit.js      #   *.ts glob never matches .js; hooks are covered by npm run lint + their own tests
```

## Probe: refused ≠ failed; the ramp reads the ceiling
```typescript
type ProbeOutcome = { kind: "ok" } | { kind: "refused"; status: number } | { kind: "failed"; message: string };
// refused (HTTP 429 etc.) is a concurrency SIGNAL; failed (network error, 2xx without JSON) is a BROKEN endpoint.
for (let level = 2; level <= RAMP_MAX; level *= 2) {  // doubling walk, never fires a ruled-out level
  /* rampLevel: `level` parallel bulk calls — the exact production prompt (buildBulkMessages), REAL captured captions */
  if (result.failed > 0) return 0;            // broken endpoint → ceiling 0 → probe exits 1
  if (result.ok < level) return level / 2;    // ceiling = last fully-clean level — no floor, no Math.max
}
return RAMP_MAX;                             // only a fully clean 2→32 ramp reads 32
// per account, after the ramp: the file key is the trimmed baseUrl (resolveCeilings trims both sides)
ceilings[account.baseUrl.trim()] = ceiling;
// AFTER the account loop, BEFORE the dead gate — live-only, whole file (no merge, no staleness):
await writeCeilingsAtomic(ceilings, JUDGE_CEILINGS_PATH);
if (dead.length > 0) process.exit(1);         // a red gate skips the Commit ceilings step
```

## Exit-code contracts are the interface
```
commit-state-rebase.sh      exit 0 = pushed; exit 1 = a conflict outside the committed state set
                            (state/seen-posts.json, state/judge-ceilings.json) or a second push
                            failure — BOTH invokers' step shells consume it with no wrapper
probe-judge.ts              exit 1 on any failed leg, auth-dead 401/403, or ceiling < 1 — the probe job is a gate, so this reddens the dispatch run; the ceilings write happens BEFORE the gate, so even a red run recorded its readings
fetch-linkedin.ts           exit 1 on a mis-homed checkout (branch ≠ main or dirty tree — guardCheckout, BEFORE
                            any fetch), on leg-dead (after the ONE episode alarm), or a failed push — the one-off entry
curl/watch entries          watch-linkedin.ts never exits on leg-dead; probe-linkedin.ts exits 1 on leg-dead/short/fault (gate)
login-linkedin.ts           exit 1 on timeout (no session within the budget) or a failed poll/context — one alarm-free operator gate
setup-curl-impersonate.ts   exit 1 on any failure path (non-200 download, sha mismatch, tar, exe-not-found, non-win32) — the message names the escape hatch: re-run setup-curl, or LINKEDIN_TRANSPORT=playwright in .env
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
- The probe walks EVERY `LLM_ACCOUNTS` entry (the doubling ramp fires ~62 calls worst case each) — a rotten key in the pool fails the gating probe job loudly
- Weak success check: a 2xx body counts as ok if it merely `includes("{")` — no verdict parsing
- Gate regexes are a seatbelt, not a sandbox: `git push -f` evades, `--force-with-lease` is caught, `tee` evades the state-file rule

<important if="you are running the judge probe or changing judge ceilings">
## Running the Judge Probe and Applying the Reading
1. Env: `LLM_ACCOUNTS` = JSON array of `{baseUrl, apiKey, model}` (every account is walked; each must pass)
2. Run: Actions → watch → Run workflow (dispatch runs the probe job), or locally `npx tsx scripts/probe-judge.ts` from the repo root (it loads `watcher.config.json` at startup)
3. It measures per account: a minimal call, a 10-post bulk call twice (variance; production `buildBulkMessages` + real keywords + reasoningEffort), then the doubling ramp 2→32 (~6–62 calls, stopping at the first refused level)
4. Read each account's summary line `probe: account N (<baseUrl>) — minimal=… bulk=… bulkAgain=… ceiling=N` — no floor; a failed, auth-dead (401/403), or broken-ramp (ceiling 0) account exits 1; 429-refused legs are busy, not dead
5. Apply: nothing to paste — the probe writes `state/judge-ceilings.json` (whole file, before the gate) and the Commit ceilings step pushes it; a missing entry floors that account at ceiling 1 with one warning
6. Semantics downstream: `resolveCeilings` trims both sides when matching keys; a red-gate probe skips the commit, so the file keeps the last green reading; the file never fails a run
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
