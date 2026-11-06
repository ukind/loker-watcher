---
date: 2026-11-06T11:05:39+0700
author: Yogiswara Utama
commit: 04424f5
branch: main
repository: loker-watcher
topic: "Spread LLM judge load across all accounts using probe-measured per-account ceilings"
confidence: high
complexity: high
status: ready
verdict: pass
tags: [solutions, judge, judge-rotation, judge-ceilings, probe-judge, watch-workflow]
last_updated: 2026-11-06T11:05:39+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Spread LLM judge load across all accounts using probe-measured per-account ceilings

**Date**: 2026-11-06T11:05:39+0700
**Author**: Yogiswara Utama
**Commit**: 04424f5
**Branch**: main
**Repository**: loker-watcher

## Research Question

How should the reactive account rotation in the LLM judge change — in `src/judge-rotation.ts`, `src/judge.ts`, `scripts/probe-judge.ts`, `.github/workflows/watch.yml`, and `scripts/commit-state-rebase.sh` — so every `LLM_ACCOUNTS` entry carries load from the first dispatch, each capped at its probe-measured concurrency ceiling persisted to a committed JSON file, with `JUDGE_CONCURRENCY` superseded? Chained from the discover FRD `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md` and the research `.rpiv/artifacts/research/2026-11-06_10-12-16_llm-account-spread-judge.md`.

## Summary

**Problem**: Every dispatch scans the account pool from account 1 (`pickEligibleAccount`, `src/judge-rotation.ts:84-95`), so the pool spreads only after 429s cool earlier accounts. Single-account concentration is too slow against the 8-minute Actions cap and is the known trigger of the 429 cascade that once left 327 posts unjudged (run 40463798717, superseded by `1a61bf9`).

**Recommended**: Option 1 — Dispatch counter + per-account caps. A state-owned round-robin counter advanced at claim time, an `inFlight` map capped per account at its probe-measured ceiling, a release-waiter queue for ceiling-blocked picks, and a probe-committed ceilings file.

**Effort**: Med-High (~4 days including the mandatory live-dispatch validation window)

**Confidence**: High — four independent codebase-analyzer passes scored all 4 candidates; exactly one cleared the fit filter, and it is the design the FRD checkpoints already settled.

## Problem Statement

**Requirements:**
- Every dispatch starts at the next account (shared counter), so the first N calls hit N distinct accounts (FRD acceptance criterion).
- Each account is capped at its own probe-measured in-flight ceiling, strictly enforced.
- No overall concurrency clamp — total in-flight = Σ per-account ceilings.
- Ceilings persist to a committed flat `{baseUrl: ceiling}` JSON file written by the probe job (live-only readings, written before the dead-account gate).
- Missing ceiling → ceiling 1 per account + exactly one warning; the run never fails on the ceilings file.
- The 180s park budget and the pool-exhaustion alarm stay unchanged and exclusive to cooldown parks.
- `JUDGE_CONCURRENCY` is superseded.

**Constraints:**
- Strict TS flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) stay on.
- Sync-window doctrine: every cross-worker observation happens between two awaits of the observing worker; no locks.
- Terminal outcomes are returned from the dispatch core, never thrown inside it (D6); the tagged error is thrown only at wrapper level.
- Offline, deterministic tests (node:test + tsx); injected clocks, never mock.timers.
- Single-writer-per-file doctrine for `state/` artifacts; atomic writes only.
- Fail visible for operator config; degrade-never-throws for measured data files.

**Success criteria:**
- `tests/judge-rotation.test.ts` acceptance: 50 posts over 5 accounts → first 5 judge calls hit 5 distinct accounts.
- Per-account peak in-flight ≤ its ceiling across both judge phases, asserted with a per-host peak recorder.
- An absent ceilings entry yields ceiling 1 + exactly one console warning naming the baseUrl, with unchanged judged output.
- All three gates green: `npm run typecheck && npm run lint && npm test`.
- One live `workflow_dispatch` run: probe job commits ceilings cleanly; the next watch run consumes them; no 429 storm in the judge logs.

