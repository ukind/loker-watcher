---
date: 2026-10-25T21:20:20+0700
author: Yogiswara Utama
commit: 67d422d
branch: main
repository: loker-watcher
topic: "Model-judged keyword filtering"
tags: [intent, frd, judge, keywords, index, heartbeat]
status: ready
last_updated: 2026-10-25T21:20:20+0700
last_updated_by: Yogiswara Utama
---

# FRD: Model-judged keyword filtering

## Summary
Remove the keyword substring pre-filter from the pipeline. Every post that survives dedupe, recency, and seen-state goes to the LLM judge; the `keywords` list moves from a hard gate into the judge prompt as the relevance reference. Judging becomes bulk: ~10 posts per chat-completions call with id-keyed verdicts, and any item that fails falls back to the existing single-post call.

## Problem & Intent
Developer's words (input): "currently the rules is: keywords is Pre-filter. A post must contain one of these to reach the judge. but i want to changed it instead . the filter is solely by the model but based on the keywords . so if the model as the judge think the post is related to the 'list of that keywords' the it pass / valid"

Developer's words (intent question): "i have generous token, so let the AI be the judge based on the keywords"

The motivation: LLM tokens are not a constraint, so a cheap substring gate is a weaker duplicate of what the judge can do. The model should decide relevance, reading the keyword list as context; the gate should not drop posts the model would accept. Mid-interview the developer added: "can we process in builk ?" — wanting fewer LLM calls than one-per-post.

## Goals
- The judge (model) is the sole relevance filter, guided by the `keywords` list from `watcher.config.json`.
- No post is dropped for lacking an exact keyword substring before the judge.
- Fewer LLM calls per run via bulk judging, with per-post reliability preserved by a fallback path.
- No dead code left behind (`src/keywords.ts` goes away).

## Non-Goals
- No candidate cap per run (developer declined the `maxCandidatesPerRun` knob).
- No concurrency/parallel LLM calls — batches stay sequential.
- No changes to dedupe, recency, or seen-state stages.
- No change to the `locationOk` criterion or the email digest shape.
- No config schema change — `keywords` stays required and non-empty.

