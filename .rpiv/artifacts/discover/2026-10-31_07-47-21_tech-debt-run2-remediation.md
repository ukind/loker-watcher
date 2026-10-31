---
date: 2026-10-31T07:47:21+0700
author: Yogiswara Utama
commit: b92fa9f
branch: main
repository: loker-watcher
topic: "Tech-debt run #2 remediation (N001-N004; N005 deferred)"
tags: [intent, frd, tech-debt, hooks, docs-guidance, judge]
status: ready
last_updated: 2026-10-31T07:47:21+0700
last_updated_by: Yogiswara Utama
---

# FRD: Tech-debt run #2 remediation (N001-N004; N005 deferred)

## Summary
Continue the tracked remediation pattern from the 2026-10-29 round, now against audit run #2 (TECH_DEBT_AUDIT.md, generated 2026-10-31 at b92fa9f). One small round fixes the four open findings N001-N004: a charset guard on the format-on-edit hook's shell spawn, a docs pass that makes guidance and README describe the probe that actually ships, four dead exports unexported, and the superseded 10-29 design artifact marked so its landed Slice 11 is not resumed. N005 (the judge.ts split) is explicitly deferred.

## Problem & Intent
Developer framing, verbatim: "Continue the old run" — "same as before: one tracked remediation with locked slices, this time against N001-N005 of run #2."

The motivation is the 10-29 round's pattern repeated: the audit cycle should land at zero open debt through one tracked remediation ledger, not ad-hoc fixes. The probe then sharpened the set: the old design's next pending slice (Slice 11 = F020+F021) already landed on disk (watch.yml:73 cache, :113-119 rebase+retry, commit 510ff2a), so this round is a fresh FRD against the N-numbered findings, with the old artifact closed out rather than extended.

## Goals
- Clear N001-N004 from the audit's open ledger (only the deferred N005 remains open).
- Guidance and README describe the real probe contract: one "ceiling=N" summary line per account, every-account walk, exit 1 on any failed or auth-dead leg — the F024 class ("operator waits for a line that never prints") must not recur.
- format-on-edit.js no longer passes unsanitized paths into a shell:true spawn; hostile paths are rejected with a visible warn and a pinned stdin test.
- The 10-29 design artifact carries a superseded status with a pointer here.

## Non-Goals
- N005: no judge.ts split, no judge-dispatch.ts this round — the audit itself marks it optional, "not worth a dedicated PR".
- No behavior change to the judge, the funnel, or any pipeline stage.
- No knip config, no new dependencies, no new tooling.
- No .rpiv/artifacts pruning policy (audit open question 1 stays open).

## Functional Requirements
1. **N002 — charset guard**: scripts/hooks/format-on-edit.js SHALL reject any tool_input.file_path failing `^[A-Za-z0-9 _.()/\\:+-]+$` (checked after the existing extension + existsSync gate), print a one-line warn naming the rejection, and exit 0 without spawning. `shell: true` stays — npx is npx.cmd on Windows and Node cannot spawn .cmd without a shell.
2. **N002 — test**: new tests/format-on-edit.test.ts, following the spawnSync stdin idiom of tests/gate-destructive.test.ts: a "x&calc.ts" path exits 0 and spawns nothing; a normal .ts path still formats.
3. **N001 — guidance/scripts truth**: .rpiv/guidance/scripts/architecture.md — delete the phantom `probe: recommended JUDGE_CONCURRENCY = N (floored)` fragments (:27 area, :58, :61) and the "(only account 0 is measured)" claim; document the real contract (per-account "ceiling=N", every-account walk, exit 1 on failed/auth-dead legs, no floor at 4 — findConcurrencyCeiling returns 4 only on a fully clean ramp, level/2 otherwise). Update the hook-pattern fragment at :47 to include the charset guard.
4. **N001 rider — README**: README.md (~:67-69) — "prints a recommended width" becomes per-account ceilings wording.
5. **N003 — four missed fragments, one docs pass**: guidance/src:10 (probe imports buildBulkMessages/resolveJudgeConfig, not parsers); guidance/src WatcherDeps fence gains sleepFn (live at index.ts:116); root guidance commands table (format = `biome format --write src tests`, not repo-wide; lint path includes scripts/hooks — package.json truth); judge.ts:190 comment "parseLlmAccounts below" corrected to above (:132).
6. **N004 — unexport four symbols**: drop the export keyword (keep the symbols) on chromiumContextFactory (fetch-threads.ts:125), MAX_CANDIDATES (heartbeat.ts:21), ROTATION_EXHAUSTED (judge-rotation.ts:51), createInitialState (state.ts:38).
7. **Supersede the old design**: flip .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md status to superseded, with a one-line pointer to this FRD.

