---
date: 2026-11-01T09:21:30+0700
author: Yogiswara Utama
commit: 14aaf74
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Run the LinkedIn watch on a host that is not the developer's own PC"
tags: [intent, frd, fetch-linkedin, watch-yml, linkedin-session]
status: ready
last_updated: 2026-11-01T09:21:30+0700
last_updated_by: Yogiswara Utama
---

# FRD: Run the LinkedIn watch on a host that is not the developer's own PC

## Summary
The LinkedIn fetch leg cannot run on GitHub Actions: LinkedIn bounces authenticated sessions that arrive from datacenter IPs (4 consecutive CI failures vs a local success with the identical session file). The feature is to find and wire a host that is not the developer's PC, is free, and presents LinkedIn with a residential-grade exit IP, so the every-10-minutes LinkedIn watch keeps producing digests with the PC fully off.

## Problem & Intent
The developer's words: "the linkedin watcher not runnable using gitlab action, i need another ship to do it" — spoken after live evidence that the CI environment itself is the blocker. Success, in their framing: "find a way to run linkedin watch in anything that not in my own pc". The motivation is continuity: the watch must keep running (and emailing LinkedIn matches) when the PC is off, which is the entire reason the pipeline lives on scheduled CI today.

## Goals
- LinkedIn surfaces fetch successfully on a schedule with the developer's PC powered off
- The produced posts reach the existing digest email path unchanged
- The LinkedIn account is never exposed to proxy-network-style risk that could flag or restrict it
- Zero recurring monetary cost

## Non-Goals
- Keeping the current GitHub-Actions-runner egress for the LinkedIn leg (it is the thing that fails)
- Paid residential-proxy or paid-hosting options (budget is free-only)
- Rotating/throwaway LinkedIn accounts (the main account is precious)
- Any change to the judge, email, heartbeat, or seen-state logic itself

## Functional Requirements
1. The system SHALL run the LinkedIn fetch leg (or the whole watcher, per the open split question) on a host the developer does not personally operate day-to-day, at zero recurring cost.
2. The host's network egress SHALL present LinkedIn with an IP that does not reproduce the datacenter-IP bounce (residential or mobile class).
3. The run SHALL deliver collected LinkedIn posts into the existing pipeline such that they are judged against keywords and emailed in the digest (exact merge point is an open question — before dedupe on the Actions side per the probe, or the whole run moves).
4. The LinkedIn session secret (LINKEDIN_SESSION_STATE) SHALL be available to the chosen host without committing credentials to the repo.
5. Failure of the LinkedIn leg SHALL remain non-fatal to the run (Threads surfaces and the state commit-back still complete), matching today's skip-and-continue contract.
6. The session refresh path (successful login writes the fresh session back) SHALL either keep working on the new host or be explicitly declared not-applicable in the design.

## Non-Functional Requirements
- **Performance**: one LinkedIn walk is ~2–4 minutes worst case (nav 30s + first-response 30s + 8 scroll rounds); the schedule cadence of every 10 minutes must keep holding
- **Security**: the session secret equals the account (account-equivalent file); it must live only in the chosen host's secret store, never in the repo, logs, or state
- **UX / Accessibility**: no new manual steps in the normal loop; re-login/session-repair stays an operator escape hatch
- **Reliability**: a dead session or a bounced walk degrades to the existing skip warning (run exits 0, Threads continues); the 6h cooldown-after-challenge behavior must not be regressed

## Constraints & Assumptions
- Hard constraint from evidence: datacenter egress bounces the session — 4 CI runs failed with "no flagship-web response within 30000ms" while the identical session file fetched 47 posts locally minutes later (runs 41262910906, 41263307790, 41263753774, 41264399768 vs local repro 2026-11-01). The developer deferred final confirmation of "no cloud CI can work" to research, so research must verify whether ANY cloud platform presents non-datacenter egress before ruling the family out.
- Runtime envelope of the leg: Node >= 22, headless Playwright Chromium, env secrets per ENV_NAMES (src/config.ts:12-23), outbound contact limited to www.linkedin.com (src/config-file.ts:252-256, src/fetch-linkedin.ts:55-57)
- Budget: free only — no paid proxies, no paid hosting
- Account safety: no free proxy networks that share IPs across abusive traffic; the LinkedIn account must not absorb restriction risk
- Kaspersky on the dev machine denies network to HEADED Chromium only; headless is unaffected (.rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md:3018) — relevant only if the chosen path ever logs in from this machine
- Assumption to verify: the LinkedIn fetch is separable from the Actions pipeline — fetch returns plain Post[] and LinkedIn ids flow through state/judge/email as opaque strings (probe: src/index.ts:156-188, src/fetch-linkedin.ts:174-181)

