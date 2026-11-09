---
date: 2026-11-09T11:29:20+0700
author: Yogiswara Utama
commit: a1dc2b3
branch: main
repository: loker-watcher
topic: "negative keywords for the judge"
confidence: high
complexity: low
status: ready
verdict: pass
tags: [solutions, judge, config-file, prompt-builders]
last_updated: 2026-11-09T11:29:20+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Negative keywords for the judge

**Date**: 2026-11-09T11:29:20+0700
**Author**: Yogiswara Utama
**Commit**: a1dc2b3
**Branch**: main
**Repository**: loker-watcher

## Research Question
Chained from the discover FRD (`.rpiv/artifacts/discover/2026-11-09_10-45-16_negative-keywords.md`) and the research doc (`.rpiv/artifacts/research/2026-11-09_11-04-26_negative-keywords-judge-seam.md`): which of four candidate shapes should carry the `negativeKeywords` veto, and what does each cost against the existing judge seam?

## Summary
**Problem**: positive keywords alone cannot express what the operator wants — adding more keywords made matches worse, not better. A post that matches a keyword AND a negative term must be vetoed.
**Recommended**: Option 1 — Prompt-side veto: one shared private system-message helper, veto sentence appended only when the list is non-empty
**Effort**: Low (~0.5 day)
**Confidence**: High

## Problem Statement

**Requirements:**
- R1: a new optional `negativeKeywords` string array in `watcher.config.json`, validated like `candidateTerms` (`[]` valid, absent resolves to `[]`)
- R2: when a post matches a keyword AND a negative term, the judge must return `relevant: false` (hard veto)
- R3: the veto sentence binds to the keyword criterion (it references "a keyword above")
- R4: with the key absent or `[]`, the judge prompt must stay byte-identical to today's text
- R5: offline tests pin the validator matrix, the byte-identity, and the veto behavior
- R6: the probe (`scripts/probe-judge.ts`) stays untouched; committed ceilings keep describing the positive-only prompt

**Constraints:**
- Hard: blast radius is the judge only — no client-side relevance filter, no heartbeat change (discover decision)
- Hard: `judgePosts` takes 10 positional parameters; tests call it positionally, so a new parameter can ONLY tail-append
- Hard: judge internals stay module-private (commit `ced76f8`); `buildBulkMessages` stays exported for the probe
- Soft: the duplicated system-message text at `src/judge.ts:236` and `:263` should collapse into one helper before the first real prompt edit lands

**Success criteria:**
- `watcher.config.json` with `"negativeKeywords": ["internship", "outsourcing"]` produces a digest that excludes posts matching those terms
- The same config with the key removed produces byte-identical prompts and identical behavior to today
- `npm run typecheck && npm run lint && npm test` green

## Current State

**Existing implementation:**
- `src/config-file.ts:53-61` — `ALLOWED_KEYS` closed const array; every unregistered key fails the whole file (`:101-105`)
- `src/config-file.ts:108-109` — `keywords` (non-empty required) and `candidateTerms` (`[]` allowed) both read through `readStringArray`
- `src/config-file.ts:127-147` — `readStringArray`: array check, per-item non-empty string check, optional `requireNonEmpty`
- `src/config-file.ts:239-255` / `:265-275` — `readReasoningEffort` / `readScrollRounds`: the optional-key template (undefined → default, wrong shape → throw naming path + key)
- `src/judge.ts:229-243` — `buildMessages` (single-post, private); system message literal at `:236`
- `src/judge.ts:253-270` — `buildBulkMessages` (bulk, exported for the probe); system message literal at `:263`, byte-identical duplicate of `:236`
- `src/judge.ts:682` — `judgeBatch` builds messages once outside the retry loop
- `src/judge.ts:779` — `judgePost` builder call
- `src/judge.ts:876-887` — `judgePosts` with 10 positional parameters
- `src/judge.ts:691` / `:788` — `temperature: 0` on both the bulk and single-post payloads
- `src/judge.ts:693-695` / `:790` — `response_format` is a rider on the bulk path ONLY
- `src/judge.ts:122` — `WAIT_BUDGET_MS = 180_000`, one shared park budget
- `src/index.ts:445-448` — the sole production `judgePosts` call; `config.keywords` at `:448`
- `src/index.ts:465-467` — `.filter((j) => j.verdict.relevant && j.verdict.locationOk)` then `stats.relevantLocated`
- `src/index.ts:212` — `WatcherRun` shape
- `src/heartbeat.ts:30` — `HeartbeatStats` shape
- `src/heartbeat.ts:64-67` — `matchesCandidateTerms`, the client-side candidateTerms matcher (heartbeat near-miss selection only)
- `src/types.ts:26` — `JudgeVerdict` = `{relevant, locationOk}` (`src/types.ts` holds only `Post`, `JudgeVerdict`, `AccountFailure`)
- `src/judge-parse.ts:16` — `parseVerdict`: strict two-field check, returns exactly `{relevant, locationOk}`
- `src/judge-parse.ts:51` — `readVerdict`: same strict two-field check for bulk items
- `src/judge-parse.ts:72` — `parseBulkVerdicts`: total, never throws, malformed items dropped
- `src/judge-rotation.ts:129` / `:145` / `:165` — `RotationExhausted` type, factory, guard
- `scripts/probe-judge.ts:247` — `buildBulkMessages(ten, CONFIG.keywords)`, the zero-edit probe call

