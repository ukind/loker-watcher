---
date: 2026-11-08T12:04:26+0700
author: Yogiswara Utama
commit: 77f44d7
branch: main
repository: loker-watcher
topic: "account-availability-check"
tags: [intent, frd, judge, judge-rotation, llm-accounts, email]
status: ready
last_updated: 2026-11-08T12:04:26+0700
last_updated_by: Yogiswara Utama
---

# FRD: Account Availability Check Before Judging

## Summary
Every watch run tests each LLM account with one tiny request before judging starts. Accounts that answer judge the tick at their probe-measured ceilings; accounts that refuse — rate limit, timeout, or error — sit out. When no account answers, the run skips judging, keeps every post unseen, still sends the alarm email, and exits green. Failure messages stop claiming "all accounts failed" when only some failed.

## Problem & Intent
The developer arrived with a failed run: "check my this gitworflow failed: https://github.com/ukind/loker-watcher/actions/runs/42440065433". Diagnosis: nube-api and z.ai answered every batch with HTTP 429, a third account (openrouter) hung on one batch and delivered nothing, the pool exhausted, and the run exited 1. The developer asked: "so it because all LLM account rate limited ? all account cant be used ?" — then stated the feature:

> "if any account is rate limited, use only that active account to watch. but this must be in separated flow paralel run with `probe` probe is for check maximal concurrent LLM connection, and this new is to check which account still can be used from there. if only 1 is active and from probe flow that active account can use 32 concurrencly for example, therefore the watcher will only use that account. but if all account is able to use then do the same as common sense"

Asked who feels the pain most, the developer picked "Job seeker" — matches must not be missed because a provider rate-limited us mid-run. The interview adjusted one part of the original wording: a flow parallel to `probe` never runs on the every-10-minutes schedule (the probe job is dispatch-only), so the check lives inside every watch run instead.

## Goals
- Every run knows which accounts work before the first judge batch.
- Surviving accounts carry the tick at their probe-measured ceilings.
- All accounts alive → the run behaves exactly as today.
- All accounts down → no posts lost, alarm email still sent, run ends green.
- Failure messages tell the truth: the pool size and each account's real outcome.

## Non-Goals
- No new workflow job and no new committed state file.
- The check never measures concurrency — the probe owns ceilings.
- No change to the mid-run 60-second cooldown and dispatch spread.
- No same-run retry of accounts that failed the pre-check.

## Functional Requirements
1. At the start of every watch run, before any judge batch, the system sends one tiny chat-completions request to each `LLM_ACCOUNTS` account, in parallel.
2. An account passes when its request answers within the per-account test timeout. HTTP 429, timeout, HTTP 5xx, network error, or an unusable answer marks the account unavailable for this run.
3. The judge dispatches only onto accounts that passed, each at its probe-measured ceiling from `state/judge-ceilings.json`.
4. When every account passes, the run behaves exactly as today.
5. When no account passes: no judge calls are made; post ids stay unseen (retry next run); the exhaustion alarm email still goes out (one per outage episode); the run exits 0; the run log names the skip.
6. The exhaustion message states the pool size and each account's outcome — for example "judge: 2 of 3 LLM_ACCOUNTS accounts failed — account 1 (...): HTTP 429; account 3 (...): HTTP 429". The alarm email lists what each account did instead of claiming "every account failed".
7. Mid-run refusals keep today's behavior: the 60-second cooldown and the dispatch spread to other accounts.

## Non-Functional Requirements
- **Performance**: the pre-check runs all tiny calls in parallel with a hard per-account test timeout (~10s); the tick stays inside the workflow timeout.
- **Security**: no API keys, headers, or verdict content in logs; each tiny call uses its own account's key and model.
- **Reliability**: the alarm stays one-per-outage-episode even though skip runs exit green. The checker itself must never crash the tick: a checker error degrades to "all accounts available" with one warning line — design should ratify this against the fail-visible doctrine.
- **Cost**: ~1 tiny call per account per 10-minute tick (~144 per account per day). Tiny calls are near-free on these providers; research should confirm against the providers in `LLM_ACCOUNTS`.

## Constraints & Assumptions
- Node >= 22, ESM, and the strict TypeScript flags stay on. Tests stay offline (`node:test` + `tsx`, mocked transport). No new runtime dependency — the tiny call reuses the judge's existing chat-completions client seam.
- The check lives in `src/` plus the `src/index.ts` wiring; no workflow YAML changes.
- Availability is per-run and in-memory; nothing new lands in `state/`.
- Assumption: a tiny call that answers means the account can carry real batches this tick. Mid-run throttling stays covered by the existing cooldown.
- Assumption: the 8-hour probe freshness gate keeps ceilings fresh enough for the surviving accounts.

## Acceptance Criteria
- [ ] `npm run typecheck && npm run lint && npm test` all exit 0.
- [ ] `npm test` covers: all-pass (dispatch unchanged), some-pass (only survivors dispatched), all-fail (no judge call, alarm mock sent, exit 0, posts stay unseen), checker-error (one warning, unfiltered run), and the "2 of 3" message format.
- [ ] A mocked all-refusing run logs a skip line naming 0 of N accounts available and exits 0.
- [ ] The exhaustion error in tests reads "judge: 2 of 3 LLM_ACCOUNTS accounts failed — …" and the alarm email names each account's outcome.
- [ ] A manual dispatch with one deliberately broken key shows that account sitting out with its reason, and the run completes green on the rest.

