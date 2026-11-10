---
date: 2026-11-10T12:01:04+0700
author: Yogiswara Utama
commit: 32a0bcd
branch: ukind/feature-anti-restrict
repository: feature-anti-restrict
topic: "Validation of linkedin-humanlike-fetch-behavior"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-10_09-40-06_linkedin-humanlike-fetch-behavior.md"
tags: [validation, linkedin-fetch, watch-linkedin, pacing, anti-detection, halt-latch, daily-budget, provenance]
last_updated: 2026-11-10T12:27:30+0700
last_updated_by: Yogiswara Utama
last_updated_note: "post-review amendment (reporting-layer corrections, code verdict unchanged): email count settled by measurement (HEAD 34 -> working 36 it-counts, slice added 2; plan's 12 matches nothing); Ctrl-C and .gitignore criteria relabeled measured/inferred; 19 untracked paths ruled 5 commit / 14 keep-out"
---

## Validation Report: linkedin-humanlike-fetch-behavior

### Implementation Status

- ✓ Phase 1: behavior module — Fully implemented
- ✓ Phase 2: loop refactor — Fully implemented
- ✓ Phase 3: walk mechanics — Fully implemented
- ✓ Phase 4: fetchTick wiring — Fully implemented
- ✓ Phase 5: provenance + reset — Fully implemented
- ✓ Phase 6: config — Fully implemented

### Automated Verification Results

- ✓ Project typecheck: `npm run typecheck` — clean (tsc --noEmit over src, tests, scripts)
- ✓ Project lint: `npm run lint` — 65 files, no diagnostics
- ✓ Project suite: `npm test` — 570 tests / 570 pass / 0 fail (127 suites)
- ✓ Slice 1 suite: `npx tsx --test tests/linkedin-behavior.test.ts` — 16/16 (plan claimed 16)
- ✓ Slice 2 suite: `npx tsx --test tests/watch-linkedin.test.ts` — 6/6 (plan claimed 6)
- ✓ Slice 3 suites: `npx tsx --test tests/linkedin-fetch.test.ts tests/linkedin-payload.test.ts` — 45 + 13 (plan claimed 45 + 13)
- ✓ Slice 4 suites: `npx tsx --test tests/fetch-linkedin.test.ts tests/email.test.ts` — 32 + 36 (plan claimed 30 + 12)
- ✓ Slice 5 suites: `npx tsx --test tests/linkedin-session.test.ts tests/login-linkedin.test.ts tests/reset-linkedin.test.ts tests/fetch-linkedin.test.ts tests/linkedin-fetch.test.ts` — 20 + 7 + 3 + 32 + 45 = 107 (plan claimed 107)
- ✓ Slice 6 suite: `npx tsx --test tests/config-file.test.ts` — 45/45 (plan claimed 46)
- ✓ FR-6 holds: `git diff --quiet HEAD -- scripts/probe-linkedin.ts` — exit 0, byte-identical
- ✓ M6 config cut: `node -e 'const c=require("./watcher.config.json"); console.log(c.surfaces.filter(s=>s.type==="linkedin").length)'` — prints 5; duplicate `hiring developer jakarta` absent
- ✓ M6 gitignore (partial — one of two legs): `git check-ignore -v state/linkedin-get-budget.json state/linkedin-halt.flag` — both matched (.gitignore:12,13). The throwaway-repo porcelain leg was NOT executed (see Deviations).
- ✓ No regressions detected — base 32a0bcd measured in a detached worktree: 513 tests / 513 pass / 0 fail; delta -> 570 / 570 / 0 fail (+57 tests, 0 failures)

### Code Review Findings

#### Matches Plan:

