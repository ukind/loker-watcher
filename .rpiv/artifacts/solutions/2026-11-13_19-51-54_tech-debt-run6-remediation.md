---
date: 2026-11-13T19:51:54+0700
author: Yogiswara Utama
commit: df890a9
branch: main
repository: loker-watcher
topic: "Tech-debt run #6 remediation execution (N041-N059)"
confidence: high
complexity: high
status: ready
verdict: pass
tags: [solutions, tech-debt, judge, judge-dispatch, linkedin-fetch, linkedin-walk, knip, docs]
last_updated: 2026-11-13T20:14:00+0700
last_updated_by: Yogiswara Utama
last_updated_note: "20-cell fit grid with measured evidence; precedent-fit and integration-risk in the comparison; new-module LOC ~1400 (738 from judge.ts + 587 from linkedin-fetch.ts + headers); N041 citations re-homed to linkedin-context.ts post-split; cycle check replaced with a parse-based node one-liner (tested against 4 fixtures); Summary block restored to the Step 7 template; fit_method moved under Fit Grid; slice 3/5 overlap clause added"
---

# Solution Analysis: Tech-debt run #6 remediation execution (N041-N059)

**Date**: 2026-11-13T19:51:54+0700
**Author**: Yogiswara Utama
**Commit**: df890a9
**Branch**: main
**Repository**: loker-watcher

## Research Question

Remediate every open finding from tech-debt audit run #6 (N041-N059) so the next audit's open-findings table is empty. The pass fixes the two real logic gaps in the LinkedIn walk first (streak race, cap overshoot), then splits the two god files (`judge.ts` 1091 LOC, `linkedin-fetch.ts` 898 LOC) into four modules, then bounds the capture disk, then runs the hygiene sweep, then reclaims the 172 MB of loose git objects and records the state-history policy.

Input: `.rpiv/artifacts/research/2026-11-13_18-51-06_tech-debt-run6-remediation.md`.

## Summary

**Problem**: 19 open findings. Two are real logic gaps in a live walk. Two are god files above the 500-line threshold. The rest are hygiene and doc drift.
**Recommended**: Theme-sliced - the only shape with a verified landing precedent in this repo, and the only one that keeps each slice small against a main that takes 106 commits/day.
**Effort**: High (~3 days)
**Confidence**: High

## Problem Statement

**Requirements:**
- Close N041-N059. The next audit's open-findings table must be empty.
- Fix the walk's streak race (N046) and cap overshoot (N047) before any code moves.
- Split `judge.ts` and `linkedin-fetch.ts` below 500 LOC each (N042, N005).
- Bound the capture disk (N051) and the zero-post payload overwrite (N050).
- Sync six doc layers last (N044, N045).

**Constraints:**
- Splits must be byte-verbatim moves. No logic edits inside a move. The `f14d9f9` -> `2338274` lesson forbids conflating the two.
- No runtime import cycle. Type-only back-edges are legal under `verbatimModuleSyntax`.
- `guardCheckout` throws on any untracked file in `state/`. Every new `state/` writer must be gitignored or self-cleaning.
- `npm run typecheck`, `npm run lint`, `npm test` must pass at every landing point.
- The PC loop runs from a dedicated clone of main. It keeps running old code until a slice lands.

**Success criteria:**
- `wc -l src/judge.ts` under 500. `wc -l src/linkedin-fetch.ts` under 500.
- `npx knip` reports 0 unused exports and 0 unused types.
- `npm test` green, count >= 626.
- A grep pass over all six doc layers finds every module name.

## Current State

**Existing implementation:**

| File | LOC | Role |
|---|---|---|
| `src/judge.ts` | 1091 | env parsing + prompts + dispatch core + orchestration |
| `src/linkedin-fetch.ts` | 898 | context factory + tagged errors + pacing gate + walk + pool orchestration |
| `src/linkedin-capture.ts` | 207 | capture sink, no size bound |
| `src/linkedin-payload.ts` | 216 | payload envelope reader/writer |
| `scripts/fetch-linkedin.ts` | 452 | one tick: fetch, payload, commit, push |
| `scripts/probe-linkedin.ts` | 226 | read-only walk gate |

