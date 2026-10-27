---
date: 2026-10-26T14:27:50+0700
author: Yogiswara Utama
commit: 399181b
branch: ukind/fix-hit-limit
repository: fix-hit-limit
topic: "LLM account rotation on rate limit"
tags: [intent, frd, judge, config, rotation, rate-limit]
status: ready
last_updated: 2026-10-26T14:27:50+0700
last_updated_by: Yogiswara Utama
---

# FRD: LLM account rotation on rate limit

## Summary
The judge stage gains a pool of OpenAI-compatible accounts instead of one. Any HTTP 429 immediately retries the failing call against the next account, and the run stays on that account until it rate-limits too. When every account is exhausted, the run sends one notification email listing each account's error and exits nonzero.

## Problem & Intent
The developer's framing, verbatim: "if the LLM in open ai compatibleity hit its limit, the whole operation is stopped, i have the other account to backup, so if account 1 is hit limit or 429 error, rotate to account 2, and so on".

Asked what a failed run costs today, the developer answered: "i want the service to reliable". The judge stage currently holds exactly one account (src/judge.ts resolveJudgeConfig), so a sustained 429 spends its 3-retry backoff on the same key and then defers whole batches to the next 10-minute run.

## Goals
- A rate limit on one account never stops the run while another account still has quota.
- The run fails loudly, with an email, only when every account is exhausted.
- Accounts are configured in one place (one secret), validated at startup, fail-visible.

## Non-Goals
- No cross-run memory of the account pointer: each run starts at account 1 (follows the stickiness decision — the account "returns on the next scheduled run").
- No cooldown timers or quota bookkeeping per account.
- No new runtime dependency: rotation rides the existing global-fetch chat-completions path.
- No change to BATCH_SIZE (10), JUDGE_CONCURRENCY (4), REQUEST_TIMEOUT_MS (60s), or the defer-on-transport-error semantics.
- No change to the single-post fallback payload shape (existing design scope boundary).

## Functional Requirements
1. The system SHALL read one environment secret `LLM_ACCOUNTS` at startup, parsed as a JSON array of `{baseUrl, apiKey, model}` objects in rotation order. A missing, blank, malformed, or empty-array value SHALL exit nonzero with an error naming `LLM_ACCOUNTS`.
2. The system SHALL remove `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` from src/config.ts, src/judge.ts, .github/workflows/watch.yml, and scripts/probe-judge.ts — `LLM_ACCOUNTS` is the only source of LLM configuration.
3. On any HTTP 429 response, the system SHALL immediately retry the same call against the next account in the pool, with no backoff wait; the retry carries that account's baseUrl, apiKey, and model.
4. The rotation pointer SHALL be run-level and sticky: after a failover to account N, subsequent calls in the same run start at account N; the pointer advances only on another 429; each run starts at account 1.
5. HTTP 500/502/503/504 SHALL keep the existing 1s/2s/4s backoff retries on the current account without rotating; a transport error SHALL defer the batch immediately without rotating (existing semantics).
6. When a call has failed on every account in the pool, the system SHALL stop the judge stage, send one exhaustion-notification email via the existing Gmail transport listing each account index with its last HTTP status or error class, and exit nonzero. Unjudged posts stay unseen and retry next run.
7. Judge log lines SHALL name the account number for calls, retries, rotations, and exhaustion (for example "account 2 HTTP 429").
8. scripts/probe-judge.ts SHALL read `LLM_ACCOUNTS` and probe using account 1.
9. README.md SHALL document the `LLM_ACCOUNTS` secret and the rotation behavior in place of the old three variables.

## Non-Functional Requirements
- **Performance**: rotation adds zero backoff delay on 429 (immediate retry); worst case per call is one attempt per account.
- **Security**: all accounts live in the single `LLM_ACCOUNTS` GitHub Actions secret; keys never appear in logs or the repo.
- **UX / Accessibility**: the exhaustion email is plain text and names each account's failure so the developer can act without reading Actions logs.
- **Reliability**: fail-visible throughout — config errors exit nonzero naming `LLM_ACCOUNTS`; pool exhaustion emails then exits nonzero; state writes stay atomic; unjudged posts remain unseen.

