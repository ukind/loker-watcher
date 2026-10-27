---
date: 2026-10-27T10:12:53+0700
author: Yogiswara Utama
commit: 1cb1236
branch: ukind/add-reasoning-effort
repository: add-reasoning-effort
topic: "reasoning-effort-llm-judge"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, config-file, judge, reasoning-effort]
last_updated: 2026-10-27T10:25:06+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Add global reasoningEffort config knob to LLM judge

**Date**: 2026-10-27T10:12:53+0700
**Author**: Yogiswara Utama
**Commit**: 1cb1236
**Branch**: ukind/add-reasoning-effort
**Repository**: add-reasoning-effort

## Research Question

Add a global `reasoningEffort` configuration knob (`low`, `medium`, `high`, default `medium`) to the LLM judge in `loker-watcher`, validated as an enum, and injected into both bulk and single chat-completions payloads under a top-level `"reasoning": {"effort": <value>}` key.

## Summary

**Problem**: The FRD proposes a `reasoningEffort` enum config field that must flow from `watcher.config.json` through `loadWatcherConfig` into both judge payloads (`judgeBatch` bulk, `judgePost` single). The payload shape (`{"reasoning":{"effort":...}}`) is unverified against the configured `LLM_ACCOUNTS` endpoints — OpenAI's native Chat Completions API uses flat top-level `reasoning_effort`, not a nested object.

**Recommended**: Full feature — flat `reasoning_effort` injection, probe-gated — validate `reasoningEffort` in `src/config-file.ts`, thread through `judgePosts`, inject into both judge payloads; `scripts/probe-judge.ts` verifies endpoint acceptance before merge.

**Effort**: Medium (~2 days)

**Confidence**: High

## Problem Statement

**Requirements:**
- Add `reasoningEffort` as an enum field (`["low","medium","high"]`) to `WatcherConfig` in `src/config-file.ts`
- Validate the field: absent → `"medium"` silently, case-insensitive normalization (`"HIGH"` → `"high"`), invalid → throw naming `reasoningEffort`
- Add `"reasoningEffort"` to `ALLOWED_KEYS` so the unknown-key gate accepts it
- Do not break existing configs: committed `watcher.config.json` lacks the field and must keep loading

**Constraints:**
- Existing 16 `judgePosts` call sites in `tests/judge.test.ts` must not break — `reasoningEffort` added as optional parameter defaulting to `"medium"` to `judgePosts`/`judgeBatch`/`judgePost`
- Strict TypeScript flags stay on: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- Config validation fails loudly; invalid `reasoningEffort` throws naming the key (precedent from commit `b050436`)

**Success criteria:**
- `npm test` passes with new config-file test cases
- `npm run typecheck` passes with no errors
- `npm run lint` passes
- Committed `watcher.config.json` (without `reasoningEffort`) still loads with default `"medium"`

## Current State

**Existing implementation:**
- `WatcherConfig` interface at `src/config-file.ts:25-30` — declares `keywords`, `candidateTerms`, `surfaces`, `recencyHours`; no `reasoningEffort`
- `ALLOWED_KEYS` at `src/config-file.ts:32` — closed whitelist; unknown keys throw at `:71-76`
- `readRecencyHours` at `src/config-file.ts:154-159` — typed reader pattern (validate, coerce, default)
- `readSurfaces` at `src/config-file.ts:109-143` — enum validation pattern (`"tag"`/`"url"`)
- `validateConfig` at `src/config-file.ts:65-85` — dispatches to typed readers
- `judgeBatch` payload at `src/judge.ts:397-416` — `model`, `messages`, `temperature`, `response_format` (bulk-only rider)
- `judgePost` payload at `src/judge.ts:508-521` — `model`, `messages`, `temperature` only
- `judgePosts` signature at `src/judge.ts:595-605` — `(candidates, accounts, keywords, fetchFn)`
- `src/index.ts:53` — `loadWatcherConfig()`; `:94-97` — passes `config.keywords` to `judgePosts`

**Relevant patterns:**
- `readRecencyHours`: `src/config-file.ts:154-159` — default/throw pattern reference; used in 1 place
- `readSurfaces`: `src/config-file.ts:109-143` — enum validation pattern; used in 1 place
- `ALLOWED_KEYS` unknown-key gate: `src/config-file.ts:71-76` — enforced on every config load

