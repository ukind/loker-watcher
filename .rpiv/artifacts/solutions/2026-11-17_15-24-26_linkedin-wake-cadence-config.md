---
date: 2026-11-17T15:24:26+0700
author: Yogiswara Utama
commit: 2fb8ed4
branch: ukind/feature-update-waiting-linkedin
repository: feature-update-waiting-linkedin
topic: "Configurable LinkedIn watch-loop wake cadence"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, linkedin-behavior, watch-linkedin, config-file]
last_updated: 2026-11-17T15:24:26+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Configurable LinkedIn watch-loop wake cadence

**Date**: 2026-11-17T15:24:26+0700
**Author**: Yogiswara Utama
**Commit**: 2fb8ed4
**Branch**: ukind/feature-update-waiting-linkedin
**Repository**: feature-update-waiting-linkedin

## Research Question

How does the PC loop's hard-coded jittered 28–33-minute wake band (`npm run watch-linkedin`) become two optional integer keys in `watcher.config.json` — `linkedinWakeMinMinutes` / `linkedinWakeMaxMinutes`, each independently defaulting to 60 minutes, read once at startup, invalid values fail-visible — while keeping the hermetic loop tests offline, the hosted run safe for valid values, and the 40-minute payload staleness rule untouched (operator-accepted degradation)?

## Summary

**Problem**: The wake band between PC-loop LinkedIn fetches is two module constants (`WAKE_MIN_MS` = 28 min, `WAKE_MAX_MS` = 33 min); the operator cannot tune it without a code change.

**Recommended**: Option 1 — Config keys + injected bounds. Two optional keys cloned from the `readScrollRounds` pattern, read once in the watch-linkedin entry guard, injected as `RunLoopDeps` bounds fields. It is the only candidate with zero new patterns: every piece it needs already exists in the repo, verified at file:line.

**Effort**: Low-Med (~0.5–1 day: ~75–95 production lines across 6 files, plus test re-pins and the doc sweep).

**Confidence**: High — all four candidates were scored by independent codebase agents with file:line evidence at commit `2fb8ed4`.

## Problem Statement

**Requirements:**
- Two optional integer keys in `watcher.config.json`: `linkedinWakeMinMinutes`, `linkedinWakeMaxMinutes`; each independently defaults to 60 when absent.
- Read once at loop startup; invalid values stop the loop with an error naming the key.
- The cross-key `min > max` rule is loop-side only: only the PC loop exits 1 on a broken band; hosted run, probes, and one-shot tick stay green (per-key validation still applies everywhere).
- Hermetic loop tests stay offline (no filesystem reads inside `runLoop` under test).
- Valid values change hosted behavior by exactly zero.

**Constraints:**
- Hard: `.env` never committed; no new runtime dependencies; strict TS flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) stay on.
- Hard: the 40-minute payload staleness rule (`PAYLOAD_MAX_AGE_MS = 2_400_000`, `src/linkedin-payload.ts:38`) is kept — operator-accepted ~1-in-3 stale degradation under the 60-min default (FRD decision 2026-11-17).
- Soft: the committed `watcher.config.json` should carry both keys = 60 so the knob is discoverable (pre-empts the `119dc25` 13-day-lag precedent).
- Soft: the wake log gains a band suffix `(band X-Y min)` derived from the injected bounds.

**Success criteria:**
- `watcher.config.json` absent keys → loop wakes every 60 minutes flat, logged as `~60 min ... (band 60-60 min)`.
- `min: 55, max: 65` → jittered draws in `[55, 65)` minutes.
- `"sixty"`, `-5`, `0`, `2.5`, `null` in either key → exit 1 naming the key, at loop startup, before iteration 1.
- `min > max` → PC loop exit 1 naming both keys and values; hosted run and probes unaffected.
- `npm run typecheck && npm run lint && npm test` green; no 28/33 literal survives in production code or its tests.

## Current State

