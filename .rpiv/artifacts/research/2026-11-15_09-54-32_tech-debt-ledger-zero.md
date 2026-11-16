---
date: 2026-11-15T09:54:32+0700
author: Yogiswara Utama
commit: be5407a
branch: ukind/feature-auto-login-threads
repository: feature-auto-login-threads
topic: "Tech-debt ledger zero"
tags: [research, codebase, tech-debt, capture-sink, facades, ci, judge, linkedin-leg, dependencies]
status: ready
last_updated: 2026-11-15T09:54:32+0700
last_updated_by: Yogiswara Utama
---

# Research: Tech-debt ledger zero

## Research Question
Close every finding in `TECH_DEBT_AUDIT.md` (16 findings, verified live at `be5407a`; F002 deferred by the developer) in one ordered pass on this branch: re-arm the capture-sink oracle through a shared helper (F001+F015), delete `captures/`, land the code/comment/doc smalls (F004-F010, F012, F014), add the two CI steps (F003, F013), and bump the dev-tool majors last (F007). Chained from the discover FRD; the scope-tracer formulated 9 trace-quality questions; 4 codebase-analyzer groups + 1 precedent-locator answered them.

## Summary
The capture leak is fully diagnosed: exactly one test case writes to disk, and the forensic chain (capturedAt = T0, minted: 3, Jakarta/Bandung/Surabaya body) proves it authored both leaked `captures/` dirs. The two run-#7 facades cover 10 real import sites; 6 of the 10 are mixed imports, so the edit is a split, not a swap, and knip stays green only when block deletion and re-pointing land atomically. The F004 constants protect the same width arithmetic from two sides; the F005 probe defect (any 2xx containing `{` counts as a good leg) is fixed by transplanting the availability pre-check's envelope gate. The FRD's literal madge criterion is unachievable as written (stock madge exits non-zero on the 9 type-only cycles); per developer decision the doc records devDependency + npm script with local verification of the exact invocation. The F005 replay test requires an entry guard plus an injectable fetch in `scripts/probe-judge.ts` (today a bare `await main()` at :349 launches the whole probe); per developer decision that refactor is approved.

## Detailed Findings

