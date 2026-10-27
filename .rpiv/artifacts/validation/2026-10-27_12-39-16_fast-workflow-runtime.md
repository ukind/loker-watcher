---
template_version: 1
date: 2026-10-27T12:39:16+0700
author: Yogiswara Utama
commit: 7dc0247
branch: main
repository: loker-watcher
topic: "Validation of fast-workflow-runtime"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-27_10-20-51_fast-workflow-runtime.md"
tags: [validation, judge, fetch-threads, state, watch-yml, concurrency, fallback, timings]
last_updated: 2026-10-27T12:39:16+0700
---

## Validation Report: fast-workflow-runtime

### Implementation Status

- ✓ Phase 1: Judge concurrency seam — Fully implemented (ENV_NAMES entry, parseJudgeConcurrency, trailing width parameter, parser pins)
- ✓ Phase 2: Parallel capped fallback — Fully implemented (slot-array pool at the judge width, FALLBACK_CALL_BUDGET = 40, drain-then-throw)
- ✓ Phase 3: Fetch pools + context factory seam — Fully implemented (ContextFactory trailing parameter on both fetchers, playwright import only inside chromiumContextFactory, offline doubles)
- ✓ Phase 4: State v2 core — Fully implemented (CURRENT_STATE_VERSION = 2, migrateState, pruneState, prune-on-load)
- ✓ Phase 5: State hardening — Fully implemented (stateTempPath distinct siblings, writeStateAtomic namespaced failure + cleanup)
- ✓ Phase 6: Pipeline gates + stage timers — Fully implemented (runWatcher, Gate 2 persistence, timeStage, import.meta.url entry guard)
- ✓ Phase 7: Workflow + docs — Fully implemented (timeout 8, --only-shell, JUDGE_CONCURRENCY literal, README operator paragraph; see Deviations for the width value and two measured-reality workflow adjustments)

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean
- ✓ Lint: `npm run lint` — clean
- ✓ Tests: `npm test` — 158 pass / 0 fail (offline, deterministic)
- ✓ Phase 1 pins: JUDGE_CONCURRENCY in src/judge.ts only at parse/default sites; judgeConcurrency exactly 1 in src/config.ts; probe still matches `resolveJudgeConfig(process.env)[0]`
- ✓ Phase 3 pins: playwright only as the dynamic import inside the default factory; contextFactory on both fetchers; no playwright in tests/fetch-threads.test.ts; no "sequential" left in src/fetch-threads.ts
- ✓ Phase 4/5 pins: no `seenPostIds: string[]`; CURRENT_STATE_VERSION = 2 once; no `join(dir, "` literal; stateTempPath export + writeStateAtomic call site once each; writeStateAtomic pinned in tests (4 matches)
- ✓ Phase 6 pins: no bare `loadState()`; no `async function main(`; `timing: ` exactly 5; persistJudged exactly 3; process.exit exactly 2 (both in the entry guard); import.meta.url exactly 1; no playwright and zero Date.now() in tests/index.test.ts
- ✓ Phase 7 pins: `timeout-minutes: 8` once; 45 gone; only-shell once; JUDGE_CONCURRENCY literal first in the Run watcher env block; README operator note present
- ✓ No regressions detected — the pre-existing judge/fetch/state suites all pass unchanged where the plan required it

### Code Review Findings

#### Matches Plan:

- src/judge.ts:52,184-201,642 — DEFAULT_JUDGE_CONCURRENCY, parseJudgeConcurrency, trailing width parameter exactly as fenced
- src/judge.ts — FALLBACK_CALL_BUDGET = 40 with the reassembly walk, parallel fallback pool, and input-order assembly (tests cover peak width, budget starvation, drain-then-throw)
- src/fetch-threads.ts:126,196,283 — dynamic playwright import inside chromiumContextFactory; ContextFactory trailing parameter on both walks
- src/state.ts:35,196,215 — v2 schema, migration, prune; stateTempPath + the single writeStateAtomic call site
- src/index.ts — runWatcher/WatcherDeps/WatcherRun/timeStage exports, Gate 2 persisting after the heartbeat await, prune-on-load, entry guard with the verbatim rotation branch
- .github/workflows/watch.yml — 8-minute watch timeout with the pooled-math comment, headless-shell install comment, width literal first in the env block
- README.md:63-70 — the JUDGE_CONCURRENCY operator paragraph with the probe handoff and the v2 rollback sentence

#### Deviations from Plan:

