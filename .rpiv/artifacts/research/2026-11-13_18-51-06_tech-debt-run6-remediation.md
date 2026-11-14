---
date: 2026-11-13T18:51:06+0700
author: Yogiswara Utama
commit: df890a9
branch: main
repository: loker-watcher
topic: "Tech-debt audit remediation (run #6: N041-N059)"
tags: [research, codebase, judge, judge-dispatch, judge-prompts, linkedin-fetch, linkedin-walk, linkedin-context, linkedin-capture, linkedin-payload, fetch-linkedin, knip, docs]
status: ready
last_updated: 2026-11-13T19:04:00+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Corrected the judge-split section to the widened run-5 scope; verified 626/626 tests green at df890a9"
---

# Research: Tech-debt audit remediation (run #6: N041-N059)

## Research Question

Remediate every open finding from tech-debt audit run #6 so the next audit's open-findings table is empty. The pass fixes the two real logic gaps in the LinkedIn walk first (streak race, cap overshoot), then splits the two god files (`judge.ts` 1091 LOC, `linkedin-fetch.ts` 898 LOC) into four modules, then bounds the capture disk, then runs the hygiene sweep, then reclaims the 172 MB of loose git objects and records the state-history policy.

Chained from `.rpiv/artifacts/discover/2026-11-13_18-35-26_tech-debt-run6-remediation.md`.

## Summary

The FRD's execution order is sound in its first half and wrong in its second. Fixes before splits is correct and load-bearing (N046, N047, N048 all cite lines inside `walkLinkedInSurface`, which the split moves). But the doc sync sits at requirement 9, ahead of five later requirements that each falsify a doc line, so it would be stale on arrival. It moves to the last slice.

Two FRD premises are factually wrong and both change the work:

- **`knip` is not a devDependency.** `package.json` has no `knip` entry, no `knip` script, no lockfile entry, and `node_modules/.bin` has no binary. The audit ran it ad hoc via `npx`. The FRD's constraint "knip is already a devDependency (the audit ran it)" is false, so "add `npx knip` as a CI step" means an unpinned registry fetch on every push. Four prior runs declined this gate; run #6 adds it, so it lands pinned.
- **The narrow judge split cannot reach 500 LOC.** Moving only `dispatchLlmCall` + four types + three prompt builders leaves `judge.ts` at roughly 746 lines. The run-5 branch (`f1812b4`..`b9e7d71`, unmerged) moved 687 lines to reach 405. The scope widens to the run-5 set.

The judge split's move list is incomplete, and the widened scope makes it more so. `dispatchLlmCall` consumes sixteen module symbols, not the eight the FRD names, and moving `judgeBatch`, `judgePost` and `exhaustionRecord` drags in ten more. Two of them decide the module map: `sleep` must move with `judgePost` or `judge-dispatch.ts` imports it back from `judge.ts` and closes a real runtime cycle, and `normalizeEndpoint`/`terminalFailureReason` must move or `src/judge-availability.ts` pins them to the wrong side of the split. `RETRY_DELAYS_MS` stops being a problem under the widened scope — both its users move, so it stays module-private.

The `linkedin-fetch.ts` split's boundary is usage-based, not the FRD's shorthand. The walk carries about fifteen tuning constants and two JS snippets; the pacing gate, `defaultSleep`, `PACE_MIN_MS`/`PACE_MAX_MS` and `LINKEDIN_FETCH_CONCURRENCY` are orchestration-side and stay. The re-export surface is load-bearing for three scripts and four test files, so `linkedin-fetch.ts` must re-export the six tagged-error symbols, the factory type, and `SCROLL_JS`.

Three requirements are inert or unsafe as written:

- **N053's env override does nothing.** `linkedinChromiumContextFactory` is built once at module load from the literal, and the factory it returns ignores the `profileDir` argument the walk passes. Changing the argument changes nothing the tick opens. The default factory must be built from the resolved `profileDir`.
- **N049's latch conversion flips fail-closed to fail-open for one tick.** A truncated latch blocks today; a missing latch lets the next tick re-navigate into the checkpoint once. Accepted, because the repo doctrine prefers a duplicate alarm over a suppressed one.
- **N049 and N056 both leave untracked files in `state/` that `guardCheckout` reads as a dirty tree.** A crash between temp write and rename leaves `state/.*.tmp`; removing the budget-file ignore leaves the file in every operator clone. Both wedge the PC loop until a human cleans up. `state/*.tmp` joins `.gitignore` and the budget ignore stays.

N050 is the only requirement that reverses a committed, hash-cited behavior: `tests/fetch-linkedin.test.ts:526` pins "0 faults + 0 posts is an outcome" from `defb8af`. It reverses, and the test plus its module header get rewritten.

Baseline verified at `df890a9`: `npm test` 626/626 pass, 151 suites, 21 s. The FRD's "626/626 green today" claim holds.

## Detailed Findings

### The LinkedIn walk: streak, cap, and the two bare catches (N046, N047, N048)

`walkLinkedInSurface` is defined at `src/linkedin-fetch.ts:487`. It declares `seenStreak`/`lastSeenId` at `:503-504`, attaches `page.on("response", …)` at `:514`, and opens a `void` async IIFE at `:560` for the matched arm. The IIFE runs synchronously only to `await response.text()` at `:562`; the streak mutation at `:569-574` is a microtask continuation. Two responses can fire A→B and complete B→A, so "consecutive" counts body-completion order.

The loop reads the streak at exactly two points: pre-round at `:663-666` (after the `for` header at `:659`, before the DOM probe at `:670-673`), and post-log at `:733-736` (after the dry/gain log at `:719-728`, before the dry exit at `:745-751`). The drain at `:754` and the return at `:758` are after the loop. Folding after `:754` never executes before a read, so `seenStreak` stays at its initial `0` for the whole loop and the seen-stop never fires.

The sequence must be minted synchronously at `:560`, before the `try` at `:561` and before the await at `:562`. The `{ seq, id, seen }` entry cannot be fully built there — `id` and `seen` only exist after `collectLinkedInPosts` at `:564` — so the push happens after the parse but carries the pre-await `seq`. The `posts.has` skip at `:567` stays before the push, preserving the re-served-id contract pinned at `tests/linkedin-fetch.test.ts:1302-1347`.

The fold has an edge the acceptance test does not exercise. If a body fires early (low `seq`) but completes after a fold, its entries land after later-`seq` entries already applied, so the streak can reset when stream order says it should not. Recomputing `seenStreak`/`lastSeenId` from scratch in `seq` order on each fold closes it; the array is bounded by the post cap plus drain inserts.

The offline double cannot observe the race. `tests/linkedin-fetch.test.ts:204` and `:252` return already-resolved promises from `text`, so every body's continuation is scheduled in fire order and microtasks run FIFO. The `setImmediate` at `:261` is a macrotask, so all microtasks drain before the walk's next observation. The new test must return deferred promises and resolve them in reverse order.

