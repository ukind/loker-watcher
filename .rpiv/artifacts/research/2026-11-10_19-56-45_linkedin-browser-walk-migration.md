---
date: 2026-11-10T19:56:45+0700
author: Yogiswara Utama
commit: 1cd0f47
branch: ukind/feature-migrate-using-browser-approach
repository: feature-migrate-using-browser-approach
topic: "linkedin-browser-walk-migration"
tags: [research, codebase, linkedin-fetch, linkedin-voyager, linkedin-session, linkedin-payload, linkedin-behavior, fetch-threads, extract, playwright]
status: ready
last_updated: 2026-11-10T19:56:45+0700
last_updated_by: Yogiswara Utama
---

# Research: linkedin-browser-walk-migration

## Research Question

How does the LinkedIn leg migrate from a voyager-endpoint transport to a Playwright browser walk, in place in `src/linkedin-fetch.ts`? The FRD's Recommended Approach: `src/linkedin-fetch.ts` is replaced in place (FR-6) with a browser walk modeled on `fetchSurfacesAuthenticated` (`src/fetch-threads.ts:304`), not `fetchSurfaces`, because LinkedIn requires a session: `ContextFactory` with a storageState path, the `ContextLike`/`PageLike` seam, the `navigator.webdriver` patch (`:73`), dynamic-import quarantine, pure parser exports plus one walk. Extraction captures both routes (FR-2). Wired into `scripts/fetch-linkedin.ts`'s `fetchTick` behind the existing deps injection, with `src/linkedin-voyager.ts`, the curl transport, the `request.newContext` transport, and `LINKEDIN_TRANSPORT` deleted. Pacing constants move from GET-spacing to page-load spacing inside the same module; the payload writer, halt latch, and daily budget ledger are reused as-is.

## Summary

The migration is a diagonal cut through a five-module family. The transport half of `src/linkedin-fetch.ts` and all of `src/linkedin-voyager.ts` die; `src/linkedin-behavior.ts` and `src/linkedin-payload.ts` survive untouched. The tagged-error block (`src/linkedin-fetch.ts:118-193`) and the `runPool` walk skeleton (`:512-627`) survive and are the reason the two PC scripts keep compiling.

The browser seam exists and is copyable, with one real mismatch: `ContextFactory` takes a storageState **path** (`src/fetch-threads.ts:118`) while `toStorageState` returns a storageState **document** (`src/linkedin-session.ts:185`). Playwright accepts either, but the type does not.

The extraction route cannot be verified offline. `src/extract.ts` is Threads-shaped end to end (`data-sjs` container, `thread_items` leaf key, `pk`/`caption.text`/`user.username`/`taken_at` fields, `threads.com` permalink), so `extractPosts(linkedinHtml)` returns `[]` with **zero drops** — a silent failure, the worst mode for a migration. The developer requires a live headed login and a blade-browser inspection before the parser is written.

The results page is an infinite loader. The developer's answer to the pacing question reframes FR-3/FR-8: the walk scrolls, bounded by the existing `scrollRounds` config key (`src/config-file.ts:127-137`, default 8), not by a page-load count.

The hosted side needs zero changes. Traced end to end: `src/index.ts:300` reads the payload, `:302-308` builds `linkedinLeg`, `src/email.ts:139-142` renders the leg line only when `status !== "ok"`.

Seven files import `src/linkedin-fetch.ts`. Three imports break in `scripts/fetch-linkedin.ts`, one in `scripts/probe-linkedin.ts` (which additionally loses its whole voyager dependency and cannot compile). `scripts/watch-linkedin.ts` and `src/index.ts` survive untouched.

Precedent: a LinkedIn browser walk already existed at `68c1e2d:src/fetch-linkedin.ts` and was deleted at `bf6594c`. That deletion left doc residue that took two follow-up commits to clean.

## Detailed Findings

### The in-place replacement contract (`src/linkedin-fetch.ts`)

**Survives verbatim** — the tagged-error block, because the guards' `name` comparisons and the scripts' field reads are the actual contract:

- `LEG_DEAD`/`LegDead`/`legDead`/`isLegDead` (`:118-142`). `reason` is read at `scripts/fetch-linkedin.ts:493-494`, `scripts/watch-linkedin.ts:67-68`, `scripts/probe-linkedin.ts:72-73`.
- `ALL_SURFACES_FAULTED`/`AllSurfacesFaulted`/`allSurfacesFaulted`/`isAllSurfacesFaulted` (`:144-172`). `faulted` is read at `scripts/fetch-linkedin.ts:471-477`.
- `HALT`/`Halt`/`halt`/`isHalt` (`:175-193`). `reason` is read at `scripts/fetch-linkedin.ts:460-466`; `halt` is thrown at `:445`.

Also surviving: `LinkedinSurface` (`:55`, imported by `src/index.ts:58`, `scripts/fetch-linkedin.ts:49`, `scripts/probe-linkedin.ts:19`), `SleepFn` (`:58`, imported by `scripts/watch-linkedin.ts:20`), `LINKEDIN_FETCH_CONCURRENCY` (`:61`), `PACE_MIN_MS`/`PACE_MAX_MS` (`:67`/`:74`, values re-derived), and `fetchLinkedInPosts` (`:512`, name survives, signature and body change).

**Dies** — the transport layer and the voyager fault classifier:

- `VoyagerResponse`/`VoyagerGet`/`Transport` (`:102-116`). `Transport` and `VoyagerGet` are imported by `scripts/fetch-linkedin.ts:50-51` and used at `:97`, `:443`, `:449`, `:455`, `:480` — **three breaking imports**.
- `classifyFault`/`Fault`/`FaultKind` (`:196-285`). Its 3xx/403/401/400 branches are the current `legDead` source; its 429 branch (`:244-247`) is the current `halt` source.
- `ExecFn`/`createCurlTransport` (`:287-389`), `createPlaywrightTransport` (`:391-437`), `resolveLinkedInTransport` (`:439-473`). The resolver is imported by `scripts/fetch-linkedin.ts:57` and `scripts/probe-linkedin.ts:21` — **two more breaking imports**.
- `CURL_IMPERSONATE_PROFILE` (`:91`), `BROWSER_UA` (`:98`), `PAGE_SIZE` (`:64`), `REQUEST_TIMEOUT_MS` (`:77`), `STATUS_SENTINEL` (`:80`).

**The walk skeleton that survives inside `fetchLinkedInPosts`** (`:512-627`): `runPool(order, LINKEDIN_FETCH_CONCURRENCY, ...)` at `:543` with caller-owned side arrays (`:536-537`); the two drain checks at `:548` and `:551`; the halt arm (`:586-593`), leg-dead arm (`:595-601`), fault arm (`:603-605`); the join priority halt > leg-dead > all-faulted (`:612-620`); the stamp-at-slot-write (`:576-580`); the empty-is-success log (`:582-583`); the `linkedin/${surface.value}` label (`:545`).

**One vestigial slot worth naming:** the `cookies: LinkedInCookies` parameter at `:514` is never read in the function body. The transport carries the session today. That parameter sits at exactly the position a browser-walk session seam would occupy.

