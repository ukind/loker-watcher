---
date: 2026-11-15T10:27:02+0700
author: Yogiswara Utama
commit: be5407a
branch: ukind/feature-auto-login-threads
repository: feature-auto-login-threads
topic: "Tech-debt ledger zero — landing/phasing"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, tech-debt, phasing, capture-sink, facades, ci, judge, linkedin-leg, tooling-majors]
last_updated: 2026-11-15T10:27:02+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Tech-debt ledger zero — landing/phasing

**Date**: 2026-11-15T10:27:02+0700
**Author**: Yogiswara Utama
**Commit**: be5407a
**Branch**: ukind/feature-auto-login-threads
**Repository**: feature-auto-login-threads

## Research Question
Close every finding in `TECH_DEBT_AUDIT.md` (16 findings; F002 deferred by the developer) as one pass. Scope and all ~19 per-finding decisions are locked by the discover FRD and the research doc's Developer Context. The only live axis: how should the pass LAND on this branch — single phased PR, risk-tiered PRs, or module-vertical slices?

## Summary
**Problem**: 15 actionable findings (F002 deferred; F011 is one operator command; F016 stays as-is) must land without breaking six recorded interlocks (knip atomicity, lockfile ordering, captures-deletion ordering, the F014 re-export consumer, F005's live validator, majors-last cache economics).
**Recommended**: Single phased PR — the repo's only landing shape that has ever merged a remediation pass (run4, audit-run1, run6); the divergent shape (run5) never merged. Phase order encodes every interlock as a commit boundary.
**Effort**: Med (~2 days: phases 1-3 in a run6-length session, majors an afternoon per the FRD churn budget, verification on top).
**Confidence**: High.

## Problem Statement

**Requirements:**
- Land all 15 actionable findings with the six interlocks intact.
- Gate-green at every landing unit (typecheck, lint, test, knip; madge joins in the CI phase).
- F007 majors land LAST, policed by the gates frozen in the CI phase.

**Constraints:**
- Hard: facade deletion atomic with 10-site re-pointing (knip zero-importer); madge devDependency commit before majors (`npm ci` drift); captures/ deleted only after 25 sink injections; F014's re-export keeps its consumer (`scripts/watch-linkedin.ts:20`); madge invocation verified locally before its YAML merges.
- Soft: per-finding mechanical verification greps inside bundled commits; same-day fix window budgeted for new CI gates; next live dispatch validates F005.

**Success criteria:**
- `grep -rn "run #7" src/` empty; `npm run knip` exit 0; committed madge script exits 0 on the type-only graph; two clean-checkout `npm test` runs pass with no `captures/` regrowth; staged commit fires lint-staged 17; ledger reads zero (F002 recorded as deferred).

## Current State

**Existing implementation:**
The pass edits five layers at `be5407a`: capture sink defaults (`scripts/fetch-linkedin.ts:438`, `scripts/probe-linkedin.ts:183`), both run-#7 facades (`src/judge.ts:25-36`, `src/linkedin-fetch.ts:46-68`) with 10 real import sites (6 mixed), the probe's brace defect (`scripts/probe-judge.ts:122`), the judge cap pair (`src/judge-rotation.ts:66` vs `src/judge-health.ts:47`), CI (`ci.yml:13-36`, `watch.yml:60-80`), and the tooling manifest (`package.json:13,15,30-42`). `captures/` holds exactly the two leaked dirs; `captures/` is gitignored, so deletion is an operator `rm`, never a commit.

**Verification drift (live re-check at this dispatch — the research doc is materially accurate; cosmetic drift only):**
- `scripts/probe-judge.ts`: bare `await main()` is at **:340** (file is 341 lines), not :349 as the research doc says. The envelope defect :122, direct fetch :112, exit-1 block :329-334 — all exact.
- `scripts/fetch-linkedin.ts` facade import block is **:41-49** (:40 is the adjacent capture import).
- `tests/fetch-linkedin.test.ts`: seen-stop describe at **:1013** (research said :1024); the leaking call site :1036 is exact; oracle snapshot/after live at :61-78 (research :63-76, ±2).
- `aa852b5` is run6 **phase 2** ("capture bound (N051)") in the post-rebase lineage (`cd2297f` p1 → `aa852b5` p2 → … → `f50067d` p6); the pre-rebase identities were `a791606..19d7a94`. The research's harness-precedent label is loose; the hash and content are real.
- Injection census re-verified verbatim by two independent agents: 18 fetchTick blocks / 5 injecting (:422, :546, :577, :601, :886); 7 runProbe blocks / 2 injecting (:275, :308).

**Relevant patterns:**
- Gated-slice landing: `plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md:29` — "Each slice is green under typecheck, lint, and test before the next lands".
- Verbatim-vs-logic separation: same plan :126 — "a move carries no logic edits".
- Gate-tool pinning: knip as devDependency + npm script, "never npx" (f50067d).

**Integration points:**
- `src/linkedin-capture.ts` — gains `NOOP_CAPTURE_SINK` (F001).
- `tests/capture-oracle.ts` — new shared helper (F015); consumed by the three oracle suites.
- `src/judge.ts:25-36`, `src/linkedin-fetch.ts:46-68` — facade deletions; 10 importer edits; `src/linkedin-fetch.ts:72-73` becomes the SleepFn re-export (F014).
- `src/judge-rotation.ts:66` — one-keyword export (F004).
- `scripts/probe-judge.ts:122`, :340 — envelope gate + entry guard + injectable fetch (F005).
- `ci.yml` after :36 — madge + audit steps (F003, F013); `watch.yml:69` — env-indirect (F010); `package.json:13,15` — format list (F012); :30-42 — majors (F007).

## Solution Options

### Option 1: Single phased PR (one branch, ordered commits, one merge)
**How it works:**
Four ordered phase commits on this branch, one rebase onto main, one FF/push landing. Phase 1: capture sinks + shared oracle + captures/ deletion. Phase 2: probe envelope fix (entry guard at :340 + injectable fetch), both facade removals with 10-site re-pointing, SleepFn dedupe, cap export, comment rewrites, README docs. Phase 3: CI additions (madge devDependency + npm script + YAML step, non-blocking audit, watch.yml env fix, format list). Phase 4: dev-tool majors last (TS 7, biome 2 + biome.json migration, knip 6, lint-staged 17, @types/node 26, playwright/nodemailer minors).

**Pros:**
- Only shape with a merged track record: run4 (5 gated commits), audit-run1 (one branch, ~9 commits, one next-morning FF), run6 (6 phases, one rebase, ~65-minute stack). The divergent shape (run5, un-ordered stack) never merged — 463 commits behind, `git merge-base --is-ancestor f1812b4 main` exits 1.
- Every interlock maps 1:1 onto a commit boundary: knip atomicity = phase 2; lockfile ordering = phase 3 before phase 4; captures ordering = phase-1 internal; F014 consumer = same commit as its facade; majors-last saves exactly one playwright cache miss (`watch.yml:179`).
- Gate-before-bump ordering is achievable only here: phase 4 is the first majors commit policed simultaneously by the frozen cycle graph, the extended format list, and the audit step.

**Cons:**
- Phase 2 is a fat revert unit (~8 findings + 10-site re-pointing + the pass's only behavior change in one commit).
- Green-at-every-commit is local discipline — hosted CI runs per push, not per commit (run6 accepted exactly this; `validation/2026-11-14_08-15-48`:90).
- Bisects stop at phase granularity, not finding granularity.

**Complexity:** Low-Med (~2 days)
- Files touched: ~25-30 across src/scripts/tests/workflows/README/manifest (run6 comparably touched ~30).
- Risk level: Low-Med (concentrated in phase 2's breadth and phase 4's churn).

### Option 2: Risk-tiered PRs (4 stacked, lowest-risk-first)
**How it works:**
(a) sinks/oracle + captures delete; (b) facades + SleepFn + cap + probe fix + comments; (c) madge CI + watch.yml env + format list + audit; (d) majors. Each independently green and mergeable; stacked/rebased between merges.

**Pros:**
- All six interlocks survive per-branch-head; the hosted Test re-arms the capture oracle on every review push of (a) — clean-checkout validation N times, not twice.
- Per-unit review diffs are genuinely risk-homogeneous.

**Cons:**
- Granularity is novel here: 0 of 5 prior passes used a stacked-PR series; the repo's entire landing history is FF/push single stacks.
- ~4× CI round-trips + 3 rebases vs run6's single landing; 4 self-review cycles are new ceremony for a single-developer repo.
- **F009 (README PC-path docs) is assigned to no tier as named** — the stack ends ledger-nonzero unless it folds into (c).
- (b) still mixes verbatim re-pointing with the F005 logic change + unscoped entry-guard refactor; the PR boundary does not honor the "a move carries no logic edits" doctrine — only per-finding commits inside (b) would.

**Complexity:** Med (~2-3 days; same content, more ceremony)
- Risk level: Med (lockfile rebase zone between (c)/(d); review overhead).

### Option 3: Module-vertical slices (3 PRs: judge / linkedin / tooling-CI)
**How it works:**
PR1 = judge side (F004, F005+entry guard, F006-judge, F008, F013); PR2 = linkedin side (F001+F015, F006-linkedin, F014, F009); PR3 = tooling/CI (F003, F010, F012, F007 last).

**Pros:**
- knip atomicity per PR is strong: the two facade importer sets are disjoint (verified file-by-file), so each removal is independently provable; `tests/linkedin-fetch.test.ts` hosts both a facade block and a capture oracle but both belong to PR2 — no hidden straddle.
- F005's live-validation window opens earliest (PR1 merges first).

**Cons:**
- **Interlock broken #1**: F013 (PR1) and F003 (PR3) both edit the same `ci.yml` step list after :36, and the split inverts the recorded "madge first, audit second" wiring — a guaranteed textual conflict plus a convention no gate can enforce.
- **Interlock broken #2**: the repo's only red gate (the F001 leak fires deterministically on fresh checkouts via `tests/fetch-linkedin.test.ts:1036` → `scripts/fetch-linkedin.ts:438`) is fixed by PR2 of 3 — PR1 and PR3 spend their whole CI lifetime on a red Test step neither owns; the Test gate discriminates nothing for 2 of 3 units.
- 0 of 5 prior passes used module slicing; it replaces the research's own risk-phase order with module order.
- Two clean-checkout F001 runs and the lint-staged check become PR2/PR3-local steps that are easy to drop.

**Complexity:** Med-High (~2-3 days + coupling management)
- Risk level: High (two broken interlocks; gate blindness on two units).

## Comparison

| Criteria | Option 1: Single phased PR | Option 2: Risk-tiered PRs | Option 3: Module slices |
|----------|----------|----------|----------|
| Complexity | L-M | M | M-H |
| Codebase fit (precedent) | H — 3 merged passes; run5 counter-example | M — ordering precedented, granularity novel (0/5) | L — 0/5; replaces the FRD's own phase order |
| Interlock survival | H — all 6 map to commit boundaries | H — all 6 survive per-branch-head; F009 unassigned | L — 2 broken (ci.yml wiring; red-gate lifetime) |
| Migration cost | 1 branch, 1 rebase, 1 landing | 4 lifecycles, 3 rebases, new ceremony | 3 branches, ≥2 rebases, red-gate PRs |
| Verification | Fixed surface; gate-before-bump unique; local per-commit discipline | ≥28 hosted gate runs; hosted oracle re-arm | No Test signal on 2/3 units; knip per-unit strong |
| Risk | L-M (phase-2 breadth) | M (lockfile rebase; ceremony) | H (broken interlocks) |

## Recommendation

**Selected:** Option 1 — Single phased PR.

**Rationale:**
- Track record: the only landing shape this repo has ever merged for a remediation pass (run4: 5 gated commits; audit-run1: branch → next-morning FF; run6: 6 phases + one rebase, ~65 min). Run5 — the un-ordered stack — never merged and is the recorded counter-example.
- The phase order IS the interlock map: knip atomicity lands inside one phase-2 commit; the madge lockfile commit precedes the majors commit so `npm ci` polices each state; captures deletion follows injection inside phase 1; F014's re-export and its only consumer land together; majors-last bounds the playwright cache (`watch.yml:179`) to exactly one miss.
- Gate-before-bump is unique to this shape: phase 4 becomes the first majors commit policed by the frozen cycle graph + extended format list + audit step simultaneously. Neither alternative can order that protection the same way.
- Cheapest migration: fresh branch at the main tip (`be5407a`), one planned rebase (main's churn is ~106 commits/day but ~88 are `state:` — disjoint from every file this pass edits; `scripts/commit-state-rebase.sh` already absorbs the class), one landing.

**Why not alternatives:**
- Option 2 (risk-tiered PRs): clears the fit filter but pays ~4× CI round-trips + 3 rebases + novel review ceremony for one real gain (hosted oracle re-arm per review push) that local clean-checkout runs already cover. Leaves F009 unassigned as named — a scoping defect the design would have to repair.
- Option 3 (module slices): fails the fit filter. Two broken interlocks: the `ci.yml` F013/F003 double-touch inverts the recorded madge-then-audit wiring, and the only red gate's fix lands second — PR1 and PR3 run green-blind on a deterministically red Test step. Unprecedented shape; replaces the research's own composite lesson ("phase like run6") with module order.

**Trade-offs:**
- Accepting phase-2 breadth (one fat revert unit: F005 + 10-site re-pointing + smalls) for atomicity-by-construction; mitigated by per-finding mechanical greps (`grep -rn "run #7" src/` → empty; `npm run knip` → 0), the same mitigation run6 accepted for its 10-finding phase 6.
- Accepting local per-commit gate discipline (hosted CI runs per push) for one rebase and one landing; run6 precedent (`validation/…run6…md:90`) shows the accepted form.

**Implementation approach:**
1. Phase 1 — F001+F015: export `NOOP_CAPTURE_SINK`; create `tests/capture-oracle.ts` (snapshot + assert-absent + leaked-dir report); inject into 18 fetchTick + 7 runProbe blocks; remove the two `??` defaults; operator `rm -rf captures/`; two clean-checkout `npm test` runs.
2. Phase 2 — smalls + probe fix + facades: F006 (delete both facades; 10-site re-pointing — 6 are splits, not swaps), F014 (SleepFn re-export replaces `src/linkedin-fetch.ts:72-73`), F004 (`export const HEALTH_CAP_STREAK` + equality test in `tests/judge-health.test.ts`), F005 (transplant the `src/judge-availability.ts:138-146` envelope gate into `timed()`; entry-guard at `scripts/probe-judge.ts:340`; injectable fetch; replay tests), F008 (rewrite the `REQUEST_TIMEOUT_MS` comment citing run 40264368939), F009 (README PC-path defaults + overrides).
3. Phase 3 — CI additions: F003 (madge devDependency + npm script — invocation verified locally to exit 0 on the type-only graph BEFORE the YAML lands — + ci.yml step after :36), F013 (`npm audit --omit=dev` non-blocking), F010 (step-level `env: FORCE` in watch.yml:69), F012 (extend the format list: `scripts/probe-judge.ts`, `scripts/hooks`, `watcher.config.json`).
4. Phase 4 — majors last: TS 7, biome 2 (+ biome.json 2.x migration), knip 6, lint-staged 17 (verify with a staged commit), @types/node 26, playwright 1.65.1, nodemailer 10.5.0; gates in order typecheck → lint → test → knip → madge → audit; one final clean-checkout re-run.

**Integration points:**
- `src/linkedin-capture.ts` — export the no-op sink.
- `tests/capture-oracle.ts` — new; three suites re-point to it.
- `scripts/fetch-linkedin.ts:438`, `scripts/probe-linkedin.ts:183` — defaults removed.
- `src/judge.ts:25-36`, `src/linkedin-fetch.ts:46-68` — deletions; `src/linkedin-fetch.ts:72-73` — re-export.
- `scripts/probe-judge.ts:122`, :340 — gate + entry guard.
- `ci.yml:36` (two steps), `watch.yml:69`, `package.json:13,15,30-42`.

**Patterns to follow:**
- Gated-slice doctrine: `plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md:29`, :126.
- Gate-tool pinning (devDependency + npm script, never npx): f50067d.
- Measured-evidence comment idiom: `src/judge.ts:59-66` (WAIT_BUDGET_MS doc) as the model for F008.

**Risks:**
- Phase-2 breadth: mitigated by the per-finding greps above; revert unit cost accepted.
- New CI gates break on first land (precedent: `42b8cf8`, `510ff2a`): budget a same-day fix window; the phased shape isolates them to their own revertable commit.
- F005 passes offline and is corrected live (precedent: `7cc7250` one day after `73d6786`; availability plan :2049): the next live dispatch is the validator; ceiling changes in the next state commit are expected, not a regression.
- Majors churn (biome 2 migration, TS 7 under the strict quartet): the FRD's "an afternoon" budget; verification order catches semantic rewrites; @types/node 26 vs Node 22 skew accepted.

## Scope Boundaries
- Building: all 15 actionable findings as four ordered phase commits on this branch; F011 executed as the one operator command; F016 recorded as leave-as-is.
- NOT doing: multi-PR landing; re-opening any of the ~19 locked per-finding decisions; F002 (deferred — the leg-dead alarm keeps citing the missing DOCUMENTATION.md sections until resolved); per-account freshness windows; moving seen-state out of git.

## Testing Strategy

**Unit tests:**
- F005 replay tests (via the new entry-guard seam + injectable fetch): 2xx error envelope fails the leg; 2xx HTML fails the leg; ramp tallies drive `findConcurrencyCeiling` to 0; a committed 0 floors at 1 with one warning (`src/judge-ceilings.ts:38-44`).
- F004 equality: `assert.equal(HEALTH_CAP_STREAK, HARD_FAIL_TICKS_TO_CAP)` in `tests/judge-health.test.ts`.
- Capture oracle: the shared helper asserts repo-root `captures/` absence and names any leaked session dirs.

**Integration tests:**
- The re-armed oracles in all three suites (fetch-linkedin, probe-linkedin, linkedin-fetch) prove "npm test never writes" at the script-defaulting seam.

**Manual verification:**
- [ ] Two clean-checkout `npm test` runs after captures/ deletion (phase 1), one more after phase 4.
- [ ] `grep -rn "run #7" src/` empty; `npm run knip` exit 0.
- [ ] Madge invocation exits 0 on the 9-cycle type-only graph, locally, before the YAML merges.
- [ ] Staged commit fires the husky/lint-staged 17 chain.
- [ ] `npm audit --omit=dev` stays non-blocking (0 vulnerabilities today; the step is inert).

## Open Questions
**Resolved during research:**
- Does the module split hold on files? — Yes on everything except `ci.yml` (F013/F003 double-touch), which is a blocking defect of Option 3, evidence above.
- Is the research doc's census accurate? — Yes, materially; cosmetic drift recorded (probe-judge :340 not :349; fetch-linkedin facade :41-49; describe :1013 not :1024; aa852b5 is run6 phase 2).
- Has any pass landed as stacked PRs before? — No: run1 (7 commits/1 branch), run2 (4), run3 (4), run6 (6 phases + follow-ups), harness (folded into run6) — all single stacks; run5 (un-ordered stack) never merged.

**Requires user input:**
- F002 placement (already deferred by the developer; the alarm email keeps pointing at missing DOCUMENTATION.md sections — fine to carry past this pass, but it stays open).

**Blockers:**
- Exact madge invocation unverified (tool behavior on type-only cycles): unblock by local verification in phase 3 BEFORE the YAML lands — this is the amended acceptance criterion ("the committed npm script exits 0").
- Is hosted CI currently red on main from the leak? — Check at phase-1 start; if red, phase 1 is also the fix the hosted gate is waiting for.

## References
- `.rpiv/artifacts/research/2026-11-15_09-54-32_tech-debt-ledger-zero.md` — the finding census and locked decisions this analysis verifies and phases.
- `.rpiv/artifacts/discover/2026-11-15_09-31-23_tech-debt-zero.md` — the FRD; acceptance criteria this phasing must satisfy.
- `.rpiv/artifacts/plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md` — gated-slice doctrine (:29), verbatim-vs-logic law (:126), knip pin precedent (:170-174), run5 counter-example (:120), gate-break budget (:2703).
- `.rpiv/artifacts/validation/2026-11-14_08-15-48_tech-debt-run6-remediation.md` — per-phase local gating precedent (:90); facades block `git diff -M` (:77).
- `.rpiv/artifacts/plans/2026-11-08_18-04-00_account-availability-check.md` — "corrected by a live run" lesson (:2049); the envelope gate source.
- `.rpiv/artifacts/plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md` — same-day fix window (:4109); the branch→FF landing variant.
- `TECH_DEBT_AUDIT.md` — the ledger this pass zeroes.
