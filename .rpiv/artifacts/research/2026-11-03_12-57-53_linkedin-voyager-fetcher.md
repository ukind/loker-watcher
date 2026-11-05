---
date: 2026-11-03T12:57:53+0700
author: Yogiswara Utama
commit: 4c11e0f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn voyager fetcher replaces the Linked API SDK"
tags: [research, codebase, fetch-linkedin-api, voyager-graphql, linkedin-auth, watch-yml, judge-envelope]
status: ready
last_updated: 2026-11-03T14:22:30+0700
last_updated_note: "Added follow-up research: live capture pins the response paths; production transport risk recorded"
last_updated_by: Yogiswara Utama
---

# Research: LinkedIn voyager fetcher replaces the Linked API SDK

## Research Question
How is the in-place rewrite of `src/fetch-linkedin-api.ts` from the paid Linked API SDK to a direct
voyager GraphQL client wired into the existing funnel — and what does the endpoint spec
(`H:/fork/linkedin-reverse/DOCUMENTATION.md`) actually require beyond the FRD's paraphrase?
Scope: the fetcher module, its seams, the removal inventory, the timeout envelope, and the
offline-test strategy.

## Summary
The rewrite keeps every structural contract that makes LinkedIn safe to run: the module stays
total (never rejects, per-surface faults warn and skip — `src/fetch-linkedin-api.ts:10-14`), the
caller owns the skip warn (`src/index.ts:201-202`), and `fetchLinkedInPosts(surfaces, auth, seam?)`
keeps its export shape with a `fetchFn: typeof fetch` seam replacing the SDK client seam. The
endpoint itself needs three corrections to the FRD's paraphrase (URL-layer encoding of `#`,
endpoint-specific dead-session signatures, cookie/csrf quote asymmetry) and one live capture: the
member-post text/author/timestamp paths inside `searchFeedUpdate` are pinned nowhere — not in the
doc's §6 walk, not in `FINDINGS.md:113-119`, not in the Postman collection (0 saved examples).
The developer ruled: the endpoint is tested live first; the capture becomes a trimmed fixture
under `tests/fixture/` before parser code. Removal is a fixed quad (module + suite +
`ENV_NAMES` + `watch.yml` env block) plus doc-comment residue in six files. Seen-state id
continuity (`urn:li:activity:<id>` on both sides) means no post is ever re-judged across the
cutover.

## Detailed Findings

### 1. Fetcher module shape — rewrite in place
- Current module is 261 lines: constants at `src/fetch-linkedin-api.ts:33-35` (SEARCH_LIMIT 100,
  SEARCH_SORT latest, SEARCH_DATE_POSTED past24Hours — all die), the `LinkedApiClientLike`
  structural seam at `:61`, `resolveLinkedApiTokens` at `:86`, `createLinkedApiClient` at
  `:107` (the ONLY `@linkedapi/node` import site, dynamic + NAMED — the default export is the
  CJS namespace object and is not constructable under NodeNext + verbatimModuleSyntax),
  `mapLinkedInSearchResult` at `:130`, `fetchLinkedInPosts` at `:145`.
- Totality contract at `:10-14` is the load-bearing rule: a failed client build or failed surface
  warns and returns, an empty result is success, the function never rejects. The voyager rewrite
  preserves it verbatim — the log shape `fetch: <label> FAILED — <type>: <message>` and the
  drop-count warn (`dropped N malformed result(s)`) are operator-visible contracts.
- The new seam mirrors the judge's idiom (`src/judge.ts`: injectable `fetchFn: typeof fetch` as a
  trailing param): the fetcher drives raw `fetch` over `fetchFn`, offline tests inject Response
  doubles. New hard-coded constants per repo doctrine (only probe-measured values are
  env-tunable): PAGE_SIZE 50, TARGET 500 per keyword, PAUSE_MS 5000, sequential surfaces.
- The old SDK semantics vanish with their code: the parked-workflow guard (pendingReason → never
  await result()), the action-error loop, and the working-hours message have no voyager
  counterpart.

