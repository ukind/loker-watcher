---
date: 2026-10-26T14:47:19+0700
author: Yogiswara Utama
commit: 399181b
branch: ukind/fix-hit-limit
repository: fix-hit-limit
topic: "LLM account rotation on rate limit"
tags: [research, judge, config, rotation, rate-limit, email, probe]
status: ready
last_updated: 2026-10-26T14:47:19+0700
last_updated_by: Yogiswara Utama
---

# Research: LLM account rotation on rate limit

## Research Question

Chained from `.rpiv/artifacts/discover/2026-10-26_14-27-50_llm-account-rotation.md`. Replace the single-account judge config (`LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`) with one `LLM_ACCOUNTS` JSON pool; on the first HTTP 429 retry the same call against the next account with no backoff; keep a run-level sticky pointer; when every account is exhausted send one notification email and exit nonzero. What does the current code look like at every seam this touches, and which conventions govern each change?

## Summary

All LLM configuration flows through one resolver: `resolveJudgeConfig` (`src/judge.ts:75`) reads three `ENV_NAMES` entries and returns the three-field `JudgeConfig` (`src/judge.ts:55`). The pool change lands entirely in `src/judge.ts`: the resolver returns an ordered account array (validation modeled on `src/config-file.ts:87-152`), `judgeBatch`'s retry loop splits 429 from 5xx (the single `attempt` variable there serves three roles that must decouple), and `judgePosts` owns the run-level pointer — the same closure-over-shared-state pattern already proven by the `next` batch cursor and the concurrency tests. The exhaustion path is new surface: `judgePosts` never throws today (`src/judge.ts:417`) and `main()` has no branch for a dead pool, so the developer chose a typed error carrying the per-account failure record, caught by the existing handler (`src/index.ts:151-154`), which sends one email through the `sendText` spine (`src/email.ts:84`) and exits 1. The workflow's commit step is success-gated (`watch.yml:65`), so a nonzero exit can never race the state commit. Outside the judge: the probe imports the same parser and probes with account 1, the workflow collapses six secret lines to two, README + two stale docs re-wire, and the test suite replaces its two 429 tests with rotation proofs using the first-ever request-header capture and the first-ever timer faking.

## Detailed Findings

### Config ingestion (Q1)
- `ENV_NAMES` (`src/config.ts:14-22`) is the single name registry; the LLM trio sits at `src/config.ts:17-19`. Replaced by one `llmAccounts: "LLM_ACCOUNTS"` entry.
- `resolveJudgeConfig` (`src/judge.ts:75-96`): trims each read (`:78-80`), aggregates missing names (`:82-85`), throws `judge: missing required environment variables: ...` (`:87-89`), returns with non-null assertions (`:91-95`). Synchronous — `JSON.parse` keeps it sync, so the probe can import it with no async cost.
- Per-account shape already exists under the name `JudgeConfig` (`src/judge.ts:55-59`); every consumer treats it as opaque. Fields are read in exactly six sites: `config.model` at `src/judge.ts:277` and `:363` (payloads), `config.baseUrl` at `:287`/`:370`, `config.apiKey` at `:291`/`:374`.
- Validation precedent: `loadWatcherConfig`/`validateConfig` (`src/config-file.ts:40-84`) does read → JSON.parse (catch preserves the parser message, `:56-59`) → shape rules; `readStringArray`/`readSurfaces` (`src/config-file.ts:87-152`) model the per-item array rules including the empty-array throw (`:104`) — each error names the source and the offending entry/field. The FRD wants errors naming `LLM_ACCOUNTS`.
- `noUncheckedIndexedAccess` makes `accounts[i]` a `T | undefined` access; the in-file idiom is `RETRY_DELAYS_MS[attempt] ?? 0` (`src/judge.ts:302`). `exactOptionalPropertyTypes` requires conditional spread for optional fields (precedent: `stats.runUrl`, `src/index.ts:73-82`).
- Consumers of the config param: `judgeBatch` (`src/judge.ts:269`), `judgePost` (`:358`), `judgePosts` (`:431`), call site `src/index.ts:96`, probe reads (`scripts/probe-judge.ts:168-170`), test fixtures (`tests/judge.test.ts:52-54` env fixture; `tests/judge.test.ts:78-81` and `:203-206` `sampleConfig` literals feeding 16 call sites).

