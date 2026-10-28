---
date: 2026-10-27T15:27:01+0700
author: Yogiswara Utama
commit: 6b9dae4
branch: main
repository: loker-watcher
topic: "per-batch LLM account rotation"
tags: [research, codebase, judge, rotation, cooldown, probe, concurrency]
status: ready
last_updated: 2026-10-27T15:27:01+0700
last_updated_by: Yogiswara Utama
---

# Research: per-batch LLM account rotation

## Research Question
Ground the discover FRD `.rpiv/artifacts/discover/2026-10-27_14-08-35_per-batch-llm-rotation.md` in the live code: replace the run-sticky rotation pointer with a batch-local cursor plus a shared 60s cooldown map, add a 5-minute in-run wait budget, keep the exhaustion alarm contract unchanged, and make `scripts/probe-judge.ts` probe every account. What exactly does each replacement touch, where do the new waits and the budget live, what does the failure record become, and which tests and workflow flags change?

## Summary
- The rotation core is one object and five functions in `src/judge.ts`: `RotationState` (`:92-96`), the CAS `rotateOnRateLimit` (`:377-390`), dispatch-time pointer reads (`:431`, `:543`), the 429 branches (`:462-472`, `:565-575`), and the drain-then-throw joins (`:673-675`, `:748-750`). The pointer-compare guard survives as a cooldown-map guard; "advance exactly once" becomes free because map writes are idempotent.
- The all-cooling wait lands **in-loop** (developer + advisor decision): the 5xx backoff at `:473-481` is the existing in-loop park shape, and the exhaustion plumbing (outcome arm, joins, throws, alarm chain) is reused verbatim. `judgePost` returns `JudgeVerdict | null` and throws (`:534-539`) — a frame-requeue design would force a contract change there anyway.
- The 5-minute budget is **cooldown-wait-only** (FRD FR#3). New finding: worst case (300s waits + a 60s in-flight fetch tail the budget cannot cancel + ~75s fetch + setup) can pass the watch job's `timeout-minutes: 8` (`watch.yml:47`), and a runner timeout kills the run before the alarm email sends. The 8-minute cap is the **repo's own setting** (GitHub default is 360 minutes; verified against GitHub docs), so the mitigation is a one-line ops change — documented as a known limitation, not a budget change.
- Budget expiry breaks a silent invariant: today a thrown `RotationExhausted` can never carry an empty `failures` list (the CAS pushes before advancing), which is why the empty-list hole in `src/email.ts:161` → `:188` (exit 1, email-silent) is dead code. Under cooldowns, the record must be **synthesized** at throw time with per-account upsert semantics, pool order, and a new reason string — or the alarm can go visibly wrong exactly once, on the run that needs it most.
- Deferred-batch semantics do not change: the FRD constraint pins the defer-unanswered rule (`src/judge.ts:689-696`), 429s leave the `unanswered` arm entirely, and `skippedPostIds` keeps its three surviving producers.
- Tests: the four run-sticky pins plus a **fifth** `freshState` consumer (`tests/judge.test.ts:303-314`) rewrite together. Count-based assertions (`auths.length`) survive; pointer assertions (`state.index`, CAS monotonicity) die. Observationally, restart vs stickiness are identical without fake time — the injection seam (an injectable `now`/`sleep` pair, or `mock.timers` over `["setTimeout","Date"]`) is the hinge every new test stands on.
- Probe: `scripts/probe-judge.ts:163-171` probes only `accounts[0]`; `timed()` (`:87-116`) logs and drops the per-call status/latency data a per-account report needs. The `continue-on-error: true` flag (`watch.yml:21`) loses its stated rationale ("the probe reads only accounts[0]") — **developer decision: flip to gating** so a dead account turns the manual probe run red.
- Unmerged branch `d8fc15b` (`ukind/add-reasoning-effort`) touches the same files — merge-order risk for the implement stage.

## Detailed Findings

### Rotation core: what the pointer touches (all of it)
- `RotationState` (`src/judge.ts:92-96`) is `accounts` / mutable `index` / `failures`. Created once in `judgePosts` (`:644`), shared by reference with every bulk worker (`:656-665`, pool launch `:666`) and fallback worker (`:720-744`, launch `:745-747`).
- The **only** `index` write is inside the CAS (`:387`); the **only** `failures` write is `:381-385` with literal reason `"HTTP 429"` (`:384`). Dispatch-time reads at `:431` (bulk) and `:543` (single-post) happen before the first await — the "read and advance with no await between" discipline (`:425-430`, `:87-91`) is the codebase's only concurrency guard.
- Under per-batch restart, the CAS's pointer-compare (`:378`) becomes a map-guard: *write the cooldown only if this account is not already cooling with a later-or-equal expiry*. A new overwrite hazard appears: jittered expiries make two workers' values differ — first-write-wins (or `max(prior, computed)`) must be chosen or a burst 429 **extends** the cooldown.
- The CAS's old failure mode ("skips accounts nobody has tried", `:373-374`) is a monotonic-pointer artifact and vanishes. The boolean return (`:389`, "an account remains") becomes the all-cooling predicate — `false` stops meaning terminal exhaustion and starts meaning *park*, unless the budget is spent.
- `failures` semantics: today append-only and naturally deduped (CAS + monotonic index ⇒ one record per account, pool order — pinned by `tests/judge.test.ts:934-974`). Under cooldowns an account can 429 many times per run, so the record needs **upsert** (per-account latest) re-serialized in pool order; `AccountFailure.account` (1-based, `src/types.ts:33-34`) is the stable key, and `buildExhaustionText`'s numbered list (`src/email.ts:162-165`) needs no change.
- Both terminal triggers today (`accounts[attemptIndex] === undefined` at `:433-435`/`:545-547`, and rotation-false at `:467-468`/`:570-571`) collapse into one condition: all-cooling **and** budget spent.

### All-cooling wait: in-loop park (decision recorded)
- Option A (chosen): park inside `judgeBatch`/`judgePost` retry loops on "no eligible account" — same shape as the 5xx backoff (`:473-481`: guard `:474`, `await sleep(delay)` `:479`, `continue` `:480`). One shared park helper serves both paths; budget-exhaustion mid-park returns `{status:"exhausted"}` / throws through the **existing** sites (`:467-468`, `:570-571`), joins (`:673-675`, `:748-750`), and alarm chain unchanged. `BatchOutcome` (`:363-366`) needs **no new arm** — `"exhausted"` is repurposed as budget-spent, and the walk's comment at `:690-692` stays true.
- Option B (rejected): frame requeue with a `{status:"cooling"; resumeAt}` arm — single sleeper and one budget deduction point, but new machinery (per-pass worker pool + cursor reset), a changed `judgePost` contract, and the reassembly walk (`:677-707`) must move behind the requeue loop.
- Worker-slot cost of A: all 4 workers can park at once (effective concurrency 0 while parked); jitter on expiry smooths synchronized re-dispatch (FRD FR#3). Budget accounting must follow the closure idiom: deduct before sleeping, re-deduct actual elapsed after waking (sleeps overshoot).
- The budget is **one shared counter declared in the `judgePosts` frame before the bulk pool** (beside `outcomes` at `:654`), shared the way `state` (`:644`) is — *not* per-phase like the two `next` cursors (`:655`, `:717`).

### Budget vs the 8-minute envelope (race verified, cap is repo-set)
- `timeout-minutes: 8` (`watch.yml:47`) caps the whole job; the comment at `:44-46` explains why (hung run must die before the next `*/10` tick queues; `concurrency: watch` queues with `cancel-in-progress: false`). **Verified**: GitHub's default job timeout is 360 minutes; a job that reaches `timeout-minutes` is terminated and marked failed — so the cap is the repo's own one-line setting, tunable by ops without code change.
- Stack-up at worst case: setup (npm ci + `playwright install --only-shell`, `:58-64`) + fetch ~71s measured, ~196s if surfaces fail (`NAV_TIMEOUT_MS = 30_000` × 3 attempts × 2 waves) + judge 300s waits **plus** uncounted 60s `AbortSignal.timeout` tails (`REQUEST_TIMEOUT_MS`, `src/judge.ts:38`, applied `:452`/`:561`) + 7s 5xx backoff residue + un-timed SMTP (`src/email.ts:93-99` sets no timeouts) → can exceed 480s. Runner kill ⇒ `process.exit(1)` at `src/index.ts:311` never runs ⇒ **no alarm email** — the fail-visible contract fails invisibly.
- Drain-then-throw is why the tail exists: the throw waits for the join (`:667-672` comment: siblings must finish so the record is complete), so budget expiry leaves up to `concurrency` in-flight fetches with up to 60s remaining.
- Decision: keep 300s (FRD decision + advisor), document the race as a known limitation; the abort-guard option (cancel in-flight at expiry for a fast alarm, losing the complete record) is left to the design stage.

### Exhaustion record and the alarm contract
- `AccountFailure` (`src/types.ts:31-39`): 1-based `account`, `baseUrl`, `reason`. Exactly **one** producer today: `src/judge.ts:381-385`. The `types.ts:37` doc already promises "or the transport error message" — a reason no code writes (transport errors deliberately don't rotate, `:508-510`). The budget reason is the field's first live second value.
- Today's invariant: a thrown `RotationExhausted` can never carry an empty list (push-before-advance), so `buildExhaustionText`'s `null` branch (`src/email.ts:161`) and `sendExhaustionEmail`'s silent `return undefined` (`:188`) are **dead code**. Budget expiry deletes the producer; the record must be synthesized at throw time, non-empty by construction (budget expiry ⇒ every account was cooling ⇒ every account has ≥1 429 this run), or the alarm chain (`src/index.ts:303-311`) exits 1 email-silent.
- Second, independent email-silent path: `resolveEmailConfig(process.env)` at `src/index.ts:306` reads ambient env (outside `runWatcher`); missing `GMAIL_*` throws, is warned (`:307-310`), run still exits 1. Pre-existing; the alarm email is best-effort by design (`:298-300`).
- "In the order rotation left them" (`src/judge.ts:104`) becomes stale wording: nothing downstream consumes insertion order (`src/index.ts:306` passes through; `email.ts:162-165` numbers by position), and `account` is the pool index — serialize in pool order.

### Deferred batches: untouched, and smaller
- `unanswered` has four producers today, none rotation-related: spent 5xx backoff (`:473-485`), non-retryable status (`:482-485`), 200-with-no-content (`:491-497`), transport error incl. 60s aborts (`:507-515`). Parse failure is NOT unanswered — `{status:"answered", verdicts:new Map()}` (`:499-504`), every item falls back per-post.
- The FRD constraint pins the defer rule untouched; 429s leave `unanswered` entirely (they cool and retry within the call). A 429 no longer contributes to `skippedPostIds` (it never did), and budget-death preempts the walk (`:677-707`) — partial results are discarded, every unjudged post stays uniformly unseen. `parseJudgeConcurrency` (`:184-202`, env name `src/config.ts:18`) needs zero changes; workers return at cursor drain, they don't park between phases, so a hypothetical requeue would be a third pool launch, not a resurrection.
- `skippedPostIds` keeps three producers post-redesign: non-429 deferral (`:689-696` → `:770`), per-post fallback failure (`:733-734`), budget-starved fallback tail (`:725` guard, `:751-755`).

### Injection seam: injectable `now`/`sleep` pair (the hinge)
- `src/judge.ts` never reads the clock today — no `Date.now()` anywhere; the only timing constructs are `AbortSignal.timeout(60_000)` (`:446`/`:568`) and module-private `sleep` (`:76-77`, consumer `:479` only). The cooldown design introduces the first `now()` reads — a new dependency, not a rerouting.
- The seam cannot live in `index.ts`: `tests/judge.test.ts` drives `judgePosts`/`judgePost` directly (20+ call sites, e.g. `:430`, `:818`, `:945`), never through `runWatcher`. It must be declared in `judge.ts` — trailing defaulted params, mechanically identical to how `fetchFn` already flows (`judgePost` `:534-538`, `judgePosts` `:637-642`, internal `judgeBatch` `:412-417` called at `:663` and `:730`).
- Repo precedents: `WatcherDeps` with `?? ` defaults (`src/index.ts:99-114`, `now?: () => number` at `:113`, destructured `:137`), `timeStage` trailing param (`:83-90`), `filterRecent` (`src/recency.ts:13-18`). `exactOptionalPropertyTypes` rules out optional-object fields receiving explicit `undefined` — positional trailing params match the codebase.
- Alternative: `node:test` `mock.timers` (`engines.node >= 22`) against the `setTimeout` the `:76` comment targets — but cooldown math needs `Date` faked too (`enable({apis:["setTimeout","Date"]})`), it is process-global while enabled, and the suite has real-timer yields that deadlock a frozen clock (1ms yields in `measuredFetch`/`bulkMissThenAnswer` ~`:417-419`/`:449-451`, resolver poll `:832`). Either choice must carry **both** halves of time: `now`-only hangs, `sleep`-only can't advance expiry math.
- Side effect (deliberate): the 502 test's ~1s real sleep (`tests/judge.test.ts:897-914`, admission `:911`) disappears once an inert `sleep` is injectable.

### Test rewrite: four pins + a fifth consumer
- Pin 1 (`:282-301`): `state.index === 1` (`:298`) dies; `auths.length === 2` (`:300`) and the key-2 second dispatch survive (the `attempt -= 1` rewind at `src/judge.ts:470`/`:573` is retained by FRD FR#2). `failures` assertion becomes a cooldown-map assertion (`cooldownUntil ≈ now() + 60_000`).
- Pin 2 (`:854-864`): "no backoff on rotation" survives in meaning; the real-`Date.now()` elapsed (`:857-859`, `:863`) stops measuring anything under fake `Date` — rewrite as "injected sleep never invoked / zero budget consumed on the eligible path".
- Pin 3 (`:866-895`): the literal opposite of per-batch restart — **but observably identical without fake time**: the fallback call restarts at account 1, finds it cooling (429 was microseconds ago), skips to account 2, `auths` stays `[key-1, key-2, key-2]`. To prove *restart* the rewrite must tick the clock 60s and assert the call lands back on key-1 (FRD acceptance bullet 1).
- Pin 4 (`:934-974`): CAS monotonicity (`firstKey2 > lastKey1` `:968-970`, `firstKey3 > lastKey2` `:971-973`) cannot survive — an expired cooldown legally re-dispatches account 1. The `[1,2,3]` one-record-per-account assertion (`:954-958`) becomes an upsert-semantics assertion; multi-worker dispatch counts (`:963-965`, the vacuous-guard discriminator from `869feed`) survive as "every worker re-walks the pool".
- **Fifth consumer the FRD omits**: "judgePost throws the tagged error when rotation runs out mid-fallback" (`:303-314`) also calls `freshState` and asserts `failures` `[1, 2]` — migrates with the rest.
- Fixture conventions that survive: URL-branching mocks (`twoAccounts()` `:28-33`, `threeAccounts()` `:37-43`, `accountTwoAnswering` `:50-70` — "branch on the URL, never on call order" is load-bearing now that dispatch order is timing-dependent), `response_format`-rider call-type sniffing (`:883-885`). `freshState` (`:45-48`) is replaced by whatever builds the new cursor+cooldown shape.
- The budget-exhausted alarm acceptance test follows the `tests/index.test.ts` pattern: call `runWatcher` directly with `now` (`:219`, `:245`, `:275`, `:296`, `:320` under pinned clock `:29-31`), assert on caught `RotationExhausted.failures` + email transport spy; `process.exit` stays un-exercised. Requires `deps.now` forwarded at `src/index.ts:193-199` — the one production call-site edit.

### Probe rewrite: all accounts, real report, flag flips (decision recorded)
- Today: `resolveJudgeConfig(process.env)[0]` into one `account` (`scripts/probe-judge.ts:163-171`); the pool is fully *validated* (`parseLlmAccounts` `:132-170`) but entries 1..N-1 are discarded — 4 dead credentials pass unseen if account 1 is healthy.
- `timed()` (`:87-116`) prints no account identity (labels `:175`/`:191`/`:192`, ramp all share the literal `"ramp"` `:126`), computes `elapsed` and drops it, and classifies every non-2xx as `"refused"` (`:101-104`) — a 401-dead account reads as a concurrency signal. `rampLevel` (`:119-134`) aggregates to counts, discarding statuses; `findConcurrencyCeiling` (`:142-158`) escalates `[2,4,8,16]`, `return 0` on any failed call, `level / 2` on first refusal, 16 if clean. `ProbeOutcome` (`:76-79`) must widen (carry `ms`, keep `refused.status`) for any per-account report.
- Cost: full pipeline per account is up to 33 × N calls and re-creates the exact shared-key contention the FRD exists because of (run 40463798717). Middle design: per-account escalation **stopping once 4 is verified** (levels 2 then 4, ≤6 calls/account) — matches the shipped `JUDGE_CONCURRENCY: "4"` and the `Math.max(4, ceiling)` floor at `:195`. Ramp scope is left to design (Open Question).
- Exit gate (`:200-202`) mixes concerns: `ceiling < 1` only triggers on a *failed* ramp call; a per-account gate must also fail "all-refused-at-level-2" and distinguish busy (429) from dead (401/403). Keyword loading (`:21`, `:26-27`, `src/config-file.ts:44-63`) is account-independent and unchanged.
- **Flag decision**: `continue-on-error: true` (`watch.yml:21`, dispatch-only job `watch.yml:16`, never runs on cron) loses its stated rationale ("the probe reads only accounts[0]", `:18-20`). Developer: flip to gating — a dead account turns the manual probe run red. `continue-on-error` never suppressed the exit code, so FRD FR#5's "exit nonzero" was satisfiable either way; the comment at `:18-21` must be rewritten or dropped.

## Code References
- `src/judge.ts:92-96` — `RotationState`: accounts / index / failures (the object the FRD deletes)
- `src/judge.ts:109-118` — `rotationExhausted()`: tagged error, message interpolation, `failures` snapshot
- `src/judge.ts:132-170` — `parseLlmAccounts`: fail-visible pool validation (membership lives only in `LLM_ACCOUNTS`)
- `src/judge.ts:184-202` — `parseJudgeConcurrency`: numeric env read, default 4 (`:52`)
- `src/judge.ts:363-366` — `BatchOutcome`: answered / unanswered / exhausted (no new arm needed under Option A)
- `src/judge.ts:368-390` — `rotateOnRateLimit`: the CAS; `:378` pointer-compare, `:381-385` failure push, `:387` sole write, `:389` the boolean
- `src/judge.ts:412-417` / `:431` / `:433-435` — `judgeBatch` signature, dispatch-time read, undefined-account terminal
- `src/judge.ts:462-472` — bulk 429 branch: record, rotate, rewind `attempt` (`:470-471`), no sleep
- `src/judge.ts:473-485` — 5xx same-account backoff (1s/2s/4s, `:74`) then `unanswered`
- `src/judge.ts:499-504` / `:507-515` — parse-failure-is-answered arm; transport-error defer (no rotation, `:508-510`)
- `src/judge.ts:534-539` / `:543` / `:545-547` / `:565-575` — `judgePost` signature/contract, dispatch read, throw sites, 429 branch
- `src/judge.ts:637-643` / `:644` / `:654-655` / `:656-666` — `judgePosts` signature, state creation, outcomes+cursor, bulk pool launch
- `src/judge.ts:667-675` — drain-then-throw comment + bulk exhaustion rethrow
- `src/judge.ts:677-707` / `:689-696` — reassembly walk; the unanswered (defer) arm the FRD pins untouched
- `src/judge.ts:716-755` — fallback pool, budget-starved tail, fallback drain-then-throw (`:748-750`)
- `src/judge.ts:759-773` — final assembly: `judged` + `skippedPostIds`
- `src/index.ts:99-114` / `:137` — `WatcherDeps` (fetchFn, now) and destructuring — the DI precedent
- `src/index.ts:192-205` — the sole production `judgePosts` call site (forwards `deps.fetchFn`, concurrency)
- `src/index.ts:296-313` — exhaustion catch: `isRotationExhausted` `:303`, best-effort email `:305-310`, `process.exit(1)` `:311`
- `src/email.ts:160-174` — `buildExhaustionText`: numbered per-account lines; `:161` null-on-empty (dead today)
- `src/email.ts:182-194` / `:93-99` — `sendExhaustionEmail` (silent no-send on null) / un-timed transport
- `src/types.ts:31-39` — `AccountFailure` (1-based `account`; `reason` doc already licenses non-429 values)
- `scripts/probe-judge.ts:26-27` / `:87-116` / `:119-134` / `:142-158` / `:163-171` / `:195` / `:200-202` — config load, `timed`, `rampLevel`, ceiling ramp, first-account-only selection, `Math.max(4, ceiling)` floor, mixed exit gate
- `.github/workflows/watch.yml:16-26` — dispatch-only probe job, `continue-on-error: true` `:21`, obsoleted rationale `:18-20`
- `.github/workflows/watch.yml:44-48` / `:58-64` — `timeout-minutes: 8` + rationale; setup overhead
- `.github/workflows/watch.yml` (Run watcher env) — `JUDGE_CONCURRENCY: "4"` (two agents disagree on the exact line; path-only citation)
- `tests/judge.test.ts:28-33` / `:37-43` / `:45-48` / `:50-70` — URL-branching fixtures, `freshState`, `accountTwoAnswering`
- `tests/judge.test.ts:282-301` / `:303-314` / `:854-864` / `:866-895` / `:897-914` / `:934-974` — the four pins, the fifth `freshState` consumer, the 502 test with the ~1s real sleep
- `tests/index.test.ts:29-31` / `:219`-`:320` — pinned `NOW` clock; `runWatcher`-direct test pattern

## Integration Points

### Inbound References
- `src/index.ts:192-205` — `runWatcher` calls `judgePosts(newPosts, resolveJudgeConfig(env), config.keywords, deps.fetchFn, parseJudgeConcurrency(...))`; the seam's one production forward point
- `src/index.ts:303-311` — the exhaustion catch; consumes `error.failures` verbatim
- `tests/judge.test.ts` — 20+ direct `judgePosts`/`judgePost` calls plus `freshState` (5 construction sites incl. `:283`, `:307`)
- `scripts/probe-judge.ts:163` — `resolveJudgeConfig` first-account consumer

### Outbound Dependencies
- `src/judge.ts:445`/`:446`, `:554`/`:568` — `fetchFn` + `AbortSignal.timeout(REQUEST_TIMEOUT_MS = 60_000` `:38`); the in-flight tail the wait-only budget cannot cancel
- `src/judge.ts:479` — module `sleep` (`:76-77`): the injection seam's anchor
- `src/email.ts:93-99` — nodemailer transport, no timeout options (unbounded SMTP stall, pre-existing)
- `src/config.ts:18` — `ENV_NAMES.judgeConcurrency`; `ENV_NAMES.llmAccounts` for the pool

### Infrastructure Wiring
- `.github/workflows/watch.yml:2-5` — `*/10` cron + dispatch; `:16` probe is dispatch-only; `:21` `continue-on-error` (decision: flip)
- `.github/workflows/watch.yml:44-48` — `timeout-minutes: 8` (repo-set; the race's lever)
- `.github/workflows/watch.yml` (Run watcher env) — `JUDGE_CONCURRENCY: "4"`, `LLM_ACCOUNTS` secret (pool membership)

## Architecture Insights
- **Closure-shared mutable + synchronous windows is the only concurrency guard** ("read and advance with no await between", `src/judge.ts:87-91`, `:425-430`). The cooldown map, budget counter, and any new shared state must follow the same idiom — no locks exist.
- **Drain-then-throw buys the complete failure record** (`:667-672`): the throw waits for the join so sibling 429s land first. Any fast-alarm shortcut (abort at budget expiry) trades exactly this record away.
- **Fail-visible has a hidden corollary**: invariants that keep error paths non-degenerate (non-empty `failures`) are load-bearing. When a redesign deletes an invariant's producer, the degenerate branch it was masking (`email.ts:161` → `:188`) becomes live.
- **DI style**: trailing defaulted params / deps object with `??` fallbacks (`WatcherDeps`, `timeStage`, `filterRecent`); `judge.ts` already does this with `fetchFn`. `exactOptionalPropertyTypes` shapes the choice.
- **Mock convention**: branch on URL (distinct host per account), never on call order — now load-bearing, since dispatch order becomes timing-dependent.
- **Budgets are constants, not config** (`FALLBACK_CALL_BUDGET` doc `:62-71`): unmeasured values stay module constants; the 60s cooldown and 5-minute budget belong in the same class unless probe-measured.
- **M-multiplication**: pool size multiplies everything — one logical call fans into M requests (`:66-71`), probe cost × N accounts, chained cooldowns draw from one shared budget.

## Precedents & Lessons
3 similar past changes analyzed.

### Precedent: run-sticky LLM account rotation (the code being replaced)
**Commit(s)**: `869feed` — "feat: rotate llm accounts to avoid the rate limit" (2026-10-26)
**Blast radius**: 12 files across 5 layers — `src/judge.ts` (RotationState, CAS, RotationExhausted), `src/types.ts`, `src/config.ts`, `src/email.ts`, `src/index.ts`, `scripts/probe-judge.ts`, `watch.yml`, tests
**Follow-up fixes**:
- `7cc7250` — "fix: drop JUDGE_CONCURRENCY to the probe reading of 4" (2026-10-27) — 8-wide bursts drew real 429s
- `1c8a68c` — "make the probe non-gating…" (2026-10-27) — accounts[0]-only probe + daily cap failed runs while watch was green
- No code fix for the core defect: run 40463798717 — first 429 moved the run to account 2 permanently; 327 posts unjudged (this FRD's motivation)
**Lessons from docs**:
- `.rpiv/artifacts/plans/2026-10-26_15-59-52_llm-account-rotation.md` — concurrent 429s need a compare-and-set; per-key dispatch counts (4/4/4 vs 4/1/1) expose a vacuous guard; drain-then-throw; mocks branch on URL
- `.rpiv/artifacts/validation/2026-10-27_12-39-16_fast-workflow-runtime.md` — names the structural defect: a width-N wave 429s across accounts in ~1s and exhausts the pool in one hop; flags `REQUEST_TIMEOUT_MS = 60_000` aborting reasoning-model bulk calls
**Takeaway**: the sticky pointer turns a momentary burst-429 into total pool death in ~50ms; the CAS + dispatch-count test discipline must carry over to the cooldown map.

### Precedent: judge/fetch pools + width 8
**Commit(s)**: `93a3f38` — "feat: cut watch runtime with judge/fetch pools, state v2, and an 8-minute budget" (2026-10-27)
**Follow-up fixes**: `7cc7250` (same day) — width 8 → 4
**Lessons from docs**:
- `.rpiv/artifacts/research/2026-10-26_14-51-03_fast-workflow-runtime.md` — at pool width K, up to K batches park in backoff or hold a 60s socket; width multiplies burst exposure
**Takeaway**: concurrency and rotation are coupled — validate the new cooldown behavior at the shipped width (4), not just in unit tests.

### Precedent: judge retry-chain changes (pattern: ~1-day fix cycle)
**Commit(s)**: `1d4faed` — "parallelize the judge with a bounded worker pool" (2026-10-26) → `fda50c2` — "fix: defer unanswered judge batches, raise the request timeout" (same day); `5f6a328` — "ramp concurrent calls in the judge probe" (2026-10-26)
**Takeaway**: every judge-concurrency/limiter change in this repo has needed a fix within ~1 day; the 60s request timeout and defer path are known-fragile — plan a validation run right after implementation.

### Composite Lessons
- 429 treated as dead quota + run-wide state = single-hop pool exhaustion (`869feed` lineage, runs 40458600377 / 40463798717). The cooldown map is the documented fix; jitter the all-cooling wake and keep waiting budget separate from retry attempts (`fda50c2`'s `attempt` lesson).
- Concurrent-429 correctness needs a shared-state guard + per-key dispatch-count tests — the CAS pattern applies to the map (first worker cools, others skip; avoid double-recording).
- Keep `JUDGE_CONCURRENCY` at the probe-measured ceiling (4); width above it trips the limiter, and the limiter is what the cooldown machinery absorbs.
- The probe is a known blind spot: accounts[0]-only readings are meaningless during an outage; `1c8a68c`'s `continue-on-error` was a band-aid this rewrite replaces (now flipped to gating per developer decision).
- Merge-order risk: `d8fc15b` (branch `ukind/add-reasoning-effort`, unmerged) touches `src/judge.ts`, `tests/judge.test.ts`, `scripts/probe-judge.ts`, `src/index.ts` — coordinate or land first.
- Secrets hygiene: both LLM keys were pasted in plaintext chat 2026-10-26/27 — rotate at the providers; never replicate real keys in tests or artifacts.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-10-27_14-08-35_per-batch-llm-rotation.md` — this change's FRD (interview, decisions, acceptance criteria)
- `.rpiv/artifacts/discover/2026-10-26_14-27-50_llm-account-rotation.md` — prior rotation FRD (the run-sticky design being amended)
- `.rpiv/artifacts/plans/2026-10-26_15-59-52_llm-account-rotation.md` — landed rotation plan (CAS, drain-then-throw, mock conventions)
- `.rpiv/artifacts/research/2026-10-26_14-47-19_llm-account-rotation.md` — research behind the sticky rotation
- `.rpiv/artifacts/research/2026-10-26_14-51-03_fast-workflow-runtime.md` — pool-width burst-exposure analysis
- `.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md` — design re-grounded 2026-10-27 on commit 7dc0247; rotation slices re-based (drain-then-throw D11)
- `.rpiv/artifacts/validation/2026-10-27_12-39-16_fast-workflow-runtime.md` — validation findings incl. the structural defect this change fixes

## Developer Context
**Q (discover: Success definition): What does success look like when both LLM accounts hit rate limits?**
A: "Runs never give up" — every run finishes the judge step, riding out rate limits until all unseen posts are judged.

**Q (discover: Last-resort alarm contract): Keep one alarm email + exit 1 as the last resort?**
A: Keep alarm + exit 1. Fail-visible is a repo non-negotiable (`src/index.ts:296-313`).

**Q (discover: Dedicated z.ai key): Where should the watcher-only z.ai key live?**
A: Dropped entirely — "no. even second key will be exhausted. as long as still the same account." Quota is per-account; contention is absorbed by rotation.

**Q (discover: Pool shape and ordering): Which order should the pool have?**
A: Dynamic — rotation walks `LLM_ACCOUNTS` in list order; providers added/removed freely by secret edit; nothing hardcoded (`src/judge.ts:132-170`).

**Q (discover: Test rewrite): Rewrite the four run-sticky pins as part of this work?**
A: Rewrite all four (plus the fifth `freshState` consumer found in research, `tests/judge.test.ts:303-314`).

**Q (discover: All-cooling semantics): All accounts cooling at once — what should the run do?**
A: Wait out the earliest expiry up to the budget, then alarm + exit 1. Silent deferral rejected.

**Q (discover: Cooldown duration): How long is a 429'd account skipped?**
A: Flat 60 seconds (simpler, predictable cadence; escalation rejected).

**Q (discover: In-run wait budget): Total cooldown-waiting time before the run alarms?**
A: 5 minutes, cooldown-wait-only (fits the 10-minute schedule with margin).

**Q (discover: Probe scope): Should the probe ping every account?**
A: Yes — the pool is free-form; account 1's health no longer represents the pool (`scripts/probe-judge.ts:163-171`).

**Q (research checkpoint, advisor-endorsed): Where does the all-cooling wait live — in-loop park or frame requeue?**
A: **In-loop park** (`src/judge.ts:473-481` shape). One park helper serves bulk + fallback; exhaustion plumbing, `BatchOutcome`, and the alarm chain stay untouched; `judgePost`'s throw contract is preserved. Budget counter is one shared cell in the `judgePosts` frame beside `outcomes` (`:654`).

**Q (research checkpoint): Does the probe job stay `continue-on-error: true`?**
A: **No — flip to gating.** A dead account turns the manual probe run red (`watch.yml:21`); the flag's accounts[0] rationale is deleted by the rewrite. The obsoleted comment (`:18-21`) is rewritten or dropped.

**Q (research checkpoint): Is the 5-minute budget safe against the job timeout?**
A: Keep 5 minutes as decided; document the race as a known limitation. Verified: the 8-minute cap is the repo's own `timeout-minutes: 8` (`watch.yml:47`), not a GitHub limit (default 360 min); when it trips, GitHub terminates the job and the alarm email is lost. Mitigation lever is a one-line ops change (raise the cap) or a design-stage abort guard — not a budget change.

## Related Research
- `.rpiv/artifacts/research/2026-10-26_14-47-19_llm-account-rotation.md` — the run-sticky rotation this change amends
- `.rpiv/artifacts/research/2026-10-26_14-51-03_fast-workflow-runtime.md` — concurrency/burst exposure groundwork

## Open Questions
- Per-account probe ramp scope: full ceiling ramp (≤33 calls/account; re-creates shared-key contention) vs stop-once-4-verified (≤6 calls/account). Cost/policy choice — design stage.
- Should the budget also cancel in-flight fetches at expiry (abort guard) for a guaranteed-fast alarm, accepting a smaller failure record? FRD letter is wait-only; design stage.
- Whether to add SMTP timeouts to the transport (`src/email.ts:93-99`, pre-existing unbounded stall) — out of FRD scope, flagged for the implement stage's consideration.
- `d8fc15b` merge ordering (unmerged reasoning-effort branch touching the same four files) — plan stage.