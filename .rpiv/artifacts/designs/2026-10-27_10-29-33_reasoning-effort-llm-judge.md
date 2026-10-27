---
date: 2026-10-27T10:29:33+0700
author: Yogiswara Utama
commit: 1cb1236
branch: ukind/add-reasoning-effort
repository: add-reasoning-effort
topic: "reasoning-effort-llm-judge"
tags: [designs, reasoning-effort, config-file, judge]
status: ready
parent: .rpiv/artifacts/solutions/2026-10-27_10-12-53_reasoning-effort-llm-judge.md
last_updated: 2026-10-27T10:29:33+0700
last_updated_by: Yogiswara Utama
---

# Design: Add global reasoningEffort config knob to LLM judge

## Summary

Add a global `reasoningEffort` config knob (`low`, `medium`, `high`, default `medium`) to the LLM judge in `loker-watcher`. The field is validated as an enum in `watcher.config.json`, threads from `loadWatcherConfig` through `judgePosts` into both `judgeBatch` and `judgePost` chat-completions payloads as a flat top-level `"reasoning_effort"` key, and is verified against the configured `LLM_ACCOUNTS` endpoints via `scripts/probe-judge.ts` before merge. Settled decision: flat payload shape, probe-decided; nested `"reasoning": {"effort": ...}` is the two-line fallback if a probe returns 400.

## Requirements

- Add `reasoningEffort` as an enum field (`["low","medium","high"]`) to `WatcherConfig` in `src/config-file.ts`
- Validate the field: absent → `"medium"` silently, case-insensitive normalization (`"HIGH"` → `"high"`), invalid → throw naming `reasoningEffort`
- Add `"reasoningEffort"` to `ALLOWED_KEYS` so the unknown-key gate accepts it
- Do not break existing configs: committed `watcher.config.json` lacks the field and must keep loading
- Thread `config.reasoningEffort` into `judgePosts` at `src/index.ts:94-97`
- Inject `"reasoning_effort": reasoningEffort` into both `judgeBatch` (`src/judge.ts:397-404`) and `judgePost` (`src/judge.ts:508-512`) payloads as a sibling to `temperature`
- Add `reasoningEffort` parameter to `judgePosts`/`judgeBatch`/`judgePost`, optional with `"medium"` default, as the trailing parameter after `fetchFn`
- Extend `scripts/probe-judge.ts:185-195` `bulkPayload` to carry `reasoning_effort`; run probe before merge
- Strict TypeScript flags stay on: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- Existing 16 `judgePosts` call sites in `tests/judge.test.ts` must not break
- `npm test`, `npm run typecheck`, `npm run lint` all pass

## Current State Analysis

What exists now:
- `WatcherConfig` interface at `src/config-file.ts:22-26` — declares `keywords`, `candidateTerms`, `surfaces`, `recencyHours`; no `reasoningEffort`
- `ALLOWED_KEYS` at `src/config-file.ts:32` — closed whitelist; unknown keys throw at `src/config-file.ts:71-76`
- `validateConfig` at `src/config-file.ts:65-85` — dispatches to typed readers; return object at `src/config-file.ts:84`
- `readRecencyHours` at `src/config-file.ts:154-159` — throw-on-invalid reader pattern; no default-on-absence
- `readSurfaces` at `src/config-file.ts:109-143` — enum validation pattern via strict `!==` checks
- `judgeBatch` payload at `src/judge.ts:397-416` — `model`, `messages`, `temperature`, `response_format` (bulk-only rider)
- `judgePost` payload at `src/judge.ts:508-521` — `model`, `messages`, `temperature` only
- `judgePosts` signature at `src/judge.ts:595-605` — `(candidates, accounts, keywords, fetchFn = fetch)`
- `src/index.ts:53` — `loadWatcherConfig()`; `:94-97` — passes `config.keywords` to `judgePosts`
- `scripts/probe-judge.ts:185-195` — `bulkPayload` extension point for testing endpoint acceptance
- Committed `watcher.config.json` lacks `reasoningEffort` and loads today

What's missing:
- The `reasoningEffort` field on `WatcherConfig` and `ALLOWED_KEYS`
- A `readReasoningEffort` reader function
- Wiring from `config.reasoningEffort` into `judgePosts`
- `"reasoning_effort"` in both judge payloads
- Probe payload extension and manual verification step

