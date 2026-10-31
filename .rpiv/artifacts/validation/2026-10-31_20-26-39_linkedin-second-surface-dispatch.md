---
template_version: 1
date: 2026-10-31T20:31:52+0700
author: Yogiswara Utama
commit: b92fa9f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Validation of LinkedIn second surface + configurable scroll"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md"
tags: [validation, config-file, fetch-linkedin, fetch-threads, index, judge, email, linkedin, platform]
last_updated: 2026-10-31T20:31:52+0700
---

## Validation Report: LinkedIn second surface + configurable scroll

### Implementation Status

- ✓ Phase 1: Config spine — Fully implemented
- ✓ Phase 2: Contracts + session — Fully implemented
- ✓ Phase 3: LinkedIn walker — Fully implemented
- ✓ Phase 4: Acquisition split — Fully implemented
- ✓ Phase 5: Judge + digest marking — Fully implemented
- ✓ Phase 6: Sample config + gates — Fully implemented

Implementation is uncommitted on top of b92fa9f: 25 tracked files modified + 2 new files (src/fetch-linkedin.ts, tests/fetch-linkedin.test.ts), exactly the union of the phases' declared file lists — no out-of-plan writes in the working tree.

### Automated Verification Results

- ✓ Whole-plan gate: `npm run typecheck` — exit 0
- ✓ Whole-plan gate: `npm run lint` — 35 files checked, no fixes
- ✓ Whole-plan gate: `npm test` — 234/234 pass, 0 fail
- ✓ Phase 1 config suite: `npx tsx --test tests/config-file.test.ts` — 28/28 (linkedin arm + scrollRounds cases)
- ✓ Phase 3 walker suite: `npx tsx --test tests/fetch-linkedin.test.ts` — 15/15
- ✓ Phase 3 Threads suite: `npx tsx --test tests/fetch-threads.test.ts` — 18/18 (default-8 dry/ceiling/cap pins hold)
- ✓ Phase 4 pipeline suite: `npx tsx --test tests/index.test.ts` — 12/12 (8 pre-existing + 4 new acquisition pins)
- ✓ Phase 4 session suite: `npx tsx --test tests/session.test.ts` — 12/12 (LinkedIn-var parameterization)
- ✓ Phase 5 judge suites: `npx tsx --test tests/judge.test.ts tests/judge-rotation.test.ts` — 53/53 (neutral bulk dispatch)
- ✓ Phase 5 email suite: `npx tsx --test tests/email.test.ts` — 23/23 (three D10 marking pins)
- ✓ Platform-typed dispatch pin: `grep -n 'platform === "linkedin"' src/fetch-threads.ts` — 1 hit (src/fetch-threads.ts:361)
- ✓ Type-only back-edge pin: `grep -c "^import type" src/fetch-linkedin.ts` = 3; the only fetch-threads import is `import type { ContextLike }` (src/fetch-linkedin.ts:38)
- ✓ No hardcoded session var: `grep -n "LINKEDIN_SESSION_STATE" src/index.ts` — 0 hits (uses ENV_NAMES.linkedinSession)
- ✓ Lockstep lead-in flip complete: `grep -rn "Judge each Threads post below" src/ tests/` — 0 hits
- ✓ Singular all-Threads subject pins byte-identical: grep count = 3 in tests/email.test.ts
- ✓ Exactly one live linkedin surface: grep count = 1 in watcher.config.json
- ✓ README names the secret 5 times (>= 3) across secrets table, surfaces table, and the new session-refresh section
- ✓ Phase 6 eval as written — prints `scrollRounds: 8` and the byte-exact search URL `https://www.linkedin.com/search/results/content/?keywords=%23hiring%20frontend%20developer%20indonesia&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D`
- ✓ No regressions detected (full suite green; Threads-only byte-identity sweep below)

### Code Review Findings

#### Matches Plan:

- src/config-file.ts:146-148, 229-233 — linkedin union arm, whitelist message, platform stamp, byte-exact linkedinSearchUrlFor (eval-verified)
- src/config-file.ts — readScrollRounds validator mirrors the reasoningEffort optional-key shape with the integer >= 1 guard
- src/fetch-threads.ts:361-363 — platform-typed dispatch (no label sniffing); lazy base context; paired linkedinContext teardown at :392
- src/fetch-linkedin.ts:38 — module back-edge is type-only (one dependency direction, per plan)
- src/index.ts:165-230 — per-platform session resolution before dispatch, skip-warn naming ENV_NAMES.linkedinSession, linkedin-only-no-session degrade to empty funnel, walk-time LinkedIn failure downgrade in the logged-out path, paired session-dir cleanup in one finally
- src/judge.ts:238 — neutral single-post lead-in; `grep -n "Threads" src/judge.ts` returns 0 hits (prompt is platform-free end to end)
- src/email.ts:62,75 — conditional " + LinkedIn" suffix (D10) and the `[linkedin] ` item token; all-Threads subject string unchanged
- .github/workflows/watch.yml:91 — `LINKEDIN_SESSION_STATE: ${{ secrets.LINKEDIN_SESSION_STATE }}` with the absent-secret skip note
- scripts/probe-judge.ts — one-line `platform: "threads"` stamp (Post.platform ripple), as planned
- tests/index.test.ts — 4 acquisition pins including the two-context sessionPaths deep-equal and the urn-aware bulk id regex keeping the Threads-worded discriminator at the Phase 4 boundary (plan-review finding 1, correctly applied)
- watcher.config.json — exactly one linkedin surface appended last; reasoningEffort and scrollRounds stay absent
- Byte-identity sweep (plan Testing Strategy #1): `grep -rn "linkedin" src/ | grep -v fetch-linkedin` — every hit is a type stamp, config arm, session-plumbing name, or dispatch branch; no behavior words leak into Threads-only paths

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ Template-literal log/error style throughout the new code (plan-review finding 2 applied); Biome clean at lineWidth 100
- ✓ Session resolver reuse via ENV_NAMES keeps one naming path for secrets; tests mirror the existing reasoningEffort pin shape (config-file suite) and the heartbeat Gate 1/Gate 2 subject pins (index suite)
- Minor observation: LinkedIn walker constants are hard-coded module constants with unmeasured-placeholder comments — doctrine-conformant (probe-measured values only are env-tunable); the live-retune commit is the declared follow-up

#### Potential Issues:

- watcher.config.json:9 — the live linkedin surface references a secret that does not exist yet: `gh secret list` shows only GMAIL_APP_PASSWORD, GMAIL_USER, LLM_ACCOUNTS, THREADS_SESSION_STATE. Once committed, branch runs log the skip warn and continue Threads-only — D5 working as designed, but the surface stays dormant until `gh secret set LINKEDIN_SESSION_STATE < linkedin-state.json.b64`. Non-blocking; operator action after commit.

### Manual Testing Required:

1. Phase 1 — committed-config load (executed during validation):
   - [x] `git show HEAD:watcher.config.json` (9 threads surfaces, no linkedin, no scrollRounds key) loads cleanly; all platforms resolve `threads`; `scrollRounds` resolves to 8
2. Phase 3 — live-session walker check (operator-run; blocked, deferral pre-authorized by the plan):
   - [ ] Decode LINKEDIN_SESSION_STATE to a temp file, run the scratch tsx script against `fetchSurfacesAuthenticated`, confirm `fetch: linkedin/... OK — N post(s) from M response(s)` — BLOCKED: the secret is unset locally and absent from the repo; plan defers to the live-retune commit (93a3f38 precedent)
3. Phase 4 — local mixed run with the LinkedIn secret unset (operator-run; blocked locally):
   - [ ] Skip warn naming the variable + Threads-only completion — BLOCKED: every watch env var (THREADS_SESSION_STATE, LLM_ACCOUNTS, GMAIL_*) is unset on this machine, so a local run exits at env resolution; the exact behavior is pinned offline by the passing "completes with Threads posts only when LINKEDIN_SESSION_STATE is absent" test in tests/index.test.ts
4. Phase 6 — dispatch Actions → watch with LINKEDIN_SESSION_STATE unset (live D5 confirmation; blocked on commit):
   - [ ] Run exits 0, logs the skip warn, Threads digest/heartbeat lands — BLOCKED: Actions executes committed code and the feature is uncommitted (HEAD b92fa9f is pre-LinkedIn); the secret-absence precondition is already confirmed. After commit+push: `gh workflow run watch`, then read the run log
5. Phase 6 — live mixed-run digest marking (operator-run; blocked on the secret):
   - [ ] `[linkedin]` token only on LinkedIn item lines; "+ LinkedIn" in the subject only when a LinkedIn match is present — BLOCKED: no LinkedIn session exists yet; defer to the first real mixed run per the plan

### Recommendations:

- Ready to commit — implementation is complete and validated; all 6 phases verified against the working tree.
- After commit+push, close manual items 4 and 5: dispatch `watch` once with the secret still absent to capture the D5 skip-warn evidence, then `gh secret set LINKEDIN_SESSION_STATE < linkedin-state.json.b64` and dispatch again for the live walker + digest-marking evidence.