### 2. Auth resolution — cookies primary, UAS credential fallback
- Resolver follows the `resolveSession` silent-null model (`src/threads-session.ts:35`): returns
  null when either cookie var is unset or blank, no warn; the caller decides policy. Four new
  names join `ENV_NAMES` (`src/config.ts:14`): `LINKEDIN_LI_AT`, `LINKEDIN_JSESSIONID`,
  `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`; the two `LINKED_API_*` names at `src/config.ts:16-17`
  die.
- Credential login per DOCUMENTATION.md §2: GET `/uas/authenticate` with no cookies (server sets
  JSESSIONID), then a urlencoded POST with `session_key`/`session_password`, the `csrf-token`
  header, and the mobile UA headers (`x-li-user-agent: LIAuthLibrary:0.0.3 ...`, `x-li-track`).
  200 sets `li_at`; 401 with `challenge_url` means 2FA/checkpoint — warn that headless login
  cannot proceed and skip the surfaces. Cookies live in run memory only (FRD non-goal: no
  persistence).
- CORRECTION (endpoint-specific dead-session signature): the FRD maps
  `401 {"status":401}` → dead session → fallback. That 401 is the `/voyager/api/me` signature;
  the search finder returns a BARE `400 {"status":400}` on dead/garbage `li_at` — byte-shape
  identical to a restli parse failure (DOCUMENTATION.md §13.1 table, §13.3 recipe). A client that
  never calls `/me` can never see the 401. The design must either key the fallback on the search
  response's body shape (bare `{"status":400}` vs graphql envelope
  `{"data":{"status":400},"included":[]}` — the envelope means bad variables, a bug; bare means
  no member context, retry after login) or add the verified cheap `/me` preflight (§2.4:
  200 = live session).

### 3. Request construction — restli grammar plus URL-layer encoding
- GET `https://www.linkedin.com/voyager/api/graphql` with
  `queryId=voyagerSearchDashClusters.c2c5d4b012c05a6a94396191208d45f6` and
  `queryName=SearchClusterCollection` (DOCUMENTATION.md §3; the second registered hash
  `75dbd5da...` is an entity-cluster variant useless for posts — §12.6).
- Restli grammar (§4.1): records/maps are `(k:v,...)`; strings are bare text; the reserved set
  `( ) : , '` escapes as uppercase %HH inside string values. Plain JSON always 400s.
- CORRECTION (the `#` bug-in-waiting): restli does not reserve `#`, and both configured surfaces
  start with `#` (`watcher.config.json:30-31`). A raw `#` in a GET URL starts the fragment and
  truncates the query at `keywords:`. The doc's own transport template percent-encodes the whole
  variables value (`--data-urlencode`, §10), and §12.5 verifies `&` needs URL-layer `%26`. So:
  restli-escape first, then URL-encode the result (`#`→%23, `&`→%26, spaces %20) while keeping
  parens/colons/commas raw (§4.1 verified practice). FRD FR1's escaping rule is incomplete
  without this.
- Header set (§3 + §7 gotcha 2 + CORRECTION on quotes): `csrf-token` (JSESSIONID value, quotes
  STRIPPED), `x-restli-protocol-version: 2.0.0`, `x-li-graphql-pegasus-client: true`,
  `x-li-lang: en_US`, `accept: application/json` (the normalized+json accept 500s), a
  user-agent, and the cookie pair — where the `Cookie` header keeps `JSESSIONID="ajax:..."`
  WITH quotes (§10 curl) while csrf-token strips them. One stored value, two opposite transforms.
  FRD FR2 names only the strip.

### 4. Pagination and pacing
- count 50 is verified without server clamping (§12.1); offset pagination via `start += count`
  verified disjoint; the paging object echoes {count,start,total} with no continuation token.