### The browser seam (`src/fetch-threads.ts`)

Five structural interfaces, all narrower than Playwright's real API:

- `ResponseLike` (`:76-81`) — `url()`, `status()`, `text()`. Exactly what the interception route needs.
- `LocatorLike` (`:83-88`) — `first()`, `waitFor({state:"visible",timeout})`, `click()`. No `count()`, no `getAttribute()`.
- `PageLike` (`:90-104`) — `goto` (with `waitUntil` pinned to `"domcontentloaded"`), `waitForFunction` (page function is a **string**, because the locked tsconfig has no DOM lib), `content()`, `on("response")` (single literal event), `locator`, `evaluate` (string only), `waitForTimeout`, `close`.
- `ContextLike` (`:106-110`) — `newPage()`, `addInitScript()`, `close()`. No `cookies()`, no `storageState()`, no `route()`.
- `ContextFactory` (`:118`) — `(storageStatePath?: string) => Promise<ContextLike>`. The parameter is optional, and that optionality is load-bearing: it keeps zero-arg test doubles assignable.

`makeChromiumContextFactory(headless)` (`:129-177`) is the only Playwright import site in the module (`:131`). It composes `chromium.launch({ headless })` (`:132`) with `browser.newContext({ storageState, userAgent, viewport, locale })` (`:133-138`), where `storageState` rides a conditional spread so an absent path never becomes an explicit `undefined` (`:134`). `addInitScript(WEBDRIVER_PATCH)` runs at `:139`; the patch string is `:73`. The ownership rule is `:170-173`: closing the context closes the browser, so every walk's teardown is `await context.close()` in a `finally` and no caller touches `browser`. The production singleton is `:180` — headless.

**Transferable to LinkedIn:** the four structural types, `ContextFactory` with its optional path, the dynamic-import quarantine, the launch/newContext composition, the webdriver patch, the browser-close-inside-context-close rule, one-context-per-walk built eagerly and closed in `finally` (`:312`, `:355-357`), the `runPool` slot-array reassembly (`:315-317`, `:320`, `:341`), per-surface `try`/`catch` fault isolation (`:321-338`), the response-interception *pattern* (attach before goto, fire-and-forget, Map dedupe, `:372-390`), and `fetchOne`'s retry loop (`:248-273`).

**Threads-specific, must be dropped:** `HAS_THREAD_ITEMS` (`:68-71`, probes for the literal `thread_items` key — would time out on every LinkedIn surface), the Recent-tab locator dance (`:402-425`), `isTagSurface` (`:188-190`), the scroll loop's Threads constants (`:45-58`), `MAX_POSTS_PER_SURFACE` (`:47`), and the `collectThreadItems`/`normalizeThreadItem` reuse (`:381-384`).

**Two seam gaps that matter for FR-7:** `PageLike` exposes no `url()` and no `title()`. A checkpoint or login-wall detector cannot read the post-navigation URL through this seam — it must go through `content()` string matching or an `evaluate(script)` probe. The current leg detects session death by HTTP status (`classifyFault`), and a browser walk has no status to read for the top-level navigation.

**One seam mismatch:** `ContextFactory`'s parameter is a path (`:118`, passed straight to `newContext({storageState: path})` at `:134`). Threads' session is a storageState file (`src/threads-session.ts`). LinkedIn's session is a cookie pair (`src/linkedin-session.ts:97`) that `toStorageState` (`:185`) converts to an in-memory document. Playwright accepts either form; the type says `string`.

### Extraction: `src/extract.ts` versus the LinkedIn row contract

`SCRIPT_BLOB_RE` (`src/extract.ts:14`) is a generic HTML regex requiring the literal `data-sjs` attribute. `extractPosts` (`:36-67`) parses each blob, walks it with `collectThreadItems` (`:70-84`, depth-first, matching **only** the leaf key `"thread_items"`), and normalizes with `normalizeThreadItem` (`:87-110`), which requires `pk`, `caption.text`, `user.username`, and a positive numeric `taken_at`, and emits a `threads.com` permalink (`:106`).

None of the four identity markers matches LinkedIn: the container attribute, the leaf key, the field names, and the permalink host. `extractPosts(linkedinHtml)` therefore returns `[]` with **zero drops** — no warning, no error, just an empty payload.

The LinkedIn row contract is `isValidRow` (`src/linkedin-payload.ts:88-109`): `platform === "linkedin"` (`:91`), `id` matching `ACTIVITY_URN_RE` = `/^urn:li:activity:\d{9,}$/` (`:65`, `:92-94`), non-empty `text`/`author`/`permalink` (`:95-103`), a `Date.parse`-able `timestamp` (`:104-106`), and `surfaces` absent or a well-formed `Surface[]` (`:107`, `:83-86`, `:68-81`).

The deleted `parseSearchResponse` (`src/linkedin-voyager.ts:161-180`) produced exactly that shape via `readPostRows` (`:182-201`, walking `data.searchDashClustersByAll.elements[].items[].item.searchFeedUpdate.update`) and `mapUpdate` (`:203-225`, reading `metadata.backendUrn`, `commentary.text.text`, `actor.name.text`, `socialContent.shareUrl`, and deriving the timestamp with `timestampFromActivityId` at `:114-126`, `BigInt(id) >> 22n`).

**A tension worth recording:** FR-6 deletes `src/linkedin-voyager.ts` outright, but `readPostRows` and `mapUpdate` are pure row walkers — no endpoint, no transport, no I/O. The module header (`:1-10`) states "No I/O lives here". The endpoint constants (`:18`, `:27`, `:30`) and the URL builder (`:88-99`) are the parts that reach the network.

**The interception route's shape** is `src/fetch-threads.ts:372-390`: attach before `goto`, fire-and-forget (`:375`), three guards (size cap `:373`, URL+status filter `:374`, body substring `:378`), Map dedupe by `post.id` (`:384`), and a settle window before the page closes (`:448-449`). For LinkedIn the URL filter becomes the voyager path, the body substring becomes `searchDashClustersByAll`, and the body walker must be LinkedIn-shaped.

### Session (`src/linkedin-session.ts`, `scripts/login-linkedin.ts`)

`resolveLinkedInCookies` (`:97-142`) has nine rejection sites, every one naming `ENV_NAMES.linkedinCookiesFile` (`src/config.ts:16`): unset/blank (`:103-107`), ENOENT (`:112-117`), unreadable (`:118-119`), invalid JSON (`:123-126`), non-object (`:127-129`), missing/blank `liAt` (`:74-89`), quoted `liAt` (`:84-85`), missing/blank `jsessionid` (`:57-72`), stray quotes in `jsessionid` (`:63-65`). The `harvestedAt` read is deliberately tolerant (`:134-141`): present and non-empty rides through trimmed, anything else leaves the key absent. Enforcement is the `fetchTick` gate's job, never the resolver's.

