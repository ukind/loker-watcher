---
date: 2026-11-12T07:50:38+0700
author: Yogiswara Utama
commit: 559ad54
branch: main
repository: loker-watcher
topic: "LinkedIn scroll pagination and session hygiene"
tags: [intent, frd, linkedin-fetch, linkedin-parser, probe-linkedin, login-linkedin, fetch-linkedin]
status: ready
last_updated: 2026-11-12T07:50:38+0700
last_updated_by: Yogiswara Utama
---

# FRD: LinkedIn scroll pagination and session hygiene

## Summary
Make the PC-local LinkedIn walk paginate limitlessly and finish without force kicks: a variant-aware scroll-first walk (scroll the scrollable container — live-verified `<main>` — with the Load-more click arm as fallback), the msedge persistent-profile ride, session-hygiene gates (a harvestedAt cooldown before walks), and a trustworthy probe floor (`>= 10` posts). Two pieces already shipped today as uncommitted experiment code: the `channel: "msedge"` swap and the login helper's `--keep-open` flag.

## Problem & Intent
Developer's own words (2026-11-12): "the current linkedin in login and then probe have a problem. when user login with npm run login-linkedin and success then it will close the browser, and then run: npm run probe-linkedin. it will open the browser and search the job with keyword. the things is it only load very small of posts list only 3 or less. and will appear load more button. but when click the button there is no posts at all. [...] then i click refresh in the browser and i got automatically throw out to login page. with list of account I've logged for. it seems i get kicked but not totally logout." Success criterion: "no force kick, keep loading posts result when scroll down."

## Goals
- A walk keeps minting posts through pagination until the surface drains — no early dry exit on scroll variants.
- A healthy session finishes a walk with no checkpoint kick.
- A green probe proves pagination actually worked: `>= 10` unique posts across multiple bodies.

## Non-Goals
- No changes to the Threads leg or the hosted run — the LinkedIn browser is PC-only (the hosted run only reads `state/linkedin-posts.json`).
- No DOM-scraping replacement of response parsing (the rendered cards carry no activity ids; dedupe/timestamp/permalink all key on ids).
- No profile split between login and walk (the shared persistent profile is the only observed variant that paginates).
- No bladebro / agent-driven browser swap.
- No softening of the fail-visible exit gates.

## Functional Requirements
1. The walk SHALL, after the navigation and every round, measure the scroll candidates (window scrollingElement, `<main>`, `[data-testid='lazy-column']`, `.scaffold-finite-scroll`) and scroll the best candidate (largest scrollHeight-clientHeight) to its bottom; the Load-more click arm runs only when a button-bearing variant is present or scroll stalls.
2. The walk SHALL count consecutive stall rounds (zero scroll growth AND zero new posts) and end the surface dry VISIBLY — one log line naming the round, the variant, and the stall budget — after an injectable stall budget.
3. The probe SHALL exit 1 below 10 unique minted posts (raised from 2) while keeping the HALT / LEG DEAD / all-faulted contracts unchanged.
4. The tick SHALL gate on a harvestedAt cooldown (value from research; proposal 30-60 min) BEFORE any walk and exit 1 naming the remaining wait; the cookie file already carries the stamp (src/linkedin-session.ts).
5. The login helper keep-open flag (SHIPPED 2026-11-12) stays: `npm run login-linkedin -- --keep-open` holds the browser for manual probing; Enter closes it; default behavior unchanged.
6. Both launch sites (scripts/login-linkedin.ts, src/linkedin-fetch.ts) ride `channel: "msedge"` (SHIPPED 2026-11-12, uncommitted).

## Non-Functional Requirements
- **Performance**: ~3.5s settle per scroll round (measured live: 20 rounds in ~80s); a hard round cap bounds a runaway walk.
- **Security**: session material stays outside the repo; the persistent profile is single-owner — a manual keep-open window locks it, and a parallel walk launch fails visibly.
- **UX / Operator**: the probe prints one line per round (scroller, posts N→M, stalls) plus the existing body/pairing-oracle lines.
- **Reliability**: LinkedIn page-variant changes degrade VISIBLY (stall exit, the unmatched-flagship diagnostic line), never silently; context + page close on every path.

## Constraints & Assumptions
- LinkedIn serves page variants per account/session/day: the 2026-11-11 "scrolling fires nothing" finding was variant-scoped and is disproven live on 2026-11-12 (scroll fired every pagination body). Arms must stay variant-tolerant.
- Repo invariants hold: Node >= 22 ESM, strict TS, no new runtime dependency, Playwright remains the driver, fail-visible contracts, offline-only tests (structural PageLike doubles).
- The account/IP risk state heats under repeated login→probe storms (2026-11-12: two browser binaries kicked the same day; the trigger was the session-risk state, not the browser).
- Assumption to re-verify: `<main>` remains the scroll container on the scroll variant.

