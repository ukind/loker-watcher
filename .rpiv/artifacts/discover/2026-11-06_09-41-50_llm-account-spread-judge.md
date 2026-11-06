---
date: 2026-11-06T09:41:50+0700
author: Yogiswara Utama
commit: 04424f5
branch: main
repository: loker-watcher
topic: "Spread LLM judge load across all accounts using probe-measured per-account ceilings"
tags: [intent, frd, judge, judge-rotation, probe-judge, watch-workflow]
status: ready
last_updated: 2026-11-06T09:41:50+0700
last_updated_by: Yogiswara Utama
---

# FRD: Spread LLM judge load across all accounts using probe-measured per-account ceilings

## Summary
Replace the reactive account rotation in the judge with a proactive spread: every LLM account in `LLM_ACCOUNTS` carries load from the first dispatch, each capped at its own probe-measured concurrency ceiling. The probe workflow already computes a per-account `ceiling` but only prints it; this feature persists those readings to a committed JSON file that the watch job reads at startup, so a 5-account pool runs 5 accounts in parallel instead of hammering account 1 until it 429s.

## Problem & Intent
"if the posts to judge is so many, and github action have auto cancel mechanism let say 8 minutes. using 1 account to judge is too slow. better spread acrros LLM account"

## Goals
- Every account in `LLM_ACCOUNTS` is used from the first dispatch, not only after a 429 cools an earlier account.
- Each account runs at most its probe-measured ceiling of concurrent calls, so the spread does not draw the 429s that 8-wide bursts drew on 2026-10-27.
- Total in-flight judge calls scale with the pool: N accounts at their ceilings, no overall clamp.
- The watch job keeps its 8-minute envelope: the spread shortens judge wall-clock instead of extending it.

## Non-Goals
- Changing the 180s park budget, the drain-then-throw exhaustion path, or the exhaustion alarm email.
- Changing the probe's ramp algorithm (stop-once-4) or its dead-account gate.
- Changing `JUDGE_CONCURRENCY` as an env var, or re-measuring it — it is superseded by per-account ceilings.
- Changing the LinkedIn leg, the fetch stage, or the state commit-back script.

## Functional Requirements
1. The system SHALL persist each account's probe-measured `ceiling` to a committed JSON file keyed by `baseUrl`, written by the probe job.
2. The system SHALL read that file at watch startup and resolve a ceiling per `LLM_ACCOUNTS` entry, matching on `baseUrl`.
3. The system SHALL default an account with no reading to a ceiling of 1 and log one warning naming the account.
4. The system SHALL dispatch judge calls so that no account exceeds its resolved ceiling of concurrent in-flight calls, across both the bulk phase and the single-post fallback phase.
5. The system SHALL spread starting accounts across the pool from the first dispatch via a shared dispatch counter, so surplus accounts are used as workers free up.
6. The system SHALL keep the existing 429 cooldown, park, and exhaustion behavior unchanged.
7. The probe job SHALL write the ceilings file as part of its run so the reading is committed and available to watch.

## Non-Functional Requirements
- **Performance**: judge wall-clock drops roughly with the number of accounts in the pool; the 8-minute job cap and the 10-minute cron interval remain the binding constraints.
- **Security**: no new secrets; the ceilings file holds no credentials, only `baseUrl` → integer.
- **UX / Accessibility**: not applicable — scheduled CLI pipeline.
- **Reliability**: a missing or stale ceilings file degrades to ceiling 1 per account with a warning; it never fails the run. A dead account still fails the probe job as today.

## Constraints & Assumptions
- Node >= 22, strict TypeScript, ESM; no new runtime dependency.
- The ceilings file must be committed by the workflow, following the existing `scripts/commit-state-rebase.sh` pattern.
- Assumption: distinct `baseUrl` values identify distinct accounts. Two pool entries sharing a `baseUrl` collide on one ceiling reading — accepted, since the probe reports per `baseUrl`.
- Assumption: the probe's stop-once-4 ramp yields a ceiling that is safe to run at full width in watch; the 2026-10-27 measurement (8-wide drew 429s, 4-wide clean) is the precedent.
- Assumption: `JUDGE_CONCURRENCY` is removed rather than kept as a dead knob — the developer tied width to it, then superseded it with per-account ceilings.

## Acceptance Criteria
- [ ] `npx tsx scripts/probe-judge.ts` writes a ceilings JSON file containing one entry per probed account, keyed by `baseUrl`, each with the measured integer ceiling.
- [ ] With a 5-account `LLM_ACCOUNTS` fixture and a ceilings file giving each account ceiling 4, a watch run issues its first 5 judge calls against 5 distinct accounts (assertable in a unit test with a recording `fetchFn`).
- [ ] No account ever has more than its ceiling calls in flight simultaneously (assertable with a recording `fetchFn` that tracks concurrent in-flight counts per `baseUrl`).
- [ ] An account absent from the ceilings file runs at ceiling 1 and emits exactly one warning naming that account.
- [ ] `npm run typecheck && npm run lint && npm test` all exit 0.
- [ ] The watch workflow commits the ceilings file back to the repo after a probe run.

