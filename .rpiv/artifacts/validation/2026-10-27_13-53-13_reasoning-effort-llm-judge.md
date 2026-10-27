---
template_version: 1
date: 2026-10-27T13:53:13+0700
author: Yogiswara Utama
commit: 1cb1236
branch: ukind/add-reasoning-effort
repository: add-reasoning-effort
topic: "Validation of Add global reasoningEffort config knob to LLM judge"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-27_12-08-40_reasoning-effort-llm-judge.md"
tags: [validation, reasoning-effort, config-file, judge]
last_updated: 2026-10-27T15:10:37+0700 (live-probe follow-up)
---

## Validation Report: Add global reasoningEffort config knob to LLM judge

### Implementation Status

- ✓ Phase 1: Config knob + docs + tests — Fully implemented
- ✓ Phase 2: Judge injection + tests — Fully implemented
- ✓ Phase 3: Wiring + probe + baseline — Fully implemented (live probe executed in the same-session follow-up)

This run re-validated after the plan revision (Phase 2 gained the bulk-miss fallback-forwarding regression test). It executed the manual criteria the previous run could not, per the run input "validate the manual testing too". A same-session follow-up then ran the live probe with an operator-supplied account pool: all 7 manual criteria now carry direct evidence (see Manual Testing Required).

### Automated Verification Results

- ✓ Full test suite: `npm test` — 127 pass, 0 fail (126 before the revision; +1 is the fallback-forwarding regression test at tests/judge.test.ts:830)
- ✓ Typecheck: `npm run typecheck` — exit 0 over src/, tests/, scripts/
- ✓ Lint: `npm run lint` — 22 files checked, no fixes applied (covers src/judge.ts and tests/judge.test.ts)
- ✓ Grep bulk+single injections: `grep -n "reasoning_effort" src/judge.ts` — exactly 2 (lines 403, 516)
- ✓ Grep probe payload: `grep -n "reasoning_effort" scripts/probe-judge.ts` — exactly 1 (line 189)
- ✓ Grep production wiring: `grep -n "config.reasoningEffort" src/index.ts` — exactly 1 (line 99)
- ✓ No regressions detected — all pre-existing tests pass; the single production `judgePosts` call site (src/index.ts:94) is wired

### Code Review Findings

#### Matches Plan:

- src/config-file.ts:25 — `export type ReasoningEffort = "low" | "medium" | "high"`
- src/config-file.ts:34 — `reasoningEffort: ReasoningEffort` required on `WatcherConfig`
- src/config-file.ts:39-46 — `"reasoningEffort"` registered in `ALLOWED_KEYS`
- src/config-file.ts:96, 99 — reader wired into the `validateConfig` dispatch and return object
- src/config-file.ts:172-189 — reader: absent → "medium", case-insensitive normalization, invalid and non-string values throw naming `reasoningEffort`
- src/judge.ts:27 — type-only `import type { ReasoningEffort } from "./config-file.js"`
- src/judge.ts:381, 502, 605 — trailing `reasoningEffort: ReasoningEffort = "medium"` on `judgeBatch`, `judgePost`, `judgePosts`
- src/judge.ts:401-405 — bulk payload: flat `reasoning_effort` top-level, sibling to `temperature`; `response_format` comment scoped to that key
- src/judge.ts:513-517 — single-post payload: flat `reasoning_effort` top-level, sibling to `temperature`, no `response_format`
- src/judge.ts:630, 655-656 — both internal call sites forward `reasoningEffort`
- src/index.ts:94-100 — `judgePosts(newPosts, resolveJudgeConfig(process.env), config.keywords, fetch, config.reasoningEffort)` — fetch is 4th, effort is 5th
- scripts/probe-judge.ts:26, 185-191 — `CONFIG = await loadWatcherConfig()` at startup; `bulkPayload` carries `reasoning_effort: CONFIG.reasoningEffort` sibling to `temperature`
- tests/config-file.test.ts — the 4 planned cases exist and pass (absent → medium, "HIGH" → high, "extreme" throws, 123 throws)
- tests/judge.test.ts:754-863 — payload assertion suites for both paths (default + explicit), plus the bulk-miss fallback-forwarding regression test
- README.md:79 — config-keys table documents `reasoningEffort` with the default

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan. Cited line numbers drifted by a few lines (plan's judge.ts:620 forward sits at 630; plan's 650 fallback sits at 655-656); content matches everywhere.