**Integration points:**
- `src/config-file.ts:25-159` — config validation pipeline through `readRecencyHours` (only file changed under Option 1 fallback)
- `scripts/probe-judge.ts:185-195` — `bulkPayload` extension point for testing endpoint acceptance of reasoning payload shapes

## Solution Options

### Option 1: Full feature — flat `reasoning_effort` injection, probe-gated (Recommended)

**How it works:**
Add `reasoningEffort` enum validation to `loadWatcherConfig` in `src/config-file.ts` (`src/config-file.ts:25-159`), thread it through `src/index.ts:94-97` into `judgePosts`, and inject top-level `"reasoning_effort": <value>` into both `judgeBatch` (`src/judge.ts:397-404`) and `judgePost` (`src/judge.ts:508-512`) payloads as a sibling to `temperature`. Matches OpenAI's Chat Completions API shape — flat `reasoning_effort` has stronger acceptance evidence than the nested `reasoning: {effort}` object (Responses API only). Run `scripts/probe-judge.ts` before merge to verify the configured `LLM_ACCOUNTS` endpoints accept the field; if rejected, switch to nested shape at the two injection points (two-line change).

**Pros:**
- Delivers the full FRD feature in one change: config knob actually reaches the LLM (honors developer's global-knob, threading, default/throw decisions)
- Flat `reasoning_effort` is the OpenAI Chat Completions shape — materially stronger acceptance evidence than nested (evidence: web-search novelty dimension)
- Test breakage avoidable: `reasoningEffort` as optional `judgePosts` parameter defaulting to `"medium"` compiles cleanly at all 16 `tests/judge.test.ts` call sites (evidence: codebase-analyzer dimension integration-risk)
- Endpoint uncertainty is testable, not blocking: probe retires the shape risk before merge (evidence: FRD composite lesson, precedent `5f6a328`)
- Symmetric rollback: remove interface field, `ALLOWED_KEYS` entry, reader function, judge parameter, payload field, and tests; no orphaned state (evidence: migration-cost dimension)

**Cons:**
- Touches 5 seams: `src/config-file.ts`, `src/judge.ts`, `src/index.ts`, `tests/config-file.test.ts`, `tests/judge.test.ts` (evidence: integration-risk dimension)
- Production threading in `src/index.ts` required even if test breakage is avoided via optional parameter
- Endpoint acceptance still unverified until probe runs — if flat is rejected, follow-up switches to nested shape

**Complexity:** Medium (~2 days)
- Files to create: 0
- Files to modify: 5 (`src/config-file.ts`, `src/judge.ts`, `src/index.ts`, `tests/config-file.test.ts`, `tests/judge.test.ts`) (~70 lines)
- Risk level: Medium

### Option 2: Config-only, defer injection (fallback)

**How it works:**
Add `reasoningEffort` enum validation to `loadWatcherConfig` in `src/config-file.ts` only (`src/config-file.ts:25-159`). The field defaults to `"medium"` when absent, normalizes case, and throws naming `reasoningEffort` on invalid values. Judge payloads (`judgeBatch`, `judgePost`) are left unchanged. Payload injection is deferred until `scripts/probe-judge.ts` confirms which shape endpoints accept.

**Pros:**
- Lowest integration risk: only `src/config-file.ts` touched; `judge.ts`, `src/index.ts`, and all 16 `tests/judge.test.ts` call sites unchanged (evidence: codebase-analyzer dimension integration-risk)
- Symmetric, clean rollback: remove interface field, `ALLOWED_KEYS` entry, reader function, and tests; no orphaned state (evidence: migration-cost dimension)
- Lowest verification cost: 3-4 test cases in `tests/config-file.test.ts`, no judge test modifications (evidence: verification-cost dimension)

**Cons:**
- Config knob is inert until a follow-up injects into judge payloads — user-visible effect (reasoning effort reaching the LLM) is deferred (evidence: scope boundaries)
- Requires a second change (follow-up) to complete the full FRD feature
- Splits the developer-approved feature against the developer's recorded threading and injection decisions (Developer Context)

**Complexity:** Low (~1 day)
- Files to create: 0
- Files to modify: 2 (`src/config-file.ts`, `tests/config-file.test.ts`) (~40 lines)
- Risk level: Low

### Option 3: Nested reasoning object injection

**How it works:**
Add `reasoningEffort` to config, thread through judge functions, and inject `"reasoning": {"effort": <value>}` as a sibling to `temperature` in both payloads. Matches OpenAI's Responses API shape, not Chat Completions.

**Pros:**
- Matches the FRD's specified payload shape exactly (`.rpiv/artifacts/discover/2026-10-27_09-27-58_reasoning-effort-llm-judge.md:44-45`)
- Delivers the full FRD feature in one change

**Cons:**
- Endpoint acceptance unverified (not blocking): nested `{"reasoning":{"effort":...}}` shape may be rejected by `LLM_ACCOUNTS` endpoints — but this is testable via `scripts/probe-judge.ts`, not unmitigable breakage (evidence: FRD open question, composite lesson)
- Weaker acceptance evidence than flat: nested `reasoning: {effort}` is Responses API convention; Chat Completions payloads (`model`, `messages`, `temperature`) suggest flat `reasoning_effort` (evidence: web-search novelty dimension)
- High migration cost: same 5 seams + 16 test call sites as Option 1 (avoidable with optional param defaulting to `"medium"` for tests; production threading in `src/index.ts` still required), plus nested object construction
- Medium verification cost: nested object assertions are more complex than flat string checks
- Low-moderate novelty: nested shape is OpenAI Responses-API-specific, not a cross-provider standard (evidence: novelty dimension)

**Complexity:** Medium/High (~2-3 days)
- Files to create: 0
- Files to modify: 4-5 (`src/config-file.ts`, `src/judge.ts`, `src/index.ts`, `tests/config-file.test.ts`, `tests/judge.test.ts`) (~90 lines)
- Risk level: Medium

## Comparison

| Criteria | Option 1 (Full feature, flat, probe-gated) | Option 2 (Config-only defer) | Option 3 (Nested reasoning object) |
|---|---|---|---|
| Complexity | Medium | Low | Medium/High |
| Codebase fit | High | High | High |
| Risk | Medium | Low | Medium |
| Endpoint acceptance | Verified via probe before merge | Deferred (verified later) | Verified via probe before merge |
| Test changes | 16 call sites (avoidable with optional param defaulting to `medium`) + assertions | 3-4 cases, config-file only | 16 call sites (avoidable with optional param defaulting to `medium`) + nested assertions |
| Delivers full FRD feature | Yes | No | Yes |
| Shape evidence | Strong (Chat Completions flat `reasoning_effort`) | N/A — no injection | Weak (Responses API nested shape) |

## Recommendation

**Selected:** Option 1 — Full feature — flat `reasoning_effort` injection, probe-gated

**Rationale:**
- Honors the developer's four recorded decisions: global knob in `watcher.config.json`, threading `loadWatcherConfig` → `judgePosts` → `judgeBatch`/`judgePost`, absent → `"medium"` default, invalid throws naming `reasoningEffort` (Developer Context in research doc)
- Flat `reasoning_effort` has materially stronger acceptance evidence than nested — the judge payloads are Chat Completions-style (`model`, `messages`, `temperature`), and OpenAI's Chat Completions API uses flat `reasoning_effort` while nested `reasoning: {effort}` is Responses API-only (evidence: web-search novelty dimension)
- Endpoint acceptance risk is testable, not blocking: `scripts/probe-judge.ts` verifies before merge; if flat is rejected, switching to nested is a two-line change at the injection points (evidence: FRD composite lesson, precedent `5f6a328`)
- Delivers the full FRD feature in one change; config-only defer (Option 2) is the fallback if the probe cannot run

**Why not alternatives:**
- Option 2 (config-only defer): splits the developer-approved feature, leaving the knob inert until a follow-up — only justified if the probe cannot run
- Option 3 (nested): weaker acceptance evidence (Responses API shape on Chat Completions-style payloads); endpoint acceptance is still testable via probe, so not fit-filter blocking, but flat is the better first attempt

**Trade-offs:**
- Accepting that flat `reasoning_effort` may be rejected by non-OpenAI-compatible endpoints, requiring a follow-up switch to nested shape — mitigated by running `scripts/probe-judge.ts` before merge

**Implementation approach:**
1. Add `reasoningEffort?: "low"|"medium"|"high"` to `WatcherConfig` interface (`src/config-file.ts:28-34`)
2. Add `"reasoningEffort"` to `ALLOWED_KEYS` (`src/config-file.ts:32`)
3. Add `readReasoningEffort` reader following `readRecencyHours`/`readSurfaces` pattern — enum validation, case-insensitive, default `"medium"` on absence, throws naming `reasoningEffort` on invalid (`src/config-file.ts:65-85`)
4. Call `readReasoningEffort` in `validateConfig` return object (`src/config-file.ts:65-85`)
5. Add `reasoningEffort` parameter to `judgePosts` (`src/judge.ts:595`), `judgeBatch` (`src/judge.ts:397`), `judgePost` (`src/judge.ts:508`) — optional, defaulting to `"medium"`
6. Inject `"reasoning_effort": reasoningEffort` into both payload objects at `src/judge.ts:397-404` and `src/judge.ts:508-512`
7. Pass `config.reasoningEffort` at `src/index.ts:94-97`
8. Extend `scripts/probe-judge.ts:185` `bulkPayload` to carry `reasoning_effort`; run probe before merge
9. Add test cases: absent → `"medium"`, `"HIGH"` → `"high"`, `"extreme"` → throw naming `reasoningEffort` (`tests/config-file.test.ts:8-48`); add payload assertions at `tests/judge.test.ts:543-553`
10. If probe rejects flat, switch to nested `"reasoning": {"effort": ...}` at steps 6 injection points

**Integration points:**
- `src/config-file.ts:25-159` — config validation pipeline through `readRecencyHours`
- `src/index.ts:94-97` — `judgePosts` call site (thread `config.reasoningEffort`)
- `src/judge.ts:397-404` and `src/judge.ts:508-512` — payload injection points
- `scripts/probe-judge.ts:185-195` — `bulkPayload` extension for endpoint acceptance testing

**Patterns to follow:**
- `readRecencyHours`: `src/config-file.ts:154-159` — default/throw pattern
- `readSurfaces`: `src/config-file.ts:109-143` — enum validation pattern
- Optional parameter with default: `judgePosts` at `src/judge.ts:595` — avoids breaking 16 test call sites

**Risks:**
- Endpoint shape mismatch: flat `reasoning_effort` may be rejected — probe before merge, switch to nested if rejected
- Production threading in `src/index.ts` required — unavoidable for full feature delivery

## Scope Boundaries
- Building: `reasoningEffort` enum validation, threading through `judgePosts`, flat `reasoning_effort` injection into both judge payloads, probe verification before merge
- Not building: per-account `reasoningEffort` overrides (developer confirmed global knob only); nested shape unless probe rejects flat

## Testing Strategy

**Unit tests:**
- Absent `reasoningEffort` → config loads, field defaults to `"medium"`
- `"HIGH"` → `"high"` (case-insensitive normalization)
- `"extreme"` → throws error naming `reasoningEffort`
- Payload carries `reasoning_effort` on bulk and single paths (`tests/judge.test.ts:543-553`)

**Integration tests:**
- `scripts/probe-judge.ts` bulk call carries `reasoning_effort`; verify endpoint accepts flat shape before merge
- If rejected, switch to nested `"reasoning": {"effort": ...}` at the two injection points

**Manual verification:**
- [ ] Run `npm test` — config-file tests pass
- [ ] Run `npm run typecheck` — no type errors
- [ ] Run `npm run lint` — no lint errors
- [ ] Run `scripts/probe-judge.ts` — endpoint acceptance of reasoning payload shapes

## Open Questions

**Resolved during research:**
- Payload shape: OpenAI Chat Completions uses flat `reasoning_effort`; Responses API uses nested `reasoning: {effort}` — which `LLM_ACCOUNTS` endpoints accept is unresolved → deferred to `scripts/probe-judge.ts` verification

**Requires user input:**
- Do you accept flat `reasoning_effort` as the payload shape (probe-decided), overriding the nested choice recorded in Developer Context? Default assumption: yes, flat, pending probe verification.
- Whether to switch to nested `"reasoning": {"effort": ...}` if probe rejects flat — default assumption: yes, two-line change at injection points

**Blockers:**
- None — Option 1 clears all fit dimensions

## References
- `.rpiv/artifacts/research/2026-10-27_09-43-34_reasoning-effort-llm-judge.md` — FRD and detailed findings
- `src/config-file.ts:25-159` — config validation precedent (readRecencyHours, readSurfaces, ALLOWED_KEYS)
- `scripts/probe-judge.ts:185-195` — probe harness for endpoint acceptance testing
