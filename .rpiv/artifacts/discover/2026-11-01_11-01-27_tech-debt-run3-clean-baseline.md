---
date: 2026-11-01T11:01:27+0700
author: Yogiswara Utama
commit: 4c10d0c
branch: main
repository: loker-watcher
topic: "Tech-debt run #3 clean baseline (N006-N009)"
tags: [intent, frd, watch-yml, commit-state, fetch-linkedin, fetch-threads, scripts]
status: ready
last_updated: 2026-11-01T11:25:40+0700
last_updated_by: Yogiswara Utama
---

# FRD: Tech-debt run #3 clean baseline (N006-N009)

## Summary
Clear the four fixable findings from tech-debt audit run #3 (N006 dead export, N007 duplicated commit-back skip loop, N008 misleading LinkedIn timeout error, N009 stale comment) so the repo reaches a zero-known-debt baseline before the next feature. N005 (judge split) stays deferred by its own audit prescription. The only non-trivial item, N007, extracts the duplicated rebase-skip loop into a committed bash script that owns rebase, skip, push, and retry in one place, is invoked once by watch.yml, and is pinned by offline scratch-repo tests.

## Problem & Intent
The developer's framing: **clean baseline** — "You want zero known debt so the next feature starts from a clean base." The input was "fix this debt" pointing at `.rpiv/artifacts/TECH_DEBT_AUDIT.md` (run #3 against 4c10d0c: 0 Critical, 0 High, 1 Medium, 3 Low). The pain is not one broken behavior; it is carrying known debt into future feature work. The debt pass must end with the full gate green and every fixable finding closed.

## Goals
- All four fixable findings (N006, N007, N008, N009) fixed and verified at HEAD.
- N007's safety invariant (skip ONLY exact state-file conflicts, else abort) exists exactly once in the repo and is pinned by offline tests.
- Full gate green after the work: `npm run typecheck`, `npm run lint`, `npm test`.

## Non-Goals
- **N005 judge-dispatch split** — deferred by the audit's prescription; its trigger is "judge.ts next touched for real work" (its only delta since b92fa9f is 8 doc lines).
- LinkedIn wheel-constant live retune (`src/fetch-linkedin.ts:41-44` declared placeholders) — audit open question, not a finding.
- Commit-message wording for negative state deltas (`state: -N new seen post ids`) — audit open question 6.
- Shell linting (shellcheck or similar) for the new script — accepted gap this pass; follow-up.
- Probe ramp tests, reasoning_effort pool verification, `.rpiv/artifacts/` pruning policy — audit open questions 3-5, out of scope.

## Functional Requirements
1. **N006**: `src/fetch-threads.ts:91` — remove the `export` keyword from `PageMouseLike`; the interface stays for its single use (the optional `mouse` field at :110). No import sites change (probe verified zero importers in src/, tests/, scripts/).
2. **N007 script**: new `scripts/commit-state-rebase.sh` owning the commit-back's rebase body: `git pull --rebase origin main`; the skip loop (conflict set must equal exactly `state/seen-posts.json` else `git rebase --abort` + exit 1; 50-skip bound; a distinguishing echo when the bound exhausts; set -e-proof `git rebase --skip || true`); push with `--force-with-lease`; on push rejection, exactly one full retry of the same rebase+skip body; exit 1 with a loud message on the second failure. **Invocation model: the script owns rebase + skip + push + single retry, and watch.yml invokes it exactly once** — this supersedes the audit's "both call sites become one line each" two-invocation wording, because collapsing the retry into the script is what makes the retry testable (FR 4d). Today's semantics are preserved exactly, plus the new exhaustion echo.
3. **N007 wiring**: `watch.yml`'s Commit state step keeps its YAML-owned parts (bot identity, `git add`, no-op guard, jq-delta commit) and replaces the entire two-copy rebase/push/retry body (:123-143 first-push path, :145-163 retry path) with **one** script invocation. The skip-loop text exists exactly once repo-wide (grep-verifiable).
4. **N007 tests**: new offline test file (naming per the hooks-test convention, e.g. `tests/commit-state-rebase.test.ts`) using scratch git repos via `spawnSync`, covering at least: (a) clean rebase+push exits 0; (b) state-only conflict skipped, exit 0; (c) non-state conflict aborts, exit 1, loud message; (d) push rejection triggers exactly one retry — the fixture-heavy case: it needs a remote that rejects the first push and accepts the retry (for example a bare repo whose pre-receive hook flips on a marker file), not a plain `git init`; (a)-(c) are cheap scratch-repo cases.
5. **N008**: `src/fetch-linkedin.ts` counts received flagship-web responses (any status) separately from parsed ones; the first-response timeout error includes both counts (e.g. "0 of 7 responses parsed — format change?"); exact wording may vary but both numbers must be present.
6. **N008 test update**: `tests/fetch-linkedin.test.ts:351-354` asserts the new message (it pins the old "session may be dead" wording today).
7. **N009**: delete the stale three-line comment at `src/index.ts:152-154`; the superseding per-platform block (:155-157) is the sole comment.
8. **Docs re-sync**: update every doc pinning the commit-back block internals — `.rpiv/guidance/.github/workflows/architecture.md` (commit-back section, its "replicate the commit-back block exactly" instruction, structure line) and root `.rpiv/guidance/architecture.md` ("Commit state (skip-loop + lease push)"). README/AGENTS.md mention commit-back at behavior level only; implement greps to confirm no change needed.

