---
date: 2026-10-25T19:46:14+0700
author: Yogiswara Utama
commit: 3d4326b
branch: main
repository: loker-watcher
topic: "External cron (cron-job.org) README section with Import-from-cURL paste line"
tags: [design, readme, github-actions, cron, workflow-dispatch, curl-import, cron-job-org]
status: ready
parent: ".rpiv/artifacts/solutions/2026-10-25_19-07-23_external-cron-curl-import.md"
last_updated: 2026-10-25T19:46:14+0700
last_updated_by: Yogiswara Utama
---

# Design: External cron (cron-job.org) README section

## Summary

Document a cron-job.org clock that fires `watch.yml`'s `workflow_dispatch` every 10 minutes, led by a one-paste "Import from cURL" line (crontab prefix + curl). The change is README-only: one new section plus three consistency rewords. `.github/workflows/watch.yml` and `src/` stay byte-identical.

## Requirements

- README section documents cron-job.org → `POST https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches`, body `{"ref":"main"}`, every 10 minutes.
- A paste-ready "Import from cURL" line that fills schedule + URL + method + headers + body in one import (cron-job.org job editor, bottom button).
- Fine-grained PAT guidance: Only select repositories, Actions → Read and write (Metadata read-only force-enabled).
- Same-commit consistency rewords for the lines that assume the native cron is the only clock.
- Hard: `watch.yml` byte-identical. Hard: no `github_pat_`/`ghp_`-shaped string anywhere in the README. Hard: no new runtime artifacts; documentation-only scope (FRD).
- Soft: cite source files instead of restating values (stale-README precedent).

## Current State Analysis

The server side already exists: `.github/workflows/watch.yml:4-6` has both the `*/10` schedule and a bare `workflow_dispatch:`; nothing in `src/` reads the schedule or the event. The README has zero curl/api.github.com content today; this section introduces the first absolute self-referencing repo URL.

### Key Discoveries

- **No docs gate exists.** `tests/**`, `scripts/**`, `.github/workflows/ci.yml`, husky hooks — zero README references. README-only diffs are invisible to all 4 CI gates; verification is manual greps + live checks. (integration-scanner)
- **The watch-vs-ci trap is real.** `.github/workflows/ci.yml:7` also has a bare `workflow_dispatch:`. A dispatch addressed to the wrong-but-valid filename returns `204` and silently starts CI runs. The section needs the trap sentence + debug-table wording.
- **Trigger mechanics.** Dispatches address the workflow by **filename** (`watch.yml`), not display name. Concurrency group `watch` with `cancel-in-progress: false` (`watch.yml:11-13`) queues overlapping native+external triggers; `timeout-minutes: 10` (`watch.yml:18`) bounds each run. Nothing in `src/` consumes `GITHUB_EVENT_NAME`; the only ambient `GITHUB_*` read is `runUrlFromEnv` (`src/config.ts:40-47`) for the heartbeat URL. (codebase-analyzer)
- **60-day auto-disable mechanism.** GitHub counts **commits** as repo activity; the README already credits state commit-backs (`README.md:139-141`). Whether a dispatch itself counts as activity is not verifiable from GitHub's docs — the appended clause uses the commits mechanism only. (codebase-analyzer + developer decision)
- **README patterns to follow.** Numbered step lists `README.md:38-57`, `README.md:104-121`; bold UI paths `README.md:39`, `README.md:84`; "Expected:" bullets `README.md:84-95`; blast-radius prose `README.md:100-103`; placeholder values `README.md:44`, `README.md:47`; list-nested bash fence `README.md:118-120`. (codebase-pattern-finder)
- **Precedent lessons.** Restated values went stale within one commit (`9e1c8ef` → `b050436`): cite `watch.yml:5-6` and config files instead. One-commit isolation is the norm (`c64c427` → `18246dd`): `git diff main --stat` must show README.md only. Sections that anticipated failure inline never needed follow-up fixes. (precedent-locator)
- **Line anchors verified accurate today:** `README.md:56-57` (single-clock Setup step), `README.md:91` (heartbeat tied to `*/10` cron), `README.md:139-141` (60-day bullet), insertion slot `README.md:96/98` (after Smoke run, before Refresh the Threads session). (integration-scanner)

## Scope

### Building

- One new README section `## External cron (cron-job.org)` between Smoke run and Refresh the Threads session, containing: blast-radius paragraph, PAT creation steps, `204` pre-flight curl, the paste line, import steps with fallback sentence, 401/403/404/422 debug table, watch-vs-ci trap sentence, fork note, heartbeat-valve link + cron-job.org failure-notifications pointer, native-cron-stays-on note.
- Three consistency edits in the same commit: `README.md:56-57`, `README.md:91`, `README.md:139-141`.

