---
date: 2026-11-15T08:44:36+0700
author: Yogiswara Utama
commit: 007eafc
branch: main
repository: loker-watcher
topic: "Remove the LinkedIn working-hours window"
tags: [intent, frd, linkedin-pc-leg, scheduling]
status: ready
last_updated: 2026-11-15T08:44:36+0700
last_updated_by: Yogiswara Utama
---

# FRD: Remove the LinkedIn working-hours window

> Post-audit revision: every test/doc claim below is grounded in a full read or a line-numbered scan of the named file. Scan patterns covered `bypassWindow`, `working window`, `working-hours`, `isWithinWorkingHours`, `WINDOW_START_HOUR`, `WINDOW_END_HOUR`, `08:00-21:00`, `Mon-Fri` (an earlier pass missed `working-hours window` with a narrower pattern — corrected).

## Summary
Delete the Mon-Fri 08:00-21:00 local working-hours window from the PC-local LinkedIn leg. After removal, every tick runs on any day at any hour — manual ticks and the always-on `watch-linkedin` loop alike. There is no replacement gate and no bypass switch: the predicate, its constants, the tick gate, the `bypassWindow` dep seam, their tests, and the docs claims all go.

## Problem & Intent
The operator wants to run the LinkedIn leg whenever they choose, in their own words: "i want to able run it anything i want". Today a tick outside Mon-Fri 08:00-21:00 local is a quiet zero — it logs `fetch-linkedin: outside the working window (Mon-Fri 08:00-21:00 local) — nothing to do` and does nothing (the request quoted this line verbatim). The interview settled the direction at the strongest form: delete the window entirely, including for the unattended loop (24/7 fetching accepted).

## Goals
- A tick started on any day at any hour performs a real fetch — no window quiet-zero.
- The unattended `watch-linkedin` loop fetches around the clock (~28-33 min cadence unchanged).
- No dead residue: constants, predicate, gate block, dep seam, tests, and docs claims are removed in the same change.

## Non-Goals
- No replacement pacing guard: no harvestedAt age cooldown, no new window, no configurable hours.
- No new env var or config key for the window (a bypass switch was offered and rejected).
- No change to the hosted `watch.yml` pipeline — it never used the window (graph: callers are the three PC scripts only).
- No change to the chain's no-op exit contract or the loop's fault handling — both already treat a quiet-zero as an outcome, not a failure.
- Remaining protections stay untouched: halt latch + one alarm per episode, leg-dead alarm, jittered 28-33-min cadence, per-walk 5-15s pacing gate, `harvestedAt` stamp-presence gate.

## Functional Requirements
1. `src/linkedin-behavior.ts` SHALL drop `WINDOW_START_HOUR` (line 26), `WINDOW_END_HOUR` (line 33), and `isWithinWorkingHours` (lines 43-48) with their doc comments; the module header (~lines 1-24) SHALL stop naming the window and its 13-hour worst-case bound. The module keeps `RandomFn`, `WAKE_MIN_MS`, `WAKE_MAX_MS`, `sampleTickDelayMs`, `HALT_RATE_LIMIT_REASON`, `HALT_CHECKPOINT_REASON`.
2. `scripts/fetch-linkedin.ts` SHALL drop, in `fetchTick`: the gate `if (deps.bypassWindow !== true && !isWithinWorkingHours(at))` (line 383) with its quiet-zero log (line 385) + return, the now-unused `const at = new Date(now());` (line 382), and the import (line 39). The preflight band becomes latch → guardCheckout (order otherwise unchanged; the "Order: window -> latch" comment shrinks).
3. `scripts/fetch-linkedin.ts` SHALL drop `bypassWindow` from `FetchTickDeps` (line 138, doc comment lines ~131-137) — the seam exists only to bypass the deleted check.
4. `scripts/linkedin-chain.ts` — COMMENT-ONLY edits, verified: the code never references the window (0 scan hits in 145 lines; `tickNoop` is shape-based: `!tickResult.wrote && !tickResult.pushed && tickResult.postCount === 0`, ~line 114, and the no-op report names no gates). Edit the module header's quiet-zero gate list (drop "working-hours window") and the "five gates return the identical shape" comment → four.
5. Tests:
   - `tests/fetch-linkedin.test.ts` (1058 lines): remove `bypassWindow: true` from the 16 deps injections (lines 418, 471, 505, 542, 573, 597, 615, 632, 667, 701, 822, 890, 916, 944, 979, 1038) — the pinned clocks keep working without the flag. INVERT the gate test at line 830 ("outside the working window the tick is a quiet no-op (Saturday noon local)"): keep the Saturday-noon clock, but assert the tick PROCEEDS — mirror the Monday-10:00 checkout-guard pattern (script `rev-parse` → non-main → `assert.rejects /not main/`, `built.value === 0`, `git.calls.length >= 1`). Re-title the Monday-10:00 test (its inside-window premise vanishes); keep it as a weekday proceeds-pin or merge it with the Saturday one.
   - `tests/linkedin-behavior.test.ts`: delete the `isWithinWorkingHours` describe (5 its) and the `WINDOW_START_HOUR` / `WINDOW_END_HOUR` / `isWithinWorkingHours` imports; the cadence and latch suites stay.
   - `tests/linkedin-chain.test.ts` (229 lines) and `tests/watch-linkedin.test.ts` (135 lines): verified ZERO window references — untouched.