### Key Discoveries

- `ALLOWED_KEYS` unknown-key gate (`src/config-file.ts:71-76`) enforces a closed whitelist: any config key not registered there fails the run with `unknown key` (precedent commit `b050436`, validation doc showing `keyword` rename exits 1). Adding `reasoningEffort` to config *requires* adding it to `ALLOWED_KEYS`.
- `readRecencyHours` throws on absence (`undefined`) — no default-on-absence precedent exists for optional scalar fields; `readReasoningEffort` must special-case `undefined → "medium"`.
- Judge payloads are Chat Completions-style (`model`, `messages`, `temperature`): OpenAI's Chat Completions API uses flat top-level `reasoning_effort`; nested `reasoning: {effort}` is Responses API-only. Flat has stronger acceptance evidence.
- `tests/judge.test.ts` has 16 `judgePosts` call sites (`:382-722`) and 5 `judgePost` call sites (`:208-285`): adding `reasoningEffort` before `fetchFn` would break all 21; trailing position after `fetchFn` keeps them compiling untouched.
- `WatcherConfig` is constructed at exactly one site (`src/config-file.ts:84`); making `reasoningEffort` required breaks nothing.

### Patterns to follow

- `readRecencyHours`: `src/config-file.ts:154-159` — default/throw pattern reference
- `readSurfaces`: `src/config-file.ts:109-143` — enum validation pattern
- Optional parameter with default: `fetchFn: typeof fetch = fetch` on `judgePost` (`src/judge.ts:504`) and `judgePosts` (`src/judge.ts:595`)
- Type-only import precedent: `fetch-threads.ts:21` imports `ResolvedSurface` type-only

### Constraints to work within

- `exactOptionalPropertyTypes`: optional properties cannot be explicitly `undefined`; must be present-with-value or absent
- `noUncheckedIndexedAccess`: indexed access on `Record<string, unknown>` yields `T | undefined`
- `verbatimModuleSyntax`: relative imports use `.js` extensions; type-only imports use `type` modifier
- No new runtime dependency without a stated need

## Scope

### Building

- `reasoningEffort` enum validation (`low|medium|high`) in `loadWatcherConfig`
- `readReasoningEffort` reader: absent→`"medium"`, case-insensitive normalization, invalid throws naming `reasoningEffort`
- `"reasoningEffort"` in `ALLOWED_KEYS`
- Required `reasoningEffort` field on `WatcherConfig`
- Trailing `reasoningEffort: ReasoningEffort = "medium"` parameter on `judgePosts`, `judgeBatch`, `judgePost`
- Flat `"reasoning_effort": reasoningEffort` injection into both `judgeBatch` and `judgePost` payloads
- `fetch` explicit 4th arg + `config.reasoningEffort` 5th arg at `src/index.ts:94-97`
- `bulkPayload` extension in `scripts/probe-judge.ts:185-195` carrying `reasoning_effort`
- Tests: absent→`"medium"`, `"HIGH"`→`"high"`, `"extreme"`→throws naming `reasoningEffort`, non-string `123`→throws naming `reasoningEffort`, payload carries `reasoning_effort` on bulk and fallback paths
- README.md config-keys table row for `reasoningEffort`

### Not Building

- Per-account `reasoningEffort` overrides (developer confirmed global knob only)
- Nested `"reasoning": {"effort": ...}` payload shape unless the probe returns 400 (then a two-line change at the two injection points)
- Adding the `reasoningEffort` key to committed `watcher.config.json` (default `"medium"` applies; smaller diff wins)
- Automated probe assertion in `npm test` (probe needs `LLM_ACCOUNTS` + a live endpoint; manual success criterion only)

## Decisions

### Data model — required field, not optional

- Ambiguity: Should `reasoningEffort` be optional (`?`) on `WatcherConfig` or required?
- Explored: Optional field would need `?? "medium"` at every consumer (`src/index.ts:97`, `scripts/probe-judge.ts:185`) and contradicts that `validateConfig` always returns a value. Required field matches the four existing required fields; single construction site at `src/config-file.ts:84`.
- Tension: the module header comment (`src/config-file.ts:1-9`) warns that silent defaults let typos keep watching the wrong thing. Rationale: `reasoningEffort` is an optional tuning knob, not a correctness-critical input — an absent key is an unset knob, not a typo. The FRD requires the default.
- Decision: `reasoningEffort: "low" | "medium" | "high"` (required, no `?`) on `WatcherConfig` (`src/config-file.ts:22-26`). Export `type ReasoningEffort` from `src/config-file.ts`; import type-only in `src/judge.ts`.

