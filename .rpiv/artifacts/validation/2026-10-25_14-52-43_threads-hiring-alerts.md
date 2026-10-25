---
template_version: 1
date: 2026-10-25T14:52:43+0700
author: Yogiswara Utama
commit: b050436
branch: main
repository: loker-watcher
topic: "Validation of Threads #hiring Indonesia job alerts — full v1 pipeline"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md"
tags: [validation, threads, playwright, scraper, github-actions, email]
last_updated: 2026-10-25T14:52:43+0700
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
- ✓ Phase 8: Authenticated fetch + recency — Fully implemented
- ✓ Phase 9: No-match heartbeat — Fully implemented
- ✓ Phase 10: JSON config + URL surfaces — Fully implemented

### Automated Verification Results

- ✓ Type checking: `npx tsc --noEmit` — exits 0, no errors
- ✓ Full suite: `npm test` — 90 tests, 27 suites, 90 pass, 0 fail
- ✓ Per-suite counts: config-file 15, email 15, extract 9, heartbeat 20, keywords 20, recency 5, session 6 — all exit 0
- ✓ Phase 1: `npm pkg get type` returns `"module"`; secret hygiene matches only env-var NAME constants, test fixture strings and README placeholders
- ✓ Phase 2: `grep -c "DevQHRdD4Bm" tests/fixture/tag-page.html` returns 1; `grep -c "ThreadItemRaw" src/types.ts` returns 0
- ✓ Phase 3: `grep -c "SEARCH_SURFACES\|SEARCH_QUERY" src/config.ts` returns 0; `grep -c "THREADS_TAGS" src/config.ts` returns 0; `grep -ci "stealth" src/fetch-threads.ts` returns 0
- ✓ Phase 4: `grep -c "frontend" watcher.config.json` returns 2
- ✓ Phase 5: seed-state validation, save-gating, and atomic write + diff inline commands all exit 0
- ✓ Phase 6: `grep -c "ENV_NAMES" src/config.ts` returns 2
- ✓ Phase 7: `git ls-files --error-unmatch package-lock.json` exits 0; `workflow_dispatch` 1; cron 1; `github-actions[bot]` 2; PAT grep 0; `timeout-minutes: 10` 1; `concurrency:` 1; `actions/cache` 0
- ✓ Phase 8: `THREADS_SESSION_STATE` in `src/config.ts` 1 and in `watch.yml` 1; `recencyHours` in `watcher.config.json` 1; `RECENCY_HOURS` in `watch.yml` 0; `storageState`/`storage-state` in `state/` 0; `fetchSurfaces` in `src/index.ts` 4; `RECENT_TAB_TIMEOUT_MS` 3; `MAX_DRY_SCROLL_ROUNDS` 5; `0 post(s) extracted` 1
- ✓ Phase 9: `grep -c "failed to send digest" tests/email.test.ts` returns 0; `sendDigest` in `src/index.ts` 2; `await heartbeat(` 3; `heartbeat: not sent` 1; `HEARTBEAT_ENABLED` in `src/config.ts` 1; `runUrlFromEnv` in `src/index.ts` 2
- ✓ Phase 10: committed-config and missing-config inline commands exit 0; `THREADS_TAGS` and `RECENCY_HOURS` return 0 across `src`, `.github` and `README.md`; `lowker` returns 0 across `src`, `README.md` and `watcher.config.json` while `loker` returns 1; `hiresflow` 1; `serp_type=deeplink` 1; `fetchSurfacesAuthenticated` in `src/index.ts` 2; `fetchSurfaces` in `src/fetch-threads.ts` 2; `KEYWORDS\|DEFAULT_TAGS\|DEFAULT_RECENCY_HOURS` in `src/config.ts` 0
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- `src/config-file.ts:1` — module header, `Surface` / `ResolvedSurface` / `WatcherConfig` types, `ALLOWED_KEYS`, `THREADS_HOST`, `loadWatcherConfig`, `validateConfig`, `readStringArray`, `readSurfaces`, `readRecencyHours`, `resolveSurfaces` and the local `tagPageUrlFor` all match the Phase 10 §2 fence
- `src/config.ts:11` — `ENV_NAMES` keeps only `threadsSession`, `heartbeat`, `llmBaseUrl`, `llmApiKey`, `llmModel`, `gmailUser`, `gmailAppPassword`; `STATE_PATH` and the new `CONFIG_PATH` are present; every retired symbol is gone
- `src/keywords.ts:19` — `matchesKeywords` and `filterPostsByKeywords` take `keywords` as a required parameter; the `KEYWORDS` import is dropped
- `src/heartbeat.ts:52` — the module-level `CANDIDATE_TERMS` array is deleted; `matchesCandidateTerms` and `selectCandidates` take the term list as a parameter
- `src/fetch-threads.ts:78` — `fetchSurfaces` and `fetchSurfacesAuthenticated` take `ResolvedSurface[]`, load `surface.url`, and log `surface.label`; `SurfaceFetch` carries `label`
- `src/index.ts:66` — config is loaded once at startup, surfaces are resolved, and `keywords`, `candidateTerms` and `recencyHours` are threaded from it; the `heartbeat()` helper takes the fourth `candidateTerms` parameter
- `.github/workflows/watch.yml:29` — the watcher step passes only `THREADS_SESSION_STATE` and the four LLM/Gmail secrets; `THREADS_TAGS` and `RECENCY_HOURS` are gone
- `README.md:1` — the "Configure what to watch" section, the rewritten `## Pipeline` step 1, the `lowker` → `loker` fix and the "no optional variables" line all match the Phase 10 §9 fence
- `tests/config-file.test.ts:1` — validation rules, the happy path against the committed file, and surface resolution match the Phase 10 §10 fence
- `tests/keywords.test.ts:100` and `tests/heartbeat.test.ts:44` — every call site passes an explicit list, and the shipped-config regression case is present
- `src/email.ts:86` — `sendText` is extracted and `sendDigest` attaches `messageId` through a conditional spread; `tests/email.test.ts:262` asserts the reconciled `email: failed to send:` string
- Working-tree scope: the dirty set is exactly the 12 files Phase 10 declares — 9 modified, 3 new (`src/config-file.ts`, `tests/config-file.test.ts`, `watcher.config.json`). No out-of-scope write.

