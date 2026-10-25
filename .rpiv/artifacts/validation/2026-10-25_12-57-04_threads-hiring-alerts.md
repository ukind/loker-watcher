---
template_version: 1
date: 2026-10-25T12:57:04+0700
author: Yogiswara Utama
commit: 1a9e353a6f986862952795c9a35e18f967c212ea
branch: main
repository: loker-watcher
topic: "Validation of Threads #hiring Indonesia job alerts — full v1 pipeline"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md"
tags: [validation, plan, threads, playwright, scraper, github-actions, email]
last_updated: 2026-10-25T12:57:04+0700
---

## Validation Report: Threads #hiring Indonesia job alerts — full v1 pipeline

### Implementation Status

- ✓ Phase 1: Scaffold + contracts — Fully implemented
- ✓ Phase 2: Extraction — Fully implemented
- ✓ Phase 3: Fetch (Playwright) — Fully implemented
- ✓ Phase 4: Filters (keywords + LLM judge) — Fully implemented
- ✓ Phase 5: State — Fully implemented
- ✓ Phase 6: Email digest — Fully implemented
- ✓ Phase 7: CLI + workflow + README — Fully implemented
- ✗ Phase 8: Authenticated fetch + recency — Implemented as written, but the authenticated fetch extracts **0 posts** on every surface and then throws. See Deviations from Plan.

### Automated Verification Results

- ✓ Type checking: `npx tsc --noEmit` — exit 0, no errors
- ✓ Full suite: `npm test` — exit 0, 53 tests pass (extract 9, keywords 18, email 15, recency 5, session 6)
- ✓ Extract suite: `npx tsx --test tests/extract.test.ts` — exit 0, 9 tests (includes the graphql XHR fixture case)
- ✓ Recency suite: `npx tsx --test tests/recency.test.ts` — exit 0, 5 tests
- ✓ Session suite: `npx tsx --test tests/session.test.ts` — exit 0, 6 tests
- ✓ Seed state validates: `node --input-type=module -e '…'` — exit 0
- ✓ Save-gating: `npx tsx --input-type=module -e '…'` — exit 0, `saved: false` on empty input
- ✓ Atomic write and diff: `npx tsx --input-type=module -e '…'` — exit 0
- ✓ Lockfile committed: `git ls-files --error-unmatch package-lock.json` — exit 0
- ✓ `npm pkg get type` — `"module"`
- ✓ Fixture carries real capture data: `grep -c "DevQHRdD4Bm" tests/fixture/tag-page.html` — 1
- ✓ `ThreadItemRaw` retired: `grep -c "ThreadItemRaw" src/types.ts` — 0
- ✓ Old search surfaces retired: `grep -c "SEARCH_SURFACES\|SEARCH_QUERY" src/config.ts` — 0
- ✓ `THREADS_TAGS` configurable: `grep -c "THREADS_TAGS" src/config.ts` — 2
- ✓ No stealth plugin: `grep -ci "stealth" src/fetch-threads.ts` — 0
- ✓ Config exports preserved: `KEYWORDS` — 1, `ENV_NAMES` — 3
- ✓ Workflow triggers: `workflow_dispatch` — 1; `cron: "*/10 * * * *"` — 1
- ✓ Bot commit-back: `github-actions[bot]` — 2 occurrences; commit step gated on a non-empty staged diff
- ✓ No PAT in commit-back path: `grep -ci "personal.access.token\|pat_"` — 0
- ✓ D9 timeout: `timeout-minutes: 10` — 1
- ✓ Overlap guard: `concurrency:` — 1
- ✓ No browser caching: `grep -c "actions/cache"` — 0
- ✓ Phase 8 config surface: `THREADS_SESSION_STATE` — 1, `DEFAULT_RECENCY_HOURS` — 4
- ✓ Phase 8 workflow wiring: `THREADS_SESSION_STATE` — 1, `RECENCY_HOURS` — 1
- ✓ Session never persisted: `grep -rn "storageState\|storage-state" state/` — 0 matches
- ✓ Logged-out fallback intact: `grep -c "fetchTagPages" src/index.ts` — 2
- ✓ Secret hygiene (all phases): `grep -rniE "password|api_key|sessionid" src tests .github README.md` — matches only env-var NAME constants, test fixture strings (`"test-key"`, `"app-password"`, `"pass"`, `"abcd efgh ijkl mnop"`), and README placeholder mentions. No secret values.
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- `src/fetch-threads.ts:145-260` — `fetchTagPostsAuthenticated` and `fetchOneAuthenticated` are a byte-faithful realization of the Phase 8 code fence, including the constants block (`RECENT_TAB_LABEL`, `MAX_SCROLL_ROUNDS = 8`, `SCROLL_MIN_GAIN = 2`, `MAX_POSTS_PER_SURFACE = 150`, `RECENT_SETTLE_MS = 5000`, `SCROLL_SETTLE_MS = 2500`, `XHR_DRAIN_MS = 1500`).
- `src/index.ts:26-40` — session branch, uniform dedupe, and the recency filter placed after extraction and before dedupe, exactly as specified.
- `src/threads-session.ts` — `isValidStorageState` / `resolveSession` match the fence; the decoded document lands in an OS temp dir, never in the repo.
- `src/recency.ts` — `filterRecent` matches the fence, including the non-positive-window and unparseable-timestamp behavior.
- `src/config.ts` — `ENV_NAMES` gains `threadsSession` and `recencyHours`; `resolveRecencyHours` matches the fence.
- `src/extract.ts` — `walkForThreadItems` / `normalize` are exported as `collectThreadItems` / `normalizeThreadItem` with unchanged bodies; `extractPosts` behavior is unchanged.
- `.github/workflows/watch.yml` — the watcher step passes `THREADS_SESSION_STATE` and `RECENCY_HOURS`; every other step is unchanged from Phase 7.
- `tests/fixture/graphql-response.json` — trimmed real capture, three posts, byte-real values, real `data.searchResults.edges[].node.thread.thread_items` path.
- `tests/extract.test.ts` — the `graphql XHR body extraction` case walks the fixture through the exported helpers to the expected `Post[]`.
- `tests/recency.test.ts`, `tests/session.test.ts` — match their fences.

