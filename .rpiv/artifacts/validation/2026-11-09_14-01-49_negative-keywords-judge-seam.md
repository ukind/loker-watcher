---
template_version: 1
date: 2026-11-09T14:01:49+0700
author: Yogiswara Utama
commit: a493b8c
branch: main
repository: loker-watcher
topic: "Validation of Negative Keywords for the Judge"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-09_12-36-43_negative-keywords-judge-seam.md"
tags: [validation, plan, judge, config-file]
last_updated: 2026-11-09T14:01:49+0700
---

## Validation Report: Negative Keywords for the Judge

### Implementation Status

- ✓ Phase 1: config key + validator + type fallout — Fully implemented
- ✓ Phase 2: shared system-message helper + builders — Fully implemented
- ✓ Phase 3: parameter threading + production pass-through + scenario pins — Fully implemented

### Automated Verification Results

- ✓ Type checking passes: `npm run typecheck` — exit 0, no errors
- ✓ Lint passes: `npm run lint` — exit 0, 60 files checked, no fixes applied
- ✓ Full suite passes: `npm test` — exit 0, 513 tests / 110 suites / 0 fail
- ✓ Config suite passes: `npx tsx --test tests/config-file.test.ts` — exit 0, 40 tests / 0 fail
- ✓ Judge suite passes: `npx tsx --test tests/judge.test.ts` — exit 0, 51 tests / 0 fail
- ✓ Index suite passes (Phase 3 manual substance): `npx tsx --test tests/index.test.ts` — exit 0, 29 tests / 0 fail
- ✓ Phase 1 grep gate: `grep -c "negativeKeywords" src/config-file.ts` — 5 (>= 5)
- ✓ Phase 2 grep gate: `grep -c "You are an automated evaluation filter" src/judge.ts` — 1 (was 2)
- ✓ Phase 2 grep gate: `grep -c "is never relevant" src/judge.ts` — 1
- ✓ Phase 2 grep gate: `grep -n "buildBulkMessages(ten" scripts/probe-judge.ts` — exactly one line, `247:    messages: buildBulkMessages(ten, CONFIG.keywords),` unchanged
- ✓ Phase 2 grep gate: `grep -n "import .*buildBulkMessages\|import .*buildMessages" src/judge-availability.ts` — no matches (exit 1)
- ✓ Phase 3 grep gate: `grep -c "negativeKeywords" src/judge.ts` — 19 (>= 8)
- ✓ Phase 3 grep gate: `grep -c "config.negativeKeywords" src/index.ts` — 1
- ✓ Phase 3 grep gate: `grep -n "buildBulkMessages(ten" scripts/probe-judge.ts` — exactly one line, unchanged
- ✓ No regressions detected — verified at base, not asserted: a detached-checkout run at `a493b8c` (`git checkout --detach a493b8c` + `npm test`) is red with exactly one failing test — `loads the committed config file` (`tests/config-file.test.ts:41`, the platforms deepEqual red since c56569c/a493b8c set `platforms.threads: false`). The delta repairs that test and adds 15 tests, and the validated tree passes 513/513 — nothing green at base went red, and the sole base failure is fixed. Tracked dirty set: exactly the plan's seven declared files (5 untracked workflow artifacts rode alongside; see Scope above)

### Code Review Findings

#### Matches Plan:

- `src/config-file.ts:46` — `WatcherConfig.negativeKeywords: string[]` added with its doc comment, resolved non-optional, mirroring `reasoningEffort`/`scrollRounds`
- `src/config-file.ts:58` — `"negativeKeywords"` registered in the closed `ALLOWED_KEYS` list after `candidateTerms`
- `src/config-file.ts:113`, `:123` — read through `readNegativeKeywords` and included in the returned object
- `src/config-file.ts:288-294` — `readNegativeKeywords`: `undefined` -> `[]`, else `readStringArray(value, "negativeKeywords", filePath, false)`; shape and the fail-visible throw naming path + key match the `readReasoningEffort` template exactly
- `src/judge.ts:233-241` — private `systemMessage(keywords, negativeKeywords)`; the veto append is conditional on `negativeKeywords.length > 0`; both duplicated system literals collapsed into it
- `src/judge.ts:251`, `:279` — `buildMessages` and exported `buildBulkMessages` gain the optional parameter defaulting to `[]`, so the probe's zero-edit `buildBulkMessages(ten, CONFIG.keywords)` call keeps measuring the positive-only prompt
- `src/judge.ts:702`, `:803`, `:915` — `negativeKeywords` tail-appended as `judgeBatch` param 9, `judgePost` param 8, `judgePosts` param 11 (after `blocked`), per the D4 tail-append discipline (all 41 existing positional call sites compile unchanged)
- `src/judge.ts:707`, `:805` and both pool-worker forwards — `negativeKeywords` reaches `buildBulkMessages`, `buildMessages`, the bulk worker, and the fallback worker; messages still built once outside the retry loop
- `src/judge.ts:893-901` — the `judgePosts` JSDoc reworked so `blocked` is named parameter 10 and the veto list tail-appends last
- `src/index.ts:456` — `config.negativeKeywords` passed as `judgePosts` argument 11 at the sole production call site
- `tests/config-file.test.ts:143-172` — the five-test validator matrix (absent -> `[]`, non-empty accepted, `[]` accepted, non-array rejected, blank item rejected) with the exact rejection regexes
- `tests/index.test.ts:46`, `tests/fetch-linkedin.test.ts:40` — both typed `CONFIG` literals gain `negativeKeywords: []`; `MIXED_CONFIG` inherits via spread
- `tests/judge.test.ts:707-861` — the new describe: hand-written `NO_VETO_LITERAL` plus all nine pins (five builder-level, four runtime), placed after the system-prompt pins describe
- `tests/index.test.ts:393-431` — the digest-exclusion scenario: vetoed post judged `relevant: false`, marked seen, zero matches -> heartbeat, `run` deepEqual `{ judged: 1, matches: 0, skipped: 0, saved: true }`
- Scope — the tracked dirty set is exactly the plan's declared write-set (7 files): `src/heartbeat.ts`, the digest/notify path, state files, `scripts/probe-judge.ts`, and `src/judge-availability.ts` are untouched, honoring every "What We're NOT Doing" line. `git status -uall` additionally listed 5 untracked `.rpiv/artifacts/` files (discover, research, solutions, design, plan) — the workflow's own output, non-blocking (the scope floor counts untracked paths); they were committed separately under the repo's `rpiv: … artifacts` convention
- Quarantine manifest — `.rpiv/artifacts/verdicts/scope-quarantine__*.json` globbed: no manifest exists, so there are no moved or refused entries to rule (no `--scope` verdict was provided either)

#### Deviations from Plan:

- `tests/config-file.test.ts:41-45` — the committed-config happy-path test's `platforms` assertion was rewritten outside any plan fence (Phase 1 §5 declared only the new negativeKeywords tests). Developer-directed and documented in the plan's Implement Session Notes: the assertion was red at base because commits c56569c/a493b8c set `platforms.threads: false` in `watcher.config.json` without updating the test (proven red at HEAD via a stash run). It now pins `config.platforms.linkedin === true` and accepts either `threads` boolean. Non-blocking — a legible, developer-ruled improvement over the fence it replaced, inside a declared file.
- `tests/judge.test.ts:847` — the §5 pin title reads "the 41 judgePosts call sites across the suites" where the plan's fence said "the 38 existing call sites". 41 is the measured current count (29 in `tests/judge.test.ts` + 12 in `tests/judge-rotation.test.ts`); the plan's 38 was the pre-change count (26 + 12). Comment-only class — never forces the verdict, and the shipped number is the accurate one.
- Cosmetic fence divergences with no executable effect: the `systemMessage` JSDoc (`src/judge.ts:226-232`) drops the plan's ":236 and :263" line references (the shipped text says "per-builder literals"); the new config-file test block abuts the next `it` without a separating blank line (Biome-clean). Comment/format-only class.

