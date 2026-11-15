---
date: 2026-11-15T09:30:50+0700
author: Yogiswara Utama
commit: be5407a
branch: main
repository: loker-watcher
topic: "Remove the LinkedIn working-hours window"
confidence: high
complexity: low
status: ready
verdict: pass
tags: [solutions, linkedin-pc-leg, working-window, fetch-tick, linkedin-behavior]
last_updated: 2026-11-15T09:30:50+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Remove the LinkedIn working-hours window

**Date**: 2026-11-15T09:30:50+0700
**Author**: Yogiswara Utama
**Commit**: be5407a
**Branch**: main
**Repository**: loker-watcher

## Research Question
Delete the Mon-Fri 08:00-21:00 local working-hours window from the PC-local LinkedIn leg entirely — the predicate, its constants, the tick gate, the `bypassWindow` dep seam, their tests, and every doc claim — with no replacement gate and no bypass switch. After removal every tick runs on any day at any hour, manual and `watch-linkedin` loop alike. Chained from the discover FRD; its Decisions are recorded in the research artifact and treated as hard constraints here.

## Summary
**Problem**: The working-hours window is a three-symbol predicate in `src/linkedin-behavior.ts` with exactly one production consumer (the preflight gate at `scripts/fetch-linkedin.ts:383`) plus one bypass dep seam; the operator wants every run allowed, day and night.
**Recommended**: Single-commit full excision — delete the predicate trio, the gate, the seam, their tests, and every doc claim, recomputing the three cadence-derived claims to the 24/7 bound.
**Effort**: Low (~0.5-1 day including a live rehearsal; ~11 files, deletion-dominant).
**Confidence**: High — verified precedent in the same module (the 2026-11-11 budget-machine deletion, commit `8e8f22b`) and a complete 6-dimension fit grid: 20/20 agent-scored evidence cells (4 candidates × 5 agent dimensions), plus the orchestrator-scored approach-shape dimension below.

## Problem Statement

**Requirements:**
- Every tick runs on any day at any hour: manual runs, `fetch-linkedin`, `watch-linkedin`, and `linkedin-chain` alike.
- The window predicate, its two constants, the tick gate, the `bypassWindow` seam, and their tests are deleted, not stubbed.
- The three cadence-derived claims (`src/linkedin-capture.ts:41`, `scripts/replay-linkedin.ts:54,71-80`, module-header arithmetic) are recomputed to the 24/7 bound, not annotated.
- The quiet-zero/exit-0 contract, the halt latch, the leg-dead episode alarm, and the `harvestedAt` stamp gate keep their current behavior.

**Constraints:**
- Hard: no replacement gate and no bypass switch (discover Decision — "Operator picked removal over a bypass switch").
- Hard: rewrite rather than annotate (composite lesson from the budget deletion: deleted gates leave header prose, gate vocabularies in unrelated files, and stale doc claims — sweep all in the same commit).
- Hard: repo non-negotiables — fail visible, atomic state writes, strict TS flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Node >= 22 ESM.
- Soft: the four "five gates" enumerations and the mirrored two-machine lists shrink in lockstep across code comments, `AGENTS.md`, and `.rpiv/guidance/scripts/architecture.md`.

**Success criteria:**
- Bare `working-hours` grep returns zero hits across live paths (verified zero false positives in research).
- `npm run typecheck && npm run lint && npm test && npm run knip` all green.
- An off-hours (night/weekend) tick traverses latch → guardCheckout → cookie resolver → stamp gate → walk, and exits 0 on quiet-zero arms as before.
- The chain no-op report stays gate-name-free and the exit contracts stay bit-identical.

## Current State

**Existing implementation:**
- Window trio: `WINDOW_START_HOUR` (`src/linkedin-behavior.ts:26`), `WINDOW_END_HOUR` (:33, exclusive-end half-open contract), `isWithinWorkingHours` (:43-48, local-time only). Module header names the machine twice (:5, :15-19 worst-case arithmetic: 13 h window → 28 wake-ups/local day).
- Sole production consumer: preflight gate `scripts/fetch-linkedin.ts:376-394` — comment (:376-379, "Order: window -> latch"), `at` (:382, sole clock read), gate (:383), quiet-zero return (:384-387).
- Sole bypass seam: `FetchTickDeps.bypassWindow` (`scripts/fetch-linkedin.ts:133-138`), read only at :383; 16 test injections at `tests/fetch-linkedin.test.ts` lines 418, 471, 505, 542, 573, 597, 615, 632, 667, 701, 822, 890, 916, 944, 979, 1038.
- The gate test at `tests/fetch-linkedin.test.ts:830-847` cannot survive removal as-is: with no bypass flag and an unscripted `scriptGit` default (:316-325), post-removal the tick proceeds to `guardCheckout` and throws `/not main/` — the quiet-zero assertion at :844 becomes unreachable. The Monday pin (:849-869) survives verbatim.

