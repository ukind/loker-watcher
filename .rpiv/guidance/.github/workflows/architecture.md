# .github/workflows/ — CI gate + scheduled production run

## Responsibility
Two workflows: `ci.yml` verifies changes (typecheck, lint, test — read-only, no secrets); `watch.yml` runs the pipeline every 10 minutes with secrets, then commits `state/seen-posts.json` back as `github-actions[bot]`. A dispatch-only `probe` job inside watch.yml measures the LLM endpoint and commits `state/judge-ceilings.json`.

## Sync points (break these and the workflow silently misbehaves)
- Step `env:` keys ↔ `ENV_NAMES` in `src/config.ts` — watch.yml maps 5 of the 8 ENV_NAMES (`HEARTBEAT_ENABLED` via `vars.` — the one non-secret knob); the LinkedIn trio (`LINKEDIN_COOKIES_FILE`, `LINKEDIN_TRANSPORT`, `CURL_IMPERSONATE_BIN`) is deliberately NOT mapped — PC-only, never enters Actions; unset means enabled
- `jq '.seenPostIds | length'` ↔ `AppState.seenPostIds` in `src/state.ts` — renaming the field would silently read as "0 new"; jq `length` counts KEYS, so it is shape-agnostic across the v2 map (and v1 arrays)
- `node-version: 22` ↔ `engines.node` in package.json
- `state/judge-ceilings.json` keys ↔ the pool's trimmed `baseUrl`s (`resolveCeilings` trims both sides; twin accounts sharing one baseUrl share one reading)
- `fetch-depth: 0` sits in BOTH commit-back jobs (Commit state, Commit ceilings) — a shallow clone cannot find the merge base and add/add-conflicts the whole tree

## Structure
```
ci.yml      # push(main)+PRs+dispatch | permissions: contents: read | timeout 10
            # checkout@v4 → setup-node@v4 (node 22, npm cache) → npm ci → typecheck → lint → test
watch.yml   # cron */10 + dispatch | permissions: contents: write | concurrency: watch (cancel)
            # job probe: dispatch-only GATE, timeout 10 → npx tsx scripts/probe-judge.ts (LLM_ACCOUNTS only)
            #   → Commit ceilings (state/judge-ceilings.json via scripts/commit-state-rebase.sh; checkout fetch-depth: 0)
            # job watch: needs probe (serialization) — schedule ticks skip the probe and
            #   watch's if keeps them alive on the committed ceilings; timeout 8 (< the 10-min cron)
            #   → npm ci (checkout fetch-depth: 0)
            #   → ms-playwright cache (lockfile hash) → playwright install --only-shell chromium
            #   → Run watcher (step-scoped secrets) → Commit state (script invocation)
```

## One lane per pipeline; the timeout dies before the next tick
```yaml
on:
  schedule:
    - cron: "*/10 * * * *"     # UTC; every duration below is sized against this interval
  workflow_dispatch: {}        # the only way to test without waiting for the cron
permissions:
  contents: write              # ci.yml gets contents: read — the gate never writes
concurrency:
  group: watch
  cancel-in-progress: true     # a run parked on judge cooldowns can hold the whole 8-minute cap, and
                               # queueing every 10-minute tick behind it backs the schedule up without
                               # bound. Cancel keeps at most one run alive — which still serializes the
                               # state read-modify-write (the in-flight run is dead, never concurrent).
                               # The PC loop writes state/linkedin-posts.json via its own rebase+retry
                               # push — never this workflow.
      # (job-level) timeout-minutes: 8 — a hung run dies BEFORE the next */10 tick (cancel drops a superseded run instead of queueing it)
```
README documents an external cron dispatching watch.yml by filename — a wrong-but-valid filename still answers 204 and starts the WRONG workflow.

## Step-scoped secrets, 1:1 names; the literal goes first with its evidence
```yaml
- name: Run watcher
  env:
    HEARTBEAT_ENABLED: ${{ vars.HEARTBEAT_ENABLED }}   # the one non-secret knob: vars., not secrets.; unset = enabled
    THREADS_SESSION_STATE: ${{ secrets.THREADS_SESSION_STATE }}
    # no LinkedIn secret: the PC loop pushes state/linkedin-posts.json and
    # this job reads it from the checkout — an absent/stale payload
    # degrades to a threads-only run (src/linkedin-payload.ts, D13)
    LLM_ACCOUNTS: ${{ secrets.LLM_ACCOUNTS }}
    GMAIL_USER: ${{ secrets.GMAIL_USER }}
    GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
  run: npx tsx src/index.ts  # a non-zero exit fails the step → the commit step is skipped
```
Secrets exist only inside this step; the commit-back step runs secret-free. Playwright installs with `--only-shell` — headless-only, the runner image carries the chromium shared libs. The `ms-playwright` cache step (lockfile-hash key) sits ahead of the install, which stays UNCONDITIONAL: a miss self-heals, a hit is a fast no-op.

## Commit-back: two invokers (Commit state, Commit ceilings); bot identity, no-op guard, deltas, state-set rebase skips, lease push
```yaml
- name: Commit state
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add state/seen-posts.json                                  # ONLY the state file
    if git diff --cached --quiet; then echo "state unchanged; nothing to commit"; exit 0; fi
    PREV=$(git show HEAD:state/seen-posts.json | jq '.seenPostIds | length' 2>/dev/null || echo 0)
    CURR=$(jq '.seenPostIds | length' state/seen-posts.json)
    git commit -m "state: $((CURR - PREV)) new seen post ids"      # greppable delta history
    bash scripts/commit-state-rebase.sh   # one of the TWO invocations — rebase, committed-state
                                          # conflict skips (bounded), lease push, and the single
                                          # retry all live inside the script
```

