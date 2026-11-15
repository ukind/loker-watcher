---
date: 2026-11-15T09:09:30+0700
author: Yogiswara Utama
commit: 3e7f02f
branch: main
repository: loker-watcher
topic: "Remove the LinkedIn working-hours window"
tags: [research, codebase, linkedin-pc-leg, working-window, fetch-tick, linkedin-behavior]
status: ready
last_updated: 2026-11-15T09:09:30+0700
last_updated_by: Yogiswara Utama
---

# Research: Remove the LinkedIn working-hours window

## Research Question
Delete the Mon-Fri 08:00-21:00 local working-hours window from the PC-local LinkedIn leg entirely — the predicate, its constants, the tick gate, the `bypassWindow` dep seam, their tests, and every doc claim — with no replacement gate and no bypass switch. After removal every tick runs on any day at any hour, manual and `watch-linkedin` loop alike. Chained from `.rpiv/artifacts/discover/2026-11-15_08-44-36_remove-linkedin-working-window.md` (the FRD; its Decisions are carried into Developer Context below).

## Summary
The window is a three-symbol predicate trio in `src/linkedin-behavior.ts` with exactly one production consumer: the preflight gate in `fetchTick` (`scripts/fetch-linkedin.ts:383`), plus one bypass dep seam (`bypassWindow`, `scripts/fetch-linkedin.ts:138`) and one test suite per site. The always-on loop (`runLoop`, `scripts/watch-linkedin.ts:48-83`) never reads the clock for gating — every gate rides `fetchTick` — so deleting the predicate makes the loop 24/7 by construction, bounded only by the halt latch, the leg-dead episode alarm, and the `harvestedAt` stamp gate. The change is a pure dead-code excision: one predicate + two constants + one dep field + one gate block + one test inversion + a doc sweep.

The FRD's core scope is verified accurate. Three corrections and three additions surfaced during research: (1) `scripts/watch-linkedin.ts:4-5` DOES name the window (the FRD claimed zero references in that file) and also names "the daily budget", a machine already deleted by the browser-walk migration 2026-11-11; (2) the FRD's "strict TS catches the unused import" premise is not armed — `tsconfig.json` sets no `noUnusedLocals`/`noUnusedParameters`, so biome lint plus the tests are the real guards; (3) three window-derived claims sit outside the FRD's edit list — `src/linkedin-capture.ts:41` (retention churn math), `scripts/replay-linkedin.ts:54,71-80` ("one working day" roll-off math), and the stale budget half of `scripts/watch-linkedin.ts:4-5`. The FRD's acceptance grep pattern misses the first two ("working-hours cadence" and "one working day" match neither alternative).

## Detailed Findings

### The window predicate surface (`src/linkedin-behavior.ts`)
- Definition site: `WINDOW_START_HOUR` doc 22-25, decl **26**; `WINDOW_END_HOUR` doc 28-32 (exclusive-end contract, half-open `[start, end)`), decl **33**; `isWithinWorkingHours` doc 35-42 (four boundary pins), decl **43-48** — `getDay()` at 44, weekday band `if (day < 1 || day > 5) return false` at 45, `getHours()` at 46, comparison at 47. Every read is local-time, never UTC (doc line 37).
- Module header names the window twice: line **5** (machine list) and lines **15-19** ("Worst-case arithmetic": window = 13 hours = 780 minutes → at most 28 wake-ups per local day at the 28-minute floor, each walking ≤5 surfaces; line 18 asserts "The window lives here; the click cap rides the walk (src/linkedin-fetch.ts)").
- Surviving exports (verified by line): `RandomFn` **55**, `WAKE_MIN_MS` **58**, `WAKE_MAX_MS` **66**, `sampleTickDelayMs` **73-75**, `HALT_RATE_LIMIT_REASON` **82-83**, `HALT_CHECKPOINT_REASON` **92-93**. Line 8 (extraction-idiom comment citing `src/judge-rotation.ts:5-7`) survives. `WAKE_MAX_MS`'s doc (62-64) references `PAYLOAD_MAX_AGE_MS 30 -> 40 min` — a hosted-reader bound, unrelated to the window; survives.
- Importer sweep (live code only): `src/` has ZERO importers of any window symbol (`src/linkedin-fetch.ts:30` imports only `type RandomFn`; `src/linkedin-walk.ts:15` imports only `HALT_CHECKPOINT_REASON`). `scripts/` has exactly one: `scripts/fetch-linkedin.ts:39`. No file anywhere imports `WINDOW_START_HOUR` or `WINDOW_END_HOUR` outside the defining module.
- `HALT_RATE_LIMIT_REASON` (`src/linkedin-behavior.ts:82-83`) has NO production writer — the browser-walk migration removed the HTTP layer; its only consumers are the vocabulary pins at `tests/linkedin-behavior.test.ts:96-98`. The only production halt-reason writer is `src/linkedin-walk.ts:152` (`assertNoCheckpoint` → `halt(HALT_CHECKPOINT_REASON)`), which flows through `src/linkedin-fetch.ts:304` and the join re-throw at 332 into `fetchTick`'s halt arm.