### Retry-loop restructure (Q2)
- Constants: `RETRYABLE_STATUSES` 429+5xx (`src/judge.ts:48`), `RETRY_DELAYS_MS = [1s, 2s, 4s]` (`:50`), budget bound `attempt <= RETRY_DELAYS_MS.length` (`:285`) → 4 attempts max today.
- Payload hoist (`src/judge.ts:276-284`): `messages` are attempt-invariant but `model` (`:277`) is baked in — under per-account models it must move into the loop. Endpoint and auth header are already built inside the loop (`:287`, `:291`).
- The one `attempt` variable serves three roles: delay index (`:302`), budget gate (`:301`), log label (`:304`). A 429-rotate branch that `continue`s without consuming backoff needs a second counter bounded by pool length; 5xx keeps the existing branch (`:301-307`) byte-for-byte.
- 429 branch placement: inside the `if (!response.ok)` block at `:298`, before the shared retryable check at `:301`; it records `{index, status: 429}` (status in scope), advances the pointer, `continue`s with no `sleep`.
- Failure-record capture sites for the exhaustion email: 429 path (`:298-307`), 5xx-spent/non-retryable path (`:309-312` — today these two are indistinguishable at the `:312` return; the record must separate them), transport catch (`:334-342`, only `error.message` available).
- `BatchOutcome` (`src/judge.ts:242-244`) is a bare two-arm union; the `unanswered` arm carries nothing. Widening it (or accumulating records in shared state) is required for the reason to escape `judgeBatch`.
- `judgePost` fallback (`src/judge.ts:356-412`): 2-attempt loop (`:368`), retries on ANY non-OK status (`:380-385`), retries even on transport errors (`:405-408`) — the FRD threads rotation through it without retuning these semantics: a 429 records + advances the pointer before the already-immediate `continue` at `:384`; the attempt bound is untouched.

### Run-level sticky pointer (Q3)
- `judgePosts` (`src/judge.ts:429-481`) is called once per run (`src/index.ts:94-98`); pointer lifetime = the call frame, so per-run reset is free.
- Proven sharing pattern: the batch cursor `let next` (`src/judge.ts:444`) is captured by all four instances of the single `worker` closure (`:445-454`, spawned via `Array.from` at `:455`); its read-advance pair (`:447-448`) has no `await` between read and write — the exact lock-free argument the FRD assumes.
- `config` flows by reference into both call sites (`:452` bulk, `:471` fallback), so a pointer nested in the shared object (or a sibling closure binding) is visible to all workers and to the sequential reassembly loop (`:459-478`) without signature churn.
- Concurrency tests prove a plain shared mutable object is coherent across four workers: peak-4 test (`tests/judge.test.ts:433-447`, `state.peak === 4` at `:444`), min-peak test (`:449-462`), out-of-order resolution (`:464-500` — all four workers construct fetches before any response resolves, so pointer reads/advances belong at the fetch-construction site, not response-handling time).
- The fallback loop runs strictly after `Promise.all` (`:455`) returns — it inherits whatever pointer value the bulk phase left.