```yaml
- name: Commit ceilings
  # The F021 head shape from Commit state, minus the jq delta (the ceilings write is whole-file);
  # the [-f] guard covers a probe that died before its write (the probe step already failed the job).
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    if [ -f state/judge-ceilings.json ]; then
      git add state/judge-ceilings.json
    fi
    if git diff --cached --quiet; then
      echo "ceilings unchanged; nothing to commit"
      exit 0
    fi
    git commit -m "judge: probe-measured ceilings"
    bash scripts/commit-state-rebase.sh   # second invocation — same body, no jq delta
```
A red gate skips this step (fail-fast): the ceilings file lands only from a green probe run.

The script re-establishes errexit itself and exits 0 on push, 1 on a conflict outside the committed state set (`state/seen-posts.json`, `state/judge-ceilings.json`) or a second push failure. Each invoker calls it once; the single retry lives inside it. Any conflicted path outside that set aborts the run loudly.
Accepted cost (F021): a skipped state conflict means the next run re-judges — or the next green probe overwrites the ceilings; the audit tolerates one duplicate digest or one stale-ceiling stretch. The commit-back steps are the only production writers to `state/`, one file each: the watch job owns `state/seen-posts.json`, the probe job owns `state/judge-ceilings.json`.

State history growth (N017): accepted and documented (2026-11-03). Every match run rewrites the ~1.6 MB seen-state file; prune keeps the file bounded to the 72h window, but git history accumulates one near-full-file rewrite per run, so clone size and CI checkout cost grow without bound. The policy is (a) accept and document. Revisit when clone size or checkout time becomes a visible cost: (b) periodic squash of state/ commits via git-filter-repo, or (c) move seen-state out of git (cache/artifact; a redesign).

## The probe job: a gate that walks every account
```yaml
probe:
  if: github.event_name == 'workflow_dispatch'   # never on the cron tick
  # Walks EVERY LLM_ACCOUNTS account (doubling ramp 2→32): an auth-dead key or a failed leg fails this job, so a
  # rotten key reddens the dispatch run instead of passing unseen. 429-refused legs are busy, not dead —
  # throttling is data; the watch job is the real gate for it. The measured ceilings commit to
  # state/judge-ceilings.json (live-only, BEFORE the dead gate) and Commit ceilings pushes them — the
  # watch job's spread consumes that file. A red gate skips the commit (fail-fast): the file lands
  # only from a green probe run.
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0   # Commit ceilings rebases — the same merge-base rule as Commit state
    - name: Probe judge latency
      env:
        LLM_ACCOUNTS: ${{ secrets.LLM_ACCOUNTS }}
      run: npx tsx scripts/probe-judge.ts
    - name: Commit ceilings
      # The F021 head shape from Commit state, minus the jq delta (the ceilings write is whole-file);
      # the [-f] guard covers a probe that died before its write.
      run: |
        git config user.name "github-actions[bot]"
        git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
        if [ -f state/judge-ceilings.json ]; then
          git add state/judge-ceilings.json
        fi
        if git diff --cached --quiet; then
          echo "ceilings unchanged; nothing to commit"
          exit 0
        fi
        git commit -m "judge: probe-measured ceilings"
        bash scripts/commit-state-rebase.sh   # second invocation — same body, no jq delta
```

## Architectural Boundaries
- **No build step**: TS runs via tsx; `tsc --noEmit` is typecheck-only
- **`npm ci`, never `npm install`**; only official `actions/*` at major tags (`@v4`)
- **Measured-evidence comments** (run ids, dates, timings) defend every non-obvious constant — update them when the value changes

<important if="you are adding a secret or environment variable">
## Adding a Secret or Env Var
1. Add the name to `ENV_NAMES` in `src/config.ts` — the single source of truth
2. Write or extend a resolver with one of the three contracts — see `.rpiv/guidance/src/architecture.md`
3. GitHub: Settings → Secrets and variables → Actions, exact-case name (non-secret knobs go to repo variables)
4. Map it in the step-scoped `env:` of the exact step that needs it, keeping the 1:1 `NAME: \${{ secrets.NAME }}` mirroring; literals go first, quoted, with an evidence comment
5. Optional toggle with a resolver default? Map it anyway (cf. `HEARTBEAT_ENABLED` via `vars.`) — an unmapped knob is a no-op in the only production runtime
6. Never interpolate secret values into `run:` scripts via \${{ }}
7. Verify with a manual dispatch; a missing secret surfaces as the resolver's named error
</important if>

<important if="you are adding a new scheduled job">
## Adding a New Scheduled Job
1. Clone the watch.yml skeleton: triggers → permissions → concurrency → job (timeout + setup prologue) → steps
2. Pick the cron interval first — everything else is sized against it; always pair with `workflow_dispatch`
3. Permissions: `contents: read` by default; `write` only if the job commits back (a watch.yml clone needs write)
4. Shared state or a rate-limited API ⇒ a `concurrency` group with a unique hardcoded name, `cancel-in-progress: false`
5. `timeout-minutes` strictly below the cron interval, with the envelope-arithmetic comment
6. Setup prologue: checkout → setup-node (22, npm cache) → `npm ci`; add `fetch-depth: 0` only when a later step rebases or pushes; add `playwright install --only-shell chromium` (lockfile-hash cache ahead of it) only if a browser is driven
7. Pushing state? Keep the YAML head (bot identity, state-file-only add, no-op guard, jq delta commit) and invoke `scripts/commit-state-rebase.sh` exactly once — the single retry lives inside the script; keep the jq path in sync with `AppState`
8. Verify with a manual dispatch before trusting the cron
</important if>