- Exhaustion (§12.8) is ALWAYS HTTP 200: terminal signal is `elements: []`; the app's own rule is
  to stop once a page returns fewer posts than requested — a refinement over FRD FR4's
  empty-elements stop that saves one 5s-paused round-trip per keyword. Far past total,
  `metadata.totalResultCount` nulls and `total` drops from the paging echo — a parser must never
  gate pagination on the total (it fluctuates 481-492 call-to-call anyway, §12.1/§12.2).
- Cost arithmetic: 2 keywords × 10 pages × (call + 5s) ≈ 100-120s sequential, inside the 15-min
  cap with the judge envelope intact.

### 5. Response parsing → Post mapping — the live-capture gap
- Walk (DOCUMENTATION.md §6; `FINDINGS.md:113-119`):
  `data.searchDashClustersByAll.elements[].items[].item.searchFeedUpdate.update` — id from
  `metadata.backendUrn` (`urn:li:activity:<id>`), permalink from `socialContent.shareUrl`
  (strip `?query`). The documented text fields are job-card only:
  `content.entityComponent.title/subtitle/ctaButton.text`.
- THE GAP: the member-post text path, the author path, and the post timestamp path are pinned
  nowhere — the doc's §6 walk stops at job-card fields, FINDINGS.md repeats it, and the Postman
  collection carries zero saved `searchFeedUpdate` examples (grep count: 0). The FRD's "text from
  the post text fields" is unpinned for the main payload the judge reads.
- Resolution (developer checkpoint, this session): the endpoint is tested live FIRST. One live
  capture trims into `tests/fixture/` (the extract.ts fixture precedent) and pins the exact
  paths before parser code. Cookies were unavailable in the research session (`.env` reads are
  blocked by the safety net), so the capture is the first implementation prerequisite. The same
  capture settles whether job-card rows should map at all (a "View job" card is a genuine job
  post) and whether the activity id can derive the timestamp (ids are near-monotonic but reposts
  break strictness, §12.4 — a response timestamp field is preferred if present).
- Mapping rules carried from the SDK mapper (`src/fetch-linkedin-api.ts:130-143`): required-fact
  drop + count, guarded timestamp conversion BEFORE `toISOString`, per-surface Map dedupe by id.
- Seen-state continuity: SDK-era ids are `urn:li:activity:<id>`; voyager `backendUrn` mints the
  same form. Post ids already in `state/seen-posts.json` match — the cutover never re-judges an
  old post. `platform: "linkedin"` stays the only touched literal in `src/types.ts:15`
  (interface at `:10-23`).

### 6. index.ts wiring and seams
- Import block ends `src/index.ts:36`; the `WatcherDeps.linkedinFetch` seam sits at
  `:115-118` (signature `(surfaces, tokens) => Promise<Post[]>` — retypes to an auth record),
  the production default at `:156`. Test doubles exercise it at `tests/index.test.ts:506`,
  `:592`, `:635`, `:667`, with the types import at `:19`.
- The linkedin arm (`src/index.ts:195-216`): partition keeps raw linkedin surfaces out of
  `resolveSurfaces` (a linkedin surface reaching the resolver is a wiring-bug throw —
  `src/config-file.ts:229`), the resolver is called at `:196`, the caller-owned warn at
  `:201-202` (rewrites from naming both tokens to naming all four LinkedIn vars), the call at
  `:206`, and the D12 belt catch at `:208-215` stays: the module is total, the catch is for
  throwing injected stubs only.
- Gate 1 (zero unseen) sits at `src/index.ts:259` — the FRD cited `:257`; two lines drifted on
  this branch. The single-array fetch-stage return ([...threads, ...linkedin]) is unchanged, so
  dedupe → recency → seen → judge → notify never learns the fetch engine changed.
- Untouched by design: the surface union arm `src/config-file.ts:19`, the surfaces in
  `watcher.config.json:30-31`, the digest marker `src/email.ts:75` and subject suffix
  `src/email.ts:60` (email never knew how posts were fetched).

