---
date: 2026-11-07T07:26:22+0700
author: Yogiswara Utama
commit: c647e0f
branch: main
repository: loker-watcher
topic: "Provider health circuit: remember dead LLM accounts across ticks, unify failure alarms, de-duplicate outage emails"
tags: [research, codebase, judge, judge-rotation, judge-ceilings, email, heartbeat, watch-workflow, commit-state-rebase, reliability]
status: ready
last_updated: 2026-11-07T08:03:28+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Checkpoint decisions 4-7 recorded (probe-success semantics, staleness policy, pool hoist, alarm env seam); Open Questions closed"
---

# Research: Provider health circuit — dead-account memory, unified alarms, episode-deduped emails

## Research Question

Add a provider-health circuit to the LLM judge pool: per-account health marks persist across 10-minute ticks in a new committed state file, an account that hard-fails (server/network errors, not 429s) in 2 consecutive runs gets its ceiling capped at 1 (half-open circuit: one real request per tick proves recovery), failure alarms carry each account's real cause instead of a hardcoded "HTTP 429", all-dead pools always alarm (429 and 503 flavors unified), outage emails fire once per episode instead of every tick, and digest/heartbeat emails carry one degraded-accounts line. Motivated by run 42315079264: nube-api 503s every request and openrouter 429s every request, and nothing about that is remembered between ticks.

## Summary

The feature is unimplemented — no `judge-health` artifact exists anywhere, and `state/` holds exactly `seen-posts.json`, `judge-ceilings.json`, `linkedin-posts.json`. Every piece of machinery the FRD needs already exists in a neighboring form, and the work is composition, not invention: a never-throwing committed-state reader + atomic writer + pure resolver (`src/judge-ceilings.ts`), a per-account outcome ledger that today does not exist (`RotationState` at `src/judge-rotation.ts:54` carries only cooldowns/ceilings/in-flight/dial/waiters/budget), an exhaustion terminal whose record builder hardcodes `reason: "HTTP 429"` (`src/judge-rotation.ts:247`), an episode-marker edge detector (`scripts/fetch-linkedin.ts:123`), and a two-file commit-back skip-set (`scripts/commit-state-rebase.sh:59`).

Three findings changed the FRD's shape and are now settled decisions:

1. **The FRD's episode marker cannot reach `main` on the run that sets it.** The Commit state step (`.github/workflows/watch.yml:157-176`) has no `if:` condition, so it is skipped when the run exits 1 on exhaustion (`src/index.ts:398-406`). Decision: a new `Commit health` step with `if: always() && failure()`, `-f`-guarded add of only the health file, same rebase script; the existing Commit state step grows its file set for the success path.
2. **A ceiling of 1 caps concurrency, not per-tick count.** `pickEligibleAccount` (`src/judge-rotation.ts:121-140`) admits an account whenever `inFlight` is 0 (`:134-135`) and nothing stops re-picks after the dial wraps. Decision: a per-tick probe ledger (`probedThisTick: Set<number>`) on `RotationState`, consulted by the pick — it resets naturally because state lives per `judgePosts` call, which is per tick.
3. **An all-health-dead pool hangs instead of alarming.** With no active cooldown, the flavor split (`src/judge.ts:391-397`) falls into `waitCeilingSlot` (`:396`), whose promise resolves only on `releaseAccount` or a fresh 429 stamp — neither ever fires when nothing is dispatchable. Decision: a third arm, `else if (allHealthBlocked(state)) return { status: "exhausted" }`, tripping immediately at zero park cost.

Also confirmed: a 503-only pool exits 0 silently today (5xx defers the batch whole, `src/judge.ts:447`, no throw site fires), 401/403 have zero alarm representation, and the degraded line must load above Gate 1 (`src/index.ts:257`) because the heartbeat fires on runs where the judge stage never executes.

## Detailed Findings

### The judge dispatch core — where per-account outcomes must be recorded

`dispatchLlmCall` (`src/judge.ts:343-504`) is the shared retry loop behind both wrappers. Every HTTP/transport classification happens here, per attempt, after `claimAccount` (`:407`):

- **429** (`:421-430`): `coolAccount` + `warns.cooling` + `{ action: "rewind" }` — the rewind does not spend an attempt. Per FRD this is the non-countable flavor.
- **5xx** (`:433-441`): `RETRYABLE_STATUSES = {500,502,503,504}` (`:84`) with same-account backoff `[1s,2s,4s]` (`:85-86`), seat pinned via `pinnedStart` (`:498`). Terminal 5xx falls through to `:443-447` — `warns.statusFailure` then `defer` (batch) or `retry` (post).
- **Transport error** (`:466-472`): message extracted at `:470`, `warns.transportError` at `:471`, `defer` (batch) or `retry` (post). The only seam holding the raw transport message string.
- **Content-parse failures**: wrapper `onContent` only — batch parse miss resolves with an empty Map (`:594`), post parse miss retries. Confirmed non-health boundary; a model failure must not mark an account.

