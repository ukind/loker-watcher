---
date: 2026-11-19T12:14:03+0700
author: Yogiswara Utama
commit: 7087c44
branch: ukind/fix-techdebt-2
repository: fix-techdebt-2
topic: "tech-debt full-ledger remediation (N065-N092): type homes, facades, probe ramp, test doubles, doc pass"
tags: [research, codebase, tech-debt, judge, linkedin, tests, docs, state-policy]
status: ready
last_updated: 2026-11-19T12:14:03+0700
last_updated_by: Yogiswara Utama
---

# Research: Tech-debt full-ledger remediation (N065-N092)

## Research Question

Execute every open finding from `.rpiv/artifacts/TECH_DEBT_AUDIT.md` run #8 (N065-N092) as one PR on `ukind/fix-techdebt-2`: green the red test suite, warn on the live wake-band/freshness crossing, close the type-cycle homes and both REMOVAL NOTE facades, extract the index.ts pure helpers and the probe ramp, consolidate the judge test doubles, add the missing probe-judge guard and coverage suites, and run the enumerated doc pass. This document is the verified codebase state for that execution — every FRD anchor re-checked at `7087c44`, with drift corrections and four developer decisions recorded.

## Summary

All 24 findings are executable as written, with three corrections to the FRD's plan and four developer decisions that change implementation shape. The type moves are a 19-importer re-point (14 `LlmAccount` + 5 `LinkedinSurface`) that zeroes madge only if `src/judge.ts` re-exports nothing afterward (knip flags orphaned re-exports). The facade execution is a per-file symbol split, not a whole-file re-point: `tests/linkedin-fetch.test.ts` moves **six** facade symbols (the FRD listed five — it missed `allSurfacesFaulted`, used at `tests/linkedin-fetch.test.ts:1179`). The probe ramp extraction needs a `fetchFn` parameter (today's `timed` closes over global fetch) but no sleep seam — nothing in the ramp path sleeps. The test-double consolidation is larger than the FRD states: **39** casts in `tests/judge.test.ts` (not 38) and **21** sleep-double sites across the two judge suites (not 17). The N075 extraction must keep `mergeSurfaceStamps` module-private or knip fails — the FRD's "export both now-private helpers" is one export too many. N072's literal fix (drop `shell: true`) breaks the hook on every supported Node: `npx` is `npx.cmd` and Node >= 22 rejects `.cmd` targets without a shell (EINVAL, CVE-2024-27980); the developer chose the node+JS-launcher replacement. N091's warning lands at the loop start, not inside the IO-free resolver. The doc pass is 17 edits, and the "first configured surface" claim lives at 5 doc sites plus 3 code/test sites — the developer chose the full sweep.

## Detailed Findings

### Type homes (N092) — the 19-importer re-point

- `LlmAccount` is defined at `src/judge.ts:70-74` (`{baseUrl, apiKey, model}`); `LinkedinSurface` at `src/linkedin-fetch.ts:70` as `Extract<Surface, { type: "linkedin" }>`. Target homes: a new zero-runtime-import leaf (e.g. `src/judge-account.ts`) and `src/config-file.ts:16-19` beside `Surface`.
- The D6 cycle proof is live: `src/judge-shared.ts:13` runtime-imports `HARD_FAIL_TICKS_TO_CAP, buildFailuresFromLedger` from `./judge-health.js`, and `src/judge-health.ts:34` type-imports `LlmAccount` from `./judge.js`. The audit's proposed `judge-shared.ts` home recreates `judge-shared -> judge-health -> judge -> judge-shared`; only a leaf zeroes madge.
- `LinkedinSurface`'s move severs the last LinkedIn-side type cycle: `src/linkedin-fetch.ts:42` (runtime -> `./linkedin-walk.js`) + `src/linkedin-walk.ts:27` (type -> `./linkedin-fetch.js`).
- **knip constraint:** no `knip.json` exists; entries derive from npm scripts. A re-export shim on the old path (`export type { LlmAccount } from "./judge-account.js"` in `judge.ts`) with zero importers is flagged as an unused export — the N061 failure mode. `judge.ts` must re-export nothing; after N067+N092 its export surface is only natives (`parseLlmAccounts` `:82`, `resolveJudgeConfig` `:139`, `judgePosts` `:182`, `JudgedPost` `:122`).
- Six stale comment sites die with the move: `src/judge-dispatch.ts:20-23` (module-header cycle doctrine), `src/judge-dispatch.ts:49-52` ("LlmAccount stays in judge.ts"), `src/judge-rotation.ts:37-40` (the idiom reference the other files cite), `src/linkedin-walk.ts:23-26` ("Moving LinkedinSurface to linkedin-context.ts..."), plus two pre-existing line-number rots (`src/judge-ceilings.ts:13` and `src/judge-health.ts:102` cite `src/judge.ts:163-172` for `parseLlmAccounts`, which actually sits at `:82`).

### Facade execution (N067) — per-file symbol split

