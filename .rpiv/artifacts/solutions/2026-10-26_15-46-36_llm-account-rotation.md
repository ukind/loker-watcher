---
date: 2026-10-26T15:46:36+0700
author: Yogiswara Utama
commit: 399181b
branch: ukind/fix-hit-limit
repository: fix-hit-limit
topic: "LLM account rotation on rate limit"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, judge, config, rotation, rate-limit, email, probe]
last_updated: 2026-10-26T15:46:36+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: LLM account rotation on rate limit

**Date**: 2026-10-26T15:46:36+0700
**Author**: Yogiswara Utama
**Commit**: 399181b
**Branch**: ukind/fix-hit-limit
**Repository**: fix-hit-limit

## Research Question

Chained from `.rpiv/artifacts/research/2026-10-26_14-47-19_llm-account-rotation.md` (itself chained from the discover FRD). Replace the single-account judge config (`LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`) with one `LLM_ACCOUNTS` JSON pool; on the first HTTP 429 retry the same call against the next account with no backoff; keep a run-level sticky pointer; when every account is exhausted send one notification email and exit nonzero. Which implementation shape should carry the rotation state, and at what cost?

## Summary

**Problem**: The judge stage burns one LLM account's rate limit and defers whole batches; a pool of accounts with first-429 rotation and an exhaustion alarm removes the single point of starvation.
**Recommended**: Shared pool object — rotation state as closure bindings inside `judgePosts`, sibling to the proven `next` batch cursor; the advance stays synchronous inside `judgeBatch`'s 429 branch, so no new concurrency pattern is introduced.
**Effort**: Med (~1 day; ~250–350 lines across ~6 code files plus test rewrites — grounded in the four judge-stage changes landed in the last two days on this same retry chain).
**Confidence**: High

## Problem Statement

**Requirements:**
- One `LLM_ACCOUNTS` JSON secret: ordered array of `{baseUrl, apiKey, model}`, validated fail-visible at startup, every error naming `LLM_ACCOUNTS`.
- First HTTP 429 rotates: the same call retries against the next account with no backoff wait.
- 5xx keeps the existing same-account backoff; transport errors defer the batch immediately without rotating.
- Run-level sticky pointer: after failover the run stays on the new account; account 1 returns next run.
- Pool exhausted: `judgePosts` throws a typed error carrying the per-account failure record; one exhaustion email sends; the process exits 1; no partial digest, no state commit, unjudged posts stay unseen.
- Probe reads `LLM_ACCOUNTS` and probes with account 1; workflow, README, and two stale docs swap atomically.

**Constraints:**
- Hard: strict TS flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); no new runtime dependencies; fail-visible config errors; atomic state writes; email-before-state ordering (D8); Node >= 22 ESM.
- Soft: keep log prefixes (`judge:`, `probe:`, `email:`, `watch: FAILED —`) and name the account in judge log lines ("account 2 HTTP 429").

**Success criteria:**
- A 429 on account 1 moves the very next call to account 2, mid-run and across batches.
- All accounts exhausted produces exactly one email, exit code 1, empty diff against `state/seen-posts.json`.
- `npm run typecheck`, `npm run lint`, `npm test` pass with the new rotation proofs replacing the two same-key 429 tests.

## Current State

**Existing implementation:**
Single-account judge: `resolveJudgeConfig` reads three env names (`src/judge.ts:75-96`) into the `JudgeConfig` triple (`src/judge.ts:55-59`); `judgeBatch` retries 429+5xx on the same key with 1s/2s/4s backoff and defers when the budget spends (`src/judge.ts:267-347`); `judgePost` is a 2-attempt status-agnostic fallback (`src/judge.ts:356-412`); `judgePosts` runs a 4-worker pool with a shared `next` batch cursor (`src/judge.ts:429-481`) and never throws (`src/judge.ts:417`).

