---
date: 2026-10-31T09:27:45+0700
author: Yogiswara Utama
commit: b92fa9f
branch: main
repository: loker-watcher
topic: "Tech-debt run #2 remediation (N001-N004; N005 deferred)"
confidence: high
complexity: low
status: ready
verdict: pass
tags: [solutions, hooks, docs-guidance, dead-exports, artifact-lifecycle]
last_updated: 2026-10-31T09:27:45+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Tech-debt run #2 remediation (N001-N004; N005 deferred)

**Date**: 2026-10-31T09:27:45+0700
**Author**: Yogiswara Utama
**Commit**: b92fa9f
**Branch**: main
**Repository**: loker-watcher

## Research Question
Ground the four open findings of audit run #2 (TECH_DEBT_AUDIT.md, generated 2026-10-31 at b92fa9f) for a one-PR remediation: (1) a charset guard on the format-on-edit hook's shell:true spawn plus its black-box stdin test; (2) a docs pass that makes guidance and README describe the probe that actually ships (per-account "ceiling=N", every-account walk, exit 1 on dead legs); (3) four missed docs fragments; (4) unexporting four dead symbols; plus flipping the superseded 10-29 design artifact. Chained from the discover FRD via the research artifact.

## Summary
**Problem**: The hook passes an unsanitized file_path into a shell:true spawn (injection proven); four doc surfaces describe a probe that does not ship; one comment points the wrong direction; four dead exports survive; the 10-29 design artifact still reads as resumable.
**Recommended**: Charset allowlist guard - a 3-line regex gate at scripts/hooks/format-on-edit.js:17, warn + skip, shell:true unchanged. The OWASP-recommended shape, zero new deps, matches the discover-locked decision.
**Effort**: Low (~1 day: guard + 1 test pin, one docs pass over 6 surfaces, 4 keyword deletions, 1 frontmatter flip)
**Confidence**: High

## Problem Statement

**Requirements:**
- N002: format-on-edit.js rejects any file_path failing ^[A-Za-z0-9 _.()/\\:+-]+$ after the extension+existsSync gate, prints a one-line warn, exits 0 without spawning. shell:true stays (npx is npx.cmd on Windows; Node >= 22 refuses .cmd without a shell).
- N002 test: tests/format-on-edit.test.ts pins the hostile path (exit 0, spawns nothing) and the normal path (still formats).
- N001/N003: guidance/scripts, guidance/src, root guidance commands table, README, and the judge.ts:190 comment describe live truth (probe contract, lint/format rows, sleepFn, probe imports).
- N004: chromiumContextFactory, MAX_CANDIDATES, ROTATION_EXHAUSTED, createInitialState lose the export keyword.
- Supersede: the 10-29 design artifact flips to status: superseded with a pointer to the new FRD.

**Constraints:**
- Hard: no new runtime dependency (repo doctrine); hook stays always-exit-0 fail-open; tests stay offline; Node >= 22, ESM, strict TS.
- Hard: shell:true is load-bearing on Windows (CVE-2024-27980 hardening).
- Soft: warn wording mirrors the file's existing "format-on-edit: " prefix; biome lineWidth 100.

**Success criteria:**
- The hostile-path stdin test fails before the guard lands and passes after.
- The FRD's acceptance greps pass; typecheck + lint + test all exit 0.

## Current State

**Existing implementation:**
- scripts/hooks/format-on-edit.js:8-23 - 23-line always-exit-0 hook: stdin parse fail-open (:8-13), extension+existsSync gate (:16, existsSync is cwd-relative), spawnSync npx biome format --write with shell:true + stdio:"ignore" (:18-21), spawn-fail warn (:22), unconditional exit 0 (:23). Registered PostToolUse "Edit|Write" in .claude/settings.json:13-21; the hook .js is invisible to tsc (no allowJs) - biome lint plus the black-box test are its only gates.
- Draft test tests/format-on-edit.test.ts exists with 3 pre-guard pins (happy-path content mutation, fail-open "not json", silent existsSync miss); all pass; ~1.1s.
- Probe truth: scripts/probe-judge.ts:139-155 (findConcurrencyCeiling: no Math.max anywhere; bare return 4 only on a fully clean 2-to-4 ramp), :164-177 (classifyDead: failed leg, auth-dead 401/403, ceiling < 1), :190/:232-235 (every-account walk, per-account "ceiling=N" line), :242 (exit 1).
- Four dead exports with zero importers repo-wide: src/fetch-threads.ts:125, src/heartbeat.ts:21, src/judge-rotation.ts:51 (typeof type-operand use at :55 survives unexport), src/state.ts:38.
- 10-29 design artifact: status: ready at designs:9; Slice 11 landed on disk (watch.yml:73, :113-123, commit 510ff2a) but the artifact still names Slice 11 as next.

