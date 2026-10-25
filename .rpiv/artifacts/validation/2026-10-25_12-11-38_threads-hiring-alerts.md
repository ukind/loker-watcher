---
template_version: 1
date: 2026-10-25T12:11:38+0700
author: Yogiswara Utama
commit: no-commit
branch: main
repository: loker-watcher
topic: "Validation of Threads #hiring Indonesia job alerts — full v1 pipeline"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md"
tags: [validation, threads, playwright, scraper, github-actions, email]
last_updated: 2026-10-25T12:11:38+0700
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

### Automated Verification Results

- ✓ Type checking: `npx tsc --noEmit` — exit 0
- ✓ Full suite: `npm test` — 41/41 pass (8 extract + 18 keywords + 15 email)
- ✓ Per-phase suites: `tests/extract.test.ts`, `tests/keywords.test.ts`, `tests/email.test.ts` — all exit 0
- ✓ Manifest: `npm pkg get type` — "module"; `npm install` / `npm ci` — exit 0, lockfile in sync
- ✓ Lockfile committed: `git ls-files --error-unmatch package-lock.json` — exit 0
- ✓ Phase 2 greps: `ThreadItemRaw` in src/types.ts = 0; `DevQHRdD4Bm` in fixture = 1
- ✓ Phase 3 greps: `SEARCH_SURFACES|SEARCH_QUERY` in src = 0; `THREADS_TAGS` in config = 2; `stealth` in fetch-threads.ts = 0
- ✓ Phase 4/6 greps: `KEYWORDS` = 1, `ENV_NAMES` = 2 in src/config.ts
- ✓ Phase 5 inline checks: seed-state validation, save-gating, diff/atomic-write one-liners — all exit 0
- ✓ Phase 7 workflow greps: `workflow_dispatch` = 1, cron = 1, `github-actions[bot]` = 2, PAT/`pat_` = 0, `timeout-minutes: 10` = 1, `concurrency:` = 1, `actions/cache` = 0
- ✓ Secret hygiene (`grep -rniE "password|api_key"` over src, tests, .github, README.md): matches are env-var NAME constants, test fixture strings, and README placeholders only — no secret values
- ✓ Drift sweep (`SEARCH_SURFACES|SEARCH_QUERY|ThreadItemRaw|stealth` outside node_modules): zero hits in src, tests, README, .github — retired terms survive only in .rpiv design/plan artifacts, where their retirement is documented
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- src/types.ts, src/config.ts — ship in final form per the Step 3 provenance decision (D11 tag surfaces, D12 ThreadItemRaw retirement); both match the plan's code blocks verbatim
- src/extract.ts — generic `thread_items` walk, `.post` narrowing, pk→code fallback via `codeFromPk`, drop-and-count for malformed items: matches the plan block verbatim
- src/fetch-threads.ts — matches the plan block including the Plan Review row-2 fix: `context.addInitScript` is a string expression, so `navigator` never enters the Node type scope (tsc exit 0 confirms)
- src/keywords.ts, src/judge.ts — match verbatim; judge retries once per post, skips on double failure, `parseVerdict` tolerates fences and surrounding prose
- src/state.ts — match verbatim; atomic temp+rename write, match-gated `saveState`, version-1 migration validation
- src/email.ts — match verbatim; zero-match no-send gate, plain-text digest, fail-visible transport errors
- src/index.ts — pipeline order fetch → extract → dedupe → keywords → judge → filter → email → state, with the email-before-state ordering that keeps a failed send from marking posts seen (D3/D8)
- tests/extract.test.ts, tests/keywords.test.ts, tests/email.test.ts — match the plan blocks (keywords test carries the row-6 fix: unused `KEYWORDS` import dropped)
- .github/workflows/watch.yml — matches the plan block: cron + workflow_dispatch, `contents: write`, concurrency guard, `timeout-minutes: 10`, no PAT in the commit-back path, no `actions/cache`
- README.md — matches the plan block, including the public-repo rationale and the smoke-run expectations
- state/seen-posts.json — `version: 1`, empty `seenPostIds`, 2-space indent, trailing newline

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ Greenfield repo: all 9 src modules and 3 test files follow one shape — file-header JSDoc citing FRD/D references, named exports, `.js` import specifiers under NodeNext, `interface` contracts per module, `node:test` + `assert/strict`
- ✓ Mock patterns are consistent across suites: `mockFetch as unknown as typeof fetch` (keywords.test.ts) and `mockTransport as unknown as Transporter` (email.test.ts) — same cast idiom, same arrangement
- ✓ Log-line vocabulary is uniform across stages (`fetch:`, `extract:`, `keywords:`, `judge:`, `state:`, `email:`, `watch: FAILED —`), matching the plan's Desired End State examples
- Minor observation: `src/index.ts` dedupes across surfaces inline while `extractPosts` also dedupes within one page — acceptable variation, not a deviation (cross-surface dedupe has no home in extract's per-page contract)

#### Potential Issues:

- **No `.gitignore` in the repo (plan-level gap).** `node_modules/`, `.rpiv/`, and `.pi/` are untracked-and-unignored; a `git add -A` at first push would commit all of them. No plan phase declares a `.gitignore` and no criterion checks for one, so this does not block this validation — but add one before the first push (see Recommendations).
- **Leftover implement-session scratch: `temp_test_runner.mjs` (repo root, untracked, ~10 KB).** Materializes test code into an OS temp dir and runs it — implement-phase scratch that belongs under `.rpiv/tmp/` or deleted. Not staged, so the commit itself is clean; delete before pushing.
- **`npm audit`: 1 high-severity advisory set in nodemailer 6.x** (addressparser DoS family plus an OAuth2 token-fetch TLS validation issue). Practical exposure here is nil: the app authenticates with a Gmail app password (not OAuth2) and sends to one fixed internal recipient, so the vulnerable parsers never see untrusted input. The fix is a breaking major (`nodemailer@10.2.1`); schedule the bump as its own change rather than amending this plan.
- **`jq` is not installed on this Windows workstation.** The workflow's commit-back step uses `jq`; GitHub's `ubuntu-latest` runners ship it preinstalled, so no action — noted so a local dry-run of that step is not misread as a defect.
- **Live-feed data condition (not a defect):** the 2026-10-25 live feed (58 unique posts across the three tag pages) contains zero default-keyword matches, so production runs currently log `keywords: 0 maybes` → `no new matches` and exit 0 without calling the judge. Extraction and the keyword filter are both behaving correctly on real data (verified post-by-post); expect silent runs until a frontend/fullstack post appears.

### Manual Testing Required:

Executed this run (user requested manual testing be performed, not just listed):

1. **Bot-detection smoke gate (local equivalent):** live Playwright fetch of all three tag pages — `/tag/hiring` 19 posts, `/tag/lowker` 21, `/tag/infokerja` 18; 58 unique after cross-surface dedupe. No bot blocking from a residential IP. The Actions-runner half of this gate still needs the real dispatch.
2. **Real LLM judge (live credentials, z.ai `glm-5.3-flash`):** 3 live maybe-posts judged with 0 skips — IT Service Desk post (Tangerang) → `relevant:false, locationOk:true`; platform-intro post → `false/false`; job-seeker post → `false/false`. Synthetic positive ("Frontend React Developer, Next.js/TypeScript, Jakarta hybrid") → `relevant:true, locationOk:true`. Endpoint, auth, model, and verdict parsing all work against the real API.
3. **Digest format:** full pipeline run with a mock SMTP transport captured a 46-post digest — subject `46 new job posts on Threads (#hiring indonesia)`, numbered entries, `— @author`, permalink on its own line, double-newline separation, multi-line captions preserved. pk-derived permalinks (e.g. `@meyyah.ah/post/DdtDJfXEUdw`) match the values the extract tests assert.
4. **No-match gating (FRD #9 / D8):** second run over the same state logged `no new matches`, sent nothing, and left the state file byte-identical (sha256 before = after).
5. **Fail-visible (D8):** `npm start` against a corrupted state file exited 1 with `watch: FAILED — state: failed to load state from state/seen-posts.json: …`; the state file was restored and verified untouched.
6. **Production entry point with real credentials:** `npm start` with `LLM_*` set ran the full fetch/extract path and exited 0 with `no new matches`; repo state file unchanged.
7. **Commit-back gating (scratch-repo simulation of the workflow step):** unchanged state → `git diff --cached --quiet` takes the "nothing to commit" path; changed state → commit `state: 2 new seen post ids` authored `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`.
8. **Keyword rejection (Phase 4 manual):** `matchesKeywords` returns false for every fixture post, including the Barista, VA, and Safety Officer captions.
9. **README quick-start (partial):** `npm install`, `npm ci`, and `npx playwright install chromium` all succeed on this machine; the fresh-clone half needs a second checkout.

Remaining for the human — these need the pushed public repo and seeded Actions secrets, and cannot run in this environment:

- [ ] Push as a public repo, trigger **Actions → watch → Run workflow**, and confirm per-surface post counts > 0 with a green run (the Actions-IP half of the bot-detection gate)
- [ ] With `GMAIL_*` secrets seeded, confirm a match run delivers the plain-text digest and an immediate second dispatch sends nothing and logs `no new matches`
- [ ] Confirm the state commit appears as `github-actions[bot]` with message `state: N new seen post ids`, only on match runs
- [ ] Confirm the state-commit push spawns no new workflow run (Actions tab shows no run started by that commit)
- [ ] README quick-start top-to-bottom on a fresh clone

### Recommendations:

- Delete the leftover scratch before the first push: `rm temp_test_runner.mjs`
- Add a `.gitignore` (`node_modules/`, `.rpiv/`, `.pi/`) before the first push — the plan never declared one and `git add -A` would otherwise commit `node_modules`
- Rotate the z.ai API key used for this validation — it was pasted into chat and passed inline on the command line
- Schedule the nodemailer 6 → 10 major bump as its own change; no exposure in this app's usage
- Ready to commit — implementation is complete and validated. Run the five remaining GitHub-side manual items after the first push.
