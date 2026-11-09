---
date: 2026-11-08T13:32:27+0700
author: Yogiswara Utama
commit: 77f44d7
branch: main
repository: loker-watcher
topic: "account-availability-check"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, judge-availability, judge-rotation, judge-health, email, index-wiring]
last_updated: 2026-11-08T13:32:27+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Account Availability Check Before Judging

**Date**: 2026-11-08T13:32:27+0700
**Author**: Yogiswara Utama
**Commit**: 77f44d7
**Branch**: main
**Repository**: loker-watcher

## Research Question

Chained from the FRD `.rpiv/artifacts/discover/2026-11-08_12-04-26_account-availability-check.md` and the research `.rpiv/artifacts/research/2026-11-08_12-45-40_account-availability-check.md`. At the start of every watch run, before any judge batch, one tiny chat-completions call per `LLM_ACCOUNTS` account runs in parallel. Survivors judge the tick at their probe-measured ceilings. When all accounts refuse, the run skips judging, keeps posts unseen, sends the alarm once per episode, and exits 0. Failure messages stop claiming "all accounts failed" when only some failed. This artifact answers one question: by what mechanism do refused accounts sit out for the run?

## Summary

**Problem**: a dead or throttled LLM account kills the whole tick today. The pool exhausts, the run exits 1, and job seekers lose the digest. The feature needs a way for refused accounts to sit out without disturbing the consumers that key accounts by pool index.

**Recommended**: Blocked-index mask — keep the full `LlmAccount[]` pool, add `blocked: ReadonlySet<number>` to `RotationState`, and put the all-down skip branch in the `runWatcher` body.

**Effort**: Medium (~1.5-2 days: one new module, four modified src files, the catch extraction, and the test-injection sweep)

**Confidence**: High — every element of the winner reuses an in-codebase pattern. The three alternatives each fail a hard requirement on code evidence, not preference.

## Problem Statement

**Requirements:**
- One tiny chat-completions call per account, in parallel, before any judge batch (FR1)
- Any failure — 429, timeout, 5xx, network error, unusable answer — marks the account unavailable for this run (FR2, D5)
- Survivors dispatch at their probe-measured ceilings from `state/judge-ceilings.json` (FR3, D6)
- All accounts alive: the run behaves exactly as today (FR4)
- All accounts down: no judge calls, ids stay unseen, the alarm email still sends once per episode, exit 0 (FR5, D3)
- The exhaustion message and email state the pool size and each account outcome (FR6, D7)
- Mid-run 60s cooldown and dispatch spread unchanged (FR7, D8)

**Constraints:**
- Hard: no workflow YAML changes; no new committed state file; no new runtime dependency; tests stay offline; Node >= 22, ESM, strict TS
- Hard: a checker error degrades to all-available with one warning line — the checker never crashes the tick (NFR, ratified in research Finding 8)
- Soft: about 144 tiny calls per account per day is acceptable cost; the tick stays inside the workflow timeout

**Success criteria:**
- `npm run typecheck && npm run lint && npm test` all exit 0
- All five acceptance scenarios covered offline: all-pass, some-pass, all-fail, checker-error, the "2 of 3" wording
- A mocked all-refusing run logs a skip line naming 0 of N and resolves green

## Current State

**Existing implementation:**
- `src/judge.ts:829` — `judgePosts(accounts, ceilings, healthMarks, ...)`; builds the `RotationState` literal at `src/judge.ts:840-851` and pool width at `src/judge.ts:864-872`
- `src/judge-rotation.ts:167-197` — `pickEligibleAccount`, the dial scan with three existing skip predicates (cooldown `:179`, capped+probed `:186`, at-ceiling `:188`)
- `src/judge-rotation.ts:73-113` — `RotationState` already holds four per-account skip sources (`cooldownUntil` `:76`, `inFlight` `:84`, `healthMarks` `:90`, `probedThisTick` `:95`)
- `src/index.ts:262-278` — the pool resolves once and hoists; the doc records that indexes must stay stable
- `src/index.ts:320-330` — the `judgePosts` call wiring (full pool, full-pool ceilings, full-pool health marks)
- `src/index.ts:441-485` — the entry-module catch, the only consumer of `RotationExhausted`; drives the episode alarm and `process.exit(1)`
- `src/judge-health.ts:248-273` — `nextHealthFile` translates ledger index to `accounts[index]?.baseUrl` against the full pool

