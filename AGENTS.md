# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

loker-watcher watches Indonesian job-hunting surfaces on Threads. A scheduled
GitHub Actions workflow loads the surfaces listed in `watcher.config.json`,
asks an OpenAI-compatible LLM judge to keep posts matching the configured
keywords, and emails new matches as a plain-text digest.
The only persistence is `state/seen-posts.json`, which the workflow commits
back after match runs.

## Commands

- `npm test` - unit tests (node:test runner via tsx, offline and deterministic)
- `npm run typecheck` - `tsc --noEmit` over `src/`, `tests/`, and `scripts/`
- `npx tsx scripts/probe-judge.ts` - measure how long the LLM endpoint takes to answer (needs `LLM_*` env vars)
- `npm run lint` - Biome check over `src/` and `tests/`
- `npm run format` - Biome format in place
- `npm start` - run the watcher locally (needs LLM_* and GMAIL_* env vars)
- `npx playwright install chromium` - one-time browser install for local runs

## Architecture

Pipeline entry point is `src/index.ts`:
fetch surfaces, dedupe posts, drop stale posts, drop seen posts, LLM judge
against the configured keywords, email digest, commit state.

- `src/fetch-threads.ts`, `src/threads-session.ts` - Playwright loading of tag,
  profile, and search surfaces; signed-in via `THREADS_SESSION_STATE` with a
  logged-out fallback
- `src/extract.ts` - parses posts from graphql XHR responses or `data-sjs` blobs
- `src/recency.ts` - drops posts outside the `recencyHours` window
- `src/state.ts` - seen-post state; writes are atomic (temp file + rename)
- `src/judge.ts` - ~10-post bulk chat-completions calls judged against the
  keywords in `watcher.config.json`; bulk misses fall back to single-post
  calls; returns `{relevant, locationOk}` per post
- `src/email.ts` - nodemailer transport for the digest
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
