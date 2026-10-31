# scripts/ — dev tooling: endpoint probe + agent hooks

## Responsibility
Three files, deliberately separate from src/ (the production watcher): `probe-judge.ts` measures the LLM endpoint's latency and concurrency ceiling from an Actions runner; `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/; `gate-destructive.js` is covered by `tests/gate-destructive.test.ts`.

## Invokers
- **probe-judge.ts**: the dispatch-only `probe` GATE job in watch.yml, or locally `npx tsx scripts/probe-judge.ts` (needs `LLM_ACCOUNTS`; loads `watcher.config.json` at startup, so run from the repo root)
- **hooks/**: `.claude/settings.json` only — PreToolUse matcher `Bash` → gate, PostToolUse matcher `Edit|Write` → formatter. NOT husky: husky runs only `lint-staged`

## Structure
```
probe-judge.ts               # .ts, top-level await; imports buildBulkMessages + resolveJudgeConfig; INSIDE typecheck + lint + lint-staged
hooks/gate-destructive.js    # plain .js for bare node (instant start, no tsx); INSIDE lint; black-box tested
hooks/format-on-edit.js      # plain .js; shells out to `npx biome format --write <file>`; never blocks
```

## Probe: refused ≠ failed; the ramp reads the ceiling
```typescript
type ProbeOutcome = { kind: "ok" } | { kind: "refused"; status: number } | { kind: "failed"; message: string };
// refused (HTTP 429 etc.) is a concurrency SIGNAL; failed (network error, 2xx without JSON) is a BROKEN endpoint.
for (const level of [2, 4]) {                 // never fires a level the previous one ruled out
  /* rampLevel: `level` parallel bulk calls — the exact production prompt (buildBulkMessages), REAL captured captions,
     real keywords from watcher.config.json (synthetic text once under-measured latency by 5.2x) */
  if (result.failed > 0) return 0;            // broken endpoint → probe exits 1
  if (result.ok < level) return level / 2;    // ceiling = last fully-clean level
}
return 4;                                   // only a fully clean 2→4 ramp reads 4 — no floor, no Math.max
```

## Exit-code contracts are the interface
```
probe-judge.ts              exit 1 on any failed leg, auth-dead 401/403, or ceiling < 1 — the probe job is a gate, so this reddens the dispatch run
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
// format-on-edit.js (PostToolUse, "Edit|Write"): extension + existsSync gate, then a
// charset-allowlist gate (^[A-Za-z0-9 _.()/\\:+-]+$ — hostile path → one-line warn, exit 0, no spawn), then
// spawnSync("npx", ["biome", "format", "--write", file], { stdio: "ignore", shell: true }) → always exit 0.
```

**Caveats:**
- The probe walks EVERY `LLM_ACCOUNTS` entry — a rotten key in the pool fails the gating probe job loudly
- Weak success check: a 2xx body counts as ok if it merely `includes("{")` — no verdict parsing
- Gate regexes are a seatbelt, not a sandbox: `git push -f` evades, `--force-with-lease` is caught, `tee` evades the state-file rule
- Editing the probe faces typecheck + lint + lint-staged; editing a hook faces biome lint and, for the gate, the exit-code pins in tests/gate-destructive.test.ts

<important if="you are running the judge probe or changing judge concurrency">
## Running the Judge Probe and Applying the Reading
1. Env: `LLM_ACCOUNTS` = JSON array of `{baseUrl, apiKey, model}` (every account is walked; each must pass)
2. Run: Actions → watch → Run workflow (dispatch runs the probe job), or locally `npx tsx scripts/probe-judge.ts` from the repo root
3. It measures: minimal call, a 10-post bulk call twice (variance), then the 2→4 ramp
4. Read each account's summary line `probe: account N (<baseUrl>) — minimal=… bulk=… bulkAgain=… ceiling=N` — no floor; a failed, auth-dead (401/403), or broken-ramp account exits 1
5. Apply: paste N into the quoted `JUDGE_CONCURRENCY` literal in watch.yml, updating its `probe run <id>` evidence comment
6. Semantics downstream: `parseJudgeConcurrency` — absent/blank → 4, present-but-invalid → throws (fail-visible)
</important if>

<important if="you are adding a hook script">
## Adding a Hook Script
1. Create `scripts/hooks/<name>.js` — plain .js run by bare `node`; import `readFileSync` from `node:fs`
2. Read ONE JSON event on stdin (`JSON.parse(readFileSync(0, "utf8"))`); on parse failure exit 0 — fail-open, never block
3. Pull the field defensively: `String(event?.tool_input?.<field> ?? "")` — `command` for Bash events, `file_path` for Edit/Write
4. Decide the exit-code contract up front: gating (PreToolUse) → exit 2 denies, 0 allows; feedback (PostToolUse) → always 0
5. Register in `.claude/settings.json` under the right event with a matcher regex and `"command": "node scripts/hooks/<name>.js"`
6. Sanity-test by piping a fake event: `echo '{"tool_input":{"command":"rm -rf /"}}' | node scripts/hooks/<name>.js`
</important if>
