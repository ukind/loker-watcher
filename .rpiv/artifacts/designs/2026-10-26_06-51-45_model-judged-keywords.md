---
date: 2026-10-26T06:51:45+0700
author: Yogiswara Utama
commit: 67d422d
branch: main
repository: loker-watcher
topic: "Model-judged keyword filtering"
tags: [design, judge, keywords, bulk, heartbeat, state, tests, docs]
status: ready
parent: ".rpiv/artifacts/solutions/2026-10-26_06-15-51_model-judged-keywords.md"
last_updated: 2026-10-26T06:51:45+0700
last_updated_by: Yogiswara Utama
---

# Design: Model-judged keyword filtering

## Summary

The keyword substring gate is deleted; every recency+seen survivor reaches the judge. `src/judge.ts` is rewritten around ~10-post bulk calls — the config keyword list is serialized into the system prompt as the relevance criterion, the model answers with an id-keyed verdict object, and the bulk payload sets `response_format: {"type":"json_object"}`. Items the bulk response misses or mangles fall back to the unchanged single-post `judgePost` (2 attempts); the batch call itself gets no retry, keeping the worst case deterministic at ceil(N/10) + 2N calls. The funnel stats rename `maybes` → `judged` (posts SENT to the judge), heartbeat vocabulary follows, and the relocated test suite plus a new state-gate suite pin the D3 invariant. Docs sync across README, the e2e runbook, repo guidance, and AGENTS.md.

## Requirements

