---
template_version: 1
date: 2026-11-06T20:06:06+0700
author: Yogiswara Utama
commit: 04424f5
branch: main
repository: loker-watcher
topic: "Validation of Spread LLM judge load across all accounts using probe-measured per-account ceilings"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-06_18-36-57_llm-account-spread-judge.md"
tags: [validation, plan, judge, judge-rotation, judge-ceilings, probe-judge, watch-workflow]
last_updated: 2026-11-06T20:06:06+0700
---

## Validation Report: Spread LLM judge load across all accounts using probe-measured per-account ceilings

### Implementation Status

- ✓ Phase 1: Ceilings module — Fully implemented
- ✓ Phase 2: Spread mechanism — Fully implemented
- ⚠️ Phase 3: Probe persistence + commit-back — Fully implemented in code; the two live-run manual criteria remain unverified (blocked on commit + push — GitHub `main` still runs the old code; see Manual Testing Required)
- ✓ Phase 4: Docs sync + validation — Fully implemented

### Automated Verification Results

- ✓ Type checking passes: `npm run typecheck` — exit 0
- ✓ Lint passes: `npm run lint` — 56 files checked, no errors
- ✓ Tests pass: `npm test` — 379/379 pass, 84 suites, 0 failures, 0 skipped
- ✓ Ceilings suite: `npx tsx --test tests/judge-ceilings.test.ts` — 13/13 pass (resolver matrix, degrade classes, atomic round-trip, failed-write error shape)
- ✓ Rotation + spread suite: `npx tsx --test tests/judge-rotation.test.ts` — 29/29 pass, including "first 5 judge calls of a 50-post run hit 5 distinct accounts (FRD acceptance)", per-account peak ≤ ceilings across both phases, the zero-charge park pin, and the cooling-designated-seat skip
- ✓ Commit-back suite: `npx tsx --test tests/commit-state-rebase.test.ts` — 6/6 pass, including both new pins ("skips a judge-ceilings conflict", "aborts a two-line conflict when one path is outside the state set")
- ✓ Retirement (code scope): `grep -rn "JUDGE_CONCURRENCY\|judgeConcurrency" src/ tests/` — 0 hits
- ✓ Retirement (workflow scope): `grep -n "JUDGE_CONCURRENCY" .github/workflows/watch.yml scripts/probe-judge.ts` — 0 hits
- ✓ Retirement (docs scope): `grep -rniE "judge_concurrency|judgeconcurrency" README.md AGENTS.md .rpiv/guidance/` — 0 hits
- ✓ Sync-point arithmetic: "6 of the 9 / 9 ENV_NAMES" — 0 hits; "5 of the 8 ENV_NAMES" matches at `.rpiv/guidance/.github/workflows/architecture.md:7`
- ✓ Stale single-invoker claims: "EXACTLY ONCE" and "ONLY invocation / invoked exactly once / the only persistence" — 0 hits across README, AGENTS, guidance
- ✓ Ceilings file named in all six doc surfaces: README 3, AGENTS 5, root guidance 4, src guidance 4, workflows guidance 10, scripts guidance 4
- ✓ Probe live-only ordering: `writeCeilingsAtomic` at `scripts/probe-judge.ts:259` sits before the dead gate at `:263`
- ✓ Mirror completeness: `ceilingWaiters` present in both test mirrors (tests/judge-rotation.test.ts ×3, tests/judge.test.ts ×1)
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- `src/judge-ceilings.ts` — matches the plan's Phase 1 module verbatim: pure `resolveCeilings` returning warnings, `loadAccountCeilings` with the quiet-ENOENT / reason-warn degrade classes, `writeCeilingsAtomic` with temp+rename and the `ceilings: atomic write failed for <target>` error shape; floor warning names the baseUrl and points at the probe-committed file
- `src/config.ts:74` — `JUDGE_CEILINGS_PATH` with the single-writer docblock; `ENV_NAMES` (lines 14–23) carries 8 entries, `judgeConcurrency` deleted
- `src/judge-rotation.ts` — `RotationState` has all 7 required members (ceilings :61, inFlight :65, dispatchCounter :69, ceilingWaiters :73); `pickEligibleAccount` scans from `startAt ?? state.dispatchCounter % poolSize` and never advances the dial; `claimAccount` (:177, in-flight bump + dial advance), `releaseAccount` (:190, zero-clamp + wake), `waitCeilingSlot` (:208, zero-charge deferred), `earliestCooldown` (:222); fresh-stamp wake in `coolAccount` (:147), re-stamp silent
- `src/judge.ts` — `AttemptDirective<T>` union (:288), frame-local `pinnedStart` seat (:375, cleared at :382, set at :498), pick→claim in the pre-await sync window, `releaseAccount` in the attempt's finally (:476), zero-charge `waitCeilingSlot` park on the all-at-ceiling flavor (:396) with the cooldown flavor routed OUTSIDE the try (:391), `judgePosts` takes the `ceilings` parameter and derives `width = Math.max(1, Σ ceilings)` (:756) feeding both `runPool` calls; `DEFAULT_JUDGE_CONCURRENCY` and `parseJudgeConcurrency` fully deleted
- `src/index.ts` — `judgeCeilings?` seam directly after `linkedinFetch` (:117); judge stage resolves through `(deps.judgeCeilings ?? loadAccountCeilings)` (:275) and passes the map to `judgePosts` (:282)
- `scripts/probe-judge.ts` — per-account reading recorded inside the loop with the trimmed-baseUrl key (:241–243), `writeCeilingsAtomic` + committed-count log (:258–261) before the dead gate (:263); knob clause replaced by the Revision 2026-11-06 paragraph
- `.github/workflows/watch.yml` — probe job: `fetch-depth: 0` with the merge-base comment, Commit ceilings step with the `[-f]` guard, no-op guard, `judge: probe-measured ceilings` commit, then `bash scripts/commit-state-rebase.sh`; watch job head comment formulaic (Σ per-account ceilings); Run watcher env block has no `JUDGE_CONCURRENCY` literal and `HEARTBEAT_ENABLED` first
- `scripts/commit-state-rebase.sh` — skip test is set membership over `"" | state/seen-posts.json | state/judge-ceilings.json` (:59) via a heredoc conflict list (:55), `all_state` flag, non-state abort loud (:65–67); shebang, 50-skip bound, lease push, one-retry tail byte-unchanged; deviation ledger carries the second-deviation entry
- Docs — all six surfaces carry the planned hunks: root guidance two-files story + doctrine line; src guidance 7-member rotation fence (verified verbatim) + re-keyed "Adding an LLM Account"; workflows guidance Commit ceilings block + pluralized invoker prose; scripts guidance two-invoker contract + persistence excerpt + re-keyed important-if; README operator story ("Nothing to paste" at :87); AGENTS spread bullets + new `src/judge-ceilings.ts` bullet
- Heading routes exist: "Running the Judge Probe and Applying the Reading" at `.rpiv/guidance/scripts/architecture.md:99`; "The probe job: a gate that walks every account" at `.rpiv/guidance/.github/workflows/architecture.md:101`

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ `src/judge-ceilings.ts` mirrors the `src/state.ts` writer precedent exactly: identical `node:fs/promises` import set (mkdir/readFile/rename/unlink/writeFile), `dirname`, `stateTempPath` reuse, temp+rename with best-effort unlink, error message naming the target
- ✓ The degrade-everything reader matches the `src/linkedin-payload.ts` doctrine: console.warn reasons, never throws, absence is the normal first-run state
- ✓ Tests follow repo idiom: `node:test` + `assert/strict`, lazy temp dir per suite (the `tests/state.test.ts` idiom), `t.mock.method(console, "warn")` capture, `BASH_PROBLEM` skip gating for the bash-resolution tests

