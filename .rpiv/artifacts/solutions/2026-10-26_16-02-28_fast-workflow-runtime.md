---
date: 2026-10-26T16:02:28+0700
author: Yogiswara Utama
commit: 399181b
branch: main
repository: loker-watcher
topic: "fast-workflow-runtime"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, judge, fetch-threads, state, watch-yml, concurrency]
last_updated: 2026-10-26T16:02:28+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Fast Workflow Runtime at Growing Post Volume

**Date**: 2026-10-26T16:02:28+0700
**Author**: Yogiswara Utama
**Commit**: 399181b
**Branch**: main
**Repository**: loker-watcher

## Research Question
Chained from `.rpiv/artifacts/research/2026-10-26_14-51-03_fast-workflow-runtime.md` (research; itself chained from the discover FRD `2026-10-26_14-21-44_fast-workflow-runtime.md`). Which implementation shape should the fast-runtime round take across its seven planned changes: probe-driven judge concurrency, parallel capped fallback, concurrent surface fetching, state v2 with unconditional persistence, browser install change, 8-minute timeout, and per-stage timings?

## Summary
**Problem**: The 10-minute-cron run can exceed its interval: judge width is pinned at 4, the fallback path is serial and unbounded, 8 surfaces load one-by-one behind ~2.7-4.4 min of fixed waits, judged ids are discarded on zero-match runs (re-judging the same posts), and no per-stage timing exists.
**Recommended**: In-repo seams — extend the existing slot-array pool, env resolver chain, constants doctrine, and state schema with zero new dependencies.
**Effort**: Med (~3 days including the fetch testability seam and the test-suite rewrites).
**Confidence**: High — every material claim below was verified by a dedicated agent against the working tree at commit 399181b.

## Problem Statement

