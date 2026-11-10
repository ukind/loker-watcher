---
date: 2026-11-09T18:06:34+0700
author: Yogiswara Utama
commit: 32a0bcd
branch: ukind/feature-anti-restrict
repository: feature-anti-restrict
topic: "linkedin-humanlike-fetch-behavior"
tags: [research, codebase, linkedin-fetch, watch-linkedin, pacing, anti-detection, halt-latch, daily-budget]
status: ready
last_updated: 2026-11-09T18:06:34+0700
last_updated_by: Yogiswara Utama
---

# Research: linkedin-humanlike-fetch-behavior

## Research Question
Behavioral layer inside the existing PC-local LinkedIn leg (chained from the discover FRD): jittered ~30-minute wake-ups inside Mon-Fri 08:00-21:00 local, randomized 5-15s request spacing, one page (50 posts) per surface per tick, shuffled surface order, a per-tick stop on unparsable 200, a persistent operator-cleared halt latch on 429/forced logout, a hard daily GET budget of 150, and a 5-surface config — all behind the existing `SleepFn`/`now`/`VoyagerGet` seams so the offline suite covers every new behavior. No new pipeline stage; the hosted watcher is untouched.

## Summary
Every FRD requirement lands on an existing, named seam — no architectural additions are needed:

- The **tick loop** is `scripts/watch-linkedin.ts` (fixed `TICK_MS = 600_000` at :15, `setTimeout` at :33). It has NO entry guard (`void main()` at :38 runs on import) and no injectable sleep — the planned `tests/watch-linkedin.test.ts` requires extracting an injectable loop body first.
- The **pacing gate** is `makePacingGate` (`src/linkedin-fetch.ts:421-433`): fixed `PACE_MS = 5_000` (:66), slot reserved before sleeping, per-walk closure. Randomization is a local change; the reservation-before-sleep shape must survive it.
- The **1-page cap** replaces the uncapped `for (;;)` walk at `src/linkedin-fetch.ts:475-492` (`start += PAGE_SIZE` at :492 is the pagination driver). Today's live evidence of the uncapped walk: payload commits of 1941-2243 posts per tick (commit `a1dc2b3`).
- The **shuffle** point is the `surfaces` array before `runPool` at `src/linkedin-fetch.ts:470` — `runPool` claims strictly in input order (`src/pool.ts:43`), so a pre-shuffle changes visit order with zero pool changes, and the per-claim-index side arrays keep reassembly correct.
- The **working-hours gate and daily budget** belong in `fetchTick` (`scripts/fetch-linkedin.ts:234`), which is already the shared entry for loop, one-shot, and tests, and already orders preflights before any GET (`guardCheckout` at :249, precedent `625b15e`). `probe-linkedin.ts:49` calls `transport.get` directly and structurally bypasses every `fetchTick` gate — the operator override FR-6 requires exists for free.
- The **fault classes need surgery**: `classifyFault` (`src/linkedin-fetch.ts:192-240`) has NO 429 branch — a 429 falls to the catch-all per-surface fault at :240. FR-7's latch and FR-4's whole-tick stop both extend this classifier and the marker machinery in `scripts/fetch-linkedin.ts:107-157`.
- The **config rule** lands in `readSurfaces` (`src/config-file.ts:154`), which today validates shape only — no per-type count cap. `watcher.config.json` carries 17 linkedin surfaces (one exact duplicate `hiring developer jakarta`) against the target 5.
- The **FR-0 gate** follows `guardCheckout`'s placement (inside `fetchTick`, before cookies/transport/GETs; the entry catch at `scripts/fetch-linkedin.ts:282-292` already exits 1 on any thrown error). Two FR-0 sub-items have no machine signal today and are carried as open questions: "newly harvested" (b) and "old personal path gone" (c) — the cookie file carries no account identity (`{liAt, jsessionid}`, `src/linkedin-session.ts`).

## Detailed Findings

