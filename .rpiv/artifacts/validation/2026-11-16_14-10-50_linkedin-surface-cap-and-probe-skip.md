---
template_version: 1
date: 2026-11-16T14:10:50+0700
author: Yogiswara Utama
commit: 9bfdf69
branch: ukind/fix-limited-linkedin
repository: fix-limited-linkedin
topic: "Validation of LinkedIn surface cap removal and probe thin-surface skip"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-16_13-09-01_linkedin-surface-cap-and-probe-skip.md"
tags: [validation, plan, config-file, probe-linkedin, linkedin-chain]
last_updated: 2026-11-16T14:10:50+0700
---

## Validation Report: LinkedIn surface cap removal and probe thin-surface skip

### Implementation Status

- ✓ Phase 1: Config surface-count rule (>= 1) — Fully implemented
- ✓ Phase 2: Probe first-pass-wins loop — Fully implemented

### Automated Verification Results

- ✓ Config suite: `npx tsx --test tests/config-file.test.ts` — 48 tests, 48 pass, 0 fail
- ✓ Stale-constant oracle: `grep -rn "LINKEDIN_SURFACE_COUNT" src/ scripts/ tests/` — no matches
- ✓ Stale-message oracle: `grep -rn "exactly 5 are required" src/ tests/` — no matches
- ✓ Stale-spread-pin oracle: `grep -n "committed spread" tests/config-file.test.ts` — no matches
- ✓ Probe suite: `npx tsx --test tests/probe-linkedin.test.ts` — 12 tests, 12 pass, 0 fail
- ✓ Chain suite untouched and green: `npx tsx --test tests/linkedin-chain.test.ts` — 11 tests, 11 pass, 0 fail; `git diff 408eead..HEAD -- tests/linkedin-chain.test.ts` is empty
- ✓ Type check: `npm run typecheck` — clean, no output
- ✓ Lint: `npm run lint` — 78 files checked, no fixes applied
- ✓ Full suite: `npm test` — 646 tests, 646 pass, 0 fail, 154 suites; no `captures/` directory created at the repo root
- ✓ Floor-message oracle: `grep -rn "pagination did not prove out" src/ scripts/ tests/probe-linkedin.test.ts` — no matches
- ✓ CLI arms byte-identical: `git diff 408eead..HEAD -- scripts/probe-linkedin.ts` — zero `+`/`-` lines touching `isHalt`/`isLegDead`/`isAllSurfacesFaulted`/`isProbeNoSurfaces`/`isProbeFloor`/`console.error`/`process.exit`/`runProbe().catch`; the diff ends at `runProbe`'s closing brace
- ✓ No regressions detected — base 408eead measured: 643 tests / 641 pass / 2 fail; delta -> 646/646. Both base failures are fixed by this run: the stale FRD-five spread pin (Phase 1 deletes it) and the `captures/` absence-oracle failure in `tests/fetch-linkedin.test.ts` (the capture fix). The base run also recreated `captures/` in its worktree, confirming the leak predates this change.

### Code Review Findings

#### Matches Plan:

- `src/config-file.ts` — the FR-8 comment block and `LINKEDIN_SURFACE_COUNT` are deleted with one adjacent blank line (Biome-clean); the count check is now `linkedinCount < 1` with the message `config: <path> has N linkedin surfaces — at least 1 is required`, and it sits after the empty-array rule so it owns only the non-empty zero-linkedin shape.
- `tests/config-file.test.ts` — the suite is re-pinned to `linkedin surface count (at least one)`: acceptances for 1, 4, 5, and 6 surfaces plus the mixed threads case; the zero-linkedin rejection pins the new message; the committed-spread pin is deleted, and the trailing comment avoids the literal `committed spread` so the oracle stays clean.
- `scripts/probe-linkedin.ts` — header docstring rewritten to config-order first-pass-wins; `import type { Post }` added after the linkedin-session import; `probeFloor(message: string)` takes the message while keeping the `PROBE_FLOOR` tag; `SkippedSurface` sits directly above `runProbe`; the old `runProbe` docstring is deleted with the function (no stale rationale stacked above the new one).
- `scripts/probe-linkedin.ts` loop semantics — filter + zero guard + env + cookie preflight + `minClicks` + `now` stay before the loop; `captureSink` hoists above it (one session stamp per run); per-keyword banner and clock; one `fetchLinkedInPosts([surface], {...})` per keyword; the catch rethrows halt/leg-dead/plain errors and converts all-faulted to a fault-skip line; thin-skip below the floor; pass path returns on the first clearing keyword; the terminal builds the per-keyword report and throws `probeFloor`.
- `tests/probe-linkedin.test.ts` — header behavior list updated; `configWithSurfaces` helper added after the CONFIG literal; `contextFactoryFor` serves per-build scripts; the pass-path pin is the bare `probe: N post(s)` form; the new `runProbe keyword loop` describe covers first-pass-wins and fault-skip; the `runProbe gate arms` describe covers halt/leg-dead/plain-error rethrows and the all-thin/all-faulted/mixed terminals; the two superseded tests are removed.
- `tests/fetch-linkedin.test.ts` — the seen-stop tick case injects `captureSink: capture` and pins the one record it rides, matching the suite's own recordingSink doctrine.

