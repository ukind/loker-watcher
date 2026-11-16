---
date: 2026-11-16T10:35:30+0700
author: Yogiswara Utama
commit: 408eead
branch: ukind/fix-limited-linkedin
repository: fix-limited-linkedin
topic: "LinkedIn surface cap removal and probe thin-surface skip"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, probe-linkedin, config-file, linkedin-chain]
last_updated: 2026-11-16T10:35:30+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: LinkedIn surface cap removal and probe thin-surface skip

**Date**: 2026-11-16T10:35:30+0700
**Author**: Yogiswara Utama
**Commit**: 408eead
**Branch**: ukind/fix-limited-linkedin
**Repository**: fix-limited-linkedin

## Research Question
Chain from `.rpiv/artifacts/research/2026-11-16_09-38-22_linkedin-surface-cap-and-probe-skip.md`. Two edits: (1) replace the exact-5 linkedin-surface check (`src/config-file.ts:210-215`) with a >= 1 check; (2) convert the probe's single `surfaces[0]` read (`scripts/probe-linkedin.ts:153`) into an ordered loop that skips thin and faulted keywords and stops at the first keyword clearing `PROBE_MIN_POSTS` = 10 (first-pass-wins).

## Summary
**Problem**: The config caps linkedin keywords at exactly 5, and the probe gate walks only the first keyword. A thin first keyword fails the gate even when a later keyword clears the floor.
**Recommended**: Option 1, Inline loop in runProbe — replay the walk's own skip-and-continue idiom sequentially inside `runProbe`. `ProbeResult` keeps its shape, so the chain compiles unedited.
**Effort**: Med (code + tests about half a day; docs sweep is a planned follow-up commit, about 1 hour).
**Confidence**: High

## Problem Statement

**Requirements:**
- Config accepts 1 or more linkedin surfaces. Zero linkedin still rejects with a message that names the count.
- The probe walks keywords in config order. A thin keyword (< 10 posts) logs one line and the probe moves on.
- A faulted keyword logs one line and the probe moves on. Halt and leg-dead stay instant aborts.
- First pass wins: the gate passes on the first keyword with >= 10 posts.
- Exit 1 only when every keyword is thin or faulted.

**Constraints:**
- Byte-stable CLI exit arms (`scripts/probe-linkedin.ts:199-223`), arm for arm.
- Side-effect-free import of the script (entry guard; the ea11969 lesson).
- The walk seam stays untouched: no context hand-off, no per-surface results out of `fetchLinkedInPosts`.
- `ProbeResult {postCount, elapsedMs}` feeds the chain (`scripts/linkedin-chain.ts:66`, `:123-127`); the shape is pinned (`tests/linkedin-chain.test.ts:37`).
- Strict TS flags stay on. Tests stay offline (node:test + tsx). No new runtime deps.

**Success criteria:**
- `npm run typecheck && npm run lint && npm test` green.
- A thin first keyword no longer fails the probe when a later keyword clears 10 posts.
- Config with 6 linkedin surfaces validates; zero linkedin still rejects.

## Current State

**Existing implementation:**
- The cap: `LINKEDIN_SURFACE_COUNT = 5` (`src/config-file.ts:80`), enforced by `!==` at `:210-215`. Three code hits total, one file. No runtime consumer counts; every consumer partitions and zero-guards (`src/index.ts:257-263`, `scripts/fetch-linkedin.ts:361-368`, `scripts/probe-linkedin.ts:147-153`).
- The probe: `runProbe` (`scripts/probe-linkedin.ts:145-192`) picks `surfaces[0]` (`:153`), makes one `fetchLinkedInPosts([surface])` call (`:175-184`), and throws the local floor gate below 10 posts (`:187-189`; `PROBE_MIN_POSTS = 10` at `:56`).
- Error families: disjoint `name` constants, one producer each (`src/linkedin-context.ts:21-95`). The walk's join precedence is halt > leg-dead > all-faulted (`src/linkedin-fetch.ts:331-339`). A one-surface array faults as `AllSurfacesFaulted` with `faulted === 1`.
- Thin is a return, not a throw: the walk exits dry (`src/linkedin-walk.ts:394-400`); the probe manufactures the failure itself (`scripts/probe-linkedin.ts:187-189`).
- Pacing: one gate per `fetchLinkedInPosts` call (`src/linkedin-fetch.ts:256`); the `scrollRounds` cap is per-surface (`src/linkedin-walk.ts:308`). The 5-figure is descriptive only; durations are fleet-additive.
- Browser shape (developer decision): N launches, one per keyword. `fetchLinkedInPosts` builds and closes its own context per call (`src/linkedin-fetch.ts:255`, `:325-327`).