**Relevant patterns:**
- Atomic write via `stateTempPath` + rename: `src/state.ts:237-240`, used by `writePayloadAtomic` (`src/linkedin-payload.ts:111-139`), `writeCeilingsAtomic`, `writeHealthAtomic`, `makeFsCaptureSink`. 5 call sites.
- Type-only back-edge into a funnel module: `src/judge-rotation.ts:40` (`import type { LlmAccount, SleepFn } from "./judge.js"`), `src/judge-health.ts:34`, `src/judge-ceilings.ts:28`. 3 call sites.
- Deps object with defaulted fields: `FetchTickDeps` at `scripts/fetch-linkedin.ts:87-140`. 1 call site, the idiom to copy for N054.
- Gated commit slices: run #4 landed as five individually green commits (`.rpiv/artifacts/plans/2026-11-03_08-38-22_tech-debt-run4-remediation-execution.md`, `phase_count: 5`).

**Integration points:**
- `src/judge.ts` - 14 importers across `src/`, `scripts/`, `tests/`.
- `src/linkedin-fetch.ts` - 8 importers across `src/`, `scripts/`, `tests/`.
- `tests/linkedin-fetch.test.ts` - 36 `fetchLinkedInPosts(` call sites, all shift under N054.
- `.github/workflows/ci.yml:26-33` - three gate steps, 10-minute job timeout. A knip step joins after Test.
- `package.json:33-40` - six devDependencies. knip is not one.

## Fit Grid

4 candidates x 5 kept dimensions. Every cell carries measured evidence. `novelty` was dropped at the Step 3 checkpoint: the topic is wholly internal.

Fit method: orchestrator-assessed. This harness exposes no agent-spawn tool, so the per-candidate evidence was gathered by direct `git`, `grep`, and `wc` measurement rather than by dispatched `codebase-analyzer` agents.

### precedent-fit

| Candidate | Evidence | Score |
|---|---|---|
| C1 Corrected single-pass | `git merge-base --is-ancestor f1812b4 main` -> exit 1. Same for `b9e7d71` and `a9834a8`. `ukind/fix-tech-debt` is 463 behind main, 14 ahead. The identical shape (one branch, judge split plus more, one validation) was executed, validated at 540/540 tests and knip 0/0, and never merged. | Weak |
| C2 Theme-sliced | Run #4 landed as five gated commits on main: `6efe6da`, `bf6594c`, `250a4e1`, `ed13452`, `4c11e0f`. All present in `git log main`. The plan artifact declares `phase_count: 5` with per-phase `depends_on`. | Strong |
| C3 Risk-partitioned | Mixed. Track 1 matches run #4's gated-commit style, which landed. Track 2 matches run #5's branch style, which did not. Track 2 is the larger half (~1277 LOC moved). | Mixed |
| C4 Splits-deferred | "Accept and document" has precedent: N017 carried from run #4 into N043, N005 carried from runs #2-#5. The audit records the outcome: N005's deferral trigger "has now fired five times", `judge.ts` grew 830 -> 1091 (+31%), N017 worsened 1.6 MB -> 4.0 MB (2.5x). | Weak |

### integration-risk

| Candidate | Evidence | Score |
|---|---|---|
| C1 Corrected single-pass | Main takes 744 commits in 7 days, 618 of them `state:` (106/day, 88 state/day). A 3-day branch diverges ~318 commits. Run #5 ended 463 behind. Every rebase replays against `state/seen-posts.json` (4.0 MB) and `state/linkedin-posts.json` (517 KB). One end-of-pass validation leaves no bisect point. | High |
| C2 Theme-sliced | Each slice lands within hours, so divergence stays at ~10-20 `state:` commits. Slice boundaries match the dependency chain: walk fixes before the walk moves, tick deps before the signature moves, split before the N041 carve-out, docs last. The one large diff is slice 3 (N054, 36 test call sites), and it is one coherent diff. | Low |
| C3 Risk-partitioned | Track 2 must rebase over track 1's fixes. The fixes edit lines inside the exact range the split moves: `seenStreak` at relative 17/84/87/177/247, `catch` at 67/121, `LINKEDIN_MAX_POSTS` at 173 - all inside `sed -n '487,780p' src/linkedin-fetch.ts`, which is the range `linkedin-walk.ts` receives. Conflicts are structural, not incidental. | High |
| C4 Splits-deferred | Lowest. No branch, no LOC moved, no re-export facades. One unresolved coupling: `makeLinkedInContextFactory` (`src/linkedin-fetch.ts:340`) has one internal reference at `:409` and no cross-module importer. It is the N041 carve-out, valid only if the split lands first. Deferring the split means the knip gate cannot land clean. | Low, one coupling |

