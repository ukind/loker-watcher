---
date: 2026-11-12T09:30:27+0700
author: Yogiswara Utama
commit: 559ad54
branch: main
repository: loker-watcher
topic: "LinkedIn scroll pagination and session hygiene"
tags: [research, codebase, linkedin-fetch, linkedin-parser, linkedin-session, login-linkedin, probe-linkedin, fetch-linkedin, watch-linkedin]
status: ready
last_updated: 2026-11-12T09:30:27+0700
last_updated_by: Yogiswara Utama
---

# Research: LinkedIn scroll pagination and session hygiene

## Research Question
Chained from the 2026-11-12 FRD (.rpiv/artifacts/discover/2026-11-12_07-50-38_linkedin-scroll-pagination-session-hygiene.md). Its two deferred questions: (1) the login-to-walk cooldown value for FR-4; (2) the 7 flagship bodies that rode endpoints LINKEDIN_RESPONSE_RE does not match. The checkpoint added a third: the operator chain that now replaces FR-4's timer.

NOTE: every file:line below describes the WORKING TREE, not commit 559ad54 — the FRD's same-day changes (msedge, scroll arm, floor 10, feed-first, keep-open default) are uncommitted modifications (git status: scripts/login-linkedin.ts, scripts/probe-linkedin.ts, src/linkedin-fetch.ts, tests/login-linkedin.test.ts).

## Summary
- Most of the FRD is already built in working-tree code: the dual-arm round loop, msedge on both launch sites, probe floor 10, mandatory feed-first, keep-open as default.
- FR-4's timed cooldown is DROPPED by developer decision. The kick trigger was the missing feed visit, not timing; feed-first is already mandatory. The protection is the operator chain: login (operator closes the browser by hand) -> probe -> if it passes, one fetch tick -> stop. watch-linkedin stays manual-start. No timer, no new env, no new config.
- The response filter widens: accept every /flagship-web/ batch. The guarded parser, first-wins urn dedupe, and the LLM judge absorb noise and junk; nothing gets dropped for riding an unlisted endpoint.
- The early-stop rule stays post-gain-only (3 unproductive rounds). FR-2 ships as visibility only: the stop line names the round, the scroll variant, and the budget.

## Detailed Findings

### The walk engine (src/linkedin-fetch.ts)
- Round loop at src/linkedin-fetch.ts:576: `round <= scrollRounds && posts.size < LINKEDIN_MAX_POSTS` (cap 150). scrollRounds is the config knob shared with the Threads walk.
- Scroll arm at src/linkedin-fetch.ts:597: SCROLL_JS measures every candidate (window scrollingElement, main, [data-testid='lazy-column'], .scaffold-finite-scroll), scrolls the largest-travel one to its bottom, nudges the window, and brings a Load-more button into view. The chosen container logs on round 1 only (src/linkedin-fetch.ts:598-599).
- Click arm at src/linkedin-fetch.ts:606-608: LOAD_MORE_SELECTOR waitFor 5s then click. On scroll variants every round still pays the ~5s waitFor timeout — the FRD's accepted cost; skipping it when the round-1 DOM probe reports loadMore 0 is the named optimization.
- Early stop at src/linkedin-fetch.ts:627-640: gain = deduped-map growth; gained < 2 (LINKEDIN_MIN_GAIN) counts a dry round; break at 3 consecutive dry AND (clicks === 0 || clicks >= minClicks). The clicks===0 skip keeps button-less scroll variants from burning all rounds on timeouts.
- Unmatched-flagship diagnostic at src/linkedin-fetch.ts:481-500: the response join already counts non-matching /flagship-web/ bodies (status + urn-id count + commentary-marker count + first 80 URL chars). The 2026-11-12 run's 7 bodies rode this line. After the widening it goes quiet but stays as the regression canary.
- Fault vocabulary: checkpoint URL -> HaltError (src/linkedin-fetch.ts:188, :472-475); no flagship response in 30s -> LegDeadError (:546-567); 1.5s drain (:649); OK line (:651).
- Factory at src/linkedin-fetch.ts:324: headed persistent profile, channel msedge (:331), viewport null, locale en-US. Profile dir at :385 (C:/loker-secrets/linkedin-chromium-profile — outside the repo).

