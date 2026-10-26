---
date: 2026-10-26T09:46:32+0700
author: Yogiswara Utama
commit: 67d422d
branch: main
repository: loker-watcher
topic: "Model-judged keyword filtering"
tags: [plan, judge, keywords, bulk, heartbeat, state, tests, docs]
status: ready
parent: ".rpiv/artifacts/designs/2026-10-26_06-51-45_model-judged-keywords.md"
phase_count: 5
phases:
  - { n: 0, title: "Probe judge latency + workflow budget", files: ["scripts/probe-judge.ts", ".github/workflows/watch.yml", "tsconfig.json", "package.json"], depends_on: [] }
  - { n: 1, title: "Bulk judge core + resilience", files: ["src/judge.ts"], depends_on: [0] }
  - { n: 2, title: "Funnel + judged-counter rework", files: ["src/index.ts", "src/heartbeat.ts", "src/types.ts", "src/keywords.ts", "tests/keywords.test.ts"], depends_on: [1] }
  - { n: 3, title: "Test relocation + state gate tests", files: ["tests/judge.test.ts", "tests/state.test.ts", "tests/heartbeat.test.ts"], depends_on: [1, 2] }
  - { n: 4, title: "Docs sync + repo gates", files: ["README.md", ".claude/skills/validate-e2e/SKILL.md", ".rpiv/guidance/architecture.md", ".rpiv/guidance/src/architecture.md", ".rpiv/guidance/tests/architecture.md", "AGENTS.md"], depends_on: [2] }
last_updated: 2026-10-26T10:35:04+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Run 40264368939 cancelled at the job cap: 283 posts hit a 15s judge timeout never validated from a runner. Adds a latency probe phase, raises the timeout, stops the per-item fallback cascade on transport failure, and raises the job budget."
---

# Model-judged keyword filtering — Implementation Plan

## Overview

The keyword substring gate is deleted. Every recency+seen survivor reaches the LLM judge, and the judge decides relevance against the `keywords` list in `watcher.config.json`. `src/judge.ts` is rewritten around ~10-post bulk calls: the keyword list is serialized into the system prompt as the relevance criterion, the model answers with an id-keyed verdict object, and the bulk payload sets `response_format: {"type":"json_object"}`. Items the bulk response misses or mangles fall back to the unchanged single-post `judgePost` (2 attempts); the batch call itself gets no retry, and a batch the endpoint does not answer is deferred whole, so the worst case stays deterministic at ceil(N/10) calls. The funnel stat `maybes` becomes `judged` (posts SENT to the judge), heartbeat vocabulary follows, the relocated test suite plus a new state-gate suite pin the D3 invariant, and docs sync across README, the e2e runbook, repo guidance, and AGENTS.md.

Design artifact: `.rpiv/artifacts/designs/2026-10-26_06-51-45_model-judged-keywords.md` (Option 2 from `.rpiv/artifacts/solutions/2026-10-26_06-15-51_model-judged-keywords.md`).

## Production Incident (2026-10-26)

Run [40264368939](https://github.com/ukind/loker-watcher/actions/runs/40264368939) (`workflow_dispatch`, the first run of this plan's code) was **cancelled at the 10-minute job cap**. The judge stage never completed one call.

| Time (UTC) | Log line | What it proves |
|---|---|---|
| 03:33:27.729 | `state: 283 unseen post(s)` | 283 posts enter the judge — the plan estimated ~37 |
| 03:33:42.733 | `judge: batch (10 posts) request error: The operation was aborted due to timeout` | exactly 15.0s after the judge started: `REQUEST_TIMEOUT_MS` fired |
| 03:34:26 → 03:39:16 | 4 batch timeouts, 2 single-post timeouts, 1 skip | every call died at 15s; ~10 posts processed in 6.5 minutes |
| 03:40:01 | job cancelled | no digest, no state commit — the 283-post backlog persists and grows |

Root cause, in order:

1. **The judge stage was never load-tested.** The keyword pre-filter let 0-1 posts reach the judge per run, so the 15s timeout looked fine. Removing the filter sent the whole unseen backlog at it.
2. **The endpoint was only ever exercised locally.** The e2e runbook works under `.rpiv/tmp/` on a developer machine. From a GitHub runner, `api.z.ai` never answered inside 15s — not once, for a batch or a single post.
3. **One batch timeout cascaded into 20 more doomed calls.** The per-item fallback fired 10 posts × 2 attempts against the same slow endpoint. A transport failure predicts fallback failure.
4. **`timeout-minutes: 10` became the binding constraint**, and this plan had explicitly put `watch.yml` out of scope. Fetch alone eats ~3.5 minutes, leaving 6.5 for 29 batches.

The plan's Performance section carried the wrong assumption: *"typical run: 1-2 [calls] — seen-state diffing leaves handfuls unseen."* The unseen tail is 283 because the pre-filter era committed almost nothing to state.

Still unknown, and the reason for Phase 0: whether a bulk call takes 20s or 90s from the runner, and whether the runner-to-endpoint path or the model on a big prompt is the slow part.

## Desired End State

A zero-keyword-match feed no longer zeroes the funnel — the model decides:

```typescript
// src/index.ts (after the change)
const { judged, skippedPostIds } = await judgePosts(newPosts, resolveJudgeConfig(process.env), config.keywords);
// log: judge: 283 candidate(s) judged, 2 relevant+located, skipped: 0
// ceil(283/10) = 29 LLM calls on the happy path; any skipped id stays unseen
// and retries next run; state persists all 283 judged ids only because matches > 0.
```

```text
// heartbeat body funnel (zero-match run) — the first run after the change
  487 unique post(s)
  303 within 72h
  283 judged candidate(s)   ← the whole unseen backlog, not a handful
  0 relevant + located
  0 skipped by the judge   ← when the endpoint answers inside 60s
```

Verify with: `npm run typecheck && npm run lint && npm test`, then one live run with real `LLM_*` and `GMAIL_*` env vars (the digest and state-commit paths have never fired in production — 6 validation rounds, all zero-match).

## What We're NOT Doing

- New config keys (batch size and the request timeout stay module constants) and candidate caps.
- Strict `json_schema` (OpenAI-specific; Z.AI documents `json_object` only).
- `response_format` on the fallback path — the single-post call stays byte-identical apart from the `keywords` param.
- Keyword validation changes (error texts stay byte-identical).
- A per-run judge cap or a judge deadline: the deferred-batch design plus the raised job budget bound the stage without dropping posts.
- State schema changes and email digest changes.

## Phase 0: Probe judge latency + workflow budget

### Overview

Production run 40264368939 was cancelled at the 10-minute job cap: 283 unseen posts entered the judge, every bulk call and every fallback call died at `REQUEST_TIMEOUT_MS = 15_000`, and the run produced no digest and no state commit. This phase measures what the plan only assumed — the endpoint's real latency from inside a GitHub runner — and raises the job budget so the judge stage has room to finish a full backlog run. The measured numbers set Phase 1's timeout and confirm the batch size.

### Changes Required:

#### 1. `scripts/probe-judge.ts` — NEW
**File**: `scripts/probe-judge.ts`
**Changes**: A standalone diagnostic that times three chat-completions calls against the configured endpoint from inside the runner: one minimal call, then two 10-post bulk calls with the production prompt shape. It prints each duration and exits nonzero when a call fails, so a dead endpoint fails the step loudly instead of hiding in a green run.

````typescript
/**
 * Judge latency probe. Run inside GitHub Actions (workflow_dispatch only)
 * to measure how long the configured LLM endpoint really takes from a
 * runner. The plan's 15s timeout was validated only on a developer machine;
 * run 40264368939 proved the runner path is slower.
 *
 * Usage:
 *   LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... npx tsx scripts/probe-judge.ts
 * Exits 1 when any call fails, so a dead endpoint fails the step loudly.
 */
import { ENV_NAMES } from "../src/config.js";
import type { Post } from "../src/types.js";

const KEYWORDS = ["frontend", "fullstack", "web developer", "react", "typescript"];

/** Synthetic posts at realistic Threads length, so token counts match production. */
function syntheticPost(index: number): Post {
  return {
    id: `90000000000000000${index}`,
    author: `probe${index}`,
    permalink: `https://www.threads.com/@probe${index}/post/90000000000000000${index}`,
    timestamp: "2026-10-26T00:00:00.000Z",
    text: `Lowongan kerja probe post ${index}. We are hiring a frontend developer with React and TypeScript experience. Jakarta or remote. Kirim lamaran ke DM kami. Fresh graduate welcome, minimal 1 tahun pengalaman.`,
  };
}

/** The production bulk prompt shape: keyword criterion plus id+text pairs. */
function bulkMessages(posts: readonly Post[]): Array<{ role: string; content: string }> {
  const listing = posts
    .map((post) => `id ${post.id} by @${post.author}:\n"${post.text}"`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: `You are an automated evaluation filter for job alerts. A post is relevant when it is a genuine job opening related to at least one of these keywords: ${JSON.stringify(KEYWORDS)}. You also determine whether the position is in Indonesia or remote.`,
    },
    {
      role: "user",
      content: `Judge each Threads post below against the criteria.\n\n${listing}\n\nDetermine two criteria per post:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above.\n2. locationOk: true ONLY if the job is located in Indonesia, or explicitly remote.\n\nRespond with ONLY a raw JSON object mapping EACH post id above to its verdict:\n{"<post id>": {"relevant": boolean, "locationOk": boolean}}`,
    },
  ];
}

