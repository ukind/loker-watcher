# Tech Debt Audit — loker-watcher

Generated: 2026-11-18 (repeat run #8). Audited state: branch `ukind/fix-techdebt-2` @ `7087c44`.
Prior runs: #1 2026-10-29 (F001-F024), #2 2026-10-31 (N001-N004), #3 2026-11-01 (N005-N009),
#4 2026-11-02 (N010-N017), #5 (N018-N040), #6 2026-11-13 (N041-N060), #7 2026-11-17 (N061-N088).
Living document at `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — the run-#7 home, tracked per repo
guidance; this deliberately overrides the skill's repo-root default so the ledger stays one file.

**Tooling.** `tsc --noEmit` clean. Biome clean (78 files). `npm test`: **669/670 pass, 1 fail**
(`tests/config-file.test.ts:57` — N089, below). `npm audit`: **0 vulnerabilities** (run #7's 5
dev-chain highs are gone — the picomatch patch landed upstream). `depcheck`: clean. `knip`:
clean. `madge --circular`: **9 cycles** (run #7: 4) — every reverse edge still `import type`
(verified: `judge-health.ts:34`, `judge-dispatch.ts:53`, `judge-rotation.ts:42` → `judge.ts`;
`linkedin-walk.ts:27` → `linkedin-fetch.ts`); the runtime graph is acyclic. The count grew
because madge enumerates one cycle per distinct path through the same type-only back-edges —
no new runtime edge exists. No `any` / `@ts-ignore` in `src/` or `scripts/`.

**Remediation since run #7** (2 commits, `0c06f27` + `9b14244`): N061, N062, N063, N064, N083,
N084, N086, N087 all landed and are verified in source below. N082 resolved upstream.

## Executive summary

- **The test suite is red on the branch AND on main** (N089): `tests/config-file.test.ts:57-59`
  hard-pins `linkedinWakeMin/MaxMinutes: 60`, but `watcher.config.json` ships `15/45` on both
  branches. Sixth recurrence of the "test pins operator-editable committed data" class (the
  platforms flags were fixed in `c56569c`/`a493b8c`; the wake band was not). One-line fix.
- **The wake band now crosses the frozen payload freshness bound** (N091): the operator set
  `15-45 min` while `PAYLOAD_MAX_AGE_MS` stays frozen at 40 min (`src/linkedin-payload.ts:36-46`,
  decision 2026-11-17). A 45-minute wake guarantees a stale payload on the next hosted run —
  the leg reads DARK while the PC loop runs green. N074 asked for a warning; the config moved
  first. This is the highest-impact live finding.
- **Git growth is back on the N043 revisit trigger** (N090): loose objects re-accumulated to
  **161.6 MiB in ~2 days** (run #7 measured 172 MB pre-gc; the gc reclaimed it, then 200 state
  commits rebuilt it). `state/seen-posts.json` grew 1.6 → 4.7 MB. The "gc once, no schedule"
  policy is holding as written, but the revisit trigger it names ("clone size or CI checkout
  time becomes a visible cost") is now measurable: 161 MB of loose objects per clone.
- **The run-#7 high cluster is fully remediated** — N062's partial-replay force-push, N063's
  alarm suppression, N064's loop death, N061's red knip gate, N087's state-push CI noise all
  verified fixed in source. `npm audit` is 0 for the first time in the audit's history.
- **N068 never landed and the cycle count grew 4 → 9** (N092): `LlmAccount` still lives in
  `src/judge.ts:70` and `LinkedinSurface` in `src/linkedin-fetch.ts:70`, so four modules carry
  type-only back-edges to their orchestrators. All type-only, zero runtime risk — but the
  count moving the wrong direction after a run that named the fix is itself the signal.
- **The two REMOVAL NOTE facades are now two runs stale** (N067 carried): `src/judge.ts:25-36`
  and `src/linkedin-fetch.ts:47-57` still carry run-#7 notes. Self-scheduling worked once; it
  does not compound.
- **Documentation drift is again the largest cluster** (N066, N081 carried): the deleted
  timestamp-ordered zip still described in two doc layers, `negativeKeywords` in zero operator
  docs, the probe's walk order wrong in three layers, "Chrome" vs msedge, "five leg entries"
  vs seven, the 5-of-6 env count vs seven.
- **The new code is again well-built where it counts.** The judge park budget is
  charge-before-sleep with overshoot-only deduction and a zero-charge ceiling-wait split
  (`src/judge-rotation.ts:355-380`); the health circuit's half-open probe is inline plain-field
  reads with a paired constant; the payload boundary degrades in four named classes and never
  throws (D13); the commit-back script's exhaustion now aborts instead of rewriting main.
- **Test debt is narrow and named**: `scripts/probe-judge.ts` still has zero tests (carried a
  7th run, N080), 98 `as unknown as` casts await one shared factory (N078), and one
  wall-clock `elapsed < 500` bound remains (N077).
- **`src/index.ts` (679 LOC) re-read this run** (N075 carried): it mixes pipeline shape with
  pure helpers (`dedupePosts`, `mergeSurfaceStamps`, `surfaceLabel`) and the entry bootstrap.
  The extraction recommendation stands unchanged.

## Architectural mental model

The shape is run #7's funnel, unchanged: fetch (threads Playwright walks + the PC payload read)
→ dedupe (surface-stamp merge) → recency → seen-diff → availability pre-check → judge → notify
→ persist, notify strictly before persist (`src/index.ts` Gate 1 / Gate 2 / match path). The
judge cluster is the run-6 split (dispatch/exhaustion/rotation/health/shared/prompts/parse/
ceilings/availability) with the residual judge.ts facade; the rotation module keeps its
zero-runtime-import identity through a paired constant (`HEALTH_CAP_STREAK` = 2, twin of
judge-health's `HARD_FAIL_TICKS_TO_CAP`) and a structural slice of the outcome union. The
dispatch dial spreads claims across the pool, 429 cools account-locally for a flat 60s
(first-write-wins), an all-at-ceiling pick parks at zero budget charge on the release-waiter
queue, and only a quiet-pool cooldown park draws the shared 180s budget — the single road to
the exhaustion terminal. The PC leg is unchanged: headed persistent-profile Chromium walk,
atomic payload push from a dedicated clone, one writer per file. Committed state is four files
plus two repo-local flag files (episode marker, halt latch), all six writers on the
temp+rename idiom. `state/judge-ceilings.json` carries four accounts (16/32/1/4);
`state/judge-health.json` reads all-healthy.

Churn ∩ size (Phase 1): the top-20 LOC list intersected with the top-20 six-month-churn list
gives `src/index.ts`, `src/judge.ts`, `src/config-file.ts`, `src/fetch-threads.ts`,
`src/linkedin-fetch.ts`, and `src/email.ts` — this run's findings concentrate exactly there
(N075, N067, N092, N071).

## Findings — NEW this run (N089-N092)

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|----------|-----------|----------|--------|-------------|----------------|
| N089 | Test debt (red suite) | `tests/config-file.test.ts:57-59` | **High** | S | The happy-path test pins `linkedinWakeMinMinutes === 60` and `linkedinWakeMaxMinutes === 60`, but `watcher.config.json` ships `15/45` on both this branch and `main`. `npm test` = 669/670, 1 fail. The platforms flags above it were already de-pinned to shape-only assertions (comment cites `c56569c`/`a493b8c`); the wake band never got the same treatment. Sixth recurrence of the class. | Replace both `assert.equal` with `assert.equal(typeof …, "number")` + a `>= 1` bound, matching the platforms idiom two lines up. |
| N090 | Performance (git growth) | `.git` (161.59 MiB loose); `state/seen-posts.json` (4.7 MB) | Medium | S | Run #7's gc reclaimed 172 MB of loose objects; 200 state commits in ~2 days rebuilt 161.6 MiB (size-pack 21.73 MiB). The N043 policy ("gc once, document, no schedule") is holding as written, but its own revisit trigger — "clone size or CI checkout time becomes a visible cost" — is now measurable on every clone and every Actions checkout. | Run `git gc --aggressive` once from a full clone now; set the concrete revisit threshold the run-7 open question asked for (e.g. "re-gc at 150 MiB loose or 30 s checkout"). |
| N091 | Logic (cross-key coupling, now live) | `src/linkedin-payload.ts:36-46`; `watcher.config.json` (`linkedinWakeMin/MaxMinutes: 15/45`) | Medium | S | N074's theoretical coupling is now live: the operator set a 15-45 minute wake band while `PAYLOAD_MAX_AGE_MS` stays frozen at 40 min. A 45-minute wake guarantees the next hosted run reads the payload stale — the leg renders DARK and degrades to threads-only while the PC loop runs green. No validation warns; the heartbeat leg line is the only signal. | Warn at `resolveLinkedInWakeBand` when the floor ≥ 40 min, naming the freshness rule (N074's original recommendation). Warning only — the freeze is a recorded decision. |
| N092 | Architectural decay (type-cycle homes) | `src/judge.ts:70`; `src/linkedin-fetch.ts:70` | Low | S | N068's fix never landed: `LlmAccount` still lives in the judge orchestrator and `LinkedinSurface` in the linkedin-fetch orchestrator, so `judge-health.ts:34`, `judge-dispatch.ts:53`, `judge-rotation.ts:42` and `linkedin-walk.ts:27` each carry a type-only back-edge. madge reports 9 cycles (run #7: 4) — the growth is path enumeration over the same edges, not new runtime edges, but the direction is wrong one run after the fix was named. | Move `LlmAccount` → `src/judge-shared.ts` and `LinkedinSurface` → `src/config-file.ts` (where `Surface` is defined). ~15 min; madge goes to 0. |

## Carried findings — re-verified against `7087c44`

| ID | Category | File:Line | Severity | Effort | Status this run | Recommendation |
|----|----------|-----------|----------|--------|-----------------|----------------|
| N065 | Logic (committed-data gate) | `scripts/probe-judge.ts:122` | Medium | S | UNCHANGED — `const ok = body.includes("{")` still the success test | JSON-parse the body or require `"choices"`; a parse miss is a failed leg |
| N066 | Documentation drift (deleted mechanism) | `AGENTS.md:76`; `.rpiv/guidance/src/architecture.md:118`; `src/linkedin-behavior.ts:20` | Medium | S | UNCHANGED — "timestamp-ordered zip" still in both doc layers; "5 surfaces" vs 7 configured | Rewrite both parser blurbs around `joinCards`; fix the surface count |
| N067 | Architectural decay (scheduled facades) | `src/judge.ts:31`; `src/linkedin-fetch.ts:53` | Low | S | UNCHANGED — both REMOVAL NOTE blocks still present, now two runs stale | Execute: re-point the 3 judge + 7 linkedin-fetch importers, delete both blocks (~30 min) |
| N069 | Consistency rot (positional params) | `src/linkedin-walk.ts:95-105` | Low | S | UNCHANGED — 9 positional params, one production call site | Convert to a deps object (the `FetchLinkedInDeps` idiom) |
| N070 | Documentation drift (config key) | `README.md` (config table); `AGENTS.md` | Low | S | UNCHANGED — `negativeKeywords` appears in 0 operator-doc hits (grep verified) | Add the README table row + one AGENTS.md clause |
| N071 | Consistency rot (asymmetric fault visibility) | `src/fetch-threads.ts:388-391` | Low | S | UNCHANGED — bare `catch {}` still swallows JSON.parse + normalize faults after the body counter | Port `warnBodyFault` (warn once per surface walk on non-page-close errors) |
| N072 | Security/robustness (hook spawn) | `scripts/hooks/format-on-edit.js:21-30` | Low | S | UNCHANGED — `shell: true` + unchecked child status | Quote the path or drop `shell: true`; warn on `result.status !== 0` |
| N073 | Logic (harvest gate) | `scripts/login-linkedin.ts:213-224` | Low | M | UNCHANGED — success = cookie pair presence; prints "session captured" with no liveness check | Verify one signed-in marker, or reword to "pair captured" |
| N074 | Config debt (cross-key coupling) | `src/linkedin-payload.ts:36-46`; `src/linkedin-behavior.ts:76-90` | Low | S | UPGRADED — now live as N091 | See N091 |
| N075 | Architectural decay (god files) | `src/index.ts` (679); `src/linkedin-parser.ts` (625); `scripts/replay-linkedin.ts` (707) | Low | M | UNCHANGED — all three re-measured this run; index.ts re-read, still mixes pipeline shape with pure helpers | Extract index.ts's pure helpers (~100 LOC); document the parser as a cohesive-pure exception |
| N076 | Test debt (source-text pins) | `tests/fetch-linkedin.test.ts:1048-1057` | Low | S | UNCHANGED — the SCROLL_JS source-text describe survives (line numbers shifted 1017 → 1048) | Delete the block or pin only the JSON contract keys |
| N077 | Test debt (timing coordination) | `tests/judge-rotation.test.ts:403` | Low | S | UNCHANGED — `elapsed < 500` wall-clock bound still the only realistic flake source | Gate on the condition via the `inertSleep` seam |
| N078 | Test debt (cast mass) | `tests/judge.test.ts` (39); `tests/judge-rotation.test.ts` (25) | Low | M | UNCHANGED — 98 casts total, counts identical to run #7 | One shared typed fetch-double factory in judge-helpers |
| N079 | Test debt (helper duplication) | `tests/judge.test.ts`; `tests/judge-rotation.test.ts` | Low | M | UNCHANGED — `freshState` still duplicated across both files | Consolidate into the non-`.test.ts` helpers module |
| N080 | Test debt (coverage gaps) | `scripts/probe-judge.ts` (0 tests); `src/pool.ts:33`; `src/config.ts:37,47`; `src/judge-exhaustion.ts:29` | Low | M | UNCHANGED — carried a 7th run; `tests/` has probe-linkedin but no probe-judge | Extract the ramp decision into a pure module + tests; add runPool and config suites |
| N081 | Documentation drift (cluster) | `README.md:316,330,386`; `AGENTS.md:36,123`; `.rpiv/guidance/.github/workflows/architecture.md:7` | Low | S | UNCHANGED — all seven sub-items re-verified: 3-gate claim vs 4 CI gates; "first configured surface" vs the walk-each-until-floor code (`scripts/probe-linkedin.ts:190,228-248`); "Chrome window" vs msedge; `reset-linkedin` in 0 command lists; "five LinkedIn leg entries" vs seven; `format` omits `probe-judge.ts`; "5 of the 6 ENV_NAMES" vs 7 | One editing pass over the five doc layers (~1 h) |
| N085 | Error handling (lost cause) | `scripts/fetch-linkedin.ts:359` | Low | S | UNCHANGED — `git rebase --abort`'s output still discarded; `lastFailure` carries only the rebase's | Check the abort's code and fold its output into `lastFailure` |
| N088 | Performance (capture residue) | `src/linkedin-capture.ts:193` | Low | S | UNCHANGED — `JSON.stringify(record, null, 2)` still pretty-prints every body; no env kill switch | Drop the `null, 2`; optionally add a `LINKEDIN_CAPTURE=off` switch |

## Resolved ledger — run-#7 findings re-verified against `7087c44`

| ID | Was | Status | Verified by |
|----|-----|--------|-------------|
| N061 | knip gate red on main (`LinkedInWakeBand` unused export) | RESOLVED | `npx knip` clean; `src/linkedin-behavior.ts` unexported in `0c06f27` |
| N062 | commit-back force-pushed a partial replay on skip-bound exhaustion | RESOLVED | `scripts/commit-state-rebase.sh:102-112` — exhaustion now `git rebase --abort` + `exit 1`; two black-box tests added |
| N063 | leg-dead marker written before the alarm send | RESOLVED | `scripts/fetch-linkedin.ts:211-235` — send first, marker only after success; a failed send leaves the episode open |
| N064 | runLoop died on a leg-dead handler fault | RESOLVED | `scripts/watch-linkedin.ts:95-104` — the `onLegDead` await has its own try/catch + warn |
| N082 | 5 high dev-chain advisories (picomatch ReDoS) | RESOLVED | `npm audit`: 0 vulnerabilities (upstream patch landed) |
| N083 | CURR jq read without a fallback | RESOLVED | `.github/workflows/watch.yml:254` — `2>/dev/null \|\| echo 0` |
| N084 | detached-HEAD dispatch burned the retry | RESOLVED | `scripts/commit-state-rebase.sh:69-73` — empty-branch guard exits 1 before any rebase work |
| N086 | gate-destructive missed `truncate -s 0` | RESOLVED | `scripts/hooks/gate-destructive.js` — `\btruncate\b` rule added in `9b14244` |
| N087 | CI ran on every bot state push | RESOLVED | `.github/workflows/ci.yml:5-8` — `paths-ignore: ["state/**"]` on the push trigger |

Runs #1-#6 ledgers (F001-F024, N001-N060) stand unchanged. Modules opened in full this run —
`src/index.ts`, `src/judge.ts`, `src/judge-rotation.ts`, `src/linkedin-payload.ts` — re-checked
clean; the other modules run #7 named carry over from that run's read without a fresh read here.
The run-7 open
questions resolve as: Q1 scrollRounds → still 50, still shared (carried); Q2 artifacts pruning
→ carried; Q3 orphaned secrets → carried; Q4 reasoning_effort acceptance → carried; Q5 N043
revisit date → **answered by N090** (set the threshold now); Q6 immediate remediation PR →
the high cluster landed as `9b14244` + `0c06f27`.

## Top 5 — if you fix nothing else, fix these

**1. N089 — un-pin the wake band (2 minutes).**
`tests/config-file.test.ts:57-59`: replace the two `assert.equal(config.linkedinWake*, 60)`
with shape assertions, exactly like the platforms pair two lines above. The suite goes
669/670 → 670/670 and the class stops recurring.

**2. N091 — warn when the wake band crosses the freshness bound (15 minutes).**
In `resolveLinkedInWakeBand` (`src/linkedin-behavior.ts`), warn when the floor ≥ 40 min,
naming `PAYLOAD_MAX_AGE_MS`. Today a 45-minute wake silently guarantees a DARK leg on the
next hosted run; the operator set that band without any signal that it crosses the bound.

**3. N090 — gc once, then set the threshold (10 minutes).**
`git gc --aggressive` from a full clone reclaims the 161.6 MiB. Then write the concrete
revisit trigger into the guidance's N043 policy ("re-gc at 150 MiB loose or 30 s checkout")
so the next occurrence is a decision, not a rediscovery.

**4. N092 + N067 — close the two structural carry-overs (45 minutes).**
Move `LlmAccount` → `judge-shared.ts` and `LinkedinSurface` → `config-file.ts` (madge 9 → 0),
then execute both REMOVAL NOTE facades. Both were named in run #7; neither landed, and the
cycle count moved the wrong way in the meantime.

**5. N065 — parse the probe's leg body (10 minutes).**
`scripts/probe-judge.ts:122`: `body.includes("{")` lets an HTML error page with one brace read
OK, and the ramp then commits a ceiling the watch job trusts for pool width. Parse the body or
require `"choices"` — the ramp's refusal-as-data arm already distinguishes the classes.

## Quick wins

- [ ] N089: shape-assert the wake band (2 min) — greens the suite
- [ ] N091: band-vs-freshness warning in `resolveLinkedInWakeBand` (15 min)
- [ ] N090: `git gc --aggressive` + write the revisit threshold (10 min)
- [ ] N092: move the two type homes (15 min) — madge goes to 0
- [ ] N067: execute both REMOVAL NOTE facades (30 min)
- [ ] N070: README row + AGENTS clause for `negativeKeywords` (10 min)
- [ ] N076: delete the SCROLL_JS source-text describe (5 min)
- [ ] N085: fold `rebase --abort` output into `lastFailure` (5 min)
- [ ] N088: drop the capture pretty-print (5 min)

## Things that look bad but are actually fine

- **Nine madge cycles.** Every reverse edge is `import type` (`judge-health.ts:34`,
  `judge-dispatch.ts:53`, `judge-rotation.ts:42`, `linkedin-walk.ts:27`), erased by
  `verbatimModuleSyntax`; the runtime graph is acyclic. The 4 → 9 growth is madge enumerating
  distinct paths through the same back-edges, not new coupling. N092 fixes the optics.
- **`walkLinkedInSurface`'s 9 positional params.** One production call site, stable signature
  across the suite. N069 is consistency hygiene, not an active hazard.
- **`PAYLOAD_MAX_AGE_MS` frozen at 40 min.** A recorded operator decision (2026-11-17) with
  the arithmetic in the constant's comment; the failure mode is heartbeat-visible, never
  silent. N091 asks for a warning, not a redesign.
- **`linkedin-parser.ts` at 625 LOC.** One cohesive pure algorithm with a measured-evidence
  header. Splitting it would trade cohesion for a threshold — document the exception (N075).
- **`stateTempPath`'s `Math.random`.** Not a crypto primitive; mints unique sibling temp names
  so a crashed write cannot clobber the next. Run-6 ruling stands.
- **`guardCheckout`'s clean-tree requirement.** Still hostile to a working tree and still
  correct: a dirty tree wedges the rebase AFTER a live fetch.
- **The CURR jq read** now carries the fallback (N083 resolved); the PREV read's fallback is
  half-cosmetic — the file was written moments earlier, so a jq failure means real corruption.
- **`collectLinkedInPosts`' per-body console.log with id↔text heads.** Still the only mis-pair
  detector for the card join. Kept deliberately.
- **`npm audit` at 0.** Runtime was always clean (nodemailer + playwright); the dev-chain
  highs resolved upstream. No action.
- **669/670 tests, all offline**, `t.mock.method` throughout, writes only to temp dirs. The
  one failure is a data pin (N089), not a behavior regression.

## Open questions for the maintainer

1. Carried x3: is `scrollRounds: 50` intentional for BOTH walks? The per-surface dry exit and
   the no-button bypass make the worst case self-limiting, but tick-log click counts settle it.
2. Carried x6: `.rpiv/artifacts/` is a tracked archive with no pruning policy — intentional?
3. Carried x5: the four possibly-orphaned GitHub secrets (`LINKEDIN_SESSION_STATE`,
   `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, `LINKEDIN_SECRET_WRITER`) — still set?
4. Carried x5: is `reasoning_effort` accepted by every endpoint in the pool? Live-only; N065's
   shape check would surface a proxy that rejects the field.
5. New: the 15-45 minute wake band — intentional? It crosses the frozen 40-minute payload
   freshness bound (N091), so roughly every third-plus hosted run in the 40-45 tail reads the
   leg DARK. If the intent is a fresher leg, the bound needs a decision; if not, the band
   should come back under 40.
6. New: should N089/N091/N090 land as one PR before the next scheduled run? They are ~30
   minutes total and clear the only red signal plus the only live coupling.
