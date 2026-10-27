---
date: 2026-10-27T09:27:58+0700
author: Yogiswara Utama
commit: 1cb1236
branch: ukind/add-reasoning-effort
repository: add-reasoning-effort
topic: "reasoning-effort-llm-judge"
tags: [intent, frd, judge, config-file]
status: ready
last_updated: 2026-10-27T09:27:58+0700
last_updated_by: Yogiswara Utama
---

# FRD: reasoning-effort-llm-judge

## Summary
This feature adds a global `reasoningEffort` configuration knob (`low`, `medium`, `high`, default `medium`) to the LLM judge in `loker-watcher`, enabling maintainers to control reasoning depth for cost/quality tradeoffs without per-account gymnastics. The knob lives in `watcher.config.json`, validated as an enum, and is injected into both bulk and single chat-completions payloads under a top-level `"reasoning": {"effort": <value>}` key.

## Problem & Intent
Maintainer / operator wants a consistent, easy-to-use knob to tune LLM reasoning effort across runs, balancing cost against relevance quality. Today the judge runs with fixed behavior (no explicit reasoning parameter); this feature introduces a single config value that defaults to `"medium"` when absent, so existing `watcher.config.json` files keep loading without edits.

## Goals
- Provide a global, single-knob configuration for reasoning depth across all runs (no per-account gymnastics).
- Default to `"medium"` when the field is absent, so existing `watcher.config.json` files keep loading without edits.
- Reject any value outside `low`/`medium`/`high` at config load, with an error naming `reasoningEffort`.

## Non-Goals
- No per-account `reasoningEffort` override on `LLM_ACCOUNTS`.

## Functional Requirements
1. **Add `reasoningEffort` field** to `watcher.config.json` schema, validated as enum `["low","medium","high"]`, default `"medium"`.
2. **Case-insensitive normalization**: `"MEDIUM"` → `"medium"`; invalid values throw during config load.
3. **Inject into judge payload**: merge `"reasoning": {"effort": value}` into the `chat/completions` request body for both bulk (`judgeBatch`, `src/judge.ts:410`) and single (`judgePost`, `src/judge.ts:517`) paths.

## Non-Functional Requirements
- **Performance**: reasoning effort can raise latency and token use on endpoints that honor it; no numeric target set.
- **Security**: none — the value is not a secret and `watcher.config.json` is committed.
- **Reliability**: absent field defaults to `"medium"`; invalid value fails config load with a message naming `reasoningEffort`.

## Constraints & Assumptions
- Must follow existing `src/config-file.ts` validation pattern (see `readStringArray`, `readRecencyHours`).
- Must pass through `resolveJudgeConfig` → `judgePosts` flow in `src/judge.ts` (`src/judge.ts:162`, `src/index.ts:96`).
- Value is read once at startup; no runtime reconfiguration.
- **Unverified — the configured endpoints accept `reasoning: {effort: ...}`.** OpenAI's own API uses top-level `reasoning_effort` as a string; the chosen nested shape is used by some OpenAI-compatible gateways. `research` must confirm which shape the accounts in `LLM_ACCOUNTS` accept, and whether unknown fields are rejected.
- **Unverified — defaulting to `medium` changes cost/latency** on endpoints that honor the param, since no reasoning param is sent today.

## Acceptance Criteria
- `npm test` exits 0, including a case in `tests/config-file.test.ts` asserting: absent field → `"medium"`; `"HIGH"` → `"high"`; `"extreme"` → throws naming `reasoningEffort`.
- A judge test with a mocked `fetch` asserts the request body contains `"reasoning":{"effort":"medium"}` on both the bulk path (`src/judge.ts:402-410`) and the single-post path (`src/judge.ts:512-517`). Check for an existing judge test file first; create one if absent.
- `npm run typecheck` and `npm run lint` exit 0.

## Recommended Approach
Add `reasoningEffort` to `WatcherConfig` (camelCase key in `watcher.config.json`, matching `recencyHours`/`candidateTerms`). Validate enum `["low","medium","high"]` with default `"medium"`. Inject as `"reasoning": {"effort": value}` in `chat/completions` request body (both bulk and single paths). This follows existing config pattern and keeps one knob for maintainer control.