**Existing implementation:**
- The band is two constants: `WAKE_MIN_MS = 28 * 60_000` (`src/linkedin-behavior.ts:31`), `WAKE_MAX_MS = 33 * 60_000` (`:39`), consumed by `sampleTickDelayMs(rng)` (`:46-48`): `Math.floor(min + rng() * (max - min))`, floor never round, `rng()` first argument, exactly one `rng()` call per draw, ceiling exclusive (`RandomFn` is `[0, 1)`, `:28`).
- The PC loop calls it once per wake at `scripts/watch-linkedin.ts:74`; the same `delayMs` feeds the wake log (`:75-80`) and the sleep (`:81`).
- The loop's tick faults are warn-and-continue (`scripts/watch-linkedin.ts:63-73`), so a config read on the tick path can never stop the loop — the only fail-stop seam is the entry guard's `.catch` → `process.exit(1)` (`:85-90`).
- The optional-key reader pattern exists three times: `readReasoningEffort` (`src/config-file.ts:283-284`), `readScrollRounds` (`:309-318`, default `DEFAULT_SCROLL_ROUNDS = 8` at `:302`), `readNegativeKeywords` (`:327-328`).

**Relevant patterns:**
- Optional-key reader with named default + integer guard + fail-visible throw: `src/config-file.ts:302-319` — the clone template, 4 consumers of `loadWatcherConfig` already inherit it.
- Read-once-at-startup top-level load: `scripts/probe-judge.ts:48-50` — same script family as watch-linkedin.
- Committed-operator-value precedent: `watcher.config.json:159` (`"scrollRounds":50`).
- Function-deps precedent in `RunLoopDeps` (`scripts/watch-linkedin.ts:24-39`): `rng ?? Math.random` (`:58`) — data fields default the same way.

**Integration points:**
- `src/config-file.ts:60-69` — `ALLOWED_KEYS` registration (unknown-key gate `:108-114` runs before readers).
- `src/config-file.ts:116-123` reader block and `:125-134` typed return literal — the wake readers append after `:123`.
- `scripts/watch-linkedin.ts:85-90` — the entry-guard config load.
- `scripts/watch-linkedin.ts:74` — the draw site; `:78-80` the log line.
- 8 `sampleTickDelayMs` call sites total (1 production, 7 in tests) — a signature change is enforced mechanically by `npm run typecheck`.
- Untouched by design: `PACE_MIN_MS`/`PACE_MAX_MS` (`src/linkedin-fetch.ts:78-86`, pacing draw inlined at `:189`), `PAYLOAD_MAX_AGE_MS` (`src/linkedin-payload.ts:38`).

## Solution Options

### Option 1: Config keys + injected bounds (FRD shape)
**How it works:**
`WatcherConfig` gains `linkedinWakeMinMinutes`/`linkedinWakeMaxMinutes` beside `scrollRounds`; two `readScrollRounds`-clone readers (named default `60`, integer ≥ 1, absent → default). The entry guard awaits `loadWatcherConfig()` once; a loop-side resolver applies the `min ≤ max` pairwise rule and converts minutes → ms; resolved bounds ride new optional `RunLoopDeps` fields (undefined → 60/60 default in the prologue, exactly like `rng ?? Math.random`). `sampleTickDelayMs(minMs, maxMs, rng)` takes bounds as required parameters; `WAKE_MIN_MS`/`WAKE_MAX_MS` are deleted.

**Pros:**
- Strongest precedent in the repo: optional-key readers exist ×3 (`src/config-file.ts:283`, `:309`, `:327`); the clone template is 17 lines and fully pinned by tests (`tests/config-file.test.ts:240-268`).
- The fail-stop seam already exists (`scripts/watch-linkedin.ts:85-90`) and the read-once precedent is in the same script family (`scripts/probe-judge.ts:49-50`).
- Hermeticity holds structurally: `runLoop` keeps receiving bounds as plain data; bare `runLoop({…})` test calls stay filesystem-free; the module import stays side-effect free (the entry-guard pin at `tests/watch-linkedin.test.ts:8-10`).
- The operator knob lands on the committed config surface, discoverable in the operator's own file.
- `npm run typecheck` mechanically forces all 8 call sites through the sampler signature change — no exit-0 path leaves a 28/33 literal standing.

