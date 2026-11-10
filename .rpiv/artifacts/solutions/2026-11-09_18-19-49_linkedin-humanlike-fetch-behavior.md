---
date: 2026-11-09T18:19:49+0700
author: Yogiswara Utama
commit: 32a0bcd
branch: ukind/feature-anti-restrict
repository: feature-anti-restrict
topic: "linkedin-humanlike-fetch-behavior"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, linkedin-fetch, watch-linkedin, pacing, anti-detection, halt-latch, daily-budget]
last_updated: 2026-11-09T18:48:28+0700
$1
last_updated_note: "surface count reconciled (17); FR-0(b) provenance stamp resolved; estimates grounded; options 1=2 scope note"
---

# Solution Analysis: LinkedIn humanlike fetch behavior

**Date**: 2026-11-09T18:19:49+0700
**Author**: Yogiswara Utama
**Commit**: 32a0bcd
**Branch**: ukind/feature-anti-restrict
**Repository**: feature-anti-restrict

## Research Question
Behavioral layer inside the existing PC-local LinkedIn leg (chained from the discover FRD): jittered ~30-minute wake-ups inside Mon-Fri 08:00-21:00 local, randomized 5-15s request spacing, one page (50 posts) per surface per tick, shuffled surface order, a per-tick stop on unparsable 200, a persistent operator-cleared halt latch on 429/forced logout, a hard daily GET budget of 150, and a 5-surface config — all behind the existing `SleepFn`/`now`/`VoyagerGet` seams so the offline suite covers every new behavior. No new pipeline stage; the hosted watcher is untouched.

## Summary
**Problem**: The PC-local LinkedIn leg shows machine signatures — fixed 10-minute tick, exact 5-second pacing, uncapped pagination, fixed surface order — and has no reaction to 429. This profile contributed to an account restriction.
**Recommended**: Option 2, src behavior module — four pure state machines in a new `src/linkedin-behavior.ts`, wired by the script preflight band; the four walk mechanics stay as local edits in `src/linkedin-fetch.ts`.
**Effort**: Medium (3-5 days).
**Confidence**: High.

## Problem Statement

**Requirements** (FRD FR-0..FR-9):
- FR-0 dedicated-account gate: block entry until the dedicated account resolves, the old personal path is gone, and exactly 5 linkedin surfaces remain.
- FR-1 jittered ~30-minute wake-ups (uniform 28-33 minutes; developer-recorded default).
- FR-2 randomized 5-15s request spacing.
- FR-3 one page (50 posts) per surface per tick.
- FR-4 per-tick stop + one alarm per episode on an unparsable 200.
- FR-5 shuffled surface order per tick.
- FR-6 the operator override stays intact (the probe bypasses `fetchTick` structurally).
- FR-7 persistent halt latch on 429 + forced logout; operator-cleared only.
- FR-8 config cut to exactly 5 linkedin surfaces with a validator rule.
- FR-9 hard daily GET budget of 150; local-midnight reset; a mid-walk trip latches + one alarm.

**Constraints:**
- Hard: the offline suite covers every new behavior; errors fail visibly and name the remedy; state writes stay atomic; strict TS flags stay on; no new runtime dependency without stated need; the hosted watcher is untouched; every policy rides an existing seam.
- Soft: repo doctrine — tuning values are hard-coded module constants; probe-measured values are committed data; policy lives in scripts, mechanics in src.

**Success criteria:**
- The account never takes a new restriction. Much slower, smaller fetches are acceptable.
- The loop keeps running. The latch blocks all GETs until the operator clears it.
- Worst-case arithmetic stays legal: 28 ticks x 5 surfaces = 140 GETs < 150 budget.

## Current State

