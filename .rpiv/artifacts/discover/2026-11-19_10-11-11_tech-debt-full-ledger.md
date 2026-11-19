---
date: 2026-11-19T10:11:11+0700
author: Yogiswara Utama
commit: 7087c44
branch: ukind/fix-techdebt-2
repository: fix-techdebt-2
topic: "tech-debt-full-ledger"
tags: [intent, frd, tech-debt, judge, linkedin, tests, docs, state-policy]
status: ready
last_updated: 2026-11-19T10:11:11+0700
last_updated_by: Yogiswara Utama
---

# FRD: Tech-debt full-ledger remediation (audit run #8)

## Summary

Land every open finding from `.rpiv/artifacts/TECH_DEBT_AUDIT.md` run #8 (N065–N092, 24 findings) as one PR on `ukind/fix-techdebt-2`: green the red test suite, warn on the live wake-band/freshness crossing, reclaim the git growth, close the type-cycle homes and both REMOVAL NOTE facades, extract the index.ts pure helpers and the probe ramp, consolidate the judge test doubles, add the missing probe-judge guard and coverage suites, and run the enumerated doc pass. Operator data (wake band 15-45, frozen 40-min payload bound) stays untouched; carried audit open questions stay open.

## Problem & Intent

Developer framing, verbatim: "fix all the debt tech based on this report", success = **"Full ledger cleared"** — "Every open finding in the report lands: red suite, live coupling, git growth, facades, doc drift, all test debt. Full pass, one go." Reinforced mid-interview: "fix everything that valid". The audit is the spec; this pass executes it rather than re-litigating it, with two audit claims corrected by probe evidence (LlmAccount home, second wake-band pin pair) before recording decisions.

## Goals

- Every open audit finding (N065–N092 carried + new) has a landed fix or an explicitly recorded decision in this pass.
- `npm test` goes 669/670 → all green and stays green with the new suites.
- `madge --circular` goes 9 → 0 cycles; `knip`, `tsc`, `biome` stay clean.
- The live signals clear before or with the structural work: red suite (N089), DARK-leg warning (N091), git growth (N090), probe success gate (N065).
- In-code doctrine that this pass overrides (judge-helpers doubles header) is rewritten in the same commit set, so no stale comment contradicts the new shape.

## Non-Goals

- No operator-config change: `linkedinWakeMin/MaxMinutes` stays 15/45; `PAYLOAD_MAX_AGE_MS` stays frozen at 40 min (recorded decision 2026-11-17). N091 lands as a warning, never a validation.
- No redesign of flagged-but-fine items: `linkedin-parser.ts` stays 625-LOC cohesive-pure (documented exception), `PAYLOAD_MAX_AGE_MS` arithmetic unchanged, `stateTempPath`'s `Math.random` untouched.
- No new runtime dependency; no behavior change to the pipeline funnel, judge semantics, or state-write atomicity.
- No scheduled git gc — the N043 "gc once, no schedule" policy is amended only by writing the numeric revisit threshold.
- The audit's live-only/observational open questions are deferred, not answered, by this pass.

## Functional Requirements