**Cons:**
- The 60-min default trips the 40-min staleness rule (~1 in 3 hosted runs read the payload stale → threads-only, surfaced by the email leg line). Already operator-accepted (FRD 2026-11-17) — a documented trade-off, not a blocker; the doc sweep must record the decoupling in four comment sites (`src/linkedin-payload.ts:33-37`, `src/linkedin-behavior.ts:36-37` + `:16-17`, `src/linkedin-fetch.ts:84`).
- Test churn is real but bounded: behavior-test pins invert under the degenerate 60/60 default (ceiling probe `tests/linkedin-behavior.test.ts:39-42`, anti-collapse sweep `:54`), log pins re-seed (`tests/watch-linkedin.test.ts:95-96`).

**Complexity:** Low-Med (~0.5–1 day)
- Files to create: 0
- Files to modify: 6 production (~75–95 lines) + 3 test files + 5–7 doc sites
- Risk level: Low (every mechanic verified at file:line; typecheck enforces the migration)

### Option 2: Env-var band
**How it works:**
`LINKEDIN_WAKE_MIN_MINUTES`/`LINKEDIN_WAKE_MAX_MINUTES` in `.env`, read via the existing `env-file.ts` loader at the prologue's `envWithDotEnv()` merge; hand-rolled string→int parse/validate helpers throw through the existing entry-guard `.catch`; bounds inject into `RunLoopDeps` as in Option 1.

**Pros:**
- Loader wiring is nearly free (`envWithDotEnv` already imported at `scripts/watch-linkedin.ts:18`); the fail-stop seam already exists.
- Hermeticity holds the same way (tests inject bounds; `envWithDotEnv()` ENOENT degrades quietly, pinned at `tests/env-file.test.ts:69-73`).
- `fetchTick` needs no threading — the band is loop-only, and the agent confirmed the tick never touches `sampleTickDelayMs`.

**Cons:**
- Doctrine contradiction (blocker): the repo's only env precedent is a credential path (`LINKEDIN_COOKIES_FILE`, `src/linkedin-session.ts:96-113`); zero numeric env parsing exists anywhere (`grep`-verified: no `parseInt` in `src/` or `scripts/`); README documents env knobs being *removed* (`README.md:331-332`); AGENTS.md locates tuning in committed constants and operator config in `watcher.config.json`.
- Net-added code: two parse/validate helpers written from scratch against a string protocol the JSON reader never needed; saves nothing structurally over a 17-line reader clone.
- The knob becomes invisible to the committed operator surface (`.env` is gitignored; no `.env.example` exists).

**Complexity:** Med (~0.5–1 day, more hand-rolled validation)
- Files to create: 0 (2 helper functions inside existing files)
- Files to modify: similar set to Option 1 plus README env docs
- Risk level: Med (doctrine drift; knob invisible in version control)

### Option 3: Band-string key
**How it works:**
One key `linkedinWakeMinutes` accepting an integer (`60` = flat) or a `"55-65"` range string; a union reader parses both shapes into `[min, max]` minutes; bounds inject as in Option 1.

**Pros:**
- One key instead of two; marginally less reader-test code (~6–8 cases vs 10).
- The union never escapes the reader if it resolves to a tuple — the four validation-inheriting loads see an unconsumed field, as they do today.
- Range-parse errors fit the existing `config: <path> "<key>" …` single-key error vocabulary (`src/config-file.ts:111`, `:315-317`).

**Cons:**
- No precedent (weak but real): every reader returns one typed scalar; the only unions are a string-literal set (`readReasoningEffort`, `:283-303`) and a discriminated object array (`Surface`, `:15-20`) — a `number | string` grammar is invented from scratch, and `noUncheckedIndexedAccess` makes every `split("-")` element a narrowing chore.
- Blast-radius contradiction (blocker against the pinned decision): range validation "in or beside the reader" runs in all four `loadWatcherConfig` consumers — a `"65-55"` typo exit-1s the hosted run and probes, breaking the developer decision that min > max exits ONLY the PC loop. Mitigating it means splitting shape-validation (reader) from range-validation (loop) — strictly more machinery than Option 1 for one fewer key.
- Diverges from the recorded developer decision (two keys, discover checkpoint) — a deliberate deviation with a process cost.