**Relevant patterns:**
- Allowlist regex .test() validation: src/extract.ts:126, scripts/hooks/format-on-edit.js:16 (extension gate) - 2 in-code precedents
- Warn + skip + exit 0: scripts/hooks/format-on-edit.js:22-23 - the file's own idiom
- spawnSync(process.execPath, ...) black-box stdin tests: tests/gate-destructive.test.ts:12 (6 call sites), tests/format-on-edit.test.ts:17
- mkdtemp + single after() cleanup: tests/state.test.ts:22-27

**Integration points:**
- scripts/hooks/format-on-edit.js:17 - guard insertion point (between gate and spawn; placement makes "warn means biome never ran" valid)
- tests/format-on-edit.test.ts - net-new suite, auto-discovered by the tsx --test tests/*.test.ts glob
- .rpiv/guidance/scripts/architecture.md:27,32,46-47,54,58,61 - N001 rewrite surface
- .rpiv/guidance/src/architecture.md:10,43-53 and .rpiv/guidance/architecture.md:29-30,33 and README.md:67-69 and src/judge.ts:190 - N003 fragments
- .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md:9,11-13 - supersede flip

## Solution Options

### Option 1: Charset allowlist guard (on the existing npx + shell:true spawn)
**How it works:**
Insert at format-on-edit.js:17, after the :16 gate and before the :18 spawn: if the file_path fails ^[A-Za-z0-9 _.()/\\:+-]+$, print a one-line warn ("format-on-edit: " prefix style) and exit 0. The spawn block stays byte-identical. The hostile path never reaches cmd.exe.

**Pros:**
- OWASP-recommended defense, verified current: "Positive or allowlist input validation" is the cheat sheet's operative line for command arguments (OWASP OS Command Injection Defense Cheat Sheet).
- Sufficiency verified: the class excludes every cmd.exe active char (& | < > ^ % ! " ' , ; =). In-class chars are benign here: space only splits argv (nuisance, not injection); parentheses are inert outside if/for blocks (SS64 cmd syntax reference; the hook spawns a bare single command line). No public bypass of charset-class allowlists for cmd.exe exists in security literature.
- Smallest possible diff: ~3 lines (lineWidth-100 wrap) + one test pin reusing the draft suite's own helpers. Zero deps, zero spawn-target change, matches the discover-locked decision.
- Strong codebase precedent: same ^...$ charset .test() shape at src/extract.ts:126; the file's own warn+skip idiom at :22-23.

**Cons:**
- DEP0190 pressure remains: Node deprecated args-with-shell (runtime deprecation in v24.0.0), so the long-term direction is shell removal - deferred, not resolved, here.
- Exotic-but-legal filenames (e.g. containing e, #, @) are newly skipped-with-warn instead of formatted (acceptable: warn is visible; hook stays best-effort).

**Complexity:** Low (~2 hours)
- Files to create: 0
- Files to modify: 2 (format-on-edit.js ~3 lines; tests/format-on-edit.test.ts +1 pin, ~12 lines)
- Risk level: Low

### Option 2: Direct binary spawn, no shell (JS-bin variant)
**How it works:**
Replace the npx + shell:true spawn with spawnSync(process.execPath, [BIOME_BIN, "format","--write",file]) where BIOME_BIN resolves node_modules/@biomejs/biome/bin/biome (CJS, shebang, PLATFORMS map require-resolves the platform binary - works under plain node from any cwd). shell:false means argv passes verbatim; cmd.exe tokenization is impossible; the injection class dies structurally and DEP0190 is retired.

**Pros:**
- Strong codebase precedent: process.execPath spawns already exist at 2 definitions / 7 call sites in tests; @biomejs/biome ^1.9.4 is already a devDependency (lockfile 1.9.4; caret cannot cross to 2.x; node_modules/@biomejs/cli-win32-x64 confirmed on disk).
- Upstream itself is shell-free (bin/biome spawns the exe with shell:false at bin/biome:50-54) - the hook would inherit Biome's own invocation shape.
- All 3 draft pins survive unchanged (they drive the hook via process.execPath, never npx).

**Cons:**
- Deviates from the discover-locked decision and FRD functional requirement 1 ("shell: true stays", guard is the fix); it is a different fix than the audit and FRD describe.
- Hard-codes the node_modules layout assumption (declared bin field, so standard-npm-safe, but a new assumption where npx previously absorbed it).
- The warn+skip UX decision from discover becomes moot (nothing to warn about) - the FRD's hostile-pin semantics change shape.

**Complexity:** Low-Med (~3 hours; JS-bin variant only - the exe-direct variant is disqualified: biome.exe fails to spawn on ubuntu, breaking the CI test job at ci.yml:34)
- Files to create: 0
- Files to modify: 2 (format-on-edit.js spawn block :18-21 + path const; guidance/scripts:14,46-47 drift)
- Risk level: Low-Med (unverified Claude-Code cwd convention is already load-bearing for the relative script path, so no new assumption there)

### Option 3: Biome JS API (in-process WASM, no child process)
**How it works:**
Add @biomejs/js-api + peer @biomejs/wasm-nodejs; the hook does openProject(repoRoot), then readFile - formatContent - writeFile per edit. No spawn at all.

**Pros:**
- No process boundary; config resolution via openProject is first-party.

**Cons:**
- BLOCKER - engine split: the repo formats everywhere with biome CLI 1.9.4 (npm scripts, lint-staged, hook), but js-api 6.1.0 embeds the Biome 2 WASM engine. Across a major, formatter output can differ, so a file gets style A on save and style B on commit - permanent flip-flop. No test covers parity.
- Alpha, verbatim upstream: "The API is currently in alpha. It is not yet ready for production use." (js-api README).
- Atomicity loss: CLI --write does the write today; formatContent forces a non-atomic truncate-rewrite that races Claude Code's own write-back.
- New dependency (js-api + tens-of-MB wasm payload) collides with the no-new-deps doctrine and buys only what Option 1 or 2 deliver safely.

**Complexity:** High (~1 day+ and chronic risk)
- Files to create: 0; Files to modify: 2 deps + hook rewrite 23 to 40+ lines (async, per-step fail-open)
- Risk level: High

## Comparison

| Criteria | Option 1: Charset guard | Option 2: Direct binary spawn | Option 3: Biome JS API |
|----------|----------|----------|----------|
| Complexity | L | L-M | H |
| Codebase fit | H (locked FRD decision; 2 precedents) | M (strong test precedent; new spawn-target assumption) | L (zero precedent) |
| Risk | L | L-M | H |
| Kills injection class | Yes (at boundary, OWASP shape) | Yes (structurally) | Yes (no shell) |
| New deps | 0 | 0 | 2 (doctrine collision) |
| DEP0190 posture | Deferred (noted) | Resolved | Resolved |

## Recommendation

**Selected:** Option 1 - Charset allowlist guard

**Rationale:**
- It is the discover-locked decision, and the evidence validated it rather than overturned it: OWASP names allowlist validation as the defense for exactly this boundary; Node's own docs say do not pass unsanitized input with shell enabled.
- Sufficiency is adversarially verified: the class excludes every cmd.exe metacharacter; the two in-class chars are benign in a bare single command line (space = argv split nuisance; parens = inert outside if/for). No public charset-class bypass exists.
- Smallest safe diff on the round's critical path: ~3 lines + 1 test pin; zero deps; the draft suite's 3 pins stay green and one hostile pin flips red-to-green exactly when the guard lands (the round's designed signal).
- Strong in-repo precedent: src/extract.ts:126 uses the same charset .test() shape; the file's own warn+skip idiom at :22-23.

**Why not alternatives:**
- Option 2: clears the fit filter and is the right long-term DEP0190 migration, but it replaces the FRD's specified fix with a different one, changes the hostile-pin semantics mid-round, and hard-codes a node_modules path where npx previously absorbed resolution. Record it as the follow-up for when the hook is next touched (the same deferral pattern as N005).
- Option 3: fails the fit filter outright on integration-risk (1.9.4 CLI vs 2.x WASM engine split = save/commit style flip-flop) plus alpha status, atomicity loss, and the doctrine collision.

**Trade-offs:**
- Accepting DEP0190 deprecation pressure (runtime warning on Node 24+) for the minimal-diff, FRD-conformant fix now.
- Accepting skip-with-warn for exotic-but-legal filenames in exchange for a provable injection kill.

**Implementation approach:**
1. Hook guard - insert the charset test + warn at scripts/hooks/format-on-edit.js:17; write ":" unescaped in the class (biome's useless-escape rule is active); wrap to lineWidth 100.
2. Test pin - extend tests/format-on-edit.test.ts: create bad&name.ts in the temp dir (must exist so the :16 existsSync gate does not fire first), assert exit 0, non-empty stderr, content unmutated. Flip the draft "pre-guard" header comment.
3. Docs pass - N001 (guidance/scripts:27,32,46-47,54,58,61: real probe contract, three dead causes, charset gate folded into the :46 enumeration line) and N003 (guidance/src:10 probe imports; WatcherDeps fence sleepFn row after :51; root guidance :29-30 lint/format rows and :33 probe row; README:67-69 per-account ceilings; judge.ts:190 below to above).
4. Unexports - drop the export keyword on the four symbols; run the acceptance grep plus a JSDoc-reference grep.
5. Supersede flip - status: superseded at designs:9, pointer + fresh timestamp folded into last_updated_note :11-13, plus the one-line banner under the title (per research follow-up recommendation).

**Integration points:**
- scripts/hooks/format-on-edit.js:17 - the guard (after gate :16, before spawn :18; placement preserves "warn means biome never ran")
- tests/format-on-edit.test.ts - hostile pin + header-comment flip
- .rpiv/guidance/scripts/architecture.md:46-47,54 - hook-pattern fence and the caveat that names the formatter's future pins
- src/judge.ts:190 - below to above (neighbors :65 and :265 stay; :265 is pinned prompt text with six test sites)

**Patterns to follow:**
- Charset .test() allowlist: src/extract.ts:126
- Warn + skip + exit 0: scripts/hooks/format-on-edit.js:22-23
- spawnSync stdin black-box test: tests/gate-destructive.test.ts:8-13,44-52
- mkdtemp + after() cleanup: tests/state.test.ts:22-27

**Risks:**
- Hostile pin vacuously passes (file does not exist, silent exit at :16): mitigated - the pin creates the file in the temp dir (empirically verified in research follow-up; 3/3 draft pins pass today).
- Regex drift (charset edited later to admit metachars): mitigated - the hostile pin (& in filename) fails the build if the class ever admits &.
- cmd.exe context change (hook someday runs inside a compound statement): not applicable - bare single command line by construction; noted for any future spawn-shape change.

## Scope Boundaries
- Building: the guard + hostile pin, the six-surface docs pass, four unexports, the supersede flip (+ banner).
- NOT doing: N005 judge split (deferred by audit decision); knip config; any spawn-target or dependency change (Option 2 recorded as the DEP0190 follow-up); .rpiv/artifacts pruning policy (audit open question 1 stays open); AGENTS.md (swept clean, zero phantom fragments - research follow-up).

## Testing Strategy

**Unit tests:**
- Hostile pin: bad&name.ts exists in temp dir; event file_path = its absolute path (allowlist-clean except &); assert exit 0, stderr matches the warn, content unmutated. Red before the guard, green after.
- Existing 3 pins stay green: happy-path content mutation (const x=1 rewritten), fail-open "not json" to 0, silent existsSync miss (exit 0, empty stderr).

**Integration tests:**
- None (offline doctrine; the hook has no network surface).

**Manual verification:**
- [ ] Execute the FRD's acceptance greps verbatim (charset echo with its file-exists precondition stated; export-grep returns empty post-edit).
- [ ] Gates: npm run typecheck && npm run lint && npm test all exit 0 (33-file lint floor + 195 tests growing to 198).
- [ ] Grep the six doc surfaces for phantom fragments ("recommended JUDGE_CONCURRENCY", "only account 0", "recommended width", "floored", "parseLlmAccounts below"): zero hits.

## Open Questions
**Resolved during research:**
- Is the charset class sufficient against cmd.exe? Yes - adversarial external check: all active chars excluded; space and parens benign in this context (OWASP cheat sheet; SS64 cmd syntax; DEP0190 docs).
- Is the Biome JS API a viable no-shell alternative? No - alpha, and the 1.9.4-vs-2.x engine split makes save/commit formatting diverge (lockfile 1.9.4; js-api 6.1.0 embeds 2.x wasm).
- Does a direct spawn have precedent and support? Yes - process.execPath spawns at 7 test call sites; @biomejs/biome/bin/biome works under plain node from any cwd (CJS, PLATFORMS require-resolve) - viable as the future DEP0190 migration.

**Requires user input:**
- None. The discover checkpoint locked fix set, guard shape, warn+skip, unexport shape, and supersede handling; the research checkpoints locked the phantom-family scope, three-cause exit row, and pointer placement.

**Blockers:**
- None.

## References
- .rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md - the grounding research (all file:line citations)
- .rpiv/artifacts/discover/2026-10-31_07-47-21_tech-debt-run2-remediation.md - the FRD (requirements, acceptance greps, locked decisions)
- scripts/hooks/format-on-edit.js:8-23 - N002 site
- tests/gate-destructive.test.ts:8-13 - stdin-test idiom
- TECH_DEBT_AUDIT.md - audit run #2 input
- OWASP OS Command Injection Defense Cheat Sheet - https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html
- Node DEP0190 - https://nodejs.org/api/deprecations.html#dep0190-passing-args-to-nodechild_process-execfile--spawn-with-shell-option
- SS64 cmd escaping - https://ss64.com/nt/syntax-esc.html
- @biomejs/js-api README - https://github.com/biomejs/biome/blob/main/packages/@biomejs/js-api/README.md
