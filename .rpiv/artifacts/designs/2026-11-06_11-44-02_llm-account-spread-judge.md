---
date: 2026-11-06T11:44:02+0700
author: Yogiswara Utama
commit: 04424f5
branch: main
repository: loker-watcher
topic: "Spread LLM judge load across all accounts using probe-measured per-account ceilings"
tags: [design, judge, judge-rotation, judge-ceilings, probe-judge, watch-workflow]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-06_11-05-39_llm-account-spread-judge.md
last_updated: 2026-11-06T18:22:51+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Updated filled Slice 4's six empty docs Architecture fences (Step 9 follow-up); SC greps verified against the authored hunks"
---

# Design: LLM Account Spread — Dispatch Counter + Per-Account Ceilings

## Summary

Every dispatch starts at the next account: `RotationState` grows required members (per-index ceilings, an in-flight map, a dispatch-sequence counter, and a release-waiter queue), the pick scans from `counter % N` and advances only on a fresh claim, and ceiling-blocked dispatches await a deferred resolved by the next release decrement — zero budget charge, so the 180s park budget and the exhaustion alarm stay exclusive to cooldown parks. The probe writes live-only per-account ceilings to a committed `state/judge-ceilings.json` before its dead gate, and the probe job commits it via `scripts/commit-state-rebase.sh`; `JUDGE_CONCURRENCY` is deleted outright and width becomes Σ per-index ceilings derived inside `judgePosts`.

## Requirements

- Every dispatch starts at the next account (shared counter), so the first N calls hit N distinct accounts (FRD acceptance criterion).
- Each account is capped at its own probe-measured in-flight ceiling, strictly enforced.
- No overall concurrency clamp — total in-flight = Σ per-account ceilings.
- Ceilings persist to a committed flat `{baseUrl: ceiling}` JSON file written by the probe job (live-only readings, written before the dead-account gate).
- Missing ceiling → ceiling 1 per account + exactly one warning; the run never fails on the ceilings file.
- The 180s park budget and the pool-exhaustion alarm stay unchanged and exclusive to cooldown parks.
- `JUDGE_CONCURRENCY` is deleted outright (registry, parser, call-site feed, watch.yml literal).

## Current State Analysis

### Key Discoveries

- `RotationState` (`src/judge-rotation.ts:41-48`) carries exactly `accounts`, `cooldownUntil`, `waitBudgetRemainingMs`; constructed once per run at `src/judge.ts:691-695` and shared by reference with both pools.
- The pick is synchronous and pre-await: `dispatchLlmCall` calls `pickEligibleAccount(state, now())` at `src/judge.ts:378` — the single production pick site. First-fit from index 0 (`src/judge-rotation.ts:84-95`); `undefined` ⟺ every account cooling.
- Claim must sit between `src/judge.ts:391` and `:392` (same pre-await sync window as the pick); release runs in a `try/finally` around the attempt body — seven exit paths covered mechanically.
- Sync-window cursor claim precedent: `src/pool.ts:42-45` (read-advance-bounds-check, no await between).
- Required-mutable-scalar precedent: `waitBudgetRemainingMs` — the last interface reshape added exactly such a field; required fields make `tsc --noEmit` enumerate all three construction literals (`src/judge.ts:691-695`, `tests/judge-rotation.test.ts:37-45`, `tests/judge.test.ts:15-23`).
- Reader doctrine map: fail-visible (`loadWatcherConfig`) / ENOENT-only degrade (`loadState`) / degrade-everything (`readPayloadPosts`) — the ceilings reader is a new fourth doctrine (committed file, degrade-everything, per-account warn).
- Atomic write shape to clone: `writeStateAtomic` (`src/state.ts:125-181`), `writePayloadAtomic` (`src/linkedin-payload.ts:90-113`).
- Commit-back machinery to reuse: `scripts/commit-state-rebase.sh` (skip-set `:47-51` is a single-literal equality needing set semantics), watch-job commit step (`watch.yml:114-133`).
- The probe already measures a per-account ceiling (`findConcurrencyCeiling`, `scripts/probe-judge.ts:133-156`, domain {0, 1, 2, 4}) but only prints it (`:233-235`); it has no write path and no test suite.
- `JUDGE_CONCURRENCY` retirement inventory (verified by grep): registry `src/config.ts:22`, parser `src/judge.ts:194-209`, default `src/judge.ts:68`, docblock `src/judge.ts:25,63`, feed `src/index.ts:276`, param `src/judge.ts:687`, literal `watch.yml:102`, tests `tests/judge.test.ts:91-111`, plus doc surfaces `README.md:35,79-85` and `AGENTS.md:105`.

