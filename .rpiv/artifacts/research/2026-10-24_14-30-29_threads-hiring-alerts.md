---
date: 2026-10-24T14:30:29+0700
author: Yogiswara Utama
commit: no-commit
branch: no-branch
repository: unknown
topic: "Threads #hiring Indonesia job alerts"
tags: [research, codebase, threads, scraper, scheduler, email-notifier, greenfield]
status: ready
last_updated: 2026-10-24T14:30:29+0700
last_updated_by: Yogiswara Utama
---

# Research: Threads #hiring Indonesia job alerts

## Research Question
A GitHub Actions cron job that polls the Threads search feed for `#hiring indonesia` every 5 minutes, filters posts down to web frontend / fullstack (and adjacent) roles in Indonesia or remote, and emails the developer a digest of new matches via Gmail SMTP. A two-stage filter (keywords, then an OpenAI-compatible LLM on the maybes) keeps precision without per-post LLM cost, and a state file committed back to the repo prevents duplicate notifications.

## Summary
The repository `H:/fork/loker-watcher` is greenfield: no source code, no package manifest, no workflow files, no `.git` directory. All eight research questions describe planned functionality that must be designed and implemented. The top technical risk is the fetch mechanism — Threads has no official public API and the search page is JavaScript-heavy. The most critical constraint conflict is the 5-minute cadence against GitHub Actions' free-tier quota: 288 runs/day at ~1 minute each consumes ~8,640 Linux minutes/month, which is 4.3× the 2,000-minute free tier. The developer chose to reduce the cadence to every 10 minutes.

## Detailed Findings

### Fetch mechanism (top priority)
- Threads has no official public API. The search page at `https://www.threads.com/search?q=%23hiring%20indonesia&serp_type=default` is JavaScript-heavy.
- Three candidate surfaces: Playwright headless browser, unofficial/undocumented Threads endpoints, or an indirect source.
- The FRD explicitly defers this choice pending research. This decision anchors every downstream module.
- Evidence landscape is unresolved: whether the search page requires login and how Threads' bot detection behaves on a headless runner must be verified before implementation.

### Post extraction contract
- The FRD (line 37) requires extracting per post: text, author, permalink, and timestamp.
- The acceptance criteria require a working `threads.com` link per posting in the digest email.
- The state file persists only post IDs, so the extraction must produce a stable, deduplicatable identifier.
- Whether permalinks are reconstructable from post IDs (as the FRD assumes) is unverified.

### Two-stage relevance filter architecture
- The FRD (line 37) mandates: keyword pre-filter → LLM judgment on "maybe" posts.
- The keyword set must cover: React, Vue, Next.js, Angular, frontend, full stack, web developer, and related terms.
- No keyword config file or constant module exists. This is an implementation gap.
- The LLM verdict parsing (JSON mode with boolean field, or string match) is unspecified.
- The FRD (line 38) specifies an "OpenAI-compatible endpoint" — provider-agnostic via base URL + key.

### Location filter semantics
- The FRD (line 39) requires dropping posts whose stated location is neither Indonesia nor remote.
- The derivation method is unspecified: keyword match ("Indonesia", "Jakarta", "remote", "WFH"), LLM inference, or both.
- The FRD's "Recommended Approach" (line 69) omits location filtering from the sequence entirely, despite it being a functional requirement. This is a gap in the FRD.
- Ambiguous or absent location signals have no defined handling.

### State file persistence and commit-back
- The FRD (line 40) requires persisting notified post IDs in a JSON state file committed back to the repo.
- The schema is unspecified: "post IDs and metadata" (line 47) but no exact structure.
- The read/diff/write cycle is unimplemented. The reliability requirement (line 49) demands that fetch or filter failures must not corrupt the state file.
- The commit mechanism (e.g., `git add` + `git commit` with a bot identity) is unimplemented.
- A rare concurrent-run race is acknowledged as acceptable at this scale.

### Email digest delivery
- The FRD (line 43) requires one plain-text digest email per run listing all new matches, each with post text, author, and a `threads.com` link.
- The FRD (line 44) requires no email on runs with zero new matches.
- The FRD (line 58) requires plain, readable text with one clear link per posting; no HTML-only content.
- The FRD (line 47) requires all credentials (Gmail app password, LLM base URL, LLM API key) to live in GitHub Actions secrets, never in the repo.
- The security acceptance criterion (line 66) requires `grep -r "password\|api_key" .` to return nothing sensitive.
- The FRD (line 69) specifies nodemailer as the transport.