**Relevant patterns:**
- Optional judge knob end-to-end: `src/config-file.ts:239` - templated by commit `d8fc15b` (reasoningEffort), 3 files, no follow-up fixes
- Closed-key config addition: `src/config-file.ts:53` - used by `d8fc15b`, `68c1e2d`, `de0ad53` (every new key = ALLOWED_KEYS + validator + test matrix)
- Tail-append parameter discipline: `src/judge.ts:881-886` - `reasoningEffort`, `ceilings`, `now`, `sleepFn`, `healthMarks`, `blocked` all appended in order
- Module-private internals: `src/judge.ts:229` - commit `ced76f8` unexported four symbols deliberately
- Prompt payload pin by discriminating token: `tests/judge.test.ts:317` - asserts `next.js` appears in the captured request body
- System-prompt content pin: `tests/judge.test.ts:677-684` - `buildBulkMessages` called directly, `assert.match` on the system content
- Config rejection matrix: `tests/config-file.test.ts:68` - `writeConfig({ ...VALID, key: bad })` + `assert.rejects` regex (49 such hits in the file)

**Integration points:**
- `src/config-file.ts:53` - `ALLOWED_KEYS` gains `"negativeKeywords"`
- `src/config-file.ts:114` - `readNegativeKeywords` call site, after `readScrollRounds`
- `src/config-file.ts:50` - `WatcherConfig` interface gains `negativeKeywords: string[]`
- `src/judge.ts:236` + `:263` - both literals replaced by one `systemMessage(keywords, negativeKeywords)` helper
- `src/judge.ts:229` / `:253` - both builders gain an optional third parameter
- `src/judge.ts:677` / `:775` / `:886` - `judgeBatch`, `judgePost`, `judgePosts` tail-append the parameter
- `src/index.ts:448` - the one production pass-through gains `config.negativeKeywords`
- `tests/config-file.test.ts` - validator matrix
- `tests/judge.test.ts` - byte-identity + veto pins

## Solution Options

### Option 1: Prompt-side veto
**How it works:**
The judge's system message gains a veto sentence naming the serialized negative list, appended only when the list is non-empty. The duplicated system text at `src/judge.ts:236` and `:263` lifts into one private `systemMessage(keywords, negativeKeywords)` helper both builders call, so the veto sentence exists in exactly one place. A vetoed post is an ordinary `relevant: false` — marked seen, absent from the digest, no verdict-shape change.

**Pros:**
- Blast radius is exactly the discover decision (judge only): `src/judge-parse.ts`, `src/state.ts`, `src/email.ts`, `src/heartbeat.ts`, `src/types.ts`, and every workflow stay untouched
- Byte-identity by construction: the helper returns the current literal when `negativeKeywords.length === 0`, and one `assert.equal` pins it
- The probe stays a zero-edit consumer (`scripts/probe-judge.ts:247`) because the third builder parameter is optional with a none default
- Templated end-to-end by `d8fc15b` (reasoningEffort): same config→judge path, same tail-append discipline, no follow-up fixes in that commit
- The shared helper removes the drift risk before the first real prompt edit lands — the duplication survived only because nobody edited the prompt since `e316cb5`

