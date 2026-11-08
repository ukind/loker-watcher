---
date: 2026-11-07T08:49:53+0700
author: Yogiswara Utama
commit: c647e0f
branch: main
repository: loker-watcher
topic: provider-health-module-boundary
tags: [plans, judge-health, judge-rotation, judge, judge-ceilings, email, heartbeat, watch-workflow, commit-state-rebase]
status: ready
parent: ".rpiv/artifacts/solutions/2026-11-07_08-22-22_provider-health-module-boundary.md"
phase_count: 9
phases:
  - { n: 1, title: Health module, files: [src/judge-health.ts, src/config.ts], depends_on: [] }
  - { n: 2, title: Health module tests, files: [tests/judge-health.test.ts], depends_on: [1] }
  - { n: 3, title: Rotation fields + inline pick, files: [src/judge-rotation.ts, src/judge.ts, tests/judge-rotation.test.ts, tests/judge.test.ts], depends_on: [1] }
  - { n: 4, title: Judge core stamps + hang arm, files: [src/judge.ts, src/judge-rotation.ts, tests/judge.test.ts], depends_on: [3] }
  - { n: 5, title: Email + heartbeat riders, files: [src/email.ts, src/heartbeat.ts, tests/email.test.ts, tests/heartbeat.test.ts], depends_on: [1] }
  - { n: 6, title: Entry wiring, files: [src/index.ts, tests/index.test.ts], depends_on: [1, 3, 4, 5] }
  - { n: 7, title: Workflow + commit-back, files: [.github/workflows/watch.yml, scripts/commit-state-rebase.sh, tests/commit-state-rebase.test.ts], depends_on: [6] }
  - { n: 8, title: Docs sync + repo-wide gates, files: [README.md, AGENTS.md, .rpiv/guidance/architecture.md, .rpiv/guidance/src/architecture.md, .rpiv/guidance/.github/workflows/architecture.md, .rpiv/guidance/scripts/architecture.md, .rpiv/guidance/tests/architecture.md, scripts/commit-state-rebase.sh], depends_on: [7] }
  - { n: 9, title: Probe freshness gate, files: [.github/workflows/watch.yml, scripts/probe-judge.ts, src/judge-ceilings.ts, tests/judge-ceilings.test.ts, README.md, .rpiv/guidance/.github/workflows/architecture.md], depends_on: [7] }
unresolved_phase_count: 0
last_updated: 2026-11-07T17:28:58+0700
last_updated_by: Yogiswara Utama
last_updated_note: Phase 9 (probe freshness gate) - 8h success-gated probe cadence, probedAt clock, force input
---

# Provider Health Circuit (judge-health module boundary) Implementation Plan

## Overview

Build the provider health circuit on the module boundary the solutions artifact settled: a new `src/judge-health.ts`, shaped like `src/judge-ceilings.ts` (pure resolver, never-throw reader, atomic writer in `src/`), owning the committed `state/judge-health.json` envelope, the per-account outcome ledger helpers, and the episode-bit helpers. `RotationState` gains three plain fields — the half-open predicate lives inline in `pickEligibleAccount`, so `judge-rotation.ts` never imports the new module and keeps its zero-runtime-import identity. `judge.ts` stamps real failure causes at the four attempt-branch sites, closes the all-health-blocked hang with a third flavor arm, and the health flush lives ONLY in main's entry-module catch so the all-429 compatibility pin survives untouched.

## Requirements

