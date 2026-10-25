---
date: 2026-10-24T13:36:02+0700
author: Yogiswara Utama
commit: no-commit
branch: no-branch
repository: unknown
topic: "Threads #hiring Indonesia job alerts"
tags: [intent, frd, scraper, scheduler, email-notifier, greenfield]
status: ready
last_updated: 2026-10-24T13:36:02+0700
last_updated_by: Yogiswara Utama
---

# FRD: Threads #hiring Indonesia job alerts

## Summary
A GitHub Actions cron job that polls the Threads search feed for `#hiring indonesia` every 5 minutes, filters posts down to web frontend / fullstack (and adjacent) roles in Indonesia or remote, and emails the developer a digest of new matches via Gmail SMTP. A two-stage filter (keywords, then an OpenAI-compatible LLM on the maybes) keeps precision without per-post LLM cost, and a state file committed back to the repo prevents duplicate notifications.

## Problem & Intent
The developer is a job seeker (just themselves, no team or product). Today, when a relevant Threads post appears under `#hiring indonesia`, they either see it late or miss it entirely, because nothing watches the feed for them. Success means being among the first to apply: the tool must surface new, genuinely relevant postings in their inbox with minimal manual checking and minimal noise.

## Goals
- Catch new relevant Threads postings fast enough to be an early applicant (5-minute poll cadence)
- Only notify on web frontend / fullstack and adjacent roles located in Indonesia or remote
- Never notify twice about the same post
- Run for free, with no server to maintain and no manual intervention between runs

## Non-Goals
- Not a product for other users; single-recipient, single-query tool
- Not a full job board, application tracker, or aggregator for other platforms
- No web UI, no dashboard, no subscription management
- Not monitoring other hashtags or locations beyond the configured query

## Functional Requirements
1. The system SHALL fetch the Threads search results for `https://www.threads.com/search?q=%23hiring%20indonesia&serp_type=default` on a 5-minute cron schedule.
2. The system SHALL extract each post's text, author, permalink, and timestamp from the fetched feed.
3. The system SHALL pre-filter posts by a keyword set covering web frontend / fullstack and adjacent stacks (React, Vue, Next.js, Angular, frontend, full stack, web developer, and related terms).
4. The system SHALL pass keyword-matched ("maybe") posts to an OpenAI-compatible LLM endpoint that judges whether the post is a genuine job posting for a web frontend / fullstack or adjacent role.
5. The system SHALL drop posts whose stated location is neither Indonesia nor remote.
6. The system SHALL persist the IDs of already-notified posts in a state file and exclude them from every subsequent run.
7. The system SHALL send one digest email per run listing all new matches, each with the post text, author, and a link to the post on Threads.
8. The system SHALL send no email on runs with zero new matches.
9. The system SHALL commit the updated state file back to the repository at the end of each run that found matches.

## Non-Functional Requirements
- **Performance**: A single run completes in well under the GitHub Actions 6-minute job timeout, including fetch, filter, and email send.
- **Security**: All credentials (Gmail app password, LLM endpoint base URL and API key) live in GitHub Actions secrets, never in the repo. The state file contains only public post IDs and metadata.
- **UX / Accessibility**: The digest email is plain, readable text with one clear link per posting; no HTML-only content.
- **Reliability**: A fetch or filter failure in one run must not corrupt the state file or silently skip notifying on posts already seen; the job fails visibly in the Actions log instead of sending a wrong email. Transient fetch failures are retried within the run before giving up.

## Constraints & Assumptions
- GitHub Actions cron has a 5-minute minimum and scheduled runs can be delayed during platform load — freshness is best-effort, not guaranteed
- GitHub Actions free tier quota for scheduled workflows is the only runtime budget
- Threads has no official public API; the fetch mechanism is the primary technical risk and is deliberately left open pending research (see Open Questions)
- Gmail SMTP via app password is rate-limited (~100/day); at a 5-minute cadence with digests this is far below the ceiling
- Assumption: the Threads search feed can be rendered or queried from a GitHub Actions runner at all — research must verify, and login walls or bot detection may force a different fetch mechanism
- Assumption: post permalinks are stable and reconstructable from extracted post IDs

## Acceptance Criteria
- [ ] Pushing the workflow to GitHub enables a scheduled run that appears in the Actions tab and executes on its 5-minute cron
- [ ] Given a run where the feed contains a new post matching frontend keywords, the LLM confirms it, and its location is Indonesia or remote, the developer's Gmail receives one email containing that post's text and a working `threads.com` link
- [ ] Given the same feed on the next run, no second email is sent about the already-notified post
- [ ] Given a run where every post is off-topic (e.g., backend-only, or located elsewhere), no email is sent
- [ ] Given a run where the fetch fails after retries, the Actions run is marked failed with the error visible in the logs, and the state file is unchanged
- [ ] The repository's commit history shows state-file commits only on runs that found new matches
- [ ] No credential appears anywhere in the repository; `grep -r "password\|api_key" .` over the repo returns nothing sensitive