## Scope

### Building

- Proactive spread (state-owned dispatch counter, claim-time-only advance, zero-based first claim).
- Strict per-account in-flight caps with release-waiter wake (zero budget charge).
- Ceilings module: pure `resolveCeilings` + fs loader + atomic writer + `JUDGE_CEILINGS_PATH` constant.
- Probe persistence (live-only, before the dead gate) + probe-job commit via `commit-state-rebase.sh` with a generalized skip-set.
- `JUDGE_CONCURRENCY` retirement across code, workflow, tests, README, AGENTS.
- Park-budget/exhaustion semantics preserved for cooldowns only.

### Not Building

- Staleness bounds on the ceilings file (settled: none — dispatch-only cadence makes days-old readings legitimate).
- Changing the 180s budget, `WAKE_JITTER_MS`, or the exhaustion alarm.
- Touching fallback-phase `FALLBACK_CALL_BUDGET` semantics (already ceiling-safe by check ordering, `src/judge.ts:778-780`).
- An E2E harness for single-credential env vars (FRD follow-up, unverified this session).

## Decisions

### D1: Spread mechanism — dispatch counter + per-account caps

Ambiguity: four candidates scored by four independent analyzer passes (solutions artifact).

Explored: Option 1 (counter + caps, release-waiters, probe-committed ceilings) vs Option 2 (busy-until stamping — false exhaustion alarms on healthy runs, ceiling-1 collapse) vs Option 3 (per-account lanes — deletes the 429 migration model, broadest test invalidation) vs Option 4 (raised `JUDGE_CONCURRENCY` — structurally cannot meet the acceptance criterion, re-creates the `7cc7250` burst amplification).

Decision: Option 1. The only candidate clearing the fit filter; each flagged risk maps to a designed answer (required state fields, pre-await claim + `try/finally` release, wake-on-release with zero budget charge, probe commits live-only readings before the dead gate, skip-set generalizes to set membership).

### D2: Mutation ownership — all rotation mutation in src/judge-rotation.ts

Simple: `coolAccount`, `parkUntilEligible`, `failuresFromCooldowns` all live in `src/judge-rotation.ts` (`:103-176`), the F010 split rationale at `:1-5`. The four new helpers (`claimAccount`, `releaseAccount`, `waitCeilingSlot`, `earliestCooldown`) follow the same ownership. Confirmed at checkpoint: "Follow F010 ownership".

### D3: Ceilings resolution seam — WatcherDeps field mirroring linkedinFetch

Simple: `src/index.ts:115-116` defines the `linkedinFetch` seam (field + fs-reading default at `:155`, invocation at `:202`). The ceilings resolution follows the identical shape: `judgeCeilings?: (accounts) => Map<number, number>` with the fs-reading `loadAccountCeilings` default. Confirmed at checkpoint: "Mirror linkedinFetch".

### D4: Ceiling-blocked waits — wake on release, zero budget charge

Ambiguity: an all-at-ceiling pick has no cooldown expiry, so the current park would charge the whole 180s budget against `earliest = Infinity` (`src/judge-rotation.ts:153-157`) and false-trip the alarm on a healthy backlog.

Explored: (A) wake-on-release deferred resolved by the next release decrement, zero budget charge; (B) busy-until stamping at claim so the existing park math works — rejected because ceiling waits would charge the 180s budget for events that land in 5-30s.