## Acceptance Criteria
- [ ] With the PC powered off, a scheduled run logs "fetch: linkedin/... OK — N post(s)" from the chosen host (grep the run log; N > 0 or a legitimate 0-results line)
- [ ] The digest email for that run contains at least one LinkedIn-sourced post (urn:li:activity id) judged against the configured keywords
- [ ] The next scheduled run does not re-email the same LinkedIn posts (seen-state covers them), regardless of which host merged them
- [ ] Killing the chosen host mid-run leaves the next Actions run green (skip-and-continue contract holds; exit 0)
- [ ] No secret value appears in the repo, workflow logs, or state files (grep the run log for the session marker)
- [ ] Total recurring cost of the chosen host is 0 (no paid plan required in its setup)

## Recommended Approach
Deferred to research by design: pick the free, account-safe host with residential-class egress, then either (a) move only the LinkedIn fetch there and POST the Post[] JSON back to the Actions run for merge before dedupe (src/index.ts:188), or (b) relocate the whole runWatcher there. Research owns both the host question and the split question.

## Decisions

### Success = LinkedIn digests arrive with the PC off
**Question**: "When this is done, what does success look like for you — what must be true that isn't true today?"
**Recommended**: n/a — intent question
**Chosen**: "the linkedin watcher not runnable using gitlab action, i need another ship to do it"
**Rationale**: the developer's own framing of the gap — CI egress is the blocker, so the fix is a different host ("ship"), not different code

### Budget: free only
**Question**: "How much monthly spend is acceptable for the thing that hosts the LinkedIn fetch?"
**Recommended**: Up to ~$15/mo
**Chosen**: "Free only"
**Rationale**: no paid proxies, servers, or runners — this prunes the whole paid-proxy family before research

### Account safety: the main account is precious
**Question**: "Free paths that fake a residential IP (free proxy networks) can get a LinkedIn account flagged or restricted. How should research weigh risk to your account?"
**Recommended**: Account is precious
**Chosen**: "Account is precious"
**Rationale**: rules out free shared proxy networks; only paths that keep LinkedIn seeing a normal login are in scope

### Datacenter egress is the blocker; scope of the generalization deferred
**Question**: "From the evidence: every other cloud CI egresses from datacenter IPs too — confirm as a hard constraint?"
**Recommended**: Confirmed
**Chosen**: "need research to find a way" — deferred, not confirmed
**Rationale**: the 4-failure/1-success evidence is strong but single-provider; research must verify the generalization (any cloud platform with non-datacenter egress) rather than inherit it as settled

### Pipeline split: fetch-only vs whole-run
**Question**: "From the probe: only the LinkedIn fetch needs a new home — keep this split?"
**Recommended**: Keep the split
**Chosen**: "depends on research result" — deferred to research
**Rationale**: the split decision depends on which host wins; evidence that a split is feasible is recorded for research (probe: src/index.ts:156-188)

## Open Questions
- Which concrete host/"ship" carries the LinkedIn fetch (the core ask — this is research's main question)
- Fetch-only split (posts merge back before dedupe) vs relocating the whole runWatcher — depends on the host
- Whether ANY cloud platform presents residential/mobile-class egress, or the host family is genuinely limited to non-cloud devices (user-rejected: their own PC)

## Suggested Follow-ups
- The failure message "the session may be dead" never logs where the page landed — one line adding page.url() to the throw in src/fetch-linkedin.ts would have cut this whole diagnosis to minutes
- One judge batch timed out in run 41263753774 (10 posts deferred, retried next run) — watch for recurrence; separate from this feature
- .rpiv/guidance/src/architecture.md and .rpiv/guidance/.github/workflows/architecture.md are stale on the LinkedIn leg (validation 2026-11-01_08-00-29 noted this) — refresh in a follow-up

## References
- Input: conversation diagnosis session 2026-11-01 (CI run 41261797331 and successors; local repro .rpiv/tmp/linkedin-repro.ts)
- Session/login artifacts: scripts/linkedin-login.ts, src/linkedin-login.ts, src/fetch-linkedin.ts, src/threads-session.ts
- Prior plan + validation: .rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md, .rpiv/artifacts/validation/2026-11-01_08-00-29_linkedin-second-surface-dispatch.md
- Environment caveat: .rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md:3018 (Kaspersky headed-network note)