**Cons:**
- Veto strength depends on model compliance; a weak model can ignore the sentence. Mitigation: `temperature: 0` on both payloads (`src/judge.ts:691`, `:788`) and a vetoed post is simply `relevant: false`, so a miss degrades to today's behavior rather than failing
- The single-post fallback carries no `response_format` rider (`src/judge.ts:790`), so on that path the veto rides the prompt alone
- The veto is invisible to the heartbeat: `matchesCandidateTerms` (`src/heartbeat.ts:64-67`) can still list a post the judge would veto (accepted by the discover blast-radius decision)

**Complexity:** Low (~0.5 day)
- Files to create: 0
- Files to modify: 3 (~70 lines: `src/config-file.ts` ~20, `src/judge.ts` ~25, `src/index.ts` 1) + 2 test files (~90 lines)
- Risk level: Low

### Option 2: Client-side filter
**How it works:**
A new pure funnel stage matches post text against the negative terms (the `matchesCandidateTerms` idiom at `src/heartbeat.ts:64-67`) before the judge; matched posts are marked seen and never reach the LLM.

**Pros:**
- Deterministic — no model compliance risk
- Saves LLM calls on vetoed posts
- The matching idiom already exists and is tested (`src/heartbeat.ts:64`)

**Cons:**
- Contradicts the discover "judge only" blast-radius decision: relevance would have two deciders
- No precedent: the five similar past changes in the research sweep are all config-key or judge-parameter work, none a new pipeline stage
- Requires a new stage per the architecture guidance: `HeartbeatStats` (`src/heartbeat.ts:30`) and `WatcherRun` (`src/index.ts:212`) shape changes, a gate-semantics decision (Gate 1 vs Gate 2 — both pinned at `tests/index.test.ts:339` and `:392`), `timeStage` wiring, and a new `tests/<stage>.test.ts`
- `WatcherRun` is deep-equal-pinned at 11 sites in `tests/index.test.ts` (`:358`, `:385`, `:415`, `:437`, `:462`, `:543`, `:591`, `:623`, `:658`, `:689`, `:713`) — every one gains a field
- Vetoed posts get marked seen without ever being judged — no audit trail of what the judge would have said
- Substring matching is brittle: `matchesCandidateTerms` (`src/heartbeat.ts:66`) is a plain `includes`, so "internship" hits inside a longer word; the prompt-side veto lets the model judge context

**Complexity:** Medium (~1.5 days)
- Files to create: 1 (~40 lines) + 1 test file (~80 lines)
- Files to modify: 4 (`src/index.ts` funnel + stats, `src/heartbeat.ts`, `tests/index.test.ts`, `src/config-file.ts`)
- Risk level: Medium

### Option 3: Structured verdict
**How it works:**
`JudgeVerdict` (`src/types.ts:26`) gains a `matchedTerms` field; the prompt asks the model to echo which negative terms hit, and the client applies the veto deterministically from the parsed field.

**Pros:**
- Deterministic veto once parsed
- The matched terms are auditable in logs

**Cons:**
- Touches both parsers: `parseVerdict` (`src/judge-parse.ts:16`) and `readVerdict` (`:51`) are strict two-field builders that return exactly `{relevant, locationOk}` — both must change
- `JudgeVerdict` has been stable since `e316cb5`; no precedent for extending it
- Verdict deep-equals break in two suites: 6 in `tests/judge-parse.test.ts` (`:13`, `:18`, `:23`, `:40`, `:52`, `:65`) plus the verdict-shape ones in `tests/judge.test.ts` (`:218`, `:732`)
- Introduces a new parse failure mode: a well-formed veto whose `matchedTerms` array is malformed becomes a parse miss, and the parse-miss path falls back to a single-post call (pinned at `tests/judge.test.ts:312`)
- The veto still lands client-side, so it inherits Option 2's two-deciders problem

**Complexity:** Medium (~1.5 days)
- Files to create: 0
- Files to modify: 4 (`src/judge-parse.ts`, `src/types.ts`, `src/judge.ts`, `src/index.ts`) + 2 test files
- Risk level: Medium

### Option 4: Second judge pass
**How it works:**
A separate negatives-only LLM call per batch (or per post) runs after the positive judge; its verdict gates the digest.