### 7. Removal inventory (the grep -ri linkedapi acceptance criterion)
- Dependency: `package.json:21` (`@linkedapi/node` ^2.3.20; npm uninstall also updates
  package-lock.json).
- Env names: `src/config.ts:16-17` die; four `LINKEDIN_*` names replace them.
- Workflow: `watch.yml:104-105` env mapping dies; four `LINKEDIN_*` secret mappings replace
  (step-scoped, 1:1 names, per the workflow guidance). Timeout at `watch.yml:65` goes 8 → 15.
- Comment residue inside watch.yml: the concurrency block (`:33-40`) justifies
  cancel-in-progress by "a parked Linked API workflow can hold the whole 8-minute cap" — premise
  dies with the SDK; cancel stays (still serializes state). The F023 envelope comment
  (`:59-64`) carries the PENDING MEASUREMENT fetch term.
- Stale doc comments: `src/threads-session.ts:13-15` ("LinkedIn rides the Linked API SDK tokens…
  resolves no session at all" — now false in both halves), `src/config-file.ts:14` and the
  resolver guard comment at `:222-223` ("the SDK fetcher consumes their raw value").
- README.md: pipeline item 2 (`:16-20`), env table rows (`:67-68`), surfaces key row (`:100`),
  and the whole "LinkedIn tokens (Linked API)" section (`:241-262`) rewrite for cookie/credential
  secrets.
- Guidance: `.rpiv/guidance/src/architecture.md:65` (the SDK module section) and
  `.rpiv/guidance/.github/workflows/architecture.md:7`, `:50-51` (the token pair).
- Tests: `tests/fetch-linkedin-api.test.ts` (345 lines, SDK-shaped: workflow doubles, park
  guards) is replaced by a voyager suite — injected `fetchFn` Response doubles, restli-encoder
  unit tests (the §12.5 escaping table is a ready-made fixture matrix), exhaustion-as-success
  (`elements: []`), drop-count, and the bare-400/envelope-400 auth fork.
- `.gitignore:8` (`linkedin-state*.b64`) is Playwright-era residue. `.env:1-6` reportedly holds
  stale `LINKEDIN_*` names from the deleted Playwright era (FRD claim — unverifiable this
  session; `.env` reads are blocked by the safety net).

### 8. Timeout envelope and judge arithmetic
- `watch.yml:65` `timeout-minutes: 8` → 15 (the probe job's `:31` stays 10). The F023 arithmetic
  comment (`src/judge.ts:102-108`, mirrored at `watch.yml:59-64`) sizes WAIT_BUDGET_MS from the
  480s cap; `src/judge.ts:109` holds 180_000. The bump to 900s re-derives the envelope, and the
  declared "first live dispatch's `timing: fetch <N>ms` line pastes into this comment" procedure
  resolves the PENDING MEASUREMENT fetch term on the first real voyager run. No judge tuning
  (FRD decision): batch size, concurrency, and budgets stay probe-governed.

## Code References
- `src/fetch-linkedin-api.ts:10-14` — total-by-contract degrade contract (preserve verbatim)
- `src/fetch-linkedin-api.ts:33-35` — SEARCH_LIMIT/SEARCH_SORT/SEARCH_DATE_POSTED (die)
- `src/fetch-linkedin-api.ts:61-83` — LinkedApiClientLike seam (dies; replaced by fetchFn)
- `src/fetch-linkedin-api.ts:86-104` — resolveLinkedApiTokens, silent-null model (template for
  the cookie resolver)
- `src/fetch-linkedin-api.ts:107-125` — createLinkedApiClient, the only @linkedapi/node import
- `src/fetch-linkedin-api.ts:130-143` — mapLinkedInSearchResult, required-fact drop+count
- `src/fetch-linkedin-api.ts:145-229` — fetchLinkedInPosts, total sequential loop (rewritten in
  place)
- `src/index.ts:36` — import block; `:115-118` — WatcherDeps.linkedinFetch seam; `:156` —
  production default
- `src/index.ts:195-216` — linkedin arm: `:196` resolver, `:201-202` caller warn, `:206` call,
  `:208-215` belt catch
- `src/index.ts:259` — Gate 1 (zero unseen; FRD cited :257 — drifted)
- `src/config.ts:14-23` — ENV_NAMES; `:16-17` — the two LINKED_API names (die)
- `src/email.ts:60` — "+ LinkedIn" subject suffix; `:75` — "[linkedin] " digest marker
- `src/judge.ts:102-108` — F023 envelope comment (PENDING MEASUREMENT); `:109` — WAIT_BUDGET_MS
- `src/types.ts:10-23` — Post contract; `:15` — platform literal
- `src/config-file.ts:19` — linkedin surface union arm; `:222-233` — resolveSurfaces guard +
  stale comment
- `src/threads-session.ts:13-15` — stale SDK doc comment; `:35` — resolveSession silent-null
  model
- `.github/workflows/watch.yml:33-40` — concurrency cancel comment (premise dies); `:59-64` —
  timeout envelope comment; `:65` — timeout-minutes: 8; `:104-105` — LINKED_API_* mapping
- `package.json:21` — @linkedapi/node dependency
- `watcher.config.json:30-31` — the two linkedin surfaces (leading `#`)
- `tests/fetch-linkedin-api.test.ts:1-345` — SDK-shaped suite (replaced)
- `tests/index.test.ts:19` — types import; `:506`,`:592`,`:635`,`:667` — linkedinFetch doubles
- `.gitignore:8` — linkedin-state*.b64 residue
- `README.md:16-20`,`:67-68`,`:100`,`:241-262` — SDK-era docs (rewrite)
- `H:/fork/linkedin-reverse/DOCUMENTATION.md` — endpoint source of truth (§2 auth, §3 request,
  §4 restli grammar, §5 variables, §6 response walk, §12.1/12.5/12.7/12.8 verified matrix,
  §13 failure matrix, §15 risk)
- `H:/fork/linkedin-reverse/FINDINGS.md:113-119` — condensed response walk (same gap)

## Integration Points

### Inbound References
- `src/index.ts:36`,`:156`,`:195-216` — the only production consumer: partition, resolve, warn,
  call, belt-catch, single-array merge
- `tests/index.test.ts:19`,`:506-667` — seam doubles drive the fetcher offline
- `tests/fetch-linkedin-api.test.ts:15` — module suite imports four exports
- `.github/workflows/watch.yml:104-105` — secret mapping into the Run watcher step
- `src/threads-session.ts:14`, `src/config-file.ts:223` — doc-comment references (update)

### Outbound Dependencies
- `package.json:21` — @linkedapi/node (dies with the cutover)
- `src/config.ts:16-17` — ENV_NAMES entries (two die, four arrive)
- `src/types.ts:10-23` — Post shape (unchanged; id namespace stays urn:li:activity:<id>)
- `H:/fork/linkedin-reverse/DOCUMENTATION.md` — external endpoint spec, live-verified 2026-11-03
  against APK 4.1.1267

### Infrastructure Wiring
- `.github/workflows/watch.yml:65` — timeout 8 → 15; `:104-105` → four LINKEDIN_* mappings
- `.github/workflows/watch.yml:33-40` — cancel-in-progress stays; comment rationale updates
- State commit-back (scripts/commit-state-rebase.sh, Commit state step) untouched — the fetch
  engine never touches persistence

## Architecture Insights
- The totality contract is the platform-isolation boundary: a LinkedIn fault can never fail a
  run, and every degradation lands in one log line. Preserve it verbatim; port its tests, not
  just its code.
- Silent resolver + caller-owned warn: a single-exit resolver cannot say which variable is
  absent, so the one warn names all four (the pattern generalizes from the token pair at
  `src/index.ts:201-202`).
- Every I/O boundary is an optional trailing param with a production default (WatcherDeps and
  the judge's fetchFn idiom). The voyager fetcher's seam is `fetchFn: typeof fetch` — no new
  seam shape to learn.
- Hard-coded module constants per repo doctrine: page size, target, pause are code, not config;
  only probe-measured judge values are env-tunable.
- Empty-result-is-success is a fixed regression (commit `defb8af`) — voyager exhaustion
  (`elements: []`) needs its own offline success test on day one.
- The dual-400 body-shape fork (bare restli vs graphql envelope) is the auth-detection crux on
  the search endpoint; 401 belongs to `/me` only.

## Precedents & Lessons
4 similar past changes analyzed.

### Precedent: SDK post-search fetcher added
**Commit(s)**: `6efe6da` — "feat: add linked api sdk post-search fetcher with fail-safe park guard" (2026-11-03)
**Blast radius**: 3 files across 2 layers — src/config.ts (env names), src/fetch-linkedin-api.ts
(+261), tests/fetch-linkedin-api.test.ts (+345)
**Takeaway**: a fetcher cutover lands as module + suite + config env names in one commit; keep
that shape for the voyager rewrite.

### Precedent: credential-login fallback added (Playwright era)
**Commit(s)**: `f571904` — "feat: linkedin credential-login fallback with workflow secret refresh" (2026-11-01)
**Blast radius**: 11 files, +1442/-63 — src/linkedin-login.ts (+315), scripts/linkedin-login.ts,
watch.yml secret-refresh step, ~750 lines of tests
**Takeaway**: a linkedin credential-login path already existed once and it was heavy.

### Precedent: credential-login fallback deleted
**Commit(s)**: `bf6594c` — "refactor: rewire threads fetcher seams and delete the linkedin-login fallback" (2026-11-03)
**Blast radius**: 13 files, +239/-2421 — deleted src/linkedin-login.ts, src/fetch-linkedin.ts
(346), scripts/linkedin-login.ts, three test files
**Follow-up fixes**: the deletion left residue that survives today (`.gitignore:8`, stale
`LINKEDIN_*` .env keys, threads-session.ts comment)
**Takeaway**: the UAS login must stay a fraction of the deleted machinery (raw fetch, two calls,
no persistence, no workflow refresh step); grep for the deleted era's names when removing.

### Precedent: empty-window regression
**Commit(s)**: `defb8af` — "fix: treat an empty linkedin search window as zero results" (2026-11-01)
**Blast radius**: 2 files, +32 — src/fetch-linkedin.ts guard + test
**Takeaway**: empty-at-fetch-level was once an error path; the voyager exhaustion rule needs the
success-shaped test from day one.

### Composite Lessons
- Fetcher swaps touch a fixed quad — module, its test file, ENV_NAMES, watch.yml env block
  (`6efe6da`, `250a4e1`) — while prose docs (README, guidance, module comments) drift silently;
  this FRD already carries the drift list, so fold doc updates into the same change.
- Degradation contracts regress when a new fetcher re-shapes what the old one guarded
  (`defb8af`) — port the guard tests, not just the guard.
- Credential-login machinery has a full lifecycle precedent: added heavy (`f571904`), deleted
  heavier (`bf6594c`). Minimal-by-construction is the lesson, not just the rule.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-11-03_12-14-21_linkedin-voyager-sdk-replacement.md` — the FRD
  chaining into this research
- `.rpiv/artifacts/discover/2026-10-31_07-45-40_linkedin-second-surface.md` — FRD that introduced
  the linkedin surface
- `.rpiv/artifacts/research/2026-11-01_19-34-17_linkedin-post-search-surface.md` — research
  behind the CLI post-search surface
- `.rpiv/artifacts/research/2026-11-01_09-29-22_linkedin-watch-off-my-pc.md` — research on moving
  linkedin runs off the local PC
- `.rpiv/artifacts/designs/2026-11-01_21-35-44_linkedin-sdk-post-search-cutover.md` — design of
  the SDK cutover now being replaced
- `.rpiv/artifacts/plans/2026-11-02_13-52-20_linkedin-sdk-post-search-cutover.md` — plan of that
  cutover
- `.rpiv/artifacts/solutions/2026-11-01_20-34-14_linkedin-api-fetcher-integration-shape.md` —
  integration-shape decision for the SDK fetcher
- `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md` —
  second-surface dispatch design

## Developer Context
**Q (discover: Keep linkedin surface config unchanged):** Does the linkedin surface type stay
unchanged while only the fetch engine under it is replaced?
A: Keep as-is. Evidence: `src/config-file.ts:19`, `watcher.config.json:30-31` (FRD cited :16-19
and :24-25 — lines drifted, substance confirmed).

**Q (discover: Auth: cookie secrets primary, credential login fallback):** Which auth variant
replaces the LINKED_API token pair?
A: Cookies + credential fallback; four secrets (`LINKEDIN_LI_AT`, `LINKEDIN_JSESSIONID`,
`LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`). Runs use pasted cookies; dead/missing cookies trigger
the password login; 2FA challenges dead-end with a warn.

**Q (discover: Error policy: never-throw, warn and continue):** What happens to the run when the
LinkedIn fetch cannot get posts?
A: Warn and continue — the total module contract is preserved.

**Q (discover: Full SDK removal now):** Does the SDK go away entirely?
A: Full removal now, no parallel module. Evidence: `package.json:21`, `src/config.ts:16-17`.

**Q (discover: Sweep semantics for the 500 target):** Which reading of "judge minimum 500
LinkedIn posts"?
A: Sweep 500/run — fetch pours ≥500 into the funnel; the seen-state gate (`src/index.ts:259`)
ensures only new posts are judged.

**Q (discover: 500 per keyword, not total):** How does the 500 split across keywords?
A: 500 per keyword — today's 2 keywords mean up to 1,000 posts fetched per run.

**Q (discover: Search window: past-24h strict, newest first):** Which search window with a
hard 500/keyword target?
A: Past-24h strict (`datePosted:past-24h` + `sortBy:date_posted`; the finder ignores `orderBy`
— DOCUMENTATION.md §12.4/§12.7). The 500 floor is best-effort when a keyword's pool is smaller.

**Q (discover: Run-length: raise the workflow cap to 15 minutes):** How does the run survive a
cold-start judge load?
A: Raise `watch.yml` timeout-minutes 8 → 15 (`:65`); no judge tuning.

**Q (discover: Secret storage: four separate env vars):** How do cookies and credentials live as
secrets?
A: Four separate secrets, each validated separately.

**Q (discover: Pacing: 5 seconds between voyager calls):** How fast does the fetcher page?
A: 5-second pause, surfaces walked sequentially (FR4 doctrine preserved).

**Q (discover: Page size: 50 per request):** How many posts per voyager request?
A: 50 — doc-verified maximum without server clamping (§12.1); 500/keyword = 10 pages.

**Q (`H:/fork/linkedin-reverse/DOCUMENTATION.md` §6): The member-post text/author/timestamp
paths inside `searchFeedUpdate` are pinned nowhere (FINDINGS.md:113-119 shows job-card fields
only; 0 saved examples in the Postman collection). Pin how?**
A: Test the endpoint live first. The capture trims into `tests/fixture/` and pins exact paths
before parser code. Cookies were absent in the research session (`.env` reads blocked by the
safety net), so the live capture is the first implementation prerequisite.

## Related Research
- `.rpiv/artifacts/research/2026-11-01_19-34-17_linkedin-post-search-surface.md` — the prior
  linkedin post-search research
- `.rpiv/artifacts/research/2026-11-01_09-29-22_linkedin-watch-off-my-pc.md` — prior linkedin
  runtime research

## Open Questions
None carried from the FRD ("None" there). The one new gap — member-post field paths — is
resolved by procedure, not answer: live capture first, recorded as the first implementation
prerequisite (Developer Context, last entry). The same capture should pin whether job-card rows
map and whether timestamps come from a response field or derive from the activity id.

## Follow-up Research 2026-11-03T14:22:30+0700

Live capture session (curl probes + bladebro-driven browser context). Outcome: the response-gap is closed; one production-transport risk is now on record.

### Member-post field paths — RESOLVED (live capture: HTTP 200, 59,763 bytes)
Capture file: `.rpiv/tmp/voyager-capture.json` (untracked scratch). Query: keywords "#hiring react", `datePosted:past-24h`, `sortBy:date_posted`, start 0, count 5 — `totalResultCount: 243`.
- id: `metadata.backendUrn` (`urn:li:activity:<id>`) — present on all 5 posts
- text: `commentary.text.text` — present on all 5 posts regardless of content shape (`content` was `articleComponent`, `documentComponent`, or absent — the parser never needs `content`)
- author: `actor.name.text` — all 5; `actor.backendUrn` distinguishes `urn:li:member:` from `urn:li:company:`
- permalink: `socialContent.shareUrl` — strip `?query` (utm_*/rcm tracking params ride every URL)
- timestamp: NOT in the payload — derive `BigInt(id) >> 22n` → epoch ms. Verified live: 4-6 min drift vs the posts' own "1m/2m/3m" labels; the repo already uses the inverse trick at `tests/index.test.ts:92-93`; the §12.4 repost-id caveat stands (provenance comment mandatory)
- non-post clusters (`simpleTextV2` header, `feedbackCard`) ignored — matches §12.8's cluster anatomy
- pool note: "#hiring react" past-24h totals 243 — below the doc's 481-492 for "hiring react"; the `#` narrows; the 500/keyword floor is pool-bound

### Wire format — CONFIRMED empirically
Raw structural parens/colons/commas + `%20` spaces + URL-layer `%23`/`%26` only; restli `%HH` escapes belong to string values. A browser-context fetch with exactly this shape returned 200. The doc's §10 `--data-urlencode` curl template is NOT the app's wire format: the one fully-encoded request that passed Cloudflare reached the API and failed restli parsing (bare `{"status":400}`), because the server does not RFC-decode `variables` before restli parsing. FRD Correction 1 stands, strengthened.

### Session/transport findings (empirical)
- 2FA dead-end confirmed live: UAS login returned 401 + `challenge_url` + `login_result` — the documented headless terminal (§2.3). The credential fallback cannot recover a challenge-bound account.
- `/voyager/api/me` validated as the session preflight: 200 with a live pair; quotes-in-Cookie + stripped-csrf asymmetric handling (Correction 3) confirmed working.
- Anti-bot logout observed: after ~6 curl-authenticated calls, responses became Cloudflare 302 challenge loops (Location = the identical URL), then `Set-Cookie: li_at=` (empty) — the server-side logout signal (§14.3). Reputation-decay, not URL shape: the FIRST fully-encoded curl passed CF, everything after it 302'd.
- The browser-context fetch (same-origin, browser cookies + CF clearance) returned 200 throughout — the session held by the browser stayed valid the whole time.
- JSESSIONID is HttpOnly in the browser context (`document.cookie` cannot source the csrf header; capture tooling read the cookie store). Production is unaffected: csrf comes from the `LINKEDIN_JSESSIONID` secret.

### OPEN — production transport risk (design-stage input, potentially a blocker)
Every 200 came from a real browser: TLS fingerprint, cookie jar, CF clearance. A GitHub Actions runner is a datacenter IP with a Node TLS fingerprint — the CF challenge layer that 302-looped curl may challenge it too. The FRD's direct-fetch design may be unviable from runners. Design stage must evaluate, in order: fresh cookie pair per run + the exact browser-like header set + mobile UA + 5s pacing (FRD decisions already cover these); a runner-vs-CF probe as slice 0 of implement; and if CF challenges persist from runner IPs, the degrade contract (warn + skip, run exits 0) keeps runs green while LinkedIn silently yields nothing — a design pivot (residential proxy, headless browser in the runner, or SDK retention) would then be forced.
