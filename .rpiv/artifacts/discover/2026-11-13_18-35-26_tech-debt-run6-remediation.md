---
date: 2026-11-13T18:35:26+0700
author: Yogiswara Utama
commit: df890a9
branch: main
repository: loker-watcher
topic: "Tech-debt audit remediation (run #6: N041-N059)"
tags: [intent, frd, tech-debt, judge-split, linkedin-fetch-split, capture-bounds, repo-hygiene]
status: ready
last_updated: 2026-11-13T18:35:26+0700
last_updated_by: Yogiswara Utama
---

# FRD: Tech-debt audit remediation (run #6: N041-N059)

## Summary
Remediate every open finding from tech-debt audit run #6 so the next audit's open-findings table is empty. The pass fixes the two real logic gaps in the LinkedIn walk first (streak race, cap overshoot), then splits the two god files (`judge.ts` 1091 LOC, `linkedin-fetch.ts` 898 LOC) into four modules, then bounds the capture disk, then runs the hygiene sweep, then reclaims the 172 MB of loose git objects and records the state-history policy. **About 7 hours of focused work across 6 slices**, gates between each. Four findings close as accept-and-document or deferral, each with the decision recorded in the guidance.

Ordering is load-bearing: the three walk fixes (N046, N047, N048) land BEFORE the `linkedin-fetch.ts` split, because all three cite lines inside `walkLinkedInSurface` (`:486-780`), which the split moves. The split is behavior-neutral and carries the already-fixed code.

## Problem & Intent
Developer's framing: **"fix audit report"** — and, on the success question, **"Audit reports zero"**: the next run's open-findings table is empty, every N0xx closed or explicitly accepted.

Run #6 (2026-11-13, `main` @ `df890a9`) reports 0 Critical and 0 High across 21 open rows (5 Medium, 16 Low), which fold to 19 distinct work items once N005 joins N042 and N017 joins N043. The debt is concentrated in three places: two files past the 500-line threshold (N042/N005), a documentation-drift cluster where five new modules appear in no doc layer (N044/N045), and a resource-hygiene cluster where capture writes ~85 MB per walk with no bound (N051) and `.git` has grown to 189 MB (N043/N017). Two findings are genuine logic gaps in the walk (N046, N047). The dead-export class has recurred four runs running because nothing gates it (N041).

## Goals
- Every open audit finding (N041-N059, N005, N017) has an explicit resolution recorded in this FRD.
- `src/judge.ts` and `src/linkedin-fetch.ts` both land under the 500-line threshold, behavior-neutral, with the existing test suite unedited.
- The two walk logic gaps are fixed: the seen-stop streak folds in stream order, and `LINKEDIN_MAX_POSTS` is a bound rather than advisory.
- Capture disk is bounded: a PC-leg env kill switch plus a size guard, with one warn on a skipped write.
- `.git` loose objects are reclaimed and the state-history policy is written into the guidance.
- The dead-export class cannot recur: `npx knip` runs in CI.
- All three gates (`npm run typecheck`, `npm run lint`, `npm test`) stay green after every slice.

## Non-Goals
- No behavior change in the judge cluster or the LinkedIn walk beyond the two named logic fixes — the splits are mechanical moves.
- No change to the pairing heuristic (`linkedin-parser.ts:270-300`). The replay harness settles it; this pass does not read its output.
- No `scrollRounds` config change (N057) — measure first, from the per-surface click counts the logs already carry.
- No new runtime dependency. No new hosted env var: `LINKEDIN_CAPTURE` and `LINKEDIN_PROFILE_DIR` are PC-leg only and never enter `ENV_NAMES` or `watch.yml`.
- No probe-ramp tests (N058), no negative-delta commit-wording change, no `reasoning_effort` endpoint check — the carried open questions stay open.
- No GitHub secret deletion (audit open question 5) — operator action outside the repo, unverifiable from here.

## Functional Requirements

Ordered for execution. Requirements 1-3 cite pre-split line numbers and land before requirement 5 moves that code.

