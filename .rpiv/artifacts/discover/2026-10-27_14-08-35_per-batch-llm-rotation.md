---
date: 2026-10-27T14:08:35+0700
author: Yogiswara Utama
commit: 6b9dae4
branch: main
repository: loker-watcher
topic: "per-batch LLM account rotation"
tags: [intent, frd, judge, rotation, probe]
status: ready
last_updated: 2026-10-27T14:08:35+0700
last_updated_by: Yogiswara Utama
---

# FRD: per-batch LLM account rotation

## Summary
Replace the run-sticky account rotation in the LLM judge with per-batch rotation: every batch and single-post call starts again at the first pool entry, a 429'd account is skipped for a flat 60-second cooldown, and the run waits out cooldowns (up to a 5-minute budget) instead of dying. When the budget is spent, today's fail-visible contract holds: one alarm email, exit 1. The probe job extends to check every account in the pool.

## Problem & Intent
The operator's success definition, verbatim: **"Runs never give up"** — every 10-minute run finishes the judge step, riding out rate limits until all unseen posts are judged.

Underlying motivation from the 2026-10-27 failure (GitHub Actions run 40463798717): the first 429 moved the whole run to account 2 permanently; both accounts then refused, and the run died with 327 posts unjudged. The z.ai account is shared with the operator's daily assistant, so minutes-scale 429s are routine and must be absorbed, not fatal. The pool itself must stay free-form: "this would be dynamic. as i can add or remove provider freely."

## Goals
- Every 10-minute run rides out transient rate limits and judges the full unseen backlog.
- A 429 costs the account 60 seconds, not the rest of the run.
- Pool membership and order are defined only by the LLM_ACCOUNTS JSON list; providers can be added or removed by editing the secret.
- Failures that are real (budget spent) still alarm loudly and exit 1.

## Non-Goals
- No dedicated or second z.ai key — "even second key will be exhausted. as long as still the same account" (quota is per-account). Contention is absorbed by rotation instead.
- No new providers, accounts, or subscriptions in this feature.
- No silent deferral: the run does not quietly finish while posts stay unjudged.
- No change to state semantics: deferred/unjudged posts stay unseen and are re-judged next run.

## Functional Requirements
1. Per-batch restart: For every bulk batch and every single-post fallback call, the system SHALL start account selection at the first LLM_ACCOUNTS entry and walk entries in list order, skipping accounts in cooldown. The run-sticky shared pointer (`src/judge.ts:431`, `:543`) is replaced by a batch-local cursor plus a shared cooldown map.
2. Flat 60s cooldown: On HTTP 429 from an account, the system SHALL skip that account for 60 seconds and retry the same call on the next eligible account without spending a retry attempt.
3. All-cooling wait: When every account is in cooldown, the system SHALL wait until the earliest cooldown expiry (jittered to avoid synchronized re-dispatch) and retry, counting all cooldown waiting against a 5-minute total in-run budget.
4. Budget exhausted: When the 5-minute wait budget is spent or accounts are permanently refused, the system SHALL throw `RotationExhausted` carrying the complete per-account failure record; `src/index.ts:296-313` sends one alarm email and exits 1 — unchanged.
5. Probe all accounts: `scripts/probe-judge.ts` (currently first-account-only, `:163-167`) SHALL probe every account in LLM_ACCOUNTS, report per-account latency and refusal, and exit nonzero when any account is unusable.
6. Tests: The suite SHALL rewrite the four run-sticky pins (`tests/judge.test.ts:282-301`, `:854-864`, `:866-895`, `:934-974`) to pin per-batch restart + cooldown behavior, and add coverage for cooldown skip, all-cooling wait (fake clock, zero real delay), budget-exceeded alarm path, and per-account probe.

## Non-Functional Requirements
- **Performance**: Total in-run cooldown waiting capped at 5 minutes; fetch (~75s) + judge + email + commit fits the 10-minute cadence. Normal (no-429) runs keep today's latency.
- **Security**: No new secrets or env vars; the pool stays inside the LLM_ACCOUNTS Actions secret; keys never appear in logs.
- **UX / Accessibility**: Headless pipeline; the operator-facing failure stays one alarm email naming each account and its reason.
- **Reliability**: Fail-visible preserved; no silent deferral; a cooling account recovers automatically after 60s; tests stay offline and deterministic via an injectable clock/sleep.

## Constraints & Assumptions
- Pool membership and order live only in the LLM_ACCOUNTS JSON (`src/judge.ts:132-170`); add/remove providers is a secret edit, no code change.
- Strict TypeScript flags stay on; Node >= 22, ESM; no new runtime dependencies.
- State-write atomicity and the defer-unanswered-batches rule are untouched.
- Assumption: transient rate limits are seconds-to-minutes scale (per-minute caps, busy periods), so 60s cooldowns plus a 5-minute budget outlast them. Daily-cap exhaustion (OpenRouter free tier) still ends in alarm — accepted.