**Complexity:** Med (~0.5–1 day)
- Files to create: 0
- Files to modify: same set as Option 1; reader is 25–40 lines vs 2×17-line clones
- Risk level: Med (new reader grammar; widened invalid-value blast radius unless mitigated)

### Option 4: Sampler factory
**How it works:**
Same config keys and entry-guard read as Option 1, but `src/linkedin-behavior.ts` exports `makeTickDelaySampler(minMs, maxMs, rng)` returning a `() => ms` closure; `RunLoopDeps` carries an optional `tickDelaySampler` function (default: factory over 60/60) instead of raw bounds.

**Pros:**
- Strong precedent: the `makeX → closure` idiom exists ×4 (`makePacingGate` `src/linkedin-fetch.ts:178-186`, `makeLinkedInContextFactory` `src/linkedin-context.ts:141`, `makeFsCaptureSink` `src/linkedin-capture.ts:158`, `makeSpanCounter` `src/linkedin-parser.ts:342`), and every behavioral `RunLoopDeps` field is already a function.
- The rng stream is preserved (one `rng()` call per draw either way); the transcript oracle recomputes byte-identically.

**Cons:**
- Contradicted by the band-suffix decision (blocker): the wake log must show `(band X-Y min)`, derived from the bounds — the loop needs the bounds as data ANYWAY, so the factory seam duplicates the injection instead of replacing it (or the factory must return `{sample, minMs, maxMs}`, which is just Option 1 plus a wrapper).
- Double-seaming: `rng` (`RunLoopDeps` `:32`, default `:58`) is already the draw seam with exactly one consumer — the wake draw. Tests already inject arbitrary draws through it (`() => 0` at `tests/watch-linkedin.test.ts:67`, `:90`; seeded LCG `:38`). The factory adds zero injectability the `rng` dep lacks.
- Strictly more code: ~1 export + closure + type change vs two numeric fields, same config-reader work, same pin churn.

**Complexity:** Med (~0.5–1 day)
- Files to create: 0
- Files to modify: same set as Option 1 plus the factory export/type change
- Risk level: Low-Med (mechanically safe; net complexity up)

## Comparison

| Criteria | 1: Config keys + bounds | 2: Env-var band | 3: Band-string key | 4: Sampler factory |
|----------|----------|----------|----------|----------|
| Complexity | L-M | M | M | M |
| Codebase fit | H (readers ×3, seams verified) | L (doctrine fight, no numeric env precedent) | L-M (no union-reader precedent) | M (factory idiom fits, but duplicative) |
| Risk | L | M | M | L-M |
| Decision-record fit | Matches FRD exactly | Diverges (surface change) | Diverges (pinned two-key decision) | Compatible, but works against the band-suffix decision |
| Net code | ~75–95 lines, mostly clones | More (hand-rolled parse) | Wash-to-more (new grammar) | More (wrapper over existing seam) |

## Recommendation

**Selected:** Option 1 — Config keys + injected bounds.

**Rationale:**
- Only candidate with zero new patterns: every mechanic (optional-key reader, unknown-key gate, top-level read-once, data-deps defaulting) is verified existing code with pinned tests (`src/config-file.ts:302-319`, `scripts/probe-judge.ts:49-50`, `scripts/watch-linkedin.ts:58`).
- Typecheck mechanically enforces the sampler signature change across all 8 call sites — the migration cannot silently miss a site.
- The knob lands on the committed operator surface next to `scrollRounds`, matching the established direction of moving pacing decisions to operator choices (`22a6324`).
- Hermeticity is structural: bounds are data; bare `runLoop({…})` test calls never touch the filesystem; the module import stays side-effect free.

**Why not alternatives:**
- Option 2 (env-var): blocking doctrine contradiction — env carries a path/credential precedent only; zero numeric env parsing exists; README documents env knobs being removed. Net-added code over the reader clone.
- Option 3 (band-string): the range check in the reader widens the invalid-value blast radius to all four config consumers, breaking the pinned loop-side-only decision; splitting the validation to fix that costs more machinery than Option 1; diverges from the recorded two-key decision; the union grammar has no precedent.
- Option 4 (sampler factory): the required band-suffix log forces the bounds to remain injected data, so the factory duplicates rather than replaces the seam; adds no injectability the existing `rng` dep lacks; strictly more code.

