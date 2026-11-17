---
date: 2026-11-17T15:39:52+0700
author: Yogiswara Utama
commit: 2fb8ed4
branch: ukind/feature-update-waiting-linkedin
repository: feature-update-waiting-linkedin
topic: "Configurable LinkedIn watch-loop wake cadence"
tags: [plan, linkedin-behavior, watch-linkedin, config-file]
status: ready
parent: ".rpiv/artifacts/solutions/2026-11-17_15-24-26_linkedin-wake-cadence-config.md"
phase_count: 4
phases:
  - { n: 1, title: Config keys, files: [src/config-file.ts, watcher.config.json, tests/config-file.test.ts, tests/fetch-linkedin.test.ts, tests/index.test.ts, tests/probe-linkedin.test.ts], depends_on: [] }
  - { n: 2, title: Band machine and loop wiring, files: [src/linkedin-behavior.ts, scripts/watch-linkedin.ts, tests/linkedin-behavior.test.ts, tests/watch-linkedin.test.ts], depends_on: [] }
  - { n: 3, title: Guard wiring, files: [scripts/watch-linkedin.ts, tests/watch-linkedin.test.ts], depends_on: [1, 2] }
  - { n: 4, title: Doc sweep, files: [src/linkedin-payload.ts, src/linkedin-fetch.ts, src/linkedin-capture.ts, tests/linkedin-payload.test.ts, README.md, AGENTS.md, ".rpiv/guidance/architecture.md", ".rpiv/guidance/scripts/architecture.md", ".rpiv/guidance/tests/architecture.md", ".rpiv/guidance/src/architecture.md"], depends_on: [3] }
unresolved_phase_count: 0
last_updated: 2026-11-17T15:39:52+0700
last_updated_by: Yogiswara Utama
---

# Configurable LinkedIn Watch-Loop Wake Cadence — Implementation Plan

## Overview

Two optional integer keys on `WatcherConfig` — `linkedinWakeMinMinutes` / `linkedinWakeMaxMinutes`, each independently defaulting to 60 — replace the hard-coded 28–33-minute wake band of the PC loop (`npm run watch-linkedin`). The loop loads the config once at startup through a new exported `startLoop` (the only fail-stop seam), a pure resolver converts validated minutes to ms bounds and enforces the loop-side `min > max` gate, `runLoop` receives the bounds as data deps, and `sampleTickDelayMs` takes the bounds as parameters. `PAYLOAD_MAX_AGE_MS` stays byte-for-byte unchanged; a doc sweep decouples 18 prose sites from the dead band.

## Requirements

- Two optional integer keys in `watcher.config.json`; each independently defaults to 60 when absent.
- Both absent → the loop wakes every 60 minutes flat (no jitter).
- Both present → each wake delay draws uniformly from `[minMinutes, maxMinutes)`; `min === max` → fixed interval.
- Read once at startup, before the first sleep.
- An invalid value (non-integer, non-positive) stops the run with `config: <path> "<key>" must be an integer >= 1, got <value>` — at every `loadWatcherConfig` consumer.
- `min > max` stops ONLY the PC loop, naming both keys and values; the hosted run, probes, and one-shot tick stay green.
- The wake log reports the configured band: `(band X-Y min)` after the wall-clock stamp.
- `npm run typecheck && npm run lint && npm test` green; no 28/33 literal survives in production code or its tests.

## Current State Analysis

The band is two module constants consumed by one production call site. Everything the feature needs already exists as pinned precedent.

### Key Discoveries

- `WAKE_MIN_MS = 28 * 60_000` (`src/linkedin-behavior.ts:31`), `WAKE_MAX_MS = 33 * 60_000` (`:39`); `sampleTickDelayMs(rng)` (`:46-48`) draws `Math.floor(min + rng() * (max - min))` — floor never round, exactly one `rng()` call per draw, ceiling exclusive (`RandomFn` is `[0, 1)`).
- Exactly 8 `sampleTickDelayMs` call sites: 1 production (`scripts/watch-linkedin.ts:74`), 3 in `tests/linkedin-behavior.test.ts`, 4 in `tests/watch-linkedin.test.ts` (the transcript oracle). `npm run typecheck` mechanically forces the signature migration.
- The PC loop's tick faults are warn-and-continue (`scripts/watch-linkedin.ts:63-73`) — a config read on the tick path can never stop the loop. The entry guard's `.catch` → `process.exit(1)` (`:85-90`) is the only fail-stop seam.
- Optional-key reader pattern exists ×3; the clone template is `readScrollRounds` (`src/config-file.ts:302-319`) with its test pin (`tests/config-file.test.ts:240-268`).
- `ALLOWED_KEYS` (`src/config-file.ts:60-69`) is a separate registration edit — TypeScript never cross-checks it against the interface; committing config lines without registration kills every config load.
- Read-once-at-startup precedent: `scripts/probe-judge.ts:49-50` (top-level `await loadWatcherConfig()`).
- Data-deps defaulting precedent: `rng ?? Math.random` (`scripts/watch-linkedin.ts:58`); numeric data deps precedent: `RunLoopDeps.maxIterations` (`:38`), `ProbeDeps.minClicks` (`scripts/probe-linkedin.ts:126`).
- Pure exported resolver over validated config: `resolveSurfaces` (`src/config-file.ts:341-367`). NO two-key relational error exists anywhere in the repo — this plan creates the first.
- Bare `runLoop({…})` test calls must stay filesystem-free: a config default inside `runLoop`'s prologue would read the repo's production config in five tests (`tests/watch-linkedin.test.ts:31-93`) — the config load lives in the entry-guard path (`startLoop`), never in `runLoop`.
- The degenerate 60/60 band needs zero sampler arithmetic: `max - min === 0` collapses every draw to exactly 3,600,000 ms; special-casing lives only in tests (inverted anti-collapse guards).
- The band-suffix log needs no new deps field: derive `(band X-Y min)` from the already-injected ms bounds.
- Doc coupling: the staleness bound's prose justification references the 28–33 band at 4 code-comment sites plus 14 prose sites (grep-enumerated; includes `src/linkedin-capture.ts:41-42`, which the solutions artifact missed). `PAYLOAD_MAX_AGE_MS = 2_400_000` (`src/linkedin-payload.ts:38`) is frozen by operator decision (FRD 2026-11-17): under the 60-min default, ~1 hosted run in 3 reads the payload stale → threads-only, surfaced by the email leg line. Accepted, documented, not engineered away.

## Desired End State

Operator edits one committed file and restarts the loop:

```json
"scrollRounds": 50,
"linkedinWakeMinMinutes": 55,
"linkedinWakeMaxMinutes": 65,
```

```text
$ npm run watch-linkedin
watch-linkedin: next wake in ~61 min (14:33 local) (band 55-65 min)
```

Absent keys → flat 60: `watch-linkedin: next wake in ~60 min (14:05 local) (band 60-60 min)`.

A broken band exits 1 at startup, before iteration 1:

```text
$ npm run watch-linkedin
watch-linkedin: FAILED — config: watcher.config.json "linkedinWakeMinMinutes" (70) must not exceed "linkedinWakeMaxMinutes" (60)
```

An invalid value names the key at every config consumer (hosted run, tick, probe, probe-judge, loop):

```text
watch: FAILED — config: watcher.config.json "linkedinWakeMinMinutes" must be an integer >= 1, got "sixty"
```

The hosted run's behavior for valid values changes by exactly zero: the keys are validated everywhere and consumed by the loop only.

## What We're NOT Doing

- Not touching `PACE_MIN_MS` / `PACE_MAX_MS` or the pacing gate (`src/linkedin-fetch.ts:78-86`) — the config keys scope to the wake seam only.
- Not re-deriving or moving `PAYLOAD_MAX_AGE_MS` (`src/linkedin-payload.ts:38`) — the 40-minute staleness rule stays; deriving it from the band would silently re-tighten under fast operator bands (the 2026-11-09 DARK bug shape).
- Not making the cadence hot-reloadable — apply-on-restart (FRD pinned).
- No new env vars or runtime dependencies (the `.env` route was offered and declined; zero numeric env parsing exists in the repo).
- No changes to hosted pipeline behavior for valid values — `src/index.ts` is not in the write-set.
- Not touching the walk internals (`src/linkedin-walk.ts`, `src/linkedin-walk-static.ts`) or the judge group.
- No subprocess/integration test for the entry guard — the offline `startLoop` suite covers the composition.