#### Deviations from Plan:

None. The implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ `src/config-file.ts` follows the established module shape: a JSDoc header that states the module's purpose, `unknown` narrowing with explicit type guards, `readonly` arrays on public parameters, and a named error prefix (`config:`) on every thrown message — the same conventions as `src/state.ts` and `src/threads-session.ts`
- ✓ `tests/config-file.test.ts` follows the established test shape: `node:assert/strict`, `node:test` `describe`/`it`, scratch fixtures under the OS temp dir with an `after()` cleanup hook — the same pattern as `tests/session.test.ts`
- ✓ Log-line format (`fetch: <label> OK`, `extract: <label>: N post(s)`, `recency: N post(s) within Nh`) is consistent across the logged-out and authenticated paths
- Minor observation: `src/fetch-threads.ts:66` discriminates a tag surface from a URL surface with `surface.label.startsWith("tag/")` rather than carrying the surface `type` through `ResolvedSurface`. This is sound — a `url` surface is always an absolute `https://www.threads.com/...` URL, so its label can never begin with `tag/` — and the code documents the reasoning. Acceptable variation, not a deviation.

#### Potential Issues:

- `src/index.ts:170` — a failing run on Windows exits **127**, not 1, and prints a libuv assertion to stderr: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`. Reproduced deterministically: Playwright browser launch/close, then one or more `fetch` calls, then `process.exit(1)`. The fail-visible contract still holds — the run exits non-zero, prints `watch: FAILED — <message>`, and leaves `state/seen-posts.json` byte-identical (verified: `seenPostIds` still `[]` after a run that failed at the digest send). Non-blocking: this is a Windows libuv teardown issue, and the workflow runs on `ubuntu-latest`. Worth confirming the exit code on a real Actions run before relying on it.
- `src/fetch-threads.ts:96` — every threads.com URL tested hydrates, including a nonexistent tag, a nonexistent user path, `/settings/privacy` and `/search?q=`. Each passed the `HAS_THREAD_ITEMS` gate, so the logged-out single-failure tolerance and the all-fail throw were not reachable from real surfaces during this validation. The D11 tolerance is structurally correct (`fetchSurfaces` throws only when `results.length === 0`) and was observed succeeding with 2 of 2 surfaces, but the failed-surface log line itself went unexercised. Non-blocking; recorded so the next validator does not repeat the search.

### Manual Testing Required

Executed in this validation run (2026-10-25, residential IP, logged out, no `THREADS_SESSION_STATE`, no `GMAIL_*`):

1. Phase 10 — surface logging and post yields:
   - [x] A local run logs one line per configured surface — `fetch: tag/hiring OK`, `fetch: tag/loker OK`, `fetch: tag/infokerja OK`, `fetch: https://www.threads.com/@hiresflow OK`, `fetch: https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent OK` — and `extract: 70 unique post(s) across 5 surface(s)`
   - [x] The profile surface yields 8 post(s) and the search surface yields 13 post(s) (probes measured 8 and 14)
