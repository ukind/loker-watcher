---
date: 2026-10-27T10:20:51+0700
author: Yogiswara Utama
commit: 7dc0247
branch: main
repository: loker-watcher
topic: "fast-workflow-runtime"
tags: [plan, judge, fetch-threads, state, watch-yml, concurrency, fallback, timings]
status: ready
parent: ".rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md"
phase_count: 7
phases:
  - { n: 1, title: "Judge concurrency seam", files: ["src/config.ts", "src/judge.ts", "tests/judge.test.ts"], depends_on: [] }
  - { n: 2, title: "Parallel capped fallback", files: ["src/judge.ts", "tests/judge.test.ts"], depends_on: [1] }
  - { n: 3, title: "Fetch pools + context factory seam", files: ["src/fetch-threads.ts", "tests/fetch-threads.test.ts"], depends_on: [] }
  - { n: 4, title: "State v2 core", files: ["src/state.ts", "tests/state.test.ts"], depends_on: [] }
  - { n: 5, title: "State hardening", files: ["src/state.ts", "tests/state.test.ts"], depends_on: [4] }
  - { n: 6, title: "Pipeline gates + stage timers", files: ["src/index.ts", "tests/index.test.ts"], depends_on: [1, 3, 4, 5] }
  - { n: 7, title: "Workflow + docs", files: [".github/workflows/watch.yml", "README.md"], depends_on: [1, 2, 3, 4, 5, 6] }
last_updated: 2026-10-27T11:33:47+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Step 5 triage: 13 reviewer findings applied (5 blockers, 6 concerns, 2 suggestions); phases frontmatter rebuilt with Phase 6 depends_on +3; artifact implement-ready."
---

# Fast Workflow Runtime Implementation Plan

## Overview

Seven speed-and-budget changes land as in-repo seams, inherited 1:1 from the design's `## Slices` (`.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md`): the judge pool idiom (slot-array + shared cursor) generalizes to the single-post fallback and both surface-fetch loops; `JUDGE_CONCURRENCY` becomes the repo's first numeric env parse, threaded into `judgePosts` as a trailing width argument; state migrates to v2 (id → ISO firstSeenAt) with prune-on-load and fixes the atomic-write temp-name bug; Gate 2 persists judged ids on zero-match runs; the workflow drops to `--only-shell` install, an 8-minute timeout, and per-stage duration logs. Code comes from the design's `## Architecture`; Success Criteria pass through from `## Slices` unchanged.

Parallelism per the design's Ordering Constraints: Phases 1, 3, and 4 are mutually independent; Phase 2 follows 1 (the fallback pool consumes the width parameter); Phase 5 follows 4 (hardening extends the v2 schema); Phase 6 follows 1+3+4+5 (the pipeline wires the judge config, the fetch seam types, v2 load, and Gate 2 persistence); Phase 7 lands last (D10 — the timeout cut is unsafe before the fast paths exist, precedent fda50c2). Total: 11 files across 7 phases.

## Desired End State

A production dispatch run with the probe-measured width:

```yaml
# .github/workflows/watch.yml (Run watcher env block)
  JUDGE_CONCURRENCY: "8"   # probe run 40268599609 successor — paste the measuring run's reading
```

A zero-match run persists and commits judged ids (no re-judge next run):

```json
{
  "version": 2,
  "seenPostIds": {
    "7224638912743920001": "2026-10-26T09:14:00.000Z",
    "7224638912743920002": "2026-10-26T09:14:00.000Z"
  }
}
```

A run log carries one duration line per stage:

```
watch: surfaces: tag/hiring, ...
timing: fetch 61234ms
extract: 312 unique post(s) across 8 surface(s)
timing: judge 45678ms
judge: 40 candidate(s) judged, 2 relevant+located, skipped: 0
timing: notify 2104ms
state: 40 new seen post id(s)
```

## What We're NOT Doing

- Cron schedule, LLM endpoint, match semantics, batch size, recency window (D10, D5, D6).
- Browser caching (reversed on evidence: measured saving ~20-35s; Playwright docs discourage it).
- p-limit adoption (sanctioned fallback only if pool code balloons past ~100 lines or slot-array guards produce bugs).
- Config-file relocation of the tunables (would re-open D1 and the budget doctrine).
- A sidecar state file (blocked on single-artifact precedent + contended temp-name bug).
- A first JUDGE_CONCURRENCY probe/dispatch measurement (blocked on a real runner run; the default cites the rule until then).

---

## Phase 1: Judge concurrency seam

Depends on: none.

### Overview

The judge stage's width becomes caller-controlled: `JUDGE_CONCURRENCY` joins `ENV_NAMES`, `parseJudgeConcurrency` gives the repo its first numeric env read (absent → 4, invalid → throw naming the variable), and `judgePosts` gains the trailing `concurrency` parameter that the bulk pool launch reads (D1'). The design's judge fences are merged (Slice 1 + Slice 2, "single source of truth for both"): this phase carries the width-seam sections, Phase 2 the fallback sections.

### Changes Required:

#### 1. Environment variable registry
**File**: `src/config.ts`
**Changes**: `ENV_NAMES` gains the `judgeConcurrency` entry beside `llmAccounts` (names only, values never in the repo).

```ts
/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  judgeConcurrency: "JUDGE_CONCURRENCY",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;
```

