---
date: 2026-10-26T06:15:51+0700
author: Yogiswara Utama
commit: 67d422d
branch: main
repository: loker-watcher
topic: "Model-judged keyword filtering"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, judge, keywords, heartbeat, state, tests]
last_updated: 2026-10-26T06:15:51+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Model-judged keyword filtering

**Date**: 2026-10-26T06:15:51+0700
**Author**: Yogiswara Utama
**Commit**: 67d422d
**Branch**: main
**Repository**: loker-watcher

## Research Question
Developer words: "currently the rules is: keywords is Pre-filter. A post must contain one of these to reach the judge. but i want to changed it instead. the filter is solely by the model but based on the keywords. so if the model as the judge think the post is related to the list of that keywords the it pass / valid" — plus "can we process in bulk?" (fewer LLM calls than one-per-post).

## Summary
**Problem**: The keyword substring gate decides relevance before the LLM sees a post. Widening the list empirically failed (commit c64c427, revert 18246dd), so relevance must move fully into the judge, guided by the config keywords list — and per-post calls should become batched calls.
**Recommended**: Bulk + json_object mode — ~10-post batches with an id-keyed verdict object, per-item fallback to the unchanged single-post judge, plus a one-line response_format {"type":"json_object"} rider on the payload.
**Effort**: Medium (~1-2 days: ~150-200 lines in src/judge.ts, ~15 in src/index.ts, test relocation, one live verification run).
**Confidence**: High.

## Problem Statement