#### Potential Issues:

- Non-blocking observation: `main` receives bot commits roughly every 10 minutes — `gh run list` shows a steady cadence of `workflow_dispatch` runs of watch.yml (one was in flight during validation). These runs execute the OLD code until the implementation lands, and they will rebase-conflict nothing, but a commit+push from this tree should `git pull --rebase` first. After the push, the next dispatch automatically exercises the new probe job — the green-gate manual item becomes observation-only.

### Manual Testing Required:

Verified locally during this validation (structural checks, stronger than a log diff — the operator-facing wording comes from code, and the code shows no string-literal changes):

- [x] D2 operator-log byte-compat: `git diff HEAD -- src/judge.ts` contains only docblock replacements and indentation moves; `warns.cooling` / `warns.statusFailure` / `warns.transportError` / `warns.backingOff` call sites carry identical arguments and no warn-string literal changed
- [x] Phase 1 floor-warning wording names the baseUrl and points at the probe-committed file: `judge: no usable ceiling for <baseUrl> — capping at 1 (slow waves until the probe commits state/judge-ceilings.json)`
- [x] `judge-rotation.ts` module docblock reads coherently: cooldown model + spread model paragraphs, no contradiction (dial, zero-charge wait, fresh-stamp wake all stated once)
- [x] Phase 4 doc checks: rotation fence quotes the 7-member `RotationState`; README intro + Setup tell one dispatch-the-probe story; commit-back story consistent across workflows guidance, scripts guidance, and the `.sh` header; re-keyed important-if blocks route to sections that exist

Remaining — live Actions runs. Both require the implementation to be committed and pushed first (GitHub `main` runs the old code until then):

1. Green-gate probe (plan Phase 3 manual item 1):
   - [ ] Push the implementation (`git pull --rebase` first — main moves every ~10 min), then watch the next dispatch (they fire every ~10 min) or run `gh workflow run watch.yml`
   - [ ] Confirm the run greens, a `judge: probe-measured ceilings` commit lands on `main` with `state/judge-ceilings.json`, and the next watch run's judge logs show no per-account floor warnings and no 429 storm
2. Red-gate probe (plan Phase 3 manual item 2 — optional, mutates a repo secret):
   - [ ] Temporarily add a rotten key to the `LLM_ACCOUNTS` secret, dispatch, confirm the run reddens at "Probe judge latency" AND the "Commit ceilings" step is skipped, then restore the secret

### Recommendations:

- Ready to commit — implementation is complete and validated (`/skill:commit` next).
- Before pushing: `git pull --rebase` — a dispatch-triggered state commit can land between now and the push.
- After pushing: the green-gate manual item self-executes on the next ~10-minute dispatch — just observe it. The red-gate item is optional and edits the `LLM_ACCOUNTS` secret; do it only if you want the skip path proven live.
