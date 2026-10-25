---
date: 2026-10-25T17:39:33+0700
author: Yogiswara Utama
commit: 714e438
branch: main
repository: loker-watcher
topic: "external-cron-workflow-dispatch"
tags: [intent, frd, github-actions, cron, workflow-dispatch]
status: ready
last_updated: 2026-10-25T17:39:33+0700
last_updated_by: Yogiswara Utama
---

# FRD: External cron (cron-job.org) driving workflow_dispatch every 10 minutes

## Summary
cron-job.org fires the existing `watch` workflow via `workflow_dispatch` on an exact 10-minute schedule, as a second clock alongside the native GitHub cron, which stays in place as a drift-prone fallback. The repository change is documentation-only: a README section explaining the dual-trigger setup. No workflow or source edits.

## Problem & Intent
GitHub Actions native cron drifts and drops runs; the maintainer ends up babysitting runs because the 10-minute loop does not reliably fire on time. Threads job posts expire fast, so late or missing runs translate directly into missed frontend job posts for digest readers. An external cron service (cron-job.org, free, exact 10-minute timing) calling `workflow_dispatch` makes the loop actually fire on time. A prior probe already verified the dispatch path works from Actions (`workflow_dispatch` run 40165612441, green in 44s, 19/19/19 posts per surface) and that runner IPs are not blocked by threads.com tag pages.

## Goals
- The 10-minute loop fires on time: cron-job.org dispatches `watch.yml` at exact 10-minute boundaries, independent of GitHub schedule drift.
- Redundancy: the native `*/10 * * * *` schedule stays as a fallback clock if cron-job.org is down.
- The setup is reproducible: the README explains how to register the external cron job and the token.

## Non-Goals
- No source code changes — nothing in `src/` reads the schedule, so no code is touched.
- No changes to concurrency (`watch` group, `cancel-in-progress: false`) or `timeout-minutes: 10`.
- No removal of the native `schedule:` trigger (dual-trigger redundancy was chosen over single-clock).
- No workflow_dispatch inputs — the dispatch carries no payload; run behavior stays env/secrets-driven.
- No heartbeat changes, state-file pruning, or dead-man's-switch alerting in this feature.

## Functional Requirements
1. A cron-job.org job SHALL POST to `https://api.github.com/repos/<owner>/<repo>/actions/workflows/watch.yml/dispatches` with body `{"ref":"main"}` every 10 minutes, expecting HTTP 204.
2. The request SHALL authenticate with a GitHub fine-grained PAT scoped to this repository only, with Actions read+write permission, sent as `Authorization: Bearer <token>`.
3. `.github/workflows/watch.yml` SHALL keep both existing triggers unchanged: `schedule: cron "*/10 * * * *"` (`watch.yml:4-7`) and bare `workflow_dispatch:` with no inputs.
4. The README SHALL gain an external-cron setup section covering: create the fine-grained PAT, register the cron-job.org job, set the 10-minute schedule, and add the Authorization header.
5. Overlapping fires SHALL keep serializing through the existing `concurrency.group: watch` (`watch.yml:11-13`); runs are short (typical no-match run exits 0 fast, job capped at 10 minutes, `watch.yml:18`), so overlap is rare and harmless.

## Non-Functional Requirements
- **Performance**: dispatch-to-run-start within seconds; run cost unchanged (0 LLM calls and 0 digest emails on no-match runs; heartbeat email still 1 per run).
- **Security**: token is a fine-grained PAT with the smallest scope (single repo, Actions read+write); stored only in cron-job.org; set an expiry and rotate it. Loss of the token exposes only this repo's workflow triggering.
- **UX / Accessibility**: no user-facing surface changes; digest and heartbeat emails behave exactly as before.
- **Reliability**: two independent clocks (external + native). If cron-job.org fails, native cron keeps a degraded (drifting) cadence; if both stop, heartbeat emails stop, which is the visible silence signal.

## Constraints & Assumptions
- cron-job.org free tier supports a 10-minute interval; the service holds the PAT (third-party trust boundary, accepted).
- Worst case with dual triggers is up to ~288 fires/day (144 external + up to 144 native-drift); Actions minutes stay negligible because runs are short and the repo is public (free tier).
- Assumption: cron-job.org can send custom POST bodies and Authorization headers on the free plan (to verify during setup).
- Assumption: the dispatch API call does not consume the per-user REST rate limit in any meaningful way at 144 calls/day.