The two bare catches: the unmatched arm ends at `:553-555`, the matched arm at `:607-609`, both commented "the body read can race the page close". The matched arm's `try` spans `:561-606` and contains `await response.text()`, `collectLinkedInPosts`, the insert loop, the log line, and the `captureOnce` call. The page-close race produces Playwright's `TargetClosedError` (client at `playwright-core` `coreBundle.js:59192-59196`, server at `:12884-12887`), `Error("Response body is unavailable")` (`:37801`), and the navigation-away message (`:14550-14552`). The parser is documented "pure, never throws" (`src/linkedin-parser.ts:44-46`) but its recursive walkers can throw `RangeError` on a deeply nested body. The capture path can throw `RangeError` from `new Date(nowFn()).toISOString()` at `:535`/`:593`.

The warn-once channels are disjoint by construction: an async sink rejection is consumed by `captureOnce`'s `.catch` at `src/linkedin-capture.ts:199` and never reaches the walk's try; a synchronous sink throw never produced a promise, so `captureOnce` does not warn. The existing pin at `tests/linkedin-fetch.test.ts:1158-1193` asserts exactly one warn across repeated sink failures and stays green.

### The walk's output seam: cap → payload → hosted reader (N047, N050, N055)

`LINKEDIN_MAX_POSTS = 150` (`src/linkedin-fetch.ts:110`) is used once, in the loop condition at `:659`. The listener inserts with no cap check at `:568-580`, and the drain at `:754` lets in-flight bodies land after the loop exits. The return at `:758` is `[...posts.values()]` with no slice. The map is insertion-ordered and the parser mints in derived-timestamp order, so a slice keeps the newest 150. The cap is per-surface: `runPool` runs at width 2 (`:69`, call at `:833`) and `watcher.config.json` configures five LinkedIn surfaces, so the payload total can reach 750 even after the slice.

The existing cap test at `tests/linkedin-fetch.test.ts:523-525` feeds exactly 150 posts in one body, so a no-op slice passes it. The N047 test must feed more than 150 across bodies.

`fetchTick`'s catch has three arms: halt trips the latch and returns quiet zeros (`scripts/fetch-linkedin.ts:414-419`); all-faulted warns and returns `{ wrote: false, pushed: false, postCount: 0 }` (`:425-429`); leg-dead re-throws (`:431`). The success path at `:434-438` writes unconditionally. `writePayloadAtomic` stamps a fresh `writtenAt` at `src/linkedin-payload.ts:118`, so "byte-identical" means "do not call it at all".

A zero-post walk writes `{ version: 2, writtenAt: <now>, posts: [] }`. The hosted reader accepts it as `{ posts: [], leg: "ok", detail: "payload 0 min old" }` (`src/linkedin-payload.ts:211-215`), `src/index.ts:300-305` attaches the leg, `src/heartbeat.ts:145` renders "LinkedIn leg: ok", and `src/email.ts:132` returns null for a zero-post surface digest. The result is indistinguishable from a quiet day.

The N050 guard must sit after the walk's try/catch (preserving halt/leg-dead/all-faulted precedence) and before `:434`. Two subtleties: `clearEpisodeMarker` at `:437` sits after the write, so an early return skips it and a stale leg-dead marker suppresses the next real alarm; and the return shape should copy the all-faulted arm.

The URN floor has three copies, not two: `src/linkedin-parser.ts:79-80` (`\d{10,}`), `src/linkedin-payload.ts:65` (`\d{9,}`), and an inline `/urn:li:activity:(\d{10,})/g` at `src/linkedin-fetch.ts:547`. The safe shared value is 10+, the parser's floor; the reader becomes stricter and a 9-digit row drops as malformed with the existing count warn at `src/linkedin-payload.ts:207-209`. No test pins 9-digit acceptance.

### The capture bound (N051)

`makeFsCaptureSink` (`src/linkedin-capture.ts:138`) mints a lazy session stamp at `:148`, writes `JSON.stringify(record, null, 2)` plus a newline at `:157` via `stateTempPath` + rename, then prunes beyond `CAPTURE_KEEP_SESSIONS = 20` (`:46`) best-effort at `:173-179`. The two production call sites are `scripts/fetch-linkedin.ts:408` and `scripts/probe-linkedin.ts:185`, both `deps.captureSink ?? makeFsCaptureSink()`, evaluated once per tick/probe.

The size guard must read `record.body.length` — the in-memory string — not the file, and must run before `mkdir`/`writeFile`/`rename` and ideally before the lazy `session ??=` so a fully-skipped walk creates no directory. It must skip the write entirely, not truncate: `tests/linkedin-capture.test.ts:92` deep-equals the parsed record and `:93` pins the trailing newline. The pretty-print is not literally pinned (`JSON.parse` normalizes whitespace), but changing the on-disk format is not the intended bound.

The measured session is 54 bodies at ~85 MB (`src/linkedin-capture.ts:36-45`), about 1.57 MB per body. A threshold below ~1.5 MB would skip the majority of bodies and gut the capture premise, so the guard can only be an outlier bound. The steady-state bound stays `CAPTURE_KEEP_SESSIONS × 85 MB ≈ 1.7 GB`. The kill switch is the only lever that reduces the per-walk 85 MB.

`record.body.length` is UTF-16 code units, not bytes; `Buffer.byteLength(record.body, "utf8")` is a pure in-memory computation that preserves the no-I/O constraint. The constant should be named for what it measures.

The env read is once per tick, matching the FRD's assumption, because the call sites already evaluate the sink expression once. Injection must win over the env: `deps.captureSink ?? (env.LINKEDIN_CAPTURE === "off" ? undefined : makeFsCaptureSink())`. The offline suites inject sinks in every walk-driving case and the absence-oracle snapshots would fail if a test wrote `captures/`.

The consumer is `scripts/replay-linkedin.ts:443` (`analyzeBody` reads `record.body`), with a hard `schemaVersion` gate at `:633` and a shape validator at `:606-620`. A skipped body means no file; the replay simply has fewer inputs, and the warn line is the only evidence.

### The tick's call expression (N050, N051, N053, N054)

`scripts/fetch-linkedin.ts:398-410` is one expression that four requirements rewrite. `fetchLinkedInPosts` (`src/linkedin-fetch.ts:792-802`) takes ten positional parameters, eight defaulted. The tick passes `LINKEDIN_PROFILE_DIR` at `:400` and `undefined` for `sleepFn` at `:403`; the probe (`scripts/probe-linkedin.ts:175-186`) passes `undefined` for `sleepFn`, `rng`, and `seenIds` at `:180`, `:182`, `:184`.

`tests/linkedin-fetch.test.ts` calls `fetchLinkedInPosts` directly 36 times: 16 at five args, 10 at seven, 2 at eight, 4 at nine, 4 at ten. Every one shifts, because the second positional parameter changes from `profileDir: string` to a deps object. The idiom to copy is `FetchTickDeps` (`scripts/fetch-linkedin.ts:87-140`): optional fields with "Default: …" JSDoc, defaults resolved at the top.

`seenIds` must stay a fresh set per call (`deps.seenIds ?? new Set()`), preserving the current default expression's per-call evaluation.

