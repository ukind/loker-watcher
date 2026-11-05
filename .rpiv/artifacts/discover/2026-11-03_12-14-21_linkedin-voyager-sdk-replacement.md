---
date: 2026-11-03T12:14:21+0700
author: Yogiswara Utama
commit: 4c11e0f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn voyager fetcher replaces the Linked API SDK"
tags: [intent, frd, fetch-linkedin-api, voyager-graphql, judge-funnel, watch-yml]
status: ready
last_updated: 2026-11-03T12:14:21+0700
last_updated_by: Yogiswara Utama
---

# FRD: LinkedIn voyager fetcher replaces the Linked API SDK

## Summary
Replace the paid Linked API SDK fetcher with a direct, free client against the
LinkedIn Android voyager GraphQL search endpoint, fully specified by
`H:/fork/linkedin-reverse/DOCUMENTATION.md`. LinkedIn becomes a platform
fetcher with the same standing as Threads: cookie-authenticated, keyword
surfaces, posts flowing into the existing funnel. Each run sweeps up to 500
posts per LinkedIn keyword (past-24h pool, newest first) into the judge.

## Problem & Intent
The developer's words, verbatim: "the linkedin feature that baked inside this
app, is not free. i want it to replace it entirely based on that
documentation. so it will before like threads feature in term of purpose, but
for linkedin".

The Linked API SDK (`@linkedapi/node`) is a paid third-party service behind
the two `LINKED_API_*` tokens. The voyager endpoint needs only session
cookies the operator already controls, so the platform cost drops to zero and
the fetch volume can scale from 100 posts/surface single-shot to a paginated
500-per-keyword sweep.

## Goals
- Remove the paid SDK entirely: dependency, env names, workflow mapping, tests.
- LinkedIn behaves like Threads in purpose: a platform fetcher returning
  `Post[]` into the existing dedupe -> recency -> seen -> judge -> email funnel.
