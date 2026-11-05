---
date: 2026-11-03T08:01:55+0700
author: Yogiswara Utama
commit: ecc9865
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Tech-debt audit remediation run #4 (N010-N017) execution strategy"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, tech-debt, linkedin-cutover, commit-slicing, credential-guard, n013-park-guard]
last_updated: 2026-11-03T08:35:17+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Correction passes 1-2 before design: first-hand citation fixes (.gitignore, watcher.config.json, watch.yml commit-back, import line :114), guidance widen moved to slice 4, TS2307 push-window risk added, dimension set restored (migration-cost relabel + orchestrator-scored approach-shape), path counts measured from porcelain (42 - watcher.config.json proved unmodified), two research-missed files re-homed (src/config.ts slice 1, src/judge.ts slice 3), pre-cooked-candidate critique recorded."
---

# Solution Analysis: Tech-debt audit remediation run #4 execution strategy

**Date**: 2026-11-03T08:01:55+0700
**Author**: Yogiswara Utama
**Commit**: ecc9865
**Branch**: feature/add-support-for-linkeind
**Repository**: feature-add-support-for-linkeind

## Research Question
How to execute the run #4 remediation on the mid-cutover working tree: guard the exposed LinkedIn credential (N010) first, commit the uncommitted LinkedIn SDK cutover in reviewable slices (N011) with the small fixes folded in (N012-N014), sync docs (N015), record the N017 accept-and-document policy, and carry the N016 operator checklist into the PR.

## Summary
**Problem**: One uncommitted ~25-path cutover plus a deleted ignore rule exposing a live credential blob must become reviewable history without shipping the credential.
**Recommended**: FRD four-slice fold - guard first, then four path-scoped slice commits with each fix baked into its file-home slice, gates between slices, N016 on the PR.
**Effort**: Med (~0.5 day; gates are offline and take minutes each)
**Confidence**: High

## Problem Statement

**Requirements:**
- N010 lands before any sweep-style staging: restore linkedin-state*.b64 at the .gitignore run.log boundary and rm the untracked blob.
- The cutover lands in reviewable slices, each green under npm run typecheck / lint / test.
- N012 unexport, N013 guard widening (+ red test), N014 spy port, N015 doc sync, and the N017 policy note land in the same PR.
- N016 (delete four orphaned LINKEDIN_* GitHub Actions secrets, incl. the fine-grained PAT) rides the PR description.

**Constraints:**
- Hard: state writes atomic; strict TS flags stay on; no new runtime deps; secrets never committed; tests offline and deterministic.
- Hard: the guidance mirror at .rpiv/guidance/src/architecture.md:78 must widen with N013 - guidance edits are part of the fix, not an afterthought.
- Soft: keep commit ceremony proportionate; repo history has no multi-slice precedent to copy.

**Success criteria:**
- Five commits on the branch, each green under the three gates.
- linkedin-state.b64 absent from tree and history; the ignore rule present.
- PR carries the N016 checklist; committed guidance and code agree on the parked contract.

## Current State