**Requirements:**
- Relevance becomes "the model judges the post related to any keyword in watcher.config.json"; the substring gate goes away entirely.
- Batched judging: ~10 posts per LLM call, fewer calls than posts.
- A failed judgment never throws, never marks a post seen; skipped posts retry next run (design decision D3).
- Config keywords stay required and non-empty with unchanged validation errors (FRD #7).

**Constraints:**
- Hard: GitHub Actions job timeout of 10 minutes (.github/workflows/watch.yml:20) on a */10 cron (watch.yml:6).
- Hard: strict TS flags — noUncheckedIndexedAccess, exactOptionalPropertyTypes (tsconfig.json:8-11). Post.id is a 19-digit numeric string (src/types.ts:10-16) — never Number()-coerced.
- Hard: no new runtime dependencies; batch size is a module constant, not a config key.
- Soft: every pipeline stage logs its input size; the log-to-heartbeat funnel stays consistent.
- Soft: env config (JudgeConfig) and file config (keywords) stay separate — keywords ride as a plain parameter.

**Success criteria:**
- Gate call, zero-maybes early return, and src/keywords.ts are gone; every recency+seen survivor reaches the judge.
- Happy path costs ceil(N/10) LLM calls; worst case stays deterministic at ceil(N/10) + 2N.
- Skipped ids stay unseen and retry next run; state writes stay double-gated and atomic.
- npm run typecheck, npm run lint, and npm test all pass; one live match run verified end-to-end.

## Current State

**Existing implementation:**
- Keyword gate: filterPostsByKeywords(newPosts, config.keywords) at src/index.ts:94 (import :19; impl src/keywords.ts:33-35); zero-maybes early return src/index.ts:96-101.
- Judge: one call per post — judgePosts loop src/judge.ts:185-205 calling judgePost (src/judge.ts:120-179) with a 2-attempt retry (loop :135) and 15s timeout (:14, armed :144). parseVerdict (:63-95) fence-strips, slices first brace to last brace, requires two booleans, returns null on failure. buildMessages (:100-114) hardcodes the "frontend or fullstack web development" criterion.
- Contract: JudgeBatchResult {judged, skippedPostIds} (src/judge.ts:27-30), consumed only at src/index.ts:103-108 and src/judge.ts:194.
- Stats/heartbeat: maybes init src/index.ts:79, set :95; HeartbeatStats doc src/heartbeat.ts:33-34; copy "N keyword maybe(s)" :115; tag "[keyword match]" :128; Candidate.reason "maybe" | "near-miss" :47.
- State: email before state (src/index.ts:121 then :127-128); saveState re-gates via diffNewIds (src/state.ts:177-183); atomic write, 2-space JSON (:146-151).

**Relevant patterns:**
- Trailing fetchFn DI seam: src/judge.ts:123, :188 — all judge tests are offline mocks via this seam.
- Parse-dont-validate at the LLM edge: parseVerdict total function; null means skip (src/judge.ts:63-95).
- Validate-per-item, drop-and-count: extractPosts loop (src/extract.ts:46-57) — the repo battle-tested JSON-ingestion idiom.
- Set-keyed string ids: dedupePosts (src/index.ts:145-153), diffNewIds (src/state.ts:120-131), heartbeat maybeIds (src/heartbeat.ts:72).
- Map keyed by string post id: src/fetch-threads.ts:222-233.

**Integration points:**
- src/index.ts:103 — the only production consumer of judgePosts.
- src/index.ts:94 — the gate call to delete.
- src/index.ts:88, :114 — heartbeat call sites feeding selectCandidates.
- tests/keywords.test.ts — all judge tests live here today (:118-265); tests/heartbeat.test.ts pins the copy (:38, :61, :138, :142-149).

## Solution Options

### Option 1: Bulk id-keyed batches + per-item fallback
**How it works:**
Chunk newPosts into ~10-post batches (module constant BATCH_SIZE beside REQUEST_TIMEOUT_MS, src/judge.ts:14). One chat-completions call per batch; the system message carries JSON.stringify(keywords); the user message lists each post string id plus text; the model returns an id-keyed object of verdicts. A tolerant parser (seeded from parseVerdict fence and slice tolerances) builds a Map of id to JudgeVerdict via Object.entries; items missing or malformed from the bulk response fall back to the unchanged single-post judgePost (2 attempts), then land in skippedPostIds. The batch call itself gets no retry — deterministic worst case ceil(N/10) + 2N.

**Pros:**
- One consumer, contract-preserving: JudgeBatchResult stays intact, so src/index.ts:103-128 needs zero contract changes (agent-verified).
- D3 invariant holds structurally: skipped ids never enter judgedIds, the only disk path is saveState fed from judgedIds (src/index.ts:127).
- Fallback reuse means the surviving judgePost retry tests directly certify the second stage (tests/keywords.test.ts:162-221).
- Ecosystem-consistent: id-keyed verdict maps with per-item retry are current practice for many-items-per-call judging (evidentlyai.com/llm-guide/llm-as-a-judge).

**Cons:**
- No in-repo precedent for batching or id-keyed response parsing — both halves are new code (mitigated: parser seeds from parseVerdict).
- One transient HTTP failure or timeout on a chunk routes all ~10 items into fallback (up to 20 extra calls); the 15s timeout now bounds a whole batch.

**Complexity:** Medium (~1-2 days)
- Files to create: 0 (tests move: tests/judge.test.ts and tests/state.test.ts)
- Files to modify: ~5 (judge.ts +120-180, index.ts ~15, heartbeat.ts ~6, e2e runbook note, README vocabulary)
- Risk level: Low

### Option 2: Bulk + json_object response_format
**How it works:**
Option 1 exactly, plus one line in the payload literal (src/judge.ts:129-133): response_format with type "json_object". The endpoint constrains decoding to valid JSON; the tolerant parser and per-item fallback stay as the safety net for anything the constraint does not prevent.

**Pros:**
- Hardens exactly the new risk batching introduces: a whole-chunk unparseable top-level response (agent-verified; today the strict-JSON claim is prompt-only, src/judge.ts:4-5).
- Officially documented on the verified provider: Z.AI supports response_format {"type":"json_object"} on glm-5/4.7/4.6 OpenAI-compatible API (docs.z.ai). Strict json_schema is OpenAI-specific — correctly avoided.
- Degradation is exact: a proxy silently dropping the field yields Option 1 behavior via parseVerdict + retry + skip; Z.AI pairs JSON mode with client-side validation and a retry fallback in its own examples.
- Near-zero extra migration (~1-2 lines) and one cheap offline wire-shape test via the DI fetchFn (parse opts.body, assert response_format.type).

**Cons:**
- Speculative tail: an endpoint that hard-rejects the field with 4xx would fail every post (matches go to zero, state untouched — fails safe). Evidence says proxies drop, not reject (LiteLLM issue 37720); the field is one line to remove if a live run disproves it.
- Live honoring of the field is not offline-testable — same posture as temperature: 0 today.

**Complexity:** Medium (~1-2 days; Option 1 plus ~2 lines)
- Files to create: 0
- Files to modify: same as Option 1 (plus 1 payload line, plus 1 wire-shape assertion)
- Risk level: Low

### Option 3: Bulk array-of-items batches
**How it works:**
Same batching, but the model returns an array of items each carrying id, relevant, locationOk. The parser validates each item (readPk-style id guard, extract.ts drop-and-count), keeps the first of duplicate ids, joins by id into JudgedPost entries, and pushes unjoinable candidates to skippedPostIds. The brace-slicer in parseVerdict must become bracket-based.

**Pros:**
- Strongest in-repo parser precedent: extract.ts already does "array of unknown items, validate id inside each item, drop bad ones, keep-first dedupe" (src/extract.ts:46-60, :101-146), and string-id Map joins exist (src/fetch-threads.ts:222-233).
- Contract-safe: JudgeBatchResult preserved; index.ts and state.ts untouched.

**Cons:**
- Extra join layer the object shape does not need (~30-50 lines): duplicate handling is mandatory (duplicate items would duplicate digest sections, since saveState dedupes silently downstream), and mangled ids are unjoinable.
- Distinct omission mode: an item missing its id field is still valid JSON; a systematically mangled id becomes a silent per-run retry loop for that one post (bounded, but invisible).
- parseVerdict object-shaped slicer cannot be extended, only replaced — a subtle trap the test suite must pin.
- Ecosystem consensus favors id-keyed maps for this exact job; no public benchmark favors arrays (web scan found none).

**Complexity:** Medium (~1.5-2.5 days)
- Files to create: 0
- Files to modify: same as Option 1 (plus ~30-50 join/dedupe lines, plus ~5-8 edge-case tests)
- Risk level: Low-Medium

### Option 4: Single-post judge, gate removed only
**How it works:**
Delete the gate and src/keywords.ts; plumb keywords into the existing per-post prompt; every survivor gets the incumbent one-call-per-post judge. No batching, no parser changes.

**Pros:**
- Smallest possible diff: 1 deleted file (35 lines), ~20-25 changed source lines, ~100 pruned test lines (agent-quantified).
- Zero new LLM-contract risk: judgePost, parseVerdict, and the retry loop survive verbatim.

**Cons:**
- Blocked on wall clock: worst case per post is 2 × 15s = 30s, strictly sequential. 50 posts = 25 min; a cold-start ~300-post backlog = 15-150 min. Both exceed the 10-minute job timeout (watch.yml:20).
- Killed runs lose everything: judgePosts accumulates all results before returning; sendDigest and saveState run only afterward (src/index.ts:121, :128) — partial verdicts vanish, and with no-match-persists-nothing (src/index.ts:113-117) a zero-match regime can re-judge the same backlog every 10-minute run indefinitely.
- Forgoes the bulk call shape the user explicitly asked for ("can we process in bulk?").

**Complexity:** Low (~0.5 day)
- Files to create: 0
- Files to modify: ~3 (index.ts, judge.ts prompt only, tests/keywords.test.ts prune)
- Risk level: High (timeout plus lost-work regime)

## Comparison

| Criteria | Opt 1: Bulk id-keyed | Opt 2: Bulk + json_object | Opt 3: Bulk array | Opt 4: Single-post |
|----------|----------|----------|----------|----------|
| Complexity | M (~1-2 d) | M (~1-2 d) | M (~1.5-2.5 d) | L (~0.5 d) |
| Codebase fit | M (new parse pattern) | M (same + 1 line) | H (extract.ts precedent) | H (incumbent) |
| Risk | L (fails to fallback) | L (fails to Opt 1) | L-M (join + id-echo traps) | H (job timeout) |
| Calls per run, happy | ceil(N/10) | ceil(N/10) | ceil(N/10) | N |
| Deterministic worst | ceil(N/10)+2N | ceil(N/10)+2N | ceil(N/10)+2N | 2N, sequential |
| Meets the bulk ask | Yes | Yes | Yes | No |

## Recommendation

**Selected:** Option 2 — Bulk + json_object response_format

**Rationale:**
- The Option 1 shape clears every codebase dimension (agent-verified: single consumer, frozen contract, D3 structural, bounded test breakage) — and Option 2 is that shape plus ~2 lines.
- The rider hardens the one genuinely new failure mode (whole-chunk unparseable response) with a provider-documented feature: Z.AI officially supports json_object on the OpenAI-compatible API; strict json_schema is OpenAI-specific and was correctly avoided.
- Degradation is exact and proven: a dropped field reproduces Option 1 today; the tolerant per-item parser covers what json_object cannot. Fails safe either way.
- The ecosystem scan confirms the surrounding practice: id-keyed verdict maps plus per-item validation plus single-post fallback is current practitioner consensus for batch LLM judging (evidentlyai.com/llm-guide/llm-as-a-judge; js.useinstructor.com documents the same schema-validate-retry shape).

**Why not alternatives:**
- Option 1: sound but leaves a free, provider-documented reliability win unused; nothing about it resists the rider.
- Option 3: pays for a join/dedupe layer, a slicer replacement, and a new silent id-echo omission mode with no measured benefit; consensus favors the object shape.
- Option 4: blocked — 25-minute worst case vs the 10-minute job limit, and killed runs lose all partial verdicts in the no-match regime that is already the normal case.

**Trade-offs:**
- Accepting a speculative hard-reject tail (one-line removal if a live run ever shows it) for a documented decode constraint.
- Accepting ~10x skip blast radius per failed chunk (batch falls back per item) for ceil(N/10) happy-path calls.

**Implementation approach:**
1. Judge core — rewrite judgePosts (src/judge.ts:185-205): BATCH_SIZE constant, chunk loop, bulk fetch (no batch retry), parseBulkVerdicts (Map via Object.entries; per-item validator mirrors src/judge.ts:80-90), per-item fallback via unchanged judgePost, unresolved to skippedPostIds.
2. Prompt — buildBulkMessages: system message carries JSON.stringify(keywords) and replaces the hardcoded criterion; user message lists id plus text per post; keep the per-post buildMessages for fallback.
3. Funnel — delete gate and zero-maybes return (src/index.ts:94-101); stats.maybes becomes newPosts.length (posts sent); one judge-stage log line; heartbeat call sites feed newPosts.
4. Vocabulary — maybes doc (src/heartbeat.ts:33-34), reason "maybe" becomes "judged" (:47), copy :115, tag "[judged]" :128; pipeline doc comment src/index.ts:6-7.
5. Cleanup — delete src/keywords.ts; relocate and rework tests/keywords.test.ts into tests/judge.test.ts (plus new tests/state.test.ts); fix the e2e runbook reference to filterPostsByKeywords (.claude/skills/validate-e2e/SKILL.md:16).
6. Rider — add response_format json_object to the payload literal (src/judge.ts:129-133) plus one wire-shape test assertion.
7. Verify — npm run typecheck, npm run lint, npm test, then one live run (the digest and state-commit paths have never fired in production).

**Integration points:**
- src/index.ts:94-101 — gate and early return deleted; stats set from newPosts.
- src/index.ts:103 — judgePosts gains the keywords parameter (plain param before trailing fetchFn).
- src/judge.ts:129-133 — payload gains response_format; DI seams :123/:188 survive.
- src/heartbeat.ts:34/:47/:115/:128 — stat doc, reason union, copy, tag.
- tests/keywords.test.ts:242-254 — mock routing must switch to call count (the bulk body contains ALL candidate texts, so body-sniffing "Failing post" would 500 the whole batch).

**Patterns to follow:**
- Parse-dont-validate at the LLM edge: src/judge.ts:63-95 (container-null vs item-null semantics).
- Trailing DI seam for tests: src/judge.ts:123, :188.
- Validate-per-item, drop-and-count: src/extract.ts:46-57.
- One retry mechanism only (the judgePost loop): keeps worst-case counts deterministic.

**Risks:**
- Endpoint rejects response_format with 4xx: live-run check; mitigation is deleting one line (falls back to Option 1 exactly).
- Model mangles 19-digit id strings: exact-string membership check plus per-item fallback (never Number(); src/types.ts:10-16).
- Whole-batch timeout under 15s: degrades to fallback by design; watch skipped counts on the first live runs.

## Scope Boundaries
- Building: gate removal, keywords-guided bulk judge with the json_object rider, per-item fallback, stats/heartbeat vocabulary rework, test relocation, one live verification.
- Not doing: new config keys (batch size stays a module constant), candidate caps, strict json_schema (OpenAI-specific), response_format on the fallback path (unchanged single-post call), keyword validation changes (errors stay byte-identical, src/config-file.ts:100-118), watch.yml changes.

## Testing Strategy

**Unit tests:**
- 10 posts, calls === 1 AND judged.length === 10 (one call alone does not prove ten parsed); 15 posts, 2 calls.
- Corrupt bulk item (relevant set to "yes"): calls === 2, id present in judged, the fallback body mentions the id.
- Bulk omits an id and both fallback attempts fail: calls === 3, id in skippedPostIds, absent from judged.
- Every CONFIG.keywords entry present in captured bodies; the full phrase "frontend or fullstack web development" absent (assert the full phrase, not substrings).
- Wire shape: JSON.parse of the bulk body asserts response_format.type equals "json_object".
- Id safety: round-trip a bigger-than-MAX_SAFE_INTEGER id through body and response; hallucinated response keys are ignored.
- Mock routing by call count (call 1 returns bulk verdicts, calls 2+ return 500), not body sniffing.
- Relocated verbatim: parseVerdict, resolveJudgeConfig, judgePost describes (tests/keywords.test.ts:118-221) — they certify the fallback stage.

**Integration tests:**
- tests/state.test.ts (new): saveState no-op gate (result.saved false, byte-identical file) with a positive control that actually saves — guards the D3 invariant independently of the judge.

**Manual verification:**
- [ ] npm run typecheck, npm run lint, npm test (CI parity).
- [ ] One live run with real env vars: confirm a match run produces digest plus state commit; confirm skipped ids stay unseen and retry.
- [ ] Confirm the endpoint accepts a ~10-post prompt and honors json_object (watch skipped counts on the first runs).

## Open Questions
**Resolved during research:**
- Wire shape — id-keyed object over array: checkpoint decision (research doc); a Map via Object.entries typechecks under noUncheckedIndexedAccess and neutralizes __proto__ keys.
- Judged-candidates stat meaning — posts SENT to the judge (newPosts.length), matching the funnel input-counting convention.
- Batch retry budget — none; the judgePost 2-attempt loop stays the only retry (deterministic worst case ceil(N/10) + 2N).
- Does Z.AI support structured output — json_object documented (docs.z.ai/guides/capabilities/struct-output); json_schema is not.

**Requires user input:**
- None.

**Blockers:**
- None. One live-run assumption from research stands: the endpoint must accept ~10-post prompts (FRD assumption; verified only by the live run).

## References
- .rpiv/artifacts/research/2026-10-25_21-35-06_model-judged-keywords.md — full codebase grounding, precedents, FRD resolutions
- .rpiv/artifacts/discover/2026-10-25_21-20-20_model-judged-keywords.md — the FRD
- src/judge.ts:63-95 — parseVerdict (parser seed)
- src/judge.ts:120-179 — judgePost (fallback, reused verbatim)
- src/judge.ts:129-133 — payload literal (response_format home)
- src/index.ts:94-103 — gate deletion and judge call site
- src/state.ts:170-197 — saveState double-gate (D3)
- src/extract.ts:46-60 — validate-per-item/drop-and-count precedent
- .claude/skills/validate-e2e/SKILL.md:16 — runbook line that breaks and needs updating
- docs.z.ai/guides/capabilities/struct-output — provider json_object documentation
- platform.openai.com/docs/guides/structured-outputs — strict json_schema (OpenAI-specific; not used)
- evidentlyai.com/llm-guide/llm-as-a-judge — batch-judge practice (id-keyed plus per-item retry)
- github.com/BerriAI/litellm/issues/37720 — proxy-drops-response_format evidence