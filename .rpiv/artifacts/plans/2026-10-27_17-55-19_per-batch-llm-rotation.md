---
date: 2026-10-27T17:55:19+0700
author: Yogiswara Utama
commit: 11a1938
branch: main
repository: loker-watcher
topic: per-batch-llm-rotation
tags: [plan, judge, rotation, cooldown, park, budget, probe, concurrency]
status: ready
parent: .rpiv/artifacts/solutions/2026-10-27_16-40-05_per-batch-llm-rotation.md
phase_count: 5
phases:
  - { n: 1, title: Time seam, files: [src/judge.ts, src/index.ts, tests/judge.test.ts], depends_on: [] }
  - { n: 2, title: Cooldown core, files: [src/judge.ts, tests/judge.test.ts], depends_on: [1] }
  - { n: 3, title: Park and wait budget, files: [src/judge.ts, tests/judge.test.ts], depends_on: [2] }
  - { n: 4, title: Alarm acceptance, files: [src/judge.ts, src/index.ts, tests/index.test.ts], depends_on: [3] }
  - { n: 5, title: Probe and gating, files: [scripts/probe-judge.ts, .github/workflows/watch.yml], depends_on: [] }
unresolved_phase_count: 0
last_updated: 2026-10-27T17:55:19+0700
last_updated_by: Yogiswara Utama
---

# Per-Batch LLM Account Rotation Implementation Plan

## Overview

Replace the run-sticky rotation pointer in the judge with a batch-local pool scan over a shared 60-second cooldown map, an in-loop park that rides out rate limits under a shared 5-minute wait budget, and a pool-ordered failure-record synthesizer that feeds the unchanged exhaustion-alarm chain. The judge gains injectable `now`/`sleepFn` trailing parameters so every timing behavior is testable offline. `scripts/probe-judge.ts` probes every account (stop-once-4 ramp) and its workflow job turns gating.

## Requirements

- Rotation restarts at account 1 every batch; a 429'd account cools for a flat 60 seconds (FRD acceptance bullet 1: stamp account 1, tick 60s, the next batch lands back on account 1).
- When every account is cooling, the run waits in-loop up to a 5-minute cooldown-wait-only budget and then completes the backlog (FRD bullet 2).
- Budget expiry throws the existing `RotationExhausted` with a synthesized, non-empty, pool-ordered failure record; alarm email + exit 1 unchanged (FRD bullet 3).
- `scripts/probe-judge.ts` probes every account; the probe job in `.github/workflows/watch.yml` turns gating (FRD bullet 5: a dead account reddens the run).
- Repo non-negotiables hold: fail-visible, atomic state, strict TS flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), no new runtime dependency.

## Current State Analysis

The judge rotates with a run-sticky pointer: `RotationState {accounts, index, failures}` (`src/judge.ts:93-97`), created once in `judgePosts` (`:650`) and shared by reference with every worker. The compare-and-set `rotateOnRateLimit` (`:378-391`) advances the pointer exactly once per 429 burst; one 429 moves the run off an account permanently. Run 40463798717 proved the failure mode: a momentary burst-429 cascades the whole pool in one hop — 327 posts went unjudged.

### Key Discoveries

- **Sync-window discipline is the only concurrency guard.** Dispatch-time pointer reads sit before the first await (`src/judge.ts:433` bulk, `:547` post); the "read and advance with no await between" comment block (`:87-91` region, `:425-430`) documents it. No locks anywhere. The new pool scan must stay synchronous and pre-await.
- **The 5xx backoff is the park's mechanical template** (`:476-483`): `RETRY_DELAYS_MS` + `await sleep(delay)` (`:482`, module-private `sleep` at `:78`) + `continue`. The park copies this shape at the loop TOP, outside the try.
- **Four throw sites feed the alarm chain**: `judgePost` loop-top `:550` and 429 arm `:576`; `judgePosts` bulk join `:679-680` and fallback join `:754-755`. The catch in `runWatcher`'s entry guard (`src/index.ts:296-313`) consumes `error.failures` verbatim; `sendExhaustionEmail` (`src/email.ts:182`) silently skips an empty record — the synthesizer must make non-empty-by-construction so that path stays dead (`tests/email.test.ts:324-337` pins the silent path).
- **Throw-through-try hazard**: the bulk 429 arm sits inside a try whose catch converts anything thrown to a transport outcome. The park must return a sentinel, never throw; budget-expiry conversion happens at outside-try loop-top guards only.
- **No injected-sleep precedent exists** (verified repo-wide): `fetchFn: typeof fetch = fetch` (`:541`, `:645`) is the convention to extend for `sleepFn`; the function-form clock `now: () => number = Date.now` (`src/index.ts:85` `timeStage`) is the convention for `now`.
- **Merge d8fc15b landed first** (advisor decision, done): HEAD is `11a1938`. `reasoningEffort` sits BEFORE `concurrency` in all three judge signatures (`:416-421`, `:537-542`, `:642-648`); the new time params go last. The reasoning-effort test blocks (`tests/judge.test.ts:981+`) assert payload shape only — the rewrite must not disturb them.
- **mock.timers is disqualified**: four real-timer yield sites in `tests/judge.test.ts` (`:385`, `:409`, `:774`, `:828` setTimeout yields, `:920-930` polling loop) deadlock a frozen clock. Only injected `now`/`sleepFn` works.
- **Consumers are exactly**: production `judgePosts` call `src/index.ts:192-200`; test calls in `tests/judge.test.ts`; `freshState` (`tests/judge.test.ts:46-48`, 5 construction sites); `scripts/probe-judge.ts:163` (`resolveJudgeConfig(process.env)[0]`). Nothing else imports the rotation internals.
- **Probe reads only accounts[0]** today (`scripts/probe-judge.ts:163-171`); `watch.yml:21` carries `continue-on-error: true` with the accounts[0] rationale (`:18-20`) that dies with this change.

## Desired End State

A burst-429 no longer kills the run. One batch's perspective:

```ts
// account 1 429s at t=0 → cools until t=60_000; the batch retries on account 2
// account 2 429s too → both cooling → the batch parks (in-loop) until t=60_000+jitter
// wake → scan restarts at account 1 → dispatched → digest completes
```

A sustained outage burns the shared 5-minute budget, then:

```ts
// judgePosts rejects with RotationExhausted; failures are synthesized in pool order:
// [{account: 1, baseUrl: "...", reason: "HTTP 429"}, {account: 2, ...}]
// entry guard sends exactly one exhaustion email and exits 1 (unchanged chain)
```

The next run (10 minutes later) starts every account cool and dispatches account 1 first. The probe covers every account and a dead key reddens the dispatch run.

## What We're NOT Doing

- Frame requeue machinery (rejected and locked at the research checkpoint).
- Cooldown escalation or per-provider policies — flat 60s (FRD-decided).
- Budget-driven abort of in-flight fetches — wait-only (developer decision this session); the 8-minute envelope race (`watch.yml:47` timeout vs 300s waits + 60s abort tail) is documented, not solved.
- SMTP timeouts on the transport (`src/email.ts:93-99`, pre-existing, out of FRD scope).
- Config surface for cooldown/budget/jitter — module constants (repo doctrine: only probe-measured values are env-tunable).
- Any change to `src/types.ts`, `src/email.ts`, `src/config.ts`, `src/config-file.ts` — the alarm chain's files are exactly the ones that don't change.
- Provider-side secret rotation is an ops task (see Migration Notes), not a code change.

## Decisions

### Overwrite policy: first-write-wins (asked; answered)

When a second 429 hits an already-cooling account, the map keeps the earlier expiry. A 429 costs 60 seconds, never more — preserves the module's stated contract (`src/judge.ts:13-15`). Max-wins (sliding window) rejected: a sustained burst could starve an account indefinitely.

### Time seam: now + sleepFn trailing defaults (directional confirm; follow)

`now: () => number = Date.now` copies `timeStage` (`src/index.ts:85`); `sleepFn: (ms: number) => Promise<void> = sleep` copies `fetchFn` (`src/judge.ts:541`, `:645`). Both are REQUIRED together — `now`-only hangs in the park, `sleepFn`-only cannot do expiry math. Threaded `judgePosts` → `judgeBatch` (module-private, required params there) and `judgePosts` pool → `judgePost`. `src/index.ts` forwards `deps.now` once.

### Budget placement: required cell on the state object (solutions-resolved)

`RotationState` becomes `{accounts, cooldownUntil: Map<number, number>, waitBudgetRemainingMs}`. A bare frame `let` cannot be captured by module-level `judgeBatch`/`judgePost`. One shared cell for BOTH phases — the bulk and fallback pools each have their own work cursor, but the wait budget must not be per-phase.

### Park returns a sentinel, never throws (solutions-resolved hazard mitigation)