#### 2. Judge width seam
**File**: `src/judge.ts`
**Changes**: `JUDGE_CONCURRENCY` becomes `DEFAULT_JUDGE_CONCURRENCY`; `parseJudgeConcurrency` exports directly above `resolveJudgeConfig`; the module and `judgePost` docblocks swap the sequential-fallback sentences for the pooled ones (every rotation sentence stays); `judgePosts` gains the trailing width parameter and the bulk pool launch reads it. (`FALLBACK_CALL_BUDGET` belongs to Phase 2's section of the same merged fence.)

```ts
// --- Constants block: JUDGE_CONCURRENCY becomes DEFAULT_JUDGE_CONCURRENCY (:48) ---
/**
 * Bulk calls in flight at once when the caller passes no width. Ships at
 * 4 - the agreed floor, low enough for the lowest documented Z.AI tier.
 * The probe's ramp reads the real ceiling; paste that reading into
 * JUDGE_CONCURRENCY in .github/workflows/watch.yml. Z.AI publishes no
 * number and adjusts the limit dynamically, so the 429 account rotation
 * below is what keeps a stale or optimistic value from costing a run its
 * digest.
 */
const DEFAULT_JUDGE_CONCURRENCY = 4;

// --- New export, placed directly above resolveJudgeConfig (:171) ---
/**
 * Parse JUDGE_CONCURRENCY (the repo's first numeric env read).
 *
 * Absent or blank -> DEFAULT_JUDGE_CONCURRENCY: local runs and the probe
 * job never set the variable, and watch.yml carries the probe-measured
 * value for production. Present but not a positive integer -> throw naming
 * the variable: a typo must not silently run at the default width
 * (fail-visible - same rule as parseLlmAccounts below).
 */
export function parseJudgeConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_JUDGE_CONCURRENCY;
  }
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `judge: ${ENV_NAMES.judgeConcurrency} must be a positive integer, got "${raw}"`,
    );
  }
  return value;
}

// --- Module docblock: the last two pool/fallback sentences become the
//     paragraph below. Keep every rotation sentence ("HTTP 429 is
//     account-local...", "When every account is exhausted...") in place;
//     replace ONLY the sentence pair "Batches drain through a bounded pool
//     of JUDGE_CONCURRENCY workers and reassemble in input order, so the
//     worst case is ceil(N/BATCH_SIZE) concurrent calls plus at most
//     BATCH_SIZE sequential fallbacks per affected batch." with: ---
//   "Batches drain through a bounded pool of workers sized by the
//   concurrency argument (JUDGE_CONCURRENCY, absent 4) and reassemble in
//   input order. Posts the bulk response misses fall back to the
//   single-post judgePost through a second pool at the same width, under a
//   per-run FALLBACK_CALL_BUDGET on single-post calls. A post that fails
//   both stages, or never reaches the fallback once the budget is spent,
//   is skipped for this run, logged visibly, and omitted from state (D3:
//   it stays unseen and retries next run)."

// --- judgePost docblock: the throw sentence ("judgePost runs sequentially
//     in judgePosts' reassembly loop (after the join), so the throw
//     surfaces directly.") becomes ---
//   "judgePost runs in judgePosts' parallel fallback pool, whose workers
//   catch the throw, stop claiming work, and re-throw after the join
//   (drain-then-throw, same as the bulk phase)."

// --- judgePosts: signature gains the trailing width (D1 follow-up
//     carrier); the docblock's rotation-era "Batches drain through a
//     bounded pool of JUDGE_CONCURRENCY workers..." paragraph becomes ---
//   "Batches drain through a bounded pool of `concurrency` workers, and
//   each result slot is indexed by batch number so the output reassembles
//   in input order even when batches finish out of order. Bulk misses
//   drain through a second `concurrency`-wide fallback pool under a
//   per-run FALLBACK_CALL_BUDGET; the cursor claims work in input order,
//   so budget exhaustion starves the tail. Both result lists come out in
//   candidate input order."
export async function judgePosts(
  candidates: readonly Post[],
  accounts: readonly LlmAccount[],
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  concurrency: number = DEFAULT_JUDGE_CONCURRENCY,
): Promise<JudgeBatchResult> {

// --- Bulk pool launch reads the configured width (was the module constant) ---
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
```

#### 3. Judge test seam pins
**File**: `tests/judge.test.ts`
**Changes**: the import list gains `parseJudgeConcurrency` (the merged import list — the `RotationExhausted`/`isRotationExhausted` entries serve Phase 2's drain-then-throw pin); a `parseJudgeConcurrency` describe joins after the `parseLlmAccounts` describe; the two width pins pass the width through the new trailing parameter and assert from it. Existing rotation-era fixtures (`singleAccount`, `twoAccounts`, `measuredFetch`, `bulkPost`, `id19`, `KEYWORDS`) stay untouched.

```ts
// --- Import list gains parseJudgeConcurrency ---
import {
  type LlmAccount,
  type RotationExhausted,
  type RotationState,
  isRotationExhausted,
  judgePost,
  judgePosts,
  parseBulkVerdicts,
  parseJudgeConcurrency,
  parseLlmAccounts,
  parseVerdict,
  resolveJudgeConfig,
} from "../src/judge.js";

// --- New describe, placed after the parseLlmAccounts describe ---
describe("parseJudgeConcurrency", () => {
  it("defaults to 4 when the variable is absent", () => {
    assert.equal(parseJudgeConcurrency(undefined), 4);
  });

  it("defaults to 4 when the variable is blank", () => {
    assert.equal(parseJudgeConcurrency(""), 4);
    assert.equal(parseJudgeConcurrency("   "), 4);
  });

  it("parses a positive integer with surrounding whitespace", () => {
    assert.equal(parseJudgeConcurrency("8"), 8);
    assert.equal(parseJudgeConcurrency(" 16 "), 16);
  });

  it("throws naming the variable for zero, negative, fractional, or non-numeric values", () => {
    for (const bad of ["0", "-2", "2.5", "abc", "4px"]) {
      assert.throws(() => parseJudgeConcurrency(bad), /JUDGE_CONCURRENCY/);
    }
  });
});

// --- Width pins re-derived from the width each test passes (titles carry no literals) ---
  it("peaks at exactly the configured concurrency for a 280-post backlog", async () => {
    const posts = Array.from({ length: 280 }, (_, i) => bulkPost(id19(i + 1))); // 28 batches
    const width = 4;
    const state = { inFlight: 0, peak: 0 };
    const mockFetch = measuredFetch(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      width,
    );
    assert.equal(state.peak, width); // exactly the passed width, never more
    assert.equal(result.judged.length, 280);
    assert.deepEqual(result.skippedPostIds, []);
  });

  it("peaks at min(concurrency, batches) in-flight calls for a short list", async () => {
    const posts = Array.from({ length: 25 }, (_, i) => bulkPost(id19(i + 1))); // 3 batches
    const width = 2;
    const batchCount = Math.ceil(posts.length / 10); // BATCH_SIZE mirror
    const state = { inFlight: 0, peak: 0 };
    const mockFetch = measuredFetch(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      width,
    );
    assert.equal(state.peak, Math.min(width, batchCount));
    assert.equal(result.judged.length, 25);
  });
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] `grep -n "JUDGE_CONCURRENCY" src/judge.ts` returns only parse/default references; the bulk pool launch reads the `concurrency` parameter (the fallback pool launch lands with Phase 2)
- [x] `grep -n "judgeConcurrency" src/config.ts` returns exactly one match (the ENV_NAMES entry beside llmAccounts)
- [x] `grep -rn "peaks at exactly four" tests/` returns nothing (stale-pin check, 1d4faed rewrite validation)
- [x] `parseJudgeConcurrency` covered: absent -> 4, blank -> 4, positive integer -> value, invalid ("0", "-2", "2.5", "abc") -> throws naming JUDGE_CONCURRENCY
- [x] Width pins derive from the width the test passes (width 4 over 28 batches; width 2 over 3 batches asserting `min()`)
- [x] Before editing each fence, re-grep the symbol its anchor cites (`JUDGE_CONCURRENCY`, `resolveJudgeConfig`); never edit by line number alone (design re-grounding rule)
- [x] `grep -n "resolveJudgeConfig" scripts/probe-judge.ts` still matches `resolveJudgeConfig(process.env)[0]` (probe untouched — the width never reaches the probe)

#### Manual Verification:
- [ ] Deferred to Slice 7's dispatch run: a real run with JUDGE_CONCURRENCY set honors the width (no observable width output locally at this slice)

---


## Phase 2: Parallel capped fallback

Depends on: Phase 1 (the fallback pool consumes the width parameter).

### Overview

Bulk misses stop draining serially: fallback-needed posts queue in the reassembly walk, then drain through a second slot-array pool at the judge width under a per-run `FALLBACK_CALL_BUDGET` of 40 calls; the shared cursor claims work in input order, so a spent budget starves the tail; a `RotationExhausted` throw mid-fallback stops the workers and re-throws after the join (drain-then-throw, D3, D11).

### Changes Required:

#### 1. Parallel capped fallback pool
**File**: `src/judge.ts`
**Changes**: `FALLBACK_CALL_BUDGET = 40` joins the constants block (Phase 1 carries the rest of that block); the reassembly walk replaces the rotation-era `const judged ... return { judged, skippedPostIds };` tail — bulk verdicts fill slots at once, bulk misses queue for the pool; the parallel fallback pool fills slots under the budget with drain-then-throw; assembly walks the slots into `judged`/`skippedPostIds` in input order. The drain-then-throw exhausted check after the bulk join stays untouched, above this block.

```ts
// --- Constants block: FALLBACK_CALL_BUDGET joins DEFAULT_JUDGE_CONCURRENCY ---
/**
 * Single-post fallback calls one run may spend. Advisor-fixed: the
 * historical cascade (run 40264368939) burned 6.5 job-minutes walking
 * degraded batches serially, and an unbounded parallel fallback would bill
 * unboundedly instead. The pool bounds wall-clock; this constant bounds
 * total spend. The budget counts single-post CALLS, not HTTP requests:
 * rotation can turn one call into up to M requests (M = pool size — a 429
 * spends no attempt), so worst-case requests are 40×M while billed calls
 * stay <= 40. Unmeasured values stay constants — raise it only with a
 * probe- or runner-measured reason.
 */
const FALLBACK_CALL_BUDGET = 40;

// --- Reassembly walk + parallel capped fallback pool + assembly: replaces
//     the rotation-era "const judged ... return { judged, skippedPostIds };"
//     tail. The drain-then-throw exhausted check after the bulk join stays
//     untouched, above this block. ---
  // Reassembly walk (input order): bulk verdicts fill their slots at once;
  // bulk misses queue for the parallel fallback pool below. A batch the
  // endpoint did not answer is deferred whole — its slots stay undefined
  // (skipped), and it consumes no fallback budget.
  const slots: Array<JudgeVerdict | undefined> = Array.from({ length: candidates.length });
  const fallbackWork: Array<{ post: Post; slot: number }> = [];
  let candidateIndex = 0;
  for (const [index, batch] of batches.entries()) {
    const batchStart = candidateIndex;
    candidateIndex += batch.length;
    const outcome = outcomes[index];
    if (outcome === undefined) continue;
    if (outcome.status !== "answered") {
      // unanswered (deferred: spent backoff, non-retryable status, or
      // transport error). The exhausted arm cannot appear here — it is
      // thrown after the bulk join above — but the union keeps it typed.
      console.warn(
        `judge: skipped batch ${index} of ${batch.length} post(s) after an unanswered bulk call; they stay unseen and retry next run`,
      );
      continue;
    }
    for (const [i, post] of batch.entries()) {
      const fromBulk = outcome.verdicts.get(post.id);
      const slot = batchStart + i;
      if (fromBulk !== undefined) {
        slots[slot] = fromBulk;
      } else {
        fallbackWork.push({ post, slot });
      }
    }
  }

  // Parallel capped fallback: the slot-array + shared-cursor pool idiom,
  // `concurrency` wide, under a per-run FALLBACK_CALL_BUDGET. The cursor
  // claims work in input order, so a spent budget starves the tail —
  // never a random middle. A RotationExhausted throw from judgePost stops
  // the workers (drain-then-throw): the join below re-throws the tagged
  // error with the complete failure record, and unjudged posts stay
  // unseen — index.ts turns it into the exhaustion email and exit 1.
  if (fallbackWork.length > 0) {
    let next = 0;
    let budget = FALLBACK_CALL_BUDGET;
    let exhausted = false;
    const fallbackWorker = async (): Promise<void> => {
      for (;;) {
        const workIndex = next;
        next += 1;
        if (workIndex >= fallbackWork.length || exhausted) return;
        if (budget <= 0) return; // budget spent — surplus posts stay unseen (D3)
        budget -= 1;
        const item = fallbackWork[workIndex];
        if (item === undefined) continue;
        try {
          const verdict = await judgePost(item.post, state, keywords, fetchFn);
          if (verdict !== null) {
            slots[item.slot] = verdict;
          } else {
            console.warn(`judge: skipped post ${item.post.id} after bulk miss and retry`);
          }
        } catch (error) {
          if (isRotationExhausted(error)) {
            exhausted = true; // stop claiming; the join re-throws below
            return;
          }
          throw error;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, fallbackWork.length) }, fallbackWorker),
    );
    if (exhausted) {
      throw rotationExhausted(state.failures);
    }
    const starved = Math.max(0, fallbackWork.length - FALLBACK_CALL_BUDGET);
    if (starved > 0) {
      console.warn(
        `judge: fallback call budget ${FALLBACK_CALL_BUDGET} spent — ${starved} post(s) never fell back; they stay unseen and retry next run`,
      );
    }
  }

  // Assembly (input order): filled slots are the judged posts, undefined
  // slots (deferred batches, fallback failures, starved tail) are the
  // skipped ids.
  const judged: JudgedPost[] = [];
  const skippedPostIds: string[] = [];
  for (const [index, verdict] of slots.entries()) {
    const post = candidates[index];
    if (post === undefined) continue;
    if (verdict !== undefined) {
      judged.push({ post, verdict });
    } else {
      skippedPostIds.push(post.id);
    }
  }
  return { judged, skippedPostIds };
```

#### 2. Fallback pool pins
**File**: `tests/judge.test.ts`
**Changes**: the `bulkMissThenAnswer` double (bulk calls answer unparseable so every post falls back; single-post calls answer a verdict; records call count + in-flight peak) joins `measuredFetch` inside the judgePosts describe; four fallback pins append after the min(concurrency, batches) width pin: pool width in input order, 40-call budget starvation, mid-list failure ordering, rotation-exhaustion drain-then-throw. Note: the burst pin's demoted batches ride the suite's bounded retry backoff — expect a few seconds of added suite wall-clock across its two demoted batches; accepted at triage.

```ts
// --- Shared double, placed next to measuredFetch inside the judgePosts describe ---
  /**
   * Bulk calls answer unparseable text (every post falls back); single-post
   * calls answer a valid verdict. Discriminates by the bulk prompt's
   * distinctive opening. Records call count and the in-flight peak, so the
   * fallback pool's width is observable. Uses the singleAccount pool, so
   * rotation never fires and every call carries key "test-key".
   */
  function bulkMissThenAnswer(state: { inFlight: number; peak: number; calls: number }) {
    return async (_url: unknown, options?: unknown): Promise<Response> => {
      state.calls += 1;
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1)); // let peers enter
      state.inFlight -= 1;
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("I cannot judge these posts."); // answered-but-unparseable: every post falls back
      }
      return ok('{"relevant": true, "locationOk": false}');
    };
  }