### Exhaustion propagation (Q4 — developer chose: throw a typed error)
- Current contract: `judgePosts` never throws (`src/judge.ts:417`); all failure lands in `skippedPostIds` (`:463`, `:475`, return `:480`); `main()` uses it only for stats (`src/index.ts:103`) and logging (`:104-106`), then proceeds to heartbeat/digest/state unconditionally.
- Chosen design: `judgePosts` throws a typed error carrying the per-account `Array<{index, status | errorClass}>` record. The existing catch (`src/index.ts:151-155`) stringifies the error (`:152`) and exits 1 (`:154`); the email send joins that catch (via `resolveEmailConfig`, already imported at `src/index.ts:3`). The `judge.ts:417` doc contract must be updated in the same change.
- Throw consequences (verified): everything after `src/index.ts:94` is bypassed — no heartbeat (`:41-48`, `:108-112`), no digest (`:116`), no `saveState` (`:122-124`) — so unjudged posts stay unseen automatically and `diffNew` redelivers next run. Any verdicts from earlier successful batches are dropped (no partial digest) — consistent with the FRD's "stop the judge stage".
- Commit-back contract: the workflow's Commit state step (`watch.yml:65-77`) has no `if:`, so it runs only when the watcher step succeeds. A nonzero exit skips it entirely; no race, no partial commit.
- "Exactly one email" is guaranteed by the single send site in the catch, not by gating logic.

### Exhaustion email path (Q5)
- Transport spine: `sendText(subject, text, config, transport?)` (`src/email.ts:84-113`) — optional injected `Transporter` is the universal test seam; failures rethrow as `email: failed to send: ...` (`:109-111`).
- Convention: builder + sender co-located in the sender's module — `buildSubject`/`buildDigest` + `sendDigest` (`src/email.ts:54-80`, `:122-153`), `buildHeartbeatSubject`/`buildHeartbeatBody` + `sendHeartbeat` (`src/heartbeat.ts:98-140`, `:148-163`). An exhaustion builder+sender belongs in `src/email.ts` consuming a structural record — no circular import (`email.ts` imports only nodemailer/config/types, `src/email.ts:8-10`; `judge.ts` imports nothing from email).
- `EmailConfig` resolution is lazy at point of send (`src/index.ts:42`, `:116`). In an exhaustion run the exhaustion send is the first email credential resolution, necessarily after `judgePosts`. A failed exhaustion send cannot worsen the exit (already exiting 1) — it only silences the notification; log it visibly.
- Test idioms: injected fake transporter `as unknown as Transporter` (`tests/email.test.ts:197-201`, `:212-216`), boolean no-send flag (`:195-206`), options capture + content assertions (`:210-234`), `assert.rejects` on transport failure (`:258-267`); call counting composes the judge tests' counter idiom (`tests/judge.test.ts:252-254`).

### Probe swap (Q7)
- `scripts/probe-judge.ts` reads the trio in `main()` (`:168-170`), guards with a `probe: missing ...` message + `process.exit(1)` (`:173-175`); usage docstring names the trio (`:18` — inside the acceptance grep).
- Established pattern: import shared validation from `src/` and let it throw loudly (`loadWatcherConfig` at `:17`, `:26`). The probe should import the same pool parser from `src/judge.ts` — a local re-parse would drift from the judge's rules and escape the acceptance test.
- Model travel: `timed` (`:87`) takes no model — the model rides inside payloads built in `main()` (`:181`, `:191`). Minimal swap: destructure `accounts[0]` in `main()`; `baseUrl`/`apiKey` thread the four existing call sites (`:185-186`, `:199-200`, `:205-206`, `:209`); `timed`/`rampLevel`/`findConcurrencyCeiling` signatures stay byte-identical.
- ProbeOutcome already classifies `refused` with its HTTP status (`:101-104`), but `rampLevel`'s aggregation (`:131-136`) discards statuses — relevant only to the FRD's not-requested per-account 429 ramp follow-up.

### Wiring and docs swap (Q8)
- Workflow: two env blocks — probe job `watch.yml:32-34`, watch job `watch.yml:58-60` — each collapse to one `LLM_ACCOUNTS` line. Acceptance grep path set: `src/ scripts/ .github/`.
- README (grep-blind but FRD-mandated): Requirements bullet `README.md:40`, secrets table rows `README.md:49-51`, local-run export `README.md:210`. Also turns stale at the swap: the pipeline sentence "A batch the endpoint does not answer is deferred whole" (`README.md:19-24`) and the smoke-run outcome list (`README.md:88-99`, no exhaustion-run shape).
- Stale outside the grep — developer chose: fix now — `.claude/skills/validate-e2e/SKILL.md:13` (instructs passing the three dead variables; the documented procedure breaks at the swap) and `AGENTS.md:18`, `AGENTS.md:21` ("LLM_*" wildcard form, invisible to the literal grep).
- Historical records under `.rpiv/artifacts/` keep the old names by design (immutable history, excluded from the swap).