#### Pattern Conformance:

- ✓ `readReasoningEffort` mirrors the sibling readers: module-private, `config: ${filePath} "reasoningEffort"` error prefix, `${JSON.stringify(value)}` for the offending value (same style as `readSurfaces`). One intentional difference, per plan: absent value defaults to "medium" where `readRecencyHours` rejects absence — that default is the feature.
- ✓ Tests follow the existing describe/it + node:assert patterns and reuse the file's mock-fetch helpers; no bare `posts[0]` under `noUncheckedIndexedAccess`.
- ✓ Drift sweep: `reasoning_effort` appears only in src/judge.ts (2), scripts/probe-judge.ts (1), and tests/judge.test.ts. README and workflows carry no stale claims about the payload shape.

### Manual Testing Required:

Executed this run (evidence above):

1. Committed config default (Phase 1 + Phase 3):
   - [x] watcher.config.json has no `reasoningEffort` key (grep exit 1)
   - [x] `loadWatcherConfig()` on the committed file returns `reasoningEffort=medium` — runtime check via a scratch tsx script, deleted after the run
   - [x] The probe makes the identical call at startup (scripts/probe-judge.ts:26), and its payload resolves to `reasoning_effort: "medium"` for the committed config
2. Reader pattern (Phase 1):
   - [x] `readReasoningEffort` throws with the `config: ${filePath} "reasoningEffort"` prefix — code inspection + the 4 config tests passing
3. Payload shape (Phase 2):
   - [x] `reasoning_effort` is flat top-level, sibling to `temperature`, in both payloads — inspection + runtime assertions in tests/judge.test.ts (medium/low/high on bulk and fallback paths, high on the bulk-miss fallback)
4. Lint (Phase 2): `npm run lint` passes — recorded under Automated Verification
5. Type-only import erased (Testing Strategy step 3): `import type` at src/judge.ts:27 under `verbatimModuleSyntax`; judge tests import the module at runtime and pass, so no runtime edge to config-file.ts

Executed in the same-session follow-up (live probe, operator-supplied pool):

1. Live probe (Phase 3):
   - [x] z.ai `glm-5.3-flash` (api.z.ai coding endpoint): minimal 200 (1.8s), bulk 200 + JSON (10.2s), bulk again 200 (10.6s) — the flat `reasoning_effort` field is accepted; no 400, so the nested-shape contingency is NOT needed
   - [x] Ramp: 2/2 ok, 4/4 ok, 8 → 5/8 (3 refused, HTTP 429) → ceiling 4 → recommended JUDGE_CONCURRENCY = 4 (matches the configured default); probe exit 0
   - [x] openrouter `nemotron` free tier in pool position 1: every call `HTTP 429 REFUSED`, probe exit 1 — matches the operator's report of that account's rate-limit state; the dead-endpoint exit signal works as designed

### Recommendations:

- Ready to commit — implementation is complete and validated; every plan criterion, automated and manual, now carries evidence. The plan's manual boxes stay unchecked in the plan file (validate does not edit plans); the evidence lives here.
- Non-blocking observation: the probe judges `LLM_ACCOUNTS[0]` only, so a rate-limited first account fails the probe even when a healthy account sits in position 2 (seen in this follow-up: exit 1 on the all-429 openrouter head, exit 0 after reordering). The production judge rotates on 429 run-sticky, so runs are unaffected; reorder the pool when position 1 is throttled.