The `DispatchOutcome` union (`:280-286`) carries no account identity, and the wrappers receive none — one call can traverse several accounts (a 429 rewind re-picks from the moved dial; a post-ladder retry after `:447`/`:472` re-picks past the failed account because `claimAccount` advanced `dispatchCounter`). **The stamp must therefore live in the core**, at the four branch sites, where `attemptIndex` and `response.status`/`error.message` are simultaneously in scope. The warn handlers are the wrong seam: they fire per attempt, not per terminal outcome, and the D2 doctrine keeps their strings wrapper-owned (`src/judge.ts:309-317`).

"Received dispatches and every one failed" must be tallied **per attempt, not per call**: a whole-batch defer decomposes into per-attempt observations (pinned account × 3 countable 5xx + terminal account × 1), and a post ladder split across two accounts gives both accounts a countable tally. A success clears: the `answered` directive is acted on at `:481-483`, after the finally released the slot (`:473-477`) but with `attemptIndex` still in scope.

### The exhaustion terminal — hardcoded reason, silent 503, invisible 401

`failuresFromCooldowns` (`src/judge-rotation.ts:243-251`) walks pool order and includes an account on **map-key existence** (`:246`, deliberately not freshness-filtered — the doc at `:233-242` warns a freshness filter could empty the record and revive the email-silent path), pushing `reason: "HTTP 429"` hardcoded at `:247`. Its three consumers are the throw sites: `src/judge.ts:688` (judgePost), `:786` (bulk join), `:864` (fallback join). The single catch is `src/index.ts:398-406` → `sendExhaustionEmail` (`src/email.ts:203`) → `process.exit(1)`.

A 503-only pool never reaches any of them: the batch backs off three times, defers at `:447`, `judgeBatch` maps to `unanswered`, the reassembly walk skips the batch (`src/judge.ts:801-808`), `fallbackWork` stays empty (only answered batches queue fallback), `judgePosts` returns normally, and the run exits 0. The same silence covers transport-dead pools and post-phase failures. 401/403 land at `:443-447` as warn lines only — never a cooldown, never an `AccountFailure`, never an email.

Reason strings are all derivable at the core stamp site: `"HTTP " + status` (covers 503 and 429), a `"network error"` prefix plus the free-form transport message, and `"HTTP 401 — key dead"` / `"HTTP 403 — key dead"` where the suffix is a core-side classification. `AccountFailure.reason` is free-form (`src/types.ts:34-41`) and rendered verbatim at `src/email.ts:185` and embedded in the Error message (`src/judge-rotation.ts:91-94`), so stamping the finished string at the core keeps the builder a pure renderer.

### The ceilings merge seam and the all-dead hang

`src/index.ts:275` resolves ceilings and passes them into `judgePosts` (`:276`); the one parameter feeds both the pool width `Math.max(1, Σ ceilings)` (`src/judge.ts:756`) and the pick's at-ceiling gate (`src/judge-rotation.ts:134-135`). Merging `min(committed, healthCap)` at `src/index.ts:275` keeps both consumers coherent with no second width computation, keeps `judgePosts` pure, and matches the existing resolver family (`deps.judgeCeilings` at `src/index.ts:112-117`, `linkedinFetch` at `:119`). In-run deaths still need live consultation by the pick, because `ceilings` is typed `ReadonlyMap` (`src/judge-rotation.ts:61`) and its doctrine forbids run-time writes ("Read-only here — writing the file is the probe's job, the run only enforces").

Ceiling 0 is unrepresentable — `usableCeiling` rejects it (`src/judge-ceilings.ts:29-33`), the resolver floors to 1 (`:66-71`), the pick floors `?? 1` (`src/judge-rotation.ts:134`) — so "no traffic at all" cannot ride the ceilings map; hard-dead skipping must be a separate pick predicate (the per-tick probe ledger).

### The episode-marker precedent and the hosted-runner asymmetry

`scripts/fetch-linkedin.ts` owns the complete edge precedent: `DEFAULT_MARKER` (`:107`, a repo-local flag beside the payload, untracked by design — its doc-comment records that OS temp was rejected 2026-11-04 because a reboot erased the episode and re-alarmed a still-dead leg), `handleLegDeadEpisode` (`:123-147`: marker-exists → warn-only; else write marker + alarm, best-effort), `clearEpisodeMarker` (`:149-156`, called from exactly one site, `fetchTick:278`, after a successful payload write + push). Its test suite pins the four edge cases offline (`tests/fetch-linkedin.test.ts:492-549`).