### Test surface (Q6)
- Rewrites: the resolver block (`tests/judge.test.ts:49-66` — env fixture `:52-54`, throw regex `:65`) becomes valid-JSON-array / missing-blank / malformed / empty-array, each naming `LLM_ACCOUNTS`. The two 429 tests (`:502-522` 3-call backoff success, `:524-544` 4-call budget-spent defer) encode the replaced semantics and become the rotation proofs.
- New assertions need the first-ever request-header capture: no test reads `options.headers` today; the idiom to extend is `measuredFetch`'s options cast (`tests/judge.test.ts:234-248`, body parse at `:240-242`). The `Authorization` values are built at `src/judge.ts:291`/`:374`.
- Sticky-pointer proof: two-batch idiom exists ("chunks fifteen posts into two bulk calls", `tests/judge.test.ts:273-290`); batch 2's first recorded call must carry account 2's key.
- 5xx-keeps-backoff proof — developer chose: fake timers. `sleep` (`src/judge.ts:53`) is module-local but its comment (`:52`) anticipates timer faking; no test uses `mock.timers` yet (only two plain `setTimeout` uses: `tests/judge.test.ts:238`, `:476`). node:test `mock.timers` intercepts the global timer, so no production change is needed for it.
- Nonzero-exit half of the exhaustion test: no `tests/index.test.ts` exists; at judge level the observable is the typed throw (`assert.throws` convention, `tests/judge.test.ts:65`) carrying the record; the email+exit glue in the catch is exercised by email-level tests of the new sender plus the throw assertion.
- Known sharp edge to pin: rotation must not let unjudged posts enter state (D3 invariant, load-bearing across the whole retry-semantics chain).