### Reader behavior — absent→"medium", case-insensitive, invalid throws

- Ambiguity: How should `readReasoningEffort` handle absence, wrong case, and invalid values?
- Explored: Copy `readRecencyHours` (throws on non-number) would reject absence, contradicting "absent → `"medium"` silently". Normalize case per the FRD requirement. Invalid values throw naming `reasoningEffort` per the "fails loudly" contract.
- Decision: `readReasoningEffort(value, filePath)` — `undefined` → `"medium"`; string → `.toLowerCase()` validated against `["low","medium","high"]`, invalid throws `config: ${filePath} "reasoningEffort" ...` naming the key; non-string throws naming `reasoningEffort`.

### Payload shape — flat `reasoning_effort`, probe-decided

- Ambiguity: flat `"reasoning_effort"` vs nested `"reasoning": {"effort": ...}` vs config-only defer?
- Explored: judge payloads are Chat Completions-style (`src/judge.ts:397-404`, `src/judge.ts:508-512`); OpenAI Chat Completions uses flat `reasoning_effort`, nested is Responses API-only. Flat has materially stronger acceptance evidence. Config-only defer leaves the knob inert until a follow-up.
- Decision: flat `"reasoning_effort": reasoningEffort` injected into both payloads; probe-decided before merge; if probe returns 400, switch to nested at the two injection points (two-line change). Recorded as a decision, not an open question.

### Parameter position — trailing after `fetchFn`

- Ambiguity: Where does `reasoningEffort` go in each judge signature?
- Explored: Inserting before `fetchFn` breaks all 21 existing call sites (16 `judgePosts` at `tests/judge.test.ts:382-722`, 5 `judgePost` at `:208-285`) because `mockFetch` would land in the `reasoningEffort` slot. Trailing position after `fetchFn` keeps them compiling untouched; `src/index.ts:94-97` passes `fetch` explicitly as the 4th argument.
- Decision: `reasoningEffort: ReasoningEffort = "medium"` is the last parameter on `judgePosts` (`src/judge.ts:595`), `judgePost` (`src/judge.ts:508`), `judgeBatch` (`src/judge.ts:397`).

### Committed config — key stays absent

- Decision: `watcher.config.json` stays without the `reasoningEffort` key; default `"medium"` applies; README row documents it. Adding the key changes nothing at runtime (absent → `"medium"` → payload carries `reasoning_effort: "medium"` either way), so the smaller diff wins.

## Architecture

### src/config-file.ts — MODIFY

```ts
// WatcherConfig interface — add required field after recencyHours (src/config-file.ts:22-26)
  recencyHours: number;
  reasoningEffort: "low" | "medium" | "high";

// ALLOWED_KEYS — register the new key so the unknown-key gate accepts it (src/config-file.ts:32)
const ALLOWED_KEYS = ["keywords", "candidateTerms", "surfaces", "recencyHours", "reasoningEffort"] as const;

// validateConfig — wire reader into dispatch and return object (src/config-file.ts:65-85)
  const recencyHours = readRecencyHours(record.recencyHours, filePath);
  const reasoningEffort = readReasoningEffort(record.reasoningEffort, filePath);

  return { keywords, candidateTerms, surfaces, recencyHours, reasoningEffort };

// New reader — absent → "medium", case-insensitive, invalid throws naming reasoningEffort
export type ReasoningEffort = "low" | "medium" | "high";

function readReasoningEffort(value: unknown, filePath: string): "low" | "medium" | "high" {
  if (value === undefined) {
    return "medium";
  }
  if (typeof value !== "string") {
    throw new Error(
      `config: ${filePath} "reasoningEffort" must be one of "low", "medium", "high", got ${JSON.stringify(value)}`,
    );
  }
  const normalized = value.toLowerCase();
  if (normalized !== "low" && normalized !== "medium" && normalized !== "high") {
    throw new Error(
      `config: ${filePath} "reasoningEffort" must be one of "low", "medium", "high", got ${JSON.stringify(value)}`,
    );
  }
  return normalized;
}
```

### src/judge.ts — MODIFY