/** Time one call; return true when it answered with a JSON object. */
async function timed(
  label: string,
  payload: unknown,
  baseUrl: string,
  apiKey: string,
): Promise<boolean> {
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    const elapsed = Date.now() - started;
    const ok = response.ok && body.includes("{");
    console.log(
      `probe: ${label} — ${elapsed}ms — HTTP ${response.status} ${ok ? "OK" : "NO JSON"}`,
    );
    return ok;
  } catch (error) {
    const elapsed = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`probe: ${label} — ${elapsed}ms — FAILED: ${message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const baseUrl = process.env[ENV_NAMES.llmBaseUrl]?.trim();
  const apiKey = process.env[ENV_NAMES.llmApiKey]?.trim();
  const model = process.env[ENV_NAMES.llmModel]?.trim();
  if (!baseUrl || !apiKey || !model) {
    console.error(
      `probe: missing ${ENV_NAMES.llmBaseUrl}, ${ENV_NAMES.llmApiKey}, or ${ENV_NAMES.llmModel}`,
    );
    process.exit(1);
  }

  const minimal = await timed(
    "minimal call (one short message)",
    {
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      temperature: 0,
    },
    baseUrl,
    apiKey,
  );

  const ten = Array.from({ length: 10 }, (_, i) => syntheticPost(i + 1));
  const bulkPayload = {
    model,
    messages: bulkMessages(ten),
    temperature: 0,
    response_format: { type: "json_object" },
  };
  const bulk = await timed(
    "bulk call (10 posts, production prompt shape)",
    bulkPayload,
    baseUrl,
    apiKey,
  );
  const again = await timed(
    "bulk call again (10 posts, variance check)",
    bulkPayload,
    baseUrl,
    apiKey,
  );

  console.log(
    `probe: summary — minimal=${minimal ? "ok" : "fail"} bulk=${bulk ? "ok" : "fail"} bulkAgain=${again ? "ok" : "fail"}`,
  );
  if (!minimal || !bulk || !again) {
    process.exit(1);
  }
}

await main();
````

#### 2. `.github/workflows/watch.yml` — MODIFY
**File**: `.github/workflows/watch.yml`
**Changes**: Add a `probe` job that runs only on `workflow_dispatch`, and raise the `watch` job's `timeout-minutes` from 10 to 45 so the judge stage can finish a full backlog run.

````yaml
Region 1 — new probe job, inserted before the `watch` job.

+  probe:
+    if: github.event_name == 'workflow_dispatch'
+    runs-on: ubuntu-latest
+    timeout-minutes: 10
+    steps:
+      - uses: actions/checkout@v4
+
+      - uses: actions/setup-node@v4
+        with:
+          node-version: 22
+          cache: npm
+
+      - run: npm ci
+
+      - name: Probe judge latency
+        env:
+          LLM_BASE_URL: ${{ secrets.LLM_BASE_URL }}
+          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
+          LLM_MODEL: ${{ secrets.LLM_MODEL }}
+        run: npx tsx scripts/probe-judge.ts

Region 2 — watch job budget.

-    timeout-minutes: 10
+    # 283 posts at BATCH_SIZE 10 = 29 bulk calls. At the 60s request timeout
+    # that is 29 minutes of judge plus ~3.5 minutes of fetch. 45 leaves headroom.
+    timeout-minutes: 45
````

#### 3. `tsconfig.json` + `package.json` — MODIFY (gate coverage)
**Files**: `tsconfig.json`, `package.json`
**Changes**: Bring the new script under the repo gates. `scripts/hooks/*.js` stays outside both gates — those are agent-harness hooks, not project code.

````diff
// tsconfig.json
-  "include": ["src", "tests"]
+  "include": ["src", "tests", "scripts"]

// package.json
-    "lint": "biome check src tests",
+    "lint": "biome check src tests scripts/probe-judge.ts",
````

### Success Criteria:

#### Automated Verification:
- [x] `npm run typecheck` exits 0 and now covers `scripts/probe-judge.ts` (`npx tsc --noEmit --listFiles | grep probe-judge` shows it)
- [x] `npm run lint` exits 0 and now covers `scripts/probe-judge.ts`
- [x] `grep -n "timeout-minutes" .github/workflows/watch.yml` shows 10 for `probe` and 45 for `watch`
- [x] `grep -n "workflow_dispatch" .github/workflows/watch.yml` shows the trigger and the probe job's `if` guard
- [x] The probe job passes no `THREADS_SESSION_STATE` and no `GMAIL_*` secret — it touches no Threads surface and sends no email
- [x] `grep -c "scripts" tsconfig.json` shows the new include entry

#### Manual Verification:
- [ ] A `workflow_dispatch` run of the `probe` job prints three durations; the two bulk durations agree within a factor of two
- [ ] The measured bulk duration sets Phase 1's `REQUEST_TIMEOUT_MS` (proposal: 60s; raise it if the probe reports more)
- [ ] The measured bulk duration confirms `BATCH_SIZE = 10` still fits the budget, or Phase 1 lowers it to 5
- [ ] A deliberately wrong `LLM_MODEL` makes the probe job fail red, not pass silently

---

## Phase 1: Bulk judge core + resilience

### Overview

Rewrite `src/judge.ts` around bulk judging: a `BATCH_SIZE` module constant, an id-keyed `parseBulkVerdicts` (exported), `buildBulkMessages` (keywords JSON in the system message), a no-retry `judgeBatch`, and a `judgePosts` chunk loop with per-item fallback to the unchanged single-post `judgePost`. The `keywords` parameter is added before the trailing `fetchFn` DI seam on both `judgePost` and `judgePosts`. `resolveJudgeConfig`, `JudgeConfig`, `JudgedPost`, `JudgeBatchResult`, and `parseVerdict` are unchanged.

**Revised 2026-10-26 after the production incident.** Two resilience changes ride on the same rewrite, both driven by run 40264368939: `REQUEST_TIMEOUT_MS` rises from 15s to 60s (Phase 0 confirms the number), and `judgeBatch` now reports an unanswered batch as a distinct outcome so `judgePosts` defers it whole instead of firing up to 2×BATCH_SIZE more calls at the same slow endpoint. The per-item fallback survives for parse-level misses only, where the simpler single-post prompt genuinely has a better chance.

### Changes Required:

#### 1. `src/judge.ts` — MODIFY (near-total rewrite)
**File**: `src/judge.ts`
**Changes**: Add `BATCH_SIZE` beside `REQUEST_TIMEOUT_MS`; add `normalizeEndpoint`, `readVerdict`, `buildBulkMessages`, `parseBulkVerdicts` (exported), `judgeBatch` (no retry); rework `buildMessages` to take `keywords` and drop the hardcoded frontend/fullstack criterion; add the `keywords` parameter to `judgePost` and `judgePosts`; add the `response_format` rider to the bulk payload only; rework the `judgePosts` loop into a chunk loop with per-item fallback and a skip warn naming both stages. `parseVerdict` stays byte-identical.

````typescript
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
 * The batch call itself gets no retry, and a batch the endpoint does not
 * answer is deferred whole — a transport failure predicts fallback failure,
 * so the worst case is ceil(N/BATCH_SIZE) calls, not ceil(N/BATCH_SIZE)
 * + 2N. A post that fails both stages is skipped for this run, logged
 * visibly, and omitted from state (D3: it stays unseen and retries next
 * run).
 */
import { ENV_NAMES } from "./config.js";
import type { JudgeVerdict, Post } from "./types.js";

/**
 * Per-request timeout. 15s was never validated from a GitHub runner: run
 * 40264368939 timed out every batch and every fallback call at exactly
 * 15.0s. Phase 0 measures the real latency from the runner and confirms
 * this value.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** Posts per bulk judge call. Module constant by design — no config key. */
const BATCH_SIZE = 10;

export interface JudgeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface JudgedPost {
  post: Post;
  verdict: JudgeVerdict;
}

export interface JudgeBatchResult {
  judged: JudgedPost[];
  skippedPostIds: string[];
}

/**
 * Resolve LLM configuration from the environment dictionary.
 * Throws when any mandatory variable is missing or blank.
 */
export function resolveJudgeConfig(
  env: Record<string, string | undefined> = process.env,
): JudgeConfig {
  const baseUrl = env[ENV_NAMES.llmBaseUrl]?.trim();
  const apiKey = env[ENV_NAMES.llmApiKey]?.trim();
  const model = env[ENV_NAMES.llmModel]?.trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push(ENV_NAMES.llmBaseUrl);
  if (!apiKey) missing.push(ENV_NAMES.llmApiKey);
  if (!model) missing.push(ENV_NAMES.llmModel);

  if (missing.length > 0) {
    throw new Error(`judge: missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model: model!,
  };
}

/**
 * Extract and validate a JudgeVerdict from raw LLM response text.
 * Tolerates surrounding markdown code fences and whitespace.
 */
export function parseVerdict(content: string): JudgeVerdict | null {
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const jsonStr = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.relevant === "boolean" &&
      typeof parsed.locationOk === "boolean"
    ) {
      return {
        relevant: parsed.relevant,
        locationOk: parsed.locationOk,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Chat-completions URL from a base URL, tolerating a full endpoint. */
function normalizeEndpoint(baseUrl: string): string {
  return baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/** Validate one unknown bulk item as a JudgeVerdict; null when malformed. */
function readVerdict(item: unknown): JudgeVerdict | null {
  if (item === null || typeof item !== "object") {
    return null;
  }
  const record = item as Record<string, unknown>;
  if (typeof record.relevant === "boolean" && typeof record.locationOk === "boolean") {
    return { relevant: record.relevant, locationOk: record.locationOk };
  }
  return null;
}

/**
 * Build the chat completion messages for one single-post fallback call.
 * The keyword list replaces the old hardcoded frontend/fullstack criterion.
 */
function buildMessages(
  post: Post,
  keywords: readonly string[],
): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content: `You are an automated evaluation filter for job alerts. A post is relevant when it is a genuine job opening related to at least one of these keywords: ${JSON.stringify(keywords)}. You also determine whether the position is in Indonesia or remote.`,
    },
    {
      role: "user",
      content: `Analyze the following Threads post by @${post.author}:\n\n\"${post.text}\"\n\nDetermine two criteria:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above. Set false if it is a job seeker seeking work, an internship inquiry, a training promotion, or an unrelated role.\n2. locationOk: true ONLY if the job is located in Indonesia (e.g. Jakarta, Bali, Surabaya, hybrid in ID), or explicitly remote / work from anywhere. Set false if the role is on-site or hybrid in another country with no remote option.\n\nRespond with ONLY a raw JSON object matching this schema:\n{"relevant": boolean, "locationOk": boolean}`,
    },
  ];
}

/**
 * Build the chat completion messages for one bulk batch: the keyword list
 * is the criterion (system message), the id+text pairs are the data (user
 * message). The model must echo each post id as an object key.
 */
function buildBulkMessages(
  candidates: readonly Post[],
  keywords: readonly string[],
): Array<{ role: string; content: string }> {
  const listing = candidates
    .map((post) => `id ${post.id} by @${post.author}:\n"${post.text}"`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: `You are an automated evaluation filter for job alerts. A post is relevant when it is a genuine job opening related to at least one of these keywords: ${JSON.stringify(keywords)}. You also determine whether the position is in Indonesia or remote.`,
    },
    {
      role: "user",
      content: `Judge each Threads post below against the criteria.\n\n${listing}\n\nDetermine two criteria per post:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above. Set false if it is a job seeker seeking work, an internship inquiry, a training promotion, or an unrelated role.\n2. locationOk: true ONLY if the job is located in Indonesia (e.g. Jakarta, Bali, Surabaya, hybrid in ID), or explicitly remote / work from anywhere. Set false if the role is on-site or hybrid in another country with no remote option.\n\nRespond with ONLY a raw JSON object mapping EACH post id above to its verdict, exactly like:\n{"<post id>": {"relevant": boolean, "locationOk": boolean}}`,
    },
  ];
}