**Pros:**
- Clean separation of the two criteria

**Cons:**
- Doubles LLM cost and latency on every run with negatives configured
- `state/judge-ceilings.json` describes the positive-only prompt only, so the new call would run unmeasured against the measured-evidence convention
- The probe (`scripts/probe-judge.ts:247`) measures `buildBulkMessages` only; a second prompt shape would need its own probe or would fly blind
- `WAIT_BUDGET_MS = 180_000` (`src/judge.ts:122`) is one shared park budget; two dispatch surfaces would contend for it
- Exhaustion semantics (`RotationExhausted` at `src/judge-rotation.ts:129`, carrying `.health` for the flush) would need re-reasoning for the second path

**Complexity:** High (~3 days)
- Files to create: 1 (~120 lines) + 1 test file (~150 lines)
- Files to modify: 5+ (`src/index.ts`, `src/judge.ts`, `scripts/probe-judge.ts`, the `state/judge-ceilings.json` contract, `tests/`)
- Risk level: High

## Comparison

| Criteria | Option 1 | Option 2 | Option 3 | Option 4 |
|----------|----------|----------|----------|----------|
| Complexity | Low | Medium | Medium | High |
| Codebase fit | High | Low | Low | Low |
| Risk | Low | Medium | Medium | High |
| Blast radius | judge only | new funnel stage | parsers + client | second dispatch surface |
| Probe impact | zero-edit | none | none | breaks the ceilings contract |
| Byte-identity when absent | by construction | n/a (no prompt change) | n/a | n/a |

### Candidate × dimension grid

| Dimension | Option 1 | Option 2 | Option 3 | Option 4 |
|-----------|----------|----------|----------|----------|
| approach-shape | veto sentence in one shared private helper; both builders call it | new pure funnel stage before the judge | `matchedTerms` field on `JudgeVerdict`, client applies veto | second negatives-only LLM dispatch surface |
| precedent-fit | `d8fc15b` templated the exact config→judge path, zero follow-ups; tail-append at `src/judge.ts:881-886` | none — no funnel stage precedent; `matchesCandidateTerms` (`src/heartbeat.ts:64`) is heartbeat-only | none — `JudgeVerdict` stable since `e316cb5`; both parsers strict two-field (`src/judge-parse.ts:16`, `:51`) | none — one dispatch surface exists; `WAIT_BUDGET_MS` (`src/judge.ts:122`) is single |
| integration-risk | LOW — 3 src files + 2 test files; `judge-parse`/`state`/`email`/`types`/`heartbeat` untouched; probe zero-edit (`scripts/probe-judge.ts:247`) | HIGH — `HeartbeatStats` (`src/heartbeat.ts:30`) + `WatcherRun` (`src/index.ts:212`) shapes change; 11 `WatcherRun` deepEquals in `tests/index.test.ts`; gate semantics re-decided | HIGH — both parsers change; 6 verdict deepEquals in `tests/judge-parse.test.ts` + `:218`/`:732` in `tests/judge.test.ts`; new parse-miss mode | HIGH — `state/judge-ceilings.json` contract, `RotationExhausted` (`src/judge-rotation.ts:129`), shared wait budget |
| migration-cost | LOW — no incumbent to remove; ~70 src + ~90 test lines | MEDIUM — 1 new file + 4 modified + 1 new test file | MEDIUM — 4 modified + 2 test files | HIGH — 1 new file (~120 lines) + 5+ modified |
| verification-cost | LOW — existing idioms cover it: `tests/config-file.test.ts` matrix (49 hits), `tests/judge.test.ts:317` payload pin, `:677` builder pin; byte-identity = one `assert.equal` | MEDIUM-HIGH — new `tests/<stage>.test.ts` per the 1:1 mirror rule + 11 `WatcherRun` deepEqual updates | MEDIUM-HIGH — 8 verdict deepEquals across two suites + new parse-miss pins | HIGH — a new suite mirroring judge.test.ts's rotation/health/exhaustion coverage |

## Recommendation

**Selected:** Option 1

