---
date: 2026-11-01T18:53:36+0700
author: Yogiswara Utama
commit: 14aaf74
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn surface via Linked API post search"
tags: [intent, frd, fetch-linkedin-api, config-file, watch-yml, linkedapi-node]
status: ready
last_updated: 2026-11-01T18:53:36+0700
last_updated_by: Yogiswara Utama
---

# FRD: LinkedIn surface via Linked API post search

## Summary
Replace the blocked Playwright LinkedIn fetch path with a fetcher that drives Linked API (the service behind linkedin-cli) to run LinkedIn post searches from GitHub Actions. The two existing `{type: "linkedin"}` surfaces stay unchanged; results normalize into the shared Post pipeline. The whole Playwright LinkedIn path (fetcher, login, secrets, refresh step) is deleted, and every LinkedIn-side failure degrades to warn + skip so the run still exits 0.

## Problem & Intent
The developer's framing, verbatim: "the linked in watcher can not continue because the linkedin is blocked datacenter or github action api. but what if we using this: https://github.com/Linked-API/linkedin-cli . run inside github action".

LinkedIn blocks GitHub Actions datacenter IPs, so the Playwright LinkedIn fetcher cannot run from the only runtime there is. When asked what success looks like, the developer picked: **"Pipeline unblocks"** — the scheduled run stops failing on LinkedIn; a clean exit matters more than full coverage. The proposed mechanism was the linkedin-cli; the interview established the underlying service (Linked API) is what actually solves the IP problem (residential-IP cloud browser per connected LinkedIn account).

## Goals
- The scheduled `*/10` GitHub Actions run completes cleanly (exit 0) every time, with or without working LinkedIn fetches.
- LinkedIn posts from the `#hiring` / `#hiring react` surfaces flow into the same dedupe → recency → seen → judge → digest funnel as Threads posts.
- Freshest-first discovery: posts up to `recencyHours` (72h) old are eligible, newest at the top.
- One mechanism for LinkedIn: the old blocked path is removed, not kept alongside.

