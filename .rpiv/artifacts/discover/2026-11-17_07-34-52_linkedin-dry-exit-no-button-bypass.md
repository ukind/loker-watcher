---
date: 2026-11-17T07:34:52+0700
author: Yogiswara Utama
commit: 703d48c
branch: ukind/fix-bug-find-click
repository: fix-bug-find-click
topic: "LinkedIn walk dry-exit no-button bypass"
tags: [intent, frd, linkedin-walk, linkedin-fetch, probe-linkedin]
status: ready
last_updated: 2026-11-17T07:34:52+0700
last_updated_by: Yogiswara Utama
---

# FRD: LinkedIn walk dry-exit no-button bypass

## Summary
Fix the LinkedIn browser walk's dry-exit condition so a surface whose "Load more" button has disappeared stops at dry 3/3 and moves to the next keyword, instead of burning every remaining scroll round on 5s waitFor timeouts. The fix is scoped to the dry-exit gate in `src/linkedin-walk.ts`; constants and the probe's click floor stay as they are.

## Problem & Intent
"the counter is error. should be 3/3 then stop. go to next keyword" — the operator's framing, verbatim.

The observed log shows the walk running `click 4` through `click 9` with `no button (locator.waitFor: Timeout 5000ms exceeded)` and `+0 new (dry 8/3, total 3)`. The dry counter correctly reached 3/3, but the loop did not stop: the pasted fragment ends at click 9 (dry 8/3), and the loop is bounded only by `scrollRounds` (50, from `watcher.config.json:159`). Each extra round costs a 5s `waitFor` timeout, so a single absent-button surface can burn minutes of pure timeout before the next keyword is attempted.

## Goals
- A surface with no "Load more" button stops at dry 3/3 and the walk proceeds to the next keyword.
- The probe's body-sampling floor (`minClicks = 5`) still defers the dry exit while clicks are actually landing.
- The tick leg (`minClicks: 0`) is unchanged — it already stops at 3/3.

## Non-Goals
- Changing `LINKEDIN_MAX_DRY_ROUNDS` (3), `LINKEDIN_MIN_GAIN` (2), or `scrollRounds`.
- Reworking the dry-counter log format or the round logging.
- Touching the Threads walk's dry loop (`src/fetch-threads.ts`) — it has no click floor.
- Changing the probe's `PROBE_MIN_CLICKS` value or the tick's `minClicks: 0` pass-through.

## Functional Requirements
1. When a round finds no clickable "Load more" button (`clicked === false`) AND the dry counter has reached `LINKEDIN_MAX_DRY_ROUNDS`, the walk SHALL break out of the round loop regardless of the `minClicks` floor.
2. When a round clicks successfully but gains fewer than `LINKEDIN_MIN_GAIN` posts, the dry exit SHALL continue to be deferred until `clicks >= minClicks` (the existing floor behavior, unchanged).
3. A surface where no click ever fired SHALL still stop at dry 3/3 (this case is subsumed by the no-button bypass — see Recommended Approach).
4. The seen-stop pre-round and post-log breaks SHALL remain ahead of the dry exit, unchanged.

## Non-Functional Requirements
- **Performance**: an absent-button surface ends after 3 dry rounds (~15s of waitFor) instead of up to 50 rounds (~250s).
- **Security**: no change — no new env, no new secret, no new I/O.
- **UX / Accessibility**: the log line for a no-button dry round keeps naming the failure (`no button (<message>)`) so "no button" and "clicked, no posts" stay distinguishable.
- **Reliability**: the bypass must not fire on a transient no-button round followed by a good click — only the dry counter at its limit triggers the break.

## Constraints & Assumptions
- Offline test suite only (`tests/linkedin-fetch.test.ts` drives the walk through scripted `PageLike` doubles); no live browser run is part of this change.
- The walk's statics live in `src/linkedin-walk-static.ts` (N060) — the fix adds no new constant.
- Assumption: the operator's log came from the probe/chain leg (`minClicks = 5`), not the tick (`minClicks: 0`). The tick already stops at 3/3, so the unbounded burn is only reachable through the probe path.

## Acceptance Criteria
- [x] `npm run typecheck && npm run lint && npm test` all exit 0.
- [x] A test with `minClicks: 5`, `scrollRounds: 8`, clicks landing with ≥2 new posts in rounds 1-2 (dry stays 0), and the button gone from round 3 on: dry accrues at rounds 3-5, the last round line matches `/click 5: no button.*dry 3\/3/`, and no `click 6:` line exists. Landed as `ends at dry 3/3 when clicks landed then the button vanished (floor unmet)` — the double needed no harness change: `loadMoreVisible` already receives the round number, so the test uses `(round) => round <= 2` (double contract: `waitFor` calls it once per round as `clickCount + 1`).
- [x] The existing test "defers the dry exit until minClicks clicks have landed" (`tests/linkedin-fetch.test.ts:519`) still passes unchanged: clicks keep landing, so the floor still defers.
- [x] The existing test "does not apply the minClicks floor when no click ever fired" (`tests/linkedin-fetch.test.ts:541`) still passes unchanged.
- [x] A probe-shaped run (button absent from round 1) logs exactly three `no button` dry rounds and then the `OK —` line.

