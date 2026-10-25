---
date: 2026-10-25T18:11:26+0700
author: Yogiswara Utama
commit: 3d4326b
branch: main
repository: loker-watcher
topic: "External cron (cron-job.org) driving workflow_dispatch every 10 min; README section with an Import-from-cURL paste line"
tags: [research, codebase, github-actions, cron, workflow-dispatch, readme, curl-import, fine-grained-pat]
status: ready
last_updated: 2026-10-25T18:11:26+0700
last_updated_by: Yogiswara Utama
---

# Research: External cron (cron-job.org) + Import from cURL, documented in README

## Research Question
Chain from `.rpiv/artifacts/discover/2026-10-25_17-39-33_external-cron-workflow-dispatch.md` plus new requirement: "also the cron job able to import from curl. dont forget to create it in README.md. Import from cURL — Paste a cURL or wget command, or a full crontab line. We will populate the URL, request method, headers, body, authentication and schedule fields from it." What must the README section contain, where does it go, and what exactly does the paste-ready import line need?

## Summary
The change stays README-only; every code path the second clock needs already exists (`.github/workflows/watch.yml:6` bare `workflow_dispatch:`, `watch.yml:11-13` concurrency guard). The dispatch API contract is confirmed: POST `https://api.github.com/repos/{owner}/{repo}/actions/workflows/watch.yml/dispatches` — filename addressing, `name: watch` is NOT the identifier — body `{"ref":"main"}`, expect **HTTP 204 with empty body**. A fine-grained PAT needs exactly **Actions: Read and write** (Metadata read-only is force-enabled automatically); `Authorization: Bearer` is the documented scheme. On cron-job.org, the **crontab-prefixed curl line is the only single-paste shape** that fills schedule + URL + method + headers + body in one import (verified against the service's own GPL frontend parser and its unit tests); a bare cURL imports with the form's default every-15-minutes schedule. Two verified traps shape the paste line: cron-job.org does **not** expand `$PAT` (the real token must replace the placeholder before pasting), and `-d` JSON without an explicit Content-Type gets auto-tagged `application/x-www-form-urlencoded` by the importer (ship `Content-Type: application/json`). Developer decisions: hard-code the `ukind/loker-watcher` slug with a fork note, lead with the crontab line, keep the bare curl as the pre-flight verification command.

## Detailed Findings

### 1. GitHub workflow_dispatch API contract
- Endpoint accepts the **workflow file name** in place of the numeric id: "You can replace `workflow_id` with the workflow file name" — https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event. So `.../workflows/watch.yml/dispatches` is valid; `.../workflows/watch/dispatches` (the YAML `name:` at `.github/workflows/watch.yml:1`) would 404.
- `ref` is required and takes a branch or tag name; `inputs` is optional ("Any default properties configured in the workflow file will be used when inputs are omitted") — which is why `{"ref":"main"}` alone works against the bare trigger at `.github/workflows/watch.yml:6`. SHA refs are undocumented; do not use.
- Prerequisite: the workflow must exist on the default branch with the trigger (it does; `watch.yml` is on `main`).
- Success = **204 No Content, empty body** (with the body omitted `return_run_details`; `true` would return 200 + run id). A reader must know silence is success.
- Verified failure map for the README's debug table: **401** "Bad credentials" (wrong/expired/revoked token); **403** "Resource not accessible by personal access token" (missing Actions write, or repo not in the token's selected repos); **404** "Not Found" (wrong workflow filename or slug — GitHub 404s rather than leaks); **422** "No ref found for: <ref>" (unknown branch) or "Workflow does not have 'workflow_dispatch' trigger". Every response carries `X-Accepted-GitHub-Permissions` naming what was missing.
- Wrong filename targets exactly one workflow: `ci.yml:7` (also a bare `workflow_dispatch:`) can only fire from a URL naming `ci.yml`. A 204 can never create a `ci` run; the reader-side trap is misreading the Actions tab.
- Rate cost at 144 calls/day ≈ 6/hour ≈ 0.1% of the 5,000/hour authenticated budget — negligible (confirming discover FRD assumption at `.rpiv/artifacts/discover/2026-10-25_17-39-33_external-cron-workflow-dispatch.md:50`).
- Headers: only `Authorization` is required. `Accept: application/vnd.github+json` is "recommended"; `X-GitHub-Api-Version` optional (defaults `2022-11-28`). GitHub's own curl examples send `-d` JSON with no explicit Content-Type and it parses.