// --- Fallback pool pins, placed after the min(concurrency, batches) width pin ---

  it("drains fallback-needed posts through a pool at the configured width, in input order", async () => {
    const posts = Array.from({ length: 20 }, (_, i) => bulkPost(id19(i + 1))); // 2 batches
    const width = 3;
    const state = { inFlight: 0, peak: 0, calls: 0 };
    const mockFetch = bulkMissThenAnswer(state);

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      width,
    );

    // The bulk phase peaks at 2 (two batches) — only the fallback pool can
    // reach the configured width.
    assert.equal(state.peak, width);
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

  it("spends the 40-call fallback budget, then leaves the surplus unseen in input order", async () => {
    const posts = Array.from({ length: 50 }, (_, i) => bulkPost(id19(i + 1))); // 5 batches
    const state = { inFlight: 0, peak: 0, calls: 0 };
    const mockFetch = bulkMissThenAnswer(state);

    const result = await judgePosts(posts, singleAccount, KEYWORDS, mockFetch as unknown as typeof fetch);

    assert.equal(state.calls, 5 + 40); // 5 bulk + the 40-call budget, never more
    assert.equal(result.judged.length, 40); // FALLBACK_CALL_BUDGET posts judged
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts.slice(0, 40).map((p) => p.id), // the budget feeds the head of the input order
    );
    assert.deepEqual(
      result.skippedPostIds,
      posts.slice(40).map((p) => p.id), // the tail starves, in order
    );
  });

  it("keeps input order when one parallel fallback fails among successes", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("I cannot judge these posts.");
      }
      if (content.includes(id19(5))) {
        return new Response("Internal Server Error", { status: 500 }); // both attempts fail
      }
      return ok('{"relevant": true, "locationOk": false}');
    };

    const result = await judgePosts(posts, singleAccount, KEYWORDS, mockFetch as unknown as typeof fetch);

    assert.equal(result.judged.length, 9);
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts.filter((p) => p.id !== id19(5)).map((p) => p.id),
    );
    assert.deepEqual(result.skippedPostIds, [id19(5)]);
  });

  it("drain-then-throw: a pool exhausted mid-fallback rejects judgePosts with the complete record", async () => {
    const posts = Array.from({ length: 3 }, (_, i) => bulkPost(id19(i + 1))); // 1 batch, all fall back
    const mockFetch = (async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (content.includes("Judge each Threads post below")) {
        return ok("{}"); // answered, zero verdicts — every post falls back
      }
      return new Response("Too Many Requests", { status: 429 }); // rotation burns both accounts
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await judgePosts(posts, twoAccounts(), KEYWORDS, mockFetch);
    } catch (error) {
      caught = error;
    }

    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as RotationExhausted).failures.map((f) => f.account),
      [1, 2],
    );
  });

  it("defers K in-flight batches whole when a burst demotes the first wave at width > 1 (1d4faed)", async () => {
    const posts = Array.from({ length: 30 }, (_, i) => bulkPost(id19(i + 1))); // 3 batches
    const width = 2;
    const state = { inFlight: 0, peak: 0 };
    // Mirror of the suite's spent-backoff defer pin: bulk calls for the
    // first wave's batches always fail retryable, so both batches exhaust
    // backoff and defer whole at the same time; the third batch answers
    // on its first try.
    const burstIds = new Set([id19(1), id19(11)]); // one id per demoted batch
    const mockFetch = async (_url: unknown, options?: unknown): Promise<Response> => {
      const body = JSON.parse((options as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const content = body.messages[1]?.content ?? "";
      if (!content.includes("Judge each Threads post below")) {
        return ok('{"relevant": true, "locationOk": false}');
      }
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1)); // let peers enter
      state.inFlight -= 1;
      if ([...burstIds].some((id) => content.includes(id))) {
        return new Response("Internal Server Error", { status: 500 });
      }
      // Real bulk shape: an id->verdict map for exactly the listed ids, so
      // the surviving batch is judged through the bulk path, never the fallback.
      const answer: Record<string, { relevant: boolean; locationOk: boolean }> = {};
      for (const id of content.match(/\b\d{16,}\b/g) ?? []) {
        answer[id] = { relevant: true, locationOk: false };
      }
      return ok(JSON.stringify(answer));
    };

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      width,
    );

    // The burst defers BOTH first-wave batches whole: their 20 posts are
    // skipped in input order, none is judged, and the surviving batch
    // reassembles in input order.
    assert.ok(state.peak <= width);
    assert.equal(result.judged.length, 10);
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts.slice(20).map((p) => p.id),
    );
    assert.deepEqual(
      result.skippedPostIds,
      posts.slice(0, 20).map((p) => p.id),
    );
  });
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Fallback parallelism pin: 2 unparseable batches (20 posts) at width 3 -> measured peak equals the passed width (bulk alone peaks at 2), judged order equals input order, all verdicts carry the fallback shape
- [x] Rotation interplay pin: a pool exhausted mid-fallback (both accounts 429 on single-post calls) rejects judgePosts with the tagged RotationExhausted error carrying the complete per-account record (drain-then-throw, D11)
- [x] Budget pin: 5 unparseable batches (50 fallback-needed posts) -> fetch calls = 5 + 40; judged = first 40 ids in input order; skippedPostIds = last 10 ids in input order
- [x] Mid-list failure pin: one failing fallback among parallel successes -> skippedPostIds = [that id], judged order preserved
- [x] Burst pin (1d4faed risk watch): width > 1 where a burst demotes the first wave's K in-flight batches (retryable-status spent backoff) -> both batches defer whole (their posts land in skippedPostIds in input order), no demoted post is judged, and the surviving batch reassembles in input order
- [x] `grep -n "sequential fallbacks" src/judge.ts` returns nothing (stale-doc check)

#### Manual Verification:
- [ ] Deferred to Slice 7's dispatch run: fallback wall-clock and budget behavior against a real degraded endpoint

---


## Phase 3: Fetch pools + context factory seam

Depends on: none (independent of Phases 1-2 and 4-5; the design holds its sequence position after Slice 2 to keep one slice per checkpoint).

### Overview

Both surface walks stop loading 8 pages serially: each walk drains its surfaces through a bounded slot-array pool capped at `FETCH_CONCURRENCY = 4` (D4), and a trailing `ContextFactory` parameter makes the walks offline-testable (D5) — the analyzer-verified option that covers all four offline scenarios (input order, partial failure, all-fail throw, empty tracking).

### Changes Required:

#### 1. Bounded fetch pools + injection seam
**File**: `src/fetch-threads.ts`
**Changes**: no source fence in the design — the test fence below is the executable contract, and D4/D5 fix the shape. Ships: an exported `FETCH_CONCURRENCY = 4` constant; a trailing `contextFactory` parameter on BOTH `fetchSurfaces` and `fetchSurfacesAuthenticated`, defaulting to the module's Chromium factory (the ONLY Playwright import site — a dynamic `await import("playwright")` inside the factory, so importing the module never loads Playwright); structural interfaces `ContextLike`/`PageLike`/`LocatorLike`/`ResponseLike` plus the exported `ContextFactory` type, taking the optional session-file path so the default factory can attach the session storage state for authenticated walks while zero-arg test doubles stay assignable (`type ContextFactory = (storageStatePath?: string) => Promise<ContextLike>`); each walk loops its surfaces through a bounded slot-array pool (shared cursor, slot-indexed results / failures / zero-post tracking) so results reassemble in input order and the concurrency peak never exceeds the cap; per-surface error assembly keeps its message shapes (the pins assert both shapes exactly). Extraction, session handling, and the Recent-tab interaction stay untouched.

#### 2. Offline pool suite
**File**: `tests/fetch-threads.test.ts` (NEW)
**Changes**: new offline suite over the context factory seam — importing the file never loads Playwright. Covers: 8-surface input order with peak > 1 and peak ≤ FETCH_CONCURRENCY plus context teardown; partial failure keeps successes in input order; logged-out all-fail lists per-surface errors in input order; authenticated all-fail lists failures with NO empty line; authenticated all-fail with zero-post surfaces shows the tracking line and NO failure lines; authenticated graphql posts collected in input order. Note: the failing-navigation pins ride the walk's real retry backoff (~2s/4s sleeps; no timer seam) — expect roughly 18s of added suite wall-clock across the all-fail/partial-failure cases; accepted at triage.

```ts
/**
 * Offline suite for the fetch pools + context factory seam (Slice 3, D4/D5).
 * Every case injects a ContextFactory double — importing this file never
 * loads Playwright. Covers: input-order results, partial failure, all-fail
 * throw (both message shapes), empty-surface tracking, FETCH_CONCURRENCY
 * peak, and context teardown.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedSurface } from "../src/config-file.js";
import {
  type ContextFactory,
  type ContextLike,
  FETCH_CONCURRENCY,
  type LocatorLike,
  type PageLike,
  type ResponseLike,
  fetchSurfaces,
  fetchSurfacesAuthenticated,
} from "../src/fetch-threads.js";

const surface = (label: string): ResolvedSurface => ({
  label,
  url: `https://www.threads.com/${label}`,
});

/** 19-digit post id, mirroring the judge tests' id helper. */
const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

/** Minimal graphql capture body: one thread_item carrying one post. */
const graphqlBody = (id: string): string =>
  JSON.stringify({
    data: {
      thread_items: [
        {
          post: {
            pk: id,
            caption: { text: `Hiring frontend developer ${id}` },
            user: { username: `author-${id.slice(-2)}` },
            taken_at: 1_792_755_976,
          },
        },
      ],
    },
  });

/** Response double the walk's graphql filter accepts (url + status + body). */
const graphqlResponse = (body: string): ResponseLike => ({
  url: () => "https://www.threads.com/api/graphql",
  status: () => 200,
  text: async () => body,
});

/**
 * Context factory double. Pages decide success/failure at goto time by URL
 * substring (pool workers claim surface indexes at microtask boundaries, so
 * pages cannot be mapped to labels at creation time). When the URL matches
 * an xhr entry, the double fires the walk's response listener with a
 * graphql body — the same async shape as a real capture. The Recent-tab
 * locator never becomes visible (both walks tolerate its absence), and
 * waits resolve immediately. Tracks open pages for the concurrency peak
 * and flags context teardown.
 */
function fakeContextFactory(options: {
  concurrency: { inFlight: number; peak: number };
  failUrls?: ReadonlySet<string>;
  xhrBySubstring?: ReadonlyMap<string, string>;
  closed?: { value: boolean };
}): ContextFactory {
  const failUrls = options.failUrls ?? new Set<string>();
  const xhrBySubstring = options.xhrBySubstring ?? new Map<string, string>();
  return async () => {
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        options.concurrency.inFlight += 1;
        options.concurrency.peak = Math.max(
          options.concurrency.peak,
          options.concurrency.inFlight,
        );
        let open = true;
        const listeners: Array<(response: ResponseLike) => void> = [];
        const page: PageLike = {
          goto: async (url: string) => {
            if ([...failUrls].some((fragment) => url.includes(fragment))) {
              throw new Error(`navigation failed for ${url}`);
            }
            const entry = [...xhrBySubstring.entries()].find(([fragment]) =>
              url.includes(fragment),
            );
            if (entry !== undefined) {
              const response = graphqlResponse(entry[1]);
              for (const listener of listeners) listener(response);
            }
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => {
            const missingTab: LocatorLike = {
              first: () => missingTab,
              waitFor: async () => {
                throw new Error("locator not found"); // recentVisible = false path
              },
              click: async () => undefined,
            };
            return missingTab;
          },
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => {
            if (!open) return;
            open = false;
            options.concurrency.inFlight -= 1;
          },
        };
        return page;
      },
      addInitScript: async () => undefined,
      close: async () => {
        if (options.closed !== undefined) options.closed.value = true;
      },
    };
    return context;
  };
}

describe("fetchSurfaces", () => {
  it("returns HTML in input order while at most FETCH_CONCURRENCY pages are open", async () => {
    const surfaces = Array.from({ length: 8 }, (_, i) => surface(`tag/s${i + 1}`));
    const concurrency = { inFlight: 0, peak: 0 };
    const closed = { value: false };

    const result = await fetchSurfaces(surfaces, fakeContextFactory({ concurrency, closed }));

    assert.deepEqual(result.map((fetched) => fetched.label), surfaces.map((s) => s.label));
    assert.ok(concurrency.peak > 1, `pages never overlapped (peak ${concurrency.peak})`);
    assert.ok(
      concurrency.peak <= FETCH_CONCURRENCY,
      `peak ${concurrency.peak} exceeded FETCH_CONCURRENCY ${FETCH_CONCURRENCY}`,
    );
    assert.equal(closed.value, true);
  });

  it("keeps successes in input order when some surfaces fail", async () => {
    const surfaces = [1, 2, 3, 4].map((i) => surface(`tag/s${i}`));
    const failUrls = new Set(["tag/s2", "tag/s4"]);

    const result = await fetchSurfaces(
      surfaces,
      fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, failUrls }),
    );

    assert.deepEqual(
      result.map((fetched) => fetched.label),
      ["tag/s1", "tag/s3"],
    );
  });

  it("throws with per-surface errors in input order when every surface fails", async () => {
    const surfaces = [1, 2].map((i) => surface(`tag/s${i}`));
    const failUrls = new Set(["tag/s1", "tag/s2"]);

    await assert.rejects(
      () =>
        fetchSurfaces(
          surfaces,
          fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, failUrls }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^fetch: all 2 surface\(s\) failed:\n/);
        assert.match(error.message, /tag\/s1: navigation failed/);
        assert.match(error.message, /tag\/s2: navigation failed/);
        assert.ok(error.message.indexOf("tag/s1") < error.message.indexOf("tag/s2"));
        return true;
      },
    );
  });
});