1. **N046 — fold the streak in stream order** (~30 min + 1 test). The streak is currently mutated inside the listener AFTER `await response.text()` (`src/linkedin-fetch.ts:562`, mutation at `:569-574`), inside a `void` async IIFE (`:560`) the walk never awaits, so "consecutive" counts body-completion order. Fix: capture a monotonically increasing sequence number **synchronously at listener-fire time** (`:560`, before the await at `:562`); push `{ seq, id, seen }` onto a pending array instead of mutating `seenStreak`/`lastSeenId`; fold pending entries in `seq` order into `seenStreak`/`lastSeenId` at two points — the top of each round, before the read at `:663-666`, and again before the read at `:733-736` — clearing the array on each fold. The drain wait at `:754` is unchanged and stays after the loop; it exists to let in-flight bodies land before the return at `:758`, not to feed the streak. Folding after `:754` would leave the loop reading `seenStreak === 0` forever and disable the seen-stop entirely.
2. **N047 — enforce the cap** (~5 min). `LINKEDIN_MAX_POSTS = 150` (`src/linkedin-fetch.ts:110`) is checked only in the loop condition at `:659`, while the listener keeps inserting during the drain at `:754`. Slice the returned array to the cap at `:758` (`return [...posts.values()].slice(0, LINKEDIN_MAX_POSTS)`). The walk's return becomes a bound, not advisory.
3. **N048 — narrow the two bare catches** (~10 min). Both listener arms end in a bare `catch {}` commented "the body read can race the page close" (`src/linkedin-fetch.ts:553-555`, `:607-609`). The matched arm's try spans `:561-606`, so the catch also swallows parser faults and capture-path errors, making a systematically broken parse look identical to a page-close race. Narrow each to the known race (an abort/target-closed error) and warn once on a non-race error, using the `captureOnce` warn-once idiom (`src/linkedin-capture.ts:194-205`).
4. **N042 + N005 — split `judge.ts`** (~2 h). Move `dispatchLlmCall`, `DispatchWarns`, `DispatchOutcome`, `AttemptDirective`, `ContentDecision` into `src/judge-dispatch.ts`; move `systemMessage`, `buildMessages`, `buildBulkMessages` into `src/judge-prompts.ts`. `judge.ts` keeps `judgeBatch`, `judgePost`, `judgePosts`, and the env resolvers. `dispatchLlmCall` and the prompt builders gain `export` (all are file-private today); `buildBulkMessages` keeps its existing export so `scripts/probe-judge.ts:46` and `tests/judge.test.ts:10` need no edit.
5. **N042 — split `linkedin-fetch.ts`** (~1.5 h). Move `makeLinkedInContextFactory` and the three tagged-error families (`legDead`/`isLegDead`, `allSurfacesFaulted`/`isAllSurfacesFaulted`, `halt`/`isHalt`) into `src/linkedin-context.ts`; move `walkLinkedInSurface` (`:486-780`, already carrying the requirement 1-3 fixes) into `src/linkedin-walk.ts`. `linkedin-fetch.ts` keeps `fetchLinkedInPosts` and the pool orchestration. `makeLinkedInContextFactory` keeps its `export` — after the move, `src/linkedin-fetch.ts:409` imports it from the new module, so it is no longer dead (see requirement 6).
6. **N041 — close the dead-export class** (~15 min). Drop `export` on 9 symbols: `buildLegDeadAlarmText` (`src/email.ts:309`), `HEALTH_VERSION` (`src/judge-health.ts:39`), `LINKEDIN_FETCH_CONCURRENCY` (`src/linkedin-fetch.ts:69`), `LEG_DEAD` (`:208`), `ALL_SURFACES_FAULTED` (`:234`), `HALT` (`:265`), `PlatformFlags` (`src/config-file.ts:40`), `LegStatus` (`src/linkedin-payload.ts:47`), `LinkedInStorageCookie` (`src/linkedin-session.ts:159`) — each keeps its internal use. `makeLinkedInContextFactory` is carved out per requirement 5. Add `npx knip` as a CI step in `.github/workflows/ci.yml`, after `npm test`.
7. **N051 — bound the capture disk** (~30 min). Add a `LINKEDIN_CAPTURE` env read in the two PC call sites (`scripts/fetch-linkedin.ts:408`, `scripts/probe-linkedin.ts:185`): `off` is the only recognized disable value and yields no sink; unset keeps today's `makeFsCaptureSink()` default. Add a size guard in `src/linkedin-capture.ts` that skips the write above a byte threshold with one warn, using the `captureOnce` warn-once idiom. The guard reads `record.body.length`, not the file, so it adds no synchronous I/O.
8. **N043 + N017 — reclaim and record** (~15 min + one confirm). Run `git fsck`, then `git gc --aggressive --prune=now` once. **This is irreversible on unreachable objects — confirm at implement time before it runs** (break-rule 2). Then write the accept-and-document policy into the guidance: state/ commit-back growth is a known, accepted cost; revisit only when clone size forces it.
9. **N044 + N045 — sync the docs** (~20 min). Add `scripts/replay-linkedin.ts` to AGENTS.md's lint list; add one bullet per new module (`src/judge-availability.ts`, `src/linkedin-behavior.ts`, `src/linkedin-capture.ts`, `scripts/replay-linkedin.ts`, `scripts/reset-linkedin.ts`) to AGENTS.md and one line per module to `.rpiv/guidance/src/architecture.md` and `.rpiv/guidance/scripts/architecture.md`; change "Nine files" to "Eleven files".
10. **N049 — atomic flag writes** (~10 min). Convert the episode marker (`scripts/fetch-linkedin.ts:183-188`) and the halt latch (`:230-238`) from bare `writeFile` to the `stateTempPath` + rename idiom used by `writePayloadAtomic`.
11. **N050 — stop the zero-post overwrite** (~15 min). A walk that succeeds with zero posts reaches `scripts/fetch-linkedin.ts:434` and publishes an empty payload over the last good one, so the hosted run reads leg "ok" with 0 posts — indistinguishable from a quiet day. Skip the write when `posts.length === 0`, log it, and return `wrote: false`. This matches the all-faulted arm at `:429`, which already preserves the last good payload.
12. **N053 — env override for the profile dir** (~10 min). `LINKEDIN_PROFILE_DIR` is a hardcoded absolute Windows literal at `src/linkedin-fetch.ts:401`. Read `LINKEDIN_PROFILE_DIR` from the environment in `scripts/fetch-linkedin.ts` (which already passes it explicitly as argument 2 at `:400`) with the current literal as the default. `src/` stays env-free for this value.
13. **N054 — deps object for the walk** (~30 min). `fetchLinkedInPosts` takes 10 positional parameters, 8 defaulted (`src/linkedin-fetch.ts:792-802`); `scripts/fetch-linkedin.ts:404` passes `undefined` placeholders. Convert to a single deps object on the `FetchTickDeps` idiom and update the call site.
14. **N055 — share the URN digit floor** (~5 min). `src/linkedin-parser.ts:88` mints only 10+ digit activity ids; `src/linkedin-payload.ts:63` accepts 9+. Extract one constant both import.
15. **N056 — delete the dead ignores** (~2 min). Remove `state/linkedin-get-budget.json` (47 bytes, budget machine deleted 2026-11-11) and the four stale rules at `.gitignore:11,15,16` (`slice*-recon/`, `outputs/.drafts/`, `outputs/.plans/`).
16. **N059 — share the two constants** (~15 min). Extract the UA string and the webdriver patch from the duplicated context factories (`src/linkedin-fetch.ts:340-395` vs `src/fetch-threads.ts`) into a tiny module both import. Leave the adapter duplication — widening the shared `ContextFactory` seam breaks three doubles under `strictFunctionTypes`.
17. **N052 — document the capture PII posture** (~10 min). Record the 20-session retention and the manual purge command in README. No code change: `captures/` is gitignored and rolls off automatically.
18. **N057 — measure, do not change** (~0 min). The per-surface click count is already logged. Record the measurement task in the guidance so the next audit has a number to reason from. No config change this pass.
19. **N058 — carry** (~0 min). The probe-ramp test gap stays an open question.