**Relevant patterns:**
- Skip-continue in the pick: `src/judge-rotation.ts:179`, `:186`, `:188` — used in 3 places
- Appendix on the failure record: `src/judge.ts:372-398` `exhaustionRecord` appends unledgered accounts in stable pool order — used in 1 place (the capped appendix)
- Never-throw seam with a documented degrade contract: `src/index.ts:126` (`judgeCeilings`) and `:131` (`judgeHealth`) — the `WatcherDeps` template for `judgeAvailability`
- Zero-work early return: `src/index.ts:303-310` Gate 1 — the precedent for the skip branch
- Warnings returned as data: `src/judge-ceilings.ts` `resolveCeilings` — the template for the checker degrade flag

**Integration points:**
- `src/index.ts:311-320` — the pre-check slots between the Gate-1 return and the judge `timeStage`
- `src/index.ts:320-330` — `judgePosts` gains the blocked mask argument
- `src/index.ts:336` — `flushTickHealth` consumes judge outcomes; the skip branch must not reach it
- `src/index.ts:441-485` — the entry catch, whose episode-alarm sequence becomes a shared helper
- `src/email.ts:193-227` — `buildExhaustionText` / `sendExhaustionEmail` gain a trailing `poolSize?` parameter

## Solution Options

### Option 1: Blocked-index mask
**How it works:**
The full `LlmAccount[]` pool reaches `judgePosts` unchanged. A new `blocked: ReadonlySet<number>` field on `RotationState` (`src/judge-rotation.ts:73-113`) carries the refused indexes. `pickEligibleAccount` gains one skip line beside its three existing ones (`src/judge-rotation.ts:186` area). Pool width excludes blocked indexes (`src/judge.ts:864-872`). `exhaustionRecord` gains a blocked appendix mirroring the capped appendix (`src/judge.ts:372-398`), so pre-blocked accounts still appear in exhaustion emails. `judgePosts` gains one defaulted trailing parameter. The all-down case is detected in the `runWatcher` body, below Gate 1 and above the judge stage; it runs the episode-alarm sequence through a helper extracted from the entry catch and returns a `WatcherRun` with `saved: false`.

**Pros:**
- Every element has in-codebase precedent: the skip line, the state field, the appendix, the zero-work return, the seam shape
- Pool index stays operational identity — all ten index-keyed consumers keep working with zero re-keying
- The defaulted trailing parameter means all 31 direct `judgePosts` test call sites inherit the empty default and need no edits
- The skip branch doubles as the deadlock guard: `judgePosts` is never invoked with zero survivors (`waitCeilingSlot` has no timer, `src/judge-rotation.ts:268-272`)

**Cons:**
- Touches four src files beyond the new module (`judge-rotation.ts`, `judge.ts`, `index.ts`, `email.ts`)
- The entry-catch extraction is the riskiest edit — the episode order (read `episodeAlarmDue` before the flush opens the bit) must be reproduced exactly
- Existing judge-stage acceptance tests need a pass-all `judgeAvailability` injection, or they silently become skip runs

**Complexity:** Medium (~1.5-2 days)
- Files to create: 2 (`src/judge-availability.ts` about 120 lines, `tests/judge-availability.test.ts` about 150 lines)
- Files to modify: 4 src files plus 3 test suites
- Risk level: Medium — concentrated in the catch extraction and the test-injection sweep

### Option 2: Ceiling-0 encoding
**How it works:**
No signature or state changes. The wiring floors each refused account ceiling to 0 in the ceilings map built at `src/index.ts:319`. The existing pick skip predicate `(inFlight ?? 0) >= ceiling` refuses those accounts, and width contributes 0. The all-down case is a map with every ceiling at 0.

**Pros:**
- `judgePosts` and `RotationState` signatures untouched
- Two downstream readers honor a 0 with no edit (`src/judge-rotation.ts:187-188`, `src/judge.ts:864-871`)

