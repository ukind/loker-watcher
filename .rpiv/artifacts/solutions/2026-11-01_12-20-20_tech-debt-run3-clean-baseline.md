---
date: 2026-11-01T12:20:20+0700
author: Yogiswara Utama
commit: 4c10d0c
branch: main
repository: loker-watcher
topic: "Tech-debt run #3 clean baseline (N006-N009)"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, watch-yml, commit-state, commit-state-rebase-script, fetch-threads, index, guidance-docs]
last_updated: 2026-11-01T12:45:44+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Windows bash probe passed (MINGW gate); grep scoping, Cons-bullet, and Comparison-table corrections"
---

# Solution Analysis: Tech-debt run #3 clean baseline (N006-N009)

**Date**: 2026-11-01T12:20:20+0700
**Author**: Yogiswara Utama
**Commit**: 4c10d0c
**Branch**: main
**Repository**: loker-watcher

## Research Question
Chained from `.rpiv/artifacts/discover/2026-11-01_11-01-27_tech-debt-run3-clean-baseline.md` and researched in `.rpiv/artifacts/research/2026-11-01_11-26-26_tech-debt-run3-clean-baseline.md`. How to implement the run-#3 clean baseline: extract the Commit state step's rebase/conflict-skip/push/retry body into a single source with exactly one retry, land the small src fixes (N006 unexport `PageMouseLike`, N009 delete the stale `src/index.ts` comment), and re-sync the guidance docs that pin the block. N008 (received-vs-parsed counters) is HELD until `feature/add-support-for-linkeind` settles.

## Summary
**Problem**: The commit-back logic exists as two verbatim copies inside one YAML step; it is untestable offline, undocumented in its 50-bound, and its doc paraphrase is a third copy.
**Recommended**: Option 1 (Bash script `scripts/commit-state-rebase.sh`) — 45 of 45 body lines move near-verbatim, the offline spawnSync suite is testable, and GitHub's own docs canonicalize this exact shape.
**Effort**: Medium (~1 day: script + 4-case test suite + `.gitattributes` + 4-doc re-sync + one-time live Windows bash probe).
**Confidence**: High — 4 candidates × 2 agents (codebase-analyzer + web-search-researcher), every candidate × dimension cell filled; two candidates fail the fit filter on structural evidence.

## Problem Statement

**Requirements:**
- FR2: preserve commit-back semantics byte-for-byte — do not improve while moving (the block failed 5× in 40 minutes on first live exercise: 89c8bc5..bc760cb).
- Single source with exactly one internal retry; watch.yml invokes it exactly once; the YAML-owned head (bot identity, state-file-only add, no-op guard, jq delta commit) stays in watch.yml.
- Offline, deterministic test coverage for the extracted body's 4 core branches, following the `tests/format-on-edit.test.ts` spawnSync convention.
- N006 (unexport `PageMouseLike`) and N009 (delete stale comment) land in the same pass.
- Guidance re-sync (FR8): 4 docs, with the doc-side loop paraphrase going prose-only so skip-loop tokens are once-repo-wide INCLUDING docs.

**Constraints:**
- Hard: jq must NOT become a dependency of the extracted unit (keeps the Windows test harness jq-free); the no-op guard must precede the invocation; errexit does not cross the process boundary — the script must set `set -e` itself.
- Hard: greppable-architecture acceptance — `git pull --rebase` absent from watch.yml; the invocation filename exactly once in watch.yml (so the migrated F021 comment must NOT name it); skip-loop tokens once repo-wide including guidance docs.
- Hard: state writes stay atomic and commit→push stays one shell on one workspace (this constraint is what eliminates Option 4).
- Soft: repo doctrine — script values hard-coded (the 50 bound gets its first defending comment); fail-visible exit codes (0 = pushed, 1 = non-state conflict or second push failure).

