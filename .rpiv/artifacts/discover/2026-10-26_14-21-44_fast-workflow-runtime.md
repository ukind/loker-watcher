---
date: 2026-10-26T14:21:44+0700
author: Yogiswara Utama
commit: 399181b
branch: main
repository: loker-watcher
topic: "fast-workflow-runtime"
tags: [intent, frd, judge, watch-yml, fetch-threads, state, performance]
status: ready
last_updated: 2026-10-26T14:21:44+0700
last_updated_by: Yogiswara Utama
---

# FRD: Fast Workflow Runtime at Growing Post Volume

## Summary
Keep the scheduled watch run comfortably under the 10-minute cron interval as Threads post volume grows, by parallelizing the three serial stages (LLM judging, fallback judging, surface fetching), caching the Playwright browser between runs, and closing the re-judging loop so no judged post is ever sent to the LLM twice within the recency window. Tighten the job kill-switch from 45 to 8 minutes once the fast paths land, and add per-stage timing logs so the next slowdown is visible in the run log.

## Problem & Intent
The developer's words: "the runtime is takes quite long, longer than 10 minutes. it should be not and very optimized workflow" — and, on the recency window: "keep 72h, but we need another solution so the same post is not feeded to the LLM".

The pipeline runs every 10 minutes from GitHub Actions. As candidate volume grows, three serial costs scale: the judge drains batches through a pool of only 4 workers; unusable bulk verdicts trigger strictly sequential per-post fallback calls; and surfaces load one after another with fixed waits. A run that crosses 10 minutes makes GitHub drop subsequent cron triggers, so digests arrive late and the backlog is self-sustaining. Separately, zero-match runs persist nothing (the FRD #9 match-gate), so the same irrelevant posts are re-judged every 10 minutes for their entire 72-hour window — a known, already-documented gap (solutions/2026-10-26_06-15-51_model-judged-keywords.md:146) that this feature closes.

## Goals
- A full run completes well under the 10-minute cron interval at today's worst documented volume (283 posts) and stays under it as volume grows.
- No judged post is ever fed to the LLM twice within the 72-hour recency window — relevant, irrelevant, or zero-match run.
- Fixed per-run cost drops: surfaces load concurrently; the Chromium download is cached between runs.
- Run-away failure modes are bounded: the fallback path has a cap, the job has an 8-minute kill switch.
- Slowdowns are diagnosable from the run log via per-stage durations.

## Non-Goals
- No change to the cron schedule (stays */10).
- No change to the LLM endpoint, model, or judge prompt/criteria.
- No change to which posts count as a match (keywords, 72h recencyHours, verdict semantics).
- No new services, queues, or external persistence — state stays in `state/seen-posts.json`.
- No change to email-before-state ordering or atomic state writes.

## Functional Requirements
1. The system SHALL run bulk judge calls with a concurrency read from configuration (env var, mirroring `ENV_NAMES` conventions), defaulting to the probe-measured ceiling rather than the hard-coded 4 (`src/judge.ts:45`).
2. The system SHALL run single-post fallback calls concurrently instead of sequentially, with an explicit per-run cap on fallback calls; posts beyond the cap stay unseen and retry next run (existing D3 semantics).
3. The system SHALL fetch surfaces concurrently (bounded parallel pages, one browser instance) in both authenticated and logged-out paths, preserving per-surface extraction order for logs.
4. The system SHALL persist every successfully judged post id — relevant or not — on every run, including zero-match runs. This reverses FRD #9's match-gate; the email-before-state ordering is untouched.
5. The state schema SHALL advance to version 2 storing id plus first-seen timestamp, with load-time pruning of entries older than the recency window, so state size stays bounded.
6. The workflow SHALL cache the Playwright Chromium install keyed on the lockfile, re-downloading only on version change.
7. The workflow SHALL set `timeout-minutes` to 8 on the watch job once the above land (down from 45).
8. Each pipeline stage SHALL log its duration alongside counts (e.g. `judge: 41 post(s) in 38s`).

## Non-Functional Requirements
- **Performance**: judge stage wall time scales as ceil(batches / concurrency) × latency instead of ceil(batches / 4) × latency; fetch stage wall time approaches the slowest single surface instead of the sum of all surfaces.
- **Security**: no new secrets; concurrency env var joins `ENV_NAMES` with step-scoped injection in watch.yml; browser cache stores no credentials.
- **UX / Accessibility**: no user-facing surface changes; digest and heartbeat content unchanged except that judged-irrelevant posts drain out of the judged-candidates funnel stats.
- **Reliability**: state writes stay atomic (temp + rename); a killed run (8-min ceiling) leaves state untouched and posts unseen for natural retry; 429/5xx backoff behavior unchanged; the 429 backoff still protects an optimistic concurrency value.

## Constraints & Assumptions
- Node >= 22, ESM, strict TS flags stay on; no new runtime dependency without stated PR need.
- The probe (`scripts/probe-judge.ts`, ramp [2, 4, 8, 16]) is the authority for the concurrency ceiling; the value it reads is what ships as the default.
- Assumption: the endpoint tolerates 8+ concurrent bulk calls (probe verifies; 429 backoff is the safety net).
- Assumption: Threads tolerates ~4-8 concurrent page loads from one browser session without rate-limiting the session cookie (verify in design/research; if not, cap parallel pages lower).
- Zero-match runs will now produce state commits (bot commits are greppable and count as repo activity, which also helps the 60-day cron auto-disable).
- The concurrency group `watch` with `cancel-in-progress: false` stays: runs queue, never overlap.

## Acceptance Criteria
- [ ] A manual `workflow_dispatch` watch run at documented worst-case volume completes end-to-end in under 8 minutes (GitHub run duration visible on the run page).
- [ ] The probe run prints the measured concurrency ceiling; the shipped default equals that reading and the constant's comment cites the run that measured it.
- [ ] A second consecutive run over the same feed makes zero LLM calls for previously judged posts (mocked fetch count is 0 for known ids in a unit test) while still judging genuinely new posts.
- [ ] A zero-match run that judged new candidates produces a state commit; a zero-match run with zero new candidates produces none (byte-identical state, `git diff --cached --quiet` holds).
- [ ] The run log contains one duration line per stage (fetch, judge, email) on every run.
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` all pass; existing state-gate tests are updated to the new persistence contract, not deleted.

## Recommended Approach
Tune the existing seams rather than add stages: env-tunable `JUDGE_CONCURRENCY` plus a concurrent, capped fallback pool in `src/judge.ts`; concurrent surface loading in `src/fetch-threads.ts`; state schema v2 (id + firstSeenAt, pruned at load) with unconditional post-judge persistence in `src/index.ts`/`src/state.ts`; watch.yml gains an `actions/cache` step for Playwright and an 8-minute timeout. Per-stage timing wraps the existing stage logs in `src/index.ts`.

## Decisions

### D1 — Probe-driven judge concurrency
**Question**: The judge runs only 4 LLM calls at once (src/judge.ts:45), and the code's own comment says to raise it to the probe-measured ceiling. Make concurrency probe-driven?
**Recommended**: Probe-driven ceiling — set from what scripts/probe-judge.ts measures (8 or 16).
**Chosen**: Probe-driven ceiling.
**Rationale**: judge wall time drops 2-4x; 429 backoff protects an optimistic value. evidence: src/judge.ts:43-45 + scripts/probe-judge.ts:150 + confirmed.

### D2 — Parallelize and cap the fallback path
**Question**: When a bulk verdict is unusable, posts are re-judged one-by-one, serially (src/judge.ts:466-471) — 200 posts can mean 400 sequential calls. Change this?
**Recommended**: Parallelize + cap.
**Chosen**: Parallelize + cap.
**Rationale**: the degenerate path (serial fallbacks, 60s timeout each) is the only unbounded cost left; capping bounds it while skipped posts retry next run. evidence: src/judge.ts:368-377, :466-471 + confirmed.

### D3 — Concurrent surface fetching
**Question**: Surfaces load one after another (src/fetch-threads.ts:176), each with fixed waits — roughly 3.5-8 min of fixed cost per run. Load them in parallel?
**Recommended**: Parallel pages (one browser, several pages).
**Chosen**: Parallel pages.
**Rationale**: fetch cost stops growing with surface count; fixed cost drops to roughly the slowest surface. evidence: src/fetch-threads.ts:93-107, :157-207 + confirmed.

### D4 — Cache the Playwright browser
**Question**: Every run downloads Chromium fresh before it can start (the Playwright install step in watch.yml). Cache the browser between runs?
**Recommended**: Cache browser.
**Chosen**: Cache browser.
**Rationale**: saves ~1-2 min per run; key on the lockfile so only version changes re-download. evidence: watch.yml Playwright install step + confirmed.

### D5 — Batch size stays 10; concurrency carries throughput
**Question**: Judge throughput has two levers left: how many posts per LLM call (batch size, now 10) and how many calls at once (concurrency, being raised). Which lever carries the load?
**Recommended**: Keep 10.
**Chosen**: Keep 10.
**Rationale**: small payloads validate cleanly per item and keep fallback blast radius tiny; throughput comes from D1.

### D6 — Recency window stays 72h
**Question**: The 72-hour recency window decides how many posts enter the judge (watcher.config.json:30). Trim the window, or leave product behavior untouched?
**Recommended**: Keep 72h.
**Chosen**: Keep 72h — with the addition that the same post must not be re-fed to the LLM (became requirement #4/#5).
**Rationale**: product behavior is the operator's call; the re-judging waste is a separate, fixable defect (D7).

### D7 — Persist all judged ids, absolute no-re-judge
**Question**: To stop re-feeding the same posts to the LLM, zero-match runs must start persisting judged ids — this reverses FRD #9's match-gate. How absolute is the no-re-judge rule?
**Recommended**: Persist all judged (schema v2, pruned at load).
**Chosen**: Persist all judged; no 24h re-check.
**Rationale**: FRD #9's gate existed for crash-safe ordering, which is preserved; the re-judging gap was already flagged in the prior solution artifact. evidence: src/index.ts:108-131 + .rpiv/artifacts/solutions/2026-10-26_06-15-51_model-judged-keywords.md:146 + confirmed.

### D8 — 8-minute run ceiling
**Question**: After the speed fixes, how long should one run be allowed to go before GitHub kills it?
**Recommended**: Kill at 8 min.
**Chosen**: 8 minutes.
**Rationale**: a hung run dies before the next cron tick queues, so no triggers are dropped; killed runs leave state untouched and posts retry naturally. Matches the repo guidance that timeout sits below the cron interval. evidence: watch.yml:41 + .rpiv/guidance/.github/workflows/architecture.md + confirmed.

### D9 — Per-stage timing logs
**Question**: Stages log counts today but never durations (src/index.ts:52 captures the start time and never uses it). Add per-stage timing to the logs?
**Recommended**: Add timings.
**Chosen**: Add timings.
**Rationale**: a few lines of code; the next slowdown is visible in the run log without re-profiling. evidence: src/index.ts:52 + confirmed.

### D10 — Scope boundaries
**Question**: Confirm the boundaries: cron schedule, LLM endpoint, and match semantics stay as they are — this round only makes the run fast?
**Recommended**: All out of scope.
**Chosen**: All out of scope.
**Rationale**: keeps the change reviewable as a performance round; product behavior frozen.

## Open Questions
(none — all branches resolved during the interview)

## Suggested Follow-ups
- `src/fetch-threads.ts` and `src/index.ts` have no test files (known backlog); the state-persistence change (D7) and the pipeline gate it touches make a pipeline-level test the natural first entry. evidence: tests/ dir listing.
- `src/state.ts` has no pruning today and only supports schema version 1; version 2 migration needs an explicit migrate path and tests for v1→v2 upgrade. evidence: src/state.ts:44-77.
- Heartbeat funnel stats will show `judged: 0` more often once D7 lands, since judged-irrelevant posts drain from the candidates list — a copy tweak may be wanted later. evidence: src/heartbeat.ts:60-80.
- Concurrency ceiling probe currently runs only via manual `workflow_dispatch`; a scheduled re-probe (e.g. weekly) would catch endpoint-tier changes, out of scope for this round. evidence: watch.yml:15-35.

## References
- Interview input: "make the github action flow efficient and blazing fast as the data to be process getting larger and larger"
- Probe evidence: src/judge.ts (constants 36, 45, 48-50; fallback 368-377, 466-471; deferral 459-466), src/fetch-threads.ts (93-107, 157-207, 25-36), src/index.ts (52, 87-91, 108-131), .github/workflows/watch.yml (5, 11-14, 39-41, Playwright install step), scripts/probe-judge.ts:150
- Prior artifacts: .rpiv/artifacts/discover/2026-10-25_21-20-20_model-judged-keywords.md, .rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md:95 (FRD #9 origin), .rpiv/artifacts/solutions/2026-10-26_06-15-51_model-judged-keywords.md:146 (re-judging gap flagged)
- Guidance: .rpiv/guidance/src/architecture.md, .rpiv/guidance/.github/workflows/architecture.md
