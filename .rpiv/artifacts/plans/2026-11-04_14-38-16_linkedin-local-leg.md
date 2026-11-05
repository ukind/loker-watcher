---
date: 2026-11-04T14:38:16+0700
author: Yogiswara Utama
commit: 4c11e0f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn leg on the local PC"
tags: [plan, linkedin, voyager-graphql, curl-impersonate, playwright, local-loop, payload-handoff, sdk-removal, login-helper]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md"
phase_count: 8
phases:
  - { n: 1, title: "Voyager client core (pure)", files: ["src/linkedin-voyager.ts", "tests/linkedin-voyager.test.ts", "tests/fixture/voyager-search-response.json"], depends_on: [] }
  - { n: 2, title: "Session cookies module", files: ["src/linkedin-session.ts", "tests/linkedin-session.test.ts", "src/config.ts"], depends_on: [1] }
  - { n: 3, title: "Fetch module — transport adapters, fault classification, runPool walk", files: ["src/linkedin-fetch.ts", "tests/linkedin-fetch.test.ts", "src/config.ts"], depends_on: [2] }
  - { n: 4, title: "Payload + PC scripts + alarm + wiring", files: ["src/linkedin-payload.ts", "tests/linkedin-payload.test.ts", "scripts/fetch-linkedin.ts", "tests/fetch-linkedin.test.ts", "scripts/watch-linkedin.ts", "scripts/probe-linkedin.ts", "src/email.ts", "src/config.ts", "package.json"], depends_on: [3] }
  - { n: 5, title: "Watch-side ingest re-key", files: ["src/index.ts", "tests/index.test.ts", "src/heartbeat.ts", "tests/heartbeat.test.ts"], depends_on: [4] }
  - { n: 6, title: "SDK removal + residue sweep + docs", files: ["src/fetch-linkedin-api.ts", "tests/fetch-linkedin-api.test.ts", "src/config.ts", "src/config-file.ts", "src/threads-session.ts", "src/judge.ts", "src/linkedin-voyager.ts", "tests/config-file.test.ts", ".github/workflows/watch.yml", "README.md", "AGENTS.md", ".gitignore", "package.json", "package-lock.json", ".rpiv/guidance/architecture.md", ".rpiv/guidance/src/architecture.md", ".rpiv/guidance/.github/workflows/architecture.md", ".rpiv/guidance/tests/architecture.md", ".rpiv/guidance/scripts/architecture.md"], depends_on: [5] }
  - { n: 7, title: "Login helper + auto-env (less-manual cookie setup)", files: ["src/env-file.ts", "tests/env-file.test.ts", "scripts/login-linkedin.ts", "tests/login-linkedin.test.ts", "src/linkedin-session.ts", "scripts/probe-linkedin.ts", "scripts/fetch-linkedin.ts", "scripts/watch-linkedin.ts", "package.json", "README.md", "AGENTS.md", ".rpiv/guidance/src/architecture.md", ".rpiv/guidance/scripts/architecture.md", ".rpiv/guidance/tests/architecture.md"], depends_on: [6] }
  - { n: 8, title: "Leg-dead classifier amendment + empty-payload guard", files: ["src/linkedin-fetch.ts", "tests/linkedin-fetch.test.ts", "scripts/fetch-linkedin.ts", "tests/fetch-linkedin.test.ts", ".rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md"], depends_on: [4] }
last_updated: 2026-11-05T10:27:36+0700
last_updated_by: pi (rpiv revise)
last_updated_note: "Phase 8 added: validate blockers b1+b2 — 3xx redirect loops classify leg-dead (maxRedirects 0 unifies the playwright path), an all-faulted walk throws AllSurfacesFaulted and the tick writes no payload"
---

# LinkedIn leg on the local PC — Implementation Plan

## Overview

The LinkedIn fetch leg moves off GitHub Actions onto the developer's PC as an always-on local npm loop (`npm run watch-linkedin`, 10-minute sleep in code). Each tick drives the voyager search endpoint documented in `linkedin-reverse/DOCUMENTATION.md` through a `VoyagerGet` transport seam — curl-impersonate (primary) and Playwright chromium (fallback), both fed from one local cookie file — writes fetched raw posts atomically to `state/linkedin-posts.json`, and pushes that single path to the repo. The hosted watch run reads the payload at the existing dedupe seam; the Linked API SDK quad is removed. Judge, email-digest, heartbeat, threads, and seen-state machinery are untouched.

All architectural decisions are settled in the design artifact (`.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md`, decisions D1-D13): this plan inherits its six slice boundaries 1:1, passes its gate-proven code fences through unchanged, and passes its Success Criteria through verbatim.

Phase 7 (added 2026-11-05, operator feedback: `npm run probe-linkedin` failed on an unset `LINKEDIN_COOKIES_FILE` and the goal is the least manual setup) extends past the design's six slices: a headed login helper (`npm run login-linkedin`) and `.env` auto-load (`src/env-file.ts`) remove the devtools export and the env-var step. The helper is NOT the deleted headless credential login (f571904, removed in bf6594c): the operator performs the login in a real browser window; the script only harvests the resulting cookie pair (DOCUMENTATION.md §2.4 verified interactive login — the lowest account-flag risk).

Phase 8 (added 2026-11-05, validate gate: `.rpiv/artifacts/validation/2026-11-05_10-01-36_linkedin-local-leg.md`, blockers b1+b2) amends the fault policy on live-rehearsed evidence: the voyager endpoint answers a shape-valid DEAD session with a **302 redirect loop** — curl surfaces `302` directly, Playwright follows 20 redirects then throws — which `classifyFault` filed under the generic-fault fall-through, so the tick skipped every surface and `fetchTick` pushed an EMPTY payload over the last good one (hosted reader: `leg: "ok"`, zero posts, dead leg invisible). DOCUMENTATION.md §13.1 claims only browser navigations redirect; live observation contradicts it for this client stack, and root cause (session death vs edge-level fingerprint blocking) is deliberately unresolved — both carry the same operator remedy, so the classification does not depend on it.

## Desired End State

Operator flow on the PC (from the repo folder):

```
# one-time: log in by hand in a real browser window; the helper writes
# the cookie file AND the .env line (Phase 7)
npm run login-linkedin

# prove the transport (twice, >=6h apart)
npm run probe-linkedin
#   probe: transport curl — GET voyager/api/graphql — 200 OK — 10 post(s)
#   probe: all checks passed

# start the leg; leave the console open
npm run watch-linkedin
#   fetch: linkedin/#hiring react page 0 — 50 post(s)
#   ...
#   payload: wrote 312 post(s) — state/linkedin-posts.json
#   git: pushed state commit (1 file)
```

Hosted side unchanged: the */10 cron runs, reads `state/linkedin-posts.json` from its checkout, merges new urns at `dedupePosts`, judges, and the digest email carries `[linkedin]` rows exactly as before. PC off → payload goes stale → one log line → threads-only green runs → heartbeat as designed. Session dies → ONE alarm email, loop keeps running, refresh the cookie file and the next tick heals.

## What We're NOT Doing

- No runner agent, no new workflow, no artifact upload/download, no dispatch plumbing.
- No gist/storage third service (developer chose repo push).
- No automated re-login / UAS credential flow (2FA dead-end, live-confirmed). Phase 7's login helper stays on the safe side of this line: a headed browser the OPERATOR logs into by hand; the script only harvests the resulting cookie pair (DOCUMENTATION.md §2.4 verified interactive login).
- No Task Scheduler setup (developer chose the always-on console loop).
- No judge, email-digest, heartbeat, threads, or seen-state changes; `watcher.config.json` surfaces unchanged.
- No transport auto-fallback in code — switching `curl` → `playwright` is an operator action after a failed probe. Phase 8's redirect-loop classification is fault POLICY, not a transport switch: a dead leg aborts the tick; it never silently swaps adapters.
- No Pi/mini-PC migration work (config-only later).

---

## Phase 1: Voyager client core (pure)

### Overview

The offline-testable heart of the leg: endpoint constants, restli encoding, the §12.7 canonical search-URL builder, and the §6 response parser — transcribed from `linkedin-reverse/DOCUMENTATION.md` verbatim with provenance comments. No I/O: transport arrives in Phase 3 and cookies in Phase 2, so this module stays offline-testable by design.

### Changes Required:

#### 1. Voyager client core
**File**: `src/linkedin-voyager.ts` (NEW)
**Changes**: Constants (endpoint, queryId, queryName, static header set), restli value encoder (§4.1 reserved chars + §12.5 URL-layer escapes incl. `#`→`%23`), §12.7 search-URL builder, `BigInt(id) >> 22n` timestamp derivation with the §12.4 drift caveat, §6 response parser producing `Post[]` with drop+count. Never throws; unparsable bodies surface as `{kind: "unparsable"}`.

```ts
/**
 * Pure voyager search client core — endpoint, encoding, response walk.
 *
 * SPEC OF RECORD: H:/fork/linkedin-reverse/DOCUMENTATION.md (§3 request,
 * §4.1 restli grammar, §12.5 verified escaping matrix, §12.7 canonical
 * latest-posts recipe, §6 response walk). Constants are transcribed from
 * the documentation verbatim — never from a capture-observed URL
 * (developer lock 2026-11-04: captured endpoints carry session-specific
 * params and drift). No I/O lives here: the transport arrives in slice 3
 * and cookies in slice 2; this module stays offline-testable by design.
 */
import type { Post } from "./types.js";

/**
 * §3 — the only host+path this client may talk to. All voyager APIs live
 * under /voyager/api/ (§1, Routes.buildUponRoot proven).
 */
export const VOYAGER_GRAPHQL_ENDPOINT = "https://www.linkedin.com/voyager/api/graphql";

/**
 * §3.1 — the posts finder hash, PROVEN from SearchGraphQLClient's static
 * map and VERIFIED live 2026-11-03 against APK 4.1.1267. The registered
 * variant 75dbd5da… is an entity-cluster variant useless for posts
 * (§12.6). A sudden 500 where 200s used to be means the hash expired
 * server-side (§15) — re-derive from a current APK; do not debug variables.
 */
export const VOYAGER_QUERY_ID = "voyagerSearchDashClusters.c2c5d4b012c05a6a94396191208d45f6";

/** §3 — the queryName paired with VOYAGER_QUERY_ID. */
export const VOYAGER_QUERY_NAME = "SearchClusterCollection";

/**
 * §3 static header set. The cookie pair and the per-request csrf-token
 * header (JSESSIONID value, quotes stripped) ride the session module
 * (slice 2). Per-line provenance: x-restli-protocol-version 2.0.0 (§3);
 * x-li-graphql-pegasus-client true (§3); x-li-lang en_US (§3); accept
 * application/json PLAIN — the normalized+json accept returns HTTP 500,
 * "A record in the included list does not have a type" (§7.2 gotcha 2).
 */
export const VOYAGER_STATIC_HEADERS: Readonly<Record<string, string>> = {
  "x-restli-protocol-version": "2.0.0",
  "x-li-graphql-pegasus-client": "true",
  "x-li-lang": "en_US",
  accept: "application/json",
};

/**
 * Reserved restli characters inside string values (§4.1,
 * DataCodecConstants.RESERVED_CHARS). Escaped as uppercase %HH before the
 * URL layer runs; outside string values they ARE the record/map structure.
 */
const RESTLI_RESERVED = new Set(["(", ")", ":", ",", "'"]);

/**
 * Encode one restli string value (§4.1 + §12.5 verified matrix): reserved
 * `( ) : , '` → uppercase %HH inside the value; then the URL layer's
 * space → %20, ampersand → %26, hash → %23 — a raw `#` starts the URL
 * fragment and silently truncates the GET query, and every configured
 * keyword starts with one (watcher.config.json). Plain JSON variables
 * always 400 (§7.1); restli text plus these escapes is the wire format.
 */
export function encodeRestliValue(value: string): string {
  let out = "";
  for (const char of value) {
    if (RESTLI_RESERVED.has(char)) {
      out += `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
    } else if (char === " ") {
      out += "%20";
    } else if (char === "&") {
      out += "%26";
    } else if (char === "#") {
      out += "%23";
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Build the restli `variables` value for one page of the canonical
 * latest-posts recipe (§12.7): resultType CONTENT (posts only), datePosted
 * past-24h, sortBy date_posted — the REAL recency switch (§12.4 CRITICAL:
 * orderBy is ignored byte-identically by this finder, so it is omitted).
 * Variable set exactly per §5.3: query, origin, start, count (no
 * paginationToken — never exercised live).
 */
export function encodeSearchVariables(keywords: string, start: number, count: number): string {
  const kw = encodeRestliValue(keywords);
  return `(query:(keywords:${kw},flagshipSearchIntent:SEARCH_SRP,queryParameters:(resultType:CONTENT,datePosted:past-24h,sortBy:date_posted)),origin:GLOBAL_SEARCH_HEADER,start:${start},count:${count})`;
}

/** §3/§12.7 — the complete GET URL: endpoint, queryId, queryName, variables. */
export function buildSearchUrl(keywords: string, start: number, count: number): string {
  return (
    `${VOYAGER_GRAPHQL_ENDPOINT}` +
    `?queryId=${VOYAGER_QUERY_ID}` +
    `&queryName=${VOYAGER_QUERY_NAME}` +
    `&variables=${encodeSearchVariables(keywords, start, count)}`
  );
}

const ACTIVITY_URN_RE = /^urn:li:activity:(\d+)$/;

/**
 * Derive the post time from the activity id: strip the low 22 shard bits,
 * the rest is epoch ms — the exact inverse of tests/index.test.ts:93's
 * forward trick. PROVENANCE (live capture 2026-11-03): the response does
 * NOT carry a timestamp field; derivation drifts 4-6 minutes against the
 * post's own age label, and reposts mint ids that are not strict creation
 * clocks (§12.4). Good enough for the 72h recency window; never for
 * ordering.
 */
export function timestampFromActivityId(urn: string): string | null {
  const match = ACTIVITY_URN_RE.exec(urn);
  if (match === null) return null;
  const id = match[1] ?? "";
  try {
    const ms = BigInt(id) >> 22n;
    if (ms <= 0n) return null;
    return new Date(Number(ms)).toISOString();
  } catch {
    return null;
  }
}

/** Tracking params (utm_*, rcm) ride every shareUrl — keep the canonical path only. */
function stripUrlQuery(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readPath(node: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = node;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export type ParseResult =
  | { kind: "ok"; posts: Post[]; dropped: number }
  | { kind: "unparsable"; reason: string };

/**
 * Parse one 200 search response body (§6 walk):
 * data.searchDashClustersByAll.elements[].items[].item.searchFeedUpdate.update.
 * Only rows carrying searchFeedUpdate count as posts; header/feedback
 * clusters are structural and ignored. A row missing any required fact is
 * dropped and counted — one
 * malformed row must never poison seen-state or burn a judge attempt.
 * Unparsable bodies surface as kind "unparsable" for the walk's fault
 * policy (slice 3); this parser never throws. metadata.totalResultCount
 * is deliberately never read (§12.1: it fluctuates 481-492 call-to-call).
 */
export function parseSearchResponse(body: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return { kind: "unparsable", reason: error instanceof Error ? error.message : String(error) };
  }
  const rows = readPostRows(parsed);
  const posts: Post[] = [];
  let dropped = 0;
  for (const update of rows) {
    const post = mapUpdate(update);
    if (post === null) {
      dropped += 1;
      continue;
    }
    posts.push(post);
  }
  return { kind: "ok", posts, dropped };
}

function readPostRows(parsed: unknown): Record<string, unknown>[] {
  const root = parsed as {
    data?: { searchDashClustersByAll?: { elements?: unknown } };
  };
  const elements = root.data?.searchDashClustersByAll?.elements;
  if (!Array.isArray(elements)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const element of elements) {
    const items = (element as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const update = (item as { item?: { searchFeedUpdate?: { update?: unknown } } }).item
        ?.searchFeedUpdate?.update;
      if (update !== null && typeof update === "object") {
        rows.push(update as Record<string, unknown>);
      }
    }
  }
  return rows;
}

function mapUpdate(update: Record<string, unknown>): Post | null {
  const backendUrn = readText(readPath(update, ["metadata", "backendUrn"]));
  if (backendUrn === null) return null;
  const text = readText(readPath(update, ["commentary", "text", "text"]));
  if (text === null) return null;
  const author = readText(readPath(update, ["actor", "name", "text"]));
  if (author === null) return null;
  const shareUrl = readText(readPath(update, ["socialContent", "shareUrl"]));
  if (shareUrl === null) return null;
  const timestamp = timestampFromActivityId(backendUrn);
  if (timestamp === null) return null;
  return {
    platform: "linkedin",
    id: backendUrn,
    text,
    author,
    permalink: stripUrlQuery(shareUrl),
    timestamp,
  };
}
```

#### 2. Offline suite for the voyager core
**File**: `tests/linkedin-voyager.test.ts` (NEW)
**Changes**: §12.5 escaping matrix (6 exact-string rows incl. `#`→`%23`), §12.7 byte-for-byte URL snapshot + orderBy-absent pin, timestamp derivation (3 rows, incl. the `tests/index.test.ts:93` inverse), parser over the scrubbed fixture (4 pinned edges + exhaustion deepEqual + unparsable). Fixture provenance lives in the suite header comment and the loading test's title.

```ts
/**
 * Offline suite for the pure voyager client core (slice 1).
 *
 * FIXTURE PROVENANCE: tests/fixture/voyager-search-response.json is a
 * trimmed, scrubbed copy of the 2026-11-03 live capture
 * (.rpiv/tmp/voyager-capture.json — curl probe, keywords "#hiring react",
 * datePosted past-24h, start 0, count 5, HTTP 200). Masking policy: author
 * names genericized, company/member urn digits and rcm tracking values
 * masked, post texts truncated at 200 chars; activity ids kept VERBATIM so
 * the timestamp-derivation edge stays real. JSON carries no comments —
 * this header and the test titles are the provenance record. Pinned
 * edges: (1) header cluster ignored, (2) feedback card ignored, (3) two
 * valid posts mapped through the §6 walk, (4) one malformed row dropped
 * and counted.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  VOYAGER_GRAPHQL_ENDPOINT,
  VOYAGER_QUERY_ID,
  VOYAGER_QUERY_NAME,
  buildSearchUrl,
  encodeRestliValue,
  encodeSearchVariables,
  parseSearchResponse,
  timestampFromActivityId,
} from "../src/linkedin-voyager.js";
import type { Post } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixture", "voyager-search-response.json"), "utf8");

describe("encodeRestliValue", () => {
  it("escapes the §12.5 matrix: comma + space", () => {
    assert.equal(encodeRestliValue("hiring react, remote"), "hiring%20react%2C%20remote");
  });

  it("escapes parens (§12.5)", () => {
    assert.equal(encodeRestliValue("hiring (react)"), "hiring%20%28react%29");
  });

  it("escapes colons (§12.5)", () => {
    assert.equal(encodeRestliValue("hiring: react"), "hiring%3A%20react");
  });

  it("escapes ampersands at the URL layer (§12.5)", () => {
    assert.equal(encodeRestliValue("hiring & react"), "hiring%20%26%20react");
  });

  it("escapes single quotes (phrase keywords, §12.5)", () => {
    assert.equal(encodeRestliValue("'hiring react'"), "%27hiring%20react%27");
  });

  it("encodes # at the URL layer — a raw # truncates the GET query (live capture)", () => {
    assert.equal(encodeRestliValue("#hiring"), "%23hiring");
  });
});

describe("buildSearchUrl", () => {
  it("reproduces the §12.7 canonical latest-posts URL byte-for-byte", () => {
    assert.equal(
      buildSearchUrl("#hiring react", 0, 50),
      `${VOYAGER_GRAPHQL_ENDPOINT}?queryId=${VOYAGER_QUERY_ID}&queryName=${VOYAGER_QUERY_NAME}&variables=(query:(keywords:%23hiring%20react,flagshipSearchIntent:SEARCH_SRP,queryParameters:(resultType:CONTENT,datePosted:past-24h,sortBy:date_posted)),origin:GLOBAL_SEARCH_HEADER,start:0,count:50)`,
    );
  });

  it("omits orderBy entirely (§12.4: ignored; sortBy:date_posted is the real switch)", () => {
    const variables = encodeSearchVariables("#hiring", 25, 50);
    assert.ok(!variables.includes("orderBy"));
    assert.ok(variables.includes("sortBy:date_posted"));
    assert.ok(variables.includes("start:25"));
    assert.ok(variables.includes("count:50"));
  });
});

describe("timestampFromActivityId", () => {
  it("derives epoch ms from the activity id (low 22 bits stripped)", () => {
    const id = "7523281949587681280";
    const expected = new Date(Number(BigInt(id) >> 22n)).toISOString();
    assert.equal(timestampFromActivityId(`urn:li:activity:${id}`), expected);
  });

  it("inverts the tests/index.test.ts:93 forward trick", () => {
    const ms = Date.UTC(2026, 9, 26, 9, 14, 0);
    const id = (BigInt(ms) << 22n).toString();
    assert.equal(timestampFromActivityId(`urn:li:activity:${id}`), new Date(ms).toISOString());
  });

  it("rejects non-activity urns and non-urn strings", () => {
    assert.equal(timestampFromActivityId("urn:li:share:123456789"), null);
    assert.equal(timestampFromActivityId("not-a-urn"), null);
  });
});

describe("parseSearchResponse", () => {
  const result = parseSearchResponse(fixture);

  it("parses the scrubbed 2026-11-03 live capture (edges 1-4 pinned below)", () => {
    assert.equal(result.kind, "ok");
  });

  it("maps the two valid posts through the §6 walk (edge 3)", () => {
    assert.ok(result.kind === "ok");
    assert.equal(result.posts.length, 2);
    const first = result.posts[0] as Post;
    assert.equal(first.platform, "linkedin");
    assert.equal(first.id, "urn:li:activity:7523281949587681280");
    assert.match(first.text, /^#hiring Technology Manager/);
    assert.equal(first.author, "Author One");
    assert.equal(
      first.permalink,
      "https://www.linkedin.com/posts/member-handle_httpsjobsrminecomjobnltechnology-manager-activity-7523281949587681280-5dUC",
    );
    assert.equal(first.timestamp, timestampFromActivityId(first.id));
  });

  it("ignores the header and feedback clusters (edges 1-2)", () => {
    assert.ok(result.kind === "ok");
    assert.ok(result.posts.every((post) => post.author !== "243 results"));
    assert.ok(result.posts.every((post) => post.id.startsWith("urn:li:activity:")));
  });

  it("drops the malformed row and counts it (edge 4)", () => {
    assert.ok(result.kind === "ok");
    assert.equal(result.dropped, 1);
    assert.ok(result.posts.every((post) => post.id !== "urn:li:activity:7523282112511242241"));
  });

  it("never reads metadata.totalResultCount (§12.1: it fluctuates 481-492)", () => {
    const noMeta = parseSearchResponse(
      JSON.stringify({ data: { searchDashClustersByAll: { elements: [] } }, included: [] }),
    );
    assert.deepEqual(noMeta, { kind: "ok", posts: [], dropped: 0 });
  });

  it("maps an exhausted page (elements: []) to ok with zero posts (§12.8 terminal signal)", () => {
    const exhausted = parseSearchResponse(
      JSON.stringify({ data: { searchDashClustersByAll: { elements: [] } }, included: [] }),
    );
    assert.deepEqual(exhausted, { kind: "ok", posts: [], dropped: 0 });
  });

  it("surfaces unparsable bodies without throwing", () => {
    const bad = parseSearchResponse("<html>challenge</html>");
    assert.equal(bad.kind, "unparsable");
  });
});
```

#### 3. Scrubbed live-capture fixture
**File**: `tests/fixture/voyager-search-response.json` (NEW)
**Changes**: Trimmed, scrubbed live capture (source `.rpiv/tmp/voyager-capture.json`, body-only, member handles genericized, urn digits preserved for timestamp tests). Final form: 2-space indent, ~3.4 KB, scrub grep 0 hits. JSON carries no comments — provenance lives in the loading test's header + titles.

```json
{
  "data": {
    "searchDashClustersByAll": {
      "metadata": {
        "totalResultCount": 243
      },
      "elements": [
        {
          "items": [
            {
              "item": {
                "simpleTextV2": {
                  "text": {
                    "text": "243 results"
                  }
                }
              }
            },
            {
              "item": {
                "feedbackCard": {
                  "text": {
                    "text": "Send feedback"
                  }
                }
              }
            }
          ]
        },
        {
          "items": [
            {
              "item": {
                "searchFeedUpdate": {
                  "update": {
                    "metadata": {
                      "backendUrn": "urn:li:activity:7523281949587681280",
                      "detailPageType": "FEED_DETAIL"
                    },
                    "commentary": {
                      "text": {
                        "text": "#hiring Technology Manager\n\nApply here: https://lnkd.in/gP8G6G2N\n\nReady for a challenge?   Then Just Eat might be the place for you. Were a leading global online delivery platform, and our vision is…"
                      }
                    },
                    "actor": {
                      "name": {
                        "text": "Author One"
                      },
                      "backendUrn": "urn:li:company:100000"
                    },
                    "socialContent": {
                      "shareUrl": "https://www.linkedin.com/posts/member-handle_httpsjobsrminecomjobnltechnology-manager-activity-7523281949587681280-5dUC?utm_source=social_share_send&utm_medium=member_desktop_web&rcm=MASKED"
                    }
                  }
                }
              }
            },
            {
              "item": {
                "searchFeedUpdate": {
                  "update": {
                    "metadata": {
                      "backendUrn": "urn:li:activity:7523282112511242240",
                      "detailPageType": "FEED_DETAIL"
                    },
                    "commentary": {
                      "text": {
                        "text": "🚨 Hiring: Senior Software Engineer | Hyderabad 🚨\nAre you a passionate Java Developer looking to work on enterprise-scale applications and modern technologies? We're hiring experienced professionals…"
                      }
                    },
                    "actor": {
                      "name": {
                        "text": "Author Two"
                      },
                      "backendUrn": "urn:li:member:200000"
                    },
                    "socialContent": {
                      "shareUrl": "https://www.linkedin.com/posts/member-handle_hiring-javadeveloper-mulesoft-activity-7523282112511242240-7NFk?utm_source=social_share_send&utm_medium=member_desktop_web&rcm=MASKED"
                    }
                  }
                }
              }
            },
            {
              "item": {
                "searchFeedUpdate": {
                  "update": {
                    "metadata": {
                      "backendUrn": "urn:li:activity:7523282112511242241"
                    }
                  }
                }
              }
            }
          ]
        }
      ]
    }
  },
  "included": []
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test` — new suite green, rest untouched
- [x] §12.5 escaping matrix rows asserted: comma, parens, colon, ampersand, single-quote, plus `#`→`%23`
- [x] `buildSearchUrl` equals the §12.7 canonical URL byte-for-byte for ("#hiring react", 0, 50)
- [x] Fixture parse: 2 posts mapped, 1 dropped, structural clusters ignored, permalink query-stripped, timestamps = `BigInt(id)>>22n` ISO
- [x] Fixture scrub: `grep -aiE "li_at|jsessionid|cookie|authorization|csrf" tests/fixture/voyager-search-response.json` returns 0 hits

#### Manual Verification:
- [x] Fixture provenance recorded in the loading test's header comment (origin capture, date, mask policy)
- [ ] One encoded URL spot-checked against DOCUMENTATION.md §4.2 worked example by eye

---

## Phase 2: Session cookies module

### Overview

The D4 fail-visible cookie-file resolver: `LINKEDIN_COOKIES_FILE` points at a JSON pair exported interactively from a logged-in browser (outside the repo); every rejection message names the variable. The quote asymmetry is canonicalized once on resolve and re-applied at the two build sites — Cookie header keeps `JSESSIONID` quoted and last (§10/§14.5), `csrf-token` strips quotes (§3), and the storageState re-quotes for the Phase 3 Playwright adapter. `ENV_NAMES` gains exactly one name this slice.

### Changes Required:

#### 1. Cookie-file session module
**File**: `src/linkedin-session.ts` (NEW)
**Changes**: `LinkedInCookies` interface (canonical `jsessionId`, quotes stripped); `resolveLinkedInCookies(env)` — fail-visible read + validation (unset/blank/unreadable/missing-file/malformed-JSON/missing-field all throw naming `LINKEDIN_COOKIES_FILE`); `buildCookieHeader` (li_at first unquoted, JSESSIONID last quoted); `csrfToken` (quote-stripped); `toStorageState` for the Phase 3 Playwright adapter. Reopened at the 2026-11-04 slice-3 checkpoint (compiler/biome-forced, behavior-identical; suite green in the combined 61-test scratch run).

```ts
/**
 * LinkedIn session material for the local voyager leg (design D4).
 *
 * One cookie file OUTSIDE the repo — exported interactively from a
 * logged-in browser (DOCUMENTATION.md §2.4 VERIFIED; 2FA dead-ends headless
 * login, so no automated re-login exists) — resolves to every shape the
 * leg needs:
 *
 * - resolveLinkedInCookies: fail-visible read + validation. The leg has no
 *   reason to exist without a session, so this is stricter than the
 *   silent-null Threads model (resolveSession in src/threads-session.ts).
 * - buildCookieHeader: the voyager GET's Cookie header. li_at rides first
 *   and unquoted; JSESSIONID keeps its quotes and rides last (§10 template;
 *   §14.5 keeps JSESSIONID last in the header).
 * - csrfToken: the csrf-token header value — the JSESSIONID value with the
 *   quotes stripped (§3, §7 gotcha 5). A wrong or absent value is a 403
 *   "CSRF check failed." on every voyager GET (§13.1).
 * - toStorageState: a storageState document for the Playwright adapter
 *   (slice 3), synthesized from the same pair.
 *
 * The stored jsessionid is normalized once on resolve (one surrounding `"`
 * pair stripped when present): the browser jar stores the value quoted and
 * export tools differ — both dialects resolve to one canonical internal
 * form, and the quote asymmetry is re-applied at the two build sites.
 * SPEC OF RECORD: H:/fork/linkedin-reverse/DOCUMENTATION.md.
 */
import { readFileSync } from "node:fs";
import { ENV_NAMES } from "./config.js";

/** The resolved cookie pair; jsessionId is canonical (quotes stripped). */
export interface LinkedInCookies {
  readonly liAt: string;
  readonly jsessionId: string;
}

function fail(reason: string): Error {
  return new Error(`linkedin-cookies: ${reason}`);
}

/**
 * Strip one surrounding quote pair from an exported JSESSIONID value. An
 * empty stripped value is no session — the jar's value always carries the
 * `ajax:<digits>` token (§1), and an empty one mints an empty csrf-token
 * header, a guaranteed 403 "CSRF check failed." on every GET (§13.1) — so
 * it fails here, naming the file, not remotely on tick 1. Any quote deeper
 * than the stripped pair marks a malformed export.
 */
function canonicalJsessionid(value: string, where: string): string {
  const unquoted =
    value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  if (unquoted === "") {
    throw fail(`${where} no usable "jsessionid" value`);
  }
  if (unquoted.includes('"')) {
    throw fail(`${where} stray quotes inside "jsessionid"`);
  }
  return unquoted;
}

/**
 * Read one required string field. Missing, non-string, and empty values are
 * one failure class (D4 "missing cookies"); li_at never carries quotes, so
 * a quoted li_at is malformed too.
 */
function readCookieField(
  doc: Record<string, unknown>,
  key: "liAt" | "jsessionid",
  where: string,
): string {
  const raw: unknown = doc[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw fail(`${where} no usable "${key}" value`);
  }
  const value = raw.trim();
  if (key === "liAt" && value.includes('"')) {
    throw fail(`${where} a quote inside "liAt"`);
  }
  return value;
}

/**
 * Read LINKEDIN_COOKIES_FILE — a JSON `{ liAt, jsessionid }` pair exported
 * interactively from a logged-in browser — and return the canonical pair.
 * Fail-visible by contract (D4): unset/blank/unreadable/missing-file/
 * malformed-JSON/missing-field all THROW with a message naming the
 * variable; the fetch leg has no reason to run without a session.
 */
export function resolveLinkedInCookies(
  env: Record<string, string | undefined> = process.env,
): LinkedInCookies {
  const envName = ENV_NAMES.linkedinCookiesFile;
  const raw = env[envName];
  const filePath = raw === undefined ? "" : raw.trim();
  if (filePath === "") {
    throw fail(
      `${envName} is not set — point it at a cookie file exported from a logged-in browser (README: PC operations)`,
    );
  }
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw fail(
        `${envName} points at ${filePath}, which does not exist — export the cookie pair from a logged-in browser first (README: PC operations)`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw fail(`${envName} points at ${filePath}, which is unreadable — ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw fail(`${envName} points at ${filePath}, which is not valid JSON — ${message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw fail(`${envName} points at ${filePath}, which is not a JSON object`);
  }
  const doc = parsed as Record<string, unknown>;
  const where = `${envName} points at ${filePath} with`;
  return {
    liAt: readCookieField(doc, "liAt", where),
    jsessionId: canonicalJsessionid(readCookieField(doc, "jsessionid", where), where),
  };
}

/**
 * The voyager GET's Cookie header (§10 template): li_at first, unquoted;
 * JSESSIONID last, keeping the quotes the browser jar stores (§14.5 keeps
 * JSESSIONID last in the header).
 */
export function buildCookieHeader(cookies: LinkedInCookies): string {
  return `li_at=${cookies.liAt}; JSESSIONID="${cookies.jsessionId}"`;
}

/** The csrf-token header value: the JSESSIONID value, quotes stripped (§3, §7 gotcha 5). */
export function csrfToken(cookies: LinkedInCookies): string {
  return cookies.jsessionId;
}

/** One cookie entry shaped for Playwright's storageState contract (extras stay optional on Playwright's side). */
export interface VoyagerStorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}

/**
 * A storageState document for the Playwright adapter (slice 3). Mutable
 * field shapes on purpose: readonly arrays would not assign to Playwright's
 * storageState context option; this factory returns a fresh object per
 * call, so purity is not at risk.
 */
export interface VoyagerStorageState {
  cookies: VoyagerStorageCookie[];
  origins: never[];
}

/**
 * Synthesize the storageState the Playwright adapter feeds newContext()
 * (slice 3). The JSESSIONID value keeps its quotes — that is the jar's
 * literal value, so adapter requests emit `Cookie: ... JSESSIONID="ajax:..."`
 * (§10). domain ".linkedin.com" covers the www host; both cookies are
 * Secure in a real browser jar.
 */
export function toStorageState(cookies: LinkedInCookies): VoyagerStorageState {
  return {
    cookies: [
      { name: "li_at", value: cookies.liAt, domain: ".linkedin.com", path: "/", secure: true },
      {
        name: "JSESSIONID",
        value: `"${cookies.jsessionId}"`,
        domain: ".linkedin.com",
        path: "/",
        secure: true,
      },
    ],
    origins: [],
  };
}
```

#### 2. Offline suite for the session module
**File**: `tests/linkedin-session.test.ts` (NEW)
**Changes**: Resolver reject matrix (unset/blank/missing file/invalid JSON/non-object JSON/missing-empty liAt/missing-empty-quotes-only jsessionid/stray quotes — every message names `LINKEDIN_COOKIES_FILE`), both export dialects accepted, header quote-asymmetry pins, csrf pin, storageState shape pins. Cookie files are written to OS temp only. Reopened at the 2026-11-04 slice-3 checkpoint: the `assert.throws` block canonicalized (biome format).

```ts
/**
 * Offline suite for the cookie-file session module (slice 2).
 *
 * Pins the D4 fail-visible resolver matrix (every rejection message names
 * LINKEDIN_COOKIES_FILE), the §3/§10 quote asymmetry (the Cookie header
 * keeps JSESSIONID quoted and last; the csrf-token value carries the
 * quotes stripped), and the storageState synthesis for the slice-3
 * Playwright adapter. Cookie files are written to OS temp only.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ENV_NAMES } from "../src/config.js";
import {
  buildCookieHeader,
  csrfToken,
  resolveLinkedInCookies,
  toStorageState,
} from "../src/linkedin-session.js";

const ENV_NAME = ENV_NAMES.linkedinCookiesFile;

let dir: string | undefined;
let fileSeq = 0;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

/** Write one cookie file into the suite's OS-temp dir; returns its path. */
async function cookieFile(content: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-cookies-"));
  fileSeq += 1;
  const path = join(dir, `cookies-${fileSeq}.json`);
  await writeFile(path, content, "utf8");
  return path;
}

function envFor(path: string): Record<string, string | undefined> {
  return { [ENV_NAME]: path };
}

const PAIR = JSON.stringify({ liAt: "AQE-test-li-at", jsessionid: "ajax:0123456789012345678" });

describe("resolveLinkedInCookies", () => {
  it("throws naming the variable when it is unset", () => {
    assert.throws(() => resolveLinkedInCookies({}), /LINKEDIN_COOKIES_FILE is not set/);
  });

  it("throws naming the variable when it is blank", () => {
    assert.throws(() => resolveLinkedInCookies({ [ENV_NAME]: "   " }), /is not set/);
  });

  it("throws when the file does not exist", () => {
    const missing = join(tmpdir(), "lw-linkedin-cookies-absent", "nope.json");
    assert.throws(
      () => resolveLinkedInCookies(envFor(missing)),
      /LINKEDIN_COOKIES_FILE points at .*nope\.json, which does not exist/,
    );
  });

  it("throws when the file is not valid JSON", async () => {
    const path = await cookieFile("{not json");
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /which is not valid JSON/);
  });

  it("throws when the JSON is not an object", async () => {
    const path = await cookieFile("[1,2]");
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /which is not a JSON object/);
  });

  it("throws when liAt is missing or empty", async () => {
    const missing = await cookieFile(JSON.stringify({ jsessionid: "ajax:123" }));
    const empty = await cookieFile(JSON.stringify({ liAt: "  ", jsessionid: "ajax:123" }));
    assert.throws(() => resolveLinkedInCookies(envFor(missing)), /no usable "liAt"/);
    assert.throws(() => resolveLinkedInCookies(envFor(empty)), /no usable "liAt"/);
  });

  it("throws when jsessionid is missing or empty", async () => {
    const missing = await cookieFile(JSON.stringify({ liAt: "AQE" }));
    const empty = await cookieFile(JSON.stringify({ liAt: "AQE", jsessionid: "" }));
    assert.throws(() => resolveLinkedInCookies(envFor(missing)), /no usable "jsessionid"/);
    assert.throws(() => resolveLinkedInCookies(envFor(empty)), /no usable "jsessionid"/);
  });

  it("throws when jsessionid is only one quote pair (empty after stripping)", async () => {
    const path = await cookieFile(JSON.stringify({ liAt: "AQE", jsessionid: '""' }));
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /no usable "jsessionid"/);
  });

  it("names the variable in every rejection message", async () => {
    const badJson = await cookieFile("{nope");
    const badField = await cookieFile(JSON.stringify({ liAt: "", jsessionid: "ajax:1" }));
    const cases: Record<string, string | undefined>[] = [
      {},
      { [ENV_NAME]: "   " },
      envFor(join(tmpdir(), "lw-linkedin-cookies-absent-2", "nope.json")),
      envFor(badJson),
      envFor(badField),
    ];
    for (const env of cases) {
      assert.throws(
        () => resolveLinkedInCookies(env),
        (error: unknown) => {
          assert.match((error as Error).message, new RegExp(`^linkedin-cookies: ${ENV_NAME}`));
          return true;
        },
      );
    }
  });

  it("resolves the pair from an unquoted jsessionid export", async () => {
    const path = await cookieFile(PAIR);
    assert.deepEqual(resolveLinkedInCookies(envFor(path)), {
      liAt: "AQE-test-li-at",
      jsessionId: "ajax:0123456789012345678",
    });
  });

  it("resolves the same canonical pair from a quoted jsessionid export", async () => {
    const path = await cookieFile(
      JSON.stringify({ liAt: "AQE-test-li-at", jsessionid: '"ajax:0123456789012345678"' }),
    );
    assert.deepEqual(resolveLinkedInCookies(envFor(path)), {
      liAt: "AQE-test-li-at",
      jsessionId: "ajax:0123456789012345678",
    });
  });

  it("throws when jsessionid carries quotes beyond one surrounding pair", async () => {
    const path = await cookieFile(JSON.stringify({ liAt: "AQE", jsessionid: '"aj"ax:123"' }));
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /stray quotes inside "jsessionid"/);
  });

  it("throws when liAt carries quotes", async () => {
    const path = await cookieFile(JSON.stringify({ liAt: 'AQ"E', jsessionid: "ajax:1" }));
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /quote inside "liAt"/);
  });
});

