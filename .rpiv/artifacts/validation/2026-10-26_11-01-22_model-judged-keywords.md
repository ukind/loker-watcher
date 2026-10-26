---
template_version: 1
date: 2026-10-26T11:01:22+0700
author: Yogiswara Utama
commit: 195af95
branch: main
repository: loker-watcher
topic: "Validation of Model-judged keyword filtering"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md"
tags: [validation, plan, judge, keywords, bulk, heartbeat, state, tests, docs]
last_updated: 2026-10-26T11:01:22+0700
---

## Validation Report: Model-judged keyword filtering

### Implementation Status

- ✓ Phase 0: Probe judge latency + workflow budget — Fully implemented
- ✓ Phase 1: Bulk judge core + resilience — Fully implemented
- ✓ Phase 2: Funnel + judged-counter rework — Fully implemented
- ✓ Phase 3: Test relocation + state gate tests — Fully implemented
- ✓ Phase 4: Docs sync + repo gates — Fully implemented

### Automated Verification Results

- ✓ Terminal gate `npm run typecheck` — exit 0; `npx tsc --noEmit --listFiles | grep -c probe-judge` returns 1, so `scripts/probe-judge.ts` is now inside the gate
- ✓ Terminal gate `npm run lint` — exit 0; Biome checked 22 files across `src`, `tests`, `scripts/probe-judge.ts`
- ✓ Terminal gate `npm test` — exit 0; 97 tests, 97 pass, 0 fail across 26 suites
- ✓ Scoped lint `npx biome check src/index.ts src/heartbeat.ts src/types.ts` — exit 0, 3 files, no fixes
- ✓ Phase 0 workflow shape: `grep -n "timeout-minutes" .github/workflows/watch.yml` returns 10 (`probe`) and 45 (`watch`); `grep -n "workflow_dispatch"` returns the trigger (line 6) and the probe job's `if` guard (line 17)
- ✓ Phase 0 probe isolation: the `probe` job's step-scoped `env:` carries only `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` — no `THREADS_SESSION_STATE`, no `GMAIL_*`
- ✓ Phase 0 gate coverage: `grep -c "scripts" tsconfig.json` returns 1 (`"include": ["src", "tests", "scripts"]`); `package.json` lint script names `scripts/probe-judge.ts`
- ✓ Phase 1 rider count: `grep -c 'type: "json_object"' src/judge.ts` returns 1 (the bulk payload only; the fallback payload carries no rider)
- ✓ Phase 1 chunking: `grep -n "BATCH_SIZE" src/judge.ts` shows the constant at line 34 beside `REQUEST_TIMEOUT_MS` (line 31) and the slice step at lines 389-390; no other magic batch numbers
- ✓ Phase 1 exports intact: `resolveJudgeConfig`, `parseVerdict`, `parseBulkVerdicts`, `judgePost`, `judgePosts`, `JudgeConfig`, `JudgedPost`, `JudgeBatchResult` all exported
- ✓ Phase 1 timeout: `REQUEST_TIMEOUT_MS = 60_000` (src/judge.ts:31), never 15_000
- ✓ Phase 1 unanswered sites: `grep -c 'status: "unanswered"' src/judge.ts` returns 4 (the `BatchOutcome` union plus the three return sites: `!response.ok`, missing content, catch)
- ✓ Phase 1 no cascade: `grep -c "skipping batch" src/judge.ts` returns 3; the per-item `judgePost` call sits only inside the `outcome.status === "answered"` branch (the unanswered branch `continue`s before the item loop)
- ✓ Phase 1 parse-miss fallback: the parse-failure branch returns `{ status: "answered", verdicts: new Map() }`, so an answered-but-unparseable batch still routes every item to the fallback
- ✓ Phase 1 `parseVerdict` byte-identity: `diff` of the `parseVerdict` block against `HEAD:src/judge.ts` reports no difference (fence-strip regexes included)
- ✓ Phase 1 id safety: no `Number(` coercion of post ids anywhere in `src/judge.ts` (the only hit is a doc comment explaining why)
- ✓ Phase 2 gate removal: `grep -rn "filterPostsByKeywords\|matchesKeywords" src/ tests/` returns nothing; `src/keywords.ts` and `tests/keywords.test.ts` are both absent from the tree
- ✓ Phase 2 vocabulary sweep: `grep -rni "maybe" src/ tests/` returns nothing; `grep -rn "keyword match\|keyword maybe" src/` returns nothing
- ✓ Phase 2 funnel wiring: `grep -n "stats.judged" src/index.ts` shows exactly one assignment (`stats.judged = newPosts.length;`, line 86) placed before the first heartbeat call (line 88); `grep -n "config.keywords" src/index.ts` shows exactly one occurrence — the third argument of the `judgePosts` call (line 97)
- ✓ Phase 3 bulk parser contract: `grep -n "parseBulkVerdicts" tests/judge.test.ts` shows its describe at line 145 with 8 cases
- ✓ Phase 3 state gate: `grep -c "skips the disk write" tests/state.test.ts` returns 2 (both no-op branches), plus a positive control that saves and round-trips
- ✓ Phase 3 rider asserted both ways: `tests/judge.test.ts:399` asserts the bulk payload carries `"response_format":{"type":"json_object"}`; line 402 asserts the fallback payload does not
- ✓ Phase 3 defer contract: `grep -c "defers a" tests/judge.test.ts` returns 2 (HTTP 502 and a thrown timeout); `grep -n "unparseable text"` shows the parse-miss fallback test at line 363
- ✓ Phase 3 no stale cascade test: `grep -rn "routes a wholly failed batch" tests/` returns nothing
- ✓ Phase 4 doc sweeps: `filterPostsByKeywords|matchesKeywords`, `keywords.ts`, `keyword maybe|[keyword match]`, the stale judge-shape phrases, and `frontend / fullstack|frontend/fullstack` all return nothing across `README.md`, `.claude/`, `.rpiv/guidance/`, and `AGENTS.md`
- ✓ Phase 4 runbook retarget: `.claude/skills/validate-e2e/SKILL.md:16` names `judgePosts` in step 5
- ✓ No regressions detected: the full offline suite (97 tests) passes, including the relocated `parseVerdict` / `resolveJudgeConfig` / `judgePost` suites and the untouched `email`, `extract`, `recency`, `session`, and `config-file` suites

