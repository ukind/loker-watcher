---
date: 2026-10-27T16:40:05+0700
author: Yogiswara Utama
commit: 6b9dae4
branch: main
repository: loker-watcher
topic: "per-batch LLM account rotation"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, judge, rotation, cooldown, probe, concurrency]
last_updated: 2026-10-27T16:40:05+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: per-batch LLM account rotation

**Date**: 2026-10-27T16:40:05+0700
**Author**: Yogiswara Utama
**Commit**: 6b9dae4
**Branch**: main
**Repository**: loker-watcher

## Research Question
Ground the discover FRD `.rpiv/artifacts/discover/2026-10-27_14-08-35_per-batch-llm-rotation.md` in the live code: replace the run-sticky rotation pointer with a batch-local cursor plus a shared 60s cooldown map, add a 5-minute in-run wait budget, keep the exhaustion alarm contract unchanged, and make `scripts/probe-judge.ts` probe every account. Three candidate solution shapes were scored on five dimensions with file:line evidence.

## Summary
**Problem**: Run 40463798717 proved the run-sticky pointer turns a momentary burst-429 into total pool death in one hop (327 posts unjudged). The fix must ride out rate limits per batch instead of per run.
**Recommended**: In-place cooldown map — `RotationState` swaps `index` for a `cooldownUntil` map plus a budget cell; the FRD's named mechanism, implemented with zero new files and zero caller-visible side effects.
**Effort**: Med (~2-3 days including the probe rewrite, the test rewrite, and a post-land validation run the precedent history demands).
**Confidence**: High — all anchors verified against the current commit by three independent agent passes; line numbers match the research doc (one drift found: `AbortSignal.timeout` cites are live at `src/judge.ts:452`/`:561`, not `:446`/`:568`).

## Problem Statement

**Requirements:**
- Rotation restarts at account 1 every batch; a 429'd account cools for a flat 60 seconds.
- When every account is cooling, the run waits (in-loop park) up to a 5-minute cooldown-wait-only budget.
- Budget expiry throws the existing `RotationExhausted` with a synthesized, non-empty, pool-ordered failure record; alarm email + exit 1 unchanged.
- `scripts/probe-judge.ts` probes every account; `watch.yml:21` flips `continue-on-error: true` to gating.

**Constraints:**
- Hard: the in-loop park is a locked decision (frame requeue rejected at the research checkpoint); the defer-unanswered rule (`src/judge.ts:689-696`) is pinned untouched; fail-visible is a repo non-negotiable; strict TS flags stay on (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); no new runtime dependency without a stated PR-description need.
- Soft: 60s cooldown and 5-minute budget stay module constants unless probe-measured (repo convention: `FALLBACK_CALL_BUDGET`, `src/judge.ts:31-50`); the 8-minute job envelope race (`watch.yml:47`) is documented, not solved, in this change.

**Success criteria:**
- Restart proof: stamp account 1, tick 60s, the next batch lands back on account 1 (FRD acceptance bullet 1).
- All-cooling park completes the backlog with zero real delay under injected time (bullet 2).
- Budget-exhausted run sends exactly one alarm with a complete record and exits 1 (bullet 3).
- Probe run turns red when any account is dead (bullet 5).

## Current State

**Existing implementation:**
- `RotationState` (`src/judge.ts:92-96`): `accounts` / mutable `index` / `failures`; created once in `judgePosts` (`:644`), shared by reference with every worker (`:656-666`, `:720-747`).
- The CAS `rotateOnRateLimit` (`:377-390`): pointer-compare (`:378`), push-before-advance (`:381-385`), sole `index` write (`:387`), boolean return (`:389`). Run-sticky: one 429 moves the run off an account permanently.
- Dispatch-time pointer reads (`:431` bulk, `:543` post) sit before the first await — the "read and advance with no await between" discipline (`:87-91`, `:425-430`) is the only concurrency guard. No locks, no clock reads today.
- Exhaustion chain: `rotationExhausted()` (`:109-118`) → throw sites (`:546`, `:571`, `:674`, `:749`) → catch in `runWatcher` (`src/index.ts:296-313`) → best-effort email (`src/email.ts:182-194`) → `process.exit(1)` (`:311`).
- `src/judge.ts` reads no clock; the only timing constructs are `AbortSignal.timeout(60_000)` (`:452`/`:561`) and module-private `sleep` (`:76-77`, sole consumer `:479`).

