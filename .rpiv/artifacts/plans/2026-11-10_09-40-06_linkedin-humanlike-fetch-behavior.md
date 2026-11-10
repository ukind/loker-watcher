---
date: 2026-11-10T09:40:06+0700
author: Yogiswara Utama
commit: 32a0bcd
branch: ukind/feature-anti-restrict
repository: feature-anti-restrict
topic: "linkedin-humanlike-fetch-behavior"
tags: [plan, linkedin-fetch, watch-linkedin, pacing, anti-detection, halt-latch, daily-budget, provenance]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-09_19-24-42_linkedin-humanlike-fetch-behavior.md"
phase_count: 6
phases:
  - { n: 1, title: "behavior module", files: [src/linkedin-behavior.ts, tests/linkedin-behavior.test.ts], depends_on: [] }
  - { n: 2, title: "loop refactor", files: [scripts/watch-linkedin.ts, tests/watch-linkedin.test.ts], depends_on: [1] }
  - { n: 3, title: "walk mechanics", files: [src/linkedin-fetch.ts, src/linkedin-payload.ts, tests/linkedin-fetch.test.ts, tests/linkedin-payload.test.ts], depends_on: [1] }
  - { n: 4, title: "fetchTick wiring", files: [scripts/fetch-linkedin.ts, src/email.ts, .gitignore, tests/fetch-linkedin.test.ts, tests/email.test.ts], depends_on: [2, 3] }
  - { n: 5, title: "provenance + reset", files: [src/linkedin-session.ts, scripts/login-linkedin.ts, scripts/reset-linkedin.ts, scripts/fetch-linkedin.ts, package.json, tests/linkedin-session.test.ts, tests/login-linkedin.test.ts, tests/reset-linkedin.test.ts, tests/fetch-linkedin.test.ts, tests/linkedin-fetch.test.ts], depends_on: [4] }
  - { n: 6, title: "config", files: [src/config-file.ts, watcher.config.json, tests/config-file.test.ts], depends_on: [4] }
last_updated: 2026-11-10T15:38:14+0700
last_updated_by: Yogiswara Utama
last_updated_note: "revise: curl exec failure messages sanitized (exit code + stderr excerpt only — never the command line with cookie headers) after a live probe leaked the jar to the console; Phase 3 gains an unchecked credential-leak pin (45+13 -> 46+13)"
---

# LinkedIn humanlike fetch behavior Implementation Plan

## Overview

Implements the LinkedIn humanlike fetch behavior from the design artifact: four pure policy machines (working window, jittered cadence, daily GET budget, halt reasons), a jittered always-on PC loop, account-safe walk mechanics (randomized pacing, one page per surface, shuffled dispatch, unparsable-200 abort), a fetchTick preflight band with a daily GET budget and an operator-cleared halt latch, FR-0 harvest provenance with a session reset command, and the exactly-five-surface config contract. Phase boundaries inherit 1:1 from the design's `## Slices` (slice-verified at design Step 6.2); Success Criteria pass through unchanged.

## Desired End State

## Desired End State

```typescript
// The loop, after the refactor — cadence and window ride the module:
await runLoop({ sleepFn, now, rng });

// One tick, after the wiring — the preflight band runs before any GET:
const result = await fetchTick({ env, latchPath, budgetPath, rng });
// outside the window  -> { wrote: false, pushed: false, postCount: 0 }, zero GETs
// latch present        -> { wrote: false, pushed: false, postCount: 0 }, zero GETs
// budget spent         -> { wrote: false, pushed: false, postCount: 0 }, zero GETs
// healthy              -> { wrote: true, pushed: true, postCount: <= 250 }
```

## What We're NOT Doing

- Warm-up GET (no verified non-search route exists).
- Adaptive autothrottling, proxy rotation, fingerprint work (owned by curl-impersonate).
- Hosted-watcher changes (`src/index.ts`, `watch.yml`).
- Cross-tick pagination bookmarks (each tick starts at page 0).
- Cookie age limits (presence-only stamp, developer decision).

## Phase 1: behavior module

### Overview
The vocabulary module: four pure, IO-free machines — working window, jittered cadence, daily GET budget, halt reasons — plus their offline suite. Every later phase speaks this language; the module imports nothing.

**Files** (design Slice 1): `src/linkedin-behavior.ts`, `tests/linkedin-behavior.test.ts`
**Depends on**: none (first phase)

### Changes Required:

#### 1. src/linkedin-behavior.ts
**File**: `src/linkedin-behavior.ts`
**Changes**: NEW — four IO-free policy machines + constants: isWithinWorkingHours (Mon-Fri 08:00-21:00 local), sampleTickDelayMs (uniform 28-33 min), the daily GET budget machine (budgetAllows/budgetReserve/freshBudget/localDateKey, limit 150), and the halt-reason vocabulary. Zero imports; rng and dates arrive as arguments.

```typescript
/**
 * Behavioral policy machines for the PC-local LinkedIn leg (the
 * anti-restriction profile, design 2026-11-09): the working-hours window,
 * the jittered wake cadence, the daily GET budget, and the halt-latch
 * reason vocabulary.
 *
 * Extraction idiom (src/judge-rotation.ts:5-7): pure machines + constants
 * live here; IO and policy placement stay at the consumer
 * (scripts/fetch-linkedin.ts wires the preflight band and the budget
 * wrapper, scripts/watch-linkedin.ts wires the loop cadence). The module
 * is IO-free: dates, rng draws, and persisted state arrive as arguments,
 * so the offline suite pins every edge with zero doubles.
 *
 * Worst-case arithmetic (the account-safety invariant): the window is 13
 * hours = 780 minutes; at the 28-minute floor that is at most 28 wake-ups
 * x 5 surfaces x 1 page = 140 voyager GETs per local day — under the 150
 * daily budget (FR-9). Both bounds live here so the invariant reads in
 * one place.
 */

/**
 * Local hour the working window opens at (inclusive): Mon-Fri 08:00-21:00
 * local (FR-1). Unmeasured values stay constants.
 */
export const WINDOW_START_HOUR = 8;

/**
 * Local hour the working window closes at — EXCLUSIVE, so 21:00:00.000 is
 * already outside. The half-open [start, end) pair makes the 20:59/21:00
 * boundary unambiguous.
 */
export const WINDOW_END_HOUR = 21;

/**
 * True when `at` falls inside the working window: Monday-Friday, local
 * 08:00 <= time-of-day < 21:00. Every read is LOCAL — never UTC — so the
 * window tracks the operator's clock. The weekday guard uses getDay()
 * (0 = Sunday, 6 = Saturday); 1-5 is the Mon-Fri band. Boundary pins:
 * 07:59:59.999 false, 08:00:00.000 true, 20:59:59.999 true, 21:00:00.000
 * false.
 */
export function isWithinWorkingHours(at: Date): boolean {
  const day = at.getDay();
  if (day < 1 || day > 5) return false;
  const hour = at.getHours();
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/**
 * The jitter draw seam: a Math.random-shaped function over [0, 1). The
 * codebase's first rng seam — injected everywhere so the offline suite
 * pins bounds and permutations without ambient randomness.
 */
export type RandomFn = () => number;

/** Wake floor: 28 minutes. Uniform draw lower bound, inclusive. */
export const WAKE_MIN_MS = 28 * 60_000;

/**
 * Wake ceiling: 33 minutes. Exclusive — a Math.random contract never
 * returns 1, so floor() keeps every draw at most MAX - 1 ms and a tick can
 * never sit exactly at the ceiling. The payload staleness amendment
 * (PAYLOAD_MAX_AGE_MS 30 -> 40 min) clears this worst case with margin.
 */
export const WAKE_MAX_MS = 33 * 60_000;

/**
 * One uniform draw in [WAKE_MIN_MS, WAKE_MAX_MS), whole milliseconds
 * (floor, never round — rounding could land ON the exclusive ceiling).
 * rng() === 0 pins the floor exactly; the loop logs the delay in minutes.
 */
export function sampleTickDelayMs(rng: RandomFn): number {
  return Math.floor(WAKE_MIN_MS + rng() * (WAKE_MAX_MS - WAKE_MIN_MS));
}

/**
 * The hard daily GET budget (FR-9), in code: 150 voyager GETs per LOCAL
 * day across all surfaces. Worst-case walk arithmetic (28 wake-ups x 5
 * surfaces) stays under it; the budget exists so a mis-configured future
 * cannot silently multiply the volume.
 */
export const DAILY_GET_BUDGET = 150;

/**
 * The budget machine's persisted shape — the whole content of
 * state/linkedin-get-budget.json (untracked, PC-local, same discipline as
 * the leg-dead marker: repo-local, persistent, never committed).
 */
export interface DailyBudgetState {
  /** LOCAL "YYYY-MM-DD" the count belongs to; a different key is a new day. */
  readonly localDate: string;
  /** GETs reserved so far on that local date. */
  readonly count: number;
}

/** The absent-file state: nothing reserved, no day attached. */
export function freshBudget(): DailyBudgetState {
  return { localDate: "", count: 0 };
}

/**
 * The LOCAL calendar key for `at` — "YYYY-MM-DD" in the machine's local
 * zone. Never toISOString(): that is UTC and would roll the day at 07:00
 * local in UTC+7. Two-digit padding keeps keys comparable as strings.
 */
export function localDateKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * True when one more GET fits under `limit` on local date `key`. A state
 * stamped for a PREVIOUS day (or the fresh state) is always allowed — the
 * new day's first reserve starts a fresh count, so there is no explicit
 * reset step and local midnight rolls the budget for free (FR-9).
 */
export function budgetAllows(
  state: DailyBudgetState,
  key: string,
  limit: number = DAILY_GET_BUDGET,
): boolean {
  if (state.localDate !== key) return true;
  return state.count < limit;
}

/**
 * Reserve ONE GET on local date `key`, returning the NEXT state — pure,
 * no mutation of the caller's object. The wrapper pairs budgetAllows +
 * budgetReserve inside ONE synchronous window (no await between) and
 * persists the result BEFORE the GET leaves: a crash between reserve and
 * GET over-counts, the safe direction (under-fetch, never over).
 */
export function budgetReserve(state: DailyBudgetState, key: string): DailyBudgetState {
  const base = state.localDate === key ? state.count : 0;
  return { localDate: key, count: base + 1 };
}

/**
 * Canonical reason string a 429 writes into the halt-latch flag and its
 * alarm (FR-7). One constant, two readers (flag content, email body), so
 * the latch file's content always explains itself.
 */
export const HALT_RATE_LIMIT_REASON =
  "HTTP 429 rate limit — LinkedIn told this account to slow down";

/**
 * Canonical reason string a spent daily budget writes into the halt-latch
 * flag and its alarm (FR-7).
 */
export const HALT_BUDGET_REASON =
  "daily GET budget spent — fetching halts until the latch is cleared";
```

#### 2. tests/linkedin-behavior.test.ts
**File**: `tests/linkedin-behavior.test.ts`
**Changes**: NEW — the pure suite: window boundary pins, cadence floor/ceiling + seeded sweep, local YYYY-MM-DD key, budget allow/reserve/rollover/immutability, reason constants.

```typescript
/**
 * Offline suite for the behavioral policy machines (design 2026-11-09).
 *
 * Local Date constructors throughout — every pin is zone-independent: the
 * local (Y, M, D, ...) constructor and the local getters round-trip in any
 * timezone. No files, no doubles, no ambient clock: the module is pure,
 * so this suite is its whole contract.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DAILY_GET_BUDGET,
  HALT_BUDGET_REASON,
  HALT_RATE_LIMIT_REASON,
  WAKE_MAX_MS,
  WAKE_MIN_MS,
  WINDOW_END_HOUR,
  WINDOW_START_HOUR,
  budgetAllows,
  budgetReserve,
  freshBudget,
  isWithinWorkingHours,
  localDateKey,
  sampleTickDelayMs,
} from "../src/linkedin-behavior.js";

/** 2026-10-26 is a Monday; Oct 31 is the Saturday, Nov 1 the Sunday. */
const MONDAY = { y: 2026, m: 9, d: 26 };

const at = (y: number, m: number, d: number, hour: number, min = 0, sec = 0, ms = 0): Date =>
  new Date(y, m, d, hour, min, sec, ms);

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("isWithinWorkingHours", () => {
  it("admits 08:00:00.000 exactly and rejects 07:59:59.999", () => {
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 8)), true);
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 7, 59, 59, 999)), false);
  });

  it("admits 20:59:59.999 and rejects 21:00:00.000 — the end is exclusive", () => {
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 20, 59, 59, 999)), true);
    assert.equal(isWithinWorkingHours(at(MONDAY.y, MONDAY.m, MONDAY.d, 21)), false);
  });

  it("rejects Saturday and Sunday even at midday", () => {
    assert.equal(isWithinWorkingHours(at(2026, 9, 31, 12)), false);
    assert.equal(isWithinWorkingHours(at(2026, 10, 1, 12)), false);
  });

  it("rejects a Friday late-evening tick past the window", () => {
    assert.equal(isWithinWorkingHours(at(2026, 9, 30, 21, 30)), false);
  });

  it("admits every weekday hour from the start hour to one under the end hour", () => {
    for (let hour = WINDOW_START_HOUR; hour < WINDOW_END_HOUR; hour += 1) {
      assert.equal(isWithinWorkingHours(at(2026, 9, 28, hour)), true, `hour ${hour}`);
    }
  });
});

describe("sampleTickDelayMs", () => {
  it("pins the floor at exactly 28 minutes when rng returns 0", () => {
    assert.equal(
      sampleTickDelayMs(() => 0),
      WAKE_MIN_MS,
    );
    assert.equal(WAKE_MIN_MS, 28 * 60_000);
  });

  it("stays strictly under the 33-minute ceiling as rng approaches 1", () => {
    const delay = sampleTickDelayMs(() => 0.999999999);
    assert.equal(WAKE_MAX_MS, 33 * 60_000);
    assert.ok(delay >= WAKE_MIN_MS);
    assert.ok(delay < WAKE_MAX_MS);
  });

  it("keeps a seeded sweep inside [floor, ceiling) and never repeats one value", () => {
    const rng = seededRng(2026_11_09);
    const draws = new Set<number>();
    for (let i = 0; i < 1_000; i += 1) {
      const delay = sampleTickDelayMs(rng);
      assert.ok(delay >= WAKE_MIN_MS, `too small: ${delay}`);
      assert.ok(delay < WAKE_MAX_MS, `too big: ${delay}`);
      draws.add(delay);
    }
    assert.ok(draws.size > 1, "jitter collapsed to a single value");
  });
});

describe("localDateKey", () => {
  it("formats a local date zero-padded as YYYY-MM-DD", () => {
    assert.equal(localDateKey(at(2026, 8, 5, 13)), "2026-09-05");
  });

  it("reads the LOCAL calendar, not UTC — local midnight keeps its own date", () => {
    // Local 00:30 on Oct 26 is a different UTC date in every zone east of
    // UTC; the local-constructor/local-getter round-trip pins the date.
    assert.equal(localDateKey(at(MONDAY.y, MONDAY.m, MONDAY.d, 0, 30)), "2026-10-26");
  });
});

describe("budgetAllows / budgetReserve", () => {
  it("allows the fresh state on any key", () => {
    assert.equal(budgetAllows(freshBudget(), "2026-10-26"), true);
  });

  it("allows count 149 and blocks count 150 at the default budget", () => {
    const key = "2026-10-26";
    let state = freshBudget();
    for (let i = 0; i < DAILY_GET_BUDGET; i += 1) {
      assert.equal(budgetAllows(state, key), true, `GET ${i + 1}`);
      state = budgetReserve(state, key);
    }
    assert.equal(state.count, DAILY_GET_BUDGET);
    assert.equal(budgetAllows(state, key), false);
  });

  it("blocks at a custom limit", () => {
    const key = "2026-10-26";
    const state = budgetReserve(budgetReserve(freshBudget(), key), key);
    assert.equal(budgetAllows(state, key, 2), false);
    assert.equal(budgetAllows(state, key, 3), true);
  });

  it("rolls over at local midnight: a spent budget never blocks the new day", () => {
    const yesterday = { localDate: "2026-10-25", count: DAILY_GET_BUDGET };
    assert.equal(budgetAllows(yesterday, "2026-10-26"), true);
    const reserved = budgetReserve(yesterday, "2026-10-26");
    assert.deepEqual(reserved, { localDate: "2026-10-26", count: 1 });
  });

  it("accumulates within one day and never mutates the caller's state", () => {
    const key = "2026-10-26";
    const frozen = Object.freeze({ localDate: key, count: 5 });
    const next = budgetReserve(frozen, key);
    assert.deepEqual(frozen, { localDate: key, count: 5 });
    assert.deepEqual(next, { localDate: key, count: 6 });
  });
});

describe("halt latch reason vocabulary", () => {
  it("exports two non-empty, distinguishable canonical reasons", () => {
    assert.ok(HALT_RATE_LIMIT_REASON.length > 0);
    assert.ok(HALT_BUDGET_REASON.length > 0);
    assert.notEqual(HALT_RATE_LIMIT_REASON, HALT_BUDGET_REASON);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes for the slice: `npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --module nodenext --moduleResolution nodenext --target es2022 --lib es2023 --types node src/linkedin-behavior.ts tests/linkedin-behavior.test.ts`
- [x] Suite passes: `npx tsx --test tests/linkedin-behavior.test.ts` (16 tests)
- [x] Lint passes: `npx biome check src/linkedin-behavior.ts tests/linkedin-behavior.test.ts`
- [x] Window boundary pins green: 07:59:59.999 out / 08:00:00.000 in / 20:59:59.999 in / 21:00:00.000 out, Sat + Sun rejected, all 13 weekday hours admitted
- [x] Cadence pins green: rng=0 -> exactly 28 min; 1000-draw seeded sweep inside [28, 33) minutes with no single-value collapse
- [x] Budget pins green: count 150 blocks at the default limit, custom limit honored, new-day key resets a spent budget, caller state never mutated

#### Manual Verification:
- [ ] None — the module is IO-free; the suite is the whole contract.

---

## Phase 2: loop refactor

### Overview
The loop becomes injectable and human-paced: entry-guarded runLoop with the 28-33-minute jittered cadence, a wake log, and the two fault arms. The old fixed 600 s sleep dies here.

**Files** (design Slice 2): `scripts/watch-linkedin.ts`, `tests/watch-linkedin.test.ts`
**Depends on**: Phase 1
**Guidance amendment (Step 5, applied)**: when this phase lands, update `.rpiv/guidance/tests/architecture.md`'s coverage-map line for `scripts/watch-linkedin.ts` — the refactored loop owns testable behavior (cadence, fault arms, cap), so the new suite deliberately supersedes the "NO TESTS BY DESIGN" line.

### Changes Required:

#### 1. scripts/watch-linkedin.ts
**File**: `scripts/watch-linkedin.ts`
**Changes**: MODIFY — entry-guarded main (runLoop exports for the suite), jittered 28-33-min cadence via sampleTickDelayMs with a wake log, leg-dead routes to the episode handler / other faults warn, maxIterations cap, RunLoopDeps injectables.

```typescript
/**
 * The always-on PC loop (design 2026-11-09, the anti-restriction
 * profile): one fetch tick, then a jittered 28-33-minute sleep, forever.
 * Every fetch gate (the working-hours window, the halt latch, the daily
 * budget) rides fetchTick — the loop stays a dumb cadence: tick, sleep,
 * repeat. Leg-dead edges send ONE alarm per episode (the marker file in
 * scripts/fetch-linkedin.ts) and the loop keeps running — a cookie-file
 * refresh self-heals on a later tick without a restart. Any other tick
 * fault warns and the loop continues; Ctrl-C stops it.
 *
 * Entry-guarded main (the fetch-linkedin.ts idiom): importing the module
 * stays side-effect free — runLoop exports for the offline suite, and the
 * real loop starts only when this file is the process entry.
 *
 * Run from a dedicated clone of main: `npm run watch-linkedin`.
 */
import { pathToFileURL } from "node:url";
import { envWithDotEnv } from "../src/env-file.js";
import { type RandomFn, sampleTickDelayMs } from "../src/linkedin-behavior.js";
import { type SleepFn, isLegDead } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";

/** Injectables for the offline suite; production defaults run the real tick. */
export interface RunLoopDeps {
  /** One fetch tick. Default: fetchTick with the merged env (resolved once). */
  tick?: () => Promise<unknown>;
  /** Sleep between ticks. Default: a setTimeout promise. */
  sleepFn?: SleepFn;
  /** Clock for the wake log. Default: Date.now. */
  now?: () => number;
  /** Jitter draw for the cadence. Default: Math.random. */
  rng?: RandomFn;
  /** Leg-dead episode handler. Default: handleLegDeadEpisode (one alarm per episode). */
  onLegDead?: (reason: string) => Promise<void>;
  /** Environment for the default tick. Default: the merged env — .env fills unset keys, the real shell wins. */
  env?: Record<string, string | undefined>;
  /** Tick cap for the offline suite; undefined (the default) loops forever. */
  maxIterations?: number;
}

/**
 * The loop: tick, then a uniform 28-33-minute sleep (sampleTickDelayMs),
 * forever — or until maxIterations when the suite caps it. The first tick
 * runs immediately; every iteration pairs one tick with one sleep. The
 * wake log names the delay and the local wall-clock wake time so a quiet
 * overnight stretch stays legible in the run log.
 */
