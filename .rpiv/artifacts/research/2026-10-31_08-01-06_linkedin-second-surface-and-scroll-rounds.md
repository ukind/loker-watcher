---
date: 2026-10-31T08:01:06+0700
author: Yogiswara Utama
commit: b92fa9f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn second surface + configurable scroll"
tags: [research, codebase, config-file, fetch-threads, threads-session, linkedin, scroll-rounds, platform]
status: ready
last_updated: 2026-10-31T08:01:06+0700
last_updated_by: Yogiswara Utama
---

# Research: LinkedIn second surface + configurable scroll

## Research Question
Chain from `.rpiv/artifacts/discover/2026-10-31_07-45-40_linkedin-second-surface.md`: how does a `linkedin` keywords surface enter the config, ride the acquisition seam, get extracted, judged, and emailed beside Threads — and how does a validated `scrollRounds` key thread into the scroll loop — without breaking the byte-identical Threads-only acceptance?

## Summary
The config spine takes both changes with surgical edits: the linkedin branch slots into the `readSurfaces` type whitelist (`src/config-file.ts:137-141`), the existing value gate (`:142-143`) already covers it, and `scrollRounds` copies the `reasoningEffort` optional-with-default validator shape (`:172-188`). `resolveSurfaces` gains a third arm using `encodeURIComponent` (reproduces the developer's example URL byte-for-byte). The acquisition seam's core problem is type erasure: `ResolvedSurface` (`src/config-file.ts:17-21`) carries only label/url, so dispatch today sniffs the `tag/` label prefix (`src/fetch-threads.ts:180-182`); the design must choose a carried discriminant or a label convention. `MAX_SCROLL_ROUNDS` has exactly one consumer (loop bound, `src/fetch-threads.ts:394`), so a trailing optional options parameter keeps all 12 call sites green. The widest blast radius is judge wording: "Judge each Threads post below" is a control-flow string matched by 7 mock-fetch doubles across 3 suites.

**Live capture (2026-10-31, managed session, Playwright chromium with cookies lifted from the pire-browser managed profile)** confirmed the external half: content search requires a logged-in session; results ride POST /flagship-web/search/results/content/ + POST /flagship-web/rsc-action/actions/pagination?sduiid=com.linkedin.sdui.search.contentSearchResults (RSC/SDUI stream — no voyagerSearchDashClusters for content); post ids are urn:li:activity:<19-digit> (585 urn-form hits plus bare activityId strings in one payload); timestamps are NOT in the body — they derive from the id: (BigInt(id) >> 22n) = epoch ms, verified on two ids; permalinks are constructible as https://www.linkedin.com/feed/update/urn:li:activity:<id> (zero links in bodies); sortBy=["date_posted"] and datePosted=["past-24h"] are structured server-side arguments in the pagination payload (count: 3 posts/page, startIndex paging, per-query searchId); LinkedIn renders inside a nested frame where window.scrollTo/body scroll is a no-op — the walker needs page.mouse.wheel (validated: it drives pagination) or an in-frame scroll. Mid-capture, the session was invalidated server-side and the developer had to log in manually — LinkedIn sessions are stricter and shorter-lived than Threads; the auth design must treat session expiry as a normal, recurring event.

### Config validation (FRD FR#1, FR#4)
- The Surface union (`src/config-file.ts:14`) is a 2-arm discriminated union; widening to add a linkedin arm must move the whitelist condition (`:137-141`), the error message, and `resolveSurfaces` together — the literal-guard chain is what narrows type for the push at `:160`.
- The value gate `src/config-file.ts:142-143` (non-empty string, path + key in the error) already serves the linkedin entry with zero new code. The threads-host pin `:145-158` is url-arm-only, so `tests/config-file.test.ts:88-94` (non-threads URL rejection) stays green untouched.
- `scrollRounds` joins ALLOWED_KEYS (`src/config-file.ts:36-42`) + WatcherConfig (`:28-34`). Validator precedents: readReasoningEffort has the undefined-to-default arm (`:173-175`) and the fail-visible rejection shape with JSON.stringify(value) (`:176-179`, pinned at `tests/config-file.test.ts:121-129`); readRecencyHours (`:165-170`) is the numeric sibling but accepts 72.5 and floors — scrollRounds must be stricter (Number.isInteger, >= 1) because flooring a walk length silently changes operator intent.
- Wiring point: beside `:92`, added to the return at `:95`. Importing MAX_SCROLL_ROUNDS from fetch-threads into config-file is runtime-safe: fetch-threads imports ResolvedSurface type-only (`src/fetch-threads.ts:22`) and Playwright is a dynamic import inside the factory (`:128-129`).
- The unknown-key error message renders ALLOWED_KEYS.join(", ") (`:84`), so whitelist and message cannot drift.

### URL construction (FRD FR#2, FR#3)
- `resolveSurfaces` (`src/config-file.ts:191-197`) maps to {label, url}; bytes are never transformed downstream — page.goto(surface.url) verbatim at `src/fetch-threads.ts:235` (logged-out) and `:354` (authenticated).
- LinkedIn arm: encodeURIComponent(value) yields keywords=%23hiring%20engineer%20developer%20jakarta — byte-identical to the example. URLSearchParams would emit + for spaces (mismatch); encodeURI leaves # unencoded (the fragment would truncate the query at page.goto).
- Label linkedin/<value> mirrors tag/<value> (`:194`). The prefix is load-bearing: isTagSurface (`src/fetch-threads.ts:180-182`) dispatches on the tag/ prefix; a linkedin/ label falls into the "no Recent tab — the URL selects its own view" branch (`:386`) exactly like url surfaces today.
- **Live correction (developer, mid-research)**: the watched URL gains sortBy=%5B%22date_posted%22%5D (newest-first). Capture confirmed it is a server-side facet: the pagination payload carries "sortBy":["date_posted"],"datePosted":["past-24h"] as structured arguments, and the UI rendered the Latest / Past-24-hours chips from the URL alone. The URL builder should append origin=FACETED_SEARCH, sortBy, and datePosted.
- Recency interplay: the 24h URL facet is advisory; filterRecent (`src/recency.ts:13-22`) re-filters post-fetch and **silently drops** posts whose timestamp is missing/garbage (new Date(x) to NaN, dropped at `src/index.ts:171`). The LinkedIn normalizer must emit ISO 8601 UTC — the Threads precedent is new Date(takenAt * 1000).toISOString() (`src/extract.ts:110`). Capture-derived LinkedIn timestamps satisfy this via new Date(Number(BigInt(id) >> 22n)).toISOString().

### Acquisition seam, dispatch, and failure semantics (FRD FR#8)
- Type erasure chain: typed Surface → resolveSurfaces (`src/config-file.ts:190-197`) → opaque ResolvedSurface[] at `src/index.ts:144`. After that, the label string is the only type signal.
- The acquisition stage (`src/index.ts:150-165`) resolves ONE session (`resolveSession`, `:151`), branches fetchSurfacesAuthenticated vs fetchLoggedOutPosts on a single boolean (`:153-155`), and pairs cleanupSessionDir in finally (`:156-163`). Walk granularity and session granularity are fused in that boolean — any per-platform session split de-fuses it.
- fetchSurfacesAuthenticated (`src/fetch-threads.ts:275-320`) builds ONE cookie-bearing context before the pool (`:280`), drains the mixed list through runPool (`:287`, width FETCH_CONCURRENCY=4 at `:40`), and tolerates per-surface failures via caller-owned side arrays (failures `:283`/`:298`, emptyLabels `:284`/`:294`); the all-fail predicate is results.length === 0 (`:304`) — measured in posts, so it is already implicitly cross-platform. A LinkedIn surface inside the same pool inherits isolation for free; a second pool/allSettled merge would have to relocate the all-fail predicate to `src/index.ts:167`.
- ContextFactory is (storageStatePath?: string) => Promise<ContextLike> (`src/fetch-threads.ts:113-117`); chromiumContextFactory (`:120-135`) applies Threads-oriented hardening (UA `:59-60`, WEBDRIVER_PATCH `:70-71`). A second platform needs either a platform-aware factory signature or a second WatcherDeps field. Test doubles (`tests/fetch-threads.test.ts:85-104` fakeContextFactory, ~17 uses; `tests/index.test.ts:96` singlePageContextFactory, 6 uses) pass zero args — any new REQUIRED parameter breaks them all; optional keeps them compiling.
- Dispatch options: (a) carried platform discriminant on ResolvedSurface — type-safe at the worker, pairs with Post.platform; (b) linkedin/ label sniff — zero type changes, extends the isTagSurface precedent but rides a log-string; (c) second pool — fights the FRD and doubles context lifecycle. Unresolved (see Open Questions).

### Session/auth (FRD Open Question 1, capture- and incident-informed)
- The Threads contract: resolveSession (`src/threads-session.ts:28-52`) reads ENV_NAMES.threadsSession (`src/config.ts:14-17`), base64-decodes a storageState, shape-checks (`:17-21`), returns null on absent/invalid so callers fall back to logged-out with a warn. A missing secret is NOT an error.
- Live capture: content search is logged-in-only (2026 sources unanimous: anonymous hits the /authwall/ redirect). The managed profile's session rendered results; Playwright chromium with ONLY the lifted cookies (li_at + 22 others) also rendered results — cookie-only session lift is sufficient, matching the storageState model.
- **Incident (2026-10-31, mid-capture)**: the session was invalidated server-side mid-run (sudden logout; manual re-login required). LinkedIn sessions are stricter and shorter-lived than Threads — expiry is a normal recurring event, not an anomaly. Design consequences: (1) session material travels as an env/GitHub-Actions SECRET, refreshed by the operator when it dies — the developer explicitly directed credentials in env / GitHub Actions variables; the repo-doctrine fit is a base64 storageState secret (LINKEDIN_SESSION_STATE) mirroring THREADS_SESSION_STATE, NOT username/password automation (public sources consistently report automated credential login as the most-challenged, most-restricted pattern: CAPTCHAs, checkpoints, account restriction); (2) a dead session must degrade gracefully — LinkedIn surfaces warn and yield zero posts (the emptyLabels channel at `src/fetch-threads.ts:294`/`:306-312` already provides the diagnostic) while Threads results still flow; (3) session freshness should be observable — a zero-post LinkedIn run beside a live Threads run is the logout signature in the heartbeat.

### Scroll threading (FRD FR#4)
- MAX_SCROLL_ROUNDS = 8 (`src/fetch-threads.ts:44`) consumers: the definition, the loop bound at `:394`, and a doc comment (`:52`). Nothing else — not exported. Sibling constants (SCROLL_MIN_GAIN:45, MAX_POSTS_PER_SURFACE:46 — which ALSO gates the XHR listener at `:334` — SCROLL_SETTLE_MS:48, XHR_DRAIN_MS:49, MAX_DRY_SCROLL_ROUNDS:57) are Non-Goal-frozen and uncoupled.
- Threading shape: a 4th optional trailing parameter options = { scrollRounds?: number } on fetchSurfacesAuthenticated (current signature `:275-279`), defaulted once at the boundary with ?? MAX_SCROLL_ROUNDS, passed down as a required scalar into fetchOneAuthenticated (`:323`, private, 1 caller). This keeps the 1 production call site (`src/index.ts:154`) and 11 test call sites (`tests/fetch-threads.test.ts:242-460`) compiling untouched — which is precisely the byte-identical-when-absent acceptance.
- Offline oracle: the fake page counts one page.evaluate call per round and fires that round's staged graphql body (`tests/fetch-threads.test.ts:152-158`). Existing pins: dry-stop asserts evaluate.calls === 3 (`:317`), ceiling asserts 8 (`:345`), cap asserts 1 (`:363`). New scrollRounds:5 pin: continuously-gaining feed, assert 5. Caveat: scrollRounds 0 changes the cap pin's semantics (loop never runs) — parameterized cap variants must pin >= 1.
- **Live scroll mechanics (design input)**: LinkedIn's search app renders inside a nested frame (pire-browser shows the app under a child frame; the main-document body is 74px tall). window.scrollTo/body scroll is a no-op; pire-browser native scroll/keys could not reach the frame's scroller; **page.mouse.wheel(0, 2500) after page.mouse.move(600, 450) drove pagination reliably** in Playwright. The production walker needs a frame-aware scroll (mouse wheel at viewport coords over the results area, or an in-frame evaluate). Pagination responses arrive at ~3 posts per round ("count":3 in the payload), so a SCROLL_MIN_GAIN-style dry counter maps cleanly onto LinkedIn rounds.

### platform field propagation (FRD FR#5-7)
- Post (`src/types.ts:10-21`) gains required platform: "threads" | "linkedin". There is ONE Threads minting site: normalizeThreadItem's literal (`src/extract.ts:105-111`), covering both collection paths (logged-out extractPosts `:36-67`, and the authenticated XHR interception at `src/fetch-threads.ts:333-350` — the XHR collector lives in fetch-threads, not extract). tsc then forces every producer to stamp and gives every consumer the field for free (JudgedPost `src/judge.ts:173-176` carries the whole Post; `src/index.ts:220-222` passes references to the digest).
- Judge prompts: single-post `src/judge.ts:238` and bulk `:265` say "Threads post" verbatim. Batches CAN mix platforms (candidates are one merged, deduped, recency-filtered list — `src/index.ts:166-192` → batches sliced at `src/judge.ts:696-697`), so the bulk lead-in is per-batch and cannot truthfully say "Threads" for mixed batches. Per-post listing lines (`:255-257`) have post.platform in scope.
- **The coupling that matters**: "Judge each Threads post below" is matched by mock-fetch doubles that route bulk vs single calls — `tests/judge.test.ts:153`, `:445`, `:483`; `tests/index.test.ts:140`, `:162`; `tests/judge-rotation.test.ts:331`, `:594`. Rewording `:265` unconditionally requires lockstep edits in all 7 sites across 3 suites, or those suites silently degrade every bulk batch to the single-post fallback path.
- Digest: subject buildSubject (`src/email.ts:54-59`, literal at `:58`) — pinned at `tests/email.test.ts:30`, `:57`, `:79`, `:105`, AND `:234` (sendDigest transport capture — a 5th pin beyond the FRD's named ranges). Item lines `:69-72` render text/author/permalink only. The consistent conditional scheme: per-line platform token iff post.platform !== "threads"; subject stays verbatim for all-Threads and switches only when LinkedIn matches are present. Heartbeat needs NO change (subject `src/heartbeat.ts:100-102` is platform-neutral; body lines `:128-135` carry no "Threads" literal outside permalinks).
- Shared Post fixtures needing a mechanical platform "threads" line: `tests/judge-helpers.ts:31-38` (feeds all judge suites), `tests/state.test.ts:38-45`, `tests/heartbeat.test.ts:23-32`, `tests/recency.test.ts:8-17`, plus 6 inline literals in `tests/email.test.ts` (`:21`, `:34`, `:67`, `:86`, `:119`, `:186`). tests/extract.test.ts constructs zero Post literals — untouched.

### Id namespace (FRD Suggested Follow-up 3)
- State is fully platform-blind: seenPostIds Record of string (`src/state.ts:25`), v2 keys never validated (`:97-101`), v1 accepts any non-empty string (`:79-82`), diffNew/diffNewIds are raw string membership (`:166-188`), persistJudged maps ids verbatim (`src/index.ts:277`). No schema change needed for any id shape.
- The ONLY collision point is dedupePosts (`src/index.ts:299-308`, first-seen-wins on raw post.id).
- **Capture settles the shape**: post ids are urn:li:activity:<19-digit> (585 urn-form occurrences in one pagination payload; bare activityId digit-strings also present, associated per post via threadUrn.threadUrnActivityThreadUrn.activityUrn.activityId, with a sibling rootUrn urn:li:share:<id> — activity and share ids DIFFER for the same post, so the extractor must canonicalize on activity or it will double-count). 19-digit digit-strings are the same magnitude as Threads pks — stripping to digits WOULD risk real collisions in dedupePosts. Keeping the full urn (colons present) or a linkedin: prefix makes collision structurally impossible. Recommendation: keep the full urn raw (zero code, structural safety); design may prefer the prefix for state-file readability. Design-gate decision.

### LinkedIn live capture — extraction path (FRD mandatory research task)
- Auth: session cookies (li_at session bearer + JSESSIONID CSRF + bcookie/bscookie/lidc) injected into Playwright chromium via addCookies — lifted from a Firefox cookies.sqlite (expiry stored in MILLISECONDS; Playwright wants SECONDS). Results rendered immediately. storageState equivalence confirmed in practice.
- Transport: POST https://www.linkedin.com/flagship-web/search/results/content/?keywords=...&origin=FACETED_SEARCH (initial, 1.4-1.5 MB RSC/SDUI stream) and POST /flagship-web/rsc-action/actions/pagination?sduiid=com.linkedin.sdui.search.contentSearchResults (per scroll page). Captured request body: pagerId com.linkedin.sdui.search.contentSearchResults; clientArguments.payload with startIndex, keywords, count:3, sortBy:["date_posted"], datePosted:["past-24h"], spellCheckEnabled, clusterStartPosition, searchId (per-query uuid); paginationRequest envelope. Both facets are applied SERVER-SIDE.
- Response: RSC flight-style stream. Per post: threadUrn.threadUrnActivityThreadUrn.activityUrn.activityId (bare digit string) + rootUrn urn:li:share:<id>; state keys keyed by reactionState-urn:li:activity:<id>; post text in React textProps.children arrays (nested strong/br nodes); author in aria-label ("<name> Verified Profile 2nd"-style); relative time only ("6h — Edited"); ZERO /feed/update/ links and zero urns in the DOM (jay-reach Oct-2026 finding reproduced live).
- Timestamp: absent from responses; BigInt("7522028760582447104") >> 22n = 1793391409059 ms = 2026-10-30T20:16:49Z (matches the rendered "6h"); verified on a second id. The extractor derives Post.timestamp from the id.
- Permalink: construct https://www.linkedin.com/feed/update/urn:li:activity:<id> (canonical form; nothing link-shaped exists in the payload).
- Interception: plain page.on("response") + response.text() captured everything — the same seam the Threads walk already uses (`src/fetch-threads.ts:333-350`).
- Volume: ~3 posts per pagination round; the watcher URL's past-24h+keywords set paginated only a few rounds; generic #hiring sustained 10+ rounds. Scroll-driven lazy loading is gated on result-set size (developer's theory, confirmed live).

### Test-suite impact map (acceptance criterion 1)
- Extend: tests/config-file.test.ts (linkedin accepts; linkedin empty/non-string value; unknown-type still rejects; example-URL assertion beside the :152-155 encoding pin; scrollRounds "five"/5.5/0 rejections + default-8 acceptance), tests/fetch-threads.test.ts (scrollRounds:5 variant beside :299-346), tests/judge.test.ts (linkedin-post prompt contains no "Threads post", in the :682-689 style), tests/email.test.ts (mixed-platform subject/digest pins), tests/index.test.ts (mixed-surface run through WatcherDeps; context double needs URL-dispatching bodies — pattern exists at tests/fetch-threads.test.ts:116-118 xhrBySubstring).
- Lockstep if judge wording changes unconditionally: tests/judge.test.ts + tests/index.test.ts + tests/judge-rotation.test.ts (7 dispatch strings).
- Untouched for byte-identical Threads-only: tests/extract.test.ts, tests/session.test.ts, tests/recency.test.ts, tests/heartbeat.test.ts, tests/state.test.ts (fixture line only).

## Code References
- `src/config-file.ts:14` Surface union; `:17-21` ResolvedSurface (erasure point); `:28-42` WatcherConfig + ALLOWED_KEYS
- `src/config-file.ts:120-163` readSurfaces gates; `:165-188` validator precedents; `:190-202` resolveSurfaces + tagPageUrlFor
- `src/index.ts:100-121` WatcherDeps; `:144-168` surfaces + acquisition + dedupe merge; `:271-281` persistJudged; `:283-308` logged-out path + dedupePosts (collision :303)
- `src/fetch-threads.ts:40-57` tuning constants; `:113-135` ContextFactory; `:175-182` isTagSurface; `:275-320` authenticated walker; `:322-350` XHR interception; `:393-410` scroll loop (dry :404, cap :409, ceiling :394)
- `src/threads-session.ts:17-52` storageState check + resolveSession
- `src/extract.ts:105-111` Post minting site; `src/types.ts:10-21` Post interface
- `src/judge.ts:227-268` prompts (:238 single, :265 bulk); `src/email.ts:54-75` subject (:58) + items (:69-72)
- `src/heartbeat.ts:100-142` platform-neutral subject + candidate lines
- `src/recency.ts:13-24` filterRecent (silent NaN drop :21-22)
- `src/state.ts:25`, `:57-107`, `:166-188`, `:241-271` state mechanics
- `tests/fetch-threads.test.ts:85-104`, `:152-158`, `:299-364` oracle + pins; `tests/config-file.test.ts:54-156` config pins
- `tests/email.test.ts:30`, `:57`, `:79`, `:105`, `:234` five subject pins
- `tests/judge.test.ts:153,445,483`; `tests/index.test.ts:140,162`; `tests/judge-rotation.test.ts:331,594` bulk-dispatch strings
- `.rpiv/tmp/pw/body-*.txt` — 11 captured response bodies (ephemeral capture evidence)

## Integration Points

### Inbound References
- `src/index.ts:144-145` — runWatcher resolves surfaces and logs labels
- `src/index.ts:154-155` — the acquisition branch (only production caller of both walkers)
- `watcher.config.json:20-31` — operator surfaces (3 tag + 6 url entries, recencyHours 72)
- `.github/workflows/watch.yml` — cron to npx tsx src/index.ts, then state commit-back (any new session secret maps here)

### Outbound Dependencies
- `src/config-file.ts:11` — CONFIG_PATH from config.ts; ENV_NAMES (`src/config.ts:14-21`) for any new session var
- `src/pool.ts:29-45` — runPool (worker-total contract, :15-27)
- Playwright dynamic import (`src/fetch-threads.ts:128`) — the only browser entry; the LinkedIn walker must reuse it

### Infrastructure Wiring
- `.github/workflows/watch.yml` — secret mapping for LINKEDIN_SESSION_STATE (if adopted) beside THREADS_SESSION_STATE
- pire-browser managed profile (%LOCALAPPDATA%/pire-browser/firefox-profiles/Default) — capture harness only, not production

## Architecture Insights
- **Config-file is a closed set with drift-proof errors**: whitelist array, message, and union must move in one commit; the error formula is: module, file, key, fault, allowed values.
- **resolveSurfaces is a one-way type erasure**: everything platform-specific after it negotiates through the label string. The isTagSurface doc comment (`src/fetch-threads.ts:176-179`) already concedes this is a workaround — the linkedin design either accepts a second stringly dispatch or undoes the erasure with a carried discriminant.
- **The scroll loop's three exits are independently observable** (dry :404, cap :409, ceiling :394) — pins exist for each; a threaded ceiling must not perturb the other two.
- **Side-array failure discipline makes mixed-platform pooling free**: tolerate-any-survivor + all-fail-with-diagnostics already yields "a LinkedIn failure never discards Threads results" if LinkedIn stays inside the same pool.
- **One Post minting site per platform** + tsc-enforced required platform gives compile-time producer completeness; consumers get the field by reference without plumbing.
- **Prompt prose is control flow in tests**: any wording change to the bulk lead-in is a 3-suite lockstep edit or the mocks silently reroute bulk calls to the single-post path.
- **External capture lessons**: LinkedIn search ids encode creation ms in the top bits (id >> 22); responses carry no permalinks (construct from the urn); the DOM carries no ids at all (network-only extraction); the app runs in a nested frame (body scroll no-op — use page.mouse.wheel); sessions are cookie-portable across browsers but are revoked server-side more aggressively than Threads — expiry is routine, not exceptional.

## Precedents & Lessons
4 similar past changes analyzed.

### Precedent: url surface type added to config
**Commit(s)**: b050436 — "feat: json config as source of truth with url surfaces" (2026-10-25)
**Blast radius**: 12 files across src + tests + workflow + README (+588/-199): src/config-file.ts (new, 195 lines), src/fetch-threads.ts, src/index.ts, src/heartbeat.ts, src/keywords.ts, watcher.config.json, tests/config-file.test.ts (+140)
**Takeaway**: a new surface type is a cross-cutting ~10-file change; budget the test suite as first-class surface area, not an afterthought.

### Precedent: optional config key with default
**Commit(s)**: d8fc15b — "feat: add a reasoning effort knob for the llm judge" (2026-10-27)
**Blast radius**: 7 files (+180/-6): validator in config-file.ts, wiring in index.ts (2 lines), judge.ts, tests (+22 config, +112 judge)
**Takeaway**: the optional-key pattern (undefined-to-default, fail-visible otherwise) is cheap and well-pinned — scrollRounds should clone it exactly.

### Precedent: session secret env + authenticated walk
**Commit(s)**: 9e1c8ef — "feat: authenticated threads fetch with recency cutoff" (2026-10-25)
**Blast radius**: 12 files (+501/-34): new threads-session.ts, fetch-threads.ts +180, new session.test.ts + recency.ts
**Follow-up fixes**: 93a3f38 — "feat: cut watch runtime with judge/fetch pools, state v2, and an 8-minute budget" (2026-10-27, +1729/-214) — the first real runs of the authenticated walk forced a major retune; the tuning-block comment at `src/fetch-threads.ts:51-55` records the "validation blocker" revision.
**Takeaway**: expect a validation-driven revision commit after the first live LinkedIn runs; do not over-tune constants before a real capture.

### Composite Lessons
- Surface-type and session additions each landed as one feature commit with tests in the same commit (b050436, 9e1c8ef) — keep the linkedin feature single-commit-shaped.
- Optional knobs are additive and low-risk (d8fc15b); hard-coded tuning that later needed re-tuning cost 1.7k lines (93a3f38) — scrollRounds as a knob is the doctrine-correct shape.
- Extend the doc-comment convention at `src/fetch-threads.ts:51-55` (measured-date tuning blocks) to whatever the LinkedIn walk measures.

## Historical Context (from .rpiv/artifacts/)
- `.rpiv/artifacts/discover/2026-10-31_07-45-40_linkedin-second-surface.md` — FRD: goals, FRs, decisions, open questions (source of truth for intent)
- `.rpiv/guidance/src/architecture.md` — pipeline stages, funnel gates, DI seams
- `.rpiv/guidance/tests/architecture.md` — offline test conventions
- `.rpiv/guidance/.github/workflows/architecture.md` — secret mapping
- `.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md` — original pipeline design
- `.rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md` — original plan

## Developer Context
**Q (discover: Foundational intent): What problem does adding LinkedIn solve, and who hits it today?**
A: "add new supported website: linkedin. beside threads" (verbatim).

**Q (discover: Sharpened intent): What does watching LinkedIn add that Threads alone does not?**
A: "Second net, same goal" — same pipeline, same digest.

**Q (discover: Surface entry type): How should a LinkedIn surface enter watcher.config.json?**
A: linkedin type (keywords string); platform-specific auth and extraction beat URL flexibility.

**Q (discover: Scroll configurability): How far should scroll configurability go?**
A: One key scrollRounds, default 8 — the single deliberate doctrine exception.

**Q (discover: Platform field on Post): Should posts become platform-tagged?**
A: Yes — platform "threads" or "linkedin" for digest legibility.

**Q (discover: Capture timing): Run the pire-browser capture in-session or hand to research?**
A: Capture is a mandatory research task ("the idea is this linkedin watcher is running the same mechanism as existing idea"). Executed in research — see Detailed Findings, LinkedIn live capture.

**Q (discover: LinkedIn fetch window): How should the fetch window relate to recencyHours?**
A: Hard-code 24h via the datePosted facet; recencyHours still filters post-fetch.

**Q (mid-research, developer): The watched URL gains sortBy.**
A: Accepted — sortBy=%5B%22date_posted%22%5D joins the URL builder (live-verified server-side facet; FRD FR#2 amended accordingly).

**Q (src/state.ts:97-101, src/index.ts:299-308): What id form does the LinkedIn provider mint?**
A (capture-answered): ids are urn:li:activity:<19-digit>; bare digits would collide-candidate with Threads pks. Keep the full urn (or linkedin: prefix at design gate) — never strip to digits.

**Q (live incident, developer): The LinkedIn session logged out mid-research; manual re-login was required. Developer direction: credentials in env or GitHub Actions env variables.**
A: Recorded. The credential that travels in env/GHA secrets is the SESSION (base64 storageState, LINKEDIN_SESSION_STATE mirroring THREADS_SESSION_STATE) — not username/password: automated credential login is the most-challenged, most-restricted pattern per 2026 public sources. Session expiry is routine for LinkedIn; the design must include an operator refresh loop and graceful zero-post degradation when the session dies.

## Related Research
- (none — first research artifact for this feature)

## Open Questions
- **Dispatch mechanism** — carried platform discriminant on ResolvedSurface (recommended: type-safe, pairs with Post.platform) vs linkedin/ label sniff (mirrors isTagSurface). Decide at design.
- **Judge wording** — conditional (all-Threads batches keep "Judge each Threads post below" verbatim; mixed batches neutral; recommended: zero test-dispatch edits) vs platform-neutral everywhere (7 mock sites across 3 suites need lockstep edits). Decide at design.
- **Auth contract** — optional parallel LINKEDIN_SESSION_STATE (recommended: absent means LinkedIn surfaces warn + yield 0 posts, matching the lenient Threads contract; developer direction points at env/GHA-secret storage) vs required-env fail-fast vs automated password login (discouraged: challenge/restriction risk). Also: whether LinkedIn gets its own gentler cron (public guidance suggests 1 pass/day suffices with the past-24h facet; current cron is every 10 minutes). Decide at design.
- **Id prefix** — raw urn:li:activity:<n> (recommended: zero code, colons make Threads collisions structurally impossible) vs linkedin:-prefixed (state-file readability). Design gate.
- **LinkedIn scroll pacing / FETCH_CONCURRENCY** — the existing FETCH_CONCURRENCY=4 and SCROLL_SETTLE_MS=2500 are unmeasured against LinkedIn's bot detection (public reports: ~250 requests/day/account, 999-status rate limiting, scroll pacing 2-12s). Follow the probe precedent (scripts/probe-judge.ts) only if LinkedIn volume justifies it; doctrine says otherwise hard-code.
- **RSC field layout hardening** — the flight-stream text/author extraction (React children arrays, aria-labels) is documented here from one capture session; the implement stage should pin the parser against the 11 saved body files (.rpiv/tmp/pw/body-*.txt) and a fresh capture, since LinkedIn rotates this markup without notice.
