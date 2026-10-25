---
template_version: 1
date: 2026-10-25T14:08:52+0700
author: Yogiswara Utama
commit: 9e1c8ef9b4613e0e2937e8eeecdcb6dc90017a8d
branch: main
repository: loker-watcher
topic: "Validation of Threads #hiring Indonesia job alerts — full v1 pipeline"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md"
tags: [validation, plan, threads, playwright, scraper, github-actions, email]
blockers:
  - id: b1
    command: npm test
    file: src/email.ts
    line: 113
last_updated: 2026-10-25T14:08:52+0700
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
- ✓ Phase 8: Authenticated fetch + recency — Fully implemented (verified end to end in the 2026-10-25T13:24:25 validation: local authenticated run, deterministic A/B harness, and Actions run `40169993107`)
- ✗ Phase 9: No-match heartbeat — Implemented as written, but the plan's own **Reconciliation** step was not applied, so `npm test` fails. See Deviations from Plan.

### Automated Verification Results

- ✗ Full suite: `npm test` — **exit 1**, 72 of 73 tests pass, 1 fails at `tests/email.test.ts:262`
- ✗ Email regression: `npx tsx --test tests/email.test.ts` — **exit 1**, 14 of 15 pass; `throws fail-visible error when transport fails` asserts `/email: failed to send digest: SMTP connection timeout/` but the shipped code throws `email: failed to send: SMTP connection timeout`
- ✓ Heartbeat suite: `npx tsx --test tests/heartbeat.test.ts` — exit 0, 20 tests pass
- ✓ Recency suite: `npx tsx --test tests/recency.test.ts` — exit 0, 5 tests pass
- ✓ Session suite: `npx tsx --test tests/session.test.ts` — exit 0, 6 tests pass
- ✓ Extract suite (incl. graphql XHR fixture): `npx tsx --test tests/extract.test.ts` — exit 0, 9 tests pass
- ✓ Keywords suite: `npx tsx --test tests/keywords.test.ts` — exit 0, 18 tests pass
- ✓ Type checking: `npx tsc --noEmit` — exit 0, no errors
- ✓ `npm install` — exit 0, `node_modules` present
- ✓ `npm pkg get type` — `"module"`
- ✓ Seed state validates: `node --input-type=module -e '…'` — exit 0
- ✓ Save-gating: `npx tsx --input-type=module -e '…'` — exit 0, `saved: false` on empty input
- ✓ Atomic write and diff: `npx tsx --input-type=module -e '…'` — exit 0
- ✓ Lockfile committed: `git ls-files --error-unmatch package-lock.json` — exit 0
- ✓ `ThreadItemRaw` retired: `grep -c "ThreadItemRaw" src/types.ts` — 0
- ✓ Config exports preserved: `KEYWORDS` — 1, `ENV_NAMES` — 4
- ✓ Phase 8 config surface: `THREADS_SESSION_STATE` — 1, `DEFAULT_RECENCY_HOURS` — 4
- ✓ Phase 8 workflow wiring: `THREADS_SESSION_STATE` — 1, `RECENCY_HOURS` — 1
- ✓ Session never persisted: `grep -rn "storageState\|storage-state" state/` — 0 matches
- ✓ Logged-out fallback intact: `grep -c "fetchTagPages" src/index.ts` — 2
- ✓ Recent-tab wait present: `grep -c "RECENT_TAB_TIMEOUT_MS" src/fetch-threads.ts` — 3
- ✓ Consecutive-dry-round stop present: `grep -c "MAX_DRY_SCROLL_ROUNDS" src/fetch-threads.ts` — 5
- ✓ Zero-post surfaces named in the all-fail error: `grep -c "0 post(s) extracted" src/fetch-threads.ts` — 1
- ✓ Workflow triggers: `workflow_dispatch` — 1; `cron: "*/10 * * * *"` — 1
- ✓ Bot commit-back: `github-actions[bot]` — 2 occurrences; commit step gated on a non-empty staged diff
- ✓ No PAT in commit-back path: `grep -ci "personal.access.token\|pat_"` — 0
- ✓ D9 timeout: `timeout-minutes: 10` — 1
- ✓ Overlap guard: `concurrency:` — 1
- ✓ No browser caching: `grep -c "actions/cache"` — 0
- ✓ Digest path unchanged: `grep -c "sendDigest" src/index.ts` — 2
- ✓ Heartbeat fires on every zero-match exit: `grep -c "await heartbeat(" src/index.ts` — 3
- ✓ Heartbeat is best-effort: `grep -c "heartbeat: not sent" src/index.ts` — 1
- ✓ Kill switch wired: `grep -c "HEARTBEAT_ENABLED" src/config.ts` — 1
- ✓ Run URL wired: `grep -c "runUrlFromEnv" src/index.ts` — 2
- ✓ Secret hygiene: `grep -rniE "password|api_key|sessionid" src tests .github README.md` — matches only env-var NAME constants, test fixture strings (`"test-key"`, `"app-password"`, `"pass"`, `"abcd efgh ijkl mnop"`, `"x"`), and README placeholder mentions. No secret values.
- ✓ No regressions in Phases 1–8: every criterion that passed at commit `9e1c8ef` still passes against the working tree

