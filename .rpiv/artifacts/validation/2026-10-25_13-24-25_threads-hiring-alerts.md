---
template_version: 1
date: 2026-10-25T13:24:25+0700
author: Yogiswara Utama
commit: 9e1c8ef9b4613e0e2937e8eeecdcb6dc90017a8d
branch: main
repository: loker-watcher
topic: "Validation of Threads #hiring Indonesia job alerts — full v1 pipeline"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md"
tags: [validation, plan, threads, playwright, scraper, github-actions, email]
last_updated: 2026-10-25T13:24:25+0700
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
- ✓ Phase 8: Authenticated fetch + recency — Fully implemented and verified end to end: locally against a real session, deterministically against a mock reproducing both timing races, and from GitHub Actions datacenter IPs. Both defects that failed the previous validation are confirmed repaired.

### Automated Verification Results

- ✓ Type checking: `npx tsc --noEmit` — exit 0, no errors
- ✓ Full suite: `npm test` — exit 0, 53 tests pass (extract 9, keywords 18, email 15, recency 5, session 6)
- ✓ Extract suite: `npx tsx --test tests/extract.test.ts` — exit 0, 9 tests (includes the graphql XHR fixture case)
- ✓ Keywords suite: `npx tsx --test tests/keywords.test.ts` — exit 0, 18 tests
- ✓ Email suite: `npx tsx --test tests/email.test.ts` — exit 0, 15 tests
- ✓ Recency suite: `npx tsx --test tests/recency.test.ts` — exit 0, 5 tests
- ✓ Session suite: `npx tsx --test tests/session.test.ts` — exit 0, 6 tests
- ✓ Extract + keywords regression: `npx tsx --test tests/extract.test.ts tests/keywords.test.ts` — exit 0, 27 tests
- ✓ `npm install` — exit 0, `node_modules` present
- ✓ `npm pkg get type` — `"module"`
- ✓ Seed state validates: `node --input-type=module -e '…'` — exit 0
- ✓ Save-gating: `npx tsx --input-type=module -e '…'` — exit 0, `saved: false` on empty input
- ✓ Atomic write and diff: `npx tsx --input-type=module -e '…'` — exit 0
- ✓ Lockfile committed: `git ls-files --error-unmatch package-lock.json` — exit 0
- ✓ Fixture carries real capture data: `grep -c "DevQHRdD4Bm" tests/fixture/tag-page.html` — 1
- ✓ `ThreadItemRaw` retired: `grep -c "ThreadItemRaw" src/types.ts` — 0
- ✓ Old search surfaces retired: `grep -c "SEARCH_SURFACES\|SEARCH_QUERY" src/config.ts` — 0
- ✓ `THREADS_TAGS` configurable: `grep -c "THREADS_TAGS" src/config.ts` — 2
- ✓ No stealth plugin: `grep -ci "stealth" src/fetch-threads.ts` — 0
- ✓ Config exports preserved: `KEYWORDS` — 1, `ENV_NAMES` — 3
- ✓ Phase 8 config surface: `THREADS_SESSION_STATE` — 1, `DEFAULT_RECENCY_HOURS` — 4
- ✓ Workflow triggers: `workflow_dispatch` — 1; `cron: "*/10 * * * *"` — 1
- ✓ Bot commit-back: `github-actions[bot]` — 2 occurrences; commit step gated on a non-empty staged diff
- ✓ No PAT in commit-back path: `grep -ci "personal.access.token\|pat_"` — 0
- ✓ D9 timeout: `timeout-minutes: 10` — 1
- ✓ Overlap guard: `concurrency:` — 1
- ✓ No browser caching: `grep -c "actions/cache"` — 0
- ✓ Phase 8 workflow wiring: `THREADS_SESSION_STATE` — 1, `RECENCY_HOURS` — 1
- ✓ Session never persisted: `grep -rn "storageState\|storage-state" state/` — 0 matches
- ✓ Logged-out fallback intact: `grep -c "fetchTagPages" src/index.ts` — 2
- ✓ Recent-tab wait present: `grep -c "RECENT_TAB_TIMEOUT_MS" src/fetch-threads.ts` — 3
- ✓ Consecutive-dry-round stop present: `grep -c "MAX_DRY_SCROLL_ROUNDS" src/fetch-threads.ts` — 5
- ✓ Zero-post surfaces named in the all-fail error: `grep -c "0 post(s) extracted" src/fetch-threads.ts` — 1
- ✓ Secret hygiene: `grep -rniE "password|api_key|sessionid" src tests .github README.md` — matches only env-var NAME constants, test fixture strings (`"test-key"`, `"app-password"`, `"pass"`, `"abcd efgh ijkl mnop"`, `"x"`), and README placeholder mentions. No secret values.
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- `src/fetch-threads.ts:196-260` — `fetchTagPostsAuthenticated` and `fetchOneAuthenticated` are a faithful realization of the **revised** Phase 8 code fence. The Recent tab is located with `page.locator(...).first()` and then **awaited** with `recentTab.waitFor({ state: "visible", timeout: RECENT_TAB_TIMEOUT_MS })` inside a try/catch that sets `recentVisible = false` on timeout — the one-shot `count()` probe is gone. The scroll loop keeps a `dryRounds` counter and breaks only after `MAX_DRY_SCROLL_ROUNDS` (3) consecutive rounds gaining fewer than `SCROLL_MIN_GAIN` posts, resetting the counter on any productive round. The all-fail error appends `` `${empty.join(", ")}: 0 post(s) extracted — the Recent tab or the graphql XHR capture yielded nothing` `` when surfaces return zero posts.
- `src/fetch-threads.ts:36-42` — `RECENT_TAB_TIMEOUT_MS = 15_000` and `MAX_DRY_SCROLL_ROUNDS = 3` are declared in their own documented block, as the fence specifies.
- `src/index.ts:26-40` — session branch, uniform `dedupePosts`, and the recency filter placed after extraction and before dedupe, exactly as specified.
- `src/threads-session.ts` — `isValidStorageState` / `resolveSession` match the fence; the decoded document lands in an OS temp dir, never in the repo.
- `src/recency.ts` — `filterRecent` matches the fence, including the non-positive-window and unparseable-timestamp behavior.
- `src/config.ts` — `ENV_NAMES` gains `threadsSession` and `recencyHours`; `resolveRecencyHours` matches the fence.
- `src/extract.ts` — `walkForThreadItems` / `normalize` are exported as `collectThreadItems` / `normalizeThreadItem` with unchanged bodies; `extractPosts` behavior is unchanged.
- `.github/workflows/watch.yml` — the watcher step passes `THREADS_SESSION_STATE` and `RECENCY_HOURS`; every other step is unchanged from Phase 7.
- `tests/fixture/graphql-response.json` — trimmed real capture, three posts, byte-real values, real `data.searchResults.edges[].node.thread.thread_items` path.
- `tests/extract.test.ts` — the `graphql XHR body extraction` case walks the fixture through the exported helpers to the expected `Post[]`.
- `tests/recency.test.ts`, `tests/session.test.ts` — match their fences.
- `README.md` — `## Pipeline` now describes both paths (authenticated Recent-tab XHR capture when the secret is set, logged-out `data-sjs` blob extraction otherwise), the secrets table carries `THREADS_SESSION_STATE`, and the session-refresh step documents the `sameSite` conversion Playwright requires. The two README statements the previous validation ruled untrue are corrected.