**Relevant patterns:**
- Closure-shared mutable cells: 6 today (`state.index`, `state.failures`, bulk `next` `:655`, fallback `next`/`budget`/`exhausted` `:717-719`) — all guarded by the sync-window discipline, none by locks.
- Trailing-param DI: ~9 clock seams (`filterRecent` `src/recency.ts:14-18`, `timeStage` `src/index.ts:83-90`, `WatcherDeps.now` `src/index.ts:112-113`, `heartbeat` `src/heartbeat.ts:152`, four in `src/state.ts` `:142/:196/:212/:245`) plus `fetchFn` threading inside judge.ts (`:538`, `:641-642`, internal `:412-417`).
- Mock convention: URL-branching fixtures (`twoAccounts()` `tests/judge.test.ts:28-33`, `accountTwoAnswering` `:50-70`) — load-bearing now that dispatch order is timing-dependent.

**Integration points:**
- `src/index.ts:192-205` — the sole production `judgePosts` call site (forwards `deps.fetchFn`, concurrency; would forward `deps.now`).
- `src/index.ts:296-313` — the exhaustion catch consuming `error.failures` verbatim.
- `tests/judge.test.ts` — 20+ direct `judgePosts`/`judgePost` calls; `freshState` (`:45-48`) has 5 construction sites.
- `scripts/probe-judge.ts:163-171` — `resolveJudgeConfig(process.env)[0]`: the first-account-only probe.
- `.github/workflows/watch.yml:16-26` — dispatch-only probe job; `continue-on-error: true` (`:21`) with an accounts[0]-only rationale (`:18-20`).

## Solution Options

### Option 1: In-place cooldown map (RECOMMENDED)
**How it works:**
`RotationState` (`src/judge.ts:92-96`) drops `index` and `failures` and gains `cooldownUntil: Map<number, number>` plus a required `waitBudgetMs` cell, both initialized in the `judgePosts` frame (`:644`). The CAS (`:368-390`) becomes a ~10-line map guard (write only if not already cooling with a later-or-equal expiry). A park helper sits inside both retry loops on "no eligible account" — same shape as the 5xx backoff (`:473-481`). At budget expiry, a synthesizer builds the failure record from the final map in pool order and throws through the existing exhaustion plumbing.

**Pros:**
- Implements the FRD's named mechanism (batch-local cursor + shared cooldown map) with no shape deviation; evidence: research doc framing + `rotateOnRateLimit` replacement study.
- Assembled entirely from the repo's two dominant idioms: by-reference shared frame state (`:644` → `:663`/`:741`) and trailing defaulted params — 12+ existing seams to copy. Precedent-fit 5/5.
- Map dedup is free (same-key writes idempotent); upsert-per-account and pool-order serialization come from one synthesizer function; budget expiry ⇒ every account cooling ⇒ map has one entry per account ⇒ non-empty record by construction, keeping the email-silent path (`src/email.ts:161` → `:188`) dead.
- Zero caller-visible side effects: state object is created and owned by `judgePosts`; `parseLlmAccounts` output and every test fixture stay immutable. `src/types.ts`, `src/email.ts`, `src/config.ts`: zero lines.