**Existing implementation** (first-hand in the research doc; three fit agents corroborated the load-bearing seams but disagreed on three file citations - every drifted number below is now closed first-hand in the main session; see Follow-up Analysis):
- Working tree (git status --porcelain, ground truth): new src/fetch-linkedin-api.ts (~255 lines) + tests/fetch-linkedin-api.test.ts (~341); five deleted files; modified: src/index.ts, src/fetch-threads.ts, src/config-file.ts, src/threads-session.ts, src/config.ts, src/judge.ts, .github/workflows/watch.yml, package.json, package-lock.json, README.md, .rpiv/artifacts/TECH_DEBT_AUDIT.md, and the four .rpiv/guidance/ mirrors. watcher.config.json is NOT modified (git diff HEAD empty; HEAD already carries the linkedin surfaces at :30-31). The research slice lists missed src/config.ts and src/judge.ts; both are re-homed in the plan below.
- .gitignore (first-hand: git show HEAD + working-tree read): HEAD holds linkedin-state*.b64 at :8 with run.log at :9 (f571904 added it); the working tree has the rule deleted - 8 lines with run.log at :8. Restore point: between slice*-recon/ and run.log. The blob linkedin-state.b64 (3,852 bytes) sits untracked at root and is not in history.
- src/fetch-linkedin-api.ts:179 pins a strict === "outsideWorkingHours" guard; pendingReason?: string | null at :70; the result() call at :187 can hang into the 8-minute cap (watch.yml:65).
- captureLines at tests/fetch-linkedin-api.test.ts:93-106 hand-rolls console reassignment across 9 call sites; the silent-resolver test at :122-139 repeats the violation.
- The three factories have zero external importers; the suite imports only the public seam (:12-19) and passes explicit factories (10/10 LinkedIn, 16/16 Threads call sites).
- Gates: ci.yml runs typecheck/lint/test only - no knip gate; package.json:21 pins @linkedapi/node ^2.3.20, the only new runtime entry.
- The SDK dynamic import sits at src/fetch-linkedin-api.ts:114 (first-hand; the research said :120). watcher.config.json is unmodified: git diff HEAD is empty, and HEAD already carries the two linkedin surfaces at :30-31 (first-hand; the research cited :10-11 - stale, and it wrongly carried the file as modified).
- scripts/hooks/gate-destructive.js has no git add rule: nothing mechanical stops a pre-guard sweep.

**Relevant patterns:**
- Optional-trailing-default-param injection seams: src/fetch-linkedin-api.ts:152, src/fetch-threads.ts:206, :297 - why the unexport is safe.
- Call-through spy idiom: tests/fetch-threads.test.ts:304, :410; tests/session.test.ts:65-68 - the N014 target.
- Accepted-cost paragraph: .rpiv/guidance/.github/workflows/architecture.md:75 (F021) - the N017 template.

**Integration points:**
- .gitignore - the N010 restore point: linkedin-state*.b64 between slice*-recon/ and run.log (HEAD :8).
- src/fetch-linkedin-api.ts:175-187 - the N013 guard block.
- tests/fetch-linkedin-api.test.ts:55-91 - stubClient harness with the resultCalls hang-oracle (:84-87).
- .rpiv/guidance/src/architecture.md:78 - the parked-contract mirror (widens with N013).
- .github/workflows/watch.yml - the commit-back step: step name :111, state-only add :121, script call :129 (first-hand; the research said :111-128 and agent 3 said :111-129 - both were approximations). Untouched by every option; most fix-prone area per precedent.

## Solution Options

### Option 1: FRD four-slice fold (recommended)
**How it works:**
Step 0 commits the N010 guard (restore the ignore rule + rm the blob). Then four path-scoped slice commits with gates between: slice 1 = new SDK module + suite with the N013 widening (+ red test), the N012 unexport of createLinkedApiClient, and the src/config.ts ENV_NAMES keys the module imports, all baked in; slice 2 = deletions + rewiring including the N012 unexport of the two fetch-threads factories (per-file home for N012) and the four rewired test suites; slice 3 = watch.yml + src/judge.ts (the mirrored concurrency contract) + package.json + package-lock.json; slice 4 = docs, guidance (incl. the :78 mirror widen), artifacts. The PR carries the N016 checklist.

**Pros:**
- Lesson-consistent with all five audited precedents: guard-first, slice separation, docs commit, per-file fix homes.
- No hazard window: fixed code lands from its introduction commit onward.
- Cheapest safe shape: 5 commits, ~4 gate triples over offline suites (seconds to low minutes each).

**Cons:**
- Fix diffs are invisible as deltas; the reviewer verifies N012-N014 by reading the new files, not a diff.
- The N013 red-first demonstration exists only pre-commit.
- knip acceptance stays ad hoc (no CI gate).

