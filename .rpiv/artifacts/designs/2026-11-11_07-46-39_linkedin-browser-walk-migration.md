---
date: 2026-11-11T07:46:39+0700
author: Yogiswara Utama
commit: 1cd0f47
branch: ukind/feature-migrate-using-browser-approach
repository: feature-migrate-using-browser-approach
topic: "linkedin-browser-walk-migration"
tags: [design, linkedin-fetch, browser-walk, flight-parser, linkedin-behavior, fetch-linkedin, probe-linkedin]
status: ready
parent: ".rpiv/artifacts/solutions/2026-11-11_07-17-47_linkedin-browser-walk-migration.md"
last_updated: 2026-11-11T18:45+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Live rehearsal disproved the session model: the fresh-context factory gets a page with no Load-more button. Session model revised to launchPersistentContext + headed (four-config matrix in Key Discoveries); parser count-mismatch escalated to a correctness blocker"
---

# Design: LinkedIn browser-walk migration

## Summary

Replace the voyager-endpoint transport inside `src/linkedin-fetch.ts` with a real Playwright browser walk of the LinkedIn content-search page, in place: the tagged errors, the FR-5 shuffle, the pacing gate, the halt latch, and the payload writer survive untouched. The React Flight parser from the deleted walk (`68c1e2d:src/fetch-linkedin.ts`) is recovered into a new pure module `src/linkedin-parser.ts` with a corrected pairing rule (timestamp-ordered zip), and the daily GET budget machine is deleted — volume is bounded by the `scrollRounds` click count and the existing waits. The probe is rebuilt on the same walk; the voyager module, both transports, and the curl setup script are deleted; docs sweep in the same change.

## Requirements

- FR-2: capture both extraction routes — the intercepted pagination/search responses are the live route (page JSON is dead: no `data-sjs`, no `thread_items`).
- FR-5: shuffled surface order survives (the Fisher-Yates in `fetchLinkedInPosts` stays).
- FR-6: replace `src/linkedin-fetch.ts` in place. Delete `src/linkedin-voyager.ts`, the curl transport, the `request.newContext` transport, and `LINKEDIN_TRANSPORT`.
- FR-7: a security checkpoint or login wall halts the leg and alarms once (the operator-cleared latch).
- FR-9 (amended by the developer): pacing rides page navigations (5-15s shared gate); pagination is the "Load more" button, bounded by `scrollRounds` (default 8).
- FR-8 (dropped by developer decision 2026-11-11): the daily 150-GET budget machine is deleted; volume bounds are the working-hours window, the 28-33 min cadence, and the per-surface click cap.
- Session (REVISED 2026-11-11T18:45+0700, rehearsal-driven): login stays headed-only (`scripts/login-linkedin.ts` untouched); the walk REUSES the same persistent profile via `launchPersistentContext` instead of opening a fresh browser with the harvested cookie document. The cookie file degrades to a preflight validity check. Evidence: the four-config matrix in Key Discoveries.
- Payload: same file, same v2 envelope; `state/linkedin-posts.json` round-trips through `readPayloadPosts` with zero dropped rows.
- Hard: the offline suite stays Playwright-free (dynamic-import quarantine only).
- Hard: state writes stay atomic; one writer per file; fail visible.
- Hard: strict TS flags stay on.

## Current State Analysis

The LinkedIn leg is a voyager transport: `VoyagerResponse`/`VoyagerGet`/`Transport` (`src/linkedin-fetch.ts:102-116`), `classifyFault` (:196-285), `createCurlTransport` (:287-389), `createPlaywrightTransport` (:391-437), `resolveLinkedInTransport` (:439-473), and the `fetchLinkedInPosts` walk skeleton (:512-627) — shuffle :522-535, pacing gate :475-493, drain arms :586-605, join priority :612-620, stamp-at-slot-write :576-580.

### Key Discoveries

**The session model was wrong (live rehearsal 2026-11-11T18:40+0700).** Four configurations measured against the same URL, same account, same minute:

| config | posts | Load-more button | pagination responses |
| --- | --- | --- | --- |
| fresh context + harvested cookies, headless | 3 | **0** | 2 (auto) |
| fresh context + harvested cookies, headed | 14 | **0** | 8 (auto) |
| persistent profile, headless | 14 | **0** | 1 (auto) |
| **persistent profile, headed** | 8 | **1** | 0, then 1 per click |

The Load-more button requires BOTH the persistent profile AND headed mode. The design's factory (`chromium.launch()` + `newContext({ storageState })`) produces a fresh, differently-fingerprinted browser identity, and LinkedIn serves that identity a page with no button at all — so the click loop had nothing to click, which is why the first rehearsal reported 3 posts.

End-to-end proof with the profile, headed (`launchPersistentContext("C:/loker-secrets/linkedin-chromium-profile", { headless: false })`):

```
start:   8 posts, 0 pagination
click 1: 14 posts, 1 pagination
click 2: 20 posts, 2 pagination
click 3: 26 posts, 3 pagination
click 4: 32 posts, 4 pagination
click 5: 38 posts, 5 pagination
```

Six posts per click, one pagination response each. The click loop, settle window, parser and response join are all correct.

**The rotation was self-inflicted.** `login-linkedin` holds the persistent profile; the walk opened a second, differently-fingerprinted browser with the same token. Two identities on one account produced every `ERR_TOO_MANY_REDIRECTS`. Reusing the profile directly, two consecutive runs both succeeded.

**The parser count-mismatch is real data, not a parser bug — and it fires on 2 of 3 bodies in the WORKING config.** Three pagination bodies captured from the working configuration (profile + headed, 3 clicks, 8→26 posts) and parsed offline:

| body | ids | commentary markers | texts harvested | minted |
| --- | --- | --- | --- | --- |
| 1 | 3 | 3 | 2 | 2 (mismatch) |
| 2 | 3 | 4 | 2 | 2 (mismatch) |
| 3 | 3 | 4 | 3 | 3 (clean) |

**Cause, measured:** the empty markers are `translatable-commentary` placeholders with `contentUrnCommentUrn=null` — media-only posts with no caption. Row 31 of body-1 has 95 leaf strings and not one is post text; row 21 (a real post) has 4,558. The parser correctly harvests nothing for a post that has no text. **The mismatch is the data, not a defect.**

**Second finding: CTA contamination.** A 33-char `hellohr@neokosmetikaindonesia.com` is harvested as a post's entire text. It is a `commentary_text` marker on a contact CTA component, and its specs are byte-identical to a real post's (`viewName, interactionTypes, contentTrackingId, legacyControlName`) — the marker fields do NOT distinguish them. The only signal is the text itself.

**Consequence for the pairing rule.** The zip is unsafe whenever the counts differ, and they differ on 2 of 3 bodies. But refusing the body drops 2 of every 3 bodies' posts. The real fix is upstream: filter CTA components out of the text harvest so the counts match. Until then, the prefix rule mis-pairs and the refuse rule starves — neither is acceptable, which is why the pairing change is NOT implemented.

- **No id↔text pairing signal exists in the Flight stream.** Offline analysis of the live capture (`.rpiv/tmp/linkedin-pagination-body.txt`, 1,533,238 bytes, 448 rows): BFS over the full `$`-ref graph from every `commentary_text` marker row reaches ZERO id-carrying rows (depth 12, both directions sampled); no row co-locates an id with a marker; `contentTrackingId` is shared across all posts (list-level). The artifact's "bounded register fix" claim is refuted — the register cannot be repaired, only replaced.
- **Timestamp zip pairs 3/3 on the capture.** Distinct texts in stream order (Full-Stack row 21, Chef row 34, PCB row 47) zipped against distinct ids sorted by derived timestamp (…655298 → 22:11:39.858Z, …919681 → 22:16:28.628Z, …094017 → 22:18:16.583Z) pairs all three correctly; first-appearance order does NOT (row 0 emits B before A).
- **The hashtag chip is a second `commentary_text` component** in the same row as the real text (row 34: 1923-char post + 7-char "#hiring", identical specs except `interactionTypes` is a `$`-ref). Longest-text-per-row handles it; a consume-once id scan wastes an id on the chip and starves a real post.
- **`mintPost` runs unmodified against today's body** except the unguarded `.toISOString()` — adopt `timestampFromActivityId`'s guard (`src/linkedin-voyager.ts:114-126`: try/catch + `ms <= 0n`).
- **Pagination is the "Load more" button** — scrolling fires nothing (verified on the real scroll container, `main`, 2026-11-11). `PageLike` already exposes `locator`/`LocatorLike.click`; only `url?()` is missing (checkpoint detector). No `mouse` seam.
- **Page JSON route is dead**: no `data-sjs`, no `thread_items`, one urn in 164 KB of HTML. The DOM route is insufficient: 2 of 9 posts carry permalinks, one a `ugcPost` urn the row contract rejects.
- **The structural layer is copyable but private**: knip N012 killed the exported factory (`.rpiv/artifacts/TECH_DEBT_AUDIT.md:27`, :65) — ~120 lines duplicate into `linkedin-fetch.ts` rather than widen `ContextFactory` (widening breaks the 3 doubles under `strictFunctionTypes`).
- **The intercepted-response join conflicts on three specifics**: the Threads body gate (the includes check plus JSON.parse, `src/fetch-threads.ts:378-380`) throws on Flight streams; counter semantics (count parsed, not received — N008 direction); dedupe stays first-wins by urn.
- ~~**The walk's context factory takes a storageState DOCUMENT, not a path.**~~ **DISPROVED 2026-11-11T18:40+0700.** This discovery drove the original factory design and the rehearsal killed it: a fresh browser carrying the synthesized document gets a content-search page with no Load-more button. The factory now takes the persistent PROFILE PATH. `toStorageState` (`src/linkedin-session.ts:178-199`) and its cookie-completion remap stay in the module for the caller-side preflight, but they are no longer on the walk's path. See the Session model decision.
- **The Load-more button is captured; `LOAD_MORE_SELECTOR` is fixed.** Live DOM 2026-11-11 (logged-in bladebro session, surface `hiring indonesia`): exactly ONE matching candidate on the page — `<button class="i87lxe …" type="button"><span…><span>Load more</span></span></button>` — no aria-label, no id, and the class list is a per-deploy hash (useless as a selector). The text node is the only stable handle: `LOAD_MORE_SELECTOR = "button:has-text(\"Load more\")"`. The sdui component id (`…replaceableLoadMoreComments…FeedType_FLAGSHIP_SEARCH`, 18 hits in the Flight capture) never renders as a DOM attribute, so it stays a cross-check, not a selector. The walk's `.first()` and the dry-round exit make a transient 0-match a harmless dry round.
- **Budget machine anatomy** (deletion set): `DAILY_GET_BUDGET`, `DailyBudgetState`, `freshBudget`, `budgetAllows`, `budgetReserve`, `HALT_BUDGET_REASON` (`src/linkedin-behavior.ts`), the wrapper + `DEFAULT_BUDGET` + preflight budget step (`scripts/fetch-linkedin.ts`), the budget suites (`tests/linkedin-behavior.test.ts`, `tests/fetch-linkedin.test.ts`).
- **Probe breakage**: `scripts/probe-linkedin.ts:19-24` imports `resolveLinkedInTransport` (dies slice 4) and `{buildSearchUrl, parseSearchResponse}` (die slice 7). `scripts/watch-linkedin.ts` survives untouched (`SleepFn` + `isLegDead`).
- **Hosted side is untouched** except one wording edit: `buildHaltAlarmText` (`src/email.ts`) names the deleted budget file and a 429 that can no longer occur — the text must not reference deleted state.
- **`envWithDotEnv` merge, `harvestedAt` gate, `guardCheckout`, `pushPayload`, episode marker** all survive verbatim.
- **Intermediate typecheck window**: slices 4-6 leave `scripts/probe-linkedin.ts` (and until slice 5, `scripts/fetch-linkedin.ts`) red; the criteria scope the expected error set per slice.

## Scope

### Building

- `src/linkedin-parser.ts` (NEW): the pure Flight extraction core — search-URL builder, row splitter, `$`-ref text walker, guarded `mintPost`, timestamp-zip pairing.
- `tests/linkedin-parser.test.ts` (NEW): restored cases + pairing/chip/guard cases + payload round-trip.
- `src/fetch-threads.ts`: `PageLike.url?()` + production adapter supply.
- `src/linkedin-fetch.ts`: transport half deleted; LinkedIn-local `LinkedInContextFactory` + headless Chromium factory (own dynamic-import quarantine) + the browser walk; `fetchLinkedInPosts` skeleton kept (shuffle, pacing on navigations, drain arms, join, stamp-at-slot-write).
- `src/linkedin-behavior.ts`: `HALT_CHECKPOINT_REASON` added; budget machine + `HALT_BUDGET_REASON` deleted.
- `scripts/fetch-linkedin.ts`: `transport` dep → `contextFactory`; preflight band window → latch; budget wrapper/file deleted; `finally` dispose removed; `scrollRounds` threaded.
- `scripts/probe-linkedin.ts`: rebuilt as a browser-walk gate.
- `scripts/reset-linkedin.ts` + `src/email.ts` + `src/config-file.ts` + `src/config.ts`: de-budgeted, de-voyagered. `reset-linkedin.ts` DELIBERATELY KEPT the budget ledger (file header + `kept` result field + its own log line) — Slice 5 removes the kept-ledger reporting (the `kept` field, the log line, the `DEFAULT_BUDGET` import) and the suite's `kept` assertions; it never deleted the ledger, so there is no delete step to remove.
- Deletions: `src/linkedin-voyager.ts`, `tests/linkedin-voyager.test.ts`, `scripts/setup-curl-impersonate.ts`, `tests/setup-curl-impersonate.test.ts`, `ENV_NAMES.linkedinTransport`, `ENV_NAMES.curlImpersonateBin`, the `setup-curl` npm script, lint/format glob entries, the `.gitignore` `tools/` entry, and `tests/fixture/voyager-search-response.json` (checkpoint-ratified addition: only the deleted voyager suite read it).
- Test rewrites: `tests/linkedin-fetch.test.ts` (walk suite, LinkedIn factory double), `tests/linkedin-behavior.test.ts` (prune + reason pin), `tests/fetch-linkedin.test.ts` (dep shape, budget prune).
- Doc sweep: README, AGENTS.md, the `.rpiv/guidance/*` files.

### Not Building

- The hosted read path (`src/index.ts:300-308`, the digest leg line `src/email.ts:139-142`) — zero changes beyond the halt-alarm wording.
- `src/linkedin-payload.ts` — reused as-is (v2 envelope).
- `scripts/watch-linkedin.ts` — zero changes.
- `scripts/login-linkedin.ts` — zero changes (the cookie-pair harvest is the session model).
- `src/linkedin-session.ts` — zero BEHAVIORAL changes; Slice 7 renames the two storageState types (VoyagerStorage* -> LinkedInStorage*) and de-voyagers four comment lines (checkpoint-ratified scope addition, advisor-mediated 2026-11-11T13:28+0700).
- Persistent-profile sessions; any Threads-walk behavior change beyond the additive `url?()`; a renamed config key.

## Decisions

### Pairing: timestamp-ordered zip (developer, 2026-11-11)

Genuine ambiguity resolved with capture evidence. The i-th distinct commentary text (stream order) pairs with the i-th distinct id sorted by `BigInt(id) >> 22n` ascending. Count mismatch → one warn line naming the counts and the paired ids, mint the paired prefix, drop the remainder visibly. Every call additionally logs ONE `linkedin-parser: N pair(s) — <id-tail>↔"<text head>" ...` line: the stream carries no id↔text link, so a same-count wrong-order zip mints valid-looking posts with no structural detector — the named pairs are the live rehearsal's spot-check oracle. Explored: first-appearance zip (WRONG — row 0 emits B before A), DOM join (2/9 coverage), register + warn (~1/3 silent loss). 3/3 correct on the live capture; per-post verification stays impossible offline (no link exists in the stream).

### Budget machine deleted; volume bound = click cap (developer, 2026-11-11)

FR-8 dropped by explicit developer decision: "delete cap and connect it with how many scroll setting in threads (by default is 8, means 8 times click)". The working-hours window, the 28-33 min cadence, and the per-surface `scrollRounds` click bound replace the 150/day ledger. `state/linkedin-get-budget.json` becomes orphaned (Migration Notes).

### Probe rebuilt as a browser gate (developer, 2026-11-11)

`scripts/probe-linkedin.ts` walks the first configured surface in a real browser; exit 1 on checkpoint/login wall, dead session (no first response), or fewer than 2 posts. The run-twice->=6h-apart ritual stands. Explored: delete the probe (rejected — the only pre-flight check on the leg).

### scrollRounds stays, meaning Load-more clicks (developer, 2026-11-11)

No config schema change: `ALLOWED_KEYS`, the validator, and config tests untouched. The LinkedIn walk reads `scrollRounds` as the per-surface click bound (default 8); the Threads walk keeps its existing meaning.

### LOAD_MORE_SELECTOR: the text handle (captured live, 2026-11-11)

`button:has-text("Load more")` — the live button carries no aria-label and no id, and its class list is a per-deploy hash, so the visible text is the only stable attribute. Uniqueness measured on the live results page: exactly one candidate. The context pins `locale: en-US`, which pins the English label; a LinkedIn copy change breaks the selector visibly (a stream of dry rounds with zero minted posts), not silently.

### Session model: reuse the persistent profile, headed (REVISED, live rehearsal 2026-11-11T18:40+0700)

The original design had the walk open a fresh browser with the harvested cookie document: `chromium.launch({ headless: true })` + `newContext({ storageState: toStorageState(cookies) })`. The rehearsal disproved it. LinkedIn serves that identity a content-search page with NO Load-more button (54 buttons present, 0 matching), so the click loop had nothing to click and the walk reported 3 posts.

**Revised model:** the walk reuses the profile `scripts/login-linkedin.ts` already maintains (`DEFAULT_PROFILE_DIR = "C:/loker-secrets/linkedin-chromium-profile"`, `scripts/login-linkedin.ts:34,127`) via `chromium.launchPersistentContext(PROFILE, { headless: false })`. Measured: 8 posts, the button present, 6 posts per click, and two consecutive runs with no rotation.

**Consequences:**

1. `LinkedInContextFactory` no longer takes a storageState document. Its parameter becomes the profile path (or nothing — the default is the module constant).
2. `toStorageState` and the cookie-completion remap (`expires: -1, httpOnly: false, sameSite: "Lax"`) are no longer on the walk's path. `src/linkedin-session.ts` keeps them for the preflight check.
3. `LINKEDIN_COOKIES_FILE` becomes a preflight validity check (does a session exist and is it fresh), not the browser's credential. `harvestedAt` stays as that gate.
4. Headed is acceptable: this leg runs on the PC (`watch-linkedin`), never in GitHub Actions. The hosted run only reads the payload.
5. `PROBE_HEADED` becomes the default, not an override.
6. The dynamic-import quarantine is unchanged — `launchPersistentContext` still rides the one `await import("playwright")` inside the factory.

**What this does NOT change:** the click loop, the settle window, the response join, the parser, the fault vocabulary, the pacing gate, the payload writer. Those were measured correct.

### Parser pairing: refuse the mint on a count mismatch (REVISED 2026-11-11T18:45+0700 — SUPERSEDED 2026-11-11T19:10+0700, see the Key Discoveries measurement)

The original rule: on a count mismatch, warn and mint the paired prefix. Measured on live bodies, that is wrong. With ids A (8:00), B (8:01), C (8:02) and texts `["hiring post A", "hiring post C"]`, the zip pairs A↔A (correct), then **B↔"hiring post C" (wrong)** and drops C. The gap shifts every pairing after it, so a post is minted with another post's text under its own permalink.

**Revised rule (SUPERSEDED):** on a count mismatch, warn and mint NOTHING for that body. **Measured 2026-11-11T19:10+0700 against working-config bodies: this drops 2 of 3 bodies.** The mismatch is real data (media-only posts with no caption), so refusing trades a mis-pair for starvation. The rule is NOT implemented. The correct fix is to filter CTA components out of the text harvest so the counts match, then the zip is safe without either trade.

**Rejected alternative (measured):** row-local pairing. `collectLinkedInPosts` accumulates `rowIds` and `rowTexts` per row, so pairing row-locally looked viable. Measured against the real capture (136 rows carrying ids or texts): 3 rows have both an id and a text, 130 have ids only, 3 have texts only. Ids and texts live in DIFFERENT rows, so row-local pairing resolves 3 of 6 text rows. Disproved.

### Structural layer duplicated, not shared (artifact-locked)

~120 lines of factory mechanics duplicate into `src/linkedin-fetch.ts` with its own `await import("playwright")` quarantine (the site the deleted playwright transport frees). Widening the shared `ContextFactory` breaks all 3 existing doubles under `strictFunctionTypes`; re-exporting the private factory re-introduces knip N012.

### Parser home: new pure module (developer-ratified)

`src/linkedin-parser.ts` + `tests/linkedin-parser.test.ts` mirror the `linkedin-voyager.ts` pure-core slot it replaces; the walk module imports it, never the reverse.

### Parser fixtures: synthetic Flight bodies built inline (design decision)

Repo convention (`tests/fixture/` holds three trimmed captures; the deleted suite built fixtures inline). The 1.5 MB capture stays scratch (`.rpiv/tmp/`, gitignored); a capture-shaped synthetic body reproduces the 3-text/3-id/chip structure deterministically.

### Fault vocabulary re-mapped (artifact-locked + design)

Checkpoint/login/authwall page URL → `halt(HALT_CHECKPOINT_REASON)` (operator-cleared latch, one alarm) — never `legDead`. No flagship-web response within the window → `legDead` (tagged, one alarm per episode) — never a plain Error (the b1/b2 class). A page still on `/search/results/content` with zero posts → success with the `OK — 0 post(s)` log (defb8af). Parsed-body counter (N008 direction), first-wins urn dedupe.

### Pacing re-seated on navigations (artifact-locked + design)

The shared per-walk gate (5-15s reserve-before-sleep draw) wraps each surface's `goto`; intra-surface clicks ride the existing settle window (~2.5s). `LINKEDIN_FETCH_CONCURRENCY` stays 2. Headless stays true — the first live run is a rehearsal (Verification Notes).

### Deletion sweep re-voyagered the surviving vocabulary (developer + advisor, 2026-11-11)

The Slice 7 bare-word gate (`grep -rn "voyager" src/ scripts/` returns 0 after Slice 7) conflicted with the Scope line promising linkedin-session.ts zero changes: the storageState types still carried the VoyagerStorage* names, and four comment lines described a voyager GET that stopped existing when the transports died. Advisor-ratified resolution: rename VoyagerStorageCookie/VoyagerStorageState -> LinkedInStorageCookie/LinkedInStorageState (src/linkedin-session.ts plus the two consumer lines in src/linkedin-fetch.ts), reword every voyager-era comment line in src/ (eight lines across config/session/parser), amend the Scope line. Test-invisible: no test imports either type name. Also ratified at the same checkpoint: the orphaned fixture tests/fixture/voyager-search-response.json rides the deletion (only the deleted suite read it); the src/env-file.ts hoist comment names scripts/login-linkedin.ts; the tests/env-file.test.ts sample key swaps to SAMPLE_BIN (the locked Slice 8 grep spans tests/ and would otherwise never return 0).

## Architecture

### src/linkedin-parser.ts — NEW

Pure Flight extraction core: search-URL builder, Flight row splitter, $-ref text walker, guarded mintPost, timestamp-zip pairing, and the response-URL filter (LINKEDIN_RESPONSE_RE) the Slice 4 walk reuses.

Slice 7 (deletion sweep) reworded four comment lines inside this fence — no code line changed. Byte-exact applied state: .rpiv/tmp/verify7/src/linkedin-parser.ts.

```ts
/**
 * The LinkedIn content-search Flight parser (the pure core the deleted
 * REST search client held) plus the search-URL builder.
 *
 * The logged-in search app streams results as React Flight bodies
 * ("hex-id":JSON per line) over /flagship-web/search/results/content/
 * (initial page) and /flagship-web/rsc-action/actions/pagination (each
 * "Load more" click — the only pagination trigger; scrolling fires
 * nothing, verified live 2026-11-11). The parser splits the rows,
 * resolves $-references, and mints posts from capture-verified facts:
 *
 * - the activity id lives under ...activityUrn.activityId objects, as
 *   urn:li:activity:<id> strings, and as urn object keys;
 * - the post text lives under the component whose viewTrackingSpecs
 *   carry legacyControlName "commentary_text", inside textProps.children
 *   React element trees (br elements are newlines; "$<row>:props.path"
 *   strings are shared-subtree references). The real text and a short
 *   hashtag chip can share ONE row as sibling components — the row's
 *   LONGEST text is its one candidate (the "#hiring" chip must not mint
 *   a post).
 * - timestamps and permalinks are NOT in the body: the id encodes
 *   creation time as BigInt(id) >> 22n (epoch ms, 4-6 min drift against
 *   the rendered age label, proven on live ids 2026-11-11), and the
 *   permalink constructs as /feed/update/urn:li:activity:<id>.
 *
 * PAIRING (design 2026-11-11, replaces the deleted walk's currentId
 * register): the stream carries NO reachable link between a post's text
 * and its id — BFS over the $-ref graph from every marker row reaches
 * zero id rows, and contentTrackingId is a shared list-level value. The
 * i-th distinct commentary text (stream order) therefore pairs with the
 * i-th usable id sorted by derived time ascending — the page sorts by
 * date_posted, so stream order is time order; the id's high bits ARE the
 * creation clock. A count mismatch warns and mints the paired prefix
 * (the remainder drops VISIBLY, never silently). The deleted register
 * mis-paired 1 of 3 posts on the live capture; the zip pairs 3/3.
 *
 * Member names are absent from the response bodies, so Post.author is a
 * placeholder (the deleted walk's finding, unchanged).
 *
 * mintPost guards its timestamp the way the deleted REST client's
 * id-clock guard did — a BigInt RangeError or a non-positive epoch
 * yields null, never a thrown parse.
 *
 * Testability: every export is a pure string function; importing this
 * module never loads Playwright and touches no I/O (the one warn rides
 * console.warn, the sanctioned offline oracle).
 */
import type { Post } from "./types.js";

/**
 * Digests and judge prompts render this handle for LinkedIn posts: member
 * names exist only in the DOM, which carries no ids to join them with.
 */
const AUTHOR_PLACEHOLDER = "linkedin-member";

/**
 * The content-search URL for one configured surface keyword (measured
 * 2026-11-11 on the live logged-in session; the params are structural,
 * not session-specific: origin, the date_posted sort, the past-24h
 * filter — sortBy:date_posted is the REAL recency switch (the §12.4
 * sort finding, carried over to the web app).
 */
const SEARCH_URL_PREFIX = "https://www.linkedin.com/search/results/content/";
const SEARCH_URL_PARAMS =
  "&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D";

/** Build the content-search URL for one raw surface keyword. */
export function buildContentSearchUrl(keywords: string): string {
  return `${SEARCH_URL_PREFIX}?keywords=${encodeURIComponent(keywords)}${SEARCH_URL_PARAMS}`;
}

/** The two flagship-web endpoints that carry search posts (capture 2026-10-31, re-verified 2026-11-11). */
export const LINKEDIN_RESPONSE_RE =
  /flagship-web\/(search\/results\/content|rsc-action\/actions\/pagination)/i;

const FLIGHT_LINE_RE = /^([0-9a-f]+):([\s\S]*)$/;
const WHOLE_REF_RE = /^\$L?([0-9a-f]+)$/;
const PATH_REF_RE = /^\$L?([0-9a-f]+):(.+)$/;
const URN_RE = /^urn:li:activity:(\d{10,})$/;
const DIGITS_RE = /^\d{10,}$/;

/**
 * Split a flight stream and JSON-parse every data row. Lines outside the
 * "hex-id":payload form, and module-manifest rows like I[...], are skipped.
 * Row order is stream order. (Restored verbatim from 68c1e2d.)
 */
export function parseFlightRows(body: string): Map<string, unknown> {
  const rows = new Map<string, unknown>();
  for (const line of body.split("\n")) {
    const match = FLIGHT_LINE_RE.exec(line);
    if (match === null) continue;
    try {
      rows.set(match[1] ?? "", JSON.parse(match[2] ?? ""));
    } catch {
      // module-manifest rows are not JSON; skip them
    }
  }
  return rows;
}

/**
 * Leaf strings of a textProps.children React tree: element arrays
 * (["$", type, key, props]) recurse into props.children and props.textProps
 * only, so class names, styles and action payloads stay out of the text.
 * br elements become newlines. "$<row>" strings resolve whole rows and
 * "$<row>:props.path" strings resolve path-scoped values (memoized); a
 * triple newline collapses to one paragraph break. (Restored verbatim.)
 */
function textFromChildren(children: unknown, rows: Map<string, unknown>): string {
  const parts: string[] = [];
  const seenRows = new Set<string>();
  const memo = new Map<string, unknown>();
  const resolve = (id: string, path: string | undefined): unknown => {
    const root: unknown = rows.get(id);
    if (root === undefined) return undefined;
    if (path === undefined) return root;
    const key = `${id}:${path}`;
    const cached: unknown = memo.get(key);
    if (cached !== undefined) return cached;
    let current: unknown = root;
    for (const segment of path.split(":")) {
      if (current === null || typeof current !== "object") return undefined;
      current = Array.isArray(current)
        ? current[Number(segment)]
        : (current as Record<string, unknown>)[segment];
      if (current === undefined) return undefined;
    }
    memo.set(key, current);
    return current;
  };
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      const whole = WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (rows.has(id) && !seenRows.has(id)) {
          seenRows.add(id);
          walk(rows.get(id));
        }
        return;
      }
      const scoped = PATH_REF_RE.exec(node);
      if (scoped !== null) {
        walk(resolve(scoped[1] ?? "", scoped[2]));
        return;
      }
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 0 && node[0] === "$") {
        if (node[1] === "br") {
          parts.push("\n");
          return;
        }
        const props: unknown = node[3];
        if (props !== null && typeof props === "object" && !Array.isArray(props)) {
          const record = props as Record<string, unknown>;
          if (record.children !== undefined) walk(record.children);
          if (record.textProps !== undefined) walk(record.textProps);
        }
        return;
      }
      for (const child of node) walk(child);
      return;
    }
    if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.children !== undefined) walk(record.children);
    }
  };
  walk(children);
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Mint one Post from capture-verified facts; the id carries the timestamp.
 * Returns null on a unusable id (BigInt RangeError or non-positive epoch)
 * — the guarded id-clock contract — so a broken id can
 * never mint a post with an invalid Date. (Restored + guarded.)
 */
function mintPost(activityId: string, text: string): Post | null {
  let timestamp: string;
  try {
    const ms = BigInt(activityId) >> 22n;
    if (ms <= 0n) return null;
    timestamp = new Date(Number(ms)).toISOString();
  } catch {
    return null;
  }
  const urn = `urn:li:activity:${activityId}`;
  return {
    platform: "linkedin",
    id: urn,
    text,
    author: AUTHOR_PLACEHOLDER,
    permalink: `https://www.linkedin.com/feed/update/${urn}`,
    timestamp,
  };
}

