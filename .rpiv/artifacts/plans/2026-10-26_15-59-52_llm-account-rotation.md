---
date: 2026-10-26T15:59:52+0700
author: Yogiswara Utama
commit: 399181b
branch: ukind/fix-hit-limit
repository: fix-hit-limit
topic: "LLM account rotation on rate limit"
tags: [plan, judge, rotation, rate-limit, config, email, probe]
status: ready
parent: .rpiv/artifacts/solutions/2026-10-26_15-46-36_llm-account-rotation.md
phase_count: 4
phases:
  - { n: 1, title: Rotation types + LLM_ACCOUNTS parser, files: [src/types.ts, src/config.ts, src/judge.ts, tests/judge.test.ts], depends_on: [] }
  - { n: 2, title: Rotation mechanics + config flip, files: [src/judge.ts, tests/judge.test.ts], depends_on: [1] }
  - { n: 3, title: Exhaustion email, files: [src/email.ts, src/index.ts, tests/email.test.ts], depends_on: [2] }
  - { n: 4, title: Probe + workflow + docs + trio removal, files: [scripts/probe-judge.ts, src/config.ts, .github/workflows/watch.yml, README.md, AGENTS.md, .claude/skills/validate-e2e/SKILL.md], depends_on: [2] }
unresolved_phase_count: 0
last_updated: 2026-10-26T15:59:52+0700
last_updated_by: Yogiswara Utama
---

# LLM Account Rotation on Rate Limit — Implementation Plan

## Overview

Replace the single-account judge config (`LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`) with one `LLM_ACCOUNTS` JSON pool. `judgePosts` owns a `RotationState` (account pointer + failure record) shared by reference with its workers; the first HTTP 429 advances the pointer synchronously via a compare-and-set guard with no backoff wait; 5xx keeps same-account backoff; transport errors defer without rotating. When every account is exhausted, all workers drain, `judgePosts` throws a tagged error carrying the per-account record, the existing `main().catch` sends one exhaustion email, and the process exits 1.

## Requirements

- One `LLM_ACCOUNTS` JSON secret: ordered array of `{baseUrl, apiKey, model}`, validated fail-visible at startup, every error naming `LLM_ACCOUNTS`.
- First HTTP 429 rotates: the same call retries against the next account with no backoff wait.
- 5xx keeps the existing same-account backoff (1s/2s/4s budget); transport errors defer the batch immediately without rotating.
- Run-level sticky pointer: after failover the run stays on the new account; account 1 returns next run.
- Pool exhausted: typed error carrying the per-account failure record; exactly one exhaustion email; exit code 1; no partial digest, no state commit, unjudged posts stay unseen.
- Probe reads `LLM_ACCOUNTS` and probes with account 1; workflow, README, AGENTS.md, and the validate-e2e skill doc swap atomically.
- Keep log prefixes (`judge:`, `probe:`, `email:`, `watch: FAILED —`) and name the account in judge log lines.

## Current State Analysis

Single-account judge end to end:

- `resolveJudgeConfig` reads the three env names (`src/judge.ts:75-96`) into the `JudgeConfig` triple (`src/judge.ts:55-59`).
- `judgeBatch` retries 429+5xx on the same key with 1s/2s/4s backoff and defers when the budget spends (`src/judge.ts:267-347`); `model` is hoisted out of the retry loop into the payload (`:277`).
- `judgePost` is a 2-attempt status-agnostic fallback (`src/judge.ts:356-412`).
- `judgePosts` runs a 4-worker pool with a shared `next` batch cursor (`src/judge.ts:429-481`) and never throws (`src/judge.ts:417`).
- `src/index.ts:94-98` is the only production judge call site; `main().catch` at `src/index.ts:151-155` logs `watch: FAILED —` and exits 1.
- `ENV_NAMES` (`src/config.ts:14-22`) carries the trio; `scripts/probe-judge.ts:168-176` reads it for the probe guard.
- `.github/workflows/watch.yml:32-34` and `:58-60` map the three secrets into both jobs; `:65-77` commit step is success-gated.

### Key Discoveries

- **Lock-free cursor pattern**: the `next` batch cursor is read and advanced with no `await` between (`src/judge.ts:444-448`), proven coherent across four workers by `tests/judge.test.ts:433-500`. The rotation pointer clones this discipline, with a compare-and-set guard added for concurrent 429s.
- **Zero classes in `src/`**: every abstraction is plain functions/interfaces/closures. The exhaustion error is a tagged `Error` + factory + type guard, not a class — the same argument the solutions artifact used against the `AccountPool` class.
- **Validation precedent**: fail-visible per-item JSON validation with preserved parser messages lives in `src/config-file.ts:40-152` (`:56-59` parse, `:104` empty-array throw, `:87-152` per-item rules).
- **Test seams**: dependency injection via `fetchFn` (`src/judge.ts:270`, `:357`, `:431`); request-body capture mock at `tests/judge.test.ts:415-419`; stateful `measuredFetch` at `:234-253`; out-of-order concurrency choreography at `:464-500`. No test captures request headers yet — accounts are distinguished by `Authorization`, so a header-capturing mock modeled on the body-capture idiom is new mock surface. `mock.timers` exists nowhere in `tests/`; the 5xx proof uses the suite's real-sleep idiom.
- **Email seam**: builder + sender co-located over the `sendText` spine with an injected `Transporter` (`src/email.ts:54-80`, `:84-113`, `:122-153`); test capture idioms at `tests/email.test.ts:195-234`.
- **Commit gating**: the workflow's commit step (`watch.yml:65-77`) runs only on success, so a nonzero exhaustion exit can never race the state commit.
- **AGENTS.md wildcards**: `AGENTS.md:18` and `:21` say `LLM_*`, which still matches `LLM_ACCOUNTS` — only the judge bullet (`AGENTS.md:36-41`) needs an edit.

## Desired End State

```bash
# One secret instead of three:
export LLM_ACCOUNTS='[
  {"baseUrl": "https://api.a.com/v1", "apiKey": "key-a", "model": "model-a"},
  {"baseUrl": "https://api.b.com/v1", "apiKey": "key-b", "model": "model-b"}
]'
```

Run behavior:

1. All calls hit account 1 (index 0).
2. First 429: log `judge: batch 3 account 1 HTTP 429 — rotating to account 2`, and the very next call carries account 2's `Authorization` — no sleep.
3. The run stays on account 2 for every later batch and fallback (sticky pointer); account 1 returns next run.
4. A 5xx still backs off on the current account (1s/2s/4s); a transport error defers the batch without rotating.
5. Every account exhausted: all in-flight workers finish, then the run logs each account's failure, sends one "judge pool exhausted" email listing every account with its reason, and exits 1. `state/seen-posts.json` is untouched (success-gated commit).
6. `npx tsx scripts/probe-judge.ts` probes account 1 only.

## What We're NOT Doing

- Per-account 429 ramping in the probe (explicit follow-up in the FRD).
- Re-tuning `judgePost`'s 2-attempt semantics beyond the 429-rotate branch.
- Concurrency-ceiling changes (`JUDGE_CONCURRENCY` stays 4).
- Any new runtime dependency (global `fetch`, `nodemailer`, `node:test` only).
- Historical artifact rewrites (`.rpiv/artifacts/**` records stay as-is).
- Backward compatibility with the old three secrets — `LLM_ACCOUNTS` missing fails the run visibly (FRD removal requirement; no silent fallback).

## Decisions

### Rotation state lives in `judgePosts` as a mutable holder, passed by reference

