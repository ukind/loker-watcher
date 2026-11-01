---
template_version: 1
date: 2026-11-01T17:22:04+0700
author: Yogiswara Utama
commit: 4c10d0c
branch: main
repository: loker-watcher
topic: "Validation of Tech-debt run #3 clean baseline (N006-N009)"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-01_13-44-37_tech-debt-run3-clean-baseline.md"
tags: [validation, watch-yml, commit-state-rebase-script, gitattributes, spawnsync-tests, fetch-threads, index, guidance-docs]
last_updated: 2026-11-01T17:22:04+0700
---

## Validation Report: Tech-debt run #3 clean baseline (N006-N009)

### Implementation Status

- ✓ Phase 1: Commit-state script — Fully implemented
- ✓ Phase 2: Offline suite — Fully implemented
- ✓ Phase 3: Production flip — Fully implemented
- ✓ Phase 4: Small src fixes — Fully implemented
- ✓ Phase 5: Guidance re-sync — Fully implemented (one comment-only deviation, see Findings)

### Automated Verification Results

- ✓ Script parses clean: `bash -n scripts/commit-state-rebase.sh` — exit 0
- ✓ LF bytes only: `grep -c $'\r' scripts/commit-state-rebase.sh` = 0
- ✓ LF pin present: `.gitattributes` carries exactly one `*.sh text eol=lf` line; `git check-attr text eol` reports `text: set`, `eol: lf`
- ✓ Script internals: `git pull --rebase` = 1, `^attempt$` call sites = 2, `Deviation ledger` = 1
- ✓ Body gone from YAML: `git pull --rebase` in watch.yml = 0 (run-2's =2 pin flipped)
- ✓ Single unwrapped invocation: `commit-state-rebase.sh` in watch.yml = 1 (the bare 10-space-indented last line; the migrated comment does not name the file)
- ✓ No residual tail logic: `state push failed twice` in watch.yml = 0; retry-wrapper regex = 0
- ✓ YAML-owned head intact: `git add state/seen-posts.json` = 1; `jq '.seenPostIds | length'` = 2
- ✓ N006 unexport: `^interface PageMouseLike` = 1, `^export interface PageMouseLike` = 0; exactly 2 references repo-wide (definition + `PageLike.mouse`); `npx knip` clean of it (empty report)
- ✓ N009 stale comment gone: `Acquisition stage` = 1, `per-platform` = 1 (content-greps as planned)
- ✓ Suite hygiene pins: mkdtemp prefix `lw-commit-state-rebase-` = 1; `startsWith("GIT_")` env strip = 1
- ✓ Skip-loop tokens once repo-wide: `git pull --rebase` / `git rebase --skip` / `--diff-filter=U` — 0 matches across watch.yml and all of `.rpiv/guidance/` (the single live copy of each is inside the script)
- ✓ Doc greps: workflows doc invocation = 2; `Replicate the commit-back block exactly` = 0; root doc = 2; scripts doc `Four files` = 1; tests doc `commit-state-rebase` = 2
- ✓ Standalone suite: `npx tsx --test tests/commit-state-rebase.test.ts` — 4 passing, 0 skipped (~9 s)
- ✓ Gates: `npm run typecheck` exit 0; `npm run lint` 37 files clean; `npm test` 242/242 (238 baseline + 4, exactly as planned) — run twice, reproducible
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- scripts/commit-state-rebase.sh — verbatim move walked line-by-line against HEAD watch.yml :123-167: the rebase/skip/push body is token-identical (em dash in the non-state echo survived); the ONLY structural deltas are the attempt() function wrapper, its two call sites, and the sanctioned exhaustion echo (`if test -d .git/rebase-merge` between the loop's `done` and the enclosing `fi`, falling through to the same push) — exactly D7's shape, recorded in the script's deviation ledger
- .github/workflows/watch.yml:100-118 — YAML-owned head byte-identical (absent from the diff); F021 comment rewritten referencing "the committed script under scripts/" without the literal filename; body reduced to one bare 10-space `bash scripts/commit-state-rebase.sh` line
- tests/commit-state-rebase.test.ts — follows the tests/format-on-edit.test.ts spawnSync convention: module-scope path resolution, per-scenario mkdtemp + try/finally rm, exit-code pins, separate stdout/stderr, per-spawn timeouts, GIT_* env hygiene, MINGW/MSYS gate + git --exec-path fallback, explicit skip with reason
- .gitattributes, src/fetch-threads.ts, src/index.ts — exactly the plan's one-line / three-line edits, nothing else

#### Deviations from Plan:

- .rpiv/guidance/architecture.md:21 — the workflows-doc pointer line carries a DOUBLE leading dash (`--`) in the working tree. At HEAD the same line has a single dash (byte-verified with cat -A), and the plan's + hunk specifies a single dash. The stray character breaks the markdown list item (renders as literal text). Comment-only class: no executable line, no criterion greps affected (all pass), nothing downstream fails — non-blocking. One-character fix: change `--` to `-` at :21.

#### Pre-existing working-tree changes (no --baseline provided; judged against the whole tree)

- Two files outside the plan's write-set are modified: .rpiv/artifacts/TECH_DEBT_AUDIT.md and .rpiv/guidance/src/architecture.md; the four declared docs also carry re-sync hunks beyond the plan's exact matrix (LinkedIn-era sync points, probe wording, tests-doc coverage-map rewrite, hook-section additions)
- Evidence they pre-date this implementation: the plan's own Phase 5 history says its hunks were rebuilt byte-exact against ON-DISK docs (not HEAD), and Key Discoveries records a doc line ref "stale vs disk" — the docs were already dirty when the plan was authored, i.e. earlier-today audit/LinkedIn doc work sharing the working tree
- Verified harmless: guidance/src names no commit-back mechanism (grep empty), so nothing there went stale from the move; TECH_DEBT_AUDIT.md's commit-back description stays behavior-level true post-move; the token-once greps pass across all of guidance/ regardless. Non-blocking — but these files ride the same eventual commit and must be included deliberately, not silently

#### Pattern Conformance:

- ✓ The suite mirrors the repo's two black-box spawnSync precedents (format-on-edit, gate-destructive): scratch isolation in OS temp, no repo-side writes (git status identical before/after the suite run), flake-free across two runs
- ✓ The script keeps the repo's fail-visible doctrine: self-owned errexit, exit contract 0/1, abort-before-exit order preserved
- Minor observation: the suite is the script's only automated coverage (biome never sees .sh) — as the plan itself prescribes, not a gap

### Manual Testing Required:

1. Post-merge (runner-only, by design):
   - [ ] `workflow_dispatch` of watch.yml on a scratch branch — the only real lease/queue/rebase-against-moved-main exercise (Phase 3's and Phase 5's open checkbox)
2. Executed during this validation (all passed, no longer open):
   - [x] Phase 1 side-by-side pure-move read + em-dash survival
   - [x] Phase 2 suite passes without skips on this dev box; case (d) retry echo + push-count = 2 (pinned by the passing test); git status clean after the suite
   - [x] Phase 3 head byte-identity + filename-free comment
   - [x] Phase 4 kept comment matches the code (per-platform split, one timed span); D9 references intact (4 sites)
   - [x] Phase 5 all four docs read coherently — no dangling "Replicate" instruction, no doc-side skip-loop paraphrase; the 4-doc re-sync is one working-tree change set (pin it as ONE commit at /skill:commit)

### Recommendations:

- Fix the one-character deviation before committing: `--` → `-` at .rpiv/guidance/architecture.md:21, then (optionally) re-run /skill:validate
- At /skill:commit, land the guidance re-sync as one atomic commit per D9 and include the two undeclared-but-related doc files deliberately
- After merge: run the workflow_dispatch acceptance once on a scratch branch before trusting the cron
- Otherwise ready to commit — implementation is complete and validated
