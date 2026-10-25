---
date: 2026-10-25T19:07:23+0700
author: Yogiswara Utama
commit: 3d4326b
branch: main
repository: loker-watcher
topic: "External cron (cron-job.org) driving workflow_dispatch; README section with Import-from-cURL paste line"
confidence: high
complexity: low
status: ready
verdict: pass
tags: [solutions, readme, github-actions, cron, workflow-dispatch, curl-import, cron-job-org]
last_updated: 2026-10-25T19:07:23+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: External cron (cron-job.org) + Import-from-cURL README section

**Date**: 2026-10-25T19:07:23+0700
**Author**: Yogiswara Utama
**Commit**: 3d4326b
**Branch**: main
**Repository**: loker-watcher

## Research Question
Chain from `.rpiv/artifacts/discover/2026-10-25_17-39-33_external-cron-workflow-dispatch.md` plus new requirement: "also the cron job able to import from curl. dont forget to create it in README.md. Import from cURL — Paste a cURL or wget command, or a full crontab line. We will populate the URL, request method, headers, body, authentication and schedule fields from it." What must the README section contain, where does it go, and what exactly does the paste-ready import line need?

## Summary
**Problem**: Document a cron-job.org clock that fires watch.yml's bare `workflow_dispatch:` (`.github/workflows/watch.yml:6`) every 10 minutes, with a paste-ready "Import from cURL" line, without touching the workflow (byte-identical requirement).
**Recommended**: **Option 1 — Paste-line-first** — one-paste crontab+curl line leads the section; it is the only candidate that satisfies the paste-ready requirement literally, it round-trips cron-job.org's own export format, and it degrades gracefully to manual entry because the same line is the field spec.
**Effort**: Low (~1-2 h: ~35-50 README lines + 3 consistency rewords + 6 manual gates).
**Confidence**: High.

## Problem Statement

**Requirements:**
- README section documents cron-job.org → `POST https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches`, body `{"ref":"main"}`, every 10 minutes.
- A paste-ready "Import from cURL" line that fills schedule + URL + method + headers + body in one import.
- Fine-grained PAT guidance (Actions: Read and write; Metadata read-only is force-enabled).
- Consistency: existing README lines that assume one clock get reworded in the same commit.

**Constraints:**
- Hard: `.github/workflows/watch.yml` stays byte-identical (dual triggers already exist at :4-6; concurrency guard :11-13; FRD non-goal).
- Hard: repo hygiene — no `github_pat_`-shaped string anywhere in README (validation gate "PAT grep (0)"); secrets live in Actions secrets only, and the PAT is the one named exception because cron-job.org must send it and cannot read Actions secrets (AGENTS.md).
- Hard: no new runtime artifact without stated need (AGENTS.md); the FRD scopes this change to documentation-only.
- Soft: cite source files (`watch.yml:5-6`, `src/config.ts:30-34`) instead of restating values — README claims in this repo went stale within one commit before (9e1c8ef → b050436).

**Success criteria:**
- `grep -n 'cron-job.org' README.md` matches the new section heading; `git diff main --stat` shows README.md only; PAT-hygiene grep returns 0 real tokens.
- A reader can go from zero to an external 10-minute clock using only the README: PAT → paste line → import → verify (204 pre-flight; watch workflow runs with event `workflow_dispatch`).

## Current State

**Existing implementation:**
- The server side already exists: `.github/workflows/watch.yml:4-6` has both `schedule: cron "*/10 * * * *"` and a bare `workflow_dispatch:`; nothing in `src/` reads the schedule, so the entire feature is documentation.
- Overlap safety exists: `watch.yml:11-13` concurrency group `watch`, `cancel-in-progress: false` (queued, never cancelled); `watch.yml:18` `timeout-minutes: 10` bounds each run (measured 44s and 2m16s).
- README today: 8 `##` sections; single-clock prose at `README.md:56-57` ("The schedule ... then runs best-effort") and `README.md:91` ("At the `*/10` cron that is one email per run"); 60-day auto-disable bullet at `README.md:139-141`; secrets table `README.md:41-48` (PAT deliberately absent); `HEARTBEAT_ENABLED` valve documented `README.md:50-51`.
- Zero curl/api.github.com content exists in README today — the new section introduces the first absolute self-referencing repo URL.