### Code Review Findings

#### Matches Plan:

- `src/config.ts:22-66` — `ENV_NAMES` gains `heartbeat: "HEARTBEAT_ENABLED"`; `isHeartbeatEnabled` and `runUrlFromEnv` are verbatim realizations of the Phase 9 fence, including the default-true kill switch and the three-variable guard that returns `undefined` on a local run.
- `src/email.ts:80-115` — `sendText` is the exact extraction the fence specifies: shared transport construction, shared credential use, `string | undefined` return, and a catch that rethrows as `email: failed to send: ${message}`.
- `src/email.ts:124-152` — `sendDigest` keeps its public shape and zero-post gate, delegates to `sendText`, and attaches `messageId` through a conditional spread so it stays assignable under `exactOptionalPropertyTypes: true`.
- `src/heartbeat.ts` — the whole module matches its fence: `CANDIDATE_TERMS` (adjacent dev terms, Indonesian cities, remote), `MAX_CANDIDATES = 10`, `HeartbeatStats` / `Candidate` contracts, `matchesCandidateTerms`, `selectCandidates` (maybes first, near-misses newest-first, capped), `snippet`, `ageHours`, `buildHeartbeatSubject`, `buildHeartbeatBody`, and `sendHeartbeat` with the optional `Transporter` parameter.
- `src/index.ts:29-52` — the `heartbeat()` helper is the fence's best-effort wrapper: kill-switch check first, then a `try` around credential resolution, candidate selection and send, with `console.warn(\`heartbeat: not sent — ${message}\`)` on any failure and no rethrow.
- `src/index.ts:66-121` — `HeartbeatStats` is assembled once with the `runUrl` conditional spread, `stats.maybes` / `stats.relevantLocated` / `stats.skipped` are filled as the pipeline runs, and `await heartbeat(...)` appears at exactly the three zero-match exits (no unseen posts, 0 maybes, 0 relevant+located). The match path calls `sendDigest` then `saveState` and never touches the heartbeat.
- `tests/heartbeat.test.ts` — matches its fence test-for-test (20 tests across `matchesCandidateTerms`, `selectCandidates`, `snippet`, `ageHours`, `buildHeartbeatSubject`, `buildHeartbeatBody`, `sendHeartbeat`).
- `README.md` — `## Pipeline` gains step 9, the optional-variable line gains `HEARTBEAT_ENABLED`, and `## Smoke run` gains the status-digest bullet, all verbatim from the fence.
- `src/fetch-threads.ts`, `src/recency.ts`, `src/threads-session.ts`, `src/extract.ts`, `.github/workflows/watch.yml`, `state/seen-posts.json` — byte-unchanged from commit `9e1c8ef`, which the 2026-10-25T13:24:25 validation verified end to end.