#### Deviations from Plan:

- `tests/fetch-linkedin.test.ts` (+9 lines) is a 5th file outside the plan's declared write-set (both phases' `files:` union to 4 files). User-authorized during the run: the seen-stop test drove a body-firing walk without a sink, so the production fs sink wrote `captures/` at the repo root on every `npm test` and the suite's own absence oracle failed from a clean tree. Proven pre-existing on HEAD (with the plan's 4 files stashed, the base tree fails identically and recreates `captures/`). Committed separately as `9bfdf69` so history keeps the two reasons distinct. Non-blocking — the owning phase's `files:` list is incomplete, not the implementation.
- Phase 2's manual criterion "The default capture path mints ONE `captures/<stamp>/` directory across several keywords (hoisted sink)" is checked, but the evidence is sink-level, not end-to-end: one shared `makeFsCaptureSink` across two walks mints exactly one session directory with two bodies. An end-to-end attempt through `runProbe` walked two keywords correctly but left no `captures/` before process exit, because `captureOnce` in `src/linkedin-capture.ts` is fire-and-forget. The hoist semantics are proven; the CLI-observable outcome is not. Low severity, non-blocking.

#### Pattern Conformance:

- ✓ Imports, tagged-error idiom (name constant + factory + type guard), test structure (describe per behavior, `t.mock.method` call-through spies, pinned clocks, OS-temp-only writes), and the `.js` specifier convention all follow the established codebase patterns.
- ✓ The new `SkippedSurface` interface is local to `scripts/probe-linkedin.ts` and unexported, matching how the file keeps its gates local.
- Minor observation: `probeFloor` now takes a `message` parameter, so the fixed floor text lives at the call site rather than inside the factory. This is the plan's explicit design and keeps the CLI's bare-print arm byte-identical — acceptable variation, not a deviation.

#### Potential Issues:

- Four stale "first configured surface" statements survive in docs: `.rpiv/guidance/architecture.md:43`, `.rpiv/guidance/scripts/architecture.md:43`, `README.md:320`, and `AGENTS.md:36`/`AGENTS.md:122`. The plan explicitly defers all docs to a follow-up commit per the `9fded75` pattern, so these are comment-only and do not affect the verdict. They should land in the docs follow-up before the next operator reads them.
- `README.md:376`'s "The five LinkedIn leg entries" is accurate (five npm scripts, not five surfaces) and needs no change.

### Manual Testing Required:

1. Live probe against the real profile with the 5-keyword config — read the thin-skip and pass lines:
   - [ ] `npm run probe-linkedin` — a thin first keyword logs `probe: <keyword> — N post(s), below the 10-post floor; trying the next surface` and the walk moves on
   - [ ] A faulted keyword logs the fault line naming the keyword and the aggregate message, then moves on
   - [ ] A checkpoint URL aborts instantly — no banner for the second keyword
   - [ ] The all-exhausted terminal prints one line naming every keyword and its count
   - [ ] The default capture path mints ONE `captures/<stamp>/` directory across several keywords (offline-equivalent evidence recorded above; the live run is the confirmation)
2. End-to-end operator chain once after the probe change:
   - [ ] `npm run linkedin-chain` — login hold -> probe -> exactly one tick, in order
3. Config rule against the live file:
   - [ ] A threads-only `watcher.config.json` (0 linkedin) fails `npm start` with a message naming the count (offline-equivalent evidence recorded: `has 0 linkedin surfaces — at least 1 is required`)
   - [ ] Adding a 6th linkedin keyword passes config validation (offline-equivalent evidence recorded: 6 surfaces load, 7 total); revert the edit after

### Recommendations:

- Land the docs follow-up commit updating the four stale "first configured surface" statements to the first-pass-wins loop description.
- Keep `tests/fetch-linkedin.test.ts` in its own commit (`9bfdf69`) — it is a real defect fix with its own rationale, not plan scope creep.
- Ready for push and PR — implementation is complete and validated; both commits (`22a6324`, `9bfdf69`) are already on `ukind/fix-limited-linkedin`.