## Non-Functional Requirements
- **Performance**: no hot-path change; the script adds at most one process spawn per rebase attempt on the runner — negligible against the 10-minute cadence and 8-minute job timeout.
- **Security**: no new secret surfaces; the commit-back step stays secret-free; the skip-only-state invariant and `--force-with-lease` semantics are preserved byte-for-byte in behavior.
- **UX / Accessibility**: n/a (headless); operator-facing error text improves (N008 dual counts, 50-skip exhaustion echo).
- **Reliability**: fail-visible contracts hold (non-state conflicts abort the run loudly); the workflow remains the only production writer to `state/`; tests stay offline and deterministic; no new runtime dependencies.

## Constraints & Assumptions
- Runner is ubuntu-latest with bash as the default step shell; git and jq preinstalled; watch job `timeout-minutes: 8` unchanged.
- No linter covers `.sh` (Biome 1.9.4 is JS/TS/JSON only, confirmed by probe) — the script is test-covered instead; adding shellcheck is explicitly out of scope.
- Tests must run offline on the dev machine (Windows) as well as CI (ubuntu). The bash-invocation risk this creates is not buried here — it is tracked in Open Questions.
- Strict TS flags, Node >= 22 ESM, `node:` prefixed imports unchanged; no new runtime dependency.
- Assumption: the jq-delta commit message line stays byte-identical (greppable delta history).

## Acceptance Criteria
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0 (includes the new test file; the .sh is naturally outside Biome scope).
- [ ] `npm test` exits 0 — every test passes, 0 skipped; total = 238 baseline (4c10d0c) + the new script-test case count (4 or more per FR 4; 242 at exactly 4).
- [ ] `grep -n "git pull --rebase" .github/workflows/watch.yml` returns no matches — the loop lives only in `scripts/commit-state-rebase.sh`.
- [ ] `grep -c "commit-state-rebase.sh" .github/workflows/watch.yml` returns exactly 1 — one invocation; the retry lives inside the script (FR 2 model).
- [ ] The new offline script tests pass: clean rebase+push exit 0; state-only conflict skipped exit 0; non-state conflict abort exit 1; push rejection retried exactly once.
- [ ] `npx tsx --test tests/fetch-linkedin.test.ts` exits 0 and its timeout case asserts a message carrying both received and parsed counts.
- [ ] `grep -n "timed as one" src/index.ts` shows only the per-platform comment block (stale :152-154 gone).
- [ ] knip reports no unused export for `PageMouseLike` (audit tooling: knip clean of N006).
- [ ] `.rpiv/guidance/.github/workflows/architecture.md` no longer instructs block replication; it describes the script invocation.
- [ ] Live check post-merge: one manual `workflow_dispatch` of watch.yml completes green including Commit state (live-only, per repo convention "verify with a manual dispatch").