#### Deviations from Plan:

- **`tests/email.test.ts:262` — the plan's Phase 9 Reconciliation was not applied. Blocking.** The plan's Phase 9 `### Reconciliation` section states verbatim: "replace `/email: failed to send digest: SMTP connection timeout/` → `/email: failed to send: SMTP connection timeout/` — Phase 9 extracts the transport into `sendText`, whose catch rethrows as `email: failed to send:`, so the Phase 6 fail-visible assertion no longer matches". The shipped test still asserts the Phase 6 string, so `throws fail-visible error when transport fails` fails and takes `npm test` with it. This single omission breaks three criteria: Phase 7's `Full suite passes: npm test exits 0`, Phase 9's `Full suite passes: npm test exits 0`, and Phase 9's `Email regression: npx tsx --test tests/email.test.ts exits 0`.
- **Attribution proof — the failure is the run's own, not pre-existing debt.** `tests/email.test.ts` is byte-identical to `HEAD` (it is not in the working-tree delta), which would normally invite a pre-existing-debt downgrade. It does not apply here: swapping `HEAD:src/email.ts` back in makes the same test pass 15/15, and the working tree's `src/email.ts` — which **is** in the delta — is what changed the thrown message. The suite passed at commit `9e1c8ef` (53 tests, recorded in the 2026-10-25T13:24:25 validation); Phase 9 broke it. The criterion blocks as written.
- **Plan bookkeeping — three checkboxes left unchecked, consistent with the failure.** Phase 7's `Full suite passes: npm test exits 0`, Phase 9's `Full suite passes: npm test exits 0`, and Phase 9's `Email regression` all still read `- [ ]`. The commands were expected to pass; they do not. Comment-only relative to the code, but the checkboxes are now accurate rather than stale.
- **Plan criterion text drift — Phase 8 session-suite count.** Phase 8 reads "`npx tsx --test tests/session.test.ts` exits 0 (7 tests)". The shipped suite — matching the plan's own fence — contains 6 `it()` blocks and passes. The command passes; only the parenthetical is wrong. Comment-only.
- **README `## Pipeline` step 7 now contradicts step 9.** Step 7 reads "New relevant + located posts are emailed; zero-match runs send nothing" while step 9 reads "**Zero-match runs email a status digest instead**". Both lines are verbatim from the plan's Phase 9 fence, so the implementation is faithful and the contradiction is the plan's. Comment-only.
- **README `## Smoke run` bullet now untrue.** "An immediate re-run logs `no new matches` and sends nothing" — a re-run with no match now sends the heartbeat. Also verbatim from the fence. Comment-only.

#### Pattern Conformance:

- ✓ `src/heartbeat.ts` follows the conventions its siblings established: a module docstring citing the driving measurement, exported pure functions that take `now` as a parameter for determinism, `import type` for type-only imports, `.js` specifiers on relative imports, and `console.log` for the success path.
- ✓ `tests/heartbeat.test.ts` follows the fixture-free, table-driven style of `tests/keywords.test.ts` and `tests/recency.test.ts`: `node:assert/strict` + `node:test` `describe`/`it`, a module-level `NOW` constant, and a local `post()` factory.
- ✓ `src/config.ts` additions mirror `resolveTags` / `resolveRecencyHours`: same `Record<string, string | undefined>` parameter, same fallback-on-blank shape, same `ENV_NAMES` indirection instead of literal strings.
- ✓ `src/index.ts`'s `heartbeat()` helper matches the module's existing error style — `error instanceof Error ? error.message : String(error)` — used identically by `main().catch`.
- Acceptable variation, not a deviation: `src/index.ts:14` imports the four config helpers on one 98-character line while every other import in the file is multi-line. Long lines are common across this codebase (`src/judge.ts` reaches 143 characters), so this is consistent with the project's actual style rather than a divergence.

#### Potential Issues:

- `README.md:19` and `README.md:64` — the two statements above are now untrue for any operator reading the docs. The fix is one word each ("send nothing" → "send a status digest"), but it is a plan-fence edit, so it belongs in `/skill:revise` rather than an in-place code fix. Comment-only; no executable line changes.
- `src/threads-session.ts:59-62` — `resolveSession` writes the decoded storageState to a fresh `mkdtemp` directory and never removes it. Every run leaves an account-equivalent session document in the OS temp folder. Bounded on an Actions runner (the whole filesystem is discarded); accumulates on a developer machine. Carried forward unchanged from the 2026-10-25T13:24:25 validation; not a plan deviation.
- **The heartbeat has never been sent from a real run.** The working tree carrying Phase 9 is uncommitted and unpushed; the last Actions run (`40169993107`) executed commit `9e1c8ef`, before Phase 9 existed. Subject line, funnel counts, candidate list, permalink format and the `Run:` URL are all verified locally against the live feed (see Manual Testing Required §5), but delivery, inbox placement and spam behavior are unproven.
- **Cadence.** At the `*/10` cron the heartbeat is 144 emails a day. The plan records this as a knowing operator choice and `HEARTBEAT_ENABLED=false` is the documented valve, so this is a tuning question rather than a defect.
- Phase 7's digest-delivery, `github-actions[bot]` state-commit and no-new-run criteria remain unexercised: no run has yet produced a match. Two Actions runs logged `keywords: 0 maybes` and `keywords: 1 maybes, judge: 0 relevant+located`, both ending in `state unchanged; nothing to commit`.

### Manual Testing Required:

Executed during this validation run wherever the environment allowed. Phase 9 is the new surface, so the manual effort concentrated there; Phases 1–8 manual criteria were verified in the 2026-10-25T13:24:25 validation and re-confirmed where cheap.

1. Phase 8 — logged-out regression (secret unset):
   - [x] `npm start` with `THREADS_SESSION_STATE`, `GMAIL_*` and `LLM_*` unset — exit 0. `fetch: /tag/hiring OK`, `/tag/lowker OK`, `/tag/infokerja OK`; `extract: tag/hiring: 19 post(s)`, `tag/lowker: 21`, `tag/infokerja: 19`; `extract: 59 unique post(s) across 3 surface(s)`; `recency: 3 post(s) within 72h`; `state: 3 unseen post(s)`; `keywords: 0 maybes`; `no new matches`. Behaves exactly as Phases 1–7.
2. Phase 8 — invalid session fallback:
   - [x] `THREADS_SESSION_STATE="!!!not-base64!!!"` — logs `session: THREADS_SESSION_STATE is not valid base64 JSON — using the logged-out fetch`, then runs the logged-out path and exits 0.
   - [x] `THREADS_SESSION_STATE` = base64 of `{"cookies":[]}` — logs `session: THREADS_SESSION_STATE carries no cookies — using the logged-out fetch`, then runs the logged-out path and exits 0.
3. Phase 9 — best-effort behavior with no credentials:
   - [x] `GMAIL_USER` / `GMAIL_APP_PASSWORD` unset, zero-match run — logs `heartbeat: not sent — email: missing required environment variables: GMAIL_USER, GMAIL_APP_PASSWORD` and **exits 0**. The README quick-start keeps working.
4. Phase 9 — kill switch:
   - [x] `HEARTBEAT_ENABLED=false`, zero-match run — logs `heartbeat: disabled by HEARTBEAT_ENABLED`, sends nothing, exits 0.
5. Phase 9 — heartbeat email content, end to end against the live feed:
   - [x] A scratch driver under `.rpiv/tmp/` ran the real `fetchTagPages` → `extractPosts` → dedupe → `filterRecent` → `diffNew` → `filterPostsByKeywords` chain and built the heartbeat with the real `buildHeartbeatSubject` / `buildHeartbeatBody` / `selectCandidates`. Result:
     - Subject: `loker-watcher: 0 new matches — 3 post(s) scanned` — matches the plan's format.
     - Body funnel: `59 unique post(s)`, `3 within 72h`, `0 keyword maybe(s)`, `0 relevant + located`, `0 skipped by the judge`.
     - One candidate: `1. @remohires — 71h ago`, a collapsed text preview, and `https://www.threads.com/@remohires/post/Deyf8WXk601`.
     - `Run: https://github.com/…/actions/runs/…` appended when the ambient `GITHUB_*` variables are present.
   - [x] Every candidate permalink resolves — `curl -L` against `https://www.threads.com/@remohires/post/Deyf8WXk601` returned **HTTP 200**.
