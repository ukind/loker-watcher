---
date: 2026-10-26T14:51:03+0700
author: Yogiswara Utama
commit: 399181b
branch: main
repository: loker-watcher
topic: "fast-workflow-runtime"
tags: [research, codebase, judge, fetch-threads, state, watch-yml, probe, performance]
status: ready
last_updated: 2026-10-26T14:51:03+0700
last_updated_by: Yogiswara Utama
---

# Research: Fast Workflow Runtime at Growing Post Volume

## Research Question
Chained from `.rpiv/artifacts/discover/2026-10-26_14-21-44_fast-workflow-runtime.md` (FRD: fast-workflow-runtime). How do the four seams this round tunes actually behave today — judge concurrency + fallback, surface fetching, state schema/persistence gating, and the watch.yml runtime budget — and what does the evidence say about each planned change (probe-driven concurrency, parallel capped fallback, concurrent fetching, state v2 with unconditional persistence, browser install cost, 8-minute timeout, per-stage timings)?

## Summary
- **Judge**: one bounded pool already exists (`src/judge.ts:434-455`) but reads a module constant `JUDGE_CONCURRENCY = 4` (`src/judge.ts:45`) at exactly one site (`:455`). Making it env-tunable is a clean extension of the existing `ENV_NAMES` → `resolveJudgeConfig` → step-env chain; the repo has **no numeric-env precedent** to copy (only boolean, `src/config.ts:30-35`).
- **Fallback**: strictly serial per-post re-judging inside the reassembly pass (`src/judge.ts:456-480`). A degraded 10-post batch costs up to 10 × 2 attempts × 60s serial; the historical cascade burned 6.5 job-minutes for ~10 posts (`src/judge.ts:256-258`). This is the only unbounded cost left. One fallback call = one post (no amplification), so a per-run call budget and a post budget are the same number.
- **Fetch**: both paths launch one browser + one shared context, then walk 8 configured surfaces serially (`src/fetch-threads.ts:93-102`, `:176-190`). Serialized fixed waits alone total ~2.7-4.4 min on the authenticated path. Per-surface state is cleanly isolated (page + accumulators), so the judge pool's slot-array pattern transfers directly.
- **State**: schema v1 only (`src/state.ts:30,44-80`); a v2 file would **throw** on load today (`:79`). No pruning exists; the on-disk file has 281 bare id strings. **Confirmed bug**: the atomic-write temp name (`src/state.ts:146`) is double-quoted, never interpolates, and is the same literal for every write — overlapping writers collide and the error-path unlink can delete a peer's staged file.
- **Persistence gate**: only Gate 2 (`src/index.ts:108-112`, zero matches) moves for unconditional post-judge persistence. Gate 1 (zero unseen, `:87-91`) stays. `saveState`'s internal freshness gate (`src/state.ts:177-183`) plus `git diff --cached --quiet` (`watch.yml:70`) already give byte-identical no-op runs.
- **Workflow**: 45-min timeout with serial-math comment (`watch.yml:39-41`); guidance says 10m — the conflict is real and 8 restores the invariant. **Browser cache (discover D4) is reversed on evidence**: measured saving is ~20-35s, not the claimed 1-2 min; Playwright docs discourage caching; the watcher is headless-only, so `--only-shell` covers the exact binary used. No cache step, no `PLAYWRIGHT_BROWSERS_PATH`.
- **Timings**: `startedAt` (`src/index.ts:52`) feeds only `stats.ranAt`. The only correct timer wrap is around each stage await in `src/index.ts` — inner logs interleave once stages run concurrently. Note: "email duration on every run" is unsatisfiable as stated; `sendDigest` is reached only on match runs.

## Detailed Findings