export async function runLoop(deps: RunLoopDeps = {}): Promise<void> {
  const env = deps.env ?? envWithDotEnv();
  const tick = deps.tick ?? (() => fetchTick({ env }));
  const sleepFn =
    deps.sleepFn ??
    ((ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const now = deps.now ?? Date.now;
  const rng: RandomFn = deps.rng ?? Math.random;
  const onLegDead = deps.onLegDead ?? ((reason: string) => handleLegDeadEpisode(reason));

  const max = deps.maxIterations;

  for (let iteration = 1; max === undefined || iteration <= max; iteration += 1) {
    try {
      await tick();
    } catch (error) {
      if (isLegDead(error)) {
        await onLegDead(error.reason);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`watch-linkedin: tick FAILED — ${message}`);
      }
    }
    const delayMs = sampleTickDelayMs(rng);
    const wakeAt = new Date(now() + delayMs);
    const hh = String(wakeAt.getHours()).padStart(2, "0");
    const mm = String(wakeAt.getMinutes()).padStart(2, "0");
    console.log(
      `watch-linkedin: next wake in ~${Math.round(delayMs / 60_000)} min (${hh}:${mm} local)`,
    );
    await sleepFn(delayMs);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLoop().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`watch-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
```

#### 2. tests/watch-linkedin.test.ts
**File**: `tests/watch-linkedin.test.ts`
**Changes**: NEW — seeded cadence transcript, tick-before-sleep order, cap 0 runs nothing, wake-log pins, both fault arms, and the import-is-inert entry-guard pin.

```typescript
/**
 * Offline suite for the always-on loop (design 2026-11-09, Slice 2): the
 * jittered cadence transcript under a seeded rng, the two tick-fault arms
 * (leg-dead routes to the episode handler; anything else warns and the
 * loop continues), and the iteration cap. "The loop never exits on
 * leg-dead" is the exit-contract pin this suite owns.
 *
 * Importing scripts/watch-linkedin.ts in this file IS the entry-guard
 * pin: a side-effecting import would start the real loop and hang the
 * suite on the real fetchTick.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLoop } from "../scripts/watch-linkedin.js";
import { WAKE_MAX_MS, WAKE_MIN_MS, sampleTickDelayMs } from "../src/linkedin-behavior.js";
import { legDead } from "../src/linkedin-fetch.js";

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("runLoop cadence", () => {
  it("sleeps the seeded rng draws — never the old fixed 600 s", async () => {
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
      maxIterations: 4,
    });
    assert.equal(calls, 4);
    assert.equal(sleeps.length, 4);
    // The transcript IS the oracle: recompute the draws with the same seed.
    const rng2 = seededRng(2026_11_09);
    const expected = [
      sampleTickDelayMs(rng2),
      sampleTickDelayMs(rng2),
      sampleTickDelayMs(rng2),
      sampleTickDelayMs(rng2),
    ];
    assert.deepEqual(sleeps, expected);
    for (const ms of sleeps) {
      assert.ok(ms >= WAKE_MIN_MS && ms < WAKE_MAX_MS, `out of band: ${ms}`);
      assert.notEqual(ms, 600_000);
    }
  });

  it("ticks first, sleeps after — the first tick is immediate", async () => {
    const order: string[] = [];
    await runLoop({
      tick: async () => {
        order.push("tick");
      },
      sleepFn: async () => {
        order.push("sleep");
      },
      rng: () => 0,
      maxIterations: 1,
    });
    assert.deepEqual(order, ["tick", "sleep"]);
  });

  it("the iteration cap terminates runLoop — cap 0 runs nothing", async () => {
    let calls = 0;
    await runLoop({
      tick: async () => {
        calls += 1;
      },
      sleepFn: async () => {},
      maxIterations: 0,
    });
    assert.equal(calls, 0);
  });

  it("logs the wake delay in minutes and a local wall-clock wake time", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    await runLoop({
      tick: async () => {},
      sleepFn: async () => {},
      rng: () => 0,
      now: () => new Date(2026, 9, 26, 14, 5).getTime(),
      maxIterations: 1,
    });
    const line = log.mock.calls.map((call) => String(call.arguments[0])).join("\n");
    assert.match(line, /next wake in ~28 min/);
    assert.match(line, /\(14:33 local\)/);
  });
});

describe("runLoop fault arms", () => {
  it("routes a leg-dead tick to the episode handler and keeps running", async () => {
    const reasons: string[] = [];
    let calls = 0;
    await runLoop({
      tick: async () => {
        calls += 1;
        if (calls === 1) throw legDead("HTTP 401 {} — dead li_at session");
      },
      sleepFn: async () => {},
      onLegDead: async (reason) => {
        reasons.push(reason);
      },
      maxIterations: 2,
    });
    assert.equal(calls, 2); // the loop continued past the dead tick
    assert.deepEqual(reasons, ["HTTP 401 {} — dead li_at session"]);
  });

  it("warns on any other fault and keeps running", async (t) => {
    const warn = t.mock.method(console, "warn", console.warn.bind(console));
    let calls = 0;
    await runLoop({
      tick: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
      },
      sleepFn: async () => {},
      maxIterations: 2,
    });
    assert.equal(calls, 2);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0]?.arguments[0]), /watch-linkedin: tick FAILED — boom/);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes for the slice: `npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --module nodenext --moduleResolution nodenext --target es2022 --lib es2023 --types node scripts/watch-linkedin.ts tests/watch-linkedin.test.ts`
- [x] Suite passes: `npx tsx --test tests/watch-linkedin.test.ts` (6 tests)
- [x] Lint passes: `npx biome check scripts/watch-linkedin.ts tests/watch-linkedin.test.ts`
- [x] Cadence transcript pin green: the sleep transcript deep-equals the seeded rng's draws, every draw inside [28, 33) minutes, none equal to the old fixed 600 s
- [x] Order pin green: the first tick runs before the first sleep
- [x] Cap pin green: `maxIterations: 0` runs zero ticks
- [x] Fault-arm pins green: a leg-dead tick routes to the episode handler and the loop continues; any other fault warns exactly once and the loop continues
- [x] Entry-guard pin green: importing the module in the suite starts no loop (the suite completes)

#### Manual Verification:
- [ ] `npm run watch-linkedin` logs `next wake in ~28-32 min (HH:MM local)` after each tick
- [ ] Ctrl-C stops the loop; a leg-dead tick never exits the process

---

## Phase 3: walk mechanics

### Overview
The walk learns the account-safety mechanics: 429 becomes a tagged halt, randomized 5-15 s pacing, one page per surface, shuffled dispatch with structural output order, unparsable-200 tick abort, and the 40-minute payload staleness window.

**Files** (design Slice 3): `src/linkedin-fetch.ts`, `src/linkedin-payload.ts`, `tests/linkedin-fetch.test.ts`, `tests/linkedin-payload.test.ts`
**Depends on**: Phase 1

### Changes Required:

#### 1. src/linkedin-fetch.ts
**File**: `src/linkedin-fetch.ts`
**Changes**: MODIFY — classifyFault gains the 429-to-halt branch; tagged halt()/isHalt() joins legDead/allSurfacesFaulted; makePacingGate draws a randomized 5-15 s gap per reservation through an injected rng; the walk caps at ONE page per surface (FR-3), shuffles dispatch order Fisher-Yates style (FR-5, output stays input-order), throws legDead on an unparsable 200 (FR-4), drains a wrapper-thrown halt in the worker, and halt outranks leg-dead at the join. fetchLinkedInPosts gains the rng parameter (last).

```typescript
/**
 * The LinkedIn voyager fetch leg: transport adapters, §13 fault
 * classification, and the runPool surface walk (design slices 3/D11).
 *
 * Two transports behind one seam — `VoyagerGet`, one GET per call:
 *
 * - curl (default): spawns the lexiforest curl-impersonate single binary
 *   (CURL_IMPERSONATE_BIN, fail-visible when unset — the message names
 *   both remedies: npm run setup-curl, or the playwright .env line) with
 *   the §3/§10 header set on top of the pinned chrome116 profile. The
 *   profile owns the UA + TLS + HTTP/2 fingerprint as one consistent set
 *   (D2 amendment 2026-11-05); the HTTP status rides a write-out sentinel
 *   after the body — one exec, no temp files. The exec runner is
 *   injectable for offline tests.
 * - playwright: a standalone API-request context
 *   (`request.newContext({ storageState })`) behind the SAME dynamic-import
 *   quarantine idiom as makeChromiumContextFactory (fetch-threads.ts:129).
 *   NOT ContextFactory: ContextLike (fetch-threads.ts:106) exposes no
 *   request surface, and an API GET needs no browser launch (verified
 *   2026-11-04). storageState carries the cookie pair; csrf-token and the
 *   static headers ride extraHTTPHeaders.
 *
 * `LINKEDIN_TRANSPORT` selects the adapter (`curl` default | `playwright`,
 * else throw — switching after a failed probe is an operator action, D2).
 *
 * The walk (D11) reuses runPool — verified contract: runPool RETURNS VOID
 * (src/pool.ts:33-52), so results ride caller-owned side arrays indexed by
 * the claim index, the worker stays total for surface faults (warn + skip,
 * the caller-owned skip warn stays in index.ts), and leg-dead aborts via
 * the repo's drain-then-throw shape (judgePosts fallback pool,
 * src/judge.ts:681; fast-workflow-runtime D11): catch isLegDead in the
 * worker, set a shared flag, stop claiming, throw once after the join.
 * A shared per-walk pacing gate (5s between voyager GETs, any surface)
 * keeps the global call rate identical to a sequential walk — the anti-bot
 * rate is pacing-bound, not width-bound (§13.3 throttling was observed at
 * ~40 rapid calls).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Surface } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import { HALT_RATE_LIMIT_REASON, type RandomFn } from "./linkedin-behavior.js";
import {
  type LinkedInCookies,
  buildCookieHeader,
  csrfToken,
  resolveLinkedInCookies,
  toStorageState,
} from "./linkedin-session.js";
import { VOYAGER_STATIC_HEADERS, buildSearchUrl, parseSearchResponse } from "./linkedin-voyager.js";
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

/** One configured linkedin surface (raw keyword string, never a URL). */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;

/** Injectable sleep for the pacing gate (judge.ts trailing-param idiom). */
export type SleepFn = (ms: number) => Promise<void>;

/** Walk width. The pacing gate, not this number, bounds the voyager rate. */
export const LINKEDIN_FETCH_CONCURRENCY = 2;

/** §12.1: count 50 is unclamped server-side; `start += count` pages. */
export const PAGE_SIZE = 50;

/** Pace floor: minimum spacing between voyager GETs, shared across surfaces (§13.3). */
export const PACE_MIN_MS = 5_000;

/**
 * Pace ceiling: EXCLUSIVE upper bound of the spacing draw (the anti-
 * restriction profile's 5-15 s band, design 2026-11-09). floor() keeps a
 * draw at most MAX - 1 ms, mirroring the wake-cadence bounds.
 */
export const PACE_MAX_MS = 15_000;

/** One curl exec's wall-clock cap; mirrored by --max-time inside curl. */
const REQUEST_TIMEOUT_MS = 30_000;

/** curl -w appends this sentinel + status after the response body. */
const STATUS_SENTINEL = "___CURL_STATUS:";

/**
 * The pinned impersonation profile (lexiforest single binary, §D2
 * amendment 2026-11-05). The profile owns the UA + TLS + HTTP/2 headers
 * as ONE consistent set — chrome116 is the Windows-10 Chrome profile the
 * release ships. The transport's own `user-agent` header is deliberately
 * GONE: overriding the profile's UA with a different Chrome version is a
 * mismatched fingerprint signal. Our §3/§10 -H overrides (cookie,
 * csrf-token, the static set) ride ON TOP of the profile defaults.
 */
export const CURL_IMPERSONATE_PROFILE = "chrome116";

/**
 * §10 client fingerprint for the PLAYWRIGHT adapter only (no profile
 * system there — `request.newContext` presents no TLS fingerprint, so the
 * explicit UA header is the only browser signal it can send).
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** One voyager GET's outcome: the HTTP status and the raw body. */
export interface VoyagerResponse {
  readonly status: number;
  readonly body: string;
}

/** The transport seam: one GET per call, shared by both adapters. */
export type VoyagerGet = (url: string) => Promise<VoyagerResponse>;

/** An opened transport: the GET plus its teardown (a no-op for curl). */
export interface Transport {
  readonly get: VoyagerGet;
  readonly dispose: () => Promise<void>;
}

// --- LegDeadError: the tagged-error idiom (judge-rotation.ts:51-75) ---

export const LEG_DEAD = "LegDeadError";

/**
 * Thrown once per tick when the session leg is dead (D7). Factory-assigned
 * fields stay mutable — the RotationExhausted idiom (judge-rotation.ts:61-70).
 */
export interface LegDead extends Error {
  name: string;
  reason: string;
}

export function legDead(reason: string): LegDead {
  const error = new Error(`linkedin-fetch: leg dead — ${reason}`) as LegDead;
  error.name = LEG_DEAD;
  error.reason = reason;
  return error;
}

export function isLegDead(error: unknown): error is LegDead {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === LEG_DEAD
  );
}

// --- AllSurfacesFaulted: the tagged-error idiom (judge-rotation.ts:51-75) ---

export const ALL_SURFACES_FAULTED = "AllSurfacesFaulted";

/** Thrown when EVERY configured surface faulted and none published posts (D13: the tick, not the walk, decides the write). */
export interface AllSurfacesFaulted extends Error {
  name: string;
  faulted: number;
}

export function allSurfacesFaulted(faulted: number): AllSurfacesFaulted {
  const error = new Error(
    `linkedin-fetch: all ${faulted} surface(s) faulted — nothing fetched`,
  ) as AllSurfacesFaulted;
  error.name = ALL_SURFACES_FAULTED;
  error.faulted = faulted;
  return error;
}

export function isAllSurfacesFaulted(error: unknown): error is AllSurfacesFaulted {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === ALL_SURFACES_FAULTED
  );
}

// --- HaltError: the tagged-error idiom (judge-rotation.ts:51-75) ---
// The account-safety terminal (design 2026-11-09): a 429 or a spent daily
// budget stops the walk and fetchTick trips the operator-cleared latch.
// It deliberately does NOT ride LegDeadError: a dead session self-heals on
// a cookie refresh, a halt must not.

export const HALT = "HaltError";

/** Thrown once per walk when the account hit a slow-down signal. */
export interface Halt extends Error {
  name: string;
  reason: string;
}

export function halt(reason: string): Halt {
  const error = new Error(`linkedin-fetch: halt — ${reason}`) as Halt;
  error.name = HALT;
  error.reason = reason;
  return error;
}

export function isHalt(error: unknown): error is Halt {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === HALT;
}

// --- §13.3 fault classification ---

export type FaultKind = "legDead" | "fault" | "halt";

export interface Fault {
  readonly kind: FaultKind;
  readonly reason: string;
}

/**
 * §13.3 detection recipe, HTTP responses only (connection-level failures
 * throw from the transport and land as surface faults, never leg-dead —
 * a dead network is not a dead session):
 *
 * - 302/3xx redirect loop: live-observed 2026-11-05 (validate rehearsal) —
 *   a dead session presents as a 302 loop on this client stack, with
 *   `set-cookie: li_at=delete me` and Cloudflare `__cf_bm` cookies in the
 *   chain. DOCUMENTATION.md §13.1's API-vs-browser redirect claim does not
 *   hold for this stack; root cause (session death vs edge fingerprint
 *   block) is unresolved ON PURPOSE — both carry the same operator remedy.
 *   The endpoint never legitimately redirects a GET — any 3xx is leg dead
 *   (§13.1 amendment: same remedy as 401).
 * - 403 "CSRF check failed." text, or a Cloudflare challenge page: the
 *   session/CSRF pair is broken or the IP reputation is burned — leg dead.
 * - 401 {"status":401}: dead or absent li_at — leg dead.
 * - bare 400 {"status":400} on the finder: no member context (dead
 *   session) — leg dead (§13.1: same remedy as 401).
 * - graphql-envelope 400: known query, bad variables — OUR bug, a fault.
 * - 500: unknown queryId — the hash expired server-side (§15); re-derive
 *   from a current APK, do not debug variables — a fault.
 */
export function classifyFault(status: number, body: string): Fault {
  const trimmed = body.trim();
  // Live-observed 2026-11-05 (validate rehearsal): a dead session presents
  // as a 302 redirect loop on this endpoint — DOCUMENTATION.md §13.1 says
  // only browser navigations redirect; the claim does not hold for this
  // client stack. Root cause (session death vs edge fingerprint block) is
  // unresolved ON PURPOSE: both carry the same operator remedy, so the
  // classification must not wait on it. The endpoint never legitimately
  // redirects a GET — any 3xx is leg-dead, same remedy as 401 (§13.1).
  if (status >= 300 && status < 400) {
    return {
      kind: "legDead",
      reason: `HTTP ${status} redirect loop — dead session or edge block; refresh the cookie file (live-observed 2026-11-05, §13.1 amendment)`,
    };
  }
  // 429: the account is rate-limited (the anti-restriction profile) — a
  // HALT, never a leg-dead: the session is fine, the account must slow
  // down (design 2026-11-09). The reason reuses the behavior module's
  // canonical string so the latch file, the alarm, and this log line
  // always carry the same words.
  if (status === 429) {
    return { kind: "halt", reason: HALT_RATE_LIMIT_REASON };
  }
  if (status === 403) {
    const challenge = /Just a moment|challenge|cf-ray/i.test(trimmed);
    return {
      kind: "legDead",
      reason: challenge
        ? "HTTP 403 challenge page — IP/session reputation burned (§13.3)"
        : 'HTTP 403 "CSRF check failed." — session/JSESSIONID mismatch (§13.1)',
    };
  }
  if (status === 401) {
    return {
      kind: "legDead",
      reason: `HTTP 401 ${trimmed.slice(0, 60)} — dead li_at session (§13.1)`,
    };
  }
  if (status === 400) {
    if (trimmed === '{"status":400}') {
      return {
        kind: "legDead",
        reason: 'bare HTTP 400 {"status":400} — no member context; dead session (§13.1)',
      };
    }
    return {
      kind: "fault",
      reason: `HTTP 400 graphql envelope — bad variables (our bug): ${trimmed.slice(0, 80)}`,
    };
  }
  if (status === 500) {
    return {
      kind: "fault",
      reason: "HTTP 500 — unknown queryId; the hash expired (§15), re-derive from a current APK",
    };
  }
  return { kind: "fault", reason: `HTTP ${status}` };
}

// --- curl-impersonate transport ---

/** Injectable exec seam for offline tests: binary + args → stdout. */
export type ExecFn = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

const execFilePromised = promisify(execFile);

const realExec: ExecFn = (file, args) =>
  execFilePromised(file, [...args], {
    timeout: REQUEST_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

/**
 * curl-impersonate transport (developer-selected primary transport, D2
 * amendment 2026-11-05): the LEXIFOREST single binary — upstream lwthiker
 * ships linux/mac/docker only, so lexiforest is the Windows distribution
 * of record, installed by `npm run setup-curl`. The profile headers + our
 * overrides compose per the fork README (`-H` overrides individual
 * profile headers), so the §3/§10 set rides on top of chrome116's own
 * UA/TLS/HTTP/2 fingerprint. One exec per GET: `--impersonate` selects the
 * pinned profile, `-sS` body to stdout, `--max-time` mirrors the exec
 * timeout, and `-w` appends the status sentinel after the body —
 * parseable without temp files or stderr games. Exec-level failures
 * (connection reset, timeout, missing binary) throw plain errors: surface
 * faults, never leg-dead.
 */
export function createCurlTransport(
  cookies: LinkedInCookies,
  env: Record<string, string | undefined> = process.env,
  execFn: ExecFn = realExec,
): () => Promise<Transport> {
  return async (): Promise<Transport> => {
    const bin = env[ENV_NAMES.curlImpersonateBin]?.trim();
    if (bin === undefined || bin === "") {
      throw new Error(
        `linkedin-fetch: ${ENV_NAMES.curlImpersonateBin} is not set — run npm run setup-curl, or put LINKEDIN_TRANSPORT=playwright in .env to skip the binary (README: PC operations)`,
      );
    }
    // No user-agent pair here ON PURPOSE: the chrome116 profile owns the
    // UA + TLS + HTTP/2 set; overriding its UA is the mismatched-signal
    // class the fingerprint exists to avoid (D2 amendment).
    const headerPairs = [
      `cookie: ${buildCookieHeader(cookies)}`,
      `csrf-token: ${csrfToken(cookies)}`,
      ...Object.entries(VOYAGER_STATIC_HEADERS).map(([name, value]) => `${name}: ${value}`),
    ];
    const get: VoyagerGet = async (url) => {
      const args = [
        "--impersonate",
        CURL_IMPERSONATE_PROFILE,
        "-sS",
        "--max-time",
        String(Math.round(REQUEST_TIMEOUT_MS / 1000)),
        "--compressed",
        url,
        ...headerPairs.flatMap((header) => ["-H", header]),
        "-w",
        `\n${STATUS_SENTINEL}%{http_code}`,
      ];
      let stdout: string;
      try {
        ({ stdout } = await execFn(bin, args));
      } catch (error) {
        // Credential hygiene (revise 2026-11-10): Node's execFile error
        // message embeds the ENTIRE command line — cookie and csrf-token
        // headers included — and a live probe printed the whole jar to the
        // console. Never forward it. The diagnostic value rides the exit
        // code + curl's own stderr: headers never go to stderr.
        const failure = error as { code?: unknown; stderr?: unknown };
        const code =
          typeof failure.code === "number" || typeof failure.code === "string"
            ? failure.code
            : "unknown";
        const stderr =
          typeof failure.stderr === "string" && failure.stderr.trim() !== ""
            ? failure.stderr.trim().slice(0, 200)
            : "no stderr captured";
        throw new Error(`linkedin-fetch: curl exec failed (exit ${code}): ${stderr}`);
      }
      const marker = stdout.lastIndexOf(STATUS_SENTINEL);
      if (marker === -1) {
        throw new Error("linkedin-fetch: curl produced no status marker (binary or flag mismatch)");
      }
      const status = Number(stdout.slice(marker + STATUS_SENTINEL.length).trim());
      if (!Number.isInteger(status) || status <= 0) {
        throw new Error("linkedin-fetch: curl status marker unparsable");
      }
      // The -w template writes "\n" before the sentinel: that separator is
      // not part of the body (a body with its own trailing newline keeps it).
      const raw = stdout.slice(0, marker);
      const body = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
      return { status, body };
    };
    return { get, dispose: async () => undefined };
  };
}

/**
 * Playwright API-request transport (the tested fallback, D2). The module's
 * dynamic-import quarantine site — the only `await import("playwright")`
 * outside fetch-threads. storageState carries the cookie pair (toStorageState
 * in linkedin-session.ts); the csrf-token and static headers ride
 * extraHTTPHeaders. Unexercised by the offline suite, like
 * chromiumContextFactory — the VoyagerGet seam carries the tests.
 */
export function createPlaywrightTransport(cookies: LinkedInCookies): () => Promise<Transport> {
  return async (): Promise<Transport> => {
    const { request } = await import("playwright");
    // Complete the session-module cookie shape to Playwright's storageState
    // wire type: session cookies carry no jar expiry (-1), and an
    // API-request context runs no scripts, so httpOnly/sameSite are inert
    // defaults. The session module stays the minimal contract (slice 2).
    const storageState = {
      cookies: toStorageState(cookies).cookies.map((cookie) => ({
        ...cookie,
        expires: -1,
        httpOnly: false,
        sameSite: "Lax" as const,
      })),
      origins: [],
    };
    const context = await request.newContext({
      storageState,
      extraHTTPHeaders: {
        "csrf-token": csrfToken(cookies),
        "user-agent": BROWSER_UA, // identical fingerprint to the curl adapter (plan-review amendment)
        ...VOYAGER_STATIC_HEADERS,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const get: VoyagerGet = async (url) => {
      // maxRedirects: 0 — a dead session presents as a 302 redirect loop;
      // following it burns ~20 unpaced redirects and ends in a plain throw
      // that bypasses the classifier. The status itself must reach the
      // §13.3 classifier, where the 3xx branch flags leg-dead (Phase 8).
      const response = await context.get(url, { maxRedirects: 0 });
      return { status: response.status(), body: await response.text() };
    };
    return {
      get,
      dispose: async () => {
        await context.dispose();
      },
    };
  };
}

/**
 * Resolve AND open the configured transport: `LINKEDIN_TRANSPORT` selects
 * `curl` (default, empty/unset included) or `playwright`; anything else
 * throws naming the allowed values (D2: no silent auto-switching — a
 * failed probe is followed by an operator edit + re-probe).
 */
export async function resolveLinkedInTransport(
  env: Record<string, string | undefined> = process.env,
  cookies: LinkedInCookies = resolveLinkedInCookies(env),
  execFn: ExecFn = realExec,
): Promise<Transport> {
  const selection = env[ENV_NAMES.linkedinTransport]?.trim() ?? "";
  const maker =
    selection === "" || selection === "curl"
      ? createCurlTransport(cookies, env, execFn)
      : selection === "playwright"
        ? createPlaywrightTransport(cookies)
        : null;
  if (maker === null) {
    throw new Error(
      `linkedin-fetch: ${ENV_NAMES.linkedinTransport}="${selection}" is not one of: curl, playwright`,
    );
  }
  return maker();
}

// --- the surface walk ---

interface PacingGate {
  readonly wait: () => Promise<void>;
}

/**
 * Shared pacing gate: every voyager GET starts PACE_MS or more after the
 * previous one, regardless of which surface issued it. The slot is
 * RESERVED BEFORE SLEEPING — the stamp advances synchronously on entry, so
 * concurrent workers can never compute the same wake time and fire a burst;
 * with width 2 the GET starts still space PACE_MS apart globally
 * (pacing-bound, not width-bound, D11). A per-walk closure (not module
 * state): two ticks must not inherit each other's stamp, and each test
 * run gets a fresh gate.
 */
function makePacingGate(
  now: () => number,
  sleepFn: SleepFn,
  rng: RandomFn = Math.random,
): PacingGate {
  let nextFreeAt = Number.NEGATIVE_INFINITY;
  return {
    wait: async () => {
      const slotAt = Math.max(now(), nextFreeAt);
      // The gap is a fresh uniform draw in [PACE_MIN_MS, PACE_MAX_MS) per
      // reservation — randomized spacing, same reserve-before-sleep shape.
      nextFreeAt = slotAt + Math.floor(PACE_MIN_MS + rng() * (PACE_MAX_MS - PACE_MIN_MS));
      const waitMs = slotAt - now();
      if (waitMs > 0) {
        await sleepFn(waitMs);
      }
    },
  };
}

const defaultSleep: SleepFn = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Walk every configured linkedin surface: count-50 pages with
 * stop on a partial page (§12.8: returned posts < count
 * is the last page; `elements: []` lands as zero posts), one log line per
 * surface (empty-is-success, defb8af). Surface faults warn + skip (the
 * index arm owns the per-surface skip summary); leg-dead aborts the tick
 * whole via drain-then-throw; when EVERY surface faulted (none leg-dead),
 * the tagged AllSurfacesFaulted throws — the caller decides the write
 * (D13: a partial fault still publishes the survivors). Accepts a bare
 * VoyagerGet (tests, probe — no ownership) or an opened Transport
 * (scripts — disposed in finally).
 */
export async function fetchLinkedInPosts(
  surfaces: readonly LinkedinSurface[],
  cookies: LinkedInCookies,
  transport: VoyagerGet | Transport,
  sleepFn: SleepFn = defaultSleep,
  now: () => number = Date.now,
  rng: RandomFn = Math.random,
): Promise<Post[]> {
  const ownsTransport = typeof transport !== "function";
  const get: VoyagerGet = ownsTransport ? (transport as Transport).get : transport;
  const gate = makePacingGate(now, sleepFn, rng);
  // FR-5 (shuffled surface order): Fisher-Yates over {surface, index}
  // pairs with the injected rng — the GET dispatch order varies per tick
  // while perSurface keeps ORIGINAL indexes, so the flat() reassembly
  // order stays input-order structural no matter how the shuffle lands.
  const order = surfaces.map((surface, index) => ({ surface, index }));
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  // Side arrays indexed by the ORIGINAL surface index — runPool returns
  // void (src/pool.ts:33-52); reassembly order comes from the filter+flat walk.
  const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
  let dropped = 0;
  let faultedCount = 0;
  let deadReason: string | undefined;
  let haltReason: string | undefined;

  try {
    await runPool(order, LINKEDIN_FETCH_CONCURRENCY, async (entry) => {
      const surface = entry.surface;
      const label = `linkedin/${surface.value}`;
      try {
        // Drain checks: stop claiming the moment a halt or leg-dead is
        // flagged; the join re-throws once.
        if (deadReason !== undefined || haltReason !== undefined) return;
        await gate.wait();
        if (deadReason !== undefined || haltReason !== undefined) return;
        // FR-3 (one page per surface per tick): page 0 only — count 50 is
        // unclamped server-side, so a full page still caps at ONE GET.
        const response = await get(buildSearchUrl(surface.value, 0, PAGE_SIZE));
        if (response.status !== 200) {
          const fault = classifyFault(response.status, response.body);
          if (fault.kind === "halt") {
            haltReason ??= fault.reason;
            console.warn(`fetch: ${label} HALT — ${fault.reason}`);
            return;
          }
          if (fault.kind === "legDead") throw legDead(fault.reason);
          throw new Error(`${label} page 0: ${fault.reason}`);
        }
        const parsed = parseSearchResponse(response.body);
        if (parsed.kind === "unparsable") {
          // FR-4 (ratified 2026-11-09): one unparsable 200 stops the whole
          // tick — drain-then-throw via the leg-dead channel, whose episode
          // marker emails once per episode and auto-clears on the next
          // good tick. A changed response shape is exactly when the machine
          // must stop hitting the endpoint, not push through.
          throw legDead(`${label} page 0: unparsable 200 body — ${parsed.reason}`);
        }
        dropped += parsed.dropped;
        perSurface[entry.index] = parsed.posts;
        // Empty-is-success keyed on the observable signal (defb8af): a
        // surface that yields 0 posts is an outcome, not a fault.
        console.log(`fetch: ${label} OK — ${parsed.posts.length} post(s)`);
      } catch (error) {
        if (isHalt(error)) {
          // A halt thrown INSIDE the worker (the budget wrapper riding the
          // seam) must drain like a leg-dead, never land in the fault arm —
          // a surface fault would quietly COMPLETE the tick with partial
          // posts (design 2026-11-09; caught by the Slice 4 mid-walk test).
          haltReason ??= error.reason;
          console.warn(`fetch: ${label} HALT — ${error.reason}`);
          return;
        }
        if (isLegDead(error)) {
          // Drain-then-throw (judgePosts D11 shape): flag, stop claiming,
          // re-throw once after the join. The tick aborts whole — partial
          // posts are discarded, never half-written.
          deadReason ??= error.reason;
          console.warn(`fetch: ${label} LEG DEAD — ${error.reason}`);
          return;
        }
        faultedCount += 1; // fault arm only; the leg-dead/halt arms return above
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch: ${label} FAILED — ${message}`);
      }
    });
  } finally {
    if (ownsTransport) await (transport as Transport).dispose();
  }

  // Halt outranks leg-dead at the join: a rate-limit signal is the
  // account-safety terminal; a same-walk dead session still self-heals.
  if (haltReason !== undefined) {
    throw halt(haltReason);
  }
  if (deadReason !== undefined) {
    throw legDead(deadReason);
  }
  if (surfaces.length > 0 && faultedCount === surfaces.length) {
    throw allSurfacesFaulted(faultedCount);
  }
  if (dropped > 0) {
    console.warn(`fetch: linkedin dropped ${dropped} malformed row(s)`);
  }
  return perSurface.filter((entry): entry is Post[] => entry !== undefined).flat();
}
```

#### 2. src/linkedin-payload.ts
**File**: `src/linkedin-payload.ts`
**Changes**: MODIFY — PAYLOAD_MAX_AGE_MS 1_800_000 to 2_400_000 (30 to 40 min) so the 33-minute worst-case wake never reads stale.

```typescript
/**
 * Payload hand-off between the PC fetch leg and the hosted watch run
 * (design D5/D9/D13): the PC loop writes fetched raw posts to
 * state/linkedin-posts.json (atomic temp+rename, the state.ts precedent)
 * and pushes that single path; the hosted run reads it here.
 *
 * Four failure classes, ALL degrading to threads-only runs (D13 — a
 * LinkedIn fault can never fail a run; the alarm duty for leg faults
 * lives where the fault originates, the PC leg):
 *
 * - absent (ENOENT): the PC-off / never-ran state is NORMAL — one quiet
 *   log line, leg "absent".
 * - stale (over PAYLOAD_MAX_AGE_MS): one log line naming the age, leg
 *   "stale".
 * - malformed envelope (invalid JSON, unknown version, posts not an
 *   array): one warn naming the reason, leg "malformed".
 * - malformed rows: dropped + counted, leg stays "ok".
 *
 * Every class stays operator-visible in run logs; nothing is silent.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LINKEDIN_PAYLOAD_PATH } from "./config.js";
import { stateTempPath } from "./state.js";
import type { Post } from "./types.js";

/** Envelope version; bump on a shape change, keep the reader tolerant. */
export const PAYLOAD_VERSION = 1;

/**
 * The jittered wake cadence's worst case (33 minutes) plus margin: a
 * payload older than this reads as stale (design 2026-11-09; was twice
 * the old 10-minute cadence).
 */
export const PAYLOAD_MAX_AGE_MS = 2_400_000;

/** What the PC loop writes: a self-describing, versioned post envelope. */
export interface PayloadEnvelope {
  version: number;
  writtenAt: string;
  posts: Post[];
}

/** LinkedIn leg state for the heartbeat/digest lines (D6/D13). */
export type LegStatus = "ok" | "stale" | "absent" | "malformed";

/** The leg state minus the posts — rides HeartbeatStats and the digest. */
export interface LegLine {
  status: LegStatus;
  /** Age/reason detail for the log and email lines; absent-state omits it. */
  detail?: string;
}

/** What the watch-side reader returns: posts + the leg state (D6/D13). */
export interface PayloadRead {
  posts: Post[];
  /** The leg state; mirrors LegLine.status for the heartbeat/digest lines. */
  leg: LegStatus;
  /** Age/reason detail; omitted when none rides (exactOptionalPropertyTypes). */
  detail?: string;
}

const ACTIVITY_URN_RE = /^urn:li:activity:\d{9,}$/;

/** Per-row shape contract: a row that fails any check is dropped + counted. */
function isValidRow(value: unknown): value is Post {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.platform === "linkedin" &&
    typeof row.id === "string" &&
    ACTIVITY_URN_RE.test(row.id) &&
    typeof row.text === "string" &&
    row.text.length > 0 &&
    typeof row.author === "string" &&
    row.author.length > 0 &&
    typeof row.permalink === "string" &&
    row.permalink.length > 0 &&
    typeof row.timestamp === "string" &&
    !Number.isNaN(Date.parse(row.timestamp))
  );
}

/**
 * Write the payload atomically (sibling unique temp + rename, the
 * writeStateAtomic shape): a crashed tick never leaves a partial payload.
 */
export async function writePayloadAtomic(
  posts: readonly Post[],
  filePath: string = LINKEDIN_PAYLOAD_PATH,
  now: () => number = Date.now,
): Promise<void> {
  const envelope: PayloadEnvelope = {
    version: PAYLOAD_VERSION,
    writtenAt: new Date(now()).toISOString(),
    posts: [...posts],
  };
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, now());
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort temp cleanup
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`payload: atomic write failed for ${filePath}: ${message}`);
  }
}

/**
 * Read + validate the payload. Never throws (D13): every failure class
 * resolves to a threads-only PayloadRead with its leg state and log line.
 * `now` is injectable so the staleness boundary is testable.
 */
export async function readPayloadPosts(
  filePath: string = LINKEDIN_PAYLOAD_PATH,
  now: () => number = Date.now,
): Promise<PayloadRead> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT"
    ) {
      console.log("linkedin: no payload — threads-only run");
      return { posts: [], leg: "absent" };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`linkedin: payload unreadable — ${message} — threads-only run`);
    return { posts: [], leg: "malformed", detail: `unreadable: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`linkedin: payload not valid JSON — ${message} — threads-only run`);
    return { posts: [], leg: "malformed", detail: `not valid JSON: ${message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn("linkedin: payload is not a JSON object — threads-only run");
    return { posts: [], leg: "malformed", detail: "envelope is not an object" };
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== PAYLOAD_VERSION) {
    const detail = `unknown version ${String(envelope.version)} (expected ${PAYLOAD_VERSION})`;
    console.warn(`linkedin: payload ${detail} — threads-only run`);
    return { posts: [], leg: "malformed", detail };
  }

  const writtenAt = envelope.writtenAt;
  const writtenMs = typeof writtenAt === "string" ? Date.parse(writtenAt) : Number.NaN;
  const ageMs = now() - writtenMs;
  if (!Number.isFinite(writtenMs) || !Number.isFinite(ageMs) || ageMs > PAYLOAD_MAX_AGE_MS) {
    const age = Number.isFinite(ageMs)
      ? `${Math.max(0, Math.round(ageMs / 3_600_000))}h old`
      : "carries an unreadable writtenAt";
    console.log(`linkedin: payload stale (${age}) — threads-only run`);
    return { posts: [], leg: "stale", detail: `payload ${age}` };
  }

  if (!Array.isArray(envelope.posts)) {
    console.warn("linkedin: payload posts is not an array — threads-only run");
    return { posts: [], leg: "malformed", detail: "posts is not an array" };
  }
  const posts: Post[] = [];
  let dropped = 0;
  for (const row of envelope.posts) {
    if (isValidRow(row)) {
      posts.push(row);
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`linkedin: payload carried ${dropped} malformed row(s) — dropped`);
  }
  return {
    posts,
    leg: "ok",
    detail: `payload ${Math.max(0, Math.floor(ageMs / 60_000))} min old`,
  };
}
```

#### 3. tests/linkedin-fetch.test.ts
**File**: `tests/linkedin-fetch.test.ts`
**Changes**: MODIFY — classifier 429 row, FR-3 one-page pin, FR-2 pace pins (floor + seeded band), reserve-before-sleep burst pin, FR-5 shuffle transcripts (rng=0 gives [B,C,A], near-one identity, seeded oracle), halt-channel pins (throw, stop-claiming, halt outranks leg-dead in the parked race), FR-4 unparsable tick-abort pins, unstamped COOKIES at Slice 3 (the stamp lands via the Slice 5 delta, Phase 5).

```typescript
/**
 * Offline suite for the voyager fetch leg.
 *
 * Covers: the §13.3 fault-classifier table incl. the 3xx redirect-loop rows
 * (live-observed 2026-11-05, Phase 8); the curl transport over a fake
 * exec (header set, status-sentinel parse, exec failure (message sanitized — no headers), missing-binary
 * fail-visible with BOTH Phase 9 remedies, --impersonate chrome116 pin,
 * user-agent absence pin); the transport resolver accept/reject matrix; the runPool
 * surface walk over a scripted VoyagerGet — partial-page stop, exhaustion
 * stop, input-order reassembly under out-of-order completion, per-surface
 * fault skip, leg-dead drain-then-throw with sibling stop (the scripted-302
 * live-regression pin), leg-dead-beats-faults, all-faulted tagged throw vs
 * partial-fault degrade, pacing-gate spacing, drop-count warn,
 * empty-is-success, transport disposal. Zero
 * network and zero real sleeps: the VoyagerGet seam is the test double and
 * the multi-GET walk tests inject controlled sleeps; the playwright adapter
 * stays unexercised (the chromiumContextFactory precedent — the seam
 * carries the tests).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type LinkedinSurface,
  PACE_MAX_MS,
  PACE_MIN_MS,
  PAGE_SIZE,
  type VoyagerGet,
  type VoyagerResponse,
  allSurfacesFaulted,
  classifyFault,
  createCurlTransport,
  fetchLinkedInPosts,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const COOKIES: LinkedInCookies = {
  liAt: "AQE-test",
  jsessionId: "ajax:0123456789012345678",
};

/** An instant sleepFn: multi-GET walk tests pin paging order, not pacing. */
const instantSleep = async (): Promise<void> => undefined;

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Build a §6-shaped 200 body carrying the given activity ids. */
const okBody = (ids: readonly string[]): string =>
  JSON.stringify({
    data: {
      searchDashClustersByAll: {
        elements: [
          {
            items: ids.map((id) => ({
              item: {
                searchFeedUpdate: {
                  update: {
                    metadata: { backendUrn: `urn:li:activity:${id}` },
                    commentary: { text: { text: `post ${id}` } },
                    actor: { name: { text: `author ${id}` } },
                    socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                  },
                },
              },
            })),
          },
        ],
      },
    },
    included: [],
  });

const page = (ids: readonly string[], status = 200, body?: string): VoyagerResponse => ({
  status,
  body: body ?? okBody(ids),
});

/** Distinct activity ids; second-resolution spacing keeps them unique. */
const idAt = (n: number): string => (BigInt(Date.UTC(2026, 9, 26, 9, 14, n)) << 22n).toString();
const FULL_PAGE: readonly string[] = Array.from({ length: PAGE_SIZE }, (_, i) => idAt(i));

const startOf = (url: string): string => /start:(\d+)/.exec(url)?.[1] ?? "";
/** The keyword token as it rides the URL (already URL-encoded); routes match raw. */
const surfaceOf = (url: string): string => /keywords:([^,)]+)/.exec(url)?.[1] ?? "";

/** Scripted transport: responds per URL matcher; records every call. */
function scriptGet(
  routes: ReadonlyArray<{
    match: (url: string) => boolean;
    respond: () => VoyagerResponse | Promise<VoyagerResponse>;
  }>,
): VoyagerGet & { calls: string[] } {
  const calls: string[] = [];
  const get: VoyagerGet = async (url) => {
    calls.push(url);
    const route = routes.find((candidate) => candidate.match(url));
    if (route === undefined) throw new Error(`unexpected GET: ${url}`);
    return route.respond();
  };
  return Object.assign(get, { calls });
}

/** A manually-resolved promise: stages one GET response for the pacing test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("classifyFault (§13.3 table)", () => {
  it("classifies the CSRF-403 text body as leg-dead", () => {
    const fault = classifyFault(403, "CSRF check failed.");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /CSRF/);
  });

  it("classifies a Cloudflare challenge 403 as leg-dead", () => {
    const fault = classifyFault(403, "<html>Just a moment... cf-ray: abc</html>");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /challenge/);
  });

  it("classifies 401 {status:401} as leg-dead (dead li_at)", () => {
    const fault = classifyFault(401, '{"status":401}');
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /li_at/);
  });

  it("classifies the bare 400 on the finder as leg-dead (no member context)", () => {
    const fault = classifyFault(400, '{"status":400}');
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /member context|dead session/);
  });

  it("classifies the graphql-envelope 400 as a fault (bad variables — our bug)", () => {
    const fault = classifyFault(400, '{"data":{"status":400},"included":[]}');
    assert.equal(fault.kind, "fault");
    assert.match(fault.reason, /bad variables/);
  });

  it("classifies 500 as a fault (queryId expiry, §15)", () => {
    const fault = classifyFault(500, "Internal Server Error");
    assert.equal(fault.kind, "fault");
    assert.match(fault.reason, /queryId/);
  });

  it("classifies any other non-200 as a fault", () => {
    assert.equal(classifyFault(503, "").kind, "fault");
  });

  it("classifies 429 as a HALT, never leg-dead (the account must slow down)", () => {
    const fault = classifyFault(429, "");
    assert.equal(fault.kind, "halt");
    assert.match(fault.reason, /429/);
    assert.equal(isLegDead(fault), false);
  });

  it("classifies 302 as leg-dead naming the redirect loop (live-observed 2026-11-05)", () => {
    const fault = classifyFault(302, "");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /HTTP 302 redirect loop/);
    assert.match(fault.reason, /refresh the cookie file/);
  });

  it("pins the whole 3xx band: 301 and 307 are leg-dead too", () => {
    assert.equal(classifyFault(301, "").kind, "legDead");
    assert.equal(classifyFault(307, "").kind, "legDead");
  });

  it("classifies a 302 carrying a body as leg-dead (the body never matters)", () => {
    const fault = classifyFault(302, "<html>moved temporarily</html>");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /redirect loop/);
  });
});

describe("createCurlTransport", () => {
  const RESPONSE_BODY = '{"data":{"searchDashClustersByAll":{"elements":[]}},"included":[]}';

  it("passes the URL, the §3/§10 header set, and parses the status sentinel", async () => {
    const execCalls: Array<{ file: string; args: readonly string[] }> = [];
    const make = createCurlTransport(
      COOKIES,
      { CURL_IMPERSONATE_BIN: "curl-chrome" },
      async (file, args) => {
        execCalls.push({ file, args });
        return { stdout: `${RESPONSE_BODY}\n___CURL_STATUS:200` };
      },
    );
    const transport = await make();
    const response = await transport.get("https://www.linkedin.com/voyager/api/graphql?x=1");

    assert.equal(response.status, 200);
    assert.equal(response.body, RESPONSE_BODY);
    assert.equal(execCalls.length, 1);
    const call = execCalls[0];
    assert.equal(call?.file, "curl-chrome");
    assert.ok(call?.args.includes("https://www.linkedin.com/voyager/api/graphql?x=1"));
    const headers = (call?.args ?? []).filter((arg, index) => call?.args[index - 1] === "-H");
    assert.ok(headers.includes('cookie: li_at=AQE-test; JSESSIONID="ajax:0123456789012345678"'));
    assert.ok(headers.includes("csrf-token: ajax:0123456789012345678"));
    assert.ok(headers.includes("x-restli-protocol-version: 2.0.0"));
    assert.ok(headers.includes("accept: application/json"));
    // Phase 9: the pinned lexiforest profile rides the args, adjacent pair;
    // the profile OWNS the UA, so no user-agent pair may ride the -H values.
    const curlArgs = call?.args ?? [];
    const impersonateAt = curlArgs.indexOf("--impersonate");
    assert.ok(impersonateAt >= 0);
    assert.equal(curlArgs[impersonateAt + 1], "chrome116");
    assert.ok(headers.every((header) => !/^user-agent:/i.test(header)));
    // Phase 8's 3xx leg-dead branch only sees the status because curl does
    // NOT follow redirects: one -L/--location in the arg array would follow
    // the dead 302 loop and republish the b2 empty-payload failure via curl.
    assert.ok(call?.args.every((arg) => arg !== "-L" && arg !== "--location"));
  });

  it("throws a surface fault (not leg-dead) when the exec fails — message sanitized, never the command line", async () => {
    // Revise 2026-11-10: a live probe leaked the whole cookie jar because
    // Node's execFile error message embeds the full command line. The
    // rejection here carries that shape (li_at in .message, code + stderr
    // fields); the thrown message must hold ONLY exit code + stderr.
    const make = createCurlTransport(COOKIES, { CURL_IMPERSONATE_BIN: "curl-chrome" }, async () => {
      throw Object.assign(
        new Error('Command failed: curl-chrome --impersonate chrome116 -H cookie: li_at=SECRET; JSESSIONID="ajax:x"\n'),
        { code: 7, stderr: "curl: (7) Could not resolve host: www.linkedin.com" },
      );
    });
    const transport = await make();
    await assert.rejects(
      () => transport.get("https://x"),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /curl exec failed \(exit 7\): curl: \(7\) Could not resolve host/);
        assert.ok(!message.includes("li_at"), "no cookie value may reach the message");
        assert.ok(!message.includes("-H"), "no header flags may reach the message");
        assert.ok(!message.includes("SECRET"), "no leaked literal may reach the message");
        return true;
      },
    );
    // The other real execFile failure shape: a missing binary rejects with
    // a STRING code ("ENOENT") and no stderr — the one fact the operator
    // needs must survive sanitization.
    const missingBin = createCurlTransport(
      COOKIES,
      { CURL_IMPERSONATE_BIN: "curl-chrome" },
      async () => {
        throw Object.assign(new Error("spawn curl-chrome ENOENT"), { code: "ENOENT" });
      },
    );
    const gone = await missingBin();
    await assert.rejects(
      () => gone.get("https://x"),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /curl exec failed \(exit ENOENT\): no stderr captured/);
        assert.ok(!message.includes("spawn"), "the raw spawn message may not reach the message");
        return true;
      },
    );
  });

  it("fails visibly naming the variable when CURL_IMPERSONATE_BIN is unset", async () => {
    const make = createCurlTransport(COOKIES, {});
    await assert.rejects(() => make(), /CURL_IMPERSONATE_BIN is not set/);
  });

  it("names both remedies when CURL_IMPERSONATE_BIN is unset (Phase 9: setup-curl + the playwright line)", async () => {
    const make = createCurlTransport(COOKIES, {});
    await assert.rejects(
      () => make(),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /CURL_IMPERSONATE_BIN is not set/); // the Phase 3 prefix pin survives unchanged
        assert.match(message, /npm run setup-curl/);
        assert.match(message, /LINKEDIN_TRANSPORT=playwright in \.env/);
        return true;
      },
    );
  });
});

describe("resolveLinkedInTransport", () => {
  it("opens the curl transport by default over the injected exec", async () => {
    const transport = await resolveLinkedInTransport(
      { CURL_IMPERSONATE_BIN: "curl-chrome" },
      COOKIES,
      async () => ({ stdout: "\n___CURL_STATUS:200" }),
    );
    const response = await transport.get("https://x");
    assert.equal(response.status, 200);
    await transport.dispose();
  });

  it("opens the curl transport when LINKEDIN_TRANSPORT is explicitly curl", async () => {
    const transport = await resolveLinkedInTransport(
      { LINKEDIN_TRANSPORT: "curl", CURL_IMPERSONATE_BIN: "curl-chrome" },
      COOKIES,
      async () => ({ stdout: "\n___CURL_STATUS:200" }),
    );
    const response = await transport.get("https://x");
    assert.equal(response.status, 200);
    await transport.dispose();
  });

  it("throws naming the allowed values on an unknown LINKEDIN_TRANSPORT", async () => {
    await assert.rejects(
      () =>
        resolveLinkedInTransport(
          { LINKEDIN_TRANSPORT: "wget", CURL_IMPERSONATE_BIN: "curl-chrome" },
          COOKIES,
          async () => ({ stdout: "" }),
        ),
      /LINKEDIN_TRANSPORT="wget" is not one of: curl, playwright/,
    );
  });
});

describe("fetchLinkedInPosts (runPool walk)", () => {
  const oneSurface: readonly LinkedinSurface[] = [{ type: "linkedin", value: "#hiring react" }];

  it("stops on a partial page and returns the parsed posts in input order", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([idAt(1), idAt(2), idAt(3)]) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.equal(get.calls.length, 1);
    assert.deepEqual(
      posts.map((post) => post.id),
      [idAt(1), idAt(2), idAt(3)].map((id) => `urn:li:activity:${id}`),
    );
  });

  it("fetches ONE page per surface per tick — a full page never pages again (FR-3)", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page(FULL_PAGE) },
      { match: (url) => startOf(url) === "50", respond: () => page([]) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get, instantSleep);
    assert.equal(get.calls.length, 1); // the exhaustion route never fires
    assert.equal(posts.length, PAGE_SIZE);
    assert.equal(get.calls.filter((url) => startOf(url) === "50").length, 0);
  });

  it("paces voyager GETs a randomized 5-15 s apart through the injected rng", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([idAt(1)]) },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    // rng() === 0 pins the floor exactly: 5000 ms. Two surfaces — the cap
    // means one GET each, so A's GET is free and B's waits the floor.
    await fetchLinkedInPosts(
      [
        { type: "linkedin", value: "#a" },
        { type: "linkedin", value: "#b" },
      ],
      COOKIES,
      get,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
      () => 0,
    );
    assert.deepEqual(sleeps, [PACE_MIN_MS]);
    assert.equal(get.calls.length, 2);
  });

  it("keeps every pacing draw inside [5 s, 15 s) under a seeded rng", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const five: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
      { type: "linkedin", value: "#c" },
      { type: "linkedin", value: "#d" },
      { type: "linkedin", value: "#e" },
    ];
    const get = scriptGet([{ match: () => true, respond: () => page([idAt(1)]) }]);
    await fetchLinkedInPosts(
      five,
      COOKIES,
      get,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
      seededRng(2026_11_09),
    );
    assert.equal(sleeps.length, 4); // first GET free; four reservations
    for (const ms of sleeps) {
      assert.ok(ms >= PACE_MIN_MS && ms < PACE_MAX_MS, `out of band: ${ms}`);
    }
  });

  it("reserves the pacing slot before sleeping, so concurrent waiters never share a wake time", async () => {
    // The width-2 walk must never fire a burst: each waiter reserves its
    // slot SYNCHRONOUSLY on entry (reserve-before-sleep). Deferred sleeps
    // + deferred GETs make the reservation order observable. rng() === 0
    // shuffles [A, B] to [B, A], so B claims the free slot and A waits.
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const sleeps: number[] = [];
    const heldSleeps: Array<() => void> = [];
    const sleepFn = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => {
        heldSleeps.push(resolve);
      });
    };
    let tick = 0;
    const getA = deferred<VoyagerResponse>();
    const getB = deferred<VoyagerResponse>();
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => getA.promise },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => getB.promise },
    ]);
    const walk = fetchLinkedInPosts(
      surfaces,
      COOKIES,
      get,
      sleepFn,
      () => tick,
      () => 0,
    );
    const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

    // B's GET is open on the free slot; A reserved the NEXT slot while B's
    // GET was still in flight — call starts spaced apart, never together.
    await flush();
    assert.deepEqual(sleeps, [5000]);

    // B's GET answers; A's in-flight reservation is untouched — no burst.
    getB.resolve(page([idAt(2)]));
    await flush();
    assert.deepEqual(sleeps, [5000]);

    // Release A's sleep: A GETs, both surfaces complete.
    heldSleeps[0]?.();
    tick += 5000;
    await flush();
    getA.resolve(page([idAt(1)]));
    const posts = await walk;
    assert.equal(get.calls.length, 2);
    // Output order stays structural (input order) despite the [B, A] dispatch.
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
  });

  it("reassembles two surfaces in input order under out-of-order completion", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15)); // B finishes first
          return page([idAt(1)]);
        },
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
  });

  it("skips a faulted surface (warn) and keeps the sibling's posts", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 400, '{"data":{"status":400},"included":[]}'),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(2)}`],
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a FAILED — .*bad variables/.test(line)));
  });

  it("drains then throws leg-dead once on page 0, and nothing publishes", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 400, '{"status":400}'), // bare 400 = leg dead
      },
      {
        match: (url) => surfaceOf(url) === "%23b",
        respond: () => page(FULL_PAGE),
      },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    // Tick-abort semantics: the walk THREW, so no surface's posts publish.
    // The post-wait drain check may starve the sibling's GET entirely —
    // a GET saved — so only the flag is pinned, never a call count.
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /dead session/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a LEG DEAD/.test(line)));
  });

  it("drains then throws leg-dead once on a scripted page-0 302 (live-regression pin)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 302, ""), // the live-observed dead-session presentation
      },
      {
        match: (url) => surfaceOf(url) === "%23b",
        respond: () => page(FULL_PAGE),
      },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /redirect loop/);
    assert.equal(isAllSurfacesFaulted(caught), false); // leg-dead, not the generic no-op
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a LEG DEAD/.test(line)));
  });

  it("leg-dead beats faults: 302 + 500 surfaces throw leg-dead, not AllSurfacesFaulted", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([], 302, "") },
      {
        match: (url) => surfaceOf(url) === "%23b",
        respond: () => page([], 500, "Internal Server Error"),
      },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught)); // the drain check precedes the all-faulted throw
    assert.equal(isAllSurfacesFaulted(caught), false);
  });

  it("aborts the whole walk on an unparsable 200 (FR-4 ratified): leg-dead, never all-faulted", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([], 200, "<html>weird</html>") },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(oneSurface, COOKIES, get);
    } catch (error) {
      caught = error;
    }
    // FR-4 (ratified 2026-11-09): a changed response shape stops the
    // machine — the leg-dead channel's episode marker emails once per
    // episode and auto-clears on the next good tick.
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /unparsable 200 body/);
    assert.equal(isAllSurfacesFaulted(caught), false);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#hiring react LEG DEAD/.test(line)));
  });

  it("discards the tick when a surface goes unparsable, sibling included (tick abort)", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 200, "<html>weird</html>"),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page(FULL_PAGE) },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    // FR-4: the walk throws on the unparsable 200 — even a healthy
    // sibling's posts are discarded (nothing publishes from a stopped tick).
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /unparsable 200 body/);
  });

  it("degrades on 1-of-2 faulted: the fine-empty survivor publishes [] with no throw", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 500, "Internal Server Error"),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([]) }, // fine-empty survivor
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(posts, []); // partial fault degrades; defb8af preserved
    const warned = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(warned.some((line) => /linkedin\/#a FAILED/.test(line)));
    const logged = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(logged.some((line) => /linkedin\/#b OK — 0 post\(s\)/.test(line)));
  });

  it("throws AllSurfacesFaulted with faulted === 2 when both surfaces fault", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 500, "Internal Server Error"),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([], 503, "") },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isAllSurfacesFaulted(caught));
    assert.equal((caught as { faulted?: number }).faulted, 2);
    assert.match((caught as Error).message, /all 2 surface\(s\) faulted/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.filter((line) => /FAILED/.test(line)).length, 2);
  });

  it("counts dropped rows in a warn and keeps the valid rest", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const raw = JSON.stringify({
      data: {
        searchDashClustersByAll: {
          elements: [
            {
              items: [
                {
                  item: {
                    searchFeedUpdate: {
                      update: { metadata: { backendUrn: "urn:li:activity:7523282112511242241" } },
                    },
                  },
                },
                ...FULL_PAGE.slice(0, 2).map((id) => ({
                  item: {
                    searchFeedUpdate: {
                      update: {
                        metadata: { backendUrn: `urn:li:activity:${id}` },
                        commentary: { text: { text: `post ${id}` } },
                        actor: { name: { text: `author ${id}` } },
                        socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                      },
                    },
                  },
                })),
              ],
            },
          ],
        },
      },
      included: [],
    });
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => ({ status: 200, body: raw }) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.equal(posts.length, 2);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /dropped 1 malformed row/.test(line)));
  });

  it("treats a zero-post surface as success (defb8af: empty is an outcome)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const get = scriptGet([{ match: (url) => startOf(url) === "0", respond: () => page([]) }]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.deepEqual(posts, []);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#hiring react OK — 0 post\(s\)/.test(line)));
  });

  it("disposes an opened Transport (not a bare VoyagerGet) in finally", async () => {
    let disposed = false;
    const transport = {
      get: scriptGet([{ match: () => true, respond: () => page([]) }]),
      dispose: async () => {
        disposed = true;
      },
    };
    await fetchLinkedInPosts(oneSurface, COOKIES, transport);
    assert.equal(disposed, true);
  });

  it("exposes the tagged leg-dead guard", () => {
    assert.ok(isLegDead(legDead("because")));
    assert.equal(isLegDead(new Error("plain")), false);
  });

  it("exposes the tagged all-faulted guard (judge-rotation idiom)", () => {
    const error = allSurfacesFaulted(2);
    assert.ok(isAllSurfacesFaulted(error));
    assert.equal(error.faulted, 2);
    assert.equal(isAllSurfacesFaulted(new Error("plain")), false);
    assert.equal(isAllSurfacesFaulted(legDead("because")), false);
  });
});