State is plain bindings inside `judgePosts` — `RotationState { accounts, index, failures }` — siblings of the proven `next` cursor (`src/judge.ts:444-448`). Chosen over injected callbacks (the solutions artifact's original shape) and over the `AccountPool` class, explicit threading, and a module global (artifact Options 2-4, all rejected there). One object param keeps signatures tight and lets tests build the state literally.

### Pointer advance is a compare-and-set on the failing index

Four workers can read index 0 and all 429 on account 1. A bare `index += 1` per worker would advance four times and skip accounts nobody tried. `rotateOnRateLimit(state, failedIndex)` advances only when `state.index === failedIndex`, records the failure once, and returns whether an account remains. Concurrent-429 correctness is pinned by a dedicated test (4 batches, 2 accounts, all-429 → exactly two failures, one per account).

### Exhaustion is drain-then-throw, not throw-from-worker

`judgeBatch` returns a third `{ status: "exhausted" }` arm; `judgePosts` throws only after `Promise.all` joins, with `[...state.failures]`. This deletes the artifact's accepted trade-off (incomplete failure record, sibling mutation after early rejection) for ~5 lines. `judgePost` runs sequentially in the reassembly loop after the join and throws directly.

### Exhaustion error is a tagged `Error`, not a class

Zero classes exist in `src/` or `tests/`. `ROTATION_EXHAUSTED` name tag + `rotationExhausted(failures)` factory + `isRotationExhausted(error)` type guard match the codebase's idiom.

### `AccountFailure` lives in `src/types.ts` with a `reason` string

`{ account: number; baseUrl: string; reason: string }` — `account` is 1-based (concurrent workers can record out of order, so the record carries the index), and `reason` covers both `"HTTP 429"` and transport messages. `src/types.ts` because `email.ts` consumes it; importing from `judge.ts` would couple email → judge.

### 5xx proof uses real sleep, one retry

No `mock.timers` anywhere in `tests/`; introducing it for one test is a new idiom for zero gain. The new 5xx test does 500 → success with one ~1s sleep, asserting both calls carried account 1's key. Net suite time drops ~9s: the two old 429-backoff tests (real 1s+2s and 1s+2s+4s sleeps) are replaced by no-sleep rotation proofs.

### Test mocks branch on request URL, never call order

With more than one batch in flight, worker interleaving makes call-order branching flaky. Each account gets a distinct `baseUrl`, so mocks branch on the URL and assertions check pointer monotonicity (every call after the first account-2 call carries account 2's key), not exact sequences.

### Config flip lands with the mechanics, trio removal lands with the probe

`ENV_NAMES` gains `llmAccounts` in Phase 1 (the parser references it) and the trio survives until Phase 4 because `scripts/probe-judge.ts` still reads it. Every phase leaves the tree typecheck-clean. `resolveJudgeConfig` returns `readonly LlmAccount[]` (validated, non-empty) in Phase 2, so `src/index.ts`'s call site compiles unchanged.

## Phase 1: Rotation types + LLM_ACCOUNTS parser

### Overview

Foundation: additive types and the fail-visible pool parser, with no behavior change to existing paths. Depends on nothing; can run in parallel with nothing (foundation). `ENV_NAMES` gains `llmAccounts` here because the parser references it.

### Changes Required:

#### 1. src/types.ts

**File**: src/types.ts
**Changes**: MODIFY — add the `AccountFailure` interface consumed later by judge logging and the exhaustion email. Appended at the end of the file.

```ts
/** One LLM account's failure, recorded when rotation moves off it. */
export interface AccountFailure {
  /** 1-based position in the LLM_ACCOUNTS pool. */
  account: number;
  /** The account's chat-completions base URL. */
  baseUrl: string;
  /** Human-readable cause: "HTTP 429" or the transport error message. */
  reason: string;
}
```
#### 1. src/config.ts

**File**: src/config.ts
**Changes**: MODIFY — `ENV_NAMES` gains `llmAccounts: "LLM_ACCOUNTS"` (the parser needs the key; the trio stays until Phase 4). The registry block becomes:

```ts
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  llmBaseUrl: "LLM_BASE_URL",
  llmApiKey: "LLM_API_KEY",
  llmModel: "LLM_MODEL",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;
```

#### 1. src/judge.ts

**File**: src/judge.ts
**Changes**: MODIFY — add `LlmAccount`, `RotationState`, the tagged exhaustion error (name constant, factory, type guard), and `parseLlmAccounts` with per-item fail-visible validation modeled on `src/config-file.ts:87-152`. Existing `resolveJudgeConfig` untouched in this phase.

First, the types import gains `AccountFailure` (verbatimModuleSyntax — type-only):

```ts
import type { AccountFailure, JudgeVerdict, Post } from "./types.js";
```

Then, added directly below the existing `JudgeConfig` interface:

```ts
/** One LLM account from the LLM_ACCOUNTS pool (ordered; index 0 is tried first). */
export interface LlmAccount {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Run-level rotation state, owned by judgePosts and shared by reference with
 * every worker — the same closure-shared mutable pattern as the `next` batch
 * cursor (read and advance with no await between). `index` only moves
 * forward; `failures` records every account rotation left behind.
 */
export interface RotationState {
  readonly accounts: readonly LlmAccount[];
  index: number;
  readonly failures: AccountFailure[];
}

/** Name tag for the pool-exhausted error; test with isRotationExhausted. */
export const ROTATION_EXHAUSTED = "RotationExhaustedError";

/** The tagged error judgePosts throws when every LLM_ACCOUNTS entry failed. */
export interface RotationExhausted extends Error {
  name: typeof ROTATION_EXHAUSTED;
  /** One entry per account that failed, in the order rotation left them. */
  failures: AccountFailure[];
}

/** Build a pool-exhausted error carrying the per-account record. */
export function rotationExhausted(failures: readonly AccountFailure[]): RotationExhausted {
  const error = new Error(
    `judge: all ${failures.length} LLM_ACCOUNTS account(s) exhausted — ${failures
      .map((f) => `account ${f.account} (${f.baseUrl}): ${f.reason}`)
      .join("; ")}`,
  ) as RotationExhausted;
  error.name = ROTATION_EXHAUSTED;
  error.failures = [...failures];
  return error;
}

/** Type guard for the pool-exhausted error (this codebase has no classes). */
export function isRotationExhausted(error: unknown): error is RotationExhausted {
  return error instanceof Error && error.name === ROTATION_EXHAUSTED;
}

/**
 * Parse the LLM_ACCOUNTS pool from an environment record. The value is a
 * JSON array of {baseUrl, apiKey, model} objects, tried in order. Throws
 * with an error naming LLM_ACCOUNTS when the variable is missing, blank,
 * unparsable, not an array, empty, or when any item fails a rule — modeled
 * on the fail-visible rules in src/config-file.ts.
 */
export function parseLlmAccounts(env: Record<string, string | undefined>): LlmAccount[] {
  const raw = env[ENV_NAMES.llmAccounts]?.trim();
  if (!raw) {
    throw new Error(`judge: missing required environment variable: ${ENV_NAMES.llmAccounts}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`judge: ${ENV_NAMES.llmAccounts} is not valid JSON: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`judge: ${ENV_NAMES.llmAccounts} must be a JSON array of account objects`);
  }
  if (parsed.length === 0) {
    throw new Error(`judge: ${ENV_NAMES.llmAccounts} must not be empty`);
  }

  const accounts: LlmAccount[] = [];
  for (const [i, item] of parsed.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(
        `judge: ${ENV_NAMES.llmAccounts}[${i}] must be an object with "baseUrl", "apiKey", and "model"`,
      );
    }
    const record = item as Record<string, unknown>;
    const read = (key: string): string => {
      const value = record[key];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`judge: ${ENV_NAMES.llmAccounts}[${i}].${key} must be a non-empty string`);
      }
      return value.trim();
    };
    accounts.push({ baseUrl: read("baseUrl"), apiKey: read("apiKey"), model: read("model") });
  }
  return accounts;
}
```
#### 1. tests/judge.test.ts

**File**: tests/judge.test.ts
**Changes**: MODIFY — add a `parseLlmAccounts` describe block: valid array, missing/blank env, malformed JSON, non-array, empty array, non-object item, blank field — every error naming `LLM_ACCOUNTS`. The import list gains `parseLlmAccounts`:

```ts
import {
  type JudgeConfig,
  judgePost,
  judgePosts,
  parseBulkVerdicts,
  parseLlmAccounts,
  parseVerdict,
  resolveJudgeConfig,
} from "../src/judge.js";
```

New describe block (placed after the existing `resolveJudgeConfig` describe):

```ts
describe("parseLlmAccounts", () => {
  it("parses a valid pool in order, trimming fields", () => {
    const accounts = parseLlmAccounts({
      LLM_ACCOUNTS: JSON.stringify([
        { baseUrl: " https://api.a.com/v1 ", apiKey: " key-a ", model: " model-a " },
      ]),
    });
    assert.deepEqual(accounts, [
      { baseUrl: "https://api.a.com/v1", apiKey: "key-a", model: "model-a" },
    ]);
  });

  it("throws naming LLM_ACCOUNTS when the variable is missing or blank", () => {
    assert.throws(() => parseLlmAccounts({}), /LLM_ACCOUNTS/);
    assert.throws(() => parseLlmAccounts({ LLM_ACCOUNTS: "   " }), /LLM_ACCOUNTS/);
  });

  it("throws with the parser message when the JSON is malformed", () => {
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: "{not json" }),
      /LLM_ACCOUNTS.*not valid JSON/s,
    );
  });

  it("throws naming LLM_ACCOUNTS when the value is not an array or is empty", () => {
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: JSON.stringify({ baseUrl: "x" }) }),
      /LLM_ACCOUNTS.*must be a JSON array/s,
    );
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: "[]" }),
      /LLM_ACCOUNTS.*must not be empty/s,
    );
  });

  it("throws naming the index for a non-object item", () => {
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: JSON.stringify(["nope"]) }),
      /LLM_ACCOUNTS\[0\]/,
    );
  });

  it("throws naming the index and field for a missing or blank field", () => {
    const missing = JSON.stringify([{ baseUrl: "https://a", apiKey: "k" }]);
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: missing }),
      /LLM_ACCOUNTS\[0\]\.model/,
    );
    const blank = JSON.stringify([{ baseUrl: "https://a", apiKey: "  ", model: "m" }]);
    assert.throws(
      () => parseLlmAccounts({ LLM_ACCOUNTS: blank }),
      /LLM_ACCOUNTS\[0\]\.apiKey/,
    );
  });
});
```
### Success Criteria:

#### Automated Verification:
- [x] Parser tests pass: `npx tsx --test tests/judge.test.ts`
- [x] Scoped lint clean: `npx biome check src/types.ts src/config.ts src/judge.ts tests/judge.test.ts`
- [x] Type checking passes: `npm run typecheck`

#### Manual Verification:
- [x] `grep -n "llmAccounts" src/config.ts` shows `llmAccounts: "LLM_ACCOUNTS"` with the trio still present
- [x] `grep -n "class " src/judge.ts src/types.ts` returns nothing (no-class idiom held)

## Phase 2: Rotation mechanics + config flip

### Overview

The core: compare-and-set rotation, 429 branches in both retry loops, drain-then-throw exhaustion, and the resolver flip to `LLM_ACCOUNTS`. Depends on Phase 1; can run in parallel with nothing.

### Changes Required:

#### 2. src/judge.ts

**File**: src/judge.ts
**Changes**: MODIFY — `rotateOnRateLimit` CAS guard; `judgeBatch` per-attempt account read before the first await, 429 branch before the shared retryable check, `model` un-hoisted into the loop, `exhausted` outcome arm, 429 removed from `RETRYABLE_STATUSES`; `judgePost` 429 branch + direct throw; `judgePosts` owns `RotationState`, workers share it, throws the tagged error after the join; `resolveJudgeConfig` delegates to `parseLlmAccounts`; `judgePosts` signature takes `readonly LlmAccount[]`.

(0) Module-header docstring — full replacement of the existing header block (the old "429, 5xx retried with bounded backoff" sentence is gone):

```ts
/**
 * LLM relevance and location judge for candidate Threads posts (FRD #4, #5, D3).
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
 * HTTP 429 is account-local: the judge rotates to the next LLM_ACCOUNTS
 * account with no backoff wait. A 5xx is retried on the same account with
 * bounded backoff before the batch is deferred; a transport error defers
 * immediately without rotating. When every account is exhausted the run
 * throws the tagged RotationExhausted error (one exhaustion email, exit 1 —
 * surfaced by index.ts). Batches drain through a bounded pool of
 * JUDGE_CONCURRENCY workers and reassemble in input order, so the worst
 * case is ceil(N/BATCH_SIZE) concurrent calls plus at most BATCH_SIZE
 * sequential fallbacks per affected batch. A post that fails both stages
 * is skipped for this run, logged visibly, and omitted from state (D3: it
 * stays unseen and retries next run).
 */
```

(1) The comment above JUDGE_CONCURRENCY is rewritten (429 backoff no longer exists):

```ts
/**
 * Bulk calls in flight at once. Ships at 4 — the agreed floor, low enough
 * for the lowest documented Z.AI tier. Phase 0's ramp reads the real
 * ceiling; raise this to that reading. Z.AI publishes no number and
 * adjusts the limit dynamically, so the account rotation on 429 below is
 * what keeps a stale or optimistic value from costing a run its digest.
 */
const JUDGE_CONCURRENCY = 4;
```

(2) RETRYABLE_STATUSES — 429 removed:

```ts
/**
 * HTTP statuses worth retrying on the SAME account: the endpoint is alive
 * but busy. 429 is handled separately — it is account-local and rotates to
 * the next account instead of waiting.
 */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
```

(3) resolveJudgeConfig — trio read replaced by delegation; the JudgeConfig interface (src/judge.ts:55-59) is DELETED (LlmAccount from Phase 1 replaces it structurally):

```ts
/**
 * Resolve the LLM account pool from the environment dictionary.
 * Delegates to parseLlmAccounts — throws naming LLM_ACCOUNTS when the
 * variable is missing, blank, unparsable, or fails any per-account rule.
 */
export function resolveJudgeConfig(
  env: Record<string, string | undefined> = process.env,
): readonly LlmAccount[] {
  return parseLlmAccounts(env);
}
```

(4) BatchOutcome gains the exhausted arm:

```ts
/**
 * Result of one bulk call: a parsed container, no usable answer, or a pool
 * exhausted mid-batch (every account rate-limited; judgePosts throws).
 */
type BatchOutcome =
  | { status: "answered"; verdicts: Map<string, JudgeVerdict> }
  | { status: "unanswered" }
  | { status: "exhausted" };
```

(5) New function, placed above judgeBatch:

```ts
/**
 * Advance the pool pointer past a rate-limited account. Compare-and-set:
 * the caller passes the DISPATCH-TIME index (the account its call actually
 * hit), so four workers that all 429'd on account 1 produce exactly one
 * advance and one failure record — the later completers no-op because the
 * pointer already moved. Without this guard the pointer would advance once
 * per 429 and skip accounts nobody has tried. Returns true when an account
 * remains to try.
 */
function rotateOnRateLimit(state: RotationState, failedIndex: number): boolean {
  if (state.index === failedIndex) {
    const failed = state.accounts[failedIndex];
    if (failed !== undefined) {
      state.failures.push({
        account: failedIndex + 1,
        baseUrl: failed.baseUrl,
        reason: "HTTP 429",
      });
    }
    state.index += 1;
  }
  return state.index < state.accounts.length;
}
```

(6) judgeBatch — full replacement. The dispatch-time `attemptIndex` (read at loop top, before the first await) is what the CAS consumes; the payload is built per attempt because the model is per-account:

```ts
/**
 * One bulk call for up to BATCH_SIZE posts against the current account.
 *
 * HTTP 429 is account-local: the failure is recorded, the pool pointer
 * rotates to the next account (compare-and-set — concurrent 429s advance
 * once), and the same call retries there with NO backoff wait. When the
 * pool is empty the batch reports "exhausted" and judgePosts throws after
 * the join.
 *
 * A 5xx keeps the existing bounded same-account backoff (1s, 2s, 4s): the
 * endpoint is alive but busy, so seconds cost less than a deferred batch.
 * A transport error still defers immediately — no retry, no fallback, no
 * rotation: a rate limit says this account is spent, a dead socket says
 * the network path is broken.
 *
 * Returns "answered" with whatever the container parsed into (including an
 * empty Map — a parse miss is a model failure, so the caller falls back per
 * item), "unanswered" on a spent budget / non-retryable status / transport
 * error, or "exhausted" when rotation ran out of accounts.
 */
async function judgeBatch(
  batch: readonly Post[],
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch,
  batchIndex: number,
): Promise<BatchOutcome> {
  // Built once, outside the retry loop: the prompt does not change between
  // attempts. The account (model + key + base URL) is read fresh per
  // attempt below, because a 429 rotation swaps it mid-loop.
  const messages = buildBulkMessages(batch, keywords);

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    // Pointer read at the top of every attempt, BEFORE the first await:
    // rotation advances synchronously inside the 429 branch, so nothing can
    // interleave between this read and the fetch dispatch (same discipline
    // as the next cursor in judgePosts). attemptIndex is the dispatch-time
    // observation — the account this call actually hit — and is what the
    // compare-and-set consumes when the 429 comes back.
    const attemptIndex = state.index;
    const account = state.accounts[attemptIndex];
    if (account === undefined) {
      return { status: "exhausted" };
    }
    const payload = {
      model: account.model,
      messages,
      temperature: 0,
      // Rider on the bulk path ONLY: the single-post fallback call keeps its
      // original payload shape (design scope boundary).
      response_format: { type: "json_object" },
    };
    try {
      const response = await fetchFn(normalizeEndpoint(account.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${account.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        // Account spent: record, rotate, retry the same call on the next
        // account immediately. The CAS consumes attemptIndex — the account
        // this call actually hit — so a worker whose account was already
        // rotated away by a peer is a no-op, not a second advance. The
        // rotation does not spend the backoff budget (attempt is rewound),
        // because rotation replaces the wait.
        if (response.status === 429) {
          const rotated = rotateOnRateLimit(state, attemptIndex);
          console.warn(
            `judge: batch ${batchIndex} account ${attemptIndex + 1} HTTP 429 — ${
              rotated ? `rotating to account ${state.index + 1}` : "no account left"
            }`,
          );
          if (!rotated) {
            return { status: "exhausted" };
          }
          attempt -= 1;
          continue;
        }
        // Busy upstream, same account, bounded backoff; defer once spent.
        if (RETRYABLE_STATUSES.has(response.status) && attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 0;
          console.warn(
            \`judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) HTTP ${response.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})\`,
          );
          await sleep(delay);
          continue;
        }
        console.warn(
          \`judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) HTTP ${response.status} ${response.statusText} — skipping batch (posts stay unseen and retry next run)\`,
        );
        return { status: "unanswered" };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string") {
        console.warn(
          \`judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) missing message content — skipping batch (posts stay unseen and retry next run)\`,
        );
        return { status: "unanswered" };
      }

      const verdicts = parseBulkVerdicts(rawContent);
      if (verdicts === null) {
        console.warn(
          \`judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) failed to parse bulk verdicts: ${rawContent.slice(0, 100)} — falling back to single-post calls (up to 2 attempts per post)\`,
        );
        return { status: "answered", verdicts: new Map() };
      }
      return { status: "answered", verdicts };
    } catch (error) {
      // A transport error still defers immediately — no retry, no fallback,
      // no rotation. A dead socket predicts a dead fallback; it is not an
      // account problem, so the pointer does not move.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        \`judge: batch ${batchIndex} account ${attemptIndex + 1} (${batch.length} posts) request error: ${message} — skipping batch (posts stay unseen and retry next run)\`,
      );
      return { status: "unanswered" };
    }
  }
  // Unreachable: every branch above returns. Present so the function has a
  // single exit type and a future early-break cannot fall through.
  return { status: "unanswered" };
}
```

(7) judgePost — full replacement:

```ts
/**
 * Judge a single post with up to 1 retry on HTTP or parsing failure.
 * Returns the verdict on success, or null if both attempts fail.
 *
 * HTTP 429 rotates the pool pointer exactly like judgeBatch (no backoff);
 * the rotation does not spend a fallback attempt. Running out of accounts
 * throws the tagged RotationExhausted error — judgePost runs sequentially
 * in judgePosts' reassembly loop (after the join), so the throw surfaces
 * directly. Other failures keep the original status-agnostic retry.
 */
export async function judgePost(
  post: Post,
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<JudgeVerdict | null> {
  const messages = buildMessages(post, keywords);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptIndex = state.index;
    const account = state.accounts[attemptIndex];
    if (account === undefined) {
      throw rotationExhausted(state.failures);
    }
    const payload = {
      model: account.model,
      messages,
      temperature: 0,
    };
    try {
      const response = await fetchFn(normalizeEndpoint(account.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${account.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const rotated = rotateOnRateLimit(state, attemptIndex);
          console.warn(
            `judge: post ${post.id} account ${attemptIndex + 1} HTTP 429 — ${
              rotated ? `rotating to account ${state.index + 1}` : "no account left"
            }`,
          );
          if (!rotated) {
            throw rotationExhausted(state.failures);
          }
          attempt -= 1;
          continue;
        }
        console.warn(
          \`judge: post ${post.id} attempt ${attempt}/2 account ${attemptIndex + 1} HTTP ${response.status} ${response.statusText}\`,
        );
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const rawContent = data.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string") {
        console.warn(
          \`judge: post ${post.id} attempt ${attempt}/2 account ${attemptIndex + 1} missing message content\`,
        );
        continue;
      }

      const verdict = parseVerdict(rawContent);
      if (verdict !== null) {
        return verdict;
      }

      console.warn(
        \`judge: post ${post.id} attempt ${attempt}/2 account ${attemptIndex + 1} failed to parse JSON verdict: ${rawContent.slice(0, 100)}\`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        \`judge: post ${post.id} attempt ${attempt}/2 account ${attemptIndex + 1} request error: ${msg}\`,
      );
    }
  }

  return null;
}
```

(8) judgePosts — full replacement:

```ts
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
 * Batches drain through a bounded pool of JUDGE_CONCURRENCY workers, and
 * each result slot is indexed by batch number so the output reassembles in
 * input order even when batches finish out of order. A batch the endpoint
 * did not answer is deferred whole (see judgeBatch): its posts stay unseen
 * and retry on the next run.
 *
 * Rotation state lives in this frame (run-sticky): after a failover every
 * later call in the run uses the new account, and the next run starts on
 * account 1 again. The pointer and failure list are shared by reference
 * with every worker exactly like the next cursor below — all reads and
 * advances are synchronous, so four workers stay coherent without locks.
 */
export async function judgePosts(
  candidates: readonly Post[],
  accounts: readonly LlmAccount[],
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<JudgeBatchResult> {
  const state: RotationState = { accounts, index: 0, failures: [] };

  const batches: Post[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  // One result slot per batch, filled by whichever worker takes it. Indexing
  // by slot (not pushing) is what keeps the output in input order once the
  // batches finish out of order.
  const outcomes: Array<BatchOutcome | undefined> = Array.from({ length: batches.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= batches.length) return;
      const batch = batches[index];
      if (batch === undefined) continue;
      outcomes[index] = await judgeBatch(batch, state, keywords, fetchFn, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JUDGE_CONCURRENCY, batches.length) }, worker));

  // Drain-then-throw: the join above let every in-flight batch finish, so
  // the failure record is complete. Throwing here (not inside a worker)
  // keeps sibling workers from mutating the record after the snapshot and
  // leaves the unjudged posts unseen — index.ts turns the error into the
  // exhaustion email and exit 1; state is never reached.
  if (outcomes.some((outcome) => outcome?.status === "exhausted")) {
    throw rotationExhausted(state.failures);
  }

  const judged: JudgedPost[] = [];
  const skippedPostIds: string[] = [];
  for (const [index, batch] of batches.entries()) {
    const outcome = outcomes[index];
    if (outcome === undefined) continue;
    if (outcome.status !== "answered") {
      // unanswered (normal defer) or exhausted (already thrown above — kept
      // for type safety): the batch's posts stay unseen.
      for (const post of batch) skippedPostIds.push(post.id);
      console.warn(
        `judge: skipped batch ${index} of ${batch.length} post(s) after an unanswered bulk call; they stay unseen and retry next run`,
      );
      continue;
    }
    for (const post of batch) {
      const fromBulk = outcome.verdicts.get(post.id);
      const verdict = fromBulk ?? (await judgePost(post, state, keywords, fetchFn));
      if (verdict !== null) {
        judged.push({ post, verdict });
      } else {
        skippedPostIds.push(post.id);
        console.warn(`judge: skipped post ${post.id} after bulk miss and retry`);
      }
    }
  }
  return { judged, skippedPostIds };
}
```
#### 2. tests/judge.test.ts

**File**: tests/judge.test.ts
**Changes**: MODIFY — the two 429-backoff tests ("retries a 429 and succeeds within the backoff budget", "retries a 429 until the budget is spent, then skips the batch") are replaced by rotation proofs. Seven new tests, mocks branching on request URL (distinct hosts per account), never call order.

Import block rewritten (JudgeConfig gone; the HEAD types import kept):

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRotationExhausted,
  judgePost,
  judgePosts,
  type LlmAccount,
  parseBulkVerdicts,
  parseLlmAccounts,
  parseVerdict,
  type RotationExhausted,
  type RotationState,
  resolveJudgeConfig,
} from "../src/judge.js";
import type { Post } from "../src/types.js";
```

Module-scope helpers — placed directly after the KEYWORDS constant. The pure helpers id19, bulkPost, and bulkContent MOVE here from inside describe("judgePosts") (they close over nothing; their describe-local copies are deleted). samplePost stays describe-local to judgePost. The sampleConfig constants in both describes are deleted — every existing test swaps sampleConfig for singleAccount (judgePosts) or freshState(singleAccount) (judgePost):

```ts
/** A healthy one-account pool for tests that never touch rotation. */
const singleAccount: LlmAccount[] = [
  { baseUrl: "https://mock.api/v1", apiKey: "test-key", model: "test-model" },
];

/** Two-account pool with distinct hosts — tests branch on URL, never call order. */
function twoAccounts(): LlmAccount[] {
  return [
    { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
    { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
  ];
}

/** Three-account pool — the CAS test needs a third rung so a vacuous
 * guard (which cascades the pool through one worker) is exposed. */
function threeAccounts(): LlmAccount[] {
  return [
    { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
    { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
    { baseUrl: "https://account-three.api/v1", apiKey: "key-3", model: "model-3" },
  ];
}

/** Fresh run-level state for direct judgePost calls. */
function freshState(accounts: LlmAccount[]): RotationState {
  return { accounts, index: 0, failures: [] };
}

/**
 * Fetch that records "host Authorization" per call, always 429s account-one
 * and bulk-answers account-two by echoing the ids in the prompt. Tests
 * branch on the URL (distinct host per account), never on call order.
 */
function accountTwoAnswering(auths: string[]): typeof fetch {
  return (async (url: unknown, options?: unknown): Promise<Response> => {
    const headers = (options as { headers: Record<string, string> }).headers;
    auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
    if (String(url).includes("account-one")) {
      return new Response("Too Many Requests", { status: 429 });
    }
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
      (match) => match[1] ?? "",
    );
    return ok(bulkContent(ids));
  }) as unknown as typeof fetch;
}
```

resolveJudgeConfig describe rewritten:

```ts
describe("resolveJudgeConfig", () => {
  it("returns the parsed account pool from LLM_ACCOUNTS", () => {
    const accounts = resolveJudgeConfig({
      LLM_ACCOUNTS: JSON.stringify([
        { baseUrl: "https://api.openai.com/v1", apiKey: "secret-key", model: "gpt-4o-mini" },
      ]),
    });
    assert.deepEqual(accounts, [
      { baseUrl: "https://api.openai.com/v1", apiKey: "secret-key", model: "gpt-4o-mini" },
    ]);
  });

  it("throws naming LLM_ACCOUNTS when the variable is missing", () => {
    assert.throws(() => resolveJudgeConfig({}), /LLM_ACCOUNTS/);
  });
});
```

Two tests ADDED inside describe("judgePost") (samplePost is this describe's local):

```ts
  it("judgePost rotates on a 429 without spending a fallback attempt", async () => {
    const state = freshState(twoAccounts());
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (String(url).includes("account-one")) {
        return new Response("Too Many Requests", { status: 429 });
      }
      return ok('{"relevant": true, "locationOk": true}');
    }) as unknown as typeof fetch;
    const verdict = await judgePost(samplePost, state, KEYWORDS, mockFetch);
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
    assert.deepEqual(state.failures.map((f) => f.account), [1]);
    assert.equal(state.index, 1);
    assert.equal(auths.length, 2);
  });

  it("judgePost throws the tagged error when rotation runs out mid-fallback", async () => {
    const state = freshState(twoAccounts());
    const mockFetch = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    await assert.rejects(
      () => judgePost(samplePost, state, KEYWORDS, mockFetch),
      (error: unknown) => isRotationExhausted(error),
    );
    assert.deepEqual(state.failures.map((f) => f.account), [1, 2]);
  });
```

Five tests ADDED inside describe("judgePosts"):

```ts
  it("rotates to account 2 on the first 429 with no backoff wait", async () => {
    const posts = [bulkPost(id19(1))];
    const auths: string[] = [];
    const started = Date.now();
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, accountTwoAnswering(auths));
    const elapsed = Date.now() - started;
    assert.equal(result.judged.length, 1);
    assert.match(auths[0] ?? "", /account-one\.api .*key-1$/);
    assert.match(auths[1] ?? "", /account-two\.api .*key-2$/);
    assert.ok(elapsed < 500, `rotation must not sleep — took ${elapsed}ms`);
  });

  it("keeps the sticky pointer across the fallback phase", async () => {
    const a = bulkPost(id19(1));
    const b = { ...bulkPost(id19(2)), text: "Second post text" };
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (String(url).includes("account-one")) {
        return new Response("Too Many Requests", { status: 429 });
      }
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
        response_format?: unknown;
      };
      // Bulk calls answer the FIRST listed id only, so the second post falls
      // back; a single-post call (no response_format rider) answers itself.
      if (body.response_format === undefined) {
        return ok('{"relevant": true, "locationOk": true}');
      }
      const ids = [...(body.messages[1]?.content ?? "").matchAll(/id (\d+) by @/g)].map(
        (match) => match[1] ?? "",
      );
      return ok(bulkContent(ids.slice(0, 1)));
    }) as unknown as typeof fetch;
    const result = await judgePosts([a, b], twoAccounts(), KEYWORDS, mockFetch);
    assert.equal(result.judged.length, 2);
    assert.equal(auths.length, 3); // 429 call, bulk call, fallback call
    assert.match(auths[0] ?? "", /key-1$/);
    assert.ok(auths.slice(1).every((auth) => auth.includes("key-2")));
  });

  it("retries a 5xx on the same account with backoff, never rotating", async () => {
    const posts = [bulkPost(id19(1))];
    const auths: string[] = [];
    let calls = 0;
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      calls += 1;
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      if (calls === 1) {
        return new Response("Bad Gateway", { status: 502 });
      }
      return ok(bulkContent(posts.map((p) => p.id)));
    }) as unknown as typeof fetch;
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch);
    assert.equal(calls, 2); // one 502 + one same-account retry (~1s real sleep)
    assert.equal(result.judged.length, 1);
    assert.ok(auths.every((auth) => auth.includes("key-1"))); // a 5xx never rotates
  });

  it("defers a batch on a transport error without rotating", async () => {
    const posts = [bulkPost(id19(1))];
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const result = await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch);
    assert.equal(result.judged.length, 0);
    assert.deepEqual(result.skippedPostIds, posts.map((p) => p.id));
    assert.equal(auths.length, 1); // zero retries
    assert.match(auths[0] ?? "", /key-1$/); // the pointer never moved
  });

  it("advances the pointer exactly once per account under concurrent 429s", async () => {
    const posts = Array.from({ length: 40 }, (_, i) => bulkPost(id19(i + 1))); // 4 batches
    const auths: string[] = [];
    const mockFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      const headers = (options as { headers: Record<string, string> }).headers;
      auths.push(`${new URL(String(url)).host} ${String(headers.Authorization)}`);
      return new Response("Too Many Requests", { status: 429 });
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await judgePosts(posts, threeAccounts(), KEYWORDS, mockFetch);
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    const failures = (caught as RotationExhausted).failures;
    // The compare-and-set proof: exactly one failure per account, in pool
    // order.
    assert.deepEqual(failures.map((f) => f.account), [1, 2, 3]);
    assert.ok(failures.every((f) => f.reason === "HTTP 429"));
    // Every account was tried by MORE THAN ONE worker: a vacuous guard
    // (fresh index read beside the compare) lets the first completer
    // cascade the whole pool alone — one key-2 and one key-3 call — while
    // a true compare-and-set sends every parked worker forward together.
    const count = (key: string): number => auths.filter((auth) => auth.includes(key)).length;
    assert.ok(count("key-2") >= 2, `account 2 dispatched ${count("key-2")} time(s)`);
    assert.ok(count("key-3") >= 2, `account 3 dispatched ${count("key-3")} time(s)`);
    // Pointer monotonicity: no call on a lower account's key after the
    // first call on a higher one.
    const firstKey2 = auths.findIndex((auth) => auth.includes("key-2"));
    const lastKey1 = auths.map((auth) => auth.includes("key-1")).lastIndexOf(true);
    assert.ok(firstKey2 > lastKey1);
    const firstKey3 = auths.findIndex((auth) => auth.includes("key-3"));
    const lastKey2 = auths.map((auth) => auth.includes("key-2")).lastIndexOf(true);
    assert.ok(firstKey3 > lastKey2);
  });
