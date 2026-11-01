---
date: 2026-11-01T13:44:37+0700
author: Yogiswara Utama
commit: 4c10d0c
branch: main
repository: loker-watcher
topic: "Tech-debt run #3 clean baseline (N006-N009)"
tags: [plan, watch-yml, commit-state-rebase-script, gitattributes, spawnsync-tests, fetch-threads, index, guidance-docs]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-01_12-20-20_tech-debt-run3-clean-baseline.md
phase_count: 5
phases:
  - { n: 1, title: Commit-state script, files: [.gitattributes, scripts/commit-state-rebase.sh], depends_on: [] }
  - { n: 2, title: Offline suite, files: [tests/commit-state-rebase.test.ts], depends_on: [1] }
  - { n: 3, title: Production flip, files: [.github/workflows/watch.yml], depends_on: [1] }
  - { n: 4, title: Small src fixes, files: [src/fetch-threads.ts, src/index.ts], depends_on: [] }
  - { n: 5, title: Guidance re-sync, files: [.rpiv/guidance/.github/workflows/architecture.md, .rpiv/guidance/architecture.md, .rpiv/guidance/scripts/architecture.md, .rpiv/guidance/tests/architecture.md], depends_on: [1, 2, 3] }
unresolved_phase_count: 0
last_updated: 2026-11-01T13:44:37+0700
last_updated_by: Yogiswara Utama
---

# Tech-debt Run #3 Clean Baseline (N006-N009) Implementation Plan

## Overview

Extract the Commit state step's rebase/conflict-skip/push/retry body (.github/workflows/watch.yml:123-167) into `scripts/commit-state-rebase.sh` as the single source — one attempt function called at most twice with a fresh 50-skip budget per attempt, `set -e` self-owned, exit 0 = pushed / exit 1 = non-state conflict or second push failure — invoked exactly once from watch.yml. Pin the script's 4 core branches with an offline scratch-repo spawnSync suite, land the N006 (unexport) and N009 (stale comment) src fixes, and re-sync the 4 guidance docs with the skip-loop paraphrase going prose-only. Semantics of the moved body are preserved byte-for-byte; the 50-skip exhaustion echo is the single sanctioned deviation.

## Requirements

- FR2 (byte-for-byte): preserve commit-back semantics exactly — do not improve while moving. The block failed 5x in 40 minutes on first live exercise (89c8bc5..bc760cb); every historical failure was runner-only.
- Single source: exactly one internal retry inside the script; watch.yml invokes the script exactly once (bare line, no `|| true`, no `if !`, no YAML tail); the YAML-owned head (:107-116: bot identity, state-file-only add, no-op guard, jq delta commit) stays in watch.yml.
- Offline, deterministic test coverage for the extracted body's 4 core branches, following the `tests/format-on-edit.test.ts` spawnSync convention.
- N006 (unexport `PageMouseLike`) and N009 (delete the stale `src/index.ts` comment) land in the same pass.
- FR8 (guidance re-sync): 4 docs; the doc-side loop paraphrase goes prose-only so skip-loop tokens exist once repo-wide INCLUDING docs.
- Hard: jq must NOT become a dependency of the script (keeps the Windows test harness jq-free); the no-op guard must precede the invocation; the script sets `set -e` itself (errexit does not cross the process boundary).
- Hard (greppable acceptance): `git pull --rebase` absent from watch.yml; the invocation filename exactly once in watch.yml (the migrated F021 comment must NOT name it); skip-loop tokens once repo-wide scoped to watch.yml + guidance docs (`.rpiv/artifacts/` historical copies are immutable and excluded).
- Hard: state writes stay atomic and commit->push stays one shell on one workspace.
- Soft: script values hard-coded (the 50 bound gets its first defending comment); fail-visible exit codes.

## Current State Analysis

The commit-back logic exists as two verbatim copies inside one YAML step plus a doc paraphrase — untestable offline, undocumented at its 50 bound.

### Key Discoveries