## Recommended Approach
Extend `RotationState` in `src/judge-rotation.ts` with a per-account in-flight counter and a dispatch sequence, add a `resolveJudgeCeilings`-style reader for the committed JSON file, and have `pickEligibleAccount` skip accounts at their ceiling. The probe script writes the file; `watch.yml` maps it into the commit-back step.

## Decisions

### Replace reactive rotation with proactive spread
**Question**: From the probe I inferred — today every concurrent worker picks account 1 first, and the pool only spreads after a 429 cools an account (`src/judge-rotation.ts:85-99`, `src/judge.ts:707-720`). Is that the behavior you want replaced?
**Recommended**: Yes — replace it
**Chosen**: Yes — replace it
**Rationale**: Single-account judging is too slow against the 8-minute Actions cap when many posts need judging.

### Spread mechanism: shared dispatch counter
**Question**: How should a dispatch pick its starting account so 5 accounts get used in parallel from the first batch?
**Recommended**: Dispatch counter
**Chosen**: Dispatch counter
**Rationale**: One shared counter advanced at claim time covers both the bulk and fallback phases with a single mechanism and wears accounts evenly.

### Width semantics: per-account concurrency, not accounts in flight
**Question**: With 5 accounts and `JUDGE_CONCURRENCY=4` (`watch.yml:102`), only 4 accounts are in flight per wave. Raise the concurrency to match the pool size, or keep 4?
**Recommended**: Raise to match pool size
**Chosen**: "the 5 (X) account is dynamic you must detect it yourself how many are they" — width is per-account parallelism; total = accounts × per-account value (5×4=20)
**Rationale**: The developer reads `JUDGE_CONCURRENCY` as calls-per-account, not accounts-in-flight; the pool size is dynamic and must be detected from `LLM_ACCOUNTS`.

### Per-account ceilings come from the probe
**Question**: How should watch enforce "each account at most its probe-measured ceiling in flight"?
**Recommended**: Strict per-account cap
**Chosen**: Strict per-account cap, with ceilings sourced from the probe workflow: "for each account will determined how many max cuncurrent. and in watch phase. fired all account with maximal cuncrrency from probe result for each account"
**Rationale**: The probe already measures a per-account ceiling; reusing it keeps the burst-verified reading authoritative instead of a hard-coded width.

### No overall concurrency clamp
**Question**: With `JUDGE_CONCURRENCY` as the per-account cap, is total in-flight = accounts × `JUDGE_CONCURRENCY` with no extra overall cap?
**Recommended**: No total cap
**Chosen**: No total cap
**Rationale**: Accounts are separate providers/keys; an overall clamp would idle paid capacity.

### Ceilings persisted to a committed JSON file
**Question**: Where should the per-account probe ceilings live so the watch job can use them?
**Recommended**: Committed JSON file
**Chosen**: Committed JSON file
**Rationale**: The reading must survive across runs and the repo already has a state commit-back pattern to reuse.

### Missing ceiling defaults to 1 with a warning
**Question**: What happens when an account in `LLM_ACCOUNTS` has no ceiling in the committed file?
**Recommended**: Default 1 + warn
**Chosen**: Default 1 + warn
**Rationale**: A stale file must never fail the run; a conservative default plus one warning is the fail-visible-but-non-fatal middle ground.

### Ceilings keyed by baseUrl
**Question**: What key should the ceilings file use to match a reading to an `LLM_ACCOUNTS` entry?
**Recommended**: baseUrl
**Chosen**: baseUrl
**Rationale**: Stable across pool reordering and already what the probe reports.

### Park budget and exhaustion alarm unchanged
**Question**: From the probe I inferred — the 180s park budget and the pool-exhaustion alarm stay as-is (`src/judge.ts:110`, `src/judge-rotation.ts:144`). Keep them unchanged?
**Recommended**: Keep unchanged
**Chosen**: Keep unchanged
**Rationale**: Only account picking changes; the exhaustion path is already correct and tested.

## Open Questions

- Whether `JUDGE_CONCURRENCY` is deleted outright or left in `ENV_NAMES` as an unused name — deferred, low stakes either way.
- Whether the ceilings file needs a staleness bound (e.g. ignore readings older than N days) — not raised by the developer; research should decide if the commit-back cadence makes it necessary.

## Suggested Follow-ups

- The E2E harness passes single-credential `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` env vars so `judgePosts` uses the real endpoint; a multi-account spread may need the harness to pass a multi-account pool instead.
- `watch.yml:102` carries the probe-measured `JUDGE_CONCURRENCY: "4"` with an evidence comment; that line and its comment need rewriting once per-account ceilings land.

## References

- Input: free-text feature description (this session)
- `.rpiv/guidance/src/architecture.md` — judge rotation and funnel-gate contracts
- `.rpiv/guidance/scripts/architecture.md` — probe workflow contract
- `.rpiv/guidance/.github/workflows/architecture.md` — state commit-back pattern
