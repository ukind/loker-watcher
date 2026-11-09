---
date: 2026-11-09T10:45:16+0700
author: Yogiswara Utama
commit: ccee5dc
branch: main
repository: loker-watcher
topic: "negative keywords for the judge"
tags: [intent, frd, judge, config-file]
status: ready
last_updated: 2026-11-09T10:45:16+0700
last_updated_by: Yogiswara Utama
---

# FRD: Negative keywords for the judge

## Summary
Add an optional `negativeKeywords` string array to `watcher.config.json`. When set, the LLM judge's system prompt gains a hard-veto criterion: a post matching a negative category is not relevant, even when it matches a keyword. The digest, heartbeat, email, state, workflow, and probe all stay unchanged.

## Problem & Intent
The developer's framing, verbatim: "i want to add negative prompt into watcher.config.json. like 'not student' or 'not fresher' or 'not outsourcing' etc is that possible? or i need separated feature to add negative prompt?"

Answer from the probe: possible, no separate feature. The interview pinned the pain as "Keyword dead end" — positive keywords alone cannot express what the operator wants; adding more keywords made matches worse, not better. Posts targeting students or fresh graduates, or posted by outsourcing agencies, pass the positive-keyword filter today. The operator wants to name categories to exclude in the committed config file, with no code change per exclusion.

## Goals
- The operator names exclusion categories in `watcher.config.json` only.
- The judge rejects a negative-category post even on a keyword hit (hard veto).
- The judge stays the single relevance decider, so exclusions match meaning ("agency placement", "fresh graduate welcome"), not literal substrings.
- Existing configs without the key keep working with a byte-identical prompt.

## Non-Goals
- No client-side substring filter stage. It would drop posts on negation phrasing ("we are not an outsourcing agency") and miss unspoken phrasing.
- No probe re-measurement. The probe keeps measuring the positive-only prompt; the builder grows an optional parameter instead.
- No digest, heartbeat, or email changes. Rejected posts are not marked or explained.
- No verdict-shape change. `{relevant, locationOk}` stays.
- No new env vars, secrets, or workflow edits.

## Functional Requirements
1. `src/config-file.ts` SHALL accept an optional `negativeKeywords` key: absent resolves to `[]`; present must be an array of non-empty strings; an empty array is valid; any other shape throws naming the file path and the key. The key joins `ALLOWED_KEYS`.
2. `buildMessages` and `buildBulkMessages` in `src/judge.ts` SHALL take an optional `negativeKeywords` parameter (default: none). When non-empty, the system message gains the hard-veto criterion plus the serialized negative list. When absent or empty, the system message stays byte-identical to today's.
3. The veto wording SHALL bind harder than the keyword clause, in the style of: a post is NOT relevant when it targets students or fresh graduates, or when it is posted by or for an outsourcing or staffing agency — even when it matches a keyword above.
4. `src/index.ts` SHALL pass `config.negativeKeywords` through `judgePosts` → `judgeBatch`/`judgePost` → both builders.
5. Tests SHALL cover: config validation (absent, present, empty, invalid), builder output with and without negatives, and a mock-fetch judge scenario where a keyword-matching post carrying a negative category returns `relevant: false`.
6. Stored values SHOULD be bare category concepts ("student", "fresher", "outsourcing"), not "not student" — the prompt supplies the negation; storing "not X" double-negates.

## Non-Functional Requirements
- **Performance**: The prompt grows by one sentence plus the serialized array. The growth is operator-bounded (short phrases). No new network calls.
- **Security**: Negatives are operator-authored config data interpolated into the system message — the trusted side, same as `keywords` today. The untrusted-data fence sentence around post content stays.
- **UX / Accessibility**: The operator edits one committed JSON file. Validation errors name the file path and the key (repo doctrine).
- **Reliability**: Fail-visible validation. The only default is the sanctioned optional-key default `[]`; no silent fallbacks beyond it.

## Constraints & Assumptions
- `ALLOWED_KEYS` is a closed set — the key must be registered there, or every valid config fails with "unknown key" (`src/config-file.ts:54`).
- Probe contract: `scripts/probe-judge.ts:247` stays untouched, so the builder parameter must default to none. The probe's committed ceilings then describe the positive-only prompt.
- Assumption: the endpoint obeys the veto instruction reliably enough. A misjudge degrades to today's behavior — an unwanted post passes — and the operator refines the terms.
- Assumption: the duplicated system-message text in the two builders (`src/judge.ts:236`, `src/judge.ts:263`) may be lifted into one shared constant during implementation; research decides.