**Existing implementation:**
- The PC loop is a fixed-period `for(;;)`: `TICK_MS = 600_000` at `scripts/watch-linkedin.ts:15`, bare `setTimeout` at :33, unconditional `void main()` at :38 — no entry guard, no injectable seam.
- The tick is `fetchTick` with an optional-trailing deps surface (`scripts/fetch-linkedin.ts:77-101`, 10 fields) and a preflight band before any GET (`guardCheckout` at :165, called :249; precedent commit `625b15e`).
- The walk pages uncapped (`src/linkedin-fetch.ts:475-492`), paces exactly 5s (`makePacingGate` :421-433; `PACE_MS` :66), claims surfaces in input order (`runPool`, `src/pool.ts:43`; call :470), and `classifyFault` has NO 429 branch (`src/linkedin-fetch.ts:192-240`; catch-all :240).
- Episode state is one repo-local marker file beside the payload (`DEFAULT_MARKER`, `scripts/fetch-linkedin.ts:107`), edge-detected with one alarm per episode (`handleLegDeadEpisode` :123-147), auto-cleared on the next good push (`clearEpisodeMarker` :149-157, called :278).
- Config validates shape only — no per-type count cap (`src/config-file.ts:154-193`). `watcher.config.json` carries 17 linkedin surfaces, one exact duplicate.
- The cookie file carries no account identity (`{liAt, jsessionid}`, `src/linkedin-session.ts`) — FR-0(b) has no machine signal today.
- Live volume evidence: payload commits of 1941 and 2243 posts per single tick (`5a1f7ed`, `a1dc2b3`) — the behavior FR-3 caps.

**Relevant patterns:**
- Pure state machines in their own src module: `src/judge-rotation.ts:5-7` — "moved verbatim from judge.ts; behavior unchanged; only module ownership and visibility differ". Constants and mutable state live there; policy stays at the consumer.
- Injectable clock/sleep: `SleepFn`/`now` trailing params in 12+ sites (`src/judge.ts:124-131`, `src/linkedin-fetch.ts:454-456`, `src/index.ts:232-233`).
- Optional-trailing deps: `FetchTickDeps` — each field documented with its default (`scripts/fetch-linkedin.ts:77-101`).
- Marker-file persistence: repo-local, atomic, beside the payload (`scripts/fetch-linkedin.ts:96-121`; atomic idiom `src/state.ts:196-221`, `src/linkedin-payload.ts:84-108`).
- Pure builder + thin sender: `buildLegDeadAlarmText`/`sendLegDeadAlarm` (`src/email.ts:271-300`).
- Config knob landing: `reasoningEffort` and `scrollRounds` — interface + `ALLOWED_KEYS` + `read*` + validate + return (`src/config-file.ts:244-280`).

**Integration points:**
- `scripts/watch-linkedin.ts:21-38` — the loop the jitter cadence replaces; needs the entry-guard + injectable-body refactor first.
- `scripts/fetch-linkedin.ts:234-280` — the preflight band the gates join. Ordering: FR-0 → latch → window → guardCheckout → cookies/transport → budget-wrapped walk.
- `src/linkedin-fetch.ts:117-119` — the `VoyagerGet` seam the budget wrapper wraps in scripts.
- `src/linkedin-fetch.ts:66,192-240,421-433,470,475-492` — the four walk-mechanic edit sites.
- `scripts/probe-linkedin.ts:49` — structural operator override; every new gate stays invisible to it.

## Solution Options

### Option 1: Gate-band monolith
**How it works:**
All new policy lands inline in the two scripts: working-hours gate, latch check, budget wrapper, jittered loop, alarm wording in `scripts/fetch-linkedin.ts` + `scripts/watch-linkedin.ts`; the four walk mechanics (pace-rng, 1-page cap, shuffle, 429 branch) are local edits in `src/linkedin-fetch.ts`. Zero new modules.

**Pros:**
- Smallest diff; every policy site already exists (preflight band, `FetchTickDeps`, episode machinery).
- Matches the documented split verbatim: policy in scripts, mechanics in src.
- `fetchTick` is already the shared entry — loop, one-shot, and tests adopt the gates in one place.

**Cons:**
- Latch/budget/window logic inline in scripts has no pure-suite home; every edge case (midnight rollover, 20:59/21:00 boundary, latch polarity) is testable only through `fetchTick`, conflating machine bugs with wiring bugs.
- `fetch-linkedin.ts` (~300 lines today) grows the latch + budget + window machinery inline.

**Complexity:** Medium (~3-4 days)
- Files to create: 1 (~250 lines: `tests/watch-linkedin.test.ts`)
- Files to modify: ~7 (~200 lines)
- Risk level: Medium

### Option 2: src behavior module (recommended)
**How it works:**
New `src/linkedin-behavior.ts` holds four pure, IO-free machines: `WorkingHours` (predicate over injected `now`), `DailyBudget` (`{localDate, count}` reducer over caller-supplied persistence), `HaltLatch` (trip/check over caller-supplied persistence — the file stays in scripts), and the jitter cadence (sampler over injected `rng` + bounds). Constants sit beside them, like `COOLDOWN_MS`/`WAKE_JITTER_MS` in `judge-rotation.ts:61-63`. Scripts wire policy: preflight band order, budget wrapper on the `VoyagerGet` seam, alarm routing, loop cadence. The four walk mechanics stay as local edits in `src/linkedin-fetch.ts`.