#### Deviations from Plan:

- **BLOCKER — `src/fetch-threads.ts:228` (Recent-tab race).** The plan's fence reads `const recentTab = page.locator(...).first(); if ((await recentTab.count()) > 0) { await recentTab.click(); ... } else { console.warn("... has no Recent tab ...") }`. `count()` is a single non-blocking probe. Measured against a real authenticated session: `count()` returns **0** at the moment the hydration gate resolves, and **1** roughly 6 seconds later. The shipped code therefore always takes the `else` branch, logs `fetch: /tag/hiring has no Recent tab — using the default view`, and stays on the Top view. The Top view produces no `thread_items`-carrying graphql responses at all, so `xhrBodies` stays 0.
- **BLOCKER — `src/fetch-threads.ts:243` (impatient scroll break).** The fence reads `const gained = posts.size - before; if (gained < SCROLL_MIN_GAIN) { ...; break; }` after a single `SCROLL_SETTLE_MS` (2500 ms) settle. The `posts` map is populated by **async** response handlers, so the first round almost always measures `gained === 0` and the loop exits after one iteration. Measured: with the Recent tab clicked, round 1 gains 0, round 2 gains 25, round 3 gains 13.
- **Combined measured effect.** Running the shipped `fetchTagPostsAuthenticated(["hiring","lowker","infokerja"])` with a valid session: `0 post(s) from 0 XHR response(s)` on all three surfaces, then `Error: fetch: all 3 authenticated surface(s) failed` and a non-zero exit. The plan's Phase 8 manual criterion — "counts well above the logged-out ~19 (probe measured 92 on /tag/hiring)" — fails. A scratch replica of the same function with only the two timing defects repaired (wait for the Recent tab to attach; require three consecutive dry rounds before stopping) yields **68 posts on /tag/hiring from 6 XHR bodies** with the same session, same machine, same viewport and UA. The defect is in the plan's design, not in its transcription: the shipped code matches the fence exactly.
- **`src/fetch-threads.ts:174-178` (misleading all-fail message).** A surface that returns 0 posts is pushed into `results` and counted as a success, so the aggregate `results.length === 0` throw emits `all 3 authenticated surface(s) failed:` followed by an **empty** failure list. The run fails with no diagnostic of which surface failed or why. Non-blocking on its own, but it is what turned the two timing defects into an opaque hard failure.
- **README `## Pipeline` steps 1 and 2 are now untrue.** Step 1 still reads "Playwright loads the tag pages … logged out" and step 2 still reads "Posts are extracted from the embedded `data-sjs` JSON". With `THREADS_SESSION_STATE` set, the pipeline signs in, clicks the Recent tab, and reads posts from graphql XHR bodies. Comment-only — no executable line changes and no downstream stage fails as written.
- **README session-refresh step 2 documents a procedure that does not work.** It states that `pire-browser cookies --json` yields a Playwright storageState document. Verified empirically: Playwright rejects the raw cookie objects with `browser.newContext: storageState.cookies[0].sameSite: expected one of (Strict|Lax|None)`, because the pire-browser export uses `unspecified` and `no_restriction`. A conversion step (map `sameSite`, wrap in `{cookies, origins}`, base64-encode) is required and is not documented. Comment-only.
- **Plan criterion text drift (Phase 8, session suite).** The criterion reads "`npx tsx --test tests/session.test.ts` exits 0 (7 tests)". The shipped suite — matching the plan's own code fence — contains 6 `it()` blocks and passes. The command passes; only the parenthetical count is wrong. Comment-only.