/**
 * Parse a bulk verdict response into an id-keyed Map.
 *
 * Returns null (container-level failure) ONLY when the whole response is
 * unrecoverable: no braces, invalid JSON, or a non-object container. A
 * malformed item is simply absent from the Map — never a batch failure.
 * Ids stay strings (Post.id exceeds Number.MAX_SAFE_INTEGER — never
 * Number()-coerced); a Map also neutralizes hostile keys such as
 * "__proto__". Never throws.
 */
export function parseBulkVerdicts(content: string): Map<string, JudgeVerdict> | null {
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const verdicts = new Map<string, JudgeVerdict>();
    for (const [id, item] of Object.entries(parsed)) {
      const verdict = readVerdict(item);
      if (verdict !== null) {
        verdicts.set(id, verdict);
      }
    }
    return verdicts;
  } catch {
    return null;
  }
}

/** Result of one bulk call: a parsed container, or no usable answer. */
type BatchOutcome =
  | { status: "answered"; verdicts: Map<string, JudgeVerdict> }
  | { status: "unanswered" };

/**
 * One bulk call for up to BATCH_SIZE posts. No retry.
 *
 * Returns "unanswered" when the endpoint did not produce a usable response
 * (HTTP failure, request error, or missing message content). A transport
 * failure predicts fallback failure — the same endpoint answers the
 * per-item calls no faster — so the caller defers the whole batch instead
 * of firing up to 2*BATCH_SIZE more doomed calls. Measured on run
 * 40264368939: one 15s batch timeout cascaded into 20 more timeouts and
 * burned 6.5 of the job's 10 minutes for ~10 posts.
 *
 * Returns "answered" with whatever the container parsed into, including an
 * empty Map when the model answered with unparseable text. A parse-level
 * miss is a model failure, not a transport failure: the simpler single-post
 * prompt has a real chance, so the caller falls back per item.
 */
