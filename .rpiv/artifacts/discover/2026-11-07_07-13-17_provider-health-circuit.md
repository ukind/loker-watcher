---
date: 2026-11-07T07:13:17+0700
author: Yogiswara Utama
commit: c647e0f
branch: main
repository: loker-watcher
topic: "Provider health circuit: remember dead LLM accounts across ticks, unify failure alarms, de-duplicate outage emails"
tags: [intent, frd, judge, judge-rotation, judge-ceilings, email, watch-workflow, reliability]
status: ready
last_updated: 2026-11-07T08:03:28+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Amended after research (2026-11-07_07-26-22_provider-health-circuit.md), two passes: (1) FR4 probe ledger, FR7 commit-on-failure step, FR1 failure-path commit, new acceptance criterion; (2) FR4 success-frees-the-tick semantics (the probe ledger is the mechanism, the ceilings map stays read-only), FR9 drops the stale floor class (no staleness policy — self-healing via FR3, byte-stable file)"
---

# FRD: Provider health circuit — remember dead LLM accounts across ticks, unify failure alarms, de-duplicate outage emails

## Summary

Add a provider-health circuit to the LLM judge pool: per-account health marks persist across 10-minute ticks in a new committed state file, an account that hard-fails (server/network errors, not 429s) in 2 consecutive runs gets its ceiling capped at 1 (half-open circuit: one real request per tick proves recovery), failure alarms carry each account's real cause instead of a hardcoded "HTTP 429", all-dead pools always alarm (429 and 503 flavors unified), outage emails fire once per episode instead of every tick, and digest/heartbeat emails carry one degraded-accounts line. Motivated by run 42315079264: nube-api 503s every request and openrouter 429s every request, and nothing about that is remembered between ticks.

## Problem & Intent

Developer framing, verbatim: "based on condition above, is there anything we can do to make it more reliable and stable" — and on what success looks like: "i want to know what is best practice for this kind of work". The condition: the dispatch run of 2026-11-07 (run 42315079264) failed with the designed exhaustion alarm because 2 of 3 LLM accounts were dead (nube-api HTTP 503 on every request, openrouter HTTP 429 on every request); only z.ai answered. The probe analysis then showed the deeper gaps: dead providers are re-discovered from scratch every tick, a 503ing account burns 4 requests per affected batch every run without ever cooling, a 503-only pool exits 0 silently forever, and the alarm text can never name anything but "HTTP 429". The developer wants the industry-standard resilience pattern (circuit breaker with health memory, honest alarms, episode-based alerting) applied to this pipeline.

## Goals

- Dead providers cost almost nothing: an account that keeps hard-failing stops receiving full traffic within ~2 ticks and costs at most 1 request per tick afterwards.
- Silence is trustworthy: when the run exits 0, the pool was genuinely usable; any all-accounts-dead situation alarms regardless of failure flavor (429 or 503 or transport).
- One outage, one email: a multi-hour provider outage produces a single alarm, not one per 10-minute tick.
- Alarms diagnose: the email names each dead account with its actual status code and remedy hint.
- Degradation is visible without being noisy: while any account is capped, every digest/heartbeat email says so in one line.
- Follow repo best practice: the health state uses the same committed-state-file doctrine the ceilings file already established.

## Non-Goals

- No automatic account replacement or secret rotation — a dead key still needs a human to fix or remove it.
- No re-litigation of the settled spread design (dispatch dial, per-account ceilings, zero-charge ceiling waits — see Dead-Ends in the solutions artifact referenced below).
- No new runtime dependency for health tracking (repo rule: stated need required for new deps).
- No changes to the probe's gate semantics — the probe keeps walking every account and keeps failing on auth-dead keys.
- No cross-run persistence for the 429 cooldown itself — in-run 60s cooldowns stay run-local; only hard-failure health marks persist.

## Functional Requirements