### GitHub Actions workflow wiring
- The FRD (line 35) specifies `schedule: */5 * * * *`.
- The workflow must reference secrets: `GMAIL_APP_PASSWORD`, `LLM_BASE_URL`, `LLM_API_KEY`.
- The state-file commit must not trigger a new workflow run (GITHUB_TOKEN pushes do not create new runs).
- A fetch or filter failure must mark the Actions run as failed with the error visible in the logs.
- No `continue-on-error: true` on the fetch step.

### Runtime budget and reliability
- The FRD (line 45) requires a single run to complete in well under the GitHub Actions 6-minute job timeout.
- The FRD (line 49) requires transient fetch failures to be retried within the run before giving up.
- The Gmail SMTP rate limit is ~100/day (behavioral heuristics trigger blocks well below documented caps).
- The GitHub Actions free-tier quota is 2,000 Linux minutes/month for private repositories.
- **Critical conflict**: At 288 runs/day (5-minute cadence) with a ~1-minute run, the total is ~8,640 minutes/month — 4.3× the free tier.
- The developer chose to reduce the cadence to every 10 minutes, which yields ~144 runs/day and ~360 minutes/month — within the free tier.

## Code References
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:35` — 5-minute cadence specification
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:37` — keyword pre-filter requirement
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:38` — LLM judgment requirement
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:39` — location filter requirement
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:40` — state file persistence requirement
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:43` — digest email requirement
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:44` — zero-match short-circuit requirement
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:47` — security constraint
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:49` — reliability requirement
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:69` — recommended approach sequence
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:66` — security acceptance criterion

## Integration Points
### Inbound References
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md` — the FRD is the single source of truth for all requirements.

### Outbound Dependencies
- Threads search feed (`https://www.threads.com/search?q=%23hiring%20indonesia&serp_type=default`) — primary technical risk.
- OpenAI-compatible LLM endpoint — provider-agnostic via secrets.
- Gmail SMTP (`smtp.gmail.com`, port 587 or 465) — app password via secrets.
- GitHub Actions — runtime container, cron trigger, secrets injection.

### Infrastructure Wiring
- `.github/workflows/` — workflow file (not yet created).
- `package.json` — dependencies (not yet created).
- `state/seen-posts.json` — state file (not yet created).

## Architecture Insights
- The pipeline is linear: fetch → extract → keyword filter → LLM judgment → location filter → state diff → email → commit.
- The fetch mechanism is the critical path: every downstream module depends on the shape of the fetched feed.
- The state file is the only deduplication mechanism; its integrity is the system's correctness invariant.
- The GITHUB_TOKEN push for state commits does not trigger new workflow runs — this is essential for the cadence to work.
- The Gmail SMTP rate limit (~100/day) is a binding constraint at a 5-minute cadence.

## Precedents & Lessons
git history unavailable.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md` — FRD for Threads #hiring Indonesia job alerts

## Developer Context
**Q (`.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:35`): The FRD specifies a 5-minute cadence, but GitHub Actions' free tier provides only 2,000 Linux minutes/month. At 288 runs/day, a 1-minute run consumes ~8,640 minutes/month — 4.3× the free tier. Should we reduce the cadence, accept overage costs (~$40/month), or switch to a paid plan?**
A: Reduce cadence to every 10 minutes.

## Related Research
- None yet.

## Open Questions
- **Fetch mechanism (top priority)**: How do we actually get the Threads search feed from a GitHub Actions runner? Playwright headless browser, unofficial/undocumented Threads endpoints, or an indirect source — research must find the most optimal way, including whether the search page requires login and how Threads' bot detection behaves. Every other requirement depends on this answer.
- **Location derivation method**: Is location derived via keyword match, LLM inference, or both? The FRD leaves this ambiguous.
- **State file schema**: What exact structure? The FRD specifies "post IDs and metadata" but no exact schema.
- **LLM verdict parsing**: JSON mode with a boolean field, or string match? The FRD does not specify.
- **Permalink reconstruction**: Are permalinks reconstructable from post IDs as the FRD assumes? Unverified.