## Decisions

### Config location
**Question**: Should reasoning effort be configured in `watcher.config.json` globally or per-account on `LLM_ACCOUNTS`?
**Recommended**: Option A — global `watcher.config.json` field.
**Chosen**: Option A confirmed by user. Reasoning effort is a global knob for the whole run.
**Rationale**: Pattern match with existing `keywords`/`candidateTerms` in `watcher.config.json`; consistent location; one knob for operator control.

### Enum values
**Question**: What exact enum values should `reasoningEffort` accept?
**Recommended**: `["low","medium","high"]`.
**Chosen**: `low, medium, high (default: medium)`.
**Rationale**: Standard three-tier scale. Matches common LLM provider patterns and is self-documenting.

### Payload nesting
**Question**: Where should `reasoningEffort` appear in the judge chat-completions payload?
**Recommended**: `reasoning: {effort: "medium"}` (shallow object).
**Chosen**: `reasoning: {effort: "medium"}`.
**Rationale**: Maximum clarity and future-proofing. One key `"reasoning"` can expand to include `"budget_tokens"`, `"max_cpu_pct"`, or other LLM-specific reasoning controls without breaking existing code.

### Default behavior
**Question**: How should the default `'medium'` be applied when `reasoningEffort` is missing from config?
**Recommended**: Default to `'medium'` without warning.
**Chosen**: Default to `'medium'` without warning.
**Rationale**: Keeps existing `watcher.config.json` files loading without edits; no noise in logs.

### Goals and Non-Goals
**Question**: What are the in/out scope boundaries for this feature?
**Recommended**: (advisor-reviewed text, applied to FRD)
**Chosen**: Global knob; default `"medium"` on absence so existing config keeps loading; reject values outside `low`/`medium`/`high` at load with an error naming `reasoningEffort`; no per-account override; no runtime switching.
**Rationale**: Developer delegated confirmation to advisor after repeated "ask advisor" picks.

### Acceptance criteria
**Question**: What observable pass conditions must a reviewer check?
**Recommended**: (advisor-reviewed text, applied to FRD)
**Chosen**: `npm test` exits 0 with config-file assertions (absent → `"medium"`, `"HIGH"` → `"high"`, `"extreme"` → throws naming `reasoningEffort`); mocked-`fetch` judge test asserts `"reasoning":{"effort":"medium"}` on both `src/judge.ts:402-410` and `:512-517`; `npm run typecheck` and `npm run lint` exit 0.
**Rationale**: Offline-only criteria; no live endpoint dependency.

### Non-functional requirements and constraints
**Question**: What performance, security, reliability, and constraint expectations apply?
**Recommended**: (advisor-reviewed text, applied to FRD)
**Chosen**: Performance can raise latency/tokens on endpoints that honor the param, no numeric target; security none (value is not a secret); reliability default-on-absence / invalid-throws; follow `src/config-file.ts` validation pattern; pass through `resolveJudgeConfig` → `judgePosts` (`src/judge.ts:162`, `src/index.ts:96`); value read once at startup.
**Rationale**: Developer delegated confirmation to advisor after repeated "ask advisor" picks.

### Case-insensitive normalization
**Question**: Should input be normalized case-insensitively, and should invalid values throw?
**Recommended**: (advisor-reviewed text, applied to FRD)
**Chosen**: `"HIGH"` → `"high"`; invalid values throw at config load naming `reasoningEffort`.
**Rationale**: Acceptance criteria assert this behavior; developer delegated confirmation to advisor.

## References
- `watcher.config.json` — source of truth for keywords, surfaces, recencyHours; extend with `reasoningEffort` field.
- `src/judge.ts` — judge implementation; injection points at `judgeBatch:410` and `judgePost:517`; `LlmAccount` interface (`src/judge.ts:63-67`).
- `src/config-file.ts` — validation pattern to extend; `readStringArray`, `readRecencyHours` models for enum validation style.
- Metadata block: `2026-10-27T09:27:58+0700`, `1cb1236`, `ukind/add-reasoning-effort`, `Yogiswara Utama`.
- `scripts/probe-judge.ts` — endpoint probe; verify effort param shape accepted by configured accounts.