- Per-account health marks persist across 10-minute ticks in a committed state file, `state/judge-health.json`, single-writer doctrine (the watch run writes; the workflow commits back).
- An account that hard-fails (5xx terminal / transport error / 401 / 403 — never 429) in 2 consecutive ticks is capped at ceiling 1.
- Half-open probe: exactly 1 dispatch per tick for a capped account (`probedThisTick` ledger); a successful probe clears the in-run block and the account rejoins at its committed ceiling for the rest of the tick (developer-confirmed cap seam).
- Exhaustion alarms carry each account's real cause ("HTTP 503", "HTTP 401 — key dead", "network error: …") from a per-attempt outcome ledger; an all-health-blocked pool alarms immediately instead of hanging on the ceiling-waiter queue.
- One alarm email per outage episode; the episode bit rides the health file (the hosted runner's only cross-tick memory is the commit-back).
- Digest and heartbeat emails carry one degraded-accounts line whenever any account is capped — resolved above Gate 1 so Gate-1 heartbeats render it.
- Commit-back growth: a new `Commit health` step (`if: always() && failure()`, `-f`-guarded add), the Commit state file set grows, the rebase skip-set gains the third literal.
- `npm run typecheck && npm run lint && npm test` green; the all-429 pin (`tests/index.test.ts:428-475`) and the email byte fixtures survive; the only expected compile breaks are the three `RotationState` literals (`src/judge.ts:735`, `tests/judge-rotation.test.ts`, `tests/judge.test.ts`) gaining three fields.
- The probe job runs at most once per 8 hours measured from the last successful probe (`probedAt` in `state/judge-ceilings.json`): a fresh window skips the probe steps with the job GREEN (watch proceeds on committed ceilings), a failed probe starts no window (the next dispatch re-probes), and a `force` dispatch input overrides the window.

## Current State Analysis

The feature is composition, not invention — no `judge-health` artifact exists anywhere; `state/` holds exactly `seen-posts.json`, `judge-ceilings.json`, `linkedin-posts.json`.

### Key Discoveries

- **The ceilings module is the verbatim template**: pure resolver `resolveCeilings` (`src/judge-ceilings.ts:50-80`), never-throw reader `loadAccountCeilings` (`:85-114`), atomic writer `writeCeilingsAtomic` (`:122-143`), and the writer-in-src doc (`:16-18`) — its production call site is untestable, so the write path must be unit-testable in `src/`.
- **`judge-rotation.ts` has zero runtime imports** (`:28-32`, the D5 type-only-mirrored-import idiom) — the boundary this plan preserves; the pick reads plain state fields (`src/judge-rotation.ts:121-140`), ceilings typed `ReadonlyMap` with the no-run-time-writes doctrine (`:58-60`).
- **The exhaustion record hardcodes `reason: "HTTP 429"`** (`failuresFromCooldowns`, `src/judge-rotation.ts:233-251`); its non-empty invariant protects the email-silent path (`src/email.ts:181-182` returns null on an empty list while exit 1 still fires).
- **The flavor split is the single choke point**: active cooldown → budget park → exhaustion; else → zero-charge `waitCeilingSlot` (`src/judge.ts:391-397`) whose promise never resolves for an all-health-blocked pool — the hang the third arm closes.
- **A 503-only pool exits 0 silently today**: spent backoff defers the batch whole (`src/judge.ts:443-447`), no throw site fires; 401/403 land as warn lines only.
- **The stamp must live in the dispatch core** (`dispatchLlmCall`, `src/judge.ts:343-504`): `attemptIndex` and the failure cause coexist only there — the outcome union is account-blind (`:280-286`), one call traverses several accounts.
- **The hosted runner has no memory except git**: the Commit state step has no `if:` so it is skipped on the exhaustion exit (`src/index.ts:398-406`) — hence the failure-path `Commit health` step.
- **Byte-stability is a commit-cadence constraint**: no timestamps in the envelope; write only on semantic change (the `saveState` gate doctrine, `src/state.ts:237-254` — input-derived skip; the health writer's content-diff gate has NO direct precedent and is designed fresh in the module).
- **Episode-marker precedent** (`scripts/fetch-linkedin.ts:104-156`): repo-local marker, warn-only when set, clear on the verified healthy edge, injectable `markerPath` + alarm deps; four offline edge cases pinned at `tests/fetch-linkedin.test.ts:492-549`.
- **Test seams**: lazy per-suite `mkdtemp` (`tests/judge-ceilings.test.ts:109-117`), per-host counting stub (`tests/judge-rotation.test.ts:72-90`), hand-stepped tick clock (`:230-243`), inert sleepFn (`:433-467`), `includes()`-based email fixtures (`tests/email.test.ts:371-395`).
- **`resolveJudgeConfig` is judge-stage-local** (`src/index.ts:270`) — it hoists to the `runUrlFromEnv` site (`:238`) so the degraded line has pool size + stable indexing above Gate 1 (`:257-266`); a malformed `LLM_ACCOUNTS` fails the run sooner (accepted, same nonzero exit).
- **New state files do not exist until a first live run commits them** (`3fe892e` precedent) — hence `-f` guards on every health add.

## Desired End State

The committed file (absent until the first live run creates it; absent = everything healthy):

```json
{
  "version": 1,
  "marks": { "https://dead-endpoint.example/v1": 2 },
  "outageOpen": true
}
```

A tick sequence through the wired pipeline:

```ts
// index.ts — marks resolve above Gate 1 (the judgeHealth dep seam, mirror of judgeCeilings):
const health = await (deps.judgeHealth ?? loadAccountHealth)(judgeAccounts);
// health.marks: ReadonlyMap<number, number> (index-keyed streaks), health.cappedLine: string | undefined

// judge.ts — the pick inline predicate (committed ceilings + marks; no merge before judgePosts):
// capped account → probedThisTick gate (one dispatch per tick); probe success → slot freed,
// account rejoins at its COMMITTED ceiling for the rest of the tick.

// All accounts hard-dead → RotationExhausted carries the ledger + episode decision;
// main's catch flushes marks + outageOpen best-effort BEFORE process.exit(1):
//   alarm says "account 1 (https://…): HTTP 503" — not "HTTP 429"
//   second all-dead tick: warn-only (outageOpen already true), still exit 1
// Any account healthy that tick → outageOpen cleared; capped accounts render one
// degraded-accounts line on the digest/heartbeat.
```

## What We're NOT Doing

- NOT re-litigating the seven settled checkpoint decisions (committed file, cap-at-1, 2-tick threshold, success-clears, one-alarm-per-episode, failure-path `Commit health`, config hoist).
- NOT adding timestamps or a staleness policy to the envelope — marks self-heal (a stale mark costs at most the 1-request probe per tick); the file stays byte-stable with no clock.
- NOT folding health into `judge-rotation.ts` (the solutions' rejected Option 2), and NOT adding a `judge-rotation → judge-health` import of any kind — the pick predicate stays inline plain-field reads; no exported `isHealthBlocked`.
- NOT placing the flush inside `runWatcher` — it breaks the all-429 pin (`tests/index.test.ts:428-475`); the flush lives only in main's entry-module catch.
- NOT changing the probe (`scripts/probe-judge.ts` stays health-free — it imports nothing health-related and stages exactly one path).
- NOT gating scheduled ticks on the probe - the */10 cron stays ceilings-only; the freshness gate lives inside the dispatch-only probe job and only ever widens the skip (a fresh window behaves like a schedule tick).
- NOT adding an env knob for the window - 28800 seconds is a hard-coded workflow literal (the tuning-values doctrine); overriding it is the operator's `force` checkbox.
- NOT touching the seen-posts or linkedin-payload writers; NOT adding a circuit-breaker npm dependency.
- NOT baking health caps into the ceilings map (the developer-confirmed seam: judgePosts receives COMMITTED ceilings + a marks field; the cap lives in the pick).
- NOT stamping health on content-parse failures (a model failure is not an account failure).

## Decisions

### Module boundary: new src/judge-health.ts

Ambiguity: new sibling module vs fold into `judge-rotation.ts` (solutions artifact, two options).
Explored: Option 1 (new module) copies 4/7 pieces verbatim from `judge-ceilings.ts`/`state.ts`/`linkedin-payload.ts`/`fetch-linkedin.ts`, keeps the import graph downward-only (`judge.ts→judge-health`, `index.ts→judge-health` runtime; `judge-health→judge-rotation` type-only via the `:28-32` D5 idiom; `judge-rotation→judge-health` none). Option 2 makes `judge-rotation.ts` the repo's first IO+primitives hybrid, drags `node:fs` into every dispatch test's import chain, and pits two opposing doctrine comments in one file.
Decision: Option 1 — new `src/judge-health.ts`. Verdict pass (solutions artifact, 2026-11-07).

### Half-open predicate: inline plain-field reads

Directional confirm asked and answered: the pick consults `healthMarks`/`probedThisTick` inline inside `pickEligibleAccount` (`src/judge-rotation.ts:121-140`) as plain field reads — no new export, no `judge-rotation→judge-health` edge, and the all-health-blocked check for the third flavor arm stays inline in `judge.ts`.

### Cap seam: committed ceilings + marks in the pick (NOT pre-merged)

Ambiguity: the research (decision 5) says a capped account's successful probe rejoins at its COMMITTED ceiling for the rest of the tick — "the cap lives entirely in the pick predicate, so the ceilings map never needs a run-time write". The solutions' hard-constraints line says caps merge via `min(committed, healthCap)` at `src/index.ts:275`, which bakes capped accounts to 1 before `judgePosts` sees them (mid-tick probe success could only rejoin at 1).
Explored: merged-ceilings (solutions seam literal) vs marks-in-pick (research decision 5 literal). The merge also pre-empts the effective-cap width; the marks approach computes width = Σ effective caps once from ceilings+marks.
Decision: **marks-in-pick** (developer-confirmed): `judgePosts` receives the committed ceilings map unchanged and a `healthMarks` field; the pick applies cap 1 inline; `probedThisTick` gates re-picks; probe success deletes the probe slot. The `index.ts:275` seam becomes the marks resolve.

### Health file shape: byte-stable, no staleness

`{version: 1, marks: Record<trimmed baseUrl, streak>, outageOpen: boolean}` — keys trimmed like the ceilings file (`src/judge-ceilings.ts` trims both sides). Streak = consecutive hard-failed ticks; threshold 2 caps at ceiling 1; success resets to 0 (entry removed). `outageOpen` true while the alarm has fired and no healthy dispatch has cleared it. No timestamps, no staleness bound (developer checkpoint in research Q6: marks self-heal).

### Flush location: main's entry-module catch only

`src/index.ts:393-406` — best-effort, before `process.exit(1)`, never masking the earned exit code (the heartbeat/alarm best-effort doctrine). Tests exercise the flush helper and the health module directly; the bootstrap stays untested by design. Placing it inside `runWatcher` breaks the all-429 pin.

### Episode transport: the failure-path commit step

The episode bit rides `outageOpen` in the health file; a new `Commit health` step (`if: always() && failure()`, `-f`-guarded add of only the health file, same rebase script) persists the run that SETS the bit; the existing Commit state step grows its file set for the success path. The untracked-marker approach cannot work on the hosted runner (fresh workspace every run) — the PC-leg precedent (`scripts/fetch-linkedin.ts:95-102`) documents the OS-temp rejection that motivates repo-persistence.

### Exhaustion causes: core-side stamps, real strings

`judge.ts` stamps the ledger at the four branch sites where `attemptIndex` + cause coexist: 429 (`:421-430`) NEVER stamps (non-countable flavor); terminal 5xx (`:443-447`, spent backoff only — never the mid-backoff path) stamps `HTTP <status>`; non-retryable 401/403 stamps `HTTP <status> — key dead`; other non-retryables stamp `HTTP <status>`; transport (`:466-472`) stamps `network error: <message>`; success (`:481-483`) clears the account's ledger entry AND probe slot. `AccountFailure.reason` renders verbatim (`src/email.ts:185`), so the builder stays a pure renderer and the `includes()`-based fixtures survive.

### All-health-blocked hang: third flavor arm

`judge.ts:391-397` grows `else if (allHealthBlocked) return { status: "exhausted" }` BEFORE `waitCeilingSlot` — trips immediately at zero park cost, reusing the existing throw → email → exit 1 path. Inline check (plain field reads), mirroring the pick predicate.

### Degraded line: resolved above Gate 1, one line on both emails

`resolveJudgeConfig` hoists to the `runUrlFromEnv` site (`src/index.ts:238`); the marks resolve joins it; the capped set feeds one rendered line (pure builder in `judge-health.ts`) threaded into `HeartbeatStats` and the digest as a trailing optional param (the `LegLine` rider pattern, `src/email.ts:85-90`, `src/heartbeat.ts:142`). Gate 1 only READS marks — zero dispatches cannot clear them.

### Writer gate: semantic-change no-op

The pattern-finder correction: `state.ts:237-254` is an input-derived skip (empty `diffNewIds`), NOT a content comparison — the health writer's diff gate has no direct precedent. The module compares the NEXT envelope bytes (`JSON.stringify` of the resolved next state) against the loaded file's canonical serialization and skips the write when identical; only semantic changes mint commits.

## Ordering Constraints

- Phase 1 (module) is the foundation — every later phase compiles against its types.
- Phase 3 (rotation fields) precedes Phase 4 (judge core constructs the extended state and stamps the ledger); both precede Phase 6 (entry wiring passes marks + flushes).
- Phase 5 (email/heartbeat riders) precedes Phase 6 — index passes the new optional params, so the signatures must exist first.
- Phase 6 precedes Phase 7 (the workflow/script literals reference the path + flush behavior that exist by then).
- Phase 7 precedes Phase 8 (docs describe shipped machinery); Phase 8 carries the repo-wide gates (terminal phase only).
- Phases 2 and 5 can technically interleave after their deps, but the plan runs strictly sequentially (micro-checkpoints between phases).
- Phase 9 (probe freshness gate) post-dates the shipped Phase 7 workflow shape; it touches only the probe-job side of watch.yml, the probe script's write, and the ceilings resolver's key filter - the watch job, its if, and every other phase's deliverable stay untouched.

## Verification Notes

Carried from the research test inventory + risks. Per-phase Success Criteria lift the matching entries.

- [x] Gates green: `npm run typecheck`, `npm run lint`, `npm test` (terminal phase runs all three repo-wide).
- [x] The all-429 pin passes unchanged: `tests/index.test.ts:428-475` (the placement proof for the catch-only flush).
- [x] The compile-level breaks are exactly the three `RotationState` literals gaining three fields (`src/judge.ts:735`, `tests/judge-rotation.test.ts:54`, `tests/judge.test.ts:18`).
- [x] Reader degrade matrix: absent → quiet default; malformed → warn naming the file; wrong version → treat-as-default (the `judge-ceilings.test.ts:109-117` mkdtemp idiom).
- [x] Writer byte-stability: identical resolved marks → no write → the workflow no-op guard commits nothing.
- [x] Tick-merge matrix: hard-fail → streak+1 → capped at 2; success → reset to 0; absent account → unchanged; 429-only tick → unchanged.
- [x] Episode 4-case edges pinned offline (the `tests/fetch-linkedin.test.ts:492-549` shape): open on first alarm, quiet while open, clear on healthy dispatch, re-open on next outage.
- [x] Non-empty exhaustion record at every throw site (the `src/email.ts:181-182` empty-record null must stay unreachable).
- [x] 5xx stamp lands ONLY on the terminal branch — pin with a spent-backoff stub (the `tests/judge-rotation.test.ts:433-467` inert-sleepFn idiom).
- [x] 429 stamped-but-non-countable keeps the `reason === "HTTP 429"` pins (`tests/judge-rotation.test.ts:200, 512-514`).
- [x] Zero-charge ceiling-waiter pins hold with the extended pick (`tests/judge-rotation.test.ts:795-816`).
- [x] Probe-saturation pin: capped account receives exactly 1 request per tick (per-host counting stub, `tests/judge-rotation.test.ts:72-90` idiom).
- [x] Probe-success rejoin: sequential `judgePosts` calls sharing one temp-dir health file — capped probe → success → rejoins at the committed ceiling for the rest of the tick.
- [x] Skip-set suite grows the three-file cases (`tests/commit-state-rebase.test.ts`).
- [x] Email fixtures grow additively for "HTTP 503" / "HTTP 401 — key dead" / "network error: …" reasons (`tests/email.test.ts:371-395` idiom; existing `includes()` fixtures survive).
- [x] Watch job `timeout-minutes: 8` budget re-checked with the `Commit health` step on the failure path.
- [ ] Manual: local run with one deliberately dead key → alarm names the real cause, exit 1, `state/judge-health.json` written atomically; second dead tick warn-only; first live hosted run materializes + commits the file; a healthy tick clears the episode bit.

## Performance Considerations

- The probe ledger costs one extra Set lookup per pick scan — negligible against the existing cooldown/ceiling checks.
- Pool width = Σ effective caps (committed ceilings with capped accounts contributing 1) — computed once in `judgePosts`; no second computation at the entry.
- The third flavor arm charges ZERO park budget (it returns immediately) — the exhaustion alarm latency is unchanged.
- Byte-stability bounds commit cadence: a no-op tick mints no commit (the `git diff --cached --quiet` guard then exits 0).
- The `-f`-guarded `Commit health` add is one stat call on the failure path — inside the 8-minute envelope; re-verify `timeout-minutes` when wiring (Phase 7 criterion).
- Backoff sleeps in tests stay inert (injected `sleepFn`) — the suite stays offline and deterministic.

## Migration Notes

- No existing state file changes shape: `seen-posts.json` (v2) and `judge-ceilings.json` are untouched; `judge-health.json` is a brand-new file absent from every checkout until the first live run commits it (`3fe892e` precedent) — all readers/writers treat absent as the healthy default.
- Rollback: remove the module + wiring + workflow steps; the leftover `state/judge-health.json` is inert (nothing reads it once the resolve seam is gone).
- Backwards compatibility: the health file carries `version: 1` (the `linkedin-payload.ts` gate shape) so a future shape change degrades read-side to defaults instead of failing runs.

## Pattern References

- `src/judge-ceilings.ts:50-143` — the module template: resolver shape, never-throw reader, atomic writer; the writer-in-src rationale (`:16-18`).
- `src/judge-rotation.ts:28-32` — the type-only mirrored import idiom for the `judge-health → judge-rotation` edge.
- `src/state.ts:190-233` — `stateTempPath` + atomic write (temp + rename, failure cleanup naming the target).
- `src/state.ts:237-254` — the gated-save doctrine the writer's semantic-diff gate extends (input-derived skip → content-derived skip).
- `src/linkedin-payload.ts:28-38, 148-165` — the version-gated envelope reader degrade lattice.
- `scripts/fetch-linkedin.ts:104-156` — the episode edge detector: marker-exists → warn-only; write-then-alarm best-effort; clear on the verified healthy edge.
- `.github/workflows/watch.yml:58-77, 157-176` — the two commit-back step shapes the third step copies.
- `scripts/commit-state-rebase.sh:13, 30-32, 58-60` — the growth ledger + set-membership skip test.
- `src/email.ts:75-95` + `src/heartbeat.ts:118-142` — the LegLine rider pattern the degraded line copies.

## Developer Context

**Q1 (directional confirm, asked via ask_user_question):** Where does the half-open probe predicate live? The solutions artifact settles it INLINE in `pickEligibleAccount` (`src/judge-rotation.ts:121-140`) as plain field reads so `judge-rotation.ts` never imports `judge-health.ts` (the `:28-32` zero-runtime-import identity); the alternative was an exported `isHealthBlocked` predicate.
**A1:** "Follow inline (solutions shape)" — plain field reads, no new export; the all-health-blocked check for the third flavor arm (`src/judge.ts:391-397`) also stays inline in judge.ts.

**Q2 (genuine ambiguity, asked via ask_user_question after re-sweep):** The two artifacts pin the cap seam differently — research decision 5 requires judgePosts to receive COMMITTED ceilings + a marks map (probe success rejoins at the committed ceiling rest-of-tick; "the cap lives entirely in the pick predicate"), while the solutions' hard-constraints line says `min(committed, healthCap)` merges at `src/index.ts:275` (baking capped accounts to 1; mid-tick probe success rejoins only at 1).
**A2:** "Marks in pick (Recommended)" — committed ceilings + healthMarks in the pick; width = Σ effective caps; the `index.ts:275` seam becomes the marks resolve.

**Q3 (design summary + decomposition, asked via ask_user_question):** Design locked (8 decisions above); 8 slices — module, module tests, rotation fields, judge core, email riders, entry wiring, workflow+commit-back, docs sync.
**A3:** "Proceed (Recommended)" + "Approve (Recommended)".

**Checkpoint note (pattern-finder correction, Step 2):** `state.ts:247-254` is an input-derived skip (empty `diffNewIds`), not a content comparison — the health writer's semantic-diff gate has no direct precedent and is designed fresh in the new module (Decisions §Writer gate).

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 4 §3 (tests/judge.test.ts) | src/judge.ts:725 | blocker | actionability | The all-health-blocked test passes the marks map in the `now` slot (`ceilings, marks, Date.now, inertSleep`) — typecheck fails; healthMarks is the trailing 9th param | Reorder the tail to `ceilings, Date.now, inertSleep, marks` | applied: marks moved to the trailing 9th slot |
| coverage | ## Verification Notes §7 | <n/a> | blocker | verification-coverage | The "quiet while open" episode leg has criteria NOT FOUND and code NOT FOUND: Phase 6's catch calls `sendExhaustionEmail` unconditionally, no slice reads `outageOpen`, yet the Requirements demand one-alarm-per-episode | Gate the alarm in Phase 6's catch on the loaded `outageOpen` (warn-only when open) + add a criteria bullet pinning the suppressed second email | applied: `episodeAlarmDue` helper (Phase 1, 3 pinned cases) + the catch's hoisted-flag gate consuming the PRE-FLUSH snapshot |
| coverage | ## Verification Notes §17 | <n/a> | blocker | verification-coverage | The "second dead tick warn-only" clause: no phase's criteria or code exercises it; README prose claims the quietness ships | Same outageOpen suppression gate in Phase 6's catch + a matching criteria bullet | applied: same fix as §7 — helper + hoisted-flag catch gate; the criteria stay helper-referenced (the bootstrap is untestable by recorded design) |
| code | Phase 4 §3 (tests/judge.test.ts) | biome.json:13 | blocker | codebase-fit | The replacement import orders `isRotationExhausted` before the type imports — Biome's member sort is uppercase-first (the sibling rotation suite sorts `RotationExhausted, RotationState, isRotationExhausted`) | Reorder to `type RotationExhausted, type RotationState, isRotationExhausted` | applied: uppercase-first member sort |
| code | Phase 6 §1 (index.ts) | src/index.ts:398 | concern | actionability | "One alarm email per outage episode" unimplemented — same root as the coverage blockers | Grow the Phase 6 catch fence to gate the alarm on the loaded episode bit | applied: same episode gate (catch consumes `episodeAlarmDue` against the pre-flush snapshot) |
| coverage | ## Verification Notes §3 | <n/a> | concern | verification-coverage | The note still names ONE freshState compile break; the slices revised to THREE literals (judge.ts:735, rotation.test.ts:54, judge.test.ts:18) | Update §3 + the Requirements bullet to enumerate all three literals | applied: both now name judge.ts:735, rotation.test.ts:54, judge.test.ts:18 |
| code | Phase 6 §1 (index.ts) | src/index.ts:270 | suggestion | code-quality | The hoist comment "fails the run sooner (the same nonzero exit)" is false for Gate-1 ticks: they flip from exit 0 to exit 1 | Correct the comment to state the Gate-1 flip explicitly | applied: comment states exit 0 → exit 1 on a malformed nothing-unseen tick |
| code | Phase 6 §1 (index.ts) | <n/a> | suggestion | code-quality | The marks resolve ignores the judgeHealthPath seam — a caller setting only the path gets repo-relative reads with temp-dir writes; once a live run commits the file, repo state leaks into npm test | Default the resolve to the derived path as well | applied: resolve closes over the derived judgeHealthPath (read/write paths agree) |
| code | Phase 8 §5 | workflows guidance:98 | suggestion | codebase-fit | The errexit paragraph's parenthetical still lists the two-file set; the widened grep cannot match a bare path list | Extend §5(1) to grow the parenthetical to three files | applied: §5 fence grows the errexit parenthetical |
| code | Phase 8 §6 | scripts guidance:5 | suggestion | codebase-fit | "the body of BOTH commit-back steps" survives the grep | Extend §6 to name the third caller | applied: §6 fence names ALL THREE commit-back steps |
| code | Phase 8 | tests guidance:11 | suggestion | codebase-fit | The docs sweep skips the tests guidance' coverage-map ledger (judge-ceilings row absent, judge-health rows missing) | Add the tests guidance as an 8th target and grow the map |

## Plan History

- Phase 1: Health module — approved as generated; revised at Step 9: the `episodeAlarmDue` one-alarm gate export joins the fence (14th export)
- Phase 2: Health module tests — approved as generated; revised at Step 9: the one-alarm gate's three cases + criteria bullet join
- Phase 3: Rotation fields + inline pick — revised during verification: change set extended to judge.ts's state literal and tests/judge.test.ts's freshState (the second RotationState literal), the boundary criterion narrowed to the import-edge grep, and one pick-test assertion corrected per verifier trace
- Phase 4: Judge core stamps + hang arm — revised during verification: countsSuccess gate added (parse-miss stamps nothing), exhaustionRecord merge (non-empty invariant at all three throw sites), allHealthBlocked progress semantics (uncapped never blocks — the zero-charge pin preserved), judge-health import sort; the all-health-blocked test redesigned to the parse-miss-driven mixed-reason scenario per verifier trace; judge-rotation.ts joined the change set (health payload + factory + failuresFromCooldowns deletion); revised at Step 9: the acceptance test's marks-arg order and the judge.test.ts import sort corrected
- Phase 5: Email + heartbeat riders — revised during verification: tests/heartbeat.test.ts joined the change set (the funnel line needs its pins); the ordering-test needle corrected from the heartbeat-only "DARK" to the digest's raw "stale"
- Phase 6: Entry wiring — revised during verification: the match-path sendDigest call gained the degradedLine arg, and the flush default re-derived from the state file's directory (dirname(statePath)/judge-health.json — equals JUDGE_HEALTH_PATH in production, keeps every unmodified success-path test inside the temp dir); revised at Step 9: the catch gains the hoisted-flag episode gate (pre-flush read, load-bearing order), the marks resolve defaults to the derived path, the hoist comment states the Gate-1 exit 0 → exit 1 flip
- Phase 7: Workflow + commit-back — approved as generated (verifier: zero findings)
- Phase 8: Docs sync + repo-wide gates — revised at Step 9: target list grew to 8 files (the root guidance, the tests guidance's coverage map, and the script header's invoker sentence joined the sweep); the boundary prose corrected to zero-RUNTIME-import; judge-health.ts placed on the LEAVES+CONFIG lines; the flush prose names both the success-path and catch-only exhaustion flushes; the stale-prose grep widened to catch "two invokers" / "is two files" phrasings
- Phase 9: Probe freshness gate - added by /skill:revise (2026-11-07): 8h success-gated probe cadence; the `probedAt` epoch stamp (probe script), the `freshness` gate step + step-level ifs (watch.yml probe job), the `force` dispatch input, and the ceilings resolver's `probedAt` key filter with its suite pin

## References

- `.rpiv/artifacts/solutions/2026-11-07_08-22-22_provider-health-module-boundary.md` — the module-boundary verdict this plan implements
- `.rpiv/artifacts/research/2026-11-07_07-26-22_provider-health-circuit.md` — the settled WHAT: seven checkpoint decisions, all seams, test inventory
- `.rpiv/artifacts/discover/2026-11-07_07-13-17_provider-health-circuit.md` — the FRD
- `.rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md` — the neighboring design (Slice 8 docs-sync precedent `d4e4007`)
- `.rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md` — the episode-marker test-pinning lesson
- `src/judge-ceilings.ts:16-18, 50-143` — the cloned module template
- `src/judge-rotation.ts:28-32, 54-77, 121-140, 233-251` — the pure-primitive module and its seams
- `src/judge.ts:343-504, 725-760` — the stamp sites, flavor split, state construction
- `src/index.ts:104-128, 236-285, 393-406` — dep seams, hoist/resolve sites, the flush catch
- `.github/workflows/watch.yml:58-77, 155-176` + `scripts/commit-state-rebase.sh:40-70` — commit-back growth

## Phase 1: Health module

### Overview

Delivers `src/judge-health.ts` — the complete health surface (envelope types, never-throw reader, pure resolver + tick-merge, atomic writer with the semantic-change gate, ledger helpers, episode helpers) as a standalone module with no consumers yet — plus the `JUDGE_HEALTH_PATH` constant in `config.ts` (the module's reader/writer defaults reference it, so the constant must exist for the tree to typecheck). Depends on nothing; no later phase can start before its types exist.

### Changes Required:

#### 1. src/judge-health.ts

**File**: src/judge-health.ts

**Changes**: NEW — the health module: `HEALTH_VERSION` + `HARD_FAIL_TICKS_TO_CAP`, the `HealthFile` envelope (version gate grafted from `linkedin-payload.ts:148-165`, no timestamps), the `AccountTickOutcome`/`TickOutcomes`/`HealthRead`/`OutcomeLedgerState` contracts, `resolveAccountHealth` (pure: file + accounts → index-keyed streak map; per-account degradation is signaled by the email line, never warnings), `loadAccountHealth` (never-throw reader, the `judge-ceilings.ts:85-114` shape: ENOENT quiet, other faults one warn naming the file), `writeHealthAtomic` (atomic writer, `stateTempPath` + rename, the `state.ts:190-233` shape), `flushHealthIfChanged` (the semantic-change no-op gate — canonical sorted-keys comparison, the content-derived extension of the `saveState` gate), the ledger helpers `stampFailure`/`stampSuccess`/`readTickOutcomes`/`buildFailuresFromLedger` (the unified exhaustion builder replacing `failuresFromCooldowns`, operating on the structural `OutcomeLedgerState` slice of `RotationState` so the module typechecks standalone), `nextHealthFile` (pure tick merge: streak+1 / reset / unchanged + pool pruning; the episode bit is a parameter), `buildDegradedAccountsLine`, and the best-effort flush wrappers `flushTickHealth`/`flushExhaustionHealth` (the episode policy lives here, unit-testable offline).

```ts
/**
 * Provider health circuit for the LLM judge pool: per-account health marks
 * that survive 10-minute ticks in the committed state/judge-health.json,
 * the in-run outcome ledger the exhaustion alarm renders with real causes,
 * and the outage episode bit.
 *
 * Module boundary (solutions 2026-11-07, verdict pass): a sibling of
 * judge-ceilings.ts — pure resolver, never-throw reader, atomic writer —
 * so judge-rotation.ts keeps its zero-runtime-import identity (the
 * half-open predicate reads plain state fields inlined in the pick; this
 * module is never imported by judge-rotation). The edge points one way at
 * runtime: judge.ts and index.ts import downward from here. The ledger
 * helpers take a STRUCTURAL slice of the rotation state (declared below)
 * rather than importing RotationState, so this module typechecks
 * standalone at HEAD and RotationState satisfies it structurally once
 * Phase 3 lands the fields.
 *
 * Byte-stability doctrine: the envelope carries NO timestamps and NO
 * staleness bound. Marks self-heal — a stale mark costs at most the
 * 1-request probe per tick until the first success clears it — so the
 * file can stay byte-identical on no-op runs, which is what stops every
 * tick from minting a commit. flushHealthIfChanged extends the saveState
 * gate doctrine (src/state.ts:237-254) with the content comparison that
 * gate's input-derived skip cannot express.
 *
 * The writer lives here (not in scripts/) for the exact reason
 * judge-ceilings.ts:16-18 established: its production call sites are
 * index.ts's success tail and main's entry-module catch
 * (src/index.ts:393-406), which no test reaches.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { JUDGE_HEALTH_PATH } from "./config.js";
import type { LlmAccount } from "./judge.js";
import { stateTempPath } from "./state.js";
import type { AccountFailure } from "./types.js";

/** Envelope version; bump on a shape change, keep the reader tolerant. */
export const HEALTH_VERSION = 1;

/**
 * Consecutive hard-failed ticks (terminal 5xx / transport / 401 / 403 —
 * never 429) that cap an account at ceiling 1. judge-rotation.ts keeps a
 * paired local constant for its inlined pick predicate (no import exists
 * by design); the two MUST stay equal.
 */
export const HARD_FAIL_TICKS_TO_CAP = 2;

/**
 * The committed file shape: byte-stable (no timestamps), self-healing
 * (success clears), single-writer (the watch run; the workflow commits).
 */
export interface HealthFile {
  version: number;
  /** trimmed baseUrl -> consecutive hard-failed ticks (>= 2 caps at 1). Healthy accounts are absent. */
  marks: Record<string, number>;
  /** True while an outage alarm has fired and no healthy dispatch has cleared it. */
  outageOpen: boolean;
}

/** One account's LAST dispatch outcome this tick — the ledger's value type. */
export type AccountTickOutcome = { kind: "ok" } | { kind: "hard-failed"; reason: string };

/** Per-account outcomes of one judge run — the flush unit and the payload the exhaustion error carries. */
export interface TickOutcomes {
  /** Account indexes whose last dispatch succeeded (streak resets; the episode clears on any). */
  readonly ok: readonly number[];
  /** Account index -> the recorded real cause of its last hard failure. */
  readonly failed: ReadonlyMap<number, string>;
}

/** What the reader returns: pool-indexed streaks plus the parsed envelope base for the flush. */
export interface HealthRead {
  /** 0-based account index -> hard-failed streak; a missing index is healthy. */
  readonly marks: ReadonlyMap<number, number>;
  /** The parsed envelope, undefined when absent, unreadable, or unusable. */
  readonly file: HealthFile | undefined;
}

/**
 * The structural slice of RotationState the ledger helpers need — declared
 * here so this module never imports judge-rotation (the boundary) and
 * typechecks standalone at HEAD. RotationState satisfies it structurally
 * once Phase 3 lands the three fields; the doc at each field site keeps
 * the two in sync.
 */
export interface OutcomeLedgerState {
  readonly accounts: readonly LlmAccount[];
  readonly cooldownUntil: Map<number, number>;
  readonly healthMarks: Map<number, number>;
  readonly probedThisTick: Set<number>;
  readonly outcomeLedger: Map<number, AccountTickOutcome>;
}

/**
 * Resolve the index-keyed streak map for one account pool from the parsed
 * health file (undefined when absent, unreadable, or unusable). Never
 * throws: a marks entry that fails the shape contract drops silently —
 * missing data IS the good state, so there are no per-account floor
 * warnings (the ceilings doctrine inverted: per-account degradation is
 * communicated through the email line). Keys are trimmed before matching
 * because parseLlmAccounts trims baseUrl (src/judge.ts:163-172). Pure.
 */
export function resolveAccountHealth(
  accounts: readonly LlmAccount[],
  parsed: HealthFile | undefined,
): ReadonlyMap<number, number> {
  const byKey = new Map<string, number>();
  if (parsed !== undefined) {
    for (const [key, streak] of Object.entries(parsed.marks)) {
      if (typeof streak === "number" && Number.isInteger(streak) && streak >= 1) {
        byKey.set(key.trim(), streak);
      }
    }
  }
  const marks = new Map<number, number>();
  for (const [index, account] of accounts.entries()) {
    const streak = byKey.get(account.baseUrl.trim());
    if (streak !== undefined) marks.set(index, streak);
  }
  return marks;
}

/**
 * Read + resolve the health file for one account pool. Never throws (the
 * degrade doctrine): an absent file is the normal healthy state and reads
 * QUIET; an unreadable, non-object, unknown-version, or malformed-envelope
 * file warns ONCE naming the file and reads as absent. The parsed envelope
 * rides the result (`file`) as the flush's base.
 */
export async function loadAccountHealth(
  accounts: readonly LlmAccount[],
  filePath: string = JUDGE_HEALTH_PATH,
): Promise<HealthRead> {
  let parsed: HealthFile | undefined;
  try {
    const json: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      console.warn(`judge: ${filePath} is not a JSON object — treating as absent`);
    } else {
      const envelope = json as Record<string, unknown>;
      if (envelope.version !== HEALTH_VERSION) {
        console.warn(
          `judge: ${filePath} unknown version ${String(envelope.version)} (expected ${HEALTH_VERSION}) — treating as absent`,
        );
      } else if (
        envelope.marks === null ||
        typeof envelope.marks !== "object" ||
        Array.isArray(envelope.marks)
      ) {
        console.warn(`judge: ${filePath} carries a malformed marks object — treating as absent`);
      } else {
        parsed = {
          version: HEALTH_VERSION,
          marks: envelope.marks as Record<string, number>,
          outageOpen: envelope.outageOpen === true,
        };
      }
    }
  } catch (error) {
    const isEnoent =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT";
    if (!isEnoent) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`judge: ${filePath} unreadable (${message}) — treating as absent`);
    }
  }
  return { marks: resolveAccountHealth(accounts, parsed), file: parsed };
}

/**
 * Record one hard-failed dispatch on the in-run ledger — the judge core
 * calls this exactly where attemptIndex and the cause coexist
 * (src/judge.ts:421-483). HTTP 429 is the NON-countable flavor: the
 * cooldown map already carries it into the exhaustion record; never stamp
 * a 429 here.
 */
export function stampFailure(state: OutcomeLedgerState, index: number, reason: string): void {
  state.outcomeLedger.set(index, { kind: "hard-failed", reason });
}

/**
 * Record a successful dispatch: the ledger flips to ok (last outcome
 * wins), the half-open probe slot frees, and an in-run cap clears — the
 * account rejoins at its COMMITTED ceiling for the rest of the tick
 * (research decision 5). In-run maps only: the ceilings map and the FILE
 * are untouched; the flush applies the reset to the file at end of tick.
 */
export function stampSuccess(state: OutcomeLedgerState, index: number): void {
  state.outcomeLedger.set(index, { kind: "ok" });
  state.probedThisTick.delete(index);
  state.healthMarks.delete(index);
}

/**
 * Derive the tick's per-account outcomes from the ledger — the flush unit
 * index.ts persists and the RotationExhausted health payload carries. Last
 * outcome per account wins: failure-then-success reads ok, the reverse
 * reads the failure reason.
 */
export function readTickOutcomes(state: OutcomeLedgerState): TickOutcomes {
  const ok: number[] = [];
  const failed = new Map<number, string>();
  for (const [index, outcome] of state.outcomeLedger) {
    if (outcome.kind === "ok") {
      ok.push(index);
    } else {
      failed.set(index, outcome.reason);
    }
  }
  return { ok, failed };
}

/**
 * Build the exhaustion record in pool order — the unified builder that
 * replaces failuresFromCooldowns (src/judge-rotation.ts:233-251): a
 * hard-failed account carries its recorded real cause; a cooling-only
 * account carries "HTTP 429". Entry existence (not freshness) is the
 * criterion — a freshness filter could empty the record and revive the
 * email-silent path in src/email.ts:181-182. Throw sites fire only when
 * the pick found nothing, so the record is non-empty by construction.
 */
export function buildFailuresFromLedger(state: OutcomeLedgerState): AccountFailure[] {
  const failures: AccountFailure[] = [];
  for (const [index, account] of state.accounts.entries()) {
    const outcome = state.outcomeLedger.get(index);
    if (outcome?.kind === "hard-failed") {
      failures.push({ account: index + 1, baseUrl: account.baseUrl, reason: outcome.reason });
    } else if (state.cooldownUntil.has(index)) {
      failures.push({ account: index + 1, baseUrl: account.baseUrl, reason: "HTTP 429" });
    }
  }
  return failures;
}

/**
 * Merge one tick's outcomes into the envelope (pure): an ok account's
 * streak entry deletes (reset), a hard-failed account's streak increments,
 * an account absent from both maps keeps its streak (a tick where it
 * dispatched nothing — 429-only included — is neither success nor hard
 * failure). Mark keys for accounts no longer in the pool are pruned.
 * `outageOpen` is the caller's episode decision (the flush wrappers own
 * the policy). Returns the next envelope; nothing touches disk.
 */
export function nextHealthFile(
  accounts: readonly LlmAccount[],
  base: HealthFile | undefined,
  outcomes: TickOutcomes,
  outageOpen: boolean,
): HealthFile {
  const poolKeys = new Set(accounts.map((account) => account.baseUrl.trim()));
  const marks: Record<string, number> = {};
  for (const [key, streak] of Object.entries(base?.marks ?? {})) {
    if (poolKeys.has(key) && typeof streak === "number" && streak >= 1) {
      marks[key] = streak;
    }
  }
  for (const index of outcomes.ok) {
    const key = accounts[index]?.baseUrl.trim();
    if (key !== undefined) delete marks[key];
  }
  for (const index of outcomes.failed.keys()) {
    const key = accounts[index]?.baseUrl.trim();
    if (key !== undefined) marks[key] = (marks[key] ?? 0) + 1;
  }
  return { version: HEALTH_VERSION, marks, outageOpen };
}

/**
 * One degraded-accounts line for the digest and the heartbeat: every
 * capped account (streak >= HARD_FAIL_TICKS_TO_CAP), 1-based, with its
 * base URL. undefined when none is capped — the line must be ABSENT from
 * healthy emails, not empty (byte-compatibility with the pre-health
 * fixtures, the LegLine rider shape).
 */
export function buildDegradedAccountsLine(
  accounts: readonly LlmAccount[],
  marks: ReadonlyMap<number, number>,
): string | undefined {
  const capped: string[] = [];
  for (const [index, account] of accounts.entries()) {
    if ((marks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP) {
      capped.push(`#${index + 1} ${account.baseUrl}`);
    }
  }
  if (capped.length === 0) return undefined;
  return `Degraded LLM account(s): ${capped.join(", ")} — capped at 1 request/tick`;
}

/** Canonical serialization: the semantic-change comparison key (sorted mark keys, so byte-stability does not depend on insertion order). */
function canonicalHealthJson(file: HealthFile): string {
  const marks: Record<string, number> = {};
  for (const key of Object.keys(file.marks).sort()) {
    const streak = file.marks[key];
    if (streak !== undefined) marks[key] = streak;
  }
  return JSON.stringify({ version: file.version, marks, outageOpen: file.outageOpen });
}

/**
 * Write the health envelope atomically (sibling unique temp + rename, the
 * writeStateAtomic shape): a crashed run never leaves a partial file.
 * Throws fail-visible — the flush wrappers own the best-effort policy.
 */
export async function writeHealthAtomic(
  file: HealthFile,
  filePath: string = JUDGE_HEALTH_PATH,
  now: () => number = Date.now,
): Promise<void> {
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, now());
  const jsonContent = `${JSON.stringify(file, null, 2)}\n`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, jsonContent, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup of temp file
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`health: atomic write failed for ${filePath}: ${message}`);
  }
}

