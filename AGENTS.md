# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

loker-watcher watches Indonesian job-hunting surfaces on Threads and
LinkedIn. A scheduled
GitHub Actions workflow loads the surfaces listed in `watcher.config.json`,
asks an OpenAI-compatible LLM judge to keep posts matching the configured
keywords, and emails new matches as a plain-text digest.
LinkedIn posts come from an always-on loop on the developer's PC (`npm run
watch-linkedin`), which walks the LinkedIn content-search page in a real
browser and pushes `state/linkedin-posts.json`; the hosted run reads that
payload.
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
- `npm run lint` - Biome check over `src/`, `tests/`, `scripts/probe-judge.ts`, `scripts/fetch-linkedin.ts`, `scripts/watch-linkedin.ts`, `scripts/probe-linkedin.ts`, `scripts/login-linkedin.ts`, `scripts/reset-linkedin.ts`, `scripts/linkedin-chain.ts`, `scripts/replay-linkedin.ts`, and `scripts/hooks`
- `npm run format` - Biome format in place
- `npm start` - run the watcher locally (needs LLM_* and GMAIL_* env vars;
  an absent or stale `state/linkedin-posts.json` degrades to a
  threads-only run with one log line)
- `npm run probe-linkedin` - gate the LinkedIn browser walk: a read-only
  walk of the first configured surface; exit 1 on a checkpoint wall
  (`probe: HALT`), a dead session (`probe: LEG DEAD`), a faulted walk
  (`probe: FAILED`), or fewer than 10 posts; run twice >=6h apart with
  stored cookies before trusting the loop (needs `LINKEDIN_COOKIES_FILE`)
- `npm run fetch-linkedin` - one LinkedIn fetch tick from a dedicated clone
  of main: exits 1 BEFORE any fetch on a mis-homed checkout (branch ≠ main
  or dirty tree), then fetch, write the payload, push that single path
  (leg-dead exits 1 after the episode alarm)
- `npm run watch-linkedin` - the always-on PC loop: one tick, then a
  28-33-minute sleep, forever; leg-dead sends ONE alarm per episode and
  the loop keeps running
- `npm run login-linkedin` - headed LinkedIn login helper: the operator
  logs in by hand in the opened window (2FA included); the helper writes
  the cookie file and the `LINKEDIN_COOKIES_FILE` line in `.env` (exit 1
  on timeout/no session; re-run on a still-signed-in profile harvests
  without a new login). Afterward the browser STAYS OPEN — press Enter in
  the terminal to close it, or pass `--auto-close` for fire-and-close
  (the feed-first rest keeps the session alive)
- `npm run linkedin-chain` - the one-command operator chain from a
  dedicated clone of main: login hold -> probe gate -> exactly one fetch
  tick, in that order; the login's harvested cookie file carries the
  later stages when `.env` has no cookie line yet; a quiet-zero tick
  (working-hours window, halt latch, halt trip, all-faulted walk, zero
  surfaces) is a reported no-op with exit 0; any stage failure exits 1
  naming the gate (needs a real TTY for the login hold)
- `npx playwright install chromium` - one-time browser install for local runs

## Architecture

Pipeline entry point is `src/index.ts`:
fetch surfaces, dedupe posts, drop stale posts, drop seen posts, LLM judge
against the configured keywords, email digest, commit state.

- `src/fetch-threads.ts`, `src/threads-session.ts` - Playwright loading of tag,
  profile, and search surfaces; signed-in via `THREADS_SESSION_STATE` with a
  logged-out fallback
- `src/linkedin-parser.ts` - pure Flight parser core: the response-URL
  filter, the row splitter, the $-ref commentary-text walker, the
  canonical content-search-URL builder, and the guarded `mintPost`
  (drop+count, never throws); timestamp derives from `BigInt(id) >> 22n`,
  and the timestamp-ordered zip pairs the i-th distinct text with the
  i-th distinct id by timestamp (a count mismatch warns and mints the
  paired prefix)
- `src/linkedin-session.ts` - the `LINKEDIN_COOKIES_FILE` resolver
  (fail-visible; the cookie file lives OUTSIDE the repo), the Cookie
  header (JSESSIONID quoted, last), and the csrf token; the walk's
  session rides the persistent profile — the cookie pair gates the run,
  it never synthesizes a browser document anymore
- `src/linkedin-fetch.ts` - the LinkedIn walk's orchestration: the FR-5
  shuffle, the runPool surface walk, the shared 5-15s pacing gate, the drain
  arms, the join priority halt > leg-dead > all-faulted, and
  stamp-at-slot-write; the factory and the walk live in the two modules below
- `src/linkedin-context.ts` - the LinkedIn browser-context factory (headed
  Chromium on the persistent profile via `launchPersistentContext` — msedge
  channel, viewport null — from its own dynamic-import quarantine) and the
  three tagged-error families (leg-dead, all-faulted, halt); a
  checkpoint/login-wall URL throws the tagged halt (`HALT_CHECKPOINT_REASON`,
  the operator-cleared latch), and no first response inside the liveness
  window throws the tagged `LegDeadError`
- `src/linkedin-walk.ts` - the LinkedIn surface walk: one paced navigation
  plus up to `scrollRounds` "Load more" clicks, the response join, the
  stream-order seen-stop fold, the 150-post cap, and the 14 tuning constants
- `src/linkedin-behavior.ts` - the PC leg's pure policy machines: the
  working-hours window, the jittered 28-33-minute wake cadence, and the
  halt-latch reason vocabulary
- `src/linkedin-capture.ts` - the raw-body capture sink: one atomic JSON
  file per intercepted body under `captures/<UTC session stamp>/`, an 8 MB
  per-body bound, 20-session retention, and the warn-once failure policy
- `src/browser-constants.ts` - the user-agent string and the webdriver patch
  both context factories share
- `src/linkedin-payload.ts` - the atomic payload envelope writer/reader;
  reading never throws: absent -> quiet log, stale -> age log, malformed
  -> warn, bad rows -> drop+count
- `src/env-file.ts` - `.env` auto-load for the PC scripts: fills only
  unset keys, the real environment wins, a missing `.env` is a quiet no-op
- `scripts/fetch-linkedin.ts` - one tick: fetch -> payload -> add ONLY
  `state/linkedin-posts.json` -> commit -> pull --rebase -> push with one
  retry (mirrors `scripts/commit-state-rebase.sh`; leg-dead = ONE alarm per
  episode via a repo-local marker, then exit 1)
- `scripts/watch-linkedin.ts` - the always-on PC loop (tick + a 28-33-minute sleep)
- `scripts/probe-linkedin.ts` - the browser-walk gate probe (exit
  contracts: tick = leg-dead exits 1; loop = never exits on leg-dead;
  probe = a read-only walk of the first configured surface, gate exit 1)
- `scripts/login-linkedin.ts` - headed cookie harvest: the operator logs
  in by hand; the script polls the jar, writes the cookie file atomically,
  and upserts the `.env` line (exit 1 on timeout/no session; entry-guarded,
  importing stays side-effect free)
- `scripts/linkedin-chain.ts` - the one-command operator chain:
  `runLinkedInChain(deps)` sequences login hold -> probe -> exactly one
  tick; the merged env resolves once and threads to all three legs, and
  the login's harvested cookie path joins it for stages 2-3 when the env
  lacks `LINKEDIN_COOKIES_FILE`; quiet-zero ticks are reported no-ops
  (exit 0); entry-guarded, importing stays side-effect free
- `scripts/replay-linkedin.ts` - offline replay of a capture session: reads
  `captures/<stamp>/` and re-runs the parser over every recorded body
- `scripts/reset-linkedin.ts` - the operator reset: deletes the cookie file,
  the browser profile, and the halt latch, in that order
- `src/extract.ts` - parses posts from graphql XHR responses or `data-sjs` blobs
- `src/recency.ts` - drops posts outside the `recencyHours` window
- `src/state.ts` - seen-post state; writes are atomic (temp file + rename)
- `src/judge.ts` - the judge's orchestration: env parsing, the ~10-post
  batch split, the two pools, and the drain-then-throw terminal; accounts
  come from the `LLM_ACCOUNTS` pool, dispatches spread across it, and an
  exhausted pool throws a typed error that sends one alarm email and exits 1
- `src/judge-prompts.ts` - the judge's system message and the two message
  builders (single-post and bulk), so the two prompts cannot drift
- `src/judge-dispatch.ts` - the judge's dispatch core: the shared HTTP retry
  loop, both wrappers, the exhaustion record, the two wire helpers, and the
  sleep seam (an HTTP 429 cools that account for 60s and dispatches re-scan
  past cooling accounts; when all are cooling, calls park up to a shared
  180s wait budget before the pool converts to exhaustion; 5xx retries the
  same account with backoff; each dispatch starts at the next account and
  every account is capped at its probe-measured ceiling from
  `state/judge-ceilings.json`; bulk misses fall back to single-post calls,
  and a batch the endpoint does not answer is deferred whole)
- `src/judge-availability.ts` - the pre-dispatch availability check: one
  tiny parallel call per account, never throws; a refused account rides the
  judge's blocked mask with the judge's own reason vocabulary
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
- `src/email.ts` - nodemailer transport for the digest and the leg-dead/halt
  alarms
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