describe("buildCookieHeader", () => {
  const cookies = { liAt: "AQE-test-li-at", jsessionId: "ajax:0123456789012345678" };

  it("rides li_at first unquoted and JSESSIONID last quoted (§10 template, §14.5 ordering)", () => {
    assert.equal(
      buildCookieHeader(cookies),
      'li_at=AQE-test-li-at; JSESSIONID="ajax:0123456789012345678"',
    );
  });
});

describe("csrfToken", () => {
  it("returns the jsessionid with quotes stripped (§3 header value)", () => {
    assert.equal(csrfToken({ liAt: "A", jsessionId: "ajax:123" }), "ajax:123");
  });
});

describe("toStorageState", () => {
  const cookies = { liAt: "AQE-test-li-at", jsessionId: "ajax:0123456789012345678" };

  it("synthesizes the .linkedin.com pair with the quoted JSESSIONID value", () => {
    const state = toStorageState(cookies);
    assert.equal(state.cookies.length, 2);
    const [liAtCookie, jsessionidCookie] = state.cookies;
    assert.deepEqual(liAtCookie, {
      name: "li_at",
      value: "AQE-test-li-at",
      domain: ".linkedin.com",
      path: "/",
      secure: true,
    });
    assert.equal(jsessionidCookie?.name, "JSESSIONID");
    assert.equal(jsessionidCookie?.value, '"ajax:0123456789012345678"');
    assert.equal(jsessionidCookie?.domain, ".linkedin.com");
    assert.equal(jsessionidCookie?.secure, true);
  });

  it("carries no origins", () => {
    assert.deepEqual(toStorageState(cookies).origins, []);
  });
});
```

#### 3. Environment-name registration
**File**: `src/config.ts` (MODIFY)
**Changes**: `ENV_NAMES` gains exactly one name this slice: `linkedinCookiesFile` → `LINKEDIN_COOKIES_FILE`, placed after `threadsSession`. The SDK-era `linkedApiToken` / `linkedApiIdentificationToken` pair STAYS on disk until Phase 6 (the SDK module still imports it; removing it now breaks `npm run typecheck`). Delta splice: insert the one line below into the existing `ENV_NAMES` block.

```ts
/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  linkedinCookiesFile: "LINKEDIN_COOKIES_FILE", // ← ADDED this phase
  linkedApiToken: "LINKED_API_TOKEN", // ← retained until Phase 6
  linkedApiIdentificationToken: "LINKED_API_IDENTIFICATION_TOKEN", // ← retained until Phase 6
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  judgeConcurrency: "JUDGE_CONCURRENCY",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test` — new suite green, rest untouched
- [x] Resolver reject matrix pinned: unset, blank, missing file, invalid JSON, non-object JSON, missing/empty liAt, missing/empty jsessionid (raw-empty AND quotes-only dialect), stray quotes in either value — every message names `LINKEDIN_COOKIES_FILE` (via ENV_NAMES.linkedinCookiesFile)
- [x] Quote asymmetry pinned: Cookie header carries `JSESSIONID="ajax:..."` WITH quotes in last position; csrf-token value carries it WITHOUT quotes; storageState JSESSIONID value carries quotes on `.linkedin.com`
- [x] Both export dialects accepted: `jsessionid` stored quoted or unquoted resolves to identical header/csrf/storageState output
- [x] `ENV_NAMES` gains exactly one name this slice: `linkedinCookiesFile` → `LINKEDIN_COOKIES_FILE`

#### Manual Verification:
- [ ] Cookie header spot-checked against DOCUMENTATION.md §10 template by eye (li_at unquoted first; JSESSIONID quoted last)
- [x] storageState shape eyeballed against Playwright's storageState context-option contract (name/value/domain/path/secure)

---

## Phase 3: Fetch module — transport adapters, fault classification, runPool walk

### Overview

The transport seam and the surface walk: `VoyagerGet` with a curl-impersonate adapter (spawned binary, injectable exec) and a Playwright API-request adapter (own dynamic-import quarantine), the §13.3 fault classifier with the `LegDeadError` tagged error, and the `runPool` walk — count-50 pages, `start += count`, shared 5s pacing gate with reserve-before-sleep slots, per-surface warn+skip, leg-dead drain-then-throw. Certified 2026-11-04: four slice-verifier rounds + real-gate proof (tsc, biome, 61-test scratch harness); the compiler caught the storageState wire-type gap and the pacing burst that three LLM rounds missed.

### Changes Required:

#### 1. Fetch module — adapters, classifier, walk
**File**: `src/linkedin-fetch.ts` (NEW)
**Changes**: `VoyagerGet` seam type; `createCurlTransport` (`CURL_IMPERSONATE_BIN` fail-visible, injectable exec, `-w` status sentinel riding after a `\n` separator the transport strips from the body — one exec, no temp files); `createPlaywrightTransport` (standalone API-request context — `request.newContext`, no browser launch — behind its own dynamic-import quarantine; completes the session module's minimal cookie shape to Playwright's wire type at this boundary); `resolveLinkedInTransport` (`LINKEDIN_TRANSPORT`: `curl` default | `playwright`, else throw); `classifyFault(status, body)` per §13.3; `LegDeadError` tagged error + `isLegDead` guard (judge-rotation idiom); `fetchLinkedInPosts` — runPool walk per the VERIFIED contract: `runPool` RETURNS VOID (src/pool.ts:33-52), results ride caller-owned side arrays by claim index (fetchSurfacesAuthenticated idiom, src/fetch-threads.ts:294-343), the worker stays total for surface faults (warn + skip), leg-dead aborts via drain-then-throw (src/judge.ts:681-830). Shared pacing gate with the slot RESERVED BEFORE SLEEPING (GET starts stay PACE_MS apart globally, never width-2 bursts). Plan-review amendment (Step 5, applied plan-local; design follow-up: `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md`): a shared `BROWSER_UA` module constant now feeds BOTH adapters — the Playwright fallback previously sent no user-agent and could invite the §13.3 challenge class.

```ts
/**
 * The LinkedIn voyager fetch leg: transport adapters, §13 fault
 * classification, and the runPool surface walk (design slices 3/D11).
 *
 * Two transports behind one seam — `VoyagerGet`, one GET per call:
 *
 * - curl (default): spawns the curl-impersonate chrome build
 *   (CURL_IMPERSONATE_BIN, fail-visible when unset) with the §3/§10 header
 *   set. The HTTP status rides a write-out sentinel after the body — one
 *   exec, no temp files. The exec runner is injectable for offline tests.
 * - playwright: a standalone API-request context
 *   (`request.newContext({ storageState })`) behind the SAME dynamic-import
 *   quarantine idiom as makeChromiumContextFactory (fetch-threads.ts:129).
 *   NOT ContextFactory: ContextLike (fetch-threads.ts:106) exposes no
 *   request surface, and an API GET needs no browser launch (verified
 *   2026-11-04). storageState carries the cookie pair; csrf-token and the
 *   static headers ride extraHTTPHeaders.
 *
 * `LINKEDIN_TRANSPORT` selects the adapter (`curl` default | `playwright`,
 * else throw — switching after a failed probe is an operator action, D2).
 *
 * The walk (D11) reuses runPool — verified contract: runPool RETURNS VOID
 * (src/pool.ts:33-52), so results ride caller-owned side arrays indexed by
 * the claim index, the worker stays total for surface faults (warn + skip,
 * the caller-owned skip warn stays in index.ts), and leg-dead aborts via
 * the repo's drain-then-throw shape (judgePosts fallback pool,
 * src/judge.ts:681; fast-workflow-runtime D11): catch isLegDead in the
 * worker, set a shared flag, stop claiming, throw once after the join.
 * A shared per-walk pacing gate (5s between voyager GETs, any surface)
 * keeps the global call rate identical to a sequential walk — the anti-bot
 * rate is pacing-bound, not width-bound (§13.3 throttling was observed at
 * ~40 rapid calls).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Surface } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import {
  type LinkedInCookies,
  buildCookieHeader,
  csrfToken,
  resolveLinkedInCookies,
  toStorageState,
} from "./linkedin-session.js";
import { VOYAGER_STATIC_HEADERS, buildSearchUrl, parseSearchResponse } from "./linkedin-voyager.js";
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

/** One configured linkedin surface (raw keyword string, never a URL). */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;

/** Injectable sleep for the pacing gate (judge.ts trailing-param idiom). */
export type SleepFn = (ms: number) => Promise<void>;

/** Walk width. The pacing gate, not this number, bounds the voyager rate. */
export const LINKEDIN_FETCH_CONCURRENCY = 2;

/** §12.1: count 50 is unclamped server-side; `start += count` pages. */
export const PAGE_SIZE = 50;

/** Minimum spacing between voyager GETs, shared across surfaces (§13.3). */
export const PACE_MS = 5_000;

/** One curl exec's wall-clock cap; mirrored by --max-time inside curl. */
const REQUEST_TIMEOUT_MS = 30_000;

/** curl -w appends this sentinel + status after the response body. */
const STATUS_SENTINEL = "___CURL_STATUS:";

/** §10 client fingerprint: both adapters present the identical Chrome UA. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** One voyager GET's outcome: the HTTP status and the raw body. */
export interface VoyagerResponse {
  readonly status: number;
  readonly body: string;
}

/** The transport seam: one GET per call, shared by both adapters. */
export type VoyagerGet = (url: string) => Promise<VoyagerResponse>;

/** An opened transport: the GET plus its teardown (a no-op for curl). */
export interface Transport {
  readonly get: VoyagerGet;
  readonly dispose: () => Promise<void>;
}

// --- LegDeadError: the tagged-error idiom (judge-rotation.ts:51-75) ---

export const LEG_DEAD = "LegDeadError";

/**
 * Thrown once per tick when the session leg is dead (D7). Factory-assigned
 * fields stay mutable — the RotationExhausted idiom (judge-rotation.ts:61-70).
 */
export interface LegDead extends Error {
  name: string;
  reason: string;
}

export function legDead(reason: string): LegDead {
  const error = new Error(`linkedin-fetch: leg dead — ${reason}`) as LegDead;
  error.name = LEG_DEAD;
  error.reason = reason;
  return error;
}

export function isLegDead(error: unknown): error is LegDead {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === LEG_DEAD
  );
}

// --- §13.3 fault classification ---

export type FaultKind = "legDead" | "fault";

export interface Fault {
  readonly kind: FaultKind;
  readonly reason: string;
}

/**
 * §13.3 detection recipe, HTTP responses only (connection-level failures
 * throw from the transport and land as surface faults, never leg-dead —
 * a dead network is not a dead session):
 *
 * - 403 "CSRF check failed." text, or a Cloudflare challenge page: the
 *   session/CSRF pair is broken or the IP reputation is burned — leg dead.
 * - 401 {"status":401}: dead or absent li_at — leg dead.
 * - bare 400 {"status":400} on the finder: no member context (dead
 *   session) — leg dead (§13.1: same remedy as 401).
 * - graphql-envelope 400: known query, bad variables — OUR bug, a fault.
 * - 500: unknown queryId — the hash expired server-side (§15); re-derive
 *   from a current APK, do not debug variables — a fault.
 */
export function classifyFault(status: number, body: string): Fault {
  const trimmed = body.trim();
  if (status === 403) {
    const challenge = /Just a moment|challenge|cf-ray/i.test(trimmed);
    return {
      kind: "legDead",
      reason: challenge
        ? "HTTP 403 challenge page — IP/session reputation burned (§13.3)"
        : 'HTTP 403 "CSRF check failed." — session/JSESSIONID mismatch (§13.1)',
    };
  }
  if (status === 401) {
    return {
      kind: "legDead",
      reason: `HTTP 401 ${trimmed.slice(0, 60)} — dead li_at session (§13.1)`,
    };
  }
  if (status === 400) {
    if (trimmed === '{"status":400}') {
      return {
        kind: "legDead",
        reason: 'bare HTTP 400 {"status":400} — no member context; dead session (§13.1)',
      };
    }
    return {
      kind: "fault",
      reason: `HTTP 400 graphql envelope — bad variables (our bug): ${trimmed.slice(0, 80)}`,
    };
  }
  if (status === 500) {
    return {
      kind: "fault",
      reason: "HTTP 500 — unknown queryId; the hash expired (§15), re-derive from a current APK",
    };
  }
  return { kind: "fault", reason: `HTTP ${status}` };
}

// --- curl-impersonate transport ---

/** Injectable exec seam for offline tests: binary + args → stdout. */
export type ExecFn = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

const execFilePromised = promisify(execFile);