## Decisions

### Config keys: two optional integers, default 60
Ambiguity settled upstream (FRD pinned two keys over one band-string; env vars declined). Each key: optional, integer >= 1, absent → 60; explicit JSON `null` fails visibly (falls through the `typeof` guard, matching `readScrollRounds`). Partial bands fall out: min-only 55 → `[55, 60)`; max-only 90 → `[60, 90)`.

### One shared reader, not two clones
`readScrollRounds` is cloned ONCE as `readLinkedinWakeMinutes(value, key, filePath)` — the validation, default, and error shape are identical for both keys; only the key name differs. The key-as-param idiom is the module's own `readStringArray` (`src/config-file.ts:141`). Called twice in `validateConfig`, appended after the `scrollRounds` reader line (`:123`). Observable behavior (messages, defaults) identical to a two-clone shape; 17 lines instead of 34.

### Resolver lives in `src/linkedin-behavior.ts` (developer-confirmed, directional)
`resolveLinkedInWakeBand(minMinutes, maxMinutes, filePath)` — pure, zero-import (plain numbers + path string), returns `{ minMs, maxMs }`, throws the repo's first two-key relational error: `config: <path> "linkedinWakeMinMinutes" (70) must not exceed "linkedinWakeMaxMinutes" (60)`. Alternatives rejected: `src/config-file.ts` (the hosted run imports it — invites accidentally adopting a loop-only rule into `validateConfig`, which would exit-1 the hosted run on a broken band); `scripts/watch-linkedin.ts` (splits cadence policy into a script; the extraction idiom at `src/linkedin-behavior.ts:5-7` keeps pure machines in src). Loop-side-only is a caller property: only `startLoop` invokes it, so hosted run, probes, and tick stay green on `min > max`.

### Guard composition: exported `startLoop(deps)` (developer-confirmed, directional)
`StartLoopDeps extends RunLoopDeps` with `config?: WatcherConfig` (the `FetchTickDeps.config` precedent, `scripts/fetch-linkedin.ts:87-88`); default `loadWatcherConfig()` — fail-visible. The entry guard becomes `startLoop().catch(...)` — one tidy `watch-linkedin: FAILED — <message>` + `process.exit(1)` covers both the config load and the loop. Alternative (inline guard body) rejected: the bad-config exit path would have no offline test. `runLoop` stays bare-callable and filesystem-free.

### Sampler takes bounds as required parameters; the constants die
`sampleTickDelayMs(minMs, maxMs, rng)` — the draw contract is unchanged: `Math.floor(minMs + rng() * (maxMs - minMs))`, one `rng()` call per draw, exclusive ceiling. `WAKE_MIN_MS` / `WAKE_MAX_MS` are deleted; `npm run typecheck` forces all 8 call sites through the change, so no exit-0 path leaves a 28/33 literal standing.

### Defaults: two layers, each module owns its layer
Config layer: `DEFAULT_LINKEDIN_WAKE_MINUTES = 60` (`src/config-file.ts`, beside the reader — the `DEFAULT_SCROLL_ROUNDS` idiom). Deps layer: `DEFAULT_WAKE_MIN_MS = 3_600_000` (`src/linkedin-behavior.ts`) — bare `runLoop({…})` test calls fall back to it in the prologue (`linkedinWakeMinMs ?? DEFAULT_WAKE_MIN_MS`, the `rng ?? Math.random` idiom). The suites pin both, so drift is caught. Deliberately not shared across modules: `config-file.ts` keeps its zero-behavior-import identity.

### RunLoopDeps field names mirror the config keys with unit suffixes
`linkedinWakeMinMs` / `linkedinWakeMaxMs` — minutes at the config surface, ms inside the loop (conversion at the injection site, mirroring `readRecencyHours` keeping operator units at config). Grep lineage config-key → deps-field stays direct.

### Wake log gains the band suffix after the wall-clock stamp
`watch-linkedin: next wake in ~${Math.round(delayMs / 60_000)} min (${hh}:${mm} local) (band ${minMin}-${maxMin} min)` — derived from the injected ms bounds (`Math.round(ms / 60_000)`); no new deps field. Under the flat default, `Math.round(3_600_000 / 60_000) = 60` exactly — no rounding hazard.

### Committed config ships with the readers (the 119dc25 lesson)
`watcher.config.json` gains both keys = 60 beside `"scrollRounds":50` in Slice 1 — the same change-set, pre-empting the 13-day knob-invisibility lag of commit `119dc25`.

### Staleness decoupling is doc-truthfulness only
`PAYLOAD_MAX_AGE_MS = 2_400_000` stays byte-for-byte. The prose that justifies it BY the dead band is rewritten across the sweep (20 sites after two review-time additions): the bound is operator-frozen, decoupled from the configurable cadence, ~1-in-3 stale accepted (decision 2026-11-17).

## Phase 1: Config keys

### Overview
Two optional integer keys join `WatcherConfig` and `ALLOWED_KEYS`, read by one shared reader cloned from `readScrollRounds` (default 60, integer >= 1, fail naming path/key/value); the committed config gains both keys = 60. Validation applies at every `loadWatcherConfig` consumer; nobody consumes the values yet. Depends on nothing (foundation). Three existing `WatcherConfig`-typed test fixtures gain the two new fields — the interface fields are required, so `npm run typecheck` (TS2739, missing properties) fails on them otherwise; the `68c1e2d` scrollRounds precedent updated these same fixtures (slice-verifier finding, fixed in-slice).

### Changes Required:

#### 1. src/config-file.ts
**File**: src/config-file.ts
**Changes**: MODIFY — interface fields, ALLOWED_KEYS entries, shared reader, reader calls, return literal.

(a) In the `WatcherConfig` interface, after `scrollRounds: number;` (`src/config-file.ts:57`):

```typescript
  /** PC-loop wake band floor in minutes. Absent -> 60 (the operator target). */
  linkedinWakeMinMinutes: number;
  /** PC-loop wake band ceiling in minutes. Absent -> 60. */
  linkedinWakeMaxMinutes: number;
```

(b) In `ALLOWED_KEYS`, after `"scrollRounds",` (`src/config-file.ts:68`):

```typescript
  "linkedinWakeMinMinutes",
  "linkedinWakeMaxMinutes",
```

(c) In `validateConfig`, after the scrollRounds reader call (`src/config-file.ts:123`):

```typescript
  const linkedinWakeMinMinutes = readLinkedinWakeMinutes(
    record.linkedinWakeMinMinutes,
    "linkedinWakeMinMinutes",
    filePath,
  );
  const linkedinWakeMaxMinutes = readLinkedinWakeMinutes(
    record.linkedinWakeMaxMinutes,
    "linkedinWakeMaxMinutes",
    filePath,
  );
```

(d) In the return literal, after `scrollRounds,` (`src/config-file.ts:133`):

```typescript
    linkedinWakeMinMinutes,
    linkedinWakeMaxMinutes,
```

(e) After the `readScrollRounds` function (`src/config-file.ts:319`), the named default + shared reader:

```typescript
/** PC-loop wake band bound in minutes: both keys default to 60 (a flat hour). */
const DEFAULT_LINKEDIN_WAKE_MINUTES = 60;

/**
 * Optional wake-cadence knob, shared by both keys: absent -> the default,
 * present but not a whole number >= 1 -> fail with the path and key. One
 * reader serves both keys because the validation, default, and error shape
 * are identical; only the key name differs (the readStringArray idiom).
 * The cross-key min > max rule is NOT here: it is loop-side only, so the
 * hosted run, the probes, and the one-shot tick stay green on a broken
 * band (resolveLinkedInWakeBand, src/linkedin-behavior.ts, Phase 2).
 */
function readLinkedinWakeMinutes(value: unknown, key: string, filePath: string): number {
  if (value === undefined) {
    return DEFAULT_LINKEDIN_WAKE_MINUTES;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `config: ${filePath} "${key}" must be an integer >= 1, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}
