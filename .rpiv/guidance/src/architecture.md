# src/ — the watcher pipeline

## Responsibility
The entire application: a single-shot CLI pipeline that fetches Threads posts, filters them, judges candidates in bulk against the configured keywords through an OpenAI-compatible LLM, emails matches, and persists judged post ids. One exported unit seam — `runWatcher(deps)` — no server, no daemon.

## Dependencies and consumers
- **playwright**: quarantined behind the single dynamic-import site, `chromiumContextFactory` in fetch-threads.ts
- **nodemailer**: quarantined to the single creation site in email.ts; heartbeat and the exhaustion alarm ride its `sendText`
- **raw `fetch` + `AbortSignal.timeout`**: the LLM client — no SDK
- **Consumers**: watch.yml runs `npx tsx src/index.ts` on the cron then commits state back; tests/ drive the seams offline; scripts/probe-judge.ts imports buildBulkMessages and resolveJudgeConfig

## Module Structure (role groups; imports point downward only)
```
index.ts                                  # ENTRY: runWatcher(deps) / WatcherDeps / timeStage; guarded CLI bootstrap
types.ts, config.ts, config-file.ts       # LEAVES + FILE CONFIG: shared contracts, ENV_NAMES, paths | watcher.config.json validation
threads-session.ts, fetch-threads.ts,     # ACQUISITION: session secret → temp storageState (null ⇒ logged-out);
extract.ts                                #   logged-out data-sjs walk + authenticated graphql-XHR walk; parse → Post[]
recency.ts                                # FUNNEL: recency window filter (pure)
judge.ts, judge-rotation.ts,              # FUNNEL: bulk judge + dispatcher | rotation primitives,
judge-parse.ts, pool.ts                   #   verdict parsers | bounded shared runPool
email.ts, heartbeat.ts, state.ts          # NOTIFY + PERSIST: digest/alarm/heartbeat via sendText | v2 state, atomic save
```

## Funnel gates fix the ordering (the correctness invariant)
```typescript
// src/index.ts runWatcher — the ORDER is the argument:
if (newPosts.length === 0) {                    // Gate 1: nothing unseen — heartbeat, return
  await heartbeat(stats);                       // best-effort: warn, never throw
  return { judged: 0, matches: 0, skipped: 0, saved: false };   // NO disk write
}
// ...judge...
if (matches.length === 0) {                     // Gate 2: judged, zero matches — heartbeat, THEN persist
  await heartbeat(stats);
  await persistJudged(state, judged, statePath, now());
  return { judged, matches: 0, skipped, saved: true };
}
await sendDigest(matches, resolveEmailConfig(env), transport);   // notify BEFORE persist — a failed send exits 1
await persistJudged(state, judged, statePath, now());   // with state untouched: next run re-judges + re-sends
```
Every stage is wrapped in `timeStage` and logs one stable pair: `timing: <stage> <N>ms` then `<stage>: <counts>`.

## Dependency injection: WatcherDeps is the unit seam
```typescript
export interface WatcherDeps {
  readonly env?: Record<string, string | undefined>;   // default process.env
  readonly config?: WatcherConfig;                     // default loadWatcherConfig() — fail-visible
  readonly contextFactory?: ContextFactory;            // default chromiumContextFactory (sole Playwright import)
  readonly fetchFn?: typeof fetch;                     // default global fetch
  readonly transport?: Transporter;                    // default nodemailer, built inside sendText
  readonly statePath?: string;                         // default STATE_PATH
  readonly now?: () => number;                         // default Date.now
  readonly sleepFn?: (ms: number) => Promise<void>;   // park wait for cooldown parking; default: the judge module's sleep
}
```
Function-level idiom: I/O is an optional trailing param with the production default — judgePost, sendText, saveState, filterRecent.

## Trust boundaries: fail-visible validation; parse, don't validate
```typescript
// Config side: closed key set, path + key in every error — a typo must kill the run.
// Error formula: `<module>: <file-or-var> <offending key> <fault> — <allowed values>`
throw new Error(`config: ${filePath} has unknown key "${key}" — allowed: ${ALLOWED_KEYS.join(", ")}`);
// Env resolvers: required → throw naming the var; optional-with-default → default when absent, THROW when
// malformed; degradable → warn + null. Payload side: unknown → T | null at every edge.
const pk = readPk(post?.pk);                       // 19-digit ids stay strings, never Number-coerced
if (pk === null || text === null) return null;     // null = drop + count, never throw; verdicts use Map (proto-safe)
```

## Judge rotation: 429 cools the account, calls park past cooldowns, budget-bounded
```typescript
const state: RotationState = { accounts, cooldownUntil: new Map(), waitBudgetRemainingMs: WAIT_BUDGET_MS };
                                           // per-run, shared by reference; NO sticky pointer — every dispatch
                                           // scans the pool from account 1 and skips still-cooling entries, so a
                                           // call that starts after a cooldown expiry lands back on account 1
function coolAccount(state: RotationState, accountIndex: number, nowMs: number): void {
  state.cooldownUntil.set(accountIndex, nowMs + COOLDOWN_MS);  // 60s, first-write-wins: a second 429 never extends
}
// Attempt loop, per call: pickEligibleAccount scans in order; when every account is cooling,
// parkUntilEligible charges the shared waitBudgetRemainingMs (180s, charge-before-sleep, re-charged with
// the actual elapsed after wake), sleeps to the earliest expiry + WAKE_JITTER_MS (500ms herd spread), and
// returns false when the budget is spent — the terminal is returned OUTSIDE the try: both catches are total
// transport converters, so a throw inside would be swallowed (batch would skip silently; post would burn an
// attempt on a dead pool).
// HTTP 429 → coolAccount + re-pick, NO backoff wait; {500,502,503,504} → SAME account, RETRY_DELAYS_MS [1s, 2s,
// 4s]; transport error → batch "unanswered" (deferred whole); bulk-parse misses fall back to single-post calls.
// The all-cooling terminal is a union member the wrappers map: judgeBatch → {status: "exhausted"},
// judgePost → throw rotationExhausted(failuresFromCooldowns(state)). judgePosts drains the pool first, then
// throws AFTER Promise.all — the entry guard sends ONE best-effort alarm email, then exit(1).
```

