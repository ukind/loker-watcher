---
date: 2026-10-28T07:04:59+0700
author: Yogiswara Utama
commit: 11a1938
branch: main
repository: loker-watcher
topic: "Validation of per-batch-llm-rotation"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-27_17-55-19_per-batch-llm-rotation.md"
tags: [validation, judge, rotation, cooldown, park, budget, probe, concurrency]
last_updated: 2026-10-28T07:04:59+0700
---

## Validation Report: per-batch-llm-rotation

### Implementation Status

- ✓ Phase 1: Time seam — Fully implemented
- ✓ Phase 2: Cooldown core — Fully implemented
- ✓ Phase 3: Park and wait budget — Fully implemented
- ✓ Phase 4: Alarm acceptance — Fully implemented
- ✓ Phase 5: Probe and gating — Fully implemented

All five phases are marked `- [x]` in the plan and each claim was verified
against the shipped code. The validated tree was committed and pushed to
branch `per-batch-llm-rotation` (commit `1a61bf9`, on top of `origin/main`
`89ba809`) because the live manual checks dispatch the workflow from GitHub,
which checks out the pushed ref — an uncommitted tree is invisible to it.
Local `main` is unchanged.

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean
- ✓ Lint + format: `npm run lint` (biome, 24 files) — clean
- ✓ Full suite: `npm test` — 176/176 pass, 12.3s wall
- ✓ Judge suite: `npx tsx --test tests/judge.test.ts` — 62/62 pass
- ✓ Pipeline suite: `npx tsx --test tests/index.test.ts` — 8/8 pass
- ✓ Phase 1 scoped lint: `npx biome check src/judge.ts src/index.ts tests/judge.test.ts` — clean
- ✓ Phase 1 sleep-seam grep: `grep -c "await sleep(" src/judge.ts` = 0; `grep -c "await sleepFn("` = 2 (plan expected 1 — see Deviations, item 1)
- ✓ Phase 2 pointer-removal grep: `rotateOnRateLimit|state.index|state.failures` = 0; `failuresFromCooldowns` = 4 (definition + 3 throw sites)
- ✓ Phase 3 park grep: `parkUntilEligible` = 3 (definition + both loop tops); `WAKE_JITTER_MS` = 2
- ✓ Phase 3 5xx-arm structure: the `RETRYABLE_STATUSES` arm shows only `sleepFn(delay)` + `continue` — no park, no budget draw
- ✓ Phase 4 alarm-chain diff: `git diff 11a1938 -- src/email.ts src/types.ts src/config.ts src/config-file.ts` — empty
- ✓ Phase 5 scoped lint: `npx biome check scripts/probe-judge.ts` — clean
- ✓ Phase 5 offline smoke: `LLM_ACCOUNTS= npx tsx scripts/probe-judge.ts` — exits 1 naming `LLM_ACCOUNTS` before any network call
- ✓ LIVE gating test (FRD bullet 5): dispatch run
  [40607779117](https://github.com/ukind/loker-watcher/actions/runs/40607779117)
  with a third dead-key account — probe job conclusion `failure`, log:
  `probe: DEAD account(s) — failing the gating probe:` /
  `account 3 (https://openrouter.ai/api/v1) — auth-dead: HTTP 401` /
  `Process completed with exit code 1.` The watch job in the same run
  succeeded, proving a dead key degrades the run gracefully instead of
  killing it.
- ✓ LIVE green probe: dispatch run
  [40608301086](https://github.com/ukind/loker-watcher/actions/runs/40608301086)
  with the restored two-account secret — probe job `success`, one `===`
  block per account, `ceiling=4` for both, `all accounts verified — gating
  probe passed`.
- ✓ LIVE post-landing watch run (same run 40608301086): watch job `success`
  — 713 unique posts, 482 within 72h, 82 unseen, 72 judged, 0 matches,
  heartbeat sent, state committed, no exhaustion alarm.
- ✓ No regressions detected — the pre-existing suites (fetch, extract,
  state, email, heartbeat, config) all pass unchanged.

### Code Review Findings

#### Matches Plan:

- `src/judge.ts:86,94,101` — `COOLDOWN_MS = 60_000`, `WAIT_BUDGET_MS = 300_000`, `WAKE_JITTER_MS = 500`, each with the plan's constants-as-documentation comment.
- `src/judge.ts:105-109` — `sleep` exported with the plan's JSDoc naming the `WatcherDeps.sleepFn` seam.
- `src/judge.ts:126-135` — `RotationState` reshaped to `{accounts, cooldownUntil, waitBudgetRemainingMs}` with the plan's doc comments; no `index`, no `failures`.
- `src/judge.ts:412-423` — `pickEligibleAccount`: synchronous pool scan from account 1, expired-or-missing entry is dispatchable; the sync-window discipline comment is preserved.
- `src/judge.ts:431-435` — `coolAccount`: first-write-wins (an already-cooling account keeps its earlier expiry; an expired entry re-stamps).
- `src/judge.ts:448-459` — `failuresFromCooldowns`: one record per map entry in pool order, 1-based, no freshness filter — the Step-8 review triage (entry existence, not current expiry) is applied, so the empty-record silent-email path stays dead.
- `src/judge.ts:471-495` — `parkUntilEligible`: charge-before-sleep, overshoot-only re-charge after wake, clamp at 0, refuse at `<= 0`, never throws.
- `src/judge.ts:538-549` and `:658-667` — both loop tops park outside the try, convert at the loop top (`{status: "exhausted"}` / terminal throw), and spend no attempt (`attempt -= 1`).
- `src/judge.ts:574-580` and `:690` — 429 arms cool-and-rewind inside the try; no throw can cross the catch.
- `src/judge.ts:773` — state creation; `:813` bulk-join and `:896` fallback-join drain-then-throw with the synthesized record.
- `src/judge.ts:1-35` — module header rewritten to the plan's present-tense cooldown/park description.
- `src/index.ts:115-116,141,204-205` — `WatcherDeps.sleepFn` field, `deps.sleepFn ?? sleep` resolution, and `now`/`sleepFn` forwarded as the last two `judgePosts` arguments; the import gains `sleep`.
- `tests/judge.test.ts` — all ten new or rewritten clusters present with the plan's assertions: sleep logs `[60_500, 60_500, 60_500, 60_500, 58_000]` and `[60_500, 60_500, 60_500, 60_500, 38_000]`, the single `[60_400]` park, budget untouched (`300_000`) when an account is eligible, pool-ordered `[1, 2, 3]` record with per-worker monotonicity, the `key-1 → key-2 → key-2 → key-1` restart proof, and the four Phase-2 fences amended with inert sleeps.
- `tests/index.test.ts:26,332` — the `isRotationExhausted` import and the budget-death seam test (tagged rejection, complete record, zero emails, state file never created).
- `scripts/probe-judge.ts` — `AccountProbe` record, `classifyDead` (auth-dead vs busy vs broken ramp), per-account `main()` walk with `===` blocks, ramp `[2, 4]` returning 4, exit 1 naming dead accounts, recommendation line deleted.
- `.github/workflows/watch.yml` — `continue-on-error` removed from the probe job with the every-account rationale; envelope-race comment added beside `timeout-minutes: 8`; the `JUDGE_CONCURRENCY: "4"` literal and its evidence comment untouched.

#### Deviations from Plan:

- `src/judge.ts:490` vs Phase 1 criterion — the plan's Phase 1 gate expected
  `grep -c "await sleepFn(" src/judge.ts` to return 1. It returns 2: Phase 3's
  `parkUntilEligible` legitimately added the second call site. The
  criterion's stated intent ("no direct sleep call sites remain") holds —
  `await sleep(` is 0. Plan-criterion staleness, non-blocking.
- Phase 5 manual item vs live evidence — the item assumed the live dispatch
  would show a digest and account-1 restarts. Run 40608301086 had zero
  keyword matches (the heartbeat fired, not a digest) and no 429s occurred,
  so no restart was observable live. The pipeline completed cleanly under
  the new code; the restart behavior is pinned by the offline FRD-bullet-1
  test with the hand-stepped clock. Non-blocking observation.
- Process note (not a code deviation) — the live checks required the code on
  GitHub, so the validated tree was committed to branch
  `per-batch-llm-rotation` (`1a61bf9`) instead of staying uncommitted. For
  the dead-key test the `LLM_ACCOUNTS` secret temporarily carried a third
  account with a bogus key; it was restored to the original two-account
  value immediately after (verified via `gh secret list`). The branch also
  carries two bot state commits from the live watch runs (`ffb706f`,
  `7462f91`); when merging to main, take main's `state/seen-posts.json` or
  the union of ids.

#### Pattern Conformance:

- ✓ New constants, the tagged-error factory/guard reuse, trailing-param DI (`now`/`sleepFn` beside `fetchFn`), and the documented sync-window discipline all follow the module's established conventions.
- ✓ Tests keep the file's URL-branching mock doubles and injected-clock style; the new clusters are inert-sleep throughout, so the suite stays offline.
- ✓ `scripts/probe-judge.ts` keeps the `timed`/`rampLevel` classifiers untouched and extends them with the per-account record, matching the file's shape.
- Acceptable variation, not a deviation: `parkUntilEligible` seeds `earliest` with `Number.POSITIVE_INFINITY` where the plan's fence wrote `Infinity` — same semantics, satisfies the lint config.

#### Potential Issues:

- `AGENTS.md:38-39` — still describes rotation as "the first HTTP 429 rotates to the next account with no backoff, run-sticky". False after this change (batch-local scan, 60s cooldown, in-loop park). Comment-only.
- `.rpiv/guidance/src/architecture.md:65-73` — the "Judge rotation: 429 CAS" section still documents `rotateOnRateLimit`, `state.index`, and `state.failures`, all deleted by this change. Comment-only.
- `.rpiv/guidance/.github/workflows/architecture.md:17,63-69` — still describes the probe job as `continue-on-error` and accounts[0]-only. Comment-only.
- `.rpiv/guidance/scripts/architecture.md:7,27,32,51,61` — still documents the deleted `probe: recommended JUDGE_CONCURRENCY = ...` output line, the accounts[0]-only probe, and the non-gating job. Comment-only.
- `.rpiv/guidance/architecture.md:31` — the command table still says the probe "prints the recommended JUDGE_CONCURRENCY". Comment-only.
- Windows-only probe quirk — `process.exit(1)` after several `fetch` calls made with `AbortSignal.timeout` crashes Node on Windows with a libuv assertion (`src\win\async.c`) and exit code 127. Proven pre-existing: the base probe at `11a1938` crashes identically, and a plain-Node repro with no repo code crashes the same way. On ubuntu CI the probe exits 1 cleanly (observed in run 40607779117). Local Windows runs of the probe's failure path will show 127 instead of 1.
- OPERATIONAL, carried from the plan's Migration Notes and still open — both LLM keys appeared in plaintext chat again during this session. Rotate them at the providers and update the `LLM_ACCOUNTS` secret. This is an ops task, not a code gap.

### Manual Testing Required:

All manual criteria were executed — offline where possible, live in GitHub
Actions where the item demanded it.

1. Phase 1 — timing seam:
   - [x] The "no backoff wait" rotation test passes in 0.47ms (< 500ms) — no timing behavior changed
   - [x] Every existing `judgePosts`/`judgePost` call site typechecks unchanged (typecheck clean)
2. Phase 2 — cooldown core:
   - [x] FRD bullet 1 restart proof passes with a hand-stepped clock in 0.83ms — no real 60s wait
   - [x] Alarm chain untouched: `git diff 11a1938 -- src/types.ts src/email.ts src/config.ts src/config-file.ts` empty
   - [x] The reasoning-effort payload tests pass untouched (6/6)
3. Phase 3 — park and budget:
   - [x] FRD bullet 2 passes: exactly one park of 60_400ms (inert) completes the backlog — pinned by the sleep-log assertion
   - [x] Suite stays offline and fast: every all-cooling test completes in ≤ 1.5ms; `npm test` wall time 12.3s, dominated by the two pre-existing 6s fetch-retry tests
4. Phase 4 — alarm acceptance:
   - [x] FRD bullet 3 holds end-to-end at the `runWatcher` seam: tagged rejection, complete pool-ordered record, zero emails, state file never created
   - [x] The email leg (exactly one send; empty-record silent path stays dead) is pinned by `tests/email.test.ts` — all pass
5. Phase 5 — probe and gating (live):
   - [x] FRD bullet 5, dead key: dispatch run 40607779117 turned red naming `account 3 — auth-dead: HTTP 401`
   - [x] All-live keys: dispatch run 40608301086 went green with one `===` block per account and `ceiling=4` each
   - [x] The `JUDGE_CONCURRENCY: "4"` literal and its evidence comment stay untouched
   - [x] The watch job carries the envelope-race comment beside `timeout-minutes: 8`
   - [x] Post-landing validation run: the watch job completed on live posts — heartbeat sent, no exhaustion email, state committed; no 429 occurred in the window, so the live log shows no restart (pinned offline instead)
6. Offline probe harness (executed during this validation, scratch deleted after):
   - [x] Mock-endpoint runs proved the dead-key exit-1 naming, the busy-429 pass (429 is data, not a gate failure), the all-live pass, and the missing-pool exit 1

### Recommendations:

- Rotate both LLM keys at the providers and update the `LLM_ACCOUNTS` secret — they leaked in plaintext chat twice (2026-10-26/27 and again during this session).
- Update the five stale doc locations (`AGENTS.md:38-39` plus the four `.rpiv/guidance/` spots listed under Potential Issues) to the cooldown/park/gating behavior — comment-only work, but it currently describes deleted machinery.
- Land the change: merge `per-batch-llm-rotation` into main. On `state/seen-posts.json` take main's version or the union of ids — the branch carries two bot state commits from the live runs.
- Ready to commit — implementation is complete and validated offline (176 tests) and live (both dispatch runs behaved exactly as the plan specifies).