### Judge concurrency seam (Q1)
- `JUDGE_CONCURRENCY = 4` at `src/judge.ts:45` (doc block `:40-44`: floor for the lowest endpoint tier; "raise this to that [probe] reading"). Not exported, not DI-injected, not env-read. Sole consumption: the worker-pool launch at `src/judge.ts:455` (`Math.min(JUDGE_CONCURRENCY, batches.length)` workers under one Promise.all).
- Pool mechanics (`src/judge.ts:434-455`): batches sliced by `BATCH_SIZE = 10` (`:36`); pre-allocated slot array `outcomes` (`:443`) keeps input order; shared `next` cursor claimed synchronously before first await (`:444-453`); the pool fully drains before reassembly (`:455`).
- Probe authority: `findConcurrencyCeiling` ramps [2, 4, 8, 16] (`scripts/probe-judge.ts:145-163`); any transport failure → ceiling 0; any refusal → level/2; clean ramp → 16. Recommendation line: `probe: recommended JUDGE_CONCURRENCY = ${Math.max(4, ceiling)}` (`scripts/probe-judge.ts:210`) — the `Math.max(4, …)` floor is the acceptance floor. Probe exits 1 on ceiling < 1 (`:212-215`). The probe reads env directly via `ENV_NAMES` keys, bypassing `resolveJudgeConfig` (`:180-182`).
- Injection chain that exists today: `ENV_NAMES` (`src/config.ts:14-22`) → `resolveJudgeConfig(env = process.env)` (`src/judge.ts:72-96`, trim + collect-all-missing + one throw) → `JudgeConfig` (`src/judge.ts:57-61`, currently baseUrl/apiKey/model only) → passed by `src/index.ts:94-98` → step-scoped env block `watch.yml:55-63` (six secrets today; a concurrency value would be the block's first non-secret entry).
- **No numeric env parse exists anywhere in the repo** (checked parseInt/parseFloat/Number): every numeric parse operates on JSON file data or HTTP payloads. Only env-value parsing precedent is boolean: `isHeartbeatEnabled` (`src/config.ts:30-35`, trim + case-normalize + default-on-absence). The positive-number validation idiom lives in `readRecencyHours` (`src/config-file.ts:154-159`), input = file not env.
- Pinned tests to rewrite: `tests/judge.test.ts:433-447` ("peaks at exactly four in-flight bulk calls for a 280-post backlog" — literal 4 in assert AND title) and `:449-461` (`min(concurrency, batches)` = 3 for 25 posts). Fixture `measuredFetch` (`:230-247`) records `state.peak`; once concurrency rides `JudgeConfig`, tests compute expectations from the config they pass (`sampleConfig` `:204-208`). `tests/judge.test.ts:50-62` pins `resolveJudgeConfig` output with deepEqual — a new field changes that pin.
- Backoff interaction: retryable statuses {429,500,502,503,504} (`src/judge.ts:48`), delays [1s,2s,4s] (`:50`), max 4 HTTP attempts (`:285,301-308`); budget exhausted or non-retryable → whole batch unanswered → deferred (`:309-315`). Transport errors: zero retries, immediate defer (`:333-341`, rationale `:335-336` + incident `:256-258`). At pool width K, up to K batches can simultaneously park in backoff sleep or hold a 60s socket — the 429-burst exposure the constant's own comment warns about (`:42-44`).

### Fallback seam (Q2)
- Trigger: bulk call answers but `parseBulkVerdicts` returns null (container-level failure only) → `{ status: "answered", verdicts: new Map() }` at `src/judge.ts:331` (warn `:329-330`). A second miss shape converges later: items dropped silently at `src/judge.ts:227-233` leave `verdicts.get(id)` undefined.
- Serial fallback: inside `judgePosts`' reassembly pass, `const verdict = fromBulk ?? (await judgePost(post, config, keywords, fetchFn))` at `src/judge.ts:471`, in a serial for over all batches (`:458-478`). Cost: `judgePost` = 1 post, 2 attempts (`:368`), each capped by `REQUEST_TIMEOUT_MS = 60_000` (`:33`, applied `:373`), no backoff between attempts → one degraded batch ≤ 10 × 2 × 60s = 1200s serial; the outer serial loop makes a second degraded batch strictly additive. Documented as the worst case at `src/judge.ts:14-20` and `:425-427`.
- Whole-batch unanswered outcomes take **zero** fallback calls — all posts push straight to `skippedPostIds` (`:461-467`).
- Cap facts: no fallback constant exists today; the tuning block is `src/judge.ts:31-50` and carries two doctrines — `BATCH_SIZE` "Module constant by design — no config key" (`:35`), `JUDGE_CONCURRENCY` probe-tunable (`:41-44`). Calls vs posts are the same count here (1 call = 1 post; `judgePost` signature `:356-361`, single-post prompt `:153-167`, single-verdict parse `:102-152`).
- Contracts a parallel fallback must preserve (pinned by tests):
  - `skippedPostIds` membership: sole producer `judgePosts` (`:463` batch defer, `:475` per-post skip); consumers use only length (`src/index.ts:103`) and exclusion from `judgedIds` (`src/index.ts:122-123`, comment `:120`).
  - Input-order reassembly: held today by slot-indexed outcomes (`:443,452`) + full drain (`:455`) + serial reassembly (`:458`). Tests pin ordered id arrays: `tests/judge.test.ts:464-499` (out-of-order batch resolution; deferred batch → `skippedPostIds` deepEqual that batch's ids in order `:496-498`), retry-count pins `:502-522` (calls === 3) and `:524-544` (calls === 4, both ids skipped).
  - Payload asymmetry: the `response_format: json_object` rider exists on the bulk call only (`src/judge.ts:276-282` vs `:362-367`), asserted at `tests/judge.test.ts:412-431`.
- Probe authority: none — the probe measures bulk concurrency only (`scripts/probe-judge.ts:145-163`). The cap ships without a measurement.

### Surface-fetch seam (Q3)
- Configured surfaces: 8 (3 tag, 5 url — profile + 3 searches) in `watcher.config.json:24-33`; `recencyHours: 72` at `:34` (validated by `readRecencyHours`, `src/config-file.ts:154-159`).
- Logged-out path `fetchSurfaces` (`src/fetch-threads.ts:79-110`): one `chromium.launch({ headless: true })` (`:80`), one shared BrowserContext (UA/viewport/locale `:82-86`, navigator.webdriver init patch `:87-89`), serial for awaiting `fetchOne` inline (`:93-95`); `fetch: ${label} OK` log `:96`; failures array + all-fail throw `:98-106`. `fetchOne` (`:114-141`): page per attempt, goto domcontentloaded + 30s hydration gate via waitForFunction(HAS_THREAD_ITEMS) (`:117-126`), up to `MAX_ATTEMPTS = 3` with linear backoff 2s/4s (`:130-132`), page close in finally (`:134-136`).
- Authenticated path `fetchSurfacesAuthenticated` (`:157-207`): same launch/context shape plus storageState (`:163-168`); serial for awaiting `fetchOneAuthenticated` (`:176-178`); extract log `:179`; empty tracked separately — a 0-post surface is not a failure (`:180-183`); all-fail throw combines failures + empty diagnostics (`:193-201`). `fetchOneAuthenticated` (`:210-307`): per-surface page + posts Map + xhrBodies array (`:213-215`); graphql XHR listener attached pre-navigation, fire-and-forget, silent (`:220-236`); same hydration gate (`:245-248`); Recent-tab wait `RECENT_TAB_TIMEOUT_MS = 15_000` best-effort (`:255-263`) — profile/search pages never show it, so each of the 5 url surfaces burns the full 15s; click + `RECENT_SETTLE_MS = 5_000` when present (`:266-267`); scroll loop ≤ 8 rounds × `SCROLL_SETTLE_MS = 2_500`, dry-out after 3 gain-less rounds, break at 150 posts (`:280-297`); `XHR_DRAIN_MS = 1_500` (`:300`); summary log `:301-303`; page close in finally (`:305-307`).
- Shared vs per-surface state: browser + context + init script are shared and safe under bounded parallelism; per-surface state (page, accumulators, listener, dry counter) is isolated and dies with the page. Results/failures/empty bookkeeping accumulates in push order today — under parallelism it needs index-slotting, exactly the `judge.ts:443-455` pattern.
- Cost math (authenticated, 8 surfaces): minimum serialized fixed waits ≈ 162s ≈ 2.7 min (all dry at 3 rounds); full-scroll max ≈ 262s ≈ 4.4 min — before navigation/gate/network time. Logged-out happy path has **zero fixed sleeps**; its serial cost is navigation + gate (each ≤ 60s) + retry backoff.
- Duplicated code across the two paths (touched in both today): launch/teardown, context creation + webdriver patch (`:82-89` vs `:163-171`), goto options (`:119-122` vs `:241-244`), hydration gate (`:123-126` vs `:245-248`), failures/throw shape (`:98-106` vs `:186-201`). The parallel loop replaces the serial for inside each function; callers (`src/index.ts:58-62`) are untouched by shape.
- Untested assumption (FRD constraint): Threads tolerating ~4-8 concurrent page loads per session cookie. Session state is a base64 secret decoded to a temp file — the browser-install decision must keep credentials out of any cached path.

### Per-stage timing seams (Q7)
- `startedAt` (`src/index.ts:52`) feeds only `stats.ranAt` (`:74` region). No duration is computed anywhere in main() today.
- Count-only stage logs to wrap: extract `:63`, recency `:67`, state N unseen `:92`, composite judge line `:100-103` (emitted after the `judgePosts` await `:94-98`), final state N new seen `:124`. Email's own line: `email: sent digest with N post(s) to ${recipient}` at `src/email.ts:145`, emitted before `sendDigest` resolves — so a wrap around `await sendDigest` (`src/index.ts:116`) captures the true stage duration.
- Interleaved (order-unstable once concurrent): all fetch loop logs (`fetch-threads.ts:96,100,130,179,270,273,288-295,301-303`) and judge HTTP/retry warns during the drain (`judge.ts:315-410` region). Order-stable: post-drain judge skip summaries, the composite line, and the email line. → the duration wrap must sit at the stage-await level in `src/index.ts`.
- Fetch has two code paths behind one ternary (`src/index.ts:58-62`); a single timer pair around it covers both. The authenticated path fuses fetch+extract inside `fetchSurfacesAuthenticated` — there is no deeper correct boundary.
- Testability: no fake timers anywhere in tests/; the repo convention is injectable now parameters (`src/recency.ts:16`, `src/heartbeat.ts:152`). A duration helper should follow that precedent. Judge's sleep is documented fake-timer-ready but unused — the 429 tests pay real 1s+2s+4s wall time (`tests/judge.test.ts:502-544`).
- Acceptance-criterion conflict: "one duration line per stage (fetch, judge, email) on every run" is unsatisfiable for email — `sendDigest` runs only when matches exist; zero-match runs notify via best-effort `heartbeat()` instead (`src/index.ts:87-91`, `:108-112`; heartbeat wrapper never throws, `:41-48`). The criterion needs interpreting: notification-stage duration (digest or heartbeat, whichever ran).

### State schema v1→v2 (Q4)
- Schema: `AppState` { version, seenPostIds: string[] } (`src/state.ts:18-21`); `CURRENT_STATE_VERSION = 1` (`:30`); `createInitialState` `:33-37`. `saveState` copies `currentState.version` (`:186`) — the version only ever changes in migrateState/createInitialState. `tests/state.test.ts:52` pins the roundtrip.
- `migrateState` (`:44-80`): v1 is the only branch (`:56-77`); strings pass, safe integers coerce via String(item) (`:66-67`), anything else throws (`:69`); returns version 1 (`:73-76`). Anything else → "state: unsupported schema version" (`:79`) — **a v2 file written today would be rejected on next load**. v1 entries carry no timestamps; the on-disk file is 281 bare numeric strings. A v1→v2 path must synthesize firstSeenAt (only available value: migration moment) and return version 2.
- `loadState` (`:87-104`): ENOENT → `createInitialState` (`:94-99`); other errors re-wrapped (`:101-102`). No pruning exists — the 281 ids grow monotonically. Pruning at load needs the recency window passed in: current signatures take filePath only (`:87`, `:170-174`); the supplier is `src/index.ts:84`/`:123`, where `config.recencyHours` is already in scope (loaded at `:53`, read at `:65`). `filterRecent` (`src/recency.ts:13-23`) applies the same window to posts upstream (`src/index.ts:65-66`); the join key is `Post.id` — a numeric **string**, never Number-coerced (`src/types.ts:10-14`; judge doc `src/judge.ts:205-206`).
- v2 shape mechanics: with object entries, both `diffNew` (`:110-116`) and `diffNewIds` (`:120-132`) build Sets of object references and every id looks new — dedup silently dies. Both must derive ids from entries before Set construction. The commit-back jq (`.seenPostIds | length`, `watch.yml:74-75`) counts array elements regardless of element shape and survives; it breaks only if v2 leaves the array shape.
- **Confirmed bug** — `src/state.ts:146`: the temp path is built as join(dir, ".${Date.now()}.${Math.random().toString(36).slice(2)}.tmp") — double-quoted, never interpolates (contrast the backtick line `:147`). Every write in every process uses the identical literal temp path. Consequences: overlapping writers truncate each other; after A renames, B's rename ENOENTs even though B's data was published by A; the error-path unlink (`:152-157`) can delete a peer's staged file. `tests/state.test.ts` never imports writeStateAtomic and runs strictly sequential saves — no coverage. A stray temp file is invisible to `git add state/seen-posts.json` (`watch.yml:69`).
- Complete seenPostIds touch inventory: declare `:20`; init `:36`; migrate validate/loop/return `:57-75`; Sets `:112,122`; append `:187`; tests `tests/state.test.ts:16,53`; jq `watch.yml:74-75`.

### Persistence gate reversal (Q5)
- Gate 1 (zero unseen, `src/index.ts:87-91`): nothing judged — stays an early return; a saveState there would deterministically hit the freshness gate and write nothing.
- Gate 2 (zero matches, `src/index.ts:108-112`): **this is the gate that moves** — judged ids must persist before the return. The only documented ordering rule is notification-before-persistence because `sendDigest` throws (`src/index.ts:113-116`, `src/email.ts:110-112,117`); the heartbeat wrapper cannot throw (`src/index.ts:41-48`), so ordering at Gate 2 is safe either way; mirroring the file's convention puts the save after the heartbeat await, before the return.
- No-op protection already exists twice: `diffNewIds` freshness gate returns saved: false before any disk touch (`src/state.ts:177-183`) — note the module docblock (`:6-7`) says "match-gated" but the implemented gate is freshness-gated, which is exactly what the reversal needs — and `git diff --cached --quiet` (`watch.yml:70`) skips empty commits.
- `stats.skipped` keeps skipped ids unpersisted today and must keep doing so: `judgedIds` is built from `judged` only (`src/index.ts:122`); `judgePosts` returns { judged, skippedPostIds } (`src/judge.ts:66-69` region, assembled `:456-480`).
- Tests to update (not delete): `tests/state.test.ts:29-35` (empty → no file created), `:37-44` (all-seen → byte-identical), `:46-54` (append order + version roundtrip `:52`). Coverage gaps: no migrateState tests, no ENOENT-path test, no writeStateAtomic tests, no concurrency test.

### Workflow: timeout, browser install, cache decision (Q6 + external)
- Live watch job (`watch.yml:37-77`): `timeout-minutes: 45` (`:41`) with the serial-math comment (`:39-40`: 29 bulk calls × 60s + ~3.5 min fetch); checkout `:43`; setup-node + cache npm `:45-48`; npm ci `:50`; un-cached `npx playwright install --with-deps chromium` `:52-53`; Run watcher (step-scoped six secrets) `:55-63`; Commit state `:65-77` (bot identity, no-op guard `:70-73`, jq delta `:74-75`, commit+push `:76-77`). Probe job `:16-35`: dispatch-only, `timeout-minutes: 10`, runs `scripts/probe-judge.ts`.
- Guidance conflict, exact wording: `.rpiv/guidance/.github/workflows/architecture.md:14` — timeout: 10m; `:69` — "timeout-minutes below the cron interval (10)"; `:77` — "strictly below the cron interval". Live says 45. Setting 8 restores the invariant.
- Timeout kill semantics: a timed-out job is cancelled and remaining steps do not run; the commit step has no if: (`:65`), so a killed watcher never commits. Mid-saveState kill leaves disk untouched (sibling temp + rename, `src/state.ts:139-163`) — the FRD reliability chain holds.
- Browser install (D4 **reversed**): Playwright 1.64.1 locked (`package-lock.json:1276-1293`; manifest range ^1.49.1 at `package.json:22`); chromium revision 1248 + headless-shell 1248 + ffmpeg 1013 (node_modules/playwright-core/browsers.json). `PLAYWRIGHT_BROWSERS_PATH` is set nowhere → default `~/.cache/ms-playwright`. Official docs discourage caching (restore ≈ download; apt deps not cacheable; playwright.dev/docs/ci); measured: chromium --with-deps ≈ 34s cold, --only-shell --with-deps ≈ 20s, cache hit saves ~20-35s. The watcher launches `chromium.launch({ headless: true })` (`src/fetch-threads.ts:80`), which on 1.64 uses the headless shell — --only-shell installs exactly the used binary. The prior design doc flagged the same (`.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md:2219`).
- Cache facts if ever revisited (external research): canonical pattern = actions/cache@v4, path ~/.cache/ms-playwright, key `${{ runner.os }}-playwright-${{ hashFiles('package-lock.json') }}` + prefix restore-keys; keep an apt pass every run (split install --with-deps on miss / install-deps on hit, or run --with-deps unconditionally — it no-ops for present revisions); versioned subdirs make stale entries safe; default-branch caches are readable by scheduled runs, 7-day unused eviction, 10GB/repo; workflow_dispatch writes are reusable by schedule. No first-party alternative exists (setup-node caches npm only; playwright-github-action deprecated; sanctioned alternative is the ~1-2GB Docker image).

## Code References
- `src/judge.ts:31-50` — tuning-constants block (timeout 33, BATCH_SIZE 36, JUDGE_CONCURRENCY 45, retryables 48, delays 50)
- `src/judge.ts:57-61` — `JudgeConfig` (baseUrl/apiKey/model; the surface a concurrency field joins)
- `src/judge.ts:72-96` — `resolveJudgeConfig` resolver pattern (trim, collect missing, one throw)
- `src/judge.ts:267-345` — `judgeBatch`: retry/backoff/defer logic; empty-Map fallback trigger `:331`
- `src/judge.ts:356-417` — `judgePost`: 1 post/call, 2 attempts, 60s cap, no inter-attempt backoff
- `src/judge.ts:434-455` — bounded pool: batching, slot array, shared cursor, min(concurrency, batches) workers
- `src/judge.ts:456-480` — serial reassembly + sequential fallback + skip bookkeeping
- `src/judge.ts:256-258` — incident note: run 40264368939 cascade (1 timeout → 20 fallback calls, 6.5 min)
- `scripts/probe-judge.ts:145-163` — ceiling ramp [2,4,8,16] and classification
- `scripts/probe-judge.ts:210` — recommendation line with the Math.max(4, ceiling) floor
- `src/fetch-threads.ts:23-45` — fetch constants (nav/retry/scroll/settle/drain/Recent-tab)
- `src/fetch-threads.ts:79-110` — `fetchSurfaces` (logged out): shared context, serial loop, all-fail throw
- `src/fetch-threads.ts:114-141` — `fetchOne`: page/attempt, hydration gate, linear backoff
- `src/fetch-threads.ts:157-207` — `fetchSurfacesAuthenticated`: storageState context, serial loop, empty bookkeeping
- `src/fetch-threads.ts:210-307` — `fetchOneAuthenticated`: XHR listener `:220-236`, Recent-tab wait `:255-263`, scroll loop `:280-297`, drain `:300`
- `src/index.ts:52` — unused-for-duration startedAt; `:58-62` fetch branch (two paths, one ternary)
- `src/index.ts:87-91` — Gate 1 (zero unseen; heartbeat + return)
- `src/index.ts:94-106` — judge call, matches filter, skipped count
- `src/index.ts:108-112` — Gate 2 (zero matches; heartbeat + return) — the gate that moves
- `src/index.ts:113-124` — email-before-state ordering + gated save + final log
- `src/index.ts:151-155` — main().catch: FAIL log + process.exit(1) (`:154`)
- `src/state.ts:18-37` — AppState, version constant, initial state
- `src/state.ts:44-80` — `migrateState` (v1-only; `:79` unsupported-version throw)
- `src/state.ts:87-104` — `loadState` (ENOENT → fresh; re-wrap)
- `src/state.ts:110-132` — `diffNew`/`diffNewIds` Set checks (break with object entries)
- `src/state.ts:139-163` — `writeStateAtomic`; `:146` non-interpolating temp-name bug; `:152-157` unlink path
- `src/state.ts:170-197` — `saveState`: freshness gate `:177-183`, append `:185-188`, version copy `:186`
- `src/config.ts:14-22` — `ENV_NAMES` (no concurrency key yet); `:30-35` boolean env precedent; `:51` `STATE_PATH`
- `src/config-file.ts:154-159` — `readRecencyHours` positive-number guard idiom
- `src/recency.ts:13-23` — `filterRecent` (injectable now precedent)
- `src/types.ts:10-14` — `Post.id` numeric-string contract
- `.github/workflows/watch.yml:39-41` — 45-min timeout + serial-math comment; `:45-48` setup-node cache template; `:52-53` un-cached install; `:55-63` step-scoped env; `:65-77` commit-back (guard `:70-73`, jq `:74-75`)
- `.github/workflows/watch.yml:16-35` — probe job (dispatch-only, 10m)
- `tests/judge.test.ts:230-247` — measuredFetch peak fixture; `:433-461` pinned pool-width tests (literals 4 and 3); `:464-499` order/defer pins; `:502-544` retry-count pins
- `tests/state.test.ts:29-54` — the three state-gate tests to update
- `package-lock.json:1276-1293` — playwright 1.64.1 resolution

## Integration Points

### Inbound References
- `.github/workflows/watch.yml:55-63` — runs `npx tsx src/index.ts` with step-scoped env; non-zero exit skips the commit step
- `.github/workflows/watch.yml:74-75` — jq reads .seenPostIds | length (HEAD + worktree) for the commit-message delta; survives array-of-objects, breaks on non-array
- `.rpiv/guidance/.github/workflows/architecture.md:19-22` — sync-point rules: step env ↔ `ENV_NAMES` 1:1; jq ↔ `AppState.seenPostIds`; node 22 ↔ engines; HEARTBEAT_ENABLED deliberately uninjected
- `.rpiv/guidance/.github/workflows/architecture.md:14,69,77` — timeout-below-cron rule (contradicted by live 45; restored by 8)
- `.rpiv/guidance/src/architecture.md` — DI-at-seam, email-before-state invariant, "only state.ts writes to disk" boundary
- `tests/judge.test.ts`, `tests/state.test.ts` — pinned pool widths, order arrays, retry counts, gate behaviors (update, not delete)

### Outbound Dependencies
- `src/judge.ts:267-345,356-417` — OpenAI-compatible chat completions via global fetch + AbortSignal.timeout; retryables {429,5xx}; backoff [1s,2s,4s]; transport errors defer
- `src/fetch-threads.ts:79-110,157-207` — Playwright chromium (headless), one browser + one shared context per run; session via storageState temp file (`src/threads-session.ts:31-53`)
- `src/email.ts:122-154` — nodemailer transport; `sendDigest` throws on failure (fail-visible); heartbeat.ts reuses sendText best-effort
- `state/seen-posts.json` — the only disk persistence; 281 ids on disk at v1; committed back by the workflow

### Infrastructure Wiring
- `watch.yml:43-50` — checkout → setup-node (npm cache) → npm ci; insertion point for any cache/browser step is between `:50` and `:53`
- `watch.yml:16-35` — probe job: the dispatch-only pattern for runner-measured constants
- `watch.yml:11-13` — concurrency group watch, cancel-in-progress false — runs queue, never overlap (stays)
- `package.json:5` — engines.node >= 22 ↔ node-version 22 (`watch.yml:47`)

## Architecture Insights
- **Slot-array + shared cursor** (`src/judge.ts:441-455`) is the repo's proven bounded-concurrency idiom: order-preserving, fully draining, min(width, items) workers. Both new pools (fallback, fetch) mirror it.
- **Two tunability doctrines** coexist in the constants block: probe-measured values may go env-tunable (`JUDGE_CONCURRENCY`); everything else is a module constant by design (`BATCH_SIZE` `:35`). The fallback budget follows the second doctrine (no measurement exists).
- **Freshness gate ≠ match gate**: the module docblock (`src/state.ts:6-7`) says "match-gated" but `saveState` is freshness-gated (`:177-183`) — the gate reversal needs no state.ts change, only pipeline wiring.
- **Env hygiene**: trim → normalize → collect-all-missing → one throw (`resolveJudgeConfig` `:72-96`); boolean default-on-absence (`config.ts:30-35`); positive-number guard (`config-file.ts:154-159`). A numeric env read is the repo's first — compose the three.
- **Timing belongs at stage awaits** in `src/index.ts`: inner logs interleave once stages run concurrently; post-await logs are the only order-stable anchors.
- **Fail-visible boundaries are load-bearing**: heartbeat never throws (`index.ts:41-48`), sendDigest throws (`email.ts:110-112`), main().catch exits 1 (`index.ts:154`). A parallel fallback must keep producing the same two output arrays so these contracts stay intact.

## Precedents & Lessons
4 similar past changes analyzed.

### Precedent: bounded worker pool for bulk judging
**Commit(s)**: `1d4faed` — "feat: parallelize the judge with a bounded worker pool" (2026-10-26)
**Blast radius**: 2 files — src/judge.ts (pool + backoff + order-preserving reassembly; fallback deliberately left sequential), tests/judge.test.ts (+144 lines, 5-case concurrency suite)
**Follow-up fixes**: none (validated 102/102 in `a880ee0`)
**Lessons from docs**:
- .rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md — "Fire four calls at a rate-limited endpoint and a 429 burst would defer several batches at once, turning a speed fix into a run with no digest." Concurrency ships only with the backoff.
- Same doc — fallback-in-pool was explicitly deferred as the sanctioned follow-up if the path proves hot (this round).
**Takeaway**: the pool pattern survived validation; any width raise must re-check 429-burst deferral behavior.

### Precedent: bulk judge shipped, then same-day production failure
**Commit(s)**: `e316cb5` — "feat: judge posts against configured keywords in bulk" (2026-10-26); fixed by `fda50c2` — "fix: defer unanswered judge batches, raise the request timeout" (~40 min later)
**Blast radius**: 11 files then 3 files (src/judge.ts, tests, README/watch budget)
**Follow-up fixes**:
- `fda50c2` — run 40264368939 cancelled at the job cap: the 15s timeout (validated only on a dev machine) killed every batch at 15.0s and one cascade burned 6.5 of 10 minutes for ~10 posts. Fix: 60s timeout + transport-deferral.
**Lessons from docs**:
- plans/2026-10-26_09-46-32:44 — "The judge stage was never load-tested… Removing the filter sent the whole unseen backlog at it."
- plans/2026-10-26_09-46-32:47 — watch.yml was explicitly out of scope that round; the job cap became the binding constraint.
**Takeaway**: a throughput change without a runner-measured timeout produced a cancelled run the same day — workflow budget changes land in the same round as the speed change.

### Precedent: probe job + 45-minute budget raise (the number being reversed now)
**Commit(s)**: `73d6786` — "feat: probe judge latency and raise the watch job budget" (2026-10-26); amended by `5f6a328` — "feat: ramp concurrent calls in the judge probe" (same day)
**Blast radius**: 5 files (watch.yml timeout 10→45, probe job, scripts/probe-judge.ts)
**Follow-up fixes**:
- `5f6a328` — the sequential probe under-measured real latency 5.2× (5.3s vs 27.75s in run 40268599609) because fixtures used 5 keywords/~200-char captions vs production's 19 keywords and real text.
**Lessons from docs**:
- plans/2026-10-26_09-46-32:92 — run 40268599609 took 15m46s; "the judge stage now exceeds the */10 cron interval, so concurrency: watch queues the next run behind it."
- Same doc — at 27.75s/call the 60s timeout has 2.2× headroom, not the 3.7× the validation report claimed.
**Takeaway**: probe defaults are only as good as their fixtures; validation headroom claims have been wrong once — ship concurrency defaults only from production-representative dispatch runs.

### Precedent: fetch-threads and state module history
**Commit(s)**: `9e1c8ef` — "feat: authenticated threads fetch with recency cutoff" (2026-10-25); `b050436` — "json config as source of truth" (2026-10-25); state: `1a9e353` (v1 pipeline), `2a5dee9` ("test: cover the state module"), `67a9bd2` (no-match heartbeat, established the FRD #9 gate this round reverses)
**Blast radius**: 12 files each for the fetch commits; state.ts untouched since v1 except formatting (`20478d1`); state data bot-committed continuously (`3356050`/`081085d`/`92367c9`)
**Follow-up fixes**: none in these areas
**Lessons from docs**:
- discover artifact Suggested Follow-ups — fetch-threads.ts and index.ts have no test files; the persistence change makes a pipeline-level test the natural first entry; heartbeat stats will show judged: 0 more often once irrelevant ids persist.
**Takeaway**: concurrent fetching is greenfield (no precedent); state migration is greenfield and must handle the committed on-disk v1 file.

### Composite Lessons
- **Runner-measure or fail**: two same-day incidents trace to dev-machine/probe-fixture numbers (`fda50c2`, `5f6a328`). Every new constant (concurrency default, timeout, caps) validates from a real workflow_dispatch run with production-representative inputs.
- **Transport failures cascade when retried; rate limits don't predict fallback death** — keep zero-retry deferral for transport errors in both pools; backoff only for 429/5xx.
- **Removing a gate silently invalidated downstream constants once** (keyword pre-filter removal exposed the judge to full backlogs, `e316cb5`). Reversing the FRD #9 gate changes what reaches state and heartbeat stats — update the state-gate tests and expect funnel-stat drift.
- **The 45-minute budget exists because serial judging was 12m57s** (`73d6786`); the 8-minute ceiling is safe only after the fast paths land, and the atomic-write guarantee is what makes killed runs safe.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-10-26_14-21-44_fast-workflow-runtime.md` — the FRD this research chains from (requirements, decisions D1-D10, acceptance criteria)
- `.rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md` — plan that introduced the pool, backoff, deferral, and the 45-min budget; run-history math
- `.rpiv/artifacts/solutions/2026-10-26_06-15-51_model-judged-keywords.md` — solution doc that first flagged the re-judging gap (line 146)
- `.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md` — original design; line 2219 recorded "actions/cache for Playwright officially discouraged" before D4 chose caching
- `.rpiv/artifacts/validation/2026-10-26_12-07-47_model-judged-keywords.md` — validation report; over-claimed headroom (3.7× vs actual 2.2×)

## Developer Context
**Q (discover: D1 — Probe-driven judge concurrency): The judge runs only 4 LLM calls at once (src/judge.ts:45), and the code's own comment says to raise it to the probe-measured ceiling. Make concurrency probe-driven?**
A: Probe-driven ceiling.

**Q (discover: D2 — Parallelize and cap the fallback path): When a bulk verdict is unusable, posts are re-judged one-by-one, serially (src/judge.ts:466-471) — 200 posts can mean 400 sequential calls. Change this?**
A: Parallelize + cap.

**Q (discover: D3 — Concurrent surface fetching): Surfaces load one after another (src/fetch-threads.ts:176), each with fixed waits — roughly 3.5-8 min of fixed cost per run. Load them in parallel?**
A: Parallel pages.

**Q (discover: D4 — Cache the Playwright browser): Every run downloads Chromium fresh before it can start (the Playwright install step in watch.yml). Cache the browser between runs?**
A: Cache browser. *(Reversed below — see advisor decision.)*

**Q (discover: D5 — Batch size stays 10; concurrency carries throughput): Judge throughput has two levers left: how many posts per LLM call (batch size, now 10) and how many calls at once (concurrency, being raised). Which lever carries the load?**
A: Keep 10.

**Q (discover: D6 — Recency window stays 72h): The 72-hour recency window decides how many posts enter the judge (watcher.config.json:30). Trim the window, or leave product behavior untouched?**
A: Keep 72h — with the addition that the same post must not be re-fed to the LLM (became requirement #4/#5).

**Q (discover: D7 — Persist all judged ids, absolute no-re-judge): To stop re-feeding the same posts to the LLM, zero-match runs must start persisting judged ids — this reverses FRD #9's match-gate. How absolute is the no-re-judge rule?**
A: Persist all judged; no 24h re-check.

**Q (discover: D8 — 8-minute run ceiling): After the speed fixes, how long should one run be allowed to go before GitHub kills it?**
A: 8 minutes.

**Q (discover: D9 — Per-stage timing logs): Stages log counts today but never durations (src/index.ts:52 captures the start time and never uses it). Add per-stage timing to the logs?**
A: Add timings.

**Q (discover: D10 — Scope boundaries): Confirm the boundaries: cron schedule, LLM endpoint, and match semantics stay as they are — this round only makes the run fast?**
A: All out of scope.

**Q (`watch.yml:52-53` / evidence conflict): Research measured the browser-cache saving at ~20-35s — not the "~1-2 min" D4 claimed — and Playwright's docs actively discourage caching (restore ≈ download; the apt deps pass runs every run regardless; same flag recorded at .rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md:2219). The watcher is headless-only (src/fetch-threads.ts:80). Keep D4 or reverse it?**
A: **Reverse D4.** Drop the actions/cache step entirely. Change `watch.yml:53` to `npx playwright install --with-deps --only-shell chromium` (the headless shell is the exact binary 1.64 headless launches use). No cache step, no `PLAYWRIGHT_BROWSERS_PATH`, no restore-keys. Add a shortcut comment on the step noting headless-shell-only, upgrade if a headed launch is ever added. (Advisor decision 2026-10-26.)

**Q (`src/judge.ts:456-480`): What sets the per-run fallback-call budget's value (FRD #2), given the probe measures bulk concurrency only?**
A: **Module constant, proposed 40.** `FALLBACK_CALL_BUDGET = 40` in the `src/judge.ts:31-50` block, beside `BATCH_SIZE`, with a comment explaining it. Rationale: the historical cascade was 20 calls (one degraded batch × 10 posts × 2 attempts, `src/judge.ts:256-258`), so 40 bounds two fully-degraded batches while posts beyond the cap stay unseen and retry next run (D3 semantics). Not env-tunable — nothing measures it, and only probe-measured values go env-tunable per repo doctrine; a one-line env follow-up can come later if wanted. (Advisor decision 2026-10-26; value flagged for review.)

## Related Research
- (none — first research artifact for this topic; prior context lives in the Historical Context links)

## Open Questions
1. The shipped `JUDGE_CONCURRENCY` default is unknown until a probe run executes from a real runner with production-representative fixtures (precedent `5f6a328`: a fixture-driven probe under-measured 5.2×). Design must pin the default-source rule; acceptance requires the constant's comment to cite the measuring run.
2. Fetch parallelism cap: "Threads tolerates ~4-8 concurrent page loads from one browser session" is untested (FRD constraint; the precedent sweep calls it the only untested assumption in the fetch design). Design picks a bounded default; verification requires a live dispatch — plus a plan for what a rate-limited session looks like in the logs.
3. "One duration line per stage (fetch, judge, email) on every run" is unsatisfiable for email on zero-match runs (`sendDigest` is reached only when matches exist, `src/index.ts:108-116`; the heartbeat notifies instead). Design must pick the semantics — for example notification-stage duration (digest or heartbeat, whichever ran) — and adjust the acceptance-criterion wording.