At the loop top (outside try): pick → none eligible → park (charge budget before sleep, re-charge actual elapsed after wake, jitter on expiry) → `continue`. Budget spent → terminal conversion AT the loop top: `judgeBatch` returns `{status: "exhausted"}`; `judgePost` throws. No throw ever crosses the 429-arm catch.

### Record synthesis at throw time (solutions-resolved)

`failures` leaves the state object. A synthesizer iterates `accounts` in pool order, emits one `AccountFailure` per cooling map entry, 1-based `account`. At budget death every account is cooling, so the record is non-empty by construction — pinned by a `failures.length === accounts.length` assertion. `AccountFailure` (`src/types.ts:33-40`) needs no schema change.

### Probe: every account, stop-once-4 ramp, gating flag (asked; answered)

Per-account legs (minimal, bulk, variance, ramp that stops once 4 concurrent calls verified — up to ~6 calls/account, matching the shipped `JUDGE_CONCURRENCY: "4"`). Exit 1 when any account has a failed leg, an auth-dead response (401/403), or ceiling < 1. `watch.yml:21` drops `continue-on-error`; the accounts[0] rationale comment is rewritten.

### Merge order: d8fc15b landed first (advisor; DONE)

HEAD is `11a1938`. All anchors in this plan cite the merged tree.

## Phase 1: Time seam

### Overview

Adds the injectable clock and sleep as trailing defaulted parameters on `judgePosts`/`judgePost` (required on module-private `judgeBatch`), forwards `deps.now` at the production call site, and adopts an inert sleep in the 502-backoff test to kill its real ~1s wait. No behavior change. Depends on nothing; Phases 2-4 build on it (Phase 5 is independent).

### Changes Required:

#### 1. src/judge.ts

**File**: src/judge.ts

**Changes**: MODIFY — extend the three judge signatures with trailing `now`/`sleepFn` params; thread them to the 5xx backoff sleep and both worker pass-throughs. `judgeBatch`'s time params are REQUIRED (sole caller passes them; `reasoningEffort`'s default trails). Verified across four slice-verifier passes.

Add the alias after the module `sleep` const (src/judge.ts:78):

```ts
/** Injectable wait seam: production is the module sleep; tests pass an inert recorder. */
type SleepFn = (ms: number) => Promise<void>;
```

`judgeBatch` signature (was `(batch, state, keywords, fetchFn, batchIndex, reasoningEffort = "medium")`):

```ts
async function judgeBatch(
  batch: readonly Post[],
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch,
  batchIndex: number,
  now: () => number,
  sleepFn: SleepFn,
  reasoningEffort: ReasoningEffort = "medium",
): Promise<BatchOutcome> {
```

The 5xx same-account backoff (src/judge.ts:482) draws the injected sleep:

```ts
          await sleepFn(delay);
          continue;
```

`judgePost` signature (was `(post, state, keywords, fetchFn = fetch, reasoningEffort = "medium")`); `sleepFn` is unused until the Phase 3 park — the param is the seam, no behavior change:

```ts
export async function judgePost(
  post: Post,
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
  now: () => number = Date.now,
  sleepFn: SleepFn = sleep,
): Promise<JudgeVerdict | null> {
```

`judgePosts` signature (was `(candidates, accounts, keywords, fetchFn = fetch, reasoningEffort = "medium", concurrency = DEFAULT_JUDGE_CONCURRENCY)`):

```ts
export async function judgePosts(
  candidates: readonly Post[],
  accounts: readonly LlmAccount[],
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
  concurrency: number = DEFAULT_JUDGE_CONCURRENCY,
  now: () => number = Date.now,
  sleepFn: SleepFn = sleep,
): Promise<JudgeBatchResult> {
```

Bulk-worker pass-through (src/judge.ts:669):

```ts
      outcomes[index] = await judgeBatch(
        batch,
        state,
        keywords,
        fetchFn,
        index,
        now,
        sleepFn,
        reasoningEffort,
      );
```

Fallback-worker pass-through (src/judge.ts:736):

```ts
          const verdict = await judgePost(
            item.post,
            state,
            keywords,
            fetchFn,
            reasoningEffort,
            now,
            sleepFn,
          );
```

#### 2. src/index.ts

**File**: src/index.ts

**Changes**: MODIFY — forward `now` as the last argument of the production `judgePosts` call (the run clock is already bound as `now` at src/index.ts:139; `sleepFn` is omitted and defaults to the module sleep — no behavior change).

```ts
  const { value: judgeOutcome, durationMs: judgeMs } = await timeStage(() =>
    judgePosts(
      newPosts,
      resolveJudgeConfig(env),
      config.keywords,
      deps.fetchFn,
      config.reasoningEffort,
      parseJudgeConcurrency(env[ENV_NAMES.judgeConcurrency]),
      now,
    ),
  );
```

#### 3. tests/judge.test.ts

**File**: tests/judge.test.ts

**Changes**: MODIFY — the 502-backoff pin (tests/judge.test.ts:901) injects an inert `sleepFn`: the real ~1s wait becomes an assertion on the received delays. Original intent preserved (same-account retry, no rotation, 2 calls).

```ts
  it("retries a 5xx on the same account with backoff, never rotating", async () => {
    const posts = [bulkPost(id19(1))];
    const auths: string[] = [];
    const delays: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    };
    let calls = 0;
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      calls += 1;
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (calls === 1) {
        return new Response("Bad Gateway", { status: 502 });
      }
      return ok(bulkContent(posts.map((p) => p.id)));
    }) as unknown as typeof fetch;
    const result = await judgePosts(
      posts,
      twoAccounts(),
      KEYWORDS,
      mockFetch,
      "medium",
      4,
      Date.now,
      inertSleep,
    );
    assert.equal(calls, 2); // 502 retry — injected delay, not real
    assert.deepEqual(delays, [1_000]); // RETRY_DELAYS_MS[0]
    assert.equal(result.judged.length, 1);
    assert.ok(auths.every((auth) => auth.includes("key-1"))); // a 5xx never rotates
  });
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint + format pass scoped to this phase's files: `npx biome check src/judge.ts src/index.ts tests/judge.test.ts`
- [x] Judge suite passes with the rewritten 5xx test: `npx tsx --test tests/judge.test.ts`
- [x] `grep -c "await sleep(" src/judge.ts` returns 0 and `grep -c "await sleepFn(" src/judge.ts` returns 1 (the 5xx arm) — no direct sleep call sites remain

#### Manual Verification:
- [x] The rotation "no backoff wait" test still passes (elapsed < 500ms) — no timing behavior changed
- [x] Every existing `judgePosts`/`judgePost` test call site still typechecks unchanged (positional 4th/5th/6th args untouched)

## Phase 2: Cooldown core

### Overview

Reshapes `RotationState` to `{accounts, cooldownUntil: Map<number, number>, waitBudgetRemainingMs}`, deletes the CAS, adds the synchronous pool-scan pick, the first-write-wins cool guard, and the pool-ordered record synthesizer; rewrites the 429 arms to cool-and-rewind and the throw sites to synthesize. Without the park (Phase 3), all-cooling converts to the terminal outcome immediately — same shape as today's exhaustion, now batch-local. Depends on Phase 1.

### Changes Required:

#### 2. src/judge.ts

**File**: src/judge.ts

**Changes**: MODIFY — state reshape (`{accounts, cooldownUntil, waitBudgetRemainingMs}`), pool-scan pick, first-write-wins cool guard, pool-ordered record synthesizer, 429-arm rewrites (cool + rewind, no throw inside try), throw-site rewrites (synthesize at loop tops/joins), `rotateOnRateLimit` deleted. Verified across two slice-verifier passes.

Module header rotation sentence (src/judge.ts:10-15) becomes:

```ts
 * HTTP 429 is account-local: the account cools for a flat 60 seconds
 * (first-write-wins — a 429 costs 60 seconds, not more) and every dispatch
 * scans the pool from account 1, skipping accounts that are still cooling.
 * A 5xx is retried on the same account with bounded backoff before the
 * batch is deferred; a transport error defers immediately without cooling
 * anything. When every account is cooling the run throws the tagged
 * RotationExhausted error with a pool-ordered record (one exhaustion email,
 * exit 1 — surfaced by index.ts). Batches drain through a bounded pool of
```

New constants after RETRY_DELAYS_MS (src/judge.ts:75):

```ts
/**
 * Flat cooldown for a rate-limited account. First-write-wins: while an
 * account is cooling, a second 429 never extends the window — a 429 costs
 * 60 seconds, not more. Unmeasured values stay constants.
 */
const COOLDOWN_MS = 60_000;

/**
 * Shared in-run park budget (both judge phases draw the same cell). Phase 2
 * carries it on the state object untouched; the Phase 3 park is its
 * consumer. Unmeasured value stays a constant.
 */
