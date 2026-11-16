---
date: 2026-11-16T09:38:22+0700
author: Yogiswara Utama
commit: 408eead
branch: ukind/fix-limited-linkedin
repository: fix-limited-linkedin
topic: "LinkedIn surface cap removal and probe thin-surface skip"
tags: [research, codebase, config-file, probe-linkedin, linkedin-fetch, linkedin-walk, linkedin-chain]
status: ready
last_updated: 2026-11-16T10:27:24+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Verification pass: npm test confirmed the red spread pin (47 pass / 1 fail); every :line citation re-verified against opened files; the pacing entry relabeled as a research finding that closes the FRD Open Question"
---

# Research: LinkedIn surface cap removal and probe thin-surface skip

## Research Question
Chained from `.rpiv/artifacts/discover/2026-11-16_09-00-43_linkedin-surface-cap-and-probe-skip.md`. Two edits to verify against live code: (1) replace the exact-5 linkedin-surface check (`src/config-file.ts:210-215`) with a >= 1 check; (2) convert the probe's single `surfaces[0]` read (`scripts/probe-linkedin.ts:153`) into an ordered loop that skips thin/faulted keywords and stops at the first keyword clearing `PROBE_MIN_POSTS`. Plus the FRD's open question: is the PC leg's pacing arithmetic per-surface or fleet-wide?

## Summary
- **The pacing open question is CLOSED by this research (not carried forward).** The `scrollRounds` click cap is strictly per-surface (`src/linkedin-walk.ts:308`, invoked once per surface at `src/linkedin-fetch.ts:285-295`). All navigations share one pacing gate per tick; the gate bounds RATE, not total (`src/linkedin-fetch.ts:178-196`, minted per call at `:256`). The 5-figure is descriptive only: `LINKEDIN_SURFACE_COUNT = 5` (`src/config-file.ts:80`) is read exactly once, by the `!==` check at `:211`; repo-wide grep finds no other importer and no computation consuming the count. The caveat: per-tick DURATION scales with N — each added keyword adds one 5-15s gate slot, one <=30s liveness window, and up to `scrollRounds` settle waits (~19 min worst case per keyword at the live `scrollRounds: 150`, `watcher.config.json:123`). The dry exit (`src/linkedin-walk.ts:394-400`) and seen-stop (`:312-315`) are the practical bounds. Worst-case ticks eat into the 40-min payload freshness margin (`src/linkedin-behavior.ts:36-37`, `src/linkedin-payload.ts:38`) against the 28-33 min sleep.
- **Cap removal is mechanically safe.** No runtime consumer reads the fleet count; the probe zero-guard (`scripts/probe-linkedin.ts:150-152`) and the tick quiet gate (`scripts/fetch-linkedin.ts:365-368`) survive as injected-config backstops. The FR-8 comment (`src/config-file.ts:73-79`) dies with the check, in the same edit.
- **The probe loop needs TWO distinct skip arms, not one.** Thin is a normal return from the walk; the probe manufactures the failure itself (`scripts/probe-linkedin.ts:187-189`). A keyword fault arrives as `AllSurfacesFaulted` with `faulted === 1` (`src/linkedin-fetch.ts:337-339`, one-surface array). Halt and leg-dead rethrow immediately; tag classification is total (disjoint `name` constants, one producer each, `src/linkedin-context.ts:21-95`; join precedence halt > leg-dead > all-faulted by short-circuit, `src/linkedin-fetch.ts:331-339`).
- **Browser shape (developer decision): N launches, one per keyword.** `fetchLinkedInPosts` builds and closes its own context per call (`src/linkedin-fetch.ts:255`, `:325-327`); the loop keeps that seam untouched.
- **Zero-linkedin error (developer decision): keep the guard order.** A fully empty `surfaces` array dies at `src/config-file.ts:172-174` with the generic message; only the Threads-only shape names the linkedin count at `:211-215`.
- **The committed-spread pin is red, CONFIRMED BY A TEST RUN.** `npx tsx --test tests/config-file.test.ts` (2026-11-16T10:27+0700): 47 pass / 1 fail. The failure is `keeps the committed spread at the FRD five` (`tests/config-file.test.ts:399-409`): actual `['react jakarta', 'hiring jakarta', ...]` vs expected `['hiring indonesia', ...]` — the committed file (`watcher.config.json:103-120`) holds `"react jakarta"` first (operator edit `a5af2a6`, 2026-11-16). Developer decision: delete the test.

