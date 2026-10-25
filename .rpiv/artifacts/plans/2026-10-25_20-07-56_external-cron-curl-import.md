---
date: 2026-10-25T20:07:56+0700
author: Yogiswara Utama
commit: 3d4326b
branch: main
repository: loker-watcher
topic: "External cron (cron-job.org) README section"
tags: [plan, readme, github-actions, cron, workflow-dispatch, cron-job-org]
status: ready
parent: ".rpiv/artifacts/designs/2026-10-25_19-46-14_external-cron-curl-import.md"
phase_count: 1
phases:
  - { n: 1, title: External-cron section + consistency rewords, files: [README.md], depends_on: [] }
last_updated: 2026-10-25T20:07:56+0700
last_updated_by: Yogiswara Utama
---

# External cron (cron-job.org) README section — Implementation Plan

## Overview

README-only documentation change: a new "## External cron (cron-job.org)" section led by a one-paste "Import from cURL" line, plus three consistency rewords, so a reader can drive the existing workflow_dispatch trigger of .github/workflows/watch.yml from cron-job.org every 10 minutes. watch.yml and src/ stay byte-identical. Phases are inherited 1:1 from the design ## Slices (single slice).

Design artifact: .rpiv/artifacts/designs/2026-10-25_19-46-14_external-cron-curl-import.md

Parallelism: single phase — no parallel phases.

## Desired End State

A reader goes from zero to an external 10-minute clock using only the README:

1. Create a fine-grained PAT (Actions: Read and write).
2. The pre-flight curl prints 204.
3. Paste the crontab+curl line into the cron-job.org Import from cURL dialog; the import fills the URL, the POST method, both headers, the {"ref":"main"} body, and the */10 schedule.
4. Trigger once; a run appears under Actions → watch with event workflow_dispatch and reaches the Commit state step.

Then: grep -n "cron-job.org" README.md finds the section, and git diff main --stat shows README.md only.

## What We're NOT Doing

- Any change to .github/workflows/watch.yml, .github/workflows/ci.yml, or src/.
- A PAT row in the secrets table (the exception is named in prose only).
- Documenting the cron-job.org REST management API (Option 3, rejected upstream).
- Any committed setup script (it would ship ungated and break documentation-only scope).
- Removing or weakening the native schedule.

## Phase 1: External-cron section + consistency rewords

### Overview

One README edit landing in a single commit: insert the new External cron section after the Smoke run section (before "## Refresh the Threads session"), reword Setup step 4 (README.md:56-57) and the Smoke-run zero-match bullet (README.md:90-92), and append the commits-are-activity sentence to the Maintenance bullet (README.md:139-141).

### Changes Required:

#### 1. README.md — External cron section + three consistency rewords
**File**: README.md
**Changes**: Insert the new section at the verified README.md:96/98 anchor; reword the two lines that assume the native cron is the only clock; append to the 60-day Maintenance bullet. All content verbatim from the design Architecture:

`````markdown

[NEW SECTION — insert after the runner-IP paragraph ending the "## Smoke run" section, before "## Refresh the Threads session"]

## External cron (cron-job.org)

The native schedule is best-effort: GitHub can delay or skip runs, and it
auto-disables schedules after 60 quiet days (see Maintenance). A
cron-job.org job that calls the workflow trigger API makes the clock
explicit. The workflow already accepts API triggers (`watch.yml:4-6`), so
this section is documentation only — no repo file changes.

The token below can start runs on your behalf. Treat it like a password:
keep it out of the repo and paste it only into cron-job.org.

1. Create a fine-grained personal access token: **Settings → Developer
   settings → Personal access tokens → Fine-grained tokens → Generate new
   token**. Under **Repository access**, pick **Only select repositories**
   and select this repo. Under **Permissions → Repository permissions →
   Actions**, pick **Read and write** (Metadata read-only is added
   automatically). Give it an expiry you will actually rotate.
2. Pre-flight the token from a terminal. Expected: it prints `204` — GitHub
   answers `204 No Content` with an empty body on success:

   ```bash
   export PAT=PASTE-YOUR-TOKEN-HERE   # the token from step 1
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     -H "Accept: application/vnd.github+json" \
     -H "Authorization: Bearer $PAT" \
     -H "Content-Type: application/json" \
     -d '{"ref":"main"}' \
     https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches
   ```

   Check **Actions → watch** for a new run with event
   **workflow_dispatch**. On a fork, replace `ukind/loker-watcher` with
   your `owner/repo` — here and in step 3.
3. Put your real token into this line in place of the placeholder —
   cron-job.org does not expand variables, so the token must be in the
   text before you import it:

   ```
   */10 * * * * curl -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer PASTE-YOUR-TOKEN-HERE" -H "Content-Type: application/json" -d '{"ref":"main"}' https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches
   ```

4. In cron-job.org: **Cronjobs → Create cronjob**, then open **Import from
   cURL** at the bottom of the job editor (pasting into the URL field also
   triggers detection) and paste the line. Expected: the URL, the POST
   method, both headers, the `{"ref":"main"}` body, and the
   every-10-minutes schedule all fill in. If the dialog is gone or
   mis-parses, the same line lists every field to enter manually.
5. Save, then trigger the job once from the dashboard. Expected: a `204` in
   the job's execution history, and a run under **Actions → watch** with
   event **workflow_dispatch** that reaches the Commit state step.

If the pre-flight fails, the status code names the problem:

| Status | Meaning | Fix |
|---|---|---|
| `401` | Token missing or wrong | Regenerate, re-run the pre-flight, update the cron-job.org job header |
| `403` | Token lacks Actions write | Set Actions to **Read and write** (step 1) |
| `404` | Wrong repo slug or filename | Only the filename `watch.yml` is correct; check the URL names your repo |
| `422` | Bad ref or malformed body | The body must be exactly `{"ref":"main"}` (or your default branch) |

Two traps to know:

- Address the workflow by filename. A URL with the wrong filename can
  still answer `204` — and if the filename is `ci.yml`, every trigger
  starts a CI run instead. The run must appear under **watch**.
- The native schedule stays on. Both clocks share one concurrency group
  (`watch.yml:11-13`), so overlapping triggers queue instead of racing.
  Two clocks also double the zero-match status emails; set
  `HEARTBEAT_ENABLED=false` (see Setup) if that is too many, and turn on
  cron-job.org's failure notifications so a broken trigger still alerts
  you.

[REWORD — README.md:56-57 (Setup step 4)]

4. Enable Actions on the repo. The native schedule (`*/10 * * * *`) then
   runs best-effort. For a clock you control, see External cron below.

[REWORD — README.md:90-92 (Smoke run, zero-match bullet)]

- A zero-match run emails a status digest with the funnel counts and up to 10
  candidate permalinks. That is one email per run, whatever fires it; set
  `HEARTBEAT_ENABLED=false` if that is too many.

[APPEND — README.md:139-141 (Maintenance first bullet)]

- Public repos auto-disable scheduled workflows after 60 days without repo
  activity. State commit-backs usually keep it alive; after a long quiet
  stretch, run a manual dispatch. The external cron (above) helps here too:
its runs commit state on matches, and those commits are the repo activity
  GitHub counts.
`````