const WAIT_BUDGET_MS = 300_000;
```

`RotationState` reshape (was `{accounts, index, failures}` at src/judge.ts:93-97):

```ts
/**
 * Run-level rotation state, owned by judgePosts and shared by reference with
 * every worker — the same closure-shared mutable pattern as the `next` batch
 * cursor (read and advance with no await between). There is no sticky
 * pointer: every dispatch scans the pool from account 1 and skips accounts
 * that are still cooling, so a batch that starts after an account's cooldown
 * expires lands back on account 1.
 */
export interface RotationState {
  readonly accounts: readonly LlmAccount[];
  /** 0-based account index -> expiry reading from the injected `now`. */
  readonly cooldownUntil: Map<number, number>;
  /** Shared park budget, drawn down by the Phase 3 park; constant until then. */
  waitBudgetRemainingMs: number;
}
```

DELETE `rotateOnRateLimit` (src/judge.ts:378-391) entirely. In its place, three helpers (same region, before judgeBatch):

```ts
/**
 * First dispatchable account, scanning the pool in order from account 1 —
 * the batch-local cursor. A missing or expired entry makes an account
 * dispatchable; an active cooldown (expiry > now) skips it. Synchronous and
 * pre-await: the caller dispatches inside the same sync window as the old
 * pointer read.
 */
function pickEligibleAccount(
  state: RotationState,
  nowMs: number,
): { index: number; account: LlmAccount } | undefined {
  for (const [index, account] of state.accounts.entries()) {
    const expiry = state.cooldownUntil.get(index);
    if (expiry === undefined || expiry <= nowMs) {
      return { index, account };
    }
  }
  return undefined;
}

/**
 * Stamp a rate-limited account as cooling until now + COOLDOWN_MS.
 * First-write-wins: an account that is ALREADY cooling keeps its earlier
 * expiry, so a burst of concurrent 429s dedups to one window and cannot
 * extend it. An expired entry re-stamps cleanly (it is no longer cooling).
 */
function coolAccount(state: RotationState, accountIndex: number, nowMs: number): void {
  const existing = state.cooldownUntil.get(accountIndex);
  if (existing === undefined || existing <= nowMs) {
    state.cooldownUntil.set(accountIndex, nowMs + COOLDOWN_MS);
  }
}

/**
 * Build the exhaustion record from the cooldown map, in pool order — one
 * AccountFailure per cooldown-map entry, 1-based `account` per src/types.ts.
 * Entry existence (not current expiry) is the criterion: a map entry proves
 * the account was rate-limited THIS run, and drain-then-throw can outlive a
 * 60s window, so a freshness filter could shrink or empty the record and
 * revive the empty-record email-silent path in src/email.ts. Throw sites
 * fire only when the pick found nothing — every account carries an entry —
 * so the record is non-empty by construction.
 */
function failuresFromCooldowns(state: RotationState): AccountFailure[] {
  const failures: AccountFailure[] = [];
  for (const [index, account] of state.accounts.entries()) {
    if (state.cooldownUntil.has(index)) {
      failures.push({ account: index + 1, baseUrl: account.baseUrl, reason: "HTTP 429" });
    }
  }
  return failures;
}
```

`judgePost` JSDoc paragraph ("HTTP 429 rotates the pool pointer...") becomes:

```ts
 * HTTP 429 cools the account exactly like judgeBatch (no backoff); the
 * cooldown does not spend a fallback attempt. When every account is
 * cooling, the loop-top guard throws the tagged RotationExhausted error —
 * judgePost runs in judgePosts' parallel fallback pool, whose workers
 * catch the throw, stop claiming work, and re-throw after the join
 * (drain-then-throw, same as the bulk phase). Other failures keep the
 * original status-agnostic retry.
```

`judgeBatch` JSDoc opening paragraphs ("One bulk call for up to BATCH_SIZE posts against the current account." + the compare-and-set rotation paragraph) become:

```ts
/**
 * One bulk call for up to BATCH_SIZE posts against the first dispatchable
 * account.
 *
 * HTTP 429 is account-local: the account cools for COOLDOWN_MS
 * (first-write-wins) and the same call re-picks past every cooling account
 * with NO backoff wait. When every account is cooling the batch reports
 * "exhausted" and judgePosts throws after the join.
 *
```

(the remaining 5xx / transport paragraphs of the JSDoc continue unchanged.)

`judgeBatch` loop head (replaces the attemptIndex read + account-undefined guard):

```ts
    // Pool scan at the top of every attempt, BEFORE the first await — the
    // same sync window as the old pointer read: nothing can interleave
    // between the pick and the fetch dispatch. attemptIndex is the
    // dispatch-time observation — the account this call actually hit — and
    // is what the cool guard stamps when the 429 comes back.
    const picked = pickEligibleAccount(state, now());
    if (picked === undefined) {
      // Every account is cooling. Terminal conversion happens here, at the
      // loop top and OUTSIDE the try below: a throw from the 429 arm would
      // be swallowed by the catch and misread as a transport error. (Phase
      // 3 inserts the in-loop park ahead of this arm.)
      return { status: "exhausted" };
    }
    const { index: attemptIndex, account } = picked;
```

`judgeBatch` 429 arm (replaces the rotateOnRateLimit call + rotated boolean):

```ts
        if (response.status === 429) {
          coolAccount(state, attemptIndex, now());
          console.warn(
            `judge: batch ${batchIndex} account ${attemptIndex + 1} HTTP 429 — cooling`,
          );
          // Rewind: the retry re-picks past every cooling account. The pick
          // cannot return a cooling account, so each 429 iteration cools a
          // distinct account and the loop stays bounded by the pool size
          // (re-arming an expired entry mid-call needs a full 60s stall,
          // which the request timeout bounds per attempt).
          attempt -= 1;
          continue;
        }
```

`judgePost` loop head (replaces :547-551):

```ts
    const picked = pickEligibleAccount(state, now());
    if (picked === undefined) {
      // Every account is cooling. Terminal conversion at the loop top,
      // OUTSIDE the try below — the catch converts anything thrown to a
      // logged transport outcome. (Phase 3 inserts the park ahead of this.)
      throw rotationExhausted(failuresFromCooldowns(state));
    }
    const { index: attemptIndex, account } = picked;
```

`judgePost` 429 arm (replaces the rotateOnRateLimit call + inside-try throw at :571-577):

```ts
        if (response.status === 429) {
          coolAccount(state, attemptIndex, now());
          console.warn(
            `judge: post ${post.id} account ${attemptIndex + 1} HTTP 429 — cooling`,
          );
          // Rewind: the retry re-picks past every cooling account; the
          // loop-top guard throws when the pick finds none (never here —
          // a throw inside this try would be swallowed by the catch).
          attempt -= 1;
          continue;
        }
```

`judgePosts` state construction (:650):

```ts
  const state: RotationState = {
    accounts,
    cooldownUntil: new Map(),
    waitBudgetRemainingMs: WAIT_BUDGET_MS,
  };
```

Both `judgePosts` throw sites synthesize (:679-680 bulk join, :754-755 fallback join):

```ts
  if (outcomes.some((outcome) => outcome?.status === "exhausted")) {
    throw rotationExhausted(failuresFromCooldowns(state));
  }
```

```ts
    if (exhausted) {
      throw rotationExhausted(failuresFromCooldowns(state));
    }
```

`judgePosts` doc paragraph ("Rotation state lives in this frame (run-sticky)...") becomes:

```ts
 * Rotation state lives in this frame: a cooldown map plus the shared park
 * budget, shared by reference with every worker exactly like the next
 * cursor below — all reads and writes are synchronous, so four workers
 * stay coherent without locks. There is no sticky pointer: every dispatch
 * scans from account 1 and skips cooling accounts, so a batch that starts
 * after an account's cooldown expires lands back on account 1.
```

#### 3. tests/judge.test.ts

**File**: tests/judge.test.ts

**Changes**: MODIFY — `freshState` becomes the cooldown-state builder; the eight rotation pins rewrite to cooldown semantics; new clusters for the cool guard (first-write-wins re-stamp rule), record synthesis (pool order, non-empty), and the FRD bullet-1 restart proof on a hand-stepped clock. Verified across two slice-verifier passes.

`freshState` (:46-48):

```ts
/** Fresh run-level state for direct judgePost calls. */
function freshState(accounts: LlmAccount[]): RotationState {
  // waitBudgetRemainingMs mirrors the module-private 5-minute WAIT_BUDGET_MS.
  return { accounts, cooldownUntil: new Map(), waitBudgetRemainingMs: 300_000 };
}
```

REWRITE "judgePost rotates on a 429 without spending a fallback attempt" (:282) — map assertion replaces index/failures:

```ts
  it("judgePost cools a 429'd account and retries on the next without spending a fallback attempt", async () => {
    const state = freshState(twoAccounts());
    const auths: string[] = [];
    let tick = 0;
    const now = (): number => tick;
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (String(url).includes("account-one")) {
        tick = 1_000; // the 429 lands at t=1s; account 1 cools until t=61s
        return new Response("Too Many Requests", { status: 429 });
      }
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const verdict = await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now);
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
    assert.equal(auths.length, 2); // the cooling account is skipped, never retried
    assert.match(auths[0] ?? "", /account-one\.api .*key-1$/);
    assert.match(auths[1] ?? "", /account-two\.api .*key-2$/);
    assert.equal(state.cooldownUntil.get(0), 61_000); // first write: 1_000 + COOLDOWN_MS
  });