- src/linkedin-behavior.ts:1-160 — the four IO-free machines land verbatim: window (Mon-Fri 08:00-21:00 local, half-open), cadence (uniform [28, 33) min, floor not round), budget (150/day, local `YYYY-MM-DD` key, pure reserve, free midnight rollover), and the two canonical halt reasons. Zero imports.
- scripts/watch-linkedin.ts:1-91 — entry-guarded `runLoop` with the injected `RunLoopDeps` seam; the old fixed `TICK_MS = 600_000` is gone; the wake log names the delay and the local wall-clock time; leg-dead routes to the episode handler, any other fault warns and the loop continues.
- src/linkedin-fetch.ts:459-476 — `makePacingGate` draws a fresh uniform [5 s, 15 s) gap per reservation, still reserving the slot synchronously before the sleep (width-2 workers cannot compute the same wake time).
- src/linkedin-fetch.ts:502-578 — Fisher-Yates shuffle over `{surface, index}` pairs with the injected rng; `perSurface` stays keyed by the ORIGINAL index, so the flat() reassembly order is input-order structural regardless of dispatch order. One page per surface (FR-3: `buildSearchUrl(surface.value, 0, PAGE_SIZE)`, the `start += PAGE_SIZE` loop is gone); an unparsable 200 throws leg-dead (FR-4); the worker's `isHalt` arm drains a wrapper-thrown halt instead of counting it as a surface fault; halt outranks leg-dead at the join.
- src/linkedin-fetch.ts:237-245 — `classifyFault(429, ...)` returns `{kind: "halt", reason: HALT_RATE_LIMIT_REASON}`, reusing the behavior module's canonical string; 503 still falls through to the fault arm.
- scripts/fetch-linkedin.ts:390-424 — the preflight band runs window -> latch -> budget BEFORE `guardCheckout`, so a gated tick costs zero git spawns; the budget wrapper reserves + persists BEFORE the GET leaves; the halt arm trips the latch, alarms once (best-effort), and returns quiet zeros.
- scripts/fetch-linkedin.ts:424-436 — the FR-0 stamp gate fires after the checkout guard and before the transport opens, naming `harvestedAt` and the re-harvest remedy.
- src/linkedin-session.ts:129-141 — the tolerant stamp read: present + non-empty string rides through trimmed; anything else leaves the key ABSENT, so `scripts/probe-linkedin.ts` keeps working on a legacy stampless file.
- scripts/login-linkedin.ts:177-180 — `writeCookieFile` records the stamp from the INJECTED clock (`new Date(now()).toISOString()`), never the ambient one.
- scripts/reset-linkedin.ts:1-96 — removes cookie + profile + latch, deliberately KEEPS the budget ledger, idempotent (absent = quiet no-op), env-resolved cookie path honored.
- src/config-file.ts:202-210 — exactly-five enforcement with the count in the message; watcher.config.json resolves to the FRD five in order with the duplicate removed.
- src/email.ts:302-343 — `buildHaltAlarmText` + `sendHaltAlarm` follow the established builder/sender pair; the body names the remedy (delete the latch, or `npm run reset-linkedin`).
- .rpiv/guidance/tests/architecture.md:39-46 — the coverage-map amendment the plan required: the watch-linkedin NO-TESTS-BY-DESIGN line is superseded, probe-judge/probe-linkedin keep theirs.
- package.json:13-14,20 — `reset-linkedin` added to both the lint and format enumerations (scripts are enumerated, not globbed) plus the `reset-linkedin` run script.
- .gitignore:12-13 — both new state paths ignored.

#### Deviations from Plan:

- tests/fetch-linkedin.test.ts — 32 tests, plan claimed 30. The two extra tests cover the preflight band's gate-order pins (a latched tick = zero GETs + zero git spawns; a spent-budget tick skips before any GET). Additive, in-goal, non-blocking.
- tests/email.test.ts — 36 tests, plan claimed 12. Measured after review, not inferred: `git show HEAD:tests/email.test.ts | grep -c "it("` = 34 at HEAD vs 36 in the working tree — the slice added 2 tests (the halt-alarm builder/sender pins); the plan's "12" matches no measurement and was a wrong projection. Additive, in-goal, non-blocking.
- tests/config-file.test.ts — 45 tests, plan claimed 46. One fewer than claimed; the five-surface contract is fully pinned (exactly 5 accepted, 4/6/0 rejected with the count in the message, mixed threads+linkedin accepted, committed file resolves to the FRD five). Non-blocking.
- Full glob `npx tsx --test tests/*.test.ts` — 570 tests, plan claimed 571. The 1-test gap is the config-file count above; every other slice matches its claim exactly. Non-blocking.
- 19 undeclared untracked paths sat in the tree through this validation; no `--scope`/`--baseline` was passed, so no scope floor adjudicated them. Ruled here, per group:
  - COMMIT (5): the run's own `.rpiv/artifacts/` set — designs/2026-11-09_19-24-42, discover/2026-11-09_17-29-56, research/2026-11-09_18-06-34, solutions/2026-11-09_18-19-49, plans/2026-11-10_09-40-06 (all `linkedin-humanlike-fetch-behavior`). Repo doctrine keeps `.rpiv/artifacts/` tracked; `/skill:commit` should include them.
  - KEEP OUT (14): the article/research corpus under `outputs/` — `linkedin-restriction-prevention.md` + `.provenance.md`, `.plans/` x4 (T1, T2, T3, the main plan), `.drafts/` x8. No phase declared them, no criterion touches them, nothing in the pipeline imports them. Keep them out of the implementation commits; their home (track vs `.gitignore`) is an operator decision this report does not make.