**Success criteria:**
- `grep -c 'git pull --rebase' .github/workflows/watch.yml` = 0; invocation filename count = 1 SCOPED to watch.yml; skip-loop tokens once SCOPED to watch.yml + guidance docs (`.rpiv/artifacts/*` historical copies are immutable and excluded — `commit-state` already appears in committed artifacts at `discover/2026-11-01_11-01-27:8` and `research/2026-11-01_11-26-26:8`, and ~14 historical skip-loop copies live there).
- `npm run typecheck && npm run lint && npm test` green with the new 4-case suite (242 total, re-verify at implementation).
- Manual `workflow_dispatch` acceptance still passes (the real runner test — scratch repos cannot reproduce lease/queue conditions).
- `npx knip` clean of `PageMouseLike`; `grep -c "Acquisition stage" src/index.ts` = 1.

## Current State

**Existing implementation:**
- `.github/workflows/watch.yml:100-167` — the Commit state step: F021 rationale comment :101-105, `run: |` :106 (implicit `bash -e {0}`, no `shell:` key), bot identity :107-108, `git add state/seen-posts.json` :109, no-op guard :110-113, PREV/CURR jq delta :114-115, byte-identical commit :116, lease/skip rationale :117-122, first-push body :123-143 (rebase :123, skip loop :125-139 with 50 bound, `git rebase --skip || true` :137, lease push :141-143), retry echo :144, verbatim retry copy :145-165, terminal echo+exit :166-167.
- `fetch-depth: 0` :57-61 exists only because Commit state rebases; `permissions: contents: write` :6-7 and `concurrency: watch (cancel-in-progress: false)` :9-11 serialize single-writer state.
- The doc paraphrase at `.rpiv/guidance/.github/workflows/architecture.md:65-69` is itself a skip-loop copy — skip-loop text exists in FOUR places today (watch.yml ×2 + doc fence + doc prose :111 "Replicate the commit-back block exactly").

**Relevant patterns:**
- spawnSync black-box tests: `tests/format-on-edit.test.ts:12-31` and `tests/gate-destructive.test.ts` — module-scope path via `fileURLToPath`, `spawnSync` on real files, `mkdtemp` + try/finally `rm`. Flake-free record, but both spawn Node — bash is the repo's FIRST non-Node spawn.
- TS script under scripts/ invoked from watch.yml: `scripts/probe-judge.ts` at `watch.yml:38` (exit-code precedent `process.exit(1)`).
- Unexport sweep precedent: N004 (ced76f8) — 4 files, 4 lines, knip-verified; N006 is the mechanically identical class (introduced same day by 68c1e2d).
- npm test auto-discovery: `package.json:9` (`tsx --test tests/*.test.ts` glob) picks up new test files with zero registration; `tsconfig.json` includes `scripts` so the new test typechecks automatically; biome's allowlist (`package.json` lint script) never sees `.sh`.

**Integration points:**
- `.github/workflows/watch.yml:106-167` — the extraction surface (head :107-116 stays; body :123-167 moves).
- `package.json:9-16` — test glob, lint allowlist (one edit IF Option 3; none for Option 1).
- `.rpiv/guidance/.github/workflows/architecture.md:21,65-69,111`, `.rpiv/guidance/architecture.md:8,11,16`, `.rpiv/guidance/scripts/architecture.md:1,4,6-9,10-18,31-36`, `.rpiv/guidance/tests/architecture.md:4,27` — the FR8 re-sync matrix (exact change table in the research doc).
- `src/fetch-threads.ts:91-94` (N006 edit; :109-110 keeps the type referenced) and `src/index.ts:152-154` (N009 deletion; :155-157 kept — content-grep, not count-grep: both copies contain "timed as one").

## Solution Options