## Code References
- `src/judge.ts:45` — `JUDGE_CONCURRENCY = 4` worker pool size
- `src/judge.ts:48-53` — `RETRYABLE_STATUSES`, `RETRY_DELAYS_MS`, `sleep`
- `src/judge.ts:55-59` — `JudgeConfig` (per-account shape: baseUrl/apiKey/model)
- `src/judge.ts:66-69` — `JudgeBatchResult` (judged + skippedPostIds)
- `src/judge.ts:75-96` — `resolveJudgeConfig` (single-account env resolution)
- `src/judge.ts:137-141` — `normalizeEndpoint` (base URL → /chat/completions)
- `src/judge.ts:242-244` — `BatchOutcome` union (answered | unanswered)
- `src/judge.ts:267-347` — `judgeBatch` (payload hoist `:276-284`, loop `:285`, fetch `:287-295`, retry branch `:301-307`, defer `:312`, catch `:334-342`)
- `src/judge.ts:356-412` — `judgePost` (2-attempt fallback, status-agnostic retry `:380-385`)
- `src/judge.ts:417` — "Never throws" doc contract (changes under the throw design)
- `src/judge.ts:429-481` — `judgePosts` (batching, `next` cursor `:444`, worker `:445-454`, join `:455`, reassembly `:459-478`)
- `src/config.ts:14-22` — `ENV_NAMES` registry (trio at `:17-19`)
- `src/config-file.ts:40-152` — fail-visible file validation precedent (parse `:56-59`, per-item rules `:87-152`)
- `src/email.ts:12-16` — `EmailConfig`; `:29-48` `resolveEmailConfig`
- `src/email.ts:54-80` — `buildSubject`/`buildDigest` null-gating builders
- `src/email.ts:84-113` — `sendText` shared transport (injected-Transporter seam)
- `src/email.ts:122-153` — `sendDigest` (builder+sender pattern to mirror)
- `src/heartbeat.ts:98-163` — heartbeat builders + `sendHeartbeat` (second reuse precedent)
- `src/index.ts:94-98` — judge call site (`resolveJudgeConfig` at `:96`)
- `src/index.ts:103-106` — skipped stats (no gating today)
- `src/index.ts:116` — digest send; `:122-124` state save (email-before-state ordering)
- `src/index.ts:151-155` — `main().catch` → exit 1 (exhaustion email send site under the throw design)
- `scripts/probe-judge.ts:17-26` — src imports + loud top-level `loadWatcherConfig`
- `scripts/probe-judge.ts:87` /`:121` /`:145` — `timed` /`rampLevel` /`findConcurrencyCeiling` (signatures stay)
- `scripts/probe-judge.ts:167-176` — trio env read + exit-1 guard; `:18` docstring (grep target)
- `.github/workflows/watch.yml:32-34` — probe job env (collapse to one line)
- `.github/workflows/watch.yml:58-60` — watch job env (collapse to one line)
- `.github/workflows/watch.yml:65-77` — success-gated Commit state step
- `README.md:40` /`:49-51` /`:210` — Requirements bullet, secrets table, local-run export
- `README.md:19-24` /`:88-99` — pipeline defer sentence and smoke-run list (turn stale)
- `.claude/skills/validate-e2e/SKILL.md:13` — stale e2e credential instruction (fix now)
- `AGENTS.md:18`, `AGENTS.md:21` — "LLM_*" wildcard mentions (fix now)
- `tests/judge.test.ts:49-66` — resolver block (rewrite)
- `tests/judge.test.ts:78-81` /`:203-206` — `sampleConfig` fixtures (become per-account entries)
- `tests/judge.test.ts:234-248` — `measuredFetch` (extend for header capture)
- `tests/judge.test.ts:273-290` — two-bulk-call idiom (sticky-pointer proof base)
- `tests/judge.test.ts:433-500` — concurrency peak + out-of-order tests (shared-state proof)
- `tests/judge.test.ts:502-544` — the two 429 tests (replace)
- `tests/email.test.ts:195-234` — fake-transporter counting/capture idioms

## Integration Points

### Inbound References
- `src/index.ts:18` /`:94-98` — pipeline imports and calls `judgePosts` + `resolveJudgeConfig` (untyped passthrough; type change is invisible here)
- `scripts/probe-judge.ts:17-19` — probe imports `loadWatcherConfig`/`ENV_NAMES`; gains the judge parser import
- `.github/workflows/watch.yml:32-34` /`:58-60` — both runtime secret feeds for the whole LLM stage
- `tests/judge.test.ts:4-10` — suite imports `JudgeConfig` type and `resolveJudgeConfig`

### Outbound Dependencies
- `src/judge.ts:24` — imports `ENV_NAMES` from `./config.js` (only coupling outside types)
- `src/judge.ts:25` — imports `JudgeVerdict`/`Post` from `./types.js`; no email import exists (keeps layering clean)
- `src/email.ts:8-10` — email imports only nodemailer/`ENV_NAMES`/`Post`; an exhaustion builder consumes a structural record, no judge import
- `src/index.ts:3` — `resolveEmailConfig` already imported (available to the catch)

### Infrastructure Wiring
- `.github/workflows/watch.yml:63` — `npx tsx src/index.ts` is the sole production entry; `:35` the probe entry
- `.github/workflows/watch.yml:65-77` — state commit-back, success-gated (exhaustion-safe)
- `ENV_NAMES` (`src/config.ts:14-22`) — every env name registry; `llmAccounts` replaces the trio in place