/**
 * Mint every post a flight body carries: distinct commentary texts in
 * stream order paired with distinct usable ids in derived-time order
 * (see the module header for the pairing rule and its evidence). The
 * walk tracks, per row: every activity id it passes (urn strings,
 * activityId fields, urn object keys) and ONE text candidate — the row's
 * longest commentary text, so the sibling hashtag chip never wins. A
 * text/id count mismatch warns and pairs the prefix; a marker row whose
 * text harvest is empty, and an id that fails the timestamp guard, drop
 * without minting.
 */
export function collectLinkedInPosts(body: string): Post[] {
  const rows = parseFlightRows(body);
  const ids: string[] = [];
  const texts: string[] = [];
  const seenTexts = new Set<string>();
  for (const root of rows.values()) {
    const seenRows = new Set<string>();
    const rowIds = new Set<string>();
    const rowTexts: string[] = [];
    const visit = (node: unknown): void => {
      if (typeof node === "string") {
        const urn = URN_RE.exec(node);
        if (urn !== null) {
          rowIds.add(urn[1] ?? "");
          return;
        }
        const whole = WHOLE_REF_RE.exec(node);
        if (whole !== null) {
          const id: string = whole[1] ?? "";
          if (rows.has(id) && !seenRows.has(id)) {
            seenRows.add(id);
            visit(rows.get(id));
          }
        }
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      if (node !== null && typeof node === "object") {
        const record = node as Record<string, unknown>;
        const activityId: unknown = record.activityId;
        if (typeof activityId === "string" && DIGITS_RE.test(activityId)) {
          rowIds.add(activityId);
        }
        const specs: unknown = record.viewTrackingSpecs;
        if (
          specs !== null &&
          typeof specs === "object" &&
          (specs as Record<string, unknown>).legacyControlName === "commentary_text"
        ) {
          const text = textFromChildren(record.children, rows);
          if (text.length > 0) rowTexts.push(text);
          return; // the commentary subtree is text; it carries no ids
        }
        for (const key of Object.keys(record)) {
          const urnKey = URN_RE.exec(key);
          if (urnKey !== null) rowIds.add(urnKey[1] ?? "");
        }
        for (const key of Object.keys(record)) visit(record[key]);
      }
    };
    visit(root);
    for (const id of rowIds) {
      if (!ids.includes(id)) ids.push(id);
    }
    if (rowTexts.length > 0) {
      const best = rowTexts.reduce((a, b) => (b.length > a.length ? b : a));
      if (!seenTexts.has(best)) {
        seenTexts.add(best);
        texts.push(best);
      }
    }
  }
  // Usable ids only: a BigInt RangeError or a non-positive epoch would
  // mint an invalid Date — filter before the sort, the mintPost guard's
  // contract applied one step earlier.
  const usable = ids.filter((id) => {
    try {
      return BigInt(id) >> 22n > 0n;
    } catch {
      return false;
    }
  });
  // >> 22n is monotonic for positive bigints, so numeric id order IS
  // derived-time order (the live capture's 22:11 < 22:16 < 22:18). The
  // comparator is total (-1/0/1); equality cannot occur because ids are
  // deduped upstream, and a total comparator stays correct if that
  // precondition ever drifts.
  const sorted = [...usable].sort((a, b) => {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const paired = Math.min(sorted.length, texts.length);
  if (sorted.length !== texts.length) {
    console.warn(
      `linkedin-parser: id/text count mismatch (${texts.length} text(s), ${sorted.length} id(s)) — pairing the first ${paired} by timestamp order`,
    );
  }
  const posts: Post[] = [];
  for (let i = 0; i < paired; i += 1) {
    const post = mintPost(sorted[i] ?? "", texts[i] ?? "");
    if (post !== null) posts.push(post);
  }
  // The spot-check oracle: the stream carries no id<->text link, so a
  // same-count wrong-order zip mints valid-looking posts. This one line
  // per body names every pairing; the live rehearsal reads it against
  // the rendered page.
  console.log(
    `linkedin-parser: ${posts.length} pair(s) — ${posts
      .map((post) => `${post.id.slice(-6)}↔"${post.text.slice(0, 25)}"`)
      .join(", ")}`,
  );
  return posts;
}
```

### tests/linkedin-parser.test.ts — NEW

Offline parser suite: the restored 68c1e2d collectLinkedInPosts/parseFlightRows cases re-based on the timestamp-zip pairing rule, plus the pairing, hashtag-chip, timestamp-guard, oracle-log, and payload round-trip cases the restored suite never carried. Synthetic inline fixtures (repo convention; the 1.5 MB capture stays scratch).

```ts
/**
 * Offline suite for the LinkedIn Flight parser core (slice 2): the
 * restored 68c1e2d collectLinkedInPosts/parseFlightRows cases re-based
 * on the timestamp-zip pairing rule (design 2026-11-11), plus the
 * pairing, hashtag-chip, timestamp-guard, oracle-log, and payload
 * round-trip cases the restored suite never carried.
 *
 * FIXTURE PROVENANCE: every Flight body is a synthetic literal built in
 * the captured field layout — commentary_text view marker,
 * textProps.children React element trees, activityUrn.activityId ids,
 * "$<row>" / "$<row>:path" references (evidence: the deleted walk's
 * suite at 68c1e2d and the 2026-11-10 live capture,
 * .rpiv/tmp/linkedin-pagination-body.txt). The capture-shaped body
 * mints ids with the (BigInt(epochMs) << 22n) forward trick (the
 * tests/index.test.ts idiom) from the live capture's pinned epochs, so
 * BigInt(id) >> 22n recovers them exactly; no real member data rides in
 * this file. Importing the module under test never loads Playwright.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  LINKEDIN_RESPONSE_RE,
  buildContentSearchUrl,
  collectLinkedInPosts,
  parseFlightRows,
} from "../src/linkedin-parser.js";
import { readPayloadPosts, writePayloadAtomic } from "../src/linkedin-payload.js";
import type { Post } from "../src/types.js";

/** Capture-verified ids (the deleted walk's suite, research 2026-10-31): BigInt(id) >> 22n pins both epochs. */
const ID_A = "7522028760582447104"; // 2026-10-30T20:16:49.059Z
const ID_B = "7522121950970900481"; // 2026-10-31T02:27:07.379Z

/** The 2026-11-10 live capture's three pinned epochs (design Key Discoveries). */
const FULL_STACK_MS = Date.UTC(2026, 10, 10, 22, 11, 39, 858);
const CHEF_MS = Date.UTC(2026, 10, 10, 22, 16, 28, 628);
const PCB_MS = Date.UTC(2026, 10, 10, 22, 18, 16, 583);

/** Mint one capture-shaped id: the forward trick, the exact inverse of BigInt(id) >> 22n. */
const idFor = (ms: number): string => (BigInt(ms) << 22n).toString();

/** The capture's three posts, text-first, in stream (= page) order. */
const FULL_STACK_TEXT =
  "Full-Stack Developer (Remote) — Indonesian product team, React + Node. DM for the JD.";
const CHEF_TEXT = "Chef needed for a new restaurant in Bandung. Send your CV and expected salary.";
const PCB_TEXT =
  "PCB layout engineer at a Jakarta hardware startup. 3+ years of Altium experience.";

/** One flight line. */
const row = (id: string, payload: unknown): string => `${id}:${JSON.stringify(payload)}`;

let cardSeq = 0;

/** Self-contained card stream: the activityUrn row precedes the commentary_text row. */
const cardBody = (id: string, text: string): string => {
  const n = (cardSeq += 1) * 10;
  return [
    row(String(n), { tracking: { activityUrn: { activityId: id } } }),
    row(String(n + 1), [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: [text] } }],
      },
    ]),
  ].join("\n");
};

/**
 * One card carrying the real text AND the short "#hiring" chip as
 * sibling commentary_text components in the SAME row (capture row 34,
 * 2026-11-11: 1923-char post + 7-char chip, identical specs except the
 * chip's interactionTypes is a $-ref). The row's LONGEST text must win.
 */
const chipCardBody = (id: string, text: string, chip: string): string => {
  const n = (cardSeq += 1) * 10;
  const marker = (innerText: string): unknown => [
    "$",
    "$Lmark",
    null,
    {
      viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
      children: ["$", "$Ldiv", null, { textProps: { children: [innerText] } }],
    },
  ];
  return [
    row(String(n), { tracking: { activityUrn: { activityId: id } } }),
    row(String(n + 1), [marker(text), marker(chip)]),
  ].join("\n");
};

/** One captured card, trimmed: strong/br elements, a plain string, and a
 * "$3:textProps:children" shared-subtree path reference in the text. */
const richCardBody = (): string =>
  [
    row("1", { tracking: { activityUrn: { activityId: ID_A } } }),
    row("2", [
      "$",
      "$L3",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: [
          "$",
          "$Ltext",
          null,
          {
            textProps: {
              fontFamily: "sans",
              children: [
                ["$", "strong", "text-attr-0", { children: ["WE ARE HIRING"] }],
                ["$", "br", "0", {}],
                "Calling new grads in Vancouver.",
                "$3:textProps:children",
              ],
            },
          },
        ],
      },
    ]),
    row("3", { textProps: { children: ["Shared tail"] } }),
  ].join("\n");

/**
 * The capture-shaped body (design Decision "Pairing"): three distinct
 * texts in stream order (Full-Stack, Chef, PCB) and three ids whose
 * FIRST-APPEARANCE order is NOT time order (the latest id rides the
 * first card — the capture's "row 0 emits B before A" fact), so a
 * first-appearance zip mispairs all three and the timestamp zip must
 * pair 3/3.
 */
const captureBody = (): string =>
  [
    '0:I["$1",[],"default"]', // module-manifest row — skipped
    "not-a-flight-line", // garbage — skipped
    cardBody(idFor(PCB_MS), FULL_STACK_TEXT),
    cardBody(idFor(FULL_STACK_MS), CHEF_TEXT),
    cardBody(idFor(CHEF_MS), PCB_TEXT),
  ].join("\n");

describe("buildContentSearchUrl", () => {
  it("reproduces the 2026-11-11 live search URL byte-for-byte (origin, date_posted sort, past-24h)", () => {
    assert.equal(
      buildContentSearchUrl("hiring indonesia"),
      "https://www.linkedin.com/search/results/content/?keywords=hiring%20indonesia&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D",
    );
  });

  it("encodes a # keyword at the query layer — a raw # would truncate the GET query (§12.5 carry-over)", () => {
    assert.equal(
      buildContentSearchUrl("#hiring react"),
      "https://www.linkedin.com/search/results/content/?keywords=%23hiring%20react&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D",
    );
  });
});

describe("LINKEDIN_RESPONSE_RE", () => {
  it("matches the initial content-search response URL", () => {
    assert.ok(
      LINKEDIN_RESPONSE_RE.test(
        "https://www.linkedin.com/flagship-web/search/results/content/?keywords=x",
      ),
    );
  });

  it("matches the Load-more pagination action response URL", () => {
    assert.ok(
      LINKEDIN_RESPONSE_RE.test(
        "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination",
      ),
    );
  });

  it("rejects unrelated responses — the walk's body filter must never fire on a Threads response", () => {
    assert.equal(LINKEDIN_RESPONSE_RE.test("https://www.threads.com/api/graphql"), false);
    assert.equal(
      LINKEDIN_RESPONSE_RE.test("https://www.linkedin.com/voyager/api/search/blended"),
      false,
    );
  });
});

describe("parseFlightRows", () => {
  it("parses data rows in stream order and skips module-manifest rows and garbage lines", () => {
    const rows = parseFlightRows(
      ['0:I["$1",[],"default"]', row("1", { a: 1 }), row("2", [1, 2])].join("\n"),
    );
    assert.deepEqual([...rows.keys()], ["1", "2"]);
    assert.deepEqual(rows.get("1"), { a: 1 });
  });
});

describe("collectLinkedInPosts", () => {
  it("mints the restored capture-verified card: path-ref text, br newline, urn id, id-derived timestamp", () => {
    const posts = collectLinkedInPosts(richCardBody());
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0], {
      platform: "linkedin",
      id: `urn:li:activity:${ID_A}`,
      text: "WE ARE HIRING\nCalling new grads in Vancouver.Shared tail",
      author: "linkedin-member",
      permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${ID_A}`,
      timestamp: "2026-10-30T20:16:49.059Z",
    });
  });

  it("pairs capture-shaped texts (stream order) with ids (time order) 3/3 — not first-appearance order", () => {
    const posts = collectLinkedInPosts(captureBody());
    assert.deepEqual(
      posts.map((post) => [post.text, post.timestamp]),
      [
        [FULL_STACK_TEXT, new Date(FULL_STACK_MS).toISOString()],
        [CHEF_TEXT, new Date(CHEF_MS).toISOString()],
        [PCB_TEXT, new Date(PCB_MS).toISOString()],
      ],
    );
  });

  it("keeps the sibling hashtag chip out of the mint (the row's longest commentary text wins)", () => {
    const posts = collectLinkedInPosts(chipCardBody(ID_A, CHEF_TEXT, "#hiring"));
    assert.equal(posts.length, 1);
    assert.equal((posts[0] as Post).text, CHEF_TEXT);
    assert.ok(posts.every((post) => post.text !== "#hiring"));
  });

  it("dedupes a repeated activity id, keeps the first mint, and warns the 2-text/1-id mismatch", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const body = [cardBody(ID_A, "first"), cardBody(ID_A, "second")].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [[`urn:li:activity:${ID_A}`, "first"]],
    );
    assert.match(
      String(warns.mock.calls[0]?.arguments[0] ?? ""),
      /id\/text count mismatch \(2 text\(s\), 1 id\(s\)\)/,
    );
  });

  it("pairs the prefix when ids outnumber texts (1 text, 2 ids) and warns", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const body = [
      cardBody(ID_A, "only text"),
      row("9", { tracking: { activityUrn: { activityId: ID_B } } }),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${ID_A}`],
    );
    assert.match(
      String(warns.mock.calls[0]?.arguments[0] ?? ""),
      /id\/text count mismatch \(1 text\(s\), 2 id\(s\)\)/,
    );
  });

  it("drops an id the timestamp guard rejects (leading zeros mint a non-positive epoch) and warns", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const posts = collectLinkedInPosts(cardBody("0000000001", "text without a usable id"));
    assert.deepEqual(posts, []);
    assert.match(String(warns.mock.calls[0]?.arguments[0] ?? ""), /\(1 text\(s\), 0 id\(s\)\)/);
  });

  it("drops a commentary marker whose text harvest is empty (br-only children) and warns", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const n = (cardSeq += 1) * 10;
    const body = [
      row(String(n), { tracking: { activityUrn: { activityId: ID_A } } }),
      row(String(n + 1), [
        "$",
        "$Lmark",
        null,
        {
          viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
          children: ["$", "$Ldiv", null, { textProps: { children: [["$", "br", "0", {}]] } }],
        },
      ]),
    ].join("\n");
    assert.deepEqual(collectLinkedInPosts(body), []);
    assert.match(String(warns.mock.calls[0]?.arguments[0] ?? ""), /\(0 text\(s\), 1 id\(s\)\)/);
  });

  it("skips module-manifest rows and garbage lines around the data rows", () => {
    const body = ['0:I["$1",[],"default"]', "not-a-flight-line", richCardBody()].join("\n");
    assert.equal(collectLinkedInPosts(body).length, 1);
  });

  it("collapses 3+ newlines to one paragraph break in minted text", () => {
    const posts = collectLinkedInPosts(cardBody(ID_A, "a\n\n\n\nb"));
    assert.equal((posts[0] as Post).text, "a\n\nb");
  });

  it("logs one pairing-oracle line per call naming each minted id ↔ text head", (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = collectLinkedInPosts(captureBody());
    assert.equal(posts.length, 3);
    assert.equal(logs.mock.callCount(), 1);
    const line = String(logs.mock.calls[0]?.arguments[0] ?? "");
    assert.match(line, /^linkedin-parser: 3 pair\(s\) — /);
    assert.ok(line.includes(`↔"${FULL_STACK_TEXT.slice(0, 25)}"`));
    assert.ok(line.includes(`↔"${PCB_TEXT.slice(0, 25)}"`));
  });
});

describe("payload round-trip", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("writePayloadAtomic → readPayloadPosts keeps minted posts whole (leg ok, zero drops)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-parser-"));
    const path = join(dir, "linkedin-posts.json");
    const NOW = Date.UTC(2026, 10, 11, 8, 0, 0);
    const minted = collectLinkedInPosts(captureBody());
    await writePayloadAtomic(minted, path, () => NOW);
    const read = await readPayloadPosts(path, () => NOW + 60_000);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, minted);
    assert.equal(warns.mock.callCount(), 0); // a dropped row would warn "malformed row(s)"
  });
});
```

### src/fetch-threads.ts:90-104,141-176 — MODIFY

`PageLike.url?()` and the production adapter supply.

```ts
// Byte-exact applied state: .rpiv/tmp/verify3/src/fetch-threads.ts (scratch kept as evidence).
// Two additive hunks — nothing else in the file changes in this slice.

// Hunk 1 — export interface PageLike: insert between the goto member and waitForFunction:
  /**
   * The page's current URL after navigation, for URL-level detectors (the
   * LinkedIn walk's checkpoint detector is the only consumer). Optional so
   * the existing structural doubles stay assignable without edits.
   */
  url?(): string;

// Hunk 2 — makeChromiumContextFactory, newPage return object: insert as the first
// property (the object is contextually typed by the annotated Promise<PageLike> return,
// so the new optional member just satisfies it):
          url: () => page.url(),
```

### src/linkedin-behavior.ts — MODIFY

Budget machine + HALT_BUDGET_REASON + localDateKey deleted (post-Slice-5 state; the Slice 3 HALT_CHECKPOINT_REASON insert rides inside). Full merged file:

```ts
/**
 * Behavioral policy machines for the PC-local LinkedIn leg (the
 * anti-restriction profile, design 2026-11-09; the daily GET budget
 * machine deleted by the browser-walk migration 2026-11-11): the
 * working-hours window, the jittered wake cadence, and the halt-latch
 * reason vocabulary.
 *
 * Extraction idiom (src/judge-rotation.ts:5-7): pure machines + constants
 * live here; IO and policy placement stay at the consumer
 * (scripts/fetch-linkedin.ts wires the preflight band,
 * scripts/watch-linkedin.ts wires the loop cadence). The module is
 * IO-free: dates and rng draws arrive as arguments, so the offline suite
 * pins every edge with zero doubles.
 *
 * Worst-case arithmetic (the account-safety bound): the window is 13
 * hours = 780 minutes; at the 28-minute floor that is at most 28 wake-ups
 * per local day, and each wake walks at most 5 surfaces x (1 navigation
 * + scrollRounds Load-more clicks). The window lives here; the click cap
 * rides the walk (src/linkedin-fetch.ts).
 */

/**
 * Local hour the working window opens at (inclusive): Mon-Fri 08:00-21:00
 * local (FR-1). Unmeasured values stay constants.
 */
export const WINDOW_START_HOUR = 8;

/**
 * Local hour the working window closes at — EXCLUSIVE, so 21:00:00.000 is
 * already outside. The half-open [start, end) pair makes the 20:59/21:00
 * boundary unambiguous.
 */
export const WINDOW_END_HOUR = 21;

/**
 * True when `at` falls inside the working window: Monday-Friday, local
 * 08:00 <= time-of-day < 21:00. Every read is LOCAL — never UTC — so the
 * window tracks the operator's clock. The weekday guard uses getDay()
 * (0 = Sunday, 6 = Saturday); 1-5 is the Mon-Fri band. Boundary pins:
 * 07:59:59.999 false, 08:00:00.000 true, 20:59:59.999 true, 21:00:00.000
 * false.
 */
export function isWithinWorkingHours(at: Date): boolean {
  const day = at.getDay();
  if (day < 1 || day > 5) return false;
  const hour = at.getHours();
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/**
 * The jitter draw seam: a Math.random-shaped function over [0, 1). The
 * codebase's first rng seam — injected everywhere so the offline suite
 * pins bounds and permutations without ambient randomness.
 */
export type RandomFn = () => number;

/** Wake floor: 28 minutes. Uniform draw lower bound, inclusive. */
export const WAKE_MIN_MS = 28 * 60_000;

/**
 * Wake ceiling: 33 minutes. Exclusive — a Math.random contract never
 * returns 1, so floor() keeps every draw at most MAX - 1 ms and a tick can
 * never sit exactly at the ceiling. The payload staleness amendment
 * (PAYLOAD_MAX_AGE_MS 30 -> 40 min) clears this worst case with margin.
 */
export const WAKE_MAX_MS = 33 * 60_000;

/**
 * One uniform draw in [WAKE_MIN_MS, WAKE_MAX_MS), whole milliseconds
 * (floor, never round — rounding could land ON the exclusive ceiling).
 * rng() === 0 pins the floor exactly; the loop logs the delay in minutes.
 */
export function sampleTickDelayMs(rng: RandomFn): number {
  return Math.floor(WAKE_MIN_MS + rng() * (WAKE_MAX_MS - WAKE_MIN_MS));
}

/**
 * Canonical reason string a 429 writes into the halt-latch flag and its
 * alarm (FR-7). One constant, two readers (flag content, email body), so
 * the latch file's content always explains itself.
 */
export const HALT_RATE_LIMIT_REASON =
  "HTTP 429 rate limit — LinkedIn told this account to slow down";

/**
 * Canonical reason string a security checkpoint or login wall writes into
 * the halt-latch flag and its alarm (FR-7, browser-walk migration
 * 2026-11-11). One constant, two readers (flag content, email body), so
 * the latch file's content always explains itself. The message names the
 * one remedy: a re-harvest.
 */
export const HALT_CHECKPOINT_REASON =
  "LinkedIn security checkpoint or login wall — re-harvest the session (npm run login-linkedin)";
```

### src/linkedin-fetch.ts — MODIFY

Wholesale rewrite (the whole file changes, so the full post-Slice-4 file rides below; the original is on disk at HEAD). Transport half deleted; the browser walk - checkpoint detector, Load-more click loop, flagship-web response join - replaces the voyager walk; `fetchLinkedInPosts` rewired onto the LinkedInContextFactory seam with `scrollRounds` as the per-surface click bound. The locked Slice 3 factory section rides inside, byte-exact.

~~Slice 7 renames the storageState type at the import block and the factory signature (2 lines).~~ **OBSOLETE 2026-11-11T18:40+0700:** the factory no longer imports `LinkedInStorageState` at all — the profile carries the session. Slice 7's rename still applies to `src/linkedin-session.ts` itself; the two consumer lines in `src/linkedin-fetch.ts` are gone.

```ts
/**
 * The LinkedIn fetch leg (browser-walk migration, design 2026-11-11):
 * a real Playwright browser walks the logged-in content-search page —
 * one paced navigation plus up to `scrollRounds` "Load more" clicks per
 * surface — through the runPool surface walk the transport leg built.
 *
 * Session: the LinkedInContextFactory (below) opens the persistent PROFILE
 * scripts/login-linkedin.ts maintains, headed; the walk owns the context
 * and closes it on every path. REVISED 2026-11-11T18:40+0700 after the live
 * rehearsal: a fresh browser with the harvested cookie document gets a page
 * with no Load-more button, so the click loop had nothing to click. The
 * profile gets the button and paginates 6 posts per click.
 *
 * Extraction: every response whose URL matches LINKEDIN_RESPONSE_RE and
 * whose status is 200 parses through src/linkedin-parser.ts (pure,
 * never throws); minted posts dedupe FIRST-WINS by urn — a post seen on
 * an earlier body keeps its first mint.
 *
 * Fault vocabulary (design decision "Fault vocabulary re-mapped"):
 * - a checkpoint/login/authwall page URL (checked after the navigation,
 *   on every liveness poll tick, and after every click settle) throws
 *   the tagged HaltError carrying HALT_CHECKPOINT_REASON — the
 *   operator-cleared latch, never leg-dead;
 * - no flagship-web response inside the liveness window throws the
 *   tagged LegDeadError — one alarm per episode via the repo-local
 *   marker; a plain Error (the b1/b2 class) never reaches the join;
 * - anything else is a per-surface fault (warn + skip, the index arm
 *   owns the per-surface skip summary).
 *
 * The walk reuses runPool — verified contract: runPool RETURNS VOID
 * (src/pool.ts:33-52), so results ride caller-owned side arrays indexed
 * by the claim index, the worker stays total for surface faults, and
 * leg-dead/halt abort via the repo's drain-then-throw shape (judgePosts
 * fallback pool, src/judge.ts:681; fast-workflow-runtime D11). A shared
 * per-walk pacing gate (5-15 s between NAVIGATIONS, any surface) keeps
 * the global navigation rate identical to a sequential walk — the
 * anti-bot rate is pacing-bound, not width-bound. Intra-surface
 * Load-more clicks ride the ~2.5 s settle window and never trip the gate.
 *
 * Testability: importing this module never loads Playwright — the one
 * dynamic await import lives inside makeLinkedInContextFactory (the site
 * the deleted playwright request transport frees) — and the offline
 * suite injects structural ContextLike doubles.
 */
import type { Surface } from "./config-file.js";
import type { ContextLike, LocatorLike, PageLike } from "./fetch-threads.js";
import { HALT_CHECKPOINT_REASON, type RandomFn } from "./linkedin-behavior.js";
import {
  LINKEDIN_RESPONSE_RE,
  buildContentSearchUrl,
  collectLinkedInPosts,
} from "./linkedin-parser.js";
// REVISED 2026-11-11T18:40+0700: the walk no longer imports the cookie
// document or toStorageState — the persistent profile carries the session.
// resolveLinkedInCookies stays a CALLER-side preflight.
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

/** One configured linkedin surface (raw keyword string, never a URL). */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;

/** Injectable sleep for the pacing gate (judge.ts trailing-param idiom). */
export type SleepFn = (ms: number) => Promise<void>;

/** Walk width. The pacing gate, not this number, bounds the navigation rate. */
export const LINKEDIN_FETCH_CONCURRENCY = 2;

/** Pace floor: minimum spacing between page navigations, shared across surfaces (§13.3). */
export const PACE_MIN_MS = 5_000;

/**
 * Pace ceiling: EXCLUSIVE upper bound of the spacing draw (the anti-
 * restriction profile's 5-15 s band, design 2026-11-09). floor() keeps a
 * draw at most MAX - 1 ms, mirroring the wake-cadence bounds.
 */
export const PACE_MAX_MS = 15_000;

// --- browser-walk tuning (the deleted walk's constants that carry over,
//     plus the Load-more mechanics new in the 2026-11-11 design) ---

/**
 * The Load-more button handle (live capture 2026-11-11, design Decision
 * "LOAD_MORE_SELECTOR"): the button carries no aria-label and no id, and
 * its class list is a per-deploy hash — the visible text is the only
 * stable attribute. The context pins locale en-US, which pins this
 * English label; a LinkedIn copy change breaks the selector VISIBLY (a
 * stream of dry rounds with zero minted posts), never silently.
 */
const LOAD_MORE_SELECTOR = 'button:has-text("Load more")';

/** Per-click settle: the pagination response lands inside this window (the deleted walk's constant). */
const LINKEDIN_SETTLE_MS = 2_500;

/** The Load-more visibility window before a round counts dry. */
const LINKEDIN_LOAD_MORE_WAIT_MS = 5_000;

/** Consecutive low-gain rounds before the surface exits early (the Threads loop's shape). */
const LINKEDIN_MAX_DRY_ROUNDS = 3;

/** A round gaining fewer posts than this is dry (the Threads loop's threshold). */
const LINKEDIN_MIN_GAIN = 2;

/** Loop-bound default (the config scrollRounds key overrides; the Threads walk carries the same fallback). */
const LINKEDIN_DEFAULT_SCROLL_ROUNDS = 8;

/** Per-surface post cap (rides from the deleted walk; the perf budget assumes it). */
const LINKEDIN_MAX_POSTS = 150;

/** Final drain: let in-flight response bodies land before the page closes. */
const LINKEDIN_XHR_DRAIN_MS = 1_500;

/** One page navigation's wall-clock cap. */
const LINKEDIN_NAV_TIMEOUT_MS = 30_000;

/** The first flagship-web response must land inside this window, or the leg is dead. */
const LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS = 30_000;

/** Liveness poll interval for the first flagship-web response. */
const LINKEDIN_FIRST_RESPONSE_POLL_MS = 250;

/**
 * The checkpoint/login/authwall page-URL detector (FR-7): LinkedIn
 * interposes these paths when the session tripped a security challenge
 * or died — the account-safety terminal (halt), never a leg-dead.
 * Segment-bounded, so a keyword that contains "login" can never false-
 * positive: query values ride after "=" or percent-encoded, never as a
 * bare path segment.
 */
const LINKEDIN_CHECKPOINT_URL_RE = /(^|\/)(checkpoint|authwall|login)(\/|$|\?)/i;

// --- LegDeadError: the tagged-error idiom (judge-rotation.ts:51-75) ---

export const LEG_DEAD = "LegDeadError";

/**
 * Thrown once per tick when the session leg is dead (D7). Factory-assigned
 * fields stay mutable — the RotationExhausted idiom (judge-rotation.ts:61-70).
 */
export interface LegDead extends Error {
  name: string;
  reason: string;
}

export function legDead(reason: string): LegDead {
  const error = new Error(`linkedin-fetch: leg dead — ${reason}`) as LegDead;
  error.name = LEG_DEAD;
  error.reason = reason;
  return error;
}

export function isLegDead(error: unknown): error is LegDead {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === LEG_DEAD
  );
}

