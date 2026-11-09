---
template_version: 1
date: 2026-11-09T07:35:45+0700
author: Yogiswara Utama
commit: 77f44d7
branch: main
repository: loker-watcher
topic: "Validation of Account Availability Check Before Judging"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-08_18-04-00_account-availability-check.md"
tags: [validation, judge-availability, blocked-mask, judge-rotation, judge-health, email, index-wiring]
last_updated: 2026-11-09T07:35:45+0700
---

## Validation Report: Account Availability Check Before Judging

### Implementation Status

- ✓ Phase 1: Availability checker module — Fully implemented
- ✓ Phase 2: Blocked mask on RotationState — Fully implemented
- ✓ Phase 3: Mask through the judge core — Fully implemented
- ✓ Phase 4: Pool-truthful exhaustion wording — Fully implemented
- ✓ Phase 5: Pipeline wiring and the all-down skip — Fully implemented

The run is uncommitted against base 77f44d7. The working tree carries exactly the plan's 10-file write-set (8 modified + src/judge-availability.ts + tests/judge-availability.test.ts) plus the run's own rpiv artifacts. watch.yml and all other tracked files are untouched.

### Automated Verification Results

- ✓ Checker suite: `npx tsx --test tests/judge-availability.test.ts` — 13 pass / 0 fail
- ✓ Rotation suite: `npx tsx --test tests/judge-rotation.test.ts` — 41 pass / 0 fail
- ✓ Judge suite: `npx tsx --test tests/judge.test.ts` — 41 pass / 0 fail (8.2s; the mixed-pool case terminates instantly, no hang)
- ✓ Email suite: `npx tsx --test tests/email.test.ts` — 34 pass / 0 fail
- ✓ Index suite: `npx tsx --test tests/index.test.ts` — 24 pass / 0 fail
- ✓ Whole-repo gates: `npm run typecheck` clean; `npm run lint` clean over 60 files; `npm test` — 484/484 pass, 0 fail (22.0s)
- ✓ Wire helpers exported: `export function normalizeEndpoint` at src/judge.ts:218, `export function terminalFailureReason` at src/judge.ts:346
- ✓ Mask field required: `readonly blocked: ReadonlyMap<number, string>` at src/judge-rotation.ts:89, between `ceilings` and `inFlight`
- ✓ Pick skip line: `state.blocked.has(index)` at src/judge-rotation.ts:200, after the cooldown skip and before the health circuit
- ✓ Defaulted trailing param: `blocked: ReadonlyMap<number, string> = new Map()` at src/judge.ts:873
- ✓ Guard wired: `allAvailabilityBlocked` — exactly 2 matches in src/judge.ts (definition + flavor-split call); `allHealthBlocked` — 0 matches, no dead predicate
- ✓ Pool size rides all three throw sites: `state.accounts.length` — exactly 3 matches in src/judge.ts, all inside `rotationExhausted` calls
- ✓ X-of-N shapes: factory at src/judge-rotation.ts:153; subject pin at src/email.ts:255; the `1 of 2` acceptance case at tests/judge-rotation.test.ts:1074
- ✓ Alarm helper shared: `flushAndSendExhaustionAlarm` — exactly 3 matches in src/index.ts (definition + skip call + catch call); `deps.accounts.length` rides the send at src/index.ts:138
- ✓ Injection sweep total: `availabilityPassAll` — 13 matches in tests/index.test.ts (the double + 12 judge-stage sites)
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- src/judge-availability.ts — the landed module matches the Phase 1 fence: 10s abort constant, probe payload with only model + messages + temperature, Bearer header, judge-vocabulary reasons, two-layer never-throw degrade, no judge-parse import
- src/judge-rotation.ts:89,200 — the mask field and the skip line land in the fence's exact positions; the dispatchability and startAt doc sentences name `blocked`
- src/judge.ts:346-411 — `allAvailabilityBlocked` replaces the health predicate in place; `exhaustionRecord` carries the blocked appendix before the capped one, both loops mark `listed`, stable sort re-establishes pool order
- src/judge.ts:873-899 — defensive copy `blocked: new Map(blocked)` mirrors the `healthMarks` idiom; width reduce returns early on blocked indexes
- src/email.ts:189-258 — pool-truthful header, survivors line by set-difference, X-of-N subject with the /judge pool exhausted/ fragment; legacy branches byte-identical
- src/index.ts:89-145 — the extracted helper owns the pre-flush read, the flush, and the suppress-or-send alarm; the catch keeps `process.exit(1)` and the unsuppressed fallback send
- src/index.ts:373-445 — the pre-check stage sits below Gate 1 and above the judge stage at function level; the all-down skip resolves the exit-0 `WatcherRun`; the mask rides as the 10th `judgePosts` argument
- tests/* — the five planned describes exist as named, with the planned cases: blocked-mask rotation cases (tests/judge-rotation.test.ts:919), wording cases (:961), email copy pins (tests/email.test.ts:387), judge-core mask cases (tests/judge.test.ts:868), the entry-wiring scenarios (tests/index.test.ts:883)

#### Deviations from Plan:

- None requiring action. Two plan-sequencing notes, both designed mid-transition states, both superseded by later phases exactly as the plan scripted them:
  - Phase 2's criterion "`grep blocked: new Map() src/judge.ts` returns one match" reads 0 at the final tree — Phase 3 §5 replaced the stub with the defensive copy `new Map(blocked)`. The final state is the plan's own desired end state.
  - Phase 4's manual item "src/index.ts:473 compiles untouched, keeps today's wording" held mid-run and was replaced by Phase 5's helper wiring, which passes the pool size. The plan names this hand-off explicitly.

#### Pattern Conformance:

- ✓ The checker joins the never-throw degrade family (`loadAccountCeilings`/`loadAccountHealth` shape); the seam lands on `WatcherDeps` beside `judgeCeilings`/`judgeHealth`; the tagged-error idiom is untouched; tests mirror the sibling doubles idiom (fresh `Response` per call, rejecting doubles, no real timers)
- ✓ No drift inside the changed files: renamed terms (`allHealthBlocked`) leave zero stale references in src or tests; every doc comment touched by the plan was updated with the code
- Minor observation (acceptable, non-blocking): the standing guidance docs now lag the landed behavior — `.rpiv/guidance/src/architecture.md` still describes the pick as "cooling AND at-ceiling" with the all-health-blocked arm, and AGENTS.md's module blurbs predate the mask and the `judgeAvailability` seam. Comment-only gap; the repo's guidance-sync pass is the established remedy.

#### Potential Issues:

_Omitted — none surfaced._

### Manual Testing Required:

Performed offline this run (code inspection + suite evidence):

1. Probe payload (Phase 1): verified — body keys are exactly model/messages/temperature (sorted-keys assert in the suite), Bearer header pinned, full-endpoint base URL passes through verbatim (URL assert in the suite).
2. No real network or timers in the new suite (Phase 1): verified — grep finds no `setTimeout`/`setInterval`; every case runs on `fetchReturning`/`fetchByHost`/`fetchRejecting` doubles.
3. Skip line order (Phase 2): verified in src/judge-rotation.ts — cooldown skip → blocked skip → health circuit; a blocked seat never spends the half-open probe (its own test case pins `probedThisTick.size === 0`).
4. Empty-mask equivalence (Phases 2-4): verified — every pre-existing case passes unchanged under 484/484.
5. Blocked appendix outranks the capped appendix (Phase 3): verified by code inspection — the `listed` set makes a capped-and-refused seat render once with the mask reason; the mixed-pool case pins the split rendering.
6. Legacy byte-identity with poolSize absent (Phase 4): verified — the legacy branches keep today's strings; all pre-existing email/rotation cases pass.
7. Pool-truthful wording at both layers (Phase 4): verified — judge layer pins `1 of 2` (a saturated healthy survivor never failed); email layer pins `(2 of 3 accounts failed)` + the survivors line.
8. FR4 / skip shape / no heartbeat (Phase 5): verified — the all-pass injected run completes with today's exact `WatcherRun` plus only the availability log lines; the skip run resolves `{judged: 0, matches: 0, skipped: 2, saved: false}` with zero judge calls, ENOENT on the state file, one alarm email, no heartbeat; two consecutive skips alarm once and preserve the seeded mark.
9. Catch discipline (Phase 5): verified — `process.exit(1)` retained, the bootstrap fault path sends the alarm unsuppressed with legacy wording, watch.yml untouched.

Remaining — live-only, carried from the plan's Testing Strategy (need a real Actions run / real mailbox):

1. [ ] `workflow_dispatch` smoke with one deliberately broken key — that account sits out with its reason, the run completes green on the rest (same-day fix window reserved).
2. [ ] Review a real skip-run email: subject "(3 of 3 accounts failed)", body names each account with its real reason, no survivors line.
3. [ ] Observe the skip-run commit-back subject on the next real all-down tick (cosmetic noise, developer-ratified).

### Recommendations:

- Ready to commit — implementation is complete and validated.
- Fold the mask, `allAvailabilityBlocked`, and the `judgeAvailability` seam into the guidance docs on the next guidance-sync pass.
- Schedule the live smoke (manual item 1) after merge; every prior rotation/health change passed offline and was confirmed by a live run.