/** A parsed value this module's gate can canonicalize: right version, object-shaped marks. */
function isUsableEnvelope(
  value: unknown,
): value is { version: unknown; marks: Record<string, unknown>; outageOpen: unknown } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === HEALTH_VERSION &&
    record.marks !== null &&
    typeof record.marks === "object" &&
    !Array.isArray(record.marks)
  );
}

/**
 * Flush the next envelope ONLY on semantic change: the committed file must
 * stay byte-identical on no-op ticks or every 10-minute run mints a commit.
 * The current file is canonicalized tolerantly — an absent, unreadable, or
 * unusable current file compares as "different" so the write repairs it.
 * Returns true when a write happened. Throws only from writeHealthAtomic.
 */
export async function flushHealthIfChanged(
  next: HealthFile,
  filePath: string = JUDGE_HEALTH_PATH,
): Promise<boolean> {
  let current: string | undefined;
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (isUsableEnvelope(parsed)) {
      current = canonicalHealthJson({
        version: HEALTH_VERSION,
        marks: parsed.marks as Record<string, number>,
        outageOpen: parsed.outageOpen === true,
      });
    }
  } catch {
    // absent or unreadable: nothing comparable — the write proceeds and repairs
  }
  if (current !== undefined && current === canonicalHealthJson(next)) {
    return false;
  }
  await writeHealthAtomic(next, filePath);
  return true;
}

/**
 * Success-path flush: merge the tick's outcomes into the loaded envelope,
 * keep the episode bit open only when it stood AND nothing dispatched ok
 * (an episode ends only on a run with >= 1 healthy dispatch), and write
 * only on semantic change. Best-effort BY CONTRACT: never throws — any
 * fault warns once and returns, so a broken state dir cannot fail an
 * otherwise green run.
 */
export async function flushTickHealth(
  accounts: readonly LlmAccount[],
  base: HealthFile | undefined,
  outcomes: TickOutcomes,
  filePath: string = JUDGE_HEALTH_PATH,
): Promise<void> {
  const outageOpen = (base?.outageOpen ?? false) && outcomes.ok.length === 0;
  try {
    await flushHealthIfChanged(nextHealthFile(accounts, base, outcomes, outageOpen), filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`judge: ${filePath} flush failed — ${message}`);
  }
}

/**
 * Exhaustion-path flush: the failed run's outcomes land with the episode
 * bit OPEN, before process.exit(1) (src/index.ts:393-406). Best-effort by
 * contract (never throws — the catch must not mask the earned exit 1); a
 * failed write warns and the run still exits.
 */
export async function flushExhaustionHealth(
  accounts: readonly LlmAccount[],
  base: HealthFile | undefined,
  outcomes: TickOutcomes,
  filePath: string = JUDGE_HEALTH_PATH,
): Promise<void> {
  try {
    await flushHealthIfChanged(nextHealthFile(accounts, base, outcomes, true), filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`judge: ${filePath} flush failed — ${message}`);
  }
}

/**
 * True when this exhaustion deserves an alarm: the episode bit was NOT
 * already open. Reads the PRE-FLUSH snapshot — the caller flushes (which
 * opens the bit) before alarming, so a post-flush read would suppress
 * every alarm. An undefined file (absent, unreadable, first-ever run)
 * reads as alarm-due: fail-visible — a duplicate alarm costs one email,
 * a suppressed alarm costs the outage.
 */
export function episodeAlarmDue(file: HealthFile | undefined): boolean {
  return file?.outageOpen !== true;
}
```

#### 2. src/config.ts

**File**: src/config.ts

**Changes**: MODIFY — `JUDGE_HEALTH_PATH = "state/judge-health.json"` beside the single-writer doc block (the `JUDGE_CEILINGS_PATH:63-72` shape, doc-comment noting the watch run is the only writer and the workflow commits it back).

```ts
/**
 * Per-account provider health marks (single-writer doctrine, the
 * JUDGE_CEILINGS_PATH shape): the watch run is the ONLY writer — it
 * flushes the tick's outcome ledger on the success path and, best-effort,
 * from main's entry-module catch (src/index.ts:393-406) — and the watch
 * workflow commits the file back (the failure-path Commit health step).
 * A flat {version, marks, outageOpen} envelope with no timestamp or
 * staleness bound: marks self-heal (a stale mark costs at most the
 * 1-request probe per tick until the first success clears it), so the
 * file stays byte-identical on no-op runs. A missing or malformed file
 * degrades to no marks (the healthy default) and never fails a run
 * (src/judge-health.ts).
 */
export const JUDGE_HEALTH_PATH = "state/judge-health.json";
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the touched files: `npx biome check src/judge-health.ts src/config.ts`
- [x] The boundary holds — no judge-rotation → judge-health edge: `grep -n "judge-health" src/judge-rotation.ts` returns nothing

#### Manual Verification:
- [x] The module reads as the ceilings four-piece template (pure resolver / never-throw reader / atomic writer / semantic gate) with the boundary + byte-stability doctrine stated in the header

## Phase 2: Health module tests

### Overview

Delivers `tests/judge-health.test.ts` — the offline suite for every Phase 1 export: reader degrade matrix, resolver + tick-merge matrices, writer round-trip + byte-stability, ledger builder pool-order, episode transitions. Depends on Phase 1; parallel with nothing (its assertions pin Phase 1 behavior).

### Changes Required:

#### 1. tests/judge-health.test.ts

**File**: tests/judge-health.test.ts

**Changes**: NEW — `node:test` suite: lazy per-suite `mkdtemp` dir cleaned in one `after()` (`tests/judge-ceilings.test.ts:109-117` idiom); reader degrade matrix (absent → quiet default; malformed → warn naming the file; wrong version → treat-as-default); resolver validation; writer round-trip + byte-stability (identical marks → no write); tick-merge matrix (hard-fail streak+1 → capped at 2; success reset; absent unchanged; 429-only unchanged); ledger builder pool-order preservation (the empty-record invariant at `src/email.ts:181-182`); episode open/quiet/clear/re-open transitions.