### Session and the operator chain (replaces FR-4's timer)
- harvestedAt is written at harvest (scripts/login-linkedin.ts:95-110), read tolerantly (src/linkedin-session.ts), and required for presence only — never age-checked — at scripts/fetch-linkedin.ts:357-361. The age-check slot exists (:351-356) and stays empty by decision.
- Feed-first is mandatory before close: scripts/login-linkedin.ts:227-239 (gotoFeed seam :67, LINKEDIN_FEED_URL :42, FEED_SETTLE_MS 5000 :45). A failed feed visit warns loudly and never discards a written cookie file.
- keep-open is the DEFAULT: scripts/login-linkedin.ts:255-256 (keepOpen: !argv includes --auto-close). The browser holds until Enter (:240-248); the profile-lock warning prints (:242-244).
- Launch parity: login scripts/login-linkedin.ts:148-151 and walk src/linkedin-fetch.ts:331 both ride channel msedge, headed.
- THE CHAIN (checkpoint decision, not yet code): login -> operator closes -> probe runs -> on pass, one fetch tick -> stop. watch-linkedin starts manually. Today nothing chains them: the login helper ends at close (scripts/login-linkedin.ts:249-250); probe (scripts/probe-linkedin.ts) and tick (scripts/fetch-linkedin.ts:315) are separate entries. Design picks the shape: a wrapper script vs documented operator commands.
- Tick gate order, verified: scripts/fetch-linkedin.ts:315-361 — working window (Mon-Fri 08:00-21:00, bypassWindow flag :333-338) -> halt latch (:339-344) -> guardCheckout (:349, branch main + clean tree BEFORE any fetch) -> cookie resolve + harvestedAt presence (:350-361) -> walk (:374-382). Halt trips the latch and alarms (:387-389).

### The response filter widening (src/linkedin-parser.ts)
- Today: LINKEDIN_RESPONSE_RE at src/linkedin-parser.ts:73-74 matches exactly search/results/content and rsc-action/actions/pagination (the two flagship endpoints, captures 2026-10-31 + 2026-11-11).
- Decision: match every /flagship-web/ response. Safety chain: mintPost is guarded and never throws (src/linkedin-parser.ts:185); pairing warns on count mismatch (:216, the oracle line); the walk dedupes first-wins by urn (src/linkedin-fetch.ts:508-525); the LLM judge is the relevance gate — a feed post that matches the keywords is a true positive, not noise.
- Keep the URL head in the per-body log lines (src/linkedin-fetch.ts:518-522) for provenance.

### The probe contract (scripts/probe-linkedin.ts)
- Floor 10 shipped: scripts/probe-linkedin.ts:83-88 with the explicit "pagination did not prove out" message. PROBE_MIN_CLICKS = 5 (:40) rides fetchLinkedInPosts (:71-80).
- Exit contract unchanged (:90-105): HALT / LEG DEAD / FAILED / floor, all exit 1.
- STALE DOC: AGENTS.md and the scripts guidance still document the probe floor as 2. Code ships 10. Fix rides implement.

### Watch cadence (scripts/watch-linkedin.ts)
- 28-33 min jitter (:2-3, sampleTickDelayMs :74); the first tick runs immediately (:41-47); leg-dead sends one alarm per episode and the loop continues (:63-73).
- The chain's fetch tick and watch's immediate first tick can land minutes apart. Accepted by decision: two automated visits minutes apart post-login were NOT the observed kick trigger (the kick trigger was the missing feed visit); no stacking guard ships.

## Code References
- src/linkedin-fetch.ts:576 — the per-surface round loop bound (scrollRounds x post cap 150)
- src/linkedin-fetch.ts:597-605 — the scroll arm (SCROLL_JS evaluate + round-1 container log)
- src/linkedin-fetch.ts:606-615 — the click arm + its 5s waitFor cost
- src/linkedin-fetch.ts:627-646 — gain accounting, dry counter, minClicks floor, break
- src/linkedin-fetch.ts:481-500 — response join + unmatched-flagship diagnostic
- src/linkedin-fetch.ts:546-567 — the 30s liveness window -> LegDeadError
- src/linkedin-fetch.ts:324-338 — the context factory (msedge, headed, persistent profile)
- src/linkedin-fetch.ts:678 — fetchLinkedInPosts signature (surfaces, profileDir, factory, scrollRounds, sleep, now, rng, minClicks)
- src/linkedin-parser.ts:73-74 — LINKEDIN_RESPONSE_RE (the filter this research widens)
- src/linkedin-parser.ts:185-214 — guarded mintPost (never throws)
- src/linkedin-parser.ts:216-323 — collectLinkedInPosts (pairing + oracle line)
- src/linkedin-session.ts:60-135 — the cookie resolver (harvestedAt tolerant read)
- scripts/login-linkedin.ts:42-51 — LINKEDIN_FEED_URL, FEED_SETTLE_MS, LOGIN_TIMEOUT_MS
- scripts/login-linkedin.ts:95-110 — atomic cookie write + harvestedAt stamp
- scripts/login-linkedin.ts:146-165 — headed msedge launch + gotoFeed arm
- scripts/login-linkedin.ts:227-248 — mandatory feed warm-up, then keep-open hold
- scripts/login-linkedin.ts:255-261 — entry: keepOpen default true (--auto-close restores)
- scripts/probe-linkedin.ts:40 — PROBE_MIN_CLICKS = 5
- scripts/probe-linkedin.ts:71-88 — the read-only walk call + the floor-10 gate
- scripts/fetch-linkedin.ts:315-361 — the verified preflight gate order
- scripts/watch-linkedin.ts:41-79 — runLoop: immediate first tick + 28-33 min jitter