async function judgeBatch(
  batch: readonly Post[],
  config: JudgeConfig,
  keywords: readonly string[],
  fetchFn: typeof fetch,
): Promise<BatchOutcome> {
  const payload = {
    model: config.model,
    messages: buildBulkMessages(batch, keywords),
    temperature: 0,
    // Rider on the bulk path ONLY: the single-post fallback call keeps its
    // original payload shape (design scope boundary).
    response_format: { type: "json_object" },
  };

  try {
    const response = await fetchFn(normalizeEndpoint(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(
        `judge: batch (${batch.length} posts) HTTP ${response.status} ${response.statusText} — skipping batch (posts stay unseen and retry next run)`,
      );
      return { status: "unanswered" };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = data.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string") {
      console.warn(
        `judge: batch (${batch.length} posts) missing message content — skipping batch (posts stay unseen and retry next run)`,
      );
      return { status: "unanswered" };
    }

    const verdicts = parseBulkVerdicts(rawContent);
    if (verdicts === null) {
      console.warn(
        `judge: batch (${batch.length} posts) failed to parse bulk verdicts: ${rawContent.slice(0, 100)} — falling back to single-post calls (up to 2 attempts per post)`,
      );
      return { status: "answered", verdicts: new Map() };
    }
    return { status: "answered", verdicts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `judge: batch (${batch.length} posts) request error: ${message} — skipping batch (posts stay unseen and retry next run)`,
    );
    return { status: "unanswered" };
  }
}

/**
 * Judge a single post with up to 1 retry on HTTP or parsing failure.
 * Returns the verdict on success, or null if both attempts fail.
 * Kept as the fallback stage of the bulk path: same 2-attempt loop, same
 * warn lines, same payload shape — only the keyword-guided criterion and
 * the keywords parameter are new.
 */
export async function judgePost(
  post: Post,
  config: JudgeConfig,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<JudgeVerdict | null> {
  const payload = {
    model: config.model,
    messages: buildMessages(post, keywords),
    temperature: 0,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchFn(normalizeEndpoint(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        console.warn(
          `judge: post ${post.id} attempt ${attempt}/2 HTTP ${response.status} ${response.statusText}`,
        );
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const rawContent = data.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string") {
        console.warn(`judge: post ${post.id} attempt ${attempt}/2 missing message content`);
        continue;
      }

      const verdict = parseVerdict(rawContent);
      if (verdict !== null) {
        return verdict;
      }

      console.warn(
        `judge: post ${post.id} attempt ${attempt}/2 failed to parse JSON verdict: ${rawContent.slice(0, 100)}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`judge: post ${post.id} attempt ${attempt}/2 request error: ${msg}`);
    }
  }

  return null;
}

/**
 * Judge candidate posts in ~BATCH_SIZE-post bulk calls; every item the bulk
 * response misses or mangles falls back to the single-post judgePost.
 * Collects successful verdicts and tracks skipped IDs (D3). Never throws:
 * every LLM failure lands in skippedPostIds, so a bad endpoint cannot kill
 * the run before the digest and state stages.
 *
 * A batch the endpoint did not answer is deferred whole (see judgeBatch):
 * its posts stay unseen and retry on the next run. The worst case is
 * therefore ceil(N/BATCH_SIZE) calls, not ceil(N/BATCH_SIZE) + 2N.
 */
export async function judgePosts(
  candidates: readonly Post[],
  config: JudgeConfig,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<JudgeBatchResult> {
  const judged: JudgedPost[] = [];
  const skippedPostIds: string[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const outcome = await judgeBatch(batch, config, keywords, fetchFn);

    if (outcome.status === "unanswered") {
      for (const post of batch) {
        skippedPostIds.push(post.id);
      }
      console.warn(
        `judge: skipped batch of ${batch.length} post(s) after an unanswered bulk call; they stay unseen and retry next run`,
      );
      continue;
    }

    for (const post of batch) {
      const fromBulk = outcome.verdicts.get(post.id);
      const verdict = fromBulk ?? (await judgePost(post, config, keywords, fetchFn));
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
````

### Success Criteria:

#### Automated Verification:
- [x] Bulk payload rider exactly once in code: `grep -c 'type: "json_object"' src/judge.ts` returns 1 (the module docstring also names response_format — expected; the single-post fallback payload carries no rider)
- [x] Chunking wired: `grep -n "BATCH_SIZE" src/judge.ts` shows the constant beside REQUEST_TIMEOUT_MS and the slice step; no other magic batch numbers
- [x] Exports intact: resolveJudgeConfig, parseVerdict, parseBulkVerdicts, judgePost, judgePosts, JudgeConfig, JudgedPost, JudgeBatchResult all still exported
- [x] Batch warn lines carry no "/2" attempt suffix (the batch gets exactly one attempt); fallback warn lines keep theirs
- [x] No Number()-coercion of post ids anywhere in the file (19-digit ids)
- [x] parseVerdict is byte-identical to the current src/judge.ts on disk (fence-strip regexes included)
- [x] `REQUEST_TIMEOUT_MS` is 60_000, or the value Phase 0's probe measured — never 15_000 again
- [x] `judgeBatch` returns `{ status: "unanswered" }` on exactly three paths: `!response.ok`, missing message content, and the catch block. `grep -c 'status: "unanswered"' src/judge.ts` returns 4 (the type union plus the three return sites)
- [x] No fallback after an unanswered batch: `grep -c "skipping batch" src/judge.ts` returns 3, and the per-item `judgePost` call sits only inside the `outcome.status === "answered"` branch
- [x] Worst case is ceil(N/BATCH_SIZE) calls: `grep -n "ceil(N/BATCH_SIZE) + 2N" src/judge.ts` returns nothing
- [x] An answered-but-unparseable batch still routes every item to the fallback: the parse-failure branch returns `{ status: "answered", verdicts: new Map() }`
- [x] Deferred posts land in `skippedPostIds`, never in `judged` — they stay unseen and retry next run (D3)

#### Manual Verification:
- [x] Reading the file: bulk-first flow is obvious (judgeBatch → per-item fallback → skip warn naming both stages)
- [x] The system message carries JSON.stringify(keywords) and no hardcoded "frontend or fullstack web development" criterion survives in either message builder
- [x] Reading `judgePosts`: the unanswered branch reads as a defer, not a drop — every post in the batch reaches `skippedPostIds` with one warn naming both the cause and the retry

---

## Phase 2: Funnel + judged-counter rework

### Overview

Delete the keyword gate call, the zero-maybes early return, `src/keywords.ts`, and its last importer `tests/keywords.test.ts` (CI runs typecheck and tests on every push, so the module and its test land together). Set `stats.judged = newPosts.length` right after `diffNew` (before the first heartbeat call), feed `newPosts` to both heartbeat call sites, pass `config.keywords` as the third argument of `judgePosts`, and collapse the two judge-stage log lines into one. Rename the heartbeat vocabulary: `HeartbeatStats.maybes` → `judged`, `Candidate.reason "maybe"` → `"judged"`, copy "N keyword maybe(s)" → "N judged candidate(s)", tag "[keyword match]" → "[judged]". Reword the `JudgeVerdict.relevant` doc.

### Changes Required:

#### 1. `src/index.ts` — MODIFY (funnel rework)
**File**: `src/index.ts`
**Changes**: Delete the `filterPostsByKeywords` import, the gate call, the zero-maybes early return, and the `keywords:` stage from the module doc funnel line. Rename the local `heartbeat` helper's `judged` parameter (posts sent to the judge). Rename the stats init field to `judged: 0`. Replace the keyword-gate block and the old judge block with the `diffNew → judge` region below. Everything after (email-before-state, `judgedIds` persistence) is untouched.

````typescript
// ---- module doc (funnel line) ----
 * fetch → extract → dedupe vs state → judge → email → state commit. Every
 * stage logs its counts; any thrown error exits non-zero and leaves state
 * untouched (D8: the write is match-gated and ordered after the email send,
 * so a failed run never marks posts seen).

// ---- import block: DELETE this line ----
// import { filterPostsByKeywords } from "./keywords.js";

// ---- local heartbeat helper (param rename: judged = posts sent to the judge) ----
async function heartbeat(
  stats: HeartbeatStats,
  recent: readonly Post[],
  judged: readonly Post[],
  candidateTerms: readonly string[],
): Promise<void> {
  if (!isHeartbeatEnabled(process.env)) {
    console.log("heartbeat: disabled by HEARTBEAT_ENABLED");
    return;
  }
  try {
    const config = resolveEmailConfig(process.env);
    const candidates = selectCandidates(recent, judged, candidateTerms);
    await sendHeartbeat(stats, candidates, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`heartbeat: not sent — ${message}`);
  }
}

// ---- stats init (field rename) ----
  const stats: HeartbeatStats = {
    ranAt: startedAt.toISOString(),
    unique: posts.length,
    recent: recent.length,
    recencyHours,
    judged: 0,
    relevantLocated: 0,
    skipped: 0,
    ...(runUrl !== undefined ? { runUrl } : {}),
  };

// ---- diffNew → judge stage (replaces the keyword-gate block + old judge block) ----
  const state = await loadState();
  const newPosts = diffNew(state, recent);
  stats.judged = newPosts.length;
  if (newPosts.length === 0) {
    await heartbeat(stats, recent, newPosts, config.candidateTerms);
    console.log("no new matches");
    return;
  }
  console.log(`state: ${newPosts.length} unseen post(s)`);

  const { judged, skippedPostIds } = await judgePosts(
    newPosts,
    resolveJudgeConfig(process.env),
    config.keywords,
  );
  const matches = judged
    .filter((j) => j.verdict.relevant && j.verdict.locationOk)
    .map((j) => j.post);
  stats.relevantLocated = matches.length;
  stats.skipped = skippedPostIds.length;
  console.log(
    `judge: ${newPosts.length} candidate(s) judged, ${matches.length} relevant+located, skipped: ${skippedPostIds.length}`,
  );

  if (matches.length === 0) {
    await heartbeat(stats, recent, newPosts, config.candidateTerms);
    console.log("no new matches");
    return;
  }

// ---- everything after this point is untouched (email-before-state, judgedIds persistence) ----
````

#### 2. `src/heartbeat.ts` — MODIFY (vocabulary rework)
**File**: `src/heartbeat.ts`
**Changes**: `HeartbeatStats.maybes` → `judged` with the reworded doc; `Candidate.reason` union `"maybe" | "near-miss"` → `"judged" | "near-miss"`; `selectCandidates` second parameter renamed to `judged` with the tier reason `"judged"`; funnel copy line; candidate tag. The module doc paragraph drops the "0-1 keyword maybes" clause (deleted, not renamed). The near-miss tier is byte-identical.

````typescript
// ---- module doc paragraph (the "0-1 keyword maybes" clause is deleted, not
// renamed: post-gate, judged candidates number in the dozens — a renamed
// count would make the measurement claim false) ----
/**
 * No-match heartbeat (Phase 9).
 *
 * The watcher sends no email when a run finds no match, so the operator has
 * no signal that the pipeline is alive — and no way to see why a run found
 * nothing without opening the Actions log. Measured 2026-10-25: the
 * authenticated feed carries ~300 recent posts per run, and zero-match runs
 * are the normal case. This module builds and sends a status email for
 * those runs: the scan funnel plus the candidate posts that came closest,
 * each with its permalink.
 *
 * The candidate net comes from watcher.config.json ("candidateTerms") and is
 * deliberately broader than the keyword list the judge uses: a post that
 * names no configured keyword can still be worth a human look.
 */

// ---- HeartbeatStats field ----
  /** Posts sent to the LLM judge (all recency+seen survivors). */
  judged: number;

// ---- Candidate interface ----
/** One candidate post plus why it is in the list. */
export interface Candidate {
  post: Post;
  /** "judged" went to the LLM judge; "near-miss" only the broader net. */
  reason: "judged" | "near-miss";
}

// ---- selectCandidates (param rename + tier reason; near-miss tier byte-identical) ----
/**
 * Pick the posts worth a human look: every judged candidate first (the
 * strongest signal), then the newest near-misses, capped at `limit`.
 */
export function selectCandidates(
  recent: readonly Post[],
  judged: readonly Post[],
  terms: readonly string[],
  limit: number = MAX_CANDIDATES,
): Candidate[] {
  const out: Candidate[] = judged.map((post) => ({
    post,
    reason: "judged" as const,
  }));
  if (out.length >= limit) return out.slice(0, limit);

  const judgedIds = new Set(judged.map((post) => post.id));
  const nearMisses = recent
    .filter((post) => !judgedIds.has(post.id) && matchesCandidateTerms(post.text, terms))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  for (const post of nearMisses) {
    if (out.length >= limit) break;
    out.push({ post, reason: "near-miss" });
  }
  return out;
}

// ---- buildHeartbeatBody funnel line ----
    `  ${stats.judged} judged candidate(s)`,

// ---- candidate tag ----
      const tag = candidate.reason === "judged" ? " [judged]" : "";
````

#### 3. `src/types.ts` — MODIFY (doc reword)
**File**: `src/types.ts`
**Changes**: `JudgeVerdict.relevant` doc becomes keyword-guided instead of frontend/fullstack-specific.

````typescript
/** LLM verdict for one candidate post (judge, Slice 4). */
export interface JudgeVerdict {
  /** The post is a genuine job opening related to the configured keywords. */
  relevant: boolean;
  /** The role is in Indonesia or remote. */
  locationOk: boolean;
}
````

#### 4. `src/keywords.ts` — DELETE
**File**: `src/keywords.ts`
**Changes**: Zero callers after the gate removal. Deleted in the same phase as its last importer so a per-phase commit stays green in CI.

#### 5. `tests/keywords.test.ts` — DELETE
**File**: `tests/keywords.test.ts`
**Changes**: Superseded by `tests/judge.test.ts` (Phase 3). Deleted here because it is the last importer of `../src/keywords.js` — leaving it would fail `npm run typecheck` on a Phase 2 commit. Never copied: a leftover file fails typecheck on its `../src/keywords.js` import.

### Success Criteria:

#### Automated Verification:
- [x] `grep -rn "filterPostsByKeywords\|matchesKeywords" src/` returns nothing
- [x] `grep -rni "maybe" src/` returns nothing (field, param, reason, copy, tag sweep)
- [x] `grep -rn "keywords.js" src/` returns nothing (import gone); `test ! -f src/keywords.ts` succeeds
- [x] Superseded suite gone, no orphan import: `test ! -f tests/keywords.test.ts` succeeds
- [x] `grep -n "stats.judged" src/index.ts` shows exactly one assignment (`stats.judged = newPosts.length;`) placed before the first heartbeat call
- [x] `grep -n "config.keywords" src/index.ts` shows exactly one occurrence — the third argument of the judgePosts call
- [x] `grep -rn "keyword match\|keyword maybe" src/` returns nothing
- [x] `npx biome check src/index.ts src/heartbeat.ts src/types.ts` exits 0

#### Manual Verification:
- [x] Reading main(): funnel is fetch → extract → dedupe vs state → judge → email → state; the only pre-judge early return is zero unseen posts
- [x] Both heartbeat call sites pass `newPosts` (posts sent to the judge) — never the `judged` output array
- [x] Heartbeat funnel line reads "N judged candidate(s)"; judged-tier tag reads "[judged]"; near-miss tier untouched

---

## Phase 3: Test relocation + state gate tests

### Overview

Create `tests/judge.test.ts`: the `parseVerdict`, `resolveJudgeConfig`, and `judgePost` describes relocate verbatim from `tests/keywords.test.ts` (only the `judgePost` call sites gain the `keywords` argument), and the `judgePosts` describe is reworked into the bulk acceptance suite with call-count mock routing. Create `tests/state.test.ts` pinning the `saveState` no-op gate on both branches plus a positive control. Update `tests/heartbeat.test.ts` vocabulary.

### Changes Required:

#### 1. `tests/judge.test.ts` — NEW (relocated + reworked)
**File**: `tests/judge.test.ts`
**Changes**: Relocated suites plus the bulk acceptance suite (call-count mock routing, keywords/body assertions, wire-shape assertion, id-safety).

````typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type JudgeConfig,
  judgePost,
  judgePosts,
  parseBulkVerdicts,
  parseVerdict,
  resolveJudgeConfig,
} from "../src/judge.js";
import type { Post } from "../src/types.js";

// The keyword list is a required judge parameter (D3): every case below passes
// an explicit list, mirroring how index.ts feeds config.keywords to the judge.
const KEYWORDS = ["frontend", "fullstack", "react", "next.js"];

/** Chat-completions success body carrying one message content string. */
function ok(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseVerdict", () => {
  it("parses clean JSON objects", () => {
    const verdict = parseVerdict('{"relevant": true, "locationOk": false}');
    assert.deepEqual(verdict, { relevant: true, locationOk: false });
  });

  it("parses markdown code fenced JSON", () => {
    const raw = '```json\n{"relevant": true, "locationOk": true}\n```';
    assert.deepEqual(parseVerdict(raw), { relevant: true, locationOk: true });
  });

  it("parses JSON with surrounding conversational text", () => {
    const raw = 'Here is the verdict: {"relevant": false, "locationOk": false}. Let me know!';
    assert.deepEqual(parseVerdict(raw), { relevant: false, locationOk: false });
  });

  it("returns null for malformed or non-boolean JSON", () => {
    assert.equal(parseVerdict("not json"), null);
    assert.equal(parseVerdict('{"relevant": "yes", "locationOk": true}'), null);
    assert.equal(parseVerdict('{"relevant": true}'), null);
    assert.equal(parseVerdict(""), null);
  });
});

describe("resolveJudgeConfig", () => {
  it("extracts config from valid env", () => {
    const env = {
      LLM_BASE_URL: "https://api.openai.com/v1",
      LLM_API_KEY: "secret-key",
      LLM_MODEL: "gpt-4o-mini",
    };
    const config = resolveJudgeConfig(env);
    assert.deepEqual(config, {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret-key",
      model: "gpt-4o-mini",
    });
  });

  it("throws when required env variables are missing", () => {
    assert.throws(() => resolveJudgeConfig({}), /missing required environment variables/);
  });
});

describe("judgePost", () => {
  const samplePost: Post = {
    id: "100",
    text: "Hiring React developer in Jakarta",
    author: "techco",
    permalink: "https://www.threads.com/@techco/post/100",
    timestamp: "2026-10-24T00:00:00.000Z",
  };

  const sampleConfig: JudgeConfig = {
    baseUrl: "https://mock.api/v1",
    apiKey: "test-key",
    model: "test-model",
  };

  it("returns parsed verdict on successful API response", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"relevant": true, "locationOk": true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const verdict = await judgePost(
      samplePost,
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
  });

  it("retries on first failure and succeeds on second attempt", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response("Bad Gateway", { status: 502 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"relevant": false, "locationOk": true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const verdict = await judgePost(
      samplePost,
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(callCount, 2);
    assert.deepEqual(verdict, { relevant: false, locationOk: true });
  });

  it("returns null after two failed attempts", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount += 1;
      return new Response("Server Error", { status: 500 });
    };

    const verdict = await judgePost(
      samplePost,
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(callCount, 2);
    assert.equal(verdict, null);
  });
});

describe("parseBulkVerdicts", () => {
  it("parses an id-keyed verdict object into a Map", () => {
    const verdicts = parseBulkVerdicts(
      '{"7224638912743920001": {"relevant": true, "locationOk": false}}',
    );
    assert.equal(verdicts?.size, 1);
    assert.deepEqual(verdicts?.get("7224638912743920001"), { relevant: true, locationOk: false });
  });

  it("tolerates code fences and surrounding text", () => {
    const raw = [
      "Here you go:",
      "```json",
      '{"1": {"relevant": false, "locationOk": true}}',
      "```",
      "Done.",
    ].join("\n");
    const verdicts = parseBulkVerdicts(raw);
    assert.deepEqual(verdicts?.get("1"), { relevant: false, locationOk: true });
  });

  it("keeps 19-digit ids exact, never Number-coerced", () => {
    const id = "7224638912743920001";
    const verdicts = parseBulkVerdicts(
      JSON.stringify({ [id]: { relevant: true, locationOk: true } }),
    );
    assert.ok(verdicts?.has(id));
  });

  it("keeps hostile keys as data, not prototype pollution", () => {
    const verdicts = parseBulkVerdicts('{"__proto__": {"relevant": true, "locationOk": true}}');
    assert.deepEqual(verdicts?.get("__proto__"), { relevant: true, locationOk: true });
  });

  it("drops malformed items without failing the batch", () => {
    const verdicts = parseBulkVerdicts(
      '{"1": {"relevant": true, "locationOk": true}, "2": {"relevant": "yes"}, "3": "broken"}',
    );
    assert.equal(verdicts?.size, 1);
    assert.ok(verdicts?.has("1"));
    assert.equal(verdicts?.has("2"), false);
  });

  it("returns an empty Map when the container parses but no item is valid", () => {
    const verdicts = parseBulkVerdicts('{"relevant": true}');
    assert.ok(verdicts !== null);
    assert.equal(verdicts.size, 0);
  });

  it("returns null for unrecoverable containers", () => {
    assert.equal(parseBulkVerdicts("not json"), null);
    assert.equal(parseBulkVerdicts(""), null);
    assert.equal(parseBulkVerdicts("[1, 2, 3]"), null);
    assert.equal(parseBulkVerdicts("no braces here"), null);
  });
});

describe("judgePosts", () => {
  const sampleConfig: JudgeConfig = {
    baseUrl: "https://mock.api/v1",
    apiKey: "test-key",
    model: "test-model",
  };

  /** Post ids are 19-digit numeric strings — never Number-coerced. */
  const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

  function bulkPost(id: string): Post {
    return {
      id,
      text: `Hiring a frontend developer — post ${id}`,
      author: "techco",
      permalink: `https://www.threads.com/@techco/post/${id}`,
      timestamp: "2026-10-24T00:00:00.000Z",
    };
  }

  /** Bulk verdict body covering exactly the given ids. */
  function bulkContent(ids: readonly string[]): string {
    return JSON.stringify(
      Object.fromEntries(ids.map((id) => [id, { relevant: true, locationOk: true }])),
    );
  }

  it("judges ten posts with a single bulk call", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => bulkPost(id19(i + 1)));
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      return ok(bulkContent(posts.map((p) => p.id)));
    };

    const result = await judgePosts(
      posts,
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 1);
    assert.equal(result.skippedPostIds.length, 0);
    assert.deepEqual(
      result.judged.map((j) => j.post.id),
      posts.map((p) => p.id),
    );
    assert.ok(result.judged.every((j) => j.verdict.relevant && j.verdict.locationOk));
  });

  it("chunks fifteen posts into two bulk calls", async () => {
    const posts = Array.from({ length: 15 }, (_, i) => bulkPost(id19(i + 1)));
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      return ok(bulkContent(posts.map((p) => p.id)));
    };

    const result = await judgePosts(
      posts,
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 2);
    assert.equal(result.judged.length, 15);
    assert.equal(result.skippedPostIds.length, 0);
  });

  it("falls back to the single-post call only for items missing from the bulk response", async () => {
    const a = bulkPost(id19(1));
    const b = { ...bulkPost(id19(2)), text: "Second post text" };
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return ok(bulkContent([a.id])); // bulk covers a only — b is missing
      }
      return ok('{"relevant": false, "locationOk": true}');
    };

    const result = await judgePosts(
      [a, b],
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 2); // one bulk + one fallback — a is never re-judged
    assert.equal(result.judged.length, 2);
    assert.deepEqual(result.skippedPostIds, []);
    assert.deepEqual(result.judged.find((j) => j.post.id === b.id)?.verdict, {
      relevant: false,
      locationOk: true,
    });
  });

  it("skips a post whose bulk verdict is missing and fallback fails twice", async () => {
    const good = bulkPost(id19(1));
    const bad = { ...bulkPost(id19(2)), text: "Failing post" };
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return ok(bulkContent([good.id])); // bulk misses the bad post
      }
      return new Response("Internal Server Error", { status: 500 }); // fallback 500s twice
    };

    const result = await judgePosts(
      [good, bad],
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 3); // 1 bulk (no batch retry) + 2 fallback attempts
    assert.equal(result.judged.length, 1);
    assert.equal(result.judged[0]?.post.id, good.id);
    assert.deepEqual(result.skippedPostIds, [bad.id]);
  });

  it("defers a wholly unanswered batch without firing fallback calls", async () => {
    const posts = [bulkPost(id19(1)), bulkPost(id19(2))];
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      return new Response("Bad Gateway", { status: 502 }); // every batch attempt fails
    };

    const result = await judgePosts(
      posts,
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 1); // one batch attempt, zero fallback calls
    assert.equal(result.judged.length, 0);
    assert.deepEqual(result.skippedPostIds, posts.map((p) => p.id));
  });

  it("defers a batch whose request times out", async () => {
    const posts = [bulkPost(id19(1)), bulkPost(id19(2))];
    const mockFetch = async () => {
      throw new Error("The operation was aborted due to timeout");
    };

    const result = await judgePosts(
      posts,
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(result.judged.length, 0);
    assert.deepEqual(result.skippedPostIds, posts.map((p) => p.id));
  });

  it("still falls back per item when the batch answers with unparseable text", async () => {
    const a = bulkPost(id19(1));
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return ok("I cannot judge these posts."); // answered, but not JSON
      }
      return ok('{"relevant": true, "locationOk": true}');
    };

    const result = await judgePosts(
      [a],
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 2); // one batch + one fallback — a parse miss is not a transport failure
    assert.equal(result.judged.length, 1);
    assert.deepEqual(result.skippedPostIds, []);
  });

  it("sends the json_object rider and the keyword criterion on the bulk call only", async () => {
    const a = bulkPost(id19(1));
    const b = bulkPost(id19(2));
    const bodies: string[] = [];
    const mockFetch = async (_url: unknown, options?: unknown) => {
      bodies.push((options as { body: string }).body);
      if (bodies.length === 1) {
        return ok(bulkContent([a.id])); // b falls back
      }
      return ok('{"relevant": true, "locationOk": true}');
    };

    await judgePosts([a, b], sampleConfig, KEYWORDS, mockFetch as unknown as typeof fetch);
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0]?.includes('"response_format":{"type":"json_object"}'));
    // "next.js" occurs only in the serialized keyword list — a discriminating token.
    assert.ok(bodies[0]?.includes("next.js"));
    assert.ok(!bodies[1]?.includes('"response_format"')); // fallback payload carries no rider
    assert.ok(bodies[1]?.includes("next.js")); // and the fallback system message
  });
});
````

