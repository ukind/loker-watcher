---
date: 2026-11-01T10:53:22+0700
author: Yogiswara Utama
commit: 14aaf74
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn watch host + fetch-split vs whole-run"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, linkedin, watch-yml, self-hosted-runner, linkedin-session, state]
last_updated: 2026-11-01T10:53:22+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: LinkedIn watch host + fetch-split vs whole-run

**Date**: 2026-11-01T10:53:22+0700
**Author**: Yogiswara Utama
**Commit**: 14aaf74
**Branch**: feature/add-support-for-linkeind
**Repository**: feature-add-support-for-linkeind

## Research Question
Pick the free, account-safe host with residential-class egress for the LinkedIn leg, then decide: (a) move only the LinkedIn fetch there and POST the Post[] JSON back to GitHub Actions for merge before dedupe, or (b) relocate the whole runWatcher. Chained from `.rpiv/artifacts/research/2026-11-01_09-29-22_linkedin-watch-off-my-pc.md` (same-day, verified at this commit).

## Summary
**Problem**: Every free cloud CI egresses from datacenter IP ranges and LinkedIn soft-blocks that class at the request layer (page shell served, flagship-web XHRs withheld — 4 CI failures vs 1 home-IP success, 47 posts). The watch must run from a residential IP with the developer's PC off, free only, without risking the LinkedIn account.
**Recommended**: Option 1 — Whole-run on a self-hosted GitHub Actions runner on an always-on residential device. Every Actions-owned contract (secrets delivery, state commit-back, run cap, run queue, session self-refresh) inherits unchanged; the pipeline diff is a \`runs-on:\` flip.
**Effort**: Low-Med (~1-2 days elapsed: device provisioning + two probe sessions spaced ≥6h + workflow edit + measured retune commit).
**Confidence**: High.

Evidence tier note: per-candidate subagent dispatch was unavailable in this session, so the 3×6 grid below is orchestrator-scored (Verify tier). Every material codebase claim was re-verified against source at 14aaf74 with file:line citations; external claims are carried from the same-day research doc's live recon.

## Problem Statement

**Requirements:**
- LinkedIn fetch runs from residential-class egress; datacenter egress is a proven soft-block.
- Runs with the PC off (acceptance criterion); free only (budget constraint); account-safety first.
- Preserve the Actions-owned contracts or replace them: secrets delivery, state commit-back, run cap, run queue, session self-refresh.
- Degradation contract survives: session death is routine, warn-and-continue, never a run-killing throw.

**Constraints:**
- Hard: free-only; no new runtime dependency without stated need; fail-visible doctrine; atomic state writes; strict TS flags stay on.
- Soft: measured-evidence comments defend every retuned constant (JUDGE_CONCURRENCY precedent, 7cc7250); commit-back machinery is the fragile core (N3/N4/N5 debt) — keep it untouched.

**Success criteria:**
- LinkedIn digests arrive with the PC off.
- Probe acceptance oracle met on the device: \`fetch: <label> OK — N post(s) from M response(s)\` with M ≥ 2, twice, ≥6h apart.
- Gates (typecheck / lint / test) unchanged and green; zero LinkedIn challenges attributable to the new host.

## Current State

**Existing implementation:**
- Pipeline: \`runWatcher\` at src/index.ts:152; WatcherDeps total-default DI at 115-132 (defaults resolved 153-157 — verified). One-shot CLI, no daemon.
- Acquisition span src/index.ts:168-256 (verified): platform split filters (174-175), session resolve (178-181), credential-login fallback (185-192), skip-warn (193-197), LinkedIn-only-arm catch returning Threads-only (warn-and-continue template, ~243-247). Span closes → \`timing: fetch\` → \`dedupePosts(collected)\` at 258-259 — THE single merge seam.
- Recency applied at 262-264, BEFORE loadState (282-283). Gate 1 (285-294): zero unseen → heartbeat, saved:false, byte-identical state. Notify strictly before persist (342-346).
- Entry guard (end of src/index.ts, verified): import side-effect-free; rotation-exhaustion alarm email + exit 1 live in the GUARD's catch, not in runWatcher.
- Session legs: read leg host-agnostic (resolveSession, src/threads-session.ts:37-69, base64 env → temp storage-state); write-back leg Actions-specific (recoverLinkedInSession → LINKEDIN_REFRESH_PATH, consumed ONLY by the watch.yml refresh step's \`gh secret set\` — verified in both files); marker leg rides the commit-back (watch.yml Commit state adds state/linkedin-login.json).
- watch.yml (verified in full): cron */10 + dispatch; concurrency group watch, cancel-in-progress:false (the run lease); timeout-minutes: 8 (F023 arithmetic: 480s − 60-100s setup − 71s fetch − 60s tail ≈ 249-289s judge reserve); runs-on: ubuntu-latest on both jobs — the only runner-image assumption is preinstalled chromium shared libs (stated in the Playwright install comment); step-scoped secrets deliver THREADS_SESSION_STATE, LINKEDIN_SESSION_STATE/EMAIL/PASSWORD/REFRESH_PATH, LLM_ACCOUNTS, GMAIL_*; PAT-failure shim writes the challenge-shaped cooldown marker; commit-back conflict-skip whitelist allows ONLY state/seen-posts.json.

**Relevant patterns:**
- Warn-and-continue tiers (verified): resolver null → skip-warn; LinkedIn-arm throw → caller catch returning Threads-only; per-surface failure → side arrays.
- Deterministic id minting (verified): mintPost, src/fetch-linkedin.ts:170-180 — urn, permalink, and ISO timestamp all derive from the activity id; wire-safe for a stateless remote host (Option 2) and irrelevant for Option 1.
- dedupePosts (verified, end of src/index.ts): id-keyed Set, first-seen order; empty extra arm is the identity transform.
- Atomic state write: writeStateAtomic mkdir → temp → rename (src/state.ts).
- Measured-evidence comments: JUDGE_CONCURRENCY "4" line with probe-run reading, watch.yml.

**Integration points:**
- watch.yml watch job \`runs-on:\` — the flip line for Option 1.
- watch.yml Run watcher step env — secrets delivery (inherits under Option 1; partial-confines under Option 2).
- watch.yml Refresh LinkedIn session step — the only consumer of LINKEDIN_REFRESH_PATH (verified).
- watch.yml Commit state — the durable store (inherits under Option 1; must be replaced under Option 3).
- scripts/linkedin-login.ts — operator repair hatch; currently assumes the dev PC is the residential IP and prints \`gh secret set\`.

## Solution Options

### Option 1: Whole-run on a self-hosted runner
**How it works:**
Register an always-on residential device (Pi 4/5 4GB+, used mini-PC, old laptop) as a repo-scoped self-hosted GitHub Actions runner. Flip the watch job's \`runs-on: ubuntu-latest\` to a self-hosted label. Chromium shared libs need a one-time deps pass on bare hardware (the ubuntu runner image carried them). Re-measure device-speed constants and land a retune commit with evidence comments.

**Pros:**
- Zero new pipeline code — every contract is workflow-owned and inherits (verified against watch.yml in full).
- Failure contract unchanged: warn-and-continue, Gate 1, at-least-once semantics, atomic writes all ride along.
- Smallest possible diff; reversible by reverting runs-on and unregistering the runner.

**Cons:**
- ALL secrets materialize on the device during job runs (LLM accounts, Gmail, Threads session) — acceptable for a physically-owned device in a private single-contributor repo (research security model), a real concern for a third-party household.
- Device uptime becomes the run's uptime; jobs queue ≤24h offline and the runner self-removes after 14 days.
- F023 envelope (71s fetch, judge waves) was measured on cloud CPU — slower hardware stretches it inside the same 8-minute cap; a measured retune is mandatory.

**Complexity:** Low code / Med ops (~1-2 days)
- Files to create: 0 (maybe a device-setup note)
- Files to modify: 1 (watch.yml: runs-on + evidence comments, ~10 lines)
- Risk level: Low-Med

### Option 2: Fetch-only split + POST-back
**How it works:**
GitHub cloud keeps Threads/judge/email/state. The residential device fetches LinkedIn only and delivers Post[] JSON back; the Actions run merges it at the single seam (concat into the dedupePosts argument, src/index.ts:258-259) behind validation + staleness checks, inside the acquisition span, with a catch cloned from the warn-and-continue template and its own hard deadline. Verified genuinely additive: ids are deterministic (mintPost), dedupe is id-keyed, re-POSTed duplicates dedupe for free, recency bounds staleness.

**Pros:**
- Confines LINKEDIN_* secrets to the device; the cloud side keeps LLM/Gmail/Threads secrets off it.
- The merge seam is one expression; downstream (judge, digest, heartbeat, state) needs zero changes.

**Cons:**
- GitHub cannot read secret values back — the split host cannot pull LINKEDIN_SESSION_STATE from Actions. The credential login must move host-side, taking LINKEDIN_EMAIL/LINKEDIN_PASSWORD with it (a datacenter-adjacent login is exactly the challenged pattern, so this is correct anyway — but it is new plumbing both ends).
- Every delivery channel has a ruled defect (research): git push → green-judge/red-run risk; Actions artifact → needs actions:read not granted (permissions are contents:write only — verified); repository_dispatch → 64KB cap below a 150-post pool + PAT required; polled HTTP endpoint → new free infra to provision + staleness checks.
- The acceptance oracle relocates: \`fetch: linkedin/... OK\` lines emit on the remote host — log echo or grep move required.
- New wire schema + ingest validation (urn pattern, platform value, ISO timestamp — recency's NaN guard would otherwise silently drop malformed rows).
- Needs EVERYTHING Option 1 needs anyway (the device) plus the protocol. Dominated unless the whole-workflow-on-device is impossible.

**Complexity:** Med (~3-5 days)
- Files to create: NEW remote-arm client + NEW ingest validator + delivery endpoint + tests (~300-500 lines + tests)
- Files to modify: acquisition span wiring, watch.yml, secret layout
- Risk level: Med

### Option 3: Raw-host whole-run wrapper (no Actions on the device)
**How it works:**
A systemd timer invokes a wrapper that imports runWatcher directly (importable side-effect-free — verified). State lives as plain files on the persistent device. Re-implement the five Actions contracts in code/config.

**Pros:**
- No GitHub dependence for the run; secrets never enter GitHub (device env file); no 8-minute cap needed.

**Cons (verified blockers):**
- writeLoginMarker does a bare writeFile with no mkdir (src/linkedin-login.ts:284-307 — verified): on a fresh host the missing-LinkedIn-session path throws ENOENT out of the acquisition stage → exit 1. Reachable on every fresh install until fixed.
- The session-refresh channel is Actions-owned: LINKEDIN_REFRESH_PATH's only consumer is the watch.yml refresh step (verified). Off Actions, a successful credential login produces a session that dies with the host — a replacement mechanism (device-local secret store + reload) must be designed and, per the repo's own lesson (validated offline ≠ validated live), live-proven.
- Exhaustion alarm + exit-code semantics live in the entry guard's catch (verified), not in runWatcher — the wrapper must replicate them or silently lose the alarm and the nonzero-exit contract.
- Run cap and queue are workflow-owned (timeout-minutes: 8, concurrency group — verified): wrapper must re-provide (systemd TimeoutStartSec + a lock) or accept overlapping runs against a read-modify-write state file.
- The commit-back's conflict-skip whitelist and marker semantics (N3) assume Actions; unwinding them is the fragile-core surface.

**Complexity:** High (~1 week+)
- Files to create: wrapper entry + mkdir fix + refresh replacement + timer units + tests
- Files to modify: watch.yml (deprecate watch job), secret layout
- Risk level: High

## Comparison

| Criteria | Option 1: self-hosted runner | Option 2: split + POST-back | Option 3: raw wrapper |
|----------|----------|----------|----------|
| Complexity | L | M | H |
| Codebase fit | H (zero new seams) | M (one new seam + validation) | L (re-provides 5 contracts) |
| Risk | L-M | M | H |
| Days | ~1-2 | ~3-5 | ~7+ |

## Recommendation

**Selected:** Option 1 — Whole-run on a self-hosted runner.

**Rationale:**
- The durable store is the workflow, not the app: git commit-back + concurrency lease + timeout + secrets delivery + session refresh all live in watch.yml (verified line-by-line) and inherit from a runs-on flip with zero pipeline-code delta.
- The research verified the split is unnecessary on this host shape (finding 3) and genuinely additive-but-dominated for every other shape (findings 5-6).
- The failure and degradation contracts (warn-and-continue tiers, Gate 1, at-least-once, atomic writes) are code properties that do not move.

**Why not alternatives:**
- Option 2: clears the fit filter but is dominated — it requires everything Option 1 requires (the device) plus a new protocol, new validation, a relocated acceptance oracle, and a broken session write-back leg. Retained as the documented fallback.
- Option 3: fails the fit filter on integration-risk (verified ENOENT crash path, Actions-owned refresh channel, guard-owned exit semantics) and migration-cost.

**Trade-offs:**
- Accepting the full secret surface on the device in exchange for zero new code and unchanged contracts. Mitigated by: private single-contributor repo, physically-owned device, runner pulls secrets at job runtime only.

**Conditions that would change the recommendation:**
- If the hosting device sits in a household the developer does not physically control → Option 2's confined LINKEDIN_* surface may win. Decide at design once the device answer lands.
- If the device cannot carry the whole workflow (RAM/CPU for 4 concurrent headless pages + judge concurrency) → Option 2 with the LinkedIn fetch job pinned to the runner label.
- If GitHub tightens self-hosted-runner policy for private repos (none observed) → revisit.

**Implementation approach:**
1. Provision the device — Node ≥22, one-time chromium shared-libs pass, register as repo-scoped self-hosted runner with a label; verify pickup.
2. Mint the session ON the device once (login-on-device) so its IP history matches the runner IP; deliver into LINKEDIN_SESSION_STATE (Actions secret stays authoritative under this option). Adapt scripts/linkedin-login.ts to run on the device.
3. Flip watch.yml watch job runs-on to the label; keep the probe job on ubuntu-latest (LLM probing is datacenter-fine); add evidence comments.
4. Run the probe protocol on the device: offline replay (collectLinkedInPosts/parseFlightRows — Playwright-free) + on-host fetchLinkedInSurface with the stored session ONLY (never the credential login from an unproven host); acceptance oracle twice, ≥6h apart, M ≥ 2.
5. Live validation pass: dispatch + cron tick green, digest arrives with PC off, heartbeat on a quiet window, one observed session refresh (this also closes the still-open CI-leg operator items from validation/2026-11-01_08-00-29).
6. Measured retune commit: fetch timing, JUDGE_CONCURRENCY, scroll constants — each with a measured-evidence comment (7cc7250 precedent).

**Integration points:**
- watch.yml watch job \`runs-on:\` — the flip (+ evidence comment).
- scripts/linkedin-login.ts — operator hatch must mint on the device; flagged for design.
- ENV_NAMES (src/config.ts) — unchanged.

**Patterns to follow:**
- Measured-evidence comments: watch.yml JUDGE_CONCURRENCY line, 7cc7250.
- Probe-then-trust: scripts/probe-judge.ts workflow, applied to the LinkedIn walk.

**Risks:**
- Device offline → jobs queue ≤24h, runner self-removes after 14 days offline; visible in Actions UI; heartbeat silence is the symptom.
- Request velocity (~1,300 req/day at */10 × ~9 req/walk vs the earlier ~250/day tolerance reading) → tune scrollRounds and/or cadence at design with measured evidence.
- Session-jumping flag → single-home the cookie to the runner IP; mint-on-device; never interleave datacenter runs.

## Scope Boundaries
- Building: relocation of the existing watch job to a residential self-hosted runner; device probe pass; measured retune commit.
- NOT building: any delivery protocol or remote fetch adapter (Option 2 stays fallback), raw-host wrapper (Option 3 rejected), challenge automation, proxy pools, first-party content-search alerts (recorded as a free degraded backup channel only).

## Testing Strategy

**Unit tests:**
- None required by Option 1 (zero code delta). Existing offline suite and gates stay unchanged and green.

**Integration tests:**
- Probe protocol on the device: offline replay + on-host stored-session walk, acceptance oracle \`OK — N post(s) from M response(s)\` M ≥ 2, two sessions ≥6h apart.
- watch.yml dispatch run (probe job still gates LLM_ACCOUNTS health on ubuntu-latest) + a live watch run on the device.

**Manual verification:**
- [ ] Digest arrives with the PC off.
- [ ] Heartbeat fires on a zero-match window.
- [ ] Commit-back observed in both modes: no-op run and delta run.
- [ ] One observed successful session refresh (or an explicit design decision to move refresh host-local).
- [ ] Zero LinkedIn challenges attributable to the runner across the probe + first live week.

## Open Questions
**Resolved during research:**
- Can any free cloud host the LinkedIn leg? — No: every free platform is datacenter-egress (per-platform verification + live logged-out probe: search URL → 307 authwall).
- Is the fetch-split needed on a self-hosted runner? — No: all Actions contracts inherit (verified against watch.yml and src/index.ts).
- Does a stateless remote POSTer corrupt state? — No (for Option 2): deterministic ids + id-keyed dedupe + recency bounding (verified).

**Requires user input:**
- Which device hosts the runner (developer's home / family-friend household / hardware purchase)? — Default assumption: developer's home.
- Session hygiene: mint-on-device once (recommended) vs reuse the home-minted jar? — Default: mint-on-device.
- Velocity: keep */10 cadence × ~9 req/walk or reduce? — Default: keep cadence, tune scrollRounds first.

**Blockers:**
- None blocking. The CI-leg operator items from validation/2026-11-01_08-00-29 (live login + secret refresh never verified in Actions) fold into the Option 1 live-validation pass.

## References
- .rpiv/artifacts/research/2026-11-01_09-29-22_linkedin-watch-off-my-pc.md — host landscape, enforcement recon, split analysis (primary evidence)
- .rpiv/artifacts/discover/2026-11-01_09-21-30_linkedin-watch-off-my-pc.md — FRD chaining into this topic
- .github/workflows/watch.yml — the durable store + contracts (verified in full at 14aaf74)
- src/index.ts:168-256, 258-259, 285-294, 365-433, 454-462 + entry guard — merge seam, gates, session recovery, DI (verified)
- src/linkedin-login.ts:265-307 — cooldown gate (fail-open verified) + bare-write marker (ENOENT verified)
- src/fetch-linkedin.ts:170-180, 256-346 — deterministic minting + walk + acceptance line (verified)
- src/threads-session.ts:37-69 — host-agnostic session read leg
- .rpiv/artifacts/validation/2026-11-01_08-00-29_linkedin-second-surface-dispatch.md — open CI-leg operator items
- .rpiv/artifacts/TECH_DEBT_AUDIT.md — N3/N4/N5 commit-back debt
- .rpiv/artifacts/solutions/2026-10-31_10-32-31_linkedin-second-surface-dispatch.md — prior solutions artifact for the LinkedIn leg