`toStorageState` (`:185-199`) emits two cookies at `domain: ".linkedin.com"`, `path: "/"`, `secure: true`, with `JSESSIONID` **re-quoted** (`:191`) — the inverse of the resolve-time strip. `origins` is always `[]`. The cookie shape is deliberately minimal (`VoyagerStorageCookie`, `:159-166`); Playwright's wire fields (`expires`, `httpOnly`, `sameSite`) are completed at the consumer, which today is `src/linkedin-fetch.ts:399-405` — a site FR-6 deletes.

`buildCookieHeader` (`:149-151`) and `csrfToken` (`:154-156`) have exactly two consumers, both inside the deleted transports (`src/linkedin-fetch.ts:328-329`, `:410`). A real browser navigation does not accept a manually-set `csrf-token` header; the page's own JS mints it from the `JSESSIONID` cookie. Both die.

**Survival matrix against the three candidate strategies:**

| Strategy | `resolveLinkedInCookies` | `toStorageState` | `buildCookieHeader`/`csrfToken` | `harvestedAt` gate |
|---|---|---|---|---|
| Headed cookie harvest | survives | **survives** — the file→storageState bridge | die | survives unchanged |
| Headed browser per tick | survives only if seeded from the cookie file | survives iff seeded via `newContext({storageState})` | die | survives iff the resolver still runs |
| Persistent profile | leaves the fetcher's path | **dies** — `launchPersistentContext` needs no storageState | die | **dies** — no `cookies.harvestedAt` to read |

The developer's checkpoint answer picks the first: the login phase is headed only, and the walk consumes the harvested session. That keeps `resolveLinkedInCookies`, `toStorageState`, and the `harvestedAt` gate (`scripts/fetch-linkedin.ts:432-436`) coherent and unchanged.

`scripts/login-linkedin.ts` already implements the headed harvest: `runLoginHelper` (`:147-196`), `openDefaultContext` with `launchPersistentContext(profileDir, { headless: false, viewport: null })` (`:125-141`), `DEFAULT_PROFILE_DIR` (`:34`), `DEFAULT_COOKIE_PATH` (`:31`), the poll loop (`:167-183`), `writeCookieFile` (`:78-103`) with the stamp from the injected clock (`:179`), and `upsertDotEnvLine` (`:181-185`).

### Halt latch and daily budget

Three repo-local state files, all siblings of the payload: `DEFAULT_MARKER` = `state/linkedin-leg-dead.flag` (`scripts/fetch-linkedin.ts:135`), `DEFAULT_LATCH` = `state/linkedin-halt.flag` (`:142`), `DEFAULT_BUDGET` = `state/linkedin-get-budget.json` (`:149`). `tripLatch` (`:217-223`) is first-write-wins and writes the reason as the file content. Nothing auto-clears the latch; `scripts/reset-linkedin.ts` is the only remover.

The pure machine is `src/linkedin-behavior.ts`: `DAILY_GET_BUDGET = 150` (`:82`), `DailyBudgetState` (`:89-95`), `freshBudget` (`:97-99`), `localDateKey` (`:106-111`), `budgetAllows` (`:118-125`), `budgetReserve` (`:134-137`), `HALT_RATE_LIMIT_REASON` (`:144-145`), `HALT_BUDGET_REASON` (`:151-152`). `budgetAllows`/`budgetReserve` are integer-count functions and are unit-agnostic.

The wrapper today (`scripts/fetch-linkedin.ts:442-450`) rides the `VoyagerGet` seam: `budgetAllows` check, `budgetReserve`, `writeBudgetAtomic` **before** the call, then `transport.get(url)`. It is a bare function, so the walk's `ownsTransport = typeof transport !== "function"` check (`src/linkedin-fetch.ts:520-521`) classifies it as caller-owned and never disposes it. `dayKey` is computed once at `:412` from the tick's start clock.

There are **two** budget gates with different outcomes: the preflight gate (`:413-420`) returns quiet zeros when the day is already spent (no latch, no alarm — the normal end of a day); the mid-walk wrapper (`:444-446`) throws `halt(HALT_BUDGET_REASON)` when the budget runs out during the walk (latch + alarm).

**The `Halt` channel is generic over `reason`.** `tripLatch` writes `error.reason` verbatim (`:217-223`), `defaultHaltAlarm` sends the same string (`:293-309`), and no reason-specific branching exists anywhere in the latch path. A checkpoint detector that throws `halt(checkpointReason)` inside the walk worker therefore rides the exact same route as the budget wrapper: worker `isHalt` catch (`src/linkedin-fetch.ts:586-593`) → drain checks (`:549`, `:551`) → join throw (`:614-616`) → `fetchTick` `isHalt` catch (`scripts/fetch-linkedin.ts:460-464`) → `tripLatch` + `haltAlarm` + quiet zeros.

**What is being deleted is the only current halt producer besides the budget.** `classifyFault`'s 429 branch (`src/linkedin-fetch.ts:245-247`) is the sole `halt` source in the walk. Its closest rendered-challenge detector is the 403 branch's regex `/Just a moment|challenge|cf-ray/i` (`:249`), but that branch returns `legDead` (`:250-255`) — the self-healing episode channel, not the latch. So the checkpoint detector is a **new classification site**, not a reuse.

**Failure-mode distinction that must survive:** a plain `Error` from the detector lands in the walk's fault arm (`:603-605`), increments `faultedCount`, and can let the tick complete with partial posts — the exact failure the `isHalt` arm was added to prevent. A `legDead` routes to the episode marker and the loop's `onLegDead` (`scripts/watch-linkedin.ts:67-68`), which self-heals on a cookie refresh — wrong for a checkpoint. Only `halt` reaches the latch.

**Reason vocabulary:** `HALT_RATE_LIMIT_REASON` is 429-specific and `HALT_BUDGET_REASON` is budget-specific; neither fits a checkpoint. A new canonical constant belongs beside them in `src/linkedin-behavior.ts`, whose stated role (`:1-5`) is "the halt-latch reason vocabulary".

### Tick wiring and preflight ordering

`FetchTickDeps` (`scripts/fetch-linkedin.ts:91-133`) carries `config`, `cookies`, `transport?: Transport` (`:96-97`), `payloadPath`, `git`, `env`, `alarm`, `markerPath`, `now`, `latchPath`, `budgetPath`, `rng`, `haltAlarm`, `bypassWindow`.

`fetchTick` (`:382-489`) runs, in order: no-linkedin early return (`:389-392`) → window gate (`:400-405`) → latch check (`:406-411`) → `dayKey` + budget read + budget check (`:412-420`) → `guardCheckout` (`:424`) → `resolveLinkedInCookies` (`:425`) → `harvestedAt` stamp gate (`:432-436`) → transport (`:437`) → budget wrapper (`:442-450`) → `fetchLinkedInPosts` (`:455`) → halt arm (`:460-467`) → all-faulted arm (`:471-477`) → `finally` dispose (`:478-481`) → `writePayloadAtomic` (`:483`) → `pushPayload` (`:485`) → `clearEpisodeMarker` (`:486`).