```ts
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type AccountTickOutcome,
  buildDegradedAccountsLine,
  episodeAlarmDue,
  flushExhaustionHealth,
  flushHealthIfChanged,
  flushTickHealth,
  type HealthFile,
  loadAccountHealth,
  nextHealthFile,
  type OutcomeLedgerState,
  readTickOutcomes,
  resolveAccountHealth,
  stampFailure,
  stampSuccess,
  writeHealthAtomic,
} from "../src/judge-health.js";
import type { LlmAccount } from "../src/judge.js";

/** Two accounts with distinct hosts — the capped/streak cases need both. */
const ACCOUNTS: LlmAccount[] = [
  { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
  { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
];

/** Envelope builder: marks keyed by trimmed baseUrl, episode bit explicit. */
const file = (marks: Record<string, number>, outageOpen = false): HealthFile => ({
  version: 1,
  marks,
  outageOpen,
});

describe("resolveAccountHealth", () => {
  it("maps each marked account's streak by index", () => {
    const marks = resolveAccountHealth(ACCOUNTS, file({ "https://account-one.api/v1": 2 }));
    assert.deepEqual([...marks.entries()], [[0, 2]]);
  });

  it("drops zero, fractional, and non-numeric entries silently (missing data is the good state)", () => {
    const parsed = {
      "https://account-one.api/v1": 0,
      "https://account-two.api/v1": 2.5,
    } as unknown as HealthFile;
    assert.deepEqual([...resolveAccountHealth(ACCOUNTS, parsed).entries()], []);
  });

  it("drops a non-numeric entry", () => {
    const parsed = {
      "https://account-one.api/v1": "2",
    } as unknown as HealthFile;
    assert.deepEqual([...resolveAccountHealth(ACCOUNTS, parsed).entries()], []);
  });

  it("matches keys after trimming on both sides", () => {
    const marks = resolveAccountHealth(ACCOUNTS, file({ " https://account-one.api/v1 ": 2 }));
    assert.deepEqual([...marks.entries()], [[0, 2]]);
  });

  it("treats an undefined file as an empty map", () => {
    assert.deepEqual([...resolveAccountHealth(ACCOUNTS, undefined).entries()], []);
  });

  it("gives twin accounts sharing one baseUrl the same streak silently", () => {
    const twins: LlmAccount[] = [
      { baseUrl: "https://twin.api/v1", apiKey: "key-a", model: "model-a" },
      { baseUrl: "https://twin.api/v1", apiKey: "key-b", model: "model-b" },
    ];
    const marks = resolveAccountHealth(twins, file({ "https://twin.api/v1": 2 }));
    assert.deepEqual(
      [...marks.entries()],
      [
        [0, 2],
        [1, 2],
      ],
    );
  });
});

describe("nextHealthFile (the pure tick merge)", () => {
  it("increments a hard-failed account's streak", () => {
    const next = nextHealthFile(
      ACCOUNTS,
      file({ "https://account-one.api/v1": 2 }),
      { ok: [], failed: new Map([[1, "HTTP 503"]]) },
      false,
    );
    assert.deepEqual(next.marks, {
      "https://account-one.api/v1": 2,
      "https://account-two.api/v1": 1,
    });
  });

  it("resets a success to absent", () => {
    const next = nextHealthFile(
      ACCOUNTS,
      file({ "https://account-one.api/v1": 2, "https://account-two.api/v1": 1 }),
      { ok: [0], failed: new Map() },
      false,
    );
    assert.deepEqual(next.marks, { "https://account-two.api/v1": 1 });
  });

  it("keeps accounts the tick did not touch", () => {
    const next = nextHealthFile(
      ACCOUNTS,
      file({ "https://account-one.api/v1": 2 }),
      { ok: [], failed: new Map() },
      false,
    );
    assert.deepEqual(next.marks, { "https://account-one.api/v1": 2 });
  });

  it("prunes marks for accounts no longer in the pool", () => {
    const stale = file({ "https://gone.api/v1": 3, "https://account-one.api/v1": 1 });
    const next = nextHealthFile(ACCOUNTS, stale, { ok: [], failed: new Map() }, false);
    assert.deepEqual(next.marks, { "https://account-one.api/v1": 1 });
  });

  it("carries the outage bit verbatim", () => {
    const next = nextHealthFile(ACCOUNTS, file({}, true), { ok: [0], failed: new Map() }, true);
    assert.equal(next.outageOpen, true);
    assert.equal(next.version, 1);
  });
});

describe("stampFailure / stampSuccess / readTickOutcomes (the in-run ledger)", () => {
  /** Fresh hand-built OutcomeLedgerState: account 1 capped and probe-spent. */
  const ledgerState = (): OutcomeLedgerState => ({
    accounts: ACCOUNTS,
    cooldownUntil: new Map(),
    healthMarks: new Map([[1, 2]]),
    probedThisTick: new Set([1]),
    outcomeLedger: new Map<number, AccountTickOutcome>(),
  });

  it("stampFailure records the real cause on the ledger", () => {
    const state = ledgerState();
    stampFailure(state, 0, "HTTP 503");
    assert.deepEqual(state.outcomeLedger.get(0), { kind: "hard-failed", reason: "HTTP 503" });
  });

  it("stampSuccess clears the ledger to ok, frees the probe slot, and lifts the in-run cap", () => {
    const state = ledgerState();
    stampSuccess(state, 1);
    assert.deepEqual(state.outcomeLedger.get(1), { kind: "ok" });
    assert.equal(state.probedThisTick.has(1), false);
    assert.equal(state.healthMarks.has(1), false);
  });

  it("readTickOutcomes: last outcome wins — failure then success reads ok", () => {
    const state = ledgerState();
    stampFailure(state, 0, "HTTP 503");
    stampSuccess(state, 0);
    const outcomes = readTickOutcomes(state);
    assert.deepEqual(outcomes.ok, [0]);
    assert.equal(outcomes.failed.size, 0);
  });

  it("readTickOutcomes: last outcome wins — success then failure reads the reason", () => {
    const state = ledgerState();
    stampSuccess(state, 1);
    stampFailure(state, 1, "network error: socket hung up");
    const outcomes = readTickOutcomes(state);
    assert.deepEqual(outcomes.ok, []);
    assert.deepEqual([...outcomes.failed.entries()], [[1, "network error: socket hung up"]]);
  });
});

describe("buildFailuresFromLedger (the unified exhaustion record)", () => {
  it("carries real causes in pool order with the cooling-only fallback", () => {
    const state: OutcomeLedgerState = {
      accounts: ACCOUNTS,
      cooldownUntil: new Map([[0, 1000]]),
      healthMarks: new Map(),
      probedThisTick: new Set(),
      outcomeLedger: new Map([[1, { kind: "hard-failed", reason: "HTTP 503" }]]),
    };
    assert.deepEqual(buildFailuresFromLedger(state), [
      { account: 1, baseUrl: "https://account-one.api/v1", reason: "HTTP 429" },
      { account: 2, baseUrl: "https://account-two.api/v1", reason: "HTTP 503" },
    ]);
  });

  it("an all-cooling pool still produces a non-empty record (the 429 pin)", () => {
    const state: OutcomeLedgerState = {
      accounts: ACCOUNTS,
      cooldownUntil: new Map([
        [0, 1000],
        [1, 2000],
      ]),
      healthMarks: new Map(),
      probedThisTick: new Set(),
      outcomeLedger: new Map(),
    };
    const failures = buildFailuresFromLedger(state);
    assert.equal(failures.length, 2);
    assert.ok(failures.every((failure) => failure.reason === "HTTP 429"));
  });

  it("an account with no entry stays out of the record", () => {
    const state: OutcomeLedgerState = {
      accounts: ACCOUNTS,
      cooldownUntil: new Map([[1, 1000]]),
      healthMarks: new Map(),
      probedThisTick: new Set(),
      outcomeLedger: new Map(),
    };
    assert.deepEqual(buildFailuresFromLedger(state), [
      { account: 2, baseUrl: "https://account-two.api/v1", reason: "HTTP 429" },
    ]);
  });
});

describe("buildDegradedAccountsLine", () => {
  it("is undefined when no account is capped", () => {
    assert.equal(buildDegradedAccountsLine(ACCOUNTS, new Map([[0, 1]])), undefined);
    assert.equal(buildDegradedAccountsLine(ACCOUNTS, new Map()), undefined);
  });

  it("lists capped accounts, 1-based, with their base URLs", () => {
    const line = buildDegradedAccountsLine(ACCOUNTS, new Map([[0, 2]]));
    assert.match(line ?? "", /#1 https:\/\/account-one\.api\/v1/);
    assert.equal((line ?? "").includes("account-two"), false);
  });

  it("lists a capped account at exactly the threshold", () => {
    const line = buildDegradedAccountsLine(ACCOUNTS, new Map([[1, 2]]));
    assert.match(line ?? "", /#2 https:\/\/account-two\.api\/v1/);
  });
});

describe("writeHealthAtomic + loadAccountHealth", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  /** Lazy temp dir, one per suite (tests/judge-ceilings.test.ts idiom). */
  const path = async (name: string): Promise<string> => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-judge-health-"));
    return join(dir, name);
  };

  it("round-trips: write then load resolves the committed marks and episode bit", async () => {
    const target = await path("round-trip.json");
    await writeHealthAtomic(file({ "https://account-one.api/v1": 2 }, true), target);
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.deepEqual([...read.marks.entries()], [[0, 2]]);
    assert.equal(read.file?.outageOpen, true);
  });

  it("an absent file reads quiet — no marks, no envelope, no warn", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const read = await loadAccountHealth(ACCOUNTS, await path("absent.json"));
    assert.equal(read.file, undefined);
    assert.deepEqual([...read.marks.entries()], []);
    assert.equal(warns.mock.calls.length, 0);
  });

  it("a malformed file degrades with a reason warning", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("malformed.json");
    await writeFile(target, "{not json", "utf8");
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.equal(read.file, undefined);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /unreadable/);
  });

  it("a non-object file (an array) degrades", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("array.json");
    await writeFile(target, "[1, 2]", "utf8");
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.equal(read.file, undefined);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /not a JSON object/);
  });

  it("an unknown version degrades naming the version", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("wrong-version.json");
    await writeFile(
      target,
      JSON.stringify({ version: 99, marks: {}, outageOpen: false }),
      "utf8",
    );
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.equal(read.file, undefined);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /unknown version 99/);
  });

  it("a malformed marks object degrades", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("bad-marks.json");
    await writeFile(
      target,
      JSON.stringify({ version: 1, marks: [1, 2], outageOpen: false }),
      "utf8",
    );
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.equal(read.file, undefined);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /malformed marks/);
  });

  it("a failed write names the target", async () => {
    const blocker = await path("blocker");
    await writeFile(blocker, "occupies the directory slot", "utf8");
    await assert.rejects(
      () => writeHealthAtomic(file({}), join(blocker, "health.json")),
      (error: unknown) => {
        assert.match((error as Error).message, /^health: atomic write failed for /);
        return true;
      },
    );
  });
});

describe("flushHealthIfChanged (the byte-stability gate)", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  const path = async (name: string): Promise<string> => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-judge-health-gate-"));
    return join(dir, name);
  };

  it("skips the write when the next file is semantically identical", async () => {
    const target = await path("no-op.json");
    await writeHealthAtomic(file({ "https://account-one.api/v1": 2 }), target);
    const before = await readFile(target, "utf8");
    const wrote = await flushHealthIfChanged(file({ "https://account-one.api/v1": 2 }), target);
    assert.equal(wrote, false);
    assert.equal(await readFile(target, "utf8"), before);
  });

  it("writes when a mark changes", async () => {
    const target = await path("changed.json");
    await writeHealthAtomic(file({ "https://account-one.api/v1": 2 }), target);
    const wrote = await flushHealthIfChanged(file({ "https://account-one.api/v1": 3 }), target);
    assert.equal(wrote, true);
  });

  it("is order-insensitive: a different key insertion order with the same content writes nothing", async () => {
    const target = await path("key-order.json");
    await writeFile(
      target,
      `${JSON.stringify(
        { version: 1, outageOpen: false, marks: { "https://z.api/v1": 2, "https://a.api/v1": 1 } },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const wrote = await flushHealthIfChanged(
      file({ "https://a.api/v1": 1, "https://z.api/v1": 2 }),
      target,
    );
    assert.equal(wrote, false);
  });

  it("repairs a corrupted current file", async () => {
    const target = await path("corrupt.json");
    await writeFile(target, "{broken", "utf8");
    const wrote = await flushHealthIfChanged(file({}, false), target);
    assert.equal(wrote, true);
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.version, 1);
  });
});

describe("the episode lifecycle through the flush wrappers", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  const path = async (name: string): Promise<string> => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-judge-health-episode-"));
    return join(dir, name);
  };

  it("opens on the first exhaustion flush and records the streak", async () => {
    const target = await path("episode-1.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    assert.equal(stored.marks["https://account-one.api/v1"], 1);
  });

  it("stays open across later dead ticks while streaks grow (alarm quietness is index's job)", async () => {
    const target = await path("episode-2.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const base = (await loadAccountHealth(ACCOUNTS, target)).file;
    await flushExhaustionHealth(
      ACCOUNTS,
      base,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    assert.equal(stored.marks["https://account-one.api/v1"], 2);
  });

  it("clears on a run with a healthy dispatch and resets the streak", async () => {
    const target = await path("episode-3.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const base = (await loadAccountHealth(ACCOUNTS, target)).file;
    await flushTickHealth(ACCOUNTS, base, { ok: [0], failed: new Map() }, target);
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, false);
    assert.equal(stored.marks["https://account-one.api/v1"], undefined);
  });

  it("re-opens on the next outage", async () => {
    const target = await path("episode-4.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    await flushTickHealth(
      ACCOUNTS,
      (await loadAccountHealth(ACCOUNTS, target)).file,
      { ok: [0], failed: new Map() },
      target,
    );
    await flushExhaustionHealth(
      ACCOUNTS,
      (await loadAccountHealth(ACCOUNTS, target)).file,
      { ok: [], failed: new Map([[1, "network error: socket hung up"]]) },
      target,
    );
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    assert.equal(stored.marks["https://account-two.api/v1"], 1);
  });

  it("stays open on a green run where nothing dispatched ok", async () => {
    const target = await path("episode-5.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const base = (await loadAccountHealth(ACCOUNTS, target)).file;
    await flushTickHealth(ACCOUNTS, base, { ok: [], failed: new Map() }, target);
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
  });

  it("a failed flush warns instead of throwing (best-effort)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const blocker = await path("flush-blocker");
    await writeFile(blocker, "occupies the directory slot", "utf8");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map() },
      join(blocker, "health.json"),
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /flush failed/.test(line)));
  });

  it("a green no-op tick writes nothing at all", async () => {
    const target = await path("no-op-tick.json");
    await writeHealthAtomic(file({}, false), target);
    const before = await readFile(target, "utf8");
    await flushTickHealth(ACCOUNTS, file({}, false), { ok: [], failed: new Map() }, target);
    assert.equal(await readFile(target, "utf8"), before);
  });
});

