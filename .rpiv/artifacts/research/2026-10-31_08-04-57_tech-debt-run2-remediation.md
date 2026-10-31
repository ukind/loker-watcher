---
date: 2026-10-31T08:04:57+0700
author: Yogiswara Utama
commit: b92fa9f
branch: main
repository: loker-watcher
topic: "Tech-debt run #2 remediation (N001-N004; N005 deferred)"
tags: [research, codebase, hooks, docs-guidance, probe, dead-exports, artifact-lifecycle]
status: ready
last_updated: 2026-10-31T09:25:06+07:00
last_updated_by: Yogiswara Utama
last_updated_note: "Added follow-up research for the review round: happy-path pin empirically verified (biome rewrites OS-temp files; 3/3 draft pins pass), FRD echo AC demoted to design constraint, AGENTS.md swept clean, guidance/scripts:54 folded into the docs pass, superseded-banner recommendation recorded"
---

# Research: Tech-debt run #2 remediation (N001-N004; N005 deferred)

## Research Question
Ground the four open findings of audit run #2 (TECH_DEBT_AUDIT.md, generated 2026-10-31 at b92fa9f) for a one-PR remediation: (1) the charset guard on the format-on-edit hook's shell:true spawn plus its black-box stdin test; (2) the docs pass that makes guidance and README describe the probe that actually ships (per-account "ceiling=N", every-account walk, exit 1 on dead legs); (3) four missed docs fragments (probe-imports claim, missing sleepFn, wrong lint/format rows, above/below comment); (4) unexporting four dead symbols; plus flipping the superseded 10-29 design artifact. Chained from the discover FRD.

## Summary
All five surfaces of the round are confirmed at HEAD b92fa9f, and every audit citation holds. The hook guard inserts at scripts/hooks/format-on-edit.js:17 (between the extension+existsSync gate :16 and the shell:true spawn :18-21); shell:true is load-bearing (npx is npx.cmd on Windows, Node EINVAL on .cmd without a shell). One load-bearing test finding: existsSync at :16 is cwd-relative, so the FRD's bare "x&calc.ts" echo pin exits silently at the gate — both the hostile test AND the FRD's acceptance echo need the hostile file to actually exist (temp-dir absolute path, every char inside the allowlist except the &). The real probe contract (findConcurrencyCeiling probe-judge.ts:139-155 — no Math.max floor anywhere, bare return 4 only on a fully clean ramp; classifyDead :164-177 with three dead causes; per-account summary line :232-235; exit 1 :242) contradicts four phantom "recommended JUDGE_CONCURRENCY" surfaces, of which the root guidance probe row :33 is now in scope per checkpoint decision. All four dead exports have zero importers repo-wide; the typeof ROTATION_EXHAUSTED type-level use survives unexport; the index.ts:105 JSDoc stays accurate. The supersede flip establishes a new repo convention (57 artifacts, all status: ready, none ever flipped): status flip at designs:9 + pointer folded into the last_updated triple :11-13. Gates are exactly three (ci.yml:26-33); watch.yml runs none; the hook .js is invisible to tsc (no allowJs) — lint + black-box test are its only gates.

## Detailed Findings