N053's override is inert. `linkedinChromiumContextFactory` is `makeLinkedInContextFactory(LINKEDIN_PROFILE_DIR)` at `src/linkedin-fetch.ts:408-409`, and the returned closure is `async (): Promise<ContextLike>` at `:341` — it ignores the `profileDir` argument the walk passes at `:817` and uses the captured literal at `:348`. The test doubles record the argument (`tests/linkedin-fetch.test.ts:185-187`, `tests/probe-linkedin.test.ts:162-164`), so the pins at `:351` and `:275` pass today even though production ignores it.

A second gap: `scripts/login-linkedin.ts:35` and `scripts/reset-linkedin.ts:29` still use the literal. An operator who sets `LINKEDIN_PROFILE_DIR=/tmp/x` would log in to and reset the literal profile while the tick reads `/tmp/x`.

### The judge split (N042, N005)

The scope is the run-5 set, not the FRD's narrow one. The narrow scope (dispatch core plus prompt builders) leaves `judge.ts` at roughly 746 lines; the run-5 branch (`f1812b4`..`b9e7d71`, unmerged) moved 687 lines and landed at 405. The widened scope moves the dispatch core, both wrappers, the exhaustion record, the two wire helpers, and `sleep`.

**`src/judge-prompts.ts`** — `systemMessage` (`:233`, stays private), `buildMessages` (`:248`, gains `export`), `buildBulkMessages` (`:276`, already exported). Only import: `type Post` from `types.js`.

**`src/judge-dispatch.ts`** — the dispatch core and everything that calls it:

- `REQUEST_TIMEOUT_MS` (`:79`), `RETRYABLE_STATUSES` (`:101`), `RETRY_DELAYS_MS` (`:103`) — private
- `sleep` (`:126`) and `SleepFn` (`:131`) — exported
- `normalizeEndpoint` (`:219`), `terminalFailureReason` (`:371`) — exported
- `allAvailabilityBlocked` (`:391`) — private
- `ContentDecision` (`:310`), `DispatchOutcome` (`:325`), `AttemptDirective` (`:341`), `DispatchWarns` (`:353`) — private; both consumers move with them
- `dispatchLlmCall` (`:474-692`) — private; only `judgeBatch` and `judgePost` call it, and both move
- `BatchOutcome` (`:300`) — exported; `judgePosts` declares the slot array
- `judgeBatch` (`:693`) — exported; `judgePosts` calls it at `:960`
- `judgePost` (`:795`) — exported
- `exhaustionRecord` (`:413`) — exported; `judgePosts` calls it at `:980` and `:1063`

**`src/judge.ts`** — what stays: `BATCH_SIZE` (`:82`), `FALLBACK_CALL_BUDGET` (`:94`), `WAIT_BUDGET_MS` (`:122`), `LlmAccount` (`:134`), `JudgedPost` (`:188`), `JudgeBatchResult` (`:194`), `judgePosts` (`:904`), `resolveJudgeConfig`, `parseLlmAccounts`, plus the re-export block.

The `RETRY_DELAYS_MS` cycle disappears under the widened scope. Both its users — `dispatchLlmCall` (`:584`, `:588`) and `judgeBatch` (`:722`, `:731`) — move to `judge-dispatch.ts`, so it stays module-private. The narrow scope needed an export; this one does not.

`sleep` is the new cycle risk. `judgePost` (`:802`) and `judgePosts` (`:912`) both default `sleepFn: SleepFn = sleep`. If `judgePost` moves and keeps that default, `judge-dispatch.ts` needs a runtime import of `sleep` from `judge.ts` — a real cycle against `judge.ts → judge-dispatch.ts`. So `sleep` and `SleepFn` move to `judge-dispatch.ts`, and `judge.ts` imports both for `judgePosts`'s default. `src/fetch-threads.ts:31` retargets to `./judge-dispatch.js`; `src/judge-rotation.ts:40` retargets `type SleepFn` there too, which is a type-only edge erased by `verbatimModuleSyntax` — the same idiom `judge-rotation.ts:38-40` already documents.

`LlmAccount` stays in `judge.ts`. `judge-dispatch.ts` imports it type-only, reproducing the idiom already used by `judge-rotation.ts:40`, `judge-health.ts:34`, and `judge-ceilings.ts:28`. Moving it would create type-only back-edges from three LEAF modules into the FUNNEL group and force ten-plus import-site edits.

`normalizeEndpoint` and `terminalFailureReason` move with the core. `src/judge-availability.ts:27` retargets to `./judge-dispatch.js` (one line plus the header citations at `:34-36` and `:40-41`). Leaving them in `judge.ts` while `judge-dispatch.ts` imports them back is the only genuine runtime cycle in any variant.

The symbols the widened scope drags in, and where each lands: `parseBulkVerdicts` and `parseVerdict` stay in `judge-parse.ts` and are imported by `judge-dispatch.ts` only; `runPool` stays in `pool.ts` and is imported by `judge.ts` only (`judgePosts` at `:959` and `:1033`); `rotationExhausted` is imported by both modules (`judgePost` throws it at `:856`, `judgePosts` at `:979` and `:1062`); `isRotationExhausted` and `readTickOutcomes` are `judgePosts`-only and stay on `judge.ts`'s import list; `buildFailuresFromLedger` moves to `judge-dispatch.ts` with `exhaustionRecord`; `HARD_FAIL_TICKS_TO_CAP` and `TickOutcomes` are imported by both; `AccountFailure` stays in `types.ts` and is imported by both.

The re-export surface is two facades, forced by the "tests unedited" criterion. `tests/judge.test.ts:10-12` imports `buildBulkMessages`, `judgePost`, `judgePosts` from `../src/judge.js`; `tests/judge-rotation.test.ts:22` imports `judgePost`, `judgePosts`. `judgePosts` stays, so `judge.ts` re-exports `buildBulkMessages` (from `judge-prompts.js`) and `judgePost` (from `judge-dispatch.js`). `scripts/probe-judge.ts:46` keeps importing `buildBulkMessages` from `judge.js` so the facade has one path, not two. The run-5 plan's D3 forbade exactly this as a "second import path" drift class; the run-6 criterion wins for this pass, and the facade carries a removal note so run #7 can re-point the two test imports and delete it.

The LOC arithmetic: `judge-dispatch.ts` lands near 690 lines, `judge-prompts.ts` near 80, `judge.ts` near 390. That is the run-5 shape, and it is the only variant that satisfies the under-500 criterion.

### The linkedin-fetch split (N042, N059)

`src/linkedin-context.ts` receives `LinkedInContextFactory` (`:305`), `makeLinkedInContextFactory` (`:340-395`, keeps `export` per the N041 carve-out), and the three tagged-error families spanning `:208-282`. The errors land here, not with the walk, because both halves import them: the walk calls `halt` at `:508` and `legDead` at `:649`; the orchestration calls `isHalt` at `:863`, `isLegDead` at `:871`, `halt` at `:890`, `legDead` at `:893`, `allSurfacesFaulted` at `:896`.