### Code Review Findings

#### Matches Plan:

- `src/judge.ts:31,34` — `REQUEST_TIMEOUT_MS = 60_000` and `BATCH_SIZE = 10` sit side by side as module constants, exactly as the revised Phase 1 fence specifies
- `src/judge.ts:222-224` — the `BatchOutcome` union (`answered` | `unanswered`) is the mechanism that turns a transport failure into a whole-batch defer instead of a per-item cascade
- `src/judge.ts:389-407` — the `judgePosts` chunk loop: unanswered batches push every post id into `skippedPostIds` with one warn naming both the cause and the retry, then `continue`; the per-item `judgePost` fallback runs only on the answered branch
- `src/judge.ts:138-155` and `src/judge.ts:158-180` — both message builders serialize `JSON.stringify(keywords)` into the system message; no hardcoded frontend/fullstack criterion survives in either
- `src/judge.ts:148` — `buildMessages` restores HEAD's escaped `\"${post.text}\"`, discharging the plan-review row that flagged the plain-quote divergence
- `src/index.ts:86-97` — `stats.judged = newPosts.length` lands immediately after `diffNew` and before the first heartbeat call; `judgePosts` receives `config.keywords` as its third argument
- `src/index.ts:88,109` — both heartbeat call sites pass `newPosts` (posts sent to the judge), never the `judged` output array
- `src/index.ts:120-123` — the email-before-state ordering and the `judgedIds` persistence are untouched; skipped ids are structurally absent from `judged`, so they stay unseen
- `src/heartbeat.ts:34,46-47,66-68,115,128` — `HeartbeatStats.maybes` → `judged`, `Candidate.reason` union → `"judged" | "near-miss"`, funnel copy → "N judged candidate(s)", candidate tag → "[judged]"; the near-miss tier is byte-identical
- `src/types.ts:26-28` — `JudgeVerdict.relevant` doc is keyword-guided rather than frontend/fullstack-specific
- `tests/judge.test.ts` — the relocated `parseVerdict`, `resolveJudgeConfig`, and `judgePost` suites assert body-for-body what `tests/keywords.test.ts` asserted; only the `judgePost` call sites gained the `keywords` argument
- `tests/judge.test.ts:321-404` — the bulk acceptance suite pins the incident's contract with call-count mock routing: 10 posts → 1 call, 15 posts → 2 calls, bulk miss → 1 fallback, unanswered batch → 0 fallbacks, parse miss → 1 fallback, rider on the bulk payload only
- `tests/state.test.ts` — both `saveState` no-op branches are pinned (`saved === false` plus a byte-identical file) with a positive control that round-trips through `loadState`
- `scripts/probe-judge.ts` — three timed calls (one minimal, two bulk at the production prompt shape), each duration logged, nonzero exit on any failure
- `.github/workflows/watch.yml:14-37` — the `probe` job is `workflow_dispatch`-only, carries only the three `LLM_*` secrets, and touches no Threads surface and no email path