The preflight band is the zero-cost guarantee: window → latch → budget run before `guardCheckout`, cookies, the stamp gate, and the transport. A latched or budget-spent tick costs zero git spawns, zero cookie reads, and zero browser launches.

**Which dep key replaces `transport`:** the Threads precedent is a **factory**, not an opened object. `fetchSurfacesAuthenticated(surfaces, storageStatePath, contextFactory = chromiumContextFactory, options)` (`src/fetch-threads.ts:304-309`) opens the context itself (`:312`) and closes it in its own `finally` (`:356`). The tick's `transport` dep is an opened object with caller-owned disposal. So the replacement is a `contextFactory` dep (the FR-10 seam) plus a session source — either the existing `cookies` dep (which already feeds the stamp gate at `:432`) or a `storageStatePath` resolved from it. The budget wrapper's page-load seam is a **separate** key: it needs a per-load function, not a context factory.

**Where the context opens and closes:** the current `finally` at `:478-481` runs on every path — the halt quiet-zeros return (`:464`), the all-faulted return (`:476`), the leg-dead rethrow (`:477`), and the success fall-through. The browser context's close must occupy the same position: after the walk, before `writePayloadAtomic` (`:483`), on every path. If the walk opens the context (Threads shape), the walk's own `finally` closes it and the tick's `finally` loses its disposal duty — but the close must already have happened before the halt/all-faulted errors propagate.

**`runLoop` is transport-agnostic.** `scripts/watch-linkedin.ts:48-83` sees only `fetchTick`'s resolved/rejected promise: a halt is swallowed inside `fetchTick` and resolves quiet zeros, a leg-dead re-throws and the loop's `isLegDead` arm (`:67-68`) routes it to `handleLegDeadEpisode`, any other fault warns (`:70-71`). The migration changes none of these contracts. The only effects are timing (a browser tick is slower; the sleep is still `sampleTickDelayMs` at `:74`) and default resolution (`fetchTick({ env })` at `:50` passes no factory, so the default must resolve the session from env inside `fetchTick`).

### Deletion blast radius

**Whole files:** `src/linkedin-voyager.ts` (223 lines), `scripts/setup-curl-impersonate.ts` (215 lines), `tests/linkedin-voyager.test.ts`, `tests/setup-curl-impersonate.test.ts`, `tests/fixture/voyager-search-response.json` (read only by `tests/linkedin-voyager.test.ts`).

**`src/config.ts:17-18`:** `linkedinTransport` and `curlImpersonateBin` become dead. `linkedinCookiesFile` (`:16`) survives.

**`scripts/probe-linkedin.ts`:** cannot compile. It imports `resolveLinkedInTransport` (`:21`) and `{ buildSearchUrl, parseSearchResponse }` from the deleted voyager module (`:24`), reads `ENV_NAMES.linkedinTransport` (`:42`), and drives `transport.get(buildSearchUrl(...))` (`:49`). The FRD lists it as "needs a browser-walk equivalent or removal".

**`scripts/reset-linkedin.ts`:** imports `DEFAULT_BUDGET`/`DEFAULT_LATCH` from `scripts/fetch-linkedin.ts` and `DEFAULT_COOKIE_PATH`/`DEFAULT_PROFILE_DIR` from `scripts/login-linkedin.ts`. All four survive under the cookie-harvest strategy.

**`package.json`:** `setup-curl` (`:20`) dies; the lint (`:13`) and format (`:14`) globs lose `scripts/setup-curl-impersonate.ts`; `probe-linkedin` (`:17`) survives only if the probe is rewritten.

**`.gitignore`:** the `tools/` entry exists only for the curl-impersonate install target.

**Tests:** `tests/linkedin-fetch.test.ts` loses the `classifyFault`, `createCurlTransport`, and `resolveLinkedInTransport` describes plus six imports; `tests/fetch-linkedin.test.ts` loses the `Transport` import, the `transportFor` helper, the resolver-default test, and every `transport:` injection; `tests/linkedin-session.test.ts` loses the `buildCookieHeader`, `csrfToken`, and `toStorageState` describes (the last only if the strategy changes); `tests/env-file.test.ts` carries `CURL_IMPERSONATE_BIN` as a parser fixture string only.

**Docs:** `README.md` (the "The LinkedIn leg on your PC (voyager)" section at `:278`, plus `:7`, `:22`, `:136`, `:151`, `:280-285`, `:309-318`, `:323`, `:331`, `:355`), `AGENTS.md` (`:12-14`, `:34-36`, `:49-54`, `:66-69`, `:73`, `:74-78`, `:89-91`, `:96-101`), `.rpiv/guidance/architecture.md` (`:15`, `:41`, `:43`), `.rpiv/guidance/src/architecture.md` (`:7`, `:19`, `:21`, `:103-131`), `.rpiv/guidance/scripts/architecture.md` (`:9`, `:31-32`, `:37`, `:44-47`, `:89`), `.rpiv/guidance/tests/architecture.md` (`:8`, `:17-20`, `:25`, `:138`), `.rpiv/guidance/.github/workflows/architecture.md` (`:7`).

**No change needed:** `tsconfig.json` (directory-level include), `biome.json` (no per-file globs), `.github/workflows/watch.yml` (references only the payload path).

### Payload contract — confirmed untouched

`PAYLOAD_VERSION = 2` (`src/linkedin-payload.ts:30`), `PAYLOAD_MAX_AGE_MS = 2_400_000` (`:37`, 40 minutes), `PayloadEnvelope` (`:40-44`), `LegStatus` (`:47`), `PayloadRead` (`:57-63`). `writePayloadAtomic` (`:111-141`) writes a sibling temp via `stateTempPath` then renames (`:122-126`), with best-effort temp cleanup and an error naming the path (`:128-136`). `readPayloadPosts` (`:143-216`) never throws: ENOENT → `absent` (`:150-158`), other read error → `malformed` (`:159-162`), invalid JSON → `malformed` (`:164-171`), non-object → `malformed` (`:172-176`), wrong version → `malformed` (`:178-182`), stale → `stale` (`:184-192`), non-array posts → `malformed` (`:194-198`), bad rows → drop + count with leg `ok` (`:200-215`).

The hosted chain: `src/config.ts:61` `LINKEDIN_PAYLOAD_PATH`, `src/index.ts:58-59` imports, `:182` the `linkedinFetch` dep type, `:246` the default, `:300` the read, `:302-308` the `linkedinLeg` build, `:377` the `HeartbeatStats` rider, `:533-539` the digest call. `src/email.ts:139-142` renders the leg line only when `status !== "ok"`.

**The zero-hosted-change claim holds.** Nothing on the hosted side reads how the payload was produced. The only coupling is the row shape `isValidRow` enforces and the envelope's `version` + `writtenAt`. Both are writer-side obligations.

**What the browser walk's `Post[]` must satisfy:** `platform: "linkedin"`; `id` = the full URN string `urn:li:activity:<digits>` (not the bare digits — the regex anchors on the prefix); non-empty `text`, `author`, `permalink`; a `Date.parse`-able `timestamp` that is the **real** post time, because `src/recency.ts` drops anything older than the window; and `surfaces` absent or well-formed.