**Relevant patterns:**
- History-comments-not-stubs: `src/linkedin-behavior.ts:2-4`, `scripts/fetch-linkedin.ts:376-377`, `tests/linkedin-behavior.test.ts:2` remember the deleted budget machine in prose — 0 stub sites repo-wide.
- Atomic enumerate-then-delete single commit: `8e8f22b` (25 files, ~2,155+/2,790-), docs split `a88494e`; the window itself landed single-commit in `7558747`.
- Dead-export discipline: knip is the binding unused-export guard (CI runs it at `.github/workflows/ci.yml:35-36`); tsconfig has NO `noUnusedLocals`, biome recommended catches the unused import, knip catches dead exports.

**Integration points:**
- `scripts/fetch-linkedin.ts:39` — the only production import of `isWithinWorkingHours` (zero importers in `src/`).
- `scripts/fetch-linkedin.ts:376-394` — the preflight band; latch (:389-394) becomes first gate, byte-identical; `now` survives at :434/:445/:477 (walk clock, halt latch stamp, payload stamp).
- `scripts/linkedin-chain.ts:116` — the quiet-zero classifier is shape-only; the chain is behaviorally immune; the "five gates" comments (:21-22, :112-115) shrink to four.
- `scripts/watch-linkedin.ts:48-83` — `runLoop` discards tick results (:65); structurally window-agnostic; only header :4-5 is stale prose (it also names the already-deleted "daily budget").
- Cadence-derived claims: `src/linkedin-capture.ts:35-46` (retention churn ~2-2.4 GB/day → ~3.7-4.3 GB/day at 43-51 walks/day), `scripts/replay-linkedin.ts:54,71-80` ("20 sessions ≈ one working day" → ≈ 9-11 hours).

## Solution Options

### Option 1: Single-commit full excision
**How it works:**
One commit deletes the predicate trio, the tick gate, the `bypassWindow` seam, the 16 test injections, and the doomed gate test (inverted into a Saturday-noon proceeds-pin), rewords the module-header arithmetic to the 24/7 bound (1440/28 = 52 wake-ups/day), and sweeps every doc claim in lockstep. The closest precedent — the budget-machine deletion — used exactly this shape.

**Pros:**
- Strong precedent-fit: same module, same gate band, same two test files, same doc set as `8e8f22b`; single-commit symmetry both directions (introduction `7558747`, deletion `8e8f22b`).
- Every automated guard works for you: excess-property checking sweeps the 16 injections, biome flags the orphaned import, knip (CI `ci.yml:35-36`) flags any missed dead export.
- Revert is a symmetric single `git revert`; no orphaned runtime artifact (the quiet-zero is stateless, unlike the budget ledger).

**Cons:**
- Forfeits the cheap future re-gating the seam provided (Fowler ops-toggle category legitimizes long-lived kill switches).
- Off-hours loop activity weakens the human-shape of the activity graph (vendor guidance treats off-hours timing as a detection signal) — an accepted discover trade, not a new one.

**Complexity:** Low (~0.5-1 day)
- Files touched: ~11 (2 src, 1 script core, 2 test files, 5-6 doc/comment sites)
- Risk level: Low-Medium (closest precedent needed 3 corrective commits in 4 days once it met the live account — plan a rehearsal)

### Option 2: Two-phase removal
**How it works:**
Commit 1 makes the gate unconditional (drops the import and the gate block) and keeps the dead symbols; one observation day; commit 2 deletes the trio, seam, injections, and docs. The textbook flag-removal lifecycle (Featureflip two-PR pattern, Unleash docs).

**Pros:**
- Canonical practice with ecosystem momentum (LaunchDarkly now ships an AI flag-cleanup skill; Fowler mandates proactive removal).
- Phase 1 alone is a tiny, trivially revertible diff.

**Cons:**
- Zero repo precedent: the house style is enumerate-then-delete atomically; corrective commits, not observation days, were the de-facto safety net.
- The observation day buys nothing: every gate already logs, the loop logs wakes, and payload commits to main are the real telemetry.
- Mid-phase the docs actively lie: "five gates" lists name a gate that never fires; volume math claims 28 wake-ups while live is 52; the seam doc "Default: false" becomes false.