**Relevant patterns:**
- Tagged-error idiom (name constant + factory + type guard): `scripts/probe-linkedin.ts:47-106` (2 probe gates), `src/linkedin-context.ts:21-95` (3 families).
- Skip-and-continue worker loop: `src/linkedin-fetch.ts:276-321` — the direct template (halt arm `:304-311`, leg-dead arm `:312-319`, fault arm counts and continues `:320-322`).
- Result-riding reports: `RotationExhausted.failures` in config order (`src/judge-rotation.ts:132-139`), `TickOutcomes` (`src/judge-health.ts:62-70`), `ChainResult` (`scripts/linkedin-chain.ts:58-70`).

**Integration points:**
- `scripts/probe-linkedin.ts:153` — the single read to replace.
- `src/config-file.ts:210-215` — the check to rewrite; the empty-array throw at `:172-174` stays generic.
- `scripts/linkedin-chain.ts:106`, `:123-127` — stale banner + summary wording (docs follow-up).
- `scripts/probe-linkedin.ts:199-223` — the CLI exit arms to preserve.

## Solution Options

### Option 1: Inline loop in runProbe (Recommended)
**How it works:**
An ordered for-loop replaces `scripts/probe-linkedin.ts:153` through `:191`. Each keyword gets one `fetchLinkedInPosts([surface])` call. The per-keyword catch rethrows `isHalt` and `isLegDead`, converts `isAllSurfacesFaulted` (`faulted === 1`) to a fault-skip line, and turns a normal return below 10 posts into a thin-skip line (keyword + count). The first keyword at >= 10 posts prints the result line and pass line and returns. After the loop, the all-thin/all-faulted terminal rethrows the `probeFloor` tag with the loop-scope keyword list, so the CLI floor arm (`:216-219`) survives. The cap edit replaces `src/config-file.ts:210-215` with a >= 1 guard and the message `config: <path> has N linkedin surfaces — at least 1 is required`. The FR-8 comment (`:73-79`) and the constant (`:80`) die in the same edit.

**Pros:**
- Smallest diff: one contiguous ~40-line hunk in the probe + one edit block in config-file.
- `ProbeResult` unchanged, so the chain compiles and runs unedited.
- 4 of 7 probe test pins survive verbatim; 2 move unconditionally; 1 is conditional on the terminal wording.
- The error taxonomy has an in-repo template one layer down (`src/linkedin-fetch.ts:303-321`).

**Cons:**
- Classification lives inline; the loop body is the densest new logic in one function.
- The chain summary cannot name the winning keyword (no report rides out).

**Complexity:** Low (~0.5 day)
- Files to create: 0
- Files to modify: 2 production (~50 lines), 2 test files (~60 lines), docs follow-up (7-9 strings)
- Risk level: Low

### Option 2: Per-keyword attempt helper
**How it works:**
Extract `attemptKeyword(surface, ...knobs)` returning a `thin | faulted | passed` outcome. `runProbe` becomes a thin sequencer over the ordered surfaces; the floor throw flips to a `thin` outcome; halt/leg-dead rethrow from inside the helper.

**Pros:**
- The sequencer shape has an in-repo precedent: `runLinkedInChain` is an injectable-leg sequencer (`scripts/linkedin-chain.ts:85-110`).
- Each outcome is directly unit-testable without driving the loop.
- Same CLI-arm preservation as Option 1 when the terminal reuses the `probeFloor` tag.

**Cons:**
- No extracted-helper precedent exists for probe gates; the script-layer convention is one exported `run*` function (`runProbe`, `fetchTick`, `runLinkedInChain`).
- New injection surface: the helper needs config, env, factory, sink, minClicks, and clock threaded as explicit params (`ProbeDeps` at `scripts/probe-linkedin.ts:44-100` has no such seam).
- The test payoff overlaps: the existing offline doubles already reach every outcome through `runProbe`.

**Complexity:** Med (~0.5-1 day)
- Files to create: 0
- Files to modify: 2 production (~70 lines), 2 test files
- Risk level: Low-Med (one more seam to keep consistent)

### Option 3: Loop report accumulator
**How it works:**
Each attempt appends `{keyword, outcome, postCount, elapsedMs, error?}` to a report. `runProbe` renders pass and terminal lines from the report. `ProbeResult` widens to carry the report; the chain summary names the winning keyword.

**Pros:**
- Strong precedent family: `RotationExhausted.failures` carries ordered per-account causes (`src/judge-rotation.ts:132-139`); `TickOutcomes` (`src/judge-health.ts:62-70`); `ChainResult` itself.
- Best diagnostics: the terminal can enumerate every skipped keyword with its outcome (the `6493f2a`/`cd2297f` lesson: thin needs the why).
- The chain summary can name the winning keyword.