```
### Success Criteria:

#### Automated Verification:
- [x] Rotation proofs pass: `npx tsx --test tests/judge.test.ts`
- [x] Scoped lint clean: `npx biome check src/judge.ts tests/judge.test.ts`
- [x] Type checking passes: `npm run typecheck`
- [x] 429 lives only in the rotation branches: `grep -n "429" src/judge.ts`
- [x] No fake timers introduced: `grep -rn "mock.timers" tests/` returns nothing

#### Manual Verification:
- [x] `grep -rn "JudgeConfig" src/ tests/` returns nothing (type fully replaced by LlmAccount)
- [x] `grep -n "account " src/judge.ts` shows batch and post warns naming the 1-based account

## Phase 3: Exhaustion email

### Overview

One alarm email when the pool dies: builder + sender over the `sendText` spine, wired into the existing `main().catch`. Depends on Phase 2; can run in parallel with Phase 4.

### Changes Required:

#### 3. src/email.ts

**File**: src/email.ts
**Changes**: MODIFY — `buildExhaustionText(failures)` and `sendExhaustionEmail(failures, config, transport?)` mirroring `sendDigest` (`src/email.ts:122-153`) over `sendText` (`:84-113`).

Import merge (HEAD `import type { Post } from "./types.js";` becomes):

```ts
import type { AccountFailure, Post } from "./types.js";
```

Appended after sendDigest (end of file):

```ts
/**
 * Build the plain-text body for the judge-pool exhaustion alarm.
 * Lists every account with its recorded failure, in pool order. Returns
 * null when the failure list is empty (no alarm to send).
 */
