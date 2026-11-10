---
date: 2026-11-09T19:37:52+0700
author: Yogiswara Utama
commit: fd53570
branch: ukind/fix-tech-debt
repository: fix-tech-debt
topic: "Tech debt zero-findings pass (N018-N029 + N005) — execution research"
tags: [research, codebase, tech-debt, judge-dispatch, dead-exports, smtp-transport, payload-reader]
status: ready
last_updated: 2026-11-10T06:51:00+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Added follow-up research for the N020 knip reconcile (PACE_MS confirmed; PAGE_SIZE stays exported)"
---

# Research: Tech debt zero-findings pass (N018-N029 + N005) — execution research

## Research Question
How to execute the tech-debt zero-findings pass (N018-N029 + N005) across the judge dispatch seam, dead exports, and script/config hygiene — chained from discover artifact `.rpiv/artifacts/discover/2026-11-09_18-39-48_tech-debt-zero-findings.md`.

## Summary
The pass is 13 findings: one structural extraction (N005) plus twelve mechanical fixes. The extraction is the only load-bearing decision, and the FRD's own move list is internally contradictory — it forbids a new runtime cycle while assigning the moving core two helpers (`normalizeEndpoint`, `terminalFailureReason`) that must live in the destination module to keep the seam one-way. The developer chose the full extract: builders, wire helpers, wrappers, and core types all land in `src/judge-dispatch.ts`, `judge.ts` keeps orchestration only, and two importers (`src/judge-availability.ts:27`, `scripts/probe-judge.ts:46`) re-point. Everything else is verified mechanical, with three hidden collisions the FRD does not name: a knip name-transcription error in the N020 list (`PAGE_SIZE` vs `PACE_MS` at `src/linkedin-fetch.ts:63`/:66), a two-edit entry guard (`scripts/watch-linkedin.ts:18` module-scope side effect), and ~36 positional test call sites the options-object rewrite re-points. The precedent record is unambiguous: the last judge extraction (`f14d9f9`) later produced the repo's worst production bug (`2338274`) in exactly the dispatch region being moved — move the fix's test pins verbatim and keep the new seam runtime-cycle-free.

## Detailed Findings

### The judge dispatch seam (N005)

- `dispatchLlmCall` is defined at `src/judge.ts:474-489` with an options-object signature already (10 fields, destructured `:490-501`); body spans `:474-667`.
- The core consumes rotation primitives at runtime (`pickEligibleAccount :512`, `hasOutstandingRelease :536`, `waitCeilingSlot :537`, `earliestCooldown :538`, `parkUntilEligible :539`, `claimAccount :556`, `coolAccount :571`, `releaseAccount :640`) — all from `./judge-rotation.js` (`src/judge.ts:56-69`). These re-import cleanly: judge-dispatch.ts → judge-rotation.js is the same downward edge judge.ts holds today.
- Health stamps: `stampFailure` at `:598` and `:635`, `stampSuccess` at `:620` — from `./judge-health.js` (`src/judge.ts:47-55`). Same clean re-import.
- Wire helpers: `normalizeEndpoint` (`src/judge.ts:219-223`, called `:559`) and `terminalFailureReason` (`:371-373`, called `:598`). **These cannot stay in judge.ts** — see the cycle proof below.
- Core-private constants with zero consumers outside core+wrappers: `REQUEST_TIMEOUT_MS :79`, `RETRYABLE_STATUSES :99`, `RETRY_DELAYS_MS :103` (also read by judgeBatch's warn string `:735` and `maxAttempts :721`). `WAIT_BUDGET_MS :122` stays (judgePosts' state literal reads it `:928`).
- `exhaustionRecord` (`:413-449`) is called from both sides of the seam: `judgePost :856` (moves) and `judgePosts :980`, `:1063` (stays). It moves; judge.ts runtime-imports it back — same one-way edge as the wrappers, no cycle.
- The two tolerated madge cycles (judge.ts ⇄ judge-rotation.ts, judge.ts ⇄ judge-health.ts) are type-only in the reverse direction (`judge-rotation.ts:37-40`, `judge-health.ts:34`) and are structurally untouched by the extraction.

**The cycle, proven.** `judgePosts` (FR2 pins it in judge.ts) runtime-calls `judgeBatch` at `src/judge.ts:960` and `judgePost` at `:1038`. So judge.ts → judge-dispatch.ts is a mandatory runtime edge. Any runtime edge back closes a two-module cycle. Under the FRD's ownership parenthetical, judge-dispatch.ts would need from judge.ts: `buildBulkMessages` (`judgeBatch` calls it `:707`), `buildMessages` (`judgePost` calls it `:805` — currently private, `judge.ts:248-262`), `normalizeEndpoint` (`:559`), `terminalFailureReason` (`:598`). That is exactly the forbidden cycle. The constraint is the invariant; the ownership list bends.

**Chosen layout (developer decision: full extract).** judge-dispatch.ts receives: `dispatchLlmCall`, `judgeBatch`, `judgePost`, `exhaustionRecord`, the builders (`systemMessage :233-246`, `buildMessages :248-262`, `buildBulkMessages :276-294`), the wire helpers (`normalizeEndpoint`, `terminalFailureReason`), the core-private constants, and the core-exclusive types. judge.ts keeps: module doc, `sleep :126-127`, `SleepFn :131`, `LlmAccount :134-138`, `parseLlmAccounts`, `JudgedPost :188-191`, `JudgeBatchResult :193-201`, `resolveJudgeConfig :206-210`, `judgePosts :904-1073`.