- Relevance = "the model judges the post related to any keyword in watcher.config.json"; the substring gate goes away entirely (FRD).
- Batched judging: ~10 posts per LLM call — fewer calls than posts.
- A failed judgment never throws, never marks a post seen; skipped posts retry next run (D3).
- Config keywords stay required and non-empty with byte-identical validation errors (FRD #7).
- "keyword maybe" vocabulary leaves stats, copy, tags, tests, and docs in one change.
- Hard bounds: 10-minute Actions job (watch.yml:20); strict TS flags incl. noUncheckedIndexedAccess; no new runtime deps; batch size is a module constant, not a config key.

## Current State Analysis

- Gate: `filterPostsByKeywords(newPosts, config.keywords)` at src/index.ts:94 (import :19), zero-maybes early return src/index.ts:96-101.
- Judge: one call per post — `judgePosts` loop src/judge.ts:185-205, `judgePost` src/judge.ts:120-179 with 2-attempt retry (:135) and 15s timeout (:14, armed :144). `parseVerdict` (:63-95) is a total fence/slice-tolerant parser returning null on failure. `buildMessages` (:100-114) hardcodes the "frontend or fullstack web development" criterion and exemplars.
- Contract: `JudgeBatchResult {judged, skippedPostIds}` (src/judge.ts:27-30), single production consumer src/index.ts:103-108.
- Stats/heartbeat: `maybes` init src/index.ts:79, set :95; `HeartbeatStats` doc src/heartbeat.ts:33-34; copy "N keyword maybe(s)" :115; tag "[keyword match]" :128; `Candidate.reason "maybe" | "near-miss"` :47; module doc and selectCandidates doc also say "keyword maybe".
- State: email before state (src/index.ts:121 then :127-128); `saveState` re-gates via `diffNewIds` (src/state.ts:177-183); atomic write :146-151.
- Tests: judge suites live in tests/keywords.test.ts (:118-265); judgePosts mock body-sniffs "Failing post" (:242-254) — ambiguous once the bulk body carries ALL candidate texts. tests/heartbeat.test.ts pins the old vocabulary at :38, :61, :138, :142-149.
- Docs naming the old world: README.md pipeline steps 5-6 (:19, :21) and the keywords table row (:68); .claude/skills/validate-e2e/SKILL.md:16 (filterPostsByKeywords override); .rpiv/guidance/src/architecture.md module structure; .rpiv/guidance/tests/architecture.md grandfathered-exceptions line; AGENTS.md architecture section ("keywords.ts ... pre-judge filter chain").

### Key Discoveries

- `Post.id` is a 19-digit numeric string (src/types.ts:10-12) — never Number()-coerced; a Map keyed by string id neutralizes hostile `__proto__` keys.
- `parseVerdict`'s fence-strip + first-brace-to-last-brace slice tolerances are the seed for the bulk parser; container-null vs item-null semantics mirror the parse-don't-validate edge idiom (src/extract.ts:46-60).
- Trailing DI seam `fetchFn` (src/judge.ts:123, :188) keeps every judge test offline; it survives with `keywords` inserted before it.
- env config (JudgeConfig) and file config (keywords) are separate sources — keywords ride as a plain parameter, NOT folded into JudgeConfig.
- Funnel convention: every stage logs its INPUT size; the judged counter therefore means posts sent (`newPosts.length`), with judge outputs already counted by `relevantLocated`/`skipped`.
- Double-gated persistence: pipeline guard (src/index.ts:113-117) + `saveState` re-gate (src/state.ts:177-183) — untouched by this change; skipped ids are structurally unable to reach disk.
- The digest + state-commit paths have never fired in production (6 validation rounds, all zero-match) — one live match run is a standing acceptance item.
- `readStringArray(record.keywords, ..., true)` (src/config-file.ts:79) keeps keywords required/non-empty; errors :100-118 stay byte-identical.

## Scope

### Building

- Delete the gate call, the zero-maybes early return, and src/keywords.ts.
- Bulk judge core in src/judge.ts: BATCH_SIZE=10 module constant, id-keyed `parseBulkVerdicts` (exported), `buildBulkMessages` (keywords JSON in system message), `response_format {"type":"json_object"}` on the bulk payload only, per-item fallback via the unchanged single-post judgePost, keywords param before trailing fetchFn on judgePosts/judgePost.
- Funnel rework in src/index.ts: stats.judged = newPosts.length, one judge log line, heartbeat call sites feed newPosts.
- Heartbeat vocabulary: field rename maybes→judged, reason "judged", copy "N judged candidate(s)", tag "[judged]".
- JudgeVerdict.relevant doc reword (keyword-guided, not frontend/fullstack-specific).
- Test relocation: tests/judge.test.ts (relocated parseVerdict/resolveJudgeConfig/judgePost suites verbatim + reworked bulk AC suite with call-count mock routing); new tests/state.test.ts (saveState no-op gate + positive control); tests/heartbeat.test.ts vocabulary updates; tests/keywords.test.ts deleted.
- Docs sync: README.md, .claude/skills/validate-e2e/SKILL.md, .rpiv/guidance/architecture.md, .rpiv/guidance/src/architecture.md, .rpiv/guidance/tests/architecture.md, AGENTS.md.
- One live verification run after implementation (manual, post-implement).

### Not Building

- New config keys (batch size stays a module constant) and candidate caps.
- Strict `json_schema` (OpenAI-specific; Z.AI documents json_object only).
- response_format on the fallback path — the single-post call stays byte-identical apart from the keywords param.
- Keyword validation changes (error texts stay byte-identical).
- watch.yml changes, state schema changes, email digest changes.

## Decisions

### D1: Bulk + json_object rider, no batch retry (solutions Option 2)

One chat-completions call per ~10-post chunk; the payload sets `response_format {"type":"json_object"}` (provider-documented on Z.AI; a proxy silently dropping the field degrades to plain parsing — LiteLLM issue 37720 evidence). The batch call gets NO retry: `judgePost`'s 2-attempt loop stays the only retry mechanism, so the worst case is deterministic — ceil(N/10) + 2N fetches. Whole-batch failure (HTTP / missing content / container-parse null) routes every item of that batch into per-item fallback.

### D2: Id-keyed verdict object, Map via Object.entries (research checkpoint)

`{"<post id>": {"relevant": ..., "locationOk": ...}}`. `parseBulkVerdicts(content): Map<string, JudgeVerdict> | null` — container null ONLY when the whole response is unrecoverable (no braces, JSON.parse throw, non-object container); a malformed item is absent from the Map, never fails the batch. `Map.get` types cleanly under noUncheckedIndexedAccess and neutralizes prototype-polluting keys. Duplicate JSON keys collapse last-wins by construction; extra/hallucinated ids are never looked up (the router iterates the batch's Posts).

### D3: keywords rides as a plain parameter (repo DI convention)

`judgePosts(candidates, config, keywords, fetchFn = fetch)` and `judgePost(post, config, keywords, fetchFn = fetch)` — plain `readonly string[]` BEFORE the trailing fetchFn. Not folded into JudgeConfig: that interface is env-resolved, keywords are file-config. Serialization is `JSON.stringify(keywords)` inside one labeled sentence in the SYSTEM message (criteria channel); post id+text pairs stay in the user message (data channel). The hardcoded "frontend or fullstack web development" criterion AND its exemplars are replaced — both would fight the config list.

### D4: judged counter = posts sent to the judge; field renamed (design checkpoint)

`HeartbeatStats.maybes: number` → `judged: number` (src/heartbeat.ts:34), doc "Posts sent to the LLM judge (all recency+seen survivors)". Set once at src/index.ts (right after diffNew, before the first heartbeat site) from `newPosts.length`. Funnel log becomes ONE judge-stage line: `judge: N candidate(s) judged, M relevant+located, skipped: K`. Depth confirmed by developer: rename the field, param names, copy, and log — typecheck forces every consumer, no stale name survives.

### D5: Candidate vocabulary rename (research checkpoint)

`Candidate.reason "maybe"` → `"judged"` (src/heartbeat.ts:47), tier label in selectCandidates, tag "[keyword match]" → "[judged]" (:128), body copy "N keyword maybe(s)" → "N judged candidate(s)" (:115), "near-miss" survives untouched. Post-gate, the old labels are false statements.

### D6: Docs in scope (design checkpoint)

README.md, the e2e runbook, .rpiv/guidance/architecture.md, .rpiv/guidance/src/architecture.md, .rpiv/guidance/tests/architecture.md, and AGENTS.md update in the same change. Rationale: this repo was burned by stale-docs follow-up commits (67a9bd2); one-item-one-name applies to docs too.

### D7: Fallback reuse, verbatim semantics

`judgePost` keeps its 2-attempt loop, warn lines (:149, :160, :170, :174), and null-on-failure return unchanged apart from the keywords param. Batch-stage warns are NEW and carry no "/2" suffix (one batch attempt). The skip warn names both stages ("after bulk miss and retry").

### D8: parseBulkVerdicts exported; BATCH_SIZE unexported

Export parity with `parseVerdict` (tests pin container-vs-item null semantics directly). BATCH_SIZE = 10 sits beside REQUEST_TIMEOUT_MS (src/judge.ts:14), unexported like its neighbor — tests assert call counts (10 posts → 1 call; 15 → 2), not the constant.

## Architecture

### src/judge.ts — MODIFY (near-total rewrite)

Bulk judge core: BATCH_SIZE, normalizeEndpoint helper, buildBulkMessages, parseBulkVerdicts (exported), judgeBatch (no retry), judgePosts chunk loop with per-item fallback; keywords param added to judgePost/judgePosts; response_format rider on the bulk payload only; resolveJudgeConfig, JudgeConfig, JudgedPost, JudgeBatchResult, parseVerdict unchanged.

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
 * The batch call itself gets no retry — judgePost's loop stays the only
 * retry mechanism, so the worst case is deterministic:
 * ceil(N/BATCH_SIZE) + 2N calls. A post that fails both stages is skipped
 * for this run, logged visibly, and omitted from state (D3: it stays
 * unseen and retries next run).
 */
import { ENV_NAMES } from "./config.js";
import type { JudgeVerdict, Post } from "./types.js";

const REQUEST_TIMEOUT_MS = 15_000;

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
      content:
        `You are an automated evaluation filter for job alerts. A post is relevant when it is a genuine job opening related to at least one of these keywords: ${JSON.stringify(keywords)}. You also determine whether the position is in Indonesia or remote.`,
    },
    {
      role: "user",
      content: `Analyze the following Threads post by @${post.author}:\n\n"${post.text}"\n\nDetermine two criteria:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above. Set false if it is a job seeker seeking work, an internship inquiry, a training promotion, or an unrelated role.\n2. locationOk: true ONLY if the job is located in Indonesia (e.g. Jakarta, Bali, Surabaya, hybrid in ID), or explicitly remote / work from anywhere. Set false if the role is on-site or hybrid in another country with no remote option.\n\nRespond with ONLY a raw JSON object matching this schema:\n{"relevant": boolean, "locationOk": boolean}`,
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
      content:
        `You are an automated evaluation filter for job alerts. A post is relevant when it is a genuine job opening related to at least one of these keywords: ${JSON.stringify(keywords)}. You also determine whether the position is in Indonesia or remote.`,
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

/**
 * One bulk call for up to BATCH_SIZE posts. No retry: any failure degrades
 * the whole batch to per-item fallback (judgePost's loop stays the only
 * retry mechanism, keeping worst-case call counts deterministic).
 * Returns null when the response is unrecoverable (HTTP failure, missing
 * content, or a container-level parse failure).
 */
async function judgeBatch(
  batch: readonly Post[],
  config: JudgeConfig,
  keywords: readonly string[],
  fetchFn: typeof fetch,
): Promise<Map<string, JudgeVerdict> | null> {
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
        `judge: batch (${batch.length} posts) HTTP ${response.status} ${response.statusText} — falling back to ${batch.length} single-post call(s)`,
      );
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = data.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string") {
      console.warn(
        `judge: batch (${batch.length} posts) missing message content — falling back to ${batch.length} single-post call(s)`,
      );
      return null;
    }

    const verdicts = parseBulkVerdicts(rawContent);
    if (verdicts === null) {
      console.warn(
        `judge: batch (${batch.length} posts) failed to parse bulk verdicts: ${rawContent.slice(0, 100)} — falling back to ${batch.length} single-post call(s)`,
      );
    }
    return verdicts;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `judge: batch (${batch.length} posts) request error: ${message} — falling back to ${batch.length} single-post call(s)`,
    );
    return null;
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
    const verdicts = await judgeBatch(batch, config, keywords, fetchFn);

    for (const post of batch) {
      const fromBulk = verdicts?.get(post.id);
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

### src/index.ts — MODIFY (funnel rework)

Gate call + zero-maybes return + keywords import deleted; stats.judged = newPosts.length after diffNew; ONE judge log line; heartbeat call sites feed newPosts; judgePosts gains the keywords arg; pipeline doc comment drops the keywords stage. Regions in file order; unchanged lines around each region stay on disk.

```typescript
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
```

### src/heartbeat.ts — MODIFY (vocabulary rework)

HeartbeatStats.maybes → judged (doc reworded); Candidate.reason union; selectCandidates param + tier reason; funnel copy; candidate tag; module doc paragraph. Regions in file order; unchanged lines stay on disk.

```typescript
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
```

### src/types.ts — MODIFY (doc reword)

JudgeVerdict.relevant doc: keyword-guided relevance instead of frontend/fullstack-specific.

```typescript
/** LLM verdict for one candidate post (judge, Slice 4). */
export interface JudgeVerdict {
  /** The post is a genuine job opening related to the configured keywords. */
  relevant: boolean;
  /** The role is in Indonesia or remote. */
  locationOk: boolean;
}
```

### src/keywords.ts — DELETE

Zero callers after the gate removal. tests/keywords.test.ts (its last importer) is deleted in Slice 3.

### tests/judge.test.ts — NEW (relocated + reworked)

parseVerdict, resolveJudgeConfig, judgePost describes relocated verbatim from tests/keywords.test.ts:118-221 (the fallback's correctness proof); judgePosts describe reworked into the bulk AC suite (call-count mock routing, keywords/body assertions, wire-shape assertion, id-safety).

```typescript
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

  it("routes a wholly failed batch through the fallback without a batch retry", async () => {
    const posts = [bulkPost(id19(1)), bulkPost(id19(2))];
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("Bad Gateway", { status: 502 }); // the one batch attempt
      }
      return ok('{"relevant": true, "locationOk": true}');
    };

    const result = await judgePosts(
      posts,
      sampleConfig,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(calls, 3); // 1 batch + 2 fallbacks — no second batch call
    assert.equal(result.judged.length, 2);
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
```

### tests/state.test.ts — NEW

saveState no-op gate: `result.saved === false` + byte-identical file on empty/all-seen ids; positive control that actually saves and round-trips via the filePath seam.

```typescript
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
```

### tests/keywords.test.ts — DELETE

Superseded by tests/judge.test.ts. Never copied — a leftover file fails typecheck on its ../src/keywords.js import.

### tests/heartbeat.test.ts — MODIFY (vocabulary updates)

STATS fixture field (:38), "puts keyword maybes first" (:61), "1 keyword maybe(s)" copy assert (:138), reason/tag asserts (:142-149).

```diff
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
```

### README.md — MODIFY

Intro paragraph, pipeline steps 5-6, and the keywords table row: keyword-criterion bulk judging replaces the substring gate and the per-post call.

```markdown
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
+    response misses falls back to a single-post call.
+ 6. Each candidate gets a `{relevant, locationOk}` verdict. A judgment that
+    fails is skipped — the post stays unseen and retries on the next run.

Region 3 — keywords table row.

- | `keywords` | Pre-filter. A post must contain one of these to reach the judge. |
+ | `keywords` | The LLM judge's relevance criterion. A post matches only when it is a genuine job opening related to at least one of these. |
```

### .claude/skills/validate-e2e/SKILL.md — MODIFY

Step 5 (:16): the widened-keyword override targets judgePosts, not filterPostsByKeywords.

```markdown
Region — step 5.

- 5. When the live feed has zero default-keyword matches, pass a widened
-    keyword override to `filterPostsByKeywords` so the judge and email stages
-    still run.
+ 5. When the live feed has zero keyword matches, pass a widened keyword list
+    to `judgePosts` so the judge and email stages still run.
```

### .rpiv/guidance/architecture.md — MODIFY

Project Overview sentence drops the hardcoded frontend/fullstack criterion; the src/ pipeline tree line drops the keywords stage. (Found by slice-verifier dispatch 1 — added to the slice.)

```markdown
Region 1 — Project Overview sentence.

- ...every 10 minutes from GitHub Actions, filters posts for frontend/fullstack roles, asks an OpenAI-compatible LLM to judge each candidate, and emails new matches as a plain-text digest.
+ ...every 10 minutes from GitHub Actions, asks an OpenAI-compatible LLM to judge candidates in bulk against the configured keywords, and emails new matches as a plain-text digest.

Region 2 — Architecture tree src/ line.

- src/                          # the pipeline: fetch → extract → dedupe → recency → seen → keywords → judge → email → state
+ src/                          # the pipeline: fetch → extract → dedupe → recency → seen → judge → email → state
```

### .rpiv/guidance/src/architecture.md — MODIFY

Module structure row drops keywords.ts; Responsibility and DI-example judge descriptions become bulk; the untested-module backlog reflects the new state.ts coverage.

```markdown
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
```

### .rpiv/guidance/tests/architecture.md — MODIFY

Grandfathered-exceptions line (judge/state now have their own files; the forward-looking 1:1 rule stays), doubles example gains the keywords arg, fixture step 5 drops the keywords.test.ts reference.

```markdown
Region 1 — grandfathered-exceptions line.

- Grandfathered exceptions: `session.test.ts` → `threads-session.ts`, and the `judge.ts` tests live inside `keywords.test.ts`. Going forward: mirror 1:1 — a new src module gets its own test file.
+ Grandfathered exception: `session.test.ts` → `threads-session.ts`. `judge.ts` and `state.ts` are covered by their own `judge.test.ts` / `state.test.ts`. Going forward: mirror 1:1 — a new src module gets its own test file.

Region 2 — doubles example, judgePost call.

- await judgePost(post, config, mockFetch as unknown as typeof fetch);
+ await judgePost(post, config, ["frontend"], mockFetch as unknown as typeof fetch);

Region 3 — fixture guidance step 5.

- 5. If the fixture contains post texts, check the shipped-config describe in `keywords.test.ts` still agrees
+ 5. If the fixture contains post texts, make sure they still agree with the shipped `watcher.config.json`
```

### AGENTS.md — MODIFY

What-this-project-is paragraph, pipeline line, and two module bullets: bulk keyword-criterion judging replaces the pre-filter chain and the per-candidate call.

```markdown
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
+   calls; returns `{relevant, locationOk}` per post
```

## Slices

### Slice 1: Bulk judge core

**Files**: `src/judge.ts`

#### Automated Verification:
- [ ] Bulk payload rider exactly once in code: `grep -c 'type: "json_object"' src/judge.ts` returns 1 (the module docstring also names response_format — expected; the single-post fallback payload carries no rider)
- [ ] Chunking wired: `grep -n "BATCH_SIZE" src/judge.ts` shows the constant beside REQUEST_TIMEOUT_MS and the slice step; no other magic batch numbers
- [ ] Exports intact: resolveJudgeConfig, parseVerdict, parseBulkVerdicts, judgePost, judgePosts, JudgeConfig, JudgedPost, JudgeBatchResult all still exported
- [ ] Batch warn lines carry no "/2" attempt suffix (the batch gets exactly one attempt); fallback warn lines keep theirs
- [ ] No Number()-coercion of post ids anywhere in the file (19-digit ids)
- [ ] parseVerdict is byte-identical to the current src/judge.ts on disk (fence-strip regexes included)

#### Manual Verification:
- [ ] Reading the file: bulk-first flow is obvious (judgeBatch → per-item fallback → skip warn naming both stages)
- [ ] The system message carries JSON.stringify(keywords) and no hardcoded "frontend or fullstack web development" criterion survives in either message builder

### Slice 2: Funnel + judged-counter rework

**Files**: `src/index.ts`, `src/heartbeat.ts`, `src/types.ts`, `src/keywords.ts` (DELETE)

#### Automated Verification:
- [ ] `grep -rn "filterPostsByKeywords\|matchesKeywords" src/` returns nothing
- [ ] `grep -rni "maybe" src/` returns nothing (field, param, reason, copy, tag sweep)
- [ ] `grep -rn "keywords.js" src/` returns nothing (import gone); `test ! -f src/keywords.ts` succeeds
- [ ] `grep -n "stats.judged" src/index.ts` shows exactly one assignment (`stats.judged = newPosts.length;`) placed before the first heartbeat call
- [ ] `grep -n "config.keywords" src/index.ts` shows exactly one occurrence — the third argument of the judgePosts call
- [ ] `grep -rn "keyword match\|keyword maybe" src/` returns nothing
- [ ] `npx biome check src/index.ts src/heartbeat.ts src/types.ts` exits 0

#### Manual Verification:
- [ ] Reading main(): funnel is fetch → extract → dedupe vs state → judge → email → state; the only pre-judge early return is zero unseen posts
- [ ] Both heartbeat call sites pass `newPosts` (posts sent to the judge) — never the `judged` output array
- [ ] Heartbeat funnel line reads "N judged candidate(s)"; judged-tier tag reads "[judged]"; near-miss tier untouched

### Slice 3: Test relocation + state gate tests

**Files**: `tests/judge.test.ts`, `tests/state.test.ts`, `tests/keywords.test.ts`, `tests/heartbeat.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] Superseded suite gone, no orphan import: `test ! -f tests/keywords.test.ts` succeeds
- [ ] Zero stale gate references: `grep -rn "filterPostsByKeywords\|matchesKeywords" src/ tests/` returns nothing
- [ ] Zero stale vocabulary in tests: `grep -rni "maybe" tests/` returns nothing (`judged` / `near-miss` only)
- [ ] Bulk parser contract pinned: `grep -n "parseBulkVerdicts" tests/judge.test.ts` shows its describe
- [ ] State gate pinned on both no-op branches: `grep -c "skips the disk write" tests/state.test.ts` returns 2
- [ ] Rider asserted both ways: `grep -n "response_format" tests/judge.test.ts` shows the bulk-with-rider and fallback-without assertions

#### Manual Verification:
- [ ] Every double is an inline literal with one cast; no mock library; zero network; state files live under the OS temp dir with after() cleanup
- [ ] Relocated suites (parseVerdict, resolveJudgeConfig, judgePost) assert body-for-body what tests/keywords.test.ts asserted; only the judgePost call sites gained the keywords argument
- [ ] Test titles read as behavior specifications; one describe per exported function

### Slice 4: Docs sync + repo gates

**Files**: `README.md`, `.claude/skills/validate-e2e/SKILL.md`, `.rpiv/guidance/architecture.md`, `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/tests/architecture.md`, `AGENTS.md`

#### Automated Verification:
- [ ] Terminal gates pass: `npm run typecheck`, `npm run lint`, `npm test`
- [ ] Zero stale gate references in docs: `grep -rn "filterPostsByKeywords\|matchesKeywords" README.md .claude/ .rpiv/guidance/ AGENTS.md` returns nothing
- [ ] Zero deleted-module references in docs: `grep -rn "keywords.ts" README.md AGENTS.md .rpiv/guidance/` returns nothing
- [ ] Zero stale vocabulary in docs: `grep -rni "keyword maybe\|\[keyword match\]" README.md .claude/ .rpiv/guidance/ AGENTS.md` returns nothing
- [ ] Zero stale judge shape in docs: `grep -rni "pre-filter\|pre-judge\|one LLM call per candidate\|one chat-completions call per candidate\|one LLM verdict per candidate\|judge each candidate\|judge about each candidate" README.md AGENTS.md .rpiv/guidance/` returns nothing
- [ ] Zero stale criterion wording in docs: `grep -rn "frontend / fullstack\|frontend/fullstack" README.md AGENTS.md .claude/ .rpiv/guidance/` returns nothing
- [ ] Runbook override retargeted: `grep -n "judgePosts" .claude/skills/validate-e2e/SKILL.md` shows step 5 naming judgePosts (not filterPostsByKeywords)

#### Manual Verification:
- [ ] README pipeline steps read in the new funnel order: fetch → dedupe → recency → seen → bulk judge (keywords criterion) → email/heartbeat → state
- [ ] The README keywords row describes the criterion role; no substring-gate wording survives
- [ ] validate-e2e step 5 is workable against the new judgePosts signature (keywords is a plain argument)
- [ ] Guidance DI + doubles examples match the new judge signatures (keywords before trailing fetchFn)
- [ ] AGENTS.md module list has no keywords.ts and the judge bullet describes bulk + per-item fallback
- [ ] Root guidance tree reads fetch → extract → dedupe → recency → seen → judge → email → state (no keywords stage)

## Desired End State

A zero-keyword-match feed no longer zeroes the funnel — the model decides:

```typescript
// src/index.ts (after the change)
const { judged, skippedPostIds } = await judgePosts(newPosts, resolveJudgeConfig(process.env), config.keywords);
// log: judge: 37 candidate(s) judged, 2 relevant+located, skipped: 1
// ceil(37/10) = 4 LLM calls on the happy path; the 1 skipped id stays unseen
// and retries next run; state persists all 37 judged ids only because matches > 0.
```

```text
// heartbeat body funnel (zero-match run)
  337 unique post(s)
  303 within 72h
  37 judged candidate(s)
  0 relevant + located
  1 skipped by the judge
```

## File Map

- src/judge.ts                       # MODIFY — bulk judge core (chunks, id-keyed parser, rider, fallback wiring)
- src/index.ts                       # MODIFY — gate deletion, stats.judged, one log line, heartbeat feeds
- src/heartbeat.ts                   # MODIFY — judged field/reason/copy/tag
- src/types.ts                       # MODIFY — JudgeVerdict.relevant doc reword
- src/keywords.ts                    # DELETE — zero callers post-gate
- tests/judge.test.ts                # NEW — relocated suites + bulk AC suite
- tests/state.test.ts                # NEW — saveState gate pin (D3 half)
- tests/keywords.test.ts             # DELETE — superseded
- tests/heartbeat.test.ts            # MODIFY — vocabulary updates
- README.md                          # MODIFY — intro, pipeline steps + keywords row
- .claude/skills/validate-e2e/SKILL.md # MODIFY — step 5 override target
- .rpiv/guidance/architecture.md     # MODIFY — overview + src/ pipeline tree (no keywords stage)
- .rpiv/guidance/src/architecture.md # MODIFY — module structure, DI example, backlog
- .rpiv/guidance/tests/architecture.md # MODIFY — exceptions line, doubles example, fixture step
- AGENTS.md                          # MODIFY — architecture section

## Ordering Constraints

- Slice 1 → 2 → 3 strictly sequential (signature seam: index.ts and tests compile against the new judge API only after their slices land).
- Slice 4 needs Slice 2 (docs describe the new funnel); it can run any time after 2 but is placed last so the repo gates live on the terminal slice.
- src/keywords.ts deletion (Slice 2) precedes tests/keywords.test.ts deletion (Slice 3) in design order; implement deletes both before running any gate.
- No parallelizable slices — every slice shares the judge surface.

## Verification Notes

- Terminal gates: `npm run typecheck`, `npm run lint`, `npm test` (CI parity) — Slice 4.
- Zero stale references: `grep -rn "filterPostsByKeywords\|matchesKeywords" src/ tests/` returns nothing (Slice 3).
- Zero stale vocabulary: `grep -rni "keyword maybe\|\[keyword match\]" src/ tests/ README.md` returns nothing (Slices 2-4).
- Bulk rider present exactly once in code: `grep -c 'type: "json_object"' src/judge.ts` returns 1 (bulk payload only; the docstring mention is expected, the fallback payload carries no rider).
- Precedent lesson: "keyword maybe" copy is load-bearing in three code sites + docs — grep the whole repo, update in one change (67a9bd2 follow-ups).
- Precedent lesson: widening keywords empirically failed (c64c427/18246dd) — funnel problems are now model judgment problems; verify a REAL match run end-to-end (digest + state commit have never fired in production).
- Live-run watch items: endpoint accepts ~10-post prompts; skipped counts stay near zero across the first runs (whole-batch timeouts would inflate fallback volume).
- Batch warns must NOT carry the "/2" suffix (one batch attempt).

## Performance Considerations

- Happy path: ceil(N/10) LLM calls (typical run: 1-2 — seen-state diffing leaves handfuls unseen; measured 288-504 unique posts/run but small unseen tails).
- Worst case deterministic: ceil(N/10) + 2N calls; wall-clock per doomed post ≤ 3 × 15s (timeout armed per fetch).
- The 15s timeout now bounds a whole batch: a timed-out chunk routes ≤10 items to fallback (≤20 extra calls); watch skipped counts on the first live runs.
- No caching introduced; temperature 0 unchanged; no new dependencies.

## Migration Notes

Not applicable — no persisted schema change (AppState untouched); the state file format and commit-back flow are byte-identical.

## Pattern References

- src/judge.ts:63-95 — parseVerdict: fence/slice tolerances seed parseBulkVerdicts; total-function null-on-failure.
- src/extract.ts:46-60 — validate-per-item, drop-and-count: the repo's LLM/page-JSON ingestion idiom (per-item verdict validation).
- src/judge.ts:123, :188 — trailing fetchFn DI seam: all judge tests stay offline.
- src/state.ts:170-197 — saveState double-gate: the D3 invariant the new tests pin.
- src/index.ts:74-111 — stats triad rule (field + init + renderer together) and stage-log convention.

## Developer Context

**Q (design checkpoint, src/heartbeat.ts:34): The artifacts conflict on rename depth — research assumed the HeartbeatStats field renames, solutions only rewords the doc. How far does the maybes rename go?**
A: Rename to judged — field, param names, funnel copy, log line; typecheck forces every consumer, no stale name.

**Q (design checkpoint, docs scope): README + runbook are in the solutions scope; guidance files and AGENTS.md also name keywords.ts and the old judge-test location. Include them?**
A: Update them too — same change; prevents the doc-drift this repo was burned by (67a9bd2).

**Inherited research checkpoint decisions (never re-asked):**
- Wire shape: id-keyed object over array-of-items (Map via Object.entries; ids never Number-coerced).
- Judged-candidates stat meaning: posts SENT to the judge (newPosts.length) — funnel input-counting convention.
- Batch retry budget: none; judgePost's 2-attempt loop is the only retry (deterministic worst case ceil(N/10) + 2N).
- Z.AI structured output: json_object documented; strict json_schema is OpenAI-specific — not used.

## Design History

- Slice 1: Bulk judge core — approved as generated (slice-verifier: Decisions OK, Cross-slice OK, Research OK after 2 mechanical fixes — grep criterion refined to 'type: "json_object"'; quote-escapes replaced by plain quotes, verified with biome check exit 0)
- Slice 2: Funnel + judged-counter rework — approved as generated (slice-verifier: Decisions OK, Cross-slice OK, Research OK; no violations)
- Slice 3: Test relocation + state gate tests — approved as generated (slice-verifier dispatch 1: one real violation — 10 lines over biome lineWidth 100; dispatch 2 after reformatting to biome-canonical shape: Decisions OK, Cross-slice OK, Research OK; npx biome check exits 0 on the staged code; bulk/fallback body asserts strengthened to the discriminating "next.js" token)
- Slice 4: Docs sync + repo gates — approved as generated after revision (slice-verifier dispatch 1: two violations — README/AGENTS intros kept the hardcoded "frontend / fullstack" criterion wording, root .rpiv/guidance/architecture.md missing from scope; dispatch 2: one violation — grandfathered-line rewrite asserted present-tense 1:1 mirroring, contradicting the untested-module backlog — fixed to forward-looking wording plus a backlog region updating state.ts coverage; dispatch 3: Decisions OK, Cross-slice OK; Research warning on gate escaping resolved — criteria ship with escaped \| alternation)

## References

- .rpiv/artifacts/solutions/2026-10-26_06-15-51_model-judged-keywords.md — selected approach (Option 2), effort, risks
- .rpiv/artifacts/research/2026-10-25_21-35-06_model-judged-keywords.md — full codebase grounding, precedents, test fate table
- .rpiv/artifacts/discover/2026-10-25_21-20-20_model-judged-keywords.md — the FRD
- docs.z.ai/guides/capabilities/struct-output — provider json_object documentation
- github.com/BerriAI/litellm/issues/37720 — proxy-drops-response_format evidence