### The PC loop (`scripts/watch-linkedin.ts`)
- Fixed cadence: `TICK_MS = 600_000` (:15); `for (;;)` (:21) → `fetchTick({ env: ENV })` (:23) → `setTimeout(resolve, TICK_MS)` (:33). This is the fixed-period signature FR-1 replaces.
- Leg-dead arm: `handleLegDeadEpisode(error.reason)` (:26); any other tick fault warns and the loop continues (:27-30) — the loop NEVER exits on leg-dead (its exit contract).
- **No entry guard**: `void main()` (:38) is unconditional — importing the module starts an infinite loop. The FRD's new `tests/watch-linkedin.test.ts` needs an exported, injectable loop body (deps: tick fn, sleep fn, iteration cap) plus the entry-guard idiom used by `fetch-linkedin.ts:282`. This is a prerequisite refactor design must plan for.
- The merged env resolves once at module scope (`ENV = envWithDotEnv()`); jitter needs an injectable clock/rng the current module does not have.

### The tick (`scripts/fetch-linkedin.ts`)
- `FetchTickDeps` (:77) is the injection surface: config, cookies, transport, payloadPath, git, env, alarm, markerPath, now. New gate dependencies (working-hours clock is already `now`; halt-marker path, budget-file path, rng) follow the same optional-trailing idiom.
- `DEFAULT_MARKER` (:107): `state/linkedin-leg-dead.flag`, repo-local BESIDE THE PAYLOAD on purpose — OS temp was rejected after a reboot erased an episode and re-alarmed (comment block :96-106). FR-7's latch marker and FR-9's budget file must be repo-local siblings too.
- `handleLegDeadEpisode` (:123-147): marker-present → warn-only; marker-absent → write marker + ONE alarm (best-effort, never masks exit codes). This edge idiom is the template for both the FR-4 unparsable-200 episode and the FR-7 latch trip — the latch differs ONLY in polarity: no code path may auto-clear it.
- `clearEpisodeMarker` (:149-157) runs after a successful push (:278) — the dead→healthy edge. The leg-dead marker self-clears on the next good tick; the halt latch must NOT ride this path.
- `guardCheckout` (:165): branch main + clean porcelain BEFORE cookies/transport/any GET; `fetchTick` calls it at :249. FR-0's gate joins this preflight band — a missing prerequisite costs zero GETs, and a thrown gate error hits the entry catch (:282-292) which exits 1 naming the problem (acceptance criterion satisfied for free).
- `fetchTick` (:234): zero linkedin surfaces → quiet no-op (:242). Under FR-0(d) (exactly 5 required) this path becomes unreachable — config validation rejects first.
- All-faulted walk = tagged no-op, payload untouched (:256-263) — FR-4's per-tick stop should behave identically (quiet zeros, no payload write) plus the one-episode alarm.

### The walk (`src/linkedin-fetch.ts`)
- Constants: `LINKEDIN_FETCH_CONCURRENCY = 2` (:60), `PAGE_SIZE = 50` (:63), `PACE_MS = 5_000` (:66). FRD constants `PACE_MIN_MS/PACE_MAX_MS/PAGES_PER_SURFACE_PER_TICK` land beside these.
- `makePacingGate` (:421-433): `slotAt = max(now, nextFreeAt)`, `nextFreeAt = slotAt + PACE_MS` — the slot is RESERVED BEFORE SLEEPING, so width-2 workers can never burst; per-walk closure, ticks never inherit stamps. Randomizing the gap = replacing the fixed `PACE_MS` addend with `PACE_MIN + rng() * (PACE_MAX - PACE_MIN)`; the reserve-before-sleep order is the invariant to keep. NOTE: the gate is the wrong home for the daily budget — it dies with the walk; the budget must live across ticks (see The budget below).
- The walk (:452): per-surface `for (;;)` pagination (:475-492) — GET (:479), non-200 → `classifyFault` (:481), unparsable 200 → plain `Error` (:487, currently a PER-SURFACE fault), partial page → break (:491), else `start += PAGE_SIZE` (:492). FR-3's cap turns this into at most one GET per surface; FR-4 upgrades :487 from a surface fault to a whole-tick stop (drain-then-throw like `deadReason`, plus the episode alarm).
- Fault drain-then-throw: the worker catches leg-dead, sets `deadReason`, stops claiming, re-throws once after the join — partial posts are discarded, never half-written. FR-4's stop should reuse exactly this shape (a second shared flag or a widened fault kind), NOT a worker rejection.
- `runPool` call (:470): claims in input order. FR-5's shuffle = shuffle the array before the call (Fisher-Yates over an injectable `rng`); side arrays are indexed by claim index (`perSurface`), so reassembly stays correct and payload post order becomes shuffled — harmless downstream (the hosted run dedupes by id via `readPayloadPosts`).
- `classifyFault` (:192-240): 3xx (:204) / 403 (:210-217) / 401 / bare-400 → legDead; graphql-400 / 500 / EVERYTHING ELSE → per-surface fault. **429 has no branch** — it lands at :240 as `{kind:"fault", reason:"HTTP 429"}`. FR-7 needs a new 429 branch (and the latch mapping below); today a rate-limited surface is silently skipped and re-hit next tick.

