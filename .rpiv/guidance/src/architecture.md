# src/ — the watcher pipeline

## Responsibility
The entire application: a single-shot CLI pipeline that fetches Threads posts, filters them, asks an LLM to judge the candidates in bulk against the configured keywords, emails matches, and persists judged post IDs. Orchestrated top-to-bottom in `index.ts` — no server, no daemon.

## Dependencies
- **playwright**: browser I/O, quarantined in `fetch-threads.ts`
- **nodemailer**: SMTP, quarantined in `email.ts`; `heartbeat.ts` reuses its `sendText`
- **Node built-ins** (`node:fs/promises`, `node:path`, global `fetch`): no LLM SDK — `judge.ts` calls chat completions with `fetch` + `AbortSignal.timeout`

## Consumers
- **.github/workflows/watch.yml**: runs `npx tsx src/index.ts` on a */10 cron and commits `state/seen-posts.json` back
- **tests/**: targets every module that has an injectable seam

## Module Structure
```
index.ts                                          # entry: main() sequences all stages; owns dedupe, funnel stats, exit discipline
types.ts                                          # the only shared types: Post, JudgeVerdict — every module imports these
config.ts, config-file.ts                         # configuration: env NAMES + paths + kill switches | watcher.config.json loader/validator
threads-session.ts, fetch-threads.ts, extract.ts  # acquisition: secret→session | Playwright→HTML/XHR | parse→Post[]
recency.ts, judge.ts                              # funnel narrowing: recency window filter + bulk LLM verdicts (keywords = the relevance criterion)
email.ts, heartbeat.ts                            # notification: job digest (fail-visible) | zero-match status (best-effort)
state.ts                                          # the only disk writes: versioned schema, atomic temp+rename, match-gated save
```

## Linear funnel orchestration (stages log counts; empty funnel = early return)
```typescript
async function main(): Promise<void> {
  const config = await loadWatcherConfig();          // config errors fail the run — no defaults
  const collected = await fetchAll(surfaces);        // I/O stage
  const posts = dedupePosts(collected);
  console.log(`extract: ${posts.length} unique post(s)`);  // every stage logs `stage: N ...`
  const recent = filterRecent(posts, config.recencyHours);
  if (recent.length === 0) {                         // funnel-empty: heartbeat, then RETURN —
    await heartbeat(stats);                          // never an exception, never a state write
    console.log("no new matches");
    return;
  }
}
main().catch((error: unknown) => {
  console.error(`watch: FAILED — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);                                   // the ONLY process.exit — the Actions run goes red
});
```

## Email-before-state ordering (the correctness invariant)
```typescript
// src/index.ts — the ORDER is the argument, named in a comment:
await sendDigest(matches, resolveEmailConfig(process.env)); // throws → exit 1 → state untouched
const judgedIds = judged.map((j) => j.post.id);   // ALL judged ids persist, relevant or not;
await saveState(state, judgedIds);                // skipped ids stay unseen and retry next run
```
`saveState` re-gates internally: zero new ids ⇒ `{ saved: false }`, file byte-identical. The workflow's `git diff --cached --quiet` completes the contract (unchanged state ⇒ no commit).

## Fail-visible config validation (closed key set; path + key in every error)
```typescript
function validateConfig(parsed: unknown, filePath: string): WatcherConfig {
  for (const key of Object.keys(record)) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
      throw new Error(`config: ${filePath} has unknown key "${key}" — allowed: ${ALLOWED_KEYS.join(", ")}`);
    }
  }
  const keywords = readStringArray(record.keywords, "keywords", filePath, /*requireNonEmpty*/ true);
  // per-key reader functions own one key each; unknown schema FAILS — never a silent fallback
}
```

## Parse-don't-validate (unknown → T | null at every edge)
```typescript
// Untrusted JSON (page blobs, graphql bodies, LLM output) crosses into the typed world once:
export function normalizeThreadItem(item: unknown): Post | null {
  const pk = readPk(post?.pk); const text = readText(post?.caption); const author = readUsername(post?.user);
  if (pk === null || text === null || author === null) return null;  // caller counts drops, never throws
  return { id: pk, text, author, permalink: buildPermalink(author, pk), timestamp: iso(takenAt) };
}
// null = malformed data (count and continue); throw = broken environment (fail the run)
```

## Dependency injection at every I/O seam (optional trailing param, production default)
```typescript
export async function judgePost(post: Post, config: JudgeConfig, keywords: readonly string[],
    fetchFn: typeof fetch = fetch): Promise<JudgeVerdict | null> { /* ... */ }
