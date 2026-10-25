---
date: 2026-10-25T10:48:08+0700
author: Yogiswara Utama
commit: no-commit
branch: no-branch
repository: unknown
topic: "Threads #hiring Indonesia job alerts — full v1 pipeline"
tags: [plan, threads, playwright, scraper, github-actions, email]
status: ready
parent: .rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md
phase_count: 10
phases:
  - { n: 1, title: Scaffold + contracts, files: [package.json, tsconfig.json, src/types.ts, src/config.ts], depends_on: [] }
  - { n: 2, title: Extraction, files: [src/types.ts, src/extract.ts, tests/fixture/tag-page.html, tests/extract.test.ts], depends_on: [1] }
  - { n: 3, title: Fetch (Playwright), files: [src/fetch-threads.ts, src/config.ts], depends_on: [1, 2] }
  - { n: 4, title: Filters (keywords + LLM judge), files: [src/keywords.ts, src/judge.ts, tests/keywords.test.ts], depends_on: [1] }
  - { n: 5, title: State, files: [src/state.ts, state/seen-posts.json], depends_on: [1] }
  - { n: 6, title: Email digest, files: [src/email.ts, tests/email.test.ts], depends_on: [1] }
  - { n: 7, title: CLI + workflow + README, files: [src/index.ts, .github/workflows/watch.yml, README.md, package-lock.json], depends_on: [2, 3, 4, 5, 6] }
  - { n: 8, title: Authenticated fetch + recency, files: [src/config.ts, src/extract.ts, src/threads-session.ts, src/recency.ts, src/fetch-threads.ts, src/index.ts, tests/fixture/graphql-response.json, tests/extract.test.ts, tests/recency.test.ts, tests/session.test.ts, .github/workflows/watch.yml, README.md], depends_on: [3, 7] }
  - { n: 9, title: No-match heartbeat, files: [src/config.ts, src/heartbeat.ts, src/email.ts, src/index.ts, tests/heartbeat.test.ts, tests/email.test.ts, README.md], depends_on: [6, 7] }
  - { n: 10, title: JSON config + URL surfaces, files: [watcher.config.json, src/config-file.ts, src/config.ts, src/keywords.ts, src/heartbeat.ts, src/fetch-threads.ts, src/index.ts, .github/workflows/watch.yml, README.md, tests/config-file.test.ts, tests/keywords.test.ts, tests/heartbeat.test.ts], depends_on: [7, 8, 9] }
last_updated: 2026-10-25T14:36:42+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Phase 10 makes watcher.config.json the source of truth for surfaces, keywords, heartbeat candidate terms and the recency window, and adds URL-based surfaces (a profile page and a search URL) alongside tag pages. THREADS_TAGS and RECENCY_HOURS are retired. Fixes the lowker -> loker typo. Four criteria in Phases 3, 4 and 8 are rewritten because Phase 10 relocates the symbols they grep for."
---

# Threads #hiring Indonesia job alerts — Implementation Plan

## Overview

Implements the full v1 pipeline from the design artifact `.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md`: a single TypeScript CLI (run by tsx, no build step) that a GitHub Actions workflow executes every 10 minutes. Playwright loads configurable Threads tag pages, posts are extracted from the embedded `data-sjs` JSON, a keyword pre-filter trims the feed, one OpenAI-compatible LLM call per maybe-post returns `{relevant, locationOk}`, a diff against `state/seen-posts.json` drops already-seen posts, a plain-text Gmail digest is sent when there is at least one new match, and the state file is committed back as `github-actions[bot]`. Phase 8 switches the fetch to an authenticated Threads session (Recent tab, graphql XHR capture, scroll) behind a recency cutoff, and falls back to the logged-out path when no session secret is configured.

Phase boundaries are inherited 1:1 from the design's `## Slices` section. Success Criteria pass through verbatim. Code blocks come from the design's `## Architecture` section.

## Desired End State

The repo is public on GitHub. Every 10 minutes (best-effort), Actions runs:

- Fetch + extract logs (authenticated Recent tab): `extract: tag/hiring: 92 post(s) (authenticated)`, `extract: tag/loker: N post(s) (authenticated)`, `extract: tag/infokerja: N post(s) (authenticated)`, `extract: https://www.threads.com/@hiresflow: N post(s) (authenticated)`, `extract: https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent: N post(s) (authenticated)`, then `extract: N unique post(s) across 5 surface(s)` — the surface list, the keyword list, the candidate list and the recency window all come from `watcher.config.json` (Phase 10), so this line changes when that file changes and for no other reason
- Recency log: `recency: 89 post(s) within 72h`
- Filter logs: `keywords: 12 maybes, judge: 3 relevant+located, skipped: 0`
- On new matches, an email like:

  ```
  3 new job posts on Threads (#hiring indonesia)

  1. Looking for a Next.js frontend dev in Jakarta, hybrid...
     — @pttechcareers
     https://www.threads.com/@pttechcareers/post/C8H5FiCtESk
  ...
  ```

- State file commit appears: `github-actions[bot]: state: 3 new seen post ids`
- Zero-match runs log `no new matches` and email a status digest: the scan funnel (unique, within-window, maybes, relevant+located, skipped) plus up to 10 closest candidate posts, each with author, age, text preview and permalink. Example:

  ```
  loker-watcher — 2026-10-25T06:42:00.000Z

  0 new job matches.

    337 unique post(s)
    303 within 72h
    1 keyword maybe(s)
    0 relevant + located
    0 skipped by the judge

  Closest 3 candidate(s), newest first:

  1. @rafshadesignstudio — 0h ago [keyword match]
     Looking for your next high-paying remote dev role? BLOCK.XYZ is expanding its…
     https://www.threads.com/@rafshadesignstudio/post/De6Dy_oDc63
  ...
  ```
- With `THREADS_SESSION_STATE` unset, the run takes the logged-out path and behaves exactly as Phases 1–7.

Local run: `npm install && npx playwright install chromium && npm start`.

## What We're NOT Doing

- No web UI or dashboard (FRD non-goal)
- No platforms other than Threads. The surface list is open-ended inside `watcher.config.json` (tags, profile pages, search URLs), but every surface must be a threads.com URL — no LinkedIn, no other networks
- No Instagram OAuth app or API credentials — the session is a browser storageState export, not an app integration
- No DB — `state/seen-posts.json` is the only persistence. `watcher.config.json` is configuration, not state: it is committed, hand-edited, and never written by a run

---

## Phase 1: Scaffold + contracts

### Overview

Project scaffold and shared contracts. Creates the manifest, the strict TypeScript config, and the two contract modules every later phase imports: `src/types.ts` (Post, JudgeVerdict) and `src/config.ts` (keywords, env-var names, tag surfaces, state path).

Per the developer's Step 3 decision, both contract files ship here in their **final form** — the D11 surface revision (configurable tag pages) and the D12 ThreadItemRaw retirement are already applied. Phases 2 and 3 therefore carry `src/types.ts` and `src/config.ts` in their file lists as verification-only touches; their slice criteria pass as created.

### Changes Required:

#### 1. package.json — NEW
**File**: `package.json`
**Changes**: Project manifest: type module, node >=22, runtime deps (playwright, nodemailer), tsx/typescript dev deps, start/test/typecheck scripts.

```json
{
  "name": "loker-watcher",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "nodemailer": "^6.9.16",
    "playwright": "^1.49.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "@types/nodemailer": "^6.4.17",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

#### 2. tsconfig.json — NEW
**File**: `tsconfig.json`
**Changes**: Strict TS config: NodeNext modules, ES2022 target, noEmit, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

#### 3. src/types.ts — NEW
**File**: `src/types.ts`
**Changes**: Post and JudgeVerdict contracts shared by every phase. Ships in final form: the raw Threads item shape is documented in `src/extract.ts` (D12 — ThreadItemRaw retired).

```ts
/**
 * Pipeline-wide contracts. Slice 1 defined the Post and JudgeVerdict shapes
 * every later slice imports. The raw Threads item shape (entries wrapped as
 * { post: ... } inside "thread_items" arrays) is documented and narrowed in
 * src/extract.ts against a real 2026-10-24 /tag/hiring capture; no separate
 * raw type is exported until a consumer needs one.
 */

/** One Threads post, normalized. Produced by extract (Slice 2). */
export interface Post {
  /** Stable dedup key: numeric post id, e.g. "3388928313420694692". */
  id: string;
  /** Full post text (caption). May contain newlines. */
  text: string;
  /** Author handle without the leading "@". */
  author: string;
  /** Canonical permalink: https://www.threads.com/@{author}/post/{code}. */
  permalink: string;
  /** Post time, ISO 8601 UTC, e.g. "2026-10-24T08:15:00.000Z". */
  timestamp: string;
}

/** LLM verdict for one candidate post (judge, Slice 4). */
export interface JudgeVerdict {
  /** The post is a genuine frontend/fullstack-adjacent job posting. */
  relevant: boolean;
  /** The role is in Indonesia or remote. */
  locationOk: boolean;
}


```

#### 4. src/config.ts — NEW
**File**: `src/config.ts`
**Changes**: Tag surfaces (THREADS_TAGS-configurable, D11), keyword list, env-var name map, state path. Static data only — no secrets. Ships in final form (D11 revision already applied).

```ts
/**
 * Static, non-secret configuration. Every credential is read from the
 * environment at run time (FRD security requirement) and lives in
 * GitHub Actions secrets. Surfaces are tag pages (D11): logged-out search
 * returned 0 posts, tag pages returned 17-19 posts each in the 2026-10-24
 * live probes.
 */

/** Case-insensitive keyword pre-filter: frontend / fullstack + adjacent (FRD #3). */
export const KEYWORDS: readonly string[] = [
  "frontend", "front-end", "front end",
  "fullstack", "full-stack", "full stack",
  "web developer", "web dev",
  "react", "vue", "next.js", "nextjs", "nuxt",
  "angular", "svelte", "typescript", "javascript",
  "node.js", "nodejs",
];

/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsTags: "THREADS_TAGS",
  llmBaseUrl: "LLM_BASE_URL",
  llmApiKey: "LLM_API_KEY",
  llmModel: "LLM_MODEL",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;

/** Tag surfaces sampled when THREADS_TAGS is unset (live-probed 2026-10-24: 19/17/18 posts). */
export const DEFAULT_TAGS: readonly string[] = ["hiring", "lowker", "infokerja"];

/**
 * Resolve the tag list from the environment (comma-separated), falling back
 * to DEFAULT_TAGS when unset, empty, or all-blank.
 */
export function resolveTags(
  env: Record<string, string | undefined>,
): string[] {
  const raw: string | undefined = env[ENV_NAMES.threadsTags];
  if (raw === undefined || raw.trim() === "") return [...DEFAULT_TAGS];
  const tags = raw
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  return tags.length > 0 ? tags : [...DEFAULT_TAGS];
}

/** Canonical URL of one tag page (consumed by src/fetch-threads.ts). */
export function tagPageUrl(tag: string): string {
  return `https://www.threads.com/tag/${encodeURIComponent(tag)}`;
}

/** Commit-back location of the seen-state file (FRD #6). */
export const STATE_PATH = "state/seen-posts.json";
```

### Success Criteria:

#### Automated Verification:
- [x] `npm install` exits 0 and creates node_modules
- [x] `npx tsc --noEmit` exits 0
- [x] `grep -rni "password\|api_key" .` over slice files matches only the env-var NAME constants in src/config.ts (GMAIL_APP_PASSWORD, LLM_API_KEY), never values
- [x] `npm pkg get type` returns "module"

#### Manual Verification:
- [x] `npm start` fails only with "Cannot find module src/index.ts" (expected until Slice 7), not a config or dependency error

---

## Phase 2: Extraction

### Overview

Extraction from rendered HTML: collect `data-sjs` JSON blobs, walk generically for `thread_items` arrays, narrow `.post` media objects, map to `Post[]`, dedupe by pk, and rebuild permalinks (code, with pk-fallback via `codeFromPk`). Tests run against a trimmed real capture fixture, not a synthetic one.

### Changes Required:

#### 1. src/types.ts — verification-only touch
**File**: `src/types.ts`
**Changes**: No code change. Phase 1 created this file in final form; the D12 ThreadItemRaw retirement is already applied, so this phase's `grep -c "ThreadItemRaw" src/types.ts` returns 0 criterion passes as created.

#### 2. src/extract.ts — NEW
**File**: `src/extract.ts`
**Changes**: Parse rendered HTML → collect data-sjs JSON blobs → walk generically for thread_items arrays → narrow `.post` media objects → map to Post[] → dedupe by pk → build permalinks (code, pk-fallback via codeFromPk). Tolerates missing fields by dropping the item and logging the count.

```ts
/**
 * Extract Threads posts from a rendered page's HTML.
 *
 * Post data lives in <script type="application/json" data-sjs> blobs as
 * Relay-style JSON payloads. Every array found under a "thread_items" key
 * holds items whose `.post` is a Threads media object. The wrapper path
 * changes across deployments, so extraction walks the JSON generically and
 * matches only the leaf key. Field shapes verified against a real
 * /tag/hiring capture (2026-10-24): 19/19 posts, pk-to-code pairs included.
 */
import type { Post } from "./types.js";

/** Matches data-sjs blobs in both raw and DOM-serialized attribute order. */
const SCRIPT_BLOB_RE = /<script[^>]*\bdata-sjs\b[^>]*>([\s\S]*?)<\/script>/g;

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Derive a post shortcode from its numeric pk (Instagram/Threads algorithm,
 * verified against 19 real pk/code pairs from the 2026-10-24 capture).
 */
export function codeFromPk(pk: string): string {
  let id = BigInt(pk);
  let out = "";
  while (id > 0n) {
    out = BASE64URL_ALPHABET.charAt(Number(id % 64n)) + out;
    id /= 64n;
  }
  return out;
}

/**
 * Parse rendered page HTML and return the unique posts in capture order.
 * Malformed items are dropped and counted; unparsable blobs are skipped.
 */
export function extractPosts(html: string): Post[] {
  const rawItems: unknown[] = [];
  const blobRe = new RegExp(SCRIPT_BLOB_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = blobRe.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1] ?? "");
    } catch {
      continue; // not every data-sjs blob is JSON; skip it
    }
    walkForThreadItems(parsed, rawItems);
  }

  const seen = new Set<string>();
  const posts: Post[] = [];
  let dropped = 0;
  for (const item of rawItems) {
    const post = normalize(item);
    if (post === null) {
      dropped += 1;
      continue;
    }
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    posts.push(post);
  }
  if (dropped > 0) {
    console.warn(`extract: dropped ${dropped} malformed thread item(s)`);
  }
  return posts;
}

/** Depth-first walk collecting every array stored under "thread_items". */
function walkForThreadItems(node: unknown, out: unknown[]): void {
  if (Array.isArray(node)) {
    for (const child of node) walkForThreadItems(child, out);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value: unknown = record[key];
    if (key === "thread_items" && Array.isArray(value)) {
      out.push(...value);
    }
    walkForThreadItems(value, out);
  }
}

/** Map one raw thread item to a Post, or null when it lacks required fields. */
function normalize(item: unknown): Post | null {
  const post = readPost(item);
  if (post === null) return null;
  const pk = readPk(post.pk);
  const text = readText(post.caption);
  const author = readUsername(post.user);
  const takenAt = post.taken_at;
  if (
    pk === null ||
    text === null ||
    author === null ||
    typeof takenAt !== "number" ||
    !Number.isFinite(takenAt) ||
    takenAt <= 0
  ) {
    return null;
  }
  const code =
    typeof post.code === "string" && post.code.length > 0
      ? post.code
      : codeFromPk(pk);
  return {
    id: pk,
    text,
    author,
    permalink: `https://www.threads.com/@${author}/post/${code}`,
    timestamp: new Date(takenAt * 1000).toISOString(),
  };
}

/** Real items nest the media object under `.post`; tolerate flat items too. */
function readPost(item: unknown): Record<string, unknown> | null {
  if (item === null || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const post: unknown = record.post;
  return post !== null && typeof post === "object"
    ? (post as Record<string, unknown>)
    : record;
}

function readPk(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? String(value) : null;
  }
  return typeof value === "string" && /^[0-9]+$/.test(value) ? value : null;
}

function readText(caption: unknown): string | null {
  if (caption === null || typeof caption !== "object") return null;
  const text: unknown = (caption as Record<string, unknown>).text;
  return typeof text === "string" && text.trim().length > 0 ? text : null;
}

function readUsername(user: unknown): string | null {
  if (user === null || typeof user !== "object") return null;
  const username: unknown = (user as Record<string, unknown>).username;
  return typeof username === "string" && username.length > 0 ? username : null;
}
```

#### 3. tests/fixture/tag-page.html — NEW
**File**: `tests/fixture/tag-page.html`
**Changes**: Trimmed REAL logged-out tag page (Playwright capture of /tag/hiring, 2026-10-24; trim rule documented in the file's HTML comment), the extract test's input. Six edges: 4 real posts + 1 pk-duplicate (dedupe) + 1 code-stripped (pk→code fallback) + 1 caption-stripped (drop).

```html
<!DOCTYPE html>
<!-- Trimmed REAL capture: threads.com/tag/hiring, logged-out, 2026-10-24.
     Wrapper skeleton compressed to the real searchResults.edges path; heavy
     unrelated keys dropped from post objects; every retained value (pk, code,
     taken_at, username, caption text) is byte-real from the capture.
     Edge 4 = duplicate of edge 1 (dedupe test). Edge 5 has code removed
     (pk-to-code fallback test). Edge 6 has caption removed (drop test). -->
<html><head><title>Threads</title></head><body>
<script type="application/json" data-sjs="">{"require":[{"__bbox":{"require":[[{"__bbox":{"require":[[{"__bbox":{"result":{"data":{"searchResults":{"edges":[{"node":{"thread":{"thread_items":[{"post":{"id":"4012496661532082278_63265411394","pk":"4012496661532082278","code":"DevQHRdD4Bm","taken_at":1792546898,"caption":{"text":"Anyone tengah open for hiring? Please please let me know."},"user":{"pk":"63265411394","username":"hasrashidd","is_verified":false},"text_post_app_info":{},"like_count":84,"media_type":19,"caption_is_edited":false}}]}}},{"node":{"thread":{"thread_items":[{"post":{"id":"4001747734230078501_74566449349","pk":"4001747734230078501","code":"DeJEFyzghQl","taken_at":1791265526,"caption":{"text":"HIRING ‼️\n•Barista\n•Waiter\n\nDM for those interested."},"user":{"pk":"74566449349","username":"mel.grindsdaily","is_verified":false},"text_post_app_info":{},"like_count":38,"media_type":19,"caption_is_edited":false}}]}}},{"node":{"thread":{"thread_items":[{"post":{"id":"3998973357877860537_66917916102","pk":"3998973357877860537","code":"Dd_NRTej5i5","taken_at":1790934794,"caption":{"text":"HIRING!!\n\nCHATTER VA"},"user":{"pk":"66917916102","username":"thisaint_mikka","is_verified":false},"text_post_app_info":{},"like_count":17,"media_type":19,"caption_is_edited":false}}]}}},{"node":{"thread":{"thread_items":[{"post":{"id":"4012496661532082278_63265411394","pk":"4012496661532082278","code":"DevQHRdD4Bm","taken_at":1792546898,"caption":{"text":"Anyone tengah open for hiring? Please please let me know."},"user":{"pk":"63265411394","username":"hasrashidd","is_verified":false},"text_post_app_info":{},"like_count":84,"media_type":19,"caption_is_edited":false}}]}}},{"node":{"thread":{"thread_items":[{"post":{"id":"3993862290835326832_77734858445","pk":"3993862290835326832","taken_at":1790325508,"caption":{"text":"🚨 WE’RE HIRING — SEPT & OCT 2026 INTAKE! 🚨\n\nWe are currently hiring for: \n- Safety, Health and Environmental Officer\n- Site Supervisor \n- Project Engineer (Civil & Electrical)\n- Traffic Management Officer\n\n⚡ Immediate intake!\nInterested? Don’t miss out — hit us up! 📲\n\n📞 014-964 1996\n🕘 Office hours only"},"user":{"pk":"77734858445","username":"meyyah.ah","is_verified":false},"text_post_app_info":{},"like_count":193,"media_type":19,"caption_is_edited":false}}]}}},{"node":{"thread":{"thread_items":[{"post":{"id":"3982574977840405311_78038250787","pk":"3982574977840405311","code":"DdE8td9iVs_","taken_at":1788979955,"user":{"pk":"78038250787","username":"tippersian","is_verified":false},"text_post_app_info":{},"like_count":36,"media_type":19,"caption_is_edited":false}}]}}}]}}}}}]]}}]]}}]}</script>
</body></html>
```

#### 4. tests/extract.test.ts — NEW
**File**: `tests/extract.test.ts`
**Changes**: Fixture → expected Post[] (byte-exact first post, capture order); dedupe; missing-field drop; pk→code fallback asserted against real captured codes; unparsable-blob tolerance; empty-input case; codeFromPk vs 5 real pairs.

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { codeFromPk, extractPosts } from "../src/extract.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixture", "tag-page.html"), "utf8");

describe("extractPosts", () => {
  it("extracts real posts from the captured tag page", () => {
    const posts = extractPosts(fixture);
    assert.equal(posts.length, 4);
    assert.deepEqual(posts[0], {
      id: "4012496661532082278",
      text: "Anyone tengah open for hiring? Please please let me know.",
      author: "hasrashidd",
      permalink: "https://www.threads.com/@hasrashidd/post/DevQHRdD4Bm",
      timestamp: "2026-10-21T01:41:38.000Z",
    });
  });

  it("keeps capture order", () => {
    const posts = extractPosts(fixture);
    assert.deepEqual(
      posts.map((p) => p.id),
      [
        "4012496661532082278",
        "4001747734230078501",
        "3998973357877860537",
        "3993862290835326832",
      ],
    );
  });

  it("dedupes by pk (fixture edge 4 duplicates edge 1)", () => {
    const posts = extractPosts(fixture);
    assert.equal(new Set(posts.map((p) => p.id)).size, posts.length);
  });

  it("derives the shortcode from pk when code is missing (edge 5)", () => {
    // Edge 5 is a real capture post with its code removed; the derived code
    // must equal the real one from the capture.
    const posts = extractPosts(fixture);
    const derived = posts.find((p) => p.id === "3993862290835326832");
    assert.ok(derived);
    assert.equal(
      derived.permalink,
      "https://www.threads.com/@meyyah.ah/post/DdtDJfXEUdw",
    );
  });

  it("drops items without caption text (edge 6)", () => {
    const posts = extractPosts(fixture);
    assert.equal(posts.some((p) => p.id === "3982574977840405311"), false);
  });

  it("tolerates unparsable data-sjs blobs", () => {
    const noisy = fixture.replace(
      "</head>",
      '<script type="application/json" data-sjs="">{"broken": </script></head>',
    );
    assert.deepEqual(extractPosts(noisy), extractPosts(fixture));
  });

  it("returns an empty array for pages without data-sjs blobs", () => {
    assert.deepEqual(extractPosts("<html><body>nothing here</body></html>"), []);
  });
});

describe("codeFromPk", () => {
  it("matches real pk/code pairs from the capture", () => {
    assert.equal(codeFromPk("4012496661532082278"), "DevQHRdD4Bm");
    assert.equal(codeFromPk("4001747734230078501"), "DeJEFyzghQl");
    assert.equal(codeFromPk("3998973357877860537"), "Dd_NRTej5i5");
    assert.equal(codeFromPk("3993862290835326832"), "DdtDJfXEUdw");
    assert.equal(codeFromPk("3982574977840405311"), "DdE8td9iVs_");
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` exits 0
- [x] Extraction suite passes: `npx tsx --test tests/extract.test.ts` exits 0 (8 tests)
- [x] Fixture carries real capture data: `grep -c "DevQHRdD4Bm" tests/fixture/tag-page.html` returns 1
- [x] ThreadItemRaw retired: `grep -c "ThreadItemRaw" src/types.ts` returns 0
- [x] Secret hygiene: `grep -rniE "password|api_key" src tests` matches only env-var NAME constants, never values