#### Pattern Conformance:

- ✓ `readNegativeKeywords` mirrors the optional-key validator template (`readReasoningEffort`, `readScrollRounds`): `undefined` early-return to the default, then delegate, with the fail-visible `config: <path> "<key>" ...` throw naming both path and key
- ✓ `systemMessage` is module-private (unexported), holding the convention that prompt helpers stay private; `buildBulkMessages` remains the only exported builder (F006), so the probe keeps measuring production
- ✓ Test structure matches the sibling system-prompt describe (`tests/judge.test.ts:677-700`): hand-written expected literal rather than a shared template (the discriminating-token precedent at `:317`), `mockFetch` capture of `body.messages[0].content`, `assert.equal` for byte-identity and `assert.match` for the veto sentence
- ✓ `NO_VETO_LITERAL` is written longhand instead of derived from the helper, so a helper regression cannot self-confirm — the exact discipline the precedent guards
- ✓ Config-key registration follows the `d8fc15b` template end to end: `ALLOWED_KEYS` entry + typed field + validator + test matrix + the two typed literals
- Minor observation (acceptable variation, not a deviation): the new config-file test block runs directly into the next `it` with no blank line; Biome accepts it and the suite is green

#### Potential Issues:

- Accepted, recorded 2026-11-09 (operator ruling: record-only, no code change): `scripts/probe-judge.ts:247` calls `buildBulkMessages(ten, CONFIG.keywords)` with no negatives and the plan's D5 grep gate pins that call shape. The day the operator adds `negativeKeywords` to `watcher.config.json`, production sends a longer prompt than the one `state/judge-ceilings.json` was measured on — permanently, until someone acts; that breaks the "probe-measured values are committed data" doctrine on key-add. Resolution path when the key lands: thread `config.negativeKeywords` into the probe call and re-probe (the committed ceilings must describe the prompt production sends).
- Accepted deferral: the live `npm start` vetoed-post run needs real `LLM_*`/`GMAIL_*` credentials and is the only criterion resting on a proxy — the pins prove the veto sentence reaches the prompt (`src/judge.ts:233`), not that the model obeys it. The plan left the box unchecked for the same reason; the automated digest-exclusion pin carries the substance. Run the live check when the key is added for real.

### Manual Testing Required:

Executed during this validation (offline probes; scratch lived under `.rpiv/tmp/` and was deleted after the run):

1. Committed config resolves the new key (Phase 1):
   - [x] `loadWatcherConfig("watcher.config.json")` loads without error and resolves `negativeKeywords: []` — verified: resolved value `[]`, key present on the resolved object
2. Veto prompt render (Phase 2 §1 and Phase 3 §1 manual items):
   - [x] With `["internship","outsourcing"]` the rendered system message byte-matches the Desired End State text, veto sentence between the keyword criterion and the untrusted fence — verified: exact match; order keywords < veto < fence confirmed by index comparison
3. Absent-key prompt (Phase 2 §2 manual item):
   - [x] With the key absent the rendered prompt byte-matches the positive-only text the committed ceilings describe — verified: exact match; `[]` and absent produce the same string
4. Vetoed post end to end (Phase 3 §2 manual item):
   - [x] Substance executed via the automated pin `tests/index.test.ts:393` ("digest-excludes a vetoed post") in the targeted suite run — green: the vetoed post is judged `relevant: false`, lands in `seenPostIds`, stays out of the digest, and the zero-match run fires the heartbeat
   - [ ] Live `npm start` run with a real vetoed post — NOT executed: needs real `LLM_*`/`GMAIL_*` credentials, sends a real digest, and writes committed state. The plan left this box unchecked for the same reason; the automated pin above carries the substance

### Recommendations:

- Ready to commit — implementation is complete and validated.