**Complexity:** Medium (same total work, two commits + one CI cycle + a day of waiting)
- Files touched: same ~11, split across 2 commits
- Risk level: Low (but the known debt of this pattern is skipping commit 2)

### Option 3: No-op predicate swap
**How it works:**
Keep `isWithinWorkingHours` but make it return `true` unconditionally; delete the two constants. The smallest-looking diff.

**Pros:**
- The seam and gate stay type-legal, so the 16 injections survive untouched — the only real diff saving.
- Trivially revertible by restoring the comparison.

**Cons:**
- "Smallest diff" is illusory: the predicate suite still breaks (constants imported at `tests/linkedin-behavior.test.ts:17-18`, describe :38-63 fails), the Saturday test :830-847 still needs inversion, and the header math rewrite is still forced — both test files are touched anyway.
- Every automated guard is blind: no `noUnusedLocals`, biome fires nothing on a constant-returning function, knip cannot flag a symbol with a live importer.
- Active falsehoods persist: unreachable log :384-386 still claims "outside the working window", comment :379 becomes false, the seam doc lies, and an always-true guard invites a silent future re-gating with zero compiler resistance.

**Complexity:** Low-Medium (misleadingly — the residue cost is permanent)
- Files touched: ~9 (skips only the injection sweep and seam deletion)
- Risk level: High (misleading API surface; guards-blind dead code)

### Option 4: Excision + cadence compensation
**How it works:**
Full excision (as Option 1) plus raise the wake floor from 28 to ~55 minutes so 24/7 stays near the old ~28 walks/day bound and capture churn stays ~2 GB/day.

**Pros:**
- Preserves the old worst-case daily volume (~28 walks) and the ~2 GB/day capture churn figure.
- Vendors formalize volume-based safety (daily caps + randomized delays) rather than time gates, so the direction is defensible.

**Cons:**
- Out of scope by definition: the discover Decision records "Yes — the loop goes 24/7 too. The session-heat trade is accepted", codified at existing cadence.
- Hidden cross-machine seam: raising only the floor inverts the `sampleTickDelayMs` span (`src/linkedin-behavior.ts:73-75`); both constants must move; and the `WAKE_MAX_MS` 33-min ceiling is tied to `PAYLOAD_MAX_AGE_MS` (40 min, `src/linkedin-payload.ts:38`) "with margin" — a 55-65 min band makes worst-case gaps exceed the freshness bound, classifying the leg stale between ticks; the payload constant and its pin must rise too.
- No repo precedent for retuning surviving WAKE bounds; residue lines get rewritten twice against different targets.

**Complexity:** Medium (~15 files, three suites, one hidden contract)
- Risk level: Medium (the payload-freshness coupling is easy to miss and breaks a documented margin)

## Comparison

| Criteria | Option 1: Full excision | Option 2: Two-phase | Option 3: No-op swap | Option 4: +Cadence |
|----------|-------------------------|---------------------|----------------------|--------------------|
| Approach-shape | Delete-only; end state = intent | Staged delete; mid-phase false docs | Neutered gate; end state ≠ intent | Delete + retune; two machines |
| Complexity | Low | Medium | Low-Medium (illusory) | Medium |
| Codebase fit | High (mirrors 8e8f22b) | Low (zero precedent) | Low (0 stub sites) | Low (no retune precedent) |
| Guard coverage | All guards work | knip question in phase 1 | All guards blind | Guards work, extra pins |
| Doc truthfulness | Same-commit truth | Mid-phase lies, then truth | Permanent lies | Same-commit truth |
| Scope conflict | None | None (process-only) | Violates rewrite-not-annotate | Violates recorded cadence Decision |
| Risk | Low-Medium | Low | High | Medium (payload margin) |

### Approach-shape (orchestrator-scored)
- **Option 1**: direct dead-code excision — zero new moving parts; the end state is exactly the operator intent (every tick, any hour), and the shape matches the module's own history (one behavior machine fewer, remembered in comments).
- **Option 2**: staged removal — adds a gate → observe → delete process stage whose observation is already free (every gate logs, the loop logs wakes, payload commits are telemetry); identical end state to Option 1 with a mid-phase false-doc window.
- **Option 3**: neutered gate — keeps a dead predicate, seam, and gate block; the end state diverges from intent (misleading API, silent re-gating possible with zero guard resistance).
- **Option 4**: excision + retune — touches two machines (wake cadence and payload freshness); the end state diverges from intent (slower loop, `PAYLOAD_MAX_AGE_MS` re-sized).

## Recommendation

**Selected:** Option 1 — Single-commit full excision.