`src/linkedin-walk.ts` receives `walkLinkedInSurface` (`:487-780`, gains `export` for the importer at `:843`) plus the walk's tuning constants at `:92-204`: `LOAD_MORE_SELECTOR`, `LINKEDIN_SETTLE_MS`, `LINKEDIN_LOAD_MORE_WAIT_MS`, `LINKEDIN_MAX_DRY_ROUNDS`, `LINKEDIN_MIN_GAIN`, `LINKEDIN_MAX_POSTS`, `SEEN_STOP_CONSECUTIVE`, `LINKEDIN_XHR_DRAIN_MS`, `LINKEDIN_NAV_TIMEOUT_MS`, `LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS`, `LINKEDIN_FIRST_RESPONSE_POLL_MS`, `DOM_PROBE_JS`, `SCROLL_JS`, `LINKEDIN_CHECKPOINT_URL_RE`.

The FRD's framing that `makePacingGate`, `defaultSleep`, `PACE_MIN_MS`/`PACE_MAX_MS` and `LINKEDIN_FETCH_CONCURRENCY` are walk-side is wrong. The walk never calls the gate: `fetchLinkedInPosts` awaits `gate.wait()` at `:841` and only then calls `walkLinkedInSurface` at `:843`. The walk's signature (`:487-497`) has no gate parameter. Those four stay in `linkedin-fetch.ts`.

`LINKEDIN_DEFAULT_SCROLL_ROUNDS` (`:107`) is used only as the default at `:796`, so it stays. `LINKEDIN_PROFILE_DIR` (`:401`) and `linkedinChromiumContextFactory` (`:408-409`) stay.

The re-export surface is load-bearing. `scripts/fetch-linkedin.ts:41-49`, `scripts/probe-linkedin.ts:37-45`, `scripts/watch-linkedin.ts:20`, and `src/index.ts:58` import from `linkedin-fetch.js`; so do `tests/linkedin-fetch.test.ts:33-43`, `tests/fetch-linkedin.test.ts:35`, `tests/probe-linkedin.test.ts:30-35`, and `tests/watch-linkedin.test.ts:16`. The exact re-export set is the six tagged-error symbols, `LinkedInContextFactory`, and `SCROLL_JS`. It must not include `makeLinkedInContextFactory`, the two UA constants, or `linkedinChromiumContextFactory` — those have no importer from `linkedin-fetch.ts` and would be dead exports.

`LinkedinSurface` (`:63`) is used by both halves and imported by `src/index.ts:58`, two scripts, and one test. Leaving it in `linkedin-fetch.ts` creates a type-only `linkedin-walk.ts → linkedin-fetch.ts` edge, erased by `verbatimModuleSyntax`. Moving it to `linkedin-context.ts` with a re-export removes even that.

N059's shared module is knip-safe. The N012 dead-export class is "export with no cross-module importer", not "export". The shared UA constants have two importers (`fetch-threads.ts` and `linkedin-context.ts`), so knip sees them used. The traps that would re-introduce N012 are re-exporting the factory, exporting the production instance, or exporting a third constant nobody imports.

### The dead-export set and the knip gate (N041)

All nine symbols keep at least one internal reference, so the declaration stays alive and the emitted behavior is unchanged:

- `buildLegDeadAlarmText` (`src/email.ts:309`) — used at `:333` inside `sendLegDeadAlarm` (`:326-338`), which `scripts/fetch-linkedin.ts:37` imports and `:194` calls.
- `HEALTH_VERSION` (`src/judge-health.ts:39`) — read at `:142`, `:144`, `:154`, `:269`, `:338`, `:361`.
- `LINKEDIN_FETCH_CONCURRENCY` (`src/linkedin-fetch.ts:69`) — used at `:833`.
- `LEG_DEAD` (`:208`) — used at `:221`, `:228`.
- `ALL_SURFACES_FAULTED` (`:234`) — used at `:246`, `:255`.
- `HALT` (`:265`) — used at `:275`, `:281`.
- `PlatformFlags` (`src/config-file.ts:40`) — used at `:54`, `:249`.
- `LegStatus` (`src/linkedin-payload.ts:47`) — used at `:51`, `:60`.
- `LinkedInStorageCookie` (`src/linkedin-session.ts:159`) — used at `:174`.

`makeLinkedInContextFactory` (`src/linkedin-fetch.ts:340`) is the carve-out: at HEAD its only reference is `:409`, so it is exactly the knip class today. The carve-out is valid only if the split lands first, which the FRD orders correctly.

The gate does not exist. `package.json:9-23` has no `knip` script; `package.json:33-40` lists six devDependencies and knip is not one; `package-lock.json` has no knip entry; `node_modules/.bin` has no binary; there is no config file. `ci.yml` runs exactly three steps (Typecheck `:26-27`, Lint `:29-30`, Test `:32-33`). The documented gate is three (`AGENTS.md:172-174`, `.rpiv/guidance/architecture.md:53`, `.rpiv/guidance/src/architecture.md:178`).

`npx knip` in CI would fetch `latest` on every push, with no integrity hash, no `npm audit` coverage, and a possible non-TTY "Ok to proceed?" prompt. The repo's existing `npx` calls (`watch.yml:95`, `:187`, `:200`) all resolve tools that are in the lockfile. This would be the first that is not.

Entry discovery without a config rides npm scripts: `src/index.ts` via `start`, the seven `tsx scripts/*.ts` run scripts, `scripts/probe-judge.ts` only through the `lint` script's argument list, and `tests/*.test.ts` via the test glob. The gate's coverage of the ninth script is an accident of the lint list.

The existing three gates cannot substitute: `tsc --noEmit` runs with `noEmit` and no `noUnusedLocals`; Biome is per-file with no cross-module reachability; `npm test` imports none of the nine.

### The doc layers (N044, N045)

Six layers, not three. The audit cites `AGENTS.md`, `.rpiv/guidance/src/architecture.md`, and `.rpiv/guidance/scripts/architecture.md`; it misses `.rpiv/guidance/tests/architecture.md`, `.rpiv/guidance/architecture.md`, and `README.md`.

`AGENTS.md` needs two edits. The lint list at `:30` omits `scripts/replay-linkedin.ts` while `package.json:13` includes it (the audit's `:16` is wrong — that line is `watch-linkedin`). The architecture bullet list runs `:69-154` (the audit's `:44-110` is wrong) and omits `src/judge-availability.ts`, `src/linkedin-behavior.ts`, `src/linkedin-capture.ts`, `scripts/replay-linkedin.ts`, and `scripts/reset-linkedin.ts` — though `reset-linkedin` already appears in the lint list at `:30`, so "no doc layer" is imprecise for that one.

`.rpiv/guidance/src/architecture.md` needs the three `src` modules named. The glob at `:21` (`linkedin-*.ts`) already name-covers `linkedin-behavior`, `linkedin-capture`, and the split's two new modules, but the parenthetical `(parser/session/fetch/payload)` does not. `judge-availability.ts` is in no group. The judge role comment at `:22` (`dispatchLlmCall + wrappers`) is what the split falsifies. The `linkedin-fetch.ts` block at `:122-148` attributes the factory and the walk to one file. The boundaries line at `:167` says FOUR `state/` writers; N049 makes it six.

