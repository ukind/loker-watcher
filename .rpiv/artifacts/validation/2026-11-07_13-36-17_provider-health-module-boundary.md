---
date: 2026-11-07T13:36:17+0700
author: Yogiswara Utama
commit: c647e0f
branch: main
repository: loker-watcher
topic: "Validation of provider-health-module-boundary"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-07_08-49-53_provider-health-module-boundary.md"
tags: [validation, judge-health, judge-rotation, judge, judge-ceilings, email, heartbeat, watch-workflow, commit-state-rebase]
last_updated: 2026-11-07T13:36:17+0700
---

## Validation Report: provider-health-module-boundary

### Implementation Status

- ✓ Phase 1: Health module — Fully implemented
- ✓ Phase 2: Health module tests — Fully implemented
- ✓ Phase 3: Rotation fields + inline pick — Fully implemented
- ✓ Phase 4: Judge core stamps + hang arm — Fully implemented
- ✓ Phase 5: Email + heartbeat riders — Fully implemented
- ✓ Phase 6: Entry wiring — Fully implemented (test deliverable added during this validation run)
- ✓ Phase 7: Workflow + commit-back — Fully implemented
- ✓ Phase 8: Docs sync + repo-wide gates — Fully implemented

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean, 0 errors
- ✓ Lint: `npm run lint` — 58 files checked, no fixes applied
- ✓ Tests: `npm test` — 444 tests, 444 pass, 0 fail, 0 skipped (441 pre-existing + 3 Phase 6 tests added this run)
- ✓ Phase 6 suite: `npx tsx --test tests/index.test.ts` — 18 tests, 18 pass, including the new `provider health (the entry wiring)` describe (tests/index.test.ts:707-846)
- ✓ Boundary holds: `grep -n "judge-health" src/judge-rotation.ts` — 8 hits, all doc-comments plus the type-only `TickOutcomes` import (line 38, the D5 idiom); zero runtime edges
- ✓ failuresFromCooldowns removed: `grep -rn "failuresFromCooldowns" src/ tests/` — sole survivor is the Phase-1 provenance doc-comment at src/judge-health.ts:219, exactly as the plan predicted
- ✓ Skip-set carries the third literal: `grep -n "judge-health" scripts/commit-state-rebase.sh` — header mention (line 14) + case line (line 66)
- ✓ Stale prose sweep: `grep -rniE "two committed state|two state files|both state files|two invokers|is two files" README.md AGENTS.md .rpiv/guidance/ scripts/commit-state-rebase.sh` — no matches
- ✓ No repo writes during suite: `git status --porcelain state/` — empty
- ✓ No regressions detected — all 444 tests green, including the all-429 pin (tests/index.test.ts:435) and every pre-health fixture

### Code Review Findings

#### Matches Plan:

- src/judge-health.ts — the full 20-export module: envelope types, never-throw reader with the degrade lattice, pure resolver, tick-merge, atomic writer, semantic-change gate, ledger helpers, episode helpers, both best-effort flush wrappers, and `episodeAlarmDue` reading the pre-flush snapshot
- src/judge-health.ts:47 + src/judge-rotation.ts:62 — the paired constants `HARD_FAIL_TICKS_TO_CAP = 2` / `HEALTH_CAP_STREAK = 2` with cross-referencing docs at both sites
- src/judge-rotation.ts:180-237 — the inline half-open predicate in `pickEligibleAccount` and the probe registration in `claimAccount`, plain-field reads only
- src/judge.ts:462-467 — the third flavor arm (`allHealthBlocked`) before `waitCeilingSlot`, zero park cost
- src/judge.ts:532-543 — the terminal stamp with `terminalFailureReason` (401/403 → "key dead"); the 429 and mid-backoff branches stamp nothing
- src/judge.ts:546-555 — the `countsSuccess`-gated success stamp; a parse-miss resolve stamps nothing
- src/judge.ts:559-568 — the transport stamp with the real message
- src/judge.ts:838 — `healthMarks` as the trailing 9th parameter of `judgePosts`, exactly the Step-9 correction
- src/judge.ts:868 — pool width = Σ effective caps (capped accounts contribute 1)
- src/index.ts:177 — `judgeHealthPath` defaults to `dirname(statePath)/judge-health.json`, the Step-9 correction
- src/index.ts:276-281 — the marks resolve closes over the derived path; the degraded line resolves above Gate 1
- src/index.ts:449-458 — the catch's load-bearing order: `episodeAlarmDue` reads the PRE-FLUSH snapshot, then `flushExhaustionHealth` opens the bit
- src/index.ts:336 — `flushTickHealth` once after the judge stage; Gate 1 never reaches it
- .github/workflows/watch.yml:161-186 — the `Commit health` step with `if: always() && failure()` and the `-f`-guarded add; the Commit state add grows its own guard (lines 203-205); the timeout budget comment (line 111)
- tests/judge-health.test.ts — 10 describes covering the reader degrade matrix, tick-merge matrix, byte-stability gate, ledger builder, episode lifecycle, and the one-alarm gate's three cases
- tests/judge.test.ts:702-830 — the stamp pins (401 terminal, last-wins, transport, 429-never-stamps, 503-terminal-only, parse-miss) and the all-health-blocked exhaustion with the merged record
- tests/judge-rotation.test.ts:865-905 — the probe saturation, committed-ceiling rejoin, uncapped-ignores-ledger, and streak-1 pins
- tests/email.test.ts:441-540 + tests/heartbeat.test.ts:254-275 — the degraded-line riders and the verbatim exhaustion-reason fixtures
- tests/commit-state-rebase.test.ts:423-470 — the health-only skip and the health+notes abort cases
- tests/index.test.ts:707-846 — the Phase 6 entry-wiring suite added during this validation: the 3-tick acceptance run (streak 1 → cap 2 → probe-success clears and rejoins, 4 dispatches on tick 1, exactly 1 on tick 3, degraded line on the tick-3 digest, marks cleared after), the Gate-1 degraded-line render, and the Gate-1 no-flush pin (ENOENT)
- README.md, AGENTS.md, and all five guidance files — the three-file prose, the module rows, the step, and the third literal