## Recommended Approach
A small Node.js or TypeScript repo in `H:/fork/loker-watcher` with a single CLI entry point run by a GitHub Actions scheduled workflow (`schedule: */5 * * * *`): fetch the Threads search feed, extract posts, keyword pre-filter, call an OpenAI-compatible LLM endpoint on the maybes, diff against a JSON state file, send a Gmail SMTP digest via nodemailer, then commit the state file back. The fetch mechanism (headless browser vs unofficial Threads endpoints vs an indirect source) is deliberately unresolved and is the first thing `research` must settle.

## Decisions

### Relevance scope
**Question**: Which posts count as a hit? The filter decides what lands in your inbox.
**Recommended**: Frontend/fullstack only
**Chosen**: Frontend + adjacent
**Rationale**: Developer wants a slightly wider net than strict frontend/fullstack, catching adjacent JS-stack roles, without opening the door to every dev role.

### Fetch mechanism
**Question**: Threads has no official public API and the search page is JavaScript-heavy. How should the tool fetch the feed?
**Recommended**: Headless browser, Playwright
**Chosen**: Deferred — research first, find the most optimal way
**Rationale**: Developer wants the fetch mechanism settled by evidence rather than picked now; this is the project's main technical risk and becomes the top Open Question.

### Relevance filter architecture
**Question**: Once fetched, how should a post be judged relevant to web frontend / fullstack?
**Recommended**: Keywords first, LLM on maybes
**Chosen**: Keywords first, LLM on maybes
**Rationale**: Cheap keyword stage trims the obvious noes; the LLM only spends tokens on ambiguous posts, balancing cost and precision.

### Email delivery
**Question**: How should the notification email actually be sent?
**Recommended**: Gmail SMTP, app password
**Chosen**: Gmail SMTP, app password
**Rationale**: Single recipient, no new account, free, and lands directly in the developer's existing inbox.

### Runtime / scheduler
**Question**: Where should the every-x-minutes loop actually run?
**Recommended**: Local script, always-on
**Chosen**: GitHub Actions cron
**Rationale**: Runs even when the developer's PC is off, no server cost, at the cost of best-effort scheduling under GitHub load.

### Seen-state persistence
**Question**: Where should the tool remember which posts it already notified you about?
**Recommended**: State file committed to repo
**Chosen**: State file committed to repo
**Rationale**: Durable, free, and auditable; the only costs are commit noise and a rare concurrent-run race, acceptable at this scale.

### Check interval
**Question**: How often should the check run?
**Recommended**: Every 5 minutes
**Chosen**: Every 5 minutes
**Rationale**: GitHub Actions' cron floor; maximizes early-applicant advantage, accepted against higher run volume.

### Email format
**Question**: When several new matching posts appear in one run, how should the email be shaped?
**Recommended**: Digest per run
**Chosen**: Digest per run
**Rationale**: One inbox item per run keeps noise bounded even on a busy feed.

### Location filter
**Question**: Which locations should count?
**Recommended**: Indonesia + remote
**Chosen**: Indonesia + remote
**Rationale**: Matches the hashtag's intent while not discarding remote roles the developer could still take.

### LLM provider
**Question**: Which model should judge the keyword maybes?
**Recommended**: OpenAI API
**Chosen**: Any OpenAI-compatible endpoint (base URL + key)
**Rationale**: Provider-agnostic; the developer can point the same code at OpenAI, a self-hosted gateway, or any compatible host by changing two secrets.

## Open Questions
- **Fetch mechanism (top priority)**: How do we actually get the Threads search feed from a GitHub Actions runner? Playwright headless browser, unofficial/undocumented Threads endpoints, or an indirect source — research must find the most optimal way, including whether the search page requires login and how Threads' bot detection behaves. Every other requirement depends on this answer.

## Suggested Follow-ups
- Add more hashtags or queries (e.g. `#lowongan`, `#jobvacancy`) once the single-query pipeline is proven — observed as an obvious extension the developer did not request.
- Track postings over time (volume, companies posting most) as a side effect of the state file — not requested, potential later use of the accumulated data.

## References
- Input: free-text feature description via `/skill:discover` — "fetch this URL: https://www.threads.com/search?q=%23hiring%20indonesia&serp_type=default every x minutes, notify by email if related to web front end / full stack"
- Target URL: https://www.threads.com/search?q=%23hiring%20indonesia&serp_type=default
- Working directory: `H:/fork/loker-watcher` (greenfield, empty at time of writing)
