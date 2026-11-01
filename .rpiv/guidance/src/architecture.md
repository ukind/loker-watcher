# src/ — the watcher pipeline

## Responsibility
The entire application: a single-shot CLI pipeline that fetches job posts from Threads and LinkedIn surfaces, filters them, judges candidates in bulk against the configured keywords through an OpenAI-compatible LLM, emails matches, and persists judged post ids. One exported unit seam — `runWatcher(deps)` — no server, no daemon.

## Dependencies and consumers
- **playwright**: quarantined behind the single dynamic-import site — `chromiumContextFactory` in fetch-threads.ts is the ONLY `await import("playwright")` in src/; fetch-linkedin.ts consumes the seam type-only
- **nodemailer**: single creation site in email.ts (heartbeat + exhaustion alarm ride `sendText`); **the LLM client is raw `fetch` + `AbortSignal.timeout`** — no SDK
- **Consumers**: watch.yml runs `npx tsx src/index.ts` on the cron then commits state back; tests/ drive the seams offline; scripts/probe-judge.ts imports buildBulkMessages, resolveJudgeConfig, loadWatcherConfig

## Module Structure (role groups; imports point downward only)
```
index.ts                                 # ENTRY: runWatcher(deps) / WatcherDeps / timeStage; guarded CLI bootstrap
types.ts, config.ts, config-file.ts      # LEAVES + CONFIG: contracts | ENV_NAMES, paths | watcher.config.json validation
                                         #   (closed ALLOWED_KEYS incl. candidateTerms, scrollRounds, reasoningEffort)
threads-session.ts, fetch-threads.ts,    # ACQUISITION: session secret → storageState | walker + *Like seam +
fetch-linkedin.ts, extract.ts            #   contextFactory + platform dispatch | LinkedIn wheel walk | data-sjs walk
recency.ts, judge.ts, judge-rotation.ts, # FUNNEL: window filter | dispatchLlmCall + wrappers | rotation | parsers |
judge-parse.ts, pool.ts                  #   bounded shared runPool (zero imports)
email.ts, heartbeat.ts, state.ts         # NOTIFY + PERSIST: digest/alarm/heartbeat via sendText | v2 atomic save
```

## Funnel gates fix the ordering (the correctness invariant)
```typescript
// The ORDER is the argument (src/index.ts runWatcher):
if (newPosts.length === 0) {   // Gate 1: nothing unseen — heartbeat(stats) fires (best-effort), NO disk write
  return { judged: 0, matches: 0, skipped: 0, saved: false };   // state stays byte-identical
}
if (matches.length === 0) {                     // Gate 2: judged, zero matches — heartbeat, THEN persist
  await heartbeat(stats);
  await persistJudged(state, judged, statePath, now());   // zero-match runs still mark seen
  return { judged, matches: 0, skipped, saved: true };
}
await sendDigest(matches, resolveEmailConfig(env), transport);  // notify BEFORE persist — a failed send exits 1
await persistJudged(state, judged, statePath, now());   // state untouched: next run re-judges + re-sends
```
Every stage is wrapped in `timeStage` and logs one stable pair: `timing: <stage> <N>ms` then `<stage>: <counts>`.

## Dependency injection: WatcherDeps is the unit seam
```typescript
// WatcherDeps (runWatcher(deps = {})) — every field optional, production default inline:
env?: Record<string, string | undefined>;  config?: WatcherConfig;   // process.env | loadWatcherConfig()
contextFactory?: ContextFactory;           // chromiumContextFactory — the sole Playwright import
fetchFn?: typeof fetch;  transport?: Transporter;  statePath?: string;   // fetch | nodemailer | STATE_PATH
now?: () => number;  sleepFn?: (ms: number) => Promise<void>;          // Date.now | judge sleep
```
Function-level idiom: I/O is an optional trailing param with the production default — judgePost, sendText, saveState, filterRecent.

