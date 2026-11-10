---
date: 2026-11-09T17:29:56+0700
author: Yogiswara Utama
commit: 32a0bcd
branch: ukind/feature-anti-restrict
repository: feature-anti-restrict
topic: "linkedin-humanlike-fetch-behavior"
tags: [intent, frd, linkedin-fetch, watch-linkedin, pacing, anti-detection]
status: ready
last_updated: 2026-11-09T17:29:56+0700
last_updated_by: Yogiswara Utama
---

# FRD: linkedin-humanlike-fetch-behavior

## Summary
Make the PC-local LinkedIn voyager leg behave like a person instead of a metronome: jittered ~30-minute wake-ups inside weekday working hours (Mon-Fri 08:00-21:00), randomized 5-15s request spacing, one page per surface per tick, shuffled surface order, and a two-tier halt (per-tick stop on unparsable 200; persistent operator-cleared latch on 429/forced logout). Volume lands at ~130 GETs/day — inside the documented survival envelope — with the leg moved to a dedicated account.

## Problem & Intent
The LinkedIn account got flagged. The current mechanism looks like bot behaviour — fixed 10-minute ticks, fixed 5-second gaps, uncapped pagination, same surface order every tick, running around the clock. The developer's stated success criterion: "Account stays clean" — the account never gets flagged again. (Selected from interviewer-authored options; the "much slower, smaller fetches" clause rode the option text — treat account safety as the goal, volume as a means.) The reference research (`outputs/linkedin-restriction-prevention.md`) finds no request rate makes LinkedIn automation compliant; reduced volume only lowers detection odds. The developer chose to keep the leg and make it humanlike rather than retire it, accepting that risk is lowered, not removed.

## Goals
- The LinkedIn account is never flagged again while the leg runs.
- The leg's request pattern carries no fixed-period signature: wake time, gap length, and surface order all vary.
- Daily voyager GET volume stays inside the documented 40-250/day survival envelope (~130/weekday target) and is hard-capped by FR-9's daily budget, not merely hoped-for.
- The leg stops itself at the first early-warning signal instead of hammering a burned session.
- All new behavior is covered by the offline suite — no live LinkedIn calls needed to verify.

## Non-Goals
- Retiring the voyager leg and replacing it with compliant sources (LinkedIn job-alert emails, SerpApi Google Jobs, RemoteOK/WWR feeds) — offered and ruled out; the leg stays.
- Re-enabling any hosted/cloud LinkedIn fetch (GitHub Actions phases) — already removed from `watch.yml`, stays removed.
- Session-export vendors or third-party token APIs — already removed, stays removed.
- Changing the hosted watcher pipeline (fetch → judge → notify) — untouched.
- Making the leg compliant with LinkedIn's User Agreement — impossible per the reference doc; this is detection-avoidance only.
- Full feed coverage: the 1-page cap deliberately covers only each surface's top-50-per-tick; a slow feed can pin a post below rank 50 for its whole 24h server-filter life, leaving it permanently unfetched. The earlier claim that "page-2+ posts surface on later ticks" is corrected here.