```

REWRITE "judgePost throws the tagged error when rotation runs out mid-fallback" (:303):

```ts
  it("judgePost throws the tagged error with a pool-ordered record when every account is cooling", async () => {
    const state = freshState(twoAccounts());
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    const failures = (caught as RotationExhausted).failures;
    assert.deepEqual(failures.map((f) => f.account), [1, 2]); // pool order, 1-based
    assert.ok(failures.every((f) => f.reason === "HTTP 429"));
  });
```

REWRITE "drain-then-throw: a pool exhausted mid-fallback rejects judgePosts with the complete record" (:731):

```ts
  it("drain-then-throw: every account cooling rejects judgePosts with the complete pool-ordered record", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = (async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("{}"); // answered, zero verdicts — every post falls back
      }
      return new Response("Too Many Requests", { status: 429 }); // both accounts cool
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch);
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as RotationExhausted).failures.map((f) => f.account),
      [1, 2],
    );
  });
```

REWRITE "rotates to account 2 on the first 429 with no backoff wait" (:858) — same observable, new name:

```ts
  it("cools to account 2 on the first 429 with no backoff wait", async () => {
    const posts = [bulkPost(id19(1))];
    const auths: string[] = [];
    const started = Date.now();
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, accountTwoAnswering(auths));
    const elapsed = Date.now() - started;
    assert.equal(result.judged.length, 1);
    assert.match(auths[0] ?? "", /account-one\.api .*key-1$/);
    assert.match(auths[1] ?? "", /account-two\.api .*key-2$/);
    assert.ok(elapsed < 500, `rotation must not sleep — took ${elapsed}ms`);
  });
```

REWRITE "keeps the sticky pointer across the fallback phase" (:870) — test body UNCHANGED from HEAD :870-899 (its assertions already hold under scan semantics); new name + framing comment:

```ts
  it("skips a still-cooling account when the fallback scan restarts at account 1", async () => {
    // The bulk call 429s account 1, lands on account 2, and answers the
    // FIRST listed id only, so the second post falls back. The fallback
    // scan restarts at account 1, finds it still cooling, and dispatches
    // account 2 — the observable dispatch order is unchanged; the
    // mechanism is the map, not a pointer.
    const a = bulkPost(id19(1));
    const b = { ...bulkPost(id19(2)), text: "Second post text" };
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (String(url).includes("account-one")) {
        return new Response("Too Many Requests", { status: 429 });
      }
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
        response_format?: unknown;
      };
      // Bulk calls answer the FIRST listed id only, so the second post falls
      // back; a single-post call (no response_format rider) answers itself.
      if (body.response_format === undefined) {
        return ok('{"relevant": true, "locationOk": true}');
      }
      const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
        (match) => match[1] ?? "",
      );
      return ok(bulkContent(ids.slice(0, 1)));
    }) as unknown as typeof fetch;
    const result = await judgePosts([a, b], twoAccounts(), KEYWORDS, mockFetch);
    assert.equal(result.judged.length, 2);
    assert.equal(auths.length, 3); // 429 call, bulk call, fallback call
    assert.match(auths[0] ?? "", /key-1$/);
    assert.ok(auths.slice(1).every((auth) => auth.includes("key-2")));
  });
```

REWRITE "defers a batch on a transport error without rotating" (:920) — test body UNCHANGED from HEAD :920-936; new name:

```ts
  it("defers a batch on a transport error without cooling any account", async () => {
    const posts = [bulkPost(id19(1))];
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch);
    assert.equal(result.judged.length, 0);
    assert.deepEqual(
      result.skippedPostIds,
      posts.map((p) => p.id),
    );
    assert.equal(auths.length, 1); // zero retries
    assert.match(auths[0] ?? "", /key-1$/); // the scan never moved — nothing cooled
  });
```

HARD REWRITE "advances the pointer exactly once per account under concurrent 429s" (:938) — the CAS pin becomes the scan-dedup pin:

```ts
  it("cools each account once under concurrent 429s and keeps the record pool-ordered", async () => {
    const posts = Array.from({ length: 40 }, (_, i) => bulkPost(id19(i + 1))); // 4 batches
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      return new Response("Too Many Requests", { status: 429 });
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await judgePosts(posts, threeAccounts(), KEYWORDS, mockFetch);
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    const failures = (caught as RotationExhausted).failures;
    // The synthesizer's proof: exactly one record per account, in pool
    // order — the map collapsed every concurrent 429 into one cooling
    // window per account, and every account was still cooling at the
    // terminal conversion.
    assert.deepEqual(failures.map((f) => f.account), [1, 2, 3]);
    assert.ok(failures.every((f) => f.reason === "HTTP 429"));
    // The dispatch cascade still visited later accounts from more than one
    // worker: a vacuous scan (one worker walking the pool alone) would
    // serialize the burst behind a single worker.
    const count = (key: string): number => auths.filter((auth) => auth.includes(key)).length;
    assert.ok(count("key-2") >= 2, `account 2 dispatched ${count("key-2")} time(s)`);
    assert.ok(count("key-3") >= 2, `account 3 dispatched ${count("key-3")} time(s)`);
    // Per-worker monotonicity: no call on a lower account's key after the
    // first call on a higher one — cooling windows outlive the burst.
    const firstKey2 = auths.findIndex((auth) => auth.includes("key-2"));
    const lastKey1 = auths.map((auth) => auth.includes("key-1")).lastIndexOf(true);
    assert.ok(firstKey2 > lastKey1);
    const firstKey3 = auths.findIndex((auth) => auth.includes("key-3"));
    const lastKey2 = auths.map((auth) => auth.includes("key-2")).lastIndexOf(true);
    assert.ok(firstKey3 > lastKey2);
  });
```

NEW cluster — expired entries re-stamp (the reachable half of first-write-wins):

```ts
  it("re-stamps an expired cooldown so a cooled account becomes dispatchable again", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    // An expired entry is dispatchable again; the fresh 429 re-stamps it.
    state.cooldownUntil.set(0, Date.now() - 1_000);
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    const restamped = state.cooldownUntil.get(0);
    assert.ok(restamped !== undefined && restamped > Date.now());
  });
```

NEW cluster — the FRD bullet-1 restart proof, serial width so batch order is deterministic:

```ts
  it("restarts at account 1 once the cooldown expires (batch-local scan)", async () => {
    const posts = Array.from({ length: 30 }, (_, i) => bulkPost(id19(i + 1))); // 3 batches
    const auths: string[] = [];
    let tick = 0;
    const now = (): number => tick;
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      const firstId = content.match(/\b\d{16,}\b/)?.[0] ?? "";
      const batch = Math.floor(posts.findIndex((p) => p.id === firstId) / 10);
      if (String(url).includes("account-one") && batch === 0) {
        tick = 1_000; // the 429 lands at t=1s; account 1 cools until t=61s
        return new Response("Too Many Requests", { status: 429 });
      }
      // Each answered call completes later in wall-clock time: batch 0's
      // answer still lands inside the cooldown window, batch 1's lands
      // after it — so batch 2's dispatch scan finds account 1 eligible.
      tick = batch === 0 ? 2_000 : 62_000;
      const ids = [...content.matchAll(/id (\d+) by @/g)].map((match) => match[1] ?? "");
      return ok(bulkContent(ids));
    }) as unknown as typeof fetch;
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch, "medium", 1, now);
    assert.equal(result.judged.length, 30);
    assert.match(auths[0] ?? "", /key-1$/); // batch 0 first try
    assert.match(auths[1] ?? "", /key-2$/); // batch 0 retry after the 429
    assert.match(auths[2] ?? "", /key-2$/); // batch 1 at t=2s — account 1 still cooling
    assert.match(auths[3] ?? "", /key-1$/); // batch 2 at t=62s — scan restarts at account 1
  });
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint + format pass scoped to this phase's files: `npx biome check src/judge.ts tests/judge.test.ts`
- [x] Judge suite passes: `npx tsx --test tests/judge.test.ts`
- [x] No pointer machinery remains: `grep -cE "rotateOnRateLimit|state\.index|state\.failures" src/judge.ts` returns 0
- [x] Synthesizer wired at all three throw sites + definition: `grep -c "failuresFromCooldowns" src/judge.ts` returns 4

#### Manual Verification:
- [x] FRD bullet 1 (restart proof) passes with a hand-stepped clock — no real 60s wait
- [x] The alarm chain is untouched: `git diff --stat 11a1938 -- src/types.ts src/email.ts src/index.ts src/config.ts src/config-file.ts` is empty for this phase
- [x] The reasoning-effort payload tests (:981+) still pass untouched