**Trade-offs:**
- Accepting ~1-in-3 hosted runs reading the payload stale under the 60-min default (threads-only degradation, surfaced by the email leg line) in exchange for operator-tunable cadence and an untouched `PAYLOAD_MAX_AGE_MS`. Recorded, not derived: the staleness bound freezes as operator-independent documentation (four comment-site edits).
- Accepting test churn (behavior pins invert under the degenerate band) in exchange for the degenerate band needing zero sampler special-casing (`max - min === 0` collapses cleanly).

**Implementation approach:**
1. Config layer — `WatcherConfig` fields, `ALLOWED_KEYS` entries, two `readScrollRounds`-clone readers (default 60), typed return literal (`src/config-file.ts:48-58, 60-69, 116-123, 125-134, 302-319` template).
2. Sampler parameterization — `sampleTickDelayMs(minMs, maxMs, rng)`; delete `WAKE_MIN_MS`/`WAKE_MAX_MS`; rewrite the stale comments (`src/linkedin-behavior.ts:16-17, 36-37, 46-48`).
3. Loop wiring — loop-side `resolveLinkedinWakeBand` (min ≤ max, error naming both keys and values), minutes→ms conversion at the injection site, `RunLoopDeps` bounds fields, prologue defaults, entry-guard `loadWatcherConfig()` (`scripts/watch-linkedin.ts:24-40, 49-59, 85-90`).
4. Committed config — both keys = 60 in `watcher.config.json` beside `"scrollRounds":50` (`:159`).
5. Tests — mirror `tests/config-file.test.ts:240-268` ×2; extract the bounds-parameterized sweep with `[55, 65)` / `[55, 60)` / degenerate `[60, 60)` instantiations; re-point oracle/band/log pins with a band-injected oracle variant.
6. Doc sweep — the four comment sites plus `scripts/watch-linkedin.ts:3,42-43`, `README.md:144` (+ band prose), guidance docs pinning "28-33 min" (`.rpiv/guidance/architecture.md`, `.rpiv/guidance/scripts/architecture.md`, `.rpiv/guidance/tests/architecture.md`).

**Integration points:**
- `src/config-file.ts:57` — the two new interface fields beside `scrollRounds`.
- `src/config-file.ts:123` — the reader calls appended after the scrollRounds line.
- `scripts/watch-linkedin.ts:85-90` — the one fail-stop seam; the guard loads config, resolves the band, injects bounds.
- `scripts/watch-linkedin.ts:74-80` — draw + log with the `(band X-Y min)` suffix after `(hh:mm local)` (substring pins survive).
- `src/linkedin-payload.ts:33-37` — staleness comment demoted to history; `PAYLOAD_MAX_AGE_MS` (`:38`) byte-for-byte unchanged.

**Patterns to follow:**
- Optional-key reader: `src/config-file.ts:309-318` (absent → named default → integer guard → throw naming path/key/value).
- Read-once-at-startup: `scripts/probe-judge.ts:48-50`.
- Data-deps defaulting: `scripts/watch-linkedin.ts:58` (`rng ?? Math.random`).
- Ship code + committed config lines + doc sweep as one change-set (the `119dc25` and `7558747`→`7dcaeb3` lessons).

**Risks:**
- Staleness degradation surprises an operator later: mitigation — the doc sweep states the decoupling explicitly, and the heartbeat/email leg line already renders `stale` visibly (`src/linkedin-payload.ts:188-196` → `src/email.ts:139-142`).
- Degenerate-band test inversions break the suite subtly: mitigation — the bounds-parameterized sweep makes the three band shapes explicit, and `npm run typecheck` flags every stale sampler import.
- Pairwise-rule error vocabulary is new: mitigation — the message shape `config: <path> "linkedinWakeMinMinutes" (70) must not exceed "linkedinWakeMaxMinutes" (60)` mirrors the existing `:315` reader message form.