**Do the three named fields survive a page-JSON route?** The activity URN survives *if* the page JSON carries it — LinkedIn's page JSON keys entities by `entityUrn`/`backendUrn`, the same field `mapUpdate` reads. It does **not** survive a pure visible-text route: the URN lives in link hrefs, and `PageLike` has no `getAttribute`. The derived timestamp survives by construction — `timestampFromActivityId` is a pure function of the id and needs no page data. The `surfaces` stamp survives trivially because it is walker-owned, stamped at the slot write (`src/linkedin-fetch.ts:576-580`, the same three lines as `src/fetch-threads.ts:326-329`); the only way to lose it is to forget the stamp, which still passes admission but orphans the row at notify time.

### Offline test seam

`fakeContextFactory` (`tests/fetch-threads.test.ts:88-183`) is the structural double: it records `sessionPaths` (`:93`, `:110`), tracks `concurrency.peak` across `newPage`/`close` (`:89`, `:113-114`, `:168-172`), fires scripted `ResponseLike` bodies through `xhrBySubstring` (`:91`, `:125-128`), stubs `locator` (`:137-156`), `evaluate` (`:157-163`), and `waitForTimeout` (`:164-167`), and sets `closed` on context close (`:94`, `:177-179`). It is **local, not exported** — the codebase's convention is per-suite doubles.

The LinkedIn double reuses that shape but cannot reuse that instance, for five concrete reasons: `content()` returns a fixed Threads string (`:132`); `graphqlResponse` hardcodes the Threads graphql URL (`:68-72`); `xhrBySubstring` is keyed by the surface label, which for Threads happens to be a URL substring (`:22-28`) but for LinkedIn (`linkedin/<keyword>`) never occurs in the search URL; `goto` never records its URL (`:121-129`); and no response URL is recorded (`:116-119`).

The LinkedIn double needs: `gotos: string[]` (exactly five navigations, none to `/voyager/api/`), `responseUrls: string[]` (no intercepted response from the endpoint), `contentBySubstring` keyed by the search URL, `sessionPaths`, `closed`, `concurrency`, `contentCalls`, and an attach-order log proving `on("response")` ran before `goto`. The `urls: string[]` recorder precedent already exists in `tests/index.test.ts`.

The current LinkedIn doubles are `transportFor` (`tests/fetch-linkedin.test.ts:130-145`, `{get, dispose}` with `gets`/`disposeCount` counters, URL ignored) and `scriptGet` (`tests/linkedin-fetch.test.ts:106-121`, records every GET URL and dispatches by matcher). Both die with the transport.

## Code References

- `src/linkedin-fetch.ts:118-193` — the three tagged-error blocks that survive verbatim
- `src/linkedin-fetch.ts:102-116` — `VoyagerResponse`/`VoyagerGet`/`Transport`, the deleted seam
- `src/linkedin-fetch.ts:196-285` — `classifyFault`, the deleted fault classifier (429 → halt, 3xx/401/403/400 → legDead)
- `src/linkedin-fetch.ts:287-473` — `ExecFn`, `createCurlTransport`, `createPlaywrightTransport`, `resolveLinkedInTransport`
- `src/linkedin-fetch.ts:475-493` — `makePacingGate`, the per-walk reserve-before-sleep closure
- `src/linkedin-fetch.ts:512-627` — `fetchLinkedInPosts`, the walk skeleton that survives
- `src/linkedin-fetch.ts:514` — the unused `cookies` parameter, the natural session-seam slot
- `src/fetch-threads.ts:76-118` — `ResponseLike`, `LocatorLike`, `PageLike`, `ContextLike`, `ContextFactory`
- `src/fetch-threads.ts:129-177` — `makeChromiumContextFactory`, the only Playwright import site
- `src/fetch-threads.ts:304-358` — `fetchSurfacesAuthenticated`, the walk to model
- `src/fetch-threads.ts:361-459` — `fetchOneAuthenticated`, the per-surface body (interception, tab dance, scroll loop)
- `src/extract.ts:14` — `SCRIPT_BLOB_RE`, the `data-sjs` container regex
- `src/extract.ts:70-110` — `collectThreadItems` + `normalizeThreadItem`, the Threads-shaped walker
- `src/linkedin-payload.ts:65-109` — `ACTIVITY_URN_RE` + `isValidRow`, the row contract
- `src/linkedin-payload.ts:111-216` — `writePayloadAtomic` + `readPayloadPosts`
- `src/linkedin-session.ts:97-142` — `resolveLinkedInCookies`, the nine-site reject matrix
- `src/linkedin-session.ts:185-199` — `toStorageState`, the cookie-pair → storageState bridge
- `src/linkedin-behavior.ts:82-152` — the budget machine and the halt reason vocabulary
- `src/linkedin-voyager.ts:182-225` — `readPostRows` + `mapUpdate`, the pure row walker FR-6 deletes
- `src/linkedin-voyager.ts:114-126` — `timestampFromActivityId`, `BigInt(id) >> 22n`
- `scripts/fetch-linkedin.ts:91-133` — `FetchTickDeps`
- `scripts/fetch-linkedin.ts:382-489` — `fetchTick`, the preflight ordering
- `scripts/fetch-linkedin.ts:442-450` — the budget wrapper on the `VoyagerGet` seam
- `scripts/fetch-linkedin.ts:460-481` — the halt arm, the all-faulted arm, the dispose finally
- `scripts/login-linkedin.ts:125-196` — the headed harvest
- `scripts/watch-linkedin.ts:48-83` — `runLoop`, transport-agnostic
- `src/config-file.ts:74-82`, `:210-214` — the exactly-five linkedin surface invariant
- `src/config-file.ts:127-137` — `readScrollRounds`, the scroll bound the walk reuses
- `src/config-file.ts:340-355` — `resolveSurfaces` throws on a linkedin surface
- `src/pool.ts:33-52` — `runPool`, returns void, results ride caller-owned slot arrays
- `src/index.ts:300-308` — the hosted payload read and `linkedinLeg` build
- `src/email.ts:139-142` — the leg line renders only when `status !== "ok"`

## Integration Points

### Inbound References

- `scripts/fetch-linkedin.ts:49-58` — imports `LinkedinSurface`, `Transport`, `VoyagerGet`, `fetchLinkedInPosts`, `halt`, `isAllSurfacesFaulted`, `isHalt`, `isLegDead`, `resolveLinkedInTransport`. Three break.
- `scripts/watch-linkedin.ts:20` — imports `SleepFn`, `isLegDead`. Both survive.
- `scripts/probe-linkedin.ts:19-24` — imports `LinkedinSurface`, `isLegDead`, `resolveLinkedInTransport`, and `{buildSearchUrl, parseSearchResponse}` from the deleted voyager module. Cannot compile.
- `src/index.ts:58` — type-only `LinkedinSurface`. Survives.
- `tests/fetch-linkedin.test.ts`, `tests/linkedin-fetch.test.ts`, `tests/watch-linkedin.test.ts` — the doubles and describes enumerated above.
- `scripts/reset-linkedin.ts` — imports `DEFAULT_BUDGET`/`DEFAULT_LATCH` from `scripts/fetch-linkedin.ts` and `DEFAULT_COOKIE_PATH`/`DEFAULT_PROFILE_DIR` from `scripts/login-linkedin.ts`. All four survive under the cookie-harvest strategy.