### 2. Fine-grained PAT
- Required permission: **Actions → Read and write** under Repository permissions — endpoint doc verbatim: "The fine-grained token must have the following permission set: 'Actions' repository permissions (write)". **Metadata: read-only is force-enabled** at creation (read-only by design; not separately selectable).
- Creation path: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**; Resource owner = you; **Repository access → Only select repositories**; Permissions → Repository permissions → **Actions → Read and write**; everything else No access.
- Expiry/rotation: token auto-revokes at expiry and after 1 year of non-use; **shown once** at creation; **no in-place regenerate** — rotation = create new, update cron-job.org, delete old. Set an expiry deliberately (default 30 days; custom dates allowed).
- Header scheme: `Authorization: Bearer <token>` is what every current doc example uses (legacy `token` prefix still works but is undocumented-first).
- Classic-PAT contrast (one line for README): classic needs the `repo` scope → grants read/write to **every** repo the account touches; fine-grained is the minimization.
- Blast radius of this exact token (verified): CAN trigger/enable/disable workflows, cancel/rerun runs, delete run logs, read logs+artifacts. CANNOT read Actions secrets (separate "Secrets" permission), CANNOT write code (needs Contents write), CANNOT touch anything outside the selected repo.

### 3. cron-job.org "Import from cURL" — parser facts (from the service's own GPL frontend + unit tests)
- The developer's quote is the in-app dialog help string (`jobs.curlImport.help`). The written docs at docs.cron-job.org do NOT document the import; the authoritative spec is https://github.com/pschlan/cron-job.org frontend source. Feature landed via PRs #421 (2026-06-11), #423, #441 (crontab support, 2026-06-29), #460.
- **(a) Bare cURL imports fine without a schedule** — the schedule field is left untouched; a new job's form default is **every 15 minutes** (`minutes: [0,15,30,45]`), enabled, not paused. So a bare-cURL README flow needs an explicit "then set every 10 minutes" step.
- **(b) The crontab-prefixed line is the only one-paste-complete shape.** Detection: ≥6 whitespace tokens, first 5 matching `* | */n | n | a-b | comma-lists`; the remainder must start with `curl`/`wget`. Rejected: `@daily`-style macros, 6-field seconds syntax, month/day names, `?`/`L`/`W`, out-of-range values. cron-job.org's own "Crontab + curl" job **export** emits exactly this format and a unit test round-trips it — it is the canonical shape.
- **(c) Tokenizer traps that shape the paste line:**
  - Single-quoted `-d '{"ref":"main"}'` survives literally (recommended). Double-quote-with-escapes also works. **Unquoted** `-d {"ref": "main"}` corrupts the body (tokenizer strips quotes, splits on the space).
  - `-d`/multi-`-d` implies POST and, **if no Content-Type header is present, auto-adds `application/x-www-form-urlencoded`**. The editor shows a "Sending JSON data?" warning with a fix button, but the paste line should carry `Content-Type: application/json` explicitly (or use `--json`, which adds it + `Accept: application/json`).
  - **`$PAT` is not expanded** — no variable substitution exists (only `%cjo:unixtime%`/`%cjo:uuid4%` variables). A line pasted with the literal `$PAT` becomes a broken-auth job. The README must say: replace the placeholder with the real token value **before** importing.
  - Repeated `-H` all accumulate; header without a colon is silently ignored; ~50 common flags (`-L -k -s -m 30 -o /dev/null`...) are safely ignored; unknown `-X` methods hard-error.