### approach-shape (hybrid, orchestrator-scored)

| Candidate | Shape | New modules | Files modified | Gates |
|---|---|---|---|---|
| C1 | One long-lived branch, 7 groups sequential | 4 | ~18 | 1 |
| C2 | Six gated slices, dependency-ordered | 4 | ~18 | 6 |
| C3 | Two tracks, splits on a branch | 4 | ~18 | 2 + 1 merge |
| C4 | One pass, no structural change | 0 | ~12 | 1 |

### migration-cost

| Candidate | Evidence | Score |
|---|---|---|
| C1 | ~1348 new-module lines, ~690 moved out of `judge.ts`, ~587 moved out of `linkedin-fetch.ts`, 36 test call sites, 6 doc layers. One pass, no repeated rebase. | Medium-High |
| C2 | Same total, plus 6 gate runs and 6 rebases. | Medium |
| C3 | Same total, plus a merge and a conflict resolution across the walk range. | Medium-High |
| C4 | ~600 lines modified, 0 moved. The 36 test call sites still shift: N054 is a signature change, not a split. | Low-Medium |

### verification-cost

| Candidate | Evidence | Score |
|---|---|---|
| C1 | One gate run at the end. No bisect point. `f14d9f9` -> `2338274` needed a same-day fix in the moved region. | Medium |
| C2 | 6 x (typecheck + lint + 626 tests) ~ 6 x 40 s local; 6 CI runs at ~2 min. A failure names its slice. | Low-Medium |
| C3 | 2 gates plus a post-merge re-verify. | Medium |
| C4 | 1 gate. No byte-verbatim move proofs, no cycle checks, no re-export audits. | Low |

## Solution Options

### Option 1: Corrected single-pass
**How it works:**
One branch. FRD order with the research corrections applied: walk fixes, capture bound, tick deps, judge split, linkedin-fetch split, hygiene, doc sync last. One validation at the end, then merge.

**Pros:**
- One rebase, one gate run, one review.
- Doc sync sees the final tree, so it is written once.

**Cons:**
- Run #5 used this exact shape for the same judge split. It never merged. Verified: `git merge-base --is-ancestor f1812b4 main` returns 1, and the branch is 463 commits behind.
- Main moves 106 commits/day, 88 of them `state:`. A multi-day branch diverges by hundreds of commits.
- Every rebase replays against `state/seen-posts.json` (4.0 MB) and `state/linkedin-posts.json` (517 KB).
- A failure at hour 12 has no bisect point.

**Complexity:** High (~3 days)
- Files to create: 4 (~1400 lines)
- Files to modify: ~18 (~1300 lines)
- Risk level: High

### Option 2: Theme-sliced
**How it works:**
Six slices, each green under typecheck / lint / test before the next lands. Order: (1) walk fixes N046/N047/N048, (2) capture bound N051, (3) tick deps N050/N053/N054, (4) judge split N042a/N005, (5) linkedin-fetch split N042b/N059, (6) hygiene N041/N043/N049/N056 + doc sync N044/N045.

**Pros:**
- Run #4 landed with this shape: five reviewable, individually green commits, gates between slices. Verified in `git log main`.
- Each slice lands within hours, so divergence stays at ~10-20 `state:` commits.
- The dependency order the research doc already corrected maps 1:1 onto the six slices.
- A failure names its slice. No bisect needed.

**Cons:**
- Six gate runs and six rebases instead of one.
- Slice 3 (N054) is still a large diff on its own: 36 test call sites plus the tick rewrite.

