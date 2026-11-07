---
date: 2026-11-07T08:22:22+0700
author: Yogiswara Utama
commit: c647e0f
branch: main
repository: loker-watcher
topic: "Provider health circuit — module boundary: new src/judge-health.ts vs fold into src/judge-rotation.ts"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, judge-health, judge-rotation, judge-ceilings, email, heartbeat, watch-workflow, commit-state-rebase]
last_updated: 2026-11-07T08:22:22+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Provider health circuit — module boundary

**Date**: 2026-11-07T08:22:22+0700
**Author**: Yogiswara Utama
**Commit**: c647e0f
**Branch**: main
**Repository**: loker-watcher

## Research Question

The provider-health-circuit FRD (`.rpiv/artifacts/discover/2026-11-07_07-13-17_provider-health-circuit.md`) and its research (`.rpiv/artifacts/research/2026-11-07_07-26-22_provider-health-circuit.md`) settle the feature's WHAT: per-account health marks persisting across 10-minute ticks in a committed state file, a 2-consecutive-failed-tick cap at ceiling 1 with a half-open per-tick probe, success clears, unified 429/503 exhaustion with real causes, one alarm per outage episode, and a degraded-accounts email line — seven checkpoint decisions recorded, zero open questions. This analysis answers the one axis the research leaves open: **where does the health-module code live** — a new `src/judge-health.ts` sibling of `src/judge-ceilings.ts`, or folded into `src/judge-rotation.ts` beside the `RotationState` it gates?

## Summary

**Problem**: The judge pool re-discovers dead LLM accounts from scratch every tick; a 503ing endpoint burns requests every 10 minutes and the exhaustion alarm can only ever say "HTTP 429". The settled design needs a cross-tick health file, an outcome ledger, and an episode bit — but no decision yet says which module owns them.
**Recommended**: New `src/judge-health.ts` — it copies the ceilings module's four-piece template nearly verbatim, keeps `judge-rotation.ts` a pure-primitive module with zero runtime imports, and places the writer in `src/` for exactly the reason `judge-ceilings.ts:16-18` established.
**Effort**: Med (~3 days: module + core stamps + entry wiring + workflow + docs sync, tests riding existing idioms).
**Confidence**: High.

## Problem Statement

**Requirements:**
- Health marks survive ticks: committed `state/judge-health.json`, single-writer doctrine like `state/judge-ceilings.json`.
- 2 consecutive hard-failed ticks (5xx/transport/401/403 — never 429) cap an account at ceiling 1.
- Half-open probe: exactly 1 request per tick for a capped account (`probedThisTick` ledger); success clears the mark and rejoins the pool for the rest of the tick.
- Exhaustion carries real causes ("HTTP 503", "HTTP 401 — key dead", "network error: …") from a per-attempt outcome ledger; all-health-blocked pools alarm instead of hanging.
- One alarm per outage episode; the episode bit rides the health file (repo-local, committed — the hosted runner has no other memory).
- Digest/heartbeat emails carry one degraded-accounts line, loaded above Gate 1.

**Constraints:**
- Hard: ceilings map stays `ReadonlyMap` — no run-time writes (`src/judge-rotation.ts:58-60` doctrine); caps merge via `min(committed, healthCap)` at `src/index.ts:275`.
- Hard: byte-stability — no timestamps in the file; write only on semantic change (`src/state.ts:237-254` gate pattern). A timestamped write would mint a commit every tick.
- Hard: fail-visible + best-effort doctrines; atomic writes only (`stateTempPath` + rename); the exhaustion flush must never mask the earned exit 1.
- Hard: offline, deterministic tests; the all-429 compatibility pin (`tests/index.test.ts:428-475`) must keep passing.
- Soft: `judge-rotation.ts` today has zero runtime imports (`:28-32`, self-documented D5 pattern) — preserving that identity is the quiet quality bar this decision either keeps or spends.

**Success criteria:**
- `npm run typecheck && npm run lint && npm test` green with the feature wired end to end.
- The all-429 pin and the email byte fixtures survive; the only compile-level break is `freshState` gaining three fields.
- First live run materializes `state/judge-health.json` and commits it; an all-dead run alarms once, and the next dead tick stays quiet.

## Current State

**Existing implementation:**
No `judge-health` artifact exists anywhere; `state/` holds exactly `seen-posts.json`, `judge-ceilings.json`, `linkedin-posts.json`. The feature is composition, not invention:

- `src/judge-ceilings.ts` — the module template: pure resolver `resolveCeilings` (`:50-80`), never-throw reader `loadAccountCeilings` (`:85-114`), atomic writer `writeCeilingsAtomic` (`:122-143`), and the doc (`:16-18`) stating the writer lives in `src/` precisely so it is unit-testable (its call site, the probe script, has no test suite).
- `src/judge-rotation.ts` — ~305 lines, zero runtime imports, one role: in-run dispatch-dial primitives. `RotationState` (`:54-77`) carries cooldowns/ceilings/in-flight/dial/waiters/budget — no per-account outcome ledger, no probe set. `failuresFromCooldowns` (`:233-251`) builds the exhaustion record from map-key existence with `reason: "HTTP 429"` hardcoded at `:247` (verified live).
- `src/judge.ts` — `dispatchLlmCall` (`:343-504`) is the only place `attemptIndex` and the failure cause coexist: 429 at `:421-430`, 5xx terminal at `:443-447`, transport at `:466-472`, success-clear directive at `:481-483`. The flavor split (`:391-397`, verified live) parks through the budget on active cooldown, else waits unbounded in `waitCeilingSlot` (`:396`) — the hang arm the third flavor arm must close. `RotationState` construction at `:725-744`; pool width `Math.max(1, Σ ceilings)` at `:756`.
- `src/index.ts` — `runUrlFromEnv` at `:238` (verified live), Gate 1 at `:257-266`, `resolveJudgeConfig` judge-stage-local at `:270`, ceilings resolve at `:275`, the exhaustion catch + best-effort alarm + `process.exit(1)` at `:393-406` (untestable: tests call `runWatcher` and catch the rethrow).
- Episode precedent — `scripts/fetch-linkedin.ts:107,123-156`: repo-local marker, warn-only when set, clear on the verified healthy edge, injectable `markerPath` + alarm deps; four offline edge cases pinned at `tests/fetch-linkedin.test.ts:492-549`.
- Commit-back — watch.yml Commit state (`:157-176`, no `if:`, unconditional add, `git diff --cached --quiet` no-op guard) and Commit ceilings (`:58-77`, `-f` guard at `:69-71`); skip-set `case` membership at `scripts/commit-state-rebase.sh:58-60`; 342-line offline suite.

**Relevant patterns:**
- IO-in-src writer doctrine: `judge-ceilings.ts:16-18` — used by exactly 2 modules today (`judge-ceilings.ts`, `linkedin-payload.ts`).
- Type-only mirrored import: `judge-rotation.ts:28-32` (`import type { … } from "./judge.js"`) — the cycle-avoidance idiom any new edge must copy.
- Injectable path + best-effort alarm double: `fetch-linkedin.ts:104-156`.
- Semantic-change write gate: `state.ts:237-254`.

**Integration points:**
- `src/index.ts:275` — the `min()` merge seam feeding both pool width and the pick gate.
- `src/index.ts:393-406` — the flush seam inside main's entry-module catch (best-effort, before `process.exit(1)`).
- `.github/workflows/watch.yml:157-176` — Commit state file set grows; new `Commit health` step (`if: always() && failure()`).
- `scripts/commit-state-rebase.sh:58-60` — skip-set gains the third literal.

## Solution Options

### Option 1: New `src/judge-health.ts` module

**How it works:**
A sibling of `src/judge-ceilings.ts` owning the whole health surface: `HEALTH_VERSION` + `HealthFile` envelope (version gate grafted from `readPayloadPosts`, `src/linkedin-payload.ts:151-165`), pure resolver `resolveAccountHealth` → `{caps, warnings}`, never-throw reader `loadAccountHealth`, atomic writer `writeHealthAtomic` (reusing `stateTempPath`) with the semantic-change no-op gate, the in-run outcome-ledger helpers (`stampOutcome`, `buildFailuresFromLedger` replacing `failuresFromCooldowns`), and the episode-bit helpers. `RotationState` gains three plain fields (`healthMarks`, `probedThisTick`, attempt ledger); `RotationExhausted` gains an optional `health` payload. The half-open predicate is inlined in `pickEligibleAccount` as plain field reads — `judge-rotation.ts` needs **no** import of the new module at all.

