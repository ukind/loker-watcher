---
date: 2026-10-27T09:43:34+0700
author: Yogiswara Utama
commit: 1cb1236
branch: ukind/add-reasoning-effort
repository: add-reasoning-effort
topic: "reasoning-effort-llm-judge"
tags: [research, codebase, judge, config-file, reasoning-effort]
status: ready
last_updated: 2026-10-27T09:43:34+0700
last_updated_by: Yogiswara Utama
---

# Research: reasoning-effort-llm-judge

## Research Question
Add a global `reasoningEffort` configuration knob (`low`, `medium`, `high`, default `medium`) to the LLM judge in `loker-watcher`, validated as an enum, and injected into both bulk and single chat-completions payloads under a top-level `"reasoning": {"effort": <value>}` key.

## Summary
The FRD adds a global config knob `reasoningEffort` (enum `["low","medium","high"]`, default `medium`) that flows through `loadWatcherConfig` (`src/config-file.ts`) into the judge payload (`src/judge.ts: judgeBatch` bulk, `judgePost` single). The config must be allowed through `ALLOWED_KEYS`, read via a new `readReasoningEffort` reader, and injected into the chat-completions body as `"reasoning": {"effort": <value>}`. The primary open research question is which payload shape the configured LLM accounts accept: the FRD's chosen nested shape (`reasoning: {effort: ...}`) is unverified, while OpenAI's native API uses a flat top-level `reasoning_effort` string.

## Detailed Findings

### Config validation
- `WatcherConfig` interface is at `src/config-file.ts:25-30`; `ALLOWED_KEYS` at `src/config-file.ts:32`.
- `validateConfig` loops unknown keys (`src/config-file.ts:71-76`) and destructures four fields (`src/config-file.ts:89-92`).
- `readStringArray` at `src/config-file.ts:87`, `readRecencyHours` at `src/config-file.ts:154` are the validation patterns.
- A new `readReasoningEffort` must accept `undefined`, normalize case, enforce enum, return `"medium"` on absence, and throw naming `reasoningEffort`.

### Judge payload injection
- Bulk payload: `const payload` at `397`, `response_format: {type: "json_object"}` at `403` (rider comment at `401-402`), `body: JSON.stringify(payload)` at `412`; inject at `397` sibling to `temperature`. Range `397-404`.
- Single-post payload: `const payload` at `508`, `body: JSON.stringify(payload)` at `520`; inject at `508` sibling to `temperature`. Range `508-512`. The `response_format` rider is bulk-only (`401-402`).
- `judgeBatch` and `judgePost` are invoked via `judgePosts` at `src/judge.ts:595-605` (`judgePosts(candidates, accounts, keywords, fetchFn)`).
- `src/index.ts:68` loads `loadWatcherConfig()`; `src/index.ts:94-97` passes `resolveJudgeConfig(process.env)` as accounts and `config.keywords` as keywords — a new param/threading is required to carry `config.reasoningEffort` in.

### Test surface
- `tests/config-file.test.ts:8-13` `VALID` fixture lacks `reasoningEffort`; helpers at `:20-27`; assertions `:38-48`. Must add assertions for absent→`"medium"`, `"HIGH"`→`"high"`, `"extreme"`→throw naming `reasoningEffort`.
- Mock harness `tests/judge.test.ts:543-553` captures `bodies`; assertion `"reasoning":{"effort":"medium"}` must be added (not present today) on bulk (`judgeBatch` payload `397`) and single (`judgePost` payload `508`).

### Endpoint acceptance (open)
- FRD open question at `.rpiv/artifacts/discover/2026-10-27_09-27-58_reasoning-effort-llm-judge.md:44-45`.
- `scripts/probe-judge.ts:186-195` `bulkPayload` includes no reasoning fields; extend to test nested vs flat shape.

## Code References
- `src/config-file.ts:25-30` — `WatcherConfig` interface (needs `reasoningEffort`).
- `src/config-file.ts:32` — `ALLOWED_KEYS` (needs `reasoningEffort`).
- `src/config-file.ts:65-85` — `validateConfig` (unknown-key loop, field destructuring).
- `src/config-file.ts:154-159` — `readRecencyHours` (default/throw pattern reference).
- `src/judge.ts:63-67` — `LlmAccount` interface.
- `src/judge.ts:171-172` — `resolveJudgeConfig` (env-only, returns `LlmAccount[]`).
- `src/judge.ts:397-416` — `judgeBatch` payload.
- `src/judge.ts:508-521` — `judgePost` payload.
- `src/judge.ts:595-605` — `judgePosts` signature.
- `watcher.config.json` — source file for the new `reasoningEffort` field (FRD: extend with enum key).
- `src/index.ts:68-97` — `loadWatcherConfig` + `judgePosts` call site.
- `tests/config-file.test.ts:8-13` (`VALID` fixture) / `:20-27` (`writeConfig` / `writeRawConfig` helpers) / `:38-48` (failure assertions).
- `tests/judge.test.ts:543-553` — mock fetch harness capturing bodies.
- `scripts/probe-judge.ts:5-6` — usage; `scripts/probe-judge.ts:186-195` — `bulkPayload`.

