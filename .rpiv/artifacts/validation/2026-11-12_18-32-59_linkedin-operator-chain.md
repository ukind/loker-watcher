---
date: 2026-11-12T18:32:59+0700
author: Yogiswara Utama
commit: 559ad54
branch: main
repository: loker-watcher
topic: "Validation of LinkedIn operator chain (login -> probe -> one fetch tick)"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-12_15-41-06_linkedin-operator-chain.md"
tags: [validation, plan, linkedin-chain, probe-linkedin, runProbe, scripts, pc-local]
last_updated: 2026-11-12T18:32:59+0700
---

## Validation Report: LinkedIn operator chain (login -> probe -> one fetch tick)

### Implementation Status

- ✓ Phase 1: runProbe extraction + its offline suite — Fully implemented
- ✓ Phase 2: the chain entry + npm wiring — Fully implemented
- ✓ Phase 3: the chain suite — Fully implemented
- ✓ Phase 4: the doc sweep — Fully implemented
- ✓ Phase 5: the session-hygiene fold-in (declared post-validate) — Fully implemented

### Automated Verification Results

- ✓ Whole-project typecheck: `npm run typecheck` — clean, exit 0
- ✓ Whole-project lint: `npm run lint` — 65 files checked, no fixes applied, exit 0
- ✓ Whole-project suite: `npm test` — 584 tests / 584 pass / 0 fail, exit 0 (working tree)
- ✓ New suites in isolation: `npx tsx --test tests/probe-linkedin.test.ts tests/linkedin-chain.test.ts` — 19 pass / 0 fail in one run (chain pins + probe pins together; the plan's per-file counts are subsets of this run)
- ✓ Phase 1 entry-guard pin: importing `scripts/probe-linkedin.ts` exports `runProbe`, `ProbeDeps`, `ProbeResult`, the two tagged gates and their guards — zero other output, no config load, no browser
- ✓ Phase 2 entry-guard pin: importing `scripts/linkedin-chain.ts` exports `runLinkedInChain` only — zero other output
- ✓ Phase 2 D2 single-read pin: `envWithDotEnv` appears once as executable code (scripts/linkedin-chain.ts:84); the other three hits are the import and two comments
- ✓ Phase 2 npm wiring: `package.json` carries the `linkedin-chain` script (line 20) and `scripts/linkedin-chain.ts` in both the lint (line 13) and format (line 14) lists
- ✓ Phase 2 behavior pins: order login -> probe -> exactly one tick, abort arms by error identity, D2 cookiePath forwarding, D3 quiet-zero classification — all green in the full suite
- ✓ Phase 4 floor drift gone: `grep -rn "fewer than 2 posts" README.md AGENTS.md .rpiv/guidance/` — 0 matches
- ✓ Phase 4 chain registered on all four surfaces: `grep -l "linkedin-chain"` names README.md, AGENTS.md, .rpiv/guidance/architecture.md, .rpiv/guidance/scripts/architecture.md; `grep -c "npm run linkedin-chain" README.md` = 2
- ✓ Phase 4 coverage map: `NO TESTS BY DESIGN` matches the probe-judge-only line (guidance/tests/architecture.md:48); `probe-linkedin.test.ts` (line 49) and `linkedin-chain.test.ts` (line 53) rows present
- ✓ Phase 4 "Nine files": guidance/scripts/architecture.md:4 carries it; "Eight files" returns 0 matches
- ✓ Phase 4 factory drift gone: `headless-Chromium` and `cookie DOCUMENT` both return 0 matches across .rpiv/guidance/ and AGENTS.md
- ✓ Phase 4 probe block contract: `runProbe` (line 41) and `PROBE_MIN_POSTS=10` (line 46) both present in guidance/scripts/architecture.md
- ✓ Phase 5 SCROLL_JS export + pins: exported at src/linkedin-fetch.ts:154, consumed at :597; tests/fetch-linkedin.test.ts:858-876 pins the four candidate selectors and the sel/top/sh/ch return shape
- ✓ Phase 5 msedge pins: `channel: "msedge"` matches src/linkedin-fetch.ts:331 and scripts/login-linkedin.ts:149 — one hit each
- ✓ Phase 5 keepOpenForArgv seam: exported at scripts/login-linkedin.ts:175, used in the entry arm at :267 (no inline flag logic), pinned both ways at tests/login-linkedin.test.ts:260-266
- ✓ Phase 5 standalone-login doc drift: README.md:311, AGENTS.md:52, and guidance/scripts/architecture.md lines 9, 56, 111 all name the Enter hold and the `--auto-close` escape
- ✓ Phase 5 rehearsal record on disk: the discover artifact carries the A/B counts (line 153: feed-first passed, kicking sequence documented), the research artifact carries the kick mechanism (line 161), and the code comments carry the protocol (scripts/login-linkedin.ts:38-42)
- ✓ Probe CLI contract preserved: scripts/probe-linkedin.ts:178-210 keeps the `probe: all checks passed` line and the HALT / LEG DEAD / FAILED arms with `process.exit(1)`
- ✓ Runnable manual check — probe fail-visible: `LINKEDIN_COOKIES_FILE=<missing> npx tsx scripts/probe-linkedin.ts` prints `probe: FAILED — linkedin-cookies: ... does not exist` and exits 1 before any browser build
- ✓ Runnable manual check — stage-3 gate on a dirty tree: `npx tsx scripts/fetch-linkedin.ts` prints `fetch-linkedin: FAILED — ... this checkout is not clean (21 path(s)...)` and exits 1 BEFORE any fetch
- ✓ No regressions detected — base 559ad54 measured: 558 tests / 558 pass / 0 fail; delta -> 584/584

### Code Review Findings

#### Matches Plan:

- scripts/probe-linkedin.ts:58-133 — the runProbe seam, ProbeDeps/ProbeResult, and the two tagged local gates (PROBE_FLOOR, PROBE_NO_SURFACES) match the Phase 1 fence; all module-scope work moved inside the function
- scripts/probe-linkedin.ts:186-211 — the entry guard + catch-arm mapping preserves today's CLI output arm for arm
- scripts/linkedin-chain.ts:84-141 — runLinkedInChain resolves the env once, threads it to all three legs, forwards the harvested cookiePath only when the env lacks the key (blank counts as unset, :102), and classifies quiet-zero ticks as reported no-ops
- scripts/linkedin-chain.ts:141 — the failure arm prints `linkedin-chain: FAILED — ` with the em dash, matching the sibling wrappers
- scripts/login-linkedin.ts:175 — keepOpenForArgv is a one-line exported decision seam; the entry arm at :267 consumes it with no inline branch
- src/linkedin-fetch.ts:154 — SCROLL_JS exported as a string constant; the msedge channel at :331 matches the login helper's :149
- README.md:301-311 — the chain lead-in is scoped to "The login and probe steps it sequences" (the watch step is not claimed)
- AGENTS.md:54-60 — the chain command bullet names the exit contract and the no-op rule; the module bullet sits between login-linkedin (:110) and src/extract.ts (:120)
- .rpiv/guidance/scripts/architecture.md:9, 56, 111 — the login rows name the keep-open default and the --auto-close escape
- Working-tree scope — every modified/created path is a declared phase file (12 modified + 3 new code/test files); the 6 untracked artifacts are the Migration Notes' commit-with-code set

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan, including the post-validate Phase 5 fold-in.

#### Pattern Conformance:

- ✓ Entry-guard idiom (`process.argv[1]` + `pathToFileURL`) matches the four existing PC-local scripts; all six import smokes print only their export list
- ✓ Tagged-error idiom (name constant + factory + type guard) matches the halt/legDead pattern in src/linkedin-fetch.ts
- ✓ Test structure (node:test describe/it, recording doubles, pinned clocks) matches the neighboring suites
- Minor observation: the Phase 2 criterion "envWithDotEnv appears exactly once" counts grep lines, and the fence's own text mentions the symbol twice — the executable single-read pin (D2) holds at scripts/linkedin-chain.ts:84. Acceptable variation, not a deviation.
- Minor observation: "top-level await" survives in guidance/scripts/architecture.md only on the probe-judge.ts line (line 23), which is accurate — the probe-linkedin.ts claim was correctly removed. No action.

#### Potential Issues:

- scripts/linkedin-chain.ts:20 — the header documents that the wrapper needs a real TTY: in a piped or agent-mediated run the login hold's readline rejects uncaught and stage 1 dies after the cookie write. By decision no TTY check is added. Non-blocking; the operator runs the chain from a real terminal, which is also why the TTY-dependent manual items below stay open. Addressed post-gate on this branch: the keep-open hold now catches the rejection and rethrows `no TTY on stdin — harvest landed at <path>; re-run from a real terminal` (pinned offline).

### Manual Testing Required:

1. The operator chain (needs a real TTY on the dedicated clone, committed tree):
   - [ ] `npm run linkedin-chain` — the login hold releases only on Enter, the browser closes, the probe prints its banner + elapsed line, exactly one tick runs, exit 0
   - [ ] With the login window held open past the hold (Enter not pressed): the LOCKED profile-lock warning prints and no second browser launches — the probe and tick stay queued behind runLoginHelper's finally-close
   - [ ] First-ever run (no LINKEDIN_COOKIES_FILE in .env beforehand): the harvested cookie path carries stages 2-3 without a manual re-run
   - [ ] A probe gate failure (expired session) exits 1 and names the gate; no navigation after the probe
   - [ ] A quiet-zero tick prints the no-op line and exits 0 — never a failure
2. Standalone login (Phase 5):
   - [ ] `npm run login-linkedin` — the Enter hold prints, and `--auto-close` restores fire-and-close
3. Probe CLI contract:
   - [ ] `npx tsx scripts/probe-linkedin.ts` from a terminal — same banner, elapsed, floor, HALT / LEG DEAD / FAILED arms as before the refactor

### Recommendations:

- Ready to commit — implementation is complete and validated.
- Commit the artifacts WITH the code (the plan's Migration Notes): the plan, design, research, discover, and solutions files are untracked and the plan reconstruction is the only surviving record of the approved scope.
- The session-hygiene commit message should cite the recorded 2026-11-12 live rehearsal (checkpoint A/B: close-without-feed tripped the checkpoint twice, feed-first passed twice) — the record is verified on disk this run.
