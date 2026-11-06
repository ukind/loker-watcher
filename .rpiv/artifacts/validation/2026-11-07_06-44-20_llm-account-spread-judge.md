---
template_version: 1
date: 2026-11-07T06:44:20+0700
author: Yogiswara Utama
commit: deb0575
branch: judge-account-spread-ceilings
repository: loker-watcher
topic: "Validation of Spread LLM judge load across all accounts using probe-measured per-account ceilings"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-06_18-36-57_llm-account-spread-judge.md"
tags: [validation, plan, judge, judge-rotation, judge-ceilings, probe-judge, watch-workflow]
last_updated: 2026-11-07T06:44:20+0700
---

## Validation Report: Spread LLM judge load across all accounts using probe-measured per-account ceilings

Validation scope: re-confirmation of the committed Phases 1–4 (validated pass 2026-11-06, commits `299401c`/`901ad32`/`3eca633`) plus a full delta review of Phase 5 ("Deep ramp + sequential dispatch", added by revise 2026-11-07), which sits uncommitted in the working tree across exactly its five declared files (`scripts/probe-judge.ts`, `.github/workflows/watch.yml`, `README.md`, `.rpiv/guidance/.github/workflows/architecture.md`, `.rpiv/guidance/scripts/architecture.md`) plus the plan artifact itself. `git status` shows no other modification and no untracked files — the write-set matches the phase declaration 1:1.

### Implementation Status

