# Project Overview

loker-watcher: a TypeScript ESM pipeline (Node >= 22, strict TS) that watches Indonesian job-hunting surfaces on Threads every 10 minutes from GitHub Actions, asks an OpenAI-compatible LLM to judge candidates in bulk against the configured keywords, and emails new matches as a plain-text digest. The only persistence is `state/seen-posts.json`, which the workflow commits back after match runs.

## Architecture

```
.github/workflows/watch.yml   # production entry: cron */10 → npx tsx src/index.ts → state commit-back
src/                          # the pipeline: fetch → extract → dedupe → recency → seen → judge → email → state
tests/                        # offline unit suite (node:test via tsx), 1:1 with src module names
```

Detailed guidance:
- `.rpiv/guidance/src/architecture.md` — pipeline stages, fail-visible rules, injection seams
- `.rpiv/guidance/tests/architecture.md` — offline test conventions, doubles, fixtures
- `.rpiv/guidance/.github/workflows/architecture.md` — triggers, permissions, state commit-back

## Commands

| Command | What it does |
|---|---|
| `npm test` | unit tests (node:test via tsx; offline and deterministic) |
| `npm run typecheck` | `tsc --noEmit` over src and tests |
| `npm run lint` | Biome check over src and tests |
| `npm run format` | Biome format in place, repo-wide |
| `npx biome check --write <path>` | scoped check+fix for the given files (the lint-staged form) |
| `npm start` | run the watcher locally (needs LLM_* and GMAIL_* env vars) |

## Business Context

A scheduled GitHub Actions run is the only runtime. Zero-match runs email a status digest (the heartbeat) instead — this is the intentional default (`HEARTBEAT_ENABLED` unset means enabled). Operator configuration lives in `watcher.config.json`; a typo stops the run with an error that names the problem.

<important if="you are adding a new pipeline stage end-to-end">
1. Stage code and funnel wiring — see `.rpiv/guidance/src/architecture.md` ("Adding a New Pipeline Stage")
2. Tests — see `.rpiv/guidance/tests/architecture.md` ("Adding a Test for a New src Module")
3. Gates: `npm run typecheck && npm run lint && npm test` (CI runs the same three)
</important if>

<important if="you are adding or changing environment variables or secrets">
1. `ENV_NAMES` and the resolver in src — see `.rpiv/guidance/src/architecture.md`
2. `watch.yml` env mapping and GitHub secret setup — see `.rpiv/guidance/.github/workflows/architecture.md`
</important if>