- Plan Phase 4's `.gitignore` criterion named a throwaway-repo verification (empty `git status --porcelain` with budget + latch + marker present). Only the `git check-ignore -v` leg ran. INFERRED, not executed: the ignore-rule match implies the porcelain outcome for untracked-and-ignored files, but the specified leg never ran. Non-blocking.

#### Pattern Conformance:

- ✓ Tagged-error idiom (name constant + factory + type guard) followed exactly for `HaltError`, matching `LegDeadError` and `AllSurfacesFaulted` in the same file and `RotationExhausted` in judge-rotation.ts
- ✓ Pure-machines-plus-constants extraction mirrors the cited precedent (judge-rotation.ts:5-7): policy machines in src/linkedin-behavior.ts, IO and policy placement at the consumers
- ✓ Atomic-write idiom (`stateTempPath` + temp + rename, unlink on failure) reused for the budget ledger and the cookie file rather than a new writer
- ✓ Entry-guard idiom (`process.argv[1]` + `pathToFileURL`) applied to both new/refactored script entries; importing either module is side-effect free
- ✓ Env resolution stays `envWithDotEnv()`-merged with the real shell winning; no new env var introduced
- ✓ Test structure matches the offline-suite conventions: local Date constructors, seeded LCG rng, transcript-as-oracle pins, `t.mock.method` for console assertions
- Minor observation: `scripts/reset-linkedin.ts` imports `DEFAULT_BUDGET`/`DEFAULT_LATCH` from `scripts/fetch-linkedin.ts` while importing cookie/profile defaults from `scripts/login-linkedin.ts` — a deliberate single-source-of-truth choice documented in the file header. Acceptable variation, not a deviation.

#### Potential Issues:

- README.md:358, AGENTS.md:42, AGENTS.md:88, .rpiv/guidance/scripts/architecture.md:35, .rpiv/guidance/src/architecture.md:126 — stale cadence/payload prose: these still describe the loop as "tick + 10-minute sleep" / "600s sleep" and the payload staleness window as 30 min. The shipped code is 28-33 min and 40 min. Comment/doc-only: no executable line changes and no downstream stage fails as written. Non-blocking, worth a follow-up doc pass. (The "every 10 minutes" lines that describe the HOSTED cron — README.md:104, README.md:222, guidance workflows — remain true and are untouched.)
- The live 429 body shape is unverified (plan Phase 3 manual criterion): `classifyFault` keys on the status code alone, so the halt path is shape-independent, but the operator should still run the probe protocol before trusting the loop on the dedicated account.
- The wake log can print "~33 min" for delays in [32.5, 33) min (Math.round rounds up); the plan's manual line says "~28-32 min". Observed range in the drills was 28-31. Cosmetic.

### Manual Testing Required

Executed this session (all verified against the real code paths; live-network steps excluded):

1. Loop cadence and signal handling (Phase 2):
   - [x] `npm run watch-linkedin` logs `next wake in ~28-32 min (HH:MM local)` after each tick — real binary, 25 s live run: `watch-linkedin: tick FAILED — ...not main` (warn arm), then `watch-linkedin: next wake in ~31 min (12:45 local)`
   - [x] A leg-dead tick never exits the process — MEASURED: the loop survived its tick fault and was still running at 25 s; the observed exit was 137 (the fallback SIGKILL), not a SIGINT
   - [ ] Ctrl-C stops the loop — INFERRED, not executed: the drill never delivered a real SIGINT. Grounds: grep confirms zero `SIGINT`/`SIGTERM`/`process.on` handlers in scripts/ and src/, so a console Ctrl-C takes Node's default exit. The mark rests on handler-absence, not observation.