```

#### 2. watcher.config.json
**File**: watcher.config.json
**Changes**: MODIFY — both wake keys = 60 beside `"scrollRounds":50`.

After the line `   "scrollRounds":50,` (`watcher.config.json:159`, 3-space indent, compact colon — byte-matched to the file's existing style) insert:

```json
   "linkedinWakeMinMinutes":60,
   "linkedinWakeMaxMinutes":60,
```

#### 3. tests/config-file.test.ts
**File**: tests/config-file.test.ts
**Changes**: MODIFY — reader suites for both keys + committed-config pin.

(A) After the scrollRounds describe block (`tests/config-file.test.ts:269`, the describe's closing `});`):

```typescript
describe("linkedinWakeMinutes", () => {
  it("defaults both keys to 60 when absent", async () => {
    const path = await writeConfig({ ...VALID });
    const config = await loadWatcherConfig(path);
    assert.equal(config.linkedinWakeMinMinutes, 60);
    assert.equal(config.linkedinWakeMaxMinutes, 60);
  });

  it("accepts positive integers", async () => {
    const path = await writeConfig({
      ...VALID,
      linkedinWakeMinMinutes: 55,
      linkedinWakeMaxMinutes: 65,
    });
    const config = await loadWatcherConfig(path);
    assert.equal(config.linkedinWakeMinMinutes, 55);
    assert.equal(config.linkedinWakeMaxMinutes, 65);
  });

  it("accepts a partial band — an absent key defaults to 60", async () => {
    const path = await writeConfig({ ...VALID, linkedinWakeMinMinutes: 55 });
    const config = await loadWatcherConfig(path);
    assert.equal(config.linkedinWakeMinMinutes, 55);
    assert.equal(config.linkedinWakeMaxMinutes, 60);
  });

  it("rejects a fractional min", async () => {
    const path = await writeConfig({ ...VALID, linkedinWakeMinMinutes: 2.5 });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /"linkedinWakeMinMinutes" must be an integer >= 1/,
    );
  });

  it("rejects zero", async () => {
    const path = await writeConfig({ ...VALID, linkedinWakeMaxMinutes: 0 });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /"linkedinWakeMaxMinutes" must be an integer >= 1/,
    );
  });

  it("rejects a non-numeric value with the got-clause", async () => {
    const path = await writeConfig({ ...VALID, linkedinWakeMinMinutes: "sixty" });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /"linkedinWakeMinMinutes" must be an integer >= 1, got "sixty"/,
    );
  });

  it("rejects an explicit null (absence is omission, not null)", async () => {
    const path = await writeConfig({ ...VALID, linkedinWakeMaxMinutes: null });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /"linkedinWakeMaxMinutes" must be an integer >= 1, got null/,
    );
  });

  it("rejects a negative value", async () => {
    const path = await writeConfig({ ...VALID, linkedinWakeMinMinutes: -5 });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /"linkedinWakeMinMinutes" must be an integer >= 1/,
    );
  });
});
```

(B) In the existing happy-path test "loads the committed config file", after `assert.equal(config.recencyHours, 72);` (`tests/config-file.test.ts:56`):

```typescript
    assert.equal(config.linkedinWakeMinMinutes, 60);
    assert.equal(config.linkedinWakeMaxMinutes, 60);
