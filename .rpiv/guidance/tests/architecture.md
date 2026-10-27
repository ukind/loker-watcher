# tests/ — offline unit test suite

## Responsibility
Unit tests for the pure and seam-bearing stages of the pipeline. Zero network, zero browser, zero writes inside the repo. Run by `npm test` and by CI as the final gate.

## Dependencies
- **node:test + node:assert/strict** (run via tsx): the only runner/assertion stack — nodemailer contributes types only, for fake transports

## Consumers
- `npm test` (`tsx --test tests/*.test.ts`) — the glob picks up new files automatically; CI runs it as the last gate

## Module Structure
```
tests/<module>.test.ts   # canonical rule: one test file per src module, mirroring the name
tests/fixture/           # trimmed REAL captures (HTML/JSON) with documented injected edge cases
```
Grandfathered exception: `session.test.ts` → `threads-session.ts`. `judge.ts` and `state.ts` are covered by their own `judge.test.ts` / `state.test.ts`. Going forward: mirror 1:1 — a new src module gets its own test file.

## Minimal node:test skeleton
```typescript
import assert from "node:assert/strict";            // ALWAYS strict — never bare node:assert
import { describe, it } from "node:test";
import { filterRecent } from "../src/recency.js";   // .js extension on relative imports (NodeNext)
describe("filterRecent", () => {
  it("keeps posts inside the window and drops older ones", () => {
    assert.deepEqual(filterRecent(posts, 72, NOW).map((p) => p.id), ["1", "2"]);
  });
});
```
One describe per exported function; it titles read as behavior specifications.

## Doubles are literals with one double-cast (no mock libraries)
```typescript
let captured: unknown = null;
const mockTransport = {
  sendMail: async (options: unknown) => { captured = options; return { messageId: "msg-456" }; },
} as unknown as Transporter;
let calls = 0;
const mockFetch = async () => {
  calls += 1;
  return calls === 1 ? new Response("Bad Gateway", { status: 502 })
    : new Response(JSON.stringify({ choices: [{ message: { content: '{"relevant":true,"locationOk":true}' } }] }), { status: 200 });
};
await judgePost(post, config, ["frontend"], mockFetch as unknown as typeof fetch);
assert.equal(calls, 2);   // assert the RETRY happened, not just the outcome
```

## Env and time are parameters, never globals
```typescript
// src takes `env: Record<string, string | undefined> = process.env` — pass a literal:
assert.throws(() => resolveEmailConfig({}),
  /email: missing required environment variables: GMAIL_USER, GMAIL_APP_PASSWORD/);
// Clock: a fixed UTC instant + a relative factory; never Date.now(), never timer stubs
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const post = (id: string, hoursAgo: number): Post => ({
  id, text: `post ${id}`, author: "tester", permalink: `https://www.threads.com/@tester/post/${id}`,
  timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
});
```

## Temp files live in OS temp (lazy creation, after() cleanup)
```typescript
let dir: string | undefined;
after(async () => { if (dir !== undefined) await rm(dir, { recursive: true, force: true }); });
async function writeConfig(value: unknown): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-config-"));   // one shared dir per suite, created lazily
  const path = join(dir, "watcher.config.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}
// When src itself mkdtemps (resolveSession), the test just reads back the returned path — no after()
```

## Error messages are API (assert.rejects/throws with a thunk + regex)
```typescript
await assert.rejects(() => loadWatcherConfig(path), /unknown key "keyword"/);  // async: THUNK, not a bare promise
assert.throws(() => resolveJudgeConfig({}), /missing required environment variables/);
```
The regex matches the namespaced prefix + decisive phrase — messages may evolve, contracts don't.

## Fixtures are trimmed real captures with documented edges
```typescript
// tests/fixture/tag-page.html header comment: origin, capture date, what was dropped,
// and every injected defect — "Edge 4 = duplicate of edge 1 (dedupe test)"
const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixture", "tag-page.html"), "utf8");
// Variants: mutate the loaded string in-test instead of shipping a second file
const noisy = fixture.replace("</head>", '<script type="application/json" data-sjs="">{"broken": </script></head>');
assert.deepEqual(extractPosts(noisy), extractPosts(fixture));
```

## Architectural Boundaries
- **Offline-only**: SMTP, LLM, and browser boundaries are faked via injection — never patched globals, never real endpoints
- **Never touch `process.env` or repo files**: writes go to OS temp only
- **No console stubbing**: warn-path stderr noise is tolerated; assert return values and captured mail
- **Secrets are synthesized** (`value: "x"`), never real

<important if="you are adding a test for a new src module">
## Adding a Test for a New src Module
1. File: `tests/<module>.test.ts` (mirror the name); skeleton imports as above
2. Find the injection seam in src — if the boundary is not injectable, add the optional parameter to src first
3. Build doubles per boundary: env literal, Response-based fetch, capture-closure transport, pinned NOW, mkdtemp files
4. Per exported function: happy path (deepEqual), gate/no-op case (`called` flag), failure case (thunk + message regex)
5. Gates in order: `npm run typecheck` → `npm run lint` → `npm test`
</important if>

<important if="you are adding a fixture">
## Adding a Fixture
1. Prefer a trimmed REAL capture; the header comment states origin, date, drops, and every numbered edge
2. Locate edges by id/pk in assertions, not by position
3. Load via `import.meta.url` + `readFileSync` at module scope
4. Assert byte-real values; recompute derived expectations explicitly (`new Date(1792755976 * 1000).toISOString()`)
5. If the fixture contains post texts, make sure they still agree with the shipped `watcher.config.json`
</important if>