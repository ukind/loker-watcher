# Project Overview

loker-watcher: a TypeScript ESM pipeline (Node >= 22, strict TS) that watches Indonesian job-hunting surfaces on Threads and LinkedIn every 10 minutes from GitHub Actions, judges candidates in bulk against the configured keywords through an OpenAI-compatible LLM (an account pool where a 429 cools the account and calls park past cooldowns on a shared wait budget), and emails new matches as a plain-text digest. Committed state is three files with one hosted writer each:
`state/seen-posts.json` (committed back by the watch job after match runs),
`state/judge-ceilings.json` (probe-measured judge ceilings, committed by the probe job), and
`state/judge-health.json` (per-account provider health, written by the watch run's flush, committed back by the watch job — success path and the failure-path Commit health step).
A fourth committed file, `state/linkedin-posts.json`, is written and pushed by the always-on PC loop (its own dedicated clone of main); the hosted run only reads it.

## Architecture

```
.github/workflows/  # ci.yml gate + watch.yml: cron */10 → npx tsx src/index.ts → state commit-back via scripts/commit-state-rebase.sh (+ dispatch-only probe job behind an 8h freshness gate)
src/                # the pipeline: fetch (threads Playwright walks + the PC-linked linkedin payload read) →
                    #   extract → dedupe → recency → seen → judge (orchestration + prompts + dispatch) →
                    #   notify → persist
tests/              # offline unit suite (node:test via tsx), ~1:1 with src module names + script/hook subprocess tests
scripts/            # commit-state-rebase.sh (commit-back body for ALL THREE state files: rebase + skip + push + one internal retry), probe-judge.ts (LLM endpoint gate → state/judge-ceilings.json), the PC-local LinkedIn leg (fetch/watch/probe/login/chain), + Claude Code hooks
.claude/, .cursor/, # agent meta: hook registration + agents/commands/skills | editor rules | husky pre-commit
.husky/             #   (lint-staged)
state/              # runtime state only: seen-posts.json (watch job) + judge-ceilings.json (probe job) + judge-health.json (watch job) + linkedin-posts.json (PC loop, its own clone of main — the hosted run only reads it)
```

Untracked by decision: `.rpiv/tmp/` scratch and `.codebase-memory/graph.db.zst` (the local graph index, rewritten on reindex) must not be re-added. `.rpiv/artifacts/` stays tracked.

Detailed guidance:
- `.rpiv/guidance/src/architecture.md` — pipeline stages, funnel gates and ordering, DI seams, judge cooldown+park + health circuit, platform fetchers
- `.rpiv/guidance/tests/architecture.md` — offline suite rules, doubles idioms, coverage map
- `.rpiv/guidance/.github/workflows/architecture.md` — triggers, permissions, secret mapping, freshness gate, state commit-back (script invocation)
- `.rpiv/guidance/scripts/architecture.md` — the probe workflow, PC-local scripts, and hook exit-code contracts

## Commands

| Command | What it does |
|---|---|
| `npm test` | unit tests (node:test via tsx; offline and deterministic) |
| `npm run typecheck` | `tsc --noEmit` over src, tests, and scripts/ |
| `npm run lint` | Biome check over src, tests, and the enumerated scripts/ entries + hooks |
| `npm run format` | `biome format --write src tests` in place (src and tests only — not repo-wide) |
| `npx biome check --write <path>` | scoped check+fix for the given files (the lint-staged form) |
| `npm start` | run the watcher locally (needs LLM_* and GMAIL_* env vars; an absent or stale `state/linkedin-posts.json` degrades to a threads-only run with one log line) |
| `npx tsx scripts/probe-judge.ts` | gate every LLM_ACCOUNTS entry: latency, bulk shape, per-account `ceiling=N`; exit 1 on a dead account (needs LLM_ACCOUNTS) |
| `npm run fetch-linkedin` / `watch-linkedin` | PC leg: one LinkedIn fetch tick / the always-on loop (tick + 28-33-min sleep) from a dedicated clone of main |
| `npm run probe-linkedin` | gate the LinkedIn browser walk: a read-only walk of the first configured surface; exit 1 on a checkpoint wall, a dead session, a faulted walk, or fewer than 10 posts |
| `npm run login-linkedin` | headed cookie harvest: the operator logs in by hand; writes the cookie file + the `.env` line |
| `npm run linkedin-chain` | one-command operator chain: login hold -> probe -> exactly one fetch tick, in order, from a dedicated clone of main; a quiet-zero tick is a reported no-op (exit 0); any stage failure exits 1 naming the gate (real TTY for the login hold) |
| `npx playwright install chromium` | one-time browser install for local runs |

## Business Context

A scheduled GitHub Actions run is the only hosted runtime. Zero-match runs email a status digest (the heartbeat) instead — `HEARTBEAT_ENABLED` unset means enabled. A dark LinkedIn leg (absent or stale `state/linkedin-posts.json` — the PC loop is off) degrades to a threads-only run with one log line; the heartbeat still fires and renders the leg state. Operator configuration lives in `watcher.config.json`; a typo stops the run with an error that names the problem. Repo doctrine: probe-measured values are committed data, not env knobs (per-account judge ceilings in `state/judge-ceilings.json`, freshness stamped with `probedAt`); all other tuning values are hard-coded module constants.

## State history policy (N043, decided 2026-11-13)

`state/seen-posts.json` is rewritten and committed on every match run (1273 commits at the run-6 audit). `.git` measured 189 MB, of which 172 MB was loose objects (`size-pack` 12.4 MiB).

The policy is **gc once, document, no schedule**:

- One `git gc --aggressive` reclaims the loose objects. Run it from a full clone, never from a shallow one.
- No scheduled gc. A cron job that rewrites `.git` on a public repo is a new failure mode for a cost that grows slowly.
- Revisit trigger: clone size or CI checkout time becomes a visible cost. The options then are a periodic squash of `state/` commits via `git-filter-repo`, or moving seen-state out of git (cache/artifact — a redesign).

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

<important if="you are adding a PC-local script">
1. Script shape, entry guard, exit contract, alarm policy — see `.rpiv/guidance/scripts/architecture.md` ("Adding a PC-local Script")
2. Its offline test — see `.rpiv/guidance/tests/architecture.md` ("Adding a Test for a scripts/ CLI Entry Point")
</important if>

<important if="you are running the judge probe or changing judge ceilings">
1. Run the probe — the probe job commits the readings itself — see `.rpiv/guidance/scripts/architecture.md` ("Running the Judge Probe and Applying the Reading")
2. Where the ceilings commit lands, the freshness gate, and the measured-evidence convention — see `.rpiv/guidance/.github/workflows/architecture.md` ("The probe job: a freshness-gated walk of every account")
</important if>