const realExec: ExecFn = (file, args) =>
  execFilePromised(file, [...args], {
    timeout: REQUEST_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

/**
 * curl-impersonate chrome build (developer-selected primary transport).
 * One exec per GET: `-sS` body to stdout, `--max-time` mirrors the exec
 * timeout, the §3/§10 header set via -H pairs, and `-w` appends the status
 * sentinel after the body — parseable without temp files or stderr games.
 * Exec-level failures (connection reset, timeout, missing binary) throw
 * plain errors: surface faults, never leg-dead.
 */
export function createCurlTransport(
  cookies: LinkedInCookies,
  env: Record<string, string | undefined> = process.env,
  execFn: ExecFn = realExec,
): () => Promise<Transport> {
  return async (): Promise<Transport> => {
    const bin = env[ENV_NAMES.curlImpersonateBin]?.trim();
    if (bin === undefined || bin === "") {
      throw new Error(
        `linkedin-fetch: ${ENV_NAMES.curlImpersonateBin} is not set — the curl transport needs the curl-impersonate chrome binary path (README: PC operations)`,
      );
    }
    const headerPairs = [
      `cookie: ${buildCookieHeader(cookies)}`,
      `csrf-token: ${csrfToken(cookies)}`,
      ...Object.entries(VOYAGER_STATIC_HEADERS).map(([name, value]) => `${name}: ${value}`),
      `user-agent: ${BROWSER_UA}`,
    ];
    const get: VoyagerGet = async (url) => {
      const args = [
        "-sS",
        "--max-time",
        String(Math.round(REQUEST_TIMEOUT_MS / 1000)),
        "--compressed",
        url,
        ...headerPairs.flatMap((header) => ["-H", header]),
        "-w",
        `\n${STATUS_SENTINEL}%{http_code}`,
      ];
      let stdout: string;
      try {
        ({ stdout } = await execFn(bin, args));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`linkedin-fetch: curl exec failed — ${message}`);
      }
      const marker = stdout.lastIndexOf(STATUS_SENTINEL);
      if (marker === -1) {
        throw new Error("linkedin-fetch: curl produced no status marker (binary or flag mismatch)");
      }
      const status = Number(stdout.slice(marker + STATUS_SENTINEL.length).trim());
      if (!Number.isInteger(status) || status <= 0) {
        throw new Error("linkedin-fetch: curl status marker unparsable");
      }
      // The -w template writes "\n" before the sentinel: that separator is
      // not part of the body (a body with its own trailing newline keeps it).
      const raw = stdout.slice(0, marker);
      const body = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
      return { status, body };
    };
    return { get, dispose: async () => undefined };
  };
}

/**
 * Playwright API-request transport (the tested fallback, D2). The module's
 * dynamic-import quarantine site — the only `await import("playwright")`
 * outside fetch-threads. storageState carries the cookie pair (toStorageState
 * in linkedin-session.ts); the csrf-token and static headers ride
 * extraHTTPHeaders. Unexercised by the offline suite, like
 * chromiumContextFactory — the VoyagerGet seam carries the tests.
 */
export function createPlaywrightTransport(cookies: LinkedInCookies): () => Promise<Transport> {
  return async (): Promise<Transport> => {
    const { request } = await import("playwright");
    // Complete the session-module cookie shape to Playwright's storageState
    // wire type: session cookies carry no jar expiry (-1), and an
    // API-request context runs no scripts, so httpOnly/sameSite are inert
    // defaults. The session module stays the minimal contract (slice 2).
    const storageState = {
      cookies: toStorageState(cookies).cookies.map((cookie) => ({
        ...cookie,
        expires: -1,
        httpOnly: false,
        sameSite: "Lax" as const,
      })),
      origins: [],
    };
    const context = await request.newContext({
      storageState,
      extraHTTPHeaders: {
        "csrf-token": csrfToken(cookies),
        "user-agent": BROWSER_UA, // identical fingerprint to the curl adapter (plan-review amendment)
        ...VOYAGER_STATIC_HEADERS,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const get: VoyagerGet = async (url) => {
      const response = await context.get(url);
      return { status: response.status(), body: await response.text() };
    };
    return {
      get,
      dispose: async () => {
        await context.dispose();
      },
    };
  };
}

/**
 * Resolve AND open the configured transport: `LINKEDIN_TRANSPORT` selects
 * `curl` (default, empty/unset included) or `playwright`; anything else
 * throws naming the allowed values (D2: no silent auto-switching — a
 * failed probe is followed by an operator edit + re-probe).
 */
export async function resolveLinkedInTransport(
  env: Record<string, string | undefined> = process.env,
  cookies: LinkedInCookies = resolveLinkedInCookies(env),
  execFn: ExecFn = realExec,
): Promise<Transport> {
  const selection = env[ENV_NAMES.linkedinTransport]?.trim() ?? "";
  const maker =
    selection === "" || selection === "curl"
      ? createCurlTransport(cookies, env, execFn)
      : selection === "playwright"
        ? createPlaywrightTransport(cookies)
        : null;
  if (maker === null) {
    throw new Error(
      `linkedin-fetch: ${ENV_NAMES.linkedinTransport}="${selection}" is not one of: curl, playwright`,
    );
  }
  return maker();
}

// --- the surface walk ---

interface PacingGate {
  readonly wait: () => Promise<void>;
}

/**
 * Shared pacing gate: every voyager GET starts PACE_MS or more after the
 * previous one, regardless of which surface issued it. The slot is
 * RESERVED BEFORE SLEEPING — the stamp advances synchronously on entry, so
 * concurrent workers can never compute the same wake time and fire a
 * burst; with width 2 the GET starts still space PACE_MS apart globally
 * (pacing-bound, not width-bound, D11). A per-walk closure (not module
 * state): two ticks must not inherit each other's stamp, and each test
 * run gets a fresh gate.
 */
function makePacingGate(now: () => number, sleepFn: SleepFn): PacingGate {
  let nextFreeAt = Number.NEGATIVE_INFINITY;
  return {
    wait: async () => {
      const slotAt = Math.max(now(), nextFreeAt);
      nextFreeAt = slotAt + PACE_MS;
      const waitMs = slotAt - now();
      if (waitMs > 0) {
        await sleepFn(waitMs);
      }
    },
  };
}

const defaultSleep: SleepFn = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Walk every configured linkedin surface: count-50 pages with
 * `start += count`, stop on a partial page (§12.8: returned posts < count
 * is the last page; `elements: []` lands as zero posts), one log line per
 * surface (empty-is-success, defb8af). Surface faults warn + skip (the
 * index arm owns the per-surface skip summary); leg-dead aborts the tick
 * whole via drain-then-throw. Accepts a bare VoyagerGet (tests, probe —
 * no ownership) or an opened Transport (scripts — disposed in finally).
 */
export async function fetchLinkedInPosts(
  surfaces: readonly LinkedinSurface[],
  cookies: LinkedInCookies,
  transport: VoyagerGet | Transport,
  sleepFn: SleepFn = defaultSleep,
  now: () => number = Date.now,
): Promise<Post[]> {
  const ownsTransport = typeof transport !== "function";
  const get: VoyagerGet = ownsTransport ? (transport as Transport).get : transport;
  const gate = makePacingGate(now, sleepFn);
  // Side arrays indexed by runPool's claim index — runPool returns void
  // (src/pool.ts:33-52); reassembly order comes from the filter+flat walk.
  const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
  let dropped = 0;
  let deadReason: string | undefined;

  try {
    await runPool(surfaces, LINKEDIN_FETCH_CONCURRENCY, async (surface, index) => {
      const label = `linkedin/${surface.value}`;
      try {
        const collected: Post[] = [];
        let start = 0;
        for (;;) {
          if (deadReason !== undefined) return; // stop claiming; the join re-throws
          await gate.wait();
          if (deadReason !== undefined) return;
          const response = await get(buildSearchUrl(surface.value, start, PAGE_SIZE));
          if (response.status !== 200) {
            const fault = classifyFault(response.status, response.body);
            if (fault.kind === "legDead") throw legDead(fault.reason);
            throw new Error(`${label} page ${start}: ${fault.reason}`);
          }
          const parsed = parseSearchResponse(response.body);
          if (parsed.kind === "unparsable") {
            throw new Error(`${label} page ${start}: unparsable 200 body — ${parsed.reason}`);
          }
          dropped += parsed.dropped;
          collected.push(...parsed.posts);
          if (parsed.posts.length < PAGE_SIZE) break;
          start += PAGE_SIZE;
        }
        perSurface[index] = collected;
        // Empty-is-success keyed on the observable signal (defb8af): a
        // surface that yields 0 posts is an outcome, not a fault.
        console.log(`fetch: ${label} OK — ${collected.length} post(s)`);
      } catch (error) {
        if (isLegDead(error)) {
          // Drain-then-throw (judgePosts D11 shape): flag, stop claiming,
          // re-throw once after the join. The tick aborts whole — partial
          // posts are discarded, never half-written.
          deadReason ??= error.reason;
          console.warn(`fetch: ${label} LEG DEAD — ${error.reason}`);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch: ${label} FAILED — ${message}`);
      }
    });
  } finally {
    if (ownsTransport) await (transport as Transport).dispose();
  }

  if (deadReason !== undefined) {
    throw legDead(deadReason);
  }
  if (dropped > 0) {
    console.warn(`fetch: linkedin dropped ${dropped} malformed row(s)`);
  }
  return perSurface.filter((entry): entry is Post[] => entry !== undefined).flat();
}
```

#### 2. Offline suite for the fetch leg
**File**: `tests/linkedin-fetch.test.ts` (NEW)
**Changes**: §13.3 fault-classifier table (7 rows); curl adapter over a fake exec (header set, status-sentinel parse with the separator stripped from the body, exec failure → surface fault, missing-binary fail-visible); transport resolver accept/reject matrix; paging sequence over a scripted VoyagerGet double (partial-page stop, exhaustion stop, ordered reassembly under out-of-order completion, per-surface fault skip, leg-dead drain-then-throw with sibling stop, drop-count warn, empty-is-success, transport disposal); pacing-gate timing via an injected clock PLUS a deferred-sleep slot-reservation pin proving concurrent waiters never share a wake time (the width-2 burst regression, fixed 2026-11-04). Zero network, zero real sleeps; the playwright adapter stays unexercised (the chromiumContextFactory precedent — the seam carries the tests).

```ts
/**
 * Offline suite for the voyager fetch leg.
 *
 * Covers: the §13.3 fault-classifier table; the curl transport over a fake
 * exec (header set, status-sentinel parse, exec failure, missing-binary
 * fail-visible); the transport resolver accept/reject matrix; the runPool
 * surface walk over a scripted VoyagerGet — partial-page stop, exhaustion
 * stop, input-order reassembly under out-of-order completion, per-surface
 * fault skip, leg-dead drain-then-throw with sibling stop, pacing-gate
 * spacing, drop-count warn, empty-is-success, transport disposal. Zero
 * network and zero real sleeps: the VoyagerGet seam is the test double and
 * the multi-GET walk tests inject controlled sleeps; the playwright adapter
 * stays unexercised (the chromiumContextFactory precedent — the seam
 * carries the tests).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type LinkedinSurface,
  PAGE_SIZE,
  type VoyagerGet,
  type VoyagerResponse,
  classifyFault,
  createCurlTransport,
  fetchLinkedInPosts,
  isLegDead,
  legDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const COOKIES: LinkedInCookies = { liAt: "AQE-test", jsessionId: "ajax:0123456789012345678" };

/** An instant sleepFn: multi-GET walk tests pin paging order, not pacing. */
const instantSleep = async (): Promise<void> => undefined;

/** Build a §6-shaped 200 body carrying the given activity ids. */
const okBody = (ids: readonly string[]): string =>
  JSON.stringify({
    data: {
      searchDashClustersByAll: {
        elements: [
          {
            items: ids.map((id) => ({
              item: {
                searchFeedUpdate: {
                  update: {
                    metadata: { backendUrn: `urn:li:activity:${id}` },
                    commentary: { text: { text: `post ${id}` } },
                    actor: { name: { text: `author ${id}` } },
                    socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                  },
                },
              },
            })),
          },
        ],
      },
    },
    included: [],
  });

const page = (ids: readonly string[], status = 200, body?: string): VoyagerResponse => ({
  status,
  body: body ?? okBody(ids),
});

/** Distinct activity ids; second-resolution spacing keeps them unique. */
const idAt = (n: number): string => (BigInt(Date.UTC(2026, 9, 26, 9, 14, n)) << 22n).toString();
const FULL_PAGE: readonly string[] = Array.from({ length: PAGE_SIZE }, (_, i) => idAt(i));

const startOf = (url: string): string => /start:(\d+)/.exec(url)?.[1] ?? "";
/** The keyword token as it rides the URL (already URL-encoded); routes match raw. */
const surfaceOf = (url: string): string => /keywords:([^,)]+)/.exec(url)?.[1] ?? "";

/** Scripted transport: responds per URL matcher; records every call. */
function scriptGet(
  routes: ReadonlyArray<{
    match: (url: string) => boolean;
    respond: () => VoyagerResponse | Promise<VoyagerResponse>;
  }>,
): VoyagerGet & { calls: string[] } {
  const calls: string[] = [];
  const get: VoyagerGet = async (url) => {
    calls.push(url);
    const route = routes.find((candidate) => candidate.match(url));
    if (route === undefined) throw new Error(`unexpected GET: ${url}`);
    return route.respond();
  };
  return Object.assign(get, { calls });
}

/** A manually-resolved promise: stages one GET response for the pacing test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("classifyFault (§13.3 table)", () => {
  it("classifies the CSRF-403 text body as leg-dead", () => {
    const fault = classifyFault(403, "CSRF check failed.");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /CSRF/);
  });

  it("classifies a Cloudflare challenge 403 as leg-dead", () => {
    const fault = classifyFault(403, "<html>Just a moment... cf-ray: abc</html>");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /challenge/);
  });

  it("classifies 401 {status:401} as leg-dead (dead li_at)", () => {
    const fault = classifyFault(401, '{"status":401}');
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /li_at/);
  });

  it("classifies the bare 400 on the finder as leg-dead (no member context)", () => {
    const fault = classifyFault(400, '{"status":400}');
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /member context|dead session/);
  });

  it("classifies the graphql-envelope 400 as a fault (bad variables — our bug)", () => {
    const fault = classifyFault(400, '{"data":{"status":400},"included":[]}');
    assert.equal(fault.kind, "fault");
    assert.match(fault.reason, /bad variables/);
  });

  it("classifies 500 as a fault (queryId expiry, §15)", () => {
    const fault = classifyFault(500, "Internal Server Error");
    assert.equal(fault.kind, "fault");
    assert.match(fault.reason, /queryId/);
  });

  it("classifies any other non-200 as a fault", () => {
    assert.equal(classifyFault(503, "").kind, "fault");
  });
});

describe("createCurlTransport", () => {
  const RESPONSE_BODY = '{"data":{"searchDashClustersByAll":{"elements":[]}},"included":[]}';

  it("passes the URL, the §3/§10 header set, and parses the status sentinel", async () => {
    const execCalls: Array<{ file: string; args: readonly string[] }> = [];
    const make = createCurlTransport(
      COOKIES,
      { CURL_IMPERSONATE_BIN: "curl-chrome" },
      async (file, args) => {
        execCalls.push({ file, args });
        return { stdout: `${RESPONSE_BODY}\n___CURL_STATUS:200` };
      },
    );
    const transport = await make();
    const response = await transport.get("https://www.linkedin.com/voyager/api/graphql?x=1");

    assert.equal(response.status, 200);
    assert.equal(response.body, RESPONSE_BODY);
    assert.equal(execCalls.length, 1);
    const call = execCalls[0];
    assert.equal(call?.file, "curl-chrome");
    assert.ok(call?.args.includes("https://www.linkedin.com/voyager/api/graphql?x=1"));
    const headers = (call?.args ?? []).filter((arg, index) => call?.args[index - 1] === "-H");
    assert.ok(headers.includes('cookie: li_at=AQE-test; JSESSIONID="ajax:0123456789012345678"'));
    assert.ok(headers.includes("csrf-token: ajax:0123456789012345678"));
    assert.ok(headers.includes("x-restli-protocol-version: 2.0.0"));
    assert.ok(headers.includes("accept: application/json"));
  });

  it("throws a surface fault (not leg-dead) when the exec fails", async () => {
    const make = createCurlTransport(COOKIES, { CURL_IMPERSONATE_BIN: "curl-chrome" }, async () => {
      throw new Error("connection reset");
    });
    const transport = await make();
    await assert.rejects(() => transport.get("https://x"), /curl exec failed — connection reset/);
  });

  it("fails visibly naming the variable when CURL_IMPERSONATE_BIN is unset", async () => {
    const make = createCurlTransport(COOKIES, {});
    await assert.rejects(() => make(), /CURL_IMPERSONATE_BIN is not set/);
  });
});

describe("resolveLinkedInTransport", () => {
  it("opens the curl transport by default over the injected exec", async () => {
    const transport = await resolveLinkedInTransport(
      { CURL_IMPERSONATE_BIN: "curl-chrome" },
      COOKIES,
      async () => ({ stdout: "\n___CURL_STATUS:200" }),
    );
    const response = await transport.get("https://x");
    assert.equal(response.status, 200);
    await transport.dispose();
  });

  it("opens the curl transport when LINKEDIN_TRANSPORT is explicitly curl", async () => {
    const transport = await resolveLinkedInTransport(
      { LINKEDIN_TRANSPORT: "curl", CURL_IMPERSONATE_BIN: "curl-chrome" },
      COOKIES,
      async () => ({ stdout: "\n___CURL_STATUS:200" }),
    );
    const response = await transport.get("https://x");
    assert.equal(response.status, 200);
    await transport.dispose();
  });

  it("throws naming the allowed values on an unknown LINKEDIN_TRANSPORT", async () => {
    await assert.rejects(
      () =>
        resolveLinkedInTransport(
          { LINKEDIN_TRANSPORT: "wget", CURL_IMPERSONATE_BIN: "curl-chrome" },
          COOKIES,
          async () => ({ stdout: "" }),
        ),
      /LINKEDIN_TRANSPORT="wget" is not one of: curl, playwright/,
    );
  });
});

describe("fetchLinkedInPosts (runPool walk)", () => {
  const oneSurface: readonly LinkedinSurface[] = [{ type: "linkedin", value: "#hiring react" }];

  it("stops on a partial page and returns the parsed posts in input order", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([idAt(1), idAt(2), idAt(3)]) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.equal(get.calls.length, 1);
    assert.deepEqual(
      posts.map((post) => post.id),
      [idAt(1), idAt(2), idAt(3)].map((id) => `urn:li:activity:${id}`),
    );
  });

  it("pages a full page, then stops on the exhaustion page (elements: [])", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page(FULL_PAGE) },
      { match: (url) => startOf(url) === "50", respond: () => page([]) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get, instantSleep);
    assert.equal(get.calls.length, 2);
    assert.equal(posts.length, PAGE_SIZE);
    assert.ok(get.calls[1]?.includes("start:50"));
  });

  it("paces voyager GETs PACE_MS apart through the injected clock and sleep", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page(FULL_PAGE) },
      { match: (url) => startOf(url) === "50", respond: () => page([idAt(99)]) },
    ]);
    await fetchLinkedInPosts(
      oneSurface,
      COOKIES,
      get,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
    );
    assert.deepEqual(sleeps, [5000]); // first GET is free; the second waits
    assert.equal(get.calls.length, 2);
  });

  it("reserves the pacing slot before sleeping, so concurrent waiters never share a wake time", async () => {
    // The width-2 walk must never fire a burst: each waiter reserves its
    // slot SYNCHRONOUSLY on entry (reserve-before-sleep), so B's target is
    // a full PACE_MS beyond A's in-flight reservation. An update-after-
    // sleep stamp would compute B's wake from the stale stamp and both
    // workers would GET together every PACE_MS. Deferred sleeps + deferred
    // GETs make the reservation order observable deterministically.
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const sleeps: number[] = [];
    const heldSleeps: Array<() => void> = [];
    const sleepFn = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => {
        heldSleeps.push(resolve);
      });
    };
    let tick = 0;
    const get0 = deferred<VoyagerResponse>();
    const get1 = deferred<VoyagerResponse>();
    const get2 = deferred<VoyagerResponse>();
    const get3 = deferred<VoyagerResponse>();
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "0",
        respond: () => get0.promise,
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "0",
        respond: () => get1.promise,
      },
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "50",
        respond: () => get2.promise,
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "50",
        respond: () => get3.promise,
      },
    ]);
    const walk = fetchLinkedInPosts(surfaces, COOKIES, get, sleepFn, () => tick);
    const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

    // A's first GET is open on the free slot; B reserved the NEXT slot
    // while A's GET was still in flight — call starts space PACE_MS apart.
    await flush();
    assert.deepEqual(sleeps, [5000]);

    // A's second reservation (its GET answered) lands a full PACE_MS beyond
    // B's in-flight reservation — the shared wake (burst) never happens.
    get0.resolve(page(FULL_PAGE));
    await flush();
    assert.deepEqual(sleeps, [5000, 10000]);

    // Release in reservation order: B GETs, then reserves beyond A again.
    heldSleeps[0]?.();
    tick += 5000;
    await flush();
    get1.resolve(page(FULL_PAGE));
    await flush();
    assert.deepEqual(sleeps, [5000, 10000, 10000]);

    // Drain the remaining held sleeps and GETs to completion.
    heldSleeps[1]?.();
    tick += 10000;
    await flush();
    get2.resolve(page([]));
    await flush();
    heldSleeps[2]?.();
    tick += 10000;
    await flush();
    get3.resolve(page([]));
    await flush();
    const posts = await walk;
    assert.equal(get.calls.length, 4);
    assert.equal(posts.length, PAGE_SIZE * 2); // both surfaces survived
  });

  it("reassembles two surfaces in input order under out-of-order completion", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15)); // B finishes first
          return page([idAt(1)]);
        },
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
  });

  it("skips a faulted surface (warn) and keeps the sibling's posts", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 400, '{"data":{"status":400},"included":[]}'),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(2)}`],
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a FAILED — .*bad variables/.test(line)));
  });

  it("drains then throws leg-dead once, and the sibling stops paging", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "0",
        respond: () => page(FULL_PAGE),
      },
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "50",
        respond: () => page([], 400, '{"status":400}'), // bare 400 = leg dead
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "0",
        respond: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25)); // still in flight when A flags
          return page(FULL_PAGE);
        },
      },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /dead session/);
    // Sibling stop: B never fired its second page after A flagged.
    assert.equal(
      get.calls.filter((url) => surfaceOf(url) === "%23b" && startOf(url) === "50").length,
      0,
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a LEG DEAD/.test(line)));
  });

  it("treats an unparsable 200 body as a surface fault, not leg-dead", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([], 200, "<html>weird</html>") },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.deepEqual(posts, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /unparsable 200 body/.test(line)));
  });

  it("counts dropped rows in a warn and keeps the valid rest", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const raw = JSON.stringify({
      data: {
        searchDashClustersByAll: {
          elements: [
            {
              items: [
                {
                  item: {
                    searchFeedUpdate: {
                      update: { metadata: { backendUrn: "urn:li:activity:7523282112511242241" } },
                    },
                  },
                },
                ...FULL_PAGE.slice(0, 2).map((id) => ({
                  item: {
                    searchFeedUpdate: {
                      update: {
                        metadata: { backendUrn: `urn:li:activity:${id}` },
                        commentary: { text: { text: `post ${id}` } },
                        actor: { name: { text: `author ${id}` } },
                        socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                      },
                    },
                  },
                })),
              ],
            },
          ],
        },
      },
      included: [],
    });
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => ({ status: 200, body: raw }) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.equal(posts.length, 2);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /dropped 1 malformed row/.test(line)));
  });

  it("treats a zero-post surface as success (defb8af: empty is an outcome)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const get = scriptGet([{ match: (url) => startOf(url) === "0", respond: () => page([]) }]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.deepEqual(posts, []);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#hiring react OK — 0 post\(s\)/.test(line)));
  });

  it("disposes an opened Transport (not a bare VoyagerGet) in finally", async () => {
    let disposed = false;
    const transport = {
      get: scriptGet([{ match: () => true, respond: () => page([]) }]),
      dispose: async () => {
        disposed = true;
      },
    };
    await fetchLinkedInPosts(oneSurface, COOKIES, transport);
    assert.equal(disposed, true);
  });

  it("exposes the tagged leg-dead guard", () => {
    assert.ok(isLegDead(legDead("because")));
    assert.equal(isLegDead(new Error("plain")), false);
  });
});

describe("Post shape (walk output)", () => {
  it("maps a parsed row to the normalized Post contract", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([idAt(5)]) },
    ]);
    const posts = await fetchLinkedInPosts(
      [{ type: "linkedin", value: "#x" }] as const,
      COOKIES,
      get,
    );
    const first = posts[0] as Post;
    assert.equal(first.platform, "linkedin");
    assert.equal(first.text, `post ${idAt(5)}`);
    assert.equal(first.author, `author ${idAt(5)}`);
    assert.equal(first.permalink, `https://www.linkedin.com/posts/x-${idAt(5)}`);
    assert.equal(first.timestamp, new Date(Number(BigInt(idAt(5)) >> 22n)).toISOString());
  });
});
```

#### 3. Environment-name registration
**File**: `src/config.ts` (MODIFY)
**Changes**: `ENV_NAMES` gains exactly two names this slice: `linkedinTransport` → `LINKEDIN_TRANSPORT` and `curlImpersonateBin` → `CURL_IMPERSONATE_BIN` (both consumed by `src/linkedin-fetch.ts` via `ENV_NAMES.*`). The SDK-era pair stays until Phase 6. Delta splice: insert the two lines after `linkedinCookiesFile`.

```ts
  linkedinCookiesFile: "LINKEDIN_COOKIES_FILE",
  linkedinTransport: "LINKEDIN_TRANSPORT", // ← ADDED this phase
  curlImpersonateBin: "CURL_IMPERSONATE_BIN", // ← ADDED this phase
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test` — new suite green, rest untouched, zero real sleeps
- [x] §13.3 classifier table pinned: CSRF-403 text, Cloudflare-403 challenge, 401 dead-session, bare-400 finder (leg-dead); graphql-envelope-400, 500 queryId-expiry, other statuses (fault)
- [x] curl transport over a fake exec: §3/§10 header set on the args, status-sentinel parse with the separator newline stripped from the body, exec failure → surface fault (not leg-dead), missing `CURL_IMPERSONATE_BIN` throws naming the variable
- [x] Resolver matrix: unset/`curl` opens the curl transport (both pinned); unknown `LINKEDIN_TRANSPORT` throws naming both values
- [x] Walk: partial-page stop, exhaustion (`elements: []`) stop, out-of-order completion reassembled in input order, per-surface fault warns + skips, leg-dead drains then throws ONCE with the sibling pager stopped, pacing gate spaces GET starts `PACE_MS` apart via the injected clock AND concurrent waiters reserve distinct slots (no width-2 burst — pinned with deferred sleeps), dropped rows counted in a warn, zero-post surface logs `OK — 0 post(s)`, an opened Transport disposes in finally

#### Manual Verification:
- [ ] One encoded URL eyeballed against DOCUMENTATION.md §12.7 by eye

(Moved to Phase 6 at the 2026-11-04 checkpoint: "README PC-operations section documents curl-impersonate install + `CURL_IMPERSONATE_BIN` + the transport switch" — Phase 3 owns no README content.)

---

## Phase 4: Payload + PC scripts + alarm + wiring

### Overview

The hand-off mechanism (D5) and the PC tooling: the atomic payload envelope writer/reader with its four degrade classes (D9/D13), the one-shot fetch tick with the single-path rebase+retry push and the episode-edge alarm, the always-on loop, the zero-edit probe gate, the leg-dead alarm email variant, the `LINKEDIN_PAYLOAD_PATH` constant, and the three npm entries with lint/format globs widened to include the new scripts. `tests/fetch-linkedin.test.ts` ships in this phase per the 2026-11-04 checkpoint directive — the GitRunner seam and episode-marker edge get pinned offline, not after the first live push.

### Changes Required:

#### 1. Payload envelope module
**File**: `src/linkedin-payload.ts` (NEW)
**Changes**: Envelope `{ version: 1, writtenAt, posts }`; `writePayloadAtomic` (temp+rename, state.ts precedent); `readPayloadPosts` — ENOENT → quiet absent, over-age (`PAYLOAD_MAX_AGE_MS`) → stale + reason, malformed envelope → malformed + reason, per-row shape validation with drop+count. Never throws (D13): every failure class resolves to a threads-only PayloadRead with its leg state and log line. Plan-review amendment (Step 5, applied plan-local): the temp name rides the shared `stateTempPath` helper from `./state.js` (the inline mint duplicated it).

```ts
/**
 * Payload hand-off between the PC fetch leg and the hosted watch run
 * (design D5/D9/D13): the PC loop writes fetched raw posts to
 * state/linkedin-posts.json (atomic temp+rename, the state.ts precedent)
 * and pushes that single path; the hosted run reads it here.
 *
 * Four failure classes, ALL degrading to threads-only runs (D13 — a
 * LinkedIn fault can never fail a run; the alarm duty for leg faults
 * lives where the fault originates, the PC leg):
 *
 * - absent (ENOENT): the PC-off / never-ran state is NORMAL — one quiet
 *   log line, leg "absent".
 * - stale (over PAYLOAD_MAX_AGE_MS): one log line naming the age, leg
 *   "stale".
 * - malformed envelope (invalid JSON, unknown version, posts not an
 *   array): one warn naming the reason, leg "malformed".
 * - malformed rows: dropped + counted, leg stays "ok".
 *
 * Every class stays operator-visible in run logs; nothing is silent.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LINKEDIN_PAYLOAD_PATH } from "./config.js";
import { stateTempPath } from "./state.js";
import type { Post } from "./types.js";

/** Envelope version; bump on a shape change, keep the reader tolerant. */
export const PAYLOAD_VERSION = 1;

/** Twice the 10-minute cadence: a payload older than this reads as stale. */
export const PAYLOAD_MAX_AGE_MS = 1_800_000;

/** What the PC loop writes: a self-describing, versioned post envelope. */
export interface PayloadEnvelope {
  version: number;
  writtenAt: string;
  posts: Post[];
}

/** LinkedIn leg state for the heartbeat/digest lines (D6/D13). */
export type LegStatus = "ok" | "stale" | "absent" | "malformed";

/** The leg state minus the posts — rides HeartbeatStats and the digest. */
export interface LegLine {
  status: LegStatus;
  /** Age/reason detail for the log and email lines; absent-state omits it. */
  detail?: string;
}

/** What the watch-side reader returns: posts + the leg state (D6/D13). */
export interface PayloadRead {
  posts: Post[];
  /** The leg state; mirrors LegLine.status for the heartbeat/digest lines. */
  leg: LegStatus;
  /** Age/reason detail; omitted when none rides (exactOptionalPropertyTypes). */
  detail?: string;
}

const ACTIVITY_URN_RE = /^urn:li:activity:\d{9,}$/;

/** Per-row shape contract: a row that fails any check is dropped + counted. */
function isValidRow(value: unknown): value is Post {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.platform === "linkedin" &&
    typeof row.id === "string" &&
    ACTIVITY_URN_RE.test(row.id) &&
    typeof row.text === "string" &&
    row.text.length > 0 &&
    typeof row.author === "string" &&
    row.author.length > 0 &&
    typeof row.permalink === "string" &&
    row.permalink.length > 0 &&
    typeof row.timestamp === "string" &&
    !Number.isNaN(Date.parse(row.timestamp))
  );
}

/**
 * Write the payload atomically (sibling unique temp + rename, the
 * writeStateAtomic shape): a crashed tick never leaves a partial payload.
 */
export async function writePayloadAtomic(
  posts: readonly Post[],
  filePath: string = LINKEDIN_PAYLOAD_PATH,
  now: () => number = Date.now,
): Promise<void> {
  const envelope: PayloadEnvelope = {
    version: PAYLOAD_VERSION,
    writtenAt: new Date(now()).toISOString(),
    posts: [...posts],
  };
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, now());
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort temp cleanup
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`payload: atomic write failed for ${filePath}: ${message}`);
  }
}

/**
 * Read + validate the payload. Never throws (D13): every failure class
 * resolves to a threads-only PayloadRead with its leg state and log line.
 * `now` is injectable so the staleness boundary is testable.
 */
export async function readPayloadPosts(
  filePath: string = LINKEDIN_PAYLOAD_PATH,
  now: () => number = Date.now,
): Promise<PayloadRead> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT"
    ) {
      console.log("linkedin: no payload — threads-only run");
      return { posts: [], leg: "absent" };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`linkedin: payload unreadable — ${message} — threads-only run`);
    return { posts: [], leg: "malformed", detail: `unreadable: ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`linkedin: payload not valid JSON — ${message} — threads-only run`);
    return { posts: [], leg: "malformed", detail: `not valid JSON: ${message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn("linkedin: payload is not a JSON object — threads-only run");
    return { posts: [], leg: "malformed", detail: "envelope is not an object" };
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== PAYLOAD_VERSION) {
    const detail = `unknown version ${String(envelope.version)} (expected ${PAYLOAD_VERSION})`;
    console.warn(`linkedin: payload ${detail} — threads-only run`);
    return { posts: [], leg: "malformed", detail };
  }

  const writtenAt = envelope.writtenAt;
  const writtenMs = typeof writtenAt === "string" ? Date.parse(writtenAt) : Number.NaN;
  const ageMs = now() - writtenMs;
  if (!Number.isFinite(writtenMs) || !Number.isFinite(ageMs) || ageMs > PAYLOAD_MAX_AGE_MS) {
    const age = Number.isFinite(ageMs)
      ? `${Math.max(0, Math.round(ageMs / 3_600_000))}h old`
      : "carries an unreadable writtenAt";
    console.log(`linkedin: payload stale (${age}) — threads-only run`);
    return { posts: [], leg: "stale", detail: `payload ${age}` };
  }

  if (!Array.isArray(envelope.posts)) {
    console.warn("linkedin: payload posts is not an array — threads-only run");
    return { posts: [], leg: "malformed", detail: "posts is not an array" };
  }
  const posts: Post[] = [];
  let dropped = 0;
  for (const row of envelope.posts) {
    if (isValidRow(row)) {
      posts.push(row);
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`linkedin: payload carried ${dropped} malformed row(s) — dropped`);
  }
  return {
    posts,
    leg: "ok",
    detail: `payload ${Math.max(0, Math.floor(ageMs / 60_000))} min old`,
  };
}
```

#### 2. Offline suite for the payload hand-off
**File**: `tests/linkedin-payload.test.ts` (NEW)
**Changes**: Pins all four failure classes — absent (ENOENT → quiet null-equivalent), stale (over-age across the injected-clock boundary), malformed envelope (invalid JSON / unknown version / posts not an array), malformed rows (drop + count) — plus the atomic round trip (write → read, no temp litter) and the fixed repo path pin. The suite names all four failure classes; `npm test` cannot pass while the reader silently drops rows.

```ts
/**
 * Offline suite for the payload hand-off (design D9/D13).
 *
 * Pins all four failure classes — absent (ENOENT → quiet null-equivalent),
 * stale (over-age across the injected-clock boundary), malformed envelope
 * (invalid JSON / unknown version / posts not an array), malformed rows
 * (drop + count) — plus the atomic round trip (write → read, no temp
 * litter). The reader cannot silently drop rows or throw while this suite
 * is green.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import {
  PAYLOAD_MAX_AGE_MS,
  PAYLOAD_VERSION,
  type PayloadEnvelope,
  readPayloadPosts,
  writePayloadAtomic,
} from "../src/linkedin-payload.js";
import type { Post } from "../src/types.js";

const T0 = Date.UTC(2026, 9, 26, 9, 14, 0);
const MINUTE = 60_000;

const post = (n: number): Post => ({
  platform: "linkedin",
  id: `urn:li:activity:${(BigInt(T0 - n * MINUTE) << 22n).toString()}`,
  text: `post ${n}`,
  author: `author ${n}`,
  permalink: `https://www.linkedin.com/posts/x-${n}`,
  timestamp: new Date(T0 - n * MINUTE).toISOString(),
});

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function payloadPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-payload-"));
  return join(dir, name);
}

async function seedEnvelope(path: string, envelope: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

const envelopeFor = (posts: Post[], writtenAt = T0): PayloadEnvelope => ({
  version: PAYLOAD_VERSION,
  writtenAt: new Date(writtenAt).toISOString(),
  posts,
});

describe("writePayloadAtomic / readPayloadPosts round trip", () => {
  it("round-trips the envelope: posts survive, leg ok, detail carries the age", async () => {
    const path = await payloadPath("round-trip.json");
    await writePayloadAtomic([post(1), post(2)], path, () => T0);
    const read = await readPayloadPosts(path, () => T0 + 1 * MINUTE);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(1), post(2)]);
    assert.equal(read.detail, "payload 1 min old");
  });

  it("leaves no temp litter behind (atomic write)", async () => {
    const path = await payloadPath("atomic.json");
    await writePayloadAtomic([post(3)], path, () => T0);
    const entries = await readdir(join(path, ".."));
    assert.ok(entries.every((entry) => !entry.endsWith(".tmp")));
  });

  it("uses the fixed repo path beside STATE_PATH by default", () => {
    assert.equal(LINKEDIN_PAYLOAD_PATH, "state/linkedin-posts.json");
  });
});

describe("readPayloadPosts failure classes (D13)", () => {
  it("class: absent — ENOENT resolves quietly to a threads-only read", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const read = await readPayloadPosts(await payloadPath("never-written.json"), () => T0);
    assert.deepEqual(read, { posts: [], leg: "absent" });
    assert.equal(read.detail, undefined);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: no payload — threads-only run/.test(line)));
  });

  it("class: stale — over-age resolves to leg stale naming the age", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const path = await payloadPath("stale.json");
    await seedEnvelope(path, envelopeFor([post(1)]));
    const read = await readPayloadPosts(path, () => T0 + PAYLOAD_MAX_AGE_MS + 1);
    assert.equal(read.leg, "stale");
    assert.deepEqual(read.posts, []);
    assert.match(read.detail ?? "", /payload .*h old/);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: payload stale/.test(line)));
  });

  it("stale boundary: a payload exactly PAYLOAD_MAX_AGE_MS old is still ok", async () => {
    const path = await payloadPath("boundary.json");
    await seedEnvelope(path, envelopeFor([post(1)]));
    const read = await readPayloadPosts(path, () => T0 + PAYLOAD_MAX_AGE_MS);
    assert.equal(read.leg, "ok");
  });

  it("class: malformed — invalid JSON resolves to leg malformed naming the reason", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await payloadPath("bad-json.json");
    await writeFile(path, "{not json", "utf8");
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /not valid JSON/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin: payload not valid JSON/.test(line)));
  });

  it("class: malformed — an unknown version is rejected, not floored", async () => {
    const path = await payloadPath("bad-version.json");
    await seedEnvelope(path, { ...envelopeFor([post(1)]), version: 99 });
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /unknown version 99/);
  });

  it("class: malformed — a non-object envelope is rejected", async () => {
    const path = await payloadPath("not-object.json");
    await seedEnvelope(path, [post(1)]);
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /not an object/);
  });

  it("class: malformed — a posts field that is not an array is rejected", async () => {
    const path = await payloadPath("posts-not-array.json");
    await seedEnvelope(path, {
      version: PAYLOAD_VERSION,
      writtenAt: new Date(T0).toISOString(),
      posts: "nope",
    });
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /posts is not an array/);
  });

  it("class: rows — malformed rows are dropped and counted, leg stays ok", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await payloadPath("mixed-rows.json");
    const junk = {
      platform: "linkedin",
      id: "not-a-urn",
      text: "",
      author: "a",
      permalink: "p",
      timestamp: "nope",
    };
    await seedEnvelope(path, envelopeFor([post(1), junk as unknown as Post, post(2)]));
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(1), post(2)]);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /payload carried 1 malformed row/.test(line)));
  });

  it("never throws on any garbage input", async () => {
    const path = await payloadPath("garbage.json");
    await writeFile(path, "\x00\x01binary junk", "utf8");
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.deepEqual(read.posts, []);
  });
});
```

#### 3. Offline suite for the PC tick
**File**: `tests/fetch-linkedin.test.ts` (NEW)
**Changes**: `pushPayload`'s single-path rebase+retry discipline over a fake GitRunner (stage ONLY the injected path — the 2026-11-04 injection-bug regression pin; no-op guard; one retry; loud double-failure abort; conflict aborts the rebase and never pushes; failing `git commit` throws loudly naming the identity fix and never reaches rebase+push), `fetchTick`'s composition over the injected seams (payload round-trip, single-path git sequence, caller-owned transport stays undisposed even on leg-dead, quiet early return with zero linkedin surfaces BEFORE any resolver runs, env-driven local open rides `resolveLinkedInTransport` — pinned via its unknown-transport rejection), and the leg-dead episode-marker edge (ONE alarm per episode; quiet later dead ticks; restart survival via the file; best-effort default alarm). Zero network, zero real git, zero real email.

```ts
/**
 * Offline suite for the PC fetch tick (slice 4).
 *
 * Pins pushPayload's single-path rebase+retry discipline over a fake
 * GitRunner, fetchTick's composition over the injected seams, and the
 * leg-dead episode-marker edge. Zero network, zero real git, zero real
 * email: GitRunner, Transport, alarm, and env are the test doubles.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type GitRunner,
  fetchTick,
  handleLegDeadEpisode,
  pushPayload,
} from "../scripts/fetch-linkedin.js";
import type { WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import { type Transport, isLegDead, legDead } from "../src/linkedin-fetch.js";
import { PAYLOAD_VERSION, type PayloadEnvelope } from "../src/linkedin-payload.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const T0 = Date.UTC(2026, 9, 26, 9, 14, 0);
const COOKIES: LinkedInCookies = { liAt: "AQE-test", jsessionId: "ajax:0123456789012345678" };

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: [],
  surfaces: [{ type: "linkedin", value: "#hiring react" }],
  recencyHours: 72,
  reasoningEffort: "low",
  scrollRounds: 1,
};

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function workPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-fetch-linkedin-"));
  return join(dir, name);
}

async function exists(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}

/** Fake GitRunner: records every invocation; exit codes scripted per command. */
function scriptGit(script: Partial<Record<string, number | number[]>> = {}): GitRunner & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    const command = args[0] ?? "";
    calls.push([...args]);
    const scripted = script[command];
    const index = calls.filter((entry) => entry[0] === command).length - 1;
    const code = Array.isArray(scripted)
      ? (scripted[index] ?? scripted[scripted.length - 1] ?? 0)
      : (scripted ?? 0);
    return { code };
  };
  return Object.assign(git, { calls });
}