export function buildExhaustionText(failures: readonly AccountFailure[]): string | null {
  if (failures.length === 0) return null;
  const lines = failures.map(
    (failure, index) =>
      `${index + 1}. account ${failure.account} (${failure.baseUrl}) — ${failure.reason}`,
  );
  return [
    "The LLM judge pool is exhausted — every LLM_ACCOUNTS account failed.",
    "",
    ...lines,
    "",
    "No digest was sent and no posts were marked seen; they retry next run.",
    "Add a working account to the LLM_ACCOUNTS secret and re-run.",
  ].join("\n");
}

/**
 * Send the judge-pool exhaustion alarm through the same Gmail transport as
 * the digest. Returns the message id when the transport reports one, or
 * undefined when there is nothing to send. Throws fail-visible when
 * nodemailer fails to deliver (sendText wraps the transport error).
 */
export async function sendExhaustionEmail(
  failures: readonly AccountFailure[],
  config: EmailConfig,
  transport?: Transporter,
): Promise<string | undefined> {
  const text = buildExhaustionText(failures);
  if (text === null) return undefined;
  const plural = failures.length === 1 ? "" : "s";
  const subject = `LLM judge pool exhausted (${failures.length} account${plural} failed)`;
  const messageId = await sendText(subject, text, config, transport);
  console.log(`email: sent exhaustion alarm for ${failures.length} account(s)`);
  return messageId;
}
```
#### 3. src/index.ts

**File**: src/index.ts
**Changes**: MODIFY — `main().catch` (`src/index.ts:151-155`) gains an `isRotationExhausted` branch: resolve email config, send the exhaustion email best-effort (a failed notification logs loudly but never masks exit 1), then exit 1.

Import merges (HEAD: `import { resolveEmailConfig, sendDigest } from "./email.js";` and `import { judgePosts, resolveJudgeConfig } from "./judge.js";`):

```ts
import { resolveEmailConfig, sendDigest, sendExhaustionEmail } from "./email.js";
```

```ts
import { isRotationExhausted, judgePosts, resolveJudgeConfig } from "./judge.js";
```

main().catch — full replacement:

```ts
main().catch(async (error: unknown) => {
  // Pool exhausted: one alarm email, then the standard failed-run exit.
  // The email is best-effort — a broken GMAIL_* configuration must not mask
  // the exit code the run already earned. State was never reached (the
  // throw happened in the judge stage), so no post is marked seen (D3, D8).
  if (isRotationExhausted(error)) {
    console.error(`watch: FAILED — ${error.message}`);
    try {
      await sendExhaustionEmail(error.failures, resolveEmailConfig(process.env));
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message : String(emailError);
      console.warn(`email: exhaustion alarm not sent — ${message}`);
    }
    process.exit(1);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`watch: FAILED — ${message}`);
  process.exit(1);
});
```
#### 3. tests/email.test.ts

**File**: tests/email.test.ts
**Changes**: MODIFY — exhaustion builder + sender tests using the fake-transporter capture idioms (`tests/email.test.ts:195-234`).

Import block merged with HEAD's canonical order (`type EmailConfig` first, then alphabetical; type imports per module merged):

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import {
  type EmailConfig,
  buildDigest,
  buildExhaustionText,
  buildSubject,
  resolveEmailConfig,
  sendDigest,
  sendExhaustionEmail,
} from "../src/email.js";
import type { AccountFailure, Post } from "../src/types.js";
```