#### Manual Verification:
- [x] Fixture comment documents the trim rule; every retained value traces to the 2026-10-24 logged-out /tag/hiring capture
- [x] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

---

## Phase 3: Fetch (Playwright)

### Overview

Playwright fetch of the configurable tag pages: one Chromium with minimal hardening (D2), a hydration gate that waits until a data-sjs blob carries `thread_items`, per-surface retry ×3 with linear backoff, single-surface failure tolerance, and an all-fail throw. Phase 8 adds the authenticated fetch path (`fetchTagPostsAuthenticated`); this phase's logged-out path (`fetchTagPages`) remains as the no-session fallback and is unchanged.

### Changes Required:

#### 1. src/fetch-threads.ts — NEW
**File**: `src/fetch-threads.ts`
**Changes**: Launch one Chromium (webdriver patch + realistic UA/viewport/locale), fetch each tag page, wait until a data-sjs blob carries hydrated thread_items (string-expression probe — no DOM lib under the locked tsconfig), return per-surface HTML; retry ×3 with linear backoff per surface; tolerate single-surface failure; throw when all fail.

```ts
/**
 * Fetch rendered HTML for Threads tag pages with Playwright.
 *
 * Tag pages hydrate post data into <script type="application/json"
 * data-sjs> blobs; extraction (src/extract.ts) parses those blobs from the
 * HTML, so this module only has to deliver hydrated page HTML per surface.
 * Hydration gate: wait until some data-sjs blob actually contains
 * "thread_items" (raw page HTML has NO post data — probes confirmed).
 *
 * Hardening is minimal (D2): patch navigator.webdriver and set a realistic
 * UA/viewport/locale. Vanilla headless Chromium worked on threads.com in
 * the 2026-10-24 logged-out probes; if GitHub Actions runner IPs get
 * blocked, hardening escalates here (see Verification Notes smoke gate).
 *
 * Surface policy (D11): every tag is attempted with retries; a failed
 * surface is tolerated while at least one succeeds; all-fail throws.
 */
import { chromium, type BrowserContext } from "playwright";
import { tagPageUrl } from "./config.js";

const NAV_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Browser-side hydration probe for waitForFunction, kept as a string so the
 * Node build needs no DOM lib (locked tsconfig: lib ES2023, types node).
 * True once a data-sjs blob carries hydrated post data.
 */
const HAS_THREAD_ITEMS = `() =>
  Array.from(
    document.querySelectorAll('script[type="application/json"][data-sjs]'),
  ).some((el) => (el.textContent || '').includes('thread_items'))`;

/** Rendered HTML for one tag surface, ready for extractPosts(). */
export interface SurfaceFetch {
  tag: string;
  html: string;
}

/**
 * Fetch every tag page and return the successes in input order.
 * Throws when every surface fails (message lists per-surface errors).
 */
export async function fetchTagPages(
  tags: readonly string[],
): Promise<SurfaceFetch[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
    });
    await context.addInitScript(
      "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
    );

    const results: SurfaceFetch[] = [];
    const failures: string[] = [];
    for (const tag of tags) {
      try {
        results.push({ tag, html: await fetchOne(context, tag) });
        console.log(`fetch: /tag/${tag} OK`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`/tag/${tag}: ${message}`);
        console.warn(`fetch: /tag/${tag} FAILED — ${message}`);
      }
    }

    if (results.length === 0) {
      throw new Error(
        `fetch: all ${tags.length} surface(s) failed:\n${failures.join("\n")}`,
      );
    }
    return results;
  } finally {
    await browser.close();
  }
}

/** Fetch one tag page: up to MAX_ATTEMPTS tries with linear backoff. */
async function fetchOne(
  context: BrowserContext,
  tag: string,
): Promise<string> {
  const url = tagPageUrl(tag);
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const page = await context.newPage();
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForFunction(HAS_THREAD_ITEMS, undefined, {
        timeout: NAV_TIMEOUT_MS,
        polling: 500,
      });
      return await page.content();
    } catch (error) {
      lastError = error;
      console.warn(
        `fetch: /tag/${tag} attempt ${attempt}/${MAX_ATTEMPTS} failed`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    } finally {
      await page.close();
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

#### 2. src/config.ts — verification-only touch
**File**: `src/config.ts`
**Changes**: No code change. Phase 1 created this file in final form with the D11 surface revision already applied (THREADS_TAGS configurable; SEARCH_SURFACES/SEARCH_QUERY absent), so this phase's surface criteria pass as created. **Superseded by Phase 10**, which deletes `THREADS_TAGS`, `DEFAULT_TAGS`, `resolveTags` and `tagPageUrl` from this file and moves the surface list into `watcher.config.json`.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` exits 0
- [x] Extract regression: `npx tsx --test tests/extract.test.ts` exits 0 (config.ts change breaks no locked consumer)
- [x] Old search surfaces retired: `grep -c "SEARCH_SURFACES\|SEARCH_QUERY" src/config.ts` returns 0
- [ ] THREADS_TAGS retired (relocated by Phase 10): `grep -c "THREADS_TAGS" src/config.ts` returns 0 — the surface list moved to `watcher.config.json`
- [x] No stealth plugin (D2): `grep -ci "stealth" src/fetch-threads.ts` returns 0
- [x] Secret hygiene: `grep -rniE "password|api_key" src tests` matches only env-var NAME constants (LLM_API_KEY, GMAIL_APP_PASSWORD), never values

#### Manual Verification:
- [ ] After `npx playwright install chromium`, a scratch script calling `fetchSurfaces([{ type: "tag", value: "hiring" }])` returns HTML containing data-sjs with thread_items for the surface (post data hydrated, not just blob presence) — renamed from `fetchTagPages` by Phase 10
- [ ] A scratch run with a surface list of `hiring` plus a nonexistent tag still succeeds (single-failure tolerance, D11) and logs the failed surface — configured in `watcher.config.json`, not through a `THREADS_TAGS` env var (relocated by Phase 10)
- [x] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

---

## Phase 4: Filters (keywords + LLM judge)

### Overview

The two-stage filter: a case-insensitive keyword pre-filter, then one OpenAI-compatible LLM call per maybe-post returning strict JSON `{relevant, locationOk}` with one retry before skipping.

### Changes Required:

#### 1. src/keywords.ts — NEW
**File**: `src/keywords.ts`
**Changes**: Case-insensitive keyword pre-filter (FRD #3) matching post text against KEYWORDS from src/config.ts. Exports matchesKeywords and filterPostsByKeywords.

```ts
/**
 * Keyword pre-filter for Threads posts (FRD #3).
 *
 * Checks post captions against a curated list of frontend and fullstack
 * keywords. Normalizes text and keywords to lowercase for case-insensitive
 * matching. Substring matching allows catching variants like "ReactJS" or
 * punctuated forms like "React/Vue".
 */
import { KEYWORDS } from "./config.js";
import type { Post } from "./types.js";

/**
 * Returns true if text contains at least one keyword from the list.
 * Performs case-insensitive substring matching.
 */
export function matchesKeywords(
  text: string,
  keywords: readonly string[] = KEYWORDS,
): boolean {
  if (text.length === 0 || keywords.length === 0) {
    return false;
  }
  const normalizedText = text.toLowerCase();
  for (const keyword of keywords) {
    const trimmed = keyword.trim().toLowerCase();
    if (trimmed.length > 0 && normalizedText.includes(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Filters a list of posts, retaining only those matching the keywords.
 */
export function filterPostsByKeywords(
  posts: readonly Post[],
  keywords: readonly string[] = KEYWORDS,
): Post[] {
  return posts.filter((post) => matchesKeywords(post.text, keywords));
}
```

#### 2. src/judge.ts — NEW
**File**: `src/judge.ts`
**Changes**: OpenAI-compatible LLM judge (FRD #4, #5, D3) calling /chat/completions via native fetch. Evaluates candidate posts for relevance and Indonesia/remote location with strict JSON output. Retries once on failure; skips unrecoverable posts with visible logging.

```ts
/**
 * LLM relevance and location judge for candidate Threads posts (FRD #4, #5, D3).
 *
 * Uses an OpenAI-compatible chat completions endpoint (global fetch, no SDK
 * dependency). Calls the endpoint once per candidate post with strict JSON output:
 * {"relevant": boolean, "locationOk": boolean}.
 *
 * Retries once on HTTP failure or JSON parse error. If both attempts fail, the
 * post is skipped for this run, logged visibly, and omitted from state (D3).
 */
import { ENV_NAMES } from "./config.js";
import type { JudgeVerdict, Post } from "./types.js";

const REQUEST_TIMEOUT_MS = 15_000;

export interface JudgeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface JudgedPost {
  post: Post;
  verdict: JudgeVerdict;
}

export interface JudgeBatchResult {
  judged: JudgedPost[];
  skippedPostIds: string[];
}

/**
 * Resolve LLM configuration from the environment dictionary.
 * Throws when any mandatory variable is missing or blank.
 */
export function resolveJudgeConfig(
  env: Record<string, string | undefined> = process.env,
): JudgeConfig {
  const baseUrl = env[ENV_NAMES.llmBaseUrl]?.trim();
  const apiKey = env[ENV_NAMES.llmApiKey]?.trim();
  const model = env[ENV_NAMES.llmModel]?.trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push(ENV_NAMES.llmBaseUrl);
  if (!apiKey) missing.push(ENV_NAMES.llmApiKey);
  if (!model) missing.push(ENV_NAMES.llmModel);

  if (missing.length > 0) {
    throw new Error(
      `judge: missing required environment variables: ${missing.join(", ")}`,
    );
  }

  return {
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model: model!,
  };
}

/**
 * Extract and validate a JudgeVerdict from raw LLM response text.
 * Tolerates surrounding markdown code fences and whitespace.
 */
export function parseVerdict(content: string): JudgeVerdict | null {
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const jsonStr = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed["relevant"] === "boolean" &&
      typeof parsed["locationOk"] === "boolean"
    ) {
      return {
        relevant: parsed["relevant"],
        locationOk: parsed["locationOk"],
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the chat completion messages for a given post.
 */
function buildMessages(post: Post): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content:
        "You are an automated evaluation filter for developer job alerts. " +
        "You determine if a social media post is a genuine job opening for frontend or fullstack web development, " +
        "and whether the position is in Indonesia or remote.",
    },
    {
      role: "user",
      content:
        `Analyze the following Threads post by @${post.author}:\n\n` +
        `\"${post.text}\"\n\n` +
        "Determine two criteria:\n" +
        "1. relevant: true ONLY if the post is a hiring announcement or job opening for frontend, " +
        "fullstack, or closely adjacent web developer roles (e.g. React, Vue, Next.js, TypeScript, Node.js web development). " +
        "Set false if it is a job seeker seeking work, an internship inquiry, training promotion, or non-web engineering role.\n" +
        "2. locationOk: true ONLY if the job is located in Indonesia (e.g. Jakarta, Bali, Surabaya, hybrid in ID), " +
        "or explicitly remote / work from anywhere. Set false if the role is on-site or hybrid in another country with no remote option.\n\n" +
        "Respond with ONLY a raw JSON object matching this schema:\n" +
        '{"relevant": boolean, "locationOk": boolean}',
    },
  ];
}

/**
 * Judge a single post with up to 1 retry on HTTP or parsing failure.
 * Returns the verdict on success, or null if both attempts fail.
 */
export async function judgePost(
  post: Post,
  config: JudgeConfig,
  fetchFn: typeof fetch = fetch,
): Promise<JudgeVerdict | null> {
  const endpoint = config.baseUrl.endsWith("/chat/completions")
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const payload = {
    model: config.model,
    messages: buildMessages(post),
    temperature: 0,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        console.warn(
          `judge: post ${post.id} attempt ${attempt}/2 HTTP ${response.status} ${response.statusText}`,
        );
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const rawContent = data.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string") {
        console.warn(
          `judge: post ${post.id} attempt ${attempt}/2 missing message content`,
        );
        continue;
      }

      const verdict = parseVerdict(rawContent);
      if (verdict !== null) {
        return verdict;
      }

      console.warn(
        `judge: post ${post.id} attempt ${attempt}/2 failed to parse JSON verdict: ${rawContent.slice(0, 100)}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `judge: post ${post.id} attempt ${attempt}/2 request error: ${msg}`,
      );
    }
  }

  return null;
}

/**
 * Sequentially evaluate candidate posts.
 * Collects successful verdicts and tracks skipped IDs (D3).
 */
export async function judgePosts(
  candidates: readonly Post[],
  config: JudgeConfig,
  fetchFn: typeof fetch = fetch,
): Promise<JudgeBatchResult> {
  const judged: JudgedPost[] = [];
  const skippedPostIds: string[] = [];

  for (const post of candidates) {
    const verdict = await judgePost(post, config, fetchFn);
    if (verdict !== null) {
      judged.push({ post, verdict });
    } else {
      skippedPostIds.push(post.id);
      console.warn(`judge: skipped post ${post.id} after retry failed`);
    }
  }

  return { judged, skippedPostIds };
}
```

#### 3. tests/keywords.test.ts — NEW
**File**: `tests/keywords.test.ts`
**Changes**: Test suite covering keyword matching, case-insensitivity, compound word matching, non-tech rejection, custom keyword list, Post array filtering, LLM verdict parsing, config resolution, and judgePost retry logic with mock fetch.

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterPostsByKeywords, matchesKeywords } from "../src/keywords.js";
import {
  judgePost,
  judgePosts,
  parseVerdict,
  resolveJudgeConfig,
  type JudgeConfig,
} from "../src/judge.js";
import type { Post } from "../src/types.js";

describe("matchesKeywords", () => {
  it("matches common frontend and fullstack keywords", () => {
    assert.equal(matchesKeywords("We are hiring a Frontend Developer!"), true);
    assert.equal(matchesKeywords("Looking for a full-stack engineer"), true);
    assert.equal(matchesKeywords("Full Stack Developer needed immediately"), true);
    assert.equal(matchesKeywords("Senior React dev wanted"), true);
    assert.equal(matchesKeywords("Vue and Nuxt specialist needed"), true);
    assert.equal(matchesKeywords("Next.js project open for contract"), true);
    assert.equal(matchesKeywords("TypeScript / Node.js backend/frontend"), true);
  });

  it("performs case-insensitive matching", () => {
    assert.equal(matchesKeywords("HIRING REACT DEVELOPER"), true);
    assert.equal(matchesKeywords("vue.js programmer"), true);
    assert.equal(matchesKeywords("Typescript Enthusiast"), true);
    assert.equal(matchesKeywords("FRONT-END LEAD"), true);
  });

  it("matches keywords embedded with punctuation or slashes", () => {
    assert.equal(matchesKeywords("Stack: React/Vue/Svelte"), true);
    assert.equal(matchesKeywords("#frontend #reactjs"), true);
    assert.equal(matchesKeywords("Web Dev (remote)"), true);
  });

  it("handles compound variants such as reactjs and nodejs", () => {
    assert.equal(matchesKeywords("Looking for ReactJS engineer"), true);
    assert.equal(matchesKeywords("Backend in NodeJS"), true);
    assert.equal(matchesKeywords("NextJS fullstack"), true);
  });

  it("rejects non-tech and non-matching job posts", () => {
    assert.equal(matchesKeywords("HIRING ‼️ Barista Waiter"), false);
    assert.equal(matchesKeywords("HIRING!! CHATTER VA"), false);
    assert.equal(matchesKeywords("Safety, Health and Environmental Officer Site Supervisor"), false);
    assert.equal(matchesKeywords("Marketing manager needed in Bali"), false);
    assert.equal(matchesKeywords("Graphic designer for clothing brand"), false);
  });

  it("returns false for empty text or empty keywords", () => {
    assert.equal(matchesKeywords(""), false);
    assert.equal(matchesKeywords("React developer", []), false);
  });

  it("supports a custom keyword list", () => {
    assert.equal(matchesKeywords("Python Django dev", ["python", "django"]), true);
    assert.equal(matchesKeywords("React dev", ["python", "django"]), false);
  });
});

describe("filterPostsByKeywords", () => {
  it("filters a list of posts down to matching ones", () => {
    const posts: Post[] = [
      {
        id: "1",
        text: "Hiring React developer in Jakarta",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        id: "2",
        text: "Hiring Barista in Bandung",
        author: "cafeindonesia",
        permalink: "https://www.threads.com/@cafeindonesia/post/2",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
      {
        id: "3",
        text: "Looking for Vue.js & TypeScript engineer (remote)",
        author: "startup",
        permalink: "https://www.threads.com/@startup/post/3",
        timestamp: "2026-10-24T02:00:00.000Z",
      },
    ];

    const filtered = filterPostsByKeywords(posts);
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0]?.id, "1");
    assert.equal(filtered[1]?.id, "3");
  });
});

describe("parseVerdict", () => {
  it("parses clean JSON objects", () => {
    const verdict = parseVerdict('{"relevant": true, "locationOk": false}');
    assert.deepEqual(verdict, { relevant: true, locationOk: false });
  });

  it("parses markdown code fenced JSON", () => {
    const raw = "```json\n{\"relevant\": true, \"locationOk\": true}\n```";
    assert.deepEqual(parseVerdict(raw), { relevant: true, locationOk: true });
  });

  it("parses JSON with surrounding conversational text", () => {
    const raw = "Here is the verdict: {\"relevant\": false, \"locationOk\": false}. Let me know!";
    assert.deepEqual(parseVerdict(raw), { relevant: false, locationOk: false });
  });

  it("returns null for malformed or non-boolean JSON", () => {
    assert.equal(parseVerdict("not json"), null);
    assert.equal(parseVerdict('{"relevant": "yes", "locationOk": true}'), null);
    assert.equal(parseVerdict('{"relevant": true}'), null);
    assert.equal(parseVerdict(""), null);
  });
});

describe("resolveJudgeConfig", () => {
  it("extracts config from valid env", () => {
    const env = {
      LLM_BASE_URL: "https://api.openai.com/v1",
      LLM_API_KEY: "secret-key",
      LLM_MODEL: "gpt-4o-mini",
    };
    const config = resolveJudgeConfig(env);
    assert.deepEqual(config, {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret-key",
      model: "gpt-4o-mini",
    });
  });

  it("throws when required env variables are missing", () => {
    assert.throws(
      () => resolveJudgeConfig({}),
      /missing required environment variables/,
    );
  });
});

describe("judgePost", () => {
  const samplePost: Post = {
    id: "100",
    text: "Hiring React developer in Jakarta",
    author: "techco",
    permalink: "https://www.threads.com/@techco/post/100",
    timestamp: "2026-10-24T00:00:00.000Z",
  };

  const sampleConfig: JudgeConfig = {
    baseUrl: "https://mock.api/v1",
    apiKey: "test-key",
    model: "test-model",
  };

  it("returns parsed verdict on successful API response", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"relevant": true, "locationOk": true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const verdict = await judgePost(samplePost, sampleConfig, mockFetch as unknown as typeof fetch);
    assert.deepEqual(verdict, { relevant: true, locationOk: true });
  });

  it("retries on first failure and succeeds on second attempt", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response("Bad Gateway", { status: 502 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"relevant": false, "locationOk": true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const verdict = await judgePost(samplePost, sampleConfig, mockFetch as unknown as typeof fetch);
    assert.equal(callCount, 2);
    assert.deepEqual(verdict, { relevant: false, locationOk: true });
  });

  it("returns null after two failed attempts", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount += 1;
      return new Response("Server Error", { status: 500 });
    };

    const verdict = await judgePost(samplePost, sampleConfig, mockFetch as unknown as typeof fetch);
    assert.equal(callCount, 2);
    assert.equal(verdict, null);
  });
});