/** Build a §6-shaped 200 body carrying the given activity ids (linkedin-fetch suite shape). */
const pageBody = (ids: readonly string[]): string =>
  JSON.stringify({
    data: {
      searchDashClustersByAll: {
        elements: [
          {
            items: ids.map((id) => ({
              item: {
                searchFeedUpdate: {
                  update: {
                    metadata: { backendUrn: `urn:li:activity:${id}` },
                    commentary: { text: { text: `post ${id}` } },
                    actor: { name: { text: `author ${id}` } },
                    socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                  },
                },
              },
            })),
          },
        ],
      },
    },
    included: [],
  });

/** Distinct activity ids at 1-second spacing (linkedin-fetch suite idiom). */
const idAt = (n: number): string => (BigInt(Date.UTC(2026, 9, 26, 9, 14, n)) << 22n).toString();

const transportFor = (body: string | Error): Transport & { disposeCount: () => number } => {
  let disposeCount = 0;
  const get = async (): Promise<{ status: number; body: string }> => {
    if (body instanceof Error) throw body;
    return { status: 200, body };
  };
  const dispose = async (): Promise<void> => {
    disposeCount += 1;
  };
  const transport: Transport = { get, dispose };
  return Object.assign(transport, { disposeCount: () => disposeCount });
};

describe("pushPayload (single-path rebase+retry discipline)", () => {
  it("stages ONLY the injected path, commits, rebases onto main, and pushes", async () => {
    const payload = await workPath("push-ok.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 3, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
      ["commit", "-m", "linkedin: payload 3 post(s)"],
      ["pull", "--rebase", "origin", "main"],
      ["push"],
    ]);
  });

  it("never stages the module-constant path when a temp payload is injected", async () => {
    const payload = await workPath("push-injected.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 1, payload);
    const addCalls = git.calls.filter((args) => args[0] === "add");
    assert.equal(addCalls.length, 1);
    assert.equal(addCalls[0]?.[1], payload);
    assert.ok(git.calls.every((args) => !args.includes(LINKEDIN_PAYLOAD_PATH)));
  });

  it("throws loudly when the commit itself fails (unconfigured identity) and never pushes", async () => {
    const git = scriptGit({ diff: 1, commit: 128 });
    const payload = await workPath("push-commit-fail.json");
    await assert.rejects(() => pushPayload(git, 2, payload), /payload commit failed/);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 0);
  });

  it("skips commit + rebase + push when nothing is staged (no-op guard)", async () => {
    const payload = await workPath("push-noop.json");
    const git = scriptGit({ diff: 0 });
    await pushPayload(git, 0, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
    ]);
  });

  it("retries once when the push is rejected, then succeeds", async () => {
    const git = scriptGit({ diff: 1, push: [1, 0] });
    await pushPayload(git, 2, await workPath("push-retry.json"));
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 2);
  });

  it("throws after the second push rejection (loud, exit-1 contract)", async () => {
    const git = scriptGit({ diff: 1, push: 1 });
    const payload = await workPath("push-fail.json");
    await assert.rejects(() => pushPayload(git, 2, payload), /payload push failed twice/);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
  });

  it("aborts the rebase loudly on conflict and never pushes", async () => {
    const git = scriptGit({ diff: 1, pull: 1 });
    const payload = await workPath("push-conflict.json");
    await assert.rejects(() => pushPayload(git, 2, payload), /payload push failed twice/);
    const aborts = git.calls.filter((args) => args[0] === "rebase" && args[1] === "--abort");
    assert.equal(aborts.length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
  });
});

