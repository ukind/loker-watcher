---
date: 2026-11-11T07:17:47+0700
author: Yogiswara Utama
commit: 1cd0f47
branch: ukind/feature-migrate-using-browser-approach
repository: feature-migrate-using-browser-approach
topic: "linkedin-browser-walk-migration"
confidence: high
complexity: high
status: ready
verdict: pass
tags: [solutions, linkedin-fetch, linkedin-voyager, linkedin-session, linkedin-payload, linkedin-behavior, fetch-threads, extract, playwright]
last_updated: 2026-11-11T07:55:00+0700
last_updated_by: Yogiswara Utama
last_updated_note: "capture extracted to .rpiv/tmp (1.53 MB); offline run matches browser run; payload round-trip zero drops, leg ok"
---

# Solution Analysis: LinkedIn browser-walk migration

**Date**: 2026-11-11T07:17:47+0700
**Author**: Yogiswara Utama
**Commit**: 1cd0f47
**Branch**: ukind/feature-migrate-using-browser-approach
**Repository**: feature-migrate-using-browser-approach

## Research Question

How does the LinkedIn leg migrate from a voyager-endpoint transport to a Playwright browser walk, in place in `src/linkedin-fetch.ts`?

## Summary

**Problem**: The voyager endpoint is the restriction signal. The leg must become a real browser walk, in place, with the halt latch, the daily budget, and the payload writer intact.
**Recommended**: Option 3 — Threads skeleton + recovered extraction
**Effort**: High (~15-20 files, ~+700/−900 lines; 3-5 working days)
**Confidence**: High (raised 2026-11-11T07:52:00 after the verification pass; see the follow-ups)

## Problem Statement

**Requirements:**

- FR-2: capture both extraction routes — page JSON and intercepted responses.
- FR-5 (humanlike FRD): shuffled surface order survives.
- FR-6: replace `src/linkedin-fetch.ts` in place. Delete `src/linkedin-voyager.ts`, the curl transport, the `request.newContext` transport, and `LINKEDIN_TRANSPORT`.
- FR-7: a security checkpoint or a login wall halts the leg and alarms once.
- FR-8: the daily budget survives, counted in page loads.
- FR-9: pacing re-derived for page loads. The results page is an infinite loader, so the unit is a scroll round bounded by the existing `scrollRounds` key (default 8).
- Session: the login phase is headed only. The walk consumes the harvested cookie session.
- Payload: same file, same shape (v2 envelope).

**Constraints:**