`.rpiv/guidance/scripts/architecture.md:4` opens "Nine files" and enumerates 6 `.ts` + 1 `.sh` + 2 hooks. The tree holds 8 `.ts` + 1 `.sh` + 2 hooks. Adding replay and reset to the enumeration yields eleven; changing only the numeral leaves the block enumerating nine. The Structure block at `:13-67` needs two entries, the Invokers at `:6-11` needs two, and the exit-code table at `:94-114` needs two rows. The "zero-edit site of judge.ts's API" phrase at `:4` is stale after the split.

The split's four new modules must be documented in the same pass. The FRD orders the splits at requirements 4-5 and the doc sync at 9, so the docs are written against the post-split tree; and the lines the sync must touch are exactly the lines the split falsifies. Deferring them guarantees a run-7 finding for six to ten lines of work.

The acceptance criterion has blind spots. It greps for five module names across three files; it does not require `replay-linkedin` in either guidance file, it forces `judge-availability` into `guidance/scripts` where the module has no role, and it forces `reset-linkedin` into `guidance/src` where the script has no role. It does not check the "Eleven files" string, the two new Structure entries, the split's four modules, the tests coverage map, the top-level guidance, or README. It can pass while `guidance/src:22` still says `judge.ts = dispatchLlmCall + wrappers`.

### The flag writes and the dead ignores (N049, N056)

`stateTempPath` (`src/state.ts:237-240`) mints `.{ms}.{random}.tmp`. The canonical shape is `writePayloadAtomic` (`src/linkedin-payload.ts:111-139`): mkdir, write temp, rename, and on failure unlink the temp and rethrow naming the target. The same shape is in `writeStateAtomic`, `writeCeilingsAtomic`, `writeHealthAtomic`, and `makeFsCaptureSink`. `AGENTS.md:160` and `.rpiv/guidance/scripts/architecture.md:154` both already require it, so N049 is code catching up to two existing rules.

The two bare writes are `handleLegDeadEpisode`'s marker at `scripts/fetch-linkedin.ts:183-187` and `tripLatch`'s latch at `:232-236`. Both are guarded by readability-only probes — `markerExists` (`:159-166`) and `latchPresent` (`:216-223`) — that `readFile` and treat any success as present, so a zero-byte file counts.

The two flags move in opposite directions. The marker currently fails toward a suppressed alarm (a truncated marker suppresses the next dead tick, and the marker is written before the alarm at `:183` vs `:189-200`); atomic flips it to a duplicate alarm, the safe direction. The latch currently fails closed (a truncated latch still blocks the preflight at `:357-362`); atomic flips it to fail-open for exactly one tick, then the walk re-navigates, re-throws `HaltError`, re-trips, and re-alarms. The audit's blanket "the failure direction is safe" is correct only for the latch.

The first-write-wins check at `:231` must not move inside the rename window. `rename(2)` is atomic but "check absent then rename" is two syscalls; Node exposes no `RENAME_NOREPLACE`, and `writeFile(path, data, { flag: "wx" })` gives first-write-wins without content atomicity. The check is a policy read, not a lock: the loop is strictly sequential (`scripts/watch-linkedin.ts:79-96`) and `tripLatch` is called from one place (`:415`). Moving it inside would create a new temp-leak path.

The temp-file wedge is the connection the audit does not make. `stateTempPath(dirname(marker))` and `stateTempPath(dirname(latch))` both resolve to `state/` (`DEFAULT_MARKER` at `:150`, `DEFAULT_LATCH` at `:157`, `LINKEDIN_PAYLOAD_PATH = "state/linkedin-posts.json"` at `src/config.ts:59`). `.gitignore` has no temp rule — the only `tmp` entry is `.rpiv/tmp/` at `:5`. A crash between temp write and rename leaves `state/.*.tmp` untracked-and-unignored, and `guardCheckout` (`:264-283`) throws on any non-empty `git status --porcelain` (`:275-283`). The loop warns every 28-33 minutes (`scripts/watch-linkedin.ts:83-88`) and never fetches again. `npm run reset-linkedin` does not clear it.

N056 verification: `state/linkedin-get-budget.json` exists on disk, 47 bytes, `{"localDate": "2026-11-10", "count": 11}`, untracked (ignored at `.gitignore:12`). The actual `.gitignore` lines are `:7` `slice*-recon/`, `:12` `state/linkedin-get-budget.json`, `:14` `outputs/.drafts/`, `:15` `outputs/.plans/`; the file has 15 lines, so the audit's `:16` does not exist.

`slice*-recon/` is not dead in the same sense as the two `outputs/` rules. It is the design-gate recon ignore, added in run #1 and used as recently as the 2026-11-13 pairing design (`slice3-recon/`, `slice4-recon/`). Removing it re-exposes the next recon dir as untracked, which dirties the dev repo and would fail the next audit's clean-tree precondition. `outputs/.drafts/` and `outputs/.plans/` are genuinely dead; no `outputs/` dir exists.

The operator-clone wedge is the more dangerous N056 connection. The dev repo's `rm` does not delete the file in the dedicated PC clone, where the old budget machine wrote it. Pulling the N056 commit removes the ignore rule but leaves the file; the next tick's `guardCheckout` sees `?? state/linkedin-get-budget.json` and throws on every tick until the operator deletes it by hand. `README.md:334` currently says "delete it or ignore it"; after N056, "ignore it" is no longer possible.

## Code References