- **Consumers move in lockstep**: `ProbeResult {postCount, elapsedMs}` (`scripts/probe-linkedin.ts:129-133`), the chain banner + summary (`scripts/linkedin-chain.ts:106`, `:123-127`), exact test pins (`tests/probe-linkedin.test.ts:278-294`), and README/guidance "first configured surface" wording.

## Detailed Findings

### 1. The exact-5 rule and its removal
- The rule is three things in one file: the FR-8 rationale comment `src/config-file.ts:73-79` ("an operator may swap a surface's value, never grow the fleet"), the constant `:80` (`LINKEDIN_SURFACE_COUNT = 5`, module-private), and the enforcement `:210-215` (count filter `:210`, `!==` throw `:211-214`, message `:213` naming the count + "exactly 5 are required (the PC leg's pacing arithmetic assumes it); keep the five-surface spread").
- Repo-wide: the constant has exactly three code hits (`:80, :211, :213`). Every runtime consumer partitions and zero-guards instead of counting: `src/index.ts:257-263`, `scripts/fetch-linkedin.ts:361-368` (quiet no-op `{wrote:false, pushed:false, postCount:0}`), `scripts/probe-linkedin.ts:147-153`, `src/linkedin-fetch.ts:230-341` (uses `surfaces.length` directly at `:261, :270, :337`; empty-in → `[]` out at `:234-237`). Nothing slices or truncates the array.
- The surviving message fragment is the prefix `has ${linkedinCount} linkedin surfaces` — it names the count per FR#2. The tail ("exactly 5", the pacing parenthetical, "keep the five-surface spread") dies with FR1. Candidate shape: `config: <path> has N linkedin surfaces — at least 1 is required`.
- The FR-8 cap's justification history (git): introduced by `7558747` (2026-11-10) justified by a daily GET budget; the budget was deleted by `8e8f22b` (2026-11-11); the working-hours window by `f0340d7` (2026-11-15); the comment was re-worded twice (`8e8f22b`, docs sweep `9fded75`). The cap outlived every part of its original arithmetic.

### 2. The validation boundary after the rewrite
- Full guard chain in `readSurfaces` (`src/config-file.ts:168-218`), in order: not-an-array `:169-171`; empty-array `:172-174`; per-entry object `:177-181`; type whitelist `tag/url/linkedin` `:185-189`; value non-empty `:190-192`; url absolute `:193-201`; threads-host `:202-207`; count `:210-215`; duplicate warn (non-throw) `:216` (fn `:225-240`).
- Zero-linkedin reachability: the `:172-174` empty-array throw keys on TOTAL length and runs first, so the count error owns only the "non-empty but zero linkedin" shape (tag + threads url fixture — exactly what `tests/config-file.test.ts:385-397` builds). Developer decision: keep this split; the reject-0 test keeps its fixture and re-pins the new message.
- Downstream zero-guards collapse to injected-config backstops once the validator owns zero: the probe's `probeNoSurfaces()` (`scripts/probe-linkedin.ts:150-152`) must keep firing BEFORE the cookie preflight (`:161`, pinned by `tests/probe-linkedin.test.ts:372-389`, `built.value === 0`), and the tick quiet gate (`scripts/fetch-linkedin.ts:365-368`) stays an exit-0 no-op that the chain classifies (`scripts/linkedin-chain.ts:116-121`).
- The platforms flags are orthogonal: the count check counts types only; `readPlatforms` never feeds `readSurfaces`. The committed file is linkedin-true/threads-false with 5 linkedin entries (`watcher.config.json:123-127`).
- Fixture compounding: `VALID` (`tests/config-file.test.ts:8-21`, five linkedin entries at `:13-17`) feeds ~30 other tests; it stays green untouched under >= 1. The duplicate-warn suite (`:412-455`) builds a 3x-duplicate fleet that sums to 5 — green under both rules, zero edits.
- Acceptance pins that survive untouched: accepts-FIVE `:346-350`, accepts-mixed `:352-364`. Rejection pins to remove/replace: reject-4 `:366-372` (regex `:370`), reject-6 `:374-383` (regex `:381`), reject-0 `:385-397` (regex `:395`). The spread pin `:399-409` is deleted per the developer decision — and it is already failing today (test run 2026-11-16T10:27+0700, 47 pass / 1 fail).