### Success Criteria:

#### Automated Verification:
- [x] Project gates still pass: `npm run typecheck`, `npm run lint`, `npm test` (README-only diff must not disturb them)
- [x] `git diff main --stat` lists README.md only; `.github/workflows/watch.yml` is byte-identical
- [x] `grep -n 'cron-job.org' README.md` shows the `## External cron (cron-job.org)` heading between "## Smoke run" and "## Refresh the Threads session"
- [x] PAT hygiene: `grep -nE 'github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+' README.md` returns nothing; the only token-shaped text is the `PASTE-YOUR-TOKEN-HERE` placeholder
- [x] The step-3 paste line contains, in order: the `*/10 * * * *` prefix, `-X POST`, `Accept: application/vnd.github+json`, `Authorization: Bearer`, `Content-Type: application/json`, `{"ref":"main"}`, `https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches`
- [x] `grep -n 'runs best-effort' README.md` returns the reworded Setup step 4 naming the schedule native and pointing at the External cron section
- [x] `grep -n 'one email per run' README.md` returns wording that no longer ties the rate to the `*/10` cron
- [x] The Maintenance bullet ends with the commits-are-activity sentence about the external cron

#### Manual Verification:
- [ ] Pre-flight: replace the placeholder with the real token, run the curl — it prints `204`
- [ ] A run appears under **Actions → watch** with event **workflow_dispatch** and reaches the Commit state step
- [ ] Paste the step-3 line into cron-job.org's **Import from cURL** once: the success feedback lists URL, POST, headers, body, and the 10-minute schedule
- [ ] (Staleness watch) If cron-job.org ever redesigns the dialog, the fallback sentence still holds — the same line is the field spec

---

## Testing Strategy

### Automated:
Phase 1's Automated Verification list is the whole-plan gate (single-phase plan: the phase gate is also the plan gate):

- The three project gates: npm run typecheck, npm run lint, npm test.
- The README-only diff check and the greps listed in Phase 1.

Write scope: every command above is read-only or scoped to the phase file set (README.md); nothing in the plan writes outside it. None of the three gates reads README.md (tsc and Biome scope to src/ and tests/; the node:test suite runs TS), so a README-only diff cannot disturb them.

### Manual Testing Steps:
1. Pre-flight: replace PASTE-YOUR-TOKEN-HERE with the real token and run the step-2 curl; expect 204 and a new workflow_dispatch run under Actions → watch reaching the Commit state step.
2. Import round-trip: paste the step-3 line into the cron-job.org Import from cURL dialog once; expect the URL, POST, both headers, the {"ref":"main"} body, and the 10-minute schedule to fill.
3. Staleness watch: if cron-job.org redesigns the dialog, the fallback sentence still holds — the same line is the field spec.

## Performance Considerations

None — documentation-only change; no runtime path is touched.

## Migration Notes

None — no persisted schema or state format changes.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents against the live codebase at HEAD (main @ 3d4326b). Findings triaged at Step 5._

_No findings — both reviewers cleared the artifact._

## Developer Context

## References

- Design: .rpiv/artifacts/designs/2026-10-25_19-46-14_external-cron-curl-import.md
- Solution (parent): .rpiv/artifacts/solutions/2026-10-25_19-07-23_external-cron-curl-import.md
- Research: .rpiv/artifacts/research/2026-10-25_18-11-26_external-cron-curl-import.md
- FRD: .rpiv/artifacts/discover/2026-10-25_17-39-33_external-cron-workflow-dispatch.md
- .github/workflows/watch.yml:4-6 — the triggers this section documents (untouched)