The watch job has no persistent filesystem: `actions/checkout@v4` gives each run a fresh workspace, so **the only cross-tick persistence the watch job has is the commit-back**. That is why the FRD's in-file marker needs the failure-path commit step (decision 1) and why an untracked marker cannot work on the hosted runner at all.

### The degraded line — placement above Gate 1

The rider pattern is `LegLine`: built in `src/index.ts` (`:204-211`), threaded as a trailing optional param to `sendDigest` (`:323`), rendered only-when-not-ok in `buildDigest` (`src/email.ts:85-90`); the heartbeat carries it via `HeartbeatStats.linkedinLeg` (`src/heartbeat.ts:48`, attached via the `exactOptionalPropertyTypes`-safe spread at `src/index.ts:249`) rendered as one conditional funnel line (`src/heartbeat.ts:142`) built by the pure `linkedinLegLine` (`:118-124`).

FR8 requires the line on **every** digest/heartbeat while any account is capped — including Gate 1 heartbeats (`src/index.ts:257-266`), whose marks come from previous ticks. So the health load and capped-set resolution must happen above Gate 1, at the `runUrlFromEnv` site (`src/index.ts:238`), before `stats` construction (`:240-251`). `resolveJudgeConfig(env)` must hoist with it (currently judge-stage-local at `:270`) because the line needs pool size and stable indexing; that moves a malformed-`LLM_ACCOUNTS` failure earlier in the run, which is a deliberate trade to record. Gate 1 must only *read* marks — zero dispatches cannot clear them (FR7: an episode ends only on a run with ≥1 healthy dispatch).

### The committed-state plumbing — two files to three

The watch job's Commit state step (`watch.yml:157-176`) unconditionally adds `state/seen-posts.json` (`:167`), guards on `git diff --cached --quiet` (`:168`), and builds a jq delta message from `seenPostIds` lengths (`:172-174`; the `|| echo 0` covers the file's first-ever commit). The probe's Commit ceilings step (`:58-77`) is the same head with a `-f` guard (`:69-71` — "covers a probe that died before its write") and no delta (whole-file write, fixed message). The skip-set is `case` membership at `scripts/commit-state-rebase.sh:58-60` (`"" | state/seen-posts.json | state/judge-ceilings.json` → skip; anything else → abort loudly, `:65-69`), bounded by 50 skips (`:49`), with the growth ledger in the header (`:13`, `:30-32`). A commit touching both state files that conflicts on either is skipped whole — the accepted F021 cost, now with two chances to trigger per commit.

The health add needs its own `-f` guard for three reasons: Gate 1 returns before the judge stage (`src/index.ts:257-266`) so most zero-candidate ticks write nothing; the writer should be gated on semantic change (the `saveState` doctrine, `src/state.ts:237-254` — a gated write keeps the file byte-identical on no-op runs, which is what stops every tick minting a commit); and the file does not exist in any checkout until the first live run commits it (the ceilings file materialized the same way, `3fe892e`) — an unconditional `git add` of an absent path is fatal under the step's implicit `bash -e`. A health-only change must still commit (the no-op guard is index-wide, so staging is everything — if only seen-posts is staged, a health-only delta stages nothing and the step exits 0 with the marks never persisted), and the jq delta degrades to a truthful-but-misleading `state: 0 new seen post ids` — the ceilings precedent (fixed message, no delta) is the shape to copy. The probe stays health-free structurally: it imports nothing health-related (`scripts/probe-judge.ts:7-11`, `:41`) and stages exactly one path (`:273`); the shared skip-set membership is evaluated only over actually conflicted paths, so the probe inherits the extra literal harmlessly.

### Test seams