Decision: (A). `waitBudgetRemainingMs` keeps its documented meaning ("parked on *cooling* accounts", `src/judge.ts:93-95`); the three exhaustion conversion sites stay cooldown-only. `coolAccount` also resolves waiters (a fresh 429 reduces effective capacity).

### D5: JUDGE_CONCURRENCY — deleted outright

Ambiguity: delete outright vs leave unused in `ENV_NAMES`.

Explored: an unused registry entry recreates the F024 pathology the tech-debt audit fixed; every other of the 9 names has a live consumer.

Decision: delete outright — registry, parser, default, docblock mentions, call-site feed, `judgePosts` param, watch.yml literal, tests, README, AGENTS. Confirmed at checkpoint.

### D6: Counter advance — every successful claim advances; undefined pick never moves it

Simple: the post-park-retry pin (`tests/judge-rotation.test.ts:582`) requires that a park re-pick not advance the counter. The pick advances the counter only when it returns an account; `undefined` (all cooling-or-at-ceiling) leaves it untouched. Zero-based first claim (claim 0 designates account 1).

### D7: Attempt-ladder restructure — sleeps run after the release

Simple: the 5xx backoff sleep must happen with the slot free ("the ceiling counts HTTP requests in flight, not backoff waits", research §claim-placement). `dispatchLlmCall`'s ladder moves inside a `try { try {…} catch (transport) {…} } finally { release }` construct: the inner try/catch is the unchanged total transport converter, the finally covers every exit (answered, unanswered, rewind, transport, thrown), and the ladder returns an `AttemptDirective` so the backoff sleep and rewinds run after the finally with the slot released.

## Architecture

### src/judge-ceilings.ts — NEW

Full module: the degrade-never-throws ceilings reader (pure resolver + fs wrapper) and the atomic writer the probe job calls.

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

### tests/judge-ceilings.test.ts — NEW

Full suite: the resolveCeilings matrix, the fs-wrapper degrade classes, the atomic-write failure shape.

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

### src/config.ts — MODIFY

Merged fence (Slice 1 added the ceilings constant; Slice 2 removes the retired env name):

```typescript
// === Slice 2 HUNK — ENV_NAMES: the judgeConcurrency line is DELETED (the
// JUDGE_CONCURRENCY variable becomes inert; documented in README/AGENTS at
// Slice 4). Full merged block:
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

// === Slice 1 (unchanged, kept for the merged view) — after LINKEDIN_PAYLOAD_PATH:
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

### src/judge-rotation.ts — MODIFY

Hunk-scoped: everything not shown (COOLDOWN_MS/WAKE_JITTER_MS constants, ROTATION_EXHAUSTED machinery, rotationExhausted, isRotationExhausted, failuresFromCooldowns) is untouched.

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

// === HUNK 2 — replaces interface RotationState ===
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

### src/judge.ts — MODIFY

Deletions (prose, not code): the `DEFAULT_JUDGE_CONCURRENCY` const block (src/judge.ts:27-37) and the `parseJudgeConcurrency` docblock+function (src/judge.ts:184-209) are removed entirely.

```typescript
// === HUNK 1 — replaces the module docblock (lines 1-24) ===
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

### src/index.ts — MODIFY

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

### tests/judge-rotation.test.ts — MODIFY

Kept unchanged: both account-pool helpers, `accountTwoAnswering`, the whole `describe("judgePost")` (all ten its — re-traced green on the new mechanics), and these rotation-suite tests whose only change is the numeric width argument becoming a ceilings map: "drain-then-throw", "cools to account 2 on the first 429" (no arg — the `new Map()` default gives width 1), "skips a still-cooling account when the fallback scan restarts at account 1" (no arg), "defers a batch on a transport error" (no arg).

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

### tests/judge.test.ts — MODIFY

Kept unchanged: resolveJudgeConfig + parseLlmAccounts describes, measuredFetch/bulkMissThenAnswer factories, the reasoning-effort and prompt suites, and every default-arg judgePosts call whose assertions are width-independent (call counts, order, budget starvation — the `new Map()` default gives width 1).

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