## Phase 3: Park and wait budget

### Overview

Adds the in-loop park on "no eligible account": wait until the earliest expiry plus jitter, charge the budget before sleeping, re-charge the actual elapsed after waking; budget spent converts at the outside-try loop top (bulk returns exhausted, single-post throws). New clusters: budget accounting, park-wake acceptance (FRD bullet 2), budget-death record completeness, throw-escapes-catch regression, no-park-when-eligible. Depends on Phase 2.

### Changes Required:

#### 4. src/judge.ts

**File**: src/judge.ts

**Changes**: MODIFY — the in-loop park (`parkUntilEligible`), `WAKE_JITTER_MS`, both loop-top park-or-terminal rewires, present-tense docs. Charge semantics: full pessimistic wait deducted before sleep, only the overshoot re-charged after, no undershoot refund, clamp at 0, refuse at <= 0. Verified across four slice-verifier passes (every budget trace hand-traced).

New constant after WAIT_BUDGET_MS:

```ts
/**
 * Wake-time jitter. Workers parked on the same earliest expiry would wake
 * and re-dispatch in a thundering herd; a small constant spread smooths
 * that. Unmeasured value stays a constant.
 */
const WAKE_JITTER_MS = 500;
```

WAIT_BUDGET_MS doc becomes present tense:

```ts
/**
 * Shared in-run park budget: the total time both judge phases may spend
 * parked on cooling accounts before the run converts to the exhaustion
 * alarm. Drawn down charge-before-sleep, re-charged with the actual
 * elapsed after wake. Unmeasured value stays a constant.
 */
```

Phase 2's field doc on `RotationState.waitBudgetRemainingMs` becomes present tense:

```ts
  /** Shared park budget: the total wait both judge phases may draw before
   *  the run converts to the exhaustion alarm. */
  waitBudgetRemainingMs: number;
```

Module header: Phase 2's sentence "When every account is cooling the run throws the tagged" becomes:

```ts
 * anything. When every account is cooling the run parks in-loop (a shared
 * 5-minute wait budget — ride out rate limits per batch) and, when the
 * budget is spent, throws the tagged RotationExhausted error with a
 * pool-ordered record (one exhaustion email, exit 1 — surfaced by
 * index.ts). Batches drain through a bounded pool of
```

New helper after `failuresFromCooldowns` (before judgeBatch):

```ts
/**
 * Wait until the earliest cooldown expiry (plus jitter), charging the
 * shared wait budget. Returns true when the park ran and the caller may
 * re-pick; false when the budget is already spent — the caller converts
 * to its terminal outcome. Never throws: the park runs at the loop top,
 * OUTSIDE the try, so a wait can never be misrouted through a catch.
 *
 * Charge-before-sleep: the full pessimistic wait comes off the budget
 * up front, so peers parking concurrently see the remaining budget, not
 * a stale one. After the wake only the OVERSHOOT (actual elapsed beyond
 * the charge — scheduling delay) is deducted further; an undershoot is
 * not refunded. The cell clamps at zero and the next park refuses.
 */
async function parkUntilEligible(
  state: RotationState,
  now: () => number,
  sleepFn: SleepFn,
): Promise<boolean> {
  if (state.waitBudgetRemainingMs <= 0) {
    return false;
  }
  const startedAt = now();
  // Called only when the pick found nothing, so the map is non-empty.
  let earliest = Infinity;
  for (const expiry of state.cooldownUntil.values()) {
    if (expiry < earliest) {
      earliest = expiry;
    }
  }
  const waitMs = Math.max(0, earliest + WAKE_JITTER_MS - startedAt);
  const charge = Math.min(waitMs, state.waitBudgetRemainingMs);
  state.waitBudgetRemainingMs -= charge;
  await sleepFn(charge);
  const elapsed = now() - startedAt;
  const overspend = Math.max(0, elapsed - charge);
  state.waitBudgetRemainingMs = Math.max(0, state.waitBudgetRemainingMs - overspend);
  return true;
}
```