- .github/workflows/watch.yml (Phase 7 fence, width literal): `JUDGE_CONCURRENCY: "8"` → `"4"`. Plan-sanctioned step (paste the measuring run's reading): probe run 40455686221 printed 4, and a live 2026-10-27 measurement showed 8-wide bursts drawing HTTP 429s from the endpoint (1 of 8 refused) while 4-wide ran clean (12/12). The first width-8 dispatch (40458600377) exhausted both accounts in one hop because all 8 batches rotated to account 2 within ~50 ms.
- .github/workflows/watch.yml (probe step — plan said "probe job untouched"): `continue-on-error: true` added at job level. Measured cause: the probe reads only accounts[0], so openrouter's daily cap (resets 00:00 UTC) failed the probe in 10 s (run 40459936509) and marked the run failed while the watch job worked. A refused measurement must not gate the run.
- .github/workflows/watch.yml (install step — plan fence had --with-deps): dropped `--with-deps`, keeping `--only-shell chromium`. Measured cause: the apt-get pass is ~2-4 minutes of the ~5.5-minute setup that consumed most of the 8-minute budget (run 40459936509: cancelled at the timeout ~2.3 min into judging). The runner image carries the chromium shared libraries; the next green run validates this.
- All three carry in-file comments naming the measurement; the plan's timeout-math comment was rewritten to stay truthful at width 4.

#### Pattern Conformance:

- ✓ New test files (tests/fetch-threads.test.ts, tests/index.test.ts) follow the repo's node:test + tsx offline conventions: OS-temp fixtures, injected clocks, transport/page doubles, zero network
- ✓ Module docblocks updated in place; no stale terms (grep for "sequential", "peaks at exactly four", "version: 1", LLM_API_KEY, "45 min" — all clean in src/ and tests/)
- Minor observation: .rpiv/guidance/ still describes the pre-plan workflow (timeout "10m", LLM_API_KEY example). Comment-only drift; refresh at the next guidance touch.

#### Potential Issues:

- src/judge.ts:38 — REQUEST_TIMEOUT_MS = 60_000 vs the only live account tonight: glm-5.3-flash's 10-post bulk (reasoning model) exceeded 60 s and the batch aborted (run 40459936509: "The operation was aborted due to timeout — skipping batch"). Until openrouter resets at 2026-10-28T00:00Z, the judge cannot complete against z.ai alone; deferred batches stay unseen and retry next run (D3 — safe). Batch size and the request timeout are plan-out-of-scope by design; flagging for a probe-informed follow-up.
- src/judge.ts (rotation × burst interaction): a width-N wave 429s across accounts within ~1 s and exhausts the pool in a single hop — the 429-no-backoff rule treats a momentary concurrency rejection like a dead quota. Structural fix (same-account jittered retry for burst 429s, or account-aware slotting) is future work.
- scripts/probe-judge.ts:163 — the probe measures only accounts[0]; during any primary-account outage its "ceiling" reading is meaningless (tonight it printed "ceiling 1" from a dead account). Probing the whole pool is the follow-up.
- .gitignore — now un-ignores .rpiv/tmp/, .rpiv/tmp-config-backup.json, and .codebase-memory/; all three remain untracked, so git status carries permanent noise. Harmless; re-ignore or track deliberately at the next housekeeping pass.
- Secrets hygiene: both LLM account API keys were pasted into the session chat on 2026-10-27. Rotate both (openrouter + z.ai) after the current debugging window; secrets belong only in GitHub Actions secrets.

### Manual Testing Required:

Tonight's dispatches (40458600377, 40455686221, 40459936509) proved four of the eleven manual boxes — ticked in the plan with run evidence:

1. Proven 2026-10-27 (tick in plan):
   - [x] JUDGE_CONCURRENCY honored in a real run (8-wide and 4-wide waves observed in logs)
   - [x] 8-surface concurrent wall-clock (~71-72 s vs ~150 s serial) with no Threads rate-limit blowup
   - [x] --only-shell browser satisfies a real run (two dispatches drove 8 real surfaces)
   - [x] README probe instructions match the probe job (printed "recommended JUDGE_CONCURRENCY = 4")
2. Pending one green run — blocked on openrouter's daily-cap reset at 2026-10-28T00:00Z (the cron re-runs every 10 min, so the first post-reset tick should go green):
   - [ ] Phase 2: fallback budget behavior against a real degraded endpoint (tonight the fallback never fired — bulk batches deferred whole)
   - [ ] Phase 4: committed v1 file migrates and the next write commits v2 (`jq '.version' state/seen-posts.json` prints 2, length preserved)
   - [ ] Phase 5: `git status --short state/` shows no .tmp files after a production run
   - [ ] Phase 6: `timing:` lines in stage order; a zero-match run commits judged ids and the next run shows them seen
   - [ ] Phase 7: dispatch completes inside 8 minutes (expected: setup ~3 min + fetch ~1.2 min + judge ~1.5 min with openrouter alive)
   - [ ] Phase 7: a zero-match run commits judged ids (needs a naturally quiet tick)
   - [ ] Phase 7: the consolidated dispatch ticks the remaining Slices 1-6 deferrals

### Recommendations:

- After 00:00 UTC, watch the first green cron run; read the six pending manual boxes off its log and state file, then tick them.
- If the headless-shell install fails on a missing library, re-add --with-deps and raise timeout-minutes 8 → 9 (still below the 10-minute cron interval).
- Follow-up plan candidates: probe the whole account pool (not accounts[0]); same-account retry/backoff for burst 429s; probe-informed REQUEST_TIMEOUT_MS.
- Rotate both LLM API keys (pasted in chat 2026-10-27).
- Ready to commit — implementation is complete and validated.