Every cross-tick file in the repo has the same four offline seams: a lazy per-suite `mkdtemp` dir cleaned in one `after()` (`tests/judge-ceilings.test.ts:109-117` idiom), an injected `filePath` defaulting to the module constant (`src/judge-ceilings.ts:86, 124` — the unit-testability contract), an injected clock, and an injected transport/alarm double (`FetchTickDeps.alarm`/`markerPath`, `scripts/fetch-linkedin.ts:90-96`). The acceptance scenario composes from existing pieces: sequential `judgePosts` invocations sharing one temp-dir health file (each builds a fresh `RotationState` at `src/judge.ts:735-744`, so the file is the only carrier), a per-host counting fetch stub branching on URL (`tests/judge-rotation.test.ts:72-90` idiom, counts via `auths.filter(a => a.includes("key-i")).length`), and a hand-stepped tick clock (`:230-243` idiom). The "2 consecutive failed ticks" counter needs no clock — it survives on consecutive-run semantics alone, exactly as the ceilings file deliberately carries no timestamp (`src/config.ts:63-72`). A perma-503 stub needs the inert `sleepFn` recorder (the 5xx suite's `:433-467` shape) because the backoff sleeps are otherwise real time.

The all-429 compatibility pin is `tests/index.test.ts:428-475` (`all429` stub at `:440`, budget-death assertions `:461-468`, subjects-empty + state-ENOENT at `:469-471`). The rotation suite's exhaustion assertions are field-mapped, not deep-equal (`tests/judge-rotation.test.ts:200, 522`), so added optional `AccountFailure` fields break nothing; the byte-level pins live in `tests/email.test.ts:371-395` (`buildExhaustionText` fixtures construct literals — a new required field breaks compilation there until the fixtures grow). `failuresFromCooldowns` must stay non-empty at every throw site or the empty-record null at `src/email.ts:181-182` silently suppresses the email while exit 1 still happens.

## Code References

- `src/judge.ts:84-86` — `RETRYABLE_STATUSES` {500,502,503,504} and `RETRY_DELAYS_MS` [1s,2s,4s]
- `src/judge.ts:105` — `WAIT_BUDGET_MS = 180_000`
- `src/judge.ts:280-286` — `DispatchOutcome` union (account-blind)
- `src/judge.ts:309-317` — `DispatchWarns` (D2: strings wrapper-owned, core owns only WHEN)
- `src/judge.ts:343-504` — `dispatchLlmCall`: the shared retry loop; stamp seams at `:422` (429), `:433-447` (5xx + terminal `:443-447`), `:466-472` (transport)
- `src/judge.ts:381` — the per-attempt pick (`pickEligibleAccount` at the loop top)
- `src/judge.ts:391-397` — the undefined-pick flavor split; `:396` is the unbounded-hang arm
- `src/judge.ts:407` — `claimAccount` in the same sync window as the pick
- `src/judge.ts:443, 471` — `statusFailure`/`transportError` warn sites (the only places status/message + account index coexist)
- `src/judge.ts:473-477, 481-483` — the release finally and the `answered` directive acted on (success-clear site)
- `src/judge.ts:498` — `pinnedStart = attemptIndex` (same-account 5xx seat)
- `src/judge.ts:557` — batch `maxAttempts = RETRY_DELAYS_MS.length + 1`; `src/judge.ts:650` — post `maxAttempts: 2`
- `src/judge.ts:594` — batch parse miss resolves an empty Map (non-health boundary)
- `src/judge.ts:628` — `judgePost`; `:688` its exhaustion throw
- `src/judge.ts:725-744` — `judgePosts` + `RotationState` construction (per-tick lifetime)
- `src/judge.ts:756-759` — pool width `Math.max(1, Σ ceilings)`
- `src/judge.ts:786, 864` — the bulk-join and fallback-join exhaustion throws
- `src/judge.ts:801-808` — reassembly walk skips unanswered batches (the silent-503 path)
- `src/judge-rotation.ts:36, 43` — `COOLDOWN_MS = 60_000`, `WAKE_JITTER_MS = 500`
- `src/judge-rotation.ts:54-77` — `RotationState` fields
- `src/judge-rotation.ts:121-140` — `pickEligibleAccount`; ceiling gate at `:134-135`
- `src/judge-rotation.ts:147-157` — `coolAccount` (first-write-wins, wakes ceiling waiters)
- `src/judge-rotation.ts:177-187` — `claimAccount` (dial advances past the claimed account)
- `src/judge-rotation.ts:190-196` — `releaseAccount`
- `src/judge-rotation.ts:208-217` — `waitCeilingSlot` (zero budget charge, release-only wake)
- `src/judge-rotation.ts:222-232` — `earliestCooldown`
- `src/judge-rotation.ts:233-251` — `failuresFromCooldowns` doc + body; hardcoded reason at `:247`
- `src/judge-rotation.ts:267-296` — `parkUntilEligible` (charge-before-sleep, false when spent)
- `src/judge-ceilings.ts:29-33, 50-80, 85-114, 122-143` — the module template: `usableCeiling`, `resolveCeilings`, `loadAccountCeilings`, `writeCeilingsAtomic`
- `src/state.ts:196-203` — `stateTempPath` (unique sibling temp, never os.tmpdir)
- `src/state.ts:237-254` — `saveState`'s semantic-change gate (byte-stability doctrine)
- `src/linkedin-payload.ts:28-38, 84-107, 151-165` — `PAYLOAD_VERSION`/`PAYLOAD_MAX_AGE_MS`/`PayloadEnvelope`, `writePayloadAtomic`, the version+staleness checks
- `src/config.ts:52, 61, 74` — `STATE_PATH`, `LINKEDIN_PAYLOAD_PATH`, `JUDGE_CEILINGS_PATH`; single-writer doc-comment at `:63-72`
- `src/index.ts:112-119` — the `judgeCeilings` / `linkedinFetch` resolver seams
- `src/index.ts:238-251` — `runUrlFromEnv` (`:238`) + `stats` construction (`:240-251`) — the degraded-line load point
- `src/index.ts:257-266` — Gate 1 (returns before the judge stage)
- `src/index.ts:270, 275-285` — `resolveJudgeConfig`, the ceilings resolve, the `judgePosts` call (the merge seam)
- `src/index.ts:323` — `sendDigest` with the leg rider
- `src/index.ts:398-406` — the exhaustion catch: best-effort alarm (reads `process.env` at `:401`) + `process.exit(1)`
- `src/email.ts:75-95` — `buildDigest` + the only-when-not-ok leg line (`:85-90`)
- `src/email.ts:181-197` — `buildExhaustionText`; reason rendered verbatim at `:185`; empty list → null at `:181-182`
- `src/email.ts:203-217` — `sendExhaustionEmail`
- `src/heartbeat.ts:48, 118-124, 142` — `HeartbeatStats.linkedinLeg`, `linkedinLegLine`, the funnel line
- `src/types.ts:34-41` — `AccountFailure` (free-form `reason`)
- `scripts/fetch-linkedin.ts:107, 123-147, 149-156, 278` — the episode-marker precedent end to end
- `scripts/commit-state-rebase.sh:13, 30-32, 49, 58-60, 65-69` — header file list, growth ledger, 50-skip bound, the skip-set case, the loud abort
- `scripts/probe-judge.ts:190, 273` — `classifyDead` (ignores 503) and the live-only ceilings write
- `.github/workflows/watch.yml:58-77, 80-81, 157-176` — Commit ceilings (`-f` guard at `:69-71`), the job gate, Commit state (no `if:`)
- `tests/judge-rotation.test.ts:72-90, 200, 230-243, 522` — counting stub, `reason === "HTTP 429"` pins, tick clock idiom
- `tests/index.test.ts:428-475` — the all-429 budget-death compatibility pin
- `tests/email.test.ts:371-395` — `buildExhaustionText` byte-level fixtures
- `tests/fetch-linkedin.test.ts:492-549` — the one-alarm-per-episode suite

## Integration Points

### Inbound References

- `src/index.ts:275` — `loadAccountCeilings` (via `deps.judgeCeilings`) feeds the ceilings the health cap must merge into
- `src/index.ts:276-285` — `judgePosts` invocation; the only production caller
- `src/index.ts:398-406` — the exhaustion catch; the alarm's single entry
- `src/index.ts:260-262, 304-306` — the heartbeat call sites (Gate 1 and Gate 2); the degraded line's heartbeat riders
- `src/index.ts:323` — `sendDigest`; the degraded line's digest rider
- `.github/workflows/watch.yml:167` — the Commit state add; the health file must join the set
- `scripts/commit-state-rebase.sh:59` — the skip-set; the health file must join the case

### Outbound Dependencies

- `src/judge-health.ts` (new) → `src/state.ts:196` (`stateTempPath`), `src/config.ts` (the new path constant)
- `src/judge.ts` → `src/judge-rotation.ts` (all rotation primitives); `src/judge-rotation.ts` → `src/judge.ts` (type-only import, no runtime cycle)
- `src/email.ts` → `src/types.ts` (`AccountFailure`), `src/linkedin-payload.ts` (`LegLine`)
- `scripts/commit-state-rebase.sh` → git (rebase + push + one internal retry)

### Infrastructure Wiring

- `WatcherDeps` (`src/index.ts:104-128`) — the health resolver joins as a sibling of `judgeCeilings`/`linkedinFetch`
- `RotationState` (`src/judge-rotation.ts:54-77`) — gains the per-account outcome ledger and the per-tick probe set
- `.github/workflows/watch.yml` — new `Commit health` step (`if: always() && failure()`), Commit state file-set grows
- `scripts/commit-state-rebase.sh:58-60` — skip-set grows to three files

## Architecture Insights

- **The ceilings module is the template, not the inspiration.** Never-throwing reader (ENOENT quiet, other faults one warn naming the file), pure resolver with warnings returned, atomic writer with the injected temp-path, and the writer living in `src/` precisely so it is unit-testable (`src/judge-ceilings.ts:16-18`). The health module copies all four.
- **The outcome union is account-blind, and that is the load-bearing constraint.** Any per-account record must be stamped in the core where `attemptIndex` and the failure cause are simultaneously in scope; wrapper-level stamps cannot express "which accounts failed" because one call traverses several.
- **The flavor split is the single choke point for the terminal.** `earliestCooldown` defined → budget park → exhaustion; else → zero-charge ceiling wait. A health-blocked predicate is invisible to `earliestCooldown`, so the third arm is mandatory, not optional.
- **The hosted runner has no memory except git.** Every cross-tick behavior (marks, episode bit) rides the commit-back, which means the failure path needs its own commit step — the PC leg's untracked marker works only because the PC clone is long-lived.
- **Byte-stability is a commit-cadence constraint, not a style preference.** A `writtenAt` stamped on every write would mint a commit every tick; the `saveState` gate (write only on semantic change) is the doctrine that makes a timestamped envelope compatible with a committed file.
- **Warnings are for missing data, not for endpoint identity** (`src/judge-ceilings.ts:11-12`). For health the doctrine inverts: missing data *is* the good state, so per-account floor warnings would fire on every healthy run — the health resolver's warnings are file-level reason lines only, and per-account degradation is communicated through the email line.
- **Non-empty at every throw site.** The empty-record null at `src/email.ts:181-182` silently suppresses the email while exit 1 still happens — the exact failure mode `failuresFromCooldowns`' doc (`src/judge-rotation.ts:233-242`) was written to prevent. The unified builder inherits the same invariant.

## Precedents & Lessons

4 similar past changes analyzed.

### Precedent: the ceilings file and the two-file commit-back
**Commit(s)**: `3e7e38c` — "probe: write and commit state/judge-ceilings.json from the dispatch-only gate" (2026-11-06); `d4e4007` — "docs: two committed state files, dispatch dial story, ceilings probe workflow" (2026-11-06); `3fe892e` — "judge: probe-measured ceilings" (2026-11-06, first-ever commit of the file itself)
**Blast radius**: 4 files for the code commit (watch.yml +49, commit-state-rebase.sh +35, probe-judge.ts +32, tests +72); 6 files for the docs commit (README, AGENTS.md, 4 guidance files)

**Follow-up fixes**: none, but the validation doc flagged that the probe's `timeout-minutes: 10` vs ramp growth could kill the run before Commit ceilings and lose the readings.

**Lessons from docs**:
- `.rpiv/artifacts/validation/2026-11-07_06-44-20_llm-account-spread-judge.md` — "state/ currently has no ceilings file anywhere — the file has never been committed" until the first live run

**Takeaway**: the set-membership skip test already anticipates file #3 — adding `state/judge-health.json` is a one-line skip-set edit plus a watch.yml step, but budget a job-timeout check and expect the file to materialize only after the first live run.

### Precedent: the commit-back machinery's first-day churn
**Commit(s)**: `510ff2a` (2026-10-30) then five same-week fixes — `89c8bc5` (fetch full history), `8b777e6` (force-with-lease), `45bcbd3` (skip conflicted state commits), `2e28916` (set -e proof + bounded), `bc760cb` (gate the skip on the conflicted path); extracted to a script by `b779ff7` (2026-11-01, +342-line test suite)
**Blast radius**: initially inline in watch.yml; the extraction touched 4 files

**Takeaway**: committed-state plumbing broke in five distinct ways on its first day. Extend the existing script and its 342-line suite; do not fork it.

### Precedent: the rotation/exhaustion machinery
**Commit(s)**: `869feed` (2026-10-26, rotation born), `1a61bf9` (2026-10-28, per-batch rotation + cooldown park), `f14d9f9` (2026-10-30, judge-rotation.ts split out), `522395a` (2026-11-06, ceilings spread), `98c9c1f` (2026-11-07, deep ramp + probe→watch serialization)

**Follow-up fixes**:
- `fda50c2` (2026-10-26) — "fix: defer unanswered judge batches, raise the request timeout"
- `7cc7250` (2026-10-27) — "fix: drop JUDGE_CONCURRENCY to the probe reading of 4 — 8-wide bursts trip the endpoint's limiter"

**Takeaway**: exhaustion was written 429-first and took three commits plus two fixes to stabilize. The unified 429/503 terminal must live next to the cooldown path, and failure records must carry the real status from day one.

### Precedent: the leg-dead episode marker
**Commit(s)**: `a8752bf` — "feat: run the linkedin leg on the local pc (voyager transport, payload push, login helper)" (2026-11-05, 33 files)

**Lessons from docs**:
- `scripts/fetch-linkedin.ts:95-102` — OS temp rejected 2026-11-04: a PC restart erased the episode and re-alarmed a still-dead leg
- `.rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md` — "the GitRunner seam and episode-marker edge get pinned offline, not after the first live push"

**Takeaway**: one-alarm-per-episode landed clean because the marker was repo-local and the edge semantics were test-pinned before the first live run. Replicate both, including the recovery-resets-episode acceptance test.

### Composite Lessons
- Committed-state plumbing broke five ways on day one (`89c8bc5`…`bc760cb`); extend the skip-set + watch.yml + `tests/commit-state-rebase.test.ts`, and re-verify the job-timeout budget.
- Exhaustion was 429-only with a hardcoded reason; run 42315079264 exposed silent 503-only pools and no cross-tick memory. Unify flavors at the rotation terminal and carry recorded real causes.
- Concurrency guesses tripped the endpoint limiter within a day (`7cc7250`); measured ceilings with a never-throwing reader replaced them. The health reader and the `min(ceiling, healthCap)` merge follow the same never-fail + single-writer doctrine.
- Episode markers must be repo-local, not OS temp, cleared only on a verified healthy edge, with the edge pinned offline before the first live run.
- New state files do not exist until a live run creates them (`3fe892e`), and main moves every ~10 minutes with bot commits — acceptance criteria and pushes must account for rebase churn.
- Docs are a declared phase: the ceilings rollout shipped a dedicated docs sync (`d4e4007`); the "two committed state files" prose in README, AGENTS.md, and the guidance files will go stale and must grow to three.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-11-07_07-13-17_provider-health-circuit.md` — the FRD this research answers
- `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md` — the settled spread design (do not re-litigate)
- `.rpiv/artifacts/solutions/2026-11-06_11-05-39_llm-account-spread-judge.md` — the dead-ends ledger for the spread design
- `.rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md` — the spread design artifact (Slice 4 docs sync)
- `.rpiv/artifacts/plans/2026-11-06_18-36-57_llm-account-spread-judge.md` — the spread implementation plan (Phase 5 probe context)
- `.rpiv/artifacts/validation/2026-11-07_06-44-20_llm-account-spread-judge.md` — the validation report for the shipped spread feature
- `.rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md` — the PC-leg plan (episode-marker test-pinning lesson)

## Developer Context

**Q (`.github/workflows/watch.yml:157-176`): FR7 puts the episode marker inside `state/judge-health.json`, but the Commit state step has no `if:` condition — it is skipped when the run exits 1 on exhaustion (`src/index.ts:398-406`), so the first all-dead run's bit never reaches main and every later all-dead run re-alarms. How should the bit survive the run that sets it?**
A: Health commit on failure. A new `Commit health` step with `if: always() && failure()`, `-f`-guarded add of only the health file, same rebase script. The existing Commit state step grows its file set for the success path.

**Q (`src/judge-rotation.ts:134-135`): FR4's acceptance line promises "tick 3+ receives exactly 1 request per tick", but the ceiling gate is `inFlight >= ceiling` — concurrency, not count — and nothing stops re-picks after the dial wraps. Which mechanism delivers the half-open probe?**
A: Per-tick probe ledger. `RotationState` gains `probedThisTick: Set<number>`; `pickEligibleAccount` skips an account already in the set. It resets naturally because state lives per `judgePosts` call, which is per tick. The probe failure is the countable dispatch that feeds the next tick's mark.

**Q (`src/judge.ts:391-397`): When every account is health-blocked, the pick returns undefined with no active cooldown, so the flavor split falls into `waitCeilingSlot` (`:396`) and the parked promise never resolves — an unbounded hang that charges no budget. How should an all-health-dead pool reach the exhaustion alarm?**
A: Third flavor arm. `else if (allHealthBlocked(state)) return { status: "exhausted" }` — trips immediately, zero park, reuses the existing throw → email → exit 1 path untouched.

**Q (`src/index.ts:398-406` + `.github/workflows/watch.yml:167-171`): The approved `Commit health` step is dead machinery unless the exhausted run itself persists marks — the FRD puts the health writer on the success paths only, an exhausted run exits at `src/index.ts:398-406` before any write, so the new step's `-f` guard skips the add and the no-op guard exits 0. Decision 1 and this question are one decision: does the exhaustion path persist marks?**
A: Yes. The tick's outcome ledger rides the tagged error (`RotationExhausted` grows a health payload built in `judgePosts` from the ledger + episode decision), and the entry-guard catch flushes it best-effort through the health module before `process.exit(1)` — a failed write logs a warning and never masks the earned exit code (the heartbeat/alarm best-effort doctrine). First all-dead run: marks + episode bit set, alarm sent, exit 1, `Commit health` commits the delta. Later all-dead runs: load `outageOpen: true` at startup, suppress the email (warn-only), re-affirm marks, still exit 1 — and still produce a health commit only if the file changed (re-affirming an unchanged file no-ops, which is correct).

**Q (`src/judge-rotation.ts:121-140` + `src/judge.ts:841-849`): When a capped account's single probe dispatch succeeds mid-tick, does it stay blocked until the next tick, or rejoin the pool for the rest of the tick? The fallback pool shares the same `RotationState`, so the ledger rule changes real traffic.**
A: Success frees the tick. A successful probe clears the in-run mark and the account rejoins with its committed ceiling for the rest of the tick — bulk tail and fallback pool included. Matches FR3's success-clears at request granularity, and the cap lives entirely in the pick predicate, so the ceilings map never needs a run-time write (its doctrine at `src/judge-rotation.ts:58-60` forbids one).

**Q (`src/config.ts:63-72` + `src/state.ts:237-254`): FR9 names "stale marks" as a floor class, but that is undecidable without a timestamp, and any timestamp couples the file to the commit-cadence constraint. Which staleness policy does the health file carry?**
A: No staleness policy. Marks self-heal: a stale mark costs at most the 1-request probe per tick until the first success clears it (FR3), so the file stays byte-stable with no clock — the ceilings precedent (`src/config.ts:63-72`) exactly. FR9 is reworded to "absent or malformed" in the FRD.

**Q (`src/index.ts:257` vs `:270`): The degraded line needs pool size above Gate 1 because Gate 1 heartbeats must render it (FR8), but `resolveJudgeConfig` lives in the judge stage. Hoisting moves a malformed-`LLM_ACCOUNTS` failure earlier. Which way?**
A: Hoist `resolveJudgeConfig` to the `runUrlFromEnv` site (`src/index.ts:238`); one resolve is reused by the judge stage. A malformed `LLM_ACCOUNTS` fails the run sooner — same nonzero exit, just before the fetch stage instead of after it.

**Q (`src/index.ts:401`): The exhaustion catch reads `process.env` directly because it lives in the module-level CLI bootstrap where `WatcherDeps` are out of scope. Keep as-is or rework?**
A: Keep `process.env`. Production runs always have it; the episode-dedup tests exercise the flush helper and the health module directly (the `tests/fetch-linkedin.test.ts:492-549` shape) — the bootstrap stays untested by design.

**Q (discover: Remember account health): Every tick re-discovers dead accounts from scratch — a 503ing endpoint burns 4 requests per affected batch every 10 minutes. Keep this, or change it?**
A: Remember health.

**Q (discover: Alarm carries the real cause): The exhaustion alarm's reason is hardcoded "HTTP 429" (`src/judge-rotation.ts:243-250`) — yesterday's failure email could never say "503". Keep, or change?**
A: Carry real cause.

**Q (discover: Unify failure handling across 429/503 flavors): An all-429 pool alarms and exits 1, but an all-503 pool exits 0 silently every tick (`src/judge-rotation.ts:195-228`). Keep, or unify?**
A: Unify.

**Q (discover: Health lives in a committed state file): Where should account health live?**
A: Committed state file (single-writer doctrine like `state/judge-ceilings.json`).

**Q (discover: Half-open circuit: cap at 1, not skip): How should a health-marked account be treated by the judge?**
A: Cap at 1.

**Q (discover: One alarm per outage episode): All-dead runs alarm every 10 minutes during an outage. De-duplicate?**
A: One per episode.

**Q (discover: Mark threshold: 2 consecutive failed ticks): How many consecutive failed ticks before capping an account at ceiling 1?**
A: 2 failed ticks.

**Q (discover: Un-marking: success clears): How does a capped account regain its full ceiling?**
A: Success clears (the cap-at-1 request is the probe; first success restores the committed ceiling; a green probe does not directly edit the file).

**Q (discover: Degraded visibility: one line in emails): How visible should a degraded pool be?**
A: One line in digest/heartbeat emails.

## Related Research

- `.rpiv/artifacts/research/2026-11-06_10-12-16_llm-account-spread-judge.md` — the spread-judge research (ceilings, rotation, exhaustion)

## Open Questions

None — all seven research questions and all seven checkpoint decisions are resolved. The staleness decision drops the stale floor class from FR9; the probe-success decision (success frees the tick) is baked into FR4's ledger mechanism.