**Complexity:** Med (~0.5 day)
- Files to create: 0 beyond the cutover itself
- Files to modify: 42 path-slots across 5 commits (measured from git status --porcelain, 2026-11-03T08:35:17+0700; watcher.config.json excluded - unmodified)
- Risk level: Low-Med (staging discipline is the risk)

### Option 2: Fixes-after micro-commits
**How it works:**
Step 0 guard, then the four cutover slices exactly as the tree stands, then N012, N013, N014 as three standalone minimal commits, then docs. Nine commits, one gate round per gate-bearing commit (~7 rounds).

**Pros:**
- Every fix is a small, revertable, individually reviewable diff.
- Matches the fixes-after half of history (4/5 precedents show follow-up fix commits).

**Cons:**
- Commits 1-6 carry the strict guard green-in-CI: an unfalsified hazard window in history.
- Guidance contradicts code between the N013 commit and the docs commit unless the mirror rides the fix commit.
- Highest ceremony: ~21 gate invocations, ~41 path-slots, deliberate double-review of ~80 lines; a slice-3 CI red spawns an unplanned 10th commit.

**Complexity:** Med-High (~1 day)
- Files to create: 0 beyond the cutover
- Files to modify: the same ~42 path-slots across 9 commits
- Risk level: Med

### Option 3: Guard + single squash
**How it works:**
Step 0 guard, then ONE commit containing the entire cutover + all three fixes, then ONE docs commit; gates run once.

**Pros:**
- Cheapest mechanically: 2-3 commits, 1 gate triple, minimal staging discipline.
- Matches historical landing granularity (3/3 past fetcher landings were single big commits).

**Cons:**
- Fails the fit filter: the squash IS the sweep the audit warns about (TECH_DEBT_AUDIT.md:53).
- All 3 matching precedents required same-day fixes against the big base (defb8af, the five-fix chain, the supersession of f571904).
- Revert granularity collapses to the whole cutover; the reviewer reads ~3,000 lines of final state; a post-push CI failure hotfixes an unreviewable base.

**Complexity:** Low (~2 h)
- Files to create: 0 beyond the cutover
- Files to modify: the same ~42 paths across 2-3 commits
- Risk level: High (concentrated in one staging moment + one unreviewable diff)

## Comparison

| Criteria | Opt 1 fold | Opt 2 fixes-after | Opt 3 squash |
|----------|------------|-------------------|--------------|
| Complexity | M | M-H | L |
| Codebase fit (precedent) | M (5/5 lessons) | M (4/5 fix-half, 0/5 slicing) | L (3/3 cautionary) |
| Risk | L-M | M | H |
| Migration-cost (commits / gate triples) | 5 / ~4 | 9 / ~7 | 2-3 / 1 |
| Approach-shape (orchestrator-scored) | 4 whole-file slices + guard; fixes folded at file home | 4 slices + 4 follow-up commits; fixes as visible diffs | 1 mega-commit + docs; no internal boundaries |
| Verification attribution | Med | Med (2 blind spots) | Low |

Approach-shape note (orchestrator-scored per the skill contract): Opt 1 = one staging decision and one gate pass per whole-file slice; Opt 2 = the same plus a four-commit fix ledger with per-commit gate rounds and double review of the touched hunks; Opt 3 = one staging decision, one gate pass. The dispatch prompts scored migration-cost under the drifted label execution-cost (same rubric, renamed here for fidelity to the checkpoint). The informative axis between Opt 1 and Opt 2 is fix placement - folded vs landed after - not slice count.

## Recommendation

**Selected:** Option 1 - FRD four-slice fold, with three adjustments absorbed from the fit reports.

**Rationale:**
- Guard-first then slices is the composite lesson of all five audited precedents; step 0 removes the only irreversible hazard before any staging, and no hook enforces it mechanically.
- Every slice can land green: slice 1 is purely additive over HEAD; slice 2 is green once the rewired test suites ride with the src rewiring; CI tests the PR head, so pushing all slices before opening the PR avoids any intermediate-push window.
- The three fit agents corroborated the load-bearing seams (strict guard at :179, churn-zero N014 port, zero factory importers, the hang-oracle double); their citation disagreements and two file-list omissions are closed first-hand in the correction pass, with commands recorded in Follow-up Analysis.