### 3. The probe today (single-keyword gate)
- `runProbe` (`scripts/probe-linkedin.ts:145-192`): filter linkedin surfaces `:147-149` → throw `probeNoSurfaces()` on empty `:150-152` → take `surfaces[0]` `:153` → resolve env `:156` → cookie preflight `resolveLinkedInCookies(env)` `:161` (presence/parse only; the browser rides the PROFILE) → banner `:163-165` → one clock `started = now()` `:167` → ONE call `fetchLinkedInPosts([surface], {...})` `:175-184` (`minClicks = PROBE_MIN_CLICKS = 5` `:53`, `scrollRounds` rides config, `seenIds` deliberately unset — the structural seen-stop exemption) → elapsed `:185` → result line `:186` → floor check `:187-189` (`PROBE_MIN_POSTS = 10` `:56`) → pass line `:190` → return `{postCount, elapsedMs}` `:191`.
- `ProbeResult` (`:129-133`) is consumed only by the chain (`scripts/linkedin-chain.ts:66, :107, :124`); the chain test pins the exact shape (`tests/linkedin-chain.test.ts:37`, deep-equal at `:119-125`).
- CLI exit arms (`scripts/probe-linkedin.ts:199-223`), all `process.exit(1)`: isHalt → `probe: HALT — <reason>` `:200-203`; isLegDead → `probe: LEG DEAD` `:204-207`; isAllSurfacesFaulted → `probe: FAILED` `:208-211`; the two local tagged gates print bare `:212-219`; fallback `:220-222`. Success resolves and Node exits 0 implicitly — there is no `process.exit(0)`.
- The probe-local tagged gates (`PROBE_FLOOR` `:62-83`, `PROBE_NO_SURFACES` `:85-106`) follow the same name-constant + factory + guard idiom as the walk's tags.