```ts
// src/judge.ts:27-29 — import block reordered for Biome organizeImports; ReasoningEffort imported type-only from Slice 1's src/config-file.ts
import type { ReasoningEffort } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import type { AccountFailure, JudgeVerdict, Post } from "./types.js";

// src/judge.ts:373-379 — judgeBatch gains trailing reasoningEffort parameter (last after batchIndex)
async function judgeBatch(
  batch: readonly Post[],
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch,
  batchIndex: number,
  reasoningEffort: ReasoningEffort = "medium",
): Promise<BatchOutcome> {

// src/judge.ts:397-408 — bulk payload gains flat reasoning_effort sibling to temperature; original comment restored verbatim
    const payload = {
      model: account.model,
      messages,
      temperature: 0,
      reasoning_effort: reasoningEffort,
      // Rider on the bulk path ONLY: the single-post fallback call keeps its
      // original payload shape (design scope boundary).
      response_format: { type: "json_object" },
    };

// src/judge.ts:494-500 — judgePost gains trailing reasoningEffort parameter
export async function judgePost(
  post: Post,
  state: RotationState,
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
): Promise<JudgeVerdict | null> {

// src/judge.ts:508-513 — single-post payload gains flat reasoning_effort sibling to temperature
    const payload = {
      model: account.model,
      messages,
      temperature: 0,
      reasoning_effort: reasoningEffort,
    };

// src/judge.ts:595-601 — judgePosts gains trailing reasoningEffort parameter
export async function judgePosts(
  candidates: readonly Post[],
  accounts: readonly LlmAccount[],
  keywords: readonly string[],
  fetchFn: typeof fetch = fetch,
  reasoningEffort: ReasoningEffort = "medium",
): Promise<JudgeBatchResult> {

// src/judge.ts:620 — judgeBatch internal call site forwards reasoningEffort
      outcomes[index] = await judgeBatch(batch, state, keywords, fetchFn, index, reasoningEffort);

// src/judge.ts:650 — judgePost internal call site forwards reasoningEffort; split per Biome 1.9.4 (single line was 101 chars > lineWidth 100)
      const verdict =
        fromBulk ?? (await judgePost(post, state, keywords, fetchFn, reasoningEffort));
```

### src/index.ts — MODIFY

```ts
  const { judged, skippedPostIds } = await judgePosts(
    newPosts,
    resolveJudgeConfig(process.env),
    config.keywords,
    fetch,
    config.reasoningEffort,
  );
```

### scripts/probe-judge.ts — MODIFY

```ts
  const bulkPayload = {
    model: account.model,
    messages: bulkMessages(ten),
    temperature: 0,
    reasoning_effort: CONFIG.reasoningEffort,
    response_format: { type: "json_object" },
  };
```

### tests/config-file.test.ts — MODIFY

```ts
// Add after the recencyHours failure case (before "allows an empty candidateTerms array")
  it("defaults reasoningEffort to \"medium\" when absent", async () => {
    const path = await writeConfig({ ...VALID });
    const config = await loadWatcherConfig(path);
    assert.equal(config.reasoningEffort, "medium");
  });

  it("normalizes reasoningEffort case-insensitively", async () => {
    const path = await writeConfig({ ...VALID, reasoningEffort: "HIGH" });
    const config = await loadWatcherConfig(path);
    assert.equal(config.reasoningEffort, "high");
  });

  it("rejects an invalid reasoningEffort value", async () => {
    const path = await writeConfig({ ...VALID, reasoningEffort: "extreme" });
    await assert.rejects(() => loadWatcherConfig(path), /reasoningEffort/);
  });

  it("rejects a non-string reasoningEffort value", async () => {
    const path = await writeConfig({ ...VALID, reasoningEffort: 123 });
    await assert.rejects(() => loadWatcherConfig(path), /reasoningEffort/);
  });
```

### tests/judge.test.ts — MODIFY