describe("fetchTick (compose cookies → transport → walk → payload → push)", () => {
  it("composes the tick end to end: payload written, single-path push, marker cleared", async () => {
    const payload = await workPath("tick-ok.json");
    const marker = await workPath("tick-ok.flag");
    await writeFile(marker, "dead session\n", "utf8"); // a stale episode: a clean tick clears it
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({ diff: 1 });
    const result = await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      transport,
      payloadPath: payload,
      git,
      env: {},
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 1 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.version, PAYLOAD_VERSION);
    assert.equal(new Date(envelope.writtenAt).getTime(), T0);
    const expected: Post = {
      platform: "linkedin",
      id: `urn:li:activity:${idAt(1)}`,
      text: `post ${idAt(1)}`,
      author: `author ${idAt(1)}`,
      permalink: `https://www.linkedin.com/posts/x-${idAt(1)}`,
      timestamp: new Date(Number(BigInt(idAt(1)) >> 22n)).toISOString(),
    };
    assert.deepEqual(envelope.posts, [expected]);
    assert.equal(transport.disposeCount(), 0); // caller-owned: fetchTick never disposes it
    assert.equal(await exists(marker), false); // the healthy tick cleared the episode
    assert.equal(git.calls[0]?.[0], "add");
    assert.equal(git.calls[0]?.[1], payload); // ONLY the injected payload path
    assert.ok(git.calls.some((args) => args[0] === "commit"));
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });

  it("propagates leg-dead without writing the payload, pushing, or disposing", async () => {
    const payload = await workPath("tick-dead.json");
    const marker = await workPath("tick-dead.flag");
    const alarms: string[] = [];
    const transport = transportFor(legDead("bare HTTP 400 — dead session"));
    const git = scriptGit({});
    await assert.rejects(
      () =>
        fetchTick({
          config: CONFIG,
          cookies: COOKIES,
          transport,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
          alarm: async (reason) => {
            alarms.push(reason);
          },
        }),
      (error: unknown) => isLegDead(error) && /dead session/.test(error.reason),
    );
    assert.equal(transport.disposeCount(), 0); // caller-owned, even on failure
    assert.equal(await exists(payload), false); // the walk aborted before any write
    assert.equal(git.calls.length, 0); // no push on a dead leg
    assert.deepEqual(alarms, []); // the alarm policy belongs to the entry/loop callers
  });

  it("returns early when no linkedin surfaces are configured (resolvers never run)", async () => {
    const git = scriptGit({});
    const result = await fetchTick({
      config: { ...CONFIG, surfaces: [{ type: "tag", value: "hiring" }] },
      git,
      env: {}, // no LINKEDIN_COOKIES_FILE — the cookie resolver would throw if reached
      markerPath: await workPath("tick-noop.flag"),
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(git.calls.length, 0);
  });

  it("opens the transport through resolveLinkedInTransport when none is injected", async () => {
    const payloadPath = await workPath("tick-resolver.json");
    const markerPath = await workPath("tick-resolver.flag");
    await assert.rejects(
      () =>
        fetchTick({
          config: CONFIG,
          cookies: COOKIES,
          env: { LINKEDIN_TRANSPORT: "wget" },
          payloadPath,
          git: scriptGit({}),
          markerPath,
        }),
      /LINKEDIN_TRANSPORT="wget" is not one of: curl, playwright/,
    );
  });
});

describe("handleLegDeadEpisode (one alarm per episode)", () => {
  it("alarms once on the healthy→dead edge and writes the marker", async () => {
    const marker = await workPath("episode-1.flag");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, ["dead session"]);
    assert.equal(await readFile(marker, "utf8"), "dead session\n");
  });

  it("stays quiet on later dead ticks (marker already present)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-2.flag");
    await writeFile(marker, "dead session\n", "utf8");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session again", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /leg still dead/.test(line)));
  });

  it("survives a restart: the marker file, not module state, edges the episode", async () => {
    const marker = await workPath("episode-3.flag");
    const alarms: string[] = [];
    const deps = {
      markerPath: marker,
      env: {},
      alarm: async (reason: string): Promise<void> => {
        alarms.push(reason);
      },
    };
    await handleLegDeadEpisode("dead", deps); // pre-restart process
    await handleLegDeadEpisode("dead", deps); // post-restart process: same file, still quiet
    assert.deepEqual(alarms, ["dead"]);
  });

  it("default alarm is best-effort: a broken GMAIL env warns instead of throwing", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-4.flag");
    await handleLegDeadEpisode("dead", { markerPath: marker, env: {} });
    assert.equal(await readFile(marker, "utf8"), "dead\n"); // marker persists despite the send failure
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /alarm not sent/.test(line)));
  });
});
```

#### 4. One-shot fetch tick (PC)
**File**: `scripts/fetch-linkedin.ts` (NEW)
**Changes**: One tick: resolve cookies → resolve transport → fetch all configured linkedin surfaces → write payload → `git add` (single path) + commit + `pull --rebase` + push with one retry; the commit exit code IS checked (an unconfigured clone identity fails loudly instead of pushing nothing). Leg-dead: episode-edge alarm via a repo-local marker file + exit 1. Exports `fetchTick()` / `pushPayload` / `handleLegDeadEpisode` for the loop and tests; entry-guarded main (index.ts guard idiom).

```ts
/**
 * One LinkedIn fetch tick (PC-local leg, design D5/D7):
 *
 *   cookies → transport → voyager walk → payload write → single-path push
 *
 * The push mirrors scripts/commit-state-rebase.sh's discipline, scoped to
 * the payload path: add ONLY state/linkedin-posts.json, no-op guard,
 * commit, pull --rebase origin main, push, one retry on rejection. The bot's
 * commit-back runs the same discipline on a disjoint path, and each
 * file has exactly one writer, so an exact-simultaneous push pair costs
 * the loser one retry — never a lost update. Run from a DEDICATED clone of
 * main (unrelated uncommitted edits would wedge the rebase); the rebase
 * doubles as the loop's own code auto-update.
 *
 * Leg-dead: ONE alarm email per episode (edge-detected via a repo-local
 * marker file beside the payload — never OS temp: a reboot or temp-cleaner
 * must not erase the episode and re-alarm a still-dead leg), then exit 1
 * for this one-shot entry. The loop
 * (scripts/watch-linkedin.ts) catches and keeps running — a cookie-file
 * refresh self-heals on a later tick. Best-effort alarm policy: a broken
 * GMAIL_* configuration must not mask the exit code.
 *
 * Entry-guarded main (index.ts idiom): importing fetchTick stays
 * side-effect free.
 */
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import { resolveEmailConfig, sendLegDeadAlarm } from "../src/email.js";
import {
  type LinkedinSurface,
  type Transport,
  fetchLinkedInPosts,
  isLegDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import { writePayloadAtomic } from "../src/linkedin-payload.js";
import { type LinkedInCookies, resolveLinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

/** Injectable git runner: args → exit code (never rejects). */
export type GitRunner = (args: readonly string[]) => Promise<{ code: number }>;

const execFilePromised = promisify(execFile);

const realGit: GitRunner = async (args) => {
  try {
    await execFilePromised("git", [...args], { windowsHide: true });
    return { code: 0 };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? Number((error as { code: unknown }).code)
        : 1;
    return { code: Number.isInteger(code) ? code : 1 };
  }
};

/** Outcome of one tick; the loop and tests assert on it. */
export interface FetchTickResult {
  wrote: boolean;
  pushed: boolean;
  postCount: number;
}

export interface FetchTickDeps {
  /** Pre-resolved config. Default: loadWatcherConfig() — fail-visible. */
  config?: WatcherConfig;
  /** Pre-resolved cookies. Default: resolveLinkedInCookies(env). */
  cookies?: LinkedInCookies;
  /** Opened transport. Default: resolveLinkedInTransport(env, cookies). The caller owns a provided transport. */
  transport?: Transport;
  /** Payload location. Default: LINKEDIN_PAYLOAD_PATH (the pushed path). */
  payloadPath?: string;
  /** Git runner. Default: the real git on PATH. */
  git?: GitRunner;
  /** Environment for the resolvers. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Episode alarm. Default: sendLegDeadAlarm, best-effort (warn on failure). */
  alarm?: (reason: string) => Promise<void>;
  /** Episode marker file. Default: repo-local beside the payload (survives restarts). */
  markerPath?: string;
  /** Clock for the payload stamp. Default: Date.now. */
  now?: () => number;
}

/**
 * Episode marker BESIDE THE PAYLOAD (repo-local, persistent): present = the
 * alarm already fired for this episode. OS temp was rejected 2026-11-04 —
 * a reboot or temp-cleaner erased it, and a still-dead leg after a PC
 * restart re-alarmed, breaking one-alarm-per-episode exactly when the
 * operator needs quiet. state/ in the dedicated clone is loop-owned and
 * persistent; the flag is untracked (pushPayload stages only the payload
 * path; the bot commits only seen-posts.json), so rebase never touches it.
 */
const DEFAULT_MARKER = join(dirname(LINKEDIN_PAYLOAD_PATH), "linkedin-leg-dead.flag");

async function markerExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Send the leg-dead alarm ONCE per episode: the marker file edges the
 * healthy→dead transition, so a 144-tick dead day emails once. Every dead
 * tick still warns in the run log.
 */
export async function handleLegDeadEpisode(
  reason: string,
  deps: FetchTickDeps = {},
): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  const env = deps.env ?? process.env;
  if (await markerExists(marker)) {
    console.warn(`fetch-linkedin: leg still dead — ${reason} (alarm already sent this episode)`);
    return;
  }
  await writeFile(marker, `${reason}\n`, "utf8");
  console.error(`fetch-linkedin: LEG DEAD — ${reason}`);
  const alarm =
    deps.alarm ??
    (async (alarmReason: string) => {
      try {
        await sendLegDeadAlarm(alarmReason, resolveEmailConfig(env));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch-linkedin: alarm not sent — ${message}`);
      }
    });
  await alarm(reason);
}

/** Clear a prior episode marker on a healthy tick (the dead→healthy edge). */
async function clearEpisodeMarker(deps: FetchTickDeps): Promise<void> {
  const marker = deps.markerPath ?? DEFAULT_MARKER;
  if (await markerExists(marker)) {
    await rm(marker, { force: true });
    console.log("fetch-linkedin: leg recovered — episode cleared");
  }
}

/**
 * Commit + push ONLY the payload path with the rebase+retry discipline.
 * The rebase replays the payload commit onto origin/main; a conflict on
 * the payload path is impossible while it has one writer, so a conflict
 * aborts loudly instead of skipping (the bot's whitelist never applies —
 * its seen-posts.json replay touches a disjoint path).
 */
export async function pushPayload(
  git: GitRunner,
  postCount: number,
  filePath: string = LINKEDIN_PAYLOAD_PATH,
): Promise<void> {
  await git(["add", filePath]);
  const staged = await git(["diff", "--cached", "--quiet"]);
  if (staged.code === 0) {
    console.log("git: payload unchanged; nothing to commit");
    return;
  }
  // The commit exit code IS checked: an unconfigured git identity in a
  // fresh dedicated clone is the classic first-tick failure, and skipping
  // the check would let rebase+push succeed while pushing NOTHING — a
  // silent no-op tick reporting pushed=true (fail-visible doctrine).
  const commit = await git(["commit", "-m", `linkedin: payload ${postCount} post(s)`]);
  if (commit.code !== 0) {
    throw new Error(
      "git: payload commit failed — configure the clone's git identity first (git config user.name + user.email)",
    );
  }
  const attempt = async (): Promise<boolean> => {
    const rebase = await git(["pull", "--rebase", "origin", "main"]);
    if (rebase.code !== 0) {
      console.error("git: rebase conflicted — aborting; a non-payload change cannot replay");
      await git(["rebase", "--abort"]);
      return false;
    }
    return (await git(["push"])).code === 0;
  };
  const pushed = (await attempt()) || (await attempt());
  if (!pushed) {
    throw new Error("git: payload push failed twice — run aborted");
  }
  console.log("git: pushed payload commit");
}

export async function fetchTick(deps: FetchTickDeps = {}): Promise<FetchTickResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const config = deps.config ?? (await loadWatcherConfig());
  const surfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  if (surfaces.length === 0) {
    console.log("fetch-linkedin: no linkedin surfaces configured — nothing to do");
    return { wrote: false, pushed: false, postCount: 0 };
  }
  const cookies = deps.cookies ?? resolveLinkedInCookies(env);
  const transport = deps.transport ?? (await resolveLinkedInTransport(env, cookies));
  let posts: Post[];
  try {
    // The bare GET rides the walk (never the Transport object — the walk
    // disposes any Transport it receives); disposal is this finally's job alone.
    posts = await fetchLinkedInPosts(surfaces, cookies, transport.get);
  } finally {
    // The caller owns a provided transport; a locally opened one dies here.
    if (deps.transport === undefined) await transport.dispose();
  }
  const payloadPath = deps.payloadPath ?? LINKEDIN_PAYLOAD_PATH;
  await writePayloadAtomic(posts, payloadPath, now);
  console.log(`payload: wrote ${posts.length} post(s) — ${payloadPath}`);
  await pushPayload(deps.git ?? realGit, posts.length, payloadPath);
  await clearEpisodeMarker(deps);
  return { wrote: true, pushed: true, postCount: posts.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchTick().catch(async (error: unknown) => {
    if (isLegDead(error)) {
      await handleLegDeadEpisode(error.reason);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`fetch-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
```

#### 5. Always-on loop (PC)
**File**: `scripts/watch-linkedin.ts` (NEW)
**Changes**: `while (true) { await fetchTick(); await sleep(TICK_MS); }` with `TICK_MS = 600_000` module constant; catches `LegDeadError` (episode-edge alarm + warn + continue), catches per-tick faults (warn + continue); Ctrl-C exits.

```ts
/**
 * The always-on PC loop (design D1/D7): one fetch tick, then a 10-minute
 * sleep, forever. Leg-dead edges send ONE alarm per episode (the marker
 * file in scripts/fetch-linkedin.ts) and the loop keeps running — a
 * cookie-file refresh self-heals on a later tick without a restart. Any
 * other tick fault warns and the loop continues; Ctrl-C stops it.
 *
 * Run from a dedicated clone of main: `npm run watch-linkedin`.
 */
import { isLegDead } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";

/** The 10-minute cadence, in code (D1: an always-on npm script). */
const TICK_MS = 600_000;

async function main(): Promise<void> {
  for (;;) {
    try {
      await fetchTick();
    } catch (error) {
      if (isLegDead(error)) {
        await handleLegDeadEpisode(error.reason);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`watch-linkedin: tick FAILED — ${message}`);
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, TICK_MS);
    });
  }
}

void main();
```

#### 6. Transport gate probe (PC)
**File**: `scripts/probe-linkedin.ts` (NEW)
**Changes**: Zero-edit probe (the probe-judge pattern): loads `watcher.config.json` surfaces, resolves cookies + transport, fetches the first configured surface (count 10), asserts ≥2 posts, `probe:` log lines, exit 1 on leg-dead/HTTP fault/unparsable/short. Plan-review amendment (Step 5, applied plan-local): the transport selection reads `process.env[ENV_NAMES.linkedinTransport]` instead of the string literal.

```ts
/**
 * LinkedIn transport gate (design D8, the probe-judge pattern): drive the
 * SAME production stack — cookie resolver, transport selection, §12.7 URL
 * builder, response parser — against the first configured linkedin
 * surface, one small page.
 *
 * Exit 1 on leg-dead, an HTTP fault, an unparsable 200, or fewer than 2
 * posts. Operator protocol (Nov 1 research rule): run twice ≥6h apart with
 * stored cookies only before trusting the loop; re-run after any
 * LINKEDIN_TRANSPORT change.
 *
 * Usage: npx tsx scripts/probe-linkedin.ts   (needs LINKEDIN_COOKIES_FILE;
 * runs from the repo root — it loads watcher.config.json at startup)
 */
import { loadWatcherConfig } from "../src/config-file.js";
import { ENV_NAMES } from "../src/config.js";
import {
  type LinkedinSurface,
  isLegDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";
import { buildSearchUrl, parseSearchResponse } from "../src/linkedin-voyager.js";

const CONFIG = await loadWatcherConfig();

const surfaces = CONFIG.surfaces.filter(
  (surface): surface is LinkedinSurface => surface.type === "linkedin",
);
if (surfaces.length === 0) {
  console.error("probe: no linkedin surfaces configured in watcher.config.json");
  process.exit(1);
}
const surface = surfaces[0] as LinkedinSurface;

try {
  const cookies = resolveLinkedInCookies();
  const transportSelection = process.env[ENV_NAMES.linkedinTransport]?.trim() || "curl";
  console.log(
    `probe: transport ${transportSelection} — GET voyager search for "${surface.value}" (count 10)`,
  );
  const started = Date.now();
  const transport = await resolveLinkedInTransport(undefined, cookies);
  try {
    const response = await transport.get(buildSearchUrl(surface.value, 0, 10));
    const elapsed = Date.now() - started;
    if (response.status !== 200) {
      console.error(`probe: HTTP ${response.status} — ${response.body.slice(0, 120)}`);
      process.exit(1);
    }
    const parsed = parseSearchResponse(response.body);
    if (parsed.kind !== "ok") {
      console.error(`probe: 200 body unparsable — ${parsed.reason}`);
      process.exit(1);
    }
    console.log(
      `probe: ${elapsed}ms — HTTP 200 — ${parsed.posts.length} post(s), ${parsed.dropped} dropped`,
    );
    if (parsed.posts.length < 2) {
      console.error("probe: fewer than 2 posts — the endpoint answered but the leg looks wrong");
      process.exit(1);
    }
    console.log("probe: all checks passed");
  } finally {
    await transport.dispose();
  }
} catch (error) {
  if (isLegDead(error)) {
    console.error(`probe: LEG DEAD — ${error.reason}`);
    process.exit(1);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`probe: FAILED — ${message}`);
  process.exit(1);
}
```

#### 7. Leg-dead alarm email variant + digest leg line
**File**: `src/email.ts` (MODIFY)
**Changes**: Four changes. (1) import: `import type { LegLine } from "./linkedin-payload.js";` (2) `buildDigest` gains a trailing `leg?: LegLine` param; the line renders only when the state is not `ok` (the ` — detail` suffix rides the `legDetailSuffix` helper — biome rejected the inline nested ternary at >100 cols; the proven whole-file merge is slice-recon/work/email.ts) (3) `sendDigest`: signature gains `leg?: LegLine` (trailing, after transport) and passes it (4) the leg-dead alarm variant (email-variant guidance shape: buildX pure + sendX thin; the PC loop caller owns the best-effort try/catch policy).

```ts
// email.ts — MODIFY (slice 4): four changes.
// 1) import: import type { LegLine } from "./linkedin-payload.js";
// 2) buildDigest gains the trailing leg param; the line renders only when the state is not ok
//    (the ` — detail` suffix rides the legDetailSuffix helper — biome rejected the inline
//    nested ternary at >100 cols; the proven whole-file merge is slice-recon/work/email.ts):
export function buildDigest(posts: readonly Post[], leg?: LegLine): string | null {
  const subject = buildSubject(posts);
  if (subject === null) return null;
  const items = posts.map((post, index) => {
    const author = post.author.replace(/^@+/, "");
    const platformToken = post.platform === "threads" ? "" : "[linkedin] ";
    return `${index + 1}. ${platformToken}${post.text}\n   — @${author}\n   ${post.permalink}`;
  });
  const legLine =
    leg !== undefined && leg.status !== "ok"
      ? `\n\nLinkedIn leg: ${leg.status}${legDetailSuffix(leg)}`
      : "";
  return `${subject}\n\n${items.join("\n\n")}${legLine}\n`;
}

/** The ` — detail` suffix for a leg line; empty when no detail rides. */
function legDetailSuffix(leg: LegLine): string {
  return leg.detail !== undefined && leg.detail !== "" ? ` — ${leg.detail}` : "";
}
// 3) sendDigest: signature gains `leg?: LegLine` (trailing, after transport) and passes it —
//    const text = buildDigest(posts, leg);
// 4) the leg-dead alarm variant (email-variant guidance shape: buildX pure + sendX thin;
//    the PC loop caller owns the best-effort try/catch policy):
export function buildLegDeadAlarmText(reason: string): string {
  return [
    "The LinkedIn fetch leg is dead.",
    "",
    `Signature: ${reason}`,
    "",
    "The loop keeps running. Refresh the cookie file (LINKEDIN_COOKIES_FILE —",
    "re-export the pair from a logged-in browser) and the next tick heals;",
    "no restart needed. Failure matrix: DOCUMENTATION.md §13; session: §14.",
  ].join("\n");
}
export async function sendLegDeadAlarm(
  reason: string,
  config: EmailConfig,
  transport?: Transporter,
): Promise<string | undefined> {
  const messageId = await sendText(
    "LinkedIn fetch leg is dead — refresh the cookie file",
    buildLegDeadAlarmText(reason),
    config,
    transport,
  );
  console.log("email: sent leg-dead alarm");
  return messageId;
}
```

#### 8. Payload path constant
**File**: `src/config.ts` (MODIFY)
**Changes**: Add the `LINKEDIN_PAYLOAD_PATH` constant below the `ENV_NAMES` block (position immaterial to every gate; the design's fence A lands it beside the block). No `ENV_NAMES` changes this phase.

```ts
/**
 * PC-leg payload (design D5): the local voyager loop writes fetched raw
 * posts here and pushes this single path to main; the hosted run reads it
 * (src/linkedin-payload.ts). Exactly one writer per file — the bot owns
 * seen-posts.json, the PC owns this one — so the two rebase+retry push
 * disciplines can never lose each other's commits.
 */
export const LINKEDIN_PAYLOAD_PATH = "state/linkedin-posts.json";
```

#### 9. npm entries + lint/format globs
**File**: `package.json` (MODIFY)
**Changes**: scripts gain `fetch-linkedin`, `watch-linkedin`, `probe-linkedin` (tsx entries); the lint glob gains the three script paths; the format glob gains them (closing the lint/format gap the developer flagged). (Dependency removal is Phase 6.)

```json
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src tests scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/hooks",
    "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts",
    "fetch-linkedin": "tsx scripts/fetch-linkedin.ts",
    "watch-linkedin": "tsx scripts/watch-linkedin.ts",
    "probe-linkedin": "tsx scripts/probe-linkedin.ts",
    "prepare": "husky"
  },
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test` — new suites green, rest untouched
- [x] Payload failure classes pinned: ENOENT → quiet absent; over-age (injected clock across `PAYLOAD_MAX_AGE_MS`) → stale + age; invalid JSON / unknown version / posts-not-array → malformed + reason; malformed rows → drop + count; exact-boundary age stays ok
- [x] Round trip: write → read preserves posts; no temp litter after an atomic write
- [x] `fetchTick` composes cookies → transport → walk → payload → `pushPayload`; the push adds ONLY `state/linkedin-posts.json`, rebases, pushes, retries once, aborts loud on conflict
- [x] Leg-dead episode edge: marker file gates ONE alarm; healthy tick clears it
- [x] package.json: three npm entries + lint/format globs include the three scripts
- [x] `tests/fetch-linkedin.test.ts` (added at the 2026-11-04 checkpoint directive — the GitRunner seam exists for exactly this) pins, over a fake GitRunner + temp payloadPath: `pushPayload` stages ONLY the injected path, commits, rebases, pushes, retries once on rejection, aborts loud on double failure, no-ops without staging, and aborts the rebase without pushing on conflict; `fetchTick` composes cookies → transport → walk → payload → push (caller-owned transport stays undisposed even on a leg-dead failure; the env-driven local open rides `resolveLinkedInTransport` — pinned via its unknown-transport rejection; zero linkedin surfaces returns quietly before any resolver runs); the episode marker fires ONE alarm on the healthy→dead edge, stays quiet on later dead ticks, clears on a healthy tick, and survives a simulated restart (repo-local beside the payload, never OS temp), and the default alarm is best-effort (broken GMAIL env warns, never throws), and a failing `git commit` (unconfigured clone identity) throws loudly naming the fix and never reaches rebase+push

#### Manual Verification:
- [ ] First live push happens from a dedicated clone under probe supervision
- [ ] `npm run probe-linkedin` exits 1 on a corrupt cookie copy, 0 on a live leg
- [ ] Conflict rehearsal: land a bot commit between the PC's checkout and its push; the rebase+retry push succeeds (Verification Notes discipline, D5)
- [ ] Session-dead rehearsal: corrupt the cookie-file copy → the tick throws leg-dead → exactly ONE alarm email and the loop continues; restore the file → the next tick heals (Verification Notes, D7)

---

## Phase 5: Watch-side ingest re-key

### Overview

The hosted funnel reads the PC leg's pushed payload instead of driving the SDK: `WatcherDeps.linkedinFetch` keeps its name/position but is retyped to `(payloadPath, now) => Promise<PayloadRead>` with production default `readPayloadPosts`; the acquisition arm keeps partition, log labels, and the D12 belt catch; the token warn dies. `HeartbeatStats.linkedinLeg` rides the heartbeat line on every run and the digest line on every not-ok run (D13) — a threads-only run is permanently quiet, so "no matches" must stay distinguishable from "LinkedIn dark for a week". Payload faults degrade per D13 and never exit nonzero.

### Changes Required:

#### 1. Heartbeat leg line
**File**: `src/heartbeat.ts` (MODIFY)
**Changes**: `HeartbeatStats` gains `readonly linkedinLeg?: LegLine` (attached only when the payload reader ran, exactOptionalPropertyTypes-style); the heartbeat body gains one leg line inside the funnel block (`LinkedIn leg: ok — payload N min old` / `LinkedIn leg: DARK — payload N h old` / `LinkedIn leg: absent — no payload file` / `LinkedIn leg: malformed — <reason>`); new export `linkedinLegLine(leg)` renders the line; `buildHeartbeatBody` calls it behind the attached-vs-undefined conditional spread. The whole proven merged file is the fence below.

```ts
import type { Transporter } from "nodemailer";
import { type EmailConfig, sendText } from "./email.js";
import type { LegLine } from "./linkedin-payload.js";
/**
 * No-match heartbeat (Phase 9).
 *
 * The watcher sends no email when a run finds no match, so the operator has
 * no signal that the pipeline is alive — and no way to see why a run found
 * nothing without opening the Actions log. Measured 2026-10-25: the
 * authenticated feed carries ~300 recent posts per run, and zero-match runs
 * are the normal case. This module builds and sends a status email for
 * those runs: the scan funnel plus the candidate posts that came closest,
 * each with its permalink.
 *
 * The candidate net comes from watcher.config.json ("candidateTerms") and is
 * deliberately broader than the keyword list the judge uses: a post that
 * names no configured keyword can still be worth a human look.
 *
 * The LinkedIn leg line (D6/D13): every run with a linkedin surface renders
 * one leg line inside the funnel block. A threads-only run is permanently
 * quiet, and the PC-side leg alarm cannot fire while the PC is off — the
 * hosted heartbeat is the only surface that can say "LinkedIn dark" then.
 */
import type { Post } from "./types.js";

/** Maximum candidates listed in one heartbeat email. */
const MAX_CANDIDATES = 10;

/** Funnel counts for one run, collected by src/index.ts. */
export interface HeartbeatStats {
  /** ISO 8601 UTC timestamp of the run start. */
  ranAt: string;
  /** Unique posts after cross-surface dedupe. */
  unique: number;
  /** Posts kept by the recency filter. */
  recent: number;
  /** Recency window in hours. */
  recencyHours: number;
  /** Posts sent to the LLM judge (all recency+seen survivors). */
  judged: number;
  /** Posts the judge marked relevant AND located. */
  relevantLocated: number;
  /** Posts the judge could not evaluate. */
  skipped: number;
  /** Actions run URL, when the workflow provides the ambient variables. */
  runUrl?: string;
  /** LinkedIn leg state (D6): attached only when the payload reader ran this run. */
  linkedinLeg?: LegLine;
}

/** One candidate post plus why it is in the list. */
export interface Candidate {
  post: Post;
  /** "judged" went to the LLM judge; "near-miss" only the broader net. */
  reason: "judged" | "near-miss";
}

/**
 * True when the text mentions any candidate term (case-insensitive).
 */
export function matchesCandidateTerms(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.trim().toLowerCase()));
}

/**
 * Pick the posts worth a human look: every judged candidate first (the
 * strongest signal), then the newest near-misses, capped at `limit`.
 */
export function selectCandidates(
  recent: readonly Post[],
  judged: readonly Post[],
  terms: readonly string[],
  limit: number = MAX_CANDIDATES,
): Candidate[] {
  const out: Candidate[] = judged.map((post) => ({
    post,
    reason: "judged" as const,
  }));
  if (out.length >= limit) return out.slice(0, limit);

  const judgedIds = new Set(judged.map((post) => post.id));
  const nearMisses = recent
    .filter((post) => !judgedIds.has(post.id) && matchesCandidateTerms(post.text, terms))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  for (const post of nearMisses) {
    if (out.length >= limit) break;
    out.push({ post, reason: "near-miss" });
  }
  return out;
}

/** One-line text preview: whitespace collapsed, truncated at `max` chars. */
export function snippet(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Age of a post in whole hours relative to `now`; 0 when unparseable. */
export function ageHours(timestamp: string, now: number): number {
  const takenAt = new Date(timestamp).getTime();
  if (!Number.isFinite(takenAt)) return 0;
  return Math.max(0, Math.floor((now - takenAt) / 3_600_000));
}

/** Subject line for the heartbeat email. */
export function buildHeartbeatSubject(stats: HeartbeatStats): string {
  return `loker-watcher: 0 new matches — ${stats.recent} post(s) scanned`;
}

/**
 * The LinkedIn leg line inside the heartbeat funnel (D6/D13): ok names the
 * payload age, DARK names the staleness, absent names the missing file,
 * malformed names the reason. Four states, always exactly one line — the
 * run log tells why, this line says how dark the leg is.
 */
export function linkedinLegLine(leg: LegLine): string {
  const detail = leg.detail !== undefined && leg.detail !== "" ? ` — ${leg.detail}` : "";
  if (leg.status === "ok") return `LinkedIn leg: ok${detail}`;
  if (leg.status === "stale") return `LinkedIn leg: DARK${detail}`;
  if (leg.status === "absent") return "LinkedIn leg: absent — no payload file";
  return `LinkedIn leg: malformed${detail}`;
}

/** Plain-text body: the funnel, then the candidates with permalinks. */
export function buildHeartbeatBody(
  stats: HeartbeatStats,
  candidates: readonly Candidate[],
  now: number,
): string {
  const lines: string[] = [
    `loker-watcher — ${stats.ranAt}`,
    "",
    "0 new job matches.",
    "",
    `  ${stats.unique} unique post(s)`,
    `  ${stats.recent} within ${stats.recencyHours}h`,
    `  ${stats.judged} judged candidate(s)`,
    `  ${stats.relevantLocated} relevant + located`,
    `  ${stats.skipped} skipped by the judge`,
    ...(stats.linkedinLeg !== undefined ? [`  ${linkedinLegLine(stats.linkedinLeg)}`] : []),
    "",
  ];

  if (candidates.length === 0) {
    lines.push("No candidate posts in this run.");
  } else {
    lines.push(`Closest ${candidates.length} candidate(s), newest first:`);
    lines.push("");
    candidates.forEach((candidate, index) => {
      const age = ageHours(candidate.post.timestamp, now);
      const tag = candidate.reason === "judged" ? " [judged]" : "";
      lines.push(`${index + 1}. @${candidate.post.author} — ${age}h ago${tag}`);
      lines.push(`   ${snippet(candidate.post.text)}`);
      lines.push(`   ${candidate.post.permalink}`);
      lines.push("");
    });
  }

  if (stats.runUrl !== undefined) {
    lines.push(`Run: ${stats.runUrl}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Send the heartbeat email. Reuses the digest transport path so both emails
 * share one credential resolution and one fail-visible error shape.
 * Accepts an optional Transporter for unit testing, exactly as sendDigest
 * does — without it the function would open a real Gmail connection.
 */
export async function sendHeartbeat(
  stats: HeartbeatStats,
  candidates: readonly Candidate[],
  config: EmailConfig,
  now: number = Date.now(),
  transport?: Transporter,
): Promise<void> {
  await sendText(
    buildHeartbeatSubject(stats),
    buildHeartbeatBody(stats, candidates, now),
    config,
    transport,
  );
  console.log(
    `heartbeat: sent status email — ${stats.recent} post(s) scanned, ${candidates.length} candidate(s)`,
  );
}
```

#### 2. Heartbeat suite with leg-line pins
**File**: `tests/heartbeat.test.ts` (MODIFY)
**Changes**: Pins the leg line for all four states — a dedicated `linkedinLegLine (D13)` describe with one `it` per state (ratified at the 2026-11-04 checkpoint: the four-state coverage rides the unit renderer, not four body-level tests, because the body's only conditional is attached-vs-not) — plus the body wiring: the funnel renders the stale and ok lines with the two-space indent, and omits the line entirely when the field was never attached (pre-reader runs). The whole proven merged suite is the fence below.

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import {
  type Candidate,
  type HeartbeatStats,
  ageHours,
  buildHeartbeatBody,
  buildHeartbeatSubject,
  linkedinLegLine,
  matchesCandidateTerms,
  selectCandidates,
  sendHeartbeat,
  snippet,
} from "../src/heartbeat.js";
import type { Post } from "../src/types.js";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

// The candidate net is a required parameter (Phase 10): it comes from
// watcher.config.json, so every case below passes an explicit list.
const TERMS = ["developer", "software", "engineer", "jakarta", "remote"];

function post(id: string, text: string, hoursAgo: number, author = "tester"): Post {
  return {
    platform: "threads",
    id,
    text,
    author,
    permalink: `https://www.threads.com/@${author}/post/${id}`,
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  };
}

const STATS: HeartbeatStats = {
  ranAt: "2026-10-25T12:00:00.000Z",
  unique: 337,
  recent: 303,
  recencyHours: 72,
  judged: 1,
  relevantLocated: 0,
  skipped: 0,
};

describe("matchesCandidateTerms", () => {
  it("matches adjacent dev terms", () => {
    assert.equal(matchesCandidateTerms("Hiring a software engineer", TERMS), true);
    assert.equal(matchesCandidateTerms("WE ARE HIRING developers", TERMS), true);
  });

  it("matches Indonesian cities and remote", () => {
    assert.equal(matchesCandidateTerms("Lowongan di Jakarta", TERMS), true);
    assert.equal(matchesCandidateTerms("100% remote role", TERMS), true);
  });

  it("matches mixed-case and padded terms", () => {
    assert.equal(matchesCandidateTerms("frontend dev wanted", ["Frontend"]), true);
    assert.equal(matchesCandidateTerms("100% remote role", [" Remote "]), true);
  });

  it("rejects unrelated posts", () => {
    assert.equal(matchesCandidateTerms("HIRING Barista Waiter", TERMS), false);
    assert.equal(matchesCandidateTerms("Kitchen crew Johor Bahru", TERMS), false);
  });
});

describe("selectCandidates", () => {
  it("puts judged candidates first", () => {
    const lead = post("m1", "Hiring React dev", 5);
    const near = post("n1", "Software engineer Jakarta", 1);
    const result = selectCandidates([lead, near], [lead], TERMS, 10);
    assert.equal(result[0]?.reason, "judged");
    assert.equal(result[0]?.post.id, "m1");
    assert.equal(result[1]?.reason, "near-miss");
  });

  it("orders near-misses newest first", () => {
    const older = post("a", "Software engineer", 40);
    const newer = post("b", "Software engineer", 2);
    const result = selectCandidates([older, newer], [], TERMS, 10);
    assert.deepEqual(
      result.map((c) => c.post.id),
      ["b", "a"],
    );
  });

  it("does not repeat a judged candidate as a near-miss", () => {
    const lead = post("m1", "Hiring React dev", 5);
    const result = selectCandidates([lead], [lead], TERMS, 10);
    assert.equal(result.length, 1);
  });

  it("caps the list at the limit", () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(`p${i}`, "Software engineer", i));
    assert.equal(selectCandidates(posts, [], TERMS, 10).length, 10);
    assert.equal(selectCandidates(posts, [], TERMS, 3).length, 3);
  });

  it("returns an empty list when nothing qualifies", () => {
    assert.deepEqual(selectCandidates([post("x", "Barista", 1)], [], TERMS, 10), []);
  });
});

describe("snippet", () => {
  it("collapses whitespace", () => {
    assert.equal(snippet("a\n  b\tc"), "a b c");
  });

  it("truncates long text with an ellipsis", () => {
    const long = "x".repeat(300);
    const out = snippet(long, 50);
    assert.equal(out.length, 50);
    assert.ok(out.endsWith("…"));
  });

  it("leaves short text untouched", () => {
    assert.equal(snippet("short"), "short");
  });
});

describe("ageHours", () => {
  it("computes whole hours", () => {
    assert.equal(ageHours(new Date(NOW - 5 * 3_600_000).toISOString(), NOW), 5);
  });

  it("returns 0 for unparseable timestamps", () => {
    assert.equal(ageHours("not-a-date", NOW), 0);
  });
});

describe("buildHeartbeatSubject", () => {
  it("names the scanned count", () => {
    assert.equal(
      buildHeartbeatSubject(STATS),
      "loker-watcher: 0 new matches — 303 post(s) scanned",
    );
  });
});

describe("linkedinLegLine (D13)", () => {
  it("renders ok with the payload-age detail", () => {
    assert.equal(
      linkedinLegLine({ status: "ok", detail: "payload 3 min old" }),
      "LinkedIn leg: ok — payload 3 min old",
    );
  });

  it("renders DARK with the staleness detail", () => {
    assert.equal(
      linkedinLegLine({ status: "stale", detail: "payload 2h old" }),
      "LinkedIn leg: DARK — payload 2h old",
    );
  });

  it("renders absent without detail", () => {
    assert.equal(linkedinLegLine({ status: "absent" }), "LinkedIn leg: absent — no payload file");
  });

  it("renders malformed with the reason detail", () => {
    assert.equal(
      linkedinLegLine({ status: "malformed", detail: "not valid JSON: x" }),
      "LinkedIn leg: malformed — not valid JSON: x",
    );
  });
});

describe("buildHeartbeatBody", () => {
  it("includes the funnel counts", () => {
    const body = buildHeartbeatBody(STATS, [], NOW);
    assert.ok(body.includes("337 unique post(s)"));
    assert.ok(body.includes("303 within 72h"));
    assert.ok(body.includes("1 judged candidate(s)"));
    assert.ok(body.includes("0 relevant + located"));
  });

  it("renders the leg line inside the funnel block when the reader ran (stale state)", () => {
    const body = buildHeartbeatBody(
      { ...STATS, linkedinLeg: { status: "stale", detail: "payload 2h old" } },
      [],
      NOW,
    );
    assert.ok(body.includes("  LinkedIn leg: DARK — payload 2h old"));
  });

  it("renders the ok leg with the payload age", () => {
    const body = buildHeartbeatBody(
      { ...STATS, linkedinLeg: { status: "ok", detail: "payload 3 min old" } },
      [],
      NOW,
    );
    assert.ok(body.includes("  LinkedIn leg: ok — payload 3 min old"));
  });

  it("omits the leg line entirely when the reader never ran", () => {
    assert.ok(!buildHeartbeatBody(STATS, [], NOW).includes("LinkedIn leg:"));
  });

  it("lists candidates with permalinks", () => {
    const candidates: Candidate[] = [
      { post: post("c1", "Hiring React dev in Jakarta", 2, "techco"), reason: "judged" },
    ];
    const body = buildHeartbeatBody(STATS, candidates, NOW);
    assert.ok(body.includes("1. @techco — 2h ago [judged]"));
    assert.ok(body.includes("https://www.threads.com/@techco/post/c1"));
  });

  it("says so when there are no candidates", () => {
    assert.ok(buildHeartbeatBody(STATS, [], NOW).includes("No candidate posts"));
  });

  it("appends the run URL when present", () => {
    const body = buildHeartbeatBody(
      { ...STATS, runUrl: "https://github.com/o/r/actions/runs/1" },
      [],
      NOW,
    );
    assert.ok(body.includes("Run: https://github.com/o/r/actions/runs/1"));
  });
});

describe("sendHeartbeat", () => {
  it("sends the subject and body through the transport", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: { subject: string; text: string }) => {
        captured = options;
        return { messageId: "hb-1" };
      },
    } as unknown as Transporter;

    await sendHeartbeat(STATS, [], { user: "a@gmail.com", pass: "p" }, NOW, mockTransport);

    assert.ok(captured !== null);
    const mail = captured as { subject: string; text: string };
    assert.equal(mail.subject, "loker-watcher: 0 new matches — 303 post(s) scanned");
    assert.ok(mail.text.includes("337 unique post(s)"));
  });

  it("logs the scanned and candidate counts", async () => {
    const mockTransport = {
      sendMail: async () => ({ messageId: "hb-2" }),
    } as unknown as Transporter;
    const candidates: Candidate[] = [
      { post: post("c1", "Software engineer Jakarta", 1), reason: "near-miss" },
    ];

    await sendHeartbeat(STATS, candidates, { user: "a@gmail.com", pass: "p" }, NOW, mockTransport);
    // No assertion on stdout; the call completing without a throw is the
    // contract. The body content is covered by buildHeartbeatBody above.
    assert.equal(candidates.length, 1);
  });
});
```

#### 3. Pipeline entry re-key
**File**: `src/index.ts` (MODIFY)
**Changes**: Acquisition arm re-key: partition/labels/D14 startup line unchanged; the `resolveLinkedApiTokens` call + token warn are deleted; the arm reads the payload through the re-keyed `linkedinFetch` dep inside the D12 belt catch; single-array return and everything downstream untouched. Payload faults follow D13: ENOENT → quiet log; stale → age log; malformed envelope → warn; malformed rows → drop+count — never exit nonzero. Proven corrections (harness-caught, 2026-11-04): `LINKEDIN_PAYLOAD_PATH` rides the merged `./config.js` import (it exports from config.ts, not linkedin-payload.ts); `LinkedinSurface` imports from `./linkedin-fetch.js`; `linkedinLeg: LegLine | undefined` is declared before the acquisition `timeStage`, attached into stats by conditional spread, and passed to `sendDigest` as the 4th argument (Phase 4 signature renders it only when not ok). Zero `fetch-linkedin-api` references remain — clean for Phase 6. The whole proven merged file is the fence below.

```ts
import { pathToFileURL } from "node:url";
import type { Transporter } from "nodemailer";
import {
  type ResolvedSurface,
  type Surface,
  type WatcherConfig,
  loadWatcherConfig,
  resolveSurfaces,
} from "./config-file.js";
import {
  ENV_NAMES,
  LINKEDIN_PAYLOAD_PATH,
  STATE_PATH,
  isHeartbeatEnabled,
  runUrlFromEnv,
} from "./config.js";
import { resolveEmailConfig, sendDigest, sendExhaustionEmail } from "./email.js";
/**
 * CLI entry point: the full pipeline (FRD #1-#9; fast-workflow-runtime
 * D7-D9; rotation exhaustion path).
 *
 * fetch → extract → dedupe vs state → judge → notify → state commit. Every
 * stage logs its counts and its duration; any thrown error exits non-zero
 * and leaves state untouched (persistence is ordered after the notification
 * send, so a failed run never marks posts seen).
 *
 * Persistence (D7/D8): EVERY judged post id is persisted — including
 * zero-match runs — so no judged post is ever fed to the LLM twice.
 * Skipped ids stay unseen and retry next run. A run whose LLM_ACCOUNTS
 * pool is exhausted throws the tagged RotationExhausted error: the alarm
 * email is best-effort and the run exits 1 (state was never reached).
 *
 * What to watch and how to filter comes from watcher.config.json (Phase 10),
 * loaded once at startup. A missing or malformed file fails the run.
 */
import { extractPosts } from "./extract.js";
import { type ContextFactory, fetchSurfaces, fetchSurfacesAuthenticated } from "./fetch-threads.js";
import { type HeartbeatStats, selectCandidates, sendHeartbeat } from "./heartbeat.js";
import { isRotationExhausted } from "./judge-rotation.js";
import {
  type JudgedPost,
  judgePosts,
  parseJudgeConcurrency,
  resolveJudgeConfig,
  sleep,
} from "./judge.js";
import type { LinkedinSurface } from "./linkedin-fetch.js";
import { type LegLine, type PayloadRead, readPayloadPosts } from "./linkedin-payload.js";
import { filterRecent } from "./recency.js";
import { type AppState, diffNew, loadState, saveState } from "./state.js";
import { cleanupSessionDir, resolveSession } from "./threads-session.js";
import type { Post } from "./types.js";

/**
 * Best-effort status email for a zero-match run.
 *
 * Unlike the digest, a heartbeat that cannot be sent must not fail the run:
 * the pipeline did its job, only the notification failed. Logged loudly so a
 * broken GMAIL_* configuration is visible in the run log. Env, the clock,
 * and the transport arrive from WatcherDeps so an offline run can inject all
 * three.
 */
async function heartbeat(
  stats: HeartbeatStats,
  recent: readonly Post[],
  judged: readonly Post[],
  candidateTerms: readonly string[],
  env: Record<string, string | undefined>,
  now: () => number,
  transport?: Transporter,
): Promise<void> {
  if (!isHeartbeatEnabled(env)) {
    console.log("heartbeat: disabled by HEARTBEAT_ENABLED");
    return;
  }
  try {
    const config = resolveEmailConfig(env);
    const candidates = selectCandidates(recent, judged, candidateTerms);
    await sendHeartbeat(stats, candidates, config, now(), transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`heartbeat: not sent — ${message}`);
  }
}

/**
 * Run one pipeline stage and report its wall-clock duration (D9). The clock
 * is injectable so tests assert durations without waiting; production
 * passes nothing and measures real time. The caller logs the returned
 * durationMs — one order-stable line per stage await, at stage level only
 * (inner logs interleave once stages do real work).
 */
export async function timeStage<T>(
  run: () => Promise<T>,
  now: () => number = Date.now,
): Promise<{ value: T; durationMs: number }> {
  const startedAtMs = now();
  const value = await run();
  return { value, durationMs: Math.max(0, now() - startedAtMs) };
}

/**
 * Injectable dependencies for one watcher run; every field has the
 * production default the pipeline uses when omitted. This is the unit seam
 * the offline suite operates (tests/index.test.ts): env, config, surface
 * fetch, the LinkedIn payload reader, LLM transport, SMTP transport, state
 * file, and the clock all inject, so a full pipeline run executes offline.
 */
export interface WatcherDeps {
  /** Environment record for every resolver. Default: process.env. */
  readonly env?: Record<string, string | undefined>;
  /** Pre-resolved watcher config. Default: loadWatcherConfig() — fail-visible. */
  readonly config?: WatcherConfig;
  /** Browser-context factory for the surface walks (Slice 3 seam). Default: chromiumContextFactory. */
  readonly contextFactory?: ContextFactory;
  /** LinkedIn payload reader (D6 seam). Default: readPayloadPosts — the module owns its degrade contract (D13). */
  readonly linkedinFetch?: (payloadPath: string, now: () => number) => Promise<PayloadRead>;
  /** LLM HTTP transport. Default: global fetch. */
  readonly fetchFn?: typeof fetch;
  /** SMTP transport for the digest and the heartbeat. Default: nodemailer. */
  readonly transport?: Transporter;
  /** State file path. Default: STATE_PATH (the commit-back location). */
  readonly statePath?: string;
  /** Clock for recency, prune, state stamps, and heartbeat ages. Default: Date.now. */
  readonly now?: () => number;
  /** Park wait for the judge's cooldown parking. Default: the judge module's sleep. */
  readonly sleepFn?: (ms: number) => Promise<void>;
}

/** Funnel outcome of one run: the summary handle tests assert on. */
export interface WatcherRun {
  /** Posts sent to the LLM judge (recency + seen survivors). */
  judged: number;
  /** Posts the judge marked relevant AND located. */
  matches: number;
  /** Posts the judge could not evaluate (they stay unseen). */
  skipped: number;
  /** Whether this run persisted judged ids to the state file. */
  saved: boolean;
}

/**
 * One watcher run: the linear funnel with Gate 1 (nothing unseen), Gate 2
 * (judged but zero matches), and the match path. Stage awaits carry
 * timeStage timers; persistence (D7/D8) happens on every run that judged
 * posts, ordered after the notification send.
 */
export async function runWatcher(deps: WatcherDeps = {}): Promise<WatcherRun> {
  const env = deps.env ?? process.env;
  const config = deps.config ?? (await loadWatcherConfig());
  const now = deps.now ?? Date.now;
  const sleepFn = deps.sleepFn ?? sleep;
  const statePath = deps.statePath ?? STATE_PATH;
  const startedAt = now();
  const linkedinFetch = deps.linkedinFetch ?? readPayloadPosts;
  // D14: labels come from the RAW config partition, not the resolved
  // array — Slice 3 narrows ResolvedSurface to threads-only, and this
  // line must keep listing every surface the run attempts, linkedin
  // included. Labels: tag/<value>, url verbatim, linkedin/<value>.
  console.log(`watch: surfaces: ${config.surfaces.map(surfaceLabel).join(", ")}`);
  // Raw partition first: the PC leg's payload reader takes the fixed repo
  // path (no surface arguments), the walker takes resolved threads records.
  // Slice 3 narrows ResolvedSurface.platform to "threads"; partitioning
  // here keeps linkedin entries out of resolveSurfaces.
  const linkedinSurfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  const surfaces = resolveSurfaces(
    config.surfaces.filter((surface) => surface.type !== "linkedin"),
  );

  // Acquisition stage (D4): the per-platform fetches timed as one span.
  // Extraction happens inside the walk; the dedupe count logs right after
  // the duration line. Threads keeps its Playwright walks; LinkedIn reads
  // the PC leg's pushed payload (D6/D13 — the reader is total, absent and
  // stale degrade to a logged threads-only run).
  let linkedinLeg: LegLine | undefined;
  const { value: collected, durationMs: fetchMs } = await timeStage(async () => {
    const threadsSessionPath = await resolveSession(env);
    try {
      let threadsPosts: Post[] = [];
      // An empty threads partition never reaches the walker: its all-fail
      // gate throws on zero surfaces (fetch-threads.ts:397-409). D13 keeps
      // the LinkedIn arm alive regardless of the Threads partition shape.
      if (threadsSessionPath !== null && surfaces.length > 0) {
        threadsPosts = await fetchSurfacesAuthenticated(
          surfaces,
          threadsSessionPath,
          deps.contextFactory,
          { scrollRounds: config.scrollRounds },
        );
      } else if (threadsSessionPath === null && surfaces.length > 0) {
        threadsPosts = await fetchLoggedOutPosts(surfaces, deps.contextFactory);
      }
      let linkedinPosts: Post[] = [];
      if (linkedinSurfaces.length > 0) {
        // D6/D13: the arm reads the PC leg's pushed payload. The reader is
        // total — absent/stale/malformed all degrade to a logged
        // threads-only run, never a nonzero exit — so this belt catches
        // only unanticipated faults and throwing injected stubs (D12).
        try {
          const read = await linkedinFetch(LINKEDIN_PAYLOAD_PATH, now);
          linkedinPosts = read.posts;
          linkedinLeg =
            read.detail !== undefined
              ? { status: read.leg, detail: read.detail }
              : { status: read.leg };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`fetch: linkedin payload FAILED — ${message}`);
          linkedinLeg = { status: "malformed", detail: message };
        }
      }
      // D13: ONE return. The old early returns (empty-pool guard, logged-out
      // arm) silently dropped LinkedIn posts on a linkedin-only config with
      // a Threads secret.
      return [...threadsPosts, ...linkedinPosts];
    } finally {
      // F019 pairing: the Threads session dir dies with the run. The
      // payload reader keeps no session dir (cookies ride the PC leg).
      if (threadsSessionPath !== null) await cleanupSessionDir(threadsSessionPath);
    }
  });
  console.log(`timing: fetch ${fetchMs}ms`);
  const posts = dedupePosts(collected);
  console.log(
    `extract: ${posts.length} unique post(s) across ${config.surfaces.length} surface(s)`,
  );
  // (the extract line counts config.surfaces.length — the resolved array is
  // threads-only from this slice on; the count is the surfaces ATTEMPTED)

  const recencyHours = config.recencyHours;
  const recent = filterRecent(posts, recencyHours, now());
  console.log(`recency: ${recent.length} post(s) within ${recencyHours}h`);

  // exactOptionalPropertyTypes: attach runUrl only when the ambient
  // GITHUB_* variables are present (a local run has none).
  const runUrl = runUrlFromEnv(env);

  const stats: HeartbeatStats = {
    ranAt: new Date(startedAt).toISOString(),
    unique: posts.length,
    recent: recent.length,
    recencyHours,
    judged: 0,
    relevantLocated: 0,
    skipped: 0,
    ...(runUrl !== undefined ? { runUrl } : {}),
    ...(linkedinLeg !== undefined ? { linkedinLeg } : {}),
  };

  // Prune-on-load (D6/D7): state entries outside the recency window drop
  // before dedupe, so the seen map cannot grow without bound.
  const state = await loadState(statePath, recencyHours, now());
  const newPosts = diffNew(state, recent);
  stats.judged = newPosts.length;
  if (newPosts.length === 0) {
    // Gate 1 (zero unseen): nothing was judged, so nothing persists — the
    // state file stays byte-identical. The heartbeat still runs (timed).
    const { durationMs: notifyMs } = await timeStage(() =>
      heartbeat(stats, recent, newPosts, config.candidateTerms, env, now, deps.transport),
    );
    console.log(`timing: notify ${notifyMs}ms`);
    console.log("no new matches");
    return { judged: 0, matches: 0, skipped: 0, saved: false };
  }
  console.log(`state: ${newPosts.length} unseen post(s)`);

  const { value: judgeOutcome, durationMs: judgeMs } = await timeStage(() =>
    judgePosts(
      newPosts,
      resolveJudgeConfig(env),
      config.keywords,
      deps.fetchFn,
      config.reasoningEffort,
      parseJudgeConcurrency(env[ENV_NAMES.judgeConcurrency]),
      now,
      sleepFn,
    ),
  );
  console.log(`timing: judge ${judgeMs}ms`);
  const { judged, skippedPostIds } = judgeOutcome;
  const matches = judged
    .filter((j) => j.verdict.relevant && j.verdict.locationOk)
    .map((j) => j.post);
  stats.relevantLocated = matches.length;
  stats.skipped = skippedPostIds.length;
  console.log(
    `judge: ${newPosts.length} candidate(s) judged, ${matches.length} relevant+located, skipped: ${skippedPostIds.length}`,
  );

  if (matches.length === 0) {
    // Gate 2 (D7/D8): the run JUDGED these posts even though none matched.
    // Persist every judged id — heartbeat first, then state, mirroring the
    // notification-before-persistence convention — so the next run never
    // feeds the same posts to the LLM again. Skipped ids stay unseen and
    // retry next run (D3).
    const { durationMs: notifyMs } = await timeStage(() =>
      heartbeat(stats, recent, newPosts, config.candidateTerms, env, now, deps.transport),
    );
    console.log(`timing: notify ${notifyMs}ms`);
    const saved = await persistJudged(state, judged, statePath, now());
    console.log("no new matches");
    return {
      judged: newPosts.length,
      matches: 0,
      skipped: skippedPostIds.length,
      saved,
    };
  }

  // Email before state: a failed send exits non-zero and leaves state
  // untouched, so the next run re-judges and re-sends these matches (D3, D8).
  // The leg state rides the digest whenever it is not ok (D13 — sendDigest
  // renders the line only then; undefined omits it entirely).
  const { durationMs: notifyMs } = await timeStage(() =>
    sendDigest(matches, resolveEmailConfig(env), deps.transport, linkedinLeg),
  );
  console.log(`timing: notify ${notifyMs}ms`);
  const saved = await persistJudged(state, judged, statePath, now());
  return {
    judged: newPosts.length,
    matches: matches.length,
    skipped: skippedPostIds.length,
    saved,
  };
}

// --- New: the shared persistence tail (D8) ---

/**
 * Stamp every judged id — relevant or not — as seen (D8) and log the delta.
 * Skipped ids never reach this call, so they stay unseen and retry next run
 * (D3). saveState keeps its internal gate: an empty id list writes nothing.
 */
async function persistJudged(
  state: AppState,
  judged: readonly JudgedPost[],
  filePath: string,
  nowMs: number,
): Promise<boolean> {
  const judgedIds = judged.map((entry) => entry.post.id);
  const result = await saveState(state, judgedIds, filePath, nowMs);
  console.log(`state: ${result.addedCount} new seen post id(s)`);
  return result.saved;
}

/** Logged-out path: blob extraction per surface, in input order. */
async function fetchLoggedOutPosts(
  surfaces: readonly ResolvedSurface[],
  contextFactory?: ContextFactory,
): Promise<Post[]> {
  const fetched = await fetchSurfaces(surfaces, contextFactory);
  const posts: Post[] = [];
  for (const surface of fetched) {
    const extracted = extractPosts(surface.html);
    console.log(`extract: ${surface.label}: ${extracted.length} post(s)`);
    posts.push(...extracted);
  }
  return posts;
}