**Complexity:** Medium (~3 days)
- Files to create: 4 (~1400 lines)
- Files to modify: ~18 (~1300 lines)
- Risk level: Low

### Option 3: Risk-partitioned
**How it works:**
Two tracks. Track 1 lands the logic fixes, capture bound, and hygiene straight to main. Track 2 runs the two god-file splits on a dedicated branch and merges after validation.

**Pros:**
- The low-risk half lands immediately.
- The splits get an isolated validation window.

**Cons:**
- Track 2 is the run-5 shape, which failed to merge.
- Track 2 carries the two largest moves (~1277 LOC) and must rebase over the fixes that just edited the same lines inside `walkLinkedInSurface`. The overlap is measured: every N046/N047/N048 edit site sits inside `487-780`, the range `linkedin-walk.ts` receives.
- Two validation passes, one merge.

**Complexity:** High (~3 days + merge)
- Files to create: 4 (~1400 lines)
- Files to modify: ~18 (~1300 lines)
- Risk level: High

### Option 4: Splits-deferred
**How it works:**
Land every non-split finding. Record N042 as an accepted deviation with a run-7 handoff note.

**Pros:**
- Lowest risk. No branch, no LOC moved, no re-export facades.
- "Accept and document" has precedent: N017 in run #4, N005 across five runs.

**Cons:**
- The pass's own success criterion is an empty open-findings table. N042 stays open by construction.
- N005 has already recurred five times. The deferral trigger fired five times and produced N042.
- The knip gate cannot land clean. `makeLinkedInContextFactory` (`src/linkedin-fetch.ts:340`) has one internal reference at `:409` and no cross-module importer. It is the N041 carve-out, and the carve-out is valid only if the split lands first.

**Complexity:** Low (~1.5 days)
- Files to create: 0
- Files to modify: ~12 (~600 lines)
- Risk level: Low, but leaves two findings open

## Comparison

| Criteria | Option 1 | Option 2 | Option 3 | Option 4 |
|----------|----------|----------|----------|----------|
| **precedent-fit** | Weak | **Strong** | Mixed | Weak |
| **integration-risk** | High | **Low** | High | Low, one coupling |
| approach-shape | 1 branch, 7 groups | 6 gated slices | 2 tracks | 1 pass |
| migration-cost | Medium-High | Medium | Medium-High | Low-Medium |
| verification-cost | Medium | Low-Medium | Medium | Low |
| Complexity | High | Medium | High | Low |
| Codebase fit | Low | High | Medium | Medium |

## Recommendation

**Selected:** Option 2 - Theme-sliced

**Rationale:**
- It is the only candidate with a verified landing precedent. Run #4's five gated commits are in `git log main`. Run #5's single-pass branch is verified unmerged (`merge-base --is-ancestor` exit 1, 463 behind).
- It is the only candidate that keeps every slice small against a main that takes 106 commits/day, 88 of them `state:`.
- The research doc's corrected dependency order is already a six-slice order. No re-derivation needed.
- Each slice is bisectable. The dispatch region is the repo's highest-risk area, and `f14d9f9` -> `2338274` needed a same-day fix there.

**Why not alternatives:**
- Option 1: run #5 is the identical shape and it never merged.
- Option 3: the branch carries the two largest moves and must rebase over fixes that touched the same lines. The overlap is measured, not assumed.
- Option 4: leaves N042 open by construction, and the knip gate cannot land clean while `makeLinkedInContextFactory` stays exported.

**Trade-offs:**
- Accepting six gate runs and six rebases for a landing that survives.
- Accepting that slice 3 (N054) is a large diff on its own.