### The tick preflight band (`scripts/fetch-linkedin.ts`)
- `fetchTick` entry **365**; `now` bound **367**; surfaces filter 368-371; no-surfaces quiet-zero **372-375** (untouched).
- The band: comment **376-379** (ordering clause "Order: window -> latch." is the tail of 379); `latchPath` **380** (stays — feeds the latch branch and the halt arm); `rng` **381** (stays — walk pacing); `const at = new Date(now())` **382** (doomed — sole consumer is line 383); gate **383**; quiet-zero log **384-386** (string at 385); return **387**; close **388**.
- Latch gate **389-394**: `latchPresent` probe (helper 248-255), log 390-392, return **393** — byte-identical quiet-zero literal to 387. `guardCheckout` call **399** (definition 296-312: `rev-parse` 297, branch parse 298, non-main throw 299-302 BEFORE `status --porcelain` 304, dirty throw 305-311).
- `now` is NOT orphaned by deleting `at`: surviving consumers are **434** (into `fetchLinkedInPosts` options — walk pacing/shuffle clock), **445** (`tripLatch(latchPath, error.reason, now)` in the halt arm), **477** (`writePayloadAtomic(posts, payloadPath, now)` — payload `writtenAt` stamp). Line 382 was the only time-of-day read.
- Post-removal band order: latch (389-394) → `guardCheckout` (399) → cookie resolver (400) → `harvestedAt` throw (407-411) → seen-set (417) → walk (430-439) → halt arm (444-449) → payload stamp (477) → push (479).

### The `bypassWindow` dep seam
- Declaration `scripts/fetch-linkedin.ts:138`, doc comment 133-137 ("The offline suite injects true so a tick can run at any pinned clock; production never sets it"). Its only reader is the gate condition at 383.
- Production callers set it NOWHERE: `scripts/watch-linkedin.ts:50` (`fetchTick({ env })`), `scripts/linkedin-chain.ts:87` (`fetchTick({ env: legEnv })`), `scripts/fetch-linkedin.ts:486` (entry, env only). `scripts/probe-linkedin.ts` never calls `fetchTick` (comment mentions only).
- Under `exactOptionalPropertyTypes` + excess-property checking on object literals, the only type-visible producers are the 16 test injections — a missed one fails `npm run typecheck`, making the sweep mechanically verifiable.

### The 16 test injections (`tests/fetch-linkedin.test.ts`)
Exactly 16, at **418, 471, 505, 542, 573, 597, 615, 632, 667, 701, 822, 890, 916, 944, 979, 1038** — matching the FRD list. Pinned clocks ride along and become inert-but-harmless (no post-removal path reads the clock for window purposes): 418/505/542/573/597/632/890/1038 pin `T0`; 916 and 944 pin `mondayTen` (902, 931); 979 pins an inline Monday-10:00 clock (978); 471, 615, 667, 701, 822 inject no `now` at all (they exit — guard throw, latch return, early return — before any clock consumer).