### Option 1: Bash script (`scripts/commit-state-rebase.sh`) — RECOMMENDED
**How it works:**
The body :123-167 moves into a POSIX shell script owning rebase + skip + lease push + exactly one internal retry, restructured as one attempt function called at most twice with a FRESH 50-skip budget per attempt (today's `skips=0` resets at :125/:147). The script sets `set -e` itself and never `cd`s (the relative `.git/rebase-merge` test resolves only from the workspace root). watch.yml keeps the head :107-116 unchanged and ends with one bare invocation line; the migrated F021 comment references "the committed script under scripts/" WITHOUT the literal filename. A root `.gitattributes` pin (`*.sh text eol=lf`) keeps autocrlf from checking the script out CRLF (bash dies on `\r`).

**Pros:**
- Near-verbatim move (45 lines move; the only rewrite inside the move is the two verbatim loop copies collapsing into one attempt function) — the strongest possible fit for FR2 byte-for-byte; zero semantic re-litigation of the repo's least-reviewed code.
- Offline testable: 4 scratch-repo cases via the existing spawnSync convention; auto-discovered by `npm test`; typechecks with zero config change.
- GitHub-documented pattern: "Adding scripts to your workflow" canonicalizes exactly this shape; bash is max-maturity, zero deprecation risk on ubuntu-latest (bash is the OS default).
- Removal cost trivial: delete script + test + `.gitattributes` line, restore 45 lines. No state, no deps, no config.

**Cons:**
- The Windows-bash test resolution is novel (MINGW/WSL PATH races); mitigated by the uname gate + `git --exec-path` fallback + explicit skip — dev-box probe PASSED (see Follow-up 2026-11-01). CI runs ubuntu-only, so the suite still runs in CI; the residual is local-dev-only: a machine-specific Windows bash break surfaces in local runs and never reds CI.
- The suite is the script's ONLY automated coverage (biome never sees `.sh`); runner-only failure modes (lease mismatch, rebase SHA rewrite, queue serialization) stay runner-only — the manual dispatch check remains the real test.

**Complexity:** Medium (~1 day)
- Files to create: 3 (script ~35-40 lines, test ~200+ lines, `.gitattributes` 1 line)
- Files to modify: 6 (watch.yml + 4 guidance docs + optionally the tests-guidance recipe block)
- Risk level: Medium (concentrated in the unverified Windows bash probe)

### Option 2: Local composite action (`.github/actions/commit-state/action.yml`)
**How it works:**
An in-repo composite action wraps the body; watch.yml switches `run: |` to `uses: ./.github/actions/commit-state`. Composite `run` steps execute on the parent runner with shared workspace, so checkout/identity/lease keep working without inputs.

**Pros:**
- Mature platform feature (2020/2021, no deprecation signals); officially scoped for step-level reuse; dodges the node20→node24 runtime migration that JS actions carry.
- If it ever wraps a script via `$GITHUB_ACTION_PATH`, it becomes a reuse shell around Option 1's artifact.

**Cons:**
- Zero offline coverage possible: no spawnable file exists for the spawnSync convention to execute — testing it means extracting the script anyway, at which point the action is a SECOND COPY of the same commands and the tested artifact is the script, not the action.
- Precedent-fit fails on a pinned convention: guidance boundary says "only official `actions/*` at major tags"; zero in-repo actions exist; the discover FRD already rejected it ("nothing becomes testable, nil reuse across 2 workflows").
- The dedupe is vestigial: only a single-step action preserves `exit`-based flow — there the "composite" is decorative (a bash function inline); a genuine multi-step split forces a `continue-on-error` + `steps.<id>.outcome` semantic rewrite.

**Complexity:** Medium (~1 day) — Files to create: 2 (action.yml + the test that cannot target it); Risk level: High (feedback loop = production dispatch only)

### Option 3: TypeScript runner (`scripts/commit-state.ts` via `npx tsx`)
**How it works:**
The body is re-expressed in TypeScript driving git via spawnSync; watch.yml's step becomes `npx tsx scripts/commit-state.ts` after the unchanged head. try/catch + explicit `.status` checks replace errexit.

**Pros:**
- Strongest toolchain precedent (`scripts/probe-judge.ts`, same invocation pattern at watch.yml:38); typecheck covers it automatically; one lint-allowlist edit.
- ELIMINATES the Windows-bash risk entirely — tests spawn via `spawnSync(process.execPath, ["--import", "tsx", file])` (shell-free, cross-platform; avoids the documented post-CVE-2024-27980 EINVAL on npx `.cmd` shims).
- The dedupe is inherent (loop written once, called twice) and the error channel is typed.

**Cons:**
- 0% of the 45 lines survive — a full REWRITE of the code that failed 5× in 40 minutes on first live exercise, re-litigating semantics FR2 pinned byte-for-byte.
- New silent-failure class: spawnSync does not throw on non-zero git exits — every call site must check `.status` (try/catch alone is wrong); stderr plumbing must inherit or git's conflict message vanishes (watch.yml:103 promises it surfaces).
- Moderate displacement risk long-term (Node native TS `run .ts` on 22.18+/24), though tsx remains the tsconfig-aware default.

**Complexity:** High (~2 days) — Files to create: 2; Files to modify: 3 (watch.yml, package.json lint allowlist, guidance); Risk level: Low-Medium (test infra simplest; rewrite risk is the cost)

### Option 4: Reusable-workflow dedupe (`workflow_call`)
**How it works:**
The body moves to a reusable workflow (or a self-call) invoked as a JOB; retry via a second caller job with `needs:` + `if: failure()`.

**Pros:**
- Mature and actively enhanced (GA Nov 2021; nesting raised to 10 levels/50 calls Nov 2025); body lines survive nearly verbatim inside the called job's step.

**Cons:**
- STRUCTURAL BLOCKER: "Reusable workflows are called directly within a job, and not from within a job step" (GitHub docs). The called job gets a FRESH runner — the caller's local state commit (`git add` :110, `git commit` :116) does not exist on its disk; rebase+push would push nothing. Commit→push locality — the invariant the incumbent's correctness depends on — severs.
- Forced duplication: checkout (`fetch-depth: 0`), bot identity, and `permissions: contents: write` must reappear in the called workflow; called jobs do NOT join the caller's `watch` concurrency group → races the next */10 tick.
- Retry cannot leave the shell without 3-job gymnastics and an artifact roundtrip; "exactly one retry" is inexpressible at the job graph level without re-checkout of a commit that only exists on the first job's disk.

**Complexity:** High — Files to create: 1-2 (75-90 new lines vs 45 moved); Risk level: High (blocked by design)

## Comparison

| Criteria | Option 1 (bash script) | Option 2 (composite action) | Option 3 (ts runner) | Option 4 (workflow_call) |
|----------|----------|----------|----------|----------|
| Complexity | M | M | H | H |
| Codebase fit | H (FRD pick; greps designed for it) | L (boundary forbids; discover rejected) | M (strong toolchain, wrong FR2 shape) | L (zero precedent; repo copy-pastes) |
| Risk | M (Windows bash, mitigated) | H (zero offline verification) | L-M (rewrite of least-reviewed code) | H (severs correctness chain) |
| FR2 byte-for-byte | 45 lines move; 2 loops → 1 attempt fn | single-step only, else rewrite | 0/45 survive | body survives, plumbing rewritten |
| Approach-shape | file executable; one process boundary; exit codes 1:1 | step-list container; exit flow needs a single `run:` step | language port; errexit → manual `.status` checks | job graph; fresh runner per call |
| Novelty (deprecation risk) | none — GitHub-documented canonical pattern | none — mature since 2020/21 | low — tsx maintained; Node-native TS displacement moderate | none — GA 2021; docs steer step-level dedupe elsewhere |
| Offline testability | 4 cases | none possible | 4 cases | none possible |

## Recommendation

**Selected:** Option 1 — Bash script `scripts/commit-state-rebase.sh`

**Rationale:**
- Every kept dimension clears: near-verbatim move satisfies FR2 exactly; the offline suite is buildable with the repo's flake-free spawnSync convention; the greps the acceptance is written around were designed for this shape.
- GitHub's own docs document this pattern as the canonical way to keep workflows DRY at step level; composite actions are for chaining steps (community + docs consensus), reusable workflows are job-level only.
- Independent 8-agent scoring confirms the FRD's locked pick rather than overriding it — the two alternatives that beat it on any single axis (C3's Windows-bash elimination) lose on the axis the FRD weights highest (semantic preservation of the repo's least-reviewed code).

**Why not alternatives:**
- Option 2 (composite action): verification-cost fails structurally — no spawnable file exists for the offline suite; building the suite means extracting the script anyway, making the action a second copy. Also breaks the pinned "only official actions/*" guidance boundary.
- Option 3 (ts runner): clears the fit filter but loses on FR2 — a 0%-survival rewrite of code that failed 5× in 40 minutes at birth, plus a new silent-failure class (unchecked spawnSync `.status` replacing errexit). Its one real advantage (no Windows bash) is mitigated by design in Option 1 and is local-dev-only (CI runs ubuntu-latest).
- Option 4 (workflow_call): integration-risk fails structurally — job-level invocation puts the body on a fresh runner where the caller's local state commit does not exist; commit→push locality severs; the called job bypasses the `watch` concurrency group.

**Trade-offs:**
- Accepting the unverified-until-probed Windows bash resolution (with an explicit-skip escape hatch) for near-verbatim semantic preservation and a buildable offline suite.
- Accepting "suite is the only automated coverage" (biome blind to `.sh`) — same trust model as the hook scripts, which have held flake-free.

**Implementation approach:**
1. One-time live probe FIRST: verify the bash-resolution strategy on this Windows dev box (uname -s MINGW/MSYS gate; `git --exec-path` fallback; WSL rejection) before building the suite on top of it.
2. Create `.gitattributes` (`*.sh text eol=lf`) — load-bearing for the TESTS, not just the script: without it autocrlf checks the script out CRLF and a CORRECT script fails red on Windows.
3. Create `scripts/commit-state-rebase.sh`: shebang + `set -e`; attempt body called at most twice with a fresh `skips=0` per attempt; `git rebase --skip || true` survives INSIDE the loop (without it errexit aborts on the first skip); exhaustion echo between `done` and `fi` guarded by `test -d .git/rebase-merge`, falling through to the same push; 50-bound defending comment; `git rebase --abort` BEFORE `exit 1`; no `cd`.
4. Create `tests/commit-state-rebase.test.ts`: 4 black-box scratch-repo cases (clean push; state-only conflict skipped; non-state conflict aborts exit 1; pre-receive-hook rejection retried exactly once — push-count file pins the integer 2); env stripped of all `GIT_*`; `LC_ALL=C`; fixtures with `commit.gpgsign false`, `core.autocrlf false`, `branch --set-upstream-to=origin/main main`; state file shaped to v2 schema (`src/state.ts:35`).
5. Rewire watch.yml: head :107-116 unchanged; migrated F021 comment WITHOUT the literal filename; one bare `bash scripts/commit-state-rebase.sh` as the last command. No `|| true`, no `if !`, no YAML tail.
6. Land N006 (drop `export` at `src/fetch-threads.ts:91`) and N009 (delete `src/index.ts:152-154` as a unit).
7. Guidance re-sync per the research matrix — `.rpiv/guidance/.github/workflows/architecture.md:65-69` goes PROSE-ONLY (no command tokens) or the repo-wide once-grep stays broken; :111 re-points at the script. Same change set, atomic (b0b7dbe/732a082 precedent).

**Integration points:**
- `.github/workflows/watch.yml:106-167` — head stays, body replaced by one invocation line.
- `scripts/commit-state-rebase.sh` — NEW, the single source.
- `.gitattributes` — NEW, one line.
- `tests/commit-state-rebase.test.ts` — NEW, auto-discovered.
- `.rpiv/guidance/.github/workflows/architecture.md:21,65-69,111`; `.rpiv/guidance/architecture.md:8,11,16`; `.rpiv/guidance/scripts/architecture.md:1,4,6-9,10-18,31-36`; `.rpiv/guidance/tests/architecture.md:4,27`.
- `src/fetch-threads.ts:91`, `src/index.ts:152-154`.

**Patterns to follow:**
- spawnSync black-box + mkdtemp/try/finally: `tests/format-on-edit.test.ts:12-31`.
- Exit-code contract through a step shell: `scripts/probe-judge.ts:187,243`.
- Unexport sweep: ced76f8 (N004).
- Atomic same-minute guidance sync: b0b7dbe, 732a082.

**Risks:**
- Windows bash probe: RETIRED on the dev box 2026-11-01 (probe passed strategy 1 — see Follow-up). Mitigations stay load-bearing for other machines/PATH orderings: uname-MINGW gate + exec-path fallback + explicit skip with reason; CI is ubuntu-only so any machine-specific break is local-dev pain and never reds CI on Windows.
- Runner-only failure modes (lease mismatch vs moved remote-tracking ref, rebase SHA rewrite, queue serialization) stay untestable offline — keep the manual `workflow_dispatch` acceptance check; do not try to simulate lease races in scratch repos.
- `.gitattributes` LF pin is load-bearing for tests (false red on CRLF checkout without it).
- Attempt-function collapse: `git rebase --skip || true` (:137) must survive inside the loop or `set -e` aborts on the first skip — the loop's one deliberate non-fatal command.
- Byte-for-byte deviation ledger: the 50-skip exhaustion echo is the SINGLE sanctioned deviation (new legibility behavior per FRD FR2 + audit TECH_DEBT_AUDIT.md:74); everything else must diff as pure move. Record it in the script comment so a future review does not read it as drift.
- force-with-lease hazard (git-push man page: background fetches defeat the lease) — production has no background fetch between checkout and push; preserve the refspec-less form verbatim (FR2); do NOT "improve" to `--force-if-includes` while moving.

## Scope Boundaries
- Building: N007 extraction (script + once-invocation + suite + `.gitattributes`), N006, N009, guidance re-sync (4 docs), live Windows bash probe, manual dispatch acceptance.
- NOT doing: N008 (HELD until `feature/add-support-for-linkeind` settles — design preserved in the research doc, message wording locked), N005 (deferred per audit prescription; trigger = judge.ts next touched for real work), LinkedIn wheel-constant retune (deferred with N008), any semantic "improvements" to the moved body, runner-mode test simulation.

## Testing Strategy

**Unit tests (offline, `npm test`, 238 → 242):**
- Clean commit → script → exit 0, origin advanced, blob carries the new id.
- Origin advanced with a DIFFERENT state id → skip fires → exit 0, origin keeps ITS version (the accepted F021 cost, pinned).
- Conflicting `notes.md` on both sides → exit 1, stderr matches /non-state conflict/, `work/.git/rebase-merge` gone, origin untouched.
- Pre-receive hook rejects push #1, accepts the retry → exit 0, push-count file reads exactly 2, retry echo present.

**Integration tests:**
- None new — the scratch-repo suite IS the integration surface; `ci.yml` gates typecheck + lint + test unchanged.

**Manual verification:**
- [ ] One-time live probe: bash resolution on the Windows dev box (MINGW gate + fallback), BEFORE building the suite.
- [ ] `workflow_dispatch` of watch.yml on a scratch branch — the only real lease/queue/rebase-against-moved-main exercise.
- [ ] Greps: `git pull --rebase` = 0 in watch.yml; filename = 1; skip-loop tokens once repo-wide including docs; `grep -c "Acquisition stage" src/index.ts` = 1; `npx knip` clean of PageMouseLike.

## Open Questions
**Resolved during research:**
- Extraction shape — bash script, confirmed by 4-candidate × 6-dimension scoring (this artifact); composite action and workflow_call fail structurally.
- Errexit crossing — confirmed: `set -e` is process-local (bash manual, SHELLOPTS export aside); the script must set it itself.
- Windows invocation strategy — designed (MINGW gate + exec-path fallback + explicit skip); empirical confirmation pending the live probe.
- N008 message wording — locked by developer ("N of M flagship-web response(s) parsed within 30000ms — non-200/blocked or format change?").

**Requires user input:**
- None blocking this pass. N008 landing timing rides on the LinkedIn branch settling.

**Blockers:**
- None for this pass. (The live Windows bash probe gate is RESOLVED on this dev box — see Follow-up; the explicit-skip path and the Option 3 fallback remain recorded for other machines.)

## References
- `.rpiv/artifacts/research/2026-11-01_11-26-26_tech-debt-run3-clean-baseline.md` — full research (boundary anatomy, fixture factory, doc matrix, N008 preserved design)
- `.rpiv/artifacts/discover/2026-11-01_11-01-27_tech-debt-run3-clean-baseline.md` — the FRD (locked decisions, composite-action rejection)
- `.github/workflows/watch.yml:100-167` — the extraction surface
- `tests/format-on-edit.test.ts:12-31` — the spawnSync template
- `scripts/probe-judge.ts:187,243` — exit-code precedent
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — N006-N009 findings; the "least-reviewed code" verdict
- `.rpiv/artifacts/plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md:3159` — the run-2 grep (=2) this pass flips to 0
- GitHub docs: "Adding scripts to your workflow"; workflow-syntax `steps[*].shell`; "Creating a composite action"; "Reusing workflow configurations"; git-push(1) `--force-with-lease`

## Follow-up Analysis 2026-11-01T12:45:44+0700

**Windows bash probe — EXECUTED, PASSED (strategy 1).** Run on the dev box exactly as the suite will resolve it (`node -e` → `spawnSync('bash', ['-c', 'uname -s'])`):

- Result: `status 0`, stdout `MINGW64_NT-10.0-26300` — Git for Windows bash wins the PATH race; the MINGW gate's acceptance condition (`/MINGW|MSYS/`) holds.
- `git --exec-path` → `C:/Program Files/Git/mingw64/libexec/git-core` — the strategy-2 fallback root (`C:/Program Files/Git` → `<root>/bin/bash.exe`) is confirmed viable.
- PATH caveat (why gate + fallback stay load-bearing): `where bash` returns THREE executables — `C:\Program Files\Git\usr\bin\bash.exe` (the winner here), `C:\Windows\System32\bash.exe` (WSL launcher; would answer `Linux`, the impostor the gate rejects), and the `WindowsApps` WSL stub. Ordering is machine-specific.

**Consequence:** Recommendation-block risk (a) is RETIRED on this dev box — the explicit-skip path is not expected to fire here, and the 4-case suite can be built on the designed resolution. The risk text in the scored block above is annotated, not rewritten; per follow-up policy the scoring and verdicts stay immutable.

**Corrections applied in place (prose fixes, not re-scoring):** Success-criteria greps scoped to watch.yml + guidance docs with the artifacts exclusion made explicit; Option 1 Cons bullet contradiction fixed (CI is ubuntu — residual is local-dev-only); Comparison table gained `approach-shape` + `novelty` rows and the FR2 cell now states the loop collapse accurately; `.gitattributes` verified absent at root, so "Files to create: 3" stands.

**Verdict unchanged:** Option 1 (bash script `scripts/commit-state-rebase.sh`). Next step unchanged: `/skill:design` on this artifact.