#### Deviations from Plan:

- `src/judge.ts:378` — Phase 1's automated criterion reads: "Worst case is ceil(N/BATCH_SIZE) calls: `grep -n "ceil(N/BATCH_SIZE) + 2N" src/judge.ts` returns nothing." The grep returns one hit, but that hit is the plan's own mandated `judgePosts` docstring ("...therefore ceil(N/BATCH_SIZE) calls, not ceil(N/BATCH_SIZE) + 2N"). The criterion contradicts the plan's own Phase 1 fence, so it is unachievable as written. The implementation matches the fence exactly, and the semantic claim is independently verified: a 12-post run against a dead endpoint made exactly 2 calls (ceil(12/10)) with zero fallback calls. **Plan deviation, non-blocking — comment-only.**
- `AGENTS.md:36-38` — the plan's Follow-up section states Phase 4 "gains the defer wording in README pipeline step 5 and the AGENTS.md judge bullet". README step 5 carries it ("A batch the endpoint does not answer is deferred whole — those posts stay unseen and retry on the next run"); the AGENTS.md judge bullet still reads only "bulk misses fall back to single-post calls". **Plan deviation, non-blocking — comment-only.**
- `.rpiv/guidance/.github/workflows/architecture.md:14,69,77` — three statements the 45-minute watch budget invalidates: the `watch.yml` structure line still reads `timeout: 10m`; the Architectural Boundaries bullet still reads "`timeout-minutes` below the cron interval (10): a hung run dies before the next tick queues"; and the "Adding a New Scheduled Job" step 5 still reads "Set `timeout-minutes` strictly below the cron interval". Phase 4's `files:` list omitted this file. **Plan deviation, non-blocking — comment-only.**

#### Pattern Conformance:

- ✓ `scripts/probe-judge.ts` follows the `src/` conventions it has a sibling for: a JSDoc header naming the incident that motivated it, `ENV_NAMES` imported from `../src/config.js` rather than re-declared, `Post` typed from `../src/types.js`, fail-visible `process.exit(1)` with a message that names the missing variables
- ✓ `tests/judge.test.ts` and `tests/state.test.ts` keep the offline test rule: every double is an inline literal with one `as unknown as typeof fetch` cast, no mock library, zero network, and state files live under the OS temp dir with a single `after()` cleanup
- ✓ `tests/state.test.ts` uses the `filePath` seam rather than touching `state/seen-posts.json`, matching the guidance's "only `state.ts` writes to disk" boundary
- Acceptable variation, not a deviation: `scripts/probe-judge.ts` is the first file under `scripts/` that is project code rather than an agent-harness hook, so it has no same-role sibling to mirror. It is brought under both repo gates while `scripts/hooks/*.js` stays outside them, which is what the plan specified.

