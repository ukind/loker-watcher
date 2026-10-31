---
date: 2026-10-31T07:45:40+0700
author: Yogiswara Utama
commit: b92fa9f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn second surface + configurable scroll"
tags: [intent, frd, fetch-threads, config-file, threads-session, extract, types, email, judge]
status: ready
last_updated: 2026-10-31T07:45:40+0700
last_updated_by: Yogiswara Utama
---

# FRD: LinkedIn second surface + configurable scroll

## Summary
Add LinkedIn content search as a second watched surface beside Threads. One run fetches both surfaces, judges candidates with the existing LLM pipeline, and emails one digest that names the platform of each match. The scroll depth of the authenticated walk becomes one operator-facing config key, `scrollRounds`.

## Problem & Intent
The developer's request, verbatim: "i want to add support for linkedin" with the example URL
`https://www.linkedin.com/search/results/content/?keywords=%23hiring%20engineer%20developer%20jakarta&origin=FACETED_SEARCH&datePosted=%5B%22past-24h%22%5D`,
plus "makes the current scroll setting configurable in watch config".

Sharpened intent: **"Second net, same goal."** LinkedIn is the second-biggest job surface for the Jakarta hunt. Cover it the same way as Threads — same pipeline, same digest. On the research capture the developer added, verbatim: "the idea is this 'linkedin watcher' is running the same mechanism as existing idea."

## Goals
- LinkedIn hiring posts reach the same email digest as Threads posts, produced by the same run.
- The operator adds a LinkedIn surface in `watcher.config.json` as a keywords string; no code change.
- Scroll depth of the authenticated walk is configurable through one config key.
- Each digest match names its platform (threads or linkedin).

## Non-Goals
- No generic LinkedIn URL surface type — `url` stays Threads-only; LinkedIn enters as keywords.
- No exposure of the other scroll/walk constants (`SCROLL_MIN_GAIN`, `SCROLL_SETTLE_MS`, and the rest of `src/fetch-threads.ts:44-57`).
- No changes to judge rotation, state file format, or the email transport.
- Threads is not removed or demoted; it stays a first-class surface.

## Functional Requirements
1. The `Surface` union (`src/config-file.ts:14`) SHALL gain `{ type: "linkedin"; value: string }` where value is a keywords string. `readSurfaces` (`src/config-file.ts:120-163`) SHALL accept it and SHALL reject an empty or non-string value with the file path and key in the error.
2. `resolveSurfaces` (`src/config-file.ts:191-197`) SHALL build, for a linkedin entry, `https://www.linkedin.com/search/results/content/?keywords=<url-encoded value>&origin=FACETED_SEARCH&datePosted=%5B%22past-24h%22%5D`, with log label `linkedin/<value>`.
3. The built URL SHALL hard-code `datePosted=["past-24h"]`. `recencyHours` (`src/recency.ts:13-22`) still filters after fetch.
4. A new config key `scrollRounds` SHALL join `ALLOWED_KEYS` and `WatcherConfig`: integer, default 8 when absent, validated fail-visibly (file path + key in every rejection). The value SHALL replace `MAX_SCROLL_ROUNDS` (`src/fetch-threads.ts:44`) at the scroll-loop call sites (`src/fetch-threads.ts:394-409`); the constant stays as the default.
5. `Post` (`src/types.ts:10-21`) SHALL gain `platform: "threads" | "linkedin"`. The Threads extraction path sets "threads"; the LinkedIn fetch path sets "linkedin".
6. The digest SHALL name the platform on each match line, and the subject line (`src/email.ts:58` hard-codes "on Threads") SHALL stay accurate when LinkedIn matches exist.
7. Judge prompts SHALL NOT mislabel LinkedIn posts: `src/judge.ts:238` and `:265` say "Threads post" verbatim today; wording becomes platform-neutral or platform-aware.
8. The LinkedIn fetch SHALL ride the acquisition seam (`src/index.ts:150-163`) and the shared `runPool` like the Threads walks. Its session/auth contract is set by the research capture before design (Open Question 1).
9. Fail-visible SHALL hold end to end: a malformed linkedin surface or a bad `scrollRounds` exits nonzero and names the file and the offending key.