## Constraints & Assumptions
- Node >= 22, ESM, strict TypeScript flags stay on (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- Tests stay offline: mocked `fetch`, no network (node:test + tsx).
- All OpenAI-compatible accounts expose the same `/chat/completions` contract; accounts MAY differ in provider (each carries its own baseUrl/model).
- Assumption: the run-level pointer shared by concurrent JUDGE_CONCURRENCY workers needs no lock (single-threaded event loop; pointer read-advance is sequential per worker iteration).

## Acceptance Criteria
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm test` exits 0, including new tests proving: a 429 on account 1 retries the same call on account 2 (mock fetch records both attempts, second carries account 2's key); the pointer is sticky (the following batch never touches account 1); pool exhaustion sends exactly one exhaustion email and the run exits nonzero; missing or malformed `LLM_ACCOUNTS` throws naming `LLM_ACCOUNTS`.
- [ ] `.github/workflows/watch.yml` references `LLM_ACCOUNTS` and no longer references `LLM_API_KEY`, `LLM_BASE_URL`, or `LLM_MODEL`.
- [ ] `grep -r "LLM_API_KEY\|LLM_BASE_URL\|LLM_MODEL" src/ scripts/ .github/` returns no matches.
- [ ] A dry run with a deliberately dead account 1 and live account 2 completes the digest end to end.

## Recommended Approach
Extend `resolveJudgeConfig` in src/judge.ts (with the `LLM_ACCOUNTS` name added to ENV_NAMES in src/config.ts) to return an ordered account pool, thread the pool through `judgeBatch`/`judgePost` behind a shared run-level pointer that advances on 429, send the exhaustion notification through the existing nodemailer transport in src/email.ts, and swap the secret wiring in .github/workflows/watch.yml, scripts/probe-judge.ts, and README.md.

## Decisions

### Rotation trigger — first 429
**Question**: The code already retries 429 (plus 500/502/503/504) with backoff on the same key (src/judge.ts:48). What should make the run switch to the next account?
**Recommended**: Spend the existing 1s/2s/4s backoff on account 1 first.
**Chosen**: First 429 rotates — the failing call is immediately retried against the next account, no backoff wait.
**Rationale**: Developer picked fastest recovery; 5xx keeps the existing backoff on the current account, transport errors still defer immediately. evidence: src/judge.ts:48 + chosen.

### All accounts exhausted
**Question**: Today an unanswered batch is deferred whole — posts stay unseen and the next run retries them. When ALL accounts are exhausted, keep that?
**Recommended**: Keep defer-and-retry.
**Chosen**: Fail the run AND send one notification email listing every account's error and HTTP code.
**Rationale**: Developer wants loud failure with an actionable email when the whole pool is dead; matches the project's fail-visible rule.

### Account configuration
**Question**: How should the backup accounts be added, given the current flow is three env secrets?
**Recommended**: One JSON secret.
**Chosen**: One JSON secret `LLM_ACCOUNTS`, array of `{baseUrl, apiKey, model}` in rotation order, validated fail-visible at startup; the old three variables are removed entirely.
**Rationale**: Developer picked the JSON secret after seeing the current flow; removal keeps one source of truth with no silent fallback path.

### Rotation stickiness
**Question**: After a failover to account 2, where does the next judge call in the same run start?
**Recommended**: Stay on account 2.
**Chosen**: Stay on account 2 — run-level sticky pointer; account 1 returns on the next scheduled run.
**Rationale**: Developer confirmed; protects exhausted account 1 from repeat 429 round-trips while the limit holds.

### Log lines name the account
**Question**: Should judge log lines say which account they used or failed on?
**Recommended**: Name the account.
**Chosen**: Name the account (for example "account 2 HTTP 429").
**Rationale**: Rotation becomes visible in Actions logs at zero cost.

### Probe script follows the config swap
**Question**: scripts/probe-judge.ts also reads the old LLM_* vars. Update it in this change?
**Recommended**: Update probe.
**Chosen**: Update probe to read `LLM_ACCOUNTS` and probe with account 1.
**Rationale**: Leaving it broken would fail the workflow's probe step the moment the secrets swap.

## Open Questions
None — every branch resolved during the interview.

## Suggested Follow-ups
- The single-post fallback judgePost retries on ANY non-OK status without status distinction or backoff (src/judge.ts, judgePost) — this feature threads rotation through it but does not retune its retry semantics.
- scripts/probe-judge.ts's concurrency ramp could additionally report per-account 429 thresholds once the pool exists (observed during probe; not requested).

## References
- Interview input: free-text feature description (this invocation)
- src/judge.ts — judge pipeline, retry/backoff, single-account config
- src/config.ts:19 — ENV_NAMES with LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
- .github/workflows/watch.yml — secret wiring for probe and watch jobs
- scripts/probe-judge.ts — latency/concurrency probe reading LLM_* vars
- .rpiv/artifacts/discover/2026-10-25_21-20-20_model-judged-keywords.md — prior FRD for the judge stage