describe("fetchLinkedInPosts surface shuffle (FR-5)", () => {
  it("dispatches in the shuffled order while output stays input order (rng=0 -> [B, C, A])", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
      { type: "linkedin", value: "#c" },
    ];
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([idAt(1)]) },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
      { match: (url) => surfaceOf(url) === "%23c", respond: () => page([idAt(3)]) },
    ]);
    const posts = await fetchLinkedInPosts(
      surfaces,
      COOKIES,
      get,
      instantSleep,
      () => 0,
      () => 0,
    );
    // rng() === 0 drives every Fisher-Yates swap to index 0: two swaps
    // (C<->A, then B<->C) take [A, B, C] to [B, C, A] — the GET transcript
    // proves the shuffle happened.
    assert.deepEqual(
      get.calls.map((url) => surfaceOf(url)),
      ["%23b", "%23c", "%23a"],
    );
    // Output order is structural (input order), independent of dispatch.
    assert.deepEqual(
      posts.map((post) => post.id),
      [idAt(1), idAt(2), idAt(3)].map((id) => `urn:li:activity:${id}`),
    );
  });

  it("preserves input order under a near-one rng (every swap lands on itself)", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([idAt(1)]) },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(
      surfaces,
      COOKIES,
      get,
      instantSleep,
      () => 0,
      () => 0.999999999,
    );
    assert.deepEqual(
      get.calls.map((url) => surfaceOf(url)),
      ["%23a", "%23b"],
    );
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
  });

  it("pins the seeded Fisher-Yates dispatch transcript (the transcript IS the oracle)", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
      { type: "linkedin", value: "#c" },
    ];
    // Recompute the permutation with the same seed and the same swap loop.
    const order = surfaces.map((surface) => surface.value);
    const rng = seededRng(2026_11_09);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([]) },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([]) },
      { match: (url) => surfaceOf(url) === "%23c", respond: () => page([]) },
    ]);
    await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep, () => 0, seededRng(2026_11_09));
    assert.deepEqual(
      get.calls.map((url) => surfaceOf(url)),
      order.map((value) => encodeURIComponent(value)),
    );
  });
});

