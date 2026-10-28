# .github/workflows/ — CI gate + scheduled production run

## Responsibility
Two workflows: `ci.yml` verifies changes (typecheck, lint, test — read-only, no secrets); `watch.yml` runs the pipeline every 10 minutes with secrets, then commits `state/seen-posts.json` back as `github-actions[bot]`. A dispatch-only `probe` job inside watch.yml measures the LLM endpoint.

## Sync points (break these and the workflow silently misbehaves)
- Step `env:` keys ↔ `ENV_NAMES` in `src/config.ts` — 1:1 name mirroring; `HEARTBEAT_ENABLED` is deliberately NOT mapped (unset means enabled)
- `jq '.seenPostIds | length'` ↔ `AppState.seenPostIds` in `src/state.ts` — renaming the field would silently read as "0 new" (v2 is a map; jq length counts keys)
- `node-version: 22` ↔ `engines.node` in package.json
- The `JUDGE_CONCURRENCY` literal ↔ `DEFAULT_JUDGE_CONCURRENCY` in `src/judge.ts` (both 4 today; the literal is a maintenance pointer)

## Structure
```
ci.yml      # push(main)+PRs+dispatch | permissions: contents: read | timeout 10
            # checkout@v4 → setup-node@v4 (node 22, npm cache) → npm ci → typecheck → lint → test
watch.yml   # cron */10 + dispatch | permissions: contents: write | concurrency: watch (queue)
            # job probe: dispatch-only, continue-on-error, timeout 10 → npx tsx scripts/probe-judge.ts (LLM_ACCOUNTS only)
            # job watch: timeout 8 (< the 10-min cron) → npm ci → playwright install --only-shell chromium
            #            → Run watcher (step-scoped secrets) → Commit state (bot identity, no-op guard, jq delta)
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
  cancel-in-progress: false    # QUEUE, never kill: the state read-modify-write must serialize
    # (job-level) timeout-minutes: 8 — a hung run dies BEFORE the next */10 tick queues
```

## Step-scoped secrets, 1:1 names; the literal goes first with its evidence
```yaml
- name: Run watcher
  env:
    JUDGE_CONCURRENCY: "4"   # probe run 40455686221 reading — paste a fresh measuring run's reading
    THREADS_SESSION_STATE: ${{ secrets.THREADS_SESSION_STATE }}   # YAML key == secret name == ENV_NAMES value
    LLM_ACCOUNTS: ${{ secrets.LLM_ACCOUNTS }}
    GMAIL_USER: ${{ secrets.GMAIL_USER }}
    GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
  run: npx tsx src/index.ts  # a non-zero exit fails the step → the commit step is skipped
```
Secrets exist only inside this step; the commit-back step runs secret-free. Playwright is installed with `--only-shell` — the pipeline is headless-only and the runner image already carries the chromium shared libs.

## Commit-back: bot identity, no-op guard, jq delta
```yaml
- name: Commit state
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add state/seen-posts.json                                  # ONLY the state file
    if git diff --cached --quiet; then echo "state unchanged"; exit 0; fi   # most runs are no-ops
    PREV=$(git show HEAD:state/seen-posts.json | jq '.seenPostIds | length' 2>/dev/null || echo 0)
    CURR=$(jq '.seenPostIds | length' state/seen-posts.json)
    git commit -m "state: $((CURR - PREV)) new seen post ids"      # greppable delta history
    git push
```

## The probe job: measurement is data, never a gate
```yaml
probe:
  if: github.event_name == 'workflow_dispatch'   # never on the cron tick
  # A refused measurement is data: the probe reads only accounts[0], so a daily cap
  # on the primary account must not redden the run while watch is green.
  continue-on-error: true
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
3. GitHub: Settings → Secrets and variables → Actions, exact-case name
4. Map it in the step-scoped `env:` of the exact step that needs it (the probe needs only what probe-judge.ts reads), keeping the 1:1 `NAME: \${{ secrets.NAME }}` mirroring; literals go first, quoted, with an evidence comment
5. Optional toggle with a resolver default? Leaving it unmapped is the established pattern (cf. `HEARTBEAT_ENABLED`), not an oversight
6. Never interpolate secret values into `run:` scripts via \${{ }}
7. Verify with a manual dispatch; a missing secret surfaces as the resolver's named error
</important if>

<important if="you are adding a new scheduled job">
## Adding a New Scheduled Job
1. Clone the watch.yml skeleton: triggers → permissions → concurrency → job (timeout + setup prologue) → steps
2. Pick the cron interval first — everything else is sized against it; always pair with `workflow_dispatch`
3. Default to `contents: read`; bump to `write` only if the job commits back
4. Shared state or a rate-limited API ⇒ a `concurrency` group with a unique hardcoded name, `cancel-in-progress: false`
5. `timeout-minutes` strictly below the cron interval, with a measured-evidence comment
6. Setup prologue: checkout → setup-node (22, npm cache) → `npm ci`; add `playwright install --only-shell chromium` only if a browser is driven
7. Pushing state? Replicate the commit-back block exactly and keep the jq path in sync with `AppState`
8. Verify with a manual dispatch before trusting the cron
</important if>
