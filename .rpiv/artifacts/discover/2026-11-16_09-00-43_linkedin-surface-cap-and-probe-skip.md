---
date: 2026-11-16T09:00:43+0700
author: Yogiswara Utama
commit: 408eead
branch: ukind/fix-limited-linkedin
repository: fix-limited-linkedin
topic: "LinkedIn surface cap removal and probe thin-surface skip"
tags: [intent, frd, config-file, probe-linkedin, linkedin-fetch]
status: ready
last_updated: 2026-11-16T09:00:43+0700
last_updated_by: Yogiswara Utama
---

# FRD: LinkedIn surface cap removal and probe thin-surface skip

## Summary
Remove the hard-coded rule that forces exactly 5 linkedin keywords in `watcher.config.json`, so any count of 1 or more is accepted. In the LinkedIn probe, when a keyword returns fewer than 10 posts, log it and move to the next configured keyword instead of failing the gate; the probe passes as soon as one keyword clears 10 posts and exits 1 only when every keyword was thin or its walk errored.

## Problem & Intent
"5 keywords is too small, the probe stop could be becase the posts it self is too bit" — the developer's own words. The 5-keyword ceiling blocks adding more job-hunting keywords, and the probe fails on a keyword that simply has little content available, even though other keywords would pass.

## Goals
- Add or remove linkedin keywords in `watcher.config.json` without hitting a validation error.
- The probe gate judges the LinkedIn leg by whether ANY configured keyword proves out, not by the first one alone.
- A thin keyword costs one log line, not a failed gate.

## Non-Goals
- Adding new keywords to `watcher.config.json` — code fix only; the developer edits the config later.
- Changing the 10-post floor value itself.
- Changing the production walk (`src/linkedin-fetch.ts`) — thin surfaces there are already success (empty-is-success, defb8af) and stay that way.
- Changing the threads leg, the judge, or the notify path.

## Functional Requirements
1. The system SHALL accept any `watcher.config.json` with 1 or more linkedin surfaces; the exact-5 rejection SHALL be removed.
2. The system SHALL reject a config with 0 linkedin surfaces with an error naming the problem.
3. The probe SHALL walk linkedin keywords in configured order, starting from the first.
4. When a keyword returns fewer than 10 posts, the probe SHALL log one line naming the keyword and its post count, then proceed to the next keyword.
5. The probe SHALL pass (exit 0) as soon as one keyword returns 10 or more posts.
6. The probe SHALL exit 1 only when every configured keyword was thin (fewer than 10 posts) or its walk errored.
7. A keyword whose walk errors (a single-keyword walk surfaces as all-faulted, `src/linkedin-fetch.ts:337-338`) SHALL be skipped like a thin keyword: one log line naming the keyword and the error, then the next keyword.
8. Halt (checkpoint) and leg-dead (dead session) are session-level — the same browser walks every keyword, so skipping cannot rescue them — and SHALL still abort the probe immediately with their existing exit-1 messages. A thin result is not a fault and SHALL NOT be confused with one.

## Non-Functional Requirements
- **Performance**: The probe stops at the first passing keyword, so added keywords cost nothing on the happy path. Worst case (all thin) the probe walks every keyword — bounded by the configured keyword count.
- **Security**: No change. No new secrets, no new env vars, no new network surface.
- **UX / Accessibility**: CLI output only. Each thin keyword prints one line: keyword name + post count. The final pass/fail line names which keyword passed or that all were thin.
- **Reliability**: The probe's exit contract stays exit 0 on pass, exit 1 on gate failure. Halt and leg-dead keep their current abort-immediately messages and exit codes; a faulted keyword becomes one skip line and the final failure message names both the thin keywords and the faulted ones.

## Constraints & Assumptions
- `src/config-file.ts:74-80` documents the 5-surface cap as an account-safety bound: the PC leg's pacing arithmetic (per-surface scrollRounds click cap) is calibrated for a five-surface fleet, with the note "never grow the fleet." This FRD removes that bound on the assumption that the pacing arithmetic is per-surface and does not sum across the fleet. `research` MUST verify this — if the pacing math is fleet-wide, removing the cap changes tick duration and the assumption is wrong.
- `scripts/probe-linkedin.ts` currently reads only `surfaces[0]` (:153) and calls `fetchLinkedInPosts([surface], …)` (:175). The skip loop replaces that single read.
- `src/linkedin-fetch.ts` already walks every configured surface and treats thin as success; no change needed there.
- Offline unit suite only (`node:test` via tsx). No live LinkedIn calls in tests.

## Acceptance Criteria
- [ ] A config with 6 linkedin surfaces passes validation; `npm run typecheck && npm run lint && npm test` exits 0.
- [ ] A config with 1 linkedin surface passes validation.
- [ ] A config with 0 linkedin surfaces fails with an error naming the linkedin surface count.
- [ ] `tests/config-file.test.ts` no longer asserts the exact-5 rejection; it asserts the new accept/reject boundary.
- [ ] A probe test where the first keyword returns 3 posts and the second returns 12 exits 0 and logs the first keyword as thin.
- [ ] A probe test where every keyword is thin or faulted exits 1 with a message naming the thin keywords and the faulted ones.
- [ ] A probe test where the first keyword's walk errors and the second returns 12 posts exits 0, logging the first keyword's error before moving on.
- [ ] A probe test where the first keyword returns 10+ posts exits 0 without walking the second keyword.
- [ ] A probe test where the first keyword halts on a checkpoint exits 1 with `probe: HALT` and does not try the next keyword.

