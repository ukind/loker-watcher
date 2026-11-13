---
date: 2026-11-13T08:40:38+0700
author: Yogiswara Utama
commit: ce830e8
branch: main
repository: loker-watcher
topic: "LinkedIn walk stops scrolling at already-seen posts"
tags: [intent, frd, linkedin-fetch, seen-posts, walk]
status: ready
last_updated: 2026-11-13T08:40:38+0700
last_updated_by: Yogiswara Utama
---

# FRD: LinkedIn walk stops scrolling at already-seen posts

## Summary
The PC LinkedIn walk keeps clicking Load-more through posts it has already judged and recorded in `state/seen-posts.json`, minting duplicates and spending scroll rounds on dead feed. The walk gains a seen-id check that stops a keyword's scroll loop after N consecutive already-seen posts, then moves to the next keyword.

## Problem & Intent
"it cause overlapped, resource waste, because the already seen post minted" — the walk re-mints posts that are already in the seen history, so every tick re-scrolls and re-processes the same feed. Success looks like: the scroll stops as soon as the feed is showing already-seen posts, and the tick moves on to the next keyword instead of burning rounds on duplicates.

## Goals
- Stop a keyword's scroll loop when the feed is showing already-seen posts, not when the fixed scroll-round budget runs out.
- Keep every other keyword walking — one keyword hitting seen posts must not end the tick.
- Keep the probe walk (`probe-linkedin`) exempt so the >=10-posts health gate still measures the live feed.

## Non-Goals
- Stopping the whole tick on the first seen post (developer chose surface-only scope).
- Dropping posts minted before the seen-stop lands — they still ride the payload.
- Changing the hosted pipeline's dedupe (`diffNewIds`, src/state.ts:176) — it stays as the backstop.
- Changing `mintPost` (src/linkedin-parser.ts:185) — the seen check does not enter the parser.

## Functional Requirements
1. The system SHALL read the seen-id set from `state/seen-posts.json` in the PC clone before the walk starts, read-only.
2. The system SHALL treat a missing or malformed `state/seen-posts.json` as an empty set, log one warning line, and continue the tick.
3. The system SHALL inject the seen-id set into `fetchLinkedInPosts` as a parameter (src/linkedin-fetch.ts:678), defaulting to an empty set.
4. The system SHALL stop a keyword's scroll loop (src/linkedin-fetch.ts:583) after N consecutive minted posts whose ids are already in the seen set.
5. The system SHALL log the stop with the `fetch:` prefix, naming the keyword and the seen id that triggered it.
6. The system SHALL keep every other keyword walking after one keyword stops early.
7. The system SHALL keep `scripts/probe-linkedin.ts` exempt — it passes no seen set, so it never early-stops.
8. The system SHALL keep posts minted before the seen-stop in that keyword's result.

## Non-Functional Requirements
- **Performance**: fewer scroll rounds and Load-more clicks per fully-seen keyword; the tick finishes sooner.
- **Security**: no new secrets, no new env vars; the seen file is read-only and never written by the walk.
- **UX / Accessibility**: one log line per stopped keyword, in the existing `fetch:` style, so the operator sees why a keyword stopped.
- **Reliability**: a missing or malformed seen file degrades to today's behavior (full scroll) with one warning; the tick never fails on it.

## Constraints & Assumptions
- Node >= 22, strict TypeScript, ESM — the repo's standing runtime.
- The seen file in the PC clone is as fresh as the last `git pull --rebase` in the tick; staleness is accepted (a stale id only delays the stop by a few posts).
- The walk is the browser walk in `src/linkedin-fetch.ts`; the hosted run never executes it.
- `N` is a module constant, not an env knob (repo doctrine: tuning values are hard-coded constants).