### Not Building

- Any change to `.github/workflows/watch.yml`, `.github/workflows/ci.yml`, or `src/`.
- A PAT row in the secrets table (the exception is named in prose only).
- Documenting cron-job.org's REST management API (Option 3, rejected upstream).
- Any committed setup script (would ship ungated and break documentation-only scope).
- Removing or weakening the native schedule.

## Decisions

### D1: Paste-line-first section shape

Inherited from the solutions artifact (Option 1). The crontab-prefixed curl is the only one-paste shape that fills schedule AND request fields; it round-trips cron-job.org's own export format (PRs #421/#441) and degrades to a manual field spec via the fallback sentence.

### D2: Placeholder style — `PASTE-YOUR-TOKEN-HERE`

- **Ambiguity:** existing README placeholders are kebab-case (`your-key-here` `README.md:44`, `your-app-password` `README.md:47`); the solutions artifact drafted GitHub-docs style `PASTE-YOUR-TOKEN-HERE`.
- **Explored:** (A) `your-token-here` — one style across the doc; (B) `PASTE-YOUR-TOKEN-HERE` — matches the artifact draft and GitHub's own docs wording.
- **Decision:** B — `PASTE-YOUR-TOKEN-HERE` (developer, 2026-10-25 checkpoint). Used identically in the pre-flight export and the paste line so the reader replaces one placeholder everywhere.

### D3: 60-day clause — commits are the activity

- **Ambiguity:** whether the appended Maintenance clause may claim dispatches themselves count as repo activity.
- **Explored:** (A) "dispatches count as activity" — shorter but unverifiable against GitHub's docs; (B) "the external cron's runs commit state on matches, and those commits are the activity GitHub counts" — matches the mechanism `README.md:139-141` already credits and the analyzer's evidence.
- **Decision:** B (developer, 2026-10-25 checkpoint). No claim beyond the commits mechanism.

### D4: Placement and consistency rewords

Insert between Smoke run and Refresh the Threads session (`README.md:96/98` anchor — verified). Reword `README.md:56-57` (schedule becomes "native", pointer to new section), `README.md:91` (heartbeat rate attributed per-run, not per-native-cron), append to `README.md:139-141`. All in the same commit — staleness lesson from `9e1c8ef` → `b050436`.

### D5: Cite sources, not values

The section references `watch.yml:4-6` (dual triggers) and `watch.yml:11-13` (concurrency) instead of restating semantics. The paste line necessarily restates the endpoint/body — those are the documented API contract, not repo config.

### D6: watch.yml stays byte-identical; native cron stays on

The dispatch trigger already exists (`watch.yml:6`). Dual clocks share the `watch` concurrency group, so overlap queues rather than races. The section says so and links the `HEARTBEAT_ENABLED` valve (Setup) plus cron-job.org failure notifications as the alarm channel.

## Architecture

### README.md — MODIFY (insert new section at ~:96; reword :56-57, :90-92; append to :139-141)

New section between "## Smoke run" and "## Refresh the Threads session", plus three consistency edits. Full content below.

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

## Slices

### Slice 1: External-cron section + consistency rewords

**Files**: `README.md`

#### Automated Verification:
- [ ] Project gates still pass: `npm run typecheck`, `npm run lint`, `npm test` (README-only diff must not disturb them)
- [ ] `git diff main --stat` lists README.md only; `.github/workflows/watch.yml` is byte-identical
- [ ] `grep -n 'cron-job.org' README.md` shows the `## External cron (cron-job.org)` heading between "## Smoke run" and "## Refresh the Threads session"
- [ ] PAT hygiene: `grep -nE 'github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+' README.md` returns nothing; the only token-shaped text is the `PASTE-YOUR-TOKEN-HERE` placeholder
- [ ] The step-3 paste line contains, in order: the `*/10 * * * *` prefix, `-X POST`, `Accept: application/vnd.github+json`, `Authorization: Bearer`, `Content-Type: application/json`, `{"ref":"main"}`, `https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches`
- [ ] `grep -n 'runs best-effort' README.md` returns the reworded Setup step 4 naming the schedule native and pointing at the External cron section
- [ ] `grep -n 'one email per run' README.md` returns wording that no longer ties the rate to the `*/10` cron
- [ ] The Maintenance bullet ends with the commits-are-activity sentence about the external cron