2. Phase 10 — JSON is the only source of truth:
   - [x] Adding one keyword (`hiring`) to `watcher.config.json` alone moves the funnel: `keywords: 0 maybes` → `keywords: 8 maybes, judge: 8 relevant+located, skipped: 0`
   - [x] Adding one URL surface (`https://www.threads.com/@zuck`) alone makes it appear in the log and reach the funnel: 6 surfaces, `extract: 79 unique post(s) across 6 surface(s)`
   - [x] Setting `recencyHours` to `24` alone drops the recency line: `recency: 17 post(s) within 72h` → `recency: 8 post(s) within 24h`
   - [x] Renaming `keywords` to `keyword` stops the run with exit 1 and `config: watcher.config.json has unknown key "keyword" — allowed keys: keywords, candidateTerms, surfaces, recencyHours`
   - [x] All four edits were reverted; `watcher.config.json` is byte-identical to its pre-run state
3. Phase 3 — fetch surface:
   - [x] A scratch script calling `fetchSurfaces` on one tag surface returns HTML whose `data-sjs` blobs carry hydrated `thread_items` (42 blobs, 1 carrying `thread_items`)
   - [~] A scratch run with `hiring` plus a nonexistent tag succeeds (2 of 2 surfaces). The nonexistent tag did **not** fail — threads.com hydrates it — so the failed-surface log line was not exercised. See Potential Issues.
4. Phase 8 — recency:
   - [x] The recency log line shows the kept count (`recency: 17 post(s) within 72h`; `recency: 8 post(s) within 24h`)
5. Phase 9 — heartbeat:
   - [x] With `GMAIL_*` unset, a zero-match run logs `heartbeat: not sent — email: missing required environment variables: GMAIL_USER, GMAIL_APP_PASSWORD` and exits 0
   - [x] With `HEARTBEAT_ENABLED=false`, a zero-match run logs `heartbeat: disabled by HEARTBEAT_ENABLED`, sends nothing, and exits 0
   - [x] Every candidate permalink in a real heartbeat body resolves to a real threads.com post — 8 of 8 verified in a browser (the post code appears in the rendered page)
   - [x] A real heartbeat body renders the funnel and up to 10 candidates with author, age, reason tag, snippet and permalink

Executed on GitHub Actions — run `40175344238`, commit `b050436` (Phase 10), 2026-10-25 08:06 UTC, conclusion **success**, 3m32s, all steps green:

6. Phase 7 — bot-detection smoke gate:
   - [x] Per-surface post counts > 0 from datacenter IPs and a green run. `tag/hiring` 127 post(s) from 10 XHR response(s), `tag/loker` 127 from 9, `tag/infokerja` 100 from 9, `@hiresflow` 131 from 7, `search?q=hiring…recent` 95 from 7 → `extract: 504 unique post(s) across 5 surface(s)`