- Judge block: `src/judge.ts:25-36` (comment `:25-34`, REMOVAL NOTE `:31-34`, exports `:35` `buildBulkMessages` from `./judge-prompts.js` and `:36` `judgePost` re-exported from the `judge-dispatch.js` native imported at `:17`).
- Linkedin-fetch block: `src/linkedin-fetch.ts:46-68` (comment `:46-58`, exports `:59-67` the seven `linkedin-context.js` symbols, `:68` `SCROLL_JS` from `./linkedin-walk-static.js`).
- **Correction:** `tests/linkedin-fetch.test.ts:32-45` moves **six** facade symbols — `allSurfacesFaulted` `:37`, `halt` `:39`, `isAllSurfacesFaulted` `:40`, `isHalt` `:41`, `isLegDead` `:42`, `legDead` `:43` — and keeps natives `LINKEDIN_PROFILE_DIR` `:33`, `LinkedinSurface` `:34` (moves to `config-file.js` under N092), `PACE_MAX_MS` `:35`, `PACE_MIN_MS` `:36`, `fetchLinkedInPosts` `:38`, `resolveLinkedInProfileDir` `:44`. The FRD's five-symbol list omitted `allSurfacesFaulted` (used at `:1179`).
- `scripts/login-linkedin.ts:29` and `scripts/reset-linkedin.ts:28` import only the native `resolveLinkedInProfileDir` — both survive untouched. The facade comment's consumer list (`src/linkedin-fetch.ts:48-51`) is stale: it names `src/index.ts`, which imports only the native `LinkedinSurface` at `:52`.
- `SCROLL_JS`'s only facade consumer is the N076 describe (`tests/fetch-linkedin.test.ts:1048-1068`), so the re-export removal and its last consumer die in the same commit set (FR-22 ordering).

### Probe cluster (N065 + N080)

- Success gate: `scripts/probe-judge.ts:122` `const ok = body.includes("{")`; the refusal arm at `:116-119` already classifies non-2xx as data. The fix (JSON parse + required `"choices"` key) slots into `:122-127` and composes with `classifyDead` (`:224-238`).
- Ramp spans: `rampLevel` `:138-154`, `RAMP_MAX = 32` `:161`, `findConcurrencyCeiling` `:172-194` — **correction:** the floor return is `:190` (`level / 2`) and the full-clean return is `:193` (`RAMP_MAX`); the FRD had these swapped.
- Entry guard: `scripts/probe-judge.ts:50` awaits `loadWatcherConfig()` at module top level and `:340` is a bare `await main()`. The file has zero `node:url` imports, so the guard needs both the import and the guarded block. Seven siblings carry the idiom (`scripts/fetch-linkedin.ts:486`, `scripts/watch-linkedin.ts:148`, `scripts/probe-linkedin.ts:251`, `scripts/login-linkedin.ts:277`, `scripts/linkedin-chain.ts:131`, `scripts/replay-linkedin.ts:695`, `scripts/reset-linkedin.ts:101`, plus `src/index.ts:632`).
- Extraction interface: `timed` (`:104-135`) closes over global `fetch` at `:107-108`, so an offline ramp suite needs a `fetchFn` param. **No sleepFn is needed** — nothing in `timed`/`rampLevel`/`findConcurrencyCeiling` sleeps (`AbortSignal.timeout(120_000)` is harmless offline). Precedent: `src/judge-ceilings.ts:130` `writeCeilingsAtomic(entries, filePath = JUDGE_CEILINGS_PATH, now = Date.now)` — trailing-param injection, no DI object.
- Bonus de-duplication: `timed` hand-rolls the endpoint normalization at `:108`; `normalizeEndpoint` (`src/judge-shared.ts:17-19`) is exported for exactly this drift class.
- Ordering: N065 and N080 touch disjoint regions of the same file, but if the extraction absorbs the classifier, N065's fix site moves — land N065 before/with N080 (the FRD's cluster order already encodes this).
- Three audit-named suites: `runPool` (`src/pool.ts:33-52`, zero-import leaf — width clamp `:51`, single-sync-window claim `:41-44`, join-never-rejects `:51`); config (`isHeartbeatEnabled` `src/config.ts:37-41`, `runUrlFromEnv` `:47-55`); judge-exhaustion (`resolveBlockedPick` `src/judge-exhaustion.ts:29`, flavor split `:50-59`).

### Test-double consolidation (N078 / N079 / N077)