#### Deviations from Plan:

- **Plan bookkeeping — Phase 7 `npm test` criterion left unchecked.** The plan's Phase 7 Automated Verification still reads `- [ ] Full suite passes: npm test exits 0`. The command passes (53 tests, 0 fail) and Phase 8 carries the same criterion as `- [x]`. The checkbox is stale, not the code. Comment-only.
- **Plan criterion text drift — test-count parentheticals.** Phase 2 reads "`npx tsx --test tests/extract.test.ts` exits 0 (8 tests)" and Phase 8 reads "`npx tsx --test tests/session.test.ts` exits 0 (7 tests)". The shipped suites — matching the plan's own code fences — contain 9 and 6 `it()` blocks respectively and pass. The commands pass; only the parenthetical counts are wrong. Comment-only.
- **Phase 3 manual sub-clause not exercisable.** The criterion asks that a scratch run with `THREADS_TAGS="hiring, nonexistent-tag-zz"` "still succeeds … and logs the failed surface". The run succeeds (see Manual Testing Required §1), but Threads answers unknown tags with a soft-404 page whose blobs still satisfy the hydration gate, so no surface ever enters the failure branch and nothing is logged as failed. The tolerance code path is correct; the site never triggers it. Comment-only.

#### Pattern Conformance:

- ✓ Imports, naming, error handling, and test structure follow the conventions established in Phases 1-7: `node:assert/strict` + `node:test` `describe`/`it`, `import type` for type-only imports, `.js` specifiers on relative imports, `console.warn` for recoverable conditions and thrown `Error` for fatal ones.
- ✓ `src/recency.ts` and `src/threads-session.ts` mirror the shape of their siblings (`src/keywords.ts`, `src/state.ts`): a module docstring citing the driving requirement, exported pure functions, and env resolution through `ENV_NAMES` rather than literal strings.
- ✓ `tests/session.test.ts` and `tests/recency.test.ts` follow the fixture-free, table-driven style of `tests/keywords.test.ts`.
- Acceptable variation, not a deviation: `fetchOneAuthenticated` keeps its Playwright types local to `src/fetch-threads.ts` rather than exporting them, where Phase 3 exported `SurfaceFetch`. The authenticated path returns `Post[]` directly and has no per-surface HTML to hand back, so there is no analogous contract to export.