// --- AllSurfacesFaulted: the tagged-error idiom (judge-rotation.ts:51-75) ---

export const ALL_SURFACES_FAULTED = "AllSurfacesFaulted";

/** Thrown when EVERY configured surface faulted and none published posts (D13: the tick, not the walk, decides the write). */
export interface AllSurfacesFaulted extends Error {
  name: string;
  faulted: number;
}

export function allSurfacesFaulted(faulted: number): AllSurfacesFaulted {
  const error = new Error(
    `linkedin-fetch: all ${faulted} surface(s) faulted — nothing fetched`,
  ) as AllSurfacesFaulted;
  error.name = ALL_SURFACES_FAULTED;
  error.faulted = faulted;
  return error;
}

export function isAllSurfacesFaulted(error: unknown): error is AllSurfacesFaulted {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === ALL_SURFACES_FAULTED
  );
}

// --- HaltError: the tagged-error idiom (judge-rotation.ts:51-75) ---
// The account-safety terminal (design 2026-11-09): a security checkpoint
// or login wall stops the walk and fetchTick trips the operator-cleared
// latch. It deliberately does NOT ride LegDeadError: a dead session
// self-heals on a cookie refresh, a halt must not.

export const HALT = "HaltError";

/** Thrown once per walk when the account hit the account-safety terminal. */
export interface Halt extends Error {
  name: string;
  reason: string;
}

export function halt(reason: string): Halt {
  const error = new Error(`linkedin-fetch: halt — ${reason}`) as Halt;
  error.name = HALT;
  error.reason = reason;
  return error;
}

export function isHalt(error: unknown): error is Halt {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === HALT;
}

// --- the LinkedIn browser context factory (browser-walk migration,
//     design 2026-11-11) ---

/**
 * The LinkedIn walk's context factory seam: one persistent PROFILE PATH in,
 * one session-carrying browser context out. NOT the shared ContextFactory
 * (fetch-threads.ts): that seam carries a storage-state PATH and a headless
 * launch, and widening it breaks all three existing doubles under
 * strictFunctionTypes — the launch/adapter mechanics duplicate here instead
 * (design decision "Structural layer duplicated, not shared"; re-exporting
 * the private shared factory re-introduces the knip N012 dead-export
 * finding).
 *
 * REVISED 2026-11-11T18:40+0700 (live rehearsal): the original seam took a
 * storageState DOCUMENT synthesized from the harvested cookie pair and
 * opened a FRESH browser. LinkedIn serves that identity a content-search
 * page with NO Load-more button (54 buttons present, 0 matching), so the
 * click loop had nothing to click and the walk reported 3 posts. The
 * profile + headed configuration gets the button and paginates 6 posts per
 * click. See Key Discoveries for the four-config matrix.
 */
export type LinkedInContextFactory = (profileDir: string) => Promise<ContextLike>;

/** The pinned UA (the shared Threads factory's hardening set, duplicated with this section). */
const LINKEDIN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * The webdriver patch, kept as a string so the Node build needs no DOM lib
 * (locked tsconfig: lib ES2023, types node) — the shared factory's idiom.
 */
const LINKEDIN_WEBDRIVER_PATCH =
  "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });";

/**
 * Build the LinkedIn browser context on the persistent PROFILE, headed. The
 * dynamic await import inside is this module's Playwright quarantine site —
 * importing this module never loads Playwright, and the offline suites stay
 * Playwright-free. The factory owns the browser: closing the context closes
 * the browser.
 *
 * REVISED 2026-11-11T18:40+0700 (live rehearsal): the session rides the
 * PROFILE, not a synthesized cookie document. A fresh browser with the
 * harvested pair gets a page with no Load-more button; the profile gets the
 * button and paginates. Headed is required for the button to render and is
 * acceptable because this leg runs on the PC (watch-linkedin), never in
 * GitHub Actions.
 *
 * locale pins en-US: the walk's Load-more click is a TEXT selector on the
 * English label — the only stable handle (live capture 2026-11-11: one
 * candidate, no aria-label, deploy-hashed classes). A LinkedIn copy change
 * breaks the selector visibly (a stream of dry rounds), never silently.
 *
 * Pages carry url() (the new optional PageLike seam): the walk's
 * checkpoint detector reads it after every navigation.
 */
function makeLinkedInContextFactory(profileDir: string): LinkedInContextFactory {
  const factory: LinkedInContextFactory = async (): Promise<ContextLike> => {
    const { chromium } = await import("playwright");
    // launchPersistentContext, not launch + newContext: the profile IS the
    // session. viewport null lets the operator's window size ride (the
    // login helper's shape, scripts/login-linkedin.ts:127-130).
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: null,
      userAgent: LINKEDIN_USER_AGENT,
      locale: "en-US",
    });
    await context.addInitScript(LINKEDIN_WEBDRIVER_PATCH);
    return {
      newPage: async (): Promise<PageLike> => {
        const page = await context.newPage();
        return {
          url: () => page.url(),
          goto: (url, options) => page.goto(url, options),
          waitForFunction: async (pageFunction, arg, options) => {
            await page.waitForFunction(pageFunction, arg, options);
          },
          content: () => page.content(),
          on: (event, listener) => {
            page.on(event, (response) => listener(response));
            return undefined;
          },
          locator: (selector) => {
            const chain = page.locator(selector).first();
            const adapted: LocatorLike = {
              first: () => adapted,
              waitFor: (options) => chain.waitFor(options),
              click: () => chain.click(),
            };
            return adapted;
          },
          evaluate: (script) => page.evaluate(script),
          waitForTimeout: (ms) => page.waitForTimeout(ms),
          close: () => page.close(),
        };
      },
      addInitScript: async (script) => {
        await context.addInitScript(script);
      },
      close: async () => {
        // launchPersistentContext owns the browser: closing the context
        // closes it. There is no separate browser handle to close.
        await context.close();
      },
    };
  };
  return factory;
}

/**
 * The persistent profile the login helper maintains (scripts/login-linkedin.ts:34).
 * The walk reuses it rather than opening a fresh browser with the harvested
 * cookie pair — see the factory's REVISED note and Key Discoveries.
 */
export const LINKEDIN_PROFILE_DIR = "C:/loker-secrets/linkedin-chromium-profile";

/**
 * The production factory: the persistent profile, headed. Module-PRIVATE on
 * purpose — the browser walk defaults to it in-module, and an exported
 * factory nobody imports is the knip dead-export finding class, not a seam.
 */
const linkedinChromiumContextFactory: LinkedInContextFactory =
  makeLinkedInContextFactory(LINKEDIN_PROFILE_DIR);
// --- the surface walk ---

interface PacingGate {
  readonly wait: () => Promise<void>;
}

/**
 * Shared pacing gate: every page NAVIGATION starts PACE_MIN_MS or more
 * after the previous one, regardless of which surface issued it. The slot
 * is RESERVED BEFORE SLEEPING — the stamp advances synchronously on entry,
 * so concurrent workers can never compute the same wake time and fire a
 * burst; with width 2 the navigations still space PACE_MIN_MS apart
 * globally (pacing-bound, not width-bound, D11). A per-walk closure (not
 * module state): two ticks must not inherit each other's stamp, and each
 * test run gets a fresh gate.
 */
function makePacingGate(
  now: () => number,
  sleepFn: SleepFn,
  rng: RandomFn = Math.random,
): PacingGate {
  let nextFreeAt = Number.NEGATIVE_INFINITY;
  return {
    wait: async () => {
      const slotAt = Math.max(now(), nextFreeAt);
      // The gap is a fresh uniform draw in [PACE_MIN_MS, PACE_MAX_MS) per
      // reservation — randomized spacing, same reserve-before-sleep shape.
      nextFreeAt = slotAt + Math.floor(PACE_MIN_MS + rng() * (PACE_MAX_MS - PACE_MIN_MS));
      const waitMs = slotAt - now();
      if (waitMs > 0) {
        await sleepFn(waitMs);
      }
    },
  };
}

const defaultSleep: SleepFn = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Walk one LinkedIn surface in the shared browser context: navigate the
 * content-search URL, wait for the first flagship-web response, then
 * click "Load more" until dry rounds, the click ceiling (scrollRounds,
 * the config knob shared with the Threads walk) or the post cap stops
 * the loop.
 *
 * Fault vocabulary (design decision "Fault vocabulary re-mapped"):
 * - a checkpoint/login/authwall page URL — checked after the navigation,
 *   on every liveness poll tick, and after every click settle — throws
 *   the tagged HaltError carrying HALT_CHECKPOINT_REASON (FR-7: the
 *   operator-cleared latch, one alarm; never leg-dead);
 * - no flagship-web response inside the liveness window throws the
 *   tagged LegDeadError (a dead session is routine — the b1/b2 plain-
 *   Error class never reaches the join);
 * - a page still on the search URL with zero posts is a success — the
 *   OK — 0 post(s) log, defb8af.
 *
 * The response join attaches BEFORE the navigation: the initial results
 * ride the page's first /flagship-web/ response, and each Load-more
 * click rides a pagination response (the only pagination trigger —
 * scrolling fires nothing, verified live 2026-11-11). Bodies parse
 * through the pure parser; minted posts dedupe first-wins by urn, and
 * the OK line counts bodies that CARRIED posts (N008: parsed, not
 * received).
 */
async function walkLinkedInSurface(
  context: ContextLike,
  surface: LinkedinSurface,
  label: string,
  scrollRounds: number,
): Promise<Post[]> {
  const page = await context.newPage();
  const posts = new Map<string, Post>();
  let received = 0; // matched flagship-web bodies fully read — the liveness signal
  let parsed = 0; // bodies that carried at least one post — the OK-line counter (N008)
  const assertNoCheckpoint = (): void => {
    // url() is the optional Slice 3 seam; absence (a pre-Slice-3 double)
    // reads as no checkpoint. The production adapters always supply it.
    if (LINKEDIN_CHECKPOINT_URL_RE.test(page.url?.() ?? "")) throw halt(HALT_CHECKPOINT_REASON);
  };

  // Attach before navigation: the initial results stream through the
  // page's first flagship-web response. The parser never throws, so the
  // one catch guards only the body read racing the page close.
  page.on("response", (response) => {
    if (!LINKEDIN_RESPONSE_RE.test(response.url()) || response.status() !== 200) return;
    void (async () => {
      try {
        const body = await response.text();
        received += 1;
        const minted = collectLinkedInPosts(body);
        if (minted.length === 0) return;
        parsed += 1;
        for (const post of minted) {
          if (!posts.has(post.id)) posts.set(post.id, post); // first-wins by urn
        }
      } catch {
        // the body read can race the page close; skip it
      }
    })();
  });

  try {
    await page.goto(buildContentSearchUrl(surface.value), {
      waitUntil: "domcontentloaded",
      timeout: LINKEDIN_NAV_TIMEOUT_MS,
    });
    assertNoCheckpoint();
    // The DOM carries no ids, so there is no hydration probe: the initial
    // results ride the first flagship-web response instead. A checkpoint
    // redirect can land on any poll tick — the per-tick URL re-check keeps
    // the halt class ahead of the dead-session timeout.
    const maxPolls = Math.ceil(
      LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS / LINKEDIN_FIRST_RESPONSE_POLL_MS,
    );
    let polls = 0;
    while (received === 0 && polls < maxPolls) {
      await page.waitForTimeout(LINKEDIN_FIRST_RESPONSE_POLL_MS);
      assertNoCheckpoint();
      polls += 1;
    }
    if (received === 0) {
      throw legDead(
        `no flagship-web response within ${LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS}ms — the session may be dead`,
      );
    }
    // The adapter's locator is already the first text match; a transient
    // 0-match is a harmless dry round (the artifact's dry-round exit).
    const loadMore = page.locator(LOAD_MORE_SELECTOR);
    let dryRounds = 0;
    for (let round = 1; round <= scrollRounds && posts.size < LINKEDIN_MAX_POSTS; round += 1) {
      const before = posts.size;
      let clicked = false;
      try {
        await loadMore.waitFor({ state: "visible", timeout: LINKEDIN_LOAD_MORE_WAIT_MS });
        await loadMore.click();
        clicked = true;
      } catch {
        // No clickable button this round: the feed ended, or the next
        // batch is slow — a harmless dry round, no settle owed.
      }
      if (clicked) {
        await page.waitForTimeout(LINKEDIN_SETTLE_MS);
        assertNoCheckpoint();
      }
      const gained = posts.size - before;
      if (gained < LINKEDIN_MIN_GAIN) {
        dryRounds += 1;
        console.log(
          `fetch: ${label} click ${round}: +${gained} (dry ${dryRounds}/${LINKEDIN_MAX_DRY_ROUNDS})`,
        );
        if (dryRounds >= LINKEDIN_MAX_DRY_ROUNDS) break;
      } else {
        dryRounds = 0;
        console.log(`fetch: ${label} click ${round}: +${gained}`);
      }
    }
    // Let in-flight response bodies settle before the page goes away.
    await page.waitForTimeout(LINKEDIN_XHR_DRAIN_MS);
    console.log(`fetch: ${label} OK — ${posts.size} post(s) from ${parsed} response(s)`);
    return [...posts.values()];
  } finally {
    await page.close();
  }
}

/**
 * Walk every configured linkedin surface through the session browser:
 * ONE context for the whole walk (opened from the synthesized session
 * document, closed on every path), one paced navigation plus up to
 * `scrollRounds` Load-more clicks per surface, one log line per surface
 * (empty-is-success, defb8af). Surface faults warn + skip; leg-dead
 * aborts the tick whole via drain-then-throw; a checkpoint aborts via
 * the halt channel (the latch, not the episode marker); when EVERY
 * surface faulted, the tagged AllSurfacesFaulted throws — the caller
 * decides the write (D13: a partial fault still publishes the survivors).
 *
 * FR-5 (shuffled surface order): Fisher-Yates over {surface, index}
 * pairs with the injected rng — the navigation dispatch order varies per
 * tick while perSurface keeps ORIGINAL indexes, so the flat() reassembly
 * order stays input-order structural no matter how the shuffle lands.
 *
 * contextFactory defaults to the in-module production factory (headless);
 * the PC scripts and the offline suite inject explicitly.
 */
