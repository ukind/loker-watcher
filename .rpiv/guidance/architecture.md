# Project Overview

loker-watcher: a TypeScript ESM pipeline (Node >= 22, strict TS) that watches Indonesian job-hunting surfaces on Threads and LinkedIn every 10 minutes from GitHub Actions, judges candidates in bulk against the configured keywords through an OpenAI-compatible LLM (an account pool where a 429 cools the account and calls park past cooldowns on a shared wait budget), and emails new matches as a plain-text digest. Committed state is two files, one writer each:
`state/seen-posts.json` (the watch job commits it back after match runs) and
`state/judge-ceilings.json` (probe-measured judge ceilings, committed by the probe job).

## Architecture

```
.github/workflows/  # ci.yml gate + watch.yml: cron */10 → npx tsx src/index.ts → state commit-back via scripts/commit-state-rebase.sh (+ dispatch-only probe job)
src/                # the pipeline: fetch (threads Playwright walks + the PC-linked linkedin payload read) → extract → dedupe → recency → seen → judge → notify → persist
tests/              # offline unit suite (node:test via tsx), ~1:1 with src module names + hook subprocess tests
scripts/            # commit-state-rebase.sh (commit-back body for BOTH state files: rebase + skip + push + one internal retry), probe-judge.ts (measures the LLM endpoint, writes state/judge-ceilings.json live-only) + Claude Code hooks
.claude/, .cursor/, # agent meta: hook registration + agents/commands/skills | editor rules | husky pre-commit
.husky/             #   (lint-staged)
state/              # runtime state only: seen-posts.json (watch job) + judge-ceilings.json (probe job); written by the run/job, committed back by the workflow
```

Untracked by decision: `.rpiv/tmp/` scratch and `.codebase-memory/graph.db.zst` (the local graph index, rewritten on reindex) must not be re-added. `.rpiv/artifacts/` stays tracked.

Detailed guidance:
- `.rpiv/guidance/src/architecture.md` — pipeline stages, funnel gates and ordering, DI seams, judge cooldown+park, platform fetchers
- `.rpiv/guidance/.github/workflows/architecture.md` — triggers, permissions, secret mapping, state commit-back (script invocation)
- `.rpiv/guidance/scripts/architecture.md` — the probe workflow and hook exit-code contracts

## Commands

| Command | What it does |
|---|---|
| `npm test` | unit tests (node:test via tsx; offline and deterministic) |
| `npm run typecheck` | `tsc --noEmit` over src, tests, and scripts/probe-judge.ts |
| `npm run lint` | Biome check over src, tests, scripts/probe-judge.ts, and scripts/hooks |
| `npm run format` | `biome format --write src tests` in place (src and tests only — not repo-wide) |
| `npx biome check --write <path>` | scoped check+fix for the given files (the lint-staged form) |
| `npm start` | run the watcher locally (needs LLM_* / session secrets and GMAIL_* env vars) |
| `npx tsx scripts/probe-judge.ts` | gate every LLM_ACCOUNTS entry: latency, bulk shape, per-account `ceiling=N`; exit 1 on a dead account (needs LLM_ACCOUNTS) |

## Business Context

A scheduled GitHub Actions run is the only runtime. Zero-match runs email a status digest (the heartbeat) instead — `HEARTBEAT_ENABLED` unset means enabled. A dark LinkedIn leg (absent or stale `state/linkedin-posts.json` — the PC loop is off) degrades to a threads-only run with one log line; the heartbeat still fires and renders the leg state. Operator configuration lives in `watcher.config.json`; a typo stops the run with an error that names the problem. Repo doctrine: probe-measured values are committed data, not env knobs (per-account judge ceilings in
`state/judge-ceilings.json`); all other tuning values are hard-coded module constants.

<important if="you are adding a new pipeline stage end-to-end">
1. Stage code and funnel wiring — see `.rpiv/guidance/src/architecture.md` ("Adding a New Pipeline Stage")
2. Tests — see `.rpiv/guidance/tests/architecture.md` ("Adding a Test for a New src Module")
3. Gates: `npm run typecheck && npm run lint && npm test` (CI runs the same three)
</important if>

<important if="you are adding a new platform surface">
1. Fetcher, parser, and session policy — see `.rpiv/guidance/src/architecture.md` ("Adding a New Platform Fetcher")
2. Config key or surface type — see `.rpiv/guidance/src/architecture.md` ("Adding a New Surface Type or Config Key")
3. Secret/env mapping — see `.rpiv/guidance/.github/workflows/architecture.md` ("Adding a Secret or Env Var")
</important if>

<important if="you are adding or changing environment variables or secrets">
1. `ENV_NAMES` and the resolver contracts — see `.rpiv/guidance/src/architecture.md` ("Adding a New Env Var or Service Client")
2. `watch.yml` env mapping and GitHub secret setup — see `.rpiv/guidance/.github/workflows/architecture.md` ("Adding a Secret or Env Var")
</important if>

<important if="you are running the judge probe or changing judge ceilings">
1. Run the probe — the probe job commits the readings itself — see `.rpiv/guidance/scripts/architecture.md` ("Running the Judge Probe and Applying the Reading")
2. Where the ceilings commit lands and the measured-evidence convention — see `.rpiv/guidance/.github/workflows/architecture.md` ("The probe job: a gate that walks every account")
</important if>