## Functional Requirements
0. **FR-0 — gating prerequisite, blocks the first live tick:** the leg SHALL refuse to fetch until ALL four hold: (a) a dedicated account exists, created and warmed by ordinary human use; (b) `npm run login-linkedin` harvested a NEW cookie file for it and `LINKEDIN_COOKIES_FILE` points at that newly-harvested path; (c) the old (personal-account) cookie path appears in no `.env`, config, or docs — the only machine-checkable signal, since the cookie file itself carries no account identity (`{liAt, jsessionId}`, `src/linkedin-session.ts`); (d) `watcher.config.json` holds exactly 5 `type: "linkedin"` surfaces (FR-8) — an ungated 17-surface config would fire 442 GETs/day on a fresh account, above the 283 trigger. Every entry SHALL fail fast naming the missing prerequisite; the first live tick must be impossible on the already-restricted personal account. Volume safety on the new account is an assumption (see Constraints), so the first week runs as a ramp: any warning trips FR-7 immediately.
1. The PC loop SHALL wake on a jittered interval around a 30-minute base instead of a fixed 600s (`scripts/watch-linkedin.ts:15`).
2. The pacing gate SHALL space consecutive voyager GETs by a random 5-15s instead of a fixed 5s (`src/linkedin-fetch.ts:66`, `makePacingGate` at `:421`).
3. The surface walk SHALL fetch at most one page (50 posts) per surface per tick (`src/linkedin-fetch.ts:475-492`).
4. An unparsable 200 response body SHALL stop the whole leg for that tick (leg-dead-class stop, never a single-surface skip) and SHALL send one alarm per episode; the next tick retries. It does NOT trip the persistent latch (FR-7) (`src/linkedin-fetch.ts:486-488`, `:498-509`).
5. The walk SHALL visit surfaces in shuffled order each tick (`runPool` claim order, `src/linkedin-fetch.ts:470`).
6. The leg SHALL issue GETs only 08:00-21:00 local, Monday through Friday — no weekend ticks, matching the only field-surviving profile verbatim (linkedin-go preset, reference doc §4.2). The gate SHALL live in `fetchTick` so the loop, the one-shot entry, and the offline tests share one gate; `probe-linkedin` stays an explicit operator override. Expected ~25 ticks/weekday after jitter (24-26), zero on Sat/Sun.
7. A persistent early-warning latch (HTTP 429, forced logout, re-auth prompt) SHALL halt the leg until an operator clears it; the halt SHALL survive process restarts. Clear path: the operator deletes the halt marker (`LINKEDIN_HALT_MARKER`, a repo-local sibling of the payload, e.g. `state/linkedin-leg-halted.flag`) in the dedicated clone; the loop logs the latch each tick while set; NO code path removes it automatically. Unparsable 200 rides FR-4's per-tick stop instead.
8. `watcher.config.json` SHALL configure exactly 5 `type: "linkedin"` surfaces selected by this rule (the operator may substitute a recorded pick before the first live tick): drop the exact duplicate (`hiring developer jakarta`), then keep the breadth portfolio — 1 national umbrella (`hiring indonesia`), 1 city umbrella (`hiring jakarta`), 2 role-narrowed (`hiring developer indonesia`, `hiring engineer jakarta`), 1 stack-narrowed (`hiring react indonesia`) — recorded in the config commit message; the config validator SHALL reject more than 5 linkedin surfaces fail-visibly.
9. The leg SHALL count voyager GETs per local day and hard-stop at the cap: reaching `DAILY_GET_BUDGET` (constant in `scripts/fetch-linkedin.ts` beside `fetchTick`, default 150) trips the FR-7 latch with one alarm. 150 sits above the worst-case jitter day (28 ticks × 5 = 140) and below both the 250/day envelope top and the 283-375 documented trigger band; the counter resets at local midnight and the count rides the tick log.

## Non-Functional Requirements
- **Performance**: ~130 voyager GETs per weekday (24-26 jittered ticks × 5 surfaces × 1 page), zero on weekends — ~93/day averaged over the week, inside the 40-250/day envelope; `DAILY_GET_BUDGET` (FR-9) hard-caps any single day at 150. Digest freshness up to ~30 min stale on weekdays; Saturday and early-Sunday posts are never fetched (accepted cost of the Mon-Fri window vs the trailing-24h server filter).
- **Security**: session cookies stay in the existing out-of-repo file (`LINKEDIN_COOKIES_FILE`); no cloud runners, no session export, no third-party token handling.
- **UX / Accessibility**: headless pipeline — the operator-facing surface is the log plus the halt state; a halted leg MUST say so loudly (one alarm per episode, marker-file idiom like the existing leg-dead episode marker).
- **Reliability**: the persistent latch reuses `scripts/fetch-linkedin.ts`'s marker-file MECHANISM (repo-local beside the payload, survives restarts) with INVERTED polarity: present = leg halted, and it is NEVER auto-cleared by a healthy tick — the leg-dead marker clears via `clearEpisodeMarker` on the next good tick, this one must not; only an explicit operator action clears it. FR-4's per-tick stop uses the episode-marker edge (one alarm per episode) and self-clears on the next tick.

## Constraints & Assumptions
- Node >= 22, strict TS ESM; all timing stays behind the existing injectable seams (`SleepFn`, `now`) so the offline `node:test` suite covers every new behavior.
- The leg remains a User Agreement §8.2 violation; this work lowers detection odds only (reference doc §1, §6).
- Assumption: the documented trigger band (283-375 searches/24h) and survival envelope (40-250/day) generalize to this account — both rest partly on single-account field evidence, and the dedicated account's own trigger is unmeasured (the pre-restriction leg emitted only ~30-40 GETs total). 130/day is a design target from field evidence, not a measured ceiling; FR-0's ramp week plus FR-7's latch are the operative safety net.
- A dedicated LinkedIn account and a fresh cookie export are prerequisites, enforced by FR-0; the leg does not run on the personal account again.
- Working hours are the PC's local timezone; the loop runs on the operator's PC, not a runner.