- `src/linkedin-fetch.ts:487-780` — `walkLinkedInSurface`; the listener, the streak, the round loop, the drain, the return
- `src/linkedin-fetch.ts:503-504` — `seenStreak` / `lastSeenId` declarations
- `src/linkedin-fetch.ts:514` — `page.on("response", …)` attach
- `src/linkedin-fetch.ts:560-574` — the matched IIFE, the await, the streak mutation
- `src/linkedin-fetch.ts:553-555`, `:607-609` — the two bare catches
- `src/linkedin-fetch.ts:659`, `:663-666`, `:733-736`, `:754`, `:758` — the cap check, the two streak reads, the drain, the return
- `src/linkedin-fetch.ts:110` — `LINKEDIN_MAX_POSTS = 150`
- `src/linkedin-fetch.ts:208-282` — the three tagged-error families
- `src/linkedin-fetch.ts:305-409` — `LinkedInContextFactory`, the UA constants, `makeLinkedInContextFactory`, `LINKEDIN_PROFILE_DIR`, `linkedinChromiumContextFactory`
- `src/linkedin-fetch.ts:792-802` — the ten-parameter signature
- `src/linkedin-fetch.ts:833`, `:841`, `:843`, `:863-896` — pool width, pacing gate, walk call, the join
- `src/judge.ts:79`, `:82`, `:94`, `:101`, `:103`, `:122`, `:126`, `:131`, `:134`, `:188`, `:194` — `REQUEST_TIMEOUT_MS`, `BATCH_SIZE`, `FALLBACK_CALL_BUDGET`, `RETRYABLE_STATUSES`, `RETRY_DELAYS_MS`, `WAIT_BUDGET_MS`, `sleep`, `SleepFn`, `LlmAccount`, `JudgedPost`, `JudgeBatchResult`
- `src/judge.ts:219`, `:233`, `:248`, `:276`, `:300`, `:310`, `:325`, `:341`, `:353`, `:371`, `:391`, `:413` — `normalizeEndpoint`, the three prompt builders, `BatchOutcome`, the four dispatch types, `terminalFailureReason`, `allAvailabilityBlocked`, `exhaustionRecord`
- `src/judge.ts:474-692` — `dispatchLlmCall`
- `src/judge.ts:693`, `:795`, `:904` — `judgeBatch`, `judgePost`, `judgePosts`
- `src/judge-availability.ts:21-24`, `:27`, `:115`, `:133` — the runtime import and its documented contract
- `src/linkedin-capture.ts:31`, `:46`, `:138-181`, `:194-207` — schema version, retention, the sink, `captureOnce`
- `src/linkedin-payload.ts:65`, `:111-139`, `:143-212` — the URN regex, `writePayloadAtomic`, `readPayloadPosts`
- `src/linkedin-parser.ts:79-80` — the 10+ digit floor
- `src/state.ts:237-240` — `stateTempPath`
- `scripts/fetch-linkedin.ts:87-140` — `FetchTickDeps`
- `scripts/fetch-linkedin.ts:159-166`, `:183-187`, `:216-223`, `:232-236` — the probes and the two bare writes
- `scripts/fetch-linkedin.ts:264-283` — `guardCheckout`
- `scripts/fetch-linkedin.ts:398-410`, `:414-438` — the call expression and the three catch arms
- `scripts/probe-linkedin.ts:175-186` — the probe call site
- `tests/linkedin-fetch.test.ts:204`, `:252`, `:261`, `:523-525`, `:1158-1193`, `:1302-1347` — the double, the cap pin, the warn-once pin, the re-served-id pin
- `tests/fetch-linkedin.test.ts:526-556` — the defb8af pin N050 reverses
- `tests/linkedin-capture.test.ts:92-93` — the round-trip and newline pins
- `package.json:13`, `:33-40` — the lint list, the devDependencies
- `.github/workflows/ci.yml:26-33` — the three gate steps
- `.gitignore:5`, `:7`, `:12`, `:14`, `:15` — the temp entry and the four stale rules

## Integration Points

### Inbound References

- `src/index.ts:39` — imports `checkJudgeAvailability` from `judge-availability.js`; the only importer
- `src/index.ts:51-57` — imports `type JudgedPost`, `type LlmAccount`, `judgePosts`, `resolveJudgeConfig`, `sleep` from `judge.js`; `sleep` retargets to `./judge-dispatch.js`
- `src/index.ts:58` — imports `type LinkedinSurface` from `linkedin-fetch.js`
- `src/index.ts:59` — imports `type PayloadRead` from `linkedin-payload.js`
- `src/index.ts:300-305`, `:377`, `:390`, `:486` — the payload read, the leg rider, the heartbeat call sites
- `src/fetch-threads.ts:31` — imports `sleep` from `judge.js`; retargets to `./judge-dispatch.js`
- `src/judge-availability.ts:27` — runtime-imports `normalizeEndpoint` and `terminalFailureReason` from `judge.js`
- `src/judge-rotation.ts:40` — type-only `LlmAccount` from `judge.js`; `type SleepFn` retargets to `./judge-dispatch.js`
- `src/judge-health.ts:34`, `src/judge-ceilings.ts:28` — type-only `LlmAccount`
- `src/email.ts:11`, `src/heartbeat.ts:3` — `type LegLine`
- `scripts/fetch-linkedin.ts:37-52` — `sendLegDeadAlarm`, `linkedin-behavior`, `linkedin-capture`, `LINKEDIN_PROFILE_DIR`, `LinkedInContextFactory`, `LinkedinSurface`, `fetchLinkedInPosts`, the three guards, `readSeenIdSet`
- `scripts/probe-linkedin.ts:36-45` — the same set minus `sendLegDeadAlarm`
- `scripts/watch-linkedin.ts:19-20` — `linkedin-behavior`, `type SleepFn`, `isLegDead`
- `scripts/replay-linkedin.ts:52` — `linkedin-capture`
- `scripts/probe-judge.ts:46`, `:247` — `buildBulkMessages`, `resolveJudgeConfig`
- `tests/linkedin-fetch.test.ts:33-43` — `LinkedinSurface`, `PACE_MAX_MS`, `PACE_MIN_MS`, the three error factories, the three guards, `fetchLinkedInPosts`
- `tests/fetch-linkedin.test.ts:35` — `LinkedInContextFactory`, `SCROLL_JS`, `isLegDead`
- `tests/probe-linkedin.test.ts:30-35` — `LINKEDIN_PROFILE_DIR`, `LinkedInContextFactory`, the three guards
- `tests/watch-linkedin.test.ts:16` — `legDead`
- `tests/judge.test.ts:9-15` — `LlmAccount`, `buildBulkMessages`, `judgePost`, `judgePosts`, `parseLlmAccounts`, `resolveJudgeConfig`

### Outbound Dependencies

- `src/linkedin-fetch.ts` → `pool.js`, `linkedin-parser.js`, `linkedin-capture.js`, `linkedin-behavior.js`, `config-file.js`, `types.js`, and a dynamic `await import("playwright")` at `:342`
- `src/judge.ts` → `judge-dispatch.js` (`judgeBatch`, `judgePost`, `exhaustionRecord`, `sleep`, `SleepFn`, `BatchOutcome`), `judge-prompts.js` (`buildBulkMessages`, re-exported), `judge-rotation.js` (`RotationState`, `isRotationExhausted`, `rotationExhausted`), `judge-health.js` (`HARD_FAIL_TICKS_TO_CAP`, `TickOutcomes`, `readTickOutcomes`), `pool.js`
- `src/judge-dispatch.ts` → `judge-rotation.js` (nine names: `pickEligibleAccount`, `hasOutstandingRelease`, `waitCeilingSlot`, `earliestCooldown`, `parkUntilEligible`, `claimAccount`, `coolAccount`, `releaseAccount`, `RotationState`), `judge-health.js` (`stampFailure`, `stampSuccess`, `HARD_FAIL_TICKS_TO_CAP`, `buildFailuresFromLedger`, `TickOutcomes`), `judge-parse.js` (`parseBulkVerdicts`, `parseVerdict`), `judge-prompts.js` (`buildMessages`, `buildBulkMessages`), `types.js` (`type AccountFailure`), `judge.js` (type-only `LlmAccount`)
- `src/linkedin-capture.ts` → `config.js` (`LINKEDIN_CAPTURES_ROOT`), `state.js` (`stateTempPath`)
- `src/linkedin-payload.ts` → `config.js` (`LINKEDIN_PAYLOAD_PATH`), `state.js`, `config-file.js`, `types.js`
- `scripts/fetch-linkedin.ts` → `env-file.js`, `linkedin-behavior.js`, `linkedin-capture.js`, `linkedin-fetch.js`, `linkedin-payload.js`, `linkedin-session.js`, `state.js`, `email.js`, `config-file.js`