1. The system SHALL persist per-account hard-failure health marks to a new committed state file (default `state/judge-health.json`), written atomically by the watch run and committed back by the existing Commit state step's file set, following the single-writer doctrine of `state/judge-ceilings.json`. Because an exhausted run exits 1 before the Commit state step runs, the workflow SHALL also carry a dedicated commit step for the health file that runs on the failure path (`if: always() && failure()`), so marks and the episode bit written by an all-dead run still reach `main`.
2. The system SHALL treat a run as a failed tick for an account when the account received dispatches and every one of them failed with server errors (5xx), transport errors, or auth-dead statuses (401/403); HTTP 429 and content-parse failures SHALL NOT count toward health marks.
3. The system SHALL cap an account's usable ceiling at 1 once it has 2 consecutive failed ticks, and SHALL restore its full committed ceiling on the first successful dispatch in any later tick.
4. The cap SHALL be implemented at the pick boundary as a per-tick probe ledger on the rotation state (`probedThisTick`): a health-marked account is dispatchable for exactly one dispatch per tick — the half-open probe — and the ceilings map itself is never written at run time (its doctrine, `src/judge-rotation.ts:58-60`, is read-only; the Σ-ceilings pool width keeps using committed ceilings). A probe that SUCCEEDS clears the mark in-run: the account rejoins with its committed ceiling for the rest of the tick — bulk tail and fallback pool included (FR3's success-clears at request granularity). A probe that hard-fails leaves the mark standing: the account stays skipped until the next tick, and that failed probe is the countable dispatch feeding the next tick's mark (FR2). The ledger resets naturally because the rotation state is per-`judgePosts` call, which is per tick.
5. When the pick is undefined because every account is blocked, the run SHALL convert to the exhaustion terminal with the real per-account cause for both flavors: 429-cooled accounts AND accounts whose last dispatch failed with 5xx/transport/auth errors — a 503-only pool SHALL alarm and exit 1 exactly like a 429-only pool.
6. The exhaustion alarm email SHALL list each dead account with its actual last failure (status code or error class, e.g. "HTTP 503", "HTTP 429", "network error", "HTTP 401 — key dead") instead of the hardcoded "HTTP 429".
7. Alarm emails SHALL be de-duplicated per outage episode: the first all-dead run emails; subsequent all-dead runs stay silent; the episode ends (and the next all-dead run may email again) only after a run completes with at least one healthy dispatch. The episode marker SHALL live in the health state file (the LinkedIn leg-dead episode-marker precedent). An exhausted run SHALL persist its marks and set the episode bit before exiting, and the workflow's failure-path commit step SHALL carry that write to `main` — without it the first all-dead run's bit is lost at workspace teardown and every later all-dead run re-alarms.
8. While any account is health-capped, the digest and heartbeat emails SHALL carry one line naming the capped accounts (e.g. "judge: 1 of 3 accounts degraded (nube-api: 2 failed ticks)").
9. The health file SHALL degrade never-throws on read: absent or malformed marks floor to "all healthy" with at most a warning — it must never fail a run (the ceilings-reader doctrine). Deliberately no staleness policy: a stale mark costs at most the one-request probe per tick until FR3's success-clears heals it, and no timestamp keeps the file byte-stable (no tick mints a no-op commit).
10. The probe job SHALL NOT read or write health marks; the probe stays a live gate. (A green probe indirectly clears marks at the next tick via requirement 3's success-clears rule only if the watch dispatches to that account — the file itself is watch-owned.)

## Non-Functional Requirements

- **Performance**: negligible — one extra JSON read per run at the judge-stage boundary; capped accounts add ≤1 request per dead account per tick (vs 4 per batch today).
- **Security**: no new secrets; health data is status codes and timestamps only. Committed state stays within the existing Commit state step's write path.
- **UX / Accessibility**: alarm and digest copy stays plain text; each capped/dead account named with host + cause + remedy hint, matching the existing email voice.
- **Reliability**: the health reader never throws (absent/malformed → all-healthy + one warning); state writes stay atomic (temp + rename); alarm de-dup must not suppress a NEW episode's alarm after recovery.

## Constraints & Assumptions

- Node >= 22, ESM, strict TS flags stay on; no new runtime dependency.
- The health file joins the committed state file set — the Commit state step's file set and `scripts/commit-state-rebase.sh`'s skip-set must grow from two files to three (precedent: the ceilings-file generalization of 2026-11-06), and a failure-path commit step must exist for the exhausted-run case.
- Assumption: per-run dispatch volume is small enough that "every dispatch failed" is a sound per-account failure signal (typically ≤ a few requests per account per tick once capped; ≤ 4 per batch while uncapped).
- Assumption: 429s indicate quota pressure (busy, recovers on its own via the existing cooldown), while repeated 5xx/transport/401 indicate a dead provider — this split is the health signal.
- The 8-minute watch job cap is untouched; the capped-pool path adds no waits.

## Acceptance Criteria

- [ ] With a permanently-503ing mock endpoint in a 2-account pool, offline tests show: tick 1 full traffic, tick 2 caps it to ceiling 1 (≤1 request), tick 3+ receives exactly 1 request per tick, and one success restores the committed ceiling.
- [ ] A 503-only pool run exits 1 with an exhaustion alarm whose email text names "HTTP 503" per account (no "HTTP 429" mislabel).
- [ ] An all-dead run persists its marks and episode bit to the health file before exiting 1, and the workflow's failure-path commit step commits that delta (the second all-dead run stays silent).
- [ ] Two consecutive all-dead mock runs produce exactly one alarm email; a healthy run in between resets the episode and the next all-dead run emails again.
- [ ] An all-429 pool run still exhausts exactly as today (existing suite green) — 429s never create or clear health marks.
- [ ] Absent/corrupt `state/judge-health.json` floors to all-healthy with one warning and `npm test` proves it never fails a run.
- [ ] Digest/heartbeat email bodies contain the degraded-accounts line iff at least one account is capped.
- [ ] `npm run typecheck && npm run lint && npm test` green; retirement/scope greps show `state/judge-health.json` named in config, guidance docs, README, and the Commit state file-set/skip-set.

## Recommended Approach

New `src/judge-health.ts` module (the `src/judge-ceilings.ts` shape: never-throwing reader + atomic writer + pure resolver, warnings returned) plus a `state/judge-health.json` committed file owned by the watch run; the judge stage merges effective ceilings as `min(ceiling, healthCap)` at the `judgePosts` boundary; `judge-rotation.ts` grows the real-cause failure record and the unified exhaustion terminal; `src/email.ts` carries per-account real causes, the episode marker check, and the degraded line; `watch.yml`'s Commit state file-set and the commit-back skip-set grow to three files.

## Decisions

### Remember account health across ticks
**Question**: Every tick re-discovers dead accounts from scratch — a 503ing endpoint burns 4 requests per affected batch every 10 minutes. Keep this, or change it?
**Recommended**: Remember health
**Chosen**: Remember health
**Rationale**: evidence: src/judge.ts:441-449 + confirmed ( RotationState is run-local at src/judge.ts:735-742; nothing persists failure knowledge).

### Alarm carries the real cause
**Question**: The exhaustion alarm's reason is hardcoded "HTTP 429" (src/judge-rotation.ts:243-250) — yesterday's failure email could never say "503". Keep, or change?
**Recommended**: Carry real cause
**Chosen**: Carry real cause
**Rationale**: evidence: src/judge-rotation.ts:243-250 + confirmed.

### Unify failure handling across 429/503 flavors
**Question**: An all-429 pool alarms and exits 1, but an all-503 pool exits 0 silently every tick (src/judge-rotation.ts:195-228). Keep, or unify?
**Recommended**: Unify
**Chosen**: Unify
**Rationale**: evidence: src/judge-rotation.ts:195-228 + confirmed (cooldowns are the only exhaustion path today, and only 429 stamps them — src/judge.ts:421-423).

### Health lives in a committed state file
**Question**: Where should account health live?
**Recommended**: Committed state file
**Chosen**: Committed state file (single-writer doctrine like `state/judge-ceilings.json`)
**Rationale**: evidence: src/config.ts:74 + confirmed.

### Half-open circuit: cap at 1, not skip
**Question**: How should a health-marked account be treated by the judge?
**Recommended**: Cap at 1
**Chosen**: Cap at 1
**Rationale**: one real request per tick auto-recovers a healed provider with zero extra machinery; skipping entirely needs a separate re-probe rule. Precedent: the pick already reads per-account ceilings (src/judge-rotation.ts:114-115).

### One alarm per outage episode
**Question**: All-dead runs alarm every 10 minutes during an outage. De-duplicate?
**Recommended**: One per episode
**Chosen**: One per episode
**Rationale**: repo precedent for episode markers exists (scripts/fetch-linkedin.ts `handleLegDeadEpisode` — one alarm per episode via repo-local marker).

### Mark threshold: 2 consecutive failed ticks
**Question**: How many consecutive failed ticks (every dispatch hard-failed: 5xx/transport/401 — 429 excluded) before capping an account at ceiling 1?
**Recommended**: 2 failed ticks
**Chosen**: 2 failed ticks
**Rationale**: one bad tick can be a blip; two in a row is a pattern.

### Un-marking: success clears
**Question**: How does a capped account regain its full ceiling?
**Recommended**: Success clears
**Chosen**: Success clears (the cap-at-1 request is the probe; first success restores the committed ceiling; a green probe does not directly edit the file)
**Rationale**: keeps the health file single-writer (watch job only) and self-healing without new machinery.

### Degraded visibility: one line in emails
**Question**: How visible should a degraded pool be?
**Recommended**: One line in emails
**Chosen**: One line in digest/heartbeat emails
**Rationale**: matches the heartbeat's existing funnel-summary voice (src/heartbeat.ts:150-190); costs nothing when healthy.

## Open Questions

None — every interview node resolved as a Decision or landed in Functional Requirements.

## Suggested Follow-ups

- `classifyDead` (scripts/probe-judge.ts:164-177) does not treat persistent 503s as a dead-account signal — a 503ing provider commits ceiling 1 and the probe exits 0. Left out of scope; the health circuit now handles 503s at the watch layer.
- The exhaustion email's failure record could also list the post ids deferred wholesale per account (src/email.ts:181-197) — declined for now; skipped posts are already re-judged next tick.
- LinkedIn payload staleness (run 42315079264 logged "payload stale (22h old) — threads-only run") is unrelated to provider health — the PC loop simply wasn't running.

## References

- Trigger condition: watch run 42315079264 (2026-11-06T23:56Z) — probe green, watch failed with exhaustion alarm; nube-api 503 on all legs, openrouter 429 on all legs, z.ai ceiling 4.
- Validation report for the shipped spread feature: `.rpiv/artifacts/validation/2026-11-07_06-44-20_llm-account-spread-judge.md`
- Prior FRD (spread design, settled — do not re-litigate): `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md`
- Solutions artifact (dead-ends ledger): `.rpiv/artifacts/solutions/2026-11-06_11-05-39_llm-account-spread-judge.md`
- Probe evidence file: `.rpiv/artifacts/plans/2026-11-06_18-36-57_llm-account-spread-judge.md` (Phase 5 context)
