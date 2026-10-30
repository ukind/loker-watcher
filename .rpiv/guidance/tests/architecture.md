# tests/ — offline unit test suite

## Responsibility
Full-pipeline offline verification of src/ via `node:test` + `tsx` (`tsx --test tests/*.test.ts`). Zero network, zero browser, zero writes inside the repo, zero mocking libraries — every double is a hand-written literal.

## Dependencies
- **node:test + node:assert/strict**, run via tsx — the only runner/assertion stack
- nodemailer contributes types only (fake transports); Playwright is never imported at test time

## Consumers
- `npm test` — the `tests/*.test.ts` glob picks up new files automatically; CI runs it as the final gate
- watch.yml does NOT run tests — the suite is a merge gate, not a production check

## Coverage map (the 1:1 mirror rule, today)
```
config.ts          — no test (names/paths/kill switch; the "false" branch is covered via index.test.ts)
config-file.ts     → config-file.test.ts
email.ts           → email.test.ts
extract.ts         → extract.test.ts         # fixture-driven: tests/fixture/tag-page.html, graphql-response.json
fetch-threads.ts   → fetch-threads.test.ts   # structural PageLike/ContextLike doubles
heartbeat.ts       → heartbeat.test.ts
index.ts           → index.test.ts           # full offline runWatcher runs via WatcherDeps doubles
judge.ts           → judge.test.ts           # residual: env parsing, pools/pipeline, payload pins
judge-parse.ts     → judge-parse.test.ts     # verdict parsers — pure string-in/string-out
judge-rotation.ts  → judge-rotation.test.ts  # cooldown, park budget, exhaustion suites
judge-helpers.ts   — no test (shared pure fixtures; not *.test.ts, never executed)
recency.ts         → recency.test.ts
state.ts           → state.test.ts           # v2 schema, migration, prune, atomic write
threads-session.ts → session.test.ts         # GRANDFATHERED name drift — new files mirror <module>.test.ts
types.ts           — no test (pure types)
```

## File skeleton (strict assert; .js specifiers; titles are behavior specs)
```typescript
import assert from "node:assert/strict";          // ALWAYS strict — never bare node:assert
import { after, describe, it } from "node:test";  // after only when files are written
import { filterRecent } from "../src/recency.js"; // .js extension REQUIRED (NodeNext)
describe("filterRecent", () => {
  it("keeps posts inside the window and drops older ones", () => { /* ... */ });
});
```

## Doubles are literals; BOTH idioms are acceptable (developer-confirmed)
```typescript
// Idiom A — inline literal, capture in a closure (email/heartbeat suites):
let captured: unknown = null;
const mockTransport = { sendMail: async (o: unknown) => { captured = o; return { messageId: "m1" }; },
} as unknown as Transporter;                        // exactly ONE double-cast, at construction
// Idiom B — named factory returning double + capture list (index/fetch-threads suites):
function recordingTransport() {
  const subjects: string[] = [];                    // the closure IS the test oracle
  const transport = { sendMail: async (o: { subject: string }) => { subjects.push(o.subject); return { messageId: "x" }; },
  } as unknown as Transporter;
  return { transport, subjects };
}
// mockFetch returns real Response objects; branch on request CONTENT (prompt token, URL host),
// never on call order — pool workers claim work at microtask boundaries, so order is nondeterministic.
```

## Clock and env are parameters — pinned, never ambient
```typescript
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);        // month is 0-based; never Date.now()
await runWatcher({ env: BASE_ENV, now: () => NOW, /* ... */ });   // env literal, not process.env
// Structured env values inline: LLM_ACCOUNTS: JSON.stringify([...]); secrets as Buffer base64 literals.
// The one Date.now() exception: a deliberate elapsed-time assertion with a message (the 429 "no backoff wait"
// test, tests/judge-rotation.test.ts).
```