## Architecture Insights
- Single source of truth for names (`ENV_NAMES`), shapes (`JudgeConfig`), validation (`config-file.ts` idiom), transport (`sendText`), and test seams (injected fetch/Transporter) — every new piece extends an existing single-source pattern rather than adding a parallel one.
- Failure absorption is deliberate (`BatchOutcome`, `skippedPostIds`, "never throws") so a bad endpoint cannot kill digest/state; the exhaustion throw is the first deliberate break of that contract and must update the `src/judge.ts:417` doc in the same change.
- The lock-free concurrency argument is executable in the repo: `next` read-advance (`src/judge.ts:447-448`) plus the peak/out-of-order tests. A rotation pointer is a second instance of the same proven pattern; pointer reads belong at fetch-construction, not response-handling.
- Email ordering invariant (D8): email before state (`src/index.ts:116` before `:122-124`); the catch-based exhaustion path preserves it structurally by skipping both.
- Log-line conventions carry meaning: `judge:`, `probe:`, `email:`, `watch: FAILED —` prefixes; keep the probe's controlled exit shape if it wants to preserve its prefix, or let the parser throw at top level like `loadWatcherConfig` (`scripts/probe-judge.ts:26`) — either satisfies the FRD.

## Precedents & Lessons
4 similar past changes analyzed (plus a 4-commit retry-semantics chain).

### Precedent: judge stage with single-account env config + bulk retry semantics
**Commit(s)**: `1a9e353` — "feat: threads #hiring indonesia job alert pipeline (v1)" (2026-10-25); `e316cb5` — "feat: judge posts against configured keywords in bulk" (2026-10-26)
**Blast radius**: 11 files across domain/service/tests/docs layers
  src/judge.ts, src/index.ts, src/types.ts, src/heartbeat.ts, tests/judge.test.ts, AGENTS.md, README.md

**Follow-up fixes**:
- `fda50c2` — "fix: defer unanswered judge batches, raise the request timeout" (2026-10-26) — run 40264368939 died at a 15s timeout; one batch timeout cascaded into 20 doomed calls, burning 6.5 of 10 minutes
- `73d6786` — "feat: probe judge latency and raise the watch job budget" (2026-10-26) — `timeout-minutes: 10` was the binding constraint, explicitly out of scope of the earlier plan
- `1d4faed` — "feat: parallelize the judge with a bounded worker pool" (2026-10-26) — added the worker pool + same-key 429/5xx backoff this change now replaces
- `5f6a328` — "feat: ramp concurrent calls in the judge probe" (2026-10-26) — the probe had under-measured production latency 5.2x

**Lessons from docs**:
- .rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md — the judge stage was never load-tested; removing a pre-filter sent the whole backlog at it
- Same plan — Z.AI adjusts rate limits dynamically; the 429 backoff is the safety net for a stale concurrency value
- .rpiv/artifacts/validation/2026-10-26_11-01-22_model-judged-keywords.md — recorded follow-up: validate the resolved base URL and fail naming the variable (directly applicable to `LLM_ACCOUNTS` parsing)
- .rpiv/artifacts/discover/2026-10-25_21-20-20_model-judged-keywords.md — that FRD's non-goals (no concurrency, backlog well inside the job limit, 15s timeout) were all falsified within one day

**Takeaway**: retry-scope non-goals became the next three emergency commits — validate timeout/latency assumptions from the GitHub runner, and keep the workflow `timeout-minutes` in scope.