**Why not alternatives:**
- Option 2: pays 9 commits and ~21 gate invocations for visible fix diffs the topic does not require, and introduces a hazard window plus a guidance/code contradiction window.
- Option 3: fails the fit filter - unreviewable mega-diff, whole-squash revert granularity, and a historical base rate of same-day fixes against big landings.

**Trade-offs:**
- Accepting invisible fix deltas for four fewer commits and no double review.
- Accepting red-first for N013 as a pre-commit demonstration only.
- Accepting knip as an ad hoc acceptance run: typecheck + tests already prove the unexport safe; knip proves intent.
- Accepting a branch-internal guidance/code contradiction window (slice 1 to slice 4) to keep every commit whole-file staged.

**Implementation approach:**
1. Step 0 (N010) - restore linkedin-state*.b64 at the run.log boundary in .gitignore, rm linkedin-state.b64, commit the one-liner.
2. Slice 1 - write the N013 red test, show it red against :179, widen the guard to nullish with the two-arm message, port N014 spies (helper + silent-resolver test), drop export on createLinkedApiClient (src/fetch-linkedin-api.ts:107), run gates, commit exactly three paths (src/fetch-linkedin-api.ts, src/config.ts, tests/fetch-linkedin-api.test.ts) - the module imports ENV_NAMES keys HEAD does not have, so config.ts must ride here or slice 1 cannot typecheck.
3. Slice 2 - drop export on makeChromiumContextFactory/chromiumContextFactory (src/fetch-threads.ts:129, :180), stage the rewiring + five deletions + four test suites (~13-14 paths), gates, commit.
4. Slice 3 - watch.yml + src/judge.ts (the concurrency-contract mirror) + package.json + package-lock.json, run the gates (tests/commit-state-rebase.test.ts included), commit.
5. Slice 4 - AGENTS.md (3 insertions), .claude/skills/validate-e2e/SKILL.md:3, the guidance widen (the :78 line, edited onto the file that already carries 39 changed slice-4 lines) and the N017 note after :75, README, TECH_DEBT_AUDIT.md, the 13 untracked .rpiv/artifacts entries (incl. this solutions doc); commit; push all five slices at once; open the PR with the N016 checklist. watcher.config.json needs no slice - it is unmodified and HEAD already carries the surfaces.

**Integration points:**
- .gitignore run.log boundary - restore linkedin-state*.b64 (N010).
- src/fetch-linkedin-api.ts:179-185 - nullish guard + two-arm message (N013).
- tests/fetch-linkedin-api.test.ts:93-106, :122-139 - spy port (N014).
- src/fetch-linkedin-api.ts:107, src/fetch-threads.ts:129, :180 - the three unexports (N012), split by file home.
- src/config.ts:16-17 - the ENV_NAMES linkedApi pair, added by the working tree (verified: HEAD src/config.ts has no linkedApi keys); rides slice 1 because the new module imports these keys.
- .rpiv/guidance/src/architecture.md:78 - mirror widen rides slice 4 (the file already carries 39 changed lines of slice-4 edits; wholesale slice-1 staging would drag them, and hunk-level git add -p is the flaw adjustment 1 removes).
- .rpiv/guidance/.github/workflows/architecture.md:75 - N017 note lands after it, slice 4.

**Patterns to follow:**
- Injection seams: src/fetch-linkedin-api.ts:152 - explicit factory args keep tests offline after unexport.
- Call-through spies: tests/session.test.ts:65-68 - the N014 target idiom.
- Accepted-cost paragraph: .rpiv/guidance/.github/workflows/architecture.md:75 - the N017 template.