### The test inversion (mandatory, not cosmetic)
- The doomed gate test `tests/fetch-linkedin.test.ts:830-847`: Saturday-noon clock pinned at 831 (`new Date(2026, 9, 31, 12, 0)`), `scriptGit()` unscripted at 834 (default arm returns `{code: 0, output: ""}`), latch path never written, NO `bypassWindow` flag. Post-removal the same deps run the latch check (absent) then `guardCheckout`: `rev-parse` → empty output → `branch = ""` → throws `/not main/` at 299-302. The quiet-zero assertion at 844 is unreachable — the inversion is required.
- The Monday proceeds-pin `tests/fetch-linkedin.test.ts:849-869`: `mondayTen` at 850, `scriptGit({ "rev-parse": { code: 0, output: "feature\\n" } })` at 853, `assert.rejects(..., /not main/)`, `git.calls.length >= 1` at 867, `built.value === 0` at 868. Verified: NO `bypassWindow` flag — it keeps working verbatim after the gate and seam die; only its "inside the window" title premise evaporates (comment-only retitle).
- Clock coverage of the old predicate's two conjuncts (`Mon-Fri` AND `08:00-21:00`): Saturday-noon defeats the day conjunct; Monday-10:00 defeats neither (it was inside the window) but pins guard-precedes-walk on a weekday clock. NEITHER defeats an hours-only reintroduction (a 08-21-every-day gate admits both).

### The quiet-zero contract that survives
- `fetchTick` has SIX quiet-zero return sites today, all emitting the identical literal `{ wrote: false, pushed: false, postCount: 0 }`: zero-surfaces **374**, window gate **387** (dies), latch present **393**, halt trip **448**, all-faulted **459**, zero-post walk **475**. Five survive.
- The chain's classifier `scripts/linkedin-chain.ts:116` is purely shape-based (`!wrote && !pushed && postCount === 0`); the no-op report at 118-120 is gate-name-free ("a quiet gate held"); the done line 123-127 prints only `no-op` vs `wrote N post(s)`. Deleting one producer is invisible to it.
- The chain's "five gates" comment at 112-115 counts the NAMED list (halt latch, halt trip, all-faulted walk, zero surfaces) — the zero-post arm at 469 was never named. Post-removal: five return sites, four named gates. The shrunken named-list must land in lockstep at `scripts/linkedin-chain.ts:21-22`, `AGENTS.md:58-59`, `.rpiv/guidance/scripts/architecture.md:10` and 112-114.
- `tests/linkedin-chain.test.ts` (229 lines) and `tests/watch-linkedin.test.ts` (135 lines): ZERO window references in code or comments. The D3 describe (`tests/linkedin-chain.test.ts:208-229`) pins only shapes and log regexes (`/tick no-op — a quiet gate held/`, `/done — probe 12 post\\(s\\), tick no-op,/`) — never a gate name. The chain suite imports `fetch-linkedin.ts` type-only (line 23, erased under `verbatimModuleSyntax`). `runLoop`'s tick call (`scripts/watch-linkedin.ts:65`) discards the return value — the loop is structurally blind to which quiet-zero producer fired.

### Exit contracts (bit-identical after removal)
- `scripts/fetch-linkedin.ts` entry tail 484-496: leg-dead → `handleLegDeadEpisode` → `process.exit(1)` (488-490); every other throw (mis-homed checkout, failed push, stampless cookies) → catch-all `process.exit(1)` (492-494); all-faulted resolves → implicit exit 0. The window gate is a `return`, so it never touched this catch.
- `scripts/watch-linkedin.ts:85-91`: the outer catch only sees faults outside the per-tick try; leg-dead is swallowed at 66-73 into `onLegDead`.
- `scripts/linkedin-chain.ts:131-144`: quiet-zero ticks resolve (classified 116, reported 117-121) → implicit exit 0; any stage throw → catch-all 136-142 → `process.exit(1)`.
- What changes is only the reachable outcome population at a given wall-clock: an off-hours tick previously resolved through the window gate (exit 0, zero git spawns); post-removal the same clock traverses latch → guardCheckout → the full walk. The contract's shape is unchanged; the off-hours outcome population changes by design.