**Cons:**
- **All-down hangs forever.** Width is `Math.max(1, 0)` = 1 (`src/judge.ts:864-865`), so one worker spawns. Its pick is always undefined. `allHealthBlocked` reads only `healthMarks` and returns false (`src/judge.ts:356-357`). The worker parks in `waitCeilingSlot` (`src/judge-rotation.ts:268-272`) with no timer and no claims outstanding. `judgePosts` never joins and never throws; the catch never fires. No alarm, no exit, a hung workflow run
- **The failure record silently empties.** Zeroed accounts never dispatch, so the ledger stays empty and `buildFailuresFromLedger` returns nothing for them. An empty record makes `buildExhaustionText` return null (`src/email.ts:193-194`) — no alarm email exactly when it is needed most
- Violates the documented invariant "probe-measured in-flight ceiling (>= 1)" (`src/judge-rotation.ts:77-78`). `resolveCeilings` structurally rejects values below 1 (`src/judge-ceilings.ts:43-48`, `:75`) — a 0 is a value this codebase has never produced
- The ceilings map carries no provenance once mutated: a per-run 0 is indistinguishable from a probe reading

**Complexity:** Medium (~1.5 days) — the missing all-zero guard and a new failure-record builder eat the savings from the untouched signatures
- Files to create: 2 (same as Option 1)
- Files to modify: 3 (`src/index.ts`, `src/judge.ts` for the guard, `src/email.ts`) plus a bespoke record builder
- Risk level: High — the hang is silent and the alarm loss is silent

### Option 3: Cooldown pre-stamp
**How it works:**
Zero new machinery: before `judgePosts`, pre-stamp a cooldown on every refused account so the existing skip predicate refuses them exactly like mid-run 429s. The all-down case is a fully-cooled pool entering `judgePosts` unchanged.

**Pros:**
- Reuses the existing skip predicate with no new state field
- `coolAccount` waking ceiling waiters is a harmless no-op on a fresh state (`src/judge-rotation.ts:208-213` against an empty `ceilingWaiters`)

**Cons:**
- **All-down dispatches real judge calls to dead accounts.** `earliestCooldown` reads the fresh stamps and is defined, so the flavor split parks first (`src/judge.ts:476`). After the park (~60.5s) the 60s cooldown expires, the pick succeeds, and a real batch dispatches to an account the pre-check declared dead. FR5 "no judge calls" is violated
- **Exit 1, not 0.** Parks repeat at 60,500ms (pinned at `tests/judge-rotation.test.ts:241-243`), drain the 180s budget (`src/judge.ts:121`), and the pool exhausts (`src/judge.ts:477-479`) → `judgePosts` throws → `process.exit(1)` (`src/index.ts:480`)
- **Every reason mislabels as "HTTP 429".** A pre-stamped account has no ledger entry, so `buildFailuresFromLedger` falls to the hard-coded cooldown branch (`src/judge-health.ts:239-241`). A 401 or timeout renders as a rate limit
- "Zero machinery" is false: `RotationState` is constructed inside `judgePosts` (`src/judge.ts:838-849`), so a new parameter is required anyway

**Complexity:** Medium (~1.5 days)
- Files to create: 2 (same as Option 1)
- Files to modify: 3 (`src/judge.ts`, `src/index.ts`, `src/email.ts`) plus the all-down bypass gate the candidate claims not to need
- Risk level: High — wrong exit code, wrong reasons, and judge calls to dead accounts

### Option 4: Filtered pool array
**How it works:**
The literal FRD wording: `src/index.ts` filters the `LlmAccount[]` to survivors before passing it to `judgePosts`. Rotation primitives stay untouched and receive the smaller array. The all-down case is an empty array plus an early skip branch.

**Pros:**
- Smallest diff at the call site; no rotation internals touched
- Matches the FRD Recommended Approach wording literally