## Acceptance Criteria
- [ ] **FR-0 gate (blocks everything else):** `LINKEDIN_COOKIES_FILE` points at the newly-harvested dedicated-account file, the old cookie path appears in no `.env`/config/docs, `watcher.config.json` holds exactly 5 linkedin surfaces, a live tick succeeds with the new file, and the one-shot entry exits 1 naming the missing prerequisite when any gate item is unmet (a deliberately bad 17-surface config must trip FR-0(d)).
- [ ] `npm test` exits 0, with new tests asserting: wake gaps vary across simulated ticks (not constant 600s); pacing sleeps fall in 5-15s and differ call-to-call; a 200 body with exactly 50 posts triggers no second GET (1-page cap); an unparsable 200 body stops all further GETs for that tick and alarms once per episode; surface order differs across ticks under the seeded injectable `rng` seam; a `fetchTick` starting outside working hours or on Sat/Sun issues zero GETs (gate lives in `fetchTick`, fake clock); a day forced past `DAILY_GET_BUDGET` stops GETs mid-walk, trips the latch, and alarms once; a 429 trips the persistent latch and the leg stays halted on the following tick until the marker is operator-cleared.
- [ ] `npm run typecheck` and `npm run lint` exit 0.
- [ ] `watcher.config.json` contains exactly 5 `type: "linkedin"` surfaces and no duplicate keyword, chosen per the FR-8 selection rule or a recorded operator override.
- [ ] Coverage boundary is explicit: a fixture surface returning 60 posts yields exactly the top 50 in the payload plus one boundary warn; rank-51+ posts legitimately stay out of the digest (accepted trade-off, see Non-Goals).
- [ ] A scripted dry-run tick (injected transport, no network) shows: 5 shuffled search GETs spaced 5-15s apart, then stop (warm-up excluded — demoted, route unverified).

## Recommended Approach
Behavioral layer inside the existing PC-local leg — no new pipeline stage: jittered tick in `scripts/watch-linkedin.ts`; randomized pacing, 1-page cap, shuffle, and halt-on-warning in `src/linkedin-fetch.ts` (warm-up deferred — route unverified, see Suggested Follow-ups) behind the existing `SleepFn`/`now` injection; working-hours gate inside `fetchTick` (loop, one-shot entry, and tests share it; `probe-linkedin` remains an explicit operator override); 5 surfaces in `watcher.config.json`. A small humanlike-behavior seam (jitter/window/shuffle helpers plus an injectable `rng: () => number` defaulting to `Math.random`) keeps the logic unit-testable offline.

Constant placement follows repo doctrine (tuning values are hard-coded module constants; no new config keys): `PACE_MIN_MS = 5_000`, `PACE_MAX_MS = 15_000`, `PAGES_PER_SURFACE_PER_TICK = 1` in `src/linkedin-fetch.ts`; tick-jitter bounds in `scripts/watch-linkedin.ts`; the working-hours window, weekday mask, and `DAILY_GET_BUDGET` constants in `scripts/fetch-linkedin.ts` beside `fetchTick`; `LINKEDIN_HALT_MARKER` beside the payload. Test homes: pacing/shuffle/cap/latch assertions extend `tests/linkedin-fetch.test.ts`; tick jitter + window gating live in a NEW `tests/watch-linkedin.test.ts` (no such file exists today).

## Decisions

### Success criterion (intent)
**Question**: When this feature is done, what does success look like for you?
**Recommended**: n/a — `intent` question
**Chosen**: "Account stays clean" — the account never gets flagged again; much slower, smaller fetches are acceptable.
**Rationale**: developer's own words; sets the volume ceiling every later decision is checked against.

### Leg's fate
**Question**: The reference doc finds no rate makes LinkedIn automation compliant — only removal avoids recurrence. Retire the leg, or build the humanlike behavior as asked?
**Recommended**: Retire the leg (Option A — zero restriction risk)
**Chosen**: Keep leg, humanlike (Option B)
**Rationale**: feed-post coverage matters more than compliance; developer accepts lowered-not-removed risk explicitly.