#### Pattern Conformance:

- ✓ Imports, naming, error handling, and test structure follow the conventions established in Phases 1-7: `node:assert/strict` + `node:test` `describe`/`it`, `import type` for type-only imports, `.js` specifiers on relative imports, `console.warn` for recoverable conditions and thrown `Error` for fatal ones.
- ✓ `src/recency.ts` and `src/threads-session.ts` mirror the shape of their siblings (`src/keywords.ts`, `src/state.ts`): a module docstring citing the driving requirement, exported pure functions, and env resolution through `ENV_NAMES` rather than literal strings.
- ✓ `tests/session.test.ts` and `tests/recency.test.ts` follow the fixture-free, table-driven style of `tests/keywords.test.ts`.
- Acceptable variation, not a deviation: `fetchOneAuthenticated` keeps its Playwright types local to `src/fetch-threads.ts` rather than exporting them, where Phase 3 exported `SurfaceFetch`. The authenticated path returns `Post[]` directly and has no per-surface HTML to hand back, so there is no analogous contract to export.

#### Potential Issues:

- `src/fetch-threads.ts:228` — the Recent tab is located by `aria-label` only. Threads ships localized builds; a non-English UI would silently fall back to the Top view with only a `console.warn`. The same class of silent degradation already bit this phase once (the hydration gate passes on an empty `thread_items` array, so a soft-404 tag page reports `OK` with 0 posts instead of failing).
- `src/fetch-threads.ts:243` — `SCROLL_MIN_GAIN = 2` with a single settle window makes the scroll loop's stopping condition dependent on network latency. On a slow runner the loop can stop before the first XHR lands; on a fast one it can stop while more posts are still in flight. The measured 68-post result came from requiring three consecutive dry rounds, which suggests the single-round rule is the wrong shape rather than a tunable constant.
- `.github/workflows/watch.yml` — `timeout-minutes: 10` was sized for the logged-out path (2-3 min). The authenticated path with a working Recent-tab scroll loop measured ~28 s per surface locally on a residential connection; from a datacenter IP with three surfaces and up to eight scroll rounds each, the 10-minute budget is plausible but unverified. The Phase 8 Actions smoke gate has not run.
- Phase 7's digest-delivery, state-commit, and no-new-run criteria have never been exercised: the only Actions run logged `keywords: 0 maybes` and `state unchanged; nothing to commit`. The keyword list matched nothing in the 58-post logged-out feed, so the email and commit-back paths remain unproven end to end.

### Manual Testing Required:

Executed during this validation run. Results below; unchecked items are the ones that could not be exercised.