## Acceptance Criteria
- [ ] `curl -X POST -H "Authorization: Bearer $PAT" -d '{"ref":"main"}' https://api.github.com/repos/<owner>/<repo>/actions/workflows/watch.yml/dispatches` returns HTTP 204 and a new `watch` run appears in the Actions tab.
- [ ] cron-job.org execution history shows a successful entry every 10 minutes; dispatched runs show exact :00/:10/:20-style start boundaries.
- [ ] `grep -n 'cron:' .github/workflows/watch.yml` still matches `*/10 * * * *`, and `git diff --stat` shows no changes to `.github/workflows/watch.yml`.
- [ ] `grep -n 'cron-job.org' README.md` matches the new setup section; `git diff main --stat` lists README.md as the only changed file.
- [ ] A dispatched run completes green (exit 0) and commits state exactly as a native-schedule run does (`watch.yml:42-54`).

## Recommended Approach
Operational setup rather than code: register a cron-job.org job that POSTs to the `workflow_dispatch` API every 10 minutes using a repo-scoped fine-grained PAT, keep `watch.yml` untouched with its dual triggers, and document the setup in the README. The concurrency group remains the sole overlap guard.

## Decisions

### Scope: workflow-only (README-only in effect)
**Question**: From the probe: the 10-minute cadence lives only in the workflow file (.github/workflows/watch.yml:5); no source code reads it. Keep the change workflow-only?
**Recommended**: Workflow only — edit watch.yml trigger block and README; src/ untouched.
**Chosen**: Workflow only. With native cron kept (see Trigger shape), the repo diff reduces to the README section alone.
**Rationale**: evidence: watch.yml:5 cadence not read anywhere in src/ + confirmed.

### Run safety settings unchanged
**Question**: From the probe: runs are serialized by concurrency group 'watch' with cancel-in-progress false (watch.yml:11-13) and a 10-minute job timeout (watch.yml:18). Keep these settings as-is?
**Recommended**: Keep as-is.
**Chosen**: Keep as-is.
**Rationale**: evidence: watch.yml:11-13,18 — exact 10-minute fires serialize safely since runs finish well under 10 minutes + confirmed.

### Trigger shape: keep native cron as fallback
**Question**: What happens to the native GitHub cron trigger once cron-job.org drives workflow_dispatch every 10 minutes?
**Recommended**: External only — remove the schedule block, dispatch stays.
**Chosen**: Keep native cron too — dual triggers, watch.yml:4-7 untouched.
**Rationale**: redundancy wins for this developer — if cron-job.org dies, native cron keeps a drifting fallback cadence; the concurrency group serializes any overlap.

### Credential: fine-grained PAT
**Question**: Which GitHub credential should cron-job.org hold to call workflow_dispatch?
**Recommended**: Fine-grained PAT, scoped to this repo only, Actions read+write.
**Chosen**: Fine-grained PAT.
**Rationale**: smallest blast radius if cron-job.org leaks the token; no codebase precedent (new setup).

### Docs: README setup section
**Question**: Document the cron-job.org setup in the README?
**Recommended**: Add setup section.
**Chosen**: Add setup section.
**Rationale**: README already documents the native flow (README.md:56) and the manual dispatch path (README.md:84); the external setup belongs next to them.

## Open Questions
None — nothing was explicitly deferred.

## Suggested Follow-ups
- Heartbeat email still fires once per run and defaults on (`src/index.ts:110`, `src/config.ts:32-39`, unset in `watch.yml:36-42`); with dual triggers, inbox noise can roughly double — consider `HEARTBEAT_ENABLED=false` if that gets loud.
- `state/seen-posts.json` grows monotonically with no pruning or cap (`src/state.ts:205-210`) — unrelated to this feature but worth a future task.
- cron-job.org offers per-job failure notifications; enabling them would give an explicit alarm instead of relying on heartbeat silence.

## References
- Probe: codebase-locator + codebase-analyzer reports (this session, Step 3) — trigger block, run flow, timing constants, failure paths.
- `.github/workflows/watch.yml` — triggers, concurrency, timeout, commit-state step.
- `README.md` — cadence docs (:3-4, :56), manual dispatch (:84), 60-day auto-disable (:139-141).
- Prior design: `.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md` (cadence decision, no-retrigger guarantee).
- Prior research: `.rpiv/artifacts/research/2026-10-24_14-30-29_threads-hiring-alerts.md` (Actions cron floor/delay, free-tier quota).