#### Potential Issues:

- `REQUEST_TIMEOUT_MS = 60_000` (`src/judge.ts:31`) has now been measured once, from a developer machine rather than a GitHub runner: **avg 16,092ms per bulk call** (3 calls, 48,275ms total) against `https://api.z.ai/api/coding/paas/v4` with `glm-5.3`. That leaves 3.7× headroom under the 60s timeout, and at that latency a 283-post backlog is ~7.7 minutes of judge rather than the 29 minutes the plan budgeted for. The runner path is still unmeasured — the plan's own Follow-up section records this as open and owned by Phase 0 — and a runner 4× slower than this machine would exceed 60s per call and start deferring batches. **Non-blocking — the measured value confirms the proposal, and the runner probe remains the outstanding item.**
- `normalizeEndpoint` (`src/judge.ts:117-120`) produces an opaque error when `LLM_BASE_URL` is malformed: a value carrying stray quote characters yields `Failed to parse URL from "https://..."/chat/completions`, which names neither the variable nor the likely cause. This is pre-existing behavior outside the plan's scope, and `.env` is not a product input (GitHub Actions secrets carry no quotes), so it did not affect this validation. Worth a follow-up: validate the resolved base URL in `resolveJudgeConfig` and fail with a message that names `LLM_BASE_URL`. **Non-blocking — out of scope, no executable line in the run's delta depends on it.**

### Manual Testing Required:

Performed during this validation run. Offline checks first, then one live run against the real LLM endpoint and the real Threads feed (mock email transport, temp state file — no email left the machine, `state/seen-posts.json` never touched).

**Offline (no credentials):**

1. Probe fail-red paths (Phase 0 manual criterion 4):
   - [x] Missing credentials: `env -u LLM_BASE_URL -u LLM_API_KEY -u LLM_MODEL npx tsx scripts/probe-judge.ts` prints `probe: missing LLM_BASE_URL, LLM_API_KEY, or LLM_MODEL` and exits 1
   - [x] Dead endpoint: `LLM_BASE_URL=http://127.0.0.1:1/v1` with a bogus key and model — all three calls report `FAILED: fetch failed`, the summary reports `minimal=fail bulk=fail bulkAgain=fail`, exit 1
   - [x] Wrong model against a stub answering HTTP 400: all three calls report `HTTP 400 NO JSON`, the summary reports all three failed, exit 1 — the job goes red rather than passing silently
2. Probe happy path against a local stub (Phase 0 manual criterion 1, local equivalent):
   - [x] Three durations printed (`minimal call`, `bulk call`, `bulk call again`), each with an HTTP status and an OK/NO JSON verdict
   - [x] The two bulk durations agreed within a factor of two (4ms and 2ms against the stub)
   - [x] The captured bulk payload carries the production prompt shape: the serialized keyword list in the system message, ten `id <id> by @<author>` + text pairs, and `"response_format":{"type":"json_object"}`
3. D3 invariant end-to-end (plan Testing Strategy manual step 3):
   - [x] Run 1 with an endpoint that never answers: 12 posts → 2 bulk calls (ceil(12/10)), 0 judged, 12 skipped, zero fallback calls — the worst case is ceil(N/BATCH_SIZE), not ceil(N/BATCH_SIZE) + 2N
   - [x] `saveState` with the empty judged-id list returns `{ saved: false, addedCount: 0 }` and the state file is never created
   - [x] Run 2 with an answering endpoint: the 12 previously skipped posts are still unseen, all 12 are judged, and the state file then persists all 12 ids