export async function sendDigest(posts: readonly Post[], config: EmailConfig,
    transport?: Transporter): Promise<SendDigestResult> { /* ... */ }
export async function saveState(state: AppState, newIds: readonly string[],
    filePath: string = STATE_PATH): Promise<SaveStateResult> { /* ... */ }
// resolveX(env = process.env) resolvers trim values, collect ALL missing var names, throw once listing them
```

## Architectural Boundaries
- **No silent fallbacks** for config or state: missing/corrupt input exits non-zero naming the problem
- **Filters and stages never import each other** — the pipeline shape lives only in `index.ts`
- **Only `state.ts` writes to disk**, always via `writeStateAtomic` (sibling temp file + rename, never `os.tmpdir()`)
- **Secrets are env-only**: names in `ENV_NAMES` (config.ts); values resolved at use time, never at import
- **No DOM lib** (tsconfig) — the in-page hydration probe is a string evaluated by Playwright

<important if="you are adding a new pipeline stage">
## Adding a New Pipeline Stage
1. Create `src/<stage-name>.ts`; the header comment names the FRD/decision ID
2. Write pure functions: `readonly Post[]` in → new array out; never mutate, never throw on data
3. Wire into `main()` at the right funnel position; add the `stage: N post(s)` count log
4. If the stage can zero the funnel, add the `if (kept.length === 0) { await heartbeat(...); return; }` block
5. Update `HeartbeatStats` (field + init + renderer) if the funnel shape changed
6. Tests in `tests/<stage-name>.test.ts` — see `.rpiv/guidance/tests/architecture.md`
7. Gates: `npm run typecheck && npm run lint && npm test`
</important if>

<important if="you are adding a new surface type or config key">
## Adding a New Surface Type or Config Key
1. Surface type: extend the `Surface` union in `config-file.ts`, then `readSurfaces` validation and the `resolveSurfaces` mapping
2. Config key: add to `WatcherConfig` AND `ALLOWED_KEYS` (closed key set — forgetting this fails every valid file)
3. Write a `read<Key>` validator (reuse `readStringArray`); the error message must contain the file path + key
4. Decide the emptiness policy up front (keywords: non-empty; candidateTerms: may be [])
5. Set the value in `watcher.config.json`; add valid + rejection tests in `tests/config-file.test.ts`
</important if>

<important if="you are adding a new environment variable or external service client">
## Adding a New Env Var or Service Client
1. Add the name to `ENV_NAMES` in `config.ts` (names only, never values)
2. Write `resolve<Service>Config(env = process.env)` — trim, collect all missing names, one throw listing them
3. Inject the I/O seam as an optional trailing default parameter
4. Decide failure semantics explicitly and comment it: fail-visible (like `sendDigest`) or best-effort wrapper (like `heartbeat()`)
5. Anything ordered BEFORE `saveState` in `main()` joins the retry-on-failure contract — re-read the email-before-state section
6. Map the secret in `.github/workflows/watch.yml` — see `.rpiv/guidance/.github/workflows/architecture.md`
</important if>

<important if="you are modifying state.ts, fetch-threads.ts, index.ts, or config.ts">
## Untested-module backlog (developer-confirmed)
`fetch-threads.ts` and `index.ts` have no test files — known backlog, not a deliberate skip. New work in them starts with tests, and both need a seam added first. `state.ts` is covered by `tests/state.test.ts` (the saveState gate).
</important if>