describe("judgePosts", () => {
  it("batches posts and records skipped IDs on failure", async () => {
    const posts: Post[] = [
      {
        id: "101",
        text: "Hiring Next.js dev",
        author: "nextco",
        permalink: "https://www.threads.com/@nextco/post/101",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        id: "102",
        text: "Failing post",
        author: "badco",
        permalink: "https://www.threads.com/@badco/post/102",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
    ];

    const mockFetch = async (_url: unknown, options: unknown) => {
      const opts = options as { body: string };
      if (opts.body.includes("Failing post")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"relevant": true, "locationOk": true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await judgePosts(
      posts,
      { baseUrl: "https://mock.api/v1", apiKey: "k", model: "m" },
      mockFetch as unknown as typeof fetch,
    );

    assert.equal(result.judged.length, 1);
    assert.equal(result.judged[0]?.post.id, "101");
    assert.deepEqual(result.skippedPostIds, ["102"]);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` exits 0
- [x] Filter test suite passes: `npx tsx --test tests/keywords.test.ts` exits 0 (18 tests)
- [x] Extract regression: `npx tsx --test tests/extract.test.ts` exits 0 (filter modules break no locked extraction consumer)
- [x] Secret hygiene: `grep -rniE "password|api_key" src tests` matches only env-var NAME constants (LLM_API_KEY, GMAIL_APP_PASSWORD) and test fixture strings ("test-key"), never secrets
- [ ] Config exports preserved (relocated by Phase 10): `grep -c "frontend" watcher.config.json` returns 1 or more — the keyword list moved out of `src/config.ts` into the JSON source of truth

#### Manual Verification:
- [x] Verify `matchesKeywords` correctly rejects the non-tech hiring posts in `tests/fixture/tag-page.html` (Barista, VA, Safety Officer)
- [x] Verify `judgePosts` handles mock LLM responses with code fences, whitespace, and malformed JSON with 1 retry before skipping
- [x] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

---

## Phase 5: State

### Overview

State persistence: load, diff, and match-gated atomic write of `state/seen-posts.json` (FRD #6, #8, #9, D8). A failure before the write leaves the file byte-identical.

### Changes Required:

#### 1. src/state.ts — NEW
**File**: `src/state.ts`
**Changes**: Persistence state management (FRD #6, #8, #9, D8). Handles load, diff, atomic temp+rename save, and match-gating so disk writes only occur when ≥1 new post matches. Carries version: 1 with migration validation.

```ts
/**
 * Persistence state management (FRD #6, #8, #9, D8).
 *
 * Persists seen Threads post IDs in state/seen-posts.json to deduplicate
 * future runs. Guarantees atomic writes via sibling temp-file + rename.
 * Gated by match count: disk write is strictly skipped when 0 new matches
 * occur, keeping the state file byte-identical on no-match runs (FRD #9, D8).
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_PATH } from "./config.js";
import type { Post } from "./types.js";

/**
 * Persistence state schema for loker-watcher (FRD #6, D8).
 * Carries version: 1 for forward schema migrations.
 */
export interface AppState {
  version: number;
  seenPostIds: string[];
}

/** Result of a saveState operation indicating if disk was modified. */
export interface SaveStateResult {
  saved: boolean;
  state: AppState;
  addedCount: number;
}

export const CURRENT_STATE_VERSION = 1;

/** Return a fresh empty initial state object. */
export function createInitialState(): AppState {
  return {
    version: CURRENT_STATE_VERSION,
    seenPostIds: [],
  };
}

/**
 * Validate and migrate raw parsed JSON to the current AppState schema.
 * Throws when data is corrupted or cannot be safely migrated.
 */
export function migrateState(raw: unknown): AppState {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("state: invalid state format, expected an object");
  }

  const record = raw as Record<string, unknown>;
  const version = record["version"];

  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new Error(
      `state: invalid or missing schema version: ${String(version)}`,
    );
  }

  if (version === 1) {
    const rawIds = record["seenPostIds"];
    if (!Array.isArray(rawIds)) {
      throw new Error("state: seenPostIds must be an array");
    }

    const seenPostIds: string[] = [];
    for (const item of rawIds) {
      if (typeof item === "string" && item.length > 0) {
        seenPostIds.push(item);
      } else if (typeof item === "number" && Number.isSafeInteger(item)) {
        seenPostIds.push(String(item));
      } else {
        throw new Error(
          `state: invalid post ID in seenPostIds: ${String(item)}`,
        );
      }
    }

    return {
      version: 1,
      seenPostIds,
    };
  }

  throw new Error(`state: unsupported schema version: ${version}`);
}

/**
 * Load the state file from disk.
 * Returns initial empty state when the file does not exist (ENOENT).
 * Throws when the file cannot be read or contains invalid JSON/schema.
 */
export async function loadState(
  filePath: string = STATE_PATH,
): Promise<AppState> {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    return migrateState(parsed);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return createInitialState();
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `state: failed to load state from ${filePath}: ${message}`,
    );
  }
}

/**
 * Filter posts, returning only those not yet present in state.seenPostIds.
 * Maintains input order.
 */
export function diffNew(state: AppState, posts: readonly Post[]): Post[] {
  if (posts.length === 0) return [];
  const seenSet = new Set(state.seenPostIds);
  return posts.filter((post) => !seenSet.has(post.id));
}

/**
 * Filter an array of post IDs, returning only those not yet in state.seenPostIds.
 * Maintains input order and dedupes new IDs.
 */
export function diffNewIds(
  state: AppState,
  ids: readonly string[],
): string[] {
  if (ids.length === 0) return [];
  const seenSet = new Set(state.seenPostIds);
  const result: string[] = [];
  const added = new Set<string>();
  for (const id of ids) {
    if (!seenSet.has(id) && !added.has(id)) {
      result.push(id);
      added.add(id);
    }
  }
  return result;
}

/**
 * Write state to disk atomically using a sibling temporary file and rename.
 * Guarantees that a crash or error during write leaves the target file
 * byte-identical (FRD #9, D8).
 */
export async function writeStateAtomic(
  state: AppState,
  filePath: string = STATE_PATH,
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempPath = join(
    dir,
    `.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  const jsonContent = JSON.stringify(state, null, 2) + "\n";

  try {
    await writeFile(tempPath, jsonContent, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup of temp file
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `state: atomic write failed for ${filePath}: ${message}`,
    );
  }
}

/**
 * Save new post IDs to the state file (FRD #6, #9, D8).
 *
 * GATED: Only writes to disk when newIds contains at least 1 new unseen ID.
 * If newIds is empty or all IDs are already seen, NO disk write occurs.
 * Returns SaveStateResult indicating whether a write took place and the updated state.
 */
export async function saveState(
  currentState: AppState,
  newIds: readonly string[],
  filePath: string = STATE_PATH,
): Promise<SaveStateResult> {
  const freshIds = diffNewIds(currentState, newIds);

  if (freshIds.length === 0) {
    return {
      saved: false,
      state: currentState,
      addedCount: 0,
    };
  }

  const nextState: AppState = {
    version: currentState.version,
    seenPostIds: [...currentState.seenPostIds, ...freshIds],
  };

  await writeStateAtomic(nextState, filePath);

  return {
    saved: true,
    state: nextState,
    addedCount: freshIds.length,
  };
}
```

#### 2. state/seen-posts.json — NEW
**File**: `state/seen-posts.json`
**Changes**: Seed state file initialized with schema version 1 and an empty seenPostIds array.

```json
{
  "version": 1,
  "seenPostIds": []
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` exits 0
- [x] Regression tests pass: `npx tsx --test tests/extract.test.ts tests/keywords.test.ts` exits 0 (state additions break no locked consumers)
- [x] Seed state exists and validates: `node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const s = JSON.parse(fs.readFileSync("state/seen-posts.json", "utf8")); assert.equal(s.version, 1); assert.deepEqual(s.seenPostIds, []);'` exits 0
- [x] Atomic save-gating verified: `npx tsx --input-type=module -e 'import assert from "node:assert/strict"; import { saveState, createInitialState } from "./src/state.js"; const s = createInitialState(); const res = await saveState(s, []); assert.equal(res.saved, false); assert.equal(res.addedCount, 0); assert.deepEqual(res.state.seenPostIds, []);'` exits 0
- [x] Atomic write and diff verified: `npx tsx --input-type=module -e 'import assert from "node:assert/strict"; import { createInitialState, diffNew, diffNewIds, saveState } from "./src/state.js"; const s = createInitialState(); const posts = [{ id: "1", text: "t", author: "a", permalink: "p", timestamp: "ts" }]; assert.equal(diffNew(s, posts).length, 1); assert.deepEqual(diffNewIds(s, ["1", "2"]), ["1", "2"]);'` exits 0
- [x] Secret hygiene: `grep -rniE "password|api_key" src state` matches only env-var NAME constants (LLM_API_KEY, GMAIL_APP_PASSWORD), never values

#### Manual Verification:
- [x] Verify `state/seen-posts.json` is formatted with 2-space indentation and newline, carrying version: 1
- [x] Verify `saveState` never touches disk when 0 new posts match (FRD #9, D8)
- [x] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

---

## Phase 6: Email digest

### Overview

Email digest: plain-text Gmail digest via nodemailer with zero-match no-send (FRD #7, #8).

### Changes Required:

#### 1. src/email.ts — NEW
**File**: `src/email.ts`
**Changes**: buildDigest(posts): string — plain text, one block per post (text, author, permalink). sendDigest via nodemailer Gmail SMTP (env credentials). Caller skips send on zero matches.

```ts
/**
 * Gmail plain-text digest notification sender (FRD #7, #8).
 *
 * Formats new relevant Threads job posts into a clean plain-text email digest
 * and dispatches it via Gmail SMTP using nodemailer.
 * Gated by post count: sends no email when candidate matches are zero (FRD #8).
 */
import nodemailer, { type Transporter } from "nodemailer";
import { ENV_NAMES } from "./config.js";
import type { Post } from "./types.js";

export interface EmailConfig {
  user: string;
  pass: string;
  to?: string;
}

export interface SendDigestResult {
  sent: boolean;
  messageId?: string;
  recipient?: string;
  postCount: number;
}

/**
 * Resolve email credentials from an environment record.
 * Throws when mandatory credentials are missing or empty.
 */
export function resolveEmailConfig(
  env: Record<string, string | undefined> = process.env,
): EmailConfig {
  const user = env[ENV_NAMES.gmailUser]?.trim();
  const pass = env[ENV_NAMES.gmailAppPassword]?.trim();

  const missing: string[] = [];
  if (!user) missing.push(ENV_NAMES.gmailUser);
  if (!pass) missing.push(ENV_NAMES.gmailAppPassword);

  if (missing.length > 0) {
    throw new Error(
      `email: missing required environment variables: ${missing.join(", ")}`,
    );
  }

  return {
    user: user!,
    pass: pass!,
    to: user!,
  };
}

/**
 * Build the digest email subject line.
 * Returns null when posts array is empty.
 */
export function buildSubject(posts: readonly Post[]): string | null {
  if (posts.length === 0) return null;
  const count = posts.length;
  const plural = count === 1 ? "" : "s";
  return `${count} new job post${plural} on Threads (#hiring indonesia)`;
}

/**
 * Build plain-text digest body (FRD #7, UX non-functional requirement).
 * Returns null when posts array is empty.
 */
export function buildDigest(posts: readonly Post[]): string | null {
  const subject = buildSubject(posts);
  if (subject === null) return null;

  const items = posts.map((post, index) => {
    const author = post.author.replace(/^@+/, "");
    return `${index + 1}. ${post.text}\n   — @${author}\n   ${post.permalink}`;
  });

  return `${subject}\n\n${items.join("\n\n")}\n`;
}

/**
 * Send a digest email for new matched posts via nodemailer (FRD #7, #8).
 *
 * Gated: returns { sent: false, postCount: 0 } immediately when posts is empty.
 * Accepts an optional custom Transporter instance for unit testing.
 * Throws when nodemailer fails to deliver, ensuring fail-visible execution.
 */
export async function sendDigest(
  posts: readonly Post[],
  config: EmailConfig,
  transport?: Transporter,
): Promise<SendDigestResult> {
  if (posts.length === 0) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const subject = buildSubject(posts);
  const text = buildDigest(posts);
  if (subject === null || text === null) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const recipient = config.to ?? config.user;
  const mailer =
    transport ??
    nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

  try {
    const info = await mailer.sendMail({
      from: `Loker Watcher <${config.user}>`,
      to: recipient,
      subject,
      text,
    });

    console.log(
      `email: sent digest with ${posts.length} post(s) to ${recipient}`,
    );

    return {
      sent: true,
      messageId: typeof info?.messageId === "string" ? info.messageId : undefined,
      recipient,
      postCount: posts.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`email: failed to send digest: ${message}`);
  }
}
```

#### 2. tests/email.test.ts — NEW
**File**: `tests/email.test.ts`
**Changes**: Digest format (plain text, one link per post); zero-match produces null/empty digest so caller sends nothing. 15 tests across buildSubject, buildDigest, resolveEmailConfig, sendDigest (mock transporter).

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDigest,
  buildSubject,
  resolveEmailConfig,
  sendDigest,
  type EmailConfig,
} from "../src/email.js";
import type { Post } from "../src/types.js";
import type { Transporter } from "nodemailer";

describe("buildSubject", () => {
  it("returns null for empty post array", () => {
    assert.equal(buildSubject([]), null);
  });

  it("formats subject for a single post without plural s", () => {
    const posts: Post[] = [
      {
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
    ];
    assert.equal(
      buildSubject(posts),
      "1 new job post on Threads (#hiring indonesia)",
    );
  });

  it("formats subject for multiple posts with plural s", () => {
    const posts: Post[] = [
      {
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        id: "2",
        text: "Looking for Vue dev",
        author: "startup",
        permalink: "https://www.threads.com/@startup/post/2",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
      {
        id: "3",
        text: "Senior Frontend Lead",
        author: "agency",
        permalink: "https://www.threads.com/@agency/post/3",
        timestamp: "2026-10-24T02:00:00.000Z",
      },
    ];
    assert.equal(
      buildSubject(posts),
      "3 new job posts on Threads (#hiring indonesia)",
    );
  });
});

describe("buildDigest", () => {
  it("returns null for empty post list", () => {
    assert.equal(buildDigest([]), null);
  });

  it("formats single post digest with author and permalink", () => {
    const posts: Post[] = [
      {
        id: "101",
        text: "Looking for a Next.js frontend dev in Jakarta, hybrid...",
        author: "pttechcareers",
        permalink: "https://www.threads.com/@pttechcareers/post/C8H5FiCtESk",
        timestamp: "2026-10-24T08:15:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith("1 new job post on Threads (#hiring indonesia)\n\n"));
    assert.ok(digest.includes("1. Looking for a Next.js frontend dev in Jakarta, hybrid..."));
    assert.ok(digest.includes("   — @pttechcareers"));
    assert.ok(digest.includes("   https://www.threads.com/@pttechcareers/post/C8H5FiCtESk"));
  });

  it("formats multi-post digest with sequential numbers and double spacing", () => {
    const posts: Post[] = [
      {
        id: "101",
        text: "First job post",
        author: "companyA",
        permalink: "https://www.threads.com/@companyA/post/P1",
        timestamp: "2026-10-24T08:00:00.000Z",
      },
      {
        id: "102",
        text: "Second job post",
        author: "@companyB",
        permalink: "https://www.threads.com/@companyB/post/P2",
        timestamp: "2026-10-24T09:00:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith("2 new job posts on Threads (#hiring indonesia)\n\n"));
    assert.ok(digest.includes("1. First job post\n   — @companyA\n   https://www.threads.com/@companyA/post/P1"));
    assert.ok(digest.includes("2. Second job post\n   — @companyB\n   https://www.threads.com/@companyB/post/P2"));
  });

  it("preserves multi-line captions without breaking post structure", () => {
    const posts: Post[] = [
      {
        id: "103",
        text: "HIRING NOW!\n- React\n- TypeScript\nApply via DM",
        author: "recruiter",
        permalink: "https://www.threads.com/@recruiter/post/P3",
        timestamp: "2026-10-24T10:00:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.includes("1. HIRING NOW!\n- React\n- TypeScript\nApply via DM\n   — @recruiter"));
  });
});

describe("resolveEmailConfig", () => {
  it("resolves valid credentials and trims whitespace", () => {
    const env = {
      GMAIL_USER: "  user@gmail.com  ",
      GMAIL_APP_PASSWORD: "  abcd efgh ijkl mnop  ",
    };
    const config = resolveEmailConfig(env);
    assert.deepEqual(config, {
      user: "user@gmail.com",
      pass: "abcd efgh ijkl mnop",
      to: "user@gmail.com",
    });
  });

  it("throws when GMAIL_USER is missing", () => {
    const env = {
      GMAIL_APP_PASSWORD: "pass",
    };
    assert.throws(
      () => resolveEmailConfig(env),
      /email: missing required environment variables: GMAIL_USER/,
    );
  });

  it("throws when GMAIL_APP_PASSWORD is missing", () => {
    const env = {
      GMAIL_USER: "user@gmail.com",
    };
    assert.throws(
      () => resolveEmailConfig(env),
      /email: missing required environment variables: GMAIL_APP_PASSWORD/,
    );
  });

  it("throws when both credentials are missing", () => {
    assert.throws(
      () => resolveEmailConfig({}),
      /email: missing required environment variables: GMAIL_USER, GMAIL_APP_PASSWORD/,
    );
  });
});

describe("sendDigest", () => {
  const sampleConfig: EmailConfig = {
    user: "alerts@gmail.com",
    pass: "app-password",
    to: "alerts@gmail.com",
  };

  const samplePosts: Post[] = [
    {
      id: "201",
      text: "Hiring React dev",
      author: "devteam",
      permalink: "https://www.threads.com/@devteam/post/201",
      timestamp: "2026-10-24T00:00:00.000Z",
    },
  ];

  it("does not send email when posts array is empty (FRD #8)", async () => {
    let called = false;
    const mockTransport = {
      sendMail: async () => {
        called = true;
        return { messageId: "msg-123" };
      },
    } as unknown as Transporter;

    const result = await sendDigest([], sampleConfig, mockTransport);
    assert.equal(result.sent, false);
    assert.equal(result.postCount, 0);
    assert.equal(called, false);
  });

  it("sends digest when new posts match", async () => {
    let capturedOptions: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        capturedOptions = options;
        return { messageId: "msg-456" };
      },
    } as unknown as Transporter;

    const result = await sendDigest(samplePosts, sampleConfig, mockTransport);
    assert.equal(result.sent, true);
    assert.equal(result.postCount, 1);
    assert.equal(result.messageId, "msg-456");
    assert.equal(result.recipient, "alerts@gmail.com");

    const mail = capturedOptions as {
      from: string;
      to: string;
      subject: string;
      text: string;
    };
    assert.equal(mail.from, "Loker Watcher <alerts@gmail.com>");
    assert.equal(mail.to, "alerts@gmail.com");
    assert.equal(mail.subject, "1 new job post on Threads (#hiring indonesia)");
    assert.ok(mail.text.includes("Hiring React dev"));
  });

  it("uses custom recipient if specified in config", async () => {
    let capturedRecipient = "";
    const mockTransport = {
      sendMail: async (options: unknown) => {
        capturedRecipient = (options as { to: string }).to;
        return { messageId: "msg-789" };
      },
    } as unknown as Transporter;

    const customConfig: EmailConfig = {
      user: "sender@gmail.com",
      pass: "pass",
      to: "recipient@company.com",
    };

    const result = await sendDigest(samplePosts, customConfig, mockTransport);
    assert.equal(result.sent, true);
    assert.equal(result.recipient, "recipient@company.com");
    assert.equal(capturedRecipient, "recipient@company.com");
  });

  it("throws fail-visible error when transport fails", async () => {
    const mockTransport = {
      sendMail: async () => {
        throw new Error("SMTP connection timeout");
      },
    } as unknown as Transporter;

    await assert.rejects(
      () => sendDigest(samplePosts, sampleConfig, mockTransport),
      /email: failed to send digest: SMTP connection timeout/,
    );
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` exits 0
- [x] Email digest test suite passes: `npx tsx --test tests/email.test.ts` exits 0 (15 tests)
- [x] Regression tests pass: `npx tsx --test tests/extract.test.ts tests/keywords.test.ts` exits 0 (email additions break no locked consumers)
- [x] Secret hygiene: `grep -rniE "password|api_key" src tests` matches only env-var NAME constants (LLM_API_KEY, GMAIL_APP_PASSWORD) and test fixture strings ("test-key", "app-password"), never secrets
- [x] Config exports preserved: `grep -c "ENV_NAMES" src/config.ts` returns 1 or more

#### Manual Verification:
- [x] Verify `buildDigest` formats plain-text output matching the FRD format: numbered list with caption, author with `@`, permalink on its own line, double-newline separation
- [x] Verify `sendDigest` returns `{ sent: false, postCount: 0 }` and skips nodemailer transport invocation when post list is empty (FRD #8)
- [x] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

---

## Phase 7: CLI + workflow + README

### Overview

CLI pipeline wiring plus the GitHub Actions workflow and README. Carries the project-baseline checks and the bot-detection smoke gate.

### Changes Required:

#### 1. src/index.ts — NEW
**File**: `src/index.ts`
**Changes**: Pipeline wiring: fetch → extract → dedupe vs state → keywords → judge → filter → email → state commit. Fail-visible errors (non-zero exit), logs each stage count.

```ts
/**
 * CLI entry point: the full v1 pipeline (FRD #1-#9).
 *
 * fetch → extract → dedupe vs state → keywords → judge → filter → email →
 * state commit. Every stage logs its counts; any thrown error exits non-zero
 * and leaves state untouched (D8: the write is match-gated and ordered after
 * the email send, so a failed run never marks posts seen).
 */
import { extractPosts } from "./extract.js";
import { fetchTagPages } from "./fetch-threads.js";
import { resolveTags } from "./config.js";
import { filterPostsByKeywords } from "./keywords.js";
import { judgePosts, resolveJudgeConfig } from "./judge.js";
import { diffNew, loadState, saveState } from "./state.js";
import { resolveEmailConfig, sendDigest } from "./email.js";
import type { Post } from "./types.js";

async function main(): Promise<void> {
  const tags = resolveTags(process.env);
  console.log(`watch: surfaces: ${tags.join(", ")}`);

  const surfaces = await fetchTagPages(tags);

  const seen = new Set<string>();
  const posts: Post[] = [];
  for (const surface of surfaces) {
    const extracted = extractPosts(surface.html);
    console.log(`extract: tag/${surface.tag}: ${extracted.length} post(s)`);
    for (const post of extracted) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
  }
  console.log(
    `extract: ${posts.length} unique post(s) across ${surfaces.length} surface(s)`,
  );

  const state = await loadState();
  const newPosts = diffNew(state, posts);
  if (newPosts.length === 0) {
    console.log("no new matches");
    return;
  }
  console.log(`state: ${newPosts.length} unseen post(s)`);

  const maybes = filterPostsByKeywords(newPosts);
  if (maybes.length === 0) {
    console.log("keywords: 0 maybes");
    console.log("no new matches");
    return;
  }

  const { judged, skippedPostIds } = await judgePosts(
    maybes,
    resolveJudgeConfig(process.env),
  );
  const matches = judged
    .filter((j) => j.verdict.relevant && j.verdict.locationOk)
    .map((j) => j.post);
  console.log(
    `keywords: ${maybes.length} maybes, judge: ${matches.length} relevant+located, skipped: ${skippedPostIds.length}`,
  );

  if (matches.length === 0) {
    console.log("no new matches");
    return;
  }

  // Email before state: a failed send exits non-zero and leaves state
  // untouched, so the next run re-judges and re-sends these matches (D3, D8).
  await sendDigest(matches, resolveEmailConfig(process.env));

  // Persist every successfully judged post id — relevant or not — so match
  // runs bound re-judging (no-match runs persist nothing, per FRD #9).
  // Skipped ids stay unseen and are retried next run (D3). saveState stays
  // gated: this line is reached only when matches.length > 0.
  const judgedIds = judged.map((j) => j.post.id);
  const result = await saveState(state, judgedIds);
  console.log(`state: ${result.addedCount} new seen post id(s)`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`watch: FAILED — ${message}`);
  process.exit(1);
});
```

#### 2. .github/workflows/watch.yml — NEW
**File**: `.github/workflows/watch.yml`
**Changes**: ubuntu-latest; schedule cron */10 + workflow_dispatch; permissions contents: write; node 22; npm ci; playwright install --with-deps chromium; tsx src/index.ts with env from secrets; commit-back step (github-actions[bot]) only when state changed; timeout-minutes: 10.

```yaml
name: watch

on:
  schedule:
    - cron: "*/10 * * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: watch
  cancel-in-progress: false

jobs:
  watch:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Install Playwright browser
        run: npx playwright install --with-deps chromium

      - name: Run watcher
        env:
          THREADS_TAGS: ${{ vars.THREADS_TAGS }}
          LLM_BASE_URL: ${{ secrets.LLM_BASE_URL }}
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
          LLM_MODEL: ${{ secrets.LLM_MODEL }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: npx tsx src/index.ts

      - name: Commit state
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add state/seen-posts.json
          if git diff --cached --quiet; then
            echo "state unchanged; nothing to commit"
            exit 0
          fi
          PREV=$(git show HEAD:state/seen-posts.json | jq '.seenPostIds | length' 2>/dev/null || echo 0)
          CURR=$(jq '.seenPostIds | length' state/seen-posts.json)
          git commit -m "state: $((CURR - PREV)) new seen post ids"
          git push
```

#### 3. README.md — NEW
**File**: `README.md`
**Changes**: Setup: required Actions secrets (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, GMAIL_USER, GMAIL_APP_PASSWORD), public-repo rationale, smoke-run instructions (workflow_dispatch), local run steps.

````markdown
# loker-watcher

Threads #hiring Indonesia job alerts. A GitHub Actions workflow loads three
Threads tag pages every 10 minutes, filters posts for frontend / fullstack
roles in Indonesia (or remote), and emails new matches as a plain-text
digest. No web UI; the only persistence is `state/seen-posts.json`.

## Pipeline

1. Playwright loads the tag pages listed in `THREADS_TAGS` (default
   `hiring,lowker,infokerja`), logged out.
2. Posts are extracted from the embedded `data-sjs` JSON.
3. Posts already in `state/seen-posts.json` are dropped.
4. A keyword pre-filter keeps frontend / fullstack candidates.
5. One LLM call per candidate returns `{relevant, locationOk}`.
6. New relevant + located posts are emailed; zero-match runs send nothing.
7. On match runs the state file is committed back as `github-actions[bot]`.

## Requirements

- **Public GitHub repository.** Scheduled workflows on public repos run free
  and unlimited; a private repo at this cadence would burn roughly 11,000
  paid minutes per month.
- A Gmail account with an
  [app password](https://myaccount.google.com/apppasswords) (2FA required).
- An OpenAI-compatible chat endpoint (base URL, API key, model name).

## Setup

1. Push this repo as **public**.
2. Add the secrets under **Settings → Secrets and variables → Actions**:

   | Name | Example value | Purpose |
   |---|---|---|
   | `LLM_BASE_URL` | `https://api.openai.com/v1` | Chat completions endpoint |
   | `LLM_API_KEY` | your-key-here | Endpoint credentials |
   | `LLM_MODEL` | `gpt-4o-mini` | Judge model |
   | `GMAIL_USER` | `you@gmail.com` | Sender and recipient |
   | `GMAIL_APP_PASSWORD` | your-app-password | Gmail SMTP credentials |

   Optional variable (not a secret): `THREADS_TAGS` — comma-separated tag
   list, default `hiring,lowker,infokerja`.
3. Commit `package-lock.json` (generated by the first `npm install`) — the
   workflow's `npm ci` step requires it.
4. Enable Actions on the repo. The schedule (`*/10 * * * *`) then runs
   best-effort.

## Smoke run

Trigger **Actions → watch → Run workflow** (workflow_dispatch). Expected:

- Run logs show per-surface post counts (`extract: tag/hiring: N post(s)`).
- A match run emails the digest and pushes a `state: N new seen post ids`
  commit as `github-actions[bot]`.
- An immediate re-run logs `no new matches` and sends the status digest.

If the run gets no posts from Actions runner IPs, Threads is blocking
datacenter traffic — escalate browser hardening (design decision D2) before
trying other fixes.

## Local run

```bash
npm install
npx playwright install chromium
export LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=...
export GMAIL_USER=... GMAIL_APP_PASSWORD=...
npm start
```

## Maintenance

- Public repos auto-disable scheduled workflows after 60 days without repo
  activity. State commit-backs usually keep it alive; after a long quiet
  stretch, run a manual dispatch.
- Rollback for a bad run: `git revert` the state commit. State writes are
  atomic, so a crashed run cannot leave a partial file.
````

#### 4. package-lock.json — NEW
**File**: `package-lock.json`
**Changes**: Generated by `npm install` and committed to the repo. Required by the workflow's `npm ci` step and by setup-node's `cache: npm` — both hard-fail without a committed lockfile, which would break the Phase 7 smoke gate on first push.

### Success Criteria:

#### Automated Verification:
- [x] `npm install` exits 0 and produces package-lock.json
- [x] Lockfile committed: `git ls-files --error-unmatch package-lock.json` exits 0 (required by `npm ci` and `cache: npm`)
- [x] Type checking passes: `npx tsc --noEmit` exits 0
- [ ] Full suite passes: `npm test` exits 0 (extract + keywords + email + recency + session suites)
- [x] Secret hygiene: `grep -rniE "password|api_key" src tests .github README.md` matches only env-var NAME constants and README placeholder mentions — never secret values
- [x] Workflow triggers: `grep -c "workflow_dispatch" .github/workflows/watch.yml` returns 1; `grep -F 'cron: "*/10 * * * *"' .github/workflows/watch.yml` returns 1
- [x] Bot commit-back gated: `grep -c "github-actions\\[bot\\]" .github/workflows/watch.yml` returns 2 or more; the commit step runs `git commit` only when the staged diff is non-empty
- [x] No PAT in commit-back path: `grep -ci "personal.access.token\\|pat_" .github/workflows/watch.yml` returns 0 — the commit-back uses only the ambient GITHUB_TOKEN, whose pushes do not start new runs (Verification Notes §6)
- [x] D9 timeout present: `grep -c "timeout-minutes: 10" .github/workflows/watch.yml` returns 1
- [x] Overlap guard present: `grep -c "concurrency:" .github/workflows/watch.yml` returns 1
- [x] No browser caching (Verification Notes §7): `grep -c "actions/cache" .github/workflows/watch.yml` returns 0

#### Manual Verification:
- [ ] BOT-DETECTION SMOKE GATE (blocker per Verification Notes): push to the public repo, trigger workflow_dispatch — run logs show per-surface post counts > 0 and finish green. If blocked, escalate hardening per D2 or fall back per the solutions artifact.
- [ ] With GMAIL_* secrets seeded, a dispatch that finds matches delivers the plain-text digest (numbered posts + permalinks); an immediate second dispatch sends nothing and logs "no new matches"
- [ ] State commit appears authored by github-actions[bot] with message "state: N new seen post ids", only on match runs
- [ ] The state-commit push spawns no new workflow run — the Actions tab shows no run started by that commit (Verification Notes §6)
- [ ] README quick-start works top-to-bottom on a fresh clone — verified 2026-10-25: `git clone` → `npm install` → `npx playwright install chromium` → `npm start` exits 0 with `no new matches`
- [ ] Seed a match to exercise the email and commit-back paths (added 2026-10-25). The only Actions run to date logged `keywords: 0 maybes` and `state unchanged; nothing to commit`, so digest delivery, the `github-actions[bot]` state commit, and the no-new-run check above have **never run**. Add a surface to `watcher.config.json` that currently carries a frontend/fullstack posting (a profile or search URL is the likeliest source — the tag feed carries none), confirm the digest arrives at `GMAIL_USER`, confirm the state commit appears, then remove the temporary surface. **Attempted 2026-10-25 and blocked:** widening `KEYWORDS` surfaced 3 maybes and the judge rejected all 3, because a probe of the live feed found 59 unique posts and zero dev-term posts. Phase 10's URL surfaces are the intended fix — `https://www.threads.com/@hiresflow` is an Indonesian IT job account that yielded 8 posts logged-out.

---


## Phase 8: Authenticated fetch + recency

### Overview

Switches the fetch from logged-out tag pages to an authenticated session and adds a freshness cutoff. Live-probed 2026-10-25 (residential IP, real session exported from the user's Firefox through pire-browser):

| Surface | Posts extracted | Median age | ≤24h |
|---|---|---|---|
| Logged-out tag page (Phases 1–7, data-sjs blobs) | 19 / 21 / 18 | ~23 days | 0 |
| Logged-in tag page, default Top tab | 1 | 594h | 0 |
| Logged-in **Recent** tab + scroll + graphql XHR capture | **92** (one tag) | 0h | **83** |

Three measured facts drive the design:

1. The logged-in tag page defaults to the **Top** view (old, popular posts). The **Recent** tab (aria-label `Recent`) is the fresh feed.
2. The logged-in page hydrates post data through `graphql/query` **XHR responses**, not the initial `data-sjs` blobs (1 post in the blobs vs 92 via XHR). The XHR bodies carry the same `thread_items` JSON shape the extractor already walks.
3. Scrolling accumulates posts through those XHR responses (~12–14 new posts per scroll round); the blobs never accumulate.

The session travels as a base64-encoded Playwright `storageState` document in the `THREADS_SESSION_STATE` Actions secret — account-equivalent, never committed, never in `state/seen-posts.json`. When the secret is unset or invalid, the pipeline falls back to the Phase 3 logged-out path, so the workflow stays deployable before the secret exists.

A recency filter (`RECENCY_HOURS`, default 72) drops older posts before dedupe and judging: the measured distribution is 83/92 posts ≤24h and 89/92 ≤72h, and one 122-day outlier shows why the cutoff is mandatory.

### Changes Required:

#### 1. src/config.ts — MODIFY
**File**: `src/config.ts`
**Changes**: Add the session and recency env-var names plus the recency resolver.

```ts
/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsTags: "THREADS_TAGS",
  threadsSession: "THREADS_SESSION_STATE",
  recencyHours: "RECENCY_HOURS",
  llmBaseUrl: "LLM_BASE_URL",
  llmApiKey: "LLM_API_KEY",
  llmModel: "LLM_MODEL",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;

/** Default freshness window in hours (measured: 89/92 posts ≤72h). */
export const DEFAULT_RECENCY_HOURS = 72;

/**
 * Resolve the recency window (hours) from the environment, falling back to
 * DEFAULT_RECENCY_HOURS when unset, blank, or not a positive number.
 */
export function resolveRecencyHours(
  env: Record<string, string | undefined>,
): number {
  const raw: string | undefined = env[ENV_NAMES.recencyHours];
  if (raw === undefined || raw.trim() === "") return DEFAULT_RECENCY_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECENCY_HOURS;
  return Math.floor(parsed);
}
```

#### 2. src/extract.ts — MODIFY
**File**: `src/extract.ts`
**Changes**: Export the two helpers the authenticated fetch reuses on XHR bodies. `extractPosts` behavior is unchanged; the private `walkForThreadItems` / `normalize` become exported `collectThreadItems` / `normalizeThreadItem` with identical bodies.

```ts
/** Depth-first walk collecting every array stored under "thread_items". */
export function collectThreadItems(node: unknown, out: unknown[]): void {
  // body unchanged from the Phase 2 private walkForThreadItems
}

/** Map one raw thread item to a Post, or null when it lacks required fields. */
export function normalizeThreadItem(item: unknown): Post | null {
  // body unchanged from the Phase 2 private normalize
}
```

#### 3. src/threads-session.ts — NEW
**File**: `src/threads-session.ts`
**Changes**: Decode the base64 session secret to a temp storageState file for Playwright. Returns null (logged-out fallback) when the secret is unset or invalid.

```ts
/**
 * Threads session resolution (Phase 8).
 *
 * The authenticated fetch replays a Playwright storageState document
 * exported from a real browser login. The document travels base64-encoded
 * in the THREADS_SESSION_STATE environment variable (a GitHub Actions
 * secret): it is account-equivalent, so it never enters the repo and never
 * enters state/seen-posts.json. The decoded document is written to an OS
 * temp file that Playwright loads as the browser context's storage state.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_NAMES } from "./config.js";

/** Minimal shape check for a Playwright storageState document. */
export function isValidStorageState(doc: unknown): boolean {
  if (doc === null || typeof doc !== "object") return false;
  const cookies: unknown = (doc as { cookies?: unknown }).cookies;
  return Array.isArray(cookies) && cookies.length > 0;
}

/**
 * Decode the base64 session secret and write it to a temp file.
 * Returns the file path, or null when the secret is unset or invalid —
 * callers fall back to the logged-out fetch.
 */
export async function resolveSession(
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const raw: string | undefined = env[ENV_NAMES.threadsSession];
  if (raw === undefined || raw.trim() === "") return null;

  let doc: unknown;
  try {
    doc = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    console.warn(
      "session: THREADS_SESSION_STATE is not valid base64 JSON — using the logged-out fetch",
    );
    return null;
  }
  if (!isValidStorageState(doc)) {
    console.warn(
      "session: THREADS_SESSION_STATE carries no cookies — using the logged-out fetch",
    );
    return null;
  }

  const dir = await mkdtemp(join(tmpdir(), "loker-session-"));
  const filePath = join(dir, "storage-state.json");
  await writeFile(filePath, JSON.stringify(doc), "utf8");
  return filePath;
}
```

#### 4. src/recency.ts — NEW
**File**: `src/recency.ts`
**Changes**: Freshness cutoff applied after extraction, before dedupe and judging.

```ts
/**
 * Recency filter (Phase 8).
 *
 * Tag feeds mix fresh posts with weeks-old ones (measured 2026-10-25: the
 * logged-out /tag/hiring feed had a median age of ~23 days, and the
 * authenticated Recent tab still surfaced one 122-day outlier). Posts
 * older than the window are dropped before dedupe and judging, so the
 * digest only carries recent openings and LLM calls stay bounded.
 */
import type { Post } from "./types.js";

/** Keep only posts whose timestamp is within `hours` of `now`. */
export function filterRecent(
  posts: readonly Post[],
  hours: number,
  now: number = Date.now(),
): Post[] {
  if (!Number.isFinite(hours) || hours <= 0) return [...posts];
  const cutoff = now - hours * 3_600_000;
  return posts.filter((post) => {
    const takenAt = new Date(post.timestamp).getTime();
    return Number.isFinite(takenAt) && takenAt >= cutoff;
  });
}
```

#### 5. src/fetch-threads.ts — MODIFY
**File**: `src/fetch-threads.ts`
**Changes**: Add the authenticated fetch. `fetchTagPages` (logged-out) stays unchanged as the no-session fallback. New constants join the existing block: `RECENT_TAB_LABEL = "Recent"`, `RECENT_TAB_TIMEOUT_MS = 15_000`, `MAX_SCROLL_ROUNDS = 8`, `MAX_DRY_SCROLL_ROUNDS = 3`, `SCROLL_MIN_GAIN = 2`, `MAX_POSTS_PER_SURFACE = 150`, `RECENT_SETTLE_MS = 5000`, `SCROLL_SETTLE_MS = 2500`, `XHR_DRAIN_MS = 1500`.

**Revision 2026-10-25 (validation blocker).** The fence below is the corrected version. The 2026-10-25 validation run measured the previous fence extracting **0 posts on every surface** and then throwing, from two timing defects:

1. `recentTab.count()` was a one-shot probe. Measured against a real session: `count()` returns **0** at the moment the hydration gate resolves and **1** roughly 6 seconds later. The code therefore always took the `else` branch, stayed on the Top view, and received no `thread_items`-carrying graphql responses at all (`xhrBodies` stayed 0).
2. The scroll loop broke after a single `SCROLL_SETTLE_MS` settle. `posts` is filled by **async** response handlers, so round 1 almost always measures `gained === 0` and the loop exits immediately. Measured with the Recent tab clicked: round 1 `+0`, round 2 `+25`, round 3 `+13`.

A scratch replica of this same function with only those two timings repaired — same session, machine, viewport and UA — yielded **68 posts on /tag/hiring from 6 XHR bodies**. The all-fail error is also corrected to name the surfaces that returned zero posts, because a surface yielding 0 posts counts as a success and previously produced an empty failure list.

```ts
/** Phase 8 constants. These join the block Phase 3 declared at the top of
 * this module (NAV_TIMEOUT_MS, MAX_ATTEMPTS, RETRY_BASE_DELAY_MS, USER_AGENT,
 * HAS_THREAD_ITEMS, RECENT_TAB_LABEL, MAX_SCROLL_ROUNDS, SCROLL_MIN_GAIN,
 * MAX_POSTS_PER_SURFACE, RECENT_SETTLE_MS, SCROLL_SETTLE_MS, XHR_DRAIN_MS).
 * RECENT_TAB_TIMEOUT_MS and MAX_DRY_SCROLL_ROUNDS are new in Phase 8.
 */
const RECENT_TAB_TIMEOUT_MS = 15_000;
const MAX_DRY_SCROLL_ROUNDS = 3;

/**
 * Fetch posts from the tag pages with an authenticated session.
 *
 * The logged-in tag page defaults to the Top view (old, popular posts) and
 * hydrates post data through graphql XHR responses instead of the initial
 * data-sjs blobs (measured 2026-10-25: 1 post in the blobs vs 92 via XHR).
 * This function clicks the Recent tab, captures graphql response bodies,
 * walks them for thread_items arrays with the same helpers extractPosts
 * uses, and scrolls until the feed stops yielding new posts.
 *
 * Throws when every surface fails (message lists per-surface errors).
 */
export async function fetchTagPostsAuthenticated(
  tags: readonly string[],
  storageStatePath: string,
): Promise<Post[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: storageStatePath,
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
    });
    await context.addInitScript(
      "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
    );

    const results: Post[] = [];
    const failures: string[] = [];
    const empty: string[] = [];
    for (const tag of tags) {
      try {
        const posts = await fetchOneAuthenticated(context, tag);
        console.log(`extract: tag/${tag}: ${posts.length} post(s) (authenticated)`);
        // A surface that yields 0 posts is NOT a thrown failure, so it never
        // reaches `failures`. Track it separately or the all-fail error below
        // lists nothing and the run dies with no diagnostic.
        if (posts.length === 0) empty.push(`/tag/${tag}`);
        results.push(...posts);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`/tag/${tag}: ${message}`);
        console.warn(`fetch: /tag/${tag} FAILED — ${message}`);
      }
    }

    if (results.length === 0) {
      const detail: string[] = [...failures];
      if (empty.length > 0) {
        detail.push(
          `${empty.join(", ")}: 0 post(s) extracted — the Recent tab or the graphql XHR capture yielded nothing`,
        );
      }
      throw new Error(
        `fetch: all ${tags.length} authenticated surface(s) failed:\n${detail.join("\n")}`,
      );
    }
    return results;
  } finally {
    await browser.close();
  }
}

/** One authenticated surface: Recent tab, XHR capture, scroll to accumulate. */
async function fetchOneAuthenticated(
  context: BrowserContext,
  tag: string,
): Promise<Post[]> {
  const page = await context.newPage();
  const posts = new Map<string, Post>();
  let xhrBodies = 0;

  // Attach before navigation: the logged-in feed streams post data through
  // graphql XHR responses, not the initial data-sjs blobs.
  page.on("response", (response) => {
    if (posts.size >= MAX_POSTS_PER_SURFACE) return;
    if (!/graphql/i.test(response.url()) || response.status() !== 200) return;
    void (async () => {
      try {
        const body = await response.text();
        if (!body.includes("thread_items")) return;
        xhrBodies += 1;
        const items: unknown[] = [];
        collectThreadItems(JSON.parse(body), items);
        for (const item of items) {
          const post = normalizeThreadItem(item);
          if (post !== null) posts.set(post.id, post);
        }
      } catch {
        // not every graphql response is JSON we care about; skip it
      }
    })();
  });

  try {
    await page.goto(tagPageUrl(tag), {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForFunction(HAS_THREAD_ITEMS, undefined, {
      timeout: NAV_TIMEOUT_MS,
      polling: 500,
    });

    // The default view is Top (old posts); Recent is the fresh feed.
    // The tab renders AFTER the hydration gate resolves (measured 2026-10-25:
    // count() === 0 at gate time, === 1 ~6s later), so WAIT for it instead of
    // probing once. A one-shot count() silently keeps the Top view, which
    // emits no thread_items XHR bodies at all.
    const recentTab = page.locator(`[aria-label="${RECENT_TAB_LABEL}"]`).first();
    let recentVisible = true;
    try {
      await recentTab.waitFor({
        state: "visible",
        timeout: RECENT_TAB_TIMEOUT_MS,
      });
    } catch {
      recentVisible = false;
    }
    if (recentVisible) {
      await recentTab.click();
      await page.waitForTimeout(RECENT_SETTLE_MS);
    } else {
      console.warn(`fetch: /tag/${tag} has no Recent tab — using the default view`);
    }

    // `posts` is filled by ASYNC response handlers, so a single settle window
    // almost always measures +0 on round 1 (measured: round 1 +0, round 2 +25,
    // round 3 +13). Stop only after MAX_DRY_SCROLL_ROUNDS consecutive rounds
    // that gain fewer than SCROLL_MIN_GAIN posts.
    let dryRounds = 0;
    for (let round = 1; round <= MAX_SCROLL_ROUNDS; round += 1) {
      const before = posts.size;
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await page.waitForTimeout(SCROLL_SETTLE_MS);
      const gained = posts.size - before;
      if (gained < SCROLL_MIN_GAIN) {
        dryRounds += 1;
        console.log(
          `fetch: /tag/${tag} scroll ${round}: +${gained} (dry ${dryRounds}/${MAX_DRY_SCROLL_ROUNDS})`,
        );
        if (dryRounds >= MAX_DRY_SCROLL_ROUNDS) break;
      } else {
        dryRounds = 0;
        console.log(`fetch: /tag/${tag} scroll ${round}: +${gained}`);
      }
      if (posts.size >= MAX_POSTS_PER_SURFACE) break;
    }

    // Let in-flight response handlers settle before the page goes away.
    await page.waitForTimeout(XHR_DRAIN_MS);
    console.log(
      `fetch: /tag/${tag} OK — ${posts.size} post(s) from ${xhrBodies} XHR response(s)`,
    );
    return [...posts.values()];
  } finally {
    await page.close();
  }
}
```

#### 6. src/index.ts — MODIFY
**File**: `src/index.ts`
**Changes**: Branch on session presence; dedupe both paths uniformly; apply the recency filter after extraction. The rest of the pipeline is unchanged.

```ts
async function main(): Promise<void> {
  const tags = resolveTags(process.env);
  console.log(`watch: surfaces: ${tags.join(", ")}`);

  const sessionPath = await resolveSession(process.env);
  const collected: Post[] =
    sessionPath !== null
      ? await fetchTagPostsAuthenticated(tags, sessionPath)
      : await fetchLoggedOutPosts(tags);
  const posts = dedupePosts(collected);
  console.log(
    `extract: ${posts.length} unique post(s) across ${tags.length} surface(s)`,
  );

  const recencyHours = resolveRecencyHours(process.env);
  const recent = filterRecent(posts, recencyHours);
  console.log(`recency: ${recent.length} post(s) within ${recencyHours}h`);

  const state = await loadState();
  const newPosts = diffNew(state, recent);
  // … keywords → judge → filter → email → state commit, unchanged
}

/** Logged-out path (Phase 3): blob extraction per surface, in input order. */
async function fetchLoggedOutPosts(tags: readonly string[]): Promise<Post[]> {
  const surfaces = await fetchTagPages(tags);
  const posts: Post[] = [];
  for (const surface of surfaces) {
    const extracted = extractPosts(surface.html);
    console.log(`extract: tag/${surface.tag}: ${extracted.length} post(s)`);
    posts.push(...extracted);
  }
  return posts;
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
```

#### 7. tests/fixture/graphql-response.json — NEW
**File**: `tests/fixture/graphql-response.json`
**Changes**: Trimmed REAL graphql XHR body (captured 2026-10-25 from the logged-in /tag/hiring Recent tab; trim rule documented below). Three real posts, byte-real values; the wrapper keeps the real `data.searchResults.edges[].node.thread.thread_items` path.

```json
{"data":{"searchResults":{"edges":[{"node":{"thread":{"thread_items":[{"post":{"pk":"4014250536231619721","id":"4014250536231619721_14432992854","code":"De1e5gjgcyJ","taken_at":1792755976,"caption":{"text":"We're Hiring warga threads !! [ URGENT ]\n\nKantor aku lagi urgently hiring cari kandidat sebagai Staf Admin Entry di Start Dinamics \nSistem kerja: Full Remote\nEst. Salary: UMK \nTerbuka untuk semua kalangan yang berpengalaman dan non pengalaman ya !!"},"user":{"pk":"14432992854","username":"hamimakania40"},"media_type":19}},{"post":{"pk":"3927218294432306756","id":"3927218294432306756_70889119608","code":"DaASDtDDZZE","taken_at":1782380924,"caption":{"text":"Has anyone ever been hired from threads?????\nLike for real!!!!"},"user":{"pk":"70889119608","username":"pheantuswa_the_va"},"media_type":19}},{"post":{"pk":"4013422453929761329","id":"4013422453929761329_54294628273","code":"DeyinU0D1ox","taken_at":1792657261,"caption":{"text":"Hi semuaa!!\nAku Muthia, seorang recruiter yang ke depannya bakal share beberapa lowongan kerja dari perusahaan tempatku bekerja di sini.\n\nSiapa tahu ada yang lagi cari peluang baru, atau punya teman yang lagi cari kerja. 👀\n\nAda yang tertarik kalau aku share lowongannya di sini? 🙌🏻"},"user":{"pk":"54294628273","username":"muthiahworks"},"media_type":19}}]}}}]}},"extensions":{"is_final":true},"status":"ok"}
```

Trim rule: first three `thread_items` of the first captured response; every retained value (pk, id, code, taken_at, caption text, username) is byte-real from the capture; all other post keys dropped.

#### 8. tests/extract.test.ts — MODIFY
**File**: `tests/extract.test.ts`
**Changes**: Add the XHR-shape regression case using the exported helpers.

```ts
describe("graphql XHR body extraction", () => {
  it("walks a real captured graphql response into posts", () => {
    const body = readFileSync(
      join(here, "fixture", "graphql-response.json"),
      "utf8",
    );
    const items: unknown[] = [];
    collectThreadItems(JSON.parse(body), items);
    const posts = items
      .map(normalizeThreadItem)
      .filter((p): p is Post => p !== null);
    assert.equal(posts.length, 3);
    assert.deepEqual(posts[0], {
      id: "4014250536231619721",
      text: "We're Hiring warga threads !! [ URGENT ]\n\nKantor aku lagi urgently hiring cari kandidat sebagai Staf Admin Entry di Start Dinamics \nSistem kerja: Full Remote\nEst. Salary: UMK \nTerbuka untuk semua kalangan yang berpengalaman dan non pengalaman ya !!",
      author: "hamimakania40",
      permalink: "https://www.threads.com/@hamimakania40/post/De1e5gjgcyJ",
      timestamp: new Date(1792755976 * 1000).toISOString(),
    });
  });
});
```

#### 9. tests/recency.test.ts — NEW
**File**: `tests/recency.test.ts`
**Changes**: Window boundaries, non-positive windows, unparseable timestamps, empty input.

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterRecent } from "../src/recency.js";
import type { Post } from "../src/types.js";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

function post(id: string, hoursAgo: number): Post {
  return {
    id,
    text: `post ${id}`,
    author: "tester",
    permalink: `https://www.threads.com/@tester/post/${id}`,
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  };
}

describe("filterRecent", () => {
  it("keeps posts inside the window and drops older ones", () => {
    const posts = [post("1", 1), post("2", 71), post("3", 73), post("4", 500)];
    assert.deepEqual(
      filterRecent(posts, 72, NOW).map((p) => p.id),
      ["1", "2"],
    );
  });

  it("keeps a post exactly at the cutoff", () => {
    assert.equal(filterRecent([post("edge", 72)], 72, NOW).length, 1);
  });

  it("returns everything when the window is not positive", () => {
    const posts = [post("1", 10_000)];
    assert.equal(filterRecent(posts, 0, NOW).length, 1);
    assert.equal(filterRecent(posts, -5, NOW).length, 1);
    assert.equal(filterRecent(posts, Number.NaN, NOW).length, 1);
  });

  it("drops posts with unparseable timestamps", () => {
    const broken: Post = { ...post("bad", 0), timestamp: "not-a-date" };
    assert.equal(filterRecent([broken], 72, NOW).length, 0);
  });

  it("handles an empty list", () => {
    assert.deepEqual(filterRecent([], 72, NOW), []);
  });
});
```

#### 10. tests/session.test.ts — NEW
**File**: `tests/session.test.ts`
**Changes**: Shape validation, unset/blank/invalid secrets, and the temp-file write.

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { isValidStorageState, resolveSession } from "../src/threads-session.js";

const VALID = Buffer.from(
  JSON.stringify({
    cookies: [
      { name: "sessionid", value: "x", domain: ".threads.com", path: "/" },
    ],
    origins: [],
  }),
  "utf8",
).toString("base64");

describe("isValidStorageState", () => {
  it("accepts a document with a non-empty cookies array", () => {
    assert.equal(isValidStorageState({ cookies: [{}] }), true);
  });

  it("rejects documents without cookies", () => {
    assert.equal(isValidStorageState({ cookies: [] }), false);
    assert.equal(isValidStorageState({}), false);
    assert.equal(isValidStorageState(null), false);
    assert.equal(isValidStorageState("nope"), false);
  });
});

describe("resolveSession", () => {
  it("returns null when the secret is unset or blank", async () => {
    assert.equal(await resolveSession({}), null);
    assert.equal(await resolveSession({ THREADS_SESSION_STATE: "   " }), null);
  });

  it("returns null for a secret that is not base64 JSON", async () => {
    assert.equal(
      await resolveSession({ THREADS_SESSION_STATE: "!!!not-base64!!!" }),
      null,
    );
  });

  it("returns null when the document carries no cookies", async () => {
    const empty = Buffer.from(
      JSON.stringify({ cookies: [] }),
      "utf8",
    ).toString("base64");
    assert.equal(await resolveSession({ THREADS_SESSION_STATE: empty }), null);
  });

  it("writes a valid storageState file and returns its path", async () => {
    const path = await resolveSession({ THREADS_SESSION_STATE: VALID });
    assert.ok(path !== null);
    const doc = JSON.parse(await readFile(path, "utf8")) as {
      cookies: Array<{ name: string }>;
    };
    assert.equal(doc.cookies[0]?.name, "sessionid");
  });
});
```

#### 11. .github/workflows/watch.yml — MODIFY
**File**: `.github/workflows/watch.yml`
**Changes**: Pass the session secret and the recency variable to the watcher step. All other steps unchanged.

```yaml
      - name: Run watcher
        env:
          THREADS_TAGS: ${{ vars.THREADS_TAGS }}
          THREADS_SESSION_STATE: ${{ secrets.THREADS_SESSION_STATE }}
          RECENCY_HOURS: ${{ vars.RECENCY_HOURS }}
          LLM_BASE_URL: ${{ secrets.LLM_BASE_URL }}
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
          LLM_MODEL: ${{ secrets.LLM_MODEL }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: npx tsx src/index.ts
```

#### 12. README.md — MODIFY
**File**: `README.md`
**Changes**: Secrets table gains `THREADS_SESSION_STATE`; the optional-variable line gains `RECENCY_HOURS`; a new "Refresh the Threads session" section documents the export procedure and the security note; the `## Pipeline` section is rewritten because steps 1 and 2 become untrue the moment the session secret is set.

**Revision 2026-10-25.** The Phase 7 fence's `## Pipeline` still reads "Playwright loads the tag pages … logged out" and "Posts are extracted from the embedded `data-sjs` JSON". With `THREADS_SESSION_STATE` set the pipeline signs in, clicks the Recent tab, and reads posts from graphql XHR bodies. Replace that section with the text below. The session-export step also gains the `sameSite` conversion note — Playwright rejects the raw pire-browser cookie objects (`expected one of (Strict|Lax|None)`), so the documented procedure failed as written.

````markdown
## Pipeline

1. If `THREADS_SESSION_STATE` is set, Playwright signs in with that session,
   opens each tag page, clicks the **Recent** tab, and reads posts from the
   `graphql` XHR responses. Otherwise it loads the tag pages logged out and
   reads posts from the embedded `data-sjs` JSON blobs.
2. Posts are deduplicated across surfaces.
3. Posts older than `RECENCY_HOURS` (default 72) are dropped.
4. Posts already in `state/seen-posts.json` are dropped.
5. A keyword pre-filter keeps frontend / fullstack candidates.
6. One LLM call per candidate returns `{relevant, locationOk}`.
7. New relevant + located posts are emailed as the job digest.
8. On match runs the state file is committed back as `github-actions[bot]`.

| `THREADS_SESSION_STATE` | base64 storageState | Threads login session (see below) |

Optional variables (not secrets): `THREADS_TAGS` — comma-separated tag list,
default `hiring,lowker,infokerja`; `RECENCY_HOURS` — freshness window in
hours, default `72`.

## Refresh the Threads session

The watcher signs in with a browser session exported from a real login —
no password is stored anywhere. The session is account-equivalent: treat it
like a password, keep it in the secret only, and never commit it.

1. Log in to threads.com in a regular Firefox session.
2. Export the cookies for `.threads.com` as a Playwright storageState
   document (`{ "cookies": [...], "origins": [] }`). A cookie-export
   extension or `pire-browser cookies --json` against the logged-in tab
   both work; keep `sessionid`, `ds_user_id`, `csrftoken`, `mid`, `ig_did`.
   **The raw export is not a storageState document — convert it first.**
   Playwright rejects the pire-browser cookie objects outright:
   `browser.newContext: storageState.cookies[0].sameSite: expected one of
   (Strict|Lax|None)`, because the export uses `unspecified` and
   `no_restriction`. Map every `sameSite` (`unspecified`/`lax` → `Lax`,
   `strict` → `Strict`, `no_restriction` → `None`), wrap the array as
   `{ "cookies": [...], "origins": [] }`, then base64-encode the result.
3. Base64-encode the file and set the secret:

   ```bash
   gh secret set THREADS_SESSION_STATE < storage-state.json.b64
   ```

The session lasts roughly a year (`sessionid` expiry). When runs start
logging the logged-out fallback warning or post counts drop back to ~19 per
tag, repeat the export. With the secret unset or invalid the watcher falls
back to the logged-out fetch and still runs.
````

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` exits 0
- [x] Recency suite passes: `npx tsx --test tests/recency.test.ts` exits 0 (5 tests)
- [x] Session suite passes: `npx tsx --test tests/session.test.ts` exits 0 (6 tests)
- [x] XHR fixture regression: `npx tsx --test tests/extract.test.ts` exits 0 — the graphql fixture walks through collectThreadItems/normalizeThreadItem to the expected Post[]
- [x] Full suite passes: `npm test` exits 0
- [ ] Config surface (partially relocated by Phase 10): `grep -c "THREADS_SESSION_STATE" src/config.ts` returns 1 or more; `grep -c "recencyHours" watcher.config.json` returns 1 or more — the recency default moved out of `src/config.ts` into the JSON source of truth
- [ ] Workflow wiring (partially relocated by Phase 10): `grep -c "THREADS_SESSION_STATE" .github/workflows/watch.yml` returns 1; `grep -c "RECENCY_HOURS" .github/workflows/watch.yml` returns 0 — the recency window is configured in JSON, not passed as an Actions variable
- [x] Session never persisted: `grep -rn "storageState\|storage-state" state/` returns 0 — the session lives only in the secret and an OS temp file
- [x] Secret hygiene: `grep -rniE "password|api_key|sessionid" src tests .github README.md` matches only env-var NAME constants and README placeholder mentions — never secret values
- [ ] Logged-out fallback intact (renamed by Phase 10): `grep -c "fetchSurfaces" src/index.ts` returns 1 or more — the unauthenticated path still runs when no session is configured
- [x] Recent-tab wait present (revision 2026-10-25): `grep -c "RECENT_TAB_TIMEOUT_MS" src/fetch-threads.ts` returns 1 or more — the tab is awaited, not probed once
- [x] Consecutive-dry-round stop present (revision 2026-10-25): `grep -c "MAX_DRY_SCROLL_ROUNDS" src/fetch-threads.ts` returns 1 or more — the scroll loop no longer breaks on its first dry round
- [x] Zero-post surfaces named in the all-fail error (revision 2026-10-25): `grep -c "0 post(s) extracted" src/fetch-threads.ts` returns 1 or more — a surface yielding nothing is reported, not silently swallowed

#### Manual Verification:
- [ ] With THREADS_SESSION_STATE seeded, a local run logs `fetch: /tag/<tag> OK — N post(s) from M XHR response(s)` per surface with counts well above the logged-out ~19 (probe measured 92 on /tag/hiring; the 2026-10-25 corrected replica measured 68). **This criterion failed on 2026-10-25** — the shipped fence logged `0 post(s) from 0 XHR response(s)` per surface and then threw.
- [ ] The run logs at least one `fetch: /tag/<tag> scroll N: +M` line with `M` ≥ 2 (revision 2026-10-25) — proves the scroll loop did not stop on its first dry round
- [ ] The recency log line shows the kept count (probe: 83/92 within 24h, 89/92 within 72h)
- [x] With the secret unset, the run takes the logged-out path and behaves exactly as Phases 1–7 (regression check) — verified 2026-10-25: 19/21/18 posts, 58 unique
- [x] An invalid THREADS_SESSION_STATE logs the fallback warning and does not fail the run — verified 2026-10-25 for both a non-base64 secret and a cookie-less document
- [ ] Actions dispatch with the secret seeded: Recent-tab counts > 0 from datacenter IPs — the logged-in path is untested from Actions IPs, so this is the Phase 8 smoke gate

---

## Phase 9: No-match heartbeat

### Overview

The watcher sends no email when a run finds no match, so the operator has no signal that the pipeline is alive — and no way to see *why* a run found nothing without opening the Actions log. Measured 2026-10-25 across four authenticated runs: the feed carries 235–337 unique posts and 277–303 within the 72h window, but **0–1 keyword maybes**. A zero-match run is the normal case, not the exception, so the silence carries no information.

Phase 9 sends a status email on every zero-match run: the scan funnel plus the closest candidate posts, each with its permalink, so the operator can judge the feed and click through without leaving the inbox. A match run still sends only the job digest — the heartbeat never fires alongside a real alert.

The heartbeat is **best-effort**: when `GMAIL_USER` / `GMAIL_APP_PASSWORD` are absent it logs a warning and the run still exits 0. A status email that cannot be sent must not fail a run that otherwise succeeded — the opposite of the digest, which stays fail-visible because a missed job is the product failing.

### Changes Required:

#### 1. src/config.ts — MODIFY
**File**: `src/config.ts`
**Changes**: Add the heartbeat kill-switch env name and the GitHub Actions run-URL resolver.

```ts
/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsTags: "THREADS_TAGS",
  threadsSession: "THREADS_SESSION_STATE",
  recencyHours: "RECENCY_HOURS",
  heartbeat: "HEARTBEAT_ENABLED",
  llmBaseUrl: "LLM_BASE_URL",
  llmApiKey: "LLM_API_KEY",
  llmModel: "LLM_MODEL",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;

/**
 * Resolve the heartbeat kill switch. Defaults to true; only an explicit
 * "false" (any casing, surrounding whitespace ignored) disables it. The
 * heartbeat fires on every zero-match run, which at the */10 cron is 144
 * emails a day — this is the one-line valve when that is too many.
 */
export function isHeartbeatEnabled(
  env: Record<string, string | undefined>,
): boolean {
  const raw: string | undefined = env[ENV_NAMES.heartbeat];
  if (raw === undefined) return true;
  return raw.trim().toLowerCase() !== "false";
}

/**
 * Build the Actions run URL from the ambient GITHUB_* variables, or
 * undefined when they are absent (a local run).
 */
export function runUrlFromEnv(
  env: Record<string, string | undefined>,
): string | undefined {
  const server: string | undefined = env["GITHUB_SERVER_URL"];
  const repo: string | undefined = env["GITHUB_REPOSITORY"];
  const runId: string | undefined = env["GITHUB_RUN_ID"];
  if (server === undefined || repo === undefined || runId === undefined) {
    return undefined;
  }
  return `${server}/${repo}/actions/runs/${runId}`;
}
```

#### 2. src/email.ts — MODIFY
**File**: `src/email.ts`
**Changes**: Extract the transport, credential and error handling that `sendDigest` already performs into a shared `sendText(subject, text, config, transport?)`. `sendDigest` keeps its exact public shape and behavior; both emails now resolve credentials once and fail the same way. The extraction also retires the `any` leak the plan review recorded: `sendText` returns `string | undefined`, and `sendDigest` attaches `messageId` through a conditional spread so it stays assignable under `exactOptionalPropertyTypes: true`.

```ts
/**
 * Send one plain-text email through the Gmail transport.
 *
 * Shared by the digest (Phase 6) and the heartbeat (Phase 9) so both paths
 * resolve credentials once and fail the same way. Returns the message id
 * when the transport reports one.
 */
export async function sendText(
  subject: string,
  text: string,
  config: EmailConfig,
  transport?: Transporter,
): Promise<string | undefined> {
  const recipient = config.to ?? config.user;
  const mailer =
    transport ??
    nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

  try {
    const info = await mailer.sendMail({
      from: `Loker Watcher <${config.user}>`,
      to: recipient,
      subject,
      text,
    });
    return typeof info?.messageId === "string" ? info.messageId : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`email: failed to send: ${message}`);
  }
}

/**
 * Send a digest email for new matched posts via nodemailer (FRD #7, #8).
 *
 * Gated: returns { sent: false, postCount: 0 } immediately when posts is empty.
 * Accepts an optional custom Transporter instance for unit testing.
 * Throws when nodemailer fails to deliver, ensuring fail-visible execution.
 */
export async function sendDigest(
  posts: readonly Post[],
  config: EmailConfig,
  transport?: Transporter,
): Promise<SendDigestResult> {
  if (posts.length === 0) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const subject = buildSubject(posts);
  const text = buildDigest(posts);
  if (subject === null || text === null) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const messageId = await sendText(subject, text, config, transport);
  const recipient = config.to ?? config.user;
  console.log(`email: sent digest with ${posts.length} post(s) to ${recipient}`);

  return {
    sent: true,
    ...(messageId !== undefined ? { messageId } : {}),
    recipient,
    postCount: posts.length,
  };
}
```

#### 3. src/heartbeat.ts — NEW
**File**: `src/heartbeat.ts`
**Changes**: Candidate selection, email building, and best-effort sending for the zero-match status email. Pure functions take `now` as a parameter so the tests are deterministic.

```ts
/**
 * No-match heartbeat (Phase 9).
 *
 * The watcher sends no email when a run finds no match, so the operator has
 * no signal that the pipeline is alive — and no way to see why a run found
 * nothing without opening the Actions log. Measured 2026-10-25: the
 * authenticated feed carries ~300 recent posts per run and 0-1 keyword
 * maybes, so a zero-match run is the normal case. This module builds and
 * sends a status email for those runs: the scan funnel plus the candidate
 * posts that came closest, each with its permalink.
 */
import type { Post } from "./types.js";
import { sendText, type EmailConfig } from "./email.js";
import type { Transporter } from "nodemailer";

/**
 * Candidate net — deliberately broader than KEYWORDS. A post that names no
 * frontend/fullstack keyword can still be worth a human look, so the
 * heartbeat also surfaces posts mentioning an adjacent dev term, an
 * Indonesian city, or remote work.
 */
const CANDIDATE_TERMS: readonly string[] = [
  // adjacent dev terms
  "developer", "programmer", "software", "engineer", "frontend", "front-end",
  "fullstack", "full-stack", "react", "vue", "next.js", "nextjs", "typescript",
  "javascript", "node.js", "nodejs", "web dev", "it support", "teknisi",
  "coding", "coder",
  // Indonesian locations
  "indonesia", "jakarta", "jogja", "yogyakarta", "surabaya", "bandung",
  "medan", "semarang", "bali", "denpasar", "makassar", "palembang", "bekasi",
  "tangerang", "depok", "bogor", "malang", "solo",
  // remote
  "remote", "wfh", "work from home",
];

/** Maximum candidates listed in one heartbeat email. */
export const MAX_CANDIDATES = 10;

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
  /** Posts that passed the keyword pre-filter. */
  maybes: number;
  /** Posts the judge marked relevant AND located. */
  relevantLocated: number;
  /** Posts the judge could not evaluate. */
  skipped: number;
  /** Actions run URL, when the workflow provides the ambient variables. */
  runUrl?: string;
}

/** One candidate post plus why it is in the list. */
export interface Candidate {
  post: Post;
  /** "maybe" passed the keyword filter; "near-miss" only the broader net. */
  reason: "maybe" | "near-miss";
}

/** True when the text mentions any candidate term (case-insensitive). */
export function matchesCandidateTerms(text: string): boolean {
  const normalized = text.toLowerCase();
  return CANDIDATE_TERMS.some((term) => normalized.includes(term));
}

/**
 * Pick the posts worth a human look: every keyword maybe first (strongest
 * signal), then the newest near-misses, capped at `limit`.
 */
export function selectCandidates(
  recent: readonly Post[],
  maybes: readonly Post[],
  limit: number = MAX_CANDIDATES,
): Candidate[] {
  const out: Candidate[] = maybes.map((post) => ({
    post,
    reason: "maybe" as const,
  }));
  if (out.length >= limit) return out.slice(0, limit);

  const maybeIds = new Set(maybes.map((post) => post.id));
  const nearMisses = recent
    .filter(
      (post) => !maybeIds.has(post.id) && matchesCandidateTerms(post.text),
    )
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
    `  ${stats.maybes} keyword maybe(s)`,
    `  ${stats.relevantLocated} relevant + located`,
    `  ${stats.skipped} skipped by the judge`,
    "",
  ];

  if (candidates.length === 0) {
    lines.push("No candidate posts in this run.");
  } else {
    lines.push(`Closest ${candidates.length} candidate(s), newest first:`);
    lines.push("");
    candidates.forEach((candidate, index) => {
      const age = ageHours(candidate.post.timestamp, now);
      const tag = candidate.reason === "maybe" ? " [keyword match]" : "";
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

#### 4. src/index.ts — MODIFY
**File**: `src/index.ts`
**Changes**: Collect the funnel counts into a `HeartbeatStats` object as the pipeline runs, and call a best-effort `heartbeat()` helper at each of the three zero-match exits (no unseen posts, 0 maybes, 0 relevant+located). A match run never calls it. The helper resolves credentials, and on any failure logs a warning and returns — the run still exits 0.

```ts
/**
 * Best-effort status email for a zero-match run.
 *
 * Unlike the digest, a heartbeat that cannot be sent must not fail the run:
 * the pipeline did its job, only the notification failed. Logged loudly so a
 * broken GMAIL_* configuration is visible in the run log.
 */
async function heartbeat(
  stats: HeartbeatStats,
  recent: readonly Post[],
  maybes: readonly Post[],
): Promise<void> {
  if (!isHeartbeatEnabled(process.env)) {
    console.log("heartbeat: disabled by HEARTBEAT_ENABLED");
    return;
  }
  try {
    const config = resolveEmailConfig(process.env);
    const candidates = selectCandidates(recent, maybes);
    await sendHeartbeat(stats, candidates, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`heartbeat: not sent — ${message}`);
  }
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const tags = resolveTags(process.env);
  console.log(`watch: surfaces: ${tags.join(", ")}`);

  const sessionPath = await resolveSession(process.env);
  const collected: Post[] =
    sessionPath !== null
      ? await fetchTagPostsAuthenticated(tags, sessionPath)
      : await fetchLoggedOutPosts(tags);
  const posts = dedupePosts(collected);
  console.log(
    `extract: ${posts.length} unique post(s) across ${tags.length} surface(s)`,
  );

  const recencyHours = resolveRecencyHours(process.env);
  const recent = filterRecent(posts, recencyHours);
  console.log(`recency: ${recent.length} post(s) within ${recencyHours}h`);

  // exactOptionalPropertyTypes: attach runUrl only when the ambient
  // GITHUB_* variables are present (a local run has none).
  const runUrl = runUrlFromEnv(process.env);

  const stats: HeartbeatStats = {
    ranAt: startedAt.toISOString(),
    unique: posts.length,
    recent: recent.length,
    recencyHours,
    maybes: 0,
    relevantLocated: 0,
    skipped: 0,
    ...(runUrl !== undefined ? { runUrl } : {}),
  };

  const state = await loadState();
  const newPosts = diffNew(state, recent);
  if (newPosts.length === 0) {
    await heartbeat(stats, recent, []);
    console.log("no new matches");
    return;
  }
  console.log(`state: ${newPosts.length} unseen post(s)`);

  const maybes = filterPostsByKeywords(newPosts);
  stats.maybes = maybes.length;
  if (maybes.length === 0) {
    await heartbeat(stats, recent, maybes);
    console.log("keywords: 0 maybes");
    console.log("no new matches");
    return;
  }

  const { judged, skippedPostIds } = await judgePosts(
    maybes,
    resolveJudgeConfig(process.env),
  );
  const matches = judged
    .filter((j) => j.verdict.relevant && j.verdict.locationOk)
    .map((j) => j.post);
  stats.relevantLocated = matches.length;
  stats.skipped = skippedPostIds.length;
  console.log(
    `keywords: ${maybes.length} maybes, judge: ${matches.length} relevant+located, skipped: ${skippedPostIds.length}`,
  );

  if (matches.length === 0) {
    await heartbeat(stats, recent, maybes);
    console.log("no new matches");
    return;
  }

  // Email before state: a failed send exits non-zero and leaves state
  // untouched, so the next run re-judges and re-sends these matches (D3, D8).
  await sendDigest(matches, resolveEmailConfig(process.env));

  // Persist every successfully judged post id — relevant or not — so match
  // runs bound re-judging (no-match runs persist nothing, per FRD #9).
  // Skipped ids stay unseen and are retried next run (D3). saveState stays
  // gated: this line is reached only when matches.length > 0.
  const judgedIds = judged.map((j) => j.post.id);
  const result = await saveState(state, judgedIds);
  console.log(`state: ${result.addedCount} new seen post id(s)`);
}
```

New imports for `src/index.ts`:

```ts
import { isHeartbeatEnabled, runUrlFromEnv } from "./config.js";
import {
  selectCandidates,
  sendHeartbeat,
  type HeartbeatStats,
} from "./heartbeat.js";
```

#### 5. tests/heartbeat.test.ts — NEW
**File**: `tests/heartbeat.test.ts`
**Changes**: Candidate selection (maybes first, near-miss ordering, limit), term matching, snippet truncation, age computation, subject and body shape, and `sendHeartbeat` through a mock transport.

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ageHours,
  buildHeartbeatBody,
  buildHeartbeatSubject,
  matchesCandidateTerms,
  selectCandidates,
  sendHeartbeat,
  snippet,
  type Candidate,
  type HeartbeatStats,
} from "../src/heartbeat.js";
import type { Post } from "../src/types.js";
import type { Transporter } from "nodemailer";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

function post(id: string, text: string, hoursAgo: number, author = "tester"): Post {
  return {
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
  maybes: 1,
  relevantLocated: 0,
  skipped: 0,
};

describe("matchesCandidateTerms", () => {
  it("matches adjacent dev terms", () => {
    assert.equal(matchesCandidateTerms("Hiring a software engineer"), true);
    assert.equal(matchesCandidateTerms("WE ARE HIRING developers"), true);
  });

  it("matches Indonesian cities and remote", () => {
    assert.equal(matchesCandidateTerms("Lowongan di Jakarta"), true);
    assert.equal(matchesCandidateTerms("100% remote role"), true);
  });

  it("rejects unrelated posts", () => {
    assert.equal(matchesCandidateTerms("HIRING Barista Waiter"), false);
    assert.equal(matchesCandidateTerms("Kitchen crew Johor Bahru"), false);
  });
});

describe("selectCandidates", () => {
  it("puts keyword maybes first", () => {
    const maybe = post("m1", "Hiring React dev", 5);
    const near = post("n1", "Software engineer Jakarta", 1);
    const result = selectCandidates([maybe, near], [maybe], 10);
    assert.equal(result[0]?.reason, "maybe");
    assert.equal(result[0]?.post.id, "m1");
    assert.equal(result[1]?.reason, "near-miss");
  });

  it("orders near-misses newest first", () => {
    const older = post("a", "Software engineer", 40);
    const newer = post("b", "Software engineer", 2);
    const result = selectCandidates([older, newer], [], 10);
    assert.deepEqual(
      result.map((c) => c.post.id),
      ["b", "a"],
    );
  });

  it("does not repeat a maybe as a near-miss", () => {
    const maybe = post("m1", "Hiring React dev", 5);
    const result = selectCandidates([maybe], [maybe], 10);
    assert.equal(result.length, 1);
  });

  it("caps the list at the limit", () => {
    const posts = Array.from({ length: 30 }, (_, i) =>
      post(`p${i}`, "Software engineer", i),
    );
    assert.equal(selectCandidates(posts, [], 10).length, 10);
    assert.equal(selectCandidates(posts, [], 3).length, 3);
  });

  it("returns an empty list when nothing qualifies", () => {
    assert.deepEqual(selectCandidates([post("x", "Barista", 1)], [], 10), []);
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

describe("buildHeartbeatBody", () => {
  it("includes the funnel counts", () => {
    const body = buildHeartbeatBody(STATS, [], NOW);
    assert.ok(body.includes("337 unique post(s)"));
    assert.ok(body.includes("303 within 72h"));
    assert.ok(body.includes("1 keyword maybe(s)"));
    assert.ok(body.includes("0 relevant + located"));
  });

  it("lists candidates with permalinks", () => {
    const candidates: Candidate[] = [
      { post: post("c1", "Hiring React dev in Jakarta", 2, "techco"), reason: "maybe" },
    ];
    const body = buildHeartbeatBody(STATS, candidates, NOW);
    assert.ok(body.includes("1. @techco — 2h ago [keyword match]"));
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
    let captured: { subject: string; text: string } | null = null;
    const mockTransport = {
      sendMail: async (options: { subject: string; text: string }) => {
        captured = options;
        return { messageId: "hb-1" };
      },
    } as unknown as Transporter;

    await sendHeartbeat(
      STATS,
      [],
      { user: "a@gmail.com", pass: "p" },
      NOW,
      mockTransport,
    );

    assert.ok(captured !== null);
    assert.equal(
      captured.subject,
      "loker-watcher: 0 new matches — 303 post(s) scanned",
    );
    assert.ok(captured.text.includes("337 unique post(s)"));
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

#### 6. README.md — MODIFY
**File**: `README.md`
**Changes**: Document the heartbeat in `## Pipeline`, add `HEARTBEAT_ENABLED` to the optional variables, describe the status email in `## Smoke run`, and correct the two statements Phase 9 invalidates — `## Pipeline` step 7 ("zero-match runs send nothing") and the `## Smoke run` re-run bullet ("sends nothing"). Both are replaced, not appended to.

```markdown
## Pipeline

1. If `THREADS_SESSION_STATE` is set, Playwright signs in with that session,
   opens each tag page, clicks the **Recent** tab, and reads posts from the
   `graphql` XHR responses. Otherwise it loads the tag pages logged out and
   reads posts from the embedded `data-sjs` JSON blobs.
2. Posts are deduplicated across surfaces.
3. Posts older than `RECENCY_HOURS` (default 72) are dropped.
4. Posts already in `state/seen-posts.json` are dropped.
5. A keyword pre-filter keeps frontend / fullstack candidates.
6. One LLM call per candidate returns `{relevant, locationOk}`.
7. New relevant + located posts are emailed as the job digest.
8. On match runs the state file is committed back as `github-actions[bot]`.
9. **Zero-match runs email a status digest instead** — the scan funnel plus
   the closest candidate posts with their permalinks — so a quiet run is
   still legible. Set `HEARTBEAT_ENABLED=false` to turn it off.
```

And in `## Smoke run`, **replace** the existing re-run bullet (Phase 9 makes it untrue) and add the status-digest bullet:

```markdown
- An immediate re-run logs `no new matches` and sends the status digest.
- A zero-match run emails a status digest with the funnel counts and up to 10
  candidate permalinks. At the `*/10` cron that is one email per run; set
  `HEARTBEAT_ENABLED=false` if that is too many.
```

#### 7. tests/email.test.ts — MODIFY
**File**: `tests/email.test.ts`
**Changes**: Update the one fail-visible assertion whose error string Phase 9 retires. `sendDigest` now delegates to `sendText`, whose catch rethrows as `email: failed to send:` instead of `email: failed to send digest:`. The Phase 6 test still asserts the old string, so it fails and takes `npm test` with it. This is the single change the 2026-10-25T14:08:52 validation returned `verdict: fail` for.

In the `describe("sendDigest")` block, the `throws fail-visible error when transport fails` case:

```ts
    await assert.rejects(
      () => sendDigest(samplePosts, sampleConfig, mockTransport),
      /email: failed to send: SMTP connection timeout/,
    );
```

Only the regular expression changes. Every other assertion in the file — the zero-post gate, the custom-recipient case, the mock-transporter contract — is untouched.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` exits 0
- [x] Heartbeat suite passes: `npx tsx --test tests/heartbeat.test.ts` exits 0
- [x] Full suite passes: `npm test` exits 0 (extract + keywords + email + recency + session + heartbeat)
- [x] Email regression: `npx tsx --test tests/email.test.ts` exits 0 — the `sendText` extraction breaks no locked digest consumer
- [x] Reconciliation applied: `grep -c "failed to send digest" tests/email.test.ts` returns 0 — the Phase 6 fail-visible assertion no longer names the retired error string
- [x] Digest path unchanged: `grep -c "sendDigest" src/index.ts` returns 1 or more
- [x] Heartbeat fires on every zero-match exit: `grep -c "await heartbeat(" src/index.ts` returns 3
- [x] Heartbeat is best-effort: `grep -c "heartbeat: not sent" src/index.ts` returns 1 — a failed status email never fails the run
- [x] Kill switch wired: `grep -c "HEARTBEAT_ENABLED" src/config.ts` returns 1 or more
- [x] Run URL wired: `grep -c "runUrlFromEnv" src/index.ts` returns 1 or more
- [x] Secret hygiene: `grep -rniE "password|api_key|sessionid" src tests .github README.md` matches only env-var NAME constants and README placeholder mentions — never secret values

#### Manual Verification:
- [ ] With `GMAIL_*` seeded and no match, a run delivers the heartbeat email: subject `loker-watcher: 0 new matches — N post(s) scanned`, body carrying the funnel and up to 10 candidates with permalinks
- [ ] Every candidate permalink in the heartbeat resolves to a real threads.com post
- [ ] With a match, the run sends the job digest and **not** the heartbeat
- [ ] With `GMAIL_*` unset, a zero-match run logs `heartbeat: not sent — …` and still exits 0 (the README quick-start keeps working)
- [ ] With `HEARTBEAT_ENABLED=false`, a zero-match run logs `heartbeat: disabled by HEARTBEAT_ENABLED` and sends nothing
- [ ] The heartbeat email arrives in the inbox, not in spam, at the chosen cadence

---

## Phase 10: JSON config + URL surfaces

### Overview

Makes `watcher.config.json` the single source of truth for what the watcher watches and how it filters, and widens "what it watches" from tag pages to any threads.com URL. The operator edits one committed JSON file to add a keyword, a candidate term, a tag, a profile page, or a search URL — no code change, no Actions variable, no redeploy beyond the push.

Two measured facts drive the URL surfaces (probed 2026-10-25, logged-out, residential IP):

| Surface | Posts extracted | Hydration | "Recent" tab |
|---|---|---|---|
| `/tag/hiring` (Phases 1–7 path) | 19 | `data-sjs` blobs | present (Top is default) |
| `/@hiresflow` (profile) | 8 | `data-sjs` blobs | absent |
| `/search?q=hiring&serp_type=deeplink&filter=recent` | 14 | `data-sjs` blobs | absent |

Both new URL shapes hydrate through the **same `data-sjs` blobs** the tag pages use, so the fetch strategy is unchanged — only the URL changes. Neither carries a "Recent" tab, which the authenticated path already tolerates. The profile is "Hires flow - Loker IT & Desain 🇮🇩", an Indonesian IT job account: exactly the source the tag feed lacks, given the 2026-10-25 measurement of 59 unique tag posts with zero dev-term posts.

This phase is additive in behavior and subtractive in configuration surface. It **retires** `THREADS_TAGS` and `RECENCY_HOURS` as environment variables, and **deletes** `KEYWORDS`, `DEFAULT_TAGS`, `resolveTags`, `tagPageUrl`, `DEFAULT_RECENCY_HOURS` and `resolveRecencyHours` from `src/config.ts`. The keyword list, the heartbeat candidate net, the surface list and the recency window all move into the JSON.

A missing or malformed `watcher.config.json` **fails the run loudly**. A silent fallback to built-in defaults would let a typo keep watching the wrong thing, which is the failure mode this phase exists to remove.

### Changes Required:

#### 1. watcher.config.json — NEW
**File**: `watcher.config.json`
**Changes**: The source of truth. Committed, hand-edited, never written by a run. Ships with the three tags (typo corrected to `loker`), the profile URL and the search URL the operator supplied, the current keyword list, the current heartbeat candidate net, and the 72-hour recency window.

```json
{
  "keywords": [
    "frontend", "front-end", "front end",
    "fullstack", "full-stack", "full stack",
    "web developer", "web dev",
    "react", "vue", "next.js", "nextjs", "nuxt",
    "angular", "svelte", "typescript", "javascript",
    "node.js", "nodejs"
  ],
  "candidateTerms": [
    "developer", "programmer", "software", "engineer", "frontend", "front-end",
    "fullstack", "full-stack", "react", "vue", "next.js", "nextjs", "typescript",
    "javascript", "node.js", "nodejs", "web dev", "it support", "teknisi",
    "coding", "coder",
    "indonesia", "jakarta", "jogja", "yogyakarta", "surabaya", "bandung",
    "medan", "semarang", "bali", "denpasar", "makassar", "palembang", "bekasi",
    "tangerang", "depok", "bogor", "malang", "solo",
    "remote", "wfh", "work from home"
  ],
  "surfaces": [
    { "type": "tag", "value": "hiring" },
    { "type": "tag", "value": "loker" },
    { "type": "tag", "value": "infokerja" },
    { "type": "url", "value": "https://www.threads.com/@hiresflow" },
    { "type": "url", "value": "https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent" }
  ],
  "recencyHours": 72
}
```

`type` is a discriminated union: `tag` builds `https://www.threads.com/tag/<value>`; `url` is used verbatim and must be an absolute `https://www.threads.com/...` URL. An unknown `type`, a non-threads.com URL, an empty `value`, an empty `surfaces` array, an empty `keywords` array, a non-array `candidateTerms`, a non-positive `recencyHours`, or any unrecognized top-level key all fail validation with a message that names the offending key and lists the allowed ones. Unknown-key rejection is deliberate: it catches `"keyword"` for `"keywords"`, which would otherwise silently watch nothing.

#### 2. src/config-file.ts — NEW
**File**: `src/config-file.ts`
**Changes**: Load, parse and validate `watcher.config.json`. Exports the `Surface` and `WatcherConfig` types, `loadWatcherConfig`, and `resolveSurfaces`.

```ts
/**
 * watcher.config.json — the source of truth for what the watcher watches.
 *
 * The operator edits this one committed file to add a keyword, a candidate
 * term, a tag, a profile page or a search URL. No code change and no Actions
 * variable is involved. A missing or malformed file fails the run loudly: a
 * silent fallback to built-in defaults would let a typo keep watching the
 * wrong thing, which is the failure mode this module exists to remove.
 */
import { readFile } from "node:fs/promises";
import { CONFIG_PATH } from "./config.js";

/** One surface to sample. `tag` builds the tag-page URL; `url` is verbatim. */
export type Surface =
  | { type: "tag"; value: string }
  | { type: "url"; value: string };

/** A surface resolved to the URL Playwright loads, plus its log label. */
export interface ResolvedSurface {
  /** Log label: `tag/hiring`, or the full URL for a `url` surface. */
  label: string;
  /** Absolute URL to load. */
  url: string;
}

/** Shape of watcher.config.json. */
export interface WatcherConfig {
  keywords: string[];
  candidateTerms: string[];
  surfaces: Surface[];
  recencyHours: number;
}

const ALLOWED_KEYS = [
  "keywords",
  "candidateTerms",
  "surfaces",
  "recencyHours",
] as const;

const THREADS_HOST = "www.threads.com";

/**
 * Read and validate the config file. Throws with the path and the offending
 * key when the file is missing, unparsable, or fails any rule below.
 */
export async function loadWatcherConfig(
  filePath: string = CONFIG_PATH,
): Promise<WatcherConfig> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "unknown";
    throw new Error(
      `config: cannot read ${filePath} (${code}) — this file is the source of truth for surfaces, keywords, candidate terms and the recency window`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`config: ${filePath} is not valid JSON: ${message}`);
  }

  return validateConfig(parsed, filePath);
}

function validateConfig(parsed: unknown, filePath: string): WatcherConfig {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`config: ${filePath} must contain a JSON object`);
  }
  const record = parsed as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `config: ${filePath} has unknown key "${key}" — allowed keys: ${ALLOWED_KEYS.join(", ")}`,
      );
    }
  }

  const keywords = readStringArray(record["keywords"], "keywords", filePath, true);
  const candidateTerms = readStringArray(
    record["candidateTerms"],
    "candidateTerms",
    filePath,
    false,
  );
  const surfaces = readSurfaces(record["surfaces"], filePath);
  const recencyHours = readRecencyHours(record["recencyHours"], filePath);

  return { keywords, candidateTerms, surfaces, recencyHours };
}

function readStringArray(
  value: unknown,
  key: string,
  filePath: string,
  requireNonEmpty: boolean,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`config: ${filePath} "${key}" must be an array`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(
        `config: ${filePath} "${key}" must contain only non-empty strings`,
      );
    }
    out.push(item);
  }
  if (requireNonEmpty && out.length === 0) {
    throw new Error(`config: ${filePath} "${key}" must not be empty`);
  }
  return out;
}

function readSurfaces(value: unknown, filePath: string): Surface[] {
  if (!Array.isArray(value)) {
    throw new Error(`config: ${filePath} "surfaces" must be an array`);
  }
  if (value.length === 0) {
    throw new Error(`config: ${filePath} "surfaces" must not be empty`);
  }
  const out: Surface[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(
        `config: ${filePath} "surfaces" entries must be objects with a "type" and a "value"`,
      );
    }
    const entry = item as Record<string, unknown>;
    const type = entry["type"];
    const surfaceValue = entry["value"];
    if (type !== "tag" && type !== "url") {
      throw new Error(
        `config: ${filePath} surface "type" must be "tag" or "url", got ${JSON.stringify(type)}`,
      );
    }
    if (typeof surfaceValue !== "string" || surfaceValue.trim().length === 0) {
      throw new Error(
        `config: ${filePath} surface "value" must be a non-empty string`,
      );
    }
    if (type === "url") {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(surfaceValue);
      } catch {
        throw new Error(
          `config: ${filePath} surface "value" is not an absolute URL: ${surfaceValue}`,
        );
      }
      if (parsedUrl.protocol !== "https:" || parsedUrl.host !== THREADS_HOST) {
        throw new Error(
          `config: ${filePath} surface URL must be https://${THREADS_HOST}/... — got ${surfaceValue}`,
        );
      }
    }
    out.push({ type, value: surfaceValue });
  }
  return out;
}

function readRecencyHours(value: unknown, filePath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `config: ${filePath} "recencyHours" must be a positive number`,
    );
  }
  return Math.floor(value);
}

/** Resolve configured surfaces to the URLs Playwright loads. */
export function resolveSurfaces(
  surfaces: readonly Surface[],
): ResolvedSurface[] {
  return surfaces.map((surface) =>
    surface.type === "tag"
      ? { label: `tag/${surface.value}`, url: tagPageUrlFor(surface.value) }
      : { label: surface.value, url: surface.value },
  );
}

/** Tag-page URL. Kept local so src/config.ts no longer owns surface policy. */
function tagPageUrlFor(tag: string): string {
  return `https://www.threads.com/tag/${encodeURIComponent(tag)}`;
}
```

#### 3. src/config.ts — MODIFY
**File**: `src/config.ts`
**Changes**: Delete `KEYWORDS`, `DEFAULT_TAGS`, `resolveTags`, `tagPageUrl`, `DEFAULT_RECENCY_HOURS`, `resolveRecencyHours`, and the `threadsTags` / `recencyHours` entries in `ENV_NAMES`. Add `CONFIG_PATH`. `isHeartbeatEnabled`, `runUrlFromEnv`, `STATE_PATH` and the remaining `ENV_NAMES` entries are unchanged.

```ts
/** Commit-back location of the seen-state file (FRD #6). */
export const STATE_PATH = "state/seen-posts.json";

/**
 * Location of the JSON source of truth for surfaces, keywords, candidate
 * terms and the recency window. Committed and hand-edited; never written
 * by a run. A missing or malformed file fails the run (src/config-file.ts).
 */
export const CONFIG_PATH = "watcher.config.json";
```

#### 4. src/keywords.ts — MODIFY
**File**: `src/keywords.ts`
**Changes**: `keywords` becomes a required parameter on both exports — there is no built-in list any more, because the JSON is the only source. Drop the `KEYWORDS` import.

```ts
export function matchesKeywords(
  text: string,
  keywords: readonly string[],
): boolean {
  if (text.length === 0 || keywords.length === 0) {
    return false;
  }
  const normalizedText = text.toLowerCase();
  for (const keyword of keywords) {
    const trimmed = keyword.trim().toLowerCase();
    if (trimmed.length > 0 && normalizedText.includes(trimmed)) {
      return true;
    }
  }
  return false;
}

export function filterPostsByKeywords(
  posts: readonly Post[],
  keywords: readonly string[],
): Post[] {
  return posts.filter((post) => matchesKeywords(post.text, keywords));
}
```

#### 5. src/heartbeat.ts — MODIFY
**File**: `src/heartbeat.ts`
**Changes**: Delete the module-level `CANDIDATE_TERMS` array. `matchesCandidateTerms` and `selectCandidates` take the term list as a parameter, sourced from the JSON.

```ts
/** True when the text mentions any candidate term (case-insensitive). */
export function matchesCandidateTerms(
  text: string,
  terms: readonly string[],
): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

/**
 * Pick the posts worth a human look: every keyword maybe first (strongest
 * signal), then the newest near-misses, capped at `limit`.
 */
export function selectCandidates(
  recent: readonly Post[],
  maybes: readonly Post[],
  terms: readonly string[],
  limit: number = MAX_CANDIDATES,
): Candidate[] {
  const out: Candidate[] = maybes.map((post) => ({
    post,
    reason: "maybe" as const,
  }));
  if (out.length >= limit) return out.slice(0, limit);

  const maybeIds = new Set(maybes.map((post) => post.id));
  const nearMisses = recent
    .filter(
      (post) =>
        !maybeIds.has(post.id) && matchesCandidateTerms(post.text, terms),
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  for (const post of nearMisses) {
    if (out.length >= limit) break;
    out.push({ post, reason: "near-miss" });
  }
  return out;
}
```

#### 6. src/fetch-threads.ts — MODIFY
**File**: `src/fetch-threads.ts`
**Changes**: Both fetch entry points take `ResolvedSurface[]` instead of `string[]` tags and load `surface.url` instead of `tagPageUrl(tag)`. `SurfaceFetch` carries `label` instead of `tag`. Drop the `tagPageUrl` import. The Recent-tab attempt stays best-effort for every surface, but the log level now reflects expectation: a `tag` surface missing its Recent tab is a warning (the tag page should have one), a `url` surface missing it is informational (the URL already encodes its own view — a `filter=recent` search URL is recent by construction).

```ts
/** Rendered HTML for one surface, ready for extractPosts(). */
export interface SurfaceFetch {
  label: string;
  html: string;
}

/**
 * Fetch every configured surface and return the successes in input order.
 * Throws when every surface fails (message lists per-surface errors).
 */
export async function fetchSurfaces(
  surfaces: readonly ResolvedSurface[],
): Promise<SurfaceFetch[]> {
  // body unchanged from fetchTagPages except: iterate `surfaces`, push
  // { label: surface.label, html: ... }, and log `fetch: ${surface.label} OK`
}

/**
 * Fetch posts from the configured surfaces with an authenticated session.
 * Same XHR-capture and scroll strategy as Phase 8; the Recent-tab click is
 * best-effort because profile and search surfaces have no such tab.
 */
export async function fetchSurfacesAuthenticated(
  surfaces: readonly ResolvedSurface[],
  storageStatePath: string,
): Promise<Post[]> {
  // body unchanged from fetchTagPostsAuthenticated except: iterate
  // `surfaces`, use surface.url for page.goto, and use surface.label in
  // every log line and failure message
}
```

#### 7. src/index.ts — MODIFY
**File**: `src/index.ts`
**Changes**: Load the config once at startup, resolve surfaces, and thread `keywords`, `candidateTerms` and `recencyHours` from it. The `resolveTags` and `resolveRecencyHours` calls are gone.

```ts
async function main(): Promise<void> {
  const startedAt = new Date();
  const config = await loadWatcherConfig();
  const surfaces = resolveSurfaces(config.surfaces);
  console.log(`watch: surfaces: ${surfaces.map((s) => s.label).join(", ")}`);

  const sessionPath = await resolveSession(process.env);
  const collected: Post[] =
    sessionPath !== null
      ? await fetchSurfacesAuthenticated(surfaces, sessionPath)
      : await fetchLoggedOutPosts(surfaces);
  const posts = dedupePosts(collected);
  console.log(
    `extract: ${posts.length} unique post(s) across ${surfaces.length} surface(s)`,
  );

  const recencyHours = config.recencyHours;
  const recent = filterRecent(posts, recencyHours);
  console.log(`recency: ${recent.length} post(s) within ${recencyHours}h`);

  // … runUrl, stats, state, unchanged …

  const maybes = filterPostsByKeywords(newPosts, config.keywords);
  // … judge, unchanged …

  if (matches.length === 0) {
    await heartbeat(stats, recent, maybes, config.candidateTerms);
    console.log("no new matches");
    return;
  }
  // … digest and state commit, unchanged …
}

/** Logged-out path: blob extraction per surface, in input order. */
async function fetchLoggedOutPosts(
  surfaces: readonly ResolvedSurface[],
): Promise<Post[]> {
  const fetched = await fetchSurfaces(surfaces);
  const posts: Post[] = [];
  for (const surface of fetched) {
    const extracted = extractPosts(surface.html);
    console.log(`extract: ${surface.label}: ${extracted.length} post(s)`);
    posts.push(...extracted);
  }
  return posts;
}
```

The `heartbeat()` helper gains a fourth parameter and forwards it:

```ts
async function heartbeat(
  stats: HeartbeatStats,
  recent: readonly Post[],
  maybes: readonly Post[],
  candidateTerms: readonly string[],
): Promise<void> {
  // … kill switch and try/catch unchanged …
    const candidates = selectCandidates(recent, maybes, candidateTerms);
    await sendHeartbeat(stats, candidates, config);
  // …
}
```

New imports for `src/index.ts`:

```ts
import { loadWatcherConfig, resolveSurfaces, type ResolvedSurface } from "./config-file.js";
import {
  fetchSurfaces,
  fetchSurfacesAuthenticated,
} from "./fetch-threads.js";
```

#### 8. .github/workflows/watch.yml — MODIFY
**File**: `.github/workflows/watch.yml`
**Changes**: Remove the `THREADS_TAGS` and `RECENCY_HOURS` env entries from the watcher step. Both now live in `watcher.config.json`, which the checkout already provides. Every other step is unchanged.

```yaml
      - name: Run watcher
        env:
          THREADS_SESSION_STATE: ${{ secrets.THREADS_SESSION_STATE }}
          LLM_BASE_URL: ${{ secrets.LLM_BASE_URL }}
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
          LLM_MODEL: ${{ secrets.LLM_MODEL }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: npx tsx src/index.ts
```

#### 9. README.md — MODIFY
**File**: `README.md`
**Changes**: Add a "Configure what to watch" section documenting `watcher.config.json` as the source of truth, with the surface `type` union and the edit-then-push workflow. Remove `THREADS_TAGS` and `RECENCY_HOURS` from the optional-variables line. Fix the `lowker` typo. Rewrite `## Pipeline` step 1 to name the JSON as the surface source.

````markdown
## Configure what to watch

Everything the watcher samples and how it filters lives in
[`watcher.config.json`](./watcher.config.json). Edit that file, commit, push —
no code change and no Actions variable is involved.

| Key | What it does |
|---|---|
| `surfaces` | What to sample. Each entry is `{ "type": "tag", "value": "hiring" }` or `{ "type": "url", "value": "https://www.threads.com/@someone" }`. Tags build `threads.com/tag/<value>`; URLs are used verbatim and must be `https://www.threads.com/...`. |
| `keywords` | Pre-filter. A post must contain one of these to reach the judge. |
| `candidateTerms` | The wider net that picks the "closest candidates" listed in the zero-match status email. |
| `recencyHours` | How far back a post can be and still count. Default `72`. |

Adding a profile or a search URL is the same edit as adding a tag:

```json
{ "type": "url", "value": "https://www.threads.com/search?q=frontend&serp_type=deeplink&filter=recent" }
```

A missing file, a typo in a key, an unknown surface `type`, or a
non-threads.com URL stops the run with an error that names the problem — the
watcher never silently falls back to a built-in list.
````

And in `## Pipeline`, replace step 1:

```markdown
1. Playwright loads every surface listed in `watcher.config.json` — tag pages,
   profile pages and search URLs. With `THREADS_SESSION_STATE` set it signs in,
   clicks the **Recent** tab where one exists, and reads posts from the
   `graphql` XHR responses; otherwise it loads each surface logged out and
   reads posts from the embedded `data-sjs` JSON blobs.
```

And the optional-variables line becomes:

```markdown
Optional variable (not a secret): none — surfaces, keywords, candidate terms
and the recency window are all configured in `watcher.config.json`.
```

#### 10. tests/config-file.test.ts — NEW
**File**: `tests/config-file.test.ts`
**Changes**: Validation rules, the happy path against the real committed file, and surface resolution. Scratch fixtures are written under the OS temp dir and removed in an `after()` hook.

```ts
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  loadWatcherConfig,
  resolveSurfaces,
} from "../src/config-file.js";

const VALID = {
  keywords: ["react"],
  candidateTerms: ["developer"],
  surfaces: [{ type: "tag", value: "hiring" }],
  recencyHours: 72,
};

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function writeConfig(value: unknown): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-config-"));
  const path = join(dir, "watcher.config.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

describe("loadWatcherConfig — happy path", () => {
  it("loads the committed config file", async () => {
    const config = await loadWatcherConfig("watcher.config.json");
    assert.ok(config.keywords.length > 0);
    assert.ok(config.surfaces.length > 0);
    assert.equal(config.recencyHours, 72);
  });

  it("keeps every configured surface", async () => {
    const config = await loadWatcherConfig("watcher.config.json");
    const tags = config.surfaces.filter((s) => s.type === "tag");
    const urls = config.surfaces.filter((s) => s.type === "url");
    assert.ok(tags.length >= 3);
    assert.ok(urls.length >= 2);
  });
});

describe("loadWatcherConfig — failures", () => {
  it("throws when the file is missing", async () => {
    await assert.rejects(
      () => loadWatcherConfig("watcher.config.does-not-exist.json"),
      /source of truth/,
    );
  });

  it("throws when the file is not JSON", async () => {
    const path = await writeConfig("{ not json");
    await assert.rejects(() => loadWatcherConfig(path), /is not valid JSON/);
  });

  it("rejects an unknown top-level key", async () => {
    const path = await writeConfig({ ...VALID, keyword: ["react"] });
    await assert.rejects(() => loadWatcherConfig(path), /unknown key "keyword"/);
  });

  it("rejects an empty surfaces array", async () => {
    const path = await writeConfig({ ...VALID, surfaces: [] });
    await assert.rejects(() => loadWatcherConfig(path), /surfaces.*must not be empty/);
  });

  it("rejects an empty keywords array", async () => {
    const path = await writeConfig({ ...VALID, keywords: [] });
    await assert.rejects(() => loadWatcherConfig(path), /keywords.*must not be empty/);
  });

  it("rejects an unknown surface type", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "profile", value: "hiresflow" }],
    });
    await assert.rejects(() => loadWatcherConfig(path), /surface "type" must be/);
  });

  it("rejects a non-threads.com URL", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "url", value: "https://example.com/feed" }],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /must be https:\/\/www\.threads\.com/,
    );
  });

  it("rejects a relative URL", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "url", value: "/@hiresflow" }],
    });
    await assert.rejects(() => loadWatcherConfig(path), /not an absolute URL/);
  });

  it("rejects a non-positive recencyHours", async () => {
    const path = await writeConfig({ ...VALID, recencyHours: 0 });
    await assert.rejects(() => loadWatcherConfig(path), /recencyHours.*positive/);
  });

  it("allows an empty candidateTerms array", async () => {
    const path = await writeConfig({ ...VALID, candidateTerms: [] });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.candidateTerms, []);
  });
});

describe("resolveSurfaces", () => {
  it("builds the tag-page URL and label", () => {
    const resolved = resolveSurfaces([{ type: "tag", value: "hiring" }]);
    assert.deepEqual(resolved, [
      { label: "tag/hiring", url: "https://www.threads.com/tag/hiring" },
    ]);
  });

  it("uses a url surface verbatim", () => {
    const url = "https://www.threads.com/@hiresflow";
    const resolved = resolveSurfaces([{ type: "url", value: url }]);
    assert.deepEqual(resolved, [{ label: url, url }]);
  });

  it("percent-encodes a tag that needs it", () => {
    const resolved = resolveSurfaces([{ type: "tag", value: "a b" }]);
    assert.equal(resolved[0]?.url, "https://www.threads.com/tag/a%20b");
  });
});
```

#### 11. tests/keywords.test.ts — MODIFY
**File**: `tests/keywords.test.ts`
**Changes**: Every `matchesKeywords(text)` and `filterPostsByKeywords(posts)` call passes an explicit keyword list, because there is no built-in default any more. Add one case that loads the real `watcher.config.json` and asserts the shipped list rejects the non-tech posts in `tests/fixture/tag-page.html` — that is the regression the old default-parameter tests used to cover.

```ts
import { loadWatcherConfig } from "../src/config-file.js";

const CONFIG = await loadWatcherConfig("watcher.config.json");

describe("matchesKeywords with the shipped config", () => {
  it("rejects the non-tech hiring posts in the tag-page fixture", () => {
    assert.equal(matchesKeywords("HIRING ‼️ Barista Waiter", CONFIG.keywords), false);
    assert.equal(matchesKeywords("HIRING!! CHATTER VA", CONFIG.keywords), false);
    assert.equal(
      matchesKeywords("Safety, Health and Environmental Officer", CONFIG.keywords),
      false,
    );
  });

  it("accepts a frontend posting", () => {
    assert.equal(
      matchesKeywords("Hiring React developer in Jakarta", CONFIG.keywords),
      true,
    );
  });
});
```

#### 12. tests/heartbeat.test.ts — MODIFY
**File**: `tests/heartbeat.test.ts`
**Changes**: `selectCandidates` and `matchesCandidateTerms` take the term list. Every call site passes an explicit list.

```ts
const TERMS = ["developer", "software", "engineer", "jakarta", "remote"];

// selectCandidates(recent, maybes, TERMS, 10)
// matchesCandidateTerms(text, TERMS)
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit` exits 0
- [x] Config-file suite passes: `npx tsx --test tests/config-file.test.ts` exits 0
- [x] Full suite passes: `npm test` exits 0 (extract + keywords + email + recency + session + heartbeat + config-file)
- [x] Keyword regression: `npx tsx --test tests/keywords.test.ts` exits 0 — the required-parameter change breaks no locked consumer
- [x] Heartbeat regression: `npx tsx --test tests/heartbeat.test.ts` exits 0 — the term-list parameter breaks no locked consumer
- [x] Committed config validates: `npx tsx --input-type=module -e 'import assert from "node:assert/strict"; import { loadWatcherConfig } from "./src/config-file.js"; const c = await loadWatcherConfig("watcher.config.json"); assert.ok(c.keywords.length > 0); assert.ok(c.surfaces.length >= 5); assert.equal(c.recencyHours, 72);'` exits 0
- [x] Missing config fails loudly: `npx tsx --input-type=module -e 'import assert from "node:assert/strict"; import { loadWatcherConfig } from "./src/config-file.js"; await assert.rejects(() => loadWatcherConfig("nope.json"), /source of truth/);'` exits 0
- [x] THREADS_TAGS fully retired: `grep -rc "THREADS_TAGS" src .github README.md` returns 0 across all three
- [x] RECENCY_HOURS fully retired: `grep -rc "RECENCY_HOURS" src .github README.md` returns 0 across all three
- [x] Typo fixed: `grep -rc "lowker" src README.md watcher.config.json` returns 0; `grep -c "loker" watcher.config.json` returns 1 or more
- [x] Both operator URLs configured: `grep -c "hiresflow" watcher.config.json` returns 1; `grep -c "serp_type=deeplink" watcher.config.json` returns 1
- [x] Surface union wired: `grep -c "fetchSurfacesAuthenticated" src/index.ts` returns 1 or more; `grep -c "fetchSurfaces" src/fetch-threads.ts` returns 2 or more
- [x] No built-in lists left: `grep -c "KEYWORDS\|DEFAULT_TAGS\|DEFAULT_RECENCY_HOURS" src/config.ts` returns 0 — the JSON is the only source
- [x] Secret hygiene: `grep -rniE "password|api_key|sessionid" src tests .github README.md watcher.config.json` matches only env-var NAME constants and README placeholder mentions — never secret values

#### Manual Verification:
- [ ] A local run logs one line per configured surface — `fetch: tag/hiring OK`, `fetch: tag/loker OK`, `fetch: tag/infokerja OK`, `fetch: https://www.threads.com/@hiresflow OK`, `fetch: https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent OK` — and `extract: N unique post(s) across 5 surface(s)`
- [ ] The profile surface yields posts (probe measured 8 logged-out) and the search surface yields posts (probe measured 14 logged-out)
- [ ] **Editing only the JSON changes behavior with no code change.** Add one keyword to `watcher.config.json`, re-run locally, and confirm the `keywords: N maybes` count moves. Then add one URL surface, re-run, and confirm the new surface appears in the log and its posts reach the funnel. Revert both.
- [ ] **Editing only the JSON changes the recency window.** Set `recencyHours` to `24`, re-run, and confirm the `recency: N post(s) within 24h` line drops relative to 72. Revert.
- [ ] A typo in the JSON stops the run with an error naming the key — rename `keywords` to `keyword`, run `npm start`, confirm the non-zero exit and the `unknown key "keyword"` message. Revert.
- [ ] With `THREADS_SESSION_STATE` seeded, the authenticated run handles the two URL surfaces without failing — neither has a "Recent" tab, so the run must log the informational fallback line and still extract posts (Phase 8 smoke gate, extended to URL surfaces)
- [ ] Actions dispatch with the secret seeded: all five surfaces return posts from datacenter IPs, including the profile and the search URL
- [ ] README quick-start still works top-to-bottom on a fresh clone

---
## Testing Strategy

### Automated:
- Per-phase automated verification commands are embedded in each phase's Success Criteria (passed through verbatim from the design's `## Slices`).
- Project baseline: `npm test` (`tsx --test tests/*.test.ts`) and `npx tsc --noEmit`.
- Phase 8: `npx tsx --test tests/recency.test.ts tests/session.test.ts` plus the graphql-fixture case in `tests/extract.test.ts`.
- Phase 10: `npx tsx --test tests/config-file.test.ts` plus the shipped-config cases in `tests/keywords.test.ts`.

### Manual Testing Steps:
1. Bot-detection smoke gate: push to the public repo, trigger workflow_dispatch, confirm per-surface post counts > 0 and a green run (design Verification Notes).
2. With GMAIL_* secrets seeded, a match run delivers the plain-text digest; an immediate second dispatch sends nothing and logs "no new matches".
3. State commit appears authored by github-actions[bot] with message "state: N new seen post ids", only on match runs.
4. README quick-start works top-to-bottom on a fresh clone.
5. With THREADS_SESSION_STATE seeded, a local run logs Recent-tab per-surface counts well above the logged-out ~19 and a recency line; with the secret unset the logged-out path runs unchanged.
6. Actions dispatch with the secret seeded: Recent-tab counts > 0 from datacenter IPs (Phase 8 smoke gate — the logged-in path is untested from Actions IPs).
7. Zero-match heartbeat (Phase 9): with `GMAIL_*` seeded and no match, a run delivers the status email with the funnel and candidate permalinks; every permalink resolves; a match run sends the digest and not the heartbeat; with `GMAIL_*` unset the run still exits 0; with `HEARTBEAT_ENABLED=false` nothing is sent.
8. JSON config is the source of truth (Phase 10): a local run logs one line per configured surface across all five; the profile and search URL surfaces each yield posts; adding a keyword, a candidate term, a URL surface or a recency change in `watcher.config.json` alone moves the run's behavior with no code change; a typo in the JSON stops the run with an error naming the key; with `THREADS_SESSION_STATE` seeded the authenticated run handles the two URL surfaces, which have no "Recent" tab, without failing.

## Performance Considerations

- Logged-out run 2-3 min: browser launch ~2-4s; 3 surfaces × goto+wait ~15-45s total (one browser instance, new page per surface); extraction <1s; LLM one call per maybe-post (1-2s each); SMTP ~1-2s; git commit ~2-5s.
- Authenticated run ~3-5 min: per surface goto + Recent click ~10s, up to 8 scroll rounds × ~2.5s ≈ 20s, XHR parsing <1s; 3 surfaces ≈ 90-120s total; the rest as above.
- Post volume grows ~5× (measured 92 vs 19 on /tag/hiring); the recency filter (default 72h) trims it before dedupe, and the keyword filter still bounds LLM calls to maybes. MAX_POSTS_PER_SURFACE = 150 caps memory and runtime per surface.
- timeout-minutes: 10 absorbs rare apt outliers (8-11 min documented) without nearing the 360-min default.
- LLM cost bounded: keywords trim the ~20-80 post feed to maybes; at most two calls (one retry) per maybe per run; parse-failed posts are not retried beyond one attempt.
- No N+1: extraction is in-memory JSON walking; no per-post HTTP beyond the single LLM call.

## Migration Notes

Greenfield — no existing data. The state file carries `version: 1` for future schema migrations (a version-keyed migration function in state.ts). Rollback for a bad run is `git revert` of the state commit; the atomic write means a crashed run cannot leave a partial file.

## Developer Context

**Step 3 code-provenance decision (2026-10-25):** the design's Architecture shows the final version of `src/types.ts` and `src/config.ts`, while the slices split them (Slice 1 creates; Slices 2 and 3 modify). The pre-modification code is not in the design. Developer decision: Phase 1 ships both files in final form; Phases 2 and 3 carry them as verification-only touches (their slice criteria pass as created). No code was invented.

**Frontmatter note (2026-10-25):** the invocation metadata named repo `pi-model-router` / commit `dbf8b208`, but this working directory (`H:/fork/loker-watcher`) has no git repository (`git rev-parse` fails) and the design artifact records `no-commit` / `no-branch` / `unknown`. The plan carries the design artifact's values.

**Phase 8 revision (2026-10-25, user feedback):** the user asked for Threads credentials "because it will got more content", plus "must pick from recent post". Live probes with a real session (exported from the user's Firefox via pire-browser, residential IP) measured: logged-out tag pages 19/21/18 posts, median age ~23 days, 0 posts ≤72h; logged-in default Top view 1 post (594h old); logged-in Recent tab + scroll + graphql XHR capture 92 unique posts on /tag/hiring, median age 0h, 83 ≤24h, 89 ≤72h, one 122-day outlier. The logged-in page hydrates through graphql XHR responses (1 post in the data-sjs blobs vs 92 via XHR), so Phase 8 captures XHR bodies and reuses the extractor's thread_items walk. Session transport: base64 Playwright storageState in the THREADS_SESSION_STATE secret (account-equivalent; never committed; OS temp file at run time). Recency default 72h (RECENCY_HOURS override). The Actions-IP behavior of the logged-in path is unverified — Phase 8's smoke gate covers it.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents, plus orchestrator verification against a scratch build of the plan's own code. Findings triaged at Step 5._

| source   | plan-loc           | codebase-loc | severity | dimension             | finding | recommendation | resolution |
| -------- | ------------------ | ------------ | -------- | --------------------- | ------- | -------------- | ---------- |
| code     | Phase 6 §1 (email.ts) | <n/a>      | blocker  | code-quality          | `messageId: typeof info?.messageId === "string" ? info.messageId : undefined` types as `string \| undefined`, reported as rejected by `exactOptionalPropertyTypes: true` for the optional `messageId?: string`, failing `npx tsc --noEmit` at Phase 6 | Widen `SendDigestResult.messageId` to `string \| undefined`, or omit the key via a conditional spread when the id is absent | dismissed: falsified by orchestrator verification — tsc 5.7.2 compiles email.ts clean; @types/nodemailer exports SentMessageInfo as any, so info is any and the ternary is assignable under exactOptionalPropertyTypes (a minimal repro of the pattern errors TS2375, but the any leak prevents it here) |
| code     | Phase 3 §1 (fetch-threads.ts:59) | <n/a> | blocker | code-quality | `Object.defineProperty(navigator, "webdriver", ...)` inside the `context.addInitScript` callback references the DOM global `navigator`; under the locked tsconfig (`lib: ["ES2023"]`, `types: ["node"]`) tsc reports TS2304 "Cannot find name 'navigator'", so Phase 3's first Automated Verification (`npx tsc --noEmit` exits 0) fails. Found by orchestrator verification, not by the reviewer. The design's Design History records fixing this same error class for the hydration probe (moved to a string expression) but missed this site | Convert the callback to a string expression: `await context.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => undefined });")` — the design's own established pattern. Verified: tsc exits 0 after this change | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md): addInitScript callback converted to a string expression — navigator is a DOM global unavailable under the locked tsconfig (lib ES2023, types node); verified npx tsc --noEmit exits 0 after the change |
| coverage | ## Verification Notes §6 | <n/a>     | blocker  | verification-coverage | "No re-trigger loops: GITHUB_TOKEN pushes do not start new runs — required for the cron design to converge" has no Success Criteria bullet and no code mirror; the Phase 7 trigger greps check cron/workflow_dispatch presence only, and the concurrency guard serializes runs without stopping a cascade | Add a Phase 7 Automated Verification bullet asserting the commit-back uses only the ambient GITHUB_TOKEN (e.g. `grep -ci "personal.access.token\|pat_" .github/workflows/watch.yml` returns 0) plus a manual smoke-gate sub-check confirming the state-commit push spawns no new run | applied: Phase 7 Automated Verification gains a no-PAT grep bullet and Manual Verification gains a no-new-run sub-check, both scoped to .github/workflows/watch.yml |
| code     | Phase 5            | <n/a>       | concern  | actionability         | The two `npx tsx -e '...'` criteria use ESM `import` statements and top-level `await`; tsx evaluates `-e` strings as CJS, so both fail — verified: "Top-level await is currently not supported with the 'cjs' output format" and `Cannot find module './src/state.js'` | Add `--input-type=module` to both invocations (`npx tsx --input-type=module -e '...'` — verified working), or move the checks into a temporary `.ts` script | applied: both Phase 5 criteria now invoke `npx tsx --input-type=module -e '...'` — verified: the commands exit 0 |
| code     | Phase 7 §2 (watch.yml) | <n/a>    | concern  | actionability         | `actions/setup-node@v4` with `cache: npm` and the `npm ci` step both hard-fail without a committed `package-lock.json`; no phase's file list or Success Criteria creates or commits one (README prose only), so the Phase 7 smoke gate fails on first push | Add `package-lock.json` to Phase 7's file list with a criterion such as `git ls-files --error-unmatch package-lock.json` exiting 0 | applied: package-lock.json added to Phase 7's Changes Required and file list, with a `git ls-files --error-unmatch package-lock.json` criterion |
| code     | Phase 4 §3 (keywords.test.ts) | <n/a> | suggestion | code-quality      | `import { KEYWORDS } from "../src/config.js";` is never referenced in the test body (verified: single occurrence, the import line) | Drop the import, or add an assertion that exercises the exported `KEYWORDS` constant | applied: unused KEYWORDS import dropped from the Phase 4 test fence |
| code     | Desired End State  | <n/a>       | suggestion | code-quality          | The promised log line `surface default: 22 items, tags: 19 items, tag/hiring: 24 items → 58 unique posts` matches no output `src/index.ts` emits; it logs `extract: tag/<tag>: N post(s)` and `extract: N unique post(s) across M surface(s)` | Replace the example with the log format Phase 7 §1 actually produces | applied: Desired End State example replaced with the log format src/index.ts emits (`extract: tag/<tag>: N post(s)`; `extract: N unique post(s) across M surface(s)`) |
| code     | Performance Considerations | <n/a> | suggestion | code-quality       | "never more than one LLM call per maybe per run" contradicts `judgePost`'s `for (let attempt = 1; attempt <= 2; attempt += 1)` retry loop, which issues up to two calls per maybe | Restate the bound as "at most two calls (one retry) per maybe per run" | applied: bound restated as "at most two calls (one retry) per maybe per run" |
| coverage | ## Verification Notes §7 | <n/a>     | suggestion | verification-coverage | "No browser caching: actions/cache for Playwright browsers is officially discouraged" has no criterion asserting actions/cache is absent; the only `cache:` in the plan is setup-node's npm cache | Add a Phase 7 Automated Verification bullet `grep -c "actions/cache" .github/workflows/watch.yml` returns 0 | applied: Phase 7 gains a `grep -c "actions/cache" .github/workflows/watch.yml` returns 0 criterion |

### Orchestrator verification notes (Step 4)

A scratch build of the plan's extracted code (typescript 5.7.2, tsx 4.19.2, @types/node 22.10.1, nodemailer 6.9.16, @types/nodemailer 6.4.17, playwright 1.49.1, under the plan's locked tsconfig) was run before triage:

- `npx tsc --noEmit` reports exactly one error: `src/fetch-threads.ts(59,29): TS2304: Cannot find name 'navigator'` (row 2). The reported email.ts blocker (row 1) does not reproduce: `@types/nodemailer` exports `SentMessageInfo` as `any`, so `info` is `any` and the ternary is assignable under `exactOptionalPropertyTypes`. A minimal repro of the reported pattern does error (TS2375), so the reviewer's rule is correct in general but does not bite here.
- `npx tsx --test tests/*.test.ts` — 41/41 pass (8 extract + 18 keywords + 15 email).
- Both Phase 5 `npx tsx -e` criteria fail as written (row 4); `npx tsx --input-type=module -e '...'` passes.
- All grep-based Automated Verification criteria across Phases 1-7 pass as written (`npm pkg get type` = module; DevQHRdD4Bm = 1; ThreadItemRaw = 0; SEARCH_SURFACES/SEARCH_QUERY = 0; THREADS_TAGS = 2; stealth = 0; KEYWORDS = 1; ENV_NAMES = 2; workflow_dispatch = 1; cron = 1; github-actions[bot] = 2; timeout-minutes = 1; concurrency = 1). Secret-hygiene greps match only env-var NAME constants, test fixture strings, and README placeholders.
- `.github/workflows/watch.yml` parses as valid YAML (schedule + workflow_dispatch, permissions contents: write, timeout-minutes 10, 6 steps).
- The row-2 fix (addInitScript as string expression) was applied to the scratch copy and re-verified: `npx tsc --noEmit` exits 0.

## References
- Design: `.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md`
- FRD: `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md`
- Research: `.rpiv/artifacts/research/2026-10-24_14-30-29_threads-hiring-alerts.md`
- Solutions: `.rpiv/artifacts/solutions/explore_threads-hiring-alerts.md`
- Validation: `.rpiv/artifacts/validation/2026-10-25_12-57-04_threads-hiring-alerts.md`

## Revision History

### 2026-10-25T14:36:42+0700 — JSON config as source of truth + URL surfaces (Yogiswara Utama)

Driven by operator feedback: "the likes of candidates, or keyword, or url to watch. should be configurable inside json file. so when i update or add new keyword or url, it will used as the source of truth", with two example URLs to watch and a typo report (`lowker` should be `loker`).

**What the operator asked for.** One committed JSON file that holds the surfaces to watch, the keyword list and the candidate list, so adding a keyword or a URL is a file edit rather than a code change. Plus two new surface shapes: a profile page (`https://www.threads.com/@hiresflow`) and a search URL (`https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent`).

**What the probes measured (2026-10-25, logged-out, residential IP).** Both new URL shapes hydrate through the same `data-sjs` blobs the tag pages use — 8 posts from the profile, 14 from the search URL — so the fetch strategy is unchanged and only the URL differs. Neither carries a "Recent" tab, which the Phase 8 authenticated path already tolerates. The profile is "Hires flow - Loker IT & Desain 🇮🇩", an Indonesian IT job account: the tag feed itself carries none, which the same day's measurement confirmed (59 unique tag posts, zero dev-term posts).

**Phase 10 added.** `watcher.config.json` becomes the source of truth for `surfaces`, `keywords`, `candidateTerms` and `recencyHours`. `src/config-file.ts` loads and validates it; a missing file, an unknown key, an unknown surface `type`, a non-threads.com URL or a non-positive `recencyHours` fails the run with a message naming the problem. `THREADS_TAGS` and `RECENCY_HOURS` are retired as environment variables, and `KEYWORDS`, `DEFAULT_TAGS`, `resolveTags`, `tagPageUrl`, `DEFAULT_RECENCY_HOURS` and `resolveRecencyHours` are deleted from `src/config.ts`. `fetchTagPages` / `fetchTagPostsAuthenticated` become `fetchSurfaces` / `fetchSurfacesAuthenticated` over `ResolvedSurface[]`.

**Four design decisions, confirmed with the operator before editing.**
- All four settings move into the JSON — surfaces, keywords, heartbeat candidate terms, and the recency window.
- `THREADS_TAGS` is deleted rather than kept as an override, so there is exactly one place to edit.
- A missing or malformed config fails the run loudly. A silent fallback to built-in defaults would let a typo keep watching the wrong thing.
- The file is `watcher.config.json` in the repo root.

**Four criteria rewritten because Phase 10 relocates the symbols they grep for.** Left as `- [x]`, each would fail on the post-Phase-10 tree and silently skip work on the next `implement` run:
- Phase 3: `grep -c "THREADS_TAGS" src/config.ts` returns 1 or more → returns 0 (retired).
- Phase 3: the `fetchTagPages(["hiring"])` scratch-script criterion → `fetchSurfaces([...])` (renamed).
- Phase 4: `grep -c "KEYWORDS" src/config.ts` returns 1 or more → `grep -c "frontend" watcher.config.json` (relocated).
- Phase 8: `grep -c "DEFAULT_RECENCY_HOURS" src/config.ts` and `grep -c "RECENCY_HOURS" .github/workflows/watch.yml` → the JSON key and a returns-0 assertion respectively (relocated and retired).
- Phase 8: `grep -c "fetchTagPages" src/index.ts` → `grep -c "fetchSurfaces" src/index.ts` (renamed).

**Typo fixed.** `lowker` → `loker` in the surface list and the README. Safe: `state/seen-posts.json` dedupes by post id, not by surface, so no seen post is lost.

**Not changed:** Phases 1–9 code fences, the extraction and judge logic, the state machine, the heartbeat email format, and every test other than the two whose signatures change. The 2026-10-25 validation verified Phases 1–9 end to end against the shipped tree.

### 2026-10-25T13:59:19+0700 — no-match heartbeat (Yogiswara Utama)
Driven by the operator's question "why does my gmail not receive any email?", answered by measurement rather than assumption.

**What the measurement showed.** Four authenticated runs against the live feed (two on Actions, two local) produced 235–337 unique posts and 277–303 within the 72h window, but **0–1 keyword maybes**. Keyword hits across 235 recent posts: `{}` — not one post named frontend, react, next.js, fullstack, typescript, or any other list entry. The single maybe that did appear (`@rafshadesignstudio`, a Web3 agency ad) was correctly rejected by the judge on `locationOk`: "Eligibility: USA, UK & EU Residents".

A probe of 15 alternative tags (`lokerit`, `lokerjakarta`, `lokerjogja`, `lokerbandung`, `lokersurabaya`, `lowonganit`, `lokerteknologi`, `infotech`, `techjobs`, `lokerprogrammer`, `lokeritindonesia`, `itjobs`, `hiringit`, `lokerremote`, `lokertech`) found no better source: the best carried 22 posts with 3 recent and 0 dev words, and five tags were dead (0 posts). The `#hiring` / `#lowker` / `#infokerja` tags are dominated by overseas agency spam and non-tech Indonesian roles.

**Conclusion.** No email is the correct behavior — the pipeline is not broken, the feed has no Indonesian frontend jobs. Widening `KEYWORDS` cannot help, because there is nothing to widen into. What was missing is *signal*: a silent run told the operator nothing.

**Phase 9 added.** Every zero-match run now emails the scan funnel plus up to 10 closest candidate posts with permalinks, so the operator can judge the feed and click through without opening the Actions log. A match run still sends only the job digest.

**Design decisions.**
- The heartbeat is **best-effort**: a status email that cannot be sent logs a warning and the run still exits 0. The digest stays fail-visible, because a missed job is the product failing while a missed status email is not.
- `src/email.ts` gains a shared `sendText` so both emails resolve credentials once. This also retires the `any` leak the plan review recorded: `sendText` returns `string | undefined` and `sendDigest` attaches `messageId` through a conditional spread, which is assignable under `exactOptionalPropertyTypes: true`.
- `HEARTBEAT_ENABLED` (default true) is the one-line valve. At the `*/10` cron the heartbeat is 144 emails a day; the operator chose that cadence knowingly, and this is how to turn it down without a code change.
- Candidate selection is deliberately broader than `KEYWORDS` (adjacent dev terms, Indonesian cities, remote) so the list is rarely empty, capped at 10, newest first, with keyword maybes always first.

**Not changed:** Phases 1–8 code fences, the workflow, and every existing test. Phase 9 is additive.

### 2026-10-25T13:15:11+0700 — validation-driven correction (Yogiswara Utama)

Driven by `.rpiv/artifacts/validation/2026-10-25_12-57-04_threads-hiring-alerts.md`, which returned `verdict: fail`.

**Phase 8 §5 (`src/fetch-threads.ts`) — code fence replaced.** The shipped fence extracted 0 posts on every surface and then threw. Two timing defects, both measured against a real authenticated session on 2026-10-25:

- `recentTab.count()` was a one-shot probe that returned 0 at hydration-gate time and 1 about 6 seconds later, so the code always fell back to the Top view and received no `thread_items` XHR bodies. Replaced with `recentTab.waitFor({ state: "visible", timeout: RECENT_TAB_TIMEOUT_MS })`.
- The scroll loop broke after one 2.5 s settle, but `posts` is filled by async response handlers, so round 1 always measured +0. Replaced with a `MAX_DRY_SCROLL_ROUNDS = 3` consecutive-dry-round rule.

A scratch replica with only those two timings repaired yielded 68 posts on /tag/hiring from 6 XHR bodies, against 0 as shipped. The all-fail error now also names surfaces that returned zero posts, which previously produced an empty failure list.

**Phase 8 Success Criteria.** Three automated criteria added (Recent-tab wait, dry-round stop, zero-post diagnostics). Two manual criteria marked verified from the 2026-10-25 run (logged-out regression, invalid-secret fallback); the authenticated-count criterion is annotated with its failure and the measured 68-post floor.

**Phase 7 Success Criteria.** One manual criterion added: seed a match so the digest, the `github-actions[bot]` state commit, and the no-new-run check actually run. The only Actions run to date logged `keywords: 0 maybes`, so none of the three has ever been exercised.

**Phase 8 §12 (README).** `## Pipeline` rewritten for the authenticated path; the session-export step documents the `sameSite` conversion Playwright requires, because the raw pire-browser cookie objects are rejected outright.

**Not changed:** Phases 1-7 code fences, the Phase 8 workflow fence, `src/index.ts`, `src/recency.ts`, `src/threads-session.ts`, `src/config.ts`, `src/extract.ts`, and every test fence. The validation run confirmed all of these against the shipped tree.

### 2026-10-25T14:14:27+0700 — reconciliation promoted to a phase step (Yogiswara Utama)

Driven by `.rpiv/artifacts/validation/2026-10-25_14-08-52_threads-hiring-alerts.md`, which returned `verdict: fail` on the Phase 9 working tree.

**What failed.** `npm test` exited 1 — 72 of 73 tests passed. `tests/email.test.ts:262` still asserted `/email: failed to send digest: SMTP connection timeout/`, but Phase 9's `sendText` extraction rethrows as `email: failed to send:`. One failing test broke three criteria: Phase 7's `npm test`, Phase 9's `npm test`, and Phase 9's email regression.

**Why it was missed.** The instruction lived in a `#### Reconciliation` subsection at the bottom of Phase 9, between the Automated and Manual Verification lists. It carried no success criterion of its own, so nothing in the phase's checklist forced it, and the implementer had no signal that it was outstanding.

**Phase 9 §7 added — `tests/email.test.ts` — MODIFY.** The reconciliation is now a numbered Changes Required step with the exact fence, sitting alongside the other five file changes instead of below the criteria. A new automated criterion makes it checkable in isolation: `grep -c "failed to send digest" tests/email.test.ts` returns 0. The `#### Reconciliation` subsection is removed — its content moved up into the step.

**Three statements Phase 9 invalidated, corrected.**
- `## Pipeline` step 7 read "New relevant + located posts are emailed; zero-match runs send nothing", which step 9 contradicts one line later. Now "are emailed as the job digest". Corrected in the two fences that carry it as step 7 (Phases 8 and 9). Phase 7's fence carries the same sentence as step 6, where it was true when written; Phase 9 §6 replaces that whole section, so it stands as the historical record.
- The `## Smoke run` re-run bullet read "sends nothing". A re-run with no match now sends the status digest. Phase 9 §6 previously only *appended* a bullet after it, so the untrue line survived into the shipped README. The fence now replaces it.
- Phase 8's session-suite criterion read "(7 tests)"; the shipped suite — matching the plan's own fence — has 6 `it()` blocks. Corrected to 6.

**Checkbox state.** Phase 7's `npm test`, Phase 9's `npm test` and Phase 9's email regression stay `- [ ]`. They are accurate: the commands fail until §7 lands. The new reconciliation criterion also starts `- [ ]`. No previously-passing criterion was invalidated, so no other checkmark changed.

**Not changed:** any code fence, the workflow, or any test other than the one assertion named above. Phases 1-8 are untouched; the 2026-10-25T13:24:25 validation verified them end to end.