6. Docs, exact spots:
   - `AGENTS.md` line 58 (linkedin-chain quiet-zero list) and line 104 (linkedin-behavior machine list: "the working-hours window, the jittered...").
   - `.rpiv/guidance/scripts/architecture.md` lines 10 (linkedin-chain description), 32 (fetch-linkedin preflight comment), 112 (chain exit contract).
   - `README.md`: verified clean (0 scan hits in 396 lines) — no README edit.

## Non-Functional Requirements
- **Performance**: no constraint — one preflight branch disappears.
- **Security**: session-heat exposure rises by decision: the unattended leg walks 24/7. Accepted mitigations remain: halt latch (operator-cleared, one alarm), leg-dead episode alarm, jittered cadence, per-walk pacing gate, `harvestedAt` stamp gate.
- **UX**: the quiet-zero reason list shrinks by one; an off-hours tick now logs real outcomes instead of `nothing to do`.
- **Reliability**: unchanged atomic payload write and exit contracts (mis-homed checkout exit 1, leg-dead exit 1 after one alarm, halt = quiet-zero + latch).

## Constraints & Assumptions
- Strict TS stays on (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`); typecheck must catch the now-unused import.
- No new runtime dependency.
- Tests stay offline (node:test + tsx, injected clocks/doubles).
- Import graph (verified): exactly ONE direct importer of `isWithinWorkingHours` — `scripts/fetch-linkedin.ts:39`. `watch-linkedin.ts` and `linkedin-chain.ts` reach it only transitively through `fetchTick`; neither file needs an import edit (0 window references in either — 92 and 145 lines scanned).
- Assumption: LinkedIn-side risk of 24/7 unattended walking is accepted by the operator (Decision: loop goes 24/7).

## Acceptance Criteria
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm test` exits 0 with the window suites removed/inverted.
- [ ] `grep -rnE "bypassWindow|isWithinWorkingHours|WINDOW_START_HOUR|WINDOW_END_HOUR|working-hours window|working window" src scripts tests AGENTS.md README.md .rpiv/guidance` returns no hits (historical `.rpiv/artifacts/` excluded).
- [ ] A tick started outside Mon-Fri 08:00-21:00 local proceeds past preflight: no `outside the working window` line; the next logs are the latch / checkout / walk sequence — pinned by the inverted Saturday-noon test.

## Recommended Approach
Pure removal across two code files plus their tests and docs: `linkedin-behavior.ts` shrinks to the cadence + halt-latch machines, `fetchTick` preflight becomes latch → guardCheckout, `bypassWindow` dies with the check it bypassed, the off-hours gate test inverts into a proceeds-pin. No replacement seam, no config surface.

## Decisions

### Root intent — run anytime
**Question**: What problem does the LinkedIn leg running outside Mon–Fri 08:00–21:00 cause today, and who feels it?
**Recommended**: n/a — intent question.
**Chosen**: "i want to able run it anything i want" (verbatim).
**Rationale**: The operator wants freedom to run, not better hours — captured verbatim per skill contract.

### Work = delete the window entirely
**Question**: The window already exists (`isWithinWorkingHours`, src/linkedin-behavior.ts:43-48, gating all three PC scripts). What is the work here?
**Recommended**: Add a bypass switch (window stays default).
**Chosen**: Delete the window — every run allowed, day and night.
**Rationale**: Operator picked removal over a switch: anytime means no gate at all, and no residue to maintain.

### The unattended loop goes 24/7
**Question**: Deleting the window also makes `watch-linkedin` fetch at night and on weekends, not just runs you start by hand. Is that what you want?
**Recommended**: (consequence check for the delete decision)
**Chosen**: Yes — the loop goes 24/7 too.
**Rationale**: Delete everywhere is the intent; the session-heat trade is accepted (see Non-Goals mitigations + Suggested Follow-ups).

### `bypassWindow` dep seam dies with the window
**Question**: Pre-resolved from codebase evidence (scripts/fetch-linkedin.ts:138 + the line-383 gate).
**Recommended**: Remove `FetchTickDeps.bypassWindow` together with the gate.
**Chosen**: Remove.
**Rationale**: ENTAILED by the delete decision — the seam bypasses only the deleted check. Recorded without a separate developer confirmation (correction: an earlier revision mislabeled this as confirmed).

### Docs lose the window claims in the same change
**Question**: Pre-resolved from codebase evidence (AGENTS.md:58,104; .rpiv/guidance/scripts/architecture.md:10,32,112; README.md verified clean).
**Recommended**: Update AGENTS.md and the scripts guidance with the code; no README edit.
**Chosen**: Update (scope corrected post-audit: README dropped — it carries no window claims).
**Rationale**: ENTAILED by the delete decision + repo doctrine that agent-facing docs stay truthful. Recorded without a separate developer confirmation (correction: an earlier revision mislabeled this as confirmed).

## Open Questions
None — every branch resolved as a Decision or an explicit Non-Goal.

## Suggested Follow-ups
- Age-checked `harvestedAt` rest cooldown: `fetchTick` checks stamp PRESENCE only, age is never checked (scripts/fetch-linkedin.ts, the FR-0 gate comment). More relevant now that the loop runs 24/7.
- Session-heat watch: if HALT latch trips (checkpoint walls) rise after 24/7 operation, revisit a softer window — the bypass-switch design rejected in this interview is the ready fallback.

## References
- `src/linkedin-behavior.ts` — WINDOW_START_HOUR (26), WINDOW_END_HOUR (33), isWithinWorkingHours (43-48), module header (~1-24)
- `scripts/fetch-linkedin.ts` — import (39), FetchTickDeps.bypassWindow (138), gate block (382-389), quiet-zero log (385)
- `scripts/watch-linkedin.ts` — 92 lines, zero window references (verified)
- `scripts/linkedin-chain.ts` — header gate list (comment), tickNoop shape check (~114), no-op report (no gate names)
- `tests/fetch-linkedin.test.ts` — 16 `bypassWindow: true` injections; gate test at 830 (invert); Monday-10:00 proceeds-pin at ~862
- `tests/linkedin-behavior.test.ts` — isWithinWorkingHours describe + WINDOW imports (delete)
- `tests/linkedin-chain.test.ts` (229 ln) / `tests/watch-linkedin.test.ts` (135 ln) — zero references (verified, untouched)
- `AGENTS.md` (58, 104), `.rpiv/guidance/scripts/architecture.md` (10, 32, 112), `README.md` (clean, 396 ln)
- `.rpiv/artifacts/discover/2026-11-09_17-29-56_linkedin-humanlike-fetch-behavior.md` — the FRD that introduced the window