/** D14 log label for one raw config surface. */
function surfaceLabel(surface: Surface): string {
  if (surface.type === "linkedin") return `linkedin/${surface.value}`;
  if (surface.type === "tag") return `tag/${surface.value}`;
  return surface.value; // url surfaces log verbatim
}

/** Dedupe posts by id, keeping first-seen order. */
function dedupePosts(posts: readonly Post[]): Post[] {
  const seen = new Set<string>();
  const unique: Post[] = [];
  for (const post of posts) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    unique.push(post);
  }
  return unique;
}

// Pipeline entry: the run starts only when this file IS the entry module
// (npm start, watch.yml). Importing the module — as tests/index.test.ts
// does — stays side-effect free.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatcher().catch(async (error: unknown) => {
    // Pool exhausted: one alarm email, then the standard failed-run exit.
    // The email is best-effort — a broken GMAIL_* configuration must not
    // mask the exit code the run already earned. State was never reached
    // (the throw happened in the judge stage), so no post is marked seen
    // (D3, D8).
    if (isRotationExhausted(error)) {
      console.error(`watch: FAILED — ${error.message}`);
      try {
        await sendExhaustionEmail(error.failures, resolveEmailConfig(process.env));
      } catch (emailError) {
        const emailMessage = emailError instanceof Error ? emailError.message : String(emailError);
        console.warn(`email: exhaustion alarm not sent — ${emailMessage}`);
      }
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`watch: FAILED — ${message}`);
    process.exit(1);
  });
}
```

#### 4. Pipeline suite re-key
**File**: `tests/index.test.ts` (MODIFY)
**Changes**: Re-key the four `linkedinFetch` doubles to payload-reader doubles (the `payloadRead` helper mirrors exactOptionalPropertyTypes); token-warn tests become payload-absent tests pinning zero linkedin warns + the absent leg line on the heartbeat; the belt test pins the warn + malformed leg on the digest; NEW stale-leg digest pin (`\n\nLinkedIn leg: stale — payload 3h old\n`); `recordingTransport` also captures `texts`; the context-factory double drops its linkedin URL branch (no post-re-key code path can drive a linkedin URL — the `urls.every(...)` pins stay load-bearing). The quiet `linkedin: no payload` log line stays pinned in the payload suite — the injected stubs replace the reader. Subject pins use the real buildSubject form (`…on Threads + LinkedIn`). The whole proven merged suite is the fence below.

```ts
/**
 * Offline pipeline suite for the Gate 2 unit seam (Slice 6, D7-D9).
 * runWatcher takes every I/O boundary as an injection — env literal,
 * context-factory double, fetch double, transport double, temp state file,
 * pinned clock — so a full pipeline run executes with zero network, zero
 * browser, and zero writes inside the repo. Covers: the zero-match run
 * persisting judged ids (Gate 2), the digest path, the all-seen Gate 1
 * byte-identity, heartbeat-disabled persistence, judge-skip persistence
 * (D3), the payload-seam mixed run, the absent-payload and belt degrades
 * (D13), the D13/D14 acquisition-shape pins, and the timeStage duration
 * measurement.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import type { WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import type {
  ContextFactory,
  ContextLike,
  LocatorLike,
  PageLike,
  ResponseLike,
} from "../src/fetch-threads.js";
import { runWatcher, timeStage } from "../src/index.js";
import { isRotationExhausted } from "../src/judge-rotation.js";
import type { PayloadRead } from "../src/linkedin-payload.js";
import type { AppState } from "../src/state.js";
import type { JudgeVerdict, Post } from "../src/types.js";

// Pinned clock (UTC): 2026-10-26T09:14:00.000Z — every stage reads it
// through deps.now; the tests never touch the system clock.
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: ["hiring", "loker"],
  surfaces: [{ type: "tag", value: "hiring" }],
  recencyHours: 72,
  reasoningEffort: "medium",
  scrollRounds: 8,
};

/** Mixed-platform config: the tag surface plus one linkedin surface. */
const MIXED_CONFIG: WatcherConfig = {
  ...CONFIG,
  surfaces: [
    { type: "tag", value: "hiring" },
    { type: "linkedin", value: "#hiring" },
  ],
};

const BASE_ENV: Record<string, string | undefined> = {
  THREADS_SESSION_STATE: Buffer.from(
    JSON.stringify({ cookies: [{ name: "session", value: "x" }] }),
  ).toString("base64"),
  LLM_ACCOUNTS: JSON.stringify([
    { baseUrl: "https://mock.api/v1", apiKey: "test-key", model: "test-model" },
  ]),
  GMAIL_USER: "alerts@example.com",
  GMAIL_APP_PASSWORD: "app-password",
};

/** 19-digit post id, mirroring the judge tests' helper. */
const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

/** Minimal graphql capture body: one thread_item per post, 1h old. */
const graphqlBody = (entries: ReadonlyArray<{ id: string; text: string }>): string =>
  JSON.stringify({
    data: {
      thread_items: entries.map((entry) => ({
        post: {
          pk: entry.id,
          caption: { text: entry.text },
          user: { username: `author-${entry.id.slice(-2)}` },
          taken_at: Math.floor((NOW - HOUR) / 1000),
        },
      })),
    },
  });

/** Response double the walk's graphql filter accepts. */
const graphqlResponse = (body: string): ResponseLike => ({
  url: () => "https://www.threads.com/api/graphql",
  status: () => 200,
  text: async () => body,
});

/** LinkedIn activity id whose embedded epoch ms equals the pinned NOW. */
const linkedinIdNow = (BigInt(NOW) << 22n).toString();

/** One normalized LinkedIn post for the injected payload-reader double. */
const linkedinPost = (id: string): Post => ({
  platform: "linkedin",
  id: `urn:li:activity:${id}`,
  text: `LinkedIn hiring post ${id}`,
  author: "linkedin-member",
  permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
  timestamp: iso(NOW),
});

/** Build a PayloadRead for the re-keyed linkedinFetch double (D6). */
const payloadRead = (posts: Post[], leg: PayloadRead["leg"], detail?: string): PayloadRead =>
  detail !== undefined ? { posts, leg, detail } : { posts, leg };

/** Minimal logged-out tag page: one data-sjs blob carrying the thread items. */
const tagPageHtml = (
  entries: ReadonlyArray<{ id: string; text: string; author: string }>,
): string =>
  `<html><head><script type="application/json" data-sjs="">${JSON.stringify({
    data: {
      thread_items: entries.map((entry) => ({
        post: {
          pk: entry.id,
          caption: { text: entry.text },
          user: { username: entry.author },
          taken_at: Math.floor((NOW - HOUR) / 1000),
        },
      })),
    },
  })}</script></head><body>hydrated</body></html>`;

/** Recent-tab locator that never becomes visible (both walks tolerate it). */
const missingTab = (): LocatorLike => {
  const tab: LocatorLike = {
    first: () => tab,
    waitFor: async () => {
      throw new Error("locator not found");
    },
    click: async () => undefined,
  };
  return tab;
};

/**
 * Context factory double for the authenticated walk: one page whose goto
 * fires the response listener with the given graphql capture.
 */
function singlePageContextFactory(capture: string): ContextFactory {
  return async () => {
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        const listeners: Array<(response: ResponseLike) => void> = [];
        return {
          goto: async () => {
            const response = graphqlResponse(capture);
            for (const listener of listeners) listener(response);
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => missingTab(),
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

/**
 * Context-factory double for the platform-split acquisition (Phase 4):
 * each page dispatches on its goto URL — threads URLs fire the graphql
 * capture (authenticated walk) or deliver threadsHtml via content()
 * (logged-out walk). Records every requested URL and every storage-state
 * path so a test can pin which surfaces were walked and that the session
 * temp dir was cleaned. (The LinkedIn leg rides the pushed payload since
 * slice 5 — no linkedin URL is ever walked.)
 */
function dualPlatformContextFactory(options: {
  threadsCapture: string;
  /** Page HTML for the logged-out Threads walk; absent = bare hydrated page. */
  threadsHtml?: string;
  urls?: string[];
  sessionPaths?: string[];
}): ContextFactory {
  return async (storageStatePath?: string) => {
    options.sessionPaths?.push(storageStatePath ?? "");
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        const listeners: Array<(response: ResponseLike) => void> = [];
        return {
          goto: async (url: string) => {
            options.urls?.push(url);
            for (const listener of listeners) listener(graphqlResponse(options.threadsCapture));
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => options.threadsHtml ?? "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => missingTab(),
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

/** Chat-completions 200 response carrying one message. */
const ok = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

/**
 * Chat-completions double: bulk calls answer every listed id with the given
 * verdict; single-post fallbacks answer the plain verdict object.
 */
function judgeFetch(verdict: JudgeVerdict): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each post below")) {
      const ids = content.match(/\b(?:urn:li:activity:)?\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) answer[id] = verdict;
      return ok(JSON.stringify(answer));
    }
    return ok(JSON.stringify(verdict));
  }) as unknown as typeof fetch;
}

/**
 * Bulk answers exactly the ids present in the verdict map (missing ids stay
 * absent — the post falls back); single-post retries fail with a 500 so the
 * fallback exhausts and the post is skipped (D3). The 500 shape and its
 * bounded backoff are the same pin the judge suite already ships.
 */
function partialBulkThenFailFetch(verdicts: Record<string, JudgeVerdict>): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each post below")) {
      const ids = content.match(/\b\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) {
        const verdict = verdicts[id];
        if (verdict !== undefined) answer[id] = verdict;
      }
      return ok(JSON.stringify(answer));
    }
    return new Response("Internal Server Error", { status: 500 });
  }) as unknown as typeof fetch;
}

/** Transport double recording subject lines and plain-text bodies. */
function recordingTransport() {
  const subjects: string[] = [];
  const texts: string[] = [];
  const transport = {
    sendMail: async (options: { subject: string; text: string }) => {
      subjects.push(options.subject);
      texts.push(options.text);
      return { messageId: "msg-1" };
    },
  } as unknown as Transporter;
  return { transport, subjects, texts };
}

// Temp state files (offline rule: OS temp only, cleaned up once).
let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Temp state file path; seeds the file with a state document when given. */
async function tempStatePath(name: string, seed?: AppState): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));
  const path = join(dir, name);
  if (seed !== undefined) {
    await writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  }
  return path;
}

describe("runWatcher", () => {
  it("persists judged ids on a zero-match run and still sends the heartbeat (Gate 2)", async () => {
    const posts = [
      { id: id19(1), text: "Looking for work as a frontend developer" },
      { id: id19(2), text: "Selling an ergonomic chair, barely used" },
    ];
    const statePath = await tempStatePath("gate2-zero-match.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 0, skipped: 0, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.equal(stored.version, 2);
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(1), id19(2)]);
    assert.equal(subjects.length, 1); // Gate 2 skips neither email nor write
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("sends the digest and persists judged ids when posts match", async () => {
    const posts = [
      { id: id19(3), text: "Hiring: senior backend engineer, remote in Indonesia" },
      { id: id19(4), text: "Hiring: frontend developer in Jakarta" },
    ];
    const statePath = await tempStatePath("match-digest.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 2, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /2 new job posts/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(3), id19(4)]);
  });

  it("leaves the state file byte-identical when everything is already seen (Gate 1) and still sends the heartbeat", async () => {
    const posts = [
      { id: id19(5), text: "Hiring: react developer, bandung on-site" },
      { id: id19(6), text: "Hiring: data analyst, remote" },
    ];
    const seed: AppState = {
      version: 2,
      seenPostIds: { [id19(5)]: iso(NOW - HOUR), [id19(6)]: iso(NOW - HOUR) },
    };
    const statePath = await tempStatePath("gate1-all-seen.json", seed);
    const before = await readFile(statePath, "utf8");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(await readFile(statePath, "utf8"), before);
    assert.equal(subjects.length, 1); // Gate 1 still notifies
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("still persists judged ids when the heartbeat is disabled", async () => {
    const posts = [{ id: id19(7), text: "Junior QA engineer opening in Surabaya" }];
    const statePath = await tempStatePath("heartbeat-off.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: { ...BASE_ENV, HEARTBEAT_ENABLED: "false" },
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.equal(subjects.length, 0); // disabled — yet the state write still ran
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(7)]);
  });

  it("keeps judge-skipped ids unseen while persisting the judged rest (D3)", async () => {
    const posts = [
      { id: id19(8), text: "Hiring: golang engineer, remote" },
      { id: id19(9), text: "Hiring: vue developer in Bali" },
    ];
    const statePath = await tempStatePath("skip-d3.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: partialBulkThenFailFetch({ [id19(8)]: { relevant: true, locationOk: true } }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 1, skipped: 1, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(8)]); // the skipped id stays unseen
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
  });

  it("rejects with the complete pool-ordered exhaustion record and never touches state at budget death", async () => {
    const posts = [{ id: id19(10), text: "Hiring: rust engineer, remote" }];
    const statePath = await tempStatePath("budget-death.json");
    const { transport, subjects } = recordingTransport();
    // Hand-stepped clock + inert park: three cooldown parks drain the
    // 3-minute budget instantly.
    let tick = 0;
    const now = (): number => tick;
    const sleepFn = (ms: number): Promise<void> => {
      tick += ms;
      return Promise.resolve();
    };
    const all429 = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await runWatcher({
        env: BASE_ENV,
        config: CONFIG,
        contextFactory: singlePageContextFactory(graphqlBody(posts)),
        fetchFn: all429,
        transport,
        statePath,
        now,
        sleepFn,
      });
    } catch (error) {
      caught = error;
    }

    // The entry guard's contract: the tagged error with the complete
    // record — it turns that into exactly one exhaustion email + exit 1.
    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as { failures: Array<{ account: number }> }).failures.map((f) => f.account),
      [1],
    );
    // The judge throw happened before any notification or persistence:
    // no email fired, and the state file was never written.
    assert.deepEqual(subjects, []);
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/);
  });

  it("walks a mixed run: Threads through its session, LinkedIn through the pushed payload, and cleans the session dir", async () => {
    const urls: string[] = [];
    const sessionPaths: string[] = [];
    const linkedinCalls: Array<{ path: string; nowMs: number }> = [];
    const statePath = await tempStatePath("mixed-platform.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([
          { id: id19(11), text: "Hiring: python developer, jakarta remote" },
          { id: id19(12), text: "Hiring: devops engineer, bandung on-site" },
        ]),
        urls,
        sessionPaths,
      }),
      linkedinFetch: async (path, nowFn) => {
        linkedinCalls.push({ path, nowMs: nowFn() });
        return payloadRead([linkedinPost(linkedinIdNow)], "ok", "payload 0 min old");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 3, matches: 3, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /3 new job posts on Threads \+ LinkedIn/);
    // The reader got the fixed repo payload path and the injected clock.
    assert.deepEqual(linkedinCalls, [{ path: LINKEDIN_PAYLOAD_PATH, nowMs: NOW }]);
    // The Playwright walk never drove a linkedin URL...
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    // ...the digest marks the linkedin row and carries no leg line on ok...
    assert.ok(texts[0]?.includes("3. [linkedin] LinkedIn hiring post"));
    assert.ok(!texts[0]?.includes("LinkedIn leg:"));
    // ...both platform id forms reached the state file...
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [
      id19(11),
      id19(12),
      `urn:li:activity:${linkedinIdNow}`,
    ]);
    // ...and the Threads session temp file died with the run (F019; the
    // payload reader keeps no session dir — cookies ride the PC leg).
    assert.equal(sessionPaths.length, 1);
    for (const path of sessionPaths) {
      await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
    }
  });

  it("completes threads-only when the payload is absent, rendering the absent leg on the heartbeat", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const urls: string[] = [];
    const statePath = await tempStatePath("linkedin-payload-absent.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([{ id: id19(13), text: "Hiring: react developer, remote" }]),
        urls,
      }),
      linkedinFetch: async () => payloadRead([], "absent"),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The absent payload is the PC-off NORMAL (D13): a green threads-only
    // run, zero linkedin warns (the reader logs one quiet line instead).
    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !/linkedin/.test(line)));
    // The Gate 2 heartbeat renders the absent leg line — a threads-only run
    // is permanently quiet, so the heartbeat is where the dark leg shows.
    assert.equal(subjects.length, 1);
    assert.ok(texts[0]?.includes("LinkedIn leg: absent — no payload file"));
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(13)]);
  });

  it("degrades a linkedin-only config with an absent payload to a quiet threads-only heartbeat (Gate 1)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-only-absent.json");
    const { transport, subjects, texts } = recordingTransport();
    let linkedinCalls = 0;

    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: no threads surfaces
      linkedinFetch: async () => {
        linkedinCalls += 1;
        return payloadRead([], "absent");
      },
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(linkedinCalls, 1, "the reader runs whenever linkedin surfaces are configured");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !/linkedin/.test(line))); // absent is a quiet log, never a warn
    assert.equal(subjects.length, 1); // the Gate 1 heartbeat still fires
    assert.ok(texts[0]?.includes("LinkedIn leg: absent — no payload file"));
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // nothing persisted
  });

  it("keeps Threads results when the payload read faults at run time (acceptance 1, the D12 belt)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-payload-throws.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: { ...BASE_ENV, THREADS_SESSION_STATE: undefined }, // logged-out Threads walk
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([]), // unused: the Threads walk is logged-out
        threadsHtml: tagPageHtml([
          { id: id19(14), text: "Hiring: kotlin developer, jakarta", author: "techco" },
        ]),
      }),
      linkedinFetch: async () => {
        throw new Error("payload io exploded");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The belt degrades the fault to a warn + a malformed leg; the
    // logged-out Threads posts survive and the run completes (exit 0 shape).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin payload FAILED — payload io exploded/.test(line)));
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
    // The not-ok leg rides the digest (D13).
    assert.ok(texts[0]?.includes("LinkedIn leg: malformed — payload io exploded"));
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(14)]);
  });

  it("renders the stale leg line on a match-run digest even when the leg contributed no posts (D13)", async () => {
    const statePath = await tempStatePath("stale-leg-digest.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: singlePageContextFactory(
        graphqlBody([{ id: id19(16), text: "Hiring: scala developer, remote" }]),
      ),
      linkedinFetch: async () => payloadRead([], "stale", "payload 3h old"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // One threads match; the stale leg rides the digest so a dark leg
    // stays visible on a match run too.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.ok(!texts[0]?.includes("[linkedin]")); // the stale leg contributed no posts
    assert.ok(texts[0]?.includes("\n\nLinkedIn leg: stale — payload 3h old\n"));
  });

  it("keeps LinkedIn posts on a linkedin-only config when a Threads session exists (D13 single return)", async () => {
    const statePath = await tempStatePath("linkedin-only-with-threads-session.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV, // THREADS_SESSION_STATE present
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: zero threads surfaces
      linkedinFetch: async () => payloadRead([linkedinPost(linkedinIdNow)], "ok"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The old empty-pool guard returned [] before the LinkedIn arm ran;
    // the single return keeps the LinkedIn posts (D13).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post on Threads \+ LinkedIn/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [`urn:li:activity:${linkedinIdNow}`]);
  });

  it("logs every surface from the raw config partition in the startup line (D14)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const statePath = await tempStatePath("startup-surface-line.json");
    const { transport } = recordingTransport();

    await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        // A real post: an EMPTY authenticated capture trips the kept
        // all-fail gate and the run dies before the startup line is logged.
        threadsCapture: graphqlBody([{ id: id19(15), text: "Hiring: golang developer, remote" }]),
      }),
      linkedinFetch: async () => payloadRead([], "absent"),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /watch: surfaces: tag\/hiring, linkedin\/#hiring/.test(line)));
  });
});