**Relevant patterns:**
- Shared cursor read-advance with no `await` between: `src/judge.ts:444-448` — the repo's one proven lock-free shared-state pattern, pinned by the peak/out-of-order concurrency tests (`tests/judge.test.ts:433-500`).
- Fail-visible JSON validation with per-item rules: `src/config-file.ts:40-152` (parse preserves parser message at `:56-59`, empty-array throw at `:104`).
- Guarded indexed access under `noUncheckedIndexedAccess`: `RETRY_DELAYS_MS[attempt] ?? 0` (`src/judge.ts:302`).
- Conditional spread for optional fields under `exactOptionalPropertyTypes`: `src/index.ts:73-82`.
- Builder + sender co-located over the `sendText` spine with injected-Transporter seam: `src/email.ts:54-80`, `:84-113`, `:122-153`; second precedent `src/heartbeat.ts:98-163`.
- Dependency injection as the universal test seam: `fetchFn` parameter (`src/judge.ts:270`, `:357`, `:431`).

**Integration points:**
- `src/index.ts:94-98` — the only production judge call site; `main().catch` at `:151-155` is the exhaustion email + exit-1 site.
- `src/config.ts:14-22` — `ENV_NAMES` registry; the trio at `:17-19` collapses to one `llmAccounts` entry.
- `scripts/probe-judge.ts:168-176` — probe env read + exit guard; imports `src/` loaders already (`:21-26`).
- `.github/workflows/watch.yml:32-34` and `:58-60` — both env blocks collapse to one secret line; `:65-77` commit step is success-gated, so a nonzero exit can never race the state commit.

## Solution Options

### Option 1: Shared pool object

