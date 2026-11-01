---
date: 2026-11-01T11:26:26+0700
author: Yogiswara Utama
commit: 4c10d0c
branch: main
repository: loker-watcher
topic: "Tech-debt run #3 clean baseline (N006-N009)"
tags: [research, codebase, watch-yml, commit-state, commit-state-rebase-script, fetch-threads, fetch-linkedin, index, guidance-docs, spawnSync-tests]
status: ready
last_updated: 2026-11-01T11:26:26+0700
last_updated_by: Yogiswara Utama
---

# Research: Tech-debt run #3 clean baseline (N006-N009)

## Research Question
Chained from `.rpiv/artifacts/discover/2026-11-01_11-01-27_tech-debt-run3-clean-baseline.md`. How to implement: extract the commit-back's rebase/conflict-skip/push/retry body into `scripts/commit-state-rebase.sh` (single source, offline scratch-repo tests via spawnSync following `tests/format-on-edit.test.ts`), invoked exactly once from watch.yml's Commit state step; land the small src fixes (N006 unexport `PageMouseLike`, N009 delete the stale index.ts comment); re-sync the guidance docs that pin the block. N008 (received-vs-parsed counts) was RESEARCHED but HELD at the developer checkpoint — see Developer Context.

## Summary
- **N007** is the load-bearing item. The Commit state step (`.github/workflows/watch.yml:100-167`) splits at an exact boundary: YAML-owned head `:107-116` (bot identity, state-file-only add, no-op guard, jq-delta commit) stays; the body `:123-167` (rebase, 50-bounded skip loop, lease push, retry echo, terminal failure) moves into the script restructured as one attempt function + exactly one internal retry. The script must set `-e` itself (the step shell's implicit `bash -e` does not cross the process boundary). Acceptance is mechanical and self-enforcing: the YAML step comment must NOT contain the filename (else `grep -c` = 2), and no YAML tail logic may remain (else the retry doubles).
- **Test suite** extends the hook-spawnSync precedent to bash — the repo's first non-Node spawn. Design: PATH-probe bash with a `uname -s` MINGW/MSYS gate (WSL bash is the imposter to reject), `git --exec-path` fallback, explicit `skip` with reason if hostile. Repo paths travel via spawnSync `cwd`, never as POSIX-styled argv. A root `.gitattributes` pin (`*.sh text eol=lf`) is REQUIRED (developer-approved): autocrlf would otherwise check the script out CRLF and bash would die on `\r`. Four fixtures: clean push; state-only conflict skipped; non-state conflict aborts exit 1; pre-receive-hook remote that rejects push #1 and accepts the retry — the push-count file pins "exactly one retry" as the integer 2.
- **N006** confirmed zero-risk: `PageMouseLike` has exactly two code references (definition + the `PageLike.mouse` field), both in `src/fetch-threads.ts`; producer builds an anonymous literal; no importer names the type. One-token edit.
- **N009** is a 3-line deletion with one trap: both comment copies contain "timed as one", so the acceptance grep must be content-checked (`grep -c "Acquisition stage" src/index.ts` = 1), not count-checked.
- **N008 design is complete and preserved below but ON HOLD**: unmerged branch `feature/add-support-for-linkeind` edits the same throw (`src/fetch-linkedin.ts:298-305`) and test file; developer chose to hold N008 until the branch settles.
- **Guidance re-sync** touches 4 docs with an exact change matrix; README/AGENTS.md confirmed behavior-level only (grep). The doc-side loop paraphrase at `.rpiv/guidance/.github/workflows/architecture.md:65-69` is itself a skip-loop copy — it must go prose-only or the repo-wide once-grep stays broken.

## Detailed Findings

### N007 — migration boundary (`watch.yml:100-167`)
- Step anatomy (verified at HEAD): F021 rationale comment `:101-105` (the FRD's :92-99 pin drifted; those lines are Run-watcher env), `run: |` `:106`, bot identity `:107-108`, `git add state/seen-posts.json` `:109`, no-op guard `:110-113`, `PREV`/`CURR` jq delta `:114-115`, byte-identical commit `:116`, lease/skip rationale comment `:117-122`, first body `:123-143`, retry echo `:144`, verbatim retry copy `:145-165`, terminal echo+exit `:166-167`. The FRD's ":145-163" pin stops at the second push opener; the path truly ends at `:167`.
- **Moves to the script**: everything `:123-167` — `git pull --rebase origin main` (`:123`,`:145`), the skip loop (`skips=0` `:125`; `while test -d .git/rebase-merge && [ "$skips" -lt 50 ]` `:126`; conflict capture `git diff --name-only --diff-filter=U` `:129`; exact-equality vs `state/seen-posts.json` `:130`; loud echo `:131`; `git rebase --abort` `:132`; `exit 1` `:133`; set -e-proof `git rebase --skip || true` `:137`), lease push `:141-143`, retry echo `:144`, terminal pair `:166-167`. Restructure the two verbatim copies into one attempt body called at most twice — each attempt must get a FRESH 50 budget (today's `skips=0` resets at `:125`/`:147`).
- **Stays in YAML**: `:107-116` only. Reasons: jq must not become a script dependency (keeps the Windows test harness jq-free); the commit line stays greppable at `:116`; the no-op guard must precede the script line; bot identity is step plumbing.
- **Script contract**: exit 0 = pushed; exit 1 = non-state conflict abort or second push failure. The script sets `set -e` itself (today's body runs under the step's implicit `bash -e {0}` — no `shell:` key at `:106` — and a fresh bash process has no errexit; the `:135-136` "set -e-proof" comment only means something under errexit). `git rebase --abort` runs BEFORE `exit 1` (order is load-bearing: the local state commit survives for the next run). No `cd` anywhere — cwd must be the workspace root (`.git/rebase-merge` at `:126` is a relative-path test that only resolves from the repo root).
- **New behavior**: the 50-skip exhaustion echo goes between the loop's `done` and the enclosing `fi`, guarded by the same `test -d .git/rebase-merge`; it then falls through into the same push (semantics preserved exactly + legibility, per FRD FR2 and audit TECH_DEBT_AUDIT.md:74). Give the `50` bound a defending comment in the script (it is undefended today — a doctrine gap).
- **watch.yml after**: head `:107-116` unchanged + one bare line `bash scripts/commit-state-rebase.sh`. No `|| true`, no `if ! bash ...`, no YAML retry — any residual tail would stack a second retry AND put the filename in watch.yml twice (mechanically failing `grep -c` = 1). The rewritten F021 comment must reference "the committed script under scripts/" WITHOUT the literal filename. The lease/skip rationale comment (`:117-122`) migrates INTO the script — leaving it behind recreates the stale-comment debt class this run closes.

### N007 — test suite (`tests/commit-state-rebase.test.ts`)
- Convention: hooks precedent `tests/format-on-edit.test.ts:15-19` (module-scope path via `fileURLToPath(new URL(...))`, `spawnSync` at :18) + per-test `mkdtemp(join(tmpdir(), "lw-commit-state-rebase-"))` + try/finally `rm` (:23-31 pattern). Black-box: no src import, all fixtures under OS temp. Typecheck covers the new file (tsconfig includes src/tests/scripts); Biome never sees the .sh — the suite is the script's ONLY coverage.
- **Bash resolution (evaluated once at module scope)**: (1) `spawnSync("bash", ["-c", "uname -s"])` — on win32 accept only `/MINGW|MSYS/` (a `Linux` answer = WSL bash won the PATH race; reject). (2) Fallback: derive Git-for-Windows root from `git --exec-path` (two levels up → `<root>/bin/bash.exe`). (3) Neither → `bashProblem` string; every `it` registers `{ skip: bashProblem ?? false }` (node:test options-skip; `npm test` still exits 0; FRD's "skip loudly" fallback).
- **Invocation**: `spawnSync(BASH, [SCRIPT], { cwd: workRepo, env, encoding: "utf8", timeout: 60_000, windowsHide: true })`. The script path stays a Windows-style absolute argv (MSYS only remaps `/...`-looking args). env: spread process.env, DELETE every `GIT_*` var (ambient `GIT_DIR` would hijack the script's git), set `LC_ALL: "C"`.
- **LF pin (developer-approved scope addition)**: new root `.gitattributes` with `*.sh text eol=lf`. Without it, autocrlf=true checks the script out CRLF and bash exits 2/127 on `\r` — tests would fail on Windows with a correct script. The pre-receive hook fixture is test-generated with `\n` so it is immune either way.
- **Fixture factory** (per test): `git init --bare -b main origin.git`; work repo `git init -b main` + local config `user.name`/`user.email`, `commit.gpgsign false`, `core.autocrlf false`; remote = plain local path (not file://); `git fetch origin`; **`git branch --set-upstream-to=origin/main main`** — without this the refspec-less `git push --force-with-lease` fails "no upstream" (production gets upstream from actions/checkout; scratch init does not). State file shaped to v2 schema (`state.ts:35` CURRENT_STATE_VERSION 2; jq `length` counts keys). All git setup spawns native `git` via one `gitSync` helper — bash is reserved for the script-under-test only.
- **The 4 cases** (FRD "Core branches" decision): (a) clean commit → script → status 0, origin advanced, blob carries the new id. (b) advance origin with a DIFFERENT state id, fetch, commit conflicting state edit → skip fires → status 0, stderr lacks "non-state conflict", origin's state file equals ORIGIN's version (our id absent — the accepted F021 cost, pinned). (c) conflicting `notes.md` on both sides → status 1, stderr matches /non-state conflict/, `work/.git/rebase-merge` gone, HEAD at pre-script commit, origin untouched. (d) bare origin with generated `pre-receive` hook (chmod 0o755; counter file + `reject-first` marker inside the bare dir — keeps "zero writes inside the repo"): first push rejected, marker consumed, retry re-runs rebase (no-op) and pushes → status 0, **push-count file reads exactly 2** (the countable "exactly one retry"), marker gone, retry echo present in output. Lease-safety note: a refused pre-receive does not move the remote-tracking ref, so the retry's lease still matches — asserted by the exit-0 oracle, not assumed.
- Test count: 238 baseline (audit run #3, 4c10d0c) + 4 = 242; re-verify the total at implementation.

### N006 — unexport `PageMouseLike` (`src/fetch-threads.ts:91-94`)
- Definition :91-94 under JSDoc :90; sole type-position use is `readonly mouse?: PageMouseLike` inside `PageLike` (:109-110). Producer (`chromiumContextFactory` newPage, :171-178) builds an ANONYMOUS `mouse: { move, wheel }` literal checked structurally — the shipped code never names the type (the design doc's typed intermediate was not implemented). Runtime consumer `src/fetch-linkedin.ts:307-315` reads the field, never the type.
- Census: `PageMouseLike` appears in exactly 2 code sites (both fetch-threads.ts) — every other hit is artifacts. Module importer census (5 sites): fetch-linkedin.ts:38 imports only `ContextLike` (claim confirmed); index.ts:29-35; both fetch tests; index.test.ts:17-24 — none name PageMouseLike. No barrels. The LinkedIn suite's double is annotated `const page: PageLike` with mouse inline (:133-145) — "plain *Like doubles need NO cast" (guidance tests doc). Tests/casts/imports unchanged by the edit.
- Acceptance: one-token edit → `npm run typecheck` (interface stays referenced at :110; `noUnusedLocals` is not even enabled) → ad-hoc `npx knip` (NO knip config exists anywhere — confirmed by run-2 research/plan; entry discovery rides npm scripts) clean of PageMouseLike. This is the N004 precedent (ced76f8) mechanically repeated.

### N009 — delete stale comment (`src/index.ts:152-154`)
- Anatomy: :150 surfaces log, :151 blank, :152-154 STALE pre-LinkedIn wording, :155-157 KEEP per-platform wording, :158 the acquisition timeStage. Root cause: the LinkedIn design's hunk was titled "replaces the acquisition timeStage block" but the implementation APPENDED — a botched replace, not two intentional comments.
- The kept copy matches the code: per-platform resolution at :166 (`threadsSessionPath`) and :167-168 (`linkedinSessionPath` via `ENV_NAMES.linkedinSession`), one timed span, platform split at :164-165.
- **Trap**: both copies contain "timed as one" once each — a count-only grep cannot tell WHICH copy survived. Verify by content: `grep -c "Acquisition stage" src/index.ts` = 1 or `grep -n "per-platform" src/index.ts` = 1 hit. Delete :152-154 as a unit (partial :152-156/:153-157 splices the blocks).
- Orphan audit: "Acquisition stage" hits only the two copies + historical artifacts; zero hits in guidance/tests/scripts. D9 stays resolvable (still cited at src/index.ts:83 and :159). Biome ignores comments — lint is a tripwire only.

### N008 — RECEIVED-VS-PARSED COUNTERS (design preserved; **HELD this pass**)
- Seam: `fetchLinkedInSurface` `src/fetch-linkedin.ts:256-338`. `let responses = 0` :263 counts PARSED-with-≥1-post only — reachable only after three silent exits: :268 (combined URL+status guard — non-200 flagship-web dies here with no trace), :273 (parsed length 0), :278-280 (catch swallows text() rejection). Poll loop :292-299 (120 × 250ms from constants :53-54 — FRD's :55-56 pin drifted), throw :300-304 with message :302, OK log :333 (pinned verbatim by tests :271-274).
- Fix shape (for when it lands): split the :268 guard — URL test first (the denominator boundary: only LINKEDIN_RESPONSE_RE matches count), then `received += 1` SYNCHRONOUSLY (Playwright fires the listener on headers; a hung/rejected `text()` must not zero the count; non-200 responses never reach the async closure today), then status gate returns, then the unchanged async parse path. Poll-loop gate (:296) STAYS on parsed — gating on received would end the wait on a single blocked response. OK log keeps the parsed count (avoids unscoped test churn).
- Message (wording locked by developer): single combined form — `${parsed} of ${received} flagship-web response(s) parsed within ${LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS}ms — non-200/blocked or format change?` (0-of-7 = the FRD's example; 0-of-0 = honest nothing-arrived).
- Test design: new regex pins BOTH numbers as literals (`/\b0 of 0\b .*parsed/`, `/\b0 of 1\b .*parsed/` — a one-numbered message fails the pair literal). `fakeContext` needs ONE new knob: `initialStatus` (fire()'s status is hardcoded 200 at tests :104-111, :106-108) → fixture `fakeContext({ initialBody: cardBody(...), initialStatus: 999 })` (LinkedIn's authwall code) exercises received=1/parsed=0 for real. Received-but-unparseable needs no knob (`initialBody: "not-a-flight-line"` → 200 that parses to []). Update the it() titles (responses DID arrive in the 0-of-1 case). Old wording pinned ONLY at tests :351-356 + src :302 (grep-verified; other hits are archived artifacts).

### Guidance-doc re-sync matrix (FR8)
| File | Change |
|---|---|
| `.rpiv/guidance/.github/workflows/architecture.md` | `:21` structure parenthetical → delegation wording; `:65-69` (inside the :55-70 fence) → one-invocation description, invariant as PROSE ONLY (no `git pull --rebase`/`git rebase --skip`/`--diff-filter=U` tokens — the doc paraphrase is itself a skip-loop copy that would break the repo-wide once-grep); `:111` "Replicate the commit-back block exactly" → "invoke `scripts/commit-state-rebase.sh`" (the highest-stakes line — it actively instructs future duplication). KEEP verbatim: heading :54, :56-64, F021 accepted-cost :71, secret-free :52, jq sync point :8. |
| `.rpiv/guidance/architecture.md` | `:8` tree line gains the script fact; `:11` scripts/ map gains the fourth file with its one-line role; `:16` pointer descriptor extended. (FRD FR8's "Commit state (skip-loop + lease push)" citation actually points at the WORKFLOWS doc :21 — the root doc's pins are :8/:22, behavior-level.) |
| `.rpiv/guidance/scripts/architecture.md` | :1 + :4 "Three files" → four, with the reclassification: commit-state-rebase.sh is PRODUCTION RUNTIME (executes in the only production write path), unlike probe (dispatch gate) + hooks (agent tooling); invokers :6-9 gain the watch.yml Commit state bullet (invoked exactly once, retry internal); structure :10-18 gains the .sh entry (outside typecheck+lint+lint-staged, offline spawnSync-tested); exit-code contract :31-36 extended; :56 gate caveat unchanged and still accurate. |
| `.rpiv/guidance/tests/architecture.md` | :4 scope gains the shell-script category (+ the explicit-skip note); coverage map :11-28 gains `scripts/commit-state-rebase.sh → commit-state-rebase.test.ts` after :27. The hooks recipe block (:117+) is optional to extend. |
| README.md / AGENTS.md / `.rpiv/guidance/src/architecture.md` | NO change — grep-confirmed behavior-level mentions only (README :39/:128/:187/:277-281; AGENTS :11/:28/:65; src guidance :9/:93). |

## Code References
- `.github/workflows/watch.yml:100-167` — the whole Commit state step (extraction surface)
- `.github/workflows/watch.yml:107-116` — YAML-owned head (stays)
- `.github/workflows/watch.yml:123-143` — first-push body (moves, attempt 1)
- `.github/workflows/watch.yml:144-167` — retry echo + verbatim retry + terminal exit (moves, attempt 2 + tail)
- `.github/workflows/watch.yml:57-61` — `fetch-depth: 0` + defending comment (invariant survives unmoved)
- `scripts/commit-state-rebase.sh` — NEW: attempt body + ≤2 invocations, `set -e`, exhaustion echo, fresh 50 budget per attempt
- `.gitattributes` — NEW: `*.sh text eol=lf` (developer-approved)
- `tests/commit-state-rebase.test.ts` — NEW: 4 black-box scratch-repo cases
- `tests/format-on-edit.test.ts:15-31` — the spawnSync + mkdtemp + try/finally template to follow
- `src/fetch-threads.ts:91-94` — N006 edit site (`export interface PageMouseLike`)
- `src/fetch-threads.ts:109-110` — `PageLike.mouse` field (keeps the type referenced)
- `src/fetch-threads.ts:171-178` — anonymous mouse literal producer (unaffected)
- `src/index.ts:152-154` — N009 deletion; `:155-157` kept; `:158-171` the code the kept copy describes
- `src/fetch-linkedin.ts:263-304` — N008 seam (HELD): counter :263, combined guard :268, parsed-only increment :274, poll loop :292-299, throw :300-304 (message :302), OK log :333
- `tests/fetch-linkedin.test.ts:104-111` — fire() with hardcoded status 200 (needs initialStatus knob when N008 lands)
- `tests/fetch-linkedin.test.ts:351-356` — old-wording regex pin :354 (N008's test update, deferred with it)
- `src/state.ts:35` — CURRENT_STATE_VERSION 2 (fixture state-file shape)
- `.rpiv/guidance/.github/workflows/architecture.md:21,65-69,111` — the three doc edits
- `.rpiv/guidance/scripts/architecture.md:4,10-18` — "Three files" + structure inventory
- `.rpiv/guidance/tests/architecture.md:4,27` — scope line + coverage-map tail

## Integration Points

### Inbound References
- `.github/workflows/watch.yml:106-167` — the run: block invokes the script exactly once, as the LAST command; the step shell's `bash -e` consumes the 0/1 exit contract with no wrapper
- `package.json:9` (`npm test` = tsx --test tests/*.test.ts) — auto-discovers the new test file by glob; no registration
- knip (ad-hoc `npx knip`, no config) — N006's acceptance probe; entry points discovered from npm scripts

### Outbound Dependencies
- Script → git only (pull --rebase, rebase --abort/--skip, push --force-with-lease) + POSIX test/echo. NO jq (deliberately kept in YAML :114-115), no secrets (step stays secret-free, guidance :52)
- Test suite → `bash` (resolved, skippable), `git` on PATH (fixture setup), OS temp only

### Infrastructure Wiring
- `fetch-depth: 0` (`watch.yml:57-61`) exists only because Commit state rebases (guidance workflows :11) — survives because the script still rebases; guidance wording re-points at the script
- `permissions: contents: write` + `concurrency: watch (cancel-in-progress: false)` — untouched; the queue serialization is what makes single-writer state safe
- Runner assumptions (FRD Constraints): ubuntu-latest, bash default step shell, git+jq preinstalled, 8-minute job cap unchanged

## Architecture Insights
- **Greppable architecture is functional, not cosmetic**: the acceptance greps (`git pull --rebase` absent from watch.yml; filename count = 1; skip-loop once repo-wide) directly dictate comment wording — the YAML comment must NOT name the script file, and the guidance docs must drop command tokens to prose.
- **Errexit does not cross the process boundary**: the step's implicit `bash -e {0}` is today's error channel; the extracted script must re-establish `set -e` or the NFR "byte-for-byte behavior" breaks silently.
- **The doc paraphrase was already a second copy**: `.rpiv/guidance/.github/workflows/architecture.md:65-69` means the skip-loop text exists in FOUR places today (watch.yml ×2 + doc). "Exactly once repo-wide" must count the doc.
- **One variable, two roles** (N008, preserved for later): `responses` is simultaneously poll gate, throw trigger, and OK-log metric; only the diagnosis role splits — gate and log ride the parsed count.
- **Historical grep flip**: run #2's Slice 11 acceptance was `grep -c 'git pull --rebase origin main' watch.yml` = 2 (plans/2026-10-30_15-02-33:3159); run #3 inverts the pinned count to 0.
- Repo doctrine holds: script is hard-coded (no env tunables), fail-visible exit codes, comments defend constants (the 50 bound gets its first defending comment in the script).

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: F021 commit-back block (the code being extracted)
**Commit(s)**: `510ff2a` — "ci: cache the Playwright browser and rebase state pushes" (2026-10-30 20:57 +0700); guidance re-sync `b0b7dbe` 7 seconds later (5 guidance docs + README + AGENTS.md).
**Blast radius**: 3 files, workflow layer + docs.
**Follow-up fixes** (five commits in ~40 minutes, 2026-10-31 — the block broke on every new path):
- `89c8bc5` (20:47) — shallow clone → add/add whole-tree conflicts → `fetch-depth: 0`
- `8b777e6` (21:01) — rebase rewrites SHAs → plain push non-FF by construction → `--force-with-lease`
- `45bcbd3` (21:09) — conflicted rebase failed the run → skip conflicted state commits
- `2e28916` (21:13) — skip loop not set -e proof + unbounded → `|| true` + 50 bound
- `bc760cb` (21:25) — loop skipped ANY conflict → gate on conflict set == state file exactly, else abort
**Lessons from docs**: TECH_DEBT_AUDIT.md N007 — "written in five rushed CI commits (89c8bc5..bc760cb), the least-reviewed code in the repo"; the 50-cap fall-through is the audit's own "looks-fine" (the echo the FRD folds in).
**Takeaway**: every historical failure was runner-only and invisible to any test. Preserve semantics exactly; the manual `workflow_dispatch` acceptance check is the real test — scratch repos cannot reproduce runner fetch/lease/queue conditions.

### Precedent: guidance re-syncs
**Commit(s)**: `b0b7dbe` (same-minute sync, 2026-10-30); `732a082` (2026-10-31 12:37:53, seconds after `636a4be`/`ced76f8`).
**Follow-up fixes / misses**: the `89c8bc5..bc760cb` chain + `68c1e2d` (LINKEDIN_SESSION_STATE env) landed with NO committed sync — at HEAD the workflows guidance doc is stale in git (fixes exist only as uncommitted working-tree changes, 5 files +181/−171).
**Takeaway**: the house convention is same-minute atomic sync with the behavior change; skipped, it rots within hours. Land FR8's edits in the same change set with grep verification (run-2 validation precedent).

### Precedent: spawnSync offline tests
**Commit(s)**: `7776a30` (2026-10-30, gate-destructive.test.ts, 6 spawnSync sites); `636a4be` (2026-10-31, format-on-edit.test.ts + N002 hostile-path fix).
**Follow-up fixes**: none; zero flaky/skip commits in history (git log --grep flaky empty).
**Lessons from docs**: solutions/2026-10-31_09-27-45 (:97) — the cmd.exe tokenization class (shell:true npx) was the known subprocess risk; bash-spawning is the repo's FIRST non-Node spawn.
**Takeaway**: the pattern is flake-free for Node spawns; bash is genuinely novel — build the explicit-skip escape hatch in from the start, and run the one-time live probe on this dev box before trusting the suite.

### Precedent: N004 unexport sweep
**Commit(s)**: `ced76f8` — "refactor: unexport four internal symbols" (2026-10-31 12:37:50), 4 files 4 lines.
**Follow-up fixes**: none; knip confirmed clean. But N006 (same class) was introduced THE SAME DAY by `68c1e2d`; knip is in neither ci.yml nor package.json scripts, so the class recurs silently between audits.
**Takeaway**: N006 is mechanically identical to N004 and just as safe; do not treat the sweep as more than a one-token change.

### Precedent: unmerged LinkedIn branch (incoming overlap)
**Commit(s)**: branch `feature/add-support-for-linkeind` tip `14aaf74` (2026-11-01 08:33, NOT on main): `2b74c61` (credential-login fallback), `216a617` ("fix: treat an empty linkedin search window as zero results"), `b5d72f8` (broader surfaces); DUPLICATED second copy as `485e0ac`/`8b08705`/`1922f2e` (same messages, different hashes — unfinished branch hygiene).
**Blast radius**: src/fetch-linkedin.ts (+8, edits the exact :298-305 throw N008 rewrites) and tests/fetch-linkedin.test.ts (+24).
**Takeaway**: developer decision — HOLD N008 until the branch settles; when it lands, N008's design (above) applies on top, and the branch will need to rebase onto whatever main carries.

### Composite Lessons
- The commit-back block failed 5× in 40 minutes on first live exercise; every mode was runner-only. Extraction fixes testability, not runner coverage — keep the manual dispatch check and do not "improve" while moving (FR2 byte-for-byte).
- Guidance syncs work when committed atomically (`b0b7dbe`, `732a082`) and rot within hours when skipped (the Oct-31 evening chain left HEAD guidance stale — repairs sit uncommitted in the working tree right now).
- spawnSync tests have a clean flake record — but all precedents spawn Node, never bash; the FRD's Windows-bash risk is real and novel.
- Unexport sweeps never needed follow-ups, but the debt class returned the same day — knip not being in CI means dead exports recur between audits.
- Watch duplicated-commit branches: two hash lines with identical messages is unfinished hygiene; coordinate before two divergent fixes touch one error message.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — audit run #3 input: findings N006-N009, N005 deferred prescription
- `.rpiv/artifacts/discover/2026-11-01_11-01-27_tech-debt-run3-clean-baseline.md` — this research's FRD (decisions + open questions)
- `.rpiv/artifacts/discover/2026-10-31_07-47-21_tech-debt-run2-remediation.md` — prior debt run's FRD (N001-N004, merged via PR #4)
- `.rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md` — prior research; source of the "no knip config" confirmation
- `.rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md` — run-1 design; F021 redesign history
- `.rpiv/artifacts/plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md` — run-1 plan; Slice 11 acceptance grep (=2) that run #3 flips to 0
- `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md` — LinkedIn design; root cause of N009's botched replace + N006's export
- `.rpiv/artifacts/validation/2026-10-31_12-13-51_tech-debt-run2-remediation.md` — run-2 validation; the grep-by-grep re-sync verification precedent

## Developer Context
**Q (discover: Primary pain: clean baseline): What pain are you removing?**
A: Clean baseline — zero known debt so the next feature starts from a clean base.

**Q (discover: N006 fix shape): Which shape?**
A: Drop export only.

**Q (discover: N008 fix shape): Which shape?**
A: Received vs parsed counts. (Now HELD — see branch question below.)

**Q (discover: N009 fix shape): Which shape?**
A: Delete 3 lines.

**Q (discover: N005 scope): Does clean baseline include N005?**
A: Keep deferred (audit's own prescription; trigger is judge.ts next touched for real work).

**Q (discover: N007 extraction shape): Which extraction shape?**
A: Bash script — scripts/commit-state-rebase.sh owning rebase + skip + push + single retry; watch.yml invokes it exactly once (supersedes the audit's two-invocation wording).

**Q (discover: 50-skip exhaustion echo): Fold a distinguishing echo in?**
A: Fold echo in.

**Q (discover: Script test depth): How deep do the script's tests go?**
A: Core branches — 4 offline cases (clean push; state-only conflict skips; non-state conflict aborts; push rejection retried exactly once).

**Q (no root .gitattributes): Without a pin, autocrlf checks the new .sh out CRLF and bash dies on \r on this Windows box. Pin LF how?**
A: Add .gitattributes (Recommended accepted) — one line `*.sh text eol=lf`; tests exercise the shipped bytes. Scope addition beyond the FRD file list, developer-approved.

**Q (feature/add-support-for-linkeind tip 14aaf74 edits src/fetch-linkedin.ts:298-305 + tests/fetch-linkedin.test.ts): How do we handle the overlap with N008?**
A: Hold N008 only — land N006, N007, N009 this pass; N008 waits until the branch situation resolves. N008's research is preserved above for that pass.

**Q (src/fetch-linkedin.ts:302 wording): Which message shape for the deferred N008?**
A: One combined message — "N of M flagship-web response(s) parsed within 30000ms — non-200/blocked or format change?" (locked now so the future pass does not re-litigate).

## Related Research
- `.rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md` — prior debt-run research (knip config absence, spawnSync conventions)
- `.rpiv/artifacts/research/2026-10-31_07-45-40_linkedin-second-surface.md` — LinkedIn surface research (the seam N008 sits in)

## Open Questions
- **Windows bash test harness — unverified**. `npm test` runs on this Windows box; spawning `bash` against a scratch git repo is exactly where MSYS path translation bites (repo paths handed to bash, Git for Windows bash resolution on PATH). Nobody has verified this works as of this FRD. Research/implement must verify the invocation strategy before building the suite; if bash proves unavailable or hostile, the tests skip explicitly rather than fail flakily, and the FR 2 invocation model re-opens. (Research mitigation designed: uname -s MINGW gate + git --exec-path fallback + explicit skip; the one-time live probe on the dev box is still the empirical confirmation.)
- **Deferred with N008 (this pass)**: LinkedIn wheel-constant live retune (`src/fetch-linkedin.ts:41-44` placeholders) and the N008 landing itself — both re-open when `feature/add-support-for-linkeind` settles.