### tests/judge-helpers.ts — MODIFY

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

### scripts/probe-judge.ts — MODIFY

Hunk-scoped: the probe gains the live-only ceilings write (before the dead gate) and its docblocks drop the retired width-knob name; everything not shown is unchanged.

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

### .github/workflows/watch.yml — MODIFY

The probe job grows the Commit ceilings step (and fetch-depth: 0); the watch job loses the width literal and its comment goes formulaic. All other jobs, steps, and workflow-level keys are unchanged.

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

### scripts/commit-state-rebase.sh — MODIFY

The skip test becomes set membership over the two committed state files; the header names the second invoker and gains a ledger entry; the shebang, `set -e`, the 50-skip bound, the bound-exhaustion echo, `git rebase --skip || true`, the lease push, and the one-retry tail are byte-unchanged.

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

### tests/commit-state-rebase.test.ts — MODIFY

Third advanceOrigin arm + two new scenarios; every existing test, helper, fixture, and the bash-resolution gate are untouched.

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

### .rpiv/guidance/architecture.md — MODIFY

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

### .rpiv/guidance/src/architecture.md — MODIFY

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

### .rpiv/guidance/.github/workflows/architecture.md — MODIFY

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

### .rpiv/guidance/scripts/architecture.md — MODIFY

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

### README.md — MODIFY

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

### AGENTS.md — MODIFY

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

## Slices

### Slice 1: Ceilings module

**Files**: `src/judge-ceilings.ts`, `tests/judge-ceilings.test.ts`, `src/config.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] resolveCeilings matrix green: happy map by index; missing entry floors at 1 with exactly one warning naming the baseUrl; undefined file → all-1; zero/fractional/non-numeric treated as missing (fractional asserted in its own case); shared baseUrl shares silently; keys trimmed on both sides
- [ ] loadAccountCeilings degrades: absent → all-1 with no reason warn; malformed → reason warn + all-1; array file → all-1; partial file → exactly one floor warning per missing account
- [ ] writeCeilingsAtomic round-trips through loadAccountCeilings; a failed write rejects with `/^ceilings: atomic write failed for /`

#### Manual Verification:
- [ ] The floor warning reads as operator guidance: names the baseUrl and points at the probe-committed file

### Slice 2: Spread mechanism

**Files**: `src/judge-rotation.ts`, `src/judge.ts`, `src/index.ts`, `src/config.ts`, `tests/judge-rotation.test.ts`, `tests/judge.test.ts`, `tests/judge-helpers.ts`

#### Automated Verification:
- [ ] Spread acceptance: `npx tsx --test tests/judge-rotation.test.ts` — "first 5 judge calls of a 50-post run hit 5 distinct accounts" green (`new Set(auths.slice(0, 5)).size === 5`)
- [ ] Per-host cap pin: peaks ≤ ceilings across BOTH judge phases (bulk-miss double, twoAccounts ceilings [2,1])
- [ ] Zero-charge pin: an all-at-ceiling pick parks on `ceilingWaiters` with `waitBudgetRemainingMs === 180_000` and zero sleeps, wakes on release, budget still 180_000 after
- [ ] Cooldown-skip precedence pin: the dial-designated account cooling → dispatch lands on the next account
- [ ] Primitive pins: dial-wrap pick, claim moves dial past claim + inFlight, undefined pick never moves the dial (with and without startAt), release decrement/wake/clamp, fresh-stamp wake vs re-stamp silence, earliestCooldown min-active
- [ ] Same-account 5xx pin: "retries a 5xx on the same account with backoff, never rotating" green with ceilings maps (auths `[key-1, key-1]`, delays `[1_000]`)
- [ ] Retirement (code scope): `grep -rn "JUDGE_CONCURRENCY\|judgeConcurrency" src/ tests/` returns 0 hits (watch.yml literal + probe doc mentions are Slice 3; README/AGENTS are Slice 4)
- [ ] Mirror completeness: both freshState copies construct all four new RotationState members (`grep -c "ceilingWaiters" tests/judge-rotation.test.ts tests/judge.test.ts` ≥ 1 per file)

#### Manual Verification:
- [ ] Operator log byte-compat: cooling / backingOff / statusFailure / transportError warn strings unchanged (D2) — diff one run's judge lines against the old wording
- [ ] judge-rotation.ts's module docblock reads coherently (cooldown model + spread model, no contradiction)

### Slice 3: Probe persistence + commit-back

**Files**: `scripts/probe-judge.ts`, `.github/workflows/watch.yml`, `scripts/commit-state-rebase.sh`, `tests/commit-state-rebase.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] Ceilings-skip pin green: "skips a judge-ceilings conflict (the probe job's commit-back)" — exit 0, origin keeps its own reading
- [ ] Mixed-conflict pin green: "aborts a two-line conflict when one path is outside the state set" — exit 1, rebase unwound, HEAD unmoved
- [ ] Existing commit-back pins stay green: clean push, state-only skip, non-state abort, retry-once (`npx tsx --test tests/commit-state-rebase.test.ts`)
- [ ] Retirement (workflow scope): `grep -n "JUDGE_CONCURRENCY" .github/workflows/watch.yml scripts/probe-judge.ts` returns 0 hits
- [ ] Live-only ordering: the `writeCeilingsAtomic` call in scripts/probe-judge.ts sits BEFORE the dead-account block (`grep -n "writeCeilingsAtomic\|DEAD account" scripts/probe-judge.ts`)

