---
template_version: 1
date: 2026-10-26T10:17:28+0700
author: Yogiswara Utama
commit: 67d422d
branch: main
repository: loker-watcher
topic: "Validation of Model-judged keyword filtering"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md"
tags: [validation, judge, keywords, bulk, heartbeat, state, tests, docs]
last_updated: 2026-10-26T10:17:28+0700
---

## Validation Report: Model-judged keyword filtering

### Implementation Status

- ✓ Phase 1: Bulk judge core — Fully implemented
- ✓ Phase 2: Funnel + judged-counter rework — Fully implemented
- ✓ Phase 3: Test relocation + state gate tests — Fully implemented
- ✓ Phase 4: Docs sync + repo gates — Fully implemented

### Automated Verification Results

- ✓ Terminal gate: `npm run typecheck` — clean, no errors
- ✓ Terminal gate: `npm run lint` — 21 files checked, no fixes applied
- ✓ Terminal gate: `npm test` — 95 tests, 26 suites, 0 failures
- ✓ Phase 2 scoped lint: `npx biome check src/index.ts src/heartbeat.ts src/types.ts` — 3 files, no fixes applied
- ✓ Phase 1 rider count: `grep -c 'type: "json_object"' src/judge.ts` — returns 1
- ✓ Phase 1 chunking: `grep -n "BATCH_SIZE" src/judge.ts` — constant at line 27 beside `REQUEST_TIMEOUT_MS`, slice step at lines 363-364, no other magic batch numbers
- ✓ Phase 1 parseVerdict byte-identity: diff against `git show HEAD:src/judge.ts` — identical
- ✓ Phase 2 gate sweeps: `grep -rn "filterPostsByKeywords\|matchesKeywords" src/ tests/` — nothing; `grep -rni "maybe" src/ tests/` — nothing; `grep -rn "keywords.js" src/` — nothing; `test ! -f src/keywords.ts` and `test ! -f tests/keywords.test.ts` — both succeed
- ✓ Phase 2 funnel wiring: `grep -n "stats.judged" src/index.ts` — one assignment at line 86, before the first heartbeat call; `grep -n "config.keywords" src/index.ts` — one occurrence at line 97, the third `judgePosts` argument
- ✓ Phase 3 test pins: `parseBulkVerdicts` describe present in `tests/judge.test.ts`; `grep -c "skips the disk write" tests/state.test.ts` — 2; `response_format` asserted both ways (bulk with rider at line 358, fallback without at line 361)
- ✓ Phase 4 doc sweeps: zero stale gate references, zero `keywords.ts` references, zero stale vocabulary, zero stale judge-shape wording, zero `frontend / fullstack` criterion wording across `README.md .claude/ .rpiv/guidance/ AGENTS.md`; runbook step 5 names `judgePosts` (line 16)
- ✓ No regressions detected — the email-before-state ordering, the `saveState` gate, and the heartbeat best-effort wrapper are untouched

### Code Review Findings

#### Matches Plan:

- src/judge.ts:27 — `BATCH_SIZE = 10` beside `REQUEST_TIMEOUT_MS`; chunk loop at lines 363-364 steps by `BATCH_SIZE`
- src/judge.ts — `parseBulkVerdicts` exported, id-keyed `Map`, 19-digit ids never `Number()`-coerced, hostile keys such as `__proto__` stay data; `judgeBatch` gets no retry and its four warns carry no `/2` suffix; `judgePosts` falls back per item and warns on skip naming both stages
- src/judge.ts — `response_format` rider on the bulk payload only (grep count 1); the single-post fallback payload carries no rider
- src/judge.ts — `keywords` parameter added before the trailing `fetchFn` seam on both `judgePost` and `judgePosts`; both message builders serialize `JSON.stringify(keywords)`; no hardcoded frontend/fullstack criterion survives in either builder
- src/judge.ts — `parseVerdict` byte-identical to HEAD (diff clean, fence-strip regexes included)
- src/index.ts:86 — `stats.judged = newPosts.length` placed before the first heartbeat call; both heartbeat call sites pass `newPosts`; `config.keywords` is the third `judgePosts` argument (line 97); the two judge-stage log lines collapsed into one; the keyword gate call and the zero-maybes early return are gone
- src/heartbeat.ts — `HeartbeatStats.maybes` became `judged`, `Candidate.reason` is `"judged" | "near-miss"`, funnel copy reads `N judged candidate(s)`, candidate tag reads `[judged]`; the near-miss tier is byte-identical
- src/types.ts — `JudgeVerdict.relevant` doc reworded to the keyword criterion
- src/keywords.ts and tests/keywords.test.ts — deleted together in Phase 2, no orphan import remains
- tests/judge.test.ts — the relocated `parseVerdict`, `resolveJudgeConfig`, and `judgePost` describes are body-for-body identical to HEAD's `tests/keywords.test.ts` except the three `judgePost` call sites gaining the `KEYWORDS` argument (verified by diff); the bulk suite pins call counts, the rider both ways, and id safety
- tests/state.test.ts — both no-op branches pinned (`saved === false` plus byte-identical file) with a positive control that round-trips through `loadState`; files live in the OS temp dir with `after()` cleanup
- tests/heartbeat.test.ts — vocabulary updated: `judged` fixture field, "puts judged candidates first", "does not repeat a judged candidate as a near-miss", funnel count assert, `[judged]` tag assert
- README.md, .claude/skills/validate-e2e/SKILL.md, .rpiv/guidance/architecture.md, .rpiv/guidance/src/architecture.md, .rpiv/guidance/tests/architecture.md, AGENTS.md — all six doc files carry the planned regions (intro, pipeline steps 5-6, keywords row, runbook step 5, guidance overview/tree/responsibility/module row/DI example/backlog, grandfathered-exceptions line, doubles example, fixture step 5, AGENTS.md four regions)

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ Doubles are inline literals with one cast, no mock library, zero network — matches the tests/ conventions
- ✓ One describe per exported function; `it` titles read as behavior specifications
- ✓ Temp files use lazy `mkdtemp` in the OS temp dir with `after()` cleanup — matches the established pattern
- ✓ The DI seam shape (`keywords` before the trailing `fetchFn`) matches the guidance example in `.rpiv/guidance/src/architecture.md`

### Manual Testing Required:

Validated by inspection (the manual criteria were checked too, per the request):

1. Phase 1 — bulk-first flow is obvious in `src/judge.ts` (`judgeBatch` → per-item fallback → skip warn naming both stages); the system message carries `JSON.stringify(keywords)`; no hardcoded criterion survives — verified by full-file read
2. Phase 2 — `main()` reads fetch → extract → dedupe vs state → judge → email → state; the only pre-judge early return is zero unseen posts; both heartbeat call sites pass `newPosts`, never the `judged` output array — verified by full-file read
3. Phase 3 — relocated suites assert body-for-body what `tests/keywords.test.ts` asserted (diff clean apart from the `KEYWORDS` argument); every double is an inline literal with one cast — verified by diff and full-file reads
4. Phase 4 — README pipeline steps read in the new funnel order; the keywords row describes the criterion role; runbook step 5 is workable against the `judgePosts` signature; guidance DI and doubles examples match the new signatures; the AGENTS.md module list has no `keywords.ts` and the judge bullet describes bulk plus per-item fallback; the root guidance tree has no keywords stage — verified by full-file reads

Still homework for a human (needs live credentials, cannot run here):

5. One live run with real `LLM_*` and `GMAIL_*` env vars: confirm a match run produces a digest plus a state commit — neither path has ever fired in production
6. Confirm skipped ids stay unseen and retry on the next run — the code persists only judged ids (verified by inspection at `src/index.ts`); live confirmation pending
7. Confirm the endpoint accepts a ~10-post prompt and honors `json_object`; watch skipped counts on the first runs, because a whole-batch timeout inflates fallback volume

### Recommendations:

- Ready to commit — implementation is complete and validated.
- Run the live-run checklist above on the first production run after merge, and watch the skipped count in the judge log line.