**Rationale:**
- It is the only candidate where every automated guard (excess-property checking, biome, knip in CI) enforces the deletion-set, making the sweep mechanically verifiable — `tests/fetch-linkedin.test.ts` injections fail typecheck if missed; knip fails CI if any export survives.
- It is the exact shape this module already executed once: the budget deletion (`8e8f22b`) deleted a machine from the same file through the same gate band with the same doc set, single-commit, and the window itself landed single-commit in `7558747` — precedent-fit is 1:1.
- The mandatory test inversion and doc sweep are candidate-invariant work (Options 2 and 3 must do them too), so Option 1 buys the clean end state at near-identical marginal cost.

**Why not alternatives:**
- Option 2 (two-phase): the observation stage buys nothing here — gates log, the loop logs wakes, payload commits are telemetry. Zero repo precedent; mid-phase doc drift; the pattern's known debt is never landing commit 2.
- Option 3 (no-op swap): every guard is blind to an always-true predicate with a live importer; the "saved" work (injections, seam) is offset by work it cannot skip (both test files, header math); permanent misleading API that invites silent re-gating.
- Option 4 (cadence compensation): out of scope by the recorded discover Decision ("session-heat trade is accepted" at existing cadence), and it silently breaks the `PAYLOAD_MAX_AGE_MS` freshness margin — a 55-65 min band exceeds the 40-min worst-case gap the 33-min ceiling was sized to clear.

**Trade-offs:**
- Accepting the loss of cheap future re-gating (the `bypassWindow` seam dies) for zero dead surface and truthful docs.
- Accepting ~52 worst-case wake-ups/day (1.86× the old bound) and ~3.7-4.3 GB/day capture churn (retention keeps it bounded) for operator freedom to run at any hour.
- Accepting slight weakening of the activity graph's human-shape (off-hours activity) — already decided in discover; the jittered 28-33-min cadence, residential IP, and persistent profile remain the load-bearing mitigations.

**Implementation approach:**
1. Excise the predicate trio and reword the header — `src/linkedin-behavior.ts`: delete `WINDOW_START_HOUR` (:26), `WINDOW_END_HOUR` (:33), `isWithinWorkingHours` (:43-48) with their docs (:22-42); rewrite :15-19 to the 24/7 bound (1440/28 = 52 wake-ups/day, cadence × click cap); purge the machine name from :3-5.
2. Excise the gate and the seam — `scripts/fetch-linkedin.ts`: delete the import (:39), `bypassWindow` (:133-138), the band comment (:376-379), `at` (:382), the gate (:383-388); latch band :389-394 untouched.
3. Tests — delete `tests/linkedin-behavior.test.ts:38-63` and imports :17-19; strip the 16 `bypassWindow` injections; invert :830-847 into a Saturday-noon proceeds-pin; retitle :849-869; add one out-of-hours weekday proceeds-pin (neither surviving clock defeats an hours-only reintroduction).
4. Doc sweep in lockstep — `scripts/linkedin-chain.ts:21-22,112-115`; `scripts/watch-linkedin.ts:4-5` (also drop the dead "daily budget" half); `src/config-file.ts:75`; `AGENTS.md:58-59,103-105`; `.rpiv/guidance/scripts/architecture.md:10,32,112-114`; recompute `src/linkedin-capture.ts:41` (~43-51 walks/day, ~3.7-4.3 GB/day); recompute `scripts/replay-linkedin.ts:54,71-80` (20 sessions ≈ 9-11 hours).
5. Gates — `npm run typecheck && npm run lint && npm test && npm run knip` (the same four CI enforces).
6. Live rehearsal — one manual off-hours tick and one loop wake against the live account; verify the quiet-zero/exit-0 contract and the alarm text still tell the truth with one fewer gate.

**Integration points:**
- `scripts/fetch-linkedin.ts:39,133-138,376-388` — the production excision; the latch becomes the first preflight gate without moving.
- `src/linkedin-behavior.ts:1-48` — the predicate trio, its docs, and the header arithmetic.
- `tests/fetch-linkedin.test.ts:418-1038 (16 sites), 830-869` — the injection sweep and the test inversion.
- `src/linkedin-capture.ts:41` and `scripts/replay-linkedin.ts:54,71-80` — the cadence-derived recomputations.

**Patterns to follow:**
- Exhaustive deletion-set inventory FIRST: `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md` (line 94) — the budget deletion avoided mid-flight breaks this way; its locked-files line still missed `reset-linkedin.ts` (line 1733 lesson), so verify the importer sweep with grep, not memory.
- History comments, not stubs: `src/linkedin-behavior.ts:2-4`.
- Atomic single commit with a docs split if needed: `8e8f22b` / `a88494e`.