## Non-Functional Requirements
- **Performance**: No regression in the 10-minute cadence or the 8-minute job cap. The capture size guard reads `record.body.length`, not the file, so it adds no synchronous I/O.
- **Security**: `LINKEDIN_PROFILE_DIR` gains a PC-leg env override but keeps the current literal as default — no secret moves, and the value never enters the hosted resolver. Capture PII posture is documented, not changed.
- **UX / Accessibility**: Not applicable (headless scheduled pipeline).
- **Reliability**: The two splits are behavior-neutral — the existing 626 tests must pass unedited. N046 and N047 change walk behavior in the safe direction (stop on stream order, never past the cap). N050 changes the zero-post arm to match the all-faulted arm's preserve-last-good-payload behavior.
- **Maintainability**: Both split files land under 500 LOC. `npx knip` reports 0 unused exports and CI enforces it.

## Constraints & Assumptions
- Node >= 22, ESM, strict TS (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- No new runtime dependency; `knip` is already a devDependency (the audit ran it).
- All gates are green today: `tsc --noEmit` clean, Biome clean (69 files), `npm test` 626/626, `npm audit` 0 vulnerabilities.
- **Destructive step**: requirement 8's `git gc --aggressive --prune=now` is irreversible on unreachable objects. It runs only after an explicit implement-time confirm, with `git fsck` first.
- **Agent substitution**: `skills/discover/SKILL.md` Step 3.1 names `codebase-locator`/`codebase-analyzer`; neither agent type exists in this harness. The Step 3 probe ran with two `Explore` agents instead, scoped to the same narrow slices. Recorded here rather than swapped silently.
- **Run-5 FRD unavailable**: the recalled memory cites `.rpiv/artifacts/discover/2026-11-13_06-20-09_tech-debt-run5-remediation.md`, but that path does not exist on disk (`ls .rpiv/artifacts/discover` returns run-1, run-2, and run-4 artifacts only). The run-5 judge-split scope was therefore re-derived from the probe and re-confirmed with the developer rather than inherited.
- Assumption: the `git gc` reclaim is safe — loose objects are unreachable from refs, and `git fsck` runs before the prune.
- Assumption: `LINKEDIN_CAPTURE` is read once at tick start, not per body, so the kill switch costs nothing on the hot path.

## Acceptance Criteria
- [ ] `wc -l src/judge.ts src/linkedin-fetch.ts` reports both under 500.
- [ ] `npm run typecheck && npm run lint && npm test` exit 0 with `tests/judge.test.ts` and `tests/linkedin-fetch.test.ts` unedited (`git diff --stat tests/judge.test.ts tests/linkedin-fetch.test.ts` empty).
- [ ] `npx knip` reports 0 unused exports and 0 unused exported types.
- [ ] `grep -n knip .github/workflows/ci.yml` finds a step.
- [ ] The N046 test drives five bodies with fire order [seen, new, seen, seen, seen] and completion order reversed; it asserts the seen-stop does NOT fire until the fifth body's fold and that `lastSeenId` is the fifth body's id (red before N046, green after).
- [ ] A walk fed more than 150 distinct posts returns exactly 150.
- [ ] `LINKEDIN_CAPTURE=off npx tsx scripts/probe-linkedin.ts` writes nothing under `captures/`.
- [ ] A capture record above the size threshold is skipped with exactly one warn line.
- [ ] `du -sh .git` drops from 189 MB; the guidance records the accept-and-document state-history policy.
- [ ] `grep -c replay-linkedin AGENTS.md` finds the lint-list entry; `grep -iE 'judge-availability|linkedin-behavior|linkedin-capture|reset-linkedin' AGENTS.md .rpiv/guidance/src/architecture.md .rpiv/guidance/scripts/architecture.md` hits all five modules.
- [ ] `ls state/linkedin-get-budget.json` reports no such file; `grep -nE 'slice.*-recon|outputs/\\.drafts|outputs/\\.plans' .gitignore` is empty.
- [ ] A zero-post walk leaves the previous payload file byte-identical (`sha256sum` before and after).
- [ ] `LINKEDIN_PROFILE_DIR=/tmp/x` is honored by the PC tick; unset falls back to the current literal.
- [ ] `fetchLinkedInPosts` takes a single deps object; no call site passes `undefined` placeholders.

## Recommended Approach
Fix the walk first (streak fold with a synchronous sequence key, cap slice, narrowed catches), then the two behavior-neutral splits (`judge-dispatch.ts`, `judge-prompts.ts`, `linkedin-context.ts`, `linkedin-walk.ts`), then the capture bounds, then the hygiene sweep (dead exports + knip gate, docs sync, atomic writes, PC-leg env override, deps object, shared constants, dead ignores), then the one-time `git gc` behind an implement-time confirm and the guidance record. Gates run between slices.

## Decisions

### Success definition: audit reports zero
**Question**: What does "fixed" mean — what is the observable success state?
**Recommended**: n/a — `intent` question.
**Chosen**: "Audit reports zero" — the next run's open-findings table is empty; every N0xx closed or explicitly accepted.
**Rationale**: Developer's own words; sets the bar for the accept-and-document rows below.

### Fix-before-split ordering
**Question**: The split (requirement 5) moves `walkLinkedInSurface` (`:486-780`), but N046, N047, and N048 all cite lines inside it. Which lands first?
**Recommended**: Fixes first, split second.
**Chosen**: Fixes first, split second.
**Rationale**: Otherwise every walk fix cites a line number that no longer exists, and the split carries unfixed code; the split is behavior-neutral so it is safe to run last.

### N046 streak race: fix, with a synchronous sequence key
**Question**: `seenStreak` is mutated at `src/linkedin-fetch.ts:569-574` after `await response.text()` at `:562` inside a `void` async IIFE, so "consecutive" counts body-completion order. Fix or accept?
**Recommended**: Fix — fold in stream order.
**Chosen**: Fix — fold in stream order, keyed by a sequence number captured at listener-fire time.
**Rationale**: The stop can fire early (missing posts) or late (wasted rounds); the tests drive bodies sequentially so they cannot catch it; evidence: src/linkedin-fetch.ts:503-504,560-574,663-666,733-736,754 + confirmed.

### N046 fold placement: before the loop reads, not after the drain
**Question**: Where does the fold land — after the drain wait at `:754`, or before the loop's reads?
**Recommended**: Before the loop reads.
**Chosen**: Before the loop reads, at the top of each round and again before the post-log read.
**Rationale**: The drain at `:754` is after the round loop; folding there leaves the loop reading `seenStreak === 0` forever and disables the seen-stop, so every surface would burn all 50 rounds; evidence: src/linkedin-fetch.ts:659 (loop condition), :663-666 and :733-736 (reads), :754 (drain, post-loop) + confirmed.

### N051 capture bound: kill switch + size guard
**Question**: Capture is on by default, writes full bodies pretty-printed, 20-session retention, no size guard and no off switch. Which bound?
**Recommended**: Kill switch + size guard.
**Chosen**: Kill switch + size guard.
**Rationale**: Keeps full bodies available for probe runs while bounding the steady state; evidence: src/linkedin-capture.ts:46,157; scripts/fetch-linkedin.ts:408; scripts/probe-linkedin.ts:185 + confirmed.

### Env-var placement: PC-leg only, never ENV_NAMES
**Question**: `LINKEDIN_CAPTURE` and `LINKEDIN_PROFILE_DIR` are both consumed by the PC leg only. Read them through the hosted `ENV_NAMES` resolver, or in the PC scripts?
**Recommended**: PC scripts only.
**Chosen**: PC scripts only.
**Rationale**: `LINKEDIN_CAPTURES_ROOT` is already a hard-coded constant (`src/config.ts:73`) with no `ENV_NAMES` entry, and the profile dir is a literal at `src/linkedin-fetch.ts:401`; routing either through `ENV_NAMES` drags a PC-only value into `watch.yml`'s env mapping for no benefit; evidence: src/config.ts:73, src/linkedin-fetch.ts:401, scripts/fetch-linkedin.ts:400 + confirmed.

### N042/N005 judge split scope: dispatch + prompts only
**Question**: `judge.ts` is 1091 LOC. Which split?
**Recommended**: Dispatch + prompts only.
**Chosen**: Dispatch + prompts only.
**Rationale**: Probe confirms every moved symbol is file-private except `buildBulkMessages`, so `tests/judge.test.ts` needs no edit; evidence: src/judge.ts:233,248,276,310,325,341,353,474 + confirmed.

### N042 linkedin-fetch split scope: context + errors, and walk
**Question**: `linkedin-fetch.ts` is 898 LOC. Which split?
**Recommended**: Context + errors, and walk.
**Chosen**: Context + errors, and walk.
**Rationale**: Both halves are cleanly separable — the context factory and tagged errors have no dependency on the walk, and `walkLinkedInSurface` is file-private with one internal call site; evidence: src/linkedin-fetch.ts:340,487,842 + confirmed.

### N041 carve-out: makeLinkedInContextFactory keeps its export
**Question**: N041 says drop `export` on `makeLinkedInContextFactory`; the split moves it to `linkedin-context.ts`, where `linkedin-fetch.ts` must import it. Which gives?
**Recommended**: Carve it out of N041.
**Chosen**: Carve it out — 9 symbols unexported, this one keeps `export`.
**Rationale**: After the move it has a real cross-module importer (`src/linkedin-fetch.ts:409`), so it is no longer dead and knip stays clean; evidence: src/linkedin-fetch.ts:340,409 + confirmed.

### N043 state-history policy: gc once, then document
**Question**: `state/seen-posts.json` is 4.0 MB with 1273 commits and `.git` is 189 MB (172 MB loose objects). Pick one and record it.
**Recommended**: gc once, then document.
**Chosen**: gc once, then document.
**Rationale**: The audit's own recommendation is "Pick one and record it in the guidance" — accept-and-document is the prescribed resolution, not a fallback; evidence: TECH_DEBT_AUDIT.md N043 + confirmed.

### N043 gc is confirm-at-implement
**Question**: `git gc --aggressive --prune=now` is irreversible on unreachable objects. List it as a step, or gate it?
**Recommended**: Gate it — confirm at implement time.
**Chosen**: Gated, with `git fsck` first.
**Rationale**: Break-rule 2 (destructive action) outranks the numbered-step shape; evidence: TECH_DEBT_AUDIT.md N043 (172 MB loose objects) + confirmed.

### N057 scrollRounds: measure first
**Question**: `scrollRounds: 50` is shared by the Threads walk and the LinkedIn walk. Change it now?
**Recommended**: Measure first.
**Chosen**: Measure first.
**Rationale**: The audit says "Measure first: the logs carry the click count per surface" — a config change before the measurement exists ships blind; evidence: TECH_DEBT_AUDIT.md N057 + confirmed.

### N052 capture PII: document only
**Question**: `captures/` holds 273 MB of verbatim LinkedIn response bodies, unencrypted, in the working tree. Fix or document?
**Recommended**: Document the retention and the manual purge in README.
**Chosen**: Document.
**Rationale**: The directory is gitignored and rolls off automatically; the gap is operator knowledge, not code; evidence: TECH_DEBT_AUDIT.md N052 + confirmed.

### N058 probe-ramp tests: carry
**Question**: `scripts/probe-judge.ts` (340 LOC) is the only uncovered non-trivial logic. Test it this pass?
**Recommended**: Carry — extract `rampLevel`'s ceiling arithmetic into a pure function and test it in a dedicated pass.
**Chosen**: Carry.
**Rationale**: Unrelated to the run-6 findings; ~1 h of work that would balloon this pass; evidence: TECH_DEBT_AUDIT.md N058 + confirmed.

### Twelve audit-recommended findings confirmed as written
**Question**: N041, N044, N045, N047, N048, N049, N050, N053, N054, N055, N056, N059 were authored from the audit's Recommendation column rather than asked. Keep them as written?
**Recommended**: Confirm all twelve.
**Chosen**: All twelve confirmed as written.
**Rationale**: Each matches the audit's fix and repo conventions; batch-confirmed in Step 4 rather than silently recorded; evidence: TECH_DEBT_AUDIT.md rows N041-N059 + confirmed.

## Open Questions
- N057 measurement: what is the actual per-surface click count on a LinkedIn walk? One walk with the existing logs answers it; the per-platform override decision waits on the number.
- N058: should `rampLevel`'s ceiling arithmetic be extracted and tested? Carried x5.
- The pairing heuristic (`linkedin-parser.ts:270-300`): has the replay harness output been read? Highest-consequence unknown in the repo; out of scope for this pass.
- Are the four orphaned GitHub secrets (`LINKEDIN_SESSION_STATE`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, `LINKEDIN_SECRET_WRITER`) still set? Operator action, unverifiable from the repo.

## Suggested Follow-ups
- `.rpiv/artifacts` is 168 tracked files with no pruning policy (carried x4) — intentional archive, or prune?
- Negative state deltas still commit as "state: -N new seen post ids" (carried x3) — deliberate greppability, or should a negative delta say "pruned"?
- `reasoning_effort` is unverified against every endpoint in the pool (carried x3) — live-only; the probe's minimal call would surface a proxy that rejects the field.

## References
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — run #6, the input report
- `.rpiv/artifacts/discover/2026-11-02_22-40-38_tech-debt-audit-remediation.md` — run-4 FRD, the accept-and-document precedent for N017/N043
- `.rpiv/artifacts/discover/2026-10-31_07-47-21_tech-debt-run2-remediation.md` — run-2 FRD, the original N005 deferral
- `.rpiv/artifacts/discover/2026-10-29_11-55-47_tech-debt-audit-remediation.md` — run-1 FRD