describe("episodeAlarmDue (the one-alarm gate)", () => {
  it("is true when no file exists (absent, unreadable, first-ever run)", () => {
    assert.equal(episodeAlarmDue(undefined), true);
  });

  it("is true when the episode bit is closed", () => {
    assert.equal(episodeAlarmDue(file({}, false)), true);
  });

  it("is false when the episode bit is open — the alarm already fired", () => {
    assert.equal(episodeAlarmDue(file({}, true)), false);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] The new suite passes: `npx tsx --test tests/judge-health.test.ts`
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the touched file: `npx biome check tests/judge-health.test.ts`
- [x] The one-alarm gate: `episodeAlarmDue` is true on an absent/closed file and false on an open bit (both branches in the suite)

#### Manual Verification:
- [x] Every Phase 1 export has at least one happy-path + one degrade assertion (the 1:1 mirror rule); the episode lifecycle pins open / stays-open / clear / re-open at file level

## Phase 3: Rotation fields + inline pick

### Overview

Extends `RotationState` with the three plain health fields and inlines the half-open predicate in `pickEligibleAccount` (probe registration rides `claimAccount`); updates ALL THREE `RotationState` literals — judge.ts's state construction and both suites' `freshState` helpers — so the tree typechecks green between phases (behavior identical to HEAD until Phase 4 wires the stamps). Depends on Phase 1 (conceptual ordering only — `judge-rotation.ts` gains NO import of it); Phase 4 builds directly on this state shape.

### Changes Required:

#### 1. src/judge-rotation.ts

**File**: src/judge-rotation.ts

**Changes**: MODIFY — module header gains the boundary paragraph; `RotationState` gains `healthMarks: Map<number, number>` (in-run, MUTABLE — `stampSuccess` deletes on a probe success so the account rejoins at its committed ceiling for the rest of the tick), `probedThisTick: Set<number>`, and `outcomeLedger: Map<number, { kind: "ok" } | { kind: "hard-failed"; reason: string }>` (structurally `AccountTickOutcome`, inlined as a plain union — no import of judge-health — and doc-commented). A paired local `HEALTH_CAP_STREAK = 2` constant feeds the inlined pick predicate (cross-referenced to judge-health's `HARD_FAIL_TICKS_TO_CAP`; the drift risk is documented at both sites). `pickEligibleAccount` inlines the half-open predicate: capped (mark ≥ HEALTH_CAP_STREAK) accounts gate on `probedThisTick` and run at effective ceiling 1; uncapped accounts keep the committed ceiling; the capped=false path is byte-identical to HEAD (verifier-traced). `claimAccount` registers a capped account's claim in `probedThisTick` (the same sync window as the pick). `failuresFromCooldowns` consumption switches to `buildFailuresFromLedger` in Phase 4 (the helper stays intact here).

```ts
// 1) Module header: append to the top doc block, after the "Spread model
// (D1/D6)" paragraph, before the import lines.
//
//  * Health circuit (the provider-health boundary): the state carries the
//  * health marks, the per-tick probe ledger, and the outcome ledger as plain
//  * fields — the outcome shape is a plain inline union structurally equal to
//  * the judge-health module's AccountTickOutcome, and NO import of that
//  * module exists, keeping this module's zero-runtime-import identity. The
//  * pick applies the cap and the half-open probe INLINE as plain field
//  * reads; the cap threshold pairs with that module's
//  * HARD_FAIL_TICKS_TO_CAP via the local HEALTH_CAP_STREAK constant (the
//  * two MUST stay equal).

// 2) RotationState: insert after the `inFlight` field block.
  /** 0-based account index -> hard-failed streak, seeded by index.ts from
   *  the health file. MUTABLE in-run: a successful probe DELETES the entry
   *  so the account rejoins at its committed ceiling for the rest of the
   *  tick (the judge-health stampSuccess helper). The pick reads it here;
   *  only the end-of-tick flush writes the FILE. */
  readonly healthMarks: Map<number, number>;
  /** Accounts already probe-dispatched this tick (the half-open gate):
   *  a capped account is dispatchable until its first claim registers it
   *  here, then blocked until a success frees it. Resets naturally per
   *  judgePosts call — one tick. */
  readonly probedThisTick: Set<number>;
  /** 0-based account index -> the account's LAST dispatch outcome this
   *  tick. The judge core stamps hard failures with their real cause and
   *  successes (the judge-health stamp helpers, Phase 4 call sites); the
   *  unified exhaustion record and the end-of-tick flush derive from it.
   *  Plain union — structurally the judge-health AccountTickOutcome. */
  readonly outcomeLedger: Map<
    number,
    { kind: "ok" } | { kind: "hard-failed"; reason: string }
  >;

// 3) Module constant: insert after the WAKE_JITTER_MS block.
/**
 * Consecutive hard-failed ticks that cap an account at ceiling 1 — the
 * paired twin of the judge-health module's HARD_FAIL_TICKS_TO_CAP (no
 * import exists: this module reads plain state fields only, the D5
 * boundary). The two MUST stay equal; both doc sites say so.
 */
const HEALTH_CAP_STREAK = 2;

// 4) pickEligibleAccount: replace the whole function.
export function pickEligibleAccount(
  state: RotationState,
  nowMs: number,
  startAt?: number,
): { index: number; account: LlmAccount } | undefined {
  const poolSize = state.accounts.length;
  const start = startAt ?? state.dispatchCounter % poolSize;
  for (let offset = 0; offset < poolSize; offset += 1) {
    const index = (start + offset) % poolSize;
    const account = state.accounts[index];
    if (account === undefined) continue;
    const expiry = state.cooldownUntil.get(index);
    if (expiry !== undefined && expiry > nowMs) continue;
    // Health circuit, INLINE plain-field reads (no judge-health import):
    // a capped account runs at effective ceiling 1 and is half-open — its
    // first dispatch of the tick is the probe; further picks stay blocked
    // until a success frees it (stampSuccess deletes the mark AND the
    // probe slot, rejoining at the COMMITTED ceiling).
    const capped = (state.healthMarks.get(index) ?? 0) >= HEALTH_CAP_STREAK;
    if (capped && state.probedThisTick.has(index)) continue;
    const ceiling = capped ? 1 : (state.ceilings.get(index) ?? 1);
    if ((state.inFlight.get(index) ?? 0) >= ceiling) continue;
    return { index, account };
  }
  return undefined;
}

// 5) claimAccount: replace the whole function (adds probe registration).
export function claimAccount(state: RotationState, accountIndex: number): void {
  const current = state.inFlight.get(accountIndex) ?? 0;
  state.inFlight.set(accountIndex, current + 1);
  state.dispatchCounter = accountIndex + 1;
  // The half-open probe ledger: a capped account's dispatch IS its probe
  // for this tick. Registered at claim time in the same sync window as
  // the pick; a later success deletes the entry, freeing the rest of the
  // tick at the committed ceiling (the judge-health stampSuccess).
  if ((state.healthMarks.get(accountIndex) ?? 0) >= HEALTH_CAP_STREAK) {
    state.probedThisTick.add(accountIndex);
  }
}
```

#### 2. src/judge.ts

**File**: src/judge.ts

**Changes**: MODIFY — ONLY the `RotationState` literal at `:735-744` gains the three empty initializers, keeping the tree typecheck-green between phases; behavior is identical to HEAD until Phase 4 wires the stamps.

```ts
  const state: RotationState = {
    accounts,
    cooldownUntil: new Map(),
    ceilings,
    inFlight: new Map(),
    healthMarks: new Map(),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: WAIT_BUDGET_MS,
  };
```

#### 3. tests/judge-rotation.test.ts

**File**: tests/judge-rotation.test.ts

**Changes**: MODIFY — `freshState` gains the three fields; a new describe pins probe saturation, the committed-ceiling rejoin (claims = 8 at ceiling 8, seat 1 cooldown-blocked), uncapped-ignores-the-ledger, and streak-1-not-capped. The existing 429-record, zero-charge waiter, dial-wrap, and budget pins pass unmodified.

```ts
function freshState(
  accounts: LlmAccount[],
  ceilings: ReadonlyMap<number, number> = new Map(),
): RotationState {
  return {
    accounts,
    cooldownUntil: new Map(),
    ceilings,
    inFlight: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: 180_000,
    healthMarks: new Map(),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
  };
}

describe("health-circuit pick: the inline half-open probe", () => {
  it("a capped account is dispatchable until its probe claims it, then blocked", () => {
    const state = freshState(twoAccounts());
    state.healthMarks.set(0, 2);
    const first = pickEligibleAccount(state, 0);
    assert.equal(first?.index, 0); // the probe seat is open
    claimAccount(state, 0);
    assert.equal(state.probedThisTick.has(0), true);
    state.cooldownUntil.set(1, 10_000); // block the only other seat
    assert.equal(pickEligibleAccount(state, 0), undefined); // half-open: probe spent
  });

  it("a successful probe frees the tick — the account rejoins at its COMMITTED ceiling", () => {
    const state = freshState(twoAccounts(), new Map([[0, 8]]));
    state.healthMarks.set(0, 2);
    claimAccount(state, 0); // the probe
    assert.equal(state.probedThisTick.has(0), true);
    // stampSuccess's in-run effect (the judge-health helper, Phase 4 call
    // sites): the mark and the probe slot delete together.
    state.healthMarks.delete(0);
    state.probedThisTick.delete(0);
    state.cooldownUntil.set(1, 10_000); // block the other seat — the loop measures seat 0 only
    // Rejoined at the committed ceiling 8: the pick keeps returning the
    // seat until inFlight reaches 8.
    let claims = 1; // the probe claim already sits in inFlight
    while (pickEligibleAccount(state, 0) !== undefined) {
      claimAccount(state, 0);
      claims += 1;
    }
    assert.equal(claims, 8);
    assert.equal(state.inFlight.get(0), 8);
  });

  it("an uncapped account ignores the probe ledger entirely", () => {
    const state = freshState(twoAccounts());
    state.probedThisTick.add(0); // dispatched earlier this tick, NOT capped
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 0);
  });

  it("the cap reads at HEALTH_CAP_STREAK — a streak of 1 neither caps nor registers a probe", () => {
    const state = freshState(twoAccounts(), new Map([[0, 2]]));
    state.healthMarks.set(0, 1);
    claimAccount(state, 0);
    assert.equal(state.probedThisTick.has(0), false); // below the threshold: no probe registered
    state.cooldownUntil.set(1, 10_000); // block the other seat
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 0); // still dispatchable at the committed ceiling
  });
});
```

#### 4. tests/judge.test.ts

**File**: tests/judge.test.ts

**Changes**: MODIFY — its own `freshState` helper (the verifier-found second `RotationState` literal, a mirror of the rotation suite's) gains the three fields.

```ts
function freshState(accounts: LlmAccount[]): RotationState {
  // waitBudgetRemainingMs mirrors the module-private 3-minute WAIT_BUDGET_MS.
  // ceilings default: an empty map reads as ceiling 1 per account (the
  // pick's floor) — the same degrade as an absent ceilings file.
  return {
    accounts,
    cooldownUntil: new Map(),
    ceilings: new Map(),
    inFlight: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: 180_000,
    healthMarks: new Map(),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
  };
}
```

### Success Criteria:

#### Automated Verification:
- [x] The rotation suite passes: `npx tsx --test tests/judge-rotation.test.ts`
- [x] The judge suite passes: `npx tsx --test tests/judge.test.ts`
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the touched files: `npx biome check src/judge-rotation.ts src/judge.ts tests/judge-rotation.test.ts tests/judge.test.ts`
- [x] The boundary holds — no judge-health import edge: `grep -n "from \"./judge-health" src/judge-rotation.ts` returns nothing

#### Manual Verification:
- [x] The pick predicate reads as inline plain-field reads with the paired-constant doc; the existing 429-record, zero-charge waiter, dial-wrap, and budget pins pass unmodified

## Phase 4: Judge core stamps + hang arm

### Overview

Wires `judge.ts` to the ledger: stamps at the four attempt-branch sites plus the `countsSuccess`-gated success resolve (a batch parse-miss stamps NOTHING — a model failure is not an account outcome), the third flavor arm closing the all-health-blocked hang (progress-aware: uncapped accounts never block; capped accounts block only when probe-spent AND drained), the `exhaustionRecord` merge keeping the alarm non-empty at every throw site, the `judgePosts` trailing marks parameter, the tick-outcome return, and the `RotationExhausted` health payload (judge-rotation.ts joins the change set: interface + factory + the `failuresFromCooldowns` deletion). Depends on Phase 3 (state shape); Phase 6 consumes the return shape.

### Changes Required:

#### 1. src/judge.ts

**File**: src/judge.ts

**Changes**: MODIFY — imports (judge-health runtime block; `failuresFromCooldowns` dropped from the judge-rotation block; `AccountFailure` joins the types import); header paragraph; `ContentDecision` resolve gains the required `countsSuccess` flag (parse-miss → false, real verdicts → true; the core stamps only when true); module-private `terminalFailureReason` / `allHealthBlocked` / `exhaustionRecord`; the third flavor arm BEFORE `waitCeilingSlot`; terminal/transport stamps and the gated success stamp; `judgePosts` trailing `healthMarks` param (index.ts's positional call and every existing test call stay green), `new Map(healthMarks)` in the literal, Σ-effective-caps width, `outcomes` on `JudgeBatchResult`, both joins throw `(exhaustionRecord(state), readTickOutcomes(state))`, judgePost's throw stays health-less.

```ts
// 1) Imports — the judge-rotation block drops failuresFromCooldowns:
import {
  type RotationState,
  claimAccount,
  coolAccount,
  earliestCooldown,
  isRotationExhausted,
  parkUntilEligible,
  pickEligibleAccount,
  releaseAccount,
  rotationExhausted,
  waitCeilingSlot,
} from "./judge-rotation.js";
// A new runtime block joins (alphabetical, before ./judge-parse.js):
import {
  HARD_FAIL_TICKS_TO_CAP,
  type TickOutcomes,
  buildFailuresFromLedger,
  readTickOutcomes,
  stampFailure,
  stampSuccess,
} from "./judge-health.js";
// The types import gains AccountFailure:
import type { AccountFailure, JudgeVerdict, Post } from "./types.js";

// 2) Module header doc — appended paragraph:
//  * Provider health (the circuit): per-attempt outcomes stamp an in-run
//  * ledger — 429s never count (the cooldown map carries them), terminal 5xx /
//  * 401 / 403 / transport errors stamp their real cause, successes stamp ok
//  * (last outcome wins). A capped account (healthMarks streak >= 2) runs at
//  * effective ceiling 1 and is half-open: its first dispatch is the tick's
//  * probe; a success frees it for the rest of the tick. An all-health-blocked
//  * pick with no active cooldown exhausts immediately instead of hanging on
//  * the release queue.

// 3) ContentDecision — FULL REPLACEMENT:
type ContentDecision<T> =
  | { action: "resolve"; value: T; countsSuccess: boolean }
  | { action: "retry" }
  | { action: "defer" };
// countsSuccess marks a genuine model answer: a parse-miss resolve counts
// NEITHER success nor failure — a model failure is not an account outcome
// (the research's non-health boundary).

// 4) Module-private helpers — inserted before dispatchLlmCall:
/**
 * The real-cause string a terminal non-ok status stamps on the ledger.
 * 401/403 mean the key is dead — the alarm should say so, not just the
 * status code.
 */
function terminalFailureReason(status: number): string {
  return status === 401 || status === 403 ? `HTTP ${status} — key dead` : `HTTP ${status}`;
}

/**
 * True when the pick found nothing BECAUSE of the health circuit. An
 * uncapped account always makes progress on a release (its claims return
 * and the queue wakes), so it can never permanently block the pool — this
 * is what keeps the zero-charge ceiling wait alive for a healthy saturated
 * pool. A capped account is permanently blocked only when its probe is
 * spent AND no claim is outstanding that could still succeed and free it.
 * No cooldown is active at the call site (the flavor split checks that
 * first). Plain field reads; inline by design (judge-rotation owns no
 * health concept — the boundary).
 */
function allHealthBlocked(state: RotationState): boolean {
  return state.accounts.every((_, index) => {
    const capped = (state.healthMarks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP;
    if (!capped) return false;
    return state.probedThisTick.has(index) && (state.inFlight.get(index) ?? 0) === 0;
  });
}

/**
 * The exhaustion record with the health fallback: the ledger's real causes
 * first (cooling-only accounts carry "HTTP 429" inside
 * buildFailuresFromLedger), then any capped account the ledger cannot
 * explain appended — a probe that answered unusably stamps nothing, but
 * the alarm must still name the account. Non-empty at every throw site by
 * construction: the arm fires only when every account is cooling, ledgered,
 * or capped (src/email.ts:181-182 renders null on an empty record while
 * exit 1 still fires — the exact silent-alarm this prevents).
 */
function exhaustionRecord(state: RotationState): AccountFailure[] {
  const record = buildFailuresFromLedger(state);
  const listed = new Set(record.map((failure) => failure.account));
  for (const [index, account] of state.accounts.entries()) {
    const capped = (state.healthMarks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP;
    if (capped && !listed.has(index + 1)) {
      record.push({
        account: index + 1,
        baseUrl: account.baseUrl,
        reason: "capped by provider health",
      });
    }
  }
  return record;
}

// 5) dispatchLlmCall — the undefined-pick flavor split grows the third arm:
    if (picked === undefined) {
      // Every account is cooling or at its ceiling — split the flavors
      // (D4): an active cooldown parks through the shared budget (the
      // only road to the exhaustion terminal, OUTSIDE the try below — a
      // throw here would be swallowed by the catch and misread as a
      // transport error); an all-at-ceiling pick has no expiry, so it
      // waits on the release queue at ZERO budget charge — a healthy
      // backlog can never false-trip the alarm. A health-blocked pool is
      // the third flavor: every account capped with its probe spent and
      // drained, no cooldown pending — the release queue would never
      // wake, so the terminal trips immediately at zero budget charge.
      if (earliestCooldown(state, now()) !== undefined) {
        if (!(await parkUntilEligible(state, now, sleepFn))) {
          return { status: "exhausted" };
        }
      } else if (allHealthBlocked(state)) {
        return { status: "exhausted" };
      } else {
        await waitCeilingSlot(state);
      }
      attempt -= 1; // the wait is not a retry — do not spend an attempt
      continue;
    }

// 6) dispatchLlmCall — the terminal non-ok branch stamps (after
// warns.statusFailure, before the return):
          warns.statusFailure(attemptIndex + 1, attempt + 1, response.status, response.statusText);
          // Terminal for this call: spent backoff or a non-retryable
          // status. The stamp records the REAL cause (the mid-backoff
          // branch above never stamps — a 5xx that recovers within backoff
          // must not count against the account; a success later would
          // overwrite the ledger anyway, last outcome wins).
          stampFailure(state, attemptIndex, terminalFailureReason(response.status));
          // Spent backoff or a non-retryable status: defer the batch whole
          // (its posts stay unseen and retry next run); the post ladder
          // spends the attempt instead.
          return backoff5xx ? { action: "defer" } : { action: "retry" };

// 7) dispatchLlmCall — the transport branch stamps (inside the catch, after
// warns.transportError):
      } catch (error) {
        // A transport error is not an account problem: nothing cools. The
        // batch defers the whole call (a dead socket predicts a dead
        // fallback); the post spends an attempt and retries.
        const message = error instanceof Error ? error.message : String(error);
        warns.transportError(attemptIndex + 1, attempt + 1, message);
        stampFailure(state, attemptIndex, `network error: ${message}`);
        return deferOnTransport ? { action: "defer" } : { action: "retry" };
      } finally {

// 8) dispatchLlmCall — the resolve decision stamps ONLY a genuine success:
        if (decision.action === "resolve") {
          if (decision.countsSuccess) {
            // The success stamp flips the ledger to ok (last outcome wins),
            // frees the half-open probe slot, and lifts the in-run cap — the
            // account rejoins at its committed ceiling for the rest of the
            // tick. A parse-miss resolve stamps NOTHING: a model failure is
            // not an account outcome.
            stampSuccess(state, attemptIndex);
          }
          return { action: "answered", value: decision.value };
        }

// 9) judgeBatch — the parse-miss resolve site:
        // A parse miss is a model failure, not a transport one: report the
        // call answered-empty so the caller falls back per item. It stamps
        // NOTHING on the health ledger (countsSuccess: false) — a broken
        // model must not clear a dead account's streak or open the episode.
        return { action: "resolve", value: new Map(), countsSuccess: false };
// judgeBatch's real-verdict resolve site:
      return { action: "resolve", value: verdicts, countsSuccess: true };
// judgePost's verdict resolve site:
      return { action: "resolve", value: verdict, countsSuccess: true };

// 10) judgePosts — signature grows the TRAILING optional healthMarks (after
// sleepFn; index.ts's positional call and every existing test call stay
// typecheck-green until Phase 6):
export async function judgePosts(
  candidates: readonly Post[],
  accounts: readonly LlmAccount[],
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
  ceilings: ReadonlyMap<number, number> = new Map(),
  now: () => number = Date.now,
  sleepFn: SleepFn = sleep,
  healthMarks: ReadonlyMap<number, number> = new Map(),
): Promise<JudgeBatchResult> {
// the state literal's healthMarks line becomes:
    healthMarks: new Map(healthMarks),

// 11) judgePosts — pool width becomes the effective-cap sum (the state is
// constructed before this line):
  const width = Math.max(
    1,
    [...ceilings.entries()].reduce(
      (sum, [index, ceiling]) =>
        sum + ((state.healthMarks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP ? 1 : ceiling),
      0,
    ),
  );

// 12) JudgeBatchResult gains the required outcomes field:
export interface JudgeBatchResult {
  judged: JudgedPost[];
  skippedPostIds: string[];
  /** Per-account dispatch outcomes of the run — index.ts flushes them into
   *  the health file (judge-health flushTickHealth) and the heartbeat/
   *  digest degraded line reads the capped set. */
  outcomes: TickOutcomes;
}
// the assembly return becomes:
  return { judged, skippedPostIds, outcomes: readTickOutcomes(state) };

// 13) All three throw sites — judgePosts' two joins carry the health payload:
    throw rotationExhausted(exhaustionRecord(state), readTickOutcomes(state));
// judgePost's own throw stays health-less (standalone judgePost exhaustion
// is a test-only terminal; the joins carry the payload):
    throw rotationExhausted(exhaustionRecord(state));
```

#### 2. src/judge-rotation.ts

**File**: src/judge-rotation.ts

**Changes**: MODIFY — `RotationExhausted` gains the optional `health` payload (conditional assignment under `exactOptionalPropertyTypes`); the factory gains the optional second param; a type-only `TickOutcomes` import joins (the D5 idiom — the module's first import); `failuresFromCooldowns` is DELETED (judge.ts was its only importer and switches in this slice; no test imports it).

```ts
// 1) Type-only import beside the existing :28-32 block (alphabetical:
// ./judge-health.js sorts before ./judge.js).
import type { TickOutcomes } from "./judge-health.js";

// 2) RotationExhausted interface — FULL REPLACEMENT:
/** The tagged error judgePosts throws when every LLM_ACCOUNTS entry failed. */
export interface RotationExhausted extends Error {
  name: typeof ROTATION_EXHAUSTED;
  /** One entry per account that failed, in the order rotation left them. */
  failures: AccountFailure[];
  /** The tick's per-account outcomes — the health flush rides the error to
   *  main's catch. Absent when the error was built without one (standalone
   *  judgePost exhaustion; tests constructing the type bare). */
  health?: TickOutcomes;
}

// 3) rotationExhausted factory — FULL REPLACEMENT:
/** Build a pool-exhausted error carrying the per-account record. */
export function rotationExhausted(
  failures: readonly AccountFailure[],
  health?: TickOutcomes,
): RotationExhausted {
  const error = new Error(
    `judge: all ${failures.length} LLM_ACCOUNTS account(s) exhausted — ${failures
      .map((f) => `account ${f.account} (${f.baseUrl}): ${f.reason}`)
      .join("; ")}`,
  ) as RotationExhausted;
  error.name = ROTATION_EXHAUSTED;
  error.failures = [...failures];
  if (health !== undefined) {
    error.health = health;
  }
  return error;
}

// 4) failuresFromCooldowns — DELETE the function and its doc block
// (src/judge-rotation.ts:233-251). Its doctrine moves to judge-health's
// buildFailuresFromLedger (the cooling-only "HTTP 429" fallback lives there).
```

#### 3. tests/judge.test.ts

**File**: tests/judge.test.ts

**Changes**: MODIFY — the judge-rotation import gains `isRotationExhausted` + `type RotationExhausted`; a new describe pins the stamps (401 terminal, success-clears last-wins, transport reason, 429-never-stamps + health-less standalone throw, 503-terminal-only, parse-miss-stamps-nothing) and the all-health-blocked exhaustion with the mixed-reason merged record.

```ts
// Imports — replace the existing `import type { RotationState } from
// "../src/judge-rotation.js";` line:
import {
  type RotationExhausted,
  type RotationState,
  isRotationExhausted,
} from "../src/judge-rotation.js";

describe("health ledger stamps (the four branch sites)", () => {
  function twoAccounts(): LlmAccount[] {
    return [
      { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
      { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
    ];
  }

  it("a 401 terminal stamps the ledger with the key-dead reason", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> =>
      new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;
    const verdict = await judgePost(bulkPost(id19(1)), state, KEYWORDS, mockFetch);
    assert.equal(verdict, null); // both attempts spent
    assert.deepEqual(state.outcomeLedger.get(0), {
      kind: "hard-failed",
      reason: "HTTP 401 — key dead",
    });
  });

  it("a success stamps ok and overwrites a prior hard failure (last outcome wins)", async () => {
    const state = freshState(singleAccount);
    let calls = 0;
    const mockFetch = (async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) return new Response("Service Unavailable", { status: 503 });
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const verdict = await judgePost(bulkPost(id19(1)), state, KEYWORDS, mockFetch);
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
    assert.deepEqual(state.outcomeLedger.get(0), { kind: "ok" });
  });

  it("a transport error stamps the network-error reason", async () => {
    const state = freshState(singleAccount);
    const mockFetch = (async (): Promise<Response> => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const verdict = await judgePost(bulkPost(id19(1)), state, KEYWORDS, mockFetch);
    assert.equal(verdict, null);
    assert.deepEqual(state.outcomeLedger.get(0), {
      kind: "hard-failed",
      reason: "network error: socket hang up",
    });
  });

  it("a 429 never stamps the ledger and the standalone throw carries no health payload", async () => {
    const state = freshState(twoAccounts());
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    const inertSleep = (): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePost(
        bulkPost(id19(1)),
        state,
        KEYWORDS,
        mockFetch,
        "medium",
        Date.now,
        inertSleep,
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    assert.equal(state.outcomeLedger.size, 0); // the non-countable flavor
    assert.equal((caught as RotationExhausted).health, undefined);
  });

  it("a 503 stamps the TERMINAL branch only, and the run returns the outcomes", async () => {
    const posts = [bulkPost(id19(1))];
    const delays: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    };
    const mockFetch = (async (): Promise<Response> =>
      new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;
    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch,
      "medium",
      new Map([[0, 2]]),
      Date.now,
      inertSleep,
    );
    assert.deepEqual(delays, [1_000, 2_000, 4_000]); // the three mid-backoff sleeps — none stamped
    assert.deepEqual(result.skippedPostIds, posts.map((p) => p.id)); // then the terminal defer
    assert.deepEqual([...result.outcomes.failed.entries()], [[0, "HTTP 503"]]);
    assert.deepEqual(result.outcomes.ok, []);
  });

  it("a parse miss on both ladders stamps nothing (a model failure is not an account outcome)", async () => {
    const posts = [bulkPost(id19(1))];
    const mockFetch = (async (): Promise<Response> =>
      ok("I am not JSON at all")) as unknown as typeof fetch;
    const result = await judgePosts(posts, singleAccount, KEYWORDS, mockFetch);
    assert.deepEqual(result.skippedPostIds, posts.map((p) => p.id));
    assert.equal(result.outcomes.ok.length, 0);
    assert.equal(result.outcomes.failed.size, 0);
  });

  it("an all-health-blocked pool exhausts instead of hanging — the record merges ledger causes with the capped appendix", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch — the parse-miss sends every post to the fallback ladder
    const delays: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    };
    const mockFetch = (async (
      _url: unknown,
      options?: unknown,
    ): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        response_format?: unknown;
      };
      if (body.response_format !== undefined) {
        return ok("I am not JSON at all"); // bulk parse-miss: answered-empty, NO health stamp
      }
      return new Response("Service Unavailable", { status: 503 }); // the single-post probes hard-fail
    }) as unknown as typeof fetch;
    let caught: unknown;
    try {
      await judgePosts(
        posts,
        twoAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        new Map([
          [0, 4],
          [1, 4],
        ]),
        Date.now,
        inertSleep,
        new Map([
          [0, 2],
          [1, 2],
        ]),
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    const exhausted = caught as RotationExhausted;
    assert.deepEqual(
      exhausted.failures.map((f) => f.account),
      [1, 2],
    );
    assert.deepEqual(
      exhausted.failures.map((f) => f.reason),
      ["capped by provider health", "HTTP 503"],
    );
    assert.deepEqual(exhausted.health?.ok, []);
    assert.deepEqual([...(exhausted.health?.failed.entries() ?? [])], [[1, "HTTP 503"]]);
    assert.deepEqual(delays, []); // zero park AND zero backoff — the arm fired on drained, stamped probes
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] The judge suite passes: `npx tsx --test tests/judge.test.ts`
- [x] The rotation suite passes (regression): `npx tsx --test tests/judge-rotation.test.ts`
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the touched files: `npx biome check src/judge.ts src/judge-rotation.ts tests/judge.test.ts`
- [x] failuresFromCooldowns is gone: `grep -rn "failuresFromCooldowns" src/ tests/` returns nothing (sole survivor: the Phase 1 provenance doc-comment inside judge-health.ts itself — no code reference)

#### Manual Verification:
- [x] The flavor split reads as three arms (cooldown park → health-blocked exhaustion → ceiling wait); the stamps sit at exactly the four branch sites plus the countsSuccess-gated resolve; the existing 429 pins keep reason "HTTP 429" and the zero-charge waiter pin still parks-and-wakes

## Phase 5: Email + heartbeat riders

### Overview

Adds the degraded-accounts line to the digest and the heartbeat (the `LegLine` rider pattern — absent-when-healthy, never empty) and grows the exhaustion-reason fixtures additively. This module is a DECOUPLED RENDERER: the line string stays owned by judge-health's `buildDegradedAccountsLine` (Phase 1); Phase 6 passes the rendered value. Depends on Phase 1; Phase 6 passes the line.

### Changes Required:

#### 1. src/email.ts

**File**: src/email.ts

**Changes**: MODIFY — `buildDigest`/`sendDigest` gain an optional trailing `degradedAccounts?: string` param rendered as one paragraph after the leg line (only-when-present, the `:85-90` leg-line shape); `buildExhaustionText` unchanged (reason interpolates verbatim at `:185`).

```ts
// 1) buildDigest — FULL REPLACEMENT (doc updated):
/**
 * Build plain-text digest body (FRD #7, UX non-functional requirement).
 * Returns null when posts array is empty.
 *
 * The LinkedIn leg line (D13): rides the body ONLY when the leg state is
 * not ok — an ok leg is the quiet default, and sendDigest renders the
 * line only then; undefined omits it entirely. The ` — detail` suffix
 * rides the legDetailSuffix helper.
 *
 * The degraded-accounts line (provider health): the pre-rendered string
 * from judge-health's buildDegradedAccountsLine rides ONLY when some
 * account is capped — absent from healthy emails, never empty (byte
 * compatibility with the pre-health fixtures).
 */
export function buildDigest(
  posts: readonly Post[],
  leg?: LegLine,
  degradedAccounts?: string,
): string | null {
  const subject = buildSubject(posts);
  if (subject === null) return null;

  const items = posts.map((post, index) => {
    const author = post.author.replace(/^@+/, "");
    const platformToken = post.platform === "threads" ? "" : "[linkedin] ";
    return `${index + 1}. ${platformToken}${post.text}\n   — @${author}\n   ${post.permalink}`;
  });

  const legLine =
    leg !== undefined && leg.status !== "ok"
      ? `\n\nLinkedIn leg: ${leg.status}${legDetailSuffix(leg)}`
      : "";
  const degradedLine =
    degradedAccounts !== undefined && degradedAccounts !== "" ? `\n\n${degradedAccounts}` : "";
  return `${subject}\n\n${items.join("\n\n")}${legLine}${degradedLine}\n`;
}

// 2) sendDigest — signature grows the 5th optional param and the build call
// passes it through (the rest of the body is unchanged):
export async function sendDigest(
  posts: readonly Post[],
  config: EmailConfig,
  transport?: Transporter,
  leg?: LegLine,
  degradedAccounts?: string,
): Promise<SendDigestResult> {
  if (posts.length === 0) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const subject = buildSubject(posts);
  const text = buildDigest(posts, leg, degradedAccounts);
  // ... unchanged from here (null guard, sendText, log, return)
}
```

#### 2. src/heartbeat.ts

**File**: src/heartbeat.ts

**Changes**: MODIFY — `HeartbeatStats` gains `degradedAccounts?: string`; `buildHeartbeatBody` renders one conditional two-space-indented funnel line after the linkedinLeg line (the `:142` shape).

```ts
// 1) HeartbeatStats gains the field (after the linkedinLeg field):
  /** LinkedIn leg state (D6): attached only when the payload reader ran this run. */
  linkedinLeg?: LegLine;
  /** Degraded-accounts line from the health circuit; attached only when an
   *  account is capped (the absent state is the quiet default). */
  degradedAccounts?: string;

// 2) buildHeartbeatBody — the funnel lines array gains one conditional entry
// after the linkedinLeg line:
    `  ${stats.skipped} skipped by the judge`,
    ...(stats.linkedinLeg !== undefined ? [`  ${linkedinLegLine(stats.linkedinLeg)}`] : []),
    ...(stats.degradedAccounts !== undefined ? [`  ${stats.degradedAccounts}`] : []),
    "",
  ];
```

#### 3. tests/email.test.ts

**File**: tests/email.test.ts

**Changes**: MODIFY — appended describes: degraded-line rendering + byte-compat + leg-then-degraded ordering (the needle is `LinkedIn leg: stale` — the digest rider renders the RAW status; DARK is heartbeat-only), sendDigest pass-through, and exhaustion-reason verbatim fixtures.

```ts
describe("buildDigest degraded line (provider health)", () => {
  const posts: Post[] = [
    {
      platform: "threads",
      id: "301",
      text: "Hiring React dev",
      author: "devteam",
      permalink: "https://www.threads.com/@devteam/post/301",
      timestamp: "2026-10-24T00:00:00.000Z",
    },
  ];
  const LINE = "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick";

  it("renders the degraded line after the items when provided", () => {
    const digest = buildDigest(posts, undefined, LINE);
    assert.ok(digest !== null);
    assert.ok(digest.includes(`\n\n${LINE}\n`));
    assert.ok(digest.endsWith(`${LINE}\n`));
  });

  it("keeps the body byte-identical when the line is absent", () => {
    const withRider = buildDigest(posts, undefined, LINE);
    const without = buildDigest(posts);
    assert.ok(withRider !== null && without !== null);
    assert.equal(withRider.startsWith(without), true);
    assert.ok(!without.includes("Degraded LLM"));
  });

  it("still renders the leg line when both riders ride (leg first, degraded last)", () => {
    const digest = buildDigest(
      posts,
      { status: "stale", detail: "payload 2h old" },
      LINE,
    );
    assert.ok(digest !== null);
    const legAt = digest.indexOf("LinkedIn leg: stale");
    const degradedAt = digest.indexOf("Degraded LLM");
    assert.ok(legAt >= 0);
    assert.ok(degradedAt > legAt);
  });
});

describe("sendDigest degraded pass-through", () => {
  const sampleConfig: EmailConfig = {
    user: "alerts@gmail.com",
    pass: "app-password",
    to: "alerts@gmail.com",
  };
  const samplePosts: Post[] = [
    {
      platform: "threads",
      id: "201",
      text: "Hiring React dev",
      author: "devteam",
      permalink: "https://www.threads.com/@devteam/post/201",
      timestamp: "2026-10-24T00:00:00.000Z",
    },
  ];

  it("passes the degraded line into the rendered body", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        captured = options;
        return { messageId: "msg-d1" };
      },
    } as unknown as Transporter;

    await sendDigest(
      samplePosts,
      sampleConfig,
      mockTransport,
      undefined,
      "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick",
    );
    const mail = captured as { text: string };
    assert.ok(mail.text.includes("Degraded LLM account(s)"));
  });
});

describe("buildExhaustionText health reasons", () => {
  it("renders the health reasons verbatim (HTTP 503, key dead, network error)", () => {
    const text = buildExhaustionText([
      { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 503" },
      { account: 2, baseUrl: "https://api.b.com/v1", reason: "HTTP 401 — key dead" },
      { account: 3, baseUrl: "https://api.c.com/v1", reason: "network error: socket hang up" },
    ]);
    assert.ok(text?.includes("account 1 (https://api.a.com/v1) — HTTP 503"));
    assert.ok(text?.includes("account 2 (https://api.b.com/v1) — HTTP 401 — key dead"));
    assert.ok(text?.includes("account 3 (https://api.c.com/v1) — network error: socket hang up"));
  });
});
```

#### 4. tests/heartbeat.test.ts

**File**: tests/heartbeat.test.ts

**Changes**: MODIFY — appended describe: the funnel line renders when capped, omits entirely when absent.

```ts
describe("buildHeartbeatBody degraded line (provider health)", () => {
  it("renders the degraded-accounts line inside the funnel block when accounts are capped", () => {
    const body = buildHeartbeatBody(
      {
        ...STATS,
        degradedAccounts:
          "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick",
      },
      [],
      NOW,
    );
    assert.ok(
      body.includes(
        "  Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick",
      ),
    );
  });

  it("omits the degraded-accounts line entirely when absent", () => {
    assert.ok(!buildHeartbeatBody(STATS, [], NOW).includes("Degraded LLM account"));
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] The email suite passes: `npx tsx --test tests/email.test.ts`
- [x] The heartbeat suite passes: `npx tsx --test tests/heartbeat.test.ts`
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the touched files: `npx biome check src/email.ts src/heartbeat.ts tests/email.test.ts tests/heartbeat.test.ts`

#### Manual Verification:
- [x] Healthy emails stay byte-identical: every pre-health fixture passes unmodified; the degraded line is absent-when-healthy, never empty; leg-then-degraded ordering pinned

## Phase 6: Entry wiring

### Overview

Wires `index.ts` end to end: the `judgeHealth`/`judgeHealthPath` dep seams (the health path DEFAULTS to beside the state file — `dirname(statePath)/judge-health.json`, byte-equal to `JUDGE_HEALTH_PATH` in production, temp-dir-bound in tests so the offline no-repo-writes rule holds), the `resolveJudgeConfig` hoist, the marks resolve + degraded line above Gate 1, the marks arg into `judgePosts`, the digest call's 5th arg, the once-after-judge success flush, and the catch-path best-effort flush with the episode OPEN. Depends on Phases 1, 3, 4, 5 — the full pipeline runs offline through the seams after this phase.

### Changes Required:

#### 1. src/index.ts

**File**: src/index.ts

**Changes**: MODIFY — imports (node:path dirname/join; the judge-health block); `WatcherDeps` gains the two seams; the hoist block (marks resolve + degraded line + warn) above Gate 1 with the judgeAccounts it shares with the judge stage; the stats conditional spread; the judge stage passes `health.marks` and drops its local resolve; `flushTickHealth` once after the judge stage; the match-path `sendDigest` call gains `degradedLine` as its 5th arg; main's catch grows the best-effort exhaustion flush before the alarm.

```ts
// 1) Imports — node:path joins before node:url (alphabetical):
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
// A new runtime block joins (alphabetical: after ./judge-ceilings.js, before
// ./judge-rotation.js):
import {
  type HealthRead,
  buildDegradedAccountsLine,
  episodeAlarmDue,
  flushExhaustionHealth,
  flushTickHealth,
  loadAccountHealth,
} from "./judge-health.js";
// NOTE: JUDGE_HEALTH_PATH is NOT imported — the flush target derives from
// the state file's directory (change 4), which equals the constant's value
// in production without importing it.

// 2) WatcherDeps — two fields after judgeCeilings:
  /** Judge health resolver (the judgeCeilings seam shape). Default:
   *  loadAccountHealth — the module owns its degrade contract (an absent
   *  or malformed health file reads as the healthy default and never
   *  fails the run). */
  readonly judgeHealth?: (accounts: readonly LlmAccount[]) => Promise<HealthRead>;
  /** Health file location for the flushes. Default: beside the state file —
   *  dirname(statePath)/judge-health.json, which equals JUDGE_HEALTH_PATH
   *  in production. Tests point either knob at a temp dir — the offline
   *  rule forbids writes inside the repo. */
  readonly judgeHealthPath?: string;

// 3) runWatcher top — beside the statePath default:
  const statePath = deps.statePath ?? STATE_PATH;
  // The health file lives beside the state file: dirname(STATE_PATH) is the
  // committed state/ dir, so the default derives exactly JUDGE_HEALTH_PATH
  // in production while tests that point statePath at a temp dir keep the
  // flush inside the temp dir (the offline rule forbids repo writes).
  const judgeHealthPath = deps.judgeHealthPath ?? join(dirname(statePath), "judge-health.json");

// 4) Hoist block — after `const runUrl = runUrlFromEnv(env);`, replacing the
// judge-stage-local resolve:
  // Provider-health resolve (the D3-seam family): hoisted above the gates so
  // the degraded-accounts line rides every email — a Gate-1 heartbeat
  // renders marks from PREVIOUS ticks (zero dispatches cannot clear them,
  // FR7). resolveJudgeConfig hoists with it: the line needs pool size and
  // stable indexing. The hoist moves a malformed-LLM_ACCOUNTS failure
  // EARLIER: on a nothing-unseen (Gate-1) tick this flips exit 0 (with a
  // heartbeat) into exit 1 before it — a recorded, accepted trade.
  const judgeAccounts = resolveJudgeConfig(env);
  // The READ defaults to the derived path too (not the bare constant): the
  // read/write pair must agree, or once a live run commits the file, repo
  // state leaks into hermetic test runs as phantom degraded lines and caps.
  const health = await (
    deps.judgeHealth ?? ((accounts: readonly LlmAccount[]) => loadAccountHealth(accounts, judgeHealthPath))
  )(judgeAccounts);
  const degradedLine = buildDegradedAccountsLine(judgeAccounts, health.marks);
  if (degradedLine !== undefined) {
    console.warn(degradedLine);
  }

// 5) stats construction — the conditional spreads gain one entry:
    ...(linkedinLeg !== undefined ? { linkedinLeg } : {}),
    ...(degradedLine !== undefined ? { degradedAccounts: degradedLine } : {}),

// 6) judge stage — the closure drops its local resolveJudgeConfig and passes
// the marks:
  const { value: judgeOutcome, durationMs: judgeMs } = await timeStage(async () => {
    // D3 seam: the ceilings resolver mirrors linkedinFetch — injected in
    // tests, the fs-reading default in production. Its degrade contract
    // (never throws) keeps an absent state/judge-ceilings.json a quiet
    // floor-at-1 run.
    const ceilings = await (deps.judgeCeilings ?? loadAccountCeilings)(judgeAccounts);
    return judgePosts(
      newPosts,
      judgeAccounts,
      config.keywords,
      deps.fetchFn,
      config.reasoningEffort,
      ceilings,
      now,
      sleepFn,
      health.marks,
    );
  });

// 7) flush — immediately after the judge timing line:
  console.log(`timing: judge ${judgeMs}ms`);
  // Provider-health flush (best-effort — never throws): the tick's outcomes
  // land in the health file; the episode bit clears only when some account
  // dispatched ok. Gate 1 never dispatches and never flushes (FR7).
  await flushTickHealth(judgeAccounts, health.file, judgeOutcome.outcomes, judgeHealthPath);

// 8) the match-path digest call gains the line (the Gate-2 heartbeat picks
// the line up through stats — no call-site change there):
  const { durationMs: notifyMs } = await timeStage(() =>
    sendDigest(matches, resolveEmailConfig(env), deps.transport, linkedinLeg, degradedLine),
  );

// 9) main's entry-module catch — the isRotationExhausted arm grows the
// best-effort flush + the ONE-ALARM-PER-EPISODE gate. The order below is
// LOAD-BEARING: episodeAlarmDue reads the PRE-FLUSH snapshot — moving the
// flush before the load would always see outageOpen true and suppress
// every alarm (the exact failure the gate exists to prevent):
    if (isRotationExhausted(error)) {
      console.error(`watch: FAILED — ${error.message}`);
      let episodeAlreadyOpen = false;
      try {
        const bootstrapAccounts = resolveJudgeConfig(process.env);
        const healthRead = await loadAccountHealth(bootstrapAccounts);
        // Pre-flush read: the flush below OPENS the bit — an open bit here
        // means a PREVIOUS run already alarmed (one alarm per episode, the
        // research's checkpoint 4; the fetch-linkedin episode precedent).
        episodeAlreadyOpen = !episodeAlarmDue(healthRead.file);
        const outcomes = error.health ?? { ok: [], failed: new Map<number, string>() };
        await flushExhaustionHealth(bootstrapAccounts, healthRead.file, outcomes);
      } catch (healthError) {
        const healthMessage =
          healthError instanceof Error ? healthError.message : String(healthError);
        console.warn(`judge: health flush failed — ${healthMessage}`);
        // episodeAlreadyOpen stays false → the alarm fires (fail-visible:
        // a duplicate alarm costs one email, a suppressed alarm costs the
        // outage).
      }
      if (episodeAlreadyOpen) {
        console.warn(
          "watch: outage episode already open — exhaustion alarm suppressed (one per episode)",
        );
      } else {
        try {
          await sendExhaustionEmail(error.failures, resolveEmailConfig(process.env));
        } catch (emailError) {
          const emailMessage =
            emailError instanceof Error ? emailError.message : String(emailError);
          console.warn(`email: exhaustion alarm not sent — ${emailMessage}`);
        }
      }
      process.exit(1);
    }
```

#### 2. tests/index.test.ts

**File**: tests/index.test.ts

**Changes**: MODIFY — the judge-health import; a `tempHealthPath` helper; a new describe with the 3-tick acceptance run (streak → cap → probe-success clears and rejoins, per-host counts, the degraded line on the tick-3 digest), the Gate-1 degraded-line render, and the Gate-1 no-flush pin (FR7).

```ts
// Imports — ../src/index.js sorts BEFORE ../src/judge-health.js ('i' < 'j'):
import { runWatcher, timeStage } from "../src/index.js";
import { type HealthFile, loadAccountHealth } from "../src/judge-health.js";

// Helper beside tempStatePath:
/** Temp health-file path for the flush assertions (same lazy dir). */
async function tempHealthPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));
  return join(dir, name);
}

describe("provider health (the entry wiring)", () => {
  it("acceptance: hard-fail builds a streak, the second tick caps, and a probe success clears and rejoins", async () => {
    const posts = [
      { id: id19(20), text: "Hiring: elixir developer, remote" },
      { id: id19(21), text: "Hiring: react native developer, jakarta" },
    ];
    const statePath = await tempStatePath("acceptance-state.json");
    const healthPath = await tempHealthPath("acceptance-health.json");
    const { transport, subjects, texts } = recordingTransport();
    let accountOneOk = false;
    const auths: string[] = [];
    const fetchFn = (async (url: unknown): Promise<Response> => {
      auths.push(new URL(String(url)).host);
      if (!accountOneOk) {
        return new Response("Service Unavailable", { status: 503 });
      }
      // The recovered endpoint answers the whole batch in one call.
      return ok(
        JSON.stringify({
          [id19(20)]: { relevant: true, locationOk: true },
          [id19(21)]: { relevant: true, locationOk: true },
        }),
      );
    }) as unknown as typeof fetch;
    const runOnce = async (): Promise<{
      judged: number;
      matches: number;
      skipped: number;
      saved: boolean;
    }> =>
      runWatcher({
        env: BASE_ENV,
        config: CONFIG,
        contextFactory: singlePageContextFactory(graphqlBody(posts)),
        fetchFn,
        transport,
        statePath,
        now: () => NOW,
        sleepFn: (ms) => Promise.resolve(), // inert: the 503 backoffs never wait
        judgeHealth: (accounts) => loadAccountHealth(accounts, healthPath),
        judgeHealthPath: healthPath,
      });

    // Tick 1: the 503 stamps a hard failure — the streak builds to 1 (not yet capped).
    assert.deepEqual(await runOnce(), { judged: 2, matches: 0, skipped: 2, saved: false });
    assert.equal(auths.length, 4); // the terminal attempt + the three same-account backoffs
    let stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.marks["https://mock.api/v1"], 1);

    // Tick 2: the second hard-failed tick — the streak reaches the cap threshold.
    assert.deepEqual(await runOnce(), { judged: 2, matches: 0, skipped: 2, saved: false });
    stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.marks["https://mock.api/v1"], 2);

    // Tick 3: capped at 1 request/tick — the probe. The endpoint recovered:
    // the success clears the mark in-run and the batch answers in that call.
    auths.length = 0;
    accountOneOk = true;
    assert.deepEqual(await runOnce(), { judged: 2, matches: 2, skipped: 0, saved: true });
    assert.equal(auths.length, 1); // exactly the probe dispatch — half-open
    // Three emails: two Gate-2 heartbeats, then the match digest — which
    // still renders the degraded line (the load-time marks were capped).
    assert.equal(subjects.length, 3);
    assert.match(subjects[2] ?? "", /2 new job posts/);
    assert.ok(
      texts[2]?.includes(
        "Degraded LLM account(s): #1 https://mock.api/v1 — capped at 1 request/tick",
      ),
    );
    // The flush cleared the mark (the success reset the streak).
    stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.deepEqual(stored.marks, {});
    assert.equal(stored.outageOpen, false);
  });

  it("renders the degraded-accounts line on the Gate 1 heartbeat — marks load above the gate", async () => {
    const posts = [{ id: id19(22), text: "Hiring: pragma developer, remote" }];
    const seed: AppState = {
      version: 2,
      seenPostIds: { [id19(22)]: iso(NOW - HOUR) },
    };
    const statePath = await tempStatePath("gate1-degraded.json", seed);
    const before = await readFile(statePath, "utf8");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
      judgeHealth: async () => ({
        marks: new Map([[0, 2]]),
        file: { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
      }),
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(await readFile(statePath, "utf8"), before); // Gate 1: state untouched
    assert.equal(subjects.length, 1); // the Gate 1 heartbeat still fires
    assert.ok(
      texts[0]?.includes(
        "Degraded LLM account(s): #1 https://mock.api/v1 — capped at 1 request/tick",
      ),
    );
  });

  it("never flushes health on Gate 1 — zero dispatches cannot clear marks (FR7)", async () => {
    const posts = [{ id: id19(23), text: "Hiring: elm developer, remote" }];
    const seed: AppState = { version: 2, seenPostIds: { [id19(23)]: iso(NOW - HOUR) } };
    const statePath = await tempStatePath("gate1-no-flush.json", seed);
    const healthPath = await tempHealthPath("gate1-no-flush-health.json");
    const { transport } = recordingTransport();

    await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
      judgeHealth: async () => ({
        marks: new Map([[0, 2]]),
        file: { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
      }),
      judgeHealthPath: healthPath,
    });

    await assert.rejects(() => readFile(healthPath, "utf8"), /ENOENT/);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] The index suite passes: `npx tsx --test tests/index.test.ts`
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the touched files: `npx biome check src/index.ts tests/index.test.ts`
- [x] No repo writes during the suite: `git status --porcelain state/` returns empty after the run
- [x] The all-429 pin passes UNCHANGED (same suite run — tests/index.test.ts "rejects with the complete pool-ordered exhaustion record...")
- [x] The one-alarm gate contract: `episodeAlarmDue` pins the episode suppression (Phase 2 suite, both branches); the catch consumes it against the PRE-FLUSH snapshot (helper-referenced — the bootstrap is untestable by recorded design)

#### Manual Verification:
- [x] Gate 1 renders the degraded line from previous-tick marks and never flushes; the catch flush is best-effort and untested by design (the bootstrap); every pre-health suite passes unmodified

## Phase 7: Workflow + commit-back

### Overview

Grows the commit-back machinery to three state files: the new failure-path `Commit health` step, the Commit state file-set growth, and the rebase skip-set's third literal with its suite cases. Depends on Phase 6 (the flushed file + path constant exist); re-verifies the job timeout budget.

### Changes Required:

#### 1. .github/workflows/watch.yml

**File**: .github/workflows/watch.yml

**Changes**: MODIFY — a new `Commit health` step between `Run watcher` and `Commit state` (`if: always() && failure()`, the Commit-ceilings head shape, `-f`-guarded add of only the health file); the Commit state add grows the health file behind its own `-f` guard (a Gate-1 tick never flushes, so the file can be absent when the success-path add runs); the watch job's timeout comment records the budget re-check.

```yaml
      - name: Commit health
        # The provider-health file's failure-path commit (the FR7 episode
        # bit must survive the run that SETS it): the exhaustion exit skips
        # every later step, so this one rides `always() && failure()` —
        # the same head shape as the probe job's Commit ceilings (bot
        # identity, the -f-guarded add of ONLY the health file, the no-op
        # guard, a fixed-message commit, the tested script). The [-f] guard
        # covers a run that died before the flush (the health file is
        # absent from every checkout until the first live run commits it —
        # an unconditional add of an absent path is fatal under the step's
        # implicit bash -e). The success path commits the same file through
        # the Commit state step below.
        if: always() && failure()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [ -f state/judge-health.json ]; then
            git add state/judge-health.json
          fi
          if git diff --cached --quiet; then
            echo "health unchanged; nothing to commit"
            exit 0
          fi
          git commit -m "judge: provider health marks"
          bash scripts/commit-state-rebase.sh

      - name: Commit state
        # F021: the queue serializes watcher runs, but a human push can land
        # between this run's checkout and its commit-back. The rebase, the
        # state-only conflict skip, the lease push, and the single retry all
        # live in the committed script under scripts/ — this step keeps only
        # the YAML-owned head: bot identity, the state-file-only add, the
        # no-op guard, and the jq delta commit.
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add state/seen-posts.json
          # The health file joins the success-path commit set — guarded: a
          # Gate-1 tick (nothing unseen) never flushes, so the file can be
          # absent until the first live run creates it, and an unconditional
          # add of an absent pathspec is fatal under the step's implicit
          # bash -e.
          if [ -f state/judge-health.json ]; then
            git add state/judge-health.json
          fi
          if git diff --cached --quiet; then
            echo "state unchanged; nothing to commit"
            exit 0
          fi
          PREV=$(git show HEAD:state/seen-posts.json | jq '.seenPostIds | length' 2>/dev/null || echo 0)
          CURR=$(jq '.seenPostIds | length' state/seen-posts.json)
          git commit -m "state: $((CURR - PREV)) new seen post ids"
          bash scripts/commit-state-rebase.sh
```

(3) The watch job's timeout comment block gains one paragraph (after the WAIT_BUDGET_MS paragraph):

```yaml
    # The failure-path Commit health step adds one stat + one git add
    # inside the envelope: the exhaustion alarm lands ~1-2 min inside the
    # cap (WAIT_BUDGET_MS), leaving minutes for the commit-back.
```

#### 2. scripts/commit-state-rebase.sh

**File**: scripts/commit-state-rebase.sh

**Changes**: MODIFY — the skip-set `case` gains `state/judge-health.json`; the header's committed-state list and the deviation ledger grow the third literal.

```bash
# (1) The header's committed-state list (line ~13):
# A state commit that conflicts against main's own lines for a committed
# state file (state/seen-posts.json, state/judge-ceilings.json,
# state/judge-health.json) is skipped whole (the next run re-judges, or
# the next probe run overwrites; one duplicate digest or one
# stale-ceiling stretch is the accepted cost) instead of failing the run.

# (2) The deviation ledger (line ~30-32):
# Third deviation (2026-11-07, provider health): the skip set grew to the
# three committed state files — the health file joins seen-posts and
# judge-ceilings.

# (3) The skip-set case (line ~58-60):
        case "$path" in
          "" | state/seen-posts.json | state/judge-ceilings.json | state/judge-health.json) ;;
          *) all_state=0 ;;
        esac
```

#### 3. tests/commit-state-rebase.test.ts

**File**: tests/commit-state-rebase.test.ts

**Changes**: MODIFY — `advanceOrigin`'s edits type + body gain the health option; two new black-box scratch-repo tests: a health-only add/add conflict skips (origin keeps its marks, exit 0), a health+notes mixed conflict aborts loudly (exit 1, rebase unwound, HEAD unmoved).

```ts
// (1) advanceOrigin's edits type gains the health option:
  edits: { stateIds?: Record<string, string>; notes?: string; ceilings?: string; health?: string };
// and the body gains:
  if (edits.health !== undefined) {
    await writeFile(join(other, "state", "judge-health.json"), edits.health, "utf8");
    git(other, ["add", "state/judge-health.json"]);
  }

// (2) Two new tests appended inside the describe:
  it(
    "skips a judge-health conflict (the watch job's failure-path commit-back): exit 0, origin keeps its marks",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("health-skip");
      try {
        // The Commit health head this suite mimics: add + commit the
        // health file only.
        await writeFile(
          join(work, "state", "judge-health.json"),
          '{"version": 1, "marks": {"https://account-one.api/v1": 2}, "outageOpen": true}\n',
          "utf8",
        );
        git(work, ["add", "state/judge-health.json"]);
        git(work, ["commit", "-m", "judge: provider health marks"]);
        // The human push: a DIFFERENT marks reading lands on origin first
        // (add/add conflict — the file did not exist at the merge base).
        await advanceOrigin(root, origin, {
          health: '{"version": 1, "marks": {"https://account-one.api/v1": 1}, "outageOpen": false}\n',
        });
        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        // The accepted skip cost, pinned for the third state file: origin
        // keeps ITS reading; the next run overwrites.
        assert.match(git(origin, ["show", "main:state/judge-health.json"]), /: 1\}/);
        assert.doesNotMatch(run.stdout, /non-state conflict/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "aborts a two-line conflict when one path is outside the state set (health + notes): exit 1",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("health-mixed");
      try {
        // Our commit touches the health file AND one non-state file.
        await writeFile(
          join(work, "state", "judge-health.json"),
          '{"version": 1, "marks": {}, "outageOpen": false}\n',
          "utf8",
        );
        await writeFile(join(work, "notes.md"), "work side\n", "utf8");
        git(work, ["add", "state/judge-health.json", "notes.md"]);
        git(work, ["commit", "-m", "health + notes"]);
        // Origin moved BOTH paths: the conflict list has two lines, one
        // in the skip set, one outside — the outside line fails the
        // attempt whole; nothing is skipped piecemeal.
        await advanceOrigin(root, origin, {
          health: '{"version": 1, "marks": {"https://account-one.api/v1": 3}, "outageOpen": true}\n',
          notes: "origin side\n",
        });
        const before = git(work, ["rev-parse", "HEAD"]).trim();
        const run = runScript(work);
        assert.equal(run.status, 1, `status ${String(run.status)}: ${run.stderr}`);
        assert.match(run.stdout, /non-state conflict in: notes\.md/);
        // The abort actually unwound: no rebase in flight, HEAD unmoved.
        await assert.rejects(() => access(join(work, ".git", "rebase-merge")), /ENOENT/);
        assert.equal(git(work, ["rev-parse", "HEAD"]).trim(), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
```

### Success Criteria:

#### Automated Verification:
- [x] The commit-back suite passes: `npx tsx --test tests/commit-state-rebase.test.ts`
- [x] The skip-set carries the third literal: `grep -n "judge-health" scripts/commit-state-rebase.sh` returns the case line + the header/ledger mentions
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the touched file: `npx biome check tests/commit-state-rebase.test.ts`

#### Manual Verification:
- [x] The Commit health step reads as the Commit ceilings head shape with `if: always() && failure()`; BOTH commit-back adds are -f-guarded against the absent-first-run file; the timeout comment records the budget re-check

## Phase 8: Docs sync + repo-wide gates

### Overview

Syncs every "two committed state files" prose to three across EIGHT files (README, AGENTS.md, the root guidance, the four sub-guidance files, and the script header's invoker sentence) and carries the repo-wide gates (typecheck + lint + test, the terminal phase's project-baseline checks). Depends on Phase 7; nothing follows it.

### Changes Required:

#### 1. README.md

**File**: README.md

**Changes**: MODIFY — the intro persistence sentence grows to three files; pipeline step 6 gains the health paragraph (2-tick cap, half-open probe, self-heal, degraded line, real causes, one-alarm-per-episode); the Setup probe paragraph gains the "needs no setup" note.

```markdown
# (1) Intro paragraph — the persistence sentence becomes:
No web UI; persistence is three committed state files — `state/seen-posts.json`
(seen ids), `state/judge-ceilings.json` (the judge's per-account ceilings),
and `state/judge-health.json` (per-account provider health: hard-failure
streaks and the outage-episode bit).

# (2) Pipeline step 6 — a trailing paragraph after the ceilings sentence
# ("...capped at 1 until the next probe run)."):
    An account that hard-fails (HTTP 5xx after backoff, 401/403, or a
    network error — never a 429) on two consecutive runs is capped at one
    request per run: the next run's single dispatch is a half-open probe,
    and a success restores its full ceiling for the rest of that run. The
    marks live in `state/judge-health.json` and self-heal — a stale mark
    costs at most the one-request probe until the first success clears it.
    While any account is capped, the digest and the zero-match status email
    each carry one `Degraded LLM account(s):` line, and an exhausted pool's
    alarm names each account's real cause (`HTTP 503`, `HTTP 401 — key
    dead`, `network error: …`) instead of a blanket 429. One alarm per
    outage: the episode bit rides the health file, so a second all-dead run
    stays quiet in the log and still fails the run.

# (3) Setup — a trailing paragraph after the probe paragraph ("...the file
# keeps its last green reading."):
    Provider health needs no setup: the watch run writes
    `state/judge-health.json` (on the success path and, best-effort, from
    the failed run's own commit-back step) and the workflow commits it
    back. The file is absent from every checkout until the first live run
    creates it; a missing or malformed file reads as "everything healthy"
    and never fails a run.
```

#### 2. AGENTS.md

**File**: AGENTS.md

**Changes**: MODIFY — the committed-state sentence grows to three files naming BOTH committers (the success-path Commit state add + the failure-path Commit health step); the Architecture module list gains `src/judge-health.ts` beside `judge-ceilings.ts` with a one-line role.

```markdown
# (1) The "Committed state is two files, one writer each" sentence grows to
# three files: judge-health.json joins, written by the watch run's flush
# (success path + the best-effort exhaustion catch) and committed back by
# the workflow (Commit state on the success path, Commit health on the
# failure path).

# (2) The Architecture module list gains, beside judge-ceilings.ts:
#   src/judge-health.ts — the committed health file's reader/writer, the
#   tick-flush (success + exhaustion), and the episode helpers.
```

#### 3. .rpiv/guidance/architecture.md

**File**: .rpiv/guidance/architecture.md

**Changes**: MODIFY — the root guidance's "Committed state is two files, one writer each" line grows to three; the commit-back script's "BOTH state files" sentence grows to all three; the `state/` tree listing gains the third file + its writer.

```markdown
# (1) The Project Overview's committed-state line:
Committed state is three files, one writer each:
`state/seen-posts.json` (committed back by the watch job after match runs),
`state/judge-ceilings.json` (probe-measured judge ceilings, committed by the probe job), and
`state/judge-health.json` (per-account provider health, written by the watch run's flush, committed back by the watch job — success path and the failure-path Commit health step).

# (2) The commit-state-rebase.sh description's "commit-back body for BOTH
# state files" becomes "for ALL THREE state files".

# (3) The state/ tree line gains:
state/              # runtime state only: seen-posts.json (watch job) + judge-ceilings.json (probe job) + judge-health.json (watch job); written by the run/job, committed back by the workflow
```

#### 4. .rpiv/guidance/src/architecture.md

**File**: .rpiv/guidance/src/architecture.md

**Changes**: MODIFY — the Module Structure block's LEAVES + CONFIG lines gain `judge-health.ts` beside `judge-ceilings.ts` (its actual group at HEAD); the "Judge rotation" section gains a trailing paragraph describing the health circuit.

```markdown
# (1) Module Structure — the LEAVES + CONFIG group gains judge-health.ts
# beside judge-ceilings.ts (both are committed-state reader/writer modules):
types.ts, config.ts, config-file.ts,     # LEAVES + CONFIG: contracts | ENV_NAMES, paths | watcher.config.json
judge-ceilings.ts, judge-health.ts       #   validation (closed ALLOWED_KEYS incl. candidateTerms, scrollRounds,
                                         #   reasoningEffort) | the committed judge ceilings + provider health reader/writer

# (2) The "Judge rotation" section gains a trailing paragraph:
# Health circuit (the provider-health boundary): RotationState carries healthMarks /
# probedThisTick / outcomeLedger as plain fields; the pick applies the cap and the
# half-open probe INLINE (committed ceilings un-merged — a capped account runs at
# effective ceiling 1 until its probe claims it; a success deletes the mark AND the
# probe slot, rejoining at the committed ceiling for the rest of the tick). The
# dispatch core stamps the ledger at the four branch sites (429 never counts; the
# mid-backoff branch never stamps; a parse-miss resolve stamps nothing — a model
# failure is not an account outcome). An all-health-blocked pick with no active
# cooldown exhausts immediately (progress-aware: an uncapped account never blocks —
# the zero-charge ceiling wait survives). The flush lives on the success path
# (flushTickHealth, once after the judge stage) and, best-effort, in main's
# entry-module catch (flushExhaustionHealth, episode OPEN, never masking exit 1).
# judge-rotation.ts keeps its ZERO-RUNTIME-IMPORT identity (the type-only
# TickOutcomes import is the D5 idiom; it never imports judge-health at runtime).
```

#### 5. .rpiv/guidance/.github/workflows/architecture.md

**File**: .rpiv/guidance/.github/workflows/architecture.md

**Changes**: MODIFY — the commit-back section gains the `Commit health` step, the three-file skip-set, and the errexit paragraph's parenthetical (a bare path list survives the widened grep); the "Two invokers" prose grows to three; the writer story names the watch job's two files.

```markdown
# (1) The commit-back section gains:
#   - name: Commit health
#     if: always() && failure()   # the FR7 episode bit must survive the run that SETS it
#     # the Commit ceilings head shape: bot identity, the -f-guarded add of ONLY
#     # state/judge-health.json, the no-op guard, the fixed message
#     # "judge: provider health marks", then bash scripts/commit-state-rebase.sh
# The skip-set grows to the three committed state files
# (state/seen-posts.json, state/judge-ceilings.json, state/judge-health.json).
# The errexit paragraph's parenthetical grows the same way: "exit 1 on a
# conflict outside the committed state set (state/seen-posts.json,
# state/judge-ceilings.json, state/judge-health.json)".

# (2) "Two invokers, one call each" becomes "Three invokers, one call each"
# (Commit state, Commit ceilings, Commit health — the success/failure callers
# are mutually exclusive, so "exactly once per run" holds).

# (3) The writer sentence: the watch job owns state/seen-posts.json AND
# state/judge-health.json (success path + the guarded failure-path step); the
# probe job owns state/judge-ceilings.json.
```

#### 6. .rpiv/guidance/scripts/architecture.md

**File**: .rpiv/guidance/scripts/architecture.md

**Changes**: MODIFY — the Responsibility sentence's "BOTH commit-back steps" names the third caller; the invoker count grows to three; the exit-contract line and the Structure comment grow the third literal.

```markdown
# (1) The Responsibility sentence "the body of BOTH commit-back steps
# (watch.yml's Commit state, the probe job's Commit ceilings)" becomes
# "the body of ALL THREE commit-back steps (watch.yml's Commit state, the
# probe job's Commit ceilings, and watch.yml's Commit health)".

# (2) "TWO invokers, one call each" becomes "THREE invokers, one call each"
# (Commit state, Commit ceilings, Commit health).

# (2) The exit-contract line:
# commit-state-rebase.sh      exit 0 = pushed; exit 1 = a conflict outside the committed state set
#                             (state/seen-posts.json, state/judge-ceilings.json, state/judge-health.json) or a second push
#                             failure — ALL THREE invokers' step shells consume it with no wrapper

# (3) The Structure block's comment: "conflict skips = set membership over the
# three committed state files".
```

#### 7. .rpiv/guidance/tests/architecture.md

**File**: .rpiv/guidance/tests/architecture.md

**Changes**: MODIFY — the coverage-map ledger (the 1:1 mirror-rule contract) gains the two missing committed-state rows: `judge-ceilings.ts → judge-ceilings.test.ts` (absent at HEAD) and `judge-health.ts → judge-health.test.ts` (new).

```markdown
# The Coverage map block gains, beside the judge family:
judge-ceilings.ts  → judge-ceilings.test.ts  # committed ceilings: resolver matrix, never-throw reader
#                                              #   degrade lattice, atomic writer round-trip
judge-health.ts    → judge-health.test.ts    # committed health: reader degrade matrix, tick-merge matrix,
#                                              #   byte-stability gate, episode lifecycle, one-alarm gate
```

#### 8. scripts/commit-state-rebase.sh

**File**: scripts/commit-state-rebase.sh

**Changes**: MODIFY — comment-only: the header's invoker sentence names the failure-path Commit health step (the third invocation).

```bash
# The header's invoker sentence (line ~18-19) becomes:
# Invoked EXACTLY ONCE per run by watch.yml — three callers, mutually
# exclusive per run: the watch job's Commit state step (success path), the
# probe job's Commit ceilings step, and the watch job's Commit health step
# (failure path). The single retry lives here.
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] No stale prose survives: `grep -rniE "two committed state|two state files|both state files|two invokers|is two files" README.md AGENTS.md .rpiv/guidance/ scripts/commit-state-rebase.sh` returns nothing

#### Manual Verification:
- [x] Every doc that named two committed state files now names three; the health story reads operator-legibly in README; the guidance files carry the module, the step, and the third literal

## Phase 9: Probe freshness gate

### Overview

Gates the dispatch-only probe job (watch.yml) to run at most once per 8 hours, measured from the last SUCCESSFUL probe. The success clock is a `probedAt` entry (epoch seconds) the probe script stamps into `state/judge-ceilings.json` - bytes change on every success, so the Commit ceilings no-op guard never strands the clock on an unchanged reading. Dispatches inside a fresh window skip the probe-side steps while the job stays GREEN: `needs.probe.result == 'success'` holds and watch proceeds on committed ceilings - the schedule-tick doctrine applied to dispatches. A failed probe commits nothing (the Commit step is skipped on failure), so the window never starts and the next manual dispatch re-probes. The `force` dispatch input overrides the window (rotated keys need measurement now). The 8-hour window (28800 s) is a hard-coded workflow literal, not an env knob.

### Changes Required:

#### 1. .github/workflows/watch.yml

**File**: .github/workflows/watch.yml

**Changes**: MODIFY - the dispatch form gains `force`; a `freshness` gate step follows checkout; the probe-side steps (`setup-node`, `npm ci`, `Probe judge latency`, `Commit ceilings`) each gain the step-level if; the job comment block gains the gate paragraph. The job-level `if: github.event_name == 'workflow_dispatch'` and the watch job are untouched.

(a) The dispatch inputs:

```yaml
  workflow_dispatch:
    inputs:
      force:
        description: "Re-probe now, ignoring the 8-hour freshness window"
        type: boolean
        default: false
```

(b) The gate step - first after checkout (jq + date are runner-native):

```yaml
      - name: Freshness gate (8h)
        id: freshness
        # The 8-hour window (28800 s) is a hard-coded workflow literal, not
        # an env knob (the tuning-values doctrine). The clock is the
        # probedAt entry the probe script stamps on SUCCESS - a failed
        # probe commits nothing, so the next dispatch re-probes. The gate
        # only ever widens the skip: scheduled ticks never run this job.
        run: |
          LAST=$(jq -r '.probedAt // 0' state/judge-ceilings.json 2>/dev/null || echo 0)
          if [ "${{ inputs.force }}" = "true" ]; then
            echo "probe: force re-probe requested - ignoring the freshness window"
            LAST=0
          fi
          NOW=$(date +%s)
          if [ "$LAST" != "0" ] && [ $((NOW - LAST)) -lt 28800 ]; then
            echo "probe: ceilings are $(( (NOW - LAST) / 3600 ))h old (< 8h) - skipping the probe; watch proceeds on committed ceilings"
            echo "fresh=true" >> "$GITHUB_OUTPUT"
          else
            echo "probe: ceilings stale or unmeasured - running the probe"
            echo "fresh=false" >> "$GITHUB_OUTPUT"
          fi
```

(c) The four probe-side steps each gain:

```yaml
        if: steps.freshness.outputs.fresh != 'true'
```

(A fresh window leaves only checkout + the green gate - the probe job succeeds in seconds and the same run's watch starts immediately on committed ceilings. An all-skipped job reports `success`, which is what `needs.probe.result == 'success'` consumes.)

(d) The job comment block gains, after the existing dispatch-gate paragraph:

```yaml
    # Freshness gate (2026-11-07): the probe runs at most once per 8 hours
    # from the last successful reading (probedAt in the committed ceilings
    # file). Inside a fresh window the gate skips the probe steps and the
    # job stays GREEN, so the watch job's needs.probe.result == 'success'
    # holds and the dispatch proceeds on committed ceilings - exactly the
    # schedule-tick path. A red probe commits nothing (Commit ceilings is
    # skipped on failure), so the next dispatch re-probes. inputs.force
    # re-probes immediately (rotated keys).
```

#### 2. scripts/probe-judge.ts

**File**: scripts/probe-judge.ts

**Changes**: MODIFY - the success write stamps the clock; the log line counts ceilings minus the clock key; the header gains a revision note.

```ts
  // The freshness clock (Phase 9): epoch seconds the watch.yml gate reads.
  // Stamped on every SUCCESSFUL probe - bytes change even when the ceilings
  // are identical, so the Commit ceilings no-op guard cannot strand the
  // gate on a stale window. The COMMIT only lands on a green gate (the
  // Commit step is skipped on failure), so a red probe never starts a
  // window.
  ceilings.probedAt = Math.floor(Date.now() / 1000);
  await writeCeilingsAtomic(ceilings, JUDGE_CEILINGS_PATH);
  const ceilingCount = Object.keys(ceilings).length - 1; // minus probedAt
  console.log(
    `probe: committed ${ceilingCount} ceiling(s) + probedAt to ${JUDGE_CEILINGS_PATH}`,
  );
```

Header revision note: `Revision 2026-11-07 (freshness gate): the write stamps probedAt (epoch seconds) - the dispatch probe job skips itself for 8h after a success; a failed probe never starts the window.`

#### 3. src/judge-ceilings.ts

**File**: src/judge-ceilings.ts

**Changes**: MODIFY - `resolveCeilings` skips the clock key; the module docstring + the `CeilingsFile` comment name it.

```ts
// resolveCeilings loop head gains one line:
    for (const [key, value] of Object.entries(parsed)) {
      if (key === "probedAt") continue; // the freshness clock, not a ceiling (Phase 9)
      const usable = usableCeiling(value);
```

Doc comment growth: `The committed file carries one non-ceiling key: probedAt (epoch seconds of the last successful probe - the watch.yml freshness gate's clock). The resolver skips it; lookups are baseUrl-keyed, so it can never collide with an account.`

#### 4. tests/judge-ceilings.test.ts

**File**: tests/judge-ceilings.test.ts

**Changes**: MODIFY - two appended cases (adapted to the suite's lazy `mkdtemp` dir helpers, the `tests/judge-ceilings.test.ts:109-117` idiom):

```ts
  it("ignores the probedAt freshness key - only account keys resolve", () => {
    const parsed = {
      "https://account-one.api/v1": 8,
      "https://account-two.api/v1": 4,
      probedAt: 1730000000,
    };
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, parsed);
    assert.deepEqual(
      [...ceilings.entries()],
      [
        [0, 8],
        [1, 4],
      ],
    );
    assert.deepEqual(warnings, []);
  });

  it("writeCeilingsAtomic round-trips a file that carries probedAt", async () => {
    const path = join(await freshDir(), "ceilings-probed-at.json");
    await writeCeilingsAtomic({ "https://account-one.api/v1": 8, probedAt: 1730000000 }, path);
    const back = JSON.parse(await readFile(path, "utf8")) as Record<string, number>;
    assert.equal(back.probedAt, 1730000000);
    assert.equal(back["https://account-one.api/v1"], 8);
  });
```

#### 5. README.md + .rpiv/guidance/.github/workflows/architecture.md

**File**: README.md - the Setup probe paragraph gains:

```markdown
    The probe runs at most once per 8 hours from its last success: a fresh
    window skips the probe and the dispatch proceeds on the committed
    ceilings. A failed probe starts no window - the next manual dispatch
    re-probes. The dispatch form's force checkbox re-probes immediately
    (use it after rotating keys).
```

**File**: .rpiv/guidance/.github/workflows/architecture.md - the probe job section gains one paragraph: the `freshness` gate step (jq `.probedAt // 0`, the 28800 s literal, `inputs.force`), the step-level ifs on the four probe-side steps, and the green-skip semantics (`needs.probe.result == 'success'` holds - the schedule-tick path for dispatches).

### Success Criteria:

#### Automated Verification:
- [x] The ceilings suite passes: `npx tsx --test tests/judge-ceilings.test.ts`
- [x] The resolver skips the clock key: the two appended `probedAt` cases pass (same suite run)
- [x] The gate wiring exists: `grep -nE "freshness|28800|probedAt|inputs\.force" .github/workflows/watch.yml` returns the gate step, the four step-level ifs, the literal, and the input
- [x] The stamp exists: `grep -n "probedAt" scripts/probe-judge.ts` returns the stamp and the revised log line
- [x] Repo gates green: `npm run typecheck && npm run lint && npm test`

#### Manual Verification:
- [ ] Live dispatch inside a fresh window: "Probe judge latency" absent from the run, job green, watch proceeds on committed ceilings
- [ ] Live dispatch with force=true: the probe runs regardless of the window
- [ ] A red probe: no ceilings commit lands, and the next dispatch re-probes