**Re-points the layout forces:**
- `src/judge-availability.ts:27` — `normalizeEndpoint`/`terminalFailureReason` move to `./judge-dispatch.js`; `type LlmAccount` stays from `./judge.js` (six type-only consumers: `judge-rotation.ts:40`, `judge-health.ts:34`, `judge-ceilings.ts:28`, five test files). The doc block `judge-availability.ts:20-26` rewrites its "no cycle exists" claim with the new referent — judge-dispatch.ts never imports judge-availability.ts (verified: consumed only by `index.ts:39` and its test).
- `scripts/probe-judge.ts:46` — `buildBulkMessages` re-points to `../src/judge-dispatch.js`; N021's `normalizeEndpoint` import lands there too. Both acceptance greps key on symbols, not modules.
- `src/judge.ts:48-55` keeps `HARD_FAIL_TICKS_TO_CAP` (readers `:394`, `:424`, `:948` all stay in judge.ts) and `readTickOutcomes` (`:986`, `:1071`).

**Type placement (usage-verified):**
- `BatchOutcome` (`judge.ts:300-303`) — the one genuinely cross-seam type (`judgeBatch` return `:703` moves; `judgePosts` outcomes array `:956` stays). Moves; judge.ts re-imports **type-only**.
- `ContentDecision<T>` (`:310-312`), `DispatchOutcome<T>` (`:325-329`), `AttemptDirective<T>` (`:341-346`), `DispatchWarns` (`:353-359`) — named only inside the core/wrappers; wrappers construct values structurally. Move, no re-import needed.
- The D6 doc above `DispatchOutcome` (`judge.ts:318-324`) relocates with the types — it is one of three co-located "OUTSIDE the try" statements (the others: `:528-530`, `:854-855`).

### The judgePosts options object (N005, FR3)