#### Manual Verification:
- [ ] Pre-flight: replace the placeholder with the real token, run the curl — it prints `204`
- [ ] A run appears under **Actions → watch** with event **workflow_dispatch** and reaches the Commit state step
- [ ] Paste the step-3 line into cron-job.org's **Import from cURL** once: the success feedback lists URL, POST, headers, body, and the 10-minute schedule
- [ ] (Staleness watch) If cron-job.org ever redesigns the dialog, the fallback sentence still holds — the same line is the field spec

## Desired End State

A reader goes from zero to an external 10-minute clock using only the README:

```bash
# 1. create fine-grained PAT (Actions: Read and write)
# 2. pre-flight prints:
204
# 3. paste the crontab+curl line into cron-job.org's Import from cURL
#    → import fills URL, POST, headers, {"ref":"main"} body, */10 schedule
# 4. trigger once → run under Actions → watch, event workflow_dispatch,
#    reaches the Commit state step
```

`grep -n 'cron-job.org' README.md` finds the section; `git diff main --stat` shows `README.md` only.

## File Map

`README.md`  # MODIFY — new External cron section (~60 lines) + 3 consistency rewords

## Ordering Constraints

Single slice. Within it: the new section and the three rewords land in one commit; the automated greps run after the README edit; the live checks (pre-flight 204, importer round-trip) run any time after the PAT exists — they do not depend on the README landing.

## Verification Notes

- CI has no docs gate — README-only diffs are invisible to all 4 gates; the greps below are the only automated checks. (integration-scanner)
- PAT-hygiene gate (precedent: validation artifact "PAT grep (0)"): no `github_pat_`/`ghp_`-shaped string anywhere in README.md.
- The importer does not expand `$PAT`; the README must say the token replaces the placeholder BEFORE importing (verified quirk, upstream research).
- `-d` without explicit Content-Type gets auto-tagged `application/x-www-form-urlencoded` by the importer — the paste line ships `Content-Type: application/json` (verified quirk).
- The importer's "authentication" field means HTTP basic auth — Bearer must ride in a `-H` header (verified quirk).
- A valid-but-wrong filename answers `204` and starts CI (`ci.yml:7` has dispatch); the trap sentence and the `404` table row both name `watch.yml` as the only correct filename.
- The 60-day clause claims only the commits mechanism (developer decision D3) — do not strengthen it to "dispatches are activity" without new evidence.
- Placeholder is `PASTE-YOUR-TOKEN-HERE` everywhere (developer decision D2) — the hygiene grep must not match anything else token-shaped.

## Performance Considerations

None — documentation-only change; no runtime path is touched.

## Migration Notes

None — no persisted schema or state format changes.

## Pattern References

- `README.md:38-57`, `README.md:104-121` — numbered step lists (list-nested fences indent 3 spaces, `README.md:118-120`)
- `README.md:39`, `README.md:84` — bold UI paths with `→`
- `README.md:84-95` — "Expected:" verification bullets
- `README.md:100-103` — blast-radius prose ("treat it like a password") — model for the token paragraph
- `README.md:44`, `README.md:47` — placeholder conventions (contrasted in D2)
- `watch.yml:4-6`, `watch.yml:11-13` — cited, not restated

## Developer Context

- **Q (directional, batched):** "Which placeholder style should the PAT use in the new curl paste line?" — evidence: kebab-case placeholders `README.md:44`/`:47` vs the solutions draft. **A:** `PASTE-YOUR-TOKEN-HERE` → D2.
- **Q (directional, batched):** "What may the appended 60-day clause claim?" — first answered "i dont understand this"; re-asked with the two candidate sentences shown verbatim. **A:** "Commits (Recommended)" — the commits-are-activity sentence → D3.
- **Design summary confirm:** "Proceed (Recommended)" → decomposition.
- **Decomposition confirm:** "Approve (Recommended)" → 1 slice, README.md only.

## Design History

- Slice 1: External-cron section + consistency rewords — approved as generated (slice-verifier: Decisions OK / Cross-slice OK / Research OK)

## References

- `.rpiv/artifacts/solutions/2026-10-25_19-07-23_external-cron-curl-import.md` — parent solution (Option 1, paste-line-first)
- `.rpiv/artifacts/research/2026-10-25_18-11-26_external-cron-curl-import.md` — upstream research (parser facts, quirks, API contract)
- `.rpiv/artifacts/discover/2026-10-25_17-39-33_external-cron-workflow-dispatch.md` — FRD (acceptance greps, PAT decision)
- `.github/workflows/watch.yml:4-6` — the triggers this section documents (untouched)
- https://github.com/pschlan/cron-job.org PRs #421/#423/#441/#460 — Import-from-cURL feature chain
- https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event — dispatch endpoint contract