## Integration Points
- Inbound: `src/index.ts:68` → `loadWatcherConfig` → `src/index.ts:94-97` → `judgePosts` → `judgeBatch` / `judgePost`.
- Outbound: `judgeBatch` (`397`) and `judgePost` (`508`) → normalized chat-completions endpoint (`src/judge.ts:217-224`).
- Design boundary: bulk-only `response_format` rider (`401-402`); same `reasoning` shape must hold on both paths.
- Docs sync (from precedent `e316cb5`): `README.md` (setup/LLM_ACCOUNTS section) and `src/heartbeat.ts` (heartbeat vocabulary) must change in the same commit.

## Architecture Insights
- Pattern: validate-then-inject; new enum field follows `readStringArray`/`readRecencyHours` style, must handle `undefined` differently (silent default) vs `readRecencyHours` (strict number).
- Integration decision needed: thread `reasoningEffort` into `judgePosts` via new parameter (global knob, not per-account) — breaks 16 `tests/judge.test.ts` call sites (verified by `grep -c "judgePosts("`) that currently pass `(candidates, accounts, keywords)` — see `tests/judge.test.ts:382,405,428,455,478,500,525,548,562,578,595,635,667,687,701,722`.

## Precedents & Lessons
### Precedent: JSON config as source of truth with URL surfaces
**Commit(s)**: `b050436` — "feat: json config as source of truth with url surfaces" (2026-10-25)
**Blast radius**: `src/config.ts`, `src/config-file.ts`, `src/index.ts`, `.github/workflows/watch.yml`
**Lessons from docs**: Missing/malformed config "fails the run loudly instead of falling back". Invalid `reasoningEffort` must throw naming the field; absent field must silently default to `"medium"`.
**Takeaway**: Config validation changes must throw loudly with the offending key named; silent defaults only for absence.

### Precedent: judge posts against configured keywords in bulk
**Commit(s)**: `e316cb5` — "feat: judge posts against configured keywords in bulk" (2026-10-26); **Follow-up**: `fda50c2` — "fix: defer unanswered judge batches, raise the request timeout" (2026-10-26)
**Blast radius**: 11 files, ~632 insertions / ~394 deletions across `src/judge.ts`, `tests/judge.test.ts`, `src/index.ts`, `src/heartbeat.ts`, `src/keywords.ts` (deleted).
**Lessons from docs**: Design doc `.rpiv/artifacts/designs/2026-10-26_06-51-45_model-judged-keywords.md` — "this repo was burned by stale-docs follow-up commits (67a9bd2); one-item-one-name applies to docs too".
**Takeaway**: Payload/config changes ripple across many files including docs; follow-ups like `fda50c2` landed within a day — verify endpoint tolerance before shipping new payload keys.

### Precedent: ramp concurrent calls in the judge probe
**Commit(s)**: `5f6a328` — "feat: ramp concurrent calls in the judge probe" (2026-10-26); **Follow-up**: `73d6786` — "feat: probe judge latency and raise the watch job budget" (2026-10-26)
**Blast radius**: `scripts/probe-judge.ts`
**Takeaway**: Use the probe as the verification vehicle for endpoint acceptance of new payload fields.

### Composite Lessons
- Endpoint shape is unverified and risky. The FRD flags it: OpenAI uses flat top-level `reasoning_effort`; the chosen nested `{"reasoning":{"effort":"medium"}}` may be rejected. Verify via `scripts/probe-judge.ts` before shipping; expect follow-ups like `fda50c2` if endpoints misbehave.
- Silent default has hidden cost. Absent `reasoningEffort` → `"medium"` changes cost/latency on honoring endpoints with no user-visible signal.
- Config validation must fail loudly but keep backward compat. Follow `b050436` contract: invalid throws naming the key; absent defaults.
- Judge changes have wide blast radius including docs. Sync docs in the same commit as `reasoningEffort` injection.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-10-27_09-27-58_reasoning-effort-llm-judge.md` — FRD for this feature.
- `.rpiv/artifacts/designs/2026-10-26_06-51-45_model-judged-keywords.md` — design for the prior bulk-judge change.

## Developer Context
**Q (src/config-file.ts:25): Should reasoning effort be configured in watcher.config.json globally or per-account on LLM_ACCOUNTS?**
A: Global `watcher.config.json` field (Option A confirmed). Global knob for the whole run; no per-account override.

**Q (src/judge.ts:171): How should the reasoning value flow from config to judge payload?**
A: Global `watcher.config.json` file (not `LLM_ACCOUNTS`). Pass through `loadWatcherConfig` → `judgePosts`; inject into `judgeBatch` (`397`) and `judgePost` (`508`) payloads as `"reasoning": {"effort": value}`.

**Q (src/judge.ts:397): Where does reasoning belong in the payload?**
A: Nested `"reasoning": {"effort": <value>}` sibling to `temperature`. Bulk payload at `397`; single payload at `508`. Bulk-only `response_format` rider (`401-402`) stays separate.

**Q (src/config-file.ts:154): How should default and invalid values be handled?**
A: Absent → `"medium"` silently; invalid → throw naming `reasoningEffort` at config load. Case-insensitive normalization (`"HIGH"` → `"high"`).

## Related Research
- `.rpiv/artifacts/discover/2026-10-27_09-27-58_reasoning-effort-llm-judge.md` — FRD source for this feature.

## Open Questions
1. Does the endpoint in `LLM_ACCOUNTS` accept the nested `reasoning: {effort: ...}` shape, or only OpenAI's flat `reasoning_effort` string? — unverified (FRD lines 44-45).
2. Does defaulting to `"medium"` change cost/latency on endpoints that honor the param? — unverified (FRD line 45).