**Implementation approach:**
1. Slice 1 - walk fixes. N046 streak fold in `seq` order, N047 cap slice, N048 narrowed catches. New test returns deferred promises and resolves them in reverse order.
2. Slice 2 - capture bound. N051 size guard on `Buffer.byteLength(record.body, "utf8")`, before `mkdir`, before the lazy session stamp.
3. Slice 3 - tick deps. N054 `FetchLinkedInDeps` object, N053 factory built from the resolved `profileDir`, N050 zero-post guard after the walk's try/catch and before the write. N053 edits `src/linkedin-fetch.ts:340-395`, which slice 5 relocates to `linkedin-context.ts`: slice 5 must carry the edit verbatim and say so in its diff note, or the move reads as a revert.
4. Slice 4 - judge split. `judge-prompts.ts` + `judge-dispatch.ts`. `sleep`/`SleepFn` move with `judgePost`. `normalizeEndpoint`/`terminalFailureReason` move with the core. Two facades on `judge.ts` with a removal note.
5. Slice 5 - linkedin-fetch split. `linkedin-context.ts` (factory + three tagged-error families) + `linkedin-walk.ts` (walk + 14 tuning constants). Re-export the six tagged-error symbols, `LinkedInContextFactory`, `SCROLL_JS`.
6. Slice 6 - hygiene + docs. N041 unexports + pinned knip gate, N049 atomic flags, N056 `state/*.tmp` ignore, N043 gc + policy, then the six-layer doc sync with a grep pass. N041's citations are post-split: `LINKEDIN_FETCH_CONCURRENCY` stays at `src/linkedin-fetch.ts:69`; `LEG_DEAD`, `ALL_SURFACES_FAULTED`, `HALT` and `makeLinkedInContextFactory` now live in `src/linkedin-context.ts` — the audit's `:208`, `:234`, `:265`, `:340` are pre-split line numbers.

**Integration points:**
- `src/judge.ts:126-131` - `sleep`/`SleepFn` move to `judge-dispatch.ts`. `src/index.ts:51-57` and `src/fetch-threads.ts:31` retarget.
- `src/judge-availability.ts:27` - retarget `normalizeEndpoint`/`terminalFailureReason` to `./judge-dispatch.js`.
- `src/judge-rotation.ts:40` - retarget `type SleepFn` to `./judge-dispatch.js`.
- `src/linkedin-fetch.ts:792-802` - ten positional parameters become a deps object.
- `tests/linkedin-fetch.test.ts` - 36 call sites shift.
- `.github/workflows/ci.yml:32-33` - knip step after Test, pinned version.
- `.gitignore:5` - add `state/*.tmp`.

**Patterns to follow:**
- Atomic write: `src/linkedin-payload.ts:111-139`
- Deps object: `scripts/fetch-linkedin.ts:87-140`
- Type-only back-edge: `src/judge-rotation.ts:40`
- Gated slices: `.rpiv/artifacts/plans/2026-11-03_08-38-22_tech-debt-run4-remediation-execution.md`

**Risks:**
- Slice 3 breaks 36 test call sites at once: land it as one commit, not two.
- Slice 4 closes a runtime cycle if `sleep` stays behind. The invariant: every `judge.js` import in `judge-dispatch.ts` is type-only. Check it by parsing, not by grep — a grep misses a multi-line import (a real cycle hides) and false-fails on `import { type LlmAccount }` (a legal edge):

  ```bash
  node -e 'const s=require("fs").readFileSync("src/judge-dispatch.ts","utf8");const m=[...s.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"\.\/judge\.js"/gs)];const bad=m.filter(x=>!x[1]).flatMap(x=>x[2].split(",").map(t=>t.trim()).filter(t=>t&&!t.startsWith("type ")));if(bad.length){console.error("runtime cycle:",bad);process.exit(1)}console.log("ok: judge.js imports are type-only")'
  ```

  `import type { LlmAccount } from "./judge.js"` is legal and expected, the same idiom `src/judge-rotation.ts:40` already uses.
- Slice 5 re-exports too much and re-creates N012: re-export only symbols with a real importer from `linkedin-fetch.js`.
- Slice 6's knip gate fails on first land: pin the version and budget a same-day fix window. CI gate additions broke on first land twice (`42b8cf8`, `510ff2a`).
- N049 flips the latch to fail-open for one tick: accepted, because the repo prefers a duplicate alarm over a suppressed one.

## Scope Boundaries

- In scope: N041-N059, all 19 findings.
- In scope: the four new modules and their re-export facades.
- Out of scope: moving `seen-posts.json` out of git (N043 option c). The pass records the policy and runs one gc.
- Out of scope: reducing the per-walk 85 MB capture. Only the outlier bound lands.
- Out of scope: re-pointing the two test imports that the judge facades serve. Run #7.