```ts
// tests/judge.test.ts:753+ — appended payload assertion suites; existing helpers reused; noUncheckedIndexedAccess-safe (no bare posts[0])
describe("judgePost payload carries reasoning_effort", () => {
  it('defaults to "medium" in the single-post payload', async () => {
    let sentBody: unknown;
    const mockFetch = async (_url: unknown, options?: unknown): Promise<Response> => {
      sentBody = JSON.parse((options as { body: string }).body);
      return ok('{"relevant": true, "locationOk": true}');
    };

    await judgePost(
      bulkPost(id19(1)),
      freshState(singleAccount),
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal((sentBody as { reasoning_effort?: string }).reasoning_effort, "medium");
  });

  it('sends an explicit reasoning_effort in the single-post payload', async () => {
    let sentBody: unknown;
    const mockFetch = async (_url: unknown, options?: unknown): Promise<Response> => {
      sentBody = JSON.parse((options as { body: string }).body);
      return ok('{"relevant": true, "locationOk": true}');
    };

    await judgePost(
      bulkPost(id19(1)),
      freshState(singleAccount),
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      "high",
    );
    assert.equal((sentBody as { reasoning_effort?: string }).reasoning_effort, "high");
  });
});

describe("judgePosts payload carries reasoning_effort", () => {
  it('defaults to "medium" in the bulk payload', async () => {
    const id = id19(1);
    const posts = [bulkPost(id)];
    let sentBody: unknown;
    const mockFetch = async (_url: unknown, options?: unknown): Promise<Response> => {
      sentBody = JSON.parse((options as { body: string }).body);
      return ok(bulkContent([id]));
    };

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(result.judged.length, 1);
    assert.equal((sentBody as { reasoning_effort?: string }).reasoning_effort, "medium");
  });

  it('sends an explicit reasoning_effort in the bulk payload', async () => {
    const id = id19(1);
    const posts = [bulkPost(id)];
    let sentBody: unknown;
    const mockFetch = async (_url: unknown, options?: unknown): Promise<Response> => {
      sentBody = JSON.parse((options as { body: string }).body);
      return ok(bulkContent([id]));
    };

    const result = await judgePosts(
      posts,
      singleAccount,
      KEYWORDS,
      mockFetch as unknown as typeof fetch,
      "low",
    );
    assert.equal(result.judged.length, 1);
    assert.equal((sentBody as { reasoning_effort?: string }).reasoning_effort, "low");
  });
});
```

### README.md — MODIFY

```md
| `reasoningEffort` | The LLM judge's reasoning effort level: `"low"`, `"medium"` (default), or `"high"`. Absent defaults to `"medium"`. |
```

## Slices

### Slice 1: Config knob + docs + tests

**Files**: `src/config-file.ts`, `tests/config-file.test.ts`, `README.md`

#### Automated Verification:
- [ ] Config-file tests pass: `npm test -- tests/config-file.test.ts`
- [ ] Absent `reasoningEffort` → config loads, field defaults to `"medium"`
- [ ] `"HIGH"` → normalized to `"high"`
- [ ] `"extreme"` → throws error naming `reasoningEffort`
- [ ] Non-string `123` → throws error naming `reasoningEffort`

#### Manual Verification:
- [ ] Committed `watcher.config.json` (no `reasoningEffort` key) still loads with default `"medium"`
- [ ] `readReasoningEffort` follows `readRecencyHours`/`readSurfaces` pattern: throws with `config: ${filePath} "reasoningEffort"` prefix on invalid input

### Slice 2: Judge injection + tests

**Files**: `src/judge.ts`, `tests/judge.test.ts`

#### Automated Verification:
- [ ] `npm test -- tests/judge.test.ts` — existing judge tests pass; new `reasoning_effort` payload cases pass
- [ ] `npm run typecheck` — no type errors over `src/`, `tests/`, `scripts/`
- [ ] Bulk payload default: `reasoning_effort: "medium"` present in `judgeBatch` body
- [ ] Bulk payload explicit: `reasoning_effort: "low"` flows through unchanged
- [ ] Fallback payload default: `reasoning_effort: "medium"` present in `judgePost` body
- [ ] Fallback payload explicit: `reasoning_effort: "high"` flows through unchanged
- [ ] `grep -n "reasoning_effort" src/judge.ts` returns exactly 2 matches (bulk + single injection)
- [ ] Existing 4-arg call sites of `judgePosts`/`judgePost` still compile untouched

#### Manual Verification:
- [ ] `npm run lint` — Biome passes over `src/judge.ts` and `tests/judge.test.ts`
- [ ] `reasoning_effort` is flat top-level, sibling to `temperature`, in both payloads

### Slice 3: Wiring + probe + baseline

**Files**: `src/index.ts`, `scripts/probe-judge.ts`

