---
date: 2026-11-08T18:04:00+0700
author: Yogiswara Utama
commit: 77f44d7
branch: main
repository: loker-watcher
topic: "Account Availability Check Before Judging"
tags: [plan, judge-availability, blocked-mask, judge-rotation, judge-health, email, index-wiring]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-08_14-15-40_account-availability-check.md"
phase_count: 5
phases:
  - { n: 1, title: Availability checker module, files: [src/judge-availability.ts, src/judge.ts, tests/judge-availability.test.ts], depends_on: [] }
  - { n: 2, title: Blocked mask on RotationState, files: [src/judge-rotation.ts, tests/judge-rotation.test.ts, src/judge.ts, tests/judge.test.ts], depends_on: [1] }
  - { n: 3, title: Mask through the judge core, files: [src/judge.ts, tests/judge.test.ts], depends_on: [2] }
  - { n: 4, title: Pool-truthful exhaustion wording, files: [src/judge-rotation.ts, src/email.ts, src/judge.ts, tests/judge-rotation.test.ts, tests/email.test.ts], depends_on: [3] }
  - { n: 5, title: Pipeline wiring and the all-down skip, files: [src/index.ts, tests/index.test.ts], depends_on: [4] }
last_updated: 2026-11-09T07:28:40+0700
last_updated_note: "Follow-up (revise, second pass): fence-drift sweep — five more hunks re-transcribed to landed bytes (Phase 2 §5, Phase 3 §7, Phase 4 §1, Phase 4 §2, Phase 5 §2) + two stale judge.ts line refs fixed in judge-availability.ts; totals seven fence corrections; gates re-verified 484/484; status ready"
last_updated_by: Yogiswara Utama
---

# Account Availability Check Before Judging — Implementation Plan

## Overview

Every watch run probes each `LLM_ACCOUNTS` account with one tiny chat-completions call before any judge batch. Refused accounts sit out through a blocked-index mask carried on `RotationState` — the FULL pool still reaches `judgePosts`, a `blocked` map (0-based index -> availability reason) drops them from the pick, excludes them from width, and names them with real reasons in a blocked appendix on the exhaustion record. When every account refuses, `runWatcher` skips judging, keeps posts unseen, sends the exhaustion alarm once per episode through the extracted shared helper, flushes the episode bit marks-safely, and exits 0. Exhaustion wording becomes pool-truthful ("X of N accounts failed") across the error message and the email.

Design: `.rpiv/artifacts/designs/2026-11-08_14-15-40_account-availability-check.md` (status `ready`, no unresolved questions). Phase boundaries inherit 1:1 from the design's `## Slices`; every Success Criteria block passes through unchanged (slice-verifier already validated criteria against slice code at design 6.2).

## Desired End State

All-down tick, offline acceptance shape (Phase 5 tests):

```ts
const run = await runWatcher({
  env: BASE_ENV,
  config,
  judgeAvailability: async () => ({
    failures: threeAccounts.map((a, i) => ({ account: i + 1, baseUrl: a.baseUrl, reason: "HTTP 429" })),
    degraded: false,
  }),
  transport: recordingTransport,
  statePath,
  judgeHealthPath,
});
assert.deepEqual(run, { judged: 0, matches: 0, skipped: newPosts.length, saved: false });
assert.equal(judgeFetchCalls.length, 0);            // no judge call reached the dead pool
assert.match(subjects[0], /LLM judge pool exhausted \(3 of 3 accounts failed\)/); // 3 refused of the 3-account pool (ratified: the 0-of-3 shape cannot send an email)
await assert.rejects(() => readFile(statePath), /ENOENT/); // ids stay unseen
```

Some-pass tick: survivors dispatch at their probe-measured ceilings; refused accounts appear in sit-out log lines and never in `judgePosts`' dispatch. Mid-run exhaustion with survivors: the error and email read "2 of 3".

## What We're NOT Doing

- Any workflow YAML change or new committed state file
- Any change to mid-run cooldown, dispatch spread, park budget, or retry ladders (FR7)
- Same-run retry of refused accounts
- The concurrency guard (per-account in-flight throttling / mid-run width shrink) — separate research artifact
- `AccountFailure` enrichment (no per-entry pool size; survivors render by set-difference)
- A heartbeat on skip runs (the alarm IS the skip-run notification; resolved in research follow-up)
- A special-cased skip-run commit subject (accepted as cosmetic noise, developer-ratified)

## Phase 1: Availability checker module

### Overview

Creates the parallel one-shot checker (`checkJudgeAvailability`) and exports the two pure wire helpers it reuses from `judge.ts` (the F006 `buildBulkMessages` drift-proofing precedent — probe the exact production URL shape and reason vocabulary, never a hand-copy). No cycle: `judge.ts` never imports the checker. The checker owns NO rotation — no state, no pick, no cooldown, no retry, no health writes — and never throws (the `resolveCeilings`/`loadAccountHealth` warnings-as-data degrade family): a fault before dispatch degrades to all-available with `degraded: true` and one warning; a per-account fault after dispatch IS the signal and becomes that account's reason.

### Changes Required:

#### 1. The availability checker (new module)
**File**: `src/judge-availability.ts` (NEW)
**Changes**: create the module — per-account parallel tiny probe with a hard ~10s abort, judge-vocabulary reasons, two-layer never-throw degrade. Own constant `AVAILABILITY_TIMEOUT_MS = 10_000` (the judge's 60s is a measured batch contract the pre-check must not couple to); probe payload carries NO `response_format` (bulk-path-only rider) and NO `reasoning_effort` (the signal is answerability); pass on any non-empty `choices[0].message.content`; `judge-parse.ts` is not imported.

```ts
/**
 * Account availability pre-check (FR1/FR2): one tiny chat-completions
 * call per LLM_ACCOUNTS account, all in parallel, before any judge
 * batch. The signal is answerability — any non-empty message content
 * passes; every other outcome (429, terminal status, transport throw,
 * timeout, unusable answer) marks that account unavailable for the run
 * as an AccountFailure carrying the judge's own reason vocabulary, so
 * the exhaustion message and email compose the causes with zero
 * translation.
 *
 * The check owns NO rotation: no RotationState, no pick, no cooldown,
 * no retry ladder, no health writes — one parallel one-shot per
 * account with a hard per-account abort. It NEVER throws (the degrade
 * doctrine, the loadAccountCeilings/loadAccountHealth family): a fault
 * before dispatch begins degrades to "all accounts available" with a
 * `degraded: true` flag and exactly one warning naming the cause, and
 * the run proceeds unfiltered. A per-account fault after dispatch IS
 * the signal and becomes that account's failure reason, never a
 * degrade.
 *
 * Import surface: the two wire helpers are runtime imports — judge.ts
 * exports them for exactly this caller (the F006 buildBulkMessages
 * drift-proofing precedent), no cycle exists (judge.ts never imports
 * this module), and both are pure functions. Everything else is
 * type-only.
 */
import { normalizeEndpoint, terminalFailureReason, type LlmAccount } from "./judge.js";
import type { AccountFailure } from "./types.js";

/**
 * Hard per-account abort for the tiny probe — the module's own
 * constant. The judge's 60s REQUEST_TIMEOUT_MS is a measured
 * batch-latency contract (src/judge.ts:73-78) the pre-check must not
 * couple to; ~10s bounds the whole stage's wall clock, because every
 * account is probed in parallel.
 */
const AVAILABILITY_TIMEOUT_MS = 10_000;

/**
 * The probe payload's messages: the smallest request that proves the
 * endpoint can answer. The payload itself carries NO response_format —
 * that rider is bulk-path-only (src/judge.ts:680-682) — and NO
 * reasoning_effort: the signal is answerability, and forcing a
 * reasoning model to think spends latency inside the abort.
 * temperature: 0 mirrors both judge payloads.
 */
const PROBE_MESSAGES: Array<{ role: string; content: string }> = [
  { role: "user", content: "Reply with the single word: ok." },
];

/** Result of the availability pre-check for one account pool. */
export interface AvailabilityResult {
  /** One entry per refused account, pool order, 1-based numbers. */
  readonly failures: readonly AccountFailure[];
  /**
   * True when the check itself faulted and the run proceeds UNFILTERED
   * (all-available degrade). False means the per-account verdicts are
   * trustworthy.
   */
  readonly degraded: boolean;
}

/**
 * Probe every account once, in parallel. Never throws.
 *
 * Two-layer contract: anything after the first dispatch begins is
 * per-account DATA — a fetch rejection, a non-ok status, an unparsable
 * or empty answer each become that account's failure reason (Layer 1).
 * Anything before it is a checker FAULT — the wrapper degrades to
 * all-available with `degraded: true` and one console.warn naming the
 * cause verbatim (Layer 2). Promise.allSettled never rejects, so the
 * wrapper catch fires only for module-code faults around the
 * orchestration; a hostile fetchFn that throws still lands per-account
 * (the throw happens inside the probe's async body).
 */
export async function checkJudgeAvailability(
  accounts: readonly LlmAccount[],
  fetchFn: typeof fetch = fetch,
): Promise<AvailabilityResult> {
  try {
    const settled = await Promise.allSettled(
      accounts.map((account) => probeAccount(account, fetchFn)),
    );
    const failures: AccountFailure[] = [];
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") continue;
      const account = accounts[index];
      if (account === undefined) continue; // settled mirrors accounts — unreachable
      failures.push({
        account: index + 1,
        baseUrl: account.baseUrl,
        reason:
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    }
    return { failures, degraded: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`availability: pre-check faulted — running unfiltered (${message})`);
    return { failures: [], degraded: true };
  }
}

/**
 * One tiny chat-completions probe. Resolves when the account answered
 * with any non-empty message content; rejects with the account's
 * failure reason as the error message, in the judge's vocabulary:
 * "HTTP 429" / "HTTP 401 — key dead" (terminalFailureReason),
 * "network error: <message>" (transport and timeout), and
 * "unusable answer: <message>" (a 200 whose body or content cannot
 * serve as an answer).
 */
async function probeAccount(account: LlmAccount, fetchFn: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchFn(normalizeEndpoint(account.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify({
        model: account.model,
        messages: PROBE_MESSAGES,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`network error: ${message}`);
  }
  if (!response.ok) {
    throw new Error(terminalFailureReason(response.status));
  }
  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unusable answer: ${message}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("unusable answer: missing message content");
  }
}
```

#### 2. Wire helpers exported for the checker
**File**: `src/judge.ts`
**Changes**: add `export` to both module-private pure functions (drift-proofing; Phase 2-4 hunks in this same file are quoted separately in their phases — this phase touches only these two functions).

```ts
/**
 * Chat-completions URL from a base URL, tolerating a full endpoint.
 * Exported (F006 drift-proofing precedent): the availability pre-check
 * (src/judge-availability.ts) probes the exact production URL shape
 * instead of a hand-copy that has already drifted from it.
 */
export function normalizeEndpoint(baseUrl: string): string {
  return baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * The real-cause string a terminal non-ok status stamps on the ledger.
 * 401/403 mean the key is dead — the alarm should say so, not just the
 * status code. Exported so the availability pre-check renders the SAME
 * reason vocabulary verbatim, keeping the exhaustion message and email
 * composable with zero translation.
 */
export function terminalFailureReason(status: number): string {
  return status === 401 || status === 403 ? `HTTP ${status} — key dead` : `HTTP ${status}`;
}
```

#### 3. Checker offline suite
**File**: `tests/judge-availability.test.ts` (NEW)
**Changes**: create the suite — fetch doubles only (no real network, no real timers); reuses `singleAccount`/`fiveAccounts`/`ok()` from `tests/judge-helpers.ts`.

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkJudgeAvailability } from "../src/judge-availability.js";
import type { LlmAccount } from "../src/judge.js";
import { fiveAccounts, ok, singleAccount } from "./judge-helpers.js";