## Fail-visible contracts: config errors kill the run; parsers never throw
```typescript
throw new Error(`config: \${filePath} has unknown key "\${key}" — allowed: \${ALLOWED_KEYS.join(", ")}`);
// Env resolvers: required → throw naming the var; optional-with-default → THROW when malformed; degradable → null + warn.
// Payload: unknown → T | null at every edge (ids stay strings; Map for verdict keys).
```

## Judge rotation: 429 cools the account, calls park past cooldowns, budget-bounded
```typescript
const state: RotationState = { accounts, cooldownUntil: new Map(), waitBudgetRemainingMs: WAIT_BUDGET_MS };
// NO sticky pointer — every dispatch scans from account 1; coolAccount(state, i, now) sets cooldownUntil[i] =
// now + 60s, first-write-wins. All cooling ⇒ parkUntilEligible charges the 180s budget (wake at earliest expiry + 500ms jitter, false when spent). 429 → cool + re-pick (no backoff); 5xx → same account, [1s,2s,4s]; transport error → batch deferred whole.
// Terminal RETURNED, never thrown in the core; judgePosts drains, then throws AFTER Promise.all: ONE alarm email, exit(1).
```

## fetch-linkedin.ts: the second platform rides the same seam
```typescript
// TYPES-ONLY seam import (no Playwright); index.ts policy: unset/invalid LINKEDIN_SESSION_STATE ⇒ null ⇒
// "skipping N linkedin surface(s)" (warn, never throw, never logged-out; a walk-time failure downgrades to a warn).
function mintPost(activityId: string, text: string): Post {  // body-absent facts are MINTED from the id
  return {
    platform: "linkedin",
    id: `urn:li:activity:\${activityId}`,                   // dedup key; permalink is constructed from it
    author: "linkedin-member",                               // placeholder — DOM carries no ids to join on
    timestamp: new Date(Number(BigInt(activityId) >> 22n)).toISOString(),  // id >> 22 = epoch ms
  };
}
// Flight stream: "rowId:{json}" lines → generic walk → capture-verified leaves; subject suffix " + LinkedIn" rides only when ≥1 LinkedIn match exists.
```

## State: load → migrate → prune → gated atomic save
```typescript
return pruneState(migrateState(parsed, nowMs), recencyHours, nowMs);  // ENOENT ⇒ fresh; anything else throws
// migrateState: v1 id[] → v2 Record<id, ISO firstSeenAt> from the INJECTED clock; bad version throws.
// pruneState: keeps firstSeenAt >= now - window; unset/non-positive window keeps everything.
function stateTempPath(dir: string, nowMs = Date.now()): string {
  return join(dir, `.\${nowMs}.<random>.tmp`);  // unique sibling temp — never a shared literal, never os.tmpdir
}
// writeStateAtomic: mkdir inside try → write temp → rename; failure unlinks temp, rejects
// `state: atomic write failed for <target>`. saveState gate: zero new ids ⇒ {saved:false}, file untouched.
```

## Architectural Boundaries
- **No silent fallbacks**: config/state/optional-env faults exit non-zero naming the problem; the only sanctioned best-effort calls are heartbeat, the exhaustion alarm, and temp cleanup
- **Pipeline shape lives only in `index.ts`** (stages never import each other); **only `state.ts` writes repo-side disk** (always `writeStateAtomic`) — threads-session.ts writes OS temp only; the workflow is the git committer
- **Secrets are env-only** (names in `ENV_NAMES`); **no classes** — tagged errors = name constant + factory + type guard (`rotationExhausted` / `isRotationExhausted`)

<important if="you are adding a new pipeline stage">
## Adding a New Pipeline Stage
1. Create `src/<stage>.ts`: pure functions, `readonly Post[]` in → new array out; never mutate, never throw on data; inject I/O as optional trailing params with production defaults
2. Wire into `runWatcher` inside `timeStage`; destructure `{ value, durationMs }`
3. Log the pair in order: `timing: <stage> \${durationMs}ms`, then one `<stage>: <counts>` line
4. Decide gate semantics: zero output short-circuits like Gate 1 (`saved: false`, heartbeat still fires) or like Gate 2 (persist judged ids, then return) — never persist before notification
5. Update `HeartbeatStats` / `WatcherRun` if the funnel counts or summary shape changed
6. Tests in `tests/<stage>.test.ts` — see `.rpiv/guidance/tests/architecture.md`
7. Gates: `npm run typecheck && npm run lint && npm test`
</important if>