- `.github/workflows/watch.yml:100-167` — the Commit state step at HEAD: F021 rationale comment :101-105, `run: |` :106 (implicit `bash -e {0}`, no `shell:` key), bot identity :107-108, `git add state/seen-posts.json` :109, no-op guard :110-113, PREV/CURR jq delta :114-115, byte-identical commit :116, lease/skip rationale :117-122, first-push body :123-143 (rebase :123, skip loop :125-139 with 50 bound, `git rebase --skip || true` :137, lease push :141-143), retry echo :144, verbatim retry copy :145-165, terminal echo+exit :166-167. Verified at HEAD 4c10d0c.
- `fetch-depth: 0` :57-61 exists ONLY because Commit state rebases; `permissions: contents: write` :8-9 and `concurrency: watch (cancel-in-progress: false)` :11-13 serialize single-writer state. All three survive unmoved.
- Skip-loop text exists in FOUR places today: watch.yml x2 + the guidance doc fence (.rpiv/guidance/.github/workflows/architecture.md:65-69, inside the :55-70 fence) + doc prose :111 ("Replicate the commit-back block exactly").
- `src/fetch-threads.ts:91-94` — `export interface PageMouseLike` under JSDoc :90; sole type-position use is `readonly mouse?: PageMouseLike` inside `PageLike` (:110). Producer (:171-178) builds an anonymous literal; no importer names the type. N006 = one-token edit, N004 precedent (ced76f8).
- `src/index.ts:152-154` — STALE pre-LinkedIn comment copy; :155-157 is the accurate per-platform copy to keep. Trap: BOTH copies contain "timed as one", so acceptance is content-grep (`grep -c "Acquisition stage" src/index.ts` = 1), not count-grep. N009 = delete :152-154 as a unit.
- Root `.gitattributes` does not exist (verified). Without the LF pin, autocrlf checks the script out CRLF and bash dies on \r — tests would false-red on Windows with a correct script.
- `npm test` auto-discovery: `package.json:9` (`tsx --test tests/*.test.ts` glob) picks up the new test file with zero registration; `tsconfig.json` includes `tests` (typecheck covers it); biome's lint allowlist never sees `.sh` — the suite is the script's ONLY automated coverage.
- spawnSync black-box precedents: `tests/format-on-edit.test.ts:15-31` and `tests/gate-destructive.test.ts` — module-scope path via `fileURLToPath`, per-test `mkdtemp` + try/finally `rm`, flake-free record. Both spawn Node; bash is the repo's FIRST non-Node spawn.
- Test count baseline: 238 (audit run #3, 4c10d0c); +4 = 242, re-verify at implementation.
- Windows bash probe: EXECUTED and PASSED on the dev box 2026-11-01 — `spawnSync('bash', ['-c', 'uname -s'])` answers `MINGW64_NT-10.0-26300`; `git --exec-path` fallback root viable. `where bash` returns 3 executables (PATH order is machine-specific — gate + fallback stay load-bearing).
- Guidance re-sync matrix (exact, from the research doc): workflows doc :21 + :65-69 (fence goes prose-only) + :111; root doc :8 + :11 + :22 (the research matrix's ":16" is stale vs disk — a blank line; the workflows pointer descriptor lives at :22); scripts doc :1/:4 + :6-9 + :10-18 + :31-36; tests doc :4 + :27. README/AGENTS.md/.rpiv/guidance/src/architecture.md need NO change (grep-confirmed behavior-level only).

## Desired End State

The Commit state step shrinks to head + comment + one line, and the script owns the moved body:

```yaml
- name: Commit state
  # F021 rationale (rewritten: references "the committed script under scripts/"
  # WITHOUT the literal filename — the invocation below must stay the only hit)
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add state/seen-posts.json
    if git diff --cached --quiet; then
      echo "state unchanged; nothing to commit"
      exit 0
    fi
    PREV=$(git show HEAD:state/seen-posts.json | jq '.seenPostIds | length' 2>/dev/null || echo 0)
    CURR=$(jq '.seenPostIds | length' state/seen-posts.json)
    git commit -m "state: $((CURR - PREV)) new seen post ids"
    bash scripts/commit-state-rebase.sh
```

`scripts/commit-state-rebase.sh` restructures the two verbatim loop copies into one attempt function called at most twice (fresh 50-skip budget per attempt), sets `set -e` itself, and exits 0 on push, 1 on non-state conflict abort or second push failure. The offline suite runs the script against scratch repos: clean push exits 0 with origin advanced; a state-only conflict skips to origin's version; a non-state conflict aborts with exit 1; a pre-receive rejection is retried exactly once (push-count file pins the integer 2).

Acceptance greps at the end state:
```
grep -c 'git pull --rebase' .github/workflows/watch.yml   # = 0
grep -c 'commit-state-rebase.sh' .github/workflows/watch.yml   # = 1
skip-loop tokens once repo-wide (scoped to watch.yml + guidance docs)
grep -c "Acquisition stage" src/index.ts   # = 1
npx knip   # clean of PageMouseLike
npm run typecheck && npm run lint && npm test   # green, 242 tests
```

## What We're NOT Doing

- N008 (received-vs-parsed counters) — HELD until `feature/add-support-for-linkeind` settles; design preserved in the research doc, message wording locked.
- N005 (judge.ts monolith split) — deferred per audit prescription; trigger = judge.ts next touched for real work.
- LinkedIn wheel-constant retune — deferred with N008.
- No semantic "improvements" to the moved body: no `--force-if-includes` (git-push man page hazard; production has no background fetch between checkout and push — preserve the refspec-less lease form verbatim), no other drive-by fixes.
- No runner-mode test simulation (lease races, queue serialization) — scratch repos cannot reproduce them; the manual `workflow_dispatch` acceptance stays the real test.
- No package.json changes: biome's lint allowlist never sees `.sh` (Option 1 needs zero config edits); no exec-bit chmod (the explicit `bash <script>` invocation form does not need it and Windows checkouts do not carry it).
- No jq inside the script (jq stays in the YAML head; keeps the Windows test harness jq-free).
- knip stays ad-hoc (not added to CI) — out of scope for this pass.

## Decisions

### D1: Extraction shape — bash script (Option 1)
**Ambiguity**: where does the moved body live? **Explored**: (A) composite action — zero spawnable file for the offline suite; breaks the pinned "only official actions/*" boundary; discover FRD rejected it. (B) TypeScript runner — 0/45 lines survive (rewrite of the repo's least-reviewed code); new silent-failure class (unchecked spawnSync `.status` replacing errexit). (C) reusable workflow — job-level invocation gets a FRESH runner; commit->push locality severs. **Decision**: bash script `scripts/commit-state-rebase.sh` — 45 of 45 body lines move near-verbatim (FR2 satisfied), GitHub-documented canonical step-level reuse pattern, offline-testable. Locked at discover (FRD) and confirmed by 4-candidate x 6-dimension scoring in the solutions artifact.

### D2: Root `.gitattributes` LF pin
`*.sh text eol=lf` — one line, developer-approved scope addition. Load-bearing for the TESTS (autocrlf would check the script out CRLF; bash exits 2/127 on \r). The pre-receive hook fixture is test-generated with \n so it is immune either way.

### D3: Suite shape — 4 black-box scratch-repo cases + cross-platform bash resolution
Cases (FRD "core branches" decision): (a) clean push -> exit 0, origin advanced; (b) state-only conflict skipped -> exit 0, origin keeps ITS version (accepted F021 cost, pinned); (c) non-state conflict -> exit 1, stderr /non-state conflict/, `work/.git/rebase-merge` gone, origin untouched; (d) pre-receive hook rejects push #1, accepts retry -> exit 0, push-count file reads exactly 2, retry echo present. Bash resolution evaluated once at module scope: `uname -s` MINGW/MSYS gate (reject the WSL imposter) -> `git --exec-path` fallback -> explicit skip with reason (node:test options-skip; `npm test` still exits 0). Windows probe PASSED on the dev box 2026-11-01.

### D4: N006 — drop `export` only
One-token edit at `src/fetch-threads.ts:91`; the interface stays referenced at :110. Mechanically identical to the N004 sweep (ced76f8, knip-verified).

### D5: N009 — delete `src/index.ts:152-154` as a unit
The stale pre-LinkedIn copy goes; :155-157 (per-platform wording, matches the code) stays. Partial splices (:152-156 / :153-157) would corrupt both blocks.

### D6: Invocation form — bare `bash scripts/commit-state-rebase.sh`, no YAML tail
No `|| true`, no `if !`, no retry in YAML (a residual tail would stack a second retry AND put the filename in watch.yml twice, mechanically failing the grep). The migrated F021 comment references "the committed script under scripts/" WITHOUT the literal filename. The lease/skip rationale comment (:117-122) migrates INTO the script — leaving it behind recreates the stale-comment debt class this run closes.

### D7: The 50-skip exhaustion echo — the single sanctioned deviation
New legibility behavior per FRD FR2 + audit TECH_DEBT_AUDIT.md:74: the echo goes between the loop's `done` and the enclosing `fi`, guarded by `test -d .git/rebase-merge`, then falls through into the same push. Everything else must diff as pure move; the deviation is recorded in the script comment so a future review does not read it as drift. The 50 bound gets its first defending comment (repo doctrine: values hard-coded + defended).

### D8: The YAML-owned head stays in watch.yml
Reasons: jq must not become a script dependency; the commit line stays greppable in YAML; the no-op guard must precede the invocation; bot identity is step plumbing.

### D9: Guidance re-sync — exact matrix, atomic, prose-only
4 docs per the research matrix; the :65-69 fence paraphrase goes PROSE-ONLY (no `git pull --rebase` / `git rebase --skip` / `--diff-filter=U` tokens) or the repo-wide once-grep stays broken; :111 re-points at the script. Same change set, atomic (b0b7dbe / 732a082 precedent).

## Phase 1: Commit-state script

### Overview
The extracted body lands as the single source: `.gitattributes` LF pin + `scripts/commit-state-rebase.sh` with the attempt function, self-owned `set -e`, exit contract, and defending comments. watch.yml is untouched — zero behavior change in this phase. Depends on nothing (foundation); every other phase builds on it.

### Changes Required:

#### 1. .gitattributes

**File**: .gitattributes
**Changes**: NEW — pins LF line endings for shell scripts so autocrlf cannot check the script out CRLF (bash dies on \r; the pin is load-bearing for the Phase 2 suite on Windows).

```text
*.sh text eol=lf
```

#### 2. scripts/commit-state-rebase.sh

**File**: scripts/commit-state-rebase.sh
**Changes**: NEW — the single source for the commit-back body: rebase onto main, bounded state-only skip loop, lease push, exactly one internal retry with a fresh 50-skip budget, exit 0 = pushed / exit 1 = non-state conflict abort or second push failure.

```sh
#!/bin/bash
#
# Commit-back body for watch.yml's "Commit state" step (F021): rebase onto
# main, skip state-only conflicts (bounded), lease-push, retry once.
#
# The Actions queue serializes watcher runs, but a human push can land
# between this run's checkout and its commit-back, so the push rebases onto
# main first. The rebase rewrites SHAs whenever main moved mid-run, making
# the push non-fast-forward by construction; --force-with-lease still
# rejects a concurrent push the local fetch has not seen. A state commit
# that conflicts against main's own state line is skipped whole (the next
# run re-judges; one duplicate digest is the accepted cost) instead of
# failing the run. ANY other conflicted path is real work failing to
# replay: abort loudly and exit 1.
#
# Invoked EXACTLY ONCE by watch.yml — the single retry lives here. The step
# shell consumes the exit contract with no wrapper: exit 0 = pushed; exit 1
# = non-state conflict abort or second push failure.
#
# This script sets errexit itself: the step shell's implicit 'bash -e' does
# not cross the process boundary. It must run from the workspace root (it
# never cd's — the relative .git/rebase-merge test only resolves there).
#
# Deviation ledger (FR2 byte-for-byte review aid): the ONLY deliberate
# deviation from the moved YAML body is the skip-bound exhaustion echo
# inside attempt() below (FRD FR2 + TECH_DEBT_AUDIT.md:74). Everything else
# is a verbatim move of watch.yml's former :123-167.
#
# The 50-skip bound is a runaway guard, not a tuning knob: a replayed
# commit conflicts at most once per state line, so 50 skips means the
# rebase is wedged; the bound is hard-coded per repo doctrine (no env
# tunables) and the exhaustion echo below makes hitting it legible.

set -e

# One commit-back attempt: rebase onto main (skipping state-only conflicts
# up to the bound), then lease-push; exit 0 the moment a push succeeds.
# The skip budget resets on every call — each attempt starts fresh (the
# former YAML body reset skips=0 the same way before each loop).
attempt() {
  if ! git pull --rebase origin main; then
    echo "state rebase conflicted; skipping conflicting state commits"
    skips=0
    while test -d .git/rebase-merge && [ "$skips" -lt 50 ]; do
      # Skip ONLY state-file conflicts; any other conflicted path is
      # real work failing to replay (F021's loud failure preserved).
      conflicts=$(git diff --name-only --diff-filter=U)
      if [ "$conflicts" != "state/seen-posts.json" ]; then
        echo "non-state conflict in: $conflicts — failing the run"
        git rebase --abort
        exit 1
      fi
      # --skip exits nonzero when it stops at the NEXT conflict; the
      # loop condition must see that, so this is set -e-proof.
      git rebase --skip || true
      skips=$((skips + 1))
    done
    # Deviation (the ledger's single entry): the bound exhausted with a
    # conflict still on the table — say so, then fall through to the same
    # push the unbounded former body would have attempted.
    if test -d .git/rebase-merge; then
      echo "state skip bound (50) exhausted; conflicts remain — attempting push anyway"
    fi
  fi
  if git push --force-with-lease; then
    exit 0
  fi
}

attempt
echo "state push rejected; rebasing onto main and retrying once"
attempt
echo "state push failed twice; failing the run"
exit 1
```

### Success Criteria:

#### Automated Verification:
- [x] Script parses clean: `bash -n scripts/commit-state-rebase.sh` exits 0
- [x] LF bytes only: `grep -c $'\r' scripts/commit-state-rebase.sh` = 0 (the LF pin normalizes checkout, not authoring — a CRLF-authored copy would die on \r at run time with only a bare syntax error as the signal; this check names the fault at write time)
- [x] LF pin present: `grep -c '^\*\.sh text eol=lf$' .gitattributes` returns 1
- [x] Git honors the pin: `git check-attr text eol -- scripts/commit-state-rebase.sh` reports `text: set` and `eol: lf`
- [x] Exactly one rebase per attempt: `grep -c 'git pull --rebase' scripts/commit-state-rebase.sh` = 1
- [x] Exactly two attempt call sites: `grep -c '^attempt$' scripts/commit-state-rebase.sh` = 2
- [x] Deviation ledger present: `grep -c 'Deviation ledger' scripts/commit-state-rebase.sh` = 1
- [x] watch.yml untouched this phase: `grep -c 'git pull --rebase' .github/workflows/watch.yml` = 2

#### Manual Verification:
- [x] Side-by-side read: script executable lines vs watch.yml :123-167 at HEAD — pure move plus the one exhaustion echo
- [x] The em dash in the non-state-conflict echo survived verbatim

## Phase 2: Offline suite

### Overview
Four black-box scratch-repo cases pin the script's core branches via spawnSync; the cross-platform bash resolution strategy (MINGW gate -> exec-path fallback -> explicit skip) rides at module scope. Auto-discovered by `npm test` (glob), typechecked via tsconfig. Depends on Phase 1; can run in parallel with Phase 4.

### Changes Required:

#### 2. tests/commit-state-rebase.test.ts

**File**: tests/commit-state-rebase.test.ts
**Changes**: NEW — 4-case black-box suite driving the real script against git scratch repos in OS temp; bash resolution + env hygiene (no GIT_* leakage, LC_ALL=C); v2-schema state fixtures.

```ts
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Black-box: the commit-state-rebase script runs as a real bash process
// against real git scratch repos under OS temp — the repo's first non-Node
// spawn, following the hooks suites' spawnSync convention
// (tests/format-on-edit.test.ts). The suite is the script's ONLY automated
// coverage (biome never sees .sh).
//
// Bash resolution runs ONCE at module scope (solutions-locked strategy):
// PATH bash wins only when `uname -s` answers MINGW/MSYS on win32 — the
// WSL launcher answers Linux and is the impostor to reject. Fallback:
// derive the Git-for-Windows bash from `git --exec-path` (…/mingw64/libexec
// /git-core → two levels up lands in mingw64, where bin/bash.exe lives).
// Neither: every test registers an explicit skip naming the problem
// (node:test options-skip; `npm test` still exits 0). Windows probe
// retired 2026-11-01 on the dev box: strategy 1 passed (MINGW64 answered;
// the exec-path fallback path was confirmed viable).
const SCRIPT = fileURLToPath(new URL("../scripts/commit-state-rebase.sh", import.meta.url));

/**
 * The child env: process.env minus every GIT_* variable — an ambient
 * GIT_DIR would hijack git inside the script AND inside this suite's own
 * fixtures, and a stray GIT_EXEC_PATH would redirect the probe's
 * `git --exec-path` — with LC_ALL pinned to C so git messages stay
 * byte-stable across machines.
 */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_")) continue;
    if (value !== undefined) env[key] = value;
  }
  env.LC_ALL = "C";
  return env;
}

/** Resolve the bash binary, or null when no trustworthy one exists. */
function probeBash(): string | null {
  const direct = spawnSync("bash", ["-c", "uname -s"], {
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (direct.status === 0 && typeof direct.stdout === "string") {
    if (process.platform !== "win32" || /MINGW|MSYS/.test(direct.stdout.trim())) {
      return "bash";
    }
  }
  if (process.platform === "win32") {
    const execPath = spawnSync("git", ["--exec-path"], {
      env: cleanEnv(),
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    if (execPath.status === 0 && typeof execPath.stdout === "string") {
      // .../mingw64/libexec/git-core: two levels up lands in mingw64,
      // where bin/bash.exe lives.
      const root = join(execPath.stdout.trim(), "..", "..");
      return join(root, "bin", "bash.exe");
    }
  }
  return null;
}

const BASH = probeBash();
const BASH_PROBLEM =
  BASH === null
    ? "bash unavailable or hostile on this machine (MINGW/MSYS gate and git --exec-path fallback both failed)"
    : null;

/**
 * Run git in `cwd`, returning stdout; throws naming the command on
 * failure — fixture setup must fail loudly, never pass vacuously.
 */
function git(cwd: string, args: string[]): string {
  const run = spawnSync("git", args, {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  if (run.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${String(run.status)}): ${run.stderr}`);
  }
  return run.stdout;
}