**Pros:**
- Direct in-repo precedent, done verbatim once already: `src/judge-rotation.ts:5-7`.
- One-module-one-suite convention: `tests/linkedin-behavior.test.ts` covers the miserable edge cases pure — rollover, boundaries, latch survives restart, negative auto-clear pin.
- Keeps the split coherent: scripts own IO and policy placement; the module owns decisions and stays offline-testable without doubles.

**Cons:**
- One more module + suite to maintain.
- The machines' wiring still lands in scripts — this option adds the module, it does not remove the wiring work.

**Complexity:** Medium (~3-5 days)
- Files to create: 2 (~450 lines: module ~150, tests ~300)
- Files to modify: ~8 (~250 lines)
- Risk level: Medium

### Option 3: Config-declared behavior
**How it works:**
A `behavior` block in `watcher.config.json` (window, budget, pace/jitter bounds) with validators in `src/config-file.ts`, following the `scrollRounds`/`reasoningEffort` knob template (`src/config-file.ts:244-280`). Constants become defaults; the absent block reproduces today's behavior.

**Pros:**
- Strong mechanical precedent — two landed knobs with full wiring templates; window/budget ride the existing `deps.config` (`scripts/fetch-linkedin.ts:78-79, :237`), zero new plumbing.
- Operator tuning without code edits; removal is deleting the block.

**Cons:**
- Contradicts the recorded plan-of-record: the FRD prescribes hand-rolled constants, "no new config keys"; repo doctrine says tuning values are hard-coded module constants.
- `ALLOWED_KEYS` is a closed-world check (`src/config-file.ts:55-64, :104-106`) — the JSON edit and the validator landing must ship together or all 4 config readers throw.
- Ceiling-aware validation is new territory: a typo can make the leg MORE aggressive (`budget: 100000`, `paceMinMs: 0`); type checks alone are insufficient. Cross-field rules (min <= max) have no precedent in the file.

**Complexity:** Low-Medium (~2-3 days)
- Files to create: 0
- Files to modify: ~6 (~180 lines)
- Risk level: Medium (doctrine + coupling)

### Option 4: Scheduler library
**How it works:**
Replace the 15-line `for(;;)` + `setTimeout` loop with a cron-with-jitter dependency — croner, node-cron, or toad-scheduler — firing `fetchTick` on a jittered ~30-minute cadence.

**Pros:**
- Healthy ecosystem: all three maintained, MIT/ISC, SLSA provenance, pushed within the last week of the data window.
- Cheap to add and remove; native ESM; negligible runtime cost.

**Cons:**
- Only node-cron ships jitter (`maxRandomDelay`, v4-era; jitter cleanup still landing in 4.6.0). croner has NO jitter in its complete 19-option table; toad-scheduler wraps croner at a lagging major.
- The library owns the clock and exposes no fake-clock seam — the offline-suite mandate (FRD NFR) is unreachable without re-wrapping the schedule computation in a pure injectable function, which is the exact code the candidate deletes.
- Violates the no-new-dependency convention; covers 1 of 10 FRs; the rebase-as-auto-update path breaks until the PC runs `npm install`.

**Complexity:** Low absolute, Medium effective (~1-2 days code + the test tax)
- Files to create: 1 (~250 lines: loop tests, fighting library internals)
- Files to modify: 3 (loop, package.json, lockfile)
- Risk level: High (verification path)

## Comparison

| Criteria | 1 Gate-band | 2 src module | 3 Config block | 4 Scheduler lib |
|----------|-------------|--------------|----------------|-----------------|
| Complexity | M | M | L-M | L absolute / M effective |
| Codebase fit | H | H (strongest precedent) | M (doctrine conflict) | L |
| Risk | M | M | M | H (verification) |

## Recommendation

**Selected:** Option 2

**Rationale:**
- The extraction precedent is in-repo and was done verbatim once already: `src/judge-rotation.ts:5-7`. Four state machines is exactly the scale that precedent answered.
- The one-module-one-suite convention gives the machines a pure offline home for the edge cases that are miserable through `fetchTick`: local-midnight rollover, 07:59/08:00/20:59/21:00 boundaries, latch survives restart, the negative auto-clear pin.
- Keeps the split coherent: scripts own IO and policy placement (preflight order, `VoyagerGet` wrapper, alarms, file persistence); the module owns decisions and stays IO-free.
- All four machines have pinned design inputs (window Mon-Fri 08:00-21:00; budget 150 with local-midnight reset; latch = all leg-dead classes + 429; uniform 28-33 minutes) — the module is a transcription job with low design risk.

