---
date: 2026-11-06T18:36:57+0700
author: Yogiswara Utama
commit: 04424f5
branch: main
repository: loker-watcher
topic: "Spread LLM judge load across all accounts using probe-measured per-account ceilings"
tags: [plan, judge, judge-rotation, judge-ceilings, probe-judge, watch-workflow]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md"
phase_count: 6
phases:
  - { n: 1, title: "Ceilings module", files: [src/judge-ceilings.ts, tests/judge-ceilings.test.ts, src/config.ts], depends_on: [] }
  - { n: 2, title: "Spread mechanism", files: [src/judge-rotation.ts, src/judge.ts, src/index.ts, src/config.ts, tests/judge-rotation.test.ts, tests/judge.test.ts, tests/judge-helpers.ts], depends_on: [1] }
  - { n: 3, title: "Probe persistence + commit-back", files: [scripts/probe-judge.ts, .github/workflows/watch.yml, scripts/commit-state-rebase.sh, tests/commit-state-rebase.test.ts], depends_on: [2] }
  - { n: 4, title: "Docs sync + validation", files: [.rpiv/guidance/architecture.md, .rpiv/guidance/src/architecture.md, .rpiv/guidance/.github/workflows/architecture.md, .rpiv/guidance/scripts/architecture.md, README.md, AGENTS.md], depends_on: [3] }
  - { n: 5, title: "Deep ramp + sequential dispatch", files: [scripts/probe-judge.ts, .github/workflows/watch.yml, README.md, .rpiv/guidance/.github/workflows/architecture.md, .rpiv/guidance/scripts/architecture.md], depends_on: [3] }
  - { n: 6, title: "Parallel account walk", files: [scripts/probe-judge.ts, .rpiv/guidance/scripts/architecture.md], depends_on: [5] }
last_updated: 2026-11-07T15:27:13+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Phase 6 added (operator feedback, Actions run 42354544399): probe walks all accounts concurrently (Promise.allSettled) — wall time = the slowest account, not the sum; ramp logs gain the account label"
---

# Spread LLM judge load across all accounts using probe-measured per-account ceilings — Implementation Plan

## Overview

Four-phase implementation of the finalized design (`.rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md`), inheriting its slice boundaries 1:1. Every dispatch starts at the next account: `RotationState` grows required members (per-index ceilings, an in-flight map, a dispatch-sequence counter, and a release-waiter queue), the pick scans from `counter % N` and advances only on a fresh claim, and ceiling-blocked dispatches await a deferred resolved by the next release decrement — zero budget charge, so the 180s park budget and the exhaustion alarm stay exclusive to cooldown parks. The probe writes live-only per-account ceilings to a committed `state/judge-ceilings.json` before its dead gate, and the probe job commits it via `scripts/commit-state-rebase.sh`; `JUDGE_CONCURRENCY` is deleted outright and width becomes Σ per-index ceilings derived inside `judgePosts`.

## Desired End State

```typescript
// watch.yml Run watcher step — no JUDGE_CONCURRENCY literal; width is derived:
// 5 accounts × ceilings [4,2,4,1,4] → 15 in-flight, first 5 calls hit 5 distinct hosts.
const ceilings = await loadAccountCeilings(accounts); // state/judge-ceilings.json, degrade-everything
const { judged, skippedPostIds } = await judgePosts(
  newPosts, accounts, config.keywords, deps.fetchFn, config.reasoningEffort, ceilings, now, sleepFn,
);
```

Verified by: the FRD acceptance test (first 5 judge calls of a 50-post run hit 5 distinct accounts), per-account peak ≤ ceiling across both judge phases, zero-budget-charge pin on all-at-ceiling parks, the ceilings-skip and mixed-conflict commit-back pins, and repo-wide `JUDGE_CONCURRENCY` retirement greps.

## What We're NOT Doing

- Staleness bounds on the ceilings file (settled: none — dispatch-only cadence makes days-old readings legitimate).
- Changing the 180s budget, `WAKE_JITTER_MS`, or the exhaustion alarm.
- Touching fallback-phase `FALLBACK_CALL_BUDGET` semantics (already ceiling-safe by check ordering, `src/judge.ts:778-780`).
- An E2E harness for single-credential env vars (FRD follow-up, unverified this session).

---

## Phase 1: Ceilings module

### Overview

The foundation phase: the degrade-never-throws ceilings reader the watch run consumes and the atomic writer the probe job calls, plus the committed-file path constant. Lands alone so Phase 2's `src/index.ts` import and Phase 3's probe write compile against it. Every account without a usable committed entry floors at ceiling 1 with exactly one warning naming its baseUrl; the file never fails a run.

### Changes Required:

#### 1. NEW ceilings module
**File**: `src/judge-ceilings.ts`
**Changes**: NEW file — the fourth reader doctrine (committed measured data, degrade-everything, between `loadState`'s ENOENT-only and `readPayloadPosts`' degrade-everything): pure `resolveCeilings` (warnings RETURNED, never printed, so tests assert the array), the fs-reading `loadAccountCeilings` wrapper (absent → quiet floor at 1; malformed/non-object → reason warn + floor; keys trimmed on both sides), and `writeCeilingsAtomic` (sibling unique temp + rename, the `writeStateAtomic` shape — lives in `src/` not `scripts/` so the write path is unit-testable, since the probe script has no test suite).

```typescript
/**
 * Probe-measured per-account judge ceilings: the flat {baseUrl: ceiling}
 * map the probe job commits to state/judge-ceilings.json, resolved into
 * the index-keyed ceilings the rotation state enforces.
 *
 * Reader doctrine — a fourth kind between loadState (ENOENT-only degrade)
 * and readPayloadPosts (degrade-everything): a COMMITTED measured-data
 * file whose absence or corruption must never fail a run. Every account
 * without a usable entry is floored at ceiling 1 with exactly one warning
 * naming its baseUrl; the judged output is unchanged. Pool entries that
 * share one baseUrl share one ceiling silently — warnings are for missing
 * data, not for endpoint identity. File keys are trimmed before matching
 * because parseLlmAccounts trims baseUrl (src/judge.ts:163-172) and a
 * stray-space key must not silently miss into the default.
 *
 * The writer lives here (not in scripts/) so the write path is
 * unit-testable: the probe script has no test suite, and this module is
 * its only automated coverage (the writeStateAtomic precedent).
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { JUDGE_CEILINGS_PATH } from "./config.js";
import type { LlmAccount } from "./judge.js";
import { stateTempPath } from "./state.js";

/** The committed file shape: trimmed baseUrl -> positive integer ceiling. */
export type CeilingsFile = Record<string, number>;

/** Result of the pure resolver: index-keyed ceilings plus the warnings. */
export interface ResolvedCeilings {
  ceilings: Map<number, number>;
  warnings: readonly string[];
}

/** One ceiling a value must pass to be usable: a positive integer. */
function usableCeiling(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

/**
 * Resolve the index-keyed ceiling map for one account pool from the parsed
 * ceilings file (undefined when the file is absent, unreadable, or not a
 * JSON object). Never throws: every failure mode degrades to ceiling 1
 * plus a warning. Pure — warnings are RETURNED, not printed, so the
 * acceptance test asserts the array and the wrapper owns the console.
 */
export function resolveCeilings(
  accounts: readonly LlmAccount[],
  parsed: CeilingsFile | undefined,
): ResolvedCeilings {
  const byKey = new Map<string, number>();
  if (parsed !== undefined) {
    for (const [key, value] of Object.entries(parsed)) {
      const usable = usableCeiling(value);
      if (usable !== undefined) byKey.set(key.trim(), usable);
    }
  }
  const ceilings = new Map<number, number>();
  const warnings: string[] = [];
  for (const [index, account] of accounts.entries()) {
    const key = account.baseUrl.trim();
    const ceiling = byKey.get(key);
    if (ceiling === undefined) {
      ceilings.set(index, 1);
      warnings.push(
        `judge: no usable ceiling for ${key} — capping at 1 (slow waves until the probe commits ${JUDGE_CEILINGS_PATH})`,
      );
    } else {
      ceilings.set(index, ceiling);
    }
  }
  return { ceilings, warnings };
}

/**
 * Read + resolve the ceilings file for one account pool. Never throws
 * (the degrade doctrine): an absent file is the normal first-run state
 * and floors every account at ceiling 1; an unreadable or non-object file
 * warns with the reason and does the same. Prints each resolveCeilings
 * warning once (they already carry the judge: prefix).
 */
export async function loadAccountCeilings(
  accounts: readonly LlmAccount[],
  filePath: string = JUDGE_CEILINGS_PATH,
): Promise<Map<number, number>> {
  let parsed: CeilingsFile | undefined;
  try {
    const json: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      console.warn(`judge: ${filePath} is not a JSON object — treating as absent`);
    } else {
      parsed = json as CeilingsFile;
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
    parsed = undefined;
  }
  const { ceilings, warnings } = resolveCeilings(accounts, parsed);
  for (const warning of warnings) {
    console.warn(warning);
  }
  return ceilings;
}

/**
 * Write the ceilings map atomically (sibling unique temp + rename, the
 * writeStateAtomic shape): a crashed probe never leaves a partial file.
 * The probe job is the only writer (single-writer doctrine, the
 * JUDGE_CEILINGS_PATH doc-comment in src/config.ts).
 */
export async function writeCeilingsAtomic(
  entries: CeilingsFile,
  filePath: string = JUDGE_CEILINGS_PATH,
  now: () => number = Date.now,
): Promise<void> {
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, now());
  const jsonContent = `${JSON.stringify(entries, null, 2)}\n`;
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
    throw new Error(`ceilings: atomic write failed for ${filePath}: ${message}`);
  }
}
```

#### 2. NEW ceilings test suite
**File**: `tests/judge-ceilings.test.ts`
**Changes**: NEW file — the `resolveCeilings` matrix (map-by-index; missing entry floors at 1 with exactly one warning naming the baseUrl; undefined file → all-1; zero/fractional/non-numeric treated as missing with the fractional case asserted in its own `it`; shared baseUrl shares silently; keys trimmed on both sides), the `loadAccountCeilings` degrade classes (absent quiet with no reason warn; malformed reason warn; array file; partial file → exactly one floor warning per missing account), the atomic-write round-trip through `loadAccountCeilings`, and the failed-write error shape `/^ceilings: atomic write failed for /`.

```typescript
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type CeilingsFile,
  loadAccountCeilings,
  resolveCeilings,
  writeCeilingsAtomic,
} from "../src/judge-ceilings.js";
import type { LlmAccount } from "../src/judge.js";

/** Two accounts with distinct hosts — the missing-entry case needs one. */
const ACCOUNTS: LlmAccount[] = [
  { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
  { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
];

describe("resolveCeilings", () => {
  it("maps each account's committed ceiling by index", () => {
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, {
      "https://account-one.api/v1": 4,
      "https://account-two.api/v1": 2,
    });
    assert.deepEqual([...ceilings.entries()], [
      [0, 4],
      [1, 2],
    ]);
    assert.deepEqual(warnings, []);
  });

  it("floors a missing account at ceiling 1 with exactly one warning naming the baseUrl", () => {
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, { "https://account-one.api/v1": 4 });
    assert.equal(ceilings.get(0), 4);
    assert.equal(ceilings.get(1), 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /account-two\.api/);
  });

  it("treats an undefined file as every account missing", () => {
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, undefined);
    assert.deepEqual([...ceilings.entries()], [
      [0, 1],
      [1, 1],
    ]);
    assert.equal(warnings.length, 2);
  });

  it("treats zero, fractional, and non-numeric entries as missing", () => {
    const parsed = {
      "https://account-one.api/v1": 0,
      "https://account-two.api/v1": "4",
    } as unknown as CeilingsFile;
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, parsed);
    assert.deepEqual([...ceilings.entries()], [
      [0, 1],
      [1, 1],
    ]);
    assert.equal(warnings.length, 2);
  });

  it("treats a fractional ceiling as missing", () => {
    const parsed = { "https://account-one.api/v1": 2.5 } as unknown as CeilingsFile;
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, parsed);
    assert.equal(ceilings.get(0), 1);
    assert.equal(warnings.length, 2); // account-one floors; account-two was never present
  });

  it("shares one ceiling silently across pool entries with the same baseUrl", () => {
    const twins: LlmAccount[] = [
      { baseUrl: "https://twin.api/v1", apiKey: "key-a", model: "model-a" },
      { baseUrl: "https://twin.api/v1", apiKey: "key-b", model: "model-b" },
    ];
    const { ceilings, warnings } = resolveCeilings(twins, { "https://twin.api/v1": 2 });
    assert.deepEqual([...ceilings.entries()], [
      [0, 2],
      [1, 2],
    ]);
    assert.deepEqual(warnings, []);
  });

  it("matches keys after trimming on both sides", () => {
    const parsed = { " https://account-one.api/v1 ": 4 } as unknown as CeilingsFile;
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, parsed);
    assert.equal(ceilings.get(0), 4);
    assert.deepEqual(
      warnings.filter((warning) => warning.includes("account-one")),
      [],
    );
  });
});

describe("writeCeilingsAtomic + loadAccountCeilings", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  /** Lazy temp dir, one per suite (tests/state.test.ts idiom). */
  const path = async (name: string): Promise<string> => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-judge-ceilings-"));
    return join(dir, name);
  };

  it("round-trips: write then load resolves the committed ceilings", async () => {
    const target = await path("round-trip.json");
    await writeCeilingsAtomic(
      { "https://account-one.api/v1": 4, "https://account-two.api/v1": 2 },
      target,
    );
    const stored = JSON.parse(await readFile(target, "utf8")) as CeilingsFile;
    assert.deepEqual(stored, {
      "https://account-one.api/v1": 4,
      "https://account-two.api/v1": 2,
    });
    assert.deepEqual([...(await loadAccountCeilings(ACCOUNTS, target)).entries()], [
      [0, 4],
      [1, 2],
    ]);
  });

  it("an absent file floors every account at ceiling 1 — quiet, no reason warn", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const ceilings = await loadAccountCeilings(ACCOUNTS, await path("absent.json"));
    assert.deepEqual([...ceilings.entries()], [
      [0, 1],
      [1, 1],
    ]);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.length, 2); // one floor warning per account, no file-reason line
    assert.match(lines[0] ?? "", /no usable ceiling for https:\/\/account-one\.api/);
  });

  it("a malformed file degrades to ceiling 1 with a reason warning", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("malformed.json");
    await writeFile(target, "{not json", "utf8");
    const ceilings = await loadAccountCeilings(ACCOUNTS, target);
    assert.deepEqual([...ceilings.entries()], [
      [0, 1],
      [1, 1],
    ]);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /unreadable/);
    assert.equal(lines.length, 3); // reason + one floor warning per account
  });

  it("a non-object file (an array) degrades to ceiling 1", async () => {
    const target = await path("array.json");
    await writeFile(target, "[1, 2]", "utf8");
    const ceilings = await loadAccountCeilings(ACCOUNTS, target);
    assert.deepEqual([...ceilings.entries()], [
      [0, 1],
      [1, 1],
    ]);
  });

  it("prints exactly one warning per missing account when the file carries only some", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("partial.json");
    await writeCeilingsAtomic({ "https://account-one.api/v1": 4 }, target);
    const ceilings = await loadAccountCeilings(ACCOUNTS, target);
    assert.equal(ceilings.get(0), 4);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    const floors = lines.filter((line) => line.includes("no usable ceiling"));
    assert.equal(floors.length, 1);
    assert.match(floors[0] ?? "", /account-two\.api/);
  });

  it("a failed write names the target", async () => {
    const blocker = await path("blocker");
    await writeFile(blocker, "occupies the directory slot", "utf8");
    await assert.rejects(
      () =>
        writeCeilingsAtomic({ "https://account-one.api/v1": 1 }, join(blocker, "ceilings.json")),
      (error: unknown) => {
        assert.match((error as Error).message, /^ceilings: atomic write failed for /);
        return true;
      },
    );
  });
});
```

#### 3. Ceiling path constant
**File**: `src/config.ts`
**Changes**: add `JUDGE_CEILINGS_PATH` after `LINKEDIN_PAYLOAD_PATH` with the single-writer doc-comment (the probe job is the ONLY writer — live-only readings before its dead-account gate; the watch run is the only reader; a flat `{baseUrl: ceiling}` map with no version or timestamp; readings legitimately age for days; the 429 rotation remains the correctness net). The sibling hunk in this same file (the `ENV_NAMES` `judgeConcurrency` deletion) belongs to Phase 2.

```typescript
// === HUNK — after LINKEDIN_PAYLOAD_PATH: the committed ceilings path ===
/**
 * Probe-measured per-account judge ceilings (single-writer doctrine, the
 * LINKEDIN_PAYLOAD_PATH shape): the probe job is the ONLY writer — it
 * commits live-only readings before its dead-account gate — and the watch
 * run is the only reader (src/judge-ceilings.ts). A flat {baseUrl: ceiling}
 * map with no version or timestamp: the probe runs dispatch-only, so
 * readings legitimately age for days, and the 429 rotation remains the
 * correctness net (a stale optimistic ceiling costs throughput, never
 * correctness). A missing entry floors that account at ceiling 1 with one
 * warning; the file never fails a run (src/judge-ceilings.ts).
 */
export const JUDGE_CEILINGS_PATH = "state/judge-ceilings.json";
```

