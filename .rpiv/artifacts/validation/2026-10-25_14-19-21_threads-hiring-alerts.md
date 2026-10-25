---
date: 2026-10-25T14:19:21+0700
author: Yogiswara Utama
commit: 9e1c8ef
branch: main
repository: loker-watcher
topic: "Validation of Threads #hiring Indonesia job alerts — full v1 pipeline"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md"
tags: [validation, plan, threads, playwright, scraper, github-actions, email]
last_updated: 2026-10-25T14:19:21+0700
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

The Phase 9 delta is uncommitted in the working tree: `README.md`, `src/config.ts`, `src/email.ts`, `src/index.ts`, `tests/email.test.ts` modified; `src/heartbeat.ts` and `tests/heartbeat.test.ts` new. Phases 1–8 are committed at `9e1c8ef` and were re-verified against the shipped tree.

### Automated Verification Results

- ✓ Type checking: `npx tsc --noEmit` — exit 0, no errors
- ✓ Full suite: `npm test` — exit 0, 73/73 tests pass across 6 suites (extract, keywords, email, recency, session, heartbeat)
- ✓ Heartbeat suite: `npx tsx --test tests/heartbeat.test.ts` — exit 0, 20/20 pass
- ✓ Email suite: `npx tsx --test tests/email.test.ts` — exit 0, 15/15 pass (the `sendText` extraction breaks no locked digest consumer)
- ✓ Install: `npm install` — exit 0, no lockfile churn
- ✓ Reconciliation applied: `grep -c "failed to send digest" tests/email.test.ts` — returns 0
- ✓ Heartbeat fires on every zero-match exit: `grep -c "await heartbeat(" src/index.ts` — returns 3
- ✓ Heartbeat is best-effort: `grep -c "heartbeat: not sent" src/index.ts` — returns 1
- ✓ Kill switch wired: `grep -c "HEARTBEAT_ENABLED" src/config.ts` — returns 1
- ✓ Run URL wired: `grep -c "runUrlFromEnv" src/index.ts` — returns 2
- ✓ Digest path unchanged: `grep -c "sendDigest" src/index.ts` — returns 2
- ✓ Secret hygiene: `grep -rniE "password|api_key|sessionid" src tests .github README.md` — matches only env-var NAME constants, test fixture strings, and README placeholder mentions; no secret values
- ✓ Session never persisted: `grep -rn "storageState\|storage-state" state/` — returns 0
- ✓ Phase 8 revision greps: `RECENT_TAB_TIMEOUT_MS` (3), `MAX_DRY_SCROLL_ROUNDS` (5), `0 post(s) extracted` (1) in `src/fetch-threads.ts`
- ✓ Phase 8 config/workflow surface: `THREADS_SESSION_STATE` in `src/config.ts` (1) and `.github/workflows/watch.yml` (1); `DEFAULT_RECENCY_HOURS` (4); `RECENCY_HOURS` in the workflow (1); `fetchTagPages` in `src/index.ts` (2)
- ✓ Phase 7 workflow greps: `workflow_dispatch` (1), `cron: "*/10 * * * *"` (1), `github-actions[bot]` (2), `timeout-minutes: 10` (1), `concurrency:` (1), `actions/cache` (0), PAT grep (0)
- ✓ Lockfile committed: `git ls-files --error-unmatch package-lock.json` — exit 0
- ✓ Phase 5 inline criteria: seed-state validation, save-gating (`saved: false`, `addedCount: 0`), and write+diff probes all exit 0
- ✓ Phase 1/2/4/6 greps: `npm pkg get type` = `module`; `ThreadItemRaw` in `src/types.ts` = 0; `KEYWORDS` in `src/config.ts` = 1; `ENV_NAMES` = 4
- ✓ No regressions detected — the three criteria the plan left `- [ ]` (Phase 7 `npm test`, Phase 9 `npm test`, Phase 9 email regression) now pass

### Code Review Findings

#### Matches Plan:

- `src/email.ts:86` — `sendText(subject, text, config, transport?)` extracted exactly as fenced: shared transport construction, `from: Loker Watcher <user>`, and a catch that rethrows as `email: failed to send:`. `sendDigest` keeps its public shape and zero-post gate.
- `src/email.ts:124` — `sendDigest` delegates to `sendText` and attaches `messageId` through a conditional spread, so the return stays assignable under `exactOptionalPropertyTypes: true`.
- `src/config.ts:41` — `isHeartbeatEnabled` defaults to true and disables only on an explicit `"false"` (any casing, whitespace trimmed), matching the fence.
- `src/config.ts:53` — `runUrlFromEnv` builds the Actions run URL from `GITHUB_SERVER_URL` / `GITHUB_REPOSITORY` / `GITHUB_RUN_ID` and returns `undefined` when any is absent.
- `src/heartbeat.ts:76` — `selectCandidates` puts keyword maybes first, then near-misses newest first, capped at `MAX_CANDIDATES` (10), with no maybe repeated as a near-miss.
- `src/heartbeat.ts:120` — `buildHeartbeatBody` emits the funnel block, the numbered candidate list with age and `[keyword match]` tag, and the trailing `Run:` line only when `runUrl` is present.
- `src/heartbeat.ts:165` — `sendHeartbeat` takes `now` as a parameter and an optional `Transporter`, so tests never open a real Gmail connection.
- `src/index.ts:35` — the `heartbeat()` helper checks the kill switch first, then resolves credentials inside a `try`; any failure logs `heartbeat: not sent — …` and returns, so the run still exits 0.
- `src/index.ts:91`, `:100`, `:120` — the three zero-match exits (no unseen posts, 0 maybes, 0 relevant+located) each call `heartbeat()`. The match path at `:127` calls `sendDigest` only.
- `src/index.ts:98`, `:113`, `:114` — `stats.maybes`, `stats.relevantLocated`, and `stats.skipped` are assigned before the exit that reads them, so the funnel counts are correct at every call site.
- `src/index.ts:75` — `runUrl` is attached to `stats` through a conditional spread, keeping `exactOptionalPropertyTypes` satisfied on a local run.
- `tests/email.test.ts:262` — the single fail-visible assertion now matches `/email: failed to send: SMTP connection timeout/`. Every other assertion in the file is untouched.
- `README.md` — `## Pipeline` step 7 reads "are emailed as the job digest", step 9 documents the zero-match status digest, the `## Smoke run` re-run bullet reads "sends the status digest", and `HEARTBEAT_ENABLED` joins the optional-variables line. All three statements Phase 9 invalidated were replaced, not appended to.
- Phase 8's session-suite criterion reads "(6 tests)", matching the shipped suite's six `it()` blocks.

#### Deviations from Plan:

- **Invocation metadata is mis-bound to this working tree.** The Metadata block names repository `pi-model-router` and commit `dbf8b208`; neither exists here (`git cat-file -t dbf8b208` fails). The live tree is repository `loker-watcher` at commit `9e1c8ef` on branch `main`. The plan's own Developer Context section recorded this same mismatch at plan time, when no git repository existed yet. This report carries the live values. Non-blocking — a metadata binding issue, not an implementation gap.
- **Phase 9 §5 test fence, `sendHeartbeat` transport capture.** The fence declares `let captured: { subject: string; text: string } | null = null;` and asserts on `captured.subject` / `captured.text` directly. The shipped test declares `let captured: unknown = null;` and narrows with `const mail = captured as { subject: string; text: string };` before the same assertions. Functionally identical and type-safe under `strict`. Acceptable variation, not a gap.

#### Pattern Conformance:

- ✓ `src/heartbeat.ts` follows the established sibling shape: a module docstring that states the measured reason the module exists, `import type` for type-only imports, exported functions with one-line JSDoc, `readonly` array parameters, and `now` injected as a parameter for determinism — the same conventions as `src/recency.ts`, `src/keywords.ts`, and `src/email.ts`.
- ✓ `tests/heartbeat.test.ts` mirrors the existing suites: `node:assert/strict`, `node:test` `describe`/`it`, a module-level `NOW` constant and a `post()` factory for deterministic timestamps, and a mock `Transporter` cast through `as unknown as Transporter` — the same pattern `tests/email.test.ts` uses.
- ✓ `src/index.ts` keeps the pipeline's fail-visible contract: the digest path throws and exits non-zero, while the heartbeat path catches and warns. The asymmetry is deliberate and documented in both the plan and the helper's docstring.
- Minor observation: `selectCandidates` orders near-misses with `b.timestamp.localeCompare(a.timestamp)`. Correct, because `Post.timestamp` is always `new Date(...).toISOString()` output, which sorts lexicographically in chronological order. Acceptable variation, not a deviation.

#### Potential Issues:

- **`npm audit` reports 1 high-severity advisory set against `nodemailer`.** Installed version is `6.10.1`, inside the plan's declared `^6.9.16` range and byte-identical to the version at `HEAD`. The advisories (SMTP command injection, header injection, addressparser DoS) are pre-existing at base — declared in Phase 1 and untouched by the Phase 9 delta. Non-blocking for this validation. The fix `npm audit fix --force` proposes `nodemailer@10.2.1`, a major-version jump outside the plan's pinned range, so it belongs in a separate dependency-bump change rather than in this run.
- **The heartbeat at the `*/10` cron is 144 emails a day.** The plan documents this and ships `HEARTBEAT_ENABLED=false` as the valve. Not a defect — an operator cadence choice, now verified to work.
- **Phase 7's digest, state-commit, and no-new-run paths have never executed.** The only Actions run to date logged `keywords: 0 maybes` and `state unchanged; nothing to commit`. The plan records this in its Phase 7 manual criteria. Not a code gap; unexercised runtime behavior.

### Manual Testing Required:

Executed during this validation run (2026-10-25, live logged-out fetch from this machine):

1. Phase 9 — heartbeat is best-effort:
   - [x] With `GMAIL_USER` / `GMAIL_APP_PASSWORD` unset, a zero-match run logs `heartbeat: not sent — email: missing required environment variables: GMAIL_USER, GMAIL_APP_PASSWORD` and exits 0
   - [x] With `HEARTBEAT_ENABLED=false`, a zero-match run logs `heartbeat: disabled by HEARTBEAT_ENABLED`, sends nothing, and exits 0
   - [x] The heartbeat email renders correctly end to end — subject `loker-watcher: 0 new matches — 303 post(s) scanned`, body carrying the funnel (`337 unique post(s)`, `303 within 72h`, `1 keyword maybe(s)`, `0 relevant + located`, `0 skipped by the judge`), four candidates newest-first with the keyword maybe tagged `[keyword match]`, each with author, age, collapsed snippet and permalink, and the trailing `Run:` URL
   - [x] `state/seen-posts.json` stays byte-identical across two zero-match runs — the match-gated write (FRD #9, D8) holds
2. Phase 8 — logged-out regression re-verified live:
   - [x] With the session secret unset, the run takes the logged-out path: `extract: tag/hiring: 19 post(s)`, `tag/lowker: 22`, `tag/infokerja: 18`, `59 unique post(s) across 3 surface(s)`, `recency: 5 post(s) within 72h`

Still open — homework for the human, none of it blocking:

3. Phase 7 — smoke gate and match paths:
   - [ ] Push to the public repo and trigger `workflow_dispatch`; confirm per-surface post counts > 0 and a green run (bot-detection gate)
   - [ ] With `GMAIL_*` seeded, a dispatch that finds matches delivers the plain-text digest (numbered posts + permalinks)
   - [ ] The state commit appears authored by `github-actions[bot]` with message `state: N new seen post ids`, only on match runs
   - [ ] The state-commit push spawns no new workflow run
   - [ ] Seed a match (point `THREADS_TAGS` at a tag carrying a frontend/fullstack posting, or temporarily widen `KEYWORDS`), confirm the digest arrives, then revert
4. Phase 8 — authenticated path:
   - [ ] With `THREADS_SESSION_STATE` seeded, a local run logs `fetch: /tag/<tag> OK — N post(s) from M XHR response(s)` per surface with counts well above the logged-out ~19 (probe floor: 68 on `/tag/hiring`)
   - [ ] The run logs at least one `fetch: /tag/<tag> scroll N: +M` line with `M` ≥ 2
   - [ ] The recency log line shows the kept count
   - [ ] Actions dispatch with the secret seeded: Recent-tab counts > 0 from datacenter IPs
5. Phase 9 — real delivery:
   - [ ] With `GMAIL_*` seeded and no match, the heartbeat email arrives with the expected subject and body
   - [ ] Every candidate permalink in the heartbeat resolves to a real threads.com post
   - [ ] With a match, the run sends the job digest and not the heartbeat
   - [ ] The heartbeat email arrives in the inbox, not in spam, at the chosen cadence

### Recommendations:

- Ready to commit — implementation is complete and validated. All 73 tests pass, typecheck is clean, and every automated criterion in all nine phases holds.
- Commit the Phase 9 delta as one atomic change: `src/heartbeat.ts` and `tests/heartbeat.test.ts` are new, and the five modified files are the `sendText` extraction, the heartbeat wiring, the kill switch and run-URL resolvers, the README corrections, and the one reconciled test assertion.
- Before or alongside that commit, decide on the `nodemailer` advisory. The safe path is a separate dependency-bump change that moves to `nodemailer@10.x` and re-runs the email suite; folding a major-version jump into this commit would mix an unrelated risk into a validated delta.
- Run the Phase 7 and Phase 8 smoke gates on the next Actions dispatch — they are the only criteria that exercise the digest, the `github-actions[bot]` state commit, and the authenticated fetch, and none of the three has ever run.