**Why not alternatives:**
- Option 1: clears the filter; it is this option minus the module. It loses because inline script policy has no pure-suite home and the repo already answered this exact question with judge-rotation. Its wiring plan is fully retained — this option includes it.
- Option 3: clears the filter technically. It loses on doctrine: the FRD's plan-of-record prescribes hand-rolled constants with no new config keys, and tuning values are hard-coded by convention. Revisit only if the operator needs live tuning without edits.
- Option 4: fails the filter on verification-cost. The library-owned clock defeats the offline-suite NFR; the only coverage path re-wraps the very code it deletes. It also violates the no-new-dep convention, covers 1 of 10 FRs, and two of three libs ship no jitter at all.

**Trade-offs:**
- Accepting one more module and suite for cheap, pure edge-case coverage.
- Accepting that uniform 5-15s spacing sits at CV ≈ 0.29, at the vendor-sourced 0.3 "visibly automated" heuristic threshold; a heavier-tailed draw is a module-local swap if field evidence demands it.
- Accepting that the latch ends self-healing: an overnight trip stalls collection until a human deletes the flag. Deliberate fail-safe for an account with one restriction on record.

**Implementation approach:**
1. Phase 1 — loop refactor (prerequisite): entry guard + exported, injectable loop body in `scripts/watch-linkedin.ts` (copy the `scripts/fetch-linkedin.ts:282` idiom); unblocks `tests/watch-linkedin.test.ts`.
2. Phase 2 — the module: `src/linkedin-behavior.ts` + `tests/linkedin-behavior.test.ts`; constants beside the machines.
3. Phase 3 — wiring: `FetchTickDeps` gains latch/budget/window deps; preflight band order FR-0 → latch → window → guardCheckout; budget wrapper wraps `transport.get` at `scripts/fetch-linkedin.ts:256`; the loop wires the cadence + latch logging.
4. Phase 4 — walk mechanics: pace bounds + rng on `makePacingGate`, 429 branch in `classifyFault`, 1-page cap, pre-shuffle; latch alarm builder variant in `src/email.ts`; `PAYLOAD_MAX_AGE_MS` amendment in `src/linkedin-payload.ts`.
5. Phase 5 — config: the exactly-5-surface rule in `readSurfaces` (`src/config-file.ts:154-193`) + cut `watcher.config.json` to the 5-surface portfolio.

**Integration points:**
- `scripts/watch-linkedin.ts:15-38` — entry guard, injectable body, jittered cadence.
- `scripts/fetch-linkedin.ts:77` — +4 optional deps (latchPath, budgetPath, rng, window bypass).
- `scripts/fetch-linkedin.ts:234-280` — preflight band; wrapper at :256; the latch never rides `clearEpisodeMarker` (:149-157, called :278).
- `src/linkedin-fetch.ts:66,192-240,421-433,470,475-492` — bounds, 429 branch, gate rng, shuffle, cap.
- `src/email.ts:271-285` — latch alarm builder/subject variant.
- `src/linkedin-payload.ts:22` — staleness vs 33-minute worst-case cadence.
- `src/config-file.ts:154-193` — the 5-surface rule.

**Patterns to follow:**
- State-machine extraction: `src/judge-rotation.ts:5-7`.
- Preflight-before-GET placement: `scripts/fetch-linkedin.ts:165`, called :249 (precedent `625b15e`).
- Remedy-naming errors: `scripts/fetch-linkedin.ts:174-191` (convention `5573fa6`).
- Marker-file persistence: `scripts/fetch-linkedin.ts:96-121`.
- Builder/sender email variant: `src/email.ts:271-300`.