### 4. The loop conversion (thin vs fault vs session-level)
- **Thin is a return, not a throw.** A short walk exits `walkLinkedInSurface` normally (dry exit `src/linkedin-walk.ts:394-400`; OK log `:404-405`), the join returns posts (`src/linkedin-fetch.ts:340`), and `runProbe` manufactures the failure at `:187-188`. The thin arm replaces that throw with one log line (keyword + count) + continue.
- **A keyword fault arrives as `AllSurfacesFaulted` with `faulted === 1`.** `fetchLinkedInPosts` folds errors in its worker catch (`src/linkedin-fetch.ts:303-323`: halt arm `:304-311`, leg-dead arm `:312-319`, plain fault `:320-322` counts `faultedCount`) and the join throws only when every surface faulted (`:337-339`). The probe's one-element array makes any plain error all-faulted (pinned: `tests/probe-linkedin.test.ts:355-368`, `.faulted === 1` at `:366`). The loop catches `isAllSurfacesFaulted` per keyword and converts it to a skip line (FR#7).
- **Halt/leg-dead rethrow is safe by construction.** Disjoint `name` constants, one producer each (`src/linkedin-context.ts:21-43` leg-dead, `:45-70` all-faulted, `:72-95` halt); the join's precedence is short-circuit total (`src/linkedin-fetch.ts:331-339`); the only errors escaping a call are freshly minted single-tag errors or the returned array. Propagation is pinned (`tests/probe-linkedin.test.ts:325-338` halt, `:340-353` leg-dead). FR#8's catch checks `isHalt` then `isLegDead` before any skip handling and cannot swallow a session-level abort.
- **Two untagged edges exist outside the tag system** (design must state their policy): a `contextFactory` rejection (`src/linkedin-fetch.ts:255`, before the try) and a `context.close()` rejection in the `finally` (`:325-327` — it overrides a pending tagged throw). Both surface as plain Errors; the FRD's catch spec names only the three tags, leaving these implicitly on the rethrow path.
- **The final all-thin/all-faulted failure message needs loop-scope accumulators.** `runProbe` retains nothing across iterations today (`ProbeResult` carries only the two fields; the per-keyword error detail dies in the worker's warn at `src/linkedin-fetch.ts:321-322` — the thrown tag carries only `faulted: number`, `src/linkedin-context.ts:50-62`). Names are free (loop variable `surface.value`, counts at the skip sites); per-keyword error REASONS are not available without widening `fetchLinkedInPosts`' contract — a non-goal. The aggregate `error.message` (`linkedin-fetch: all 1 surface(s) faulted — nothing fetched`) is what a faulted skip line can name.
- **The per-keyword clock must reset.** `started` (`scripts/probe-linkedin.ts:167`) is a single clock; the pinned result line `probe: <ms>ms — N post(s)` (`:186`, test `:289`) stays meaningful only if elapsed is per attempt.
- **Pinned lines that survive verbatim under first-pass-wins**: the banner (`:163-165`, moves inside the loop, interpolates the loop variable; regex pin `tests/probe-linkedin.test.ts:284` is `lines.some`-tolerant of extra lines); the result line (`:186`); `probe: all checks passed` (`:190`, equality-pinned at `:290`, printed exactly once on pass). The `probeFloor` tag loses its only throw site (`:188`); it survives only if the all-thin terminal reuses it (CLI bare-print arm `:216-219`).

### 5. Browser context lifecycle (developer decision: N launches)
- `fetchLinkedInPosts` builds the context internally (`src/linkedin-fetch.ts:255`), closes it in the `finally` (`:325-327`), and offers no seam for a pre-built context (`FetchLinkedInDeps` `:128-162` has no context field). Reuse would mean widening the seam (breaking the deliberate LinkedIn-local factory, `src/linkedin-context.ts:99-101`) or driving `walkLinkedInSurface` directly (duplicating the orchestration) — both reopen the FRD non-goal. Decision: N sequential launches on the same persistent profile (`LINKEDIN_PROFILE_DIR`); sequential is safe because `:326` awaits close before the next build (the profile lock is exclusive).
- **Pacing resets per keyword**: the gate is minted per call (`:256`, `nextFreeAt = -Infinity` at `:183`), so keyword N+1's first navigation is unpaced relative to keyword N's last — only the browser relaunch time intervenes. Within a call, width clamps to 1 for a single-surface array (`src/pool.ts:51` `Math.min`; `LINKEDIN_FETCH_CONCURRENCY = 2` `src/linkedin-fetch.ts:76`).
- **Capture ordinal resets per keyword; the session stamp does not.** `captureOrdinal` is per-call (`src/linkedin-fetch.ts:256-260`); `runProbe` mints ONE sink for the whole run (`scripts/probe-linkedin.ts:183`), so all N launches share one `captures/<stamp>/` directory. Distinct keywords produce distinct filename slugs (`src/linkedin-capture.ts:185-188`), so no collision — but a keyword listed twice in config reuses slug + ordinal space and silently overwrites the earlier capture (atomic rename at `:193`). Dedupe or log is a design decision.
- **Test pins that move**: the pass-path `built.value === 1` (`tests/probe-linkedin.test.ts:279`) generalizes to "contexts === keywords actually walked" (early-exit case: the passing keyword's 1-based position; all-thin case: N). Preflight pins `built.value === 0` (`:389`, `:399`) survive untouched — both guards precede iteration 0.

### 6. Consumers and stale strings
- `scripts/linkedin-chain.ts`: stage-2 banner "read-only walk of the first configured surface" `:106` (test pin `:102` is prefix-tolerant `/stage 2\/3 probe /`); summary `done — probe <postCount> post(s), ...` `:123-127` (exact regex pins `tests/linkedin-chain.test.ts:104-108`, `:217-218`); module doc `:10-11`; `ChainResult.probe` doc `:65`. Under the loop, `postCount` means the passing keyword's count, unnamed. Adding the keyword name to the summary moves both regex pins in the same commit.
- `scripts/probe-linkedin.ts` doc blocks: module header `:6-7` ("first configured linkedin surface"), `:11` (floor meaning), operator protocol `:26-28`, `runProbe` doc `:135-144`, `probeFloor` message `:69-75` (message regex pinned at `tests/probe-linkedin.test.ts:313`).
- README: `:301-303`, `:319-323`, `:380`, `:382` describe first-surface-only + floor semantics. Guidance: `.rpiv/guidance/scripts/architecture.md` pins `PROBE_MIN_POSTS = 10` and the probe contract. The established pattern is a docs-only follow-up commit (`f0340d7` → `9fded75`).
- The chain aborts on any probe throw via the catch-all wrapper (`scripts/linkedin-chain.ts:131-143`) — loop-agnostic, unchanged; only the CONTENT flowing through it shifts.
- The watch.yml `probe` job is the JUDGE probe (`.github/workflows/watch.yml:91-95`), not the LinkedIn surface probe. The LinkedIn probe is wired to no workflow; its contract is consumed by the operator (README) and the chain.

## Code References
- `src/config-file.ts:73-80` — FR-8 comment + `LINKEDIN_SURFACE_COUNT = 5` (rewrite + delete)
- `src/config-file.ts:168-218` — `readSurfaces` guard chain (order is load-bearing)
- `src/config-file.ts:210-215` — the count filter + `!==` throw + message (the FR1 edit site)
- `src/config-file.ts:172-174` — empty-array throw (owns `surfaces: []`, stays generic)
- `src/config-file.ts:216, :225-240` — `warnDuplicateSurfaces` call + fn (warn stays on the pass path)
- `scripts/probe-linkedin.ts:53-56` — `PROBE_MIN_CLICKS = 5`, `PROBE_MIN_POSTS = 10`
- `scripts/probe-linkedin.ts:62-106` — probe-local tagged gates (floor, no-surfaces)
- `scripts/probe-linkedin.ts:129-133` — `ProbeResult` (shape pinned by the chain suite)
- `scripts/probe-linkedin.ts:145-192` — `runProbe` (the FR3-FR8 loop conversion site)
- `scripts/probe-linkedin.ts:147-153` — filter → zero guard → `surfaces[0]` (the single read to replace)
- `scripts/probe-linkedin.ts:199-223` — CLI exit arms (byte-stable contract)
- `src/linkedin-fetch.ts:59-67` — the tagged-guards re-export facade the probe imports
- `src/linkedin-fetch.ts:128-162` — `FetchLinkedInDeps` (no context hand-off seam)
- `src/linkedin-fetch.ts:178-196` — `makePacingGate` (reserve-before-sleep; bounds rate, not total)
- `src/linkedin-fetch.ts:230-341` — orchestration: empty return `:234-237`, context `:255`, gate `:256`, ordinal `:260`, worker `:276-324`, close `finally` `:325-327`, join `:331-339`
- `src/linkedin-context.ts:21-95` — the three tagged-error families (leg-dead, all-faulted, halt)
- `src/linkedin-walk.ts:308` — the per-surface round loop (the FRD pacing question's answer)
- `src/linkedin-walk.ts:297-301` — leg-dead throw (liveness window)
- `src/linkedin-walk.ts:361, :394-400` — settle wait + dry exit (the practical per-surface bound)
- `src/linkedin-behavior.ts:15-20, :31-48` — worst-case doc (hard-written 5) + the fleet-independent 28-33 min cadence
- `watcher.config.json:103-123` — the five linkedin surfaces (`react jakarta` first) + `scrollRounds: 150`
- `scripts/fetch-linkedin.ts:361-368` — partition + quiet-zero gate (injected-config backstop)
- `scripts/linkedin-chain.ts:106, :123-127` — stale banner + summary (move with the loop)
- `tests/config-file.test.ts:337-409` — FR-8 suite; `:399-409` spread pin (DELETE per decision; CONFIRMED red by test run 2026-11-16T10:27+0700: 47 pass / 1 fail)
- `tests/probe-linkedin.test.ts:260-296` — pass path (deepEqual `:278`, built `:279`, banner `:284`, result `:289`, pass `:290`, capture `:293-294`)
- `tests/probe-linkedin.test.ts:299-368` — gate arms (floor `:299-323`, halt `:325-338`, leg-dead `:340-353`, all-faulted `:355-368`)
- `tests/probe-linkedin.test.ts:371-400` — preflight order pins (`built.value === 0` `:389`, `:399`)
- `src/linkedin-payload.ts:38` — `PAYLOAD_MAX_AGE_MS` = 2_400_000 (40 min freshness the tick duration eats into)

## Integration Points

### Inbound References
- `scripts/linkedin-chain.ts:86, :107, :124` — the chain drives `runProbe` as stage 2 and reads `ProbeResult.postCount`
- `tests/probe-linkedin.test.ts` — the whole suite pins `runProbe`'s shape, log lines, gate arms, and preflight order
- `tests/config-file.test.ts:337-409` — the FR-8 suite pins the cap
- `src/index.ts:257-263` — the pipeline partitions linkedin surfaces (count-agnostic consumer)
- `.github/workflows/watch.yml:91-95` — the probe JOB is the judge probe; the LinkedIn surface probe has no workflow wiring (operator + chain only)
- `README.md:301-382` — operator-facing first-surface wording

### Outbound Dependencies
- `scripts/probe-linkedin.ts:161` → `src/linkedin-session.ts` `resolveLinkedInCookies` (untagged plain `linkedin-cookies:` errors, `src/linkedin-session.ts:45-47`, land in the CLI fallback arm `:220-222`)
- `scripts/probe-linkedin.ts:175` → `src/linkedin-fetch.ts` `fetchLinkedInPosts` (one-element array; the non-goal boundary)
- `src/linkedin-fetch.ts` → `src/linkedin-context.ts` (factory + tags), `src/linkedin-walk.ts` (surface walk), `src/linkedin-parser.ts` (Flight parse), `src/linkedin-capture.ts` (sink + ordinal)

### Infrastructure Wiring
- The probe writes NO tracked state — no payload, no push, no latch, no episode marker; its one write is the gitignored capture scratch (`scripts/probe-linkedin.ts` module doc)
- `scripts/linkedin-chain.ts:131-143` — the catch-all wrapper maps any probe throw to `linkedin-chain: FAILED — <gate>`, exit 1
- The probe-local gates exist so the CLI can print bare already-prefixed messages (`scripts/probe-linkedin.ts:212-219`)

## Architecture Insights
- **Fail-visible with closed guard order**: shape guards → per-entry loop → count → warn; the duplicate warn rides only the pass path, so an invalid config never emits a warning. Keep the order; the FR2 error owns only the shape it can reach.
- **Thin ≠ fault ≠ session-level**: the codebase already fought this once (`defb8af` — empty window was a fault until fixed). The walk returns thin as success; the probe manufactures the floor failure; the join raises all-faulted only for total fault; halt/leg-dead drain and rethrow with fixed precedence. The loop must preserve exactly these three classes.
- **Rate is pacing-bound, not width-bound** (`src/linkedin-fetch.ts:170-176`): one shared gate per tick bounds navigation spacing; the click cap is per-surface; durations are fleet-additive. The 5-figure was a soft duration bound dressed as an account-safety invariant.
- **The caller owns the exit** (the fetchTick model): `runProbe` throws tagged errors; the CLI maps them arm for arm; the chain re-wraps. The loop keeps this — classification moves INTO `runProbe`'s catch for the skippable class only.
- **Pin the shape, not the values**: `tests/config-file.test.ts:51-53` states the doctrine for committed operator data; the deleted spread pin violated it (and misfired on a sanctioned swap).
- **Tagged-error idiom everywhere**: name constant + factory + type guard; guards compare `error.name` only; one producer per tag makes classification total without ordering tricks (order still matters for the CLI's print arms because halt/leg-dead carry `.reason`).

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: the exact-5 cap itself (FR-8)
**Commit(s)**: `7558747` — "Add LinkedIn humanlike fetch behavior" (2026-11-10)
**Blast radius**: 23 files across config, PC scripts, behavior, walk, tests
  src/config-file.ts — the constant + exact-equality check; tests/config-file.test.ts — the ~99-line FR-8 suite
**Follow-up fixes**:
- `8e8f22b` (2026-11-11) — browser-walk migration deleted the daily GET budget; cap comment rewritten
- `f0340d7` (2026-11-15) + `9fded75` (2026-11-15) — working-hours window removed; docs-only sweep rewrote the cap comment again
- `a5af2a6` (2026-11-16) — the operator tried to add "react jakarta" and had to REMOVE entries to stay at exactly 5; the spread pin went red the same morning
**Takeaway**: constraints outlive their justifications — remove the FR-8 comment in the same commit; never leave a stale rationale.

### Precedent: the probe gate's first-surface shape + floor raise
**Commit(s)**: `8e8f22b` (2026-11-11); `e624cec` — "linkedin: add the operator chain and the runProbe seam" (2026-11-12)
**Blast radius**: probe rewrite + new chain/login scripts + 4 guidance docs + 2 suites
**Follow-up fixes**: `14ccec5` (2026-11-13) — capture harness added (~85 MB/walk measured); `20c5f28` (2026-11-15) — probe tests re-pinned for the urn join
**Lessons from docs**:
- .rpiv/artifacts/plans/2026-11-12_15-41-06_linkedin-operator-chain.md — the ea11969 lesson: an entry guard alone was insufficient; importing probe-linkedin.ts must stay side-effect-free
- .rpiv/artifacts/validation/2026-11-12_18-32-59_linkedin-operator-chain.md — guidance PINS `PROBE_MIN_POSTS = 10`; doc pins are validated criteria
- .rpiv/artifacts/designs/2026-11-13_10-27-17_linkedin-seen-stop-scroll.md — the probe's seen-stop exemption is structural (unset `seenIds`); fully-seen keywords once burned all scroll rounds
**Takeaway**: this is the first probe control-flow change since the seam landed — preserve the entry guard, the byte-stable CLI arms, the seen-stop exemption, and sweep the doc pins.

### Precedent: "thin" was real walk bugs, not thin content
**Commit(s)**: `6493f2a` (2026-11-11) — walk instrumentation; `cd2297f` (2026-11-14) — tech-debt run6 walk fixes (N046-N048)
**What went wrong**: the walk reported 3 posts with no way to tell why; instrumentation landed BEFORE the fix, then exposed two real bugs in exactly the thin/stop paths (the 150-cap kept the OLDEST posts; the seen-streak folded in completion order)
**Takeaway**: a thin result can mean thin content OR a silently broken walk — give the thin-skip line the keyword + count, and never let a keyword fault be mistaken for thinness (the FRD's FR#7/#8 split mirrors this history).

### Precedent: thin/empty semantics in the fetcher
**Commit(s)**: `defb8af` — "fix: treat an empty linkedin search window as zero results" (2026-11-01); `4983bc1` (2026-11-13) — seen-stop + degrade-to-empty-set
**What went wrong**: an empty search window was classified as a fault until `defb8af` — "thin ≠ dead leg" was already confused once
**Takeaway**: classify thinness as its own outcome, distinct from halt/leg-dead/all-faulted, mirroring the production walk's precedent.

### Precedent: plan/doc drift producing re-sync commits
**Commit(s)**: `ce567af`, `263a77c` (2026-11-11) — plan fences re-synced to source; `9fded75` (2026-11-15) — docs-only sweep after cadence changes
**What went wrong**: plan fences drifted from source and the implement stage would have landed code the design rejected; derived claims (walks/day, retention windows) live in 7+ files
**Takeaway**: re-verify line anchors at plan time (done here — the FRD's references check out against the live tree); plan a docs-only follow-up commit for README + guidance + chain wording.

### Composite Lessons
- Constraints outlive their justifications (`7558747` → `8e8f22b` → `f0340d7`/`9fded75`): the surviving real bound is fleet-wide tick DURATION vs the 40-min payload freshness contract (`src/linkedin-payload.ts:38`, sized against the 33-min wake ceiling per `src/linkedin-behavior.ts:36-37`).
- Thin ≠ broken — prove it (`6493f2a`, `cd2297f`, `defb8af`): one diagnostic line per thin keyword (keyword + count), faults logged distinctly, halt/leg-dead stay aborts.
- Probe contracts to preserve (`e624cec`, `14ccec5`): side-effect-free import, byte-for-byte CLI arms, the structural seen-stop exemption, and awareness that the capture sink costs ~85 MB per walk — the all-thin worst case walks every keyword with capture on.
- Doc pins are validated criteria (`9fded75`, guidance/scripts): sweep README, chain wording, probe docs, and the guidance pin in a docs follow-up commit.
- The pain is live and recent (`a5af2a6`, same morning as the FRD; payload posts fell 291→52 across `df890a9` → `a33041e`): the operator hit the cap while trying to add "react jakarta".

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-11-16_09-00-43_linkedin-surface-cap-and-probe-skip.md` — the FRD this research chains from
- `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` — origin of the probe's `surfaces[0]` shape
- `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md` — scrollRounds consumed by both walks (D4)
- `.rpiv/artifacts/designs/2026-11-09_19-24-42_linkedin-humanlike-fetch-behavior.md` — budget-era cap wording
- `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md` — the two-commit removal pattern + the freshness-margin warning
- `.rpiv/artifacts/designs/2026-11-13_10-27-17_linkedin-seen-stop-scroll.md` — the probe's structural seen-stop exemption
- `.rpiv/artifacts/plans/2026-11-12_15-41-06_linkedin-operator-chain.md` — the ea11969 entry-guard lesson
- `.rpiv/artifacts/validation/2026-11-12_18-32-59_linkedin-operator-chain.md` — the guidance pin on `PROBE_MIN_POSTS`
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — N057 (stale scrollRounds figure; per-surface x fleet math)
- `.rpiv/artifacts/plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md` — the "payload can reach 750" descriptive note
- `.rpiv/artifacts/validation/2026-11-10_16-10-20_linkedin-humanlike-fetch-behavior.md` — the original five fleet values

## Developer Context
**Q (discover: Linkedin surface count rule): the code has a rule that says your config must have EXACTLY 5 linkedin keywords. I remove that rule. What replaces it?**
A: Any number, 1 or more.

**Q (discover: Probe thin-surface behavior): try keywords in config order; a keyword under 10 posts logs one line and the probe moves to the next; the gate passes when one keyword clears 10 posts; exit 1 only when every keyword is thin. Keep this?**
A: First pass wins.

**Q (discover: Scope of config change): do you want new linkedin keywords added to watcher.config.json right now?**
A: Code fix only; the developer edits the config later.

**Q (discover: Cap location — pre-resolved): where is the cap?**
A: An exact-equality check (`!== 5`) at `src/config-file.ts:211`, not a max; nothing truncates the surfaces array. (Verified this session.)

**Q (discover: Probe surface selection — pre-resolved): how does the probe pick its surface?**
A: It hard-picks `surfaces[0]` (`scripts/probe-linkedin.ts:153`) and applies a global 10-post floor (`:187-189`); no loop, no skip. (Verified this session.)

**Q (discover: Production walk thin handling — pre-resolved): how does production treat a thin surface?**
A: Thin or zero-post surface = success (`defb8af`); only halt, leg-dead, and all-faulted abort. (Verified this session.)

**Q (discover: Page-error behavior in the probe loop): keyword 1 loads but its walk errors out. What should the probe do?**
A: Skip to next keyword. Halt and leg-dead stay instant aborts (session-level, not keyword-level).

**RESEARCH FINDING (not a developer answer) — closes the FRD Open Question: is the PC leg's pacing arithmetic per-surface or fleet-wide?**
A: Click cap per-surface (`src/linkedin-walk.ts:308`); navigation rate fleet-global but N-invariant (one gate, bounds spacing only); durations fleet-additive (~19 min worst per added keyword at `scrollRounds: 150`); the 5 is descriptive only. The FRD's core assumption holds; the freshness-margin caveat goes into the rewritten comment. Research closed this question this session — the FRD Open Questions section need not be hunted for; it is resolved here, not carried forward.

**Q (`tests/config-file.test.ts:399`): the committed-spread pin compares the real config's keywords to a stored list. What becomes of it?**
A: Delete the test. Nothing watches the committed file's keyword values. (The pin was CONFIRMED failing before the decision: `npx tsx --test tests/config-file.test.ts` on 2026-11-16T10:27+0700 — 47 pass / 1 fail, actual `['react jakarta', ...]` vs expected `['hiring indonesia', ...]`.)

**Q (`src/linkedin-fetch.ts:255, :325-327`): the loop opens one headed browser window per keyword (same profile). OK?**
A: Yes — N launches, one per keyword. The production walk seam stays untouched.

**Q (`src/config-file.ts:172`): a totally empty surfaces array dies with the generic "must not be empty" message before the linkedin count check. Keep the split?**
A: Keep the messages split. Only the Threads-only shape names the linkedin count.

## Related Research
- None yet (first research artifact for this topic).

## Open Questions
Note: the FRD's single Open Question (pacing arithmetic) was RESOLVED by this research — see the research-finding entry in Developer Context. It is closed, not carried forward.

- **Untagged error arms under the loop**: a `contextFactory` rejection (`src/linkedin-fetch.ts:255`) and a `context.close()` rejection in the `finally` (`:325-327`, which overrides a pending tagged throw) escape as plain Errors. The FRD catch spec names only the three tags. Design must state skip-vs-rethrow for these two arms.
- **All-thin worst case vs freshness**: N thin keywords x (one gate slot + one liveness window + up to `scrollRounds` settle waits) vs the 40-min payload freshness + 28-33 min sleep. Comment wording for the rewritten `src/config-file.ts:73-79`, plus whether to refresh the `52 x 5` formula at `src/linkedin-behavior.ts:16-20` and N057's stale numbers — a docs decision (the `9fded75` pattern).
- **Duplicate keywords in config under the loop**: the same keyword twice reuses the capture slug + per-call ordinal space and silently overwrites the earlier capture (`src/linkedin-capture.ts:185-193`). Dedupe the loop or log the collision.
- **Docs sweep list**: README `:301-303, :319-323, :380, :382`; chain module doc + banner (`scripts/linkedin-chain.ts:10-11, :106`); probe module docs (`scripts/probe-linkedin.ts:6-7, :11, :26-28, :135-144`); guidance/scripts pin (`PROBE_MIN_POSTS` + "first configured surface"). Plan the docs-only follow-up commit.
- **The probe's seen-stop exemption**: `seenIds` stays unset per per-keyword call (`scripts/probe-linkedin.ts:181-182`). The loop must keep each call at that shape or consciously change the exemption.