### The budget and the latch (state that outlives a tick)
- The pacing gate is a per-walk closure; any daily counter inside it resets every tick. FR-9's counter must live in `fetchTick`'s layer. The `VoyagerGet` seam (one GET per call, `src/linkedin-fetch.ts:117-119`) makes a budget wrapper trivial: `fetchTick` can wrap `transport.get` with a check-and-increment closure before handing it to `fetchLinkedInPosts` — src stays generic, scripts own policy.
- Persisted vs in-memory: developer deferred to the FRD's arithmetic; the recommended default is a persisted `state/linkedin-get-budget.json` `{localDate, count}` (atomic write, `stateTempPath` idiom) so a PC reboot mid-day cannot push the day past 150. In-memory was the FRD's literal text ("the count rides the tick log") and loses on any reboot.
- Latch mapping (developer deferred; FRD FR-7 lists 429 + forced logout + re-auth prompt): the recommended default maps ALL current leg-dead classes (401, 3xx loop, 403, bare-400 — every "session dead" signature :204-232) PLUS a new 429 branch to the persistent latch. One halt path; safest for an account with one restriction already on record. The leg-dead per-episode alarm then becomes the latch-trip alarm; the loop keeps running and logs the latch each tick while set (FR-7), doing zero GETs.
- Alarm wording: `buildLegDeadAlarmText` (`src/email.ts:271-285`) says "The loop keeps running. Refresh the cookie file … and the next tick heals" (:277). Under the latch that remedy is INCOMPLETE — the operator must also delete `state/linkedin-leg-halted.flag`. The latch alarm needs its own builder/subject (the email-module variant idiom: pure builder + thin sender).

### Config (`src/config-file.ts` + `watcher.config.json`)
- `readSurfaces` (:154) validates entry shape only — type check at :171, no per-type count rule. FR-8's validator rule (reject >5 linkedin surfaces, fail-visibly naming the count) is a local addition; FR-0(d)'s "exactly 5" can ride the same validator or the FR-0 gate — design picks one home (validator covers every reader; the gate covers the entry).
- `watcher.config.json` today: 17 linkedin surfaces (lines :92 onward), including the exact duplicate `hiring developer jakarta`. The FR-8 cut lands as a config edit + the validator rule; the recommended default portfolio is recorded in the FRD (1 national umbrella, 1 city umbrella, 2 role-narrowed, 1 stack-narrowed).

### Session and environment
- `resolveLinkedInCookies` (`src/linkedin-session.ts`): fail-visible on unset/missing/malformed; the cookie file is `{liAt, jsessionid}` — it carries NO account identity. This is why FR-0(a)/(b) have no direct machine signal and why FR-0(c) (old path absent from .env/config/docs) is called out in the FRD as the only machine-checkable item.
- `envWithDotEnv` (`src/env-file.ts`): .env fills only unset keys. The FR-0(c) check reads the merged env the same way the loop does.