## Temp files: lazy mkdtemp, one after() cleanup, byte-identity assertions
```typescript
let dir: string | undefined;                        // undefined = no test needed a dir yet
after(async () => { if (dir !== undefined) await rm(dir, { recursive: true, force: true }); });
async function tempStatePath(name: string, seed?: AppState): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));   // prefix per suite: lw-config-, lw-state-, lw-index-
  return join(dir, name);                               // optional seed written by the caller
}
// Absence: await assert.rejects(() => readFile(path, "utf8"), /ENOENT/) — proves no write happened.
// Gate 1 contract: read before, save, read after — byte-identical IS the assertion.
```

## Error messages are API (thunk + regex; validator form; domain predicates)
```typescript
await assert.rejects(() => loadWatcherConfig(p), /unknown key "keyword"/);   // async: THUNK, not a bare promise
await assert.rejects(() => writeStateAtomic(STATE, dirTarget), (error: unknown) => {
  assert.match((error as Error).message, /^state: atomic write failed for /); return true;   // multi-part: return true
});
await assert.rejects(() => judgePost(/* pool 429s out */), (e: unknown) => isRotationExhausted(e));   // tagged errors
// Regexes pin the discriminating fragment (/LLM_ACCOUNTS[0].model/), never whole sentences.
```

## Fixtures: trimmed real captures, numbered edges, mutation variants
```typescript
// tests/fixture/tag-page.html header: origin, date, trim policy, every planted edge —
// "Edge 4 = duplicate of edge 1 (dedupe); Edge 5 missing code (pk→shortcode); Edge 6 missing caption (drop)."
const fixture = readFileSync(join(here, "fixture", "tag-page.html"), "utf8");   // via import.meta.url, never cwd
const noisy = fixture.replace("</head>", '<script type="application/json" data-sjs="">{"broken": </script></head>');
assert.deepEqual(extractPosts(noisy), extractPosts(fixture));   // variants by MUTATION; tolerance = equivalence
```

## Architectural Boundaries
- **Offline only**: browser/SMTP/LLM faked via injection; importing src never loads Playwright (dynamic import)
- **Never touch `process.env` or repo files** — writes go to OS temp only; console access is call-through spies only (`t.mock.method(console, "log"/"warn", console.log.bind(console))` — F014 walk-log discrimination), never a silencing stub
- **No mock libraries**; the ONE shared-helpers exception is `tests/judge-helpers.ts` (six pure fixtures — KEYWORDS, singleAccount, ok, id19, bulkPost, bulkContent; doubles and mock-fetch factories stay per-suite); full-pipeline oracles are layered: `WatcherRun` → disk state → captured subjects

<important if="you are adding a test for a new src module">
## Adding a Test for a New src Module
1. File: `tests/<module>.test.ts` (mirror the name); skeleton imports as above
2. Find the injection seam in src — if the boundary is not injectable, add the optional trailing parameter to src FIRST
3. Build doubles per boundary: env literal, Response-based mockFetch, capture-closure transport, pinned NOW, mkdtemp files
4. Per exported function: happy path (deepEqual), gate/no-op case (called flag or ENOENT), failure case (thunk + message regex)
5. Concurrency behavior: measure with an inFlight/peak counter double; out-of-order completion with parked resolvers resolved last-first
6. Gates in order: `npm run typecheck` → `npm run lint` → `npm test`
</important if>

<important if="you are adding a fixture">
## Adding a Fixture
1. Trim a REAL capture; the header comment states origin, date, drops, and every numbered edge
2. Locate edges by id/pk in assertions, not by position; each numbered edge named in at least one it() title
3. Load via `import.meta.url` + `readFileSync` at module scope
4. Assert byte-real values; recompute derived expectations explicitly (`new Date(1792755976 * 1000).toISOString()`)
5. Prefer in-test mutation for variants; a second FILE only when shape, not content, differs
6. Post texts must still agree with the shipped `watcher.config.json` keywords
</important if>
