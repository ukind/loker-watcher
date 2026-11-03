---
date: 2026-11-01T20:34:14+0700
author: Yogiswara Utama
commit: 14aaf74
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn surface via Linked API post search - SDK fetcher integration shape"
confidence: medium
complexity: high
status: ready
verdict: pass
tags: [solutions, index-ts, fetch-linkedin-api, fetch-linkedin, fetch-threads, threads-session, config-file, watch-yml, judge, env-names]
last_updated: 2026-11-01T20:34:14+0700
last_updated_note: "correction pass: provenance names verified vs inherited ranges; complexity file counts fixed (4/6/5 to 9/10/9); ESM import-form question restored; fetch-linkedin.ts count corrected to 346"
last_updated_by: Yogiswara Utama
---

# Solution Analysis: LinkedIn surface via Linked API post search - SDK fetcher integration shape

**Date**: 2026-11-01T20:34:14+0700
**Author**: Yogiswara Utama
**Commit**: 14aaf74
**Branch**: feature/add-support-for-linkeind
**Repository**: feature-add-support-for-linkeind

## Provenance (read before citing this document)

The per-candidate agent dispatch required by the explore skill did not run: the agent dispatch was unreachable from the session after repeated failures, so the candidate scoring below is **orchestrator-scored** from the parent research document, not agent-derived. Compensation: three grep bundles pinned the pipeline-side claims first-hand against the live working tree at HEAD 14aaf74 (tree clean of src changes); zero drift except one count corrected (fetch-linkedin.ts is 346 lines, the research said ~300).