/** HTTP status with an empty body — the non-ok responses the probe must classify. */
const status = (code: number): Response => new Response(null, { status: code });

/** Recording fetch double: a FRESH Response per call (bodies are single-use), each request captured. */
function fetchReturning(make: () => Response): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; body: unknown; init: RequestInit }>;
} {
  const calls: Array<{ url: string; body: unknown; init: RequestInit }> = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const rawBody = typeof init?.body === "string" ? init.body : "{}";
    calls.push({ url: String(url), body: JSON.parse(rawBody) as unknown, init: init ?? {} });
    return make();
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** Host-routing fetch double: each host substring maps to a Response factory. */
function fetchByHost(routes: Record<string, () => Response>): {
  fetchFn: typeof fetch;
  urls: string[];
  calls: unknown[];
} {
  const urls: string[] = [];
  const calls: unknown[] = [];
  const fetchFn = (async (url: unknown) => {
    const target = String(url);
    urls.push(target);
    calls.push(target);
    for (const [host, make] of Object.entries(routes)) {
      if (target.includes(host)) return make();
    }
    throw new Error(`unexpected probe url: ${target}`);
  }) as typeof fetch;
  return { fetchFn, urls, calls };
}

/** Rejecting fetch double — transport faults and timeouts, no real timers. */
function fetchRejecting(message: string): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as typeof fetch;
}