const T0 = "2026-11-01T00:00:00.000Z";
const T1 = "2026-11-01T06:00:00.000Z";

function stateJson(ids: Record<string, string>): string {
  return `${JSON.stringify({ version: 2, seenPostIds: ids }, null, 2)}\n`;
}

/**
 * One scratch scenario: a bare origin plus a work repo with identity
 * config, a v2-schema state seed (src/state.ts AppState), and upstream
 * set exactly as actions/checkout would leave it.
 */
interface Scratch {
  root: string;
  origin: string;
  work: string;
}

async function makeScratch(name: string): Promise<Scratch> {
  const root = await mkdtemp(join(tmpdir(), `lw-commit-state-rebase-${name}-`));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  git(root, ["init", "--bare", "-b", "main", "origin.git"]);
  git(root, ["init", "-b", "main", "work"]);
  const config: ReadonlyArray<readonly [string, string]> = [
    ["user.name", "loker-watcher test"],
    ["user.email", "test@loker-watcher.invalid"],
    ["commit.gpgsign", "false"],
    ["core.autocrlf", "false"],
  ];
  for (const [key, value] of config) {
    git(work, ["config", key, value]);
  }
  // Plain local path, not file:// — the script's own `git pull` must
  // reach origin the same way the fixture's git does.
  git(work, ["remote", "add", "origin", origin]);
  await mkdir(join(work, "state"), { recursive: true });
  await writeFile(join(work, "state", "seen-posts.json"), stateJson({ a: T0 }), "utf8");
  git(work, ["add", "state/seen-posts.json"]);
  git(work, ["commit", "-m", "initial state"]);
  git(work, ["push", "-u", "origin", "main"]);
  git(work, ["fetch", "origin"]);
  // The refspec-less `git push --force-with-lease` inside the script
  // needs upstream; production gets it from actions/checkout.
  git(work, ["branch", "--set-upstream-to", "origin/main", "main"]);
  return { root, origin, work };
}