#### 2. `tests/state.test.ts` — NEW
**File**: `tests/state.test.ts`
**Changes**: `saveState` no-op gate on both branches (`result.saved === false` plus a byte-identical file) with a positive control that actually saves and round-trips via the `filePath` seam.

````typescript
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { type AppState, CURRENT_STATE_VERSION, loadState, saveState } from "../src/state.js";

// Files live in the OS temp dir; the suite cleans up once (offline test rule).
let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

const STATE: AppState = { version: CURRENT_STATE_VERSION, seenPostIds: ["1", "2"] };

/** Temp state file path; seeds the file when an initial state is given. */
async function tempStateFile(name: string, initial?: AppState): Promise<string> {
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

  it("records only the unseen ids and round-trips through loadState", async () => {
    const path = await tempStateFile("positive.json", STATE);
    const result = await saveState(STATE, ["2", "3"], path);
    assert.equal(result.saved, true);
    assert.equal(result.addedCount, 1);
    const reloaded = await loadState(path);
    assert.equal(reloaded.version, CURRENT_STATE_VERSION);
    assert.deepEqual(reloaded.seenPostIds, ["1", "2", "3"]);
  });
});
````

#### 3. `tests/heartbeat.test.ts` — MODIFY (vocabulary updates)
**File**: `tests/heartbeat.test.ts`
**Changes**: STATS fixture field, the "puts keyword maybes first" title and its `maybe` variable, the "does not repeat a maybe as a near-miss" title, the funnel count assert, and the candidate fixture plus tag assert.