## Functional Requirements
1. The pipeline SHALL pass every post that survives dedupe, recency filtering, and seen-state diffing directly to the judge — the `filterPostsByKeywords` call (`src/index.ts:94-102`) SHALL be removed.
2. The judge prompt SHALL present the config `keywords` array as the relevance reference ("the post is related to any keyword in this list" = relevant) and SHALL remove the hardcoded "frontend/fullstack web development" wording; the location criterion (Indonesia or remote → `locationOk`) SHALL stay unchanged.
3. The judge SHALL send candidates in bulk batches of ~10 posts per chat-completions call, requesting a JSON verdict array where each item is keyed by post id.
4. Each bulk verdict item SHALL be validated independently (parse-don't-validate); items that are missing, misaligned, or fail the batch attempt SHALL be re-judged with the existing single-post call (up to 2 attempts each).
5. `src/keywords.ts` (`matchesKeywords`, `filterPostsByKeywords`) SHALL be deleted; the judge tests SHALL move from `tests/keywords.test.ts` to `tests/judge.test.ts` (1:1 module naming convention).
6. Funnel stats and the heartbeat SHALL replace the `maybes` counter with a judged-candidates count and SHALL drop the "keyword maybe(s)" copy.
7. `watcher.config.json` validation SHALL keep `keywords` required and non-empty with unchanged error messages.

## Non-Functional Requirements
- **Performance**: uncapped candidates per run (developer: tokens are generous); batches sequential, ~10 posts per call, 15s timeout per call unchanged. Realistic volume: ~19 posts per surface per run before dedupe/recency/seen (`.github` run evidence), so tens of LLM calls worst-case — well inside the GitHub Actions job limit.
- **Security**: unchanged — secrets env-only; post text is sent to the configured LLM endpoint exactly as today.
- **UX / Accessibility**: digest and heartbeat emails keep their plain-text shape; only counter naming and copy change.
- **Reliability**: skipped posts (all attempts failed) stay unseen and retry next run; state writes stay atomic and match-gated; email-before-state ordering untouched.

## Constraints & Assumptions
- Node >= 22, ESM, strict TypeScript flags stay on (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- No new runtime dependency.
- Tests stay offline: mock `fetchFn`, no real LLM calls.
- Assumption: the judge model reliably returns id-keyed JSON verdict arrays for ~10 posts per call — the single-post fallback covers misses, and research/implement should verify against the live endpoint.
- Assumption: the OpenAI-compatible endpoint accepts the slightly larger bulk prompts without change.

## Acceptance Criteria
- [ ] `npm run typecheck && npm run lint && npm test` all exit 0.
- [ ] `grep -rn "filterPostsByKeywords" src/` returns no matches and `src/keywords.ts` does not exist.
- [ ] `tests/judge.test.ts` exists; a mock-fetch test shows 10 candidates produce 1 bulk call, not 10 calls.
- [ ] A mock-fetch test shows a malformed/missing verdict item in a bulk response triggers a single-post fallback call for that item.
- [ ] A mock-fetch test shows an item failing all attempts lands in `skippedPostIds` and the state file stays byte-identical.
- [ ] A test shows the judge prompt contains the configured keyword list and no longer contains the "frontend/fullstack web development" wording.
- [ ] Heartbeat output contains no "keyword maybe" text; stats name judged candidates instead.

## Recommended Approach
Rewrite `src/judge.ts` around batched judging — one chat-completions call per ~10 posts with id-keyed verdict parsing and per-item fallback to the existing single-post path — then remove the gate call and `maybes` stat from `src/index.ts`, delete `src/keywords.ts`, and move judge tests to `tests/judge.test.ts`.

## Decisions

### Keywords config role
**Question**: From the probe: `keywords` is a required, non-empty array in watcher.config.json (`src/config-file.ts:79`). Keep that unchanged — only its role changes from hard filter to judge guidance?
**Recommended**: Keep config
**Chosen**: Keep config — same validation, new role as judge-prompt guidance
**Rationale**: evidence: src/config-file.ts:79 + confirmed

### Remove the hard gate
**Question**: Remove the hard-gate call at `src/index.ts:94-102` so keyword matching no longer drops any post before the judge?
**Recommended**: Remove gate
**Chosen**: Remove gate — all recency+seen survivors reach the judge
**Rationale**: evidence: src/index.ts:94-102 + confirmed; tokens explicitly not a constraint

### Delete the keywords module
**Question**: After the gate goes, `src/keywords.ts` has zero callers. Delete the module, or keep it as dormant code?
**Recommended**: Delete module
**Chosen**: Delete module + move judge tests to `tests/judge.test.ts`
**Rationale**: evidence: probe found zero remaining callers + confirmed; repo keeps no dead code; 1:1 test naming convention

### Prompt criterion
**Question**: In the judge prompt (`src/judge.ts:93-113`), should the keyword list REPLACE the current hardcoded relevance criterion, or ADD to it?
**Recommended**: Replace criterion
**Chosen**: Replace — relevance = "related to any keyword in the list"; locationOk unchanged
**Rationale**: matches stated intent verbatim ("related to the list of that keywords"); keeps the prompt single-sourced on config, no leftover hardcoded subject matter

### Judge call shape
**Question**: How should the judge call the LLM — keep one call per post, or go bulk?
**Recommended**: Keep per-post
**Chosen**: Bulk + fallback — ~10 posts per call, id-keyed verdicts, per-item validation, failed items retried as single-post calls
**Rationale**: developer's own direction ("can we process in builk ?"); fewer calls and lower wall-clock while the fallback preserves per-post retry precision and verdict-to-post alignment

### Batch size is a constant, not config
**Question**: Pre-resolved from codebase evidence — where does the bulk size live?
**Recommended**: n/a
**Chosen**: Module constant in `src/judge.ts` (~10); no new config key
**Rationale**: developer declined a cap knob in the same interview; config surface stays unchanged

### Uncapped candidates per run
**Question**: Without the gate, every surviving post costs judge calls. Accept uncapped candidates per run, or add a cap?
**Recommended**: No cap
**Chosen**: No cap
**Rationale**: developer: "i have generous token"; realistic volume (~19 posts/surface) sits far below Actions job limits

### Stats and heartbeat rework
**Question**: Pre-resolved from codebase evidence — what happens to the `maybes` counter and heartbeat copy?
**Recommended**: n/a
**Chosen**: `maybes` becomes a judged-candidates count; "keyword maybe(s)" copy removed; `HeartbeatStats` field/init/renderer and heartbeat tests updated
**Rationale**: evidence: src/index.ts:97-113, tests/heartbeat.test.ts:61,138,147 — the counter exists only to measure the removed stage

## Open Questions
None — all branches resolved during the interview.

## Suggested Follow-ups
- Parallel bulk calls could cut wall-clock further if post volume grows — out of scope; batches stay sequential (`src/judge.ts:214-234`).

## References
- Skill input (this conversation): feature description, intent answer, bulk question.
- `.rpiv/guidance/src/architecture.md` — pipeline stages, fail-visible rules, injection seams.
- `src/index.ts` (funnel, gate call, stats), `src/judge.ts` (prompt, judgePost/judgePosts), `src/keywords.ts` (to delete), `src/config-file.ts:25-30,79` (keywords validation), `src/heartbeat.ts`, `tests/keywords.test.ts` (judge tests to relocate).