- **(d) "Authentication" = the job's built-in HTTP basic auth** (`-u user:pass` toggles "Requires HTTP authentication"). A `Bearer` token sent via `-H "Authorization: Bearer ..."` lands in the **headers list** — which is exactly what GitHub wants. Do not use cron-job.org's auth fields.
- **(e) Free plan covers everything this job needs:** intervals down to 1 minute (`*/10` = 144/day ≪ 60/hour cap), custom methods/headers/bodies (only `User-Agent` and `Connection` headers are ignored), no job-count limit, **email failure notifications** ("Status notifications… when one of your jobs fail"), last **50 executions** viewable with status + response for 2 days. The only 100/day cap in the docs is the REST-management-API quota, unrelated to executions. Jobs auto-disable after ~25 consecutive failures.
- **(f) UI placement:** the import lives **inside the job editor** (create/edit page) — "Import from cURL" button at the bottom next to Test run/Save. Also: pasting a curl/crontab line into the **URL field** triggers a live-detect banner with an "Import command" button.

### 4. The paste-ready line (constants + decisions)
Repo-specific constants: slug `ukind/loker-watcher` (developer decision: hard-code; origin at `.git/config:10`, and `package.json:2-4` has no `repository` field so metadata cannot supply it — fork note: "Forked this repo? Replace `ukind/loker-watcher` with your own `<owner>/<repo>`"); workflow path segment is the **filename** `watch.yml`; body exactly `{"ref":"main"}` (`main` is the tracked branch, `.git/config:13-14`).
Primary import line (crontab + curl, one paste):

```bash
*/10 * * * * curl -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer PASTE-YOUR-TOKEN-HERE" -H "Content-Type: application/json" -d '{"ref":"main"}' https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches
```

Pre-flight verification command (shell expands `$PAT`, so the placeholder form is safe here) — expect 204, empty body:

```bash
curl -X POST -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" -d '{"ref":"main"}' https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches
```

