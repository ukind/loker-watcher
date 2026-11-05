---
template_version: 1
date: 2026-11-05T12:41:22+0700
author: Yogiswara Utama
commit: 87de494
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Validation of LinkedIn leg on the local PC"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md"
tags: [validation, linkedin, voyager-graphql, curl-impersonate, playwright, local-loop, payload-handoff, sdk-removal, login-helper, curl-setup, checkout-preflight]
last_updated: 2026-11-05T12:41:22+0700
---

## Validation Report: LinkedIn leg on the local PC

Fifth validation run of the plan, first over Phase 10. Run 4 (2026-11-05_11-35-37) passed phases 1-9 at 353/353; the operator then ran the live chain green through `login-linkedin` → `setup-curl` → `probe-linkedin` (curl transport, HTTP 200), and the first live `fetch-linkedin` tick failed on a mis-homed checkout with a misdiagnosed rebase message — the revise added Phase 10 (dedicated-clone preflight + honest git failure surfaces, `last_updated` 2026-11-05T11:56:56+0700). This run verifies the whole tree with emphasis on the Phase 10 delta, which is UNCOMMITTED in the working tree together with the still-uncommitted Phase 9 delta (`base = HEAD` = 87de494: new files `scripts/setup-curl-impersonate.ts` + `tests/setup-curl-impersonate.test.ts` untracked; 15 tracked files modified). Evidence: working-tree inspection against the plan fences, `git diff` for the uncommitted delta, the three repo gates, and the operator's explicit ask to ALSO execute the manual verification: every offline-dischargeable manual criterion was executed by the validator (three by-eye spec comparisons against `H:/fork/linkedin-reverse/DOCUMENTATION.md` through a scratch driver under `.rpiv/tmp/`, deleted after; the Phase 10 mis-homed rehearsal re-run live from this workspace; the episode-marker ignore check), and the results are recorded under Manual Testing Required. No `--goal`, `--baseline`, `--scope`, or `--acceptance` inventory was provided; the plan frontmatter carries no `risks:` array, so those steps do not apply.

### Implementation Status