1. Phase 3 — single-failure tolerance:
   - [x] `THREADS_TAGS="hiring, nonexistent-tag-zz"` scratch run exits 0 and still extracts the good surface (19 posts from `/tag/hiring`).
   - [ ] "logs the failed surface" — not exercised. Threads answers unknown tags with a soft-404 page whose blobs still satisfy the hydration gate, so no surface ever fails and the tolerance branch is never entered. The run succeeds, which is the criterion's primary assertion.
2. Phase 7 — bot-detection smoke gate:
   - [x] Actions run `40165612441` (workflow_dispatch, commit `1a9e353`) finished green in 44 s with `extract: tag/hiring: 19 post(s)`, `tag/lowker: 19`, `tag/infokerja: 19`, `extract: 57 unique post(s) across 3 surface(s)`. Datacenter IPs are not blocked on the logged-out path.
3. Phase 7 — digest and state commit-back:
   - [ ] A dispatch that finds matches delivers the plain-text digest — not exercised. The only run logged `keywords: 0 maybes`.
   - [ ] State commit authored by `github-actions[bot]` with message `state: N new seen post ids` — not exercised. The run logged `state unchanged; nothing to commit`.
   - [ ] The state-commit push spawns no new workflow run — not exercised, for the same reason.
4. Phase 7 — README quick-start on a fresh clone:
   - [x] `git clone` → `npm install` → `npx playwright install chromium` → `npm start` runs top to bottom and exits 0 with `no new matches` (0 maybes, so no LLM or Gmail credentials are needed to reach a clean exit).
5. Phase 8 — authenticated fetch:
   - [ ] With `THREADS_SESSION_STATE` seeded, a local run logs per-surface counts well above the logged-out ~19 — **FAILS**. Logs `0 post(s) from 0 XHR response(s)` per surface, then throws. See Deviations from Plan.
   - [x] The recency log line shows the kept count — verified on the logged-out path: `recency: 3 post(s) within 72h` out of 58 unique, median age 485.5 h, 0 posts within 24 h. Matches the plan's measured ~23-day median.
   - [x] With the secret unset, the run takes the logged-out path and behaves exactly as Phases 1-7 — verified: 19/21/18 posts, 58 unique, same code path as the committed Phase 7 build.
   - [x] An invalid `THREADS_SESSION_STATE` logs the fallback warning and does not fail the run — verified twice: `!!!not-base64!!!` logs `session: THREADS_SESSION_STATE is not valid base64 JSON — using the logged-out fetch`, and a cookie-less document logs `session: THREADS_SESSION_STATE carries no cookies — using the logged-out fetch`. Both exit 0.
6. Phase 8 — Actions smoke gate:
   - [ ] Actions dispatch with the secret seeded, Recent-tab counts > 0 from datacenter IPs — not run. It requires pushing the Phase 8 working-tree changes to `main` first, which was not authorized in this session.

### Recommendations:

- Fix the two timing defects in `src/fetch-threads.ts` before anything else. Both live in the plan's Phase 8 code fence, so this is a plan-level correction: escalate to `/skill:revise .rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md`, then re-implement Phase 8, then re-run `/skill:validate`.
  - Replace the one-shot `recentTab.count()` probe with a wait for the tab to attach (`await recentTab.waitFor({ state: "attached", timeout: … })`), and only then decide between click and fallback.
  - Replace the single-round `gained < SCROLL_MIN_GAIN` break with a consecutive-dry-rounds rule (three measured dry rounds stopped cleanly at 68 posts).
- Make the all-fail error name the surfaces that returned zero posts, so a future regression of this class is diagnosable from the log alone.
- After Phase 8 is fixed, run the Phase 8 Actions smoke gate (push + `workflow_dispatch`) before committing — it is the only check that covers the logged-in path from a datacenter IP.
- Separately, and only after the blocker is cleared: the Phase 7 digest, state-commit, and no-new-run criteria have never been exercised because the keyword filter matched nothing in the logged-out feed. A seeded match run is needed to prove the email and commit-back paths end to end.
- Update the README's `## Pipeline` section and its session-refresh step 2 to match the authenticated path and to document the `sameSite` conversion Playwright requires.
