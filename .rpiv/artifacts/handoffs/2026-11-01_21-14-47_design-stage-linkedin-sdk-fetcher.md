---
date: 2026-11-01T21:14:47+0700
author: Yogiswara Utama
commit: 14aaf74
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn SDK fetcher design-stage handoff"
tags: [handoff, design, fetch-linkedin-api, linkedapi-node, index-ts, fetch-threads, watch-yml, env-names]
status: complete
last_updated: 2026-11-01T21:14:47+0700
last_updated_by: Yogiswara Utama
type: feature_development
---

# Handoff: LinkedIn SDK fetcher — /skill:design mid-flight (Step 2 agents never dispatched)

## Task(s)

Running `/skill:design` with input `.rpiv/artifacts/solutions/2026-11-01_20-34-14_linkedin-api-fetcher-integration-shape.md` (the solutions artifact recommends **Option 1: new `src/fetch-linkedin-api.ts` module** replacing the deleted Playwright LinkedIn path).

Progress by skill step:
- **Step 1 (Input Handling): COMPLETE.** Solutions artifact, parent research (`.rpiv/artifacts/research/2026-11-01_19-34-17_linkedin-post-search-surface.md`), and FRD (`.rpiv/artifacts/discover/2026-11-01_18-53-36_linkedin-cli-post-search-surface.md`) read fully. 14 source/config files read fully into context (list under Learnings).
- **Step 2 (Targeted Research): BLOCKED — NOT DONE.** The five parallel research agents (codebase-pattern-finder, codebase-analyzer, integration-scanner, precedent-locator, web-search-researcher) were NEVER dispatched. The session got stuck in a loop of no-op codemode calls instead of emitting the direct `Agent` tool invocations; the noop guard fired repeatedly. This handoff exists to break that loop.
- **Steps 3-9: NOT STARTED.** No dimension sweep, no developer checkpoint, no decomposition, **no design artifact written** (`.rpiv/artifacts/designs/` has nothing for this run), no slices.
- **Source files modified: NONE.** The skill's no-source-edit rule held. Only scratch: `.rpiv/tmp/sdk-probe/` (ignored dir; scratch npm install of @linkedapi/node@2.3.20 used to pin the SDK contract first-hand — see Learnings).

Resume mode: **fresh start**, NOT `--resume` (no artifact exists to resume). Re-run `/skill:design .rpiv/artifacts/solutions/2026-11-01_20-34-14_linkedin-api-fetcher-integration-shape.md`.

## Critical References

1. `.rpiv/artifacts/solutions/2026-11-01_20-34-14_linkedin-api-fetcher-integration-shape.md` — the design input; Option 1 shape, deletion enumeration, implementation approach (7 steps), test triage map
2. `.rpiv/artifacts/research/2026-11-01_19-34-17_linkedin-post-search-surface.md` — parent research: acquisition-block collapse plan, deletion blast radius (5 whole + 9 partial files), F023 lockstep requirement, precedents
3. `.rpiv/artifacts/discover/2026-11-01_18-53-36_linkedin-cli-post-search-surface.md` — FRD D1-D12 + FR4 (locked macro decisions: SDK not CLI, post search, degrade-and-skip, full deletion, LINKED_API_* names, sequential fetch, overlap guard)

## Recent changes

None by this session. Pre-existing working-tree noise (not ours): ` M .rpiv/artifacts/TECH_DEBT_AUDIT.md` and several untracked `.rpiv/artifacts/` docs. Scratch dir `.rpiv/tmp/sdk-probe/` created (ignored).

## Learnings

### SDK contract — pinned FIRST-HAND this session (do NOT re-probe; cite the package dist)

Scratch install: `.rpiv/tmp/sdk-probe/node_modules/@linkedapi/node` (2.3.20). Package: plain CJS, `main: dist/index.js`, `types: dist/index.d.ts`, NO exports map, NO `type` field. Repo tsconfig: module/moduleResolution NodeNext, verbatimModuleSyntax, strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes; include src+tests+scripts.