### Capture-sink leak and oracle re-arm (F001 + F015)
- The seam: `CaptureSink` at `src/linkedin-capture.ts:104`; production factory `makeFsCaptureSink` at :157-225 (root default `LINKEDIN_CAPTURES_ROOT = "captures"` at `src/config.ts:81`; 8 MB bound checked BEFORE stamp/mkdir; lazy UTC session stamp on first accepted capture; atomic write via `stateTempPath` + rename; keep-20 prune after every write). `captureOnce` (:228-250) is fire-and-forget with warn-once via `CaptureWarnState` (:109-113).
- The walk guards: `src/linkedin-walk.ts:173` and :235 skip capture when the sink is undefined; `fetchLinkedInPosts` passes `deps.captureSink` through undefined-checked (`src/linkedin-fetch.ts:250`; contract doc :157-161).
- The leak lives ONLY at the two script-level `??` defaults: `scripts/fetch-linkedin.ts:438` and `scripts/probe-linkedin.ts:183` resolve `captureSink: deps.captureSink ?? makeFsCaptureSink()`.
- The one leaking case: `tests/fetch-linkedin.test.ts:1036` (seen-stop through the tick; describe at :1024). It fires a 3-card capture-shaped body with no sink; the defaulted fs sink writes one file per run. Physical evidence: `captures/20261115T021815Z/001-hiring-react.json` and `captures/20261115T022011Z/001-hiring-react.json`, both with `capturedAt: "2026-10-26T09:14:00.000Z"` (= T0, the block's pinned clock, defined :41) — two separate npm test runs, each leaking once.
- Injection census: 18 `fetchTick` blocks, 5 inject today (:422, :546, :577, :601, :886); 7 `runProbe` blocks, 2 inject (`tests/probe-linkedin.test.ts:275`, :308). The direct-walk suite (`tests/linkedin-fetch.test.ts`) is safe by contract, not luck — the undefined passthrough plus the walk guards.
- The three oracles are hand-rolled and disarmed: module-load `repoCapturesBefore` snapshots at `tests/fetch-linkedin.test.ts:63-76`, `tests/probe-linkedin.test.ts:54-67`, `tests/linkedin-fetch.test.ts:1318-1328`. Once `captures/` exists, the guard skips forever — that is why repeat runs went green.
- The fix: export `NOOP_CAPTURE_SINK` from `src/linkedin-capture.ts` (new); shared `tests/capture-oracle.ts` helper owning snapshot + assert-absent + leaked-dir report (names the leaked session dirs and their files); inject the explicit sink into all 18 fetchTick and all 7 runProbe blocks; delete `captures/` AFTER injection lands; verify with two clean-checkout npm test runs.
- Timing wrinkle closed by the same fix: the void'd sink promise races teardown (the flush pattern at `tests/linkedin-fetch.test.ts:1300` documents the class); a synchronous injected sink removes the race rather than narrowing it.

### Facade removal (F006) + SleepFn dedupe (F014)
- Judge facade: comment :25-34 with REMOVAL NOTE at `src/judge.ts:31-34`; `export { buildBulkMessages } from "./judge-prompts.js"` at :35 (definition `src/judge-prompts.ts:63`); `export { judgePost }` at :36 (binding of the :17 import; definition `src/judge-dispatch.ts:397`). Real importers to re-point: `tests/judge.test.ts:8-15` (block: facade symbols :10-11; real exports :9, :12-14 stay), `tests/judge-rotation.test.ts:22` (one mixed line), `scripts/probe-judge.ts:46` (one mixed line).
- Do NOT move the five type-only `LlmAccount` importers (`tests/index.test.ts:35`, `tests/judge-availability.test.ts:4`, `tests/judge-ceilings.test.ts:12`, `tests/judge-health.test.ts:24`, `tests/judge-helpers.ts:8`): the type is declared in judge.ts itself (:70-74), and the back-edge comment at `src/judge-dispatch.ts:49-52` pins it there (moving it would create leaf-to-funnel back-edges).
- linkedin-fetch facade: comment :46-58 (REMOVAL NOTE :53; knip contract :54-58 — the block must not grow); export block :59-67 (7 symbols owned by `src/linkedin-context.ts`: legDead :32, isLegDead :39, allSurfacesFaulted :55, isAllSurfacesFaulted :64, halt :86, isHalt :93, LinkedInContextFactory :117); `export { SCROLL_JS } from "./linkedin-walk-static.js"` at :68 (owner :95).
- Seven real importers (the comment over-counts eight): `scripts/fetch-linkedin.ts:40-49`, `scripts/probe-linkedin.ts:37-45`, `scripts/watch-linkedin.ts:20`, `tests/linkedin-fetch.test.ts:31-45`, `tests/fetch-linkedin.test.ts:35` (the only SCROLL_JS consumer through the facade), `tests/probe-linkedin.test.ts:31-35`, `tests/watch-linkedin.test.ts:16`. The phantom eighth: `src/index.ts:52` imports `LinkedinSurface` — a local export at `src/linkedin-fetch.ts:70`, outside the block; it stays.
- 6 of the 10 real sites are MIXED imports (facade symbol + permanent symbol on one specifier): each edit is a split, not a swap. Survivors that keep the linkedin-fetch specifier: `LinkedinSurface` :70, `PACE_MIN_MS` :79, `PACE_MAX_MS` :86, `LINKEDIN_PROFILE_DIR` :97, `resolveLinkedInProfileDir` :99-114 (consumed by `scripts/login-linkedin.ts:29` and `scripts/reset-linkedin.ts:28`).
- F014: the duplicate `SleepFn` sits at `src/linkedin-fetch.ts:72-73`; canonical at `src/sleep.ts:17`. Fix: replace the local declaration with `export type { SleepFn } from "./sleep.js"` — outside the facade block, so it survives F006. `scripts/watch-linkedin.ts:20` is the re-export's only external consumer: it SPLITS — `isLegDead` re-points to `linkedin-context.js`, `type SleepFn` stays on `linkedin-fetch.js`. Re-pointing SleepFn to sleep.js would orphan the re-export and redden knip (:36), violating the acceptance criterion.
- Gate mechanics: re-point without deleting the block makes the exports zero-importer (knip report fires, ci.yml:36 red); delete without re-pointing fails typecheck first (TS2305 at ci.yml:27). `grep -rn "run #7" src/` has exactly two hits today (judge.ts:31, linkedin-fetch.ts:53) and goes empty after both deletions.

### Paired cap constants (F004)
- `HEALTH_CAP_STREAK = 2`, unexported at `src/judge-rotation.ts:66`; consumed by the pick predicate (:210) and probe registration (:263). The zero-import boundary is deliberate: type-only idiom :38-44, boundary doc :60-65.
- Twin `HARD_FAIL_TICKS_TO_CAP = 2`, exported at `src/judge-health.ts:47`; four consumers: `src/judge-shared.ts:59` (all-blocked predicate), :157 (exhaustion record), `src/judge.ts:226-227` (pool-width sum inside judgePosts, verified function at :182), `src/judge-health.ts:285` (degraded-accounts line).
- Only existing pin is one-sided: `tests/judge-rotation.test.ts:909` (streak 1 neither caps nor registers). A one-sided edit of either constant compiles green and splits semantics silently.
- Fix: one-keyword change (`const` to `export const` at judge-rotation.ts:66) + three-line equality test in `tests/judge-health.test.ts` (infrastructure present: named import list closes :23, LlmAccount type import :24; add the HEALTH_CAP_STREAK import and one assert.equal case). Runtime-only over primitives — safe from the TS 7 bump.

### Probe leg classification (F005)
- Defect: `scripts/probe-judge.ts:122` — `const ok = body.includes("{")` — so any 2xx containing a brace (error envelope, HTML interstitial) is `kind: "ok"`. `timed()` :104-133; `ProbeOutcome` :82-86; ramp tallies :138-157; ceiling walk :172-192 (failed > 0 returns 0; a refused level returns level/2; only a fully clean ramp reads RAMP_MAX 32). With error envelopes reading ok, the ramp climbs to 32 and `writeCeilingsAtomic` commits the junk ceiling (:299, :318, :321) — live-only, before the dead gate (:309-316) — and the watch job spreads on it for the 8h freshness window.
- Production shape to mirror: the as-cast envelope read at `src/judge-dispatch.ts:209-213` (non-string content defers/retries at :349/:439) and, tightest, the availability pre-check `src/judge-availability.ts:138-146` (require `typeof choices?.[0]?.message?.content === "string"`). The fix is that gate transplanted into the probe.
- Test seam (developer-approved): entry-guard the CLI — today a bare `await main()` at :349 runs on import; apply the repo idiom (argv/pathToFileURL guard, as in the entry-guarded PC scripts per guidance) and export `timed` with an injectable fetch defaulting to global fetch. Replay tests: 2xx error envelope fails the leg; 2xx HTML fails the leg; rampLevel tallies drive findConcurrencyCeiling to 0; a committed 0 floors at 1 with one warning (`src/judge-ceilings.ts` usableCeiling :38-44; the writer lives in src precisely for this testability, :16-18).
- Gate honesty after the fix: the probe step reddens watch.yml; Commit ceilings is skipped (no always() on it); the dispatch's watch job is suppressed (watch.yml:121); the next dispatch re-probes on the stale probedAt. Genuine 429s still route through the untouched refused bucket as data.

### Measured-evidence comment + PC-path docs (F008 + F009)
- Stale narration at `src/judge-dispatch.ts:56-61` above `const REQUEST_TIMEOUT_MS = 60_000` (:62) still says "Phase 0 measures the real latency ... and confirms this value". The evidence exists twice: probe header `scripts/probe-judge.ts:4-5` and the FALLBACK_CALL_BUDGET doc `src/judge.ts:41-45` (same run, 6.5-minute cascade). Rewrite form: "60_000 — runner-measured (run 40264368939: 15s timed out every batch)", matching the neighboring measured-evidence idiom (WAIT_BUDGET_MS doc, judge.ts:52-66).
- F009: README's PC-leg section (`README.md:280-370`) never states either default nor `LINKEDIN_PROFILE_DIR`. It gains both defaults (cookie file `scripts/login-linkedin.ts:33`; profile dir `src/linkedin-fetch.ts:97`) and both overrides (`LINKEDIN_COOKIES_FILE` `src/config.ts:16`, fail-visible resolver `src/linkedin-session.ts:97-146`; `LINKEDIN_PROFILE_DIR` `src/config.ts:24`, PC-only, never mapped in watch.yml, one resolution point `src/linkedin-fetch.ts:99-114`). Code comments then shrink to invariants only, per the established relocation law (judge.ts:59-61, watch.yml:152-153).

### Format coverage + gate hygiene (F012 + F010)
- `lint` (`package.json:13`) covers 11 targets; `format` (:15) covers 9. The delta: `scripts/probe-judge.ts` (linted, never formatted), `scripts/hooks` (two .js files, linted as a directory, never formatted), `watcher.config.json` (in NEITHER list; 3-space indent against the configured 2-space, `biome.json:17-20` — the repo's only style violation). Fix: append all three to the format value. `biome.json` needs no change: it has no include list, only files.ignore (:3-11), and both scripts pass explicit paths. Note the deliberate asymmetry: watcher.config.json joins format but not lint, so CI never checks it.
- F010: the freshness gate step is `.github/workflows/watch.yml:60-80`; the interpolation sits at :69 (`if [ "$`{{ inputs.force }}" = "true" ]`). Safe today only because the input is a typed boolean (declared :6-11, type :10). Fix: step-level `env: FORCE: $`{{ inputs.force }}` and `if [ "$FORCE" = "true" ]`; update the comment at :47. Behavior-neutral: for the only two renderable values the branch fires identically.
- Neither fix can change hosted behavior: no workflow invokes `format` (workflows call typecheck/lint/knip only — ci.yml:27, :30, :36), and JSON.parse is whitespace-blind, so the 3-to-2-space rewrite of watcher.config.json is invisible to loadWatcherConfig. The guidance doc's embedded gate copy (.rpiv/guidance/.github/workflows/architecture.md:160) is also stale — docs-only.

### CI additions (F003 + F013)
- The check job spans `.github/workflows/ci.yml:13-36`: checkout :17, setup-node :19-22, npm ci :24, Typecheck :26-27, Lint :29-30, Test :32-33, knip :35-36. Both additions slot after :36 per the audit's guidance.
- The frozen invariant: 9 cycles today, all closing through type-only imports erased by `verbatimModuleSyntax` (`tsconfig.json:11`): `src/judge-dispatch.ts:49-53` (back-edge to judge.js), `src/linkedin-walk.ts:23-27` (LinkedinSurface), `src/judge-rotation.ts:37-44` (four type-only imports).
- Developer decision (checkpoint): madge lands as a devDependency + npm run script, mirroring the knip precedent (commit f50067d: "the lockfile is the pin; the CI step runs npm run knip, never npx knip") — NOT the FRD's literal npx step. The exact invocation that exits 0 on the type-only graph must be verified locally BEFORE the YAML merges; the acceptance criterion is amended to "the committed npm script exits 0".
- Lockfile ordering: the madge commit adds the devDependency and regenerates package-lock.json BEFORE the majors PR (npm ci at ci.yml:24 hard-fails on drift; the npm cache key :22 rides the lock hash). Landing the gate before the bump is the point: the majors PR is itself policed by the frozen runtime graph.
- F013: non-blocking `npm audit --omit=dev` with `continue-on-error: true`, after madge. Today: 0 vulnerabilities, the step is inert. On a future advisory: the step's outcome records failure, conclusion stays success, the job stays green, an annotation appears; nothing downstream consumes the outcome. Human review of the full audit (including the dev tree the flag omits) rides the F007 bump per the FRD decision.

### Dev-tool majors (F007, deliberately last)
- Block: dependencies `package.json:30-33` (nodemailer ^10.3.0 :31, playwright ^1.49.1 :32); devDependencies :34-42. Lockfile-resolved today: TypeScript 5.9.3, biome 1.9.4, knip 5.88.1, lint-staged 15.5.2, @types/node 22.20.5. Targets: TS 7.0, biome 2.6.7, knip 6.45.1, lint-staged 17.6.0, @types/node 26.6.6; minors playwright 1.64.1 to 1.65.1, nodemailer 10.3.1 to 10.5.0.
- The hook chain must survive lint-staged 17: `prepare` :23 (husky), one-line `.husky/pre-commit` (npx lint-staged), config at package.json:25-29 (`*.ts` to the biome check command array). Verify with a staged commit on the bumped tree.
- `biome.json` is a 1.x-format file (schema pin :2, files.ignore :3-11); the 2.x migration (schema, ignore-to-includes) is inside the "an afternoon" churn budget.
- knip 6 over the pass's two new exports: `HEALTH_CAP_STREAK` (used in-src and by the equality test) and `NOOP_CAPTURE_SINK` (used by the oracle helper and 25 injection sites) — both stay clean. TS 7 under the strict quartet (tsconfig.json:8-11) re-verifies the re-pointed imports; @types/node 26 against the Node 22 runtime is an accepted types-vs-runtime skew.
- Local verification order: typecheck, lint (the rule-churn biller), test (733 tests), knip, the new madge script, audit. Hosted side effect: the watch job's ms-playwright cache keys on the lockfile (watch.yml:179), so the rewritten lock costs one cache miss and one 30-60s browser reinstall; the install step stays unconditional by design.

## Code References
- `src/linkedin-capture.ts:104` — CaptureSink type; :109-113 CaptureWarnState; :118-123 sessionStamp; :129-140 surfaceSlug; :157-225 makeFsCaptureSink; :228-250 captureOnce
- `src/config.ts:81` — LINKEDIN_CAPTURES_ROOT = "captures"; :14-29 ENV_NAMES closed key set
- `src/linkedin-fetch.ts:46-68` — linkedin facade (comment :46-58, exports :59-67, SCROLL_JS :68); :70 LinkedinSurface; :72-73 SleepFn duplicate; :79/:86 pace constants; :97 LINKEDIN_PROFILE_DIR; :99-114 resolveLinkedInProfileDir; :250 undefined passthrough
- `src/judge.ts:25-36` — judge facade (REMOVAL NOTE :31-34, exports :35-36); :17 judge-dispatch import; :41-45 run-40264368939 cascade doc; :70-74 LlmAccount; :182 judgePosts; :222-229 pool-width sum
- `src/judge-rotation.ts:37-44` — type-only cycle idiom; :60-65 boundary doc; :66 HEALTH_CAP_STREAK; :210/:263 consumers
- `src/judge-health.ts:47` — HARD_FAIL_TICKS_TO_CAP; :285 degraded line
- `src/judge-shared.ts:59,157` — all-blocked predicate; exhaustion record
- `src/judge-dispatch.ts:49-53` — type-only back-edge + LlmAccount pin; :56-62 stale REQUEST_TIMEOUT_MS block
- `src/judge-availability.ts:138-146` — the envelope gate the F005 fix transplants
- `src/sleep.ts:17` — canonical SleepFn (module rationale :1-9)
- `scripts/probe-judge.ts:4-5` — probe header evidence; :82-86 ProbeOutcome; :104-133 timed(); :122 the brace check; :138-157 rampLevel; :172-192 findConcurrencyCeiling; :299/:318/:321 ceilings write + probedAt; :329-334 exit 1; :349 bare await main()
- `scripts/fetch-linkedin.ts:438` / `scripts/probe-linkedin.ts:183` — the two ?? makeFsCaptureSink() defaults
- `scripts/login-linkedin.ts:33` — DEFAULT_COOKIE_PATH; :29 resolveLinkedInProfileDir import
- `tests/fetch-linkedin.test.ts:41` — T0; :63-76 disarmed oracle; :1036 the leaking seen-stop case; :271-277 recordingSink
- `tests/probe-linkedin.test.ts:54-67` — disarmed oracle; :275/:308 the two sink-injecting blocks
- `tests/linkedin-fetch.test.ts:1318-1328` — disarmed oracle; :1300 flush pattern
- `tests/judge-rotation.test.ts:22,909` — mixed facade import; one-sided cap pin
- `tests/judge.test.ts:8-15` — mixed facade import block
- `package.json:13,15,23,25-29,30-42` — lint/format lists; prepare; lint-staged config; deps block
- `.github/workflows/ci.yml:13-36` — check job; :24 npm ci; :26-36 the four gates; additions slot after :36
- `.github/workflows/watch.yml:6-11,47,60-80,69,121,179` — typed input; stale comment; gate step; the interpolation; watch-job if; playwright cache key
- `biome.json:2-20` — schema pin, files.ignore, formatter settings
- `tsconfig.json:8-11` — strict quartet incl. verbatimModuleSyntax
- `README.md:280-370` — PC-leg section F009 extends
- `src/linkedin-context.ts:32-117` — canonical owners of the facade's seven symbols
- `src/linkedin-walk-static.ts:95` — SCROLL_JS owner
- `src/linkedin-walk.ts:23-27,92-93,173,235` — type-only edge; sink-less contract; the two guarded capture arms
- `src/judge-ceilings.ts:16-18,38-44,68,81-86` — writer-in-src rationale; usableCeiling; probedAt skip; floor-at-1

## Integration Points

### Inbound References
- 10 facade import sites (3 judge-side, 7 linkedin-side) — enumerated above; each a re-point or a split
- 5 type-only `LlmAccount` importers + `src/index.ts:52` (LinkedinSurface) + login/reset resolver importers — verified NON-movers
- `scripts/watch-linkedin.ts:20` — the F014 re-export's only external consumer; pins the split decision
- watch.yml probe job consumes probe-judge's exit contract; the watch job consumes committed ceilings through `src/judge-ceilings.ts`

### Outbound Dependencies
- probe-judge imports buildBulkMessages, resolveJudgeConfig, LlmAccount from ../src/judge.js (the facade it helps unmask), loadWatcherConfig, and the src-side ceilings writer — the writer-in-src split is what makes the F005 ceiling assertions testable
- the capture sink rides `stateTempPath` (src/state.ts) — the shared atomic-write idiom; the new NOOP_CAPTURE_SINK joins the same module's export surface
- the freshness clock: probe stamps probedAt; watch.yml gate reads it; resolveCeilings skips the key — three sites that must drift together (they do not change in this pass)

### Infrastructure Wiring
- ci.yml check job gains two steps after :36 (madge via npm script first, audit second, both after knip)
- watch.yml gate step gains step-level env FORCE; no other watch.yml change
- package.json gains a cycles script + madge devDependency (pre-bump commit), the extended format list, the majors block (bump commit)
- husky/lint-staged chain untouched, verified by a staged commit after the bump

## Architecture Insights
- knip is negative space: the N012 debt class ("export with no cross-module importer") is invisible to all four gates while every facade symbol keeps an importer; deletion must be atomic with re-pointing or ci.yml catches the leftovers. The same gate then FORCES the F014 binding choice (the re-export must keep its consumer).
- Injectable-seam guarantees fail at the defaulting seam: the harness's "npm test never writes" claim broke at the two script-level `??` defaults within two days of landing. Production defaulting belongs at script entries; library seams pass undefined through.
- Mixed imports split, they do not swap: 6 of 10 facade sites bind facade and permanent symbols on one line; the plan should size F006 as 10 edits, not 10 sed replacements.
- One width computation, two integrity guards: judge.ts:222-229 sums probe-committed ceilings (F005's output) while applying the F004 cap — the two debt items police the two inputs of the same arithmetic.
- Documentation law: code carries invariants + measured-evidence pointers; README carries operator procedure. F008 and F009 both land under it, and the relocation precedent (judge.ts:59-61) shows the form.
- Writer-in-src testability: the ceilings and health writers live in src so scripts stay thin and the write paths unit-test; F005's ceiling-not-raised assertion extends coverage that already exists there.
- Zero-import boundaries are structural, not stylistic: judge-rotation's paired constant and structural slice, sleep.ts's own-module rationale, judge-dispatch's LlmAccount pin — the pass must not "simplify" any of them away.
- Gate-tool precedent: pinned devDependency + npm script + regenerated lockfile, never npx (knip f50067d; now madge by developer decision).

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: Capture/replay harness introduced the sink whose ?? default is now F001
**Commit(s)**: `14ccec5` — "linkedin: add capture/replay harness for raw bodies" (2026-11-13); sink bound `aa852b5` (2026-11-14)
**Blast radius**: 13 files across 4 layers — src/linkedin-capture.ts (new), src/config.ts, src/linkedin-fetch.ts, two PC scripts, 5 test files, package.json, .gitignore
**Follow-up fixes**: `aa852b5` (8 MB bound one day later); `6d44b70` (retention figure correction); F001 itself — the harness commit's "npm test never writes into the repo" claim was false; the plan scoped the guarantee to the walk seam only
**Lessons from docs**: .rpiv/artifacts/plans/2026-11-13_15-27-41_linkedin-capture-replay-harness.md:108 — the guarantee's scope; the FRD's probe — captures/ already existed with 2 leaked files, oracle disarmed
**Takeaway**: verify seam guarantees empirically (two clean-checkout runs), never by assertion.

### Precedent: Tech-debt run6 (the closest structural precedent for a ledger-zero pass)
**Commit(s)**: `cd2297f` through `f50067d` phases 1-6, `a49210b`, `15bd1ba`, `0badab4` (all 2026-11-14)
**Blast radius**: ~30 files; judge.ts -773 lines, linkedin-fetch.ts -788; created judge-dispatch/prompts/walk/context + both facades; phase 6 touched ci.yml, package.json, lockfile
**Follow-up fixes**: `15bd1ba` (N060 estimate unverified, ~150 claimed vs 116 actual); `0badab4` (N060 god-file cuts executed because run6's criterion under-covered)
**Lessons from docs**: .rpiv/artifacts/validation/2026-11-14_08-15-48_tech-debt-run6-remediation.md — splits regrow the debt class elsewhere (N042 to N060); facades block git diff -M rename pairing; run6 DEFERRED N057/N058/facade re-pointing to run #7 — this pass is run #7. plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md:126 — verbatim moves and logic edits must never be conflated (F006 re-pointing stays separate from F005 logic); phase 6 — the knip gate pinned as devDependency + npm script, "never npx knip"
**Takeaway**: phase like run6 (sinks, smalls, CI, majors last), re-measure every count before trusting it (facade importers: comment said 8, reality 7), write acceptance criteria as mechanically checkable greps.

### Precedent: watch.yml commit-back — 6 fix rounds in 8 days
**Commit(s)**: `510ff2a` (2026-10-30) through `bc760cb` (2026-10-31), `b779ff7` (2026-11-01, extraction to script), `da2997f` (2026-11-07, run 885 dispatch race)
**Blast radius**: workflow YAML + scripts; the durable fix moved inline bash into scripts/commit-state-rebase.sh with spawnSync tests
**Follow-up fixes**: the six commits above ARE the follow-ups
**Lessons from docs**: .rpiv/artifacts/plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md:4109 — expect a same-day fix window per precedent
**Takeaway**: F003/F010/F013 are additive and low-risk vs. the commit-back cluster, but budget a same-day fix window for any workflow change; prefer one minimal pinned step over clever inline shell.

### Precedent: Probe/judge behavior changes — offline-green, live-wrong
**Commit(s)**: `73d6786` (2026-10-26, probe latency), `7cc7250` (2026-10-27, "8-wide bursts trip the endpoint's limiter"), `98c9c1f`/`d284d2e` (2026-11-07, deep ramp), `ddbb26d` (2026-11-08, probedAt + 8h gate)
**Blast radius**: scripts/probe-judge.ts, judge-dispatch, watch.yml, state/judge-ceilings.json
**Follow-up fixes**: `7cc7250` — one day after the rotation probe landed
**Lessons from docs**: .rpiv/artifacts/plans/2026-11-08_18-04-00_account-availability-check.md:2049 — "every prior rotation/health change passed offline and was corrected by a live run"
**Takeaway**: ship F005 with the replay test AND expect the next live dispatch to be the real validator; ceiling changes in the next state commit are expected, not a regression.

### Precedent: Tooling bumps and hooks — same-day format/hook fixes
**Commit(s)**: `20478d1` (2026-10-25, biome add + mass reformat), `399181b` (2026-10-26, "Fix formatting issue in watcher.config.json"), `7776a30` + `636a4be` (2026-10-31, nodemailer 10 + lint hooks, then the hostile-path hook fix)
**Blast radius**: repo-wide reformat; hooks; package.json
**Follow-up fixes**: the two same-day fixes above; `399181b` is literally F012's file drifting one day after biome landed
**Takeaway**: F007 lands last per the FRD ordering; expect lint/format churn plus a same-day follow-up; F012 is the guard that stops the 399181b class from recurring.

### Composite Lessons
- "Tests never write" claims have failed at defaulting seams before (14ccec5); fix order is sinks first, delete captures/ second, verify with two clean-checkout runs.
- Cleanup passes regrow the debt class elsewhere and estimates drift unverified (N042 to N060; 150 vs 116) — re-measure every LOC/importer count before landing.
- Workflow changes historically needed 5-6 same-day fix rounds; the durable pattern is a devDependency-pinned gate via an npm script and a tested script over inline YAML.
- Probe/judge changes always passed offline and were corrected live — the replay test is necessary, not sufficient.
- Deferred carry items come due silently: run6's deferrals are this pass's F006/F014; sweep the carry ledger and keep verbatim re-pointing separate from logic edits (f14d9f9 to 2338274 lesson).
- Layering constrains F014: sleep.ts exists (0badab4) so fetch-side code never reaches into judge-named modules — canonical SleepFn stays in sleep.ts, linkedin-fetch re-exports, never the reverse.

## Historical Context (from .rpiv/artifacts/)
- .rpiv/artifacts/discover/2026-11-15_09-31-23_tech-debt-zero.md — the FRD this research chains from (16 findings, decisions, acceptance criteria)
- .rpiv/artifacts/plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md — run6 plan (D3/D8 facade origin; phase-6 knip pin)
- .rpiv/artifacts/research/2026-11-13_18-51-06_tech-debt-run6-remediation.md — run6 research (facade import-site census)
- .rpiv/artifacts/validation/2026-11-14_08-15-48_tech-debt-run6-remediation.md — run6 validation (N060 lesson; deferred carry list)
- .rpiv/artifacts/plans/2026-11-13_15-27-41_linkedin-capture-replay-harness.md — capture harness plan (the sink guarantee's original scope)
- .rpiv/artifacts/plans/2026-11-08_18-04-00_account-availability-check.md — availability pre-check plan (offline-green lesson)
- .rpiv/artifacts/plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md — first audit remediation (same-day fix window)
- .rpiv/guidance/src/architecture.md, .rpiv/guidance/tests/architecture.md, .rpiv/guidance/.github/workflows/architecture.md, .rpiv/guidance/scripts/architecture.md — the four doctrine layers this pass edits against

## Developer Context
**Q (discover: Scope — all 16 findings in this pass): F007 bumps dev-tool majors (TypeScript 5.9 to 7.0, biome 1 to 2, knip 5 to 6, lint-staged 15 to 17) — the only finding that can churn lint/format repo-wide. Include it in this pass?**
A: Include all 16.

**Q (discover: F001 — inject no-op sink everywhere): 13 of 18 fetchTick tests omit captureSink, so the tick re-creates the real fs sink and writes captures/ into the repo; the absence-oracle is currently disarmed by the 2 leaked files. Which fix?**
A: Inject no-op sink everywhere.

**Q (discover: F003 — freeze the no-cycle property in CI): The "no runtime import cycles" property is enforced by comments only; madge reports 9 cycles, all verified type-only. Freeze the property in CI?**
A: Add the CI step, madge as devDependency.

**Q (discover: F004 — export the constant, assert equality): HEALTH_CAP_STREAK (src/judge-rotation.ts:66) and HARD_FAIL_TICKS_TO_CAP (src/judge-health.ts:47) must stay equal, enforced by comments only; the equality test needs one added export keyword. OK to export it?**
A: Export it, assert equality.

**Q (discover: F005 — parse the production envelope shape): The probe counts any 2xx body containing a { as a good leg, so error envelopes or HTML interstitials inflate committed ceilings for 8 hours. Which fix?**
A: Require choices[0].message.content to be a string.

**Q (discover: F006 — remove both facades now): Two re-export facades tagged 'run #7' (src/judge.ts:31-36, src/linkedin-fetch.ts:46-58); the probe counts 10 real import sites (the comment over-counts 8 — src/index.ts imports only a local type). Remove now?**
A: Remove both now, re-point 10 sites.

**Q (discover: F007 — dev majors in the same pass): (folded into scope) TypeScript 7 / biome 2 / knip 6 / lint-staged 17 / @types/node 26, with playwright + nodemailer minors.**
A: Include, minors in the same PR.

**Q (discover: F008 — rewrite the stale comment as measured evidence): src/judge-dispatch.ts:56-62 still narrates '15s was never validated' above a value that has been 60s since the measurement shipped. Which fix?**
A: Rewrite citing run 40264368939.

**Q (discover: F009 — document the PC paths in README): Two PC-only files are hardcoded as C:/loker-secrets/... in code; the README does not mention either path or the LINKEDIN_PROFILE_DIR override. What should happen?**
A: Document in README.

**Q (discover: F010 — env-indirect the freshness gate input): watch.yml:69 interpolates inputs.force directly into the gate bash — safe today (typed boolean), but it is the pattern the repo's own doctrine warns about. Which fix?**
A: Route through step env, read $FORCE in bash.

**Q (discover: F011 — prune the stale worktree (scope-derived)): Pre-resolved from codebase evidence — the audit's fix is one operator command.**
A: Prune, no schedule.

**Q (discover: F012 — extend the format list): The format script covers src, tests, and listed scripts — but not watcher.config.json, not scripts/hooks, and per the probe not scripts/probe-judge.ts. Extend it?**
A: Extend to all three.

**Q (discover: F013 — non-blocking audit step in CI): CI checks typecheck, lint, tests, knip — but npm audit runs only when someone remembers it (currently 0 vulnerabilities). Add it to CI?**
A: Add npm audit --omit=dev non-blocking.

**Q (discover: F014 — single SleepFn declaration (scope-derived)): Pre-resolved from codebase evidence — the audit's fix is a re-export, no alternative worth a question.**
A: Canonical in src/sleep.ts, re-exported by linkedin-fetch.

**Q (discover: F015 — shared capture-oracle helper): The captures absence-oracle is hand-rolled three times; F001's fix must touch all three anyway. Land it through one shared helper?**
A: tests/capture-oracle.ts; F001 lands through it.

**Q (discover: F016 — leave the git-dependent skip as-is (scope-derived)): Pre-resolved from codebase evidence — the audit itself recommends leaving it.**
A: Leave as-is, recorded.

**Q (src/linkedin-walk.ts:23-27 / src/judge-dispatch.ts:53 / src/judge-rotation.ts:42): stock madge exits non-zero on any cycle and src has 9, all through type-only imports — the FRD's literal "npx madge --circular exits 0" criterion cannot hold as written, and npx also fights the repo's own gate-tool precedent (knip f50067d: devDependency + npm script, never npx). Which shape?**
A: madge lands as a devDependency + npm run script; the exact invocation that exits 0 on the type-only graph is verified locally before the YAML merges; the acceptance criterion is amended to "the committed npm script exits 0".

**Q (scripts/probe-judge.ts:349): the F005 replay test needs the script importable, but a bare await main() launches the whole probe on import — a refactor the FRD never scoped. How does the test get its seam?**
A: Entry-guard the CLI (argv/pathToFileURL idiom, as the entry-guarded PC scripts use) and export timed() with an injectable fetch defaulting to global fetch; the replay test imports it directly.

## Related Research
- .rpiv/artifacts/research/2026-11-13_18-51-06_tech-debt-run6-remediation.md — the run6 research whose facade census this pass corrects (8 claimed, 7 real)

## Open Questions
- **F002 — where do the leg-dead failure steps live?** The alarm email (src/email.ts:316) cites DOCUMENTATION.md sections 13/14; no such file exists in the repo and the spec of record is a private H:/fork/linkedin-reverse path (src/linkedin-session.ts:24). The developer deferred ("skip") when asked to choose between committing docs/failure-matrix.md (~1 h) and inlining the steps into the alarm (~15 min). The email keeps pointing at a missing file until resolved.
- Is CI green on the latest PR to main? The F001 leak fires on fresh checkouts; if a body-firing fetchTick case runs on Linux, the Test step should already be red.
- Is C:/loker-secrets the permanent operator standard? F009 chose documentation over a portable default, which implies yes for now.
- Should the 8h freshness window ever become per-account? Out of scope; gate (watch.yml) and probe writer must drift together under the current doctrine.
- Which exact madge invocation exits 0 on the type-only graph (tool behavior unverified — a TS-parser flag, an exclude pattern, or a different detector may be needed)? Resolved by local verification before the YAML lands, per the developer decision.
- Do TS 7 / biome 2 / knip 6 / lint-staged 17 upgrade mechanically without semantic rewrites? The FRD's assumption; verified only by running the gates on the bumped tree.
- Does the next live dispatch confirm F005? Per precedent, probe changes pass offline and are corrected live; ceiling changes in the next state commit are expected, not a regression.