```

#### 4. tests/fetch-linkedin.test.ts
**File**: tests/fetch-linkedin.test.ts
**Changes**: MODIFY — fixture literal gains the two new required fields (TS2739 otherwise).

In the `const CONFIG: WatcherConfig = {` literal (`tests/fetch-linkedin.test.ts:48`), after `scrollRounds: 1,`:

```typescript
  linkedinWakeMinMinutes: 60,
  linkedinWakeMaxMinutes: 60,
```

#### 5. tests/index.test.ts
**File**: tests/index.test.ts
**Changes**: MODIFY — base fixture literal gains the two new fields; `MIXED_CONFIG` spreads it, no further change.

In the `const CONFIG: WatcherConfig = {` literal (`tests/index.test.ts:46`), after `scrollRounds: 8,`:

```typescript
  linkedinWakeMinMinutes: 60,
  linkedinWakeMaxMinutes: 60,
```

#### 6. tests/probe-linkedin.test.ts
**File**: tests/probe-linkedin.test.ts
**Changes**: MODIFY — base fixture literal gains the two new fields; `configWithSurfaces` spreads it, no further change.

In the `const CONFIG: WatcherConfig = {` literal (`tests/probe-linkedin.test.ts:41`), after `scrollRounds: 8,`:

```typescript
  linkedinWakeMinMinutes: 60,
  linkedinWakeMaxMinutes: 60,
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npx biome check src/config-file.ts tests/config-file.test.ts tests/fetch-linkedin.test.ts tests/index.test.ts tests/probe-linkedin.test.ts`
- [x] Config tests pass: `npx tsx --test tests/config-file.test.ts`

#### Manual Verification:
- [x] `watcher.config.json` shows both keys = 60 beside `"scrollRounds":50`
- [x] The unknown-key error message still lists the two new keys in its allowed set

## Phase 2: Band machine and loop wiring

### Overview
`src/linkedin-behavior.ts` gains `LinkedInWakeBand`, `resolveLinkedInWakeBand`, and `DEFAULT_WAKE_MIN_MS`; `sampleTickDelayMs` takes bounds parameters and the constants die. `scripts/watch-linkedin.ts` gains the `RunLoopDeps` bounds fields, prologue defaults, the band-suffix log, and the updated draw call. Both test suites re-pin. Depends on no shared files with Phase 1 (runs after it in sequence); shares two files with Phase 3 (the script and `tests/watch-linkedin.test.ts`).

### Changes Required:

#### 2. src/linkedin-behavior.ts
**File**: src/linkedin-behavior.ts
**Changes**: MODIFY — delete `WAKE_MIN_MS`/`WAKE_MAX_MS`; add `LinkedInWakeBand`, `DEFAULT_WAKE_MIN_MS`, `DEFAULT_WAKE_MAX_MS`, `resolveLinkedInWakeBand`; parameterize `sampleTickDelayMs`; rewrite the header arithmetic.

(a) Header doc comment — replace the worst-case arithmetic paragraph (`src/linkedin-behavior.ts:16-20`, the five lines beginning "Worst-case arithmetic (the account-safety bound): 1440 minutes per"; the `*/` terminator at `:21` stays) with:

```
 * Wake-cadence arithmetic (the account-safety bound): 1440 minutes per
 * local day; wake-ups per local day = 1440 / linkedinWakeMinMinutes (the
 * configured floor — 24 at the 60-minute default; the historic 28-minute
 * floor gave 52, the number older docs quote). Each wake walks at most
 * 5 surfaces x (1 navigation + scrollRounds Load-more clicks). The click
 * cap rides the walk (src/linkedin-fetch.ts).
```

(b) After the `RandomFn` type (`src/linkedin-behavior.ts:28`), add:

```typescript
/** One validated wake band, converted to whole milliseconds. */
export interface LinkedInWakeBand {
  /** Uniform draw lower bound, inclusive. */
  minMs: number;
  /** Uniform draw upper bound, EXCLUSIVE — a Math.random contract never returns 1. */
  maxMs: number;
}
```

(c) Replace the `WAKE_MIN_MS` constant + doc (`src/linkedin-behavior.ts:30-31`) with:

```typescript
/**
 * Default wake floor in ms: 60 minutes, the bare-runLoop fallback when
 * the deps omit the bound (the rng ?? Math.random idiom). The operator
 * value lives in watcher.config.json (linkedinWakeMinMinutes); these
 * constants only keep the offline suite's bare calls hermetic.
 */
export const DEFAULT_WAKE_MIN_MS = 3_600_000;
```

(d) Replace the `WAKE_MAX_MS` constant + doc (`src/linkedin-behavior.ts:33-39`) with:

```typescript
/**
 * Default wake ceiling in ms, EXCLUSIVE: 60 minutes, the bare-runLoop
 * fallback. Equal to the floor, so the default band is flat — every draw
 * is exactly 3,600,000 ms with no special-casing (max - min === 0
 * collapses).
 */
export const DEFAULT_WAKE_MAX_MS = 3_600_000;
```

(e) Replace `sampleTickDelayMs` + doc (`src/linkedin-behavior.ts:41-48`) with:

```typescript
/**
 * One uniform draw in [minMs, maxMs), whole milliseconds (floor, never
 * round — rounding could land ON the exclusive ceiling). rng() === 0
 * pins the floor exactly; exactly one rng() call per draw (the transcript
 * oracle depends on exact stream consumption); the ceiling is exclusive
 * because RandomFn is [0, 1); a degenerate band (minMs === maxMs)
 * collapses every draw to exactly minMs with no special-casing. The loop
 * logs the delay in minutes plus the band.
 */
export function sampleTickDelayMs(minMs: number, maxMs: number, rng: RandomFn): number {
  return Math.floor(minMs + rng() * (maxMs - minMs));
}
```

(f) After `sampleTickDelayMs`, add:

```typescript
/**
 * Loop-side pairwise gate over the two validated config keys (the readers
 * in src/config-file.ts guarantee integers >= 1 and the 60 defaults; this
 * owns ONLY the cross-key rule, so a broken band exit-1s the PC loop
 * alone — the hosted run, the probes, and the one-shot tick load the same
 * config but never call this). The two-key message extends the config
 * module's error vocabulary with both keys and their values.
 */
export function resolveLinkedInWakeBand(
  minMinutes: number,
  maxMinutes: number,
  filePath: string,
): LinkedInWakeBand {
  if (minMinutes > maxMinutes) {
    throw new Error(
      `config: ${filePath} "linkedinWakeMinMinutes" (${minMinutes}) must not exceed "linkedinWakeMaxMinutes" (${maxMinutes})`,
    );
  }
  return { minMs: minMinutes * 60_000, maxMs: maxMinutes * 60_000 };
}
```

#### 2. scripts/watch-linkedin.ts
**File**: scripts/watch-linkedin.ts
**Changes**: MODIFY — `RunLoopDeps` bounds fields, prologue defaults, `sampleTickDelayMs(minMs, maxMs, rng)` call site, band-suffix log line, header/runLoop docstring prose.

(a) Header doc comment (line 3): replace "one fetch tick, then a jittered 28-33-minute sleep, forever" with "one fetch tick, then a sleep drawn from the configured wake band (watcher.config.json linkedinWakeMinMinutes/MaxMinutes, 60 minutes flat by default), forever".

(b) `runLoop` docstring (lines 42-46): replace "a uniform 28-33-minute sleep (sampleTickDelayMs)" with "a sleep drawn from the configured wake band (sampleTickDelayMs over the injected bounds; DEFAULT_WAKE_MIN_MS/DEFAULT_WAKE_MAX_MS flat 60 when the deps omit them)" and extend the log sentence to "The wake log names the delay, the local wall-clock wake time, and the band so a quiet overnight stretch stays legible in the run log."

(c) `RunLoopDeps` — after the rng field (line 32) add:

```typescript
  /** Wake band floor in ms. Default: DEFAULT_WAKE_MIN_MS (60 min flat). */
  linkedinWakeMinMs?: number;
  /** Wake band ceiling in ms, EXCLUSIVE. Default: DEFAULT_WAKE_MAX_MS (60 min flat). */
  linkedinWakeMaxMs?: number;
```

(d) Prologue — after `const rng: RandomFn = deps.rng ?? Math.random;` (line 58) add:

```typescript
  const wakeMinMs = deps.linkedinWakeMinMs ?? DEFAULT_WAKE_MIN_MS;
  const wakeMaxMs = deps.linkedinWakeMaxMs ?? DEFAULT_WAKE_MAX_MS;
```

(e) Draw + log (lines 74-80) — replace the draw line and the log statement:

```typescript
    const delayMs = sampleTickDelayMs(wakeMinMs, wakeMaxMs, rng);
    const wakeAt = new Date(now() + delayMs);
    const hh = String(wakeAt.getHours()).padStart(2, "0");
    const mm = String(wakeAt.getMinutes()).padStart(2, "0");
    const bandMin = Math.round(wakeMinMs / 60_000);
    const bandMax = Math.round(wakeMaxMs / 60_000);
    console.log(
      `watch-linkedin: next wake in ~${Math.round(delayMs / 60_000)} min (${hh}:${mm} local) (band ${bandMin}-${bandMax} min)`,
    );
```

(f) Import (line 19): replace `import { type RandomFn, sampleTickDelayMs } from "../src/linkedin-behavior.js";` with:

```typescript
import {
  DEFAULT_WAKE_MAX_MS,
  DEFAULT_WAKE_MIN_MS,
  type RandomFn,
  sampleTickDelayMs,
} from "../src/linkedin-behavior.js";
```

#### 2. tests/linkedin-behavior.test.ts
**File**: tests/linkedin-behavior.test.ts
**Changes**: MODIFY — import block (lines 12-18), full rewrite of the `sampleTickDelayMs` describe (lines 29-56), new `resolveLinkedInWakeBand` suite.

Replace the import block (lines 12-18) with (NO `LinkedInWakeBand` import — the tests never name the type; unused imports fail Biome):

```typescript
import {
  DEFAULT_WAKE_MAX_MS,
  DEFAULT_WAKE_MIN_MS,
  HALT_CHECKPOINT_REASON,
  HALT_RATE_LIMIT_REASON,
  resolveLinkedInWakeBand,
  sampleTickDelayMs,
} from "../src/linkedin-behavior.js";
```

Replace the whole `describe("sampleTickDelayMs", ...)` block (lines 29-56, including its closing `});`) with:

```typescript
describe("sampleTickDelayMs", () => {
  it("pins the floor at exactly the injected min when rng returns 0", () => {
    assert.equal(sampleTickDelayMs(55 * 60_000, 65 * 60_000, () => 0), 55 * 60_000);
  });

  it("stays strictly under the injected ceiling as rng approaches 1", () => {
    const delay = sampleTickDelayMs(55 * 60_000, 65 * 60_000, () => 0.999999999);
    assert.ok(delay >= 55 * 60_000);
    assert.ok(delay < 65 * 60_000);
  });

  it("keeps a seeded sweep inside the injected band and never repeats one value", () => {
    const rng = seededRng(2026_11_09);
    const draws = new Set<number>();
    for (let i = 0; i < 1_000; i += 1) {
      const delay = sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng);
      assert.ok(delay >= 55 * 60_000, `too small: ${delay}`);
      assert.ok(delay < 65 * 60_000, `too big: ${delay}`);
      draws.add(delay);
    }
    assert.ok(draws.size > 1, "jitter collapsed to a single value");
  });

  it("proves ceiling exclusivity is a draw property, not a constant property", () => {
    const rng = seededRng(2026_11_09);
    const draws = new Set<number>();
    for (let i = 0; i < 1_000; i += 1) {
      const delay = sampleTickDelayMs(55 * 60_000, 60 * 60_000, rng);
      assert.ok(delay >= 55 * 60_000, `too small: ${delay}`);
      assert.ok(delay < 60 * 60_000, `too big: ${delay}`);
      draws.add(delay);
    }
    assert.ok(draws.size > 1, "jitter collapsed to a single value");
  });

  it("collapses the degenerate 60/60 default band to one constant draw", () => {
    const rng = seededRng(2026_11_09);
    for (let i = 0; i < 1_000; i += 1) {
      assert.equal(sampleTickDelayMs(DEFAULT_WAKE_MIN_MS, DEFAULT_WAKE_MAX_MS, rng), 3_600_000);
    }
  });

  it("defaults both bounds to the flat 60-minute band", () => {
    assert.equal(DEFAULT_WAKE_MIN_MS, 3_600_000);
    assert.equal(DEFAULT_WAKE_MAX_MS, 3_600_000);
  });
});