#### Manual Verification:
- [ ] One workflow_dispatch run: a green probe commits state/judge-ceilings.json cleanly and the next watch run consumes it with no 429 storm in the judge logs (the composite lesson: offline tests passed both prior times; live runs caught the real failure)
- [ ] A red-gate dispatch (rotten key) reddens the run AND skips the Commit ceilings step — the committed file still holds the last green reading

### Slice 4: Docs sync + validation

**Files**: `.rpiv/guidance/architecture.md`, `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md`, `.rpiv/guidance/scripts/architecture.md`, `README.md`, `AGENTS.md`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] Retirement complete (docs scope): `grep -rniE "judge_concurrency|judgeconcurrency" README.md AGENTS.md .rpiv/guidance/` returns 0 hits
- [ ] The ceilings file is named in all six files: `grep -rc "judge-ceilings" README.md AGENTS.md .rpiv/guidance/architecture.md .rpiv/guidance/src/architecture.md .rpiv/guidance/.github/workflows/architecture.md .rpiv/guidance/scripts/architecture.md` shows >= 1 per file
- [ ] Sync-point arithmetic updated: `grep -rn "6 of the 9\|9 ENV_NAMES" .rpiv/guidance/` returns 0 hits; `grep -n "5 of the 8 ENV_NAMES" .rpiv/guidance/.github/workflows/architecture.md` matches
- [ ] The stale single-invoker claim is gone: `grep -rn "EXACTLY ONCE" .rpiv/guidance/` returns 0 hits (Slice 3's carried NOTE)
- [ ] Single-claim stragglers gone: `grep -rn "ONLY invocation\|invoked exactly once\|the only persistence" README.md AGENTS.md .rpiv/guidance/` returns 0 hits (round-1 violations 1 and 3)

#### Manual Verification:
- [ ] Every guidance fence that quotes rotation/judge code matches the artifact's locked Architecture (7-member RotationState, dial pick, zero-charge ceiling wait, Σ-ceilings width)
- [ ] README reads coherently for an operator: the intro and Setup tell one story — dispatch the probe, the ceilings commit themselves; no paste step survives
- [ ] The commit-back story is consistent across all three surfaces: workflows guidance (Commit ceilings step, pluralized fence comment + invocation sentence + exit contract), scripts guidance (Invokers + exit-contract line), and the .sh header Slice 3 already rewrote
- [ ] The re-keyed important-if blocks route to section names that exist ("Running the Judge Probe and Applying the Reading"; the judge-ceilings reader doctrine line in src guidance)

## Desired End State

```typescript
// watch.yml Run watcher step — no JUDGE_CONCURRENCY literal; width is derived:
// 5 accounts × ceilings [4,2,4,1,4] → 15 in-flight, first 5 calls hit 5 distinct hosts.
const ceilings = await loadAccountCeilings(accounts); // state/judge-ceilings.json, degrade-everything
const { judged, skippedPostIds } = await judgePosts(
  newPosts, accounts, config.keywords, deps.fetchFn, config.reasoningEffort, ceilings, now, sleepFn,
);
```

## File Map

```
src/judge-ceilings.ts            # NEW — resolveCeilings pure core + loadAccountCeilings + writeCeilingsAtomic
src/config.ts                    # MODIFY — +JUDGE_CEILINGS_PATH, -judgeConcurrency
src/judge-rotation.ts            # MODIFY — RotationState fields + claim/release/waiter helpers + counter-aware pick
src/judge.ts                     # MODIFY — claim/release in dispatchLlmCall, Σ-ceilings width, JUDGE_CONCURRENCY deleted
src/index.ts                     # MODIFY — judgeCeilings seam + call-site feed
tests/judge-ceilings.test.ts     # NEW — pure-core + fs wrapper suite
tests/judge-rotation.test.ts     # MODIFY — falsified reactive-order pins rewritten + spread/cap/waiter tests
tests/judge.test.ts              # MODIFY — parseJudgeConcurrency describe deleted, width pins re-pinned
tests/judge-helpers.ts           # MODIFY — +fiveAccounts fixture
scripts/probe-judge.ts           # MODIFY — live-only ceilings write before the dead gate
.github/workflows/watch.yml      # MODIFY — probe job commit step, -JUDGE_CONCURRENCY literal
scripts/commit-state-rebase.sh   # MODIFY — skip-set → per-line set membership
tests/commit-state-rebase.test.ts # MODIFY — third advanceOrigin arm + ceilings-skip + two-line-conflict fixtures
.rpiv/guidance/architecture.md   # MODIFY — scripts/ line re-storied
.rpiv/guidance/src/architecture.md # MODIFY — rotation fence + judge-account section re-synced
.rpiv/guidance/.github/workflows/architecture.md # MODIFY — sync-points + probe job fence
.rpiv/guidance/scripts/architecture.md # MODIFY — probe apply-reading step
README.md                        # MODIFY — :35, :79-85 JUDGE_CONCURRENCY prose
AGENTS.md                        # MODIFY — :105 JUDGE_CONCURRENCY prose
```

## Ordering Constraints

- Slice 1 (ceilings module) is the foundation: Slice 2's `judgePosts` signature and Slice 3's probe write both import it.
- Slice 2 must land before Slice 3: the probe writes the file Slice 2's reader consumes; committing a file nothing reads is dead weight.
- Slice 4 (docs) is last: every fence it re-syncs quotes code that must already exist.
- Within Slice 2: `src/judge-rotation.ts` helpers land before `src/judge.ts` call sites (compile order); test rewrites land with the code they pin.

## Verification Notes

- `npm run typecheck` enumerates all three `RotationState` construction literals — a forgotten mirror fails the gate (compile-forced mirrors).
- Acceptance: 50 posts over 5 accounts → first 5 judge calls hit 5 distinct accounts (`new Set(auths.slice(0, 5)).size === 5`).
- Per-account peak in-flight ≤ its ceiling across BOTH judge phases, asserted with a per-host peak recorder (bulk-miss double so the fallback drain participates).
- An absent ceilings entry yields ceiling 1 + exactly one console warning naming the baseUrl, with unchanged judged output.
- All-at-ceiling steady state parks indefinitely with zero budget charge and no alarm (dedicated test).
- Exhaustion records stay pool-ordered `[1,2,3]`/`[1,2]`/`[1]` (`tests/judge-rotation.test.ts:471-483`, `:340-345`, `:617-621`) and the end-to-end pin `tests/index.test.ts:428-467` stays green.
- Cooldown-skip precedence: new fixture where the *designated* account is the cooling one (current coverage lands on account 2 either way).
- Script: third `advanceOrigin` arm + ceilings-skip test + two-line-conflict fixture in `tests/commit-state-rebase.test.ts`.
- Live validation: one `workflow_dispatch` run — green probe commits the ceilings file cleanly; the next watch run consumes them; no 429 storm in the judge logs (the composite lesson: offline tests passed both prior times; live runs caught the real failure).

## Performance Considerations

- Total in-flight = Σ ceilings (no overall clamp): a 5×4 pool runs 20 concurrent HTTP requests. The 8-minute job cap arithmetic (`watch.yml:56-65`) assumed width 4; the wave-math comment (`:50-55`) must become formulaic or drop the number.
- The release-waiter queue is a condition-variable in miniature: waiters resolve on release decrement (real network I/O, bounded by pool widths) — no hot spin, no polling.
- Ceilings read once per run at the `judgePosts` boundary (index-keyed on state); the pick stays synchronous — no per-pick file reads.

## Migration Notes

- `state/judge-ceilings.json` is a new committed file. `.gitignore:6` excludes only `state/linkedin-leg-dead.flag`, so no ignore change is needed. Absent file on first watch run → every account ceiling 1 + one warning per account (degrade path, never fails the run).
- `JUDGE_CONCURRENCY` removal is backwards-incompatible for local runs that set it: the variable becomes inert (no parser reads it). Documented in README/AGENTS.
- Rollback: revert the feature commit; the ceilings file is inert data nothing reads.

## Pattern References

- `src/pool.ts:42-45` — sync-window read-advance claim (the counter idiom).
- `src/judge-rotation.ts:46-49` — cross-phase mutable cell on state (`waitBudgetRemainingMs` precedent).
- `src/linkedin-payload.ts:116-231` — degrade-never-throws reader with injected `now`.
- `src/config-file.ts:50-85` — pure-core/wrapper split (`loadWatcherConfig`/`validateConfig`).
- `src/state.ts:125-181` — atomic write (`writeStateAtomic`).
- `src/index.ts:115-116, :155, :202` — dep-seam injection with fs-reading default (`linkedinFetch`).
- `watch.yml:114-133` → `scripts/commit-state-rebase.sh` — commit-back via tested script.
- `tests/judge.test.ts:111-159` — per-host peak recorder precedent (`measuredFetch`/`bulkMissThenAnswer`).
- `tests/env-file.test.ts:61-71` — console-spy idiom for the exactly-one-warning criterion.
- `tests/state.test.ts:22-27` — `mkdtemp` + one `after()` for the file-resolution test.

## Developer Context

**Q (checkpoint, direction):** About to follow the F010 state-module pattern (all rotation mutation lives in `src/judge-rotation.ts` beside `coolAccount`, `src/judge-rotation.ts:1-5`) across the 4 new helpers (`claimAccount`, `releaseAccount`, `waitCeilingSlot`, `earliestCooldown`) — confirm that's the direction, or moving off it?
A: Follow F010 ownership.

**Q (checkpoint, DI seam):** The ceilings resolution in index.ts wires like the `linkedinFetch` seam (`src/index.ts:115-116` — WatcherDeps field with an fs-reading default `loadAccountCeilings`) — agree, or prefer different wiring?
A: Mirror linkedinFetch.

**Q (checkpoint, env var fate):** `JUDGE_CONCURRENCY` is superseded by per-account ceilings. The research recommends deleting it outright (an unused `ENV_NAMES` entry recreates the F024 pathology), but the solutions artifact flags this as requiring your input — delete outright, or leave it unused?
A: Delete outright (Recommended).

**Slice 1 micro-checkpoint:** two slice-verifier findings fixed in place before approval — (1) the fractional-ceiling case had no assertion (own `it` now feeds 2.5); (2) the test file's `node:` import block was unsorted against biome organizeImports (reordered, `node:test` last). Both re-verified by the verifier at hunk level; no other findings.

**Slice 2 micro-checkpoint:** slice-verifier round 1 found one real violation — the 5xx backoff retry rotated accounts under the dial re-pick (falsifying the "a 5xx never rotates" pin at tests/judge-rotation.test.ts:438 and the same-account contract sentences) — fixed with a frame-local `pinnedStart` seat set by the backoff handler and consumed by the very next `pickEligibleAccount` call (a start hint; a cooled/full pinned seat is skipped like any other; the pin never leaks — cleared before any park/ceiling-wait continue). Round 1 also flagged a positional-arg hazard in the kept "keeps candidate order" call (map would land in the reasoningEffort slot) — fixed with the explicit `"medium", new Map([[0, 4]])` form. Round 2: Decisions / Cross-slice / Research all OK. Also surfaced this session: `scripts/probe-judge.ts:15,133` doc-comments still name the shipped JUDGE_CONCURRENCY — Slice 3's fence refreshes them (grep-verified: no other retirement stragglers outside Slices 3-4 scope).

**Inherited from research (never re-ask):** staleness bound — none; write timing — live-only before the gate; probe job commits the file (jobs stay parallel); ceiling-blocked waits — wake on release, zero budget charge, `coolAccount` also resolves waiters; `RotationState` fields — required members; shared-baseUrl entries share one ceiling silently; ceilings keyed by trimmed baseUrl, index-keyed on state.

## Design History

- Slice 1: Ceilings module — approved as generated (two verifier findings fixed in place: fractional assertion, import sort)
- Slice 2: Spread mechanism — approved as generated (verifier round 1: 5xx-retry-rotates violation fixed via the pinned-seat re-pick; positional-arg fix in the kept candidate-order call; round 2 green)
- Slice 3: Probe persistence + commit-back — approved as generated (verifier round 1: the new Revision docblock re-introduced the retired width-knob name verbatim, failing the slice's own 0-hit grep criterion — reworded name-free in the docblock and the watch.yml env annotation; round 2 green; one cosmetic NOTE carried: the .sh header's "Invoked EXACTLY ONCE by watch.yml" wording is stale now that the probe job is a second invoker — Slice 4's docs sync may touch it up)
- Slice 4: Docs sync + validation — approved as generated (verifier: 4 rounds — R1: stale single-invoker fence comment, missed second exit-contract consumer, "only persistence" twins; R2: deleted inertness doc replaced name-free + pin drifts + route heading; R3: "array order IS trial order" contradiction in the LLM-account steps + README:66 "tried in order"; R4: VERDICT OK — six SC greps clean on projected state, every cross-slice symbol matches the locked fences)
- Follow-up (2026-11-06T18:22:51+0700): Slice 4's six docs Architecture fences were EMPTY at finalize (off-rail per Step 7) — filled via a Step 9 in-place edit, authored against the six current docs files + the locked Architecture. Every Slice 4 grep criterion is satisfiable from the authored hunks: "5 of the 8 ENV_NAMES" present, no `judge_concurrency|judgeconcurrency` hit in any `+` line, no single-invoker claim survives (two invokers: Commit state + Commit ceilings), `judge-ceilings` named in all six files, dial/Σ-width/zero-charge fences re-synced, "array order IS trial order" + README "tried in order" retired (the R3 pin drifts).

## References

- `.rpiv/artifacts/solutions/2026-11-06_11-05-39_llm-account-spread-judge.md` — the input solutions artifact (Option 1 selected, verdict pass)
- `.rpiv/artifacts/research/2026-11-06_10-12-16_llm-account-spread-judge.md` — the input research: current-state map, falsified-test enumeration, retirement inventory
- `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md` — the input FRD: acceptance criteria, settled decisions, non-goals
- `.rpiv/artifacts/plans/2026-10-27_17-55-19_per-batch-llm-rotation.md` — the rotation plan: four invariants and the RotationState reshape precedent
- `.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md` — D1' (rejected wrapper carrier), the peak-recorder test precedent
- `.rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md` — F010 split manifest, F018 dual-site guard rationale, live-dispatch validation doctrine
