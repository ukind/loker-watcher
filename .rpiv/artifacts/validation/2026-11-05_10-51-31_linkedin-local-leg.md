---
template_version: 1
date: 2026-11-05T10:51:31+0700
author: Yogiswara Utama
commit: 4c11e0f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Validation of LinkedIn leg on the local PC"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md"
tags: [validation, linkedin, voyager-graphql, curl-impersonate, playwright, local-loop, payload-handoff, sdk-removal, login-helper]
last_updated: 2026-11-05T10:51:31+0700
---

## Validation Report: LinkedIn leg on the local PC

Third validation run of the plan. Run 2 (2026-11-05_10-01-36) failed on live-rehearsal blockers b1+b2; the revised plan added Phase 8, and this run verifies the whole tree with emphasis on the Phase 8 delta. The implementation is uncommitted in the working tree (new files untracked, modifications vs HEAD 4c11e0f), so evidence is working-tree inspection plus `git diff` against 4c11e0f. No `--goal`, `--baseline`, `--scope`, or `--acceptance` inventory was provided, so those steps do not apply. The operator asked for manual verification in addition to the automated gates; every offline-dischargeable manual criterion was executed by the validator (see Manual Verification below) and is marked here.

### Implementation Status

- ✓ Phase 1: Voyager client core (pure) — Fully implemented (`src/linkedin-voyager.ts`, offline suite, scrubbed fixture)
- ✓ Phase 2: Session cookies module — Fully implemented (`src/linkedin-session.ts`, `ENV_NAMES` carries `linkedinCookiesFile` at `src/config.ts:16`)
- ✓ Phase 3: Fetch module — transport adapters, fault classification, runPool walk — Fully implemented (`src/linkedin-fetch.ts`)
- ✓ Phase 4: Payload + PC scripts + alarm + wiring — Fully implemented (`src/linkedin-payload.ts`, `scripts/fetch-linkedin.ts`, `watch-linkedin.ts`, `probe-linkedin.ts`, package.json entries)
- ✓ Phase 5: Watch-side ingest re-key — Fully implemented (`src/index.ts`, `src/heartbeat.ts`, suites re-keyed)
- ✓ Phase 6: SDK removal + residue sweep + docs — Fully implemented (quad deleted, sweeps clean, docs synced)
- ✓ Phase 7: Login helper + auto-env — Fully implemented (`src/env-file.ts`, `scripts/login-linkedin.ts`, all four PC scripts wire `envWithDotEnv`)
- ✓ Phase 8: Leg-dead classifier amendment + empty-payload guard — Fully implemented (3xx branch, `maxRedirects: 0`, `AllSurfacesFaulted`, fetchTick guard, design amendment)

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean, exit 0
- ✓ Lint: `npm run lint` — 52 files checked, no fixes needed
- ✓ Tests: `npm test` — 343/343 pass, 0 fail, 0 skipped (~12.4s)
- ✓ Phase 8 rehearsal oracle: `npx tsx .rpiv/tmp/session-dead-rehearsal.mjs` — exit 0 UNCHANGED: `leg-dead=true payloadWritten=false gitCalls=0 alarms=1`; dead 302 session throws leg-dead, writes no payload, never reaches git, alarms exactly once. Deleted after this passing re-validate per the plan's own instruction ("kept … until re-validate passes; delete after").
- ✓ Fixture scrub: `grep -aiE "li_at|jsessionid|cookie|authorization|csrf" tests/fixture/voyager-search-response.json` — 0 hits
- ✓ judge-rotation byte-identity: `git diff --name-only -- src/judge-rotation.ts` — empty
- ✓ Residue sweep (tracked AND untracked): no `linkedapi|linked_api|LINKED_API|fetch-linkedin-api` hits across src/tests/scripts/package.json/README/AGENTS/.github/.gitignore; wording sweep (`linked API|linked-api`) 0; the only surviving `SDK` is `src/judge.ts:4`'s "no SDK" note (still true)
- ✓ Phase 7 wiring: `envWithDotEnv` imported by all four PC scripts (`scripts/fetch-linkedin.ts`, `watch-linkedin.ts`, `probe-linkedin.ts`, `login-linkedin.ts`)
- ✓ `package.json`: `fetch-linkedin` / `watch-linkedin` / `probe-linkedin` / `login-linkedin` entries present; lint and format globs include all four scripts; `@linkedapi/node` gone (deps: nodemailer, playwright only)
- ✓ `.gitignore`: `linkedin-cookies*.json` and `state/linkedin-leg-dead.flag` present, `linkedin-state*.b64` line gone; `git check-ignore state/linkedin-leg-dead.flag` names the path; `.env` confirmed ignored
- ✓ Login-helper entry guard: `scripts/login-linkedin.ts` runs only under the `import.meta.url === pathToFileURL(process.argv[1]).href` check — import stays side-effect free
- ✓ No regressions detected (343-test suite green; threads/judge/state/email suites untouched by the delta)

