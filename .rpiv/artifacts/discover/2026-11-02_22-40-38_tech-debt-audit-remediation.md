---
date: 2026-11-02T22:40:38+0700
author: Yogiswara Utama
commit: ecc9865
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Tech-debt audit remediation (run #4: N010-N017)"
tags: [intent, frd, tech-debt, linkedin-cutover, security-hygiene, fetch-linkedin-api]
status: ready
last_updated: 2026-11-02T22:40:38+0700
last_updated_by: Yogiswara Utama
---

# FRD: Tech-debt audit remediation (run #4: N010-N017)

## Summary
Remediate every open finding from tech-debt audit run #4, ranked by severity. The pass guards the exposed LinkedIn credential before anything moves, commits the uncommitted LinkedIn SDK cutover in four reviewable slices, lands the four small fixes (N012 dead exports, N013 fail-safe parked-workflow guard, N014 test-idiom port, N015 AGENTS.md sync), and records the N017 state-history policy as accept-and-document. The judge.ts split (N005) stays deferred under its own trigger.

## Problem & Intent
Developer's framing: **"Fix everything ranked — work through the whole list, critical first, until every open item has a resolution."**

The audit (run #4, 2026-11-02) left one Critical exposure live: the working tree deleted the `.gitignore` rule that protected `linkedin-state.b64` (3,852-byte base64 storageState, account-equivalent), leaving it one habituated `git add .` away from a documented-public repo. The entire LinkedIn SDK cutover (~20 modified files, 5 deletions, 2 untracked modules) also lives only in the working tree — gates pass, but nothing is durably recorded. The intent is a clean sweep: every finding gets a fix, a policy decision, or an explicit deferral recorded in this FRD, in severity order.

## Goals
- Every open audit finding (N010-N017) has an explicit resolution in this FRD.
- The credential is un-shippable (ignore rule restored, blob deleted) BEFORE any commit sweep touches the tree.
- The LinkedIn SDK cutover is durably committed in four reviewable slices; the PR states the `@linkedapi/node` dependency need (repo rule).
- The four small fixes land: 0 unused exports (knip), fail-safe parked-workflow skip with a new pinning test, single test idiom, two-platform AGENTS.md.
- The next audit run reports N010-N016 resolved.

## Non-Goals
- No judge.ts split — N005 stays deferred; its "touched for real work" trigger has not fired (comment-wording deltas only since run #2).
- No change to LinkedIn spend posture — 288 paid searches/day accepted as-is (coverage is worth the bill).
- No state-history redesign — N017 is accept + document only; no squash schedule, no moving seen-state out of git.
- No probe-ramp tests, no negative-delta commit-wording change, no reasoning_effort endpoint check — the three carried open questions stay open.
- No stash changes — `stash@{0}` (pre-rebase rescue) stays as history.

## Functional Requirements
1. **N010 (Critical, first)**: Restore the `linkedin-state*.b64` ignore rule in `.gitignore` AND delete `linkedin-state.b64` from the repo root. Both happen before any slice commit.
2. **N011 slice 1 — new platform leg + its fixes**: Commit `src/fetch-linkedin-api.ts` and `tests/fetch-linkedin-api.test.ts` with the N012/N013/N014 changes folded in:
   - **N012**: remove `export` from `createLinkedApiClient` (`src/fetch-linkedin-api.ts:107`), `makeChromiumContextFactory` (`src/fetch-threads.ts:129`), and `chromiumContextFactory` (`src/fetch-threads.ts:180`); each keeps its internal default-param use.
   - **N013**: in `src/fetch-linkedin-api.ts:179`, treat ANY non-null `pendingReason` as parked — warn + `continue` (fail-safe); the `outsideWorkingHours` case keeps its specific message. Add one test: an unknown reason string skips without `result()` being awaited (red under today's strict `===`, green after).
   - **N014**: port `captureLines` (`tests/fetch-linkedin-api.test.ts:93-107`) from direct `console[method]` reassignment to `t.mock.method` call-through spies.
3. **N011 slice 2 — deletions + rewiring**: Commit the five deletions (`src/fetch-linkedin.ts`, `src/linkedin-login.ts`, `scripts/linkedin-login.ts`, `tests/fetch-linkedin.test.ts`, `tests/linkedin-login.test.ts`) plus the modified wiring files (`src/index.ts`, `src/fetch-threads.ts`, `src/config.ts`, `src/config-file.ts`, `src/threads-session.ts`, `src/judge.ts`, and the modified test files).
4. **N011 slice 3 — workflow + deps**: Commit `.github/workflows/watch.yml`, `package.json`, `package-lock.json`. The PR description states the `@linkedapi/node` need and carries the N016 operator checklist.
5. **N011 slice 4 — docs + artifacts**: Commit `README.md`, the four modified `.rpiv/guidance/` files, the updated `TECH_DEBT_AUDIT.md`, all 10 untracked cutover artifacts, and the `handoffs/` dir; plus the N015 fix: AGENTS.md gains the LinkedIn platform mention, the `src/fetch-linkedin-api.ts` module bullet, and the `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN` pair.
6. **N017**: Record the accept-and-document policy in the guidance (state/ commit-back growth is a known, accepted cost; revisit only when clone size forces it).
7. **N016 (operator, not code)**: Delete the four orphaned GitHub secrets (`LINKEDIN_SESSION_STATE`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, `LINKEDIN_SECRET_WRITER`) and revoke the PAT — checklist item in the PR description.

Gates (`npm run typecheck`, `npm run lint`, `npm test`) run between slices and must stay green.

## Non-Functional Requirements
- **Security**: The LinkedIn credential must never be committable; the blob is deleted and its ignore rule restored before any sweep. Rotation of the minted sessions is advised if the blob ever left the machine.
- **Reliability**: Fail-visible doctrine unchanged; N013 makes the parked-skip fail-safe — a false skip costs one surface-tick, a false fall-through costs the whole run (8-minute job cap, lost state commit).
- **Performance**: No specific constraint; the run keeps its 10-minute cadence and 8-minute job cap.
- **UX / Accessibility**: Not applicable (headless scheduled pipeline).
- **Maintainability**: Strict TS flags stay on (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`); single test idiom after N014; knip reports 0 unused exports.

## Constraints & Assumptions
- Node >= 22, ESM (`"type": "module"`); prefer `node:` prefixed imports.
- No new runtime dependency without a stated need — `@linkedapi/node` is already in the tree; the slice-3 PR description must state its need.
- All gates are green on the working tree today (240/240 tests, tsc clean, Biome clean); they must stay green per slice.
- Secrets live in GitHub Actions secrets only; N016 is an operator action outside the repo.
- Assumption: `linkedin-state.b64` was verified absent from git history (`git log --all` empty for the path), so deletion + ignore restores a clean posture without history scrubbing.
- Assumption: the unknown-`pendingReason` skip's cost (one lost surface-tick) is acceptable per the audit's fail-safe asymmetry argument.

## Acceptance Criteria
- [ ] `grep linkedin-state .gitignore` finds a rule, and `ls linkedin-state.b64` reports the file is gone — both BEFORE the first slice commit exists.
- [ ] A new test with an unknown `pendingReason` string passes and asserts `result()` was never called (red before N013, green after).
- [ ] `npx knip` reports 0 unused exports.
- [ ] `grep -i linkedin AGENTS.md` hits the platform sentence, the `src/fetch-linkedin-api.ts` module bullet, and both `LINKED_API` env names.
- [ ] `git log --oneline` shows the four cutover slices with conventional messages; `git status` after slice 4 shows no modified/deleted src/tests/workflow/docs files left behind.
- [ ] `npm run typecheck && npm run lint && npm test` all exit 0 after every slice.
- [ ] The PR is open, states the `@linkedapi/node` need, and lists the N016 operator checklist.
- [ ] The guidance records the N017 accept-and-document decision.

## Recommended Approach
Guard-first remediation ordered by audit rank: one line in `.gitignore` plus `rm linkedin-state.b64`, then four conventional commit slices on `feature/add-support-for-linkeind` (module+tests with N012/N013/N014 folded in, then deletions+rewiring, then workflow+deps, then docs+artifacts+AGENTS.md), gates between slices, then open the PR. No new modules; N013 generalizes the existing guard at `src/fetch-linkedin-api.ts:179` from strict string match to any-non-null fail-safe skip.

## Decisions

### Remediation order: guard before slices
**Question**: Probe confirms linkedin-state.b64 (3,852 bytes, account-equivalent cookies) sits committable with its ignore rule deleted, and the entire cutover is uncommitted. Do it in which order?
**Recommended**: Guard first (restore rule + delete blob BEFORE any commit sweep), then commit the cutover in 4 slices.
**Chosen**: Guard first, then slices.
**Rationale**: The commit sweep is exactly the command that would ship the blob; evidence: .gitignore (rule absent, verified by probe), linkedin-state.b64 (3,852 B untracked in root) + confirmed.

### Small-fix batch scope (N012+N013+N014+N015)
**Question**: Four small fixes pre-confirmed by the probe — unexport 3 idle factories, fail-safe pendingReason skip, t.mock.method port, AGENTS.md two-platform sync. Keep all four as scoped?
**Recommended**: All four.
**Chosen**: All four.
**Rationale**: Each matches the audit's fix and repo conventions; default-param seams already make tests work without the exports; evidence: src/fetch-linkedin-api.ts:107,179; src/fetch-threads.ts:129,180; tests/fetch-linkedin-api.test.ts:93-107; AGENTS.md (zero LinkedIn hits) + confirmed.

### N005 judge.ts split stays deferred
**Question**: The 830-line judge.ts (N005, carried since run #2): split it in this pass anyway, or keep deferred?
**Recommended**: Keep deferred — the "touched for real work" trigger has not fired.
**Chosen**: Keep deferred.
**Rationale**: Only comment wording changed since run #2; the audit's own mitigation stands; a dedicated PR is not warranted.

### Cutover artifacts committed in slice 4
**Question**: Repo doctrine keeps .rpiv/artifacts/ tracked (74 files in git); 10 untracked cutover artifacts plus handoffs/ are one 'git add .' away from the docs slice. Commit all of them with the cutover?
**Recommended**: Commit all in slice 4 — they are the cutover's paper trail.
**Chosen**: Commit all in slice 4.
**Rationale**: Repo guidance states ".rpiv/artifacts/ stays tracked"; the untracked set documents the cutover being committed; evidence: root guidance + confirmed.

### N017 state-history policy: accept + document
**Question**: state/seen-posts.json is 1.6 MB, rewritten and committed every match run, 144 ticks/day — file bounded, git history unbounded. Pick the policy.
**Recommended**: Accept + document (today's de facto answer, recorded explicitly).
**Chosen**: Accept + document.
**Rationale**: No code change, no history rewrites, no redesign; the cost is known and the decision becomes explicit in guidance.

### LinkedIn API spend posture: accept
**Question**: 288 paid SDK searches/day re-fetching mostly-seen 24h windows — what is the accepted spend posture?
**Recommended**: Accept the spend; coverage is worth the bill.
**Chosen**: Accept the spend.
**Rationale**: Intentional coverage purchase; no cadence/surface/recency logic added to the fetch stage in this pass.

### Old rescue stash: keep
**Question**: stash@{0} ('pre-rebase: TECH_DEBT_AUDIT.md dirty', 145 lines) — keep or drop?
**Recommended**: Keep it — zero cost, it is history.
**Chosen**: Keep.
**Rationale**: Superseded but harmless; no action taken.

### Carried open questions: none in scope
**Question**: Three carried items (probe ramp tests, negative-delta commit wording, reasoning_effort endpoint check) — which belong in this pass?
**Recommended**: None — keep the pass focused on N010-N016.
**Chosen**: None; all three stay open questions in the audit.
**Rationale**: Scope discipline — each is unrelated to the cutover remediation; recorded as follow-ups instead.

## Open Questions
- N005 judge.ts split (move `dispatchLlmCall` + `DispatchWarns`/`DispatchOutcome` into `judge-dispatch.ts`) — explicitly deferred until judge.ts is next touched for real work.
- Probe ramp tests, negative-delta commit wording, reasoning_effort endpoint verification — explicitly deferred; remain audit open questions 6-8.

## Suggested Follow-ups
- N016 operator action (outside the repo): delete `LINKEDIN_SESSION_STATE`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, `LINKEDIN_SECRET_WRITER` from GitHub Actions secrets and revoke the PAT at github.com if it has other uses.
- Rotate the LinkedIn sessions the deleted blob was minted from, if it ever left the machine.
- Audit open question 2 (can `execute()` return `pendingReason` values beyond `"outsideWorkingHours"`?) — N013's fail-safe makes it safety-moot, but the doc check against linkedapi.io remains open.
- Audit open question 4's deeper pruning policy for `.rpiv/artifacts/` (beyond committing this cutover's set) — revisit if the ledger keeps growing.
- Audit open question 7's negative-delta commit wording and open question 6's probe-ramp tests — carried x3/x2, unchanged.

## References
- Input: `.rpiv/artifacts/TECH_DEBT_AUDIT.md` (run #4, 2026-11-02, audited at ecc9865 + working tree)
- `.rpiv/artifacts/plans/2026-11-02_13-52-20_linkedin-sdk-post-search-cutover.md` (cutover plan)
- `.rpiv/artifacts/validation/2026-11-02_15-52-31_linkedin-sdk-post-search-cutover.md` (cutover validation)
- `.rpiv/guidance/src/architecture.md` (pipeline stages, adding-stage/fetcher procedures)
- `.rpiv/guidance/tests/architecture.md` (test idioms — the t.mock.method convention N014 ports to)