New describes appended at the end of the file:

```ts
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
    let captured: { subject: string; text: string } | null = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        captured = options as { subject: string; text: string };
        return { messageId: "msg-exh" };
      },
    } as unknown as Transporter;

    const messageId = await sendExhaustionEmail(failures, sampleConfig, mockTransport);
    assert.equal(messageId, "msg-exh");
    assert.ok(captured);
    assert.match(captured.subject, /judge pool exhausted/);
    assert.ok(captured.text.includes("account 1 (https://api.a.com/v1) — HTTP 429"));
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
});
```
### Success Criteria:

#### Automated Verification:
- [x] Email tests pass: `npx tsx --test tests/email.test.ts`
- [x] Judge tests still pass: `npx tsx --test tests/judge.test.ts`
- [x] Scoped lint clean: `npx biome check src/email.ts src/index.ts tests/email.test.ts`
- [x] Type checking passes: `npm run typecheck`

#### Manual Verification:
- [x] `grep -n "isRotationExhausted" src/index.ts` shows the alarm branch before the generic exit
- [x] The alarm branch exits 1 on BOTH paths (email sent or email failed): process.exit(1) sits outside the try/catch
- [x] `grep -n 'from "./judge.js"' src/email.ts` returns nothing (no email→judge coupling)

## Phase 4: Probe + workflow + docs + trio removal