- Signature today: `src/judge.ts:904-916`, 11 positional params. FR3 folds `:910-915` (`ceilings`, `now`, `sleepFn`, `healthMarks`, `blocked`, `negativeKeywords`); `fetchFn`/`reasoningEffort` are implementer's choice.
- **Churn arithmetic**: keeping `fetchFn`/`reasoningEffort` positional leaves 7 test sites compiling as-is and forces ~19 re-points (1 production + 18 deep-tail test sites). Joining them to the object forces ~36. Churn-minimization picks positional; FR3 requires the choice be documented at the call site.
- Production caller: `src/index.ts:51-57` imports; the call at `:444-462` uses all 11 positions. The `blocked` argument is built at `index.ts:440-442` from the availability pre-check's failures (1-based account numbers → 0-based indexes).
- Test surface: `tests/judge-rotation.test.ts` 29 sites (11 `judgePosts`, 18 `judgePost`); `tests/judge.test.ts` 47 more (~25 `judgePosts`, ~12 `judgePost`, 5 `buildBulkMessages` prompt pins that are signature-agnostic). Deep-tail `judgePosts` sites that must rewrite: `judge-rotation.test.ts:371`, `:458`, `:505`, `:579`, `:622`, `:663`, `:702`, `:997`, `:1065`; `judge.test.ts:349`, `:368`, `:385`, `:452`, `:501`, `:532`, `:947`, `:1076` region, `:1095-1134`, `:1155-1181`, `:1205-1229`, `:1260-1267`.
- `judgePost` (`judge.ts:795-804`) **stays positional** — its deep context already rides inside the `RotationState` parameter (`:796`); FR3 mandates only judgePosts; all 30 test `judgePost` sites compile untouched.
- **Defaults under `exactOptionalPropertyTypes`**: declare `field?: T` without `| undefined` (absence hits the destructure default; explicit `undefined` is a compile error — the codebase's omit-when-absent doctrine, `index.ts:330-334`). Parameter default `= {}` keeps zero-options test calls byte-identical.
- **Defensive copies must operate on the defaulted locals**: `new Map(blocked)` (`judge.ts:921`) and `new Map(healthMarks)` (`:923`) — `stampSuccess` mutates `state.healthMarks` in-run (`judge-health.ts:166-168`), so handing the caller's raw map would let the run mutate `health.marks` from `index.ts:459`.

### The N019 collapse

- `allAvailabilityBlocked` (`judge.ts:391-398`, doc `:375-390`) is a pure read with one call site (`:542`), not exported, zero test references.
- The pick-undefined arm (`judge.ts:536-546`) ends in three byte-identical `{ status: "exhausted" }` returns: `:540` (park budget spent — LIVE), `:543` (predicate — DEAD), `:545` (trailing else). Collapse means deleting the `:542-543` arm; the park arm (`:538-541`, pinned `judge-rotation.test.ts:228-259`) and release arm (`:536-537`, pinned `:722`, `:1020`) stay.
- Behavior-preserving: the predicate computes and discards; both arms return fresh structurally identical literals with no side effects between them.
- Downstream is arm-agnostic: `judgeBatch` maps at `:769-770`; `judgePost` throws `RotationExhausted` at `:856` in the wrapper frame (outside the core's try — `:854-855`); `exhaustionRecord` is state-derived.
- Tests pin outcomes, not arms: `judge.test.ts:1085` (all-blocked pool, zero fetches, exact record) and `:1137` (blocked + health-drained survivor) both fire the deleted arm and survive the collapse.
- **Comment retention**: keep the "OUTSIDE the try … misread as a transport error" sentence (`:528-530`) and the "terminal — never a timerless wait that could hang" clause (`:535`). **Rewrite** `:534-535`'s "the trailing arm is unreachable by the case analysis" — after the collapse the trailing arm is exactly where mask-refused and capped-drained pools land, and `judge.test.ts:1085`/:1137 prove it fires.

### The N020 dead exports

- 11 of 12 verify exactly as cited (see Code References). Each keeps >=1 internal reference, so `tsc --noEmit` stays green; `tsconfig.json` does not enable `noUnusedLocals`.
- **Name transcription error (developer decision: run knip first).** The FRD cites `PAGE_SIZE` at `src/linkedin-fetch.ts:66`; `:66` is actually `PACE_MS` (`export const PACE_MS = 5_000`, internal use `:426`, zero importers). `PAGE_SIZE` sits at `:63` and is value-imported by `tests/linkedin-fetch.test.ts:24` (uses `:77`, `:295`, `:398`). The audit's 8+4=12 count only adds up if knip's row was `PACE_MS`. `PAYLOAD_VERSION` (test-imported by two files) is absent from the list, confirming test imports count as consumers. **Action: run `npx knip` fresh and match names from live output before editing.**
- If `PAGE_SIZE` is genuinely flagged: dropping `export` breaks `npm run typecheck` (TS2305) and `npm test` (ESM named-binding resolution fails at module-link time — the whole suite file fails to load). Fix shape: test-local `const PAGE_SIZE = 50` with the MUST-stay-equal doc idiom (the `judge-rotation.ts:57-63` / `judge-health.ts:41-47` precedent), not an inlined literal.
- Unexported types in exported positions compile fine (`FaultKind` in `Fault` `:166`, `LegStatus` in `LegLine`/`PayloadRead` `:47`/:56, `VoyagerStorageCookie` in `VoyagerStorageState` `:159`); `noEmit: true` removes the declaration-emit question.
- Run-#2 caveat applies: check `typeof` type-operand uses before dropping `export` (a `typeof` use survives unexport).
- Gate: `npx knip` 0/0. No knip script, no CI step, no config file — ad hoc by design (FRD Non-Goal). The pass must add no new unconsumed exports: judge-dispatch.ts's surface must arrive pre-consumed.

### The N018 payload-reader contract

- `PAYLOAD_VERSION = 2` (`src/linkedin-payload.ts:30`) carries a doc comment (`:28-29`) whose "keep the reader tolerant" clause describes a reader that no longer exists: `readPayloadPosts` rejects `envelope.version !== PAYLOAD_VERSION` at `:174-178` (warn + `{ posts: [], leg: "malformed", detail }`).
- The committed `state/linkedin-posts.json:2` is `"version": 1`, so every hosted run reads the leg malformed until the operator restarts the PC loop. The heartbeat renders exactly `LinkedIn leg: malformed — unknown version 1 (expected 2)` (`src/heartbeat.ts:121-127`, `:145`).
- Conversion path: the PC loop's `writePayloadAtomic` stamps `PAYLOAD_VERSION` at `src/linkedin-payload.ts:112-116`; an all-faulted tick skips the write (`scripts/fetch-linkedin.ts:267-272`), so conversion lands on the first *successful* tick after restart.
- Doc sites: `src/linkedin-payload.ts:28-30` (replace the tolerant clause with the operator contract) and `.rpiv/guidance/src/architecture.md:125-127`. Wording must match the existing stale-loop warning at `src/index.ts:517-527` ("update the PC loop's clone of main (git pull) and restart watch-linkedin") — the version-axis twin of that sentence.
- Pins that must survive: `tests/linkedin-payload.test.ts:231-237` (v1 → malformed), `:120-125` (version 99), `tests/index.test.ts:720-730`, `tests/heartbeat.test.ts:159-163`. The edit is comment-and-guidance-only; the criterion forbids drifting into a code change.
- Sequencing with N020's `LegStatus` unexport (same file, `:43`): disjoint hunks, zero cross-file coupling (`LegLine` — not `LegStatus` — crosses the boundary; `index.ts:59`, `email.ts:11`, `heartbeat.ts`). **Order: unexport first, doc rewrite second** — the prose then describes the final public surface, and every intermediate measurement stays interpretable.

### The N023 shared SMTP transport

- `sendText` (`src/email.ts:160-189`) has `transport?: Transporter` at `:164` and the per-call fallback `nodemailer.createTransport` at `:167-175`. Every sender already threads the param (`sendSurfaceDigest :216`, `sendExhaustionEmail :298`, `sendLegDeadAlarm :330-334`, `sendHeartbeat` via `heartbeat.ts:189`).
- Production gap: `runWatcher` forwards `deps.transport` (`index.ts:206-207`, undefined in production) at four sites — `:390`, `:432`, `:486`, `:537` — so every email pays a fresh construction.
- **Chosen shape: runWatcher-scoped lazy memo.** `deps.transport ?? (smtpMemo ??= createGmailTransport(emailConfig))`. Injection precedence is structural (`??` short-circuits before the memo), so the ~30 `recordingTransport()` injections (`tests/index.test.ts:288-300`) keep winning. The memo takes `EmailConfig` as an argument so each path's `resolveEmailConfig` throw discipline stays byte-identical (heartbeat resolves inside try/catch `index.ts:85-93`; digest inside the notify closure `:530`; exhaustion inside the helper's catch `:141`).
- Lazy beats eager: heartbeat emails fire at Gate 1 (`:390`) and Gate 2 (`:486`) *before* the notify stage, and the all-down alarm (`:426`) precedes both; eager-at-notify-entry would cover 1 of 4 paths, eager-at-top would construct on runs that never email (parked run returns `:411-414`; heartbeat-disabled zero-match run sends nothing — `tests/index.test.ts:476-493`).
- Import hygiene: `index.ts:3` imports only the type. Add a tiny exported factory `createGmailTransport(config: EmailConfig): Transporter` in `email.ts` wrapping the exact `:169-174` options object, used by both the `sendText` fallback and the memo — canonical options shape in one place, no `nodemailer` value import in the entry module.
- **Entry catch fence stays as-is** (`:656` `transport: undefined`, `:671` no transport): the `.catch()` continuation (`:646`) has no `deps` in scope; the episode bit (`:132-137`) plus the fallback gate (`:669`) bound it to <=2 emails; and `index.ts:679-685`'s side-effect-free import contract forbids module-level mutable state.
- Tests pinning the seam: the FR7 mid-loop test (`tests/index.test.ts:1063-1114`) proves the *same* injected object serves both surface emails sequentially (`sendCount` state `:1070-1075`); the two-consecutive-skips test (`:1440-1486`) pins `deps.transport` → `flushAndSendExhaustionAlarm` (`:432`) with one-episode suppression.

### The N022 paired-constant pin

- `HEALTH_CAP_STREAK = 2` (`src/judge-rotation.ts:63`, private) feeds the pick predicate (`:207`) and claim-time probe registration (`:260`). `HARD_FAIL_TICKS_TO_CAP = 2` (`src/judge-health.ts:47`, exported) feeds `judge.ts:394`, `:424`, `:948` and `judge-health.ts:285` (the degraded-accounts email line).
- The D5 boundary forbids sharing: `judge-rotation.ts:37-41` is type-only imports only (erased by `verbatimModuleSyntax`, `tsconfig.json:9`); importing judge-health's constant would be the forbidden runtime edge.
- Existing coverage is literal-seeded consumer behavior only: `judge-rotation.test.ts:909-917` pins the streak-1 negative arm; `judge-health.test.ts:221-235` pins `buildDegradedAccountsLine` at the threshold. The pairing itself is asserted by nothing.
- **Chosen shape: extend `tests/judge-health.test.ts`** (contract ownership — the anchor symbol is judge-health's export; in-file state-literal precedent at `:132-140`; the `freshState`-duplication idiom is documented at `judge.test.ts:20-39`). Two `it`s: `assert.equal(HARD_FAIL_TICKS_TO_CAP, 2)` plus a behavioral pair seeding the capped arm with the **symbol** (not literal 2) so rotation-side drift also fails.
- A reachability subtlety: in live dataflow the ceiling arm (`capped ? 1 : ceiling`, `:209`) is shadowed by the half-open gate (`:208`) because `healthMarks` only enters via the index.ts seed and `stampFailure` writes only `outcomeLedger` (`judge-health.ts:181-183`). The test must fabricate the state (claim, then delete the probe slot) to observe the arm — legitimate, since the pick is pure over plain fields and the suite already manipulates them (`judge-rotation.test.ts:889`, `:904`).
- Constraint verification: two test-rooted edges (test → judge-health, test → judge-rotation), no src-graph edge; everything consumed is already exported; `HEALTH_CAP_STREAK` stays private (importing it would fail typecheck — `tsconfig.json:13` includes `tests`).

### The four mechanical hygiene fixes

- **N026** — duplicate `"hiring developer jakarta"` at `watcher.config.json:105` and `:117` (blocks `:103-106` and `:115-118`). Delete the second block. `warnDuplicateSurfaces` (`config-file.ts:211-224`) fires on every run today; two identical entries collapse to one group key downstream, so the only cost is the warn. Acceptance: `git grep` returns exactly 1 hit.
- **N027** — `scripts/watch-linkedin.ts:38` bare `void main();`. **Two edits, not one**: `const ENV = envWithDotEnv()` sits at module scope (`:18`, not :14) and does a synchronous `readFileSync` of `.env` (`src/env-file.ts:61-85`) — a guard around `main()` alone does not suppress it. Move `ENV` into `main()`'s first statement (semantics unchanged: resolved once per process before the first tick; `ENV` is read only at `:23` inside the loop) and add the standard guard plus `import { pathToFileURL } from "node:url"`. Sibling precedent: `fetch-linkedin.ts:285` resolves env inside the guard body. Imports at `:10-12` stay byte-identical.
- **N028** — `scripts/setup-curl-impersonate.ts:163` `fetchFn(url)` unbounded while the tar runner bounds at 120s (`:82`). Add `{ signal: AbortSignal.timeout(120_000) }` **and wrap in try/catch → `fail()`**: a bare signal rejects with a `TimeoutError` DOMException that escapes `runSetupCurl` raw, bypassing the escape-hatch contract (`:110-112`, `:117-121`, docstring `:129-136`). Test doubles (`tests/setup-curl-impersonate.test.ts:50-57`, `:64-71`) ignore the second argument — assignable to `typeof fetch`, no test asserts its absence.
- **N029** — `git rm .probe-dispatch-canary` (tracked, content `probe`, zero tree references, not gitignored).

### The docs sync (N024, N025 + the judge-dispatch bullet)

- **README step 8** (`README.md:58-60`): the stale clause at `:59-60` claims the subject appends `+ LinkedIn`. Retired by email-per-surface — `buildSurfaceSubject` (`src/email.ts:68-73`) renders `${postCount} new job post(s) — ${renderSurface(surface)}`; zero `+ LinkedIn` hits in `src/`. The `[linkedin]` body token (`email.ts:136`) stays. New truth pinned at `tests/index.test.ts:521`, `:886`, `:1108`, `:859-861`.
- **README config table** (`README.md:136-142`): add a `negativeKeywords` row after `candidateTerms` (`:139`) — mirrors `WatcherConfig`'s field order (`config-file.ts:49-52`). The key is real end to end: `ALLOWED_KEYS` (`config-file.ts:63`), `readNegativeKeywords` (`:316-321`), prompt threading (`judge.ts:235-238`, `:251`, `:256`, `:279`, `:287`, `:969`, `:1046`), `index.ts:461`, pinned at `tests/index.test.ts:407-439`.
- **AGENTS.md module list** (`AGENTS.md:57-136`): add `judge-availability` (mirrors its header doc `src/judge-availability.ts:2-13`: parallel pre-check, never throws, degrades to all-available with one warning) between `judge-health` (`:128`) and `judge-parse` (`:129`) — the list is topically funnel-ordered, not alphabetical (`judge-rotation :118` precedes `judge-ceilings :121`).
- **Developer decision: add both bullets.** `judge-dispatch` goes between `judge-rotation` and `judge-ceilings` (dependency direction: dispatch consumes rotation's primitives). Content mirrors the moved contracts: the shared HTTP core (429 cooldown re-pick, 5xx backoff as `AttemptDirective` so sleeps run after the release — D7), the wrappers owning byte-exact warn strings (D2), exhausted-is-returned-not-thrown (D6). Do not assert acyclicity in the bullet until the builders' home is settled.

## Code References

- `src/judge.ts:474-667` — `dispatchLlmCall`, the extraction payload (options-object signature `:474-489`, destructure `:490-501`)
- `src/judge.ts:693-775` — `judgeBatch` (builds at `:707`, warn strings `:718-750`, outcome map `:769-774`)
- `src/judge.ts:795-864` — `judgePost` (builds at `:805`, exhausted throw `:853-857`)
- `src/judge.ts:904-1073` — `judgePosts`, stays in judge.ts (11 positional params `:904-916`, state literal `:917-929`, width reduce `:946-953`, forwards `:960-970` and `:1038-1047`)
- `src/judge.ts:233-294` — builders `systemMessage`/`buildMessages`/`buildBulkMessages` (move under the full extract)
- `src/judge.ts:219-223` — `normalizeEndpoint`; `src/judge.ts:371-373` — `terminalFailureReason` (both move)
- `src/judge.ts:300-359` — core types `BatchOutcome`/`ContentDecision`/`DispatchOutcome`/`AttemptDirective`/`DispatchWarns` + the D6 doc `:318-324`
- `src/judge.ts:413-449` — `exhaustionRecord` (moves; judge.ts imports it back)
- `src/judge.ts:391-398` — `allAvailabilityBlocked` (N019 deletes); `src/judge.ts:519-546` — the flavor-split comment + three-arm terminal
- `src/judge-availability.ts:20-27` — the import-surface docblock that re-points to judge-dispatch.js
- `src/judge-rotation.ts:57-63` — `HEALTH_CAP_STREAK` + paired-constant doc; `:203-210` — the health circuit (gate `:208`, ceiling arm `:209`); `:256-261` — claim-time probe registration
- `src/judge-health.ts:41-47` — `HARD_FAIL_TICKS_TO_CAP` + mirrored doc; `:283-285` — the degraded-accounts line
- `src/linkedin-payload.ts:28-30` — `PAYLOAD_VERSION` doc (N018 rewrite); `:43` — `LegStatus` (N020 unexport); `:174-178` — the strict reject
- `src/linkedin-fetch.ts:60`, `:63`, `:66`, `:83`, `:110`, `:136`, `:163`, `:337` — the N020 value/type sites (`:66` is `PACE_MS`, not `PAGE_SIZE`)
- `src/email.ts:68-73` — `buildSurfaceSubject`; `:136` — the `[linkedin]` body token; `:160-189` — `sendText` + fallback `:167-175`; `:309` — `buildLegDeadAlarmText`
- `src/index.ts:51-57` — judge imports; `:440-442` — the blocked mask; `:444-462` — the judgePosts call; `:390`/:432/:486/:537 — the four transport forward sites; `:646`, `:656`, `:671` — the entry catch fence
- `scripts/watch-linkedin.ts:18`, `:38` — the module-scope env side effect + bare invocation (N027)
- `scripts/setup-curl-impersonate.ts:82`, `:163`, `:165` — the tar bound, the unbounded download, the fail path (N028)
- `watcher.config.json:105`, `:117` — the duplicate surface (N026)
- `tests/judge-health.test.ts:132-140`, `:221-235` — the N022 in-file precedent + existing threshold pins
- `tests/judge-rotation.test.ts:869-918` — the health-circuit pick describe (`:909-917` the partial pin)
- `tests/linkedin-fetch.test.ts:24`, `:77`, `:295`, `:398` — the `PAGE_SIZE` import + uses
- `tests/index.test.ts:288-300`, `:1063-1114`, `:1440-1486` — the transport sentinel + seam pins

## Integration Points

### Inbound References
- `src/index.ts:51-57` — imports `judgePosts`, `resolveJudgeConfig`, `sleep` + types from `./judge.js` (unchanged by the extraction)
- `src/judge-availability.ts:27` — runtime-imports `normalizeEndpoint`/`terminalFailureReason`; **re-points to `./judge-dispatch.js`**
- `src/fetch-threads.ts:31` — imports `sleep` (stays in judge.ts)
- `scripts/probe-judge.ts:46` — imports `buildBulkMessages`, `resolveJudgeConfig`; **`buildBulkMessages` + N021's `normalizeEndpoint` re-point to `../src/judge-dispatch.js`**
- `tests/judge-rotation.test.ts:22`, `tests/judge.test.ts:8-15` — import `judgePost`/`judgePosts` (unchanged); `tests/judge.test.ts` also imports `buildBulkMessages` (**re-points**)
- 5 test files type-only `LlmAccount` (`index.test.ts:35`, `judge-availability.test.ts:4`, `judge-ceilings.test.ts:12`, `judge-health.test.ts:24`, `judge-helpers.ts:8`) — unchanged

### Outbound Dependencies
- `src/judge.ts:44-71` — runtime imports `config.js`, `judge-health.js`, `judge-rotation.js`, `judge-parse.js`, `pool.js`; type-only `config-file.js`, `types.js`
- `src/judge-dispatch.ts` (new) — inherits `judge-rotation.js` (8 runtime functions), `judge-health.js` (`stampFailure`/`stampSuccess`), `judge-parse.js`, `config.js`, `pool.js`; type-only `judge.js` (`LlmAccount`, `SleepFn`, `ReasoningEffort`)
- `src/judge-rotation.ts:37-41` — type-only imports only (zero-runtime-import identity preserved)
- `src/judge-health.ts:31-36` — `node:fs/promises`, `node:path`, `config.js`, `state.js` + two type-only

### Infrastructure Wiring
- `src/index.ts:398-403` — the availability stage wiring (`deps.judgeAvailability ?? checkJudgeAvailability`)
- `src/index.ts:444-462` — the judge stage: mask build `:440-442`, ceilings resolve `:449`, the judgePosts call `:451-461`
- `src/index.ts:206-207` — `WatcherDeps.transport` (the N023 memo's injection-precedence anchor)
- `src/index.ts:121-151` — `flushAndSendExhaustionAlarm` (episode bit `:132-137`, transport forward `:139-143`)
- `src/email.ts:164` — the `transport?` DI seam every sender threads
- `scripts/fetch-linkedin.ts:139` — the PC leg's `sendLegDeadAlarm` call (no transport; per-call fallback stays)

## Architecture Insights

- **The seam direction is the invariant.** `judgePosts` calls the wrappers, so judge.ts → judge-dispatch.ts is mandatory; every ownership question resolves by asking which direction the edge must point. The FRD's parenthetical lost to its own constraint — the developer ratified the full extract.
- **Type-only reverse edges are the cycle-escape hatch.** `verbatimModuleSyntax` erases them, which is why `BatchOutcome` can move and be re-imported type-only, and why the two pre-existing madge cycles are ruled fine.
- **Doc comments are load-bearing contracts here.** Three co-located "OUTSIDE the try" statements (`judge.ts:318-324`, `:528-530`, `:854-855`) encode the D6 doctrine; the paired-constant MUST-stay-equal docs (`judge-rotation.ts:61`, `judge-health.ts:45`) are the only guard on a duplicated value across a deliberate boundary. N019's comment edit must not leave a false sentence behind.
- **The repo's DI idiom is optional-param + `??` default** (`transport?`, `sleepFn`, `fetchFn`, `judgeAvailability`). The N023 memo preserves injection precedence structurally rather than by convention.
- **Acceptance greps key on symbols, not modules** — `normalizeEndpoint` in probe-judge.ts and `dispatchLlmCall` in judge-dispatch.ts both survive the re-points.
- **Test files are entry points, not src-graph nodes** — the N022 pin creates two test-rooted edges without touching the forbidden src edge.

## Precedents & Lessons

5 similar past changes analyzed.

### Precedent: Judge module split (the exact model N005 prescribes)
**Commit(s)**: `f14d9f9` — "refactor: split the judge into pool, rotation, and parse modules" (2026-10-30)
**Blast radius**: 15 files across 3 layers (1,791+/1,250-)
  src/ — judge.ts shrank 779 lines moved out into judge-rotation.ts, judge-parse.ts, pool.ts; index.ts, fetch-threads.ts, threads-session.ts re-pointed
  scripts/ — probe-judge.ts switched to shared buildBulkMessages
  tests/ — 7 files; NEW tests/judge-rotation.test.ts (619 lines) + tests/judge-helpers.ts

**Follow-up fixes**:
- `2338274` — "judge: park rewound dispatchers on the free release queue while a release is outstanding" (2026-11-09) — PRODUCTION BUG in the extracted dispatch flavor split: cooldown-first ordering sent rewound 429 dispatchers to the paid park; 11 consecutive watch episodes exited 1 (2026-11-07..09 outage). Touched judge-rotation.ts +37, judge.ts +33, tests/judge-rotation.test.ts ±87, tests/judge.test.ts +47. **This is the exact code region N005 moves.**
- `522395a`/`89cbd42`/`154c473`/`cabd1ba` — four feature touches regrew judge.ts 830→1,092 LOC.

**Takeaway**: Verbatim-move extraction worked last time, but the extracted flavor split then produced the repo's worst production bug — move the `2338274` test pins with the code and keep the new seam type-only where type-only.

### Precedent: Run #2 — dead-export unexport + docs sync (direct template for N020, N024, N025)
**Commit(s)**: `ced76f8` — "refactor: unexport four internal symbols" (2026-10-31); `732a082` — "docs: sync guidance, README, and a judge comment to run 2" (2026-10-31)
**Blast radius**: ced76f8 = 4 src files, 4 lines; 732a082 = 2 guidance docs + README + 1 judge comment

**Follow-up fixes**: none at the time — but the CLASS regrew: run #3 (`8f2debd`, 2026-11-01), run #4 (N012), run #5 finds 12 sites. Docs drifted again too (N024, N025) despite two prior docs-sync passes.

**Lessons from docs**:
- .rpiv/artifacts/solutions/2026-10-31_09-27-45_tech-debt-run2-remediation.md — unexport caveat: a `typeof` type-operand use SURVIVES unexport — check before dropping the keyword.

**Takeaway**: The mechanical unexport + docs-sync playbook is proven (three runs), but expect regrowth — the only durable verification is knip exit 0 plus grepping AGENTS.md module coverage in the same pass.

### Precedent: Run #4 — gated-slice execution shape and accept-and-document closure
**Commit(s)**: `6efe6da`, `bf6594c`, `250a4e1`, `c206d14` (2026-11-03) — the N010-N017 remediation as five gated commits
**Blast radius**: credential guard → module slice → 13-path rewiring slice → workflow+lockfile slice → docs/guidance slice

**Follow-up fixes**: none; validation report 2026-11-03_11-50-05 confirms every phase landed on its declared paths with knip exit 0.

**Lessons from docs**:
- .rpiv/artifacts/plans/2026-11-03_08-38-22_tech-debt-run4-remediation-execution.md — CI tests the PR head ONLY; lint-staged runs Biome autofix mid-commit; guidance mirror files must ride the docs slice or code and docs disagree.
- N017 was closed as accept-and-document — the SAME closure type the FRD chooses for N018.

**Takeaway**: Slice commits each-green with the docs/guidance slice LAST is the house style; an accept-and-document closure must state precisely what the next auditor will re-check.

### Precedent: Email-per-surface — the change that CREATED N018 and N023
**Commit(s)**: `a910163` — "Send one email per surface" (2026-11-09, PR #16)
**Blast radius**: 14 files across 3 layers — email.ts rewritten (±144), index.ts notify stage (+94), linkedin-payload.ts v1→v2 envelope; tests/email.test.ts churned ±532

**Follow-up fixes**:
- `197d6b9` — "Name the stale PC loop in the no-stamp orphan warning" (2026-11-09) — the warning now points at "git pull + watch-linkedin restart"; N018's contract doc must use consistent wording.

**Takeaway**: The N023 fix threads values through the exact paths a910163 just rewrote — the ±355-line tests/index.test.ts from that change is the safety net; don't disturb its transport-injection expectations.

### Precedent: setup-curl-impersonate CI breakage (N028's file)
**Commit(s)**: `42b8cf8` — "setup-curl: win32-only tests inject platform win32; linux ci green (fixes #14)" (2026-11-09)
**Blast radius**: 1 test file, 6 lines — no production change

**Lessons from docs**: PR body evidence — the script's platform gate fires before code under test; the suite owns the seam (`SetupCurlDeps.platform`) and injection is the fix.

**Takeaway**: N027/N028 touch PC scripts whose tests must stay offline and platform-seamed; the timeout must not perturb the win32-gate test structure.

### Composite Lessons
- **Extracted judge seams breed the subtlest bugs**: `f14d9f9`'s dispatch flavor split later caused 11 consecutive failed watch episodes (`2338274`). N005 moves that split — preserve its test pins verbatim and keep the new seam runtime-cycle-free.
- **The dead-export class is a treadmill**: fixed in runs #2/#3/#4, regrown to 12 sites by run #5. Check `typeof` type-operand uses before unexporting; make `npx knip` exit 0 the acceptance gate since no CI gate exists.
- **Docs sync decays within one cycle**: two prior docs passes and drift still reopened as N024/N025 — sync ALL surfaces named in the audit (README step 8 + config table, AGENTS.md module list, guidance mirrors) in one slice, and word N018's payload contract consistently with `197d6b9`'s stale-PC-loop warning.
- **Feature velocity mints the debt being paid**: `a910163` created both N018 and N023; four judge features regrew judge.ts into the N005 escalation. Close every finding at its prescribed depth, not partially.
- **House execution rules from run #4**: each commit green under typecheck/lint/test, CI tests PR head only, Biome autofix runs mid-commit, docs/guidance mirrors land in the final slice, conventional-commit messages.

## Historical Context (from `.rpiv/artifacts/`)
- .rpiv/artifacts/TECH_DEBT_AUDIT.md — the run-#5 input report; all N-numbers and file:line citations
- .rpiv/artifacts/discover/2026-11-09_18-39-48_tech-debt-zero-findings.md — the FRD this research chains from
- .rpiv/artifacts/solutions/2026-10-31_09-27-45_tech-debt-run2-remediation.md — the unexport `typeof` caveat
- .rpiv/artifacts/plans/2026-11-03_08-38-22_tech-debt-run4-remediation-execution.md — the gated-slice execution shape
- .rpiv/artifacts/validation/2026-11-03_11-50-05_tech-debt-run4-remediation-validation.md — knip exit 0 verification precedent
- .rpiv/artifacts/research/2026-11-01_11-26-26_tech-debt-run3-clean-baseline.md — the noUnusedLocals precedent
- .rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md — the DI sleep-seam idiom

## Developer Context
**Q (`src/judge.ts:474-667` + `src/judge-availability.ts:27`): The FRD's N005 move list creates the exact runtime cycle it forbids — judge.ts must import judgeBatch/judgePost back from judge-dispatch.ts (`src/judge.ts:960`, `:1038`), so `normalizeEndpoint` (`:559`) and `terminalFailureReason` (`:598`) cannot stay in judge.ts. Which layout closes the cycle?**
A: Full extract. Builders, wire helpers, wrappers, core types all land in judge-dispatch.ts; judge-availability.ts:27 and probe-judge.ts:46 re-point their imports.

**Q (`src/linkedin-fetch.ts:63` vs `:66`): The FRD's N020 list cites PAGE_SIZE at :66, but :66 is PACE_MS — PAGE_SIZE sits at :63 and is value-imported by tests/linkedin-fetch.test.ts:24. The audit's 8+4=12 count only adds up if knip's row was PACE_MS. How do we reconcile before editing?**
A: Run knip first. Fresh `npx knip` run before editing; unexport exactly the symbols it names.

**Q (`AGENTS.md:57-129`): N025 adds the missing judge-availability bullet. The N005 extraction creates src/judge-dispatch.ts the FRD does not list — landing it without a bullet re-opens the identical finding class in the next audit, against the zero-findings bar. Add a judge-dispatch bullet in the same pass?**
A: Add both bullets. judge-availability between judge-health and judge-parse; judge-dispatch between judge-rotation and judge-ceilings.

**Q (discover: Success bar): What does "fix all the tech debt" mean — what does success look like when this pass is done?**
A: Zero open findings — every open finding N018-N029 + N005 fixed this pass, next audit opens nothing.

**Q (discover: Hygiene batch scope): Which hygiene fixes should I apply as recommended?**
A: All four groups + "everything reported" (config/repo/docs, script guards, micro-fixes, email transport).

**Q (discover: N018 reader policy): The committed LinkedIn payload is version 1 but the reader only accepts version 2 (`src/linkedin-payload.ts:174`). How should the reader treat v1 envelopes?**
A: Keep v2-only reject — strict schema contract wins over platform continuity.

**Q (discover: N018 closure mode): You chose to keep the v2-only reject. So how does N018 close?**
A: Document the contract (accepted-and-documented) — matches the existing row-level orphan doctrine (`src/index.ts:517-522`).

**Q (discover: N005 extraction depth): judge.ts is 1,092 lines and judgePosts takes 11 positional params. How far should the split go?**
A: Full extract + options object.

**Q (discover: N019 dead branch): Collapse the byte-identical exhausted pair?**
A: Collapse to one return, keep the comment.

**Q (discover: N020 scope): knip flags 12 dead exports. Unexport all, and add a knip gate to CI?**
A: Unexport all 12; NO knip CI gate.

**Q (discover: Acceptance bar): What must pass before this counts as done?**
A: 3 gates + knip 0.

**Q (discover: Open questions folding): The audit carries 8 open questions. Fold any into this pass?**
A: Defer all (6 remain open; Q1 and Q8 are resolved by the N018 and canary decisions).

**Q (discover: Canary deletion): .probe-dispatch-canary is tracked at the repo root. Delete it?**
A: Delete it.

## Related Research
- .rpiv/artifacts/research/2026-11-01_11-26-26_tech-debt-run3-clean-baseline.md — run #3 baseline

## Open Questions
- Audit Q2: platforms.linkedin is pinned false while the PC loop keeps fetching ~19 surfaces/tick — intentional for how long? Gating the PC loop on the same key would save tick load and account exposure.
- Audit Q3 (carried, operator-side): were the orphaned GitHub secrets deleted — LINKEDIN_SESSION_STATE, LINKEDIN_EMAIL, LINKEDIN_PASSWORD, LINKEDIN_SECRET_WRITER, plus any @linkedapi/node token pair from the SDK era? Unverifiable from the tree.
- Audit Q4 (carried x3): is reasoning_effort verified against every pool endpoint? The availability probe omits the field; a proxy that rejects it passes availability and then fails every judge batch as a non-distinct cause.
- Audit Q5 (carried x4): tests for the probe's ramp math — findConcurrencyCeiling's boundary math is pure and testable; still the only nontrivial logic without a test.
- Audit Q6 (carried x4): .rpiv/artifacts keeps growing (~50 tracked md files). Pruning policy, or intentional archive?
- Audit Q7 (carried x3): negative state deltas still commit as "state: -N new seen post ids" — deliberate greppability, or should a negative delta say "pruned"?
- N020 reconcile: does fresh `npx knip` name `PACE_MS` (expected) or `PAGE_SIZE` at `src/linkedin-fetch.ts`? Resolved by the first implement step, before any edit.
- N028 environment caveat: on Windows, `process.exit` following an `AbortSignal.timeout` fetch can crash with the libuv assertion / exit 127 instead of 1 — pre-existing quirk, not a regression; CI runs on ubuntu where exit 1 is clean.

## Follow-up Research 2026-11-10T06:51:00+0700
- **Trigger**: the N020 reconcile open question — does fresh `npx knip` name `PACE_MS` or `PAGE_SIZE` at `src/linkedin-fetch.ts`?
- **Evidence**: `npx knip --no-exit-code` (knip@6.44.2, first run downloads the package, exit 0, ~11s). Unused exports (8): `buildLegDeadAlarmText` `src/email.ts:309`, `HEALTH_VERSION` `src/judge-health.ts:39`, `LINKEDIN_FETCH_CONCURRENCY` `src/linkedin-fetch.ts:60`, **`PACE_MS` `src/linkedin-fetch.ts:66`**, `CURL_IMPERSONATE_PROFILE` `:83`, `LEG_DEAD` `:110`, `ALL_SURFACES_FAULTED` `:136`, `createPlaywrightTransport` `:337`. Unused exported types (4): `PlatformFlags` `src/config-file.ts:40`, `FaultKind` `src/linkedin-fetch.ts:163`, `LegStatus` `src/linkedin-payload.ts:43`, `VoyagerStorageCookie` `src/linkedin-session.ts:144`. 8+4=12 — matches the audit count exactly.
- **Resolution**: the `:66` row is `PACE_MS` — the FRD's `PAGE_SIZE` name is confirmed a transcription error. `PAGE_SIZE` (`src/linkedin-fetch.ts:63`) is NOT flagged; it stays exported for `tests/linkedin-fetch.test.ts:24`, zero test edits needed for the dead-export batch. The N020 mechanical list is the 11 unambiguous symbols with `PAGE_SIZE` → `PACE_MS` swapped. The LegStatus-before-N018-doc sequencing and the knip 0/0 gate are unchanged. This open question is closed.