## Recommended Approach
New small module `src/judge-availability.ts`: one tiny chat-completions call per account in parallel (reusing the judge's HTTP client seam), returning pass/fail per account index. `src/index.ts` filters the `LlmAccount[]` before `judgePosts`, logs sit-outs, and on all-down skips judging, sends the existing alarm, and exits 0. The wording fix lands in `rotationExhausted` (`src/judge-rotation.ts:135`) and the alarm copy (`src/email.ts:200-205`).

## Decisions

### D0 — Who feels the pain
**Question**: Who feels the pain most when a rate-limited account kills the run — and what does a good run look like for them?
**Recommended**: n/a — intent question
**Chosen**: Job seeker
**Rationale**: the digest must reach job seekers even when providers throttle the run

### D1 — Core: availability = a pre-run pool filter
**Question**: The developer's feature statement (rate-limited accounts sit out; only active accounts watch).
**Recommended**: filter the pool before dispatch
**Chosen**: keep
**Rationale**: evidence: src/judge-rotation.ts:47 + the developer's feature statement — mid-run 429s already cool accounts; the gap is run start

### D2 — The check runs inside every watch run
**Question**: The probe job is dispatch-only (watch.yml:26) — scheduled ticks skip it, so a flow parallel to probe never runs on cron. Where does the availability check live?
**Recommended**: inside the watch job, before judge
**Chosen**: Every run (inside the watch job)
**Rationale**: a probe-parallel flow would miss the every-10-minute ticks; in-run costs a few seconds and needs no new job

### D3 — All accounts down: skip judging, stay green
**Question**: If the upfront test finds every account refusing, what should the run do?
**Recommended**: skip judging, stay green
**Chosen**: same
**Rationale**: matches must not be missed (D0); posts stay unseen, the alarm still fires, and red stays reserved for real outages; exit-code semantics under review — see Open Questions (health commit gate)

### D4 — The test signal: one tiny chat call
**Question**: What should the upfront test send to each account?
**Recommended**: tiny chat call
**Chosen**: same
**Rationale**: near-zero cost and an exact "can this account answer now" signal; a real judge call would spend tokens and mark a post judged

### D5 — "Down" means any failure
**Question**: Should an account that answers slowly or with errors also sit out this round?
**Recommended**: yes, any failure
**Chosen**: same
**Rationale**: run 42440065433 died with a hung (timeout) account, not only 429s — refusals and hangs both kill a tick

### D6 — Ceilings stay probe-owned
**Question**: Should the new check keep using the probe's measured concurrency numbers?
**Recommended**: keep probe ceilings
**Chosen**: same
**Rationale**: probe-measured values are committed data per repo doctrine; the check duplicates nothing

### D7 — Truthful exhaustion wording
**Question**: The exhaustion line counts only failed accounts, not pool size — it printed "all 2 LLM_ACCOUNTS" for a 3-account pool. Fix it as part of this work?
**Recommended**: fix it here
**Chosen**: fix it here
**Rationale**: evidence: src/judge-rotation.ts:135 + src/email.ts:200-205 — the message and email misstate the pool in mixed outcomes

### D8 — Mid-run behavior unchanged
**Question**: Pre-resolved from codebase evidence (mid-run 429 cooldown and dispatch spread exist and work)
**Recommended**: n/a
**Chosen**: unchanged
**Rationale**: evidence: src/judge-rotation.ts:47 (COOLDOWN_MS 60s) — confirmed during the placement question

## Open Questions
- **All-down exit code vs health persistence (blocking)** — D3 makes the all-down path exit 0, but the `Commit health` step runs only on `watch.yml:205`: `if: always() && failure()`. A green skip run never commits `state/judge-health.json` — on the exact path that most needs it. Resolve: keep exit 1 on all-down, or widen the health commit to `if: always()`. Note the tension with the FRD constraint "no workflow YAML changes".
- **Gate efficacy vs the observed failure (blocking, deferred by the developer)** — the probe measured all 3 accounts alive at 02:20 UTC; exhaustion hit at 02:50 under ~52 concurrent batches (run 42440065433). A tiny pre-run call would have passed all 3 accounts and the run would have failed identically: the failure mode was "alive but throttled under load", not "dead". The developer deferred the choice: re-scope the feature, or add a concurrency guard.

## Suggested Follow-ups
- Openrouter claimed only 1 of ~52 batches despite ceiling 32 in run 42440065433 — investigate the dispatch spread in `src/judge-rotation.ts`.
- The exhaustion gate can fire while a non-cooling account is merely slow (today's failure shape) — re-check `earliestCooldown` semantics in `src/judge-rotation.ts` during design.
- "Checker error → degrade to unfiltered" vs the fail-visible doctrine — design should ratify (`.rpiv/guidance/src/architecture.md`, Fail-visible contracts section).

## References
- Failed run: https://github.com/ukind/loker-watcher/actions/runs/42440065433
- `state/judge-ceilings.json`, `state/judge-health.json` (committed evidence read during the session)
- `.rpiv/guidance/src/architecture.md` (judge rotation), `.rpiv/guidance/.github/workflows/architecture.md` (probe job)
- Prior FRDs: `.rpiv/artifacts/discover/2026-11-07_07-13-17_provider-health-circuit.md`, `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md`
