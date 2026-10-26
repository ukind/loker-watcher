---
template_version: 1
date: 2026-10-26T12:07:47+0700
author: Yogiswara Utama
commit: 34aef29
branch: main
repository: loker-watcher
topic: "Validation of Model-judged keyword filtering"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md"
tags: [validation, judge, keywords, bulk, heartbeat, state, tests, docs]
last_updated: 2026-10-26T12:07:47+0700
---

## Validation Report: Model-judged keyword filtering

### Implementation Status

- ✓ Phase 0: Probe judge latency, concurrency ceiling + workflow budget — Fully implemented (7 live-runner manual checks still open; see Manual Testing Required)
- ✓ Phase 1: Bulk judge core + resilience + bounded concurrency — Fully implemented
- ✓ Phase 2: Funnel + judged-counter rework — Fully implemented
- ✓ Phase 3: Test relocation + state gate + concurrency tests — Fully implemented
- ✓ Phase 4: Docs sync + repo gates — Fully implemented

Scope note: commits 3356050..34aef29 carry Phases 1-4 plus the probe and the 45-minute job budget. The Phase 0 ramp revision and the Phase 1/3 concurrency + retryable-status revision are uncommitted working-tree changes (scripts/probe-judge.ts, src/judge.ts, tests/judge.test.ts, README.md, AGENTS.md, and the plan itself). This validation ran against the working tree.

### Automated Verification Results

- ✓ Repo gates: `npm run typecheck && npm run lint && npm test` — typecheck covers scripts/, Biome clean over 22 files, 102/102 tests pass (including the five concurrency cases)
- ✓ Rider once: `grep -c 'type: "json_object"' src/judge.ts` — 1 (bulk payload only)
- ✓ Constants: REQUEST_TIMEOUT_MS = 60_000 (judge.ts:33), BATCH_SIZE = 10 (:36), JUDGE_CONCURRENCY = 4 (:45), RETRYABLE_STATUSES = {429, 500, 502, 503, 504} (:48), RETRY_DELAYS_MS = [1s, 2s, 4s] (:50)
- ✓ Batch warns carry a batch index: 5 `batch ${batchIndex}` sites; the retry warn carries attempt N/3, the final defer warn carries none
- ✓ Old gate deleted: no filterPostsByKeywords / matchesKeywords / keywords.js in src/ or tests/; src/keywords.ts and tests/keywords.test.ts absent
- ✓ Funnel: exactly one `stats.judged = newPosts.length` (index.ts:86) before the first heartbeat call; exactly one `config.keywords` (index.ts:97), as the third judgePosts argument
- ✓ Docs clean: zero stale gate/vocabulary/judge-shape/criterion hits in README.md, AGENTS.md, .claude/, .rpiv/guidance/; JUDGE_CONCURRENCY documented in AGENTS.md and README.md; the probe command entry names the ramp; runbook step 5 targets judgePosts
- ✓ Workflow: probe job guarded by workflow_dispatch with timeout 10; watch job timeout 45; the probe job passes no THREADS_SESSION_STATE and no GMAIL_* secret
- ✓ Probe: loads the real keyword list from watcher.config.json (no hardcoded list), 10 real fixtures (longest 539 chars), ramp [2, 4, 8, 16], findConcurrencyCeiling defined and called, ok/refused/failed classified with refused counted separately from failed
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- src/judge.ts — bounded pool: a worker queue drains batch slots, outcomes are indexed by slot so reassembly preserves input order, and the per-item fallback runs after the pool drains (matches the plan's worst-case note: ceil(N/BATCH_SIZE) concurrent calls plus at most BATCH_SIZE sequential fallbacks per affected batch)
- src/judge.ts:285-344 — retry loop: a retryable status sleeps 1s/2s/4s then retries; a transport error returns "unanswered" with zero retries (the catch block calls no sleep); the trailing unreachable return is present as planned
- src/index.ts — funnel is fetch → extract → dedupe vs state → judge → email → state; both early returns heartbeat first; email-before-state ordering and judgedIds persistence untouched
- tests/judge.test.ts — relocated describes are body-identical to the deleted keywords.test.ts (parseVerdict and resolveJudgeConfig diff clean; judgePost differs only by the added KEYWORDS argument, exactly as planned); 16 single-cast fetch doubles, no mock library, zero network
- parseVerdict — byte-identical to base 67d422d (brace-matched comparison)

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ Tests follow the offline conventions: node:test + strict assert, .js import extensions, inline literal doubles with one cast, state files in the OS temp dir with after() cleanup (tests/state.test.ts: tmpdir x2, after x1)
- ✓ src follows the dependency-injection convention: keywords sits before the trailing fetchFn default on judgePost and judgePosts
- Minor observation: judgeBatch's unreachable trailing return is intentional, commented, and type-motivated — acceptable variation, not a deviation

#### Potential Issues:

- The plan's acceptance number — judge wall-clock under 4 minutes at concurrency — is measurable only after the working tree is committed and pushed. A workflow_dispatch today runs the last committed revision (sequential judge, no probe ramp). Not a defect; it is the next required step.
- REQUEST_TIMEOUT_MS = 60s and JUDGE_CONCURRENCY = 4 remain the plan's stated proposals until the probe ramp reports from a runner. The bounded 429 backoff is the stated safety net in the meantime.

### Manual Testing Required:

Blocked locally: the run's LLM_* credentials are not readable in this session (a safety net denies .env access), so the live checks below were not executed. They are also gated on commit + push.

1. Probe job (Phase 0's seven open items — after commit and push):
   - [ ] Run the probe job via workflow_dispatch; it prints three durations; the two bulk calls agree within a factor of two
   - [ ] The bulk duration lands near 27.75s, not 5s (fixtures representative)
   - [ ] The measured duration confirms REQUEST_TIMEOUT_MS = 60s (raise it if the probe reports more)
   - [ ] The measured duration confirms BATCH_SIZE = 10 still fits the budget
   - [ ] The ramp prints one line per level (2, 4, 8, 16) and stops at the first refused level
   - [ ] The printed recommended JUDGE_CONCURRENCY is the largest all-ok level, floored at 4
   - [ ] A deliberately wrong LLM_MODEL turns the probe job red
2. Production dispatch (Testing Strategy step 5 — the acceptance number):
   - [ ] The judge stage finishes in under 4 minutes for a full backlog (was 12m57s sequential)
   - [ ] A match run sends the digest and commits state
   - [ ] Digest order matches input order; skippedPostIds stays empty when the endpoint answers
3. Skipped-retry contract (Testing Strategy step 3):
   - [ ] Any deferred batch's ids stay out of state/seen-posts.json and re-judge on the next run

### Recommendations:

- Ready to commit — implementation is complete and validated.
- Commit and push the working tree first; then dispatch the probe job, then the production run. Expected cost: two live emails and roughly 30 probe LLM calls.
- Raise JUDGE_CONCURRENCY from 4 to the ramp's reading only after the probe confirms it; the constant sits beside the other two at src/judge.ts:45.