describe("fetchLinkedInPosts halt channel (429)", () => {
  it("throws the tagged HaltError on a 429, never leg-dead or all-faulted", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const get = scriptGet([{ match: () => true, respond: () => page([], 429, "") }]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts([{ type: "linkedin", value: "#hiring react" }], COOKIES, get);
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.equal(isLegDead(caught), false);
    assert.equal(isAllSurfacesFaulted(caught), false);
    assert.match((caught as Error).message, /429/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#hiring react HALT/.test(line)));
  });

  it("stops claiming on a 429: no GET fires after the flag", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
      { type: "linkedin", value: "#c" },
    ];
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([], 429, "") },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
      { match: (url) => surfaceOf(url) === "%23c", respond: () => page([idAt(3)]) },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        surfaces,
        COOKIES,
        get,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    // rng=0 dispatch order [B, C, A]: B GETs fine, C GETs fine, A's 429
    // flags the halt — the walk throws and C's posts are discarded.
    assert.ok(isHalt(caught));
    assert.equal(get.calls.length, 3);
  });

  it("halt outranks leg-dead at the join: a 429 + a dead session throws HaltError", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" }, // 429
      { type: "linkedin", value: "#b" }, // 302
    ];
    // Park BOTH responses: both GETs issue (rng=0 dispatches [B, A]), THEN
    // the flags set — the both-flags race is the only way this join
    // priority is reachable (a flag set before a sibling's GET starves
    // that sibling via the post-wait drain check, and the lone flag wins).
    const getA = deferred<VoyagerResponse>();
    const getB = deferred<VoyagerResponse>();
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => getA.promise },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => getB.promise },
    ]);
    // Capture the outcome FIRST: the walk rejects while the test is still
    // in its flush sequence, and an unhandled rejection would fail the
    // test before the try block ever runs.
    const outcome = fetchLinkedInPosts(
      surfaces,
      COOKIES,
      get,
      instantSleep,
      () => 0,
      () => 0,
    ).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
    await flush();
    getB.resolve(page([], 302, "")); // B flags leg-dead first
    await flush();
    getA.resolve(page([], 429, "")); // A's in-flight response still classifies
    await flush();
    const settled = await outcome;
    assert.equal(settled.ok, false);
    const caught = settled.ok ? undefined : settled.error;
    assert.ok(isHalt(caught)); // the account-safety terminal outranks self-heal
    assert.equal(isLegDead(caught), false);
  });

  it("exposes the tagged halt guard", () => {
    assert.ok(isHalt(halt("because")));
    assert.equal(isHalt(new Error("plain")), false);
    assert.equal(isHalt(legDead("because")), false);
  });
});

describe("Post shape (walk output)", () => {
  it("maps a parsed row to the normalized Post contract", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([idAt(5)]) },
    ]);
    const posts = await fetchLinkedInPosts(
      [{ type: "linkedin", value: "#x" }] as const,
      COOKIES,
      get,
    );
    const first = posts[0] as Post;
    assert.equal(first.platform, "linkedin");
    assert.equal(first.text, `post ${idAt(5)}`);
    assert.equal(first.author, `author ${idAt(5)}`);
    assert.equal(first.permalink, `https://www.linkedin.com/posts/x-${idAt(5)}`);
    assert.equal(first.timestamp, new Date(Number(BigInt(idAt(5)) >> 22n)).toISOString());
  });
});
```

#### 4. tests/linkedin-payload.test.ts
**File**: `tests/linkedin-payload.test.ts`
**Changes**: MODIFY — the staleness boundary pins move to the 40-minute PAYLOAD_MAX_AGE_MS: exactly-at-boundary ok, boundary+1 stale across the injected clock; the four failure-class pins and the atomic round trip stand.

```typescript
/**
 * Offline suite for the payload hand-off (design D9/D13).
 *
 * Pins all four failure classes — absent (ENOENT → quiet null-equivalent),
 * stale (over-age across the injected-clock boundary), malformed envelope
 * (invalid JSON / unknown version / posts not an array), malformed rows
 * (drop + count) — plus the atomic round trip (write → read, no temp
 * litter). The reader cannot silently drop rows or throw while this suite
 * is green.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import {
  PAYLOAD_MAX_AGE_MS,
  PAYLOAD_VERSION,
  type PayloadEnvelope,
  readPayloadPosts,
  writePayloadAtomic,
} from "../src/linkedin-payload.js";
import type { Post } from "../src/types.js";

const T0 = Date.UTC(2026, 9, 26, 9, 14, 0);
const MINUTE = 60_000;

const post = (n: number): Post => ({
  platform: "linkedin",
  id: `urn:li:activity:${(BigInt(T0 - n * MINUTE) << 22n).toString()}`,
  text: `post ${n}`,
  author: `author ${n}`,
  permalink: `https://www.linkedin.com/posts/x-${n}`,
  timestamp: new Date(T0 - n * MINUTE).toISOString(),
});

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function payloadPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-payload-"));
  return join(dir, name);
}

async function seedEnvelope(path: string, envelope: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

const envelopeFor = (posts: Post[], writtenAt = T0): PayloadEnvelope => ({
  version: PAYLOAD_VERSION,
  writtenAt: new Date(writtenAt).toISOString(),
  posts,
});

describe("writePayloadAtomic / readPayloadPosts round trip", () => {
  it("round-trips the envelope: posts survive, leg ok, detail carries the age", async () => {
    const path = await payloadPath("round-trip.json");
    await writePayloadAtomic([post(1), post(2)], path, () => T0);
    const read = await readPayloadPosts(path, () => T0 + 1 * MINUTE);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(1), post(2)]);
    assert.equal(read.detail, "payload 1 min old");
  });

  it("leaves no temp litter behind (atomic write)", async () => {
    const path = await payloadPath("atomic.json");
    await writePayloadAtomic([post(3)], path, () => T0);
    const entries = await readdir(join(path, ".."));
    assert.ok(entries.every((entry) => !entry.endsWith(".tmp")));
  });

  it("uses the fixed repo path beside STATE_PATH by default", () => {
    assert.equal(LINKEDIN_PAYLOAD_PATH, "state/linkedin-posts.json");
  });

  it("pins the 40-minute staleness window (the 33-minute worst-case wake plus margin)", () => {
    assert.equal(PAYLOAD_MAX_AGE_MS, 2_400_000);
  });
});

describe("readPayloadPosts failure classes (D13)", () => {
  it("class: absent — ENOENT resolves quietly to a threads-only read", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const read = await readPayloadPosts(await payloadPath("never-written.json"), () => T0);
    assert.deepEqual(read, { posts: [], leg: "absent" });
    assert.equal(read.detail, undefined);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: no payload — threads-only run/.test(line)));
  });

  it("class: stale — over-age resolves to leg stale naming the age", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const path = await payloadPath("stale.json");
    await seedEnvelope(path, envelopeFor([post(1)]));
    const read = await readPayloadPosts(path, () => T0 + PAYLOAD_MAX_AGE_MS + 1);
    assert.equal(read.leg, "stale");
    assert.deepEqual(read.posts, []);
    assert.match(read.detail ?? "", /payload .*h old/);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: payload stale/.test(line)));
  });

  it("stale boundary: a payload exactly PAYLOAD_MAX_AGE_MS old is still ok", async () => {
    const path = await payloadPath("boundary.json");
    await seedEnvelope(path, envelopeFor([post(1)]));
    const read = await readPayloadPosts(path, () => T0 + PAYLOAD_MAX_AGE_MS);
    assert.equal(read.leg, "ok");
  });

  it("class: malformed — invalid JSON resolves to leg malformed naming the reason", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await payloadPath("bad-json.json");
    await writeFile(path, "{not json", "utf8");
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /not valid JSON/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: payload not valid JSON/.test(line)));
  });

  it("class: malformed — an unknown version is rejected, not floored", async () => {
    const path = await payloadPath("bad-version.json");
    await seedEnvelope(path, { ...envelopeFor([post(1)]), version: 99 });
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /unknown version 99/);
  });

  it("class: malformed — a non-object envelope is rejected", async () => {
    const path = await payloadPath("not-object.json");
    await seedEnvelope(path, [post(1)]);
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /not an object/);
  });

  it("class: malformed — a posts field that is not an array is rejected", async () => {
    const path = await payloadPath("posts-not-array.json");
    await seedEnvelope(path, {
      version: PAYLOAD_VERSION,
      writtenAt: new Date(T0).toISOString(),
      posts: "nope",
    });
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /posts is not an array/);
  });

  it("class: rows — malformed rows are dropped and counted, leg stays ok", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await payloadPath("mixed-rows.json");
    const junk = {
      platform: "linkedin",
      id: "not-a-urn",
      text: "",
      author: "a",
      permalink: "p",
      timestamp: "nope",
    };
    await seedEnvelope(path, envelopeFor([post(1), junk as unknown as Post, post(2)]));
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(1), post(2)]);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /payload carried 1 malformed row/.test(line)));
  });

  it("never throws on any garbage input", async () => {
    const path = await payloadPath("garbage.json");
    await writeFile(path, "\x00\x01binary junk", "utf8");
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.deepEqual(read.posts, []);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes for the slice: `npx tsc --noEmit --skipLibCheck --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --module nodenext --moduleResolution nodenext --target es2022 --lib es2023 --types node src/linkedin-fetch.ts src/linkedin-payload.ts tests/linkedin-fetch.test.ts tests/linkedin-payload.test.ts` (--skipLibCheck added 2026-11-10: the playwright-typed file pulls playwright-core's .d.ts, which needs DOM libs — the Phase 5 precedent; without it the slice fails on node_modules, not our code)
- [x] Suites pass: `npx tsx --test tests/linkedin-fetch.test.ts tests/linkedin-payload.test.ts` (45 + 13 tests — re-measured 2026-11-10 after the leak-pin rewrite: 58 total, 0 fail; the leak pin replaced the old exec-failure `it` in place)
- [x] Lint passes: `npx biome check src/linkedin-fetch.ts src/linkedin-payload.ts tests/linkedin-fetch.test.ts tests/linkedin-payload.test.ts`
- [x] Classifier pin green: `classifyFault(429, ...)` reads kind `halt` carrying `HALT_RATE_LIMIT_REASON`; 503 stays a fault
- [x] Cap pin green (FR-3): a full 50-post page triggers exactly ONE GET; the start:50 route never fires
- [x] Pace pins green (FR-2): rng=0 gaps equal `PACE_MIN_MS`; a 5-surface seeded sweep stays inside [5 s, 15 s)
- [x] Shuffle pins green (FR-5): rng=0 dispatch transcript [B, C, A] with input-order OUTPUT; near-one rng keeps identity; the seeded Fisher-Yates transcript equals an in-test recomputation
- [x] Halt pins green (FR-7): the walk throws `HaltError` on a 429 (never leg-dead/all-faulted); a sibling flagged after the halt never GETs; at the join halt outranks leg-dead in the parked-both-GETs race
- [x] FR-4 pin green (ratified): an unparsable 200 throws leg-dead — the tick aborts, a healthy sibling's posts are discarded, never all-faulted
- [x] Payload pin green: `PAYLOAD_MAX_AGE_MS === 2_400_000`; exactly-at-boundary ok, boundary+1 stale (symbolic, unchanged)
- [x] FR-6 holds: `scripts/probe-linkedin.ts` untouched (it calls `transport.get` directly, never the walk)
#### Reconciliation
- `tests/config-file.test.ts`: replace — the operator swapped three committed linkedin surface values between sessions (`hiring developer indonesia`->`developer indonesia`, `hiring engineer jakarta`->`engineer jakarta`, `react indonesia`->`react`); the FRD-five pin at tests/config-file.test.ts:394 ("keeps the committed spread at the FRD five") still expects the Phase 6 values and fails the full suite. Phase 3 does not own that file. Apply ONLY if the operator keeps their uncommitted watcher.config.json edit; if they revert it, drop this directive.
  find:
  ```
  hiring developer indonesia
  ```
  replace:
  ```
  developer indonesia
  ```
  (plus the two sibling value swaps in the same pin: `hiring engineer jakarta`->`engineer jakarta`, `react indonesia`->`react`)

- [x] Credential-leak pin green (revise 2026-11-10): an `execFn` rejection shaped like Node's execFile failure (full command line in `.message`, `code` + `stderr` fields) produces a thrown message carrying exit code (number or string) + stderr excerpt only — no `li_at`, no `-H`, no csrf token; the missing-binary shape (`code: "ENOENT"`, no stderr) reads `(exit ENOENT): no stderr captured`; suites stay 45 + 13 (the old exec-failure `it` was REPLACED in place, not added to — measured 58 total, not 59)

#### Manual Verification:
- [ ] Probe protocol: `npm run probe-linkedin` twice, >=6h apart, on the dedicated account before trusting the loop — the live 429 body shape is unverified; re-run after any LINKEDIN_TRANSPORT change

---

## Phase 4: fetchTick wiring

### Overview
fetchTick wires the preflight band (window, then latch, then budget) ahead of the checkout guard, wraps the GET seam with the reserving budget wrapper, trips the operator-cleared latch on halt with one best-effort alarm, and lands the .gitignore entries in the same change as the budget writer.

**Files** (design Slice 4): `scripts/fetch-linkedin.ts`, `src/email.ts`, `.gitignore`, `tests/fetch-linkedin.test.ts`, `tests/email.test.ts`
**Depends on**: Phase 2, Phase 3

### Changes Required:

#### 1. scripts/fetch-linkedin.ts
**File**: `scripts/fetch-linkedin.ts`
**Changes**: MODIFY — the preflight band (window, latch, budget) before guardCheckout; the budget reader (degrade lattice: absent quiet-fresh, malformed one warning) + atomic writer; the budget wrapper on the VoyagerGet seam (reserve + persist BEFORE each GET, spent throws halt); the halt catch (tripLatch + one best-effort alarm + quiet zeros); DEFAULT_LATCH/DEFAULT_BUDGET exports; FetchTickDeps gains latchPath, budgetPath, rng, haltAlarm, bypassWindow. This fence is the pre-gate Slice 4 state — the FR-0 stamp gate is NOT in it; the gate lands via the Slice 5 delta (Phase 5).

```typescript
/**
 * One LinkedIn fetch tick (PC-local leg, design D5/D7):
 *
 *   cookies → transport → voyager walk → payload write → single-path push
 *
 * The push mirrors scripts/commit-state-rebase.sh's discipline, scoped to
 * the payload path: add ONLY state/linkedin-posts.json, no-op guard,
 * commit, pull --rebase origin main, push, one retry on rejection. The bot's
 * commit-back runs the same discipline on a disjoint path, and each
 * file has exactly one writer, so an exact-simultaneous push pair costs
 * the loser one retry — never a lost update. Run from a DEDICATED clone of
 * main: the checkout preflight (guardCheckout) enforces branch main + a
 * clean tree BEFORE cookies, transport, or any voyager GET — a dirty tree
 * wedges the rebase only AFTER a live fetch is burned, and a non-main
 * branch would push the payload to the wrong ref. The rebase doubles as
 * the loop's own code auto-update.
 *
 * Leg-dead: ONE alarm email per episode (edge-detected via a repo-local
 * marker file beside the payload — never OS temp: a reboot or temp-cleaner
 * must not erase the episode and re-alarm a still-dead leg), then exit 1
 * for this one-shot entry. The loop
 * (scripts/watch-linkedin.ts) catches and keeps running — a cookie-file
 * refresh self-heals on a later tick. Best-effort alarm policy: a broken
 * GMAIL_* configuration must not mask the exit code.
 *
 * Entry-guarded main (index.ts idiom): importing fetchTick stays
 * side-effect free.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import { resolveEmailConfig, sendHaltAlarm, sendLegDeadAlarm } from "../src/email.js";
import { envWithDotEnv } from "../src/env-file.js";
import {
  DAILY_GET_BUDGET,
  type DailyBudgetState,
  HALT_BUDGET_REASON,
  budgetAllows,
  budgetReserve,
  freshBudget,
  isWithinWorkingHours,
  localDateKey,
} from "../src/linkedin-behavior.js";
import {
  type LinkedinSurface,
  type Transport,
  type VoyagerGet,
  fetchLinkedInPosts,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import { writePayloadAtomic } from "../src/linkedin-payload.js";
import { type LinkedInCookies, resolveLinkedInCookies } from "../src/linkedin-session.js";
import { stateTempPath } from "../src/state.js";
import type { Post } from "../src/types.js";

/** Injectable git runner: args → exit code + git's own merged output (never rejects). */
export type GitRunner = (args: readonly string[]) => Promise<{ code: number; output: string }>;

const execFilePromised = promisify(execFile);

/** The real git on PATH; exported for the suite's read-only spawn pins. */
export const realGit: GitRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFilePromised("git", [...args], { windowsHide: true });
    return { code: 0, output: `${stdout}\n${stderr}`.trim() };
  } catch (error) {
    // execFile rejects on a nonzero code with {stdout, stderr} attached;
    // both channels merge into one trimmed output either way.
    const raw = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    const code = typeof raw.code === "number" ? raw.code : 1;
    const output = `${String(raw.stdout ?? "")}\n${String(raw.stderr ?? "")}`.trim();
    return { code: Number.isInteger(code) ? code : 1, output };
  }
};

/** Outcome of one tick; the loop and tests assert on it. */
export interface FetchTickResult {
  wrote: boolean;
  pushed: boolean;
  postCount: number;
}

export interface FetchTickDeps {
  /** Pre-resolved config. Default: loadWatcherConfig() — fail-visible. */
  config?: WatcherConfig;
  /** Pre-resolved cookies. Default: resolveLinkedInCookies(env). */
  cookies?: LinkedInCookies;
  /** Opened transport. Default: resolveLinkedInTransport(env, cookies). The caller owns a provided transport. */
  transport?: Transport;
  /** Payload location. Default: LINKEDIN_PAYLOAD_PATH (the pushed path). */
  payloadPath?: string;
  /** Git runner. Default: the real git on PATH. */
  git?: GitRunner;
  /** Environment for the resolvers. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Episode alarm. Default: sendLegDeadAlarm, best-effort (warn on failure). */
  alarm?: (reason: string) => Promise<void>;
  /** Episode marker file. Default: repo-local beside the payload (survives restarts). */
  markerPath?: string;
  /** Clock for the payload stamp. Default: Date.now. */
  now?: () => number;
  /** Halt-latch flag file. Default: repo-local beside the payload (survives restarts). */
  latchPath?: string;
  /** Daily GET budget file. Default: repo-local beside the payload (survives restarts). */
  budgetPath?: string;
  /** Jitter draw for the walk pacing + shuffle. Default: Math.random. */
  rng?: () => number;
  /** Halt-latch alarm. Default: sendHaltAlarm, best-effort (warn on failure). */
  haltAlarm?: (reason: string) => Promise<void>;
  /**
   * Bypass the working-hours window gate. Default: false (the gate is on).
   * The offline suite injects true so a tick can run at any pinned clock;
   * production never sets it.
   */
  bypassWindow?: boolean;
}

/**
 * Episode marker BESIDE THE PAYLOAD (repo-local, persistent): present = the
 * alarm already fired for this episode. OS temp was rejected 2026-11-04 —
 * a reboot or temp-cleaner erased it, and a still-dead leg after a PC
 * restart re-alarmed, breaking one-alarm-per-episode exactly when the
 * operator needs quiet. state/ in the dedicated clone is loop-owned and
 * persistent; the flag is untracked (pushPayload stages only the payload
 * path; the bot commits only seen-posts.json), so rebase never touches it.
 */
const DEFAULT_MARKER = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-leg-dead.flag");

/**
 * The operator-cleared halt latch (FR-7): present = fetching is blocked until
 * the operator deletes it. Repo-local beside the payload, same discipline as
 * the episode marker — a reboot or temp-cleaner must not erase it.
 */
const DEFAULT_LATCH = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-halt.flag");

