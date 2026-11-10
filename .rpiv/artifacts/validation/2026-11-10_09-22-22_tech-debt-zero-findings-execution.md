---
template_version: 1
date: 2026-11-10T09:22:22+0700
author: Yogiswara Utama
commit: 7dcaeb3
branch: ukind/fix-tech-debt
repository: fix-tech-debt
topic: "Validation of Tech-Debt Zero-Findings Pass (N018-N029 + N005) — phased execution plan"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-10_06-56-47_tech-debt-zero-findings-execution.md"
tags: [validation, tech-debt, judge-dispatch, extraction, dead-exports, smtp-transport, docs-sync]
last_updated: 2026-11-10T09:22:22+0700
---

## Validation Report: Tech-Debt Zero-Findings Pass (N018-N029 + N005) — phased execution plan

### Implementation Status

- ✓ Phase 1: N020 dead exports — Fully implemented (all 12 symbols module-private; PAGE_SIZE keeps its export; knip 0/0)
- ✓ Phase 2: N019 dead-arm collapse — Fully implemented (numstat 4/31: deletions + the comment rewrite only)
- ✓ Phase 3: N005 dispatch extraction — Fully implemented (verbatim move proven; seam cycle-free; judge.ts 405 lines, judge-dispatch.ts 695)
- ✓ Phase 4: FR3 judgePosts options object — Fully implemented (options object wired, interface private, defensive copies present)
- ✓ Phase 5: N023 shared SMTP transport — Fully implemented (memo resolver, three frames unwrap after their own resolveEmailConfig)
- ✓ Phase 6: N026 + N029 config and canary — Fully implemented (one "hiring developer jakarta"; canary untracked and absent)
- ✓ Phase 7: N027 + N028 script guards — Fully implemented (entry guard proven by import; download bounded and wrapped)
- ✓ Phase 8: N022 paired-constant pin — Fully implemented (both pins present; drift detection proven by mutation test)
- ✓ Phase 9: N018 + N024 + N025 docs sync — Fully implemented (all four doc surfaces match the code)

### Automated Verification Results

- ✓ Whole-plan gate: `npm run typecheck` — exit 0
- ✓ Whole-plan gate: `npm run lint` — exit 0, 61 files, no fixes
- ✓ Whole-plan gate: `npm test` — exit 0: 540 tests / 540 pass / 0 fail (116 suites)
- ✓ Whole-plan gate: `npx knip` — exit 0, zero unused exports, zero unused files
- ✓ No regressions detected — base fd53570 measured (detached worktree, full suite): 536 tests / 536 pass / 0 fail; delta -> 540/540 (+4 tests, +0 fail)
- ✓ P1: the 12 knip-named symbols have zero `export` hits in src; zero `typeof` operand uses anywhere; `export const PAGE_SIZE` count = 1
- ✓ P2: `allAvailabilityBlocked` count = 0 in src+tests; "misread as a transport error" and "never a timerless wait" both present in judge-dispatch.ts; the false sentence "unreachable by the case analysis" count = 0
- ✓ P3: byte-verbatim move proofs vs ca1bd4b — dispatchLlmCall, judgePost, systemMessage, buildMessages, buildBulkMessages, normalizeEndpoint, terminalFailureReason, sleep all diff-empty; judgeBatch and exhaustionRecord differ ONLY by the export keyword D2 mandates (their pre-consumed surface); warn-string census 6 = 2 + 4; `from "./judge.js"` in judge-dispatch.ts = exactly 1 hit and it is `import type`; re-point count >= 1 in all 7 consumer files
- ✓ P4: `negativeKeywords: config.negativeKeywords` count = 1 in index.ts; `export.*JudgePostsOptions` count = 0 and `interface JudgePostsOptions` count = 1 in judge.ts; `new Map(blocked)` and `new Map(healthMarks)` defensive copies present; "POSITIONAL" and "options.blocked" both documented at the seam
- ✓ P5: `service: "gmail"` count = 1 in email.ts; `transport ?? createGmailTransport` count = 1; nodemailer in index.ts is `import type` only; `transport: undefined` entry-catch fence count = 1; `npx tsx --test tests/email.test.ts` — 41/41 pass
- ✓ P6: "hiring developer jakarta" count = 1 in watcher.config.json; canary untracked (`git ls-files` empty) and absent on disk; `loadWatcherConfig()` runs clean (eval: CONFIG-OK)
- ✓ P7: module-scope `const ENV` count = 0; `pathToFileURL(process.argv` count = 1; `envWithDotEnv()` count = 1 (inside main); `AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)` count = 1; `download failed for` fail() path count = 1
- ✓ P8: literal pin `assert.equal(HARD_FAIL_TICKS_TO_CAP, 2)` count = 1; behavioral pin seeds `new Map([[0, HARD_FAIL_TICKS_TO_CAP]])` (tests/judge-health.test.ts:257); no import edge judge-health -> judge-rotation; judge-rotation.ts imports are `import type` only; `export const HEALTH_CAP_STREAK` count = 0
- ✓ P9: step-8 subject claim gone from README; `negativeKeywords` row present; AGENTS.md and both guidance mirrors name judge-dispatch; `N018` count >= 1 in src/linkedin-payload.ts