## Non-Functional Requirements
- **Performance**: no specific constraint (hook guard, docs, export keywords only).
- **Security**: the charset guard closes the shell-metacharacter execution path on the dev machine; the hook stays fail-open — parse failure or any guard failure exits 0, never blocks an edit.
- **UX (operator)**: probe runbook steps must match actual probe output exactly; no phantom lines.
- **Reliability**: the hook's always-exit-0 contract is unchanged; biome formatting remains best-effort.

## Constraints & Assumptions
- Node >= 22, ESM, strict TS flags stay on; hooks are plain .js run by bare node; lint covers scripts/hooks.
- `shell: true` in the hook is load-bearing on Windows; the guard, not shell removal, is the fix.
- Tests stay offline (spawnSync stdin pins, no network).
- No new runtime dependency (repo doctrine).
- Assumption (verified this session): the four exports have zero real importers — the sole outside reference is a JSDoc comment (index.ts:105).
- Assumption (verified this session): audit run #2's citations hold at HEAD b92fa9f for all five findings.

## Acceptance Criteria
- [ ] `echo '{"tool_input":{"file_path":"x&calc.ts"}}' | node scripts/hooks/format-on-edit.js` exits 0, prints a warn naming the rejection, and spawns nothing.
- [ ] `npm test` includes tests/format-on-edit.test.ts pinning the hostile-path exit and a normal-path format; the suite exits 0.
- [ ] .rpiv/guidance/scripts/architecture.md no longer contains the phantom "recommended JUDGE_CONCURRENCY" line or the "only account 0" claim; it states per-account "ceiling=N", the every-account walk, and exit 1 on dead legs; the :47 hook pattern includes the charset guard.
- [ ] README.md no longer says the probe "prints a recommended width"; it says per-account ceilings.
- [ ] guidance/src WatcherDeps fence lists sleepFn; its consumer line names buildBulkMessages/resolveJudgeConfig as the probe's imports; the root guidance commands table shows `lint: biome check src tests scripts/probe-judge.ts scripts/hooks` and `format: biome format --write src tests`; the judge.ts comment near :190 says "above".
- [ ] `grep -rnE "export (const|function|async function) (chromiumContextFactory|MAX_CANDIDATES|ROTATION_EXHAUSTED|createInitialState)" src/` returns nothing; `npm run typecheck && npm test` exit 0.
- [ ] The 10-29 design artifact's frontmatter carries superseded status + pointer to this FRD.
- [ ] Gates: `npm run typecheck && npm run lint && npm test` all exit 0.

## Recommended Approach
One small remediation PR in three touches: (1) the hook charset guard plus tests/format-on-edit.test.ts; (2) a docs pass over guidance/scripts, guidance/src, the root guidance commands table, README, and the judge.ts:190 comment; (3) unexport the four symbols and flip the 10-29 design artifact to superseded. No new modules, no behavior change outside the hook.

## Decisions

