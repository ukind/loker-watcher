---
date: 2026-11-03T17:38:05+0700
author: Yogiswara Utama
commit: 4c11e0f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Execution home for the LinkedIn leg (local/residential fetch)"
confidence: medium
complexity: medium
status: ready
verdict: pass
tags: [solutions, linkedin, fetch-linkedin, watch-yml, self-hosted-runner, voyager-graphql]
last_updated: 2026-11-03T17:38:05+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Execution home for the LinkedIn leg (local/residential fetch)

**Date**: 2026-11-03T17:38:05+0700
**Author**: Yogiswara Utama
**Commit**: 4c11e0f
**Branch**: feature/add-support-for-linkeind
**Repository**: feature-add-support-for-linkeind

## Research Question
"now i want only the not possible part of linkedin to run locally" — later widened mid-checkpoint with "or maybe entire linked workflow run in my local pc". Which execution home hosts the CF-blocked voyager fetch (member cookies + residential IP + browser-class transport), and how do its results reach the funnel? Chains from the decided transport analysis (.rpiv/artifacts/solutions/2026-11-03_14-25-19_linkedin-voyager-transport.md: no runner candidate survives Cloudflare; execution split chosen; browser-context transport proven live on this PC).

## Summary
**Problem**: the voyager fetch needs residential egress + browser TLS; GitHub runners are datacenter-fatal. Choose how the fetch runs locally and hands Post[] back.
**Recommended**: Self-hosted runner leg — split watch.yml so a fetch-linkedin job runs on a self-hosted runner (this PC first, a Pi/mini-PC later), handing Post[] to the hosted watch job via artifact at the dedupe seam. Keeps the funnel 24/7, kills the session-wipe scenario permanently, keeps failure visibility in Actions logs.
**Effort**: Medium (~2-3 days: watch.yml split + greenfield voyager fetcher module + ingest guard).
**Confidence**: Medium (mechanics verified mature; the open variable is device uptime discipline).

## Problem Statement

**Requirements:**
- The voyager GET (member cookies, residential IP, browser TLS) runs on local hardware; judge, email, threads, state stay GitHub-hosted
- Runs stay green when the device is off (Nov 1 acceptance: PC-off must not fail or silence the whole watch)
- The destructive li_at-wipe failure mode (CF challenge loop on a datacenter IP) can never recur — cookies live where the fetch runs
- Dead SDK replacement is included: @linkedapi/node ($69/mo Core, dead-session in 5/5 recent runs) is removed in every candidate

**Constraints:**
- Device uptime is behavioral, not technical: the PC was shut down at 15:00 today
- watch.yml permissions today: only contents: write (watch.yml:8-9); no artifact or dispatch usage anywhere
- The voyager fetcher module does not exist yet (design-only in the transport artifact) — every candidate pays that build
- Repo doctrine: warn-and-continue tiers, hard-coded tuning constants, offline deterministic tests

**Success criteria:**
- linkedin posts flow into the existing funnel (dedupe -> recency -> seen -> judge -> digest) with the fetch physically on local hardware
- PC-off degrades to linkedin-quiet with green runs; a PC return resumes without operator action

## Current State