- ✓ Phase 1: Voyager client core (pure) — Fully implemented (`src/linkedin-voyager.ts`; §4.2 worked-example spot check executed this run — see Manual)
- ✓ Phase 2: Session cookies module — Fully implemented (`src/linkedin-session.ts`; §10 cookie-template spot check executed this run — see Manual)
- ✓ Phase 3: Fetch module — transport adapters, fault classification, runPool walk — Fully implemented (`src/linkedin-fetch.ts`; §12.7 canonical-URL spot check executed this run — see Manual)
- ✓ Phase 4: Payload + PC scripts + alarm + wiring — Fully implemented (`src/linkedin-payload.ts`, PC scripts, `src/email.ts` alarm, episode marker repo-local and `git check-ignore`-verified this run)
- ✓ Phase 5: Watch-side ingest re-key — Fully implemented (`src/index.ts`, `src/heartbeat.ts`; `src/judge-rotation.ts` byte-identical to 4c11e0f AND untouched by the working tree — re-verified this run)
- ✓ Phase 6: SDK removal + residue sweep + docs — Fully implemented (residue sweep 0, wording sweep 0 — re-verified this run across tracked AND untracked files)
- ✓ Phase 7: Login helper + auto-env — Fully implemented (`src/env-file.ts`, `scripts/login-linkedin.ts`; hoisted `upsertDotEnvLine` at `src/env-file.ts:83` with its pins in the env-file suite)
- ✓ Phase 8: Leg-dead classifier amendment + empty-payload guard — Fully implemented (committed in a8752bf; `AllSurfacesFaulted` quiet-zero tick re-pinned in the current suite at `tests/fetch-linkedin.test.ts:340-356`)
- ✓ Phase 9: curl-impersonate one-command setup + probe remedy ergonomics — Fully implemented (uncommitted, re-verified: `CURL_IMPERSONATE_PROFILE = "chrome116"` at `src/linkedin-fetch.ts:83`, `--impersonate` in the curl args, no `user-agent` pair on the curl transport, resolver message names BOTH remedies at :280, five npm entries, `.gitignore` `tools/`; `tools/curl-impersonate/` now EXISTS on the PC, corroborating the operator's live-setup transcript)
- ✓ Phase 10: Dedicated-clone preflight + honest git failure surfaces — Fully implemented (uncommitted): `GitRunner` resolves `{code, output}` with merged stdout+stderr captured on BOTH the resolved and rejected paths (`scripts/fetch-linkedin.ts:41-58`); exported `guardCheckout` (:166-187) runs the two preflight reads (`rev-parse --abbrev-ref HEAD`, `status --porcelain`) wired into `fetchTick` AFTER the no-surfaces early return and BEFORE the cookie/transport resolvers (:282-284, comment names the zero-GET guarantee); every push-discipline failure carries git's own output (`git said:` on commit :221, rebase :234, double-failure :240); suite pins all present (`tests/fetch-linkedin.test.ts`: wrong branch → branch + wrong-ref named, `transport.gets() === 0`, no payload file, throws before `status` :428-454; dirty tree → path count + paths named :456-489; clean main → exactly the two guard reads :417-424; honest rebase failure → git's own `unstaged changes` line in the message and NOT "rebase conflicted" :243-255; amended end-to-end/leg-dead/faulted/no-surfaces ordering pins :293-295, :326-329, :353-356, :386-408; `realGit` spawn pins both output paths :136-147); README troubleshooting row (:294-297) + AGENTS exit-contract bullet (:32) + guidance scripts sync (3 `guardCheckout` mentions) all landed; `watch-linkedin.ts` correctly unchanged — its non-leg-dead catch warns and continues, so a mis-homed loop warns every 10 min instead of burning live fetches

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean, exit 0
- ✓ Lint: `npm run lint` — 54 files checked, no fixes needed
- ✓ Tests: `npm test` — 358/358 pass, 0 fail, 0 skipped (~12.4s; 353 at run 4 + 5 Phase 10 tests: 2 realGit output-path pins + 3 guardCheckout pins)
- ✓ Phase 6 residue sweep: `git grep -nE 'linkedapi|linked_api|LINKED_API|fetch-linkedin-api' -- ':(exclude).rpiv/artifacts/**'` — 0 lines; wording sweep (`linked API|linked-api` over src/tests/scripts) — 0
- ✓ Phase 1 fixture scrub: `grep -aiE "li_at|jsessionid|cookie|authorization|csrf" tests/fixture/voyager-search-response.json` — 0 hits
- ✓ Phase 5 byte-identity pin: `git diff --name-only 4c11e0f..HEAD -- src/judge-rotation.ts` AND `git diff --name-only HEAD -- src/judge-rotation.ts` — both empty (committed phases and the uncommitted delta leave it untouched)
- ✓ Drift sweep: the removed misleading message survives only as the negative pin (`tests/fetch-linkedin.test.ts:254` asserts the message does NOT contain "rebase conflicted") and in `scripts/commit-state-rebase.sh:42`, whose "state rebase conflicted; skipping" text is the HOSTED bot script's own distinct semantics, untouched by this plan — no stale references in code or docs
- ✓ Operator-state checks: stray workspace `state/linkedin-posts.json` from the 2026-11-05 11:56 failed run is GONE (`state/` holds only `seen-posts.json` — Phase 10 manual item's cleanup clause verified); `git check-ignore state/linkedin-leg-dead.flag` names the path (Testing Strategy item 7)
- ✓ Scope: the uncommitted delta's files map 1:1 onto Phase 9 + Phase 10 declared `files:` plus the plan/design/validation artifacts themselves; no out-of-scope writes; `.rpiv/tmp/` scratch deleted after use
- ✓ No regressions detected — threads/judge/state/email/heartbeat suites green; the only test-count delta is Phase 10's own additions

### Code Review Findings

#### Matches Plan:

- `scripts/fetch-linkedin.ts:41-58` — the GitRunner fence verbatim: `{code, output}` resolution, `windowsHide`, merged+trimmed channels, `Number.isInteger` guard on the rejected path's code
- `scripts/fetch-linkedin.ts:166-187` — `guardCheckout` verbatim: wrong-branch message names the branch, the wrong-ref consequence, and the dedicated-clone remedy; dirty-tree message names the path count, the first five paths, and the remedy; both before any resolver/network
- `scripts/fetch-linkedin.ts:220-241` — the honest-failure fence verbatim: commit failure keeps the identity-fix guidance and appends `git said:`, rebase failure logs git's output before `rebase --abort`, the double-failure throw carries `lastFailure`
- `tests/fetch-linkedin.test.ts:63-85` — `scriptGit` double returns `{code, output}` scripted per command with default `output: ""`, exactly per the plan's suite amendment
- `scripts/watch-linkedin.ts` — byte-for-byte the pre-Phase-10 loop; the plan's "needs NO change" claim holds because the non-leg-dead catch already warns-and-continues for any plain error

#### Deviations from Plan:

None. The Phase 10 delta is a faithful realization of the plan fences, and phases 1-9 remain faithful per runs 1-4 plus this run's spot re-verification.

#### Pattern Conformance:

- ✓ The guard follows the repo's PC-script idiom: exported over an injectable seam (`GitRunner`), fail-visible messages that name the problem AND the remedy, tests pin both message fragments and the zero-side-effect guarantee (`transport.gets() === 0`, payload `ENOENT`)
- ✓ The `scriptGit` double keeps the suite's literal-doubles discipline — per-command scripting map, no mock library
- Minor observation (acceptable variation, not a deviation): `guardCheckout` splits `status.output` on `"\n"` while the branch read splits on `/\r?\n/` — `realGit` trims the merged output and `execFile` without a shell returns git's raw LF lines on Windows, so the path count cannot over-count; the branch read's `\r?` is harmless defensive symmetry

#### Potential Issues:

- Non-blocking, operator-state note: the `.env` per-clone consequence is now real — after moving to the dedicated clone, `npm run login-linkedin` + `npm run setup-curl` must run INSIDE the clone (both upsert `<cwd>/.env`). This is documented in the new README troubleshooting row (:294-297); the workspace's own `.env` (this safety-net-protected file was not read during validation) is irrelevant to the leg once the loop homes in the clone.
- Non-blocking, live-evidence note: `tools/curl-impersonate/` exists on the PC and the plan marks Phase 9's live-setup criterion [x] on the operator transcript (`probe: 7325ms — HTTP 200 — 10 post(s), 0 dropped`) — this validation did not re-drive the live network leg (it needs the real session); the standing ≥6h-apart second probe remains owed.

### Manual Testing Required:

Offline items — DISCHARGED by this validation run (the operator asked for manual verification to be executed, not just listed):

1. Phase 1 §4.2 worked example (executed through a scratch driver over the real `encodeSearchVariables`, deleted after):
   - [x] `encodeSearchVariables("hiring react", 0, 3)` reproduces the §4.2 encoded value byte-for-byte — `(query:(keywords:hiring%20react,flagshipSearchIntent:SEARCH_SRP,queryParameters:(resultType:CONTENT,datePosted:past-24h,sortBy:date_posted)),origin:GLOBAL_SEARCH_HEADER,start:0,count:3)` — with the ONE documented delta: `orderBy:LATEST` replaced by `sortBy:date_posted`, the §12.4/§12.7 correction the plan encodes on purpose
2. Phase 2 §10 cookie template (executed over the real `buildCookieHeader` + `csrfToken`):
   - [x] Header renders `li_at=AQE...; JSESSIONID="ajax:0123456789012345678"` — li_at unquoted first, JSESSIONID quoted last — exactly the §10 `--cookie` template; the csrf-token value rides the quote-stripped jsessionid per §3
3. Phase 3 §12.7 canonical URL (executed over the real `buildSearchUrl`):
   - [x] `buildSearchUrl("#hiring react", 0, 25)` equals the §12.7 recipe with `YOUR%20TEXT` → `%23hiring%20react` — endpoint, queryId, queryName, and the restli variables string all byte-match
4. Phase 10 mis-homed rehearsal (re-executed live from THIS workspace):
   - [x] `npm run fetch-linkedin` exits 1 with NO `fetch:` line, NO payload write, naming the branch (`"feature/add-support-for-linkeind", not main`), the wrong-ref consequence, and the dedicated-clone remedy — the guard fires before the cookie/transport resolvers exactly as pinned
5. Testing Strategy item 7:
   - [x] `git check-ignore state/linkedin-leg-dead.flag` names the path (the episode marker can never be tracked)
6. Phase 10 manual item cleanup clause:
   - [x] the stray workspace `state/linkedin-posts.json` from the 11:56 failed run is deleted (`state/` = `seen-posts.json` only)

Live operations — remain homework for the operator (need the dedicated clone, real cookies, a headed browser, or a GitHub dispatch):

1. Phase 10 manual item 1:
   - [ ] Full chain from the DEDICATED clean clone of main: `npm run login-linkedin` + `npm run setup-curl` INSIDE the clone → probe green → `npm run fetch-linkedin` → the payload commit lands on origin/main → a dispatched watch run merges it
2. Phase 9 standing items:
   - [ ] Second `npm run probe-linkedin` ≥6h after the first (twice-≥6h-apart protocol)
   - [ ] Fingerprint coherence eyeball: the probe's 200 rides the chrome116 profile's own UA
   - [ ] Escape-hatch rehearsal: rename the binary away → probe fails naming `npm run setup-curl` and the playwright line; apply `LINKEDIN_TRANSPORT=playwright` by hand → probe passes on playwright
3. Phase 7:
   - [ ] Refresh rehearsal: re-run `npm run login-linkedin` on a still-signed-in profile → harvested WITHOUT a login prompt
4. Phase 8 (amends Phase 4's session-dead item):
   - [ ] Live session-dead rehearsal from the dedicated clone: corrupt the cookie copy → tick throws leg-dead on the 302 branch → exactly ONE alarm, loop continues; restore → next tick heals
   - [ ] curl-transport dead-session presentation re-verified live (the offline rehearsal drove playwright; the curl leg must show the same 3xx leg-dead abort)
5. Phase 4:
   - [ ] Conflict rehearsal: bot commit between the PC's checkout and its push → rebase+retry succeeds
6. Phase 5:
   - [ ] PC-off rehearsal: stop the loop ≥31 min → dispatched run logs the stale line, completes threads-only, heartbeat fires, state byte-identical
7. Phase 6:
   - [ ] Manual watch.yml dispatch runs green with no LinkedIn secret mapped

### Recommendations:

- Ready to commit — all 10 phases implemented and validated; gates green at 358/358.
- Commit the combined Phase 9 + Phase 10 delta next (`scripts/setup-curl-impersonate.ts`, `tests/setup-curl-impersonate.test.ts`, `scripts/fetch-linkedin.ts`, `tests/fetch-linkedin.test.ts`, `src/env-file.ts`, `src/linkedin-fetch.ts`, `scripts/login-linkedin.ts`, the four amended test files, `package.json`, `.gitignore`, README/AGENTS/guidance), plus this report and the plan/design artifact updates — the working tree then satisfies the very preflight the leg enforces.
- Run the live homework in README order from the dedicated clone; the first `fetch-linkedin` tick there is the real end-to-end discharge of Phase 10's manual item 1.