VERIFIED FIRST-HAND - src/index.ts: :48-54 (login import block), :115-132 (WatcherDeps: seven optional fields incl. contextFactory :121, fetchFn :123, sleepFn :131), :168, :174-178, :185-192, :193-197, :365-417, :454-463. src/fetch-threads.ts: :21, :33, :41 (FETCH_CONCURRENCY = 4), :296-306, :331-415 incl. :337-344, :357-366, :370-375, :378 (runPool wrap), :380-383, :390-394, :397-409, :412-413. watch.yml: :11-13, :42-55 (F023 twin; timeout-minutes: 8 at :55), :94-97 (LinkedIn env lines), :103-129 (refresh step; PAT :110; printf marker :124), :132 (threat-model comment), :140-146 (marker branch; test -f :142, git add :143). package.json: :5 (ESM), :11 (lint path), :22 (playwright). src/config.ts:14-25. src/config-file.ts: :15-28, :220-237, :241-243, :252-256. src/threads-session.ts: :13, :37-60. src/judge.ts: :92-107 (WAIT_BUDGET_MS = 180_000). src/types.ts:10-25. src/fetch-linkedin.ts: :60, :77, :170, :189, :256, :285. Line counts (wc -l): src/linkedin-login.ts 315, scripts/linkedin-login.ts 120, src/fetch-linkedin.ts 346. .gitignore:8. README linkedin touchpoints: :37, :68, :101, :118, :250-263, :278, :298 (the research's finer README row numbers are superseded by this list). Test describe bounds: tests/index.test.ts :328 / :721 / :1021 (Phase 7 = :721-1020 confirmed at both bounds), tests/fetch-threads.test.ts :518, tests/fetch-linkedin.test.ts :164/:231/:241, tests/session.test.ts :17/:30/:89, tests/config-file.test.ts :169/:206; warn regexes tests/index.test.ts:573/:603.

STILL INHERITED from the parent research, NOT re-pinned here: deep test-case internals (tests/index.test.ts:499-544, :546-618 non-regex internals, :656-718 helpers; tests/fetch-linkedin.test.ts :242-406 case internals; tests/fetch-threads.test.ts :547-643 case internals; tests/config-file.test.ts:192-203 exact lines - bracketed by the verified :169/:206 describes; tests/session.test.ts:55-85); structural-double internals (fetch-threads.ts :93-127, :148-150, :185-199, :218, :273, :450); unlisted pipeline ranges (src/extract.ts, src/recency.ts, src/state.ts, src/email.ts, judge.ts :132-178, index.ts :257-260/:282-283/:330/:344-346, watch.yml :69-87 Playwright steps); README wording beyond the touchpoints listed; and ALL SDK-behavior facts (error taxonomy, working-hours pending shape, searchPosts limits) from the research's 2026-11-01 docs verification. Cite inherited ranges as research-derived until re-pinned. This is why confidence is medium, not high.

## Research Question
Chained from the FRD (.rpiv/artifacts/discover/2026-11-01_18-53-36_linkedin-cli-post-search-surface.md) and research (.rpiv/artifacts/research/2026-11-01_19-34-17_linkedin-post-search-surface.md): which integration shape should carry the @linkedapi/node SDK post-search fetcher through the existing pipeline, given the FRD has already locked the macro decisions (SDK not CLI, post search, degrade-and-skip, delete the blocked Playwright path, token names, sequential fetch)?

## Summary
**Problem**: The Playwright LinkedIn fetch path is blocked in production (datacenter-IP blocking). Replace it with an SDK post-search fetcher and pick the code shape that carries it.
**Recommended**: New dedicated module fetch-linkedin-api.ts behind an optional WatcherDeps field - every element of the shape has a same-repo precedent, and it is the only candidate that never couples LinkedIn failures into the Threads all-fail gate.
**Effort**: Med-High (~2-3 days): ~2000+ lines deleted, ~300-400 added, plus a mandatory live verification run.
**Confidence**: Medium (code claims verified first-hand; per-candidate scoring not agent-derived; SDK behavior from parent research only).

## Problem Statement

**Requirements:**
- LinkedIn surfaces fetch via @linkedapi/node searchPosts (term verbatim, sort latest, datePosted pastWeek, limit 100) - FRD D6/D8/D9.
- LinkedIn failures degrade: warn + skip the surface, run exits 0 - FRD D5.
- Missing tokens skip LinkedIn with one warn naming LINKED_API_TOKEN before the fetch span; run exits 0 - FRD D10 + caller-warns checkpoint.
- The blocked Playwright LinkedIn path is deleted entirely - FRD D7.
- LinkedIn fetch is sequential (no runPool); Threads keeps runPool + FETCH_CONCURRENCY - FR4.
- Posts normalize into the existing Post shape before dedupe; drops counted and conditionally warned.
- The fetch await sits inside the existing acquisition timeStage closure; one stage-level timing line.

**Constraints:**
- Hard: strict TS flags stay on; state writes stay atomic; offline tests only (node:test + tsx); no new runtime dependency without a stated PR-description need (the SDK is that stated need); Node >= 22 ESM.
- Hard: WATCH.yml F023 comment arithmetic (watch.yml:48-54) and its twin (src/judge.ts:98-107) must be rewritten in lockstep with any fetch-leg change.
- Soft: linkedin surfaces in watcher.config.json stay byte-identical (FRD D2).

**Success criteria:**
- A scheduled run with LinkedIn surfaces exits 0 with a digest email whether or not LinkedIn yields posts.
- npm run typecheck && npm run lint && npm test pass with the Playwright LinkedIn path fully gone.
- One live Actions run proves the SDK path (this repo has twice shipped live-unproven fetch paths).

## Current State

**Existing implementation** (all pins verified at 14aaf74):
- src/index.ts:168 - acquisition timeStage closure starts; :174-175 platform split; :176 Threads session resolve; :177-178 LinkedIn session guard; :185-192 credential-login fallback into recoverLinkedInSession (:365-417, closes at :417); :193-197 skip-warn (regex-pinned at tests/index.test.ts:573 and :603); :199-218 mixed authenticated dispatch; :236-248 logged-out LinkedIn arm + catch-degrade; :253-254 paired cleanup (Threads :253 stays, LinkedIn :254 dies with the session dir); :454-463 dedupePosts (Set on post.id).
- src/fetch-threads.ts:300-305 AuthenticatedFetchOptions (linkedinSessionPath :302, scrollRounds :304); :331 fetchSurfacesAuthenticated; :337-344 lazy-base machinery; :357-366 walkLinkedInSurface + wiring guard; :370-375 mirror guard; :380-383 platform ternary; :390-394 per-surface catch; :397-409 all-fail throw; :412-413 paired teardown.
- src/config-file.ts:15-18 Surface union; :21-28 ResolvedSurface ("the URL Playwright loads"); :220-237 resolveSurfaces (linkedin arm :229-234); :252-256 linkedinSearchUrlFor (dies with its arm - only consumer read the url).
- src/config.ts:14-25 ENV_NAMES - four LinkedIn entries at :16-19 (linkedinSession, linkedinEmail, linkedinPassword, linkedinRefreshPath).
- src/threads-session.ts:13 docstring names LINKEDIN_SESSION_STATE; :37-60 resolveSession degradable contract (unset gives silent null :42; malformed gives warn + null :47-53).
- src/types.ts:10-25 Post (5 non-null strings + platform "threads" | "linkedin"); src/state.ts generic string keys mean urn ids coexist.
- src/fetch-linkedin.ts: AUTHOR_PLACEHOLDER :60, parseFlightRows :77, mintPost :170, collectLinkedInPosts :189, fetchLinkedInSurface :256, page.goto :285. src/linkedin-login.ts 315 lines; scripts/linkedin-login.ts 120 lines; src/fetch-linkedin.ts 346 lines (wc -l).
- .github/workflows/watch.yml:11-13 concurrency guard (cancel-in-progress: false at :13); :42-55 F023 comment twin + timeout-minutes: 8; :94-97 LinkedIn env lines; :103-129 refresh step; :140-146 marker branch (per research pins, not re-pinned).
- package.json:11 lint path includes scripts/linkedin-login.ts (a deletion must edit this or lint blocks); :22 playwright dep (stays - Threads needs it).
- judge.ts:98-107 F023 twin (WAIT_BUDGET_MS = 180_000 at :107).

**Relevant patterns:**
- module-per-stage: judge.ts, email.ts, state.ts, recency.ts - one concern per file.
- resolver-beside-consumer: parseLlmAccounts judge.ts:132, resolveEmailConfig email.ts:29, resolveSession threads-session.ts:37.
- optional WatcherDeps fields: contextFactory index.ts:121, fetchFn :123, sleepFn :131 - production default + test stub.
- structural doubles for offline tests: dualPlatformContextFactory tests/index.test.ts:499-544.
- drop-and-count at edges: extractPosts extract.ts:36-70 (counter :52, conditional warn :63-64); guarded date conversion :87-113.

**Integration points:**
- src/index.ts:168-256 - the acquisition closure the new arm joins; the rewiring target.
- src/index.ts:174-175 topology - gains the raw-surface partition for the LinkedIn arm.
- src/index.ts:193-197 - the skip-warn slot re-keys to LINKED_API_TOKEN.
- watch.yml:11-13, :42-55, :94-97 - guard flip, F023 lockstep rewrite, env swap.

## Solution Options

### Option 1: New fetch-linkedin-api.ts module (RECOMMENDED)
**How it works:**
Delete src/fetch-linkedin.ts, src/linkedin-login.ts, scripts/linkedin-login.ts and their tests; add a dedicated module owning the degradable token resolvers (resolveSession contract model, threads-session.ts:37-60), an injectable SDK-client factory seam (offline doubles precedent), a sequential per-surface loop with the per-surface catch idiom (fetch-threads.ts:390-394 shape) and NO all-fail throw, and drop-and-count Post mapping (extract.ts model). runWatcher gains an optional WatcherDeps field, partitions raw config.surfaces by type, re-keys the skip-warn, and drops the LinkedIn session machinery.

**Pros:**
- Every element has a same-repo precedent (WatcherDeps optional fields, resolver-beside-consumer, doubles-for-offline, module-per-stage) - verified pattern inventory.
- Zero coupling into the Threads failure gate: the D5 pre-landing bug class from 68c1e2d (LinkedIn failure discarding Threads posts on the shared path) is structurally impossible.
- Clean test triage: new test file born for the new surface; dying tests die whole; the mapped re-key sites (tests/index.test.ts:573/:603) are the only mutations.

**Cons:**
- One new module + one new seam concept in a repo that just lost several LinkedIn modules (naming: avoid reusing "fetch-linkedin"; "fetch-linkedin-api" marks the transport).

**Complexity:** Medium (~1 day of the total)
- Files to create: 2 (~350 lines: module + test)
- Files to modify: 9 (~150 lines: src/index.ts rewiring, src/config.ts ENV_NAMES swap, src/fetch-threads.ts shed, src/config-file.ts arm + builder deletion, src/threads-session.ts docstring, watch.yml env swap + guard flip + F023 rewrite + step/branch deletions, package.json:11 lint path, .gitignore:8, README rows/sections)
- Risk level: Low-Medium (live SDK behavior unproven; mitigated by operator precondition + one live run)

### Option 2: Refit fetch-linkedin.ts in place
**How it works:**
Keep the module name, its call site, and tests/fetch-linkedin.test.ts; rewrite the internals from the Playwright walker (session, wheel, mintPost) to SDK calls.

**Pros:**
- No new file; import churn in index.ts is marginally lower (though the :48-54 login import block dies regardless).

**Cons:**
- Naming honesty breaks: a module named for a transport it no longer uses (STE 1.11: one item, one name).
- The "keep the tests" benefit is mostly illusory: of tests/fetch-linkedin.test.ts:241-408, order/dedupe/empty cases port, throw cases :375-406 invert to warn-and-continue, wheel mechanics :164-239/:299-353 die with no SDK analogue - triage is muddier than clean birth + death.
- Resolver home gets strained: the module identity is "fetcher", pulling the token resolvers away from the beside-consumer rule.

**Complexity:** Medium (~1 day of the total)
- Files to create: 0
- Files to modify: 10 (the same 9-file set as Option 1 plus tests/fetch-linkedin.test.ts refit in place)
- Risk level: Low-Medium

### Option 3: LinkedIn branch inside fetch-threads.ts
**How it works:**
Keep one fetch module for both platforms; the SDK arm joins fetchSurfacesAuthenticated (fetch-threads.ts:331) as another platform branch; AuthenticatedFetchOptions (:300-305) gains token/client fields.

**Pros:**
- One fetch module to read; no WatcherDeps growth.

**Cons:**
- BLOCKER: a LinkedIn surface failure feeds the shared all-fail throw (:397-409) unless the arm special-cases a bypass - a D5 violation risk, and the exact bug class 68c1e2d already shipped once.
- FR4 conflict: the walker is wrapped by runPool (:378); a sequential SDK arm must opt out inside a pool-wrapped loop, touching reassembly and the side arrays (:351-353).
- The D12 lazy-base machinery (:337-344), platform ternary (:380-383), mirror guard (:370-375), and teardown (:412-413) all need arm-aware edits; the Playwright structural doubles (:93-96, :114, :127, :185-191, :199) stay as dead weight the SDK arm never uses.

**Complexity:** Medium-High (~1.5 days of the total)
- Files to create: 0
- Files to modify: 9 (the same baseline set; fetch-threads.ts gains the most new conditionals of any option)
- Risk level: High (gate coupling + pool conflict are structural, not cosmetic)

## Comparison

| Criteria | Option 1 (new module) | Option 2 (refit in place) | Option 3 (shared walker) |
|----------|----------------------|---------------------------|--------------------------|
| Complexity | M | M | M-H |
| Codebase fit | H (all precedents) | M (naming debt) | L (no two-transport precedent) |
| Risk | L-M | L-M | H (D5 gate + FR4 pool) |
| Test triage | Clean | Muddy | Muddiest |

## Recommendation

**Selected:** Option 1 - New fetch-linkedin-api.ts module.

**Rationale:**
- The research's own analysis converges here: the acquisition-block collapse (index.ts:185-192, :236-248, :365-417, :254) happens under every candidate; Option 1 adds the shape with the most precedent support and the least new coupling.
- Option 3's blockers are FRD-fixed (D5 degrade, FR4 sequential), so no scoping choice removes them.
- Option 2 saves nothing real: the 346-line file (wc -l verified) is a rewrite either way, and its test file mostly dies either way.

**Why not alternatives:**
- Option 2: buys old-name debt and muddy test triage for zero measurable savings.
- Option 3: blocked - couples the degrading arm into the Threads all-fail gate and fights the runPool wrapper.

**Trade-offs:**
- Accepting one more module + seam concept for structural isolation of LinkedIn failures.

**Implementation approach:**
1. Add ENV_NAMES pair (config.ts:16-19 slot: linkedApiToken, linkedApiIdentificationToken) and delete the four dying LinkedIn names.
2. Write fetch-linkedin-api.ts: token resolvers (silent null on unset), client factory seam, sequential loop (catch idiom, no all-fail throw), drop-and-count Post mapping, pending-workflow and thrown-error shapes both handled per the SDK facts.
3. Rewire runWatcher: optional WatcherDeps field, raw-surface partition, skip-warn re-key (:193-197 topology), delete recoverLinkedInSession + login imports (:48-54, :185-192, :365-417), drop LinkedIn cleanup (:254).
4. Shed fetch-threads.ts to Threads-only (delete :302, :337-366, :380-383 linkedin half, :412) and decide the mirror guard's fate (provably unreachable - likely delete with a comment).
5. Delete Phase 7 wholesale: linkedin-login.ts, scripts/linkedin-login.ts, watch.yml :94-97/:103-129/:140-146, test suite tests/index.test.ts:721-1020, .gitignore:8, package.json:11 lint path entry, README rows/sections, threads-session.ts:13 docstring sentence.
6. Flip watch.yml:13 to cancel-in-progress: true and rewrite the F023 comments in lockstep (watch.yml:48-54 + judge.ts:98-107) without the dead 71s term.
7. Run the three gates; then the operator precondition: Linked API seat, both secrets, one live dispatch - measured fetch wall-clock feeds the F023 replacement arithmetic and the WAIT_BUDGET_MS decision.

**Integration points:**
- src/index.ts:168-256 - new arm joins the closure; await stays inside so fetchMs stays the one timing line.
- src/index.ts:193-197 - the single warn site, gated on linkedinSurfaces.length > 0.
- src/config-file.ts:229-234 + :252-256 - linkedin arm and builder die together; their test tests/config-file.test.ts:192-203 dies.
- watch.yml:11-13, :48-55, :94-97 - guard flip, lockstep comment rewrite, env swap to LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN.

**Patterns to follow:**
- Degradable resolver: threads-session.ts:37-60 (silent null on unset; caller owns policy).
- Per-surface catch: fetch-threads.ts:390-394 (message passthrough, never rethrow).
- Drop-and-count: extract.ts:36-70 with the :87-113 guarded conversion shape.
- Doubles-for-offline: dualPlatformContextFactory tests/index.test.ts:499-544; the new module gets the same client-seam stub.

**Risks:**
- Live SDK behavior diverges from docs (pending-vs-thrown working hours, hashtag-as-term widening): mitigation is the operator precondition + one live dispatch before declaring done; expect one declared retune commit (93a3f38 precedent).
- F023 comments drift (the repo's known failure mode): the lockstep rewrite is step 6, not a follow-up.
- Blast-radius under-declaration (the audit's plan-file lesson): the enumeration in step 5 includes the ripple zone (package.json:11, .gitignore:8, threads-session.ts:13, README rows) that two prior validations flagged as missing.

## Scope Boundaries
- Building: the SDK post-search fetcher module, the runWatcher rewiring, the full Phase 7 deletion, the guard flip + F023 lockstep rewrite, env swap.
- NOT building: jobs search (D6), CLI process wrapper (D8), LinkedIn parallelism (FR4), config file changes (D2), any change to the judge/digest/heartbeat/state stages, a Linked API probe script (suggested follow-up only).

## Testing Strategy

**Unit tests:**
- New fetch-linkedin-api test file (offline, stubbed client): result order preserved; re-mint dedupe via Map accumulator; empty result returns [] + 0-post log; thrown error shapes (LinkedApiError type-keyed) and pending-workflow shape both warn-and-skip per surface; malformed rows dropped with a count + conditional warn; date guard before toISOString.
- runWatcher degradation tests re-key: regexes at tests/index.test.ts:573/:603 move to LINKED_API_TOKEN wording with the fetcher-stub never-called assertions (:559/:588 precedent).
- Dies whole: tests/index.test.ts:721-1020 (Phase 7), tests/fetch-linkedin.test.ts (mapping subset ports into the new file), tests/config-file.test.ts:192-203, tests/session.test.ts:55-85, tests/fetch-threads.test.ts platform-dispatch cases (:547-569, :571-599, :623-642 - :601-621 survives).

**Integration tests:**
- None new; the three gates (typecheck, lint, test) plus the existing offline suite carry the change.

**Manual verification:**
- [ ] Operator precondition: paid Linked API seat, connected LinkedIn account, LINKED_API_TOKEN + LINKED_API_IDENTIFICATION_TOKEN in GitHub secrets.
- [ ] One live workflow_dispatch run: LinkedIn surfaces fetch, digest lands, exit 0; capture fetchMs for the F023 arithmetic.
- [ ] Deliberate bad-token run: single warn naming LINKED_API_TOKEN, Threads posts still delivered, exit 0.

## Open Questions
**Resolved during research:**
- Where the fetcher gets the raw surface value: runWatcher partitions raw config.surfaces (config destructured at index.ts:154 per research; resolveSurfaces is 1:1 order-preserving, config-file.ts:220-221) - zero ResolvedSurface change (developer checkpoint).
- Where the missing-token warn lives: caller warns, resolver returns null silently (developer checkpoint; resolveSession :42 topology).
- Token resolver contract: degradable-warn-null family, single exit (unset/blank) because an opaque token has no offline-validatable payload.

**Requires user input:**
- Whether ResolvedSurface.platform narrows to "threads" after cutover - design-stage call (fact is Threads-only; no consumer forces it).
- WAIT_BUDGET_MS value: keep 180s with rewritten comment, or re-measure after the first live runs (research residual; FRD NFR does not mandate a new value).
- ESM import form for the CJS @linkedapi/node package to pin in code: the repo is ESM (package.json:5, verified) and the package ships CJS with no exports map; default-import interop compiled in the research's offline probe, but the exact form is unpinned - the wrong form fails typecheck or fails at runtime. (Research residual, restored to this artifact.)

**Blockers:**
- Live API behavior (hashtag-as-term semantics; working-hours pending vs thrown shapes in practice) - unblocked by the operator precondition + first live dispatch; research handled both shapes in the design constraints.

## References
- .rpiv/artifacts/research/2026-11-01_19-34-17_linkedin-post-search-surface.md - parent research (SDK facts, deletion enumeration, precedents)
- .rpiv/artifacts/discover/2026-11-01_18-53-36_linkedin-cli-post-search-surface.md - governing FRD (D1-D12, FR4)
- .rpiv/guidance/src/architecture.md - funnel gates, WatcherDeps contract, resolver families
- .rpiv/guidance/.github/workflows/architecture.md - step-scoped secrets, state commit-back, F023
- .rpiv/guidance/tests/architecture.md - offline conventions, doubles, fixtures
- src/index.ts:168-256 - acquisition closure (rewiring target)
- src/threads-session.ts:37-60 - the degradable resolver contract
- src/fetch-threads.ts:390-409 - catch idiom to borrow; throw gate that must not transplant