**Risks:**
- Budget exhaustion misroutes today: a mid-walk budget throw lands in the surface-fault arm, drains to `allSurfacesFaulted`, and dies as a quiet no-op — no alarm, no latch trip (`src/linkedin-fetch.ts:505-516` → `scripts/fetch-linkedin.ts:263-267`). Mitigation: design picks the channel explicitly — FRD default is budget trip = latch trip + one alarm; a pre-walk zero budget logs and no-ops.
- The latch has no 429 trigger until `classifyFault` gains the branch (`src/linkedin-fetch.ts:240`). Mitigation: add the branch; verify the body shape live via the probe protocol before trusting it.
- Existing green pins break without injection: ~4 exact pacing values, the 2-GET pagination pin, input-order pins, and 6 `fetchTick` tests under a default-on window gate. Mitigation: injectable rng + injectable gate bypass + identity-rng shuffles.
- Payload staleness: a 28-33-minute cadence vs `PAYLOAD_MAX_AGE_MS = 1_800_000` makes the hosted reader intermittently print DARK on healthy ticks (`src/linkedin-payload.ts:22`). Mitigation: amend the constant or its doc in the same landing.

## Scope Boundaries
- Building: the four machines, their scripts wiring, the four walk mechanics, the 5-surface rule, the latch alarm, the loop refactor + its suite.
- NOT building: warm-up GET (demoted — no verified non-search route exists), adaptive autothrottling, proxy rotation, fingerprint work (owned by curl-impersonate), hosted-watcher changes, cross-tick pagination bookmarks (each tick starts at page 0).

## Testing Strategy

