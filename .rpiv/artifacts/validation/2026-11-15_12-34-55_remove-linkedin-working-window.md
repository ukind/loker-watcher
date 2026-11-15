---
template_version: 1
date: 2026-11-15T12:34:55+0700
author: Yogiswara Utama
commit: 9fded75
branch: main
repository: loker-watcher
topic: "Validation of Remove the LinkedIn working-hours window"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-15_11-41-53_remove-linkedin-working-window.md"
tags: [validation, linkedin-pc-leg, working-window, fetch-tick, linkedin-behavior]
last_updated: 2026-11-15T12:55:34+07:00
---

## Validation Report: Remove the LinkedIn working-hours window

### Implementation Status

- ✓ Phase 1: Code excision — Fully implemented (commit f0340d7, exactly the 4 declared files)
- ✓ Phase 2: Doc sweep + 24/7 recomputation — Fully implemented (commit 9fded75, exactly the 7 declared files; one manual item stays open: the live rehearsal, an operator action on the dedicated clone)

### Automated Verification Results

- ✓ Zero window symbols: `grep -rn "bypassWindow\|isWithinWorkingHours\|WINDOW_START_HOUR\|WINDOW_END_HOUR" src tests scripts` — zero hits. Repo-wide drift check: the symbols survive only under `.rpiv/artifacts/` (historical artifacts, excluded by plan scope)
- ✓ Epitaphs: `grep -rn "working-hours"` over the 4 Phase-1 files — exactly 3 lines, each stamped 2026-11-15; the unstamped filter returns zero
- ✓ Phase-1 scope: `grep -rn "working day"` over the 4 Phase-1 files — zero hits
- ✓ Widened stamp count: `grep -rn "working-hours" src tests scripts *.md .github .claude .cursor .rpiv/guidance | grep -c "2026-11-15"` — exactly 3
- ✓ Widened end state: the unstamped filter returns zero; the nine carriers named in the plan are gone
- ✓ Widened literal: `grep -rn "working day" src tests scripts *.md .github .claude .cursor .rpiv/guidance` — zero hits
- ✓ Replay recomputation: `grep -c "9-11 hours" scripts/replay-linkedin.ts` — 3 (header, USAGE doc, USAGE string)
- ✓ Capture recomputation: `grep -n "44-52 walks per day" src/linkedin-capture.ts` — 1 hit at :41
- ✓ Chain gate count: `grep -n "(D3): four" scripts/linkedin-chain.ts` — 1 hit at :112
- ✓ `npm run typecheck` — pass (excess-property check proves all 16 seam injections are gone)
- ✓ `npm run lint` — pass (78 files, no fixes)
- ✓ `npm test` — pass in the working tree: 642 tests / 642 pass / 0 fail / 0 skipped
- ✓ `npm run knip` — pass (no surviving window export)
- ✓ Commit split: `git show --stat HEAD~1 HEAD` — f0340d7 touches exactly the 4 Phase-1 files; 9fded75 touches exactly the 7 Phase-2 files; the pair was rebased onto origin/main after validation — the measurements below were taken pre-rebase against the plan base be5407a, where the pair carried the hashes e3904a6/363f2e3
- ✓ No regressions detected — base be5407a measured in a fresh detached worktree: 647 tests / 646 pass / 1 fail; delta -> 643/642/1 (HEAD, same fresh-worktree condition). The two HEAD totals reconcile by construction: on a fresh checkout the failing after-hook registers itself as one extra test entry, so a clean tree reads 642/0 while a fresh checkout reads 643/1. The single failure on both sides is the absence-oracle after-hook (`tests/fetch-linkedin.test.ts:69-78`, byte-identical at base and HEAD). It arms only when `<repo>/captures/` is absent — a fresh-checkout condition. CI shows the identical counts at base (run 43665629566: 647/646/1). The failure is pre-existing at base and outside the run's delta; in the working tree (captures/ exists from operator runs), HEAD passes 642/642/0

### Code Review Findings

#### Matches Plan:

- `scripts/fetch-linkedin.ts:369-393` — band comment carries the stamped epitaph and "Order: latch -> checkout guard"; the latch check is the first gate; no clock read gates the tick; `guardCheckout` is second; the cookie gate follows
- `src/linkedin-behavior.ts:1-17` — 24/7 worst-case header ("at most 52 wake-ups per local day"), stamped epitaph; the window trio is deleted, not stubbed
- `tests/fetch-linkedin.test.ts:807-890` — the band describe replaced by the four pins exactly as fenced: latched block (zero builds, zero git spawns), Saturday-noon proceeds, weekday Monday proceeds, Wednesday-night proceeds; all assert `/not main/` reachability with `built.value === 0`
- `tests/linkedin-behavior.test.ts` — window imports, MONDAY/`at` helpers, and the window describe gone; cadence + halt-vocabulary describes intact
- `scripts/watch-linkedin.ts:2-9` — header names only the halt latch; no window claim, no dead daily-budget half
- `src/config-file.ts:73-80` — FR-8 bounds the five-surface fleet by cadence x click cap only
- `src/linkedin-capture.ts:35-47` — 24/7 retention math (44-52 walks/day, ~3.7-4.3 GB/day, ~1.7 GB steady-state at keep-20)
- `scripts/replay-linkedin.ts:53-79` — "9-11 hours" in all three carriers; HUNK A's third line is a proper JSDoc continuation (` *   src/linkedin-capture.ts)`) — the plan-local review fix applied correctly
- `scripts/linkedin-chain.ts:21-22,112` — the quiet-zero gate list and count read four (halt latch, halt trip, all-faulted walk, zero surfaces)
- `AGENTS.md:57-61,104-105` and `.rpiv/guidance/scripts/architecture.md:10,32,112-114` — the same four gates in both docs; the fetch structure row reads "(the checkpoint latch, then guardCheckout:"

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan. The two plan-local transcription fixes from the review table (line 822 dropped from HUNK A; the JSDoc continuation line) both landed as prescribed.

#### Pattern Conformance:

- ✓ The four band pins mirror the file's established proceeds-pin idiom (`workPath` / `contextFactoryFor` / `scriptGit`, `assert.rejects /not main/`, `built.value === 0`)
- ✓ The three epitaphs keep the machine-name convention (`src/linkedin-behavior.ts:2-4` idiom), so a future reader can connect them to the FRD and git history

#### Potential Issues:

- `tests/fetch-linkedin.test.ts:69-78` — pre-existing at base, measured three ways (fresh worktree at base 647/646/1; fresh worktree at HEAD 643/642/1; CI run 43665629566 at base 647/646/1): a body-firing case writes `captures/` at the repo root, so the absence-oracle after-hook fails on every fresh checkout. CI on main has been red on this since before the implementation (all recent ci.yml runs fail at 33-38 s). Masked locally by the operator's `captures/` directory. Not introduced by this run; criterion "npm test passes" holds in the working tree. Recommended follow-up debt fix: give the leaking body-firing case a temp capture-sink injection, per the capture doctrine's own comment
- `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md` — the frozen design artifact still reads "43-51 walks per day" (floor convention); shipped code uses the 44-52 ceiling convention per the plan's review resolution, which recorded this divergence as plan-local by design. Non-blocking; the design artifact is historical record, outside the plan's write-set

### Manual Testing Required:

1. LIVE REHEARSAL (the plan's one open item — operator action on the dedicated clone, not this checkout):
   - [ ] From the dedicated clone of main: `git pull --rebase`, then `npm run fetch-linkedin` outside the old window
   - [ ] Confirm the walk completes (a written/pushed payload, or a tagged no-op with exit 0)
   - [ ] Confirm the line `fetch-linkedin: outside the working window` does not appear
2. Verified during this validation (no action needed):
   - [x] `scripts/fetch-linkedin.ts:369-393` read: the latch is the first gate, no clock read
   - [x] `scripts/watch-linkedin.ts` header read: only the halt latch is named
   - [x] `src/config-file.ts` FR-8 comment read: cadence x click cap only
   - [x] `AGENTS.md` and `.rpiv/guidance/scripts/architecture.md` read: the same four quiet-zero gates in both

### Recommendations:

- The implementation commits are local-only: `main...origin/main [ahead 2, behind 21]`. Rebase onto origin/main before push (the state commits moved the base). `/skill:commit` should handle the rebase the same way `scripts/commit-state-rebase.sh` does
- Run the live rehearsal from the dedicated clone when convenient; it is the plan's only open criterion
- Book the absence-oracle fix as follow-up debt: CI on main is red independent of this change, and every fresh clone fails `npm test` until the leaking sink injection lands

