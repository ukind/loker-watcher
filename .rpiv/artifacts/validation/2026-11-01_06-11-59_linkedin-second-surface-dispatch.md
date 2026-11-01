---
template_version: 1
date: 2026-11-01T06:11:59+0700
author: Yogiswara Utama
commit: 7ba1651
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Validation of LinkedIn second surface + configurable scroll"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md"
tags: [validation, config-file, fetch-linkedin, fetch-threads, index, judge, email, linkedin, platform]
last_updated: 2026-11-01T06:11:59+0700
blockers: [{ id: b1, command: "npm run lint", file: "src/linkedin-login.ts", line: 292 }]
---

## Validation Report: LinkedIn second surface + configurable scroll

### Implementation Status

- ✓ Phase 1: Config spine — Fully implemented (linkedin arm, scrollRounds validator, ResolvedSurface.platform; byte-exact search URL verified live in this run)
- ✓ Phase 2: Contracts + session — Fully implemented (Post.platform required end to end, ENV_NAMES.linkedinSession, resolveSession parameterized)
- ✓ Phase 3: LinkedIn walker — Fully implemented (src/fetch-linkedin.ts; RSC parse, urn ids, wheel walk; offline suite 8/8 green)
- ✓ Phase 4: Acquisition split — Fully implemented (per-platform session resolution, mixed pool, D5 degrade, paired cleanup; 4 acquisition pins green)
- ✓ Phase 5: Judge + digest marking — Fully implemented (neutral prompts, 7-site lockstep verified by grep; [linkedin] token + conditional "+ LinkedIn" subject)
- ✓ Phase 6: Sample config + gates — Fully implemented (1 live linkedin surface, README hunks A-G, whole-plan gate: typecheck + test green, lint blocked by Phase 7 — see Findings)
- ✓ Phase 7: Credential login + secret self-refresh — Fully implemented, shipped as a tested superset of the plan fence (see Deviations)

### Automated Verification Results

- ✓ Type check: `npm run typecheck` — clean
- ✓ Full test suite: `npm test` — 269/269 pass, 0 fail, 0 skipped (includes all per-phase scoped suites)
- ✗ Lint: `npm run lint` — exactly 1 violation: src/linkedin-login.ts:29:79 lint/style/useNumberNamespace (`NaN` → `Number.NaN`, safe auto-fixable). File is inside the run's delta (Phase 7) — blocking
- ✓ Phase 3 dispatch pin: `grep -c 'platform === "linkedin"' src/fetch-threads.ts` — 1 hit, dispatch is platform-typed
- ✓ Phase 3 back-edge: `grep -c "^import type" src/fetch-linkedin.ts` — 3; the only fetch-threads import is type-only
- ✓ Phase 4 no-hardcode: `grep -n "LINKEDIN_SESSION_STATE" src/index.ts` — no hits (ENV_NAMES.linkedinSession only)
- ✓ Phase 5 lockstep: `grep -rn "Judge each Threads post below" src/ tests/` — no hits
- ✓ Phase 5 subject pin: `grep -c "1 new job post on Threads (#hiring indonesia)" tests/email.test.ts` — 3
- ✓ Phase 6 config loads: the plan's tsx eval prints `scrollRounds: 8` plus the byte-exact linkedin search URL (%23hiring%20frontend%20developer%20indonesia, sortBy/datePosted facets verbatim)
- ✓ Phase 6 single live surface: `grep -c '"type": "linkedin"' watcher.config.json` — 1
- ✓ Phase 6 README: `grep -c "LINKEDIN_SESSION_STATE" README.md` — 9 (>= 3)
- ✓ Phase 7 no credential leakage: no `console.log` of the password; warns name outcomes only
- ✓ Phase 7 type-only back-edge: 1 `import type`; the only fetch-threads import is type-only
- ✓ No regressions: every pre-LinkedIn suite passes unchanged, including the byte-identity and all-Threads pins

### Code Review Findings

#### Matches Plan:

- src/config-file.ts — Surface union third arm, scrollRounds validator (integer >= 1, default 8, fractions rejected), resolveSurfaces platform stamps, byte-exact linkedinSearchUrlFor — all as fenced, verified live by the config-load eval
- src/types.ts, src/extract.ts — Post.platform required, single Threads minting site stamps it
- src/threads-session.ts — resolveSession parameterized by env name defaulting to the Threads var; LinkedIn-var tests green
- src/fetch-threads.ts — AuthenticatedFetchOptions, lazy base context (D12), second LinkedIn context, platform dispatch in the pool worker, scrollRounds threaded as required scalar; the 4 platform-dispatch pins hold
- src/fetch-linkedin.ts — wheel constants block, AUTHOR_PLACEHOLDER, flagship-web response filter, dry-round/ceiling/cap loop, urn->timestamp via BigInt shift — matches the fence; suite covers parse, order, dedupe, caps, and all three error paths
- src/index.ts:174-256 — acquisition split matches Hunk 2: platform split before session resolution, mixed authenticated pool, logged-out + isolated LinkedIn arm with walk-time downgrade, paired cleanupSessionDir in one finally
- src/judge.ts + the three suites — neutral lead-ins landed in the lockstep edit; bulk routing pins green
- src/email.ts — platformToken item marking + D10 conditional suffix; all-Threads subject byte-identical (pin count 3)
- watcher.config.json — exactly one appended linkedin surface; reasoningEffort/scrollRounds stay absent per D11
- README.md — committed hunks (82 lines) + Phase 7 working-tree hunks: secrets rows, linkedin surface docs, scrollRounds row, session-refresh section
- src/linkedin-login.ts + tests — selectors are the revised verified anchors (autocomplete + :below layout, never #session_key); the test pin "types into the verified autocomplete anchors, never the dead ids" enforces it
- .github/workflows/watch.yml — Phase 2 secret mapping committed (68c1e2d); Phase 7 env additions, refresh step, and marker commit-back present in the working tree
- scripts/linkedin-login.ts — headed operator escape hatch exists, rides makeChromiumContextFactory(false) and the same login module, exit-code contract documented

#### Deviations from Plan:

All deviations are implementation supersets or corrections; none is a gap. None blocks.

- src/linkedin-login.ts — Phase 7 shipped beyond the plan fence: a fourth outcome `"transient"` (infra fault: network, navigation, half-capable adapter, failed export) that does NOT cool the account, a consecutive-transient streak (`TRANSIENT_ESCALATION_ATTEMPTS = 3`) that escalates a persistent fault to the same 6h cooldown, `clearLoginMarker` on success, and `marker.consecutiveTransients`. The plan fence described a 3-outcome single-shot cooldown. Rationale is documented in-module (a 6h silence for a network blip mislabels the account) and 11 dedicated tests pass, including the two-free-retries-then-cooldown bound. Plan-sanctioned in part: the implement note required loginLinkedInContext to return the temp path directly (done — lastLinkedInSessionPath dropped as instructed) and paired cleanup honored (F019).
- src/fetch-threads.ts — the plan said "add PageLike.url() and LocatorLike.fill() to the shared seam"; the landing adds them as OPTIONAL members (`fill?`, `url?`, `cookies?`) plus standalone LoginPageLike/LoginLocatorLike interfaces with adapter bridges (loginPageFrom/loginLocatorFrom) in linkedin-login.ts, so existing walk doubles stay minimal. Improvement; the chromium adapter provides all three.
- src/fetch-threads.ts — `chromiumContextFactory` (private const) became exported `makeChromiumContextFactory(headless)` with the headless default kept as the module-level factory. Required by Phase 7 §5's headed operator script; Playwright remains quarantined behind the single dynamic import.
- .github/workflows/watch.yml — the refresh-step gate is an in-step `test -f` instead of the plan's `if: hashFiles(format('{0}/linkedin-refresh.b64', runner.temp)) != ''`; hashFiles is workspace-scoped and cannot see runner.temp. Correction, documented in the step comment.
- .github/workflows/watch.yml — GH_TOKEN is scoped to the refresh step only; the plan fence listed it among the watcher step env. Security improvement: the PAT never enters the watcher process env.
- .github/workflows/watch.yml — refresh-failure branch writes a challenge-shaped cooldown marker (stops a failing PAT from re-triggering a login every 10 minutes). Unplanned addition, benign; see Potential Issues for the operational wrinkle.
- package.json — lint script gained scripts/linkedin-login.ts. Phase 7's files: list did not declare package.json, but the plan's own lint criterion names the file, so the repo-wide gate must cover it. Plan deviation (incomplete files list), non-blocking.
- src/linkedin-login.ts — loginAllowed/writeLoginMarker take `now: () => number` (plan fence: `=> Date`), matching the repo's injected-epoch-clock idiom. Trivial.

#### Pattern Conformance:

- ✓ node:-prefixed imports, ESM .js suffixes, no classes, type-only cross-module back-edges (fetch-linkedin: 3, linkedin-login: 1 — walker direction preserved), fail-visible errors with named faults, template-literal log lines, offline structural doubles (no Playwright at import time), best-effort cleanup contract (temp dir removal never fails the run)
- Minor observation: linkedin-login.ts defines its own Login* page/locator seams instead of growing PageLike — acceptable variation, not a deviation; the module documents the same policy as the optional mouse wheel.

#### Potential Issues:

- .rpiv/guidance/src/architecture.md + .rpiv/guidance/.github/workflows/architecture.md — stale after this change: the module structure lacks fetch-linkedin.ts/linkedin-login.ts, the ENV_NAMES section lacks linkedinEmail/linkedinPassword/linkedinRefreshPath, and the workflow guidance lacks the refresh step and marker commit-back. Comment-only class (no executable line changes), so it does not force the verdict; refresh guidance in a follow-up or the next guidance pass.
- .github/workflows/watch.yml (refresh step, failure branch) — the anti-hammer marker is written as `"lastOutcome": "challenge"` for what is actually OUR-side failure (a bad/expired PAT, not LinkedIn challenging). Effect is the intended 6h anti-hammer, but the marker's semantics differ from a genuine challenge, and after fixing the PAT the stale marker still blocks login attempts for up to 6h. Self-heals and is operator-visible via the step log; acceptable as shipped.
- state/linkedin-login.json joins the state commit-back only when present — correct; note the file is never pruned by code (only overwritten or cleared by clearLoginMarker on success). Harmless at its size; no action needed.

### Manual Testing Required:

1. Executed during this validation (offline, through the real code paths):
   - [x] Phase 1 manual: the committed watcher.config.json (no scrollRounds key) loads and resolves scrollRounds to 8; the linkedin surface builds the byte-exact search URL (plan's Phase 6 eval command)
   - [x] Testing-strategy manual step 1 (byte identity): grep over src/ shows linkedin references only at the declared stamps, config arms, session plumbing, judge-neutral strings, and the email marking edit
   - [x] Phase 4 manual item, executed offline via a scratch driver through the REAL runWatcher (deleted after the run): with a mixed config and both LINKEDIN secrets unset, the run logs `fetch: LINKEDIN_SESSION_STATE missing or invalid — skipping 1 linkedin surface(s)`, never navigates linkedin.com, completes on logged-out Threads posts alone (`{judged: 2, matches: 2, saved: true}`), sends an all-Threads subject with no "+ LinkedIn", and persists the 2 Threads ids
   - [x] Judge-config ordering check: acquisition (and the D5 warn) runs BEFORE the judge stage resolves LLM_ACCOUNTS, so the warn is observable in a real local run even without LLM credentials (the run still needs LLM_ACCOUNTS + GMAIL_* to complete end to end)
   - [x] cleanupSessionDir compatibility check: it removes dirname(sessionPath) recursively with force; the login temp dir (loker-linkedin-login-*/storage-state.json) has the same shape as a resolveSession dir, so the paired finally covers the login-issued session path
2. Operator-run (live; deferred per the plan's own note — 93a3f38 live-retune precedent):
   - [ ] Phase 3: with a live LinkedIn session, a scratch tsx call to fetchSurfacesAuthenticated logs `fetch: linkedin/... OK — N post(s) from M response(s)`
   - [ ] Phase 5: first real mixed run shows `[linkedin]` only on LinkedIn digest lines and "+ LinkedIn" in the subject only when a LinkedIn match exists
   - [ ] Phase 6: dispatch Actions watch with LINKEDIN_SESSION_STATE unset — run exits 0 with the skip warn and the Threads digest/heartbeat lands; then with a live session — linkedin surfaces walk and matches carry the token
   - [ ] Phase 7: set LINKEDIN_EMAIL + LINKEDIN_PASSWORD + LINKEDIN_SECRET_WRITER, dispatch with LINKEDIN_SESSION_STATE unset — login attempt logged, linkedin surfaces walked, refresh step updates the secret (verify: repo secret timestamp); the NEXT dispatch resolves the session with no login attempt; if CI login is challenged, run `npx tsx scripts/linkedin-login.ts` and solve in the headed window
   - [ ] After the first live run: retune the LINKEDIN_WHEEL_* / settle placeholders in src/fetch-linkedin.ts and paste a fresh evidence date (plan's declared follow-up commit)

### Recommendations:

- Fix the single lint violation: `npx biome check --write src/linkedin-login.ts` (`NaN` → `Number.NaN` at line 292), then re-run `npm run lint` and `/skill:validate` for a fresh pass report. Everything else is green: typecheck, 269/269 tests, all 9 grep pins, the config-load eval, and the executed manual items.
- After the lint fix, proceed to `/skill:commit` — Phase 7 is uncommitted in the working tree; phases 1-6 are already committed (68c1e2d) and validated.
- Refresh the stale .rpiv/guidance documents in a follow-up (module structure, ENV_NAMES, workflow steps).
- Keep the live operator items above open until the first real mixed run; the plan's own deferral note (93a3f38 precedent) covers them.
