---
template_version: 1
date: 2026-10-30T18:17:33+0700
author: Yogiswara Utama
commit: 395ee63
branch: main
repository: loker-watcher
topic: "Validation of Tech-Debt Audit Remediation (F001-F024)"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md"
tags: [validation, judge, heartbeat, workflow, docs, refactor, deps, hygiene, tests]
last_updated: 2026-10-30T18:17:33+0700
---

## Validation Report: Tech-Debt Audit Remediation (F001-F024)

### Implementation Status

- ✓ Phase 1: F024 heartbeat knob mapping — Fully implemented
- ✓ Phase 2: F013 heartbeat mixed-case fix — Fully implemented
- ✓ Phase 3: F006+F022 prompt copy — Fully implemented
- ✓ Phase 4: F001-F005 docs sync — Fully implemented
- ✓ Phase 5: F017 nodemailer 6 -> 10 — Fully implemented
- ✓ Phase 6: F010 judge split — Fully implemented (one automated criterion superseded by Phase 9 — see Deviation 3)
- ✓ Phase 7: F008 dispatchLlmCall core — Fully implemented (byte-identity caveat — see Deviation 4)
- ✓ Phase 8: F007+F009 runPool + sleep dedupe — Fully implemented
- ✓ Phase 9: F015 test split — Fully implemented
- ✓ Phase 10: post-refactor docs re-sync — Fully implemented
- ✓ Phase 11: F020+F021 watch.yml cache + rebase/retry — Fully implemented
- ✓ Phase 12: F023 WAIT_BUDGET_MS shrink — Fully implemented
- ✓ Phase 13: F014 authenticated-walk unit tests — Fully implemented
- ✓ Phase 14: F019 session-dir cleanup — Fully implemented
- ✓ Phase 15: F016 hooks lint path + stdin test — Fully implemented
- ✓ Phase 16: F011+F012 untrack scratch + binary — Fully implemented

All 16 phases verify against the working tree. The verdict is driven by two findings outside the phase criteria: an unmet Desired End State measurement and untracked working-tree residue. Both are recorded under Deviations from Plan; neither is a runnable failing command, so no `blockers:` entries are attached (the remediation arm must not act on these mechanically — see Recommendations).

### Automated Verification Results

- ✓ Whole-plan gate: `npm run typecheck && npm run lint && npm test` — exit 0 / 0 / 0; 195 tests, 48 suites, 0 fail, 0 skipped (offline, deterministic)
- ✓ Phase criteria sweep: ~90 grep/ls/git criteria across the 16 phases — all at their pinned values except the two lines below
- ✓ Phase 5: `npm ls nodemailer` — single tree entry nodemailer@10.3.1; `npm audit` — "found 0 vulnerabilities", 0 nodemailer mentions
- ✓ Phase 16: check-ignore sandbox — .rpiv/tmp/x, slice3-recon/y, .codebase-memory/graph.db.zst all ignored (exit 0); .rpiv/artifacts/designs/x.md not ignored (exit 1); `git ls-files .rpiv/tmp .rpiv/tmp-config-backup.json .codebase-memory/graph.db.zst` empty
- ✓ Phase 15 live hook check: deny path exit 2 ("Blocked by gate-destructive hook: recursive force delete"), fail-open exit 0; gate-destructive.js bytes untouched vs 395ee63
- ✓ No regressions detected: 62 pre-split judge tests all present and green (0 lost, 0 shrunk), 6 pre-F014 fetch cases all present and green, heartbeat suite green with the new mixed-case case
- ✗ Desired End State: `wc -l src/judge.ts` — 828 lines vs the pinned "under ~500"
- ✗ Phase 6 (1 of 3 greps in "Three-way split"): `grep -c "from \"../src/judge-parse.js\"" tests/judge.test.ts` reads 0 on the final tree (superseded by Phase 9 — see Deviation 3)

### Code Review Findings

#### Matches Plan:

- .github/workflows/watch.yml:88-89 — Run watcher env block byte-matches the Desired End State YAML: F018 guard intact (`JUDGE_CONCURRENCY: "4"` + probe run-id comment), `HEARTBEAT_ENABLED` via `vars.` (F024)
- src/judge.ts:107 — `WAIT_BUDGET_MS = 180_000`; `grep -rnE '300_000|300s|5-minute'` over src/ tests/ .github/ AGENTS.md README.md .rpiv/guidance/ = 0 hits (F023 fully re-synced)
- src/judge-rotation.ts + src/judge-parse.ts — 14/14 moved symbols byte-identical to `git show 395ee63:src/judge.ts` (11 rotation + 3 parse; only `export` keywords, module headers, and the type-only import differ — D5 holds: `import type ... from "./judge.js"`)
- tests split — old judge.test.ts had 62 `it`s; union of the three new suites has 64: 0 lost, 0 shrunk, 2 new (the F022 injection-line cases); describes 8/2/2; helpers live once in tests/judge-helpers.ts (6 exports, 0 leaks); freshState canonical in judge-rotation + mirror in judge.test.ts
- src/judge.ts dispatcher — `await fetchFn(` ×1, `dispatchLlmCall` ×1, `response_format` ×1 (batch-only), console.warn ×14, skip-tails ×3, 429-cooling ×2; exhaustion terminal returned outside the core's try (D6 comment at :398-402) and mapped at wrapper level: judgeBatch -> `{status: "exhausted"}` (:563-565), judgePost throws :644, judgePosts throws after each join (:725, :803) — drain-then-throw intact
- src/pool.ts:51 — the slot-array idiom lives exactly once; `runPool` 2+2 call sites; `setTimeout(resolve` ×1 (judge.ts:112); fetch-threads imports judge's sleep, defines none
- scripts/probe-judge.ts — zero edits from the split (0 hits for judge-rotation/judge-parse; D5) and the drifted `bulkMessages` copy is gone with `buildBulkMessages` imported (F006)
- .github/workflows/watch.yml — cache step once (actions/cache@v4, hashFiles('package-lock.json') key, install unconditional at :85), `git pull --rebase origin main` ×2 + explicit `exit 1` ×1 (F020/F021); guidance synced (rebase ×2, ms-playwright ×3, retry-phrase ×3)
- .gitignore — the three entries verbatim incl. slice*-recon/; D8 note in .rpiv/guidance/architecture.md with Slice 4 phrasing preserved
- Docs numbers agree with src: AGENTS.md:38-39 (60s cooldown, shared 180s park), README.md:26 ("3-minute wait budget"), .rpiv/guidance/src/architecture.md:74-82 (60s/180s/500ms) — the three surfaces state the same numbers as the constants
- Floor greps all 0: run-sticky / rotateOnRateLimit / no wait / default 72 / continue-on-error / accounts[0] / unmapped-knob claims; `grep -c "actually rotate" README.md` = 1 (PAT line intact)

#### Deviations from Plan:

1. **BLOCKING (plan-level — needs /skill:revise, not code edits): Desired End State "wc -l src/judge.ts # under ~500" reads 828.** The target was inherited from the FRD ("judge.ts split under ~500 LOC", discover :27/:79) but no locked slice extracts enough code to reach it: the split moved 269 lines out of a 921-line file (828 + 167 rotation + 102 parse), and Phases 7-8 grew the residual while shrinking fetch-threads. The phase-level criteria only ask to *record* the number (Phase 6/8 manuals), so every phase passes while the plan's own done-definition fails. This criterion is unachievable as written by the plan's own phase set — the same class Step 2.6 rules non-blocking, except the file is inside the run's delta, so it is reported as a plan deviation requiring revision: re-pin the target with the measured numbers (921 -> 828, -10% plus 269 lines moved to two focused modules) or add extraction scope.
2. **BLOCKING (cleanup before commit, ~5 minutes): untracked working-tree residue at the repo root.** (a) `slice13-followup.mjs` — design-phase generator scratch; repo doctrine says scratch lives under .rpiv/tmp/ or nowhere; delete it. (b) `.rpiv/tmp-config-backup.json` — the on-disk copy left behind by the Phase 16 untrack; not covered by any .gitignore entry, so it re-pollutes git status; `watcher.config.json` is present and clean, so the backup is deletable (or add it to .gitignore if it must stay). (c) `TECH_DEBT_AUDIT.md` — untracked input report the plan References; needs a decision: commit it as the audit record or move it under .rpiv/artifacts/.
3. **Non-blocking: Phase 6's "Three-way split" import criterion contradicts Phase 9 and cannot hold on the final tree.** Phase 6 pins `judge-parse.js` imports in tests/judge.test.ts = 1; Phase 9 pins `judge-parse` references = 0 (the parse describes move out). Both cannot be true of the same file; the final tree satisfies the later, governing Phase 9 exactly (describes=8, moved-describes=0). Criterion ruled not-met-as-written, superseded, non-blocking — the plan, not the implementation, deviates. Fold the stale grep into the revise pass.
4. **Non-blocking: D2 "byte-identical warn literals" holds at rendered-output level for all 11 dispatcher warns; only source-level interpolation variable names changed.** The dispatcher refactor renamed variables (attemptIndex + 1 -> accountNo, attempt + 1 -> attemptNo, response.status -> status, delay -> delayMs, msg -> message); the core passes the identical values (judge.ts:404, :420, :424, :436-441, :453), and the old post-ladder loop was already 1-based (`for attempt = 1; attempt <= 2`), so every rendered string is unchanged — the mechanical render-check 11/11 is confirmed correct. CORRECTED during the revise pass (2026-10-30): an earlier version of this deviation claimed the four post-ladder warns renumbered from 0-based to 1-based rendering; that was an unverified assumption about the old loop bounds — `git show 395ee63:src/judge.ts` disproves it. No test pins the templates; suite green. The revise pass re-pins D2 to rendered-text identity.
5. **Non-blocking: Phase 4's manual criterion cites "300s budget"** — superseded by Phase 12's 180s shrink, which re-synced all three doc surfaces; verified consistent at 180s everywhere (see Matches Plan). No action.

#### Pattern Conformance:

- ✓ Imports, ESM node: prefixes, strict-flag-friendly typing, tagged-error pattern (name constant + factory + type guard), offline node:test suites, atomic state writes, and fail-visible errors all follow the established codebase conventions; the new modules read like the old judge.ts because they are its verbatim extractions
- Minor observation (acceptable variation, not a deviation): tests/judge-rotation.test.ts uses ambient `Date.now()` in five places (:166, :184, :188, :194, :347) while .rpiv/guidance/tests/architecture.md:66-67 says "The one Date.now() exception". The imprecision is carried verbatim from the pre-split file (the elapsed-time assertions moved, they were not added); comment-only, no executable impact.

### Manual Testing Required:

Verified during this validation run (was manual in the plan; executable locally, so executed here):