````diff
// STATS fixture
    recencyHours: 72,
-  maybes: 1,
+  judged: 1,
    relevantLocated: 0,

// selectCandidates describe, first test
-  it("puts keyword maybes first", () => {
-    const maybe = post("m1", "Hiring React dev", 5);
+  it("puts judged candidates first", () => {
+    const lead = post("m1", "Hiring React dev", 5);
     const near = post("n1", "Software engineer Jakarta", 1);
-    const result = selectCandidates([maybe, near], [maybe], TERMS, 10);
-    assert.equal(result[0]?.reason, "maybe");
+    const result = selectCandidates([lead, near], [lead], TERMS, 10);
+    assert.equal(result[0]?.reason, "judged");
     assert.equal(result[0]?.post.id, "m1");
     assert.equal(result[1]?.reason, "near-miss");

// selectCandidates describe, third test
-  it("does not repeat a maybe as a near-miss", () => {
-    const maybe = post("m1", "Hiring React dev", 5);
-    const result = selectCandidates([maybe], [maybe], TERMS, 10);
+  it("does not repeat a judged candidate as a near-miss", () => {
+    const lead = post("m1", "Hiring React dev", 5);
+    const result = selectCandidates([lead], [lead], TERMS, 10);
     assert.equal(result.length, 1);

// buildHeartbeatBody funnel count assert
-    assert.ok(body.includes("1 keyword maybe(s)"));
+    assert.ok(body.includes("1 judged candidate(s)"));

// buildHeartbeatBody candidate fixture + tag assert
-      { post: post("c1", "Hiring React dev in Jakarta", 2, "techco"), reason: "maybe" },
+      { post: post("c1", "Hiring React dev in Jakarta", 2, "techco"), reason: "judged" },
-    assert.ok(body.includes("1. @techco — 2h ago [keyword match]"));
+    assert.ok(body.includes("1. @techco — 2h ago [judged]"));
````

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Zero stale gate references: `grep -rn "filterPostsByKeywords\|matchesKeywords" src/ tests/` returns nothing
- [x] Zero stale vocabulary in tests: `grep -rni "maybe" tests/` returns nothing (`judged` / `near-miss` only)
- [x] Bulk parser contract pinned: `grep -n "parseBulkVerdicts" tests/judge.test.ts` shows its describe
- [x] State gate pinned on both no-op branches: `grep -c "skips the disk write" tests/state.test.ts` returns 2
- [x] Rider asserted both ways: `grep -n "response_format" tests/judge.test.ts` shows the bulk-with-rider and fallback-without assertions
- [x] An unanswered batch (HTTP 502 and a thrown timeout) defers every post with zero fallback calls: `grep -c "defers a" tests/judge.test.ts` returns 2
- [x] An answered-but-unparseable batch still falls back per item: `grep -n "unparseable text" tests/judge.test.ts` shows the test
- [x] No test asserts the old cascade: `grep -rn "routes a wholly failed batch" tests/` returns nothing

#### Manual Verification:
- [x] Every double is an inline literal with one cast; no mock library; zero network; state files live under the OS temp dir with after() cleanup
- [x] Relocated suites (parseVerdict, resolveJudgeConfig, judgePost) assert body-for-body what tests/keywords.test.ts asserted; only the judgePost call sites gained the keywords argument
- [x] Test titles read as behavior specifications; one describe per exported function
- [x] The three new judgePosts tests read as the incident's contract: a transport failure defers the batch, a parse miss still falls back per item

---

## Phase 4: Docs sync + repo gates

### Overview

Sync every doc that names the old world: README (intro, pipeline steps, keywords table row), the e2e runbook (step 5 override target), root and scoped repo guidance, and AGENTS.md. The terminal repo gates (`npm run typecheck`, `npm run lint`, `npm test`) run on this phase.

### Changes Required:

#### 1. `README.md` — MODIFY
**File**: `README.md`
**Changes**: Intro paragraph, pipeline steps 5-6, and the keywords table row: keyword-criterion bulk judging replaces the substring gate and the per-post call.

````markdown
Region 1 — intro paragraph.

- Threads #hiring Indonesia job alerts. A GitHub Actions workflow loads the
- Threads surfaces listed in `watcher.config.json` every 10 minutes, filters
- posts for frontend / fullstack roles in Indonesia (or remote), and emails new
- matches as a plain-text digest. No web UI; the only persistence is
- `state/seen-posts.json`.
+ Threads #hiring Indonesia job alerts. A GitHub Actions workflow loads the
+ Threads surfaces listed in `watcher.config.json` every 10 minutes, has an LLM
+ judge posts against the configured keywords (Indonesia or remote roles), and
+ emails new matches as a plain-text digest. No web UI; the only persistence is
+ `state/seen-posts.json`.

Region 2 — pipeline steps 5-6.

- 5. A keyword pre-filter keeps frontend / fullstack candidates.
- 6. One LLM call per candidate returns `{relevant, locationOk}`.
+ 5. Every surviving post goes to the LLM judge in ~10-post bulk calls. The
+    `keywords` list is sent as the relevance criterion; a post the bulk
+    response misses falls back to a single-post call. A batch the endpoint
+    does not answer is deferred whole — those posts stay unseen and retry
+    on the next run.
+ 6. Each candidate gets a `{relevant, locationOk}` verdict. A judgment that
+    fails is skipped — the post stays unseen and retries on the next run.

Region 3 — keywords table row.

- | `keywords` | Pre-filter. A post must contain one of these to reach the judge. |
+ | `keywords` | The LLM judge's relevance criterion. A post matches only when it is a genuine job opening related to at least one of these. |
````

#### 2. `.claude/skills/validate-e2e/SKILL.md` — MODIFY
**File**: `.claude/skills/validate-e2e/SKILL.md`
**Changes**: Step 5: the widened-keyword override targets `judgePosts`, not `filterPostsByKeywords`.

````markdown
Region — step 5.

- 5. When the live feed has zero default-keyword matches, pass a widened
-    keyword override to `filterPostsByKeywords` so the judge and email stages
-    still run.
+ 5. When the live feed has zero keyword matches, pass a widened keyword list
+    to `judgePosts` so the judge and email stages still run.
````

#### 3. `.rpiv/guidance/architecture.md` — MODIFY
**File**: `.rpiv/guidance/architecture.md`
**Changes**: Project Overview sentence drops the hardcoded frontend/fullstack criterion; the `src/` pipeline tree line drops the keywords stage.

````markdown
Region 1 — Project Overview sentence.

- ...every 10 minutes from GitHub Actions, filters posts for frontend/fullstack roles, asks an OpenAI-compatible LLM to judge each candidate, and emails new matches as a plain-text digest.
+ ...every 10 minutes from GitHub Actions, asks an OpenAI-compatible LLM to judge candidates in bulk against the configured keywords, and emails new matches as a plain-text digest.

Region 2 — Architecture tree src/ line.

- src/                          # the pipeline: fetch → extract → dedupe → recency → seen → keywords → judge → email → state
+ src/                          # the pipeline: fetch → extract → dedupe → recency → seen → judge → email → state
````

#### 4. `.rpiv/guidance/src/architecture.md` — MODIFY
**File**: `.rpiv/guidance/src/architecture.md`
**Changes**: Module structure row drops `keywords.ts`; Responsibility and DI-example judge descriptions become bulk; the untested-module backlog reflects the new `state.ts` coverage.

````markdown
Region 1 — Responsibility paragraph, judge clause.

- ...fetches Threads posts, filters them, asks an LLM to judge each candidate, emails matches...
+ ...fetches Threads posts, filters them, asks an LLM to judge the candidates in bulk against the configured keywords, emails matches...

Region 2 — Module Structure funnel-narrowing row.

- recency.ts, keywords.ts, judge.ts                 # funnel narrowing: pure Post[] filters + one LLM verdict per candidate
+ recency.ts, judge.ts                              # funnel narrowing: recency window filter + bulk LLM verdicts (keywords = the relevance criterion)

Region 3 — Dependency-injection example, judgePost signature.

- export async function judgePost(post: Post, config: JudgeConfig,
-     fetchFn: typeof fetch = fetch): Promise<JudgeVerdict | null> { /* ... */ }
+ export async function judgePost(post: Post, config: JudgeConfig, keywords: readonly string[],
+     fetchFn: typeof fetch = fetch): Promise<JudgeVerdict | null> { /* ... */ }

Region 4 — Untested-module backlog body (the important-if wrapper line is unchanged).

- These modules have no test files — known backlog, not a deliberate skip. New work in them starts with tests. `state.ts` is unit-testable today: `loadState`/`saveState`/`writeStateAtomic` take `filePath` params (temp-file round-trip + corrupt-JSON rejects). `fetch-threads.ts` and `index.ts` need a seam added first.
+ `fetch-threads.ts` and `index.ts` have no test files — known backlog, not a deliberate skip. New work in them starts with tests, and both need a seam added first. `state.ts` is covered by `tests/state.test.ts` (the saveState gate).
````

#### 5. `.rpiv/guidance/tests/architecture.md` — MODIFY
**File**: `.rpiv/guidance/tests/architecture.md`
**Changes**: Grandfathered-exceptions line (judge/state now have their own files; the forward-looking 1:1 rule stays), doubles example gains the keywords arg, fixture step 5 drops the `keywords.test.ts` reference.

````markdown
Region 1 — grandfathered-exceptions line.

- Grandfathered exceptions: `session.test.ts` → `threads-session.ts`, and the `judge.ts` tests live inside `keywords.test.ts`. Going forward: mirror 1:1 — a new src module gets its own test file.
+ Grandfathered exception: `session.test.ts` → `threads-session.ts`. `judge.ts` and `state.ts` are covered by their own `judge.test.ts` / `state.test.ts`. Going forward: mirror 1:1 — a new src module gets its own test file.

Region 2 — doubles example, judgePost call.

- await judgePost(post, config, mockFetch as unknown as typeof fetch);
+ await judgePost(post, config, ["frontend"], mockFetch as unknown as typeof fetch);

Region 3 — fixture guidance step 5.

- 5. If the fixture contains post texts, check the shipped-config describe in `keywords.test.ts` still agrees
+ 5. If the fixture contains post texts, make sure they still agree with the shipped `watcher.config.json`
````

#### 6. `AGENTS.md` — MODIFY
**File**: `AGENTS.md`
**Changes**: What-this-project-is paragraph, pipeline line, and two module bullets: bulk keyword-criterion judging replaces the pre-filter chain and the per-candidate call.

````markdown
Region 1 — "What this project is" paragraph.

- ...loads the surfaces listed in `watcher.config.json`,
- filters posts for frontend / fullstack roles, asks an OpenAI-compatible LLM
- judge about each candidate, and emails new matches as a plain-text digest.
+ ...loads the surfaces listed in `watcher.config.json`,
+ asks an OpenAI-compatible LLM judge to keep posts matching the configured
+ keywords, and emails new matches as a plain-text digest.

Region 2 — Architecture pipeline line.

- fetch surfaces, dedupe posts, drop stale posts, drop seen posts, keyword
- pre-filter, LLM judge, email digest, commit state.
+ fetch surfaces, dedupe posts, drop stale posts, drop seen posts, LLM judge
+ against the configured keywords, email digest, commit state.

Region 3 — module bullet.

- - `src/keywords.ts`, `src/recency.ts` - the pre-judge filter chain
+ - `src/recency.ts` - drops posts outside the `recencyHours` window

Region 4 — module bullet.

- - `src/judge.ts` - one chat-completions call per candidate, returns
-   `{relevant, locationOk}`
+ - `src/judge.ts` - ~10-post bulk chat-completions calls judged against the
+   keywords in `watcher.config.json`; bulk misses fall back to single-post
+   calls, and a batch the endpoint does not answer is deferred whole;
+   returns `{relevant, locationOk}` per post

Region 5 — Commands list: typecheck scope plus the probe entry.

- - `npm run typecheck` - `tsc --noEmit` over `src/` and `tests/`
+ - `npm run typecheck` - `tsc --noEmit` over `src/`, `tests/`, and `scripts/`
+ - `npx tsx scripts/probe-judge.ts` - measure how long the LLM endpoint takes to answer (needs `LLM_*` env vars)
````

### Success Criteria:

#### Automated Verification:
- [x] Terminal gates pass: `npm run typecheck`, `npm run lint`, `npm test`
- [x] Zero stale gate references in docs: `grep -rn "filterPostsByKeywords\|matchesKeywords" README.md .claude/ .rpiv/guidance/ AGENTS.md` returns nothing
- [x] Zero deleted-module references in docs: `grep -rn "keywords.ts" README.md AGENTS.md .rpiv/guidance/` returns nothing
- [x] Zero stale vocabulary in docs: `grep -rni "keyword maybe\|\[keyword match\]" README.md .claude/ .rpiv/guidance/ AGENTS.md` returns nothing
- [x] Zero stale judge shape in docs: `grep -rni "pre-filter\|pre-judge\|one LLM call per candidate\|one chat-completions call per candidate\|one LLM verdict per candidate\|judge each candidate\|judge about each candidate" README.md AGENTS.md .rpiv/guidance/` returns nothing
- [x] Zero stale criterion wording in docs: `grep -rn "frontend / fullstack\|frontend/fullstack" README.md AGENTS.md .claude/ .rpiv/guidance/` returns nothing
- [x] Runbook override retargeted: `grep -n "judgePosts" .claude/skills/validate-e2e/SKILL.md` shows step 5 naming judgePosts (not filterPostsByKeywords)

#### Manual Verification:
- [x] README pipeline steps read in the new funnel order: fetch → dedupe → recency → seen → bulk judge (keywords criterion) → email/heartbeat → state
- [x] The README keywords row describes the criterion role; no substring-gate wording survives
- [x] validate-e2e step 5 is workable against the new judgePosts signature (keywords is a plain argument)
- [x] Guidance DI + doubles examples match the new judge signatures (keywords before trailing fetchFn)
- [x] AGENTS.md module list has no keywords.ts and the judge bullet describes bulk + per-item fallback
- [x] Root guidance tree reads fetch → extract → dedupe → recency → seen → judge → email → state (no keywords stage)

---

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 1 §1 (src/judge.ts) | src/judge.ts:111 | concern | code-quality | The fence's `buildMessages` user message replaces HEAD's escaped `\"${post.text}\"` with plain `"${post.text}"`, so the single-post fallback payload is not byte-identical to HEAD apart from the `keywords` param — contradicting the plan's own "What We're NOT Doing" invariant and the fence's judgePost docstring ("same payload shape") | Restore the `\"${post.text}\"` escaping in `buildMessages` so the fallback payload stays byte-identical | applied: escaped quotes restored in the Phase 1 `buildMessages` fence (plan-local; design follow-up: `.rpiv/artifacts/designs/2026-10-26_06-51-45_model-judged-keywords.md` carries the same plain quotes). Note: `\"` and `"` yield the same runtime string in a template literal, so the payload was already identical — this restores source parity with HEAD. |
| code     | Phase 2 §4 (src/keywords.ts) | tests/keywords.test.ts:11 | concern | actionability | Phase 2 deletes `src/keywords.ts` while `tests/keywords.test.ts:11` still imports `../src/keywords.js` until Phase 3, and `.github/workflows/ci.yml` runs `npm run typecheck` + `npm test` on every push to main — a per-phase commit of Phase 2 goes red in CI | Delete `tests/keywords.test.ts` in Phase 2 alongside `src/keywords.ts`, sourcing the relocated suites from git HEAD (or move the `src/keywords.ts` deletion into Phase 3) | applied: `tests/keywords.test.ts` deletion moved from Phase 3 into Phase 2 (new subsection 5, plus the `test ! -f` AV bullet and the frontmatter `files:` list); Phase 3 renumbered 4 → 3 and its AV bullet removed. |
| code     | Phase 1 §1 (src/judge.ts) | <n/a> | suggestion | code-quality | `judgeBatch`'s three failure warns (plus the catch) log "falling back to ${batch.length} single-post call(s)", but the per-item fallback runs `judgePost`'s 2-attempt loop per post — up to 2×`batch.length` calls — so the logged fallback volume understates the worst case by 2× | Reword the warns to "falling back to single-post calls (up to 2 attempts per post)" | applied: all four `judgeBatch` warns (HTTP, missing content, parse failure, request error) reworded to "falling back to single-post calls (up to 2 attempts per post)". |

_Coverage reviewer emitted zero rows: every design `## Verification Notes`, `## Precedents & Lessons`, `## Desired End State`, `## Performance Considerations`, `## Migration Notes`, and `## Scope` entry lands in a phase Success Criteria bullet, a code mirror, the Testing Strategy, the Performance/Migration sections, or the What We're NOT Doing list._

---

## Testing Strategy

### Automated:
- `npm run typecheck` — `tsc --noEmit` over `src/` and `tests/` (Phases 3, 4)
- `npm run lint` — Biome check over `src/` and `tests/` (Phases 3, 4)
- `npm test` — `node:test` unit suite via tsx, offline and deterministic (Phases 3, 4)
- `npx biome check src/index.ts src/heartbeat.ts src/types.ts` — scoped lint for Phase 2's own files
- Grep sweeps per phase (stale gate references, stale vocabulary, deleted-module references, rider count, chunking wiring)

### Manual Testing Steps:
1. Run `npm run typecheck && npm run lint && npm test` after Phase 3 and again after Phase 4 (CI parity).
2. One live run with real `LLM_*` and `GMAIL_*` env vars: confirm a match run produces a digest plus a state commit (neither path has ever fired in production).
3. Confirm skipped ids stay unseen and retry on the next run.
4. Phase 0's probe run answers this before any code ships: confirm the endpoint accepts a ~10-post prompt and honors `json_object`, and read the measured duration into `REQUEST_TIMEOUT_MS`.
5. After the fix, re-run `workflow_dispatch` and confirm the judge stage finishes inside the job budget: the log shows 29 bulk calls (fewer once the backlog clears), the digest or the heartbeat emails, and the state step commits.

## Performance Considerations

Revised 2026-10-26 after production run 40264368939 — see the Production Incident section.

- The first run after this change judges the whole unseen backlog: 283 posts on 2026-10-26, because the keyword pre-filter era committed almost nothing to state. Steady state is the unseen tail only (~17 new posts per 10-minute run).
- Happy path: ceil(N/BATCH_SIZE) LLM calls. 283 posts at BATCH_SIZE 10 = 29 calls.
- Worst case deterministic: ceil(N/BATCH_SIZE) calls. A batch the endpoint does not answer is deferred whole — no per-item cascade — so a slow endpoint costs one timeout per batch, not 2N calls.
- Wall-clock bound: 29 batches × 60s = 29 minutes of judge, plus ~3.5 minutes of fetch. The job budget must exceed that with headroom; Phase 0 sets it to 45 minutes.
- No caching introduced; temperature 0 unchanged; no new runtime dependencies.

## Migration Notes

Not applicable — no persisted schema change (`AppState` untouched); the state file format and commit-back flow are byte-identical.

## Developer Context

Step 4 review triage (all three code-reviewer rows applied):
- Phase 1 `buildMessages` restored HEAD's escaped `\"${post.text}\"` (plan-local; the design artifact carries the same plain quotes and needs the same fix). Runtime payload was already identical — `\"` and `"` are the same string in a template literal; this restores source parity.
- `tests/keywords.test.ts` deletion moved from Phase 3 into Phase 2 (subsection 5, plus the `test ! -f` AV bullet and the frontmatter `files:` list). Phase 3 renumbered 4 → 3. Reason: `.github/workflows/ci.yml` runs `npm run typecheck` + `npm test` on every push, so a Phase 2 commit that deletes `src/keywords.ts` while the test still imports it goes red.
- All four `judgeBatch` warns reworded to "falling back to single-post calls (up to 2 attempts per post)" — the old text named `${batch.length}` calls while the per-item fallback runs a 2-attempt loop per post.

Orchestrator self-verification (after Step 5): the Phase 1 `src/judge.ts` fence and the Phase 3 `tests/judge.test.ts` / `tests/state.test.ts` fences were extracted to temp files and checked against the live tree. `npx tsc --noEmit` exits 0 on the judge.ts fence; `npx biome check` exits 0 on all three fences after joining the two `content:` template-literal assignments onto one line (Biome keeps a lone template literal inline — the design's split form failed `npm run lint`). The judge.test.ts fence's only tsc errors are the 10 expected ones against HEAD's old judge API (missing `parseBulkVerdicts` export, 4-arg call sites) — they clear once Phase 1 lands. Temp files removed; working tree clean.

## References

- Design: `.rpiv/artifacts/designs/2026-10-26_06-51-45_model-judged-keywords.md`
- Solutions: `.rpiv/artifacts/solutions/2026-10-26_06-15-51_model-judged-keywords.md`
- Research: `.rpiv/artifacts/research/2026-10-25_21-35-06_model-judged-keywords.md`
- Discover (FRD): `.rpiv/artifacts/discover/2026-10-25_21-20-20_model-judged-keywords.md`

---

## Follow-up (2026-10-26T10:35:04+0700)

**Trigger:** production run [40264368939](https://github.com/ukind/loker-watcher/actions/runs/40264368939) cancelled at the 10-minute job cap. Full evidence table in the Production Incident section.

**What changed:**

- New **Phase 0** — `scripts/probe-judge.ts` plus a `workflow_dispatch`-only `probe` job in `watch.yml`, so the endpoint's real latency from a runner is measured before any timeout value is chosen. `tsconfig.json` and `package.json` bring the script under the repo gates (`scripts/hooks/*.js` stays outside both).
- **Phase 1** retitled "Bulk judge core + resilience": `REQUEST_TIMEOUT_MS` 15s → 60s, and `judgeBatch` now returns a `BatchOutcome` union so an unanswered batch is deferred whole instead of cascading into up to 2×BATCH_SIZE more calls at the same slow endpoint. The per-item fallback survives for parse-level misses only.
- **Phase 1 and Phase 3 criteria unchecked** where the prior implementation no longer satisfies them; new criteria pin the defer contract, the three unanswered return sites, and the ceil(N/BATCH_SIZE) worst case.
- **Phase 4** gains the defer wording in README pipeline step 5 and the AGENTS.md judge bullet, plus the probe entry in the Commands list and the corrected typecheck scope.
- **Performance Considerations** rewritten: the unseen backlog is 283 posts, not a handful; the worst case is ceil(N/BATCH_SIZE) calls; the wall-clock bound is 29 batches × 60s plus ~3.5 minutes of fetch, which is what sets the 45-minute job budget.
- **What We're NOT Doing** drops the `watch.yml` exclusion (it was the binding constraint) and adds an explicit exclusion of a per-run judge cap or judge deadline.

**Verification of this revision:** both revised fences were extracted from the plan and checked in their real locations. `npm run typecheck` exits 0 on the `src/judge.ts` fence; `npx biome check` exits 0 on the `src/judge.ts` and `scripts/probe-judge.ts` fences; `npx tsc --noEmit` exits 0 on the probe fence with `scripts` added to the tsconfig include. Temp files removed; the working tree carries only this plan file.

**Still open, and owned by Phase 0:** the measured bulk-call latency from a runner. Until the probe runs, 60s and `BATCH_SIZE = 10` are proposals, not confirmed values.