/**
 * The daily GET budget ledger (FR-9): {localDate, count}, persisted atomically
 * BEFORE each GET leaves. Repo-local beside the payload; untracked via the
 * .gitignore entries this slice adds.
 */
const DEFAULT_BUDGET = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-get-budget.json");

async function markerExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Send the leg-dead alarm ONCE per episode: the marker file edges the
 * healthy→dead transition, so a 144-tick dead day emails once. Every dead
 * tick still warns in the run log.
 */
export async function handleLegDeadEpisode(
  reason: string,
  deps: FetchTickDeps = {},
): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  const env = deps.env ?? process.env;
  if (await markerExists(marker)) {
    console.warn(`fetch-linkedin: leg still dead — ${reason} (alarm already sent this episode)`);
    return;
  }
  await writeFile(marker, `${reason}\n`, "utf8");
  console.error(`fetch-linkedin: LEG DEAD — ${reason}`);
  const alarm =
    deps.alarm ??
    (async (alarmReason: string) => {
      try {
        await sendLegDeadAlarm(alarmReason, resolveEmailConfig(env));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch-linkedin: alarm not sent — ${message}`);
      }
    });
  await alarm(reason);
}

/** Clear a prior episode marker on a healthy tick (the dead→healthy edge). */
async function clearEpisodeMarker(deps: FetchTickDeps): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  if (await markerExists(marker)) {
    await rm(marker, { force: true });
    console.log("fetch-linkedin: leg recovered — episode cleared");
  }
}

/**
 * The halt latch: present = the operator must clear it (FR-7). Same
 * read-file discipline as the episode marker's exists probe.
 */
async function latchPresent(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Trip the latch once: the flag's content IS the reason, so the file
 * always explains itself. First-write-wins — a second trip never rewrites
 * an existing flag.
 */
async function tripLatch(path: string, reason: string): Promise<void> {
  if (await latchPresent(path)) return;
  await writeFile(path, `${reason}\n`, "utf8");
}

/**
 * The budget reader's degrade lattice (design decision 2026-11-09): absent
 * (ENOENT) -> fresh, quiet — the normal first-run state; malformed or a
 * wrong shape -> fresh + ONE warning naming the path. A corrupt file must
 * never wedge the leg (the 140 < 150 margin absorbs the reset risk);
 * partial reads are impossible by construction — the writer is atomic.
 */
async function readBudgetState(path: string): Promise<DailyBudgetState> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return freshBudget();
  }
  const warn = (why: string): DailyBudgetState => {
    console.warn(`fetch-linkedin: budget file unreadable (${why}) — starting fresh: ${path}`);
    return freshBudget();
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return warn("not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return warn("not an object");
  }
  const record = parsed as { localDate?: unknown; count?: unknown };
  if (
    typeof record.localDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.localDate) ||
    typeof record.count !== "number" ||
    !Number.isInteger(record.count) ||
    record.count < 0
  ) {
    return warn("wrong shape");
  }
  return { localDate: record.localDate, count: record.count };
}

/**
 * Atomic budget write (sibling unique temp + rename, the payload idiom):
 * the reserve lands BEFORE the GET leaves, so a crash between reserve and
 * GET over-counts — the safe direction.
 */
async function writeBudgetAtomic(
  state: DailyBudgetState,
  path: string,
  nowMs: number,
): Promise<void> {
  const dir = dirname(path);
  const tempPath = stateTempPath(dir, nowMs);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort temp cleanup
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`fetch-linkedin: budget write failed for ${path}: ${message}`);
  }
}

/**
 * Best-effort latch alarm: a broken GMAIL_* configuration warns and never
 * masks the tick outcome (the leg-dead alarm's policy, verbatim).
 */
function defaultHaltAlarm(
  env: Record<string, string | undefined>,
): (reason: string) => Promise<void> {
  return async (reason) => {
    try {
      await sendHaltAlarm(reason, resolveEmailConfig(env));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`fetch-linkedin: latch alarm not sent — ${message}`);
    }
  };
}

/**
 * Dedicated-clone preflight (D5, Phase 10): the push discipline assumes a
 * clean checkout of main. A dirty tree kills the rebase AFTER a live fetch;
 * a non-main branch silently pushes the payload to the wrong ref (the
 * hosted run reads main). Both fail here — before cookies, transport, or
 * any voyager GET — naming what is wrong and the remedy. Two git reads,
 * zero network.
 */
export async function guardCheckout(git: GitRunner): Promise<void> {
  const head = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.output.split(/\r?\n/)[0] ?? "";
  if (head.code !== 0 || branch !== "main") {
    throw new Error(
      `fetch-linkedin: this checkout is on branch "${branch || "unknown"}", not main — the payload push would land on the wrong ref and the hosted run would never read it. Run the loop from a DEDICATED clone of main (README: PC operations)`,
    );
  }
  const status = await git(["status", "--porcelain"]);
  if (status.code !== 0 || status.output !== "") {
    const paths = status.output.split("\n");
    const names = paths.slice(0, 5).join("; ");
    throw new Error(
      `fetch-linkedin: this checkout is not clean (${paths.length} path(s): ${names}) — uncommitted edits break the rebase AFTER a live fetch. Run from a dedicated clone of main with a clean tree (README: PC operations)`,
    );
  }
}

/**
 * Commit + push ONLY the payload path with the rebase+retry discipline.
 * The rebase replays the payload commit onto origin/main; a conflict on
 * the payload path is impossible while it has one writer, so a failure
 * aborts loudly instead of skipping (the bot's whitelist never applies —
 * its seen-posts.json replay touches a disjoint path). Every failure
 * message carries git's own output — the real cause (e.g. "cannot pull
 * with rebase: You have unstaged changes") can never masquerade as a
 * misdiagnosed conflict again.
 */
export async function pushPayload(
  git: GitRunner,
  postCount: number,
  filePath: string = LINKEDIN_PAYLOAD_PATH,
): Promise<void> {
  await git(["add", filePath]);
  const staged = await git(["diff", "--cached", "--quiet"]);
  if (staged.code === 0) {
    console.log("git: payload unchanged; nothing to commit");
    return;
  }
  // The commit exit code IS checked: an unconfigured git identity in a
  // fresh dedicated clone is the classic first-tick failure, and skipping
  // the check would let rebase+push succeed while pushing NOTHING — a
  // silent no-op tick reporting pushed=true (fail-visible doctrine).
  const commit = await git(["commit", "-m", `linkedin: payload ${postCount} post(s)`]);
  if (commit.code !== 0) {
    throw new Error(
      `git: payload commit failed — configure the clone's git identity first (git config user.name + user.email) — git said: ${commit.output || "(no output)"}`,
    );
  }
  let lastFailure = "";
  const attempt = async (): Promise<boolean> => {
    const rebase = await git(["pull", "--rebase", "origin", "main"]);
    if (rebase.code !== 0) {
      lastFailure = rebase.output;
      console.error(`git: rebase failed — aborting — git said: ${rebase.output || "(no output)"}`);
      await git(["rebase", "--abort"]);
      return false;
    }
    const push = await git(["push"]);
    if (push.code !== 0) lastFailure = push.output;
    return push.code === 0;
  };
  const pushed = (await attempt()) || (await attempt());
  if (!pushed) {
    throw new Error(`git: payload push failed twice — git said: ${lastFailure || "(no output)"}`);
  }
  console.log("git: pushed payload commit");
}

export async function fetchTick(deps: FetchTickDeps = {}): Promise<FetchTickResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const config = deps.config ?? (await loadWatcherConfig());
  const surfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  if (surfaces.length === 0) {
    console.log("fetch-linkedin: no linkedin surfaces configured — nothing to do");
    return { wrote: false, pushed: false, postCount: 0 };
  }
  // The anti-restriction preflight band (design 2026-11-09) runs BEFORE the
  // checkout guard: a gated no-op costs zero git spawns, zero cookie reads,
  // and zero voyager GETs. Order: window -> latch -> budget.
  const latchPath = deps.latchPath ?? DEFAULT_LATCH;
  const budgetPath = deps.budgetPath ?? DEFAULT_BUDGET;
  const rng = deps.rng ?? Math.random;
  const at = new Date(now());
  if (deps.bypassWindow !== true && !isWithinWorkingHours(at)) {
    console.log(
      "fetch-linkedin: outside the working window (Mon-Fri 08:00-21:00 local) — nothing to do",
    );
    return { wrote: false, pushed: false, postCount: 0 };
  }
  if (await latchPresent(latchPath)) {
    console.log(
      "fetch-linkedin: HALT LATCH present — fetching is blocked until the operator deletes it",
    );
    return { wrote: false, pushed: false, postCount: 0 };
  }
  const dayKey = localDateKey(at);
  const budget = await readBudgetState(budgetPath);
  if (!budgetAllows(budget, dayKey, DAILY_GET_BUDGET)) {
    console.log(
      `fetch-linkedin: daily GET budget spent for ${dayKey} — nothing to do until local midnight`,
    );
    return { wrote: false, pushed: false, postCount: 0 };
  }
  // The checkout preflight runs BEFORE the cookie/transport resolvers: a
  // mis-homed checkout costs zero voyager GETs and writes nothing. The loop
  // catches this plain error and keeps running (a mis-homed loop warns
  // every 10 min instead of burning live fetches); the one-shot entry exits 1.
  await guardCheckout(deps.git ?? realGit);
  const cookies = deps.cookies ?? resolveLinkedInCookies(env);
  const transport = deps.transport ?? (await resolveLinkedInTransport(env, cookies));
  // The budget wrapper rides the VoyagerGet seam: reserve + persist BEFORE
  // the GET leaves (a crash between reserve and GET over-counts — the safe
  // direction), and a spent budget mid-walk throws the tagged halt the
  // walk drains to the join.
  let budgetState = budget;
  const wrappedGet: VoyagerGet = async (url) => {
    if (!budgetAllows(budgetState, dayKey, DAILY_GET_BUDGET)) {
      throw halt(HALT_BUDGET_REASON);
    }
    budgetState = budgetReserve(budgetState, dayKey);
    await writeBudgetAtomic(budgetState, budgetPath, now());
    return transport.get(url);
  };
  let posts: Post[];
  try {
    // The bare GET rides the walk (never the Transport object — the walk
    // disposes any Transport it receives); disposal is this finally's job alone.
    posts = await fetchLinkedInPosts(surfaces, cookies, wrappedGet, undefined, now, rng);
  } catch (error) {
    // The halt arm (design 2026-11-09): a 429 or a spent budget trips the
    // operator-cleared latch, alarms once (best-effort), and lands as a
    // quiet-zeros no-op — the loop keeps running, fetching nothing.
    if (isHalt(error)) {
      await tripLatch(latchPath, error.reason);
      console.error(`fetch-linkedin: HALT LATCH TRIPPED — ${error.reason}`);
      await (deps.haltAlarm ?? defaultHaltAlarm(env))(error.reason);
      return { wrote: false, pushed: false, postCount: 0 };
    }
    // All-faulted walk (Phase 8, b2): an all-faulted tick is a tagged no-op
    // — quiet zeros, payload/git/episode-marker untouched, so the hosted
    // reader keeps scoring the LAST GOOD payload instead of a fresh empty
    // one. Leg-dead is NOT caught here: it re-throws and the entry/loop
    // callers own the alarm policy.
    if (isAllSurfacesFaulted(error)) {
      console.warn(
        `fetch-linkedin: all ${error.faulted} linkedin surface(s) faulted — payload not touched, last good payload preserved`,
      );
      return { wrote: false, pushed: false, postCount: 0 };
    }
    throw error;
  } finally {
    // The caller owns a provided transport; a locally opened one dies here.
    if (deps.transport === undefined) await transport.dispose();
  }
  const payloadPath = deps.payloadPath ?? LINKEDIN_PAYLOAD_PATH;
  await writePayloadAtomic(posts, payloadPath, now);
  console.log(`payload: wrote ${posts.length} post(s) — ${payloadPath}`);
  await pushPayload(deps.git ?? realGit, posts.length, payloadPath);
  await clearEpisodeMarker(deps);
  return { wrote: true, pushed: true, postCount: posts.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The merged env: .env fills ONLY unset keys, the real shell wins. The
  // fetchTick default stays process.env for the offline tests' injection.
  fetchTick({ env: envWithDotEnv() }).catch(async (error: unknown) => {
    if (isLegDead(error)) {
      await handleLegDeadEpisode(error.reason);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`fetch-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
```

#### 2. src/email.ts
**File**: `src/email.ts`
**Changes**: MODIFY — buildHaltAlarmText + sendHaltAlarm: the leg-dead builder + thin-sender pair applied to the latch (subject "LinkedIn fetch leg halted — clear the latch to resume").

```typescript
/**
 * Gmail plain-text digest notification sender (FRD #7, #8).
 *
 * Formats new relevant job posts into a clean plain-text email digest
 * and dispatches it via Gmail SMTP using nodemailer.
 * Gated by post count: sends no email when candidate matches are zero (FRD #8).
 */
import nodemailer, { type Transporter } from "nodemailer";
import { ENV_NAMES } from "./config.js";
import type { LegLine } from "./linkedin-payload.js";
import type { AccountFailure, Post } from "./types.js";

export interface EmailConfig {
  user: string;
  pass: string;
  to?: string;
}

export interface SendDigestResult {
  sent: boolean;
  messageId?: string;
  recipient?: string;
  postCount: number;
}

/**
 * Resolve email credentials from an environment record.
 * Throws when mandatory credentials are missing or empty.
 */
export function resolveEmailConfig(
  env: Record<string, string | undefined> = process.env,
): EmailConfig {
  const user = env[ENV_NAMES.gmailUser]?.trim();
  const pass = env[ENV_NAMES.gmailAppPassword]?.trim();

  const missing: string[] = [];
  if (!user) missing.push(ENV_NAMES.gmailUser);
  if (!pass) missing.push(ENV_NAMES.gmailAppPassword);

  if (missing.length > 0) {
    throw new Error(`email: missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    user: user!,
    pass: pass!,
    to: user!,
  };
}

/**
 * Build the digest email subject line.
 * Returns null when posts array is empty.
 */
export function buildSubject(posts: readonly Post[]): string | null {
  if (posts.length === 0) return null;
  const count = posts.length;
  const plural = count === 1 ? "" : "s";
  // D10: the subject names the platforms that produced matches, in first-seen
  // order — a platform with zero matched posts drops its name (a toggle-off
  // platform can never match). All-Threads stays byte-identical to the
  // pre-LinkedIn pin.
  const platformLabel = (post: Post): string =>
    post.platform === "linkedin" ? "LinkedIn" : "Threads";
  const names = [...new Set(posts.map(platformLabel))].join(" + ");

  return `${count} new job post${plural} on ${names} (#hiring indonesia)`;
}

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

/** The ` — detail` suffix for a leg line; empty when no detail rides. */
function legDetailSuffix(leg: LegLine): string {
  return leg.detail !== undefined && leg.detail !== "" ? ` — ${leg.detail}` : "";
}

/**
 * Send one plain-text email through the Gmail transport.
 *
 * Shared by the digest (Phase 6) and the heartbeat (Phase 9) so both paths
 * resolve credentials once and fail the same way. Returns the message id
 * when the transport reports one.
 */
export async function sendText(
  subject: string,
  text: string,
  config: EmailConfig,
  transport?: Transporter,
): Promise<string | undefined> {
  const recipient = config.to ?? config.user;
  const mailer =
    transport ??
    nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

  try {
    const info = await mailer.sendMail({
      from: `Loker Watcher <${config.user}>`,
      to: recipient,
      subject,
      text,
    });
    return typeof info?.messageId === "string" ? info.messageId : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`email: failed to send: ${message}`);
  }
}

/**
 * Send a digest email for new matched posts via nodemailer (FRD #7, #8).
 *
 * Gated: returns { sent: false, postCount: 0 } immediately when posts is empty.
 * Accepts an optional custom Transporter instance for unit testing.
 * Throws when nodemailer fails to deliver, ensuring fail-visible execution.
 */
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
  if (subject === null || text === null) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const messageId = await sendText(subject, text, config, transport);
  const recipient = config.to ?? config.user;
  console.log(`email: sent digest with ${posts.length} post(s) to ${recipient}`);

  return {
    sent: true,
    ...(messageId !== undefined ? { messageId } : {}),
    recipient,
    postCount: posts.length,
  };
}

/**
 * Build the plain-text body for the judge-pool exhaustion alarm.
 * Lists every account with its recorded failure, in pool order. Returns
 * null when the failure list is empty (no alarm to send).
 *
 * With poolSize the header is pool-truthful — "X of N LLM_ACCOUNTS
 * accounts failed" — and the pool seats that never entered the record
 * render as one "Still working" line, computed by set-difference against
 * the 1-based pool positions (the builder sees only failures, not the
 * account list, so survivors render as numbers). Without poolSize the
 * legacy body stands byte-identical.
 */
export function buildExhaustionText(
  failures: readonly AccountFailure[],
  poolSize?: number,
): string | null {
  if (failures.length === 0) return null;
  const lines = failures.map(
    (failure, index) =>
      `${index + 1}. account ${failure.account} (${failure.baseUrl}) — ${failure.reason}`,
  );
  const header =
    poolSize === undefined
      ? "The LLM judge pool is exhausted — every LLM_ACCOUNTS account failed."
      : `The LLM judge pool is exhausted — ${failures.length} of ${poolSize} LLM_ACCOUNTS accounts failed.`;
  const parts: string[] = [header, "", ...lines];
  if (poolSize !== undefined) {
    const failed = new Set(failures.map((failure) => failure.account));
    const survivors: number[] = [];
    for (let seat = 1; seat <= poolSize; seat += 1) {
      if (!failed.has(seat)) survivors.push(seat);
    }
    if (survivors.length > 0) {
      const label =
        survivors.length === 1 ? `account ${survivors[0]!}` : `accounts ${survivors.join(", ")}`;
      parts.push("", `Still working this run: ${label}.`);
    }
  }
  parts.push(
    "",
    "No digest was sent and no posts were marked seen; they retry next run.",
    "Add a working account to the LLM_ACCOUNTS secret and re-run.",
  );
  return parts.join("\n");
}

/**
 * Send the judge-pool exhaustion alarm through the same Gmail transport as
 * the digest. Returns the message id when the transport reports one, or
 * undefined when there is nothing to send. Throws fail-visible when
 * nodemailer fails to deliver (sendText wraps the transport error).
 * With poolSize the subject reads "LLM judge pool exhausted (X of N
 * accounts failed)" — the /judge pool exhausted/ pin fragment survives;
 * without it the legacy count-only subject stands.
 */
export async function sendExhaustionEmail(
  failures: readonly AccountFailure[],
  config: EmailConfig,
  transport?: Transporter,
  poolSize?: number,
): Promise<string | undefined> {
  const text = buildExhaustionText(failures, poolSize);
  if (text === null) return undefined;
  const counts =
    poolSize === undefined
      ? `${failures.length} account${failures.length === 1 ? "" : "s"} failed`
      : `${failures.length} of ${poolSize} accounts failed`;
  const subject = `LLM judge pool exhausted (${counts})`;
  const messageId = await sendText(subject, text, config, transport);
  console.log(`email: sent exhaustion alarm for ${failures.length} account(s)`);
  return messageId;
}

/**
 * Build the plain-text body for the LinkedIn leg-dead alarm (design D7).
 * One email per episode, sent by the PC fetch leg (the fault's origin);
 * the hosted run never sends it. The body names the remedy — the cookie
 * file refresh — so the operator can act without opening the docs.
 */
export function buildLegDeadAlarmText(reason: string): string {
  return [
    "The LinkedIn fetch leg is dead.",
    "",
    `Signature: ${reason}`,
    "",
    "The loop keeps running. Refresh the cookie file (LINKEDIN_COOKIES_FILE —",
    "re-export the pair from a logged-in browser) and the next tick heals;",
    "no restart needed. Failure matrix: DOCUMENTATION.md §13; session: §14.",
  ].join("\n");
}

/**
 * Send the leg-dead alarm through the same Gmail transport as the digest.
 * The PC loop caller owns the best-effort try/catch policy — a broken
 * GMAIL_* configuration must not mask the exit code the tick earned.
 */
export async function sendLegDeadAlarm(
  reason: string,
  config: EmailConfig,
  transport?: Transporter,
): Promise<string | undefined> {
  const messageId = await sendText(
    "LinkedIn fetch leg is dead — refresh the cookie file",
    buildLegDeadAlarmText(reason),
    config,
    transport,
  );
  console.log("email: sent leg-dead alarm");
  return messageId;
}

/**
 * Build the plain-text body for the halt-latch alarm (design 2026-11-09).
 * One email per trip, sent by the PC fetch leg (the fault's origin); the
 * hosted run never sends it. The body names the remedy — delete the latch
 * file — so the operator can act without opening the docs.
 */
export function buildHaltAlarmText(reason: string): string {
  return [
    "The LinkedIn fetch leg is HALTED.",
    "",
    `Signature: ${reason}`,
    "",
    "Fetching is blocked until you clear the latch. The loop keeps running",
    "and every tick is a quiet no-op — no LinkedIn requests are made.",
    "",
    "To resume: delete state/linkedin-halt.flag (or run npm run reset-linkedin",
    "to clear the session and the latch together).",
    "",
    "A 429 means LinkedIn told this account to slow down. Wait before",
    "resuming, and check the daily GET budget in state/linkedin-get-budget.json.",
  ].join("\n");
}

/**
 * Send the halt-latch alarm through the same Gmail transport as the
 * digest. The PC loop caller owns the best-effort try/catch policy — a
 * broken GMAIL_* configuration must not mask the tick outcome.
 */
export async function sendHaltAlarm(
  reason: string,
  config: EmailConfig,
  transport?: Transporter,
): Promise<string | undefined> {
  const messageId = await sendText(
    "LinkedIn fetch leg halted — clear the latch to resume",
    buildHaltAlarmText(reason),
    config,
    transport,
  );
  console.log("email: sent halt-latch alarm");
  return messageId;
}
```

#### 3. .gitignore
**File**: `.gitignore`
**Changes**: MODIFY — two new ignore entries (state/linkedin-get-budget.json, state/linkedin-halt.flag) so the clean-tree guard never wedges on the new PC-local state files. Full-file fence.

```typescript
node_modules/
.env
.env.*
.pi/
.rpiv/tmp/
.codebase-memory/graph.db.zst
slice*-recon/
linkedin-cookies*.json
state/linkedin-leg-dead.flag
run.log
tools/
state/linkedin-get-budget.json
state/linkedin-halt.flag
```

#### 4. tests/fetch-linkedin.test.ts
**File**: `tests/fetch-linkedin.test.ts`
**Changes**: MODIFY — preflight-band pins (latched / window / weekday / spent-budget), budget wrapper pins (ledger counts every GET, malformed degrades + one warning, mid-walk exhaustion trips the latch), halt-trip pins (429 reason, no episode-marker write), unstamped COOKIES at Slice 4 (the stamped literal + the FR-0 stamp-gate pin land via the Slice 5 delta, Phase 5).

```typescript
/**
 * Offline suite for the PC fetch tick (slice 4).
 *
 * Pins pushPayload's single-path rebase+retry discipline over a fake
 * GitRunner, fetchTick's composition over the injected seams, the
 * leg-dead episode-marker edge, the Phase 8 tick guards (an all-faulted
 * walk is a quiet-zeros no-op while a fine-empty walk still writes and
 * pushes, defb8af), and the Phase 10 preflight + honest git failures: the
 * checkout guard (branch main + clean porcelain) runs BEFORE any fetch,
 * and every push-discipline failure carries git's own merged output.
 * Zero network, zero real email; the doubles carry every behavior pin
 * (realGit is exercised only by two read-only git spawns in its block).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type GitRunner,
  fetchTick,
  guardCheckout,
  handleLegDeadEpisode,
  pushPayload,
  realGit,
} from "../scripts/fetch-linkedin.js";
import type { Surface, WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import {
  HALT_BUDGET_REASON,
  HALT_RATE_LIMIT_REASON,
  localDateKey,
} from "../src/linkedin-behavior.js";
import { type Transport, isHalt, isLegDead, legDead } from "../src/linkedin-fetch.js";
import { PAYLOAD_VERSION, type PayloadEnvelope } from "../src/linkedin-payload.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const T0 = Date.UTC(2026, 9, 26, 9, 14, 0);
const COOKIES: LinkedInCookies = {
  liAt: "AQE-test",
  jsessionId: "ajax:0123456789012345678",
};

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: [],
  negativeKeywords: [],
  surfaces: [{ type: "linkedin", value: "#hiring react" }],
  platforms: { linkedin: true, threads: true },
  recencyHours: 72,
  reasoningEffort: "low",
  scrollRounds: 1,
};

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function workPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-fetch-linkedin-"));
  return join(dir, name);
}

async function exists(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}

/** Fake GitRunner: records every invocation; exit code + output scripted per command. */
function scriptGit(
  script: Partial<
    Record<
      string,
      number | { code: number; output: string } | Array<number | { code: number; output: string }>
    >
  > = {},
): GitRunner & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    const command = args[0] ?? "";
    calls.push([...args]);
    const scripted = script[command];
    const index = calls.filter((entry) => entry[0] === command).length - 1;
    const entry = Array.isArray(scripted)
      ? (scripted[index] ?? scripted[scripted.length - 1])
      : scripted;
    if (entry === undefined) return { code: 0, output: "" };
    if (typeof entry === "number") return { code: entry, output: "" };
    return { code: entry.code, output: entry.output };
  };
  return Object.assign(git, { calls });
}