## Non-Goals
- Watching LinkedIn **Jobs listings** (`jobs search` — company postings with Easy Apply filters). Surfaced and declined: the current config watches hashtag *posts*, and the judge keywords are tuned for posts.
- Keeping the Playwright LinkedIn path as a dormant or local-only fallback.
- Running LinkedIn surfaces concurrently (impossible by design — Linked API runs one workflow at a time per connected account's browser).
- Any change to Threads fetching, judge rotation, digest email, heartbeat, or state format.

## Functional Requirements
1. A new acquisition module (e.g. `src/fetch-linkedin-api.ts`) builds an `@linkedapi/node` client from two env tokens and runs a post search per `linkedin` surface with: `term` = surface `value`, `sort` = latest, `datePosted` = `pastWeek` (the CLI's smallest window that covers `recencyHours: 72`; `recency.ts` trims to the exact cutoff), `limit` = 100.
2. Search results map onto the existing `Post` shape (`id` = LinkedIn post urn, `platform` = `"linkedin"`, `text`, `author`, `permalink`, `timestamp` as ISO). Posts missing any required field are dropped and counted — parse, don't validate.
3. Mapped posts join the existing funnel unchanged: dedupe, `recencyHours` filter, seen-state diff, judge, digest, atomic state save. `recency.ts` and `state.ts` need no code change.
4. LinkedIn surfaces run sequentially (one cloud browser, one workflow at a time per the Linked API docs).
5. Failure semantics — every LinkedIn-side fault degrades, never kills the run: surface search failure → warn + skip that surface; working-hours window / `limitExceeded` → warn + skip; missing `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN` env → degradable resolver (warn + null), LinkedIn arm skipped. The run continues with Threads results and exits 0.
6. `ENV_NAMES` gains the two token names; `watch.yml` maps them from GitHub secrets `LINKED_API_TOKEN` and `LINKED_API_IDENTIFICATION_TOKEN`, and the Playwright LinkedIn secrets + session-refresh step are removed.
7. Deletion of the old path: `src/fetch-linkedin.ts`, `src/linkedin-login.ts`, `scripts/linkedin-login.ts`, `tests/fetch-linkedin.test.ts`, `tests/linkedin-login.test.ts`, their `ENV_NAMES` entries (`linkedinSession`, `linkedinEmail`, `linkedinPassword`, `linkedinRefreshPath`), and the watch.yml refresh block (watch.yml:94-128 region). The Threads session machinery (`THREADS_SESSION_STATE`) is untouched.
8. Tests stay offline: the SDK client rides the repo's function-seam idiom (optional trailing param with production default), stubbed in tests — no network, no real tokens.
9. Rewire the acquisition call sites, which today route LinkedIn through the deleted Playwright modules: the platform split in `src/index.ts` (index.ts:180-181), the authenticated dispatch into `fetchSurfacesAuthenticated` (index.ts:212), and the logged-out LinkedIn arm (index.ts:237-249) all route LinkedIn surfaces through the new SDK seam instead; `src/fetch-threads.ts` drops its `fetchLinkedInSurface` dispatch and becomes Threads-only. The logged-out/authenticated distinction collapses for LinkedIn — tokens are the session; the Threads session machinery keeps its own logged-out mode unchanged.
10. `.github/workflows/watch.yml` gains an overlap guard so two watcher runs never share a window: at most one run at a time, and a newly triggered run while one is in progress cancels the stale one. Rationale: sequential cloud-browser searches plus the judge's 180s park budget can push a run past the `*/10` interval, and an overlap means two runs double-hitting the same LinkedIn account plus duplicate digest emails (state commits only at run end, so concurrent runs judge the same unseen posts).

## Non-Functional Requirements
- **Performance**: each post search is a Linked API workflow (cloud browser, poll-to-result — seconds to minutes per surface, sequential). Run duration grows; `timeStage` continues to log `timing: <stage> <N>ms`. Cadence stays `*/10`.
- **Security**: tokens are env-only via `ENV_NAMES` and GitHub Actions secrets; never logged, never committed. Same trust boundary as existing secrets.
- **UX / Accessibility**: no user-facing surface; digest email format unchanged.
- **Reliability**: all LinkedIn faults degrade to warn + skip with exit 0 (developer's stated intent). First run after cutover may judge up to ~200 posts once; the judge pool + wait budget + exhaustion alarm already bound that burst. Outside the account's configured working hours, workflows do not execute — the run must treat that as degrade-not-fail.

## Constraints & Assumptions
- **Runtime**: Node >= 22, ESM, strict TS flags stay on.
- **Dependency doctrine exception**: `@linkedapi/node` becomes the repo's first external service SDK (the LLM client is deliberately raw `fetch`). The stated need for the PR description: typed `post search` responses (the CLI's README documents zero response fields) and no process boundary. Chosen over spawning linkedin-cli.
- **Cost**: Linked API is a paid subscription (~$49/seat/mo Core, unlimited workflow execution). The developer accepts this implicitly by choosing the service; the seat = one connected LinkedIn account.
- **Account risk**: automating a real LinkedIn account carries ToS/risk; Linked API's working-hours and action-limit features are the mitigation surface. Assumption: the operator configures sensible limits/working hours on the dashboard.
- **Verified offline (scratch install, @linkedapi/node@2.3.20, repo-exact tsconfig — TSC_EXIT=0 + ESM import OK)**: `searchPosts` exists as `client.searchPosts.execute(params)` → `.result(workflowId)`; params `{ term, limit (max 100), filter: { sort: "latest", datePosted: "pastWeek" } }`; `TSearchPostResult` carries `time: string` (feeds `recency.ts`), `url: string`, `activityUrn: string | null`, `text: string | null`, `author.name: string | null` — every Post-required field except `url`/`time` is nullable, so drop-and-count (FR 2) is mandatory. `new LinkedApi({ linkedApiToken, identificationToken })` requires both tokens (matches D11). Probe code (config, buildParams, Post mapping, execute/result flow) compiles clean under `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`, NodeNext.
- **Assumption (live-API, unverified)**: hashtag-style terms (`#hiring react`, 13 chars, under the 50-char cap) return the expected post set — needs real tokens; first-run check (see Open Questions).
- **Assumption**: LinkedIn post urns are stable and distinct from Threads ids, so `seen-posts.json` coexistence is safe (precedent: `urn:li:activity:` ids already flow through state today).
- **Precondition (operator, blocking)**: a paid Linked API seat with a connected LinkedIn account must exist at app.linkedapi.io, and both `LINKED_API_*` secrets must be stored in GitHub, BEFORE the workflow is enabled. Without it the feature ships dead: every run warns-and-skips LinkedIn silently forever.

## Acceptance Criteria
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` all exit 0.
- [ ] `tests/fetch-linkedin-api.test.ts` (offline, stubbed SDK client) covers: happy-path Post mapping, missing-field drop + count, per-surface failure degrade, and token-less skip — all pass with no network access.
- [ ] A `runWatcher` invocation with token-less env and offline stubs logs a warn naming `LINKED_API_TOKEN`, skips the LinkedIn arm, still judges Threads posts, and returns normally (no throw).
- [ ] `.github/workflows/watch.yml` maps `LINKED_API_TOKEN` and `LINKED_API_IDENTIFICATION_TOKEN` and contains no `LINKEDIN_SESSION_STATE`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`, or refresh step.
- [ ] `src/fetch-linkedin.ts`, `src/linkedin-login.ts`, `scripts/linkedin-login.ts`, and their two test files no longer exist in the repo.
- [ ] `watcher.config.json` is byte-identical to today (both `linkedin` surfaces intact).
- [ ] `ENV_NAMES` contains the two new token names and no longer contains `linkedinSession`/`linkedinEmail`/`linkedinPassword`/`linkedinRefreshPath`.
- [ ] `watch.yml` declares the overlap guard: a newly triggered run while one is in progress cancels the stale run — no two runs overlap, observable in the Actions tab.
- [ ] Operator precheck completed before the workflow is enabled: a Linked API seat with a connected LinkedIn account exists at app.linkedapi.io, and both `LINKED_API_*` secrets are stored in GitHub.

## Recommended Approach
New acquisition module `src/fetch-linkedin-api.ts` wrapping `@linkedapi/node`'s post search, injected into `runWatcher` as an optional function seam (production default, stubbed offline in tests); `ENV_NAMES` + degradable resolvers for `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN`; watch.yml secret swap; full deletion of the Playwright LinkedIn path (modules, scripts, tests, env entries, refresh step). Sequential per-surface searches; every fault warns, skips, and keeps the run green.

## Decisions

### D1 — Success definition: pipeline unblocks
**Question**: What does success look like once LinkedIn job watching works again from GitHub Actions?
**Recommended**: n/a — `intent` question
**Chosen**: "Pipeline unblocks" — the scheduled run stops failing on LinkedIn; a clean exit matters more than full coverage
**Rationale**: Developer's own framing; shapes every downstream failure-semantics decision.

### D2 — Keep LinkedIn surfaces unchanged in config
**Question**: From the probe I inferred — LinkedIn surfaces stay as-is in watcher.config.json (watcher.config.json:30-31, config-file.ts:220-237). Keep this for the feature, or change config as part of the work?
**Recommended**: Keep config
**Chosen**: Keep config
**Rationale**: evidence: watcher.config.json:30-31 + confirmed; zero config migration; `{type: "linkedin"}` union and `resolveSurfaces` already exist.

### D3 — Normalize into the existing Post shape
**Question**: From the probe I inferred — linkedin-cli results normalize into the existing Post shape (src/types.ts:8-25, state.ts:24-26). Keep this for the feature, or change it?
**Recommended**: Reuse Post shape
**Chosen**: Reuse Post shape
**Rationale**: evidence: src/types.ts:8-25 + confirmed; seen-state keys are generic strings (state.ts:24-26), `urn:` ids already coexist with Threads digit ids.

### D4 — Swap watch.yml LinkedIn secrets for Linked API tokens
**Question**: From the probe I inferred — watch.yml's Playwright LinkedIn secrets (watch.yml:94-96) get replaced by Linked API tokens. Confirm, or change?
**Recommended**: Swap secrets
**Chosen**: Swap secrets
**Rationale**: evidence: .github/workflows/watch.yml:94-96 + confirmed; names fixed to `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN` in D11.

### D5 — Degrade + exit 0 on LinkedIn failure
**Question**: From the probe I inferred — when linkedin-cli fails, the run degrades gracefully like the logged-out arm does today (index.ts:246). Confirm, or change?
**Recommended**: Degrade, exit 0
**Chosen**: Degrade, exit 0
**Rationale**: evidence: src/index.ts:246 + confirmed; matches the D1 intent (clean exit > coverage).

### D6 — Wrap `post search`, not `jobs search`
**Question**: The CLI's direct fit is `post search` (hashtag posts — what you watch now), while the headline `jobs search` watches job listings (new content type). Which should the new fetcher wrap?
**Recommended**: Post search
**Chosen**: Post search
**Rationale**: Developer's choice; existing surfaces are hashtag post searches and the judge keywords are tuned for posts; `jobs search` would silently change what is watched.

### D7 — Delete the Playwright LinkedIn path entirely
**Question**: What happens to the old Playwright LinkedIn path (fetch-linkedin.ts, linkedin-login.ts, LINKEDIN_* secrets + session-refresh step in watch.yml:94-128, plus their tests)?
**Recommended**: Delete it
**Chosen**: Delete it
**Rationale**: Developer's choice; the path never worked from Actions (datacenter IP block), dead code would linger against the repo's no-silent-fallback doctrine.

### D8 — Drive Linked API via the `@linkedapi/node` SDK, not the CLI process
**Question**: How should the fetcher drive Linked API from the pipeline — spawn the linkedin-cli process (as proposed), or depend on the underlying @linkedapi/node SDK it wraps?
**Recommended**: Spawn the CLI
**Chosen**: Use the SDK instead
**Rationale**: Developer's choice after corrected comparison — typed responses (CLI documents no `post search` result fields) and no process boundary outweigh the runtime-dependency doctrine hit, which gets its stated need in the PR description (AGENTS.md permits this).

### D9 — Search window, sort, and limit
**Question**: Which --date-posted window / how many posts per surface (--limit)?
**Recommended**: pastWeek window; 100 per surface
**Chosen**: "recent hour up to 72 hours, but sorted to the latest. the most fresh in the top" → `pastWeek` + `sort: latest` + `limit: 100`
**Rationale**: The CLI has no 72h option; `pastWeek` is the smallest window covering `recencyHours: 72`, `recency.ts` trims exactly; `sort: latest` puts freshest first per the developer's words.

### D10 — Missing tokens: skip + warn, exit 0
**Question**: When the Linked API tokens are missing from the environment, what should the run do?
**Recommended**: Skip + warn
**Chosen**: Skip + warn
**Rationale**: evidence: src/index.ts:195 (today's missing-session arm) + confirmed; degradable-resolver contract from the src guidance; a temporary secret lapse must not kill the whole digest.

### D11 — Token env names: `LINKED_API_*`
**Question**: Names for the two new GitHub secrets / env vars?
**Recommended**: `LINKED_API_TOKEN` + `LINKED_API_IDENTIFICATION_TOKEN`
**Chosen**: LINKED_API_*
**Rationale**: Developer confirmed; matched service pair from app.linkedapi.io, avoids confusion with the deleted `LINKEDIN_*` Playwright vars.

### D12 — Overlap guard in watch.yml
**Question**: Run duration may exceed the */10 interval (sequential cloud-browser searches + judge park budget). Add the one-line workflow setting so two watcher runs never overlap — a newly triggered run cancels the stale in-progress run?
**Recommended**: Add the guard
**Chosen**: Add the guard
**Rationale**: Developer confirmed after plain-words explanation; overlap means two runs double-hitting one LinkedIn account (limit risk) and duplicate digests (state commits only at run end).

## Open Questions
Two live-API behaviors could not be verified offline (the probe had no tokens); both are first-run checks with real tokens, not design blockers:
- Hashtag-term semantics: does `term: "#hiring react"` return the expected post set (hashtag and keyword combined)?
- Degrade-path error shapes: what catchable error shape does the SDK surface outside the account's working hours and on `limitExceeded` — confirm the warn-and-skip path can distinguish them (logs must name the cause).

## Suggested Follow-ups
- `jobs search` as a future surface type (LinkedIn Jobs listings with Easy Apply/location filters) — surfaced during D6, declined for scope: it would change what the watcher watches.
- Linked API "signals" (webhook on new post, coming soon per linkedapi.io/docs) could replace per-run polling later — observed on the docs page, not requested.
- A `scripts/probe-judge.ts`-style probe for the Linked API account (latency, working-hours behavior, limit ceiling) would feed evidence before cutover — pattern precedent: scripts/probe-judge.ts.
- The 2026-10-31 design doc for the Playwright dispatch remains as history: `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md`.

## References
- Input: linkedin-cli repo — https://github.com/Linked-API/linkedin-cli (README + src/commands/post/search.ts, src/commands/jobs/search.ts, src/core/workflow/workflow-runner.ts, package.json)
- Linked API docs & pricing — https://linkedapi.io/docs (core concepts: one account/one browser, working hours, limits), https://linkedapi.io (pricing, response shape)
- Probe evidence: src/config-file.ts:15-23,220-237; watcher.config.json:30-31,38; src/types.ts:8-25; src/state.ts:24-26; src/index.ts:172-254,469; src/fetch-threads.ts:122,157,309; .github/workflows/watch.yml:93-128
- Prior design: .rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md
- Guidance: .rpiv/guidance/src/architecture.md (funnel gates, WatcherDeps, env-resolver contracts)