**Risks:**
- Staging discipline (a lazy git add . pre-N010 ships the blob; post-N010 it collapses the slices): explicit path lists per slice; verify with git status between slices. The research slice lists missed two modified files (src/config.ts, src/judge.ts) - porcelain is ground truth; both are re-homed above. state/seen-posts.json is currently unmodified; keep it out of every slice (the commit-back owns it).
- lint-staged biome autofix mid-commit: run npx biome check --write on the slice paths before staging; review hook output per commit.
- Per-commit push window (TS2307): the lockfile lacks @linkedapi/node until slice 3, so slices 1-2 pushed alone fail CI typecheck at the dynamic import (src/fetch-linkedin-api.ts:114). Mitigation: push all five slices, then open the PR - CI tests the PR head only.
- Guidance/code contradiction window: the :78 mirror widen rides slice 4 (whole-file staging; the file already carries slice-4 edits). The window spans slice 1 to slice 4 on the unmerged branch only; closed by slice 4 or by squash-merge.

## Scope Boundaries
- Building: the N010-N017 execution exactly as the FRD shapes it, in the slice plan above with the three adjustments.
- NOT doing: N005 judge split; probe ramp tests; negative-delta commit wording; reasoning_effort endpoint verification; new CI gates (knip stays ad hoc); AGENTS.md:21 npm start env-list generalization (checkpoint decision: later pass).

## Testing Strategy

**Unit tests:**
- N013: new stubClient test (pendingReason "someNewReason", message set) asserting resultCalls deepEqual [] and value deepEqual [] - red under the strict guard, green after the widening; the existing parked test (:279-293) passes untouched.
- N014: the port projects the same lines: string[]; every .some/.filter assertion passes unchanged; the silent-resolver test ports to warns.mock.calls.length === 0.
- Per slice: full offline suite (16 suites) including tests/commit-state-rebase.test.ts.

**Integration tests:**
- CI runs the three gates on the PR head; push all slices before opening the PR so no intermediate state is CI-tested.

**Manual verification:**
- [ ] git check-ignore linkedin-state.b64 passes after step 0; the blob is gone from root.
- [ ] git status is clean after each slice; git log shows five commits in order.
- [ ] npx knip reports no unused exports for the three factories (N012 acceptance).

## Open Questions
**Resolved during research:**
- Where does the N012 fetch-threads.ts half land? - slice 2, the file-home slice; avoids partial-staging a heavily modified tracked file.
- Where does the guidance mirror widen land? - REVISED in the correction pass: slice 4. Slice-1 staging would drag the file 39 already-changed slice-4 lines or force hunk-level git add -p - the exact flaw adjustment 1 removes. The doctrine cost is accepted as a bounded branch-internal window.
- Where does watcher.config.json land? - REVISED in correction pass 2: nowhere. It is unmodified (git diff HEAD empty); HEAD already carries the two linkedin surfaces at :30-31. The research wrongly carried it as a modified file, and its :10-11 citation is stale.
- Where do the two research-missed modified files land? - src/config.ts rides slice 1 (the new module imports ENV_NAMES keys HEAD lacks); src/judge.ts rides slice 3 (its concurrency contract mirrors watch.yml). Found via git status --porcelain.
- Do the rewired test suites ride slice 2? - yes; committing the src rewiring without them leaves HEAD suites red.

**Requires user input:**
- None material. Default: the PR opens only after all five commits.

**Blockers:**
- None. N010-before-slice-1 is sequencing, not a blocker.

## References

- .rpiv/artifacts/research/2026-11-02_22-53-12_tech-debt-audit-remediation.md - the first-hand verified driving research (all file:line evidence).
- .rpiv/artifacts/discover/2026-11-02_22-40-38_tech-debt-audit-remediation.md - the FRD shaping the slice plan.
- .rpiv/artifacts/TECH_DEBT_AUDIT.md - audit rows N010-N017 (:25, :31, :53 load-bearing).
- .rpiv/artifacts/plans/2026-11-02_13-52-20_linkedin-sdk-post-search-cutover.md - cutover plan (byte-identical .gitignore quote at :1751-1765).
- .rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md:56-63 - the N004 unexport precedent.
- .rpiv/artifacts/solutions/2026-11-01_20-34-14_linkedin-api-fetcher-integration-shape.md - flagged the all-fail-throw bug class.
- History: f571904, 68c1e2d, 1a9e353/9e1c8ef, 510ff2a + five same-day fixes + b779ff7, 30d7561..b0b7dbe - the five precedents scored in this analysis.