/** Build a §6-shaped 200 body carrying the given activity ids (linkedin-fetch suite shape). */
const pageBody = (ids: readonly string[]): string =>
  JSON.stringify({
    data: {
      searchDashClustersByAll: {
        elements: [
          {
            items: ids.map((id) => ({
              item: {
                searchFeedUpdate: {
                  update: {
                    metadata: { backendUrn: `urn:li:activity:${id}` },
                    commentary: { text: { text: `post ${id}` } },
                    actor: { name: { text: `author ${id}` } },
                    socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                  },
                },
              },
            })),
          },
        ],
      },
    },
    included: [],
  });

/** Distinct activity ids at 1-second spacing (linkedin-fetch suite idiom). */
const idAt = (n: number): string => (BigInt(Date.UTC(2026, 9, 26, 9, 14, n)) << 22n).toString();

const transportFor = (
  body: string | Error,
): Transport & { disposeCount: () => number; gets: () => number } => {
  let disposeCount = 0;
  let getCount = 0;
  const get = async (): Promise<{ status: number; body: string }> => {
    getCount += 1;
    if (body instanceof Error) throw body;
    return { status: 200, body };
  };
  const dispose = async (): Promise<void> => {
    disposeCount += 1;
  };
  const transport: Transport = { get, dispose };
  return Object.assign(transport, { disposeCount: () => disposeCount, gets: () => getCount });
};

describe("realGit (git's merged output, resolved and rejected paths)", () => {
  it("captures git's stdout on success and its stderr + exit code on failure", async (t) => {
    const probe = await realGit(["--version"]); // read-only: no repo state touched
    if (probe.code !== 0) {
      t.skip("git is not on PATH — the read-only spawn pins need a real git");
      return;
    }
    assert.match(probe.output, /git version/); // resolved path: stdout rides output
    const dead = await realGit(["rev-parse", "--verify", "lw-no-such-ref-realgit-pin"]);
    assert.notEqual(dead.code, 0); // rejected path: the real exit code survives
    assert.ok(dead.output.length > 0); // git's own stderr, merged and trimmed
  });
});

describe("pushPayload (single-path rebase+retry discipline)", () => {
  it("stages ONLY the injected path, commits, rebases onto main, and pushes", async () => {
    const payload = await workPath("push-ok.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 3, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
      ["commit", "-m", "linkedin: payload 3 post(s)"],
      ["pull", "--rebase", "origin", "main"],
      ["push"],
    ]);
  });

  it("never stages the module-constant path when a temp payload is injected", async () => {
    const payload = await workPath("push-injected.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 1, payload);
    const addCalls = git.calls.filter((args) => args[0] === "add");
    assert.equal(addCalls.length, 1);
    assert.equal(addCalls[0]?.[1], payload);
    assert.ok(git.calls.every((args) => !args.includes(LINKEDIN_PAYLOAD_PATH)));
  });

  it("throws loudly when the commit itself fails: names the identity fix AND carries git's output", async () => {
    const git = scriptGit({
      diff: 1,
      commit: { code: 128, output: "fatal: unable to auto-detect email address" },
    });
    const payload = await workPath("push-commit-fail.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /payload commit failed — configure the clone's git identity first/);
        assert.match(message, /git said: fatal: unable to auto-detect email address/);
        return true;
      },
    );
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 0);
  });

  it("skips commit + rebase + push when nothing is staged (no-op guard)", async () => {
    const payload = await workPath("push-noop.json");
    const git = scriptGit({ diff: 0 });
    await pushPayload(git, 0, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
    ]);
  });

  it("retries once when the push is rejected, then succeeds", async () => {
    const git = scriptGit({ diff: 1, push: [1, 0] });
    await pushPayload(git, 2, await workPath("push-retry.json"));
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 2);
  });

  it("throws after the second push rejection (loud, exit-1 contract)", async () => {
    const git = scriptGit({ diff: 1, push: 1 });
    const payload = await workPath("push-fail.json");
    await assert.rejects(() => pushPayload(git, 2, payload), /payload push failed twice/);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
  });

  it("aborts the rebase loudly on failure and never pushes — git's own line rides the error", async () => {
    const git = scriptGit({
      diff: 1,
      pull: { code: 1, output: "CONFLICT (content): Merge conflict in state/linkedin-posts.json" },
    });
    const payload = await workPath("push-conflict.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /payload push failed twice/);
        assert.match(
          message,
          /git said: CONFLICT \(content\): Merge conflict in state\/linkedin-posts\.json/,
        );
        return true;
      },
    );
    const aborts = git.calls.filter((args) => args[0] === "rebase" && args[1] === "--abort");
    assert.equal(aborts.length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
  });

  it("surfaces git's real cause, not a misread conflict (the unstaged-changes misdiagnosis)", async () => {
    const git = scriptGit({
      diff: 1,
      pull: { code: 1, output: "error: cannot pull with rebase: You have unstaged changes." },
    });
    const payload = await workPath("push-rebase-output.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(
          message,
          /git said: error: cannot pull with rebase: You have unstaged changes\./,
        );
        assert.ok(!message.includes("rebase conflicted"));
        return true;
      },
    );
  });
});

describe("fetchTick (compose cookies → transport → walk → payload → push)", () => {
  it("composes the tick end to end: payload written, single-path push, marker cleared", async () => {
    const payload = await workPath("tick-ok.json");
    const marker = await workPath("tick-ok.flag");
    await writeFile(marker, "dead session\n", "utf8"); // a stale episode: a clean tick clears it
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-1.flag"),
      budgetPath: await workPath("budget-1.json"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      transport,
      payloadPath: payload,
      git,
      env: {},
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 1 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.version, PAYLOAD_VERSION);
    assert.equal(new Date(envelope.writtenAt).getTime(), T0);
    const expected: Post = {
      platform: "linkedin",
      id: `urn:li:activity:${idAt(1)}`,
      text: `post ${idAt(1)}`,
      author: `author ${idAt(1)}`,
      permalink: `https://www.linkedin.com/posts/x-${idAt(1)}`,
      timestamp: new Date(Number(BigInt(idAt(1)) >> 22n)).toISOString(),
    };
    assert.deepEqual(envelope.posts, [expected]);
    assert.equal(transport.disposeCount(), 0); // caller-owned: fetchTick never disposes it
    assert.equal(await exists(marker), false); // the healthy tick cleared the episode
    // The two preflight reads (clean main, empty porcelain) precede the push discipline.
    assert.deepEqual(git.calls[0], ["rev-parse", "--abbrev-ref", "HEAD"]);
    assert.deepEqual(git.calls[1], ["status", "--porcelain"]);
    assert.equal(git.calls[2]?.[0], "add");
    assert.equal(git.calls[2]?.[1], payload); // ONLY the injected payload path
    assert.ok(git.calls.some((args) => args[0] === "commit"));
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });

  it("propagates leg-dead without writing the payload, pushing, or disposing", async () => {
    const payload = await workPath("tick-dead.json");
    const marker = await workPath("tick-dead.flag");
    const alarms: string[] = [];
    const transport = transportFor(legDead("bare HTTP 400 — dead session"));
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-2.flag"),
          budgetPath: await workPath("budget-2.json"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          transport,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
          alarm: async (reason) => {
            alarms.push(reason);
          },
        }),
      (error: unknown) => isLegDead(error) && /dead session/.test(error.reason),
    );
    assert.equal(transport.disposeCount(), 0); // caller-owned, even on failure
    assert.equal(await exists(payload), false); // the walk aborted before any write
    // Only the two preflight reads ran (the guard precedes the walk); zero push-discipline calls.
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
    assert.deepEqual(alarms, []); // the alarm policy belongs to the entry/loop callers
  });

  it("returns quiet zeros on an all-faulted walk — no payload, no git, marker untouched", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const payload = await workPath("tick-all-faulted.json");
    const marker = await workPath("tick-all-faulted.flag");
    await writeFile(marker, "stale episode\n", "utf8"); // must survive untouched
    const transport = transportFor(new Error("surface blew up"));
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-3.flag"),
      budgetPath: await workPath("budget-3.json"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      transport,
      payloadPath: payload,
      git,
      env: {},
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(await exists(payload), false); // b2: the last good payload stays
    // The preflight ran (it precedes the walk); still zero add/commit/push on a faulted tick.
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
    assert.equal(await readFile(marker, "utf8"), "stale episode\n"); // never cleared
    assert.equal(transport.disposeCount(), 0); // caller-owned, even on the no-op path
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /all 1 linkedin surface\(s\) faulted/.test(line)));
  });

  it("still writes and pushes a fine-empty walk's payload (defb8af: 0 faults + 0 posts is an outcome)", async () => {
    const payload = await workPath("tick-fine-empty.json");
    const marker = await workPath("tick-fine-empty.flag");
    const transport = transportFor(pageBody([])); // 200, zero posts, zero faults
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-4.flag"),
      budgetPath: await workPath("budget-4.json"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      transport,
      payloadPath: payload,
      git,
      env: {},
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 0 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.version, PAYLOAD_VERSION);
    assert.deepEqual(envelope.posts, []); // the guard keys on FAULTS, not post count
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });

  it("returns early when no linkedin surfaces are configured (resolvers AND the checkout preflight never run)", async () => {
    const git = scriptGit({});
    const result = await fetchTick({
      latchPath: await workPath("latch-5.flag"),
      budgetPath: await workPath("budget-5.json"),
      bypassWindow: true,
      config: { ...CONFIG, surfaces: [{ type: "tag", value: "hiring" }] },
      git,
      env: {}, // no LINKEDIN_COOKIES_FILE — the cookie resolver would throw if reached
      markerPath: await workPath("tick-noop.flag"),
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(git.calls.length, 0); // the guard sits AFTER this return — a threads-only config never demands a main checkout
  });

  it("opens the transport through resolveLinkedInTransport when none is injected", async () => {
    const payloadPath = await workPath("tick-resolver.json");
    const markerPath = await workPath("tick-resolver.flag");
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-6.flag"),
          budgetPath: await workPath("budget-6.json"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          env: { LINKEDIN_TRANSPORT: "wget" },
          payloadPath,
          git: scriptGit({ "rev-parse": { code: 0, output: "main" } }),
          markerPath,
        }),
      /LINKEDIN_TRANSPORT="wget" is not one of: curl, playwright/,
    );
  });
});

describe("checkout preflight (guardCheckout before any fetch — Phase 10)", () => {
  it("passes on clean main with exactly the two guard reads (direct pin)", async () => {
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } }); // status → empty porcelain
    await guardCheckout(git); // must not throw
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
  });

  it("rejects a wrong branch naming it and the wrong-ref consequence — zero GETs, no payload", async () => {
    const payload = await workPath("tick-wrong-branch.json");
    const marker = await workPath("tick-wrong-branch.flag");
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({
      "rev-parse": { code: 0, output: "feature/add-support-for-linkeind" },
    });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-7.flag"),
          budgetPath: await workPath("budget-7.json"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          transport,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /on branch "feature\/add-support-for-linkeind", not main/);
        assert.match(message, /wrong ref/); // the hosted run would never read that push
        return true;
      },
    );
    assert.equal(transport.gets(), 0); // the guard precedes the walk — zero voyager GETs
    assert.equal(await exists(payload), false); // nothing written before the rejection
    assert.deepEqual(git.calls, [["rev-parse", "--abbrev-ref", "HEAD"]]); // throws before status
  });

  it("rejects a dirty tree naming the path count and the paths — zero GETs, no payload", async () => {
    const payload = await workPath("tick-dirty.json");
    const marker = await workPath("tick-dirty.flag");
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({
      "rev-parse": { code: 0, output: "main" },
      status: { code: 0, output: " M src/linkedin-fetch.ts\n M README.md" },
    });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-8.flag"),
          budgetPath: await workPath("budget-8.json"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          transport,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /not clean \(2 path\(s\)/);
        assert.match(message, /src\/linkedin-fetch\.ts/);
        assert.match(message, /README\.md/);
        return true;
      },
    );
    assert.equal(transport.gets(), 0); // no live fetch burned on a mis-homed checkout
    assert.equal(await exists(payload), false);
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
  });
});

describe("handleLegDeadEpisode (one alarm per episode)", () => {
  it("alarms once on the healthy→dead edge and writes the marker", async () => {
    const marker = await workPath("episode-1.flag");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, ["dead session"]);
    assert.equal(await readFile(marker, "utf8"), "dead session\n");
  });

  it("stays quiet on later dead ticks (marker already present)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-2.flag");
    await writeFile(marker, "dead session\n", "utf8");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session again", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /leg still dead/.test(line)));
  });

  it("survives a restart: the marker file, not module state, edges the episode", async () => {
    const marker = await workPath("episode-3.flag");
    const alarms: string[] = [];
    const deps = {
      markerPath: marker,
      env: {},
      alarm: async (reason: string): Promise<void> => {
        alarms.push(reason);
      },
    };
    await handleLegDeadEpisode("dead", deps); // pre-restart process
    await handleLegDeadEpisode("dead", deps); // post-restart process: same file, still quiet
    assert.deepEqual(alarms, ["dead"]);
  });

  it("default alarm is best-effort: a broken GMAIL env warns instead of throwing", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-4.flag");
    await handleLegDeadEpisode("dead", { markerPath: marker, env: {} });
    assert.equal(await readFile(marker, "utf8"), "dead\n"); // marker persists despite the send failure
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /alarm not sent/.test(line)));
  });
});

// --- the anti-restriction preflight band + budget wrapper + latch (design 2026-11-09) ---

describe("the anti-restriction preflight band (design 2026-11-09)", () => {
  it("blocks a latched tick: zero GETs, zero git spawns, quiet zeros", async () => {
    const latchPath = await workPath("latch-1.flag");
    await writeFile(latchPath, "HTTP 429 rate limit\n", "utf8");
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      transport,
      git,
      payloadPath: await workPath("payload-latched.json"),
      latchPath,
      budgetPath: await workPath("budget-9.json"),
      bypassWindow: true,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(transport.gets(), 0);
    assert.equal(git.calls.length, 0);
  });

  it("outside the working window the tick is a quiet no-op (Saturday noon local)", async () => {
    const saturdayNoon = new Date(2026, 9, 31, 12, 0).getTime(); // 2026-10-31 is a Saturday
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      transport,
      git,
      payloadPath: await workPath("payload-weekend.json"),
      latchPath: await workPath("latch-9.flag"),
      budgetPath: await workPath("budget-10.json"),
      now: () => saturdayNoon,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(transport.gets(), 0);
    assert.equal(git.calls.length, 0);
  });

  it("inside the window (Monday 10:00 local, latch absent) the tick reaches the checkout guard", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime(); // 2026-10-26 is a Monday
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({ "rev-parse": { code: 0, output: "feature\n" } });
    await assert.rejects(
      async () =>
        fetchTick({
          config: CONFIG,
          transport,
          git,
          payloadPath: await workPath("payload-weekday.json"),
          latchPath: await workPath("latch-10.flag"),
          budgetPath: await workPath("budget-11.json"),
          now: () => mondayTen,
          env: {},
        }),
      /not main/,
    );
    assert.ok(git.calls.length >= 1); // the band let it through to the guard
    assert.equal(transport.gets(), 0); // the guard threw before any GET
  });

  it("a spent daily budget skips the walk before any GET or git spawn", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const budgetPath = await workPath("budget-1.json");
    const dayKey = localDateKey(new Date(mondayTen));
    await writeFile(budgetPath, JSON.stringify({ localDate: dayKey, count: 150 }), "utf8");
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      transport,
      git,
      payloadPath: await workPath("payload-spent.json"),
      latchPath: await workPath("latch-11.flag"),
      budgetPath,
      now: () => mondayTen,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(transport.gets(), 0);
    assert.equal(git.calls.length, 0);
  });
});

describe("the budget wrapper on the VoyagerGet seam (design 2026-11-09)", () => {
  it("reserves and persists BEFORE each GET: the ledger counts every GET", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const budgetPath = await workPath("budget-2.json");
    const payloadPath = await workPath("payload-budget.json");
    const twoSurfaces = {
      ...CONFIG,
      surfaces: [
        { type: "linkedin", value: "#a" } as Surface,
        { type: "linkedin", value: "#b" } as Surface,
      ],
    };
    await fetchTick({
      config: twoSurfaces,
      cookies: COOKIES,
      transport: transportFor(pageBody([idAt(1)])),
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath,
      latchPath: await workPath("latch-12.flag"),
      budgetPath,
      now: () => mondayTen,
      bypassWindow: true,
      env: {},
    });
    const dayKey = localDateKey(new Date(mondayTen));
    const ledger = JSON.parse(await readFile(budgetPath, "utf8")) as {
      localDate: string;
      count: number;
    };
    assert.deepEqual(ledger, { localDate: dayKey, count: 2 });
  });

  it("a malformed budget file degrades to fresh with one warning naming the path", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const budgetPath = await workPath("budget-3.json");
    await writeFile(budgetPath, "{not json", "utf8");
    await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      transport: transportFor(pageBody([idAt(1)])),
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath: await workPath("payload-degraded.json"),
      latchPath: await workPath("latch-13.flag"),
      budgetPath,
      now: () => mondayTen,
      bypassWindow: true,
      env: {},
    });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    const budgetLine = lines.find((line) => line.includes("budget file unreadable"));
    assert.ok(budgetLine !== undefined);
    assert.ok(budgetLine!.includes(budgetPath));
    // The walk proceeded and the ledger came back valid.
    const ledger = JSON.parse(await readFile(budgetPath, "utf8")) as { count: number };
    assert.equal(ledger.count, 1);
  });

  it("a budget spent MID-WALK trips the latch with the budget reason", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const budgetPath = await workPath("budget-4.json");
    const latchPath = await workPath("latch-2.flag");
    const dayKey = localDateKey(new Date(mondayTen));
    await writeFile(budgetPath, JSON.stringify({ localDate: dayKey, count: 149 }), "utf8");
    const alarms: string[] = [];
    const twoSurfaces = {
      ...CONFIG,
      surfaces: [
        { type: "linkedin", value: "#a" } as Surface,
        { type: "linkedin", value: "#b" } as Surface,
      ],
    };
    const result = await fetchTick({
      config: twoSurfaces,
      cookies: COOKIES,
      transport: transportFor(pageBody([idAt(1)])),
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath: await workPath("payload-midwalk.json"),
      latchPath,
      budgetPath,
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async (reason) => {
        alarms.push(reason);
      },
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    const flag = await readFile(latchPath, "utf8");
    assert.equal(flag, `${HALT_BUDGET_REASON}\n`);
    assert.deepEqual(alarms, [HALT_BUDGET_REASON]);
  });
});

describe("the halt-latch trip (FR-7, design 2026-11-09)", () => {
  it("a 429 walks to a halt, trips the latch with the canonical reason, alarms once", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const latchPath = await workPath("latch-3.flag");
    const payloadPath = await workPath("payload-429.json");
    const alarms: string[] = [];
    const transport: Transport = {
      get: async () => ({ status: 429, body: "" }),
      dispose: async () => undefined,
    };
    const result = await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      transport,
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath,
      latchPath,
      budgetPath: await workPath("budget-12.json"),
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async (reason) => {
        alarms.push(reason);
      },
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    const flag = await readFile(latchPath, "utf8");
    assert.equal(flag, `${HALT_RATE_LIMIT_REASON}\n`);
    assert.deepEqual(alarms, [HALT_RATE_LIMIT_REASON]);
    assert.equal(await exists(payloadPath), false); // no payload on a halted tick
  });

  it("the latch trip never writes the leg-dead episode marker (separate channels)", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const latchPath = await workPath("latch-4.flag");
    const markerPath = await workPath("episode.flag");
    const transport: Transport = {
      get: async () => ({ status: 429, body: "" }),
      dispose: async () => undefined,
    };
    await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      transport,
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath: await workPath("payload-channels.json"),
      latchPath,
      budgetPath: await workPath("budget-13.json"),
      markerPath,
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async () => undefined,
      env: {},
    });
    assert.equal(await exists(latchPath), true);
    assert.equal(await exists(markerPath), false);
  });
});