describe("fetchSurfacesAuthenticated", () => {
  it("collects graphql-captured posts in input order across concurrent surfaces", async () => {
    const surfaces = [1, 2, 3].map((i) => surface(`tag/a${i}`));
    const xhrBySubstring = new Map(
      surfaces.map((s, i) => [s.label, graphqlBody(id19(i + 1))]),
    );

    const result = await fetchSurfacesAuthenticated(
      surfaces,
      "session-state.json",
      fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, xhrBySubstring }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1), id19(2), id19(3)],
    );
  });

  it("throws listing each failure when every authenticated surface fails", async () => {
    const surfaces = [1, 2].map((i) => surface(`tag/a${i}`));
    const failUrls = new Set(["tag/a1", "tag/a2"]);

    await assert.rejects(
      () =>
        fetchSurfacesAuthenticated(
          surfaces,
          "session-state.json",
          fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, failUrls }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^fetch: all 2 authenticated surface\(s\) failed:\n/);
        assert.match(error.message, /tag\/a1: navigation failed/);
        assert.match(error.message, /tag\/a2: navigation failed/);
        assert.doesNotMatch(error.message, /0 post\(s\) extracted/);
        return true;
      },
    );
  });

  it("tracks zero-post surfaces in the all-fail detail when nothing is extracted", async () => {
    const surfaces = [1, 2].map((i) => surface(`tag/a${i}`));

    await assert.rejects(
      () =>
        fetchSurfacesAuthenticated(
          surfaces,
          "session-state.json",
          fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 } }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^fetch: all 2 authenticated surface\(s\) failed:\n/);
        assert.match(
          error.message,
          /tag\/a1, tag\/a2: 0 post\(s\) extracted — the Recent tab or the graphql XHR capture yielded nothing/,
        );
        assert.doesNotMatch(error.message, /navigation failed/);
        return true;
      },
    );
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] `grep -n "playwright" src/fetch-threads.ts` returns only the dynamic `await import("playwright")` inside the default factory (no top-level import)
- [x] `grep -n "contextFactory" src/fetch-threads.ts` shows the trailing parameter on BOTH fetchSurfaces and fetchSurfacesAuthenticated (default: chromiumContextFactory)
- [x] `grep -rn "playwright" tests/fetch-threads.test.ts` returns nothing (offline rule)
- [x] tests/fetch-threads.test.ts covers: 8-surface input order with peak > 1 and peak <= FETCH_CONCURRENCY plus the context teardown flag; partial failure keeps successes in input order; logged-out all-fail lists per-surface errors in input order; authenticated all-fail lists failures with NO empty line; authenticated all-fail with zero-post surfaces shows the tracking line and NO failure lines; authenticated graphql posts collected in input order
- [x] `grep -n "sequential" src/fetch-threads.ts` returns nothing (stale-doc check)

#### Manual Verification:
- [ ] Deferred to Slice 7's dispatch run: 8-surface concurrent wall-clock vs the serial baseline, and no Threads rate-limit blowup at width 4 (D4's untested assumption)

---


## Phase 4: State v2 core

Depends on: none (independent of Phases 1-3).

### Overview

The seen map grows timestamps: `seenPostIds` becomes `Record<id, ISO firstSeenAt>` under the kept key name; v1 files migrate on load with `firstSeenAt` synthesized at the migration moment; prune-on-load drops entries outside the recency window so the map cannot grow without bound (D6, D7).

### Changes Required:

#### 1. State v2 schema + migration + prune
**File**: `src/state.ts`
**Changes**: no source fence in the design — the test fence below is the executable contract, and D6/D7 fix the shape. Ships: `CURRENT_STATE_VERSION = 2`; the `AppState.seenPostIds` map shape (id → ISO string); `migrateState(raw, now)` migrates a v1 id array to a v2 map stamped at the injected now (string and safe-integer ids both migrate) and throws naming the fault for a v1 non-array, invalid v1 items, a v2 non-object, unparseable v2 timestamps, and missing/fractional/unsupported versions; `pruneState(state, recencyHours, now)` keeps entries at-or-newer than the cutoff (now − recencyHours, inclusive) and keeps everything when the window is undefined/NaN/non-positive; `loadState(path, recencyHours?, now?)` migrates then prunes (ENOENT → empty v2 state), following the trailing-injection convention; `diffNew`/`diffNewIds` derive from the map (input order, `diffNewIds` dedupes); `saveState` stamps new ids via its injected clock and keeps its internal empty/all-seen write gates. The temp-name bug is Phase 5's.

#### 2. v2 gate, migration, diff, prune, loadState pins
**File**: `tests/state.test.ts`
**Changes**: gates rewritten for the v2 shape; `migrateState` v1→v2 direct tests; prune boundary tests on a pinned clock. The design's merged Slice 4+5 fence splits across Phases 4 and 5 at describe boundaries: this phase lands the v2-core import subset, fixtures, and the `saveState`/`diffNew`/`diffNewIds`/`migrateState`/`pruneState`/`loadState` describes; Phase 5 extends the imports and appends the `stateTempPath`/`writeStateAtomic` describes. (The union across both phases equals the design's merged fence.)

```ts
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type AppState,
  CURRENT_STATE_VERSION,
  diffNew,
  diffNewIds,
  loadState,
  migrateState,
  pruneState,
  saveState,
} from "../src/state.js";
import type { Post } from "../src/types.js";

// Files live in the OS temp dir; the suite cleans up once (offline test rule).
let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

// Pinned clock (UTC): 2026-10-26T09:14:00.000Z.
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const STATE: AppState = {
  version: CURRENT_STATE_VERSION,
  seenPostIds: { "1": iso(NOW - HOUR), "2": iso(NOW - HOUR) },
};

const post = (id: string): Post => ({
  id,
  text: `post ${id}`,
  author: "tester",
  permalink: `https://www.threads.com/@tester/post/${id}`,
  timestamp: iso(NOW - HOUR),
});

/** Temp state file path; seeds the file with raw JSON when given. */
async function tempStateFile(name: string, initial?: unknown): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-state-"));
  const path = join(dir, name);
  if (initial !== undefined) {
    await writeFile(path, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  }
  return path;
}

describe("saveState", () => {
  it("skips the disk write when newIds is empty", async () => {
    const path = await tempStateFile("empty-gate.json"); // no file exists yet
    const result = await saveState(STATE, [], path);
    assert.equal(result.saved, false);
    assert.equal(result.addedCount, 0);
    await assert.rejects(() => readFile(path, "utf8"), /ENOENT/); // file never created
  });

  it("skips the disk write when every id is already seen", async () => {
    const path = await tempStateFile("all-seen.json", STATE);
    const before = await readFile(path, "utf8");
    const result = await saveState(STATE, ["1", "2"], path);
    assert.equal(result.saved, false);
    assert.equal(result.addedCount, 0);
    assert.equal(await readFile(path, "utf8"), before); // byte-identical
  });

  it("records only the unseen ids, stamped by the injected clock, and round-trips through loadState", async () => {
    const path = await tempStateFile("positive.json", STATE);
    const result = await saveState(STATE, ["2", "3"], path, NOW);
    assert.equal(result.saved, true);
    assert.equal(result.addedCount, 1);
    assert.equal(result.state.version, CURRENT_STATE_VERSION);
    assert.deepEqual(result.state.seenPostIds, {
      "1": iso(NOW - HOUR),
      "2": iso(NOW - HOUR),
      "3": iso(NOW),
    });
    const reloaded = await loadState(path);
    assert.equal(reloaded.version, CURRENT_STATE_VERSION);
    assert.deepEqual(reloaded.seenPostIds, result.state.seenPostIds);
  });
});

describe("diffNew", () => {
  it("keeps only posts whose id is absent from the v2 map, in input order", () => {
    const posts = [post("1"), post("2"), post("3")];
    assert.deepEqual(diffNew(STATE, posts).map((p) => p.id), ["3"]);
  });
});

describe("diffNewIds", () => {
  it("keeps only unseen ids, deduped, in input order", () => {
    assert.deepEqual(diffNewIds(STATE, ["2", "3", "3", "4"]), ["3", "4"]);
  });
});

describe("migrateState", () => {
  it("migrates a v1 id array to a v2 map stamped at the migration moment", () => {
    const migrated = migrateState({ version: 1, seenPostIds: ["a", 123] }, NOW);
    assert.equal(migrated.version, CURRENT_STATE_VERSION);
    assert.deepEqual(migrated.seenPostIds, {
      a: iso(NOW),
      "123": iso(NOW),
    });
  });

  it("round-trips a valid v2 map unchanged", () => {
    const raw = { version: 2, seenPostIds: { a: iso(NOW - 5 * HOUR), b: iso(NOW) } };
    assert.deepEqual(migrateState(raw, NOW), raw);
  });

  it("throws when a v1 seenPostIds is not an array", () => {
    assert.throws(
      () => migrateState({ version: 1, seenPostIds: { a: iso(NOW) } }, NOW),
      /seenPostIds must be an array/,
    );
  });

  it("throws naming the item when a v1 entry is neither string nor safe integer", () => {
    assert.throws(
      () => migrateState({ version: 1, seenPostIds: [true] }, NOW),
      /invalid post ID/,
    );
  });

  it("throws when a v2 seenPostIds is not an object", () => {
    assert.throws(
      () => migrateState({ version: 2, seenPostIds: ["a"] }, NOW),
      /seenPostIds must be an object/,
    );
  });

  it("throws naming the id when a v2 timestamp is unparseable", () => {
    assert.throws(
      () => migrateState({ version: 2, seenPostIds: { a: "not-a-date" } }, NOW),
      /invalid seenPostIds entry for post ID "a"/,
    );
  });

  it("throws on a missing, fractional, or unsupported version", () => {
    assert.throws(() => migrateState({}, NOW), /invalid or missing schema version/);
    assert.throws(
      () => migrateState({ version: 1.5, seenPostIds: [] }, NOW),
      /invalid or missing schema version/,
    );
    assert.throws(
      () => migrateState({ version: 99, seenPostIds: {} }, NOW),
      /unsupported schema version: 99/,
    );
  });
});

describe("pruneState", () => {
  it("drops entries strictly older than the window and keeps the cutoff entry", () => {
    const state: AppState = {
      version: CURRENT_STATE_VERSION,
      seenPostIds: {
        fresh: iso(NOW),
        edge: iso(NOW - 72 * HOUR), // exactly at the cutoff — kept (>= cutoff)
        older: iso(NOW - 72 * HOUR - 1), // one millisecond past — dropped
        ancient: iso(NOW - 30 * 24 * HOUR),
      },
    };

    const pruned = pruneState(state, 72, NOW);
    assert.equal(pruned.version, CURRENT_STATE_VERSION);
    assert.deepEqual(pruned.seenPostIds, {
      fresh: iso(NOW),
      edge: iso(NOW - 72 * HOUR),
    });
  });

  it("keeps everything when the window is undefined, non-finite, or non-positive", () => {
    const state: AppState = {
      version: CURRENT_STATE_VERSION,
      seenPostIds: { a: iso(NOW - 1000 * HOUR) },
    };
    assert.deepEqual(pruneState(state, undefined, NOW), state);
    assert.deepEqual(pruneState(state, Number.NaN, NOW), state);
    assert.deepEqual(pruneState(state, 0, NOW), state);
  });
});

