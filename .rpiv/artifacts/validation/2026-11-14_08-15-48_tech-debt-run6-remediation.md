---
template_version: 1
date: 2026-11-14T08:15:48+0700
author: Yogiswara Utama
commit: 19d7a94
branch: main
repository: loker-watcher
topic: "Validation of Tech-debt run #6 remediation execution (N041-N059 + N052, N055)"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md"
tags: [validation, tech-debt, judge, judge-dispatch, judge-prompts, linkedin-fetch, linkedin-walk, linkedin-context, linkedin-capture, knip, docs]
last_updated: 2026-11-14T08:15:48+0700
---

## Validation Report: Tech-debt run #6 remediation execution (N041-N059 + N052, N055)

Validation ran against the six phase commits a791606..19d7a94 (base df890a9). The working tree is clean except the workflow own untracked .rpiv/artifacts/ documents. The plan post-landing Follow-up (2026-11-14T08:09) corrected three verification criteria; this report runs the corrected forms.

### Implementation Status

- Phase 1: Walk fixes (N046, N047, N048) - Fully implemented
- Phase 2: Capture bound (N051) - Fully implemented
- Phase 3: Tick call expression (N054, N053, N050) - Fully implemented
- Phase 4: Judge split (N042a, N005) - Fully implemented
- Phase 5: LinkedIn split (N042b, N059) - Fully implemented
- Phase 6: Hygiene and docs (N041, N043, N044, N045, N049, N052, N055, N056) - Fully implemented

### Automated Verification Results

