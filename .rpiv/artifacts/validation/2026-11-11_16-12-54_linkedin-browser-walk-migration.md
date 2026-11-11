---
template_version: 1
date: 2026-11-11T16:12:54+0700
author: Yogiswara Utama
commit: 1cd0f47
branch: ukind/feature-migrate-using-browser-approach
repository: feature-migrate-using-browser-approach
topic: "Validation of LinkedIn browser-walk migration"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md"
tags: [validation, plan, linkedin-fetch, linkedin-parser, browser-walk, flight-parser, fetch-linkedin, probe-linkedin]
last_updated: 2026-11-11T16:12:54+0700
---

## Validation Report: LinkedIn browser-walk migration

### Implementation Status

- ✓ Phase 1: Parser core — Fully implemented. `src/linkedin-parser.ts` is new, pure, and byte-identical to the locked fence (`.rpiv/tmp/verify7/src/linkedin-parser.ts`).
- ✓ Phase 2: Parser suite — Fully implemented. 17 tests, 0 failures.
- ✓ Phase 3: Seam growth — Fully implemented. `PageLike.url?()` at `src/fetch-threads.ts:97`, both adapters supply it, `HALT_CHECKPOINT_REASON` appended to `src/linkedin-behavior.ts`.
- ✓ Phase 4: Walk swap — Fully implemented. `src/linkedin-fetch.ts` is the browser walk, byte-identical to the locked fence. 25 walk tests, 0 failures.
- ✓ Phase 5: Tick rewire + budget deletion — Fully implemented. Budget machine gone; 29 tick tests, 10 behavior tests, 3 reset tests, 0 failures.
- ✓ Phase 6: Probe rewrite — Fully implemented. `scripts/probe-linkedin.ts` drives the production walk read-only with the full exit vocabulary.
- ✓ Phase 7: Deletion sweep — Fully implemented. All five paths absent; `ENV_NAMES` carries six names; `LinkedInStorageState` rename landed.
- ✓ Phase 8: Doc sweep + baseline gates — Fully implemented. README, `AGENTS.md`, and the five guidance files read coherently. The `AGENTS.md` duplication found during this validation was repaired in-session (see Deviations from Plan).

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — 0 errors.
- ✓ Lint: `npm run lint` — biome clean, 62 files checked, no fixes applied.
- ✓ Full suite: `npm test` — 554 tests, 554 pass, 0 fail.
- ✓ Parser suite: `npx tsx --test tests/linkedin-parser.test.ts` — 17 tests, 0 failures (plan: 17).
- ✓ Behavior suite: `npx tsx --test tests/linkedin-behavior.test.ts` — 10 tests, 0 failures (plan Phase 5: 10).
- ✓ Walk suite: `npx tsx --test tests/linkedin-fetch.test.ts` — 25 tests, 0 failures (plan: 25).
- ✓ Tick suite: `npx tsx --test tests/fetch-linkedin.test.ts` — 29 tests, 0 failures (plan: 29).
- ✓ Reset suite: `npx tsx --test tests/reset-linkedin.test.ts` — 3 tests, 0 failures (plan: 3).
- ✓ Env-file suite: `npx tsx --test tests/env-file.test.ts` — 8 tests, 0 failures.
- ✓ Locked env/budget gate: `grep -rnE "LINKEDIN_TRANSPORT|CURL_IMPERSONATE_BIN|DAILY_GET_BUDGET|HALT_BUDGET_REASON" src/ scripts/ tests/ README.md AGENTS.md` — no hits.
- ✓ Deleted-module sweep: `grep -rniE "voyager|setup[-_]?curl|curl-impersonate" README.md AGENTS.md .rpiv/guidance/` — no hits.
- ✓ Cadence truthful: `grep -rnE "10-min(ute)? sleep|tick every 10 min|600s sleep" README.md AGENTS.md .rpiv/guidance/` — no hits.
- ✓ Voyager residue in code: `grep -rni "voyager" src scripts` — no hits.
- ✓ Five deleted paths: all absent.
- ✓ No static Playwright import: `grep -rnE "from ['\"]playwright['\"]" src/ tests/ scripts/` — no hits.
- ✓ Transport seam gone: `grep -nE "VoyagerGet|resolveLinkedInTransport|classifyFault|createCurlTransport|createPlaywrightTransport|PAGE_SIZE" src/linkedin-fetch.ts` — no hits.
- ✓ Tick seam gone: `grep -nE "VoyagerGet|resolveLinkedInTransport|\.dispose\(|type Transport" scripts/fetch-linkedin.ts` — no hits.
- ✓ Probe residue gone: `grep -nE "voyager|resolveLinkedInTransport|parseSearchResponse|buildSearchUrl|LINKEDIN_TRANSPORT" scripts/probe-linkedin.ts` — no hits.
- ✓ Env-name residue gone: `grep -rn "ENV_NAMES.linkedinTransport|ENV_NAMES.curlImpersonateBin" src scripts tests` — no hits.
- ✓ No regressions detected — base 1cd0f47 measured: 593 tests / 593 pass / 0 fail; delta -> 554/554/0 (39 fewer tests: the two deleted suites plus the replaced transport suites).