**Rationale:**
- It is the only candidate whose blast radius matches the discover decision (judge only): `src/judge-parse.ts`, `src/state.ts`, `src/email.ts`, `src/heartbeat.ts`, `src/types.ts`, and every workflow file stay untouched
- Byte-identity is an acceptance criterion (R4) and Option 1 satisfies it by construction — the helper returns the current literal when the list is empty, pinned by one `assert.equal`
- The probe stays a zero-edit consumer (`scripts/probe-judge.ts:247`) because the new builder parameter is optional with a none default; `state/judge-ceilings.json` keeps describing the positive-only prompt
- Commit `d8fc15b` templated this exact config→judge path with zero follow-up fixes; the tail-append discipline at `src/judge.ts:881-886` is already established
- The shared helper is a prerequisite, not a nice-to-have: the system text is duplicated byte-for-byte at `src/judge.ts:236` and `:263`, and the first real prompt edit would otherwise have to be made twice
- Every alternative fails on integration-risk with counted evidence: Option 2 changes two shapes and 11 `WatcherRun` deepEquals, Option 3 changes both parsers and 8 verdict deepEquals, Option 4 breaks the ceilings contract and contends for the shared wait budget

**Why not alternatives:**
- Option 2: contradicts the judge-only blast-radius decision; no precedent for a new funnel stage; `HeartbeatStats` (`src/heartbeat.ts:30`) and `WatcherRun` (`src/index.ts:212`) both change shape with 11 deep-equal pins to update; substring matching (`src/heartbeat.ts:66`) is more brittle than a context-aware veto
- Option 3: churns the stable verdict shape and both strict parsers (`src/judge-parse.ts:16`, `:51`), breaks 8 verdict deepEquals across two suites, adds a parse-miss failure mode, and still lands the veto client-side
- Option 4: doubles cost and latency, breaks the probe/ceilings contract, contends for the single `WAIT_BUDGET_MS` (`src/judge.ts:122`), and needs exhaustion semantics re-reasoned for a second dispatch surface

**Trade-offs:**
- Accepting model-compliance dependence for a judge-only blast radius and zero probe impact
- Accepting that the heartbeat can still list a post the judge would veto (`src/heartbeat.ts:64-67` stays client-side)
- Accepting that the single-post fallback has no `response_format` rider (`src/judge.ts:790`), so the veto rides the prompt alone there

**Implementation approach:**
1. Config: add `"negativeKeywords"` to `ALLOWED_KEYS` (`src/config-file.ts:53-61`), `negativeKeywords: string[]` to `WatcherConfig` (`:50`), a `readNegativeKeywords` validator mirroring `readReasoningEffort` (`:239-255`) delegating to `readStringArray(value, "negativeKeywords", filePath, false)`, and the call at `:114`
2. Prompt: lift the duplicated system text into one private `systemMessage(keywords, negativeKeywords)` helper; append the veto sentence plus `JSON.stringify(negativeKeywords)` only when the list is non-empty; both builders (`src/judge.ts:229`, `:253`) gain an optional third parameter and call the helper
3. Threading: tail-append `negativeKeywords: readonly string[] = []` to `judgeBatch` (`:677`), `judgePost` (`:775`), and `judgePosts` (`:886`); pass `config.negativeKeywords` as the 11th argument at `src/index.ts:448`
4. Tests: validator matrix in `tests/config-file.test.ts`; byte-identity + veto pins in `tests/judge.test.ts`; a judge scenario where the mock fetch reads the veto list from the request body and answers `relevant: false`
5. Gates: `npm run typecheck && npm run lint && npm test`

**Integration points:**
- `src/config-file.ts:53` - `ALLOWED_KEYS` gains the key (forgetting it fails every valid config)
- `src/config-file.ts:114` - the `readNegativeKeywords` call, after `readScrollRounds`
- `src/judge.ts:236` - literal #1 replaced by the helper call
- `src/judge.ts:263` - literal #2 replaced by the helper call
- `src/judge.ts:886` - `judgePosts` parameter 11
- `src/index.ts:448` - the one production pass-through
- `scripts/probe-judge.ts:247` - stays untouched (optional parameter)

**Patterns to follow:**
- Optional-key validator: `src/config-file.ts:239-255` (`readReasoningEffort`)
- Closed-key addition: `src/config-file.ts:53-61` (`ALLOWED_KEYS`)
- Tail-append parameter: `src/judge.ts:881-886`
- Prompt payload pin: `tests/judge.test.ts:317` (discriminating-token trick)
- System-prompt pin: `tests/judge.test.ts:677-684` (direct builder call + `assert.match`)
- Config rejection matrix: `tests/config-file.test.ts:68` (`writeConfig({ ...VALID, key: bad })` + `assert.rejects` regex)