describe("resolveLinkedInWakeBand", () => {
  it("converts minutes to ms bounds", () => {
    assert.deepEqual(resolveLinkedInWakeBand(55, 65, "watcher.config.json"), {
      minMs: 3_300_000,
      maxMs: 3_900_000,
    });
  });

  it("passes a degenerate band through", () => {
    assert.deepEqual(resolveLinkedInWakeBand(60, 60, "watcher.config.json"), {
      minMs: 3_600_000,
      maxMs: 3_600_000,
    });
  });

  it("resolves a partial band against the 60 default", () => {
    assert.deepEqual(resolveLinkedInWakeBand(55, 60, "watcher.config.json"), {
      minMs: 3_300_000,
      maxMs: 3_600_000,
    });
    assert.deepEqual(resolveLinkedInWakeBand(60, 90, "watcher.config.json"), {
      minMs: 3_600_000,
      maxMs: 5_400_000,
    });
  });

  it("throws on min > max, naming both keys and their values", () => {
    assert.throws(
      () => resolveLinkedInWakeBand(70, 60, "watcher.config.json"),
      /"linkedinWakeMinMinutes" \(70\) must not exceed "linkedinWakeMaxMinutes" \(60\)/,
    );
  });
});
```

The halt-latch describes (lines 58+) stay untouched.

#### 2. tests/watch-linkedin.test.ts
**File**: tests/watch-linkedin.test.ts
**Changes**: MODIFY — import line (15), first test split into band-injected + flat-default, log pins re-seeded.

Replace the import line (line 15) with:

```typescript
import { DEFAULT_WAKE_MIN_MS, sampleTickDelayMs } from "../src/linkedin-behavior.js";
```

Replace the first test (lines 28-56) with TWO tests:

```typescript
  it("sleeps the seeded rng draws in an injected band — never the old fixed 600 s", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await runLoop({
      tick: async () => {
        calls += 1;
      },
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      rng: seededRng(2026_11_09),
      linkedinWakeMinMs: 55 * 60_000,
      linkedinWakeMaxMs: 65 * 60_000,
      maxIterations: 4,
    });
    assert.equal(calls, 4);
    assert.equal(sleeps.length, 4);
    // The transcript IS the oracle: recompute the draws with the same seed
    // over the same injected band.
    const rng2 = seededRng(2026_11_09);
    const expected = [
      sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng2),
      sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng2),
      sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng2),
      sampleTickDelayMs(55 * 60_000, 65 * 60_000, rng2),
    ];
    assert.deepEqual(sleeps, expected);
    for (const ms of sleeps) {
      assert.ok(ms >= 55 * 60_000 && ms < 65 * 60_000, `out of band: ${ms}`);
      assert.notEqual(ms, 600_000);
    }
    assert.ok(new Set(sleeps).size > 1, "band collapsed to one draw");
  });

  it("defaults to a flat 60-minute wake when no bounds are injected", async () => {
    const sleeps: number[] = [];
    await runLoop({
      tick: async () => {},
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      rng: seededRng(2026_11_09),
      maxIterations: 4,
    });
    assert.equal(sleeps.length, 4);
    for (const ms of sleeps) {
      assert.equal(ms, DEFAULT_WAKE_MIN_MS);
      assert.notEqual(ms, 600_000);
    }
  });
```

Replace the log-pin test (lines 85-97) with (clock re-seeded one hour earlier: 13:05 + 60 min = 14:05):

```typescript
  it("logs the wake delay in minutes, a local wall-clock wake time, and the band", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    await runLoop({
      tick: async () => {},
      sleepFn: async () => {},
      rng: () => 0,
      now: () => new Date(2026, 9, 26, 13, 5).getTime(),
      maxIterations: 1,
    });
    const line = log.mock.calls.map((call) => String(call.arguments[0])).join("\n");
    assert.match(line, /next wake in ~60 min/);
    assert.match(line, /\(14:05 local\)/);
    assert.match(line, /\(band 60-60 min\)/);
  });
```

The order test (58-71), cap-0 test (73-83), and both fault arms (100+) stay untouched.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npx biome check src/linkedin-behavior.ts scripts/watch-linkedin.ts tests/linkedin-behavior.test.ts tests/watch-linkedin.test.ts`
- [x] Behavior tests pass: `npx tsx --test tests/linkedin-behavior.test.ts`
- [x] Loop tests pass: `npx tsx --test tests/watch-linkedin.test.ts`
- [x] No 28/33 literal survives: `grep -rn "28 \* 60_000\|33 \* 60_000" src scripts tests` returns 0 rows
- [x] Constants gone: `grep -rnw "WAKE_MIN_MS\|WAKE_MAX_MS" src scripts tests` returns 0 rows

#### Manual Verification:
- [x] The wake log reads `next wake in ~60 min (hh:mm local) (band 60-60 min)` under the default
- [x] A band-injected run logs the configured band, not the default

## Phase 3: Guard wiring

### Overview
`scripts/watch-linkedin.ts` gains `StartLoopDeps` (`config?: WatcherConfig` override) and exported `startLoop` (config load → band resolve → `runLoop`); the entry guard calls `startLoop().catch(...)`. `tests/watch-linkedin.test.ts` gains the `startLoop` suite: bad config rejects naming both keys, valid band config drives in-band sleeps, absent keys → the flat default. Depends on Phases 1 (config fields) and 2 (resolver + deps fields).

### Changes Required:

#### 3. scripts/watch-linkedin.ts
**File**: scripts/watch-linkedin.ts
**Changes**: MODIFY — imports (`CONFIG_PATH`, `loadWatcherConfig`, `WatcherConfig`, `resolveLinkedInWakeBand`), `StartLoopDeps`, `startLoop`, entry-guard swap.

(a) Imports — two sub-edits on the post-Phase-2 state:

(i) Insert two import statements after `import { pathToFileURL } from "node:url";` (line 17), before the env-file import. Biome 1.9.4 sorts case-sensitively: `-` (U+002D) sorts before `.` (U+002E), so `config-file.js` < `config.js`; specifiers sort uppercase-first (`type WatcherConfig` before `loadWatcherConfig`). Lint-clean precedent: `scripts/fetch-linkedin.ts:35-36`, `scripts/probe-judge.ts:43-44`.

```typescript
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { CONFIG_PATH } from "../src/config.js";
```

(ii) Add one specifier to the existing linkedin-behavior import block, after `  type RandomFn,`. The final merged block (five specifiers, organizeImports natural order):

```typescript
import {
  DEFAULT_WAKE_MAX_MS,
  DEFAULT_WAKE_MIN_MS,
  type RandomFn,
  resolveLinkedInWakeBand,
  sampleTickDelayMs,
} from "../src/linkedin-behavior.js";
```

(b) After the `RunLoopDeps` interface (post-Phase-2, after the `linkedinWakeMaxMs` field), add:

```typescript
/**
 * startLoop deps: RunLoopDeps plus a config override. The offline suite
 * injects a config literal; production reads watcher.config.json once —
 * the loop's only fail-stop seam (a tick-path read would warn-and-continue
 * forever; the tick arms at scripts/watch-linkedin.ts catch and continue).
 */
export interface StartLoopDeps extends RunLoopDeps {
  /** Pre-resolved config. Default: loadWatcherConfig() — fail-visible. */
  config?: WatcherConfig;
}
```

(c) After the `runLoop` function (before the entry guard), add:

```typescript
/**
 * Startup: read the config once (the probe-judge.ts read-once idiom),
 * resolve the wake band — the loop-side min > max gate, so a broken band
 * stops ONLY this loop — and run with the bounds injected. A missing or
 * malformed config, or a broken band, throws into the guard's catch:
 * exit 1 naming the key(s). Exported for the offline suite: the guard's
 * failure path is pinned here, offline. The resolved band overrides any
 * injected bounds deps.
 */
export async function startLoop(deps: StartLoopDeps = {}): Promise<void> {
  const { config, ...loopDeps } = deps;
  const resolved = config ?? (await loadWatcherConfig());
  const band = resolveLinkedInWakeBand(
    resolved.linkedinWakeMinMinutes,
    resolved.linkedinWakeMaxMinutes,
    CONFIG_PATH,
  );
  await runLoop({
    ...loopDeps,
    linkedinWakeMinMs: band.minMs,
    linkedinWakeMaxMs: band.maxMs,
  });
}
```

(d) Entry guard — replace `runLoop().catch((error: unknown) => {` with `startLoop().catch((error: unknown) => {`. The catch body (message extraction, `watch-linkedin: FAILED — ${message}`, `process.exit(1)`) stays byte-identical.

#### 3. tests/watch-linkedin.test.ts
**File**: tests/watch-linkedin.test.ts
**Changes**: MODIFY — incremental: imports, `BASE_CONFIG` fixture, the `startLoop` suite.

(A) Imports — two sub-edits:

(i) Merge `startLoop` into the scripts import (line 14):

```typescript
import { runLoop, startLoop } from "../scripts/watch-linkedin.js";
```

(ii) Insert a new type import after the scripts import (organizeImports order: `config-file.js` sorts before `linkedin-behavior.js`):

```typescript
import type { WatcherConfig } from "../src/config-file.js";
```

Final import block:

```typescript
import { runLoop, startLoop } from "../scripts/watch-linkedin.js";
import type { WatcherConfig } from "../src/config-file.js";
import { DEFAULT_WAKE_MIN_MS, sampleTickDelayMs } from "../src/linkedin-behavior.js";
import { legDead } from "../src/linkedin-fetch.js";
```

(B) After the `seededRng` helper (before the first describe), add the fixture:

```typescript
/** Minimal valid config for the startLoop suite (the loop reads only the wake keys off it). */
const BASE_CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: [],
  negativeKeywords: [],
  surfaces: [{ type: "linkedin", value: "#hiring react" }],
  platforms: { linkedin: true, threads: true },
  recencyHours: 72,
  reasoningEffort: "low",
  scrollRounds: 1,
  linkedinWakeMinMinutes: 60,
  linkedinWakeMaxMinutes: 60,
};
```

(C) Append at the end of the file (after the fault-arms describe):

```typescript
describe("startLoop", () => {
  it("carries a band config through to in-band sleeps", async () => {
    const sleeps: number[] = [];
    await startLoop({
      config: {
        ...BASE_CONFIG,
        linkedinWakeMinMinutes: 55,
        linkedinWakeMaxMinutes: 65,
      },
      tick: async () => {},
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      rng: seededRng(2026_11_09),
      maxIterations: 4,
    });
    assert.equal(sleeps.length, 4);
    for (const ms of sleeps) {
      assert.ok(ms >= 55 * 60_000 && ms < 65 * 60_000, `out of band: ${ms}`);
    }
    assert.ok(new Set(sleeps).size > 1, "band collapsed to one draw");
  });

  it("carries a 60/60 config through to flat 60-minute sleeps", async () => {
    const sleeps: number[] = [];
    await startLoop({
      config: BASE_CONFIG,
      tick: async () => {},
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      rng: seededRng(2026_11_09),
      maxIterations: 4,
    });
    assert.equal(sleeps.length, 4);
    for (const ms of sleeps) {
      assert.equal(ms, DEFAULT_WAKE_MIN_MS);
    }
  });

  it("rejects a broken band naming both keys and values", async () => {
    await assert.rejects(
      () =>
        startLoop({
          config: {
            ...BASE_CONFIG,
            linkedinWakeMinMinutes: 70,
            linkedinWakeMaxMinutes: 60,
          },
          tick: async () => {},
          sleepFn: async () => {},
          maxIterations: 1,
        }),
      /"linkedinWakeMinMinutes" \(70\) must not exceed "linkedinWakeMaxMinutes" \(60\)/,
    );
  });
});
```

