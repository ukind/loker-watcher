---
date: 2026-11-08T12:45:40+0700
author: Yogiswara Utama
commit: 77f44d7
branch: main
repository: loker-watcher
topic: "account-availability-check"
tags: [research, codebase, judge, judge-availability, judge-rotation, judge-health, llm-accounts, email, watch-workflow]
status: ready
last_updated: 2026-11-08T13:14:40+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Follow-up: skip-run heartbeat resolved (alarm only); D1 mask amendment recorded; test citations verified against session reads; garbled code-reference row fixed"
---

# Research: Account Availability Check Before Judging

## Research Question
Chained from the FRD `.rpiv/artifacts/discover/2026-11-08_12-04-26_account-availability-check.md` (status ready). The feature: at the start of every watch run, before any judge batch, one tiny chat-completions call per `LLM_ACCOUNTS` account in parallel; survivors judge the tick at their probe-measured ceilings; all-down skips judging, keeps posts unseen, sends the alarm, exits 0; failure messages stop claiming "all accounts failed" when only some failed. Two FRD open questions rode in as blocking: (1) the all-down exit code vs the failure-gated `Commit health` step, and (2) gate efficacy — whether a tiny pre-run call would have changed run 42440065433's outcome.

## Summary
- The new module `src/judge-availability.ts` does not exist yet (greenfield). It must reuse the judge's **wire shape** (normalizeEndpoint + Bearer + JSON body + `AbortSignal.timeout`, `src/judge.ts:497-504`) via the already-injected `fetchFn` seam, and must NOT reuse any rotation collaborator (`RotationState`, `pickEligibleAccount`, `coolAccount`, claim/release, park machinery, ledger stamps) — the check is one parallel one-shot with no rotation, no retry, no health writes.
- **The FRD's "filter the `LlmAccount[]` before `judgePosts`" wording is wrong for this codebase.** Ten consumers key by position in the full pool; a filtered array silently misroutes ceilings, health marks, outcome-ledger flushes, and every "account N" log line. The correct mechanism is the full pool plus a per-index blocked mask inside `RotationState`.
- The all-down skip branch lives in `runWatcher`'s **function body** (after Gate 1, before the judge stage) — not the entry catch — so it is testable and `flushTickHealth` stays structurally unreachable. It reuses `episodeAlarmDue` + `flushExhaustionHealth` + `sendExhaustionEmail` with `deps.transport`.
- **FRD open question 1 resolved by code evidence (developer-ratified): exit 0 needs no YAML change.** The skip branch flushes the episode bit on the green path; the success-path Commit state step already carries the health file (`watch.yml:243-247`, `[-f]`-guarded). Hazard to design around: pre-check 429s must NOT increment health marks, or two consecutive green skip ticks cap every account at ceiling 1.
- **FRD open question 2 resolved (developer-ratified): build the gate as specified; a concurrency guard is a separate follow-up.** Evidence: the gate would NOT have saved run 42440065433 — a tiny call passes all 3 accounts at tick start; the killer was 52 concurrent dispatches draining the 180s park budget while a healthy openrouter had work outstanding. The gate's real catch-class is dead keys (401/403) and dead endpoints — a different, real failure class (precedent: `869feed`'s burst-429 cascade, `fda50c2`'s hung-account stall).
- The "2 of 3" truthful-wording fix breaks no existing test (nothing pins the exhaustion message string). The pool size N is owned by `src/index.ts`'s env pool and, with the mask approach, `state.accounts.length` is already the true pool at every throw site.

## Detailed Findings

