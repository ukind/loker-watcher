---
template_version: 1
date: 2026-11-01T08:00:29+0700
author: Yogiswara Utama
commit: 7ba1651
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Validation of LinkedIn second surface + configurable scroll"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md"
tags: [validation, config-file, fetch-linkedin, fetch-threads, index, judge, email, linkedin, platform]
last_updated: 2026-11-01T08:00:29+0700
---

## Validation Report: LinkedIn second surface + configurable scroll

Re-validation after the 2026-11-01 06:11 fail verdict. That run's single blocker (`npx biome` `lint/style/useNumberNamespace` at `src/linkedin-login.ts:292`, `NaN`) is fixed (`Number.NaN`, verified at line 292) and the plan gained Phase 8 (live retune, revision 07:38). Phases 1-6 are committed (68c1e2d); Phase 7 + Phase 8 are the uncommitted working-tree delta judged here against HEAD 7ba1651.

### Implementation Status

- ✓ Phase 1: Config spine — Fully implemented (linkedin arm, scrollRounds validator, ResolvedSurface.platform; byte-exact URL confirmed live again in this run's config eval)
- ✓ Phase 2: Contracts + session — Fully implemented (Post.platform required, ENV_NAMES.linkedinSession, resolveSession parameterized)
- ✓ Phase 3: LinkedIn walker — Fully implemented (offline suite 16/16; live evidence recorded 2026-11-01: 38+37 posts across two surfaces)
- ✓ Phase 4: Acquisition split — Fully implemented (mixed pool, D5 degrade, paired cleanup; 4 acquisition pins green)
- ✓ Phase 5: Judge + digest marking — Fully implemented (neutral prompts, 7-site lockstep holds; [linkedin] token + conditional subject pins green; live mixed digest sent)
- ✓ Phase 6: Sample config + gates — Fully implemented (config loads, README hunks in place; whole-plan gate green)
- ✓ Phase 7: Credential login + secret self-refresh — Fully implemented (login suite 25/25; refresh hand-off + marker commit-back in watch.yml; the 06:11 lint blocker resolved)
- ✓ Phase 8: Live retune — Fully implemented (Number.NaN fix + empty-results classification byte-matching the fence + the new empty-results pin)

### Automated Verification Results

- ✓ Type check: `npm run typecheck` — clean
- ✓ Lint: `npm run lint` — 39 files, no violations (the 06:11 blocker b1 is resolved: `Number.NaN` at src/linkedin-login.ts:292, zero bare `NaN` left)
- ✓ Full test suite: `npm test` — 270/270 pass, 0 fail, 0 skipped (+1 over 06:11: the Phase 8 empty-results pin)
- ✓ Walker suite: `npx tsx --test tests/fetch-linkedin.test.ts` — 16/16 (new pin: page still on the search path with no responses returns [] plus the "OK — 0 post(s) (no results in the past-24h window)" log, no throw; the url-less dead-session throw pin unchanged)
- ✓ Login suite: `npx tsx --test tests/linkedin-login.test.ts` — 25/25
- ✓ Phase 3 dispatch pin: `grep -c 'platform === "linkedin"' src/fetch-threads.ts` — 1 (platform-typed, not label-sniffed)
- ✓ Phase 3 back-edge: `grep -c "^import type" src/fetch-linkedin.ts` — 3; the only fetch-threads import (line 38) is type-only
- ✓ Phase 4 no-hardcode: `grep -n "LINKEDIN_SESSION_STATE" src/index.ts` — no hits
- ✓ Phase 5 lockstep: `grep -rn "Judge each Threads post below" src/ tests/` — no hits
- ✓ Phase 5 subject pin: `grep -c "1 new job post on Threads (#hiring indonesia)" tests/email.test.ts` — 3
- ✓ Phase 7 no credential leakage: no console.log of the password in src/index.ts or src/linkedin-login.ts
- ✓ Phase 7 type-only back-edge: single import type from fetch-threads (src/linkedin-login.ts:26)
- ✓ Phase 8 fence match: src/fetch-linkedin.ts:300-311 — the landed empty-results block matches the plan fence (search path returns [] with the log line; a bounce keeps the throw; the optional page.url?.() seam keeps old doubles throwing)
- ✓ Config-load eval (Phase 1/6 manual, re-executed): watcher.config.json loads, scrollRounds: 8, all 11 surfaces resolve with correct platform stamps; both linkedin URLs byte-exact (%23hiring%20react / %23hiring, origin=FACETED_SEARCH, sortBy/datePosted facets verbatim)
- ✓ No regressions: every pre-LinkedIn pin holds (byte-identity subject pins, tag URLs, graphql walk suites all green)

### Code Review Findings

#### Matches Plan:

- src/config-file.ts — Surface third arm, scrollRounds validator (integer >= 1, default 8, fractions rejected), platform stamps, byte-exact linkedinSearchUrlFor
- src/types.ts / src/extract.ts / src/threads-session.ts — platform discriminant end to end; single Threads minting site; parameterized session resolver
- src/fetch-threads.ts — AuthenticatedFetchOptions, lazy base context (D12), second LinkedIn context, platform dispatch, scrollRounds threaded as required scalar; the 4 platform-dispatch pins hold
- src/fetch-linkedin.ts — wheel constants, AUTHOR_PLACEHOLDER, flagship-web filter, dry-round/ceiling/cap loop, urn-to-timestamp BigInt shift; Phase 8 hunk landed as fenced
- src/index.ts:365-422 — recoverLinkedInSession matches the plan's shape contract exactly: the implement note's demands honored (loginLinkedInContext returns the session path directly — no lastLinkedInSessionPath; paired cleanup preserved; refresh hand-off via ENV_NAMES.linkedinRefreshPath; success clears the marker)
- src/linkedin-login.ts — verified autocomplete/:below selectors, 3-outcome classification plus the transient superset, cooldown marker with streak escalation, Number.NaN fix
- .github/workflows/watch.yml — Phase 2 secret mapping + Phase 7 env additions, test -f gated refresh step, GH_TOKEN scoped to the refresh step only, marker rides the state commit-back
- tests/index.test.ts — the 4 Phase 4 acquisition pins + Phase 7 recovery pins (lines 499, 546, 581, 611, 722, 875) all green

#### Deviations from Plan:

All are implementation supersets or incomplete plan files-lists; none is a functional gap. None blocks.

- watcher.config.json — two linkedin surfaces (#hiring react, #hiring) vs Phase 6's fenced single appended surface. The second is the run's own live-retune work (the Phase 8 evidence records walking both); Phase 8's files: list omits watcher.config.json. Plan deviation (incomplete files list), non-blocking.
- .gitignore — gained linkedin-state*.b64 + run.log; no phase declares it. Explainable (the headed script's output artifact + run scratch), benign, non-blocking.
- src/linkedin-login.ts — Phase 7 shipped as a tested superset of the fence: the fourth transient outcome with 3-streak escalation, clearLoginMarker on success, dedicated Login*/LoginLocatorLike seams instead of growing PageLike. Documented in-module; 25 tests green. Carried from the 06:11 report, still accurate.
- .github/workflows/watch.yml — test -f gate instead of hashFiles (hashFiles is workspace-scoped); challenge-shaped marker on refresh failure; GH_TOKEN step-scoped. Carried from 06:11, still accurate.
- package.json — lint script gained scripts/linkedin-login.ts (the phase's files: list omits it; the plan's own lint criterion names the file). Non-blocking.

#### Pattern Conformance:

- ✓ node:-prefixed imports, ESM .js suffixes, no classes, type-only cross-module back-edges (fetch-linkedin: 3, linkedin-login: 1), fail-visible errors, template-literal log lines, offline structural doubles, best-effort cleanup contract
- Minor observation: the dedicated Login* page/locator seams remain an acceptable variation, not a deviation (same policy as the optional mouse wheel)

#### Potential Issues:

- .rpiv/guidance/src/architecture.md + .rpiv/guidance/.github/workflows/architecture.md — still stale after this change (zero mentions of fetch-linkedin/linkedin-login/refresh step). Comment-only class: no executable line changes; does not force the verdict. Refresh in a follow-up or the next guidance pass.
- state/linkedin-login.json (untracked, rides the commit-back) — records a challenge at 2026-10-31T23:37:47Z; the successful retry evidently ran through a path that bypassed recoverLinkedInSession (probe/direct), so clearLoginMarker never fired. The stale marker is inert while the session secret resolves, but a session death before ~12:37 +0700 would keep the fallback login blocked until the 6h window expires. Self-heals, operator-visible; same class as the 06:11 refresh-failure-marker note. No action required; delete the file or let it age out.

### Manual Testing Required:

Status of every manual criterion in the plan (the operator ask for this run).

1. Executed and verified:
   - [x] Phase 1: committed config loads; scrollRounds resolves to 8 (re-executed in this run; the config now also carries the Phase 6 surfaces)
   - [x] Phase 3: live-session walk — DONE LIVE 2026-11-01 through the real runWatcher, superseding the scratch-call procedure: "fetch: linkedin/#hiring react OK — 38 post(s) from 13 response(s)" and "linkedin/#hiring OK — 37 post(s)", 8 scroll rounds each (plan revision 07:38); corroborated by 65 urn:li:activity ids persisted in state/seen-posts.json
   - [x] Phase 4: mixed config with LINKEDIN_SESSION_STATE unset logs the skip warn and completes on Threads alone (executed offline at 06:11 via the real runWatcher; now also unit-pinned at tests/index.test.ts:546)
   - [x] Phase 5: real mixed-run digest — live run 2026-11-01 sent a digest with 8 matches from 75 funneled LinkedIn posts; exact token/subject bytes unit-pinned
   - [x] Phase 7 (local leg): credential login succeeded locally on retry after one challenge (plan revision note; marker evidence 06:37 +0700); refresh hand-off unit-pinned at tests/index.test.ts:722
2. Operator-run, still open (the plan's own deferral policy — 93a3f38 precedent; none blocks this verdict):
   - [ ] Phase 6: dispatch Actions watch with LINKEDIN_SESSION_STATE unset — run exits 0, skip warn, Threads digest/heartbeat; then with a live session — linkedin surfaces walk, matches carry the token
   - [ ] Phase 7: with LINKEDIN_EMAIL/PASSWORD/SECRET_WRITER set, CI login attempt + refresh step updates the repo secret (verify the secret timestamp); the NEXT dispatch logs no login attempt; if challenged, the headed script (note the Kaspersky headed-network caveat in the plan revision)
   - [ ] Phase 8: a run inside a zero-result window logs "OK — 0 post(s) (no results in the past-24h window)" (the motivating observation was live but pre-dates the fix; the fixed behavior is offline-pinned)

### Recommendations:

- Ready to commit — implementation is complete and validated; all gates green (typecheck, lint, 270/270 tests), all 9 grep pins hold, and the 06:11 blocker is resolved.
- Commit Phase 7 + Phase 8 working-tree changes (phases 1-6 are already committed and validated).
- Keep the three open operator items above until the first CI runs; they are recorded here as the live checklist.
- Refresh the two stale .rpiv/guidance documents in a follow-up.