`judgeBatch` loop top (replaces Phase 2's immediate `return { status: "exhausted" }` arm):

```ts
    const picked = pickEligibleAccount(state, now());
    if (picked === undefined) {
      // Every account is cooling: park until the earliest expiry (charging
      // the shared wait budget) and re-pick; a spent budget converts to the
      // terminal outcome here at the loop top, OUTSIDE the try below — a
      // throw from the 429 arm would be swallowed by the catch and misread
      // as a transport error.
      if (!(await parkUntilEligible(state, now, sleepFn))) {
        return { status: "exhausted" };
      }
      attempt -= 1; // the park is a wait, not a retry — do not spend an attempt
      continue;
    }
```

`judgePost` loop top (replaces Phase 2's immediate throw arm):

```ts
    const picked = pickEligibleAccount(state, now());
    if (picked === undefined) {
      // Every account is cooling: park until the earliest expiry (charging
      // the shared wait budget) and re-pick; a spent budget converts to the
      // terminal throw here at the loop top, OUTSIDE the try below — the
      // catch converts anything thrown to a logged transport outcome.
      if (!(await parkUntilEligible(state, now, sleepFn))) {
        throw rotationExhausted(failuresFromCooldowns(state));
      }
      attempt -= 1; // the park is a wait, not a retry — do not spend an attempt
      continue;
    }
```

Phase 2's deferral comments ("(Phase 3 inserts the in-loop park ahead of this arm)" / "(Phase 3 inserts the park ahead of this.)") are removed by these replacements.

#### 5. tests/judge.test.ts

**File**: tests/judge.test.ts

**Changes**: MODIFY — 6 new clusters (budget accounting x2, shared cell, FRD bullet-2 park-wake with pinned sleep log, no-park-when-eligible, throw-escapes-catch regression) + 4 amendments to locked Phase 2 fences (inert sleep so the park path drains instantly). Verified across four slice-verifier passes.

TEST 1 — budget accounting, exact-wake (in the `describe("judgePost")` block):

```ts
  it("charges the shared wait budget per park and dies when the budget is spent", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    // Hand-stepped clock; each wake re-dispatches, the fresh 429 re-stamps,
    // and the next park charges again. Each park sleeps earliest expiry +
    // the 500ms wake jitter: four parks of 60_500 drain 242_000, the fifth
    // caps at the remaining 58_000, the budget hits 0, and the next park
    // refuses — the terminal throw. Expectations couple to WAKE_JITTER_MS.
    let tick = 0;
    const now = (): number => tick;
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      tick += ms; // waking costs exactly the slept time
      return Promise.resolve();
    };
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now, inertSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(sleeps, [60_500, 60_500, 60_500, 60_500, 58_000]);
    assert.equal(state.waitBudgetRemainingMs, 0);
    // Complete record at budget death: one entry per account.
    const failures = (caught as RotationExhausted).failures;
    assert.equal(failures.length, state.accounts.length);
  });
```

TEST 2 — a slow wake re-charges the overshoot:

```ts
  it("re-charges the actual elapsed after a slow wake, draining the budget faster", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    let tick = 0;
    const now = (): number => tick;
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      tick += ms + 5_000; // every wake overshoots by 5s — the park eats it
      return Promise.resolve();
    };
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now, inertSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    // Four 60_500 parks + 5s re-charges leave 38_000; the fifth park caps
    // at it — the overshoot bought less wait, and the next park refuses
    // exactly as in the exact-wake case.
    assert.deepEqual(sleeps, [60_500, 60_500, 60_500, 60_500, 38_000]);
    assert.equal(state.waitBudgetRemainingMs, 0);
  });
```

TEST 3 — the budget cell is shared across calls (the bulk/fallback sharing contract):

```ts
  it("keeps the wait budget shared across calls — a spent budget parks nowhere", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    let tick = 0;
    const now = (): number => tick;
    const inertSleep = (ms: number): Promise<void> => {
      tick += ms;
      return Promise.resolve();
    };
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now, inertSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    assert.equal(state.waitBudgetRemainingMs, 0);
    // A second call on the same state gets no park at all: budget spent,
    // terminal throw immediately — both judge phases draw this one cell.
    const sleeps: number[] = [];
    const countingSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    caught = undefined;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", now, countingSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(sleeps, []);
  });
```

TEST 4 — FRD bullet 2: all-cooling park completes the backlog, zero real delay (in the `describe("judgePosts")` block):

```ts
  it("parks through an all-cooling window and completes the backlog with zero real delay", async () => {
    const posts = Array.from({ length: 20 }, (_, i) => bulkPost(id19(i + 1))); // 2 batches
    const auths: string[] = [];
    const sleeps: number[] = [];
    let tick = 0;
    const now = (): number => tick;
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      tick += ms; // the park wakes exactly at expiry — zero real delay
      return Promise.resolve();
    };
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      const ids = [...content.matchAll(/id (\d+) by @/g)].map((match) => match[1] ?? "");
      if (tick < 60_000) {
        tick += 100; // first-wave 429s land slightly later
        return new Response("Too Many Requests", { status: 429 });
      }
      return ok(bulkContent(ids)); // everything after the park answers
    }) as unknown as typeof fetch;
    const result = await judgePosts(
      posts,
      twoAccounts(),
      KEYWORDS,
      mockFetch,
      "medium",
      1,
      now,
      inertSleep,
    );
    assert.equal(result.judged.length, 20);
    assert.deepEqual(result.skippedPostIds, []);
    // Exactly one park: earliest expiry (60_100) + the 500ms wake jitter,
    // charged from startedAt 200. Zero real delay — the whole wait is the
    // inert sleep's call log.
    assert.deepEqual(sleeps, [60_400]);
    // Wave 1: both accounts 429 (key-1, key-2); the park rides out the
    // window; the retry and batch 2 land back on account 1.
    assert.match(auths[0] ?? "", /key-1$/);
    assert.match(auths[1] ?? "", /key-2$/);
    assert.match(auths[2] ?? "", /key-1$/); // post-park retry
  });
```

TEST 5 — no park while an account is eligible (in the `describe("judgePost")` block):

```ts
  it("never parks while an account is eligible — zero sleeps, zero budget drawn", async () => {
    const state = freshState(twoAccounts());
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (String(url).includes("account-one")) {
        return new Response("Too Many Requests", { status: 429 });
      }
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    let tick = 0;
    const now = (): number => tick;
    const verdict = await judgePost(
      samplePost,
      state,
      KEYWORDS,
      mockFetch,
      "medium",
      now,
      inertSleep,
    );
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
    assert.deepEqual(sleeps, []); // an eligible account never parks
    assert.equal(state.waitBudgetRemainingMs, 300_000); // and never draws budget
  });
```

TEST 6 — throw-escapes-catch regression (in the `describe("judgePosts")` block):

```ts
  it("rejects judgePosts when the fallback phase dies on a spent budget", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = (async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("{}"); // answered, zero verdicts — every post falls back
      }
      return new Response("Too Many Requests", { status: 429 });
    }) as unknown as typeof fetch;
    let tick = 0;
    const now = (): number => tick;
    const inertSleep = (ms: number): Promise<void> => {
      tick += ms;
      return Promise.resolve();
    };

    let caught: unknown;
    try {
      await judgePosts(posts, singleAccount, KEYWORDS, mockFetch, "medium", 4, now, inertSleep);
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as RotationExhausted).failures.map((f) => f.account),
      [1],
    );
  });
```

AMENDMENTS to locked Phase 2 fences — parks would otherwise run REAL ~60.5s sleeps in four tests whose assertions hold; each gains a resolve-only inert sleep so the park path drains instantly, and real time never advances past an active cooldown, so no post-park re-dispatch occurs (verified: :938's monotonicity pins hold; :303/:731 records stay [1,2]; re-stamp stays > Date.now()).

:303-rewrite call becomes:

```ts
    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", Date.now, inertSleep);
    } catch (error) {
      caught = error;
    }
```

:731-rewrite call becomes:

```ts
    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePosts(
        posts,
        twoAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        4,
        Date.now,
        inertSleep,
      );
    } catch (error) {
      caught = error;
    }
```

:938-rewrite call becomes:

```ts
    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePosts(
        posts,
        threeAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        4,
        Date.now,
        inertSleep,
      );
    } catch (error) {
      caught = error;
    }
```

re-stamp test call becomes:

```ts
    state.cooldownUntil.set(0, Date.now() - 1_000);
    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePost(samplePost, state, KEYWORDS, mockFetch, "medium", Date.now, inertSleep);
    } catch (error) {
      caught = error;
    }
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint + format pass scoped to this phase's files: `npx biome check src/judge.ts tests/judge.test.ts`
- [x] Judge suite passes: `npx tsx --test tests/judge.test.ts`
- [x] Park wired at both loop tops + definition: `grep -c "parkUntilEligible" src/judge.ts` returns 3
- [x] Jitter constant in place: `grep -c "WAKE_JITTER_MS" src/judge.ts` returns 2
- [x] The 5xx arm draws no budget (structural): `sed -n '/RETRYABLE_STATUSES.has/,/continue;/p' src/judge.ts` shows only sleepFn + continue — no parkUntilEligible, no waitBudgetRemainingMs

#### Manual Verification:
- [x] FRD bullet 2 passes: exactly one park of 60_400ms (inert) completes the backlog — pinned by the sleep-log assertion
- [x] The whole suite stays offline and fast: every all-cooling path sleeps inert; `npm test` wall time unchanged from Phase 2

## Phase 4: Alarm acceptance

### Overview

Proves the exhaustion alarm contract end-to-end at the `runWatcher` seam: a pool whose every account 429s makes `runWatcher` reject with the tagged error carrying the complete pool-ordered record, the state file stays untouched, and the digest/heartbeat transport never fires. Depends on Phase 3; can run in parallel with Phase 5.

### Changes Required:

#### 6. tests/index.test.ts

**File**: tests/index.test.ts

#### 6. src/judge.ts

**File**: src/judge.ts

**Changes**: MODIFY — one keyword: the module-private production `sleep` (src/judge.ts:78) is exported so the pipeline seam can default `WatcherDeps.sleepFn` to it. Verified across two slice-verifier passes.

```ts
/** Sleep that a test can skip by injecting a fake timer. Exported as the
 *  production default for the WatcherDeps.sleepFn seam (src/index.ts). */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
```

#### 7. src/index.ts

**File**: src/index.ts

**Changes**: MODIFY — the pipeline sleep seam, mirroring `deps.now` (extends Phase 1's forward; production default identical, zero behavior change).

`WatcherDeps` gains the field (after `now`):

```ts
  /** Clock for recency, prune, state stamps, and heartbeat ages. Default: Date.now. */
  readonly now?: () => number;
  /** Park wait for the judge's cooldown parking. Default: the judge module's sleep. */
  readonly sleepFn?: (ms: number) => Promise<void>;
```

`runWatcher` resolves it beside `now` and forwards it as `judgePosts`' last argument:

```ts
  const now = deps.now ?? Date.now;
  const sleepFn = deps.sleepFn ?? sleep;
```

```ts
  const { value: judgeOutcome, durationMs: judgeMs } = await timeStage(() =>
    judgePosts(
      newPosts,
      resolveJudgeConfig(env),
      config.keywords,
      deps.fetchFn,
      config.reasoningEffort,
      parseJudgeConcurrency(env[ENV_NAMES.judgeConcurrency]),
      now,
      sleepFn,
    ),
  );
```

The judge.js import gains `sleep` (the six names all exist as judge.ts exports post-slice):

```ts
import {
  type JudgedPost,
  isRotationExhausted,
  judgePosts,
  parseJudgeConcurrency,
  resolveJudgeConfig,
  sleep,
} from "./judge.js";
```

#### 8. tests/index.test.ts

**File**: tests/index.test.ts

**Changes**: MODIFY — the FRD bullet-3 acceptance at the `runWatcher` seam: one account, all-429 LLM, cooldown parks drain the 5-minute budget instantly through the injected `sleepFn`; asserts the tagged rejection with the complete pool-ordered record, zero emails, and an untouched state file.

New test inside `describe("runWatcher")`, using the file's existing doubles (singlePageContextFactory, graphqlBody, recordingTransport, tempStatePath, id19, BASE_ENV):

```ts
  it("rejects with the complete pool-ordered exhaustion record and never touches state at budget death", async () => {
    const posts = [{ id: id19(10), text: "Hiring: rust engineer, remote" }];
    const statePath = await tempStatePath("budget-death.json");
    const { transport, subjects } = recordingTransport();
    // Hand-stepped clock + inert park: five cooldown parks drain the
    // 5-minute budget instantly.
    let tick = 0;
    const now = (): number => tick;
    const sleepFn = (ms: number): Promise<void> => {
      tick += ms;
      return Promise.resolve();
    };
    const all429 = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await runWatcher({
        env: BASE_ENV,
        config: CONFIG,
        contextFactory: singlePageContextFactory(graphqlBody(posts)),
        fetchFn: all429,
        transport,
        statePath,
        now,
        sleepFn,
      });
    } catch (error) {
      caught = error;
    }

    // The entry guard's contract: the tagged error with the complete
    // record — it turns that into exactly one exhaustion email + exit 1.
    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as { failures: Array<{ account: number }> }).failures.map((f) => f.account),
      [1],
    );
    // The judge throw happened before any notification or persistence:
    // no email fired, and the state file was never written.
    assert.deepEqual(subjects, []);
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/);
  });