(The sibling hunk in this file — the `ENV_NAMES` `judgeConcurrency` deletion — belongs to Phase 2.)

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] resolveCeilings matrix green: happy map by index; missing entry floors at 1 with exactly one warning naming the baseUrl; undefined file → all-1; zero/fractional/non-numeric treated as missing (fractional asserted in its own case); shared baseUrl shares silently; keys trimmed on both sides
- [x] loadAccountCeilings degrades: absent → all-1 with no reason warn; malformed → reason warn + all-1; array file → all-1; partial file → exactly one floor warning per missing account
- [x] writeCeilingsAtomic round-trips through loadAccountCeilings; a failed write rejects with `/^ceilings: atomic write failed for /`

#### Manual Verification:
- [x] The floor warning reads as operator guidance: names the baseUrl and points at the probe-committed file

---

## Phase 2: Spread mechanism

### Overview

The spread mechanism itself. `RotationState` grows four required members (`ceilings`, `inFlight`, `dispatchCounter`, `ceilingWaiters` — required fields make `tsc --noEmit` enumerate all three construction literals). The pick scans from the dispatch dial and skips cooling AND at-ceiling accounts; claim/release bracket every HTTP attempt inside a release-guarded try whose finally covers all seven exit paths; the status ladder returns an `AttemptDirective` so the 5xx backoff sleep and the 429 rewind run with the slot released (D7), with a frame-local `pinnedStart` keeping the same-account 5xx retry from rotating. All-at-ceiling picks park on the release-waiter queue at ZERO budget charge (D4); only cooldown parks draw the 180s budget. Pool width = Σ per-account ceilings derived inside `judgePosts` (no overall clamp, D1); the `judgeCeilings` dep seam mirrors `linkedinFetch` (D3). `JUDGE_CONCURRENCY` is deleted across registry, parser, default, docblock, feed, param, and tests (D5 — code scope; workflow literal is Phase 3, docs are Phase 4).

### Changes Required:

#### 1. Rotation state + dial pick + claim/release/waiter helpers
**File**: `src/judge-rotation.ts`
**Changes**: module docblock grows the spread model (D1/D6); `RotationState` gains `ceilings`, `inFlight`, `dispatchCounter`, `ceilingWaiters` as required members; `pickEligibleAccount` scans FROM the dial (`dispatchCounter % poolSize`) with an optional `startAt` seat pin (the 5xx retry — a start hint, not a guarantee) and never advances the dial (D6); `coolAccount`'s fresh stamp wakes ceiling waiters; NEW helpers follow F010 ownership in this module — `wakeCeilingWaiters` (private), `claimAccount` (increment + dial advance), `releaseAccount` (decrement with zero-clamp + wake), `waitCeilingSlot` (zero-charge deferred, registered in the pick's sync window), `earliestCooldown` (earliest active expiry for the D4 flavor split); `parkUntilEligible` re-derived on `earliestCooldown` (charge-before-sleep, overshoot deduction, unchanged budget semantics).

```typescript
// === HUNK 1 — replaces the module docblock ===
/**
 * Account-pool rotation primitives for the LLM judge (F010): the cooldown
 * map state, the tagged exhaustion error, and the park helper — moved
 * verbatim from judge.ts. Behavior is unchanged; only module ownership and
 * visibility differ (the helpers gain export).
 *
 * Cooldown model: an HTTP 429 is account-local. The account cools for a
 * flat 60 seconds (first-write-wins) and every dispatch skips accounts
 * that are still cooling — there is no sticky pointer. When every account
 * is cooling the caller parks through a shared wait budget and, once the
 * budget is spent, converts to the tagged RotationExhausted error carrying
 * a pool-ordered failure record.
 *
 * Spread model (D1/D6): the pick starts at the dispatch dial
 * (dispatchCounter % pool size) and skips cooling AND at-ceiling accounts,
 * so consecutive claims land on consecutive accounts — the first N
 * dispatches of a run hit N distinct hosts up to the pool's ceilings. A
 * claim moves the dial just past the claimed account; an undefined pick
 * never moves it. An all-at-ceiling pick (nothing cooling) parks its
 * dispatcher on the release-waiter queue at ZERO budget charge: the shared
 * park budget and the exhaustion alarm stay exclusive to cooldown parks
 * (D4). A fresh cooldown stamp also wakes the queue — it shrinks effective
 * capacity — while a first-write-wins re-stamp changes nothing and wakes
 * nobody.
 */

// === HUNK 2 — replaces the RotationState docblock (src/judge-rotation.ts:33-40) + interface ===
/**
 * Run-level rotation state, owned by judgePosts and shared by reference with
 * every worker — the same closure-shared mutable pattern as the `next` batch
 * cursor (read and advance with no await between). There is no sticky
 * pointer: every dispatch scans FROM the dispatch dial (dispatchCounter %
 * poolSize), skipping accounts that are cooling OR at their in-flight
 * ceiling; a claim moves the dial just past the claimed account, so
 * consecutive dispatches land on consecutive hosts.
 */
export interface RotationState {
  readonly accounts: readonly LlmAccount[];
  /** 0-based account index -> expiry reading from the injected `now`. */
  readonly cooldownUntil: Map<number, number>;
  /** 0-based account index -> probe-measured in-flight ceiling (>= 1;
   *  resolveCeilings floors every pool account at 1). Read-only here —
   *  writing the file is the probe's job, the run only enforces. */
  readonly ceilings: ReadonlyMap<number, number>;
  /** 0-based account index -> dispatched-and-unfinished calls. A claim
   *  increments before the request leaves; the attempt's finally releases,
   *  so every exit path frees its slot exactly once. */
  readonly inFlight: Map<number, number>;
  /** Dispatch dial: the pick scans from dispatchCounter % poolSize; a
   *  claim moves it just past the claimed account (D6: an undefined pick
   *  never moves it). Zero starts the run at account 1. */
  dispatchCounter: number;
  /** Resolve fns of dispatches parked on an all-at-ceiling pick. The next
   *  release (or a fresh cool-down) resolves every waiter; each re-picks
   *  and the losers re-park — zero budget charge (D4). */
  readonly ceilingWaiters: Array<() => void>;
  /** Shared park budget: the total wait both judge phases may draw before
   *  the run converts to the exhaustion alarm. */
  waitBudgetRemainingMs: number;
}

// === HUNK 3 — replaces pickEligibleAccount (docblock + signature + body) ===
/**
 * First dispatchable account, scanning FROM the dispatch dial —
 * dispatchCounter % pool size — wrapping the pool once. The proactive
 * spread: consecutive claims land on consecutive accounts, so the first
 * N dispatches of a run hit N distinct hosts. An account is dispatchable
 * when it is neither cooling (expiry > nowMs) nor at its in-flight
 * ceiling. Synchronous and pre-await: the caller claims inside the same
 * sync window as this read. The pick NEVER advances the dial (D6) —
 * claimAccount does, and only for a fresh claim.
 *
 * startAt pins the scan's FIRST seat (the same-account 5xx retry): a
 * start hint, not a guarantee — a cooling or at-ceiling pinned seat is
 * skipped like any other, and an undefined pick still leaves the dial
 * untouched.
 */
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
    const ceiling = state.ceilings.get(index) ?? 1;
    if ((state.inFlight.get(index) ?? 0) >= ceiling) continue;
    return { index, account };
  }
  return undefined;
}

// === HUNK 4 — replaces coolAccount (its docblock stays; wake added) ===
export function coolAccount(state: RotationState, accountIndex: number, nowMs: number): void {
  const existing = state.cooldownUntil.get(accountIndex);
  if (existing === undefined || existing <= nowMs) {
    state.cooldownUntil.set(accountIndex, nowMs + COOLDOWN_MS);
    // D4: a fresh 429 shrinks effective capacity — parked ceiling waiters
    // re-pick against the new landscape and re-route into the budget park
    // when a cooldown now blocks them. An already-cooling account changes
    // nothing (first-write-wins), so it wakes nobody.
    wakeCeilingWaiters(state);
  }
}

// === HUNK 5 — NEW helpers, inserted directly after coolAccount ===
/**
 * Resolve every parked ceiling waiter: a release or a fresh cool-down
 * changed the pick landscape. Wake is a re-pick OPPORTUNITY, not a
 * guaranteed slot — the losers re-park through waitCeilingSlot. Private:
 * wake sites are exactly releaseAccount and coolAccount's fresh stamp.
 */
function wakeCeilingWaiters(state: RotationState): void {
  const waiters = state.ceilingWaiters.splice(0);
  for (const resolve of waiters) resolve();
}

/**
 * Claim a picked account in the caller's sync window: the in-flight count
 * rises BEFORE the request leaves, and the dial moves just past this
 * account so the next scan starts on the next seat (the spread). Pair
 * every claim with a releaseAccount in a finally — the release gate is
 * what keeps the counts honest across every exit path (D7).
 */
export function claimAccount(state: RotationState, accountIndex: number): void {
  const current = state.inFlight.get(accountIndex) ?? 0;
  state.inFlight.set(accountIndex, current + 1);
  state.dispatchCounter = accountIndex + 1;
}

/**
 * Release a claimed account: the in-flight count falls and every ceiling
 * waiter wakes to re-pick the freed landscape. The clamp keeps a
 * bookkeeping bug from driving the count negative; it must stay a clamp —
 * release runs in a finally, where a throw would replace the caller's
 * original error.
 */
export function releaseAccount(state: RotationState, accountIndex: number): void {
  const current = state.inFlight.get(accountIndex) ?? 0;
  state.inFlight.set(accountIndex, Math.max(0, current - 1));
  wakeCeilingWaiters(state);
}

/**
 * Park one dispatch until the next release (or fresh cool-down) changes
 * the pick landscape. ZERO budget charge: an all-at-ceiling pick has no
 * expiry to wait on, so this wait never draws the shared park budget and
 * can never convert to the exhaustion alarm (D4). The caller registers
 * inside the same sync window as the pick-undefined observation — the
 * push lands before the first await, so no release can slip past
 * unobserved. Steady state is safe: an all-at-ceiling scan proves claims
 * are outstanding (in-flight >= ceiling somewhere), and every claim's
 * release wakes the queue, so the wait resolves on real network events —
 * no timer, no polling.
 */
export function waitCeilingSlot(state: RotationState): Promise<void> {
  return new Promise((resolve) => {
    state.ceilingWaiters.push(resolve);
  });
}

/**
 * Earliest ACTIVE cooldown expiry (> nowMs), or undefined when nothing is
 * cooling — the caller's flavor split for an undefined pick (D4): an
 * expiry here means park on the shared budget (the cooldown path, the
 * only road to the exhaustion terminal); no expiry means every account is
 * merely at its ceiling (the zero-charge ceiling wait). parkUntilEligible
 * reads the same computation.
 */
export function earliestCooldown(state: RotationState, nowMs: number): number | undefined {
  let earliest: number | undefined;
  for (const expiry of state.cooldownUntil.values()) {
    if (expiry <= nowMs) continue;
    if (earliest === undefined || expiry < earliest) {
      earliest = expiry;
    }
  }
  return earliest;
}

// === HUNK 6 — replaces parkUntilEligible (docblock + body) ===
/**
 * Wait until the earliest ACTIVE cooldown expiry (plus jitter), charging
 * the shared wait budget. Returns true when the park ran and the caller
 * may re-pick; false when the budget is already spent (or, typed-only,
 * when no cooldown is active — the caller's flavor split makes that
 * unreachable). Never throws: the park runs at the loop top, OUTSIDE the
 * try, so a wait can never be misrouted through a catch.
 *
 * Charge-before-sleep: the full pessimistic wait comes off the budget
 * up front, so peers parking concurrently see the remaining budget, not
 * a stale one. After the wake only the OVERSHOOT (actual elapsed beyond
 * the charge — scheduling delay) is deducted further; an undershoot is
 * not refunded. The cell clamps at zero and the next park refuses.
 */
export async function parkUntilEligible(
  state: RotationState,
  now: () => number,
  sleepFn: SleepFn,
): Promise<boolean> {
  if (state.waitBudgetRemainingMs <= 0) {
    return false;
  }
  const startedAt = now();
  // The caller parks only on an undefined pick WITH an active cooldown,
  // so earliest is defined at this point; the typed fallback keeps the
  // function total — it reads as a spent budget, the conservative terminal.
  const earliest = earliestCooldown(state, startedAt);
  if (earliest === undefined) {
    return false;
  }
  const waitMs = Math.max(0, earliest + WAKE_JITTER_MS - startedAt);
  const charge = Math.min(waitMs, state.waitBudgetRemainingMs);
  state.waitBudgetRemainingMs -= charge;
  await sleepFn(charge);
  const elapsed = now() - startedAt;
  const overspend = Math.max(0, elapsed - charge);
  state.waitBudgetRemainingMs = Math.max(0, state.waitBudgetRemainingMs - overspend);
  return true;
}
```