### The 24/7 consequence and the surviving protections
- `runLoop` (`scripts/watch-linkedin.ts:48-83`): default tick at 50; per iteration `await tick()` 65, `sampleTickDelayMs(rng)` 74, local wake computation 75-77, wake log 78-80, `sleepFn(delayMs)` 81. No logic change needed — only its stale header comment at 4-5.
- Protections bounding a 24/7 tick: halt latch (`DEFAULT_LATCH` 157, `latchPresent` 248-255, branch 389-394, trip arm 444-449 with `tripLatch` 262-271 + best-effort alarm 276-289); leg-dead one-alarm-per-episode (`handleLegDeadEpisode` 205-234, marker 150, `clearEpisodeMarker` 236-243 invoked at 474/481, loop catch 66-73, one-shot mirror 487-492); `harvestedAt` stamp-presence throw (comment 401-406, gate 407, throw 408-410).
- The stamp's AGE is never checked anywhere. A cookie file stamped weeks ago passes preflight every 28-33 minutes until the session dies (leg-dead alarm) or a checkpoint appears (latch + one alarm). This is the FRD's flagged follow-up and is more load-bearing under 24/7.
- New worst-case arithmetic at the 28-minute floor: 1440/28 = 51.43 → at most **52 wake-ups per local day** (vs. the old window's 28); per week 10,080/28 = **360 wake-ups** (vs. 140). ~1.86× the old bound.

### Doc claims and the residue sweep
- FRD-listed spots verified: `.rpiv/guidance/scripts/architecture.md:10` (chain invoker quiet-zero list), **32** (fetch-linkedin structure comment — the mirror of the code comment at `scripts/fetch-linkedin.ts:376-379`; both must move together), **112-114** (exit-contract chain row); `AGENTS.md:58-59` (chain bullet parenthetical), **103-105** (behavior machine list — the mirrored twin of the module header at `src/linkedin-behavior.ts:3-5`). `README.md` verified clean.
- `scripts/linkedin-chain.ts`: two comment sites — header gate list 21-22 and the "five gates" count at 112-115. Code inertness verified: `runLinkedInChain` (83-129) has zero time-of-day logic (only the duration report at 88/89/122); the entry guard at 131-144 is untouched by a header edit.
- `scripts/watch-linkedin.ts:4-5`: ONE comment with TWO stale claims — the window (dies with this change) and "the daily budget" (already false today: deleted by the browser-walk migration 2026-11-11, attested by the history comments at `src/linkedin-behavior.ts:3-4` and `scripts/fetch-linkedin.ts:376-377`; `FetchTickDeps` has no budget field; a live-path grep for `daily (GET )?budget` returns zero hits outside those two history comments).
- `src/config-file.ts:73-81`: the FR-8 comment's account-safety parenthetical — "the working-hours window and the jittered cadence, times the per-surface scrollRounds click cap ... calibrated for a five-surface fleet". Corrected: the bound is the remaining conjuncts only. The runtime error at `src/config-file.ts:214` already says "(the PC leg's pacing arithmetic assumes it)" — window-free, no edit. The acceptance grep DOES catch line 75.
- `src/linkedin-capture.ts:35-46`: "At the working-hours cadence (~24-28 walks per weekday) that is ~2-2.4 GB of write churn per day". Arithmetic verified true today (780/33 ≈ 23.6 low, 780/28 ≈ 27.9 high; × ~85 MB measured per walk = 2.04-2.38 GB). Under 24/7: 1440/33 ≈ 43.6 low, 1440/28 ≈ 51.4 high → **~43-51 wake-ups/day**, × 85 MB ≈ **3.66-4.34 GB/day**. The next sentence (42-44, "keep-N × ~85 MB (~1.7 GB steady-state at 20)") is cadence-independent and stays. The acceptance grep does NOT catch this line ("working-hours cadence" matches neither alternative).
- `scripts/replay-linkedin.ts:54,71-80`: three cadence-coupled claims the acceptance grep also cannot match — module header 54 ("captures roll off after ~20 sessions — one working day"), USAGE doc comment 71-78, and the USAGE string itself 79-80 (printed by the zero-argv gate). "20 sessions ≈ one working day" was grounded by 24-28 walks/weekday (20 < 24). Under 24/7: 20 ÷ 43-51 ≈ **9-11 hours — roughly half a working day**. Operator-visible CLI output; inside typecheck + lint (the `lint` script names the file explicitly).
- Acceptance-grep gap: the FRD's six-literal alternation matches every live residue site EXCEPT `src/linkedin-capture.ts:41` and the three `scripts/replay-linkedin.ts` spots. Bare `working-hours` produces zero false positives across live paths (false positives only appear with bare `working` — "Still working" `src/email.ts:237,265`, "working directory" `src/env-file.ts:18`, "keeps working" `src/linkedin-session.ts:38,136`, "working in this repository" `AGENTS.md:3`).