#### Potential Issues:

- `src/threads-session.ts:59-62` — `resolveSession` writes the decoded storageState to a fresh `mkdtemp` directory and never removes it. Every run leaves an account-equivalent session document on disk in the OS temp folder. On a GitHub Actions runner the whole filesystem is discarded, so the exposure is bounded; on a developer machine the directories accumulate and outlive the run. A `finally` cleanup in `src/index.ts` (or an `rm` after `browser.close()`) would close it. Not a plan deviation — the fence specifies the temp file and says nothing about its lifetime.
- `src/fetch-threads.ts:228` — the Recent tab is located by `aria-label` only. Threads ships localized builds; a non-English UI would silently fall back to the default view with only a `console.warn`. The same class of silent degradation already bit this phase once (the hydration gate passes on an empty `thread_items` array, so a soft-404 tag page reports `OK` with 0 posts instead of failing).
- `src/fetch-threads.ts:243` — the scroll loop's stopping condition still depends on network latency, now across three rounds instead of one. Both the local and the Actions runs measured dry rounds recovering on the next round (`/tag/hiring` scroll 4 `+0 (dry 1/3)` then scroll 5 `+9` locally; `/tag/lowker` scroll 4 `+0 (dry 1/3)` then scroll 5 `+15` on Actions), which is exactly the behavior the old single-round break destroyed. On a very slow runner three consecutive dry rounds can still pass before the first XHR lands; on a very fast one the loop can stop while posts are in flight. The constants are tuned from residential- and datacenter-IP measurements, which now agree.
- **The keyword filter is far more restrictive than the feed volume suggests.** Both the local authenticated run (282 recent posts) and the Actions run (303 recent posts) produced exactly **1 maybe**. With a working LLM endpoint that maybe was judged and returned `0 relevant+located`, so no match, no digest, no state commit. The practical consequence: match runs will be rare, so the Phase 7 digest and state-commit paths may go unexercised for a long time in production. This is a tuning question, not a defect — the plan's `KEYWORDS` list is implemented as specified.
- Phase 7's digest-delivery, state-commit, and no-new-run criteria have never been exercised against a real match. Two Actions runs have now logged `keywords: 0 maybes` / `keywords: 1 maybes, judge: 0 relevant+located` and `state unchanged; nothing to commit`. The email and commit-back paths remain unproven end to end.
- `README.md:74` — the documented session-export route, `pire-browser cookies --json`, prints cookie values (including `sessionid`) straight to the terminal. The command's own help warns about this. The README should tell the reader to redirect the output to a file outside the repo before converting it. Comment-only.

### Manual Testing Required:

Executed during this validation run where the environment allowed. Every criterion that could be exercised has been; the three that remain need a match to occur.

1. Phase 3 — single-failure tolerance:
   - [x] `THREADS_TAGS="hiring, nonexistent-tag-zz"` scratch run exits 0 and still extracts the good surface (19 posts from `/tag/hiring`).
   - [ ] "logs the failed surface" — not exercisable. Threads answers unknown tags with a soft-404 page whose blobs still satisfy the hydration gate, so no surface ever fails and the tolerance branch is never entered. The run succeeds, which is the criterion's primary assertion.
