---
date: 2026-11-01T09:29:22+0700
author: Yogiswara Utama
commit: 14aaf74
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Run the LinkedIn watch on a host that is not the developer's PC — host landscape, enforcement recon, and the fetch-split vs whole-run question"
tags: [research, linkedin, fetch-linkedin, watch-yml, linkedin-session, self-hosted-runner, residential-egress, state]
status: ready
last_updated: 2026-11-01T09:29:22+0700
last_updated_by: Yogiswara Utama
---

# Research: Run the LinkedIn watch on a host that is not the developer's PC

## Research Question
Chained from `.rpiv/artifacts/discover/2026-11-01_09-21-30_linkedin-watch-off-my-pc.md`. Pick the free, account-safe host with residential-class egress for the LinkedIn leg, then decide: (a) move only the LinkedIn fetch there and POST the Post[] JSON back to the GitHub Actions run for merge before dedupe, or (b) relocate the whole runWatcher. Research owns both the host question and the split question, plus the discover-deferred verification of "no cloud CI can work".

## Summary
1. **The generalization is verified: every free cloud platform egresses from datacenter IP ranges.** Checked per-platform (Oracle Always Free, AWS/GCP/Azure, Fly.io, Render, Railway, Koyeb, Replit, Codespaces, GitHub-hosted Actions, GitLab shared runners) — all publish or describe datacenter/shared egress; none claims residential. Practitioner sources (2025-2026) are unanimous that LinkedIn rejects the datacenter class; the repo's own 4-CI-failure/1-home-success evidence matches the documented pattern exactly.
2. **The only free path to residential egress is an always-on device at a residential IP.** The best-documented shape: a **GitHub self-hosted runner** (free unlimited minutes, ARM64-supported, outbound-443-only so it works behind any home NAT, repo-scoped for private repos) on a Raspberry Pi 4/5 (4GB+, 64-bit OS), used mini-PC, or old laptop at any household. Jobs queue up to 24h while the device is offline; the runner self-removes after 14 days offline.
3. **A self-hosted runner is still GitHub Actions** — it inherits all four Actions-owned contracts unchanged: secrets delivery (watch.yml:90-100), the state commit-back (watch.yml:131-206), the 8-minute run cap (watch.yml:55), the concurrency queue (watch.yml:10-13), and the session-refresh step (watch.yml:103-131). This makes the fetch-only split unnecessary for the leading host candidate; the split survives only as the fallback if the host cannot run the whole workflow.
4. **Red-team recon produced an enforcement map**: the CI bounce is a request-layer soft block keyed on IP class + IP share (page shell served, authenticated flagship-web XHRs withheld — exactly the observed 30s timeout). Cookies are not device-bound (silent pass on residential reuse, proven by the home run). The documented residual risk is **session-jumping** — simultaneous distant-IP sessions on one account — so the design must single-home the cookie to the runner and ideally mint the session on the device once.
5. **Option (a) is verified genuinely additive**: the merge seam is one line (src/index.ts:258), dedupePosts is id-keyed first-seen-order (src/index.ts:454-462), mintPost derives id+permalink+timestamp deterministically from the activity id (src/fetch-linkedin.ts:171-180), so a stateless remote host re-POSTing duplicates is safe. The failure contract is a catch shaped like src/index.ts:244-247 placed inside the acquisition timeStage span (src/index.ts:168-256) with its own hard deadline.
6. **Option (b) on a raw non-Actions host must re-provide** the durable seen-state store, the login-cooldown marker store, the session-refresh channel, the run cap, and the run queue — and carries a hidden ENOENT crash (writeLoginMarker does no mkdir) plus a fail-open cooldown. On a self-hosted Actions runner all of that disappears.
7. **No alternative free access mode reads hashtag feed content**: guest jobs API is jobs-only, the official API has no post search at any tier, RSS is dead. First-party content-search alerts exist (free, zero account risk, notification-only — a degraded backup channel). Paid data providers work but violate the free-only budget rule.
8. **bladebro / the developer's PC cannot be the host** (PC-off is the acceptance criterion); the headed login remains the operator repair hatch.

## Detailed Findings