**Existing implementation (verified at 4c11e0f by today's agents):**
- Merge seam: dedupePosts(collected) at src/index.ts:228 (def :371-382, id-keyed first-seen; deterministic urn ids make re-delivery free)
- Acquisition span: src/index.ts:169-225; linkedin arm :195-216 (resolver :196, caller warn :198-204, belt catch :207-216); Gate 1 :266-275; filterRecent applied :236 (bounds stale payloads before judging)
- WatcherDeps DI: src/index.ts:107-149, linkedinFetch seam :114-118, default :156, 4 test injections tests/index.test.ts:506-667
- Entry guard: src/index.ts:383-406 (exit-code + exhaustion-alarm semantics; importable side-effect-free) — the prior research's :468-485 is stale post-bf6594c
- watch.yml: cron */10 :4-5, concurrency cancel-in-progress:true :10-19 (flipped for the SDK park-guard), dispatch-only probe job :23-48 (the only second-job + on-demand precedent), permissions :8-9, timeout :65, SDK env :104-105, commit-back :110-137 (fragile N3/N5 surface)
- Dead incumbent: src/fetch-linkedin-api.ts (261 lines, quarantined dynamic import :96-102), tests/fetch-linkedin-api.test.ts (~346), package.json:21, ENV_NAMES :16-17

**Relevant patterns:**
- Injectable trailing I/O param: src/judge.ts fetchFn; the voyager fetcher reuses it (browser context provides the fetchFn)
- Second job in watch.yml: probe job :23-48; on-demand execution: workflow_dispatch :6 keyed at :23-24
- Probe protocol: .rpiv/artifacts/research/2026-11-01_09-29-22_linkedin-watch-off-my-pc.md (on-host oracle: fetch OK lines with M>=2 responses, two sessions >=6h apart, stored session only — never credential login from an unproven context)

**Integration points:**
- src/index.ts:228 — every split candidate concatenates its batch into collected before dedupe; absent batch = identity transform (Gate 1 stays green)
- src/index.ts:114-118, :195-216 — the seam + arm every candidate rewrites (SDK shapes die)
- watch.yml:104-105 — SDK env pair dies in every candidate

## Solution Options

### Option 1: Self-hosted runner leg (RECOMMENDED)
**How it works:** split watch.yml into two jobs: fetch-linkedin pinned runs-on: [self-hosted, home] runs the browser-context voyager fetch on-device (Playwright chromium + storageState, the proven transport) and uploads Post[] via upload-artifact; the hosted watch job downloads it and merges at the dedupe seam. Actions owns trigger, queue, secrets delivery; the device only hosts the runner agent. Device: this PC now; an always-on Pi/mini-PC later removes the uptime tax entirely.

**Pros:**
- Funnel coverage stays 24/7: PC-off = linkedin-quiet only (threads/judge/email unaffected), jobs queue while the device is offline
- Session jar lives on-device, never an Actions secret — the server-side li_at wipe scenario is structurally dead
- Failure visibility unchanged: fetch OK/FAILED lines + exit codes land in run logs
- Device-agnostic upgrade path: re-pointing runs-on to a Pi is config, not code

**Cons:**
- needs:-chained cadence binds run health to PC uptime unless the trigger is decoupled (design item)
- Windows runner agent pains: service stuck-but-listening (restart), service mode drops user PATH (runner .env file), 14-day offline auto-deregistration, 30-day minimum-version floor (auto-update covers while online)

**Complexity:** Medium (~2-3 days)
- New: voyager fetcher module, PC entry script, self-hosted job block, artifact upload/download steps, ingest validation (urn pattern + recency), actions: read grant
- Rewrites: linkedin arm + seam signature; SDK-shaped test stubs
- Deletes: the SDK quad + stale comments
- Risk: Medium

### Option 2: PC scheduled script + repo push
**How it works:** no Actions locally. Task Scheduler runs a tsx script (browser-context fetch, same module via fetchFn seam), which commits a Post[] JSON to a dedicated repo path (pull --rebase + retry push); the next */10 cron consumes it at the merge seam with staleness validation.

**Pros:**
- Cheapest build among the splits (~2 days): one scheduled task + a fine-grained PAT (annual rotation, Credential Manager persists it); zero agent/permission changes (contents: write already suffices)
- Strongest-possible novelty profile: Task Scheduler 2.0 + git push are decades-stable; missed-run catch-up fires after next boot
- Actions stays the single runtime; commit-back machinery untouched

**Cons:**
- Second git writer on main: a conflicted payload file can fail a green-judge run via the N3 conflict-skip whitelist (known debt surface) — the PC push needs a disjoint path + its own rebase/retry discipline
- Failure visibility leaves Actions: fetch lines print on the PC; invisible unless the script tees a log
- PC-off = linkedin quiet with no queueing at all (missed tasks fire only post-boot)

**Complexity:** Low-Medium (~2 days). Risk: Medium (second-writer discipline is the whole game)

### Option 3: PC script + dispatch hand-off
**How it works:** same local script shape, but the script uploads the artifact AND triggers the run (gh workflow dispatch or repository_dispatch with a PAT); the watch run pulls the batch synchronously inside the acquisition span.

**Pros:**
- Lowest latency (fetch-to-judge in one tick); on-demand precedent exists (probe job keys on workflow_dispatch, watch.yml:23-24)

**Cons:**
- Two watch.yml hazards: cancel-in-progress:true (watch.yml:10-19, kept for SDK-era serialization) means each on-demand dispatch kills any in-flight cron run mid-acquisition; the dispatch-to-runner-start gap competes with the 8-minute cap and the F023 judge envelope
- Dominated: all of Option 2's burden plus greenfield artifact/dispatch plumbing, for a latency benefit the funnel does not need (missed ticks re-collect; async delivery costs at most one cadence — Nov 1 research verified)

**Complexity:** Medium (~3 days) — plumbing dominates. Risk: Medium-Highest of the splits. **Dominated by 1 and 2; included for completeness, not recommended.**

### Option 4: Whole-run local
**How it works:** the entire runWatcher() pipeline runs on the PC via Task Scheduler + a thin wrapper (entry guard semantics inherited — the repo already runs this exact entry two ways: package.json:9 start + watch.yml:109 CI). Local .env secrets, local state file, email sent from the PC; Actions retired or kept dormant.

**Pros:**
- Lowest migration cost of all four (~1-2 days): zero seams touched, zero hand-off machinery, runWatcher() needs zero args (total-default DI); the fragile commit-back block simply deletes
- State becomes single-writer local (atomic write exists, src/state.ts:209-238); missed ticks are safe (unpersisted posts re-collect next run)
- No new external services at all

**Cons:**
- Uptime blast radius is the ENTIRE watch: PC-off silences threads, judge, digest, heartbeat too — no queue at all, and no signal while off (silent death; Actions run history was the only external monitor)
- All secrets move to plaintext local .env (THREADS_SESSION_STATE, LLM_ACCOUNTS, GMAIL_*) — held by whatever backs up or syncs the PC
- Directly inverts the recorded Nov 1 acceptance criterion ("success = PC off"); the 15:00 shutdown today is the concrete counter-evidence
- Visibility collapses to local console unless a log/alert story is added; Task Scheduler traps: default 72h execution kill (set PT0S), missed-run catch-up quirks; a dormant Actions fallback decays silently under the 2026 runner-version floor

**Complexity:** Low (~1-2 days). Risk: Low technical / High operational

## Comparison

| Criteria | 1. Runner leg | 2. Script + push | 3. Dispatch | 4. Whole-run local |
|----------|--------------|------------------|-------------|--------------------|
| Complexity | M (~2-3d) | L-M (~2d) | M (~3d) | L (~1-2d) |
| PC-off blast radius | linkedin only, queued | linkedin only, no queue | linkedin only, no queue | ENTIRE watch, no queue |
| Codebase fit | M-H | M | M | H |
| New external surface | runner agent + artifact | PAT + scheduled task | PAT(Actions:write) + artifact + dispatch | none |
| Failure visibility | Actions logs (unchanged) | leaves Actions | split | local console only |
| Session-wipe risk | dead (local jar) | dead (local jar) | dead (local jar) | dead (local jar) |
| Second writer on main | no | yes (N3 hazard) | no | no |

## Recommendation

**Selected:** Option 1 — Self-hosted runner leg.

**Rationale:**
- It is the only candidate that satisfies both stated goals at once: the CF-blocked fetch runs locally ("only the not possible part") AND the funnel keeps 24/7 coverage with the PC off (the Nov 1 acceptance criterion; today's 15:00 shutdown is the live counter-evidence against Options 2-4's quiet modes)
- Queueing: Actions queues the fetch job while the device is offline (up to 24h), then runs it on return — no operator action, unlike the scheduler candidates' post-boot-only catch-up
- The session jar never re-enters GitHub secrets: the li_at-wipe and dead-session class of failures (today's production state, 5/5 runs) is structurally eliminated, and the $69/mo SDK rent ends
- Device is a config decision, not an architecture one: start runs-on: self-hosted on this PC; move the same job to an always-on Pi/mini-PC later and the uptime tax disappears without touching code

**Why not alternatives:**
- Option 2: cheapest build, but it adds a second git writer on main against the repo's most debt-prone surface (commit-back N3/N5), and failure visibility leaves Actions — acceptable only if agent registration is unacceptable
- Option 3: dominated — its only advantage (latency) buys nothing in a funnel where missed ticks re-collect, while its dispatch kills in-flight cron runs under the current cancel-in-progress policy
- Option 4: cheapest and simplest, but one PC shutdown now silences threads + judge + digest with no queue and no signal — it reverses a recorded acceptance criterion; choose it only if the PC becomes genuinely always-on and simplicity outranks coverage

**Trade-offs:**
- Accepting Windows runner-agent maintenance (service restarts, 14-day re-registration after long outages) for structural elimination of the session-wipe failure class and unchanged funnel coverage
- Accepting a one-time artifact-permission grant (actions: read) for a clean job split

**Implementation approach:**
1. Build the voyager browser-context fetcher module (fetchFn seam; parser + restli encoder per the transport artifact; total contract preserved)
2. Split watch.yml: fetch-linkedin job (self-hosted) -> upload-artifact; watch job -> download-artifact -> merge at src/index.ts:228 with urn/recency validation; add actions: read; decouple or guard the cancel-in-progress interaction
3. Remove the SDK quad (module, tests, ENV_NAMES :16-17, watch.yml :104-105, package.json:21) + stale comments (watch.yml:11-19, 51-54; src/index.ts:30-36, :190-193)
4. PC: register the runner agent (service mode, runner .env for PATH), tee fetch output to the job log
5. Probe on-device before trusting: stored-session-only browser fetch, fetch OK with M>=2 responses, two sessions >=6h apart (Nov 1 protocol); then one PC-off rehearsal (hosted run stays green, Threads-only)

**Integration points:**
- src/index.ts:228 - ingest+concat remote batch into collected; src/index.ts:236 - filterRecent bounds staleness
- src/index.ts:114-118, :195-216 - seam + arm rewrite; Gate 1 :266-275 stays the green oracle
- watch.yml:8-9 - add actions: read; :23-48 - the second-job precedent to copy; :104-105 - SDK env dies
- Device: runner .env carries nothing secret (jar stays a local file); registration token rotates on re-register

**Patterns to follow:**
- Second-job split: watch.yml:23-48 (probe job)
- Probe protocol: Nov 1 research (on-host oracle + repetition rule)
- Warn-and-continue tiers: absent artifact -> resolver-null-style skip-warn inside the span, return never rethrow

**Risks:**
- Windows agent stalls (listener stuck): mitigation — scheduled agent-service health check + restart, fetch job timeout-minutes bounded
- 14-day offline auto-deregistration: mitigation — re-register on return; acceptable for a personal device
- Artifact round-trip regression: mitigation — round-trip probe step 5; ingest validation double-checks urn shape + recency before merge
- cancel-in-progress interaction: mitigation — separate concurrency group or per-trigger policy at design time

## Scope Boundaries
- Decided here: execution home for the linkedin leg; SDK removal is included in every candidate and lands with the chosen one
- NOT decided at this layer: voyager fetcher module internals (transport artifact owns them), device hardware choice (PC now vs Pi later — config), whether the probe job stays as-is
- NOT touched: judge, email, heartbeat, threads fetch, state contract

## Testing Strategy

**Unit tests:**
- Voyager parser + restli encoder over Response/browser doubles (fixture precedent tests/fixture/graphql-response.json; restli escaping matrix as fixture table)
- Ingest validation: urn-shape reject, stale-payload drop (filterRecent), absent-artifact identity transform at the merge seam (dedupePosts doubles)
- SDK-removal regression: tests/index.test.ts seam doubles re-keyed; typecheck proves the quad is gone

**Integration tests:**
- Artifact round trip: on-device OK lines with M>=2 responses -> upload -> hosted download -> merge at :228 -> extract: count in run logs
- PC-off rehearsal: device offline -> cron run green, Threads-only, heartbeat as designed; device returns -> next fetch job runs unprompted

**Manual verification:**
- [ ] Two on-device probe sessions >=6h apart (stored session only, never credential login) before trusting the leg
- [ ] Runner agent service survives a reboot unattended
- [ ] Re-register flow rehearsed once (token rotation)

## Open Questions
**Resolved during research:**
- Is the merge seam at :258? - No: bf6594c shifted it to src/index.ts:228 (def :371); entry guard is :383-406, not :468-485 — prior research's lines are stale, substance confirmed
- Do the split candidates need new permissions? - Artifact download in-run works with GITHUB_TOKEN; actions: read is the safe explicit grant (watch.yml:8-9 today grants only contents: write)
- Is the whole-run option technically viable? - Yes and cheapest (verified: importable guard, total-default DI), but it inverts the PC-off acceptance criterion — viable only as a deliberate priority change

**Requires user input:**
- Device commitment: keep this PC as the runner device (accepting its uptime habits), or stand up an always-on Pi/mini-PC (recommended end-state; config-only change later)?
- Keep the workflow_dispatch probe job unchanged? (recommended: yes — it is the second-job precedent and untouched by the split)

**Blockers:**
- None. All mechanics verified mature; the fetcher module build is the long pole and its design already exists in the transport artifact

## References
- .rpiv/artifacts/solutions/2026-11-03_14-25-19_linkedin-voyager-transport.md - transport decision chain + live-capture evidence (input chain)
- .rpiv/artifacts/research/2026-11-01_09-29-22_linkedin-watch-off-my-pc.md - split analysis, delivery paths, probe protocol, runner landscape (lines partially stale post-bf6594c, substance verified)
- src/index.ts:228 - the merge seam (verified current)
- src/index.ts:383-406 - entry guard / exit-code semantics (verified current)
- watch.yml:23-48 - second-job + on-demand precedent
- https://docs.github.com/en/actions/reference/runners/self-hosted-runners - agent auto-update, 14-day removal, version floor
- https://github.com/actions/upload-artifact - artifact v4 mechanics
- https://learn.microsoft.com/en-us/windows/win32/taskschd/about-the-task-scheduler - scheduler contracts (Options 2/4)