## Recommended Approach
Two localized edits: replace the exact-count check in `src/config-file.ts:210-215` with a `>= 1` check (plus the doc comment at :74-80), and convert the single `surfaces[0]` read in `scripts/probe-linkedin.ts:153` into an ordered loop over the filtered surfaces that breaks on the first keyword clearing `PROBE_MIN_POSTS`. Tests follow in `tests/config-file.test.ts` and `tests/probe-linkedin.test.ts`.

## Decisions

### Linkedin surface count rule
**Question**: Plain version: the code has a rule that says your config must have EXACTLY 5 linkedin keywords. Right now you have 5. If you add a 6th, the program crashes with "6 linkedin surfaces — exactly 5 are required". If you delete one, it crashes too. I remove that rule. What replaces it?
**Recommended**: Any number, 1 or more
**Chosen**: Any number, 1 or more
**Rationale**: The developer wants to add keywords freely; only an empty fleet is a real misconfiguration.

### Probe thin-surface behavior
**Question**: From the code: `scripts/probe-linkedin.ts:153` walks only the FIRST keyword and exits 1 when it returns fewer than 10 posts (:56, :187). Proposed shape: try keywords in config order; a keyword under 10 posts logs one line and the probe moves to the next; the gate passes when one keyword clears 10 posts; exit 1 only when every keyword is thin. Keep this?
**Recommended**: First pass wins
**Chosen**: First pass wins
**Rationale**: Fastest gate — the probe stops at the first keyword that proves out, so added keywords cost no extra browser time on the happy path.

### Scope of config change
**Question**: After the fix, do you want new linkedin keywords added to `watcher.config.json` right now, or do you want to add them yourself later?
**Recommended**: Code fix only
**Chosen**: Code fix only
**Rationale**: The developer edits the config when they have specific keywords in mind; the change stays a code fix.

### Cap location (pre-resolved from codebase evidence)
**Question**: Pre-resolved from codebase evidence — surfaced by the probe agents, not separately confirmed
**Recommended**: n/a
**Chosen**: The cap is an exact-equality check (`!== 5`) in `src/config-file.ts:211`, not a max and not in `watcher.config.json`; nothing truncates or slices the surfaces array.
**Rationale**: evidence: src/config-file.ts:80,210-215 (unconfirmed)

### Probe surface selection (pre-resolved from codebase evidence)
**Question**: Pre-resolved from codebase evidence — surfaced by the probe agents, not separately confirmed
**Recommended**: n/a
**Chosen**: The probe hard-picks `surfaces[0]` (`scripts/probe-linkedin.ts:153`) and applies a global 10-post floor (`PROBE_MIN_POSTS`, :56) to the total (:187-188); there is no loop over surfaces and no skip.
**Rationale**: evidence: scripts/probe-linkedin.ts:56,153,175,187-188 (unconfirmed)

### Production walk thin handling (pre-resolved from codebase evidence)
**Question**: Pre-resolved from codebase evidence — surfaced by the probe agents, not separately confirmed
**Recommended**: n/a
**Chosen**: `src/linkedin-fetch.ts` walks every configured surface and treats a thin or zero-post surface as success (empty-is-success, defb8af); only halt, leg-dead, and all-faulted abort.
**Rationale**: evidence: src/linkedin-fetch.ts:203-212,299-305,328-340 (unconfirmed)

### Page-error behavior in the probe loop
**Question**: Concrete case: keyword 1 of 5 loads, but its "Load more" button never appears and the walk errors out. Keywords 2-5 are probably fine. What should the probe do?
**Recommended**: Skip to next
**Chosen**: Skip to next
**Rationale**: The developer's pain is a probe that dies on one bad keyword; halt and leg-dead stay instant aborts because they are session-level, not keyword-level. Evidence: src/linkedin-fetch.ts:337-338 (all-faulted fires per single-keyword walk under the loop) + confirmed.

## Open Questions
- Is the PC leg's pacing arithmetic (per-surface scrollRounds click cap, `src/config-file.ts:76`) per-surface or fleet-wide? If fleet-wide, removing the 5-surface bound lengthens every tick and the FRD's core assumption needs revisiting. `research` should answer this before design.

## Suggested Follow-ups
- `src/config-file.ts:74-78` carries an FR-8 rationale comment ("never grow the fleet") that becomes stale the moment the cap is lifted — the comment must be rewritten as part of this change, not left behind.
- `scripts/linkedin-chain.ts:10,106` walks "the first configured surface" for its login hold -> probe -> fetch chain; with the probe now skipping thin surfaces, the chain's probe stage inherits the new behavior automatically, but its own first-surface assumption is worth a look separately.

## References
- Input: free-text feature description (2 items) supplied at `/skill:discover` invocation
- `watcher.config.json` — 5 linkedin surfaces at lines 103,107,111,115,119
- `src/config-file.ts:74-80,210-215` — the cap
- `scripts/probe-linkedin.ts:56,153,175,187-188` — the probe gate
- `src/linkedin-fetch.ts:203-212,299-305,328-340` — production walk thin handling
- `tests/config-file.test.ts:337-397` — the exact-5 test suite
- `tests/probe-linkedin.test.ts:372-385` — zero-surface preflight test