export async function fetchLinkedInPosts(
  surfaces: readonly LinkedinSurface[],
  profileDir: string = LINKEDIN_PROFILE_DIR,
  contextFactory: LinkedInContextFactory = linkedinChromiumContextFactory,
  scrollRounds: number = LINKEDIN_DEFAULT_SCROLL_ROUNDS,
  sleepFn: SleepFn = defaultSleep,
  now: () => number = Date.now,
  rng: RandomFn = Math.random,
): Promise<Post[]> {
  // An empty surface list must never launch a browser: the callers guard
  // surfaces.length > 0, and this early return keeps the invariant local
  // (a zero-surface walk opens no context and closes nothing).
  if (surfaces.length === 0) return [];
  // REVISED 2026-11-11T18:40+0700: the browser opens on the persistent
  // profile, not a synthesized cookie document. The cookie file is a
  // preflight validity check in the CALLERS (resolveLinkedInCookies throws
  // on a missing/malformed file before the walk is reached).
  const context = await contextFactory(profileDir);
  const gate = makePacingGate(now, sleepFn, rng);
  const order = surfaces.map((surface, index) => ({ surface, index }));
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  // Side arrays indexed by the ORIGINAL surface index — runPool returns
  // void (src/pool.ts:33-52); reassembly order comes from the filter+flat walk.
  const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
  let faultedCount = 0;
  let deadReason: string | undefined;
  let haltReason: string | undefined;

  try {
    await runPool(order, LINKEDIN_FETCH_CONCURRENCY, async (entry) => {
      const surface = entry.surface;
      const label = `linkedin/${surface.value}`;
      try {
        // Drain checks: stop claiming the moment a halt or leg-dead is
        // flagged; the join re-throws once.
        if (deadReason !== undefined || haltReason !== undefined) return;
        await gate.wait();
        if (deadReason !== undefined || haltReason !== undefined) return;
        const posts = await walkLinkedInSurface(context, surface, label, scrollRounds);
        // Stamp at the slot write (email-per-surface): the surface is a
        // LinkedinSurface, so type is always "linkedin" here. Fresh post
        // objects — the walk's parsed array is never mutated.
        perSurface[entry.index] = posts.map((post) => ({
          ...post,
          surfaces: [{ type: surface.type, value: surface.value }],
        }));
      } catch (error) {
        if (isHalt(error)) {
          // The checkpoint terminal drains like a leg-dead but lands in
          // the halt arm at the join — the account-safety latch, whose
          // alarm the operator must clear (design 2026-11-09).
          haltReason ??= error.reason;
          console.warn(`fetch: ${label} HALT — ${error.reason}`);
          return;
        }
        if (isLegDead(error)) {
          // Drain-then-throw (judgePosts D11 shape): flag, stop claiming,
          // re-throw once after the join. The tick aborts whole — partial
          // posts are discarded, never half-written.
          deadReason ??= error.reason;
          console.warn(`fetch: ${label} LEG DEAD — ${error.reason}`);
          return;
        }
        faultedCount += 1; // fault arm only; the halt/leg-dead arms return above
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch: ${label} FAILED — ${message}`);
      }
    });
  } finally {
    await context.close();
  }

  // Halt outranks leg-dead at the join: a checkpoint is the account-
  // safety terminal; a same-walk dead session still self-heals.
  if (haltReason !== undefined) {
    throw halt(haltReason);
  }
  if (deadReason !== undefined) {
    throw legDead(deadReason);
  }
  if (surfaces.length > 0 && faultedCount === surfaces.length) {
    throw allSurfacesFaulted(faultedCount);
  }
  return perSurface.filter((entry): entry is Post[] => entry !== undefined).flat();
}
```

### tests/linkedin-behavior.test.ts — MODIFY

Budget suites + the localDateKey describe deleted; the reason pin pruned to the two surviving canonical reasons (post-Slice-5 state). Byte-exact applied state: .rpiv/tmp/verify5/.

```ts
/**
 * Offline suite for the behavioral policy machines (design 2026-11-09;
 * the budget suites deleted by the browser-walk migration 2026-11-11).
 *
 * Local Date constructors throughout — every pin is zone-independent: the
 * local (Y, M, D, ...) constructor and the local getters round-trip in any
 * timezone. No files, no doubles, no ambient clock: the module is pure,
 * so this suite is its whole contract.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HALT_CHECKPOINT_REASON,
  HALT_RATE_LIMIT_REASON,
  WAKE_MAX_MS,
  WAKE_MIN_MS,
  WINDOW_END_HOUR,
  WINDOW_START_HOUR,
  isWithinWorkingHours,
  sampleTickDelayMs,
} from "../src/linkedin-behavior.js";

/** 2026-10-26 is a Monday; Oct 31 is the Saturday, Nov 1 the Sunday. */
const MONDAY = { y: 2026, m: 9, d: 26 };

const at = (y: number, m: number, d: number, hour: number, min = 0, sec = 0, ms = 0): Date =>
  new Date(y, m, d, hour, min, sec, ms);

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("isWithinWorkingHours", () => {
  it("admits 08:00:00.000 exactly and rejects 07:59:59.999", () => {
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 8)), true);
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 7, 59, 59, 999)), false);
  });

  it("admits 20:59:59.999 and rejects 21:00:00.000 — the end is exclusive", () => {
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 20, 59, 59, 999)), true);
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 21)), false);
  });

  it("rejects Saturday and Sunday even at midday", () => {
    assert.equal(isWithinWorkingHours(at(2026, 9, 31, 12)), false);
    assert.equal(isWithinWorkingHours(at(2026, 10, 1, 12)), false);
  });

  it("rejects a Friday late-evening tick past the window", () => {
    assert.equal(isWithinWorkingHours(at(2026, 9, 30, 21, 30)), false);
  });

  it("admits every weekday hour from the start hour to one under the end hour", () => {
    for (let hour = WINDOW_START_HOUR; hour < WINDOW_END_HOUR; hour += 1) {
      assert.equal(isWithinWorkingHours(at(2026, 9, 28, hour)), true, `hour ${hour}`);
    }
  });
});

describe("sampleTickDelayMs", () => {
  it("pins the floor at exactly 28 minutes when rng returns 0", () => {
    assert.equal(
      sampleTickDelayMs(() => 0),
      WAKE_MIN_MS,
    );
    assert.equal(WAKE_MIN_MS, 28 * 60_000);
  });

  it("stays strictly under the 33-minute ceiling as rng approaches 1", () => {
    const delay = sampleTickDelayMs(() => 0.999999999);
    assert.equal(WAKE_MAX_MS, 33 * 60_000);
    assert.ok(delay >= WAKE_MIN_MS);
    assert.ok(delay < WAKE_MAX_MS);
  });

  it("keeps a seeded sweep inside [floor, ceiling) and never repeats one value", () => {
    const rng = seededRng(2026_11_09);
    const draws = new Set<number>();
    for (let i = 0; i < 1_000; i += 1) {
      const delay = sampleTickDelayMs(rng);
      assert.ok(delay >= WAKE_MIN_MS, `too small: ${delay}`);
      assert.ok(delay < WAKE_MAX_MS, `too big: ${delay}`);
      draws.add(delay);
    }
    assert.ok(draws.size > 1, "jitter collapsed to a single value");
  });
});

describe("halt latch reason vocabulary", () => {
  it("exports two non-empty, mutually distinguishable canonical reasons", () => {
    assert.ok(HALT_RATE_LIMIT_REASON.length > 0);
    assert.ok(HALT_CHECKPOINT_REASON.length > 0);
    assert.notEqual(HALT_RATE_LIMIT_REASON, HALT_CHECKPOINT_REASON);
  });

  it("names the one remedy in the checkpoint reason (a re-harvest)", () => {
    assert.match(HALT_CHECKPOINT_REASON, /login-linkedin/);
  });
});
```

### tests/reset-linkedin.test.ts — MODIFY

The DEFAULT_BUDGET import and both kept-ledger assertions removed (scope addition ratified at the Slice 5 checkpoint: the locked Files line omitted this file, but it imports DEFAULT_BUDGET from the tick script and pins kept: [DEFAULT_BUDGET]).

```ts
/**
 * Offline suite for the session reset command (design 2026-11-09).
 *
 * Real files on OS temp: the suite creates the three delete targets (the
 * cookie file, the persistent profile dir, the halt-latch flag), runs the
 * reset over injected paths, and pins the contract — the three targets
 * gone and absent targets a quiet no-op. Nothing inside the repo is
 * touched. (The kept budget-ledger reporting died with the budget
 * machine — browser-walk migration, slice 5.)
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { resetLinkedIn } from "../scripts/reset-linkedin.js";

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function target(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-reset-linkedin-"));
  return join(dir, name);
}

describe("resetLinkedIn", () => {
  it("deletes the cookie file, the profile dir, and the halt latch", async () => {
    const cookiePath = await target("cookies.json");
    const profileDir = await target("chromium-profile");
    const latchPath = await target("linkedin-halt.flag");
    await writeFile(cookiePath, '{"liAt":"AQE","jsessionid":"ajax:1"}\n', "utf8");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "jar"), "x", "utf8");
    await writeFile(latchPath, "LinkedIn security checkpoint\n", "utf8");

    const result = await resetLinkedIn({ cookiePath, profileDir, latchPath });
    assert.deepEqual(result, {
      removed: [cookiePath, profileDir, latchPath],
      absent: [],
    });
    for (const path of [cookiePath, profileDir, latchPath]) {
      await assert.rejects(() => stat(path), /ENOENT/);
    }
  });

  it("is a quiet no-op when every target is already absent", async () => {
    const cookiePath = await target("absent-cookies.json");
    const profileDir = await target("absent-profile");
    const latchPath = await target("absent-halt.flag");
    const result = await resetLinkedIn({ cookiePath, profileDir, latchPath });
    assert.deepEqual(result, {
      removed: [],
      absent: [cookiePath, profileDir, latchPath],
    });
  });

  it("uses the merged env for the cookie path when no override rides", async () => {
    const cookiePath = await target("env-cookies.json");
    await writeFile(cookiePath, "{}\n", "utf8");
    const profileDir = await target("env-profile");
    const latchPath = await target("env-halt.flag");
    const result = await resetLinkedIn({
      env: { LINKEDIN_COOKIES_FILE: cookiePath },
      profileDir,
      latchPath,
    });
    assert.deepEqual(result.removed, [cookiePath]);
    assert.deepEqual(result.absent, [profileDir, latchPath]);
  });
});
```

### tests/linkedin-fetch.test.ts — MODIFY

Transport suites deleted; the browser-walk suite with the LinkedIn factory double - structural ContextLike doubles with fragment-matched page scripts (goto fires the initial body, a click settle fires the round pagination body, every wait yields one setImmediate tick).

```ts
/**
 * Offline suite for the LinkedIn browser walk (browser-walk migration,
 * slice 4). Covers: the byte-exact content-search navigation, the session
 * DOCUMENT the factory receives, the flagship-web response join (attach-
 * before-goto; off-endpoint and non-200 noise ignored; first-wins urn
 * dedupe; the N008 parsed-body OK-line counter), Load-more pagination
 * (click ceiling = scrollRounds, the dry-round exit, the 150-post cap),
 * the fault vocabulary (checkpoint URL -> HaltError at all three detector
 * sites — post-navigation, in the liveness poll, post-settle; no flagship
 * response -> LegDeadError; a plain goto failure -> surface fault), the
 * runPool skeleton (rng=0 shuffle transcript, input-order reassembly,
 * sibling starvation on halt, halt > leg-dead join priority, the
 * all-faulted throw, partial-post discard), pacing riding NAVIGATIONS
 * (floor pin, band sweep, reserve-before-sleep no-burst), teardown on
 * every path, the empty-surface no-launch guard, and the tagged guards.
 *
 * Zero network and zero real sleeps: structural ContextLike doubles carry
 * the tests (the fetch-threads suite idiom). Every response fires from
 * the page double itself — goto fires the initial body, a click's settle
 * fires the round's staged body — the same async shape as a real capture,
 * and every waitForTimeout yields one setImmediate tick so the walk's
 * async body reads drain deterministically before the walk's next
 * observation. Importing the module never loads Playwright.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextLike, LocatorLike, PageLike, ResponseLike } from "../src/fetch-threads.js";
import {
  type LinkedinSurface,
  PACE_MAX_MS,
  PACE_MIN_MS,
  allSurfacesFaulted,
  fetchLinkedInPosts,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
} from "../src/linkedin-fetch.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const COOKIES: LinkedInCookies = {
  liAt: "AQE-test",
  jsessionId: "0123456789012345678",
  harvestedAt: "2026-11-10T00:00:00.000Z", // present; the walk never checks age
};

/** An instant sleepFn: multi-surface tests pin dispatch order, not pacing. */
const instantSleep = async (): Promise<void> => undefined;

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Drain the walk's async body reads: one setImmediate tick per flush. */
const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

const surface = (value: string): LinkedinSurface => ({ type: "linkedin", value });

/**
 * Capture-shaped ids: BigInt(epochMs) << 22n — the exact inverse of the
 * parser's BigInt(id) >> 22n clock. One minute of spacing keeps every id
 * distinct and time-ordered by n.
 */
const BASE_MS = Date.UTC(2026, 10, 11, 8, 0, 0);
const idAt = (n: number): string => (BigInt(BASE_MS + n * 60_000) << 22n).toString();
const postText = (n: number): string => `hiring post ${n} — Jakarta`;

/** One flight line. */
const row = (id: string, payload: unknown): string => `${id}:${JSON.stringify(payload)}`;

let cardSeq = 0;

/** One capture-shaped card: the activityUrn row precedes the commentary_text row. */
const cardBody = (id: string, text: string): string => {
  const n = (cardSeq += 1) * 10;
  return [
    row(String(n), { tracking: { activityUrn: { activityId: id } } }),
    row(String(n + 1), [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: [text] } }],
      },
    ]),
  ].join("\n");
};

/** Multi-card body: one (id, text) pair per card, cards in pair order. */
const cardBodyMany = (pairs: ReadonlyArray<readonly [string, string]>): string =>
  pairs.map(([id, cardText]) => cardBody(id, cardText)).join("\n");

/** A parseable flight body that mints ZERO posts (an empty-results page). */
const emptyBody = (): string => row("e1", { tracking: { activityUrn: { activityId: idAt(999) } } });

const SEARCH_RESULT_URL = "https://www.linkedin.com/search/results/content/";
const FLAGSHIP_SEARCH_URL = "https://www.linkedin.com/flagship-web/search/results/content/";
const PAGINATION_URL = "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination";
const CHECKPOINT_URL = "https://www.linkedin.com/checkpoint/challenge";

/**
 * The search URL the walk must navigate for a raw surface value — the
 * independent byte-exact goto oracle (the parser suite pins the builder;
 * this suite pins that the walk USES it).
 */
const searchUrl = (value: string): string =>
  `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(value)}&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D`;

/** One surface's script: what its page does at goto, click, and settle time. */
interface PageScript {
  /** The URL the page reports after goto (defaults to the navigated URL). */
  readonly url?: string;
  /** Goto throws this message (the surface fault arm, never leg-dead). */
  readonly gotoError?: string;
  /** The initial flagship-web body fired during goto; absent = silence. */
  readonly initialBody?: string;
  /** Fires only once this promise resolves (the parked no-burst fixture). */
  readonly initialGate?: Promise<void>;
  /** The initial response's status (default 200; non-200 never satisfies liveness). */
  readonly initialStatus?: number;
  /** True when round N's Load-more waitFor resolves (default always). */
  readonly loadMoreVisible?: (round: number) => boolean;
  /** The pagination body fired by round N's click settle (index 0 = round 1). */
  readonly clickBodies?: readonly string[];
  /**
   * Called with the 1-based waitForTimeout call count and the page's URL
   * setter — the mid-walk checkpoint fixtures.
   */
  readonly onWait?: (call: number, setUrl: (url: string) => void) => void;
  /** Extra responses fired on the first settle (the noise fixtures). */
  readonly noiseOnFirstSettle?: readonly ResponseLike[];
}

/** One created page, with the handles a test needs to steer and observe it. */
interface FakePage {
  readonly page: PageLike;
  readonly gotos: string[];
  readonly clicks: number[];
  readonly waits: number[];
  setUrl(url: string): void;
}

/** The factory double: one page per newPage call, scripts matched by goto-URL fragment. */
function fakeContextFactory(options: {
  closed?: { value: boolean };
  sessionStates?: unknown[];
  built?: { value: number };
  scripts: ReadonlyArray<{ fragment: string; script: PageScript }>;
}): ((storageState: unknown) => Promise<ContextLike>) & { pages: FakePage[] } {
  const pages: FakePage[] = [];
  const factory = async (storageState: unknown): Promise<ContextLike> => {
    if (options.built !== undefined) options.built.value += 1;
    options.sessionStates?.push(storageState);
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        let open = true;
        const listeners: Array<(response: ResponseLike) => void> = [];
        const fire = (response: ResponseLike): void => {
          for (const listener of listeners) listener(response);
        };
        const gotos: string[] = [];
        const clicks: number[] = [];
        const waits: number[] = [];
        let clickCount = 0;
        let waitCalls = 0;
        let settleArmed = false;
        let currentUrl = "";
        let matched: PageScript | undefined;
        const setUrl = (url: string): void => {
          currentUrl = url;
        };
        const page: PageLike = {
          url: () => (currentUrl === "" ? "about:blank" : currentUrl),
          goto: async (url) => {
            gotos.push(url);
            matched = options.scripts.find((candidate) => url.includes(candidate.fragment))?.script;
            if (matched?.gotoError !== undefined) throw new Error(matched.gotoError);
            currentUrl = matched?.url ?? url;
            const initial = matched?.initialBody;
            if (initial !== undefined) {
              const deliver = (): void => {
                fire({
                  url: () => FLAGSHIP_SEARCH_URL,
                  status: () => matched?.initialStatus ?? 200,
                  text: async () => initial,
                });
              };
              if (matched?.initialGate === undefined) deliver();
              else void matched.initialGate.then(deliver);
            }
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => {
            const handle: LocatorLike = {
              first: () => handle,
              waitFor: async () => {
                const visible = matched?.loadMoreVisible?.(clickCount + 1) ?? true;
                if (!visible) throw new Error("locator wait timeout");
              },
              click: async () => {
                clickCount += 1;
                clicks.push(clickCount);
                settleArmed = true;
              },
            };
            return handle;
          },
          evaluate: async () => undefined,
          waitForTimeout: async (ms: number) => {
            waits.push(ms);
            waitCalls += 1;
            matched?.onWait?.(waitCalls, setUrl);
            if (settleArmed) {
              settleArmed = false;
              const body = matched?.clickBodies?.[clickCount - 1];
              if (body !== undefined) {
                fire({
                  url: () => PAGINATION_URL,
                  status: () => 200,
                  text: async () => body,
                });
              }
              if (clickCount === 1) {
                for (const noise of matched?.noiseOnFirstSettle ?? []) fire(noise);
              }
            }
            // One macrotask tick: the walk's async body reads drain before
            // its next observation (the deterministic handoff).
            await new Promise<void>((resolve) => setImmediate(resolve));
          },
          close: async () => {
            if (!open) return;
            open = false;
          },
        };
        pages.push({ page, gotos, clicks, waits, setUrl });
        return page;
      },
      addInitScript: async () => undefined,
      close: async () => {
        if (options.closed !== undefined) options.closed.value = true;
      },
    };
    return context;
  };
  return Object.assign(factory, { pages });
}

/** The page a fragment matched (by its first goto). */
const pageFor = (factory: { pages: FakePage[] }, fragment: string): FakePage => {
  const found = factory.pages.find((page) => page.gotos.some((url) => url.includes(fragment)));
  if (found === undefined) throw new Error(`no page navigated ${fragment}`);
  return found;
};

/** The keywords-token transcript across every created page, in navigation order. */
const dispatchTranscript = (factory: { pages: FakePage[] }): string[] =>
  factory.pages.flatMap((page) => page.gotos).map((url) => /keywords=([^&]+)/.exec(url)?.[1] ?? "");

describe("fetchLinkedInPosts (browser walk)", () => {
  it("navigates the byte-exact content-search URL and returns parsed posts in input order", async () => {
    const closed = { value: false };
    const factory = fakeContextFactory({
      closed,
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        { fragment: "%23b", script: { initialBody: cardBody(idAt(2), postText(2)) } },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#a"), surface("#b")],
      COOKIES,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0.999999999,
    );
    assert.deepEqual(pageFor(factory, "%23a").gotos, [searchUrl("#a")]);
    assert.deepEqual(pageFor(factory, "%23b").gotos, [searchUrl("#b")]);
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [
        [`urn:li:activity:${idAt(1)}`, postText(1)],
        [`urn:li:activity:${idAt(2)}`, postText(2)],
      ],
    );
    assert.equal(closed.value, true); // teardown on the happy path
  });

  it("hands the factory the synthesized session document (li_at + re-quoted JSESSIONID)", async () => {
    const sessionStates: unknown[] = [];
    const factory = fakeContextFactory({
      sessionStates,
      scripts: [{ fragment: "%23s", script: { initialBody: cardBody(idAt(1), postText(1)) } }],
    });
    await fetchLinkedInPosts([surface("#s")], COOKIES, factory, 8, instantSleep);
    assert.deepEqual(sessionStates[0], {
      cookies: [
        { name: "li_at", value: "AQE-test", domain: ".linkedin.com", path: "/", secure: true },
        {
          name: "JSESSIONID",
          value: '"0123456789012345678"',
          domain: ".linkedin.com",
          path: "/",
          secure: true,
        },
      ],
      origins: [],
    });
  });

  it("clicks Load more up to the scrollRounds ceiling while every round gains", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23ceil",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            clickBodies: [
              cardBodyMany([
                [idAt(2), postText(2)],
                [idAt(3), postText(3)],
              ]),
              cardBodyMany([
                [idAt(4), postText(4)],
                [idAt(5), postText(5)],
              ]),
              cardBodyMany([
                [idAt(6), postText(6)],
                [idAt(7), postText(7)],
              ]),
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#ceil")], COOKIES, factory, 2, instantSleep);
    assert.deepEqual(pageFor(factory, "%23ceil").clicks, [1, 2]); // the knob, not the staged third body
    assert.equal(posts.length, 5); // 1 initial + 2 rounds x 2 posts
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /linkedin\/#ceil OK — 5 post\(s\) from 3 response\(s\)/.test(line)),
    );
  });

  it("exits on the third dry round when the Load-more button stops being visible", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23dry",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            loadMoreVisible: (round) => round === 1,
            clickBodies: [
              cardBodyMany([
                [idAt(2), postText(2)],
                [idAt(3), postText(3)],
                [idAt(4), postText(4)],
              ]),
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#dry")], COOKIES, factory, 8, instantSleep);
    assert.deepEqual(pageFor(factory, "%23dry").clicks, [1]);
    assert.deepEqual(
      posts.map((post) => post.id),
      [1, 2, 3, 4].map((n) => `urn:li:activity:${idAt(n)}`),
    );
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /\(dry 3\/3\)/.test(line)));
  });

  it("never clicks past the 150-post cap", async () => {
    const all = Array.from({ length: 150 }, (_, i) => [idAt(i + 1), postText(i + 1)] as const);
    const factory = fakeContextFactory({
      scripts: [{ fragment: "%23cap", script: { initialBody: cardBodyMany(all) } }],
    });
    const posts = await fetchLinkedInPosts([surface("#cap")], COOKIES, factory, 8, instantSleep);
    assert.equal(posts.length, 150); // one body may carry all 150 (the cap bounds clicks, not a body)
    assert.deepEqual(pageFor(factory, "%23cap").clicks, []);
  });

  it("dedupes a repeated urn across bodies — the first mint wins", async () => {
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23dup",
          script: {
            initialBody: cardBody(idAt(1), "first mint"),
            clickBodies: [
              cardBodyMany([
                [idAt(1), "second mint"],
                [idAt(2), postText(2)],
              ]),
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#dup")], COOKIES, factory, 1, instantSleep);
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [
        [`urn:li:activity:${idAt(1)}`, "first mint"],
        [`urn:li:activity:${idAt(2)}`, postText(2)],
      ],
    );
  });

  it("ignores off-endpoint and non-200 responses — the join never leaves the flagship filter", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23noise",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            noiseOnFirstSettle: [
              {
                url: () => "https://www.threads.com/api/graphql",
                status: () => 200,
                text: async () => cardBody(idAt(50), "noise threads body"),
              },
              {
                url: () => "https://www.linkedin.com/flagship-web/search/results/content/",
                status: () => 500,
                text: async () => cardBody(idAt(51), "noise 500 body"),
              },
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#noise")], COOKIES, factory, 1, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`],
    );
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /linkedin\/#noise OK — 1 post\(s\) from 1 response\(s\)/.test(line)),
    );
  });

  it("treats a zero-post page as success — the OK line counts parsed bodies (N008), not received", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23empty",
          script: { initialBody: emptyBody(), loadMoreVisible: () => false },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#empty")], COOKIES, factory, 8, instantSleep);
    assert.deepEqual(posts, []);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /linkedin\/#empty OK — 0 post\(s\) from 0 response\(s\)/.test(line)),
    );
  });

  it("throws the tagged LegDeadError when no flagship response arrives in the liveness window", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const closed = { value: false };
    const factory = fakeContextFactory({
      closed,
      scripts: [{ fragment: "%23silent", script: {} }],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts([surface("#silent")], COOKIES, factory, 8, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
    assert.equal(isHalt(caught), false);
    assert.match((caught as Error).message, /no flagship-web response within 30000ms/);
    assert.equal(pageFor(factory, "%23silent").waits.length, 120); // the full poll budget, 250ms x 120
    assert.equal(closed.value, true); // teardown on the leg-dead path
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#silent LEG DEAD/.test(line)));
  });

  it("a non-200 flagship response never satisfies liveness — leg-dead, not a mint", async () => {
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23slow5",
          script: { initialBody: cardBody(idAt(1), postText(1)), initialStatus: 503 },
        },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts([surface("#slow5")], COOKIES, factory, 8, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
  });

  it("halts on a checkpoint URL right after the navigation (never leg-dead, never a fault)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const closed = { value: false };
    const factory = fakeContextFactory({
      closed,
      scripts: [{ fragment: "%23cp", script: { url: CHECKPOINT_URL } }],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts([surface("#cp")], COOKIES, factory, 8, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.equal(isLegDead(caught), false);
    assert.match((caught as Error).message, /re-harvest/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#cp HALT/.test(line)));
    assert.equal(closed.value, true); // teardown on the halt path
  });

  it("halts when a checkpoint lands during the liveness poll — the halt class wins the race", async () => {
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23slow",
          script: {
            onWait: (call, setUrl) => {
              if (call === 3) setUrl(CHECKPOINT_URL);
            },
          },
        },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts([surface("#slow")], COOKIES, factory, 8, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.equal(isLegDead(caught), false);
  });

  it("halts when a checkpoint lands after a click settle", async () => {
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23mid",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            clickBodies: [cardBody(idAt(2), postText(2))],
            onWait: (call, setUrl) => {
              if (call === 1) setUrl(CHECKPOINT_URL);
            },
          },
        },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts([surface("#mid")], COOKIES, factory, 8, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.match((caught as Error).message, /re-harvest/);
  });

  it("starves the remaining surface once a sibling halts and discards partial posts", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        { fragment: "%23b", script: { url: CHECKPOINT_URL } },
        { fragment: "%23c", script: { initialBody: cardBody(idAt(3), postText(3)) } },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        [surface("#a"), surface("#b"), surface("#c")],
        COOKIES,
        factory,
        8,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    // rng=0 dispatches [B, C, A]: B halts, C completes, A never claims.
    assert.deepEqual(dispatchTranscript(factory), ["%23b", "%23c"]);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#b HALT/.test(line)));
  });

  it("aborts the whole tick when a surface goes dead — the sibling's posts are discarded", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23dead", script: {} },
        { fragment: "%23ok", script: { initialBody: cardBody(idAt(2), postText(2)) } },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        [surface("#dead"), surface("#ok")],
        COOKIES,
        factory,
        8,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /no flagship-web response within 30000ms/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#dead LEG DEAD/.test(line)));
  });

  it("skips a faulted navigation (warn) and keeps the sibling's posts", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23bad", script: { gotoError: "navigation failed" } },
        { fragment: "%23good", script: { initialBody: cardBody(idAt(2), postText(2)) } },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#bad"), surface("#good")],
      COOKIES,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
    );
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(2)}`],
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#bad FAILED — navigation failed/.test(line)));
  });

  it("throws AllSurfacesFaulted with faulted === 2 when every navigation fails", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23x", script: { gotoError: "navigation failed" } },
        { fragment: "%23y", script: { gotoError: "navigation failed" } },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        [surface("#x"), surface("#y")],
        COOKIES,
        factory,
        8,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isAllSurfacesFaulted(caught));
    assert.equal((caught as { faulted?: number }).faulted, 2);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.filter((line) => /FAILED/.test(line)).length, 2);
  });

  it("never launches a browser for an empty surface list", async () => {
    const built = { value: 0 };
    const sessionStates: unknown[] = [];
    const factory = fakeContextFactory({ built, sessionStates, scripts: [] });
    const posts = await fetchLinkedInPosts([], COOKIES, factory, 8, instantSleep);
    assert.deepEqual(posts, []);
    assert.equal(built.value, 0);
    assert.deepEqual(sessionStates, []);
  });

  it("halts outrank leg-dead at the join when both flags set in one walk", async () => {
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23cp", script: { url: CHECKPOINT_URL } },
        { fragment: "%23dead", script: {} },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        [surface("#cp"), surface("#dead")],
        COOKIES,
        factory,
        8,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.equal(isLegDead(caught), false);
    assert.equal(isAllSurfacesFaulted(caught), false);
  });
});

describe("fetchLinkedInPosts surface shuffle (FR-5)", () => {
  it("dispatches [B, C, A] under rng=0 while output stays input order", async () => {
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        { fragment: "%23b", script: { initialBody: cardBody(idAt(2), postText(2)) } },
        { fragment: "%23c", script: { initialBody: cardBody(idAt(3), postText(3)) } },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#a"), surface("#b"), surface("#c")],
      COOKIES,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
    );
    // The goto transcript proves the shuffle happened; reassembly is
    // structural (input order), independent of dispatch.
    assert.deepEqual(dispatchTranscript(factory), ["%23b", "%23c", "%23a"]);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`, `urn:li:activity:${idAt(3)}`],
    );
  });
});

describe("pacing rides navigations", () => {
  it("pins the floor: the second navigation sleeps exactly PACE_MIN_MS under rng=0", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        { fragment: "%23b", script: { initialBody: cardBody(idAt(2), postText(2)) } },
      ],
    });
    await fetchLinkedInPosts(
      [surface("#a"), surface("#b")],
      COOKIES,
      factory,
      8,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
      () => 0,
    );
    assert.deepEqual(sleeps, [PACE_MIN_MS]); // B free; A waits the floor
    assert.deepEqual(dispatchTranscript(factory), ["%23b", "%23a"]);
  });

  it("keeps every navigation spacing inside [5s, 15s) under a seeded rng", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const five = ["#a", "#b", "#c", "#d", "#e"].map(surface);
    const factory = fakeContextFactory({
      scripts: five.map((s) => ({
        fragment: encodeURIComponent(s.value),
        script: { initialBody: cardBody(idAt(1), postText(1)) },
      })),
    });
    await fetchLinkedInPosts(
      five,
      COOKIES,
      factory,
      8,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
      seededRng(2026_11_09),
    );
    assert.equal(sleeps.length, 4); // first navigation free; four reservations
    for (const ms of sleeps) {
      assert.ok(ms >= PACE_MIN_MS && ms < PACE_MAX_MS, `out of band: ${ms}`);
    }
  });

  it("reserves the pacing slot before sleeping, so a width-2 sibling never bursts", async () => {
    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const sleeps: number[] = [];
    const heldSleeps: Array<() => void> = [];
    const sleepFn = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => {
        heldSleeps.push(resolve);
      });
    };
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        {
          fragment: "%23b",
          script: {
            initialBody: cardBody(idAt(2), postText(2)),
            initialGate: gateB, // B's response parks until released
          },
        },
      ],
    });
    const walk = fetchLinkedInPosts(
      [surface("#a"), surface("#b")],
      COOKIES,
      factory,
      8,
      sleepFn,
      () => 0,
      () => 0,
    );
    await flush();
    // rng=0 dispatches [B, A]: B takes the free slot (no sleep recorded),
    // A reserves the NEXT slot synchronously — its floor sleep is recorded
    // while B's response is still parked (reserve-before-sleep).
    assert.deepEqual(sleeps, [PACE_MIN_MS]);
    releaseB();
    await flush();
    heldSleeps[0]?.();
    const posts = await walk;
    // A never recorded a second sleep — its reservation was made while B
    // was in flight, not after B completed.
    assert.deepEqual(sleeps, [PACE_MIN_MS]);
    // Output order stays structural despite the [B, A] dispatch.
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
  });
});

describe("walk guards and post shape", () => {
  it("exposes the tagged error guards", () => {
    assert.ok(isLegDead(legDead("because")));
    assert.equal(isLegDead(new Error("plain")), false);
    assert.ok(isHalt(halt("because")));
    assert.equal(isHalt(legDead("because")), false);
    const error = allSurfacesFaulted(2);
    assert.ok(isAllSurfacesFaulted(error));
    assert.equal(error.faulted, 2);
    assert.equal(isAllSurfacesFaulted(legDead("because")), false);
  });

  it("stamps every minted post with the surface pair and keeps the parser's fields whole", async () => {
    const factory = fakeContextFactory({
      scripts: [{ fragment: "%23x", script: { initialBody: cardBody(idAt(1), postText(1)) } }],
    });
    const posts = await fetchLinkedInPosts([surface("#x")], COOKIES, factory, 8, instantSleep);
    const first = posts[0] as Post;
    assert.equal(first.platform, "linkedin");
    assert.equal(first.author, "linkedin-member");
    assert.equal(first.id, `urn:li:activity:${idAt(1)}`);
    assert.equal(
      first.permalink,
      `https://www.linkedin.com/feed/update/urn:li:activity:${idAt(1)}`,
    );
    assert.equal(first.timestamp, new Date(BASE_MS + 60_000).toISOString());
    assert.deepEqual(first.surfaces, [{ type: "linkedin", value: "#x" }]);
  });
});
```

### tests/fetch-linkedin.test.ts — MODIFY

Transport + budget suites deleted; the browser-walk tick suite with the LinkedInContextFactory double (goto-fired flagship bodies, click transcript, session-document + closed captures). Byte-exact applied state: .rpiv/tmp/verify5/.

```ts
/**
 * Offline suite for the PC fetch tick (browser-walk migration, slice 5).
 *
 * Pins pushPayload's single-path rebase+retry discipline over a fake
 * GitRunner, fetchTick's composition over the injected seams — the tick
 * hands the walk a LinkedInContextFactory and the config scrollRounds,
 * and owns no browser lifecycle of its own — the leg-dead episode-marker
 * edge, the fault arms (an all-faulted walk is a quiet-zeros no-op while
 * a fine-empty walk still writes and pushes, defb8af; a checkpoint walk
 * trips the halt latch with the canonical reason), and the preflight
 * band: window -> latch -> checkout guard BEFORE any browser launch.
 * Zero network, zero real email, zero Playwright; the doubles carry every
 * behavior pin (realGit is exercised only by two read-only git spawns in
 * its block). The budget suites died with the budget machine (slice 5).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type GitRunner,
  fetchTick,
  guardCheckout,
  handleLegDeadEpisode,
  pushPayload,
  realGit,
} from "../scripts/fetch-linkedin.js";
import type { WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import type { ContextLike, LocatorLike, PageLike, ResponseLike } from "../src/fetch-threads.js";
import { HALT_CHECKPOINT_REASON } from "../src/linkedin-behavior.js";
import { type LinkedInContextFactory, isLegDead } from "../src/linkedin-fetch.js";
import { PAYLOAD_VERSION, type PayloadEnvelope } from "../src/linkedin-payload.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const T0 = Date.UTC(2026, 9, 26, 9, 14, 0);
const COOKIES: LinkedInCookies = {
  liAt: "AQE-test",
  jsessionId: "ajax:0123456789012345678",
  harvestedAt: "2026-11-10T00:00:00.000Z", // FR-0: present, age never checked
};

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: [],
  negativeKeywords: [],
  surfaces: [{ type: "linkedin", value: "#hiring react" }],
  platforms: { linkedin: true, threads: true },
  recencyHours: 72,
  reasoningEffort: "low",
  scrollRounds: 1,
};

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function workPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-fetch-linkedin-"));
  return join(dir, name);
}

async function exists(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}

/** Fake GitRunner: records every invocation; exit code + output scripted per command. */
function scriptGit(
  script: Partial<
    Record<
      string,
      number | { code: number; output: string } | Array<number | { code: number; output: string }>
    >
  > = {},
): GitRunner & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    const command = args[0] ?? "";
    calls.push([...args]);
    const scripted = script[command];
    const index = calls.filter((entry) => entry[0] === command).length - 1;
    const entry = Array.isArray(scripted)
      ? (scripted[index] ?? scripted[scripted.length - 1])
      : scripted;
    if (entry === undefined) return { code: 0, output: "" };
    if (typeof entry === "number") return { code: entry, output: "" };
    return { code: entry.code, output: entry.output };
  };
  return Object.assign(git, { calls });
}

// --- the browser-walk doubles (capture-shaped flight bodies + one context factory) ---

const FLAGSHIP_SEARCH_URL = "https://www.linkedin.com/flagship-web/search/results/content/";
const PAGINATION_URL = "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination";
const CHECKPOINT_URL = "https://www.linkedin.com/checkpoint/challenge";

/**
 * Capture-shaped ids: BigInt(epochMs) << 22n — the exact inverse of the
 * parser's BigInt(id) >> 22n clock. One minute of spacing keeps every id
 * distinct and time-ordered by n.
 */
const BASE_MS = Date.UTC(2026, 9, 26, 9, 14, 0);
const idAt = (n: number): string => (BigInt(BASE_MS + n * 60_000) << 22n).toString();

/** One flight line. */
const row = (id: string, payload: unknown): string => `${id}:${JSON.stringify(payload)}`;

let cardSeq = 0;

/** One capture-shaped card: the activityUrn row precedes the commentary_text row. */
const cardBody = (id: string, text: string): string => {
  const n = (cardSeq += 1) * 10;
  return [
    row(String(n), { tracking: { activityUrn: { activityId: id } } }),
    row(String(n + 1), [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: [text] } }],
      },
    ]),
  ].join("\n");
};

/** A parseable flight body that mints ZERO posts (an empty-results page). */
const EMPTY_BODY = "9:{}";

/** What the fake page does at goto, click, and settle time (one script per factory). */
interface PageScript {
  /** The URL the page reports (default: the search results page). */
  readonly url?: string;
  /** Goto throws this message (the surface fault arm, never leg-dead). */
  readonly gotoError?: string;
  /** The initial flagship-web body fired during goto; absent = silence (leg-dead). */
  readonly initialBody?: string;
  /** True when round N's Load-more waitFor resolves (default never: zero clicks). */
  readonly loadMoreVisible?: (round: number) => boolean;
  /** The pagination body fired by round N's click settle (index 0 = round 1). */
  readonly clickBodies?: readonly string[];
}

/**
 * The LinkedInContextFactory double: one context, one page, one script.
 * Records the built count and the synthesized session document; the
 * click transcript rides the returned handle; context closes set the
 * closed flag so teardown pins ride on it.
 */