### Overview

External wiring swap and the old trio's exit. Depends on Phase 2; can run in parallel with Phase 3.

### Changes Required:

#### 4. scripts/probe-judge.ts

**File**: scripts/probe-judge.ts
**Changes**: MODIFY — usage comment (`:18`), env read (`:168-176`) via `resolveJudgeConfig` with a guarded `accounts[0]`, and `timed`/`rampLevel`/`findConcurrencyCeiling` take an `LlmAccount` instead of `baseUrl`+`apiKey`.

(1) Usage doc comment (line 18) replaced:

```ts
 *   LLM_ACCOUNTS='[{"baseUrl":"https://api.example.com/v1","apiKey":"key","model":"model"}]' npx tsx scripts/probe-judge.ts
```

(2) Imports — `ENV_NAMES` becomes unused (its only uses were the trio reads) and is removed; judge imports added. The import block becomes:

```ts
import { loadWatcherConfig } from "../src/config-file.js";
import { type LlmAccount, resolveJudgeConfig } from "../src/judge.js";
import type { Post } from "../src/types.js";
```

(3) main() env read (HEAD lines 168-176) replaced — the guarded account read; `process.exit` is typed `never` so the definite assignment holds:

```ts
async function main(): Promise<void> {
  let account: LlmAccount;
  try {
    const first = resolveJudgeConfig(process.env)[0];
    if (first === undefined) {
      throw new Error("judge: LLM_ACCOUNTS must not be empty");
    }
    account = first;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`probe: ${message}`);
    process.exit(1);
  }
```