- Type checking: npm run typecheck - exit 0
- Lint: npm run lint - exit 0, 74 files checked
- Full suite: npm test - 638 tests / 638 pass / 0 fail (base required >= 626)
- knip gate: npm run knip - exit 0; step lands in .github/workflows/ci.yml:36 after Test (:33)
- N046 stream-order fold: grep -rc "isPageCloseRace(error)" src/ - one line, src/linkedin-walk.ts:2 (post-split location, per the plan Step-8 correction)
- N048 bare catches: grep -c "catch {" src/linkedin-fetch.ts - 0
- N047 cap: grep -rc "slice(-LINKEDIN_MAX_POSTS)" src/ - one line, src/linkedin-walk.ts:1
- N051 guard order: src/linkedin-capture.ts - the bound at :173 runs before the lazy stamp at :182; Buffer.byteLength(record.body count 1
- N051 byte-measure: CAPTURE_MAX_BODY_BYTES = 8 * 1024 * 1024 at :65
- N054 no positional call sites: grep -rn "fetchLinkedInPosts(...], PROFILE" src/ scripts/ tests/ - nothing
- N053 factory rebuilt per call: linkedinChromiumContextFactory - 0 occurrences in src/ scripts/ tests/; the duplicate literal in scripts/login-linkedin.ts - 0
- N050 guard: grep -c "0 posts - payload not touched" scripts/fetch-linkedin.ts - 1 (:470)
- Judge split LOC: wc -l src/judge.ts - 374 (< 500); src/linkedin-fetch.ts - 341 (< 500)
- Judge cycle check (the plan parse-not-grep command): ok judge - src/judge-dispatch.ts ./judge.js imports are type-only
- Walk cycle check: ok walk - src/linkedin-walk.ts ./linkedin-fetch.js imports are type-only
- Moved-type wholeness: AttemptDirective - 5 action members in src/judge-dispatch.ts
- Byte-verbatim moves (base df890a9 vs HEAD): 20/20 code bodies verbatim; doc blocks uncompared except `sleep`. Method: 7 bodies compared raw (dispatchLlmCall, judgeBatch, judgePost, normalizeEndpoint, terminalFailureReason, exhaustionRecord, sleep), 12 with comments stripped and whitespace normalized (BatchOutcome, ContentDecision, DispatchOutcome, DispatchWarns, SleepFn, REQUEST_TIMEOUT_MS, RETRYABLE_STATUSES, RETRY_DELAYS_MS, allAvailabilityBlocked, systemMessage, buildMessages, buildBulkMessages), AttemptDirective checked as a 5-member count. Only textual deltas: the visibility keyword on judgeBatch/buildMessages/buildBulkMessages/SleepFn (exactly where the plan says) and one dropped blank line beside sleep. Comment drift above the other 19 symbols would not surface under this method - a benign-deviation class the current evidence cannot see
- N059 one UA home: grep -rc "Chrome/131.0.0.0" src/ - only src/browser-constants.ts
- N055 one id floor: grep -rc "d{10,}" src/ - only src/linkedin-parser.ts:87; readers at linkedin-payload.ts:66 and linkedin-walk.ts:160
- N041 unexports: all 11 plan-named targets unexported across email.ts, judge-health.ts, linkedin-context.ts, linkedin-fetch.ts, config-file.ts, linkedin-payload.ts, linkedin-session.ts, state.ts, judge-ceilings.ts (knip exit 0 confirms completeness)
- N049 atomic flags: writeFlagAtomic (temp + rename + unlink-on-failure) in scripts/fetch-linkedin.ts; tripLatch keeps its pre-write check (D14)
- N056 ignore rules: state/*.tmp present (.gitignore:14), outputs/ count 0, slice*-recon/ and state/linkedin-get-budget.json kept per D5
- N045/N044 doc grep pass: the ten-module loop over AGENTS.md, README.md, .rpiv/guidance/ prints nothing missing; the AGENTS.md lint list (:30) matches package.json
- N052 README: retention section at README.md:338; the budget-file line corrected at :334
- N043 policy: recorded at .rpiv/guidance/architecture.md:56-58; gc evidence below
- TECH_DEBT_AUDIT.md: the resolved ledger carries the N041-N059/N052/N055 rows with evidence
- No regressions detected - base df890a9 measured (detached checkout, full suite, back on main): 626 tests / 626 pass / 0 fail; delta -> 638/638

### Code Review Findings

#### Matches Plan:

- tests/linkedin-fetch.test.ts (the N046 case) - pins the stream-order tip: release order reversed, the stop names idAt(4), and the completion-order id idAt(2) is asserted absent
- tests/linkedin-fetch.test.ts (the N047 case) - walks 200 posts and pins exactly 150 returned, ids 51..200 (the newest; the D15 sort, not a plain slice)
- src/linkedin-capture.ts - the base..HEAD diff touches only the guard; the write path (stamp, mkdir, JSON shape, CAPTURE_SCHEMA_VERSION) is unchanged, so a normal session files stay byte-identical
- src/config.ts:17 + src/linkedin-fetch.ts - ENV_NAMES.linkedinProfileDir, resolveLinkedInProfileDir (blank or unset falls to the literal), factory built per call from the resolved dir; tests/fetch-linkedin.test.ts:583 threads the override end to end into the browser
- scripts/fetch-linkedin.ts:470-478 - the zero-post guard returns before writePayloadAtomic and clears the episode marker (the dead-to-healthy edge still fires)
- src/judge-prompts.ts / src/judge-dispatch.ts / src/judge.ts - the run-5 split scope landed with both re-export facades and removal notes naming run #7
- src/browser-constants.ts / src/linkedin-context.ts / src/linkedin-walk.ts - the usage-based boundary of D7; the pacing gate stayed orchestration-side
- tests/fetch-linkedin.test.ts (the N049 case) - a directory-shaped marker path forces a failed rename: no truncated flag, no surviving .tmp
- Live scratch check (this validation): state/crash-sim.tmp written into state/ shows as ignored (!!) in git status; the tree stays clean; the file was removed after the check

#### Deviations from Plan:

- N043, recorded in the plan itself: the run used git gc --aggressive --prune=now; the documented form is git gc --aggressive. Measured this validation: git fsck exit 0 (6 dangling commits, benign), df890a9 and 3ed60f0 both present, is-shallow-repository false. After-state: .git 17 MB (the audit read 189 MB), size-pack 15064 KiB, loose count 108. The before/after count-objects criterion has only the after reading from this run; the before figures are the audit own measurement. Non-blocking; the operator should use the documented form on any future gc.
- src/judge-dispatch.ts (sleep/SleepFn adjacency): one blank line between the moved sleep declaration and the following SleepFn doc comment was dropped in the move. Whitespace only; both bodies are verbatim. Comment-class, non-blocking.
- Phase 4 byte-verbatim criterion as written does not pass on the final tree: `git diff -M --stat src/judge.ts src/judge-dispatch.ts` did not pair the files as renames. Cause: rename detection requires a deleted source to pair with the added file, and `judge.ts` was modified, not deleted - its 374-line residual keeps the path alive, so no rename pair can form while the facade survives. Substituted an extraction + string-equality check over the 20 moved code bodies, which passed. The criterion, not the implementation, deviated. Non-blocking.
- The plan's LOC criterion (N042) named only `judge.ts` and `linkedin-fetch.ts`, so the run closed the finding while creating two new files over the same 500-line bar: `src/judge-dispatch.ts` (645 LOC) and `src/linkedin-walk.ts` (541 LOC). Filed as N060 in TECH_DEBT_AUDIT.md; the re-scoped cut lives there. The criterion, not the implementation, deviated. Non-blocking.

#### Pattern Conformance:

- The splits reuse the repo own idioms: the type-only back-edge (the judge-rotation.ts doctrine) in both new modules, the FetchTickDeps deps-object shape with Default JSDoc, the writePayloadAtomic temp/rename shape, and the warn-once policy
- New test cases follow the offline node:test + tsx idioms (gated-body doubles, mock console, temp roots); the judge and LinkedIn suites ran unedited through the facades, as the plan required
- Minor observation: the LinkedIn facade re-exports 7 symbols plus a separate SCROLL_JS re-export (two export statements instead of one) - acceptable variation; it matches the plan own snippet
- Drift check (measured): the Phase 4 hunk-6 citation landed - src/judge-availability.ts:34 now cites src/judge-dispatch.ts (the old src/judge.ts:73-78 citation is gone), and the wire-helper import lines at :21-23 name judge-dispatch.ts. No stale judge.ts citation survives in the availability module.

#### Potential Issues:

- None blocking. The three live PC-leg checks below are the only unexercised paths; each needs the operator real session and browser.
- Coverage boundary: no --goal was supplied to this validation, so the report proves plan-conformance, not brief-conformance - if the original ask differed from the plan, the report cannot see it. Per-phase commands were also run as repo-wide supersets (npm run lint, npm test), so a per-phase scoping failure would not surface.
### Manual Testing Required:

Offline manual criteria - pinned by a passing test in the full suite (test coverage, not live exercise):

1. Phase 1 seen-stop stream order: done - the N046 test pins the stream-order id and ran green in the full suite
2. Phase 1 200-post cap: done - the N047 test pins exactly 150, the newest (ids 51..200), green in the suite
3. Phase 2 all-over-bound walk: done - the N051 test creates no session directory and warns once, green in the suite
4. Phase 2 normal-walk byte-identity: done - guard-only diff; the write path is unchanged
5. Phase 3 zero-post tick: done - the guard test pins no write and a cleared marker, green in the suite
6. Phase 3 profile override: offline equivalent done - the resolver unit test + the end-to-end thread test (tests/fetch-linkedin.test.ts:583)
7. Phase 4 exhaustion alarm pool order: done - judge.test.ts:1085 pins mask reasons in pool order, green in the suite
8. Phase 4 429 cool + rewind: done - judge.test.ts:908 (a 429 never stamps the ledger) plus the rotation suite, green
9. Phase 5 checkpoint/leg-dead vocabulary: done - the halt vocabulary tests and tests/linkedin-fetch.test.ts:701 (tagged LegDeadError), green
10. Phase 6 crash mid-flag-write: done - the N049 test plus the live state/*.tmp ignore check above

Live PC-leg criteria - these need the real session and browser on the operator PC (each under two minutes; none is safe or possible from this session):

1. Phase 3: LINKEDIN_PROFILE_DIR=D:/other/profile npm run probe-linkedin - the probe context must open the D: profile
2. Phase 5/6: npm run probe-linkedin - still gates on a real session (checkpoint wall -> exit 1)
3. Phase 6: npm run fetch-linkedin from the dedicated clone of main - passes guardCheckout and writes the payload

### Recommendations:

- Ready to commit - the implementation is complete and validated. The tree already carries the six phase commits; /skill:commit has nothing new to group unless the three live checks surface something.
- Run the three live PC-leg checks above on the operator PC at the next natural gap (about 5 minutes total); they exercise only paths the offline suite cannot reach.
- Run #7 owns the recorded follow-ups: re-point the three facade imports and delete both facades, N057 (the shared scrollRounds knob), N058 (the probe ramp test), and N060 (see Deviations from Plan; the re-scoped cut lives in TECH_DEBT_AUDIT.md).