#### 2. Judge dispatch restructure + Σ-ceilings width + knob deletion
**File**: `src/judge.ts`
**Changes**: NEW `AttemptDirective<T>` union after `DispatchOutcome`; `dispatchLlmCall` fully restructured — loop-top pool scan in the pre-await sync window, D4 flavor split on an undefined pick (cooldown → budget park OUTSIDE the try; all-at-ceiling → zero-charge `waitCeilingSlot`), claim in the same sync window, attempt inside `try/catch/finally` with `releaseAccount` in the finally, ladder returns directives so backoff sleeps and rewinds run after the release, frame-local `pinnedStart` seat for the same-account 5xx retry; `judgeBatch` docblock first sentence updated (dial scan); `judgePosts` gains the `ceilings` parameter (default `new Map()`), constructs the 7-member state, derives `width = Math.max(1, Σ ceilings)`, and feeds it to both `runPool` calls. DELETIONS (prose, not code): the `DEFAULT_JUDGE_CONCURRENCY` const block (`src/judge.ts:59-68` at HEAD) and the `parseJudgeConcurrency` docblock+function (`src/judge.ts:183-202` at HEAD, stopping before `resolveJudgeConfig`'s docblock — `src/index.ts` imports that symbol) are removed entirely.

```typescript
// === HUNK 1 — replaces the module docblock (lines 1-32) ===
/**
 * LLM relevance and location judge for candidate posts (FRD #4, #5, D3).
 *
 * Uses an OpenAI-compatible chat completions endpoint (global fetch, no SDK
 * dependency). Candidates are judged in bulk: up to BATCH_SIZE posts per
 * call, the configured keyword list serialized into the system message as
 * the relevance criterion, and an id-keyed verdict object as the answer:
 * {"<post id>": {"relevant": boolean, "locationOk": boolean}}. The bulk
 * payload sets response_format {"type":"json_object"} so a conforming
 * endpoint constrains decoding to valid JSON; a proxy silently dropping the
 * field degrades to plain parsing with no behavior change.
 *
 * Every bulk verdict is validated per item. Items missing or malformed in
 * the bulk response fall back to the single-post judgePost (2 attempts).
 * HTTP 429 is account-local: the account cools for a flat 60 seconds
 * (first-write-wins — a 429 costs 60 seconds, not more) and every dispatch
 * starts at the dispatch dial — the next account after the last claim —
 * skipping accounts that are cooling or at their probe-measured in-flight
 * ceiling, so the first N dispatches of a run land on N distinct hosts.
 * An all-at-ceiling pick (nothing cooling) waits for the next release at
 * ZERO budget charge; only cooldown parks draw the shared 3-minute wait
 * budget and can convert to the exhaustion alarm. A 5xx is retried on the
 * same account with bounded backoff before the batch is deferred; a
 * transport error defers immediately without cooling anything. When every
 * account is cooling and the budget is spent, the run throws the tagged
 * RotationExhausted error with a pool-ordered record (one exhaustion
 * email, exit 1 — surfaced by index.ts). Batches drain through a bounded
 * pool of workers sized by the pool's total in-flight budget (the sum of
 * the per-account ceilings, resolved by index.ts and passed in) and
 * reassemble in input order. Posts the bulk response misses fall back to
 * the single-post judgePost through a second pool at the same width, under
 * a per-run FALLBACK_CALL_BUDGET on single-post calls. A post that fails
 * both stages, or never reaches the fallback once the budget is spent, is
 * skipped for this run, logged visibly, and omitted from state (D3: it
 * stays unseen and retries next run).
 */

// === HUNK 2 — the judge-rotation.js import gains four names ===
import {
  type RotationState,
  claimAccount,
  coolAccount,
  earliestCooldown,
  failuresFromCooldowns,
  isRotationExhausted,
  parkUntilEligible,
  pickEligibleAccount,
  releaseAccount,
  rotationExhausted,
  waitCeilingSlot,
} from "./judge-rotation.js";

// === HUNK 3 — NEW type, inserted after the DispatchOutcome union ===
/**
 * One attempt's decision, returned from inside the release-guarded try so
 * the finally frees the slot BEFORE the loop acts (D7: the ceiling counts
 * HTTP requests in flight, not backoff waits — the 5xx sleep and the 429
 * rewind both run with the slot released). "rewind" re-picks WITHOUT
 * spending an attempt (a 429 cooled the account); "retry" spends one
 * (the post ladder's non-retryable status, its transport error, and its
 * content retry); "backoff" sleeps delayMs after the release, then
 * retries the same account.
 */
type AttemptDirective<T> =
  | { action: "answered"; value: T }
  | { action: "defer" }
  | { action: "rewind" }
  | { action: "backoff"; delayMs: number }
  | { action: "retry" };

// === HUNK 4 — replaces dispatchLlmCall (docblock + full body; the options
// type, judgeBatch, and judgePost call sites are unchanged) ===
/**
 * The shared HTTP retry loop behind judgeBatch and judgePost (F008).
 * Per attempt, in order: pool scan at the loop top BEFORE the first await
 * (starting at the dispatch dial — or the pinned 5xx seat — skipping
 * cooling AND at-ceiling accounts); on an undefined pick, split the two
 * blocked flavors (D4) — an active cooldown parks through the shared
 * budget (a spent budget returns "exhausted" at the loop top, OUTSIDE the
 * try — D6), and an all-at-ceiling pick waits on the release queue at
 * ZERO budget charge; then claim in the same sync window as the pick and
 * run the attempt inside a release-guarded try (the finally covers every
 * exit: answered, deferred, rewind, backoff, retry, transport, throw).
 * The status ladder — 429 cools the account and rewinds, a 5xx backs off
 * on the SAME account when backoff5xx is set (the handler pins the seat —
 * the post-sleep re-pick starts there, so a 5xx never rotates), and every
 * other non-ok status goes to the wrapper's statusFailure warn — returns
 * an AttemptDirective instead of acting, so the finally releases the slot
 * BEFORE the backoff sleep runs and BEFORE the rewind re-picks (D7: the
 * ceiling counts HTTP requests in flight, not backoff waits).
 *
 * Wrapper-owned divergence (the eight analyzer-inventoried axes): the
 * payload (response_format rides the bulk path only), the attempt bound,
 * whether 5xx gets same-account backoff or an immediate retry, whether a
 * transport error defers the call (batch) or spends an attempt (post),
 * the warn strings (D2: byte-identical operator log), and the content
 * handler that parses the answer and decides resolve/retry/defer.
 *
 * "attemptsExhausted" is the post wrapper's `return null` exit (both
 * attempts spent on wrapper retry decisions); the batch ladder never
 * falls through — every branch resolves, rewinds, or returns — so its
 * wrapper maps this member to "unanswered", the typed equivalent of the
 * old trailing return.
 */
async function dispatchLlmCall<T>(options: {
  state: RotationState;
  fetchFn: typeof fetch;
  now: () => number;
  sleepFn: SleepFn;
  buildPayload: (account: LlmAccount) => Record<string, unknown>;
  maxAttempts: number;
  backoff5xx: boolean;
  deferOnTransport: boolean;
  warns: DispatchWarns;
  onContent: (
    rawContent: string | undefined,
    accountNo: number,
    attemptNo: number,
  ) => ContentDecision<T>;
}): Promise<DispatchOutcome<T>> {
  const {
    state,
    fetchFn,
    now,
    sleepFn,
    buildPayload,
    maxAttempts,
    backoff5xx,
    deferOnTransport,
    warns,
    onContent,
  } = options;
  // A 5xx backoff pins its seat: after the sleep the retry re-picks
  // STARTING at the backed-off account — a 5xx never rotates (the
  // endpoint was busy; the account is not the problem). Cleared by the
  // very next pick.
  let pinnedStart: number | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // Pool scan at the top of every attempt, BEFORE the first await — the
    // same sync window as the old pointer read. attemptIndex is the
    // dispatch-time observation — the account this call actually hit —
    // and is what the cool guard stamps and the finally releases.
    const picked = pickEligibleAccount(state, now(), pinnedStart);
    pinnedStart = undefined;
    if (picked === undefined) {
      // Every account is cooling or at its ceiling — split the flavors
      // (D4): an active cooldown parks through the shared budget (the
      // only road to the exhaustion terminal, OUTSIDE the try below — a
      // throw here would be swallowed by the catch and misread as a
      // transport error); an all-at-ceiling pick has no expiry, so it
      // waits on the release queue at ZERO budget charge — a healthy
      // backlog can never false-trip the alarm.
      if (earliestCooldown(state, now()) !== undefined) {
        if (!(await parkUntilEligible(state, now, sleepFn))) {
          return { status: "exhausted" };
        }
      } else {
        await waitCeilingSlot(state);
      }
      attempt -= 1; // the wait is not a retry — do not spend an attempt
      continue;
    }
    const { index: attemptIndex, account } = picked;
    // Claim in the same sync window as the pick (no await between): the
    // in-flight count rises before the request leaves, and the dial moves
    // to the next account — the proactive spread (D1/D6). The matching
    // release runs in the finally below, so every exit path frees the
    // slot exactly once.
    claimAccount(state, attemptIndex);
    const directive = await (async (): Promise<AttemptDirective<T>> => {
      try {
        const response = await fetchFn(normalizeEndpoint(account.baseUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.apiKey}`,
          },
          body: JSON.stringify(buildPayload(account)),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          if (response.status === 429) {
            coolAccount(state, attemptIndex, now());
            warns.cooling(attemptIndex + 1);
            // Rewind AFTER the finally frees the slot (D7). The pick
            // cannot return a cooling account, so each 429 iteration
            // cools a distinct account; once the pool is fully cooling-
            // or-at-ceiling the loop-top flavor split takes over, bounded
            // by the park budget or by release wakes (the request timeout
            // bounds every wait).
            return { action: "rewind" };
          }
          if (
            backoff5xx &&
            RETRYABLE_STATUSES.has(response.status) &&
            attempt < RETRY_DELAYS_MS.length
          ) {
            // Busy upstream, same account: report the backoff, sleep
            // AFTER the finally frees the slot (D7).
            const delay = RETRY_DELAYS_MS[attempt] ?? 0;
            warns.backingOff?.(attemptIndex + 1, response.status, delay, attempt + 1);
            return { action: "backoff", delayMs: delay };
          }
          warns.statusFailure(attemptIndex + 1, attempt + 1, response.status, response.statusText);
          // Spent backoff or a non-retryable status: defer the batch whole
          // (its posts stay unseen and retry next run); the post ladder
          // spends the attempt instead.
          return backoff5xx ? { action: "defer" } : { action: "retry" };
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const decision = onContent(
          data.choices?.[0]?.message?.content,
          attemptIndex + 1,
          attempt + 1,
        );
        if (decision.action === "resolve") {
          return { action: "answered", value: decision.value };
        }
        if (decision.action === "defer") {
          return { action: "defer" };
        }
        // "retry": spend another attempt — only where the wrapper said so.
        return { action: "retry" };
      } catch (error) {
        // A transport error is not an account problem: nothing cools. The
        // batch defers the whole call (a dead socket predicts a dead
        // fallback); the post spends an attempt and retries.
        const message = error instanceof Error ? error.message : String(error);
        warns.transportError(attemptIndex + 1, attempt + 1, message);
        return deferOnTransport ? { action: "defer" } : { action: "retry" };
      } finally {
        // The release gate: freed on answered, deferred, rewind, backoff,
        // retry, and thrown — every claim terminates here.
        releaseAccount(state, attemptIndex);
      }
    })();
    // Act on the directive OUTSIDE the release gate: the slot is free
    // while the backoff sleeps and while the rewind re-picks (D7).
    if (directive.action === "answered") {
      return { status: "answered", value: directive.value };
    }
    if (directive.action === "defer") {
      return { status: "unanswered" };
    }
    if (directive.action === "rewind") {
      attempt -= 1;
      continue;
    }
    if (directive.action === "backoff") {
      await sleepFn(directive.delayMs);
      // Pin the seat for the retry (same-account 5xx): the sleep ran with
      // the slot free (D7); the re-pick starts here, and if a concurrent
      // 429 cooled the seat or its ceiling filled during the sleep, the
      // scan skips it like any other blocked account. The attempt is
      // spent — the RETRY_DELAYS_MS bound gates exactly as before.
      pinnedStart = attemptIndex;
      continue;
    }
    // "retry": the attempt is spent — fall through to the next attempt.
  }
  return { status: "attemptsExhausted" };
}

// === HUNK 5 — judgeBatch docblock, first sentence only ===
/**
 * One bulk call for up to BATCH_SIZE posts against the next dispatchable
 * account (the dial scan).
 * ...
 * (every other sentence of the judgeBatch docblock and the whole body are
 * unchanged)
 */

// === HUNK 6 — replaces the judgePosts docblock, signature, state literal,// and adds the width derivation; the two runPool calls change ONLY their
// width argument (`concurrency` -> `width`); the reassembly walk, fallback
// pool body, budget handling, and assembly are unchanged ===
/**
 * Judge candidate posts in ~BATCH_SIZE-post bulk calls; every item the bulk
 * response misses or mangles falls back to the single-post judgePost.
 * Collects successful verdicts and tracks skipped IDs (D3).
 *
 * Throws the tagged RotationExhausted error when every LLM_ACCOUNTS account
 * has been rate-limited (drain-then-throw: in-flight batches finish first,
 * so the carried failure record is complete). Every other LLM failure still
 * lands in skippedPostIds, so a flaky endpoint cannot kill the run.
 *
 * Batches drain through a bounded pool of `width` workers — the pool's
 * total in-flight budget, the sum of the per-account ceilings passed in —
 * and each result slot is indexed by batch number so the output reassembles
 * in input order even when batches finish out of order. Bulk misses drain
 * through a second fallback pool at the same width under a per-run
 * FALLBACK_CALL_BUDGET on single-post calls; the cursor claims work in
 * input order, so budget exhaustion starves the tail. Both result lists
 * come out in candidate input order.
 *
 * Rotation state lives in this frame: cooldowns, the per-account in-flight
 * counts under the passed ceilings, and the dispatch dial, shared by
 * reference with every worker exactly like the next cursor below — all
 * claim and release mutations are synchronous, so the workers stay
 * coherent without locks. There is no sticky pointer: every dispatch
 * starts at the dial and skips cooling or at-ceiling accounts, and a claim
 * moves the dial to the next account (the proactive spread, D1/D6).
 */
export async function judgePosts(
  candidates: readonly Post[],
  accounts: readonly LlmAccount[],
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
  ceilings: ReadonlyMap<number, number> = new Map(),
  now: () => number = Date.now,
  sleepFn: SleepFn = sleep,
): Promise<JudgeBatchResult> {
  const state: RotationState = {
    accounts,
    cooldownUntil: new Map(),
    ceilings,
    inFlight: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: WAIT_BUDGET_MS,
  };

  const batches: Post[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  // Pool width = the pool's total in-flight budget: the sum of the
  // per-account ceilings. No overall clamp (D1) — the caps ARE the width —
  // and the floor keeps a hand-built empty map (tests) from spawning zero
  // workers. The new Map() default is the same degrade as an absent
  // ceilings file: every account floors at 1 (the pick's ?? 1 floor);
  // index.ts always passes the resolved map.
  const width = Math.max(
    1,
    [...ceilings.values()].reduce((sum, ceiling) => sum + ceiling, 0),
  );

  // ... outcomes array + `await runPool(batches, width, async (batch,
  // index) => { ... })` — the width argument replaces `concurrency` ...
  // ... reassembly walk unchanged ... fallback drain
  // `await runPool(fallbackWork, width, async (item) => { ... })` ...
}
```

#### 3. judgeCeilings dep seam
**File**: `src/index.ts`
**Changes**: imports — `ENV_NAMES` and `parseJudgeConcurrency` removed from their import blocks, `LlmAccount` type and `loadAccountCeilings` added; `WatcherDeps` gains the `judgeCeilings?` field directly after `linkedinFetch` (D3 seam, same shape: injected in tests, fs-reading default in production); the runWatcher judge stage resolves ceilings through the seam and passes the map to `judgePosts`.

```typescript
// === HUNK 1 — import changes ===
// config.js import: ENV_NAMES removed; the rest stay:
import {
  LINKEDIN_PAYLOAD_PATH,
  STATE_PATH,
  isHeartbeatEnabled,
  runUrlFromEnv,
} from "./config.js";
// judge.js import: parseJudgeConcurrency removed, LlmAccount type added:
import {
  type JudgedPost,
  type LlmAccount,
  judgePosts,
  resolveJudgeConfig,
  sleep,
} from "./judge.js";
// NEW import, sorted between heartbeat.js and judge-rotation.js:
import { loadAccountCeilings } from "./judge-ceilings.js";

// === HUNK 2 — WatcherDeps: new field, directly after linkedinFetch ===
  /** Judge ceiling resolver (D3 seam, the linkedinFetch shape). Default:
   *  loadAccountCeilings — the module owns its degrade contract (an absent
   *  or malformed ceilings file floors every account at ceiling 1 with one
   *  warning per account; it never fails the run). */
  readonly judgeCeilings?: (
    accounts: readonly LlmAccount[],
  ) => Promise<Map<number, number>>;

// === HUNK 3 — runWatcher judge stage: full replacement ===
  const { value: judgeOutcome, durationMs: judgeMs } = await timeStage(async () => {
    const judgeAccounts = resolveJudgeConfig(env);
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
    );
  });
```

#### 4. ENV_NAMES retirement
**File**: `src/config.ts`
**Changes**: the `judgeConcurrency: "JUDGE_CONCURRENCY"` line is deleted from `ENV_NAMES` — the variable becomes inert (no parser reads it); documented in README/AGENTS at Phase 4. (The sibling hunk — `JUDGE_CEILINGS_PATH` — landed in Phase 1.)

```typescript
// === HUNK — ENV_NAMES: the judgeConcurrency line is DELETED (the
// JUDGE_CONCURRENCY variable becomes inert; documented in README/AGENTS at
// Phase 4). Full merged block:
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  linkedinCookiesFile: "LINKEDIN_COOKIES_FILE",
  linkedinTransport: "LINKEDIN_TRANSPORT",
  curlImpersonateBin: "CURL_IMPERSONATE_BIN",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;
```

(The sibling hunk in this file — `JUDGE_CEILINGS_PATH` — landed in Phase 1.)

#### 5. Rotation + spread test rewrite
**File**: `tests/judge-rotation.test.ts`
**Changes**: import block gains the four new helper names; `freshState` (canonical copy) constructs all seven members; the falsified "restarts at account 1" test is REPLACED by the dial-cycle test; the falsified concurrent-429 test is REPLACED by the ceiling-1 burst-cap test; four kept tests swap their trailing width argument for ceilings maps; NEW describe "dispatch spread: the dial, the caps, and the zero-charge ceiling wait" (FRD acceptance: first 5 of 50 posts hit 5 distinct accounts; per-host peaks ≤ ceilings across both phases; zero-charge park + wake on release; cooling-designated-seat skip) and NEW describe "rotation primitives: dial, claim/release, ceiling waiters" (dial-wrap pick, undefined-pick immobility, at-ceiling skip, release decrement/wake/clamp, fresh-stamp wake vs re-stamp silence, earliestCooldown).

```typescript
// === HUNK 1 — full replacement import block ===
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type RotationExhausted,
  type RotationState,
  claimAccount,
  coolAccount,
  earliestCooldown,
  isRotationExhausted,
  pickEligibleAccount,
  releaseAccount,
  waitCeilingSlot,
} from "../src/judge-rotation.js";
import { type LlmAccount, judgePost, judgePosts } from "../src/judge.js";
import type { Post } from "../src/types.js";
import {
  KEYWORDS,
  bulkContent,
  bulkPost,
  fiveAccounts,
  id19,
  ok,
  singleAccount,
} from "./judge-helpers.js";

// === HUNK 2 — replaces freshState (the canonical copy) ===
/** Fresh run-level state for direct judgePost calls. Canonical copy — the
 *  waitBudgetRemainingMs literal mirrors the module-private WAIT_BUDGET_MS.
 *  ceilings default: an empty map reads as ceiling 1 per account (the
 *  pick's ?? 1 floor) — the same degrade as an absent ceilings file. */
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
  };
}

// === HUNK 3 — REPLACES "restarts at account 1 once the cooldown expires
// (batch-local scan)" (falsified by the dial; its expiry-restart value
// lives in the kept park test) ===
  it("cycles the dispatch dial back to account 1 after a full lap — consecutive dispatches land on consecutive accounts", async () => {
    const state = freshState(twoAccounts());
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    await judgePost(bulkPost(id19(1)), state, KEYWORDS, mockFetch, "medium", Date.now);
    await judgePost(bulkPost(id19(2)), state, KEYWORDS, mockFetch, "medium", Date.now);
    await judgePost(bulkPost(id19(3)), state, KEYWORDS, mockFetch, "medium", Date.now);
    assert.match(auths[0] ?? "", /key-1$/);
    assert.match(auths[1] ?? "", /key-2$/);
    assert.match(auths[2] ?? "", /key-1$/); // the dial wrapped after a full lap
    assert.equal(state.dispatchCounter, 3 % 2); // the dial sits just past the last claim
  });

// === HUNK 4 — REPLACES "cools each account once under concurrent 429s and
// keeps the record pool-ordered" (the reactive cascade it proved is gone;
// ceiling-1 caps bind instead) ===
  it("caps the burst: one dispatch per account at ceiling 1, record stays pool-ordered", async () => {
    const posts = Array.from({ length: 40 }, (_, i) => bulkPost(id19(i + 1))); // 4 batches
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      return new Response("Too Many Requests", { status: 429 });
    }) as unknown as typeof fetch;

    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
      await judgePosts(
        posts,
        threeAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        new Map([
          [0, 1],
          [1, 1],
          [2, 1],
        ]),
        Date.now,
        inertSleep,
      );
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    const failures = (caught as RotationExhausted).failures;
    assert.deepEqual(
      failures.map((f) => f.account),
      [1, 2, 3],
    );
    assert.ok(failures.every((f) => f.reason === "HTTP 429"));
    // Ceiling-1 caps bind: each account dispatched EXACTLY once before the
    // pool went fully cooling — the surplus workers parked on the release
    // queue at zero budget charge, then re-routed into the budget park.
    const count = (key: string): number => auths.filter((auth) => auth.includes(key)).length;
    assert.equal(count("key-1"), 1);
    assert.equal(count("key-2"), 1);
    assert.equal(count("key-3"), 1);
  });