### Code Review Findings

#### Matches Plan:

- src/judge-dispatch.ts — the moved surface is byte-identical to the pre-extraction judge.ts (10/10 ranges; 2 carry only the D2-mandated `export` keyword). The 2338274 park/rewind pins ride the move untouched (540/540).
- src/judge.ts:1-17 — header doc reads as orchestration-only and names the seam; judge-dispatch.ts:1-15 states the one-way invariant. Both tell the truth.
- src/judge.ts (judgePosts) — FR3 shape exactly per D4/D5: options defaulted to `{}`, defensive copies `new Map(blocked)`/`new Map(healthMarks)` operate on the destructured locals, the fetchFn/reasoningEffort POSITIONAL choice documented.
- src/index.ts:245-249, 399-400, 436-444, 542-553, 660-670 — the smtp resolver is runWatcher-scoped; every consuming frame (heartbeat try, exhaustion helper try, notify closure) unwraps INSIDE its own config-resolving frame, so the three throw disciplines read unchanged; the entry catch keeps `transport: undefined`.
- src/index.ts:142-160 — exhaustion helper unwraps `typeof deps.transport === "function" ? deps.transport(emailConfig) : deps.transport` inside the try, after `resolveEmailConfig(deps.env)`.
- scripts/watch-linkedin.ts — entry-guarded import verified live: `import('./scripts/watch-linkedin.ts')` prints nothing, starts no loop, exits (IMPORTED-CLEAN). Log vocabulary intact: "tick FAILED" x1, "FAILED —" present in both PC scripts.
- scripts/setup-curl-impersonate.ts — the download is bounded AND wrapped: `AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)` inside try/catch -> `fail()`, so the escape-hatch contract holds on a timeout.
- tests/judge-health.test.ts:257 — the behavioral pin seeds the SYMBOL; mutation test proves drift detection: HEALTH_CAP_STREAK 2->3 fails exactly the behavioral pin (43 pass / 1 fail), revert restores 44/44, tree clean after.
- src/linkedin-payload.ts:28-36 — the PAYLOAD_VERSION doc names the strict reject and carries the operator remedy ("update the PC loop's clone of main (git pull) and restart watch-linkedin"), mirroring the orphan warning at src/index.ts:533.
- AGENTS.md:118-141 — funnel order holds: judge-rotation (118) -> judge-dispatch (121) -> judge-ceilings (129); judge-health (133) -> judge-availability (137) -> judge-parse (141).
- README.md:58-61, 141 — step 8 names the per-surface subject; the negativeKeywords row sits after candidateTerms.
- watcher.config.json — exactly one "hiring developer jakarta" surface; the duplicate-surface warn cannot fire for this pair (and the warn pin still passes on a fresh duplicate, 540/540).

#### Deviations from Plan:

- tests/email.test.ts — modified by phase 5 (b54f963) but absent from that phase's `files:` list. The change is the run's own in-goal work: it adds the createSmtpResolver memo pins (injected-transport precedence + one-construction reuse) that D8's design text prescribes, and phase 5's own AV item (`npx tsx --test tests/email.test.ts`) exercises exactly this file. Plan deviation — the owning phase's `files:` is incomplete. Non-blocking.
- Phase 8 AV item as written is unmeetable: it expects `git grep -c "judge-rotation" src/judge-health.ts` = 0, but the file carries 5 doc-comment mentions (lines 9, 11, 43, 82, 219) that name the boundary it documents. The property the item guards holds — zero import edges in either direction between judge-health and judge-rotation, and judge-rotation.ts keeps its zero-runtime-import identity. Comment-only class; remedy is doc rewording only. Non-blocking.
- Phase 9 AV item as written is over-broad: it expects `git grep -c "+ LinkedIn" README.md` = 0, but one hit survives at README.md:3 — the product tagline ("Threads + LinkedIn #hiring Indonesia job alerts"), not the retired step-8 subject claim. The claim the item targets is gone. Comment-only class. Non-blocking.
- Phase 5 AV item expectation drift: `git grep -c "createSmtpResolver" src/index.ts` returns 2 (the import line + the call site), not 1. Substance met — the entry module consumes the resolver once. Non-blocking.
- Phase 3 sleep verbatim proof: the plan's sed range (`/‹export const sleep›/,/setTimeout(resolve, ms);/p`) never terminates on the base file, so the command as written produces diff noise instead of a proof. Direct comparison of both definitions shows byte identity (judge-dispatch.ts:64-69 vs ca1bd4b judge.ts:126-131). Criterion flaw, not a code flaw. Non-blocking.
- Plan-text blemishes only: the Phase 4 heading is duplicated in the plan body ("## Phase 4: ...## Phase 4: ..."), and the Phase 8 code block carries two superseded variants of one comment sentence. The landed code matches the intended variant. Cosmetic; the plan needs no revise for these.

#### Pattern Conformance:

- ✓ The new module follows the repo's module idioms: module doc naming its consumers, `node:`-free relative imports in biome order, type-only reverse edges under `verbatimModuleSyntax`.
- ✓ The new tests follow the offline suite idioms: injected doubles, no repo writes, describe/it naming consistent with the sibling suites.
- Minor observation: judge.ts landed at 405 lines vs the plan's "~470 lines" estimate — smaller, because the estimate counted the header doc loosely. Acceptable variation, not a deviation.

#### Potential Issues:

- Commit 79bc0b3 (inside the run range, before phase 1) tracks four .rpiv/artifacts files (TECH_DEBT_AUDIT.md regeneration, the discover note, the research, this plan). This is the workflow's own bookkeeping — the plan's `parent:` field references exactly these inputs. Explained; non-blocking.

### Manual Testing Required:

All manual criteria were executed during validation, not deferred. None remain for the operator.

1. P1 — symbol privacy and typeof audit:
   - [x] Done: 0 export hits for all 12 names; 0 typeof operand uses across src/tests/scripts.
2. P2 — diff shape:
   - [x] Done: ca1bd4b numstat 4/31 — deletions plus the comment rewrite only; no other line moved.
3. P3 — seam truth and move shape:
   - [x] Done: header docs read true on both sides; D6 "OUTSIDE the try" sentences rode the move byte-identical (verbatim diffs); judge.ts shrank by the moved blocks while judge-dispatch.ts appeared (0cc8f3f stat: -744/+695); re-point files changed by 1-13 lines each.
4. P4 — options-object behavior:
   - [x] Done: doc names `options.blocked`; zero-options call sites (judge-rotation.test.ts:430, :475 and the shallow judge.test calls) compile and pass unchanged — the arity gate plus 540/540 is the proof.
5. P5 — frame discipline:
   - [x] Done: entry-catch fence intact (`transport: undefined`); all three consuming frames read unchanged (heartbeat catch, exhaustion helper catch, notify closure), each unwrapping after its own resolveEmailConfig.
6. P6 — duplicate-surface quiet:
   - [x] Done by static proof: exactly one "hiring developer jakarta" in the config, config loads clean, and the fresh-duplicate warn pin passes. A live `npm start` was not run (it needs live LLM_* and GMAIL_* credentials); the static proof covers the criterion — the warning compares configured surfaces, and the pair no longer exists.
7. P7 — import safety and vocabulary:
   - [x] Done: live import prints nothing, starts no loop, exits; "tick FAILED" and "FAILED —" vocabulary intact in both PC scripts.
8. P8 — drift detection:
   - [x] Done: mutation HEALTH_CAP_STREAK 2->3 fails exactly the behavioral pin; reverted; 44/44 after; file restored byte-exact (`git diff` empty).
9. P9 — docs truth:
   - [x] Done: payload remedy sentence mirrors the orphan warning wording; AGENTS.md funnel-ordered; README step 8 and the config row match buildSurfaceSubject's behavior; no false sentence found in the touched doc surfaces.

### Recommendations:

- Ready to commit — implementation is complete and validated. Note: the run already landed as 9 per-phase commits (f1812b4..7dcaeb3), each gated on typecheck + lint + test per the plan's ordering constraints; the working tree is clean, so there is nothing left to group.