## Current State

**Existing implementation:**
- `RotationState` (`src/judge-rotation.ts:41-48`) carries exactly `accounts`, `cooldownUntil: Map<number, number>`, `waitBudgetRemainingMs`. Constructed once per run in `judgePosts` (`src/judge.ts:691-695`), shared by reference with both pools (`src/judge.ts:708-714`, `:777-789`).
- The pick is synchronous and pre-await: `dispatchLlmCall` calls `pickEligibleAccount(state, now())` at `src/judge.ts:378` — the single production pick site. First-fit from index 0 (`src/judge-rotation.ts:84-95`); `undefined` ⟺ every account cooling.
- 429 → `coolAccount` (first-write-wins 60s, `src/judge-rotation.ts:103-112`) + rewind that spends no attempt (`src/judge.ts:402-413`); 5xx → same-account backoff [1s, 2s, 4s]; transport error → nothing cools.
- Pick-undefined → `parkUntilEligible` (`src/judge-rotation.ts:143-176`): charge-before-sleep against the shared 180s budget (`WAIT_BUDGET_MS`, `src/judge.ts:109`), wake at earliest cooldown expiry + 500ms jitter. Spent budget → `{status: "exhausted"}` → tagged `RotationExhausted` at three sites (`src/judge.ts:643-646`, `:726-730`, `:804-805`) → `src/email.ts:181-209` → `src/index.ts:392-400` (alarm + exit 1).
- Width today: one scalar `concurrency` (`DEFAULT_JUDGE_CONCURRENCY = 4`, `src/judge.ts:68`), fed from `JUDGE_CONCURRENCY` at `src/index.ts:276`, pinned in `watch.yml:102`, consumed by both pools, clamped per pool by `Math.min(width, items.length)` (`src/pool.ts:50`).
- The probe already measures a per-account ceiling (`findConcurrencyCeiling`, `scripts/probe-judge.ts:133-156`, domain {0, 1, 2, 4}) but only prints it (`:233-235`); it has no write path and no test suite.

**Relevant patterns:**
- Sync-window cursor claim: `src/pool.ts:42-45` (read-advance-bounds-check, no await between) — the exact idiom a round-robin counter needs; `RotationState`'s docblock (`src/judge-rotation.ts:33-38`) already names this shared-mutable pattern.
- Required-mutable-scalar precedent: `waitBudgetRemainingMs` — the last interface reshape added exactly such a field (`.rpiv/artifacts/plans/2026-10-27_17-55-19_per-batch-llm-rotation.md:95`); required fields make `tsc --noEmit` enumerate all three construction literals (`src/judge.ts:691-695`, `tests/judge-rotation.test.ts:37-45`, `tests/judge.test.ts:15-23`).
- Reader doctrine map: fail-visible (`loadWatcherConfig`, `src/config-file.ts:50-85`) / ENOENT-only degrade (`loadState`, `src/state.ts:135-161`) / degrade-everything (`readPayloadPosts`, `src/linkedin-payload.ts:116-231`) — the ceilings reader is a new fourth doctrine (committed file, degrade-everything, per-account warn).
- Atomic write shape to clone: `writeStateAtomic` (`src/state.ts:125-181`), `writePayloadAtomic` (`src/linkedin-payload.ts:90-113`).
- Commit-back machinery to reuse: `scripts/commit-state-rebase.sh` (skip-set `:47-51` is a single-literal equality needing set semantics), watch-job commit step (`watch.yml:114-133`).

**Integration points:**
- `src/judge.ts:378` — the one pick site; claim lands between `:391` and `:392` (same sync window as the pick), release in a `try/finally` around the attempt body.
- `src/judge.ts:691-695` — the sole production `RotationState` construction; grows the new required fields.
- `src/index.ts:268-280` — the `judgePosts` call site; the ceilings resolution seam (mirrors `linkedinFetch` dep injection at `src/index.ts:115-116`/`:155`/`:202`).
- `scripts/probe-judge.ts:223`/`:233-235`/`:238-243` — ceiling computed, printed, dead-gated: the write lands after `:233` and before the gate.
- `.github/workflows/watch.yml:24-45` — probe job: gains `fetch-depth: 0`, bot identity, ceilings-only add + commit-state-rebase.sh.
- `scripts/commit-state-rebase.sh:47-51` — skip-set equality → per-line set membership over `{state/seen-posts.json, <ceilings path>}`.

