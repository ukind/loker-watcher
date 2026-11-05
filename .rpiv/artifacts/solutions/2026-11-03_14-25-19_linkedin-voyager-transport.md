---
date: 2026-11-03T14:25:19+0700
author: Yogiswara Utama
commit: 4c11e0f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn voyager fetcher transport from a GitHub Actions runner"
confidence: low
complexity: high
status: ready
verdict: fail
tags: [solutions, fetch-linkedin-api, voyager-graphql, cloudflare, transport, watch-yml]
last_updated: 2026-11-03T15:25:49+07:00
last_updated_by: Yogiswara Utama
last_updated_note: "DECISION: execution split — linkedin fetches on a residential-IP machine with browser-context transport ($0/mo); judge + email stay in Actions"
---

# Solution Analysis: LinkedIn voyager fetcher transport from a GitHub Actions runner

**Date**: 2026-11-03T14:25:19+0700
**Author**: Yogiswara Utama
**Commit**: 4c11e0f
**Branch**: feature/add-support-for-linkeind
**Repository**: feature-add-support-for-linkeind

## Research Question
Which transport should the voyager fetcher replacement use to survive Cloudflare + LinkedIn anti-bot from a GitHub Actions runner — the FRD's direct Node fetch, a TLS-impersonated client, an in-runner browser context, or proxy/scraper-API fronting? (Input: research artifact `2026-11-03_12-57-53_linkedin-voyager-fetcher.md` and its 14:22 follow-up recording the live-capture transport risk.)

## Summary
**Problem**: replace the paid Linked API SDK with a free voyager client that actually returns posts from a datacenter CI runner.
**Recommended**: NO-FIT — every direct-from-runner candidate is blocked by transport-reliability evidence; the incumbent SDK path is functionally healthy (cost, not failure, drove the FRD). Decision needed on one of three re-scopes (below) before design.
**Effort**: n/a — no candidate cleared the fit filter.
**Confidence**: Low (that this candidate pool solves the FRD as scoped; the per-candidate evidence itself is strong).

## Problem Statement

**Requirements:**
- Fetch up to 500 posts per LinkedIn keyword into the existing funnel (FRD Goals)
- Zero recurring platform cost (FRD Problem & Intent — the SDK "is not free")
- The run never fails because of LinkedIn (FRD Goal; totality contract at `src/fetch-linkedin-api.ts:10-14`)

**Constraints:**
- Runtime is a GitHub Actions runner: Node 22, Azure datacenter IP pool, every 10 minutes
- Four secrets only (`LINKEDIN_LI_AT`, `LINKEDIN_JSESSIONID`, `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`); no interactive auth at runtime
- FRD Non-Goal: no Playwright/browser automation for LinkedIn
- Offline deterministic tests; injectable I/O seams

**Success criteria:**
- Posts flow every run from CI without killing the shared `li_at` session
- Degrade paths stay operator-visible (warn + skip), never run-fatal

## Current State

**Existing implementation (the incumbent — verified healthy):**
- `src/fetch-linkedin-api.ts:145-216` — `fetchLinkedInPosts`, total sequential loop; per-surface faults warn and skip; empty result is success. Graph-verified at commit 4c11e0f.
- `src/fetch-linkedin-api.ts:107-119` — `createLinkedApiClient`, the only `@linkedapi/node` import (dynamic, named); `:86-100` — `resolveLinkedApiTokens` (silent-null); `:61-78` — `LinkedApiClientLike` seam.
- Git history: `6efe6da` (added, 2026-11-03) → `250a4e1` (watch.yml wiring). **No fix commits after creation — no recorded production failure.** The module is new and works.
- The FRD's driver is cost, verbatim: *"the linkedin feature that baked inside this app, is not free. i want it to replace it entirely"* — plus volume (100/surface → 500/keyword).

**Relevant patterns:**
- Injectable trailing I/O param: `src/judge.ts` fetchFn, `src/fetch-linkedin-api.ts` clientFactory — any replacement keeps this idiom regardless of transport.
- Session-state replay: `src/threads-session.ts:42-66` (base64 storageState → temp file) — Playwright precedent already in production for Threads.