### Code Review Findings

#### Matches Plan:

- `src/linkedin-parser.ts` — byte-identical to the locked Phase 1 fence. Timestamp-zip pairing, guarded `mintPost`, longest-text-per-row rule, and the one-line pairing oracle all present.
- `src/linkedin-fetch.ts` — byte-identical to the locked Phase 4 fence. FR-5 Fisher-Yates shuffle with original-index reassembly, two drain checks, join priority halt > leg-dead > all-faulted, stamp-at-slot-write, per-surface OK log.
- `src/linkedin-fetch.ts:520-560` — pacing re-seated on navigations: one `gate.wait()` per surface before its `goto`; `makePacingGate` reserves the slot before the sleep.
- `src/linkedin-fetch.ts:432-437, 470, 487` — checkpoint detector reads `page.url()` at exactly three sites: post-goto, every liveness poll tick, post-click-settle.
- `src/linkedin-fetch.ts:118` — `LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS = 30_000`; no flagship-web 200 inside the window throws the tagged `LegDeadError`.
- `src/linkedin-fetch.ts:441` — first-wins urn dedupe (`if (!posts.has(post.id))`).
- `src/linkedin-fetch.ts:508` — empty surface list returns before `contextFactory`, so no browser launches.
- `src/linkedin-fetch.ts:566-568` — `page.close()` in the walk's `finally`, `context.close()` in the walk's `finally`.
- `src/fetch-threads.ts:97` — `url?(): string` is optional; `src/fetch-threads.ts:150` and `src/linkedin-fetch.ts:305` both supply it.
- `src/linkedin-behavior.ts:88-94` — `HALT_CHECKPOINT_REASON` names the one remedy (a re-harvest).
- `src/email.ts:347-362` — `buildHaltAlarmText` names no deleted file and no 429; it names the latch flag, `reset-linkedin`, and `login-linkedin`.
- `src/config.ts:14-21` — `ENV_NAMES` carries exactly six names.
- `src/linkedin-session.ts:173,185` — `LinkedInStorageState` / `toStorageState`; no voyager residue.
- `scripts/fetch-linkedin.ts:325-345` — preflight band reads window -> latch -> checkout guard; the budget step and its ledger are gone.
- `scripts/fetch-linkedin.ts:95, 371-372` — `deps.contextFactory` stays optional and reaches `fetchLinkedInPosts` unmodified; `config.scrollRounds` rides as the click bound.
- `tests/fetch-linkedin.test.ts:740-765` — the threading test pins `contextFactory.clicks()` to `[1, 2, 3]` at `scrollRounds: 3`.
- `scripts/probe-linkedin.ts:1-90` — read-only walk, first configured surface, `CONFIG.scrollRounds` as the click bound, no payload write, no push, no latch, no episode marker. Exit vocabulary matches the gate table: `probe: HALT`, `probe: LEG DEAD`, `probe: FAILED`, fewer than 2 posts, `probe: all checks passed`. The operator ritual stands in the header.
- `tests/linkedin-parser.test.ts:182` — the `voyager/api` negative case survives, as the plan requires.
- `package.json` — no `setup-curl` script; the lint and format globs no longer name the deleted script.
- `.gitignore:13` — `state/linkedin-get-budget.json` kept (orphaned by design).
- `.rpiv/tmp/verify7/src/{linkedin-parser,linkedin-fetch,linkedin-behavior}.ts` — `diff -q` reports no difference against the working tree, so the locked fences landed byte-exact.