## Recommended Approach
Extract the commit-back's rebase/conflict-skip/push/retry body into `scripts/commit-state-rebase.sh` (single source, offline scratch-repo tests via spawnSync following `tests/format-on-edit.test.ts`), invoked exactly once from watch.yml's Commit state step; land the three small src fixes (unexport `PageMouseLike`, delete the stale index.ts comment, received-vs-parsed counts in fetch-linkedin's timeout error plus its test update); re-sync the guidance docs that pin the block. No new runtime dependencies.

## Decisions

### Primary pain: clean baseline
**Question**: The audit lists 4 fixable items (N006, N007, N008, N009) and 1 deferred (N005). When you say "fix this debt" — what pain are you actually removing, and who feels it first?
**Recommended**: n/a — `intent` question
**Chosen**: Clean baseline — zero known debt so the next feature starts from a clean base.
**Rationale**: developer's own framing; shapes scope to the 4 fixable findings.

### N006 fix shape
**Question**: Pre-resolved from codebase evidence — confirmed in Step 4
**Recommended**: Drop the export keyword, keep the interface.
**Chosen**: Drop export only.
**Rationale**: evidence: src/fetch-threads.ts:91 (zero importers in src/tests/scripts, probe-verified) + confirmed.

### N008 fix shape
**Question**: Pre-resolved from codebase evidence — confirmed in Step 4
**Recommended**: Count received flagship-web responses (any status) separately from parsed; put both counts in the timeout error; update the existing test.
**Chosen**: Received vs parsed counts.
**Rationale**: evidence: src/fetch-linkedin.ts:266-281 (silent exits at :268/:273/:278), :300-303 throw; tests/fetch-linkedin.test.ts:351-354 pins old wording + confirmed.

### N009 fix shape
**Question**: Pre-resolved from codebase evidence — confirmed in Step 4
**Recommended**: Delete the 3 stale lines; the :155-157 block already states the correct behavior.
**Chosen**: Delete 3 lines.
**Rationale**: evidence: src/index.ts:152-157 (stale block directly above its superseding version) + confirmed.

### N005 scope
**Question**: Does clean baseline include N005 (judge.ts at 828 LOC), or does it stay deferred?
**Recommended**: Keep deferred.
**Chosen**: Keep deferred.
**Rationale**: the audit's own prescription — trigger is "judge.ts next touched for real work"; delta since b92fa9f is 8 doc lines; splitting now adds refactor risk to a half-day debt pass.

### N007 extraction shape
**Question**: The two verbatim skip-loop copies (watch.yml:123-143, :145-163) carry the run's only write-path safety invariant. YAML cannot share the block. Which extraction shape?
**Recommended**: Bash script.
**Chosen**: Bash script — `scripts/commit-state-rebase.sh`, owning rebase + skip + push + single retry; watch.yml invokes it exactly once (post-review fix 2026-11-01: supersedes the audit's two-invocation wording — collapsing the retry into the script makes it testable).
**Rationale**: the only shape that single-sources the invariant AND makes it offline-testable; evidence: .github/workflows/watch.yml:123-163 (verbatim copies), tests/format-on-edit.test.ts:16-18 (spawnSync precedent) + confirmed. Composite action rejected (nothing becomes testable, nil reuse across 2 workflows); collapse-in-place rejected (stays an untestable black box).

### 50-skip exhaustion echo
**Question**: When the skip loop hits its 50-skip bound mid-rebase, today it falls through into a confusing push failure. Fold a one-line distinguishing echo into the extracted script?
**Recommended**: Fold echo in.
**Chosen**: Fold echo in.
**Rationale**: audit open question 2; natural fit in the rewrite; turns a once-in-a-blue-moon confusing failure into a legible one.

### Script test depth
**Question**: How deep do the extracted script's tests go?
**Recommended**: Core branches (~4 offline cases).
**Chosen**: Core branches — clean rebase+push exit 0; state-only conflict skips; non-state conflict aborts exit 1; push rejection retried once.
**Rationale**: pins the skip-only-state invariant without 50-conflict fixture weight (full matrix rejected).

## Open Questions

- **Windows bash test harness — unverified**. `npm test` runs on this Windows box; spawning `bash` against a scratch git repo is exactly where MSYS path translation bites (repo paths handed to bash, Git for Windows bash resolution on PATH). Nobody has verified this works as of this FRD. Research/implement must verify the invocation strategy before building the suite; if bash proves unavailable or hostile, the tests skip explicitly rather than fail flakily, and the FR 2 invocation model re-opens.

## Suggested Follow-ups
- LinkedIn wheel constants still declared PLACEHOLDERS pending live retune — `src/fetch-linkedin.ts:41-44` (audit open question 1).
- Negative state-delta commit message reads "state: -N new seen post ids"; consider "pruned" wording — watch.yml commit line (audit open question 6), adjacent to the same step being rewritten.
- Nothing lints `.sh`; N007's extraction creates the repo's first shell script — consider shellcheck in a later pass.
- Probe ramp logic remains the only uncovered non-trivial logic — `scripts/probe-judge.ts:139-177` (audit open question 5).
- reasoning_effort verification across every endpoint in the pool (audit open question 4, live-only).
- `.rpiv/artifacts/` keeps growing; pruning policy or intentional archive (audit open question 3).

## References
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — input; audit run #3, 2026-10-31, HEAD 4c10d0c
- `.rpiv/artifacts/discover/2026-10-31_07-47-21_tech-debt-run2-remediation.md` — prior run's FRD (N001-N004, merged via PR #4)
- `.rpiv/guidance/.github/workflows/architecture.md` — pins the commit-back block; re-sync target
- Probe reports (this session): codebase-analyzer (commit-back seam, lint scope, scripts inventory) + codebase-locator (N006/N008/N009 verification at HEAD)
