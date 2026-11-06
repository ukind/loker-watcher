# src/ — the watcher pipeline

## Responsibility
The entire application: a single-shot CLI pipeline that fetches job posts from Threads and LinkedIn surfaces, filters them, judges candidates in bulk against the configured keywords through an OpenAI-compatible LLM, emails matches, and persists judged post ids. One exported unit seam — `runWatcher(deps)` — no server, no daemon.

## Dependencies and consumers
- **playwright**: THREE dynamic-import quarantine sites — the chromium ContextFactory in fetch-threads.ts, `request.newContext` in linkedin-fetch.ts (ContextLike exposes no request surface, verified 2026-11-04), AND the login helper's headed `launchPersistentContext` in scripts/login-linkedin.ts; no new runtime dep — curl spawns the PC-local curl-impersonate binary (CURL_IMPERSONATE_BIN, not an npm package)
- **nodemailer**: single creation site in email.ts (heartbeat + exhaustion + leg-dead alarms ride `sendText`); **the LLM client is raw `fetch` + `AbortSignal.timeout`** — no SDK
- **Consumers**: watch.yml runs `npx tsx src/index.ts` on the cron then commits state back; tests/ drive the seams offline; scripts/probe-judge.ts imports buildBulkMessages, resolveJudgeConfig, loadWatcherConfig

## Module Structure (role groups; imports point downward only)
```
index.ts                                 # ENTRY: runWatcher(deps) / WatcherDeps / timeStage; guarded CLI bootstrap
types.ts, config.ts, config-file.ts,     # LEAVES + CONFIG: contracts | ENV_NAMES, paths | watcher.config.json
judge-ceilings.ts                        #   validation (closed ALLOWED_KEYS incl. candidateTerms, scrollRounds,
                                         #   reasoningEffort) | the committed judge ceilings reader/writer
env-file.ts                              # PC-script support: <cwd>/.env auto-load (fills ONLY unset keys, real env wins)
                                         #   + the shared .env line writer upsertDotEnvLine (hoisted here Phase 9;
                                         #   login-linkedin + setup-curl-impersonate import it)
threads-session.ts, fetch-threads.ts,    # ACQUISITION: session secret → storageState | Threads walker + *Like seam +
linkedin-*.ts, extract.ts                #   contextFactory | the PC-leg linkedin family (voyager/session/fetch/payload) | data-sjs walk
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

## Judge rotation: dispatch dial + per-account ceilings; 429 cools the account; cooldown parks stay budget-bounded
```typescript
const state: RotationState = { accounts, cooldownUntil: new Map(), ceilings, inFlight: new Map(),
  dispatchCounter: 0, ceilingWaiters: [], waitBudgetRemainingMs: WAIT_BUDGET_MS };