### The merge seam (split option a)
- The acquisition stage is one timeStage call: `const { value: collected, durationMs: fetchMs } = await timeStage(...)` at src/index.ts:168-256, printed as `timing: fetch Nms` at src/index.ts:257.
- `collected` is consumed exactly once: `const posts = dedupePosts(collected)` at src/index.ts:258. A remote batch must be concatenated into that value; after :258 there is no re-entry until the next 10-minute tick (and a missed tick is not a lost post — unpersisted posts are re-collected next run).
- The stage has five return paths inside the span (src/index.ts:207, 212-217, 225-228, 229, 243/247). The only placement touching zero existing lines is between span close (:256) and dedupe (:258): `dedupePosts([...collected, ...remotePosts])`. Keeping the remote pull inside the span preserves the truthful `timing: fetch` reading that the F023 envelope arithmetic consumes (watch.yml:49-54).
- dedupePosts (src/index.ts:454-462) is a pure id-keyed Set filter — an empty remote arm is the identity transform, so the dependency is genuinely additive.
- LinkedIn ids are deterministic: mintPost (src/fetch-linkedin.ts:171-180) builds `urn:li:activity:<id>` plus permalink plus `BigInt(id) >> 22n` timestamp from the activity id alone; src/types.ts:14 documents that urn ids cannot collide with Threads digit ids. Re-POSTed duplicates dedupe for free and age out via recency (filterRecent, src/recency.ts:12-23, applied at src/index.ts:262 BEFORE loadState at :282).
- The remote arm's catch must clone src/index.ts:244-247 (warn + return Threads-only/empty) — nothing between span close and Gate 1 catches, so an escaped throw kills Threads posts too. It also needs its own hard deadline (AbortSignal idiom) so a hung host cannot eat the judge-wave reserve (~249-289s, watch.yml:44-55).

### Seen-state ownership
- Today exactly one writer: loadState prune-on-load (src/index.ts:282 → src/state.ts:139), diffNew (src/index.ts:283 → src/state.ts:166-170), notify strictly before persistJudged (src/index.ts:342-344 then :346; def :426-436 → saveState src/state.ts:241, atomic write 209-238, judged-gate + sibling-temp).
- Option (a): the remote host is stateless-safe. In-run cross-source dedupe keys on the urn id; cross-run dedupe keys on the same ids in state/seen-posts.json; the only crash window (Actions dies after receiving the batch) degrades to exactly today's accepted at-least-once semantics — verbatim in watch.yml:135 ("the audit accepts one duplicate digest") and src/index.ts:341 ("the next run re-judges and re-sends these matches"). No new state writer is created.
- Option (b) on a raw host: the commit-back actually owns TWO files — state/seen-posts.json and the login-cooldown marker state/linkedin-login.json (marker path derived at src/index.ts:376 as `join(dirname(statePath), "linkedin-login.json")`). A relocated run needs replacements for the seen-set store (v2 AppState shape), the marker store, and the secret-refresh hand-off. The two-writer hazard is concrete: concurrency (watch.yml:10-13) + force-with-lease (watch.yml:178/200) protect only Actions-local writers.
- Hidden crash path on a fresh raw host: writeLoginMarker does a bare writeFile with no mkdir, so missing-LinkedIn-session → failed login throws ENOENT out of the acquisition stage → exit 1. Unreachable on Actions (checkout materializes state/); a raw-host wrapper must pre-create the directory.

### Session secret lifecycle (three legs)
- Read leg (host-agnostic): resolveSession (src/threads-session.ts:37-69) decodes base64 LINKEDIN_SESSION_STATE into an mkdtemp storage-state.json, shape-checked (non-empty cookies), consumed at src/index.ts:178 via ENV_NAMES.linkedinSession (src/config.ts:13-26); the context factory attaches it at src/fetch-threads.ts:151-158. Any host mechanism that puts the base64 blob into the env satisfies this leg byte-for-byte.
- Write-back leg (Actions-specific): recoverLinkedInSession (src/index.ts:365-433) base64-writes the fresh session to LINKEDIN_REFRESH_PATH (src/index.ts:411-415, silently skipped when the var is absent); watch.yml:103-131 converts the file's existence into `gh secret set LINKEDIN_SESSION_STATE` with the LINKEDIN_SECRET_WRITER PAT, and on PAT failure writes a challenge-shaped 6h cooldown marker (watch.yml:123-127). GitHub cannot read secret values back — a split host cannot pull the session from Actions at run start.
- Marker leg: ephemeral Actions disk → git commit-back (watch.yml:139-146). On a persistent host this leg is free (the file just sits there); the workflow's PAT-failure shim becomes not-applicable if Actions no longer holds a secret copy.
- Known debt on this glue: TECH_DEBT_AUDIT N3 (rebase conflict-skip whitelist only allows seen-posts.json — a conflicted marker file fails the run), N4 (refresh step success-only gate), N5 (shell-written marker is non-atomic).

### Account-safety contract
- loginLinkedInContext (src/linkedin-login.ts:174-228) classifies outcomes: /checkpoint/ → "challenge", /login stay → "bad-credentials", infra faults → "transient"; a URL-said-ok without an li_at cookie is reclassified bad-credentials. Only a genuine verdict or 3 consecutive transients writes the 6h cooldown (LOGIN_COOLDOWN_MS; TRANSIENT_ESCALATION_ATTEMPTS = 3) — the escalation exists specifically because "the runner IP is blocked" is a persistent fault.
- Under a split, the credential login must move to the residential host (a datacenter login is exactly the challenged pattern), taking LINKEDIN_EMAIL/LINKEDIN_PASSWORD (watch.yml:94-98) with it. The Post[] POST channel does not carry sessions today; either the session+login are both host-local (trivial) or the payload must carry the base64 session back (new code both ends).
- The operator escape hatch scripts/linkedin-login.ts assumes the dev PC is the residential IP and delivers to Actions secrets (prints `gh secret set`). Under a relocated store it repairs the wrong store; it stays the human repair path (solve a challenge from any residential IP, then deliver the jar to the host).