### Infrastructure Wiring

- `.github/workflows/ci.yml:26-33` — the three gate steps; a knip step joins after Test
- `.github/workflows/watch.yml:95`, `:187`, `:200` — the three `npx` calls, all resolving lockfile tools
- `package.json:13` — the lint list; `:33-40` — devDependencies
- `tsconfig.json` — includes `src`, `tests`, `scripts`; `noEmit`, no `noUnusedLocals`
- `.gitignore:5`, `:7`, `:12`, `:14`, `:15` — the temp entry and the four stale rules
- `src/config.ts:59`, `:73` — `LINKEDIN_PAYLOAD_PATH`, `LINKEDIN_CAPTURES_ROOT`
- `src/config.ts:14-20` — `ENV_NAMES`; `LINKEDIN_CAPTURE` and `LINKEDIN_PROFILE_DIR` never enter it

## Architecture Insights

**Usage-based module boundaries beat location-based ones.** The FRD's shorthand ("factory + errors", "walk") does not survive contact with the code. The pacing gate reads like walk code but is orchestration-side; the tagged errors read like walk code but both halves import them; `LINKEDIN_DEFAULT_SCROLL_ROUNDS` sits in the walk's tuning block but is used only as a default parameter in the orchestration. The boundary that holds is "a symbol moves with the function that uses it".

**The repo's cycle doctrine is type-only back-edges plus one-way runtime flow.** `judge-rotation.ts:38-40` documents it: `verbatimModuleSyntax` erases type imports, so a LEAF module can name a FUNNEL module's types without a runtime cycle. `judge-dispatch.ts` becomes the fourth module to use the idiom. The one thing the doctrine forbids is a runtime back-edge, which is exactly what leaving `normalizeEndpoint`/`terminalFailureReason` in `judge.ts` would create — and, under the widened scope, what leaving `sleep` in `judge.ts` would create, because `judgePost` defaults `sleepFn: SleepFn = sleep`.

**Re-exports are load-bearing or dead, never neutral.** `linkedin-fetch.ts` must re-export eight symbols because three scripts and four test files import them from that specifier. It must not re-export the factory or the UA constants, because nothing imports them from there — that is the N012 class. The line between the two is "does a real importer exist from this module".

**The offline suite's blind spot is scheduling, not coverage.** `4983bc1` shipped N046/N047/N048 with 33/33 walk tests and "Deviations: None". The double resolves bodies in fire order because `text` returns already-resolved promises and microtasks run FIFO. A test that cannot express out-of-order completion cannot catch an ordering bug, no matter how many assertions it carries.

**`guardCheckout` turns every untracked file in `state/` into a permanent wedge.** The preflight throws on any non-empty `git status --porcelain`. That is the right strictness for a dedicated clone, but it means every new `state/` writer must either be gitignored or be guaranteed to clean up after itself. N049's temp files and N056's budget file are both violations of that invariant, and neither is visible from the requirement text.

**Doc sync ordering is a correctness property, not a style choice.** Five later requirements falsify doc lines the sync would write. The repo's own history is the evidence: `1a61bf9` touched guidance files and still shipped five doc-drift findings because the second pass never happened.

## Precedents & Lessons

7 similar past changes analyzed.

### Precedent: Run #5 zero-findings pass — the same judge split, executed and validated, never merged
**Commit(s)**: `f1812b4` — "N020: unexport knip's 12 dead exports (phase 1/9)" (2026-11-10) through `b9e7d71` — "N018-N029: tech-debt zero-findings validation record" (2026-11-10), on branch `ukind/fix-tech-debt`; tip `a9834a8`
**Blast radius**: 22 files across 6 layers, ~1080 insertions / ~1008 deletions
  src/ — `judge-dispatch.ts` NEW (695 LOC), `judge.ts` 1092→405, `email.ts` +42, `index.ts` +56, `linkedin-payload.ts` +12, `linkedin-fetch.ts` +28
  scripts/ — `probe-judge.ts`, `setup-curl-impersonate.ts`
  tests/ — `judge.test.ts` 192 lines, `judge-rotation.test.ts` 123, `judge-health.test.ts` +44, `email.test.ts` +19
  docs/ — `AGENTS.md` +12, `README.md` +8, `.rpiv/guidance/src/architecture.md` +8, `.rpiv/guidance/tests/architecture.md` +3

**Follow-up fixes**: none — the branch was never merged. `git merge-base --is-ancestor f1812b4 main` is false; main moved 463 commits ahead. The run-6 audit at `df890a9` re-reports N005 as N042 and the dead-export class as N041.

**Lessons from docs**:
- `.rpiv/artifacts/plans/2026-11-10_06-56-47_tech-debt-zero-findings-execution.md` (branch-only) — D1: the full extract must move `dispatchLlmCall`, `judgeBatch`, `judgePost`, `exhaustionRecord`, the builders, `normalizeEndpoint`, `terminalFailureReason`, the three constants, and the core types; "any runtime edge back closes the forbidden cycle". D3: "Test imports re-point, no passthrough". D6: "the f14d9f9→2338274 lesson forbids conflating a verbatim move with a logic edit". D7: "No knip gate in CI and no knip config file".
- `.rpiv/artifacts/validation/2026-11-10_09-22-22_tech-debt-zero-findings-execution.md` (branch-only) — verdict pass: 540/540 tests, knip 0/0, `judge.ts` 405 lines, byte-verbatim move proofs.

**Takeaway**: the split is proven feasible and behavior-neutral; the risk is landing it, not writing it — and the run-6 scope widens to the run-5 D1 set to reach the target.

### Precedent: Run #1 judge split — the one that landed, and the target it missed
**Commit(s)**: `f14d9f9` — "refactor: split the judge into pool, rotation, and parse modules" (2026-10-30)
**Blast radius**: 15 files, 1791 insertions / 1250 deletions
  src/ — `judge-rotation.ts` NEW (167), `judge-parse.ts` NEW (102), `pool.ts` +52, `judge.ts` 921→828
  tests/ — `judge-rotation.test.ts` NEW (619), `judge-parse.test.ts` NEW (89), `judge-helpers.ts` NEW (46), `judge.test.ts` −760

**Follow-up fixes**:
- `2338274` — "judge: park rewound dispatchers on the free release queue while a release is outstanding" (2026-11-09) — the dispatch region later produced the 2026-11-07..09 outage: three parks spent the whole 180s budget and the rest converted to exhaustion while healthy seats held capacity. Introduced by `522395a`, but it lives in the region the split moved.
- Validation `2026-10-30_17-55-57` — BLOCKING: "Desired End State `wc -l src/judge.ts # under ~500` reads 828 … unachievable as written". Retired as an accepted goal deviation.