2. Phase 7 — bot-detection smoke gate:
   - [x] Actions run `40165612441` (workflow_dispatch, commit `1a9e353`) finished green in 44 s with `extract: tag/hiring: 19 post(s)`, `tag/lowker: 19`, `tag/infokerja: 19`, `extract: 57 unique post(s) across 3 surface(s)`. Datacenter IPs are not blocked on the logged-out path.
3. Phase 7 — digest and state commit-back:
   - [ ] A dispatch that finds matches delivers the plain-text digest — not exercised. Both Actions runs found no match (`keywords: 0 maybes`, then `keywords: 1 maybes, judge: 0 relevant+located`).
   - [ ] State commit authored by `github-actions[bot]` with message `state: N new seen post ids` — not exercised. Both runs logged `state unchanged; nothing to commit`.
   - [ ] The state-commit push spawns no new workflow run — not exercised, for the same reason. The mechanism is sound by construction (the commit-back uses only the ambient `GITHUB_TOKEN`, and `gh run list` after the dispatch shows exactly two runs total, no cascade), but the no-new-run path itself has never fired.
4. Phase 7 — README quick-start on a fresh clone:
   - [x] `git clone` → `npm install` → `npx playwright install chromium` → `npm start` runs top to bottom and exits 0 with `no new matches` (0 maybes, so no LLM or Gmail credentials are needed to reach a clean exit). Verified against a fresh clone carrying the current working tree.
5. Phase 8 — authenticated fetch:
   - [x] **With `THREADS_SESSION_STATE` seeded, a local run logs per-surface counts well above the logged-out ~19.** The session was rebuilt for this run by exporting the live Firefox cookies for `.threads.com` through pire-browser and converting them to a Playwright storageState document (`sameSite` mapping per the README: `unspecified`/`lax` → `Lax`, `no_restriction` → `None`). Result, exit 0:
     - `fetch: /tag/hiring OK — 105 post(s) from 9 XHR response(s)` → `extract: tag/hiring: 105 post(s) (authenticated)`
     - `fetch: /tag/lowker OK — 110 post(s) from 8 XHR response(s)` → `extract: tag/lowker: 110 post(s) (authenticated)`
     - `fetch: /tag/infokerja OK — 73 post(s) from 6 XHR response(s)` → `extract: tag/infokerja: 73 post(s) (authenticated)`
     - `extract: 288 unique post(s) across 3 surface(s)`
     Counts clear the plan's floor (probe 92, corrected replica 68) on every surface. No `has no Recent tab` warning appeared, so the Recent tab was located and clicked on all three surfaces.
   - [x] **The run logs `fetch: /tag/<tag> scroll N: +M` lines with M ≥ 2.** Many, on every surface: `/tag/hiring` scroll 1 `+13`, scroll 2 `+12`, scroll 3 `+15`, scroll 5 `+9`, scroll 7 `+23`, scroll 8 `+12`; `/tag/lowker` scroll 2 `+28`, scroll 3 `+15`, scroll 5 `+14`, scroll 6 `+16`, scroll 7 `+13`, scroll 8 `+12`; `/tag/infokerja` scroll 3 `+11` through scroll 7 `+14`. The loop also **recovered from dry rounds twice** — `/tag/hiring` scroll 4 `+0 (dry 1/3)` followed by scroll 5 `+9`, and `/tag/lowker` scroll 1 `+0 (dry 1/3)` followed by scroll 2 `+28`. Under the pre-revision single-round break both surfaces would have stopped at their first dry round and returned almost nothing.
   - [x] **The recency log line shows the kept count.** `recency: 282 post(s) within 72h` out of 288 unique — 97.9% kept, consistent with the plan's measured Recent-tab distribution (89/92 ≤ 72h).
   - [x] **The two timing defects that failed the previous validation are verified repaired, independently of the live run.** A deterministic A/B harness (local mock of the logged-in tag page reproducing both measured races: a Recent tab that appears ~6 s after the hydration gate resolves, and graphql XHR responses that land ~3 s after the scroll that triggers them — later than the 2.5 s settle window) ran the pre-revision logic and the shipped logic side by side. Control arm (one-shot `count()` probe + single-dry-round break): `no Recent tab — using the default view`, `scroll 1: +0`, **0 posts** — the exact failure the previous validation measured. Treatment arm (shipped `waitFor` + `MAX_DRY_SCROLL_ROUNDS`): `Recent tab clicked`, `scroll 1: +0 (dry 1/3)`, `scroll 2: +0 (dry 2/3)`, `scroll 3: +25`, then three dry rounds, **25 posts**. Both arms shared the real `collectThreadItems` / `normalizeThreadItem` helpers and the real constants; only the control flow differed.
   - [x] The shipped `fetchTagPostsAuthenticated` runs end to end against the real site without crashing in a non-authenticating context too: with a structurally valid but bogus storageState it logged `fetch: /tag/hiring has no Recent tab — using the default view`, three dry scroll rounds, then `fetch: /tag/hiring OK — 5 post(s) from 1 XHR response(s)` and exited 0.
   - [x] With the secret unset, the run takes the logged-out path and behaves exactly as Phases 1-7 — verified: 19/21/18 posts, 58 unique, `recency: 3 post(s) within 72h`, `keywords: 0 maybes`, `no new matches`, exit 0.
   - [x] An invalid `THREADS_SESSION_STATE` logs the fallback warning and does not fail the run — verified twice: `!!!not-base64!!!` logs `session: THREADS_SESSION_STATE is not valid base64 JSON — using the logged-out fetch`, and a cookie-less document logs `session: THREADS_SESSION_STATE carries no cookies — using the logged-out fetch`. Both exit 0.
   - [x] No side effects from the local authenticated run: `state/seen-posts.json` was byte-identical before and after (the dummy LLM endpoint skipped the single maybe, so no match, no email, no state write). All scratch files and every `loker-session-*` temp directory were deleted.