### Non-fatal degradation + budget
- Three existing tiers: resolver-null skip-warn (src/index.ts:193-197), login fallback returning null on every failure path (src/index.ts:365-433), and the catch around the LinkedIn-only dispatch (src/index.ts:236-248); the mixed dispatch needs no caller catch because per-surface side arrays keep failures non-throwing (src/fetch-threads.ts:331-427, all-fail throw at :397-409).
- Remote failure modes map: unreachable host → tier-1 shape; failed POST-back/timeout → tier-3 shape (warn + continue); malformed JSON → element-wise null-drop (the extract.ts readPk precedent), whole-payload catch as fallback. The contract is a property of catch placement (inside the span, return-don't-rethrow), not of the transport.
- The run's hard envelope: 8-minute job cap (watch.yml:55) minus 60-100s setup minus 71s fetch worst case minus 60s abort tail leaves ~249-289s for judge waves (watch.yml:44-55). Any synchronous dispatch-then-poll delivery competes with that budget; asynchronous delivery (host pushes, next tick consumes) adds up to one cadence of latency.
- Gate 1 (src/index.ts:285-294) is the acceptance oracle for "killing the host mid-run leaves the next run green": absent payload → warn + Threads-only → possibly zero unseen → heartbeat only, saved: false, state byte-identical, commit-back no-ops (watch.yml:147-150).

### Delivery paths for Post[] under option (a)
- Git push of a JSON blob: consumed asynchronously by the next cron checkout; disjoint paths rebase cleanly, but a payload-file conflict or double lease-rejection fails the whole run AFTER judging succeeded — a green-judge/red-run outcome FRD #5 does not sanction (watch.yml:167-171, 203-204). Adds a writer to main.
- Actions artifact: needs actions: read (watch.yml:8-9 grants only contents: write) or a PAT; retention means staleness checks are mandatory; consumption code sits inside the span.
- repository_dispatch: not a trigger today; 64KB client_payload cap is below plausible pool sizes (LINKEDIN_MAX_POSTS = 150), so it degenerates into a pointer; a PAT is required (GITHUB_TOKEN events don't trigger runs).
- Hosted HTTP endpoint polled at run start: the runner's datacenter egress is irrelevant for the JSON endpoint (the anti-bot surface is LinkedIn's); one bounded GET inside the span; asynchronous form keeps the exit-code contract by placement.
- Staleness: Post.timestamp + filterRecent bounds stale payloads before judging; transport-level freshness checks keep the warn truthful and avoid burning LLM budget on a dead snapshot.

### Config surface + wire schema
- resolveSurfaces (src/config-file.ts:220-238) stamps the platform discriminant; linkedinSearchUrlFor (src/config-file.ts:252-257) compiles keywords + sortBy + datePosted into the search URL — the whole query policy lives in this one pure function. The exact reroute line is src/index.ts:175 (`surfaces.filter((s) => s.platform === "linkedin")`).
- scrollRounds flows config → AuthenticatedFetchOptions (src/fetch-threads.ts:300-305) → the walk's round ceiling (src/fetch-linkedin.ts:318-338); the default is duplicated in the code (DEFAULT_SCROLL_ROUNDS at src/config-file.ts:193 vs MAX_SCROLL_ROUNDS at src/fetch-threads.ts:78), an argument for carrying it explicitly on the wire.
- Post (src/types.ts:10-23) is six JSON-safe strings; the BigInt is consumed inside mintPost, so the wire is zero-transform. The judge reads author+text only (src/judge.ts:238, :256, keyed by id at :750); the digest reads author/platform/text/permalink (src/email.ts:74-77); heartbeat reads text/timestamp/author/permalink (src/heartbeat.ts:74-77, :129-133); "linkedin-member" placeholder is functionally inert downstream.
- The protocol must preserve the walk's three-outcome terminal (success / legit-empty / bounce, distinguished by the page.url() guard at src/fetch-linkedin.ts:301-310) or the D5 skip-warn fires on quiet windows and a bounce masquerades as green. Actions side validates on ingest (urn pattern, platform value, ISO timestamp — recency's NaN guard would otherwise silently drop).
- Under split (a) the acceptance oracle relocates: the `fetch: linkedin/... OK` lines emit on the remote host, so either the adapter echoes remote stdout into the Actions log or the acceptance grep moves to the host's log.

