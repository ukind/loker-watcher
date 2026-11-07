# loker-watcher

Threads + LinkedIn #hiring Indonesia job alerts. A GitHub Actions workflow
loads the Threads surfaces listed in `watcher.config.json` every 10 minutes,
has an LLM judge posts against the configured keywords (Indonesia or remote
roles), and emails new matches as a plain-text digest. LinkedIn posts ride a
separate always-on loop on the developer's PC: it fetches the voyager search
API and pushes `state/linkedin-posts.json`, which the hosted run reads. No
web UI; persistence is three committed state files — `state/seen-posts.json`
(seen ids), `state/judge-ceilings.json` (the judge's per-account ceilings),
and `state/judge-health.json` (per-account provider health: hard-failure
streaks and the outage-episode bit).

## Pipeline

1. Playwright loads every Threads surface listed in `watcher.config.json` —
   tag pages, profile pages and search URLs. With `THREADS_SESSION_STATE`
   set it signs in, clicks the **Recent** tab where one exists, and reads
   posts from the `graphql` XHR responses; otherwise it loads each surface
   logged out and reads posts from the embedded `data-sjs` JSON blobs.
2. LinkedIn surfaces ride the PC fetch leg: an always-on loop on the
   developer's PC runs the voyager search for each linkedin surface
   (`sortBy: date_posted`, past 24 hours, 50-post pages), writes
   `state/linkedin-posts.json`, and pushes that single file to `main`. The
   hosted run reads the payload from its checkout; an absent or stale
   payload (PC off) degrades to a threads-only run with one log line.
3. Posts are deduplicated across surfaces and platforms.
4. Posts older than `recencyHours` are dropped.
5. Posts already in `state/seen-posts.json` are dropped.
6. Every surviving post goes to the LLM judge in ~10-post bulk calls. The
   `keywords` list is sent as the relevance criterion; a post the bulk
   response misses falls back to a single-post call. A batch the endpoint
   does not answer is deferred whole — those posts stay unseen and retry
   on the next run. Accounts come from the `LLM_ACCOUNTS` pool: an HTTP 429
   cools that account for 60 seconds and dispatches re-scan past cooling
   accounts; when every account is cooling, calls park up to a shared
   3-minute wait budget, then an exhausted pool sends one alarm email and
   fails the run. Dispatches spread across the pool: each call starts at
   the next account, every account is capped at its probe-measured
   in-flight ceiling, and as many batches run at once as the ceilings add
   up to (`state/judge-ceilings.json`; an account without a reading is
   capped at 1 until the next probe run).

   An account that hard-fails (HTTP 5xx after backoff, 401/403, or a
   network error — never a 429) on two consecutive runs is capped at one
   request per run: the next run's single dispatch is a half-open probe,
   and a success restores its full ceiling for the rest of that run. The
   marks live in `state/judge-health.json` and self-heal — a stale mark
   costs at most the one-request probe until the first success clears it.
   While any account is capped, the digest and the zero-match status email
   each carry one `Degraded LLM account(s):` line, and an exhausted pool's
   alarm names each account's real cause (`HTTP 503`, `HTTP 401 — key
   dead`, `network error: …`) instead of a blanket 429. One alarm per
   outage: the episode bit rides the health file, so a second all-dead run
   stays quiet in the log and still fails the run.
7. Each candidate gets a `{relevant, locationOk}` verdict. A judgment that
   fails is skipped — the post stays unseen and retries on the next run.
8. New relevant + located posts are emailed as the job digest; LinkedIn
   item lines carry a `[linkedin]` marker and the subject appends
   `+ LinkedIn` when at least one LinkedIn post matched.
9. On match runs the state file is committed back as `github-actions[bot]`.
10. **Zero-match runs email a status digest instead** — the scan funnel plus
    the closest candidate posts with their permalinks — so a quiet run is
    still legible. Set `HEARTBEAT_ENABLED=false` to turn it off.

## Requirements

- **Public GitHub repository.** Scheduled workflows on public repos run free
  and unlimited; a private repo at this cadence would burn roughly 11,000
  paid minutes per month.
- A Gmail account with an
  [app password](https://myaccount.google.com/apppasswords) (2FA required).
- One or more OpenAI-compatible chat endpoints, configured as the `LLM_ACCOUNTS`
  pool (see Setup). On an HTTP 429 the answering account cools for 60 seconds;
  the judge re-scans past cooling accounts and parks when all are.

## Setup

1. Push this repo as **public**.
2. Add the secrets under **Settings → Secrets and variables → Actions**:

   | Name | Example value | Purpose |
   |---|---|---|
   | `LLM_ACCOUNTS` | `[{"baseUrl":"https://api.openai.com/v1","apiKey":"your-key","model":"gpt-4o-mini"}]` | Judge accounts as a JSON array; a 429-cooled account sits out 60 seconds, and an exhausted pool (all accounts cooling past the wait budget) emails an alarm and fails the run |
   | `GMAIL_USER` | `you@gmail.com` | Sender and recipient |
   | `GMAIL_APP_PASSWORD` | your-app-password | Gmail SMTP credentials |
   | `THREADS_SESSION_STATE` | base64 storageState | Threads login session (see below) |

   The LinkedIn leg needs no GitHub secret — its cookies live only on the
   PC (see **The LinkedIn leg on your PC**).

   Optional variable (not a secret): `HEARTBEAT_ENABLED` — set to `false` to
   stop the zero-match status email, default `true`. Surfaces, keywords,
   candidate terms and the recency window are all configured in
   `watcher.config.json` (see below).

   Judge widths need no tuning: trigger **Actions → watch → Run workflow**
   once and the dispatch-only probe job measures every `LLM_ACCOUNTS`
   account (a per-account `ceiling=N` summary line; the ramp doubles
   concurrent calls 2→32 per account and stops when the endpoint refuses;
   a dead account — failed leg, HTTP 401/403, or a broken ramp — fails the
   probe job), writes `state/judge-ceilings.json`, and commits it. On a
   dispatch run the watch job waits for the green probe and starts on
   those fresh ceilings; scheduled 10-minute runs skip the probe and read
   the committed file. Nothing to paste: watch spreads dispatches under
   those caps. A green gate commits; a red gate skips the commit and the
   dispatch's watch, so the file keeps its last green reading.

   Provider health needs no setup: the watch run writes
   `state/judge-health.json` (on the success path and, best-effort, from
   the failed run's own commit-back step) and the workflow commits it
   back. The file is absent from every checkout until the first live run
   creates it; a missing or malformed file reads as "everything healthy"
   and never fails a run.
   Rolling the code back past v2 requires reverting
   `state/seen-posts.json` in the same commit — v1 code fails visibly with
   `unsupported schema version: 2`.
3. Commit `package-lock.json` (generated by the first `npm install`) — the
   workflow's `npm ci` step requires it.
4. Enable Actions on the repo. The native schedule (`*/10 * * * *`) then
   runs best-effort. For a clock you control, see External cron below.

## Configure what to watch

Everything the watcher samples and how it filters lives in
[`watcher.config.json`](./watcher.config.json). Edit that file, commit, push —
no code change and no Actions variable is involved.

| Key | What it does |
|---|---|
| `surfaces` | What to sample. Each entry is `{ "type": "tag", "value": "hiring" }`, `{ "type": "url", "value": "https://www.threads.com/@someone" }`, or `{ "type": "linkedin", "value": "#hiring ..." }`. Tags build `threads.com/tag/<value>`; URLs are used verbatim and must be `https://www.threads.com/...`; linkedin entries feed a keywords string to the PC leg's voyager search (newest first, past 24 hours) — they need no GitHub secret. |
| `keywords` | The LLM judge's relevance criterion. A post matches only when it is a genuine job opening related to at least one of these. |
| `candidateTerms` | The wider net that picks the "closest candidates" listed in the zero-match status email. |
| `recencyHours` | How far back a post can be and still count. Required — a missing or non-positive value fails the run. |
| `reasoningEffort` | The LLM judge's reasoning effort level: `"low"`, `"medium"` (default), or `"high"`. Absent defaults to `"medium"`. |
| `scrollRounds` | Upper bound on scroll rounds per Threads surface walk. Must be a whole number >= 1; absent defaults to `8`. |

Adding a profile or a search URL is the same edit as adding a tag:

```json
{ "type": "url", "value": "https://www.threads.com/search?q=frontend&serp_type=deeplink&filter=recent" }
```

A LinkedIn search is the same kind of edit — a keywords string the PC fetch
leg's voyager search runs, not a URL:

```json
{ "type": "linkedin", "value": "#hiring frontend developer indonesia" }
```

A missing file, a typo in a key, an unknown surface `type`, or a
non-threads.com URL stops the run with an error that names the problem — the
watcher never silently falls back to a built-in list.

## Smoke run

Trigger **Actions → watch → Run workflow** (workflow_dispatch). Expected:

- Run logs show per-surface post counts (`extract: tag/hiring: N post(s)`).
- A match run emails the digest and pushes a `state: N new seen post ids`
  commit as `github-actions[bot]`.
- An immediate re-run logs `no new matches` and sends the status digest.
- A zero-match run emails a status digest with the funnel counts and up to 10
  candidate permalinks. That is one email per run, whatever fires it; set
  `HEARTBEAT_ENABLED=false` if that is too many.

If the run gets no posts from Actions runner IPs, Threads is blocking
datacenter traffic — escalate browser hardening (design decision D2) before
trying other fixes.

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
  (`watch.yml:11-13`), so overlapping triggers cancel the older run instead of racing it.
  Two clocks also double the zero-match status emails; set
  `HEARTBEAT_ENABLED=false` (see Setup) if that is too many, and turn on
  cron-job.org's failure notifications so a broken trigger still alerts
  you.

## Refresh the Threads session

The watcher signs in with a browser session exported from a real login —
no password is stored anywhere. The session is account-equivalent: treat it
like a password, keep it in the secret only, and never commit it.

1. Log in to threads.com in a regular Firefox session.
2. Export the cookies for `.threads.com` as a Playwright storageState
   document (`{ "cookies": [...], "origins": [] }`). A cookie-export
   extension or `pire-browser cookies --json` against the logged-in tab
   both work; keep `sessionid`, `ds_user_id`, `csrftoken`, `mid`, `ig_did`.
   **The raw export is not a storageState document — convert it first.**
   Playwright rejects the pire-browser cookie objects outright:
   `browser.newContext: storageState.cookies[0].sameSite: expected one of
   (Strict|Lax|None)`, because the export uses `unspecified` and
   `no_restriction`. Map every `sameSite` (`unspecified`/`lax` → `Lax`,
   `strict` → `Strict`, `no_restriction` → `None`), wrap the array as
   `{ "cookies": [...], "origins": [] }`, then base64-encode the result.
3. Base64-encode the file and set the secret:

   ```bash
   gh secret set THREADS_SESSION_STATE < storage-state.json.b64
   ```

The session lasts roughly a year (`sessionid` expiry). When runs start
logging the logged-out fallback warning or post counts drop back to ~19 per
tag, repeat the export. With the secret unset or invalid the watcher falls
back to the logged-out fetch and still runs.

## The LinkedIn leg on your PC (voyager)

LinkedIn posts come from the voyager search API, fetched on the developer's
PC by an always-on npm loop — not from GitHub Actions. The endpoint, headers
and encodings follow the reverse-engineering spec of record
(`linkedin-reverse/DOCUMENTATION.md`); when the server expires the queryId
hash, re-derive it per that spec's §9 — a sudden 500 on a formerly-200
endpoint is the signature, not a variables bug.

The loop never touches Threads, the judge, the digest or seen-state. It
only fetches the linkedin surfaces, writes `state/linkedin-posts.json`
atomically, and pushes that single path with the same rebase+retry
discipline the bot uses. Each file has exactly one writer, so the two
pushes can never lose each other's commits. Run the loop from a dedicated
clone of `main` — its `git pull --rebase` also auto-updates the loop's own
code. One-time: set the clone's identity (`git config user.name` /
`git config user.email`) — the push discipline commits as you, and an
unconfigured identity fails the tick loudly instead of pushing nothing.