2. Latch drill (Phase 4, real binary + real paths in this clone):
   - [x] Latch present -> quiet no-op, exit 0, zero GETs, zero git spawns — `fetch-linkedin: HALT LATCH present — fetching is blocked until the operator deletes it`, exit 0
   - [x] Latch cleared -> the next tick resumes — after deleting `state/linkedin-halt.flag` the tick passed the band and stopped at the checkout guard (branch `ukind/feature-anti-restrict`, not main — correct for this clone), exit 1
3. Stamp gate + FR-4 abort (Phase 5, offline driver driving the real `fetchTick` with injected seams):
   - [x] A stampless cookie file fails the tick naming `harvestedAt` + the re-harvest remedy, AFTER the checkout guard and BEFORE any GET — error text matched; no budget ledger and no latch were written
   - [x] A stamped cookie + an unparsable 200 aborts the tick as leg-dead (FR-4) — `LEG DEAD — unparsable 200 body`; ledger `{"localDate":"2026-11-10","count":1}` persisted before the GET; no latch trip
4. Reset command (Phase 5, throwaway targets):
   - [x] `reset-linkedin` removes cookie + profile + latch, keeps the ledger, re-runs as a quiet no-op — 3 removed / 0 absent, then 0 removed / 3 absent, ledger kept
5. Config contract (Phase 6, real `loadWatcherConfig`, byte-exact restore verified by sha256):
   - [x] A sixth linkedin surface -> rejected naming the count: `config: watcher.config.json has 6 linkedin surfaces — exactly 5 are required...`
   - [x] Four linkedin surfaces -> rejected naming the count: `...has 4 linkedin surfaces — exactly 5 are required...`
   - [x] Swapping a value (five kept) -> accepted — 5 surfaces, swapped value present; watcher.config.json restored byte-exact
   - [x] The hosted reader still reads the payload with the cut fleet — `readPayloadPosts` on the committed payload returns leg `stale` (25 h old, PC loop currently off) and 0 posts: the documented dark-leg degrade, not a parse failure
6. Still requires the operator (live dedicated account/clone; not runnable here):
   - [ ] Probe protocol: `npm run probe-linkedin` twice, >= 6 h apart, on the dedicated account before trusting the loop; re-run after any `LINKEDIN_TRANSPORT` change
   - [ ] Controlled 429 drill on the dedicated account: trip the latch, confirm zero GETs while set, delete the flag, confirm the next tick resumes
   - [ ] PC reboot mid-day: the budget file survives; the day total stays <= 150
   - [ ] `npm run login-linkedin` writes a stamped cookie file; hand-delete `harvestedAt` -> the next `npm run fetch-linkedin` exits 1 naming the stamp; `npm run reset-linkedin` then a fresh login + fetch cycle works
   - [ ] Legacy transition: a pre-Slice-5 stampless cookie file still passes `npm run probe-linkedin` while the tick refuses it

### Recommendations:

- Ready to commit — implementation is complete and validated. Commit scope: include the 5 new `.rpiv/artifacts/` files; keep the 14 `outputs/` files out of these commits (rulings under Deviations from Plan).
- Follow-up (non-blocking, doc pass): refresh the stale cadence/payload prose in README.md:358, AGENTS.md:42, AGENTS.md:88, .rpiv/guidance/scripts/architecture.md:35, and .rpiv/guidance/src/architecture.md:126 to the 28-33 min cadence and the 40 min staleness window.
- Run the live-account drills in item 6 before relying on the loop in production; the offline evidence covers every gate, but the real 429 cycle and the reboot survival are unverified.

### Addendum (2026-11-10, post-validation)

Found AFTER this report shipped, during the operator's first live probe: `createCurlTransport`'s exec-failure catch forwarded Node's `execFile` error message verbatim — and that message embeds the ENTIRE command line, cookie + csrf-token headers included. A failed probe therefore printed the operator's live cookie jar to the console. Blast radius, bounded: PC console only (probe output, per-surface `fetch: ... FAILED` warns); never the hosted run (Actions never executes the curl leg), never git history (the cookie file lives at `C:/loker-secrets/`, outside the repo), never the alarm emails. The 570/570 suite missed it because the exec-failure test injected `new Error("connection reset")` — a shape Node never produces; the double was safe, so the assertion passed. Fixed in commit `34e91b9` (sanitized message: exit code number-or-string + stderr excerpt only; both real failure shapes now doubled and pinned). Operator action required: re-harvest the cookie jar — the leaked `li_at` transited a chat transcript. Rule recorded: test doubles must reproduce the real system's failure shape, including its leak paths.