### Whole-run relocation inventory (option b)
- Everything injectable: WatcherDeps (src/index.ts:115-132, doc 107-114) with production defaults resolved at src/index.ts:153-157. The module is importable side-effect-free (entry guard src/index.ts:468-485) — a wrapper can call runWatcher() directly, but must replicate the guard's exit-code semantics (rotation-exhaustion alarm email + exit 1 live in the guard, not in runWatcher).
- Option (b) moves the whole secret surface: THREADS_SESSION_STATE, LLM_ACCOUNTS (src/judge.ts:132-190), GMAIL_USER/GMAIL_APP_PASSWORD (src/email.ts:32-46), HEARTBEAT_ENABLED, plus JUDGE_CONCURRENCY (benign default) — versus only LINKEDIN_SESSION_STATE (+ credentials if the login moves) for option (a).
- Host-affinity: judge fetchFn and SMTP are datacenter-fine; the LinkedIn walk is the only residential-motivated dependency; the Threads walk is Actions-tolerated today (src/fetch-threads.ts:13-16).
- Actions silently provides four contracts a raw host must re-provide: durable state (watch.yml:131-206), the run cap (watch.yml:55), the run queue (watch.yml:10-13), and the session self-refresh loop (watch.yml:103-131 + src/index.ts:411-415). Without the last one a successful credential login produces a session that dies with the host.
- Runtime envelope: Node >= 22 + npm ci + tsx (package.json), playwright chromium headless-shell — which IS the current production browser (headless: true + no channel under Playwright 1.49 semantics), and page.mouse.wheel is core input dispatch, so --only-shell survives (validated live per src/fetch-linkedin.ts:28-32). A raw host must supply chromium shared libs (Actions runner image carries them; a bare SBC needs a one-time deps pass). Up to 4 concurrent headless pages (FETCH_CONCURRENCY = 4, src/fetch-threads.ts:41).
- Walk timing constants are wall-clock sleeps (src/fetch-linkedin.ts:44-54, flagged PLACEHOLDERS); CPU throttling stretches the two 30s windows, not the sleeps. A silently broken wheel on a foreign host masks as "OK — 0 post(s)" (src/fetch-linkedin.ts:303-310) — validate hosts by the "from N response(s)" counter (src/fetch-linkedin.ts:341).

### Host landscape (web recon)
- All free clouds are datacenter-egress: GitHub publishes Actions ranges via the REST API meta endpoint ("multi-cloud compute pool" of datacenter ranges); GitLab Linux runners are GCP, macOS runners AWS; Oracle/AWS/GCP/Azure publish CIDR lists; Fly (NAT'd, static egress is paid), Render (shared per-region), Railway (shared; static is Pro), Koyeb (no list), Replit (shared) — none claims residential.
- Self-hosted runners: free unlimited minutes including private repos; physical/virtual/on-prem ARM64; outbound HTTPS 443 only (~70 kbps); repo-scoped registration; offline jobs queue (fail after 24h queued); auto-removed after 14 days offline. Security model: the device holder controls every secret the workflow delivers; fine for a physically-owned device in a private single-contributor repo; never for public repos.
- Headless chromium shell runs on ARM SBCs (Playwright supports arm64 Linux); community guidance: Pi 4 4GB floor, Pi 5 4-8GB comfortable, ≥2GB workable with tuning (evidence is community-reported, not official).
- Relay options (Tailscale exit node, WireGuard home, Cloudflare Tunnel) all still require an always-on home device — Cloudflare Tunnel explicitly does NOT route server-initiated traffic; they only make sense to keep a weak device as the IP provider while a VM runs Chromium.
- Free residential-proxy services: none exist safely; "free" pools are shared with abusive traffic — the exact thing the account-safety constraint rules out.
- Practitioner reports: LinkedIn blocks known datacenter ASNs (AWS/GCP/Hetzner named; "the block happens at the session level, not the action level"); Oracle free-tier IPs widely flagged first-hand; no documented clean cloud ranges.

### LinkedIn enforcement map (red-team recon)
- Request/edge layer: IP class + share + TLS/JA3 + headers + velocity → silent soft block (page shell, withheld XHRs — the CI symptom) or 999. AWS/GCP/Hetzner ASNs documented; Azure-via-GitHub-Runners in-class. ~50-60 anonymous requests/15min → hard 999 on that IP. Cloudflare bot management (__cf_bm) sits in front; LinkedIn's cookie table documents denial-client-ip (edge IP stamp) and li_cu (challenge-state cookie, 15min).
- Session/challenge layer: challenges key on login from unfamiliar location/device/country; "session jumping" (simultaneous distant-IP sessions) is a documented primary flag ("high risk of account lock pending verification"); mid-session re-verification is periodic but less common. A pre-existing li_at used from a new IP passes SILENTLY when context matches (residential, consistent fingerprint — proven by the home run) and draws scrutiny when class/geo/fingerprint mismatch. No public evidence of a hard li_at↔device binding; correlation is soft.
- Account layer: enforcement targets velocity, multi-tool IP counts, shared infra fingerprints; vendor-infrastructure enforcement tightened through March 2026 (~40% restriction cohort on shared cloud tools). Documented warm-up is account-action warm-up, not IP warm-up; vendors endorse 1 account = 1 static IP.
- Design constraints that fall out: single-home the cookie to the runner's IP context; do not interleave datacenter runs; mint the session on the device once so its IP history matches the runner; modest pacing. Vendor precedent shows stable dedicated IPs survive even in datacenter ranges — but shared CI pools are the flagged pattern.
- Access-mode table (ranked): 1) logged-in walk from residential IP — only free mode reading feed content (proven); 1b) same on a paid static residential IP (~$3-5/mo — excluded by budget); 2) first-party content-search alerts — free, zero risk, notification-only, no API (backup channel); 3) paid providers (HarvestAPI/Scrape Creators/Apify, $1.20-5.50/1k posts) — excluded by budget; 4) guest jobs API — jobs only, cannot read feed content (confirmed against JobSpy production code); 5) job alert emails — jobs only; 6) official API — no post search at any tier, feed use contractually banned; 7) RSS — dead; 8) Talent/partner APIs — paid, gated.
- Out-of-scope by account-safety doctrine (documented, rejected): automated checkpoint solving, throwaway-account rotation, shared proxy pools, stealth-patching as the primary fix (hygiene, not a solution — the IP is the flagged variable).