### Precedent: env/secret wiring swap in config + workflow
**Commit(s)**: `b050436` — "feat: json config as source of truth with url surfaces" (2026-10-25); `9e1c8ef` — "feat: authenticated threads fetch with recency cutoff" (2026-10-25)
**Blast radius**: 12 files each (config shrink + new validated loader + watch.yml env rewiring + test suites)
**Follow-up fixes**: none — the fail-visible pattern held.
**Takeaway**: a failed probe is the canary for a broken secret swap; swap every consumer atomically (the FRD's own probe rationale).

### Composite Lessons
- Transport failures cascade — never retry into a dying endpoint (`fda50c2`); keep "transport error defers without rotating" when adding 429 rotation
- Env-config errors must name the variable, and every consumer must swap atomically (`b050436`, `9e1c8ef`, validation doc); a partial swap turns the probe step red first
- Volume/latency assumptions broke every time they were untested from the runner (runs 40264368939, 40268599609, probe 5.2x) — the FRD's dead-account-1 dry run is load-bearing, do not skip it
- This is the fourth judge-stage change in two days on the same retry chain (`e316cb5` → `fda50c2` → `1d4faed` → this branch); the D3 invariant (unjudged posts stay unseen) is load-bearing across all four — new tests must pin that rotation preserves it
- FRD-cited line anchors drifted a few lines on this branch; agents re-verified every anchor against the working tree — downstream stages should re-verify rather than trust artifact-internal line numbers

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-10-26_14-27-50_llm-account-rotation.md` — this feature's FRD (all decisions resolved)
- `.rpiv/artifacts/discover/2026-10-25_21-20-20_model-judged-keywords.md` — prior FRD for the judge stage
- `.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md` — original pipeline design (references old env names as history)
- `.rpiv/artifacts/designs/2026-10-26_06-51-45_model-judged-keywords.md` — judge-stage design
- `.rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md` — original implementation plan
- `.rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md` — judge implementation plan (load-testing lessons)
- `.rpiv/artifacts/research/2026-10-24_14-30-29_threads-hiring-alerts.md` — original research
- `.rpiv/artifacts/validation/2026-10-26_11-01-22_model-judged-keywords.md` — judge validation (base-URL error-message follow-up)
- `.rpiv/artifacts/validation/2026-10-26_12-07-47_model-judged-keywords.md` — judge validation, second pass

## Developer Context
**Q (discover: Rotation trigger — first 429): The code already retries 429 (plus 5xx) with backoff on the same key — what makes the run switch accounts?**
A: First 429 rotates — the failing call is immediately retried against the next account, no backoff wait. 5xx keeps the existing backoff on the current account; transport errors still defer immediately.

**Q (discover: All accounts exhausted): When ALL accounts are exhausted, keep defer-and-retry?**
A: Fail the run AND send one notification email listing every account's error and HTTP code.

**Q (discover: Account configuration): How should the backup accounts be added?**
A: One JSON secret `LLM_ACCOUNTS`, array of `{baseUrl, apiKey, model}` in rotation order, validated fail-visible at startup; the old three variables are removed entirely.

**Q (discover: Rotation stickiness): After a failover to account 2, where does the next call in the same run start?**
A: Stay on account 2 — run-level sticky pointer; account 1 returns on the next scheduled run.

**Q (discover: Log lines name the account): Should judge log lines say which account they used or failed on?**
A: Name the account (for example "account 2 HTTP 429").

**Q (discover: Probe script follows the config swap): Update scripts/probe-judge.ts in this change?**
A: Update probe to read `LLM_ACCOUNTS` and probe with account 1.

**Q (`src/judge.ts:417`): judgePosts never throws today — how should "every account exhausted" reach the email + nonzero exit?**
A: Crash with a list — judgePosts throws a typed error carrying the per-account failure record; the existing catch (`src/index.ts:151-154`) sends the one exhaustion email via the new `src/email.ts` sender and exits 1. The never-throws doc contract is updated in the same change.

**Q (`tests/judge.test.ts:502-544`): the 5xx-keeps-backoff test would pay real 1s/2s/4s delays — fake or real?**
A: Pretend to wait — node:test `mock.timers` for the 5xx backoff test (first use in the suite; `sleep`'s comment at `src/judge.ts:52` anticipates it).

**Q (`.claude/skills/validate-e2e/SKILL.md:13`): two stale docs sit outside the acceptance grep — fix now or follow-up?**
A: Fix them now — `.claude/skills/validate-e2e/SKILL.md:13` and `AGENTS.md:18`, `AGENTS.md:21` join the swap (same rationale the FRD used for the probe).

## Related Research
- `.rpiv/artifacts/research/2026-10-24_14-30-29_threads-hiring-alerts.md` — original pipeline research

## Open Questions
None — every branch resolved during the interview and the checkpoint.