(4) timed() signature and request line:

```ts
async function timed(
  label: string,
  payload: unknown,
  account: LlmAccount,
): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetch(`${account.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
```
(rest of timed unchanged)

(5) rampLevel and findConcurrencyCeiling — signature swaps only, passed through to timed:

```ts
async function rampLevel(
  count: number,
  payload: unknown,
  account: LlmAccount,
): Promise<{ ok: number; refused: number; failed: number; ms: number }> {
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: count }, () => timed("ramp", payload, account)),
  );
```

```ts
async function findConcurrencyCeiling(payload: unknown, account: LlmAccount): Promise<number> {
  for (const level of [2, 4, 8, 16]) {
    const result = await rampLevel(level, payload, account);
```

(6) main()'s payload constructions — `model,` → `model: account.model,` in the minimal-call payload and bulkPayload; the call sites drop their baseUrl/apiKey args: `timed("minimal call (one short message)", { ... }, account)`, `timed("bulk call (10 posts, production prompt shape)", bulkPayload, account)`, `timed("bulk call again (10 posts, variance check)", bulkPayload, account)`, `findConcurrencyCeiling(bulkPayload, account)`. No other change.
#### 4. src/config.ts

**File**: src/config.ts
**Changes**: MODIFY — `ENV_NAMES` drops `llmBaseUrl`/`llmApiKey`/`llmModel` (last consumer gone after the probe flip). Composes with Phase 1's fence into the final registry:

```ts
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;
```
#### 4. .github/workflows/watch.yml

**File**: .github/workflows/watch.yml
**Changes**: MODIFY — both env blocks (`:32-34`, `:58-60`) collapse to one secret line each. Probe job block becomes exactly:

```yaml
        env:
          LLM_ACCOUNTS: \${{ secrets.LLM_ACCOUNTS }}
```

Watch job block becomes exactly:

```yaml
        env:
          THREADS_SESSION_STATE: \${{ secrets.THREADS_SESSION_STATE }}
          LLM_ACCOUNTS: \${{ secrets.LLM_ACCOUNTS }}
          GMAIL_USER: \${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: \${{ secrets.GMAIL_APP_PASSWORD }}
```

The success-gated Commit state step (`:65-77`) is untouched.
#### 4. README.md

**File**: README.md
**Changes**: MODIFY — secrets table (`:47-51`), local run export (`:210`), requirements endpoint line (`:40`), and a rotation sentence in pipeline step 5 (`:19-24`).

(a) Requirements bullet (~line 40) — HEAD: "An OpenAI-compatible chat endpoint (base URL, API key, model name)." becomes:

```md
- One or more OpenAI-compatible chat endpoints, configured as the `LLM_ACCOUNTS`
  pool (see Setup). The judge rotates to the next account on the first HTTP 429.
```

(b) Secrets table rows (~lines 49-51) — the three trio rows become one:

```md
   | `LLM_ACCOUNTS` | `[{"baseUrl":"https://api.openai.com/v1","apiKey":"your-key","model":"gpt-4o-mini"}]` | Judge accounts as a JSON array, tried in order; the first 429 rotates to the next, and an exhausted pool emails an alarm and fails the run |
```

(c) Pipeline step 5 (~lines 19-24) — after the deferred-batch sentence, one sentence added:

```md
   Accounts come from the `LLM_ACCOUNTS` pool: the first HTTP 429 rotates to
   the next account with no wait, and an exhausted pool sends one alarm email
   and fails the run.
```

(d) Local run (~line 210) — the export line becomes:

```bash
export LLM_ACCOUNTS='[{"baseUrl":"https://api.openai.com/v1","apiKey":"your-key","model":"gpt-4o-mini"}]'
```
#### 4. AGENTS.md

**File**: AGENTS.md
**Changes**: MODIFY — judge bullet (`:36-41`) describes first-429 rotation and the exhaustion exit. `:18`/`:21` need no change (`LLM_*` still matches). The bullet becomes:

```md
- `src/judge.ts` - ~10-post bulk chat-completions calls judged against the
  keywords in `watcher.config.json`; accounts come from the `LLM_ACCOUNTS`
  pool (the first HTTP 429 rotates to the next account with no backoff,
  run-sticky; 5xx retries the same account with backoff; an exhausted pool
  throws a typed error that sends one alarm email and exits 1), up to
  `JUDGE_CONCURRENCY` batches run at once, bulk misses fall back to
  single-post calls, and a batch the endpoint does not answer is deferred
  whole; returns `{relevant, locationOk}` per post
```
#### 4. .claude/skills/validate-e2e/SKILL.md

**File**: .claude/skills/validate-e2e/SKILL.md
**Changes**: MODIFY — step 4 (lines 13-14) replaced:

```md
4. Pass real credentials via `LLM_ACCOUNTS` (the JSON account pool) so
   the judge uses the real endpoint.
```
### Success Criteria:

#### Automated Verification:
- [x] Full test suite passes: `npm test`
- [x] Type checking passes: `npm run typecheck`
- [x] Lint clean: `npm run lint`
- [x] No stale env names in live files: `grep -rn "LLM_BASE_URL\|LLM_API_KEY\|LLM_MODEL" src/ scripts/ .github/ README.md AGENTS.md .claude/` returns nothing
- [x] Probe uses the shared parser: `grep -n "resolveJudgeConfig" scripts/probe-judge.ts` shows the import and the guarded read

#### Manual Verification:
- [x] README secrets table shows one `LLM_ACCOUNTS` row; the old trio rows are gone
- [ ] Local probe run with a real `LLM_ACCOUNTS` prints latency + ceiling as before (`npx tsx scripts/probe-judge.ts`)
- [x] Both workflow env blocks carry exactly one LLM_ACCOUNTS line (visual check)
- [x] The `Commit state` step still runs only on success after the env-block swap — no `if: always()` / `if: \${{ !cancelled() }}` override on it (visual check against watch.yml:65-77)

## Ordering Constraints

- Phase 1 → Phase 2 → Phase 3 (email consumes the tagged error's failure record).
- Phase 4 depends only on Phase 2 and can run in parallel with Phase 3.
- The `ENV_NAMES` trio survives until Phase 4 because the probe still reads it; removing it earlier breaks the tree mid-plan.
- Whole-repo `npm run typecheck`, `npm run lint`, `npm test` run at the final whole-plan gate (owned by validate); per-phase gates are scoped.

## Verification Notes

- Known risk — `judgePost`'s status-agnostic retry silently rotating more than once per fallback attempt: pinned by a dedicated test (solutions artifact Risk 1).
- Known risk — pointer read drifting past the first `await` in `judgeBatch`: the account read is the function's first statement; the out-of-order choreography (`tests/judge.test.ts:464-500`) is the harness if it regresses.
- Known risk — concurrent double-429 skipping untried accounts: pinned by the three-account all-429 test with per-key DISPATCH-COUNT assertions — every account key must be dispatched at least twice. Discrimination trace: a true compare-and-set sends all parked workers forward together (4/4/4 calls across the three keys), while a vacuous guard (fresh index read beside the compare) lets the first completer cascade the whole pool alone (4/1/1) with identical failures — only the counts expose it (advisor correction + Phase 2 verification hardening, runs 1-4).
- Test determinism — mocks branch on request URL (distinct per account), never call order; assert pointer monotonicity, not exact sequences.
- Acceptance from the FRD: a 429 on account 1 moves the very next call to account 2, mid-run and across batches; all-exhausted produces exactly one email, exit 1, empty diff against `state/seen-posts.json`.
- Baseline gates: `npm run typecheck`, `npm run lint`, `npm test` — all green at every phase boundary by construction (each phase leaves the tree coherent).
- No `mock.timers` introduced; the 5xx proof adds ~1s real sleep while removing ~9s of old 429-backoff sleeps.

## Performance Considerations

- Rotation adds zero latency on the happy path: the pointer read is one array index; the 429 advance is synchronous with no sleep.
- Sticky pointer means at most one wasted call per account per run; after the first failover, every batch goes straight to the healthy account.
- Drain-then-throw lets in-flight batches finish, so no in-flight request is wasted on exhaustion.
- Suite time net-decreases ~8s (−9s old 429 sleeps, +1s new 5xx sleep).

## Migration Notes

- Before the next scheduled run after merge, create the `LLM_ACCOUNTS` Actions secret (JSON array). A missing secret fails the run at startup with an error naming `LLM_ACCOUNTS` — visible, not silent.
- The old `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` secrets become dead and can be deleted after the swap is validated.
- Rollback: revert the commit and restore the three old secrets; no persisted state changes shape (`state/seen-posts.json` untouched by this feature).

## Pattern References

- `src/judge.ts:444-448` — lock-free cursor read-advance; the rotation pointer clones it plus a CAS guard.
- `src/config-file.ts:87-152` — fail-visible per-item validation with preserved parser messages; the pool parser mirrors it.
- `src/judge.ts:302` — guarded indexed access under `noUncheckedIndexedAccess` (`RETRY_DELAYS_MS[attempt] ?? 0`).
- `src/index.ts:73-82` — conditional spread under `exactOptionalPropertyTypes`.
- `src/email.ts:122-153` over `:84-113` — builder + sender over the `sendText` spine with injected `Transporter`.
- `tests/judge.test.ts:415-419` — request-body capture mock; the new header capture follows the same shape.
- `tests/judge.test.ts:464-500` — out-of-order concurrency choreography; base for the CAS proof.
- `tests/email.test.ts:195-234` — fake-transporter capture/count idioms.

## Developer Context

**Step 4 questions (asked 2026-10-26, answered by developer):**

1. *Directional — injected rotate/record callbacks (artifact Option 1) across judgeBatch/judgePost?* Developer deferred to the advisor. Advisor verdict: keep state in `judgePosts` with synchronous advance, but replace callbacks with a mutable `RotationState` holder passed by reference, plus a compare-and-set guard on the failing index (bare `+= 1` per worker would skip untried accounts under concurrent 429s). **Developer confirmed: RotationState holder.**
2. *Directional — real-sleep retry-test idiom vs first `mock.timers` use for the 5xx proof?* Advisor verdict: real sleep, one retry (~1s); no `mock.timers`; suite net ~9s faster because the old 429-backoff tests disappear. **Developer confirmed: real sleep, one retry.**

**Advisor corrections folded into Decisions (2026-10-26):** tagged error not a class (zero classes in `src/`); `AccountFailure` in `src/types.ts` (avoids email→judge import); drain-then-throw after `Promise.all` (deletes the incomplete-failure-record trade-off); remove `429` from `RETRYABLE_STATUSES` once the 429 branch owns it; `AGENTS.md:18`/`:21` need no edit (`LLM_*` wildcard still matches `LLM_ACCOUNTS`); mocks branch on URL, never call order.

**Decomposition note:** the solutions artifact's design detail ("parameter object vs two functions" for the callbacks) resolved as *neither* — the holder shape replaced the callback seam entirely.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 2 §2 (src/judge.ts) | src/judge.ts:407 | blocker | code-quality | judgePost's transport-error warn rewritten as a single line at ~115 cols (HEAD's was 93) — over biome lineWidth 100, the phase lint gate fails on the diff | Break the call into biome's canonical form (console.warn( / template / ); with trailing comma), as the fence's other judgePost warns already are | applied: warn broken into biome's canonical multi-line form |
| code | Phase 1 §1 (src/judge.ts) | src/judge.ts:302-305 | blocker | code-quality | parseLlmAccounts' non-object-item branch claimed to emit a single-line 120-char throw without a trailing comma | Add the trailing comma after the template literal | dismissed: reviewer misread — the fence (verified before triage) already emits the broken call with a trailing comma after the template literal |
| coverage | ### Key Discoveries §6 | <n/a> | blocker | verification-coverage | Commit-gating claim ("nonzero exhaustion exit can never race the state commit") has no Success Criteria bullet and no code fence pinning that the Commit state step keeps success-only gating after the Phase 4 watch.yml edit | Add a Phase 4 Manual Verification bullet asserting no if: always() / if: !cancelled() override on the Commit state step | applied: Phase 4 Manual Verification gains the success-only-gating bullet |
| code | Phase 2 §2 (src/judge.ts) | src/judge.ts:319-345 | concern | code-quality | judgeBatch's 5xx-retry, non-retryable, missing-content, parse-miss, and transport warns log account state.index + 1 (log-time pointer) — under concurrent rotation a peer can advance the pointer between dispatch and log, naming an account the call never hit; only the 429 branch uses dispatch-time attemptIndex + 1 | Log account attemptIndex + 1 in every judgeBatch warn branch, matching the 429 branch | applied: every judgeBatch and judgePost warn now logs the dispatch-time account (attemptIndex + 1) |

## Plan History

- Phase 1: Rotation types + LLM_ACCOUNTS parser — approved as generated (ENV key addition moved from Phase 2 into this phase: the parser references it). Phase 2 verification corrected three over-escaped regex literals in this phase's test fence (`\\[0\\]` → `\[0\]` etc.) — no design change; the emitted code is identical to what was reviewed modulo the escape fix.
- Phase 2: Rotation mechanics + config flip — approved as generated (4 slice-verifier rounds; fixed along the way: self-defeating sticky-pointer mock, two stale docstrings, helper scoping + dropped Post import, and a vacuous CAS guard — the dispatch-time attemptIndex now feeds the compare-and-set, pinned by per-key dispatch-count assertions)
- Phase 3: Exhaustion email — approved as generated (2 slice-verifier rounds; fixed: subject line split under biome lineWidth 100, import block merged to HEAD-canonical order)
- Phase 4: Probe + workflow + docs + trio removal — approved as generated (slice-verifier first pass: Decisions OK, Cross-slice OK, Research OK)
- Step 9 triage (artifact-code-reviewer + artifact-coverage-reviewer): 3 applied (judgePost warn canonical break; Phase 4 commit-gating bullet; all warns log dispatch-time account), 1 dismissed (Phase 1 trailing-comma claim — fence already canonical, verified before triage). Status flipped to ready.

## References

- `.rpiv/artifacts/solutions/2026-10-26_15-46-36_llm-account-rotation.md` — solution analysis this plan implements (Option 1, as amended by the advisor corrections above)
- `.rpiv/artifacts/research/2026-10-26_14-47-19_llm-account-rotation.md` — seam-level research with all anchors re-verified
- `.rpiv/artifacts/discover/2026-10-26_14-27-50_llm-account-rotation.md` — FRD with developer decisions
- `.rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md` — judge-stage load-testing lessons (Z.AI dynamic rate limits)
- `.rpiv/artifacts/validation/2026-10-26_11-01-22_model-judged-keywords.md` — base-URL fail-visible validation precedent