## Non-Functional Requirements
- **Performance**: the LinkedIn fetch joins the existing bounded pool (`FETCH_CONCURRENCY=4`, `src/fetch-threads.ts:40`); no new serial stage. `JUDGE_CONCURRENCY` and its probe discipline are untouched.
- **Security**: LinkedIn session material is env-only and mirrors the `ENV_NAMES` pattern (`src/config.ts:14-21`); never committed; mechanism confirmed by the research capture.
- **UX / Accessibility**: the digest stays plain text; one line per match with the platform named.
- **Reliability**: state writes stay atomic (`src/state.ts`); the zero-match heartbeat is unchanged; a LinkedIn-side fetch failure must not discard Threads results (failure semantics fixed in design, informed by the capture).

## Constraints & Assumptions
- **Doctrine exception**: repo doctrine says only probe-measured values are tunable and tuning lives as module constants. `scrollRounds` is one deliberate, confirmed exception; nothing else opens up.
- **Assumption (unverified)**: LinkedIn content search emits interceptable XHR/blob responses a Playwright walk can parse. The research capture with pire-browser must confirm this before design.
- **Assumption (unverified)**: LinkedIn content search requires login. The capture decides.
- Playwright is already the browser runtime; no new runtime dependency may be added for the fetch.
- Node >= 22, ESM, strict TS flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) stay on.

## Acceptance Criteria
- [ ] `npm run typecheck && npm run lint && npm test` exits 0.
- [ ] `watcher.config.json` with `{ "type": "linkedin", "value": "#hiring engineer developer jakarta" }` loads; `resolveSurfaces` produces the example URL (encoding aside) and label `linkedin/#hiring engineer developer jakarta`.
- [ ] With `scrollRounds: 5`, the authenticated walk stops after 5 scroll rounds, pinned by a test in the style of `tests/fetch-threads.test.ts:299`, `:325`; with the key absent, behavior equals today's 8.
- [ ] `scrollRounds: "five"` exits nonzero with the file path and key in the message.
- [ ] A digest containing a LinkedIn match names linkedin on its line, and the subject line is accurate for mixed or LinkedIn-only matches.
- [ ] A judge prompt built for a LinkedIn post does not contain the string "Threads post".
- [ ] A Threads-only config produces output byte-identical to today (digest lines, subject, heartbeat).

## Recommended Approach
Extend the `Surface` union and `resolveSurfaces` in `src/config-file.ts` with a linkedin branch that builds the content-search URL; add a LinkedIn fetch provider at the acquisition seam (`src/index.ts:150-163`) reusing `ContextFactory` and `runPool`; thread a validated `scrollRounds` into the existing scroll loop; add `platform` to `Post` and surface it in digest and judge prompts. Research must first run the pire-browser capture of LinkedIn's login and data mechanism and record the observed extraction path.

## Decisions

### Foundational intent
**Question**: What problem does adding LinkedIn solve, and who hits it today?
**Recommended**: n/a — `intent` question
**Chosen**: "add new supported website: linkedin. beside threads"
**Rationale**: n/a — `intent` question; recorded verbatim.

### Sharpened intent
**Question**: What does watching LinkedIn add for your job hunt that Threads alone does not give you today?
**Recommended**: n/a — `intent` question
**Chosen**: "Second net, same goal" — LinkedIn is the second-biggest job surface; cover it the same way as Threads.
**Rationale**: n/a — `intent` question.

### Surface entry type
**Question**: How should a LinkedIn surface enter watcher.config.json?
**Recommended**: linkedin keywords type
**Chosen**: linkedin type (Recommended accepted)
**Rationale**: platform-specific auth and extraction beat URL flexibility; costs new config validation — evidence: src/config-file.ts:14, :120-163 + confirmed.

### Scroll configurability
**Question**: Repo doctrine says only probe-measured values are env-tunable and tuning stays hard-coded. How far should scroll configurability go?
**Recommended**: one key
**Chosen**: One key `scrollRounds`, default 8 (Recommended accepted)
**Rationale**: operator control with a single, deliberate doctrine exception — evidence: src/fetch-threads.ts:44-57 + root architecture.md Business Context + confirmed.