## Code References
- `src/linkedin-behavior.ts:22-48` — the window trio: WINDOW_START_HOUR (26), WINDOW_END_HOUR (33), isWithinWorkingHours (43-48) with doc comments
- `src/linkedin-behavior.ts:1-20` — module header: machine list (5) + worst-case arithmetic (15-19) + extraction idiom (8)
- `src/linkedin-behavior.ts:50-93` — survivors: RandomFn (55), WAKE_MIN_MS (58), WAKE_MAX_MS (66), sampleTickDelayMs (73-75), HALT_RATE_LIMIT_REASON (82-83), HALT_CHECKPOINT_REASON (92-93)
- `scripts/fetch-linkedin.ts:39` — the sole production import of isWithinWorkingHours
- `scripts/fetch-linkedin.ts:133-138` — the bypassWindow dep seam + doc comment
- `scripts/fetch-linkedin.ts:376-394` — the preflight band: comment (376-379), at (382), gate (383-388), latch (389-394)
- `scripts/fetch-linkedin.ts:296-312` — guardCheckout (rev-parse 297, non-main throw 299-302, status 304, dirty throw 305-311)
- `scripts/fetch-linkedin.ts:365-483` — fetchTick body: entry (365), now (367), no-surfaces (372-375), cookie resolver (400), stamp throw (407-411), walk (430-439), halt arm (444-449), payload stamp (477)
- `scripts/fetch-linkedin.ts:484-496` — entry tail: leg-dead arm (488-490), catch-all exit 1 (492-494)
- `scripts/fetch-linkedin.ts:150` — DEFAULT_MARKER; 157 — DEFAULT_LATCH; 205-234 — handleLegDeadEpisode; 248-255 — latchPresent; 262-271 — tripLatch; 276-289 — defaultHaltAlarm
- `scripts/watch-linkedin.ts:4-5` — stale header: window + daily budget; 19 — the only linkedin-behavior import (RandomFn, sampleTickDelayMs); 48-83 — runLoop; 85-91 — entry guard
- `scripts/linkedin-chain.ts:21-22` — header gate list; 112-115 — "five gates" count; 116 — tickNoop classifier; 118-120 — gate-name-free no-op report; 131-144 — entry wrapper
- `tests/linkedin-behavior.test.ts:12-20` — import block (window names at 17-19); 38-63 — the isWithinWorkingHours describe (its at 39, 44, 49, 54, 58); 65-92 — sampleTickDelayMs describe (survives); 94-104 — halt vocabulary describe (survives)
- `tests/fetch-linkedin.test.ts:418,471,505,542,573,597,615,632,667,701,822,890,916,944,979,1038` — the 16 bypassWindow injections
- `tests/fetch-linkedin.test.ts:807-870` — the band describe: header (807), title (809), latched tick (810-828), doomed gate test (830-847), Monday proceeds-pin (849-869)
- `tests/fetch-linkedin.test.ts:685` — the exact-content git.calls pin form (deepEqual with the single rev-parse call)
- `tests/linkedin-chain.test.ts:208-229` — the D3 describe (shape + log-regex pins only); 23 — type-only fetch-linkedin import
- `tests/watch-linkedin.test.ts:15` — imports only WAKE_MAX_MS, WAKE_MIN_MS, sampleTickDelayMs (no window symbols)
- `src/config-file.ts:73-81` — the FR-8 comment (window mention at 75) + LINKEDIN_SURFACE_COUNT (81); 214 — the window-free runtime error
- `src/linkedin-capture.ts:35-46` — the retention comment (cadence math at 41) + CAPTURE_KEEP_SESSIONS (46)
- `scripts/replay-linkedin.ts:54`, `71-80` — the "one working day" roll-off claims (header, USAGE doc, USAGE string)
- `AGENTS.md:58-59`, `103-105` — the two window mentions
- `.rpiv/guidance/scripts/architecture.md:10`, `32`, `112-114` — the three window mentions