### Fix set: N001-N004 now, N005 deferred
**Question**: From the probe I inferred the fix set is N001-N004 now, with N005 (judge.ts split) deferred — the audit's own Top-5 list says N005 is not worth a dedicated PR. Keep that, or change it?
**Recommended**: N001-N004 now, defer N005
**Chosen**: N001-N004 now, defer N005
**Rationale**: audit marks N005 optional ("only when judge.ts is next touched"); TECH_DEBT_AUDIT.md N005 row + Top-5 item 5.

### N002 shape: charset guard (shell:true stays)
**Question**: N002: the hook passes file_path into a shell:true spawn (format-on-edit.js:19). Note: shell:true is load-bearing on Windows (npx is npx.cmd there). Which shape?
**Recommended**: Charset guard + hostile-path stdin test
**Chosen**: Charset guard
**Rationale**: kills the metacharacter injection class while Windows keeps working; shell removal would break the dev machine the hook runs on. Evidence: scripts/hooks/format-on-edit.js:19 + audit N002.

### Skip notice: warn + skip
**Question**: When a file path fails the charset check, should the hook say why before skipping format?
**Recommended**: Warn + skip
**Chosen**: Warn + skip
**Rationale**: matches the hook's existing style (it already prints "could not run Biome"); still exits 0, never blocks.

### N004 shape: drop the 4 export keywords
**Question**: chromiumContextFactory, MAX_CANDIDATES, ROTATION_EXHAUSTED, createInitialState are exported but only used inside their own modules. Unexport, or declare them intentional in a knip config?
**Recommended**: Drop 4 exports
**Chosen**: Drop 4 exports
**Rationale**: evidence — usage sweep shows zero real importers (sole outside ref is the JSDoc comment at src/index.ts:105); no new tooling config for four constants.

### Continuity: fresh FRD; old design superseded
**Question**: The 10-29 remediation design's next pending slice (Slice 11 = F020+F021) landed on disk already (watch.yml:73, :113-119, commit 510ff2a). How do we track this round?
**Recommended**: Fresh FRD; old design marked superseded
**Chosen**: Fresh FRD
**Rationale**: the old F-numbered slice ledger no longer matches the live N-numbered audit; verified landed evidence: .github/workflows/watch.yml:73,113-119.

### Supersede handling: flip the old design status inside this round
**Question**: The 10-29 design artifact still says its next slice is Slice 11, which already landed. Handle it inside this round, or leave it?
**Recommended**: Mark superseded
**Chosen**: Mark superseded
**Rationale**: prevents anyone resuming a stale slice; one-line frontmatter edit.

## Open Questions
- N005: move dispatchLlmCall and the wrapper warn wiring into judge-dispatch.ts when judge.ts is next touched for real work (audit N005 recommendation; deliberately deferred this round).

## Suggested Follow-ups
- .rpiv/artifacts/ pruning policy — 60+ tracked pipeline documents (TECH_DEBT_AUDIT.md open question 1).
- reasoning_effort verification across every pool endpoint via one probe dispatch (TECH_DEBT_AUDIT.md open question 2).
- Probe ramp + dead-account classification tests, scripts/probe-judge.ts:139-177 (TECH_DEBT_AUDIT.md open question 3).
- watch.yml:112 negative state delta wording ("pruned" vs "-69 new") (TECH_DEBT_AUDIT.md open question 4).

## References
- TECH_DEBT_AUDIT.md — audit run #2 input (2026-10-31, HEAD b92fa9f)
- .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md — prior round's design (to be marked superseded)
- scripts/hooks/format-on-edit.js — N002 site
- tests/gate-destructive.test.ts — stdin-test idiom for the new hook test
- .rpiv/guidance/scripts/architecture.md — N001 site
- .rpiv/guidance/src/architecture.md, README.md, src/judge.ts, package.json — N003 sites
- src/fetch-threads.ts, src/heartbeat.ts, src/judge-rotation.ts, src/state.ts — N004 sites
- .github/workflows/watch.yml — Slice 11 landed-evidence site