## Acceptance Criteria
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm test` exits 0, including a new offline test that a keyword stops after N consecutive seen ids and that other keywords keep walking.
- [ ] A unit test proves `fetchLinkedInPosts` with no seen argument behaves exactly as today (default empty set).
- [ ] A unit test proves a missing/malformed seen file yields an empty set plus one warning, not a throw.
- [ ] `scripts/probe-linkedin.ts` still passes no seen set and its >=10-posts gate is unchanged.

## Recommended Approach
Inject a `ReadonlySet<string>` of seen ids into `fetchLinkedInPosts` (src/linkedin-fetch.ts:678) with an empty-set default, add a `readSeenIdSet(path)` reader in `src/state.ts` that degrades to empty on absent/malformed input, and have `scripts/fetch-linkedin.ts` load and pass the set. The scroll loop in `walkLinkedInSurface` (src/linkedin-fetch.ts:583) counts consecutive seen hits and breaks at N, logging one `fetch:` line.

## Decisions

### Seen-set source and freshness
**Question**: The walk reads seen ids from this PC clone's `state/seen-posts.json` (read-only, as fresh as the last tick's pull --rebase). Absent or malformed file reads as an empty set with one warning line, never fails the tick. Keep?
**Recommended**: Degrade — missing/broken file = empty set + one warning; walk runs full scroll, no early stop.
**Chosen**: Degrade (treat as empty).
**Rationale**: No history to check against means today's behavior is correct; a tick must not die on a state file.

### Stop scope
**Question**: When a minted post id is already seen (src/linkedin-fetch.ts:583 loop), what stops?
**Recommended**: Surface only — that keyword stops clicking Load-more; other keywords continue.
**Chosen**: Surface only.
**Rationale**: Matches the stated intent: "the scroll must be stopped and continue to next keyword to watch".

### Posts minted before the seen hit
**Question**: Posts minted before the seen hit lands — what happens to them?
**Recommended**: Keep — they ride the payload; the hosted run already drops seen ids (`diffNewIds`, src/state.ts:176).
**Chosen**: Keep.
**Rationale**: The hosted dedupe is the existing backstop; dropping at the walk adds a second dedupe path for no gain.

### Probe exemption
**Question**: Should `probe-linkedin` (the >=10-posts health gate) also stop on seen posts?
**Recommended**: Probe ignores seen — the probe walk never early-stops, so a fully-seen first surface still yields 10+ posts and passes.
**Chosen**: Probe ignores seen.
**Rationale**: The probe measures the live feed's health; a seen-stop would make a healthy surface fail the gate.

### Seam shape
**Question**: How does the seen-id set reach the walk — injected as a parameter (loader in `src/state.ts`, callers pass it), or read directly inside the walk?
**Recommended**: Inject the set — every walk input is already a parameter (src/linkedin-fetch.ts:678); the probe exemption falls out free because it passes nothing.
**Chosen**: Inject the set.
**Rationale**: Keeps the repo's injection convention and makes the probe exemption structural rather than flag-driven.

### Stop trigger
**Question**: What exactly triggers the stop inside the scroll loop (src/linkedin-fetch.ts:583)?
**Recommended**: First seen id — the first minted post whose id is in the seen set stops the loop.
**Chosen**: N consecutive seen posts (N=3).
**Rationale**: Developer correction — a single stray re-minted id mid-feed should not end the keyword; three in a row means the feed is genuinely in seen territory.

### Stop log line
**Question**: What should the stop log line look like?
**Recommended**: `fetch:` prefix — `fetch: linkedin/<kw> seen-stop: <id> after <round> round(s)`.
**Chosen**: `fetch:` prefix.
**Rationale**: Matches the existing walk log style so the operator reads it in context.

## Open Questions
- The exact value of N is settled at 3 by this interview; whether it should be per-surface or global is not yet decided — `research` may weigh it.

## Suggested Follow-ups
- `pruneState` (src/state.ts:115) drops seen ids older than the recency window each run, so a long window can shrink the seen set between ticks — worth a look if stops fire late.

## References
- Input: free-text feature description (2026-11-13T08:40:38+0700)
- `src/linkedin-fetch.ts` — `walkLinkedInSurface` (:461), `fetchLinkedInPosts` (:678)
- `src/state.ts` — `AppState` (:23), `diffNewIds` (:176), `pruneState` (:115)
- `src/linkedin-parser.ts` — `mintPost` (:185)
- `scripts/fetch-linkedin.ts`, `scripts/probe-linkedin.ts`, `scripts/watch-linkedin.ts`