**How it works:**
Rotation state lives as plain bindings inside `judgePosts` (`src/judge.ts:429-481`) — `accountIndex` and a `failures[]` array, siblings of the existing `next` cursor (`:444`). `judgeBatch`/`judgePost` gain an account parameter plus injected `rotate`/`record` callbacks (injection is the repo's existing seam idiom — `fetchFn` at `:270`/`:357`/`:431`); the 429 branch calls them synchronously and continues with no `sleep`. The parser, `LlmAccount`/`AccountFailure` types, and the typed exhaustion error live in `src/judge.ts`.

**Pros:**
- Clones the only proven lock-free shared-state pattern in the repo: pointer read and advance both synchronous, no `await` between (`src/judge.ts:444-448`), coherent across four workers per the concurrency tests (`tests/judge.test.ts:433-500`).
- State lifetime is the `judgePosts` frame — run-level reset is free and tests cannot poison each other.
- Lowest migration cost of the four shapes: no new file, no signature churn beyond one account parameter, ~250–350 lines total.
- Every new proof observable through the existing `mockFetch` seam; concurrency tests need only fixture edits.

**Cons:**
- One non-precedented decision: the callee (judgeBatch) advances the caller's state — resolved by injected callbacks, but it is an invariant to pin ("read at entry, advance synchronously in the 429 branch").
- `judgePost`'s status-agnostic retry (`:380-385`) gains a 429 side effect — a subtle two-line change.
- Exhaustion mid-concurrency can leave the failure record incomplete (bounded: the throw bypasses reassembly).

**Complexity:** Low-Med (~1 day)
- Files to create: 0
- Files to modify: ~9 (judge.ts dominant, config.ts, index.ts, email.ts, probe-judge.ts, watch.yml, README + 2 stale docs, tests)
- Risk level: Low

### Option 2: AccountPool module

**How it works:**
New `src/account-pool.ts` exports an `AccountPool` class (`current`/`rotate`/`record`/`isExhausted`/`summary`); `judgePosts` constructs one per run and threads the pool object into `judgeBatch`/`judgePost`, which call `pool.current()` at the top of each attempt.

**Pros:**
- Pool-level unit tests (rotate/record/exhaust/summary) run with zero fetch mocking — an ergonomics win no other shape has.
- Concentrates the `noUncheckedIndexedAccess` guard in one place; smaller judge.ts diff.

**Cons:**
- Zero classes exist in `src/` or `tests/` — the repo's encapsulation idiom is exclusively plain functions and closure state; this is a genuine new pattern.
- The spec's "passes the pool (or pool.current())" ambiguity is load-bearing: the snapshot form silently breaks stickiness and rotation while single-batch tests still pass.
- Pool-level tests only pay off if written; through-`judgePosts`-only testing gains nothing, duplicating integration proofs.

**Complexity:** Med (~1–1.5 days)
- Files to create: 1 (`src/account-pool.ts`, ~60–90 lines) + pool unit tests
- Files to modify: same set as Option 1
- Risk level: Med

### Option 3: Explicit account threading

**How it works:**
`judgePosts` owns the pointer; workers are dispatched with an explicit `accounts[i]`; `BatchOutcome` (`src/judge.ts:242-244`) widens with a rotate/exhausted arm carrying `{accountIndex, status|error}`, and the reassembly loop advances the pointer from outcomes between dispatches.

**Pros:**
- Strongest threading precedent: `config` is already passed explicitly into all three functions and consumed at six field sites (`src/judge.ts:269`, `:358`, `:431`; `:277`, `:287`, `:291`, `:363`, `:370`, `:374`).
- Rotation outcomes are plain return values — the easiest assertions of the four shapes, no closure peeking.
- Exhaustion throws only after the `Promise.all` join, so in-flight workers drain cleanly.

**Cons:**
- The outcome-fed advance necessarily spans `judgeBatch`'s `await` — the repo's one lock-free discipline (read-advance with no `await` between, `src/judge.ts:447-448`) cannot be preserved.
- Concurrent double-429 needs a monotonic max-guard keyed on the carried index — the subtlest correctness piece in the set, with no existing test choreography to pin it.
- `judgePost` is exported with three direct tests (`tests/judge.test.ts:82-199`); widening its public contract is churn.

**Complexity:** Med (~1 day)
- Files to create: 0
- Files to modify: same set plus visible signature churn
- Risk level: Med

### Option 4: Module-global pointer

**How it works:**
Module-scoped `currentAccountIndex` plus failure list in `src/judge.ts`; `resetPool()` (or a reset inside the resolver) runs at start; `judgeBatch`/`judgePost` read and advance the global directly.

**Pros:**
- Least signature churn — no parameter changes at all.
- The global pointer is trivially assertable in tests without any capture spy.

**Cons:**
- Zero precedent: every `let` in `src/` is function-scoped (`judge.ts:285`, `:368`, `:436`, `:444`; `fetch-threads.ts:115-116`, `:280-281`; `config-file.ts:41`, `:54`) — no module-level mutable state exists anywhere.
- node:test runs the suite in one process: any rotating/exhausting test poisons later tests unless each remembers `resetPool()` — invisible in signatures, so missed resets are order-dependent flake.
- `Promise.all` early rejection leaves sibling workers mutating the failure list after the throw snapshot — a leak this shape must explicitly handle.
- The pointer is global while the accounts array arrives by parameter — mismatched pairs are possible across calls.

**Complexity:** Med (~1 day)
- Files to create: 0
- Files to modify: same set plus reset discipline in every affected test
- Risk level: High

## Comparison

| Criteria | 1 Shared pool | 2 Pool class | 3 Threading | 4 Global |
|----------|---------------|--------------|-------------|----------|
| Complexity | L-M | M | M | M |
| Codebase fit | H | M (first class) | M (pointer diverges) | L (zero precedent) |
| Concurrency safety | H (sync advance) | M-H | M (guard needed) | L-M |
| Test ergonomics | H (mockFetch) | H (pool units) | H (return values) | M (reset discipline) |
| Migration cost | L | M | M | L-M |
| Risk | L | M | M | H |

## Recommendation

**Selected:** Option 1 — Shared pool object

**Rationale:**
- It reuses the repo's single proven lock-free shared-state pattern — the `next` cursor read-advance (`src/judge.ts:444-448`) — with the pointer advance kept synchronous inside `judgeBatch`'s 429 branch, so the concurrency argument already has executable proof in the suite (`tests/judge.test.ts:433-500`).
- State lifetime equals the `judgePosts` call frame: run-level sticky reset is free, and no test can poison another — the exact defects that sink Option 4 and complicate Option 3.
- Lowest migration cost: no new file, no public contract widening, ~250–350 lines dominated by one file (`src/judge.ts`).
- Every required new proof is observable through the existing `mockFetch` seam; only the header capture (to distinguish accounts by `Authorization`, built at `src/judge.ts:291`/`:374`) is genuinely new mock surface.

**Why not alternatives:**
- Option 2 (AccountPool class): first class in a codebase whose encapsulation idiom is exclusively functions and closures; the "pool object vs pool.current()" ambiguity hides a silent stickiness-breaker; its unit-test ergonomics duplicate proofs the integration suite must carry anyway.
- Option 3 (Explicit threading): the outcome-fed pointer advance spans an `await`, breaking the repo's one lock-free discipline; correctness then depends on a monotonic double-advance guard with no test precedent.
- Option 4 (Module global): zero precedent (no module-level mutable state in `src/`), test-order poisoning via reset discipline, and a failure-record mutation leak after early `Promise.all` rejection.

**Trade-offs:**
- Accepting one new idiom — callee-advances-caller-state via injected `rotate`/`record` callbacks — for keeping all concurrency subtlety inside the already-proven synchronous window. Injection itself is the repo's established seam (`fetchFn`, injected `Transporter`).
- Accepting a possibly incomplete failure record when exhaustion lands mid-concurrency (the throw bypasses reassembly; every account that failed recorded before the throw) — the email lists what happened per account up to exhaustion.

**Implementation approach:**
1. Types + parser — `LlmAccount` (reuse the `JudgeConfig` triple), `AccountFailure`, `RotationExhaustedError`; `resolveJudgeConfig` returns the validated accounts array with errors naming `LLM_ACCOUNTS`, modeled on `src/config-file.ts:87-152`; `ENV_NAMES` trio → one `llmAccounts` entry (`src/config.ts:17-19`).
2. Rotation mechanics — un-hoist `model` into the retry loop (`src/judge.ts:277`); insert the 429 branch inside `!response.ok` before the shared retryable check (`:298` before `:301-307`), recording + advancing + continuing with no `sleep`; 5xx branch byte-identical; transport catch records without advancing (`:334-342`); mirror in `judgePost` before its status-agnostic `continue` (`:380-385`).
3. `judgePosts` owns state — `accountIndex` + `failures[]` siblings of `next` (`:444`); account read at function entry before the first `await`; typed throw when rotation finds no account left, carrying the record; update the never-throws contract (`:417`).
4. Exhaustion email — builder + sender in `src/email.ts` mirroring `sendDigest` (`:122-153`) over `sendText` (`:84-113`); send + exit 1 in the existing catch (`src/index.ts:151-155`); the success-gated commit step (`watch.yml:65-77`) makes the nonzero exit race-free by construction.
5. Probe + wiring + docs — probe reads `LLM_ACCOUNTS`, probes account 1 (`scripts/probe-judge.ts:18`, `:168-176`); workflow env collapse (`watch.yml:32-34`, `:58-60`); README (`:40`, `:49-51`, `:210`; stale `:19-24`, `:88-99`); `.claude/skills/validate-e2e/SKILL.md:13`; `AGENTS.md:18`, `:21`.

**Integration points:**
- `src/judge.ts:75-96` — resolver becomes the accounts parser (single validation point the probe also imports).
- `src/judge.ts:267-347` / `:356-412` — the two retry loops gain the 429-rotate branch.
- `src/judge.ts:429-481` — state bindings, throw site, worker closure capture.
- `src/index.ts:151-155` — exhaustion email + exit 1 in the existing catch.
- `.github/workflows/watch.yml:32-34`, `:58-60` — secret wiring collapse.

**Patterns to follow:**
- Cursor closure read-advance: `src/judge.ts:444-448`
- Fail-visible per-item validation: `src/config-file.ts:87-152`
- Guarded index under `noUncheckedIndexedAccess`: `src/judge.ts:302`
- Conditional spread under `exactOptionalPropertyTypes`: `src/index.ts:73-82`
- Builder + sender over `sendText`: `src/email.ts:122-153`

**Risks:**
- `judgePost`'s status-agnostic retry silently rotating on 429: pin with a dedicated test asserting rotation happens exactly once per fallback attempt.
- Pointer read drifting past the first `await` in `judgeBatch`: make the account read the function's first statement; the out-of-order test choreography (`tests/judge.test.ts:464-500`) is the harness if it ever regresses.
- Incomplete failure record on mid-concurrency exhaustion: accept (bounded, email still names every account that failed); revisit only if the exhaustion email ever shows a wrong account count.

## Scope Boundaries
- Building: `LLM_ACCOUNTS` pool config + validation, first-429 rotation with run-sticky pointer, 5xx/transport semantics preserved, typed exhaustion error, one exhaustion email + nonzero exit, probe swap, workflow/README/doc wiring, rotation test proofs.
- Not doing: per-account 429 ramping in the probe (explicit follow-up in the FRD), re-tuning `judgePost`'s 2-attempt semantics, concurrency-ceiling changes, any new runtime dependency, historical artifact rewrites.

## Testing Strategy

**Unit tests:**
- Resolver: valid JSON array, missing/blank env, malformed JSON, empty array — each error names `LLM_ACCOUNTS` (rewrite `tests/judge.test.ts:49-66`).
- First-429 rotates with no backoff: call-counting `mockFetch` + first-ever header capture (extend `measuredFetch`, `:234-248`) proving call 2 carries account 2's `Authorization` with no timer advance.
- Sticky pointer: batch 2's first recorded call carries account 2 (two-bulk idiom `:273-290`); fallback phase inherits the bulk pointer.
- 5xx keeps same-account backoff: first `mock.timers` use in the suite (`sleep`'s comment at `src/judge.ts:52` anticipates it).
- Transport error defers without rotating: clone of `:368-385` + same-key assert.
- Exhaustion: `assert.throws` (`:65` convention) with the typed error carrying the per-account record; unjudged posts stay out of state (structural — the throw bypasses `src/index.ts:122-124`).
- New email sender: fake-transporter capture/count idioms (`tests/email.test.ts:195-234`).

**Integration tests:**
- Full rotation across two bulk batches + fallback in one `judgePosts` run.
- Concurrent 429s across the four workers: pointer advances without skipping or double-use (existing out-of-order choreography as the base).

**Manual verification:**
- [ ] Dead-account-1 dry run: put a bogus key first, valid account second — run completes on account 2; log lines name the accounts.
- [ ] All-dead run: every key bogus — exactly one exhaustion email, exit code 1, no state commit in the Actions log.
- [ ] Probe against `LLM_ACCOUNTS` with account 1 only: latency numbers match the pre-swap baseline.

## Open Questions

**Resolved during research:**
- Where does the pointer live so four concurrent workers stay coherent? — Inside `judgePosts`, captured by the worker closures exactly like `next` (`src/judge.ts:444-448`); reads at fetch-construction, advances synchronous (proven by `tests/judge.test.ts:433-500`).
- How does exhaustion reach the email + exit? — Typed error from `judgePosts`; existing catch (`src/index.ts:151-155`) sends via a new `email.ts` builder+sender and exits 1; the success-gated commit (`watch.yml:65-77`) makes it race-free.
- What happens to the 429 backoff tests? — Replaced by rotation proofs; 5xx backoff proof uses `mock.timers` (first suite use).
- Do stale docs outside the acceptance grep swap too? — Yes, in the same change (`.claude/skills/validate-e2e/SKILL.md:13`, `AGENTS.md:18`, `:21`).

**Requires user input:**
- None — every branch was resolved in the discover interview and the candidate checkpoint.

**Blockers:**
- None. One design-stage detail to settle during design: the exact signature shape for the injected `rotate`/`record` callbacks (parameter object vs. two functions) — no behavioral impact either way.

## References

- `.rpiv/artifacts/research/2026-10-26_14-47-19_llm-account-rotation.md` — seam-level research this analysis is built on (all anchors re-verified)
- `.rpiv/artifacts/discover/2026-10-26_14-27-50_llm-account-rotation.md` — FRD with all developer decisions
- `.rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md` — judge-stage load-testing lessons (Z.AI dynamic rate limits)
- `.rpiv/artifacts/validation/2026-10-26_11-01-22_model-judged-keywords.md` — base-URL fail-visible validation precedent
- `src/judge.ts:444-448` — the lock-free cursor pattern the recommendation clones
- `src/config-file.ts:87-152` — validation rules to mirror in the pool parser