**Cons:**
- Widening `ProbeResult` breaks 2 pinned literals by type (`tests/probe-linkedin.test.ts:278` deepEqual; `tests/linkedin-chain.test.ts:37` PROBE_PASS) and moves the chain summary regex pins (`tests/linkedin-chain.test.ts:104-108`, `:217-218`).
- About 9 moved or dead tests across 3 files — the largest churn.
- Naming the keyword in the chain summary is outside declared scope (code fix only; the wording sweep is a planned docs follow-up).
- `elapsedMs` needs an explicit per-attempt vs whole-run decision.

**Complexity:** Med-High (~1-1.5 days)
- Files to create: 0
- Files to modify: 3 production (probe, chain, config), 3 test files
- Risk level: Med (a type seam and two output contracts move together)

## Comparison

| Criteria | Option 1 Inline loop | Option 2 Attempt helper | Option 3 Report accumulator |
|----------|----------|----------|----------|
| Complexity | L | M | M-H |
| Codebase fit | H (walk-catch template) | M (no helper precedent) | H (report family), churn H |
| Risk | L | L-M | M |
| Test pins moved | 2 (+1 conditional) | 3-4 | ~9 |
| Chain file edited | no | no | yes |

## Recommendation

**Selected:** Option 1 — Inline loop in runProbe.

**Rationale:**
- The research prescribes exactly this shape; it is the smallest change that fully solves both requirements.
- Precedent-fit is strongest where it matters — at the throw and skip boundary, with `src/linkedin-fetch.ts:303-321` as the direct template.
- `ProbeResult` keeps its pinned shape: the chain compiles unedited and 4 of 7 probe pins survive verbatim.
- Option 2's payoff (isolated classification tests) arrives through the same integration tests at lower cost. Option 3's payoff (named keyword in the chain summary) is out of scope by developer decision.

**Why not alternatives:**
- Option 2: adds an injection seam with no coverage gain — the offline doubles already reach every outcome through `runProbe`.
- Option 3: moves ~9 pins and widens a cross-script type for a benefit the docs follow-up can revisit. Re-open it if the operator wants the winning keyword in the chain summary.

**Trade-offs:**
- Accepting no keyword name in the chain summary for the smallest diff and a byte-stable chain contract.
- Accepting denser inline classification for zero new seams.

**Implementation approach:**
1. Cap removal — rewrite `src/config-file.ts:73-80` (comment + constant die), replace `:210-215` with the >= 1 guard and the new message. Re-pin rejects-four and rejects-six into acceptances, re-pin rejects-zero to the new message, and delete the red spread pin (`tests/config-file.test.ts:399-409`; confirmed 47 pass / 1 fail on 2026-11-16T10:27+0700).
2. Probe loop — replace `scripts/probe-linkedin.ts:153`-`:191` with the ordered loop. Hoist the capture-sink default (`:183`) above the loop. Move the banner and the floor check inside. Add the per-keyword catch (thin skip, fault skip, halt and leg-dead rethrow). Add the all-thin/all-faulted terminal that rethrows `probeFloor` with the keyword list. Reset the clock per keyword.
3. Tests — extend `contextFactoryFor` with a per-build script table (about 5 lines, keyed by the existing `built` counter). Add thin-skip, fault-skip, halt rethrow (asserts no attempt 2), leg-dead rethrow, all-thin terminal, and first-pass-wins early exit. Re-pin the single-fault pin (`tests/probe-linkedin.test.ts:355-368`) to skip or terminal semantics.
4. Docs follow-up commit (the `9fded75` pattern) — probe module docs (`scripts/probe-linkedin.ts:6-7`, `:11`, `:26-28`, `:135-144`), chain module doc + banner (`scripts/linkedin-chain.ts:10-11`, `:106`), README (`:301-303`, `:319-323`, `:380`, `:382`), the guidance pins, and the worst-case formula (`src/linkedin-behavior.ts:16-20`) with the N057 numbers.

**Integration points:**
- `src/config-file.ts:210-215` — the >= 1 rewrite; `:172-174` stays generic.
- `scripts/probe-linkedin.ts:153`, `:175-191` — the loop conversion span.
- `scripts/probe-linkedin.ts:183` — the capture-sink default must hoist above the loop.
- `scripts/probe-linkedin.ts:216-219` — the floor arm survives through terminal tag reuse.

**Patterns to follow:**
- Worker fault-skip arms: `src/linkedin-fetch.ts:303-321`.
- Tagged gates: `scripts/probe-linkedin.ts:47-106`.
- Code commit + docs-only follow-up: `f0340d7` then `9fded75`.