## Solution Options

### Option 1: Dispatch counter + per-account caps (release-waiters, probe-committed ceilings)
**How it works:**
`RotationState` grows required members: `ceilings: Map<number, number>`, `inFlight: Map<number, number>`, a dispatch-sequence scalar, and a release-waiter queue. The pick starts its scan at `counter % N`, advances the counter only on a fresh claim (claim-time-only advance, zero-based first claim), and returns `undefined` only when every account is cooling-or-at-ceiling. Ceiling-blocked dispatches await a deferred resolved by the next release decrement — zero budget charge; `coolAccount` also resolves waiters. Claims sit in the pre-await sync window (`src/judge.ts:391-392`); releases run in a `try/finally` around the attempt body. The probe writes a live-only `{baseUrl: ceiling}` map before its dead gate and its job commits it via `commit-state-rebase.sh`.

**Pros:**
- Strong precedent for the mutation idiom: `runPool`'s read-advance claim (`src/pool.ts:42-45`) is the same sync-window pattern the counter needs; the state module already owns all rotation mutation (`src/judge-rotation.ts:1-5`).
- The single pick site (`src/judge.ts:378`) makes the test rewrite list exhaustive and the counter-span question decidable (state-owned field spans both judge phases for free — the wait budget is the precedent for a cross-phase cell, `tests/judge-rotation.test.ts:256-290`).
- Compile-forced mirrors: required fields make `tsc --noEmit` enumerate all three construction literals — the repo's mechanism for keeping test copies honest.
- Reachability is free: the counter scan visits all N accounts before returning undefined; spare capacity needs no extra logic.