**Cons:**
- **Silent misrouting across six consumers.** With filtered `[acct0, acct2]` of 3: ceilings route acct0 ceiling onto acct2 (`src/judge.ts:844` against `src/judge-ceilings.ts:78-85`); health marks cap the wrong account (`src/judge.ts:849`); width sums the removed account ceiling (`src/judge.ts:864-872`); warn lines report "account 2" for pool account 3 (`src/judge.ts:510` and siblings)
- **Phantom health recovery committed to state.** The ledger records filtered index 1 (the acct2 outcome); `nextHealthFile` translates index 1 against the full pool and clears the acct1 streak (`src/judge-health.ts:255-262`) — a recovery that never happened, written to `state/judge-health.json`
- The entry-catch bootstrap re-resolves the full pool (`src/index.ts:451-458`) and applies filtered-index outcomes to it — the same misalignment on the exhaustion path
- The compiler catches none of it: every misroute flows through valid `number` keys in `Map<number, number>` and `TickOutcomes`
- An empty array breaks `pickEligibleAccount` division by pool size 0 (`src/judge-rotation.ts:179`) and makes `allHealthBlocked` vacuously true (`src/judge.ts:356-362`) — so `judgePosts` is not untouched after all

**Complexity:** High (~2 days)
- Files to create: 2 (same as Option 1)
- Files to modify: 5+ (`src/index.ts` at five sites, `src/judge.ts` for the empty guard and record numbering, `src/email.ts`) plus bespoke re-keying code with no helper
- Risk level: High — silent, state-corrupting, hardest to test

## Comparison

| Criteria | Option 1: Blocked-index mask | Option 2: Ceiling-0 encoding | Option 3: Cooldown pre-stamp | Option 4: Filtered pool array |
|----------|------------------------------|------------------------------|------------------------------|-------------------------------|
| Complexity | Medium | Medium | Medium | High |
| Codebase fit | High | Low | Low | Low |
| Risk | Medium | High | High | High |
| All-down behavior | Correct: exit 0, alarm, no judge calls | Hangs forever, no alarm | Exit 1, judge calls to dead accounts | Needs a guard the option does not include |
| Failure-record fidelity | Full (blocked appendix) | Empty record, no email | All reasons mislabeled "HTTP 429" | Wrong account numbers and baseUrls |
| Index-keyed consumers | Untouched | Untouched | Untouched | Six silently misrouted |
| Existing test breakage | 2 acceptance tests need injection | 1 acceptance test breaks hard | 2 tests break or fork | 3+ tests break plus new regression tests |

## Recommendation

**Selected:** Option 1 — Blocked-index mask

**Rationale:**
- It is the only candidate whose all-down path produces the required behavior on evidence. The skip branch sits in the `runWatcher` body, so `judgePosts` is never invoked with zero survivors, `flushTickHealth` stays structurally unreachable, and a resolving `runWatcher` exits 0 implicitly
- Pool index is operational identity in this codebase. `src/index.ts:262-270` documents the stable-index rationale, and ten consumers key by position. The mask is the only mechanism that leaves that invariant intact
- Every moving part has a precedent: the skip line (`src/judge-rotation.ts:179`, `:186`, `:188`), the state field (`src/judge-rotation.ts:73-113` already holds four skip sources), the appendix (`src/judge.ts:372-398`), the zero-work return (`src/index.ts:303-310`), the seam shape (`src/index.ts:126`, `:131`)
- The cost is bounded: one defaulted trailing parameter on `judgePosts` means all 31 direct test call sites inherit the empty default

**Why not alternatives:**
- Option 2 (Ceiling-0): the all-down case hangs in `waitCeilingSlot` with no timer and no claims (`src/judge-rotation.ts:268-272`), and the empty failure record makes `buildExhaustionText` return null (`src/email.ts:193-194`) — the alarm is lost exactly when it is needed. It also encodes unavailability as a value the ceilings resolver structurally refuses to emit (`src/judge-ceilings.ts:43-48`)
- Option 3 (Cooldown pre-stamp): the 60s cooldown expires mid-park, the pick succeeds, and real judge batches dispatch to accounts the pre-check declared dead. The run then exits 1 (`src/index.ts:480`) instead of 0, and every failure reason renders as "HTTP 429" (`src/judge-health.ts:239-241`)
- Option 4 (Filtered pool array): six index-keyed consumers misroute silently, including a phantom health-streak recovery committed to `state/judge-health.json` (`src/judge-health.ts:255-262`). The compiler catches none of it

