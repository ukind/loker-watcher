# .github/workflows/ — CI gate + scheduled production run

## Responsibility
Two single-job workflows: `ci.yml` verifies changes (typecheck, lint, tests — read-only, no secrets); `watch.yml` runs the pipeline every 10 minutes with secrets, then commits `state/seen-posts.json` back as `github-actions[bot]`.

## Consumers
- `watch.yml` executes `src/index.ts` and depends on its exit code: a non-zero exit gates the commit step
- A `watch` state commit pushes to main, which triggers `ci` via its push trigger

## Structure
```
ci.yml     # triggers: push(main) + PRs + dispatch | permissions: contents: read
           # steps: checkout → node 22 + cache → npm ci → typecheck → lint → test
watch.yml  # triggers: cron */10 + dispatch | permissions: contents: write | concurrency: watch (queue) | timeout: 10m
           # steps: checkout → node 22 + cache → npm ci → playwright install chromium → run watcher (step-scoped secrets) → commit state
```

## Sync points (break these and the workflow silently misbehaves)
- Step `env:` keys ↔ `ENV_NAMES` in `src/config.ts` (1:1 name mirroring)
- Commit-back jq reads `.seenPostIds` ↔ `AppState.seenPostIds` in `src/state.ts`
- `node-version: 22` ↔ `engines.node` in `package.json`
- `HEARTBEAT_ENABLED` is deliberately NOT injected (developer-confirmed): unset defaults to enabled, so zero-match runs email a status digest; the kill switch works only where the variable is set to `false`

## Cron + manual dispatch (UTC, default branch only, 60-day auto-disable)
```yaml
on:
  schedule:
    - cron: "*/10 * * * *"   # UTC only; silently dropped after 60 days without repo activity
  workflow_dispatch: {}      # the "Run workflow" button — the only way to test without waiting
```

## Least privilege + queue concurrency (never cancel)
```yaml
permissions:
  contents: write            # watch needs this only for the commit-back; ci uses contents: read
concurrency:
  group: watch
  cancel-in-progress: false  # queue, don't kill: the state read-modify-write must serialize
```

## Secret-to-env injection is step-scoped with 1:1 names
```yaml
- name: Run watcher
  env:                       # step-scoped: the secret values exist only inside this process
    LLM_API_KEY: ${{ secrets.LLM_API_KEY }}            # env key == secret name == ENV_NAMES entry
    GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
  run: npx tsx src/index.ts  # a non-zero exit fails the step → the commit step is skipped
```

## State commit-back (bot identity, no-op guard, jq delta)
```yaml
- name: Commit state
  run: |
    git config user.name "github-actions[bot]"      # bot identity — never a human
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add state/seen-posts.json                   # ONLY the state file — never sweep up other changes
    if git diff --cached --quiet; then echo "state unchanged"; exit 0; fi   # most runs are no-ops
    PREV=$(git show HEAD:state/seen-posts.json | jq '.seenPostIds | length' 2>/dev/null || echo 0)
    CURR=$(jq '.seenPostIds | length' state/seen-posts.json)
    git commit -m "state: $((CURR - PREV)) new seen post ids"   # greppable history of the state file
    git push
# no [object Object] interpolation inside run: blocks — no injection surface
```

## Architectural Boundaries
- **No build step**: TS runs via tsx (`npx tsx src/index.ts`); `tsc --noEmit` is typecheck-only
- **`npm ci`, never `npm install`**: lockfile-exact installs
- **Only official actions/* at major tags** (`@v4`); no third-party actions
- **`timeout-minutes` below the cron interval** (10): a hung run dies before the next tick queues

<important if="you are adding a new scheduled job">
## Adding a New Scheduled Job
1. Clone the `watch.yml` skeleton: trigger → permissions → concurrency → job (timeout + setup prologue) → steps
2. Crons run from the default branch only; pair with `workflow_dispatch` for manual verification
3. Default to `contents: read`; bump to `write` only if the job commits back
4. Shared state or a rate-limited API ⇒ add a `concurrency` group with a unique hardcoded name, `cancel-in-progress: false`
5. Set `timeout-minutes` strictly below the cron interval
6. Verify with a manual dispatch before trusting the cron
</important if>

<important if="you are adding a secret or environment variable">
## Adding a Secret or Env Var
1. Add the name to `ENV_NAMES` in `src/config.ts` — the single source of truth
2. Write or extend a `resolve<Service>Config(env = process.env)` resolver — see `.rpiv/guidance/src/architecture.md`
3. GitHub: Settings → Secrets and variables → Actions, exact-case name
4. Map it in the step-scoped `env:` block of `watch.yml`, keeping the 1:1 `NAME: ${{ secrets.NAME }}` mirroring
5. Never interpolate secrets into `run:` scripts via `${{ }}`
</important if>