- Hard: the offline suite stays Playwright-free. Every Playwright import stays inside a function body (dynamic-import quarantine).
- Hard: state writes stay atomic. One writer per state file.
- Hard: fail visible. A dead session must halt, never degrade to zero posts.
- Hard: the strict TS flags stay on (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- Soft: no new runtime dependency.
- Soft: probe-measured values are committed data, not env knobs.

**Success criteria:**

- `npm run typecheck && npm run lint && npm test` green.
- The walk navigates to each surface's search URL and issues zero voyager-endpoint requests.
- A checkpoint or login wall trips the halt latch and sends one alarm.
- A zero-post surface is success, not a fault.
- The payload round-trips through `readPayloadPosts` with zero dropped rows.

## Current State

**Existing implementation:**

The LinkedIn leg is a voyager-endpoint transport inside `src/linkedin-fetch.ts`:

- `VoyagerResponse`/`VoyagerGet`/`Transport` (`:102-116`).
- `classifyFault`/`Fault`/`FaultKind` (`:196-285`). Its 3xx/403/401/400 branches are the current `legDead` source. Its 429 branch (`:244-247`) is the current `halt` source.
- `ExecFn`/`createCurlTransport` (`:287-389`), `createPlaywrightTransport` (`:391-437`), `resolveLinkedInTransport` (`:439-473`).
- `fetchLinkedInPosts` (`:512-627`) — the `runPool` walk skeleton, the FR-5 shuffle (`:522-535`), the pacing gate (`:475-493`), the halt/leg-dead/fault drain arms (`:586-605`), the join priority (`:612-620`), the stamp-at-slot-write (`:576-580`).

The tick is `scripts/fetch-linkedin.ts:382-489`. Its preflight band is window → latch → budget, before any git spawn, cookie read, or browser launch.

**Relevant patterns:**

- `runPool` slot arrays: `src/pool.ts:33-52` — used by 3 surface walks (`src/fetch-threads.ts:219`, `:320`, `src/linkedin-fetch.ts:543`) and 2 judge batch pools (`src/judge.ts:959`, `:1033`).
- Stamp-at-slot-write: `src/fetch-threads.ts:326-329` and `src/linkedin-fetch.ts:576-580` — the same three lines, duplicated verbatim.
- Tagged errors: name constant + factory + type guard (`src/linkedin-fetch.ts:116-192`). The guard compares the `name` string, so the block is a wire contract.
- Dynamic-import quarantine: 3 sites today — `src/fetch-threads.ts:131`, `src/linkedin-fetch.ts:393`, `scripts/login-linkedin.ts:126`.
- One writer per state file: payload, latch, budget ledger, episode marker — all repo-local siblings of `state/linkedin-posts.json`, all written atomically via `stateTempPath` + rename.
- Pacing gate as a per-walk closure, not module state (`src/linkedin-fetch.ts:470-473`).

**Integration points:**

- `scripts/fetch-linkedin.ts:49-58` — imports `LinkedinSurface`, `Transport`, `VoyagerGet`, `fetchLinkedInPosts`, `halt`, `isAllSurfacesFaulted`, `isHalt`, `isLegDead`, `resolveLinkedInTransport`. Three break.
- `scripts/fetch-linkedin.ts:96-97` — `transport?: Transport` dep key.
- `scripts/fetch-linkedin.ts:442-450` — the budget wrapper, riding `VoyagerGet`.
- `scripts/probe-linkedin.ts:19-24` — imports `resolveLinkedInTransport` and `{buildSearchUrl, parseSearchResponse}`. Cannot compile after the deletion.
- `scripts/watch-linkedin.ts:20` — imports `SleepFn`, `isLegDead`. Both survive.
- `src/index.ts:58` — type-only `LinkedinSurface`. Survives.
- `src/index.ts:300-308` — the hosted payload read and `linkedinLeg` build. Zero changes.
- `src/email.ts:139-142` — the leg line renders only when `status !== "ok"`. Zero changes.
- `src/config-file.ts:127-137` — `readScrollRounds`, the scroll bound the walk reuses.
- `src/config-file.ts:340-355` — `resolveSurfaces` throws on a linkedin surface.

## Solution Options

### Option 1: Threads-seam transplant

**How it works:**
Copy `fetchSurfacesAuthenticated`'s structure (`src/fetch-threads.ts:304-357`) into `src/linkedin-fetch.ts`: the five structural interfaces, `makeChromiumContextFactory`, the webdriver patch, the dynamic-import quarantine, the response-interception pattern, and the `runPool` slot-array reassembly. Write a new LinkedIn parser from scratch against the live page.

**Pros:**

- The seam exists and is copyable. `ContextFactory` (`src/fetch-threads.ts:118`) has 1 production consumer (`src/index.ts:37`) and 2 test suites; the `runPool` slot-array pattern has 5 call sites.
- The survivors are genuinely transport-agnostic: the tagged-error block, the payload writer (`src/linkedin-payload.ts:111-141`), the latch (`scripts/fetch-linkedin.ts:217-223`), and the budget machine (`src/linkedin-behavior.ts:82-137`) never touch the transport.
- `ResponseLike` (`src/fetch-threads.ts:76-81`) is exactly what the interception route needs — no type change for the capture half.

**Cons:**

- The parser has no offline oracle. `src/extract.ts` is Threads-shaped end to end (`SCRIPT_BLOB_RE` `:14`, `collectThreadItems` `:70-84`, `normalizeThreadItem` `:87-110`), so `extractPosts(linkedinHtml)` returns `[]` with **zero drops** — a silent empty payload. A from-scratch parser can only be verified by a live headed session.
- The copied structure lacks four things the LinkedIn leg needs: the FR-5 shuffle (`src/linkedin-fetch.ts:522-535`), the pacing gate (`:475-493`), a per-page-load budget seam, and a checkpoint detector.
- `PageLike` (`:90-104`) has no `url()`, no `title()`, and no `mouse`. The checkpoint detector and the wheel pagination both need seam growth.

**Complexity:** High (~3-5 days)
- Files to create: 0 (~0 lines)
- Files to modify: ~20-25 (~+1000-1400 / −2500-3000 lines)
- Risk level: High

### Option 2: Deleted-walk restoration

**How it works:**
Recover `68c1e2d:src/fetch-linkedin.ts` (338 lines) wholesale — the React Flight row parser, the wheel-driven pagination, the urn minting — and re-wire it into the current skeleton.

**Pros:**

- The parser half restores verbatim. `parseFlightRows`, `textFromChildren`, `mintPost`, and `collectLinkedInPosts` are 188 of 338 lines (**56%**, measured against the real `68c1e2d` file), pure `string → Post[]`, zero design work. Proven on live data 2026-11-11.
- The recovered output already satisfies `isValidRow` (`src/linkedin-payload.ts:88-109`) on every check: `platform`, the `ACTIVITY_URN_RE` id, non-empty `text`/`author`/`permalink`, a `Date.parse`-able timestamp, and absent `surfaces` (stamped at slot write).
- The interception route is live-proven. The 2026-11-01 plan follow-up records that the initial page and every scroll round stream through `/flagship-web/rsc-action/actions/pagination?sduiid=com.linkedin.sdui.search.contentSearchResults`, already in the walker's filter regex.
- 7 of the deleted suite's ~16 tests restore byte-identically (6 `collectLinkedInPosts` cases + 1 `parseFlightRows` case).

**Cons:**

- The walk half restores at 0%. Six blockers: the `ResolvedSurface` signature type is gone (`src/config-file.ts:24` narrows `platform` to `"threads"`; `:346-352` throws on linkedin); `page.mouse` does not exist on `PageLike` (TS2339); `page.url` does not exist either (second TS2339, and the `defb8af` empty-window fix depends on it); the walk throws plain `Error` where the contract demands tagged `legDead`/`halt`; it has no pool, pacing, shuffle, budget, or latch; it has no checkpoint detector.
- The session source is gone. The deleted walk consumed `LINKEDIN_SESSION_STATE` via `ENV_NAMES.linkedinSession` — an env name that no longer exists (`src/config.ts:14-23`). The surviving producer (`scripts/login-linkedin.ts`) writes a cookie pair, not a storageState.
- A wholesale restore loses FR-5. The shuffle lives in `fetchLinkedInPosts` (`:527-535`), not in the walk. Only a graft keeps it.
- `scripts/probe-linkedin.ts` cannot compile against it either.

**Complexity:** High (~3-4 days)
- Files to create: 0 (~0 lines)
- Files to modify: ~15-20 (~+700/−900 lines)
- Risk level: High

### Option 3: Threads skeleton + recovered extraction

**How it works:**
Take the structural layer from `src/fetch-threads.ts` — the five interfaces, `makeChromiumContextFactory`, the webdriver patch, the dynamic-import quarantine, the interception pattern, the `runPool` slot arrays — and graft it into the existing `fetchLinkedInPosts` skeleton. Take the extraction mechanics from `68c1e2d:src/fetch-linkedin.ts` — the React Flight parser, the wheel pagination, the urn minting, the `BigInt(id) >> 22n` timestamp. Keep the tagged errors, the FR-5 shuffle, the pacing gate, the halt latch, the budget ledger, and the payload writer untouched.

**Pros:**

- Strictly dominates Option 1 on the structural half and Option 2 on the walk half. Same structural work as Option 1, plus a recovered parser instead of a from-scratch one. Same parser as Option 2, grafted instead of restored wholesale, so FR-5 survives for free.
- The recovered Flight parser is the **only** offline-testable extraction route. Its fixtures build inline (`cardBody(id, text)`), so no capture is needed. FR-2's page-JSON route has no offline oracle at all.
- The interception join composes on shape: attach-before-`goto`, the size cap, the URL+status filter, Map dedupe by `post.id`, and the settle window before close. `ResponseLike` needs no change.
- The recovered parser matches `isValidRow` exactly, with one divergence that already has a fix in the repo: `mintPost` calls `.toISOString()` unguarded, while the surviving `timestampFromActivityId` (`src/linkedin-voyager.ts:114-126`) guards with `try/catch` and `ms <= 0n`.
- Cheaper than either parent commit individually: ~15-20 files, ~+700/−900, against `68c1e2d` (27 files, 6 layers) and `a8752bf` (33 files, +4004/−797).

**Cons:**

- The interception join conflicts on three specifics that must be fixed, not copied: the Threads body gate (`if (!body.includes("thread_items"))` then `JSON.parse` at `src/fetch-threads.ts:378-380`) throws on every Flight stream; the counter semantics differ (Threads counts received, the deleted walk counted parsed — the N008 defect); and the dedupe direction differs (Threads last-wins at `:384`, the deleted walk first-wins).
- 0 of the 6 structural mechanics are exported, deliberately: `.rpiv/artifacts/TECH_DEBT_AUDIT.md:27` records knip N012 flagging `makeChromiumContextFactory`/`chromiumContextFactory` as unused exports, and `:65` records the fix. A second module cannot import them without re-introducing N012, so ~120 lines duplicate.
- `PageLike` still needs `mouse?` and `url?()` — both additive and optional, so the 3 existing doubles stay assignable.
- `ContextFactory`'s path-vs-document mismatch must be solved LinkedIn-locally. Widening the shared type breaks all 3 doubles under `strictFunctionTypes`.

**Complexity:** High (~3-5 days)
- Files to create: 0 (~0 lines) — FR-6 is in place
- Files to modify: ~15-20 (~+700/−900 lines)
- Risk level: Medium-High

## Comparison

| Criteria | Option 1 | Option 2 | Option 3 |
|----------|----------|----------|----------|
| Complexity | H | H | H |
| Codebase fit | M | L | H |
| Risk | H | H | M-H |
| Parser source | from scratch | recovered (56% pure) | recovered (56% pure) |
| Offline-testable parser | no | yes | yes |
| FR-5 shuffle | lost unless re-added | lost unless grafted | kept free |
| Structural layer | copied | re-derived | copied |
| Net line delta | +1000-1400 / −2500-3000 | +700/−900 | +700/−900 |

## Recommendation

**Selected:** Option 3

**Rationale:**

- It is the only candidate whose parser is offline-testable. The recovered Flight parser's fixtures build inline, and its output already satisfies `isValidRow` (`src/linkedin-payload.ts:88-109`) on every check. Option 1's from-scratch parser can only be verified by a live headed session.
- It keeps FR-5 for free. The shuffle lives in `fetchLinkedInPosts` (`src/linkedin-fetch.ts:527-535`), so a graft preserves it and a wholesale restore does not.
- It reuses the structural layer that is already in the repo and already pinned by 18 tests (`tests/fetch-threads.test.ts`). Option 2 must re-derive that layer because all 6 mechanics are module-private.
- The interception route is live-proven. The 2026-11-01 plan follow-up records the pagination URL already matching the walker's filter regex.
- It is cheaper than either parent commit individually.

**Why not alternatives:**

- Option 1: dominated. Same structural work as Option 3, but the parser is written from scratch with no offline oracle.
- Option 2: dominated. Same parser as Option 3, but the walk half restores at 0% and FR-5 is lost unless grafted — which is Option 3.

**Trade-offs:**

- Accepting ~120 lines of duplicated structural mechanics for the knip N012 constraint, rather than re-exporting the private factory.
- Accepting a LinkedIn-local `ContextFactory` type instead of widening the shared one, to keep the 3 existing doubles assignable under `strictFunctionTypes`.
- Accepting that FR-2's page-JSON route stays unproven until a live headed inspection.

**Implementation approach:**

1. **Seam growth** — add `mouse?` and `url?()` to `PageLike` (`src/fetch-threads.ts:90-104`) and the production adapter (`:141-176`). Both optional, so the 3 doubles stay assignable. Add a LinkedIn-local context factory type that accepts a storageState document.
2. **Parser recovery** — restore `parseFlightRows`, `textFromChildren`, `mintPost`, `collectLinkedInPosts` and their constants from `68c1e2d:src/fetch-linkedin.ts`. Guard `mintPost`'s timestamp with the `timestampFromActivityId` range check (`src/linkedin-voyager.ts:114-126`). Fix the three interception conflicts: drop the `thread_items` body gate, count parsed not received, keep first-wins dedupe.
3. **Walk graft** — replace the transport half of `src/linkedin-fetch.ts` (`:102-473`) with the browser walk, keeping `fetchLinkedInPosts`'s skeleton (`:512-627`) intact: the shuffle, the pacing gate, the drain arms, the join priority, the stamp-at-slot-write.
4. **Checkpoint detector** — a new halt producer. Add a canonical reason constant beside `HALT_RATE_LIMIT_REASON` and `HALT_BUDGET_REASON` (`src/linkedin-behavior.ts:144-152`). Classify `/uas/login`, `/login`, `/checkpoint`, `/authwall` as `halt`, never `legDead`.
5. **Tick rewire** — `FetchTickDeps.transport` → `contextFactory` + session source. Re-seat the budget wrapper on a per-page-load seam. Thread `config.scrollRounds`. Remove the `finally` transport dispose (`scripts/fetch-linkedin.ts:478-481`); the walk owns its context.
6. **Deletion** — `src/linkedin-voyager.ts`, `scripts/setup-curl-impersonate.ts`, both transports, `classifyFault`, `resolveLinkedInTransport`, `buildCookieHeader`, `csrfToken`, `ENV_NAMES.linkedinTransport`, `ENV_NAMES.curlImpersonateBin`, `package.json:20`, the lint/format globs, the `.gitignore` `tools/` entry.
7. **Probe** — rewrite `scripts/probe-linkedin.ts` as a browser-walk gate, or delete it and `package.json:17`.
8. **Doc sweep** — README, AGENTS.md, and the 5 `.rpiv/guidance/*` files, in the same commit.

**Integration points:**

- `src/fetch-threads.ts:90-104` — add `mouse?`, `url?()` to `PageLike`.
- `src/fetch-threads.ts:141-176` — the production adapter supplies both.
- `src/linkedin-fetch.ts:102-473` — the transport half is deleted.
- `src/linkedin-fetch.ts:512-627` — the skeleton is kept; the body changes.
- `src/linkedin-behavior.ts:144-152` — a third halt reason constant.
- `scripts/fetch-linkedin.ts:96-97` — `transport` → `contextFactory`.
- `scripts/fetch-linkedin.ts:442-450` — the budget wrapper re-seats on page loads.
- `scripts/fetch-linkedin.ts:478-481` — the `finally` dispose is removed.
- `scripts/probe-linkedin.ts:19-24` — rewrite or delete.
- `src/config.ts:17-18` — two env names die.

**Patterns to follow:**

- `runPool` slot arrays: `src/pool.ts:33-52`, `src/fetch-threads.ts:315-341`.
- Stamp-at-slot-write: `src/linkedin-fetch.ts:576-580`.
- Tagged errors: `src/linkedin-fetch.ts:116-192`.
- Dynamic-import quarantine: `src/fetch-threads.ts:131`.
- Atomic write: `src/state.ts` `stateTempPath` + rename.
- Per-walk closure for pacing: `src/linkedin-fetch.ts:470-473`.

**Risks:**

- **A dead session degrades to zero posts.** The b1/b2 bug class (`.rpiv/artifacts/validation/2026-11-05_10-01-36_linkedin-local-leg.md`). Mitigation: the checkpoint detector throws `halt`, and a plain `Error` must never be the session-death signal.
- **A zero-result window is misread as a dead session.** The `defb8af` bug. Mitigation: a page still on `/search/results/content` returns `[]` with an `OK — 0 post(s)` log.
- **Credential leak in error paths.** The `34e91b9` bug. Mitigation: the walk's `goto`/`response.text()` error paths must not forward raw messages.
- **Doc drift.** The `7558747` validation found README:358, AGENTS.md:42, and `.rpiv/guidance/src/architecture.md:126` stale. Mitigation: one doc-sweep commit, as `bf6594c`'s residue taught.
- **Headless detectability.** Unresolved. Mitigation: the first live run is a rehearsal, and a retune commit is expected.
- **The extraction route is unverified.** Mitigation: a live headed blade-browser inspection before the parser is finalized.

## Scope Boundaries

- In scope: the in-place replacement of `src/linkedin-fetch.ts`'s transport half, the parser recovery, the seam growth, the tick rewire, the deletion set, the probe, and the doc sweep.
- In scope: a third halt reason constant for the checkpoint detector.
- Out of scope: the hosted side. `src/index.ts:300-308` and `src/email.ts:139-142` need zero changes.
- Out of scope: `src/linkedin-payload.ts` and `src/linkedin-behavior.ts`'s budget machine. Both are reused as-is.
- Out of scope: `scripts/watch-linkedin.ts`. It imports only `SleepFn` and `isLegDead`.
- Out of scope: the persistent-profile session model. The developer chose the headed cookie harvest.

## Testing Strategy

**Unit tests:**

- Parser: a rich card, urn dedupe, stream order, module-manifest skip, orphan-commentary skip, empty-text skip, marker-only → `[]`, br-only → `""`, row split. All 7 restore from the deleted suite.
- Parser: the timestamp `RangeError` path that `mintPost` does not guard and `timestampFromActivityId` does.
- Parser: the payload round-trip — `writePayloadAtomic(walkOutput)` → `readPayloadPosts` → `leg: "ok"`, zero dropped. This proves the recovered shape against `isValidRow` without a browser.
- Walk: one context per walk from the session, input-order reassembly, concurrency peak ≤ 2, per-surface fault isolation, all-fail throw, zero-post surface is success, checkpoint → `halt` (not `legDead`, not fault), FR-5 shuffle transcript, pacing gate spacing, budget page-load counting, context teardown on every path.
- Walk: zero voyager-endpoint requests — assert `gotos` and `responseUrls`.
- Tick: `fetchTick` with a `contextFactory` dep, budget wrapper counts page loads, halt latch trip on checkpoint, all-faulted quiet zeros, leg-dead rethrow, payload write/push unchanged.
- Behavior: the third halt reason constant is distinguishable from the other two (`tests/linkedin-behavior.test.ts:149-157` asserts exactly two today).
- Session: the storageState document → context factory bridge.

**Integration tests:**

- A LinkedIn `fakeContextFactory` double with 8 knobs: `gotos`, `responseUrls`, `contentBySubstring`, `sessionPaths`, `closed`, `concurrency`, `contentCalls`, and an attach-order log. The Threads double cannot be reused: `content()` returns a fixed Threads string, `graphqlResponse` hardcodes the Threads graphql URL, `xhrBySubstring` keys on the surface label, and `goto` discards its URL.
- The suite stays Playwright-free. Every new test injects the factory; no test launches a browser.

**Manual verification:**

- [ ] Run `npm run login-linkedin` headed, complete the login by hand, confirm the cookie file and the `.env` line.
- [ ] Run `npm run probe-linkedin` twice, at least 6h apart, with stored cookies.
- [ ] Run one `npm run fetch-linkedin` tick. Confirm the payload lands, the git push succeeds, and the log shows one `OK — N post(s)` line per surface.
- [ ] Force a checkpoint (or simulate one) and confirm the latch trips, one alarm sends, and the payload is untouched.
- [ ] Confirm a zero-result surface logs `OK — 0 post(s)` and does not alarm.
- [ ] Run `npm run typecheck && npm run lint && npm test`.

## Open Questions

**Resolved during research:**

- Which session source the walk uses — the headed cookie harvest. `resolveLinkedInCookies`, `toStorageState`, and the `harvestedAt` gate stay coherent.
- Whether the walk scrolls — yes, bounded by `scrollRounds` (default 8).
- Whether the hosted side changes — no. Traced end to end.
- Whether the deleted walk's parser is recoverable — yes, 56% pure, and its output satisfies `isValidRow`. Proven on a live capture 2026-11-11.

**Requires user input:**

- Whether `scripts/probe-linkedin.ts` is rewritten as a browser-walk gate or deleted. Default assumption for planning: rewrite, because the transport gate is the only pre-flight check on the leg.
- Whether one budget unit is one navigation or one scroll round. Default assumption: one navigation, which keeps the worst-case arithmetic (28 wake-ups × 5 surfaces × 1 page = 140 < 150) intact.

**Blockers:**

- The extraction route needs a live headed blade-browser inspection before the parser is finalized. Unblock: run the login helper, open one search URL headed, and inspect the page JSON and the intercepted responses.
- Headless detectability is unmeasured. Unblock: the first live run is a rehearsal; expect a retune commit.

## References

- `.rpiv/artifacts/research/2026-11-10_19-56-45_linkedin-browser-walk-migration.md` — the research this analysis answers
- `.rpiv/artifacts/discover/2026-11-10_19-36-43_linkedin-browser-walk-migration.md` — the FRD
- `.rpiv/artifacts/solutions/2026-10-31_10-32-31_linkedin-second-surface-dispatch.md` — the original browser walk's mechanics
- `.rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md` — the original walk's live runs and the pagination-URL confirmation
- `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md` — the full source fence of the deleted walk
- `.rpiv/artifacts/designs/2026-11-01_21-35-44_linkedin-sdk-post-search-cutover.md` — the one-commit deletion+rewire precedent
- `.rpiv/artifacts/validation/2026-11-05_10-01-36_linkedin-local-leg.md` — the b1/b2 dead-session blockers
- `.rpiv/artifacts/validation/2026-11-10_16-10-20_linkedin-humanlike-fetch-behavior.md` — the doc-drift and profile-deletion findings
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md:27`, `:65` — the knip N012 finding and its fix
- `src/fetch-threads.ts:76-180`, `:304-459` — the structural layer to copy
- `src/linkedin-fetch.ts:102-473`, `:512-627` — the transport half to delete and the skeleton to keep
- `src/linkedin-session.ts:97-199` — the session resolver and the storageState bridge
- `src/linkedin-payload.ts:65`, `:88-109`, `:178-182` — the row contract and the v2 envelope
- `src/linkedin-behavior.ts:82-152` — the budget machine and the halt vocabulary
- `src/linkedin-voyager.ts:114-126` — the guarded timestamp the recovered parser must adopt


## Follow-up Analysis 2026-11-11T07:36:21+0700

**Trigger**: live bladebro inspection of one real search surface (`hiring indonesia`), logged in as the operator, 2026-11-11. This closes the artifact's "extraction route is unverified" blocker and refutes two of its assumptions.

### What was tested

URL: `https://www.linkedin.com/search/results/content/?keywords=hiring%20indonesia&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D`

The page loaded, stayed on `/search/results/content/`, and rendered posts. Filters showed Posts ✓, Latest ✓, Past 24 hours ✓.

### Findings

| # | Assumption in this artifact | Live result | Verdict |
|---|---|---|---|
| 1 | The pagination URL `/flagship-web/rsc-action/actions/pagination?sduiid=com.linkedin.sdui.search.contentSearchResults` still fires | **Fires.** Captured twice: 43,468 bytes, then 1,533,238 bytes | holds |
| 2 | The body is a React Flight stream (`hex:JSON` per line) | **Yes.** 482 lines, opening `1:"030d6035..."`, `2:I["$1",[],"default"]` | holds |
| 3 | The results page is an infinite loader; the walk scrolls to the bottom | **No.** A **"Load more" button** drives pagination. Scrolling fires no request | **refuted** |
| 4 | The old parser's field walk (`commentary.text.text`, `metadata.backendUrn`, `socialContent.shareUrl`) still applies | **No.** `backendUrn: 0`, `socialContent: 0`, `searchDashClustersByAll: 0`, `searchFeedUpdate: 0`. The body is `proto.sdui` state (5,440 hits) | **refuted** |
| 5 | The page-JSON route (`extractPosts`) can yield posts | **No.** `data-sjs: false`, `thread_items: false`, one `urn:li:activity:` in 164 KB of HTML | dead |
| 6 | The DOM route yields posts | **Insufficient.** 2 permalinks out of 9 rendered posts; one is `urn:li:ugcPost:`, which `ACTIVITY_URN_RE` rejects | dead |
| 7 | `mintPost`'s permalink-from-urn and timestamp-from-id derivation is still needed | **Yes.** The body carries 0 `shareUrl`, 0 `permalink`, 0 `postedAt` | holds |

### What the body actually carries

- 3 unique `urn:li:activity:` ids and 2 unique `urn:li:member:` ids per response.
- Post text inside `textProps.children`, as React Flight `$`-refs: `["$","$5f","0",{"children":[null,"I'm open to Full-Stack Developer..."]}]`.
- Tracking labels `"viewName":"feed-commentary"` and `"legacyControlName":"commentary_text"` — the word "commentary" survives as a label, not as a data field.
- No author display name, no permalink, no timestamp.

### Impact on the recommendation

**Option 3 still wins, but its parser advantage shrinks.** The recovery is ~60%, not the 57%-pure-and-verbatim the main body claims:

- `parseFlightRows` — survives. The line framing is unchanged.
- `textFromChildren` — survives conceptually. The `$`-ref recursion is exactly the structure in the body.
- `mintPost` — survives. Permalink from the urn and timestamp from `BigInt(id) >> 22n` remain the only route, because the body carries neither.
- `collectLinkedInPosts` — **must be rewritten.** The walk from Flight rows to post text moves from `commentary.text.text` to `textProps.children`.

**FR-9's unit changes.** The budget unit is one **"Load more" click**, not one scroll round. `PageLike` needs a click on a button, not `mouse.wheel`. The `scrollRounds` config key is the wrong knob for this page.

**Option 1 and Option 3 converge on the parser.** Both now need a new field walk. Option 3 keeps its advantage on the structural layer and the proven interception route, not on parser recovery.

### Revised estimates

- Parser work: ~150-250 lines of new field-walk code, not a restore.
- Seam growth: `PageLike` needs a click path, not `mouse?`. The `url?()` need stands (the checkpoint detector).
- Confidence: **medium** at the time of that pass. Superseded by the 2026-11-11T07:52:00 follow-up.

### Revised open questions

- **Resolved**: the pagination URL still fires, and the body is still Flight. The interception route is live-proven on 2026-11-11, not only 2026-11-01.
- **Resolved**: the page is not an infinite loader. It is a "Load more" button.
- **New**: how many posts one pagination response carries. Observed: 3 activity urns in a 1.53 MB body. Confirm across surfaces before sizing the budget.
- **New**: whether the "Load more" button is always present, or disappears at the end of the result set. The first click removed the "Page 1 of 1" control; the button was still present after two clicks.


## Follow-up Analysis 2026-11-11T07:52:00+0700

**Trigger**: verification pass on the four open issues from the first follow-up. Two of that follow-up's claims are **wrong** and are corrected here. The prior section stays immutable.

### 1. The recovery percentage is settled: 56% pure

`git show 68c1e2d:src/fetch-linkedin.ts` returns **338 lines**, byte-identical to the design fence at `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md:369-706` (338 lines). The fence's critical line 593 — `(specs as Record<string, unknown>).legacyControlName === "commentary_text"` — matches the real file exactly.

Line map of the real file:

| Range | Lines | Kind |
|---|---|---|
| 1-59 | 59 | module header + doc |
| 60-247 | 188 | constants, `parseFlightRows`, `textFromChildren`, `mintPost`, `collectLinkedInPosts` — **pure, no I/O** |
| 256-338 | 83 | `fetchLinkedInSurface` — the walk |

**188/338 = 56% pure.** The comparison table's "~57%" was right. The Option 2 section's "50%" was wrong. The first follow-up's "~60%" was close but unmeasured. Use **56%**.

### 2. CORRECTION — the parser works. The field walk is not dead.

The first follow-up claimed the old parser's field walk was dead because `backendUrn`, `socialContent`, and `searchDashClustersByAll` are absent. That inference was wrong. The parser does not read those fields. It keys on `viewTrackingSpecs.legacyControlName === "commentary_text"`, which **is present** — 6 markers in the live body.

The real `collectLinkedInPosts` (transpiled from `68c1e2d`, unmodified) was run against the live 1,533,238-byte body. It minted **2 complete posts**:

```
urn:li:activity:7526043929209655298
  text: "I'm open to Full-Stack Developer, Front-End Developer and Software Engineer roles..."
  permalink: https://www.linkedin.com/feed/update/urn:li:activity:7526043929209655298
  timestamp: 2026-11-10T22:11:39.858Z

urn:li:activity:7526045140398919681
  text: "#hiring Chef De Cuisine Sunda Tampa ... Apply here:https://lnkd.in/g3ZSjsaE ..."
  permalink: https://www.linkedin.com/feed/update/urn:li:activity:7526045140398919681
  timestamp: 2026-11-10T22:16:28.628Z
```

Both satisfy `isValidRow` (`src/linkedin-payload.ts:88-109`): `platform: "linkedin"`, an `ACTIVITY_URN_RE` id, non-empty `text`/`author`/`permalink`, a `Date.parse`-able timestamp, and absent `surfaces` (stamped at slot write).

**The parser is a genuine restoration, not a rewrite.** `parseFlightRows`, `textFromChildren`, `mintPost`, and `collectLinkedInPosts` all run unmodified against today's live body.

### 3. NEW DEFECT — the parser under-mints by one third

The body carries 6 `commentary_text` markers, 3 distinct post texts, and 3 activity ids. The parser mints **2**. Instrumented walk:

| Row | Paired id | Text head | Length |
|---|---|---|---|
| `10` | `7526043929209655298` | "I'm open to Full-Stack Developer..." | 1228 |
| `2b` | `7526045140398919681` | "#hiring Chef De Cuisine Sunda Tampa..." | 1923 |
| `3e` | `7526043929209655298` | "🚀 WE ARE HIRING | PCB DESIGN ENGINEER..." | 1194 |
| `21` | `7526043929209655298` | duplicate of row 10 | 1228 |
| `34` | `7526045140398919681` | duplicate of row 2b | 1923 |
| `47` | `7526043929209655298` | duplicate of row 3e | 1194 |

The PCB post (row `3e`) pairs with the **Full-Stack post's id**, so first-wins dedupe drops it. The third body id `7526045593195094017` never pairs with any marker. **One of three posts is silently lost.**

This is a stream-order pairing defect in `collectLinkedInPosts`'s `currentId` register, not a format change. It must be fixed before the walk ships, or the leg loses a third of its yield without a log line.

### 4. CONFIRMED — scrolling does not paginate

Tested on the real scroll container (`main`, `scrollHeight` 8568, `clientHeight` 811), not `window`:

- `window.scrollTo` is a no-op: `document.body.scrollHeight` is 920, equal to the viewport. The old walk's comment ("nested frame; window.scrollTo is a no-op") still holds.
- `main.scrollTop` driven to its maximum (7757/7757). The footer rendered. **Zero pagination requests fired.** The "Load more" button was still present.

**The "Load more" button is the only pagination trigger.** The first follow-up's claim is confirmed, now with a valid test.

### 5. CONFIRMED — the timestamp derivation holds

`7526071385735974914 >> 22n` → `2026-11-11T00:00:46.004Z`. At `2026-11-11T00:39:58Z` that is 39 minutes old. The DOM's own age label for that post reads `34m`. **Drift: 5 minutes**, inside the documented 4-6 minute range (`src/linkedin-voyager.ts:114-126`).

The id scheme is unchanged. No silent timestamp corruption.

### 6. Seam consequence

The old walk drives pagination with `page.mouse.move` + `page.mouse.wheel` (`68c1e2d:src/fetch-linkedin.ts:315-316`). Today's `PageLike` (`src/fetch-threads.ts:90-104`) has no `mouse`. But since the wheel does not paginate anyway, the walk needs a **click on the "Load more" button**, not a wheel seam. `PageLike` already exposes `locator(selector)` and `LocatorLike.click()` — **no seam growth is required for pagination.**

`url?()` is still needed for the checkpoint detector.

### Revised position

| Item | Before this pass | After |
|---|---|---|
| Recovery | "~57% pure, field walk must be rewritten" | **56% pure, all four parser functions run unmodified** |
| Parser viability | unproven | **proven on live data; 2 posts minted and validated** |
| Under-minting | unknown | **1 of 3 posts lost to id mis-pairing — must fix** |
| Pagination trigger | "Load more button" (untested) | **confirmed; scroll fires nothing** |
| Timestamp derivation | untested | **confirmed, 5 min drift** |
| `PageLike` growth | `mouse?` + `url?()` | **`url?()` only** — pagination rides the existing `locator`/`click` |

**Option 3's margin is restored, not thinner.** The parser is a true restoration. The one new defect (under-minting) is a bounded fix in `collectLinkedInPosts`'s pairing register, not a rewrite.

**Confidence: high** on the parser, the pagination trigger, the timestamp derivation, and the recovery percentage. **Medium** on the under-minting fix's scope until it is written.


## Follow-up Analysis 2026-11-11T07:55:00+0700

**Trigger**: capture extraction and offline round-trip. The live Flight body is now a repo file, and the parser has been run against it outside the browser.

### The capture is saved

`.rpiv/tmp/linkedin-pagination-body.txt` — **1,533,238 bytes**, the raw React Flight stream from `/flagship-web/rsc-action/actions/pagination?sduiid=com.linkedin.sdui.search.contentSearchResults`, surface `hiring indonesia`, captured 2026-11-11.

Path: browser → gzip (94,775 bytes) → base64 (126,368 chars) → `textarea` → bladebro `read` artifact → `zlib.gunzipSync` → file. `.rpiv/tmp/` is gitignored scratch (`.rpiv/artifacts/` stays tracked), so the capture does not enter git.

**Consequence for tests**: the capture is scratch, not a committed fixture. A permanent parser fixture must be either a gzipped copy committed under `tests/fixture/` (94 KB) or a synthetic Flight body built inline, which is the repo convention (`tests/fixture/` holds only `graphql-response.json`, `tag-page.html`, `voyager-search-response.json`). Decide at implement time.

### Offline run — identical to the browser run

`node .rpiv/tmp/run-parser.mjs` against the saved file:

```
body bytes: 1533238
flight rows: 448
posts minted: 2
```

Same 2 posts, same ids, same timestamps, same text lengths (1228 and 1923) as the in-browser run. The parser is deterministic and the capture is faithful.

### Payload round-trip — zero drops

`writePayloadAtomic(posts)` → `readPayloadPosts()` with the clock pinned at `2026-11-11T00:40:00Z`:

```
posts minted: 2
leg: ok | detail: payload 0 min old
posts read back: 2
dropped: 0
```

Both rows pass `isValidRow` (`src/linkedin-payload.ts:88-109`) and the v2 envelope (`:178-182`). The leg reads `ok`. This is the offline proof the artifact's testing strategy asked for — no browser required.

### What this settles

- The recovered `collectLinkedInPosts` produces payload-valid rows with no change.
- The parser is offline-testable against a real capture, not only synthetic fixtures.
- The capture is available for the parser suite's development, even though it is not committed.

### What remains open

The under-minting defect from the 07:52 pass stands: 6 markers, 3 distinct texts, 2 posts. The PCB post is still lost. The round-trip above proves the 2 minted posts are valid; it does not address the missing third.