7. Phase 8 — authenticated path from datacenter IPs:
   - [x] `fetch: tag/hiring OK — 127 post(s) from 10 XHR response(s)` — well above the logged-out ~19
   - [x] Scroll lines with `M` ≥ 2 present (for example `fetch: tag/hiring scroll 2: +12` on the 07:31 run)
   - [x] `recency: 349 post(s) within 72h`
   - [x] Actions dispatch with the secret seeded: Recent-tab counts > 0 from datacenter IPs
8. Phase 9 — heartbeat delivery:
   - [x] `heartbeat: sent status email — 349 post(s) scanned, 10 candidate(s)` — delivered on three separate runs (07:26, 07:31, 08:06)
9. Phase 10 — authenticated URL surfaces:
   - [x] The authenticated run handles both URL surfaces without failing and extracts posts from each (131 and 95)
   - [x] The informational fallback line is logged for the profile surface: `fetch: https://www.threads.com/@hiresflow has no Recent tab — the URL selects its own view`. The search URL surface instead found an `aria-label="Recent"` filter control and clicked it, so it took the Recent-tab branch and still extracted 95 post(s) — non-failing either way.
   - [x] Actions dispatch with the secret seeded: all five surfaces return posts from datacenter IPs, including the profile and the search URL

Outstanding — each needs a credential, a match, or a platform this environment does not have:

1. Phase 7 — match-dependent paths (no run has ever found a match):
   - [ ] With `GMAIL_*` seeded, a dispatch that finds matches delivers the plain-text digest; an immediate second dispatch logs `no new matches`
   - [ ] State commit appears authored by `github-actions[bot]` with message `state: N new seen post ids`, only on match runs. Every run to date has logged `state unchanged; nothing to commit`, and `git log origin/main -- state/seen-posts.json` shows only the initial commit.
   - [ ] The state-commit push spawns no new workflow run. Indirect evidence only: the `b050436` push to `main` spawned no run (the workflow triggers on `schedule` and `workflow_dispatch` alone), but a `github-actions[bot]` state-commit push has never occurred to test directly.
   - [ ] README quick-start works top-to-bottom on a fresh clone
   - [ ] Seed a match to exercise the digest and commit-back paths. Attempted on `c64c427`: the widened keywords surfaced 3 maybes and the judge rejected all 3. The 08:06 Phase 10 run surfaced 1 maybe from 349 recent posts and the judge rejected it.
2. Phase 9 — email delivery details (needs inbox access):
   - [ ] With a match, the run sends the job digest and **not** the heartbeat
   - [ ] The heartbeat email arrives in the inbox, not in spam, at the chosen cadence. The log confirms delivery; only the recipient can confirm the folder.
3. Phase 10 — fresh clone:
   - [ ] README quick-start still works top-to-bottom on a fresh clone

### Recommendations:

- The Phase 7 bot-detection smoke gate **passed** on run `40175344238` (commit `b050436`): all five surfaces returned posts from datacenter IPs and the run finished green. Threads does not block Actions runner IPs, so the D2 hardening question is settled and the design is not invalidated.
- Confirm the failing-run exit code on `ubuntu-latest`. The Windows libuv assertion recorded under Potential Issues does not affect the Actions path, but a 127 instead of a 1 would change how a failed dispatch reads in the Actions UI.
- The feed is still empty of dev-term posts, now measured at scale. The 08:06 run pulled 504 unique posts across 5 surfaces, kept 349 within 72h, and the keyword filter found **1 maybe** — which the judge rejected. The two URL surfaces raised the volume (288 → 504 unique posts) without raising the hit rate. The heartbeat's 10 candidates per run are the operator's only signal until a surface carrying Indonesian frontend or fullstack openings is found.
- The `github-actions[bot]` state commit has still never fired, because no run has found a match. Digest delivery, the state commit and the no-new-run check remain the only untested paths, and all three need a match first.
- Ready to commit — Phase 10 was committed as `b050436` and pushed to `origin/main` during this validation. The working tree is clean.