**Cons:**
- Largest new mechanism: the release-waiter queue has no in-repo precedent (the only primitives today are the pool cursor and the cooldown map).
- Seven exit paths in `dispatchLlmCall` must release — a missed path permanently consumes a slot (mitigated mechanically by `try/finally`; the 429 rewind's explicit release/re-claim cycle is documented at `src/judge.ts:407-411`).
- ~300–550 lines across ~7 files including tests.

**Complexity:** Med-High (~4 days)
- Files to create: 2 (`src/judge-ceilings.ts`, its test suite) (~200 lines)
- Files to modify: ~7 (`src/judge.ts` ~+40, `src/judge-rotation.ts` ~+100, `src/config.ts` +5, `src/index.ts` +3, `scripts/probe-judge.ts` +20, `watch.yml` +12, `scripts/commit-state-rebase.sh` +5, plus 4 test files ~+280)
- Risk level: Medium (the waiter queue and the probe-job commit are the two genuinely new surfaces)

### Option 2: Busy-until stamping (reuse the cooldown park)
**How it works:**
Stamp `now + REQUEST_TIMEOUT_MS` (60s) into a per-account map at claim time so `parkUntilEligible` wakes on the earliest busy-until; no waiter queue — ceiling waits ride the existing park machinery.

**Pros:**
- The pattern exists verbatim: `coolAccount` already stamps absolute-until timestamps into a shared per-account map; `parkUntilEligible` already wakes on earliest expiry + jitter; under a shared map the park math is untouched (`src/judge-rotation.ts:103-112`, `:142-167`).
- Smallest new-state footprint (~20–50 core lines).

**Cons:**
- A pessimistic 60s stamp without early wake serializes the pool: a call completing in 5s holds its account for 60s, every subsequent claim parks — ordinary width-4 runs drain the shared budget ~3× per wave toward the 480s job cap (`watch.yml:66`).
- Release-on-completion is therefore not optional — but even with release, the mechanism enforces **one** in-flight per account; reaching the probe-measured ceiling of 4 "needs multiple stamp slots or a counter — machinery the candidate does not spell out". It collapses to ceiling 1 or grows into Option 1.
- Budget semantics falsified: ceiling parks charge `WAIT_BUDGET_MS` (docblock scopes it to "parked on *cooling* accounts", `src/judge.ts:96-109`) → false exhaustion alarm on healthy runs, with a fabricated `"HTTP 429"` reason (shared-map variant, `src/judge-rotation.ts:124`) or an empty, email-silent record (separate-map variant, `src/email.ts:181-182`, `:208-209`).
- Claim-time stamping shifts the pinned park arithmetic: `tests/judge-rotation.test.ts:541-586` expects `[60_400]`, re-derives to `[60_300]`; `:291-322` ("never parks while an account is eligible") breaks without release.

**Complexity:** Low-Med initially, Medium once fixed (~2–3 days) — but the fix directions all converge on Option 1's parts
- Files to create: 1–2
- Files to modify: ~5
- Risk level: High (false alarms on healthy runs are the exact FRD non-goal)

**Fit verdict: BLOCKED.** Integration-risk is disqualifying: budget drain → false exhaustion alarm, and fabricated/empty exhaustion records violate the non-empty-by-construction docblock (`src/judge-rotation.ts:112-125`). This independently re-confirms the research checkpoint's recorded rejection.

### Option 3: Per-account lanes (one pool per account, width = ceiling)
**How it works:**
Partition batches into per-account queues; run one `runPool` per account at that account's ceiling. Caps are enforced structurally by pool width — no pick scan, no in-flight map, no counter.

**Pros:**
- `runPool` is already generic over width (`src/pool.ts:36-49`) — zero pool changes; caps need no runtime state.
- The probe already computes per-account ceilings (`scripts/probe-judge.ts:140-157, :220-227`).

**Cons:**
- No multi-pool-per-phase pattern exists anywhere in the repo (all five `runPool` call sites pass one constant width); the partition layer + lane-mode dispatcher rewrite is ~150–300 lines concentrated in `judgePosts` and the shared `dispatchLlmCall`.
- Work migration disappears — the documented 429 model (`src/judge-rotation.ts:5-8`) is deleted: a 429-cooled account idles its lane's entire ceiling during exactly the episode where spread matters; the lane must park on its own cooldown (amplifying the budget up to M×) or defer whole.
- Fallback tail-starvation guarantee (`src/judge.ts:773-776`, pinned `tests/judge.test.ts:410-437`) and pool-ordered exhaustion records (`[1,2,3]` pinned at `tests/judge-rotation.test.ts:491-495`) both need re-derivation under per-lane budgeting.
- Broadest test invalidation: 7 of 10 rotation tests rewritten or inexpressible (`tests/judge-rotation.test.ts:457-507` cannot be expressed under lanes), 4+ width pins rewritten, plus a fresh suite for partition/budget math.

**Complexity:** Med-High (~4 days) with strictly less delivered spread than Option 1
- Files to create: 2–3
- Files to modify: ~8
- Risk level: High (dispatcher semantics rewrite shared by both judge phases)

**Fit verdict: BLOCKED.** Integration-risk (429 rewind semantics, budget amplification, starvation re-derivation) and precedent-fit (no pattern; doctrine deletion) both surface blocking concerns.

### Option 4: Reactive rotation + raised `JUDGE_CONCURRENCY` (incumbent tweak)
**How it works:**
Keep scan-from-0 + 429 cooling exactly as today; set `JUDGE_CONCURRENCY` in `watch.yml:102` to a hand-summed Σ of per-account ceilings (e.g. `"20"` for 5×4). Zero code edits.

**Pros:**
- Cheapest possible adoption: 1 file, ~2–7 lines; the entire test suite stays green unchanged (no test reads `watch.yml`).
- The width-paste pattern is first-class with three prior landings (`73d6786`, `5f6a328`, `7cc7250`).

**Cons:**
- Structurally cannot meet the acceptance criterion: with no 429s, the first 5 calls all land on account 1 (pinned by the transport pin "the scan never moved", `tests/judge-rotation.test.ts:428-445`). Meeting the AC's letter would require *inducing* the very 429s the criterion exists to avoid.
- Re-creates the `7cc7250` failure at 2.5–5× amplitude: pre-await synchronous pick → every worker in a 20-wide wave resolves account 1 before anyone dispatches; the 429 funnel then cascades the whole pool, and the budget arithmetic (180s ≈ 3 × 60s parks; the 4th+ parker false-trips) makes a false exhaustion alarm near-certain under any transient all-429 window.
- The Σ value has no automated source — the probe prints ceilings but writes nothing; the paste is a manual log-sum step caught only by the positive-integer parser, never by the limiter. watch.yml runtime values broke on first land twice (`7cc7250`, `1c8a68c`).

**Complexity:** Low (~0.5 days) — and purchases none of the goal
- Files to create: 0
- Files to modify: 1 (`watch.yml`)
- Risk level: High

**Fit verdict: BLOCKED.** Integration-risk is disqualifying (burst amplification + near-certain false alarm) and the defining goal is unmeetable by construction.

## Comparison

| Criteria | 1. Counter + caps | 2. Busy-until | 3. Lanes | 4. Reactive + width |
|----------|----------|----------|----------|----------|
| Complexity | M-H | L-M (grows to M-H when fixed) | M-H | L |
| Codebase fit | H (sync-window idiom, state-module ownership, compile-forced mirrors) | M (pattern exists; semantics contradict budget docblock) | L (no multi-pool precedent; doctrine deletion) | H for the knob, L for the goal (first-fit is pinned doctrine) |
| Risk | M (two new surfaces, both with designed answers) | H (false alarm on healthy runs) | H (dispatcher rewrite, capacity loss under cooldowns) | H (burst amplification, near-certain cascade) |
| Meets the acceptance criterion | Yes | No (ceiling-1 collapse) | Yes (but loses spread under 429 episodes) | No (structurally) |

## Recommendation

**Selected:** Option 1 — Dispatch counter + per-account caps.

**Rationale:**
- The only candidate that clears the fit filter: no kept dimension surfaces a blocking concern. Each flagged risk maps to a designed answer already settled at the FRD checkpoints — required state fields (compile-forced mirrors), pre-await claim + `try/finally` release (leak audit shows every exit covered), wake-on-release with zero budget charge (exhaustion stays cooldown-only; the alarm path is untouched), probe commits live-only readings before the dead gate (untrusted readings take the ceiling-1+warn degrade path), and the skip-set generalizes to set membership.
- Evidence converged across four independent analyzer passes and the research doc, both grounded at the same commit (`04424f5`): the pick site count is exactly 1, the construction-literal count is exactly 3, the falsified test set is enumerated line-by-line, and the retirement inventory for `JUDGE_CONCURRENCY` is complete.
- It is the direct continuation of the repo's own arc: `869feed` (reactive rotation) → `1a61bf9` (per-batch rotation after the cascade) → this feature (proactive spread). The precedent lessons transfer unchanged: sync-before-await, injected clocks, sentinels-not-throws, non-empty failure records.

**Why not alternatives:**
- Option 2 (busy-until): false-exhaustion alarms on healthy runs are the FRD's explicit non-goal; the mechanism cannot express per-account ceilings above 1 without becoming Option 1 with more seams. The research checkpoint rejected it; the fit analysis independently re-derived the same blockers with line evidence.
- Option 3 (lanes): enforcing caps structurally costs the 429 migration model — a cooled account idles its lane exactly when spread matters most; starvation and exhaustion-record ordering need full re-derivation; broadest test invalidation.
- Option 4 (raised width): cheapest and delivers nothing — the acceptance criterion is unmeetable under first-fit, and it amplifies both documented live failures (`7cc7250` burst, `1a61bf9` cascade).

**Trade-offs:**
- Accepting a new concurrency primitive (release-waiter queue with no in-repo template) in exchange for even load spread from the first dispatch and strict per-account burst safety.
- Accepting ~10-minute staleness of ceilings (probe commits reach the next run; jobs stay parallel — `needs:` was rejected because it would skip watch on cron ticks) in exchange for never blocking the 10-minute lane. A stale optimistic ceiling costs throughput, never correctness — the 429 rotation remains the net (`7cc7250` lesson).
- Accepting that a combined conflicted commit drops both deltas (skip granularity is one whole commit, `scripts/commit-state-rebase.sh:55`) in exchange for reusing the battle-tested commit-back script; the next probe run re-measures — the F021 accepted-cost doctrine extends naturally.

**Conditions that would change the recommendation:**
- If the release-waiter queue proves untestable offline (a determinism wall the injected-clock harness cannot cross), fall back to Option 3's structural caps (per-account lanes) and accept the cooldown-idle cost.
- If the probe-job commit fails live validation twice, hand-paste ceilings as a static committed literal (Option 4's persistence mechanism, without its width raise) until the git plumbing stabilizes.

**Implementation approach:**
1. Ceilings module — `src/judge-ceilings.ts`: pure `resolveCeilings(accounts, parsed | undefined)` (index-keyed map + warnings; absent account → ceiling 1 + one warning; shared-baseUrl entries share silently) + fs wrapper with cwd-relative path constant beside `STATE_PATH`/`LINKEDIN_PAYLOAD_PATH` in `src/config.ts`; the probe's ceilings writer exported from `src/` so it is unit-testable (no `tests/probe-judge.test.ts` exists); atomic write per `writeStateAtomic` shape.
2. Rotation state extension — required new members on `RotationState`; counter advance at claim (claim-time-only, zero-based); claim between `src/judge.ts:391-392`; `try/finally` release across all seven exits; release-waiter queue resolved on release decrement; `coolAccount` also resolves waiters; rewrite the five falsified reactive-order pins and docblocks (`src/judge.ts:676-680`, `src/judge-rotation.ts:34-40`).
3. Width derivation — Σ per-index ceilings derived inside `judgePosts` from state; retire the `JUDGE_CONCURRENCY` chain per the inventory (registry `src/config.ts:22`, parser `src/judge.ts:194-209`, feed `src/index.ts:276`, param `src/judge.ts:687`, literal `watch.yml:102`, plus module docblock and wave-math comment `watch.yml:50-55`).
4. Workflow wiring — probe job gains `fetch-depth: 0` (`watch.yml:34`), bot identity, ceilings-only add + `commit-state-rebase.sh`; generalize the script's skip-set (`:47-51`) to per-line set membership; add the script's third `advanceOrigin` arm + ceilings-skip test + two-line-conflict fixture; re-sync the guidance fence `.rpiv/guidance/src/architecture.md:59-64`.
5. Validation — three gates, then one `workflow_dispatch` smoke run against the real endpoint with a same-day fix window (the composite lesson: offline tests passed both prior times; live runs caught the real failure).

**Integration points:**
- `src/judge-rotation.ts:41-48` — `RotationState` grows `ceilings`, `inFlight`, counter, waiters (all required members)
- `src/judge-rotation.ts:84-95` — `pickEligibleAccount` becomes counter-aware and ceiling-aware
- `src/judge-rotation.ts:103-112` — `coolAccount` gains waiter resolution
- `src/judge.ts:391-392` — claim placement (pre-await sync window); `try/finally` release around the attempt body `:392-461`
- `src/judge.ts:691-695` — state construction grows the new fields; width becomes Σ ceilings derived from state
- `src/index.ts:268-280` — ceilings resolution replaces the `parseJudgeConcurrency` feed (seam via `WatcherDeps`, `src/index.ts:115-116` template)
- `src/config.ts:52-81` — new path constant with the `LINKEDIN_PAYLOAD_PATH` single-writer doc-comment doctrine
- `scripts/probe-judge.ts:223-243` — ceilings write after the summary line, before the dead gate, awaited before exit
- `.github/workflows/watch.yml:24-45` — probe job commit step; `:102` literal deleted
- `scripts/commit-state-rebase.sh:47-51` — skip-set → per-line set membership; `:24-27` deviation ledger grows its second entry

**Patterns to follow:**
- Sync-window read-advance claim: `src/pool.ts:42-45`
- Cross-phase mutable cell on state: `waitBudgetRemainingMs` (`src/judge-rotation.ts:46-49`, shared-cell test `tests/judge-rotation.test.ts:256-290`)
- Degrade-never-throws reader with injected `now`: `readPayloadPosts` (`src/linkedin-payload.ts:116-231`)
- Pure-core/wrapper split: `loadWatcherConfig`/`validateConfig` (`src/config-file.ts:50-85`)
- Atomic write: `writeStateAtomic` (`src/state.ts:125-181`)
- Dep-seam injection with fs-reading default: `linkedinFetch` (`src/index.ts:115-116`, `:155`, `:202`)
- Commit-back via tested script: watch job's Commit state step (`watch.yml:114-133` → `scripts/commit-state-rebase.sh`)

**Risks:**
- Slot leak on one of seven `dispatchLlmCall` exits: mitigated by a single `try/finally` around the attempt body (release placement is post-await-safe; only the claim is window-bound) + a leak-audit test driving each exit path.
- False exhaustion alarm from ceiling waits: eliminated by design — waiters charge zero budget and the three exhaustion conversion sites stay cooldown-only; pin the steady state (all-at-ceiling backlog parks indefinitely without alarm) with a dedicated test.
- Probe-commit git plumbing on first land: the state commit-back needed 5 fix commits in 3 days (`89c8bc5`→`bc760cb`). Mitigation: reuse the tested script, budget the live-dispatch validation with a same-day fix window.
- Stale/optimistic ceilings: never a correctness failure — 429 rotation remains the net; dead accounts contribute no entry and take the ceiling-1+warn degrade path by design.

## Scope Boundaries
- Building: proactive spread (counter), strict per-account in-flight caps, release-waiter wake, ceilings file + probe persistence + probe-job commit, `JUDGE_CONCURRENCY` retirement, park-budget/exhaustion semantics preserved for cooldowns only.
- NOT doing: staleness bounds on the ceilings file (settled: none — dispatch-only cadence makes days-old readings legitimate); changing the 180s budget, `WAKE_JITTER_MS`, or the exhaustion alarm; touching fallback-phase `FALLBACK_CALL_BUDGET` semantics (already ceiling-safe by check ordering, `src/judge.ts:778-780`); an E2E harness for single-credential env vars (FRD follow-up, unverified this session).

## Testing Strategy

**Unit tests:**
- Acceptance: `fiveAccounts()` fixture (5 distinct hosts, into `tests/judge-helpers.ts`) + 50 posts → 5 batches; assert `new Set(auths.slice(0, 5)).size === 5`.
- Caps: per-host peak recorder (the `measuredFetch`/`bulkMissThenAnswer` pattern, `tests/judge.test.ts:111-159`) across BOTH phases (bulk-miss double so the fallback drain participates); assert every host's peak ≤ its ceiling.
- Counter conventions: claim-time-only advance (post-park retry pin `tests/judge-rotation.test.ts:582` stays green), zero-based first claim, state-owned across phases.
- Waiter semantics: all-at-ceiling steady state parks indefinitely with zero budget charge and no alarm; release wakes exactly one waiter; a fresh `coolAccount` stamp resolves waiters into a legitimate budget-charging cooldown park.
- Exhaustion records stay pool-ordered `[1,2,3]`/`[1,2]`/`[1]` (`tests/judge-rotation.test.ts:471-483`, `:340-345`, `:617-621`) and the end-to-end pin `tests/index.test.ts:428-467` stays green.
- Cooldown-skip precedence: new fixture where the *designated* account is the cooling one (current coverage lands on account 2 either way).
- Ceilings module: pure `resolveCeilings` (absent → 1 + one warning; malformed → degrade + warn; shared-baseUrl silent share; `.trim()` key normalization) with the console-spy idiom (`t.mock.method(console, "warn", ...)`, `tests/env-file.test.ts:61-71`); fs wrapper cwd-resolution via `mkdtemp` + one `after()` (`tests/state.test.ts:22-27` idiom).
- Width pins re-pinned to per-account peaks (`tests/judge.test.ts:343-437` — all currently on `singleAccount`, which survives iff a 1-account pool's resolved ceiling equals the passed width); `parseJudgeConcurrency` describe deleted with the parser.
- Script: third `advanceOrigin` arm + ceilings-skip test + two-line-conflict fixture in `tests/commit-state-rebase.test.ts` (`:74-282` patterns).

**Integration tests:**
- The offline suite covers the full judge pipeline through `judgePosts` with recording fetch fns (offline, deterministic, host-branching recorders — `tests/judge-rotation.test.ts:44-70` idiom).

**Manual verification:**
- [ ] One `workflow_dispatch` run: green probe commits the ceilings file cleanly to main (first-land git plumbing risk).
- [ ] Next scheduled run reads the committed ceilings; judge logs show spread from the first wave and no 429 storm; run completes inside the 8-minute cap.
- [ ] Heartbeat/digest emails still render when the pool cools (cooldown path untouched).

## Open Questions
**Resolved during research:**
- Staleness bound on the ceilings file? — None; flat `{baseUrl: ceiling}` map, no `writtenAt`. The probe runs dispatch-only so readings legitimately age for days; 429 rotation is the correctness net (research checkpoint).
- Same-run freshness impossible? — Settled: the probe job commits; watch reads next-run (~10 min later); `needs:` rejected because cron ticks would skip watch without an `if:` guard (`watch.yml:25`).
- Ceiling-blocked wait semantics? — Wake on release, zero budget charge; `coolAccount` also resolves waiters (research checkpoint; fit analysis found no contradicting evidence).
- Write timing vs the dead gate? — Live-only, written before the gate (`scripts/probe-judge.ts:238-243`); dead accounts take the ceiling-1+warn degrade path.
- RotationState field optionality? — Required members; strict TS compile-enumerates all three construction literals; no whole-object assertions exist to break.

**Requires user input:**
- `JUDGE_CONCURRENCY`: delete outright (research recommendation — an unused `ENV_NAMES` entry recreates the F024 pathology) or leave unused. Default for planning: delete outright.

**Blockers:**
- None blocking implementation. The probe-job commit mechanics need live validation on the first dispatch (green probe must push cleanly before any cron tick depends on the reading) — scheduled as implementation phase 5, not a prerequisite.

## References

- `.rpiv/artifacts/research/2026-11-06_10-12-16_llm-account-spread-judge.md` - the input research: current-state map, checkpoint decisions, falsified-test enumeration, retirement inventory
- `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md` - the input FRD: acceptance criteria, settled decisions, non-goals
- `.rpiv/artifacts/plans/2026-10-27_17-55-19_per-batch-llm-rotation.md` - the rotation plan: four invariants and the RotationState reshape precedent
- `.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md` - D1' (rejected wrapper carrier), the peak-recorder test precedent (:725-775)
- `.rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md` - F010 split manifest, F018 dual-site guard rationale, live-dispatch validation doctrine (:62)
- `src/judge.ts:346-475` - the dispatch core: single pick site, seven exits, the sync window the claim must sit in
- `src/judge-rotation.ts:41-176` - the state module: maps, park, cooldown machinery the candidate extends
- `scripts/probe-judge.ts:133-156, :223-243` - ceiling measurement and the write-before-gate landing zone
- `.github/workflows/watch.yml:24-45, :114-133` - probe job (commit step lands here) and the commit-back step to reuse
- `scripts/commit-state-rebase.sh:47-51` - the skip-set equality to generalize
- Commit arc `869feed` → `1a61bf9` → `7cc7250` → `b779ff7` - the rotation and commit-back history this feature builds on