```

The file's imports gain one line:

```ts
import { isRotationExhausted } from "../src/judge.js";
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint + format pass scoped to this phase's files: `npx biome check src/judge.ts src/index.ts tests/index.test.ts`
- [x] Pipeline suite passes: `npx tsx --test tests/index.test.ts`
- [x] Judge suite unaffected: `npx tsx --test tests/judge.test.ts`

#### Manual Verification:
- [x] FRD bullet 3 holds end-to-end: runWatcher hands the entry guard a tagged rejection with a complete pool-ordered record; the email leg (exactly one send, empty-record silent path stays dead) is pinned by tests/email.test.ts:289-337
- [x] `git diff 11a1938 -- src/email.ts src/types.ts src/config.ts` stays empty — the alarm chain's files never change

## Phase 5: Probe and gating

### Overview

Rewrites the probe to iterate every account (per-account minimal/bulk/variance legs, stop-once-4 ramp, per-account classification and exit gate) and flips the dispatch-only probe job from `continue-on-error: true` to gating, rewriting its now-dead accounts[0] rationale. Depends on nothing; can run in parallel with Phases 2-4.

### Changes Required:

#### 7. scripts/probe-judge.ts

**File**: scripts/probe-judge.ts

**Changes**: MODIFY — per-account walk replaces the accounts[0]-only probe; stop-once-4 ramp; dead-vs-busy gate. Verified across two slice-verifier passes.

File doc-comment: the ramp description ("It also ramps concurrent bulk calls until the endpoint refuses one: Z.AI publishes no concurrency number (tier-based, dynamically adjusted, higher off-peak), so the ceiling is read by escalating 2 -> 4 -> 8 -> 16.") becomes:

```ts
 * It ramps concurrent bulk calls per account, stopping once 4 are
 * verified: Z.AI publishes no concurrency number (tier-based, dynamically
 * adjusted, higher off-peak), and gating every account keeps quota burn
 * low — the shipped JUDGE_CONCURRENCY is 4.
```

The exit-contract usage line becomes:

```ts
 * Exits 1 when any account is auth-dead (401/403) or has a failed leg,
 * so a rotten key in the pool fails the gating probe job loudly. A 429-
 * refused leg is data (the account is busy), not a gate failure — the
 * watch job itself is the real gate for throttling.
```

New record type after ProbeOutcome:

```ts
/** One account's full probe record. */
interface AccountProbe {
  position: number; // 1-based, matches the alarm record's account numbering
  label: string;
  minimal: ProbeOutcome;
  bulk: ProbeOutcome;
  bulkAgain: ProbeOutcome;
  ceiling: number;
}
```

`findConcurrencyCeiling` — the ramp stops once 4 verified (levels [2, 4]); JSDoc replaced:

```ts
/**
 * Ramp 2 -> 4 and stop: the shipped JUDGE_CONCURRENCY is 4, so four
 * concurrent verified calls are enough to confirm the width per account.
 * A refused level reads the ceiling below it; a failed call means a
 * broken endpoint, not a ceiling (return 0). The old 2->4->8->16 walk
 * measured one account for tuning; this probe gates every account, and
 * ~6 calls/account keeps quota burn low.
 */
async function findConcurrencyCeiling(payload: unknown, account: LlmAccount): Promise<number> {
  for (const level of [2, 4]) {
    const result = await rampLevel(level, payload, account);
    console.log(
      `probe: concurrency ${level} — ${result.ok}/${level} ok, ${result.refused} refused, ${result.failed} failed in ${result.ms}ms`,
    );
    if (result.failed > 0) {
      console.log("probe: a ramp call failed — broken endpoint, not a concurrency ceiling");
      return 0;
    }
    if (result.ok < level) {
      console.log(`probe: concurrency ceiling is below ${level}`);
      return level / 2;
    }
  }
  return 4;
}
```

New gate classifier after `findConcurrencyCeiling`:

```ts
/**
 * Classify one account's record. An auth rejection (401/403 anywhere) or
 * a failed leg (network error, 2xx without JSON) makes the account DEAD —
 * the probe exits 1 naming it. A broken ramp (ceiling 0) is dead too.
 * Refused legs that are not auth failures mean the account is busy:
 * reported, distinct from dead.
 */
function classifyDead(probe: AccountProbe): string | null {
  for (const leg of [probe.minimal, probe.bulk, probe.bulkAgain]) {
    if (leg.kind === "failed") {
      return `failed leg: ${leg.message}`;
    }
    if (leg.kind === "refused" && (leg.status === 401 || leg.status === 403)) {
      return `auth-dead: HTTP ${leg.status}`;
    }
  }
  if (probe.ceiling < 1) {
    return `broken concurrency ramp (ceiling ${probe.ceiling})`;
  }
  return null;
}
```

`main()` rewritten (replaces the accounts[0] selection at scripts/probe-judge.ts:163 and the single-account body):

```ts
async function main(): Promise<void> {
  let accounts: LlmAccount[];
  try {
    accounts = [...resolveJudgeConfig(process.env)];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`probe: ${message}`);
    process.exit(1);
  }

  const dead: string[] = [];
  for (const [index, account] of accounts.entries()) {
    const label = `account ${index + 1} (${account.baseUrl})`;
    console.log(`probe: === ${label} ===`);

    const minimal = await timed(
      `${label} minimal call`,
      {
        model: account.model,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        temperature: 0,
      },
      account,
    );

    const ten = Array.from({ length: 10 }, (_, i) => syntheticPost(i + 1));
    const bulkPayload = {
      model: account.model,
      messages: bulkMessages(ten),
      temperature: 0,
      reasoning_effort: CONFIG.reasoningEffort,
      response_format: { type: "json_object" },
    };
    const bulk = await timed(
      `${label} bulk call (10 posts, production prompt shape)`,
      bulkPayload,
      account,
    );
    const again = await timed(`${label} bulk call again (variance check)`, bulkPayload, account);

    const ceiling = await findConcurrencyCeiling(bulkPayload, account);
    const probe: AccountProbe = {
      position: index + 1,
      label,
      minimal,
      bulk,
      bulkAgain: again,
      ceiling,
    };
    const cause = classifyDead(probe);
    if (cause !== null) {
      dead.push(`${label} — ${cause}`);
    }
    console.log(
      `probe: ${label} — minimal=${minimal.kind} bulk=${bulk.kind} bulkAgain=${again.kind} ceiling=${ceiling}`,
    );
  }

  if (dead.length > 0) {
    console.error(`probe: DEAD account(s) — failing the gating probe:`);
    for (const line of dead) {
      console.error(`probe:   ${line}`);
    }
    process.exit(1);
  }
  console.log("probe: all accounts verified — gating probe passed");
}
```

(The old recommendation line — `probe: recommended JUDGE_CONCURRENCY = ...` — and the single-summary exit block are deleted: the ramp tops out at the shipped width 4, so JUDGE_CONCURRENCY stays probe-confirmed at its floor rather than re-tuned per run.)

#### 8. .github/workflows/watch.yml

**File**: .github/workflows/watch.yml

**Changes**: MODIFY — the probe job turns gating: `continue-on-error: true` and its accounts[0] rationale are deleted, replaced by the every-account rationale. All steps unchanged; the watch job and its `JUDGE_CONCURRENCY: "4"` literal untouched.

```yaml
  probe:
    if: github.event_name == 'workflow_dispatch'
    # The probe walks EVERY LLM_ACCOUNTS account (stop-once-4 ramp, ~6
    # calls each): an auth-dead key or a failed leg fails this job, so a
    # rotten key in the pool reddens the dispatch run instead of passing
    # unseen. 429-refused legs are reported as busy, not dead — throttling
    # is data; the watch job is the real gate for it.
    runs-on: ubuntu-latest
    timeout-minutes: 10
```

The watch job gains one comment block beside its existing measured-evidence comment (the timeout value itself is untouched):

