---
date: 2026-11-10T19:36:43+0700
author: Yogiswara Utama
commit: 1cd0f47
branch: ukind/feature-migrate-using-browser-approach
repository: feature-migrate-using-browser-approach
topic: "linkedin-browser-walk-migration"
tags: [intent, frd, linkedin-fetch, fetch-threads, playwright, anti-detection, payload]
status: ready
last_updated: 2026-11-10T19:56:13+0700
last_updated_by: Yogiswara Utama
---

# FRD: linkedin-browser-walk-migration

## Summary
Replace the LinkedIn voyager-endpoint leg with a real Playwright browser walk — the same approach the Threads leg already uses — so the account stops presenting an API-call signature. The voyager client, the curl-impersonate transport, and the request.newContext transport are deleted outright; the new fetcher launches headless Chromium, opens each surface's content-search page by direct URL, and reads post data out of the rendered page the way the Threads authenticated walk does (`fetchSurfacesAuthenticated`, `src/fetch-threads.ts:304`). The payload envelope written to `state/linkedin-posts.json` is frozen, so the hosted watcher and the email digest need zero changes. The extraction step captures both available routes in one walk, so it does not gate the build (see Open Questions).

## Problem & Intent
The developer's words: "i hit a linkedin restricted again. i think the current approach is very likely like a bot. i want to change approach instead of hitting endpoint. i want to using headless browser like threads, the same approach." And on success: "tbh, the goal should be the linkedin does not detect it automated again. i dont know the correct approach. but my opinion maybe by using headless browser . because it simulate human behaviour."

The account was restricted again after the humanlike behavioral layer (jittered ticks, 5-15s pacing, working-hours window, 5 surfaces, 150/day budget) was already implemented on this branch. The developer's own account of the timeline: "i dont think so, i just run once, the probe then few hours later get restricted" — a single probe call, then a restriction hours later. The endpoint itself is the signal, not the volume. The goal is that LinkedIn does not detect the leg as automated; the developer accepts that this lowers detection odds rather than removing them, and that the correct session/login strategy is not yet known and needs research.

## Goals
- LinkedIn does not detect the leg as automated again — the account stays clean.
- The leg stops calling the voyager endpoint entirely; nothing in the repo can reach it.
- The new fetcher is a real browser walk in the Threads shape: Chromium launch, page navigation, data-payload extraction.
- The hosted watcher, the payload envelope, and the email digest are untouched by the migration.
- Every new behavior is covered by the offline suite — no live LinkedIn calls needed to verify.
- The migrated leg cannot run a live tick on the currently-restricted account: the FR-0 gate blocks it until the account prerequisites are met.