- ✓ Phase 1: Ceilings module — Fully implemented (committed `299401c`; retirement greps still 0 hits, ceilings suite green)
- ✓ Phase 2: Spread mechanism — Fully implemented (committed `299401c`; spread suites green)
- ✓ Phase 3: Probe persistence + commit-back — Fully implemented in code (committed `901ad32`); the live-run manual criteria remain open pending push (see Manual Testing Required)
- ✓ Phase 4: Docs sync + validation — Fully implemented (committed `3eca633`; AGENTS.md correctly left untouched per the plan's no-change note)
- ✓ Phase 5: Deep ramp + sequential dispatch — Fully implemented in the working tree; all five automated criteria verified against the diff; the four live-run manual criteria remain open pending push

### Automated Verification Results

- ✓ Whole-plan gate: `npm run typecheck && npm run lint && npm test` — exit 0; tsc clean, Biome 56 files no errors, tests 379/379 pass across 84 suites, 0 failures, 0 skipped
- ✓ Ramp literal retired: `grep -n "level of \[2, 4\]\|return 4;" scripts/probe-judge.ts` — 0 hits
- ✓ Ramp cap present: `grep -c "RAMP_MAX" scripts/probe-judge.ts` — 5 (≥ 3: cap constant, loop bound, terminal return, plus docblock mentions)
- ✓ Serialization wired: `grep -n "needs: \[probe\]" .github/workflows/watch.yml` — matches at `:80`; `needs.probe.result == 'success'` and the schedule-survival guard `github.event_name == 'schedule'` both match on the same `if` line at `:81`
- ✓ Stale ramp prose gone: `grep -rn "stop-once-4\|2→4 ramp\|2->4->\|~6 calls" scripts/probe-judge.ts .github/workflows/watch.yml .rpiv/guidance/ README.md` — 0 hits
- ✓ Refusal semantics intact: `return level / 2` on a refused level, `return 0` on a failed leg, `classifyDead` and `rampLevel` untouched (verified in the diff and the offline ramp driver below)
- ✓ Retirement re-confirmed (all three scopes): `src/ tests/`, `watch.yml`/`probe-judge.ts`, and `README.md AGENTS.md .rpiv/guidance/` — 0 hits each, no regression from the Phase 5 delta
- ✓ Workflow structure: watch.yml parses as valid YAML; job graph is `probe → watch`; `Run watcher` env keys are exactly `HEARTBEAT_ENABLED, THREADS_SESSION_STATE, LLM_ACCOUNTS, GMAIL_USER, GMAIL_APP_PASSWORD`; the string `JUDGE_CONCURRENCY` appears nowhere in the document
- ✓ Offline ramp driver (scratch under `.rpiv/tmp/`, deleted after): 12/12 checks — doubling bounds, refusal reads `level/2`, failed leg returns 0, terminal `RAMP_MAX`, walk simulations refuse-at-8 → ceiling 4, refuse-at-4 → ceiling 2, never-refuses → levels `[2,4,8,16,32]` ceiling 32
- ✓ Probe entry contract live: `npx tsx scripts/probe-judge.ts` without env → exit 1 with `probe: judge: missing required environment variable: LLM_ACCOUNTS` (fail-visible, names the problem)

### Code Review Findings

#### Matches Plan:

- `scripts/probe-judge.ts:149-155` — `RAMP_MAX = 32` with the safety-cap docblock (worst case `2+4+8+16+32 = 62` verified calls per account per probe), matching HUNK 2's constant
- `scripts/probe-judge.ts:163-186` — `findConcurrencyCeiling` doubling walk verbatim per HUNK 2: `for (let level = 2; level <= RAMP_MAX; level *= 2)`, refusal reads `level / 2`, failed leg returns 0, terminal `return RAMP_MAX`; the `timed`/`rampLevel`/`classifyDead` bodies untouched
- `scripts/probe-judge.ts:13-30` — module docblock ramp sentence now "doubling 2→4→8→16→32 and stopping at the first refused level"; Revision 2026-11-07 paragraph joins the tail; the live-only write-before-gate persistence from Phase 3 unchanged
- `.github/workflows/watch.yml:80-89` — `needs: [probe]` + `if: ${{ !cancelled() && (github.event_name == 'schedule' || needs.probe.result == 'success') }}` verbatim per HUNK 2, with the serialization comment; the probe job's ramp/commit-back comment matches HUNK 1; the existing Σ-ceilings width and 8-minute-cap paragraphs untouched
- `README.md:82-93` — the operator paragraph carries the doubling detail ("the ramp doubles concurrent calls 2→32 per account and stops when the endpoint refuses"), the serialization sentence ("On a dispatch run the watch job waits for the green probe… scheduled 10-minute runs skip the probe and read the committed file"), and the red-gate story ("a red gate skips the commit and the dispatch's watch") — matches HUNK 3
- `.rpiv/guidance/.github/workflows/architecture.md:20-22,107` — structure fence gains the `job watch: needs probe (serialization)` line; probe fence comment reads "doubling ramp 2→32"
- `.rpiv/guidance/scripts/architecture.md:49-50,53-54,101,93` — ramp excerpt shows the `level *= 2` walk and `return RAMP_MAX` ("only a fully clean 2→32 ramp reads 32"); important-if step 3 reads "the doubling ramp 2→32 (~6–62 calls, stopping at the first refused level)"; Caveats line states the ~62-calls worst case
- `AGENTS.md` — untouched, exactly as the plan requires ("stays true word-for-word; no change")

#### Deviations from Plan:

- Plan-text tension, resolved correctly by the implementation (non-blocking, comment-only): the plan's own Phase 5 HUNK 1 docblock text contained the phrase "stop-once-4", which the plan's stale-prose grep pin (`grep -rn "stop-once-4…" … → 0 hits`) bans from the same files. The implementation paraphrased — "the old ramp verified only levels 2 and 4" (Revision 2026-11-07 paragraph) and "the earlier stop-at-4 quota economy" (`RAMP_MAX` docblock) — preserving the meaning while keeping the file grep-clean. The plan's hunk text was self-conflicting; the shipped code satisfies both intents. This is a plan deviation, not an implementation one.
- Hunk-list gap covered by criterion (non-blocking): the scripts guidance Caveats line "~6 calls each" was edited to "the doubling ramp fires ~62 calls worst case each", though no Phase 5 hunk explicitly listed it — but the success criterion's stale-prose grep bans `~6 calls`, so the implementation correctly satisfied the criterion over the incomplete hunk list. Same class: the plan's hunk enumeration was incomplete, not the implementation.
- Benign in-scope cleanup: the scripts guidance structure fence carried a duplicated `#   INSIDE typecheck + lint + lint-staged` line (pre-existing); the delta removed the duplicate. Declared file, harmless.

#### Pattern Conformance:

- ✓ The watch job's `if` follows the canonical GitHub Actions skipped-dependency survival pattern: `needs: [probe]` + `!cancelled() && (schedule-event || needs.probe.result == 'success')`. On a schedule tick the probe is skipped by its own `if` and the watch still runs; on a dispatch the watch runs only after a green probe; a red probe skips only that dispatch's watch. Verified structurally (YAML parse) and by expression reading; the live confirmation is Manual item 1.
- ✓ The ramp change is bounds-only: logging lines, refusal classification, and the failure/refusal return values are byte-identical to the stop-once-4 body apart from the loop bounds and terminal return — the smallest possible edit for the behavior change.
- Minor observation (acceptable variation, not a deviation): the workflows guidance probe-fence comment retains the clause "the watch job is the real gate for it" while the watch.yml comment's serialization story now says the watch NEEDS the probe on dispatch runs. Both are true (scheduled ticks do not gate on the probe; dispatch runs do), and the guidance line the plan's HUNK 3 targeted was updated; no contradiction survives a careful read.

#### Potential Issues:

- Push state blocks every live manual item: the implementation commits sit on no remote branch (`git branch -r --contains 3eca633` is empty; `origin/main` tip is state commits like `ea18c83`), and the local branch is ahead 4 / behind 45. GitHub Actions therefore still runs the old code. `git pull --rebase` before pushing — main receives bot commits every ~10 minutes.
- Non-blocking observation to watch on the first live dispatch: the probe job keeps `timeout-minutes: 10` while its worst-case per-account wave count grew from 5 (3 legs + 2 ramp levels) to 8 (3 legs + 5 ramp levels). Against a slow-but-healthy endpoint (answers near the request timeout), 8 waves × several accounts could approach the 10-minute job cap; a job timeout kills the run before Commit ceilings, so the readings would be lost and re-measured next dispatch. If the first live probe shows long level times, lower `RAMP_MAX` or raise the job cap. The committed ceilings so far (`[4,2,4,1,4]`-shaped readings) suggest the endpoint refuses early, making this unlikely.

### Manual Testing Required:

Verified locally during this validation (offline, stronger than a log read — the ramp walk itself was executed against the shipped source):

- [x] Ramp walk behavior: doubling levels, stop-at-first-refusal, refusal reads `level/2`, failed leg returns 0, cap 32 — proven by an offline driver against the real `findConcurrencyCeiling` source (12/12 checks)
- [x] Probe fail-visible entry: exit 1 naming `LLM_ACCOUNTS` when the variable is absent
- [x] Workflow job graph: probe → watch serialization + schedule survival, structurally verified in the parsed YAML
- [x] Stale-term hygiene: every banned ramp phrase absent from code, workflow, docs, and guidance

Remaining — live Actions runs. All are blocked on commit + push (`git pull --rebase` first); the four Phase 5 items and the two carried Phase 3 items:

1. Dispatch job graph (Phase 5 manual item 1):
   - [ ] Trigger **Actions → watch → Run workflow**; confirm the job graph runs probe first and watch second — watch waited on the probe
2. Deep ramp readings (Phase 5 manual item 2):
   - [ ] In the probe log, confirm levels double 2→4→8… past 4 until refusal; confirm a `ceiling=N` reading > 4 lands when the endpoint allows it; confirm the same run's watch starts on the fresh readings with no per-account floor warnings
3. Scheduled tick survival (Phase 5 manual item 3):
   - [ ] On the next 10-minute cron tick, confirm the probe job is absent from the graph and watch is NOT skipped
4. Red-gate dispatch (Phase 5 manual item 4):
   - [ ] Temporarily add a rotten key to the `LLM_ACCOUNTS` secret, dispatch, confirm the probe reddens AND the watch is skipped for that dispatch (accepted cost: no digest), scheduled ticks unaffected; restore the secret
5. Green-gate commit-back (carried Phase 3 manual item 1 — with serialization, the "next watch run" is the same dispatch run's watch):
   - [ ] Confirm a `judge: probe-measured ceilings` commit lands on `main` with `state/judge-ceilings.json` (`state/` currently has no ceilings file anywhere — the file has never been committed), and the watch logs show no floor warnings and no 429 storm
6. Red-gate skip (carried Phase 3 manual item 2, optional — mutates a repo secret):
   - [ ] On the same rotten-key dispatch, confirm the Commit ceilings step is skipped and the committed file keeps its last green reading

### Recommendations:

- Ready to commit — the Phase 5 delta is complete, matches the plan, and all offline gates are green (`/skill:commit` next).
- Before pushing: `git pull --rebase` — the branch is behind 45 and main moves every ~10 minutes.
- After pushing: run one dispatch (item 1) and let the scheduled ticks cover item 3 by observation; items 2 and 5 land in the same dispatch's logs.
- Watch the first live probe's level timings against the 10-minute job cap (see Potential Issues).