## Integration Points

### Inbound References
- `scripts/fetch-linkedin.ts:39` — the only direct importer of isWithinWorkingHours; 383 — the only reader of the predicate and of deps.bypassWindow
- `scripts/watch-linkedin.ts:50` — fetchTick({ env }) — the loop reaches the window only transitively
- `scripts/linkedin-chain.ts:87` — fetchTick({ env: legEnv }) — transitively; 116 consumes the quiet-zero SHAPE
- `tests/fetch-linkedin.test.ts:830-847` — the only test probing window semantics without the bypass flag (must invert)
- `tests/linkedin-behavior.test.ts:38-63` — the predicate's direct suite (must be deleted)

### Outbound Dependencies
- `src/linkedin-behavior.ts:8` — cites src/judge-rotation.ts:5-7 (extraction idiom; survives)
- `src/linkedin-behavior.ts:18` — cites src/linkedin-fetch.ts (click cap residency; reword with the arithmetic paragraph)
- `scripts/fetch-linkedin.ts:399` — guardCheckout (296-312) becomes the band's second gate
- `scripts/fetch-linkedin.ts:430-439` — fetchLinkedInPosts (src/linkedin-fetch.ts) receives now at 434
- `src/linkedin-walk.ts:152` — the only production writer of HALT_CHECKPOINT_REASON (survives)

### Infrastructure Wiring
- `tsconfig.json` — include ["src", "tests", "scripts"]; flags strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, noEmit — NO noUnusedLocals/noUnusedParameters
- `package.json` — typecheck = tsc --noEmit; lint = biome check over an enumerated file list (every .ts edit site is named explicitly, including scripts/replay-linkedin.ts)
- `biome.json` — recommended: true (the real unused-import guard)
- `tests/fetch-linkedin.test.ts:316-325` — scriptGit's default arm ({code: 0, output: ""} for unscripted commands) — the reason the Saturday test now throws /not main/

## Architecture Insights
- **One gate, two roles**: the preflight block at `scripts/fetch-linkedin.ts:376-394` is both the window's only production consumer and the first stage of the latch sequence that bounds the 24/7 loop. Deleting the gate moves the latch to first-in-band without moving its lines otherwise.
- **One ordering contract, three documents**: "Order: window -> latch" (`scripts/fetch-linkedin.ts:379`) ↔ the test describe title (`tests/fetch-linkedin.test.ts:809`) and header (11) ↔ `.rpiv/guidance/scripts/architecture.md:32`. All shrink together.
- **One enumeration, five copies**: the five-gate quiet-zero list appears at `scripts/linkedin-chain.ts:21-22`, `AGENTS.md:58-59`, `.rpiv/guidance/scripts/architecture.md:10` and 112-114, plus the ordering form at `scripts/fetch-linkedin.ts:379`. All must shrink to four in lockstep.
- **Two machines, two mirrored lists**: `src/linkedin-behavior.ts:3-5` (header) and `AGENTS.md:103-105` are the same two-machine enumeration; both shrink together.
- **One cadence, three dependent claims**: the 13-hour/780-min/28-wake-ups arithmetic at `src/linkedin-behavior.ts:15-19` grounds `src/linkedin-capture.ts:41-42` (walks/day → GB/day) and `scripts/replay-linkedin.ts:54/71-80` (20 sessions ≈ one working day). Deleting the grounding paragraph forces both to recompute to the 24/7 cadence or decouple from it.
- **The window is a load-bearing volume bound**: after the budget machine's deletion (2026-11-11), the surviving volume bounds are exactly three — the window, the 28-33-min cadence, and the per-surface click cap. Removing the window raises the worst-case day from 28 to 52 wake-ups (~1.86×).
- **The loop is structurally window-agnostic**: `runLoop`'s tick call discards the return value (`scripts/watch-linkedin.ts:65`); every quiet-zero resolves, so pre-removal the loop simply slept through off-hours ticks. No loop logic change is entailed.
- **`now` serves two roles**: window-gate input today (382), payload/latch/walk stamp post-removal (434/445/477) — which is why only `at` dies and every pinned clock in the suite stays valid.