## Non-Goals
- Keeping the voyager endpoint as a fallback, auto or flag-gated — deleted outright (developer's explicit choice).
- Changing the payload envelope or the hosted-side reader (`src/linkedin-payload.ts`).
- Changing the hosted watcher pipeline (fetch → judge → notify) or the digest format.
- Making the leg compliant with LinkedIn's User Agreement — impossible; this is detection-avoidance only.
- Deciding the session/login strategy — deferred to research (see Open Questions).
- Re-enabling any hosted/cloud LinkedIn fetch — stays removed.

## Functional Requirements
0. **FR-0 — gating prerequisite, blocks the first live tick.** The leg SHALL refuse to fetch until ALL four hold: (a) a dedicated LinkedIn account exists, created and warmed by ordinary human use; (b) `npm run login-linkedin` harvested a NEW cookie file for it and `LINKEDIN_COOKIES_FILE` points at that newly-harvested path; (c) the old (personal-account) cookie path appears in no `.env`, config, or docs; (d) `watcher.config.json` holds exactly 5 `type: "linkedin"` surfaces, selected by the 2026-11-09 FR-8 rule: drop the exact duplicate (`hiring developer jakarta`), then keep the breadth portfolio — 1 national umbrella (`hiring indonesia`), 1 city umbrella (`hiring jakarta`), 2 role-narrowed (`hiring developer indonesia`, `hiring engineer jakarta`), 1 stack-narrowed (`hiring react indonesia`). The config validator SHALL reject more than 5 linkedin surfaces fail-visibly, and the gate error SHALL name the rule so the operator knows which 5 to configure. Every entry SHALL fail fast naming the missing prerequisite. The account is restricted as of this FRD, so the first live tick must be impossible on it.
1. The leg SHALL fetch LinkedIn posts by launching a Playwright Chromium browser and navigating to pages, not by issuing HTTP requests to the voyager endpoint.
2. The new fetcher SHALL read posts from the rendered page, not from visible DOM text, and SHALL capture both available routes in one walk: `page.content()` for embedded page JSON (the `data-sjs` idiom, `src/extract.ts:12`) and `page.on("response")` for JSON bodies matching the search route (`src/fetch-threads.ts:100`, already used by `fetchSurfacesAuthenticated` at `:372`). The parser tries page JSON first and falls back to intercepted responses. Which route yields posts is unverified offline (see Open Questions) but does not block the build.
3. For each configured surface, the fetcher SHALL open the surface's content-search results page by direct URL navigation.
4. The browser SHALL run headless, matching the Threads leg's mode.
5. The fetcher SHALL write posts to `state/linkedin-posts.json` in the exact existing envelope (`{version: 2, writtenAt, posts}`, rows validated by `src/linkedin-payload.ts:88-105`), so `readPayloadPosts` and the digest need no change.
6. The voyager client (`src/linkedin-voyager.ts`), the curl-impersonate transport, and the `request.newContext` transport SHALL be deleted, along with their tests and the `LINKEDIN_TRANSPORT` selector. `src/linkedin-fetch.ts` is REPLACED IN PLACE, not supplemented: the module keeps its name and its tagged errors (`LegDead`, `AllSurfacesFaulted`, `Halt` — all imported by `scripts/fetch-linkedin.ts`), loses the transport layer (`VoyagerGet`, `Transport`, `createCurlTransport`, `createPlaywrightTransport`, `resolveLinkedInTransport`, `ExecFn`, `CURL_IMPERSONATE_PROFILE`, `PAGE_SIZE`), loses the voyager fault classifier (`classifyFault`, `Fault`, `FaultKind` — it reads voyager HTTP status and body), and its `fetchLinkedInPosts` walk is replaced by the browser walk. No second LinkedIn fetch module is created: `src/fetch-linkedin-browser.ts` is NOT added.
7. A page that renders a security checkpoint or a login wall instead of search results SHALL halt the leg and fire one alarm per episode, using the existing halt-latch marker mechanism (`scripts/fetch-linkedin.ts` `DEFAULT_LATCH`). A surface that legitimately returns zero posts (quiet day, over-narrow keyword) is NOT a halt trigger — it yields zero posts for that surface and the walk continues.
8. The leg SHALL count page loads per local day and hard-stop at the existing daily budget (150), now counting browser page loads instead of voyager GETs.
9. The pacing layer SHALL be re-derived for browser loads: spacing and dwell measured in page loads, not API GETs. The tick cadence, working-hours window, and surface count (5) carry over.
10. The session/login strategy SHALL be resolved by research before implementation; the fetcher SHALL accept the resolved session through an injectable seam so the offline suite never opens a browser.

## Non-Functional Requirements
- **Performance**: a browser page load is slower than an API GET; a tick's wall time grows. The digest freshness target stays ~30 minutes on weekdays.
- **Security**: session material stays outside the repo; no cloud runners; no third-party token handling. The login-phase detection risk is an open research question.
- **UX / Accessibility**: headless pipeline — the operator-facing surface is the log plus the halt state; a halted leg MUST say so loudly (one alarm per episode).
- **Reliability**: a checkpoint or login wall halts the leg rather than hammering a flagged account. The halt latch survives restarts and is cleared only by explicit operator action.

## Constraints & Assumptions
- Node >= 22, strict TS ESM; Playwright is already a dependency (three existing dynamic-import quarantine sites — `src/fetch-threads.ts`, `src/linkedin-fetch.ts`, `scripts/login-linkedin.ts`), so no new runtime dependency.
- The leg remains a User Agreement §8.2 violation; this work lowers detection odds only.
- Assumption: a headless browser walk is materially less detectable than the voyager endpoint. Unverified — the developer's own evidence is one probe call followed by a restriction, which implicates the endpoint but does not prove the browser is safe.
- Assumption: the session/login phase is not itself the detection trigger. Explicitly deferred to research.
- The extraction mechanism is settled as capture-both (FR-2); which route yields posts is unverified offline and does not block the build.
- The behavioral layer (jittered ticks, working hours, 5 surfaces, daily budget) is treated as settled and carries over; only the transport and the pacing semantics change.
- `state/linkedin-posts.json` keeps exactly one writer (the PC loop) and the hosted run keeps read-only access.

## Acceptance Criteria
- [ ] **FR-0 gate (blocks everything else):** `LINKEDIN_COOKIES_FILE` points at a freshly-harvested dedicated-account file, the old cookie path appears in no `.env`/config/docs, `watcher.config.json` holds exactly 5 linkedin surfaces, and the one-shot entry exits 1 naming the missing prerequisite when any gate item is unmet.
- [ ] `npm test` exits 0, with new tests asserting: the fetcher navigates to each surface's search URL and issues zero voyager-endpoint requests; posts are extracted from page data payloads; a checkpoint or login-wall page halts the leg and alarms once per episode, while a surface returning zero posts does not halt it; the daily budget counts page loads and stops the walk at the cap; the payload written passes `readPayloadPosts` validation unchanged.
- [ ] `npm run typecheck` and `npm run lint` exit 0.
- [ ] No file under `src/` or `scripts/` references the voyager endpoint, `LINKEDIN_TRANSPORT`, or curl-impersonate — verified by grep in CI or by review.
- [ ] A scripted dry-run tick (injected browser context, no network) shows: 5 search-page navigations, posts extracted, payload written, no endpoint call.
- [ ] The hosted watcher reads the new payload with no code change: `readPayloadPosts` returns `leg: "ok"` for a payload written by the browser leg.

## Recommended Approach
`src/linkedin-fetch.ts` is replaced in place (FR-6) with a browser walk modeled on `fetchSurfacesAuthenticated` (`src/fetch-threads.ts:304`), not `fetchSurfaces`, because LinkedIn requires a session: `ContextFactory` with a storageState path, the `ContextLike`/`PageLike` seam, the `navigator.webdriver` patch (`:63`), dynamic-import quarantine, pure parser exports plus one walk. Extraction captures both routes (FR-2). Wired into `scripts/fetch-linkedin.ts`'s `fetchTick` behind the existing deps injection, with `src/linkedin-voyager.ts`, the curl transport, the `request.newContext` transport, and `LINKEDIN_TRANSPORT` deleted. Pacing constants move from GET-spacing to page-load spacing inside the same module; the payload writer, halt latch, and daily budget ledger are reused as-is.

## Decisions

### Transport: browser walk, not endpoint
**Question**: Threads is a real Playwright browser walk. The existing `LINKEDIN_TRANSPORT=playwright` is `request.newContext` — an API call with browser cookies and no browser. Does "same as threads" mean building a new browser-walk fetcher?
**Recommended**: Yes — new browser walk
**Chosen**: Yes — new browser walk
**Rationale**: the endpoint is the restriction signal; an API-context call still hits it.

### Voyager code fate
**Question**: The endpoint is the restriction signal — flagged hours after ONE probe call. What happens to the voyager code (`src/linkedin-voyager.ts`, the curl-impersonate transport, the `request.newContext` transport)?
**Recommended**: Delete it entirely
**Chosen**: Delete it entirely
**Rationale**: nothing in the repo can re-flag the account by accident; the fallback is not worth a live path to the endpoint.

### Extraction source
**Question**: When the browser opens a LinkedIn search page, how should the fetcher get the posts out of it?
**Recommended**: Read page data like Threads
**Chosen**: Capture both routes — page JSON and intercepted responses (supersedes the original "read page data like Threads" answer)
**Rationale**: the Threads precedent is narrower than it first looked. `extractPosts(html: string)` regexes `<script type="application/json" data-sjs>` blobs out of rendered HTML (`src/extract.ts:12`, `:33`), and `fetchOne` feeds it `page.content()` after a hydration gate (`src/fetch-threads.ts:253-261`) — there is no response interception anywhere in the logged-out path. Whether LinkedIn's content-search page carries equivalent blobs is unverified, so the fetcher captures both: `page.content()` for embedded JSON, and `page.on("response")` for search-route JSON bodies (`src/fetch-threads.ts:100`, already used by `fetchSurfacesAuthenticated` at `:372`). The parser tries page JSON first and falls back to intercepted responses.

### Navigation
**Question**: The voyager endpoint is a search API. In the browser, the equivalent is a content-search results page. How should the fetcher get there for each surface?
**Recommended**: Open search URL directly
**Chosen**: Open search URL directly
**Rationale**: fewest moving parts, one page load per surface, same 5 surfaces as today.

### Browser mode
**Question**: Threads runs headless Chromium. LinkedIn is far more aggressive about detecting headless browsers. Which mode should the LinkedIn walk use?
**Recommended**: Headless, like Threads
**Chosen**: Headless, like Threads
**Rationale**: unattended operation on the PC; the headless-detection surface is accepted and noted as a risk.

### Pacing layer
**Question**: The current pacing layer spaces voyager GETs 5-15s apart. A browser walk loads whole pages, not GETs. What happens to that pacing layer?
**Recommended**: Re-derive for browser
**Chosen**: Re-derive for browser
**Rationale**: pacing must measure what the leg now does; a 5-15s gap between page loads is faster than a human browses.

### Behavioral layer status
**Question**: The humanlike layer from 2026-11-09 is already implemented on this branch. You got restricted anyway. Is that layer exhausted?
**Recommended**: Exhausted — swap transport
**Chosen**: Not exhausted — "i dont think so, i just run once, the probe then few hours later get restricted"
**Rationale**: the restriction followed a single probe call, not sustained loop traffic, so the behavioral layer is not implicated. Its cadence, working-hours window, surface count, and daily budget carry over; only the pacing unit is re-derived for page loads (see the Pacing layer decision and FR-9).

### Payload envelope
**Question**: After the migration, your PC still saves posts to `state/linkedin-posts.json`. Should the file keep the exact same shape?
**Recommended**: Same file, same shape
**Chosen**: Same file, same shape
**Rationale**: the hosted reader and the digest need zero changes.

### Failure policy
**Question**: The browser walk opens a LinkedIn page and finds a security checkpoint or a login wall instead of search results. What should happen?
**Recommended**: Halt the leg, alarm once
**Chosen**: Halt the leg, alarm once
**Rationale**: a checkpoint is the strongest warning; repeated hits on a flagged account escalate the restriction. Zero posts is deliberately excluded from the halt trigger — a quiet day is not a warning, and halting on it would take the digest dark for no reason.

### Daily budget
**Question**: The leg currently hard-stops at 150 voyager GETs per day. Should that budget survive the migration?
**Recommended**: Keep it, count page loads
**Chosen**: Keep it, count page loads
**Rationale**: the cap still bounds a runaway loop; only the counted unit changes.

### Session / login strategy
**Question**: The browser walk needs a logged-in LinkedIn session. How should it get one?
**Recommended**: Reuse `scripts/login-linkedin.ts` (headed cookie harvest)
**Chosen**: Deferred — "i dont know, if linkedin detect bot from login phases. the beginning. need research for decisions"
**Rationale**: the developer cannot choose without knowing whether the login phase is itself a detection trigger.

## Open Questions
- **Session/login strategy** — whether LinkedIn detects automation at the login phase, and therefore whether to reuse `scripts/login-linkedin.ts` cookie harvest, run a headed browser each tick, or adopt a persistent browser profile. `research` must answer this before design; the fetcher's session seam depends on the answer.
- **Headless detectability** — whether headless Chromium is materially safer than the voyager endpoint for this account, or whether the headed/persistent-profile options are required. The developer chose headless on the Threads precedent, but LinkedIn's headless detection is more aggressive than Threads'.
- **Extraction feasibility — settled as capture-both; verification still open.** The fetcher captures both routes in one walk and the parser tries both (FR-2), so this no longer gates the build. What remains open is which route actually yields posts, answerable only by a live page load. No saved capture exists to answer it offline: the only HTML in the repo is the Threads fixture `tests/fixture/tag-page.html`; `tests/fixture/voyager-search-response.json` is an endpoint fixture, not a rendered page; `.rpiv/tmp/` is empty; and `linkedin-reverse/DOCUMENTATION.md` documents the Android API, not the page. Research must NOT treat this as blocking.

## Suggested Follow-ups
- `src/linkedin-session.ts` resolves the cookie file and synthesizes the Playwright storageState for the deleted transport. The browser walk still needs a session, so this module survives only if research picks the cookie-harvest strategy — otherwise it is rewritten or removed.
- `src/linkedin-behavior.ts` holds the working-hours window (`WINDOW_START_HOUR`/`WINDOW_END_HOUR`, `isWithinWorkingHours`), the wake jitter (`WAKE_MIN_MS`/`WAKE_MAX_MS`, `sampleTickDelayMs`), the daily budget (`DAILY_GET_BUDGET`, `budgetAllows`, `budgetReserve`), and the halt reasons (`HALT_RATE_LIMIT_REASON`, `HALT_BUDGET_REASON`). All of it carries over unchanged — it never touched the transport. The pacing constants are NOT here: `PACE_MIN_MS`/`PACE_MAX_MS` live in `src/linkedin-fetch.ts:67`/`:74` and are re-derived for page loads.
- The `LINKEDIN_TRANSPORT` env var, `CURL_IMPERSONATE_PROFILE`, and the `BROWSER_UA` constant (`src/linkedin-fetch.ts:91`, `:100`) all become dead once the transports are deleted — confirm nothing outside `src/linkedin-fetch.ts` and `scripts/` reads them.
- `scripts/setup-curl-impersonate.ts` and `npm run setup-curl` exist only to serve the curl transport; deleting the transport orphans the script and its `.env` line.
- `scripts/probe-linkedin.ts` gates the voyager transport; it needs a browser-walk equivalent or removal.
- Documentation goes stale: `.rpiv/guidance/src/architecture.md` (the `linkedin-*.ts` section documents the voyager leg and the curl profile) and the README's "The LinkedIn leg on your PC (voyager)" section (`README.md:278`) both describe the deleted transport.

## References
- Input: free-text feature description (2026-11-10)
- Prior FRD: `.rpiv/artifacts/discover/2026-11-09_17-29-56_linkedin-humanlike-fetch-behavior.md`
- Prior design: `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` (D2 transport decision, D5/D7/D13 payload + leg-dead)
- Codebase: `src/fetch-threads.ts`, `src/extract.ts`, `src/threads-session.ts`, `src/linkedin-fetch.ts`, `src/linkedin-payload.ts`, `scripts/fetch-linkedin.ts`, `scripts/login-linkedin.ts`
- Read in full before this revision: `src/extract.ts` (embedded `data-sjs` JSON, `extractPosts(html: string)`), `src/fetch-threads.ts` (`ContextLike`/`PageLike` seam, `fetchSurfacesAuthenticated` at `:304`)
