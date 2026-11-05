---
template_version: 1
date: 2026-11-05T11:35:37+0700
author: Yogiswara Utama
commit: 87de494
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Validation of LinkedIn leg on the local PC"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md"
tags: [validation, linkedin, voyager-graphql, curl-impersonate, playwright, local-loop, payload-handoff, sdk-removal, login-helper, curl-setup]
last_updated: 2026-11-05T11:35:37+0700
---

## Validation Report: LinkedIn leg on the local PC

Fourth validation run of the plan. Run 3 (2026-11-05_10-51-31) passed phases 1-8, the work was committed (a8752bf feat, 5974ac4 + 87de494 docs), and the revised plan added Phase 9 (curl-impersonate one-command setup + probe remedy ergonomics, `last_updated` 2026-11-08:31 note). This run re-verifies the whole tree with emphasis on the Phase 9 delta, which is UNCOMMITTED in the working tree (new files `scripts/setup-curl-impersonate.ts` + `tests/setup-curl-impersonate.test.ts` untracked; 13 tracked files modified). Evidence: working-tree inspection, `git diff 4c11e0f..HEAD` for the committed phases, and `git diff` for the Phase 9 delta. No `--goal`, `--baseline`, `--scope`, or `--acceptance` inventory was provided, so those steps do not apply. The operator asked for manual verification in addition to the automated gates: every offline-dischargeable manual criterion was executed by the validator through the real exported seams (two scratch rehearsal drivers under `.rpiv/tmp/`, 26 checks, all passing, both deleted after), and the results are recorded under Manual Testing Required.

### Implementation Status

