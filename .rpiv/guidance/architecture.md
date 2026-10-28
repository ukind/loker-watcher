# Project Overview

loker-watcher: a TypeScript ESM pipeline (Node >= 22, strict TS) that watches Indonesian job-hunting surfaces on Threads every 10 minutes from GitHub Actions, judges candidates in bulk against the configured keywords through an OpenAI-compatible LLM (an account pool with 429 rotation), and emails new matches as a plain-text digest. The only persistence is `state/seen-posts.json`, which the workflow commits back after match runs.

## Architecture

```
.github/workflows/  # ci.yml gate + watch.yml: cron */10 → npx tsx src/index.ts → state commit-back (+ dispatch-only probe job)
src/                # the pipeline: fetch → extract → dedupe → recency → seen → judge → notify → persist
tests/              # offline unit suite (node:test via tsx), ~1:1 with src module names
scripts/            # probe-judge.ts (measures the LLM endpoint, feeds JUDGE_CONCURRENCY) + Claude Code hooks
state/              # runtime state only; written by the run, committed back by the workflow
```

Detailed guidance:
- `.rpiv/guidance/src/architecture.md` — pipeline stages, funnel gates and ordering, DI seams, judge rotation
- `.rpiv/guidance/tests/architecture.md` — offline conventions, doubles, fixtures, coverage map
- `.rpiv/guidance/.github/workflows/architecture.md` — triggers, permissions, secret mapping, state commit-back
- `.rpiv/guidance/scripts/architecture.md` — the probe workflow and hook exit-code contracts

## Commands

| Command | What it does |
|---|---|
| `npm test` | unit tests (node:test via tsx; offline and deterministic) |
| `npm run typecheck` | `tsc --noEmit` over src, tests, and scripts/probe-judge.ts |
| `npm run lint` | Biome check over src, tests, and scripts/probe-judge.ts |
| `npm run format` | Biome format in place, repo-wide |
| `npx biome check --write <path>` | scoped check+fix for the given files (the lint-staged form) |
| `npm start` | run the watcher locally (needs LLM_ACCOUNTS and GMAIL_* env vars) |
| `npx tsx scripts/probe-judge.ts` | measure the LLM endpoint; prints the recommended JUDGE_CONCURRENCY (needs LLM_ACCOUNTS) |

## Business Context

A scheduled GitHub Actions run is the only runtime. Zero-match runs email a status digest (the heartbeat) instead — `HEARTBEAT_ENABLED` unset means enabled. Operator configuration lives in `watcher.config.json`; a typo stops the run with an error that names the problem. Repo doctrine: only probe-measured values are env-tunable (`JUDGE_CONCURRENCY`); all other tuning values are hard-coded module constants.

<important if="you are adding a new pipeline stage end-to-end">
1. Stage code and funnel wiring — see `.rpiv/guidance/src/architecture.md` ("Adding a New Pipeline Stage")
2. Tests — see `.rpiv/guidance/tests/architecture.md` ("Adding a Test for a New src Module")
3. Gates: `npm run typecheck && npm run lint && npm test` (CI runs the same three)
</important if>

<important if="you are adding or changing environment variables or secrets">
1. `ENV_NAMES` and the resolver contracts — see `.rpiv/guidance/src/architecture.md` ("Adding a New Env Var or Service Client")
2. `watch.yml` env mapping and GitHub secret setup — see `.rpiv/guidance/.github/workflows/architecture.md` ("Adding a Secret or Env Var")
</important if>

<important if="you are changing judge concurrency or endpoint tuning">
1. Run the probe and apply its reading — see `.rpiv/guidance/scripts/architecture.md` ("Running the Judge Probe")
2. Where the literal lives and its evidence-comment convention — see `.rpiv/guidance/.github/workflows/architecture.md` (step-scoped secrets pattern)
</important if>