### Outbound Dependencies

- `playwright` — three dynamic-import quarantine sites today: `src/fetch-threads.ts:131`, `src/linkedin-fetch.ts:393`, `scripts/login-linkedin.ts:126`. FR-6 drops the middle one; the browser walk adds its own.
- `src/pool.ts` — `runPool`, zero imports, returns void.
- `src/state.ts` — `stateTempPath`, the sibling-temp idiom every atomic writer uses.
- `src/config.ts` — `ENV_NAMES` (`:14-23`), `LINKEDIN_PAYLOAD_PATH` (`:61`).
- `src/email.ts` — `sendLegDeadAlarm`, `sendHaltAlarm`, `resolveEmailConfig` (imported at `scripts/fetch-linkedin.ts:36`).
- `src/env-file.ts` — `envWithDotEnv`, `upsertDotEnvLine`.

### Infrastructure Wiring

- `package.json:13-14` — the explicit lint/format file lists (scripts are enumerated, not globbed).
- `package.json:17`, `:20` — the `probe-linkedin` and `setup-curl` scripts.
- `watcher.config.json:99-117` — the five linkedin surfaces: `hiring indonesia`, `hiring jakarta`, `hiring developer indonesia`, `hiring engineer jakarta`, `react indonesia`.
- `watcher.config.json` has no `scrollRounds` key today, so the walk reads the default 8 from `src/config-file.ts:120`.
- `.github/workflows/watch.yml` — references only the payload path; no transport reference, no change needed.
- `.gitignore` — the `tools/` entry exists only for the curl-impersonate install target.

## Architecture Insights

- **`runPool` returns void, so results ride caller-owned slot arrays.** `src/pool.ts:33-52` states the contract: "Results reassemble by SLOT INDEX, not by runPool's return". All three walks instantiate the identical pattern (`src/fetch-threads.ts:215-216`, `:315-317`, `src/linkedin-fetch.ts:536-537`). The migration does not change it.
- **The stamp-at-slot-write idiom is duplicated verbatim in both fetchers.** `src/fetch-threads.ts:326-329` and `src/linkedin-fetch.ts:576-580` are the same three lines. That is the mechanism that makes `surfaces` survive any extraction-route change.
- **Tagged errors are name constant + factory + type guard.** `src/linkedin-fetch.ts:116-192` is the idiom; the guard compares the `name` string, so the block is a wire contract, not an implementation detail.
- **Dynamic-import quarantine keeps the offline suite Playwright-free.** Every Playwright import is inside a function body, never at module scope.
- **Two session models coexist on purpose.** `src/linkedin-session.ts:8-11` states the contrast: the LinkedIn leg has no reason to exist without a session, so it throws; `src/threads-session.ts` returns null and warns. The FR-0 gate depends on the fail-visible model.
- **One writer per state file.** The payload, the latch, the budget ledger, and the episode marker are all repo-local siblings of `state/linkedin-posts.json`, all written atomically via `stateTempPath` + rename, all untracked.
- **The pacing gate is a per-walk closure, not module state.** `src/linkedin-fetch.ts:470-473` states the reason: two ticks must not inherit each other's stamp.
- **The preflight band is the zero-cost guarantee.** Window → latch → budget run before any git spawn, cookie read, or browser launch.
- **The `Halt` channel is generic over `reason`.** No reason-specific branching exists in the latch path, so a new halt producer needs only a new canonical reason constant.

## Precedents & Lessons

5 similar past changes analyzed.

### Precedent: LinkedIn Playwright browser walk — the original, deleted
**Commit(s)**: `68c1e2d` — "feat: linkedin second surface with configurable scroll rounds" (2026-10-31)
**Blast radius**: 27 files across 6 layers
  src/ — new `src/fetch-linkedin.ts` (338 lines: React Flight row parser, wheel-driven pagination, urn minting), `src/fetch-threads.ts`, `src/config-file.ts`, `src/index.ts`, `src/extract.ts`, `src/types.ts`
  scripts/ — `scripts/probe-judge.ts`
  tests/ — 10 suites, incl. new `tests/fetch-linkedin.test.ts`
  config/workflow/docs — `watcher.config.json`, `watch.yml`, README

**Follow-up fixes**:
- `defb8af` — "fix: treat an empty linkedin search window as zero results" (2026-11-01) — a zero-result window fires no search-data response; the walk's first-response throw mislabeled the empty window as a dead session. Fix: page still on `/search/results/content` → return `[]` + log "OK — 0 post(s)".

**Lessons from docs**:
- `.rpiv/artifacts/solutions/2026-10-31_10-32-31_linkedin-second-surface-dispatch.md` — the walk was network-only (flagship-web interception), wheel-driven in a nested frame (`window.scrollTo` is a no-op), member names absent from response bodies, timestamps from `BigInt(id) >> 22n`.
- `.rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md` — first real runs 2026-11-01: 75 LinkedIn posts live across two surfaces in one run.

**Takeaway**: the extraction parser and wheel-pagination mechanics already exist in git history at `68c1e2d:src/fetch-linkedin.ts` — recover them instead of rebuilding; expect a live-retune commit after first real runs.

### Precedent: browser walk deleted in one commit
**Commit(s)**: `bf6594c` — "refactor: rewire threads fetcher seams and delete the linkedin-login fallback" (2026-11-03)
**Blast radius**: 13 files, 239 insertions / 2421 deletions
  src/ — deleted `src/fetch-linkedin.ts` (346), `src/linkedin-login.ts` (315); rewired `src/fetch-threads.ts`, `src/index.ts`, `src/config-file.ts`, `src/threads-session.ts`
  scripts/ — deleted `scripts/linkedin-login.ts`
  tests/ — deleted 4 suites, rewired `tests/index.test.ts`

**Follow-up fixes**:
- `ed13452` — "docs: sync readme, agents, guidance, and audit for the sdk cutover" (2026-11-03) — residue sweep after the deletion.
- `5974ac4` — "docs: sync readme, agents, and guidance for the local linkedin leg" (2026-11-05) — more doc residue.

**Lessons from docs**:
- `.rpiv/artifacts/designs/2026-11-01_21-35-44_linkedin-sdk-post-search-cutover.md` — "one-commit deletion+rewire is the proven pattern; empty-results-are-success shipped as a fix within 12h last time; docs drift never self-heals; expect one declared retune commit after first live runs."
- `.rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md` Phase 6 — sweep `.gitignore`, env keys, and gate-invisible wording in the same commit.

**Takeaway**: delete + rewire in ONE commit, and sweep docs/`.gitignore`/env/wording in that same commit — `bf6594c`'s residue took two follow-up doc commits to clean.

