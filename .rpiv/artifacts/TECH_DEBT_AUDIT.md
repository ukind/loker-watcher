# Tech Debt Audit — loker-watcher

Generated: 2026-11-17 (repeat run #7). Audited state: `main` @ `097d160`, clean worktree
(branch `ukind/fix-techdebt`, tip == origin/main tip).
Prior runs: #1 2026-10-29 (F001-F024), #2 2026-10-31 (N001-N004), #3 2026-11-01 (N005-N009),
#4 2026-11-02 (N010-N017), #5 (N018-N040), #6 2026-11-13 (N041-N060, remediated same cycle).
Living document at `.rpiv/artifacts/TECH_DEBT_AUDIT.md`.

**Tooling.** `tsc --noEmit` clean. Biome clean (78 files). `npm test`: **666/666, 0 skipped,
0 fail** (+28 tests since run #6). `npm audit`: 5 high — **all in the dev toolchain only**
(knip → fast-glob → micromatch → picomatch ReDoS GHSA-fc5q-39xc-vjpf; lint-staged → micromatch);
`npm audit --omit=dev`: 0. `depcheck` clean. `knip`: **1 unused exported type — and the CI
gate is RED on main because of it** (run 44184130481, step "Unused exports", exit 1).
`madge`: 4 cycles, all type-only back-edges (verified: every reverse edge is `import type`).
No `any` / `@ts-ignore` in `src/` or `scripts/`. This run read every module the run-6
remediation touched plus the four churn leaders (linkedin-parser, linkedin-walk,
linkedin-behavior/watch-linkedin, config-file/index), both workflows, the commit-back script,
the hooks, and the full churn profile (2,000 commits in 6 months; 1,784 are `state/` commits).

## Executive summary

- **The knip gate is red on main right now** (N061). `LinkedInWakeBand`
  (`src/linkedin-behavior.ts:32`) is an unused exported type; `ci.yml`'s "Unused exports" step
  fails (`gh run 44184130481`), and every bot `state/` push to main re-runs CI red (~10 red
  runs/day). The dead-export class recurred for the **fifth** run — this time with a red gate.
- **The commit-back script can force-push a partial replay over main** (N062):
  `scripts/commit-state-rebase.sh:102-106` falls through to `git push --force-with-lease` with
  `.git/rebase-merge` still live when the 50-skip bound exhausts. Deliberate (the FR2 deviation
  ledger documents it) but the wrong failure direction: the un-replayed tail is dropped from the
  remote silently.
- **One transient SMTP failure can silence a leg-dead episode** (N063): the episode marker is
  written BEFORE the alarm send (`scripts/fetch-linkedin.ts:211-225`), so a failed send leaves
  the marker present and every later dead tick says "alarm already sent this episode". The
  repo's own doctrine states the opposite preference ("a duplicate alarm costs one email; a
  suppressed alarm costs the outage").
- **The pairing question from runs #1-#6 is settled** — and the docs lag it. The positional zip
  is deleted; the parser now mints posts by the CARD JOIN (`src/linkedin-parser.ts:14-36`,
  commits `20c5f28`/`2681c6e`), with capture-verified evidence in the module header. But
  AGENTS.md and the src guidance still describe the timestamp-ordered zip (N066) — agents will
  reason about a mechanism that no longer exists.
- **God-file class regrew**: `src/index.ts` 679, `src/linkedin-parser.ts` 625,
  `scripts/replay-linkedin.ts` 707 (N075). Run #6's split targets (judge-dispatch 466,
  linkedin-walk 424) are healthy; the class moved to new hosts.
- **Two tracked facades carry REMOVAL NOTE (run #7)** — this run (N067). `src/judge.ts:25-36`
  and the eight-symbol block in `src/linkedin-fetch.ts`.
- **Documentation drift is again the largest cluster** (N066, N081): the 4th CI gate missing
  from three doc layers, the probe's changed walk order described as "the first configured
  surface" in three doc layers, "Chrome" vs the msedge channel, `negativeKeywords` in no
  operator doc, `reset-linkedin` in no command list, and the wake-band comment's "5 surfaces"
  against the 7 configured linkedin surfaces.
- **The new code is again well-built where it counts.** The card join is pure, evidence-cited,
  and drop-with-cause; the seen-stop fold re-computes in fire order (N046's fix held); the cap
  slice keeps the newest 150 (N047's fix held); the 8 MB capture bound and the zero-post payload
  guard are in place and tested. 666 tests, 0 skipped, all offline.
- **Test debt is narrow and named**: the probe script that writes committed ceilings data has
  zero tests (carried a 6th run, N080), the rotation suites lean on wall-clock timing and
  internal-state writes (N077), and 98 `as unknown as` casts await one shared fetch-double
  factory (N078).

## Architectural mental model

The shape is run #6's funnel with two 2026-11-14..17 changes. The funnel order is still the
invariant: fetch (threads Playwright walks + the PC payload read) → dedupe (with surface-stamp
merge) → recency → seen-diff → availability pre-check → judge → notify → persist, notify
strictly before persist (`src/index.ts` Gate 1 / Gate 2 / match path). The parser no longer
PAIRS anything: `joinCards` seeds at commentary_text marker rows, climbs `$L`-only reference
edges to the outermost single-seed ancestor (≤12 hops), harvests the longest commentary across
the seed's marker closure, and collects urn strings FORWARD from the root; one activity urn
links the card, the card's own share/ugcPost urn becomes the permalink, anything else drops
with a named cause. Digest permalinks are exact (the "Post not found" activity-urn bug is
structurally gone). The PC loop gained a configurable wake band
(`linkedinWakeMinMinutes`/`MaxMinutes`, `src/linkedin-behavior.ts`), the probe walks every
configured surface until one clears the 10-post floor (first-pass-wins),
and the dry-exit floor no longer blocks once the Load-more button is gone.

Committed state stays four files, one writer each (seen-posts, judge-ceilings, judge-health,
linkedin-posts), plus the two repo-local flag files (episode marker, halt latch) beside the
payload. All six `state/` writers use the temp+rename idiom. The judge cluster is unchanged in
shape since the run-6 split (dispatch/exhaustion/rotation/health/shared/prompts/parse/ceilings/
availability) with the residual judge.ts facade. `state/judge-ceilings.json` today carries four
accounts (ceilings 16/32/1/4, probedAt fresh); `state/judge-health.json` reads all-healthy.

## Findings — NEW this run (N061-N088)

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|----------|-----------|----------|--------|-------------|----------------|
| N061 | CI hygiene (gate red on main) | `src/linkedin-behavior.ts:32`; `.github/workflows/ci.yml:28` | **High** | S | knip reports 1 unused exported type (`LinkedInWakeBand` — the interface is only the return type of an exported function, never imported). The run-6 knip gate (ci.yml "Unused exports") therefore FAILS on main: run 44184130481 exited 1, and ci.yml triggers on every push to main including the bot's ~10 `state/` commits/day — a standing pile of red runs that trains everyone to ignore CI. Fifth recurrence of the dead-export class (N004, N006, N012, N041). | Drop `export` on the interface (the function's return type infers). Then N087. |
| N062 | Error handling (remote data loss) | `scripts/commit-state-rebase.sh:102-106` | **High** | S | Skip-bound exhaustion falls through to `git push --force-with-lease` with `.git/rebase-merge` still live: main is replaced by the PARTIAL replay and the un-replayed tail is dropped from the remote silently. Low likelihood (>50 conflicting state commits in one rebase), severe direction — hence High, not Medium. Deliberate (FR2 deviation ledger, line 99-104) but contradicts the script's own bound doctrine ("50 skips means the rebase is wedged") and the repo's fail-visible doctrine. Dropped tail is bounded to committed-state rewrites, but stale ceilings/health can survive a newer probe push. | On exhaustion: `git rebase --abort` + `echo` + `exit 1`. Update the pinned deviation test in `tests/commit-state-rebase.test.ts` and the ledger note in the same commit. |
| N063 | Error handling (alarm suppression) | `scripts/fetch-linkedin.ts:211-225` | Medium | S | `handleLegDeadEpisode` writes the episode marker BEFORE sending the alarm; the default alarm wrapper swallows send failures (warn only). One transient SMTP failure at the dead edge suppresses the alarm for the WHOLE episode — every later dead tick reads the marker and stays quiet. The doctrine's stated preference is the opposite direction (duplicate > suppressed). | Send first, write the marker after a successful send (best-effort send keeps its catch); a crash between send and marker write costs one duplicate — the accepted direction. |
| N064 | Error handling (loop exit) | `scripts/watch-linkedin.ts:95-96` | Medium | S | The loop's leg-dead arm awaits `onLegDead` unguarded; `handleLegDeadEpisode` can throw (marker write is an fs op via `writeFlagAtomic`), and the rejection propagates out of `runLoop` — the loop that must "never exit on leg-dead" dies on a disk/permission fault. | Wrap the leg-dead arm in its own try/catch + warn, exactly like the plain-fault arm beside it. |
| N065 | Logic (committed-data gate) | `scripts/probe-judge.ts:121` | Medium | S | A leg counts OK when the body contains `{`: an HTML error page with one brace reads OK, and the ramp commits a ceiling that the watch job then trusts for pool width. | Parse the body (`JSON.parse`, or check for `"choices"`); treat a parse miss as failed. ~5 lines + the ramp's refusal-as-data arm already distinguishes the classes. |
| N066 | Documentation drift (deleted mechanism) | `AGENTS.md:72-78`; `.rpiv/guidance/src/architecture.md:112-121`; `src/linkedin-behavior.ts:21` | Medium | S | AGENTS.md and the src guidance still describe the timestamp-ordered zip ("pairs the i-th distinct text with the i-th distinct id", "the pairing-oracle line ... the only mis-pair detector") — DELETED by the card join (`src/linkedin-parser.ts:14-36`, commits `20c5f28`/`2681c6e`). `linkedin-behavior.ts:21` also says "Each wake walks at most 5 surfaces" against the 7 configured linkedin surfaces. Agent-facing docs describe a mechanism that no longer exists — the exact drift class run #6 called its largest cluster. | Rewrite both parser blurbs around `joinCards` (seed → climb → harvest → urn join → drop causes), and update the wake-arithmetic comment's surface count. |
| N067 | Architectural decay (scheduled facades) | `src/judge.ts:25-36`; `src/linkedin-fetch.ts:47-57` | Low | S | Two re-export facades carry "REMOVAL NOTE (run #7)". Both are knip-safe (every symbol has importers) but keep a second import path alive — the drift class run-5's D3 forbade. | Execute the notes: re-point the 3 judge imports (judge.test.ts:9-15, judge-rotation.test.ts:22, probe-judge.ts:46) and the 7 linkedin-fetch facade importers at the real modules; delete both blocks. ~30 min, mechanical. |
| N068 | Type & contract debt (type-cycle homes) | `src/judge.ts:70`; `src/linkedin-fetch.ts:60` | Low | S | `LlmAccount` lives in judge.ts, so judge-dispatch.ts:53, judge-rotation.ts:42 and judge-health.ts:34 each carry a type-only back-edge to the orchestrator; `LinkedinSurface` in linkedin-fetch.ts does the same for linkedin-walk.ts:27. Four madge cycles, all this shape. The runtime edges are already one-way; only the type homes lag the run-6 split. | Move `LlmAccount` → `src/judge-shared.ts` (its declared "shared wire vocabulary" home) and `LinkedinSurface` → `src/config-file.ts` (where `Surface` is defined). madge reports 0 cycles afterwards. |
| N069 | Consistency rot (positional params) | `src/linkedin-walk.ts:105-114` | Low | S | `walkLinkedInSurface` takes 9 positional parameters (context, surface, label, scrollRounds, minClicks, seenIds, captureSink, captureOrdinal, nowFn) — the exact shape N054 removed from `fetchLinkedInPosts`. One production call site today; the risk grows with each new knob. | Convert to a deps object (the `FetchLinkedInDeps` idiom); keep `context`/`surface` positional if test churn matters. |
| N070 | Documentation drift (config key) | `README.md` (config table); `config-file.ts:28,101` | Low | S | `negativeKeywords` is a validated config key (commit `cabd1ba`) wired into the judge's system message, but the README operator table lists every OTHER key and omits it; AGENTS.md's architecture section never mentions the veto either. An operator cannot discover the feature from the docs. | Add the README table row (absent → [], non-empty appends the veto sentence) and one AGENTS.md clause. |
| N071 | Consistency rot (asymmetric fault visibility) | `src/fetch-threads.ts:388-391` | Low | S | The Threads graphql listener ends in a bare `catch {}` that swallows JSON.parse AND normalizeThreadItem faults after `xhrBodies += 1` — a systematically broken Threads body looks identical to harmless non-JSON noise. The LinkedIn walk got the warn-once body-fault idiom for exactly this class (N048, `src/linkedin-walk.ts:136-143`); the Threads arm never got it. | Port `warnBodyFault` (warn once per surface walk on non-page-close errors). |
| N072 | Security/robustness (hook spawn) | `scripts/hooks/format-on-edit.js:21-30` | Low | S | The path allowlist admits SPACE (and parens), but the spawn runs `shell: true` (line 26) and cmd.exe tokenizes on space — a workspace path with a space passes the gate and Biome formats the wrong args. The child's exit status is never checked (only `result.error`), so every spawn failure is a silent no-op. | Quote the path in the args array, or resolve npx.cmd and drop `shell: true`; warn when `result.status !== 0` (the hook still exits 0). |
| N073 | Logic (harvest gate) | `scripts/login-linkedin.ts:213-224` | Low | M | Harvest success = cookie PAIR PRESENCE in the persistent profile's jar, never liveness: a stale pair still in the profile harvests instantly and prints "session captured", and the next walk leg-deads anyway. | Verify one signed-in page marker before declaring success, or reword to "pair captured" so the operator knows liveness is untested. |
| N074 | Consistency rot (cross-key coupling) | `src/linkedin-payload.ts:36-46`; `src/linkedin-behavior.ts:76-90` | Low | S | `PAYLOAD_MAX_AGE_MS` is operator-frozen at 40 min while the wake band is now operator-configurable: a band ≥ 40 min makes EVERY hosted run read the leg stale (permanently DARK) while the loop runs green. Visible via the heartbeat leg line, but no validation warns and nothing names the interaction. | Warn at `resolveLinkedInWakeBand` (or config-file) when the floor ≥ 40, naming the freshness rule. Warning only — the freeze itself is a recorded decision. |
| N075 | Architectural decay (god files) | `src/index.ts` (679); `src/linkedin-parser.ts` (625); `scripts/replay-linkedin.ts` (707) | Low | M | Three files above the repo's 500-line threshold. index.ts mixes pipeline shape with pure helpers (dedupePosts, mergeSurfaceStamps, surfaceLabel, heartbeat) and the entry bootstrap. The parser is one cohesive pure algorithm — splitting it would be artificial. replay-linkedin is a 707-line script. | Extract index.ts's pure helpers into a small module (~100 LOC out). Document the parser as a threshold exception (cohesive pure core). Leave replay-linkedin or split its replay-report rendering. |
| N076 | Test debt (source-text pins) | `tests/fetch-linkedin.test.ts:1017-1036` | Low | S | A whole describe asserts the SOURCE TEXT of the `SCROLL_JS` string (`includes("sel: pick.sel")` etc.) — renaming a local in the injected JS fails the suite with zero behavior change. | Delete the block or pin only the JSON contract keys; the walk doubles already pin the behavior. |
| N077 | Test debt (timing coordination) | `tests/judge-rotation.test.ts:397-403,1063-1066`; `tests/judge.test.ts:529-540` | Low | S | Wall-clock assumptions in unit tests: an `elapsed < 500` bound on "must not sleep" (a loaded runner trips it), a real 50 ms setTimeout releasing a held dispatch, and a deadline-free spin-poll that hangs the suite on regression. These are the suite's only realistic flake sources. | Gate on the condition (the `inertSleep` seam, promise gates resolved by the double), and give every spin a deadline. |
| N078 | Test debt (cast mass) | `tests/judge.test.ts` (39 casts); `tests/judge-rotation.test.ts` (25) | Low | M | 98 `as unknown as` casts, nearly all inline mock-fetch rebuilds, while `tests/judge-availability.test.ts:14-51` already demonstrates the typed factory pattern (`fetchReturning`/`fetchByHost`/`fetchRejecting`). | One shared typed fetch-double factory in the judge-helpers module; delete the inline casts. |
| N079 | Test debt (helper duplication) | 6 files (ContextLike doubles); `tests/judge.test.ts:16-37` vs `tests/judge-rotation.test.ts:52-72` | Low | M | The Playwright context double is duplicated across 6 test files (probe's copy literally "trimmed" from fetch-linkedin's); `freshState` exists in two drifting copies both labeled canonical; recordingSink ×3; seeded LCG ×2; id19 ×3. | Consolidate into the non-`.test.ts` helpers module the glob already picks up. |
| N080 | Test debt (coverage gaps) | `scripts/probe-judge.ts` (0 test refs); `src/pool.ts:33`; `src/config.ts:37,47`; `src/judge-exhaustion.ts:29` | Low | M | probe-judge (340 LOC: the ramp, the dead-account gate, the committed ceilings writer) has ZERO tests — carried a 6th run, and it now gates CI-committed data production trusts. runPool's documented contract (width clamp, input-order claims, total-worker join) is unpinned. isHeartbeatEnabled/runUrlFromEnv boundary cases unpinned. resolveBlockedPick untested directly. | Extract the ramp decision into a pure module + tests; add a small runPool suite and a 15-case config.test.ts; direct cases for the blocked-pick table. |
| N081 | Documentation drift (cluster) | `AGENTS.md:201-204`; `.rpiv/guidance/architecture.md:65`; `.rpiv/guidance/.github/workflows/architecture.md:7,18`; `README.md:316,330,386`; `AGENTS.md` probe bullet; `package.json:15` | Low | S | Seven drifts, all small: (1) "Before you call it done" lists 3 gates, ci.yml runs 4 (knip) — same stale claim in both guidance files; (2) README/AGENTS/guidance say the probe walks "the first configured surface", the code walks each until one clears the floor (`scripts/probe-linkedin.ts:190`); (3) README says "Chrome window", the helper launches msedge; (4) `npm run reset-linkedin` appears in no command list; (5) README's "five LinkedIn leg entries" — seven exist; (6) `npm run format` omits `scripts/probe-judge.ts` while lint includes it (guidance rule: append to BOTH); (7) workflows guidance says "5 of the 6 ENV_NAMES" — there are 7 (`LINKEDIN_PROFILE_DIR` joined). | One editing pass over the five doc layers. ~1 h. |
| N082 | Dependency debt (dev-chain advisories) | `package-lock.json` (knip 5.88.1 → picomatch *) | Low | S | 5 high advisories, all dev-only: picomatch ReDoS via knip/fast-glob/micromatch and lint-staged. `npm audit --omit=dev` is clean (runtime is nodemailer + playwright only). `npm audit fix --force` would DOWNGRADE knip to 3.13.2 — do not. | Wait for the picomatch patch upstream (knip/lint-staged pick it up on lockfile refresh); optionally add a documented `npm audit --ignore GHSA-fc5q-39xc-vjpf` with an expiry note. |
| N083 | Config debt (unguarded jq) | `.github/workflows/watch.yml:252` | Low | S | The commit-back delta reads `PREV` with a `|| echo 0` fallback but `CURR` without one; a jq hiccup fails the step under implicit `bash -e` before the commit-back script runs. | Mirror `|| echo 0`. 1 line. |
| N084 | Shell hygiene (empty branch) | `scripts/commit-state-rebase.sh:69` | Low | S | A detached-HEAD dispatch makes `git branch --show-current` empty; only a comment prevents it, and `git pull --rebase origin ""` burns the retry with a confusing error. | Guard `branch == ""` → exit 1 naming the cause. |
| N085 | Error handling (lost cause) | `scripts/fetch-linkedin.ts:344` | Low | S | `git rebase --abort`'s output is discarded; a failed abort wedges the retry's `pull --rebase` with "rebase in progress" instead of the real cause. | Check the abort's code and fold its output into `lastFailure`. |
| N086 | Security hygiene (hook evasion) | `scripts/hooks/gate-destructive.js:13` | Low | S | The destructive-command gate matches `>`/`>>` on the state file but not `truncate -s 0 state/seen-posts.json`. | Add a `\btruncate\b` rule. 1 line. |
| N087 | Config debt (CI on state pushes) | `.github/workflows/ci.yml:3-5` | Low | S | ci.yml triggers on every push to main, including ~10 bot `state/` commits/day — full checkouts and test runs for zero code change, and (until N061 lands) a standing red run per state push. | Add `paths-ignore: ['state/**']` to the push trigger (PR and dispatch triggers stay). |
| N088 | Performance (capture residue) | `src/linkedin-capture.ts:193` | Low | S | Run-6 top-5 #2 residue: every captured body is still pretty-printed (`null, 2` — roughly double the bytes for zero information) and there is no env kill switch; only the 8 MiB per-body bound landed. | Drop the `null, 2`; optionally add a `LINKEDIN_CAPTURE=off` env switch read at sink construction. ~15 min. |

## Resolved ledger — run-#6 findings re-verified against `main` @ `097d160`

| ID | Was | Status | Verified by |
|----|-----|--------|-------------|
| N041 | 10 dead exports | RECURRED (as N061) | knip: 1 unused exported type; the CI gate is red on main |
| N042 | judge.ts + linkedin-fetch.ts god files | RESOLVED | 369 / 342 LOC; the class moved to new hosts (N075) |
| N043 | .git 189 MB loose objects | RESOLVED (policy) | guidance carries the gc-once policy; size-pack 12.4 → 19.6 MiB in 4 days of state commits — growth as predicted, monitor per policy |
| N044 | AGENTS.md lint list | RESOLVED | lint list matches package.json |
| N045 | Five modules in no doc layer | RESOLVED (new drift landed: N066, N081) | the six named modules all appear; NEW drift is about changed content, not missing modules |
| N046 | Seen-streak completion-order race | RESOLVED | seq minted synchronously pre-await; fold recomputes in fire order (`src/linkedin-walk.ts:121-141`); reversed-order test pins it |
| N047 | 150-post cap advisory | RESOLVED | timestamp sort + slice(-150) at the walk's tail |
| N048 | Listener arms swallow all faults | RESOLVED (LinkedIn arm) | warn-once `warnBodyFault`; page-close races stay silent — the Threads arm is N071 |
| N049 | Flag writes non-atomic | RESOLVED | `writeFlagAtomic` via stateTempPath + rename |
| N050 | Zero-post walk overwrites payload | RESOLVED | guard + "last good payload preserved" log + episode-marker clear |
| N051 | Capture disk unbounded | RESOLVED (PARTIAL — residue as N088) | the 8 MiB per-body bound landed (`src/linkedin-capture.ts:67,175`); the env kill switch and the pretty-print drop did NOT (`JSON.stringify(record, null, 2)` survives at `src/linkedin-capture.ts:193`) |
| N052 | Capture PII undocumented | RESOLVED | README retention/purge section stands |
| N053 | Hardcoded profile dir | RESOLVED | `resolveLinkedInProfileDir` + `LINKEDIN_PROFILE_DIR` env override (guidance env-count drift tracked in N081) |
| N054 | Ten positional params | RESOLVED | `FetchLinkedInDeps` — the class spawned a NEW instance on the walk (N069) |
| N055 | Two URN digit floors | RESOLVED | one `ACTIVITY_ID_PATTERN` shared parser→payload→walk-static |
| N056 | Dead ignore rules | RESOLVED (by design) | recon/budget rules retained per D5 |
| N059 | Duplicated UA + patch | RESOLVED | `src/browser-constants.ts`, both factories import it |
| N060 | Run-6 split regrowth (judge-dispatch 645, linkedin-walk 541) | RESOLVED | 466 / 424 LOC |

Runs #1-#5 ledgers (F001-F024, N001-N040) stand unchanged; the touched subset re-checked clean
(state.ts, email.ts, heartbeat.ts, pool.ts, judge cluster). The run-6 open questions resolve
as: Q1 pairing → SETTLED by the card join (replay harness + capture bodies 005/080 drove it;
the permalink card-root join landed in `20c5f28`); Q3 state history → policy recorded
(guidance "State history policy (N043)"); Q6 scrollRounds → still 50, still shared (carry,
open question 1).

## Top 5 — if you fix nothing else, fix these

**1. N061 + N087 — green the gate, then silence the noise (15 minutes).**
Drop `export` on `LinkedInWakeBand` (`src/linkedin-behavior.ts:32`) — the interface is only
`resolveLinkedInWakeBand`'s return type; inference carries every consumer. Push; main's CI goes
green. Then add `paths-ignore: ['state/**']` to ci.yml's push trigger so bot state commits stop
buying red (then zero-cost) CI runs.

**2. N062 — make skip-bound exhaustion abort, not push (30 minutes).**
In `scripts/commit-state-rebase.sh:102-104`, replace the fall-through echo with
`git rebase --abort` + `exit 1`. Same commit: update the pinned deviation case in
`tests/commit-state-rebase.test.ts` and note the ledger change in the script header. A red run
beats a silently rewritten main.

**3. N063 + N064 — alarm ordering and the loop guard (30 minutes).**
In `handleLegDeadEpisode`, send the alarm BEFORE writing the marker (a crash between the two
costs a duplicate — the accepted direction). In `runLoop`, wrap the `onLegDead` await in its
own try/catch so a marker-write fault warns instead of killing the loop. Two tests each.

**4. N066 — sync the docs to the card join (45 minutes).**
Rewrite AGENTS.md:72-78 and the guidance parser blurb around seed/climb/harvest/urn-join/drop
causes; fix `linkedin-behavior.ts:21`'s "5 surfaces" to the configured count. Agents auditing
or extending the parser currently read a mechanism that no longer exists.

**5. N065 + N073 — close the two presence-vs-liveness gates (30 minutes).**
`probe-judge.ts:121`: JSON-parse the leg body (or require `"choices"`) before counting OK —
the ramp's ceiling is committed data the watch job trusts. `login-linkedin.ts`: verify one
signed-in marker (or reword "pair captured") so harvest success cannot mean a stale pair.

## Quick wins

- [ ] N061: unexport `LinkedInWakeBand` (2 min) — unblocks main's CI
- [ ] N087: `paths-ignore: ['state/**']` on ci.yml push (2 min)
- [ ] N083: `|| echo 0` on the CURR jq read (1 min)
- [ ] N086: `\btruncate\b` rule in gate-destructive (1 min)
- [ ] N084: empty-branch guard in commit-state-rebase.sh (2 min)
- [ ] N085: fold `rebase --abort` output into lastFailure (5 min)
- [ ] N068: move `LlmAccount` → judge-shared, `LinkedinSurface` → config-file (15 min) — madge goes to 0
- [ ] N067: execute both REMOVAL NOTE facades (30 min)
- [ ] N070: README row + AGENTS clause for `negativeKeywords` (10 min)
- [ ] N076: delete the SCROLL_JS source-text describe (5 min)

## Things that look bad but are actually fine

- **Four madge cycles.** Every reverse edge is `import type` (`judge-dispatch.ts:53`,
  `judge-rotation.ts:42`, `judge-health.ts:34`, `linkedin-walk.ts:27`), erased by
  `verbatimModuleSyntax`; the runtime graph is one-way. Same ruling as runs #1-#6 — N068 fixes
  the optics by moving the type homes, not because anything is unsafe.
- **The two facades.** Deliberate run-6 trade ("tests unedited wins this pass"), knip-safe by
  construction, and self-scheduling via the removal notes. N067 executes them; the pattern
  itself was correct for its moment.
- **`walkLinkedInSurface`'s 9 positional params.** New code, ONE production call site, and the
  walk's signature is stable across the test suite. N069 is consistency hygiene, not an active
  hazard.
- **`PAYLOAD_MAX_AGE_MS` frozen at 40 min while the wake band is configurable.** A recorded
  operator decision (2026-11-17) with the arithmetic documented in the constant's comment; the
  failure mode is heartbeat-visible, never silent. N074 asks for a warning, not a redesign.
- **`linkedin-parser.ts` at 625 LOC.** One cohesive pure algorithm (row split → marker scan →
  graph edges → climb → harvest → join → mint) with a measured-evidence header. Splitting it
  would trade cohesion for a threshold. Recommend documenting the exception instead (N075).
- **`stateTempPath`'s `Math.random`.** Not a crypto primitive; mints unique sibling temp names
  so a crashed write cannot clobber the next (the 20478d1 bug). Run-6 ruling stands.
- **`guardCheckout`'s clean-tree requirement.** Still hostile to a working tree and still
  correct: a dirty tree wedges the rebase AFTER a live fetch, and a non-main branch pushes to a
  ref nothing reads. Two git reads before any navigation.
- **The CURR jq read without a fallback** (N083's subject) is half fine: the file was written by
  `saveState` moments earlier, so a jq failure means real corruption — failing the step is the
  fail-visible direction; the fallback is symmetry polish.
- **`collectLinkedInPosts`' per-body console.log with id↔text heads.** Still the only mis-pair
  detector for the join, now validating the CARD join instead of the zip. Kept deliberately.
- **`npm audit`'s 5 high.** All in the dev toolchain (knip/lint-staged chains); runtime audit
  is clean, and the "fix" is a knip downgrade. N082 documents the wait.
- **The knip gate being red is the gate WORKING.** It caught the fifth recurrence of the class
  it was added for. The debt is that nobody fixed it for ~a day of red runs — process, not code.
- **666 tests, 0 skipped, all offline**, `t.mock.method` throughout, writes only to temp dirs.
  The suite's structural health is unchanged from run #6's assessment.

## Open questions for the maintainer

1. Carried x2: is `scrollRounds: 50` intentional for BOTH walks? The per-surface dry exit and
   the no-button bypass make the worst case self-limiting, but the click counts in any recent
   tick log settle whether 50 is ever reached on LinkedIn (7 surfaces × pacing).
2. Carried x5: `.rpiv/artifacts/` is a tracked archive with no pruning policy — intentional?
3. Carried x4: the four possibly-orphaned GitHub secrets (`LINKEDIN_SESSION_STATE`,
   `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, `LINKEDIN_SECRET_WRITER`) — still set? Not verifiable
   from the repo.
4. Carried x4: is `reasoning_effort` accepted by every endpoint in the pool? Live-only; the
   probe's minimal call would surface a proxy that rejects the field (and N065's shape check
   would make that surface louder).
5. New: size-pack grew 12.4 → 19.6 MiB in the four days since the run-6 gc (state commits at
   the predicted rate). Set a revisit date for the N043 policy now (e.g. "at 100 MiB pack or
   30 s checkout"), or let it ride?
6. New: should the run-7 remediation execute N067's facade removals and the N061/N087 CI pair
   as one immediate PR? They are 45 minutes total and clear the only red signal in the repo.