6. Phase 8 — Actions smoke gate:
   - [x] **Actions dispatch with the secret seeded, Recent-tab counts > 0 from datacenter IPs.** Run `40169993107` (workflow_dispatch, commit `9e1c8ef`) finished **success** in 2m16s:
     - `fetch: /tag/hiring OK — 123 post(s) from 10 XHR response(s)` → `extract: tag/hiring: 123 post(s) (authenticated)`
     - `fetch: /tag/lowker OK — 114 post(s) from 8 XHR response(s)` → `extract: tag/lowker: 114 post(s) (authenticated)`
     - `fetch: /tag/infokerja OK — 100 post(s) from 9 XHR response(s)` → `extract: tag/infokerja: 100 post(s) (authenticated)`
     - `extract: 337 unique post(s) across 3 surface(s)`
     - `recency: 303 post(s) within 72h`
     - `state: 303 unseen post(s)`
     - `keywords: 1 maybes, judge: 0 relevant+located, skipped: 0`
     - `no new matches`, then `state unchanged; nothing to commit`
     Counts are ~6× the logged-out ~19 on every surface, so datacenter IPs are not blocked on the authenticated path either. The LLM judge ran for real (`skipped: 0`) and returned a negative verdict, which is why no digest was sent. `gh run list` after the dispatch shows exactly two runs total — no cascade. Runtime 2m16s sits comfortably inside `timeout-minutes: 10`.

### Recommendations:

- Ready to commit — done. Commit `9e1c8ef` (`feat: authenticated threads fetch with recency cutoff`, 12 files) is pushed to `origin/main`, and the Phase 8 Actions smoke gate passed on it.
- Add temp-directory cleanup to `src/threads-session.ts` or `src/index.ts`. Every run currently leaves an account-equivalent session document in the OS temp folder. On an Actions runner this is harmless; on a developer machine it accumulates.
- Widen `KEYWORDS` or accept rare matches. Two authenticated runs (local and Actions) each yielded ~300 recent posts but only 1 maybe, judged not relevant. If the goal is a usable alert stream rather than a precise one, the keyword list is the lever — and until a match occurs, the digest and state-commit paths stay unproven.
- Add a redirect warning to the README's session-export step: `pire-browser cookies --json` prints `sessionid` to the terminal.
- Tick the stale Phase 7 `npm test` checkbox and correct the two test-count parentheticals (8 → 9 for extract, 7 → 6 for session) on the next plan touch. Comment-only; no code impact.
- Optionally seed one match (temporarily widen `KEYWORDS`, dispatch, confirm the digest and the `github-actions[bot]` commit, then revert) to close the last three Phase 7 criteria. This is the only remaining gap in the plan's verification.