**Risks:**
- Off-hours detection signal: vendor guidance treats night-hours activity as one signal among several (Linked Helper lists working-hours scheduling among safety controls; PhantomBuster warns on change-from-baseline). Mitigation: accepted discover trade; no public ban report cites night-hours alone; cadence jitter, residential IP, and profile fidelity are the load-bearing mitigations. Watch session health during the first week.
- Follow-up fixes like the precedent (3 corrective commits in 4 days after `8e8f22b`). Mitigation: the live rehearsal in phase 6; verify the chain no-op report and alarm text.
- knip gate surprise: CI runs knip (`ci.yml:35-36`); run it locally before pushing so a surviving export never reaches CI.
- Hours-only reintroduction gap: the Saturday pin blocks day-of-week gates only. Mitigation: the new out-of-hours weekday proceeds-pin.

## Scope Boundaries
- Building: the full excision, the test inversion and new pin, the lockstep doc sweep, the 24/7 recomputation of the three cadence-derived claims, and a live rehearsal.
- NOT doing: any replacement gate or bypass switch (decided); any cadence retune (decided); any config-gated active-hours key (decided); the `harvestedAt` stamp AGE check — the FRD's flagged follow-up, more load-bearing under 24/7, deserves its own change; no README edit (verified clean).

## Testing Strategy

**Unit tests:**
- `tests/linkedin-behavior.test.ts`: delete the `isWithinWorkingHours` describe (:38-63) and the window imports (:17-19); wake-cadence (:65-92) and halt-vocabulary (:94-104) describes survive unchanged.
- `tests/fetch-linkedin.test.ts`: strip 16 `bypassWindow` injections; invert :830-847 (Saturday noon now proceeds to `guardCheckout` and asserts `/not main/` reachability of the walk path with a scripted git); retitle :849-869 to pin guard-before-walk; add the out-of-hours weekday proceeds-pin.
- Untouched by construction: `tests/linkedin-chain.test.ts` (shape/regex pins only) and `tests/watch-linkedin.test.ts` (no window symbols).

**Integration tests:**
- The four gates as CI runs them: `npm run typecheck` (excess-property checking is the injection sweep), `npm run lint` (biome, every touched script enumerated), `npm test`, `npm run knip` (dead-export gate, `ci.yml:35-36`).

**Manual verification:**
- [ ] Off-hours tick: run `npm run fetch-linkedin` at night/weekend from the dedicated clone; confirm latch → checkout guard → walk traversal and exit 0 on a quiet arm.
- [ ] Chain: run `npm run linkedin-chain`; confirm the no-op report ("a quiet gate held") and exit codes unchanged.
- [ ] Loop: one overnight `npm run watch-linkedin` window; confirm 28-33-min wakes continue past 21:00 and before 08:00.
- [ ] Grep: bare `working-hours` returns zero hits across live paths.
- [ ] Session health: no new checkpoint walls or leg-dead episodes in the first 48 h of 24/7 operation.

## Open Questions
**Resolved during research:**
- Can the doomed gate test survive as-is? No — post-removal it throws `/not main/` via `guardCheckout` (`tests/fetch-linkedin.test.ts:830-847` vs `scriptGit` default :316-325); inversion is mandatory. Evidence: research doc + codebase agent verification.
- Does anything outside `fetch-linkedin.ts` import the window symbols? No — zero `src/` importers; one production import at `scripts/fetch-linkedin.ts:39`.
- Is knip a real guard here? Yes — CI runs it (`ci.yml:35-36`); it is the binding dead-export guard and independently flags any missed deletion.

**Requires user input:**
- None — every branch was resolved as a discover Decision recorded in the research artifact.

**Blockers:**
- None.

## References
- `.rpiv/artifacts/research/2026-11-15_09-09-30_remove-linkedin-working-window.md` — the driving research artifact (all file:line anchors, precedents, Developer Context decisions).
- `.rpiv/artifacts/discover/2026-11-15_08-44-36_remove-linkedin-working-window.md` — the FRD with the original Decisions.
- `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md` — the budget-deletion precedent (deletion-set inventory at line 94; locked-files lesson at 1733).
- `src/linkedin-behavior.ts:1-93` — the window trio and its surviving machine vocabulary.
- `scripts/fetch-linkedin.ts:365-496` — `fetchTick`, the preflight band, and the exit contracts.
- `https://martinfowler.com/articles/feature-toggles.html` — the carrying-cost framing behind full excision.
- `https://knip.dev/` — the dead-export guard the repo already runs in CI.