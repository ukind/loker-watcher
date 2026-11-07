# tests/ — offline unit test suite

## Responsibility
Full-pipeline offline verification of src/ (plus the commit-state-rebase shell script in scripts/ and the two Claude hooks in scripts/hooks/) via `node:test` + `tsx` (`tsx --test tests/*.test.ts`). Zero network, zero browser, zero writes inside the repo, zero mocking libraries — every double is a hand-written literal. The bash-spawning suite resolves bash once at module scope (MINGW/MSYS gate + `git --exec-path` fallback) and skips EXPLICITLY — naming the problem — when none resolves; `npm test` still exits 0.

## Dependencies
- **node:test + node:assert/strict**, run via tsx — the only runner/assertion stack
- nodemailer contributes types only (fake transports); Playwright is never imported at test time (structural `*Like` doubles); the linkedin transport stays unexercised like chromiumContextFactory — the VoyagerGet seam carries the tests
- Consumers: `npm test` (the `tests/*.test.ts` glob auto-picks new files; CI's final gate); watch.yml does NOT run tests — merge gate only

## Coverage map (the 1:1 mirror rule, today)
```
config.ts, types.ts   — no test (names/paths/kill switch — the "false" branch rides index.test.ts; pure types)
config-file.ts     → config-file.test.ts
email.ts, heartbeat.ts → email.test.ts, heartbeat.test.ts
extract.ts         → extract.test.ts         # fixture-driven: tests/fixture/tag-page.html, graphql-response.json
linkedin-voyager.ts → linkedin-voyager.test.ts   # §12.5 escaping matrix, §12.7 URL pin, id>>22n clock, scrubbed fixture (edges 1-4)
linkedin-session.ts → linkedin-session.test.ts   # resolver reject matrix (all name LINKEDIN_COOKIES_FILE), quote asymmetry, storageState
linkedin-fetch.ts → linkedin-fetch.test.ts        # §13.3 classifier table, curl-over-fake-exec, resolver matrix, scripted VoyagerGet walk
linkedin-payload.ts → linkedin-payload.test.ts    # all four failure classes + atomic round trip
env-file.ts        → env-file.test.ts            # parser pins (malformed line warn+skip naming file+line) + merge contract
                                                 #   (fills ONLY unset keys; real env wins; missing = quiet no-op) + the
                                                 #   hoisted upsertDotEnvLine writer pins (moved from login-linkedin, Phase 9)
login-linkedin.ts (core) → login-linkedin.test.ts  # context seam injected, sleeps/clock injected — no headed Chromium in tests
scripts/setup-curl-impersonate.ts → setup-curl-impersonate.test.ts  # fetch + tar doubles, fixture sha computed by the suite,
                                                 #   already-configured short-circuit, sha/tar/exe/platform failure pins
fetch-threads.ts   → fetch-threads.test.ts   # structural PageLike/ContextLike doubles
index.ts           → index.test.ts           # full offline runWatcher runs via WatcherDeps doubles
judge.ts           → judge.test.ts           # residual: env parsing, pools/pipeline, payload pins
judge-parse.ts     → judge-parse.test.ts     # verdict parsers — pure string-in/string-out
judge-rotation.ts  → judge-rotation.test.ts  # cooldown, park budget, exhaustion suites
judge-ceilings.ts  → judge-ceilings.test.ts  # committed ceilings: resolver matrix, never-throw reader
#                                              #   degrade lattice, atomic writer round-trip
judge-health.ts    → judge-health.test.ts    # committed health: reader degrade matrix, tick-merge matrix,
#                                              #   byte-stability gate, episode lifecycle, one-alarm gate
judge-helpers.ts, pool.ts — no test (shared pure fixtures, not *.test.ts, never executed | exercised transitively)
recency.ts         → recency.test.ts
state.ts           → state.test.ts           # v2 schema, migration, prune, atomic write
threads-session.ts → session.test.ts         # GRANDFATHERED name drift — new files mirror <module>.test.ts
scripts/hooks/*    → gate-destructive.test.ts, format-on-edit.test.ts   # black-box spawnSync; import no src code
scripts/commit-state-rebase.sh → commit-state-rebase.test.ts   # black-box scratch-repo git scenarios; bash gate + explicit skip
```

## File skeleton (strict assert; .js specifiers; titles are behavior specs)
```typescript
import assert from "node:assert/strict";          // ALWAYS strict — never bare node:assert
import { after, describe, it } from "node:test";  // after only when files are written
import { filterRecent } from "../src/recency.js"; // .js extension REQUIRED (NodeNext)
// describe per exported function, it per behavior — titles are observable outcomes, not method names
```

## Doubles are literals; BOTH idioms are acceptable (developer-confirmed)
```typescript
// Idiom A — inline literal, capture in a closure (email/heartbeat suites):
let captured: unknown = null;
const mockTransport = { sendMail: async (o: unknown) => { captured = o; return { messageId: "m1" }; },
} as unknown as Transporter;                        // exactly ONE double-cast, at construction
// Idiom B — named factory returning { double, captures } (index/fetch-threads suites): same literal shape,
// but a closure list is returned — function recordingTransport() { const subjects: string[] = []; ...
// return { transport, subjects }; } — the closure IS the test oracle.
// mockFetch returns real Response objects; branch on request CONTENT (prompt token, URL host), never on call
// order in POOLED contexts. Deterministic single-worker cases may use call counters. Plain *Like doubles need
// NO cast; an inline mockFetch casts at the call site.
```

## Clock and env are parameters — pinned, never ambient
```typescript
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);        // month is 0-based; never Date.now()
await runWatcher({ env: BASE_ENV, now: () => NOW, /* ... */ });   // env literal, not process.env
// Structured env values inline: LLM_ACCOUNTS: JSON.stringify([...]); secrets as Buffer base64 literals.
// Injected-clock variants are fine (some suites pass the real Date.now AS the injected now): ambient reads are
// the forbidden thing. One wall-clock assertion: the 429 "no backoff" elapsed < 500ms test (judge-rotation).
```

## Temp files: lazy mkdtemp + one after(); hook suites use per-test mkdtemp + try/finally
```typescript
let dir: string | undefined;                        // undefined = no test needed a dir yet
after(async () => { if (dir !== undefined) await rm(dir, { recursive: true, force: true }); });
async function tempStatePath(name: string, seed?: AppState): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));   // prefix per suite: lw-config-, lw-state-, lw-index-
  return join(dir, name);
}
// Absence: assert.rejects(() => readFile(path), /ENOENT/) proves no write happened. Gate 1 contract: read
// before/after — byte-identical IS the assertion.
```

## Error messages are API (thunk + regex; validator form; domain predicates)
```typescript
await assert.rejects(() => loadWatcherConfig(p), /unknown key "keyword"/);   // async THUNK; regexes pin the discriminating fragment (/LLM_ACCOUNTS[0].model/), never whole sentences
await assert.rejects(() => writeStateAtomic(STATE, dirTarget), (error: unknown) => {
  assert.match((error as Error).message, /^state: atomic write failed for /); return true;   // multi-part: return true
});
await assert.rejects(() => judgePost(/* pool 429s out */), (e: unknown) => isRotationExhausted(e));   // tagged errors
```

## Fixtures: trimmed real captures, numbered edges, mutation variants
```typescript
// Header comment (comment-capable formats only — HTML, not JSON): origin, date, trim policy, every planted
// edge. JSON fixtures cannot carry comments: their provenance lives in the LOADING TEST's titles instead.
const fixture = readFileSync(join(here, "fixture", "tag-page.html"), "utf8");   // import.meta.url, never cwd
const noisy = fixture.replace("</head>", '<script type="application/json" data-sjs="">{"broken": </script></head>');
assert.deepEqual(extractPosts(noisy), extractPosts(fixture));   // variants by MUTATION; tolerance = equivalence
```
No keyword-agreement rule: fixture text stays verbatim-realistic to the capture (a former "must agree with keywords" rule was dropped — nothing enforced it and no fixture contains a shipped keyword).

## Architectural Boundaries
- **Offline only**: browser/SMTP/LLM faked via injection; importing src never loads Playwright (dynamic import)
- **Never touch `process.env` or repo files** — writes go to OS temp only; console access is call-through spies only (`t.mock.method(console, "log"/"warn", console.log.bind(console))` — F014 walk-log discrimination), never a silencing stub
- **No mock libraries**; the ONE shared-helpers exception is `tests/judge-helpers.ts` (six pure fixtures — KEYWORDS, singleAccount, ok, id19, bulkPost, bulkContent); doubles and mock-fetch factories stay per-suite
- **Hooks are black-box subprocesses** (`spawnSync(process.execPath, [hook], { input })` — no import, no mocking; `process.execPath` because the shebang is inert on Windows); full-pipeline oracles are layered: `WatcherRun` → disk state → captured subjects

<important if="you are adding a test for a new src module">
## Adding a Test for a New src Module
1. File: `tests/<module>.test.ts` (mirror the name; do NOT "fix" the grandfathered session.test.ts)
2. Find the injection seam in src — if the boundary is not injectable, add the optional trailing parameter to src FIRST
3. Build doubles per boundary: env literal, Response-based mockFetch, capture-closure transport, pinned NOW, mkdtemp files
4. Per exported function: happy path (deepEqual), gate/no-op case (called flag or ENOENT), failure case (thunk + message regex)
5. Concurrency behavior: measure with an inFlight/peak counter double; out-of-order completion with parked resolvers resolved last-first
6. Gates in order: `npm run typecheck` → `npm run lint` → `npm test`
</important if>

<important if="you are adding a fixture">
## Adding a Fixture
1. Trim a REAL capture; if the format allows comments, add the header (origin, date, drops, numbered edges) — for JSON, put provenance in the loading test's titles instead
2. Locate edges by id/pk in assertions, not by position; each numbered edge named in at least one it() title
3. Load via `import.meta.url` + `readFileSync` at module scope
4. Assert byte-real values; recompute derived expectations explicitly (`new Date(1792755976 * 1000).toISOString()`)
5. Prefer in-test mutation for variants; a second FILE only when shape, not content, differs
</important if>

<important if="you are adding a test for a scripts/hooks file">
## Adding a Test for a Hook Script
1. Black-box only: resolve the hook path via `fileURLToPath(new URL("../scripts/hooks/<name>.js", import.meta.url))`
2. Drive it with `spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), encoding: "utf8" })`
3. Pin the exit-code contract: gate → 2 denies (stderr names the rule), 0 allows, 0 on unreadable stdin; formatter → always 0
4. For side-effect hooks, content mutation is the honest observable (the hook sets stdio:"ignore" and ignores the child's exit)
5. Pre-create any file a hostile-path pin needs, or an earlier existsSync gate fires and the assertion passes vacuously
</important if>