### 1. The transport seam: reuse the wire shape, not the dispatch core
- `dispatchLlmCall<T>` (`src/judge.ts:425`) is rotation-shaped, not transport-shaped: its loop skeleton requires `RotationState` (`src/judge-rotation.ts:73`), picks via `pickEligibleAccount` (`src/judge.ts:463`), claims/releases per attempt, and bakes in the 429-cool / 5xx-backoff / terminal ladder. Reusing it wholesale would force the availability module to fabricate a full rotation state — exactly what FRD D6 forbids.
- The part worth reusing is the per-attempt HTTP shape at `src/judge.ts:497-504`: `fetchFn(normalizeEndpoint(account.baseUrl))` (`normalizeEndpoint` at `src/judge.ts:213` — module-private, tolerates a full endpoint), Bearer header from the account's own key, `JSON.stringify(buildPayload(account))`, `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` (`src/judge.ts:504`; `REQUEST_TIMEOUT_MS = 60_000` at `src/judge.ts:78`).
- The pre-check needs its own ~10s timeout constant. The judge's 60s constant is module-private AND documented as a batch-latency contract ("15s was never validated from a GitHub runner", `src/judge.ts:71-77`) — borrowing it couples the pre-check budget to a value measured for a different reason. In-repo precedent for a module-local transport timeout: `linkedin-fetch.ts` carries its own private 30s `REQUEST_TIMEOUT_MS`.
- `normalizeEndpoint` is private: either export it (the `buildBulkMessages` F006 precedent — "measure the exact production prompt instead of a hand-copy that has already drifted", `src/judge.ts:242-246`) or keep a private copy with a MUST-stay-equal doc comment (the `HEALTH_CAP_STREAK`/`HARD_FAIL_TICKS_TO_CAP` paired-constant idiom). Exporting is the drift-proof route.
- Deliberate non-reuse list (each fails an FRD constraint mechanically): `RotationState` (11 judge-phase fields; `ceilings` is actively wrong — D6: the probe owns concurrency), `pickEligibleAccount` (skip predicates are the state to ignore; its dial serializes what FR1 wants parallel), `claimAccount`/`releaseAccount` (capacity bookkeeping; `claimAccount` also mutates `probedThisTick` for capped accounts — a judge-tick side effect), `coolAccount` (stamps a 60s cooldown AND wakes ceiling waiters), the retry ladders (non-goal: no same-run retry), park machinery (`parkUntilEligible`/`waitCeilingSlot`/`earliestCooldown`/`WAIT_BUDGET_MS` — a pre-check never waits; each account's wait is its own 10s abort), ledger stamps `stampFailure`/`stampSuccess` (the health flush consumes judge outcomes only; a tick that dispatched nothing "is neither success nor hard failure").
- Return contract: pass | failure per pool index, failures shaped as `AccountFailure` (`src/types.ts:34-43`: 1-based `account`, `baseUrl`, `reason`), reusing the existing reason vocabulary verbatim ("HTTP 429", "HTTP N", "HTTP 401 — key dead" from `terminalFailureReason` in `src/judge.ts`, "network error: <message>") so FR6's example message composes with zero translation. FR2's "unusable answer" class needs one new reason string (e.g. "missing message content" — the judge wrappers already own a warn for that exact condition).
- Payload: `{ model: account.model, messages: [one tiny message] }`. No `response_format` — it is a documented bulk-path-only rider ("response_format is a rider on the bulk path ONLY", `src/judge.ts:650-658`; mirrored in `judgePost`'s payload). No `reasoning_effort` — the signal is answerability, and forcing a reasoning model to think spends latency inside the 10s abort. Optional `temperature: 0` mirrors both judge payloads (judgment call, no contract rides on it). Pass on ANY non-empty `choices[0].message.content`; do not import `judge-parse.ts`.
- Import surface: `import type { LlmAccount } from "./judge.js"` (type-only), `import type { AccountFailure } from "./types.js"` (leaf). A runtime import of `judge-rotation.ts` is safe if needed — its runtime imports are none (type-only imports erased by `verbatimModuleSyntax`). NEVER runtime-import `judge.ts` (it drags the judge-health circuit in via its stamp imports) or `judge-health.ts`. This is what keeps `judge-rotation.ts`'s zero-runtime-import identity (`src/judge-rotation.ts:29-43`) intact.

### 2. Wiring: full pool + blocked mask — never filter the array
- The seam family (`WatcherDeps`, `src/index.ts:113-147`): a new `judgeAvailability?: (accounts: readonly LlmAccount[]) => Promise<AvailabilityResult>` mirrors `judgeCeilings` (`src/index.ts:126`) and `judgeHealth` (`src/index.ts:131`) — pool in, index-keyed structure out, never a filtered array, doc-comment states the never-throw degrade contract in the established template. Transport rides the existing `deps.fetchFn` (`src/index.ts:139`).
- The pool resolves once and hoists at `src/index.ts:271` (`resolveJudgeConfig(env)`) "precisely to keep indexes stable" (doc at `src/index.ts:262-270`, which also records the accepted trade: malformed `LLM_ACCOUNTS` now exit-1s even a Gate-1 tick).
- The shift surface — ten consumers key by position in the FULL pool: (1) ceilings map built at `src/index.ts:319` via `resolveCeilings`; (2) the `judgePosts` call wiring `src/index.ts:320-330` (full pool arg 2, full-pool ceilings arg 6, full-pool health marks arg 9); (3) the `RotationState` literal (`src/judge.ts:840-851`); (4) the `pickEligibleAccount` dial scan (`src/judge-rotation.ts:167-197`); (5) claim/release dial + in-flight (`src/judge-rotation.ts:230-248`); (6) pool width = Σ ceilings with capped→1 (`src/judge.ts:864-872`); (7) every "account N" warn line (core passes `attemptIndex + 1`); (8) the outcome ledger → flush chain (`readTickOutcomes` in `src/judge-health.ts:204` → `flushTickHealth` at `src/index.ts:336` → `nextHealthFile` `src/judge-health.ts:248-273`, which translates index → `accounts[index]?.baseUrl` against the full pool); (9) the failure record (`buildFailuresFromLedger` `src/judge-health.ts:226-245`, `exhaustionRecord` `src/judge.ts:372-398`, both 1-based); (10) the entry-catch bootstrap (`src/index.ts:451-458`, re-resolves the FULL pool and flushes `error.health` indexes against it).
- The sharpest hazard if filtered: item 8 is produce-inside/consume-outside. With a filtered array `[acct0, acct2]`, a ledger `ok: [1]` means acct2 succeeded, but `nextHealthFile` reads `judgeAccounts[1]` = acct1 and **clears the wrong account's health streak** — a phantom recovery committed to `state/judge-health.json`. The type signatures (`Map<number, number>`/`TickOutcomes`) catch nothing.
- Mask mechanisms compared: **M1 (recommended) — explicit `blocked: ReadonlySet<number>` on `RotationState`**: one skip line in `pickEligibleAccount`, width excludes blocked indexes, and `exhaustionRecord` gains a blocked appendix mirroring the existing capped appendix (`src/judge.ts:377-390`) so pre-blocked accounts appear in mid-run exhaustion emails with their availability reason. Requires a new `judgePosts` parameter. **M2 — ceiling-0 encoding**: the pick's `(inFlight ?? 0) >= ceiling` skips it and width contributes 0, but it violates the documented invariant "probe-measured in-flight ceiling (>= 1)" (`src/judge-rotation.ts:76-78`) and blocked accounts vanish from the failure record. **M3 — pre-stamp `cooldownUntil`**: blocks the pick but mislabels every reason as "HTTP 429" and routes an all-blocked pool into the 180s budget park → exhaustion throw → exit 1 — the exact opposite of FR5. Rejected.
- Placement: below Gate 1, above the judge stage — after the Gate-1 return (`src/index.ts:303-310`), before the judge `timeStage` (`src/index.ts:313` region). Gate-1 ticks make zero judge calls, so FR1 is vacuous there and running N tiny calls per quiet tick contradicts the cost NFR (~144 calls/account/day). **Gotcha:** the skip branch must sit at function level — a `return` inside the judge `timeStage` closure would leave `flushTickHealth` at `src/index.ts:336` running against an undefined `judgeOutcome`.
- Synergy: because the mask keeps the pool whole, `state.accounts.length` at every throw site IS the true pool size — the "2 of 3" fix (Finding 5) needs no threading beyond a parameter.

### 3. The all-down skip path
- Today the alarm machinery lives only in the entry-module catch (`src/index.ts:441-485`), reachable exclusively via the tagged `RotationExhausted` thrown at `src/judge.ts:792` (bare, no health payload), `:898` (bulk drain-then-throw), `:976` (fallback drain-then-throw). The catch: `isRotationExhausted` gate (`:447`), bootstrap re-resolve from `process.env` (`:451`), pre-flush health read (`:452-456`), `flushExhaustionHealth` opens the bit (`:458`), episode suppression (`:467-470`), `sendExhaustionEmail` (`:473`), `process.exit(1)` (`:480`). This catch is production-only and untestable ("which no test reaches", `src/judge-health.ts:17-21`).
- A skip run must reproduce: ids unseen (skip `persistJudged`; Gate-1 precedent `src/index.ts:303-310` — honest `WatcherRun` is `{ judged: 0, matches: 0, skipped: newPosts.length, saved: false }`), alarm once per episode (pre-flush `episodeAlarmDue` read → flush open → suppress-or-send, the `src/index.ts:456 → :458 → :467-479` order), exit 0 for free (a resolving `runWatcher` never enters the catch; Node exits 0 implicitly), and no `flushTickHealth` (with zero dispatches its episode logic can only keep a bit open, never open or close one — and FR7 doctrine says a non-dispatching gate never flushes).
- Mechanism: **Option A (recommended)** — `judgeAvailability` returns the all-down case with failures as `AccountFailure[]` (non-empty by construction — an empty pool cannot reach the check, `parseLlmAccounts` throws on empty `src/judge.ts:151-154`; this also keeps `buildExhaustionText`'s null-guard from silently swallowing the alarm, `src/email.ts:194-195`). `runWatcher`'s body checks it and, on zero survivors, runs the same episode-check → exhaustion-flush → suppress-or-send sequence via a **shared helper extracted from the catch** (parameterized: the catch keeps passing `resolveJudgeConfig(process.env)`, the skip passes `judgeAccounts` + the already-loaded pre-flush snapshot `health.file`), then early-returns `saved: false`. The alarm send must pass `deps.transport` so the offline rule holds. **Option B** (inline second copy) drifts — rejected. **Option C** (synthetic `RotationExhausted` taught to exit 0) overloads a mid-run error contract, hardcodes exit 1 in the catch, makes tests observe a rejection instead of a `WatcherRun`, and would flush tick outcomes that must not exist — rejected.
- **Deadlock guard:** the skip branch is also the invariant that `judgePosts` is only ever invoked with ≥ 1 survivor. `waitCeilingSlot` has NO timer — it resolves only on real release events (`src/judge-rotation.ts:253-277`), and `allHealthBlocked` (`src/judge.ts:354-368`) recognizes only healthMark-capped pools. A zero-survivor pool entering `judgePosts` under the mask would park a worker on the release queue forever.

### 4. Exit code + episode-bit persistence (FRD open question 1 — RESOLVED)
- The episode bit is `HealthFile.outageOpen` (`src/judge-health.ts:58`), opened only via `flushExhaustionHealth(..., true)` (`src/judge-health.ts:405-417`, hard-coded `true` at `:412`), suppressed by `episodeAlarmDue` (`src/judge-health.ts:427-431`: `file?.outageOpen !== true`, fail-visible on absent file), read PRE-flush.
- The failure-only Commit health step (`watch.yml:202-224`, `if: always() && failure()` at `:214`) exists because the exhaustion `process.exit(1)` kills every later step. But the SUCCESS-path Commit state step (`watch.yml:228-254`) already carries the health file too — `git add state/seen-posts.json` then the `[-f]`-guarded health add at `watch.yml:243-247` under the comment "The health file joins the success-path commit set". A green skip run that flushes the bit gets it committed by the existing success path. **No YAML change needed.**
- Seen-posts is untouched on a skip run (no `persistJudged`; and `saveState` refuses empty id lists anyway), so the success-path no-op guard skips the commit — ids stay unseen at both the process and workflow level. Cosmetic wrinkle: the skip run's Commit state commit message computes "state: 0 new seen post ids" if the health file changed (acceptable; design may special-case).
- **The marks hazard (design MUST handle):** `nextHealthFile` increments a mark for every index in `outcomes.failed` (`src/judge-health.ts:260-268`), and the doctrine says 429 NEVER counts ("HTTP 429 is the NON-countable flavor ... never stamp a 429 here", `src/judge-health.ts:46-52`; enforced in the judge core where only terminal/transport outcomes stamp). Feeding pre-check 429s raw into `flushExhaustionHealth` would hard-fail-cap accounts (streak ≥ 2 → effective ceiling 1) after two consecutive skip ticks. The skip flush must pass outcomes that exclude 429-only failures from the marks merge (empty outcomes is the safe shape: it preserves every mark and flips only the bit — an empty-outcomes exhaustion flush is exactly the shape `state/judge-health.json` has at HEAD: `marks: {}`, `outageOpen: true`).
- Alternatives weighed and rejected: keep exit 1 (contradicts FR5/D3; red X every 10 minutes during an outage — the alert fatigue the FRD removes); widen the gate to `if: always()` (violates the FRD no-YAML constraint; also commits on concurrency-cancelled runs).

### 5. Truthful exhaustion wording (FR6/D7)
- The lie is manufactured in `rotationExhausted` (`src/judge-rotation.ts:130-146`): `"judge: all ${failures.length} LLM_ACCOUNTS account(s) exhausted — ..."` at `src/judge-rotation.ts:135-137`. `failures.length` is the failure-record length, not the pool. The record (`exhaustionRecord` `src/judge.ts:372-398` ← `buildFailuresFromLedger` `src/judge-health.ts:226-245` + the capped appendix) omits accounts whose last outcome was ok or never-dispatched-with-no-cooldown — so a 3-account pool with 1 survivor prints "all 2".
- The pool size is in scope at all three throw sites (`state.accounts.length`; `rotationExhausted`'s signature is `(failures, health?)` and never sees the state) — with the mask approach (Finding 2) the pool stays whole, so `state.accounts.length` IS the env pool N. Pass it in; the message becomes FR6's "judge: 2 of 3 LLM_ACCOUNTS accounts failed — account 1 (...): HTTP 429; ...".
- **No interface change required**: the format lives in the factory string; the type guard `isRotationExhausted` (`src/judge-rotation.ts:148-150`) matches the name tag only. An optional `poolSize?: number` field is unnecessary — email callers recover N themselves (Finding 6).
- Test ripple: **no existing test pins the error's message string** (verified by grep across tests/). All exhaustion assertions are structural: `tests/judge-rotation.test.ts` (`isRotationExhausted` assertions; failure-record arrays; the budget-death case at :254 where "all N" happens to be truthful and becomes "N of N"), `tests/judge.test.ts:764-767` (bare throw, `health === undefined` at :766) and :851-864 (all-health-blocked merge), `tests/index.test.ts:435-478` (budget-death: `isRotationExhausted` at :470, failures [1], **no email** — the email send lives only in the unreachable entry catch — state ENOENT at :477). The correction to the question premise: `tests/index.test.ts` does NOT assert the log line; the format change breaks nothing and the ripple is new acceptance assertions only.

### 6. Alarm email copy (FR6)
- Body: `buildExhaustionText` (`src/email.ts:193-210`) — the per-account lines (`:195-198`) ALREADY enumerate each failed account's outcome in pool order; the lie is the header at `src/email.ts:200` ("The LLM judge pool is exhausted — every LLM_ACCOUNTS account failed."). Remedy lines :204-205 stay true in the mixed case ("No digest was sent" holds — the throw precedes the notify stage).
- Subject: `sendExhaustionEmail` (`src/email.ts:215-227`) pluralizes from `failures.length` alone at `src/email.ts:223` — "LLM judge pool exhausted (2 accounts failed)", pool-blind.
- The missing datum is pool size N. Do NOT enrich `AccountFailure` (per-entry `poolSize` is redundant; survivors cannot ride the failures list at all). Render survivors by set-difference at the email layer: pool 1..N minus `failures.map(f => f.account)` — needs only N. (Alternative: `error.health.ok` indexes ride judgePosts-thrown errors but not the bare :792 throw — set-difference is uniform across all callers.)
- Callers already hold N: the entry catch re-resolved `bootstrapAccounts` at `src/index.ts:451`; the new skip path runs inside `runWatcher` where `judgeAccounts` (`src/index.ts:271`) and the pre-check results are both in scope. Signatures gain a trailing `poolSize?` param: `buildExhaustionText(failures, poolSize?)`, `sendExhaustionEmail(failures, config, transport?, poolSize?)`. Target subject: "LLM judge pool exhausted (2 of 3 accounts failed)" — preserves the pinned `/judge pool exhausted/` regex (`tests/email.test.ts:409`) and must keep the `LLM_ACCOUNTS` token in the body (`tests/email.test.ts:384` asserts `text?.includes("LLM_ACCOUNTS")`).
- Contract pins that constrain the fix (all verified at `tests/email.test.ts:371-435` and :517-528): empty list → null → no send (safe to keep: every production call site is non-empty by construction — `src/judge-health.ts:229-233` and the capped appendix `src/judge.ts:377-390`); health reasons render verbatim ("HTTP 503", "HTTP 401 — key dead", "network error: socket hang up") — unchanged by copy edits.

### 7. Gate efficacy vs run 42440065433 (FRD open question 2 — RESOLVED: gate now, guard as follow-up)
- The exhaustion terminal has exactly one road: the cooldown-park flavor of `dispatchLlmCall`'s undefined-pick split (`src/judge.ts:463-490`). `earliestCooldown` (`src/judge-rotation.ts:282-291`) reads cooldown stamps ONLY — in-flight work, health caps, and ceilings are invisible to it — and is checked FIRST in the flavor split, before the zero-charge arms. So the terminal can fire while a non-cooling account still has an outstanding request: two 429'd accounts' stamps dominate every evaluation, the shared 180s budget (`WAIT_BUDGET_MS` `src/judge.ts:121`, charge-before-sleep in `parkUntilEligible` `src/judge-rotation.ts:307-331`) drains in ~3 concurrent parks (3 × 60.5s ≥ 180s — the arithmetic pinned at `tests/judge-rotation.test.ts:224-255`, sleeps pin :250), and the next parker trips `exhausted`.
- What a tiny pre-run call CAN catch: auth-dead keys (401/403 — the probe's `classifyDead` precedent in `scripts/probe-judge.ts`), endpoint death (persistent 5xx, DNS/socket). What it CANNOT catch: 429-under-concurrency (a rate limit is a per-window budget — one tiny call passes precisely when the 30-way bulk wave seconds later refuses), queueing/hang under load (a provider serves the ping while queueing real batches past the 60s abort), ceiling validity over time.
- Determination: **the gate would NOT have changed run 42440065433's outcome.** Committed ceilings (nube 32, openrouter 32, z.ai 4, Σ=68) ≥ 52 batches — every batch dispatched immediately; the dial walk gives a healthy openrouter ~20-24 first-wave dispatches, and every 429-rewind funnels MORE onto it as the others cool. The gate's catch-class (auth-dead, endpoint-dead) was empty in this run.
- The only in-code mechanism producing openrouter's observed "1 of ~52": the health-cap half-open gate (`src/judge-rotation.ts:184-190`) — a committed streak ≥ 2 caps it at effective ceiling 1, its single claim registers `probedThisTick`, and only `stampSuccess` (which a hung or unusably-answering probe never triggers — a parse-miss resolve stamps nothing, `countsSuccess: false`) frees it for the tick. Empirical check for the follow-up: `git log -p state/judge-health.json` around 2026-11-08 02:50 UTC for an openrouter entry ≥ 2 (HEAD's `marks: {}` is post-hoc — marks self-heal). The competing ceiling-side explanation (floored-at-1) is ruled out by the committed file showing 32; a stale-checkout read would show the floor warning in the run log.
- Developer decision recorded: build the gate as specified (it covers a real, different failure class), and research the concurrency guard separately — any guard shaping outstanding-request count (per-account in-flight throttling from observed 429s/latency, or mid-run width shrink) operates directly on the primitives that produced the death (width `src/judge.ts:864-872`, the budget park, `earliestCooldown` semantics — the FRD follow-up "the exhaustion gate can fire while a non-cooling account is merely slow" is exactly this re-check).

### 8. Checker-error degrade contract (ratified against fail-visible)
- The FRD NFR ("a checker error degrades to 'all accounts available' with one warning line") is ratifiable as written. The checker is a degradable reader of LIVE provider state — the same family as `loadAccountCeilings`/`loadAccountHealth` (both never-throw, warn-once; `src/judge-ceilings.ts` and `src/judge-health.ts:131-171`). It does not violate "No silent fallbacks" — that clause governs config/state, and the degrade is loud (one warning naming the cause).
- Two-layer catch split: **Layer 1 — per-account fetch rejection is NOT a checker error; it IS the signal** (`AbortSignal.timeout` rejects with TimeoutError, `fetch` rejects on dead socket, `response.json()` on bad body; each becomes that account's failure reason — the exact conversion `dispatchLlmCall`'s transport catch performs). **Layer 2 — a wrapper-level fault before/around dispatch degrades to all-available**: `Promise.allSettled` never rejects, so a try/catch around the orchestration fires only for module-code faults (synchronous throws building probes, a broken injected `fetchFn` that throws before dispatch begins). Boundary sentence: anything after the first dispatch begins is per-account data; anything before it is a checker fault. This total-function shape is the codebase's central lesson ("outcomes are RETURNED, never thrown inside a core whose catches are total converters", `src/judge.ts:407-411` and :877-878).
- `Promise.allSettled` lives in `src/judge-availability.ts`, NOT `src/index.ts`: the FRD's placement, the seam-doc doctrine ("the module owns its degrade contract", `src/index.ts:121-131`), and the offline rule (a module-owned degrade is assertable by injecting a throwing `fetchFn`, like the ceilings degrade is asserted through `deps.judgeCeilings`). `index.ts` owns run-shape policy only: filter-by-mask, log sit-outs, skip-or-proceed.
- Distinguishability: make it data, not prose — a `degraded: boolean` field on the module's return (the `resolveCeilings` returns-warnings-as-data precedent, "warnings are RETURNED, not printed, so the acceptance test asserts the array") plus exactly one warning line naming the error verbatim (the `loadAccountCeilings` "unreadable (<message>)" pattern; cf. index.ts's D12 belt catch for the linkedin payload seam). The degrade cannot swallow a real bug: the message lands verbatim and the unfiltered run still exercises every account through the judge's own per-account warns.

### 9. Offline test surface
- Two disjoint injection points: **pipeline acceptance tests inject a `judgeAvailability` double** at the `WatcherDeps` seam (the checker never touches HTTP; counting judge-call avoidance is unambiguous), **module unit tests pass fetch doubles as a parameter** into the checker function (the `judgePost` trailing-param pattern, `src/judge.ts:726-737`), classifying FR2's five outcomes: 429, timeout (a rejecting double — no real timers per the inert-sleep doctrine), 5xx, transport throw, unusable answer.
- Acceptance mapping: all-pass → inject resolve-all, assert run shape equals today; some-pass → fail-one-of-three, assert ONLY survivors dispatched (URL-recording pattern `auths[]` + per-host branching — `tests/index.test.ts:721` records each fetch host, :766 pins `auths.length === 1` for the half-open probe) plus ceiling alignment for survivors; all-fail → inject fail-all, assert `fetchFn` never called, exactly one alarm via the recording transport with per-account text, state ENOENT, and the run RESOLVES; checker-error → inject a throwing double, assert exactly one `console.warn` (the `t.mock.method(console, ...)` pattern) and an unfiltered run; "2 of 3" → new assertions at the `rotationExhausted` boundary + email subject.
- **The exit-0 skip run is asserted by construction**: `runWatcher` has no catch — it resolves (production exits 0 implicitly) or rejects. The skip path must be a normal `return` from the function body (Finding 3 placement) so tests assert the resolved `WatcherRun`, the alarm mock, and state ENOENT — never an exit code.
- **Breakage inventory (the inversion reaches existing tests):** if the default checker runs over `deps.fetchFn`, every existing judge-stage test whose fetch double would fail a tiny call silently becomes a skip run: the budget-death test (`tests/index.test.ts:435-478`, `all429` refuses everything — `assert.ok(isRotationExhausted(undefined))` would fail), the partial-persistence test (:410-433, single-post branch returns 500 at :264), and the provider-health acceptance test (:710-781, 503s — ironically the pre-check would consume the very streak scenario the health circuit's test pins). The honest inventory: **inject a pass-all `judgeAvailability` into every existing test that runs the judge stage**; do NOT rely on the checker tolerating `judgeFetch`'s answer shape (fragile coupling).
- Untouched: the entire `tests/judge-rotation.test.ts` suite calls `judgePosts`/`judgePost` directly — below the filter point — so spread/cooldown/park/exhaustion semantics (FR7/D8 mid-run behavior) test unchanged. The episode-bit suppression logic, untestable while it lives in the entry catch, becomes directly testable the moment the skip path moves the alarm send into `runWatcher`'s body with `deps.transport`.

## Code References
- `src/judge.ts:78` — `REQUEST_TIMEOUT_MS = 60_000` (judge batch-latency contract; the pre-check needs its own ~10s constant)
- `src/judge.ts:121` — `WAIT_BUDGET_MS = 180_000` (the shared park budget the exhaustion terminal drains)
- `src/judge.ts:133-137` — `LlmAccount` {baseUrl, apiKey, model} (type-only import for the new module)
- `src/judge.ts:146` — `parseLlmAccounts` (fail-visible pool parse; throws on empty — the skip path's non-empty guarantee)
- `src/judge.ts:206-210` — `resolveJudgeConfig` (the hoisted pool resolver, `src/index.ts:271`)
- `src/judge.ts:213-216` — `normalizeEndpoint` (module-private; export it or pair-constant a copy)
- `src/judge.ts:247` — `buildBulkMessages` (the F006 export-for-drift-proofing precedent)
- `src/judge.ts:372-398` — `exhaustionRecord` (ledger + capped appendix, pool-ordered; the mask needs a blocked appendix sibling)
- `src/judge.ts:407-411` — the "outcomes RETURNED, never thrown" core lesson (the checker's total-function template)
- `src/judge.ts:425` — `dispatchLlmCall<T>` (rotation-shaped core; reuse ONLY the wire shape :497-504)
- `src/judge.ts:463-490` — the undefined-pick flavor split (cooldown park checked FIRST — the terminal's only road)
- `src/judge.ts:497-504` — the per-attempt HTTP shape (the seam the pre-check reuses)
- `src/judge.ts:650-658` — bulk payload with the `response_format` bulk-only rider (excluded from the tiny payload)
- `src/judge.ts:726-737` — `judgePost`'s trailing-param injection idiom (the unit-test pattern for the checker)
- `src/judge.ts:792` / `:898` / `:976` — the three `RotationExhausted` throw sites (`state.accounts.length` in scope at each)
- `src/judge.ts:829` — `judgePosts` signature (gains the blocked-mask parameter)
- `src/judge.ts:840-851` — the `RotationState` literal (co-indexed with the pool it receives)
- `src/judge.ts:864-872` — pool width = Σ ceilings (capped→1; mask must exclude blocked indexes)
- `src/judge-rotation.ts:29-43` — the zero-runtime-import identity (type-only imports; the new module must not break it)
- `src/judge-rotation.ts:47` — `COOLDOWN_MS = 60_000` (first-write-wins)
- `src/judge-rotation.ts:62` — `HEALTH_CAP_STREAK = 2` (paired twin of `HARD_FAIL_TICKS_TO_CAP`)
- `src/judge-rotation.ts:73-113` — `RotationState` (the blocked set joins here, M1)
- `src/judge-rotation.ts:119-128` — `RotationExhausted` interface (no change needed for the wording fix)
- `src/judge-rotation.ts:130-146` — `rotationExhausted` factory (the "all N" lie at :135-137; gains a poolSize param)
- `src/judge-rotation.ts:148-150` — `isRotationExhausted` (name-tag guard; unaffected)
- `src/judge-rotation.ts:167-197` — `pickEligibleAccount` (the dial scan; gains the blocked skip line)
- `src/judge-rotation.ts:184-190` — the health-cap half-open gate (openrouter starvation suspect)
- `src/judge-rotation.ts:230-248` — `claimAccount`/`releaseAccount` (dial move + probe registration)
- `src/judge-rotation.ts:253-277` — `waitCeilingSlot` (NO timer — the zero-survivor deadlock hazard)
- `src/judge-rotation.ts:282-291` — `earliestCooldown` (cooldown-stamps-only read; the FRD follow-up re-check)
- `src/judge-rotation.ts:307-331` — `parkUntilEligible` (charge-before-sleep budget draw)
- `src/index.ts:113-147` — `WatcherDeps` (the seam family; `judgeAvailability` joins after :131)
- `src/index.ts:139` — `deps.fetchFn` (the transport seam the checker rides)
- `src/index.ts:262-278` — the hoist + health read (stable-index rationale; the accepted malformed-pool trade)
- `src/index.ts:303-310` — Gate 1 early return (the no-persistence precedent the skip mirrors)
- `src/index.ts:313-336` — judge stage + `flushTickHealth` (the skip branch must precede the stage at function level)
- `src/index.ts:441-485` — the entry-module catch (production-only, untestable; extract its episode/alarm sequence into a shared helper)
- `src/index.ts:451-458` — bootstrap re-resolve + exhaustion flush (the helper's catch-side parameterization)
- `src/index.ts:473` — `sendExhaustionEmail` call site in the entry catch (gains the poolSize argument; production nodemailer, no transport arg — the skip path's alarm send rides `deps.transport` instead)
- `src/judge-health.ts:46-52` — the 429-never-counts doctrine (the skip-flush marks hazard)
- `src/judge-health.ts:53-58` — `HealthFile` + `outageOpen` (the episode bit)
- `src/judge-health.ts:131-171` — `loadAccountHealth` (never-throw reader template for the checker's degrade)
- `src/judge-health.ts:204-216` — `readTickOutcomes` (the ledger → flush unit)
- `src/judge-health.ts:226-245` — `buildFailuresFromLedger` (1-based record; "HTTP 429" for cooling-only)
- `src/judge-health.ts:248-273` — `nextHealthFile` (index → baseUrl translation against the FULL pool; the marks merge)
- `src/judge-health.ts:405-417` — `flushExhaustionHealth` (opens the bit unconditionally; the green-path flush)
- `src/judge-health.ts:427-431` — `episodeAlarmDue` (pre-flush read discipline)
- `src/judge-ceilings.ts` — `resolveCeilings`/`loadAccountCeilings` (the degrade-family template; warnings-as-data precedent)
- `src/email.ts:193-210` — `buildExhaustionText` (the header lie at :200; per-account lines already truthful)
- `src/email.ts:215-227` — `sendExhaustionEmail` (the pool-blind subject at :223)
- `src/types.ts:34-43` — `AccountFailure` (the shared failure currency; do not enrich)
- `.github/workflows/watch.yml:202-224` — Commit health (failure-gated at :214; unchanged by the resolution)
- `.github/workflows/watch.yml:228-254` — Commit state (the success path already carries the health file at :243-247)
- `tests/index.test.ts:435-478` — the budget-death contract test (needs a pass-all `judgeAvailability` injection)
- `tests/index.test.ts:710-781` — the provider-health acceptance test (same injection; would otherwise be consumed by the skip path)
- `tests/email.test.ts:371-435` and :517-528 — the exhaustion email pins (subject regex :409, LLM_ACCOUNTS token :384, health reasons :517-528)
- `tests/judge-rotation.test.ts:224-255` — the budget-drain arithmetic pin (sleeps [60_500, 60_500, 59_000] at :250)
- `tests/judge-helpers.ts` — the fixture scaffolding (accounts, ok(), bulk fixtures)

## Integration Points

### Inbound References
- `src/index.ts:320-330` — `runWatcher` calls `judgePosts` (full pool + ceilings + health marks + `deps.fetchFn`); the availability check slots between the Gate-1 return and this stage
- `src/index.ts:336` — `flushTickHealth` consumes `judgeOutcome.outcomes` produced inside `judgePosts` (the produce/consume index hazard)
- `src/index.ts:441-485` — the entry catch consumes `RotationExhausted` (`failures`, `health`) and drives the alarm
- `src/index.ts:473` — `sendExhaustionEmail(error.failures, resolveEmailConfig(process.env))` (production nodemailer, no transport arg)
- `scripts/probe-judge.ts` — imports `buildBulkMessages`/`resolveJudgeConfig` (the export-for-drift-proofing precedent); its `classifyDead` is the pre-check's dead-classification precedent

### Outbound Dependencies
- New `src/judge-availability.ts` → `type LlmAccount` from `src/judge.ts` (TYPE-ONLY — a runtime import drags the judge-health circuit in), `type AccountFailure` from `src/types.ts`, `fetchFn: typeof fetch` injected, optionally `rotationExhausted` runtime from `src/judge-rotation.ts` (safe: zero runtime imports there)
- The skip path (in `src/index.ts`) → `episodeAlarmDue` + `flushExhaustionHealth` (`src/judge-health.ts`) + `sendExhaustionEmail` (`src/email.ts`) via the shared helper
- The mask (in `src/judge-rotation.ts`) → `pickEligibleAccount` skip line + width exclusion + `exhaustionRecord` blocked appendix

### Infrastructure Wiring
- `WatcherDeps.judgeAvailability` seam (`src/index.ts`, beside `judgeCeilings` :126 / `judgeHealth` :131) — never-throw default documented in the established template; checker transport = `deps.fetchFn`
- `.github/workflows/watch.yml:243-247` — the success-path health add that makes exit-0 persistence work with no YAML change
- `state/judge-health.json` — unchanged writer set (still the watch run only); the skip flush is a new call site of the same writer
- No new state file, no new workflow job, no new env var (FRD non-goals/constraints hold)

## Architecture Insights
- **Pool index is operational identity; baseUrl is display identity.** Every per-account keyed map translates by index at startup; anything that renumbers the pool (a filtered array) silently misroutes. The blocked-mask approach keeps `src/index.ts:271` as the single indexing truth.
- **The D3-seam family grows by one**: payload in, index-keyed structure out, module owns its never-throw degrade contract, doc comment states it in the established template.
- **Total functions everywhere**: outcomes are returned, never thrown inside a core with total catches (the checker returns pass/fail; the skip path returns a `WatcherRun`; the only throw remains the tagged mid-run error).
- **Drain-then-throw at the join** keeps failure records complete; the skip path never throws at all — exit 0 falls out of `runWatcher` resolving.
- **The 429-never-counts doctrine has a new attack surface**: any path that feeds outcomes into `nextHealthFile` without the judge core's stamping discipline can cap accounts. The skip flush must pass marks-safe outcomes.
- **One datum, four sites**: pool size N flows to the error message, the FAILED log line, the email subject, and the email header — owned by `src/index.ts`'s env pool, trivially available as `state.accounts.length` under the mask.
- **judge.ts sprawls under judge-pool features** — it doubled twice before the forced split (`f14d9f9`). The checker is its own module from the start; the wording fix touches `judge-rotation.ts` + `email.ts` only.
- **Precedence in the flavor split is load-bearing**: `earliestCooldown` is checked first, so cooldown stamps dominate health/capacity signals — the structural reason "alive but throttled" kills runs and why the guard follow-up must re-read those semantics.

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: Provider health circuit — pre-judge per-account gating, alarm rework, new module
**Commit(s)**: `89cbd42` — "judge: provider health circuit, one exhaustion alarm per outage episode" (2026-11-07)
**Blast radius**: 16 files across 5 layers (src/ new judge-health.ts + wiring in judge-rotation/judge/index/email/heartbeat/config; workflows/ new Commit health step +38; scripts/ skip-set third literal; tests/ 6 suites incl. +511 judge-health.test.ts)
**Follow-up fixes**: `da2997f` (2026-11-07) — commit-back rebases onto the branch remote (run 885 dispatch race); `ddbb26d` (2026-11-08) — probedAt stamp + 8h dispatch freshness gate (the probe ran on every dispatch with no cadence gate)
**Lessons from docs**: research 2026-11-07 (all-health-blocked pools HANG silently — needed a third exhausted arm; 503-only pools exit 0 with no alarm; non-empty failure records or the email silently skips); plan 2026-11-07 (byte-stability is a commit-cadence constraint; judge-ceilings.ts is the verbatim new-module template)
**Takeaway**: any all-down "stay green" path must be checked against the failure-gated health-commit step — this repo already had one documented, unresolved exit-code/persistence conflict on this exact path (now resolved by this research).

### Precedent: Per-batch rotation + cooldown park + gating probe
**Commit(s)**: `1a61bf9` — "feat: per-batch LLM account rotation with cooldown park and gating probe" (2026-10-28)
**Blast radius**: 17 files across 4 layers (judge.ts +315, probe-judge.ts +141, watch.yml probe made gating, index.ts, 4 rotation artifacts)
**Follow-up fixes**: `f14d9f9` (2026-10-30, +2d) — judge.ts had grown to 779 lines, forced the pool/rotation/parse split; `ced76f8` (2026-10-31) — export-surface cleanup after the split
**Lessons from docs**: plan 2026-10-27 (four invariants: sync-before-await dispatch; injected now/sleepFn — mock.timers disqualified; sentinels-not-throws across the bulk try/catch; non-empty failure records by construction); research 2026-11-06 ("judge.ts sprawls under rotation features — the last one doubled it and forced a split within 2 days")
**Takeaway**: the checker lands in its own module from the start (the FRD's `src/judge-availability.ts` is right) and the four rotation invariants transfer verbatim to its tests.

### Precedent: First account rotation — and the two same-week failures that shaped everything after
**Commit(s)**: `869feed` — "feat: rotate llm accounts to avoid the rate limit" (2026-10-26)
**Blast radius**: 12 files across 4 layers (judge.ts +373, email.ts, index.ts, config.ts, probe, watch.yml, tests)
**Follow-up fixes**: `fda50c2` (2026-10-26, same day) — hung accounts silently stalled the run → defer unanswered batches + raise the timeout; `7cc7250` (2026-10-27) — a guessed width broke within one day (burst-429 cascaded the pool, 327 posts unjudged); superseded by `1a61bf9` after run 40463798717
**Lessons from docs**: validation 2026-10-26 (transient all-429 windows minutes apart on the same endpoint; live ramp measured ceiling 4 with a real 429 at 8-wide)
**Takeaway**: "alive at check time, throttled under load minutes later" is this system's most-recurring failure mode — a passing pre-check does not guarantee the tick (the recorded gate-scope decision accepts this; the guard follow-up targets it).

### Precedent: Probe-measured ceilings + probe→watch dispatch topology
**Commit(s)**: `522395a` — "spread dispatch across the pool under probe-measured per-account ceilings" (2026-11-06); `3e7e38c` — "write and commit state/judge-ceilings.json from the dispatch-only gate" (2026-11-06)
**Blast radius**: judge-ceilings.ts +143, judge-rotation.ts +184, judge.ts 345 changed, watch.yml +49, rebase skip-set set-semantics, tests
**Follow-up fixes**: `d284d2e`/`98c9c1f` (2026-11-07) — probe and watch as sibling jobs with no needs: → same-run reads impossible, serialized; `da2997f` (2026-11-07) — rebase must target the checkout branch's own remote head
**Lessons from docs**: research 2026-11-06 ("the watch job can never read the same-run probe's write" — accepted next-run freshness; dead accounts can carry plausible probe readings; baseUrl is trimmed display identity, INDEX is operational identity)
**Takeaway**: the pre-check result is per-run in-memory state (FRD agrees — nothing in state/); keep it out of the committed-state/commit-back machinery entirely, or it inherits the race cluster.

### Precedent: CI commit-back saga
**Commit(s)**: `510ff2a` (2026-10-30) → `bc760cb`, `2e28916`, `45bcbd3`, `8b777e6`, `89c8bc5` (2026-10-31) → `b779ff7` (2026-11-01)
**Blast radius**: watch.yml + scripts/commit-state-rebase.sh + 342 lines of script tests
**Follow-up fixes**: the six commits above ARE the fixes (full-history fetch, force-with-lease, conflict-skip, set-e-proof bounded loop, conflicted-path gating, script extraction)
**Lessons from docs**: research 2026-11-06 ("CI git plumbing fails in clusters: any new committed artifact inherits rebase/race/conflict risk — budget a live-dispatch validation with a same-day fix window")
**Takeaway**: the FRD's "no workflow YAML changes" constraint is load-bearing — the recorded resolution honors it; the moment a new step touches watch.yml's git plumbing, history says expect 3-6 same-week fix commits.

### Composite Lessons
- Offline tests passed on every prior rotation/probe/health change; live runs caught the real failure each time (`869feed`→`fda50c2`/`7cc7250`, `522395a`→`d284d2e`/`da2997f`). Schedule a `workflow_dispatch` smoke run against the real endpoint with a same-day fix window.
- Hung accounts are a repeat offender (`fda50c2` 2026-10-26; run 42440065433's openrouter 2026-11-08): the checker needs its hard ~10s per-account timeout or it re-introduces the stall the first fix addressed.
- New judge-pool logic never starts in judge.ts — ceilings and health modules are the templates (pure resolver + never-throw reader, tested in src/).
- Account identity is the pool INDEX, not the baseUrl — keyed maps translate by index at startup (the mask approach exists because of this).
- Truthful wording is a standing requirement: non-empty failure records by construction, and now pool-truthful counts (D7).

## Historical Context (from .rpiv/artifacts/)
- `.rpiv/artifacts/discover/2026-11-08_12-04-26_account-availability-check.md` — the FRD chaining into this research (D0-D8 decisions, FR1-FR7, the two now-resolved open questions)
- `.rpiv/artifacts/discover/2026-11-07_07-13-17_provider-health-circuit.md` — the provider-health FRD (amended)
- `.rpiv/artifacts/research/2026-11-07_07-26-22_provider-health-circuit.md` — provider-health circuit research
- `.rpiv/artifacts/solutions/2026-11-07_08-22-22_provider-health-module-boundary.md` — the health-module boundary this feature must not break
- `.rpiv/artifacts/plans/2026-11-07_08-49-53_provider-health-module-boundary.md` — the module-boundary plan
- `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md` — the dispatch-spread FRD
- `.rpiv/artifacts/research/2026-11-06_10-12-16_llm-account-spread-judge.md` — the spread research (dead-ends, CI-plumbing lessons)
- `.rpiv/artifacts/solutions/2026-11-06_11-05-39_llm-account-spread-judge.md` — the settled dead-ends (do not re-litigate)
- `.rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md` — the finalized spread design
- `.rpiv/artifacts/plans/2026-10-27_17-55-19_per-batch-llm-rotation.md` — the rotation invariants plan
- `.rpiv/artifacts/discover/2026-10-27_14-08-35_per-batch-llm-rotation.md` — the per-batch rotation FRD
- `.rpiv/artifacts/validation/2026-10-26_20-14-35_llm-account-rotation.md` — the first-rotation live validation

## Developer Context
**Q (discover: Who feels the pain): Who feels the pain most when a rate-limited account kills the run — and what does a good run look like for them?**
A: Job seeker — the digest must reach job seekers even when providers throttle the run.

**Q (discover: Core: availability = a pre-run pool filter): The developer's feature statement (rate-limited accounts sit out; only active accounts watch).**
A: Keep — filter the pool before dispatch. (Research correction: the "filter" is a blocked-index mask over the FULL pool; a filtered array misroutes ten index-keyed consumers.)

**Q (discover: The check runs inside every watch run): The probe job is dispatch-only (watch.yml:26) — scheduled ticks skip it, so a flow parallel to probe never runs on cron. Where does the availability check live?**
A: Every run (inside the watch job), below Gate 1, above the judge stage.

**Q (discover: All accounts down: skip judging, stay green): If the upfront test finds every account refusing, what should the run do?**
A: Skip judging, stay green. (Research resolution: exit 0 persists the episode bit through the existing success-path commit — no YAML change.)

**Q (discover: The test signal: one tiny chat call): What should the upfront test send to each account?**
A: One tiny chat call — near-zero cost, exact "can this account answer now" signal.

**Q (discover: "Down" means any failure): Should an account that answers slowly or with errors also sit out this round?**
A: Yes, any failure — run 42440065433 died with a hung (timeout) account, not only 429s.

**Q (discover: Ceilings stay probe-owned): Should the new check keep using the probe's measured concurrency numbers?**
A: Keep probe ceilings — probe-measured values are committed data per repo doctrine; the check duplicates nothing.

**Q (discover: Truthful exhaustion wording): The exhaustion line counts only failed accounts, not pool size — printed "all 2 LLM_ACCOUNTS" for a 3-account pool. Fix it as part of this work?**
A: Fix it here — message + email copy, pool size threaded from the env pool.

**Q (discover: Mid-run behavior unchanged): Pre-resolved from codebase evidence.**
A: Unchanged — mid-run 429 cooldown (`COOLDOWN_MS` 60s) and dispatch spread stay as-is.

**Q (`src/judge.ts:476-479`: gate efficacy — the pre-check would not have saved run 42440065433; the killer was load throttling. Build the gate, re-scope to a guard, or both?):**
A: Gate now (per the locked FRD — it catches dead keys and dead endpoints), concurrency guard as a separate follow-up research.

**Q (`watch.yml:214` + `src/judge-health.ts:405-417`: how does the green all-down skip persist the episode bit?):**
A: Exit 0 with a green-path flush — the skip branch calls the exhaustion flush and the success-path Commit state step already carries the health file. No YAML change; design must keep pre-check 429s out of the marks merge.

## Related Research
- `.rpiv/artifacts/research/2026-11-07_07-26-22_provider-health-circuit.md` — the health circuit this feature sits beside (episode bit, half-open probe, ledger)
- `.rpiv/artifacts/research/2026-11-06_10-12-16_llm-account-spread-judge.md` — the spread mechanism and its dead-ends

## Open Questions
- **Does a skip run send the heartbeat? — RESOLVED 2026-11-08T13:14:40+0700 (see Follow-up Research below): No — alarm only.** FR5's output list is exhaustive and never names the heartbeat; the heartbeat means "judged and found nothing" (Gate 1/Gate 2), a skip run judged nothing and its email is the alarm; the recovery run's retry semantics keep no match missed.
- **Concurrency-guard follow-up research (new, by developer decision)** — the recorded gate-scope decision defers load-time capacity to a separate research artifact: per-account in-flight throttling from observed 429s/latency, or mid-run width shrink; must re-read `earliestCooldown` semantics (cooldown stamps dominate the flavor split) and the budget-park arithmetic.
- **Openrouter starvation root cause (evidence gap)** — the half-open gate (`src/judge-rotation.ts:184-190`) is the only in-code mechanism producing 1-of-52, but the confirmation requires `git log -p state/judge-health.json` around 2026-11-08 02:50 UTC (committed-at-the-time marks), plus the run log's ceiling-floor warning as the competing-hypothesis check.
- **Skip-run commit message cosmetics** — a green skip run that changed only the health file commits as "state: 0 new seen post ids" via the existing jq-delta subject; acceptable noise unless design special-cases it.


## Follow-up Research 2026-11-08T13:14:40+0700

Developer question before /skill:design: **does an all-down skip run send the heartbeat too, or only the alarm?**

**A: Only the alarm — a skip run sends no heartbeat.**
1. FR5 enumerates the skip run's outputs exhaustively — skip log line, exhaustion alarm, exit 0, posts unseen — and never names the heartbeat.
2. The heartbeat's contract is "the pipeline did its job and found nothing" (Gate 1 `src/index.ts:303-310`, Gate 2). A skip run did not do its job; the alarm is its notification. A "no new matches" heartbeat during an outage would misreport stranded unseen posts as a quiet run.
3. Multi-tick outages stay truthful without it: the alarm fires once per episode (the `outageOpen` bit), each tick logs the skip line, and when the pool recovers the next green run digests everything — "no match may be missed" holds via the retry semantics, not via more email.
4. Mechanically clean: the skip branch returns before any heartbeat call site, so the untested `selectCandidates(recent, [], terms)` path never gets built.

**D1 mechanism amendment (ratification):** D1's intent (rate-limited accounts sit out; only active accounts watch) is unchanged; its Recommended Approach wording "filters the `LlmAccount[]` before `judgePosts`" is superseded by the blocked-index mask (Finding 2) — design implements the mask, never an array filter.

**Citation verification (every corrected range re-read in this session):**
- `tests/index.test.ts`: `judgeFetch` tail :235-243; `partialBulkThenFailFetch` :245-266 (the single-post 500 branch at :264); `recordingTransport` :268-280; partial-persistence test :410-433 (verified correct); budget-death test :435-478 (`isRotationExhausted` :470, `subjects === []` :476, ENOENT :477); provider-health acceptance :710-781 (auths recorded :721, the half-open `auths.length === 1` pin :766, degraded-line render :770-776); the Gate-1 heartbeat degraded-line test starts :783.
- `tests/judge-rotation.test.ts`: budget-drain test :224-255 (sleeps pin `[60_500, 60_500, 59_000]` at :250, failures-length :254); dial-wrap test :534-549 (`dispatchCounter === 3 % 2` at :548); `earliestCooldown` :855-861 (verified correct).
- `tests/judge.test.ts`: the 429-only bare-throw assertions :764-767 (`health === undefined` at :766); the all-health-blocked merge :851-864.
- Unverified second-hand ranges dropped to path-only citations: the judge-rotation drain-throw describe range, `tests/index.test.ts:532` (console.warn mock), `tests/judge-helpers.ts:6-51`, Gate-1 byte-identical :360-385, Gate-1 no-flush :816-835.

**Fixed garbled row:** the `src/index.ts:473` Code References entry was a half-edited sentence; rewritten in place and logged here per the append-only follow-up rule.