**Risks:**
- Prompt drift between the two builders: mitigated by the single shared helper plus an `assert.equal` that both builders emit identical system text
- A future prompt edit breaking byte-identity for existing configs: mitigated by the `negativeKeywords.length === 0` early return and the byte-identity test
- Model ignoring the veto: mitigated by `temperature: 0` (`src/judge.ts:691`, `:788`) and the existing `relevant: false` fallback semantics — a miss degrades to today's behavior rather than failing

## Scope Boundaries
- Building: one optional config key, one shared private system-message helper, one veto sentence, tail-appended parameters, the validator + byte-identity + veto test pins
- NOT building: a client-side relevance filter, a heartbeat change, a verdict-shape change, a second LLM call, a probe change, or any workflow/state edit

## Testing Strategy

**Unit tests:**
- `tests/config-file.test.ts`: absent → `[]`; non-empty array valid; `[]` valid; non-array throws `/negativeKeywords.*must be an array/`; a non-string or blank item throws naming path + key
- `tests/judge.test.ts`: with negatives — the system message contains the veto sentence and the serialized list; absent or `[]` — byte-identical to the current literal; both builders emit identical system text
- `tests/judge.test.ts`: a mock fetch reads the request body; when the system message carries the veto list AND a post text matches a negative category, the mock answers `relevant: false` — the post is marked seen and not emailed

**Integration tests:**
- `tests/index.test.ts`: a full `runWatcher` with `config.negativeKeywords` set produces a digest that excludes the vetoed post (layered oracle: `WatcherRun` → disk state → captured subject)

**Manual verification:**
- [ ] Add `"negativeKeywords": ["internship", "outsourcing"]` to `watcher.config.json` and confirm a known-bad post drops out of the next digest
- [ ] Remove the key and confirm the next run's behavior matches the pre-change baseline
- [ ] `npx tsx scripts/probe-judge.ts` still passes unchanged (ceilings describe the positive-only prompt)

## Open Questions
**Resolved during research:**
- Shared helper or two copies of the system text? - One shared private helper (developer decision, research session); the duplication survived only because nobody edited the prompt since `e316cb5`
- Does the veto apply to the heartbeat's `candidateTerms`? - No; `src/heartbeat.ts:64-67` stays client-side per the discover blast-radius decision
- Does the probe need the negatives? - No; the builder parameter is optional with a none default, so `scripts/probe-judge.ts:247` stays byte-untouched
- Where do `HeartbeatStats` and `WatcherRun` live? - `src/heartbeat.ts:30` and `src/index.ts:212` respectively; `src/types.ts` holds only `Post`, `JudgeVerdict`, `AccountFailure`

**Requires user input:**
- Exact veto sentence wording - design-stage; must reference "a keyword above" so it binds to the keyword criterion, and must land before the untrusted-data fence sentence

**Blockers:**
- None

## References

- `.rpiv/artifacts/research/2026-11-09_11-04-26_negative-keywords-judge-seam.md` - the seam map this analysis scores against
- `.rpiv/artifacts/discover/2026-11-09_10-45-16_negative-keywords.md` - the FRD (6 requirements, 8 decisions, 0 open questions)
- `src/config-file.ts:239-255` - the optional-key validator template (`readReasoningEffort`)
- `src/judge.ts:236` + `:263` - the duplicated system-message literals
- `src/judge.ts:876-887` - `judgePosts` 10-parameter signature (tail-append discipline)
- `src/judge.ts:691` + `:788` - `temperature: 0` on both payloads
- `src/judge-parse.ts:16` + `:51` - the two strict verdict parsers
- `src/index.ts:445-448` - the production `judgePosts` pass-through
- `src/index.ts:212` / `src/heartbeat.ts:30` - `WatcherRun` / `HeartbeatStats` shapes
- `scripts/probe-judge.ts:247` - the zero-edit probe builder call
- `tests/judge.test.ts:317` + `:677` - the prompt-pin idioms to mirror
- `.rpiv/guidance/src/architecture.md` - "Adding a New Surface Type or Config Key" step list