1. **N089**: De-pin BOTH wake-band pin pairs — `tests/config-file.test.ts:57-58` and the second pair the probe found at `:278-279` — to shape assertions (`typeof === "number"` + `>= 1` bound), matching the platforms idiom two lines up.
2. **N091**: Emit a warning when the configured wake band crosses the freshness bound — condition: band floor ≥ `PAYLOAD_MAX_AGE_MS` (exported, `src/linkedin-payload.ts:48`); the warning names the freshness rule and the constant. Warning only; never throws; fires once per loop start.
3. **N090**: Run `git gc --aggressive` once from this full clone; verify the loose-object drop; write the concrete revisit threshold into the guidance N043 policy section — "re-gc at 150 MiB loose or 30 s checkout".
4. **N092**: Move `LlmAccount` (`src/judge.ts:70-74`) to a NEW leaf type module (e.g. `src/judge-account.ts` — zero runtime imports) and `LinkedinSurface` (`src/linkedin-fetch.ts:70`) to `src/config-file.ts` (next to `Surface`, `:16-20`); re-point all importers (14 + 5 per probe); madge → 0. Update the now-stale constraint comments documenting the old homes (`src/judge-dispatch.ts:50-53`, `src/judge-rotation.ts:38-40`, `src/linkedin-walk.ts:24-27`).
5. **N067**: Execute both REMOVAL NOTE facades. Judge block (`src/judge.ts:20-36`, re-exports `buildBulkMessages`/`judgePost`): re-point `tests/judge.test.ts:10-11`, `tests/judge-rotation.test.ts:22`, `scripts/probe-judge.ts:46` to `judge-prompts.js` / `judge-dispatch.js`, then delete. Linkedin-fetch block (`src/linkedin-fetch.ts:44-68`, re-exports 7 context symbols + `SCROLL_JS`): re-point every named importer (scripts/fetch-linkedin, probe-linkedin, watch-linkedin `:29`, tests/fetch-linkedin, tests/linkedin-fetch, tests/probe-linkedin, tests/watch-linkedin), then delete. Note: `src/index.ts` imports only native `LinkedinSurface` — the facade comment naming it as a kept-path consumer (`:49`) is stale and dies with the block.
6. **N065**: Replace `scripts/probe-judge.ts:122` `body.includes("{")` with a JSON parse + required `"choices"` key; a parse miss is a failed leg (the refusal-as-data arm already distinguishes the classes).
7. **N066**: Rewrite the "timestamp-ordered zip" parser blurbs around `joinCards` in `AGENTS.md:76`, `.rpiv/guidance/src/architecture.md:118`, and `src/linkedin-behavior.ts:20`; fix the surface count (5 → 7 configured).
8. **N069**: Convert `walkLinkedInSurface`'s 9 positional params (`src/linkedin-walk.ts:95-105`) to a deps object (the `FetchLinkedInDeps` idiom); update the production call site(s).
9. **N070**: Add the `negativeKeywords` row to the README config table and one `negativeKeywords` clause to `AGENTS.md`.
10. **N071**: Port the `warnBodyFault` warn-once idiom to `src/fetch-threads.ts` for BOTH bare catches — `:389` (named by the audit) and `:417` (probe-confirmed same class): warn once per surface walk on non-page-close errors instead of swallowing.
11. **N072**: `scripts/hooks/format-on-edit.js:26-29`: drop `shell: true` (args array), and warn when `result.status !== 0`.
12. **N073**: Reword the harvest success log in `scripts/login-linkedin.ts:224` from "session captured" to "pair captured" (liveness is checked downstream by the chain's probe gate).
13. **N075**: Extract `surfaceLabel` (`src/index.ts:588-592`), `dedupePosts` (`:601-608`), `mergeSurfaceStamps` (`:616-627`) into new `src/pipeline-helpers.ts`; re-point `tests/index.test.ts:31` and internal callers; no re-export shim. Document `linkedin-parser.ts` as a cohesive-pure exception in the doc pass.
14. **N076**: Delete the SCROLL_JS source-text describe (`tests/fetch-linkedin.test.ts:1048-1068`) including its facade `SCROLL_JS` import (`:35`).
15. **N077**: Gate the wall-clock bound at `tests/judge-rotation.test.ts:403` (`elapsed < 500`) on the condition via the existing `inertSleep` seam.
16. **N078**: Add a shared typed fetch-double factory to `tests/judge-helpers.ts`; migrate the 38 + 25 `as unknown as` fetch casts in `tests/judge.test.ts` / `tests/judge-rotation.test.ts`; rewrite the doctrine header line ("Doubles and mock-fetch factories stay per-suite on purpose", `tests/judge-helpers.ts:4`) to record the new decision.
17. **N079**: Move `freshState` to `tests/judge-helpers.ts` as canonical (the richer `tests/judge-rotation.test.ts:56-72` signature, 29 call sites); delete the `tests/judge.test.ts:22-35` mirror.
18. **N080**: Extract the ramp decision — `findConcurrencyCeiling` (`scripts/probe-judge.ts:172-200`), `rampLevel` (`:138-159`), `RAMP_MAX` (`:161`) — into a pure `src/` module (precedent: the probe's writer lives in `src/judge-ceilings.ts`) with its own test suite; add the missing `import.meta.url` entry guard to `scripts/probe-judge.ts` (repo doctrine; it currently awaits `loadWatcherConfig()` + `main()` at import time); add the three audit-named suites: `runPool` (`src/pool.ts:33`), config (`src/config.ts:37,47`), `judge-exhaustion` (`src/judge-exhaustion.ts:29`).
19. **N081**: Doc pass over all seven sub-items: 3-gate claim vs 4 CI gates; probe walk order ("first configured surface" vs walk-each-until-floor, `scripts/probe-linkedin.ts:190,228-248`); "Chrome" vs msedge; `reset-linkedin` missing from command lists; "five LinkedIn leg entries" vs seven; `format` lint scope omitting `probe-judge.ts` (package.json); "5 of the 6 ENV_NAMES" vs 7.
20. **N085**: `scripts/fetch-linkedin.ts:359`: capture `git rebase --abort`'s exit code and output and fold both into `lastFailure`.
21. **N088**: `src/linkedin-capture.ts:193`: drop the `null, 2` pretty-print AND add a `LINKEDIN_CAPTURE=off` env switch that disables capture writing.
22. **N067+N076 ordering**: facade execution lands before/with the N076 deletion so the `SCROLL_JS` re-export removal and its last consumer die in the same commit set.

## Non-Functional Requirements

- **Performance**: no regression to the walk pacing, judge dispatch, or wake-loop timing; the capture sink gets smaller (single-line JSON).
- **Security**: no new `shell: true` spawns (N072 removes the one flagged); no new secrets or env vars beyond the opt-in `LINKEDIN_CAPTURE=off` (not a secret); `npm audit` stays at 0.
- **UX / Accessibility**: operator-facing output stays plain text; the N091 warning and N073 rewording are console lines an operator reads in a terminal.
- **Reliability**: warn-once semantics (N071) never throw; the N091 warning never fails a run; state writes stay atomic (temp+rename) and untouched by this pass; tests stay offline and deterministic (N077 removes the last wall-clock bound).

## Constraints & Assumptions

- **One PR** contains everything (delivery decision). Cluster order inside the PR: live signals → type homes → facades → extractions → test consolidation → doc pass, gates (`typecheck`/`lint`/`test`) re-run per cluster.
- Node ≥ 22, ESM, strict TS flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) stay on; `node:` prefixed imports preferred.
- Tests use `node:test` + `tsx`, offline, fixtures under `tests/fixture/`, `t.mock.method` idiom; the new ramp/suites follow it.
- `git gc --aggressive` runs from this full clone only, once (N043 policy).
- Assumption: `PAYLOAD_MAX_AGE_MS` import into the warning site creates no cycle (`linkedin-payload` imports no behavior/walk module) — research verifies the edge.
- Assumption: the N091 warning lives in `resolveLinkedInWakeBand` per audit rec, but the module header declares `linkedin-behavior.ts` IO-free (`:6-8`); if purity is preserved instead, the warn moves to the single production call site (`scripts/watch-linkedin.ts:136-140`). Either placement satisfies FR-2; implementer picks with the header comment updated to match.
- Assumption: the leaf module for `LlmAccount` is named `src/judge-account.ts` unless a better name surfaces at implement; knip must stay clean (no old-path re-export shims anywhere).

## Acceptance Criteria

- [ ] `npm test` exits 0 with zero failures and more than 670 passing tests (new suites: ramp, runPool, config, judge-exhaustion, plus migrated double factories).
- [ ] `npm run typecheck`, `npm run lint`, `npx knip` each exit 0.
- [ ] `npx madge --circular src scripts` reports 0 cycles.
- [ ] `grep -n "linkedinWake" tests/config-file.test.ts` shows shape assertions only — zero `=== 60` / `, 60)` pins at both former pair sites.
- [ ] With a config whose `linkedinWakeMinMinutes ≥ 40`, the watch loop start emits one warning line naming `PAYLOAD_MAX_AGE_MS` and the freshness rule (unit-test observable via the exported resolver or the loop seam).
- [ ] `git count-objects -v` after the gc shows loose-object size in the low MiB range (from 161.6 MiB), and the guidance N043 section contains the numeric revisit threshold ("150 MiB loose or 30 s checkout").
- [ ] Importing `scripts/probe-judge.ts` performs no config load, no fetch, and no main run (entry guard) — observable via a node import probe or the guard's unit test idiom used by login-linkedin/chain.
- [ ] `grep -rn "timestamp-ordered zip" AGENTS.md .rpiv/guidance src` returns no hits; `negativeKeywords` appears in the README config table and AGENTS.md.
- [ ] `grep -n "shell: true" scripts/hooks/format-on-edit.js` returns no hits, and a failing formatter run produces a warning line.
- [ ] `grep -n "session captured" scripts/login-linkedin.ts` returns no hits ("pair captured" present).
- [ ] New capture files are single-line JSON (no indentation), and with `LINKEDIN_CAPTURE=off` no capture files are created.
- [ ] `tests/judge-helpers.ts` exports the shared fetch-double factory and canonical `freshState`; `grep -c "as unknown as typeof fetch" tests/judge.test.ts tests/judge-rotation.test.ts` returns 0/0; the old doctrine header line is gone.
- [ ] No `REMoval NOTE` / REMOVAL NOTE text remains in `src/judge.ts` or `src/linkedin-fetch.ts`; `grep -rn "from \"./judge.js\"" src scripts tests` shows no type-symbol imports of `LlmAccount` from `judge.ts`.
- [ ] `scripts/probe-judge.ts`'s leg-success check parses JSON and requires `"choices"` (unit-test observable once the ramp module exists).

## Recommended Approach

One PR on `ukind/fix-techdebt-2` executing the audit top-down: first the live-signal S fixes (N089, N091, N065, N071, N072, N073, N085, N088) plus the gc + policy threshold (N090); then the structural moves in dependency order — `LlmAccount`/`LinkedinSurface` homes (N092) → facade execution (N067) → the N076 describe deletion → `src/pipeline-helpers.ts` extraction (N075) → the probe ramp extraction + entry guard + new suites (N080) → test-double consolidation (N078/N079/N077) → the doc pass (N066/N070/N081); gates re-run per cluster, `madge`/`knip` verified at the end.

## Decisions

### D1 — Success shape: full ledger
**Question**: The report lists findings from a 2-minute fix (N089) up to a 1-hour doc pass and multi-hour test refactors. What does success look like for this pass — when are you done?
**Recommended**: n/a — `intent` question.
**Chosen**: "Full ledger cleared" — every open finding lands, including M-effort refactors and the doc pass.
**Rationale**: developer's own framing; reinforced with "fix everything that valid" in the Step 4 confirmation.

### D2 — N091 warning-only
**Question**: Pre-resolved from codebase evidence — batch-confirmed in Step 4.
**Recommended**: warn when the wake band crosses the freshness bound; no hard validation.
**Chosen**: confirmed.
**Rationale**: `evidence: src/linkedin-payload.ts:48 + confirmed` — `PAYLOAD_MAX_AGE_MS = 2_400_000` is an exported, operator-frozen constant (recorded decision 2026-11-17 in its doc comment `:37-47`); the warning is N074's original recommendation now live as N091.

### D3 — N090 gc now + numeric threshold
**Question**: Pre-resolved (default) + scope follow-up: how should the pass handle the repo-history operation?
**Recommended**: run `git gc --aggressive` now from this full clone, then write the revisit threshold into the guidance policy.
**Chosen**: "Run it now" — gc executed in this pass; threshold written as "re-gc at 150 MiB loose or 30 s checkout"; no added observability step.
**Rationale**: `evidence: TECH_DEBT_AUDIT.md N090 + confirmed` — 161.6 MiB loose re-accumulated in ~2 days; the N043 policy's own revisit trigger is now measurable.

### D4 — Facade execution + LinkedinSurface home
**Question**: Pre-resolved from codebase evidence — batch-confirmed in Step 4.
**Recommended**: delete both REMOVAL NOTE blocks, re-point ~18 importers, move `LinkedinSurface` to `config-file.ts`.
**Chosen**: confirmed.
**Rationale**: `evidence: src/judge.ts:20-36, src/linkedin-fetch.ts:44-68 + confirmed` — two runs stale; `config-file.ts:16-20` already owns `Surface`, and `LinkedinSurface = Extract<Surface, …>` belongs beside it.

### D5 — Six small fixes as the audit recommends
**Question**: Pre-resolved from codebase evidence — batch-confirmed in Step 4.
**Recommended**: N065 require `"choices"`; N069 deps object; N071 warn-once both bare catches (`:389` + `:417`); N072 drop `shell: true`; N085 fold abort output; N088 drop pretty-print.
**Chosen**: confirmed (N088's optional switch decided separately in D13).
**Rationale**: `evidence: TECH_DEBT_AUDIT.md findings N065-N088 + probe 16/16 verification + confirmed` — every cited line still present at `7087c44`.

### D6 — LlmAccount home: new leaf type module
**Question**: The audit says moving LlmAccount to judge-shared.ts takes madge to 0 cycles. The probe found that's wrong: judge-shared.ts runtime-imports judge-health.ts, and judge-health type-imports LlmAccount — so the move recreates a cycle. Where should LlmAccount live?
**Recommended**: new leaf module holding only the interface (zero runtime imports).
**Chosen**: "New leaf type module" (e.g. `src/judge-account.ts`).
**Rationale**: `evidence: src/judge-shared.ts imports HARD_FAIL_TICKS_TO_CAP from judge-health.js (runtime) + confirmed` — audit's `judge-shared.ts` home recreates a 2-cycle; a pure leaf truly zeroes madge; costs one small file in the judge cluster.

### D7 — Test-double doctrine override
**Question**: The audit wants a shared typed fetch-double factory (N078) plus freshState consolidation (N079). But tests/judge-helpers.ts's header says "Doubles and mock-fetch factories stay per-suite on purpose" — a recorded decision against exactly what N078 proposes. Which wins?
**Recommended**: both — factory + freshState — and update the doctrine line.
**Chosen**: "Both: factory + freshState".
**Rationale**: full-ledger intent; 98 casts are the suite's largest debt mass; a stale header contradicting the new shape would be its own doc-drift finding.

### D8 — Wake band stays 15-45
**Question**: The operator-set wake band (15-45 min) crosses the frozen 40-minute payload freshness bound — wakes in the 40-45 tail read the leg DARK. Is the band intentional, or should the values move?
**Recommended**: keep 15-45 + warn.
**Chosen**: "Keep 15-45 + warn" — no config change; N091's warning documents the crossing.
**Rationale**: band is deliberate pacing; the heartbeat already renders the DARK leg; changing operator data needs an active call, which the developer declined.

### D9 — Delivery: one PR
**Question**: The full ledger is ~24 findings across code, tests, docs, and one repo-history operation. How should the work be split for review?
**Recommended**: two PRs (live signals first).
**Chosen**: "One PR, everything".
**Rationale**: developer's pick over the recommendation — one review surface; cluster ordering inside the PR preserves reviewability.

### D10 — N073 reword, no live probe
**Question**: scripts/login-linkedin.ts prints 'session captured' when only the cookie pair exists — no liveness check. Which fix?
**Recommended**: reword to "pair captured".
**Chosen**: "Reword to 'pair captured'".
**Rationale**: the chain's probe gate runs immediately after login and is the real liveness check; a login-time network probe adds a false-negative mode to a helper whose job is harvesting.

### D11 — N075 home: src/pipeline-helpers.ts
**Question**: Where do index.ts's pure helpers (dedupePosts, mergeSurfaceStamps, surfaceLabel) land?
**Recommended**: `src/pipeline-helpers.ts` (generic name, no shim, test import re-pointed).
**Chosen**: "src/pipeline-helpers.ts".
**Rationale**: generic name leaves room for later pure extractions; probe confirmed exact ranges (`src/index.ts:588-592, 601-608, 616-627`) and the single test importer (`tests/index.test.ts:31`).

### D12 — N080 full scope + entry guard
**Question**: probe-judge.ts has zero tests AND lacks the entry guard repo doctrine requires. How far does this fix go?
**Recommended**: full N080 + entry guard (ramp extraction to `src/`, ramp tests, guard, three side suites).
**Chosen**: "Full N080 + entry guard".
**Rationale**: `evidence: scripts/probe-judge.ts:50,340 (no guard) + probe finding + confirmed` — the guard is doctrine (`AGENTS.md` scripts pattern), and the ramp loop (`:172-200`) reads only module-locals, making extraction clean.

### D13 — N088 compact + kill switch
**Question**: The audit's fix is "drop the null,2; optionally add a LINKEDIN_CAPTURE=off switch". Include the optional switch?
**Recommended**: compact + switch.
**Chosen**: "Compact + kill switch".
**Rationale**: both clauses of the finding are the debt ("pretty-prints every body; no env kill switch"); the switch is the operator's disk-pressure escape and ~5 min.

### D14 — N076 delete the source-text describe
**Question**: tests/fetch-linkedin.test.ts:1048 pins SCROLL_JS by raw source text — the same class fixed for the platforms flags. Delete the block, or pin only the JSON contract keys?
**Recommended**: delete the describe.
**Chosen**: "Delete the describe".
**Rationale**: kills the pin class AND removes the describe's facade `SCROLL_JS` import (`tests/fetch-linkedin.test.ts:35`), so N067's re-export removal loses its last consumer in the same commit set.

### D15 — N077 gate via inertSleep (pre-resolved, single path)
**Question**: Pre-resolved from audit + full-ledger directive.
**Recommended**: gate the `elapsed < 500` bound on the condition via the `inertSleep` seam.
**Chosen**: adopted.
**Rationale**: `evidence: tests/judge-rotation.test.ts:403 + TECH_DEBT_AUDIT.md N077` — the audit names one sound fix; the bound is the suite's only realistic flake source; no A/B existed to put to the developer.

### D16 — Doc pass lands as enumerated (N066/N070/N081)
**Question**: Pre-resolved from audit + full-ledger directive.
**Recommended**: run the audit's doc pass: N066 rewrite + surface count, N070 row + clause, all seven N081 sub-items.
**Chosen**: adopted.
**Rationale**: `evidence: TECH_DEBT_AUDIT.md N066/N070/N081 + confirmed full-ledger intent` — the audit enumerates the edits; "doc drift is again the largest cluster"; no A/B existed.

## Open Questions

- Is `scrollRounds: 50` intentional for BOTH walks? (carried x3 — settle with tick-log click counts; per-surface dry exit makes the worst case self-limiting)
- `.rpiv/artifacts/` is a tracked archive with no pruning policy — intentional? (carried x6)
- Are the four possibly-orphaned GitHub secrets (`LINKEDIN_SESSION_STATE`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, `LINKEDIN_SECRET_WRITER`) still set? (carried x5)
- Is `reasoning_effort` accepted by every endpoint in the pool? (live-only; N065's shape check will surface a proxy that rejects the field)

All four are the audit's own open questions — live-only or observational, not fixable in code, explicitly left open by this pass.

## References

- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — the input spec (run #8, audited @ `7087c44`)
- `AGENTS.md`, `README.md` — doc layers edited by the pass
- `.rpiv/guidance/architecture.md` (N043 state-history policy — threshold edit), `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md` — guidance doc layers
- Probe reports (this session): 16/16 claim verification + six-seam grounding (importer lists, facade symbol maps, freshState/cast shapes, probe-judge structure)