// === HUNK 5 — width-argument swaps in four kept tests (bodies otherwise
// unchanged; shown as the exact new judgePosts call) ===
// "drain-then-throw: every account cooling rejects judgePosts with the
// complete pool-ordered record":
      await judgePosts(
        posts,
        twoAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        new Map([
          [0, 2],
          [1, 2],
        ]),
        Date.now,
        inertSleep,
      );
// "retries a 5xx on the same account with backoff, never rotating":
    const result = await judgePosts(
      posts,
      twoAccounts(),
      KEYWORDS,
      mockFetch,
      "medium",
      new Map([
        [0, 2],
        [1, 2],
      ]),
      Date.now,
      inertSleep,
    );
// "parks through an all-cooling window and completes the backlog with zero
// real delay" (Σ = 1 keeps the sequential single-worker timeline;
// `sleeps [60_400]` and the auths pins re-traced green):
    const result = await judgePosts(
      posts,
      twoAccounts(),
      KEYWORDS,
      mockFetch,
      "medium",
      new Map([[0, 1]]),
      now,
      inertSleep,
    );
// "rejects judgePosts when the fallback phase dies on a spent budget":
      await judgePosts(
        posts,
        singleAccount,
        KEYWORDS,
        mockFetch,
        "medium",
        new Map([[0, 4]]),
        now,
        inertSleep,
      );

// === HUNK 6 — NEW describe, appended after the rotation describe ===
describe("dispatch spread: the dial, the caps, and the zero-charge ceiling wait", () => {
  /** Recording fetch: pushes "host key", answers bulk by echoing listed ids. */
  function spreadAnswering(auths: string[]): typeof fetch {
    return (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
        (match) => match[1] ?? "",
      );
      return ok(bulkContent(ids));
    }) as unknown as typeof fetch;
  }

  it("first 5 judge calls of a 50-post run hit 5 distinct accounts (FRD acceptance)", async () => {
    const posts = Array.from({ length: 50 }, (_, i) => bulkPost(id19(i + 1))); // 5 batches
    const auths: string[] = [];
    const result = await judgePosts(
      posts,
      fiveAccounts,
      KEYWORDS,
      spreadAnswering(auths),
      "medium",
      new Map(fiveAccounts.map((_, i) => [i, 1] as const)),
    );
    assert.equal(result.judged.length, 50);
    assert.deepEqual(result.skippedPostIds, []);
    assert.equal(new Set(auths.slice(0, 5)).size, 5);
  });

  it("per-account peaks stay at or under the ceilings across both judge phases", async () => {
    const posts = Array.from({ length: 30 }, (_, i) => bulkPost(id19(i + 1))); // 3 batches
    const peaks = new Map<number, number>([
      [0, 0],
      [1, 0],
    ]);
    const inFlight = new Map<number, number>([
      [0, 0],
      [1, 0],
    ]);
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const index = String(url).includes("account-one") ? 0 : 1;
      const current = (inFlight.get(index) ?? 0) + 1;
      inFlight.set(index, current);
      peaks.set(index, Math.max(peaks.get(index) ?? 0, current));
      await new Promise<void>((resolve) => setTimeout(resolve, 1)); // let peers enter
      inFlight.set(index, (inFlight.get(index) ?? 1) - 1);
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each post below")) {
        return ok("{}"); // bulk answers empty — every post falls back
      }
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const result = await judgePosts(
      posts,
      twoAccounts(),
      KEYWORDS,
      mockFetch,
      "medium",
      new Map([
        [0, 2],
        [1, 1],
      ]),
    );
    assert.equal(result.judged.length, 30);
    assert.deepEqual(result.skippedPostIds, []);
    // Both hosts used (the dial spread), neither host over its ceiling.
    assert.ok((peaks.get(0) ?? 0) >= 1);
    assert.ok((peaks.get(1) ?? 0) >= 1);
    assert.ok((peaks.get(0) ?? 0) <= 2, `account 1 peaked at ${peaks.get(0)} > ceiling 2`);
    assert.ok((peaks.get(1) ?? 0) <= 1, `account 2 peaked at ${peaks.get(1)} > ceiling 1`);
  });

  it("an all-at-ceiling pick parks with ZERO budget charge and wakes on release", async () => {
    const state = freshState(singleAccount, new Map([[0, 1]]));
    let releaseFirst!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const mockFetch = (async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) return gate;
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };

    const first = judgePost(
      bulkPost(id19(1)),
      state,
      KEYWORDS,
      mockFetch,
      "medium",
      Date.now,
      inertSleep,
    );
    const second = judgePost(
      bulkPost(id19(2)),
      state,
      KEYWORDS,
      mockFetch,
      "medium",
      Date.now,
      inertSleep,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 1)); // first in flight; second parked

    assert.equal(state.waitBudgetRemainingMs, 180_000); // zero budget charge
    assert.deepEqual(sleeps, []); // no park sleep fired
    assert.equal(state.ceilingWaiters.length, 1);

    releaseFirst(ok('{"relevant": true, "locationOk": true}'));
    assert.deepEqual(await first, { relevant: true, locationOk: true });
    assert.deepEqual(await second, { relevant: true, locationOk: true });
    assert.equal(state.waitBudgetRemainingMs, 180_000); // still untouched after the wake
    assert.equal(state.ceilingWaiters.length, 0);
  });

  it("skips the designated account when the dial lands on the cooling one", async () => {
    const state = freshState(twoAccounts());
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    state.cooldownUntil.set(0, Date.now() + 60_000); // the DESIGNATED seat (dial 0) is cooling
    const verdict = await judgePost(bulkPost(id19(1)), state, KEYWORDS, mockFetch, "medium");
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
    assert.match(auths[0] ?? "", /key-2$/); // the scan skipped past the cooling designated seat
    assert.equal(state.dispatchCounter, 2); // the claim moved the dial past account 2
  });
});

// === HUNK 7 — NEW describe, appended last ===
describe("rotation primitives: dial, claim/release, ceiling waiters", () => {
  it("pick starts at the dial and wraps; claim moves the dial past the claimed account", () => {
    const state = freshState(threeAccounts());
    state.dispatchCounter = 4; // 4 % 3 = 1 — the scan starts at account 2
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 1);
    claimAccount(state, 1);
    assert.equal(state.dispatchCounter, 2);
    assert.equal(state.inFlight.get(1), 1);
  });

  it("an undefined pick never moves the dial (D6)", () => {
    const state = freshState(twoAccounts());
    state.dispatchCounter = 1;
    state.cooldownUntil.set(0, 10_000);
    state.cooldownUntil.set(1, 20_000);
    assert.equal(pickEligibleAccount(state, 5_000), undefined);
    assert.equal(state.dispatchCounter, 1);
  });

  it("the pick skips at-ceiling accounts even when they are not cooling", () => {
    const state = freshState(
      twoAccounts(),
      new Map([
        [0, 1],
        [1, 1],
      ]),
    );
    state.inFlight.set(0, 1);
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 1);
  });

  it("release decrements, wakes the queue, and clamps at zero", async () => {
    const state = freshState(singleAccount);
    claimAccount(state, 0);
    const woke = waitCeilingSlot(state);
    let resolved = false;
    void woke.then(() => {
      resolved = true;
    });
    releaseAccount(state, 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(resolved, true);
    assert.equal(state.inFlight.get(0), 0);
    releaseAccount(state, 0); // double release: clamp, no crash
    assert.equal(state.inFlight.get(0), 0);
  });

  it("waitCeilingSlot resolves on a fresh coolAccount stamp, not on a re-stamp", async () => {
    const state = freshState(twoAccounts());
    const first = waitCeilingSlot(state);
    let firstWoke = false;
    void first.then(() => {
      firstWoke = true;
    });
    coolAccount(state, 0, 1_000); // fresh stamp wakes the queue (D4)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(firstWoke, true);

    const second = waitCeilingSlot(state);
    let secondWoke = false;
    void second.then(() => {
      secondWoke = true;
    });
    coolAccount(state, 0, 2_000); // already cooling: first-write-wins, no wake
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(secondWoke, false);
    releaseAccount(state, 0); // wake the parked waiter so no handle dangles
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  it("earliestCooldown returns the earliest active expiry and ignores expired ones", () => {
    const state = freshState(threeAccounts());
    state.cooldownUntil.set(0, 5_000);
    state.cooldownUntil.set(2, 3_000);
    state.cooldownUntil.set(1, 1_000); // expired at now 2_000
    assert.equal(earliestCooldown(state, 2_000), 3_000);
    assert.equal(earliestCooldown(state, 6_000), undefined);
  });
});
```

#### 6. Judge test re-pin
**File**: `tests/judge.test.ts`
**Changes**: `parseJudgeConcurrency` removed from the judge.js import and its whole describe DELETED; `freshState` mirror constructs all seven members; the width pins re-pinned onto ceilings maps ("peaks at exactly the Σ-ceilings width", "peaks at min(Σ-ceilings, batches)", "drains fallback-needed posts through a pool at the Σ-ceilings width"); the parallel-fallback test gains a width map; the burst-demote test's `const width = 2` deleted with the map form and `peak <= 2`; the out-of-order test's call gains `"medium", new Map([[0, 4]])`.

```typescript
// === HUNK 1 — judge.js import: parseJudgeConcurrency removed ===
import {
  type LlmAccount,
  buildBulkMessages,
  judgePost,
  judgePosts,
  parseLlmAccounts,
  resolveJudgeConfig,
} from "../src/judge.js";

// === HUNK 2 — replaces the freshState mirror ===
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
  };
}

// === HUNK 3 — describe("parseJudgeConcurrency") is DELETED in full
// (its four its and the import symbol; the variable is gone from src). ===

// === HUNK 4 — retitled + re-argued: full replacement bodies ===
  it("peaks at exactly the Σ-ceilings width for a 280-post backlog", async () => {
    const posts = Array.from({ length: 280 }, (_, i) => bulkPost(id19(i + 1))); // 28 batches
    const state = { inFlight: 0, peak: 0 };
    const mockFetch = measuredFetch(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      "medium",
      new Map([[0, 4]]),
    );
    assert.equal(state.peak, 4); // exactly Σ ceilings, never more
    assert.equal(result.judged.length, 280);
    assert.deepEqual(result.skippedPostIds, []);
  });

  it("peaks at min(Σ-ceilings, batches) in-flight calls for a short list", async () => {
    const posts = Array.from({ length: 25 }, (_, i) => bulkPost(id19(i + 1))); // 3 batches
    const batchCount = Math.ceil(posts.length / 10); // BATCH_SIZE mirror
    const state = { inFlight: 0, peak: 0 };
    const mockFetch = measuredFetch(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      "medium",
      new Map([[0, 2]]),
    );
    assert.equal(state.peak, Math.min(2, batchCount));
    assert.equal(result.judged.length, 25);
  });

  it("drains fallback-needed posts through a pool at the Σ-ceilings width, in input order", async () => {
    const posts = Array.from({ length: 20 }, (_, i) => bulkPost(id19(i + 1))); // 2 batches
    const state = { inFlight: 0, peak: 0, calls: 0 };
    const mockFetch = bulkMissThenAnswer(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      "medium",
      new Map([[0, 3]]),
    );

    // The bulk phase peaks at 2 (two batches) — only the fallback pool can
    // reach the pool width.
    assert.equal(state.peak, 3);
    assert.equal(state.calls, 2 + 20); // 2 bulk + 20 single-post calls
    assert.equal(result.judged.length, 20);
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts.map((p) => p.id),
    );
    // every verdict carries the fallback shape, not a bulk echo
    assert.ok(result.judged.every((j) => j.verdict.relevant && !j.verdict.locationOk));
    assert.deepEqual(result.skippedPostIds, []);
  });

// === HUNK 5 — "keeps input order when one parallel fallback fails among
// successes": adds a width map so the fallback stays parallel (the default
// is now width 1); body otherwise unchanged. New call:
    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      "medium",
      new Map([[0, 4]]),
    );

// === HUNK 6 — "defers K in-flight batches whole when a burst demotes the
// first wave at width > 1 (1d4faed)": delete `const width = 2;`, the call's
// trailing args become:
      "medium",
      new Map([[0, 2]]),
// and the peak assertion becomes:
    assert.ok(state.peak <= 2);

// === HUNK 7 — "keeps candidate order when batches resolve out of order":
// the call gains "medium" + a width map (4 concurrent claims are what the
// four parked resolvers need; singleAccount ceiling 4 admits them). New call:
    const pending = judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      "medium",
      new Map([[0, 4]]),
    );
// (the rest of the test body — the 4-resolver poll, the last-first resolve,
// the batch-1 403 defer, and every assertion — is unchanged)
```

#### 7. Five-account fixture
**File**: `tests/judge-helpers.ts`
**Changes**: add `fiveAccounts` (five distinct hosts) after `singleAccount` — the FRD acceptance test's "first N calls hit N distinct accounts" needs five rungs.

```typescript
// === added after singleAccount ===
/** Five-account pool with distinct hosts — the spread acceptance test's
 *  "first N calls hit N distinct accounts" needs five rungs. */