**Trade-offs:**
- Accepting four modified files and a catch extraction in exchange for correct all-down behavior and an intact index invariant
- Accepting an injection sweep across existing judge-stage tests in exchange for not coupling the checker to the judge fetch answer shape
- Accepting a new `judgePosts` parameter in exchange for not re-keying ceilings, health marks, or outcomes anywhere

**Implementation approach:**
1. New module `src/judge-availability.ts` — one tiny chat-completions call per account in parallel over the injected `fetchFn`, a hard per-account abort of about 10 seconds, reusing the judge wire shape (`src/judge.ts:497-504`) with `normalizeEndpoint` exported for drift-proofing (`src/judge.ts:213`). Returns pass or failure per pool index plus a `degraded` flag. Never throws
2. Mask plumbing — the `blocked` field on `RotationState`, one skip line in `pickEligibleAccount`, width exclusion, the blocked appendix in `exhaustionRecord`, and the defaulted trailing parameter on `judgePosts`
3. Wiring — the `judgeAvailability` seam on `WatcherDeps` beside `judgeCeilings`/`judgeHealth`; the pre-check call below Gate 1 and above the judge stage; sit-out log lines; the all-down skip branch returning `saved: false`
4. Alarm path — extract the episode sequence from the entry catch into a shared helper parameterized by pool and pre-flush health snapshot. The skip path passes `deps.transport`. The skip flush passes marks-safe outcomes (empty outcomes preserve every mark and flip only the bit — the shape `state/judge-health.json` already has at HEAD)
5. Truthful wording — thread pool size N into `rotationExhausted`, `buildExhaustionText`, and `sendExhaustionEmail`. Render survivors by set-difference at the email layer (pool 1..N minus `failures.map(f => f.account)`)

**Integration points:**
- `src/judge-rotation.ts:73-113` — add `blocked: ReadonlySet<number>` (optional and defaulted, so existing state factories need no edit)
- `src/judge-rotation.ts:186` area — one skip line beside the three existing predicates
- `src/judge.ts:829-839` — defaulted trailing `blocked` parameter on `judgePosts`
- `src/judge.ts:864-872` — width excludes blocked indexes
- `src/judge.ts:372-398` — blocked appendix in `exhaustionRecord`
- `src/index.ts:311-320` — pre-check invocation, sit-out logs, the all-down skip branch
- `src/index.ts:441-485` — extract the episode-alarm sequence into a shared helper
- `src/email.ts:193-227` — trailing `poolSize?` on both functions

**Patterns to follow:**
- Never-throw seam with a documented degrade contract: `src/index.ts:126` and `:131`
- Warnings returned as data, not printed: `src/judge-ceilings.ts` `resolveCeilings`
- Zero-work early return with an honest `WatcherRun`: `src/index.ts:303-310`
- Appendix on the failure record with a stable pool-order sort: `src/judge.ts:372-398`
- Trailing-parameter fetch injection for offline unit tests: `src/judge.ts:726-737`

**Risks:**
- The catch extraction reorders the episode sequence and double-sends or suppresses the alarm — mitigation: the helper is the single call site for both paths, and the pre-flush `episodeAlarmDue` read stays before the flush in both
- Pre-check 429s reach `nextHealthFile` and hard-cap accounts after two consecutive skip ticks — mitigation: the skip flush passes empty outcomes, which preserves every mark and flips only the bit
- A zero-survivor pool ever reaching `judgePosts` parks a worker forever — mitigation: the skip branch is the invariant that `judgePosts` only ever sees at least one survivor; assert it in the acceptance test
- Existing judge-stage tests silently become skip runs — mitigation: inject a pass-all `judgeAvailability` into every test that runs the judge stage, rather than relying on the checker tolerating the judge fetch answer shape

## Scope Boundaries

