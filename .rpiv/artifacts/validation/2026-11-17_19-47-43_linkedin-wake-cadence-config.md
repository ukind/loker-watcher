---
template_version: 1
date: 2026-11-17T19:47:43+0700
author: Yogiswara Utama
commit: 2fb8ed4
branch: ukind/feature-update-waiting-linkedin
repository: feature-update-waiting-linkedin
topic: "Validation of Configurable LinkedIn watch-loop wake cadence"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-17_15-39-52_linkedin-wake-cadence-config.md"
tags: [validation, linkedin-behavior, watch-linkedin, config-file]
last_updated: 2026-11-17T19:47:43+0700
---

## Validation Report: Configurable LinkedIn watch-loop wake cadence

Validation run against the uncommitted working tree (validate-before-commit case). The working tree contains exactly the plan's 20-file write-set — no undeclared files, no scope findings (`--scope` not provided; quarantine-manifest glob returned 0 entries).

### Implementation Status

- ✓ Phase 1: Config keys — Fully implemented. `WatcherConfig` gains both keys, `ALLOWED_KEYS` registers them, one shared reader `readLinkedinWakeMinutes` (default 60, integer >= 1, error naming path/key/value), reader calls + return-literal entries, `watcher.config.json` ships both keys = 60 beside `"scrollRounds":50`, and the three `WatcherConfig`-typed test fixtures gain the fields.
- ✓ Phase 2: Band machine and loop wiring — Fully implemented. `LinkedInWakeBand`, `DEFAULT_WAKE_MIN_MS`/`DEFAULT_WAKE_MAX_MS` (3_600_000), parameterized `sampleTickDelayMs(minMs, maxMs, rng)`, `resolveLinkedInWakeBand` with the two-key error; `RunLoopDeps` gains `linkedinWakeMinMs`/`linkedinWakeMaxMs` with prologue defaults; the draw call and band-suffix log are updated; both suites re-pinned per spec.
- ✓ Phase 3: Guard wiring — Fully implemented. `StartLoopDeps` (the `config?: WatcherConfig` override), exported `startLoop` (load → resolve → runLoop with band injected), entry guard swapped to `startLoop().catch(...)` byte-identically; the `startLoop` suite pins band carry-through, flat 60/60, and the broken-band rejection.
- ✓ Phase 4: Doc sweep — Fully implemented. All planned prose sites rewritten: `PAYLOAD_MAX_AGE_MS` doc (bound byte-identical), `PACE_MAX_MS` doc re-pointed, capture churn note as formula over the configured cadence, payload test title, README table rows + band paragraph + two command mentions, AGENTS.md three mentions, four guidance docs including the doctrine clause and the `30min`→`40min` token fix.

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean, no errors.
- ✓ Lint: `npm run lint` — Biome checked 78 files, no findings.
- ✓ Unit tests: `npm test` — 666 tests / 157 suites, 666 pass, 0 fail (includes the new `linkedinWakeMinutes` reader suite, the parameterized sampler + resolver suites, the flat-default transcript test, and the 3-test `startLoop` suite).
- ✓ No 28/33 literal survives: `grep -rn "28 \* 60_000\|33 \* 60_000" src scripts tests` — 0 rows.
- ✓ Constants gone: `grep -rnw "WAKE_MIN_MS\|WAKE_MAX_MS" src scripts tests` — 0 rows (word-bounded; the `DEFAULT_WAKE_*` names survive as intended).
- ✓ Sampler migration complete: `grep -rn "sampleTickDelayMs(rng)" src scripts tests` — 0 rows.
- ✓ Loop-side-only gate: `grep -n "resolveLinkedInWakeBand" src/index.ts scripts/fetch-linkedin.ts scripts/probe-linkedin.ts scripts/probe-judge.ts` — 0 rows.
- ✓ Band prose gone: `grep -rn "28-33" src scripts tests README.md AGENTS.md .rpiv/guidance` — 0 rows.
- ✓ Staleness bound untouched: `grep -c "PAYLOAD_MAX_AGE_MS = 2_400_000" src/linkedin-payload.ts` — 1.
- ✓ README rows: `grep -c "linkedinWake" README.md` — 4 (meets the >= 4 requirement).
- ✓ No regressions detected — base 2fb8ed4 measured in a detached worktree: 647 tests / 647 pass / 0 fail; delta -> 666/666 (+19 new tests, all green).

### Code Review Findings

#### Matches Plan:

- `src/config-file.ts:57-60,70-75,127-142,147-152,336-360` — interface fields, `ALLOWED_KEYS` entries, reader calls, return literal, and the shared reader are the plan's code verbatim, including the doc comments.
- `watcher.config.json:160-161` — both keys = 60 beside `"scrollRounds":50`, byte-matched 3-space indent and compact colon.
- `src/linkedin-behavior.ts:31-88` — `LinkedInWakeBand`, both `DEFAULT_WAKE_*` constants, the parameterized sampler (same draw contract: floor, one `rng()` call, exclusive ceiling), and `resolveLinkedInWakeBand` match the plan byte-for-byte; the header arithmetic paragraph rewritten as specified.
- `scripts/watch-linkedin.ts:19-25,42-49,85-86,102-113,136-158,168` — the merged five-specifier behavior import, `RunLoopDeps` bounds fields, prologue defaults (`?? DEFAULT_WAKE_*`), `sampleTickDelayMs(wakeMinMs, wakeMaxMs, rng)` call, the `(band X-Y min)` log suffix after the wall-clock stamp, `StartLoopDeps`/`startLoop`, and the `startLoop().catch` guard swap all match.
- `tests/config-file.test.ts:274-340` — the 8-test reader suite plus the two happy-path assertions; `tests/linkedin-behavior.test.ts` and `tests/watch-linkedin.test.ts` match the plan's full rewrites (band-injected + flat-default transcript split, re-seeded log pins at 13:05→14:05, `startLoop` suite with `BASE_CONFIG`).
- `tests/fetch-linkedin.test.ts:57-58`, `tests/index.test.ts:55-56`, `tests/probe-linkedin.test.ts:50-51` — fixture literals gained the two required fields as planned.
- `src/linkedin-payload.ts:34-43` — the operator-frozen doc lands byte-for-byte; the `PAYLOAD_MAX_AGE_MS = 2_400_000` line untouched.
- `README.md:145-155,334-335,394`, `AGENTS.md:44-46,103-105,120`, and the four `.rpiv/guidance/` files — every planned prose edit landed, including the doctrine clause and the `PAYLOAD_MAX_AGE_MS(40min)` truthfulness fix.

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ The shared reader clones the `readScrollRounds` shape exactly (absent → default → integer guard → throw naming path/key/value); the key-as-parameter idiom mirrors `readStringArray`.
- ✓ `config?: WatcherConfig` deps override and the prologue `??` defaults follow the `FetchTickDeps.config` and `rng ?? Math.random` precedents.
- ✓ Biome import ordering matches the module's case-sensitive sort convention (verified by lint passing with organizeImports rules on).
- ✓ Tests stay offline and hermetic: seeded LCG rng, no filesystem in bare `runLoop` calls, temp-dir config files in the reader suite.
- Minor observation (acceptable variation, not a deviation): `scripts/watch-linkedin.ts:4-6` — the header rewrite slightly lengthens the first sentence past the original line shape; lint and the repo's own style tolerate it.

#### Potential Issues:

None requiring action. One evidence-scope note lives under Manual Testing below: the hosted-run and probe "stay green" manual criteria were verified at the config-load layer plus the resolver-isolation grep, not as full live runs.

### Manual Testing Required:

The user requested manual verification in this run. Performed live (evidence recorded), with two residual items:

1. Committed config content — PERFORMED ✓: `watcher.config.json:160-161` shows both keys = 60 beside `"scrollRounds":50`; the unknown-key error message was triggered live and lists `linkedinWakeMinMinutes`, `linkedinWakeMaxMinutes` in its allowed set.
2. Broken-band loop exit — PERFORMED ✓: with `linkedinWakeMinMinutes` temporarily set to 70, `npx tsx scripts/watch-linkedin.ts` printed `watch-linkedin: FAILED — config: watcher.config.json "linkedinWakeMinMinutes" (70) must not exceed "linkedinWakeMaxMinutes" (60)` and exited 1 before any tick (byte-identical to the plan's Desired End State). The config was restored byte-identical afterward (diff vs HEAD is exactly the two planned key lines).
3. Config layer stays green on a broken band — PERFORMED ✓ at the layer: `loadWatcherConfig` accepted min=70/max=60 (valid integers), and the resolver grep gate confirms `src/index.ts`, `fetch-linkedin.ts`, `probe-linkedin.ts`, and `probe-judge.ts` never call it.
4. Wake log format — VERIFIED via the passing log-pin test (`next wake in ~60 min`, `(14:05 local)`, `(band 60-60 min)`) plus the band-injected logging code path; a band-injected real run logs the configured band per the same derived `Math.round(ms / 60_000)` suffix.
5. RESIDUAL (needs the operator's machine): a full `npm start` hosted run and a full `npm run probe-linkedin` walk on the broken-band config — both need `LLM_*`/`GMAIL_*` env and LinkedIn session/browser; layer-level evidence above covers the gate that matters (config load), so these are confirmatory, not blocking.

### Recommendations:

- Ready to commit — implementation is complete and validated.
- When committing, include the four untracked workflow artifacts under `.rpiv/artifacts/` (discover, research, solutions, this plan) per the repo's tracked-artifacts convention; the commit skill will group them.
