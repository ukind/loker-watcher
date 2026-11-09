---
date: 2026-11-09T17:06:39+0700
author: Yogiswara Utama
commit: dc75365
branch: ukind/feature-email-per-surface
repository: feature-email-per-surface
topic: "Validation of Email digest per surface"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-09_15-36-47_email-per-surface.md"
tags: [validation, plan, email, notify, attribution, linkedin-payload, dedupe, surfaces]
last_updated: 2026-11-09T17:06:39+0700
---

## Validation Report: Email digest per surface

### Implementation Status

- ✓ Phase 1: Contract + payload v2 — Fully implemented
- ✓ Phase 2: Stamping at all three fetch sites — Fully implemented
- ✓ Phase 3: Dedupe merge + per-surface notify + subjects — Fully implemented
- ✓ Phase 4: Integration rewrite — Fully implemented

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean, no errors
- ✓ Lint: `npm run lint` — 60 files checked, no fixes applied
- ✗ Full offline suite: `npm test` — 521 tests / 520 pass / 1 fail (`tests/config-file.test.ts:41` — pre-existing at base, see Potential Issues)
- ✓ Phase 1 suite: `npx tsx --test tests/linkedin-payload.test.ts` — green (evidenced by the full-suite run: the only failure is the base config pin)
- ✓ Phase 3 suite: `npx tsx --test tests/email.test.ts` — green (evidenced by the full-suite run)
- ✓ Phase 4 suite: `npx tsx --test tests/index.test.ts` — 34 tests / 34 pass / 0 fail
- ✓ Phase 2 trio: `npx tsx --test tests/config-file.test.ts tests/fetch-threads.test.ts tests/fetch-linkedin.test.ts` — 78 tests / 77 pass / 1 fail (the same pre-existing `config-file.test.ts:41`)
- ✓ `grep -n "PAYLOAD_VERSION = 2" src/linkedin-payload.ts` — exactly one hit (line 30)
- ✓ `grep -n "stampsAreValid(row.surfaces)" src/linkedin-payload.ts` — one hit (line 99), gating `isValidRow`
- ✓ `grep -rnE "\b(buildSubject|buildDigest|sendDigest)\b" src/` — no hits (combined trio deleted)
- ✓ `grep -rn "hiring indonesia" src/` — no hits
- ✓ `grep -n "groupMatchesBySurface(matches, notifySurfaces)" src/index.ts` — one hit (line 512)
- ✓ `grep -c "mergeSurfaceStamps" src/index.ts` — 2 hits (definition + call site)
- ✓ `grep -nE "on Threads|on LinkedIn" tests/index.test.ts` — no hits
- ✓ `grep -c "email: failed to send" tests/index.test.ts` — 1
- ✓ `grep -c "carries no configured surface" tests/index.test.ts` — 2
- ✓ `grep -c "timing: notify" tests/index.test.ts` — 1
- ✓ `grep -c "dedupePosts" tests/index.test.ts` — 3
- ✓ Phase 2 stamp greps — `value: surface.value` at `src/fetch-threads.ts:226,328` (logged-out + authenticated slot writes) and `src/linkedin-fetch.ts:499`; `value: page.value` at `src/index.ts:573`; `"tag" | "url"` one hit per file in `src/config-file.ts` and `src/fetch-threads.ts`; `duplicate surface` warn one hit at `src/config-file.ts:217`
- ✓ No regressions detected — base dc75365 measured (run-delta stashed, full suite): 498 tests / 497 pass / 1 fail; delta -> 521 tests / 520 pass / 1 fail. The single failure is the same assertion at `tests/config-file.test.ts:41` on both sides; the delta added 23 tests and 23 passes with zero new failures.

### Code Review Findings

#### Matches Plan:

- `src/types.ts:29` — `surfaces?: Surface[]` lands as the final `Post` field with the plan's doc comment; `Surface` imported type-only, `types.ts` stays a runtime leaf
- `src/linkedin-payload.ts:30` — `PAYLOAD_VERSION = 2`; `isValidStamp`/`stampsAreValid` (lines 62-81) sit immediately above `isValidRow`, and the guard gates the row as the plan's conjunct specifies
- `src/config-file.ts:205-220` — `warnDuplicateSurfaces` placed after `readSurfaces`, keyed on `type|value` (the review's unified dialect), called from the `readSurfaces` tail; both `resolveSurfaces` arms carry the raw `type`/`value` pair
- `src/fetch-threads.ts:226,328` — `SurfaceFetch` gains `type`/`value`; both slot writes stamp with fresh post objects (`...post` spread, no input mutation)
- `src/linkedin-fetch.ts:499` — stamp at the slot write with the plan's comment; `scripts/fetch-linkedin.ts` untouched, as the plan states
- `src/index.ts:573` — logged-out walker stamps from `page.type`/`page.value` (D2: identity survives the successes-filter compaction)
- `src/index.ts:509-531` — the notify seam is the loop: `notifySurfaces` filters disabled platforms, `groupMatchesBySurface(matches, notifySurfaces)` at line 512, orphan warn with the review's reworded tail (covers removed-surface AND platform-off), per-group `sendSurfaceDigest` with `linkedinLeg` + `degradedLine` riders, all inside the existing `timeStage` closure with one `timing: notify` line
- `src/index.ts:595-621` — `dedupePosts` exported; `mergeSurfaceStamps` builds a fresh array, never mutates inputs, and omits the field entirely under `exactOptionalPropertyTypes` when no stamps exist
- `src/email.ts:58-241` — the per-surface family (`renderSurface`, `buildSurfaceSubject`, `SurfaceGroup`, `groupMatchesBySurface`, `buildSurfaceDigest`, `sendSurfaceDigest`) replaces the combined trio; `resolveEmailConfig`, `sendText`, `legDetailSuffix`, `buildExhaustionText`, `sendExhaustionEmail`, `buildLegDeadAlarmText`, `sendLegDeadAlarm` all still exported and unchanged
- `src/heartbeat.ts:172-177` — doc comment now names `sendSurfaceDigest`; no code change
- `tests/email.test.ts`, `tests/index.test.ts`, `tests/linkedin-payload.test.ts`, `tests/fetch-threads.test.ts`, `tests/fetch-linkedin.test.ts`, `tests/config-file.test.ts` — every fence landed as written, including the non-aliasing `dedupePosts` pin (the Plan Review blocker) and the v2 admission matrix

#### Deviations from Plan:

- `tests/index.test.ts` — the suite grew from 28 to **34** `it()` blocks; Phase 4's Overview states 33 (the late-applied Plan Review blocker added the non-aliasing `dedupePosts` pin as a 34th block). One block beyond the plan's count; all five named integration titles are green, so the criterion's intent holds — only its number is off by one.
- `.rpiv/artifacts/plans/2026-11-09_15-36-47_email-per-surface.md` — the two criteria whose commands cannot pass at this base (Phase 2's three-suite trio, Phase 4's `npm test` terminal baseline) are correctly left unchecked, and the plan's `## Testing Strategy` whole-plan gates are also all unchecked (they are validate-owned and were executed here). Bookkeeping only; results recorded above. The plan's "green at base" Testing Strategy claim is measured stale at `dc75365` — a plan-level assumption, not an implementation gap.

#### Pattern Conformance:

- ✓ Imports, naming, error handling, and test structure follow the established siblings: type-only `Surface` imports keep `types.ts` a runtime leaf, `t.mock.method` warn/log capture matches the existing suites, temp-state helpers reuse the `mkdtemp`/`after` cleanup idiom
- ✓ The stamp attach sites all use conditional spread or definite assignment — no `surfaces: undefined` anywhere, honoring `exactOptionalPropertyTypes`
- Acceptable variation, not a deviation: `src/index.ts`'s orphan warn reuses the pre-existing `surfaceLabel` helper rather than the email renderer, so the warn reads `linkedin/retired-query` instead of `linkedin: "retired-query"` — the Phase 4 pin is includes-based and stays green

#### Potential Issues:

- `tests/config-file.test.ts:41` — **pre-existing at base — criterion unachievable as written.** The committed `watcher.config.json` has carried `platforms.threads: false` since commit `286abbb` (2026-11-09 10:15, before this run), while this assertion still pins `{ linkedin: true, threads: true }`. Measured at base `dc75365` with the run's delta stashed: the suite fails identically (498/497/1). The failing line is byte-identical to base (`git show HEAD:tests/config-file.test.ts`, line 41); the run's edits to that file are additive hunks at lines 176+ and 302+ (`git diff HEAD` verified). Attributed to base debt, not the run's delta — ruled not met, non-blocking. It will still hold the CI gate red on this branch until the pin or the config moves; fix before merge.
- `.rpiv/guidance/src/architecture.md:40,197` — stale references to the deleted trio: line 40 still shows `await sendDigest(matches, resolveEmailConfig(env), transport);` and line 197 still names `buildDigest` + `buildSubject` in the pipeline-stage description. Comment-only class (no executable line changes, no downstream stage fails as written) — non-blocking, but the guidance now misdescribes the notify stage.

### Manual Testing Required:

Executed offline during this validation (scratch under `.rpiv/tmp/`, deleted after use):

1. Phase 1 — v1 envelope degrade:
   - [x] A v2 payload rewritten to `version: 1` reads back as `leg=malformed`, `detail=unknown version 1 (expected 2)`, `posts=0`, with exactly one warn line (`linkedin: payload unknown version 1 (expected 2) — threads-only run`)
2. Phase 2 — duplicate-surface warn on the real committed config:
   - [x] `loadWatcherConfig("watcher.config.json")` logs `config: watcher.config.json duplicate surface linkedin "hiring react" — watched once; delete the extra entry from "surfaces"` exactly **once** (warn-count=1) and still loads all 31 surfaces
   - [x] Log-line shapes unchanged — the untouched `fetch: <label> OK` / `extract: <label>: N post(s)` pins are green in the suite
3. Phase 3 — per-surface notify behavior (verified at test level; no live mail needed):
   - [x] Two matching surfaces send exactly two emails in config order with subjects `2 new job posts — tag: "hiring"` / `2 new job posts — tag: "loker"`; the leg + degraded riders ride both bodies (FR2/FR5/FR8/FR9 tests green)
   - [x] A zero-match run sends exactly ONE heartbeat (Gate 2 test green, `0 new matches` subject)
   - [x] An orphaned match logs `notify: match <id> carries no configured surface (…)` (both live warn lines observed in the suite output), appears in no email, and is still marked seen (D3 test green — all three judged ids persist)
4. Phase 4 — integration titles:
   - [x] `npm test` lists all five new titles green: the FR2 ride, the D7 collapse, the D3 orphan skips, the FR7 mid-loop send failure, the FR9 rider ride

Still requires a human with live credentials:

5. Live end-to-end (operator homework):
   - [ ] `npm start` with real `LLM_*` + `GMAIL_*` env: confirm real emails arrive per surface in config order with the `N new job post(s) — <surface>` subjects, and a zero-match run sends exactly one heartbeat
   - [ ] PC leg: after `npm run fetch-linkedin` pushes a v2 payload, confirm the hosted run reads it without the one-time `unknown version 1` degrade

### Recommendations:

- Fix `tests/config-file.test.ts:41` (pin `threads: false`, or assert shape-only so operator config flips stop breaking the suite) before merging — CI runs the same three gates and is red at base on this assertion. Pre-existing debt, not this plan's work, but it blocks the pipeline gate.
- Update `.rpiv/guidance/src/architecture.md:40,197` to name the per-surface notify loop (`groupMatchesBySurface` + `sendSurfaceDigest`) so the guidance stops describing the deleted combined digest.
- Ready to commit — the implementation is complete and validated; the only failing command is pre-existing at base and ruled non-blocking.
