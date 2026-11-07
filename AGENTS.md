# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

loker-watcher watches Indonesian job-hunting surfaces on Threads and
LinkedIn. A scheduled
GitHub Actions workflow loads the surfaces listed in `watcher.config.json`,
asks an OpenAI-compatible LLM judge to keep posts matching the configured
keywords, and emails new matches as a plain-text digest.
LinkedIn posts come from an always-on loop on the developer's PC (`npm run
watch-linkedin`), which fetches the voyager search API and pushes
`state/linkedin-posts.json`; the hosted run reads that payload.
Committed state is three files, one writer each: `state/seen-posts.json`
(committed back by the workflow after match runs),
`state/judge-ceilings.json` (probe-measured judge ceilings, committed by
the probe job), and `state/judge-health.json` (per-account provider
health, written by the watch run's flush — success path and the
best-effort exhaustion catch — and committed back by the watch job: the
Commit state step on the success path, the Commit health step on the
failure path).

## Commands

- `npm test` - unit tests (node:test runner via tsx, offline and deterministic)
- `npm run typecheck` - `tsc --noEmit` over `src/`, `tests/`, and `scripts/`
- `npx tsx scripts/probe-judge.ts` - measure how long the LLM endpoint takes to answer, ramp concurrent calls to find each account's ceiling, and write `state/judge-ceilings.json` (the probe job commits it; needs `LLM_*` env vars)
- `npm run lint` - Biome check over `src/`, `tests/`, `scripts/probe-judge.ts`, `scripts/fetch-linkedin.ts`, `scripts/watch-linkedin.ts`, `scripts/probe-linkedin.ts`, `scripts/login-linkedin.ts`, and `scripts/hooks`
- `npm run format` - Biome format in place
- `npm start` - run the watcher locally (needs LLM_* and GMAIL_* env vars;
  an absent or stale `state/linkedin-posts.json` degrades to a
  threads-only run with one log line)
- `npm run probe-linkedin` - gate the LinkedIn transport: exit 1 on a dead,
  short, or faulted leg; run twice >=6h apart with stored cookies before
  trusting the loop (needs `LINKEDIN_COOKIES_FILE`)
- `npm run fetch-linkedin` - one LinkedIn fetch tick from a dedicated clone
  of main: exits 1 BEFORE any fetch on a mis-homed checkout (branch ≠ main
  or dirty tree), then fetch, write the payload, push that single path
  (leg-dead exits 1 after the episode alarm)
- `npm run watch-linkedin` - the always-on PC loop: one tick, then a
  10-minute sleep, forever; leg-dead sends ONE alarm per episode and the
  loop keeps running
- `npm run login-linkedin` - headed LinkedIn login helper: the operator
  logs in by hand in the opened window (2FA included); the helper writes
  the cookie file and the `LINKEDIN_COOKIES_FILE` line in `.env` (exit 1
  on timeout/no session; re-run on a still-signed-in profile harvests
  without a new login)
- `npm run setup-curl` - one-time curl-impersonate setup: downloads the
  checksum-pinned lexiforest binary (release-published sha256 digests)
  into gitignored `tools/curl-impersonate/` and writes the
  `CURL_IMPERSONATE_BIN` line in `.env`; any failure exits 1 naming both
  remedies (re-run setup-curl, or `LINKEDIN_TRANSPORT=playwright` in
  `.env`)
- `npx playwright install chromium` - one-time browser install for local runs

## Architecture

Pipeline entry point is `src/index.ts`:
fetch surfaces, dedupe posts, drop stale posts, drop seen posts, LLM judge
against the configured keywords, email digest, commit state.

- `src/fetch-threads.ts`, `src/threads-session.ts` - Playwright loading of tag,
  profile, and search surfaces; signed-in via `THREADS_SESSION_STATE` with a
  logged-out fallback
- `src/linkedin-voyager.ts` - pure voyager search client core: endpoint
  constants, restli encoding (# -> %23), the canonical search-URL builder,
  and the response parser (drop+count, never throws); timestamp derives
  from `BigInt(id) >> 22n`
- `src/linkedin-session.ts` - the `LINKEDIN_COOKIES_FILE` resolver
  (fail-visible; the cookie file lives OUTSIDE the repo), the Cookie
  header (JSESSIONID quoted, last), the csrf token, and the storageState
  synthesis for the Playwright transport
- `src/linkedin-fetch.ts` - the voyager fetch leg: curl-impersonate
  (`CURL_IMPERSONATE_BIN`) and Playwright transports behind one
  `VoyagerGet` seam (`LINKEDIN_TRANSPORT`, no auto-fallback), the §13.3
  fault classifier with the tagged `LegDeadError`, and the runPool surface
  walk under a shared 5s pacing gate
- `src/linkedin-payload.ts` - the atomic payload envelope writer/reader;
  reading never throws: absent -> quiet log, stale -> age log, malformed
  -> warn, bad rows -> drop+count
- `src/env-file.ts` - `.env` auto-load for the PC scripts: fills only
  unset keys, the real environment wins, a missing `.env` is a quiet no-op
- `scripts/fetch-linkedin.ts` - one tick: fetch -> payload -> add ONLY
  `state/linkedin-posts.json` -> commit -> pull --rebase -> push with one
  retry (mirrors `scripts/commit-state-rebase.sh`; leg-dead = ONE alarm per
  episode via a repo-local marker, then exit 1)
- `scripts/watch-linkedin.ts` - the always-on PC loop (tick + 600s sleep)
- `scripts/probe-linkedin.ts` - the transport gate probe (exit contracts:
  tick = leg-dead exits 1; loop = never exits on leg-dead; probe = gate
  exit 1)
- `scripts/login-linkedin.ts` - headed cookie harvest: the operator logs
  in by hand; the script polls the jar, writes the cookie file atomically,
  and upserts the `.env` line (exit 1 on timeout/no session; entry-guarded,
  importing stays side-effect free)
- `scripts/setup-curl-impersonate.ts` - one-command curl-impersonate
  setup: checksum-pinned lexiforest v2.3.2 download, OS-`tar` extraction
  into gitignored `tools/curl-impersonate/` (inner layout never assumed —
  the tree is walked for `curl-impersonate*.exe`), `.env` line upsert;
  every failure path names the playwright escape hatch (exit 1;
  entry-guarded)
- `src/extract.ts` - parses posts from graphql XHR responses or `data-sjs` blobs
- `src/recency.ts` - drops posts outside the `recencyHours` window
- `src/state.ts` - seen-post state; writes are atomic (temp file + rename)
- `src/judge.ts` - ~10-post bulk chat-completions calls judged against the
  keywords in `watcher.config.json`; accounts come from the `LLM_ACCOUNTS`
  pool (an HTTP 429 cools that account for 60s and dispatches re-scan past
  cooling accounts; when all are cooling, calls park up to a shared 180s
  wait budget before the pool converts to exhaustion; 5xx retries the same
  account with backoff; an exhausted pool throws a typed error that sends
  one alarm email and exits 1), dispatches spread across the pool — each
  starts at the next account and every account is capped at its
  probe-measured ceiling from `state/judge-ceilings.json` — so batches
  drain through a pool as wide as the ceilings sum; bulk misses fall back
  to single-post calls, and a batch the
  endpoint does not answer is deferred whole; returns
  `{relevant, locationOk}` per post
- `src/judge-rotation.ts` - account-pool rotation primitives: the cooldown
  + in-flight + ceilings state, the dispatch dial (claim/release, ceiling
  waiters), the tagged exhaustion error, and the park helper
- `src/judge-ceilings.ts` - the committed ceilings file reader
  (degrade-everything: absent or malformed `state/judge-ceilings.json`
  floors every account at ceiling 1 with one warning, never fails a run)
  and the probe's atomic writer
- `src/judge-health.ts` - the committed health file's reader/writer, the
  tick-flush (success + exhaustion), and the episode helpers
  (degrade-everything: absent or malformed `state/judge-health.json`
  reads as everything healthy, never fails a run)
- `src/judge-parse.ts` - verdict parsers for the judge's responses
  (single-post and bulk)
- `src/pool.ts` - shared bounded worker pool (`runPool`) used by the judge
  and by the surface fetches
- `src/email.ts` - nodemailer transport for the digest and the leg-dead
  alarm
- `src/heartbeat.ts` - zero-match status email so quiet runs stay legible
- `src/config.ts`, `src/config-file.ts` - `watcher.config.json` validation

## Conventions and non-negotiables

- Fail visible: missing or invalid config and state must exit nonzero with a
  message that names the problem. Never silently fall back to defaults.
- State writes stay atomic. A crashed run never leaves a partial state file.
- Keep the strict TypeScript flags on: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- Node >= 22, ESM (`"type": "module"`). Prefer `node:` prefixed imports.
- No new runtime dependency without a stated need in the PR description.
- Secrets live in GitHub Actions secrets only. Never commit credentials,
  browser storage state, or `.env` files.
- Tests use `node:test` + `tsx`. Keep them offline: mock transports, temp
  state files, fixtures under `tests/fixture/`.

## Before you call it done

1. Run `npm run typecheck`.
2. Run `npm run lint`.
3. Run `npm test`.