**Cons:**
- Three live hazards need explicit design treatment (see Risks): park must return-not-throw (the `:571` throw sits inside a try whose catch swallows it), the budget cell cannot be a bare frame `let` (`judgeBatch`/`judgePost` are module-level and can't capture it), and the jitter overwrite policy (first-write-wins vs max-wins) must be pinned.
- Verification-cost 3/5: two hard pin rewrites (compile-failing pointer assertions) plus ~5 new test clusters; the injectable `now`/`sleep` seam is mandatory.

**Complexity:** Med (~2-3 days)
- Files to create: 0
- Files to modify: 6 — `src/judge.ts` (~150-200), `src/index.ts` (~2), `tests/judge.test.ts` (~250-320), `tests/index.test.ts` (~40), `scripts/probe-judge.ts` (~100-140), `.github/workflows/watch.yml` (~6)
- Risk level: Med (proven idioms offset by three live hazards, all with in-idiom mitigations)

### Option 2: Stamped account objects
**How it works:**
Each parsed `LlmAccount` (`src/judge.ts:80-84`) gains an optional `cooldownUntil` timestamp; the batch-local cursor is a `findIndex` scan for the first unstamped-or-expired account; the budget rides the `state` param reshaped to `{accounts, budgetMs}`; the failure record derives from stamps at throw time (`failuresFromStamps(accounts, now)`).

**Pros:**
- Zero new shared cells for cooldown state: stamps flow by object identity through plumbing that already exists (`:644` → `:663`/`:741`). Precedent-fit 5/5.
- Best integration-risk score (4/5): scan-before-dispatch is the same sync window as the fallback worker's claim (`:719-724`); drain-then-throw joins, throw contract, and alarm chain survive verbatim.
- Smallest blast radius: 5 files + tests, `judgePosts`' public signature unchanged, under 869feed's 12 files.

**Cons:**
- New side-effect class in a repo where `LlmAccount` has never been written after construction: `judgePosts` starts mutating caller-owned elements. Production-safe (fresh objects per run, `src/index.ts:195`); test-fragile — `singleAccount` is a module-level shared const (`tests/judge.test.ts:22-25`, consumed `:233`/`:257`/`:274`) that must become a factory.
- The never-clear-stamps rule is a landmine adjacent to the alarm contract: a natural-looking "clear on expiry" edit silently shrinks the throw-time record and can revive the email-silent path exactly on the run that needs the alarm. The invariant spans every holder of the accounts array instead of living inside one owned object.
- Rewrite surface is 7 test bodies, not the FRD's 5: `:728-753` (drain-then-throw under all-cooling would sleep 60s against real timers — a ~5-minute CI hang without the clock seam) and `:897-914` (502 sleep) join the four pins + fifth consumer.
- A timestamp-only stamp can only yield reason `"HTTP 429"`; a distinct budget-spent reason needs a second stamped field.

**Complexity:** Med (~2-3 days)
- Files to create: 0
- Files to modify: 5 — `src/judge.ts` (~180-220), `tests/judge.test.ts` (~300-400), `scripts/probe-judge.ts` (~80-120), `src/index.ts` (2-3), `.github/workflows/watch.yml` (~4)
- Risk level: Low-Med (mechanical except the time seam and the two sync-window disciplines; Med-level care on never-clear-stamps and the shared fixture)

### Option 3: Extracted rotator module
**How it works:**
New `src/rate-rotator.ts` exports a per-run rotator policy object: `pick(now)` → `{status:"eligible", account} | {status:"cooling", resumeAt}` (discriminated union — `exactOptionalPropertyTypes` forbids optional-field returns), `cool(account, now)` with upsert, `charge(ms)`/`budgetRemaining`, pool-order snapshot. `judge.ts` keeps park + throw plumbing; `RotationState` and the CAS are deleted.

**Pros:**
- The rotator's timing math becomes the cheapest tests in the suite: pure synchronous state over an injected `now`, hand-advanced clock, zero timer risk (~10-15 trivial cases).
- Centralizes the empty-failures invariant and the overwrite policy in one testable place.
- Extends the dominant 1:1 test convention (`tests/rate-rotator.test.ts`); zero config edits (test glob, lint scope, tsconfig include all pick it up).

**Cons:**
- First stateful module in `src/` (`src/judge.ts:12`: "this codebase has no classes") — precedent-fit 4/5; the sync-window discipline becomes convention-only: nothing enforces that `pick()` stays synchronous and above the first await, and a future async `pick()` would silently destroy the file's only concurrency guard.
- Highest cost: 2 new files (~100-140 + ~150-250 lines), deepest `judge.ts` surgery (delete-and-rewire of 10 interdependent touch points vs an append), 7 files total.
- The five-pin integration rewrite is undiminished — the FRD acceptance behaviors live in judge.ts's loops, not the rotator — so total test code slightly exceeds the in-module candidates, split across two files.
- Import topology: `LlmAccount` lives in `src/judge.ts:80-84`; rotator→judge value import plus judge→rotator import is a module cycle — needs `import type` (erased under `verbatimModuleSyntax`) or a type relocation touching the probe import.

**Complexity:** Med-High (~3-4 days)
- Files to create: 2 — `src/rate-rotator.ts` (~100-140), `tests/rate-rotator.test.ts` (~150-250)
- Files to modify: 5 — `src/judge.ts` (~150-200 touched), `tests/judge.test.ts` (~150-200), `src/index.ts` (~5), `scripts/probe-judge.ts` (~80-120), `.github/workflows/watch.yml` (~5)
- Risk level: Med (two deliberately-rebuilt invariants, each needing a dedicated pinning test)

## Comparison

| Criteria | In-place cooldown map | Stamped account objects | Extracted rotator module |
|----------|----------|----------|----------|
| Complexity | M (~2-3 days) | M (~2-3 days) | M-H (~3-4 days) |
| Codebase fit | High (5/5) | High (5/5, one new side-effect class) | Med (4/5, first stateful module) |
| Integration risk | Med (3/5, three mitigated hazards) | Low-Med (4/5) | Med (3/5) |
| Migration cost | Low-Med (4/5, 0 new files / 6 modified) | Low-Med (4/5, 0 new files / 5 modified) | Med (3/5, 2 new files / 5 modified) |
| Verification cost | M (3/5: 4 pins + 5 clusters, one file) | M (3/5: 7 bodies + 6 clusters, one file) | M (3/5: split across two files, rotator math cheapest) |
| Caller-visible side effects | None | Mutates caller-owned accounts | None (new module dependency) |

## Recommendation

**Selected:** Option 1 — In-place cooldown map

**Rationale:**
- It implements the FRD's named mechanism — batch-local cursor plus a shared cooldown map — with no shape deviation, so the design doc inherits the research doc's file:line map directly.
- Cooldown state's lifetime, ownership, and the never-cleared-record invariant stay local to one object created inside `judgePosts` (`src/judge.ts:644`). Option 2 spreads the same invariant across every holder of the accounts array and introduces the repo's first caller-object mutation; Option 3 spreads it across a module boundary that cannot enforce the sync discipline.
- Equal-or-better migration: zero new files, zero lines in `src/types.ts`/`src/email.ts`/`src/config.ts` — the alarm chain's files are exactly the ones that don't change.
- All three of its hazards carry concrete in-idiom mitigations (below); none is blocking.

**Why not alternatives:**
- Option 2 (stamped): viable runner-up — best integration-risk score and smallest blast radius. Rejected on ownership dilution: the never-clear-stamps rule guarding the alarm record would live in whatever code touches the account objects, and the shared `singleAccount` test const (`tests/judge.test.ts:22-25`) becomes a stamp-leak hazard. Choose it only if the design stage strongly prefers avoiding a map cell.
- Option 3 (rotator module): rejected on cost and precedent — 2 new files, first stateful module in `src/`, sync discipline reduced to convention, and the integration rewrite undiminished. Its isolation benefit buys the cheapest unit tests but not a cheaper change.

**Trade-offs:**
- Accepting a 3/5 integration-risk (the park return-not-throw subtlety) for zero caller-visible side effects and a FRD-literal shape.
- Accepting the known 8-minute-envelope race (300s waits + 60s abort tail + ~196s fetch worst case vs `watch.yml:47`'s cap, which would kill the run before the alarm sends) as documented limitation; the cap is the repo's own one-line setting (GitHub default is 360 minutes), so the mitigation lever is ops, not this change.

**Implementation approach:**
1. Time seam first — add injectable `now`/`sleep` trailing params to `judgePosts`/`judgePost`/`judgeBatch` (mechanically identical to the existing `fetchFn` threading, `:534-538`/`:637-642`/`:412-417`); forward `deps.now` at `src/index.ts:193-198`. Both halves are required: `now`-only hangs in the park, `sleep`-only can't do expiry math.
2. State reshape — `RotationState` → `{accounts, cooldownUntil: Map<number,number>, waitBudgetMs}`; delete the CAS (`:368-390`); map guard with first-write-wins expiry (preserves "a 429 costs 60s, not more", `src/judge.ts:13-15`; max-wins would let a burst extend the cooldown).
3. Park helper + loop rewiring — park returns a sentinel, never throws; budget-spent conversion happens at the outside-try loop-top guards (`:433-435` returns `{status:"exhausted"}`, `:545-547` throws); deduct-before-sleep, re-deduct actual elapsed after wake; jitter on expiry smooths synchronized wake.
4. Record synthesizer at the four throw sites (`:546`, `:571`, `:674`, `:749`) — iterate `accounts` in pool order, one record per map key, 1-based `account` per `src/types.ts:33-34`; non-empty by construction.
5. Probe rewrite + flag flip — per-account iteration replacing `resolveJudgeConfig(process.env)[0]` (`scripts/probe-judge.ts:163-171`), `ProbeOutcome` widen (`:76-79`), per-account exit gate (`:200-202`), `watch.yml:21` flip + rationale comment rewrite (`:18-20`).
6. Test rewrite — pins 1 and 4 (hard rewrites), pins 2 and 3 (semantic rewrites needing the 60s tick), fifth consumer (`:303-314`), `tests/judge.test.ts:728-753` and `:897-914` (clock adopters), ~5 new clusters, and the `runWatcher`-direct budget-exhausted acceptance test (`tests/index.test.ts:29-31`/`:219-320` pattern). `freshState` (`:45-48`) becomes the new state builder.

**Integration points:**
- `src/judge.ts:644` — state construction gains the map + budget cell.
- `src/judge.ts:425-441`, `:541-547` — loop heads become cursor-past-cooling picks (still synchronous, pre-await).
- `src/judge.ts:462-472`, `:565-575` — 429 branches become cool + repick-or-park; the `attempt -= 1` rewinds (`:470`, `:573`) survive per FRD FR#2.
- `src/index.ts:193-198` — the one production forward (`deps.now`).
- `scripts/probe-judge.ts:87-116`, `:163-171`, `:200-202` — per-account timed, selection, exit gate.
- `.github/workflows/watch.yml:18-21` — rationale comment + gating flip.

**Patterns to follow:**
- By-reference shared frame state guarded by synchronous windows: `src/judge.ts:87-91`, `:425-430`, `:655-659`, `:719-724`.
- Trailing defaulted params (not optional-object fields — `exactOptionalPropertyTypes`): `src/judge.ts:534-538`, `src/index.ts:99-114`, `src/recency.ts:14-18`.
- Constants-as-documentation for unmeasured values: `FALLBACK_CALL_BUDGET`, `src/judge.ts:31-50`.
- URL-branching mocks, never call-order: `tests/judge.test.ts:28-70`.

**Risks:**
- Throw-through-try reclassification: the bulk 429-arm throw (`:571`-shape) sits inside a try whose catch converts anything thrown to a transport outcome — the park sentinel + outside-try terminal design above is the mitigation, and a regression test must prove a budget-expiry throw escapes the catch.
- Newly-live empty-failures path: the synthesizer must be non-empty by construction and pinned by a test asserting `failures.length === accounts.length` at budget death.
- mock.timers temptation: disqualified — four real-timer yield sites (`tests/judge.test.ts:385`, `:409`, `:774`, `:828`) deadlock a frozen clock; only injected `now`/`sleep` works.
- Budget-vs-envelope race: documented; ops lever is `timeout-minutes` (`watch.yml:47`).
- Merge order: unmerged `d8fc15b` (`ukind/add-reasoning-effort`) touches `src/judge.ts`, `tests/judge.test.ts`, `scripts/probe-judge.ts`, `src/index.ts` — coordinate or land first.
- Post-land fragility: every judge-concurrency/limiter change in this repo's history needed a fix within ~1 day — plan a validation run immediately after implementation.

## Scope Boundaries
- Building: per-batch rotation restart, 60s cooldown map, in-loop park, 5-minute shared wait budget, synthesized pool-ordered exhaustion record, per-account probe with gating flag.
- NOT building: frame requeue machinery (rejected, locked), cooldown escalation or per-provider policies (flat 60s, FRD-decided), budget-driven abort of in-flight fetches (design-stage open question), SMTP timeouts on the transport (`src/email.ts:93-99`, pre-existing, out of FRD scope), config-surface for the budget/cooldown (module constants).

## Testing Strategy

**Unit tests:**
- Cooldown-map guard: concurrent 429s on one account leave one entry with the pinned overwrite policy (replaces pin 4's CAS-dedup proof).
- Budget accounting: deduct-before-sleep, overshoot re-deduction after wake, 5xx backoff (`:479`) draws no budget, and bulk-phase and fallback-phase waits draw the same cell (the two `next` cursors `:655`/`:717` are per-phase; the budget must not be).
- Record synthesis: pool order regardless of stamp/write order, upsert to latest, expired-but-cooled accounts still present, `failures.length === accounts.length` at budget death.
- Park-wake acceptance: all cooling → wake at earliest expiry, zero real delay (injected inert sleep), backlog completes (FRD bullet 2).
- Probe: per-account gating — dead account (401/403) fails the run, busy (429) distinguished (FRD bullet 5).

**Integration tests:**
- Restart proof: stamp account 1, tick 60s, next batch re-dispatches account 1 (FRD bullet 1; impossible without the seam).
- Budget-exhausted alarm via `runWatcher` with forwarded `deps.now` + email transport spy: exactly one send, complete record, caught `RotationExhausted`; `process.exit` stays un-exercised (`tests/index.test.ts` pattern).
- "No park when an account is eligible" (pin 2's survival): zero sleep invocations, zero budget consumed.

**Manual verification:**
- [ ] `npm run typecheck && npm run lint && npm test` green.
- [ ] Local `npm start` with `LLM_*`/`GMAIL_*`: force a 429 (low quota key) and watch the digest still complete.
- [ ] Dispatch the probe workflow manually with one dead key in `LLM_ACCOUNTS`: run turns red naming that account.
- [ ] One real scheduled run after landing; compare judge phase duration and 429 counts in the Actions log.

## Open Questions
**Resolved during research:**
- Where the wait lives — in-loop park, one helper for both loops (research checkpoint, advisor-endorsed; requeue rejected: new machinery + changed `judgePost` contract + walk must move behind the requeue loop).
- Budget placement — one shared cell for both phases (bulk + fallback), initialized in the `judgePosts` frame; implemented as a required field on the state object (a bare frame `let` cannot be captured by module-level `judgeBatch`/`judgePost`).
- Timing seam — injectable `now`/`sleep` trailing params; `mock.timers` deadlocks on four real-timer yield sites; both halves required; side effect: the 502 test's ~1s real sleep disappears once that test injects an inert sleep.
- Record shape — synthesized at throw time from the cooldown map, pool order, non-empty by construction; `AccountFailure` needs no schema change (`src/types.ts:37` already licenses non-429 reason strings).
- Probe flag — flip `continue-on-error: true` to gating; its accounts[0] rationale dies with the rewrite.

**Requires user input:**
- Overwrite policy under jittered expiries — recommendation: first-write-wins (preserves "a 429 costs 60s, not more"); max-wins only if the design wants sliding-window semantics. Default for planning: first-write-wins.
- Probe ramp scope — full ceiling ramp (≤33 calls/account, re-creates shared-key contention) vs stop-once-4-verified (≤6 calls/account). Recommendation: stop-once-4, matching the shipped `JUDGE_CONCURRENCY: "4"` and the `Math.max(4, ceiling)` floor (`scripts/probe-judge.ts:195`). Default for planning: stop-once-4.
- Abort guard at budget expiry (cancel in-flight fetches for a fast alarm, trading away the complete record) — FRD letter is wait-only. Default for planning: keep wait-only, document the race.

**Blockers:**
- `d8fc15b` merge ordering (unmerged reasoning-effort branch touching the same four files) — resolve at plan stage: land it first or rebase this change on it.
- Secrets hygiene: both LLM keys were pasted in plaintext chat 2026-10-26/27 — rotate at the providers before the validation run; never replicate real keys in tests or artifacts.

## References
- `.rpiv/artifacts/research/2026-10-27_15-27-01_per-batch-llm-rotation.md` — the grounding research this analysis builds on (all file:line anchors, FRD decisions, precedent history).
- `.rpiv/artifacts/discover/2026-10-27_14-08-35_per-batch-llm-rotation.md` — the FRD (interview, decisions, acceptance criteria).
- `src/judge.ts:92-96`, `:377-390` — the incumbent rotation state and CAS being replaced.
- `src/judge.ts:473-481` — the 5xx backoff, the in-loop park's mechanical template.
- `src/index.ts:296-313`, `src/email.ts:160-194` — the exhaustion alarm chain this change must not break.
- `tests/judge.test.ts:282-301`, `:303-314`, `:854-864`, `:866-895`, `:934-974` — the four run-sticky pins + fifth consumer that rewrite together.
- `.rpiv/artifacts/plans/2026-10-26_15-59-52_llm-account-rotation.md` — the landed rotation plan (CAS, drain-then-throw, mock conventions to carry over).
- `.rpiv/artifacts/validation/2026-10-27_12-39-16_fast-workflow-runtime.md` — the structural-defect finding that motivates this change.
- Commit `869feed` (run-sticky rotation, 12-file blast radius), `7cc7250` (width fix), `1c8a68c` (probe non-gating) — the precedent line this change amends.