**Risks:**
- Capture sink per attempt: the default at `scripts/probe-linkedin.ts:183` evaluated inside the loop mints N session stamps and N `captures/<stamp>/` dirs (lazy stamp, `src/linkedin-capture.ts:166`). Mitigation: hoist the default above the loop; the injected-sink pins keep working.
- Shared pacing gate: one shared gate across attempts would add a real 5-15 s sleep in offline tests (`ProbeDeps` has no sleep injectable). Mitigation: keep the per-call gates (`src/linkedin-fetch.ts:256`) — the default behavior already does this.
- Plain Errors: a `contextFactory` rejection (`src/linkedin-fetch.ts:255`) and a `context.close()` rejection (`:325-327`) escape as plain Errors. Policy: rethrow — a factory failure recurs for every keyword, and the CLI fallback arm (`:220-222`) already renders it fail-visible.

## Scope Boundaries
- Building: the >= 1 config check with its message; the ordered first-pass-wins probe loop with thin and fault skips; halt and leg-dead aborts; the all-thin/all-faulted terminal; the test updates.
- NOT doing: no config keyword additions (the operator edits `watcher.config.json` later); no walk-seam changes (no context hand-off, no per-surface results); no chain summary changes; no README or guidance edits in the code commit; no new runtime deps.

## Testing Strategy

**Unit tests:**
- Thin-skip: keyword 1 mints 3 posts, keyword 2 mints 12 → resolves `postCount: 12`, `built.value === 2`, one thin log line.
- Fault-skip: keyword 1 `gotoError`, keyword 2 mints 12 → resolves 12, one fault log line, `built.value === 2`.
- Halt rethrow: keyword 1 checkpoint URL → `isHalt` with `HALT_CHECKPOINT_REASON`, `built.value === 1`.
- Leg-dead rethrow: keyword 1 silent script → `isLegDead`, `built.value === 1`.
- All-thin terminal: keywords mint 3 and 4 → rejects with `isProbeFloor`, message names both keywords.
- First-pass-wins: keyword 1 mints 12 → `built.value === 1`; keyword 2 never builds.
- All-faulted terminal: both keywords `gotoError` → the terminal names both (optional).
- Config: accepts 1 surface; accepts 6 surfaces; rejects zero linkedin with the new message; rejects an empty array unchanged.

**Integration tests:**
- None beyond the suite: the doubles drive the real walk stack offline (zero network, zero browser), per the suite header contract.

**Manual verification:**
- [ ] `npm run probe-linkedin` against the live profile with the real 5-keyword config — read the skip lines and the pass line.
- [ ] `npm run linkedin-chain` end to end once after the probe change.

## Open Questions

**Resolved during research:**
- Pacing arithmetic: the click cap is per-surface (`src/linkedin-walk.ts:308`), the rate gate is N-invariant, durations are fleet-additive. The 5 is descriptive only.
- The committed-spread pin: delete (`tests/config-file.test.ts:399-409`). Confirmed red before the decision (47 pass / 1 fail, 2026-11-16T10:27+0700).
- Browser shape: N launches, one per keyword (developer decision).
- The zero-linkedin message split: keep (`src/config-file.ts:172-174` generic; the count message owns the non-empty zero-linkedin shape).

**Requires user input (defaults stated for design):**
- Duplicate keywords in config: default — dedupe the loop input with one warn line (mirrors `warnDuplicateSurfaces`), preventing the silent capture overwrite (`src/linkedin-capture.ts:185-193`).
- Terminal tag and message: default — reuse the `probeFloor` tag with new text that lists the skipped keywords, so the CLI floor arm (`:216-219`) survives. A new tag means a new CLI arm and a moved message pin (`tests/probe-linkedin.test.ts:313`).
- Docs sweep timing: default — one docs-only follow-up commit, per the `9fded75` pattern.

**Blockers:**
- None.

## References

- `.rpiv/artifacts/research/2026-11-16_09-38-22_linkedin-surface-cap-and-probe-skip.md` — the full evidence base behind every file:line cited here.
- `.rpiv/artifacts/discover/2026-11-16_09-00-43_linkedin-surface-cap-and-probe-skip.md` — the FRD this chain serves.
- `src/linkedin-fetch.ts:276-339` — the loop's error-taxonomy template and join precedence.
- `scripts/probe-linkedin.ts:145-223` — the conversion site, the local gates, and the CLI arms.
- `src/config-file.ts:168-218` — the guard chain (order is load-bearing).
- `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md` — the code-commit + docs-follow-up pattern.
- `.rpiv/artifacts/plans/2026-11-12_15-41-06_linkedin-operator-chain.md` — the side-effect-free-import lesson.