## Precedents & Lessons
2 similar past changes analyzed.

### Precedent: the browser-walk migration deleted the daily GET budget machine from the same module
**Commit(s)**: `8e8f22b` — "Migrate the LinkedIn leg to a browser walk" (2026-11-11); docs sweep `a88494e`; artifacts `c17191a`
**Blast radius**: 25 files, ~2,155+/2,790- across 5 layers
  - `src/linkedin-behavior.ts` — deleted DAILY_GET_BUDGET, DailyBudgetState, freshBudget, localDateKey, budgetAllows, HALT_BUDGET_REASON (the analogous deletion-set shape)
  - `scripts/fetch-linkedin.ts` — deleted the budget wrapper + DEFAULT_BUDGET + the preflight budget step
  - `tests/linkedin-behavior.test.ts`, `tests/fetch-linkedin.test.ts` — deleted the budget suites
  - `src/email.ts` — buildHaltAlarmText de-budgeted; `scripts/reset-linkedin.ts`, `src/config*.ts` de-budgeted
  - `README.md` / `AGENTS.md` / `.rpiv/guidance/*` — doc sweep

**Follow-up fixes**:
- `9fa2a7e` (2026-11-11, same day) — live rehearsal killed the migration's session/liveness assumptions: cookie-document session dead, liveness gate timed out on healthy pages
- `cd2297f` (2026-11-14) — walk fixes: seen-streak folded in wrong order; the 150-post cap was not a real bound
- `20c5f28` (2026-11-15) — recovered parser mis-paired digest permalinks

**Lessons from docs**:
- `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md` (line 94) — the deletion-set was enumerated exhaustively FIRST (every constant, interface, function, reason-enum member, wrapper, preflight step, suite)
- Same doc (line 1733, Slice 5 checkpoint) — the locked Files line omitted `reset-linkedin.ts`, which imported the deleted DEFAULT_BUDGET; discovered mid-slice, scope amended
- Same doc (line 111) + `README.md:334` — the runtime ledger file `state/linkedin-get-budget.json` was deliberately left orphaned on disk (untracked); README carries a permanent manual-cleanup note and the .gitignore rule was KEPT
- `src/linkedin-behavior.ts:2-4` — the header was patched in-commit to say "the daily GET budget machine deleted by the browser-walk migration" — the reference to the deleted machine still survives today

**Takeaway**: deleting a gate machine from linkedin-behavior.ts is doable in one commit, but it took an exhaustive deletion-set inventory to avoid a mid-flight typecheck break — and the live system still needed 3 fix commits in the following 4 days.

### Precedent: the window itself was introduced by the humanlike-fetch commit
**Commit(s)**: `7558747` — "Add LinkedIn humanlike fetch behavior" (2026-11-10)
**Blast radius**: 23 files, ~1,969+/235- across 5 layers — `src/linkedin-behavior.ts` (+152: window, cadence, budget), `scripts/fetch-linkedin.ts` (+215: preflight band "window, latch, budget"), `scripts/watch-linkedin.ts` (+89), 7 test files, `src/email.ts` (halt alarm)