#### Automated Verification:
- [ ] npm run typecheck passes over src/, tests/, scripts/ (terminal-slice baseline)
- [ ] npm test passes (terminal-slice baseline)
- [ ] npm run lint passes over src/, tests/, scripts/probe-judge.ts (terminal-slice baseline)
- [ ] src/index.ts calls judgePosts(newPosts, resolveJudgeConfig(process.env), config.keywords, fetch, config.reasoningEffort) — fetch is the 4th arg, config.reasoningEffort is the 5th
- [ ] scripts/probe-judge.ts bulkPayload includes reasoning_effort: CONFIG.reasoningEffort as a sibling to temperature
- [ ] grep -n "reasoning_effort" scripts/probe-judge.ts returns exactly 1 match
- [ ] grep -n "config.reasoningEffort" src/index.ts returns exactly 1 match

#### Manual Verification:
- [ ] Committed watcher.config.json (no reasoningEffort key) still loads — probe's loadWatcherConfig() succeeds, defaults to "medium", and the probe bulk payload carries reasoning_effort: "medium"
- [ ] Probe run with LLM_ACCOUNTS set: bulk call returns 2xx + JSON; a 400 means the endpoint rejected reasoning_effort → switch to nested "reasoning": {"effort": ...} at src/judge.ts:397-404 and src/judge.ts:508-512 (two-line change, Slice 2 injection points)

## Desired End State

```ts
// watcher.config.json — operator adds the knob when they want non-default effort:
// "reasoningEffort": "high"

// src/config-file.ts — validated, required, defaults to "medium" when absent
const cfg = await loadWatcherConfig();
// cfg.reasoningEffort is "low" | "medium" | "high", always present

// src/judge.ts — both payloads carry the effort
// bulk:  { model, messages, temperature: 0, reasoning_effort: "high", response_format: {...} }
// single: { model, messages, temperature: 0, reasoning_effort: "high" }
```

## File Map

- `src/config-file.ts`  # MODIFY — `reasoningEffort` field, `ALLOWED_KEYS` entry, `readReasoningEffort` reader, `validateConfig` wiring
- `src/judge.ts`  # MODIFY — trailing `reasoningEffort` param on `judgePosts`/`judgeBatch`/`judgePost`, `"reasoning_effort"` injected into both payloads
- `src/index.ts`  # MODIFY — pass `fetch` (4th) and `config.reasoningEffort` (5th) to `judgePosts`
- `scripts/probe-judge.ts`  # MODIFY — `bulkPayload` gains `reasoning_effort: CONFIG.reasoningEffort`
- `tests/config-file.test.ts`  # MODIFY — 4 cases: absent→`"medium"`, `"HIGH"`→`"high"`, `"extreme"`→throws, non-string `123`→throws
- `tests/judge.test.ts`  # MODIFY — payload assertions: `reasoning_effort` on bulk and fallback paths
- `README.md`  # MODIFY — config-keys table row for `reasoningEffort`

## Ordering Constraints

- Slice 1 → Slice 2 → Slice 3 (sequential). Slice 2 imports `ReasoningEffort` type from `src/config-file.ts`; Slice 3 passes `config.reasoningEffort` which only exists after Slice 1.
- No slice can run in parallel — each builds on the previous slice's symbols.
- Foundation (types + validation) is Slice 1; judge payload injection is Slice 2; production wiring + probe is Slice 3.

## Verification Notes

- `npm run typecheck` — no type errors across `src/`, `tests/`, `scripts/`
- `npm run lint` — Biome passes over `src/` and `tests/`
- `npm test` — all existing tests pass; new config-file and judge test cases pass
- Committed `watcher.config.json` (without `reasoningEffort`) still loads with default `"medium"` — `loadWatcherConfig("watcher.config.json")` succeeds
- Grep: `reasoning_effort` appears exactly twice in `src/judge.ts` (bulk + single payload injection points)
- Probe: run `scripts/probe-judge.ts` with `LLM_ACCOUNTS` set; bulk call must return 2xx + JSON. A 400 means the endpoint rejected the field → switch to nested `"reasoning": {"effort": ...}` at `src/judge.ts:397-404` and `src/judge.ts:508-512`.
- Type-only import `import type { ReasoningEffort }` in `src/judge.ts` is erased under `verbatimModuleSyntax`; no runtime edge to `config-file.ts`.