```yaml
    # ...existing measured-evidence comment...
    # Envelope race, documented not solved: 300s cooldown budget + 60s
    # abort tail + fetch worst case can exceed this timeout — raise it if
    # exhaustion alarms cluster.
    timeout-minutes: 8
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes (the probe is in scope): `npm run typecheck`
- [x] Lint + format pass scoped to this phase's files: `npx biome check scripts/probe-judge.ts`
- [x] Offline smoke — a missing pool fails before any network call: `sh -c "LLM_ACCOUNTS= npx tsx scripts/probe-judge.ts; test \$? -eq 1"`

#### Manual Verification:
- [ ] FRD bullet 5: dispatch the probe workflow with one dead key appended to the LLM_ACCOUNTS secret — the run turns red naming that account
- [ ] Dispatch with all-live keys — the run goes green, one === block per account
- [x] The `JUDGE_CONCURRENCY: "4"` literal and its evidence comment in the watch job stay untouched (the ramp confirms the shipped width; it no longer reads higher ceilings)
- [x] The watch job carries the envelope-race comment beside `timeout-minutes: 8`
- [ ] Post-landing validation run (the precedent demands it): dispatch the watch workflow on live posts — the digest completes, no exhaustion email fires, and the judge log shows batch-local account-1 restarts

## Ordering Constraints

- Phase 1 → 2 → 3 → 4 strictly sequential (each reshapes what the next rewrites).
- Phase 5 is file-disjoint (`scripts/probe-judge.ts`, `watch.yml`) and can run in parallel with Phases 2-4, but must land before the post-implementation validation dispatch (the gating flag changes what a dispatch proves).
- The whole-plan gates run once at the end: `npm run typecheck` → `npm run lint` → `npm test`.

## Verification Notes

- Restart proof (FRD bullet 1): stamp account 1 via a 429, advance the injected clock past 60s, the next batch dispatches account 1 — impossible without the Phase 1 seam.
- All-cooling park completes the backlog with zero real delay under an inert `sleepFn` and a hand-stepped clock (FRD bullet 2); assert zero real latency via the inert sleep's call log.
- Budget death sends exactly one alarm with a complete record and exits 1 (FRD bullet 3): the `runWatcher` seam asserts the tagged rejection with `failures.length === accounts.length` in pool order and an untouched state file; the email leg itself stays covered by `tests/email.test.ts:289-337` (including the empty-record silent path the synthesizer must keep dead).
- Probe gating (FRD bullet 5): a dead account (401/403) fails the run naming it; a busy account (429-refused legs) is reported, distinct from dead.
- Cooldown-map guard: concurrent 429s on one account leave exactly one entry with the FIRST expiry (replaces the CAS pin's dedup proof, `tests/judge.test.ts:938`).
- Budget accounting: charge-before-sleep, re-charge actual elapsed after wake, 5xx backoff (`src/judge.ts:482`) draws NO budget, and bulk-phase + fallback-phase waits draw the same cell.
- Throw-escapes-catch regression: a budget-expiry throw from the fallback pool's `judgePost` still rejects `judgePosts` — proves the try/catch swallow hazard is dead.
- "No park when an account is eligible": zero `sleepFn` invocations, zero budget consumed.
- Precedent lesson (from the landed rotation work, commits 869feed → 7cc7250 → 1c8a68c): every judge-concurrency/limiter change needed a fix within ~1 day — plan a real validation run immediately after landing, and keep the mock convention URL-branching, never call-order.
- Envelope race stays documented: 300s budget + 60s abort tail + fetch worst case vs `watch.yml` `timeout-minutes: 8` — a comment, not a fix (ops lever: the timeout value).

## Performance Considerations

- The park sleeps; it never spins. Worst added wall-clock per run is the 5-minute budget, bounded by the shared cell.
- Jitter on wake (small constant spread) prevents the thundering herd of `JUDGE_CONCURRENCY` workers re-dispatching on one just-expired account.
- The pool scan is O(accounts) per dispatch attempt, synchronous, pre-await — negligible at pool sizes of 2-5.
- Per-account probing multiplies probe calls by the pool size (stop-once-4 caps it at ~6 calls/account + 3 fixed legs); the probe job's `timeout-minutes: 10` absorbs it.

## Migration Notes

- No persisted schema changes: `state/seen-posts.json`, `src/types.ts`, and the email contract are untouched. Rollback is a single-revert of the merge commit.
- Merge prerequisite already executed: `d8fc15b` (reasoning-effort) landed first; this plan cites HEAD `11a1938`.
- OPERATIONAL, before the validation run: both LLM keys appeared in plaintext chat on 2026-10-26/27 — rotate them at the providers and update the `LLM_ACCOUNTS` secret. Never replicate real keys in tests or artifacts.

## Pattern References

- `src/judge.ts:476-483` — the 5xx same-account backoff: the park's mechanical template (wait + continue inside the retry loop, budget untouched).
- `src/judge.ts:541`, `:645` — `fetchFn: typeof fetch = fetch`: the trailing-default I/O seam `sleepFn` copies.
- `src/index.ts:83-87` — `timeStage`'s `now: () => number = Date.now`: the function-form clock `now` copies.
- `src/judge.ts:650` → `:669`/`:747` — by-reference shared frame state consumed by workers: the cooldown map and budget cell ride the same object.
- `src/judge.ts:92-96` region comment block + `:425-430` — the sync-window discipline the scan must keep (pick is synchronous, pre-await).
- `tests/judge.test.ts:28-70` — URL-branching mock doubles (`twoAccounts`, `accountTwoAnswering`) the rewritten tests extend; `freshState` (`:46-48`) becomes the cooldown-state builder.
- `src/judge.ts:66-71` — `FALLBACK_CALL_BUDGET`'s constants-as-documentation comment style for `COOLDOWN_MS`/`WAIT_BUDGET_MS`/`WAKE_JITTER_MS`.

## Developer Context

- Step 4 directional confirms (batched): trailing-param DI — "Follow trailing-param DI"; test conventions — "Keep test conventions".
- Step 4 genuine ambiguities (batched): overwrite policy — "First-write-wins"; probe ramp — "Stop once 4 verified"; budget expiry — "Wait-only"; merge order — user typed "advisor decide".
- Advisor ruling on merge order: land `d8fc15b` first (finished, self-tested feature whose hunks sit where the rewrite lands; reversed order costs the bigger rebase). User authorized; merged via fast-forward to `origin/main` — plan commit is `11a1938` (metadata block said `6b9dae4`; superseded by the advisor action, recorded here).
- Design summary confirmed: "Proceed". Decomposition approved: 5 slices as written.
- Patterns verified by codebase-pattern-finder: no injected-sleep precedent repo-wide; `fetchFn` threading is the seam to extend; `now` takes the `timeStage` function form; consumer inventory complete (no hidden callers of `judgePosts`/`judgePost`/`RotationState`/`freshState`).

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §3 (all fences) | tests/judge.test.ts:58 | blocker | actionability | Every fence wrote template interpolations as `\${...}` — transcribed verbatim, tests emit literal `${...}` text and regex pins fail | Strip the backslash before every `${` in all plan fences | applied: 23 escapes stripped globally; all fences interpolate like the live tree |
| code | Phase 2 §2 | src/email.ts:161 | concern | code-quality | `failuresFromCooldowns` filtered `expiry > nowMs`; a drain outliving a 60s window could shrink/empty the alarm record, reviving the silent-email path | Emit one record per map entry regardless of current expiry | applied: freshness filter dropped — one record per entry; non-empty-by-construction now rests on entry existence (every account has an entry at every throw site) |
| coverage | ## Verification Notes §9 | <n/a> | concern | verification-coverage | The precedent-mandated post-landing validation run appears in no Success Criteria bullet | Add a Phase 5 Manual bullet gating the validation dispatch | applied: Phase 5 Manual bullet added (dispatch the watch workflow on live posts; observe digest + restarts) |
| coverage | ## Verification Notes §10 | <n/a> | concern | verification-coverage | The envelope-race note (300s budget + 60s tail vs `timeout-minutes: 8`) is documented in prose only — no fence or criterion | Add the comment beside the watch job's timeout + a Manual bullet | applied: comment added to the Phase 5 watch.yml fence + Manual bullet |
| code | Phase 2 §2 | src/judge.ts:394-399 | suggestion | codebase-fit | `judgeBatch`'s JSDoc still describes the deleted compare-and-set pointer | Replace it with cool-and-rewind semantics | applied: Phase 2 fence replaces the JSDoc opening paragraphs |

Step 8 both reviewers returned; 1 blocker, 3 concerns, 1 suggestion — all triaged applied. Triage edits were made in the same pass as the resolution records above.

## Plan History

- Phase 1: Time seam — approved as generated
- Phase 2: Cooldown core — approved as generated
- Phase 3: Park and wait budget — approved as generated
- Phase 4: Alarm acceptance — approved as generated
- Phase 5: Probe and gating — approved as generated

## References

- `.rpiv/artifacts/solutions/2026-10-27_16-40-05_per-batch-llm-rotation.md` — parent solutions artifact (Option 1 selected; all anchors verified by three agent passes).
- `.rpiv/artifacts/research/2026-10-27_15-27-01_per-batch-llm-rotation.md` — grounding research.
- `.rpiv/artifacts/discover/2026-10-27_14-08-35_per-batch-llm-rotation.md` — the FRD (acceptance bullets 1-5).
- `.rpiv/artifacts/plans/2026-10-26_15-59-52_llm-account-rotation.md` — the landed rotation plan (CAS, drain-then-throw, mock conventions carried over).
- `.rpiv/artifacts/solutions/2026-10-27_10-12-53_reasoning-effort-llm-judge.md` — the d8fc15b change this plan builds on.
- `src/judge.ts:93-97`, `:378-391` — the incumbent state and CAS being replaced.
- `src/index.ts:296-313`, `src/email.ts:160-194` — the exhaustion alarm chain this change must not break.