1. `npm run login-linkedin` — opens a real Chrome window; log in by hand
   (2FA included). The helper waits for the session, writes the cookie
   file, and adds the LINKEDIN_COOKIES_FILE line to .env automatically.
   Re-run it when the session dies — the browser profile persists, so a
   still-signed-in jar is harvested without a new login; the loop's next
   tick heals, no restart. Manual fallback (devtools export into
   `{ "liAt": "...", "jsessionid": "ajax:..." }`) still works: point
   LINKEDIN_COOKIES_FILE at the file in .env or the shell.
   No headless re-login exists (2FA dead-ends automated login); the
   headed helper keeps the operator in the loop. A dead session sends
   ONE alarm email per episode and the loop keeps running — refresh the
   file, the next tick heals.
2. `npm run setup-curl` — downloads the checksum-pinned curl-impersonate
   binary (lexiforest release v2.3.2, release-published sha256 digests),
   extracts it into gitignored `tools/curl-impersonate/`, and writes the
   CURL_IMPERSONATE_BIN line to .env. Manual fallback (replaces the old
   install paragraph): install the binary by hand and point
   CURL_IMPERSONATE_BIN at it. If you skip the binary, put
   `LINKEDIN_TRANSPORT=playwright` in .env instead — that switches after
   a failed probe; no auto-fallback in code.