describe("loadState", () => {
  it("returns the empty v2 state when the file does not exist", async () => {
    const path = await tempStateFile("absent.json");
    assert.deepEqual(await loadState(path, 72, NOW), {
      version: CURRENT_STATE_VERSION,
      seenPostIds: {},
    });
  });

  it("migrates a seeded v1 file to v2 stamped at the load clock", async () => {
    const path = await tempStateFile("legacy.json", { version: 1, seenPostIds: ["a"] });
    const state = await loadState(path, 72, NOW);
    assert.equal(state.version, CURRENT_STATE_VERSION);
    assert.deepEqual(state.seenPostIds, { a: iso(NOW) });
  });

  it("prunes a seeded v2 file against the recency window", async () => {
    const path = await tempStateFile("stale.json", {
      version: 2,
      seenPostIds: { keep: iso(NOW - HOUR), drop: iso(NOW - 100 * HOUR) },
    });
    const state = await loadState(path, 72, NOW);
    assert.deepEqual(state.seenPostIds, { keep: iso(NOW - HOUR) });
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] `grep -n "seenPostIds: string\[\]" src/state.ts` returns nothing (the v2 map shape replaced the array)
- [x] `grep -n "CURRENT_STATE_VERSION = 2" src/state.ts` returns exactly one match
- [x] migrateState pins: v1 array -> v2 map stamped at the injected now (string and safe-integer ids both migrate); a valid v2 map round-trips unchanged; v1 non-array, v2 non-object, unparseable v2 timestamp, invalid v1 item, missing/fractional version, and unsupported version each throw with a message naming the fault
- [x] pruneState boundary pins: an entry exactly at the cutoff (now - 72h) survives, one millisecond older is dropped, surviving entries keep their exact timestamps; undefined / NaN / 0 windows keep everything
- [x] loadState pins: ENOENT returns the empty v2 state; a seeded v1 file loads as v2 stamped at the load clock; a seeded v2 file loads pruned against the window
- [x] diffNew / diffNewIds derive from the map: unseen ids come back in input order and diffNewIds dedupes
- [x] saveState pins rewritten for v2: empty newIds never creates the file; all-seen leaves it byte-identical; fresh ids land as map entries stamped by the injected clock and round-trip through loadState
- [x] `grep -n 'seenPostIds: { "1": iso' tests/state.test.ts` returns exactly one match (the STATE fixture carries the v2 map shape)

#### Manual Verification:
- [ ] Deferred to Slice 7's dispatch run: a production run loads the committed v1 file (count it first: `jq '.seenPostIds | length' state/seen-posts.json` — the live count has grown past the design's 281-entry snapshot), migrates in memory, and the next write commits a v2 file — `jq '.version' state/seen-posts.json` prints 2 and `jq '.seenPostIds | length'` still prints that count

---


## Phase 5: State hardening

Depends on: Phase 4 (hardening extends the v2 schema).

### Overview

The atomic write stops sharing one literal temp path (the 20478d1 bug, introduced by a biome reformat and never caught because no test imported the write path): `stateTempPath` mints a distinct sibling per write inside the state directory, and the failure paths clean up and name the target.

### Changes Required:

#### 1. Distinct temp names + pinned failure paths
**File**: `src/state.ts`
**Changes**: no source fence in the design — the test fence below is the executable contract. Ships: an exported `stateTempPath(dir, nowMs)` — dot + injected-ms + random + `.tmp`, built inside the given dir (never os.tmpdir()), distinct across calls; `writeStateAtomic` builds its temp path only through `stateTempPath` (the non-interpolating `join(dir, "...")` literal is gone); a rename failure removes the temp file and rejects with `state: atomic write failed for <target>` naming the target; a state-directory creation failure rejects with the same namespaced message naming the target. No v2-core assertion from Phase 4 weakens.

#### 2. Temp-name + atomic-write pins
**File**: `tests/state.test.ts`
**Changes**: the suite imports `writeStateAtomic` for the first time (the 20478d1 lesson — it previously never did); imports gain `mkdir`/`readdir` and `basename`/`dirname` plus both new exports; two describes append after the Phase 4 describes (union with Phase 4 equals the design's merged fence):

```ts
// --- Import deltas, merged into the Phase 4 import block ---
//   node:fs/promises gains mkdir and readdir:
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
//   node:path gains basename and dirname:
import { basename, dirname, join } from "node:path";
//   the ../src/state.js import gains both new exports:
import {
  type AppState,
  CURRENT_STATE_VERSION,
  diffNew,
  diffNewIds,
  loadState,
  migrateState,
  pruneState,
  saveState,
  stateTempPath,
  writeStateAtomic,
} from "../src/state.js";

describe("stateTempPath", () => {
  it("returns distinct sibling paths across writes (the 20478d1 contract)", () => {
    const first = stateTempPath("state-dir", NOW);
    const second = stateTempPath("state-dir", NOW);
    assert.notEqual(first, second); // distinct per write — never one literal temp path
    assert.match(basename(first), /^\.\d+\.[a-z0-9]+\.tmp$/u);
    assert.equal(dirname(first), "state-dir"); // inside the given dir, never os.tmpdir()
    assert.equal(dirname(second), "state-dir");
  });

  it("renders the injected clock as the ms component of the name", () => {
    const name = basename(stateTempPath("state-dir", NOW));
    assert.ok(name.startsWith(`.${NOW}.`), name);
  });
});

describe("writeStateAtomic", () => {
  it("removes the temp file and names the target when rename fails", async () => {
    const seeded = await tempStateFile("rename-fail.json", STATE);
    const base = dirname(seeded);
    const target = join(base, "target-is-a-directory");
    await mkdir(target); // a directory at the target path forces rename to fail

    await assert.rejects(() => writeStateAtomic(STATE, target), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^state: atomic write failed for /);
      assert.ok(error.message.includes("target-is-a-directory"));
      return true;
    });
    const leftovers = (await readdir(base)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []); // cleanup ran — no orphan temp file
  });

  it("names the target when the state directory cannot be created", async () => {
    const seeded = await tempStateFile("mkdir-fail.json", STATE);
    const base = dirname(seeded);
    const blockedDir = join(base, "blocked-file");
    await writeFile(blockedDir, "a file, not a directory", "utf8");
    const target = join(blockedDir, "state.json");

    await assert.rejects(() => writeStateAtomic(STATE, target), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^state: atomic write failed for /);
      assert.ok(error.message.includes("state.json"));
      return true;
    });
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] `grep -n 'join(dir, "' src/state.ts` returns nothing — the non-interpolating literal temp path is gone; path building lives only inside stateTempPath
- [x] `grep -n "function stateTempPath" src/state.ts` returns exactly one match (the export) and `grep -n "const tempPath = stateTempPath(dir," src/state.ts` returns exactly one match (the writeStateAtomic call site; the two-arg call satisfies the prefix)
- [x] `grep -rn "writeStateAtomic" tests/state.test.ts` returns at least one match — the suite imports and pins it (it previously never did; the 20478d1 lesson)
- [x] stateTempPath pins: two calls with the same dir and injected clock return distinct paths; the name matches dot + ms + random + .tmp; dirname of both results equals the given dir argument, never os.tmpdir()
- [x] writeStateAtomic pins: rename failure (target path occupied by a directory) rejects with "state: atomic write failed for" naming the target and leaves zero .tmp files behind; mkdir failure (state dir path occupied by a file) rejects with the same namespaced message
- [x] Slice 4 pins still hold unchanged — this slice rewrites the merged fences and weakens no v2-core assertion

#### Manual Verification:
- [ ] Deferred to Slice 7's dispatch run: after a production run, `git status --short state/` shows no .tmp files (a crashed write may leave exactly one orphan named .<ms>.<random>.tmp, never a partial seen-posts.json)

---


## Phase 6: Pipeline gates + stage timers

Depends on: Phases 1, 3, 4, and 5 (the pipeline wires the judge config, the Phase 3 factory types, v2 load with prune, and Gate 2 persistence).

### Overview

The pipeline wires it together: Gate 2 persists judged ids on zero-match runs — heartbeat first, then state, before the return — so no judged post is ever fed to the LLM twice (D7, D8); `loadState` is fed `recencyHours` + the clock (prune-on-load); every stage await logs its duration through an injectable `timeStage` clock (D9); the judge call passes `parseJudgeConcurrency(env)` (D1'); `main()` becomes the exported, injectable `runWatcher(deps)` and the rotation-exhaustion alarm (best-effort email, exit 1) moves into an `import.meta.url` entry guard so importing the module stays side-effect free.

### Changes Required:

#### 1. runWatcher seam + Gate 2 + stage timers
**File**: `src/index.ts`
**Changes**: imports gain `pathToFileURL`, the `Transporter` type, `sendExhaustionEmail`/`isRotationExhausted`, and `parseJudgeConcurrency`; the heartbeat wrapper takes env/clock/transport from `WatcherDeps`; `timeStage`, `WatcherDeps`, and `WatcherRun` export; `runWatcher` replaces `main()` with the Gate 2 branch persisting after the heartbeat await, the shared `persistJudged` tail, and the fetch/judge calls threaded through deps; the entry guard preserves the rotation-exhaustion branch verbatim.

```ts
// --- Import block + module docblock. node:url (the entry guard), the
//     Transporter type, the rotation error guard + alarm sender, and
//     parseJudgeConcurrency join; config, fetch-threads, judge, and state
//     imports gain types. The rewritten docblock keeps its position. ---
import { pathToFileURL } from "node:url";
import type { Transporter } from "nodemailer";
import {
  type ResolvedSurface,
  type WatcherConfig,
  loadWatcherConfig,
  resolveSurfaces,
} from "./config-file.js";
import { STATE_PATH, isHeartbeatEnabled, runUrlFromEnv } from "./config.js";
import { resolveEmailConfig, sendDigest, sendExhaustionEmail } from "./email.js";
/**
 * CLI entry point: the full pipeline (FRD #1-#9; fast-workflow-runtime
 * D7-D9; rotation exhaustion path).
 *
 * fetch → extract → dedupe vs state → judge → notify → state commit. Every
 * stage logs its counts and its duration; any thrown error exits non-zero
 * and leaves state untouched (persistence is ordered after the notification
 * send, so a failed run never marks posts seen).
 *
 * Persistence (D7/D8): EVERY judged post id is persisted — including
 * zero-match runs — so no judged post is ever fed to the LLM twice.
 * Skipped ids stay unseen and retry next run. A run whose LLM_ACCOUNTS
 * pool is exhausted throws the tagged RotationExhausted error: the alarm
 * email is best-effort and the run exits 1 (state was never reached).
 *
 * What to watch and how to filter comes from watcher.config.json (Phase 10),
 * loaded once at startup. A missing or malformed file fails the run.
 */
import { extractPosts } from "./extract.js";
import {
  type ContextFactory,
  fetchSurfaces,
  fetchSurfacesAuthenticated,
} from "./fetch-threads.js";
import { type HeartbeatStats, selectCandidates, sendHeartbeat } from "./heartbeat.js";
import {
  type JudgedPost,
  isRotationExhausted,
  judgePosts,
  parseJudgeConcurrency,
  resolveJudgeConfig,
} from "./judge.js";
import { filterRecent } from "./recency.js";
import { type AppState, diffNew, loadState, saveState } from "./state.js";
import { resolveSession } from "./threads-session.js";
import type { Post } from "./types.js";

// --- heartbeat wrapper: env, the clock, and the transport become
//     parameters, threaded from WatcherDeps. Everything else unchanged. ---
async function heartbeat(
  stats: HeartbeatStats,
  recent: readonly Post[],
  judged: readonly Post[],
  candidateTerms: readonly string[],
  env: Record<string, string | undefined>,
  now: () => number,
  transport?: Transporter,
): Promise<void> {
  if (!isHeartbeatEnabled(env)) {
    console.log("heartbeat: disabled by HEARTBEAT_ENABLED");
    return;
  }
  try {
    const config = resolveEmailConfig(env);
    const candidates = selectCandidates(recent, judged, candidateTerms);
    await sendHeartbeat(stats, candidates, config, now(), transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`heartbeat: not sent — ${message}`);
  }
}

// --- New: stage timer + the unit seam types (D9) ---

/**
 * Run one pipeline stage and report its wall-clock duration (D9). The clock
 * is injectable so tests assert durations without waiting; production
 * passes nothing and measures real time. The caller logs the returned
 * durationMs — one order-stable line per stage await, at stage level only
 * (inner logs interleave once stages do real work).
 */
export async function timeStage<T>(
  run: () => Promise<T>,
  now: () => number = Date.now,
): Promise<{ value: T; durationMs: number }> {
  const startedAtMs = now();
  const value = await run();
  return { value, durationMs: Math.max(0, now() - startedAtMs) };
}

/**
 * Injectable dependencies for one watcher run; every field has the
 * production default the pipeline uses when omitted. This is the unit seam
 * the offline suite operates (tests/index.test.ts): env, config, surface
 * fetch, LLM transport, SMTP transport, state file, and the clock all
 * inject, so a full pipeline run executes offline.
 */
export interface WatcherDeps {
  /** Environment record for every resolver. Default: process.env. */
  readonly env?: Record<string, string | undefined>;
  /** Pre-resolved watcher config. Default: loadWatcherConfig() — fail-visible. */
  readonly config?: WatcherConfig;
  /** Browser-context factory for the surface walks (Slice 3 seam). Default: chromiumContextFactory. */
  readonly contextFactory?: ContextFactory;
  /** LLM HTTP transport. Default: global fetch. */
  readonly fetchFn?: typeof fetch;
  /** SMTP transport for the digest and the heartbeat. Default: nodemailer. */
  readonly transport?: Transporter;
  /** State file path. Default: STATE_PATH (the commit-back location). */
  readonly statePath?: string;
  /** Clock for recency, prune, state stamps, and heartbeat ages. Default: Date.now. */
  readonly now?: () => number;
}

/** Funnel outcome of one run: the summary handle tests assert on. */
export interface WatcherRun {
  /** Posts sent to the LLM judge (recency + seen survivors). */
  judged: number;
  /** Posts the judge marked relevant AND located. */
  matches: number;
  /** Posts the judge could not evaluate (they stay unseen). */
  skipped: number;
  /** Whether this run persisted judged ids to the state file. */
  saved: boolean;
}

// --- main() becomes the exported, injectable runWatcher (full
//     replacement). Stage awaits gain timeStage timers; loadState is fed
//     recencyHours (prune-on-load); Gate 2 persists after the heartbeat
//     await, before the return; the judge call passes the parsed width. ---
export async function runWatcher(deps: WatcherDeps = {}): Promise<WatcherRun> {
  const env = deps.env ?? process.env;
  const config = deps.config ?? (await loadWatcherConfig());
  const now = deps.now ?? Date.now;
  const statePath = deps.statePath ?? STATE_PATH;
  const startedAt = now();
  const surfaces = resolveSurfaces(config.surfaces);
  console.log(`watch: surfaces: ${surfaces.map((s) => s.label).join(", ")}`);

  // Acquisition stage (D9): session resolution + surface fetch timed as one
  // span. Extraction happens inside the walk; the dedupe count logs right
  // after the duration line.
  const { value: collected, durationMs: fetchMs } = await timeStage(async () => {
    const sessionPath = await resolveSession(env);
    return sessionPath !== null
      ? await fetchSurfacesAuthenticated(surfaces, sessionPath, deps.contextFactory)
      : await fetchLoggedOutPosts(surfaces, deps.contextFactory);
  });
  console.log(`timing: fetch ${fetchMs}ms`);
  const posts = dedupePosts(collected);
  console.log(`extract: ${posts.length} unique post(s) across ${surfaces.length} surface(s)`);

  const recencyHours = config.recencyHours;
  const recent = filterRecent(posts, recencyHours, now());
  console.log(`recency: ${recent.length} post(s) within ${recencyHours}h`);

  // exactOptionalPropertyTypes: attach runUrl only when the ambient
  // GITHUB_* variables are present (a local run has none).
  const runUrl = runUrlFromEnv(env);

  const stats: HeartbeatStats = {
    ranAt: new Date(startedAt).toISOString(),
    unique: posts.length,
    recent: recent.length,
    recencyHours,
    judged: 0,
    relevantLocated: 0,
    skipped: 0,
    ...(runUrl !== undefined ? { runUrl } : {}),
  };

  // Prune-on-load (D6/D7): state entries outside the recency window drop
  // before dedupe, so the seen map cannot grow without bound.
  const state = await loadState(statePath, recencyHours, now());
  const newPosts = diffNew(state, recent);
  stats.judged = newPosts.length;
  if (newPosts.length === 0) {
    // Gate 1 (zero unseen): nothing was judged, so nothing persists — the
    // state file stays byte-identical. The heartbeat still runs (timed).
    const { durationMs: notifyMs } = await timeStage(() =>
      heartbeat(stats, recent, newPosts, config.candidateTerms, env, now, deps.transport),
    );
    console.log(`timing: notify ${notifyMs}ms`);
    console.log("no new matches");
    return { judged: 0, matches: 0, skipped: 0, saved: false };
  }
  console.log(`state: ${newPosts.length} unseen post(s)`);

  const { value: judgeOutcome, durationMs: judgeMs } = await timeStage(() =>
    judgePosts(
      newPosts,
      resolveJudgeConfig(env),
      config.keywords,
      deps.fetchFn,
      parseJudgeConcurrency(env),
    ),
  );
  console.log(`timing: judge ${judgeMs}ms`);
  const { judged, skippedPostIds } = judgeOutcome;
  const matches = judged
    .filter((j) => j.verdict.relevant && j.verdict.locationOk)
    .map((j) => j.post);
  stats.relevantLocated = matches.length;
  stats.skipped = skippedPostIds.length;
  console.log(
    `judge: ${newPosts.length} candidate(s) judged, ${matches.length} relevant+located, skipped: ${skippedPostIds.length}`,
  );

  if (matches.length === 0) {
    // Gate 2 (D7/D8): the run JUDGED these posts even though none matched.
    // Persist every judged id — heartbeat first, then state, mirroring the
    // notification-before-persistence convention — so the next run never
    // feeds the same posts to the LLM again. Skipped ids stay unseen and
    // retry next run (D3).
    const { durationMs: notifyMs } = await timeStage(() =>
      heartbeat(stats, recent, newPosts, config.candidateTerms, env, now, deps.transport),
    );
    console.log(`timing: notify ${notifyMs}ms`);
    const saved = await persistJudged(state, judged, statePath, now());
    console.log("no new matches");
    return {
      judged: newPosts.length,
      matches: 0,
      skipped: skippedPostIds.length,
      saved,
    };
  }

  // Email before state: a failed send exits non-zero and leaves state
  // untouched, so the next run re-judges and re-sends these matches (D3, D8).
  const { durationMs: notifyMs } = await timeStage(() =>
    sendDigest(matches, resolveEmailConfig(env), deps.transport),
  );
  console.log(`timing: notify ${notifyMs}ms`);
  const saved = await persistJudged(state, judged, statePath, now());
  return {
    judged: newPosts.length,
    matches: matches.length,
    skipped: skippedPostIds.length,
    saved,
  };
}

// --- New: the shared persistence tail (D8) ---

/**
 * Stamp every judged id — relevant or not — as seen (D8) and log the delta.
 * Skipped ids never reach this call, so they stay unseen and retry next run
 * (D3). saveState keeps its internal gate: an empty id list writes nothing.
 */
async function persistJudged(
  state: AppState,
  judged: readonly JudgedPost[],
  filePath: string,
  nowMs: number,
): Promise<boolean> {
  const judgedIds = judged.map((entry) => entry.post.id);
  const result = await saveState(state, judgedIds, filePath, nowMs);
  console.log(`state: ${result.addedCount} new seen post id(s)`);
  return result.saved;
}

// --- fetchLoggedOutPosts: ONLY the signature and the fetchSurfaces call
//     line change; the body is unchanged ---
async function fetchLoggedOutPosts(
  surfaces: readonly ResolvedSurface[],
  contextFactory?: ContextFactory,
): Promise<Post[]> {
  const fetched = await fetchSurfaces(surfaces, contextFactory);

// --- Entry guard: replaces the rotation-era main() + main().catch tail.
//     The rotation-exhaustion branch (alarm email best-effort, exit 1) is
//     preserved verbatim inside the guard. The pipeline runs only when this
//     file is the entry module (npm start, watch.yml); importing the module
//     — as tests/index.test.ts does — stays side-effect free. ---
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatcher().catch(async (error: unknown) => {
    // Pool exhausted: one alarm email, then the standard failed-run exit.
    // The email is best-effort — a broken GMAIL_* configuration must not
    // mask the exit code the run already earned. State was never reached
    // (the throw happened in the judge stage), so no post is marked seen
    // (D3, D8).
    if (isRotationExhausted(error)) {
      console.error(`watch: FAILED — ${error.message}`);
      try {
        await sendExhaustionEmail(error.failures, resolveEmailConfig(process.env));
      } catch (emailError) {
        const emailMessage = emailError instanceof Error ? emailError.message : String(emailError);
        console.warn(`email: exhaustion alarm not sent — ${emailMessage}`);
      }
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`watch: FAILED — ${message}`);
    process.exit(1);
  });
}
```


#### 2. Offline pipeline suite
**File**: `tests/index.test.ts` (NEW)
**Changes**: new offline suite at the unit seam — every I/O boundary injects (env literal, context-factory double, fetch double, transport double, temp state file, pinned clock), so a full pipeline run executes with zero network, zero browser, and zero writes inside the repo.

```ts
/**
 * Offline pipeline suite for the Gate 2 unit seam (Slice 6, D7-D9).
 * runWatcher takes every I/O boundary as an injection — env literal,
 * context-factory double, fetch double, transport double, temp state file,
 * pinned clock — so a full pipeline run executes with zero network, zero
 * browser, and zero writes inside the repo. Covers: the zero-match run
 * persisting judged ids (Gate 2), the digest path, the all-seen Gate 1
 * byte-identity, heartbeat-disabled persistence, judge-skip persistence
 * (D3), and the timeStage duration measurement.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import type { WatcherConfig } from "../src/config-file.js";
import {
  type ContextFactory,
  type ContextLike,
  type LocatorLike,
  type PageLike,
  type ResponseLike,
} from "../src/fetch-threads.js";
import { runWatcher, timeStage } from "../src/index.js";
import type { AppState } from "../src/state.js";
import type { JudgeVerdict } from "../src/types.js";

// Pinned clock (UTC): 2026-10-26T09:14:00.000Z — every stage reads it
// through deps.now; the tests never touch the system clock.
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: ["hiring", "loker"],
  surfaces: [{ type: "tag", value: "hiring" }],
  recencyHours: 72,
};

const BASE_ENV: Record<string, string | undefined> = {
  THREADS_SESSION_STATE: Buffer.from(
    JSON.stringify({ cookies: [{ name: "session", value: "x" }] }),
  ).toString("base64"),
  LLM_ACCOUNTS: JSON.stringify([
    { baseUrl: "https://mock.api/v1", apiKey: "test-key", model: "test-model" },
  ]),
  GMAIL_USER: "alerts@example.com",
  GMAIL_APP_PASSWORD: "app-password",
};

/** 19-digit post id, mirroring the judge tests' helper. */
const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

/** Minimal graphql capture body: one thread_item per post, 1h old. */
const graphqlBody = (entries: ReadonlyArray<{ id: string; text: string }>): string =>
  JSON.stringify({
    data: {
      thread_items: entries.map((entry) => ({
        post: {
          pk: entry.id,
          caption: { text: entry.text },
          user: { username: `author-${entry.id.slice(-2)}` },
          taken_at: Math.floor((NOW - HOUR) / 1000),
        },
      })),
    },
  });

/** Response double the walk's graphql filter accepts. */
const graphqlResponse = (body: string): ResponseLike => ({
  url: () => "https://www.threads.com/api/graphql",
  status: () => 200,
  text: async () => body,
});

/** Recent-tab locator that never becomes visible (both walks tolerate it). */
const missingTab = (): LocatorLike => {
  const tab: LocatorLike = {
    first: () => tab,
    waitFor: async () => {
      throw new Error("locator not found");
    },
    click: async () => undefined,
  };
  return tab;
};

/**
 * Context factory double for the authenticated walk: one page whose goto
 * fires the response listener with the given graphql capture.
 */
function singlePageContextFactory(capture: string): ContextFactory {
  return async () => {
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        const listeners: Array<(response: ResponseLike) => void> = [];
        return {
          goto: async () => {
            const response = graphqlResponse(capture);
            for (const listener of listeners) listener(response);
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => missingTab(),
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

/** Chat-completions 200 response carrying one message. */
const ok = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

/**
 * Chat-completions double: bulk calls answer every listed id with the given
 * verdict; single-post fallbacks answer the plain verdict object.
 */
function judgeFetch(verdict: JudgeVerdict): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each Threads post below")) {
      const ids = content.match(/\b\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) answer[id] = verdict;
      return ok(JSON.stringify(answer));
    }
    return ok(JSON.stringify(verdict));
  }) as unknown as typeof fetch;
}

/**
 * Bulk answers exactly the ids present in the verdict map (missing ids stay
 * absent — the post falls back); single-post retries fail with a 500 so the
 * fallback exhausts and the post is skipped (D3). The 500 shape and its
 * bounded backoff are the same pin the judge suite already ships.
 */
function partialBulkThenFailFetch(verdicts: Record<string, JudgeVerdict>): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each Threads post below")) {
      const ids = content.match(/\b\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) {
        const verdict = verdicts[id];
        if (verdict !== undefined) answer[id] = verdict;
      }
      return ok(JSON.stringify(answer));
    }
    return new Response("Internal Server Error", { status: 500 });
  }) as unknown as typeof fetch;
}