### Test landscape
- `tests/linkedin-fetch.test.ts` (~660+ lines) drives the fake `VoyagerGet` seam: header pins (:202), fault classes (:442), leg-dead (:482, :523), unparsable-200 (:563), empty-is-success (:583-585, :663), dropped-row counts (:654). Pacing/cap/shuffle/latch-class assertions extend this file per the FRD.
- `tests/fetch-linkedin.test.ts` exists (tick + git injection). FR-0 gate, working-hours gate (fake `now`), budget counter, and latch persistence tests land here.
- **`tests/watch-linkedin.test.ts` does not exist** (confirmed by `ls tests/`) — the FRD's new test home; requires the watch-linkedin refactor above.

## Code References
- `scripts/watch-linkedin.ts:15` — fixed `TICK_MS = 600_000` (FR-1's replacement target)
- `scripts/watch-linkedin.ts:21-38` — the loop: tick, leg-dead arm, fixed sleep; :38 `void main()` with NO entry guard
- `scripts/fetch-linkedin.ts:77` — `FetchTickDeps` (the injection surface new gates join)
- `scripts/fetch-linkedin.ts:107` — `DEFAULT_MARKER` (repo-local episode marker beside the payload)
- `scripts/fetch-linkedin.ts:123-147` — `handleLegDeadEpisode` (one-alarm-per-episode edge; latch template)
- `scripts/fetch-linkedin.ts:149-157` — `clearEpisodeMarker` (auto-clear the latch must NOT ride)
- `scripts/fetch-linkedin.ts:165` — `guardCheckout` (preflight-before-GET precedent for FR-0)
- `scripts/fetch-linkedin.ts:234-280` — `fetchTick` body: :242 no-surfaces no-op, :249 guardCheckout, :278 episode clear
- `scripts/fetch-linkedin.ts:282-292` — entry guard + catch (leg-dead → alarm → exit 1)
- `src/linkedin-fetch.ts:60-66` — walk constants (concurrency 2, page 50, pace 5000)
- `src/linkedin-fetch.ts:117-119` — `VoyagerGet` seam (budget-wrapper insertion point)
- `src/linkedin-fetch.ts:192-240` — `classifyFault` (no 429 branch; catch-all at :240)
- `src/linkedin-fetch.ts:421-433` — `makePacingGate` (reserve-before-sleep pacing; randomization target)
- `src/linkedin-fetch.ts:452-533` — `fetchLinkedInPosts`: :470 runPool (shuffle point), :475-492 uncapped pagination, :487 unparsable-200 (surface fault today)
- `src/pool.ts:43` — runPool claims in input order (pre-shuffle is sufficient)
- `src/config-file.ts:154-193` — `readSurfaces` (no per-type count cap; FR-8 rule lands here)
- `src/email.ts:271-297` — leg-dead alarm builder + sender (latch alarm needs its own wording)
- `src/linkedin-session.ts` — cookie resolver; file carries no account identity (FR-0(c) rationale)
- `src/linkedin-payload.ts` — `PAYLOAD_MAX_AGE_MS = 1_800_000` (30-min staleness; ~30-min tick keeps payloads fresh)
- `watcher.config.json:92-158` — 17 linkedin surfaces, duplicate `hiring developer jakarta` present
- `scripts/probe-linkedin.ts:49` — probe calls `transport.get` directly (structural FR-6 operator override)

## Integration Points

### Inbound References
- `scripts/watch-linkedin.ts:23` — the loop calls `fetchTick` every 600s; leg-dead arm at :26
- `scripts/fetch-linkedin.ts:282` — the one-shot entry calls `fetchTick({ env: envWithDotEnv() })`, exits 1 on any failure
- `tests/fetch-linkedin.test.ts` — drives `fetchTick` with injected deps (config, git, transport, alarm, markerPath)
- `tests/linkedin-fetch.test.ts` — drives `fetchLinkedInPosts` through the fake `VoyagerGet` seam

### Outbound Dependencies
- `src/linkedin-fetch.ts:479` → `buildSearchUrl` (`src/linkedin-voyager.ts`) — the ONLY URL builder (why the warm-up GET was demoted: no cheap non-search route exists)
- `src/linkedin-fetch.ts:470` → `runPool` (`src/pool.ts`) — width 2, claims in input order
- `scripts/fetch-linkedin.ts` → `writePayloadAtomic` (`src/linkedin-payload.ts`) and `pushPayload` (git, rebase+retry)
- `scripts/fetch-linkedin.ts:130-145` → `sendLegDeadAlarm` (`src/email.ts:288`) — best-effort, never masks exit codes
- `scripts/watch-linkedin.ts` / `fetch-linkedin.ts` → `envWithDotEnv` (`src/env-file.ts`) — merged env for all resolvers

### Infrastructure Wiring
- `state/linkedin-leg-dead.flag` — episode marker, untracked, repo-local beside `state/linkedin-posts.json` (`scripts/fetch-linkedin.ts:107`); the halt latch marker (`state/linkedin-leg-halted.flag`) and budget file join this directory as untracked siblings (rebase never touches them; `pushPayload` stages only the payload path)
- The hosted run consumes the payload read-side only (`readPayloadPosts`, `src/linkedin-payload.ts` — never throws, 30-min staleness); nothing in src/ imports the PC scripts (scripts → src, one way)

## Architecture Insights
- **Preflight band inside `fetchTick`**: everything that must cost zero GETs (checkout guard today; FR-0 gate, halt latch, working-hours window tomorrow) sits before cookies/transport resolution. Ordering constraint for design: FR-0 → latch → window → guardCheckout → cookies/transport → budget-wrapped walk.
- **Marker-file episode idiom**: one file per episode kind, repo-local, edge-detected (present = alarm already sent). The latch is the same mechanism with inverted polarity — NEVER auto-cleared; only an operator deletes it. FR-4's unparsable-200 episode shares the EXISTING leg-dead marker and self-clears via :278 on the next good tick.
- **Tagged-error + drain-then-throw**: whole-tick aborts never reject mid-pool; they flag, stop claiming, and throw once after the join (`deadReason` shape). FR-4's stop is a second instance of this shape, not a new control flow.
- **Policy lives in scripts, mechanics in src**: the `VoyagerGet` seam lets `fetchTick` wrap GETs with budget policy while `fetchLinkedInPosts` stays a generic paced walk. Same split the FRD draws for constants (budget/window in scripts, pace/pages in src).
- **Entry-guard idiom is NOT uniform**: fetch-linkedin and login-linkedin have it; watch-linkedin does not (:38) — the new loop tests depend on adding it.
- **Probe isolation is structural**: `probe-linkedin.ts:49` never touches `fetchTick`, so every new gate leaves the operator override intact by construction.

## Precedents & Lessons
2 similar past changes analyzed.

### Precedent: the whole PC leg landed as one commit
**Commit(s)**: `a8752bf` — "feat: run the linkedin leg on the local pc (voyager transport, payload push, login helper)" (2026-11-04)
**Blast radius**: ~10 files across 2 layers
  src/ — voyager/session/fetch/payload modules; scripts/ — tick/loop/probe/login; tests/ — four new suites
**Follow-up fixes**:
- `625b15e` — "feat: fail the linkedin fetch tick on a mis-homed checkout before any fetch" — the original tick could burn a live GET on a mis-homed checkout before failing; the fix moved the check to a preflight BEFORE any fetch
- `5573fa6` — "feat: one-command curl-impersonate setup…" — setup friction produced a checksum-pinned one-command path with remedy-naming failures
**Takeaway**: the leg hardens by ADDING preflights before the first GET — FR-0 follows the exact `625b15e` placement; every new gate error must name its remedy (the `5573fa6` convention).

### Precedent: the artifact-chain workflow itself
**Commit(s)**: `b509221` → `cabd1ba` → `7a32990` — the negative-keywords rpiv chain (discover/research/design/plan artifacts + the src seam + the validation amendment) (2026-11-08/09)
**Blast radius**: artifacts + `src/judge.ts` + config + tests
**Takeaway**: this repo's feature flow commits its rpiv artifacts and lands the seam with tests in the same series; the humanlike-behavior work should expect the same shape.

### Composite Lessons
- The marker-file idiom exists because OS temp failed in the field (reboot erased an episode → duplicate alarms) — `scripts/fetch-linkedin.ts:96-106`. Any new persistent state (latch marker, budget file) must be repo-local beside the payload from day one. (`625b15e`, `a8752bf`)
- The classifier's "unresolved on purpose" doctrine (`src/linkedin-fetch.ts:198-208`: dead session vs edge block carry the same remedy, so classification must not wait on root cause) supports mapping ALL leg-dead classes to one latch instead of distinguishing 401-vs-403 causes. (`a8752bf`)
- Volume evidence is in git itself: payload commits of 1941 (`5a1f7ed`) and 2243 (`a1dc2b3`) posts per single tick show the uncapped walk's real output — the behavior FR-3 caps. (git history)

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-11-09_17-29-56_linkedin-humanlike-fetch-behavior.md` — the FRD: intent, FR-0…FR-9, decisions, this research's input
- `outputs/linkedin-restriction-prevention.md` — restriction post-mortem, detection evidence, 40-250/day survival envelope, 283-375 trigger band (60 cited sources)

## Developer Context
**Q (discover: Success criterion (intent)):** When this feature is done, what does success look like for you?
A: "Account stays clean" — the account never gets flagged again; much slower, smaller fetches are acceptable.

**Q (discover: Leg's fate):** Retire the leg, or build the humanlike behavior as asked?
A: Keep leg, humanlike (Option B) — feed-post coverage matters more than compliance; lowered-not-removed risk accepted explicitly.

**Q (discover: Tick cadence):** How often should the humanlike leg wake up?
A: 30-minute jittered base — freshness prioritized; volume reconciled by cutting surfaces to 5.

**Q (discover: Surface count):** How many LinkedIn surfaces should the leg walk?
A: 5 surfaces — 24-26 weekday ticks × 5 × 1 page ≈ 130 GETs/weekday (~93/day week-average), hard-capped by FR-9 at 150.

**Q (discover: Active hours):** When is the leg allowed to run?
A: Working hours only — amended to Mon-Fri 08:00-21:00 (weekend ticks dropped; the only field-surviving profile verbatim).

**Q (discover: Jittered wake-up):** The PC loop wakes exactly every 600 seconds. Keep this, or change it?
A: Jitter the wake-up — the fixed `setTimeout` is the textbook fixed-period signature.

**Q (discover: Randomized pacing):** Voyager GETs are spaced exactly 5000ms apart. Keep this, or change it?
A: Random 5-15s gaps — clockwork pacing is the field's most-cited single vector.

**Q (discover: Pagination cap):** Each surface pages until the feed runs dry. Keep this, or cap it?
A: Cap 1 page/surface — the uncapped walk produced 56-72 pages/10 min in testing, a documented trigger.

**Q (discover: Unparsable-200 policy):** A 200 body that fails parsing counts as a per-surface fault. Keep this, or escalate?
A: Leg-wide cooldown, scoped to a per-tick stop + one alarm per episode; the persistent latch is reserved for 429/forced-logout (FR-7).

**Q (discover: Surface shuffle):** Should the leg shuffle surface order each tick?
A: Shuffle per tick — `runPool` claims in config order, the same keywords fire in the same sequence every tick.

**Q (discover: Warm-up GET):** Should the leg warm up before searching?
A: Warm-up GET — later demoted (post-write amendment): no verified non-search route exists; re-promote only after design names a route and it verifies live.

**Q (discover: Halt on warning):** What should the leg do when it sees an early-warning signal?
A: Halt on warning — the persistent latch covers 429 + forced logout/re-auth; unparsable-200 rides the FR-4 per-tick stop.

**Q (discover: Account):** Which account should the humanlike leg use?
A: Dedicated account — the personal account already has one restriction on record.

**Q (discover: Dedicated-account gate):** FR-9 had no setup path — implementation without it fires the first live tick on the personal account.
A: FR-0 blocks every entry until the dedicated account exists, its cookie file resolves via `LINKEDIN_COOKIES_FILE`, and zero personal-account references remain; first acceptance checkbox.

**Q (discover: Warm-up GET demotion):** FR-6 named no endpoint and none exists in the codebase.
A: Moved to Suggested Follow-ups; FR-6 removed; dry-run criterion excludes warm-up.

**Q (discover: Weekend window):** Does the working-hours window drop weekends?
A: Mon-Fri only — the surviving preset is 8a-9p Mon-Fri; cost: Saturday + early-Sunday posts unfetched.

**Q (discover: Daily GET budget):** Nothing enforced the ~130/day figure.
A: FR-9 — `DAILY_GET_BUDGET = 150`, mid-walk hard stop trips the FR-7 latch with one alarm, resets local midnight.

**Q (discover: FR-0(d) surface-cut fold):** FR-0 gated account + cookies but not the surface count.
A: FR-0(d) — a config without exactly 5 linkedin surfaces fails the entry.

**Q (discover: Payload-tail boundary):** The 1-page cap silently drops rank-51+ posts.
A: Coverage boundary stated in Non-Goals + fixture acceptance criterion (top 50 + one boundary warn).

**Q (`scripts/fetch-linkedin.ts:249`): Where does the FR-0 gate live — inside `fetchTick` (shared by loop, one-shot, tests; the guardCheckout band) or a separate preflight the entries call?**
A: Developer asked "isn't it triggered from local PC?" — yes, both options run entirely on the PC; the choice only decides which function enforces it. Agent default (recommended option): inside `fetchTick`, in the guardCheckout preflight band, with an injectable bypass for the existing tests (matching how alarm/markerPath inject today); the entry catch at :282-292 then satisfies the exit-1 acceptance criterion unchanged.

**Q (`src/linkedin-fetch.ts:240`): Which responses trip the FR-7 persistent latch? 401/302-loop/403/bare-400 already exit leg-dead with a self-healing alarm; 429 has no classifier branch.**
A: Developer deferred ("i dont understand"). Agent default (FRD FR-7-conformant): ALL current leg-dead classes plus a NEW 429 branch latch the leg; the leg-dead episode alarm becomes the latch-trip alarm; the loop keeps running, logs the latch, does zero GETs until the operator deletes `state/linkedin-leg-halted.flag`.

**Q (`scripts/fetch-linkedin.ts:234`): Should FR-9's daily GET counter survive a PC reboot (persisted file) or stay in-memory per process?**
A: Developer deferred ("i dont understand"). Agent default: persisted `state/linkedin-get-budget.json` `{localDate, count}`, atomic write per tick — a mid-day reboot cannot push the day past 150.

**Q (jitter bound): Wake-jitter range around the 30-minute base (FRD open question; the 780-min Mon-Fri window and the 140<150 budget arithmetic constrain it).**
A: Developer deferred ("i dont understand"). Agent default: uniform 28-33 minutes — worst case 28 ticks × 5 = 140 GETs < 150 budget (reproduces the FRD's own worst-case math); expected ~25-26 ticks ≈ 128 GETs ≈ the ~130/weekday target.

## Related Research
- `.rpiv/artifacts/discover/2026-11-09_17-29-56_linkedin-humanlike-fetch-behavior.md` — upstream FRD (decisions translated above)

## Open Questions
- FR-0(b) machine signal: how to verify "the cookie file was newly harvested for the dedicated account" — a provenance stamp written by `login-linkedin` at harvest vs an operator checklist item (the cookie file carries no account identity, `src/linkedin-session.ts`).
- FR-0(c) machine signal: what identifies "the OLD personal cookie path" — a blocked-path constant, a recorded list, or operator checklist only.
- Keyword shortlist: the FR-8 default portfolio (1 national umbrella, 1 city umbrella, 2 role-narrowed, 1 stack-narrowed) stands unless the operator records a different pick before the first live tick.
- Warm-up GET route: deferred until design names a non-search route that verifies live on the dedicated account (FRD Suggested Follow-ups).