describe("checkJudgeAvailability", () => {
  it("all accounts answering marks none failed and nothing degraded", async () => {
    const { fetchFn, calls } = fetchReturning(() => ok("ok"));
    const result = await checkJudgeAvailability(fiveAccounts, fetchFn);
    assert.deepEqual(result, { failures: [], degraded: false });
    assert.equal(calls.length, fiveAccounts.length);
  });

  it("every account is probed even when earlier probes fail", async () => {
    const { fetchFn, calls } = fetchByHost({
      "account-one": () => status(429),
      "account-two": () => ok("ok"),
      "account-three": () => status(503),
    });
    const result = await checkJudgeAvailability(fiveAccounts.slice(0, 3), fetchFn);
    assert.equal(calls.length, 3);
    assert.deepEqual(
      result.failures.map((failure) => [failure.account, failure.reason]),
      [
        [1, "HTTP 429"],
        [3, "HTTP 503"],
      ],
    );
    assert.equal(result.degraded, false);
  });

  it("an HTTP 429 renders the judge's cooling reason", async () => {
    const { fetchFn } = fetchReturning(() => status(429));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "HTTP 429");
  });

  it("a dead key renders the key-dead reason", async () => {
    const { fetchFn } = fetchReturning(() => status(401));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "HTTP 401 — key dead");
  });

  it("a 5xx renders its HTTP status", async () => {
    const { fetchFn } = fetchReturning(() => status(503));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "HTTP 503");
  });

  it("a rejecting transport renders network error: <message> — timeout included, no real timers", async () => {
    const fetchFn = fetchRejecting("The operation was aborted due to timeout");
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "network error: The operation was aborted due to timeout");
  });

  it("a 200 with an unparsable body renders unusable answer: <message>", async () => {
    const { fetchFn } = fetchReturning(() => new Response("not json", { status: 200 }));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.match(failure.reason, /^unusable answer: /);
  });

  it("a 200 without message content renders unusable answer: missing message content", async () => {
    const { fetchFn } = fetchReturning(() =>
      new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
    );
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "unusable answer: missing message content");
  });

  it("empty message content counts as unusable", async () => {
    const { fetchFn } = fetchReturning(() => ok("   "));
    const result = await checkJudgeAvailability(singleAccount, fetchFn);
    const [failure] = result.failures;
    assert.ok(failure !== undefined);
    assert.equal(failure.reason, "unusable answer: missing message content");
  });

  it("the probe payload is tiny: model + messages + temperature, no response_format, no reasoning_effort", async () => {
    const { fetchFn, calls } = fetchReturning(() => ok("ok"));
    await checkJudgeAvailability(singleAccount, fetchFn);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call !== undefined);
    assert.deepEqual(Object.keys(call.body as Record<string, unknown>).sort(), [
      "messages",
      "model",
      "temperature",
    ]);
    const headers = call.init.headers as Record<string, string>;
    const account = singleAccount[0];
    assert.ok(account !== undefined);
    assert.equal(headers["Authorization"], `Bearer ${account.apiKey}`);
    assert.ok(call.init.signal instanceof AbortSignal);
  });

  it("the probe URL normalizes a bare base URL and tolerates a full endpoint", async () => {
    const accounts: LlmAccount[] = [
      { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
      { baseUrl: "https://two.api/v1/chat/completions", apiKey: "k2", model: "m2" },
    ];
    const { fetchFn, urls } = fetchByHost({ api: () => ok("ok") });
    const result = await checkJudgeAvailability(accounts, fetchFn);
    assert.deepEqual(result, { failures: [], degraded: false });
    assert.deepEqual(urls, [
      "https://one.api/v1/chat/completions",
      "https://two.api/v1/chat/completions",
    ]);
  });

  it("a checker fault degrades to all-available with exactly one warning naming the cause", (t) => {
    const warn = t.mock.method(console, "warn", console.warn.bind(console));
    t.mock.method(Promise, "allSettled", () => {
      throw new Error("boom");
    });
    return (async () => {
      const { fetchFn, calls } = fetchReturning(() => ok("ok"));
      const result = await checkJudgeAvailability(singleAccount, fetchFn);
      assert.deepEqual(result, { failures: [], degraded: true });
      // Dispatch began BEFORE the mock faulted: .map() invokes probeAccount
      // (and fetchFn) synchronously up to its first await, so the wrapper
      // catch fires after one probe call. The Layer 1/Layer 2 boundary
      // describes real faults, not this injection.
      assert.equal(calls.length, 1);
      assert.equal(warn.mock.callCount(), 1);
      const line = String(warn.mock.calls[0]?.arguments[0]);
      assert.match(line, /availability: pre-check faulted/);
      assert.match(line, /boom/);
    })();
  });

  it("an empty pool is trivially available without touching the transport", async () => {
    const fetchFn = fetchRejecting("must not be called");
    const result = await checkJudgeAvailability([], fetchFn);
    assert.deepEqual(result, { failures: [], degraded: false });
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] New suite passes: `npx tsx --test tests/judge-availability.test.ts`
- [x] Both wire helpers exported: `grep -n "export function normalizeEndpoint" src/judge.ts` returns a match, and `grep -n "export function terminalFailureReason" src/judge.ts` returns a match
- [x] Scoped lint clean: `npx biome check src/judge.ts src/judge-availability.ts tests/judge-availability.test.ts`
- [x] Fault path: the degrade test asserts `{ failures: [], degraded: true }` with exactly one `availability:` warning naming the cause

#### Manual Verification:
- [ ] Probe payload review: no `response_format`, no `reasoning_effort`; Bearer header; a full-endpoint base URL passes through verbatim
- [ ] No real network and no real timers in the new suite — rejecting doubles only

---

## Phase 2: Blocked mask on RotationState

### Overview

Adds the fifth per-account skip source to `RotationState`: `blocked: ReadonlyMap<number, string>` (0-based index -> the availability pre-check's refusal reason). The field is REQUIRED, not optional — the compiler then enforces construction at every literal, so a forgotten literal cannot silently mean "no mask" (developer-ratified). `pickEligibleAccount` gains one skip line immediately after the cooldown skip and BEFORE the health circuit: a refused seat must never dispatch, so it must never spend the half-open probe either. `judge.ts`'s `judgePosts` state literal and `tests/judge.test.ts`'s `freshState` mirror each get a one-line `blocked: new Map()` compile stub so every intermediate slice stays green under all three repo gates; Phase 3 replaces the judge.ts stub with the real defaulted-parameter wiring.

### Changes Required:

#### 1. The mask field on RotationState
**File**: `src/judge-rotation.ts`
**Changes**: add the `blocked` field to the `RotationState` interface after `ceilings` (the leading interface doc's dispatchability sentence gains 'blocked' likewise).

```ts
// -- In the RotationState interface, after the `ceilings` field (the leading
// -- interface doc's dispatchability sentence gains 'blocked' likewise): --
  /** 0-based account index -> the availability pre-check's refusal
   *  reason for this run (the blocked-index mask). Set once when the
   *  state is built and never mutated in-run: a refused account sits
   *  out the WHOLE tick, unlike a cooldown that expires mid-run. The
   *  value carries the real cause in the judge's own vocabulary, so
   *  the exhaustion record and the email compose it with zero
   *  translation. An empty map is the no-mask normal: every account
   *  available. */
  readonly blocked: ReadonlyMap<number, string>;
```

#### 2. The pick skip line
**File**: `src/judge-rotation.ts`
**Changes**: one skip line in `pickEligibleAccount`, immediately after the cooldown skip and BEFORE the health circuit; the dispatchability and `startAt` doc sentences gain 'blocked' alongside cooling/at-ceiling.

```ts
// -- In pickEligibleAccount, one skip line immediately after the cooldown
// -- skip and BEFORE the health circuit; the dispatchability and startAt
// -- doc sentences gain 'blocked' alongside cooling/at-ceiling: --
    const expiry = state.cooldownUntil.get(index);
    if (expiry !== undefined && expiry > nowMs) continue;
    // The blocked-index mask: a seat the availability pre-check refused
    // sits out the whole run. Ahead of the health circuit on purpose —
    // the probe is a dispatch, and a refused seat must not dispatch.
    if (state.blocked.has(index)) continue;
```

#### 3. Compile stub in the judgePosts state literal
**File**: `src/judge.ts`
**Changes**: one-line `blocked: new Map()` in the `RotationState` literal inside `judgePosts` (field order mirrors the interface — `blocked` sits between `ceilings` and `inFlight`). Phase 3 replaces this stub with the real defaulted trailing parameter.

```ts
// -- In the judgePosts RotationState literal, after `ceilings`: --
    blocked: new Map(),
```

#### 4. Compile stub in the test freshState mirror
**File**: `tests/judge.test.ts`
**Changes**: one-line `blocked: new Map(),` in the local `freshState` mirror's returned literal, after `ceilings: new Map(),` (kept structurally equal to the canonical copy in `tests/judge-rotation.test.ts`).

```ts
// -- In the local freshState mirror's returned literal, after `ceilings: new Map(),`
// -- (kept structurally equal to the canonical copy in
// -- tests/judge-rotation.test.ts): --
    ceilings: new Map(),
    blocked: new Map(),
```

#### 5. Blocked-mask rotation cases
**File**: `tests/judge-rotation.test.ts`
**Changes**: `freshState` gains the defaulted third `blocked` parameter; a new `describe` appended after the health-circuit describe.

```ts
// -- freshState (the canonical copy): the defaulted third parameter --
function freshState(
  accounts: LlmAccount[],
  ceilings: ReadonlyMap<number, number> = new Map(),
  blocked: ReadonlyMap<number, string> = new Map(),
): RotationState {
  return {
    accounts,
    cooldownUntil: new Map(),
    ceilings,
    blocked,
    inFlight: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: 180_000,
    healthMarks: new Map(),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
  };
}

// -- New describe, appended after the health-circuit describe --
describe("blocked mask: pre-check-refused seats never dispatch", () => {
  it("skips a blocked seat and lands the claim on the next free account", () => {
    const state = freshState(twoAccounts(), new Map(), new Map([[0, "HTTP 429"]]));
    const picked = pickEligibleAccount(state, 0);
    assert.equal(picked?.index, 1); // seat 0 refused — the scan moved past it
    claimAccount(state, 1);
    assert.equal(state.dispatchCounter, 2); // the dial moved past the CLAIM, not the skip
    assert.equal(state.inFlight.get(0), undefined); // the blocked seat was never claimed
  });

  it("returns undefined when every seat is blocked and never moves the dial (D6)", () => {
    const state = freshState(
      threeAccounts(),
      new Map(),
      new Map([
        [0, "HTTP 429"],
        [1, "network error: socket hang up"],
        [2, "unusable answer: missing message content"],
      ]),
    );
    state.dispatchCounter = 1;
    assert.equal(pickEligibleAccount(state, 0), undefined);
    assert.equal(state.dispatchCounter, 1); // an undefined pick never moves the dial
  });

  it("a blocked seat never spends the half-open probe — the mask outranks the health circuit", () => {
    const state = freshState(twoAccounts(), new Map(), new Map([[0, "HTTP 401 — key dead"]]));
    state.healthMarks.set(0, 2); // capped: its first dispatch would be the tick's probe
    state.cooldownUntil.set(1, 10_000); // block the only other seat
    // Seat 0 is refused AND capped: without the mask line the pick would
    // return it as the half-open probe. With the line, nothing dispatches.
    assert.equal(pickEligibleAccount(state, 0), undefined);
    assert.equal(state.probedThisTick.size, 0); // the probe was never spent
  });

  it("a pinned startAt on a blocked seat skips it like any other", () => {
    const state = freshState(twoAccounts(), new Map(), new Map([[1, "HTTP 503"]]));
    const picked = pickEligibleAccount(state, 0, 1); // the same-account retry pins seat 1
    assert.equal(picked?.index, 0); // the pinned seat is refused — the scan wrapped past it
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] New suite passes: `npx tsx --test tests/judge-rotation.test.ts`
- [x] Judge suite stays green with the stubs: `npx tsx --test tests/judge.test.ts`
- [x] Scoped lint clean: `npx biome check src/judge-rotation.ts src/judge.ts tests/judge-rotation.test.ts tests/judge.test.ts`
- [x] The mask field is required: `grep -n "readonly blocked: ReadonlyMap<number, string>" src/judge-rotation.ts` returns a match
- [x] The pick skip line exists: `grep -n "state.blocked.has(index)" src/judge-rotation.ts` returns a match
- [x] Both compile stubs present: `grep -n "blocked: new Map()" src/judge.ts tests/judge.test.ts` returns one match per file

#### Manual Verification:
- [ ] The skip line reads before the health-circuit block in `pickEligibleAccount` — a blocked seat never spends the half-open probe
- [ ] An empty `blocked` map leaves every existing rotation behavior unchanged (FR4: all-available = today)
- [ ] No all-blocked pool can reach `judgePosts` yet: both construction sites pass empty maps; Phase 3's all-blocked guard (beside `allHealthBlocked`, `src/judge.ts:354`) is the permanent invariant for the exported core

---

## Phase 3: Mask through the judge core

### Overview

The judge core consumes the mask: `judgePosts` gains the defaulted trailing `blocked` parameter (after `healthMarks`, so every existing positional caller compiles unchanged — FR4), the state literal replaces Phase 2's stub with the real defensive copy, width excludes blocked seats, `exhaustionRecord` appends refused seats with their real reasons (the blocked appendix lands BEFORE the capped one — the pre-check probe ran THIS run, so the refusal is the freshest evidence, while the cap is persisted from prior ticks), and the D11 guard makes an all-blocked (or blocked-plus-health-dead) pool exhaust immediately at zero budget charge instead of parking forever on the timerless `waitCeilingSlot`. The union predicate `allAvailabilityBlocked` SUBSUMES the pre-mask health predicate `allHealthBlocked` (developer-ratified deviation): with an empty mask the two are identical (no-mask behavior unchanged), a kept original would be dead code, and a mask-only sibling would hang the MIXED pool — a mask-refused seat plus a health-drained survivor never wakes the release queue either.

Design note: the design's `## Architecture` holds ONE merged `src/judge.ts` fence covering Phases 1, 2, 3, and 4; the hunks below are quoted verbatim from it, scoped to this phase. Anchors are function names, not line numbers.

### Changes Required:

#### 1. Union guard predicate — allHealthBlocked is REPLACED
**File**: `src/judge.ts`
**Changes**: `allAvailabilityBlocked` replaces the pre-mask health predicate in place (same file position, the `src/judge.ts:354` anchor; the single flavor-split call site at `:480` renames with it — the cooldown arm above it is untouched). Post-phase invariant: `grep -n "allHealthBlocked" src/judge.ts` returns ZERO matches — no dead predicate survives.

```ts
// -- allAvailabilityBlocked REPLACES the pre-mask health predicate in
// -- place (same file position, the src/judge.ts:354 anchor; the single
// -- flavor-split call site at :480 renames with it — the cooldown arm
// -- above it is untouched). Slice 3 ratification: the union SUBSUMES
// -- that predicate instead of sitting beside it — with an empty mask
// -- the two are identical (no-mask behavior unchanged), a kept original
// -- would be dead code, and a mask-only sibling would hang the MIXED
// -- pool (a mask-refused seat plus a health-drained survivor never
// -- wakes the release queue either). --
/**
 * True when the pick found nothing BECAUSE every seat is permanently dead
 * this tick: the availability pre-check refused it (the blocked mask — a
 * refused seat never dispatches, so no release can ever come from it), or
 * the health circuit blocked it (capped, probe spent and drained). With
 * an empty mask this is exactly the pre-mask health predicate — the
 * no-mask behavior is unchanged — and with a mask it is the D11 guard: an
 * all-blocked (or blocked-plus-health-dead) pool exhausts immediately at
 * zero budget charge instead of parking forever on the timerless
 * waitCeilingSlot. An uncapped seat always makes progress on a release,
 * so it can never permanently block the pool — this is what keeps the
 * zero-charge ceiling wait alive for a healthy saturated pool. No
 * cooldown is active at the call site (the flavor split checks that
 * first). Plain field reads; inline by design (judge-rotation owns no
 * mask or health concept — the boundary).
 */
function allAvailabilityBlocked(state: RotationState): boolean {
  return state.accounts.every((_, index) => {
    if (state.blocked.has(index)) return true;
    const capped = (state.healthMarks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP;
    if (!capped) return false;
    return state.probedThisTick.has(index) && (state.inFlight.get(index) ?? 0) === 0;
  });
}
```

#### 2. Blocked appendix on exhaustionRecord
**File**: `src/judge.ts`
**Changes**: REPLACE THE WHOLE FUNCTION (the capped appendix already exists at HEAD — do not insert beside it). The blocked appendix lands BEFORE the capped one, and both appendix loops mark `listed`, so a capped-and-refused seat renders once (the mask's reason wins). A stable sort re-establishes pool order across all sources.

```ts
// -- exhaustionRecord: the blocked appendix lands BEFORE the capped one —
// -- the pre-check probe ran THIS run, so the refusal is the freshest
// -- evidence, while the cap is persisted from prior ticks. Both appendix
// -- loops mark `listed`, so a capped-and-refused seat renders once (the
// -- mask's reason wins). Slice 3 ratification. --
/**
 * The exhaustion record, in pool order, from three sources: the ledger's
 * real causes first (cooling-only accounts carry "HTTP 429" inside
 * buildFailuresFromLedger), then any availability-refused seat — its
 * probe ran before the tick began, the refusal is the freshest evidence,
 * and the seat never dispatched, so the ledger cannot explain it — then
 * any capped account neither source explained (a probe that answered
 * unusably stamps nothing, but the alarm must still name the account).
 * Non-empty at every throw site by construction: every arm fires only on
 * seats the earlier sources did not list (src/email.ts:181-182 renders
 * null on an empty record while exit 1 still fires — the exact
 * silent-alarm this prevents).
 */
function exhaustionRecord(state: RotationState): AccountFailure[] {
  const record = buildFailuresFromLedger(state);
  const listed = new Set(record.map((failure) => failure.account));
  for (const [index, account] of state.accounts.entries()) {
    const reason = state.blocked.get(index);
    if (reason !== undefined && !listed.has(index + 1)) {
      record.push({ account: index + 1, baseUrl: account.baseUrl, reason });
      listed.add(index + 1);
    }
  }
  for (const [index, account] of state.accounts.entries()) {
    const capped = (state.healthMarks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP;
    if (capped && !listed.has(index + 1)) {
      record.push({
        account: index + 1,
        baseUrl: account.baseUrl,
        reason: "capped by provider health",
      });
      listed.add(index + 1);
    }
  }
  // Pool order across ALL sources: the ledger walk is already in pool
  // order, but the appendices land after it — the stable sort
  // re-establishes the pool-ordered record buildFailuresFromLedger's doc
  // promises (the old cooldown-map builder guaranteed the same).
  record.sort((a, b) => a.account - b.account);
  return record;
}
```

#### 3. Undefined-pick flavor split gains the permanent-dead arm
**File**: `src/judge.ts`
**Changes**: the health arm renames to `allAvailabilityBlocked` and its comment names the third flavor's new shape. The cooldown arm and its budget semantics are byte-untouched.

```ts
// -- dispatchLlmCall's undefined-pick flavor split (the src/judge.ts:480
// -- arm): the health arm renames and its comment names the third
// -- flavor's new shape. The cooldown arm and its budget semantics are
// -- byte-untouched. --
    if (picked === undefined) {
      // Every account is cooling, at its ceiling, or mask-refused — split
      // the flavors (D4): an active cooldown parks through the shared
      // budget (the only road to the exhaustion terminal, OUTSIDE the try
      // below — a throw here would be swallowed by the catch and misread
      // as a transport error); an all-at-ceiling pick has no expiry, so
      // it waits on the release queue at ZERO budget charge — a healthy
      // backlog can never false-trip the alarm. A permanently-dead pool
      // is the third flavor: every seat mask-refused, or capped with its
      // probe spent and drained, and no cooldown pending — the release
      // queue would never wake, so the terminal trips immediately at zero
      // budget charge (the D11 guard).
      if (earliestCooldown(state, now()) !== undefined) {
        if (!(await parkUntilEligible(state, now, sleepFn))) {
          return { status: "exhausted" };
        }
      } else if (allAvailabilityBlocked(state)) {
        return { status: "exhausted" };
      } else {
        await waitCeilingSlot(state);
      }
      attempt -= 1; // the wait is not a retry — do not spend an attempt
      continue;
    }
```

#### 4. judgePosts: JSDoc paragraph + defaulted trailing parameter
**File**: `src/judge.ts`
**Changes**: the JSDoc gains one paragraph (after the rotation-state paragraph) and the signature gains the defaulted trailing parameter (the `src/judge.ts:838` anchor — AFTER `healthMarks`, so every existing positional caller compiles unchanged, FR4).

```ts
// -- judgePosts: the JSDoc gains one paragraph (after the rotation-state
// -- paragraph) and the signature gains the defaulted trailing parameter
// -- (the src/judge.ts:838 anchor — AFTER healthMarks, so every existing
// -- positional caller compiles unchanged, FR4): --
 *
 * Refused seats ride in on the trailing `blocked` mask (0-based index ->
 * the availability pre-check's refusal reason): the pick skips them, the
 * pool width excludes them, and the exhaustion record appends them with
 * their real reasons. An ALL-blocked pool exhausts immediately (the D11
 * guard) instead of parking on the timerless ceiling wait — production
 * never sends one (index.ts pre-checks and skips the judge stage), so a
 * non-empty mask here is the direct-caller and degraded-run shape the
 * exported core must survive on its own.
 */
  ...
  healthMarks: ReadonlyMap<number, number> = new Map(),
  blocked: ReadonlyMap<number, string> = new Map(),
): Promise<JudgeBatchResult> {
```

#### 5. State literal: the Phase 2 stub becomes the real defensive copy
**File**: `src/judge.ts`
**Changes**: the same defensive-copy idiom as `healthMarks` (field order mirrors the `RotationState` interface — `blocked` sits between `ceilings` and `inFlight`).

```ts
// -- The state literal: Slice 2's compile stub is REPLACED by the real
// -- defensive copy, the same idiom as healthMarks (field order mirrors
// -- the RotationState interface — blocked sits between ceilings and
// -- inFlight): --
  const state: RotationState = {
    accounts,
    cooldownUntil: new Map(),
    ceilings,
    blocked: new Map(blocked),
    inFlight: new Map(),
    healthMarks: new Map(healthMarks),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: WAIT_BUDGET_MS,
  };
```

#### 6. Width excludes blocked seats
**File**: `src/judge.ts`
**Changes**: blocked seats contribute ZERO workers (a refused seat can never dispatch, so capacity spent on it would only park its worker). Empty mask: byte-equivalent to the pre-mask reduce.

```ts
// -- The width computation: blocked seats contribute ZERO workers (a
// -- refused seat can never dispatch, so capacity spent on it would only
// -- park its worker). Empty mask: byte-equivalent to the pre-mask
// -- reduce. --
  // Pool width = the pool's total in-flight budget: the sum of the
  // per-account ceilings, minus every availability-refused seat (a
  // refused seat can never dispatch, so capacity spent on it would only
  // park its worker). No overall clamp (D1) — the caps ARE the width —
  // and the floor keeps a hand-built empty map (tests) from spawning
  // zero workers. The new Map() default is the same degrade as an absent
  // ceilings file: every account floors at 1 (the pick's ?? 1 floor);
  // index.ts always passes the resolved map.
  const width = Math.max(
    1,
    [...ceilings.entries()].reduce((sum, [index, ceiling]) => {
      if (state.blocked.has(index)) return sum;
      const capped = (state.healthMarks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP;
      return sum + (capped ? 1 : ceiling);
    }, 0),
  );
```

#### 7. Judge-core mask cases
**File**: `tests/judge.test.ts`
**Changes**: new describe appended after the health-ledger describe (the Phase 2 freshState stub field stays; these cases drive `judgePosts` directly with the mask as the 10th positional argument). The all-blocked case asserts ZERO recorded sleeps AND zero fetch calls: a regression to the timerless `waitCeilingSlot` hang fails the test loudly instead of parking the suite forever.

```ts
// -- New describe, appended after the health-ledger describe. The all-blocked
// -- case asserts ZERO recorded sleeps AND zero fetch calls: a regression to
// -- the timerless waitCeilingSlot hang fails the test loudly instead of
// -- parking the suite forever. --
describe("judgePosts blocked mask (availability pre-check refusals)", () => {
  function twoAccounts(): LlmAccount[] {
    return [
      { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
      { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
    ];
  }

  function threeAccounts(): LlmAccount[] {
    return [
      { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
      { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
      { baseUrl: "https://account-three.api/v1", apiKey: "key-3", model: "model-3" },
    ];
  }

  /** Records every host the judge dispatched to — the mask's observable. */
  function hostRecorder(): { hosts: string[]; fetchFn: typeof fetch } {
    const hosts: string[] = [];
    const fetchFn = (async (url: unknown, options?: unknown): Promise<Response> => {
      hosts.push(new URL(String(url)).host);
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
        (match) => match[1] ?? "",
      );
      return ok(bulkContent(ids));
    }) as unknown as typeof fetch;
    return { hosts, fetchFn };
  }

  it("a blocked seat never dispatches and the survivor judges every post", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => bulkPost(id19(i + 1)));
    const { hosts, fetchFn } = hostRecorder();

    const result = await judgePosts(
      posts,
      twoAccounts(),
      KEYWORDS,
      fetchFn,
      "medium",
      new Map([
        [0, 4],
        [1, 4],
      ]),
      Date.now,
      (): Promise<void> => Promise.resolve(),
      new Map(),
      new Map([[0, "HTTP 429"]]),
    );

    assert.equal(result.judged.length, 10);
    assert.deepEqual(result.skippedPostIds, []);
    assert.ok(hosts.every((host) => host.includes("account-two"))); // seat 0 never dispatched
    assert.equal(hosts.length, 1); // one batch, one call
  });

  it("an all-blocked pool exhausts immediately — zero fetch calls, zero sleeps, mask reasons in pool order", async () => {
    const posts = [bulkPost(id19(1))];
    const delays: number[] = [];
    let calls = 0;
    const mockFetch = (async (): Promise<Response> => {
      calls += 1;
      return ok(bulkContent([id19(1)]));
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await judgePosts(
        posts,
        threeAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        new Map([
          [0, 4],
          [1, 4],
          [2, 4],
        ]),
        Date.now,
        (ms: number): Promise<void> => {
          delays.push(ms);
          return Promise.resolve();
        },
        new Map(),
        new Map([
          [0, "HTTP 429"],
          [1, "network error: socket hang up"],
          [2, "unusable answer: missing message content"],
        ]),
      );
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    const exhausted = caught as RotationExhausted;
    assert.equal(calls, 0); // the guard fired before any dispatch
    assert.deepEqual(delays, []); // zero park AND zero backoff — no timerless hang
    assert.deepEqual(
      exhausted.failures.map((f) => [f.account, f.reason]),
      [
        [1, "HTTP 429"],
        [2, "network error: socket hang up"],
        [3, "unusable answer: missing message content"],
      ],
    );
  });

  it("a blocked seat plus a health-drained survivor exhausts immediately (the mixed pool never parks)", async () => {
    const posts = [bulkPost(id19(1))];
    const delays: number[] = [];
    let calls = 0;
    const mockFetch = (async (): Promise<Response> => {
      calls += 1;
      return new Response("Service Unavailable", { status: 503 });
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await judgePosts(
        posts,
        twoAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        new Map([
          [0, 4],
          [1, 4],
        ]),
        Date.now,
        (ms: number): Promise<void> => {
          delays.push(ms);
          return Promise.resolve();
        },
        new Map([[1, 2]]), // seat 1 capped: its first dispatch is the probe
        new Map([[0, "HTTP 401 — key dead"]]),
      );
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    const exhausted = caught as RotationExhausted;
    assert.equal(calls, 1); // one probe dispatch, then the guard — no park, no hang
    assert.deepEqual(delays, [1_000]); // one spent bulk backoff (a mid-backoff 5xx never stamps)
    assert.deepEqual(
      exhausted.failures.map((f) => [f.account, f.reason]),
      [
        [1, "HTTP 401 — key dead"], // the mask reason outranks the cap
        [2, "capped by provider health"],
      ],
    );
  });

  it("blocked seats shrink the width — the survivor pool still peaks at its own Σ ceilings", async () => {
    const posts = Array.from({ length: 20 }, (_, i) => bulkPost(id19(i + 1))); // 2 batches
    const state = { inFlight: 0, peak: 0 };
    const mockFetch = (async (_url: unknown, options?: unknown): Promise<Response> => {
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1)); // let peers enter
      state.inFlight -= 1;
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
        (match) => match[1] ?? "",
      );
      return ok(bulkContent(ids));
    }) as unknown as typeof fetch;

    const result = await judgePosts(
      posts,
      threeAccounts(),
      KEYWORDS,
      mockFetch,
      "medium",
      new Map([
        [0, 4],
        [1, 4],
        [2, 4],
      ]),
      Date.now,
      (): Promise<void> => Promise.resolve(),
      new Map(),
      new Map([
        [0, "HTTP 429"],
        [1, "HTTP 503"],
      ]),
    );

    // Only seat 2 survives: width = its ceiling 4, and the two batches
    // cannot exceed it — a regression that subtracts blocked seats from
    // the SURVIVORS' capacity drops this peak below 2.
    assert.equal(state.peak, 2); // min(4, 2 batches)
    assert.equal(result.judged.length, 20);
    assert.deepEqual(result.skippedPostIds, []);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Judge suite passes: `npx tsx --test tests/judge.test.ts`
- [x] Rotation suite stays green (the pick skip line + canonical freshState are untouched): `npx tsx --test tests/judge-rotation.test.ts`
- [x] Scoped lint clean: `npx biome check src/judge.ts tests/judge.test.ts`
- [x] The defaulted trailing param exists: `grep -n "blocked: ReadonlyMap<number, string> = new Map()" src/judge.ts` returns a match
- [x] The width exclusion exists: `grep -n "state.blocked.has(index)" src/judge.ts` returns a match
- [x] The guard exists and is wired: `grep -n "allAvailabilityBlocked" src/judge.ts` returns exactly 2 matches (definition + the flavor-split call)
- [x] The subsumption is total: `grep -n "allHealthBlocked" src/judge.ts` returns ZERO matches (no dead predicate survives)
- [x] The all-blocked case asserts zero fetch calls AND zero sleeps: `grep -n "assert.deepEqual(delays, [])" tests/judge.test.ts` returns a match inside the blocked-mask describe
- [x] The mixed-pool case pins the spent bulk backoff: delays `[1_000]` and calls `1` — a mid-backoff 5xx never stamps, and the guard fires before any park
- [x] The blocked appendix renders mask reasons in pool order: the all-blocked case pins `[1, "HTTP 429"], [2, "network error: socket hang up"], [3, "unusable answer: missing message content"]`

#### Manual Verification:
- [ ] Empty-mask equivalence: every pre-existing judgePosts case passes unchanged (FR4 — the defaulted param and the width reduce are byte-equivalent with an empty mask)
- [ ] The guard's mixed-pool case (blocked seat + health-drained survivor) terminates instantly — a regression to the timerless `waitCeilingSlot` hang would park the suite, so a green run IS the assertion
- [ ] The blocked appendix outranks the capped appendix: a capped-and-refused seat renders the mask's reason once, never twice

---

## Phase 4: Pool-truthful exhaustion wording

### Overview

`rotationExhausted` gains the trailing optional `poolSize` (recorded signature `(failures, health?, poolSize?)`): with it the message reads "judge: X of N LLM_ACCOUNTS accounts failed" — X can sit under N, because a seat that was merely saturated or still healthy when the budget died never enters the record; without it the legacy "all X" form stands for bare test-constructed errors. `buildExhaustionText`/`sendExhaustionEmail` gain the same optional: pool-truthful header, an "(X of N accounts failed)" subject with the `/judge pool exhausted/` pin fragment surviving, and a "Still working" survivors line computed by set-difference against the 1-based pool positions. All three judge throw sites pass `state.accounts.length`. Pins preserved: the body keeps the `LLM_ACCOUNTS` token; no existing test pins the error message string; the legacy caller `src/index.ts:473` compiles unchanged and keeps today's wording until Phase 5's extracted helper passes the pool size.

### Changes Required:

#### 1. Factory poolSize
**File**: `src/judge-rotation.ts`
**Changes**: the factory gains the trailing optional `poolSize` (D9). Health stays second, poolSize third.

```ts
// -- rotationExhausted (the src/judge-rotation.ts:129-145 anchor): the
// -- factory gains the trailing optional poolSize (D9) — with it the
// -- message is pool-truthful, without it the legacy bytes stand for
// -- bare test-constructed errors. Health stays second, poolSize third:
// -- the recorded signature is (failures, health?, poolSize?). --
/** Build a pool-exhausted error carrying the per-account record. With
 *  poolSize the message is pool-truthful — "X of N LLM_ACCOUNTS accounts
 *  failed" (X can sit under N: a seat that was merely saturated or still
 *  healthy when the budget died never enters the record). Without it the
 *  legacy "all X" form stands — bare test-constructed errors keep
 *  today's wording. */
export function rotationExhausted(
  failures: readonly AccountFailure[],
  health?: TickOutcomes,
  poolSize?: number,
): RotationExhausted {
  const detail = failures.map((f) => `account ${f.account} (${f.baseUrl}): ${f.reason}`).join("; ");
  const summary =
    poolSize === undefined
      ? `judge: all ${failures.length} LLM_ACCOUNTS account(s) exhausted`
      : `judge: ${failures.length} of ${poolSize} LLM_ACCOUNTS accounts failed`;
  const error = new Error(`${summary} — ${detail}`) as RotationExhausted;
  error.name = ROTATION_EXHAUSTED;
  error.failures = [...failures];
  if (health !== undefined) {
    error.health = health;
  }
  return error;
}
```

#### 2. Pool-truthful email copy
**File**: `src/email.ts`
**Changes**: `buildExhaustionText` header becomes pool-truthful when `poolSize` rides, and a survivors line renders by set-difference; the legacy branch keeps today's bytes. `sendExhaustionEmail` passes `poolSize` to the build AND the subject; transport stays third so the existing caller compiles unchanged.

```ts
// -- buildExhaustionText (the src/email.ts:188-207 anchor): the header
// -- becomes pool-truthful when poolSize rides, and a survivors line
// -- renders by set-difference; the legacy branch keeps today's bytes. --
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

// -- sendExhaustionEmail (the src/email.ts:209-227 anchor): poolSize rides
// -- the build AND the subject; transport stays third so the existing
// -- caller (src/index.ts:473) compiles unchanged and keeps today's
// -- wording until Slice 5's extracted helper passes the pool size. --
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
```

#### 3. Throw sites pass the pool size
**File**: `src/judge.ts`
**Changes**: every call passes `state.accounts.length` so mid-run wording is pool-truthful — X can sit under N when a seat was merely saturated or still healthy when the budget died (it never entered the record, and the message must not call that seat failed).

```ts
// -- The three RotationExhausted throw sites (D9): every call passes
// -- state.accounts.length so mid-run wording is pool-truthful — X can
// -- sit under N when a seat was merely saturated or still healthy when
// -- the budget died (it never entered the record, and the message must
// -- not call that seat failed). --
// -- judgePost wrapper's exhausted arm (the src/judge.ts:789-793 anchor;
// -- health stays undefined: the standalone wrapper has no TickOutcomes): --
  if (outcome.status === "exhausted") {
    // D6: thrown at wrapper level, OUTSIDE the core's try — a throw inside
    // would be swallowed by the total transport catches.
    throw rotationExhausted(exhaustionRecord(state), undefined, state.accounts.length);
  }

// -- judgePosts' drain-then-throw (the src/judge.ts:897-899 anchor): --
  if (outcomes.some((outcome) => outcome?.status === "exhausted")) {
    throw rotationExhausted(
      exhaustionRecord(state),
      readTickOutcomes(state),
      state.accounts.length,
    );
  }

// -- judgePosts' fallback re-throw (the src/judge.ts:975-977 anchor): --
    if (exhausted) {
      throw rotationExhausted(
        exhaustionRecord(state),
        readTickOutcomes(state),
        state.accounts.length,
      );
    }
```

#### 4. Wording cases + import updates
**File**: `tests/judge-rotation.test.ts`
**Changes**: the factory joins the rotation import (alphabetical, after `releaseAccount`); `AccountFailure` joins the types import; a new describe appended after the blocked-mask describe.

```ts
// -- Import updates (Slice 4): the factory joins the rotation import
// -- (alphabetical, after releaseAccount); AccountFailure joins the types
// -- import. --
import {
  type RotationExhausted,
  type RotationState,
  claimAccount,
  coolAccount,
  earliestCooldown,
  isRotationExhausted,
  pickEligibleAccount,
  releaseAccount,
  rotationExhausted,
  waitCeilingSlot,
} from "../src/judge-rotation.js";
import type { AccountFailure, Post } from "../src/types.js";

// -- New describe (Slice 4, D9), appended after the blocked-mask describe: --
describe("pool-truthful exhaustion wording (D9)", () => {
  const failures: AccountFailure[] = [
    { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
    { account: 2, baseUrl: "https://api.b.com/v1", reason: "network error: socket hang up" },
  ];

  it("with poolSize the message reads X of N accounts failed", () => {
    const error = rotationExhausted(failures, undefined, 3);
    assert.match(error.message, /^judge: 2 of 3 LLM_ACCOUNTS accounts failed — /);
    assert.ok(error.message.includes("account 1 (https://api.a.com/v1): HTTP 429"));
    assert.ok(
      error.message.includes("account 2 (https://api.b.com/v1): network error: socket hang up"),
    );
  });

  it("without poolSize the legacy all-X form stands (bare test-constructed errors)", () => {
    const error = rotationExhausted(failures);
    assert.match(error.message, /^judge: all 2 LLM_ACCOUNTS account\(s\) exhausted — /);
  });

  it("the judgePosts throw site passes the pool size — the caught error reads 2 of 2", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = (async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each post below")) {
        return ok("{}"); // answered, zero verdicts — every post falls back
      }
      return new Response("Too Many Requests", { status: 429 }); // both accounts cool
    }) as unknown as typeof fetch;
    const inertSleep = (ms: number): Promise<void> => Promise.resolve();
    let caught: unknown;
    try {
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
    } catch (error) {
      caught = error;
    }
    assert.ok(isRotationExhausted(caught));
    assert.match(
      (caught as RotationExhausted).message,
      /^judge: 2 of 2 LLM_ACCOUNTS accounts failed — account 1 \(https:\/\/account-one\.api\/v1\): HTTP 429/,
    );
  });

  it("mid-run exhaustion with a saturated healthy survivor reads 1 of 2 — the survivor never failed", async () => {
    const posts = Array.from({ length: 20 }, (_, i) => bulkPost(id19(i + 1))); // 2 batches, 2 workers
    let tick = 0;
    const now = (): number => tick;
    let releaseSurvivor!: (response: Response) => void;
    const survivorGate = new Promise<Response>((resolve) => {
      releaseSurvivor = resolve;
    });
    const sleeps: number[] = [];
    const inertSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      tick += ms; // parks wake exactly at expiry
      // The third park spends the last of the 180_000 cell; release the
      // held dispatch so the drain-then-throw join completes.
      if (sleeps.length === 3) {
        releaseSurvivor(ok('{"relevant": true, "locationOk": true}'));
      }
      return Promise.resolve();
    };
    const mockFetch = (async (url: unknown): Promise<Response> => {
      if (String(url).includes("account-one")) {
        return new Response("Too Many Requests", { status: 429 });
      }
      return survivorGate; // the healthy seat saturates: held, never answers
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await judgePosts(
        posts,
        twoAccounts(),
        KEYWORDS,
        mockFetch,
        "medium",
        new Map([
          [0, 1],
          [1, 1],
        ]),
        now,
        inertSleep,
      );
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    const exhausted = caught as RotationExhausted;
    // The saturated seat never failed, so it never entered the record —
    // the pool-truthful count is 1 of 2.
    assert.deepEqual(
      exhausted.failures.map((f) => f.account),
      [1],
    );
    assert.match(
      exhausted.message,
      /^judge: 1 of 2 LLM_ACCOUNTS accounts failed — account 1 \(https:\/\/account-one\.api\/v1\): HTTP 429/,
    );
    assert.deepEqual(sleeps, [60_500, 60_500, 59_000]); // the budget parks, hand-stepped
  });
});
```

#### 5. Email copy pins
**File**: `tests/email.test.ts`
**Changes**: a new describe appended after the existing `describe("buildExhaustionText")`; two cases inside the existing `describe("sendExhaustionEmail")` (its local `failures` fixture is the single-entry list, so the legacy case pins the singular form).

```ts
// -- New describe, appended after the existing describe("buildExhaustionText"): --
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

// -- Two cases appended inside the existing describe("sendExhaustionEmail")
// -- (its local `failures` fixture is the single-entry list, so the legacy
// -- case pins the singular form): --
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
```

### Success Criteria:

#### Automated Verification:
- [x] Rotation suite passes: `npx tsx --test tests/judge-rotation.test.ts`
- [x] Email suite passes: `npx tsx --test tests/email.test.ts`
- [x] Judge and index suites stay green (the throw sites are wording-only): `npx tsx --test tests/judge.test.ts` and `npx tsx --test tests/index.test.ts`
- [x] Scoped lint clean: `npx biome check src/judge-rotation.ts src/email.ts src/judge.ts tests/judge-rotation.test.ts tests/email.test.ts`
- [x] All three throw sites pass the pool size: `grep -c "state.accounts.length" src/judge.ts` returns exactly 3, all inside `rotationExhausted` calls
- [x] The X-of-N shape exists: `grep -n "of ${poolSize} LLM_ACCOUNTS accounts failed" src/judge-rotation.ts` returns a match
- [x] The X<N acceptance case exists and pins the survivor-free record: `grep -n "1 of 2 LLM_ACCOUNTS accounts failed" tests/judge-rotation.test.ts` returns a match
- [x] The subject fragment pin survives: `grep -n "judge pool exhausted" src/email.ts` returns a match

#### Manual Verification:
- [ ] Legacy equivalence: with `poolSize` absent, factory message, email header, and subject are byte-identical to today — every pre-existing email/rotation case passes unchanged
- [ ] "2 of 3" reads pool-truthfully at both layers: the judge layer pins `1 of 2` (a saturated healthy survivor never failed); the email layer pins `(2 of 3 accounts failed)` + the survivors line
- [ ] `src/index.ts:473` compiles untouched and keeps today's wording until Phase 5's extracted alarm helper passes the pool size

---

## Phase 5: Pipeline wiring and the all-down skip

### Overview

Wires everything into `runWatcher` and closes the plan — the terminal phase, carrying the repo-wide gates. The `judgeAvailability` seam lands on `WatcherDeps` beside `judgeCeiling`/`judgeHealth` (the never-throw seam family); its doc comment states the degrade contract and the production default rides `deps.fetchFn`. The pre-check runs in its own `timeStage` with the stable log pair, at function level below Gate 1 and above the judge stage — a `return` inside the judge `timeStage` closure would leave `flushTickHealth` running against an undefined outcome. The all-down skip (D7): zero survivors on a trustworthy verdict — no judge calls, ids stay unseen, the episode alarm fires at most once via the extracted shared helper `flushAndSendExhaustionAlarm` (D8, also adopted by the entry catch), the run resolves the honest exit-0 `WatcherRun`, no heartbeat, no YAML change (the success-path Commit state step already carries the health file). The mask becomes `judgePosts`' 10th argument. The episode sequence keeps its pre-flush discipline in both paths: `episodeAlarmDue` is read BEFORE `flushExhaustionHealth` opens the bit, so an open bit means a previous run already alarmed; a failed flush leaves the alarm due (fail-visible). Per D10, every existing test that drives the judge stage injects the pass-all `availabilityPassAll` double — do NOT rely on the checker tolerating judge-fetch answer shapes.

### Changes Required:

#### 1. Seam, pre-check stage, skip branch, helper extraction, mask
**File**: `src/index.ts`
**Changes**: import updates; the exported shared helper after `heartbeat()`; the `WatcherDeps` seam; the pre-check stage + sit-out lines + all-down skip + mask in `runWatcher`; the 10th `judgePosts` argument; the entry catch collapsed onto the shared helper. The catch rewrite REMOVES two lines that exist at HEAD: the `let episodeAlreadyOpen = false;` local and its inline pre-flush `episodeAlarmDue` read (both now live inside the helper) — delete them with the old body, or lint flags the orphaned variable.

```ts
// -- Import updates (alphabetical placement: judge-availability sorts
// -- between heartbeat and judge-ceilings; TickOutcomes joins the
// -- judge-health type imports; AccountFailure joins the types import): --
import { type AvailabilityResult, checkJudgeAvailability } from "./judge-availability.js";
import {
  type HealthRead,
  type TickOutcomes,
  buildDegradedAccountsLine,
  episodeAlarmDue,
  flushExhaustionHealth,
  flushTickHealth,
  loadAccountHealth,
} from "./judge-health.js";
import type { AccountFailure, Post } from "./types.js";

// -- NEW shared helper, placed after heartbeat() (the
// -- notification-episode family). Exported: the entry catch is
// -- production-only (process.exit), so the offline suite exercises the
// -- episode sequence through this seam: --
/**
 * The shared exhaustion-episode sequence (D8): the pre-flush
 * episodeAlarmDue read, the exhaustion health flush, then the
 * suppress-or-send alarm. The skip branch calls it with the injected
 * pool, the hoisted health snapshot, and deps.transport; the entry catch
 * calls it with the bootstrap re-resolve (production nodemailer default;
 * process.exit(1) stays in the catch). The pre-flush discipline: the
 * flush OPENS the episode bit, so an open bit read BEFORE it means a
 * previous run already alarmed — one alarm per episode.
 * flushExhaustionHealth never throws, so a failed flush cannot swallow
 * the alarm: the due-read already happened and the send still fires
 * (fail-visible — a duplicate alarm costs one email, a suppressed alarm
 * costs the outage). The email's pool size rides as accounts.length
 * (D9): the skip path reads "3 of 3 accounts failed" against a 0-of-N
 * availability log line, and the mid-run catch path finally composes
 * pool-truthful wording.
 *
 * The caller passes a FRESH read: a stale snapshot can only DUPLICATE
 * the alarm — never suppress it — the fail-safe direction the doctrine
 * already picks (a duplicate costs one email, a suppressed alarm costs
 * the outage). The entry catch re-resolves per invocation; the skip
 * branch passes the run's hoisted snapshot, which no in-run write has
 * touched (a skip run never reaches the tick flush).
 */
export async function flushAndSendExhaustionAlarm(deps: {
  readonly accounts: readonly LlmAccount[];
  readonly health: HealthRead;
  readonly outcomes: TickOutcomes;
  readonly failures: readonly AccountFailure[];
  readonly env: Record<string, string | undefined>;
  readonly transport: Transporter | undefined;
  readonly judgeHealthPath: string | undefined;
}): Promise<void> {
  const episodeAlreadyOpen = !episodeAlarmDue(deps.health.file);
  await flushExhaustionHealth(deps.accounts, deps.health.file, deps.outcomes, deps.judgeHealthPath);
  if (episodeAlreadyOpen) {
    console.warn(
      "watch: outage episode already open — exhaustion alarm suppressed (one per episode)",
    );
    return;
  }
  try {
    await sendExhaustionEmail(
      deps.failures,
      resolveEmailConfig(deps.env),
      deps.transport,
      deps.accounts.length,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`email: exhaustion alarm not sent — ${message}`);
  }
}

// -- WatcherDeps: the seam lands between judgeHealth and judgeHealthPath
// -- (the src/index.ts:126/:131 never-throw seam family): --
  /** Availability pre-check (D6 seam, the judgeCeilings shape). Default:
   *  checkJudgeAvailability over deps.fetchFn — the module owns its
   *  never-throw degrade contract: per-account refusals come back as
   *  failures, a checker fault degrades to all-available (degraded:
   *  true) and the run proceeds unfiltered. */
  readonly judgeAvailability?: (accounts: readonly LlmAccount[]) => Promise<AvailabilityResult>;

// -- runWatcher: the pre-check stage, the sit-out lines, the all-down
// -- skip, and the mask — inserted AFTER the Gate-1 line
// -- console.log(\`state: \${newPosts.length} unseen post(s)\`); and
// -- BEFORE the judge timeStage (below Gate 1, above the judge stage at
// -- function level: a return inside the judge closure would strand
// -- flushTickHealth against an undefined outcome): --
  const checkAvailability =
    deps.judgeAvailability ??
    ((accounts: readonly LlmAccount[]) => checkJudgeAvailability(accounts, deps.fetchFn));
  const { value: availability, durationMs: availabilityMs } = await timeStage(() =>
    checkAvailability(judgeAccounts),
  );
  console.log(`timing: availability ${availabilityMs}ms`);
  const availableCount = judgeAccounts.length - availability.failures.length;
  console.log(`availability: ${availableCount} of ${judgeAccounts.length} account(s) available`);
  // One sit-out line per refused account: the run's visibility into who
  // sits out and why (the mask below carries the same reasons).
  for (const failure of availability.failures) {
    console.log(
      `availability: account ${failure.account} (${failure.baseUrl}) sits out — ${failure.reason}`,
    );
  }
  // The all-down skip (D7): zero survivors on a trustworthy verdict — no
  // judge calls, ids stay unseen, the episode alarm fires at most once,
  // and the run resolves exit-0 green. A degraded check never skips: an
  // unfiltered run is the contract (the checker warned once already).
  if (
    judgeAccounts.length > 0 &&
    !availability.degraded &&
    availability.failures.length === judgeAccounts.length
  ) {
    console.log(
      `availability: skipping the judge stage — every account refused, ${newPosts.length} post(s) stay unseen`,
    );
    await flushAndSendExhaustionAlarm({
      accounts: judgeAccounts,
      health,
      outcomes: { ok: [], failed: new Map<number, string>() },
      failures: availability.failures,
      env,
      transport: deps.transport,
      judgeHealthPath,
    });
    return { judged: 0, matches: 0, skipped: newPosts.length, saved: false };
  }
  // The mask (D2): 1-based failure account numbers become 0-based
  // RotationState indexes. Survivors dispatch at their committed
  // ceilings; refused seats never dispatch and never count toward width.
  const blocked = new Map(
    availability.failures.map((failure) => [failure.account - 1, failure.reason] as const),
  );

// -- The judgePosts call inside the judge timeStage gains the mask as
// -- the 10th argument (after health.marks — Slice 3's defaulted
// -- trailing parameter): --
    return judgePosts(
      newPosts,
      judgeAccounts,
      config.keywords,
      deps.fetchFn,
      config.reasoningEffort,
      ceilings,
      now,
      sleepFn,
      health.marks,
      blocked,
    );

// -- The entry catch: the episode sequence collapses into the shared
// -- helper. The bootstrap resolve and loadAccountHealth stay inside the
// -- try — their failure leaves episodeHandled false and the fallback
// -- below sends the alarm unsuppressed (fail-visible), pool size
// -- unknowable, legacy wording (D9). process.exit(1) stays in the
// -- catch: --
    if (isRotationExhausted(error)) {
      console.error(`watch: FAILED — ${error.message}`);
      let episodeHandled = false;
      try {
        const bootstrapAccounts = resolveJudgeConfig(process.env);
        const healthRead = await loadAccountHealth(bootstrapAccounts);
        await flushAndSendExhaustionAlarm({
          accounts: bootstrapAccounts,
          health: healthRead,
          outcomes: error.health ?? { ok: [], failed: new Map<number, string>() },
          failures: error.failures,
          env: process.env,
          transport: undefined,
          judgeHealthPath: undefined,
        });
        episodeHandled = true;
      } catch (healthError) {
        const healthMessage =
          healthError instanceof Error ? healthError.message : String(healthError);
        console.warn(`judge: health flush failed — ${healthMessage}`);
      }
      if (!episodeHandled) {
        try {
          await sendExhaustionEmail(error.failures, resolveEmailConfig(process.env));
        } catch (emailError) {
          const emailMessage =
            emailError instanceof Error ? emailError.message : String(emailError);
          console.warn(`email: exhaustion alarm not sent — ${emailMessage}`);
        }
      }
      process.exit(1);
    }
```

#### 2. Injection sweep + five acceptance scenarios
**File**: `tests/index.test.ts`
**Changes**: import updates; new fixtures; THE INJECTION SWEEP — the `judgeAvailability: availabilityPassAll` line joins the deps literal of every test that drives the judge stage (12 sites, inserted after `fetchFn` in each); a new describe after the "provider health (the entry wiring)" describe with six new cases. (The four Gate-1 tests are untouched: the pre-check sits BELOW Gate 1, so those runs never reach the stage.)

```ts
// -- Import updates (alphabetical): flushAndSendExhaustionAlarm joins
// -- the index import; the availability, LlmAccount, and AccountFailure
// -- types join from their modules: --
import { flushAndSendExhaustionAlarm, runWatcher, timeStage } from "../src/index.js";
import type { AvailabilityResult } from "../src/judge-availability.js";
import { type HealthFile, loadAccountHealth } from "../src/judge-health.js";
import { isRotationExhausted } from "../src/judge-rotation.js";
import type { LlmAccount } from "../src/judge.js";
import type { AccountFailure, JudgeVerdict, Post } from "../src/types.js";

// -- New fixtures (after recordingTransport): --
/**
 * Pass-all availability double (D10): every judge-stage test injects it.
 * The DEFAULT checker would probe the judge fetch doubles — a 429/500
 * answer would mis-mark accounts unavailable, and the all-down skip
 * branch would flip mid-run exhaustion tests into green skip runs.
 */
const availabilityPassAll = async (): Promise<AvailabilityResult> => ({
  failures: [],
  degraded: false,
});

/** Three-account pool for the some-pass, all-down, and degrade scenarios. */
const THREE_ACCOUNT_ENV: Record<string, string | undefined> = {
  ...BASE_ENV,
  LLM_ACCOUNTS: JSON.stringify([
    { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
    { baseUrl: "https://two.api/v1", apiKey: "k2", model: "m2" },
    { baseUrl: "https://three.api/v1", apiKey: "k3", model: "m3" },
  ]),
};

const threeAccounts: LlmAccount[] = [
  { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
  { baseUrl: "https://two.api/v1", apiKey: "k2", model: "m2" },
  { baseUrl: "https://three.api/v1", apiKey: "k3", model: "m3" },
];

// -- THE INJECTION SWEEP (D10): the line
// --   judgeAvailability: availabilityPassAll,
// -- joins the deps literal of every test that drives the judge stage —
// -- 12 sites, inserted after fetchFn in each:
// --   it("persists judged ids on a zero-match run and still sends the heartbeat (Gate 2)")
// --   it("sends the digest and persists judged ids when posts match")
// --   it("still persists judged ids when the heartbeat is disabled")
// --   it("keeps judge-skipped ids unseen while persisting the judged rest (D3)")
// --   it("rejects with the complete pool-ordered exhaustion record and never touches state at budget death")
// --   it("walks a mixed run: Threads through its session, LinkedIn through the pushed payload, and cleans the session dir")
// --   it("completes threads-only when the payload is absent, rendering the absent leg on the heartbeat")
// --   it("keeps Threads results when the payload read faults at run time (acceptance 1, the D12 belt)")
// --   it("renders the stale leg line on a match-run digest even when the leg contributed no posts (D13)")
// --   it("keeps LinkedIn posts on a linkedin-only config when a Threads session exists (D13 single return)")
// --   it("logs every surface from the raw config partition in the startup line (D14)")
// --   and the health-acceptance runOnce deps literal
// -- (The four Gate-1 tests are untouched: the pre-check sits BELOW
// -- Gate 1, so those runs never reach the stage.)

// -- New describe, after the "provider health (the entry wiring)" describe: --
describe("availability pre-check (the entry wiring)", () => {
  it("runs the default checker over deps.fetchFn — an all-pass pool behaves exactly as today (FR4)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [{ id: id19(30), text: "Hiring: ruby developer, remote" }];
    const statePath = await tempStatePath("availability-all-pass.json");
    const { transport, subjects } = recordingTransport();
    const bodies: string[] = [];
    const judgeDouble = judgeFetch({ relevant: true, locationOk: true }) as (
      url: unknown,
      options?: unknown,
    ) => Promise<Response>;
    const probingFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      bodies.push((options as { body: string }).body);
      return judgeDouble(url, options);
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: probingFetch,
      transport,
      statePath,
      now: () => NOW,
    });

    // FR4: same digest, same persistence — the only additions are the
    // availability log lines.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
    // One tiny probe per account rode the same production fetch default,
    // then the judged batch.
    const probeBodies = bodies.filter((body) => body.includes("Reply with the single word"));
    assert.equal(probeBodies.length, 3);
    assert.equal(bodies.length - probeBodies.length, 1);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /availability: 3 of 3 account\(s\) available/.test(line)));
  });

  it("some-pass: refused accounts sit out with their reason and only survivors dispatch", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [{ id: id19(31), text: "Hiring: swift developer, remote" }];
    const statePath = await tempStatePath("availability-some-pass.json");
    const { transport, subjects } = recordingTransport();
    const judgeHosts: string[] = [];
    const fetchFn = (async (url: unknown): Promise<Response> => {
      judgeHosts.push(new URL(String(url)).host);
      return ok(JSON.stringify({ [id19(31)]: { relevant: true, locationOk: true } }));
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({
        failures: [
          { account: 1, baseUrl: "https://one.api/v1", reason: "HTTP 429" },
          { account: 3, baseUrl: "https://three.api/v1", reason: "HTTP 503" },
        ],
        degraded: false,
      }),
    });

    // The run completed on the survivors and the digest went out.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    // The refused seats never dispatched: only the survivor's host called.
    assert.ok(judgeHosts.length > 0);
    assert.ok(judgeHosts.every((host) => host === "two.api"));
    // The sit-out lines name each refused account with its real reason.
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /account 1 \(https:\/\/one\.api\/v1\) sits out — HTTP 429/.test(line)),
    );
    assert.ok(
      lines.some((line) => /account 3 \(https:\/\/three\.api\/v1\) sits out — HTTP 503/.test(line)),
    );
    assert.ok(lines.some((line) => /availability: 1 of 3 account\(s\) available/.test(line)));
  });

  it("all-down: no judge call, ids stay unseen, one alarm reads 3 of 3, exit-0 run shape", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [
      { id: id19(32), text: "Hiring: php developer, remote" },
      { id: id19(33), text: "Hiring: laravel developer, bandung" },
    ];
    const statePath = await tempStatePath("availability-all-down.json");
    const healthPath = await tempHealthPath("availability-all-down-health.json");
    const { transport, subjects, texts } = recordingTransport();
    let judgeCalls = 0;
    const fetchFn = (async (): Promise<Response> => {
      judgeCalls += 1;
      return ok("{}");
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({
        failures: [
          { account: 1, baseUrl: "https://one.api/v1", reason: "HTTP 429" },
          { account: 2, baseUrl: "https://two.api/v1", reason: "network error: socket hang up" },
          {
            account: 3,
            baseUrl: "https://three.api/v1",
            reason: "unusable answer: missing message content",
          },
        ],
        degraded: false,
      }),
      judgeHealth: (accounts) => loadAccountHealth(accounts, healthPath),
      judgeHealthPath: healthPath,
    });

    // FR5: the honest skip run — exit 0 by resolution, nothing judged,
    // nothing persisted, the alarm the only mail (no heartbeat on skip).
    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 2, saved: false });
    assert.equal(judgeCalls, 0); // no judge call reached the dead pool
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // ids stay unseen
    assert.equal(subjects.length, 1); // the alarm, not the heartbeat
    assert.match(subjects[0] ?? "", /LLM judge pool exhausted \(3 of 3 accounts failed\)/);
    assert.ok(texts[0]?.includes("1. account 1 (https://one.api/v1) — HTTP 429"));
    assert.ok(!texts[0]?.includes("Still working")); // no survivors line
    // The run log names 0 of N: the counts line and the skip line.
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /availability: 0 of 3 account\(s\) available/.test(line)));
    assert.ok(lines.some((line) => /skipping the judge stage/.test(line)));
    // The skip flush flipped the episode bit and preserved every mark
    // (empty outcomes — pre-check 429s never reach the marks merge).
    const stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    assert.deepEqual(stored.marks, {});
  });

  it("two consecutive skips alarm once and preserve marks: the skip flush passes empty outcomes", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const posts = [{ id: id19(34), text: "Hiring: go developer, remote" }];
    const statePath = await tempStatePath("availability-dedup-state.json");
    const healthPath = await tempHealthPath("availability-dedup-health.json");
    // Seed: one account mid-streak, no open episode — the skip flushes
    // must not touch the mark (a pre-check refusal is NOT a provider
    // health failure) and the second tick must not re-alarm.
    await writeFile(
      healthPath,
      `${JSON.stringify(
        { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const { transport, subjects } = recordingTransport();
    const deps = {
      env: BASE_ENV, // the single-account pool
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: (async (): Promise<Response> => {
        throw new Error("judge must never dispatch on a skip run");
      }) as unknown as typeof fetch,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({
        failures: [{ account: 1, baseUrl: "https://mock.api/v1", reason: "HTTP 429" }],
        degraded: false,
      }),
      judgeHealth: (accounts: readonly LlmAccount[]) => loadAccountHealth(accounts, healthPath),
      judgeHealthPath: healthPath,
    };

    // Tick 1: the episode opens and the alarm fires.
    assert.deepEqual(await runWatcher(deps), { judged: 0, matches: 0, skipped: 1, saved: false });
    assert.equal(subjects.length, 1);
    // Tick 2: same pool, same refusal — the open bit suppresses.
    assert.deepEqual(await runWatcher(deps), { judged: 0, matches: 0, skipped: 1, saved: false });
    assert.equal(subjects.length, 1); // one alarm per episode
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /outage episode already open/.test(line)));
    // The seeded mark survived both skip flushes verbatim; the bit is open.
    const stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.deepEqual(stored.marks, { "https://mock.api/v1": 2 });
    assert.equal(stored.outageOpen, true);
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/);
  });

  it("a degraded checker result runs the stage unfiltered — the tick never crashes on the pre-check", async () => {
    const posts = [{ id: id19(35), text: "Hiring: kotlin developer, remote" }];
    const statePath = await tempStatePath("availability-degraded.json");
    const { transport, subjects } = recordingTransport();
    let judgeCalls = 0;
    const fetchFn = (async (): Promise<Response> => {
      judgeCalls += 1;
      return ok(JSON.stringify({ [id19(35)]: { relevant: true, locationOk: true } }));
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({ failures: [], degraded: true }),
    });

    // Degraded = all-available: the judge dispatched, the run completed.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.ok(judgeCalls >= 1);
  });

  it("the extracted alarm helper passes the pool size: a mid-run record reads 2 of 3 (D8/D9)", async () => {
    const healthPath = await tempHealthPath("availability-wording-health.json");
    const { transport, subjects, texts } = recordingTransport();
    const alarmDeps = {
      accounts: threeAccounts,
      health: { marks: new Map<number, number>(), file: undefined },
      outcomes: { ok: [] as number[], failed: new Map<number, string>() },
      failures: [
        { account: 1, baseUrl: "https://one.api/v1", reason: "HTTP 429" },
        { account: 2, baseUrl: "https://two.api/v1", reason: "network error: socket hang up" },
      ] as AccountFailure[],
      env: BASE_ENV,
      transport,
      judgeHealthPath: healthPath,
    };

    await flushAndSendExhaustionAlarm(alarmDeps);

    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], "LLM judge pool exhausted (2 of 3 accounts failed)");
    assert.ok(
      texts[0]?.includes("The LLM judge pool is exhausted — 2 of 3 LLM_ACCOUNTS accounts failed."),
    );
    assert.ok(texts[0]?.includes("Still working this run: account 3."));
    // The flush ran through the injected path and opened the episode bit.
    const stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    // A second episode call on the same file suppresses (one per episode):
    // the helper reads its PRE-FLUSH snapshot, so the caller re-resolves
    // the read from disk exactly like the entry catch does per invocation.
    const reloaded = await loadAccountHealth(threeAccounts, healthPath);
    await flushAndSendExhaustionAlarm({ ...alarmDeps, health: reloaded });
    assert.equal(subjects.length, 1);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Whole-repo gates (the terminal slice): `npm run typecheck`, then `npm run lint`, then `npm test` — all exit 0
- [x] Index suite passes: `npx tsx --test tests/index.test.ts`
- [x] The seam exists beside its siblings: `grep -n "judgeAvailability" src/index.ts` returns the WatcherDeps field and the pre-check call site
- [x] The skip branch exists: `grep -n "skipping the judge stage" src/index.ts` returns a match
- [x] The alarm helper is shared: `grep -n "flushAndSendExhaustionAlarm" src/index.ts` returns exactly 3 matches (definition + catch call + skip call)
- [x] Pool size rides both alarm paths: `grep -n "deps.accounts.length" src/index.ts` returns the 4th sendExhaustionEmail argument inside the helper
- [x] The injection sweep is total: `grep -c "availabilityPassAll" tests/index.test.ts` returns at least 13 (the double + 12 judge-stage sites)
- [x] The all-down case pins the full FR5 shape: `judgeCalls === 0`, a `/ENOENT/` rejection on the state file, `subjects.length === 1`, subject `/LLM judge pool exhausted \(3 of 3 accounts failed\)/`, `stored.outageOpen === true`, `stored.marks` deep-equal `{}`
- [x] The dedup case pins the seeded mark surviving two skip flushes: `stored.marks` deep-equal `{ "https://mock.api/v1": 2 }`, the second tick logs `/outage episode already open/`, subjects stay length 1
- [x] The wording case pins the extracted helper's pool-size pass: subject equals `LLM judge pool exhausted (2 of 3 accounts failed)`, and a second helper call suppresses (subjects stay length 1)

#### Manual Verification:
- [ ] FR4: an all-pass injected run completes with today's exact WatcherRun and email set — the only additions are the availability log lines
- [ ] The skip branch exits 0 by resolving the honest `WatcherRun` (the acceptance asserts the resolved run, never an exit code)
- [ ] No heartbeat on skip runs — the alarm email is the only mail (`subjects.length === 1`)
- [ ] The catch keeps `process.exit(1)` and its unsuppressed fallback send (bootstrap fault = pool size unknowable, legacy wording stands)
- [ ] `watch.yml` untouched: the success-path Commit state step already carries the health file (`watch.yml:243-247`)

---

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents, run inline against the live codebase at HEAD (harness note: no subagent tool in this session). Findings triaged at Step 5._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 5 §1        | src/index.ts:441-485 (entry catch) | concern | codebase-fit | At HEAD the catch declares `let episodeAlreadyOpen = false;` and does the pre-flush `episodeAlarmDue` read inline. The plan's fence removes both (the extracted helper owns them); a partial edit could orphan the variable and leave a dead read. | Add "remove the now-orphaned `episodeAlreadyOpen` local and its inline pre-flush read" to the **Changes** line. | applied: Phase 5 §1 Changes line now names the two removed lines (orphaned `episodeAlreadyOpen` + inline pre-flush read). |
| code     | Phase 3 §2        | src/judge.ts `exhaustionRecord` | suggestion | codebase-fit | The fence quotes the full function body; at HEAD the capped-appendix loop already exists, so the hunk reads as a whole-function replacement. The design's comment header says this, but an implementer could misread it as an insertion and double the capped loop. | Make the **Changes** line explicit: "replace the whole function." | applied: Phase 3 §2 Changes line now opens with "REPLACE THE WHOLE FUNCTION". |

_artifact-coverage-reviewer: no findings — every `## Verification Notes` and `## Pattern References` entry in the design lands in either a phase's `### Success Criteria:` bullet or a visible code mirror (all five acceptance scenarios, the episode-dedup pair, the marks-preservation pin, the mask semantics, the checker payload pins, the subject-regex pin, and the live-smoke step are all present)._

## Testing Strategy

### Automated:
- Phases 1-4 verify scoped: the phase's own suite (`npx tsx --test tests/<name>.test.ts`), the neighbor suites each phase names, and `npx biome check` over that phase's file set only — no phase rewrites the wider tree.
- Phase 5 (terminal) runs the whole-repo gates: `npm run typecheck`, `npm run lint`, `npm test`, all exit 0. Evidence the gates are green at base: MEASURED at HEAD 77f44d7 this session (2026-11-09 06:32 +0700) — `npm run typecheck` clean, `npm run lint` clean over 58 files, `npm test` 447/447 pass with 0 fail (22.4s); this plan touches no file outside its 10-file set.
- Final whole-plan gate is owned by `validate`: it re-runs every phase's Automated Verification commands over the finished tree.

### Manual Testing Steps (reference; not load-bearing — the phase criteria above encode the checks):
1. Live validation after merge: `workflow_dispatch` smoke with one deliberately broken key — that account sits out with its reason, the run completes green on the rest; same-day fix window reserved (every prior rotation/health change passed offline and was corrected by a live run).
2. Review a real skip-run email: subject "(3 of 3 accounts failed)", body names each account with its real reason, no survivors line.
3. Confirm the skip-run commit lands as the normal state commit-back (cosmetic subject noise accepted, developer-ratified).

## Performance Considerations

- The stage costs one round of N parallel tiny calls bounded by the 10s per-account abort — wall clock ~10s worst case, ~144 calls/account/day at the 10-minute cadence (accepted cost, FRD NFR)
- Survivors judge at their committed ceilings; width shrinks only by blocked indexes, so a partial outage reduces concurrency proportionally instead of parking the run
- The mask adds one `Map.has` read per pick scan — O(1) on the hot path
- No new timers in tests: the checker suite uses rejecting doubles, never real sleeps

## Migration Notes

- Not applicable: no persisted schema change, no new state file, no env var. `state/judge-health.json`'s writer set is unchanged (the skip flush is a new call site of the same writer)
- Behavioral note for reviewers: existing judge-stage tests must inject a pass-all `judgeAvailability` or they silently become skip runs (the default checker would run over their fetch doubles)

## Developer Context

- Harness note (2026-11-08): no subagent tool exists in this session's harness; the skill's Step 4 artifact-code-reviewer and artifact-coverage-reviewer run as inline verification against the sources read this session (mirrors the design artifact's harness note).
- Phase 2's `src/judge.ts` compile stub is temporary by design — Phase 3 replaces it with the real defaulted-parameter wiring. Do not "clean it up" early.
- The skip-run commit subject reads like a normal state commit ("state: 0 new seen post ids") — accepted cosmetic noise, developer-ratified in the design (the no-YAML-change constraint blocks a fix).

## References

- Design: `.rpiv/artifacts/designs/2026-11-08_14-15-40_account-availability-check.md`
- Solution (Option 1 selected; alternatives documented as dead-ends): `.rpiv/artifacts/solutions/2026-11-08_13-32-27_account-availability-check.md`
- Research (Findings 1-9, the mask comparison, resolved FRD open questions): `.rpiv/artifacts/research/2026-11-08_12-45-40_account-availability-check.md`
- FRD (D0-D8, FR1-FR7): `.rpiv/artifacts/discover/2026-11-08_12-04-26_account-availability-check.md`
- Module boundary this feature must not break: `.rpiv/artifacts/solutions/2026-11-07_08-22-22_provider-health-module-boundary.md`

---

## Follow-up (2026-11-09T07:15:33+0700)

_Post-implement revision (skill:revise, manual form). Seven plan test-fences had drifted from (or could never have produced) the landed files — three found by review (§§1, 2, 4), five more by a transcription-hygiene sweep (§5); all are corrected to the landed bytes above, one helper no-op is removed in src, and one open design question is ratified closed. Gates re-verified after the src changes: typecheck clean, lint clean (60 files), whole suite 484/484. No checkbox unchecking: the landed implementation satisfies every revised criterion as re-run this session._

### 1. The Phase 1 §3 fence was un-runnable as authored — corrected

The fence's `fetchByHost` double returned only `{ fetchFn, urls }` while its own first case asserted `calls.length === 3` — the fence could not compile. Implement added the `calls: unknown[]` recorder mid-run (undisclosed at the time); the fence above now carries it. The assertion itself is NOT vacuous with the recorder present: it pins that the some-fail case probes all three accounts despite two refusals.

### 2. The Phase 5 §2 wording case: the caller-side re-load is the ratified shape — fence corrected, question closed

The fence called `flushAndSendExhaustionAlarm(alarmDeps)` twice with the same object whose `health.file` is `undefined` — the helper's PRE-FLUSH `episodeAlarmDue` read can never see the bit the first call flushed, so the second alarm fires and the pinned `subjects.length === 1` fails. Ratified decision (developer, this session): the helper keeps trusting the CALLER's snapshot; the test re-resolves the read from disk before the second call, mirroring the entry catch's per-invocation `loadAccountHealth`. Rationale: a stale snapshot can only DUPLICATE the alarm, never suppress one — the fail-safe direction the episode doctrine already picks ("a duplicate alarm costs one email, a suppressed alarm costs the outage"); a helper-owned re-read would reshape the deps contract after all five phases landed for zero semantic gain. The contract is now stated in the helper's doc (Phase 5 §1 fence, mirrored in src/index.ts).

### 3. Process note: a silent module-write failure went undiscovered for a turn

During Phase 1 the `tools.write` of `src/judge-availability.ts` reported success but never landed (the failure surfaced as `ERR_MODULE_NOT_FOUND` when the suite ran, one step later). Standing rule for future implement runs on this plan's pattern: after each write, confirm the file exists (read-back or `git status -uall`) BEFORE building on it.

### 4. `deps.judgeHealthPath ?? undefined` no-op removed (src + fence)

The helper's field is already typed `string | undefined`; the `?? undefined` was dead — an inherited artifact of the fence. Removed in src/index.ts (biome collapses the flush call to one line, which the Phase 5 §1 fence now mirrors) and re-verified under all three repo gates.

### 5. Fence-drift sweep (second pass): five more hunks re-transcribed, two stale line refs fixed

Every `biome check --write` run during implementation silently reflowed a transcribed fence; the first pass fixed only the fences review happened to name. This pass re-transcribed the remaining five drifted hunks to the landed bytes:

- **Phase 2 §5** — the `freshState(twoAccounts(), new Map(), ...)` call in the half-open-probe case, collapsed by biome to one line.
- **Phase 3 §7** — the blank line before the blocked-mask describe's closing `});`, removed by hand to clear lint and never re-transcribed.
- **Phase 4 §1** — the `detail` map/join chain, collapsed to one line in src/judge-rotation.ts.
- **Phase 4 §2** — the `label` ternary, reflowed to biome's 2-line form in src/email.ts.
- **Phase 5 §2** — the account-3 sit-out assert, reflowed to biome's 3-line form in tests/index.test.ts.

Also fixed the two stale `src/judge.ts` line refs in src/judge-availability.ts's doc comments (`:71-77` → `:73-78` for REQUEST_TIMEOUT_MS, `:650-658` → `:680-682` for the bulk-only response_format rider — Phases 3-4 had moved both sites); the Phase 1 §1 fence mirrors the corrected refs. Each corrected fence is byte-verified against its landed file. The §3 write-existence rule stays an implement-loop discipline (enforced inline, one check after every write) — a document cannot enforce it.