### Logged-out probe (live, from the developer's home IP, 2026-11-01)
- GET search-results/content URL logged-out → HTTP 307 (to the authwall flow), with curl UA and Chrome UA alike; empty body. Confirms anonymous LinkedIn can never be the content path (the codebase's D5 note).
- GET /jobs/search guest page → HTTP 200 logged-out; guest jobs API endpoint reachable (returned generic HTML shell under the queried name — JobSpy's live code uses seeMoreJobPostings/search). Consistent with recon: guest surface is jobs-only.
- The probe used 5 harmless unauthenticated GETs; no credentials involved.

### Probe protocol for a candidate host
- Deterministic half offline: replay captured flight bodies through collectLinkedInPosts/parseFlightRows (src/fetch-linkedin.ts:189-253, :77-90) — importing fetch-linkedin.ts never loads Playwright.
- Environmental half on-host: call fetchLinkedInSurface (src/fetch-linkedin.ts:256-346) with resolveSession + chromiumContextFactory, stored session ONLY (never the credential login from an unproven host — a challenge there writes the 6h cooldown).
- Acceptance oracle: success line `fetch: <label> OK — N post(s) from M response(s)` (src/fetch-linkedin.ts:341) with M ≥ 2 (proves a pagination response also survived, not a one-off); treat `OK — 0 post(s)` (:306) as INCONCLUSIVE (an IP-level block can manifest as an empty window; the URL guard only catches redirect-shaped bounces); any bounce throw (:309-310) is immediate rejection.
- Repetition: ≥ 2 probe sessions spaced ≥ 6h apart (the cooldown window), both surfaces OK. The 4-failure CI evidence can be reproduced on any datacenter free tier with the same binary + session to close the FRD's open generalization — everything except egress is pinned.

## Code References
- src/index.ts:107-114 — WatcherDeps doc contract: every field has a production default; full runs execute offline
- src/index.ts:115-132 — WatcherDeps fields (env, config, contextFactory, fetchFn, transport, statePath, now, sleepFn)
- src/index.ts:152 — runWatcher entry; defaults resolved 153-157
- src/index.ts:168-256 — acquisition timeStage span; five return paths; paired session-dir cleanup finally 249-252
- src/index.ts:174-175 — platform split filters (175 is the exact LinkedIn reroute line)
- src/index.ts:178 — LinkedIn session resolution via ENV_NAMES.linkedinSession
- src/index.ts:185-197 — credential-login fallback trigger + resolver-null skip-warn (D5 tier 1)
- src/index.ts:236-248 — LinkedIn-only arm try/catch; the warn-and-continue template (:244-247) for any remote arm
- src/index.ts:258 — dedupePosts(collected) — THE merge seam for a remote Post[]
- src/index.ts:262 — filterRecent application (before loadState)
- src/index.ts:282-283 — loadState prune-on-load + diffNew
- src/index.ts:285-294 — Gate 1: zero unseen → heartbeat, saved: false, no disk write
- src/index.ts:342-346 — digest strictly before persistJudged (notify-before-persist)
- src/index.ts:365-433 — recoverLinkedInSession: cooldown-gated login, refresh hand-off 411-415, marker path 376
- src/index.ts:426-436 — persistJudged → saveState
- src/index.ts:454-462 — dedupePosts (id-keyed, first-seen-order)
- src/index.ts:468-485 — entry guard: importable side-effect-free; exit-code semantics live here
- src/fetch-linkedin.ts:41-54 — timing constants (PLACEHOLDERS pending live retune)
- src/fetch-linkedin.ts:60-64 — AUTHOR_PLACEHOLDER + LINKEDIN_RESPONSE_RE (the two flagship-web endpoints)
- src/fetch-linkedin.ts:77-90 — parseFlightRows (pure, Playwright-free)
- src/fetch-linkedin.ts:169-181 — mintPost: id, permalink, timestamp all derived from the activity id
- src/fetch-linkedin.ts:189-253 — collectLinkedInPosts (pure string → Post[])
- src/fetch-linkedin.ts:256-346 — fetchLinkedInSurface walk; listener 265-282; first-response poll 292-300; empty-rescue URL guard 301-310; bounce throw 309-310; wheel loop 318-338; success line 341
- src/fetch-threads.ts:41 — FETCH_CONCURRENCY = 4
- src/fetch-threads.ts:148-158 — makeChromiumContextFactory: sole Playwright import; storageState attach; headless shell is the production browser
- src/fetch-threads.ts:300-305 — AuthenticatedFetchOptions (scrollRounds at 304)
- src/fetch-threads.ts:331-427 — fetchSurfacesAuthenticated: side arrays, lazy base context, platform ternary 381-383, all-fail throw 397-409
- src/threads-session.ts:37-69 — resolveSession: base64 env → temp storage-state.json (host-agnostic read leg)
- src/linkedin-login.ts:174-228 — loginLinkedInContext outcome taxonomy (challenge / bad-credentials / transient)
- src/linkedin-login.ts — LOGIN_COOLDOWN_MS 6h, TRANSIENT_ESCALATION_ATTEMPTS 3, loginAllowed fail-open marker gate
- src/config.ts:13-26 — ENV_NAMES (single secret registry)
- src/config.ts:54 — STATE_PATH default
- src/config-file.ts:193 — DEFAULT_SCROLL_ROUNDS = 8 (duplicated as MAX_SCROLL_ROUNDS, src/fetch-threads.ts:78)
- src/config-file.ts:220-238 — resolveSurfaces platform stamping
- src/config-file.ts:252-257 — linkedinSearchUrlFor (whole query policy in one pure function)
- src/state.ts:139 — loadState (ENOENT → fresh; prune-on-load 115-136; migrate :57)
- src/state.ts:166-170 — diffNew
- src/state.ts:209-238 — writeStateAtomic (sibling temp + rename)
- src/state.ts:241 — saveState (judged-gate; zero ids → saved: false)
- src/types.ts:10-23 — Post: six JSON-safe strings; ids never Number-coerced
- src/recency.ts:12-23 — filterRecent (NaN-guarded timestamp compare)
- src/judge.ts:132-190 — parseLlmAccounts
- src/email.ts:32-46 — resolveEmailConfig; digest render 74-77
- src/heartbeat.ts:74-77, 129-133 — candidate selection + render
- scripts/linkedin-login.ts:1-130 — headed operator escape hatch; prints gh secret set (assumes dev PC is the residential IP)
- .github/workflows/watch.yml:4-5 — cron */10 + workflow_dispatch (only triggers)
- .github/workflows/watch.yml:10-13 — concurrency group watch, cancel-in-progress: false (the run lease)
- .github/workflows/watch.yml:44-55 — F023 envelope arithmetic + timeout-minutes: 8
- .github/workflows/watch.yml:69-87 — ms-playwright cache + install --only-shell chromium
- .github/workflows/watch.yml:90-100 — step-scoped secret env block (LINKEDIN_* at 94-98)
- .github/workflows/watch.yml:103-131 — Refresh LinkedIn session secret step (gh secret set :120; PAT-failure cooldown marker 123-127)
- .github/workflows/watch.yml:131-206 — Commit state: adds 139-146, no-op 147-150, rebase skip 150-176, lease pushes 178/200
- tests/fetch-linkedin.test.ts:375-380 — offline assert of the bounce throw; :16-19 Playwright-free imports

## Integration Points

### Inbound References
- .github/workflows/watch.yml:90-100 — delivers LINKEDIN_SESSION_STATE/EMAIL/PASSWORD/REFRESH_PATH + all other secrets as step env
- .github/workflows/watch.yml:103-131 — converts the LINKEDIN_REFRESH_PATH hand-off file into a secret write-back (reads what recoverLinkedInSession wrote)
- .github/workflows/watch.yml:139-146 — commits state/linkedin-login.json alongside state/seen-posts.json
- src/index.ts:174-175, 178, 185-192 — the acquisition stage's LinkedIn filters, session resolution, login fallback
- src/fetch-threads.ts:357-365, 381-383 — walkLinkedInSurface + platform ternary route LinkedIn surfaces to the walk
- tests/fetch-linkedin.test.ts — offline suite pins mint shape, parser, and the bounce throw
- scripts/linkedin-login.ts — operator repair hatch feeding the same secret the resolver reads

### Outbound Dependencies
- src/threads-session.ts:37-69 — session secret decode (the only secret consumer for the leg)
- src/linkedin-login.ts — outcome classification + cooldown marker read/write (sibling of statePath)
- src/config-file.ts:252-257 — the search URL builder (query policy owner)
- src/recency.ts:12-23 + src/state.ts — the two dedupe layers a remote batch must survive
- src/config.ts:13-26 — ENV_NAMES registry every env name must join

### Infrastructure Wiring
- .github/workflows/watch.yml:4-13 — cron */10 + concurrency lease (the 10-minute cadence everything is sized against)
- .github/workflows/watch.yml:44-55 — 8-minute cap + F023 judge-reserve arithmetic
- .github/workflows/watch.yml:69-87 — browser install (headless shell; runner image carries shared libs)
- .github/workflows/watch.yml:131-206 — state commit-back (rebase + conflict-skip + force-with-lease)

## Architecture Insights
- WatcherDeps total-default DI is what makes every relocation option a config exercise, not a fork: a remote wrapper, a probe script, and a remote fetch adapter all hang off existing seams.
- Warn-and-continue is tiered by producer: resolver null → skip-warn; adapter throw → caller catch; per-surface failure → side arrays. Any new failure source must pick a tier, land inside the acquisition span, and return (never rethrow).
- Deterministic id minting (id → permalink + timestamp) makes provenance irrelevant downstream — the entire split's correctness rests on it plus notify-before-persist.
- statePath does double duty (dirname is the marker home) — a hidden coupling any split trips over first.
- The durable store is the workflow, not the app: git commit-back + concurrency lease + force-with-lease. Relocation designs must say which layer replaces each.
- Only measured values are env-tunable (repo doctrine): a new host's retune evidence should land as measured-evidence comments, per the JUDGE_CONCURRENCY precedent (7cc7250).

## Precedents & Lessons
6 similar past changes analyzed.

### Precedent: LinkedIn credential-login fallback with workflow secret refresh (closest analog)
**Commit(s)**: 2b74c61 — "feat: linkedin credential-login fallback with workflow secret refresh" (2026-11-01)
**Blast radius**: 11 files across 4 layers (workflow env+refresh step, recoverLinkedInSession, NEW linkedin-login.ts, NEW operator hatch, +753 test lines)
**Follow-up fixes**: 216a617 — empty-window mislabeled as dead session (the throw that later masked the CI failures); b5d72f8 — surfaces broadened only after live local runs; 14aaf74 — massive same-day seen-state churn
**Lessons from docs**: plans/2026-10-31_17-03-00 — login selectors falsified by live DOM probes (#session_key dead; submit button locale-dependent "Login" vs "Sign in"); Kaspersky denies network to HEADED chromium on the dev machine (headless unaffected). validation/2026-11-01_08-00-29 — all Phase 7 CI-leg operator items still open (CI login + secret refresh never verified live in Actions).
**Takeaway**: "validated offline" ≠ "validated in CI" — budget a live probe pass on the real host before trusting it; the state commit-back glue this feature rides is the repo's most debt-prone surface.

### Precedent: LinkedIn second-surface walker in the Actions watch job
**Commit(s)**: 68c1e2d — "feat: linkedin second surface with configurable scroll rounds" (2026-10-31, merged via 3a61ca5 PR #5)
**Blast radius**: 24 files across 5 layers (config spine, contracts, NEW fetch-linkedin.ts, dispatch host, pipeline, judge neutrality, email marking, workflow secrets, 10 test files)
**Follow-up fixes**: 216a617 (within ~12h of first real runs); ced76f8 (unexport internal symbols)
**Lessons from docs**: research/2026-10-31_08-01-06 — ~250 req/day/account tolerance reading, 999 rate limiting, scroll pacing 2-12s, sessions "stricter and shorter-lived than Threads"; plans Phase 8 — wheel/settle constants are unmeasured PLACEHOLDERS (93a3f38 is the retune-evidence pattern).
**Takeaway**: tuning constants on a new host will need a measured retune commit with fresh evidence; session death is routine and must degrade, never throw.

### Precedent: Authenticated Threads fetch in CI (the working counter-example)
**Commit(s)**: 9e1c8ef — "feat: authenticated threads fetch with recency cutoff" (2026-10-25)
**Blast radius**: 12 files (base64-secret contract, NEW threads-session.ts, NEW fetch-threads.ts, watch.yml env)
**Follow-up fixes**: none — the session-in-Actions contract has been stable for Threads.
**Takeaway**: the fetch is cleanly separable (plain Post[], opaque ids), but the secret contract was designed under a Threads tolerance LinkedIn does not share.

### Supporting precedents
- 510ff2a → 89c8bc5 → 8b777e6 → 45bcbd3 → 2e28916 → bc760cb (2026-10-30/31, six commits) — the commit-back absorbed a full fix chain in one day and is still buggy for the marker file (N3). Treat commit-back machinery as the fragile core.
- 7cc7250 (2026-10-27) — JUDGE_CONCURRENCY dropped to the probe reading of 4; endpoint-side limits vs datacenter traffic is a recurring failure mode; a second writer (remote fetch host) doubles contact rate.

### Composite Lessons
- Datacenter egress is proven fatal, residential is proven sufficient — single-provider evidence, now corroborated by external recon (41262910906/41263307790/41263753774/41264399768 vs local 47-post repro).
- Validated offline ≠ validated live: the empty-window misclassification and the IP bounce were both found only on real runs (216a617, the 4 CI failures). Probe on the real host before trusting it.
- Session death on LinkedIn is routine; the 6h cooldown, transient-vs-verdict split, and skip-and-continue exit-0 contract must survive any move.
- The failure diagnostic is thin for a remote host: keep the page.url() rescue (src/fetch-linkedin.ts:301-310) and the "from N response(s)" counter visible wherever the walk runs.
- Workflow glue is where the debt lives (N3/N4/N5) — keep the commit-back untouched and fix its known marker bugs before or with any change that touches it.
- Environment caveats: Kaspersky blocks headed-chromium networking on the dev machine; locale-dependent UI text means login anchors stay layout-based, never text-based.

## Historical Context (from .rpiv/artifacts/)
- .rpiv/artifacts/discover/2026-11-01_09-21-30_linkedin-watch-off-my-pc.md — the FRD chaining into this research (evidence, goals, acceptance criteria)
- .rpiv/artifacts/plans/2026-10-31_17-03-00_linkedin-second-surface-dispatch.md — the LinkedIn leg's build plan; Kaspersky note at :3018; Phase 7/8 follow-ups
- .rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md — D5/D6/D9/D12 decisions shaping the LinkedIn arm
- .rpiv/artifacts/validation/2026-11-01_06-11-59_linkedin-second-surface-dispatch.md — fail verdict (lint), superseded by:
- .rpiv/artifacts/validation/2026-11-01_08-00-29_linkedin-second-surface-dispatch.md — pass; CI-leg operator items open
- .rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface.md — LinkedIn tolerance readings (req/day, pacing, session lifespan)
- .rpiv/artifacts/TECH_DEBT_AUDIT.md — N3/N4/N5 commit-back debt, N7 escape-hatch hygiene, N8 placeholder constants

## Developer Context
**Q (discover: Success = LinkedIn digests arrive with the PC off): "When this is done, what does success look like for you — what must be true that isn't true today?"**
A: "the linkedin watcher not runnable using gitlab action, i need another ship to do it"

**Q (discover: Budget: free only): "How much monthly spend is acceptable for the thing that hosts the LinkedIn fetch?"**
A: "Free only"

**Q (discover: Account safety: the main account is precious): "How should research weigh risk to your account?"**
A: "Account is precious"

**Q (discover: Datacenter egress is the blocker; scope of the generalization deferred): "Confirm as a hard constraint?"**
A: "need research to find a way" — deferred; now resolved: every free cloud platform is datacenter-egress (verified per-platform + enforcement recon); the generalization holds.

**Q (discover: Pipeline split: fetch-only vs whole-run): "Keep this split?"**
A: "depends on research result" — deferred; research finding: on a self-hosted Actions runner the split becomes unnecessary (it inherits all Actions contracts); the split is the fallback only if the host cannot run the whole workflow.

**Q (checkpoint: bladebro): "how about using bladebro with playwright chrome to bypass the linkedin challenge"**
A: Falsified as a host — bladebro drives the browser on the developer's PC, and PC-off is the acceptance criterion. The bounce is IP-keyed (identical session file: 47 posts from home vs 4/4 CI failures), so a challenge solved via the real Chrome gets bounced again on the next datacenter walk. Automated challenge bypass is rejected by the account-safety goal. The headed login stays the manual repair path.

**Q (checkpoint: credentials): "how to access the content with credentials"**
A: Stored-session cookies are the primary path (no login most runs — the base64 jar rides as LINKEDIN_SESSION_STATE); one credential login is the automatic fallback with a 6h cooldown on challenge and secret write-back on success. Credentials are not the blocker; the egress IP is.

**Q (checkpoint: recon): "be red team to get around the content of linkedin with my credentials, do some recon"**
A: Delivered: enforcement map (request-layer IP soft block; session-jumping flag; no cookie↔device binding) + ranked access-mode table. With own credentials, feed content, free → residential egress is the only mode. First-party content-search alerts recorded as a free degraded backup channel; guest API jobs-only; official API no post search; RSS dead; paid providers out by budget; challenge bypass documented but rejected.

## Related Research
- .rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface.md — LinkedIn tolerance baseline this doc extends

## Open Questions
- Which concrete device hosts the runner: one at the developer's home, one at a family/friend household, or hardware to buy (Pi 4/5 4GB+, used mini-PC, old laptop; old Android via Termux is feasibility-thin).
- Whole-run on the self-hosted runner vs fetch-only split — the leading host candidate makes the split unnecessary; decide at design after the device probe.
- Session hygiene: mint the session ON the device once (login-on-device) so its IP history matches the runner IP, vs reuse the home-minted cookie (documented gap: no positive case study of second-residential-IP reuse; silent-pass is the likely outcome but unproven for weeks-long stability).
- Request velocity: 10-min cadence × ~9 requests/walk ≈ 1,300 req/day vs the earlier ~250 req/day tolerance reading — tune scrollRounds and/or cadence at design time with measured evidence.
- Whether LINKEDIN_SESSION_STATE stays authoritative in Actions secrets or moves host-local (depends on the whole-run vs split decision).
- Whether the first-party content-search alerts feature ships email delivery (documented in-product only) — optional redundant channel, zero account risk.