### Precedent: voyager transport creation — the leg being replaced
**Commit(s)**: `a8752bf` — "feat: run the linkedin leg on the local pc (voyager transport, payload push, login helper)" (2026-11-05)
**Blast radius**: 33 files, 4004 insertions / 797 deletions
  src/ — new `src/linkedin-fetch.ts`, `src/linkedin-voyager.ts`, `src/linkedin-session.ts`, `src/linkedin-payload.ts`, `src/env-file.ts`; deleted `src/fetch-linkedin-api.ts`
  scripts/ — new `scripts/fetch-linkedin.ts`, `scripts/login-linkedin.ts`, `scripts/probe-linkedin.ts`, `scripts/watch-linkedin.ts`
  tests/ — 9 suites, deleted `tests/fetch-linkedin-api.test.ts`

**Follow-up fixes**:
- `5573fa6` — "feat: one-command curl-impersonate setup with the pinned lexiforest chrome116 profile" (2026-11-05) — the curl transport needed a Windows binary.
- `625b15e` — "feat: fail the linkedin fetch tick on a mis-homed checkout before any fetch" (2026-11-05) — the first live tick failed on a mis-homed checkout with a misdiagnosed rebase message.
- `7558747` — "Add LinkedIn humanlike fetch behavior" (2026-11-10) — the account was restricted.
- `34e91b9` — "Sanitize curl exec failure messages" (2026-11-10) — a live probe leaked the whole cookie jar to the console.

**Lessons from docs**:
- `.rpiv/artifacts/validation/2026-11-05_10-01-36_linkedin-local-leg.md` — verdict FAIL: "a dead session does not surface as leg-dead — the tick pushes an empty payload instead of alarming." Blockers b1 (no 3xx branch) and b2 (the tick publishes the empty payload of a fully-faulted walk over the last good one).
- `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` D7 — the fix: 3xx → leg-dead, `AllSurfacesFaulted` → quiet zeros without touching payload/git/marker.

**Takeaway**: a dead session must halt (not degrade to zero posts), and the tick must never publish an empty payload over the last good one.

### Precedent: humanlike behavior layer — the change that failed to prevent the restriction
**Commit(s)**: `7558747` — "Add LinkedIn humanlike fetch behavior" (2026-11-10)
**Blast radius**: 23 files, 1969 insertions / 235 deletions
  src/ — new `src/linkedin-behavior.ts`, `src/linkedin-fetch.ts`, `src/linkedin-session.ts`, `src/linkedin-payload.ts`, `src/email.ts`, `src/config-file.ts`
  scripts/ — `scripts/fetch-linkedin.ts`, `scripts/watch-linkedin.ts`, `scripts/login-linkedin.ts`, new `scripts/reset-linkedin.ts`
  tests/ — 8 suites, new `tests/linkedin-behavior.test.ts`, `tests/watch-linkedin.test.ts`, `tests/reset-linkedin.test.ts`

**Follow-up fixes**:
- `34e91b9` — "Sanitize curl exec failure messages" (2026-11-10) — Node's `execFile` error message embeds the entire command line, cookie + csrf headers included; a live probe printed the whole jar to the console.
- `0ecbd63` — plan revision + validation addendum recording the leak.
- `813f835` — plan revision dropping the reconciliation directive after the operator reverted the surface swap.

**Lessons from docs**:
- `.rpiv/artifacts/plans/2026-11-10_09-40-06_linkedin-humanlike-fetch-behavior.md` Follow-up (2026-11-10 15:38) — the leak; the operator had to re-harvest the cookie jar because the leaked `li_at` transited a chat transcript.
- `.rpiv/artifacts/validation/2026-11-10_16-10-20_linkedin-humanlike-fetch-behavior.md` — doc drift (README:358, AGENTS.md:42, `.rpiv/guidance/src/architecture.md:126` stale); `reset-linkedin.ts` has no profile-dir override and deleted the operator's real browser profile.

**Takeaway**: a green 570-test suite did not catch a credential leak or a stale doc — plan a live rehearsal and a doc pass; and if the browser walk uses a persistent profile, give reset/drill commands an override.

### Precedent: authenticated Threads browser walk — the model to copy
**Commit(s)**: `9e1c8ef` — "feat: authenticated threads fetch with recency cutoff" (2026-10-25)
**Blast radius**: 12 files, 501 insertions / 34 deletions
  src/ — new `src/fetch-threads.ts`, `src/threads-session.ts`, `src/recency.ts`, `src/extract.ts`, `src/index.ts`, `src/config.ts`
  tests/ — 4 suites, fixture `tests/fixture/graphql-response.json`

**Follow-up fixes**:
- `bf6594c` — rewired the fetcher seams (deleted the login fallback).
- `f571904` / `2b74c61` — added the credential-login fallback.
- `8f2debd` — unexported `PageMouseLike`.
- `68c1e2d` — added `scrollRounds` config.

**Takeaway**: copy the `fetchSurfacesAuthenticated` seam, not `fetchSurfaces`; the Threads precedent does not include response interception in the logged-out path, so the capture-both parser is new code.