1. Phase 4:
   - [x] Numbers side-by-side: AGENTS.md judge bullet, README pipeline step, guidance/src rotation section vs src constants — consistent at 60s cooldown / 180s budget / 500ms jitter (Phase 4's "300s" superseded by Phase 12)
   - [x] Surviving "rotat" hits audited: 11 hits outside guidance/tests, every one names the live cooldown+park mechanism, the judge-rotation module, or the README PAT rotation; none describes the deleted sticky-pointer model
2. Phase 6:
   - [x] Moved bodies verbatim: scripted block-by-block extraction vs 395ee63 — 14/14 byte-identical
   - [x] No runtime cycle: judge-rotation.ts imports "./judge.js" type-only
   - [x] wc -l recorded: 828 (post-split and post-cluster)
3. Phase 7:
   - [x] Warn side-by-side vs 395ee63 executed — outcome recorded as Deviation 4 (rendered byte-identical 11/11; source-level variable renames only — corrected during the revise pass, see Deviation 4)
   - [x] Terminal mapping: judgeBatch returns {status: "exhausted"}; judgePost throws outside the core's try (D6)
4. Phase 8:
   - [x] Fallback pool reassembles by the carried index: `slots[item.slot] = verdict` (judge.ts:786-788), never the claim index
   - [x] Drain-then-throw: both exhaustion throws sit caller-side after the runPool joins (:725, :803)
   - [x] fetch-threads workers reassemble into index-addressed arrays and stay total (join-never-rejects) at both runPool sites (:206, :287); behavior pins (width 4 peak, min(width, work), starvation order) green
5. Phase 9:
   - [x] Moved test blocks: all 62 old its present with identical titles (0 lost, 0 shrunk); residual env/pipeline/reasoning_effort/F022 describes intact
6. Phase 10:
   - [x] Coverage map rows match ls tests/ (every judge-cluster row names a real file; judge-helpers.ts marked no-test)
   - [x] Date.now framing names the moved test's real title ("cools to account 2 on the first 429 with no backoff wait", tests/judge-rotation.test.ts:360)
   - [x] AGENTS.md bullets match the new modules' docstrings
7. Phase 12:
   - [x] The two evidence comments agree number-for-number: 480s cap, 60-100s setup prologue, 71s fetch worst case, 60s abort tail, ~249-289s headroom, 180s parks, ~1-2 min alarm margin (src/judge.ts:99-107 vs watch.yml:48-54)
8. Phase 13:
   - [x] Pre-F014 cases untouched: all 6 old titles present in the 14-case suite; suite runs offline (no Playwright load)
   - [x] Console spies call-through: scroll/dry output still prints while the suite runs (observed in suite output)
9. Phase 15:
   - [x] Deny path live: `echo '{"tool_input":{"command":"rm -rf /"}}' | node scripts/hooks/gate-destructive.js` -> exit 2
   - [x] Fail-open live: `echo 'not json' | node scripts/hooks/gate-destructive.js` -> exit 0
   - [x] Hook bytes untouched: `git diff --quiet 395ee63 -- scripts/hooks/gate-destructive.js` clean
10. Phase 16:
   - [x] .codebase-memory/graph.db.zst still on disk (961,792 bytes) after the staged untrack; the graph serves this session
   - [x] sliceNN-recon/ and .rpiv/tmp paths ignored (check-ignore sandbox exit 0); artifacts paths not ignored (exit 1)

Still open — requires pushed refs, live credentials, or landed commits (the plan's live-dispatch set):

1. Phase 1: dispatch with repo variable HEARTBEAT_ENABLED=false logs "heartbeat: disabled by HEARTBEAT_ENABLED" and sends no email; dispatch without the variable still sends the zero-match heartbeat
2. Phase 2: a mixed-case/padded candidateTerms entry matches lowercase post text in the next real zero-match run
3. Phase 3: probe live against the endpoint with the exact production prompt (on Windows a local exit 127 is the known libuv quirk, not a regression)
4. Phase 5: optional `npm start` SMTP handshake through nodemailer 10 with real GMAIL_* credentials
5. Phase 11: first dispatch shows a cache miss then a hit; a dev push between checkout and commit-back rebases and pushes instead of failing
6. Phase 12: commit atomicity — when committing, keep the envelope-comment rewrite and the WAIT_BUDGET_MS change in one commit, then `git log --oneline -- src/judge.ts .github/workflows/watch.yml` confirms it; live worst-case dispatch fires the alarm inside the 8-minute envelope
7. Phase 14: real authenticated run leaves no loker-session-* dir (success path and throw path)
8. Phase 16: after the untrack commits land, `git log --oneline -- .codebase-memory/graph.db.zst` shows the untrack as the last touch

### Recommendations:

- Run /skill:revise on the plan before any code follow-up: reconcile the Desired End State wc-l target (Deviation 1), re-pin D2 to rendered-string identity and dispose of the attempt renumbering explicitly (Deviation 4), and delete the superseded Phase 6 grep (Deviation 3). Then re-run /skill:validate.
- Before /skill:commit: delete slice13-followup.mjs and .rpiv/tmp-config-backup.json (watcher.config.json verified present and clean), and decide TECH_DEBT_AUDIT.md (commit or relocate under .rpiv/artifacts/) — Deviation 2.
- When committing: land the judge cluster as one commit unit per the plan's Overview, and keep Phase 12's envelope-comment hunk in the same commit as the WAIT_BUDGET_MS change (the plan's own atomicity note — the only commit-time gate still open).