**Lessons from docs**:
- `.rpiv/artifacts/research/2026-10-29_12-15-34_tech-debt-audit-remediation.md:217-221` — "judge.ts changes historically needed same-day fixes; the last seam 'generalization' landed as 4 copies — this time extract once, migrate mechanically, let the 63 existing tests pin behavior before moving imports."
- `.rpiv/artifacts/plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md:2930` — "The docs re-sync to the split module layout after the refactor lands — the 1a61bf9 precedent lesson."

**Takeaway**: re-pin the LOC target to a measurement before committing to it; the dispatch region is the repo's highest-risk area and the split must be byte-verbatim with the `2338274` pins surviving.

### Precedent: Run #2/#3/#4 dead-export sweeps — the class that recurred four times
**Commit(s)**: `ced76f8` — "refactor: unexport four internal symbols" (2026-10-31); `8f2debd` — "refactor: unexport the PageMouseLike interface" (2026-11-01); `f1812b4` — "N020: unexport knip's 12 dead exports" (2026-11-10, unmerged)
**Blast radius**: 4 files / 4 lines; 1 file / 1 line; 6 files / 12 symbols

**Follow-up fixes**: none — the class recurred as N012 (run #4) and N041 (run #6).

**Lessons from docs**:
- `.rpiv/artifacts/plans/2026-10-31_09-44-40_tech-debt-run2-remediation.md:71` — "No knip config — four keyword deletions beat new tooling."
- `.rpiv/artifacts/plans/2026-11-01_13-44-37_tech-debt-run3-clean-baseline.md:102` — "knip stays ad-hoc (not added to CI)".
- `.rpiv/artifacts/plans/2026-11-03_08-38-22_tech-debt-run4-remediation-execution.md:80` — "A knip CI gate — knip stays an ad hoc acceptance run."
- `.rpiv/artifacts/plans/2026-10-31_09-44-40_tech-debt-run2-remediation.md:43` — "A `typeof` type-operand use survives unexport (run-2 lesson)" — none of the nine has one.

**Takeaway**: the gate was declined four times and the class recurred four times; run #6 adds it, and the run-2 "no new tooling" decision is overturned deliberately rather than silently.

### Precedent: Doc syncs — the repo's most recurring failure mode
**Commit(s)**: `1a61bf9` (2026-10-28); `732a082` (2026-10-31); `31dfe17` (2026-11-01); `7dcaeb3` (2026-11-10, unmerged); `ed13452` (2026-11-03); `a88494e` (2026-11-11)
**Blast radius**: 5-7 doc surfaces each

**Follow-up fixes**:
- `1a61bf9` touched guidance docs yet left `AGENTS.md`/`README` untouched; `.rpiv/guidance/src/architecture.md:65-78` still documented the deleted `rotateOnRateLimit` API.
- Run #6 audit N044/N045: five modules appear in no doc layer; `AGENTS.md:30` omits `scripts/replay-linkedin.ts` (added to `package.json:13` by `14ccec5`, which touched no doc file).

**Lessons from docs**:
- `.rpiv/artifacts/research/2026-10-29_12-15-34_tech-debt-audit-remediation.md:198` — "Docs sync must end with a grep-verified pass — precedent 1a61bf9 updated guidance files and STILL shipped 5 doc-drift findings."
- `.rpiv/artifacts/plans/2026-11-10_06-56-47_tech-debt-zero-findings-execution.md` D10 — "Docs sync last, all surfaces in one phase … the run-4 house style."

**Takeaway**: end with a grep-verified pass over ALL six surfaces; the drift recurs because feature commits skip docs and the next audit finds it.

### Precedent: CI gate additions — first-land failures
**Commit(s)**: `510ff2a` (2026-10-30); `b779ff7` (2026-11-01); `42b8cf8` (2026-11-09)
**Blast radius**: `.github/workflows/watch.yml` + `scripts/commit-state-rebase.sh` + `tests/commit-state-rebase.test.ts` (342 lines); `tests/setup-curl-impersonate.test.ts` +6

**Follow-up fixes**:
- `42b8cf8` — the `runSetupCurl` suite died on ubuntu-latest: "the script's platform gate fires before the code under test, so six win32-path tests inherited the runner's platform". First Linux evidence: run 42543345173 (478 pass / 6 fail).
- `7cc7250` — "drop JUDGE_CONCURRENCY to the probe reading of 4" (+14 min); `1c8a68c` (+17 min).

**Lessons from docs**:
- `.rpiv/artifacts/research/2026-10-29_12-15-34_tech-debt-audit-remediation.md:210-215` — "any watch.yml value touching concurrency/budget/gating was wrong on first land twice — budget a live-dispatch validation with a same-day fix window."

**Takeaway**: CI changes broke on first land; the knip step is a new CI gate with no in-repo precedent — pin the version and budget a first-run fix window.

### Precedent: Atomic-write conversions — the idiom exists
**Commit(s)**: `93a3f38` (2026-10-27) introduced `stateTempPath`; `writePayloadAtomic`, `writeCeilingsAtomic`, `writeHealthAtomic`, `makeFsCaptureSink`, `login-linkedin.ts:101` all use it
**Blast radius**: 1 file per conversion

**Follow-up fixes**: none — the idiom is stable.

**Lessons from docs**:
- `src/state.ts:237-240` — "Two calls with the same clock still differ — the 20478d1 bug shipped ONE literal temp name shared by every write."
- `src/linkedin-capture.ts:128` — "stateTempPath + rename, the writePayloadAtomic shape."

**Takeaway**: N049 is a mechanical conversion with a proven idiom; the traps are the readability-only probes and the untracked temp files.

### Precedent: LinkedIn walk logic — the seen-stop that passed validation but had a race
**Commit(s)**: `4983bc1` — "linkedin: stop the scroll after 3 consecutive seen posts" (2026-11-13)
**Blast radius**: 6 files, 391 insertions
  `src/linkedin-fetch.ts` +65, `src/state.ts` +43, `scripts/fetch-linkedin.ts` +17, `tests/linkedin-fetch.test.ts` +176, `tests/fetch-linkedin.test.ts` +54, `tests/state.test.ts` +46

**Follow-up fixes**: none yet — the run-6 audit found N046, N047, N048.

**Lessons from docs**:
- `.rpiv/artifacts/validation/2026-11-13_13-40-20_linkedin-seen-stop-scroll.md` — verdict pass, 33/33 walk tests, "Deviations from Plan: None." The suite drives bodies sequentially, so it cannot catch the race.

**Takeaway**: the suite's sequential bodies are the blind spot; the reversed-completion-order test is the only shape that catches it, and the fold must land before the loop's reads.

### Precedent: Capture harness — the debt was documented but not bounded
**Commit(s)**: `14ccec5` — "linkedin: add capture/replay harness for raw bodies" (2026-11-13); `6d44b70` — "linkedin: correct capture retention figures to the measured session" (2026-11-13)

[Showing lines 1-402 of 416 (50.0KB limit). Use offset=403 to continue.]