### Code Review Findings

#### Matches Plan:

- `src/linkedin-fetch.ts:180-187` — classifyFault 3xx branch exactly per the Phase 8 fence: leg-dead naming the redirect loop, placed before the 403 branch, doc comment carries the live-observed provenance and the §13.1 contradiction note
- `src/linkedin-fetch.ts:333-340` — Playwright `get` passes `maxRedirects: 0` so the 302 surfaces as a status into the classifier (comment names the b1 mechanism)
- `src/linkedin-fetch.ts:115-134` — `AllSurfacesFaulted` tagged error (constant + factory + guard) mirroring the judge-rotation idiom; walk throws it at `:491` only after the leg-dead drain check, so leg-dead beats faults (pinned by `tests/linkedin-fetch.test.ts:500`)
- `scripts/fetch-linkedin.ts:220` — fetchTick catches `isAllSurfacesFaulted` inside the try/finally: warns naming the count, returns `{wrote:false, pushed:false, postCount:0}`; disposal still runs in the finally; leg-dead path unchanged
- `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md:43,108,1141-1147` — detection table and provenance amended with the redirect-loop row and the §13.1 contradiction note, per Phase 8 §5
- `tests/linkedin-fetch.test.ts`, `tests/fetch-linkedin.test.ts` — all Phase 8 pins present: 302/301/307 rows, bodied-302, seven §13.3 rows unchanged, drain-then-throw-once, leg-dead-beats-faults, single-surface → AllSurfacesFaulted, 1-of-2 survivor publishes, 2-of-2 faulted===2, fetchTick all-faulted quiet-zeros with zero git calls and untouched marker, fine-empty still writes and pushes
- `src/config.ts:14-24` — ENV_NAMES final state: `linkedinCookiesFile`, `linkedinTransport`, `curlImpersonateBin` present; the SDK-era `linkedApi` pair removed (Phase 6 complete)

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan, including the Phase 8 amendment fences (classifier, transport, walk, tick, design artifact, suites).

#### Pattern Conformance:

- ✓ Tagged-error shape (`ALL_SURFACES_FAULTED` constant + factory + type guard) matches `src/judge-rotation.ts` and the existing `LegDeadError` in the same file
- ✓ Atomic payload writes reuse the shared `stateTempPath` helper from `src/state.ts` (plan-review suggestion, applied)
- ✓ PC scripts follow the repo's entry-guard idiom (`process.argv[1]` + `pathToFileURL` check), same as `src/index.ts`
- ✓ Tests stay offline and deterministic: injected exec/git/alarm doubles, OS-temp files, deferred-sleep pacing pins — matching the established `node:test` suite style

#### Potential Issues:

- Non-blocking, method note: several plan criteria are worded with `git grep`, which walks tracked files only — at validation time every new module and PC script is still untracked, so a literal reading under-verifies (e.g. the Phase 7 `git grep -n "envWithDotEnv" -- scripts` criterion returns empty either way). All three sweeps were re-run with plain recursive grep including untracked files: 0 residue hits, 4/4 scripts wired. Checks pass; the criteria as written are simply weaker than they look once the files are committed — commit (which tracks them) restores the `git grep` forms.
- Non-blocking, cleanup note: the spent rehearsal oracle `.rpiv/tmp/session-dead-rehearsal.mjs` was deleted after this passing run per the plan instruction. Its transcript above (`leg-dead=true payloadWritten=false gitCalls=0 alarms=1`, exit 0) is the surviving evidence; a future dead-leg rehearsal must re-author the script (its shape is described in Phase 8's criterion).

### Manual Verification Required:

Offline items — discharged by this validation run (operator asked for manual verification too):

- [x] Phase 1 §4.2 URL spot-check — executed, not eyeballed: the doc's exact semantic form pushed through `encodeRestliValue` reproduces DOCUMENTATION.md §4.2's encoded string byte-for-byte (`(query:(keywords:hiring%20react,…orderBy:LATEST…)`); reserved-char rows (`,` `(` `:` `'` space) all match. The production variable string differs only in the documented §12.4/§12.7 placement (orderBy omitted, `sortBy:date_posted` inside `queryParameters`) — that delta is covered by the §12.7 check.
- [x] Phase 3 §12.7 canonical URL — executed: `buildSearchUrl("#hiring react", 0, 50)` equals the §12.7 doc line with `%23hiring%20react` substituted and count 50, byte-for-byte.
- [x] Phase 2 §10 cookie header — executed: `buildCookieHeader` emits `li_at=AQE; JSESSIONID="ajax:1"` (li_at first unquoted, JSESSIONID last quoted), `csrfToken` returns the quote-stripped value — matching DOCUMENTATION.md §10's curl template (`--cookie "li_at=…; JSESSIONID=\"…\""`, `-H "csrf-token: $JSESSIONID"`).
- [x] Phase 7 entry guard — importing `scripts/login-linkedin.ts` opens no browser (guard verified in source; also pinned by the passing suite).

Live operations — remain homework for the operator (need the PC, real cookies, or a GitHub dispatch):

1. Phase 4/8 probe protocol:
   - [ ] `npm run probe-linkedin` passes twice, ≥6h apart, with stored cookies (Phase 4 criterion)
   - [ ] `npm run probe-linkedin` exits 1 on a corrupt cookie copy (Phase 4 criterion)
2. Phase 4/8 live rehearsals (dedicated clone):
   - [ ] Session-dead rehearsal live: corrupt the cookie-file copy → tick throws leg-dead → exactly ONE alarm email, loop continues; restore → next tick heals (Phase 8's item; discharges the Phase 4 original)
   - [ ] curl-transport dead-session presentation re-verified live — the rehearsal oracle used playwright; the curl leg must show the same leg-dead abort via the new 3xx branch
   - [ ] First live push happens from a dedicated clone under probe supervision
   - [ ] Conflict rehearsal: land a bot commit between the PC's checkout and its push; the rebase+retry push succeeds
3. Phase 5 PC-off rehearsal:
   - [ ] Stop the loop ≥31 min → a dispatched run logs the stale line, completes threads-only, heartbeat fires, state byte-identical
4. Phase 6 dispatch:
   - [ ] A manual watch.yml dispatch runs green with no LinkedIn secret mapped
5. Phase 7 real runs:
   - [ ] `npm run login-linkedin` opens the window → log in by hand → cookie file + `.env` line land → `npm run probe-linkedin` runs with NO env setup
   - [ ] Refresh rehearsal: re-run the login helper on a still-signed-in profile → harvested WITHOUT a login prompt; a leg-dead loop heals on its next tick

### Recommendations:

- Ready to commit — implementation is complete and validated (all 8 phases verified, gates green, Phase 8 oracle passed, prior blockers b1+b2 discharged).
- Commit in plan-phase order (phases 1-8) so each phase maps to an atomic commit; the deleted SDK quad and the doc syncs ride their own phases per the plan's file lists.
- The live rehearsal list above is the remaining acceptance surface; run the probe protocol first (cheapest), then the dedicated-clone session-dead rehearsal before trusting the loop.
