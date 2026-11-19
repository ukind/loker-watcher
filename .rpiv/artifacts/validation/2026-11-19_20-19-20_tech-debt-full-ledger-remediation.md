---
template_version: 1
date: 2026-11-19T20:19:20+0700
author: Yogiswara Utama
commit: 7087c44
branch: ukind/fix-techdebt-2
repository: fix-techdebt-2
topic: "Validation of tech-debt full-ledger remediation (N065-N092): 6-phase implementation plan"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-19_13-14-31_tech-debt-full-ledger-remediation.md"
tags: [validation, plan, tech-debt, judge, linkedin, tests, docs, facades, type-moves]
last_updated: 2026-11-19T20:19:20+0700
---

## Validation Report: tech-debt full-ledger remediation (N065-N092): 6-phase implementation plan

### Implementation Status

- ✓ Phase 1: Live signals — Fully implemented
- ✓ Phase 2: Type homes + deps object — Fully implemented
- ✓ Phase 3: Facade execution — Fully implemented
- ✓ Phase 4: Extractions — Fully implemented
- ✓ Phase 5: Test consolidation — Fully implemented
- ✓ Phase 6: Doc pass — Fully implemented

### Automated Verification Results

- ✓ Typecheck: `npm run typecheck` — clean, no output
- ✓ Lint: `npm run lint` — 85 files checked, no fixes applied
- ✓ Biome per-phase fences (Phases 2/3 criteria): the per-phase `npx biome check --write <files>` commands were not run verbatim; `npm run lint` covers the union scope (85 files, a superset of every phase's file list) and reported "No fixes applied" — zero diffs existed to write, which supersedes the per-phase invocations
- ✓ Tests: `npm test` — 704 tests / 704 pass / 0 fail (plan expected > 670)
- ✓ New suites standalone: `npx tsx --test tests/pool.test.ts tests/config.test.ts tests/judge-exhaustion.test.ts` — 17/17 pass
- ✓ Ramp suite standalone: `npx tsx --test tests/judge-ramp.test.ts` — 8/8 pass
- ✓ Chain suite (banner prefix pin): `npx tsx --test tests/linkedin-chain.test.ts` — 11/11 pass
- ✓ Probe suite (renamed title): `npx tsx --test tests/probe-linkedin.test.ts` — 12/12 pass
- ✓ knip: `npx knip` — exit 0
- ✓ madge: `npx madge --circular src scripts` — CAUTION: the plan's bare form processes only **2 files** (madge's default extension detection misses .ts here) and would read as a false pass. The measured run is `npx madge --circular --extensions ts,tsx src scripts` — **45 files processed, 0 cycles** (corroborated by `--ts-config tsconfig.json` variants: 37 src files, 0 cycles)
- ✓ N089: value-pin grep — one hit at `tests/config-file.test.ts:308`, the intentional partial-band default pin; both former pair sites (`:59-62`, `:287-290`) carry shape assertions only
- ✓ N091: both startLoop cases pass (crossing band warns once matching `/PAYLOAD_MAX_AGE_MS/`; 15/45 stays quiet)
- ✓ N065: `grep -n "body.includes" scripts/probe-judge.ts` — no hits (classifyResponse owns the gate)
- ✓ N072: `grep -n "shell: true" scripts/hooks/format-on-edit.js` — no hits
- ✓ N073: `grep -n "session captured" scripts/login-linkedin.ts` — no hits; `pair captured` present at `:224`
- ✓ N092: `grep -n "export interface LlmAccount" src/judge.ts` — no hits; `grep -rl 'from "./judge-account.js"' src` — 8 files (see Deviations)
- ✓ N092: `src/linkedin-fetch.ts` has no `LinkedinSurface` export (imports it from `./config-file.js` at `:28`)
- ✓ N069: `grep -rn "walkLinkedInSurface" tests/` — no hits; signature reads `(context, surface, deps)` at `src/linkedin-walk.ts:118`
- ✓ N067: `grep -rn "REMOVAL NOTE" src/` — no hits (also clean across scripts, tests, AGENTS.md, README.md, guidance)
- ✓ N067: facade-path consumer grep — no hits for `LinkedInContextFactory|allSurfacesFaulted|halt|isAllSurfacesFaulted|isHalt|isLegDead|legDead|SCROLL_JS` on any `linkedin-fetch.js` specifier
- ✓ N067: `grep -nE "\bbuildBulkMessages\b|\bjudgePost\b" tests/judge.test.ts tests/judge-rotation.test.ts scripts/probe-judge.ts | grep "src/judge.js"` — no hits
- ✓ N076: `grep -n "SCROLL_JS" tests/fetch-linkedin.test.ts` — no hits
- ✓ N075: helper block gone from `src/index.ts`; `surfaceLabel`/`dedupePosts` exported at `src/pipeline-helpers.ts:16,29`; `mergeSurfaceStamps` private at `:44`; imports present at `src/index.ts:54` and `tests/index.test.ts:37`
- ✓ N080 entry guard: `npx tsx -e "import('./scripts/probe-judge.ts')..."` — exits 0 printing "import clean"; `await loadWatcherConfig` appears exactly once, inside `main()` at `scripts/probe-judge.ts:174`
- ✓ N078: `grep -c "as unknown as typeof fetch" tests/judge.test.ts tests/judge-rotation.test.ts` — 0/0; `grep -c "as unknown as" tests/judge-helpers.ts` — 1 (the factory's)
- ✓ N079: no `function freshState` in either judge suite; `export function freshState` at `tests/judge-helpers.ts:72`
- ✓ N077: `grep -n "elapsed < 500" tests/judge-rotation.test.ts` — no hits; `rotation must not sleep` present at `:367`
- ✓ Doctrine: `grep -n "stay per-suite" tests/judge-helpers.ts .rpiv/guidance/tests/architecture.md` — no hits
- ✓ N066: `grep -rn "timestamp-ordered zip" AGENTS.md .rpiv/guidance src` — no hits; `grep -n "5 surfaces" src/linkedin-behavior.ts` — no hits
- ✓ N070: `negativeKeywords` present in README.md (1 hit) and AGENTS.md (1 hit)
- ✓ N081: `grep -rni "first configured surface" AGENTS.md README.md .rpiv/guidance scripts tests` — no hits; `Chrome window` gone from README.md; `probe-judge` in package.json — 2 hits (lint `:13`, format `:15`); `5 of the 6` gone and `5 of the 7` present at workflows-arch `:7`; `same three` gone from guidance-arch; `reset-linkedin` in AGENTS.md — 3 hits
- ✓ N090: `150 MiB loose` present at `.rpiv/guidance/architecture.md:62` and `.rpiv/guidance/.github/workflows/architecture.md:138`
- ✓ Stragglers: guidance format row no longer says "src and tests only"; workflows-arch ci.yml line carries `→ knip` at `:18`
- ✓ Doc fence counts unchanged: README 8/8, guidance-arch 2/2, src-arch 14/14, scripts-arch 8/8, workflows-arch 14/14
- ✓ No regressions detected — base 7087c44 measured: 670 tests / 669 pass / 1 fail (the N089 red pair at `tests/config-file.test.ts:57`, expected 60 got 15); delta -> 704/704

### Code Review Findings

#### Matches Plan:

- `src/judge-account.ts` — zero-import leaf holding only `LlmAccount`, byte-verbatim from the plan fence; the judge-shared → judge-health → judge back-edge family is gone (madge 0 cycles)
- `src/linkedin-walk-static.ts:157` — `isPageCloseRace` exported beside `PAGE_CLOSE_RACE_MESSAGES`; the module's only import remains `linkedin-parser.js`, so no new fetch-threads → linkedin-walk edge
- `src/fetch-threads.ts:69,389-395,423,453-454` — `isTimeoutAbsence` helper, the `warnBodyFault` latch, and both catch arms wired exactly as fenced
- `scripts/watch-linkedin.ts:143-152` — the N091 warn sits between the band resolve and `runLoop`, one line, names `PAYLOAD_MAX_AGE_MS` and the freshness rule
- `scripts/hooks/format-on-edit.js` — `spawnSync(process.execPath, [biomeJsBin, "format", "--write", file])`, no shell; nonzero-status warn arm present
- `src/linkedin-capture.ts` — single-line JSON write and the `LINKEDIN_CAPTURE=off` no-op sink with the injectable `env` param
- `src/linkedin-walk.ts:100-131` — `WalkLinkedInDeps` with `scrollRounds`/`captureOrdinal` required, `captureSink` the sole `| undefined` field, defaults resolved at the top
- `src/linkedin-fetch.ts:260` — the call site passes `nowFn: now` (the Phase-2 review blocker's fix, landed)
- `src/judge-ramp.ts` — `classifyResponse`/`probeFetch`/`rampLevel`/`findConcurrencyCeiling`/`RAMP_MAX` all exported (the Phase 5 §6 flip landed); `normalizeEndpoint` called bare
- `tests/judge-helpers.ts:111,135` — `fakeFetch` holds the repo's single fetch double-cast; `recordingSleep` returns the seam plus the transcript
- `tests/judge-rotation.test.ts:367` — the N077 case asserts `deepEqual(sleeps, [], "rotation must not sleep")` with its own pinned `NOW`
- `scripts/probe-judge.ts:160-166` — the seven-sibling entry guard wraps `main()`; importing the module performs no config load and no run
- `scripts/linkedin-chain.ts:106` and `tests/probe-linkedin.test.ts:286` — banner and test title both read config-order/first-to-clear-the-floor
- Export surfaces (Phase 3 manual item, grep-verified): `src/judge.ts` exports natives only (`parseLlmAccounts`, `JudgedPost`, `resolveJudgeConfig`, `judgePosts`); `src/linkedin-fetch.ts` exports natives only (`SleepFn`, `PACE_MIN_MS`, `PACE_MAX_MS`, `LINKEDIN_PROFILE_DIR`, `resolveLinkedInProfileDir`, `fetchLinkedInPosts`)

#### Deviations from Plan:

- Phase 2 success criterion — `grep -rl 'from "./judge-account.js"' src | wc -l` returns **8**, not the plan's 7. The eighth is `src/judge-ramp.ts`, created by Phase 4 (which the Phase 2 criterion could not foresee). The criterion is stale, not the implementation: all 7 files the criterion names import the leaf, plus the ramp module. Non-blocking.
- Phase 2/3/5 madge criterion — the plan's bare `npx madge --circular src scripts` is a false-pass trap on this repo: it processes 2 files and reports 0 cycles regardless of the TypeScript graph. The evidence-backed form is `--extensions ts,tsx` (45 files). Future validators reading the plan's command verbatim will see green without coverage. Non-blocking for this run (the measured form passed); a plan-criterion fix, not an implementation gap.
- Phase 1 manual item — `LINKEDIN_CAPTURE=off` against a real `npm run fetch-linkedin` tick: not executed (operator-run, needs a live PC leg and LinkedIn session). The offline pin at `tests/linkedin-capture.test.ts` covers the sink seam and passes. Recorded as manual homework, not a gap.

#### Pattern Conformance:

- ✓ New `src/` modules follow the leaf idiom: `judge-account.ts` mirrors `src/sleep.ts` (module doc explaining why it exists, zero imports); `pipeline-helpers.ts` and `judge-ramp.ts` carry the same doc-comment density and type-only import discipline as their siblings
- ✓ New test suites follow the `judge-parse.test.ts` skeleton: module doc naming the finding id, `node:assert/strict` + `node:test` imports, no mock libraries
- ✓ `tests/judge-helpers.ts` keeps `FetchCall` module-private (an exported-but-unimported interface fails knip) — matches the plan's Phase 5 review fix
- Acceptable variation, not a deviation: `tests/index.test.ts` retains 10 `as unknown as typeof fetch` casts. The N078 criterion scoped the cast purge to the two judge suites only; index.test.ts was never in that finding's file set.

#### Potential Issues:

- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` is modified in the working tree (run #8 ledger rewrite, 187 insertions / 206 deletions). It is not in any phase's `files:` list. It is the audit input document regenerated for this run — the plan's research parent cites it — so it reads as the run's own record-keeping, not an escape from a declared write-set. Non-blocking.
- `git count-objects -v` reports 2456 loose objects / ~225 MB loose at HEAD — already past the newly documented 150 MiB threshold. The N090 gc itself is an operator action (manual item below).
- `tests/judge-exhaustion.test.ts:8-11` — the header's fixture note ("it moves to judge-helpers in Phase 5") is now historical: `freshState` did move, so the suite's local `state()` factory could import it. The one place a plan fence went stale in the tree; comment-only, no executable line changes.
- N077 verification note (behavioral fact, discovered during the sanity scratch): a single-account pool has NO park path. A 429 cools the only account and the next dispatch throws `RotationExhaustedError` (`src/judge-rotation.ts:160`, via judge.ts:240's drain-then-throw) instead of sleeping — the sanity scratch's first attempt died exactly there. Park requires a second account or a preset cooldown driven through `resolveBlockedPick` (the proxy the scratch used). Relevant to future one-account debugging: "judge hangs/parks" cannot happen with `LLM_ACCOUNTS` of length 1.
- Quarantine manifest (Step 2.7, checked unconditionally): `.rpiv/artifacts/verdicts/` does not exist — zero manifests were written this run, so there are no `moved`/`refused` entries to rule. The absence is direct evidence, closing the manifest check independent of the TECH_DEBT_AUDIT.md explanation above.

### Manual Testing Required:

1. N088 capture kill switch (operator-run):
   - [ ] With `LINKEDIN_CAPTURE=off` in the environment, run a real `npm run fetch-linkedin` tick and confirm no `captures/` directory is created (the offline pin at `tests/linkedin-capture.test.ts` covers the sink seam)
2. N091 warn readability (verified during this run):
   - [x] Eyeballed via a scratch driver under `.rpiv/tmp/` (deleted after): one plain console line — `watch-linkedin: wake band floor 45 min reaches PAYLOAD_MAX_AGE_MS (40 min) — wakes in the 45-60 min band can read the pushed payload stale (freshness rule: the payload must be younger than PAYLOAD_MAX_AGE_MS to count ok)`
3. N077 assertion teeth (verified during this run):
   - [x] Injected a recording sleep into a real cooldown path (`resolveBlockedPick` parking on a preset cooldown) via a scratch driver under `.rpiv/tmp/` (deleted after): recorded `[4500]`, and `deepEqual(sleeps, [])` went red as intended
4. Probe output parity (verified during this run):
   - [x] Compared the ramp module's log lines against the pre-move script at HEAD: REFUSED / FAILED / ramp / ceiling lines byte-identical; the one intentional change is `NO JSON` → `NO CHOICES` (the N065 signal the Phase 1 fence specifies)
5. N090 gc (operator action):
   - [ ] Run `git gc --aggressive` once from this full clone (never shallow), then confirm `git count-objects -v` shows loose size in the low MiB range (from ~225 MB)
6. Phase 2 walk-header consistency:
   - [ ] Eyeball `src/linkedin-walk.ts:7-13` and the `WalkLinkedInDeps` JSDoc: both state the scroll-rounds default stays orchestration-side and `scrollRounds` is a required deps field

### Recommendations:

- Ready to commit — implementation is complete and validated: all six phases verified against code, all automated gates green, no regressions against the measured base.
- Run the N090 `git gc --aggressive` as a separate operator step before or after the commit; it is not part of this change set.
- The stale Phase 2 N092 count (7 vs 8) needs no code change; if the plan is revised for the record, update the criterion to 8.