- Building: `src/judge-availability.ts`, the mask plumbing, the `judgeAvailability` seam, the all-down skip path, the shared alarm helper, the pool-truthful wording, and the offline test surface for all five acceptance scenarios
- NOT doing: any workflow YAML change; any new committed state file; any change to mid-run cooldown or dispatch spread; any same-run retry of refused accounts; the concurrency-guard follow-up (per-account in-flight throttling or mid-run width shrink) — that is a separate research artifact
- NOT doing: enriching `AccountFailure` (`src/types.ts:34-43`) with a per-entry pool size — survivors render by set-difference at the email layer

## Testing Strategy

**Unit tests:**
- Each FR2 outcome classifies correctly: 429, timeout (a rejecting double — no real timers), 5xx, transport throw, unusable answer
- The checker never throws: a `fetchFn` that throws before dispatch degrades to all-available with exactly one warning line and `degraded: true`
- The tiny payload carries no `response_format` and no `reasoning_effort`
- Mask semantics: blocked indexes are skipped by the pick, excluded from width, and appended to the exhaustion record in pool order

**Integration tests:**
- All-pass: the run shape equals today
- Some-pass: only survivors dispatch, at their probe-measured ceilings (the URL-recording pattern, `tests/index.test.ts:721`)
- All-fail: `fetchFn` never called, exactly one alarm via the recording transport with per-account text, state ENOENT, and the run RESOLVES
- Checker-error: exactly one `console.warn` and an unfiltered run
- "2 of 3": the exhaustion error reads "judge: 2 of 3 LLM_ACCOUNTS accounts failed — ..." and the email subject reads "(2 of 3 accounts failed)" (preserves the pinned `/judge pool exhausted/` regex, `tests/email.test.ts:409`)
- Episode dedup: a second consecutive skip tick sends no second alarm

**Manual verification:**
- [ ] `npm run typecheck && npm run lint && npm test` all exit 0
- [ ] A `workflow_dispatch` smoke run with one deliberately broken key shows that account sitting out with its reason and the run completing green on the rest
- [ ] A same-day fix window is reserved for the live run — every prior rotation/health change passed offline and was corrected by a live run

## Open Questions

**Resolved during research:**
- Does the green all-down skip persist the episode bit? — Yes. The success-path Commit state step already carries the health file (`watch.yml:243-247`), so exit 0 needs no YAML change
- Would the gate have saved run 42440065433? — No. All 3 accounts passed a tiny call at tick start; the killer was 52 concurrent dispatches draining the 180s park budget. The gate catch-class is dead keys and dead endpoints — a real but different failure class
- Does a skip run send the heartbeat? — No. The FR5 output list is exhaustive and never names it; the alarm is the skip run notification
- Is the checker-error degrade compatible with fail-visible? — Yes. The checker is a degradable reader of live provider state in the `loadAccountCeilings` family, and the degrade is loud (one warning naming the cause verbatim)

**Requires user input:**
- Should the skip-run commit message be special-cased? A green skip that changed only the health file commits as "state: 0 new seen post ids" through the existing jq-delta subject. Default assumption: accept the cosmetic noise

**Blockers:**
- None. Both FRD blocking open questions are resolved by code evidence and developer ratification

## References

- `.rpiv/artifacts/research/2026-11-08_12-45-40_account-availability-check.md` — the research this artifact scores against (Findings 1-9, the mask comparison, the resolved open questions)
- `.rpiv/artifacts/discover/2026-11-08_12-04-26_account-availability-check.md` — the FRD (D0-D8, FR1-FR7)
- `src/judge-rotation.ts:73-113` — `RotationState`, where the blocked field joins
- `src/judge.ts:372-398` — `exhaustionRecord`, the appendix pattern to mirror
- `src/judge.ts:497-504` — the per-attempt HTTP shape the checker reuses
- `src/index.ts:441-485` — the entry catch whose episode sequence becomes the shared helper
- `src/judge-health.ts:248-273` — `nextHealthFile`, the produce-inside/consume-outside hazard the mask avoids
- `.rpiv/artifacts/solutions/2026-11-07_08-22-22_provider-health-module-boundary.md` — the module boundary this feature must not break
- `.rpiv/artifacts/solutions/2026-11-06_11-05-39_llm-account-spread-judge.md` — settled dead-ends, not to be re-litigated