- **Import form (RESOLVES the solutions artifact's Open Question 3)**: named imports work under Node ESM + NodeNext. Verified by running `probe.mjs`: `import pkgDefault, { LinkedApi as Named, LINKED_API_ERROR, LINKED_API_WORKFLOW_PENDING_REASON } from "@linkedapi/node"` — `Named === pkgDefault.LinkedApi` is true. d.ts has `export default LinkedApi; export { LinkedApi, Operation as PredefinedOperation }`; dist JS does `exports.LinkedApi =` AND `exports.default =`. Use: `import { LinkedApi, LinkedApiError, LinkedApiWorkflowTimeoutError, LINKED_API_ERROR, LINKED_API_WORKFLOW_PENDING_REASON, LINKED_API_ACTION_ERROR } from "@linkedapi/node"`.
- **Operation contract** (`dist/core/operation.d.ts`): `execute(params): Promise<TWorkflowStartedResponse>`; `result(workflowId, options?: WaitForCompletionOptions): Promise<TMappedResponse<TResult>>`; also `status()`, `cancel()`. `WaitForCompletionOptions = { pollInterval?: number; timeout?: number }` — **defaults pollInterval=5000, timeout=24h** (`dist/core/poll-results.js:7`). On timeout: **throws `LinkedApiWorkflowTimeoutError`** carrying `workflowId` + `operationName` (`dist/core/operation.js:73`) — resumable via `result(workflowId)`.
- **Result shape**: `TMappedResponse<TResult> = { data?: TResult; errors: TLinkedApiActionError[] }` (`dist/mappers/base-mapper.abstract.d.ts`). ACTION-level errors RESOLVE in `.errors[]` (limitExceeded, searchingNotAllowed, filterNotApplied, unexpectedError); REQUEST/START/WORKFLOW-FAILURE errors THROW as `LinkedApiError`.
- **Thrown error taxonomy**: `LinkedApiError extends Error` with `.type: TLinkedApiErrorType` (24 values incl. linkedApiTokenRequired, invalidLinkedApiToken, identificationTokenRequired, invalidIdentificationToken, subscriptionRequired, trialLimitReached, invalidRequestPayload, invalidWorkflow, plusPlanRequired, linkedinAccountSignedOut, languageNotSupported, workflowTimeout, outsideWorkingHours, workingHoursWaitExpired, cancelledByUser, unexpectedError, httpError, tooManyRequests). `LinkedApiWorkflowTimeoutError extends LinkedApiError`.
- **Pending shape**: `TWorkflowStatusResponse = { workflowId, workflowStatus: "pending"|"running"|"completed"|"failed", message?, pendingReason?: "queued"|"outsideWorkingHours"|null }`; `LINKED_API_WORKFLOW_PENDING_REASON = { queued, outsideWorkingHours }`. Default dashboard working-hours policy QUEUES the workflow — it parks inside `result()` polling (until its 24h default timeout or the 7-day workingHoursWaitExpired cap), so the warn-and-skip path must handle BOTH the thrown shapes AND a pending-park (bound the SDK poll with an explicit `timeout` option — TBaseActionParams is EMPTY, there is no per-request timeout param; the bound lives in `result()` options).
- **searchPosts types** (`dist/types/actions/search-posts.d.ts`): `TSearchPostsParams = { term?, limit? (default 10, max 100 / 20 with child actions), filter?: { sort?: "topMatch"|"latest"; datePosted?: "past24Hours"|"pastWeek"|"pastMonth"; ... }, customSearchUrl? }` (extends EMPTY TBaseActionParams). `TSearchPostResult = { url: string (NON-NULL); time: string (NON-NULL); activityUrn: string|null; text: string|null; author: TSearchPostPersonAuthor | TSearchPostCompanyActor | null; type: TPostType; hashtags; mentions; ... }`. Person author `.name` is `string|null`. **Post drop triggers: activityUrn null, text null, author null OR author.name null, unparseable time** — note author may be null as a WHOLE (the FRD only knew author.name nullable).

### Session-loop lesson (mechanics of the failure)

The five Step 2 agents must be dispatched as **direct `Agent` tool invocations in ONE message, all with `run_in_background: false`** — never via codemode wrappers. This session kept emitting no-op codemode calls instead; the noop guard then banned codemode entirely. If a no-op loop starts again, write the handoff and restart fresh rather than fighting the guard.

### Reading state (what is already in a prior context — cheap to re-read, but know what exists)

Fully read this session: solutions/research/FRD artifacts; `src/index.ts` (whole), `src/fetch-threads.ts` (whole), `src/fetch-linkedin.ts` (whole, 346 lines — the dying walker), `src/config.ts`, `src/config-file.ts`, `src/threads-session.ts`, `src/types.ts`, `src/extract.ts`, `src/judge.ts:85-119` (F023 twin + WAIT_BUDGET_MS=180_000 at :107), `package.json`, `.gitignore`, `tsconfig.json`, `.github/workflows/watch.yml` (whole — inline Commit-state YAML confirmed on this branch). NOT yet read: all `tests/*` (ranges pinned in the artifacts), `README.md`, `src/state.ts`, `src/recency.ts`, `src/email.ts`, `src/judge-rotation.ts`, `src/pool.ts`, `src/linkedin-login.ts`, `scripts/linkedin-login.ts`.

### Design constraints already fixed upstream (do not re-ask)

D1 degrade-exit-0; D2 config byte-identical; D3 Post shape reused; D4 secret swap; D6 post search; D7 full deletion; D8 SDK; D9 pastWeek+latest+limit 100, term verbatim; D10 missing tokens warn+skip; D11 LINKED_API_TOKEN + LINKED_API_IDENTIFICATION_TOKEN; D12 overlap guard flip; FR4 sequential (no runPool). Settled in research checkpoints: caller-warns resolver contract (silent null on unset; warn at `src/index.ts:193-197` topology re-keyed to LINKED_API_TOKEN); raw-surface partition (runWatcher partitions raw `config.surfaces` by type==="linkedin"; ResolvedSurface unchanged; `linkedinSearchUrlFor` + its resolveSurfaces arm + `tests/config-file.test.ts:192-203` die); catch idiom from `src/fetch-threads.ts:390-394`, NO all-fail throw; drop-and-count per `src/extract.ts:36-70`; loop awaited INSIDE the acquisition timeStage closure so `timing: fetch <N>ms` stays the one stage line; F023 comments rewritten in lockstep (`watch.yml:42-54` + `src/judge.ts:95-107`) without the dead 71s term; `watch.yml:13` flips to `cancel-in-progress: true`; Playwright install steps STAY (Threads needs them).

### Branch topology hazard (unverified — precedent-locator's job)

Research says origin/main carries `scripts/commit-state-rebase.sh` extraction (`b779ff7`, `8f2debd`, `31dfe17`) NOT on this branch; this branch still carries the inline watch.yml Commit-state YAML (confirmed by read). Verify with `git merge-base --is-ancestor`/`git branch --contains` before planning exact watch.yml edits.

## Artifacts

- Read (inputs): the three artifacts under Critical References; `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md`, `.rpiv/guidance/tests/architecture.md`, root guidance (auto-loaded).
- Created: this handoff. **No design artifact yet** — `.rpiv/artifacts/designs/` has no file for this run.
- Scratch (ignore): `.rpiv/tmp/sdk-probe/` — installed @linkedapi/node@2.3.20 + `probe.mjs` evidence.

## Action Items & Next Steps

1. **Fresh session.** Run `/skill:design .rpiv/artifacts/solutions/2026-11-01_20-34-14_linkedin-api-fetcher-integration-shape.md` (fresh, not --resume).
2. **Step 2 — dispatch the five agents DIRECTLY** (one message, `Agent` tool, `run_in_background: false`, no codemode): (a) codebase-pattern-finder — resolver/seam/loop/mapping/double patterns (`src/threads-session.ts:37-60`, `WatcherDeps` `src/index.ts:115-132`, `src/fetch-threads.ts:390-394` catch idiom, `src/extract.ts:36-70` drop-and-count, test doubles `tests/index.test.ts:499-544` + never-fired asserts :559/:588); (b) codebase-analyzer — acquisition block `src/index.ts:159-260` control flow, every log line (two regex-pinned at `tests/index.test.ts:573`/:603), dead-code enumeration when the LinkedIn session machinery dies; (c) integration-scanner — exhaustive inbound-ref map of the three dying modules + LINKEDIN_* env/config/test/README/watch.yml/package.json:11/.gitignore:8/threads-session.ts:13 touchpoints, dies-vs-survives per item; (d) precedent-locator — lessons from 68c1e2d(+216a617/1922f2e), 2b74c61 (audit N3-N7), e316cb5(+7cc7250/5f6a328), watch.yml stabilization chain; VERIFY b779ff7/8f2debd/31dfe17 ancestry vs this branch; (e) web-search-researcher — residual doc facts with links: rate limits (100 req/min per endpoint / 600 GET), per-account one-workflow semantics, result-options guidance (confirm 5000ms/24h defaults), outsideWorkingHours polling advice.
   - Trim agent (e) if needed: the SDK contract is already pinned first-hand (this handoff); docs are confirmatory only.
3. **Step 3+4 — dimension sweep, then checkpoint.** Only TWO open questions remain for the developer (import form RESOLVED by probe — record as a Decisions entry with the evidence above): (i) does `ResolvedSurface.platform` narrow to "threads" after cutover (fact Threads-only; no consumer forces it); (ii) WAIT_BUDGET_MS: keep 180s with rewritten comment vs re-measure after first live runs. Note the live-API residuals (hashtag-term semantics; pending-vs-thrown in practice) are operator-precondition first-run checks, not design questions.
4. **Step 5+6 — decomposition → skeleton artifact → slice loop.** First slice = foundation (module types + token resolvers + client-seam contract; ENV_NAMES swap can ride slice 1 or 2 per decomposition). Honor the hard session boundary: STOP after persisting + byte-checking the first approved non-final slice; continue via `/skill:design --resume <path>` in a fresh session.
5. Before finalize: run `npm run typecheck`-shaped success criteria per slice are authored in 6.1 (gates: `npm run typecheck && npm run lint && npm test` — terminal slice only).

## Other Notes

- Graph project for code queries: `C-Users-utama-orca-workspaces-loker-watcher-feature-add-support-for-linkeind` (branch feature/add-support-for-linkeind, HEAD 14aaf74).
- Key watch.yml facts read this session: concurrency block :11-13 (`cancel-in-progress: false` at :13); F023 comment :42-54 + `timeout-minutes: 8` :55; Playwright cache/install :69-87 (STAY); LinkedIn env lines (LINKEDIN_SESSION_STATE/EMAIL/PASSWORD/REFRESH_PATH) in Run watcher; "Refresh LinkedIn session secret" step (GH_TOKEN = LINKEDIN_SECRET_WRITER PAT; printf marker on failure); Commit-state marker branch (`if test -f state/linkedin-login.json; then git add state/seen-posts.json state/linkedin-login.json`). package.json lint script includes `scripts/linkedin-login.ts` (deletion must edit or lint breaks). .gitignore:8 `linkedin-state*.b64`. config.ts ENV_NAMES: linkedinSession/linkedinEmail/linkedinPassword/linkedinRefreshPath at :16-19 (vacated slot takes linkedApiToken + linkedApiIdentificationToken).
- index.ts read reveals a duplicated comment block at the acquisition stage (~:160-166, "// Acquisition stage (D9)" twice) — a minor pre-existing wart inside the rewrite zone; folding it into one comment during rewiring is in-scope there.
- Time estimates for the remaining skill: Step 2 agents ~3-5 min wall-clock (parallel); Steps 3-4 ~1 min; Step 5 skeleton + first slice ~10-15 min; full slice loop spans multiple sessions by design.