Hygiene gates: only placeholder tokens in the README — never the `github_pat_` prefix shape (validation gate "PAT grep (0)", `.rpiv/artifacts/validation/2026-10-25_14-19-21_threads-hiring-alerts.md`); avoid gratuitous `password`/`api_key` literals. Optional API-courtesy headers (`Accept`, `X-GitHub-Api-Version: 2022-11-28`) may be mentioned in prose, never required in the paste block beyond Content-Type (which the importer's own behavior forces).

### 5. README placement + consistency edits
- New section: `## External cron (cron-job.org)` **between current lines 96 and 98** (after Smoke run ends, before Refresh the Threads session). Rationale: adjacent to the `workflow_dispatch` demo (`README.md:84`), reachable from Setup, back-to-back with the credential-hygiene prose at `README.md:100-102` it should imitate; heading guarantees the acceptance grep `cron-job.org` matches.
- Required consistency edits (stop the doc asserting the native cron is the only clock):
  1. `README.md:56-57` (Setup step 4) — reword: schedule runs best-effort **and stays as the fallback clock**; pointer to the new section. The hinge edit; makes a Setup step 5 redundant.
  2. `README.md:91` (Smoke run heartbeat bullet) — "At the `*/10` cron that is one email per run" goes numerically stale under dual triggers (FRD follow-up: inbox noise roughly doubles). Reattribute to cadence: ~144/day, more with external cron.
  3. `README.md:139-141` (60-day auto-disable bullet) — append: dispatched runs from cron-job.org count as activity too; manual-dispatch advice stays as the no-external-cron fallback.
  4. Optional: `README.md:4` cadence sentence stays literally true as-is; `README.md:29-31` "11,000 paid minutes" derives from 144 fires/day — one parenthetical if belt-and-braces.
- Do NOT add a PAT row to the secrets table at `README.md:41-48` (that table inventories Actions secrets; this token deliberately lives elsewhere — naming the exception in prose is the honest move per AGENTS.md policy).

### 6. Dual-clock facts the section must state
- Overlap guard: `watch.yml:11-13` (`group: watch`, `cancel-in-progress: false`) — overlapping fires **queue**, never cancel. Runs measured at 44s and 2m16s vs the `timeout-minutes: 10` cap (`watch.yml:18`), so a dual fire costs minutes of delay, not a lost run. Worst case ~288 fires/day (144 external + drifting native), negligible on the public-repo free tier.
- Heartbeat noise: zero-match is the normal case (`src/heartbeat.ts:8-10`); every zero-match run emails via `src/index.ts:88`, `src/index.ts:97`, `src/index.ts:114`; `isHeartbeatEnabled` (`src/config.ts:30-34`) defaults **on** ("144 emails a day" comment at `src/config.ts:27-28`). Dual clocks push the ceiling toward ~288/day. Valve: `HEARTBEAT_ENABLED=false`, already documented at `README.md:25`, `README.md:50-51`, `README.md:91-92` — the new section links it, plus the flip side: with the valve set, **cron-job.org failure notifications become the alarm** (FRD follow-up, discover:101), not inbox silence.
- Why native cron stays: redundancy (discover:80-81). Two sentences inside the new section answer the "can I delete the schedule block now?" temptation at the exact moment it arises.

### 7. Verification sequence for the README
1. **Step 0 — manual curl first** (pre-flight command above), require 204. Isolates 401/403/404/422 causes from scheduler quirks, and validates the FRD's free-plan assumptions (discover:48-50) before any cron-job.org configuration.
2. **watch, not ci**: check the newest run is under the **watch** workflow with event **workflow_dispatch**. A `ci` run proves nothing (every push fires one, `ci.yml:4-7`); a 204 can only ever create a `watch` run (filename-addressed URL).
3. **Enable the schedule, check boundaries**: cron-job.org execution history shows entries every 10 minutes; external runs start at exact :00/:10-style boundaries — the visible difference from drifting native runs.
4. **Trigger equivalence**: the run is green AND reached the Commit state step (`watch.yml:42-54`) — usually the "state unchanged; nothing to commit" no-op (`watch.yml:47-50`), since zero-match is normal. Mirror the Smoke run expectations at `README.md:86-89` by reference, don't duplicate.
5. **Alarm channel**: enable cron-job.org failure notifications during setup. Heartbeat silence is a weak detector in all three failure shapes: matches flowing (digests instead, `src/index.ts:121`), valve set (`src/index.ts:38-41`), or delivery failure that never fails the run (`src/index.ts:46-49`).
6. **Silent-stop decision tree**: (1) cron-job.org history empty → external clock died, native cron still provides degraded cadence; (2) history shows attempts but no watch runs → expired/revoked PAT, slug drift after fork/rename, or 60-day Actions auto-disable; (3) inbox quiet but runs green → not a failure (matches flowing or valve set).

## Code References
- `.github/workflows/watch.yml:4-6` — dual triggers: `schedule: cron "*/10 * * * *"` + bare `workflow_dispatch:` (both stay untouched)
- `.github/workflows/watch.yml:11-13` — concurrency group `watch`, `cancel-in-progress: false` (sole overlap guard)
- `.github/workflows/watch.yml:18` — `timeout-minutes: 10` (why overlap is rare)
- `.github/workflows/watch.yml:42-54` — Commit state step (trigger-agnostic; the equivalence check)
- `.github/workflows/ci.yml:7` — second bare `workflow_dispatch:` (the watch-vs-ci reader trap)
- `README.md:56-57` — Setup step 4, the primary single-clock sentence to reword
- `README.md:82-96` — Smoke run section (placement anchor; new section goes after it)
- `README.md:91` — heartbeat-rate sentence that goes stale under dual triggers
- `README.md:98-125` — Refresh the Threads session (tone/prose model: blast-radius sentence :100-102, rotation-symptom pattern :122-125, UI-path bolding :39)
- `README.md:137-143` — Maintenance (60-day bullet :139-141 gets the external-dispatch append)
- `src/index.ts:32-50` — `heartbeat()` wrapper; run-time env gate :38-41; call sites :88/:97/:114; digest path :121
- `src/config.ts:30-34` — `isHeartbeatEnabled`, default-on; "144 emails a day" comment :27-28; env name :16
- `src/heartbeat.ts:8-10` — "zero-match run is the normal case" measurement comment
- `.git/config:10` — origin URL `https://github.com/ukind/loker-watcher.git` (slug source)
- `.git/config:13-14` — branch main tracks origin/main (the `ref` value)
- `package.json:2-4` — no `repository` field; slug not derivable from metadata

## Integration Points
### Inbound References
- cron-job.org job (external) → `POST https://api.github.com/repos/ukind/loker-watcher/actions/workflows/watch.yml/dispatches` → fires `watch.yml:6`; runs serialize through `watch.yml:11-13`
- README.md (new section between :96/:98) documents the job, the PAT, the paste line, and the verify sequence
- `.rpiv/artifacts/discover/2026-10-25_17-39-33_external-cron-workflow-dispatch.md:35-39` — FR1/FR2/FR5 define the endpoint, token, and guard contract this section implements

### Outbound Dependencies
- Dispatched runs depend on the six Actions secrets (`watch.yml:33-40`) exactly as native runs do — no new wiring
- Heartbeat/digest email chain unchanged: `src/index.ts:88,97,114,121` → `src/heartbeat.ts` / `src/email.ts`

### Infrastructure Wiring
- `watch.yml:3-6` — the dual-trigger `on:` block is the entire server-side surface; FRD acceptance requires it byte-identical
- `ci.yml:4-7` — push/PR/dispatch triggers coexist; only the URL filename disambiguates
- GitHub-side: fine-grained PAT (Actions R/W + forced Metadata read) held only in cron-job.org; rate budget ~0.1%/hour consumed

## Architecture Insights
- **Documentation-as-configuration**: no `src/` code reads the schedule (`watch.yml:5` unused by code), so the whole feature is docs — the workflow is already a dual-trigger listener.
- **Filename-addressed workflows**: the API identifies workflows by file name or numeric id; the YAML `name:` is display-only. The README should say this once — it defuses the watch-vs-ci trap and the 404 case.
- **Credential minimization with one named exception**: repo policy is "Secrets live in GitHub Actions secrets only" (AGENTS.md; echoed at `src/config.ts:2-4`). The PAT is the first documented exception because cron-job.org must send it and cannot read Actions secrets — the README names the exception and pairs it with the single-repo/Actions-only scope as the compensating control.
- **Importer asymmetry**: cron-job.org's "authentication" field means HTTP basic auth; GitHub wants Bearer-as-header. The paste line's `-H` form is not just valid but the *correct* target field.
- **Doc-staleness defense**: cite files (`watch.yml:5`, `watcher.config.json`) rather than restating values in prose — this repo's docs have repeatedly gone stale within one commit.

## Precedents & Lessons
4 similar past changes analyzed.

### Precedent: Initial pipeline incl. cron schedule + README setup docs
**Commit(s)**: `1a9e353` — "feat: threads #hiring indonesia job alert pipeline (v1)" (2026-10-25)
**Blast radius**: 17 files, all layers in one commit (README, watch.yml with both triggers, src/, tests/, state)
**Lessons from docs**:
- designs/2026-10-24_17-18-15 — `*/10` valid but GitHub scheduled runs are best-effort/delay-prone (the drift this feature fixes)
- GITHUB_TOKEN pushes do not re-trigger workflows — the state commit-back cannot cause a dispatch loop
- Public repos auto-disable scheduled workflows after 60 idle days; commit-backs count as activity
**Takeaway**: keep the 60-day warning — it still applies to the retained native fallback.

### Precedent: README cadence/env claims rewritten on every behavior change
**Commit(s)**: `9e1c8ef` (2026-10-25), `67a9bd2` (2026-10-25), `b050436` (2026-10-25)
**Blast radius**: each touched README + watch.yml + src/config.ts + src/index.ts simultaneously
**Follow-up fixes**: `b050436` removed the env lines `9e1c8ef` added to watch.yml one commit earlier — env docs lived exactly one commit before going stale
**Lessons from docs**: discover/2026-10-24_13-36-02 still says 5-minute cadence (revised to 10 at design stage, FRD never updated)
**Takeaway**: doc claims here go stale within one commit; cite source-of-truth files, not values.

### Precedent: CI added; docs get zero automated validation
**Commit(s)**: `3d4326b` — "ci: run typecheck, lint, and tests on push" (2026-10-25)
**Blast radius**: 1 file (`.github/workflows/ci.yml`)
**Takeaway**: a README-only change is invisible to CI — the FRD's grep/curl acceptance checks are the verification.

### Precedent: Temporary operational tweak + same-day revert
**Commit(s)**: `c64c427` → `18246dd` (both 2026-10-25)
**Blast radius**: `src/config.ts` only, 6 lines each way
**Takeaway**: operational verification here is done without repo changes — the already-proven manual dispatch (run 40165612441, green in 44s) is the external-cron equivalent.

### Composite Lessons
- Doc claims in this repo have a proven stale-within-one-commit track record (`9e1c8ef`→`b050436`; 5→10-minute FRD drift) — the new section must cite `watch.yml`/`watcher.config.json` as sources of truth.
- Heartbeat email noise roughly doubles under dual clocks (`67a9bd2` default-on + discover:99) — the section must pair the `HEARTBEAT_ENABLED` valve with cron-job.org failure notifications.
- Overlap safety already exists and is mandated untouched (`watch.yml:11-13`, discover:39,61,75) — never let the docs suggest removing the native schedule.
- Token hygiene gates are repo-wide greps including README.md — placeholders only, never a `github_pat_`-shaped string.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-10-25_17-39-33_external-cron-workflow-dispatch.md` — FRD this research chains from (dual triggers, PAT, README section)
- `.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md` — cadence decision, no-retrigger guarantee, 60-day auto-disable origin
- `.rpiv/artifacts/research/2026-10-24_14-30-29_threads-hiring-alerts.md` — Actions cron floor/delay and free-tier quota research
- `.rpiv/artifacts/validation/2026-10-25_12-57-04_threads-hiring-alerts.md` — dispatch-path run evidence (44s, 19/19/19 posts)
- `.rpiv/artifacts/validation/2026-10-25_13-24-25_threads-hiring-alerts.md` — authenticated dispatch run (2m16s, state-unchanged log)
- `.rpiv/artifacts/validation/2026-10-25_14-19-21_threads-hiring-alerts.md` — secret-hygiene gates incl. "PAT grep (0)"

## Developer Context
**Q (discover: Scope: workflow-only (README-only in effect)): Keep the change workflow-only?**
A: Workflow only. With native cron kept, the repo diff reduces to the README section alone.

**Q (discover: Run safety settings unchanged): Keep concurrency/timeout as-is?**
A: Keep as-is — exact 10-minute fires serialize safely since runs finish well under 10 minutes.

**Q (discover: Trigger shape: keep native cron as fallback): What happens to the native GitHub cron trigger?**
A: Keep native cron too — dual triggers, `watch.yml:4-7` untouched; redundancy wins.

**Q (discover: Credential: fine-grained PAT): Which credential should cron-job.org hold?**
A: Fine-grained PAT — single repo, Actions read+write; smallest blast radius if cron-job.org leaks it.

**Q (discover: Docs: README setup section): Document the setup in README?**
A: Add setup section, next to the native flow (`README.md:56`) and manual dispatch (`README.md:84`).

**Q (`.git/config:10` + `package.json:2-4`): Hard-code the slug in the paste line or keep `<owner>/<repo>` placeholders?**
A: Hard-code `ukind/loker-watcher` with a one-line fork-substitution note — a placeholder defeats the paste-ready goal.

**Q (cron-job.org parser, CurlParser.js): Which import variant leads the README section?**
A: Crontab-prefixed curl line (only one-paste-complete shape; round-trips cron-job.org's own export format). Bare curl stays as the pre-flight verification command.

**Q (checkpoint): Write the doc now?**
A: Yes — scan accepted with the two decisions above folded in.

## Related Research
- `.rpiv/artifacts/research/2026-10-24_14-30-29_threads-hiring-alerts.md` — Actions scheduling behavior this feature routes around

## Open Questions
- Hosted cron-job.org assumed to behave identically to its GPL frontend source (the import parser is verified in the OSS repo + unit tests, but the hosted deployment is separate) — verify by pasting the line once at setup and checking the success snackbar lists "execution schedule".
- Bare-cURL default schedule (every 15 minutes) is read from the frontend's create-mode state — the hosted default could differ; verify during setup.
- GitHub tolerating a JSON body under a non-JSON Content-Type is only implied by GitHub's own curl examples (no Content-Type); the paste line therefore ships explicit `Content-Type: application/json` rather than testing the edge.
