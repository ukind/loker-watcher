---
date: 2026-10-24T15:40:10+0700
author: Yogiswara Utama
commit: no-commit
branch: no-branch
repository: unknown
topic: "Threads #hiring Indonesia job alerts"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, threads, scraper, fetch]
last_updated: 2026-10-24T15:40:10+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Threads #hiring Indonesia job alerts — fetch mechanism

**Date**: 2026-10-24T15:40:10+0700
**Author**: Yogiswara Utama
**Commit**: no-commit
**Branch**: no-branch
**Repository**: unknown

## Research Question
How should the tool fetch the Threads search feed for `#hiring indonesia` from a GitHub Actions runner? Threads has no official public API and the search page is JavaScript-heavy. The fetch mechanism is the project's top technical risk and every downstream module depends on it.

## Summary
**Problem**: The repository is greenfield. No source code, no package manifest, no workflow files exist. The FRD defers the fetch mechanism decision to research. Four candidate surfaces were evaluated.
**Recommended**: Playwright headless browser — the FRD's recommended approach, the only option that runs for free, and the only one that renders the JS-heavy search page directly.
**Effort**: Medium (~2 days for the fetch module, including verification)
**Confidence**: High

## Problem Statement

**Requirements:**
- Fetch the Threads search results for `#hiring indonesia` on a 10-minute cron schedule
- Extract per post: text, author, permalink, and timestamp
- Produce a stable, deduplicatable post ID for the state file
- Complete a single run in well under the GitHub Actions 6-minute job timeout

**Constraints:**
- Run for free — no server to maintain, no per-call fees
- All credentials live in GitHub Actions secrets, never in the repo
- Transient fetch failures are retried within the run before giving up
- A fetch failure must not corrupt the state file

**Success criteria:**
- The workflow executes on its cron schedule and returns a usable post list
- The digest email contains a working `threads.com` link per posting

## Current State

**Existing implementation:**
None. The repository contains only `.pi/` and `.rpiv/` metadata. No `package.json`, no source files, no `.github/workflows/`, no `.git` directory.

**Relevant patterns:**
- FRD "Recommended Approach" (`discover/2026-10-24_13-36-02_threads-hiring-alerts.md:69`): "A small Node.js or TypeScript repo with a single CLI entry point run by a GitHub Actions scheduled workflow"
- FRD "Fetch mechanism" decision (`discover/2026-10-24_13-36-02_threads-hiring-alerts.md:81-82`): "Headless browser, Playwright" — recommended but deferred pending research
- Research report (`research/2026-10-24_14-30-29_threads-hiring-alerts.md:13-15`): Three candidate surfaces identified — Playwright, unofficial endpoints, indirect source

**Integration points:**
- `.github/workflows/` — workflow file (not yet created)
- `package.json` — dependencies (not yet created)
- `state/seen-posts.json` — state file (not yet created)

## Solution Options

### Option 1: Playwright headless browser
**How it works:** Run a headless Chromium instance on the GitHub Actions runner. Load `https://www.threads.com/search?q=%23hiring%20indonesia&serp_type=default`. Extract posts from the rendered DOM.

**Pros:**
- The FRD's recommended approach; matches the planned architecture exactly
- Runs for free — no per-call fees, no third-party account
- Renders the JS-heavy page directly; no reverse-engineering required
- Playwright has 52M weekly npm downloads and near-zero deprecation risk

**Cons:**
- Bot detection may block the runner's IP or flag headless Chrome
- The search page loads only a single screenful of results when logged out
- Browser startup and page load add runtime overhead toward the 6-minute timeout

**Complexity:** Medium (~2 days)
- Files to create: 1 (~150 lines) — fetch module
- Files to modify: 2 (~50 lines) — workflow, package.json
- Risk level: Medium

### Option 2: ScrapeCreators REST API
**How it works:** Call `https://api.scrapecreators.com/v1/threads/search` with an API key. The API returns structured JSON for keyword search.

**Pros:**
- Clean REST API with OpenAPI specs and code examples in Node.js
- Handles bot detection and session management internally
- 100 free credits on signup, no card required

**Cons:**
- The free tier (100 credits) is exhausted in under one day at 144 runs/day
- A paid plan is mandatory from day one (~$81/month at $1.88 per 1,000 credits)
- Violates the "run for free" constraint
- API contract (fields returned) is unverified against the FRD's extraction requirements

**Complexity:** Low (~1 day)
- Files to create: 1 (~100 lines) — fetch module
- Files to modify: 2 (~30 lines) — workflow, package.json
- Risk level: Low (financial)

### Option 3: Apify Threads Search Scraper
**How it works:** Submit a run to an Apify Actor via the Apify HTTP API. The Actor scrapes Threads search results and returns them as structured data.

**Pros:**
- Purpose-built for Threads search; no session management required
- Serverless — no browser to manage on the runner
- Works from GitHub Actions via a simple HTTP call

**Cons:**
- Priced ~$4–5 per 1,000 results — a paid plan is mandatory
- Violates the "run for free" constraint
- Async Actor pattern (submit → poll → fetch results) adds latency and complexity
- Data contract (fields returned) is unverified against the FRD's extraction requirements