<important if="you are adding a new surface type or config key">
## Adding a New Surface Type or Config Key
1. Add the key to `ALLOWED_KEYS` in `config-file.ts` AND to the `WatcherConfig` type — forgetting the closed set fails every valid file
2. Write a `read<Key>(value, key, filePath)` validator; the error must contain the file path + key; reject bad values, never floor them
3. Decide the emptiness policy up front (keywords: non-empty; candidateTerms: may be [])
4. New surface type: extend the `Surface` union + `readSurfaces` + a `resolveSurfaces` arm + the platform dispatch in index.ts/fetch-threads.ts + email marking in email.ts
5. Set the value in `watcher.config.json`; add valid + rejection tests in `tests/config-file.test.ts`
</important if>

<important if="you are adding a new environment variable or external service client">
## Adding a New Env Var or Service Client
1. Add the name to `ENV_NAMES` in `config.ts` (names only, never values)
2. Write a resolver with one of the three contracts (required / optional-with-default / degradable) — see the fail-visible contracts pattern
3. Inject the I/O seam as an optional trailing default parameter; no SDK unless unavoidable (the LLM client is raw `fetch`)
4. Anything ordered BEFORE `persistJudged` in `runWatcher` joins the notify-before-persist contract — re-read the funnel-gates section
5. Map the secret in `.github/workflows/watch.yml` — see `.rpiv/guidance/.github/workflows/architecture.md`
</important if>

<important if="you are adding an LLM account to the judge pool">
## Adding an LLM Account
1. Edit the `LLM_ACCOUNTS` GitHub secret: JSON array of `{baseUrl, apiKey, model}` — array order IS trial order, most reliable first
2. No code change: `parseLlmAccounts` validates shape fail-visibly (`LLM_ACCOUNTS[i].<field>` in the error); rotation picks the pool up automatically; each dispatch scans from account 1
3. Optionally re-measure: run the probe — see `.rpiv/guidance/scripts/architecture.md` — and paste the reading into `JUDGE_CONCURRENCY` in watch.yml
4. Failure signature: the exhaustion alarm lists a dead account as `account N (<baseUrl>)` (1-based position)
</important if>

<important if="you are adding a new platform fetcher">
## Adding a New Platform Fetcher
1. Extend `Post.platform` in types.ts with the new literal; note id-collision reasoning in the doc comment
2. Add `ENV_NAMES.<platform>Session`; reuse `resolveSession(env, ENV_NAMES.<platform>Session)` — the trailing-name param exists for exactly this
3. Create `src/fetch-<platform>.ts`: pure parser exports (`string → Post[]`) + one walk taking `ContextLike` from fetch-threads.ts — import the seam, never Playwright
4. Derive body-absent facts from ids with provenance comments; placeholder author if sources cannot join; module-top measured-constants block
5. Wire dispatch: a `resolveSurfaces` arm; platform filter + null-session skip-with-warn in index.ts; optional rider on `AuthenticatedFetchOptions`; runPool worker arm in `fetchSurfacesAuthenticated`
6. Email: platform token in `buildDigest` + subject suffix rule in `buildSubject` (suffix rides only when ≥1 match of the new platform)
7. Tests: `tests/fetch-<platform>.test.ts` with a staged-response `fakeContext`; mirror the `(BigInt(NOW) << 22n).toString()` trick if ids encode time
</important if>

<important if="you are adding an email variant">
## Adding an Email Variant
1. Pure `buildX(...): string | null` builders in email.ts/heartbeat.ts — null means "nothing to send"
2. Thin `sendX(..., config, transport?)` wrapper: gate → build → sendText → prefix log; never call nodemailer directly
3. The caller sets the failure policy in index.ts: digest = fail the run; status/alarm = best-effort try/catch + warn
4. Tests: builders assert exact strings (incl. the null case); senders use a fake Transporter recording sendMail args
</important if>
