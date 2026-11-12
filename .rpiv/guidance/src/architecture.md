# src/ — the watcher pipeline

## Responsibility
The entire application: a single-shot CLI pipeline that fetches job posts from Threads and LinkedIn surfaces, filters them, judges candidates in bulk against the configured keywords through an OpenAI-compatible LLM, emails matches, and persists judged post ids. One exported unit seam — `runWatcher(deps)` — no server, no daemon.

## Dependencies and consumers
- **playwright**: THREE dynamic-import quarantine sites — the chromium ContextFactory in fetch-threads.ts, the LinkedIn-local headed persistent-profile context factory in linkedin-fetch.ts (own `await import("playwright")`), AND the login helper's headed `launchPersistentContext` in scripts/login-linkedin.ts; no new runtime dep
- **nodemailer**: single creation site in email.ts (heartbeat + exhaustion + leg-dead/halt alarms ride `sendText`); **the LLM client is raw `fetch` + `AbortSignal.timeout`** — no SDK
- **Consumers**: watch.yml runs `npx tsx src/index.ts` on the cron then commits state back; tests/ drive the seams offline; scripts/probe-judge.ts imports buildBulkMessages, resolveJudgeConfig, loadWatcherConfig

## Module Structure (role groups; imports point downward only)
```
index.ts                                 # ENTRY: runWatcher(deps) / WatcherDeps / timeStage; guarded CLI bootstrap
types.ts, config.ts, config-file.ts,     # LEAVES + CONFIG: contracts | ENV_NAMES, paths | watcher.config.json
judge-ceilings.ts, judge-health.ts       #   validation (closed ALLOWED_KEYS incl. candidateTerms, scrollRounds,
                                         #   reasoningEffort) | the committed judge ceilings + provider health reader/writer
env-file.ts                              # PC-script support: <cwd>/.env auto-load (fills ONLY unset keys, real env wins)
                                         #   + the shared .env line writer upsertDotEnvLine (hoisted here Phase 9;
                                         #   login-linkedin imports it)
threads-session.ts, fetch-threads.ts,    # ACQUISITION: session secret → storageState | Threads walker + *Like seam +
linkedin-*.ts, extract.ts                #   contextFactory | the PC-leg linkedin family (parser/session/fetch/payload) | data-sjs walk
recency.ts, judge.ts, judge-rotation.ts, # FUNNEL: window filter | dispatchLlmCall + wrappers | rotation | parsers |
judge-parse.ts, pool.ts                  #   bounded shared runPool (zero imports)
email.ts, heartbeat.ts, state.ts         # NOTIFY + PERSIST: digest/alarm/heartbeat via sendText | v2 atomic save
```

## Funnel gates fix the ordering (the correctness invariant)
```typescript
// The ORDER is the argument (src/index.ts runWatcher). BEFORE Gate 1 the health resolve runs — hoisted so
// the degraded-accounts line rides EVERY email; the recorded trade: malformed LLM_ACCOUNTS now exit-1s even a Gate-1 tick.
if (newPosts.length === 0) {   // Gate 1: nothing unseen — heartbeat(stats, riders…) fires (best-effort), NO disk write
  return { judged: 0, matches: 0, skipped: 0, saved: false };   // state stays byte-identical
}
if (matches.length === 0) {                     // Gate 2: judged, zero matches — heartbeat, THEN persist
  await heartbeat(stats, recent, judged, candidateTerms, env, now, transport);
  await flushTickHealth(health);                // the tick flush sits between the judge stage and Gate 2
  await persistJudged(state, judged, statePath, now());   // zero-match runs still mark seen
  return { judged, matches: 0, skipped, saved: true };
}
await sendDigest(matches, resolveEmailConfig(env), transport);  // notify BEFORE persist — a failed send exits 1;
                                              // the digest carries the linkedinLeg + degradedLine riders
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
linkedinFetch?: (payloadPath, now) => Promise<PayloadRead>;  judgeCeilings?;  judgeHealth?;
judgeHealthPath?: string;  // PC-leg payload read | ceilings/health readers (degrade, never fail) |
                           //   the health flush target — default dirname(statePath)/judge-health.json
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
// Pool width = Σ per-account ceilings (a health-capped account counts 1 until its probe rejoins it). The
// ceilings come from state/judge-ceilings.json — the committed, degrade-everything reader (src/judge-ceilings.ts
// loadAccountCeilings: absent/malformed floors every account at ceiling 1 with one warning naming the baseUrl;
// it never fails a run, and it skips the probedAt freshness key).
// Terminal RETURNED, never thrown in the core; judgePosts drains, then throws AFTER Promise.all: ONE alarm email, exit(1).

Health circuit (the provider-health boundary): RotationState carries healthMarks / probedThisTick /
outcomeLedger as plain fields; the pick applies the cap and the half-open probe INLINE (a capped account runs
at effective ceiling 1 until its probe claims it; a success deletes the mark AND the probe slot, rejoining at
the committed ceiling for the rest of the tick). The dispatch core stamps the ledger at the four branch sites
(429 never counts; the mid-backoff branch never stamps; a parse-miss resolve stamps nothing — a model failure
is not an account outcome). An all-health-blocked pick with no active cooldown exhausts immediately (an
uncapped account never blocks — the zero-charge ceiling wait survives). judge-rotation.ts keeps its
ZERO-RUNTIME-IMPORT identity with two sync idioms: a PAIRED constant (HARD_FAIL_TICKS_TO_CAP exported from
judge-health + a MUST-stay-equal local copy) and a STRUCTURAL SLICE (OutcomeLedgerState redeclares the
rotation fields instead of importing RotationState). Flushing is CHANGE-GATED — flushHealthIfChanged
canonicalizes the envelope (sorted keys) and writes only on a content difference, so no-op ticks keep the
committed file byte-identical: the tick flush rides the success path (after the judge stage), the exhaustion
flush rides main's entry-module catch (episode OPEN, best-effort, never masking exit 1), and the alarm gates
on the PRE-FLUSH episodeAlarmDue read (a duplicate alarm costs one email; a suppressed one costs the outage).
RotationExhausted carries .health (TickOutcomes) to the catch for that flush.
```