**Complexity:** Medium (~2 days)
- Files to create: 1 (~120 lines) — fetch module with polling loop
- Files to modify: 2 (~40 lines) — workflow, package.json
- Risk level: Medium

### Option 4: Unofficial Threads GraphQL API
**How it works:** Call `https://www.threads.net/api/graphql` with reverse-engineered doc_ids (e.g. `28768213336137323` for search). Requires a browser session token.

**Pros:**
- Runs for free — no per-call fees
- Returns structured JSON without rendering a page
- Active ecosystem of reverse-engineered clients

**Cons:**
- Requires a browser session token that expires — GitHub Actions runners are ephemeral
- Session token must be stored in secrets and refreshed per run
- Meta changes doc_ids without notice; no SLA
- Rate-limited to ~30 requests per 15 minutes per domain
- Against Threads' Terms of Use

**Complexity:** High (~3 days)
- Files to create: 2 (~200 lines) — GraphQL client, session manager
- Files to modify: 2 (~40 lines) — workflow, package.json
- Risk level: High

## Comparison

| Criteria | Option 1: Playwright | Option 2: ScrapeCreators | Option 3: Apify | Option 4: GraphQL |
|----------|---------------------|-------------------------|----------------|------------------|
| Complexity | Medium | Low | Medium | High |
| Codebase fit | High | Medium | Low | Low |
| Risk | Medium | Low (financial) | Medium | High |
| Cost | Free | Paid (~$81/mo) | Paid (~$17/mo) | Free |

## Recommendation

**Selected: Option 1 — Playwright headless browser**

**Rationale:**
- It is the FRD's recommended approach and matches the planned architecture exactly
- It is the only candidate that satisfies the "run for free" constraint
- It renders the JS-heavy search page directly, with no reverse-engineering or third-party dependency
- Playwright has the strongest ecosystem momentum of any browser automation tool (52M weekly downloads, 94% retention rate)

**Why not alternatives:**
- ScrapeCreators and Apify both require a paid plan, which violates the "run for free" constraint
- The unofficial GraphQL API requires a browser session token on an ephemeral runner — an unsolved operational problem

**Trade-offs:**
- Accepting bot-detection risk for zero cost
- Accepting a single screenful of results (logged-out) for zero cost

**Implementation approach:**
1. Create `package.json` with `playwright`, `axios`, `nodemailer`, and a JSON state library
2. Write `src/fetch-threads.ts` — launches a headless browser, loads the search page, extracts posts
3. Wire it into the workflow as a single job step with retry logic
4. Verify the fetch works from a GitHub Actions runner before building the rest of the pipeline

**Integration points:**
- `src/fetch-threads.ts` — new fetch module (replaces the deferred fetch decision)
- `.github/workflows/threads-hiring-alerts.yml` — runs the CLI on a 10-minute cron
- `state/seen-posts.json` — the fetch module writes post IDs to this file

**Patterns to follow:**
- FRD "Recommended Approach" (`discover/2026-10-24_13-36-02_threads-hiring-alerts.md:69`) — single CLI entry point

**Risks:**
- Bot detection: Mitigate with stealth settings (disable `navigator.webdriver`, use realistic user agents)
- Single screenful: If more results are needed, add login via a stored session (deferred)
- Runtime: Mitigate by reusing a single browser context across runs

## Scope Boundaries
- Building the fetch mechanism for the Threads search feed
- Verifying the fetch works from a GitHub Actions runner

- Not building the keyword filter, LLM judgment, location filter, state diff, or email delivery (out of scope for this decision)
- Not building a UI or dashboard

## Testing Strategy

**Unit tests:**
- Extract posts from a fixed HTML fixture (mock DOM)
- Assert the post contract: text, author, permalink, timestamp, post ID

**Integration tests:**
- Run the fetch module against the live Threads search page from a GitHub Actions runner
- Assert the run completes under 6 minutes

**Manual verification:**
- [ ] Run the workflow manually in GitHub Actions and confirm the post list is returned
- [ ] Confirm the digest email contains a working `threads.com` link

## Open Questions
**Resolved during research:**
- Threads search returns public posts to logged-out visitors, but only a single screenful — the search page does not require login for basic access
- The unofficial GraphQL search endpoint requires a browser session token (`wowa_url`) and cannot run anonymously from a serverless runner
- ScrapeCreators' 100 free credits are exhausted in under one day at the required cadence (4,320 calls/month)

**Requires user input:**
- Is a single screenful of results sufficient, or is more needed? If more, login via a stored session must be added (deferred).

**Blockers:**
- Whether Threads' bot detection blocks a headless runner — must be verified with a live run before building the rest of the pipeline

## References
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md` — FRD for Threads #hiring Indonesia job alerts
- `.rpiv/artifacts/research/2026-10-24_14-30-29_threads-hiring-alerts.md` — Research findings on fetch mechanisms
- https://apify.com/futurizerush/threads-search-scraper-api/api — Apify Threads Search Scraper
- https://scrapecreators.com/threads-api — ScrapeCreators Threads API
- https://github.com/m1guelpf/threads-re — Reverse-engineered Threads doc_ids
- https://testdino.com/blog/playwright-market-share — Playwright market share and retention