## Acceptance Criteria
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm test` exits 0, including the four rewritten rotation tests.
- [ ] A unit test with a fake clock shows account 1 429 in batch N and batch N+1 (60s later) using account 1 again — per-batch restart.
- [ ] A unit test shows all accounts cooling, the runner waiting to the earliest expiry with zero real time elapsed, and the backlog completing.
- [ ] A unit test shows the 5-minute budget exceeded → `RotationExhausted` with per-account failures → `sendExhaustionEmail` once → exit 1.
- [ ] The probe prints one line per account and exits 1 when one of two mock accounts is refused.

## Recommended Approach
Replace the shared rotation pointer in `src/judge.ts` with a batch-local cursor plus a shared per-account `cooldownUntil` map (now + 60s on 429, jittered expiry), an injectable `now`/`sleep` for deterministic tests, and a 5-minute wait budget in the `judgePosts` frame; `scripts/probe-judge.ts` iterates all accounts. The exhaustion contract (`RotationExhausted` → one alarm email → exit 1) is unchanged.

## Decisions

### Success definition
**Question**: "As the operator, what does success look like when both LLM accounts hit rate limits?"
**Recommended**: n/a — `intent` question
**Chosen**: "Runs never give up" — every run finishes the judge step, riding out rate limits until all unseen posts are judged.
**Rationale**: n/a — `intent` question, captured verbatim.

### Last-resort alarm contract
**Question**: "When every account is dead for the whole run, keep one alarm email + exit 1 as the last resort?"
**Recommended**: Keep alarm + exit 1.
**Chosen**: Keep alarm + exit 1.
**Rationale**: evidence: src/index.ts:296-313 + confirmed; fail-visible is a repo non-negotiable.

### Dedicated z.ai key
**Question**: "Where should the watcher-only z.ai key live?"
**Recommended**: Add a new key as one more entry in LLM_ACCOUNTS.
**Chosen**: Dropped entirely — developer correction: "no. even second key will be exhausted. as long as still the same account."
**Rationale**: z.ai quota is per-account, not per-key; contention is absorbed by rotation instead.

### Pool shape and ordering
**Question**: "With per-batch rotation, which order should the pool have?"
**Recommended**: OpenRouter first, z.ai last.
**Chosen**: Dynamic — rotation walks the LLM_ACCOUNTS list in list order; providers are added or removed freely; no provider is hardcoded.
**Rationale**: developer: "this would be dynamic. as i can add or remove provider freely" + evidence: src/judge.ts:132-170.

### Test rewrite
**Question**: "Four tests pin run-sticky rotation; they will fail after the change. Rewrite them as part of this work?"
**Recommended**: Rewrite all four.
**Chosen**: Rewrite all four.
**Rationale**: evidence: tests/judge.test.ts:854-864, 866-895, 934-974, 282-301 pin the replaced behavior + confirmed.

### All-cooling semantics
**Question**: "All accounts cooling at once — what should the run do?"
**Recommended**: Wait, then alarm.
**Chosen**: Wait out the earliest expiry up to the budget, then alarm + exit 1.
**Rationale**: matches intent ("runs never give up"); silent deferral rejected per evidence: src/judge.ts:689-694.

### Cooldown duration
**Question**: "How long should a 429'd account be skipped?"
**Recommended**: Escalate 30/60/120s per repeated 429.
**Chosen**: Flat 60s.
**Rationale**: developer picked the simpler, predictable cadence over escalation.

### In-run wait budget
**Question**: "Total time the run may spend waiting out cooldowns before it alarms?"
**Recommended**: 5 minutes.
**Chosen**: 5 minutes.
**Rationale**: fits the 10-minute schedule with margin (fetch ~75s + email + state commit).

### Probe scope
**Question**: "Should the pre-flight probe job ping every account in LLM_ACCOUNTS?"
**Recommended**: Ping all accounts.
**Chosen**: Ping all accounts.
**Rationale**: the pool is free-form, so account 1's health no longer represents the pool; evidence: scripts/probe-judge.ts:163-167 + confirmed.

## Open Questions
None — every branch resolved during the interview.

## Suggested Follow-ups
- OpenRouter free-tier models carry daily request caps; as a frequent first pool entry it can be dead for hours — credits or reordering is an ops choice, no code change.
- `recommended JUDGE_CONCURRENCY = Math.max(4, ceiling)` prints 4 even when every probe call is refused — `scripts/probe-judge.ts:195`.
- Both provider keys were pasted in plaintext chat on 2026-10-27 — rotate them at the providers.

## References
- GitHub Actions run 40463798717 (both jobs failed; z.ai 429 under shared-key contention)
- `.rpiv/artifacts/discover/2026-10-26_14-27-50_llm-account-rotation.md` (prior rotation design)
- Probe agent report + rotation lifecycle analysis, this session (2026-10-27)
