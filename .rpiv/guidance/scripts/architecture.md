# scripts/ — production commit-back script, endpoint probe + agent hooks

## Responsibility
Nine files, deliberately separate from src/ (the production watcher): `commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of ALL THREE commit-back steps (watch.yml's Commit state, the probe job's Commit ceilings, and watch.yml's Commit health), executed by the hosted write paths; `probe-judge.ts` measures the LLM endpoint's latency and per-account ceiling, then writes them to `state/judge-ceilings.json` (live-only, BEFORE the dead-account gate, plus a `probedAt` freshness stamp) from an Actions runner; `fetch-linkedin.ts` + `watch-linkedin.ts` + `probe-linkedin.ts` + `linkedin-chain.ts` are the PC-local LinkedIn leg (tick, loop, gate, chain); `login-linkedin.ts` is the headed cookie harvest; `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/ — the arrow points one way: scripts → src (the probe is a "zero-edit site" of judge.ts's API, measuring the EXACT production prompt).

## Invokers
- **commit-state-rebase.sh**: THREE invokers, one call each — watch.yml's Commit state step, the probe job's Commit ceilings step, and watch.yml's Commit health step (`bash scripts/commit-state-rebase.sh`, the bare last line; bot identity + the no-op guard stay in YAML). The single retry lives inside the script
- **probe-judge.ts**: the dispatch-only `probe` GATE job in watch.yml, or locally `npx tsx scripts/probe-judge.ts` (needs `LLM_ACCOUNTS`; loads `watcher.config.json` at startup, so run from the repo root)
- **fetch-linkedin.ts / watch-linkedin.ts / probe-linkedin.ts / login-linkedin.ts**: run via `npm run fetch-linkedin` / `watch-linkedin` / `probe-linkedin` / `login-linkedin` from a DEDICATED clone of main; exit contracts: tick = leg-dead exits 1 after the episode alarm (an all-faulted walk is a tagged no-op exit 0, payload untouched), loop = never exits on leg-dead, probe = gate exit 1, login = exit 1 on timeout/no session; keep-open is the DEFAULT at the CLI — the helper holds for Enter and closes the browser (--auto-close restores fire-and-close)
- **linkedin-chain.ts**: run via `npm run linkedin-chain` from a DEDICATED clone of main (stage 3's guardCheckout enforces branch main + a clean tree BEFORE any fetch — the chain code itself must be committed first); exit contract: 0 when all three stages ran — a quiet-zero tick (working-hours window, halt latch, halt trip, all-faulted walk, zero surfaces) is a REPORTED NO-OP, still exit 0 (the defb8af rule) — and 1 when any stage throws (the wrapper prints `linkedin-chain: FAILED — <gate and remedy>`); INTERACTIVE: the login hold reads Enter, so a real TTY is required
- **hooks/**: `.claude/settings.json` only — PreToolUse matcher `Bash` → gate, PostToolUse matcher `Edit|Write` → formatter. NOT husky: husky runs only `lint-staged`

## Structure
```
commit-state-rebase.sh       # bash, set -e self-owned; OUTSIDE typecheck + lint + lint-staged
                             #   (biome never sees .sh); LF-pinned by .gitattributes; offline
                             #   spawnSync-tested by tests/commit-state-rebase.test.ts; conflict
                             #   skips = set membership over the three committed state files, bounded
                             #   by a hard-coded 50-skip runaway guard with an exhaustion echo;
                             #   rebases onto the CHECKOUT BRANCH's own remote head (branch --show-current,
                             #   NOT origin/main — run 885: a dispatched non-main branch must commit back
                             #   onto its own remote head or its push fights the sibling job's push)
probe-judge.ts               # .ts, top-level await; imports loadWatcherConfig (keywords + reasoningEffort for the
                             #   real payload), buildBulkMessages + resolveJudgeConfig (+ Post type) from src;
                             #   Promise.allSettled walks ALL ACCOUNTS CONCURRENTLY (ramp levels sequential
                             #   within an account; ramp lines carry the account label); writes
                             #   state/judge-ceilings.json (writeCeilingsAtomic + JUDGE_CEILINGS_PATH) with a
                             #   probedAt stamp — live-only, BEFORE the dead gate, bytes always change;
                             #   INSIDE typecheck + lint + lint-staged
fetch-linkedin.ts            # .ts, entry-guarded (imports fetchTick side-effect free); exports fetchTick /
                             #   pushPayload / handleLegDeadEpisode / guardCheckout; tick = preflight
                             #   (the working-hours window and the checkpoint latch, then guardCheckout:
                             #   branch main + clean porcelain, BEFORE the cookie gate or any fetch)
                             #   → fetch → payload → add ONLY state/linkedin-posts.json
                             #   → commit → pull --rebase → push, ONE retry (realGit injectable; every
                             #   failure carries git's own merged output); INSIDE typecheck + lint + lint-staged
watch-linkedin.ts            # .ts, always-on loop: one tick + a jittered 28-33-minute sleep; leg-dead →
                             #   ONE alarm per episode
                             #   (repo-local marker beside the payload) + continue; INSIDE typecheck + lint
probe-linkedin.ts            # .ts, entry-guarded (importing stays side-effect free — the import IS the pin);
                             #   exports runProbe / ProbeDeps / ProbeResult + the two TAGGED local gates
                             #   (probeFloor / probeNoSurfaces + isProbe* guards): resolve config, pick the
                             #   FIRST configured surface, preflight the cookie file (resolveLinkedInCookies
                             #   — presence/parse only; the browser rides the PROFILE), then the HEADED
                             #   persistent-profile production walk READ-ONLY — config.scrollRounds as the
                             #   click bound, PROBE_MIN_CLICKS=5 as the click floor, PROBE_MIN_POSTS=10 as
                             #   the gate; gate failures THROW (halt / leg-dead / all-faulted keep their
                             #   tags, the local gates carry theirs — the caller owns the exit); no payload
                             #   write, no push, no latch, no episode-marker write;
                             #   INSIDE typecheck + lint + lint-staged
login-linkedin.ts            # .ts, entry-guarded (imports runLoginHelper side-effect free); exports runLoginHelper /
                             #   findSessionCookies / writeCookieFile / keepOpenForArgv; HEADED persistent-profile
                             #   login assist (INTERACTIVE — the operator logs in by hand; no headless re-login);
                             #   writes the cookie file atomically + the .env line (upsertDotEnvLine imported
                             #   from src/env-file.ts since the Phase 9 hoist); the CLI then HOLDS
                             #   (keep-open default): Enter closes the browser, --auto-close restores
                             #   fire-and-close; INSIDE typecheck + lint + lint-staged
linkedin-chain.ts            # .ts, entry-guarded (imports the three legs side-effect free); exports
                             #   runLinkedInChain / ChainDeps / ChainResult; ONE command: login hold ->
                             #   runProbe -> exactly one fetchTick; the merged env resolves ONCE (D2) and
                             #   the login's harvested cookiePath joins it for stages 2-3 when the env
                             #   lacks LINKEDIN_COOKIES_FILE; a quiet-zero tick is a reported no-op, exit 0
                             #   (defb8af); INTERACTIVE (the login hold reads Enter);
                             #   INSIDE typecheck + lint + lint-staged
hooks/gate-destructive.js    # plain .js for bare node (instant start, no tsx); INSIDE lint ONLY — lint-staged's
hooks/format-on-edit.js      #   *.ts glob never matches .js; hooks are covered by npm run lint + their own tests
```

## Probe: refused ≠ failed; the ramp reads the ceiling
```typescript
type ProbeOutcome = { kind: "ok" } | { kind: "refused"; status: number } | { kind: "failed"; message: string };
// refused (HTTP 429 etc.) is a concurrency SIGNAL; failed (network error, 2xx without JSON) is a BROKEN endpoint.
// ALL ACCOUNTS run concurrently — wall time is the slowest account, not the sum; ramp LEVELS stay sequential
// within one account (each level's verdict gates the next), and `timed()` converts throws to {kind:"failed"},
// so a level's parallel bulk calls ride Promise.all.
const settled = await Promise.allSettled(accounts.map((a, i) => probeAccount(i, a)));  // pool-order collector:
for (const [i, account] of accounts.entries()) {                                       //   settled[index] matches
  /* per account — every line carries the label `account ${i + 1} (<baseUrl>)`; ramp lines read `${label} ramp L${level}` */
  /* rampLevel: `level` parallel bulk calls — the exact production prompt (buildBulkMessages), REAL captured captions */
  if (result.failed > 0) return 0;            // broken endpoint → ceiling 0 → probe exits 1
  if (result.ok < level) return level / 2;    // ceiling = last fully-clean level — no floor, no Math.max
}
return RAMP_MAX;                             // only a fully clean 2→32 ramp reads 32
// per account, after the ramp: the file key is the trimmed baseUrl (resolveCeilings trims both sides)
ceilings[account.baseUrl.trim()] = ceiling;
// Freshness clock: bytes change even when ceilings are identical, so the Commit ceilings no-op guard
// cannot strand the gate on a stale window. The COMMIT only lands on a green gate (the step is skipped
// on failure), so a red probe never starts a window.
ceilings.probedAt = Math.floor(Date.now() / 1000);
await writeCeilingsAtomic(ceilings, JUDGE_CEILINGS_PATH);   // live-only, whole file (no merge, no staleness)
if (dead.length > 0) process.exit(1);         // a red gate skips the Commit ceilings step
```

## Exit-code contracts are the interface
```
commit-state-rebase.sh      exit 0 = pushed; exit 1 = a conflict outside the committed state set
                            (state/seen-posts.json, state/judge-ceilings.json, state/judge-health.json) or a second push
                            failure — ALL THREE invokers' step shells consume it with no wrapper; the rebase target is
                            the checkout branch's own remote head
probe-judge.ts              exit 1 on any failed leg, auth-dead 401/403, or ceiling < 1 — the probe job is a gate, so this reddens the dispatch run; the ceilings write (+ the probedAt stamp) happens BEFORE the gate, so even a red run recorded its readings
fetch-linkedin.ts           exit 1 on a mis-homed checkout (branch ≠ main or dirty tree — guardCheckout, BEFORE
                            any fetch), on leg-dead (after the ONE episode alarm), or a failed push — the one-off entry;
                            an all-faulted walk is a tagged no-op exit 0 (payload untouched, alarm-free)
watch entries               watch-linkedin.ts never exits on leg-dead; probe-linkedin.ts exits 1 on a checkpoint
                            wall (probe: HALT), a dead session (probe: LEG DEAD), a faulted walk (probe: FAILED),
                            or fewer than 10 posts (gate)
linkedin-chain.ts           exit 0 when all three stages ran — a quiet-zero tick (working-hours window, halt
                            latch, halt trip, all-faulted walk, zero surfaces) is a REPORTED NO-OP, still
                            exit 0 (defb8af); exit 1 when any stage throws — the wrapper prints
                            `linkedin-chain: FAILED — <gate>`; INTERACTIVE (real TTY for the login hold)
login-linkedin.ts           exit 1 on timeout (no session within the budget) or a failed poll/context — one alarm-free operator gate; keep-open DEFAULT at the CLI — Enter closes the browser (--auto-close = fire-and-close)
gate-destructive.js         exit 2 = DENY the tool call (reason on stderr); unreadable stdin → exit 0 (fail-open, never block)
format-on-edit.js           ALWAYS exit 0 — post-edit feedback only, can never veto an edit
```

## Hooks: one stdin JSON event, registered in .claude/settings.json
```javascript
// scripts/hooks/gate-destructive.js — PreToolUse, matcher "Bash"
const event = JSON.parse(readFileSync(0, "utf8"));   // try/catch: parse failure → exit 0 (fail-open)
const command = String(event?.tool_input?.command ?? "");
for (const [pattern, why] of RULES) {         // [regex, reason] pairs — includes state/seen-posts.json truncation
  if (pattern.test(command)) { console.error(`Blocked by gate-destructive hook: ${why}. Ask the user before running this.`); process.exit(2); }
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
2. Run: Actions → watch → Run workflow (dispatch runs the probe job; check `force` to re-probe inside the 8-hour window), or locally `npx tsx scripts/probe-judge.ts` from the repo root (it loads `watcher.config.json` at startup)
3. It measures per account: a minimal call, a 10-post bulk call twice (variance; production `buildBulkMessages` + real keywords + reasoningEffort), then the doubling ramp 2→32 (~6–62 calls, stopping at the first refused level) — all accounts are probed concurrently, so wall time is the slowest account, and every ramp line carries the account label
4. Read each account's summary line `probe: account N (<baseUrl>) — minimal=… bulk=… bulkAgain=… ceiling=N` — no floor; a failed, auth-dead (401/403), or broken-ramp (ceiling 0) account exits 1; 429-refused legs are busy, not dead
5. Apply: nothing to paste — the probe writes `state/judge-ceilings.json` (whole file + `probedAt`, before the gate) and the Commit ceilings step pushes it; a missing entry floors that account at ceiling 1 with one warning
6. Semantics downstream: `resolveCeilings` trims both sides when matching keys; a red-gate probe skips the commit, so the file keeps the last green reading; the file never fails a run
</important if>

<important if="you are adding a new PC-local script">
## Adding a PC-local Script
1. Create `scripts/<name>.ts` (TS ESM, imports `../src/*.js`) — it lands inside typecheck automatically (`tsconfig.json` includes src, tests, scripts)
2. Export the logic, not a side effect: a deps object (`FetchTickDeps` / `LoginHelperDeps` shapes) lets tests inject fakes; default deps resolve lazily (`deps.env ?? envWithDotEnv()`)
3. Entry guard at the bottom: `if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)` — importing the module must open no browser and spawn no git
4. Env = merged `.env`: `envWithDotEnv()` fills only unset keys, the shell wins (`fetchTick({ env: envWithDotEnv() })`)
5. Exit contract up front: a catch-all wrapper prints `FAILED — <message>` and `process.exit(1)`; domain gates (leg-dead, halt, timeout) throw and the wrapper owns the exit
6. Alarm policy = best-effort, never masks the exit code (`handleLegDeadEpisode` try/catches the mailer and warns); one alarm per episode via a repo-local marker beside the payload, not OS temp
7. Atomic writes: temp + rename via `stateTempPath`; every failure message names the remedy/escape hatch
8. Wire it: add `"name": "tsx scripts/<name>.ts"` to package.json AND append the file to the explicit `lint` (and `format`) script lists — scripts are enumerated, not globbed; add a black-box `tests/<name>.test.ts` (see `.rpiv/guidance/tests/architecture.md`, "Adding a Test for a scripts/ CLI Entry Point")
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