## Integration Points

### Inbound References
- scripts/watch-linkedin.ts:50 — runLoop's default tick is fetchTick({ env }) on the 28-33 min cadence
- scripts/probe-linkedin.ts:71-80 — the probe calls fetchLinkedInPosts read-only (no payload, no push, no latch)
- The hosted run reads state/linkedin-posts.json through src/linkedin-payload.ts (readPayloadPosts never throws) — untouched by this work

### Outbound Dependencies
- src/linkedin-fetch.ts:508-525 — every matched body parses through src/linkedin-parser.ts collectLinkedInPosts
- scripts/login-linkedin.ts — writes the cookie file OUTSIDE the repo and upserts the .env line via src/env-file.ts upsertDotEnvLine
- scripts/fetch-linkedin.ts:374-382 — the tick rides the walk module's production factory (persistent profile)

### Infrastructure Wiring
- Dedicated clone of main enforced by guardCheckout (scripts/fetch-linkedin.ts:349) BEFORE cookies and any navigation
- The halt latch is repo-local beside the payload (scripts/fetch-linkedin.ts:139); the episode marker rides the same discipline
- npm scripts + the explicit lint enumeration in package.json — a new chain wrapper script lands in both, plus a black-box test

## Architecture Insights
- The pagination variant is VIEWPORT-DRIVEN (FRD addendum, operator-observed): full-screen window -> infinite scroll (main scrolls); narrower window -> Load-more button. Window size selects the arm; the dual-arm loop handles both, which is why the 2026-11-12 evening probe saw both arms in one run.
- Session identity lives in the persistent PROFILE, never a synthesized cookie document — the browser-walk migration's immediate follow-up fix (9fa2a7e) proved it; the cookie document is preflight-only (scripts/fetch-linkedin.ts:370-373).
- Fail-visible everywhere: every gate logs the problem and the remedy, and exits nonzero in one-shot entries. The chain decision keeps the human hand on the only irreversible step (the login) and automation on the reversible ones (probe, fetch).
- Repo doctrine holds: no new env knobs and no new config keys from these decisions — the chain adds nothing measurable, the widening adds no tuning surface, and the stall line reuses existing constants.

## Precedents & Lessons
4 similar past changes analyzed (git log, the linkedin file family).

### Precedent: the browser-walk migration
**Commit(s)**: 8e8f22b — "Migrate the LinkedIn leg to a browser walk" (2026-11)
**Blast radius**: the linkedin-* family + scripts + tests
**Follow-up fixes**: 9fa2a7e — "linkedin: ride the persistent profile and gate liveness on the DOM" — the fresh-browser-with-cookie-document variant served a page with NO Load-more button; the profile is the session. 6493f2a — "instrument the walk's click loop and response join" — the unmatched diagnostic and per-body logging came from the blind "3 posts, dry exit" run.
**Takeaway**: session identity and observability were both paid for once already; the chain and the widening extend existing seams, they do not reopen them.

### Precedent: fail-before-fetch discipline
**Commit(s)**: 625b15e — "fail the linkedin fetch tick on a mis-homed checkout before any fetch"
**Blast radius**: scripts/fetch-linkedin.ts (guardCheckout)
**Takeaway**: preflight order is the argument — a gated no-op costs zero git spawns, zero cookie reads, zero navigations (scripts/fetch-linkedin.ts:326-329). Any chain wrapper must keep that order and add no navigation of its own.

### Precedent: the PC-local leg
**Commit(s)**: a8752bf — "run the linkedin leg on the local pc (voyager transport, payload push, login helper)"
**Blast radius**: scripts/ + payload + hosted read seam
**Takeaway**: the hosted run only reads the payload; every kick-risk surface is PC-local by design, which is why operator-protocol decisions (the chain) need no workflow changes.

### Composite Lessons
- Every "it only minted 3 posts" incident ended up being an observability or identity gap, never a parsing gap (9fa2a7e, 6493f2a). The widened filter and the variant-named stop line are the same class of fix.
- Cookie-file discipline: one writer (the login helper), atomic write, machine-readable stamp (scripts/login-linkedin.ts:95-110) — the dropped FR-4 timer needed no new writer.