3. `npm run probe-linkedin` — twice, ≥6h apart, stored cookies only; exit 1
   on leg-dead/short/fault. Re-run after any `LINKEDIN_TRANSPORT` change.
4. `npm run watch-linkedin` — tick every 10 min, leave the console open.

Env setup note: the PC scripts read `.env` beside the clone root
(`LINKEDIN_COOKIES_FILE` written by `login-linkedin`,
`CURL_IMPERSONATE_BIN` written by `setup-curl`); a variable already set
in the shell always wins and `.env` fills only unset keys, so the setup
commands' lines work without any shell profile edit.

Troubleshooting: `git: rebase failed` / `git: payload push failed twice` —
the tick ran from a non-dedicated or dirty checkout; the preflight (branch
`main` + clean tree, checked BEFORE any fetch) names the branch or the
dirty paths. Run from a dedicated clean clone of `main`, and re-run
`npm run login-linkedin` + `npm run setup-curl` inside the clone — both
write `<cwd>/.env`, so each clone carries its own line.

Hosted side: the */10 cron reads the payload from its checkout, merges,
judges, emails as usual; the heartbeat/digest render one `LinkedIn leg:`
line (`ok` / `DARK — payload N h old` / `absent` / `malformed`) so a dark
leg stays visible while the PC is off. One-off ticks (`npm run
fetch-linkedin`) exit 1 on a dead leg.

## Local run

```bash
npm install
npx playwright install chromium
export LLM_ACCOUNTS='[{"baseUrl":"https://api.openai.com/v1","apiKey":"your-key","model":"gpt-4o-mini"}]'
export GMAIL_USER=... GMAIL_APP_PASSWORD=...
npm start
```

The five LinkedIn leg entries (PC only — no LLM_* or GMAIL_* needed for
them, and the cookie file must exist):

```bash
npm run login-linkedin   # headed login: writes the cookie file + the .env line
npm run setup-curl       # one-time: fetch the curl-impersonate binary + the .env line
npm run probe-linkedin   # transport gate: exit 1 on a dead/short/faulted leg
npm run fetch-linkedin   # one tick: fetch → payload → push
npm run watch-linkedin   # the always-on loop: tick + 10-minute sleep
```

## Maintenance

- Public repos auto-disable scheduled workflows after 60 days without repo
  activity. State commit-backs usually keep it alive; after a long quiet
  stretch, run a manual dispatch. The external cron (above) helps here too:
  its runs commit state on matches, and those commits are the repo activity
  GitHub counts.
- Rollback for a bad run: `git revert` the state commit. State writes are
  atomic, so a crashed run cannot leave a partial file.
