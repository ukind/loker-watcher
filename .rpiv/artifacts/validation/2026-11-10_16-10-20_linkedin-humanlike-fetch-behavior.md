---
template_version: 1
date: 2026-11-10T16:37:54+0700
author: Yogiswara Utama
commit: 813f835
branch: ukind/feature-anti-restrict
repository: feature-anti-restrict
topic: "Validation of linkedin-humanlike-fetch-behavior"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-10_09-40-06_linkedin-humanlike-fetch-behavior.md"
tags: [validation, linkedin-fetch, watch-linkedin, pacing, anti-detection, halt-latch, daily-budget, provenance]
last_updated: 2026-11-10T16:37:54+0700
---

## Validation Report: linkedin-humanlike-fetch-behavior

### Implementation Status

- ✓ Phase 1: behavior module — Fully implemented
- ✓ Phase 2: loop refactor — Fully implemented
- ✓ Phase 3: walk mechanics — Fully implemented
- ✓ Phase 4: fetchTick wiring — Fully implemented
- ✓ Phase 5: provenance + reset — Fully implemented
- ✓ Phase 6: config — Fully implemented

Implementation landed in 7558747 (+ eb2c445 guidance coverage map, 34e91b9 curl-leak sanitization). Validation ran against the committed tree at 813f835; working tree clean except two pre-existing untracked `outputs/` files the plan itself references (the restriction post-mortem — operator-owned, not run-created).

### Automated Verification Results

- ✓ Project typecheck: `npm run typecheck` — no errors
- ✓ Project lint: `npm run lint` — 65 files checked, no fixes needed
- ✓ Full suite: `npm test` — 570 tests / 570 pass / 0 fail (127 suites), plan-carrying suites included
- ✓ No regressions detected — base 32a0bcd measured (detached checkout, full suite): 513 tests / 513 pass / 0 fail; delta -> 570/570
- ✓ Phase constants verified in shipped code: `WINDOW_START_HOUR=8`, `WINDOW_END_HOUR=21`, `WAKE_MIN_MS=28min`, `WAKE_MAX_MS=33min`, `DAILY_GET_BUDGET=150`, `PACE_MIN_MS=5000`, `PACE_MAX_MS=15000`, `PAGE_SIZE=50`, `PAYLOAD_MAX_AGE_MS=2_400_000`, `classifyFault(429) -> {kind:"halt", reason:HALT_RATE_LIMIT_REASON}` (src/linkedin-fetch.ts:246)
- ✓ FR-6 holds: `git diff 32a0bcd..HEAD -- scripts/probe-linkedin.ts` is empty — the probe never touches the walk
- ✓ .gitignore carries both new untracked paths: `state/linkedin-get-budget.json`, `state/linkedin-halt.flag`
- ✓ Committed config: exactly 5 linkedin surfaces (hiring indonesia, hiring jakarta, hiring developer indonesia, hiring engineer jakarta, react indonesia); the duplicate `hiring developer jakarta` is gone

### Code Review Findings

#### Matches Plan:

- src/linkedin-behavior.ts:25-151 — all four policy machines exported as specified; zero imports; rng and dates argument-injected
- scripts/watch-linkedin.ts:48-85 — injectable `runLoop`, jittered cadence via `sampleTickDelayMs`, leg-dead episode arm vs warn arm, `maxIterations` cap, entry guard at :85 (importing starts no loop)
- scripts/fetch-linkedin.ts:415-447 — preflight band in the specified order (window -> latch -> budget) BEFORE `guardCheckout`, then the FR-0 stamp gate (:427-436) BEFORE the transport opens; the budget wrapper reserves + persists before each GET; halt trips the latch, alarms once, returns quiet zeros; all-faulted preserves the last good payload
- src/linkedin-session.ts:133-141 — tolerant stamp read: present+non-string/blank ignored, probe stays safe on legacy files; enforcement lives only at the fetchTick gate
- scripts/reset-linkedin.ts:68-107 — removes cookie file, browser profile, halt latch in order; the budget ledger deliberately kept with the operator-facing explanation line
- src/email.ts:309-331 — `buildHaltAlarmText`/`sendHaltAlarm` best-effort halt alarm
- src/config-file.ts — exactly-five enforcement with the count + spread in the message
- .rpiv/guidance/tests/architecture.md:42-45 — the coverage-map amendment landed (eb2c445): the new watch-linkedin suite supersedes the old NO-TESTS-BY-DESIGN line

#### Deviations from Plan:

- Plan Phase 6 criterion says the full glob is 571 tests; measured 570. The Phase 3 revise amendment replaced the old exec-failure test in place (45+13 = 58, "not 59") and the Phase 6 figure was never re-stamped. The command itself passes; count text only — non-blocking.
- Doc drift (comment-only, outside the plan's write-set, non-blocking): README.md:358 and AGENTS.md:42 still describe the loop as "tick + 10-minute sleep" (now jittered 28-33 min); .rpiv/guidance/src/architecture.md:126 still says "PAYLOAD_MAX_AGE_MS(30min)" (now 40 min / 2_400_000). README.md:104/222 "scheduled 10-minute runs" are about the hosted cron and remain true.

#### Pattern Conformance:

- ✓ src/linkedin-behavior.ts follows the judge-rotation extraction idiom (pure machines + constants, IO at the consumer) — the module header cites it
- ✓ Tagged-error idiom: HaltError/AllSurfacesFaulted mirror LegDeadError (factory-assigned name fields, isX guards)
- ✓ Suites stay offline and 1:1 with module names; the seeded LCG rng keeps cadence/shuffle pins deterministic
- Minor observation: scripts/reset-linkedin.ts imports its default paths cross-script (fetch-linkedin.ts, login-linkedin.ts) — acceptable variation, deliberate per its header note ("one definition"), not a deviation

#### Potential Issues:

- Drill side effect (my run, not the code): scripts/reset-linkedin.ts has NO profile-dir override, so the D4 CLI drill removed the operator's REAL browser profile at C:/loker-secrets/linkedin-chromium-profile. That is the command's designed behavior, but it costs the no-login re-harvest shortcut: the next `npm run login-linkedin` does a FULL manual 2FA login. The real cookie jar was untouched (the drill's env override pointed LINKEDIN_COOKIES_FILE at a synthetic file). Consider an env override or a README warning that reset deletes the profile.
- Deployment gap (operational, not a plan deviation): the dedicated main clone (H:/fork/loker-watcher) sits at e26f13b — it predates the implementation commit, its payload is stale (2026-11-09 11:03), and its leg-dead episode marker is present. The loop gains none of this behavior until that clone updates and the probe protocol passes.

### Manual Testing Required:

Executed live during this validation (synthetic jars/paths; zero real voyager GETs):

1. Phase 2 — loop behavior (D7): ran `npx tsx scripts/watch-linkedin.ts` ~55 s
   - [x] tick fault (feature checkout) warned and the loop KEPT RUNNING
   - [x] wake log printed: `watch-linkedin: next wake in ~33 min (17:04 local)` — jittered, in minutes, local wall clock
2. Phase 4 — halt latch (D2a/D2b)
   - [x] latch present -> `HALT LATCH present — fetching is blocked until the operator deletes it`, exit 0, quiet no-op
   - [x] latch deleted -> tick resumes past the preflight (reaches the checkout guard, exit 1 naming the branch — correct ordering)
3. Phase 4 — daily budget (D3)
   - [x] ledger at count 150 for 2026-11-10 -> `daily GET budget spent for 2026-11-10 — nothing to do until local midnight`, exit 0
4. Phase 5 — FR-0 gate + reset (D5, D4)
   - [x] scratch main-branch clone at 813f835 + stampless jar -> exit 1 naming "harvestedAt" + the re-harvest remedy, BEFORE any GET, zero side-effect files
   - [x] reset: cookie file + halt latch removed, budget ledger KEPT (count preserved)
5. Phase 6 — exactly-five config (D6a/D6b)
   - [x] live start with a 6th surface -> exit 1: "has 6 linkedin surfaces — exactly 5 are required ... keep the five-surface spread"
   - [x] 4 surfaces rejected with the count; a swapped surface value accepted (5 preserved)

Still operator homework (cannot run in-session; NOT dropped):

1. Probe protocol (Phase 3): `npm run probe-linkedin` twice, >= 6 h apart, on the dedicated account before trusting the loop — the live 429 body shape is unverified. No probe run during validation (live-network, operator-owned; the 2026-11-10 ~15:45 DNS-transient failures are already diagnosed in the plan's follow-up).
2. Trip the latch under a REAL 429 (Phase 4): the latch mechanics are verified synthetically above; the live 429 trigger is not reproducible on demand.
3. PC reboot mid-day (Phase 4): the ledger is plain disk state, so reboot survival is inherent; the <= 150 cap is live-verified (D3). Confirm the surviving count after the first real reboot.
4. login-linkedin drill (Phase 5): the stamp WRITE is suite-pinned and the live stamp gate is verified (D5); the full operator drill (harvest, hand-delete the key, watch the tick refuse) lands naturally at the next re-harvest — note the profile was consumed by the D4 drill, so expect a full 2FA login.
5. Ctrl-C stops the loop (Phase 2): unverified live — my `taskkill /T /F` failed to kill the npx/tsx tree (six stray node processes survived; all force-killed by PID afterward, remaining: 0). A console Ctrl-C sends CTRL_C_EVENT to the whole process group, which is a different (stronger) mechanism — confirm once on the real loop.
6. Hosted payload read with the cut fleet (Phase 6): hosted-side; static facts hold — 5 surfaces committed, payload-reader pins green, worst case 28 wake-ups x 5 surfaces = 140 GETs < the 150 budget.
7. Legacy stampless file passes `npm run probe-linkedin` (Phase 5): the resolver-tolerance half is suite-pinned; the live green-leg half folds into homework item 1 with the operator's real (re-harvested, stamped) jar.

### Recommendations:

- One-line doc pass before merge: README.md:358, AGENTS.md:42, .rpiv/guidance/src/architecture.md:126 (28-33 min jittered cadence; 40-min payload staleness), and the plan's Phase 6 count 571 -> 570.
- Update H:/fork/loker-watcher to the feature tip and run the probe protocol (two runs >= 6 h apart) before restarting the always-on loop.
- Give scripts/reset-linkedin.ts a profile-dir override (or README warning) so drills do not consume the real profile.

Ready to commit — implementation is complete and validated; the working tree is already committed through 813f835.