**Pros:**
- Copies 4 of 7 pieces verbatim from `judge-ceilings.ts`/`state.ts`/`linkedin-payload.ts`/`fetch-linkedin.ts` (reader body, writer body, resolver shape, episode-helper shape) — agent-counted, with the version-gate borrow mapped to its line.
- Import graph stays clean: `judge.ts→judge-health` and `index.ts→judge-health` runtime (downward), `judge-health→judge-rotation` type-only (the `:28-32` D5 idiom), `judge-rotation→judge-health` none. Layering holds; no cycle at source or runtime.
- The writer lands in `src/` for the exact documented reason (`judge-ceilings.ts:16-18`): its production call site is main's untestable catch.
- New suite `tests/judge-health.test.ts` is fully specified by existing idioms (mkdtemp at `tests/judge-ceilings.test.ts:109-117`; 4-case episode shape at `tests/fetch-linkedin.test.ts:492-549`); the ~861-line rotation suite stays file-free.

**Cons:**
- One more module in a 24-file `src/` (the repo has already accepted this granularity: `judge` / `judge-rotation` / `judge-ceilings` / `judge-parse` are all splits of one concern).
- The genuinely new machinery (outcome ledger, semantic-diff gate, byte-stable envelope) lives in the new module — no neighboring code to copy, ~60+ lines of new logic in one place.

**Complexity:** Medium (~3 days)
- Files to create: 2 (`src/judge-health.ts` ~150-180 lines; `tests/judge-health.test.ts` ~200-250 lines)
- Files to modify: ~9 (`judge.ts`, `judge-rotation.ts`, `index.ts`, `email.ts`/`heartbeat.ts` degraded line, `config.ts` path constant, `watch.yml`, `commit-state-rebase.sh` + its test, `tests/judge-rotation.test.ts` freshState, `tests/email.test.ts` fixtures)
- Risk level: Low — every pin survives with one mechanical fix; all topology risks have named mitigations (below).

### Option 2: Fold into `src/judge-rotation.ts`

**How it works:**
The marks, outcome ledger, probe set, episode-bit helpers, AND the health file IO (envelope, reader, resolver, writer) all live beside `RotationState`. No new module; `judge.ts:40-52` and `index.ts:34` grow in place — same import edges.

**Pros:**
- One fewer file; the ledger helpers sit directly beside the pick and cooldown primitives they gate.
- No new import edge for consumers — `judge.ts`/`index.ts` already import from `judge-rotation.js`.