## Acceptance Criteria
- [ ] `npm run probe-linkedin` on a fresh session exits 0 with >= 10 unique posts minted from >= 3 pagination bodies (round lines show the counts).
- [ ] Offline pin: on a scroll variant (no Load-more button), a PageLike double walks >= 10 rounds via `<main>` scrollTop and the scripted responses join through the production parser.
- [ ] Offline pin: on a button variant, the existing click-transcript test stays green (fallback arm intact).
- [ ] A checkpoint URL mid-walk still exits `probe: HALT` 1 (unchanged).
- [ ] A walk started inside the harvestedAt cooldown window exits 1 naming the remaining wait.
- [ ] `npm run typecheck && npm run lint && npm test` all exit 0.

## Recommended Approach
Extend the per-surface round loop in `src/linkedin-fetch.ts` with the scroll arm (measure candidates → scrollTop bottom → settle → stall budget), keep the click arm as the button-variant fallback, share that loop with the probe (floor >= 10), and add the harvestedAt cooldown gate in `scripts/fetch-linkedin.ts` (+ probe preflight). The 2026-11-12 uncommitted changes (msedge channel ×2, `--keep-open`, its test pin) ride along.

## Decisions

### Shared browser profile stays
**Question**: login-linkedin and the probe/watch walks share ONE headed browser profile — keep sharing it, or change that?
**Recommended**: Keep shared profile.
**Chosen**: Keep shared profile.
**Rationale**: evidence: src/linkedin-fetch.ts:14-18 + confirmed — the persistent profile is the only observed variant that paginates.

### Extraction stays response parsing
**Question**: posts come from the page's network responses, never DOM reads — keep, or change?
**Recommended**: Keep response parsing.
**Chosen**: Keep response parsing (after the developer asked for confidence; receipts shown).
**Rationale**: parser is pure + offline-pinned (tests/linkedin-parser.test.ts), live pairing 3/3, DOM carries no ids (src/linkedin-fetch.ts), localized labels + hashed classes break DOM reads silently.

### Exit gates keep fail-visible
**Question**: probe exits 1 on checkpoint wall, dead session, or short walk — keep, or soften?
**Recommended**: Keep exit gates.
**Chosen**: Keep exit gates.
**Rationale**: evidence: scripts/probe-linkedin.ts:96-108 + repo doctrine (fail visible).

### Probe floor raised to >= 10 posts
**Question**: the probe passes today at 2+ posts, but a broken run showed 3 and died — what is the healthy floor?
**Recommended**: Raise to 10+ posts.
**Chosen**: Raise to 10+ posts.
**Rationale**: developer pick — ~3 posts/body × 5 rounds should mint ~15; ten proves pagination worked, not just page one.

### Walk engine stays Playwright, now on msedge
**Question**: how should the LinkedIn browser leg be driven (GitHub Action impact: none — the leg is PC-only)?
**Recommended**: Keep Playwright.
**Chosen**: Playwright with `channel: "msedge"` on both launch sites (shipped 2026-11-12); bladebro rejected.
**Rationale**: live evidence — 20-round scroll walk ran clean on msedge; the bundled-Chromium AND msedge kicks earlier the same day proved the engine is not the trigger.

### Pagination is scroll-first with click fallback
**Question**: pagination is variant-dependent per session — which mechanism should the walk support?
**Recommended**: Support both mechanisms.
**Chosen**: Scroll-first (measure + scrollTop the scrollable, live-verified `<main>`), Load-more click as the button-variant fallback.
**Rationale**: live run 2026-11-12 (.rpiv/tmp/scroll-probe.ts): 20 rounds, 40 bodies, 119 unique posts, zero stalls, zero checkpoint; manual keep-open scrolling "limitless" per developer.

### Login cooldown deferred
**Question**: after login-linkedin succeeds, how long should the system wait before the next automated walk?
**Recommended**: 30-60 min cooldown.
**Chosen**: Deferred — "need proper research first no decision now."
**Rationale**: developer deferral; the harvestedAt stamp (src/linkedin-session.ts) makes the gate implementable once research fixes the value.

### Keep-open experiment flag shipped
**Question**: (developer request) do not close the browser after login so manual search/scroll can be tested.
**Recommended**: n/a — direct request.
**Chosen**: `--keep-open` flag shipped (deps-injected enterWait; offline pin added).
**Rationale**: evidence: tests/login-linkedin.test.ts "runLoginHelper keep-open" pin; gates green 559/559.

### Kick root cause: session-risk state, not the browser
**Question**: why did refresh kick to the account-picker page?
**Recommended**: n/a — diagnosis.
**Chosen**: LinkedIn invalidated the session (risk system); repeated login→probe storms heated the account/IP; two browser binaries kicked identically the same day.
**Rationale**: evidence: 2026-11-12 experiments (Chromium kick, msedge kick, screenshot of the Welcome-Back account picker) + bank-verified fresh-session double-navigation trigger.

## Open Questions
- Cooldown duration (30-60 min proposal) and whether moderate pacing alone suffices on a fresh session — deferred to research per the developer.
- 7 flagship bodies rode endpoints LINKEDIN_RESPONSE_RE does not match during the 2026-11-12 run — research names them and decides whether the filter or a diagnostic needs widening.