(The reader-level absent→60 default is pinned in `tests/config-file.test.ts`; the deps-level flat default is pinned by Phase 2's "defaults to a flat 60-minute wake" test — this suite pins the config→resolver→deps→sampler WIRING, a different seam.)

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npx biome check scripts/watch-linkedin.ts tests/watch-linkedin.test.ts`
- [x] Loop tests pass: `npx tsx --test tests/watch-linkedin.test.ts`
- [x] The pairwise gate is loop-side: `grep -n "resolveLinkedInWakeBand" src/index.ts scripts/fetch-linkedin.ts scripts/probe-linkedin.ts scripts/probe-judge.ts` returns 0 rows

#### Manual Verification:
- [x] `npm run watch-linkedin` with min 70 / max 60 in `watcher.config.json` exits 1 printing `watch-linkedin: FAILED — config: watcher.config.json "linkedinWakeMinMinutes" (70) must not exceed "linkedinWakeMaxMinutes" (60)` before any tick
- [x] `npm start` (hosted run) and `npm run probe-linkedin` still exit 0 on the same broken-band config

## Phase 4: Doc sweep

### Overview
Every prose site that pins the dead band or justifies the staleness bound BY it is rewritten to the configured-cadence truth; zero behavior changes. Depends on Phase 3 (documents the final behavior). Terminal phase — carries the whole-plan gates.

### Changes Required:

#### 4. src/linkedin-payload.ts
**File**: src/linkedin-payload.ts
**Changes**: MODIFY — `PAYLOAD_MAX_AGE_MS` doc comment: demote the 33-minute-worst-case justification to history; state the operator-frozen bound, decoupled from the configurable cadence. The `export const PAYLOAD_MAX_AGE_MS = 2_400_000;` line stays byte-identical.

Replace the doc comment (lines 33-37, including its `*/` terminator) with:

```typescript
/**
 * Operator-frozen (decision 2026-11-17), decoupled from the now-
 * configurable wake cadence (linkedinWakeMinMinutes/MaxMinutes): a
 * payload older than this reads as stale. Under the 60-minute default
 * the payload is fresh 40 of every 60 minutes, so roughly one hosted run
 * in three reads stale and degrades to threads-only (the email leg line
 * surfaces it). History: sized as "the 33-minute worst case plus margin"
 * back when the band was hard-coded (design 2026-11-09; was twice the
 * old 10-minute cadence).
 */
```

#### 4. src/linkedin-fetch.ts
**File**: src/linkedin-fetch.ts
**Changes**: MODIFY — `PACE_MAX_MS` doc comment: re-point "mirroring the wake-cadence bounds" (the bounds are parameters now, not a stable referent).

Replace lines 82-85 of the doc comment (including its `*/` terminator) with:

```typescript
 * Pace ceiling: EXCLUSIVE upper bound of the spacing draw (the anti-
 * restriction profile's 5-15 s band, design 2026-11-09). floor() keeps a
 * draw at most MAX - 1 ms (the floor idiom shared with sampleTickDelayMs,
 * whose wake bounds are parameters now, not constants).
 */
```

#### 4. src/linkedin-capture.ts
**File**: src/linkedin-capture.ts
**Changes**: MODIFY — the churn note: the 44-52-walks-per-day figure derived from the dead band becomes a formula over the configured cadence, with the historic band demoted (no ASCII "28-33" literal — the sweep gate stays a plain grep).

Replace lines 41-42 of the doc comment with:

```typescript
 * At the 24/7 cadence (1440 / linkedinWakeMinMinutes walks per day: 24
 * at the 60-minute default, 44-52 at the historic hard-coded band) that
 * is ~2.0 GB of write churn per day at the default; the
```

(The following line " * DISK bound is not monthly growth..." continues the sentence unchanged. The ~2.0 GB figure: 24 walks x ~85 MB, the MEASURED per-walk figure from `:36-38`.)

#### 4. tests/linkedin-payload.test.ts
**File**: tests/linkedin-payload.test.ts
**Changes**: MODIFY — test title reworded (drop the false 33-minute-worst-case claim); the assertion line stays byte-identical.

Replace the title line (line 79) with:

```typescript
  it("pins the 40-minute staleness window (operator-frozen, decoupled from the wake band)", () => {
```

#### 4. README.md
**File**: README.md
**Changes**: MODIFY — config table gains the two key rows; a band paragraph; the two 28-33 mentions re-pointed.

(A) After the `| `scrollRounds` | ...` table row (line 144), insert two rows:

```markdown
| `linkedinWakeMinMinutes` | The PC loop's wake floor in minutes (`npm run watch-linkedin`). Whole number >= 1; absent defaults to `60`. |
| `linkedinWakeMaxMinutes` | The PC loop's wake ceiling in minutes, exclusive. Whole number >= 1; absent defaults to `60`. Set both equal for a fixed cadence. |
```

(B) After the table (before the "Adding a profile or a search URL" paragraph), insert:

```markdown
The two `linkedinWake*Minutes` keys set the always-on PC loop's wake band
(`npm run watch-linkedin`): each wake delay draws uniformly from
`[linkedinWakeMinMinutes, linkedinWakeMaxMinutes)` minutes, so equal
values mean a fixed cadence and absent keys mean a flat 60-minute wake.
`min > max` stops the loop at startup naming both keys; the hosted run
and the probes stay green (the band is a PC-loop knob), and the 40-minute
payload freshness rule on the hosted side is independent of the band.
```

(C) Replace (lines 324-325):

```markdown
3. `npm run watch-linkedin`: tick, then a sleep from the configured wake
   band (60 minutes flat by default), forever; leave the console open.
```

(D) Replace (line 384):

```markdown
npm run watch-linkedin   # the always-on loop: tick + configurable wake band
```

#### 4. AGENTS.md
**File**: AGENTS.md
**Changes**: MODIFY — the three 28-33 mentions re-pointed at the configurable band.

(A) Replace (lines 44-46):

```markdown
- `npm run watch-linkedin` - the always-on PC loop: one tick, then a
  sleep from the configurable wake band (60 minutes flat by default),
  forever; leg-dead sends ONE alarm per episode and the loop keeps running
```

(B) Replace (lines 103-104):

```markdown
- `src/linkedin-behavior.ts` - the PC leg's pure policy machines: the
  wake-band resolver and sampler (band from `watcher.config.json`) and
  the halt-latch reason vocabulary
```

(C) Replace (line 119):

```markdown
- `scripts/watch-linkedin.ts` - the always-on PC loop (tick + a configurable wake band)
```

#### 4. .rpiv/guidance/architecture.md
**File**: .rpiv/guidance/architecture.md
**Changes**: MODIFY — TWO edits in this file: the watch-linkedin command row re-points at the configured band, AND the Business Context doctrine clause ("all other tuning values are hard-coded module constants") goes false once the wake cadence is operator-configurable (verifier Research warning, folded in).

(A) Replace (line 42):

```markdown
| `npm run fetch-linkedin` / `watch-linkedin` | PC leg: one LinkedIn fetch tick / the always-on loop (tick + wake band from `watcher.config.json`, 60 min default) from a dedicated clone of main |
```

(B) Replace the doctrine clause in the Business Context paragraph (line 50):

```markdown
Repo doctrine: probe-measured values are committed data, not env knobs (per-account judge ceilings in `state/judge-ceilings.json`, freshness stamped with `probedAt`); other tuning values are hard-coded module constants, except the operator-configurable cadence keys in `watcher.config.json` (`linkedinWakeMinMinutes` / `linkedinWakeMaxMinutes`).
```

#### 4. .rpiv/guidance/scripts/architecture.md
**File**: .rpiv/guidance/scripts/architecture.md
**Changes**: MODIFY — the watch-linkedin.ts structure entry re-points at the configured band.

Replace (line 37):

```markdown
watch-linkedin.ts            # .ts, always-on loop: one tick + a sleep from the configured wake band; leg-dead →
```

#### 4. .rpiv/guidance/tests/architecture.md
**File**: .rpiv/guidance/tests/architecture.md
**Changes**: MODIFY — the coverage-map entry re-points the cadence-transcript note at the new test shapes.

Replace (line 52):

```markdown
watch-linkedin.ts  → watch-linkedin.test.ts   # cadence transcript (band-injected + flat default, never the old 600 s),
```

#### 4. .rpiv/guidance/src/architecture.md
**File**: .rpiv/guidance/src/architecture.md
**Changes**: MODIFY — DISCLOSED SCOPE ADDITION: the payload-contract line says `PAYLOAD_MAX_AGE_MS(30min)`, stale at HEAD (the bound is 40 min / 2_400_000 since the 2026-11-10 amendment). Truthfulness fix, one token.

Replace (line 154) `PAYLOAD_MAX_AGE_MS(30min)` with `PAYLOAD_MAX_AGE_MS(40min)` — the line reads `// NEVER THROWS (D13): ENOENT→quiet absent; >PAYLOAD_MAX_AGE_MS(40min)→stale+age; non-ENOENT unreadable→` after the edit.

### Success Criteria:

#### Automated Verification:
- [x] Whole-plan gates: `npm run typecheck && npm run lint && npm test`
- [x] Band prose gone: `grep -rn "28-33" src scripts tests README.md AGENTS.md .rpiv/guidance` returns 0 rows
- [x] Staleness bound untouched: `grep -c "PAYLOAD_MAX_AGE_MS = 2_400_000" src/linkedin-payload.ts` returns 1
- [x] Config table rows present: `grep -c "linkedinWake" README.md` returns 4 or more

#### Manual Verification:
- [x] README config table shows both keys with defaults; the band paragraph names fixed-cadence and min>max semantics
- [x] AGENTS.md and the three guidance docs describe the configurable band, not 28-33

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §3 (config-file.test.ts) | tests/config-file.test.ts:269 | suggestion | actionability | The anchor "After the scrollRounds describe block (`tests/config-file.test.ts:268`)" is off by one: :268 is the last `it`'s closing `});` and the describe's own close is at :269, so a literal line-number insert would nest the new `describe("linkedinWakeMinutes")` inside the scrollRounds describe | Re-cite the anchor as `tests/config-file.test.ts:269` (the describe's closing `});`) | applied: anchor re-cited to :269 in Phase 1 §3(A) |
| code | Phase 2 (Overview) | <n/a> | suggestion | actionability | "two shared test files with Phase 3" miscounts the intersection: Phase 2 ∩ Phase 3 is `scripts/watch-linkedin.ts` plus exactly one shared test file (`tests/watch-linkedin.test.ts`), per both phases' frontmatter file lists | Reword to "two shared files with Phase 3 (the script and `tests/watch-linkedin.test.ts`)" | applied: Phase 2 Overview reworded |
| code | Phase 3 §3 (watch-linkedin.test.ts) | tests/watch-linkedin.test.ts:14 | suggestion | actionability | The anchor "Merge `startLoop` into the scripts import (line 12)" cites line 12, but the scripts import sits at :14 (grep-verified; :15 is the behavior import the same phase cites correctly) | Re-cite the anchor as line 14 | applied: anchor re-cited to line 14 in Phase 3 §3(A)(i) |

_Coverage reviewer: no findings — every Verification Notes entry, Pattern Reference, Requirement, and FRD acceptance criterion maps to a phase Success Criteria bullet or a code fence._

## Ordering Constraints

- Slice 1 → Slice 2 → Slice 3 → Slice 4, strictly sequential (implement runs phases in order).
- Slice 1 is the foundation: nothing consumes the fields until Slice 3, but the committed config must never land without its readers (the `119dc25` inverse — registration is in the same slice).
- Slice 2 carries the sampler signature change together with its only production call site — splitting them leaves `npm run typecheck` red at the phase boundary.
- Slice 3 depends on both: Slice 1's `WatcherConfig` fields (typed config override) and Slice 2's resolver + `RunLoopDeps` fields.
- Slice 4 documents final behavior only — no code dependencies, but the sweep must not land before the band is configurable (prose would lie in the interim).
- Nothing runs in parallel; `tests/watch-linkedin.test.ts` is touched by Slices 2 and 3 (Slice 3 emits only incremental changes).

## Verification Notes

Known risks and precedent lessons, as verifiable checks:

- [x] Whole-plan gates (Slice 4, terminal): `npm run typecheck && npm run lint && npm test` exits 0.
- [x] No 28/33 literal survives in production code or its tests: `grep -rn "28 \* 60_000\|33 \* 60_000" src scripts tests` returns 0 rows after Slice 2.
- [x] Constants gone: `grep -rnw "WAKE_MIN_MS\|WAKE_MAX_MS" src scripts tests` returns 0 rows after Slice 2 (word-bounded — the new DEFAULT_WAKE_MIN_MS/DEFAULT_WAKE_MAX_MS names contain the pattern as a substring but not as a whole word).
- [x] Sampler migration complete: `grep -rn "sampleTickDelayMs(rng)" src scripts tests` returns 0 rows after Slice 2 (typecheck also enforces).
- [x] Staleness rule untouched: `tests/linkedin-payload.test.ts` "pins the 40-minute staleness window" assertion stays `assert.equal(PAYLOAD_MAX_AGE_MS, 2_400_000)` verbatim (title reworded only).
- [x] Unknown-key pin stays green: `tests/config-file.test.ts` "rejects an unknown top-level key" passes unchanged after Slice 1.
- [x] Old-fixed regression guard intact: `assert.notEqual(ms, 600_000)` survives in the flat-default transcript test.
- [x] Band log format: log-pin regexes `/next wake in ~60 min/`, `/\(14:05 local\)/`, `/\(band 60-60 min\)/` in the flat-default log test after Slice 2.
- [x] Loop-side-only min>max: `resolveLinkedInWakeBand` unit test pins the two-key message; hosted-run files (`src/index.ts`) absent from the write-set — `git status` shows no src/index.ts change.
- [x] Doc sweep complete: `grep -rn "28-33" src scripts tests README.md AGENTS.md .rpiv/guidance` returns 0 rows after Slice 4 (excluding `.rpiv/artifacts`).
- [x] Precedent risk (config-line lag): committed keys ship in the SAME slice as the readers — verified by the Slice 1 diff containing both `src/config-file.ts` and `watcher.config.json`.
- [x] Precedent risk (docs drift, `7558747`→`7dcaeb3`): the sweep is a first-class slice (Slice 4), not an afterthought.

## Performance Considerations

None — the knob changes PC-loop sleep length only. Net additions per wake: one `Math.round` pair for the band suffix; the startup config read is one file read per loop start (already the tick's per-wake cost today). The hosted path gains two integer comparisons per config load.

## Migration Notes

No persisted schema changes. `watcher.config.json` gains two optional keys — backwards compatible in both directions (absent keys read as 60; a rolled-back build rejects the keys via `ALLOWED_KEYS`, the pre-existing unknown-key behavior). The loop applies an edit on restart (pinned). Rollback: revert the commit; the committed config's two keys must be removed in the same revert or the old build exit-1s on the unknown key — note this in the revert, not in code.

## Pattern References

- `src/config-file.ts:302-319` — `readScrollRounds` + `DEFAULT_SCROLL_ROUNDS`: the reader clone template (absent → default → integer guard → throw naming path/key/value → pass-through).
- `tests/config-file.test.ts:240-268` — the reader test plan to mirror per key (absent/ok/fraction/zero/non-number+got).
- `scripts/probe-judge.ts:49-50` — read-once-at-startup top-level load ("a missing or malformed file fails loudly").
- `scripts/watch-linkedin.ts:58` — `rng ?? Math.random`: the data-deps prologue default idiom the bounds fields clone.
- `scripts/fetch-linkedin.ts:87-88` — `config?: WatcherConfig` deps override: the `StartLoopDeps.config` precedent.
- `src/config-file.ts:341-367` — `resolveSurfaces`: the exported pure resolver shape (validated-in, plain-Error throw naming the offender and remedy).
- `src/linkedin-payload.ts:38` — the frozen staleness bound (never derived from config).
- `src/linkedin-fetch.ts:178-186` — `makePacingGate`: sibling constants the sweep must NOT touch.

## Developer Context

**Q (directional confirm): The new two-key resolver `resolveLinkedInWakeBand` — where should it live? (evidence: first two-key relational error in the repo — pattern-finder enumerated all 9 `resolve*` exports, zero relational throws; message-shape precedent `src/config-file.ts:315-317`)**
A: `src/linkedin-behavior.ts` — the wake-cadence policy module, stays zero-import, tested beside the sampler. Rejected: `config-file.ts` (hosted-run adoption risk for a loop-only rule), `watch-linkedin.ts` (policy splits into a script).

**Q (directional confirm): The entry guard config load — exported `startLoop(deps)` or inline in the guard body? (evidence: guard at `scripts/watch-linkedin.ts:85-90`; bare `runLoop({…})` test calls must stay filesystem-free — `tests/watch-linkedin.test.ts:31-93`; solutions testing strategy promises an offline bad-config exit test)**
A: Export `startLoop` with `StartLoopDeps.config?: WatcherConfig` override. Rejected: inline (the bad-config path gets no offline test — the guard runs only as process entry).

**Q (design summary confirm): "Ready to proceed to decomposition?"**
A: Proceed — approach, decisions, scope, and the 16-file surface confirmed.

**Q (decomposition confirm): 4 slices — config keys / band machine + loop wiring / guard wiring / doc sweep?**
A: Approved as decomposed.

**Note (research gap found during blueprint):** the solutions artifact's doc-sweep list missed `src/linkedin-capture.ts:41-42` (the 44–52-walks-per-day churn figure derived from the dead band). Found by repo-wide grep; added to Slice 4. Two further review-time additions folded in from slice-verifier findings: the guidance-src doctrine clause ("all other tuning values are hard-coded module constants" goes false) and its stale `PAYLOAD_MAX_AGE_MS(30min)` token. Slice 4 therefore sweeps 20 sites across 10 files.

## Plan History

- Phase 1: Config keys — revised once (slice-verifier: 3 fixture literals added to the write-set), then approved
- Phase 2: Band machine and loop wiring — revised once (grep word-boundary, unused import, over-width title, citation ranges, regex pin fragment), then approved
- Phase 3: Guard wiring — revised once (Biome organizeImports case-sensitive order, fixed per cited precedent), then approved
- Phase 4: Doc sweep — revised once (3 anchor ranges, gate wording for the retained historic reference, doctrine clause + 30min token folded in), then approved

## References

- `.rpiv/artifacts/solutions/2026-11-17_15-24-26_linkedin-wake-cadence-config.md` — the solutions analysis this plan implements (Option 1, verdict pass).
- `.rpiv/artifacts/research/2026-11-17_14-46-10_linkedin-wake-cadence-config.md` — the codebase research (file:line evidence base, blast-radius table, precedent lessons).
- `.rpiv/artifacts/discover/2026-11-17_14-11-59_linkedin-wake-cadence-config.md` — the FRD with the 9 pinned decisions and acceptance criteria.
- `src/config-file.ts:302-319` — reader clone template + test pin.
- `scripts/watch-linkedin.ts:63-90` — warn-and-continue tick arms vs the fail-stop entry guard.
- `src/linkedin-behavior.ts:28-48` — the sampler contract (floor, one rng() per draw, exclusive ceiling).
- `src/linkedin-payload.ts:33-38` — the frozen staleness bound and its doc-truthfulness site.
- Precedent commits: `68c1e2d` (scrollRounds end-to-end), `119dc25` (the 13-day config-line lag), `7558747` + `7dcaeb3` (constant change → docs drift), `22a6324` (operator-choice direction).