## Follow-up Analysis 2026-11-03T08:29:34+0700

Developer review flagged five defects before design consumption. All closed in the main session; commands recorded so design can re-check.

1. **Dimension set restored.** The dispatch prompts scored migration-cost under the drifted label execution-cost (same rubric) and skipped approach-shape, which the skill assigns to the orchestrator. Fixed: the Comparison table now carries a relabeled migration-cost row and an orchestrator-scored approach-shape row plus a scoring note. The informative axis between Opt 1 and Opt 2 is fix placement - folded vs landed after - not slice count.
2. **Citation drifts closed first-hand.** Agents disagreed on three files; the earlier claim that they had independently re-verified them was wrong and is struck. Main-session verification: git show HEAD:.gitignore (rule at :8, run.log :9) and sed -n 1,12p .gitignore (working tree: 8 lines, run.log :8); grep -ni linkedin watcher.config.json (:30-31 - the research cited :10-11, stale); grep -n on watch.yml (commit-back step :111, state-only add :121, script call :129). Also re-verified: the dynamic import is src/fetch-linkedin-api.ts:114 (the research said :120) and the guidance mirror stands at :78.
3. **Adjustment 1 self-contradiction removed.** Slice 1 staged .rpiv/guidance/src/architecture.md wholesale, but git diff --stat -- .rpiv/guidance/ shows the file already carries 39 changed lines of slice-4 edits (4 guidance files, 38 insertions/24 deletions total). The :78 widen now rides slice 4; slice 1 commits code and tests only. The contradiction window is recorded in Trade-offs and Risks.
4. **TS2307 push-window hazard moved into Risks** (was buried in Implementation approach): the lockfile lacks @linkedapi/node until slice 3; slices 1-2 pushed alone fail CI typecheck at src/fetch-linkedin-api.ts:114. Mitigation: push all slices, then open the PR.
5. **Pre-cooked candidate set acknowledged.** Opt 1 was the FRD plan; Opt 3 was a shape the research composite lesson already rejects; the only informative comparison was fold (Opt 1) vs fixes-after (Opt 2). A hybrid (fold N012/N014, land N013 after with its red test) was considered here and rejected: it reintroduces the Opt 2 hazard window for one ~30-line diff, adds a commit and gate round, and overrides checkpoint decisions already locked in research. Verdict unchanged: Opt 1.

**New catches from the porcelain sweep (beyond the five):** git status --porcelain shows two modified cutover files the research slice lists missed. src/config.ts (the ENV_NAMES linkedApi pair) must ride slice 1 - the new module imports keys HEAD does not have, so slice 1 without it cannot typecheck. src/judge.ts (concurrency-contract comment mirrored at watch.yml) rides slice 3. Measured slice path counts: step 0 = 1, slice 1 = 3, slice 2 = 13, slice 3 = 4, slice 4 = 21; total 42 path-slots (the invented "~36" is replaced). state/seen-posts.json is currently unmodified - keep it out of every slice.

**Correction pass 2 (2026-11-03T08:35:17+0700):** watcher.config.json proved unmodified - git diff HEAD is empty and HEAD already carries the two linkedin surfaces at :30-31. It had been carried as a modified file from the agent path lists without verification; removed from slice 4 and from the modified-file inventory (slice 4 = 21, total = 42). The truncated ternary artifact on the Current State bullet ("linkedin references: 2") is rewritten with the verified facts. Slice-1 dependency confirmed first-hand: HEAD src/config.ts has no linkedApi keys; the working tree adds them at :16-17.