function contextFactoryFor(options: {
  closed?: { value: boolean };
  sessionStates?: unknown[];
  built?: { value: number };
  script: PageScript;
}): LinkedInContextFactory & { clicks: () => number[] } {
  const clicks: number[] = [];
  const factory: LinkedInContextFactory = async (profileDir): Promise<ContextLike> => {
    if (options.built !== undefined) options.built.value += 1;
    options.sessionStates?.push(storageState);
    const listeners: Array<(response: ResponseLike) => void> = [];
    const fire = (response: ResponseLike): void => {
      for (const listener of listeners) listener(response);
    };
    let clickCount = 0;
    let settleArmed = false;
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => ({
        url: () => options.script.url ?? "https://www.linkedin.com/search/results/content/",
        goto: async () => {
          if (options.script.gotoError !== undefined) throw new Error(options.script.gotoError);
          const initial = options.script.initialBody;
          if (initial !== undefined) {
            fire({
              url: () => FLAGSHIP_SEARCH_URL,
              status: () => 200,
              text: async () => initial,
            });
          }
          return undefined;
        },
        waitForFunction: async () => undefined,
        content: async () => "<html></html>",
        on: (_event, listener) => {
          listeners.push(listener);
          return undefined;
        },
        locator: () => {
          const handle: LocatorLike = {
            first: () => handle,
            waitFor: async () => {
              const visible = options.script.loadMoreVisible?.(clickCount + 1) ?? false;
              if (!visible) throw new Error("locator wait timeout");
            },
            click: async () => {
              clickCount += 1;
              clicks.push(clickCount);
              settleArmed = true;
            },
          };
          return handle;
        },
        evaluate: async () => undefined,
        waitForTimeout: async () => {
          if (settleArmed) {
            settleArmed = false;
            const body = options.script.clickBodies?.[clickCount - 1];
            if (body !== undefined) {
              fire({ url: () => PAGINATION_URL, status: () => 200, text: async () => body });
            }
          }
          // One macrotask tick: the walk's async body reads drain first
          // (the deterministic handoff the walk suite pins).
          await new Promise<void>((resolve) => setImmediate(resolve));
        },
        close: async () => undefined,
      }),
      addInitScript: async () => undefined,
      close: async () => {
        if (options.closed !== undefined) options.closed.value = true;
      },
    };
    return context;
  };
  return Object.assign(factory, { clicks: (): number[] => clicks });
}

describe("realGit (git's merged output, resolved and rejected paths)", () => {
  it("captures git's stdout on success and its stderr + exit code on failure", async (t) => {
    const probe = await realGit(["--version"]); // read-only: no repo state touched
    if (probe.code !== 0) {
      t.skip("git is not on PATH — the read-only spawn pins need a real git");
      return;
    }
    assert.match(probe.output, /git version/); // resolved path: stdout rides output
    const dead = await realGit(["rev-parse", "--verify", "lw-no-such-ref-realgit-pin"]);
    assert.notEqual(dead.code, 0); // rejected path: the real exit code survives
    assert.ok(dead.output.length > 0); // git's own stderr, merged and trimmed
  });
});

describe("pushPayload (single-path rebase+retry discipline)", () => {
  it("stages ONLY the injected path, commits, rebases onto main, and pushes", async () => {
    const payload = await workPath("push-ok.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 3, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
      ["commit", "-m", "linkedin: payload 3 post(s)"],
      ["pull", "--rebase", "origin", "main"],
      ["push"],
    ]);
  });

  it("never stages the module-constant path when a temp payload is injected", async () => {
    const payload = await workPath("push-injected.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 1, payload);
    const addCalls = git.calls.filter((args) => args[0] === "add");
    assert.equal(addCalls.length, 1);
    assert.equal(addCalls[0]?.[1], payload);
    assert.ok(git.calls.every((args) => !args.includes(LINKEDIN_PAYLOAD_PATH)));
  });

  it("throws loudly when the commit itself fails: names the identity fix AND carries git's output", async () => {
    const git = scriptGit({
      diff: 1,
      commit: { code: 128, output: "fatal: unable to auto-detect email address" },
    });
    const payload = await workPath("push-commit-fail.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /payload commit failed — configure the clone's git identity first/);
        assert.match(message, /git said: fatal: unable to auto-detect email address/);
        return true;
      },
    );
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 0);
  });

  it("skips commit + rebase + push when nothing is staged (no-op guard)", async () => {
    const payload = await workPath("push-noop.json");
    const git = scriptGit({ diff: 0 });
    await pushPayload(git, 0, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
    ]);
  });

  it("retries once when the push is rejected, then succeeds", async () => {
    const git = scriptGit({ diff: 1, push: [1, 0] });
    await pushPayload(git, 2, await workPath("push-retry.json"));
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 2);
  });

  it("throws after the second push rejection (loud, exit-1 contract)", async () => {
    const git = scriptGit({ diff: 1, push: 1 });
    const payload = await workPath("push-fail.json");
    await assert.rejects(() => pushPayload(git, 2, payload), /payload push failed twice/);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
  });

  it("aborts the rebase loudly on failure and never pushes — git's own line rides the error", async () => {
    const git = scriptGit({
      diff: 1,
      pull: { code: 1, output: "CONFLICT (content): Merge conflict in state/linkedin-posts.json" },
    });
    const payload = await workPath("push-conflict.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /payload push failed twice/);
        assert.match(
          message,
          /git said: CONFLICT \(content\): Merge conflict in state\/linkedin-posts\.json/,
        );
        return true;
      },
    );
    const aborts = git.calls.filter((args) => args[0] === "rebase" && args[1] === "--abort");
    assert.equal(aborts.length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
  });

  it("surfaces git's real cause, not a misread conflict (the unstaged-changes misdiagnosis)", async () => {
    const git = scriptGit({
      diff: 1,
      pull: { code: 1, output: "error: cannot pull with rebase: You have unstaged changes." },
    });
    const payload = await workPath("push-rebase-output.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(
          message,
          /git said: error: cannot pull with rebase: You have unstaged changes\./,
        );
        assert.ok(!message.includes("rebase conflicted"));
        return true;
      },
    );
  });
});

describe("fetchTick (compose cookies → context factory → walk → payload → push)", () => {
  it("composes the tick end to end: payload written, single-path push, marker cleared", async () => {
    const payload = await workPath("tick-ok.json");
    const marker = await workPath("tick-ok.flag");
    await writeFile(marker, "dead session\n", "utf8"); // a stale episode: a clean tick clears it
    const closed = { value: false };
    const contextFactory = contextFactoryFor({
      closed,
      script: { initialBody: cardBody(idAt(1), "hiring post — Jakarta") },
    });
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-1.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      payloadPath: payload,
      git,
      env: {},
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 1 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.version, PAYLOAD_VERSION);
    assert.equal(new Date(envelope.writtenAt).getTime(), T0);
    const expected: Post = {
      platform: "linkedin",
      id: `urn:li:activity:${idAt(1)}`,
      text: "hiring post — Jakarta",
      author: "linkedin-member",
      permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${idAt(1)}`,
      timestamp: new Date(BASE_MS + 60_000).toISOString(),
      surfaces: [{ type: "linkedin", value: "#hiring react" }],
    };
    assert.deepEqual(envelope.posts, [expected]);
    assert.equal(closed.value, true); // the walk closed the context; the tick owns no browser lifecycle
    assert.equal(await exists(marker), false); // the healthy tick cleared the episode
    // The two preflight reads (clean main, empty porcelain) precede the push discipline.
    assert.deepEqual(git.calls[0], ["rev-parse", "--abbrev-ref", "HEAD"]);
    assert.deepEqual(git.calls[1], ["status", "--porcelain"]);
    assert.equal(git.calls[2]?.[0], "add");
    assert.equal(git.calls[2]?.[1], payload); // ONLY the injected payload path
    assert.ok(git.calls.some((args) => args[0] === "commit"));
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });

  it("propagates leg-dead without writing the payload, pushing, or leaving a context open", async () => {
    const payload = await workPath("tick-dead.json");
    const marker = await workPath("tick-dead.flag");
    const alarms: string[] = [];
    const closed = { value: false };
    const contextFactory = contextFactoryFor({ closed, script: {} }); // silence: the liveness window dies
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-2.flag"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          contextFactory,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
          alarm: async (reason) => {
            alarms.push(reason);
          },
        }),
      (error: unknown) => isLegDead(error) && /no flagship-web response/.test(error.reason),
    );
    assert.equal(closed.value, true); // the walk still closed its context on the dead path
    assert.equal(await exists(payload), false); // the walk aborted before any write
    // Only the two preflight reads ran (the guard precedes the walk); zero push-discipline calls.
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
    assert.deepEqual(alarms, []); // the alarm policy belongs to the entry/loop callers
  });

  it("returns quiet zeros on an all-faulted walk — no payload, no git, marker untouched", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const payload = await workPath("tick-all-faulted.json");
    const marker = await workPath("tick-all-faulted.flag");
    await writeFile(marker, "stale episode\n", "utf8"); // must survive untouched
    const contextFactory = contextFactoryFor({ script: { gotoError: "navigation failed" } });
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-3.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      payloadPath: payload,
      git,
      env: {},
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(await exists(payload), false); // b2: the last good payload stays
    // The preflight ran (it precedes the walk); still zero add/commit/push on a faulted tick.
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
    assert.equal(await readFile(marker, "utf8"), "stale episode\n"); // never cleared
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /all 1 linkedin surface\(s\) faulted/.test(line)));
    assert.ok(
      lines.some((line) => /linkedin\/#hiring react FAILED — navigation failed/.test(line)),
    );
  });

  it("still writes and pushes a fine-empty walk's payload (defb8af: 0 faults + 0 posts is an outcome)", async () => {
    const payload = await workPath("tick-fine-empty.json");
    const marker = await workPath("tick-fine-empty.flag");
    const contextFactory = contextFactoryFor({ script: { initialBody: EMPTY_BODY } });
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-4.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      payloadPath: payload,
      git,
      env: {},
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 0 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.version, PAYLOAD_VERSION);
    assert.deepEqual(envelope.posts, []); // the guard keys on FAULTS, not post count
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });

  it("returns early when no linkedin surfaces are configured (resolvers AND the checkout preflight never run)", async () => {
    const git = scriptGit({});
    const result = await fetchTick({
      latchPath: await workPath("latch-5.flag"),
      bypassWindow: true,
      config: { ...CONFIG, surfaces: [{ type: "tag", value: "hiring" }] },
      git,
      env: {}, // no LINKEDIN_COOKIES_FILE — the cookie resolver would throw if reached
      markerPath: await workPath("tick-noop.flag"),
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(git.calls.length, 0); // the guard sits AFTER this return — a threads-only config never demands a main checkout
  });

  it("resolves cookies before building any browser context (the production factory is lazy)", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-factory.flag"),
          bypassWindow: true,
          config: CONFIG,
          contextFactory,
          git: scriptGit({ "rev-parse": { code: 0, output: "main" } }),
          env: {}, // no LINKEDIN_COOKIES_FILE — the resolver throws first
          now: () => T0,
        }),
      /LINKEDIN_COOKIES_FILE/,
    );
    assert.equal(built.value, 0); // no browser was ever built
  });
});

describe("checkout preflight (guardCheckout before any fetch — Phase 10)", () => {
  it("passes on clean main with exactly the two guard reads (direct pin)", async () => {
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } }); // status → empty porcelain
    await guardCheckout(git); // must not throw
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
  });

  it("rejects a wrong branch naming it and the wrong-ref consequence — zero navigations, no payload", async () => {
    const payload = await workPath("tick-wrong-branch.json");
    const marker = await workPath("tick-wrong-branch.flag");
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit({
      "rev-parse": { code: 0, output: "feature/add-support-for-linkeind" },
    });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-7.flag"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          contextFactory,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /on branch "feature\/add-support-for-linkeind", not main/);
        assert.match(message, /wrong ref/); // the hosted run would never read that push
        return true;
      },
    );
    assert.equal(built.value, 0); // the guard precedes the walk — no browser was ever built
    assert.equal(await exists(payload), false); // nothing written before the rejection
    assert.deepEqual(git.calls, [["rev-parse", "--abbrev-ref", "HEAD"]]); // throws before status
  });

  it("rejects a dirty tree naming the path count and the paths — zero navigations, no payload", async () => {
    const payload = await workPath("tick-dirty.json");
    const marker = await workPath("tick-dirty.flag");
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit({
      "rev-parse": { code: 0, output: "main" },
      status: { code: 0, output: " M src/linkedin-fetch.ts\n M README.md" },
    });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-8.flag"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          contextFactory,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /not clean \(2 path\(s\)/);
        assert.match(message, /src\/linkedin-fetch\.ts/);
        assert.match(message, /README\.md/);
        return true;
      },
    );
    assert.equal(built.value, 0); // no live fetch burned on a mis-homed checkout
    assert.equal(await exists(payload), false);
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
  });
});

describe("handleLegDeadEpisode (one alarm per episode)", () => {
  it("alarms once on the healthy→dead edge and writes the marker", async () => {
    const marker = await workPath("episode-1.flag");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, ["dead session"]);
    assert.equal(await readFile(marker, "utf8"), "dead session\n");
  });

  it("stays quiet on later dead ticks (marker already present)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-2.flag");
    await writeFile(marker, "dead session\n", "utf8");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session again", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /leg still dead/.test(line)));
  });

  it("survives a restart: the marker file, not module state, edges the episode", async () => {
    const marker = await workPath("episode-3.flag");
    const alarms: string[] = [];
    const deps = {
      markerPath: marker,
      env: {},
      alarm: async (reason: string): Promise<void> => {
        alarms.push(reason);
      },
    };
    await handleLegDeadEpisode("dead", deps); // pre-restart process
    await handleLegDeadEpisode("dead", deps); // post-restart process: same file, still quiet
    assert.deepEqual(alarms, ["dead"]);
  });

  it("default alarm is best-effort: a broken GMAIL env warns instead of throwing", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-4.flag");
    await handleLegDeadEpisode("dead", { markerPath: marker, env: {} });
    assert.equal(await readFile(marker, "utf8"), "dead\n"); // marker persists despite the send failure
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /alarm not sent/.test(line)));
  });
});

// --- the anti-restriction preflight band (design 2026-11-09; window -> latch, slice 5) ---

describe("the anti-restriction preflight band (window -> latch)", () => {
  it("blocks a latched tick: zero browser builds, zero git spawns, quiet zeros", async () => {
    const latchPath = await workPath("latch-9.flag");
    await writeFile(latchPath, "LinkedIn security checkpoint\n", "utf8");
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      contextFactory,
      git,
      payloadPath: await workPath("payload-latched.json"),
      latchPath,
      bypassWindow: true,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(built.value, 0);
    assert.equal(git.calls.length, 0);
  });

  it("outside the working window the tick is a quiet no-op (Saturday noon local)", async () => {
    const saturdayNoon = new Date(2026, 9, 31, 12, 0).getTime(); // 2026-10-31 is a Saturday
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      contextFactory,
      git,
      payloadPath: await workPath("payload-weekend.json"),
      latchPath: await workPath("latch-10.flag"),
      now: () => saturdayNoon,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(built.value, 0);
    assert.equal(git.calls.length, 0);
  });

  it("inside the window (Monday 10:00 local, latch absent) the tick reaches the checkout guard", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime(); // 2026-10-26 is a Monday
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit({ "rev-parse": { code: 0, output: "feature\n" } });
    await assert.rejects(
      async () =>
        fetchTick({
          config: CONFIG,
          contextFactory,
          git,
          payloadPath: await workPath("payload-weekday.json"),
          latchPath: await workPath("latch-11.flag"),
          now: () => mondayTen,
          env: {},
        }),
      /not main/,
    );
    assert.ok(git.calls.length >= 1); // the band let it through to the guard
    assert.equal(built.value, 0); // the guard threw before any browser was built
  });
});

describe("the scrollRounds click bound rides the config into the walk", () => {
  it("threads config.scrollRounds into the walk as the per-surface click ceiling", async () => {
    const contextFactory = contextFactoryFor({
      script: {
        initialBody: cardBody(idAt(1), "hiring post — Jakarta"),
        loadMoreVisible: () => true, // every round's button resolves; the gains stay dry
      },
    });
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      config: { ...CONFIG, scrollRounds: 3 },
      cookies: COOKIES,
      contextFactory,
      git,
      payloadPath: await workPath("payload-rounds.json"),
      latchPath: await workPath("latch-rounds.flag"),
      bypassWindow: true,
      env: {},
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 1 });
    assert.deepEqual(contextFactory.clicks(), [1, 2, 3]); // the knob, not the dry-round exit, stopped the loop
  });
});

describe("the halt-latch trip (FR-7)", () => {
  it("a checkpoint walk trips the latch with the canonical reason and alarms once", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const latchPath = await workPath("latch-cp.flag");
    const payloadPath = await workPath("payload-cp.json");
    const alarms: string[] = [];
    const contextFactory = contextFactoryFor({ script: { url: CHECKPOINT_URL } });
    const git = scriptGit({ "rev-parse": { code: 0, output: "main\n" } });
    const result = await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      git,
      payloadPath,
      latchPath,
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async (reason) => {
        alarms.push(reason);
      },
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    const flag = await readFile(latchPath, "utf8");
    assert.equal(flag, `${HALT_CHECKPOINT_REASON}\n`);
    assert.deepEqual(alarms, [HALT_CHECKPOINT_REASON]);
    assert.equal(await exists(payloadPath), false); // no payload on a halted tick
  });

  it("the latch trip never writes the leg-dead episode marker (separate channels)", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const latchPath = await workPath("latch-channels.flag");
    const markerPath = await workPath("episode.flag");
    const contextFactory = contextFactoryFor({ script: { url: CHECKPOINT_URL } });
    await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath: await workPath("payload-channels.json"),
      latchPath,
      markerPath,
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async () => undefined,
      env: {},
    });
    assert.equal(await exists(latchPath), true);
    assert.equal(await exists(markerPath), false);
  });
});

describe("FR-0 stamp gate (slice 5)", () => {
  it("rejects a stampless cookie file before the browser is built or any navigation", async () => {
    const stampless: LinkedInCookies = {
      liAt: "AQE-test",
      jsessionId: "ajax:0123456789012345678",
    };
    const payloadPath = await workPath("payload-stamp.json");
    const latchPath = await workPath("latch-stamp.flag");
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const gitCalls: string[] = [];
    const git: GitRunner = async (args) => {
      gitCalls.push(args.join(" "));
      return args[0] === "rev-parse" ? { code: 0, output: "main" } : { code: 0, output: "" };
    };
    await assert.rejects(
      () =>
        fetchTick({
          config: CONFIG,
          cookies: stampless,
          contextFactory,
          git,
          payloadPath,
          latchPath,
          now: () => new Date(2026, 9, 26, 10, 0).getTime(),
          bypassWindow: true,
          env: {},
        }),
      /harvestedAt.*login-linkedin/,
    );
    // The gate sits after the checkout guard: two git reads happened, zero writes, zero browsers.
    assert.deepEqual(gitCalls, ["rev-parse --abbrev-ref HEAD", "status --porcelain"]);
    assert.equal(built.value, 0);
    assert.equal(await exists(payloadPath), false);
  });
});
```

### scripts/fetch-linkedin.ts — MODIFY

Tick rewire + budget deletion (byte-exact applied state: .rpiv/tmp/verify5/). Transport dep -> contextFactory; preflight band window -> latch; the budget wrapper + ledger file deleted; the finally dispose removed (the walk owns the browser lifecycle); scrollRounds threaded as the per-surface click bound.

```ts
/**
 * One LinkedIn fetch tick (PC-local leg, design D5/D7; browser-walk
 * migration 2026-11-11):
 *
 *   cookies → browser walk → payload write → single-path push
 *
 * The push mirrors scripts/commit-state-rebase.sh's discipline, scoped to
 * the payload path: add ONLY state/linkedin-posts.json, no-op guard,
 * commit, pull --rebase origin main, push, one retry on rejection. The bot's
 * commit-back runs the same discipline on a disjoint path, and each
 * file has exactly one writer, so an exact-simultaneous push pair costs
 * the loser one retry — never a lost update. Run from a DEDICATED clone of
 * main: the checkout preflight (guardCheckout) enforces branch main + a
 * clean tree BEFORE cookies, the walk, or any browser navigation — a dirty
 * tree wedges the rebase only AFTER a live fetch is burned, and a non-main
 * branch would push the payload to the wrong ref. The rebase doubles as
 * the loop's own code auto-update.
 *
 * Leg-dead: ONE alarm email per episode (edge-detected via a repo-local
 * marker file beside the payload — never OS temp: a reboot or temp-cleaner
 * must not erase the episode and re-alarm a still-dead leg), then exit 1
 * for this one-shot entry. The loop
 * (scripts/watch-linkedin.ts) catches and keeps running — a cookie-file
 * refresh self-heals on a later tick. Best-effort alarm policy: a broken
 * GMAIL_* configuration must not mask the exit code.
 *
 * Entry-guarded main (index.ts idiom): importing fetchTick stays
 * side-effect free.
 */
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import { resolveEmailConfig, sendHaltAlarm, sendLegDeadAlarm } from "../src/email.js";
import { envWithDotEnv } from "../src/env-file.js";
import { isWithinWorkingHours } from "../src/linkedin-behavior.js";
import {
  type LinkedInContextFactory,
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-fetch.js";
import { writePayloadAtomic } from "../src/linkedin-payload.js";
import { type LinkedInCookies, resolveLinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

/** Injectable git runner: args → exit code + git's own merged output (never rejects). */
export type GitRunner = (args: readonly string[]) => Promise<{ code: number; output: string }>;

const execFilePromised = promisify(execFile);

/** The real git on PATH; exported for the suite's read-only spawn pins. */
export const realGit: GitRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFilePromised("git", [...args], { windowsHide: true });
    return {
      code: 0,
      output: `${stdout}
${stderr}`.trim(),
    };
  } catch (error) {
    // execFile rejects on a nonzero code with {stdout, stderr} attached;
    // both channels merge into one trimmed output either way.
    const raw = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    const code = typeof raw.code === "number" ? raw.code : 1;
    const output = `${String(raw.stdout ?? "")}
${String(raw.stderr ?? "")}`.trim();
    return { code: Number.isInteger(code) ? code : 1, output };
  }
};

/** Outcome of one tick; the loop and tests assert on it. */
export interface FetchTickResult {
  wrote: boolean;
  pushed: boolean;
  postCount: number;
}

export interface FetchTickDeps {
  /** Pre-resolved config. Default: loadWatcherConfig() — fail-visible. */
  config?: WatcherConfig;
  /** Pre-resolved cookies. Default: resolveLinkedInCookies(env). */
  cookies?: LinkedInCookies;
  /**
   * Browser-context factory for the walk (the LinkedInContextFactory seam).
   * Default: the walk module's own production factory (headless Chromium,
   * the session document in). The walk opens and closes the context on
   * every path — the tick owns no browser lifecycle of its own.
   */
  contextFactory?: LinkedInContextFactory;
  /** Payload location. Default: LINKEDIN_PAYLOAD_PATH (the pushed path). */
  payloadPath?: string;
  /** Git runner. Default: the real git on PATH. */
  git?: GitRunner;
  /** Environment for the resolvers. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Episode alarm. Default: sendLegDeadAlarm, best-effort (warn on failure). */
  alarm?: (reason: string) => Promise<void>;
  /** Episode marker file. Default: repo-local beside the payload (survives restarts). */
  markerPath?: string;
  /** Clock for the payload stamp. Default: Date.now. */
  now?: () => number;
  /** Halt-latch flag file. Default: repo-local beside the payload (survives restarts). */
  latchPath?: string;
  /** Jitter draw for the walk pacing + shuffle. Default: Math.random. */
  rng?: () => number;
  /** Halt-latch alarm. Default: sendHaltAlarm, best-effort (warn on failure). */
  haltAlarm?: (reason: string) => Promise<void>;
  /**
   * Bypass the working-hours window gate. Default: false (the gate is on).
   * The offline suite injects true so a tick can run at any pinned clock;
   * production never sets it.
   */
  bypassWindow?: boolean;
}

/**
 * Episode marker BESIDE THE PAYLOAD (repo-local, persistent): present = the
 * alarm already fired for this episode. OS temp was rejected 2026-11-04 —
 * a reboot or temp-cleaner erased it, and a still-dead leg after a PC
 * restart re-alarmed, breaking one-alarm-per-episode exactly when the
 * operator needs quiet. state/ in the dedicated clone is loop-owned and
 * persistent; the flag is untracked (pushPayload stages only the payload
 * path; the bot commits only seen-posts.json), so rebase never touches it.
 */
const DEFAULT_MARKER = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-leg-dead.flag");

/**
 * The operator-cleared halt latch (FR-7): present = fetching is blocked until
 * the operator deletes it. Repo-local beside the payload, same discipline as
 * the episode marker — a reboot or temp-cleaner must not erase it.
 */
export const DEFAULT_LATCH = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-halt.flag");

async function markerExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Send the leg-dead alarm ONCE per episode: the marker file edges the
 * healthy→dead transition, so a 144-tick dead day emails once. Every dead
 * tick still warns in the run log.
 */
export async function handleLegDeadEpisode(
  reason: string,
  deps: FetchTickDeps = {},
): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  const env = deps.env ?? process.env;
  if (await markerExists(marker)) {
    console.warn(`fetch-linkedin: leg still dead — ${reason} (alarm already sent this episode)`);
    return;
  }
  await writeFile(
    marker,
    `${reason}
`,
    "utf8",
  );
  console.error(`fetch-linkedin: LEG DEAD — ${reason}`);
  const alarm =
    deps.alarm ??
    (async (alarmReason: string) => {
      try {
        await sendLegDeadAlarm(alarmReason, resolveEmailConfig(env));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch-linkedin: alarm not sent — ${message}`);
      }
    });
  await alarm(reason);
}

/** Clear a prior episode marker on a healthy tick (the dead→healthy edge). */
async function clearEpisodeMarker(deps: FetchTickDeps): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  if (await markerExists(marker)) {
    await rm(marker, { force: true });
    console.log("fetch-linkedin: leg recovered — episode cleared");
  }
}

/**
 * The halt latch: present = the operator must clear it (FR-7). Same
 * read-file discipline as the episode marker's exists probe.
 */
async function latchPresent(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Trip the latch once: the flag's content IS the reason, so the file
 * always explains itself. First-write-wins — a second trip never rewrites
 * an existing flag.
 */
async function tripLatch(path: string, reason: string): Promise<void> {
  if (await latchPresent(path)) return;
  await writeFile(
    path,
    `${reason}
`,
    "utf8",
  );
}

/**
 * Best-effort latch alarm: a broken GMAIL_* configuration warns and never
 * masks the tick outcome (the leg-dead alarm's policy, verbatim).
 */
function defaultHaltAlarm(
  env: Record<string, string | undefined>,
): (reason: string) => Promise<void> {
  return async (reason) => {
    try {
      await sendHaltAlarm(reason, resolveEmailConfig(env));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`fetch-linkedin: latch alarm not sent — ${message}`);
    }
  };
}
/**
 * Dedicated-clone preflight (D5, Phase 10): the push discipline assumes a
 * clean checkout of main. A dirty tree kills the rebase AFTER a live fetch;
 * a non-main branch silently pushes the payload to the wrong ref (the
 * hosted run reads main). Both fail here — before cookies, the walk, or
 * any browser navigation — naming what is wrong and the remedy. Two git
 * reads, zero network.
 */
export async function guardCheckout(git: GitRunner): Promise<void> {
  const head = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.output.split(/\r?\n/)[0] ?? "";
  if (head.code !== 0 || branch !== "main") {
    throw new Error(
      `fetch-linkedin: this checkout is on branch "${branch || "unknown"}", not main — the payload push would land on the wrong ref and the hosted run would never read it. Run the loop from a DEDICATED clone of main (README: PC operations)`,
    );
  }
  const status = await git(["status", "--porcelain"]);
  if (status.code !== 0 || status.output !== "") {
    const paths = status.output.split("\n");
    const names = paths.slice(0, 5).join("; ");
    throw new Error(
      `fetch-linkedin: this checkout is not clean (${paths.length} path(s): ${names}) — uncommitted edits break the rebase AFTER a live fetch. Run from a dedicated clone of main with a clean tree (README: PC operations)`,
    );
  }
}

/**
 * Commit + push ONLY the payload path with the rebase+retry discipline.
 * The rebase replays the payload commit onto origin/main; a conflict on
 * the payload path is impossible while it has one writer, so a failure
 * aborts loudly instead of skipping (the bot's whitelist never applies —
 * its seen-posts.json replay touches a disjoint path). Every failure
 * message carries git's own output — the real cause (e.g. "cannot pull
 * with rebase: You have unstaged changes") can never masquerade as a
 * misdiagnosed conflict again.
 */
export async function pushPayload(
  git: GitRunner,
  postCount: number,
  filePath: string = LINKEDIN_PAYLOAD_PATH,
): Promise<void> {
  await git(["add", filePath]);
  const staged = await git(["diff", "--cached", "--quiet"]);
  if (staged.code === 0) {
    console.log("git: payload unchanged; nothing to commit");
    return;
  }
  // The commit exit code IS checked: an unconfigured git identity in a
  // fresh dedicated clone is the classic first-tick failure, and skipping
  // the check would let rebase+push succeed while pushing NOTHING — a
  // silent no-op tick reporting pushed=true (fail-visible doctrine).
  const commit = await git(["commit", "-m", `linkedin: payload ${postCount} post(s)`]);
  if (commit.code !== 0) {
    throw new Error(
      `git: payload commit failed — configure the clone's git identity first (git config user.name + user.email) — git said: ${commit.output || "(no output)"}`,
    );
  }
  let lastFailure = "";
  const attempt = async (): Promise<boolean> => {
    const rebase = await git(["pull", "--rebase", "origin", "main"]);
    if (rebase.code !== 0) {
      lastFailure = rebase.output;
      console.error(`git: rebase failed — aborting — git said: ${rebase.output || "(no output)"}`);
      await git(["rebase", "--abort"]);
      return false;
    }
    const push = await git(["push"]);
    if (push.code !== 0) lastFailure = push.output;
    return push.code === 0;
  };
  const pushed = (await attempt()) || (await attempt());
  if (!pushed) {
    throw new Error(`git: payload push failed twice — git said: ${lastFailure || "(no output)"}`);
  }
  console.log("git: pushed payload commit");
}

