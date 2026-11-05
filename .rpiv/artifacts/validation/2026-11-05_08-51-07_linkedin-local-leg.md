---
template_version: 1
date: 2026-11-05T08:51:07+0700
author: Yogiswara Utama
commit: 4c11e0f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Validation of LinkedIn leg on the local PC"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md"
tags: [validation, linkedin, voyager-graphql, curl-impersonate, playwright, local-loop, payload-handoff, sdk-removal]
last_updated: 2026-11-05T08:51:07+0700
---

## Validation Report: LinkedIn leg on the local PC

### Implementation Status

- ✓ Phase 1: Voyager client core (pure) — Fully implemented
- ✓ Phase 2: Session cookies module — Fully implemented
- ✓ Phase 3: Fetch module — transport adapters, fault classification, runPool walk — Fully implemented
- ✓ Phase 4: Payload + PC scripts + alarm + wiring — Fully implemented
- ✓ Phase 5: Watch-side ingest re-key — Fully implemented
- ✓ Phase 6: SDK removal + residue sweep + docs — Fully implemented

Working tree matches the plan's declared write-set exactly: 21 modified files, 2 deletions (`src/fetch-linkedin-api.ts`, `tests/fetch-linkedin-api.test.ts`), 12 new source/test/script files. Implementation is uncommitted (validate-before-commit per the workflow).

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean
- ✓ Lint: `npm run lint` — 48 files checked, no issues
- ✓ Tests: `npm test` — 319 tests, 70 suites, 0 failures (158 pre-existing + 4 new linkedin suites + re-keyed index/heartbeat suites)
- ✓ Phase 6 residue sweep: `git grep -nE 'linkedapi|linked_api|LINKED_API|fetch-linkedin-api' -- ':(exclude).rpiv/artifacts/**'` — 0 lines
- ✓ Phase 6 wording sweep: `grep -rniE 'linked API|linked-api' src tests scripts` — 0 lines; only surviving `SDK` is `src/judge.ts:4`'s "no SDK" LLM-client note (still true, as the plan expects)
- ✓ Phase 1 fixture scrub: `grep -aiE "li_at|jsessionid|cookie|authorization|csrf" tests/fixture/voyager-search-response.json` — 0 hits
- ✓ Phase 5 non-modification pin: `git diff --name-only -- src/judge-rotation.ts` — empty
- ✓ Phase 6 ignore sweep: `git check-ignore state/linkedin-leg-dead.flag` names the path; `linkedin-state*.b64` residue line gone
- ✓ Fence conformance: 17 whole-file fences extracted from the plan and byte-diffed against the working tree — 16 byte-identical (linkedin-voyager, its test, fixture, linkedin-session, its test, linkedin-fetch test, linkedin-payload, its test, fetch-linkedin test, scripts/fetch-linkedin, watch-linkedin, probe-linkedin, heartbeat, its test, index, .gitignore); 1 comment-only drift (see Deviations)
- ✓ Partial-fence conformance: `ENV_NAMES` final state byte-matches fence A (SDK pair gone, LinkedIn trio in, 9 names); `LINKEDIN_PAYLOAD_PATH` present; package.json scripts block byte-matches (3 npm entries + widened lint/format globs, `@linkedapi/node` gone from package.json and package-lock.json); email.ts carries all four changes; watch.yml has no `LINKED_API` env lines and the payload-note comment; README §"The LinkedIn leg on your PC (voyager)" landed; config-file/threads-session/judge/config-file.test comment re-keys all landed; all five guidance files synced
- ✓ Documentation-accuracy drift check: guidance's "watch.yml maps 6 of the 9 ENV_NAMES" claim verified true against the workflow env block
- ✓ No regressions detected — the pre-existing suites (state, judge, heartbeat funnel, config) all green under the re-keyed tree

### Code Review Findings

#### Matches Plan:

- `src/linkedin-voyager.ts` — byte-identical to the Phase 1 fence (this also discharges the Phase 6 §7 verify-only item: the re-spliced provenance line is present, no "mapper-idiom" wording survives)
- `src/linkedin-session.ts` / `src/linkedin-payload.ts` / `scripts/*` / `src/heartbeat.ts` / `src/index.ts` / `tests/*` — byte-identical to their plan fences (16/17)
- `src/linkedin-fetch.ts` — byte-identical except one comment rewrap (see Deviations); the reserve-before-sleep pacing gate, `LegDeadError` tagged error (mirrors the `RotationExhausted` idiom in judge-rotation.ts), §13.3 classifier, and curl/playwright transports all match
- `src/linkedin-payload.ts:24,95` — the plan-review amendment is applied: `writePayloadAtomic` reuses `stateTempPath` from `./state.js`
- `scripts/probe-linkedin.ts` — reads `process.env[ENV_NAMES.linkedinTransport]` (plan-review amendment applied)
- Both transports send the shared `BROWSER_UA` (plan-review amendment applied)

#### Deviations from Plan:

- `src/linkedin-fetch.ts:334-335` — the `makePacingGate` doc comment is rewrapped relative to the Phase 3 fence (words identical; the line break moved from after "a" to after "burst;"). Comment-only, no executable line changes, no downstream stage fails as written — the comment-only class never forces the verdict.

#### Pattern Conformance:

- ✓ `LegDeadError`/`isLegDead` follows the tagged-error idiom of `RotationExhausted`/`isRotationExhausted` (judge-rotation.ts)
- ✓ `writePayloadAtomic` follows the atomic temp+rename shape of `writeStateAtomic` via the shared `stateTempPath` helper (state.ts)
- ✓ The playwright transport quarantine follows the `chromiumContextFactory` dynamic-import idiom (fetch-threads.ts); unexercised offline like its precedent — the `VoyagerGet` seam carries the tests
- ✓ `pushPayload` mirrors the `commit-state-rebase.sh` single-path rebase+retry discipline; `scripts/probe-linkedin.ts` follows the `probe-judge.ts` zero-edit gate pattern; scripts → src arrow respected (nothing in src/ imports scripts/)

#### Potential Issues:

- `.codebase-memory/artifact.json` is modified in the working tree but no phase declares it. Adjudicated benign: it is a generated index-metadata artifact (its `indexed_at` is 2026-11-03, before this plan was authored — the codebase-memory tooling rewrote it during the earlier discovery/research sessions, not the implementation run). Exclude it from the feature commits.
- The `LINKEDIN_PAYLOAD_PATH` constant sits at `src/config.ts:62` beside the exports block rather than immediately below `ENV_NAMES` — the plan itself rules the position immaterial to every gate ("may instead sit beside `STATE_PATH`"), so this is acceptable variation, not a deviation.

### Manual Testing Required:

Executed during this validation (results recorded above the line, evidence in the session log):

1. Plan-phase eyeball items, executed against the shipped code and `H:/fork/linkedin-reverse/DOCUMENTATION.md`:
   - [x] §4.2 worked example — `encodeSearchVariables("hiring react", 0, 3)` output matches the doc's encoded value token-for-token; the only deltas are the two §12.7 corrections the plan deliberately carries (`orderBy:LATEST` omitted, `sortBy:date_posted` added, per §12.4)
   - [x] §10 cookie template — `buildCookieHeader` emits `li_at=...; JSESSIONID="..."` (unquoted first, quoted last) and `csrfToken` strips the quotes; the static header set matches the template's `-H` pairs exactly
   - [x] §12.7 canonical recipe — `buildSearchUrl("#hiring react", 0, 25)` is byte-for-byte the doc's template with `YOUR%20TEXT` → `%23hiring%20react`
   - [x] Fixture provenance header (Phase 1, pre-checked in the plan) — present in the loading test's header comment
   - [x] storageState contract eyeball (Phase 2, pre-checked in the plan) — name/value/domain/path/secure shape pinned by the suite
2. Rehearsals executable offline, executed here:
   - [x] `npm run probe-linkedin` with a corrupt cookie copy → exit 1, message names `LINKEDIN_COOKIES_FILE` (fail-visible)
   - [x] `npm run fetch-linkedin` offline fail-visible chain → cookie resolution then transport resolution each throw naming the missing variable (`CURL_IMPERSONATE_BIN` named when unset)
   - [x] Conflict rehearsal with REAL git in a temp clone triangle (bare origin + bot clone + PC clone): bot commit landed on origin/main between the PC clone's checkout and its push; `pushPayload` rebased the payload commit cleanly and pushed — origin/main carries both commits, payload intact, bot's README intact
   - [x] PC-off stale degrade: a real 2h-old payload file read through the shipped `readPayloadPosts` → log line `linkedin: payload stale (2h old) — threads-only run`, leg=stale, zero posts, no throw

Still requires the live environment (operator homework — these are inherently live: real cookies, real network, real GitHub):

1. Phase 4:
   - [ ] `npm run probe-linkedin` exits 0 on a live leg; run twice ≥6h apart before trusting the loop
   - [ ] First live push happens from a dedicated clone under probe supervision
   - [ ] Session-dead rehearsal live half: a real dead session (401/403) → exactly ONE alarm email and the loop continues (the offline halves — fail-visible exit, marker edge, best-effort alarm, loop-continues — are pinned by `tests/fetch-linkedin.test.ts`)
2. Phase 5:
   - [ ] PC-off ≥31 min: a dispatched hosted run logs the stale line, completes threads-only, heartbeat fires, state byte-identical (the reader-level stale degrade was verified here directly)
3. Phase 6:
   - [ ] A manual watch.yml dispatch runs green with no LinkedIn secret mapped (static half verified: the workflow maps 6 env names, none LinkedIn)

### Recommendations:

- Ready to commit — implementation is complete and validated. Stage the feature per the plan's phase grouping and leave `.codebase-memory/artifact.json` out of the feature commits.
- After the live push works end to end, work through the four operator-homework items above; each has its offline contract already pinned by a test.
