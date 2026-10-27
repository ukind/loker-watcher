---
template_version: 1
date: 2026-10-26T20:14:35+0700
author: Yogiswara Utama
commit: 399181b
branch: ukind/fix-hit-limit
repository: fix-hit-limit
topic: "Validation of LLM account rotation on rate limit"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-26_15-59-52_llm-account-rotation.md"
tags: [validation, judge, rotation, rate-limit, config, email, probe]
last_updated: 2026-10-26T20:14:35+0700
---

## Validation Report: LLM account rotation on rate limit

### Implementation Status

- ✓ Phase 1: Rotation types + LLM_ACCOUNTS parser — Fully implemented
- ✓ Phase 2: Rotation mechanics + config flip — Fully implemented
- ✓ Phase 3: Exhaustion email — Fully implemented
- ✓ Phase 4: Probe + workflow + docs + trio removal — Fully implemented (live probe run completed post-validation — see Manual Testing Required)

### Automated Verification Results

- ✓ Parser + rotation proofs: `npx tsx --test tests/judge.test.ts` — 40/40 pass, incl. the three-account concurrent-429 CAS proof and the no-backoff rotation proof (<500ms)
- ✓ Email tests: `npx tsx --test tests/email.test.ts` — 20/20 pass, incl. the three new sendExhaustionEmail cases
- ✓ Full suite: `npm test` — 118/118 pass, no regressions
- ✓ Type checking: `npm run typecheck` — clean under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
- ✓ Lint: `npm run lint` — clean (22 files); scoped Phase 1/2/3 `biome check` variants all clean
- ✓ 429 lives only in rotation branches: `grep -n "429" src/judge.ts` — branch conditions at src/judge.ts:423 and :525, plus comments and the "HTTP 429" failure reason; `RETRYABLE_STATUSES` (src/judge.ts:55) is exactly [500, 502, 503, 504]
- ✓ No fake timers: `grep -rn "mock.timers" tests/` — no matches
- ✓ No stale env names: `grep -rn "LLM_BASE_URL\|LLM_API_KEY\|LLM_MODEL" src/ scripts/ .github/ README.md AGENTS.md .claude/` — no matches
- ✓ Probe uses the shared parser: `grep -n "resolveJudgeConfig" scripts/probe-judge.ts` — import at :22, guarded `[0]` read at :163-167
- ✓ Probe fail-visible guard exercised: with LLM_ACCOUNTS unset the probe prints `probe: judge: missing required environment variable: LLM_ACCOUNTS` and exits 1 — no network calls
- ✓ Live probe run (manual item, executed with a real LLM_ACCOUNTS pool): exit 0 — minimal 1829ms; bulk 18.9s / 14.0s; ramp 2: 2/2 ok, 4: 4/4 ok, 8: 7/8 ok with 1 real HTTP 429 → measured ceiling 4, `recommended JUDGE_CONCURRENCY = 4`. Bulk latency sits well inside the 60s REQUEST_TIMEOUT_MS; the shipped JUDGE_CONCURRENCY = 4 matches the measured ceiling exactly
- ✓ Live judge run against the same endpoint: judgePosts over 40 posts (4 concurrent batches) judged 40/40, zero skips, zero rotations needed — the production path works against the real Z.AI endpoint (transient all-429 windows also observed minutes earlier, confirming the dynamic-limit behavior the rotation feature targets)

### Code Review Findings

#### Matches Plan:

- src/types.ts:32-42 — `AccountFailure` (1-based `account`, `baseUrl`, `reason`) appended verbatim per the Phase 1 fence
- src/config.ts:15-21 — `ENV_NAMES` final registry: `llmAccounts: "LLM_ACCOUNTS"` in, the trio out (composes Phase 1's fence with Phase 4's removal)
- src/judge.ts:63-113 — `LlmAccount`, `RotationState`, `ROTATION_EXHAUSTED` tag + `rotationExhausted` factory + `isRotationExhausted` guard — tagged error, not a class, per the codebase idiom
- src/judge.ts:115-150 — `parseLlmAccounts` fail-visible per-item validation, indexed error names, trimmed fields
- src/judge.ts:331-350 — `rotateOnRateLimit` compare-and-set on the dispatch-time index; one failure record + one advance per account
- src/judge.ts:373-460 — `judgeBatch`: pointer read at the top of every attempt before the first await; 429 branch ahead of the shared retryable check with attempt rewind (rotation replaces the wait, zero sleep); `model: account.model` un-hoisted into the loop; third `{ status: "exhausted" }` arm
- src/judge.ts:494-560 — `judgePost`: 429 rotates without spending a fallback attempt; pool exhaustion throws the tagged error directly (sequential in the reassembly loop)
- src/judge.ts:595-655 — `judgePosts` owns `RotationState`, workers share it by reference; drain-then-throw after the `Promise.all` join with `[...state.failures]`; signature takes `readonly LlmAccount[]`
- src/index.ts:151-169 — `main().catch` alarm branch exactly as fenced: best-effort exhaustion email inside try/catch, `process.exit(1)` outside it on both paths; generic path unchanged
- src/email.ts:160-203 — `buildExhaustionText` + `sendExhaustionEmail` over the `sendText` spine with injected `Transporter`; `AccountFailure` imported from types (no email→judge coupling — grep-verified)
- scripts/probe-judge.ts — usage line, `ENV_NAMES` import removed, `LlmAccount` threading through `timed`/`rampLevel`/`findConcurrencyCeiling`, `model: account.model` in both payloads, guarded first-account read
- .github/workflows/watch.yml:30-32, :54-58 — both env blocks collapsed to the four/one secret lines per the fence; the `Commit state` step (:61-77) keeps success-only gating — no `if: always()` / `if: !cancelled()` override
- README.md:23-25, :43-44, :53, :212 — rotation sentence in pipeline step 5, requirements bullet, single secrets-table row, local-run export
- AGENTS.md:36-43 — judge bullet verbatim per the fence; :18/:21 `LLM_*` wildcards untouched as planned
- .claude/skills/validate-e2e/SKILL.md:13-14 — step 4 swapped to `LLM_ACCOUNTS`
- state/seen-posts.json — not in the working-tree delta: exhaustion leaves no state write, as required

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan. (Phase 1's manual bullet "trio still present" is phase-time-scoped — Phase 4's fence is the final registry and the tree matches it; not a deviation.)

#### Pattern Conformance:

- ✓ `parseLlmAccounts` mirrors the fail-visible per-item validation idiom of `src/config-file.ts` (indexed error names, preserved parser messages, trimmed reads)
- ✓ `buildExhaustionText`/`sendExhaustionEmail` follow the builder+sender-over-`sendText` shape of `sendDigest`, including the empty-input null/undefined gate and the `email:` log prefix
- ✓ Test mocks branch on request URL (distinct host per account), never call order; assertions check pointer monotonicity and per-key dispatch counts; header-capture mock follows the existing body-capture idiom
- ✓ All judge warns log the dispatch-time account (`attemptIndex + 1`) — the Step 9 triage fix landed in every branch (429, 5xx retry, non-retryable, missing content, parse miss, transport)
- ✓ Log prefixes kept: `judge:`, `probe:`, `email:`, `watch: FAILED —`
- Minor observation (acceptable variation, not a deviation): `normalizeEndpoint` (src/judge.ts:222-225) tolerates a base URL that already ends in `/chat/completions` — a small robustness addition beyond the fence's string concat, consistent with the probe's trailing-slash strip

### Manual Testing Required:

1. Live probe run — DONE post-validation (executed with the developer's real Z.AI account after the `.env` blocked-report; credentials supplied in conversation, never written to a repo file):
   - [x] `LLM_ACCOUNTS='[...]' npx tsx scripts/probe-judge.ts` — exit 0
   - [x] Latency lines present: minimal 1829ms, bulk 18893ms / 13959ms
   - [x] Ramp 2 → 4 → 8: 2/2, 4/4, 7/8 ok — one genuine HTTP 429 REFUSED at level 8
   - [x] `probe: recommended JUDGE_CONCURRENCY = 4` — matches the shipped value; measured ceiling is 4
2. Verified here (no credentials needed): the no-pool path — probe exits 1 printing `probe: judge: missing required environment variable: LLM_ACCOUNTS`

All plan manual criteria are now met. No manual items remain.

### Recommendations:

- Ready to commit — implementation is complete and validated, manual criteria included.
- Before the next scheduled run after merge: create the `LLM_ACCOUNTS` Actions secret (JSON array); delete the dead `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` secrets after the first green run (plan Migration Notes).
- Refresh the local `.env` to the `LLM_ACCOUNTS` shape so local runs match the workflow (the current file still carries the old trio).
- Consider rotating the Z.AI API key: it was shared in conversation during validation and should be treated as exposed.