### Tick cadence
**Question**: How often should the humanlike leg wake up?
**Recommended**: 2-4 fetches/day (6-12h base)
**Chosen**: 30-minute jittered base
**Rationale**: freshness prioritized; the volume cost was reconciled by cutting surfaces to 5.

### Surface count
**Question**: To keep the account clean at 30-minute freshness, how many LinkedIn surfaces should the leg walk?
**Recommended**: 5 surfaces (240 GETs/day, inside the envelope)
**Chosen**: 5 surfaces
**Rationale**: 24-26 weekday ticks × 5 surfaces × 1 page ≈ 130 GETs/weekday (~93/day week-average, Mon-Fri) — under the 283 documented trigger with margin, hard-capped by FR-9 at 150.

### Active hours
**Question**: When is the leg allowed to run?
**Recommended**: Working hours only (~08:00-21:00 local)
**Chosen**: Working hours only — amended post-write to Mon-Fri 08:00-21:00 (weekend ticks dropped)
**Rationale**: no human searches at 03:00; timing pattern is a documented detection signal; weekend absence matches the only field-surviving profile verbatim.

### Jittered wake-up
**Question**: The PC loop wakes exactly every 600 seconds around the clock (`scripts/watch-linkedin.ts:15`). Keep this, or change it?
**Recommended**: Jitter the wake-up
**Chosen**: Jitter the wake-up
**Rationale**: evidence: `scripts/watch-linkedin.ts:15` — fixed 600s `setTimeout` in `for(;;)` is the textbook fixed-period signature; confirmed.

### Randomized pacing
**Question**: Voyager GETs are spaced exactly 5000ms apart, no randomness (`src/linkedin-fetch.ts:66`, `makePacingGate` `:421`). Keep this, or change it?
**Recommended**: Random 5-15s gaps
**Chosen**: Random 5-15s gaps
**Rationale**: evidence: `src/linkedin-fetch.ts:421-433` — `nextFreeAt = slotAt + PACE_MS` is clockwork pacing, the field's most-cited single vector; confirmed.

### Pagination cap
**Question**: Each surface pages 50-at-a-time until the feed runs dry, no cap (`src/linkedin-fetch.ts:475-492`). Keep this, or cap it?
**Recommended**: Cap 1 page/surface
**Chosen**: Cap 1 page/surface
**Rationale**: evidence: `src/linkedin-fetch.ts:475-492` — uncapped `for(;;)` produced 56-72 pages/10 min in testing, a documented trigger; confirmed.

### Unparsable-200 policy
**Question**: A 200 body that fails parsing counts as a per-surface fault — warn and skip, full rate next tick. Keep this, or escalate?
**Recommended**: Leg-wide cooldown
**Chosen**: Leg-wide cooldown — amended post-write (Step 8 review): scoped to a per-tick stop + one alarm per episode; the persistent operator-clear latch is reserved for 429/forced-logout (FR-7)
**Rationale**: evidence: `src/linkedin-fetch.ts:486-488`, `:498-509` — a restriction page arriving as 200 OK HTML currently gets re-hammered at full rate every tick; confirmed.

### Surface shuffle
**Question**: Should the leg shuffle surface order each tick?
**Recommended**: Shuffle per tick
**Chosen**: Shuffle per tick
**Rationale**: evidence: `src/linkedin-fetch.ts:470` — `runPool` claims in config order, so the same 5 keywords fire in the same sequence every 30 min; confirmed.

### Warm-up GET
**Question**: Should the leg warm up before searching?
**Recommended**: Warm-up GET
**Chosen**: Warm-up GET
**Rationale**: cold-start-into-search is a documented restriction vector; a cheap non-search GET first costs one request per idle-restart.

### Halt on warning
**Question**: What should the leg do when it sees an early-warning signal?
**Recommended**: Halt on warning
**Chosen**: Halt on warning — amended post-write (Step 8 review): the persistent latch covers 429 + forced logout/re-auth; unparsable-200 rides the FR-4 per-tick stop (the interview option over-listed it)
**Rationale**: the field's only no-recurrence case stopped at the first warning; a forced logout mid-walk must not finish the tick.

### Account
**Question**: Which account should the humanlike leg use?
**Recommended**: Dedicated account
**Chosen**: Dedicated account
**Rationale**: the personal account already has one restriction on record; the official ratchet makes a repeat potentially permanent.