**Follow-up fixes**: none directly to the window, but the entire band it sat in was restructured one day later by `8e8f22b`.

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-11-09_17-29-56_linkedin-humanlike-fetch-behavior.md` — why the window existed: make the PC-local leg "behave like a person instead of a metronome"; volume inside the documented 40-250 GET/day survival envelope (~130/weekday target). The window was amended post-write to Mon-Fri 08:00-21:00 with the accepted cost that Saturday + early-Sunday posts go unfetched
- The migration design doc (line 29) states the volume bounds are now exactly three: "the working-hours window, the 28-33 min cadence, and the per-surface click cap" — removing the window removes 1 of 3

**Takeaway**: the window is not decorative — it is one of the surviving volume-bounding terms; re-derive the worst-case day and the capture-retention figures before deleting it, not after.

### Composite Lessons
- Deleted gates leave three kinds of residue — header/comment prose (the budget's name still survives at `src/linkedin-behavior.ts:3` today), gate vocabularies in unrelated files (`linkedin-chain.ts`, `watch-linkedin.ts`, `config-file.ts`, alarm text, `AGENTS.md`, guidance ×3), and orphaned runtime artifacts with their .gitignore rules. Sweep all three in the same commit and rewrite rather than annotate. (The window has no runtime file of its own — the quiet-zero is stateless — so the third class does not apply here.)
- The window is load-bearing volume math: after the budget's deletion, worst-case day = window × cadence × click cap. Deleting it silently raises the daily count — restate the new bound explicitly and recompute `src/linkedin-capture.ts` retention math.
- Enumerate every importer/consumer before locking the file list — the budget migration's locked Files line missed `reset-linkedin.ts`, forcing a mid-slice scope amendment.
- Expect same-week follow-up fixes: the closest precedent needed 3 corrective commits within 4 days once the change met the live account. Plan a live rehearsal and verify the quiet-zero/exit-0 contract and alarm text still tell the truth with one fewer gate.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-11-15_08-44-36_remove-linkedin-working-window.md` — the FRD driving this change, with exact line anchors and Decisions
- `.rpiv/artifacts/discover/2026-11-09_17-29-56_linkedin-humanlike-fetch-behavior.md` — the FRD that introduced the window and the bypass rationale
- `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md` — the migration that deleted the budget machine and left the window load-bearing

## Developer Context
**Q (discover: Root intent — run anytime): What problem does the LinkedIn leg running outside Mon-Fri 08:00-21:00 cause today, and who feels it?**
A: "i want to able run it anything i want" (verbatim). The operator wants freedom to run, not better hours.

**Q (discover: Work = delete the window entirely): The window already exists (`isWithinWorkingHours`, `src/linkedin-behavior.ts:43-48`, gating all three PC scripts). What is the work here?**
A: Delete the window — every run allowed, day and night. Operator picked removal over a bypass switch.

**Q (discover: The unattended loop goes 24/7): Deleting the window also makes `watch-linkedin` fetch at night and on weekends, not just runs you start by hand. Is that what you want?**
A: Yes — the loop goes 24/7 too. The session-heat trade is accepted.

**Q (discover: bypassWindow dep seam dies with the window): Pre-resolved from codebase evidence (`scripts/fetch-linkedin.ts:138` + the line-383 gate).**
A: Remove `FetchTickDeps.bypassWindow` together with the gate — ENTAILED by the delete decision.

**Q (discover: Docs lose the window claims in the same change): Pre-resolved from codebase evidence (`AGENTS.md:58,104`; guidance scripts architecture.md 10, 32, 112; README verified clean).**
A: Update AGENTS.md and the scripts guidance with the code; no README edit.

**Q (`src/linkedin-capture.ts:41` + `scripts/replay-linkedin.ts:54,71-80` + `scripts/watch-linkedin.ts:4-5`): Three window-derived claims sit outside the FRD's edit list — capture retention churn math (~2-2.4 GB/day breaks under 24/7), replay's "one working day" roll-off math (becomes ~9-11 hours), and the already-false "daily budget" half of the loop header. How far should the residue sweep go?**
A: Fix all three. Also rewrite `src/linkedin-capture.ts:41` (~43-51 walks/day, ~3.7-4.3 GB/day) and replay's day-math for 24/7, and widen the acceptance grep to bare `working-hours` (zero false positives across live paths).

**Q (`tests/fetch-linkedin.test.ts:830-847`): The doomed gate test must invert into a proceeds-pin (analysis shows it cannot survive as-is — it would now throw /not main/). Which shape?**
A: Keep both, retitled. Saturday-noon becomes a proceeds-pin (blocks day-of-week gate reintroduction); Monday-10:00 retitled (pins guard-before-walk).

**Q (`src/linkedin-behavior.ts:15-19`): The header derives "28 wake-ups per local day" from the window's 13 hours. What replaces that paragraph when the window dies?**
A: Reword to the 24/7 bound: 1440/28 = 52 wake-ups/day max, cadence × click cap. Restate the volume bound explicitly rather than deleting the paragraph.

## Related Research
- None yet — this is the first research artifact for the working-window removal.

## Open Questions
None — every branch resolved as a Decision, an explicit Non-Goal, or a Developer Context entry above.