// NO sticky pointer — every dispatch scans FROM the dial (dispatchCounter % poolSize), skipping cooling AND
// at-ceiling accounts; a claim moves the dial just past the claimed account, so consecutive claims land on
// consecutive hosts (the first N dispatches of a run hit N distinct accounts). claim/release brackets every
// HTTP attempt; release runs in the attempt's finally, so every exit path frees its slot exactly once.
// coolAccount(state, i, now) sets cooldownUntil[i] = now + 60s, first-write-wins; a FRESH stamp also wakes
// parked ceiling waiters (capacity shrank). An all-at-ceiling pick (nothing cooling) parks on the
// release-waiter queue at ZERO budget charge; ONLY cooldown parks draw the 180s budget (parkUntilEligible:
// charge-before-sleep, wake at earliest active expiry + 500ms jitter, false when spent) and can convert to
// the exhaustion alarm. 429 → cool + rewind (no backoff); 5xx → same account [1s,2s,4s] via the frame-local
// pinnedStart seat (the backoff sleep runs with the slot released); transport error → batch deferred whole.
// Pool width = Σ per-account ceilings. The ceilings come from state/judge-ceilings.json — the committed,
// degrade-everything reader (src/judge-ceilings.ts loadAccountCeilings: absent/malformed floors every
// account at ceiling 1 with one warning naming the baseUrl; it never fails a run).
// Terminal RETURNED, never thrown in the core; judgePosts drains, then throws AFTER Promise.all: ONE alarm email, exit(1).
```

## linkedin-*.ts: the second platform is a PC-local voyager leg (2026-11-04)

```typescript
// SPEC OF RECORD: linkedin-reverse/DOCUMENTATION.md — endpoint, restli encoding (§4.1+§12.5,
// '#'→%23), §12.7 canonical recipe (sortBy:date_posted; orderBy IGNORED §12.4), §13 fault matrix.
// linkedin-voyager.ts: PURE core — constants + restli encoder + URL builder + parser (drop+count,
// never throws). Timestamp = BigInt(id)>>22n (§12.4 drift caveat).
// linkedin-session.ts: LINKEDIN_COOKIES_FILE resolver (fail-visible D4 — the stricter contrast to
// silent-null resolveSession); quote asymmetry canonicalized once (header quoted+last §10/§14.5;
// csrf stripped §3; storageState re-quotes).
// linkedin-fetch.ts: VoyagerGet seam; curl transport (CURL_IMPERSONATE_BIN fail-visible — the message
// names BOTH remedies: npm run setup-curl, or LINKEDIN_TRANSPORT=playwright in .env; lexiforest single
// binary, --impersonate chrome116 pinned — the profile OWNS the UA+TLS+H2 set, so the transport sends no
// user-agent header and BROWSER_UA feeds ONLY the playwright adapter; injectable
// exec, -w status sentinel) + playwright request.newContext transport (own quarantine); resolve
// LINKEDIN_TRANSPORT curl|playwright, no auto-fallback; classifyFault §13.3; LegDeadError tagged
// error; runPool walk — runPool RETURNS VOID: side arrays by claim index (fetchSurfacesAuthenticated
// idiom), worker total for surface faults, leg-dead drain-then-throw (judgePosts D11 shape); shared
// per-walk 5s pacing gate — the rate is pacing-bound, not width-bound.
// linkedin-payload.ts: {version, writtenAt, posts}; writePayloadAtomic (temp+rename); readPayloadPosts
// NEVER THROWS (D13): ENOENT→quiet absent; >PAYLOAD_MAX_AGE_MS(30min)→stale+age; bad envelope→malformed;
// bad rows→drop+count. {posts, leg} feeds HeartbeatStats.linkedinLeg (heartbeat line ALWAYS; digest
// line when not ok).
// index.ts arm: linkedinFetch re-keyed to (payloadPath, now) => PayloadRead; no token gate — absence
// is the PC-off normal; the D12 belt catch remains for unanticipated faults only.
// PC scripts: fetch tick = fetch → payload → add ONLY state/linkedin-posts.json → commit →
// login helper (scripts/login-linkedin.ts): HEADED persistent-profile harvest — the OPERATOR logs in by
//   hand (§2.4 VERIFIED interactive login; NO headless re-login exists), the script polls the jar for the
//   li_at + JSESSIONID pair (verbatim — the quoted JSESSIONID stays quoted), writes the cookie file
//   atomically (stateTempPath + rename) and upserts the LINKEDIN_COOKIES_FILE line in <cwd>/.env;
//   entry-guarded; exit 1 on timeout/no session. env-file.ts merges <cwd>/.env UNDER the real env for
//   every PC script (missing .env = quiet normal).
// pull --rebase → push, ONE retry (mirrors commit-state-rebase.sh; single-writer-per-file); leg-dead =
// ONE alarm per episode (repo-local marker beside the payload) + exit 1; loop continues; probe = gate exit 1.
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
1. Edit the `LLM_ACCOUNTS` GitHub secret: JSON array of `{baseUrl, apiKey, model}` — the dispatch dial starts each call at the next account, so pool order is a starting seat, not a trial order
2. No code change: `parseLlmAccounts` validates shape fail-visibly (`LLM_ACCOUNTS[i].<field>` in the error); rotation picks the pool up automatically; a new account without a committed reading is capped at ceiling 1 until the next probe
3. Optionally re-measure: dispatch the probe — it writes `state/judge-ceilings.json` and the probe job commits it (see `.rpiv/guidance/scripts/architecture.md`, "Running the Judge Probe and Applying the Reading")
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