### Dedicated-account gate (post-write amendment)
**Question**: FR-9 had no setup path — implementation without it fires the first live tick at the already-restricted personal account.
**Recommended**: promote to a gating prerequisite
**Chosen**: FR-0 blocks every entry until the dedicated account exists, its cookie file resolves via `LINKEDIN_COOKIES_FILE`, and zero personal-account references remain; first acceptance checkbox
**Rationale**: the official ratchet makes a second strike potentially permanent; the gate is cheaper than the risk.

### Warm-up GET demotion (post-write amendment)
**Question**: FR-6 named no endpoint and none exists in the codebase — as a numbered requirement it stalls design or invites an invented route.
**Recommended**: demote until a route verifies live
**Chosen**: moved to Suggested Follow-ups; FR-6 removed; dry-run criterion excludes warm-up
**Rationale**: a wrong route is itself a 403/automation signal; the vendor practice proves the pattern, not the route.

### Weekend window (post-write amendment)
**Question**: Does the working-hours window drop weekends?
**Recommended**: Mon-Fri only
**Chosen**: Mon-Fri only
**Rationale**: the FRD had borrowed Option B's window without its cadence — a 7-day 13h square wave had no evidence behind it; the surviving preset is 8a-9p Mon-Fri; the cost is Saturday + early-Sunday posts going unfetched.

### Daily GET budget (post-write amendment)
**Question**: Nothing enforced the ~130/day figure — it was an emergent property of four probabilistic choices.
**Recommended**: hard daily cap
**Chosen**: FR-9 — `DAILY_GET_BUDGET = 150`, mid-walk hard stop trips the FR-7 latch with one alarm, resets local midnight
**Rationale**: 150 sits above the worst-case jitter day (140) and below both the 250/day envelope top and the 283-375 trigger band; the budget is what turns "account stays clean" into an enforced property.

### FR-0(d) surface-cut fold (post-write amendment)
**Question**: FR-0 gated account + cookies but not the surface count — day one on a 17-surface config = 442 GETs/day on a fresh account.
**Recommended**: fold the 5-surface check into FR-0
**Chosen**: FR-0(d) — a config without exactly 5 linkedin surfaces fails the entry
**Rationale**: the gate is only real if it gates the volume lever too.

### Payload-tail boundary (post-write amendment)
**Question**: The 1-page cap silently drops rank-51+ posts; the earlier "page-2+ posts surface on later ticks" claim was wrong for slow feeds.
**Recommended**: document as accepted boundary
**Chosen**: coverage boundary stated in Non-Goals + fixture acceptance criterion
**Rationale**: the cap was chosen knowingly; the false coverage claim was not — corrected.

## Open Questions
- Jitter bound around the 30-minute base (e.g. ±5-10 min) — deliberately deferred to design; acceptance only requires "gaps vary, mean ≈30 min".
- Keyword shortlist — FR-8 now carries a recommended default portfolio; the operator may override with a recorded pick before the first live tick.

## Suggested Follow-ups
- Warm-up GET (demoted from the FR list by review): the leg has exactly one URL builder (`buildSearchUrl`, `src/linkedin-voyager.ts`) and no cheap non-search route; a wrong route is itself a 403/automation signal. Re-promote only after design names a route and it verifies live on the dedicated account.
- `probe-linkedin` should only ever run against the dedicated account, sparingly (reference doc §7 Option B item 8) — not changed here.
- The reference doc's Option A (job-alert emails + SerpApi Google Jobs + RemoteOK/WWR) remains the only zero-risk path — worth revisiting if a second restriction ever occurs.
- `watcher.config.json` currently carries 17 LinkedIn surfaces with one duplicate (`hiring developer jakarta`); the cut to 5 is in scope, the keyword selection is the open question above.

## References
- `outputs/linkedin-restriction-prevention.md` — restriction post-mortem, detection evidence, mitigation landscape (60 cited sources)
- `scripts/watch-linkedin.ts:15`, `src/linkedin-fetch.ts:66,421,470,475-492,498-509`, `watcher.config.json` — probed codebase evidence
- `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/scripts/architecture.md` — repo architecture guidance
- Probe provenance: no locator/analyzer agents available in this environment and no graph index row for this checkout — all evidence is direct file reads (`src/linkedin-fetch.ts`, `scripts/watch-linkedin.ts`, `scripts/fetch-linkedin.ts`, `src/linkedin-voyager.ts`, `src/linkedin-session.ts`, `src/pool.ts`, `watcher.config.json`); research inherits the weaker probe knowingly
