---
date: 2026-11-08T08:41:24+0700
author: Yogiswara Utama
commit: 32574ad
branch: judge-provider-health
repository: loker-watcher
topic: "Validation of provider-health-module-boundary"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-07_08-49-53_provider-health-module-boundary.md"
tags: [validation, judge-health, judge-rotation, judge, judge-ceilings, email, heartbeat, watch-workflow, commit-state-rebase, probe-freshness]
last_updated: 2026-11-08T08:41:24+0700
---

## Validation Report: provider-health-module-boundary

Second validation run. The first run (2026-11-07_13-36-17, verdict pass) validated Phases 1-8 and closed the Phase 6 test gap. Since then the plan gained Phase 9 (probe freshness gate, added by /skill:revise) and Phase 9's changes sit uncommitted in the working tree. This run re-validated the whole plan at HEAD 32574ad plus the working-tree delta, and executed the plan's final Manual item live (the dead-key run) on this machine.

### Implementation Status

- ✓ Phase 1: Health module — Fully implemented (committed at 89cbd42, re-verified)
- ✓ Phase 2: Health module tests — Fully implemented
- ✓ Phase 3: Rotation fields + inline pick — Fully implemented
- ✓ Phase 4: Judge core stamps + hang arm — Fully implemented
- ✓ Phase 5: Email + heartbeat riders — Fully implemented
- ✓ Phase 6: Entry wiring — Fully implemented (test deliverable closed in the first validation run)
- ✓ Phase 7: Workflow + commit-back — Fully implemented
- ✓ Phase 8: Docs sync + repo-wide gates — Fully implemented
- ✓ Phase 9: Probe freshness gate — Fully implemented (working tree, uncommitted; see Matches Plan)

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean, 0 errors
- ✓ Lint: `npm run lint` — 58 files checked, no fixes applied
- ✓ Tests: `npm test` — 447 tests, 447 pass, 0 fail (444 at the first validation + 1 branch-remote rebase test from da2997f + 2 Phase 9 probedAt cases from the working tree)
- ✓ Phase 9 suite: `npx tsx --test tests/judge-ceilings.test.ts` — 15 tests, 15 pass, including both appended probedAt cases (resolver skip + writer round-trip)
- ✓ Gate wiring: `grep -nE "freshness|28800|probedAt|inputs\.force" .github/workflows/watch.yml` — the Freshness gate step (id: freshness, lines 60-81), the 28800 s literal, inputs.force, and the four step-level `if: steps.freshness.outputs.fresh != 'true'` guards (lines 83, 89, 92, 105)
- ✓ Stamp: `grep -n "probedAt" scripts/probe-judge.ts` — header revision note (line 32), the stamp (line 325), the minus-one count + revised log line (lines 327-328)
- ✓ No repo writes during the suite: `git status --porcelain state/` — empty
- ✓ Working-tree delta confined to the plan's declared write-set: exactly 7 modified paths (.github/workflows/watch.yml, scripts/probe-judge.ts, src/judge-ceilings.ts, tests/judge-ceilings.test.ts, README.md, .rpiv/guidance/.github/workflows/architecture.md, plus the plan artifact itself); no untracked files
- ✓ No regressions detected — all 447 tests green, including the all-429 pin and every pre-health fixture

### Code Review Findings

#### Matches Plan:

- .github/workflows/watch.yml:9-12 — the force dispatch input, verbatim from the plan
- .github/workflows/watch.yml:60-81 — the Freshness gate (8h) step: jq `.probedAt // 0`, the force override, the 28800 s literal, fresh=true/false outputs — verbatim
- .github/workflows/watch.yml:83, 89, 92, 105 — the four probe-side step guards (setup-node, npm ci, Probe judge latency, Commit ceilings)
- .github/workflows/watch.yml:41-48 — the job comment's freshness paragraph, verbatim; the job-level if and the watch job untouched
- scripts/probe-judge.ts:325-328 — `ceilings.probedAt = Math.floor(Date.now() / 1000)` before writeCeilingsAtomic; ceilingCount minus the clock key; the revised log line
- src/judge-ceilings.ts:64 — the `if (key === "probedAt") continue` skip; the module docstring (lines 16-19) and the CeilingsFile comment name the clock key
- tests/judge-ceilings.test.ts:104-120, 224-231 — the two appended cases (adapted to the suite's existing `path()` helper, which the plan pre-authorized)
- README.md:107-112 — the Setup probe paragraph's 8h/force prose
- .rpiv/guidance/.github/workflows/architecture.md:163 — the freshness-gate paragraph (gate step, four guards, green-skip semantics)

#### Deviations from Plan:

- Plan-text staleness (non-blocking, carried from the first run): Phase 3's automated criterion still says `grep 'from "./judge-health' src/judge-rotation.ts` returns nothing, but Phase 4 added the type-only TickOutcomes import there. The shipped boundary is zero-RUNTIME-import, matching the plan's corrected prose; the criterion text was never updated.
- Plan-text compression (non-blocking, discovered by the live run): the final Manual item narrates "local run with one deliberately dead key → alarm … exit 1" as if one or two runs suffice. The shipped design needs a THREE-tick sequence when the dead pool's post volume fills only ONE batch per tick: tick 1 stamps streak 1 (batch deferred whole, exit 0), tick 2 reaches the cap threshold (exit 0), tick 3 runs the capped probe and — only when a SECOND batch then finds the pick dry — trips allHealthBlocked → exhaustion → alarm → exit 1. A single-batch pool never alarms; it accumulates marks and renders the degraded line on heartbeats forever. The implementation matches the plan's own design (defer-whole semantics + the 2-tick cap + the half-open probe); only the Manual item's prose under-describes the tick arithmetic.

#### Pattern Conformance:

- ✓ The Phase 9 test additions follow the suite's lazy mkdtemp idiom; the plan's `freshDir()` sketch was adapted to the existing `path()` helper exactly as the plan instructed
- ✓ The watch.yml additions copy the plan's YAML verbatim (gate step, guards, comment paragraph)
- ✓ The probe script's revision note follows the header's existing revision-note shape

#### Potential Issues:

- Exit-path artifact on Windows + node v24.14.0 (discovered by the live manual run, environment-scoped): on the exhaustion path the entry's `process.exit(1)` aborts with a libuv assertion — `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` — and the process exits 127 instead of 1. Ruling: NOT a blocker for this plan. The failure contract holds (nonzero exit; a workflow step still fails); the generic error path's `process.exit(1)` is clean on the same machine (verified: exit 1), and plain tsx scripts propagate exit 1 correctly — the assertion is specific to the exhaustion branch's pending-handle state under win32 + node 24. The hosted runtime (watch.yml) is ubuntu-latest + node 22, where this was never observed. Follow-up recommended (outside this plan): reproduce under node 22, or convert the exhaustion exit to `process.exitCode = 1` + natural drain.

### Manual Testing Required:

Executed LIVE during this validation (dead-key pool `[{"baseUrl":"https://openrouter.ai/api/v1","apiKey":"sk-dead-manual-verification-key",…}]`, real logged-out Threads walk of tag/hiring, 13 real posts, HEARTBEAT_ENABLED=false, run from a temp cwd so the repo tree stayed untouched; the health file lived at <temp>/state/judge-health.json via the production-derived path):

- [x] Tick 1: real HTTP 401 stamps the streak — batch(es) defer whole, exit 0, file `{"marks":{"https://openrouter.ai/api/v1":1},"outageOpen":false}` written atomically by the success-path flush
- [x] Tick 2: second hard-failed tick reaches the cap threshold — `marks: 2`, still exit 0
- [x] Tick 3: capped account runs the half-open probe — the Degraded line renders (`Degraded LLM account(s): #1 https://openrouter.ai/api/v1 — capped at 1 request/tick`), the second batch trips all-health-blocked, the run FAILS with the real cause (`judge: all 1 LLM_ACCOUNTS account(s) exhausted — account 1 (https://openrouter.ai/api/v1): HTTP 401 — key dead`), the exhaustion flush opens the episode bit (`marks: 3`, `outageOpen: true`), and the alarm branch is entered (with no GMAIL_* set it degrades to `email: exhaustion alarm not sent — email: missing required environment variables: GMAIL_USER, GMAIL_APP_PASSWORD` — the branch executed; delivery needs creds)
- [x] Tick 4: second dead tick is warn-only — `watch: outage episode already open — exhaustion alarm suppressed (one per episode)`, streak grows to 4, bit stays open, nonzero exit
- [x] Atomic-write evidence: the file appeared complete and parseable after every tick (the writer is writeHealthAtomic; the crash-safe semantics are suite-pinned)

Remaining homework (credentials or hosted runner required):

1. Alarm email DELIVERY: repeat the tick-3 shape with real `GMAIL_USER` + `GMAIL_APP_PASSWORD` exported and confirm the inbox email renders `account 1 (https://…): HTTP 401 — key dead` (the record building is fixture-pinned offline at tests/email.test.ts:441-540).
2. Healthy tick clears the episode: after a dead episode, run once with the real `LLM_ACCOUNTS` — any successful dispatch clears `outageOpen` and the streaks (suite-pinned at tests/index.test.ts tick-3 and tests/judge-health.test.ts episode-clear).
3. Hosted first run materializes + commits `state/judge-health.json` (the -f-guarded adds and the Commit health step).
4. Phase 9, fresh window: dispatch watch.yml within 8h of a green probe — "Probe judge latency" absent from the run, job green, watch proceeds on committed ceilings. Requires Phase 9 committed + pushed first.
5. Phase 9, force + red probe: dispatch with force=true (probe runs regardless of the window); a red probe lands no ceilings commit and the next dispatch re-probes.

### Recommendations:

- Ready to commit — Phases 1-9 verified; the only open items are the credentials-gated and hosted-runner homework above.
- /skill:commit next: the working tree holds exactly Phase 9's six deliverable files + the plan revision; group them as one Phase 9 commit (plus the usual state/artifact commits).
- Follow-up (outside this plan): chase the win32/node-24 exhaustion-exit assertion — verify a clean exit 1 under node 22 (CI parity) or switch the catch to `process.exitCode = 1` + natural drain.