### Composite Lessons
- **The browser walk already existed — recover it from git history.** `68c1e2d:src/fetch-linkedin.ts` has the React Flight parser, wheel pagination, urn minting, and the empty-window fix (`defb8af`). The planned change is closer to a restoration than a greenfield build.
- **A dead session must halt, not degrade to zero posts.** The local leg's b1/b2 bug: a dead session presented as a skippable surface fault, and the tick pushed an empty payload over the last good one. The checkpoint/login-wall detector must halt and must not clobber the payload.
- **Zero posts is not a fault.** `defb8af`/`216a617`: a zero-result window fires no search-data response; a page still on the search path is an empty result. FR-7 already says this — the precedent confirms it is a real bug class.
- **Deletion leaves residue.** `bf6594c` left docs, `.gitignore`, env keys, and wording that took two follow-up doc commits to clean. Sweep README:278, `.rpiv/guidance/src/architecture.md`, `.gitignore`, `.env` lines, and package.json scripts in the same commit.
- **Error paths leak credentials.** `34e91b9`: Node's `execFile` error message embeds the entire command line including cookie headers. The browser walk's error paths must not forward raw error messages that could carry storageState or cookies.
- **Doc drift never self-heals.** The humanlike validation found README:358, AGENTS.md:42, and `.rpiv/guidance/src/architecture.md:126` stale. The planned change will stale the same docs again.
- **Live rehearsal catches what offline tests miss.** 333/333 green still shipped a dead-session bug; 570/570 green still shipped a credential leak.
- **Tuning constants are placeholders until live runs.** The old browser walk's constants were explicitly "PLACEHOLDERS pending the live retune". Expect a retune commit.
- **The payload reader is strict on version.** `readPayloadPosts` accepts only v2 (`src/linkedin-payload.ts:178-182`). The browser walk must write v2 exactly.
- **Reset/drill commands can destroy operator state.** `reset-linkedin.ts` deleted the real browser profile because it had no override.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-11-10_19-36-43_linkedin-browser-walk-migration.md` — the FRD this research answers
- `.rpiv/artifacts/discover/2026-11-09_17-29-56_linkedin-humanlike-fetch-behavior.md` — the behavioral layer that carries over
- `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` — D2 transport decision, D5/D7/D13 payload + leg-dead
- `.rpiv/artifacts/designs/2026-11-09_19-24-42_linkedin-humanlike-fetch-behavior.md` — pacing/budget/latch design
- `.rpiv/artifacts/designs/2026-11-01_21-35-44_linkedin-sdk-post-search-cutover.md` — the one-commit deletion+rewire precedent
- `.rpiv/artifacts/plans/2026-11-10_09-40-06_linkedin-humanlike-fetch-behavior.md` — the credential-leak follow-up
- `.rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md` — the residue-sweep lesson
- `.rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md` — the original browser walk's live runs
- `.rpiv/artifacts/solutions/2026-10-31_10-32-31_linkedin-second-surface-dispatch.md` — the original walk's mechanics
- `.rpiv/artifacts/solutions/2026-11-03_14-25-19_linkedin-voyager-transport.md` — the transport being deleted
- `.rpiv/artifacts/research/2026-11-03_12-57-53_linkedin-voyager-fetcher.md` — the voyager client research
- `.rpiv/artifacts/validation/2026-11-05_10-01-36_linkedin-local-leg.md` — the b1/b2 dead-session blockers
- `.rpiv/artifacts/validation/2026-11-10_16-10-20_linkedin-humanlike-fetch-behavior.md` — the doc-drift and profile-deletion findings

## Developer Context

**Q (discover: Transport: browser walk, not endpoint): Threads is a real Playwright browser walk. The existing `LINKEDIN_TRANSPORT=playwright` is `request.newContext` — an API call with browser cookies and no browser. Does "same as threads" mean building a new browser-walk fetcher?**
A: Yes — new browser walk.

**Q (discover: Voyager code fate): The endpoint is the restriction signal — flagged hours after ONE probe call. What happens to the voyager code?**
A: Delete it entirely.

**Q (discover: Extraction source): When the browser opens a LinkedIn search page, how should the fetcher get the posts out of it?**
A: Capture both routes — page JSON and intercepted responses.

**Q (discover: Navigation): The voyager endpoint is a search API. In the browser, the equivalent is a content-search results page. How should the fetcher get there for each surface?**
A: Open search URL directly.

**Q (discover: Browser mode): Threads runs headless Chromium. LinkedIn is far more aggressive about detecting headless browsers. Which mode should the LinkedIn walk use?**
A: Headless, like Threads.

**Q (discover: Pacing layer): The current pacing layer spaces voyager GETs 5-15s apart. A browser walk loads whole pages, not GETs. What happens to that pacing layer?**
A: Re-derive for browser.

**Q (discover: Behavioral layer status): The humanlike layer from 2026-11-09 is already implemented on this branch. You got restricted anyway. Is that layer exhausted?**
A: Not exhausted — "i dont think so, i just run once, the probe then few hours later get restricted".

**Q (discover: Payload envelope): After the migration, your PC still saves posts to `state/linkedin-posts.json`. Should the file keep the exact same shape?**
A: Same file, same shape.

**Q (discover: Failure policy): The browser walk opens a LinkedIn page and finds a security checkpoint or a login wall instead of search results. What should happen?**
A: Halt the leg, alarm once.

**Q (discover: Daily budget): The leg currently hard-stops at 150 voyager GETs per day. Should that budget survive the migration?**
A: Keep it, count page loads.

**Q (discover: Session / login strategy): The browser walk needs a logged-in LinkedIn session. How should it get one?**
A: Deferred — "i dont know, if linkedin detect bot from login phases. the beginning. need research for decisions".

**Q (`scripts/login-linkedin.ts:127`, `src/linkedin-session.ts:185`): Which session source should the walk use — the cookie file from the login helper, a persistent profile, or a headed browser every tick?**
A: "the browser login at first. this is only allowed to headed. the login part" — the login phase is headed only; the walk consumes the harvested session. That is the cookie-harvest strategy, which keeps `resolveLinkedInCookies`, `toStorageState`, and the `harvestedAt` gate coherent.

**Q (`68c1e2d:src/fetch-linkedin.ts`, `src/extract.ts:36`): Should the new walk start from the deleted browser walk's parser?**
A: "need to really open the browser and login. using blade browser to check and trust" — verify the live page with a real headed browser before committing to a parser.

**Q (`src/linkedin-fetch.ts:475`, FR-9): What should "dwell" mean — start-to-start spacing, a gap after each load, or time on page?**
A: "isnt it the pagination is infinity loader ? so it will scroll to the bottom" — the results page is an infinite loader, so the unit is a scroll round, not a page load.

**Q (`src/config-file.ts:127-137`): Should the walk scroll, or take only the first screen?**
A: "scroll few rounds like configurated in threads" — reuse the existing `scrollRounds` config key (default 8).

## Related Research

- `.rpiv/artifacts/research/2026-11-03_12-57-53_linkedin-voyager-fetcher.md` — the voyager client being deleted

## Open Questions

- **Extraction route — requires a live check.** Which route actually yields posts (page JSON, intercepted responses, or both) is answerable only by a live headed page load. No saved capture exists: the only HTML in the repo is the Threads fixture `tests/fixture/tag-page.html`; `tests/fixture/voyager-search-response.json` is an endpoint fixture, not a rendered page. The developer requires a blade-browser inspection before the parser is written. Research must NOT treat this as blocking the design.
- **Headless detectability.** Whether headless Chromium is materially safer than the voyager endpoint for this account, or whether the headed/persistent-profile options are required. The developer chose headless on the Threads precedent, but LinkedIn's headless detection is more aggressive than Threads'.
- **The pacing unit after the scroll decision.** FR-8 says the budget counts page loads; the developer's answer says the page is an infinite loader. Whether one budget unit is one navigation or one scroll round is unresolved, and it changes the worst-case arithmetic in `src/linkedin-behavior.ts:14-20` (28 wake-ups × 5 surfaces × 1 page = 140 < 150).
- **`scripts/probe-linkedin.ts` fate.** It cannot compile after the deletion. A browser-walk equivalent or removal is undecided.
- **`PageLike` extension for checkpoint detection.** `PageLike` (`src/fetch-threads.ts:90-104`) has no `url()` and no `title()`. Whether the detector stays content-based or the seam widens is a design decision.
- **`ContextFactory` path-versus-document.** The type says `string` (`src/fetch-threads.ts:118`); `toStorageState` returns an object (`src/linkedin-session.ts:185`). Playwright accepts either; the type does not. Whether to widen the type, materialize a temp file, or add a second factory is undecided.
- **The FR-5 shuffle.** The prior FRD requires shuffled surface order (`src/linkedin-fetch.ts:522-535`); the current FRD's model (`fetchSurfacesAuthenticated`) does not shuffle. A verbatim copy would drop it.