## Recommended Approach
Widen the dry-exit condition in `src/linkedin-walk.ts` from `(clicks === 0 || clicks >= minClicks)` to also break when the round found no button — i.e. the floor only defers rounds that actually clicked. One condition change, no new constant, no new seam.

Plan precedent (`2026-11-13_13-03-11_linkedin-seen-stop-scroll.md`, round-tail section): the `clicks === 0` arm's own comment names the same measured harm — "an absent button would otherwise burn every remaining round on a 5s waitFor timeout (measured: 8 rounds x 5s = 40s of pure timeout)" — but only covers the no-click-ever case. The bypass extends that exemption to clicks that stop landing mid-walk. The plan's "UNCHANGED (same condition)" wording certified the relocation commit's behavior preservation, not a ban on later widening. The bypass must stay in the relocated tail position: dry log line, then the post-log seen-stop break, then the dry exit (the tie-round test pins this order). Plan anchors are HEAD-relative @ 33e17dc, when the walk lived in `src/linkedin-fetch.ts`; the walk now lives in `src/linkedin-walk.ts:95-420` (N060).

Diff shape: `clicks === 0` is subsumed by `!clicked` — `clicks` only increments inside `if (clicked)` (`src/linkedin-walk.ts`, immediately above the dry check at :393-399), so zero total clicks implies this round did not click. Minimal condition: `(clicks >= minClicks || !clicked)`. Keeping the explicit `clicks === 0` arm is equally correct when its comment states the subsumption.

## Decisions

### Stop rule for an absent button
**Question**: From the probe I inferred — the 5-click floor keeps the dry exit blocked forever once the button disappears (`src/linkedin-walk.ts:393-399`). How should the stop work?
**Recommended**: No-button bypass — bypass the floor only when the round found no button; clicked-but-dry rounds still honor the probe's 5-click floor.
**Chosen**: No-button bypass.
**Rationale**: The floor exists to sample pagination bodies; with no button there are no bodies to sample, so waiting is pure cost. A plain 3-dry stop would let the probe exit before 5 clicks on a slow-pagination surface.

### Fix scope
**Question**: Keep the fix scoped to the walk's dry exit (`src/linkedin-walk.ts`), constants untouched?
**Recommended**: Dry exit only.
**Chosen**: Dry exit only.
**Rationale**: The counter display and round logging are correct — the log reads `dry N/3` accurately; only the break condition is wrong.

### Test coverage
**Question**: How should the offline tests capture the new stop rule?
**Recommended**: Update floor tests — extend `tests/linkedin-fetch.test.ts:519-565` with a no-button-after-clicks case that stops at dry 3/3 even with `minClicks` unmet, while clicked-dry rounds still defer.
**Chosen**: Update floor tests.
**Rationale**: The existing two tests pin the floor's two arms (clicks landing, no click ever); the new case pins the third arm (clicks stopped, button gone).

### Root cause (pre-resolved from codebase evidence)
**Question**: Pre-resolved from codebase evidence — confirmed in Step 4.
**Recommended**: n/a
**Chosen**: The dry exit at `src/linkedin-walk.ts:393-399` is gated by `(clicks === 0 || clicks >= minClicks)`; the probe passes `minClicks = PROBE_MIN_CLICKS = 5` (`scripts/probe-linkedin.ts:57`, wired at `scripts/probe-linkedin.ts:180,210`).
**Rationale**: evidence: src/linkedin-walk.ts:393-399 + scripts/probe-linkedin.ts:57 + watcher.config.json:159 + confirmed.

## Open Questions

- None.

## Suggested Follow-ups

- `watcher.config.json:159` sets `scrollRounds: 50` for the LinkedIn leg. With the bypass in place a healthy surface can still spend up to 50 rounds; whether 50 is the intended ceiling for the hosted cadence was not discussed.

## References

- Input: operator bug report (call log pasted into `/skill:discover`).
- `.rpiv/artifacts/plans/2026-11-13_13-03-11_linkedin-seen-stop-scroll.md` — the prior walk change that relocated the dry exit and added the seen-stop breaks.
- `.rpiv/artifacts/designs/2026-11-13_10-27-17_linkedin-seen-stop-scroll.md` — the design behind that relocation.
