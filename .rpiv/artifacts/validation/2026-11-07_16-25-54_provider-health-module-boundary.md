---
template_version: 1
date: 2026-11-07T16:25:54+0700
author: Yogiswara Utama
commit: 2ca27dd
branch: judge-provider-health
repository: loker-watcher
topic: "Validation of provider-health-module-boundary"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-07_08-49-53_provider-health-module-boundary.md"
tags: [validation, judge-health, judge-rotation, judge, judge-ceilings, email, heartbeat, watch-workflow, commit-state-rebase]
last_updated: 2026-11-07T16:25:54+0700
---

## Validation Report: provider-health-module-boundary

Implementation delta: `c647e0f..HEAD` (plan authored at `c647e0f`); the plan's own work is commits `89cbd42` (phases 1–7: 16 files) and `46c56b1` (phase 8: 7 files). Both touch exactly the phases' declared `files:` sets. A prior validation of this plan (`2026-11-07_13-36-17`) passed after the Phase 6 test gap was fixed; this run re-validates the shipped tree fresh.

### Implementation Status

- ✓ Phase 1: Health module — Fully implemented (`src/judge-health.ts` 429 lines, 15 exports matching the plan fence verbatim; `JUDGE_HEALTH_PATH` at `src/config.ts:89` with the single-writer doc)
- ✓ Phase 2: Health module tests — Fully implemented (`tests/judge-health.test.ts` 511 lines; green in the suite run)
- ✓ Phase 3: Rotation fields + inline pick — Fully implemented (fields `src/judge-rotation.ts:90-101`, `HEALTH_CAP_STREAK = 2` `:62`, inline pick predicate `:185-186`, claim-time probe registration `:238-239`; both suites' `freshState` literals extended)
- ✓ Phase 4: Judge core stamps + hang arm — Fully implemented (terminal stamp `src/judge.ts:536`, countsSuccess-gated success `:552-558`, transport stamp `:573`, third flavor arm `:480`, `allHealthBlocked` `:354`, `exhaustionRecord` `:372`; throw sites `:792` health-less standalone, `:898`/`:976` with the health payload)
- ✓ Phase 5: Email + heartbeat riders — Fully implemented (`src/email.ts:83,99,158,168`; `src/heartbeat.ts:51,146`; fixtures grown in both suites)
- ✓ Phase 6: Entry wiring — Fully implemented (`src/index.ts` seams `:131,136,177`, hoisted resolve + degraded line `:276-281`, stats spread `:294`, success flush `:336`, digest 5th arg `:372`, catch fence `:448-476` with the load-bearing pre-flush `episodeAlarmDue` read; `tests/index.test.ts:707-846` describe with the 3-tick acceptance `:708`, Gate-1 render `:782`, Gate-1 no-flush FR7 `:816`)
- ✓ Phase 7: Workflow + commit-back — Fully implemented (`watch.yml` `Commit health` step `:161` with `-f` guards `:177,203` and the timeout comment `:111`; skip-set third literal `scripts/commit-state-rebase.sh:66`, header `:14`; suite cases grown)
- ✓ Phase 8: Docs sync + repo-wide gates — Fully implemented (8 target files; stale-prose grep clean; gates run repo-wide)

### Automated Verification Results

- ✓ Type check: `npm run typecheck` — no errors
- ✓ Lint: `npm run lint` — 58 files checked, no findings
- ✓ Tests: `npm test` — 444/444 pass, 0 fail, 0 skipped (offline, deterministic)
- ✓ All-429 pin: `tests/index.test.ts:435` "rejects with the complete pool-ordered exhaustion record and never touches state at budget death" — passes unchanged (complete record `[1]`, zero emails, state file ENOENT), proving the catch-only flush placement
- ✓ Boundary: zero runtime `judge-rotation → judge-health` edge — `src/judge-rotation.ts:38` is `import type { TickOutcomes }` only (runtime-erased; see Deviations for the criterion-text note)
- ✓ `failuresFromCooldowns` deletion: `grep -rn` over `src/ tests/` finds no code reference — sole survivor is the provenance doc-comment at `src/judge-health.ts:219`, exactly as the criterion's parenthetical anticipated
- ✓ No repo writes during the suite: `git status --porcelain state/` empty after `npm test`; `state/` holds exactly the three expected files (`judge-health.json` correctly absent pre-first-live-run)
- ✓ Stale prose: `grep -rniE "two committed state|two state files|both state files|two invokers|is two files"` over README/AGENTS/guidance/script — zero hits; three-file prose confirmed at `README.md:9`, root guidance `:14`, scripts guidance `:4,:17,:66`, workflows guidance `:119`
- ✓ No regressions detected — all pre-health suites pass unmodified (444 total includes the grown suites)

### Code Review Findings

#### Matches Plan:

- `src/judge-health.ts` — the ceilings four-piece template realized: pure resolver `:104`, never-throw reader `:131` (ENOENT quiet, one warn naming the file), atomic writer `:308` (temp+rename, failure names the target), semantic-change gate `:352` (canonical sorted-keys compare, repairs a corrupted current file), plus the ledger (`stampFailure`/`stampSuccess`/`readTickOutcomes`/`buildFailuresFromLedger` `:181-226`), tick merge `:248`, degraded line `:279`, best-effort flush wrappers `:384,405`, and `episodeAlarmDue` `:427` (absent/closed → alarm-due, open → suppressed)
- `src/judge-rotation.ts:90-101` — the three plain fields with the paired-constant doc; `HEALTH_CAP_STREAK = 2` `:62` cross-referenced to `HARD_FAIL_TICKS_TO_CAP`; pick predicate inline plain-field reads `:185-186` with the capped-1 effective ceiling; `claimAccount` probe registration `:238-239`
- `src/judge.ts` — stamps at exactly the plan's sites: 429 never stamps (cooldown path), terminal branch stamps `HTTP <status>` / `HTTP 401|403 — key dead` `:536`, transport stamps `network error: <message>` `:573`, success stamps only when `countsSuccess` `:552-558` (parse-miss `:698` stamps nothing), mid-backoff path stamps nothing; `judgePosts` trailing `healthMarks` param, Σ-effective-caps width, `outcomes` on `JudgeBatchResult`
- `src/index.ts:448-476` — the catch fence matches the plan byte-for-byte in structure: pre-flush `episodeAlarmDue` read (`:456` before the `:458` flush — the load-bearing order), flush best-effort with fail-visible suppression default, alarm gated on the hoisted flag, earned `exit 1` never masked
- `tests/index.test.ts:707-846` — the Phase 6 gap fix from the prior validation round is present and green: 3-tick acceptance (streak 1 → cap 2 → probe success clears + rejoins, `auths.length === 1` half-open pin, degraded line on the tick-3 digest, `marks` reset + `outageOpen: false` after), Gate-1 degraded-line render, Gate-1 no-flush FR7 pin (health file ENOENT)
- `.github/workflows/watch.yml` — `Commit health` `:161` with `if: always() && failure()`, bot identity, `-f`-guarded add of only the health file, no-op guard, fixed message, rebase script; the `Commit state` step's health add equally `-f`-guarded `:203`; both guarded adds match the absent-first-run doctrine
- Docs (phase 8) — every synced statement verified true against the shipped code: three committed state files, Commit health step, three invokers, zero-RUNTIME-import boundary, coverage-map rows for `judge-ceilings.ts` and `judge-health.ts`

#### Deviations from Plan:

- Plan-text inconsistency, non-blocking (comment-only class — the remedy is plan/doc text, no executable line is wrong): Phase 4's revision added `import type { TickOutcomes } from "./judge-health.js"` (`src/judge-rotation.ts:38`), while Phase 3's automated criterion ("`grep -n "from \"./judge-health" src/judge-rotation.ts` returns nothing") and the "What We're NOT Doing" line ("no judge-rotation → judge-health import of any kind") still demand zero imports of any kind. The operative invariant — zero RUNTIME import, the D5 type-only idiom, plain-field inline pick, no exported `isHealthBlocked` — holds in the shipped code and is what Phase 8's synced docs (and the root/src guidance) state. Only the earlier criterion and NOT-Doing sentence went stale when Phase 4 revised the boundary from "no import" to "no runtime import". The implementation matches the plan's final intent; the plan's earlier text deviates from its own later revision.

#### Pattern Conformance:

- ✓ `src/judge-health.ts` mirrors the `judge-ceilings.ts` template (resolver / never-throw reader / atomic writer trio + the writer-in-src rationale quoted in the module header); the reader degrade lattice grafts the `linkedin-payload.ts` version-gate shape; the writer reuses `stateTempPath` + rename with the failure-cleanup message naming the target
- ✓ Tests follow established idioms: lazy per-suite `mkdtemp` cleaned in one `after()` (`judge-ceilings.test.ts` shape), `t.mock.method(console, "warn")` capture, `recordingTransport()`, hand-stepped tick clock, inert `sleepFn`
- ✓ Biome-clean across all touched files (member sort, import order enforced — the Phase 9 review's uppercase-first import sort is in place at `tests/judge.test.ts`)
- Minor observation (acceptable variation, not a deviation): `judge-health.ts` carries 15 exports vs the ceilings module's 3 — expected, the plan's Phase 1 fence enumerates exactly these (ledger + episode helpers join the trio); the structural slice `OutcomeLedgerState` keeps the module standalone-typechecking without importing `judge-rotation`

#### Potential Issues:

- Branch context, not a plan violation: `c647e0f..HEAD` carries commits outside this plan's write-set — operational state commits (seen-posts shrink `831f29d`/`8998781`, ceilings re-measure `333712a`), workflow artifacts (`7bc649a`), and follow-on probe work (`2ca27dd`, `scripts/probe-judge.ts` concurrency — landed after the earlier 13:36 validation pass, and the plan's "NOT touching the probe" applies to this plan's phases, which wrote no probe file). The plan's own two commits (`89cbd42`, `46c56b1`) touch exactly their declared files. No `--scope` verdict was provided for this run, so no floor findings were adjudicated.

### Manual Testing Required:

1. Live dead-key run (the plan's one unchecked box — credentials-gated):
   - [ ] One deliberately dead key → the exhaustion alarm names the real cause (`HTTP 401 — key dead` / `HTTP 503` / `network error: …`), run exits 1, `state/judge-health.json` written atomically
   - [ ] Second all-dead tick → warn-only ("outage episode already open"), still exit 1
   - [ ] First hosted run → the `Commit state`/`Commit health` steps materialize + commit `state/judge-health.json`
   - [ ] A healthy tick clears the episode bit (`outageOpen: false`)

### Recommendations:

- Ready to commit — implementation is complete and validated (both implementation commits already landed; working tree clean, nothing left to group)
- Optional, next time the plan file is touched: update the stale Phase 3 criterion and the "no import of any kind" NOT-Doing sentence to the zero-RUNTIME-import wording Phase 4 and the docs already use — no code action warranted