## State: load → migrate → prune → gated atomic save
```typescript
return pruneState(migrateState(parsed, nowMs), recencyHours, nowMs);  // ENOENT ⇒ fresh; anything else throws
// migrateState: v1 id[] → v2 Record<id, ISO firstSeenAt>, stamped from the INJECTED clock; unsupported version throws.
// pruneState: keeps firstSeenAt >= now - window; undefined/non-positive window keeps everything.
function stateTempPath(dir: string, nowMs = Date.now()): string {
  return join(dir, `.${nowMs}.${random}.tmp`);   // unique sibling temp — never a shared literal name, never os.tmpdir
}
// writeStateAtomic: mkdir → write temp → rename; any failure unlinks the temp and rejects
// `state: atomic write failed for <target>`. saveState gate: zero new ids ⇒ {saved: false}, file byte-identical.
```

## Architectural Boundaries
- **No silent fallbacks**: config/state/optional-env faults exit non-zero naming the problem; the only sanctioned best-effort calls are heartbeat, the exhaustion alarm, and temp cleanup
- **Filters and stages never import each other** — the pipeline shape lives only in `index.ts`
- **Only `state.ts` writes repo-side disk** (always `writeStateAtomic`); threads-session.ts writes OS temp only; the workflow, not the code, is the git committer
- **Secrets are env-only**: names in `ENV_NAMES`; `process.env` is read only at the entry guard (exhaustion alarm)
- **No classes**: tagged errors = name constant + factory + type guard (`rotationExhausted` / `isRotationExhausted`)

<important if="you are adding a new pipeline stage">
## Adding a New Pipeline Stage
1. Create `src/<stage>.ts`: pure functions, `readonly Post[]` in → new array out; never mutate, never throw on data; inject I/O as optional trailing params with production defaults
2. Wire into `runWatcher` inside `timeStage`; destructure `{ value, durationMs }`
3. Log the pair in order: `timing: <stage> ${durationMs}ms`, then one `<stage>: <counts>` line
4. Decide gate semantics: zero output short-circuits like Gate 1 (`saved: false`, heartbeat still fires) or like Gate 2 (persist judged ids, then return) — never persist before notification
5. Update `HeartbeatStats` / `WatcherRun` if the funnel counts or summary shape changed
6. Tests in `tests/<stage>.test.ts` — see `.rpiv/guidance/tests/architecture.md`
7. Gates: `npm run typecheck && npm run lint && npm test`
</important if>

<important if="you are adding a new surface type or config key">
## Adding a New Surface Type or Config Key
1. Add the key to `ALLOWED_KEYS` in `config-file.ts` AND to the `WatcherConfig` type — forgetting the closed set fails every valid file
2. Write a `read<Key>(value, key, filePath)` validator; the error must contain the file path + key
3. Decide the emptiness policy up front (keywords: non-empty; candidateTerms: may be [])
4. New surface type: extend the `Surface` union, `readSurfaces` validation, and the `resolveSurfaces` mapping
5. Set the value in `watcher.config.json`; add valid + rejection tests in `tests/config-file.test.ts`
</important if>

<important if="you are adding a new environment variable or external service client">
## Adding a New Env Var or Service Client
1. Add the name to `ENV_NAMES` in `config.ts` (names only, never values)
2. Write a resolver with one of the three contracts (required / optional-with-default / degradable) — see the trust-boundaries pattern
3. Inject the I/O seam as an optional trailing default parameter; no SDK unless unavoidable (the LLM client is raw `fetch`)
4. Anything ordered BEFORE `persistJudged` in `runWatcher` joins the notify-before-persist contract — re-read the funnel-gates section
5. Map the secret in `.github/workflows/watch.yml` — see `.rpiv/guidance/.github/workflows/architecture.md`
</important if>

<important if="you are adding an LLM account to the judge pool">
## Adding an LLM Account
1. Edit the `LLM_ACCOUNTS` GitHub secret: JSON array of `{baseUrl, apiKey, model}` — array order IS failover order, most reliable first
2. No code change: `parseLlmAccounts` validates shape fail-visibly (`LLM_ACCOUNTS[i].<field>` in the error); rotation picks the pool up automatically; each run starts at account 1
3. Optionally re-measure: run the probe — see `.rpiv/guidance/scripts/architecture.md` — and paste the reading into `JUDGE_CONCURRENCY` in watch.yml
4. Failure signature: the exhaustion alarm lists a dead account as `account N (<baseUrl>) — HTTP 429` (1-based position)
</important if>