/** Transport double recording subject lines (capture-closure idiom). */
function recordingTransport() {
  const subjects: string[] = [];
  const transport = {
    sendMail: async (options: { subject: string }) => {
      subjects.push(options.subject);
      return { messageId: "msg-1" };
    },
  } as unknown as Transporter;
  return { transport, subjects };
}

// Temp state files (offline rule: OS temp only, cleaned up once).
let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Temp state file path; seeds the file with a state document when given. */
async function tempStatePath(name: string, seed?: AppState): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));
  const path = join(dir, name);
  if (seed !== undefined) {
    await writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  }
  return path;
}

describe("runWatcher", () => {
  it("persists judged ids on a zero-match run and still sends the heartbeat (Gate 2)", async () => {
    const posts = [
      { id: id19(1), text: "Looking for work as a frontend developer" },
      { id: id19(2), text: "Selling an ergonomic chair, barely used" },
    ];
    const statePath = await tempStatePath("gate2-zero-match.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 0, skipped: 0, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.equal(stored.version, 2);
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(1), id19(2)]);
    assert.equal(subjects.length, 1); // Gate 2 skips neither email nor write
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("sends the digest and persists judged ids when posts match", async () => {
    const posts = [
      { id: id19(3), text: "Hiring: senior backend engineer, remote in Indonesia" },
      { id: id19(4), text: "Hiring: frontend developer in Jakarta" },
    ];
    const statePath = await tempStatePath("match-digest.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 2, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /2 new job posts/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(3), id19(4)]);
  });

  it("leaves the state file byte-identical when everything is already seen (Gate 1) and still sends the heartbeat", async () => {
    const posts = [
      { id: id19(5), text: "Hiring: react developer, bandung on-site" },
      { id: id19(6), text: "Hiring: data analyst, remote" },
    ];
    const seed: AppState = {
      version: 2,
      seenPostIds: { [id19(5)]: iso(NOW - HOUR), [id19(6)]: iso(NOW - HOUR) },
    };
    const statePath = await tempStatePath("gate1-all-seen.json", seed);
    const before = await readFile(statePath, "utf8");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(await readFile(statePath, "utf8"), before);
    assert.equal(subjects.length, 1); // Gate 1 still notifies
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("still persists judged ids when the heartbeat is disabled", async () => {
    const posts = [{ id: id19(7), text: "Junior QA engineer opening in Surabaya" }];
    const statePath = await tempStatePath("heartbeat-off.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: { ...BASE_ENV, HEARTBEAT_ENABLED: "false" },
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.equal(subjects.length, 0); // disabled — yet the state write still ran
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(7)]);
  });

  it("keeps judge-skipped ids unseen while persisting the judged rest (D3)", async () => {
    const posts = [
      { id: id19(8), text: "Hiring: golang engineer, remote" },
      { id: id19(9), text: "Hiring: vue developer in Bali" },
    ];
    const statePath = await tempStatePath("skip-d3.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: partialBulkThenFailFetch({ [id19(8)]: { relevant: true, locationOk: true } }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 1, skipped: 1, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(8)]); // the skipped id stays unseen
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
  });
});

describe("timeStage", () => {
  it("returns the stage value and its duration under an injected clock", async () => {
    let tick = 100;
    const { value, durationMs } = await timeStage(
      async () => {
        tick += 50;
        return "done";
      },
      () => tick,
    );
    assert.equal(value, "done");
    assert.equal(durationMs, 50);
  });

  it("never reports a negative duration when the clock steps back", async () => {
    let tick = 100;
    const { durationMs } = await timeStage(
      async () => {
        tick -= 5;
        return undefined;
      },
      () => tick,
    );
    assert.equal(durationMs, 0);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] `grep -n "loadState()" src/index.ts` returns nothing — the bare call is gone; the call passes `(statePath, recencyHours, now())` so prune-on-load is wired
- [x] `grep -c "async function main(" src/index.ts` returns 0 — the untestable entry function is gone (runWatcher is the seam)
- [x] `grep -c "timing: " src/index.ts` returns exactly 5 — fetch once, judge once, notify on all three exits (Gate 1, Gate 2, match)
- [x] `grep -c "persistJudged" src/index.ts` returns exactly 3 — the definition plus two call sites: one inside the zero-match branch after the heartbeat await, one after the sendDigest await
- [x] `grep -c "process.exit" src/index.ts` returns exactly 2 — both inside the entry guard (the rotation-exhaustion branch's exit plus the terminal failed-run exit)
- [x] `grep -n "isRotationExhausted" src/index.ts` returns at least one match — the entry guard routes RotationExhausted to the best-effort sendExhaustionEmail + exit 1 before the generic exit
- [x] `grep -n "LLM_BASE_URL" tests/index.test.ts` returns nothing — the env fixture feeds LLM_ACCOUNTS (rotation-era)
- [x] `grep -c "import.meta.url" src/index.ts` returns exactly 1 — importing the module never triggers a run
- [x] tests/index.test.ts covers: zero-match-but-judged persists ids and still sends the heartbeat; match run sends the digest and persists; all-seen Gate 1 leaves the file byte-identical and still sends the heartbeat; disabled heartbeat still persists; judge-skipped ids stay unseen while judged ids persist; timeStage returns value + duration under an injected clock and never a negative duration
- [x] `grep -rn "playwright" tests/index.test.ts` returns nothing (offline rule)
- [x] `grep -c "Date.now()" tests/index.test.ts` returns 0 (pinned-clock rule)

#### Manual Verification:
- [ ] Deferred to Slice 7's dispatch run: a production run's log carries `timing:` lines in stage order; a zero-match run commits judged ids and the next run shows them already seen (no re-judge)

---


## Phase 7: Workflow + docs

Depends on: Phases 1-6 (D10: workflow edits land as the terminal slice — the timeout cut is unsafe before the fast paths exist, precedent fda50c2).

### Overview

The workflow budget lands last: watch job timeout 45 → 8 with the pooled-math comment, the install step drops to `--only-shell`, and the probe-measured `JUDGE_CONCURRENCY` literal joins the env block as its first non-secret entry (D2, D8); the README gains the operator paragraph and the probe handoff.

### Changes Required:

#### 1. Workflow budget + width literal
**File**: `.github/workflows/watch.yml`
**Changes**: timeout 45 → 8 with the rewritten comment (:37-39); install step gains `--only-shell` with an in-file headless-only comment (:50-51); `JUDGE_CONCURRENCY: "8"` joins the Run watcher env block as its first entry, above every secret mapping (:53-59). Probe job and Commit state step untouched.

```yaml
# --- watch job timeout: 45 -> 8 with the pooled-math comment (:37-39) ---
  watch:
    runs-on: ubuntu-latest
    # Width-8 judge: 29 bulk calls clear in ~4 waves, width-4 surface pools
    # cut the ~3.5-min serial fetch to ~1 min, and the 40-call fallback
    # budget adds about a minute. The 8-minute cap keeps a hung run under
    # the 10-minute cron interval — it dies before the next tick queues.
    timeout-minutes: 8

# --- Install step: headless-only shell install with the in-file why (:50-51) ---
      - name: Install Playwright browser
        # The watcher is headless-only; the full browser build adds install
        # minutes to every run for nothing the pipeline drives.
        run: npx playwright install --with-deps --only-shell chromium

# --- Env block: the literal width joins as the first (non-secret) entry (:53-59) ---
      - name: Run watcher
        env:
          JUDGE_CONCURRENCY: "8"   # probe run 40268599609 successor — paste the measuring run's reading
          THREADS_SESSION_STATE: ${{ secrets.THREADS_SESSION_STATE }}
          LLM_ACCOUNTS: ${{ secrets.LLM_ACCOUNTS }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: npx tsx src/index.ts
```

#### 2. Operator note
**File**: `README.md`
**Changes**: setup step 2 gains one `JUDGE_CONCURRENCY` paragraph directly after the HEARTBEAT_ENABLED note: the tunable lives in watch.yml (one-line commit), the probe handoff (dispatch the probe job, paste the printed width), and the absent/invalid semantics matching `parseJudgeConcurrency` (absent → 4, invalid → throw naming the variable).

```markdown
   Tunable (a literal in `watch.yml`, not a secret): `JUDGE_CONCURRENCY` —
   how many bulk judge calls run at once. Measure it first: trigger
   **Actions → watch → Run workflow**; the dispatch-only probe job ramps
   concurrent calls against the endpoint and prints a recommended width.
   Paste that reading into the workflow's `JUDGE_CONCURRENCY` line, commit,
   push. With the line removed — or on a local run without the variable —
   the watcher judges 4 at a time; a non-positive-integer value fails the run
   and names the variable. Rolling the code back past v2 requires reverting
   `state/seen-posts.json` in the same commit — v1 code fails visibly with
   `unsupported schema version: 2`.
```

### Success Criteria:

#### Automated Verification:
- [x] Project baseline (terminal slice): `npm run typecheck`, `npm run lint`, `npm test` all pass
- [x] `grep -n "timeout-minutes: 8" .github/workflows/watch.yml` returns exactly one match — the watch job; the probe job keeps its 10
- [x] `grep -n "timeout-minutes: 45" .github/workflows/watch.yml` returns nothing
- [x] `grep -n "only-shell" .github/workflows/watch.yml` returns exactly one match — the Install Playwright browser run line
- [x] `grep -n "JUDGE_CONCURRENCY" .github/workflows/watch.yml` returns exactly one match — the first entry of the Run watcher env block, above every secret mapping, carrying a quoted literal value
- [x] The rewritten timeout comment names the pooled math (waves at the configured width, pooled fetch, fallback budget) and the 10-minute cron interval; the install step carries an in-file headless-only comment
- [x] `grep -n "JUDGE_CONCURRENCY" README.md` returns at least one match — the note tells the operator to paste the probe job's recommended width into the watch.yml line

#### Manual Verification:
- [ ] A dispatch run at the probe-measured width completes inside 8 minutes
- [ ] `npx playwright install --with-deps --only-shell chromium` satisfies a real run on the runner
- [ ] A zero-match run commits judged ids; the next run logs them already seen (no re-judge)
- [ ] The README probe instructions match the actual probe job (Actions → watch → Run workflow prints a recommended width)
- [ ] The same consolidated dispatch ticks the manual boxes Slices 1-6 deferred to it: the configured width is honored; the 40-call fallback budget holds against a degraded endpoint; pooled fetch wall-clock drops with no Threads rate-limit blowup; `jq '.version' state/seen-posts.json` prints 2 and `jq '.seenPostIds | length'` the entry count; `git status --short state/` shows no `.tmp` files; the log carries `timing:` lines in stage order

---

## Testing Strategy

### Automated:
- Every phase runs the project's own gates — `npm run typecheck`, `npm run lint`, `npm test` (offline, deterministic, read-only on the repo tree).
- Every phase's Success Criteria carry the design-authored grep pins (stale-doc checks, one-match export/call-site gates, fixture-shape gates).
- Every phase re-greps the design anchors it cites before editing (never edit by line number alone); Phase 1 also pins the probe file untouched.
- Phase 7 is the terminal slice: it runs the full project baseline (`npm run typecheck`, `npm run lint`, `npm test` all pass).

### Manual Testing Steps:
1. Trigger the dispatch-only probe job (Actions → watch → Run workflow); paste the printed recommended width into the watch.yml `JUDGE_CONCURRENCY` line.
2. One consolidated dispatch run ticks the manual boxes Phases 1-6 deferred to it: the configured width is honored; the 40-call fallback budget holds against a degraded endpoint; pooled fetch wall-clock drops with no Threads rate-limit blowup; `jq '.version' state/seen-posts.json` prints 2 and `jq '.seenPostIds | length'` prints the entry count; `git status --short state/` shows no `.tmp` files; the log carries `timing:` lines in stage order.
3. A zero-match run commits judged ids; the next run logs them already seen (no re-judge).
4. `npx playwright install --with-deps --only-shell chromium` satisfies a real run on the runner.

## Performance Considerations

- Fetch: serialized fixed waits (~2.7-4.4 min authenticated) drop roughly by the pool factor on the wait-bound portion; wall-clock target verified only by a dispatch run.
- Judge: width scales throughput linearly until the endpoint's real ceiling; only probe-measured widths ship (5f6a328: fixture probes under-measured 5.2×).
- Fallback: worst case drops from unbounded-serial to ~40 calls at the measured width; budget exhaustion leaves surplus posts unseen (retry next run).
- Prune: one Date.parse per entry per load — negligible at the expected file size (hundreds of entries).

## Migration Notes

- v1 → v2 happens on first load after deploy: migrateState synthesizes firstSeenAt at the migration moment for the legacy ids in the committed v1 file (count it first with `jq '.seenPostIds | length' state/seen-posts.json` — the live count has grown past the design's 281-entry snapshot). They are unprunable for 72h — safe, because filterRecent excludes them upstream before dedupe.
- Rollout window: the committed file is v1 until the first v2-writing run pushes; runs are serialized by the watch concurrency group, so an old reader never sees v2 in normal operation. A rollback to v1-only code with a v2 file on disk fails visibly ("unsupported schema version: 2") — the documented recovery is reverting the state file alongside the code.
- The commit-back contract survives: the key name seenPostIds is kept, and jq .seenPostIds | length counts object keys.

## Developer Context

- Step 5 triage (2026-10-27): design follow-up recorded — the design's Slice 6 `runWatcher` fence returns `judged: judged.length` at both exits while its own D3 pin requires the candidate count (`judged: 2` with 1 skipped). The plan patches both exits to `judged: newPosts.length`; the upstream design fence still carries `judged.length` and should be corrected at the next design touch.
- Advisor pass (2026-10-27): the burst pin's surviving batch originally answered a bare verdict on the bulk branch — parseBulkVerdicts would have matched nothing and all 10 posts silently taken the fallback path (green-but-hollow pin). Fixed to answer an id->verdict map keyed by the prompt's listed ids (the suite's judgeFetch idiom).

## References

- Design: `.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md`
- Solution: `.rpiv/artifacts/solutions/2026-10-26_16-02-28_fast-workflow-runtime.md`
- Research: `.rpiv/artifacts/research/2026-10-26_14-51-03_fast-workflow-runtime.md` (evidence base), `.rpiv/artifacts/research/2026-10-26_14-47-19_llm-account-rotation.md` (re-grounding deltas)
- FRD: `.rpiv/artifacts/discover/2026-10-26_14-21-44_fast-workflow-runtime.md`
- Prior plans: `.rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md` (pool/backoff/deferral origin), `.rpiv/artifacts/plans/2026-10-26_15-59-52_llm-account-rotation.md` (the landed rotation code)
- Guidance: `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/tests/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md`


## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents against the live codebase at HEAD (7dc0247). Findings triaged at Step 5._

| source   | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 3 §2 fence (line 727) | <n/a> | blocker | actionability | Unterminated template in the peak assertion: `pages never overlapped (peak ${concurrency.peak)` is missing the closing brace; the generated suite will not parse and typecheck fails | Restore the design's form: closing brace after concurrency.peak | applied: closing brace restored at line 727 |
| code | Phase 5 §2 fence (line 1162) | <n/a> | blocker | actionability | Unterminated template in the temp-name pin: `.${NOW.` opens an interpolation it never closes; the generated suite will not parse | Restore the design's form: closing brace after NOW, then the trailing dot | applied: closing brace restored at line 1162 |
| code | Phase 6 §1 fence (lines 1459, 1474) | src/judge.ts:161 | blocker | actionability | Both runWatcher exits return `judged: judged.length`, but JudgeBatchResult.judged counts only successful verdicts — Phase 6 §2's D3 pin (judged: 2, skipped: 1, 2 candidates) fails, and the fence contradicts its own WatcherRun.judged docblock ("posts sent to the LLM judge"). Design-root defect: the design's fence and its own Slice 6 test disagree | Return `judged: newPosts.length` at both exits (Gate 2 and match path) | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md — Slice 6 fence and its own D3 pin disagree on the judged count; both exits patched to newPosts.length) |
| coverage | design Verification Notes §2 → Phase 1 | <n/a> | blocker | verification-coverage | Re-verify-anchors intent ("re-grep anchors rather than trust artifact-internal numbers") has no landing spot; the plan carries anchors (:48, :171, :37-39, :50-51, :53-59) verbatim with no re-verification instruction (anchors verified accurate at HEAD, so the risk is latent) | Add one Phase 1 automated-verification bullet: re-grep the symbol each anchor cites before editing; never edit by line number alone; mirror in Testing Strategy | applied: Phase 1 bullet added + Testing Strategy mirror |
| coverage | design Verification Notes §3 → Phase 1 | <n/a> | blocker | verification-coverage | Probe-untouched intent (the probe keeps its `resolveJudgeConfig(...)[0]` destructuring; the width never reaches the probe) has no landing spot — no phase greps scripts/probe-judge.ts, and Phase 1 edits the module the probe imports | Add a Phase 1 automated-verification bullet: the probe still matches `resolveJudgeConfig(process.env)[0]` | applied: Phase 1 probe-untouched bullet added |
| code | Phase 1 AV | src/judge.ts:623 | concern | actionability | Verbatim criterion "both pool launches read the concurrency parameter" is unsatisfiable at Phase 1's checkpoint — HEAD has exactly one pool launch; the fallback pool exists only after Phase 2 | Reword Phase 1's criterion to "the bulk pool launch reads the concurrency parameter" (or move the half to Phase 2) | applied: bullet reworded; Phase 2's fallback parallelism pin already covers the second launch |
| code | Phase 5 AV | <n/a> | concern | actionability | The gate `grep -n "const tempPath = stateTempPath(dir)" src/state.ts` can never match the two-arg call the fence pins (stateTempPath(dir, nowMs)) — satisfiable only by silently making nowMs optional | Relax the grep to the prefix `const tempPath = stateTempPath(dir,` | applied: grep relaxed to the prefix; injected clock keeps flowing through the two-arg call |
| code | Phase 6 frontmatter | <n/a> | concern | actionability | depends_on omits Phase 3, yet the Phase 6 fences import ContextFactory/ContextLike/LocatorLike/PageLike/ResponseLike from ../src/fetch-threads.js — exports that exist only after Phase 3; parallel execution compiles Phase 6 against missing symbols | Add 3 to Phase 6's depends_on | applied: frontmatter depends_on now [1, 3, 4, 5]; overview and Phase 6 depends lines updated to match |
| code | Phase 3 §1 prose | src/fetch-threads.ts:157 | concern | code-quality | The prose never says how storageStatePath reaches the default Chromium factory; §2's doubles pin a zero-arg callable, so a conforming zero-arg factory passes every pin yet silently drops the session storage state (authenticated walks degrade to logged-out) | Pin the seam as `type ContextFactory = (storageStatePath?: string) => Promise<ContextLike>` in §1's prose (zero-arg doubles stay assignable; the default factory keeps the session) | applied: signature pinned in Phase 3 §1 prose |
| coverage | design Verification Notes §10 → Phase 2 | <n/a> | concern | verification-coverage | Risk watch "at higher width a 429 burst can defer K batches at once — backoff + whole-batch defer stay load-bearing (1d4faed)" has no pin at the elevated width; existing pins (tests/judge.test.ts:467, :674, :693) cover single-batch defer only | Add a Phase 2 automated pin: width > 1 where every in-flight bulk call 429s once — assert all K batches defer whole, zero fallback calls fire, judged/skipped reassemble in input order | applied: Phase 2 burst AV bullet + fence pin added (retryable-status spent-backoff defer, mirroring the shipped defer pin) |
| coverage | Phase 4 MV + plan Migration Notes | state/seen-posts.json | concern | verification-coverage | "281-entry v1 file" is a stale snapshot count — the live committed file carries ~1,394 entries; the migrate → jq version → jq length mechanism is count-agnostic and survives, but an operator comparing against 281 misreads the count as data loss | Reword count-agnostic: "the committed v1 file (count it first: `jq '.seenPostIds | length' state/seen-posts.json`)" in both places | applied: Phase 4 MV + Migration Notes reworded count-agnostic |
| code | Phase 3 §2 | src/fetch-threads.ts:26 | suggestion | code-quality | The three failing-navigation pins trigger the walk's real retry backoff (~2s/4s sleeps, no timer seam) — ~6s per all-fail/partial-failure test, ~18s suite growth | Note the cost in §2's prose or accept it explicitly; no code change needed for the pins to pass | applied: retry-cost note added to Phase 3 §2 prose |
| coverage | design Migration Notes §2 → Phase 7 README | <n/a> | suggestion | verification-coverage | Rollback note ("v1 code + v2 file fails visibly; recovery is reverting the state file alongside the code") lands in no operational doc — Phase 7's README paragraph covers only JUDGE_CONCURRENCY | Append one rollback sentence to Phase 7's README paragraph | applied: rollback sentence added to the README fence |

_Tally at Step 4.3: 5 blockers, 6 concerns, 2 suggestions (code reviewer: 3/4/1; coverage reviewer: 2/2/1)._