```

#### 5. tests/email.test.ts
**File**: `tests/email.test.ts`
**Changes**: MODIFY — buildHaltAlarmText + sendHaltAlarm pins alongside the existing suites.

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import {
  type EmailConfig,
  buildDigest,
  buildExhaustionText,
  buildHaltAlarmText,
  buildSubject,
  resolveEmailConfig,
  sendDigest,
  sendExhaustionEmail,
  sendHaltAlarm,
} from "../src/email.js";
import type { AccountFailure, Post } from "../src/types.js";

describe("buildSubject", () => {
  it("returns null for empty post array", () => {
    assert.equal(buildSubject([]), null);
  });

  it("formats subject for a single post without plural s", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
    ];
    assert.equal(buildSubject(posts), "1 new job post on Threads (#hiring indonesia)");
  });

  it("formats subject for multiple posts with plural s", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        platform: "threads",
        id: "2",
        text: "Looking for Vue dev",
        author: "startup",
        permalink: "https://www.threads.com/@startup/post/2",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
      {
        platform: "threads",
        id: "3",
        text: "Senior Frontend Lead",
        author: "agency",
        permalink: "https://www.threads.com/@agency/post/3",
        timestamp: "2026-10-24T02:00:00.000Z",
      },
    ];
    assert.equal(buildSubject(posts), "3 new job posts on Threads (#hiring indonesia)");
  });

  it("appends + LinkedIn to the subject only when a linkedin match is present", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        platform: "linkedin",
        id: "urn:li:activity:7522028760582447104",
        text: "Hiring backend engineer, remote",
        author: "sometechguy",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
    ];
    assert.equal(buildSubject(posts), "2 new job posts on Threads + LinkedIn (#hiring indonesia)");
  });

  it("keeps all-Threads subjects free of the + LinkedIn suffix", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        platform: "threads",
        id: "2",
        text: "Looking for Vue dev",
        author: "startup",
        permalink: "https://www.threads.com/@startup/post/2",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
      {
        platform: "threads",
        id: "3",
        text: "Senior Frontend Lead",
        author: "agency",
        permalink: "https://www.threads.com/@agency/post/3",
        timestamp: "2026-10-24T02:00:00.000Z",
      },
    ];
    const subject = buildSubject(posts);
    assert.equal(subject, "3 new job posts on Threads (#hiring indonesia)");
    assert.ok(!subject?.includes("+ LinkedIn"));
  });
});

describe("buildDigest", () => {
  it("returns null for empty post list", () => {
    assert.equal(buildDigest([]), null);
  });

  it("formats single post digest with author and permalink", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "101",
        text: "Looking for a Next.js frontend dev in Jakarta, hybrid...",
        author: "pttechcareers",
        permalink: "https://www.threads.com/@pttechcareers/post/C8H5FiCtESk",
        timestamp: "2026-10-24T08:15:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith("1 new job post on Threads (#hiring indonesia)\n\n"));
    assert.ok(digest.includes("1. Looking for a Next.js frontend dev in Jakarta, hybrid..."));
    assert.ok(digest.includes("   — @pttechcareers"));
    assert.ok(digest.includes("   https://www.threads.com/@pttechcareers/post/C8H5FiCtESk"));
  });

  it("formats multi-post digest with sequential numbers and double spacing", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "101",
        text: "First job post",
        author: "companyA",
        permalink: "https://www.threads.com/@companyA/post/P1",
        timestamp: "2026-10-24T08:00:00.000Z",
      },
      {
        platform: "threads",
        id: "102",
        text: "Second job post",
        author: "@companyB",
        permalink: "https://www.threads.com/@companyB/post/P2",
        timestamp: "2026-10-24T09:00:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith("2 new job posts on Threads (#hiring indonesia)\n\n"));
    assert.ok(
      digest.includes(
        "1. First job post\n   — @companyA\n   https://www.threads.com/@companyA/post/P1",
      ),
    );
    assert.ok(
      digest.includes(
        "2. Second job post\n   — @companyB\n   https://www.threads.com/@companyB/post/P2",
      ),
    );
  });

  it("preserves multi-line captions without breaking post structure", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "103",
        text: "HIRING NOW!\n- React\n- TypeScript\nApply via DM",
        author: "recruiter",
        permalink: "https://www.threads.com/@recruiter/post/P3",
        timestamp: "2026-10-24T10:00:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(
      digest.includes("1. HIRING NOW!\n- React\n- TypeScript\nApply via DM\n   — @recruiter"),
    );
  });

  it("marks only the linkedin item lines with the [linkedin] token", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "101",
        text: "First job post",
        author: "companyA",
        permalink: "https://www.threads.com/@companyA/post/P1",
        timestamp: "2026-10-24T08:00:00.000Z",
      },
      {
        platform: "linkedin",
        id: "urn:li:activity:7522028760582447104",
        text: "Second job post",
        author: "sometechguy",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
        timestamp: "2026-10-24T09:00:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith("2 new job posts on Threads + LinkedIn (#hiring indonesia)\n\n"));
    assert.ok(
      digest.includes(
        "1. First job post\n   — @companyA\n   https://www.threads.com/@companyA/post/P1",
      ),
    );
    assert.ok(
      digest.includes(
        "2. [linkedin] Second job post\n   — @sometechguy\n   https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
      ),
    );
  });
});

describe("resolveEmailConfig", () => {
  it("resolves valid credentials and trims whitespace", () => {
    const env = {
      GMAIL_USER: "  user@gmail.com  ",
      GMAIL_APP_PASSWORD: "  abcd efgh ijkl mnop  ",
    };
    const config = resolveEmailConfig(env);
    assert.deepEqual(config, {
      user: "user@gmail.com",
      pass: "abcd efgh ijkl mnop",
      to: "user@gmail.com",
    });
  });

  it("throws when GMAIL_USER is missing", () => {
    const env = {
      GMAIL_APP_PASSWORD: "pass",
    };
    assert.throws(
      () => resolveEmailConfig(env),
      /email: missing required environment variables: GMAIL_USER/,
    );
  });

  it("throws when GMAIL_APP_PASSWORD is missing", () => {
    const env = {
      GMAIL_USER: "user@gmail.com",
    };
    assert.throws(
      () => resolveEmailConfig(env),
      /email: missing required environment variables: GMAIL_APP_PASSWORD/,
    );
  });

  it("throws when both credentials are missing", () => {
    assert.throws(
      () => resolveEmailConfig({}),
      /email: missing required environment variables: GMAIL_USER, GMAIL_APP_PASSWORD/,
    );
  });
});

describe("sendDigest", () => {
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

  it("does not send email when posts array is empty (FRD #8)", async () => {
    let called = false;
    const mockTransport = {
      sendMail: async () => {
        called = true;
        return { messageId: "msg-123" };
      },
    } as unknown as Transporter;

    const result = await sendDigest([], sampleConfig, mockTransport);
    assert.equal(result.sent, false);
    assert.equal(result.postCount, 0);
    assert.equal(called, false);
  });

  it("sends digest when new posts match", async () => {
    let capturedOptions: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        capturedOptions = options;
        return { messageId: "msg-456" };
      },
    } as unknown as Transporter;

    const result = await sendDigest(samplePosts, sampleConfig, mockTransport);
    assert.equal(result.sent, true);
    assert.equal(result.postCount, 1);
    assert.equal(result.messageId, "msg-456");
    assert.equal(result.recipient, "alerts@gmail.com");

    const mail = capturedOptions as {
      from: string;
      to: string;
      subject: string;
      text: string;
    };
    assert.equal(mail.from, "Loker Watcher <alerts@gmail.com>");
    assert.equal(mail.to, "alerts@gmail.com");
    assert.equal(mail.subject, "1 new job post on Threads (#hiring indonesia)");
    assert.ok(mail.text.includes("Hiring React dev"));
  });

  it("uses custom recipient if specified in config", async () => {
    let capturedRecipient = "";
    const mockTransport = {
      sendMail: async (options: unknown) => {
        capturedRecipient = (options as { to: string }).to;
        return { messageId: "msg-789" };
      },
    } as unknown as Transporter;

    const customConfig: EmailConfig = {
      user: "sender@gmail.com",
      pass: "pass",
      to: "recipient@company.com",
    };

    const result = await sendDigest(samplePosts, customConfig, mockTransport);
    assert.equal(result.sent, true);
    assert.equal(result.recipient, "recipient@company.com");
    assert.equal(capturedRecipient, "recipient@company.com");
  });

  it("throws fail-visible error when transport fails", async () => {
    const mockTransport = {
      sendMail: async () => {
        throw new Error("SMTP connection timeout");
      },
    } as unknown as Transporter;

    await assert.rejects(
      () => sendDigest(samplePosts, sampleConfig, mockTransport),
      /email: failed to send: SMTP connection timeout/,
    );
  });
});

describe("buildExhaustionText", () => {
  it("returns null for an empty failure list", () => {
    assert.equal(buildExhaustionText([]), null);
  });

  it("lists every account with its reason in pool order", () => {
    const text = buildExhaustionText([
      { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
      { account: 2, baseUrl: "https://api.b.com/v1", reason: "socket hang up" },
    ]);
    assert.ok(text?.includes("account 1 (https://api.a.com/v1) — HTTP 429"));
    assert.ok(text?.includes("account 2 (https://api.b.com/v1) — socket hang up"));
    assert.ok(text?.includes("LLM_ACCOUNTS"));
  });
});

describe("buildExhaustionText pool-truthful wording (D9)", () => {
  const failures: AccountFailure[] = [
    { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
    { account: 2, baseUrl: "https://api.b.com/v1", reason: "network error: socket hang up" },
  ];

  it("with poolSize the header reads X of N and survivors render by set-difference", () => {
    const text = buildExhaustionText(failures, 3);
    assert.ok(
      text?.startsWith("The LLM judge pool is exhausted — 2 of 3 LLM_ACCOUNTS accounts failed.\n"),
    );
    assert.ok(text?.includes("1. account 1 (https://api.a.com/v1) — HTTP 429"));
    assert.ok(text?.includes("account 2 (https://api.b.com/v1) — network error: socket hang up"));
    assert.ok(text?.includes("Still working this run: account 3."));
  });

  it("without poolSize the legacy body stands byte-identical (every-account header, no survivors)", () => {
    const text = buildExhaustionText(failures);
    assert.ok(
      text?.startsWith("The LLM judge pool is exhausted — every LLM_ACCOUNTS account failed.\n"),
    );
    assert.ok(!text?.includes("Still working"));
  });

  it("pluralizes the survivors line for multiple never-failed seats", () => {
    const text = buildExhaustionText(
      [{ account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" }],
      3,
    );
    assert.ok(text?.includes("Still working this run: accounts 2, 3."));
  });

  it("an X-of-N pool with no survivors renders no survivors line", () => {
    const text = buildExhaustionText(failures, 2);
    assert.ok(
      text?.startsWith("The LLM judge pool is exhausted — 2 of 2 LLM_ACCOUNTS accounts failed.\n"),
    );
    assert.ok(!text?.includes("Still working"));
  });
});

describe("sendExhaustionEmail", () => {
  const sampleConfig: EmailConfig = {
    user: "alerts@gmail.com",
    pass: "app-password",
    to: "alerts@gmail.com",
  };
  const failures: AccountFailure[] = [
    { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
  ];

  it("sends one alarm naming every failed account", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        captured = options;
        return { messageId: "msg-exh" };
      },
    } as unknown as Transporter;

    const messageId = await sendExhaustionEmail(failures, sampleConfig, mockTransport);
    assert.equal(messageId, "msg-exh");
    const mail = captured as { subject: string; text: string };
    assert.match(mail.subject, /judge pool exhausted/);
    assert.ok(mail.text.includes("account 1 (https://api.a.com/v1) — HTTP 429"));
  });

  it("sends nothing when the failure list is empty", async () => {
    let called = false;
    const mockTransport = {
      sendMail: async () => {
        called = true;
        return { messageId: "msg-x" };
      },
    } as unknown as Transporter;

    const messageId = await sendExhaustionEmail([], sampleConfig, mockTransport);
    assert.equal(messageId, undefined);
    assert.equal(called, false);
  });

  it("throws fail-visible when the transport fails", async () => {
    const mockTransport = {
      sendMail: async () => {
        throw new Error("SMTP connection timeout");
      },
    } as unknown as Transporter;

    await assert.rejects(
      () => sendExhaustionEmail(failures, sampleConfig, mockTransport),
      /email: failed to send: SMTP connection timeout/,
    );
  });

  it("subject reads X of N when poolSize rides", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        captured = options;
        return { messageId: "msg-23" };
      },
    } as unknown as Transporter;

    const midRun: AccountFailure[] = [
      { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
      { account: 2, baseUrl: "https://api.b.com/v1", reason: "network error: socket hang up" },
    ];
    const messageId = await sendExhaustionEmail(midRun, sampleConfig, mockTransport, 3);
    assert.equal(messageId, "msg-23");
    const mail = captured as { subject: string; text: string };
    assert.equal(mail.subject, "LLM judge pool exhausted (2 of 3 accounts failed)");
    assert.ok(mail.text.includes("Still working this run: account 3."));
  });

  it("legacy subject form stands without poolSize", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        captured = options;
        return { messageId: "msg-2" };
      },
    } as unknown as Transporter;

    const messageId = await sendExhaustionEmail(failures, sampleConfig, mockTransport);
    assert.equal(messageId, "msg-2");
    const mail = captured as { subject: string };
    assert.equal(mail.subject, "LLM judge pool exhausted (1 account failed)");
  });
});

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
    const digest = buildDigest(posts, { status: "stale", detail: "payload 2h old" }, LINE);
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

describe("halt-latch alarm (design 2026-11-09)", () => {
  it("builds a body that names the latch file, the reason, and the reset command", () => {
    const text = buildHaltAlarmText(
      "HTTP 429 rate limit — LinkedIn told this account to slow down",
    );
    assert.ok(text.includes("HALTED"));
    assert.ok(text.includes("state/linkedin-halt.flag"));
    assert.ok(text.includes("npm run reset-linkedin"));
    assert.ok(text.includes("HTTP 429 rate limit"));
  });

  it("sends a subject naming the remedy through the injected transport", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (o: unknown) => {
        captured = o;
        return { messageId: "m-halt" };
      },
    } as unknown as Transporter;
    const config: EmailConfig = { user: "a@b.c", pass: "pw" };
    const messageId = await sendHaltAlarm("budget spent", config, mockTransport);
    assert.equal(messageId, "m-halt");
    const mail = captured as { subject: string; text: string };
    assert.match(mail.subject, /halted — clear the latch/i);
    assert.ok(mail.text.includes("budget spent"));
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes for the slice: `npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --module nodenext --moduleResolution nodenext --target es2022 --lib es2023 --types node scripts/fetch-linkedin.ts src/email.ts tests/fetch-linkedin.test.ts tests/email.test.ts`
- [x] Suites pass: `npx tsx --test tests/fetch-linkedin.test.ts tests/email.test.ts` (30 + 12 tests) plus the Slices 1-3 suites stay green
- [x] Lint passes: `npx biome check scripts/fetch-linkedin.ts src/email.ts tests/fetch-linkedin.test.ts tests/email.test.ts`
- [x] Gate-order pins green: a latched tick = zero GETs + zero git spawns; a Saturday-noon tick = quiet no-op; a Monday-10:00 tick reaches the checkout guard; a spent-budget tick skips before any GET
- [x] Budget pins green: the ledger counts every GET and persists BEFORE each GET; a malformed file degrades to fresh with ONE warning naming the path
- [x] Latch pins green: a 429 walk trips the latch (flag content = HALT_RATE_LIMIT_REASON), alarms exactly once, writes no payload; a mid-walk budget exhaustion trips with HALT_BUDGET_REASON (the worker isHalt arm routes it); the trip never writes the leg-dead episode marker
- [x] `.gitignore` verified in a throwaway repo: `git status --porcelain` empty with budget + latch + marker present; `git check-ignore -v` matches both new paths

#### Manual Verification:
- [ ] Operator drill on the dedicated account: trip the latch under a controlled 429, confirm zero GETs while set, delete the flag, confirm the next tick resumes
- [ ] PC reboot mid-day: the budget file survives; the day total stays <= 150

---

## Phase 5: provenance + reset

### Overview
Provenance and the escape hatch: the FR-0 harvestedAt stamp (writer + tolerant resolver + fetchTick gate) and the reset command that clears the cookie file, the browser profile, and the latch — never the budget ledger.

**Files** (design Slice 5): `src/linkedin-session.ts`, `scripts/login-linkedin.ts`, `scripts/reset-linkedin.ts`, `scripts/fetch-linkedin.ts`, `package.json`, `tests/linkedin-session.test.ts`, `tests/login-linkedin.test.ts`, `tests/reset-linkedin.test.ts`, `tests/fetch-linkedin.test.ts`, `tests/linkedin-fetch.test.ts`
**Depends on**: Phase 4

### Changes Required:

#### 1. src/linkedin-session.ts
**File**: `src/linkedin-session.ts`
**Changes**: MODIFY — harvestedAt?: string joins the cookie shape; the resolver reads the stamp tolerantly (present + non-empty rides through trimmed, anything else leaves the key absent — the probe stays legacy-safe). Fragment fence: the interface + the resolver tail.

```typescript
// scripts/linkedin-session.ts — Slice 5 changes TWO units; the rest of the
// module stands unchanged (fail, canonicalJsessionid, readCookieField,
// buildCookieHeader, csrfToken, the storageState pair).

/** The resolved cookie pair; jsessionId is canonical (quotes stripped). */
export interface LinkedInCookies {
  readonly liAt: string;
  readonly jsessionId: string;
  /**
   * Machine-written harvest stamp (FR-0, design 2026-11-09): an ISO-8601
   * instant scripts/login-linkedin.ts records at harvest time. Optional on
   * read by contract — the resolver tolerates its absence (a legacy cookie
   * file keeps working for scripts/probe-linkedin.ts); ENFORCEMENT is the
   * fetchTick gate in scripts/fetch-linkedin.ts, where presence is required
   * and age is never checked.
   */
  readonly harvestedAt?: string;
}

// resolveLinkedInCookies' tail — replaces the resolver's final return:
  const doc = parsed as Record<string, unknown>;
  const where = `${envName} points at ${filePath} with`;
  const liAt = readCookieField(doc, "liAt", where);
  const jsessionId = canonicalJsessionid(readCookieField(doc, "jsessionid", where), where);
  // FR-0, tolerant read (design 2026-11-09): present + non-empty string rides
  // through trimmed; anything else leaves the key ABSENT — enforcement is the
  // fetchTick gate's job, never this resolver's (the probe must keep working
  // on a legacy stampless file).
  const stamp = doc.harvestedAt;
  return typeof stamp === "string" && stamp.trim() !== ""
    ? { liAt, jsessionId, harvestedAt: stamp.trim() }
    : { liAt, jsessionId };
```

#### 2. scripts/login-linkedin.ts
**File**: `scripts/login-linkedin.ts`
**Changes**: MODIFY — writeCookieFile gains the harvestedAt parameter (the CALLER owns the clock) and runLoginHelper stamps new Date(now()).toISOString() at harvest. Fragment fence.

```typescript
// scripts/login-linkedin.ts — Slice 5 adds the FR-0 stamp: writeCookieFile
// gains the harvestedAt parameter (the CALLER owns the clock — pinned-clock
// rule), and runLoginHelper stamps from its injected clock. Everything else
// stands unchanged.

/**
 * Atomic cookie-file write (sibling unique temp + rename, the state.ts
 * precedent): a crashed harvest never leaves a partial cookie file for
 * the next command to misread. `harvestedAt` is the machine-written FR-0
 * provenance stamp — an ISO-8601 instant the CALLER computes from its own
 * clock (pinned-clock rule: the clock never enters this writer), recorded
 * verbatim beside the pair. The fetchTick gate requires it; nothing here
 * or in the session resolver age-checks it.
 */
export async function writeCookieFile(
  pair: LinkedInCookiePair,
  filePath: string,
  harvestedAt: string,
): Promise<void> {
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, Date.now());
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      tempPath,
      `${JSON.stringify({ ...pair, harvestedAt }, null, 2)}
`,
      "utf8",
    );
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort temp cleanup
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`login-linkedin: cookie write failed for ${filePath}: ${message}`);
  }
}

// runLoginHelper's harvest line — replaces the writeCookieFile call:
    await writeCookieFile(pair, cookiePath, new Date(now()).toISOString());
```

#### 3. scripts/reset-linkedin.ts
**File**: `scripts/reset-linkedin.ts`
**Changes**: NEW — resetLinkedIn deletes the cookie file, the persistent browser profile, and the halt latch; the daily GET budget ledger deliberately stays; idempotent (absent = quiet no-op); entry-guarded main.

```typescript
/**
 * The LinkedIn session reset (design 2026-11-09, the FR-0 companion — the
 * operator's escape hatch for a bad or flagged harvest).
 *
 * Deletes the three artifacts a stale or flagged session leaves behind so
 * the operator can start clean with ONE command:
 *
 *   1. the cookie file (LINKEDIN_COOKIES_FILE, else DEFAULT_COOKIE_PATH)
 *   2. the persistent browser profile (DEFAULT_PROFILE_DIR)
 *   3. the operator-cleared halt latch (the fetch-linkedin.ts DEFAULT_LATCH)
 *
 * The daily GET budget ledger (DEFAULT_BUDGET) is DELIBERATELY KEPT: it is
 * a spend ledger, not session state. Deleting it would hand back a fresh
 * 150-GET budget on a day that already spent it — the exact over-fetch the
 * budget exists to prevent. A new day starts a fresh count on its own
 * (localDateKey), so nothing is lost by keeping it.
 *
 * Every path is reported; a missing path is a no-op, not an error — the
 * command is idempotent and safe to re-run. The .env line is left alone:
 * it still points at the cookie path the next login harvest will write.
 *
 * The latch and budget paths import from scripts/fetch-linkedin.ts — one
 * source of truth for each state path (a reset that deleted a flag the
 * fetch leg does not read would leave a reset that did not take).
 *
 * Entry-guarded main (the login-linkedin.ts idiom): importing the module
 * stays side-effect free — nothing is deleted on import.
 */
import { rm, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ENV_NAMES } from "../src/config.js";
import { envWithDotEnv } from "../src/env-file.js";
import { DEFAULT_BUDGET, DEFAULT_LATCH } from "./fetch-linkedin.js";
import { DEFAULT_COOKIE_PATH, DEFAULT_PROFILE_DIR } from "./login-linkedin.js";

export interface ResetLinkedInDeps {
  /** Environment for the cookie-path default. Default: envWithDotEnv(). */
  env?: Record<string, string | undefined>;
  /** Cookie file target. Default: LINKEDIN_COOKIES_FILE from the merged env, else DEFAULT_COOKIE_PATH. */
  cookiePath?: string;
  /** Browser profile dir. Default: DEFAULT_PROFILE_DIR. */
  profileDir?: string;
  /** Halt-latch flag. Default: DEFAULT_LATCH (exported by fetch-linkedin.ts). */
  latchPath?: string;
  /** Injectable remover. Default: rm(path, { recursive: true, force: true }). */
  remove?: (path: string) => Promise<void>;
}

export interface ResetLinkedInResult {
  /** Paths that existed and were removed. */
  removed: string[];
  /** Paths that did not exist (quiet no-op). */
  absent: string[];
  /** The daily GET budget ledger, deliberately kept (protects the account). */
  kept: string[];
}