## Suggested Follow-ups
- Guidance docs are stale: the probe is described as headless on the cookie document; the code is headed on the persistent profile since 2026-11-11T18:40 (src/linkedin-fetch.ts:14-18, scripts/probe-linkedin.ts:66-69).
- src/linkedin-parser.ts:9-10 says "scrolling fires nothing" — variant-scoped claim; reword during implement to prevent future dead-ends.
- scripts/reset-linkedin.ts appears in the lint enumeration but in none of the guidance docs.
- .rpiv/tmp/scroll-probe.ts is untracked scratch — delete or promote it during implement.

## References
- src/linkedin-fetch.ts (walk + context factory + fault vocabulary), src/linkedin-parser.ts, src/linkedin-session.ts
- scripts/login-linkedin.ts, scripts/probe-linkedin.ts, scripts/fetch-linkedin.ts, scripts/watch-linkedin.ts
- tests/linkedin-fetch.test.ts, tests/login-linkedin.test.ts
- .rpiv/tmp/scroll-probe.ts — the 2026-11-12 live scroll run (20 rounds, 119 posts, clean)
- .rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface-and-scroll-rounds.md
- .rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md

## Implementation Status (2026-11-12, same-day build)
- SHIPPED: `channel: "msedge"` at both launch sites (scripts/login-linkedin.ts, src/linkedin-fetch.ts).
- SHIPPED: login keep-open is the DEFAULT — `npm run login-linkedin` holds the browser after harvest; `--auto-close` restores the old behavior (the `--keep-open` flag stays accepted).
- SHIPPED: the walk's scroll arm now measures every scroll candidate (window scrollingElement, `<main>`, `[data-testid='lazy-column']`, `.scaffold-finite-scroll`) and scrolls the one with the most travel — live-verified `<main>` — instead of the lazy column and window, which measure zero travel on the live variant. THAT was the "3 posts, dry exit" root cause: the old SCROLL_JS scrolled the wrong node (src/linkedin-fetch.ts, SCROLL_JS revised 2026-11-12).
- SHIPPED: probe floor 2 → 10 posts with an explicit "pagination did not prove out" message (scripts/probe-linkedin.ts).
- Live receipt behind all of it: 20 rounds × 3.5s settle on `<main>` = 40 bodies, 119 unique posts, zero stalls, zero checkpoint (scratch run .rpiv/tmp/scroll-probe.ts, production parser).
- Accepted follow-up cost: on scroll variants each round still pays the Load-more waitFor timeout (~5s) before its dry classification; skipping the wait when the round-1 DOM probe reports loadMore 0 is the next optimization.
- Probe doctrine unchanged: re-probe after every re-harvest; two greens ≥6h apart before trusting the loop.

## Implementation Status addendum (2026-11-12, later)
- VARIANT RULE (operator-observed, deterministic): the pagination variant is VIEWPORT-DRIVEN — responsive design. Full-screen window → infinite-scroll variant (no Load-more; `<main>` scrolls). Narrower window → button variant (Load more renders; clicks mint). This unifies every earlier contradictory variant report. Window size selects the arm; the shipped dual-arm walk covers both.
- Acceptance run later the same day: kicked at 1 post. Session-risk heat from the day's repeated automated cycles — the 20-round clean scratch run on identical mechanics ~1h earlier rules out a code fault. The cooldown protocol (harvestedAt gate + one clean cycle) governs; do not stack automated cycles while hot.

## ACCEPTANCE MET (2026-11-12, evening)
- [x] `npm run probe-linkedin` green: **19 unique posts from 8 pagination bodies, 8 clicks fired, 26s, `probe: all checks passed`** — no halt, no leg-dead, no kick. Verified operator protocol: login → browse the feed first (keep-open) → close → probe. The kicking sequence (login → harvest → close → probe immediately) is documented above; feed-first rest defuses it.
- [x] In-walk scroll receipt: feed-first scratch run — 14 bodies, 42 unique posts, 10 rounds on `<main>`, zero walls.
- [x] Dual-arm proof in ONE run: the scroll arm moved `<main>` first; the narrower probe window (viewportH 920) then served the CLICK variant and the click arm fired 8/8 — window size selects the arm, the walk handles both.
- Remaining unshipped guard: the harvestedAt cooldown gate (FR-4) — the automated form of "let the session rest before automating". Value still deferred to research (proposal: 30-60 min).

## FRD UPDATE: MANDATORY feed visit before close (2026-11-12, developer decision)
- FR-5 AMENDED: after a successful harvest, the login helper SHALL navigate the browser to `https://www.linkedin.com/feed/` (LINKEDIN_FEED_URL) and let it settle (FEED_SETTLE_MS 5s) BEFORE any close — keep-open and auto-close alike.
- SHIPPED: `LoginContext.gotoFeed?` seam; the production context re-navigates to the feed and settles; the offline pins prove feed-BEFORE-close ordering and harvest-keeps-on-feed-failure (warn loudly, never discard a written cookie file).
- Rationale: the verified protocol — close-without-feed kicked twice; feed-first passed twice (2026-11-12). Developer made the feed visit mandatory rather than advisory.
- Gates: typecheck ✓ · lint ✓ · tests ✓ 561/561.