**Integration points (unchanged across all options):**
- `src/index.ts:115-118` / `:156` — `WatcherDeps.linkedinFetch` seam + production default
- `src/index.ts:195-216` — linkedin arm (resolver, caller-owned warn, belt catch)
- `src/config.ts:16-17`, `.github/workflows/watch.yml:104-105` — env pair (dies in every option)

## Solution Options

### Option 1: Direct fetch (FRD as-is)
**How it works:** raw Node fetch + cookie secrets + browser-mimic headers + 5s pacing; runner-vs-CF probe as slice 0; degrade contract covers faults.

**Pros:**
- Highest precedent-fit: the fetchFn idiom already exists twice (`src/judge.ts`, the module's clientFactory); 1 production call site adopts it
- Lowest migration cost: no new dependency; Response-double tests fully deterministic offline
- Zero recurring cost, no vendor

**Cons:**
- Transport-reliability VERY LOW — the blocker. Node/undici JA3/JA4 mismatches any browser ([Cloudflare JA3/JA4 docs](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/)); GitHub runner Azure IPs are an actively-blocked well-known pool ([community discussion #26719](https://github.com/orgs/community/discussions/26719)); LinkedIn flags datacenter IPs and challenges them ([2026 proxy guide](https://proxycove.com/en/blog/how-to-scrape-linkedin-2026-proxy-guide))
- The live capture already demonstrated the failure: ~6 curl calls → CF 302 loop → `Set-Cookie: li_at=` (empty) — a **destructive, persistent** failure. The warn+skip degrade contract assumes transient faults; this failure mode destroys the session for all future runs. A reverse-engineered voyager client recently required Chrome TLS impersonation to work at all ([K-naman-T/linkedin-profile-api](https://github.com/K-naman-T/linkedin-profile-api))

**Complexity:** Low (~2 days) — but the complexity is not where the risk lives.
- Files to create/modify: 1 module rewrite (~261 lines), 1 test file (~345), config/workflow quad
- Risk level: High (production-fatal + session-destroying)

### Option 2: TLS-impersonated fetch (CycleTLS / curl-impersonate)
**How it works:** same fetcher design; the HTTP layer presents a browser JA3/JA4 fingerprint.

**Pros:**
- Fixes the TLS-fingerprint layer; curl-impersonate (lexiforest) is active — v2.3.2 shipped 2026-10-30 with static linux binaries ([releases](https://github.com/lexiforest/curl-impersonate/releases))
- Zero recurring cost; CI-mechanically fine

**Cons:**
- Transport-reliability LOW — fixes JA3 only. Spoofing clients run no JavaScript, so a Cloudflare challenge still stops them ([ScrapingBee](https://www.scrapingbee.com/blog/how-to-use-curl-cffi/)); datacenter IP reputation is the top block cause, ahead of fingerprints ([Datahut](https://www.blog.datahut.co/post/web-scraping-without-getting-blocked-curl-cffi/)); they never acquire `cf_clearance`, which the live capture showed is load-bearing
- LinkedIn-specific: cloud-host sessions get challenged ([abinashstack](https://github.com/abinashstack/linkedin-profile-api)); strictly weaker than the full headless-Chrome baseline that linkedin-jobs-scraper itself warns "may be refused in CI" ([spinlud README](https://github.com/spinlud/linkedin-jobs-scraper))
- CycleTLS mainline lags on HTTP/2 fingerprints (npm 2.0.5, last publish a year ago); new native dependency + a new transport seam shape

**Complexity:** Medium (~3-4 days: transport seam adapter, binary install in watch.yml).
- Risk level: High (same destructive session-kill failure mode as Option 1)

### Option 3: In-runner browser fetch (Playwright + storageState)
**How it works:** Playwright chromium (already in the repo for Threads) holds the session via storageState; the voyager GET is issued same-origin via the context's APIRequestContext, which shares the browser cookie jar — the exact shape that returned 200 throughout the live capture.

**Pros:**
- The empirically strongest transport of the three direct options (real browser TLS + cookie jar); first-party stable mechanism ([APIRequestContext](https://playwright.dev/docs/api/class-apirequestcontext))
- Playwright precedent already in production (`src/fetch-threads.ts:150-160`); high precedent-fit; zero recurring cost; mature ecosystem (v1.63.0, Sep 2026)

**Cons:**
- Transport-reliability UNCERTAIN — the deciding risk. A measured test found ~55-60% blocked from datacenter ASNs even with real Chrome ([proxyscraping.org](https://proxyscraping.org/blog/how-to-bypass-cloudflare-403s-with-playwright-plus-residential-proxies)); `cf_clearance` captured in the saved state does not survive across jobs on rotating runner IPs ([humanbrowser.cloud 2026](https://humanbrowser.cloud/blog/bypass-cloudflare-playwright-2026))
- Directly violates an FRD Non-Goal ("no Playwright/browser automation for LinkedIn")
- At 144 runs/day, a 40-45% failure rate means frequent challenge loops — each one risks the destructive `li_at` wipe
- New browser-lifecycle code in the runner (launch, context, teardown) behind the seam

**Complexity:** Medium-High (~4-5 days; session-state secret format, browser lifecycle, stealth hardening if pursued).
- Risk level: High-Medium (best odds of the direct options; still not reliable from CI)

### Option 4: Proxy / scraper-API fronting
**How it works:** the direct fetch routes through a residential/mobile proxy (IP fix only) or a managed unlocker (Bright Data Web Unlocker / Oxylabs Web Scraper API) that solves Cloudflare at the vendor edge.

**Pros:**
- The unlocker half clears transport-reliability (~8/10): vendor solves all five detection layers ([Bright Data docs](https://docs.brightdata.com/products/web-unlocker/features)); mature category; ~$7-13/mo at this volume ([pricing](https://brightdata.com/pricing/web-unlocker)); CI-headless via REST or proxy-mode env var; contained integration (fetchFn seam survives)

**Cons:**
- The plain-proxy half reproduces the observed failure (~2/10): proxies don't change the TLS ClientHello — "pristine residential IPs still get 403" ([DoubleData](https://doubledata.com/blog/defeating-ja3-ja4-tls-fingerprinting/))
- The unlocker half fails on migration-cost-exceeds-scope: it re-introduces a paid managed vendor — the exact thing the FRD removes — plus a compliance-approval process to pass member cookies through their edge, and the vendor sees `li_at` (full account access). Vendor litigation risk is nonzero ([Meta v. Bright Data](https://www.quinnemanuel.com/the-firm/news-events/client-alert-meta-v-bright-data-significant-decision-for-web-scraping-industry/))

**Complexity:** Low-Medium (~2-3 days for the unlocker REST/proxy variant).
- Risk level: Medium (technical risk low; vendor/privacy/scope risk high)

## Comparison

| Criteria | 1. Direct fetch | 2. TLS-impersonated | 3. In-runner browser | 4. Proxy/unlocker |
|----------|----------------|---------------------|----------------------|-------------------|
| Complexity | L | M | M-H | L-M |
| Codebase fit | H | M | H | M |
| Transport-reliability (CI) | Very low | Low | Uncertain (~40-55% pass) | Low (proxy) / High (unlocker) |
| Recurring cost | $0 | $0 | $0 | ~$7-13/mo (unlocker) |
| Session-destroy risk | High | High | Medium | Low (unlocker) |
| FRD-scope conflict | none | minor (new dep) | Non-Goal violation | re-vendors (intent violation) |

## Recommendation

**No-fit:** every candidate surfaced a blocking concern on at least one kept dimension. The incumbent SDK path is NOT broken — replacement is cost-motivated, and no free candidate survives the datacenter-runner transport reality without either violating the FRD's no-browser scope or re-introducing a paid vendor.

**Per-candidate blockers:**
- Option 1 (Direct fetch): transport-reliability — Node JA3 mismatch + GitHub-runner Azure IPs actively CF-blocked + live-captured 302-loop with destructive `li_at` wipe; the degrade contract cannot contain a persistent, session-destroying failure
- Option 2 (TLS-impersonated): transport-reliability — no JS means no `cf_clearance`; IP reputation dominates over fingerprint; strictly weaker than the headless-Chrome baseline already warned about for CI
- Option 3 (In-runner browser): transport-reliability + scope — measured 40-45% block rate from datacenter ASNs with real Chrome; violates the FRD Non-Goal (no browser automation for LinkedIn)
- Option 4 (Proxy/unlocker): migration-cost exceeds scope for the viable half — re-introduces a paid vendor with cookie-compliance approval and full-account-cookie exposure; the non-vendor half fails transport outright

**Recommended next step (decision needed, in cost-of-information order):**
1. **Confirm the incumbent's actual pain** — quantify what the Linked API SDK costs and where its park-guard complexity actually bites (`watch.yml:33-40` cancel rationale). If the pain is tolerable, retain the SDK and re-scope this FRD to "mitigate SDK cost/complexity" — the only option with proven CI behavior today.
2. **If de-vendoring is non-negotiable**, re-scope execution: split the fetch stage — linkedin fetching runs on a residential-IP machine with browser-context fetch (the empirically proven transport), Threads + judge + email stay in Actions. Note: the 2026-11-01_09-29-22 research deliberately moved linkedin OFF the local PC; this partially reverses that trade and must be decided consciously.
3. **If a new vendor is acceptable**, ratify the unlocker pivot explicitly (scope change: "free" becomes "~$10/mo"), including the cookie-exposure review.
4. **Under no configuration** ship a direct-from-runner attempt without: (a) a slice-0 CF probe gating all later slices, and (b) a challenge circuit-breaker — on the first 302-loop signature, stop fetching LinkedIn for the run and alert, never retry into the logout wipe.

**Frontmatter overrides:** `confidence: low`, `verdict: fail` per the no-fit branch.

## Scope Boundaries
- Analyzed: transport survival from a GitHub Actions runner, per-candidate, with codebase and external evidence at commit 4c11e0f
- NOT decided: incumbent-cost quantification, execution-split architecture, unlocker vendor selection — each is a follow-up design question gated on the developer's re-scope choice
- NOT touched: any source file (analysis only)

## Testing Strategy

**Unit tests (apply to whichever re-scope wins):**
- Response-double suites for the voyager mapper, restli encoder (§12.5 matrix as fixture table), exhaustion-as-success, drop-count — unchanged from the research artifact's plan
- The challenge circuit-breaker: first 302-loop signature stops the linkedin arm for the run

**Integration tests:**
- Slice-0 probe (if any direct attempt): one real call from a runner, assert non-challenge response shape, before any later slice is built

**Manual verification:**
- [ ] Quantify Linked API SDK cost + park-guard incidents from run logs before deciding the re-scope
- [ ] If unlocker: review exactly what cookie data transits the vendor edge

## Open Questions
**Resolved during research:**
- Is the SDK path broken? - No. Graph-verified at 4c11e0f (`fetchLinkedInPosts` :145-216, totality contract intact); no fix commits after `6efe6da`; FRD driver is cost, not failure
- Do any free transports survive CF from a runner? - No, per the evidence above; browser-context (the best) still measures 40-45% blocked

**Requires user input:**
- Which re-scope wins: SDK retention, execution split, unlocker pivot, or a cost-reduced hybrid?
- Is the FRD's "free" constraint hard, or does ~$10/mo unlock acceptable options?

**Blockers:**
- The destructive `li_at`-wipe failure mode — any challenged request can kill the session for all future runs; the circuit-breaker is mandatory for every direct path, and no candidate currently avoids triggering it reliably

## References
- `.rpiv/artifacts/research/2026-11-03_12-57-53_linkedin-voyager-fetcher.md` - endpoint spec, live capture, removal inventory (input artifact)
- `src/fetch-linkedin-api.ts:145-216` - the healthy incumbent (graph-verified)
- `6efe6da` / `250a4e1` - SDK fetcher creation + wiring (no follow-up fixes)
- [Cloudflare JA3/JA4 fingerprinting](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/)
- [GitHub runners blocked by Cloudflare — community #26719](https://github.com/orgs/community/discussions/26719)
- [Playwright + residential proxies block-rate measurement](https://proxyscraping.org/blog/how-to-bypass-cloudflare-403s-with-playwright-plus-residential-proxies)
- [linkedin-jobs-scraper CI refusal warning](https://github.com/spinlud/linkedin-jobs-scraper)
- [Bright Data Web Unlocker](https://docs.brightdata.com/products/web-unlocker/features)
- `H:/fork/linkedin-reverse/DOCUMENTATION.md` §14.3 - server-side logout signature

## Follow-up Analysis 2026-11-03T14:56:36+07:00

Both outstanding measurements closed. The incumbent question flips from "is it worth replacing?" to "it is already dead in production — replacement is revival, not swap."

### Measurement 1 — the SDK path returns zero posts in production (gh run logs, main, 2026-11-03)
- All sampled runs carry the identical failure line:
  `fetch: linkedin/#hiring frontend developer indonesia FAILED — no flagship-web response within 30000ms — the session may be dead`
  Runs checked: 41596748130 (07:30Z), 41593447526 (07:00Z), 41590296572 (06:32Z), 41587183681 (06:02Z), 41578503299 (04:32Z) — 5/5 failed; no linkedin success or extract line in any.
- Empty-as-success masks it: every run still concludes "success"; the one warn line is the only sign the arm is dead. The earlier graph+git "healthy incumbent" reading measured the contract, not the service — superseded by this log evidence.
- Production main runs ONE linkedin surface (`#hiring frontend developer indonesia`) and passes a `LINKEDIN_SESSION_STATE` secret into the SDK step. The dead-session signature means the LinkedIn session linked behind the vendor's cloud browser expired. Revival = manual re-link on the vendor (recurring ops burden), not a code fix.
- The 05:00Z/05:30Z workflow failures were the judge gating probe (openrouter account dead / ceiling 0), unrelated to linkedin.

### Measurement 2 — the cost that drove the FRD
- Linked API list price: $69/mo Core ($49/mo billed annually), Plus $99/$74 — flat per-seat, verified October 2026 ([linkedapi.io/pricing](https://linkedapi.io/pricing), [swarmhit review](https://www.swarmhit.com/blog/linked-api-review), [salesforge review](https://www.salesforge.ai/blog/linked-api-review)). ~$588-828/yr for one seat.

### Revised decision framing (supersedes the ranking in Recommendation)
- **Retain-SDK** now = keep paying ~$49-69/mo AND manually re-link the session to revive a surface that currently returns nothing. Not a stable status quo — it is the dead state plus rent.
- **Execution split** (browser-context fetch on a residential-IP machine, $0) gains weight: it is the only candidate whose transport was empirically proven against LinkedIn (the live capture). Requires an explicit decision: second runtime + secret/state handling.
- **Unlocker pivot** unchanged (technically clears, ~$7-13/mo, cookie-approval friction, vendor sees `li_at`).
- The no-fit verdict on the FRD's direct-from-runner scope is UNCHANGED and now stronger: the incumbent is dead, the free runner candidates are blocked — the real decision is execution-split vs unlocker vs revive-and-retain.
- Interim: while deciding, the linkedin arm is a no-op with one warn per run; runs stay green. Revival requires the manual re-link.

**Requires user input (updated):** choose (a) revive-and-retain SDK (~$49-69/mo + re-link ops), (b) execution split ($0, second runtime + secret/state handling), (c) unlocker pivot (~$7-13/mo, vendor cookie exposure), or (d) drop linkedin from the funnel until decided.

**RESOLVED 2026-11-03T15:25:49+07:00:** the developer chose (b) **execution split**. Design-stage inputs recorded:
- PC side: browser-context voyager fetch (the live-capture-proven transport: browser TLS + cookie jar + CF clearance), residential IP, linkedin session kept alive there
- Actions side unchanged: threads fetchers, judge, email, state commit-back
- Open design questions: result hand-off PC → Actions (file/PR/artifact/email), scheduling around PC uptime, seen-state continuity (ids stay `urn:li:activity:<id>` — no re-judging across the split), whether the branch's direct-fetch module code is salvaged as the PC-side fetcher core
- Interim until the split ships: the linkedin arm keeps no-oping with one warn per run; runs stay green