**Unit tests:**
- Module suite: window boundaries (07:59/08:00/20:59/21:00 local, Sat/Sun); budget 149/150/151 + date rollover + persisted-file semantics; latch trip-once, survive-restart, negative auto-clear pin; cadence bounds 28/33 minutes under a seeded rng (the codebase's first rng seam — no harness precedent to copy).
- `fetch-linkedin` extensions: gate order (zero GETs before the band), outside-window quiet no-op, latch-present zero-GET tick, latch NOT cleared by the good-push edge, budget counting on the injected transport double, exactly-5 rule.
- `linkedin-fetch` extensions: sleeps within bounds + reserve-before-sleep invariant under a fixed rng; one GET per surface on a full page; identity-rng order preservation + known-rng permutation with correct reassembly; 429 branch pin + drain-then-throw.

**Integration tests:**
- Loop suite: jittered gaps vary across simulated ticks (never constant 600s), both fault arms preserved (leg-dead arm; warn-and-continue), iteration cap terminates.
- Config: validator rejections (0 and 6 surfaces), committed-file happy path loads the real 5-surface config.

**Manual verification:**
- [ ] Probe protocol: run `npm run probe-linkedin` twice, >=6h apart, on the dedicated account before trusting the loop.
- [ ] First live tick lands 1 page x 5 surfaces; payload row count <= 250.
- [ ] Operator drill: trip the latch under a controlled 429; confirm zero GETs while set; clear via file delete; confirm resume.
- [ ] PC reboot mid-day: the budget file survives; the day total stays <= 150.

## Open Questions
**Resolved during research:**
- Where does FR-0 live? Inside `fetchTick`'s preflight band with an injectable bypass — the developer's recorded default.
- Which classes latch? All current leg-dead classes plus a new 429 branch — the developer's recorded default.
- Persisted or in-memory budget? Persisted `state/linkedin-get-budget.json` `{localDate, count}`, atomic write — the developer's recorded default.
- Jitter bound? Uniform 28-33 minutes; worst case 140 < 150 — reproduces the FRD's own arithmetic.

**Requires user input:**
- FR-0(b) machine signal: provenance stamp written by `login-linkedin` at harvest vs operator checklist item. Default assumption: checklist item.
- FR-0(c) machine signal: blocked-path constant vs recorded list vs checklist only. Default assumption: blocked-path constant.
- Keyword shortlist: the FR-8 default portfolio (1 national umbrella, 1 city umbrella, 2 role-narrowed, 1 stack-narrowed) stands unless the operator records a different pick.

**Blockers:**
- None blocking implementation. The warm-up GET route stays parked until design names a non-search route that verifies live on the dedicated account.

## References
- `.rpiv/artifacts/research/2026-11-09_18-06-34_linkedin-humanlike-fetch-behavior.md` — the seam map this analysis is grounded in.
- `.rpiv/artifacts/discover/2026-11-09_17-29-56_linkedin-humanlike-fetch-behavior.md` — the FRD (FR-0..FR-9, developer decisions).
- `outputs/linkedin-restriction-prevention.md` — restriction post-mortem; 40-250/day survival envelope; 283-375 trigger band.
- `src/judge-rotation.ts:5-7` — the state-machine extraction precedent.
- `scripts/fetch-linkedin.ts:96-157` — marker-file episode machinery (the latch template).
- `src/linkedin-fetch.ts:192-240` — `classifyFault` (the 429 gap).
- External anchors (web-research cells): AWS jitter canon (Brooker 2015); Scrapy AutoThrottle floor/cap; Fowler manual-reset circuit breaker; CV < 0.3 regularity heuristic (vendor-sourced); operator-consensus 100-150 actions/day; node-cron `maxRandomDelay` (the only lib-native jitter; v4-era); crawlee `maxRequestsPerMinute`.

## Follow-up Analysis 2026-11-09T18:48:28+0700

Reviewer pass on the run itself. Prior scoring and the verdict stay unchanged; this section corrects inputs and resolves one open question.

### 1. Surface count reconciled (settles the 17-vs-20 discrepancy)
`watcher.config.json` parsed directly: **17 linkedin surfaces** (28 surfaces total: 3 tag, 8 url, 17 linkedin). The exact duplicate `hiring developer jakarta` (x2) is confirmed. The web-researcher cell's "20 linkedin surfaces" (WS:src-module report) was a miscount; the research doc's 17 stands. FR-8's cut is 17 → 5. The research doc's `watcher.config.json:92-158` line range is confirmed accurate.

### 2. Dimension scope: novelty / approach-shape do not separate candidates 1-3
Candidates 1-3 are wholly internal code-placement questions; the skill allows dropping external-anchored dimensions at the Step 3 checkpoint, and that drop did not happen. The WS:gate-band and WS:config cells (Scrapy AutoThrottle, AWS jitter canon, Fowler breaker, Crawlee knobs) are **retained as background evidence, not as differentiators** — they support the FRD's parameter choices (100-150/day, business hours, randomized spacing) for all internal candidates equally. Only WS:scheduler carried verdict weight (it killed Option 4 on jitter coverage + offline-testability).

### 3. Options 1 and 2 are one option with a placement rider
The two candidates share wiring, risks, and integration points; they differ only in whether the four machines sit in `src/linkedin-behavior.ts` or inline in `scripts/fetch-linkedin.ts`. The recommendation stands (the extraction precedent `src/judge-rotation.ts:5-7` plus the one-module-one-suite convention favor the module), but the leverage is small. The decisions that will consume design time are **candidate-independent** and already sit in Risks: the budget-exhaustion channel (tagged error vs legDead reuse), latch polarity vs `clearEpisodeMarker`, the 429 classifier branch, and `PAYLOAD_MAX_AGE_MS`.

### 4. FR-0(b) resolved: the provenance stamp is feasible (replaces the checklist-item default)
The unknown was technical and is now resolved against the code. `scripts/login-linkedin.ts` harvests `{liAt, jsessionid}` from the jar (`findSessionCookies` :55-61) and writes the cookie file atomically (`writeCookieFile` :69-74, the state.ts temp+rename idiom). At harvest time the helper HOLDS a logged-in browser session (`page.goto("https://www.linkedin.com/feed/")` :114; `context.cookies()` :116/:152/:160), so it can read the session identity from that context at zero fetch-leg cost. Design input: extend the pair to `{liAt, jsessionid, harvestedAt, accountLabel}` — `harvestedAt` machine-written, `accountLabel` read from the logged-in page (or operator-typed at the login prompt). The FR-0(b) gate then checks stamp presence + freshness instead of an unverifiable operator checklist. The cookie resolver in `src/linkedin-session.ts` must tolerate the extra keys (it reads two named fields; extra keys are inert).

### 5. Line estimates grounded (replaces the invented numbers)
Derived from the extraction precedent's actual footprint (wc -l):
- `371 src/judge-rotation.ts`
- `1107 tests/judge-rotation.test.ts`
- `294 scripts/fetch-linkedin.ts`
- `38 scripts/watch-linkedin.ts`
- `526 src/linkedin-fetch.ts`
- `709 tests/linkedin-fetch.test.ts`
- `549 tests/fetch-linkedin.test.ts`
- `3594 total`

The module estimate follows `src/judge-rotation.ts` (state machines + constants, no IO); the suite estimate follows `tests/judge-rotation.test.ts` at the same case depth (window boundaries, budget rollover, latch polarity, seeded-rng cadence). Correction against the real peer footprint: the peers are LARGER than the original estimate — module 371 lines (not ~150), suite 1107 lines (not ~300). Corrected Option 2 sizing: module ~370, suite ~700-1100, total ~1100-1500 lines across ~2 new + ~8 modified files. Effort stays Medium (3-5 days); the delta is mechanical offline tests, not design work.