**Requirements:**
- Judge stage width becomes probe-driven and env-tunable (discover D1).
- The single-post fallback path runs in parallel under a per-run call budget (discover D2; advisor: `FALLBACK_CALL_BUDGET = 40`, module constant).
- The 8 configured surfaces load concurrently under a bounded cap (discover D3).
- Every judged post id persists, including zero-match runs; the same post is never re-fed to the LLM (discover D7, reverses FRD #9).
- `watch.yml` installs only the headless shell (D4 reversed by advisor), drops to an 8-minute timeout (D8), and stages log per-stage durations (D9).
- Batch size (10) and recency window (72h) stay untouched (D5, D6). Cron, LLM endpoint, and match semantics stay untouched (D10).

**Constraints:**
- Hard: strict TS flags on; fail-visible (invalid config/state exits nonzero naming the problem); state writes stay atomic; no new runtime dependency without a stated need in the PR description; tests stay offline (node:test + tsx).
- Hard: the workflow commit-back contract — `git add state/seen-posts.json` (`watch.yml:69`), jq delta on `.seenPostIds | length` (`:74-75`), no-op guard (`:70-73`) — must keep working.
- Soft: the constants doctrine (`src/judge.ts:31-50`) — only probe-measured values become tunable; unmeasured values stay module constants.

**Success criteria:**
- A production-representative dispatch run completes inside 8 minutes with the probe-measured width set.
- Zero-match runs commit newly judged ids; no judged post is ever judged twice.
- A degraded batch cannot extend the run unboundedly (fallback budget caps it).
- Stage durations appear in run logs; a killed run never leaves a partial state file.

## Current State

**Existing implementation:**
- Judge pool: slot-array + shared cursor, `min(width, batches)` workers — `src/judge.ts:440-455`; width is the module constant `JUDGE_CONCURRENCY = 4` (`:45`), consumed at exactly one site (`:455`).
- Fallback: serial per-post re-judging inside the reassembly walk (`src/judge.ts:456-481`, `await judgePost` at `:471`); one degraded batch costs up to 10 × 2 × 60s serial; the historical cascade burned 6.5 job-minutes (`:256-258`).
- Fetch: both paths walk 8 surfaces serially (`src/fetch-threads.ts:93-95`, `:176-178`); serialized fixed waits total ~2.7-4.4 min authenticated; per-surface state (page, accumulators, listener) is closure-local and parallel-safe.
- State: schema v1 only (`src/state.ts:18-21`, `CURRENT_STATE_VERSION = 1` at `:30`); a v2 file throws on load (`:79`); 281 bare id strings on disk; no pruning.
- **Confirmed bug**: the atomic-write temp name is double-quoted and never interpolates — `src/state.ts:146` — so every write uses the same literal temp path; overlapping writers collide and the error-path unlink (`:152-157`) can delete a peer's staged file. No test imports `writeStateAtomic`.
- Persistence gating: Gate 2 (zero matches, `src/index.ts:108-112`) returns before `saveState`; `saveState`'s internal gate is freshness-gated (`src/state.ts:177-183`), so persistence on zero-match-but-judged runs needs pipeline wiring only, not state.ts gate changes.
- Workflow: 45-min timeout with serial-math comment (`watch.yml:39-41`); un-cached full browser install (`:52-53`); six-secret env block (`:55-63`).

**Relevant patterns:**
- Slot-array + shared cursor bounded pool: `src/judge.ts:440-455` — 1 site today, template for 3.
- Env resolver chain (trim → collect-missing → one throw): `src/judge.ts:72-96`, fed by `ENV_NAMES` (`src/config.ts:14-22`).
- Boolean env read: `src/config.ts:30-35`; positive-number guard: `src/config-file.ts:154-159`. No numeric env parse exists anywhere in src yet.
- Injectable `now`: `src/recency.ts:13-16`.
- Testable fetch injection precedent: `fetchFn` parameter on `judgeBatch`/`judgePost` (`src/judge.ts:411`, consumed `:451`).

**Integration points:**
- `src/judge.ts:455` — pool launch line; the width source swaps here.
- `src/judge.ts:456-481` — reassembly walk; the fallback parallelizes and caps here.
- `src/fetch-threads.ts:70`, `:157` — the two surface-walk signatures gain a width parameter.
- `src/index.ts:87-124` — Gate 1/Gate 2/email/save ordering restructure.
- `src/state.ts:139-190` — atomic write (with the `:146` fix), schema, gate, append.
- `watch.yml:39-63` — timeout, install flags, env block.

## Solution Options

### Option 1: In-repo seams (env-tunable width + hand-rolled pools + state v2)
**How it works:**
Extend each existing pattern in place. A numeric env parse (`JUDGE_CONCURRENCY`) joins `ENV_NAMES` and rides `JudgeConfig` through the existing resolver chain; the pool launch reads it (`src/judge.ts:455`). The fallback walk and both fetch loops become slot-array pools copying `judge.ts:440-455`, with `FALLBACK_CALL_BUDGET = 40` beside `BATCH_SIZE`. State becomes v2 (id → firstSeenAt) with a v1 migration synthesizing `firstSeenAt` at the migration moment, prune-on-load fed `config.recencyHours`, and Gate 2 persistence wired before the zero-match return. Workflow lines: timeout 8, `--only-shell`, one env entry.

**Pros:**
- Zero new dependencies; every piece maps 1:1 onto a verified precedent (all 4 dimensions cleared, evidence per cell in the fit grid below).
- The only candidate aligned with every settled discover/advisor decision (D1 env chain, budget-as-constant doctrine, D4 reversal, D8, D9).
- Folds in the two mandatory fixes the round surfaced anyway: the `state.ts:146` temp-name bug and the Gate 2 ordering restructure with doc-comment rewrites.

**Cons:**
- Largest in-repo diff: ~200-300 src lines + ~40 workflow/doc lines across 6 files.
- The fetch pools need a new testability seam (injectable page factory or extracted pure drain helper) — the one genuine design item; variant-independent.
- v2 migration must handle the committed 281-id v1 file and the rollout window (an old reader throws on a v2 file at `state.ts:79`).

**Complexity:** Med (~3 days)
- Files to create: 1-2 test files (fetch pool tests, migrateState/atomic-write tests); files to modify: 6 (~200-300 src lines).
- Risk level: Low-Med (enumerable hazards, all with in-repo avoidances).

### Option 2: p-limit pools
**How it works:**
Same round surface, but bounded concurrency at the four adoption sites (judge pool, fallback pass, both fetch loops) delegates to `p-limit` (`Promise.all(list.map(limit(fn)))` / `limit.map`); defer/skip bookkeeping and retry logic stay in-repo.

**Pros:**
- All 4 dimensions cleared; mechanism-agnostic pins (peak ×2, order/defer, retry counts) survive the swap unchanged and guard it in both directions.
- Ecosystem-verified: v7.3.3 (2026), active sindresorhus maintenance, ~5 releases in 13 months, 5,838 dependents, 2-file footprint, 1 dep (yocto-queue), ESM + bundled tested types, Node ≥ 20; documented order-preserving `limit.map` and a dynamic-concurrency recipe that fits future 429-adaptive width.
- Strict-TS bonus: the typed map eliminates the `noUncheckedIndexedAccess` undefined-guards the hand-rolled pool needs.

**Cons:**
- New runtime dependency — AGENTS.md gates it on a stated need in the PR description; the hand-rolled idiom already exists and is pinned.
- The fallback reassembly is the same multi-phase restructure as Option 1 (order-pinned by `tests/judge.test.ts:464-499`); p-limit saves only the pool mechanics (~10 lines per site).
- Budget-exhaustion semantics and the fetch testability seam are still new work.

**Complexity:** Med (~2.5 days)
- Files to modify: 4-5; new dep + lockfile entry.
- Risk level: Low (removal is a pure local revert; pins guard both directions).

### Option 3: Config-file tuning
**How it works:**
Same as Option 1 except the three tunables (judge width, fallback budget, fetch cap) live in `watcher.config.json` with `config-file.ts` validators instead of env vars; the probe operator pastes the measured width into the committed file; pools stay hand-rolled.

**Pros:**
- All 4 dimensions cleared; strictly less plumbing than the env chain (no `ENV_NAMES` entry, no resolver change, no watch.yml env edit, no GitHub UI step).
- Fail-visible arguably strengthens: the closed key set rejects a typo'd key name with path+key, while a typo'd env name is silently absent.
- The `resolveJudgeConfig` deepEqual pin (`tests/judge.test.ts:57-62`) stays byte-identical (values thread as parameters, not `JudgeConfig` fields).

**Cons:**
- Re-opens two settled decisions without new evidence: D1's probe-driven value rides the env chain, and the advisor fixed the fallback budget as a module constant ("only probe-measured values go tunable"; the budget is unmeasured). Conflicts with D10 scope discipline.
- Doctrine stretch: `recencyHours` already blurs the "what to watch vs how to run" line; three perf keys extend it further.
- Probe handoff becomes a manual paste (commit-gated, same latency as today's constant edit — parity, not regression, but a workflow change).

**Complexity:** Med (~2.5 days)
- Files to modify: 5-6 (~+3 validators, +3 keys, param threading).
- Risk level: Low on code; Med on scope (re-litigating settled decisions).

### Option 4: State v1 + sidecar times
**How it works:**
Skip the schema migration: `seen-posts.json` keeps v1 `seenPostIds`; a new sidecar file maps id → firstSeenAt for pruning; Gate 2 writes both atomically; dedupe reads `seenPostIds` unchanged.

**Pros:**
- Dodges the v2 migration, the v2-shaped test surface, and the rollout-window reader-compat hazard entirely; `diffNew`/`diffNewIds` (`state.ts:110-132`) stay untouched.
- Small additive build list; existing gate tests (`tests/state.test.ts:29-54`) survive if pruning stays match-run-opportunistic.

**Cons (blocking):**
- **precedent-fit BLOCKS**: the repo's state is single-artifact everywhere — `STATE_PATH` (`config.ts:88-89`), the commit-back contract (`watch.yml:69`, `:74-75`), and the guidance wording all assume exactly one file; this invents the first multi-file state with no pattern to copy.
- **integration-risk BLOCKS**: the `state.ts:146` temp-name bug becomes contended across both targets (the same literal temp path serves both writes); the gate (`:177-183`) has no prune trigger; watch.yml needs `:69` staging + `:74-75` jq interplay decisions; three fresh-start permutations (one file missing/stale) are unspecified.
- Legacy debt: the 281 on-disk ids get no timestamps (0/281 sidecar coverage) — permanently unprunable under any backfill policy.

**Complexity:** Med (~2 days)
- Risk level: High (multi-artifact consistency on a broken atomic-write primitive).

## Comparison

| Criteria | 1. In-repo seams | 2. p-limit | 3. Config-file | 4. Sidecar |
|----------|------------------|------------|----------------|------------|
| Complexity | Med (~3d) | Med (~2.5d) | Med (~2.5d) | Med (~2d) |
| Codebase fit | High (extends 5 verified patterns) | High (contained, pinned both ways) | High (recencyHours idiom) | Low (no multi-file precedent) |
| Risk | Low-Med | Low | Med (scope re-open) | High |
| Settled-decision alignment | Full | Full (orthogonal) | Conflicts (D1 + budget doctrine) | Conflicts (state v2 settled) |
| New dependencies | 0 | 1 (gated) | 0 | 0 |

## Recommendation

**Selected:** Option 1 — In-repo seams.

**Rationale:**
- Only candidate that matches every settled discover/advisor decision: D1's probe-driven width rides the existing `ENV_NAMES → resolveJudgeConfig → step-env` chain; `FALLBACK_CALL_BUDGET = 40` is a module constant per doctrine; D4 reversal, D8, D9 land as planned.
- Fit grid clean: precedent-fit (pool idiom, resolver chain, constants doctrine, injectable-now, freshness gate — all verified at cited lines), integration-risk (all hazards enumerable with in-repo avoidances), migration-cost (~200-300 lines, every piece 1:1 onto a precedent), verification-cost (rewrites bounded; the one real gap — fetch testability — has the `fetchFn` template at `src/judge.ts:411`).
- The round's two mandatory fixes (`state.ts:146`; Gate 2 ordering) fold into work Option 1 already does.

**Why not alternatives:**
- Option 2 (p-limit): cleared all dims and is the sanctioned fallback — adopt if the pool code balloons past ~100 lines or the slot-array guards produce bugs; revisit its dynamic-concurrency recipe if 429-adaptive width is ever wanted. Today the in-repo idiom exists, is pinned, and the dep needs a stated need.
- Option 3 (config-file): cleared all dims and is cheaper plumbing, but re-opens D1 and the budget doctrine without new evidence; revisit only if the team decides operator-facing perf tuning is a product requirement.
- Option 4 (sidecar): blocked on precedent-fit and integration-risk; its genuine appeal (dodging reader-compat) becomes a design requirement for state v2: the v2 rollout must define what an old reader sees (`state.ts:79` throw) during the window between the code deploy and the first commit-back.

**Trade-offs:**
- Accepting ~200-300 lines of in-repo pool/migration code for zero dependencies and full decision alignment.
- Accepting synthesized `firstSeenAt` at the migration moment (the 281 legacy ids unprunable for 72h — safe, because `filterRecent` already excludes them upstream) instead of the sidecar's permanent prune debt.
- Accepting a design task for fetch-pool testability before any fetch test can exist.

**Implementation approach:**
1. Judge seam + pools — numeric env parse (`JUDGE_CONCURRENCY`), `JudgeConfig` + `concurrency`, pool width from config, `FALLBACK_CALL_BUDGET = 40`, multi-phase parallel capped fallback preserving `skippedPostIds` input order; rewrite the doc comments (`judge.ts:19-22`, `:421-431`).
2. Fetch pools — bounded slot-array pools in both paths, width constant beside `fetch-threads.ts:23-45`, slot-indexed results/failures/empty; add the testability seam first (injectable page factory or extracted pure drain helper).
3. State v2 + Gate 2 — fix `state.ts:146` (one character); v2 map keeping the key name `seenPostIds` (jq `length` survives an object under the same key); `migrateState` v1→v2 branch synthesizing `firstSeenAt`; prune-on-load with injectable `now` fed `config.recencyHours`; persist after the heartbeat await, before the Gate 2 return; keep `sendDigest` before `saveState` on the digest path; rewrite the ordering doc comments (`index.ts:10-13`, `:113-119`; `state.ts:6-7` docblock says "match-gated", the implemented gate is freshness-gated).
4. Workflow + timings — `watch.yml:41` timeout 45 → 8 with a rewritten comment; `:53` `--only-shell` (+ shortcut comment noting headless-only); `:55-63` env block +1 line; stage timers wrapping the stage awaits in `src/index.ts` (`:58-62`, `:94-98`, `:116`, `:123`), notification-stage duration = digest or heartbeat, whichever ran.
5. Probe default — ship default 4 until a real dispatch run measures; the constant's comment cites the measuring run (research open Q1 rule).

**Integration points:**
- `src/judge.ts:45`, `:455` — width source; `:456-481` — parallel capped fallback; `:31-50` — budget constant.
- `src/fetch-threads.ts:70`, `:93-95`, `:157`, `:176-188` — signatures and both loops.
- `src/state.ts:146`, `:18-21`, `:30`, `:44-80`, `:110-132`, `:177-190` — bug fix, schema, migration, dedupe, gate, append.
- `src/index.ts:58-62`, `:87-124` — gate restructure, timers; `src/config.ts:14-22` — env name.
- `watch.yml:39-41`, `:52-53`, `:55-63` — timeout, install, env.

**Patterns to follow:**
- Slot-array + shared cursor pool: `src/judge.ts:440-455` (copy the `:447-448` undefined-guard).
- Env resolver: `src/judge.ts:72-96`; boolean env: `src/config.ts:30-35`; numeric guard: `src/config-file.ts:154-159`.
- Injectable `now`: `src/recency.ts:13-16`; fetch injection: `src/judge.ts:411`.

**Risks:**
- 429 burst at higher width: keep backoff + whole-batch defer; only probe-measured widths ship (precedent `1d4faed` lesson; incident `judge.ts:256-258`).
- Untested "~4-8 concurrent pages per session": bounded fetch default (proposed 4), verified by a live dispatch; log a plan for what a rate-limited session looks like (research open Q2).
- 8-minute ceiling unsafe until fast paths land and the width env var is set: land the timeout change last, in the same round.
- Runner-measured or fail: every new constant validates from a production-representative dispatch run (precedents `fda50c2`, `5f6a328`).
- jq fragility: keep the key name `seenPostIds`; renaming it breaks the commit delta.

## Scope Boundaries
- Building: the seven changes — probe-driven width, parallel capped fallback, concurrent fetching, state v2 + unconditional persistence, --only-shell install, 8-min timeout, per-stage timings.
- NOT doing: cron schedule, LLM endpoint, match semantics, batch size, recency window, browser caching (reversed), config-file relocation of tunables (superseded), p-limit adoption (fallback only).

## Testing Strategy

**Unit tests:**
- Numeric env parse: absent → 4; invalid/zero/negative/float → rejected per the chosen absence semantics; mirrors `config-file.test.ts:104-108` guard-pin style.
- Pool width pins re-derived from the configured width (`tests/judge.test.ts:433-461` literals 4 and 3); order/defer pin re-derived from width (`:464-499`).
- Budget exhaustion: fallback stops at 40 calls; surplus posts land in `skippedPostIds` in input order; fallback-pass peak ≤ cap via a `measuredFetch`-style counter.
- `migrateState`: first direct tests — real 281-id v1 shape → v2; unsupported version still throws.
- `writeStateAtomic`: unique temp names; error-path unlink targets only its own temp; crash-mid-write leaves the target untouched.
- Prune: pinned clock, exactly-at-TTL and one-ms-past boundaries; legacy synthesized ids survive inside the window.
- State gates rewritten for v2 (`tests/state.test.ts:29-54`): empty → no file, all-seen → byte-identical, append order + version 2 roundtrip.
- Stage timers: injectable clock asserting duration lines per stage (notification stage = digest or heartbeat).

**Integration tests:**
- Pipeline-level Gate 2 at the unit seam: zero-match-but-judged run persists judged ids and skips neither heartbeat nor state (first `src/index.ts` test — the natural first entry per the discover follow-ups).

**Manual verification:**
- [ ] Dispatch run at the probe-measured width completes inside 8 minutes with production-representative fixtures.
- [ ] Zero-match run commits newly judged ids; next run shows them as seen (no re-judge).
- [ ] The committed v1 file migrates on first run; commit-back jq prints a truthful delta.
- [ ] Per-stage durations appear in the run log; a killed run leaves no partial state file.
- [ ] `npx playwright install --with-deps --only-shell chromium` satisfies the run on the runner.

## Open Questions
**Resolved during research:**
- Sidecar vs v2 — v2; the sidecar blocked on precedent-fit and integration-risk (five-agent fit grid, this artifact).
- Tunable mechanism — env + constants; config-file cleared fit but was superseded by the settled D1/advisor decisions (documented above as a revisit condition).
- Browser cache — reversed by advisor: no cache step, `--only-shell` (measured saving ~20-35s, not 1-2 min; Playwright docs discourage caching).
- Email-duration criterion — reinterpreted as notification-stage duration (digest or heartbeat, whichever ran); acceptance wording adjusts accordingly.

**Requires user input:**
- Fetch-cap default value — proposed 4, design-picked; live verification needs a dispatch. Default assumption: 4.
- `JUDGE_CONCURRENCY` absence semantics in local runs — default 4 (watch.yml sets it explicitly from the probe) vs fail-closed. Default assumption: absent → 4.

**Blockers:**
- Shipped width default needs a real probe/dispatch run with production-representative fixtures (fixture-driven probes under-measured 5.2× once — `5f6a328`). Unblock: run the probe job from a dispatch, cite the run in the constant's comment.

## References
- `.rpiv/artifacts/research/2026-10-26_14-51-03_fast-workflow-runtime.md` — the evidence base this artifact scores candidates against.
- `.rpiv/artifacts/discover/2026-10-26_14-21-44_fast-workflow-runtime.md` — FRD: requirements D1-D10, acceptance criteria.
- `.rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md` — pool/backoff/deferral origin; run-history math.
- `.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md:2219` — earlier record that Playwright caching is discouraged.
- `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md` — DI-at-seam, state boundary, env sync-point, timeout-below-cron rules.
- `src/judge.ts:440-455`, `src/state.ts:139-163`, `src/index.ts:87-124`, `watch.yml:37-77` — primary integration surfaces.
- p-limit: https://github.com/sindresorhus/p-limit (v7.3.3), recipes: https://github.com/sindresorhus/p-limit/blob/main/recipes.md.