## Testing Strategy

**Unit tests:**
- N046: deferred-promise double, bodies resolved in reverse order. Assert the streak counts stream order, not completion order.
- N047: more than 150 posts across multiple bodies. Assert the return is exactly 150 and keeps the newest.
- N048: a parser `RangeError` warns once. A page-close error stays silent.
- N050: a zero-post walk does not call `writePayloadAtomic` and does not clear the episode marker.
- N051: a body over the bound writes no file and warns. A body under the bound round-trips byte-identical.
- N053: a `LINKEDIN_PROFILE_DIR` override reaches the factory the tick opens.
- N054: the deps object defaults match the current positional defaults, including a fresh `seenIds` per call.
- N049: a crash between temp write and rename leaves no truncated flag.
- N041: knip reports 0/0.

**Integration tests:**
- `npm run typecheck && npm run lint && npm test` after each slice.
- `npx knip` after slice 6.
- `grep` pass over all six doc layers for every module name.

**Manual verification:**
- [ ] `wc -l src/judge.ts src/linkedin-fetch.ts` both under 500
- [ ] `npm run probe-linkedin` still gates on a real session
- [ ] `npm run fetch-linkedin` from the dedicated clone still passes `guardCheckout`
- [ ] `git status --porcelain` clean after a simulated crash mid-flag-write

## Open Questions

**Resolved during research:**
- Is knip a devDependency? No. Six devDeps, no knip entry, no lockfile entry, no binary. The gate lands pinned.
- Can the narrow judge split reach 500 LOC? No. It lands at ~746. The run-5 set is required.
- Does N053's env override work today? No. The factory is built once from the literal and ignores the `profileDir` argument.
- Is `slice*-recon/` dead? No. Used as recently as the 2026-11-13 pairing design.
- How many doc layers? Six, not three.
- Is run #5's branch merged? No. `git merge-base --is-ancestor f1812b4 main` returns 1. The branch is 463 behind, 14 ahead.
- Did run #4 land as gated slices? Yes. Five commits on main: `6efe6da`, `bf6594c`, `250a4e1`, `ed13452`, `4c11e0f`.
- Is the run-6 shape the run-5 shape? Not exactly. Run #5 shipped two modules (`judge-dispatch.ts` 695 LOC, `judge.ts` 405 LOC) with the prompt builders inside dispatch. Run #6 proposes three, carving `judge-prompts.ts` (~80 LOC) out of that 695. The research doc's "that is the run-5 shape" is imprecise on this point.

**Requires user input:**
- Does the knip gate land in `ci.yml` or as a separate job? Default: a step after Test in the existing job.
- Does N043 pick gc-once-and-document or a scheduled gc? Default: gc once, document the policy, no schedule.

**Blockers:**
- None.

## References

- `.rpiv/artifacts/research/2026-11-13_18-51-06_tech-debt-run6-remediation.md` - the corrected findings and line citations
- `.rpiv/artifacts/discover/2026-11-13_18-35-26_tech-debt-run6-remediation.md` - the FRD
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md:81-105` - the N041-N059 table, N005, N017
- `.rpiv/artifacts/plans/2026-11-03_08-38-22_tech-debt-run4-remediation-execution.md` - the five-slice precedent that landed
- `.rpiv/artifacts/plans/2026-11-10_06-56-47_tech-debt-zero-findings-execution.md` - the run-5 D1 set, branch-only
- `.rpiv/artifacts/validation/2026-11-10_09-22-22_tech-debt-zero-findings-execution.md` - run-5 pass verdict, never merged
- `src/judge.ts:126-131`, `:219`, `:371`, `:474-692`, `:693`, `:795`, `:904` - the move set
- `src/linkedin-fetch.ts:208-282`, `:305-409`, `:487-780`, `:792-802` - the move set
- `scripts/fetch-linkedin.ts:87-140`, `:264-283`, `:398-438` - the tick
- `tests/linkedin-fetch.test.ts:204`, `:252`, `:261` - the double that cannot see the race