export const fiveAccounts: LlmAccount[] = [
  { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
  { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
  { baseUrl: "https://account-three.api/v1", apiKey: "key-3", model: "model-3" },
  { baseUrl: "https://account-four.api/v1", apiKey: "key-4", model: "model-4" },
  { baseUrl: "https://account-five.api/v1", apiKey: "key-5", model: "model-5" },
];
```

### Success Criteria:

#### Automated Verification:
- [x] Spread acceptance: `npx tsx --test tests/judge-rotation.test.ts` — "first 5 judge calls of a 50-post run hit 5 distinct accounts" green (`new Set(auths.slice(0, 5)).size === 5`)
- [x] Per-host cap pin: peaks ≤ ceilings across BOTH judge phases (bulk-miss double, twoAccounts ceilings [2,1])
- [x] Zero-charge pin: an all-at-ceiling pick parks on `ceilingWaiters` with `waitBudgetRemainingMs === 180_000` and zero sleeps, wakes on release, budget still 180_000 after
- [x] Cooldown-skip precedence pin: the dial-designated account cooling → dispatch lands on the next account
- [x] Primitive pins: dial-wrap pick, claim moves dial past claim + inFlight, undefined pick never moves the dial (with and without startAt), release decrement/wake/clamp, fresh-stamp wake vs re-stamp silence, earliestCooldown min-active
- [x] Same-account 5xx pin: "retries a 5xx on the same account with backoff, never rotating" green with ceilings maps (auths `[key-1, key-1]`, delays `[1_000]`)
- [x] Retirement (code scope): `grep -rn "JUDGE_CONCURRENCY\|judgeConcurrency" src/ tests/` returns 0 hits (watch.yml literal + probe doc mentions are Slice 3; README/AGENTS are Slice 4)
- [x] Mirror completeness: both freshState copies construct all four new RotationState members (`grep -c "ceilingWaiters" tests/judge-rotation.test.ts tests/judge.test.ts` ≥ 1 per file)

#### Manual Verification:
- [x] Operator log byte-compat: cooling / backingOff / statusFailure / transportError warn strings unchanged (D2) — diff one run's judge lines against the old wording
- [x] judge-rotation.ts's module docblock reads coherently (cooldown model + spread model, no contradiction)

---

## Phase 3: Probe persistence + commit-back

### Overview

The probe records what it measures: the per-account ceiling map is written live-only (whole file, no merge, no staleness logic) BEFORE the dead-account gate — even a red run records its readings — and the probe job commits `state/judge-ceilings.json` via `scripts/commit-state-rebase.sh`, whose skip test generalizes from a single-literal equality to set membership over the two committed state files. The probe checkout gains `fetch-depth: 0` (the commit-back rebases), the watch job loses the retired width literal, and the probe docblocks drop the knob name. Requires Phase 2: the probe writes the file Phase 2's reader consumes.

### Changes Required:

#### 1. Probe ceilings write
**File**: `scripts/probe-judge.ts`
**Changes**: imports gain `JUDGE_CEILINGS_PATH` and `writeCeilingsAtomic`; the module docblock's Revision tail loses its width-knob clause and gains the Revision 2026-11-06 paragraph (commit live-only BEFORE the dead gate); `findConcurrencyCeiling` docblock's first sentence reworded (the spread enforces the number per account — no global knob); `main()` declares the `ceilings` map beside `dead`, records `ceilings[account.baseUrl.trim()] = ceiling` inside the account loop (twins sharing a baseUrl share one reading — last write wins), and AFTER the loop BEFORE the dead gate calls `writeCeilingsAtomic` with a committed-count log line. A dead account's 0 floors at 1 in the reader with a warning — the honest signal for a rotten key.

```typescript
// === HUNK 1 — the import block, biome-sorted: two new lines join the
// existing three ===
import { loadWatcherConfig } from "../src/config-file.js";
import { JUDGE_CEILINGS_PATH } from "../src/config.js";
import { writeCeilingsAtomic } from "../src/judge-ceilings.js";
import { type LlmAccount, buildBulkMessages, resolveJudgeConfig } from "../src/judge.js";
import type { Post } from "../src/types.js";

// === HUNK 2 — module docblock: the Revision 2026-10-26 paragraph's tail
// loses its width-knob clause, and a Revision 2026-11-06 paragraph is
// added ===
 * fixture set of real captured post texts. It ramps concurrent bulk calls
 * per account, stopping once 4 are verified: Z.AI publishes no concurrency
 * number (tier-based, dynamically adjusted, higher off-peak), and gating
 * every account keeps quota burn low.
 *
 * Revision 2026-11-06: the measured per-account ceilings no longer feed a
 * single global width knob — the probe commits them to
 * state/judge-ceilings.json (writeCeilingsAtomic, live-only, BEFORE the
 * dead gate: even a red run records what it measured) and the dispatch run
 * spreads judge dispatches across the pool under those caps
 * (src/judge-ceilings.ts). A missing entry floors that account at ceiling 1
 * with one warning; nothing here reads the file back.

// === HUNK 3 — findConcurrencyCeiling docblock: first sentence reworded;
// the rest of the docblock and the whole function body are unchanged ===
/**
 * Ramp 2 -> 4 and stop: four concurrent verified calls are enough to
 * confirm the ceiling per account — the spread enforces this number per
 * account; there is no global width knob anymore.
 * A refused level reads the ceiling below it; a failed call means a
 * broken endpoint, not a ceiling (return 0). The old 2->4->8->16 walk
 * measured one account for tuning; this probe gates every account, and
 * ~6 calls/account keeps quota burn low.
 */

// === HUNK 4 — main(): the ceilings map is declared beside `dead` and
// recorded inside the account loop, right after findConcurrencyCeiling
// returns; everything else in the loop body is unchanged ===
  const ceilings: Record<string, number> = {};
  const dead: string[] = [];
  for (const [index, account] of accounts.entries()) {
    // ... existing body unchanged through:
    const ceiling = await findConcurrencyCeiling(bulkPayload, account);
    // File key = trimmed baseUrl (resolveCeilings trims both sides). Twins
    // sharing a baseUrl share one reading — last write wins; one entry per
    // endpoint is the file's shape.
    ceilings[account.baseUrl.trim()] = ceiling;
    // ... existing probe/classify/log body unchanged ...
  }

// === HUNK 5 — main(): live-only persistence, inserted AFTER the account
// loop, BEFORE the dead gate ===
  // Live-only persistence BEFORE the dead gate: this run's readings ARE the
  // whole file — no merge with previous content, no staleness logic (the
  // probe runs dispatch-only, so readings legitimately age for days). A
  // dead account's 0 (broken ramp) floors at 1 in the reader with a
  // warning — the honest signal for a rotten key.
  await writeCeilingsAtomic(ceilings, JUDGE_CEILINGS_PATH);
  console.log(
    `probe: committed ${Object.keys(ceilings).length} ceiling(s) to ${JUDGE_CEILINGS_PATH}`,
  );

  if (dead.length > 0) {
    // ... unchanged DEAD-account block, process.exit(1) ...
  }
  console.log("probe: all accounts verified — gating probe passed");
```

#### 2. Probe job commit step + watch literal removal
**File**: `.github/workflows/watch.yml`
**Changes**: the probe job is fully replaced — `fetch-depth: 0` joins the checkout (the Commit ceilings step rebases; a shallow clone cannot find the merge base), the job comment grows the commit-back story (red gate skips the commit — fail-fast), and the Commit ceilings step is appended (bot identity, ceilings-file-only add with the `[-f]` guard, no-op guard, `git commit -m "judge: probe-measured ceilings"`, then `bash scripts/commit-state-rebase.sh`); the watch job's head comment becomes formulaic (width = Σ per-account ceilings, no single knob; the 8-minute cap paragraph unchanged); the Run watcher step's env block deletes the `JUDGE_CONCURRENCY: "4"` literal, `HEARTBEAT_ENABLED` becomes the first line, everything after unchanged.

```yaml
# === HUNK 1 — the probe job: FULL replacement (fetch-depth: 0 joins the
# checkout, and the Commit ceilings step is appended; the job comment grows
# the commit-back story) ===
  probe:
    if: github.event_name == 'workflow_dispatch'
    # The probe walks EVERY LLM_ACCOUNTS account (stop-once-4 ramp, ~6
    # calls each): an auth-dead key or a failed leg fails this job, so a
    # rotten key in the pool reddens the dispatch run instead of passing
    # unseen. 429-refused legs are reported as busy, not dead — throttling
    # is data; the watch job is the real gate for it. The measured
    # per-account ceilings commit to state/judge-ceilings.json (live-only,
    # before the dead gate) and the Commit ceilings step pushes them — the
    # watch job's spread consumes that file (src/judge-ceilings.ts). A red
    # gate skips the commit (fail-fast): the file lands only from a green
    # probe run.
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        # The Commit ceilings step rebases onto main (the same
        # commit-state-rebase.sh body as the watch job): a shallow clone
        # cannot find the merge base and add/add-conflicts the whole tree.
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Probe judge latency
        env:
          LLM_ACCOUNTS: ${{ secrets.LLM_ACCOUNTS }}
        run: npx tsx scripts/probe-judge.ts

      - name: Commit ceilings
        # The F021 head shape from the watch job's Commit state step,
        # minus the jq delta (the ceilings write is whole-file): bot
        # identity, the ceilings-file-only add, the no-op guard, then the
        # tested script — rebase, committed-state conflict skips, lease
        # push, single retry. The [-f] guard covers a probe that died
        # before its write (the probe step already failed the job; this
        # step cannot normally run on a red gate).
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [ -f state/judge-ceilings.json ]; then
            git add state/judge-ceilings.json
          fi
          if git diff --cached --quiet; then
            echo "ceilings unchanged; nothing to commit"
            exit 0
          fi
          git commit -m "judge: probe-measured ceilings"
          bash scripts/commit-state-rebase.sh

# === HUNK 2 — the watch job's head comment: the width-4 paragraph is
# reworded formulaically; the F023 timeout-envelope paragraph and the
# WAIT_BUDGET_MS paragraph follow unchanged ===
  watch:
    runs-on: ubuntu-latest
    # Judge width is Σ per-account ceilings (probe-measured, committed to
    # state/judge-ceilings.json — src/judge-ceilings.ts): there is no
    # single concurrency knob anymore. The dispatch spread keeps each
    # account at its own cap, the 429 rotation stays the correctness net,
    # and an absent ceilings file floors every account at 1 — correct but
    # slow until the next probe dispatch commits readings. The 8-minute
    # cap keeps a hung run under the 10-minute cron interval — it dies
    # before the next tick queues (cancel-in-progress now drops a
    # superseded run instead of queueing it).

# === HUNK 3 — the Run watcher step's env block: the global width literal
# line is DELETED; HEARTBEAT_ENABLED becomes the first line, everything
# after it is unchanged ===
      - name: Run watcher
        env:
          HEARTBEAT_ENABLED: ${{ vars.HEARTBEAT_ENABLED }}   # zero-match status email kill switch; unset = enabled
          THREADS_SESSION_STATE: ${{ secrets.THREADS_SESSION_STATE }}
          # (the LinkedIn comment, LLM_ACCOUNTS, GMAIL_USER, and
          # GMAIL_APP_PASSWORD lines are unchanged)
        run: npx tsx src/index.ts
```

#### 3. Skip-set generalization
**File**: `scripts/commit-state-rebase.sh`
**Changes**: the header's first line names both invokers (watch.yml's Commit state, the probe job's Commit ceilings), the skip sentence names both committed state files, and the Deviation ledger gains the second deviation entry; `attempt()`'s conflict check becomes per-line set membership over `git diff --name-only --diff-filter=U` — an empty line, `state/seen-posts.json`, or `state/judge-ceilings.json` passes, anything else fails the attempt whole (heredoc, not a pipe, keeps the loop in this shell). Shebang, `set -e`, 50-skip bound, bound-exhaustion echo, `git rebase --skip || true`, lease push, and one-retry tail byte-unchanged.

```bash
# === HUNK 1 — header: first line, skip-paragraph sentence, and ledger
# entry (shown verbatim; every other header paragraph is byte-unchanged;
# the #!/bin/bash shebang stays line 1) ===
# Commit-back body for watch.yml's "Commit state" step (F021) and the
# probe job's "Commit ceilings" step: rebase onto main, skip conflicts in
# the committed state files (bounded), lease-push, retry once.
#
# [paragraphs 2-3 are unchanged except this sentence, which replaces the
# single-file skip sentence:]
# A state commit that conflicts against main's own lines for a committed
# state file (state/seen-posts.json, state/judge-ceilings.json) is skipped
# whole (the next run re-judges, or the next probe run overwrites; one
# duplicate digest or one stale-ceiling stretch is the accepted cost)
# instead of failing the run. ANY other conflicted path is real work
# failing to replay: abort loudly and exit 1.
#
# [invocation / errexit / workspace paragraphs unchanged]
#
# Deviation ledger (FR2 byte-for-byte review aid): the ONLY deliberate
# deviation from the moved YAML body is the skip-bound exhaustion echo
# inside attempt() below (FRD FR2 + TECH_DEBT_AUDIT.md:74). Second
# deviation (2026-11-06, ceilings commit-back): the skip test grew from a
# single-literal equality to set membership over the two committed state
# files. Everything else is a verbatim move of watch.yml's former :123-167.
#
# [50-skip-bound paragraph unchanged]

# === HUNK 2 — attempt()'s conflict check: set membership (shown verbatim
# with its surrounding while-loop lines as anchors; nothing else in the
# function changes) ===
    while test -d .git/rebase-merge && [ "$skips" -lt 50 ]; do
      # Skip ONLY committed-state-file conflicts; any other conflicted
      # path is real work failing to replay (F021's loud failure
      # preserved). git lists conflicted paths one per line, so this is
      # set membership over that list — a heredoc (not a pipe) keeps the
      # loop in this shell, where the all_state flag survives.
      conflicts=$(git diff --name-only --diff-filter=U)
      all_state=1
      while IFS= read -r path; do
        case "$path" in
          "" | state/seen-posts.json | state/judge-ceilings.json) ;;
          *) all_state=0 ;;
        esac
      done <<EOF
$conflicts
EOF
      if [ "$all_state" -eq 0 ]; then
        echo "non-state conflict in: $conflicts — failing the run"
        git rebase --abort
        exit 1
      fi
      # --skip exits nonzero when it stops at the NEXT conflict; the
      # loop condition must see that, so this is set -e-proof.
      git rebase --skip || true
      skips=$((skips + 1))
    done
```

#### 4. Commit-back test fixtures
**File**: `tests/commit-state-rebase.test.ts`
**Changes**: `advanceOrigin` gains the third edit arm (`ceilings` — write + add `state/judge-ceilings.json`); two new `it`s appended after the retry test inside the existing describe — "skips a judge-ceilings conflict (the probe job's commit-back)" (add/add conflict on the ceilings file; exit 0, origin keeps its own reading, no `non-state conflict` output) and "aborts a two-line conflict when one path is outside the state set" (ceilings + notes.md both conflict; exit 1, `non-state conflict in: notes.md`, rebase unwound, HEAD unmoved). Every existing test, helper, fixture, and the bash-resolution gate untouched.

```typescript
// === HUNK 1 — advanceOrigin: third edit arm (the rest of the function is
// unchanged) ===
async function advanceOrigin(
  root: string,
  origin: string,
  edits: { stateIds?: Record<string, string>; notes?: string; ceilings?: string },
): Promise<void> {
  const other = join(root, "other");
  git(root, ["clone", "--quiet", origin, "other"]);
  git(other, ["config", "user.name", "human pusher"]);
  git(other, ["config", "user.email", "human@loker-watcher.invalid"]);
  if (edits.stateIds !== undefined) {
    await writeFile(join(other, "state", "seen-posts.json"), stateJson(edits.stateIds), "utf8");
    git(other, ["add", "state/seen-posts.json"]);
  }
  if (edits.ceilings !== undefined) {
    await writeFile(join(other, "state", "judge-ceilings.json"), edits.ceilings, "utf8");
    git(other, ["add", "state/judge-ceilings.json"]);
  }
  if (edits.notes !== undefined) {
    await writeFile(join(other, "notes.md"), edits.notes, "utf8");
    git(other, ["add", "notes.md"]);
  }
  git(other, ["commit", "-m", "human push lands mid-run"]);
  git(other, ["push", "origin", "main"]);
}