### N002 — the hook and its guard (scripts/hooks/format-on-edit.js)
- The hook is 23 lines, always-exit-0, registered PostToolUse "Edit|Write" in .claude/settings.json:13-21. Gate chain: stdin parse fail-open :8-13 → field pull :15 → extension+existsSync :16 → spawnSync("npx", ["biome","format","--write",file], {stdio:"ignore", shell:true}) :18-21 → spawn-fail warn :22 → process.exit(0) :23.
- Guard insertion point is the blank line at :17 — after the gate, before the spawn. Placement is what makes "stderr warn ⇒ biome never ran" a valid inference.
- shell:true stays: Node >= 22 refuses to spawn .bat/.cmd without a shell (EINVAL, CVE-2024-27980 hardening); npx is npx.cmd on Windows. Input validation is the fix, not shell removal.
- The N002 mechanics verify: "&" is a legal NTFS filename char, so x&calc.ts passes existsSync; with shell:true Node joins args into one string and cmd.exe tokenizes the unquoted & as a separator (precision note: cmd resolves "calc.ts" only if .TS is on PATHEXT by default — the injection class is proven regardless, e.g. x&calc.exe).
- The FRD charset ^[A-Za-z0-9 _.()/\\:+-]+$ is valid JS as written (unescaped / inside a class is legal; trailing - is literal). It admits full Windows absolute paths (drive colon, backslashes, spaces, parens) and excludes every shell-active char (& | ; < > ^ % ! " ' \` $ ~ newline).
- Warn wording should mirror the file's existing "format-on-edit: " prefix (the :22 style). biome.json sets lineWidth 100, so guard+warn needs wrapping to stay lint-clean.
- No other spawn/shell-adjacent site exists in scripts/hooks/ — gate-destructive.js:23 extracts only tool_input.command; the formatter is the single shell surface.
- CRITICAL test-design fact: existsSync at :16 is cwd-relative. A hostile event {"file_path":"x&calc.ts"} with no such file at repo root exits silently at :16 — before the guard. A bare-hostile pin passes vacuously pre-fix, and a stderr-warn assertion fails post-fix. The hostile test must create the file (suite idiom: mkdtemp + tmpdir + one after() cleanup, tests/state.test.ts:22-27, lw- prefix) and pass the absolute path — every char inside the allowlist except the &. The FRD acceptance echo (discover FRD AC 1) has the same precondition: it only prints the warn when a file named x&calc.ts exists in the hook's cwd.
- The happy-path pin must assert on file content mutation, not stderr (stdio:"ignore" makes biome output invisible) and not mtime (coarse timestamps). spawnSync is synchronous, so reading the file after runGate returns is safe. Seed content biome deterministically rewrites (biome.json: double quotes, semicolons, 2-space indent).
- tests/format-on-edit.test.ts is net-new (no hook test exists today); the tsx --test tests/*.test.ts glob auto-discovers it with zero config. tsconfig has no allowJs, so the hook .js itself is gated only by biome lint + this black-box test.

### N001 — the real probe contract vs guidance/scripts (scripts/probe-judge.ts, .rpiv/guidance/scripts/architecture.md)
- Real contract: findConcurrencyCeiling ramps [2,4] (:140); return 0 on any failed ramp call (:145-147), return level/2 on refused/partial (:148-151 — refused level 2 yields ceiling 1), bare return 4 only on a fully clean ramp (:154). There is no Math.max anywhere in the 255-line script.
- classifyDead (:164-177) walks three legs [minimal, bulk, bulkAgain] (:166); dead on: failed leg (:167-168), 401/403 auth-dead (:169-171), ceiling < 1 (:172-175). Ramp failures are caught exclusively by the ceiling<1 clause.
- main() walks EVERY LLM_ACCOUNTS entry (:190), prints one per-account line "probe: account N (<baseUrl>) — minimal=... bulk=... bulkAgain=... ceiling=..." (:232-235), lists DEAD accounts (:238-241), and process.exit(1) (:242); all-clear line :244.
- Fragments to delete/rewrite in .rpiv/guidance/scripts/architecture.md: the pseudocode print with Math.max floor (:27); the runbook "(only account 0 is measured)" (:58 — contradicts the file's own caveat :51); the "Read the line ... floored at 4" step (:61). Step :60 and the paste step :62 survive.
- Hook-pattern fragment :46-47: fold the charset gate into the :46 enumeration line ("extension + existsSync + charset gate ... warn + skip, then") — keeps the fence at two lines; do not append to :47 (it would misattach the guard to the spawn). Line :34 "ALWAYS exit 0" and the :14 structure fence stay true post-guard.
- Exit-contract row :32 needs all three dead causes per checkpoint decision: "failed leg, auth-dead (401/403), or ceiling < 1" — the current row's two clauses miss the 401/403 branch (a refused ramp floors at ceiling 1, and refused ≠ failed).
- Caveat :54 ("gate faces the exit-code pins in tests/gate-destructive.test.ts") is adjacent and will be stale once format-on-edit has its own pins — not mandated, note for the design.

### N003 — the four missed fragments (guidance/src, root guidance, README, judge.ts)
- .rpiv/guidance/src/architecture.md:10 says the probe "imports its parsers"; truth (probe-judge.ts:25) is { type LlmAccount, buildBulkMessages, resolveJudgeConfig } from "../src/judge.js" — prompt building + pool resolution (the F006 anti-drift fix). The verdict parsers (parseBulkVerdicts/parseVerdict) live in judge-parse.js and are imported only by src/judge.ts:35; the probe never parses verdicts (weak check body.includes("{"), probe-judge.ts:100).
- The WatcherDeps fence .rpiv/guidance/src/architecture.md:43-53 omits sleepFn; live field at src/index.ts:115-116 ("Park wait for the judge's cooldown parking. Default: the judge module's sleep."), wired at index.ts:141 and passed to judgePosts at :215; production default is the exported sleep (src/judge.ts:109-110). Insert one row after fence line :51 in the fence's trailing-comment style.
- Root .rpiv/guidance/architecture.md commands table: :29 lint row must become "biome check src tests scripts/probe-judge.ts scripts/hooks" and :30 format row "biome format --write src tests" (src+tests only, NOT repo-wide) per package.json:11-12. The :28 typecheck row is accurate in effect.
- Root probe row :33 ("prints the recommended JUDGE_CONCURRENCY") is the same phantom family — checkpoint decision: rewrite it in this pass (in-scope by FRD Goal even though the table AC names only lint/format).
- README.md:67-69: "the dispatch-only probe job ramps concurrent calls against the endpoint and prints a recommended width" → per-account ceilings wording (one ceiling=N line per account, every-account walk, exit 1 on any failed or auth-dead leg). The ":70 Paste that reading" sentence survives once "that reading" is the per-account ceiling. README mentions hooks nowhere else (grep-confirmed).
- src/judge.ts:190 "(fail-visible - same rule as parseLlmAccounts below)" — parseLlmAccounts is at :132, above parseJudgeConcurrency (:192). Flip "below"→"above". Neighbors verified correct and untouched: :65 "below" refers to rotation mechanics genuinely below (dispatchLlmCall :383-403, judgePosts :645-649); :265 "below" is pinned PROMPT TEXT (six test sites — do not touch); resolveJudgeConfig doc :205-209 accurate.
- No test pins any of these strings: zero hits in tests/ for "recommended width", "parseLlmAccounts below", "recommended JUDGE_CONCURRENCY", "floored"; no test reads README or .rpiv/guidance.

### N004 — the four dead exports (src/fetch-threads.ts, src/heartbeat.ts, src/judge-rotation.ts, src/state.ts)
- chromiumContextFactory (src/fetch-threads.ts:125): in-module defaults only at :198 and :278; index.ts:30 imports the walks, not the factory; the ContextFactory type at :117 stays exported. Zero importers repo-wide.
- MAX_CANDIDATES (src/heartbeat.ts:21): used at :66 as selectCandidates' default. Zero importers.
- ROTATION_EXHAUSTED (src/judge-rotation.ts:51): three in-module uses — typeof type operand :55, assignment :67, guard comparison :74. The sibling functions (rotationExhausted, isRotationExhausted) ARE imported (judge.ts:37-44, index.ts:32, tests/index.test.ts:26) but never the constant. typeof on a module-local value resolves fine unexported; noEmit removes any declaration-emit concern.
- createInitialState (src/state.ts:38): used at :155 as loadState's ENOENT fallback. Zero importers.
- The acceptance grep form matches exactly the four definition lines today and returns empty post-edit; no brace re-exports exist in src/ ("export {" zero matches).
- src/index.ts:105 JSDoc "Default: chromiumContextFactory." stays accurate — prose naming a default value, not an import. Guidance prose at .rpiv/guidance/src/architecture.md:7,47 same.
- The judge.ts <-> judge-rotation.ts type-only cycle (judge-rotation.ts:16-17 import type, documented :14-15) is unperturbed — the constant never crosses the boundary.
- Also grep JSDoc references, not just imports (precedent lesson): the only outside mention of the four names is prose (index.ts:105, guidance, artifacts) — all stay-true or already-tracked.

### Supersede flip (.rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md)
- Frontmatter: status: ready at :9; the last_updated triple :11-13 is the artifact's only established post-creation mutation idiom (Slice 15 note). Checkpoint decision: flip status to superseded at :9 and fold the FRD pointer + fresh timestamp into last_updated_note; no new key (zero precedent), body Summary :19 untouched (no AC names it; the flip prevents the stale-slice resumer).
- No template exists: all 57 status: lines under .rpiv/artifacts/ are ready (grepped); this flip establishes the convention. The only pointer-style key in the family is parent: (:10) — creation-time lineage, different semantic.
- Landed evidence verified on disk: Slice 11 checks at designs:3455-3458; F020 shipped as watch.yml:66-76 (actions/cache@v4 at :73, ms-playwright path :75, lockfile key :76); F021 as watch.yml:96-123 (first rebase :113, push guard :114-116, retry echo :117, second rebase :118, second push :119-121, terminal exit 1 :123 — the file's only exit 1). Commit 510ff2a per the audit ledger.

### Gate surface (package.json, ci.yml, watch.yml)
- Three gates only: test tsx --test tests/*.test.ts (package.json:9), typecheck tsc --noEmit (tsconfig includes src+tests+scripts, strict family on), lint biome check src tests scripts/probe-judge.ts scripts/hooks (package.json:11). ci.yml:26-33 runs exactly these three; watch.yml runs none. No knip config anywhere (no file, no package.json key).
- lint-staged covers *.ts only (package.json:15-18) — the hook .js faces only the npm lint gate.
- Baseline: 33 files Biome-clean, 195/195 tests (TECH_DEBT_AUDIT.md tooling note). The new suite lands on a green floor.
- FRD acceptance greps verified executable as written, with one caveat: the charset-echo AC has the file-exists precondition flagged above; the durable pinned form is the spawnSync stdin test.

## Code References
- scripts/hooks/format-on-edit.js:8-23 — full gate chain; guard inserts at :17; spawn :18-21 (shell:true, stdio:"ignore"); warn :22; unconditional exit :23
- scripts/hooks/format-on-edit.js:16 — extension+existsSync gate (cwd-relative existsSync — the hostile-test precondition)
- scripts/hooks/gate-destructive.js:23-29 — sibling hook; extracts only tool_input.command; no file_path gate repo-side
- tests/gate-destructive.test.ts:8-13 — the idiom to copy: fileURLToPath target + runGate via spawnSync(process.execPath, [GATE], {input, encoding:"utf8"})
- tests/gate-destructive.test.ts:44-52 — fail-open pin ("not json" → 0) + distinct allow-path case
- tests/state.test.ts:22-27 — mkdtemp + single after() cleanup idiom (lw- prefix) for the new test's temp file
- scripts/probe-judge.ts:25 — real probe imports: type LlmAccount, buildBulkMessages, resolveJudgeConfig from ../src/judge.js
- scripts/probe-judge.ts:139-155 — findConcurrencyCeiling: ramp [2,4]; 0 / level/2 / bare 4; no Math.max floor
- scripts/probe-judge.ts:164-177 — classifyDead: failed leg :167-168, auth-dead 401/403 :169-171, ceiling<1 :172-175
- scripts/probe-judge.ts:190-235 — every-account walk :190; per-account summary line :232-235
- scripts/probe-judge.ts:236-243 — DEAD listing + process.exit(1) :242
- .rpiv/guidance/scripts/architecture.md:27 — phantom pseudocode print with Math.max floor (delete/rewrite)
- .rpiv/guidance/scripts/architecture.md:32 — exit row missing auth-dead (rewrite: three causes)
- .rpiv/guidance/scripts/architecture.md:46-47 — hook-pattern fence lines (fold charset gate into :46)
- .rpiv/guidance/scripts/architecture.md:51 — the file's own every-account caveat (contradicts :58)
- .rpiv/guidance/scripts/architecture.md:58,61 — "(only account 0 is measured)" + "Read the line ... floored at 4" (rewrite)
- .rpiv/guidance/src/architecture.md:10 — "imports its parsers" (rewrite: buildBulkMessages/resolveJudgeConfig)
- .rpiv/guidance/src/architecture.md:43-53 — WatcherDeps fence; insert sleepFn row after :51
- .rpiv/guidance/architecture.md:29-30 — lint/format rows (rewrite to package.json:11-12 truth)
- .rpiv/guidance/architecture.md:33 — probe row phantom wording (rewrite — checkpoint in scope)
- README.md:67-69 — "prints a recommended width" clause (rewrite: per-account ceilings)
- src/judge.ts:132 — parseLlmAccounts definition (above the :190 comment)
- src/judge.ts:190 — "(fail-visible - same rule as parseLlmAccounts below)" → "above"
- src/judge.ts:65,265 — directional "below" uses that stay: :65 correct referent; :265 pinned prompt text (six test sites)
- src/index.ts:99-121 — live WatcherDeps; sleepFn at :115-116; wired :141, :215
- src/index.ts:105 — JSDoc "Default: chromiumContextFactory." (stays accurate post-unexport)
- src/fetch-threads.ts:125 — export const chromiumContextFactory (unexport; defaults :198, :278; type stays exported :117)
- src/heartbeat.ts:21 — export const MAX_CANDIDATES = 10 (unexport; used :66)
- src/judge-rotation.ts:51 — export const ROTATION_EXHAUSTED (unexport; type use :55, assign :67, guard :74)
- src/state.ts:38 — export function createInitialState (unexport; ENOENT fallback :155)
- .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md:9,11-13 — status flip + last_updated triple pointer
- .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md:3455-3458 — Slice 11 checks (landed evidence)
- .github/workflows/watch.yml:73 — actions/cache@v4 (F020 landed, commit 510ff2a)
- .github/workflows/watch.yml:113-123 — rebase + one-retry push + terminal exit 1 (F021 landed)
- .github/workflows/ci.yml:26-33 — the only remote gate: typecheck, lint, test
- package.json:9-12 — gates; lint/format truth the root table must mirror
- .claude/settings.json:13-21 — PostToolUse "Edit|Write" → node scripts/hooks/format-on-edit.js (why knip is blind to it)

## Integration Points

### Inbound References
- .claude/settings.json:13-21 — registers format-on-edit as a PostToolUse hook; the only invoker (no imports anywhere)
- package.json:11 — the lint gate covers scripts/hooks; the hook .js has no other gate (tsc has no allowJs)
- .rpiv/guidance/scripts/architecture.md:46-47 — documents the hook's spawn pattern verbatim (docs-as-contract touchpoint)
- package.json:9 — the tests glob auto-discovers the net-new tests/format-on-edit.test.ts
- src/index.ts:30 — imports fetchSurfaces/fetchSurfacesAuthenticated, not chromiumContextFactory (unexport-safe)
- src/judge.ts:37-44, src/index.ts:32 — import rotationExhausted/isRotationExhausted, never the ROTATION_EXHAUSTED constant

### Outbound Dependencies
- scripts/hooks/format-on-edit.js:18-21 — spawns npx biome format --write (shell:true; npx is npx.cmd on Windows; biome resolved from node_modules/.bin at repo-root cwd)
- scripts/probe-judge.ts:25 — depends on src/judge.js buildBulkMessages (the production prompt, F006) and resolveJudgeConfig
- scripts/probe-judge.ts:182 — resolveJudgeConfig → parseLlmAccounts (src/judge.ts:132-181) loads the whole LLM_ACCOUNTS pool
- tests/format-on-edit.test.ts (new) — will depend on node:child_process spawnSync, node:test, node:url fileURLToPath, node:fs mkdtemp/tmpdir/rm

### Infrastructure Wiring
- .github/workflows/ci.yml:2-6,26-33 — push/PR/dispatch triggers; single check job = the three npm gates
- .github/workflows/watch.yml:66-76,96-123 — Playwright cache + state commit-back with rebase/retry (landed Slice 11 evidence)
- .husky/pre-commit — single line npx lint-staged, scoped to *.ts (hooks excluded)
- .claude/settings.json — both stdin hooks registered with matchers (knip's blind spot, audit "looks-fine")

## Architecture Insights
- Black-box always-exit-0 hooks make exit status noise: the contract lives in stderr content + filesystem state. The gate test already pairs status pins with stderr regexes for exactly this reason.
- stdio:"ignore" + spawnSync means the happy-path proof is deterministic file-content mutation; stderr silence proves nothing, and mtime is nondeterministic.
- The F024 class (operator waits for a line that never prints) recurs per documentation surface. The phantom family has four members — guidance/scripts:27, guidance/scripts:61, root guidance:33, README:69 — and the round kills all four in one pass (checkpoint decision extended the family to the root row).
- The probe's ceiling has no floor: 4 is a terminal value only on a fully clean 2→4 ramp; a refused level-2 yields ceiling 1; ceiling 0 means a broken endpoint. Auth-dead is a distinct dead cause from failed legs — docs that merge them under-specify classifyDead.
- Unexports are compile-safe including type-level typeof operands; with noEmit there is no declaration-emit surface. After unexporting, grep JSDoc references too, not just imports (precedent lesson).
- Artifact lifecycle has no downs tate convention yet — this flip creates it via the last_updated triple, the only mechanism any artifact has ever used post-creation.
- The hook .js is deliberately outside tsc (no allowJs): its correctness gates are biome lint + the black-box stdin test, so the test is not optional hardening — it is the only behavioral check the file has.

## Precedents & Lessons
4 similar past changes analyzed.

### Precedent: The partial docs-sync (F004 → N001/N003)
**Commit(s)**: b0b7dbe — "docs: update guidance and README for the cooldown-park judge" (2026-10-30); origin of drift 1a61bf9 — "feat: per-batch LLM account rotation with cooldown park and gating probe" (2026-10-28)
**Blast radius**: 7 files, docs layer (guidance/*5 areas, AGENTS.md, README.md)
**Follow-up fixes**: None — the missed fragments survived to be re-opened as N001 and N003 by audit run #2.
**Lessons from docs**:
- TECH_DEBT_AUDIT.md resolved ledger F004: "partial: b0b7dbe fixed ramp + gating — Stale fragments survived -> re-opened as N001"
- Run-1 design: "docs sync twice — theme 1 and again after the refactor (the precedent lesson from 1a61bf9)" — and it still missed four fragments.
**Takeaway**: A docs pass is done only when greps against live artifacts (probe stdout shape, package.json scripts, source line numbers) pass — rewriting the audited lines leaves un-audited neighbors stale, twice proven.

### Precedent: Hook edit without a hook test (→ N002)
**Commit(s)**: 2c25f94 — "chore: add agent harness rules, skills, and guardrail hooks" (2026-10-25, hooks created); 7776a30 — "chore: nodemailer 10 and lint the agent hooks" (2026-10-30, lint path gains scripts/hooks, gate test added, formatter import-order fixed)
**Blast radius**: 7776a30: 4 files (package.json, lockfile, format-on-edit.js, tests/gate-destructive.test.ts +53)
**Follow-up fixes**: None — but the asymmetry is the finding: the formatter was linted, never tested; its shell:true spawn is now the repo's only executable-code finding.
**Takeaway**: Any hook behavior change ships with its own stdin test in the same commit; shell:true is load-bearing on Windows — guard, don't remove.

### Precedent: The judge split that minted a dead export
**Commit(s)**: f14d9f9 — "refactor: split the judge into pool, rotation, and parse modules" (2026-10-30); same-day follow-up 8a8c0a0 — "fix: trim and lowercase candidate terms before matching"
**Blast radius**: 15 files across service + test layers; introduced ROTATION_EXHAUSTED (N004); the other three dead exports predate run #1's audit entirely.
**Follow-up fixes**: 8a8c0a0 (caught by audit, fixed with test same-day).
**Takeaway**: Refactors mint dead exports and comment drift; after unexporting, grep JSDoc references too.

### Precedent: Artifact tracking — and the absence of any status-flip
**Commit(s)**: 6698516 — "docs: track the tech-debt-audit-remediation artifacts" (2026-10-30, 8 files, artifacts only); merged via 2e064a8 "Merge pull request #3"
**Blast radius**: artifacts layer + whole-tree merge
**Follow-up fixes**: None; zero commits ever flipped a status field; run #1's validation once failed on scratch residue until a cleanup phase was added.
**Takeaway**: The supersede flip is novel — pin it with acceptance greps you actually execute, and keep the working tree clean before validating.

### Composite Lessons
- Docs drift recurs every round (1a61bf9 → F001-F005; b0b7dbe → N001/N003): verify the pass against live output shapes, and expect a third-pass check.
- Test the hook you touch (7776a30 vs N002): pair the charset guard with tests/format-on-edit.test.ts in one commit.
- Dead exports accumulate silently until tooling flags them (f14d9f9 → knip → N004): unexport plus JSDoc sweep.
- Mechanical-gate hygiene: one run-1 acceptance grep was unsatisfiable, one validation failed on residue — execute every pinned grep and clean the tree before the gate.

## Historical Context (from .rpiv/artifacts/)
- .rpiv/artifacts/discover/2026-10-31_07-47-21_tech-debt-run2-remediation.md — the FRD chaining into this research (requirements, decisions, acceptance greps)
- .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md — run-1's design, all 16 slices locked, to be marked superseded this round
- .rpiv/artifacts/research/2026-10-29_12-15-34_tech-debt-audit-remediation.md — run-1's research (the old design's parent)
- .rpiv/artifacts/plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md — run-1's 16-phase implementation plan
- .rpiv/artifacts/validation/2026-10-30_19-42-23_tech-debt-audit-remediation.md — run-1's passing validation report
- TECH_DEBT_AUDIT.md — audit run #2 input (2026-10-31, HEAD b92fa9f); the N-rows are this round's source

## Developer Context
**Q (discover: Fix set: N001-N004 now, N005 deferred): From the probe I inferred the fix set is N001-N004 now, with N005 (judge.ts split) deferred — the audit's own Top-5 list says N005 is not worth a dedicated PR. Keep that, or change it?**
A: N001-N004 now, defer N005

**Q (discover: N002 shape: charset guard (shell:true stays)): N002: the hook passes file_path into a shell:true spawn (format-on-edit.js:19). Note: shell:true is load-bearing on Windows (npx is npx.cmd there). Which shape?**
A: Charset guard

**Q (discover: Skip notice: warn + skip): When a file path fails the charset check, should the hook say why before skipping format?**
A: Warn + skip

**Q (discover: N004 shape: drop the 4 export keywords): chromiumContextFactory, MAX_CANDIDATES, ROTATION_EXHAUSTED, createInitialState are exported but only used inside their own modules. Unexport, or declare them intentional in a knip config?**
A: Drop 4 exports

**Q (discover: Continuity: fresh FRD; old design superseded): The 10-29 remediation design's next pending slice (Slice 11 = F020+F021) landed on disk already (watch.yml:73, :113-119, commit 510ff2a). How do we track this round?**
A: Fresh FRD

**Q (discover: Supersede handling: flip the old design status inside this round): The 10-29 design artifact still says its next slice is Slice 11, which already landed. Handle it inside this round, or leave it?**
A: Mark superseded

**Q (research checkpoint, .rpiv/guidance/architecture.md:33): The root guidance probe row carries the same phantom "prints the recommended JUDGE_CONCURRENCY" wording N001 kills, but the FRD's table AC names only lint/format. Include the probe-row rewrite in this docs pass?**
A: Rewrite it too (whole phantom family dies in one pass: guidance/scripts:27,61 + root:33 + README:69)

**Q (research checkpoint, .rpiv/guidance/scripts/architecture.md:32): The exit-contract row omits auth-dead — a 401/403-refused account dies only via that branch (probe-judge.ts:169-171), since a refused ramp floors at ceiling=1 (:148-151). How should the rewritten row name the exit causes?**
A: Name all three (failed leg, auth-dead 401/403, ceiling < 1 — matching classifyDead exactly)

**Q (research checkpoint, .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md:9): The supersede flip has no precedent — all 57 artifacts say status: ready, none ever flipped. Where does the pointer to the new FRD go?**
A: last_updated triple (status flip at :9; pointer + fresh timestamp folded into last_updated_note :11-13; no new key; body untouched)

## Related Research
- .rpiv/artifacts/research/2026-10-29_12-15-34_tech-debt-audit-remediation.md — run-1 research on the same audit lineage (24 F-findings, now resolved)

## Open Questions
- N005: move dispatchLlmCall and the wrapper warn wiring into judge-dispatch.ts when judge.ts is next touched for real work (audit N005 recommendation; deliberately deferred this round).
- Design-stage note (fact, not a decision): the FRD's acceptance echo pin ("x&calc.ts exits 0, prints a warn") only holds when a file with that name exists in the hook's cwd — the existsSync gate at format-on-edit.js:16 exits silently otherwise. The design should either pin via the temp-dir absolute-path stdin test (durable) or state the file-exists precondition for the echo form.

## Follow-up Research 2026-10-31T09:25:06+07:00

Developer review raised five points; each verified this session and dispositioned below. The prior sections stay as written; this section supersedes where noted.

### The happy-path pin is now empirically verified, not asserted (the biggest risk, closed)
- Raw-biome control, mirroring the hook's exact spawn from repo root: `npx biome format --write C:\Users\utama\AppData\Local\Temp\tmp.*/unformatted.ts` printed "Formatted 1 file in 1521µs. Fixed 1 file.", exit 0, content rewritten `const x=1` → `const x = 1;\n`. Biome 1.9.4 has no out-of-project decline for CLI format targets; config resolution from cwd reaches the temp file.
- The hook subprocess itself, driven through the gate-destructive spawnSync idiom, rewrote the temp file: 3/3 draft pins pass (`npx tsx --test tests/format-on-edit.test.ts`, ~1.1s).
- **Disposition**: the design can lock file-content mutation as the happy-path proof. A draft test file now exists at tests/format-on-edit.test.ts with three pre-guard pins: happy path (content mutation), fail-open ("not json" → 0), and silent-existsSync (nonexistent hostile path → exit 0, empty stderr — pinning the precondition the FRD echo missed). The implement stage extends it with the hostile-warn pin, which necessarily fails until the charset guard lands; the hostile case must create the file in the temp dir (its absolute path is allowlist-clean except the &).

### FRD acceptance echo demoted: Open Question → design constraint
- Confirmed unsatisfiable as written: the existsSync gate at format-on-edit.js:16 exits silently when no file named x&calc.ts exists in the hook's cwd, and the echo's POSIX single quotes are literal characters under cmd.exe. The draft test's third pin documents the silent path.
- **Disposition**: the design carries the spawnSync stdin test as the sole gate-bearing hostile pin; the echo form may appear only with its file-exists precondition stated. This supersedes the Open Questions note above.

### Supersede flip: add a one-line banner under the title (recommendation recorded)
- The frontmatter-only flip leaves the body reading as resumable: "One PR remediating every TECH_DEBT_AUDIT.md finding" at designs:19, Slice 11 section live at :3455. Status alone is a weak guard against the stale-slice resumer the FRD rationale names.
- **Disposition**: recommended the design adds a one-line superseded banner directly under the "# Design:" title, pointing at the new FRD, alongside the status flip at :9 and the last_updated triple pointer. Frontmatter + banner; body otherwise untouched. Locks at design review.

### AGENTS.md swept for the phantom-probe family: clean
- Grep evidence (2026-10-31, AGENTS.md): :18 describes the probe honestly ("ramp concurrent calls to find the concurrency ceiling"); :19 already carries the correct lint path including scripts/hooks (matches package.json:11); :42 names JUDGE_CONCURRENCY only as the concurrency knob. Zero phantom "recommended"/"ceiling=" fragments.
- **Disposition**: no AGENTS.md edit this round; the sweep is recorded so the docs pass can claim done-ness (the b0b7dbe lesson: verify the un-audited neighbors, and record that you did).

### .rpiv/guidance/scripts/architecture.md:54 folded into the docs pass
- Same fragment class as N003: the caveat says a hook edit faces "the exit-code pins in tests/gate-destructive.test.ts" — true only until N002 lands, after which the formatter has its own pins.
- **Disposition**: the N001/N003 docs pass rewrites :54 to name both pin files (gate → tests/gate-destructive.test.ts; formatter → tests/format-on-edit.test.ts).

### Working-tree note
- tests/format-on-edit.test.ts (draft, 3 passing pins) now exists in the working tree ahead of the design — it is the round's net-new test file, pre-verified. Full-suite impact: 195 → 198 cases once the implement stage finalizes it.