/**
 * Simulate the human push that lands between the run's checkout and its
 * commit-back: a second clone commits to origin's main directly.
 */
async function advanceOrigin(
  root: string,
  origin: string,
  edits: { stateIds?: Record<string, string>; notes?: string },
): Promise<void> {
  const other = join(root, "other");
  git(root, ["clone", "--quiet", origin, "other"]);
  git(other, ["config", "user.name", "human pusher"]);
  git(other, ["config", "user.email", "human@loker-watcher.invalid"]);
  if (edits.stateIds !== undefined) {
    await writeFile(join(other, "state", "seen-posts.json"), stateJson(edits.stateIds), "utf8");
    git(other, ["add", "state/seen-posts.json"]);
  }
  if (edits.notes !== undefined) {
    await writeFile(join(other, "notes.md"), edits.notes, "utf8");
    git(other, ["add", "notes.md"]);
  }
  git(other, ["commit", "-m", "human push lands mid-run"]);
  git(other, ["push", "origin", "main"]);
}

/** Run the script under test in the work repo, as the workflow step would. */
function runScript(cwd: string): SpawnSyncReturns<string> {
  const bash = BASH;
  if (bash === null) throw new Error(BASH_PROBLEM ?? "bash unavailable");
  // The script path stays a Windows-style absolute argv (MSYS only remaps
  // /...-looking args). stdout and stderr stay SEPARATE: the script
  // signals through its exit code and its echoes route to stdout (the
  // former YAML body's echo did too).
  return spawnSync(bash, [SCRIPT], {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
}

/** Read the state blob on origin's main (bare repo: `git show` from inside). */
function originState(origin: string): string {
  return git(origin, ["show", "main:state/seen-posts.json"]);
}

const PRE_RECEIVE = `#!/bin/sh
# Test fixture: counts every push attempt into a sibling file; the first
# push is rejected while a sibling marker exists (consumed on use).
dir=$(dirname "$0")
count_file="$dir/push-count"
if [ -f "$count_file" ]; then
  n=$(cat "$count_file")
else
  n=0
fi
n=$((n + 1))
echo "$n" > "$count_file"
if [ -f "$dir/reject-first" ]; then
  rm "$dir/reject-first"
  echo "pre-receive: first-push rejection fixture"
  exit 1
fi
exit 0
`;

describe("commit-state-rebase script", () => {
  it(
    "pushes a clean state commit: exit 0, origin advanced",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("clean");
      try {
        await writeFile(
          join(work, "state", "seen-posts.json"),
          stateJson({ a: T0, b: T1 }),
          "utf8",
        );
        // The YAML-owned head this suite mimics: add + commit only.
        git(work, ["add", "state/seen-posts.json"]);
        git(work, ["commit", "-m", "state: 1 new seen post ids"]);
        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        assert.deepEqual(JSON.parse(originState(origin)), {
          version: 2,
          seenPostIds: { a: T0, b: T1 },
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "skips a state-only conflict to origin's version: exit 0, our id absent",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("state-skip");
      try {
        await writeFile(
          join(work, "state", "seen-posts.json"),
          stateJson({ a: T0, b: T1 }),
          "utf8",
        );
        git(work, ["add", "state/seen-posts.json"]);
        git(work, ["commit", "-m", "state: 1 new seen post ids"]);
        // The human push: a DIFFERENT state id lands on origin first.
        await advanceOrigin(root, origin, { stateIds: { a: T0, c: T1 } });
        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        // The accepted F021 cost, pinned: origin keeps ITS version — our
        // id b is gone and the next run re-judges those posts.
        assert.deepEqual(JSON.parse(originState(origin)), {
          version: 2,
          seenPostIds: { a: T0, c: T1 },
        });
        assert.doesNotMatch(run.stdout, /non-state conflict/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "aborts a non-state conflict: exit 1, rebase state cleaned, origin untouched",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("non-state");
      try {
        await writeFile(join(work, "notes.md"), "work side\n", "utf8");
        await writeFile(
          join(work, "state", "seen-posts.json"),
          stateJson({ a: T0, b: T1 }),
          "utf8",
        );
        git(work, ["add", "notes.md", "state/seen-posts.json"]);
        git(work, ["commit", "-m", "notes + state: 1 new seen post ids"]);
        // The human push: a notes.md of its own lands on origin first.
        await advanceOrigin(root, origin, { notes: "origin side\n" });
        const before = git(work, ["rev-parse", "HEAD"]).trim();
        const run = runScript(work);
        assert.equal(run.status, 1, `status ${String(run.status)}: ${run.stderr}`);
        // The abort message routes to STDOUT (echo), as in the YAML body.
        assert.match(run.stdout, /non-state conflict in: notes\.md/);
        // The abort actually unwound: no rebase in flight, HEAD unmoved.
        await assert.rejects(() => access(join(work, ".git", "rebase-merge")), /ENOENT/);
        assert.equal(git(work, ["rev-parse", "HEAD"]).trim(), before);
        // Origin untouched: its notes survive; our state id never landed.
        assert.match(git(origin, ["show", "main:notes.md"]), /origin side/);
        assert.deepEqual(JSON.parse(originState(origin)), {
          version: 2,
          seenPostIds: { a: T0 },
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "retries exactly once when the first push is rejected: exit 0, push count 2",
    { skip: BASH_PROBLEM ?? false },
    async () => {
      const { root, origin, work } = await makeScratch("retry");
      try {
        // Bare-origin pre-receive fixture: counts pushes, rejects the first.
        const hooksDir = join(origin, "hooks");
        await writeFile(join(hooksDir, "pre-receive"), PRE_RECEIVE, "utf8");
        await chmod(join(hooksDir, "pre-receive"), 0o755);
        await writeFile(join(hooksDir, "reject-first"), "consume me\n", "utf8");

        await writeFile(
          join(work, "state", "seen-posts.json"),
          stateJson({ a: T0, b: T1 }),
          "utf8",
        );
        git(work, ["add", "state/seen-posts.json"]);
        git(work, ["commit", "-m", "state: 1 new seen post ids"]);

        const run = runScript(work);
        assert.equal(run.status, 0, `status ${String(run.status)}: ${run.stderr}`);
        // "Exactly one retry" pinned as the integer 2.
        assert.equal((await readFile(join(hooksDir, "push-count"), "utf8")).trim(), "2");
        // The one-shot rejection was consumed on push #1.
        await assert.rejects(() => access(join(hooksDir, "reject-first")), /ENOENT/);
        // The retry echo proves attempt #2 ran the full body again.
        assert.match(run.stdout, /state push rejected; rebasing onto main and retrying once/);
        assert.deepEqual(JSON.parse(originState(origin)), {
          version: 2,
          seenPostIds: { a: T0, b: T1 },
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

```

### Success Criteria:

#### Automated Verification:
- [x] Standalone suite green: `npx tsx --test tests/commit-state-rebase.test.ts` exits 0 with 4 passing (skips only when the bash probe fails, naming the reason)
- [x] Typecheck covers the new file: `npm run typecheck` exits 0
- [x] Lint stays green (the suite is inside biome's tests scope): `npm run lint` exits 0
- [x] Scratch repos live under OS temp only: `grep -c 'lw-commit-state-rebase-' tests/commit-state-rebase.test.ts` = 1 (the mkdtemp prefix)
- [x] Env hygiene pinned in source: `grep -c 'startsWith("GIT_")' tests/commit-state-rebase.test.ts` = 1

#### Manual Verification:
- [x] On this dev box the suite passes without skips (the Windows bash probe retired 2026-11-01)
- [x] Case (d) output shows the retry echo; the counter file reads exactly 2
- [x] `git status --porcelain` clean after a suite run — no repo-side writes

## Phase 3: Production flip

### Overview
The Commit state step is rewired: YAML-owned head stays byte-identical, the F021 rationale comment migrates WITHOUT the literal filename, the lease/skip rationale moves into the script (already done in Phase 1), and the body becomes one bare invocation. The acceptance greps flip in this phase. Depends on Phase 1; ordered after Phase 2 so the suite pins the script before production uses it.

### Changes Required:

#### 3. .github/workflows/watch.yml:100-167

**File**: .github/workflows/watch.yml
**Changes**: MODIFY — Commit state step: keep the YAML-owned head (:107-116), rewrite the F021 comment (:101-105) without the script filename, delete body :117-167, append one bare `bash scripts/commit-state-rebase.sh` line.

```yaml
      - name: Commit state
        # F021: the queue serializes watcher runs, but a human push can land
        # between this run's checkout and its commit-back. The rebase, the
        # state-only conflict skip, the lease push, and the single retry all
        # live in the committed script under scripts/ — this step keeps only
        # the YAML-owned head: bot identity, the state-file-only add, the
        # no-op guard, and the jq delta commit.
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add state/seen-posts.json
          if git diff --cached --quiet; then
            echo "state unchanged; nothing to commit"
            exit 0
          fi
          PREV=$(git show HEAD:state/seen-posts.json | jq '.seenPostIds | length' 2>/dev/null || echo 0)
          CURR=$(jq '.seenPostIds | length' state/seen-posts.json)
          git commit -m "state: $((CURR - PREV)) new seen post ids"
          bash scripts/commit-state-rebase.sh
```

### Success Criteria:

#### Automated Verification:
- [x] The body is gone from YAML: `grep -c 'git pull --rebase' .github/workflows/watch.yml` = 0 (run-2's plan pinned =2; this flips it)
- [x] Single unwrapped invocation: `grep -c 'commit-state-rebase.sh' .github/workflows/watch.yml` = 1 (the bare line only — the comment must NOT name it)
- [x] No residual tail logic: `grep -c 'state push failed twice' .github/workflows/watch.yml` = 0 (that echo lives only in the script)
- [x] No retry wrapper: `grep -cE '\|\| true|if ! bash' .github/workflows/watch.yml` = 0
- [x] YAML-owned head intact: `grep -c 'git add state/seen-posts.json' .github/workflows/watch.yml` = 1 and `grep -c "jq '.seenPostIds | length'" .github/workflows/watch.yml` = 2
- [x] The step shell still fails the step on script failure: `grep -c '^          bash scripts/commit-state-rebase.sh$' .github/workflows/watch.yml` = 1 (bare line, last command, no wrapper)

#### Manual Verification:
- [x] Side-by-side: head lines byte-identical to HEAD :107-116; the rewritten comment references "the committed script under scripts/" WITHOUT the literal filename
- [ ] `workflow_dispatch` of watch.yml on a scratch branch after merge — the only real lease/queue/rebase-against-moved-main exercise (runner-only failure modes stay runner-only by design)

## Phase 4: Small src fixes

### Overview
N006: drop `export` from `PageMouseLike` (`src/fetch-threads.ts:91`) — one token, N004 precedent. N009: delete the stale acquisition-stage comment (`src/index.ts:152-154` as a unit; :155-157 stays). Depends on nothing; can run in parallel with Phases 2 and 3.

### Changes Required:

#### 4. src/fetch-threads.ts:91

**File**: src/fetch-threads.ts
**Changes**: MODIFY — unexport `PageMouseLike` (drop the `export` keyword); the type stays referenced by `PageLike.mouse` at :110.

```ts
/** Wheel-driven scroll controller (LinkedIn pagination; Threads scrolls via evaluate). */
-export interface PageMouseLike {
+interface PageMouseLike {
  move(x: number, y: number): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
}
```

#### 4. src/index.ts:152-154

**File**: src/index.ts
**Changes**: MODIFY — delete the stale 3-line comment copy (:152-154); the per-platform copy (:155-157) stays.

```ts
-  // Acquisition stage (D9): session resolution + surface fetch timed as one
-  // span. Extraction happens inside the walk; the dedupe count logs right
-  // after the duration line.
   // Acquisition stage (D9): per-platform session resolution + surface
   // fetch timed as one span. Extraction happens inside the walk; the
   // dedupe count logs right after the duration line.
```

### Success Criteria:

#### Automated Verification:
- [x] Unexport lands: `grep -c '^interface PageMouseLike' src/fetch-threads.ts` = 1 and `grep -c '^export interface PageMouseLike' src/fetch-threads.ts` = 0
- [x] Type stays referenced: `grep -c 'PageMouseLike' src/fetch-threads.ts` = 2 (the definition + the `PageLike.mouse` field)
- [x] Stale comment gone — content-grep, not count-grep (both copies contain "timed as one"): `grep -c 'Acquisition stage' src/index.ts` = 1 AND `grep -c 'per-platform' src/index.ts` = 1
- [x] knip clean: `npx knip 2>&1 | grep -c 'PageMouseLike'` = 0 (ad-hoc; no knip config exists — entry discovery rides npm scripts)
- [x] `npm run typecheck` exits 0
- [x] `npm run lint` exits 0

#### Manual Verification:
- [x] The kept comment copy matches the code it describes (per-platform resolution, one timed span, platform split before session resolution)
- [x] D9 stays resolvable: the doc-comment references at src/index.ts remain intact

## Phase 5: Guidance re-sync

### Overview
The 4-doc re-sync per the exact research matrix: the workflows doc fence goes prose-only (no command tokens), the highest-stakes :111 line re-points at the script, the root/scripts/tests docs gain the fourth file and the shell-script test category. Whole-plan gates (typecheck + lint + test) run here as the terminal phase. Depends on Phases 1, 2, and 3.

### Changes Required:

#### 5. .rpiv/guidance/.github/workflows/architecture.md:21,65-69,111

**File**: .rpiv/guidance/.github/workflows/architecture.md
**Changes**: MODIFY — :21 structure parenthetical -> delegation wording; :65-69 (inside the :55-70 fence) -> one-invocation description with the invariants as PROSE ONLY (no `git pull --rebase`/`git rebase --skip`/`--diff-filter=U` tokens); :111 "Replicate the commit-back block exactly" -> invoke the committed script. KEEP verbatim: heading :54, :56-64, F021 accepted-cost :71, secret-free :52, jq sync point :8.

```md
-            #   → Run watcher (step-scoped secrets) → Commit state (skip-loop + lease push)
+            #   → Run watcher (step-scoped secrets) → Commit state (script invocation)

    git commit -m "state: $((CURR - PREV)) new seen post ids"      # greppable delta history
-    git pull --rebase origin main
-    # rebase conflict loop: `git rebase --skip` ONLY while the conflict set is exactly
-    # state/seen-posts.json (bounded); ANY other conflicted path → rebase --abort, exit 1
-    if git push --force-with-lease; then exit 0; fi   # rebase rewrote SHAs ⇒ lease push
-    # ...identical rebase + skip cycle, push again, else: echo "state push failed twice"; exit 1
+    bash scripts/commit-state-rebase.sh   # the ONLY invocation — rebase, state-only
+                                          # conflict skips (bounded), lease push, and the
+                                          # single retry all live inside the script

+The script re-establishes errexit itself and exits 0 on push, 1 on a non-state conflict abort or a second push failure. It is invoked exactly once; the single retry lives inside it. Any conflicted path other than the state file aborts the run loudly.

-7. Pushing state? Replicate the commit-back block exactly (no-op guard, jq delta, state-only rebase skip-loop, `--force-with-lease` + one retry) and keep the jq path in sync with `AppState`
+7. Pushing state? Keep the YAML head (bot identity, state-file-only add, no-op guard, jq delta commit) and invoke `scripts/commit-state-rebase.sh` exactly once — the single retry lives inside the script; keep the jq path in sync with `AppState`
```

#### 5. .rpiv/guidance/architecture.md:8,11,22

**File**: .rpiv/guidance/architecture.md
**Changes**: MODIFY — :8 tree line gains the script fact; :11 scripts/ map gains the fourth file with its one-line role; :22 pointer descriptor extended (the research matrix's ":16" is stale vs disk — a blank line).

```md
-.github/workflows/  # ci.yml gate + watch.yml: cron */10 → npx tsx src/index.ts → state commit-back (+ dispatch-only probe job)
+.github/workflows/  # ci.yml gate + watch.yml: cron */10 → npx tsx src/index.ts → state commit-back via scripts/commit-state-rebase.sh (+ dispatch-only probe job)

-scripts/            # probe-judge.ts (measures the LLM endpoint, feeds JUDGE_CONCURRENCY) + Claude Code hooks
+scripts/            # commit-state-rebase.sh (state commit-back body: rebase + skip + push + one internal retry), probe-judge.ts (measures the LLM endpoint, feeds JUDGE_CONCURRENCY) + Claude Code hooks

- `.rpiv/guidance/tests/architecture.md` — offline conventions, doubles, fixtures, coverage map
-- `.rpiv/guidance/.github/workflows/architecture.md` — triggers, permissions, secret mapping, state commit-back
+- `.rpiv/guidance/.github/workflows/architecture.md` — triggers, permissions, secret mapping, state commit-back (script invocation)
```

#### 5. .rpiv/guidance/scripts/architecture.md:1,4,7,10-18,31-36

**File**: .rpiv/guidance/scripts/architecture.md
**Changes**: MODIFY — :1 + :4 "Three files" -> four, with the reclassification (the script is PRODUCTION RUNTIME, unlike probe + hooks); invokers :6-9 gain the watch.yml Commit state bullet; structure :10-18 gains the .sh entry (outside typecheck+lint, offline spawnSync-tested); exit-code contract :31-36 extended.

```md
-# scripts/ — dev tooling: endpoint probe + agent hooks
+# scripts/ — production commit-back script, endpoint probe + agent hooks

-Three files, deliberately separate from src/ (the production watcher): `probe-judge.ts` measures the LLM endpoint's latency and concurrency ceiling from an Actions runner; `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/ — the arrow points one way: scripts → src (the probe is a "zero-edit site" of judge.ts's API, measuring the EXACT production prompt).
+Four files, deliberately separate from src/ (the production watcher): `commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of watch.yml's Commit state step, executed by the only production write path; `probe-judge.ts` measures the LLM endpoint's latency and concurrency ceiling from an Actions runner; `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/ — the arrow points one way: scripts → src (the probe is a "zero-edit site" of judge.ts's API, measuring the EXACT production prompt).

 ## Invokers
+- **commit-state-rebase.sh**: watch.yml's Commit state step only — invoked EXACTLY ONCE (`bash scripts/commit-state-rebase.sh`, the bare last line; bot identity + the no-op guard stay in YAML). The single retry lives inside the script
 - **probe-judge.ts**: the dispatch-only `probe` GATE job in watch.yml, or locally `npx tsx scripts/probe-judge.ts` (needs `LLM_ACCOUNTS`; loads `watcher.config.json` at startup, so run from the repo root)

+commit-state-rebase.sh       # bash, set -e self-owned; OUTSIDE typecheck + lint + lint-staged
+                             #   (biome never sees .sh); LF-pinned by .gitattributes; offline
+                             #   spawnSync-tested by tests/commit-state-rebase.test.ts
 probe-judge.ts               # .ts, top-level await; imports loadWatcherConfig (keywords + reasoningEffort for the

+commit-state-rebase.sh      exit 0 = pushed; exit 1 = non-state conflict abort or second push
+                            failure — watch.yml's step shell consumes it with no wrapper
 probe-judge.ts              exit 1 on any failed leg, auth-dead 401/403, or ceiling < 1 — the probe job is a gate, so this reddens the dispatch run
```

#### 5. .rpiv/guidance/tests/architecture.md:4,27

**File**: .rpiv/guidance/tests/architecture.md
**Changes**: MODIFY — :4 scope gains the shell-script category (+ explicit-skip note); coverage map gains `scripts/commit-state-rebase.sh -> commit-state-rebase.test.ts` after :27.

```md
-Full-pipeline offline verification of src/ (plus the two Claude hooks in scripts/hooks/) via `node:test` + `tsx` (`tsx --test tests/*.test.ts`). Zero network, zero browser, zero writes inside the repo, zero mocking libraries — every double is a hand-written literal.
+Full-pipeline offline verification of src/ (plus the commit-state-rebase shell script in scripts/ and the two Claude hooks in scripts/hooks/) via `node:test` + `tsx` (`tsx --test tests/*.test.ts`). Zero network, zero browser, zero writes inside the repo, zero mocking libraries — every double is a hand-written literal. The bash-spawning suite resolves bash once at module scope (MINGW/MSYS gate + `git --exec-path` fallback) and skips EXPLICITLY — naming the problem — when none resolves; `npm test` still exits 0.

 scripts/hooks/*    → gate-destructive.test.ts, format-on-edit.test.ts   # black-box spawnSync; import no src code
+scripts/commit-state-rebase.sh → commit-state-rebase.test.ts   # black-box scratch-repo git scenarios; bash gate + explicit skip
```

### Success Criteria:

#### Automated Verification:
- [x] Whole-plan gates: `npm run typecheck && npm run lint && npm test` exits 0 with 242 tests (238 baseline + 4 — re-verify the exact total)
- [x] No skip-loop command tokens left in YAML or docs: `grep -rn -e 'git pull --rebase' -e 'git rebase --skip' -e '--diff-filter=U' .github/workflows/watch.yml .rpiv/guidance/` reports no matches (the single live copy of each token is inside scripts/commit-state-rebase.sh)
- [x] The workflows doc carries the invocation exactly twice (fence + the re-pointed instruction): `grep -c 'commit-state-rebase.sh' .rpiv/guidance/.github/workflows/architecture.md` = 2
- [x] The duplication instruction is gone: `grep -c 'Replicate the commit-back block exactly' .rpiv/guidance/.github/workflows/architecture.md` = 0
- [x] Root doc names the script in both pins (tree + scripts map): `grep -c 'commit-state-rebase.sh' .rpiv/guidance/architecture.md` = 2
- [x] Scripts doc reclassified: `grep -c 'Four files' .rpiv/guidance/scripts/architecture.md` = 1
- [x] Tests doc scope + coverage map updated: `grep -c 'commit-state-rebase' .rpiv/guidance/tests/architecture.md` = 2

#### Manual Verification:
- [x] All four docs read coherently — no dangling "replicate the block" instruction, no doc-side skip-loop paraphrase
- [x] The 4-doc re-sync lands as ONE atomic change set (b0b7dbe / 732a082 doc-set half) — deliberately TRAILING the Phase 3 flip per Ordering Constraints, a recorded deviation from the precedent's same-minute form: the stale-docs window between flip and re-sync is bounded to one change set, not open-ended
- [ ] The `workflow_dispatch` acceptance (Phase 3's manual gate) remains the one post-merge check

## Ordering Constraints

- Phase 1 is the foundation: everything else depends on the script existing.
- Phase 2 (suite) depends on Phase 1 and should land before Phase 3 (pin before flip). It can run in parallel with Phase 4.
- Phase 3 (production flip) depends on Phase 1 only, but is ordered after Phase 2.
- Phase 4 (src fixes) is fully independent — can run in parallel with Phases 2 and 3.
- Phase 5 (docs) depends on Phases 1, 2, and 3 (docs describe the final shape, including the Phase 2 test file the scripts-doc structure entry names) and is last; the whole-plan gates (typecheck + lint + test) are its terminal act.
- Sequential execution 1 -> 2 -> 3 -> 4 -> 5 is always safe.

## Verification Notes

- Acceptance greps (scoped; `.rpiv/artifacts/` historical copies are immutable and excluded):
  - `grep -c 'git pull --rebase' .github/workflows/watch.yml` = 0 (run-2's plan pinned =2 at plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md:3159; this pass flips it to 0)
  - `grep -c 'commit-state-rebase.sh' .github/workflows/watch.yml` = 1 (the invocation only — the comment must NOT name it)
  - Skip-loop tokens once repo-wide scoped to watch.yml + guidance docs (`git rebase --skip` appears once, inside the script)
  - `grep -c "Acquisition stage" src/index.ts` = 1 (content-grep, not count-grep — both copies contain "timed as one")
  - `npx knip` clean of PageMouseLike (ad-hoc; no knip config exists — entry discovery rides npm scripts)
- Gates: `npm run typecheck && npm run lint && npm test` green; test count 238 -> 242 (re-verify the total at implementation).
- The suite is the script's ONLY automated coverage (biome never sees `.sh`); runner-only failure modes (lease mismatch vs moved remote-tracking ref, rebase SHA rewrite, queue serialization) stay runner-only — keep the manual `workflow_dispatch` acceptance check; do not simulate lease races in scratch repos.
- Byte-for-byte deviation ledger: the 50-skip exhaustion echo is the SINGLE sanctioned deviation (FRD FR2 + TECH_DEBT_AUDIT.md:74); it is recorded in the script comment. Everything else must diff as pure move.
- `git rebase --skip || true` must survive INSIDE the loop — without it errexit aborts on the first skip (the loop's one deliberate non-fatal command).
- `git rebase --abort` runs BEFORE `exit 1` — order is load-bearing (the local state commit survives for the next run).
- Preserve the refspec-less `git push --force-with-lease` form verbatim (FR2) — do NOT improve to `--force-if-includes` while moving (git-push man page: background fetches defeat the lease; production has none between checkout and push).
- Windows bash resolution: uname-MINGW/MSYS gate + `git --exec-path` fallback + explicit skip with reason (node:test options-skip; `npm test` still exits 0). Probe PASSED on the dev box 2026-11-01; CI is ubuntu-only, so any machine-specific Windows bash break is local-dev pain and never reds CI.
- Test env hygiene: strip every `GIT_*` var (ambient `GIT_DIR` would hijack the script's git), `LC_ALL: "C"`, fixtures with `commit.gpgsign false`, `core.autocrlf false`, `branch --set-upstream-to=origin/main main` (production gets upstream from actions/checkout; scratch init does not), remote = plain local path (not file://), state file shaped to v2 schema (`src/state.ts:35`, jq `length` counts keys).
- One-time live probe of bash resolution on this dev box: RESOLVED 2026-11-01 (strategy 1) — recorded in the solutions artifact Follow-up.

## Performance Considerations

- The script runs once per 10-minute run; no hot path changes. The job timeout envelope (F023 arithmetic in watch.yml) is unaffected (one extra process spawn is negligible).
- The suite spawns real git in OS-temp scratch repos: 4 cases x a handful of git spawns each; bash resolution evaluated once at module scope; per-spawn timeout 60s. Expected suite cost: a few seconds on CI, comparable locally on Windows.
- No caching, pooling, or concurrency changes anywhere in this plan.

## Migration Notes

- No persisted schema or data change: the state file, its v2 schema, and `src/state.ts` are untouched; the jq delta head keeps reading `seenPostIds` identically.
- Rollback is trivial: delete the 3 new files (script, test, `.gitattributes`) and restore the 45 body lines in watch.yml. No state, no deps, no config to unwind.

## Pattern References

- `tests/format-on-edit.test.ts:15-31` — the spawnSync + mkdtemp + try/finally template the suite follows.
- `tests/gate-destructive.test.ts` — the second black-box spawnSync precedent (exit-code pins on stderr).
- `scripts/probe-judge.ts:187,243` — exit-code contract through a step shell (process.exit(1) gates).
- `.github/workflows/watch.yml:38` — TS script invocation precedent (`npx tsx scripts/probe-judge.ts`); this plan adds the repo's first bash script invocation.
- N004 sweep: commit ced76f8 — the mechanically identical unexport precedent N006 repeats.
- Guidance re-sync precedent: b0b7dbe, 732a082 — same-minute atomic doc sync with the behavior change.

## Developer Context

**Q (Step 4 checkpoint: design confirmation)**: Design locked — bash-script extraction (scripts/commit-state-rebase.sh, single source, one invocation), 4-case offline suite, .gitattributes LF pin, N006+N009 one-token/3-line src fixes, 4-doc guidance re-sync. Ready to proceed to decomposition?
**A**: Proceed (Recommended).

**Q (Step 5 checkpoint: decomposition)**: 5 slices — (1) commit-state script + .gitattributes foundation, (2) offline suite, (3) watch.yml flip, (4) N006+N009 src fixes, (5) 4-doc guidance re-sync + final gates. Approve?
**A**: Approve (Recommended).

**Inherited decisions** (discover + solutions Developer Context, recorded — never re-ask):
- Primary pain: clean baseline — zero known debt so the next feature starts clean.
- N007 shape: bash script owning rebase + skip + push + single retry; watch.yml invokes exactly once (supersedes the audit's two-invocation wording).
- 50-skip exhaustion echo: fold in (the single sanctioned deviation).
- Script test depth: core branches — 4 offline cases.
- .gitattributes: add (scope addition, developer-approved).
- N008: HOLD until `feature/add-support-for-linkeind` settles; message wording locked ("N of M flagship-web response(s) parsed within 30000ms — non-200/blocked or format change?").
- N005: keep deferred (audit prescription; trigger = judge.ts next touched for real work).
- Windows bash probe: retired on the dev box 2026-11-01 (strategy 1 passed); gate + fallback stay load-bearing for other machines/PATH orderings.

**Phase 1 micro-checkpoint**: slice-verifier OK x3 (FR2 line walk matched every executable line + the em dash vs on-disk :123-167; errexit parity through the function wrap confirmed). Approved as generated.

**Phase 2 micro-checkpoint**: first verifier pass returned 1 VIOLATION (the four it() signatures exceeded biome's 100-col width — a format diff would red `npm run lint`) and 1 WARNING (probeBash spawns inherited ambient GIT_*; a stray GIT_EXEC_PATH could redirect the exec-path fallback). Fixed: (a) the suite source is now the byte-exact output of `biome format --stdin-file-path` under the repo config — round-2 diff empty (idempotent); the stdin-mode check exit-1 artifact was ruled out via a control run on the known-clean tests/format-on-edit.test.ts (same stdin exit-1, direct file check exit 0); (b) cleanEnv() hoisted above probeBash and passed to both probe spawns; (c) git-root comment corrected (two levels up lands in mingw64). `npx tsc --noEmit` with the repo strict flags exits 0. Re-verification OK x3. Approved as generated.

**Research correction (Phase 2)**:

**Phase 3 micro-checkpoint**:

**Phase 4 micro-checkpoint**:

**Phase 5 micro-checkpoint**: verifier round 1 returned 5 VIOLATIONS (mid-line hunk splits on single-physical-line docs, a missing `-` marker + wrong indent on the :21 pair, a truncated probe-bullet re-emit, a stale ":16" matrix ref) — all hunks rebuilt byte-exact against disk (12-space indent awk-verified; root pointer corrected to :22; whole-line replaces; probe bullet untouched context). Round 2 re-verified every line byte-exact EXCEPT one garnish context line (:20) whose indent the verifier measured 12 and 13 across runs — its own report flags the grep {n} quantifier as broken — so the context line was DELETED rather than re-measured (ratified at the 6.3 checkpoint). Also fixed: skeleton Changes-line ":16" → ":22" and the scripts range ":6-9" → ":7". Approved as revised. slice-verifier OK x3 on first pass (both hunks byte-matched against on-disk context; importer census holds — fetch-linkedin.ts:38 imports only ContextLike; acceptance greps are content-greps where research demands them). Approved as generated. slice-verifier OK x3 on first pass (head walked char-by-char vs on-disk :107-116 — byte-identical; zero filename occurrences outside the invocation; exit contract consumes the script's 0/1 with no wrapper; nothing else in watch.yml touched). Approved as generated. the research doc's case-(c) pin said "stderr matches /non-state conflict/" — but the script's echo routes to STDOUT (exactly as the former YAML body's echo did), so the suite pins `run.stdout` instead. Documented in the suite's runScript comment.

## Plan History

- Phase 1: Commit-state script — approved as generated
- Phase 2: Offline suite — revised: biome-canonical formatting (byte-exact `biome format` output) + probe env hygiene (cleanEnv on both spawns) per slice-verifier VIOLATION/WARNING; re-verified OK x3
- Phase 3: Production flip — approved as generated
- Phase 4: Small src fixes — approved as generated
- Phase 5: Guidance re-sync — revised: hunks rebuilt byte-exact against on-disk docs per slice-verifier (whole-line replaces, marker fix, :22 matrix correction); residual context-line nit resolved by deleting the garnish line

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Current State Analysis (watch.yml refs) | .github/workflows/watch.yml:8-13 | suggestion | codebase-fit | Key Discoveries cites "`permissions: contents: write` :6-7 and `concurrency: watch (cancel-in-progress: false)` :9-11" but disk has `permissions:` at :8-9 and `concurrency:` at :11-13 — both refs are off by 2 (the load-bearing :100-167 mapping is verified correct) | Correct the two refs to :8-9 and :11-13 so the artifact's line map stays grep-trustworthy | applied: refs corrected to :8-9 / :11-13 |
| code | Phase 1 §1 (.gitattributes) | <n/a> | suggestion | code-quality | The `*.sh text eol=lf` pin governs checkout/normalization only — a worktree copy of the NEW script authored with CRLF bytes stays CRLF (git add renormalizes the index, not the worktree), and Phase 2 executes the worktree copy, so the exact CR death D2 cites can still occur at creation with only `bash -n`'s bare syntax error as the signal | Add a Phase 1 automated check naming the fault, e.g. `grep -c $'\r' scripts/commit-state-rebase.sh` = 0, so a CRLF-authored file is diagnosed at write time | applied: CRLF check added to Phase 1 Automated Verification |
| code | Phase 5 frontmatter | <n/a> | suggestion | actionability | Phase 5's front-matter declares `depends_on: [1, 3]` but its doc hunks name `tests/commit-state-rebase.test.ts` (the scripts-doc structure entry) and the coverage-map entry — a Phase 2 artifact — so a scheduler parallelizing on `depends_on` could re-sync docs onto a not-yet-existing test file | Add 2 to Phase 5's `depends_on` so the metadata matches the Ordering Constraints prose ("Phase 5 … is last") | applied: depends_on now [1, 2, 3]; Phase 5 Overview + Ordering Constraints prose updated to match |
| coverage | ## Pattern References §6 | <n/a> | suggestion | verification-coverage | Precedent "b0b7dbe, 732a082 — same-minute atomic doc sync with the behavior change" — D9 claims "Same change set, atomic" off this precedent, but criteria NOT FOUND (Phase 5 Success Criteria verify only doc-content greps; no bullet pins the re-sync landing as one atomic change set) and code NOT FOUND (change-set atomicity has no mirror in any Phase fence); the "with the behavior change" half is structurally unmet (Phase 5 ordered after the Phase 3 flip per Ordering Constraints), leaving the stale-docs window between flip and re-sync unpinned | Add a Phase 5 Manual Verification bullet: "The 4-doc re-sync lands as one atomic change set (b0b7dbe/732a082 doc-set half), explicitly recording the deliberate deviation that docs trail the Phase 3 flip per Ordering Constraints" | applied: atomic-change-set bullet added to Phase 5 Manual Verification (with the docs-trail-the-flip deviation recorded) |

## References

- `.rpiv/artifacts/solutions/2026-11-01_12-20-20_tech-debt-run3-clean-baseline.md` — the solutions artifact this plan blueprints (Option 1 scoring, Windows probe follow-up)
- `.rpiv/artifacts/research/2026-11-01_11-26-26_tech-debt-run3-clean-baseline.md` — full research (boundary anatomy, fixture factory, exact doc matrix, N008 preserved design)
- `.rpiv/artifacts/discover/2026-11-01_11-01-27_tech-debt-run3-clean-baseline.md` — the FRD (locked decisions, composite-action rejection)
- `.github/workflows/watch.yml:100-167` — the extraction surface
- `tests/format-on-edit.test.ts:15-31` — the spawnSync template
- `scripts/probe-judge.ts:187,243` — exit-code precedent
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — N006-N009 findings; the "least-reviewed code" verdict
- `.rpiv/artifacts/plans/2026-10-30_15-02-33_tech-debt-audit-remediation.md:3159` — the run-2 grep (=2) this pass flips to 0
- GitHub docs: "Adding scripts to your workflow"; workflow-syntax `steps[*].shell`; git-push(1) `--force-with-lease`