#### Deviations from Plan:

- tests/index.test.ts:707-846 — the Phase 6 test deliverable was missing at validation start (only the import at line 27 and an uncalled `tempHealthPath` helper at line 303 had landed). The three tests were added from the plan's Phase 6 §2 snippets during this run (one cosmetic adaptation: the inert sleep drops the plan snippet's unused `ms` parameter); all pass. The gap is closed; no code deviation remains — the snippets passing unadapted also confirms the production wiring was already correct.
- Plan-text staleness (non-blocking, a plan deviation not an implementation one): Phase 3's automated criterion says `grep -n 'from "./judge-health' src/judge-rotation.ts` returns nothing, but Phase 4's own revision added the type-only `TickOutcomes` import there (the D5 idiom) and Phase 8's corrected prose states the boundary as zero-RUNTIME-import. The shipped code matches the plan's final intent; the Phase 3 criterion text was never updated. `import type` erases at runtime, so the boundary holds.

#### Pattern Conformance:

- ✓ The new module mirrors judge-ceilings.ts's four-piece shape (pure resolver / never-throw reader / atomic writer) with the writer-in-src rationale stated in the header
- ✓ Test structure follows the lazy per-suite mkdtemp idiom (tests/judge-ceilings.test.ts:109-117) and the `includes()`-based email fixture style
- ✓ Import ordering follows Biome's uppercase-first member sort in every touched file
- ✓ The added Phase 6 tests reuse the suite's existing doubles (recordingTransport, judgeFetch, singlePageContextFactory) with no new helper surface

#### Potential Issues:

None — the plan's risk surface (byte-stability, episode lifecycle, one-alarm gate, Gate-1 no-flush, boundary) is fully pinned by the shipped tests.

### Manual Testing Required:

The plan's final Manual item requires live LLM credentials and cannot run offline. The offline-verifiable portions were executed during this validation:

1. Live dead-key run (CREDENTIALS REQUIRED — homework for the operator):
   - [ ] Local run with one deliberately dead key → the alarm names the real cause ("HTTP 401 — key dead"), exit 1, `state/judge-health.json` written atomically
   - [ ] Second consecutive dead tick → warn-only in the log ("outage episode already open — exhaustion alarm suppressed"), still exit 1
   - [ ] First live hosted run materializes and commits `state/judge-health.json` (the `-f`-guarded adds and the `Commit health` step)
   - [ ] A healthy tick clears the episode bit and the streak
2. Offline checks completed during this validation:
   - [x] Episode lifecycle: open / stays-open / clear / re-open pinned at file level (tests/judge-health.test.ts:378-497)
   - [x] One-alarm gate: `episodeAlarmDue` true on absent/closed, false on open (tests/judge-health.test.ts:499-511)
   - [x] Pre-flush read order in the catch verified by inspection (src/index.ts:452-458)
   - [x] Both commit-back adds are `-f`-guarded against the absent-first-run file (.github/workflows/watch.yml:177, 203)
   - [x] Skip-set carries the third literal with suite coverage (scripts/commit-state-rebase.sh:66, tests/commit-state-rebase.test.ts:423)
   - [x] Healthy emails stay byte-identical; the degraded line is absent-when-healthy (tests/email.test.ts:441-478)
   - [x] End-to-end entry wiring executed: streak build, cap, probe-success rejoin, degraded line on the digest, Gate-1 render and no-flush (tests/index.test.ts:707-846)

### Recommendations:

- Ready to commit — implementation is complete and validated. The only remaining item is the credentials-gated live dead-key run, which is operator homework by design.
- `/skill:commit` next: group the validated changes into atomic commits (17 modified files, 2 new source files, the Phase 6 tests, and this validation artifact).