## linkedin-*.ts: the second platform is a PC-local browser walk (2026-11-11)

```typescript
// SPEC OF RECORD: the live content-search page (capture 2026-11-11) — the walk opens the
// canonical search URL, clicks "Load more" up to scrollRounds times, and parses the
// pagination Flight responses the page itself makes (page JSON is dead: no data-sjs).
// linkedin-parser.ts: PURE core — the LINKEDIN_RESPONSE_RE response filter, the Flight row
// splitter, the $-ref commentary_text walker (longest text per row — the hashtag chip is a
// second commentary component), buildContentSearchUrl (keywords → the content-search URL),
// and the guarded mintPost (drop+count, never throws). Timestamp = BigInt(id)>>22n,
// ms<=0n rejected. Pairing: the timestamp-ordered zip — the i-th distinct commentary text
// (stream order) pairs with the i-th distinct id sorted by derived timestamp ascending; a
// count mismatch warns naming the counts and mints the paired prefix. Every call logs ONE
// pairing-oracle line naming each minted id ↔ text head — the stream carries no id↔text
// link, so that line is the only mis-pair detector that exists.
// linkedin-session.ts: LINKEDIN_COOKIES_FILE resolver (fail-visible D4 — the stricter contrast to
// silent-null resolveSession); quote asymmetry canonicalized once (header quoted+last §10/§14.5;
// csrf stripped §3; storageState re-quotes).
// linkedin-fetch.ts: the browser walk — a LinkedIn-local LinkedInContextFactory (~120 lines duplicated
// from the shared factory: widening breaks the 3 doubles under strictFunctionTypes, re-exporting the
// private factory re-introduces knip N012; HEADED persistent-profile Chromium (launchPersistentContext,
// msedge channel, viewport null — the session rides the PROFILE; the harvested cookie pair is only the
// resolver's fail-visible gate, never a synthesized document), own dynamic-import quarantine, locale
// en-US pins the Load-more text selector) walks each surface: one paced navigation (shared per-walk
// 5-15s gate, makePacingGate RESERVES
// the slot BEFORE the await so width-2 workers never compute the same wake time; per-walk closure,
// ticks never inherit stamps) plus up to scrollRounds Load-more clicks (LOAD_MORE_SELECTOR =
// button:has-text("Load more") — no aria-label, no id, deploy-hashed classes; ~2.5s settle window;
// dry-round exit); every interception whose URL matches LINKEDIN_RESPONSE_RE with status 200 parses
// through linkedin-parser.ts; parsed-body counter (N008); first-wins urn dedupe across bodies;
// context + page close on every path. Fault vocabulary: a checkpoint/login/authwall page URL
// (post-goto, every liveness poll tick, post-click-settle) throws the tagged
// HaltError(HALT_CHECKPOINT_REASON) — the operator-cleared latch, NEVER leg-dead; no flagship-web 200
// inside the 30s liveness window throws the tagged LegDeadError (one alarm per episode); a results
// page with zero posts is SUCCESS (the OK — 0 post(s) log, defb8af); anything else is a per-surface
// fault (warn + skip). The kept skeleton rides unchanged — runPool RETURNS VOID: side arrays by claim
// index (fetchSurfacesAuthenticated idiom), worker total for surface faults, leg-dead drain-then-throw
// (judgePosts D11 shape); FR-5 shuffle; join priority halt > leg-dead > all-faulted;
// stamp-at-slot-write; the rate is pacing-bound, not width-bound.
// linkedin-payload.ts: {version, writtenAt, posts}; writePayloadAtomic (temp+rename); readPayloadPosts
// NEVER THROWS (D13): ENOENT→quiet absent; >PAYLOAD_MAX_AGE_MS(30min)→stale+age; non-ENOENT unreadable→
// malformed; bad envelope→malformed; bad rows→drop+count. {posts, leg} feeds HeartbeatStats.linkedinLeg
// (heartbeat line ALWAYS; digest line when not ok).
// index.ts arm: linkedinFetch re-keyed to (payloadPath, now) => PayloadRead; no token gate — absence
// is the PC-off normal; the D12 belt catch remains for unanticipated faults only.
// The PC scripts themselves live in scripts/ (tick, loop, gate, login, chain) — see
// .rpiv/guidance/scripts/architecture.md; env-file.ts merges <cwd>/.env UNDER the real env for every
// PC script (missing .env = quiet normal).
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
- **Pipeline shape lives only in `index.ts`** (stages never import each other); **every `state/` write goes through ONE atomic idiom — `stateTempPath` + temp/rename from state.ts — via FOUR writers, one file each** (state.ts seen-posts, judge-ceilings.ts ceilings, judge-health.ts health, linkedin-payload.ts payload); the workflow is the git committer
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
1. Pure `buildX(...)` builders in email.ts/heartbeat.ts — `string | null`, null means "nothing to send"; the sanctioned exceptions are builders that always have content (`buildLegDeadAlarmText`, `buildHaltAlarmText`, `buildHeartbeatSubject` return plain `string`)
2. Thin `sendX(..., config, transport?)` wrapper: gate → build → sendText → prefix log; never call nodemailer directly
3. The caller sets the failure policy in index.ts: digest = fail the run; status/alarm = best-effort try/catch + warn
4. Tests: builders assert exact strings (incl. the null case); senders use a fake Transporter recording sendMail args
</important if>