4. Heartbeat rendering (Phase 2 manual criterion 3):
   - [x] A zero-match run renders the funnel exactly as the plan's Desired End State specifies: `487 unique post(s)`, `303 within 72h`, `283 judged candidate(s)`, `0 relevant + located`, `0 skipped by the judge`
   - [x] The judged-tier candidate tag reads `[judged]`; the near-miss tier is untouched

**Live (real `LLM_*` credentials, real Threads feed, mock email, temp state):**

5. Full pipeline run — `.rpiv/tmp/e2e-live.mts`, following `.claude/skills/validate-e2e/SKILL.md`:
   - [x] All 5 surfaces fetched logged-out (77 posts, 72 unique, 22 within 72h, 22 unseen)
   - [x] Judge answered every bulk call: 3 calls, 48,275ms total, **avg 16,092ms per call**, 22 judged, 0 skipped
   - [x] **The digest path fired for the first time**: 2 real matches, both genuine frontend/fullstack openings in Indonesia (Bandung remote/hybrid; Uluwatu, Bali on-site), captured by the mock transport
   - [x] `saveState` wrote all 22 judged ids to the temp path (`saved=true added=22`)
   - [x] `state/seen-posts.json` sha256 identical before and after (`7326c4dc6e5c1f45`) — the real state file was never touched
   - [x] Fail-visible: `loadState` on a corrupt file threw `state: failed to load state from ...: Expected property name or '}' in JSON at position 2` and left the file byte-identical
   - [x] Whole run: 63.6s
6. Resilience under a dead endpoint (live, first attempt):
   - [x] A malformed `LLM_BASE_URL` made all 5 bulk calls fail with `Failed to parse URL`; each batch was deferred whole, **zero fallback calls fired**, the run completed in 23.1s, and the real state file stayed untouched. Under the pre-change cascade this would have been 5 batches × 10 posts × 2 attempts = 100 doomed calls — the exact failure mode that cancelled run 40264368939.

Still requires a human with runner access and real secrets:

7. Phase 0 manual criteria 2 and 3 — a `workflow_dispatch` run of the `probe` job from inside GitHub Actions:
   - [ ] Read the measured bulk duration and confirm `REQUEST_TIMEOUT_MS = 60_000` is enough (raise it if the probe reports more)
   - [ ] Confirm `BATCH_SIZE = 10` still fits the 45-minute budget, or lower it to 5
8. Plan Testing Strategy manual step 5 — after the fix, re-run `workflow_dispatch`:
   - [ ] Confirm the judge stage finishes inside the job budget: the log shows 29 bulk calls (fewer once the backlog clears), the digest or the heartbeat emails, and the state step commits

### Recommendations:

- Fix the three comment-only deviations before commit — they are one-line doc edits, not code changes:
  1. `AGENTS.md:36-38` — add "and a batch the endpoint does not answer is deferred whole" to the judge bullet
  2. `.rpiv/guidance/.github/workflows/architecture.md:14,69,77` — restate the timeout rule for the 45-minute watch budget (the `concurrency: watch` queue is what now bounds overlap, not the job timeout)
  3. `src/judge.ts:378` — reword the docstring so the Phase 1 grep criterion can pass as written, or amend the criterion in the plan
- Run the `probe` job once via `workflow_dispatch` and read the measured bulk latency into `REQUEST_TIMEOUT_MS`. The developer-machine measurement (avg 16,092ms per call) already confirms 60s is adequate with 3.7× headroom; the runner number closes the last open item.
- Optional follow-up, outside this plan's scope: have `resolveJudgeConfig` validate the resolved `LLM_BASE_URL` and fail with a message that names the variable, instead of letting `normalizeEndpoint` surface `Failed to parse URL from "..."/chat/completions`.
- Ready to commit — the implementation is complete and validated. The three deviations are doc-text only and do not block.