**Relevant patterns:**
- Numbered step-lists: `README.md:11-25` (Pipeline, 9 items), `README.md:38-57` (Setup, 4 items), `README.md:104-120` (session refresh, 3 items) — 3 precedents.
- Bold UI paths: `README.md:39`, `README.md:84`, `README.md:13` — 3 precedents.
- Blast-radius-before-steps prose: `README.md:100-102` ("treat it like a password") — verbatim model for the PAT paragraph.
- "Expected:" verification bullets: `README.md:85-92` (Smoke run).
- Placeholder style: `your-key-here` `README.md:44`, `your-app-password` `README.md:47`.
- Cite-source-not-values: `README.md:50-53` defers to `watcher.config.json`.

**Integration points:**
- `README.md:96/98` — insertion slot (after Smoke run, before Refresh the Threads session).
- `README.md:56-57`, `README.md:91` — mandatory same-commit rewords (single-clock prose).
- `README.md:139-141` — soft append (dispatched runs count as activity; external cron becomes the first-line remedy).
- `ci.yml:7` — second bare `workflow_dispatch:`; the watch-vs-ci reader trap: a wrong-but-valid filename silently dispatches CI with a 204.

## Solution Options

### Option 1: Paste-line-first
**How it works:**
The section leads with the one-paste crontab-prefixed curl line — `*/10 * * * * curl -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer PASTE-YOUR-TOKEN-HERE" -H "Content-Type: application/json" -d '{"ref":"main"}' https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches` — pasted into cron-job.org's "Import from cURL" dialog (job editor, bottom button; pasting into the URL field also triggers detection). A bare curl with a `$PAT` placeholder is the step-0 pre-flight (expect HTTP 204, empty body). Prose covers PAT creation, blast radius, the `HEARTBEAT_ENABLED` valve, verification, a 401/403/404/422 debug table, the watch-vs-ci sentence, and a fork note (replace `ukind/loker-watcher`).