### Platform field on Post
**Question**: Posts today carry no source field (0 hits for "platform" in src). Should posts become platform-tagged?
**Recommended**: add platform field
**Chosen**: platform field (Recommended accepted)
**Rationale**: digest legibility and cross-platform clarity; costs touching type, extract, digest — evidence: src/types.ts:10-21 + confirmed.

### Capture timing
**Question**: You asked for a pire-browser capture of LinkedIn's login and data mechanism. Run it in this session or hand it to the research stage?
**Recommended**: capture now in this session
**Chosen**: developer's call — "its up to you, the idea is this 'linkedin watcher' is running the same mechanism as existing idea" → capture is a mandatory research task
**Rationale**: discover writes the FRD; the capture grounds design. Recorded as Open Question and research acceptance item.

### LinkedIn auth contract
**Question**: LinkedIn content search is auth-gated (unverified — the research capture confirms). What is the session contract for the LinkedIn fetch?
**Recommended**: same as Threads (optional env, logged-out attempt, loud warning)
**Chosen**: Decide after capture (deferral)
**Rationale**: LinkedIn behavior is unverified; evidence: src/threads-session.ts:28-52 pattern exists, LinkedIn response unknown — evidence: src/threads-session.ts:28-52.

### LinkedIn fetch window
**Question**: Your example URL pins datePosted=past-24h. How should the LinkedIn fetch window relate to recencyHours?
**Recommended**: hard-code 24h
**Chosen**: Hard-code 24h (Recommended accepted)
**Rationale**: determinism; `recencyHours` still filters post-fetch — evidence: src/recency.ts:13-22 + example URL + confirmed.

## Open Questions
- **Auth contract** — optional env with logged-out attempt (same-as-Threads), required env with fail-visible exit, or logged-out-only? Decided by the pire-browser capture; the Threads pattern to mirror lives at `src/threads-session.ts:28-52`.
- **Extraction mechanism** — do LinkedIn content-search responses arrive as interceptable XHR or inline blobs, and what is the post shape? Pending the capture.
- **Logged-out feasibility** — does logged-out LinkedIn content search return results at all, or does it hit a login wall?
- **LinkedIn concurrency ceiling** — does the existing `FETCH_CONCURRENCY=4` suit LinkedIn, or does it need its own probe-measured reading (precedent: `scripts/probe-judge.ts`)?

## Suggested Follow-ups
- `FETCH_CONCURRENCY=4` (`src/fetch-threads.ts:40`) is hard-coded and unmeasured for LinkedIn — see Open Question 4.
- `MAX_POSTS_PER_SURFACE=150` (`src/fetch-threads.ts:46`) was tuned for Threads; whether the same cap suits LinkedIn is unmeasured.
- Cross-platform id collisions: state dedupe is id-keyed (`src/state.ts:166-176`); Threads uses 19-digit pks while LinkedIn ids differ in shape — research/design should confirm no collision, or namespace ids by platform.
- `tests/config-file.test.ts:88` pins the non-threads URL rejection — the linkedin type lands beside it without relaxing that gate.

## References
- Request input: LinkedIn content-search example URL with `keywords=#hiring engineer developer jakarta`, `origin=FACETED_SEARCH`, `datePosted=["past-24h"]`
- `.rpiv/guidance/src/architecture.md` — pipeline stages, funnel gates, DI seams, config contract
- `.rpiv/guidance/tests/architecture.md` — offline test conventions
- `.rpiv/guidance/.github/workflows/architecture.md` — secret mapping for any new session env
- Probe evidence: codebase-locator agent 5695d646-ef62-4cf, codebase-analyzer agent 24d4fa7b-2b5c-4bd (graph project `C-Users-utama-orca-workspaces-loker-watcher-feature-add-support-for-linkeind`, generation 2026-10-31T00:24:26Z, coverage clean on 8 evidence paths)
- Current surfaces: `watcher.config.json:20-30` (3 tag + 7 Threads url entries)
