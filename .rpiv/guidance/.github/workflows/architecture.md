# .github/workflows/ — CI gate + scheduled production run

## Responsibility
Two workflows: `ci.yml` verifies changes (typecheck, lint, test — read-only, no secrets); `watch.yml` runs the pipeline every 10 minutes with secrets, then commits `state/seen-posts.json` back as `github-actions[bot]`. A dispatch-only `probe` job inside watch.yml measures the LLM endpoint.

## Sync points (break these and the workflow silently misbehaves)
- Step `env:` keys ↔ `ENV_NAMES` in `src/config.ts` — 1:1 name mirroring (8 today, incl. the Linked API pair `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN`); `HEARTBEAT_ENABLED` maps via `vars.` (not `secrets.` — the one non-secret knob); unset means enabled
- `jq '.seenPostIds | length'` ↔ `AppState.seenPostIds` in `src/state.ts` — renaming the field would silently read as "0 new"; jq `length` counts KEYS, so it is shape-agnostic across the v2 map (and v1 arrays)
- `node-version: 22` ↔ `engines.node` in package.json
- The `JUDGE_CONCURRENCY` literal ↔ `DEFAULT_JUDGE_CONCURRENCY` in `src/judge.ts` (both 4 today; the literal is a maintenance pointer)
- `fetch-depth: 0` exists ONLY in the watch job because Commit state rebases — a shallow clone cannot find the merge base

## Structure
```
ci.yml      # push(main)+PRs+dispatch | permissions: contents: read | timeout 10
            # checkout@v4 → setup-node@v4 (node 22, npm cache) → npm ci → typecheck → lint → test
watch.yml   # cron */10 + dispatch | permissions: contents: write | concurrency: watch (cancel)
            # job probe: dispatch-only GATE, timeout 10 → npx tsx scripts/probe-judge.ts (LLM_ACCOUNTS only)
            # job watch: timeout 8 (< the 10-min cron) → npm ci (checkout fetch-depth: 0)
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
  cancel-in-progress: true     # the SDK cutover flipped queue to cancel: a parked Linked API workflow can
                               # hold the whole 8-minute cap, and queueing every 10-minute tick behind it
                               # backs the schedule up without bound. Cancel keeps at most one run alive —
                               # which still serializes the state read-modify-write (the in-flight run is
                               # dead, never concurrent)
      # (job-level) timeout-minutes: 8 — a hung run dies BEFORE the next */10 tick (cancel drops a superseded run instead of queueing it)
```
README documents an external cron dispatching watch.yml by filename — a wrong-but-valid filename still answers 204 and starts the WRONG workflow.

## Step-scoped secrets, 1:1 names; the literal goes first with its evidence
```yaml
- name: Run watcher
  env:
    JUDGE_CONCURRENCY: "4"   # probe run <id> reading — paste a fresh measuring run's reading
    HEARTBEAT_ENABLED: ${{ vars.HEARTBEAT_ENABLED }}   # the one non-secret knob: vars., not secrets.; unset = enabled
    THREADS_SESSION_STATE: ${{ secrets.THREADS_SESSION_STATE }}
    LINKED_API_TOKEN: ${{ secrets.LINKED_API_TOKEN }}   # absent/blank ⇒ linkedin surfaces skip with one warn (fetch-linkedin-api.ts); Threads still runs
    LINKED_API_IDENTIFICATION_TOKEN: ${{ secrets.LINKED_API_IDENTIFICATION_TOKEN }}   # ships as a pair with LINKED_API_TOKEN
    LLM_ACCOUNTS: ${{ secrets.LLM_ACCOUNTS }}
    GMAIL_USER: ${{ secrets.GMAIL_USER }}
    GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
  run: npx tsx src/index.ts  # a non-zero exit fails the step → the commit step is skipped
```
Secrets exist only inside this step; the commit-back step runs secret-free. Playwright installs with `--only-shell` — headless-only, the runner image carries the chromium shared libs. The `ms-playwright` cache step (lockfile-hash key) sits ahead of the install, which stays UNCONDITIONAL: a miss self-heals, a hit is a fast no-op.

## Commit-back: bot identity, no-op guard, jq delta, state-only rebase skips, lease push
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
    bash scripts/commit-state-rebase.sh   # the ONLY invocation — rebase, state-only
                                          # conflict skips (bounded), lease push, and the
                                          # single retry all live inside the script
```
The script re-establishes errexit itself and exits 0 on push, 1 on a non-state conflict abort or a second push failure. It is invoked exactly once; the single retry lives inside it. Any conflicted path other than the state file aborts the run loudly.
Accepted cost (F021): a skipped state conflict means the next run re-judges — the audit tolerates one duplicate digest. The commit-back is the only production writer to `state/`.

State history growth (N017): accepted and documented (2026-11-03). Every match run rewrites the ~1.6 MB seen-state file; prune keeps the file bounded to the 72h window, but git history accumulates one near-full-file rewrite per run, so clone size and CI checkout cost grow without bound. The policy is (a) accept and document. Revisit when clone size or checkout time becomes a visible cost: (b) periodic squash of state/ commits via git-filter-repo, or (c) move seen-state out of git (cache/artifact; a redesign).

## The probe job: a gate that walks every account
```yaml
probe:
  if: github.event_name == 'workflow_dispatch'   # never on the cron tick
  # Walks EVERY LLM_ACCOUNTS account (2→4 ramp): an auth-dead key or a failed leg fails this job, so a
  # rotten key reddens the dispatch run instead of passing unseen. 429-refused legs are busy, not dead.
  timeout-minutes: 10
  steps:
    - name: Probe judge latency
      env:
        LLM_ACCOUNTS: ${{ secrets.LLM_ACCOUNTS }}
      run: npx tsx scripts/probe-judge.ts
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