## Acceptance Criteria
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` all exit 0.
- [ ] Today's `watcher.config.json` (no `negativeKeywords`) loads unchanged, and the judge system message is byte-identical to the current one.
- [ ] With `negativeKeywords` set, the system message contains the veto criterion and the serialized list, and a mock-fetch judge scenario returns `relevant: false` for a keyword-matching post carrying a negative category.
- [ ] `"negativeKeywords": []` and an absent key both mean "no exclusions"; a non-string or empty-string item throws naming the file path and the key.

## Recommended Approach
Extend `src/config-file.ts` (`ALLOWED_KEYS` plus an optional string-array validator in the `readReasoningEffort` undefined-default shape), thread an optional `negativeKeywords` parameter from `src/index.ts` through `judgePosts` → `judgeBatch`/`judgePost` into both prompt builders, and append one veto sentence plus the `JSON.stringify`-ed list to the system message when non-empty. No workflow, email, state, or probe changes.

## Decisions

### Feasibility — separate feature?
**Question**: "is that possible? or i need separated feature to add negative prompt?"
**Recommended**: n/a — direct answer from the probe
**Chosen**: Possible. One config key plus judge prompt wiring. No separate feature.
**Rationale**: evidence: src/judge.ts:236, src/judge.ts:263 (the criterion seam), src/config-file.ts:54 (the closed key set)

### Intent — the pain
**Question**: "When a post like 'fresh graduate internship' or 'outsourcing agency hiring' lands in your digest today, what actually goes wrong for you?"
**Recommended**: n/a — intent question
**Chosen**: "Keyword dead end" — positive keywords alone cannot express what I want; adding more keywords made matches worse, not better.
**Rationale**: developer's own framing, captured verbatim

### Blast radius — judge only
**Question**: "The judge's system prompt is the only place relevance is decided. Keep the blast radius that small?"
**Recommended**: Yes, judge only
**Chosen**: Yes, judge only
**Rationale**: evidence: probe report — digest, heartbeat, and email never read keywords + confirmed

### Key shape — string array
**Question**: "Negative terms fit as a new `negativeKeywords` string array, validated like keywords. Keep this name and shape?"
**Recommended**: negativeKeywords array
**Chosen**: negativeKeywords array
**Rationale**: evidence: src/config-file.ts:108 + confirmed

### Probe scope — skip
**Question**: "Should the probe pass the negatives too, or keep measuring the positive-only prompt?"
**Recommended**: Yes, probe too
**Chosen**: Skip the probe
**Rationale**: operator choice. Consequence folded in: the builder parameter is optional with a none default, so `scripts/probe-judge.ts:247` needs no edit; the committed ceilings describe the positive-only prompt.

### Binding — hard veto
**Question**: "When a post matches a keyword AND contains a negative term, what should the judge do?"
**Recommended**: Hard veto
**Chosen**: Hard veto
**Rationale**: the operator wants these categories out. Rare false drops (a post saying "we are not outsourcing") are accepted and fixable by refining terms.

### Key presence — optional
**Question**: "Must `negativeKeywords` always exist in the config, or can the key be absent?"
**Recommended**: Optional key
**Chosen**: Optional key
**Rationale**: "no exclusions" is a benign default; matches the reasoningEffort/scrollRounds precedent (src/config-file.ts:187, src/config-file.ts:207)

### Empty list — allowed
**Question**: "Should an explicit `"negativeKeywords": []` be valid or an error?"
**Recommended**: Allowed, means none
**Chosen**: Allowed, means none
**Rationale**: evidence: src/config-file.ts:109 (candidateTerms may be empty) + confirmed

## Open Questions
None — every interview branch resolved to a Decision.

## Suggested Follow-ups
- Digest marking of rejected posts — declined via the "judge only" decision.
- Re-run the judge probe after negatives land, if prompt growth becomes a concern — declined via "Skip the probe"; committed ceilings describe the positive-only prompt.
- The system-message text is duplicated byte-for-byte between the two builders (`src/judge.ts:236`, `src/judge.ts:263`); a shared constant would keep future prompt edits drift-free. Surfaced by the probe, not in scope.

## References
- `watcher.config.json` — the operator-edited file this feature extends
- `src/config-file.ts` — closed key set + validators
- `src/judge.ts` — the two prompt builders and the judge call chain
- `src/index.ts` — the `config.keywords` pass-through site
- `scripts/probe-judge.ts`, `tests/judge.test.ts`, `tests/judge-helpers.ts` — the probe and test consumers of the builders
- Codebase-analyzer probe report "Judge prompt keyword seam" (2026-11-09, this session)