- Every run fetches up to 500 posts **per LinkedIn keyword** (best effort: the
  floor is capped by the keyword's past-24h pool size).
- Only genuinely new posts reach the LLM judge; already-seen posts are skipped
  by the seen-state gate.
- The run never fails because of LinkedIn: fetch faults warn and skip.

## Non-Goals
- No Playwright/browser automation for LinkedIn (explicitly excluded: "if the
  thread is fetch by scrolling using playwright, this new feature is not").
- No typeahead, companion finders, or posting/mutation calls — only the
  `SearchClusterCollection` post-search finder.
- No session persistence: cookies from a credential fallback login live in
  memory for the run only, never written to disk or state.
- No judge tuning (batch size, concurrency) beyond the workflow timeout bump.
- No change to the surface config shape or the Threads pipeline.

## Functional Requirements
1. The fetcher SHALL issue
   `GET https://www.linkedin.com/voyager/api/graphql` with
   `queryId=voyagerSearchDashClusters.c2c5d4b012c05a6a94396191208d45f6`,
   `queryName=SearchClusterCollection`, and restli-encoded `variables` per
   doc §4 (record `(k:v,...)` grammar; reserved chars ` ( ) : , '` escaped
   as uppercase `%HH`; spaces `%20`).
2. Requests SHALL carry headers: `csrf-token` (JSESSIONID value, quotes
   stripped), `x-restli-protocol-version: 2.0.0`,
   `x-li-graphql-pegasus-client: true`, `x-li-lang: en_US`,
   `accept: application/json`, and the `li_at`+`JSESSIONID` cookie pair.
3. Variables SHALL be
   `(query:(keywords:<surface value>,flagshipSearchIntent:SEARCH_SRP,queryParameters:(resultType:CONTENT,datePosted:past-24h,sortBy:date_posted)),origin:GLOBAL_SEARCH_HEADER,start:<N>,count:50)`.
4. The fetcher SHALL paginate with `start += 50` per keyword until 500 posts
   are collected or the response has empty `elements[]` (exhaustion — a
   normal, logged stop, never an error; doc §12.8). A ~5s pause separates
   consecutive voyager calls.
5. Response parsing SHALL walk
   `data.searchDashClustersByAll.elements[].items[].item.searchFeedUpdate`
   (doc §6): id from `backendUrn` (`urn:li:activity:<id>`), permalink from
   `socialContent.shareUrl`, text from the post text fields. Rows missing any
   required Post fact are dropped and counted, never thrown.
6. Parsed rows SHALL map to the existing `Post` shape with
   `platform: "linkedin"` (`src/types.ts:9-23`).
7. Auth resolution SHALL try, in order: (a) the `LINKEDIN_LI_AT` +
   `LINKEDIN_JSESSIONID` secret pair; (b) if missing or dead, a credential
   login — `GET /uas/authenticate` to obtain `JSESSIONID`, then the
   urlencoded `POST /uas/authenticate` with `session_key`/`session_password`,
   `csrf-token` and mobile UA headers (doc §2); a `401` with
   `challenge_url` (2FA/checkpoint) warns that headless login cannot proceed.
   Fresh cookies live in memory only.
8. With none of the four LinkedIn secrets resolvable, the caller SHALL warn
   naming all four and skip the linkedin surfaces; the run completes normally.
9. The fetcher module SHALL be total: it never rejects; per-surface faults
   warn (`fetch: <label> FAILED — <type>: <message>` style) and the loop
   continues (contract preserved from `src/fetch-linkedin-api.ts:10-14`).
10. The integration point in `src/index.ts` SHALL keep its shape: linkedin
    posts merge into the single fetch-stage return array.
11. The SDK SHALL be fully removed: `@linkedapi/node` from
    `package.json`, `ENV_NAMES.linkedApiToken`/`linkedApiIdentificationToken`
    from `src/config.ts`, `LINKED_API_*` mapping from
    `.github/workflows/watch.yml`, and SDK-shaped tests replaced by voyager
    fetcher tests (offline, injected fetch doubles).
12. `.github/workflows/watch.yml` SHALL raise `timeout-minutes` from 8 to 15.
13. New env names SHALL be registered in `ENV_NAMES`: `linkedinLiAt`,
    `linkedinJsessionId`, `linkedinEmail`, `linkedinPassword`.

## Non-Functional Requirements
- **Performance**: fetch stage ≈ 2 keywords × 10 pages × (call + 5s pause) ≈
  2 minutes worst case; whole run within the 15-minute cap. Judge load: up to
  ~100 bulk calls on a cold start (1,000 unseen posts), tens per steady-state run.
- **Security**: cookies and credentials exist only as GitHub Actions secrets,
  in run memory, and in nothing else — never logs, never
  `state/seen-posts.json`, never a committed file. No new runtime dependency
  (Node 22 built-in `fetch`).
- **UX / Accessibility**: digest and heartbeat behavior unchanged —
  `[linkedin]` item prefix and `"+ LinkedIn"` subject suffix preserved
  (`src/email.ts:54-77`).
- **Reliability**: failure signatures distinguished per doc §13.3 — 403
  `CSRF check failed.` (header bug), 401 `{"status":401}` (dead session →
  credential fallback), bare restli 400 (no member context → fallback),
  graphql-envelope 400 (bad variables → bug, warn), 500 (unknown queryId →
  warn; hash may need re-derivation). Edge throttling (connection resets while
  HTML still loads) → warn + skip that surface.

## Constraints & Assumptions
- `H:/fork/linkedin-reverse/DOCUMENTATION.md` is the endpoint source of truth
  (live-verified 2026-11-03 against APK 4.1.1267). QueryId hashes can expire
  server-side; if a 500 appears where 200 used to be, re-derive from a fresh
  APK (doc §15).
- Automated access violates the LinkedIn User Agreement; a throwaway account
  is recommended and the operator accepts the account risk (doc §15).
- Past-24h pools fluctuate (~481-492 observed for the test keyword): the
  500-per-keyword floor is best-effort, bounded by pool size.
- Repo gates stay strict: TS `strict`/`noUncheckedIndexedAccess`/
  `exactOptionalPropertyTypes`/`verbatimModuleSyntax`, Biome, offline
  `node:test` + `tsx` suite, atomic state writes, fail-visible config errors.
- Pacing, page size, and the 500 target are hard-coded module constants per
  repo doctrine (only probe-measured values are env-tunable).

## Acceptance Criteria
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` all exit 0.
- [ ] `grep -ri linkedapi` over the repo returns no hits (dep, env names,
      workflow mapping, and tests all gone).
- [ ] With `LINKEDIN_LI_AT` + `LINKEDIN_JSESSIONID` set, a local run fetches
      both linkedin surfaces and logs a per-surface collected count up to 500.
- [ ] With all four LinkedIn secrets unset, the run exits 0, warns naming
      `LINKEDIN_LI_AT`, `LINKEDIN_JSESSIONID`, `LINKEDIN_EMAIL`,
      `LINKEDIN_PASSWORD`, skips linkedin surfaces, and still delivers a
      threads-only digest or heartbeat.
- [ ] With a garbage `li_at` and credentials present, the run falls back to
      credential login and proceeds; with credentials also absent it warns and
      skips without failing.
- [ ] A keyword whose past-24h pool holds fewer than 500 posts stops at pool
      exhaustion with a logged count — no error status.
- [ ] The digest still renders `[linkedin]` items with the `"+ LinkedIn"`
      subject suffix, and the zero-match heartbeat still fires.

## Recommended Approach
Rewrite `src/fetch-linkedin-api.ts` in place as the voyager fetcher, keeping
its export shape (`fetchLinkedInPosts(surfaces, auth, injectable-seam?)`) so
`src/index.ts` wiring barely moves: cookie resolver replaces the token
resolver, credential login sits behind the same module, a fetch-function
injection seam replaces the SDK client seam for offline tests. Delete the SDK
dependency, env names, and workflow mapping; bump `watch.yml` timeout to 15.

## Decisions

### Keep linkedin surface config unchanged
**Question**: Pre-resolved from codebase evidence — the linkedin surface type
(`{type:"linkedin", value:"<keywords>"}`) stays unchanged; only the fetch
engine under it is replaced. Keep or change?
**Recommended**: Keep as-is.
**Chosen**: Keep as-is.
**Rationale**: evidence: src/config-file.ts:16-19 + watcher.config.json:24-25 +
confirmed.

### Auth: cookie secrets primary, credential login fallback
**Question**: Auth moves from the LINKED_API token pair to a cookie-based env
source following the THREADS_SESSION_STATE pattern — which variant?
**Recommended**: Single cookie env var.
**Chosen**: Cookies + credential fallback; four secrets
(`LINKEDIN_LI_AT`, `LINKEDIN_JSESSIONID`, `LINKEDIN_EMAIL`,
`LINKEDIN_PASSWORD`). Runs use pasted cookies; dead/missing cookies trigger
the password login; 2FA challenges dead-end with a warn.
**Rationale**: developer wants self-contained credential login as the
recovery path, but fewer actual logins per day for account safety (doc §15).

### Error policy: never-throw, warn and continue
**Question**: When the LinkedIn fetch cannot get posts (expired login, blocked
request) — what happens to the run?
**Recommended**: Warn and continue.
**Chosen**: Warn and continue (total module contract preserved).
**Rationale**: matches the repo's optional-credential doctrine;
evidence: src/fetch-linkedin-api.ts:10-14, src/index.ts:202 + confirmed.

### Full SDK removal now
**Question**: Pre-resolved from codebase evidence — the SDK goes away
entirely (dependency, env names, workflow mapping, SDK-shaped tests).
**Recommended**: Full removal.
**Chosen**: Full removal now, no parallel module.
**Rationale**: intent says "replace it entirely"; dead code contradicts repo
doctrine. evidence: package.json:21, src/config.ts:16-17 + confirmed.

### Sweep semantics for the 500 target
**Question**: "For every run, judge minimum 500 LinkedIn posts" — which
reading?
**Recommended**: Sweep 500/run.
**Chosen**: Sweep 500/run — fetch pours ≥500 into the funnel; the seen-state
gate (src/index.ts:257) ensures only new posts are judged.
**Rationale**: avoids re-judging known posts (~50 wasted LLM calls per run).

### 500 per keyword, not total
**Question**: How should the 500 split across LinkedIn keywords?
**Recommended**: 500 total.
**Chosen**: 500 **per keyword** — today's 2 keywords mean up to 1,000 posts
fetched per run.
**Rationale**: developer wants a bigger judged pool per topic; fetch is free
so volume is cheap.

### Search window: past-24h strict, newest first
**Question**: Voyager pools measured: past-24h ≈ 481, past-week ≈ 489, no
filter ≈ 446+ unstable. With a hard 500/keyword target, which window?
**Recommended**: All-time, newest-first.
**Chosen**: Past-24h strict (`datePosted:past-24h` +
`sortBy:date_posted`, doc §12.7 — the finder ignores `orderBy`).
**Rationale**: freshest possible pool; the 500 floor becomes best-effort
when a keyword's pool is smaller — accepted consequence.

### Run-length: raise the workflow cap to 15 minutes
**Question**: The judge envelope budgets ~320-360s inside the 8-minute cap;
a cold-start sweep means up to ~100 LLM calls. How to handle the limit?
**Recommended**: Raise cap to 15 min.
**Chosen**: Raise `watch.yml` `timeout-minutes` 8 → 15; no judge tuning.
**Rationale**: one-line change absorbs cold-start spikes and slow endpoint
days; judge constants stay probe-governed.

### Secret storage: four separate env vars
**Question**: How should cookies and login credentials live as secrets?
**Recommended**: Single JSON cookie var + credential pair.
**Chosen**: Two cookie vars (`LINKEDIN_LI_AT`, `LINKEDIN_JSESSIONID`) plus
`LINKEDIN_EMAIL` + `LINKEDIN_PASSWORD` — four secrets, each validated
separately.
**Rationale**: developer's pick; mirrors one-env-per-value clarity.

### Pacing: 5 seconds between voyager calls
**Question**: How fast should the fetcher page through voyager results?
**Recommended**: ~750ms pause.
**Chosen**: 5 seconds pause, surfaces walked sequentially (FR4 doctrine
preserved).
**Rationale**: developer's pick — maximum throttle safety (doc §13.3 observed
throttling after ~40 rapid calls); cost ≈ 100s per run, well inside the 15-min cap.

### Page size: 50 per request
**Question**: How many posts per voyager request?
**Recommended**: 50.
**Chosen**: 50 — doc-verified maximum without server clamping (§12.1);
500/keyword = 10 pages.
**Rationale**: evidence: DOCUMENTATION.md §12.1 + confirmed.

## Open Questions
None — every branch resolved to a Decision or an explicit accepted consequence
(best-effort 500 floor under past-24h strict).

## Suggested Follow-ups
- `.env:1-6` holds stale `LINKEDIN_EMAIL`/`LINKEDIN_PASSWORD`/`LINKEDIN_SESSION_STATE`
  from the deleted Playwright era — reconcile names or delete with the SDK cutover.
- `src/threads-session.ts:13-15` doc comment ("LinkedIn rides the Linked API
  SDK tokens… resolves no session at all") becomes wrong — update it.
- `src/judge.ts:101-108` job-cap envelope comment says "the fetch term is
  PENDING MEASUREMENT" — retune after the first real voyager run at 500/keyword.
- `.rpiv/guidance/src/architecture.md:38,65` and
  `.rpiv/guidance/.github/workflows/architecture.md:50-51` still describe the
  SDK module and `LINKED_API_*` mapping — update during implement.
- `README.md:18-19,67-68,100,253-257` documents the token pair and setup —
  rewrite for the cookie/credential secrets.
- `.gitignore:8` `linkedin-state*.b64` rule is Playwright-era residue —
  removable.

## References
- `H:/fork/linkedin-reverse/DOCUMENTATION.md` — voyager endpoint spec (source of truth)
- `.rpiv/artifacts/discover/2026-10-31_07-45-40_linkedin-second-surface.md` — prior FRD that introduced the linkedin surface
- Probe evidence: `src/fetch-linkedin-api.ts`, `src/index.ts:166-225`, `src/threads-session.ts`, `src/judge.ts:57-109`, `.github/workflows/watch.yml:59-105`, `tests/fetch-linkedin-api.test.ts`
