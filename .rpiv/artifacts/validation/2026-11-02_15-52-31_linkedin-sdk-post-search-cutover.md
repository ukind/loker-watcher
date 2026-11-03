---
template_version: 1
date: 2026-11-02T16:11:19+0700
author: Yogiswara Utama
commit: ecc9865
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Validation of LinkedIn SDK post-search cutover — Playwright path deleted"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-02_13-52-20_linkedin-sdk-post-search-cutover.md"
tags: [validation, fetch-linkedin-api, linkedapi-node, index-ts, fetch-threads, config-file, watch-yml, env-names, phase7-deletion]
last_updated: 2026-11-02T16:11:19+0700
---

## Validation Report: LinkedIn SDK post-search cutover — Playwright path deleted

Validated against the working tree on top of ecc9865 (the implementation is uncommitted; git evidence is the working-tree delta, not commits).

### Implementation Status

- ✓ Phase 1: SDK fetcher module — Fully implemented
- ✓ Phase 2: runWatcher rewiring — Fully implemented
- ✓ Phase 3: Threads-only shed + config-file arm death — Fully implemented
- ✓ Phase 4: Phase 7 deletion + env swap + F023 lockstep — Fully implemented
- ✓ Phase 5: Docs sync — Fully implemented

### Automated Verification Results

- ✓ Whole-repo gates: `npm run typecheck` — exit 0; `npm run lint` — 37 files, clean; `npm test` — 240/240 pass, 0 fail (the pre-plan suite was 226; the delta is the new SDK-fetcher suite plus the D13/D14 pins)
- ✓ Phase 1 quarantine: `grep -c 'await import("@linkedapi/node")' src/fetch-linkedin-api.ts` — 1 (exactly); `runPool` — 0; `all .*failed` — 0; `LINKED_API_` in src/config.ts — 2
- ✓ Phase 2 rewiring: `recoverLinkedInSession` / `linkedin-login` / `LINKEDIN_SESSION_STATE` in src/index.ts — all 0; the D13 single return `threadsPosts, ...linkedinPosts` — exactly 1
- ✓ Phase 3 shed: `linkedinSessionPath` / `walkLinkedInSurface` / `fetch-linkedin` in src/fetch-threads.ts — all 0; `linkedinSearchUrlFor` in src/config-file.ts and tests/config-file.test.ts — 0; the wide platform union literal — 0
- ✓ Phase 4 deletion + swap: `ENV_NAMES.linkedin` across src/tests/scripts — 0; `LINKEDIN_` literals across src/tests/.github — 0; `71s` in watch.yml + judge.ts — 0; all five deleted modules absent; leftover `fetch-linkedin.js`/`linkedin-login.js` importers — 0; the refresh step and the marker branch — gone from watch.yml; `cancel-in-progress: true` — present exactly once
- ✓ Phase 5 docs: README `LINKEDIN_|linkedin-login|linkedin-state` literals — 0; guidance literals — 0; README names `LINKED_API_IDENTIFICATION_TOKEN` 4× (>= 3); both guidance mirrors name `fetch-linkedin-api`; guidance `cancel-in-progress: true` — exactly 1
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- src/fetch-linkedin-api.ts — the full plan fence: module-top search constants (limit 100, latest, past24Hours), silent two-token resolver, the single NAMED dynamic-import quarantine site, total-by-contract sequential loop, the parked-workflow skip that never awaits result(), errors[]-warn-and-keep, drop-and-count mapping with the guarded pre-toISOString timestamp, and the throw-null-safe describeError
- src/index.ts:119-140 — the optional `linkedinFetch` WatcherDeps seam; the D14 raw-partition startup line; the D13 single return `[...threadsPosts, ...linkedinPosts]`; the surfaceLabel helper; recoverLinkedInSession and its login imports gone
- src/config.ts — the final 8-entry ENV_NAMES exactly per the Phase 4 fence
- src/judge.ts:109 — WAIT_BUDGET_MS stays 180_000; the F023 comment rewritten verbatim (fetch term PENDING MEASUREMENT, retune-commit pointer) in lockstep with watch.yml:42-58
- src/threads-session.ts — docstring re-pointed at the SDK truth; resolver body untouched
- src/config-file.ts:225-241 — the fail-visible wiring-bug guard verbatim; the Surface union keeps `linkedin` (D8)
- .github/workflows/watch.yml — concurrency cancel + rationale comment; the Linked API env pair at :104-105; the "Refresh LinkedIn session secret" step deleted; Commit state collapsed to the state-file-only add
- tests — the new offline SDK suite (14 cases over the LinkedApiClientLike stub, including parked workflows, errors[], thrown-null, and the pinned search shape); the D13 and D14 pins (tests/index.test.ts:705); the re-homed scrollRounds test plus the single-context test; the resolveSurfaces guard test; the Phase 7 login describe deleted; tests/session.test.ts carries no ENV_NAMES import and no LinkedIn-var tests
- README.md — pipeline step 2, the two secrets rows (:67-68), the surfaces-row tail (:100), the Threads-only scrollRounds row (:105), the single "LinkedIn tokens (Linked API)" section (:241), and the disclosed external-cron sentence (:206); the pinned-unchanged digest marker and "+ LinkedIn" subject step stand at :38-39

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ The new module follows the repo's established idioms: module-top measured constants (no env tuning), the silent degradable resolver (the resolveSession model), a total-by-contract fetch loop, a structural `*Like` seam with the real SDK behind one dynamic import, and `node:`-prefixed imports
- ✓ Test structure mirrors the sibling suites: describe/it naming, the console-capture helper, a stub builder with recording arrays
- Minor observation: src/fetch-linkedin-api.ts wraps the `clientFactory` parameter across lines where the plan fence kept one line — Biome formatting only, acceptable variation, not a deviation
- Note: Phase 3's manual gate ("exactly 1 linkedin match in src/fetch-threads.ts") reads 0 in the final tree because Phase 4 deleted the PageMouseLike member together with its last consumer — that is the plan's intended final state; the 1-match reading was an intermediate-slice assertion