#### Deviations from Plan:

- `AGENTS.md` — the Phase 8 doc sweep corrupted this file. Two defects, both doc-only, both REPAIRED during this validation:
  1. The document is duplicated. Lines 1-63 are the correct new head, then line 64 ends mid-bullet with `filter, the row splitter, the \`# AGENTS.md`, and the whole document restarts at line 68. The file is 218 lines; the base was 156.
  2. The parser bullet is truncated in both copies. Line 63-64 stops at "the response-URL / filter, the row splitter, the"; line 126 starts mid-word at `-ref commentary-text walker, the`.
  The Phase 8 criterion "Edit-set integrity: every find-block matches its file exactly once before the replace applies (51 finds, seven files)" was marked `[x]` but was violated for this file. Repair applied: the `src/linkedin-parser.ts` bullet was rebuilt and the duplicate block deleted. The file is now 156 lines, one `# AGENTS.md` heading, six sections, no truncation. All three Phase 8 doc gates re-run clean.
- `AGENTS.md` was the only corrupted file. README.md and all five `.rpiv/guidance/` files carry a single top-level heading each and read coherently end-to-end.

#### Pattern Conformance:

- ✓ `src/linkedin-parser.ts` follows the pure-parser convention: no I/O, no Playwright, `console.warn` as the sanctioned offline oracle, injected nothing.
- ✓ `src/linkedin-fetch.ts` keeps the tagged-error idiom from `src/judge-rotation.ts` (name constant + factory + type guard) for all three tags.
- ✓ `scripts/probe-linkedin.ts` follows the PC-script shape: top-level await, one catch-all wrapper, `process.exit(1)` per gate.
- ✓ Test doubles stay structural (`PageLike` / `ContextLike`), so the offline suite never loads Playwright.
- Minor observation: `src/linkedin-fetch.ts` duplicates ~120 lines of context-factory mechanics from `src/fetch-threads.ts`. The plan and the design both ratify this ("Structural layer duplicated, not shared"), so it is acceptable variation, not a deviation.

#### Potential Issues:

- `AGENTS.md` — the corruption above was the one defect in the deliverable. It is the file every agent reads first, so a duplicated and truncated document would have cost context on every future session. Repaired in-session; no open issue remains.
- `src/linkedin-fetch.ts:118` — headless detectability is unmeasured. The design's Verification Notes already flag this and expect a retune commit after the first live rehearsal. Not a defect; a known open measurement.

### Manual Testing Required:

1. Live rehearsal (the only checks that need a real LinkedIn session):
   - [ ] Phase 1: run the parser against the real capture in `.rpiv/tmp/verify1/` — 3 posts minted, Full-Stack <-> ...655298 (22:11:39.858Z), Chef <-> ...919681 (22:16:28.628Z), PCB <-> ...094017 (22:18:16.583Z).
   - [ ] Phase 1: `buildContentSearchUrl("hiring indonesia")` reproduces the live URL byte-for-byte.
   - [ ] Phase 2: the three pinned epochs still match the rendered age labels on the live page.
   - [ ] Phase 2: during the rehearsal, the pairing-oracle line names the same id <-> text pairs the page renders. This is the only mis-pair detector that exists.
   - [ ] Phase 6: `npm run probe-linkedin` twice, at least 6h apart, with stored cookies. Expect exit 0 and `probe: all checks passed`.
   - [ ] Phase 6: confirm the probe writes nothing — no payload, no push, no latch, no episode marker.
2. Doc read-through:
   - [x] Re-read `AGENTS.md` after the fix and confirm one copy, one parser bullet, no truncation. Verified: 156 lines, one heading, parser bullet complete at lines 63-69.

### Recommendations:

- `AGENTS.md` is repaired — no action left there.
- Run the live rehearsal before trusting the loop. The plan's Phase 1, 2, and 6 manual items all depend on it, and headless detectability is still unmeasured.
- Ready to commit — every automated gate passes, the code matches the locked fences byte-for-byte, and the one doc defect is fixed.