6. Phase 9 — digest and heartbeat are mutually exclusive:
   - [x] A scratch driver replicated `main()`'s branch structure with the real `judgePosts`, `sendDigest`, `selectCandidates` and `sendHeartbeat` (mock `fetch` and mock `Transporter`). Match arm (judge returns `{relevant: true, locationOk: true}`): sent **only** `1 new job post on Threads (#hiring indonesia)`, no heartbeat. Zero-match arm (judge returns `{relevant: false, locationOk: false}`): sent **only** `loker-watcher: 0 new matches — 4 post(s) scanned`, no digest.
7. Phase 9 — remaining criteria that need a real mailbox or a match:
   - [ ] The heartbeat email arrives in the inbox, not in spam, at the chosen cadence — needs `GMAIL_*` seeded on a pushed run.
   - [ ] A match run delivers the digest and not the heartbeat in production — needs a match to occur (see Phase 7 below).
8. Phase 7 — criteria still unexercised (no match has ever occurred):
   - [ ] Digest delivery with `GMAIL_*` seeded.
   - [ ] State commit authored by `github-actions[bot]` with message `state: N new seen post ids`.
   - [ ] The state-commit push spawns no new workflow run.
   - [ ] Seed a match to exercise the email and commit-back paths (temporarily widen `KEYWORDS`, dispatch, confirm, revert).
   - [x] Bot-detection smoke gate — verified in the 2026-10-25T13:24:25 validation: Actions run `40165612441` finished green in 44 s with per-surface counts > 0.
   - [x] README quick-start on a fresh clone — verified in the 2026-10-25T13:24:25 validation.
9. Phase 8 — authenticated fetch (verified in the 2026-10-25T13:24:25 validation, unchanged since):
   - [x] Local authenticated run: 105 / 110 / 73 posts per surface, 288 unique, `recency: 282 post(s) within 72h`, scroll lines with `M` ≥ 2 on every surface, two dry-round recoveries observed.
   - [x] Actions run `40169993107` from datacenter IPs: 123 / 114 / 100 posts per surface, 337 unique, `recency: 303 post(s) within 72h`, success in 2m16s.
   - [x] Deterministic A/B harness reproducing both timing races: control arm 0 posts, treatment arm 25 posts.

### Recommendations:

- **Apply the plan's own Reconciliation before anything else.** In `tests/email.test.ts:262`, change `/email: failed to send digest: SMTP connection timeout/` to `/email: failed to send: SMTP connection timeout/`. That single line clears blocker `b1` and all three failing criteria. Roughly 1 minute.
- Re-run `/skill:validate` after the fix. Expect `verdict: pass` — every other criterion in the plan passes, and the Phase 9 manual surface is verified end to end apart from real-mailbox delivery.
- Then `/skill:commit` the Phase 9 delta (`README.md`, `src/config.ts`, `src/email.ts`, `src/index.ts`, `src/heartbeat.ts`, `tests/heartbeat.test.ts`) as one commit, and dispatch the workflow once so the heartbeat is sent from a real run for the first time.
- Escalate to `/skill:revise` for the two README statements that Phase 9 invalidated (`## Pipeline` step 7 and the `## Smoke run` "sends nothing" bullet) plus the Phase 8 session-suite count parenthetical. All three are plan-fence text, so revise owns them; none blocks.
- Carried forward, still open: temp-directory cleanup for `resolveSession`, and the unproven digest / state-commit path until a match occurs.