#### Potential Issues:

- GitHub secrets are not migrated: `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN` are absent from ukind/loker-watcher while the old `LINKEDIN_SESSION_STATE` / `LINKEDIN_EMAIL` / `LINKEDIN_PASSWORD` trio remains (checked via `gh secret list`, 2026-11-02). Migration Notes declares this operator-side, so it is not a code defect — but merged runs skip LinkedIn with the single warn until the pair is set.
- The live happy path is unproven, blocked by seat state: the Linked API admin API (accounts.getAll) reports zero connected LinkedIn accounts and no pending connection sessions, so no identification token exists yet for the seat. The API token itself verified valid against that endpoint. The live DEGRADE path is proven: a real dispatch to linkedapi.io returned the typed error `invalidIdentificationToken`, and the module degraded exactly per contract — one warn line, empty result, no throw, exit 0.
- Both Linked API credentials passed through chat during this validation — rotate them in the Linked API dashboard after the live gate passes.
- Untracked `linkedin-state.b64` sits at the repo root: expected per Migration Notes (the `.gitignore` ignore line was removed by design). It must never be committed.

### Manual Testing Required:

1. Live dispatch gate (operator-owned, post-merge — the plan's merge-blocking design-completion gate):
   - [ ] Connect a LinkedIn account at app.linkedapi.io (the seat currently has none) and copy the connected account's identification token
   - [ ] Set `LINKED_API_TOKEN` + `LINKED_API_IDENTIFICATION_TOKEN` GitHub secrets and delete the old `LINKEDIN_*` trio
   - [ ] After commit + push: one green `workflow_dispatch` run of watch.yml, capturing `timing: fetch <N>ms` for the declared retune commit
   - [ ] One deliberately-bad-`LINKED_API_TOKEN` dispatch proving the single warn + Threads delivery + exit 0
2. Startup-line spot-check (Phase 2 manual) — DONE during this validation: pinned by tests/index.test.ts:705 and passing in `npm test`
3. Docs coherence pass (Phase 5 manual) — DONE during this validation: no dangling "fallback login below" pointers; exactly one LinkedIn section; pinned-unchanged regions intact
4. Local live degrade check (surrogate for half of the live gate) — DONE during this validation against the real endpoint (see Potential Issues)

### Recommendations:

- Ready to commit — implementation is complete and validated.
- Before merge: connect the LinkedIn account, set the new secret pair, remove the old `LINKEDIN_*` trio, and rotate both credentials (chat exposure).
- After the first live dispatch: paste the measured fetch term into watch.yml and src/judge.ts — the one declared retune commit.