export async function fetchTick(deps: FetchTickDeps = {}): Promise<FetchTickResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const config = deps.config ?? (await loadWatcherConfig());
  const surfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  if (surfaces.length === 0) {
    console.log("fetch-linkedin: no linkedin surfaces configured — nothing to do");
    return { wrote: false, pushed: false, postCount: 0 };
  }
  // The anti-restriction preflight band (design 2026-11-09; the budget step
  // deleted by the browser-walk migration 2026-11-11) runs BEFORE the
  // checkout guard: a gated no-op costs zero git spawns, zero cookie reads,
  // and zero browser navigations. Order: window -> latch.
  const latchPath = deps.latchPath ?? DEFAULT_LATCH;
  const rng = deps.rng ?? Math.random;
  const at = new Date(now());
  if (deps.bypassWindow !== true && !isWithinWorkingHours(at)) {
    console.log(
      "fetch-linkedin: outside the working window (Mon-Fri 08:00-21:00 local) — nothing to do",
    );
    return { wrote: false, pushed: false, postCount: 0 };
  }
  if (await latchPresent(latchPath)) {
    console.log(
      "fetch-linkedin: HALT LATCH present — fetching is blocked until the operator deletes it",
    );
    return { wrote: false, pushed: false, postCount: 0 };
  }
  // The checkout preflight runs BEFORE the cookie resolver: a mis-homed
  // checkout costs zero navigations and writes nothing. The loop catches
  // this plain error and keeps running (a mis-homed loop warns every 10
  // min instead of burning live fetches); the one-shot entry exits 1.
  await guardCheckout(deps.git ?? realGit);
  const cookies = deps.cookies ?? resolveLinkedInCookies(env);
  // FR-0 (design 2026-11-09): the dedicated-account gate — the cookie file must
  // carry the machine-written "harvestedAt" stamp; presence required, age never
  // checked. A stampless file is a hand-exported or legacy file: fail BEFORE
  // the walk opens a browser or any navigation leaves, naming the one remedy
  // (a re-harvest). The loop treats this like any plain tick fault (warn +
  // keep running); the one-shot entry exits 1.
  if (cookies.harvestedAt === undefined) {
    throw new Error(
      'fetch-linkedin: the cookie file carries no machine-written "harvestedAt" stamp — run "npm run login-linkedin" to re-harvest the session (README: PC operations)',
    );
  }
  let posts: Post[];
  try {
    // The walk owns the browser: it opens one context from the synthesized
    // session document and closes it on every path, so the tick has no
    // dispose arm of its own. scrollRounds (the config knob shared with
    // the Threads walk) bounds the Load-more clicks per surface; the
    // factory defaults to the walk module's production headless factory.
    posts = await fetchLinkedInPosts(
      surfaces,
      cookies,
      deps.contextFactory,
      config.scrollRounds,
      undefined,
      now,
      rng,
    );
  } catch (error) {
    // The halt arm (FR-7): a security checkpoint or login wall trips the
    // operator-cleared latch, alarms once (best-effort), and lands as a
    // quiet-zeros no-op — the loop keeps running, fetching nothing.
    if (isHalt(error)) {
      await tripLatch(latchPath, error.reason);
      console.error(`fetch-linkedin: HALT LATCH TRIPPED — ${error.reason}`);
      await (deps.haltAlarm ?? defaultHaltAlarm(env))(error.reason);
      return { wrote: false, pushed: false, postCount: 0 };
    }
    // All-faulted walk (Phase 8, b2): an all-faulted tick is a tagged no-op
    // — quiet zeros, payload/git/episode-marker untouched, so the hosted
    // reader keeps scoring the LAST GOOD payload instead of a fresh empty
    // one. Leg-dead is NOT caught here: it re-throws and the entry/loop
    // callers own the alarm policy.
    if (isAllSurfacesFaulted(error)) {
      console.warn(
        `fetch-linkedin: all ${error.faulted} linkedin surface(s) faulted — payload not touched, last good payload preserved`,
      );
      return { wrote: false, pushed: false, postCount: 0 };
    }
    throw error;
  }
  const payloadPath = deps.payloadPath ?? LINKEDIN_PAYLOAD_PATH;
  await writePayloadAtomic(posts, payloadPath, now);
  console.log(`payload: wrote ${posts.length} post(s) — ${payloadPath}`);
  await pushPayload(deps.git ?? realGit, posts.length, payloadPath);
  await clearEpisodeMarker(deps);
  return { wrote: true, pushed: true, postCount: posts.length };
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The merged env: .env fills ONLY unset keys, the real shell wins. The
  // fetchTick default stays process.env for the offline tests' injection.
  fetchTick({ env: envWithDotEnv() }).catch(async (error: unknown) => {
    if (isLegDead(error)) {
      await handleLegDeadEpisode(error.reason);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`fetch-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
```

### src/email.ts — MODIFY

buildHaltAlarmText de-budgeted — the tail names the one remaining halt class (checkpoint) and its remedy; the four pinned fragments in tests/email.test.ts survive:

```ts
export function buildHaltAlarmText(reason: string): string {
  return [
    "The LinkedIn fetch leg is HALTED.",
    "",
    `Signature: ${reason}`,
    "",
    "Fetching is blocked until you clear the latch. The loop keeps running",
    "and every tick is a quiet no-op — no LinkedIn requests are made.",
    "",
    "To resume: delete state/linkedin-halt.flag (or run npm run reset-linkedin",
    "to clear the session and the latch together).",
    "",
    "A checkpoint means LinkedIn challenged this account. Re-harvest the",
    "session (npm run login-linkedin) before clearing the latch.",
  ].join("\n");
}
```

### scripts/reset-linkedin.ts — MODIFY

Kept-ledger reporting removed: the kept result field, its log line, and the DEFAULT_BUDGET import. The ledger FILE is never deleted here (untracked, operator cleanup).

```ts
/**
 * The LinkedIn session reset (design 2026-11-09, the FR-0 companion — the
 * operator's escape hatch for a bad or flagged harvest; the kept budget
 * ledger reporting removed by the browser-walk migration 2026-11-11).
 *
 * Deletes the three artifacts a stale or flagged session leaves behind so
 * the operator can start clean with ONE command:
 *
 *   1. the cookie file (LINKEDIN_COOKIES_FILE, else DEFAULT_COOKIE_PATH)
 *   2. the persistent browser profile (DEFAULT_PROFILE_DIR)
 *   3. the operator-cleared halt latch (the fetch-linkedin.ts DEFAULT_LATCH)
 *
 * Every path is reported; a missing path is a no-op, not an error — the
 * command is idempotent and safe to re-run. The .env line is left alone:
 * it still points at the cookie path the next login harvest will write.
 *
 * The latch path imports from scripts/fetch-linkedin.ts — one source of
 * truth for the state path (a reset that deleted a flag the fetch leg
 * does not read would leave a reset that did not take).
 *
 * Entry-guarded main (the login-linkedin.ts idiom): importing the module
 * stays side-effect free — nothing is deleted on import.
 */
import { rm, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ENV_NAMES } from "../src/config.js";
import { envWithDotEnv } from "../src/env-file.js";
import { DEFAULT_LATCH } from "./fetch-linkedin.js";
import { DEFAULT_COOKIE_PATH, DEFAULT_PROFILE_DIR } from "./login-linkedin.js";

export interface ResetLinkedInDeps {
  /** Environment for the cookie-path default. Default: envWithDotEnv(). */
  env?: Record<string, string | undefined>;
  /** Cookie file target. Default: LINKEDIN_COOKIES_FILE from the merged env, else DEFAULT_COOKIE_PATH. */
  cookiePath?: string;
  /** Browser profile dir. Default: DEFAULT_PROFILE_DIR. */
  profileDir?: string;
  /** Halt-latch flag. Default: DEFAULT_LATCH (exported by fetch-linkedin.ts). */
  latchPath?: string;
  /** Injectable remover. Default: rm(path, { recursive: true, force: true }). */
  remove?: (path: string) => Promise<void>;
}

export interface ResetLinkedInResult {
  /** Paths that existed and were removed. */
  removed: string[];
  /** Paths that did not exist (quiet no-op). */
  absent: string[];
}

async function existsAt(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete the cookie file, the browser profile, and the halt latch, in that
 * order, reporting every outcome. Idempotent: a missing path lands in
 * `absent`, never an error; a deletion that truly fails throws naming the
 * path and the entry wrapper turns it into exit 1.
 */
export async function resetLinkedIn(deps: ResetLinkedInDeps = {}): Promise<ResetLinkedInResult> {
  const env = deps.env ?? envWithDotEnv();
  const fromEnv = env[ENV_NAMES.linkedinCookiesFile]?.trim();
  const cookiePath =
    deps.cookiePath ?? (fromEnv !== undefined && fromEnv !== "" ? fromEnv : DEFAULT_COOKIE_PATH);
  const profileDir = deps.profileDir ?? DEFAULT_PROFILE_DIR;
  const latchPath = deps.latchPath ?? DEFAULT_LATCH;
  const remove =
    deps.remove ?? ((path: string): Promise<void> => rm(path, { recursive: true, force: true }));

  const removed: string[] = [];
  const absent: string[] = [];
  for (const [label, target] of [
    ["cookie file", cookiePath],
    ["browser profile", profileDir],
    ["halt latch", latchPath],
  ] as const) {
    if (!(await existsAt(target))) {
      absent.push(target);
      console.log(`reset-linkedin: ${label} not present — ${target}`);
      continue;
    }
    try {
      await remove(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`reset-linkedin: could not remove the ${label} at ${target} — ${message}`);
    }
    removed.push(target);
    console.log(`reset-linkedin: removed ${label} — ${target}`);
  }
  return { removed, absent };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetLinkedIn().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`reset-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
```

### src/config-file.ts — MODIFY

LINKEDIN_SURFACE_COUNT rationale de-budgeted (comment + the rejection message trailing clause; the pinned exactly-5-required fragments unchanged). Byte-exact applied state: .rpiv/tmp/verify5/src/config-file.ts.

```ts
// Hunk 1 — the surface-count rationale:
/**
 * FR-8 (browser-walk migration 2026-11-11): exactly 5 linkedin surfaces —
 * the PC leg's account-safety bound (the working-hours window and the
 * jittered cadence, times the per-surface scrollRounds click cap) is
 * calibrated for a five-surface fleet. The count is the invariant, not
 * the keywords: an operator may swap a surface's value, never grow the
 * fleet.
 */
const LINKEDIN_SURFACE_COUNT = 5;

// Hunk 2 — the rejection message trailing clause:
      `config: ${filePath} has ${linkedinCount} linkedin surfaces — exactly ${LINKEDIN_SURFACE_COUNT} are required (the PC leg's pacing arithmetic assumes it); keep the five-surface spread`,
```

### src/config.ts — MODIFY

Two `ENV_NAMES` entries deleted (six names survive) and the `LINKEDIN_PAYLOAD_PATH` comment names the writer that exists. Byte-exact applied state: .rpiv/tmp/verify7/src/config.ts.

```ts
// Hunk 1 — ENV_NAMES trimmed to the six surviving names:
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  linkedinCookiesFile: "LINKEDIN_COOKIES_FILE",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;

// Hunk 2 — the payload comment (the PC-local browser walk writes it):
 * PC-leg payload (design D5): the PC-local browser walk writes fetched raw
```

### scripts/probe-linkedin.ts — MODIFY

Browser-walk gate rewrite: the voyager transport probe replaced by one production-stack walk (cookie resolver -> headless Chromium factory -> content-search walk -> flagship-web join) of the first configured surface. Read-only: no payload, no push, no latch, no episode marker. Byte-exact applied state: .rpiv/tmp/verify6/scripts/probe-linkedin.ts.

```ts
/**
 * LinkedIn transport gate (design D8, the probe-judge pattern; rebuilt on
 * the browser walk, migration 2026-11-11): drive the SAME production stack
 * — the cookie resolver, the headless Chromium context factory, the
 * content-search browser walk with its flagship-web response join —
 * against the first configured linkedin surface, one real browser page.
 *
 * Exit 1 on a checkpoint or login wall (the walk's tagged halt), a dead
 * session (no flagship-web response within the liveness window — the
 * tagged leg-dead), every surface faulted, or fewer than 2 posts. The
 * probe writes nothing: no payload, no push, no latch, no episode
 * marker — it is a read-only diagnostic the fetch tick never consults.
 *
 * Operator protocol (Nov 1 research rule): run twice >=6h apart with the
 * stored cookies only before trusting the loop; re-run after every
 * session re-harvest (npm run login-linkedin).
 *
 * Usage: npx tsx scripts/probe-linkedin.ts   (needs LINKEDIN_COOKIES_FILE;
 * runs from the repo root — it loads watcher.config.json at startup)
 */
import { loadWatcherConfig } from "../src/config-file.js";
import { envWithDotEnv } from "../src/env-file.js";
import {
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-fetch.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";

const CONFIG = await loadWatcherConfig();

const surfaces = CONFIG.surfaces.filter(
  (surface): surface is LinkedinSurface => surface.type === "linkedin",
);
if (surfaces.length === 0) {
  console.error("probe: no linkedin surfaces configured in watcher.config.json");
  process.exit(1);
}
const surface = surfaces[0] as LinkedinSurface;

try {
  // The merged env, resolved once: .env fills ONLY unset keys, the real
  // shell wins — an .env-only setup reaches the browser leg unaided.
  const env = envWithDotEnv();
  const cookies = resolveLinkedInCookies(env);
  console.log(
    `probe: browser walk — content search for "${surface.value}" (scrollRounds ${CONFIG.scrollRounds}, headless)`,
  );
  const started = Date.now();
  // The undefined contextFactory selects the walk module's own production
  // factory (headless Chromium, the session document in, the Playwright
  // import lazy inside it) — the same lazy-default the tick suite pins.
  const posts = await fetchLinkedInPosts([surface], cookies, undefined, CONFIG.scrollRounds);
  const elapsed = Date.now() - started;
  console.log(`probe: ${elapsed}ms — ${posts.length} post(s)`);
  if (posts.length < 2) {
    console.error("probe: fewer than 2 posts — the session answered but the leg looks wrong");
    process.exit(1);
  }
  console.log("probe: all checks passed");
} catch (error) {
  if (isHalt(error)) {
    console.error(`probe: HALT — ${error.reason}`);
    process.exit(1);
  }
  if (isLegDead(error)) {
    console.error(`probe: LEG DEAD — ${error.reason}`);
    process.exit(1);
  }
  if (isAllSurfacesFaulted(error)) {
    console.error(`probe: FAILED — ${error.message}`);
    process.exit(1);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`probe: FAILED — ${message}`);
  process.exit(1);
}
```

### package.json — MODIFY

`setup-curl` script deleted; `scripts/setup-curl-impersonate.ts` dropped from the lint and format glob lists (a glob naming an absent path fails biome, so this edit is load-bearing). Byte-exact applied state: .rpiv/tmp/verify7/package.json.

```json
{
  "name": "loker-watcher",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src tests scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/hooks",
    "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts",
    "fetch-linkedin": "tsx scripts/fetch-linkedin.ts",
    "watch-linkedin": "tsx scripts/watch-linkedin.ts",
    "probe-linkedin": "tsx scripts/probe-linkedin.ts",
    "login-linkedin": "tsx scripts/login-linkedin.ts",
    "reset-linkedin": "tsx scripts/reset-linkedin.ts",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.ts": [
      "biome check --write --no-errors-on-unmatched"
    ]
  },
  "dependencies": {
    "nodemailer": "^10.3.0",
    "playwright": "^1.49.1"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/node": "^22.10.1",
    "husky": "^9.1.7",
    "lint-staged": "^15.3.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

### .gitignore — MODIFY

`tools/` entry removed; `state/linkedin-get-budget.json` KEPT (orphaned by design — Migration Notes). Byte-exact applied state: .rpiv/tmp/verify7/.gitignore.

```
node_modules/
.env
.env.*
.pi/
.rpiv/tmp/
.codebase-memory/graph.db.zst
slice*-recon/
linkedin-cookies*.json
state/linkedin-leg-dead.flag
run.log
state/linkedin-get-budget.json
state/linkedin-halt.flag
outputs/.drafts/
outputs/.plans/
```

### src/linkedin-voyager.ts — DELETE

The voyager endpoint client, deleted whole: the parser module occupies its pure-core slot and no survivor imports it (grep-verified in `.rpiv/tmp/verify7/`).

### tests/linkedin-voyager.test.ts — DELETE

The voyager suite, deleted whole with its module.

### tests/fixture/voyager-search-response.json — DELETE

The fixture of the deleted voyager suite, deleted with its only reader (checkpoint-ratified addition, 2026-11-11T13:28+0700).

### scripts/setup-curl-impersonate.ts — DELETE

The curl-impersonate setup script, deleted whole: the browser walk needs no binary. `npm run setup-curl` and the lint/format glob entries go with it.

### tests/setup-curl-impersonate.test.ts — DELETE

The setup suite, deleted whole with its script.

### src/linkedin-session.ts — MODIFY

StorageState types renamed (`VoyagerStorageCookie` -> `LinkedInStorageCookie`, `VoyagerStorageState` -> `LinkedInStorageState`; four identifier sites) and four voyager-era comment lines reworded to browser-session wording. Zero behavioral change; no test imports either type name. Byte-exact applied state: .rpiv/tmp/verify7/src/linkedin-session.ts.

```ts
// Hunk 1 — module header (line 2):
 * LinkedIn session material for the PC-local browser leg (design D4).
// Hunk 2 — the buildCookieHeader bullet (line 12):
 * - buildCookieHeader: the browser session's Cookie header. li_at rides first
// Hunk 3 — the csrfToken bullet (line 17):
 *   "CSRF check failed." on every authenticated request (§13.1).
// Hunk 4 — the buildCookieHeader section doc (line 145):
 * The browser session's Cookie header (§10 template): li_at first, unquoted;
// Hunk 5 — the type rename (lines 159, 173-174, 185):
/** One cookie entry shaped for Playwright's storageState contract (extras stay optional on Playwright's side). */
export interface LinkedInStorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}

export interface LinkedInStorageState {
  cookies: LinkedInStorageCookie[];
  origins: never[];
}

export function toStorageState(cookies: LinkedInCookies): LinkedInStorageState {
```

### src/env-file.ts:79-81 — MODIFY

The `upsertDotEnvLine` hoist comment reworded to name `scripts/login-linkedin.ts` (the surviving consumer) instead of the deleted setup script. Byte-exact applied state: .rpiv/tmp/verify7/src/env-file.ts.

```ts
 * Hoisted here (Phase 9) from scripts/login-linkedin.ts VERBATIM:
 * env-file owns the whole .env contract, and scripts/login-linkedin.ts
 * imports the writer back from here.
 */
export async function upsertDotEnvLine(
```

### tests/env-file.test.ts:47,54 — MODIFY

The sample `.env` key in the quote-stripping fixture swapped CURL_IMPERSONATE_BIN -> SAMPLE_BIN — the locked Slice 8 grep spans `tests/` and would otherwise never return 0; the key is arbitrary, the pin is quote-stripping. Byte-exact applied state: .rpiv/tmp/verify7/tests/env-file.test.ts.

```ts
        'SAMPLE_BIN="C:/tools/sample/sample.exe"',
      SAMPLE_BIN: "C:/tools/sample/sample.exe",
```

### README.md / AGENTS.md / .rpiv/guidance/* — MODIFY

Doc sweep (Slice 8, locked 2026-11-11T13:49:10+0700; follow-up 2026-11-11T14:31+0700 added E51): 51 exact find/replace edits over seven files. Each find-block was built byte-for-byte from the full session reads (README.md, AGENTS.md, and all five guidance docs read fully 2026-11-11 at commit 1cd0f47); each must match its file exactly once at implement time — that uniqueness check is itself a Success Criterion below. Outer fences use four backticks: several edit bodies contain their own triple-backtick code fences. The two scope additions the developer ratified at the micro-checkpoint ride inside: the root guidance file (`.rpiv/guidance/architecture.md`) joins the Files line, and the five 10-minute → 28-33-minute cadence fixes match `scripts/watch-linkedin.ts:3` (28-33-minute jittered sleep, confirmed on disk).

#### README.md — 10 edits

**E1** — find:
````text
separate always-on loop on the developer's PC: it fetches the voyager search
API and pushes `state/linkedin-posts.json`, which the hosted run reads.
````
**E1** — replace with:
````text
separate always-on loop on the developer's PC: a real browser walks the
LinkedIn content-search page for each surface and pushes
`state/linkedin-posts.json`, which the hosted run reads.
````

**E2** — find:
````text
developer's PC runs the voyager search for each linkedin surface
   (`sortBy: date_posted`, past 24 hours, 50-post pages), writes
````
**E2** — replace with:
````text
developer's PC walks the LinkedIn content-search page for each linkedin
   surface — signed in via the harvested cookie session, one paced page
   load plus up to `scrollRounds` "Load more" clicks per surface — writes
````

**E3** — find:
````text
linkedin entries feed a keywords string to the PC leg's voyager search (newest first, past 24 hours) — they need no GitHub secret.
````
**E3** — replace with:
````text
linkedin entries feed a keywords string to the PC leg's browser walk of the content-search page — they need no GitHub secret.
````

**E4** — find:
````text
leg's voyager search runs, not a URL:
````
**E4** — replace with:
````text
leg's browser walk runs on the content-search page, not a URL:
````

**E5** — find:
````text
| `scrollRounds` | Upper bound on scroll rounds per Threads surface walk. Must be a whole number >= 1; absent defaults to `8`. |
````
**E5** — replace with:
````text
| `scrollRounds` | Upper bound on scroll rounds per Threads surface walk, and on "Load more" clicks per LinkedIn surface walk. Must be a whole number >= 1; absent defaults to `8`. |
````

**E6** — find:
````text
## The LinkedIn leg on your PC (voyager)

LinkedIn posts come from the voyager search API, fetched on the developer's
PC by an always-on npm loop — not from GitHub Actions. The endpoint, headers
and encodings follow the reverse-engineering spec of record
(`linkedin-reverse/DOCUMENTATION.md`); when the server expires the queryId
hash, re-derive it per that spec's §9 — a sudden 500 on a formerly-200
endpoint is the signature, not a variables bug.
````
**E6** — replace with:
````text
## The LinkedIn leg on your PC (browser walk)

LinkedIn posts come from a real browser walk of the LinkedIn content-search
page, run on the developer's PC by an always-on npm loop — not from GitHub
Actions. The walk signs in with the harvested cookie session, opens each
linkedin surface's search URL, clicks **Load more** up to `scrollRounds`
times per surface, and parses the pagination responses the page itself
makes. A security checkpoint or login wall halts the leg with one alarm
email (the operator clears it); a dead session sends ONE alarm per episode
and the loop keeps running.
````

**E7** — find:
````text
   No headless re-login exists (2FA dead-ends automated login); the
   headed helper keeps the operator in the loop. A dead session sends
   ONE alarm email per episode and the loop keeps running — refresh the
   file, the next tick heals.
2. `npm run setup-curl` — downloads the checksum-pinned curl-impersonate
   binary (lexiforest release v2.3.2, release-published sha256 digests),
   extracts it into gitignored `tools/curl-impersonate/`, and writes the
   CURL_IMPERSONATE_BIN line to .env. Manual fallback (replaces the old
   install paragraph): install the binary by hand and point
   CURL_IMPERSONATE_BIN at it. If you skip the binary, put
   `LINKEDIN_TRANSPORT=playwright` in .env instead — that switches after
   a failed probe; no auto-fallback in code.
3. `npm run probe-linkedin` — twice, ≥6h apart, stored cookies only; exit 1
   on leg-dead/short/fault. Re-run after any `LINKEDIN_TRANSPORT` change.
4. `npm run watch-linkedin` — tick every 10 min, leave the console open.
````
**E7** — replace with:
````text
   No headless re-login exists (2FA dead-ends automated login); the
   headed helper keeps the operator in the loop.
2. `npm run probe-linkedin` — twice, ≥6h apart, stored cookies only; walks
   the first configured surface read-only and exits 1 on a checkpoint
   wall (`probe: HALT`), a dead session (`probe: LEG DEAD`), a faulted
   walk (`probe: FAILED`), or fewer than 2 posts. Re-run after every
   `npm run login-linkedin` re-harvest.
3. `npm run watch-linkedin` — tick, then a 28-33-minute sleep, forever;
   leave the console open.
````

**E8** — find:
````text
Env setup note: the PC scripts read `.env` beside the clone root
(`LINKEDIN_COOKIES_FILE` written by `login-linkedin`,
`CURL_IMPERSONATE_BIN` written by `setup-curl`); a variable already set
in the shell always wins and `.env` fills only unset keys, so the setup
commands' lines work without any shell profile edit.
````
**E8** — replace with:
````text
Env setup note: the PC scripts read `.env` beside the clone root
(`LINKEDIN_COOKIES_FILE` written by `login-linkedin`); a variable already
set in the shell always wins and `.env` fills only unset keys, so the
setup commands' lines work without any shell profile edit. Upgrading from
a pre-walk checkout: the two old `.env` lines (the transport picker and
the curl binary path) are inert — delete both; keep or delete the old
local tools folder; the old daily-GET ledger file
(`state/linkedin-get-budget.json`) is orphaned — delete it or ignore it.
````

**E9** — find:
````text
dirty paths. Run from a dedicated clean clone of `main`, and re-run
`npm run login-linkedin` + `npm run setup-curl` inside the clone — both
write `<cwd>/.env`, so each clone carries its own line.
````
**E9** — replace with:
````text
dirty paths. Run from a dedicated clean clone of `main`, and re-run
`npm run login-linkedin` inside the clone — it writes `<cwd>/.env`, so
each clone carries its own line.
````

**E10** — find:
````text
The five LinkedIn leg entries (PC only — no LLM_* or GMAIL_* needed for
them, and the cookie file must exist):

```bash
npm run login-linkedin   # headed login: writes the cookie file + the .env line
npm run setup-curl       # one-time: fetch the curl-impersonate binary + the .env line
npm run probe-linkedin   # transport gate: exit 1 on a dead/short/faulted leg
npm run fetch-linkedin   # one tick: fetch → payload → push
npm run watch-linkedin   # the always-on loop: tick + 10-minute sleep
```
````
**E10** — replace with:
````text
The four LinkedIn leg entries (PC only — no LLM_* or GMAIL_* needed for
them, and the cookie file must exist):

```bash
npm run login-linkedin   # headed login: writes the cookie file + the .env line
npm run probe-linkedin   # browser-walk gate: exit 1 on a wall/dead/short walk
npm run fetch-linkedin   # one tick: walk → payload → push
npm run watch-linkedin   # the always-on loop: tick + 28-33-minute sleep
```
````

#### AGENTS.md — 11 edits

**E11** — find:
````text
watch-linkedin`), which fetches the voyager search API and pushes
`state/linkedin-posts.json`; the hosted run reads that payload.
````
**E11** — replace with:
````text
watch-linkedin`), which walks the LinkedIn content-search page in a real
browser and pushes `state/linkedin-posts.json`; the hosted run reads that
payload.
````

**E12** — find:
````text
- `npm run probe-linkedin` - gate the LinkedIn transport: exit 1 on a dead,
  short, or faulted leg; run twice >=6h apart with stored cookies before
  trusting the loop (needs `LINKEDIN_COOKIES_FILE`)
````
**E12** — replace with:
````text
- `npm run probe-linkedin` - gate the LinkedIn browser walk: a read-only
  walk of the first configured surface; exit 1 on a checkpoint wall
  (`probe: HALT`), a dead session (`probe: LEG DEAD`), a faulted walk
  (`probe: FAILED`), or fewer than 2 posts; run twice >=6h apart with
  stored cookies before trusting the loop (needs `LINKEDIN_COOKIES_FILE`)
````

**E13** — find:
````text
- `npm run watch-linkedin` - the always-on PC loop: one tick, then a
  10-minute sleep, forever; leg-dead sends ONE alarm per episode and the
  loop keeps running
````
**E13** — replace with:
````text
- `npm run watch-linkedin` - the always-on PC loop: one tick, then a
  28-33-minute sleep, forever; leg-dead sends ONE alarm per episode and
  the loop keeps running
````

**E14** — find:
````text
- `npm run setup-curl` - one-time curl-impersonate setup: downloads the
  checksum-pinned lexiforest binary (release-published sha256 digests)
  into gitignored `tools/curl-impersonate/` and writes the
  `CURL_IMPERSONATE_BIN` line in `.env`; any failure exits 1 naming both
  remedies (re-run setup-curl, or `LINKEDIN_TRANSPORT=playwright` in
  `.env`)

````
**E14** — replace with: *(nothing — delete the find-block entirely)*

**E15** — find:
````text
- `src/linkedin-voyager.ts` - pure voyager search client core: endpoint
  constants, restli encoding (# -> %23), the canonical search-URL builder,
  and the response parser (drop+count, never throws); timestamp derives
  from `BigInt(id) >> 22n`
````
**E15** — replace with:
````text
- `src/linkedin-parser.ts` - pure Flight parser core: the response-URL
  filter, the row splitter, the `$`-ref commentary-text walker, the
  canonical content-search-URL builder, and the guarded `mintPost`
  (drop+count, never throws); timestamp derives from `BigInt(id) >> 22n`,
  and the timestamp-ordered zip pairs the i-th distinct text with the
  i-th distinct id by timestamp (a count mismatch warns and mints the
  paired prefix)
````

**E16** — find:
````text
synthesis for the Playwright transport
````
**E16** — replace with:
````text
synthesis the walk's context factory consumes
````

**E17** — find:
````text
- `src/linkedin-fetch.ts` - the voyager fetch leg: curl-impersonate
  (`CURL_IMPERSONATE_BIN`) and Playwright transports behind one
  `VoyagerGet` seam (`LINKEDIN_TRANSPORT`, no auto-fallback), the §13.3
  fault classifier with the tagged `LegDeadError`, and the runPool surface
  walk under a shared 5s pacing gate
````
**E17** — replace with:
````text
- `src/linkedin-fetch.ts` - the browser-walk fetch leg: a LinkedIn-local
  `LinkedInContextFactory` (headless Chromium from its own dynamic-import
  quarantine, the harvested cookie DOCUMENT completed per cookie, locale
  en-US) walks each surface — one paced navigation (shared 5-15s gate)
  plus up to `scrollRounds` "Load more" clicks — parses every intercepted
  flagship-web response through `src/linkedin-parser.ts`, and keeps the
  walk skeleton: the FR-5 shuffle, the runPool surface walk, the drain
  arms, the join priority halt > leg-dead > all-faulted, and
  stamp-at-slot-write; a checkpoint/login-wall URL throws the tagged halt
  (`HALT_CHECKPOINT_REASON`, the operator-cleared latch); no first
  response inside the liveness window throws the tagged `LegDeadError`
````

**E18** — find:
````text
- `scripts/probe-linkedin.ts` - the transport gate probe (exit contracts:
  tick = leg-dead exits 1; loop = never exits on leg-dead; probe = gate
  exit 1)
````
**E18** — replace with:
````text
- `scripts/probe-linkedin.ts` - the browser-walk gate probe (exit
  contracts: tick = leg-dead exits 1; loop = never exits on leg-dead;
  probe = a read-only walk of the first configured surface, gate exit 1)
````

**E19** — find:
````text
- `scripts/setup-curl-impersonate.ts` - one-command curl-impersonate
  setup: checksum-pinned lexiforest v2.3.2 download, OS-`tar` extraction
  into gitignored `tools/curl-impersonate/` (inner layout never assumed —
  the tree is walked for `curl-impersonate*.exe`), `.env` line upsert;
  every failure path names the playwright escape hatch (exit 1;
  entry-guarded)

````
**E19** — replace with: *(nothing — delete the find-block entirely)*

**E20** — find:
````text
nodemailer transport for the digest and the leg-dead
  alarm
````
**E20** — replace with:
````text
nodemailer transport for the digest and the leg-dead/halt
  alarms
````

#### .rpiv/guidance/architecture.md — 4 edits

**E21** — find:
````text
the PC-local LinkedIn leg (fetch/watch/probe/login/setup-curl), + Claude Code hooks
````
**E21** — replace with:
````text
the PC-local LinkedIn leg (fetch/watch/probe/login), + Claude Code hooks
````

**E22** — find:
````text
| `npm run probe-linkedin` | gate the LinkedIn transport: exit 1 on a dead, short, or faulted leg |
````
**E22** — replace with:
````text
| `npm run probe-linkedin` | gate the LinkedIn browser walk: a read-only walk of the first configured surface; exit 1 on a checkpoint wall, a dead session, a faulted walk, or fewer than 2 posts |
````

**E23** — find:
````text
| `npm run setup-curl` | one-time curl-impersonate setup: checksum-pinned download into gitignored `tools/curl-impersonate/` + the `.env` line |

````
**E23** — replace with: *(nothing — delete the find-block entirely)*

**E24** — find:
````text
| `npm run fetch-linkedin` / `watch-linkedin` | PC leg: one LinkedIn fetch tick / the always-on loop (tick + 10-min sleep) from a dedicated clone of main |
````
**E24** — replace with:
````text
| `npm run fetch-linkedin` / `watch-linkedin` | PC leg: one LinkedIn fetch tick / the always-on loop (tick + 28-33-min sleep) from a dedicated clone of main |
````

#### .rpiv/guidance/src/architecture.md — 8 edits

**E25** — find:
````text
- **playwright**: THREE dynamic-import quarantine sites — the chromium ContextFactory in fetch-threads.ts, `request.newContext` in linkedin-fetch.ts (ContextLike exposes no request surface, verified 2026-11-04), AND the login helper's headed `launchPersistentContext` in scripts/login-linkedin.ts; no new runtime dep — curl spawns the PC-local curl-impersonate binary (CURL_IMPERSONATE_BIN, not an npm package)
````
**E25** — replace with:
````text
- **playwright**: THREE dynamic-import quarantine sites — the chromium ContextFactory in fetch-threads.ts, the LinkedIn-local headless-Chromium context factory in linkedin-fetch.ts (own `await import("playwright")`), AND the login helper's headed `launchPersistentContext` in scripts/login-linkedin.ts; no new runtime dep
````

**E26** — find:
````text
(heartbeat + exhaustion + leg-dead alarms ride `sendText`)
````
**E26** — replace with:
````text
(heartbeat + exhaustion + leg-dead/halt alarms ride `sendText`)
````

**E27** — find:
````text
#   login-linkedin + setup-curl-impersonate import it)
````
**E27** — replace with:
````text
#   login-linkedin imports it)
````

**E28** — find:
````text
the PC-leg linkedin family (voyager/session/fetch/payload)
````
**E28** — replace with:
````text
the PC-leg linkedin family (parser/session/fetch/payload)
````

**E29** — find:
````text
## linkedin-*.ts: the second platform is a PC-local voyager leg (2026-11-04)

```typescript
// SPEC OF RECORD: linkedin-reverse/DOCUMENTATION.md — endpoint, restli encoding (§4.1+§12.5,
// '#'→%23), §12.7 canonical recipe (sortBy:date_posted; orderBy IGNORED §12.4), §13 fault matrix.
// linkedin-voyager.ts: PURE core — constants + restli encoder + URL builder + parser (drop+count,
// never throws). Timestamp = BigInt(id)>>22n (§12.4 drift caveat).
````
**E29** — replace with:
````text
## linkedin-*.ts: the second platform is a PC-local browser walk (2026-11-11)

```typescript
// SPEC OF RECORD: the live content-search page (capture 2026-11-11) — the walk opens the
// canonical search URL, clicks "Load more" up to scrollRounds times, and parses the
// pagination Flight responses the page itself makes (page JSON is dead: no data-sjs).
// linkedin-parser.ts: PURE core — the LINKEDIN_RESPONSE_RE response filter, the Flight row
// splitter, the $-ref commentary_text walker (longest text per row — the hashtag chip is a
// second commentary component), buildContentSearchUrl (keywords → the content-search URL),
// and the guarded mintPost (drop+count, never throws). Timestamp = BigInt(id)>>22n,
// ms<=0n rejected. Pairing: the timestamp-ordered zip — the i-th distinct commentary text
// (stream order) pairs with the i-th distinct id sorted by derived timestamp ascending; a
// count mismatch warns naming the counts and mints the paired prefix. Every call logs ONE
// pairing-oracle line naming each minted id ↔ text head — the stream carries no id↔text
// link, so that line is the only mis-pair detector that exists.
````

**E30** — find:
````text
// linkedin-fetch.ts: VoyagerGet seam; curl transport (CURL_IMPERSONATE_BIN fail-visible — the message
// names BOTH remedies: npm run setup-curl, or LINKEDIN_TRANSPORT=playwright in .env; lexiforest single
// binary, --impersonate chrome116 pinned — the profile OWNS the UA+TLS+H2 set, so the transport sends no
// user-agent header and BROWSER_UA feeds ONLY the playwright adapter; injectable
// exec, -w status sentinel) + playwright request.newContext transport (own quarantine); resolve
// LINKEDIN_TRANSPORT curl|playwright, no auto-fallback; classifyFault §13.3; LegDeadError +
// AllSurfacesFaulted tagged errors (all surfaces faulted = the walk's leg-dead); runPool walk — runPool
// RETURNS VOID: side arrays by claim index (fetchSurfacesAuthenticated idiom), worker total for surface
// faults, leg-dead drain-then-throw (judgePosts D11 shape); shared per-walk 5s pacing gate — makePacingGate
// RESERVES the slot BEFORE the await (nextFreeAt advances synchronously, so width-2 workers can never
// compute the same wake time; per-walk closure, ticks never inherit stamps) — the rate is pacing-bound,
// not width-bound.
````
**E30** — replace with:
````text
// linkedin-fetch.ts: the browser walk — a LinkedIn-local LinkedInContextFactory (~120 lines duplicated
// from the shared factory: widening breaks the 3 doubles under strictFunctionTypes, re-exporting the
// private factory re-introduces knip N012; headless Chromium, own dynamic-import quarantine, the
// harvested cookie DOCUMENT remapped per cookie — expires -1, httpOnly false, sameSite Lax — locale
// en-US) walks each surface: one paced navigation (shared per-walk 5-15s gate, makePacingGate RESERVES
// the slot BEFORE the await so width-2 workers never compute the same wake time; per-walk closure,
// ticks never inherit stamps) plus up to scrollRounds Load-more clicks (LOAD_MORE_SELECTOR =
// button:has-text("Load more") — no aria-label, no id, deploy-hashed classes; ~2.5s settle window;
// dry-round exit); every interception whose URL matches LINKEDIN_RESPONSE_RE with status 200 parses
// through linkedin-parser.ts; parsed-body counter (N008); first-wins urn dedupe across bodies;
// context + page close on every path. Fault vocabulary: a checkpoint/login/authwall page URL
// (post-goto, every liveness poll tick, post-click-settle) throws the tagged
// HaltError(HALT_CHECKPOINT_REASON) — the operator-cleared latch, NEVER leg-dead; no flagship-web 200
// inside the 30s liveness window throws the tagged LegDeadError (one alarm per episode); a results
// page with zero posts is SUCCESS (the OK — 0 post(s) log, defb8af); anything else is a per-surface
// fault (warn + skip). The kept skeleton rides unchanged — runPool RETURNS VOID: side arrays by claim
// index (fetchSurfacesAuthenticated idiom), worker total for surface faults, leg-dead drain-then-throw
// (judgePosts D11 shape); FR-5 shuffle; join priority halt > leg-dead > all-faulted;
// stamp-at-slot-write; the rate is pacing-bound, not width-bound.
````

**E31** — find:
````text
// The PC scripts themselves live in scripts/ (tick, loop, gate, login, setup-curl) — see
````
**E31** — replace with:
````text
// The PC scripts themselves live in scripts/ (tick, loop, gate, login) — see
````

**E32** — find:
````text
the sanctioned exceptions are builders that always have content (`buildLegDeadAlarmText`, `buildHeartbeatSubject` return plain `string`)
````
**E32** — replace with:
````text
the sanctioned exceptions are builders that always have content (`buildLegDeadAlarmText`, `buildHaltAlarmText`, `buildHeartbeatSubject` return plain `string`)
````

#### .rpiv/guidance/tests/architecture.md — 6 edits

**E33** — find:
````text
nodemailer contributes types only (fake transports); Playwright is never imported at test time (structural `*Like` doubles); the linkedin transport stays unexercised like chromiumContextFactory — the VoyagerGet seam carries the tests
````
**E33** — replace with:
````text
nodemailer contributes types only (fake transports); Playwright is never imported at test time (structural `*Like` doubles); the linkedin walk is exercised through scripted `PageLike` doubles — fake interception events drive the response join
````

**E34** — find:
````text
linkedin-voyager.ts → linkedin-voyager.test.ts   # §12.5 escaping matrix, §12.7 URL pin, id>>22n clock,
#                                              #   fixture/voyager-search-response.json (edges 1-4)
````
**E34** — replace with:
````text
linkedin-parser.ts → linkedin-parser.test.ts     # response-filter matrix, $-ref text walk (chip = longest
#                                              #   per row), guarded id clock, URL builder pin,
#                                              #   timestamp-zip pairing 3/3, mismatch warn + prefix
````

**E35** — find:
````text
linkedin-fetch.ts → linkedin-fetch.test.ts        # §13.3 classifier table, curl-over-fake-exec, resolver matrix, scripted VoyagerGet walk
````
**E35** — replace with:
````text
linkedin-fetch.ts → linkedin-fetch.test.ts        # checkpoint→halt pin, no-first-response→leg-dead, click
#                                              #   transcript, dry-round exit, first-wins urn dedupe,
#                                              #   pacing spacing, teardown on every path
````

**E36** — find:
````text
scripts/setup-curl-impersonate.ts → setup-curl-impersonate.test.ts  # fetch/tar doubles, suite-computed fixture sha, failure pins

````
**E36** — replace with: *(nothing — delete the find-block entirely)*

**E37** — find:
````text
#                                              #   the oracle), transportFor counters, parked deferred() flush,
````
**E37** — replace with:
````text
#                                              #   the oracle), contextFactory pass-through, parked deferred() flush,
````

**E38** — find:
````text
1. File: `tests/<script>.test.ts` (mirror the scripts/ name — fetch-linkedin, login-linkedin, setup-curl-impersonate)
2. Ensure the injection seam FIRST: a deps object on the exported core function (`git`, `transport`, `env`, `markerPath`, `now`, `sleepFn`, `context`) with lazy production defaults;
````
**E38** — replace with:
````text
1. File: `tests/<script>.test.ts` (mirror the scripts/ name — fetch-linkedin, login-linkedin)
2. Ensure the injection seam FIRST: a deps object on the exported core function (`git`, `contextFactory`, `env`, `markerPath`, `now`, `sleepFn`) with lazy production defaults;
````

#### .rpiv/guidance/scripts/architecture.md — 11 edits

**E39** — find:
````text
## Responsibility
Nine files, deliberately separate from src/
````
**E39** — replace with:
````text
## Responsibility
Eight files, deliberately separate from src/
````

**E40** — find:
````text
`login-linkedin.ts` is the headed cookie harvest; `setup-curl-impersonate.ts` is the one-command curl-impersonate setup (checksum-pinned download + .env wire); `hooks/
````
**E40** — replace with:
````text
`login-linkedin.ts` is the headed cookie harvest; `hooks/
````

**E41** — find:
````text
- **fetch-linkedin.ts / watch-linkedin.ts / probe-linkedin.ts / login-linkedin.ts / setup-curl-impersonate.ts**: run via `npm run fetch-linkedin` / `watch-linkedin` / `probe-linkedin` / `login-linkedin` / `setup-curl` from a DEDICATED clone of main; exit contracts: tick = leg-dead exits 1 after the episode alarm (an all-faulted walk is a tagged no-op exit 0, payload untouched), loop = never exits on leg-dead, probe = gate exit 1, login = exit 1 on timeout/no session, setup-curl = exit 1 on any failure (every message names the playwright escape hatch)
````
**E41** — replace with:
````text
- **fetch-linkedin.ts / watch-linkedin.ts / probe-linkedin.ts / login-linkedin.ts**: run via `npm run fetch-linkedin` / `watch-linkedin` / `probe-linkedin` / `login-linkedin` from a DEDICATED clone of main; exit contracts: tick = leg-dead exits 1 after the episode alarm (an all-faulted walk is a tagged no-op exit 0, payload untouched), loop = never exits on leg-dead, probe = gate exit 1, login = exit 1 on timeout/no session
````

**E42** — find:
````text
#   (guardCheckout: branch main + clean porcelain, BEFORE cookies/transport/
                             #   any voyager GET) → fetch → payload → add ONLY state/linkedin-posts.json
````
**E42** — replace with:
````text
#   the working-hours window and the checkpoint latch, then guardCheckout:
                             #   branch main + clean porcelain, BEFORE the cookie gate or any fetch)
                             #   → fetch → payload → add ONLY state/linkedin-posts.json
````

**E43** — find:
````text
watch-linkedin.ts            # .ts, always-on loop: one tick + 600s sleep; leg-dead → ONE alarm per episode
````
**E43** — replace with:
````text
watch-linkedin.ts            # .ts, always-on loop: one tick + a jittered 28-33-minute sleep; leg-dead →
                             #   ONE alarm per episode
````

**E44** — find:
````text
probe-linkedin.ts            # .ts, top-level await gate: cookie resolver → transport → one small voyager page;
````
**E44** — replace with:
````text
probe-linkedin.ts            # .ts, top-level await gate: the production walk READ-ONLY — one headless
                             #   context from the harvested cookie DOCUMENT, the FIRST configured surface,
                             #   config.scrollRounds as the click bound; no payload write, no push, no latch,
                             #   no episode-marker write;
````

**E45** — find:
````text
setup-curl-impersonate.ts    # .ts, entry-guarded; exports runSetupCurl / pinned constants (lexiforest v2.3.2 assets
                             #   + release-published sha256 digests) / SETUP_CURL_ESCAPE_HATCH; already-configured
                             #   short-circuit → platform gate → fetch + sha256 pin → OS tar extract → exe walk → .env
                             #   upsert; EVERY failure names the playwright escape hatch; INSIDE typecheck + lint + lint-staged

````
**E45** — replace with: *(nothing — delete the find-block entirely)*

**E46** — find:
````text
curl/watch entries          watch-linkedin.ts never exits on leg-dead; probe-linkedin.ts exits 1 on leg-dead/short/fault (gate)
````
**E46** — replace with:
````text
watch entries               watch-linkedin.ts never exits on leg-dead; probe-linkedin.ts exits 1 on a checkpoint
                            wall (probe: HALT), a dead session (probe: LEG DEAD), a faulted walk (probe: FAILED),
                            or fewer than 2 posts (gate)
````

**E47** — find:
````text
setup-curl-impersonate.ts   exit 1 on any failure path (non-200 download, sha mismatch, tar, exe-not-found, non-win32) — the message names the escape hatch: re-run setup-curl, or LINKEDIN_TRANSPORT=playwright in .env

````
**E47** — replace with: *(nothing — delete the find-block entirely)*

**E48** — find:
````text
5. Exit contract up front: a catch-all wrapper prints `FAILED — <message>` and `process.exit(1)`; domain gates (leg-dead, timeout, sha mismatch) throw and the wrapper owns the exit
````
**E48** — replace with:
````text
5. Exit contract up front: a catch-all wrapper prints `FAILED — <message>` and `process.exit(1)`; domain gates (leg-dead, halt, timeout) throw and the wrapper owns the exit
````

**E49** — find:
````text
2. Export the logic, not a side effect: a deps object (`FetchTickDeps` / `LoginHelperDeps` / `SetupCurlDeps` shapes) lets tests inject fakes; default deps resolve lazily (`deps.env ?? envWithDotEnv()`)
````
**E49** — replace with:
````text
2. Export the logic, not a side effect: a deps object (`FetchTickDeps` / `LoginHelperDeps` shapes) lets tests inject fakes; default deps resolve lazily (`deps.env ?? envWithDotEnv()`)
````

#### .rpiv/guidance/.github/workflows/architecture.md — 1 edit

**E50** — find:
````text
watch.yml maps 5 of the 8 ENV_NAMES (`HEARTBEAT_ENABLED` via `vars.` — the one non-secret knob); the LinkedIn trio (`LINKEDIN_COOKIES_FILE`, `LINKEDIN_TRANSPORT`, `CURL_IMPERSONATE_BIN`) is deliberately NOT mapped — PC-only, never enters Actions; unset means enabled
````
**E50** — replace with:
````text
watch.yml maps 5 of the 6 ENV_NAMES (`HEARTBEAT_ENABLED` via `vars.` — the one non-secret knob); the LinkedIn name (`LINKEDIN_COOKIES_FILE`) is deliberately NOT mapped — PC-only, never enters Actions; unset means enabled
````

**E51** — find:
````text
- `scripts/watch-linkedin.ts` - the always-on PC loop (tick + 600s sleep)
````
**E51** — replace with:
````text
- `scripts/watch-linkedin.ts` - the always-on PC loop (tick + a 28-33-minute sleep)
````

## Slices

### Slice 1: Parser core

**Files**: `src/linkedin-parser.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] No static Playwright import: `grep -n "playwright" src/linkedin-parser.ts` returns nothing

#### Manual Verification:
- [ ] Scratch proof against the real capture (`.rpiv/tmp/verify1/`): 3 posts minted — Full-Stack <-> ...655298 (22:11:39.858Z), Chef <-> ...919681 (22:16:28.628Z), PCB <-> ...094017 (22:18:16.583Z); `buildContentSearchUrl("hiring indonesia")` reproduces the live URL byte-for-byte (executed 2026-11-11, pass)

### Slice 2: Parser suite

**Files**: `tests/linkedin-parser.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Parser suite green: `npx tsx --test tests/linkedin-parser.test.ts` — 17 tests, 0 failures
- [ ] No static Playwright import: `grep -n "playwright" tests/linkedin-parser.test.ts` returns nothing

#### Manual Verification:
- [ ] Fixture provenance re-checked against the live page: the three pinned epochs (22:11:39.858Z / 22:16:28.628Z / 22:18:16.583Z) still match the rendered age labels
- [ ] During the live rehearsal, the pairing-oracle line names the same id ↔ text pairs the page renders (the only mis-pair detector that exists)

### Slice 3: Seam growth

**Files**: `src/fetch-threads.ts`, `src/linkedin-fetch.ts`, `src/linkedin-behavior.ts`, `tests/linkedin-behavior.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Behavior suite green: `npx tsx --test tests/linkedin-behavior.test.ts` — 16 tests, 0 failures (three-way reason pin included)
- [ ] Full offline suite green on the composed tree (HEAD + Slices 1-3): `npm test` — 0 failures (610 tests at generation; the count grows as later slices land — the 0-failure invariant is the criterion)
- [ ] No static Playwright import: `grep -rnE "from .playwright." src/ tests/` returns nothing (both Playwright sites stay dynamic `await import`)

#### Manual Verification:
- [ ] The url() seam is optional and both production adapters supply it: `grep -n "url?(): string" src/fetch-threads.ts` (1 hit) and `grep -c "url: () => page.url()" src/fetch-threads.ts src/linkedin-fetch.ts` (1 each); the Threads walk bodies are untouched
- [ ] Budget machine intact: `grep -n "DAILY_GET_BUDGET" src/linkedin-behavior.ts scripts/fetch-linkedin.ts` still hits (deletion rides Slice 5)
- [ ] Factory mechanics mirror the shared factory (launch → newContext → adapter fields, including the mirrored en-US pin) except two intentional deltas: the document storageState with cookie completion, and the url() supply


### Slice 4: Walk swap

**Files**: `src/linkedin-fetch.ts`, `tests/linkedin-fetch.test.ts`

#### Automated Verification:
- [ ] Type checking: `npx tsc --noEmit` on the composed tree (HEAD + Slices 1-4) reports errors ONLY in `scripts/fetch-linkedin.ts`, `scripts/probe-linkedin.ts`, and `tests/fetch-linkedin.test.ts` - the deleted transport seam consumers that Slices 5-6 rewire; `src/` and all other tests are clean
- [ ] Walk suite green: `npx tsx --test tests/linkedin-fetch.test.ts` - 0 failures (25 tests)
- [ ] Parser + behavior suites still green on the composed tree: `npx tsx --test tests/linkedin-parser.test.ts tests/linkedin-behavior.test.ts` - 0 failures (17 + 16 tests)
- [ ] No static Playwright import: `grep -rnE "from .playwright." src/ tests/` returns nothing (the one site stays a dynamic `await import`)
- [ ] Transport seam fully gone: `grep -nE "VoyagerGet|resolveLinkedInTransport|classifyFault|createCurlTransport|createPlaywrightTransport|PAGE_SIZE" src/linkedin-fetch.ts` returns nothing

#### Manual Verification:
- [ ] The kept skeleton reads verbatim: FR-5 Fisher-Yates shuffle with structural reassembly, drain checks, join priority halt > leg-dead > all-faulted, stamp-at-slot-write, per-surface OK log (empty-is-success, defb8af)
- [ ] Pacing re-seated on navigations: one `gate.wait()` per surface before its goto; clicks ride the ~2.5s settle window and never trip the gate; reserve-before-sleep preserved
- [ ] Checkpoint detector reads `page.url()` at three sites (post-goto, every liveness poll tick, post-click-settle); a checkpoint ALWAYS lands the tagged HaltError carrying `HALT_CHECKPOINT_REASON`, never legDead/fault; absence of the optional seam reads as no checkpoint
- [ ] Liveness gate: no flagship-web 200 response within 30s throws the tagged LegDeadError; the OK line counts bodies that CARRIED posts (N008: parsed, not received)
- [ ] First-wins urn dedupe across bodies; empty surface list launches no browser; context + page close on every path

### Slice 5: Tick rewire + budget deletion

**Files**: `scripts/fetch-linkedin.ts`, `scripts/reset-linkedin.ts`, `src/linkedin-behavior.ts`, `src/email.ts`, `src/config-file.ts`, `tests/fetch-linkedin.test.ts`, `tests/linkedin-behavior.test.ts`, `tests/reset-linkedin.test.ts` (the eighth file is a checkpoint-ratified scope addition)

#### Automated Verification:
- [ ] Type checking: `npx tsc --noEmit` on the composed tree (HEAD + Slices 1-5) reports errors ONLY in `scripts/probe-linkedin.ts` (the file Slice 6 rewires); src/, scripts/, and tests/ are otherwise clean
- [ ] Tick suite green: `npx tsx --test tests/fetch-linkedin.test.ts` — 0 failures (29 tests)
- [ ] Behavior + reset suites green: `npx tsx --test tests/linkedin-behavior.test.ts tests/reset-linkedin.test.ts` — 0 failures (10 + 3 tests)
- [ ] Full offline suite green on the composed tree: `npm test` — 0 failures (581 tests on the verify5 materialization; the 0-failure invariant is the criterion)
- [ ] Lint passes: `npm run lint` (biome clean over the eight touched files)
- [ ] Budget machine fully gone: `grep -rnE "DAILY_GET_BUDGET|HALT_BUDGET_REASON|budgetAllows|budgetReserve|freshBudget|DailyBudgetState|DEFAULT_BUDGET|localDateKey" src/ scripts/ tests/` returns nothing
- [ ] Transport seam gone from the tick: `grep -nE "VoyagerGet|resolveLinkedInTransport|\.dispose\(|type Transport" scripts/fetch-linkedin.ts` returns nothing

#### Manual Verification:
- [ ] Preflight band reads window -> latch -> checkout guard; the budget step and its ledger file are gone; deps.contextFactory stays optional and reaches fetchLinkedInPosts unmodified (undefined -> the in-module production factory)
- [ ] config.scrollRounds rides into the walk as the per-surface click bound (the threading test pins clicks [1, 2, 3] at scrollRounds 3)
- [ ] buildHaltAlarmText names no deleted file and no 429; reset-linkedin reports no kept ledger; scripts/probe-linkedin.ts remains the only red file (carried into Slice 6)

### Slice 6: Probe rewrite

**Files**: `scripts/probe-linkedin.ts`

#### Automated Verification:
- [ ] Type checking: `npx tsc --noEmit` on the composed tree (HEAD + Slices 1-6) reports 0 errors — the Slice 5 red window (`scripts/probe-linkedin.ts:21`) closes and the full tree is green again
- [ ] Lint passes: `npm run lint` (the probe file stays in the enumerated lint list; biome clean)
- [ ] Full offline suite green on the composed tree: `npm test` — 0 failures (581 tests on the verify6 materialization, unchanged count — the slice adds no test file; the 0-failure invariant is the criterion)
- [ ] No static Playwright import: `grep -n "playwright" scripts/probe-linkedin.ts` returns nothing (the browser opens only inside the walk's dynamic import)
- [ ] Voyager residue gone from the probe: `grep -nE "voyager|resolveLinkedInTransport|parseSearchResponse|buildSearchUrl|LINKEDIN_TRANSPORT" scripts/probe-linkedin.ts` returns nothing

#### Manual Verification:
- [ ] The probe drives the production walk read-only: one headless context from the harvested cookie document, the first configured surface, `config.scrollRounds` as the click bound; no payload write, no push, no latch, no episode-marker write
- [ ] Exit contracts match the gate table: a checkpoint run exits 1 with `probe: HALT`; a dead session exits 1 with `probe: LEG DEAD`; an all-faulted or plain fault exits 1 with `probe: FAILED`; fewer than 2 posts exits 1; a healthy walk exits 0 after `probe: all checks passed`
- [ ] Operator ritual stands in the header: run twice >=6h apart before trusting the loop; re-run after every re-harvest (npm run login-linkedin)

### Slice 7: Deletion sweep

**Files**: `src/linkedin-voyager.ts` (DELETE), `tests/linkedin-voyager.test.ts` (DELETE), `scripts/setup-curl-impersonate.ts` (DELETE), `tests/setup-curl-impersonate.test.ts` (DELETE), `tests/fixture/voyager-search-response.json` (DELETE), `src/config.ts`, `src/linkedin-session.ts`, `src/linkedin-parser.ts`, `src/linkedin-fetch.ts`, `src/env-file.ts`, `tests/env-file.test.ts`, `package.json`, `.gitignore` (the fixture plus the six src/test edits are checkpoint-ratified scope additions, advisor-mediated 2026-11-11T13:28+0700)

#### Automated Verification:
- [ ] Type checking passes on the composed tree (HEAD + Slices 1-7): `npx tsc --noEmit` — 0 errors (the deletions and the rename break no survivor)
- [ ] Lint passes: `npm run lint` — biome clean (62 files on the verify7 materialization; the globs no longer name the deleted script)
- [ ] Full offline suite green: `npm test` — 0 failures (554 tests on the verify7 materialization, down from 581 by the 27 tests of the two deleted suites; the 0-failure invariant is the criterion)
- [ ] Voyager residue gone from src/ and scripts/: `grep -rni "voyager" src scripts` returns nothing
- [ ] Deleted env names gone: `grep -rnE "LINKEDIN_TRANSPORT|CURL_IMPERSONATE_BIN" src scripts tests` returns nothing
- [ ] All five paths absent: `ls src/linkedin-voyager.ts tests/linkedin-voyager.test.ts scripts/setup-curl-impersonate.ts tests/setup-curl-impersonate.test.ts tests/fixture/voyager-search-response.json` exits nonzero for every one

#### Manual Verification:
- [ ] `ENV_NAMES` carries exactly six names; `grep -rn "ENV_NAMES.linkedinTransport\|ENV_NAMES.curlImpersonateBin" src scripts tests` returns nothing
- [ ] The `LinkedInContextFactory` parameter and the walk import carry `LinkedInStorageState`; the session, walk, and tick suites pass unchanged (no test imports either type name)
- [ ] Locked Slice 1 and Slice 4 fences changed comment/type-name only — every code line byte-identical (slice-verifier cross-slice check)
- [ ] `.gitignore` keeps `state/linkedin-get-budget.json` (orphaned by design, Migration Notes); `package.json` has no `setup-curl` script
- [ ] The `tests/env-file.test.ts` quote-stripping and upsert pins are otherwise unchanged; the `src/env-file.ts` hoist comment names no deleted script
- [ ] `tests/linkedin-parser.test.ts:182` keeps the `voyager/api` negative case — deliberate: it pins that `LINKEDIN_RESPONSE_RE` rejects the deleted endpoint (the only surviving voyager string in the composed tree)

### Slice 8: Doc sweep + baseline gates

**Files**: `README.md`, `AGENTS.md`, `.rpiv/guidance/architecture.md` (checkpoint-ratified scope addition), `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/tests/architecture.md`, `.rpiv/guidance/scripts/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md`

#### Automated Verification:
- [ ] Baseline: `npm run typecheck` — 0 errors
- [ ] Baseline: `npm run lint` — clean
- [ ] Baseline: `npm test` — 0 failures (554 at Slice 7; the slice touches docs only — the 0-failure invariant is the criterion)
- [ ] The locked Verification-Notes gate: `grep -rnE "LINKEDIN_TRANSPORT|CURL_IMPERSONATE_BIN|DAILY_GET_BUDGET|HALT_BUDGET_REASON" src/ scripts/ tests/ README.md AGENTS.md` returns nothing
- [ ] Deleted-module sweep: `grep -rniE "voyager|setup[-_]?curl|curl-impersonate" README.md AGENTS.md .rpiv/guidance/` returns nothing
- [ ] Cadence truthful: `grep -rnE "10-min(ute)? sleep|tick every 10 min|600s sleep" README.md AGENTS.md .rpiv/guidance/` returns nothing
- [ ] Edit-set integrity: every find-block in the Architecture entry matches its file exactly once before the replace applies (51 finds, seven files)

#### Manual Verification:
- [ ] README, AGENTS.md, and the guidance files agree with the code on the walk shape: the selector (`button:has-text("Load more")`), the 5-15s navigation gate, the ~2.5s click settle, and the probe exit vocabulary (`probe: HALT` / `probe: LEG DEAD` / `probe: FAILED` / `probe: all checks passed`)
- [ ] The README upgrade note names no gated literal — the two inert `.env` lines are described (the transport picker, the curl binary path), never quoted
- [ ] Each edited section reads coherently end-to-end after the sweep

## Desired End State

```bash
# Operator view — nothing about the config file or the login flow changes:
npm run login-linkedin          # headed harvest, unchanged
npm run probe-linkedin          # one browser walk of the first keyword; exit 1 = fix before trusting
npm run watch-linkedin          # the loop: window, latch, checkout, cookie gate, browser walk, payload, push

# watcher.config.json — unchanged shape; scrollRounds now bounds LinkedIn Load-more clicks too
```

```ts
// Hosted side, unchanged: the payload read still degrades to a threads-only run.
const read = await linkedinFetch(LINKEDIN_PAYLOAD_PATH, now);
// read.leg === "ok" when the PC walk pushed within PAYLOAD_MAX_AGE_MS.
```

## File Map

```
src/linkedin-parser.ts              # NEW — pure Flight parser + timestamp-zip pairing + search URL builder
tests/linkedin-parser.test.ts       # NEW — parser suite (restored + pairing + round-trip)
src/fetch-threads.ts                # MODIFY — PageLike.url?() + adapter supply
src/linkedin-fetch.ts               # MODIFY — transport half out, factory + browser walk in
src/linkedin-behavior.ts            # MODIFY — +HALT_CHECKPOINT_REASON, -budget machine
src/email.ts                        # MODIFY — halt alarm wording de-budgeted
src/config-file.ts                  # MODIFY — surface-count rationale comment
src/config.ts                       # MODIFY — two ENV_NAMES entries deleted
scripts/fetch-linkedin.ts           # MODIFY — contextFactory dep, budget deleted, dispose removed
scripts/reset-linkedin.ts           # MODIFY — kept-ledger reporting removed (it never deleted the ledger)
scripts/probe-linkedin.ts           # MODIFY — browser-walk gate rewrite
tests/linkedin-fetch.test.ts        # MODIFY — walk suite replaces transport suites
tests/linkedin-behavior.test.ts     # MODIFY — budget suites out, checkpoint reason pin in
tests/fetch-linkedin.test.ts        # MODIFY — dep shape + budget prune
tests/linkedin-voyager.test.ts      # DELETE
scripts/setup-curl-impersonate.ts   # DELETE
tests/setup-curl-impersonate.test.ts # DELETE
src/linkedin-voyager.ts             # DELETE
src/linkedin-session.ts             # MODIFY — storageState type renames + comment de-voyagering (Slice 7)
src/linkedin-parser.ts              # MODIFY — four comment rewords, no code change (Slice 7)
src/linkedin-fetch.ts               # MODIFY — 2 renamed type lines (Slice 7)
src/env-file.ts                     # MODIFY — hoist comment reworded (Slice 7)
tests/env-file.test.ts              # MODIFY — sample .env key swap (Slice 7)
tests/fixture/voyager-search-response.json # DELETE — only the deleted voyager suite read it
package.json                        # MODIFY — setup-curl script + globs
.gitignore                          # MODIFY — tools/ entry removed
README.md                           # MODIFY — doc sweep
AGENTS.md                           # MODIFY — doc sweep
.rpiv/guidance/*                    # MODIFY — doc sweep (4 files)
```

## Ordering Constraints

- Slice 1 → 2 (suite tests the parser). Slice 3 before 4 (the walk imports the factory + checkpoint reason). Slice 4 before 5 and 6 (tick + probe import the walk). Slice 5 before 6 is preferred (shrinks the red window to one file). Slice 6 before 7 (the probe must stop importing the voyager module before it is deleted). Slice 7 before 8 (docs describe the final shape).
- Typecheck window: after slice 4 the expected-error set is `scripts/fetch-linkedin.ts` + `scripts/probe-linkedin.ts`; after slice 5 only `scripts/probe-linkedin.ts`; slice 6 restores full green.
- No parallelism: slices are sequential by skill contract.

## Verification Notes

- [ ] `grep -rnE "from .playwright." src/ tests/` returns only dynamic-import sites (`fetch-threads.ts`, `linkedin-fetch.ts`, `scripts/login-linkedin.ts`) — the suite stays Playwright-free.
- [ ] `grep -rn "voyager" src/ scripts/` returns 0 after Slice 7.
- [ ] `grep -rnE "LINKEDIN_TRANSPORT|CURL_IMPERSONATE_BIN|DAILY_GET_BUDGET|HALT_BUDGET_REASON" src/ scripts/ tests/ README.md AGENTS.md` returns 0 after Slice 8.
- [ ] Payload round-trip: `writePayloadAtomic(walkOutput)` → `readPayloadPosts` → `leg: "ok"`, zero dropped (Slice 2, offline).
- [ ] Pairing: 3/3 posts on the capture-shaped synthetic body; count mismatch warns and mints the prefix (Slice 2).
- [ ] Walk: checkpoint URL → `halt` (not `legDead`, not fault); no-first-response → `legDead`; zero-post surface → success log; shuffle transcript with seeded rng; pacing spacing recorded by the injected sleep; teardown on every path; zero voyager URLs in `gotos`/`responseUrls` (Slice 4).
- [ ] `npx tsc --noEmit` error sets match the per-slice windows (Slices 4-6).
- [x] DONE 2026-11-11: `npm run login-linkedin` harvested (exit 0; cookie file + `.env` line written), and the headed capture landed — `LOAD_MORE_SELECTOR = "button:has-text(\"Load more\")"`, one candidate on the live results page (see Key Discoveries). The Slice 4 gate is closed.
- [ ] Slice 1 pairing oracle: every `collectLinkedInPosts` call logs one `linkedin-parser: N pair(s) — ...` line naming each minted id ↔ text head (verified live 2026-11-11: 3 pairs on the capture).
- [x] DONE 2026-11-11T18:40+0700: headless detectability is MEASURED, and the answer is worse than "detected" — the fresh-context factory gets a page with no Load-more button in BOTH modes, and the persistent profile gets the button only when headed. Four-config matrix in Key Discoveries. The retune this note predicted is the Session model decision.
- [ ] Manual, before trusting the loop: `npm run login-linkedin` → `npm run probe-linkedin` twice >=6h apart → one `npm run fetch-linkedin` tick (payload lands, push succeeds, one `OK — N post(s)` line per surface) → force a checkpoint and confirm one alarm + latch + untouched payload. With the profile + headed model, expect `click N: fired +6 new` lines and 30+ posts per surface.
- [ ] Parser gate (REVISED): a body whose id and text counts differ mints NOTHING and warns. The old "mint the paired prefix" rule is disproved — it mis-pairs every post after the gap.

## Performance Considerations

- Per tick worst case: 5 surfaces × (1 paced navigation + up to `scrollRounds` clicks at ~2.5s settle) = 5 navigations + 40 clicks (5 × 8), spread over the working window; the shared gate keeps the navigation rate pacing-bound at width 2.
- Per local day worst case: 28 wake-ups × (5 navigations + 40 clicks) = 140 navigations + 1120 clicks. The old budget arithmetic (28 × 5 × 1 = 140 < 150) is retired with the budget machine; the pacing gate (5-15s between navigations) and the working-hours window remain the rate bounds.
- Post cap 150/surface (`LINKEDIN_MAX_POSTS`) rides from the deleted walk.
- The parser is pure string work over <=1.6 MB bodies per response — the offline run parsed 448 rows / minted 2 in well under a second.

## Migration Notes

- No persisted schema change: the payload stays v2; `state/seen-posts.json`, the latch, and the episode marker keep their shapes.
- `state/linkedin-get-budget.json` becomes orphaned: `scripts/reset-linkedin.ts` stops clearing it (Slice 5); the operator deletes the file by hand or ignores it (untracked).
- `.env` lines `LINKEDIN_TRANSPORT` and `CURL_IMPERSONATE_BIN` become inert; the doc sweep says to remove them. `tools/curl-impersonate/` stays on disk (gitignored entry removed in Slice 7 — keep or delete locally).
- Rollback: `git revert` of the migration restores the voyager leg whole; the cookie file and payload are unchanged and compatible both ways.

## Pattern References

- `runPool` slot arrays: `src/pool.ts:33-52`, `src/fetch-threads.ts:315-341`.
- Stamp-at-slot-write: `src/linkedin-fetch.ts:576-580` (kept verbatim).
- Tagged errors: `src/linkedin-fetch.ts:116-192` (name constant + factory + guard — the wire contract).
- Dynamic-import quarantine: `src/fetch-threads.ts:131` (idiom), new site in `linkedin-fetch.ts`.
- Per-walk pacing closure: `src/linkedin-fetch.ts:470-493` (re-seated on navigations).
- Interception join: `src/fetch-threads.ts:336-380` (attach-before-goto, filter, settle) — conflicts fixed per Key Discoveries.
- Deleted walk mechanics: `68c1e2d:src/fetch-linkedin.ts` (parser 60-247, walk 256-338).
- Guarded timestamp: `src/linkedin-voyager.ts:114-126`.
- Dry-round pagination loop: `src/fetch-threads.ts:418-448` (shape reused for clicks).

## Developer Context

**Checkpoint round 1 (2026-11-11, dense framing)** — all four questions came back unanswered ("i dont understand", "this budget seems irrelevant?", "it seems invalid now?"). Re-framed in plain language.

**Checkpoint round 2 (plain language, decisions locked)**:
- Post linking: **"Join by time order"** — sort ids by their own timestamps, texts by page order, join 1st-with-1st; count mismatch warns. Evidence: the `.rpiv/tmp/analyze-*.mjs` BFS and zip analyses on the live capture.
- Daily cap: **"delete cap and connect it with how many scroll setting in threads (by default is 8, means 8 times click)"** — budget machine deleted; `scrollRounds` bounds clicks.
- Pre-flight: **"Rebuild the check"** — probe stays, new engine.
- Config key: **"Keep key as click count"** — `scrollRounds` unchanged in the config file.

**Summary confirm**: Proceed. **Decomposition confirm**: Approve (8 slices).

**Review round (2026-11-11T08:32:35+0700, developer)**: five findings applied — (1) Slice 3 cookie mapping was unspecified; recorded: the factory takes the storageState DOCUMENT and remaps expires/httpOnly/sameSite per the deleted transport (`src/linkedin-fetch.ts:407-420`). (2) Load-more selector was undesigned; the capture carries the component id but not the DOM string — Slice 4 generation is gated on a headed capture. (3) Performance arithmetic was wrong (said 45/360); corrected to 5/40 per tick, 140/1120 per day. (4) `scripts/reset-linkedin.ts` was asserted unread; read fully — it KEEPS the ledger by design, so Slice 5 removes the kept-ledger reporting, not a delete step. (5) Pairing lacked a mis-pair detector; added the always-on pairing line naming ids ↔ text heads (same-count wrong-order remains structurally undetectable — the decision stands, the log is the oracle).

**Selector capture round (2026-11-11T08:45:49+0700, operator-assisted)**: login-linkedin harvested exit 0 in 44s; bladebro navigated the live search URL (session alive) and counted the Load-more candidates: 1. outerHTML recorded in Key Discoveries; `LOAD_MORE_SELECTOR` fixed as the text handle; the Slice 4 prerequisite is satisfied.

**Design-time decisions recorded without a dedicated ask** (visible in Decisions; adjustable via follow-up): parser module name `src/linkedin-parser.ts`; synthetic inline fixtures; pacing band 5-15s per navigation; headless true pending rehearsal; fault-vocabulary re-mapping; N008 counter direction; ~120-line factory duplication.

**Micro-checkpoints**: recorded per slice below in Design History as slices lock.

**Slice 7 checkpoint (2026-11-11T13:28+0700, advisor-mediated)**: two decisions — the type-name/gate conflict and which optional cleanups ride the slice. The developer escalated both to the advisor model: rename VoyagerStorage* -> LinkedInStorage* (the voyager comments were factually wrong post-migration, not merely stale: no voyager GET exists, and src/config.ts credited the wrong payload writer), take both cleanups (the orphaned fixture; the env-file hoist comment), and the advisor flagged the Slice 8 grep blocker (the CURL_IMPERSONATE_BIN sample key in tests/env-file.test.ts). Confirmed at the re-ask: "Apply all". A preflight grep of the .rpiv/guidance/ docs confirmed no doc pins the fixture path as a contract.

## Design History

- Slice 1: Parser core — approved as generated. Verifier 3x OK (Decisions/Cross-slice/Research); scratch proof 3/3 on the live capture.
- Follow-up 2026-11-11T08:32:35+0700 (review round): Slice 1 code revised in place — total sort comparator, pairing spot-check log line (re-scratch-proofed); prose fixes — perf arithmetic (5 navigations + 40 clicks per tick, 140 + 1120 per day), reset-linkedin spec corrected (it never deleted the ledger), cookie mapping recorded, Load-more selector gated on a live headed capture before Slice 4, LINKEDIN_RESPONSE_RE added to the Architecture inventory.
- Follow-up 2026-11-11T08:45:49+0700 (selector capture): `npm run login-linkedin` harvested (exit 0, 44s — the persistent profile was still signed in; cookie file + `.env` line written), then the live page yielded the Load-more button: one candidate, no aria-label/id, deploy-hashed classes — `LOAD_MORE_SELECTOR = "button:has-text(\"Load more\")"`. The Slice 4 selector gate is CLOSED.
- Slice 2: Parser suite — approved as generated. Gates run on a scratch materialization of the locked Slice 1 parser + this suite (`.rpiv/tmp/verify2/`, plus the payload module's real import closure): 17/17 tests pass, `tsc` strict clean, biome file-mode clean against a mirror of the repo config.
- Follow-up 2026-11-11 (Slice 2 verification): the locked Slice 1 fence carried a latent lint failure at line 69 (`lint/style/useTemplate` — string concatenation, a construct src/ never uses; the repo lints clean today). Biome's own autofix applied to the artifact fence (identical output string; the suite pins the URL byte-for-byte, so drift stays impossible). The suite's import order was also corrected (`organizeImports`: `linkedin-parser.js` before `linkedin-payload.js`).
- Slice 3: Seam growth — approved as generated. Verifier OK on the second pass (first pass found an evidence-provenance gap — the scratch lacked the locked Slices 1-2 files — and a brittle whole-suite count pin; fixed by byte-exact fence materialization into the scratch and re-authoring the criterion to the 0-failure invariant; composed tree HEAD + Slices 1-2-3: tsc clean, biome clean 67 files, parser 17/17, behavior 16/16, full 610/610).
- Slice 3 micro-checkpoint (2026-11-11, approved as presented): additive hunks only — PageLike.url?() + adapter supply, HALT_CHECKPOINT_REASON, the three-way reason pin, the duplicated LinkedIn context factory. Fit recorded: reused ContextLike/LocatorLike/PageLike seams + the adapter template from makeChromiumContextFactory + the deleted transport cookie-completion shape + VoyagerStorageState; new surface LinkedInContextFactory / HALT_CHECKPOINT_REASON / PageLike.url?(), all Slice 4/5-consumed by design; conventions followed: dynamic-import quarantine, FR-7 canonical-reason pattern, type-only imports. Verifier cosmetic catch adopted: en-US is a mirrored property, not a delta (criteria reworded to two intentional deltas).
- Slice 4: Walk swap - approved as generated. Verifier 2-pass (cross-slice VIOLATION: three Slice 3 factory comment lines reworded in the materialization - restored byte-exact from the locked fence, re-check OK). Gates on the composed tree (HEAD + Slices 1-4): tsc red window exactly the three files Slices 5-6 rewire (7 errors), suites 58/58 (parser 17 + behavior 16 + walk 25), biome clean over 58 files.
- Slice 5: Tick rewire + budget deletion — approved as generated (3 checkpoint-ratified deviations: tests/reset-linkedin.test.ts added to the slice — it imports DEFAULT_BUDGET and pins kept; localDateKey deleted with its describe — zero consumers after the budget machine, the knip dead-export class; config-file.ts error-message clause de-budgeted alongside the comment — no test pins it). Verified by scratch materialization .rpiv/tmp/verify5/ (composed HEAD + locked Slices 1-4 + this slice): tsc red window exactly scripts/probe-linkedin.ts:21 (1 error, Slice 6 target); suites 42/42 (tick 29 + behavior 10 + reset 3); full 581/581; biome clean over the 8 touched files; budget-symbol grep 0 hits.
- Slice 6: Probe rewrite — approved as generated. Verified by scratch materialization .rpiv/tmp/verify6/ (a copy of verify5 + this slice; no slice-verifier subagent exists in this session, so the pass ran as gate execution plus the three verifier dimensions): Decisions (browser-gate rebuild, first surface, exit 1 on wall/dead/short, scrollRounds threaded, no config change) OK; Cross-slice (imports only locked Slice 4/5 exports, no tick-script coupling, dead voyager imports gone) OK; Research (guidance gate contract + the run-twice ritual carried) OK. Gates on the composed tree (HEAD + Slices 1-6): tsc exit 0 full tree (the red window closed), biome clean, full 581/581 (unchanged count — no test file by decomposition), both grep gates 0 hits.
- Follow-up 2026-11-11T12:11:54+0700 (fence hygiene, formatting-only): the Slice 6 probe fence and the four lock-slice5 fences (src/linkedin-behavior.ts, tests/linkedin-behavior.test.ts, scripts/fetch-linkedin.ts, scripts/reset-linkedin.ts) each carried one delimiter-adjacent blank line, so verify-lock.cjs's extractor (slice(bodyStart, close + 1)) recovered one extra trailing LF per fence. Normalized to the code-final-LF-is-the-delimiter shape; the CODE is byte-unchanged — after the edit every full-file fence extracts byte-exact against .rpiv/tmp/verify6/.
- Slice 7: Deletion sweep — approved as generated (checkpoint-ratified scope additions beyond the locked Files line: src/linkedin-session.ts type renames + comment de-voyagering — amends the "zero changes" Scope line; tests/fixture/voyager-search-response.json deleted with its suite; the tests/env-file.test.ts sample-key swap — the locked Slice 8 grep spans tests/; plus comment/type edits inside the locked Slice 1 parser fence and the Slice 4 fetch fence, applied in place per the merged-fence rule). Advisor-mediated checkpoint (both decisions escalated per developer choice; the rename + full sweep came back recommended and was confirmed). slice-verifier dispatched (6.2, Agent inventory): Cross-slice OK — locked Slice 1/4 fences edited comment/type-name only, every rename consumer resolves, no dangling reference to any deleted file/symbol/fixture; Decisions VIOLATION found and fixed (src/linkedin-parser.ts:182 still named the deleted timestampFromActivityId symbol — reworded to the guarded id-clock contract, re-gated: tsc 0, biome clean, parser 17/17, full 554/554); Research WARNING = the Files/Scope amendment, applied at this lock.
- Slice 7 micro-checkpoint (2026-11-11T13:28+0700, approved as presented): pure deletion riding the locked Slice 4 seam. Fit recorded: reused nothing new — the LinkedInContextFactory seam (src/linkedin-fetch.ts:225) and the session types it already consumes; new surface none (two type renames, zero new exports); conventions followed: the ENV_NAMES names-only contract (src/config.ts:14), provenance carried by git history + §-refs instead of deleted-file citations. Gates on the fresh scratch materialization .rpiv/tmp/verify7/ (a copy of verify6 + this slice): tsc exit 0, biome clean over 62 files, full suite 554/554 (581 - 27 from the two deleted suites), grep -rni voyager src scripts 0 hits, env/budget greps 0 hits.
- Slice 8: Doc sweep + baseline gates — approved as generated (checkpoint-ratified scope additions beyond the locked Files line: `.rpiv/guidance/architecture.md` joins the sweep — 3 stale hits the Files line missed: the setup-curl tree entry, the transport-gate probe row, the setup-curl command row; and the 10-minute → 28-33-minute cadence fixes in README ×2, AGENTS ×1, root guidance ×1, scripts guidance ×1 — pre-existing drift vs `scripts/watch-linkedin.ts:3`, 28-33-minute jittered sleep confirmed on disk 2026-11-11). 50 exact find/replace edits over seven files, every find-block byte-for-byte from the full session reads.
- **Follow-up 2026-11-11T18:45+0700 (live rehearsal — session model revised):** the first real run of the migrated walk reported 3 posts. Instrumentation (committed separately as `6493f2a`) found the cause: the walk's browser identity. Four configurations measured against the same URL in the same minute — fresh context headless (3 posts, no button), fresh context headed (14 posts, no button), profile headless (14 posts, no button), profile headed (8 posts, BUTTON, 6 posts per click). The Load-more button requires BOTH the persistent profile AND headed mode. Revised: `LinkedInContextFactory` takes the profile path and calls `launchPersistentContext(PROFILE, { headless: false })`; `fetchLinkedInPosts` takes `profileDir` instead of `cookies`; the cookie file degrades to a caller-side preflight. Also revised: the parser's count-mismatch rule now refuses the mint (the prefix rule mis-pairs every post after a gap — reproduced offline, 3 cases). Row-local pairing was proposed and DISPROVED against the real capture (136 rows: 3 with both id and text, 130 ids only, 3 texts only). Slices 3-6 need re-planning against this model.
- Slice 8 micro-checkpoint (2026-11-11T13:49+0700, approved as presented): docs-only terminal slice. Fit recorded: reused nothing new — every replacement word traces to locked decisions (the pairing rule, LOAD_MORE_SELECTOR, the 5-15s navigation gate, the probe exit vocabulary, ENV_NAMES at six, the defb8af zero-post success log); new surface: none; conventions followed: the slice-5/7 checkpoint-ratified scope-addition pattern and the locked Verification-Notes grep-gate wording. Verification note: the in-materialization FIND-uniqueness simulation was blocked by a harness no-op guard before it ran, so the uniqueness check and the three gated greps are encoded as implement-time Success Criteria instead of a verify8 scratch pass.
- Follow-up 2026-11-11T14:31+0700 (verification completion + gate-C catch): the mandated 6.4 byte-check completed via bash line-range extraction (bypassing the read pager that had corrupted every assembly attempt): all 50 fence bodies byte-match the approved payload, 94/94 four-backtick fences balanced (50 find + 44 replace), E-numbering sequential 1-50; the in-memory apply ran with zero uniqueness problems; gates A (deleted env/budget tokens) and B (voyager/setup-curl/curl-impersonate) returned 0 over the simulated docs; gate C caught ONE real miss — the AGENTS.md architecture bullet for watch-linkedin.ts still said "(tick + 600s sleep)" — fixed as E51 (the command bullet was already corrected; the first stale-scan grepped 10-minute patterns, not 600s). E33 grounding verified against the locked Slice 4 fence: ResponseLike doubles with `on: (_event, listener)` + a `fire(response)` helper — the "fake interception events" claim stands as written.

## References

- `.rpiv/artifacts/solutions/2026-11-11_07-17-47_linkedin-browser-walk-migration.md` — the parent solutions analysis (4 follow-up passes, live-verified)
- `.rpiv/artifacts/research/2026-11-10_19-56-45_linkedin-browser-walk-migration.md` — upstream research
- `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md:369-706` — the deleted walk's full source fence (byte-identical to `68c1e2d`)
- `.rpiv/tmp/linkedin-pagination-body.txt` — the live capture (scratch, gitignored)
- `.rpiv/tmp/analyze-pairing.mjs`, `analyze-cocard.mjs`, `analyze-final.mjs`, `analyze-bfs.mjs` — the pairing-evidence scripts
- `.rpiv/tmp/run-parser.mjs` + `parser-src.mjs` — the offline parser proof (2 posts minted, round-trip zero drops)
- `src/linkedin-fetch.ts`, `src/fetch-threads.ts`, `scripts/fetch-linkedin.ts`, `scripts/probe-linkedin.ts` — the files this design rewrites (read fully 2026-11-11 at commit `1cd0f47`)