// === HUNK 2 — two new its, appended after the retry test (inside the
// existing describe) ===
  it(
    "skips a judge-ceilings conflict (the probe job's commit-back): exit 0, origin keeps its ceilings",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("ceilings-skip");
      try {
        // The probe-job head this suite mimics: add + commit the ceilings
        // file only.
        await writeFile(
          join(work, "state", "judge-ceilings.json"),
          '{"https://account-one.api/v1": 4}\n',
          "utf8",
        );
        git(work, ["add", "state/judge-ceilings.json"]);
        git(work, ["commit", "-m", "judge: probe-measured ceilings"]);
        // The human push: a DIFFERENT ceilings reading lands on origin
        // first (add/add conflict — the file did not exist at the merge
        // base).
        await advanceOrigin(root, origin, { ceilings: '{"https://account-one.api/v1": 2}\n' });
        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        // The accepted skip cost, pinned for the second state file: origin
        // keeps ITS reading; the next green probe run overwrites.
        assert.match(git(origin, ["show", "main:state/judge-ceilings.json"]), /: 2\}/);
        assert.doesNotMatch(run.stdout, /non-state conflict/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "aborts a two-line conflict when one path is outside the state set: exit 1",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("mixed-conflict");
      try {
        // Our commit touches one state file AND one non-state file.
        await writeFile(
          join(work, "state", "judge-ceilings.json"),
          '{"https://account-one.api/v1": 4}\n',
          "utf8",
        );
        await writeFile(join(work, "notes.md"), "work side\n", "utf8");
        git(work, ["add", "state/judge-ceilings.json", "notes.md"]);
        git(work, ["commit", "-m", "ceilings + notes"]);
        // Origin moved BOTH paths: the conflict list has two lines, one
        // in the skip set, one outside — the outside line fails the
        // attempt whole; nothing is skipped piecemeal.
        await advanceOrigin(root, origin, {
          ceilings: '{"https://account-one.api/v1": 2}\n',
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
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Ceilings-skip pin green: "skips a judge-ceilings conflict (the probe job's commit-back)" — exit 0, origin keeps its own reading
- [x] Mixed-conflict pin green: "aborts a two-line conflict when one path is outside the state set" — exit 1, rebase unwound, HEAD unmoved
- [x] Existing commit-back pins stay green: clean push, state-only skip, non-state abort, retry-once (`npx tsx --test tests/commit-state-rebase.test.ts`)
- [x] Retirement (workflow scope): `grep -n "JUDGE_CONCURRENCY" .github/workflows/watch.yml scripts/probe-judge.ts` returns 0 hits
- [x] Live-only ordering: the `writeCeilingsAtomic` call in scripts/probe-judge.ts sits BEFORE the dead-account block (`grep -n "writeCeilingsAtomic\|DEAD account" scripts/probe-judge.ts`)

#### Manual Verification:
- [ ] One workflow_dispatch run: a green probe commits state/judge-ceilings.json cleanly and the next watch run consumes it with no 429 storm in the judge logs (the composite lesson: offline tests passed both prior times; live runs caught the real failure)
- [ ] A red-gate dispatch (rotten key) reddens the run AND skips the Commit ceilings step — the committed file still holds the last green reading

---

## Phase 4: Docs sync + validation

### Overview

Six doc surfaces re-synced to the locked Architecture: the root and src guidance tell the two-committed-state-files story and quote the 7-member `RotationState`/dial/zero-charge/Σ-width rotation fence; the workflows guidance gains the Commit ceilings step and pluralized commit-back story with corrected sync-point arithmetic (5 of the 8 ENV_NAMES); the scripts guidance names both invokers and the ceilings write; README and AGENTS retire the paste-a-number workflow for dispatch-the-probe-and-it-commits. Every fence quotes code that exists after Phases 1-3.

### Changes Required:

#### 1. Root guidance — two committed state files
**File**: `.rpiv/guidance/architecture.md`
**Changes**: Overview persistence sentence names both files with one writer each; the tree's `scripts/` and `state/` lines tell the ceilings story; Business Context doctrine line becomes "probe-measured values are committed data, not env knobs"; the important-if block re-keys to "running the judge probe or changing judge ceilings" routing to section names that exist.

```markdown
// === HUNK 1 — Overview: the persistence sentence names both committed state files ===
- ...and emails new matches as a plain-text digest. The only persistence is `state/seen-posts.json`, which the workflow commits back after match runs.
+ ...and emails new matches as a plain-text digest. Committed state is two files, one writer each:
+ `state/seen-posts.json` (the watch job commits it back after match runs) and
+ `state/judge-ceilings.json` (probe-measured judge ceilings, committed by the probe job).

// === HUNK 2 — the tree: scripts/ and state/ lines tell the ceilings story ===
-scripts/            # commit-state-rebase.sh (state commit-back body: rebase + skip + push + one internal retry), probe-judge.ts (measures the LLM endpoint, feeds JUDGE_CONCURRENCY) + Claude Code hooks
+scripts/            # commit-state-rebase.sh (commit-back body for BOTH state files: rebase + skip + push + one internal retry), probe-judge.ts (measures the LLM endpoint, writes state/judge-ceilings.json live-only) + Claude Code hooks
-state/              # runtime state only; written by the run, committed back by the workflow
+state/              # runtime state only: seen-posts.json (watch job) + judge-ceilings.json (probe job); written by the run/job, committed back by the workflow

// === HUNK 3 — Business Context: the doctrine example outlives the deleted knob ===
-Repo doctrine: only probe-measured values are env-tunable (`JUDGE_CONCURRENCY`); all other tuning values are hard-coded module constants.
+Repo doctrine: probe-measured values are committed data, not env knobs (per-account judge ceilings in
+`state/judge-ceilings.json`); all other tuning values are hard-coded module constants.

// === HUNK 4 — the important-if re-keys; the route names the section that exists ===
-<important if="you are changing judge concurrency or endpoint tuning">
-1. Run the probe and apply its reading — see `.rpiv/guidance/scripts/architecture.md` ("Running the Judge Probe")
-2. Where the literal lives and its evidence-comment convention — see `.rpiv/guidance/.github/workflows/architecture.md` (step-scoped secrets pattern)
+<important if="you are running the judge probe or changing judge ceilings">
+1. Run the probe — the probe job commits the readings itself — see `.rpiv/guidance/scripts/architecture.md` ("Running the Judge Probe and Applying the Reading")
+2. Where the ceilings commit lands and the measured-evidence convention — see `.rpiv/guidance/.github/workflows/architecture.md` ("The probe job: a gate that walks every account")
</important if>
```

#### 2. Src guidance — rotation fence re-synced
**File**: `.rpiv/guidance/src/architecture.md`
**Changes**: Module Structure tree gains `judge-ceilings.ts` in the LEAVES + CONFIG line; the rotation fence replaced with the locked Architecture (7-member state, dial pick, claim/release, fresh-stamp wake, zero-charge ceiling wait, pinnedStart 5xx seat, Σ-ceilings width, ceilings-file reader doctrine); "Adding an LLM Account" steps re-keyed (dial retires trial-order; the probe commits, nothing to paste).

````markdown
// === HUNK 1 — Module Structure tree: judge-ceilings.ts joins LEAVES + CONFIG ===
-types.ts, config.ts, config-file.ts      # LEAVES + CONFIG: contracts | ENV_NAMES, paths | watcher.config.json validation
-                                         #   (closed ALLOWED_KEYS incl. candidateTerms, scrollRounds, reasoningEffort)
+types.ts, config.ts, config-file.ts,     # LEAVES + CONFIG: contracts | ENV_NAMES, paths | watcher.config.json
+judge-ceilings.ts                        #   validation (closed ALLOWED_KEYS incl. candidateTerms, scrollRounds,
+                                         #   reasoningEffort) | the committed judge ceilings reader/writer

// === HUNK 2 — the rotation fence matches the locked Architecture: 7-member state, dial pick, zero-charge ceiling wait, Σ-ceilings width ===
-## Judge rotation: 429 cools the account, calls park past cooldowns, budget-bounded
+## Judge rotation: dispatch dial + per-account ceilings; 429 cools the account; cooldown parks stay budget-bounded
 ```typescript
-const state: RotationState = { accounts, cooldownUntil: new Map(), waitBudgetRemainingMs: WAIT_BUDGET_MS };
-// NO sticky pointer — every dispatch scans from account 1; coolAccount(state, i, now) sets cooldownUntil[i] =
-// now + 60s, first-write-wins. All cooling ⇒ parkUntilEligible charges the 180s budget (wake at earliest expiry + 500ms jitter, false when spent). 429 → cool + re-pick (no backoff); 5xx → same account, [1s,2s,4s]; transport error → batch deferred whole.
-// Terminal RETURNED, never thrown in the core; judgePosts drains, then throws AFTER Promise.all: ONE alarm email, exit(1).
+const state: RotationState = { accounts, cooldownUntil: new Map(), ceilings, inFlight: new Map(),
+  dispatchCounter: 0, ceilingWaiters: [], waitBudgetRemainingMs: WAIT_BUDGET_MS };
+// NO sticky pointer — every dispatch scans FROM the dial (dispatchCounter % poolSize), skipping cooling AND
+// at-ceiling accounts; a claim moves the dial just past the claimed account, so consecutive claims land on
+// consecutive hosts (the first N dispatches of a run hit N distinct accounts). claim/release brackets every
+// HTTP attempt; release runs in the attempt's finally, so every exit path frees its slot exactly once.
+// coolAccount(state, i, now) sets cooldownUntil[i] = now + 60s, first-write-wins; a FRESH stamp also wakes
+// parked ceiling waiters (capacity shrank). An all-at-ceiling pick (nothing cooling) parks on the
+// release-waiter queue at ZERO budget charge; ONLY cooldown parks draw the 180s budget (parkUntilEligible:
+// charge-before-sleep, wake at earliest active expiry + 500ms jitter, false when spent) and can convert to
+// the exhaustion alarm. 429 → cool + rewind (no backoff); 5xx → same account [1s,2s,4s] via the frame-local
+// pinnedStart seat (the backoff sleep runs with the slot released); transport error → batch deferred whole.
+// Pool width = Σ per-account ceilings. The ceilings come from state/judge-ceilings.json — the committed,
+// degrade-everything reader (src/judge-ceilings.ts loadAccountCeilings: absent/malformed floors every
+// account at ceiling 1 with one warning naming the baseUrl; it never fails a run).
+// Terminal RETURNED, never thrown in the core; judgePosts drains, then throws AFTER Promise.all: ONE alarm email, exit(1).
 ```

// === HUNK 3 — "Adding an LLM Account": the dial retires trial-order; the probe commits, nothing to paste ===
-1. Edit the `LLM_ACCOUNTS` GitHub secret: JSON array of `{baseUrl, apiKey, model}` — array order IS trial order, most reliable first
-2. No code change: `parseLlmAccounts` validates shape fail-visibly (`LLM_ACCOUNTS[i].<field>` in the error); rotation picks the pool up automatically; each dispatch scans from account 1
-3. Optionally re-measure: run the probe — see `.rpiv/guidance/scripts/architecture.md` — and paste the reading into `JUDGE_CONCURRENCY` in watch.yml
+1. Edit the `LLM_ACCOUNTS` GitHub secret: JSON array of `{baseUrl, apiKey, model}` — the dispatch dial starts each call at the next account, so pool order is a starting seat, not a trial order
+2. No code change: `parseLlmAccounts` validates shape fail-visibly (`LLM_ACCOUNTS[i].<field>` in the error); rotation picks the pool up automatically; a new account without a committed reading is capped at ceiling 1 until the next probe
+3. Optionally re-measure: dispatch the probe — it writes `state/judge-ceilings.json` and the probe job commits it (see `.rpiv/guidance/scripts/architecture.md`, "Running the Judge Probe and Applying the Reading")
````

#### 3. Workflows guidance — Commit ceilings joins
**File**: `.rpiv/guidance/.github/workflows/architecture.md`
**Changes**: Responsibility names the probe job's ceilings commit; sync points — `5 of the 8 ENV_NAMES`, the knob-literal sync point replaced by the ceilings-file keys ↔ trimmed baseUrls point, `fetch-depth: 0` pluralized to both commit-back jobs; Structure fence gains the Commit ceilings line under the probe job; Run watcher fence loses the literal, `HEARTBEAT_ENABLED` first; Commit-back heading + fence comment pluralized; the Commit ceilings yaml block joins the section; exit/skip prose and writer claim go plural (one file each).

````markdown
// === HUNK 1 — Responsibility: the probe job commits the ceilings file too ===
-...`watch.yml` runs the pipeline every 10 minutes with secrets, then commits `state/seen-posts.json` back as `github-actions[bot]`. A dispatch-only `probe` job inside watch.yml measures the LLM endpoint.
+...`watch.yml` runs the pipeline every 10 minutes with secrets, then commits `state/seen-posts.json` back as `github-actions[bot]`. A dispatch-only `probe` job inside watch.yml measures the LLM endpoint and commits `state/judge-ceilings.json`.

// === HUNK 2 — Sync points: 5 of the 8; the ceilings sync point replaces the knob literal; fetch-depth covers both committers ===
-- Step `env:` keys ↔ `ENV_NAMES` in `src/config.ts` — watch.yml maps 6 of the 9 ENV_NAMES (`HEARTBEAT_ENABLED` via `vars.` — the one non-secret knob); the LinkedIn trio (`LINKEDIN_COOKIES_FILE`, `LINKEDIN_TRANSPORT`, `CURL_IMPERSONATE_BIN`) is deliberately NOT mapped — PC-only, never enters Actions; unset means enabled
+- Step `env:` keys ↔ `ENV_NAMES` in `src/config.ts` — watch.yml maps 5 of the 8 ENV_NAMES (`HEARTBEAT_ENABLED` via `vars.` — the one non-secret knob); the LinkedIn trio (`LINKEDIN_COOKIES_FILE`, `LINKEDIN_TRANSPORT`, `CURL_IMPERSONATE_BIN`) is deliberately NOT mapped — PC-only, never enters Actions; unset means enabled
-- The `JUDGE_CONCURRENCY` literal ↔ `DEFAULT_JUDGE_CONCURRENCY` in `src/judge.ts` (both 4 today; the literal is a maintenance pointer)
+- `state/judge-ceilings.json` keys ↔ the pool's trimmed `baseUrl`s (`resolveCeilings` trims both sides; twin accounts sharing one baseUrl share one reading)
-- `fetch-depth: 0` exists ONLY in the watch job because Commit state rebases — a shallow clone cannot find the merge base
+- `fetch-depth: 0` sits in BOTH commit-back jobs (Commit state, Commit ceilings) — a shallow clone cannot find the merge base and add/add-conflicts the whole tree

// === HUNK 3 — Structure fence: the probe job grows Commit ceilings ===
-            # job probe: dispatch-only GATE, timeout 10 → npx tsx scripts/probe-judge.ts (LLM_ACCOUNTS only)
+            # job probe: dispatch-only GATE, timeout 10 → npx tsx scripts/probe-judge.ts (LLM_ACCOUNTS only)
+            #   → Commit ceilings (state/judge-ceilings.json via scripts/commit-state-rebase.sh; checkout fetch-depth: 0)

// === HUNK 4 — the Run watcher fence: the width literal is DELETED; HEARTBEAT_ENABLED becomes the first line ===
-    JUDGE_CONCURRENCY: "4"   # probe run <id> reading — paste a fresh measuring run's reading
     HEARTBEAT_ENABLED: ${{ vars.HEARTBEAT_ENABLED }}   # the one non-secret knob: vars., not secrets.; unset = enabled

// === HUNK 5 — Commit-back heading + fence comment: pluralized invokers ===
-## Commit-back: bot identity, no-op guard, jq delta, state-only rebase skips, lease push
+## Commit-back: two invokers (Commit state, Commit ceilings); bot identity, no-op guard, deltas, state-set rebase skips, lease push
-    bash scripts/commit-state-rebase.sh   # the ONLY invocation — rebase, state-only
-                                          # conflict skips (bounded), lease push, and the
-                                          # single retry all live inside the script
+    bash scripts/commit-state-rebase.sh   # one of the TWO invocations — rebase, committed-state
+                                          # conflict skips (bounded), lease push, and the single
+                                          # retry all live inside the script

// === HUNK 6 — after the Commit state block, the Commit ceilings block joins the section (new yaml) ===
```yaml
- name: Commit ceilings
  # The F021 head shape from Commit state, minus the jq delta (the ceilings write is whole-file);
  # the [-f] guard covers a probe that died before its write (the probe step already failed the job).
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    if [ -f state/judge-ceilings.json ]; then
      git add state/judge-ceilings.json
    fi
    if git diff --cached --quiet; then
      echo "ceilings unchanged; nothing to commit"
      exit 0
    fi
    git commit -m "judge: probe-measured ceilings"
    bash scripts/commit-state-rebase.sh   # second invocation — same body, no jq delta
```
A red gate skips this step (fail-fast): the ceilings file lands only from a green probe run.

// === HUNK 7 — the exit/skip prose and the writer claim go plural ===
-The script re-establishes errexit itself and exits 0 on push, 1 on a non-state conflict abort or a second push failure. It is invoked exactly once; the single retry lives inside it. Any conflicted path other than the state file aborts the run loudly.
+The script re-establishes errexit itself and exits 0 on push, 1 on a conflict outside the committed state set (`state/seen-posts.json`, `state/judge-ceilings.json`) or a second push failure. Each invoker calls it once; the single retry lives inside it. Any conflicted path outside that set aborts the run loudly.
-Accepted cost (F021): a skipped state conflict means the next run re-judges — the audit tolerates one duplicate digest. The commit-back is the only production writer to `state/`.
+Accepted cost (F021): a skipped state conflict means the next run re-judges — or the next green probe overwrites the ceilings; the audit tolerates one duplicate digest or one stale-ceiling stretch. The commit-back steps are the only production writers to `state/`, one file each: the watch job owns `state/seen-posts.json`, the probe job owns `state/judge-ceilings.json`.

// === HUNK 8 — the probe-job section: full replacement fence (fetch-depth: 0 + Commit ceilings join) ===
```yaml
probe:
  if: github.event_name == 'workflow_dispatch'   # never on the cron tick
  # Walks EVERY LLM_ACCOUNTS account (2→4 ramp): an auth-dead key or a failed leg fails this job, so a
  # rotten key reddens the dispatch run instead of passing unseen. 429-refused legs are busy, not dead —
  # throttling is data; the watch job is the real gate for it. The measured ceilings commit to
  # state/judge-ceilings.json (live-only, BEFORE the dead gate) and Commit ceilings pushes them — the
  # watch job's spread consumes that file. A red gate skips the commit (fail-fast): the file lands
  # only from a green probe run.
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0   # Commit ceilings rebases — the same merge-base rule as Commit state
    - name: Probe judge latency
      env:
        LLM_ACCOUNTS: ${{ secrets.LLM_ACCOUNTS }}
      run: npx tsx scripts/probe-judge.ts
    - name: Commit ceilings
      # The F021 head shape from Commit state, minus the jq delta (the ceilings write is whole-file);
      # the [-f] guard covers a probe that died before its write.
      run: |
        git config user.name "github-actions[bot]"
        git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
        if [ -f state/judge-ceilings.json ]; then
          git add state/judge-ceilings.json
        fi
        if git diff --cached --quiet; then
          echo "ceilings unchanged; nothing to commit"
          exit 0
        fi
        git commit -m "judge: probe-measured ceilings"
        bash scripts/commit-state-rebase.sh   # second invocation — same body, no jq delta
```
````

#### 4. Scripts guidance — two invokers + the write
**File**: `.rpiv/guidance/scripts/architecture.md`
**Changes**: Responsibility names BOTH commit-back steps and the probe's ceilings write (live-only, BEFORE the dead-account gate); Invokers: TWO callers, one call each; Structure fence: skip-set membership line joins the script, the ceilings write joins `probe-judge.ts` (INSIDE typecheck + lint + lint-staged); exit contracts: the state set is two files, both invokers' shells consume the script, probe writes before the gate; the Probe section fence gains the persistence excerpt; the important-if re-keys with steps 5-6 following the committed file (no paste step).

````markdown
// === HUNK 1 — Responsibility: two commit-back invokers; the probe writes the ceilings file ===
-`commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of watch.yml's Commit state step, executed by the only hosted write path; `probe-judge.ts` measures the LLM endpoint's latency and concurrency ceiling from an Actions runner;
+`commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of BOTH commit-back steps (watch.yml's Commit state, the probe job's Commit ceilings), executed by the hosted write paths; `probe-judge.ts` measures the LLM endpoint's latency and per-account ceiling, then writes them to `state/judge-ceilings.json` (live-only, BEFORE the dead-account gate) from an Actions runner;

// === HUNK 2 — Invokers: the script has two callers, one call each ===
-- **commit-state-rebase.sh**: watch.yml's Commit state step only — invoked EXACTLY ONCE (`bash scripts/commit-state-rebase.sh`, the bare last line; bot identity + the no-op guard stay in YAML). The single retry lives inside the script
+- **commit-state-rebase.sh**: TWO invokers, one call each — watch.yml's Commit state step and the probe job's Commit ceilings step (`bash scripts/commit-state-rebase.sh`, the bare last line; bot identity + the no-op guard stay in YAML). The single retry lives inside the script

// === HUNK 3 — Structure fence: the skip-set and the ceilings write join the two lines ===
 commit-state-rebase.sh       # bash, set -e self-owned; OUTSIDE typecheck + lint + lint-staged
                              #   (biome never sees .sh); LF-pinned by .gitattributes; offline
-                             #   spawnSync-tested by tests/commit-state-rebase.test.ts
+                             #   spawnSync-tested by tests/commit-state-rebase.test.ts; conflict
+                             #   skips = set membership over the two committed state files
 probe-judge.ts               # .ts, top-level await; imports loadWatcherConfig (keywords + reasoningEffort for the
                              #   real payload), buildBulkMessages + resolveJudgeConfig (+ Post type) from src;
+                             #   writes state/judge-ceilings.json (writeCeilingsAtomic + JUDGE_CEILINGS_PATH,
+                             #   live-only before the dead gate); INSIDE typecheck + lint + lint-staged

// === HUNK 4 — exit contracts: the state set is two files; the probe writes before the gate ===
-commit-state-rebase.sh      exit 0 = pushed; exit 1 = non-state conflict abort or second push
-                            failure — watch.yml's step shell consumes it with no wrapper
+commit-state-rebase.sh      exit 0 = pushed; exit 1 = a conflict outside the committed state set
+                            (state/seen-posts.json, state/judge-ceilings.json) or a second push
+                            failure — BOTH invokers' step shells consume it with no wrapper
-probe-judge.ts              exit 1 on any failed leg, auth-dead 401/403, or ceiling < 1 — the probe job is a gate, so this reddens the dispatch run
+probe-judge.ts              exit 1 on any failed leg, auth-dead 401/403, or ceiling < 1 — the probe job is a gate, so this reddens the dispatch run; the ceilings write happens BEFORE the gate, so even a red run recorded its readings

// === HUNK 5 — Probe section: append the persistence excerpt inside the existing fence ===
 return 4;                                     // only a fully clean 2→4 ramp reads 4
+// per account, after the ramp: the file key is the trimmed baseUrl (resolveCeilings trims both sides)
+ceilings[account.baseUrl.trim()] = ceiling;
+// AFTER the account loop, BEFORE the dead gate — live-only, whole file (no merge, no staleness):
+await writeCeilingsAtomic(ceilings, JUDGE_CEILINGS_PATH);
+if (dead.length > 0) process.exit(1);         // a red gate skips the Commit ceilings step

// === HUNK 6 — the important-if: re-key the condition; steps 5-6 follow the committed file, no paste step ===
-<important if="you are running the judge probe or changing judge concurrency">
+<important if="you are running the judge probe or changing judge ceilings">
-5. Apply: paste N into the quoted `JUDGE_CONCURRENCY` literal in watch.yml's Run watcher step, updating its `probe run <id>` evidence comment
-6. Semantics downstream: `parseJudgeConcurrency` — absent/blank → 4, present-but-invalid → throws (fail-visible)
+5. Apply: nothing to paste — the probe writes `state/judge-ceilings.json` (whole file, before the gate) and the Commit ceilings step pushes it; a missing entry floors that account at ceiling 1 with one warning
+6. Semantics downstream: `resolveCeilings` trims both sides when matching keys; a red-gate probe skips the commit, so the file keeps the last green reading; the file never fails a run
````

#### 5. README — operator story without the paste step
**File**: `README.md`
**Changes**: intro names both committed state files; Pipeline step 6 becomes the spread story (each call starts at the next account, per-account probe-measured caps, width = ceilings sum, missing reading capped at 1 until the next probe); LLM_ACCOUNTS Purpose cell drops "tried in order" (the dial retires trial-order); the tunable paragraph becomes the dispatch-the-probe story — nothing to paste, green gate commits, red gate keeps the last green reading; the v2-rollback sentence retained.

```markdown
// === HUNK 1 — intro: the persistence sentence names both committed state files ===
-No web UI; the only persistence is `state/seen-posts.json`.
+No web UI; persistence is two committed state files — `state/seen-posts.json` (seen ids) and
+`state/judge-ceilings.json` (the judge's per-account ceilings).

// === HUNK 2 — Pipeline step 6: the width sentence becomes the spread story ===
-   fails the run. Up to `JUDGE_CONCURRENCY`
-   batches run at once, so a 280-post backlog judges in about 3 minutes
-   instead of 13.
+   fails the run. Dispatches spread across the pool: each call starts at
+   the next account, every account is capped at its probe-measured
+   in-flight ceiling, and as many batches run at once as the ceilings add
+   up to (`state/judge-ceilings.json`; an account without a reading is
+   capped at 1 until the next probe run).

// === HUNK 3 — Setup table, LLM_ACCOUNTS Purpose cell: the dial retires "tried in order" ===
-| Judge accounts as a JSON array, tried in order; a 429-cooled account sits out 60 seconds, and an exhausted pool (all accounts cooling past the wait budget) emails an alarm and fails the run |
+| Judge accounts as a JSON array; a 429-cooled account sits out 60 seconds, and an exhausted pool (all accounts cooling past the wait budget) emails an alarm and fails the run |

// === HUNK 4 — Setup: the tunable paragraph becomes the dispatch-the-probe story (no paste step) ===
-   Tunable (a literal in `watch.yml`, not a secret): `JUDGE_CONCURRENCY` —
-   how many bulk judge calls run at once. Measure it first: trigger
-   **Actions → watch → Run workflow**; the dispatch-only probe job ramps
-   concurrent calls against the endpoint and prints a per-account
-   `ceiling=N` summary line; a dead account (failed leg, HTTP 401/403, or a
-   broken ramp) fails the probe job.
-   Paste that reading into the workflow's `JUDGE_CONCURRENCY` line, commit,
-   push. With the line removed — or on a local run without the variable —
-   the watcher judges 4 at a time; a non-positive-integer value fails the run
-   and names the variable. Rolling the code back past v2 requires reverting
+   Judge widths need no tuning: trigger **Actions → watch → Run workflow**
+   once and the dispatch-only probe job measures every `LLM_ACCOUNTS`
+   account (a per-account `ceiling=N` summary line; a dead account — failed
+   leg, HTTP 401/403, or a broken ramp — fails the probe job), writes
+   `state/judge-ceilings.json`, and commits it. Nothing to paste: the next
+   watch run spreads dispatches under those caps. A green gate commits; a
+   red gate skips the commit, so the file keeps its last green reading.
+   Rolling the code back past v2 requires reverting
```

#### 6. AGENTS.md — module map re-synced
**File**: `AGENTS.md`
**Changes**: intro persistence sentence names both files with one writer each; the probe command line names the ceilings write; the `judge.ts` bullet becomes the spread story; the `judge-rotation.ts` bullet names the dial/claim/release/ceiling-waiter machinery; a NEW `src/judge-ceilings.ts` bullet documents the degrade-everything reader and the probe's atomic writer.

```markdown
// === HUNK 1 — intro: the persistence sentence names both committed state files ===
-The only persistence is `state/seen-posts.json`, which the workflow commits
-back after match runs.
+Committed state is two files, one writer each: `state/seen-posts.json`
+(committed back by the workflow after match runs) and
+`state/judge-ceilings.json` (probe-measured judge ceilings, committed by
+the probe job).

// === HUNK 2 — Commands: the probe line names the ceilings write ===
-- `npx tsx scripts/probe-judge.ts` - measure how long the LLM endpoint takes to answer, and ramp concurrent calls to find the concurrency ceiling (needs `LLM_*` env vars)
+- `npx tsx scripts/probe-judge.ts` - measure how long the LLM endpoint takes to answer, ramp concurrent calls to find each account's ceiling, and write `state/judge-ceilings.json` (the probe job commits it; needs `LLM_*` env vars)

// === HUNK 3 — judge.ts bullet: the width sentence becomes the spread story ===
-  one alarm email and exits 1), up to `JUDGE_CONCURRENCY` batches run at
-  once, bulk misses fall back to single-post calls, and a batch the
+  one alarm email and exits 1), dispatches spread across the pool — each
+  starts at the next account and every account is capped at its
+  probe-measured ceiling from `state/judge-ceilings.json` — so batches
+  drain through a pool as wide as the ceilings sum; bulk misses fall back
+  to single-post calls, and a batch the

// === HUNK 4 — judge-rotation bullet + a new judge-ceilings module bullet ===
-- `src/judge-rotation.ts` - account-pool rotation primitives: the cooldown
-  map state, the tagged exhaustion error, and the park helper
+- `src/judge-rotation.ts` - account-pool rotation primitives: the cooldown
+  + in-flight + ceilings state, the dispatch dial (claim/release, ceiling
+  waiters), the tagged exhaustion error, and the park helper
+- `src/judge-ceilings.ts` - the committed ceilings file reader
+  (degrade-everything: absent or malformed `state/judge-ceilings.json`
+  floors every account at ceiling 1 with one warning, never fails a run)
+  and the probe's atomic writer
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Retirement complete (docs scope): `grep -rniE "judge_concurrency|judgeconcurrency" README.md AGENTS.md .rpiv/guidance/` returns 0 hits
- [x] The ceilings file is named in all six files: `grep -rc "judge-ceilings" README.md AGENTS.md .rpiv/guidance/architecture.md .rpiv/guidance/src/architecture.md .rpiv/guidance/.github/workflows/architecture.md .rpiv/guidance/scripts/architecture.md` shows >= 1 per file
- [x] Sync-point arithmetic updated: `grep -rn "6 of the 9\|9 ENV_NAMES" .rpiv/guidance/` returns 0 hits; `grep -n "5 of the 8 ENV_NAMES" .rpiv/guidance/.github/workflows/architecture.md` matches
- [x] The stale single-invoker claim is gone: `grep -rn "EXACTLY ONCE" .rpiv/guidance/` returns 0 hits (Slice 3's carried NOTE)
- [x] Single-claim stragglers gone: `grep -rn "ONLY invocation\|invoked exactly once\|the only persistence" README.md AGENTS.md .rpiv/guidance/` returns 0 hits (round-1 violations 1 and 3)

#### Manual Verification:
- [x] Every guidance fence that quotes rotation/judge code matches the artifact's locked Architecture (7-member RotationState, dial pick, zero-charge ceiling wait, Σ-ceilings width)
- [x] README reads coherently for an operator: the intro and Setup tell one story — dispatch the probe, the ceilings commit themselves; no paste step survives
- [x] The commit-back story is consistent across all three surfaces: workflows guidance (Commit ceilings step, pluralized fence comment + invocation sentence + exit contract), scripts guidance (Invokers + exit-contract line), and the .sh header Slice 3 already rewrote
- [x] The re-keyed important-if blocks route to section names that exist ("Running the Judge Probe and Applying the Reading"; the judge-ceilings reader doctrine line in src guidance)

---

## Phase 5: Deep ramp + sequential dispatch

### Overview

Overrides the settled stop-once-4 quota economy (operator decision 2026-11-07): the probe's committed ceiling reading was capped at 4 by the ramp's literal level list (`for (const level of [2, 4])`), so the spread's Σ-ceilings width inherited that cap no matter what the endpoint allows. The ramp now doubles 2→4→8→16→32 and stops at the first refused level — the ceiling reads as high as the endpoint actually allows, with 32 as a safety cap (an endpoint that never refuses would ramp forever). And the workflow serializes: the watch job `needs:` the probe, so a dispatch run delivers fresh maximal ceilings into the same run's watch. Scheduled 10-minute ticks are unchanged — the probe is dispatch-only and the watch `if` keeps the tick alive, reading the committed file. Requires Phase 3: the serialization story builds on the Commit ceilings step and the two-file commit-back.

### Changes Required:

#### 1. Doubling ramp to the 32 cap
**File**: `scripts/probe-judge.ts`
**Changes**: module docblock's ramp sentence and Revision tail updated; a NEW `RAMP_MAX` constant (safety cap, not a measured value) joins the module-top constants; `findConcurrencyCeiling` walks the doubling levels instead of the `[2, 4]` list. Everything else — `timed`, `rampLevel`, `classifyDead`, the write-before-gate persistence — is unchanged.

```typescript
// === HUNK 1 — module docblock: the ramp sentence updates and a Revision
// 2026-11-07 paragraph joins the Revision tail ===
 * fixture set of real captured post texts. It ramps concurrent bulk calls
 * per account, doubling 2→4→8→16→32 and stopping at the first refused
 * level: Z.AI publishes no concurrency number (tier-based, dynamically
 * adjusted, higher off-peak).
 *
 * Revision 2026-11-07: the stop-once-4 ramp capped every committed ceiling
 * at 4, so the spread's Σ-ceilings width inherited that cap. Operator asked
 * for maximal concurrency: the ramp doubles to the RAMP_MAX safety cap of
 * 32 (worst case 62 verified calls per account), and the dispatch run
 * serializes probe→watch (watch.yml) so the same run's watch starts on the
 * fresh maximal readings.

// === HUNK 2 — RAMP_MAX constant + findConcurrencyCeiling replacement
// (docblock + body; timed/rampLevel unchanged) ===
/** Safety cap for the doubling ramp: the probe never fires more than 32
 *  concurrent calls per account, even against an endpoint that never
 *  refuses. Overrides the settled stop-once-4 quota economy (2026-11-07
 *  operator decision: maximal per-account concurrency requested). Worst
 *  case is 2+4+8+16+32 = 62 verified calls per account per probe. */
const RAMP_MAX = 32;

/**
 * Doubling ramp 2 -> 4 -> 8 -> 16 -> 32 (RAMP_MAX): each level fires
 * `level` concurrent verified bulk calls and the walk stops at the first
 * level that is not fully clean, so the ceiling reads as high as the
 * endpoint actually allows.
 * A refused level reads the ceiling below it; a failed call means a
 * broken endpoint, not a ceiling (return 0). The walk never fires a
 * level the previous one ruled out.
 */
async function findConcurrencyCeiling(payload: unknown, account: LlmAccount): Promise<number> {
  for (let level = 2; level <= RAMP_MAX; level *= 2) {
    const result = await rampLevel(level, payload, account);
    console.log(
      `probe: concurrency ${level} — ${result.ok}/${level} ok, ${result.refused} refused, ${result.failed} failed in ${result.ms}ms`,
    );
    if (result.failed > 0) {
      console.log("probe: a ramp call failed — broken endpoint, not a concurrency ceiling");
      return 0;
    }
    if (result.ok < level) {
      console.log(`probe: concurrency ceiling is below ${level}`);
      return level / 2;
    }
  }
  return RAMP_MAX;
}
```

#### 2. Sequential probe→watch on dispatch runs
**File**: `.github/workflows/watch.yml`
**Changes**: the watch job gains `needs: [probe]` and an `if` that keeps scheduled ticks alive (the probe is skipped there) while a dispatch-triggered watch runs only after a GREEN probe; the probe job's ramp comment and commit-back comment update; the watch head comment tells the serialization story.

```yaml
# === HUNK 1 — the probe job's comment: ramp wording + serialization ===
    # The probe walks EVERY LLM_ACCOUNTS account (doubling ramp 2→32, ~62
    # calls worst case each): an auth-dead key or a failed leg fails this
    # job, so a rotten key in the pool reddens the dispatch run instead of
    # passing unseen. 429-refused legs are reported as busy, not dead —
    # throttling is data. The measured per-account ceilings commit to
    # state/judge-ceilings.json (live-only, before the dead gate) and the
    # Commit ceilings step pushes them. The watch job NEEDS this job green
    # on dispatch runs — a fresh maximal reading flows into the same run's
    # watch; a red gate blocks that dispatch's watch (fail-fast). Scheduled
    # ticks never gate on it (this job is dispatch-only).

# === HUNK 2 — the watch job: needs + the schedule-preserving if, directly
# above runs-on; the existing width and timeout paragraphs are unchanged ===
  watch:
    needs: [probe]
    if: ${{ !cancelled() && (github.event_name == 'schedule' || needs.probe.result == 'success') }}
    runs-on: ubuntu-latest
    # Serialization (2026-11-07): on dispatch runs this job WAITS for a
    # green probe and starts on the ceilings it just committed — the
    # fresh maximal reading reaches the same run. On schedule ticks the
    # probe is skipped (dispatch-only), and this if keeps the tick alive:
    # the run reads the committed state/judge-ceilings.json as before. A
    # red probe blocks only the dispatch's watch — the digest for that
    # dispatch is suppressed (accepted cost); scheduled ticks never gate
    # on the probe.
```

#### 3. Docs re-sync (ramp + serialization story)
**File**: `README.md`, `.rpiv/guidance/.github/workflows/architecture.md`, `.rpiv/guidance/scripts/architecture.md`
**Changes**: every surface that quotes the ramp gets the doubling story; README and the workflows guidance additionally carry the serialization.

```markdown
// === README — probe paragraph: the ramp sentence grows the doubling detail
// and the serialization sentence joins the "Nothing to paste" story ===
   Judge widths need no tuning: trigger **Actions → watch → Run workflow**
   once and the dispatch-only probe job measures every `LLM_ACCOUNTS`
   account (a per-account `ceiling=N` summary line; the ramp doubles
   concurrent calls 2→32 per account and stops when the endpoint refuses;
   a dead account — failed leg, HTTP 401/403, or a broken ramp — fails the
   probe job), writes `state/judge-ceilings.json`, and commits it. On a
   dispatch run the watch job waits for the green probe and starts on
   those fresh ceilings; scheduled 10-minute runs skip the probe and read
   the committed file. Nothing to paste: watch spreads dispatches under
   those caps. A green gate commits; a red gate skips the commit and the
   dispatch's watch, so the file keeps its last green reading.

// === workflows guidance — the probe-job fence comment ("2→4 ramp") and the
// Structure fence: the doubling wording + the watch needs/if lines ===
  # Walks EVERY LLM_ACCOUNTS account (doubling ramp 2→32): an auth-dead key or a failed leg fails this job, so a
  ...
  # watch: needs probe (serialization) — schedule ticks skip the probe and
  #   watch's if keeps them alive on the committed ceilings

// === scripts guidance — the probe fence excerpt and important-if step 3 ===
 for (let level = 2; level <= RAMP_MAX; level *= 2) {  // doubling walk, never fires a ruled-out level
 ...
 return RAMP_MAX;                             // only a fully clean 2→32 ramp reads 32
 ...
3. It measures per account: a minimal call, a 10-post bulk call twice (variance; production `buildBulkMessages` + real keywords + reasoningEffort), then the doubling ramp 2→32 (~6–62 calls, stopping at the first refused level)
```

(AGENTS.md's probe line — "ramp concurrent calls to find each account's ceiling" — stays true word-for-word; no change.)

### Success Criteria:

#### Automated Verification:
- [x] Whole-plan gate green: `npm run typecheck && npm run lint && npm test`
- [x] Ramp walk replaced: `grep -n "level of \[2, 4\]\|return 4;" scripts/probe-judge.ts` returns 0 hits; `grep -cn "RAMP_MAX" scripts/probe-judge.ts` ≥ 3 (cap constant, loop bound, terminal return)
- [x] Serialization wired: `grep -n "needs: \[probe\]" .github/workflows/watch.yml` matches; `grep -n "needs.probe.result == 'success'" .github/workflows/watch.yml` matches; the schedule-survival guard `github.event_name == 'schedule'` sits in the same `if`
- [x] Stale ramp prose gone: `grep -rn "stop-once-4\|2→4 ramp\|2->4->\|~6 calls" scripts/probe-judge.ts .github/workflows/watch.yml .rpiv/guidance/ README.md` returns 0 hits
- [x] Refusal semantics intact: a refused level still reads `level / 2` and a failed call still returns 0 (the walk body is unchanged apart from the bounds — `classifyDead`'s broken-ramp path untouched)

#### Manual Verification:
- [ ] A dispatch run's job graph shows probe → watch sequentially (watch waited on probe)
- [ ] The probe log shows levels doubling past 4 until refusal; a ceiling reading > 4 lands when the endpoint allows it (e.g. `ceiling=8/16/32`), and the same run's watch starts on those readings with no floor warnings
- [ ] A scheduled 10-minute tick runs watch alone — the probe job is absent from the graph and watch is NOT skipped
- [ ] A red-gate dispatch reddens the probe AND skips that dispatch's watch (accepted cost: no digest for that dispatch); scheduled ticks unaffected

---

## Phase 6: Parallel account walk

### Overview

Operator feedback from Actions run 42354544399 (2026-11-07): with 3 `LLM_ACCOUNTS` the probe step took ~7 minutes because `main()` walked the accounts sequentially — account 1's whole sequence (minimal call → 10-post bulk → bulk again → ramp 2→32), then account 2's, then account 3's — so wall time = Σ(per-account time). The per-account probe for ALL accounts now runs concurrently: `main()` maps each account onto its own async probe and awaits `Promise.allSettled`, then collects in pool order. Wall time becomes the slowest single account (~3x faster at 3 accounts). Nothing inside an account changes order — the ramp levels stay sequential because each level's verdict gates the next — and the live-only ceilings write, the exit-1 dead gate, and `RAMP_MAX` are untouched. Requires Phase 5: this parallelizes the account walk over Phase 5's doubling ramp.

### Changes Required:

#### 1. Concurrent per-account probes
**File**: `scripts/probe-judge.ts`
**Changes**: the account loop's body moves into `probeAccount(index, account)` — one account's minimal + bulk + bulk-again + `findConcurrencyCeiling` sequence in the production order, plus its `=== label ===` header and per-account summary line (printed from inside the probe so output streams as each account progresses). `main()` maps `accounts` onto `probeAccount` promises, `await Promise.allSettled(...)`, then walks the settled outcomes IN POOL ORDER: fulfilled → record `ceilings[account.baseUrl.trim()]`, run `classifyDead`, push to `dead` on a cause; rejected → push to `dead` with the reason and record NO ceiling (the reader floors that account at 1 with one warning — the honest signal; `timed` already converts network failures to `failed` outcomes, so a rejection here is an unexpected bug, and containment keeps the other accounts' readings alive). `writeCeilingsAtomic` and the dead gate stay after the walk, byte-unchanged in position (live-only, whole file, BEFORE the gate).

```typescript
// === HUNK 1 — NEW probeAccount: the former loop body (order unchanged;
// the ramp call gains the label argument; the summary line prints from
// here so output streams as each account progresses) ===
async function probeAccount(
  index: number,
  account: LlmAccount,
): Promise<{ probe: AccountProbe; ceiling: number }> {
  const label = `account ${index + 1} (${account.baseUrl})`;
  console.log(`probe: === ${label} ===`);
  // ... minimal / ten / bulkPayload / bulk / again — unchanged ...
  const ceiling = await findConcurrencyCeiling(bulkPayload, account, label);
  const probe: AccountProbe = { position: index + 1, label, minimal, bulk, bulkAgain: again, ceiling };
  console.log(
    `probe: ${label} — minimal=${minimal.kind} bulk=${bulk.kind} bulkAgain=${again.kind} ceiling=${ceiling}`,
  );
  return { probe, ceiling };
}

// === HUNK 2 — main(): the sequential for-loop is REPLACED by the
// concurrent walk + pool-order collector; writeCeilingsAtomic and the dead
// gate below it are byte-unchanged ===
  const settled = await Promise.allSettled(
    accounts.map((account, index) => probeAccount(index, account)),
  );
  const ceilings: Record<string, number> = {};
  const dead: string[] = [];
  for (const [index, account] of accounts.entries()) {
    const label = `account ${index + 1} (${account.baseUrl})`;
    const outcome = settled[index];
    if (outcome?.status !== "fulfilled") {
      const reason = outcome?.status === "rejected" ? String(outcome.reason) : "missing result";
      dead.push(`${label} — probe crashed: ${reason}`);
      continue;
    }
    const { probe, ceiling } = outcome.value;
    // File key = trimmed baseUrl (resolveCeilings trims both sides). Twins
    // sharing a baseUrl share one reading — last write wins; one entry per
    // endpoint is the file's shape.
    ceilings[account.baseUrl.trim()] = ceiling;
    const cause = classifyDead(probe);
    if (cause !== null) {
      dead.push(`${label} — ${cause}`);
    }
  }
```

#### 2. Account-labeled ramp logs
**File**: `scripts/probe-judge.ts`
**Changes**: interleaved output must stay attributable — today's ramp lines are label-free (`probe: concurrency 8 — ...`) and `rampLevel` fires its calls under the bare label `"ramp"`. `findConcurrencyCeiling` gains a trailing `label: string` parameter and prefixes every line it prints; `rampLevel` gains the same parameter and composes the per-call label as `${label} ramp L${level}`. `timed` is unchanged (the label arrives composed). Now that account probes interleave, EVERY line between a header and its summary names its account.

```typescript
// === HUNK — findConcurrencyCeiling + rampLevel: label threaded through ===
async function rampLevel(
  count: number,
  payload: unknown,
  account: LlmAccount,
  label: string,
): Promise<{ ok: number; refused: number; failed: number; ms: number }> {
  // ... const results = await Promise.all(
  //       Array.from({ length: count }, () => timed(`${label} ramp L${count}`, payload, account))) ...
}

async function findConcurrencyCeiling(
  payload: unknown,
  account: LlmAccount,
  label: string,
): Promise<number> {
  for (let level = 2; level <= RAMP_MAX; level *= 2) {
    const result = await rampLevel(level, payload, account, label);
    console.log(
      `probe: ${label} — concurrency ${level} — ${result.ok}/${level} ok, ${result.refused} refused, ${result.failed} failed in ${result.ms}ms`,
    );
    if (result.failed > 0) {
      console.log(`probe: ${label} — a ramp call failed — broken endpoint, not a concurrency ceiling`);
      return 0;
    }
    if (result.ok < level) {
      console.log(`probe: ${label} — concurrency ceiling is below ${level}`);
      return level / 2;
    }
  }
  return RAMP_MAX;
}
```

#### 3. Docs: the probe walks accounts concurrently
**File**: `.rpiv/guidance/scripts/architecture.md`
**Changes**: the important-if step 3 gains the concurrency fact (one sentence). Every other probe mention stays true word-for-word ("measures every LLM_ACCOUNTS account" needs no edit).

```markdown
// === HUNK — important-if step 3: the walk is concurrent ===
-3. It measures per account: a minimal call, a 10-post bulk call twice (variance; production `buildBulkMessages` + real keywords + reasoningEffort), then the doubling ramp 2→32 (~6–62 calls, stopping at the first refused level)
+3. It measures per account: a minimal call, a 10-post bulk call twice (variance; production `buildBulkMessages` + real keywords + reasoningEffort), then the doubling ramp 2→32 (~6–62 calls, stopping at the first refused level) — and all accounts are probed concurrently, so wall time is the slowest account, not the sum
```

### Success Criteria:

#### Automated Verification:
- [x] Whole-plan gate green: `npm run typecheck && npm run lint && npm test`
- [x] Concurrent walk wired: `grep -n "Promise.allSettled" scripts/probe-judge.ts` matches; exactly one `findConcurrencyCeiling` call site, inside probeAccount (`grep -c "await findConcurrencyCeiling" scripts/probe-judge.ts` prints 1)
- [x] Pool-order collection: the collector walks `accounts.entries()` over the settled outcomes, so ceilings keys and dead lines stay in pool order regardless of finish order
- [x] Every ramp line names its account: `grep -n "ramp L" scripts/probe-judge.ts` matches (the composed timed label); the per-level concurrency line interpolates the label in the same template
- [x] Ordering pin intact: `writeCeilingsAtomic` still sits BEFORE the dead gate (`grep -n "writeCeilingsAtomic\|DEAD account" scripts/probe-judge.ts`)
- [x] Containment pin: a rejected probeAccount lands in `dead` (exit 1) and records NO ceiling; `classifyDead` untouched (refused/failed semantics unchanged)

#### Manual Verification:
- [ ] A dispatch run's probe step shows the accounts' `===` headers and ramp lines interleaved, and total probe duration ≈ the slowest single account (3 accounts: ~2.5–3 min, not ~7)
- [ ] One summary line per account (`minimal=... ceiling=N`) still prints, and the committed-count line follows it
- [ ] A dead account under the parallel walk still exits 1 naming it; the other accounts' readings still land in the committed file (write-before-gate)
- [ ] Interleaved logs stay attributable: every line between an account's header and its summary carries that account's label

### Accepted trade (recorded):

A host's minimal/bulk latency numbers are measured while peer accounts load their own endpoints — runner-side contention can inflate those informational numbers slightly. Ceiling readings are refusal-driven (HTTP 429 from the account's OWN endpoint) and unaffected. Operator asked for speed over latency precision.

---

## Testing Strategy

### Automated:
- Per-phase gates (read-only repo-wide): `npm run typecheck`, `npm run lint`, `npm test` after each phase.
- Scoped suites: `npx tsx --test tests/judge-ceilings.test.ts` (Phase 1), `npx tsx --test tests/judge-rotation.test.ts` (Phase 2 — includes the FRD spread acceptance), `npx tsx --test tests/commit-state-rebase.test.ts` (Phase 3 — includes the two new commit-back pins).
- Phase 5: the probe script has no offline suite (top-level await entry) — the ramp and serialization land via the Phase 5 greps plus a live dispatch (Manual); `npm run typecheck && npm run lint && npm test` stays the offline gate.
- Retirement greps per phase scope: code (`src/ tests/`) at Phase 2, workflow + probe at Phase 3, docs at Phase 4.
- Whole-plan gate: `npm run typecheck && npm run lint && npm test` on the finished tree (owned by `validate`). All three are green at base and stay green per phase.

### Manual Testing Steps:
1. One `workflow_dispatch` probe run: a green probe commits `state/judge-ceilings.json` cleanly; the next watch run consumes it with no 429 storm in the judge logs (the composite lesson: offline tests passed both prior times; live runs caught the real failure).
2. A red-gate dispatch (rotten key) reddens the run AND skips the Commit ceilings step — the committed file still holds the last green reading.
3. Operator log byte-compat: diff one run's judge warn lines (cooling / backingOff / statusFailure / transportError) against the old wording (D2).

## Performance Considerations

- Total in-flight = Σ ceilings (no overall clamp): a 5×4 pool runs 20 concurrent HTTP requests. The 8-minute job cap arithmetic (`watch.yml:56-65`) assumed width 4; the wave-math comment (`:50-55`) must become formulaic or drop the number.
- The release-waiter queue is a condition-variable in miniature: waiters resolve on release decrement (real network I/O, bounded by pool widths) — no hot spin, no polling.
- Ceilings read once per run at the `judgePosts` boundary (index-keyed on state); the pick stays synchronous — no per-pick file reads.

## Migration Notes

- `state/judge-ceilings.json` is a new committed file. `.gitignore:6` excludes only `state/linkedin-leg-dead.flag`, so no ignore change is needed. Absent file on first watch run → every account ceiling 1 + one warning per account (degrade path, never fails the run).
- `JUDGE_CONCURRENCY` removal is backwards-incompatible for local runs that set it: the variable becomes inert (no parser reads it). Documented in README/AGENTS.
- Rollback: revert the feature commit; the ceilings file is inert data nothing reads.

## Developer Context

Step 4 triage (all four rows applied): the stale line anchors and the HUNK 2 scope gap originate in the design's Architecture prose, not plan transcription — fixes were applied plan-locally per the skill's option (b), each annotated `design follow-up` in the Plan Review table. If the design artifact is revisited, sync its judge.ts deletion ranges (27-37 → 59-68, 184-209 → 183-202), its HUNK 1 header (lines 1-24 → 1-32), and its judge-rotation HUNK 2 docblock scope.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5. Coverage reviewer: zero findings — all 9 design Verification Notes + 10 Pattern References land in Success Criteria, Testing Strategy, or visible test code._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| ------ | -------- | ------------ | -------- | --------- | ------- | -------------- | ---------- |
| code | Phase 2 §2 (judge.ts) | src/judge.ts:59-68 | concern | actionability | The DELETIONS prose anchors the `DEFAULT_JUDGE_CONCURRENCY` const block at "src/judge.ts:27-37", but at HEAD that block (docblock + `const`) sits at 59-68 — lines 27-37 actually cover the module-docblock tail plus the import block (33-44), a load-bearing region | Re-anchor the deletion to src/judge.ts:59-68 | applied: DELETIONS prose re-anchored to src/judge.ts:59-68 (plan-local; design follow-up: .rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md) |
| code | Phase 2 §2 (judge.ts) | src/judge.ts:183-202 | concern | actionability | The DELETIONS prose anchors the `parseJudgeConcurrency` docblock+function at "src/judge.ts:184-209", but the block ends at 202 and lines 203-209 are `resolveJudgeConfig`'s docblock and signature — a symbol `src/index.ts` imports, deleted if the range is applied literally | Re-anchor the deletion to src/judge.ts:183-202, stopping before `resolveJudgeConfig` | applied: DELETIONS prose re-anchored to 183-202 with the resolveJudgeConfig guard (plan-local; design follow-up: .rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md) |
| code | Phase 2 §2 (judge.ts) | src/judge.ts:1-32 | suggestion | actionability | HUNK 1 says it "replaces the module docblock (lines 1-24)", but the HEAD module docblock spans lines 1-32; a range-literal edit leaves lines 25-32 dangling with an unmatched `*/` | Update the parenthetical to lines 1-32 or drop the range and rely on the "module docblock" descriptor | applied: HUNK 1 header now says (lines 1-32) (plan-local; design follow-up: .rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md) |
| code | Phase 2 §1 (judge-rotation.ts) | src/judge-rotation.ts:33-40 | suggestion | code-quality | HUNK 2 replaces only the `RotationState` interface body, leaving the preceding docblock's "every dispatch scans the pool from account 1 and skips accounts that are still cooling … lands back on account 1" stale and contradictory under the dial + at-ceiling model it introduces | Extend HUNK 2 to also replace the docblock at src/judge-rotation.ts:33-40 with the dial/ceiling wording | applied: HUNK 2 extended with the replacement dial/ceiling docblock (plan-local; design follow-up: .rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md) |

## References

- Design: `.rpiv/artifacts/designs/2026-11-06_11-44-02_llm-account-spread-judge.md`
- Solutions: `.rpiv/artifacts/solutions/2026-11-06_11-05-39_llm-account-spread-judge.md` (Option 1 selected, verdict pass)
- Research: `.rpiv/artifacts/research/2026-11-06_10-12-16_llm-account-spread-judge.md` (current-state map, falsified-test enumeration, retirement inventory)
- Discover (FRD): `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md` (acceptance criteria, settled decisions, non-goals)
- Precedent plan: `.rpiv/artifacts/plans/2026-10-27_17-55-19_per-batch-llm-rotation.md` (four invariants, the RotationState reshape precedent)
- Precedent designs: `.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md` (peak-recorder test precedent), `.rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md` (F010 split manifest, live-dispatch validation doctrine)

## Follow-ups

_Timestamped revision history. Prior phase decisions stay visible above; each revise call appends here._

### 2026-11-07_15-27-13 — Phase 6 added: parallel account walk (plan only, no code)

Operator feedback (Actions run 42354544399, probe job ~7 min on 3 accounts): `main()` walked accounts sequentially, so wall time = Σ(per-account). Phase 6 extracts the per-account probe (`probeAccount`) and runs all accounts concurrently (`Promise.allSettled`), collecting in pool order; ramp levels stay sequential WITHIN an account (each level's verdict gates the next); ramp/concurrency log lines gain the account label so interleaved output stays attributable; the live-only ceilings write, the exit-1 dead gate, and `RAMP_MAX` are unchanged. Accepted trade: per-host latency lines can inflate slightly under concurrent cross-account load (ceilings are refusal-driven, unaffected). Next: `/skill:implement .rpiv/artifacts/plans/2026-11-06_18-36-57_llm-account-spread-judge.md Phase 6`.