describe("timeStage", () => {
  it("returns the stage value and its duration under an injected clock", async () => {
    let tick = 100;
    const { value, durationMs } = await timeStage(
      async () => {
        tick += 50;
        return "done";
      },
      () => tick,
    );
    assert.equal(value, "done");
    assert.equal(durationMs, 50);
  });

  it("never reports a negative duration when the clock steps back", async () => {
    let tick = 100;
    const { durationMs } = await timeStage(
      async () => {
        tick -= 5;
        return undefined;
      },
      () => tick,
    );
    assert.equal(durationMs, 0);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test` — re-keyed suite green, rest untouched
- [x] Mixed-run end-to-end: threads ids and `urn:li:activity:` ids share the seen map without colliding; recency keeps a fresh linkedin post (ISO timestamp via `BigInt(id)>>22n`); digest carries `[linkedin]` + `+ LinkedIn` subject
- [x] Heartbeat renders the leg line in all four states; omits it entirely when the reader never ran
- [x] Digest carries the leg line ONLY when the state is not ok (ok → no line; stale/malformed belt → line)
- [x] Absent payload = green threads-only run (never a nonzero exit), zero linkedin warns
- [x] The re-key leaves `src/judge-rotation.ts` byte-identical: `git diff --name-only -- src/judge-rotation.ts` returns empty after the phase

#### Manual Verification:
- [ ] PC-off rehearsal: stop the loop ≥31 min → a dispatched run logs the stale line, completes threads-only, heartbeat fires, state byte-identical

---

## Phase 6: SDK removal + residue sweep + docs

### Overview

The deletion slice (the only slice that may delete files): the Linked API SDK quad goes, the `ENV_NAMES` pair leaves, watch.yml's SDK mapping and comment premises die, README/AGENTS/.gitignore/guidance get the residue sweep (the bf6594c lesson applied in-commit: sweep `.gitignore` rules, env keys, and gate-invisible wording in the same commit), and the PC-operations documentation lands. Slice 5's re-key removed the last code consumers first, so `npm run typecheck` stays green per slice. Ordering within the phase: the §4/§5 comment re-keys land BEFORE the pre-delete gate runs — the gate's "ONLY the two `src/config.ts` pair lines" expectation assumes they landed (at raw phase start, `src/config-file.ts` and `src/threads-session.ts` still match the pattern).

### Changes Required:

#### 1. SDK fetcher deletion
**File**: `src/fetch-linkedin-api.ts` (DELETE)
**Changes**: The SDK fetcher (261 lines) is deleted. No code designed for it — the Phase 5 re-key removed its last import.

#### 2. SDK suite deletion
**File**: `tests/fetch-linkedin-api.test.ts` (DELETE)
**Changes**: The SDK suite (~346 lines) is deleted.

#### 3. ENV_NAMES pair removal (final state)
**File**: `src/config.ts` (MODIFY)
**Changes**: The `linkedApiToken` / `linkedApiIdentificationToken` lines LEAVE the block — the Phase 5 re-key removed the last code consumers (the index.ts arm's `resolveLinkedApiTokens` call + token warn died with the whole-file re-key; the only remaining readers were the module deleted this slice and its suite). Fence A below is the SLICE-6 STATE (final; gate-proven in the harness: tsc + biome + 158/158). Splice = replace the on-disk text between the `/** Environment variable names... */` comment line and its `} as const;` with fence A; `LINKEDIN_PAYLOAD_PATH` (landed in Phase 4) may instead sit beside `STATE_PATH` — position immaterial to every gate.

```ts
/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  linkedinCookiesFile: "LINKEDIN_COOKIES_FILE",
  linkedinTransport: "LINKEDIN_TRANSPORT",
  curlImpersonateBin: "CURL_IMPERSONATE_BIN",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  judgeConcurrency: "JUDGE_CONCURRENCY",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;
```

#### 4. Config-file wording re-keys
**File**: `src/config-file.ts` (MODIFY)
**Changes**: Four comment/string re-keys (verifier-found at the 2026-11-04 slice-6 checkpoint; invisible to the case-sensitive acceptance grep, required by the bf6594c wording lesson): the `Surface` doc, the `ResolvedSurface.platform` doc, the `resolveSurfaces` doc (the slice-6 draft's "payload reader" wording revised — the reader consumes the payload FILE, the raw keyword strings are consumed by the PC leg's voyager walk), and the runtime wiring-bug throw string. The throw's pinned regex prefix (`/linkedin surface "..." reached resolveSurfaces/`) is unchanged.

```ts
// Surface doc:
/** One surface to sample. `tag` builds the tag-page URL; `url` is verbatim;
 * `linkedin` stays a valid config value whose raw keyword string the PC
 * fetch leg consumes directly (it never resolves to a URL here). */

// ResolvedSurface.platform doc:
  /** Always "threads": LinkedIn rides the PC fetch leg and never resolves here. */

// resolveSurfaces doc:
 * surfaces resolve: linkedin entries stay valid config, but the PC fetch
 * leg (src/linkedin-fetch.ts) consumes their raw value, so the caller

// the wiring-bug throw — tail re-keyed, regex pin unchanged:
        `linkedin surface "${surface.value}" reached resolveSurfaces — a wiring bug: partition linkedin surfaces out before resolving (the PC fetch leg takes their raw value)`,
```

#### 5. Session doc re-key
**File**: `src/threads-session.ts` (MODIFY)
**Changes**: `resolveSession` doc (comment-only): the LinkedIn sentence re-keys from the SDK token pair to the PC leg's cookie file.

```ts
 * policy — Threads falls back to the logged-out walk. LinkedIn resolves
 * no session here at all: its cookie pair rides the PC leg
 * (LINKEDIN_COOKIES_FILE, src/linkedin-session.ts), outside this repo.
```

#### 6. Judge F023 twin comment re-key
**File**: `src/judge.ts` (MODIFY)
**Changes**: The F023 twin comment (WAIT_BUDGET_MS doc; verifier-found): the watch.yml hunk below refreshes one half of the F023 arithmetic — this is the other half. The dead premise ("LinkedIn rides the sequential Linked API SDK workflows now… pastes into this comment") leaves; the envelope arithmetic and the 180s budget stay. The module-head "no SDK" note (:4 — the LLM client is raw fetch) is untouched and still true.

```ts
 * judge waves, and parks. The LinkedIn fetch term left this budget
 * entirely (2026-11-04): the leg runs on the developer PC and this job
 * only reads its pushed payload — the fetch measurement note moved to
 * the PC-loop docs in README.md. A 180s park budget keeps
```

#### 7. Voyager fence line — verify-only (already final)
**File**: `src/linkedin-voyager.ts` (MODIFY — verify-only; no edit expected)
**Changes**: The design's slice-6 checkpoint re-spliced one provenance-comment line into the slice-1 fence (the "mapper-idiom" mention dropped; comment-only, no behavior change). That re-splice is ALREADY reflected in the Phase 1 §1 fence — the design's post-ready byte-match oracle verified all 9 fences byte-identical to the gate-proven harness copies — so a Phase 1 implementation that applied its fence verbatim leaves nothing to change here. This entry keeps the file in the phase's set so the SC pin ("slice-1 fence line re-spliced") stays checkable: verify the on-disk file matches the Phase 1 §1 fence (comment header included) and that no "mapper-idiom" wording survives.

#### 8. Config-file suite title re-key
**File**: `tests/config-file.test.ts` (MODIFY)
**Changes**: One test title re-keys with the throw string; the `assert.throws` regex pin is unchanged. The suite joined the harness world at this checkpoint (130 → 158 tests).

```ts
  it("fails visibly when a linkedin surface reaches resolveSurfaces (the PC fetch leg consumes them raw)", () => {
    assert.throws(
      () => resolveSurfaces([{ type: "linkedin", value: "#hiring" }]),
      /linkedin surface "#hiring" reached resolveSurfaces/,
    );
  });
```

#### 9. Workflow comment + secret-mapping sweep
**File**: `.github/workflows/watch.yml` (MODIFY)
**Changes**: Three hunks: (1) remove the `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN` env lines (:104-105), replaced by the payload-note comment; (2) rewrite the concurrency-block premise comment (:11-19 — SDK park rationale dies; cancel stays for state serialization); (3) refresh the F023 envelope comment (:59-64 — the LinkedIn fetch term leaves the hosted budget; PENDING MEASUREMENT note moves to the PC loop README). No job, permission, cron, or commit-back changes.

```yaml
# watch.yml — MODIFY (slice 6): three hunks.
# 1) concurrency comment (the SDK-park rationale dies; cancel stays):
  # Cancel keeps at most one run alive: a run that parks on judge
  # cooldowns could otherwise hold the whole 8-minute cap, and queueing
  # every 10-minute tick behind it backs the schedule up without bound.
  # One live run still serializes the state read-modify-write (the
  # in-flight run is dead, never concurrent) and the newest run is the one
  # worth keeping. State writes stay atomic + rebase-safe either way. The
  # PC-linked payload (state/linkedin-posts.json) is written by the local
  # loop's own rebase+retry push — never by this workflow.
# 2) F023 envelope comment gains: "The LinkedIn fetch term left this budget
#    entirely (2026-11-04): the leg runs on the developer PC and this job
#    only READS its pushed payload — the fetch measurement note moved to
#    the PC-loop docs in README.md."
# 3) Run watcher env: the LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN
#    lines are REMOVED, replaced by:
          # The LinkedIn leg needs no secret here: the PC loop pushes
          # state/linkedin-posts.json and this job reads it from the
          # checkout — an absent/stale payload degrades to a threads-only
          # run (src/linkedin-payload.ts, D13).
```

#### 10. README PC-operations docs
**File**: `README.md` (MODIFY)
**Changes**: Pipeline description (local LinkedIn leg); env table rows (add `LINKEDIN_COOKIES_FILE`, `LINKEDIN_TRANSPORT`, `CURL_IMPERSONATE_BIN`; drop the SDK pair); surfaces key row (linkedin entries feed the voyager search); "Local run" points at the three npm entries. The "LinkedIn tokens (Linked API)" section is REPLACED by the section below.

```md
README.md — MODIFY (slice 6): the intro + pipeline step 2 describe the PC leg;
the secrets table drops the LINKED_API rows ("The LinkedIn leg needs no
GitHub secret"); the surfaces row + example name the PC voyager search;
"Local run" points at the three npm entries. The "LinkedIn tokens (Linked
API)" section is REPLACED by:

## The LinkedIn leg on your PC (voyager)

LinkedIn posts come from the voyager search API, fetched on the developer's
PC by an always-on npm loop — not from GitHub Actions. The endpoint, headers
and encodings follow the reverse-engineering spec of record
(`linkedin-reverse/DOCUMENTATION.md`); when the server expires the queryId
hash, re-derive it per that spec's §9 — a sudden 500 on a formerly-200
endpoint is the signature, not a variables bug.

The loop never touches Threads, the judge, the digest or seen-state. It
only fetches the linkedin surfaces, writes `state/linkedin-posts.json`
atomically, and pushes that single path with the same rebase+retry
discipline the bot uses. Each file has exactly one writer, so the two
pushes can never lose each other's commits. Run the loop from a dedicated
clone of `main` — its `git pull --rebase` also auto-updates the loop's own
code. One-time: set the clone's identity (`git config user.name` /
`git config user.email`) — the push discipline commits as you, and an
unconfigured identity fails the tick loudly instead of pushing nothing.

1. Export cookies from a logged-in browser into a JSON file OUTSIDE the
   repo: `{ "liAt": "...", "jsessionid": "ajax:..." }` (jsessionid may keep
   or drop its surrounding quotes; both work):
   `export LINKEDIN_COOKIES_FILE=C:/secrets/linkedin-cookies.json`
   No automated re-login exists (2FA dead-ends headless login); the export
   is the only refresh. A dead session sends ONE alarm email per episode
   and the loop keeps running — refresh the file, the next tick heals.
2. Install curl-impersonate (chrome build); point `CURL_IMPERSONATE_BIN`
   at the binary (default transport). `LINKEDIN_TRANSPORT=playwright`
   switches after a failed probe; no auto-fallback in code.
3. `npm run probe-linkedin` — twice, ≥6h apart, stored cookies only; exit 1
   on leg-dead/short/fault. Re-run after any `LINKEDIN_TRANSPORT` change.
4. `npm run watch-linkedin` — tick every 10 min, leave the console open.

Hosted side: the */10 cron reads the payload from its checkout, merges,
judges, emails as usual; the heartbeat/digest render one `LinkedIn leg:`
line (`ok` / `DARK — payload N h old` / `absent` / `malformed`) so a dark
leg stays visible while the PC is off. One-off ticks (`npm run
fetch-linkedin`) exit 1 on a dead leg.
```

#### 11. AGENTS.md module bullets
**File**: `AGENTS.md` (MODIFY)
**Changes**: Replace the fetch-linkedin-api module bullet + LINKED_API env mentions with the linkedin local-leg bullets (modules, commands, cookie-file rule).

```md
AGENTS.md — MODIFY (slice 6): "What this project is" gains the PC-leg
sentence (the loop pushes state/linkedin-posts.json; the hosted run reads
it). Commands: lint/format globs list the three linkedin scripts; npm start
notes the absent/stale payload degrade; three entries join — probe-linkedin
(gate; run twice ≥6h apart), fetch-linkedin (one tick; dedicated clone),
watch-linkedin (always-on loop). The fetch-linkedin-api architecture bullet
is replaced by the linkedin module family (voyager/session/fetch/payload +
the three PC scripts with their exit contracts); the email bullet names the
leg-dead alarm.
```

#### 12. Ignore rules sweep
**File**: `.gitignore` (MODIFY)
**Changes**: Add `linkedin-cookies*.json`; remove the `linkedin-state*.b64` residue line (:8); keep `.rpiv/tmp/` ignored (capture scratch). The PC loop's episode marker `state/linkedin-leg-dead.flag` also joins the ignore list — both writers stage single explicit paths, but a bare `git add state/` would otherwise commit the marker.

```text
node_modules/
.env
.env.*
.pi/
.rpiv/tmp/
.codebase-memory/graph.db.zst
slice*-recon/
linkedin-cookies*.json
state/linkedin-leg-dead.flag
run.log
```

#### 13. Root guidance sync
**File**: `.rpiv/guidance/architecture.md` (MODIFY)
**Changes**: Overview bullets mentioning the SDK/env pair → local-leg summary + payload path.

```md
.rpiv/guidance/architecture.md — MODIFY (slice 6): the src/ tree comment names
"the PC-linked linkedin payload read" instead of the Linked API SDK; the
Business Context paragraph swaps the Linked API token-pair sentence for: a
dark LinkedIn leg (absent or stale state/linkedin-posts.json — the PC loop
is off) degrades to a threads-only run with one log line; the heartbeat
still fires and renders the leg state.
```

#### 14. src guidance sync
**File**: `.rpiv/guidance/src/architecture.md` (MODIFY)
**Changes**: Replace the fetch-linkedin-api section (:65-77) with the linkedin module family (voyager/session/transport/fetch/payload) + the re-keyed arm; update the dependency list (@linkedapi/node dies; no new runtime dep); update the playwright quarantine statement — the dynamic-import boundary now covers TWO sites (the threads walk and the linkedin transport's API-request context; verified 2026-11-04: ContextLike has no request surface, so the transport cannot ride ContextFactory).

```md
.rpiv/guidance/src/architecture.md — MODIFY (slice 6): the dependency
bullet becomes "playwright: TWO quarantine sites — the chromium
ContextFactory in fetch-threads.ts AND request.newContext in
linkedin-fetch.ts (ContextLike exposes no request surface, verified
2026-11-04); no new runtime dep — curl spawns the PC-local
curl-impersonate binary". The module-structure line names the
linkedin-* family. The "fetch-linkedin-api.ts: the second platform rides
the Linked API SDK" section is REPLACED by
"linkedin-*.ts: the second platform is a PC-local voyager leg (2026-11-04)":
// SPEC OF RECORD: linkedin-reverse/DOCUMENTATION.md — endpoint, restli encoding (§4.1+§12.5,
// '#'→%23), §12.7 canonical recipe (sortBy:date_posted; orderBy IGNORED §12.4), §13 fault matrix.
// linkedin-voyager.ts: PURE core — constants + restli encoder + URL builder + parser (drop+count,
// never throws). Timestamp = BigInt(id)>>22n (§12.4 drift caveat).
// linkedin-session.ts: LINKEDIN_COOKIES_FILE resolver (fail-visible D4 — the stricter contrast to
// silent-null resolveSession); quote asymmetry canonicalized once (header quoted+last §10/§14.5;
// csrf stripped §3; storageState re-quotes).
// linkedin-fetch.ts: VoyagerGet seam; curl transport (CURL_IMPERSONATE_BIN fail-visible, injectable
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
// pull --rebase → push, ONE retry (mirrors commit-state-rebase.sh; single-writer-per-file); leg-dead =
// ONE alarm per episode (repo-local marker beside the payload) + exit 1; loop continues; probe = gate exit 1.
```

#### 15. Workflow guidance sync
**File**: `.rpiv/guidance/.github/workflows/architecture.md` (MODIFY)
**Changes**: Env sync-point list drops the LINKED_API pair (:7, :50-51); note the payload file as a new watch-side input read from the checkout — delivered by the PC's own single-path push (D5); the bot's commit-back is untouched and the two writers serialize via their own rebase+retry.

```md
.rpiv/guidance/.github/workflows/architecture.md — MODIFY (slice 6): the
env sync-point line becomes "watch.yml maps 6 of the 9 ENV_NAMES
(HEARTBEAT_ENABLED via vars. — the one non-secret knob); the LinkedIn trio
(LINKEDIN_COOKIES_FILE, LINKEDIN_TRANSPORT, CURL_IMPERSONATE_BIN) is
deliberately NOT mapped — PC-only, never enters Actions". The concurrency
comment quote swaps the SDK-park rationale for the judge-park + payload
note ("the PC loop writes state/linkedin-posts.json via its own
rebase+retry push — never this workflow"). The Run-watcher env block drops
both LINKED_API lines and adds: "no LinkedIn secret: the PC loop pushes the
payload this job reads".
```

#### 16. Tests guidance sync
**File**: `.rpiv/guidance/tests/architecture.md` (MODIFY)
**Changes**: Coverage map rows for the deleted SDK suite → the named new suites: linkedin-voyager, linkedin-session, linkedin-fetch, linkedin-payload (the four payload failure classes), index re-key, heartbeat leg-line.

```md
.rpiv/guidance/tests/architecture.md — MODIFY (slice 6): the dependency
note gains "the linkedin transport stays unexercised like
chromiumContextFactory — the VoyagerGet seam carries the tests" and
DROPS its SDK clause ("the Linked API SDK never loads either — the
factory's dynamic import is the only site": the factory is deleted).
The coverage-map row fetch-linkedin-api → fetch-linkedin-api.test.ts is
replaced by four rows:
linkedin-voyager.ts → linkedin-voyager.test.ts    # §12.5 escaping matrix, §12.7 URL pin, id>>22n clock, scrubbed fixture (edges 1-4)
linkedin-session.ts → linkedin-session.test.ts    # resolver reject matrix (all name LINKEDIN_COOKIES_FILE), quote asymmetry, storageState
linkedin-fetch.ts → linkedin-fetch.test.ts        # §13.3 classifier table, curl-over-fake-exec, resolver matrix, scripted VoyagerGet walk
linkedin-payload.ts → linkedin-payload.test.ts    # all four failure classes + atomic round trip
```

#### 17. Scripts guidance sync
**File**: `.rpiv/guidance/scripts/architecture.md` (MODIFY)
**Changes**: Add the three PC scripts (roles, exit-code contracts: fetch tick = leg-dead exits 1; loop = never exits on leg-dead; probe = gate exit 1) + the lint/format glob note.

```md
.rpiv/guidance/scripts/architecture.md — MODIFY (slice 6): the Structure
block gains three INSIDE-typecheck-and-lint entries after probe-judge.ts —
fetch-linkedin.ts (exports fetchTick/pushPayload/handleLegDeadEpisode;
tick = fetch → payload → single-path rebase+retry push; realGit
injectable), watch-linkedin.ts (tick + 600s sleep; leg-dead → ONE alarm
per episode + continue), probe-linkedin.ts (gate, exit 1) — and the
Invokers list gains: "run via npm run fetch-linkedin / watch-linkedin /
probe-linkedin from a dedicated clone; exit contracts: tick = leg-dead
exits 1 after the episode alarm, loop = never exits on leg-dead, probe =
gate exit 1".
```

#### 18. Dependency removal
**File**: `package.json` (MODIFY)
**Changes**: Remove `@linkedapi/node` from dependencies (`npm uninstall @linkedapi/node` regenerates the lockfile in the same commit — the bf6594c sweep rule).

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck` — before AND after the deletion (the slice-5 re-key removes the last code consumers first)
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Pre-delete gate (scoped — the unscoped form is unsatisfiable: it matches the deletion targets themselves): `git grep -nE 'linkedApi|LINKED_API|fetch-linkedin-api' -- src tests package.json ':(exclude)src/fetch-linkedin-api.ts' ':(exclude)tests/fetch-linkedin-api.test.ts'` returns ONLY the two `src/config.ts` ENV_NAMES pair lines before the removal lands
- [x] Residue sweep acceptance: `git grep -nE 'linkedapi|linked_api|LINKED_API|fetch-linkedin-api' -- ':(exclude).rpiv/artifacts/**'` returns 0 lines
- [x] Wording sweep (bf6594c lesson — gate-invisible residue): `grep -rniE 'linked API|linked-api' src tests scripts` returns 0; the only surviving `SDK` is `src/judge.ts:4`'s LLM-client note ("no SDK" — still true)
- [x] Comment re-keys pinned: `src/config-file.ts` (4 sites incl. the wiring-bug throw string), `src/threads-session.ts` (resolveSession doc), `src/judge.ts` (the F023 twin), `tests/config-file.test.ts` (title; regex pin unchanged), `src/linkedin-voyager.ts` (slice-1 fence line re-spliced)
- [x] `npm uninstall @linkedapi/node` removes the dependency and regenerates the lockfile
- [x] `.gitignore`: `linkedin-cookies*.json` added; `linkedin-state*.b64` residue line removed; no stray blob on disk

#### Manual Verification:
- [ ] A manual watch.yml dispatch runs green with no LinkedIn secret mapped

---

## Phase 7: Login helper + auto-env (less-manual cookie setup)

### Overview

Operator feedback 2026-11-05: the first `npm run probe-linkedin` run failed on an unset `LINKEDIN_COOKIES_FILE` and the goal is the least manual setup possible. Today the operator must (1) export the cookie pair from browser devtools by hand, (2) set `LINKEDIN_COOKIES_FILE` in every shell (npm run does NOT read `.env` — the README hint was dead without shell setup), and (3) repeat the export every time the session dies. This phase removes all three:

1. `npm run login-linkedin` — a HEADED Chromium with a persistent profile OUTSIDE the repo opens; the operator logs in by hand (2FA included); the helper polls the jar for `li_at` + `JSESSIONID`, writes the cookie file atomically, and appends/updates the `LINKEDIN_COOKIES_FILE` line in `<cwd>/.env`. Refreshing a dead session becomes re-running ONE command (the persistent profile means a still-signed-in jar is harvested without a new login) while the loop keeps running.
2. `src/env-file.ts` — `.env` auto-load: the four PC scripts merge `<cwd>/.env` UNDER the real environment (real env wins; `.env` fills ONLY unset keys; a missing `.env` is the quiet normal). No new dependency; the fail-visible doctrine stays with the resolvers — when a required variable is still unset after the merge, they throw naming it.
3. The resolver rejection messages point at the one command instead of the devtools recipe.

Mechanism boundary (bf6594c lesson, kept): the deleted f571904 login fallback was HEADLESS automated credential login — 2FA/challenge dead-end, live-confirmed. This helper automates NOTHING about auth: the human logs into a real browser window (DOCUMENTATION.md §2.4 VERIFIED interactive login — "the browser fingerprint is yours"), and the script only reads the resulting cookies.

### Changes Required:

#### 1. .env auto-load
**File**: `src/env-file.ts` (NEW)
**Changes**: `parseDotEnv` (pure: KEY=VALUE lines, `#` comments, blank lines, one surrounding quote pair stripped from values, anything else warns once naming file+line and is skipped) and `envWithDotEnv(env, cwd)` — reads `<cwd>/.env` when present and merges UNDER `env`: a variable already set in the shell always wins, `.env` fills ONLY unset keys. A missing `.env` returns the input untouched (the quiet normal); an unreadable one warns and does the same, and the resolvers then fail visibly naming the variables they still miss.

```ts
/**
 * .env auto-load for the PC-local scripts (Phase 7, operator feedback
 * 2026-11-05: least-manual setup). `npm run` does NOT read .env, so the
 * README's ".env" hint was dead without shell setup. This module reads
 * <cwd>/.env when present and merges it UNDER the real environment: a
 * variable already set in the shell always wins, .env fills ONLY unset
 * keys, and a missing .env is the quiet normal case. The fail-visible
 * doctrine stays with the resolvers: when a required variable is still
 * unset after the merge, they throw naming it. No dependency: KEY=VALUE
 * lines, # comments, blank lines; one pair of surrounding quotes on a
 * value is stripped; anything else warns once (file + line) and is
 * skipped.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The convenience file the PC scripts read beside the working directory. */
export const DOT_ENV_PATH = ".env";

/** Parse .env text: KEY=VALUE lines; # comments; blank lines; quoted values stripped. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      console.warn(`env-file: ${DOT_ENV_PATH} line ${i + 1} is not KEY=VALUE — skipped`);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/**
 * The merged environment for the PC scripts: <cwd>/.env (when present)
 * fills ONLY the keys `env` leaves unset — the real environment always
 * wins. A missing .env returns `env` untouched (the quiet normal); an
 * unreadable one warns and does the same, and the resolvers then fail
 * visibly naming the variables they still miss.
 */
export function envWithDotEnv(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Record<string, string | undefined> {
  let text: string;
  try {
    text = readFileSync(join(cwd, DOT_ENV_PATH), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== undefined && code !== "ENOENT") {
      console.warn(`env-file: ${DOT_ENV_PATH} is unreadable (${code}) — continuing without it`);
    }
    return env;
  }
  const merged: Record<string, string | undefined> = { ...env };
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}
```

#### 2. Offline suite for the .env auto-load
**File**: `tests/env-file.test.ts` (NEW)
**Changes**: parser pins (KEY=VALUE, comments, blanks, quoted values stripped, empty value kept, malformed line warns once naming file+line and is skipped) and merge pins (`.env` fills ONLY unset keys; real env wins the conflict; missing `.env` returns the input untouched; an unreadable `.env` — a directory in the way — never throws). Zero real cwd: cwd is injected, fixtures live in OS temp.

```ts
/**
 * Offline suite for the .env auto-load (Phase 7).
 *
 * Pins the parser shape (KEY=VALUE, comments, blanks, quoted values,
 * malformed-line warn+skip) and the merge contract: .env fills ONLY unset
 * keys, the real environment always wins, a missing .env is a quiet no-op,
 * and an unreadable .env never throws. Zero real cwd: cwd is injected and
 * fixtures live in OS temp.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { DOT_ENV_PATH, envWithDotEnv, parseDotEnv } from "../src/env-file.js";

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function envDir(content?: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-env-file-"));
  if (content !== undefined) {
    await writeFile(join(dir, DOT_ENV_PATH), content, "utf8");
  }
  return dir;
}

describe("parseDotEnv", () => {
  it("parses KEY=VALUE, skips comments and blanks, strips one quote pair", () => {
    const parsed = parseDotEnv(
      [
        "# a comment",
        "",
        "LINKEDIN_COOKIES_FILE=C:/loker-secrets/linkedin-cookies.json",
        'CURL_IMPERSONATE_BIN="C:/tools/curl-impersonate/curl-impersonate-chrome.exe"',
        "QUOTED='single'",
        "EMPTY=",
      ].join("\n"),
    );
    assert.deepEqual(parsed, {
      LINKEDIN_COOKIES_FILE: "C:/loker-secrets/linkedin-cookies.json",
      CURL_IMPERSONATE_BIN: "C:/tools/curl-impersonate/curl-impersonate-chrome.exe",
      QUOTED: "single",
      EMPTY: "",
    });
  });

  it("warns once per malformed line, names file and line, and skips it", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const parsed = parseDotEnv("GOOD=1\nnot-a-pair\n#fine\n=NOKEY");
    assert.deepEqual(parsed, { GOOD: "1" });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? "", /\.env line 2 is not KEY=VALUE/);
    assert.match(lines[1] ?? "", /\.env line 4 is not KEY=VALUE/);
  });
});

describe("envWithDotEnv", () => {
  it("fills ONLY unset keys from .env; the real environment wins conflicts", async () => {
    const cwd = await envDir("FROM_FILE=a\nSHARED=from-file\n");
    const merged = envWithDotEnv({ SHARED: "from-env" }, cwd);
    assert.equal(merged.FROM_FILE, "a");
    assert.equal(merged.SHARED, "from-env");
  });

  it("returns the input untouched when .env is missing (quiet normal)", async () => {
    const cwd = await envDir();
    const env = { ONLY: "env" };
    assert.equal(envWithDotEnv(env, cwd), env);
  });

  it("never throws on an unreadable .env (a directory in the way)", async () => {
    const cwd = await envDir();
    await mkdir(join(cwd, DOT_ENV_PATH));
    const merged = envWithDotEnv({ ONLY: "env" }, cwd);
    assert.equal(merged.ONLY, "env");
  });
});
```

#### 3. The login helper
**File**: `scripts/login-linkedin.ts` (NEW)
**Changes**: headed, persistent-profile login assist with an injectable context seam. Exports `findSessionCookies` (pure harvest: null until BOTH cookies present and non-empty; values verbatim — the quoted `JSESSIONID` stays quoted, the session module canonicalizes), `writeCookieFile` (atomic sibling-temp + rename via `stateTempPath`, the state.ts precedent), `upsertDotEnvLine` (create/replace/idempotent, returns changed), and `runLoginHelper` (open headed context → poll the jar every `POLL_INTERVAL_MS` → write cookie file → upsert `.env` → close in finally; budget `LOGIN_TIMEOUT_MS` with a fail-visible timeout message). The default opener is the THIRD playwright dynamic-import quarantine site (`launchPersistentContext`, headed, `viewport: null`). Entry-guarded main (index.ts idiom) — importing stays side-effect free, no browser opens.

```ts
/**
 * The LinkedIn login helper (Phase 7, operator feedback 2026-11-05:
 * least-manual setup). Opens a HEADED Chromium with a persistent profile
 * OUTSIDE the repo; the OPERATOR logs in by hand (2FA included); the
 * helper polls the jar for the li_at + JSESSIONID pair, writes the cookie
 * file atomically, and appends/updates the LINKEDIN_COOKIES_FILE line in
 * <cwd>/.env so the probe and the loop run with zero env setup.
 *
 * This is NOT the deleted headless credential login (f571904, removed in
 * bf6594c — 2FA dead-end, live-confirmed): no credentials pass through
 * this script and no login is automated. The human performs the login in
 * a real browser (DOCUMENTATION.md §2.4 VERIFIED interactive login — the
 * lowest account-flag risk: the browser fingerprint is yours).
 *
 * The persistent profile is the less-manual win on refresh days: a
 * still-signed-in jar is harvested WITHOUT a new login, so refreshing a
 * dead session is re-running this one command while the loop keeps
 * running — the next tick heals.
 *
 * Entry-guarded main (index.ts idiom): importing the module stays
 * side-effect free — no browser opens on import.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ENV_NAMES } from "../src/config.js";
import { stateTempPath } from "../src/state.js";
import { envWithDotEnv } from "../src/env-file.js";

/** Where the cookie pair lands when LINKEDIN_COOKIES_FILE is unset everywhere. */
export const DEFAULT_COOKIE_PATH = "C:/loker-secrets/linkedin-cookies.json";

/** Persistent browser profile (outside the repo): a signed-in jar skips the login on refresh runs. */
export const DEFAULT_PROFILE_DIR = "C:/loker-secrets/linkedin-chromium-profile";

/** Poll cadence for the cookie jar. */
export const POLL_INTERVAL_MS = 2_000;

/** The operator gets 5 minutes for the login (2FA included) before the gate exits. */
export const LOGIN_TIMEOUT_MS = 300_000;

/** The harvested pair, verbatim from the jar — JSESSIONID keeps its quotes; the session module canonicalizes. */
export interface LinkedInCookiePair {
  liAt: string;
  jsessionid: string;
}

/** The browser-context seam the offline suite injects (no headed Chromium in tests). */
export interface LoginContext {
  cookies: (url: string) => Promise<Array<{ name: string; value: string }>>;
  close: () => Promise<void>;
}

/** Harvest the pair from one jar snapshot; null until BOTH cookies are present and non-empty. */
export function findSessionCookies(
  cookies: ReadonlyArray<{ name: string; value: string }>,
): LinkedInCookiePair | null {
  const liAt = cookies.find((cookie) => cookie.name === "li_at")?.value ?? "";
  const jsessionid = cookies.find((cookie) => cookie.name === "JSESSIONID")?.value ?? "";
  if (liAt.trim() === "" || jsessionid.trim() === "") return null;
  return { liAt, jsessionid };
}

/**
 * Atomic cookie-file write (sibling unique temp + rename, the state.ts
 * precedent): a crashed harvest never leaves a partial cookie file for
 * the next command to misread.
 */
export async function writeCookieFile(pair: LinkedInCookiePair, filePath: string): Promise<void> {
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, Date.now());
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(pair, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort temp cleanup
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`login-linkedin: cookie write failed for ${filePath}: ${message}`);
  }
}

/**
 * Append or replace ONE KEY=VALUE line in the .env file; idempotent.
 * Returns true when the file changed. Values ride verbatim (the .env
 * parser in src/env-file.ts takes the whole rest of the line — no quote
 * games needed for paths with spaces).
 */
export async function upsertDotEnvLine(
  filePath: string,
  key: string,
  value: string,
): Promise<boolean> {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    // Absent .env: start from an empty document.
  }
  const line = `${key}=${value}`;
  const lines = text === "" ? [] : text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const index = lines.findIndex((candidate) => candidate.startsWith(`${key}=`));
  if (index >= 0 && lines[index] === line) return false;
  if (index >= 0) lines[index] = line;
  else lines.push(line);
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return true;
}

export interface LoginHelperDeps {
  /** Context opener. Default: headed launchPersistentContext (own playwright quarantine site). */
  openContext?: () => Promise<LoginContext>;
  /** Cookie file target. Default: LINKEDIN_COOKIES_FILE from the merged env, else DEFAULT_COOKIE_PATH. */
  cookiePath?: string;
  /** The .env document to upsert. Default: <cwd>/.env. */
  dotEnvPath?: string;
  /** Environment for the cookie-path default. Default: envWithDotEnv(). */
  env?: Record<string, string | undefined>;
  pollMs?: number;
  timeoutMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface LoginHelperResult {
  cookiePath: string;
  dotEnvUpdated: boolean;
}

async function openDefaultContext(profileDir: string): Promise<LoginContext> {
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
  });
  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
  return {
    cookies: (url) => context.cookies(url),
    close: async () => {
      await context.close();
    },
  };
}

/**
 * Run the helper: open the headed context, poll the jar until the pair
 * appears (or the budget dies), write the cookie file + the .env line,
 * close the context in finally. Timeout throws fail-visibly; Ctrl-C or a
 * closed window surfaces as a poll error with the same contract.
 */
export async function runLoginHelper(deps: LoginHelperDeps = {}): Promise<LoginHelperResult> {
  const env = deps.env ?? envWithDotEnv();
  const fromEnv = env[ENV_NAMES.linkedinCookiesFile]?.trim();
  const cookiePath =
    deps.cookiePath ?? (fromEnv !== undefined && fromEnv !== "" ? fromEnv : DEFAULT_COOKIE_PATH);
  const dotEnvPath = deps.dotEnvPath ?? join(process.cwd(), ".env");
  const pollMs = deps.pollMs ?? POLL_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const sleepFn =
    deps.sleepFn ??
    ((ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const now = deps.now ?? Date.now;
  const openContext = deps.openContext ?? (() => openDefaultContext(DEFAULT_PROFILE_DIR));

  const context = await openContext();
  try {
    console.log(
      "login-linkedin: browser open — log in to LinkedIn by hand (2FA included); waiting for the session...",
    );
    const deadline = now() + timeoutMs;
    let pair = findSessionCookies(await context.cookies("https://www.linkedin.com"));
    while (pair === null) {
      if (now() >= deadline) {
        throw new Error(
          `login-linkedin: no LinkedIn session appeared within ${Math.round(timeoutMs / 60_000)} min — complete the login (2FA included) in the opened window, then re-run`,
        );
      }
      await sleepFn(pollMs);
      pair = findSessionCookies(await context.cookies("https://www.linkedin.com"));
    }
    await writeCookieFile(pair, cookiePath);
    console.log(`login-linkedin: session captured — ${cookiePath}`);
    const dotEnvUpdated = await upsertDotEnvLine(
      dotEnvPath,
      ENV_NAMES.linkedinCookiesFile,
      cookiePath,
    );
    console.log(
      dotEnvUpdated
        ? `login-linkedin: ${dotEnvPath} updated with ${ENV_NAMES.linkedinCookiesFile}`
        : `login-linkedin: ${dotEnvPath} already carries the ${ENV_NAMES.linkedinCookiesFile} line`,
    );
    return { cookiePath, dotEnvUpdated };
  } finally {
    await context.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLoginHelper().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`login-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
```

#### 4. Offline suite for the login helper core
**File**: `tests/login-linkedin.test.ts` (NEW)
**Changes**: the headed browser never opens here — the context seam is injected, sleeps and the clock are injected, file writes land in OS temp. Pins: harvest contract (null-until-both, verbatim quoted `JSESSIONID`), atomic cookie write + round-trip through the REAL `resolveLinkedInCookies` (the quoted-jar dialect resolves to the canonical pair — slice 2 contract), `.env` upsert (create / replace / no-duplicate / unchanged-returns-false), poll spacing via the injected sleep, timeout throws naming the budget with the context closed in finally, and the entry-guard smoke pin.

```ts
/**
 * Offline suite for the login helper core (Phase 7).
 *
 * The headed browser never opens here: runLoginHelper's context seam is
 * injected, sleeps and the clock are injected, and the file writes land
 * in OS temp. Pins the harvest contract (verbatim cookie values, quoted
 * JSESSIONID kept), the atomic cookie-file write, the .env upsert, and
 * the poll/timeout loop over injected doubles.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { ENV_NAMES } from "../src/config.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";
import {
  type LoginContext,
  findSessionCookies,
  runLoginHelper,
  upsertDotEnvLine,
  writeCookieFile,
} from "../scripts/login-linkedin.js";

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function workPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-login-linkedin-"));
  return join(dir, name);
}

const JAR: Array<{ name: string; value: string }> = [
  { name: "bcookie", value: "noise" },
  { name: "JSESSIONID", value: '"ajax:0123456789012345678"' },
  { name: "li_at", value: "AQE-live-li-at" },
];

describe("findSessionCookies", () => {
  it("returns null until BOTH li_at and JSESSIONID are present and non-empty", () => {
    assert.equal(findSessionCookies([]), null);
    assert.equal(findSessionCookies([{ name: "li_at", value: "AQE" }]), null);
    assert.equal(findSessionCookies([{ name: "JSESSIONID", value: '"ajax:1"' }]), null);
    assert.equal(findSessionCookies([{ name: "li_at", value: "  " }, ...JAR.slice(1)]), null);
  });

  it("harvests the pair verbatim — the quoted JSESSIONID stays quoted", () => {
    assert.deepEqual(findSessionCookies(JAR), {
      liAt: "AQE-live-li-at",
      jsessionid: '"ajax:0123456789012345678"',
    });
  });
});

describe("writeCookieFile", () => {
  it("writes the canonical JSON atomically and the session resolver reads it back", async () => {
    const path = await workPath("cookies.json");
    await writeCookieFile(
      { liAt: "AQE-live-li-at", jsessionid: '"ajax:0123456789012345678"' },
      path,
    );
    const entries = await readdir(dirname(path));
    assert.ok(entries.every((entry) => !entry.endsWith(".tmp")));
    // The quoted-jar dialect resolves to the same canonical pair (slice 2 contract).
    assert.deepEqual(resolveLinkedInCookies({ [ENV_NAMES.linkedinCookiesFile]: path }), {
      liAt: "AQE-live-li-at",
      jsessionId: "ajax:0123456789012345678",
    });
  });
});

describe("upsertDotEnvLine", () => {
  it("creates the file with the line when absent", async () => {
    const path = await workPath("env-1");
    assert.equal(
      await upsertDotEnvLine(path, ENV_NAMES.linkedinCookiesFile, "C:/x/cook.json"),
      true,
    );
    assert.equal(await readFile(path, "utf8"), `${ENV_NAMES.linkedinCookiesFile}=C:/x/cook.json\n`);
  });

  it("replaces an existing line without duplicating it", async () => {
    const path = await workPath("env-2");
    await writeFile(path, `OTHER=1\n${ENV_NAMES.linkedinCookiesFile}=C:/old.json\n`, "utf8");
    assert.equal(await upsertDotEnvLine(path, ENV_NAMES.linkedinCookiesFile, "C:/new.json"), true);
    const text = await readFile(path, "utf8");
    assert.ok(text.includes("C:/new.json"));
    assert.ok(!text.includes("C:/old.json"));
    assert.equal(text.match(new RegExp(ENV_NAMES.linkedinCookiesFile, "g"))?.length, 1);
  });

  it("writes nothing when the line already carries the value", async () => {
    const path = await workPath("env-3");
    assert.equal(await upsertDotEnvLine(path, ENV_NAMES.linkedinCookiesFile, "C:/same.json"), true);
    assert.equal(
      await upsertDotEnvLine(path, ENV_NAMES.linkedinCookiesFile, "C:/same.json"),
      false,
    );
    const text = await readFile(path, "utf8");
    assert.equal(text.match(new RegExp(ENV_NAMES.linkedinCookiesFile, "g"))?.length, 1);
  });
});

describe("runLoginHelper", () => {
  it("polls until the jar holds the session, then writes the cookie file and the .env line", async () => {
    const cookiePath = await workPath("helper-cookies.json");
    const dotEnvPath = await workPath("helper.env");
    let polls = 0;
    const sleeps: number[] = [];
    let closed = false;
    const context: LoginContext = {
      cookies: async () => {
        polls += 1;
        return polls >= 3 ? JAR : JAR.filter((cookie) => cookie.name !== "li_at");
      },
      close: async () => {
        closed = true;
      },
    };
    const result = await runLoginHelper({
      openContext: async () => context,
      cookiePath,
      dotEnvPath,
      env: {},
      pollMs: 2_000,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.deepEqual(result, { cookiePath, dotEnvUpdated: true });
    assert.deepEqual(sleeps, [2_000, 2_000]); // two empty polls, then the harvest
    assert.equal(closed, true);
    assert.equal(
      await readFile(dotEnvPath, "utf8"),
      `${ENV_NAMES.linkedinCookiesFile}=${cookiePath}\n`,
    );
  });

  it("times out fail-visibly and still closes the context", async () => {
    const cookiePath = await workPath("timeout-cookies.json");
    const dotEnvPath = await workPath("timeout.env");
    let closed = false;
    const context: LoginContext = {
      cookies: async () => JAR.filter((cookie) => cookie.name !== "li_at"),
      close: async () => {
        closed = true;
      },
    };
    let tick = 0;
    await assert.rejects(
      () =>
        runLoginHelper({
          openContext: async () => context,
          cookiePath,
          dotEnvPath,
          env: {},
          pollMs: 1_000,
          timeoutMs: 5_000,
          sleepFn: async (ms) => {
            tick += ms; // the injected sleep advances the injected clock
          },
          now: () => tick,
        }),
      /no LinkedIn session appeared/,
    );
    assert.equal(closed, true);
  });
});

describe("entry guard", () => {
  it("importing the module stays side-effect free (no browser opens)", async () => {
    // The import above already ran the module top level: reaching this
    // test without a headed Chromium launch IS the pin (the guard kept
    // main off). runLoginHelper is the exported seam the tests drive.
    assert.equal(typeof runLoginHelper, "function");
  });
});
```

#### 5. Resolver messages point at the one command
**File**: `src/linkedin-session.ts` (MODIFY)
**Changes**: the unset and missing-file messages name the helper instead of the devtools recipe. The existing test regex pins survive UNCHANGED — both messages keep their pinned prefixes (`LINKEDIN_COOKIES_FILE is not set`, `points at ... which does not exist`) and still name the variable in every rejection (the `names the variable in every rejection message` pin).

```ts
// unset message — was: "point it at a cookie file exported from a logged-in browser (README: PC operations)"
throw fail(
  `${envName} is not set — run "npm run login-linkedin" to create the cookie file (README: PC operations)`,
);
// missing-file message — was: "export the cookie pair from a logged-in browser first (README: PC operations)"
throw fail(
  `${envName} points at ${filePath}, which does not exist — run "npm run login-linkedin" to create it, or fix the path (README: PC operations)`,
);
```

#### 6. PC scripts wire the merged env
**Files**: `scripts/probe-linkedin.ts`, `scripts/fetch-linkedin.ts`, `scripts/watch-linkedin.ts` (MODIFY)
**Changes**: each entry merges `<cwd>/.env` once at startup and passes the merged record everywhere it previously read `process.env` directly. Probe delta (its three env reads unify on one merged record — `resolveLinkedInTransport` previously got `undefined` and silently read process.env past the merged record):

```ts
import { envWithDotEnv } from "../src/env-file.js";
// probe main try block:
  const env = envWithDotEnv();
  const cookies = resolveLinkedInCookies(env);
  const transportSelection = env[ENV_NAMES.linkedinTransport]?.trim() || "curl";
  // ...
  const transport = await resolveLinkedInTransport(env, cookies); // was: resolveLinkedInTransport(undefined, cookies)
```

fetch-linkedin delta (entry guard only — fetchTick's injectable env default stays process.env for tests):

```ts
import { envWithDotEnv } from "../src/env-file.js";
// entry guard:
  fetchTick({ env: envWithDotEnv() }).catch(async (error: unknown) => {
```

watch-linkedin delta (merged once before the loop; ticks reuse it):

```ts
import { envWithDotEnv } from "../src/env-file.js";
import { isLegDead } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";

/** The 10-minute cadence, in code (D1: an always-on npm script). */
const TICK_MS = 600_000;

/** The merged env, resolved once: .env fills unset keys, the real shell wins. */
const ENV = envWithDotEnv();

async function main(): Promise<void> {
  for (;;) {
    try {
      await fetchTick({ env: ENV });
```

#### 7. npm entry + globs
**File**: `package.json` (MODIFY)
**Changes**: the `login-linkedin` entry joins; lint + format globs gain `scripts/login-linkedin.ts`.

```json
    "lint": "biome check src tests scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/hooks",
    "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts",
    "fetch-linkedin": "tsx scripts/fetch-linkedin.ts",
    "watch-linkedin": "tsx scripts/watch-linkedin.ts",
    "probe-linkedin": "tsx scripts/probe-linkedin.ts",
    "login-linkedin": "tsx scripts/login-linkedin.ts",
```

#### 8. README PC-operations re-key
**File**: `README.md` (MODIFY)
**Changes**: PC-ops step 1 becomes the one-command flow (devtools export stays documented as the manual fallback); a note states the PC scripts read `.env` beside the clone root (`LINKEDIN_COOKIES_FILE`, `CURL_IMPERSONATE_BIN`), real env wins. The §2.4 boundary sentence updates: no HEADLESS re-login exists; the headed helper keeps the operator in the loop.

```md
1. `npm run login-linkedin` — opens a real Chrome window; log in by hand
   (2FA included). The helper waits for the session, writes the cookie
   file, and adds the LINKEDIN_COOKIES_FILE line to .env automatically.
   Re-run it when the session dies — the browser profile persists, so a
   still-signed-in jar is harvested without a new login; the loop's next
   tick heals, no restart. Manual fallback (devtools export into
   `{ "liAt": "...", "jsessionid": "ajax:..." }`) still works: point
   LINKEDIN_COOKIES_FILE at the file in .env or the shell.
```

#### 9. AGENTS.md sync
**File**: `AGENTS.md` (MODIFY)
**Changes**: commands gain the `npm run login-linkedin` bullet (headed login; writes cookie file + .env line); the module bullets gain `src/env-file.ts` (.env auto-load: fills only unset keys, real env wins) and `scripts/login-linkedin.ts` (headed harvest; exit 1 on timeout/no session).

#### 10. Guidance sync (three files)
**Files**: `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/scripts/architecture.md`, `.rpiv/guidance/tests/architecture.md` (MODIFY)
**Changes**: src guidance gains the `env-file.ts` module line and the login helper row, and updates the playwright quarantine statement to THREE sites (threads walk, linkedin transport's API-request context, the login helper's headed persistent context); scripts guidance gains `login-linkedin.ts` (exports runLoginHelper/findSessionCookies/upsertDotEnvLine/writeCookieFile; interactive; exit contract: exit 1 on timeout/no session; cookie file + .env written) and joins the npm-entry invoker list; tests guidance gains two coverage-map rows (`env-file.ts → env-file.test.ts`, `login-linkedin.ts (core) → login-linkedin.test.ts — context seam injected, no headed Chromium in tests`).

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint` (globs now include `scripts/login-linkedin.ts`)
- [x] Tests pass: `npm test` — the two new suites green, rest untouched
- [x] `parseDotEnv` pinned: KEY=VALUE, `#` comment, blank line, one quote pair stripped, empty value kept, malformed line warns ONCE naming file+line and is skipped
- [x] `envWithDotEnv` pinned: `.env` fills ONLY unset keys; the real environment wins the conflict; a missing `.env` returns the input untouched; an unreadable `.env` never throws
- [x] `findSessionCookies` pinned: null until BOTH cookies present and non-empty; the pair rides verbatim (quoted `JSESSIONID` kept)
- [x] `writeCookieFile` pinned: atomic write, no temp litter, and the REAL `resolveLinkedInCookies` reads the quoted-jar dialect back to the canonical pair
- [x] `upsertDotEnvLine` pinned: creates the file, replaces an existing line without duplicating, returns false and writes nothing when the value already matches
- [x] `runLoginHelper` pinned over injected doubles: polls spaced `pollMs` apart via the injected sleep, success writes the cookie file + the `.env` line and closes the context, timeout throws `/no LinkedIn session appeared/` with the context closed in finally
- [x] Entry guard: importing `scripts/login-linkedin.ts` stays side-effect free (no browser opens on import)
- [x] Resolver messages: unset and missing-file both point at `npm run login-linkedin`; the existing regex pins in `tests/linkedin-session.test.ts` pass UNCHANGED
- [x] Env wiring: `git grep -n "envWithDotEnv" -- scripts` names all four PC scripts; an `.env`-only setup (no shell env) reaches the probe's transport leg (which still exits 1 naming `CURL_IMPERSONATE_BIN` — the env resolution is what's pinned)
- [x] `package.json`: the `login-linkedin` entry + lint/format globs include `scripts/login-linkedin.ts`

#### Manual Verification:
- [ ] Real headed run: `npm run login-linkedin` opens the window → log in by hand → the cookie file + `.env` line land → `npm run probe-linkedin` runs with NO env setup (needs live cookies — the same live-leg gate as Phase 4)
- [ ] Refresh rehearsal: re-run `npm run login-linkedin` on a still-signed-in profile → harvested WITHOUT a login prompt; a leg-dead loop heals on its next tick (no restart)

---

## Phase 8: Leg-dead classifier amendment + empty-payload guard

### Overview

The 2026-11-05 validate gate failed on live rehearsal evidence (blockers b1+b2): a shape-valid DEAD cookie pair driven through the real stack produced a 302 redirect loop, the walk warned-and-skipped every surface, and `fetchTick` wrote and pushed an EMPTY payload — `leg: "ok"` hosted-side, dead leg invisible, last good payload clobbered. The failing oracle is the kept rehearsal: `npx tsx .rpiv/tmp/session-dead-rehearsal.mjs` exits 1 until this phase lands (it asserts leg-dead thrown, no payload written, git never reached, exactly one episode alarm), and should pass UNCHANGED after the fix.

Fix shape — one policy site, both transports: `classifyFault` gains a 3xx branch (leg-dead; the endpoint never legitimately redirects a GET), and the Playwright adapter stops following redirects (`maxRedirects: 0`) so the 302 surfaces AS A STATUS into that same branch — no error-string matching on Playwright's `Max redirect count exceeded` throw. Then the empty-payload guard: an ALL-faulted walk is a tagged no-op (`AllSurfacesFaulted`, the LegDeadError idiom), and `fetchTick` returns quiet zeros without touching payload, git, or the episode marker. Partial faults keep degrading per D13 (survivors still publish); a legitimate zero-post day keeps writing (defb8af, empty-is-success — 0 faulted + 0 posts is an outcome, not a fault).

### Changes Required:

#### 1. classifyFault: the 3xx branch
**File**: `src/linkedin-fetch.ts` (MODIFY)
**Changes**: Insert before the 403 branch (the `trimmed` local already exists). Update the doc-comment table with the live-observed row and the §13.1 contradiction note (live 2026-11-05: the API-request context received the redirect loop, with `set-cookie: li_at=delete me` and Cloudflare `__cf_bm` cookies in the chain).

```ts
  // Live-observed 2026-11-05 (validate rehearsal): a dead session presents
  // as a 302 redirect loop on this endpoint — DOCUMENTATION.md §13.1 says
  // only browser navigations redirect; the claim does not hold for this
  // client stack. Root cause (session death vs edge fingerprint block) is
  // unresolved ON PURPOSE: both carry the same operator remedy, so the
  // classification must not wait on it. The endpoint never legitimately
  // redirects a GET — any 3xx is leg-dead, same remedy as 401 (§13.1).
  if (status >= 300 && status < 400) {
    return {
      kind: "legDead",
      reason: `HTTP ${status} redirect loop — dead session or edge block; refresh the cookie file (live-observed 2026-11-05, §13.1 amendment)`,
    };
  }
```

#### 2. Playwright transport: stop following redirects — one policy site
**File**: `src/linkedin-fetch.ts` (MODIFY)
**Changes**: `createPlaywrightTransport`'s `get` passes `maxRedirects: 0` so a redirect surfaces as a response status into the §13.3 classifier (was: 20 unpaced redirects, then a thrown plain error that bypassed the classifier entirely).

```ts
    const get: VoyagerGet = async (url) => {
      const response = await context.get(url, { maxRedirects: 0 });
      return { status: response.status(), body: await response.text() };
    };
```

#### 3. The walk: every surface faulted is a tagged no-op
**File**: `src/linkedin-fetch.ts` (MODIFY)
**Changes**: Tagged error mirroring the LegDeadError idiom (factory-assigned mutable fields; the judge-rotation shape):

```ts
export const ALL_SURFACES_FAULTED = "AllSurfacesFaulted";

/** Thrown when EVERY configured surface faulted and none published posts (D13: the tick, not the walk, decides the write). */
export interface AllSurfacesFaulted extends Error {
  name: string;
  faulted: number;
}

export function allSurfacesFaulted(faulted: number): AllSurfacesFaulted {
  const error = new Error(`linkedin-fetch: all ${faulted} surface(s) faulted — nothing fetched`) as AllSurfacesFaulted;
  error.name = ALL_SURFACES_FAULTED;
  error.faulted = faulted;
  return error;
}

export function isAllSurfacesFaulted(error: unknown): error is AllSurfacesFaulted {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === ALL_SURFACES_FAULTED
  );
}
```

Walk wiring: track `faultedCount` (bump in the catch's NON-leg-dead arm — the leg-dead arm keeps `return`); after runPool, keep the leg-dead drain check FIRST, then:

```ts
  if (deadReason !== undefined) {
    throw legDead(deadReason);
  }
  if (surfaces.length > 0 && faultedCount === surfaces.length) {
    throw allSurfacesFaulted(faultedCount);
  }
```

#### 4. fetchTick: all-faulted → quiet zeros, nothing touched
**File**: `scripts/fetch-linkedin.ts` (MODIFY)
**Changes**: catch `isAllSurfacesFaulted` around the walk call (inside the existing try/finally — the finally's disposal still runs): warn naming the count, return `{ wrote: false, pushed: false, postCount: 0 }`. No payload write, no git, no episode-marker clear. The leg-dead path is UNCHANGED (re-thrown; the entry/loop callers own the alarm policy).

```ts
  let posts: Post[];
  try {
    posts = await fetchLinkedInPosts(surfaces, cookies, transport.get);
  } catch (error) {
    if (isAllSurfacesFaulted(error)) {
      console.warn(
        `fetch-linkedin: all ${error.faulted} linkedin surface(s) faulted — payload not touched, last good payload preserved`,
      );
      return { wrote: false, pushed: false, postCount: 0 };
    }
    throw error;
  } finally {
    if (deps.transport === undefined) await transport.dispose();
  }
```

#### 5. Design amendment: the failure table gains the redirect-loop row
**File**: `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` (MODIFY)
**Changes**: the §13.3-derived detection table gains one row, and its provenance note records the contradiction: `302/3xx redirect loop → leg-dead (live-observed 2026-11-05; DOCUMENTATION.md §13.1's API-vs-browser redirect claim does not hold for this client stack; remedy identical to 401)`.

#### 6. Suite amendments
**File**: `tests/linkedin-fetch.test.ts` (MODIFY)
**Changes**:
- classifyFault table: `302` → leg-dead naming the redirect; `301` and `307` pin the whole 3xx band; a 302 with a body is still leg-dead. The seven existing §13.3 rows stay byte-identical.
- Walk: a scripted `302` response on one surface drains then throws leg-dead ONCE with the sibling pager stopped — THE live-regression pin.
- Walk: leg-dead beats faults — one surface `302`, one surface `500` → leg-dead wins (the drain check precedes the all-faulted throw).
- Walk: single-surface unparsable 200 → now ALL-faulted → throws `AllSurfacesFaulted` (amends the existing "treats an unparsable 200 body as a surface fault" pin: that config is the only surface).
- Walk: two surfaces, one faulted + one fine-empty → returns `[]`, NO throw (partial fault degrades; defb8af preserved).
- Walk: two surfaces, both faulted → throws `AllSurfacesFaulted` with `faulted === 2`.
- The playwright adapter stays unexercised (the chromiumContextFactory precedent — the seam carries the tests).

**File**: `tests/fetch-linkedin.test.ts` (MODIFY)
**Changes**:
- `fetchTick` over an all-faulting transport → `{ wrote: false, pushed: false, postCount: 0 }`, NO payload file on disk, zero git calls, episode marker untouched.
- `fetchTick` over a fine-empty transport (0 posts, 0 faults) → STILL writes and pushes the empty payload (defb8af at the tick level — the guard keys on faults, not post count).
- `fetchTick` still propagates leg-dead without writing (existing pin unchanged); caller-owned transport disposal contract unchanged.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test` — amended suites green, rest untouched, zero real sleeps
- [x] classifyFault pins: 302/301/307 → leg-dead naming the redirect loop; a bodied 302 too; the seven §13.3 rows unchanged
- [x] Walk pins: 302 drains then throws leg-dead ONCE with the sibling pager stopped; leg-dead beats faults in the post-join order; single-surface fault → `AllSurfacesFaulted`; 1-of-2 faulted → survivor's posts, no throw; 2-of-2 faulted → `AllSurfacesFaulted` with `faulted === 2`; 0-faulted empty stays a success
- [x] fetchTick pins: all-faulted → `{wrote:false, pushed:false, postCount:0}` with no payload file, no git, no marker clear; fine-empty → writes and pushes as before; leg-dead propagation unchanged
- [x] The validate blocker command exits 0 UNCHANGED: `npx tsx .rpiv/tmp/session-dead-rehearsal.mjs` (kept under `.rpiv/tmp/` — the scope-floor-exempt dir — until re-validate passes; delete after)
- [x] Design artifact: the detection table carries the redirect-loop row with the §13.1 contradiction note

#### Manual Verification:
- [ ] Live session-dead rehearsal from the dedicated clone (discharges the Phase 4 item this phase amends): corrupt the cookie-file copy → the tick throws leg-dead → exactly ONE alarm email and the loop continues; restore the file → the next tick heals
- [ ] curl-transport dead-session presentation re-verified live (the rehearsal used playwright; the curl leg must show the same leg-dead abort via the new 3xx branch)

---

## Testing Strategy

### Automated:
- Per-phase gate: `npm run typecheck && npm run lint && npm test` — CI runs the same three; each phase's own Automated Verification block carries them (read-only repo-wide commands, safe under parallel phases; no formatter/fixer runs unscoped)
- Whole-plan final gate (owned by validate): `npm run typecheck`, `npm run lint`, `npm test` over the finished tree — green at base per repo doctrine (CI runs the same three at 4c11e0f)
- Phase 6 acceptance greps (residue + wording sweeps) live in Phase 6's own Success Criteria — `git grep` walks tracked files only, excluding `.rpiv/artifacts/**`

### Manual Testing Steps:
1. Probe protocol: `npm run probe-linkedin` twice ≥6h apart with stored cookies only, per transport, before trusting the loop; re-run after any `LINKEDIN_TRANSPORT` change (Phase 4)
2. Round-trip: loop tick → payload commit visible on main → dispatched watch run logs the payload merge line → digest carries `[linkedin]` rows
3. Conflict rehearsal: land a bot commit between the PC's checkout and push; the rebase+retry push succeeds (Phase 4)
4. PC-off rehearsal: stop the loop ≥31 min → dispatched run logs the stale-payload line, completes threads-only, heartbeat fires, state byte-identical (Phase 5)
5. Session-dead rehearsal: corrupt the cookie file copy → tick throws leg-dead → exactly ONE alarm email, loop continues; restore file → next tick heals (Phase 4)
6. queryId expiry watch (§15): a sudden 500 on a formerly-200 endpoint means the hash expired — README documents the §9 re-derivation recipe pointer
7. Post-slice-6: `git check-ignore state/linkedin-leg-dead.flag` names the path (the loop's episode marker must never be trackable)
8. Login helper real run (Phase 7): `npm run login-linkedin` → log in by hand in the opened window → cookie file + `.env` line land → `npm run probe-linkedin` with NO env setup
9. Refresh rehearsal (Phase 7): re-run `npm run login-linkedin` on a still-signed-in profile → harvested without a login prompt; a leg-dead loop heals on its next tick
10. Phase 8 live rehearsal (dedicated clone): corrupt the cookie-file copy → the tick throws leg-dead on the redirect loop → exactly ONE alarm email, loop continues; restore the file → the next tick heals (discharges the Phase 4 session-dead item)

## Performance Considerations

- Fetch tick: ~60-120s (2 surfaces paging 2-wide under the shared 5s pacing gate + adapter boot) — the pacing gate, not the pool width, bounds the anti-bot rate. Loop tick budget ≤ 3 min — well under the 10-min cadence.
- The 2026-11-04 pacing fix (reserve-before-sleep) serializes voyager GET STARTS: tick time now scales with TOTAL PAGES, not pool width — width buys input-order reassembly, never speed (the D11 claim — pacing-bound rate — is unchanged). The ~60-120s estimate holds at 2 surfaces; each extra full 50-post page adds one ~5s pacing slot. Re-derive the budget if the surface count grows.
- Request volume: ≤ ~20 voyager GETs per tick (~2,880/day worst case) — §13.3 throttling thresholds were observed at ~40 RAPID calls; the 5s pacing + cadence spread keeps the rate low, but this is the primary curl-transport risk the probe watches.
- Payload size: ≤ ~1,000 posts × ~1 KB ≈ ≤1 MB; atomic write + one-file commit keeps push latency trivial.
- Hosted watch job budget unchanged: payload read is a single small file parse; the LinkedIn fetch term leaves the F023 envelope arithmetic entirely.
- Git history: one small commit per tick (~144/day) on `state/linkedin-posts.json` — the N017 accepted-growth pattern, bounded by 24h-post content.

## Migration Notes

- Seen-state continuity: voyager `backendUrn` mints `urn:li:activity:<id>` — byte-identical to SDK-era ids already in `state/seen-posts.json`, so the cutover never re-judges or re-emails an old post.
- Cutover order: phases 1-5 can land while the SDK arm is still wired (it is dead in production anyway — one warn per run); Phase 5 re-keys the arm, Phase 6 deletes the quad. No interim dual-fetcher state exists.
- Rollback: each phase is a normal commit; reverting Phase 6 (then 5 for the re-key) restores the (dead) SDK arm; the PC loop is independent of repo rollback (stop the console).
- No persisted-schema change: `state/seen-posts.json` untouched; the payload file is additive and self-describing (`version: 1`).
- Device notes (README): curl-impersonate binary is a PC-local download (no npm dep); the cookie file lives outside the repo; `git pull --rebase` inside the loop auto-updates the loop's own code from main.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source   | plan-loc    | codebase-loc    | severity    | dimension    | finding    | recommendation    | resolution    |
| -------- | ----------- | --------------- | ----------- | ------------ | ---------- | ----------------- | ------------- |
| coverage | ## Verification Notes §2 | <n/a> | blocker | verification-coverage | Design Verification Note clause "parkUntilEligible (src/judge-rotation.ts:143-167) is untouched by every slice in this design" landed as neither a Success Criteria bullet nor a Testing Strategy step — sibling clauses of the same bullet became Phase 3/5 criteria; grep finds zero `parkUntilEligible` mentions in the plan | Add a Phase 5 Automated Verification bullet: re-key leaves `src/judge-rotation.ts` byte-identical — `git diff --name-only -- src/judge-rotation.ts` returns empty after the phase | applied: Phase 5 AV bullet added pinning judge-rotation.ts byte-identical
| code     | Phase 6     | src/config-file.ts:223 | concern | actionability | Pre-delete gate promises "returns ONLY the two `src/config.ts` ENV_NAMES pair lines", but at phase start `src/config-file.ts:223` and `src/threads-session.ts:14` also match the pattern — both are re-keyed later in the same phase (§4, §5), so a gate run before any edits returns 4 lines and fails as worded | State that the gate runs after §4/§5's comment re-keys land (or add `:(exclude)` pathspecs with their §4/§5 ordering named) | applied: ordering sentence added to the Phase 6 overview
| code     | Phase 6 §18 | package-lock.json | concern | actionability | `npm uninstall @linkedapi/node` regenerates `package-lock.json`, which is absent from Phase 6's frontmatter `files:` list — the phase's own verification writes outside its declared file set | Add `package-lock.json` to Phase 6's frontmatter `files:` entry | applied: package-lock.json added to Phase 6 frontmatter files
| code     | Phase 6 §7  | <n/a> | concern | actionability | §7 is a MODIFY entry with no fence and no before/after content — "one provenance-comment line re-splices" names neither the target line nor its replacement, so the implementer cannot execute it and the SC checkbox "slice-1 fence line re-spliced" is unverifiable against it | Quote the exact comment line before/after (or state verbatim which Phase 1 fence line changes and to what) | applied: §7 rewritten verify-only — the Phase 1 fence already carries the re-splice (byte-match oracle)
| code     | Phase 3 §1  | <n/a> | concern | code-quality | `createPlaywrightTransport` sends only `csrf-token` + `VOYAGER_STATIC_HEADERS` — no `user-agent` — while `createCurlTransport` hardcodes a Chrome/131 UA; the fallback transport hits the anti-bot-guarded voyager endpoint with Playwright's default (non-browser) UA, inviting the §13.3 challenge class the classifier treats as leg-dead | Add the same Chrome UA header to `extraHTTPHeaders` in `createPlaywrightTransport` so both adapters present identical client fingerprints | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md): shared BROWSER_UA const feeds both adapters
| code     | Phase 4 §6  | <n/a> | suggestion | codebase-fit | The probe reads `process.env.LINKEDIN_TRANSPORT` by string literal, bypassing `ENV_NAMES.linkedinTransport` — every other reader of this name resolves it through `ENV_NAMES` | Import `ENV_NAMES` from `../src/config.js` and read `process.env[ENV_NAMES.linkedinTransport]` | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md): probe now imports ENV_NAMES
| code     | Phase 4 §1  | src/state.ts:169 | suggestion | codebase-fit | `writePayloadAtomic` re-inlines the temp-name mint `.${now()}.${Math.random()...}.tmp`, duplicating the exported `stateTempPath` helper (src/state.ts:169-175) that centralizes this sibling-temp idiom | Import `stateTempPath` from `./state.js` and use it for `tempPath` in `writePayloadAtomic` | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md): stateTempPath now reused; unused `join` import dropped

## Developer Context

**Step 4/5 review trail (2026-11-04):** artifact-code-reviewer + artifact-coverage-reviewer ran in parallel post-finalization; 7 findings (1 blocker, 4 concerns, 2 suggestions), ALL triaged `applied` by the developer. Blocker: judge-rotation.ts non-modification pin added to Phase 5 AV. Concerns: Phase 6 §4/§5-before-gate ordering sentence; `package-lock.json` added to Phase 6 frontmatter files (write-scope); §7 rewritten verify-only (the Phase 1 fence already carries the slice-6 re-splice — byte-match oracle); Playwright transport now sends the shared `BROWSER_UA` (design-root gap). Suggestions: probe reads `ENV_NAMES.linkedinTransport`; `writePayloadAtomic` reuses `stateTempPath` from `./state.js` (unused `join` import dropped). Three code fixes are plan-local with a design follow-up annotation (BROWSER_UA, probe env read, stateTempPath) — their root cause sits in the design's verbatim fences; the design artifact should absorb them on its next revision.

## Follow-up 2026-11-05T09:13:46+0700 (revise — operator feedback: least-manual setup)

- **Feedback**: `npm run probe-linkedin` failed with `LINKEDIN_COOKIES_FILE is not set` (the fail-visible contract working as designed — the env var was simply never set); the operator wants the least manual setup possible.
- **Research**: the repo had ZERO `.env` loading — `npm run` does not read `.env`, so the README's ".env or shell profile" hint was dead without shell setup. The deleted f571904 login fallback was HEADLESS automated credential login (removed bf6594c; 2FA dead-end, live-confirmed) — Phase 7's headed helper is a different mechanism: the human logs in by hand (DOCUMENTATION.md §2.4 VERIFIED interactive login), the script only harvests cookies. Playwright was already a dependency; no new runtime dep.
- **Decision (user-confirmed)**: Login helper + auto-env; Task Scheduler auto-start stays OUT (the plan's original exclusion stands).
- **Added Phase 7** (login helper + auto-env): `npm run login-linkedin` (headed persistent-profile Chromium, human login, jar harvest, atomic cookie write, `.env` upsert), `src/env-file.ts` (`.env` fills ONLY unset keys; real env wins; missing = quiet), resolver messages point at the one command (existing test regex pins survive unchanged), all four PC scripts wire `envWithDotEnv()`, package.json/README/AGENTS/guidance sync.
- **Phases 1-6 checkmarks left intact**: Phase 7 reopens `src/linkedin-session.ts` for message text whose pinned prefixes still match; every other edit is new Phase 7 surface with its own unchecked criteria.

## Follow-up 2026-11-05T10:27:36+0700 (revise — validate blockers b1+b2)

- **Feedback**: `/skill:validate` returned `verdict: fail` (`.rpiv/artifacts/validation/2026-11-05_10-01-36_linkedin-local-leg.md`): the Phase 4 session-dead criterion failed under live rehearsal — dead cookies produced a PUSHED EMPTY PAYLOAD, not a leg-dead abort. Blockers b1 (302 redirect loop filed as a generic fault; playwright's max-redirects throw bypasses the classifier) and b2 (fetchTick publishes an all-faulted walk's empty payload; hosted reader scores it `leg: "ok"`).
- **Research**: no new codebase research needed — the validation session pinned the exact sites (`src/linkedin-fetch.ts:140-173` classifier, `createPlaywrightTransport.get`, `scripts/fetch-linkedin.ts:218`) and the live mechanism (302 loop with `set-cookie: li_at=delete me` + `__cf_bm`; playwright throws `Max redirect count exceeded` after 20 redirects). DOCUMENTATION.md §13.1's claim (API GETs answer 401/400/403; only browser navigations redirect) is contradicted by the live trace — the plan amends the policy without resolving root cause (session death vs edge fingerprint block carry the same remedy).
- **Decision (user-confirmed)**: cover the validation blockers only; the unpaced-redirect performance extra was offered and declined (note: `maxRedirects: 0` — required by the b1 fix anyway — also removes the 20-unpaced-redirects cost as a side effect).
- **Added Phase 8** (leg-dead classifier amendment + empty-payload guard): classifyFault 3xx → leg-dead; playwright `maxRedirects: 0` so the status reaches the classifier; tagged `AllSurfacesFaulted` when every surface faults; fetchTick returns quiet zeros without touching payload/git/marker. Design artifact's detection table amended (§5). Phase 8 is verified by the kept rehearsal oracle (`npx tsx .rpiv/tmp/session-dead-rehearsal.mjs` must exit 0 unchanged) plus new offline pins.
- **Phases 1-7 checkmarks left intact**: every existing §13.3 pin stays true (the 3xx rows are additive); Phase 4's live session-dead manual criterion stays UNCHECKED — Phase 8's manual item discharges it.

## References

- Design: `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md`
- Parent solution: `.rpiv/artifacts/solutions/2026-11-03_17-38-05_linkedin-execution-home.md` (Option 2 shape implemented)
- Transport decision chain: `.rpiv/artifacts/solutions/2026-11-03_14-25-19_linkedin-voyager-transport.md`
- Research: `.rpiv/artifacts/research/2026-11-03_12-57-53_linkedin-voyager-fetcher.md`
- Endpoint spec of record: `H:/fork/linkedin-reverse/DOCUMENTATION.md` (§1-§15)
- Live capture (fixture trim source): `.rpiv/tmp/voyager-capture.json`
- Push discipline mirrored: `scripts/commit-state-rebase.sh`
- curl-impersonate: https://github.com/lwthiker/curl-impersonate