**Pros:**
- Only candidate that literally satisfies "paste-ready import" — the crontab prefix is the only single-paste shape that fills schedule AND request fields (cron-job.org PR #441, 2026-06-29).
- Round-trip guarantee: the service's own job **export** emits the identical "Crontab + curl" shape (`JobExporter.exportToCrontab`), and the parser is regression-tested against that exact output (PRs #421/#441).
- Production-deployed and stable: feature chain merged to the `prod` branch that auto-deploys console.cron-job.org; parser unchanged for ~3 months (2 commits total, last 2026-07-28); zero open bugs; owner-maintained.
- Graceful failure: if import ever breaks, the same line is the field-by-field spec (method/URL/headers/body/schedule all readable off it) — Option 2's robustness comes free.
- Assembles entirely from existing README shapes (see patterns above); ~35-50 lines, one commit, proven one-commit revert pattern (c64c427 → 18246dd).

**Cons:**
- The importer is ~4 months old and officially undocumented (absent from docs.cron-job.org and the blog) — a UI redesign would break the instructions silently.
- `$PAT` is not expanded by cron-job.org's importer; the placeholder must be replaced before pasting (README must say so).
- `-d` without explicit Content-Type gets auto-tagged `application/x-www-form-urlencoded` by the importer — the paste line must ship `Content-Type: application/json`.

**Complexity:** Low (~1-2 h)
- Files to create: 0. Files to modify: 1 (README.md, ~35-50 lines added + ~6 reworded).
- Risk level: Low (workflow untouched; no code path).

### Option 2: Form-field walkthrough
**How it works:**
Numbered steps fill each cron-job.org form field manually (URL; method POST; headers `Authorization: Bearer ...` + `Content-Type: application/json`; body `{"ref":"main"}`; schedule "every 10 minutes" preset — `MINUTE_CHOICES` includes 10). The import line is demoted to an optional convenience note.

**Pros:**
- Most conservative path by construction: the form fields shipped with the frontend's initial import (2021-08-19), the FAQ text documenting custom headers and POST+body is verbatim identical between a 2019 snapshot and today, and the method enum has not changed since 2020-12-28. The hosted console deploys from the same open-source repo (`frontend.prod.yml` → console.cron-job.org), so an OSS walkthrough IS the hosted walkthrough.
- Zero dependency on the young undocumented importer.

**Cons:**
- ~10 minutes of reader work vs 1-2 for the paste — and it contradicts the developer decision that the import line leads (discover checkpoint).
- The demoted import still needs its own caveats paragraph if mentioned, doubling the section's token-handling prose.
- Still needs every consistency edit Option 1 needs; staleness risk merely moves from the importer to UI chrome (field names/tabs).

**Complexity:** Low (~1-2 h)
- Files to modify: 1 (README.md, ~30-45 lines + same ~6 reworded lines).
- Risk level: Low.

### Option 3: Scripted REST setup
**How it works:**
Document creating the job via cron-job.org's REST management API: token from Console → Settings → API Keys; `PUT /jobs` (create) with JSON `{requestMethod: 1, extendedData: {headers, body}, schedule: {minutes: [0,10,20,30,40,50], hours: [-1], ...}}`, or `PATCH /jobs/<id>` for updates — either as a copy-paste curl block or a committed script.

**Pros:**
- The API is official, documented (docs.cron-job.org/rest-api.html with curl/Python examples), ~5 years old, additively evolving, zero deprecation signals.
- Most automatable and repeatable if the operator ever manages many jobs.

**Cons:**
- No added capability for one static job: strictly more work (reader ~20-40 min vs 1-2) with more failure modes — `PUT`-for-create trips people up (documented SO/Reddit confusion), integer `requestMethod` enums, `extendedData` nesting, array schedules with `[-1]` sentinels, 403 on IP-allowlisted keys, 429 on the 100 req/day quota (5 req/min create limit), and no idempotent upsert (re-running create silently duplicates the job).
- Committed-script variant soft-blocks: `scripts/` has zero user-facing precedent (README never mentions it), the script ships ungated (lint is `biome check src tests`; lint-staged matches `*.ts` only), tests must stay offline so a live-API script gets no test, and it breaks the FRD's documentation-only scope — reviewers will apply the AGENTS.md stated-need rule to it.
- Adds a second credential class (account-wide cron-job.org API key) to a doc whose hygiene story is "the PAT is the one exception".

**Complexity:** Med (curl variant ~2-3 h; script variant ~1 day)
- Files to modify: 1 (README.md); files to create (script variant): 1 (~40-80 lines, ungated) + possible lint-glob widening.
- Risk level: Med.

## Comparison

| Criteria | Option 1: Paste-line-first | Option 2: Form walkthrough | Option 3: REST script |
|----------|----------|----------|----------|
| Complexity | L | L | M |
| Codebase fit | H (3rd numbered list, existing fences/tables/bold paths) | H (same shapes, import demoted) | M (curl-block fits; script is first-of-kind, off-FRD scope) |
| Risk | L (undocumented importer; graceful fallback) | L (UI chrome churn only) | M (ungated artifact, quota/dup failure modes) |
| Reader setup effort | 1-2 min paste + PAT | ~10 min field-by-field | 20-40 min |
| Staleness surface | importer UI (young, undocumented) | form labels/tabs (5+ yr stable) | API docs (stable) + committed script sync |
| Scope match (README-only, paste-ready) | Exact | Misses paste-ready | Exceeds scope (script variant) |

## Recommendation

**Selected:** Option 1 — Paste-line-first

**Rationale:**
- It is the only candidate that satisfies the stated requirement ("able to import from curl", paste-ready) as written; the crontab-prefixed shape is cron-job.org's own canonical export/import format, verified in the service's parser unit tests and production branch.
- Evidence chain is strong despite the feature's youth: owner-merged PRs #421/#423/#441/#460, parser quiet ~3 months, zero open bugs, round-trip tested, prod-deployed to console.cron-job.org.
- Cheapest to land and to revert: one contiguous README block + 3 consistency rewords, one commit, no workflow or source changes (watch.yml stays byte-identical; the trigger it needs already exists at watch.yml:6).
- Novelty risk is hedged for free: the paste line doubles as Option 2's field spec (fallback sentence: "if the import dialog is gone or mis-parses, the same line lists every field to enter manually"), and the step-0 bare curl is independent of cron-job.org entirely.

**Why not alternatives:**
- Option 2: robust but slow (~10 min reader path) and it demotes the exact feature the requirement names; its stability advantage is recovered inside Option 1 via the fallback sentence.
- Option 3: overkill — no capability the paste path lacks for one static job; the committed-script variant breaks documentation-only scope, ships ungated, and multiplies failure modes (enum/nesting/schedule JSON, quota 429, silent job duplication, second credential class).

**Trade-offs:**
- Accepting dependence on an undocumented ~4-month-old UI affordance in exchange for one-paste completeness; mitigated by the manual-fallback sentence and the service's export/import round-trip guarantee.
- Accepting ~2x heartbeat email noise under dual clocks; mitigated by linking the existing `HEARTBEAT_ENABLED=false` valve (README.md:50-51) and enabling cron-job.org failure notifications as the alarm channel.

**Implementation approach:**
1. Insert the section after `README.md:96` / before `README.md:98`: heading `## External cron (cron-job.org)`, blast-radius paragraph, PAT creation steps (fine-grained, Only select repositories, Actions → Read and write), the paste fence, step-0 pre-flight fence, "Expected:" verification bullets (204; watch workflow, event workflow_dispatch; run reaches Commit state), 401/403/404/422 debug table, watch-vs-ci sentence, fork note, valve link + failure-notifications pointer, and the two-sentence "keep native cron" redundancy note.
2. Same commit, reword `README.md:56-57` (schedule stays as best-effort fallback clock; pointer to the new section) and `README.md:91` (heartbeat rate attributed per-run, not per-native-cron); append the external-dispatch clause to `README.md:139-141`.
3. Cite sources, not values: reference `watch.yml:5-6` and `src/config.ts:30-34` for cadence/valve semantics instead of restating them.
4. Gates: `grep -n 'cron-job.org' README.md`; PAT-hygiene grep (0 real tokens, placeholder only); `git diff main --stat` shows README.md only; live pre-flight expects 204 with empty body; paste the line once and confirm the import snackbar lists the execution schedule.

**Integration points:**
- `README.md:96-98` — insertion slot for the new section.
- `README.md:56-57`, `README.md:91`, `README.md:139-141` — consistency rewords, same commit.
- `.github/workflows/watch.yml:6` — the trigger the external clock fires; byte-identical, no edit.
- `README.md:50-51` — existing valve docs the new section links.

**Patterns to follow:**
- Numbered steps + bold UI path: `README.md:104-120`, `README.md:39`.
- Blast-radius prose: `README.md:100-102`.
- "Expected:" bullets: `README.md:85-92`.
- Placeholder style: `README.md:44`, `README.md:47`.

**Risks:**
- Importer redesign/removal (undocumented feature): fallback sentence makes the same line a manual spec; staleness caught by periodic doc review.
- `$PAT` placeholder confusion: state explicitly that the token replaces the placeholder BEFORE importing (the importer does no expansion); the pre-flight curl keeps `$PAT` only because the shell expands it (POSIX — the README already assumes POSIX at `README.md:129-135`).
- watch-vs-ci silent misfire (valid wrong filename returns 204): one sentence + debug-table wording ("wrong filename-or-slug; only `watch.yml` is correct").
- Heartbeat noise doubles: link the valve; name cron-job.org failure notifications as the alarm when the valve is set.

## Scope Boundaries
- Building: one README section + 3 consistency rewords, paste-line-first, with PAT/pre-flight/verify/debug content and a manual-fallback sentence.
- NOT doing: any change to `.github/workflows/watch.yml` or `src/`; any committed script; a PAT row in the secrets table (the exception is named in prose instead); documenting cron-job.org's REST API; removing the native cron.

## Testing Strategy

**Unit tests:**
- None — no code path changes; `src/` and `tests/` untouched.

**Integration tests:**
- None available — CI has no docs gate (`ci.yml:26-33` covers typecheck/lint/test on TS only); README-only diffs are invisible to all 4 existing gates.

**Manual verification:**
- [ ] `grep -n 'cron-job.org' README.md` matches the new heading, positioned between Smoke run and Refresh the Threads session.
- [ ] PAT-hygiene grep over README.md: no `github_pat_`/`ghp_`-shaped string; placeholders only (`PASTE-YOUR-TOKEN-HERE`).
- [ ] Paste fence contains exactly: POST, `Authorization: Bearer`, `Content-Type: application/json`, body `{"ref":"main"}`, URL `.../workflows/watch.yml/dispatches`, placeholder token, `*/10 * * * *` prefix.
- [ ] `git diff main --stat`: README.md only (watch.yml byte-identical).
- [ ] Consistency sweep: :56-57 and :91 reworded in the same commit; :139-141 appended.
- [ ] Live: pre-flight curl returns 204 with empty body; newest run under **watch** with event **workflow_dispatch**; paste the crontab line into the importer once and confirm the success feedback lists the execution schedule.

## Open Questions
**Resolved during research:**
- Does the one-paste crontab+curl shape really fill all fields? — Yes: crontab-prefix parsing landed 2026-06-29 (PR #441) and is regression-tested against the service's own export format; hosted console deploys from the same `prod` branch.
- Is the hosted importer the same as the OSS one? — The console auto-deploys the OSS frontend (S3/CloudFront, `frontend.prod.yml`); parser unchanged since 2026-07-28. Residual prod-vs-master lag is the only caveat.
- Is the REST API a better path? — No for this scope: documented and stable, but 10-20x the reader effort with no added capability for one static job.

**Requires user input:**
- None blocking. Default assumptions already decided at discover: hard-coded `ukind/loker-watcher` slug with fork note; fine-grained PAT; native cron stays.

**Blockers:**
- None.

## References
- `.rpiv/artifacts/research/2026-10-25_18-11-26_external-cron-curl-import.md` — source research (API contract, PAT scope, parser facts, paste line, placement)
- `.rpiv/artifacts/discover/2026-10-25_17-39-33_external-cron-workflow-dispatch.md` — FRD: dual triggers, PAT decision, README-section requirement, acceptance greps
- `.github/workflows/watch.yml:4-6` — dual triggers the section documents (untouched)
- `README.md:82-96` — Smoke run section (placement anchor; "Expected:" bullet model)
- `README.md:98-125` — Refresh the Threads session (tone model: blast-radius prose, rotation symptoms)
- https://github.com/pschlan/cron-job.org PRs #421/#423/#441/#460 — the Import-from-cURL feature chain and its one bug fix
- https://docs.cron-job.org/rest-api.html — REST management API evaluated and rejected for this scope (Option 3)
- https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event — dispatch endpoint contract (filename addressing, 204, permissions)
- `.rpiv/artifacts/validation/2026-10-25_14-19-21_threads-hiring-alerts.md` — "PAT grep (0)" hygiene gate precedent