**Cons:**
- First hybrid module in this codebase: pure, synchronous, clock-injected dispatch-dial primitives sharing a file with `node:fs/promises` + `stateTempPath` committed-file IO — a role span no existing module has (verified: `state.ts`, `linkedin-payload.ts`, `judge-ceilings.ts` each own IO + pure helpers but no in-run dispatch state).
- `judge.ts` imports no fs today; folding pulls IO into every dispatch test's static import chain, and the module's own header (`:28-32` "no runtime cycle") plus the ceilings `ReadonlyMap` doc (`:58-60` "writing the file is the probe's job") sit beside health marks that mutate mid-run and a file the run itself persists — two opposing doctrines in one doc block.
- `tests/judge-rotation.test.ts` is verified file-free; IO tests land inside the pure-primitive suite or force a split file (which quietly contradicts the fold's "no new files" claim).
- Agent bottom line: "A dedicated module would cost one new file and one import edge; the fold costs doctrine coherence and suite purity instead — real, payable, but paid continuously rather than once."

**Complexity:** Medium (~3 days — same inherent feature work, different placement)
- Files to create: 1-2 (`tests/judge-health.test.ts` or a split rotation IO suite)
- Files to modify: ~8 (same set minus the new module, plus heavier edits inside `judge-rotation.ts` and its suite)
- Risk level: Medium — nothing blocks, but every future rotation change re-pays the hybrid tax.

## Comparison

| Criteria | Option 1: new judge-health.ts | Option 2: fold into judge-rotation.ts |
|----------|----------|----------|
| Complexity | Medium | Medium |
| Codebase fit | High — 4/7 pieces copy verbatim, idiom-complete | Medium — first IO+primitives hybrid in src/ |
| Doctrine coherence | High — ceilings `ReadonlyMap` doc untouched | Low — opposing doctrines share one file |
| Test-suite purity | High — rotation suite stays file-free | Low — fs enters the dispatch-test import chain |
| Risk | Low | Medium |
| New files | 2 | 1-2 (split suite) |

## Recommendation

**Selected:** Option 1 — new `src/judge-health.ts`.

**Rationale:**
- Precedent is verbatim: reader, resolver, and writer bodies copy `judge-ceilings.ts` with a version gate from `linkedin-payload.ts`; the episode helpers restate `fetch-linkedin.ts:110-156` as envelope-field operations. Only the ledger, the semantic-diff gate, and the byte-stable envelope are genuinely new — all local to the new module.
- The type-only import pattern (`judge-rotation.ts:28-32`) erases the upward edge; the pick reads plain state fields inlined, so `judge-rotation.ts` never imports the new module — zero cycle risk at source or runtime, verified by both agents reading the full files.
- Placement matches the settled design's own test contract: keeping the flush in main's entry-module catch is exactly what lets `tests/index.test.ts:428-475` (all-429 pin) survive unchanged.
- The writer-in-src rationale (`judge-ceilings.ts:16-18`) reproduces one-to-one: health's production flush site is main's `process.exit(1)` catch, unreachable by tests.

**Why not alternatives:**
- Option 2 (fold): mechanically feasible, nothing blocked, but all four dimensions strain — it makes `judge-rotation.ts` the repo's first IO+primitives hybrid, drags `node:fs` into every dispatch test, and pits two opposing doctrine comments in one module. The cost is continuous, not one-time.

**Trade-offs:**
- Accepting one more `src/` module (and ~60+ lines of new ledger/gate logic concentrated there) for a rotation module that keeps its zero-runtime-import, single-role identity.

**Implementation approach:**
1. Module — `src/judge-health.ts`: envelope (no timestamps), never-throw reader, pure resolver, atomic writer with semantic-change gate, ledger stamp/build helpers, episode helpers with injectable path (`deps.markerPath` pattern). Suite: reader degrade matrix, writer round-trip + byte-stability, episode 4-case edge set.
2. Core — `judge.ts`: stamp the ledger at the four branch sites; add the third flavor arm BEFORE `waitCeilingSlot`; add the `judgePosts` marks parameter; construct the three `RotationState` fields. `judge-rotation.ts`: add fields, inline the half-open predicate in `pickEligibleAccount`, replace `failuresFromCooldowns` with `buildFailuresFromLedger`.
3. Entry — `index.ts`: `WatcherDeps.judgeHealth` seam (mirror `judgeCeilings`, `:112-119`), hoist `resolveJudgeConfig` to `:238`, `min()` merge at `:275`, degraded line load above Gate 1, flush in the catch at `:393-406`.
4. Workflow — watch.yml `Commit health` step (`if: always() && failure()`, `-f`-guarded); Commit state file set grows; `commit-state-rebase.sh` skip-set gains the literal + suite update. Budget-check the job timeout on the failure path.
5. Email — degraded-accounts line on digest (`buildDigest` rider) and heartbeat (`HeartbeatStats` field + one funnel line).
6. Docs sync — README, AGENTS.md, guidance files: "two committed state files" grows to three (the `d4e4007` dedicated-docs-phase precedent).

**Integration points:**
- `src/index.ts:275` — `Math.min` merge beside the existing ceilings resolve.
- `src/index.ts:393-406` — best-effort flush inside main's catch, never masking exit 1.
- `src/judge.ts:421-430 / :443-447 / :466-472 / :481-483` — the four ledger stamps.
- `src/judge.ts:391-397` — third arm before `waitCeilingSlot`.
- `.github/workflows/watch.yml:157-176` + `scripts/commit-state-rebase.sh:58-60` — commit-back growth.
- `src/config.ts:63-76` — `JUDGE_HEALTH_PATH` beside the single-writer doc block.

**Patterns to follow:**
- Writer-in-src rationale: `src/judge-ceilings.ts:16-18`
- Type-only mirrored import: `src/judge-rotation.ts:28-32`
- Atomic write + temp cleanup: `src/state.ts:190-233`
- Semantic-change gate: `src/state.ts:237-254`
- Injectable marker + best-effort alarm: `scripts/fetch-linkedin.ts:104-156`

**Risks:**
- 5xx terminal stamp lands on the mid-backoff path instead of defer/retry (`:437-447`): stamp only on the terminal branch; pin with a spent-backoff stub (`tests/judge-rotation.test.ts:433-467` inert-sleepFn idiom).
- A future refactor moves the half-open predicate out of `pickEligibleAccount` and creates a `judge-rotation→judge-health` runtime edge: keep the predicate inlined; note the constraint in the module doc.
- Health write inside `runWatcher` breaks the all-429 pin: flush lives ONLY in main's entry-module catch.
- First live run materialization + rebase churn: `-f` guard on the add; expect the file only after the first live run (`3fe892e` precedent); acceptance pushes account for ~10-minute bot commits.
- `Commit health` step added to the failure path could brush a tight `timeout-minutes`: re-verify the watch job budget when wiring.

## Scope Boundaries
- Building the health circuit with the module boundary decided here: new `src/judge-health.ts`, thin `RotationState` fields, no `judge-rotation` import of the new module.
- NOT doing: re-litigating the seven settled checkpoint decisions (committed file, cap-at-1, 2-tick threshold, success-clears, one-alarm-per-episode, failure-path `Commit health`, config hoist); staleness policy or timestamps (settled: self-healing marks); external circuit-breaker libraries (internal state-file machinery, no npm dependency).

## Testing Strategy

**Unit tests:**
- `tests/judge-health.test.ts`: reader degrade matrix (absent → quiet default; malformed → warn naming the file; wrong version → treat-as-default), resolver validation, writer round-trip, byte-stability (identical marks → no write → the workflow no-op guard commits nothing), ledger builder pool-order preservation (the empty-record invariant at `src/email.ts:181-182`), episode open/quiet/clear transitions.
- `tests/judge-rotation.test.ts`: `freshState` gains the three fields (the only expected compile break); probe-saturation pins; all-health-blocked immediate exhaustion; 429 stamped-but-non-countable keeps the `reason === "HTTP 429"` pins (`:200`, `:512-514`); zero-charge ceiling-waiter pins (`:795-816`) hold with the extended pick.
- `tests/judge.test.ts`: per-branch ledger stamps at the four sites (401 terminal, 503 after spent backoff, transport throw, success clear).
- `tests/email.test.ts`: additive fixtures for "HTTP 503" / "HTTP 401 — key dead" / "network error: …" reasons (`:371-395` idiom; existing `includes()`-based fixtures survive).

**Integration tests:**
- Acceptance composition in `tests/index.test.ts` via the `judgeHealth` dep seam: sequential `judgePosts` calls sharing one temp-dir health file — hard-fail → capped probe → probe success rejoins at the committed ceiling; per-host counting stub (`tests/judge-rotation.test.ts:72-90` idiom), hand-stepped tick clock (`:230-243`), inert sleepFn (`:433-467`).
- The all-429 pin (`:428-475`) passes unchanged — the placement proof for the flush.
- `tests/commit-state-rebase.test.ts` grows the three-file skip-set cases.

**Manual verification:**
- [ ] `npm run typecheck && npm run lint && npm test` green.
- [ ] Local run with one deliberately dead key: alarm names "HTTP 401 — key dead", exit 1, `state/judge-health.json` written atomically.
- [ ] Second dead tick after a forced local episode bit: warn-only, no second alarm email.
- [ ] First live hosted run: file materializes and commits; a healthy tick clears the episode bit (digest renders no degraded line).

## Open Questions
**Resolved during research:**
- Does the fold create a runtime cycle? — No: `judge-rotation.ts` has zero runtime imports today (grep + full-file read); Option 1 needs no `judge-rotation→judge-health` edge at all because the pick inlines plain-field reads.
- Do richer failure reasons break the email fixtures? — No: `tests/email.test.ts:369-380` are `includes()`-based and `buildExhaustionText` interpolates `reason` verbatim (`src/email.ts:185`).
- Where does the flush live so the all-429 pin survives? — Main's entry-module catch (`src/index.ts:393-406`); tests exercise `runWatcher`'s rethrow, never the catch itself.

**Requires user input:**
- None.

**Blockers:**
- None.

## References

- `.rpiv/artifacts/research/2026-11-07_07-26-22_provider-health-circuit.md` - the settled WHAT: seven checkpoint decisions, all seams, test inventory
- `.rpiv/artifacts/discover/2026-11-07_07-13-17_provider-health-circuit.md` - the FRD
- `.rpiv/artifacts/solutions/2026-11-06_11-05-39_llm-account-spread-judge.md` - the spread design's dead-ends ledger
- `.rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md` - the neighboring design artifact (Slice 4 docs-sync precedent)
- `src/judge-ceilings.ts:16-18,29-33,50-80,85-114,122-143` - the module template this solution clones
- `src/judge-rotation.ts:28-32,54-77,121-140,233-251` - the pure-primitive module the boundary preserves
- `src/judge.ts:343-504,725-760` - the stamp sites and state construction
- `src/index.ts:236-285,393-406` - hoist, merge, and flush seams
- `scripts/fetch-linkedin.ts:104-156` - the episode-marker precedent
- `.github/workflows/watch.yml:58-77,155-176` + `scripts/commit-state-rebase.sh:40-70` - commit-back growth