## Scope Boundaries
- Building: the two config keys (validate everywhere, consume in the loop), the loop-side band resolver, the parameterized sampler, the band-suffix log line, the committed config values, the test re-pins, the doc sweep.
- NOT doing: touching `PACE_MIN_MS`/`PACE_MAX_MS` or the pacing gate (`src/linkedin-fetch.ts:78-86`); re-deriving or moving `PAYLOAD_MAX_AGE_MS`; hot-reloading config mid-loop (apply-on-restart per FRD); any new env vars or dependencies; changes to the hosted pipeline's behavior for valid values.

## Testing Strategy

**Unit tests:**
- Reader mirrors ×2 keys: absent → 60; ok; fraction rejected; zero rejected; non-number rejected with got-clause (`tests/config-file.test.ts:240-268` shape).
- Unknown-key pin stays green (`:83`).
- Band resolver: min > max throws naming both keys and values; min == max passes; partial bands resolve (`[55, 60)`, `[60, 90)`).
- Sampler: floor pin at `rng() === 0`; ceiling probe under a non-degenerate injected band (e.g. `[55, 60)`); sweep ×3 bands including the degenerate equality variant; transcript oracle re-seeded for the flat-60 default plus a band-injected discriminative variant; band assert degenerate-safe; `notEqual(ms, 600_000)` old-fixed regression guard untouched.
- Loop: log pins `~60 min`, re-seeded wall-clock, `(band 60-60 min)` suffix; order/cap-0/fault arms bounds-agnostic and untouched; entry-guard failure test (bad config → exit-1 message naming the key).

**Integration tests:**
- None new — the subprocess/hook tests are out of scope; hosted behavior for valid values is covered by reader tests only (the hosted run never consumes the values).

**Manual verification:**
- [ ] `npm run watch-linkedin` with committed config → first log line reads `~60 min … (band 60-60 min)`.
- [ ] Set `linkedinWakeMinMinutes: 55, linkedinWakeMaxMinutes: 65` → wake log shows the band and draws inside it across several wakes.
- [ ] Set `linkedinWakeMinMinutes: 70` (max 60) → loop exits 1 with the pairwise message; hosted `npm start` and `npm run probe-linkedin` still exit 0.
- [ ] Set `"sixty"` → every `loadWatcherConfig` consumer exits 1 naming the key (loop, tick, probe, hosted run).

## Open Questions
**Resolved during research:**
- Where can a config read stop the loop? — Only the entry guard (`scripts/watch-linkedin.ts:85-90`); the tick path warns-and-continues (`:63-73`), verified by agent evidence.
- Does the degenerate 60/60 band need sampler arithmetic? — No: `max - min === 0` collapses every draw to exactly 3,600,000 ms; special-casing lives only in tests (inverted anti-collapse guards).
- Does the band suffix need a new deps field? — No: derive from the already-injected ms bounds.
- Does the env-var reader exist to reuse? — No: zero numeric env parsing exists in `src/` or `scripts/` (grep-verified by the env-var agent).

**Requires user input:**
- None — the FRD and developer checkpoint settled surface (config file), defaults (60/60), band log suffix, min>max scope (loop-side), and committed config values (both keys = 60).

**Blockers:**
- None. The staleness degradation under the 60-min default is an accepted, recorded trade-off (FRD decision, kept `PAYLOAD_MAX_AGE_MS`).

## References

- `.rpiv/artifacts/research/2026-11-17_14-46-10_linkedin-wake-cadence-config.md` — the full codebase research this analysis chains from (file:line evidence base).
- `.rpiv/artifacts/discover/2026-11-17_14-11-59_linkedin-wake-cadence-config.md` — the FRD with the 9 pinned decisions.
- `src/config-file.ts:302-319` — the reader clone template and its test pin (`tests/config-file.test.ts:240-268`).
- `scripts/watch-linkedin.ts:63-90` — the warn-and-continue tick arms vs the fail-stop entry guard.
- `src/linkedin-behavior.ts:28-48` — the sampler contract (floor, one rng() per draw, exclusive ceiling).
- `src/linkedin-payload.ts:33-38` — the frozen staleness bound and the doc-truthfulness site.
- `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md` — the staleness-coupling warning this feature settles the second time.
- Precedent commits: `68c1e2d` (scrollRounds end-to-end), `119dc25` (the 13-day config-line lag), `7558747` + `7dcaeb3` (constant change → docs drift), `22a6324` (operator-choice direction).