## Historical Context (from .rpiv/artifacts/)
- .rpiv/artifacts/discover/2026-11-12_07-50-38_linkedin-scroll-pagination-session-hygiene.md — the FRD this research chains from (9 decisions, same-day implementation status, the viewport-variant addendum)
- .rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface-and-scroll-rounds.md — the scroll-round origins and the 2-endpoint captures
- .rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md — the PC-local leg design (tick/loop/probe/login shapes)
- .rpiv/tmp/scroll-probe.ts — the 2026-11-12 live receipt: 20 rounds, 40 bodies, 119 unique posts, zero stalls, production parser (untracked scratch; delete or promote during implement)

## Developer Context
**Q (discover: Shared browser profile stays): login-linkedin and the walks share ONE headed browser profile — keep sharing it?**
A: Keep the shared profile — the only observed variant that paginates (src/linkedin-fetch.ts:385).

**Q (discover: Extraction stays response parsing): posts come from network responses, never DOM reads?**
A: Keep response parsing — the parser is pure and offline-pinned; the DOM carries no ids.

**Q (discover: Exit gates keep fail-visible): keep the probe's exit gates?**
A: Keep them — HALT / LEG DEAD / FAILED / floor all exit 1 (scripts/probe-linkedin.ts:90-105).

**Q (discover: Probe floor raised): what is the healthy floor?**
A: 10+ unique posts (shipped, scripts/probe-linkedin.ts:83-88); ~3 posts/body x several bodies proves pagination.

**Q (discover: Walk engine stays Playwright): how is the leg driven?**
A: Playwright with channel msedge on both launch sites (src/linkedin-fetch.ts:331, scripts/login-linkedin.ts:149); bladebro rejected.

**Q (discover: Pagination mechanism): which pagination does the walk support?**
A: Scroll-first (measure + scrollTop the scrollable, live-verified main), Load-more click as the button-variant fallback (src/linkedin-fetch.ts:597, :606-608).

**Q (discover: Login cooldown deferred): how long to wait after login before an automated walk?**
A: Deferred at discover; RESOLVED by research checkpoint: NO timed cooldown ships. The kick trigger was the missing feed visit, not timing; feed-first is already mandatory (scripts/login-linkedin.ts:227-239). FR-4's harvestedAt age gate is dropped — the presence-only gate at scripts/fetch-linkedin.ts:357-361 stays as-is.

**Q (discover: Keep-open flag): keep the browser open after login for manual testing?**
A: Shipped, now the DEFAULT (scripts/login-linkedin.ts:255-256); --auto-close restores the old behavior; the FRD's --keep-open spelling stays accepted.

**Q (discover: Kick root cause): why did refresh kick to the account picker?**
A: LinkedIn's risk system invalidated the session; repeated login->probe storms heated the account/IP. The verified defuser is feed-first + a hand-paced close.

**Q (checkpoint, operator protocol): what runs after the login browser closes?**
A: The chain: login -> operator closes by hand -> probe-linkedin -> on pass, one fetch-linkedin tick -> stop. watch-linkedin starts manually. Nothing chains these today (scripts/login-linkedin.ts:249-250 ends at close) — design picks the wrapper shape.

**Q (checkpoint, src/linkedin-parser.ts:73-74): what happens to batches on endpoints the filter ignores?**
A: Accept every /flagship-web/ batch — widen LINKEDIN_RESPONSE_RE. Dedupe absorbs repeats; the judge filters relevance; the diagnostic line stays as the canary (src/linkedin-fetch.ts:481-500).

**Q (checkpoint, src/linkedin-fetch.ts:627-640): does "unproductive round" gain a scroll-movement half?**
A: No — keep post-gain-only. FR-2 ships as visibility: the stop line names the round, the scroll variant, and the budget.

## Related Research
- .rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface-and-scroll-rounds.md

## Open Questions
- The chain's automation shape: a new wrapper script (npm run, entry-guarded, lint-enumerated, black-box tested) vs documented operator commands. Design decides; the wrapper must keep the preflight order (scripts/fetch-linkedin.ts:326-329) and add no navigation of its own.
- AGENTS.md + .rpiv/guidance/scripts/architecture.md still document the probe floor as 2 (code ships 10 at scripts/probe-linkedin.ts:83-88) — the doc fix rides implement.
- The round-1 loadMore-0 skip (drop the ~5s click-wait on scroll variants) remains the accepted optimization candidate (src/linkedin-fetch.ts:606; FRD "Accepted follow-up cost").