## Performance Considerations

- Negligible: one extra top-level string field in two JSON payloads; no new network calls, no change to batch size or concurrency (`JUDGE_CONCURRENCY = 4` unchanged).
- Silent default cost: absent `reasoningEffort` → `"medium"` changes cost/latency on honoring endpoints with no user-visible signal (documented trade-off accepted by the FRD).

## Migration Notes

- Not applicable — no schema changes, no persisted state migration. Backwards compatible: committed config without the key loads with default `"medium"`; existing test call sites compile untouched via trailing optional parameter with default. Rollback is symmetric: remove the interface field, `ALLOWED_KEYS` entry, reader function, judge parameter, payload field, and tests; no orphaned state.

## Pattern References

- `src/config-file.ts:154-159` — `readRecencyHours` default/throw reader pattern
- `src/config-file.ts:109-143` — `readSurfaces` enum validation pattern
- `src/config-file.ts:71-76` — `ALLOWED_KEYS` unknown-key gate
- `src/config-file.ts:84` — `validateConfig` return object (single `WatcherConfig` construction site)
- `src/judge.ts:504`, `src/judge.ts:595` — `fetchFn` default-parameter pattern (trailing optional param)
- `fetch-threads.ts:21` — type-only import precedent (`import type { ResolvedSurface }`)
- `.rpiv/artifacts/solutions/2026-10-27_10-12-53_reasoning-effort-llm-judge.md` — solution analysis with Option 1 (flat, probe-gated) selected

## Developer Context

- Q: Payload shape — flat `reasoning_effort` vs nested `reasoning: {effort}` vs config-only defer? Evidence: judge payloads are Chat Completions-style at `src/judge.ts:397-404` and `src/judge.ts:508-512`; OpenAI Chat Completions uses flat `reasoning_effort`, nested is Responses API-only. Decision: flat, probe-decided before merge; nested is the two-line fallback on probe 400. (Checkpoint: `/skill:design` Step 4, payload-shape question, answered "Flat `reasoning_effort` (Recommended)")
- Q: Interface field required vs optional? Evidence: `WatcherConfig` constructed at exactly one site `src/config-file.ts:84`; all consumers only read fields. Advisor: required field, no `?? "medium"` at consumers; matches four existing required fields. Decision: required `reasoningEffort: "low" | "medium" | "high"`.
- Q: Parameter position in judge signatures? Evidence: 16 `judgePosts` call sites `tests/judge.test.ts:382-722`, 5 `judgePost` `:208-285` pass `mockFetch` as 4th arg. Advisor: `reasoningEffort` must be LAST after `fetchFn`; `src/index.ts:94-97` passes `fetch` explicitly as 4th. Decision: trailing `reasoningEffort: ReasoningEffort = "medium"` on all three functions.
- Q: Committed config key absent or present? Decision: absent; default `"medium"` applies; smaller diff wins. README row documents it.
- Slice 3 micro-checkpoint: slice-verifier OK (Decisions/Cross-slice/Research all OK). Developer requested advisor double-check: verdict "code correct — approve"; lint-scope flag resolved against `package.json` (`npm run lint` = `biome check src tests scripts/probe-judge.ts` — `scripts/probe-judge.ts` is covered). Approved.

## Design History

- Slice 1: Config knob + docs + tests — approved as generated
- Slice 2: Judge injection + tests — approved as generated
- Slice 3: Wiring + probe + baseline — approved as generated

## References

- `.rpiv/artifacts/solutions/2026-10-27_10-12-53_reasoning-effort-llm-judge.md` — research question, solution options, recommendation (Option 1: full feature, flat `reasoning_effort`, probe-gated)
- `.rpiv/artifacts/research/2026-10-27_09-43-34_reasoning-effort-llm-judge.md` — FRD and detailed findings
- `src/config-file.ts:25-159` — config validation precedent (readRecencyHours, readSurfaces, ALLOWED_KEYS)
- `scripts/probe-judge.ts:185-195` — probe harness for endpoint acceptance testing
- Commit `b050436` — "feat: json config as source of truth with url surfaces"; `ALLOWED_KEYS` whitelist precedent
- Commit `e316cb5` — "feat: judge posts against configured keywords in bulk"; judge payload precedent
- Commit `fda50c2` — "fix: defer unanswered judge batches, raise the request timeout"; probe-before-merge lesson
