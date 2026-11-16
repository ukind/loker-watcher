---
template_version: 1
date: 2026-11-16T12:09:27+0700
author: Yogiswara Utama
commit: be5407a
branch: ukind/feature-auto-login-threads
repository: feature-auto-login-threads
topic: "Validation of Tech-debt ledger zero — landing (run #7)"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-16_09-38-05_tech-debt-ledger-zero-landing.md"
tags: [validation, plan, tech-debt, capture-sink, facades, ci, judge, linkedin-leg, tooling-majors]
last_updated: 2026-11-16T12:09:27+0700
---

## Validation Report: Tech-debt ledger zero — landing (run #7)

### Implementation Status

- ✓ Phase 1: capture sinks + shared oracle — Fully implemented
- ✓ Phase 2: smalls + probe fix + facades — Fully implemented
- ✓ Phase 3: CI additions — Fully implemented
- ✓ Phase 4: majors last + ledger zero — Fully implemented (with the two user-approved deviations the plan itself records)

### Automated Verification Results

- ✓ Typecheck: `npm run typecheck` — exit 0, no errors
- ✓ Lint: `npm run lint` — 81 files checked, no fixes applied
- ✓ Tests: `npm test` — 156 suites, 656 tests / 656 pass / 0 fail
- ✓ Knip: `npm run knip` — exit 0
- ✓ Cycles: `npm run cycles` — 34 files processed, no circular dependency
- ✓ Audit: `npm audit --omit=dev` — found 0 vulnerabilities
- ✓ Lockfile: `npm ci` — exit 0 (husky prepare hook fired)
- ✓ Phase 1 census: `grep -c "captureSink:"` — 18 in tests/fetch-linkedin.test.ts, 7 in tests/probe-linkedin.test.ts
- ✓ Phase 1 seams: no `?? makeFsCaptureSink` in scripts/; each of the four script entries carries >= 1 non-import `makeFsCaptureSink()`
- ✓ Phase 1 oracle: no `repoCapturesBefore` left in any tests/*.test.ts
- ✓ Phase 2 facades: `grep -rn "run #7" src/` empty; `re-export facade` empty; `SCROLL_JS` gone from src/linkedin-fetch.ts
- ✓ Phase 2 F014: `export type { SleepFn };` — exactly 1 hit (src/linkedin-fetch.ts:55)
- ✓ Phase 2 F004: `export const HEALTH_CAP_STREAK` at src/judge-rotation.ts:68; equality test at tests/judge-health.test.ts:516-517
- ✓ Phase 2 F005: `includes("{")` count in scripts/probe-judge.ts is 0; `linkedin-fetch.js` gone from tests/watch-linkedin.test.ts
- ✓ Phase 3: `continue-on-error` count 1 in ci.yml; exactly one `${{ inputs.force }}` (watch.yml:67, the env mapping) with the gate body reading `$FORCE` (:75); no `npx madge` anywhere
- ✓ Phase 3 asymmetry: `watcher.config.json` count 1 in package.json (format only); `scripts/hooks` count 2 (both lists)
- ✓ Phase 4 majors: 4 of the 5 grep hits present (typescript stays ^5.9.3 — the plan's recorded user-approved deviation); minors both landed (nodemailer ^10.5.0, playwright ^1.65.1); madge ^8.0.0 keeps its alphabetical slot
- ✓ Phase 4 biome: `schemas/2.6.8/schema.json` count 1 (the plan's recorded deviation — CLI 2.6.8 rejects the 2.6.7 label); `"ignore"` count 0; `"organizeImports"` count 1
- ✓ Phase 4 ledger: `PENDING` count 0; 16 findings marked RESOLVED/DEFERRED/AS-IS/OPERATOR
- ✓ No regressions detected — base be5407a measured: 646 tests / 646 pass / 0 fail; delta -> 656 / 656 / 0 fail (+10 tests, all new: the F005 replay suite's 9 cases and the F004 equality test)

### Code Review Findings

#### Matches Plan:

- src/linkedin-capture.ts — `NOOP_CAPTURE_SINK` exported directly after the `CaptureSink` type, with the F001 doctrine comment
- tests/capture-oracle.ts — new shared oracle: module-load snapshot + `assertNoFreshCaptures()` naming every leaked session dir and its files
- tests/fetch-linkedin.test.ts / tests/probe-linkedin.test.ts / tests/linkedin-fetch.test.ts — the three hand-rolled oracles deleted and re-pointed at the shared helper; 18 + 7 sink injections
- scripts/fetch-linkedin.ts, scripts/probe-linkedin.ts — the `?? makeFsCaptureSink()` defaults replaced with exactOptionalPropertyTypes-safe conditional spreads; both CLI entries pass the fs sink explicitly
- scripts/watch-linkedin.ts, scripts/linkedin-chain.ts — the remaining two of six production seams pass the fs sink explicitly
- src/judge.ts — the N042a facade block (comment + both re-exports) deleted; the module's own judge-dispatch import retained
- src/linkedin-fetch.ts — the N042b facade block deleted; `SleepFn` re-exported from sleep.js (F014); the internal linkedin-context import drops the now-unused `isAllSurfacesFaulted`
- scripts/probe-judge.ts — entry guard + injectable `fetchFn` + `CONFIG` moved into `main()`; the `carriesAnswerEnvelope` gate replaces the brace probe; header carries the F005 revision note
- tests/probe-judge.test.ts — new replay suite: 9 cases covering ok / error-envelope / non-JSON / whitespace-only content / 429 / 401 / transport-throw / endpoint normalization / the NO ENVELOPE log token; the bare import is the entry-guard pin
- .madgerc — new, `detectiveOptions.ts.skipTypeImports` only; write-once, outside lint and format lists
- .github/workflows/ci.yml — the cycles gate (`npm run cycles`, lockfile-pinned) + the non-blocking `npm audit --omit=dev` step after Unused exports
- .github/workflows/watch.yml:67,75 — FORCE rides step env; the gate bash reads `$FORCE`
- package.json — cycles script, format extension, madge devDependency in its slot, five majors and two minors
- TECH_DEBT_AUDIT.md — the 16-row Resolution table in the design's final order, zero PENDING

#### Deviations from Plan:

- package.json — typescript stays `^5.9.3` instead of `^7.0.2`. The plan's own Phase 4 criterion records this as a user-approved deviation (madge 8's parser crashes on the TS 7 API; its peer pins ^5.4.4); the ledger F007 row records the deferral. Verified as recorded; non-blocking.
- biome.json — `schemas/2.6.8/schema.json` instead of `schemas/2.6.7/schema.json`. Also recorded in the plan as user-approved (`^2.6.7` installs CLI 2.6.8, which rejects the 2.6.7 label; the plan's `biome migrate` escape hatch). Verified as recorded; non-blocking.
- Working tree — 25 files outside the plan's declared write-sets are modified. All are biome 2.x churn from the Phase 4 majors bump: import-order re-sorts (src/email.ts, src/index.ts, src/judge-availability.ts, src/judge-exhaustion.ts, src/judge-shared.ts, src/linkedin-payload.ts, src/linkedin-walk.ts, scripts/replay-linkedin.ts, and 14 test files), blank-line normalizations (src/judge-prompts.ts, src/linkedin-context.ts, src/linkedin-walk.ts), the options-object reformat of every `it()` in tests/commit-state-rebase.test.ts, and two value-identical edits (the escaped-quote removal in the src/judge-prompts.ts prompt string; `<html lang="en">` in tests/fixture/tag-page.html). No test pins the prompt bytes and both fixture consumers pass, so behavior is unchanged. This is the deterministic output of the toolchain bump the plan mandated, not a scope escape — but the plan's `files:` lists do not declare it, and the commit message should name it.

#### Pattern Conformance:

- ✓ New test files follow the offline-suite idiom: node:test via tsx, `node:assert/strict`, real `Response` doubles, tmpdir-only fixtures, no network
- ✓ tests/capture-oracle.ts mirrors the three oracles it replaces, including the operator-run carve-out (silent when captures/ pre-dates the run)
- ✓ scripts/probe-judge.ts keeps the entry-guard shape the other scripts/ CLIs use; tests/judge.test.ts:12 lands at exactly the 100-column bound the plan cites
- Minor observation: the biome 2.x import re-sort touched files the plan never listed. Acceptable variation, not a deviation — it is the deterministic output of the Phase 4 bump the plan mandated.

#### Potential Issues:

- captures/ still holds the two leaked session dirs (20261115T021815Z, 20261115T022011Z). The plan sequences the operator `rm -rf captures/` AFTER the slice commit is staged, so this is pending homework, not a defect. The oracle is armed and verified (Manual Testing item 1), so a future leak fails the suite.
- The F005 live validation is outstanding by design: the next live dispatch after merge is the validator for the envelope gate (expected ceiling changes, precedent 7cc7250). Not a gate here, per the plan.
- The two moderate-severity advisories `npm ci` prints are devDependency-only (`npm audit --omit=dev` is clean), so the non-blocking CI audit step stays inert.

### Manual Testing Required:

The user asked for manual verification; every executable manual criterion was executed in this run:

1. F015 oracle firing — VERIFIED. With captures/ held aside, a sink-less scratch case created captures/fakesession/body-001.json; `assertNoFreshCaptures()` failed naming `captures/fakesession/ (1 file(s): body-001.json)`. The original captures/ tree was restored intact.
2. Clean-checkout double run — VERIFIED. A scratch checkout of the working tree passed `npm test` twice: 656/656 both runs, no captures/ regrowth.
3. D7 madge evidence — VERIFIED. Without .madgerc, `npx madge@8.0.0 --circular --extensions ts src` exits 1 listing exactly the 9 type-only cycles; with it, exit 0.
4. Cycles gate catches real cycles — VERIFIED. A scratch runtime back-edge (judge-rotation.ts -> judge-exhaustion.ts) reddens the gate: `Found 1 circular dependency`, exit 1.
5. README PC-path table — VERIFIED. Both rows match the code literals: `C:/loker-secrets/linkedin-chromium-profile` (src/linkedin-fetch.ts:79) and `C:/loker-secrets/linkedin-cookies.json` (scripts/login-linkedin.ts:33).
6. Format re-indent — VERIFIED. `biome format` on watcher.config.json re-indents 3-space to 2-space (124 lines changed); JSON.parse is whitespace-blind, so loadWatcherConfig is unaffected.

Still owed by the operator or post-merge (cannot be executed from this checkout):

- [ ] `rm -rf captures/` after the slice commit is staged (gitignored scratch, never a git operation)
- [ ] A staged commit fires the husky/lint-staged 17 chain (wiring verified present: package.json lint-staged key + .husky/pre-commit `npx lint-staged`)
- [ ] The next live dispatch after merge classifies 2xx error envelopes as failed legs (F005 live validation)
- [ ] `git worktree prune` on the main clone (F011); `git count-objects` no longer warns "garbage found"
- [ ] The watch job's first post-merge run installs playwright 1.65.1 (one cache miss) and stays green

### Recommendations:

- Ready to commit — implementation is complete and validated.
- Name the biome 2.x churn in the commit message: 25 files outside the plan's `files:` lists carry import-order and formatting changes from the majors bump. They are green and inert, but a reviewer diffing against the plan will see them.
- Delete captures/ after staging, per the plan's sequencing.
