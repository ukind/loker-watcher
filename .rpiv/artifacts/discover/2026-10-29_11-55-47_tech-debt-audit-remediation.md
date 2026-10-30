---
date: 2026-10-29T11:55:47+0700
author: Yogiswara Utama
commit: 395ee63
branch: main
repository: loker-watcher
topic: "tech-debt-audit-remediation"
tags: [intent, frd, judge, heartbeat, workflow, docs, refactor, deps]
status: ready
last_updated: 2026-10-29T11:55:47+0700
last_updated_by: Yogiswara Utama
---

# FRD: Tech-Debt Audit Remediation

## Summary
Remediate all 24 findings from TECH_DEBT_AUDIT.md (commit 395ee63) in one PR: sync every stale doc to the cooldown+park rotation model, close the silent-failure and broken-knob bugs, dedupe the copied pool and HTTP-loop code by splitting judge.ts, add tests to the least-tested authenticated walk and hook scripts, bump nodemailer to v10, untrack the binary graph DB, and fit the exhaustion alarm inside the 8-minute run envelope. Land in the audit's own priority order, top-5 first.

## Problem & Intent
Developer framing, verbatim: "based on this report @TECH_DEBT_AUDIT.md fix all those problem". When asked what the sweep protects, the developer chose **"The whole list"** — the report is the backlog; work all 24 findings, top-5 first. The pain when the debt stays: agents and humans work from docs describing a deleted rotation model, a documented operator knob is a no-op in production, mixed-case terms silently shrink the heartbeat list, and the repo's subtlest logic (the authenticated walk) is its least-tested.