- **Cast census (corrected):** 39 `as unknown as typeof fetch` in `tests/judge.test.ts` (lines 167, 190, 213, 240, 263, 285, 310, 329, 347, 366, 383, 411, 450, 499, 530, 577, 593, 614, 633, 665, 694, 743, 757, 774, 799, 828, 855, 873, 889, 899, 911, 940, 963, 988, 1055, 1092, 1144, 1198, 1258) and 25 in `tests/judge-rotation.test.ts` (95, 121, 145, 162, 181, 193, 213, 231, 263, 289, 331, 366, 433, 457, 483, 500, 545, 578, 612, 657, 701, 733, 778, 993, 1059). The FRD's "38 + 25" is wrong by one; the audit's 39 is right. `tests/index.test.ts` has 10 more fetch casts — outside N078 scope.
- Six distinct double families across the suites: canned-status one-liners; call-counting closures; body/prompt-inspecting capture closures; auth/host-recorder pair factories (`accountTwoAnswering` `judge-rotation.test.ts:81-97`, `spreadAnswering` `:646-662`, `hostRecorder` `judge.test.ts:1044-1063`); concurrency trackers (`measuredFetch` `judge.test.ts:114-131`, `bulkMissThenAnswer` `:137-160`, rotation `:674-701`); parked/gated doubles (resolver-push `judge.test.ts:760-763`, gate-as-response rotation `:713-733` and `:1004-1059`).
- The factory's handler type must admit `Response | Promise<Response>` so parked-promise doubles stay legal; throwing doubles keep throwing inside the handler so the judge's transport-error catch sees them.
- **Sleep-double census (corrected):** 15 sites in `tests/judge-rotation.test.ts` (the FRD's list of 12 omitted `:307` `countingSleep`, `:994`, `:1036`) plus 6 in `tests/judge.test.ts` (`:912` zero-arg no-op, `:935`, `:976`, `:1109` inline, `:1160` inline, `:1243`) = 21. Recorders dominate (13); 5 recorders that also advance the test clock (rotation `:241`, `:267`, `:560` + advance-only `:292`, `:615`) stay local — they couple to each test's hand-stepped `now`.
- `freshState`: canonical is `tests/judge-rotation.test.ts:56-74` (comment `:52-55`, three-param signature, 11-field `RotationState`); the mirror to delete is `tests/judge.test.ts:18-39` (comment `:18-21`, function `:22-39` — the FRD's `:22-35` undershoots). 29 call sites in rotation, 10 in judge.test.ts — all 10 are 1-arg and migrate mechanically.
- Doctrine line spans `tests/judge-helpers.ts:4-5` (not just `:4`), and the same doctrine lives a second time in `.rpiv/guidance/tests/architecture.md` (Architectural Boundaries) with an already-stale "six fixtures" count vs seven exports — both copies must be rewritten or D7 spawns new drift.
- N077: the wall-clock case is `tests/judge-rotation.test.ts:386-404` (`started` `:389`, `elapsed` `:399`, bound `:403`) and injects **no sleep today** — arg 8 is omitted, so it rides the production default. The fix adds a recording sleep and asserts `deepEqual(sleeps, [])`, matching the suite's existing zero-sleep oracles (`:345`, `:741`, `:756`, `:1073`; `judge.test.ts:1105`, `:1301`). It is the suite's only wall-clock assertion.

### Pipeline-helpers extraction (N075)

- Exact ranges at `7087c44`: `surfaceLabel` doc `:587` + function `:588-592` (private, types its param from `./config-file.js`); `dedupePosts` doc `:594-600` + function `:601-608` (exported); `mergeSurfaceStamps` doc `:610-615` + function `:616-627` (private). The span `:586-628` contains nothing else private; the next declaration is the entry-guard comment at `:629`.
- Callers: `surfaceLabel` at `src/index.ts:250` (startup log) and `:520` (orphan warn); `dedupePosts` at `:318` (funnel join) plus `tests/index.test.ts:1599`; `mergeSurfaceStamps` only at `:605` inside `dedupePosts`.
- **Correction:** `mergeSurfaceStamps` has no caller outside `dedupePosts`, and that call site moves with it. Exporting it from the new module with zero importers is exactly what knip flags — it must stay module-private (or gain a consumer via a new `tests/pipeline-helpers.test.ts`, which N075 does not mandate). Only `surfaceLabel`'s export is mandatory.
- Leaf-ness: the new module needs exactly two type-only imports (`Post` from `./types.js`, `Surface` from `./config-file.js`); with `verbatimModuleSyntax` both are erased, so its runtime import set is empty. No cycle into `index.ts`.
- Doc-layer note: `.rpiv/guidance/src/architecture.md:13` (module map) and `:178` ("Pipeline shape lives only in `index.ts`") should gain `pipeline-helpers.ts` or trail the code.

### Wake-band warning (N091)

- The constant is `PAYLOAD_MAX_AGE_MS = 2_400_000` at `src/linkedin-payload.ts:43` (**correction:** the FRD cites `:48`; the freeze comment is `:33-42`). The in-module stale check is `:193`.
- Crossing condition: `linkedinWakeMinMinutes * 60_000 >= PAYLOAD_MAX_AGE_MS` — floor >= 40 fires, 40 included. The operator band 15/45 (`watcher.config.json:168-169`) crosses at the ceiling: wakes in the 40-45 tail read the payload stale.
- `resolveLinkedInWakeBand` is `src/linkedin-behavior.ts:76-87` (guard `:81-85`, return `:86`); it throws only on `min > max` today. Its single production call site is `scripts/watch-linkedin.ts:136-140` inside `startLoop`.
- **Cycle check (FRD assumption confirmed):** `src/linkedin-payload.ts:21-27` imports `node:fs/promises`, `node:path`, `./config-file.js` (type), `./config.js`, `./linkedin-parser.js`, `./state.js`, `./types.js` (type). No member of that closure imports `linkedin-behavior.js` or `linkedin-walk.js` — both placements are downward-only.
- **Decision (loop start):** the warning lands at `scripts/watch-linkedin.ts:136-140`, immediately after the resolver returns. Rationale: `src/linkedin-behavior.ts:12-14` declares the module IO-free ("dates and rng draws arrive as arguments") and `tests/linkedin-behavior.test.ts:7` repeats it; the header's own doctrine (`:10`) says "IO and policy placement stay at the consumer". Fires-once is structural — `startLoop` runs once per process and resolves the band once. The loop suite already owns the warn-spy idiom (`tests/watch-linkedin.test.ts:157`, `:178`).
- Warn-line shape: a single template-literal argument naming `PAYLOAD_MAX_AGE_MS` and the freshness rule, so the repo's filter-and-assert pattern (`tests/config-file.test.ts:481-486`) pins it with `/PAYLOAD_MAX_AGE_MS/` — a string that appears in production only at `src/linkedin-payload.ts:13,43,193`, none of which warn on the loop-start path.

### N089 de-pin scope

- Pair #1 `tests/config-file.test.ts:57-58` is the red one: it loads the committed `watcher.config.json` (15/45) against a `=== 60` pin. Pair #2 `:278-279` is **green** — its `it` writes its own config from `VALID` (`:8-21`), which carries no wake keys, so it pins the loader default (`src/config-file.ts:340`, `:352-353`), not operator data. The FRD de-pins both anyway (same pin class; the acceptance criterion demands zero `=== 60` / `, 60)` pins at both former sites).
- The shape idiom to mirror is `:55` (`assert.equal(typeof config.platforms.threads, "boolean")`). The replacement satisfies every `linkedinWake*` assertion: the explicit-value pins (`:289-290` for 55/65, `:296-297` for the partial-band default) and the rejection tests (`:301-336`) are untouched.
- Acceptance-criterion nuance: after the de-pin, a global `grep -n "linkedinWake" tests/config-file.test.ts` still shows `, 60)` at `:297` (the partial-band default pin the FRD keeps) and `, 55)` at `:289`/`:296` — the criterion is satisfiable only scoped to the two former pair sites.
- No other suite pins the band defaults: the `60/60` hits in `tests/fetch-linkedin.test.ts:57-58`, `tests/index.test.ts:55-56`, `tests/probe-linkedin.test.ts:50-51`, `tests/watch-linkedin.test.ts:38-39` are test-local fixture inputs, not committed-data reads. Only `tests/config-file.test.ts` loads the committed file.

### N069 deps-object conversion

- Verified signature `src/linkedin-walk.ts:95-105` (nine positionals: `context` `:96`, `surface` `:97`, `label` `:98`, `scrollRounds` `:99`, `minClicks` `:100`, `seenIds` `:101`, `captureSink` `:102`, `captureOrdinal` `:103`, `nowFn` `:104`). Sole runtime caller `src/linkedin-fetch.ts:286-296`; **zero test callers** (grep across `tests/` returns nothing — every walk case drives `fetchLinkedInPosts`).
- Idiom to mirror: `FetchLinkedInDeps` (`src/linkedin-fetch.ts:116-164`) — optional fields with "Default: ..." JSDoc, defaults resolved at the top, `surfaces` stays first positional, one `| undefined` field forced by `exactOptionalPropertyTypes` (`tsconfig.json:9`).
- Recommended shape: `walkLinkedInSurface(context, surface, deps: WalkLinkedInDeps)` — `context` + `surface` stay positional (the required lead pair); `captureOrdinal` a required deps field (a walk-minted default would break cross-surface filename uniqueness); `captureSink` the sole `| undefined` field; `label`/`scrollRounds`/`minClicks`/`seenIds`/`nowFn` optional with defaults.
- `scrollRounds` default caveat: the constant `LINKEDIN_DEFAULT_SCROLL_ROUNDS` lives orchestration-side (`src/linkedin-fetch.ts:100-101`) and the walk's header (`src/linkedin-walk.ts:7-13`) says it stays there. Either move the constant and rewrite both headers, or keep `scrollRounds` a required deps field that `fetchLinkedInPosts` always passes.
- Name: `WalkLinkedInDeps` (repo derives the interface from the function — `FetchTickDeps`, `FetchLinkedInDeps`, `ProbeDeps`, `LoginHelperDeps`, `ChainDeps`). Keep it module-private like `FetchLinkedInDeps` (knip flags unused exports).

### Five live-signal fixes (N071 / N072 / N073 / N085 / N088)

- **N071** — source idiom `warnBodyFault` at `src/linkedin-walk.ts:140-148` (latch + closure; `console.warn` `:145-147`), applied at `:199` and `:257` under `isPageCloseRace` guards (`:52-58`, module-private). Targets: `src/fetch-threads.ts:389-391` (JSON-skip catch) and `:417-419` (recent-tab catch). Latch home: `fetchOneAuthenticated` (`:364-368`) runs once per surface, so a `CaptureWarnState` beside `let xhrBodies = 0` (`:371`) gives exact per-walk semantics.
  - **Cycle hazard:** do not export `isPageCloseRace` from `linkedin-walk.ts` and import it into `fetch-threads.ts` — `linkedin-walk.ts:14` type-imports `ContextLike` from `fetch-threads.js`, so a runtime edge fetch-threads -> linkedin-walk.js mints a new type cycle. The clean home is the leaf: `PAGE_CLOSE_RACE_MESSAGES` is already exported from `src/linkedin-walk-static.ts` (its only import is `linkedin-parser.js`'s `ACTIVITY_ID_PATTERN`, `:8`) — export a shared `isPageCloseRace` from there.
  - **Decision (timeout = absence):** the recent-tab catch fires mainly on a `waitFor` timeout, which is the designed absence signal already logged at `:425`/`:428` and pinned by `tests/fetch-threads.test.ts:484-508` ("never warns about the tab"). The ported warn classifies timeouts as absence (silent); only genuine faults warn once. The graphql catch warns on non-page-close errors as the audit prescribes.
  - Test seam: `tests/fetch-threads.test.ts`'s double exposes the graphql body via `xhrBySubstring` (`:88`, fired at goto `:120-127`); the suite's warn-spy idiom is at `:463`. The missing-tab locator throws a plain `Error("locator not found")` at `:151` — not timeout-shaped — so the double may need a `TimeoutError`-shaped variant to keep the classes testable.
- **N072** — `scripts/hooks/format-on-edit.js:26-29` spawns `"npx"` with `shell: true` at `:28`; the `result.error` arm is `:30`; the charset allowlist gate is `:21-24` (rationale comment `:18-20`).
  - **Decision (node + JS launcher):** dropping `shell: true` while keeping `"npx"` breaks the hook on every supported runtime — `npx` is `npx.cmd`, and Node >= 22 (`engines`, `package.json:6`) rejects `.cmd` targets without a shell (EINVAL, the CVE-2024-27980 mitigation), so every edit would log "could not run Biome" and `tests/format-on-edit.test.ts:22-31`'s content-mutation pin would fail. Replacement: `spawnSync(process.execPath, [biomeJsBin, "format", "--write", file])` where `biomeJsBin` resolves `@biomejs/biome`'s `bin/biome` JS launcher (verified: `node_modules/@biomejs/biome/bin/biome` begins `#!/usr/bin/env node`; the platform binary `node_modules/@biomejs/cli-win32-x64/biome.exe` is installed).
  - The allowlist gate stays physically (its hostile-path pin at `tests/format-on-edit.test.ts:34-48` depends on it) but is no longer load-bearing once no shell spawn remains — the comment `:18-20` becomes stale doc and must be rewritten in the same commit.
  - New status warning beside `:30`: `if (result.status !== 0) console.error(...)`, keeping the always-exit-0 contract. Pinnable: a file biome cannot parse (`const x = (`) exits nonzero without writing — assert `run.status === 0`, stderr matches, content unchanged. The suite header comment `tests/format-on-edit.test.ts:11-13` ("it checks only result.error") describes the deleted behavior and must be rewritten.
- **N073** — `scripts/login-linkedin.ts:224` `console.log(\`login-linkedin: session captured — ${cookiePath}\`)` sits right after `writeCookieFile` (`:222`). `tests/login-linkedin.test.ts` does not pin the line (zero console spies in the file), so the reword breaks nothing; the happy-path test (`:92-131`) pins the result object, sleeps, context close, and the `.env` round-trip.
- **N085** — `scripts/fetch-linkedin.ts:353` `let lastFailure = ""`; the rebase check sets it at `:357`; the discarded abort is exactly `:359`; the push arm sets it at `:363`; the throw printing it is `:368`. The discipline comments are `:327-330`. The fake `scriptGit` (`tests/fetch-linkedin.test.ts:95-119`) keys results by `args[0]` and returns `{code: 0, output: ""}` for unscripted commands — which is why the current fold is invisible. New pin: script the abort (`scriptGit({ diff: 1, pull: { code: 1, output: "CONFLICT..." }, rebase: { code: 1, output: "fatal: no rebase in progress" } })`) and extend the reject predicate at `:372-378` to assert the thrown message includes the abort's output.
- **N088** — `src/linkedin-capture.ts:193` `JSON.stringify(record, null, 2)` -> single-line, keep the `\n`. `makeFsCaptureSink` (`:159-166`) defaults `root` from `LINKEDIN_CAPTURES_ROOT` (`src/config.ts:81`). Production callers are bare: `scripts/fetch-linkedin.ts:440` and `scripts/probe-linkedin.ts:185`. Seam: mirror `resolveLinkedInProfileDir` (`src/linkedin-fetch.ts:113-127`) — add an env param defaulting to `process.env`, returning a no-op sink when `LINKEDIN_CAPTURE === "off"`; do not read `process.env` bare inside the sink body (the module's contract `:17-21` frames the sink as an injectable closure). No existing pin breaks: `tests/linkedin-capture.test.ts:82-95` asserts `JSON.parse` deep-equality and a trailing `\n`, never indentation. New pins: no interior newline; kill switch via the lazy-stamp ENOENT idiom at `:97-110`.

### Doc pass (N066 / N070 / N081 / N090) — 17 edits

Verified edit list (E-numbers are the implementation spec):

1. **E1** `AGENTS.md:76-78` — replace the timestamp-ordered zip clause with the card join (seed climb, one-seed-span root, forward urn collection, longest-commentary text, drop+count). Source: `src/linkedin-parser.ts:13-14,16-44`, `joinCards` doc `:458-469` (export `:470`).
2. **E2** `.rpiv/guidance/src/architecture.md:118-120` — same rewrite; keep the `:120` pairing-oracle log-line sentence (still true, `src/linkedin-parser.ts:34-36`).
3. **E3** `src/linkedin-behavior.ts:19-20` — "5 surfaces" -> "7 configured surfaces" (or drop the hard count); count source `watcher.config.json:57` + its 7 linkedin entries.
4. **E4** `README.md` config table — insert the `negativeKeywords` row after `:141` (source order: `src/config-file.ts:64-75`).
5. **E5** `AGENTS.md:185` — one negativeKeywords clause on the config bullet.
6. **E6** `AGENTS.md:36` — "walk of the first configured surface" -> config-order, first-keyword-to-clear-the-floor.
7. **E7** `AGENTS.md:123` — same rewrite in the scripts inventory.
8. **E8** `README.md:330` — same rewrite (third doc site).
9. **E9** `.rpiv/guidance/architecture.md:43` — same rewrite in the Commands table (fourth site).
10. **E10** `.rpiv/guidance/scripts/architecture.md:43` — same rewrite in the probe-linkedin.ts Structure entry (fifth site).
11. **E11** `README.md:316` — "opens a real Chrome window" -> headed msedge-channel profile. Do not touch the UA string at `src/browser-constants.ts:19`.
12. **E12** `AGENTS.md` Commands (`:27-61`) — add the `npm run reset-linkedin` entry.
13. **E13** `README.md:386` + block `:388-393` — "five" -> "seven" LinkedIn leg entries; add `reset-linkedin` and `replay-linkedin` lines (`package.json:17-23` defines 7).
14. **E14** `package.json:15` — add `scripts/probe-judge.ts` to the `format` list (mirroring `lint` at `:13`).
15. **E15** `.rpiv/guidance/.github/workflows/architecture.md:7` — "5 of the 6 ENV_NAMES" -> "5 of the 7"; extend the not-mapped clause to both LinkedIn names (`LINKEDIN_COOKIES_FILE`, `LINKEDIN_PROFILE_DIR`).
16. **E16** `.rpiv/guidance/architecture.md:65` — "CI runs the same three" -> four gates (knip is the fourth; `.github/workflows/ci.yml:39-40`, `package.json:14`).
17. **E17** `.rpiv/guidance/architecture.md:60` — the N043 revisit trigger gets the numeric threshold "re-gc at 150 MiB loose or 30 s checkout".

**Decision (full sweep):** the "first configured surface" claim also lives at 3 code/test sites — `scripts/linkedin-chain.ts:10` (module doc), `scripts/linkedin-chain.ts:106` (operator-facing banner printed every chain run), `tests/probe-linkedin.test.ts:286` (test title). The banner edit must verify its test pin first (`tests/linkedin-chain.test.ts` uses a prefix-tolerant `/stage 2\/3 probe /` regex). Consistency edits also in scope: add `reset-linkedin` + `replay-linkedin` rows to the guidance Commands table (`.rpiv/guidance/architecture.md:36-48`), and align the duplicate revisit trigger at `.rpiv/guidance/.github/workflows/architecture.md:138` with E17.

Already correct (do not touch): `scripts/probe-linkedin.ts:1-11` (header already states config-order/first-pass-wins), `src/linkedin-parser.ts` (zip-free since the card join landed), `src/browser-constants.ts` Chrome mentions (the pinned UA string).

## Code References

- `src/judge.ts:70-74` — `LlmAccount` interface (moves to the new leaf)
- `src/judge.ts:25-36` — the judge re-export facade (N067 deletion target)
- `src/judge-shared.ts:13` — runtime import of `judge-health.js` (the D6 cycle edge)
- `src/judge-health.ts:34` — type import of `LlmAccount` from `./judge.js`
- `src/linkedin-fetch.ts:46-68` — the linkedin-fetch re-export facade (N067 deletion target)
- `src/linkedin-fetch.ts:70` — `LinkedinSurface` (moves to `config-file.ts`)
- `src/linkedin-fetch.ts:116-164` — `FetchLinkedInDeps` (the N069 idiom to mirror)
- `src/linkedin-walk.ts:95-105` — `walkLinkedInSurface`'s nine positional params (N069 target)
- `src/linkedin-walk.ts:140-148` — `warnBodyFault` (the N071 idiom to port)
- `src/linkedin-walk-static.ts` — `PAGE_CLOSE_RACE_MESSAGES` (the shared-guard home for N071)
- `src/linkedin-payload.ts:43` — `PAYLOAD_MAX_AGE_MS` (N091 constant; `:193` the stale check)
- `src/linkedin-behavior.ts:76-87` — `resolveLinkedInWakeBand` (N091 resolver; `:12-14` the IO-free header)
- `src/linkedin-capture.ts:159-166,193` — `makeFsCaptureSink` + the pretty-print (N088)
- `src/fetch-threads.ts:364-368,389-391,417-419` — the per-walk frame + both bare catches (N071)
- `src/index.ts:587-627` — the three pure helpers (N075 extraction block)
- `src/index.ts:629-632` — the entry guard immediately after the extraction block
- `src/pool.ts:33-52` — `runPool` (the new suite's target)
- `src/config.ts:37-55` — `isHeartbeatEnabled` + `runUrlFromEnv` (the config suite's targets)
- `src/judge-exhaustion.ts:29-59` — `resolveBlockedPick` (the exhaustion suite's target)
- `src/judge-ceilings.ts:130` — `writeCeilingsAtomic` (the trailing-param injection precedent)
- `scripts/probe-judge.ts:104-135,138-154,161,172-194,340` — `timed`, `rampLevel`, `RAMP_MAX`, `findConcurrencyCeiling`, the unguarded tail
- `scripts/watch-linkedin.ts:136-140` — the N091 warning site (decision)
- `scripts/hooks/format-on-edit.js:21-30` — the allowlist gate + the spawn (N072)
- `scripts/fetch-linkedin.ts:327-330,353-368` — the lastFailure discipline + the discarded abort (N085)
- `scripts/login-linkedin.ts:224` — the harvest log (N073)
- `tests/judge-helpers.ts:4-5,8` — the doctrine line + the `LlmAccount` import (N078/N092)
- `tests/judge-rotation.test.ts:56-74,386-404` — canonical `freshState` + the wall-clock case (N079/N077)
- `tests/judge.test.ts:18-39` — the `freshState` mirror to delete (N079)
- `tests/config-file.test.ts:55,57-58,278-279` — the idiom + both pin pairs (N089)
- `tests/fetch-linkedin.test.ts:35,1048-1068` — the facade import + the SCROLL_JS describe (N067/N076)
- `tests/linkedin-fetch.test.ts:32-45,1179` — the six-symbol facade split + the `allSurfacesFaulted` use
- `.rpiv/guidance/architecture.md:52-65` — the N043 policy section + the 3-gate claim (N090/N081)

## Integration Points

### Inbound References
- `src/index.ts:51-52` — imports `LlmAccount` + `LinkedinSurface` (both re-point under N092)
- `src/judge-availability.ts:28`, `src/judge-ceilings.ts:28`, `src/judge-dispatch.ts:53`, `src/judge-health.ts:34`, `src/judge-rotation.ts:42` — the `LlmAccount` type-importers in src/
- `src/linkedin-walk.ts:27` — the `LinkedinSurface` type import that flips to `./config-file.js`
- `scripts/fetch-linkedin.ts:42`, `scripts/probe-linkedin.ts:42` — the `LinkedinSurface` importers in scripts/
- `tests/judge-helpers.ts:8`, `tests/judge.test.ts:9`, `tests/judge-rotation.test.ts:22`, `tests/judge-availability.test.ts:4`, `tests/judge-ceilings.test.ts:12`, `tests/judge-health.test.ts:24`, `tests/index.test.ts:35` — the `LlmAccount` importers in tests/
- `tests/linkedin-fetch.test.ts:34` — the `LinkedinSurface` importer in tests/
- `scripts/probe-judge.ts:46` — imports `LlmAccount` + `buildBulkMessages` (facade symbol) + `resolveJudgeConfig` (native)
- `tests/index.test.ts:31` — imports `dedupePosts` (the only external consumer of the N075 helpers)

### Outbound Dependencies
- `src/linkedin-payload.ts:21-27` — the N091 import edge (verified cycle-free: config, config-file, linkedin-parser, state, types)
- `src/pipeline-helpers.ts` (new) — type-only imports of `./types.js` + `./config-file.js`; zero runtime imports
- `src/judge-account.ts` (new) — zero imports (the leaf that zeroes madge)
- `scripts/hooks/format-on-edit.js` — spawns biome via `process.execPath` + the JS launcher (N072 decision)

### Infrastructure Wiring
- `package.json:11-15` — the four gates + the `format` script's enumerated file list (E14 adds probe-judge.ts)
- `.github/workflows/ci.yml:30-40` — the four CI steps (E16's evidence)
- `watcher.config.json:57,168-169` — the 7 linkedin surfaces + the 15/45 wake band
- `src/config.ts:14-28` — the 7 `ENV_NAMES` members (E15's evidence)

## Architecture Insights

- **Moves must be byte-verbatim.** The `f14d9f9` judge split caused a rotation release bug found 10 days later (`2338274`); run-6 solutions attribute it to logic edits conflated with the move. N092's type moves and N069's deps conversion must carry no behavior edits.
- **Partial facade execution does not compound.** `44dafd7` killed some re-exports but left both REMOVAL NOTE blocks — N067 has now carried two runs. Execute every facade (re-point ALL importers + delete block + stale comment) in one commit.
- **Deferred findings don't self-execute.** N067, the type homes (cycles grew 4 -> 9), and probe-judge's zero tests each carried 3-7 runs because prior passes scoped them out — the one-PR full-ledger intent exists precisely because deferral compounds.
- **Doc passes lag when split out.** `216024b` and `0b3dab9` both landed next-day; doc drift is the largest carried cluster two runs running. Land docs with code (the full-sweep decision).
- **CI gates break on first land.** knip went red on main after run 6/7 (N061 -> `0c06f27`); gate additions broke twice before (`42b8cf8`, `510ff2a`). Re-run knip/tsc/biome per cluster; no old-path re-export shims.
- **Extractions need a second sizing pass.** Run-6's N060 needed `0badab4` the same day; budget residual cuts after the index.ts and ramp extractions.
- **De-pinning config assertions requires a full grep.** `fe3325e` de-pinned the platforms pins but missed both wake-band pairs — the sixth recurrence of the pinned-config class.

## Precedents & Lessons

3 similar past changes analyzed.

### Precedent: Run 7 tech-debt pass (closest shape)
**Commit(s)**: `9b14244` — "fix: high-severity cluster + one-liners (tech-debt run 7)" (2026-11-18); audit `dd7820d` same day
**Blast radius**: 8 files — scripts/, .github/workflows/, tests/ (no src/ for the one-liners)

**Follow-up fixes**:
- `0b3dab9` — "docs sync for the fixes themselves (N062/N084/N086)" (2026-11-19) — same-day doc drift
- `0c06f27` — knip red on main (N061), fixed after the audit caught it

**Lessons from docs**:
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — the audit's own verdict on self-scheduling notes: "Self-scheduling worked once; it does not compound."

**Takeaway**: even a small debt pass generated same-day doc drift and a red CI gate; run docs + knip in the same commit set.

### Precedent: Facade removal (44dafd7)
**Commit(s)**: `44dafd7` — "judge: the re-export facades come down + the health-cap pair is pinned" (2026-11-16)
**Blast radius**: 13 files — judge* (7), src/index.ts, email.ts, linkedin-fetch.ts, 3 judge tests

**Follow-up fixes**:
- none landed — the partial execution is why N067 carried into run #8

**Lessons from docs**:
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` N067 — "Self-scheduling worked once; it does not compound"; the stale facade comment naming index.ts as a consumer also survived

**Takeaway**: execute every facade (re-point ALL importers + delete block + stale comment) in one commit; partial facade work doesn't carry forward.

### Precedent: Judge split bug (the f14d9f9 lesson)
**Commits**: `f14d9f9` — "split the judge into pool/rotation/parse" (2026-10-30) -> `2338274` — "park rewound dispatchers on the free release queue" (2026-11-09)
**Blast radius**: the judge cluster

**Follow-up fixes**:
- `2338274` — rotation release bug discovered 10 days after the split

**Lessons from docs**:
- run-6 solutions — "Splits must be byte-verbatim moves. No logic edits inside a move."

**Takeaway**: for N092's type-home moves and N069's deps conversion, move first with zero behavior edits.

### Composite Lessons
- Byte-verbatim moves; never mix logic into a move (`f14d9f9` -> `2338274` caused a 10-day-late rotation bug).
- CI gates break on first land: knip red on main after run 6/7 (N061 -> `0c06f27`); gate additions broke twice before (`42b8cf8`, `510ff2a`). Re-run knip/tsc/biome per cluster; no old-path re-export shims.
- Deferred findings don't self-execute: N067 facades, N068 type homes (cycles grew 4 -> 9), N080 probe-judge zero tests each carried 3-7 runs.
- Doc passes lag when split out (`216024b`, `0b3dab9` both next-day); land docs with code.
- Extractions need a second sizing pass (run-6 N060 needed `0badab4` same day).
- De-pinning config assertions requires grepping for ALL pin pairs of the key (`fe3325e` missed both wake-band pairs).

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — the input spec (run #8, audited @ `7087c44`)
- `.rpiv/artifacts/discover/2026-11-19_10-11-11_tech-debt-full-ledger.md` — the FRD this research chains from (16 decisions, 4 carried open questions)

## Developer Context

**Q (`scripts/hooks/format-on-edit.js:28`): N072's literal fix (drop `shell: true`) breaks the hook on every supported Node — `npx` is `npx.cmd` and Node >= 22 rejects `.cmd` targets without a shell (EINVAL, CVE-2024-27980), so every edit logs "could not run Biome" and `tests/format-on-edit.test.ts:22-31`'s content-mutation pin fails. Which replacement spawn?**
A: node + JS launcher — `spawnSync(process.execPath, [biomeJsBin, "format", "--write", file])` resolving `@biomejs/biome`'s `bin/biome`. Cross-platform, no shell, smallest diff. The allowlist gate stays physically (its hostile-path pin depends on it) but its rationale comment `:18-20` is rewritten — it is no longer load-bearing once no shell spawn remains.

**Q (`src/linkedin-behavior.ts:12-14`): N091's warning — the audit names `resolveLinkedInWakeBand` (`:76-87`), but the module header and `tests/linkedin-behavior.test.ts:7` declare the module IO-free, and the header's own doctrine (`:10`) says policy lives at the consumer. Both placements are cycle-free. Where does the warning live?**
A: warn at loop start — `scripts/watch-linkedin.ts:136-140`, immediately after the resolver returns. No purity headers touched; the loop suite already owns the warn-spy idiom (`tests/watch-linkedin.test.ts:157`, `:178`). Fires-once is structural (`startLoop` runs once per process).

**Q (`src/fetch-threads.ts:417-419`): N071's recent-tab catch fires mainly on a `waitFor` timeout — the designed absence signal, already logged at `:425`/`:428` and pinned by `tests/fetch-threads.test.ts:484-508` ("never warns about the tab"). A literal warn-once port re-labels every tab-less surface walk as a fault. How should the ported warn classify timeouts?**
A: timeout = absence — the recent-tab catch stays silent on timeouts and warns once only on genuine faults; the graphql catch (`:389-391`) warns on non-page-close errors as the audit prescribes. The missing-tab double's plain `Error("locator not found")` (`tests/fetch-threads.test.ts:151`) may need a `TimeoutError`-shaped variant to keep the classes testable.

**Q (`scripts/linkedin-chain.ts:106`): the "first configured surface" claim lives at 5 doc sites AND 3 code/test sites, including the operator-facing banner printed every chain run and the probe test title. The FRD's N081 names only doc layers. How far does the sweep go?**
A: full sweep — all 17 doc edits plus the chain banner (verify its prefix-tolerant test pin first), the test title rename, and the consistency edits (guidance command rows, the duplicate revisit trigger at `.rpiv/guidance/.github/workflows/architecture.md:138`).

**Q (discover: D6 — LlmAccount home): new leaf type module**
A: `src/judge-account.ts` (zero runtime imports) — the audit's `judge-shared.ts` home recreates the cycle (`src/judge-shared.ts:13` runtime-imports `judge-health.js`, which type-imports `LlmAccount`).

**Q (discover: D7 — Test-double doctrine override)**
A: both factory + freshState, and the doctrine line (`tests/judge-helpers.ts:4-5`) plus its guidance copy are rewritten in the same commit.

**Q (discover: D11 — N075 home)**
A: `src/pipeline-helpers.ts`; `mergeSurfaceStamps` stays module-private there (exporting it with zero importers fails knip).

**Q (discover: D15 — N077 gate via inertSleep)**
A: inject a recording sleep and assert `deepEqual(sleeps, [])`; the case (`tests/judge-rotation.test.ts:386-404`) injects no sleep today, so the fix adds one.

## Related Research

- none — first research artifact for this branch

## Open Questions

- Is `scrollRounds: 50` intentional for BOTH walks? (carried from the FRD — settle with tick-log click counts)
- `.rpiv/artifacts/` is a tracked archive with no pruning policy — intentional? (carried)
- Are the four possibly-orphaned GitHub secrets (`LINKEDIN_SESSION_STATE`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, `LINKEDIN_SECRET_WRITER`) still set? (carried)
- Is `reasoning_effort` accepted by every endpoint in the pool? (carried — N065's shape check will surface a proxy that rejects the field)
- N069's `scrollRounds` default: move `LINKEDIN_DEFAULT_SCROLL_ROUNDS` into `linkedin-walk.ts` (rewriting both headers) or keep it a required deps field? (new — implementer's pick, both satisfy FR-8)
- N088's `LINKEDIN_CAPTURE` switch: add the name to `ENV_NAMES` (`src/config.ts:14-28`) or read it as a bare opt-in? (new — whichever is chosen, the E15 "N of 7 ENV_NAMES" doc line is affected)