- ✓ Phase 1: Voyager client core (pure) — Fully implemented (`src/linkedin-voyager.ts`, offline suite, scrubbed fixture)
- ✓ Phase 2: Session cookies module — Fully implemented (`src/linkedin-session.ts`; Phase 7 message re-keys applied at :96, :105 with pinned prefixes intact)
- ✓ Phase 3: Fetch module — transport adapters, fault classification, runPool walk — Fully implemented (`src/linkedin-fetch.ts`; Phase 9 profile amendment applied at :83, :293-294)
- ✓ Phase 4: Payload + PC scripts + alarm + wiring — Fully implemented (`src/linkedin-payload.ts`, three PC scripts, `src/email.ts` alarm + digest leg line, `LINKEDIN_PAYLOAD_PATH` at `src/config.ts:62`)
- ✓ Phase 5: Watch-side ingest re-key — Fully implemented (`src/index.ts` re-keyed at :116-117, :155, :202; `src/heartbeat.ts` leg line at :118, :142)
- ✓ Phase 6: SDK removal + residue sweep + docs — Fully implemented (quad deleted, all sweeps 0 hits, docs + watch.yml + guidance synced)
- ✓ Phase 7: Login helper + auto-env — Fully implemented (`src/env-file.ts`, `scripts/login-linkedin.ts`, all four PC scripts wire `envWithDotEnv`)
- ✓ Phase 8: Leg-dead classifier amendment + empty-payload guard — Fully implemented (3xx branch `src/linkedin-fetch.ts:182`, `maxRedirects: 0` :367, `AllSurfacesFaulted`, fetchTick guard `scripts/fetch-linkedin.ts:220`, design artifact amendment) — committed in a8752bf, oracle passed at run 3
- ✓ Phase 9: curl-impersonate one-command setup + probe remedy ergonomics — Fully implemented (uncommitted): `scripts/setup-curl-impersonate.ts` (checksum-pinned lexiforest v2.3.2, entry-guarded :208, escape hatch :71), `CURL_IMPERSONATE_PROFILE = "chrome116"` (:83) with `--impersonate` in the curl args (:293-294) and the `user-agent` header pair removed from the curl transport (:283, playwright-only at :357), resolver remedy message (:280 names both remedies), `upsertDotEnvLine` hoisted to `src/env-file.ts:83` with login-linkedin re-importing (:27), `setup-curl` npm entry + globs (`package.json:13-19`), `.gitignore` `tools/`, README/AGENTS/guidance synced

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean, exit 0
- ✓ Lint: `npm run lint` — 54 files checked (globs now include `scripts/setup-curl-impersonate.ts`), no fixes needed
- ✓ Tests: `npm test` — 353/353 pass, 0 fail, 0 skipped (~12.4s; 343 at run 3 + 10 Phase 9 setup/hoist tests)
- ✓ Phase 6 residue sweep: `git grep -nE 'linkedapi|linked_api|LINKED_API|fetch-linkedin-api' -- ':(exclude).rpiv/artifacts/**'` — 0 lines; wording sweep (`linked API|linked-api`) 0 across src/tests/scripts including the untracked Phase 9 files; only surviving `SDK` mention is `src/judge.ts`'s "no SDK" note (still true)
- ✓ Phase 5 byte-identity pin: `git diff --name-only 4c11e0f..HEAD -- src/judge-rotation.ts` — empty
- ✓ Phase 1 fixture scrub: `grep -aiE "li_at|jsessionid|cookie|authorization|csrf" tests/fixture/voyager-search-response.json` — 0 hits
- ✓ Phase 7 wiring: `envWithDotEnv` imported by all four PC scripts; probe passes the merged env into `resolveLinkedInTransport(env, cookies)` (`scripts/probe-linkedin.ts:47`)
- ✓ Phase 9 pinned digests verbatim: `94affc91…f40db` (x86_64-win32) and `e9c1d8d5…408d8` (arm64-win32) present in `scripts/setup-curl-impersonate.ts:59,63`; the setup suite computes its fixture's sha256 itself (`tests/setup-curl-impersonate.test.ts:41-43`, `createHash` recomputation — no hard-coded fixture digest)
- ✓ Phase 9 hoist pins: `upsertDotEnvLine` exported from `src/env-file.ts`, its describe block (6 pin sites) lives in `tests/env-file.test.ts`, login-linkedin imports it from `../src/env-file.js` (:27) and no longer duplicates it
- ✓ Phase 9 curl-args pin: `--impersonate chrome116` present (`src/linkedin-fetch.ts:293-294`); the `user-agent` header pair ABSENT from the curl transport (comment at :283 states the profile owns it); the `-L`/`--location` absence pin byte-identical (`tests/linkedin-fetch.test.ts:204-206`) — curl must not follow redirects so the 3xx status reaches the §13.3 classifier
- ✓ `package.json`: five npm entries (`fetch-linkedin`, `watch-linkedin`, `probe-linkedin`, `login-linkedin`, `setup-curl`); lint and format globs include all five scripts; `@linkedapi/node` gone from both manifests
- ✓ `.gitignore`: `linkedin-cookies*.json`, `state/linkedin-leg-dead.flag`, `tools/` present; `linkedin-state*.b64` residue gone
- ✓ Phase 6 comment re-keys pinned: `src/config-file.ts:15,23,223,231` (4 sites incl. the wiring-bug throw with regex prefix unchanged), `src/threads-session.ts:14`, `src/judge.ts` F023 twin (1 hit), `tests/config-file.test.ts:192` title (regex pin unchanged), `src/linkedin-voyager.ts` — 0 "mapper-idiom" hits (slice-1 fence re-splice carried)
- ✓ Phase 8 design artifact amendment: redirect-loop row + §13.1 contradiction note present (`.rpiv/artifacts/designs/…linkedin-local-leg.md:43,110,1143`)
- ✓ README PC-operations step order matches the plan: login-linkedin → setup-curl → probe-linkedin (twice ≥6h apart) → watch-linkedin (`README.md:264-286`, quick-reference block :314-317)
- ✓ No regressions detected — threads/judge/state/email/heartbeat suites untouched by the Phase 9 delta and green

### Code Review Findings

#### Matches Plan:

- `scripts/setup-curl-impersonate.ts` — the full Phase 9 §2 flow in order: already-configured short-circuit, arch-selected checksum-pinned download, `node:crypto` sha256 verification, OS-`tar` extraction, `curl-impersonate*.exe` tree walk (inner layout never assumed), `upsertDotEnvLine` wiring, probe pointer log; EVERY failure path names the playwright escape hatch (`:71`) and the entry is guarded (`:208`)
- `src/linkedin-fetch.ts:280` — the `CURL_IMPERSONATE_BIN is not set` error names BOTH remedies (`npm run setup-curl`, `LINKEDIN_TRANSPORT=playwright` in .env) with the pinned prefix intact for the existing test regexes
- `src/env-file.ts:83-110` — the hoisted writer is signature-identical to the plan fence (absent-file starts empty, idempotent replace, returns false when the line already matches)
- `src/linkedin-session.ts:96,105` — Phase 7 resolver messages point at `npm run login-linkedin`; the `LINKEDIN_COOKIES_FILE is not set` and `which does not exist` regex prefixes survive unchanged (353-test suite proves it)
- Phase 1-8 surfaces — re-verified spot-level this run: ENV_NAMES final state (`src/config.ts`), `LINKEDIN_PAYLOAD_PATH` (:62), heartbeat `linkedinLegLine` (:118) + funnel conditional spread (:142), digest `leg?: LegLine` (`src/email.ts:75,146`) + `sendLegDeadAlarm` (:240), index.ts acquisition re-key with the D12 belt catch, fetchTick guard at `scripts/fetch-linkedin.ts:220` — all matching the plan fences and run 3's findings

#### Deviations from Plan:

None. The Phase 9 delta is a faithful realization of the plan fences, and the committed phases remain faithful per run 3.

#### Pattern Conformance:

- ✓ The setup script follows the repo's PC-script idiom: entry guard (`process.argv[1]` + `pathToFileURL`), injectable boundaries for offline tests (`fetchFn`, `tarRunner`, `env`, `envPath`, `targetDir`, `exists`), fail-visible errors that name the problem, exit 1 on every failure path
- ✓ The hoist follows the module-ownership rule the repo already uses: the `.env` contract (parse, merge, upsert) now lives entirely in `src/env-file.ts`; scripts import, never duplicate
- ✓ The curl-args amendment keeps the transport's arg array declarative and pinned: profile flag before `-sS`, `-H` overrides composed on top of the profile defaults per the lexiforest README, `-w` status sentinel unchanged
- Minor observation (acceptable variation, not a deviation): `tests/login-linkedin.test.ts` dropped its `upsertDotEnvLine` describe entirely rather than keeping it with a re-pointed import — the pins moved to `tests/env-file.test.ts` per the plan's "moved pins" wording, so coverage is intact, only the file location differs from a literal reading of "its suite's import follows"

#### Potential Issues:

- Non-blocking, cleanup note: the Phase 8 rehearsal oracle `.rpiv/tmp/session-dead-rehearsal.mjs` no longer exists — deleted after run 3's passing re-validate per the plan's own instruction ("kept … until re-validate passes; delete after"). Its transcript (`leg-dead=true payloadWritten=false gitCalls=0 alarms=1`, exit 0) survives in run 3's report. This run re-executed the same behaviors offline through the real seams (see Manual item 3) with 12/12 checks passing; a future LIVE dead-leg rehearsal must re-author the script per Phase 8's criterion wording.
- Non-blocking, operator state note: `tools/curl-impersonate/` does not exist yet — the Phase 9 live setup run (`npm run setup-curl` → binary lands → live curl-transport probe) is still owed. The offline fail half of the escape-hatch rehearsal was executed this run (probe exits 1 naming both remedies); the live pass halves remain operator homework.
- Non-blocking, criteria-strength note (closes run 3's observation): phases 1-8 are now committed, so the plan's `git grep` criteria walk tracked files and are at full strength. The Phase 9 files are still untracked; the residue/wording sweeps for them were run with plain recursive grep (0 hits) — after commit the `git grep` forms apply unchanged.

### Manual Testing Required:

Offline items — discharged by this validation run through the real exported seams (scratch drivers under `.rpiv/tmp/`, deleted after; 26/26 checks passed):

1. Phase 4 corrupt-cookie contract (executed, not eyeballed):
   - [x] `probe-linkedin` with a corrupt cookie copy → exit 1, `…which is not valid JSON — Expected property name…` naming `LINKEDIN_COOKIES_FILE`
2. Phase 7/9 remedy ergonomics (executed):
   - [x] `probe-linkedin` with a valid-shaped cookie file and `CURL_IMPERSONATE_BIN` empty → exit 1 naming BOTH remedies: `run npm run setup-curl, or put LINKEDIN_TRANSPORT=playwright in .env` (the escape-hatch rehearsal's fail half)
3. Phase 8 leg-dead + guard behaviors (12 checks, all passing): 302 redirect loop → walk throws leg-dead naming the redirect; ALL-faulted tick → `{wrote:false, pushed:false, postCount:0}` with NO payload file, 0 git calls, episode marker byte-untouched, no alarm; fine-empty tick (0 posts, 0 faults) → still writes and pushes, staging ONLY the payload path; leg-dead tick → rejects, no payload, no git, alarm policy left to the caller; episode edge → exactly ONE alarm, second dead call quiet, marker persists
4. Phase 5 hosted-side degrade + rendering (14 checks, all passing): absent payload → quiet `no payload — threads-only run`, leg absent; 31+ min old payload → `payload stale (2h old) — threads-only run`, leg stale with age detail; fresh payload → leg ok, posts survive; heartbeat line renders all four states exactly (`ok`/`DARK`/`absent`/`malformed`); funnel renders the line only when attached; digest renders the line only when not ok and marks the `[linkedin]` row

Live operations — remain homework for the operator (need the PC, real cookies, a headed browser, a dedicated clone, or a GitHub dispatch):

1. Phase 4/9 probe protocol:
   - [ ] `npm run setup-curl` live → binary lands in `tools/curl-impersonate/`, `.env` line lands → `npm run probe-linkedin` passes on the curl transport with the chrome116 profile fingerprint (then twice, ≥6h apart)
   - [ ] `npm run probe-linkedin` passes on the live leg with stored cookies (Phase 4 criterion)
   - [ ] Fingerprint coherence eyeball: the probe's 200 rides the profile's own UA
   - [ ] Escape-hatch pass half: rename the binary away → probe fails; apply `LINKEDIN_TRANSPORT=playwright` by hand → probe passes on playwright
2. Phase 7 real runs:
   - [ ] `npm run login-linkedin` real run → cookie file + `.env` line land → probe runs with NO env setup
   - [ ] Refresh rehearsal: re-run the login helper on a still-signed-in profile → harvested without a login prompt
3. Phase 4/8 live rehearsals (dedicated clone):
   - [ ] Session-dead rehearsal live: corrupt the cookie copy → tick throws leg-dead on the redirect → exactly ONE alarm, loop continues; restore → next tick heals (curl transport must show the same 3xx leg-dead abort the offline rehearsal proved)
   - [ ] First live push from a dedicated clone under probe supervision
   - [ ] Conflict rehearsal: bot commit between the PC's checkout and its push; rebase+retry succeeds
4. Phase 5 PC-off rehearsal (dispatched):
   - [ ] Stop the loop ≥31 min → dispatched run logs the stale line, completes threads-only, heartbeat fires, state byte-identical
5. Phase 6 dispatch:
   - [ ] Manual watch.yml dispatch runs green with no LinkedIn secret mapped

### Recommendations:

- Ready to commit — implementation is complete and validated across all 9 phases; gates green at 353/353.
- Commit the Phase 9 delta next (scripts/setup-curl-impersonate.ts + tests/setup-curl-impersonate.test.ts + the 13 modified files) so the working tree is clean before the live operator flow.
- Run the live operator chain in README order: `npm run setup-curl` → `npm run probe-linkedin` (curl) → `LINKEDIN_TRANSPORT=playwright npm run probe-linkedin` (escape-hatch pass half) → `npm run watch-linkedin`; then the ≥6h-apart second probe.