async function existsAt(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete the cookie file, the browser profile, and the halt latch, in that
 * order, reporting every outcome. The budget ledger is intentionally NOT
 * touched (see the file header). Idempotent: a missing path lands in
 * `absent`, never an error; a deletion that truly fails throws naming the
 * path and the entry wrapper turns it into exit 1.
 */
export async function resetLinkedIn(deps: ResetLinkedInDeps = {}): Promise<ResetLinkedInResult> {
  const env = deps.env ?? envWithDotEnv();
  const fromEnv = env[ENV_NAMES.linkedinCookiesFile]?.trim();
  const cookiePath =
    deps.cookiePath ?? (fromEnv !== undefined && fromEnv !== "" ? fromEnv : DEFAULT_COOKIE_PATH);
  const profileDir = deps.profileDir ?? DEFAULT_PROFILE_DIR;
  const latchPath = deps.latchPath ?? DEFAULT_LATCH;
  const remove =
    deps.remove ?? ((path: string): Promise<void> => rm(path, { recursive: true, force: true }));

  const removed: string[] = [];
  const absent: string[] = [];
  for (const [label, target] of [
    ["cookie file", cookiePath],
    ["browser profile", profileDir],
    ["halt latch", latchPath],
  ] as const) {
    if (!(await existsAt(target))) {
      absent.push(target);
      console.log(`reset-linkedin: ${label} not present — ${target}`);
      continue;
    }
    try {
      await remove(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`reset-linkedin: could not remove the ${label} at ${target} — ${message}`);
    }
    removed.push(target);
    console.log(`reset-linkedin: removed ${label} — ${target}`);
  }
  console.log(
    `reset-linkedin: kept the daily GET budget ledger — ${DEFAULT_BUDGET} (the day's GET count protects the account, not the session)`,
  );
  return { removed, absent, kept: [DEFAULT_BUDGET] };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetLinkedIn().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`reset-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
```

#### 4. scripts/fetch-linkedin.ts
**File**: `scripts/fetch-linkedin.ts`
**Changes**: Slice 5's file-list expansion (ratified 2026-11-10): the FR-0 stamp gate in fetchTick plus the DEFAULT_LATCH/DEFAULT_BUDGET exports reset-linkedin imports. This delta applies on top of Phase 4's landed fence (the canonical Slice 4 fence is Phase 4 section 1).

```typescript
// (1) the two state-path constants gain export (Slice 4 keeps them module-local):
export const DEFAULT_LATCH = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-halt.flag");
export const DEFAULT_BUDGET = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-get-budget.json");

// (2) the FR-0 gate — insert after the cookies resolve, before the transport opens:
  // FR-0 (design 2026-11-09): the dedicated-account gate — the cookie file must
  // carry the machine-written "harvestedAt" stamp; presence required, age never
  // checked. A stampless file is a hand-exported or legacy file: fail BEFORE the
  // transport opens or any GET leaves, naming the one remedy (a re-harvest). The
  // loop treats this like any plain tick fault (warn + keep running); the
  // one-shot entry exits 1.
  if (cookies.harvestedAt === undefined) {
    throw new Error(
      'fetch-linkedin: the cookie file carries no machine-written "harvestedAt" stamp — run "npm run login-linkedin" to re-harvest the session (README: PC operations)',
    );
  }

// (3) scripts/reset-linkedin.ts (this slice) imports both paths:
// import { DEFAULT_BUDGET, DEFAULT_LATCH } from "./fetch-linkedin.js";
```

#### 5. package.json
**File**: `package.json`
**Changes**: MODIFY — the reset-linkedin script entry; scripts/reset-linkedin.ts joins the lint and format enumerations.

```typescript
// package.json — Slice 5 adds the reset command and enumerates the new
// script in BOTH lists (scripts are enumerated, never globbed — a missing
// entry silently exempts the file from npm run lint).

// scripts — inserted after the "login-linkedin" entry:
    "reset-linkedin": "tsx scripts/reset-linkedin.ts",

// lint — scripts/login-linkedin.ts gains scripts/reset-linkedin.ts after it:
    "lint": "biome check src tests scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/setup-curl-impersonate.ts scripts/hooks",

// format — same insertion:
    "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/setup-curl-impersonate.ts",
```

#### 6. tests/linkedin-session.test.ts
**File**: `tests/linkedin-session.test.ts`
**Changes**: MODIFY — Slice 5 appends the harvest-stamp describe to the resolver suite (the header comment gains the FR-0 line); every existing pin stands unchanged: a stampless pair resolves WITHOUT the key, a present stamp rides trimmed.

```typescript
// tests/linkedin-session.test.ts — Slice 5 appends one describe to the
// resolver suite (the header comment gains the FR-0 line). Every existing
// pin stands unchanged: a stampless PAIR resolves WITHOUT the key, so the
// deepEqual pins hold byte-for-byte.

describe("harvest stamp (FR-0, slice 5)", () => {
  it("carries a present stamp through, trimmed", async () => {
    const path = await cookieFile(
      JSON.stringify({
        liAt: "AQE",
        jsessionid: "ajax:1",
        harvestedAt: "  2026-11-10T00:00:00.000Z  ",
      }),
    );
    assert.deepEqual(resolveLinkedInCookies(envFor(path)), {
      liAt: "AQE",
      jsessionId: "ajax:1",
      harvestedAt: "2026-11-10T00:00:00.000Z",
    });
  });

  it("tolerates its absence — a legacy file resolves without the key", async () => {
    const path = await cookieFile(PAIR);
    const resolved = resolveLinkedInCookies(envFor(path));
    assert.deepEqual(resolved, {
      liAt: "AQE-test-li-at",
      jsessionId: "ajax:0123456789012345678",
    });
    assert.equal("harvestedAt" in resolved, false);
  });

  it("ignores a blank or non-string stamp", async () => {
    const blank = await cookieFile(
      JSON.stringify({ liAt: "AQE", jsessionid: "ajax:1", harvestedAt: "   " }),
    );
    const wrong = await cookieFile(
      JSON.stringify({ liAt: "AQE", jsessionid: "ajax:1", harvestedAt: 42 }),
    );
    assert.deepEqual(resolveLinkedInCookies(envFor(blank)), {
      liAt: "AQE",
      jsessionId: "ajax:1",
    });
    assert.deepEqual(resolveLinkedInCookies(envFor(wrong)), {
      liAt: "AQE",
      jsessionId: "ajax:1",
    });
  });
});
```

#### 7. tests/login-linkedin.test.ts
**File**: `tests/login-linkedin.test.ts`
**Changes**: MODIFY — STAMP beside JAR; writeCookieFile records the stamp verbatim + resolver readback; runLoginHelper stamps from the INJECTED clock.

```typescript
// tests/login-linkedin.test.ts — Slice 5 pins the stamp: STAMP rides beside
// JAR, writeCookieFile gains the stamp argument (a verbatim-file pin is
// added), and runLoginHelper stamps from the INJECTED clock with the
// resolver readback asserting harvestedAt. The timeout pin and the entry
// guard stand unchanged.
const STAMP = "2026-11-10T00:00:00.000Z";

describe("writeCookieFile", () => {
  it("writes the canonical JSON atomically and the session resolver reads it back", async () => {
    const path = await workPath("cookies.json");
    await writeCookieFile(
      { liAt: "AQE-live-li-at", jsessionid: '"ajax:0123456789012345678"' },
      path,
      STAMP,
    );
    const entries = await readdir(dirname(path));
    assert.ok(entries.every((entry) => !entry.endsWith(".tmp")));
    // The quoted-jar dialect resolves to the same canonical pair (slice 2 contract).
    assert.deepEqual(resolveLinkedInCookies({ [ENV_NAMES.linkedinCookiesFile]: path }), {
      liAt: "AQE-live-li-at",
      jsessionId: "ajax:0123456789012345678",
      harvestedAt: STAMP,
    });
  });

  it("records the FR-0 stamp verbatim in the file", async () => {
    const path = await workPath("stamped.json");
    await writeCookieFile({ liAt: "AQE", jsessionid: '"ajax:1"' }, path, STAMP);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      liAt: "AQE",
      jsessionid: '"ajax:1"',
      harvestedAt: STAMP,
    });
  });
});

// runLoginHelper's first pin — replaces the existing poll pin (the timeout
// pin and the entry-guard pin stand unchanged):
  it("polls until the jar holds the session, then writes the cookie file and the .env line", async () => {
    const cookiePath = await workPath("helper-cookies.json");
    const dotEnvPath = await workPath("helper.env");
    let polls = 0;
    const sleeps: number[] = [];
    let closed = false;
    const context: LoginContext = {
      cookies: async () => {
        polls += 1;
        return polls >= 3 ? JAR : JAR.filter((cookie) => cookie.name !== "li_at");
      },
      close: async () => {
        closed = true;
      },
    };
    const result = await runLoginHelper({
      openContext: async () => context,
      cookiePath,
      dotEnvPath,
      env: {},
      pollMs: 2_000,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      now: () => Date.UTC(2026, 10, 10, 0, 0, 0),
    });
    assert.deepEqual(result, { cookiePath, dotEnvUpdated: true });
    assert.deepEqual(sleeps, [2_000, 2_000]); // two empty polls, then the harvest
    assert.equal(closed, true);
    assert.equal(
      await readFile(dotEnvPath, "utf8"),
      `${ENV_NAMES.linkedinCookiesFile}=${cookiePath}\n`,
    );
    // The stamp comes from the injected clock, never the ambient one.
    assert.deepEqual(resolveLinkedInCookies({ [ENV_NAMES.linkedinCookiesFile]: cookiePath }), {
      liAt: "AQE-live-li-at",
      jsessionId: "ajax:0123456789012345678",
      harvestedAt: STAMP,
    });
  });
```

#### 8. tests/reset-linkedin.test.ts
**File**: `tests/reset-linkedin.test.ts`
**Changes**: NEW — the three targets land on OS temp and come back gone; the ledger stays; all-absent is a quiet no-op; the env-resolved cookie path is honored.

```typescript
/**
 * Offline suite for the session reset command (design 2026-11-09).
 *
 * Real files on OS temp: the suite creates the three delete targets (the
 * cookie file, the persistent profile dir, the halt-latch flag), runs the
 * reset over injected paths, and pins the contract — the three targets
 * gone, the daily GET budget ledger deliberately KEPT (the day's GET count
 * protects the account, not the session), and absent targets a quiet
 * no-op. Nothing inside the repo is touched.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { DEFAULT_BUDGET } from "../scripts/fetch-linkedin.js";
import { resetLinkedIn } from "../scripts/reset-linkedin.js";

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function target(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-reset-linkedin-"));
  return join(dir, name);
}

describe("resetLinkedIn", () => {
  it("deletes the cookie file, the profile dir, and the halt latch — and keeps the budget ledger", async () => {
    const cookiePath = await target("cookies.json");
    const profileDir = await target("chromium-profile");
    const latchPath = await target("linkedin-halt.flag");
    await writeFile(cookiePath, '{"liAt":"AQE","jsessionid":"ajax:1"}\n', "utf8");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "jar"), "x", "utf8");
    await writeFile(latchPath, "HTTP 429 rate limit\n", "utf8");

    const result = await resetLinkedIn({ cookiePath, profileDir, latchPath });
    assert.deepEqual(result, {
      removed: [cookiePath, profileDir, latchPath],
      absent: [],
      kept: [DEFAULT_BUDGET],
    });
    for (const path of [cookiePath, profileDir, latchPath]) {
      await assert.rejects(() => stat(path), /ENOENT/);
    }
  });

  it("is a quiet no-op when every target is already absent", async () => {
    const cookiePath = await target("absent-cookies.json");
    const profileDir = await target("absent-profile");
    const latchPath = await target("absent-halt.flag");
    const result = await resetLinkedIn({ cookiePath, profileDir, latchPath });
    assert.deepEqual(result, {
      removed: [],
      absent: [cookiePath, profileDir, latchPath],
      kept: [DEFAULT_BUDGET],
    });
  });

  it("uses the merged env for the cookie path when no override rides", async () => {
    const cookiePath = await target("env-cookies.json");
    await writeFile(cookiePath, "{}\n", "utf8");
    const profileDir = await target("env-profile");
    const latchPath = await target("env-halt.flag");
    const result = await resetLinkedIn({
      env: { LINKEDIN_COOKIES_FILE: cookiePath },
      profileDir,
      latchPath,
    });
    assert.deepEqual(result.removed, [cookiePath]);
    assert.deepEqual(result.absent, [profileDir, latchPath]);
  });
});
```

#### 9. tests/fetch-linkedin.test.ts
**File**: `tests/fetch-linkedin.test.ts`
**Changes**: Slice 5's file-list expansion: the shared COOKIES literal gains the stamp and the FR-0 stamp-gate describe appends. This delta applies on top of Phase 4's landed fence.

```typescript
const COOKIES: LinkedInCookies = {
  liAt: "AQE-test",
  jsessionId: "ajax:0123456789012345678",
  harvestedAt: "2026-11-10T00:00:00.000Z", // FR-0: present, age never checked
};

describe("FR-0 stamp gate (slice 5)", () => {
  it("rejects a stampless cookie file before the transport opens or any GET", async () => {
    const stampless: LinkedInCookies = {
      liAt: "AQE-test",
      jsessionId: "ajax:0123456789012345678",
    };
    const payloadPath = await workPath("payload-stamp.json");
    const latchPath = await workPath("latch-stamp.flag");
    const budgetPath = await workPath("budget-stamp.json");
    const gitCalls: string[] = [];
    const git: GitRunner = async (args) => {
      gitCalls.push(args.join(" "));
      return args[0] === "rev-parse" ? { code: 0, output: "main" } : { code: 0, output: "" };
    };
    await assert.rejects(
      () =>
        fetchTick({
          config: CONFIG,
          cookies: stampless,
          transport: {
            get: async () => {
              throw new Error("no GET may leave on a stampless tick");
            },
            dispose: async () => undefined,
          },
          git,
          payloadPath,
          latchPath,
          budgetPath,
          now: () => new Date(2026, 9, 26, 10, 0).getTime(),
          bypassWindow: true,
          env: {},
        }),
      /harvestedAt.*login-linkedin/,
    );
    // The gate sits after the checkout guard: two git reads happened, zero writes.
    assert.deepEqual(gitCalls, ["rev-parse --abbrev-ref HEAD", "status --porcelain"]);
    assert.equal(await exists(payloadPath), false);
  });
});
```

#### 10. tests/linkedin-fetch.test.ts
**File**: `tests/linkedin-fetch.test.ts`
**Changes**: Slice 5's 'every fetchTick cookie literal in the suites carries the stamp' criterion: the shared COOKIES literal gains the stamp. This delta applies on top of Phase 3's landed fence.

```typescript
const COOKIES: LinkedInCookies = {
  liAt: "AQE-test",
  jsessionId: "ajax:0123456789012345678",
  harvestedAt: "2026-11-10T00:00:00.000Z", // FR-0: present, age never checked
};
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes for the slice: `npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --module nodenext --moduleResolution nodenext --target es2022 --lib es2023 --types node src/linkedin-session.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/fetch-linkedin.ts tests/linkedin-session.test.ts tests/login-linkedin.test.ts tests/reset-linkedin.test.ts tests/fetch-linkedin.test.ts tests/linkedin-fetch.test.ts`
- [x] Suites pass: `npx tsx --test tests/linkedin-session.test.ts tests/login-linkedin.test.ts tests/reset-linkedin.test.ts tests/fetch-linkedin.test.ts tests/linkedin-fetch.test.ts` (107 tests) plus the Slices 1-4 suites stay green
- [x] Lint passes: `npx biome check src/linkedin-session.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/fetch-linkedin.ts tests/linkedin-session.test.ts tests/login-linkedin.test.ts tests/reset-linkedin.test.ts tests/fetch-linkedin.test.ts tests/linkedin-fetch.test.ts`
- [x] Stamp pins green: a present stamp rides through trimmed; a legacy stampless file resolves WITHOUT the key (probe-safe); blank and non-string stamps are ignored; writeCookieFile records the stamp verbatim; runLoginHelper stamps from the INJECTED clock, never the ambient one
- [x] FR-0 gate pins green: a stampless cookie file fails the tick naming "harvestedAt" + the re-harvest remedy, AFTER the checkout guard (git transcript = rev-parse + status) and BEFORE any GET; every fetchTick cookie literal in the suites carries the stamp
- [x] Reset pins green: cookie file + profile dir + halt latch removed; the budget ledger KEPT; absent targets a quiet no-op; the env-resolved cookie path honored
- [x] Project baseline: `npm run typecheck && npm run lint && npm test`

#### Manual Verification:
- [ ] Operator drill: `npm run login-linkedin` writes a stamped cookie file; hand-delete the harvestedAt key → the next `npm run fetch-linkedin` exits 1 naming the stamp; `npm run reset-linkedin` removes cookie + profile + latch, keeps the ledger, and the next login + fetch cycle works
- [ ] Legacy transition: a pre-Slice-5 stampless cookie file still passes `npm run probe-linkedin` (the resolver tolerates it), while the tick refuses it until the next harvest

---

## Phase 6: config

### Overview
The config contract hardens: exactly five linkedin surfaces enforced at load, and the committed fleet cut to the FRD spread so the 140-under-150 budget arithmetic stays legal.

**Files** (design Slice 6): `src/config-file.ts`, `watcher.config.json`, `tests/config-file.test.ts`
**Depends on**: Phase 4

### Changes Required:

#### 1. src/config-file.ts
**File**: `src/config-file.ts`
**Changes**: MODIFY — LINKEDIN_SURFACE_COUNT = 5 beside THREADS_HOST; the readSurfaces tail rejects any other linkedin count with the count in the message. Fragment fence.

```typescript
// src/config-file.ts — Slice 6 adds the FR-8 count rule: one constant beside
// THREADS_HOST, and the count check at the tail of readSurfaces (after every
// per-entry rule, so a malformed entry still fails on its own message first).

const THREADS_HOST = "www.threads.com";

/**
 * FR-8 (design 2026-11-09): exactly 5 linkedin surfaces — the PC leg's
 * account-safety arithmetic (worst-case wake-ups x surfaces x one page vs
 * the daily GET budget) assumes the fleet stays at five. The count is the
 * invariant, not the keywords: an operator may swap a surface's value,
 * never grow the fleet.
 */
const LINKEDIN_SURFACE_COUNT = 5;

// readSurfaces' tail — replaces the final "return out;":
  const linkedinCount = out.filter((surface) => surface.type === "linkedin").length;
  if (linkedinCount !== LINKEDIN_SURFACE_COUNT) {
    throw new Error(
      `config: ${filePath} has ${linkedinCount} linkedin surfaces — exactly ${LINKEDIN_SURFACE_COUNT} are required (the PC leg's daily GET budget assumes it); keep the five-surface spread`,
    );
  }
  return out;
}
```

#### 2. watcher.config.json
**File**: `watcher.config.json`
**Changes**: MODIFY — the linkedin fleet cuts from 17 (one exact duplicate) to the FRD five; threads surfaces, keywords, and everything else stand unchanged.

```typescript
// watcher.config.json — Slice 6 cuts the linkedin fleet from 17 (with one
// exact duplicate) to the FRD spread of 5. The threads surfaces, keywords,
// candidateTerms, negativeKeywords, platforms and recencyHours are
// UNCHANGED — only the linkedin entries are replaced.

// the surfaces array's linkedin entries, replacing all 17:
      {
         "type":"linkedin",
         "value":"hiring indonesia"
      },
      {
         "type":"linkedin",
         "value":"hiring jakarta"
      },
      {
         "type":"linkedin",
         "value":"hiring developer indonesia"
      },
      {
         "type":"linkedin",
         "value":"hiring engineer jakarta"
      },
      {
         "type":"linkedin",
         "value":"react indonesia"
      }
```

#### 3. tests/config-file.test.ts
**File**: `tests/config-file.test.ts`
**Changes**: MODIFY — VALID carries the five; the accept/reject matrix (4, 6, 0 rejected with the count in the message); the committed watcher.config.json resolves to the FRD five in order.

```typescript
// tests/config-file.test.ts — Slice 6 changes: VALID's surfaces gain the five
// linkedin entries (every writeConfig-based pin inherits them), the
// single-linkedin acceptance pin becomes the five-surface acceptance pin,
// the missing-platforms pin drops the platforms key from VALID (a
// zero-linkedin surface set would now fail the count rule first), the
// zero-linkedin pin uses two threads surfaces, and one new describe pins
// the FR-8 rule plus the committed spread.

const VALID = {
  keywords: ["react"],
  candidateTerms: ["developer"],
  surfaces: [
    { type: "tag", value: "hiring" },
    { type: "linkedin", value: "hiring indonesia" },
    { type: "linkedin", value: "hiring jakarta" },
    { type: "linkedin", value: "hiring developer indonesia" },
    { type: "linkedin", value: "hiring engineer jakarta" },
    { type: "linkedin", value: "react indonesia" },
  ],
  platforms: { linkedin: true, threads: true },
  recencyHours: 72,
};

describe("exactly five linkedin surfaces (FR-8, slice 6)", () => {
  const FIVE = [
    { type: "linkedin", value: "hiring indonesia" },
    { type: "linkedin", value: "hiring jakarta" },
    { type: "linkedin", value: "hiring developer indonesia" },
    { type: "linkedin", value: "hiring engineer jakarta" },
    { type: "linkedin", value: "react indonesia" },
  ];

  it("accepts exactly five linkedin surfaces and keeps their values", async () => {
    const path = await writeConfig({ ...VALID, surfaces: FIVE });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.surfaces, FIVE);
  });

  it("accepts five linkedin surfaces mixed with threads surfaces", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [
        { type: "tag", value: "hiring" },
        ...FIVE,
        { type: "url", value: "https://www.threads.com/@hiresflow" },
      ],
    });
    const config = await loadWatcherConfig(path);
    assert.equal(config.surfaces.filter((s) => s.type === "linkedin").length, 5);
    assert.equal(config.surfaces.length, 7);
  });

  it("rejects four linkedin surfaces", async () => {
    const path = await writeConfig({ ...VALID, surfaces: FIVE.slice(0, 4) });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /4 linkedin surfaces — exactly 5 are required/,
    );
  });

  it("rejects six linkedin surfaces", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [...FIVE, { type: "linkedin", value: "engineer indonesia" }],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /6 linkedin surfaces — exactly 5 are required/,
    );
  });

  it("rejects zero linkedin surfaces", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [
        { type: "tag", value: "hiring" },
        { type: "url", value: "https://www.threads.com/@hiresflow" },
      ],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /0 linkedin surfaces — exactly 5 are required/,
    );
  });

  it("keeps the committed spread at the FRD five", async () => {
    const config = await loadWatcherConfig("watcher.config.json");
    const linkedin = config.surfaces.filter((s) => s.type === "linkedin").map((s) => s.value);
    assert.deepEqual(linkedin, [
      "hiring indonesia",
      "hiring jakarta",
      "hiring developer indonesia",
      "hiring engineer jakarta",
      "react indonesia",
    ]);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes for the slice: `npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --module nodenext --moduleResolution nodenext --target es2022 --lib es2023 --types node src/config-file.ts tests/config-file.test.ts`
- [x] Suites pass: `npx tsx --test tests/config-file.test.ts` (46 tests) plus the Slices 1-5 suites stay green — full glob `npx tsx --test tests/*.test.ts` = 571 tests
- [x] Lint passes: `npx biome check src/config-file.ts tests/config-file.test.ts`
- [x] FR-8 pins green: exactly 5 accepted (values preserved); 5 mixed with threads surfaces accepted; 4, 6, and 0 rejected with the count in the message; the committed `watcher.config.json` resolves to the FRD five in order
- [x] Config cut verified: `node -e 'const c=require("./watcher.config.json"); console.log(c.surfaces.filter(s=>s.type==="linkedin").length)'` prints 5, and the duplicate `hiring developer jakarta` is gone
- [x] Project baseline: `npm run typecheck && npm run lint && npm test`

#### Manual Verification:
- [ ] Operator drill: add a sixth linkedin surface to `watcher.config.json` → `npm start` exits 1 naming the count and the five-surface spread; remove one → same; swap a value → accepted
- [ ] Confirm the hosted run still reads the payload with the cut fleet (the PC leg walks 5 surfaces per tick, worst case 140 GETs < the 150 budget)

---

## Testing Strategy

### Automated:
- Whole-plan gate: `npm run typecheck && npm run lint && npm test` (the CI trio; all three read-only)
- Per-phase: the scoped `npx tsc --noEmit`, `npx tsx --test`, and `npx biome check` commands in each phase's Automated Verification block (none of them write)

### Manual Testing Steps:
1. `npm run probe-linkedin` twice, >=6 h apart, on the dedicated account before trusting the loop (the live 429 body shape is unverified; re-run after any LINKEDIN_TRANSPORT change)
2. Operator drill: trip the latch under a controlled 429; confirm zero GETs while set; delete the flag; confirm the next tick resumes
3. PC reboot mid-day: the budget file survives; the day total stays <= 150
4. `npm run login-linkedin` writes a stamped cookie file; hand-delete harvestedAt and the next `npm run fetch-linkedin` exits 1 naming the stamp; `npm run reset-linkedin` removes cookie + profile + latch and keeps the ledger; a legacy stampless file still passes `npm run probe-linkedin`
5. Add a sixth linkedin surface and `npm start` exits 1 naming the count and the spread; remove one and the same happens; swap a value and it is accepted

## Performance Considerations

## Performance Considerations

- The budget wrapper adds one counter increment + one comparison per GET — negligible.
- The shuffle is O(n) over 5 surfaces.
- The cadence sampler is one rng draw per tick.
- The latch check is one `readFile` per tick, before any GET.
- No new runtime dependency; no new load path on the hosted watcher.

## Migration Notes

## Migration Notes

- `state/linkedin-get-budget.json` is new, PC-local, untracked via a `.gitignore`
  entry Slice 4 adds (verified: the marker's entry alone does not cover it — review
  finding 2026-11-09). Same discipline as the episode marker: repo-local,
  persistent, never committed.
- `state/linkedin-halt.flag` is new, PC-local, untracked via the same `.gitignore`
  amendment.
- The cookie file gains a `harvestedAt` key; `resolveLinkedInCookies` tolerates its
  absence during the transition (presence is enforced at the `fetchTick` gate, not the
  resolver), so an existing file keeps working until the next harvest.
- `watcher.config.json` loses 12 linkedin surfaces — a committed config edit, no data
  migration.
- Rollback: revert the commit; the new state files are inert to the old code.

## Developer Context

Step 4 reviewers ran inline (this harness has no subagent tool — the same substitute the design phase disclosed). Findings and triage land in the `## Plan Review (Step 4)` section below.

Artifact size ~236 KB: `implement` and `validate` sessions must page by byte offset (`tail -c +N | head -c M`) or section anchors — never front-to-back.

Step 5.2 read-back gate (added after the 2026-11-10 blocker): before `status: ready`, a rebuild must pass — frontmatter `phases:` count equals `## Phase N:` headings, every fence's relative imports resolve at HEAD or in a same/earlier-phase fence of the same module, Phase 4 sections carry zero `harvestedAt` references, the FR-0 gate appears exactly once (the Phase 5 delta), no bare `**Changes**: MODIFY` lines, no stale prose, and every phase's Success Criteria stay byte-verbatim vs the design's matching slice.

## References

- Design: `.rpiv/artifacts/designs/2026-11-09_19-24-42_linkedin-humanlike-fetch-behavior.md`
- Solution analysis: `.rpiv/artifacts/solutions/2026-11-09_18-19-49_linkedin-humanlike-fetch-behavior.md`
- Research: `.rpiv/artifacts/research/2026-11-09_18-06-34_linkedin-humanlike-fetch-behavior.md`
- FRD: `.rpiv/artifacts/discover/2026-11-09_17-29-56_linkedin-humanlike-fetch-behavior.md`
- Restriction post-mortem: `outputs/linkedin-restriction-prevention.md`

## Plan Review (Step 4)

_Independent post-finalization review of every Phase code fence (code dimension) and every `## Verification Notes` entry (coverage dimension), run inline against the live codebase at HEAD — this harness has no subagent tool (the design phase's disclosed substitute). Re-run .rpiv/tmp/readback-gate.mjs after every rebuild._

Code dimension: all 23 main fences byte-copied from the split design; HEAD seams re-verified — SleepFn exported (linkedin-fetch.ts:57), PACE_MIN_MS/PACE_MAX_MS only in the Phase 3 fence, writeCookieFile/login exports, readSurfaces tail, ENV_NAMES, package.json lint/format baselines, .gitignore baseline, 17 linkedin surfaces, email builder+sender pair, probe structural bypass (FR-6), the two NEW files absent, all MODIFY test files present, fetchLinkedInPosts has exactly one non-test caller (Phase 4 rewrites it). Cross-phase compile walk added after the blocker: Phase 4 sections carry zero `harvestedAt` references; the FR-0 gate appears exactly once, in the Phase 5 delta.

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 4 §1 + §4, Phase 3 §3 | design Architecture fences (scripts/fetch-linkedin.ts, tests/fetch-linkedin.test.ts, tests/linkedin-fetch.test.ts) | blocker | actionability | Final-state design fences carried Slice 5 material (the FR-0 gate, the exported DEFAULT_LATCH/DEFAULT_BUDGET, the stamped COOKIES literals) into Slices 3-4 — those phases' own scoped tsc fails with TS2339 / excess-property on harvestedAt before Phase 5 lands (developer review, 2026-11-10) | Split upstream in the design: per-slice main fences + #### Slice 5 delta fragments; Slice 5 Files gains tests/linkedin-fetch.test.ts; rebuild the plan | applied upstream: design fence split (2026-11-10) + plan rebuild; Phase 4 sections now carry zero harvestedAt references (grep-verified) |
| coverage | Verification Notes §4 | .rpiv/guidance/tests/architecture.md | concern | verification-coverage | The guidance amendment ("watch-linkedin.ts — NO TESTS BY DESIGN" line) has no owning phase; the design defers it to "implement" but no phase lists it | Attach the one-line amendment to Phase 2's Changes Required, or record an explicit deferral | applied: Phase 2 Changes Required carries the guidance-amendment line |
| code | Phase 5 Success Criteria (AV 1) | scripts + tests type surface | suggestion | codebase-fit | Slice 5's scoped tsc adds --skipLibCheck; Slices 1-4 omit it — per-phase type strictness differs | Keep pass-through (design gate-verified each slice green; S5 pulls playwright/nodemailer-typed scripts) | dismissed: pass-through — the design gate-verified every slice green as written |
| coverage | Verification Notes §3 | scripts/fetch-linkedin.ts readBudgetState | suggestion | verification-coverage | "absent -> fresh, quiet" has no explicit criteria bullet; covered implicitly (the S4 ledger pin starts from an absent file; Phase 1 pins freshBudget) | Accept implicit coverage (dismiss), or add an explicit Phase 4 pin via a design follow-up | dismissed: covered implicitly — Phase 1 pins freshBudget and the Phase 4 ledger pin starts from an absent file |
| coverage | Verification Notes §6 | (this artifact — ~234 KB) | suggestion | verification-coverage | The artifact-size / --resume paging note applies to this plan too; implement/validate sessions should page by offset | Add one Developer Context line naming byte-offset paging for this artifact | applied: Developer Context names byte-offset paging |
| coverage | Step 4 review scope | this plan's review process | suggestion | review-coverage | The inline code review was a HEAD-seam check, not a cross-phase compile walk; no read-back of the composed plan happened before status: ready | Add a read-back gate: frontmatter-vs-headings match, per-fence import resolution, criteria-verbatim vs design, unfilled-resolution check | applied: .rpiv/tmp/readback-gate.mjs (139 imports, 26 fences, criteria-verbatim) must pass before handoff |

_Tally: 1 blocker, 1 concern, 4 suggestions — 4 applied, 2 dismissed. All resolutions filled._

## Follow-up (2026-11-10 15:38:14 +0700)

Revise run (operator transcript: two `npm run probe-linkedin` failures). The failures were a transient DNS outage — verified from this machine 2026-11-10 ~15:45: `nslookup` (system resolver + 1.1.1.1) resolves `www.linkedin.com`, no proxy configured, and the impersonate binary itself returns 200 from `https://www.linkedin.com/` (5.8 s default, 0.48 s with `-4`). No transport change needed. The transcript exposed a real defect instead: `createCurlTransport`'s exec-failure catch forwarded Node's `execFile` error message — which embeds the ENTIRE command line, cookie + csrf-token headers included — so a probe failure printed the operator's live cookie jar to the console. Phase 3 gains the sanitization fix (exit code + stderr excerpt only) and an unchecked credential-leak pin (suites 45+13 -> 46+13); the old exec-failure test is rewritten to assert the sanitized shape. Operator actions recorded outside this plan: re-harvest the cookie jar (the leaked `li_at` transited a chat transcript), then start the probe protocol (two runs >= 6 h apart).

Post-edit gate audit: `.rpiv/tmp/readback-gate.mjs` run against the revised plan fails only its criteria-verbatim check — and re-run against the PRE-revise plan (git HEAD extract) fails the same six phases, so the redness pre-dates this revision. Root cause is in the gate, not the plan: it compares the plan's criteria block against the design slice's ENTIRE body (everything between `### Slice N:` and the next slice, minus `**Files**` lines — Overview prose, Changes Required, and code fences included). Plan criteria can never byte-equal a whole slice body; the check is structurally unsatisfiable and was already red at handoff. The gate's structural checks (139 imports / 26 fences / headings / markers / stale prose) all PASS on the revised plan. The unsatisfiable comparison is upstream tooling (`implement`-generated scratch) — the design slices' criteria sections, not whole bodies, are what that check should compare.

Amendment (post-review, same day): the review caught a diagnosability hole in this revision — the sanitized message accepted only numeric exit codes, but a missing binary rejects with the string `code: "ENOENT"` and no stderr, which would have printed `(exit unknown): no stderr captured` and buried the one fact the operator needs. The fence now accepts number-or-string codes, the criterion wording widened, and the test carries a second ENOENT-shaped double (rule: test doubles must reproduce the real system's failure shape, including its leak paths).