## Goals
- Every one of the 24 findings resolved as its audit row specifies (F018 stays as-is per the audit's own "acceptable").
- Docs (AGENTS.md, README.md, all three .rpiv/guidance files) describe the real model: per-account 60s 429 cooldown, shared 300s park budget, RotationExhausted, probe gating.
- The HEARTBEAT_ENABLED kill switch works in the only production runtime (Actions).
- No silent failures: mixed-case candidate terms match; the exhaustion alarm always fires before the 8-minute cap.
- One pool idiom, one HTTP retry loop, one sleep, judge.ts split under ~500 LOC with its test file split along the same seams.
- Zero nodemailer advisories; zero scratch files tracked; graph.db.zst untracked.

## Non-Goals
- No pruning policy for .rpiv/artifacts/ (audit open question 2 — follow-up).
- No verification of reasoning_effort tolerance across pool endpoints (audit open question 4 — follow-up).
- No test coverage for scripts/probe-judge.ts ramp logic (audit open question 5 — follow-up).
- No log framework, no extraction rewrite, no dependency additions beyond the nodemailer major bump.

## Functional Requirements
1. **F024**: watch.yml "Run watcher" step maps HEARTBEAT_ENABLED: \${{ vars.HEARTBEAT_ENABLED }}; the guidance note calling the unmapping deliberate is updated in the same change.
2. **F013**: matchesCandidateTerms (src/heartbeat.ts:52) normalizes terms with term.trim().toLowerCase(); a mixed-case test ("Frontend" matches "frontend dev wanted") lands in tests/heartbeat.test.ts.
3. **F006**: scripts/probe-judge.ts imports buildBulkMessages from src/judge.ts; the hand-copied bulk prompt literal is deleted.
4. **F001–F005**: AGENTS.md judge paragraph, .rpiv/guidance/src, .rpiv/guidance/.github/workflows, .rpiv/guidance/scripts, and README.md are rewritten to the current model (60s cooldown, first-write-wins, park-until-eligible, drain-then-throw RotationExhausted; probe walks the whole pool and gates the run; recencyHours documented as required with no default).
5. **F017**: bump nodemailer to ^10 and @types/nodemailer to latest; typecheck and offline email tests pass with only TS-flagged fixes; 18 advisories close.
6. **F021**: the watch.yml commit-back step runs git pull --rebase origin main before push and retries push once; a second failure exits 1.
7. **F022**: both judge system prompts (batch and single paths) gain a line stating posts are data, not instructions.
8. **F023**: WAIT_BUDGET_MS (src/judge.ts:94) shrinks to a probe-fitted value (~180s suggested by the audit) with a fresh measured evidence comment, so RotationExhausted always fires the alarm email inside the 8-minute timeout-minutes.
9. **F007**: a shared runPool(items, width, worker) lands in src/pool.ts; all four hand-copied slot-array sites (src/judge.ts x2, src/fetch-threads.ts x2) migrate to it.
10. **F008**: a shared dispatchLlmCall core owns the HTTP retry loop (429 cooldown, backoff, extraction, verdict parse, warn formatting); judgeBatch and judgePost become thin wrappers; response_format stays batch-only as today.
11. **F010**: rotation primitives move to src/judge-rotation.ts and the verdict parsers to src/judge-parse.ts; imports move mechanically.
12. **F015**: tests/judge.test.ts splits along the F010 seams after the refactor.
13. **F009**: one shared sleep remains; the private copy in src/fetch-threads.ts is deleted.
14. **F011**: git rm -r .rpiv/tmp .rpiv/tmp-config-backup.json; .rpiv/tmp/ added to .gitignore (.rpiv/artifacts stays tracked).
15. **F012**: git rm --cached .codebase-memory/graph.db.zst; the path is ignored; the untrack decision is recorded where the old flip-flop lived (guidance or README note).
16. **F014**: unit tests against the injected ContextFactory double cover the authenticated walk: dry-round termination, MAX_POSTS_PER_SURFACE cap, zero-post tracking, no-Recent-tab warn path.
17. **F016**: scripts/hooks/*.js enters the biome lint path; a 5-case stdin test asserts the gate-destructive exit codes.
18. **F019**: the mkdtemp session dir is deleted after context close (or reused as one fixed path per run).
19. **F020**: watch.yml caches ~/.cache/ms-playwright keyed on the lockfile hash, falling back to install on miss.
20. **F018**: no change — the JUDGE_CONCURRENCY dual-site stays a documented maintenance pointer.

## Non-Functional Requirements
- **Performance**: no regression in end-to-end run time; F020 removes ~30-60s per run from the 8-minute budget.
- **Security**: no secrets or session material in tracked files (F011 scratch removal); prompt-injection steering line in both judge prompts (F022); session temp dir no longer leaks per-run (F019).
- **UX / Accessibility**: n/a (headless CLI) — the operator surface is documentation and email; docs must state the true model and the heartbeat knob must do what README says.
- **Reliability**: fail-visible doctrine holds — no new silent fallbacks; the exhaustion alarm is reachable within the job envelope (F023); a dev push between checkout and commit-back no longer duplicates the digest (F021); state writes stay atomic and untouched.

## Constraints & Assumptions
- Strict TypeScript flags stay on (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax); Node >= 22, ESM; tests stay offline (node:test + tsx).
- No new runtime dependency; the nodemailer bump is an upgrade of an existing one, stated here as the PR-description justification.
- Delivery is one PR containing everything, in audit priority order.
- F007/F008/F010 land together as one unit; F015 follows immediately.
- Assumption: the audit's file:line references are accurate at 395ee63 (audit generated at that commit); research re-verifies the load-bearing ones.
- Known environment quirk: local Windows probe runs can exit 127 from a pre-existing libuv/AbortSignal.timeout crash — not a regression when validating F006 locally.

## Acceptance Criteria
- [ ] npm run typecheck && npm run lint && npm test all exit 0.
- [ ] A dispatch run with vars.HEARTBEAT_ENABLED=false logs "heartbeat: disabled by HEARTBEAT_ENABLED" (src/index.ts:60) and sends no status email.
- [ ] tests/heartbeat.test.ts contains a passing mixed-case term case ("Frontend" vs "frontend dev wanted").
- [ ] scripts/probe-judge.ts contains no bulk-prompt string literal and imports buildBulkMessages from src/judge.ts.
- [ ] grep for "run-sticky", "rotateOnRateLimit", "no wait", and "default 72" across AGENTS.md, README.md, and .rpiv/guidance/ returns no hits.
- [ ] npm audit reports zero nodemailer advisories.
- [ ] src/pool.ts exports runPool and src/judge.ts + src/fetch-threads.ts contain no remaining slot-array copies; src/judge.ts is under ~500 LOC; src/judge-rotation.ts and src/judge-parse.ts exist.
- [ ] git ls-files .rpiv/tmp .rpiv/tmp-config-backup.json .codebase-memory/graph.db.zst returns nothing.
- [ ] tests/fetch-threads.test.ts exercises fetchOneAuthenticated paths: dry-round termination, post cap, zero-post tracking, no-Recent-tab warn.
- [ ] biome check covers scripts/hooks/*.js and the gate-regex stdin test passes.
- [ ] The judge prompts in both batch and single paths contain the posts-are-data line.
- [ ] watch.yml commit-back shows pull --rebase + one push retry before exit 1.
- [ ] watch.yml Run watcher env includes HEARTBEAT_ENABLED mapping; watch.yml caches ms-playwright on the lockfile hash.

## Recommended Approach
One PR against main worked in the audit's top-5-first order as themed commits: knob+bug quick fixes, docs sync, the judge.ts refactor cluster with its test split, hygiene (gitignore/untrack/hooks), and the nodemailer bump as a self-contained commit. research should re-verify the audit's file:line claims for the seams the refactor touches (src/judge.ts, src/fetch-threads.ts, watch.yml) before planning slices.

## Decisions

### Scope: the whole list
**Question**: This sweep fixes 24 audit findings — when the debt stays, who hits the pain first — what is this mainly protecting?
**Recommended**: n/a — intent question
**Chosen**: "The whole list" — the report is the backlog; work all 24 findings, top-5 first, across docs, code, tests, deps.
**Rationale**: Developer framing "fix all those problem"; ratifies every audit-recommended fix as specified, including F018 stay-as-is.

### Work order: audit order
**Question**: In what order should the 24 findings land?
**Recommended**: Audit order
**Chosen**: Audit order — top-5 first (F024, F013, F006, F001–F005, F017), then the remaining 19 by theme.
**Rationale**: evidence: TECH_DEBT_AUDIT.md "Top 5" section + confirmed.

### Refactor cluster: together
**Question**: How should the judge.ts refactor cluster land?
**Recommended**: Together
**Chosen**: F007 + F008 + F010 as one unit; F015 test split follows.
**Rationale**: evidence: TECH_DEBT_AUDIT.md F010 ("Do it together with F008") + confirmed.

### nodemailer bump: own PR inside the sweep
**Question**: Does the nodemailer 6→10 bump (F017) land in this sweep?
**Recommended**: Own PR
**Chosen**: Own PR — separate commit/PR inside the sweep: bump, typecheck, offline email tests.
**Rationale**: evidence: TECH_DEBT_AUDIT.md F017 row ("One PR, no rush"; exposure low) + confirmed.

### F024 heartbeat knob: map it
**Question**: How should the HEARTBEAT_ENABLED kill switch be made real?
**Recommended**: Map it
**Chosen**: Map vars.HEARTBEAT_ENABLED through the watch.yml step; update the guidance note that called the unmapping deliberate.
**Rationale**: evidence: TECH_DEBT_AUDIT.md F024 ("The one-line mapping honors the README") + confirmed.

### Delivery: one PR, all at once
**Question**: How should the fixes reach main?
**Recommended**: Themed PRs
**Chosen**: "PR all at once" — a single PR containing every fix (themed commits inside for bisectability).
**Rationale**: Developer's custom answer; optimizes one CI wait and one merge.

### F023 envelope: shrink the wait
**Question**: Worst-case runs can outlive the 8-minute cap and die before sending the exhaustion alarm — which way?
**Recommended**: Shrink wait
**Chosen**: Shrink WAIT_BUDGET_MS (src/judge.ts:94) to fit the envelope so the alarm always fires.
**Rationale**: evidence: TECH_DEBT_AUDIT.md F023 + audit open question 3 + confirmed; keeps timeout-minutes at 8.

### F012 graph binary: untrack
**Question**: .codebase-memory/graph.db.zst is tracked and reindexing rewrites it — pick a side?
**Recommended**: Untrack it
**Chosen**: git rm --cached + ignore; record the decision so history does not flip-flop again.
**Rationale**: evidence: TECH_DEBT_AUDIT.md F012 + confirmed.

## Open Questions
None — every branch resolved in the interview; the audit's remaining maintainer questions are filed as follow-ups below.

## Suggested Follow-ups
- .rpiv/artifacts/ pruning policy — unbounded growth of 60+ pipeline docs (TECH_DEBT_AUDIT.md, open question 2).
- reasoning_effort tolerance check across every endpoint in the LLM_ACCOUNTS pool (TECH_DEBT_AUDIT.md, open question 4).
- Probe under test: ramp logic and dead-account classification in scripts/probe-judge.ts are uncovered (TECH_DEBT_AUDIT.md, open question 5).

## References
- TECH_DEBT_AUDIT.md — the input report, generated at commit 395ee63 (2026-10-29)
- src/judge.ts, src/heartbeat.ts, src/fetch-threads.ts, src/email.ts, src/index.ts, src/threads-session.ts
- scripts/probe-judge.ts, scripts/hooks/gate-destructive.js, scripts/hooks/format-on-edit.js
- .github/workflows/watch.yml
- AGENTS.md, README.md
- .rpiv/guidance/src/architecture.md, .rpiv/guidance/.github/workflows/architecture.md, .rpiv/guidance/scripts/architecture.md
