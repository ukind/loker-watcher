---
date: 2026-10-24T17:18:15+0700
author: Yogiswara Utama
commit: no-commit
branch: no-branch
repository: unknown
topic: "Threads #hiring Indonesia job alerts — full v1 pipeline"
tags: [design, threads, playwright, scraper, github-actions, email, greenfield]
status: ready
parent: .rpiv/artifacts/solutions/explore_threads-hiring-alerts.md
last_updated: 2026-10-24T17:18:15+0700
last_updated_by: Yogiswara Utama
---

# Design: Threads #hiring Indonesia job alerts — full v1 pipeline

## Summary
A single TypeScript CLI (run by tsx, no build step) executes the whole FRD pipeline on GitHub Actions: Playwright loads three logged-out Threads tag pages (configurable via a THREADS_TAGS env var), posts are extracted from the embedded `data-sjs` JSON (not DOM selectors), a keyword pre-filter trims the feed, one OpenAI-compatible LLM call per maybe-post returns `{relevant, locationOk}`, a diff against `state/seen-posts.json` drops already-seen posts, a plain-text Gmail digest is sent when there is at least one new match, and the state file is committed back as `github-actions[bot]`. The repo stays public (unlimited free Actions minutes); all credentials live in Actions secrets.

## Requirements
From the FRD (`.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md`), cadence updated to 10 minutes per the research-stage decision:
1. Fetch the Threads search feed for `#hiring indonesia` on a `*/10 * * * *` cron schedule. (Revised during design: logged-out search returns 0 posts — implemented as configurable tag pages, see D11.)
2. Extract per post: text, author, permalink, timestamp — plus a stable id for dedup.
3. Pre-filter posts by a frontend / fullstack-adjacent keyword set.
4. Pass keyword-matched maybes to an OpenAI-compatible LLM endpoint for a relevance judgment.
5. Drop posts whose location is neither Indonesia nor remote.
6. Persist seen post ids in a state file; exclude them from every later run.
7. Send one plain-text digest email per run listing new matches (text, author, threads.com link).
8. Send no email on runs with zero new matches.
9. Commit the state file back only on runs that found matches.

## Current State Analysis
Greenfield: `H:/fork/loker-watcher` contains only `.pi/` and `.rpiv/` metadata. No git history exists (no `.git`), so no precedent scan was possible. Upstream artifacts: FRD (discover), research report, and the solutions artifact selecting Playwright (Option 1).

### Key Discoveries
- LIVE-PROBED 2026-10-24 (logged-out, Playwright): search surfaces return 0 posts — no post data in initial HTML, rendered DOM, or XHR within 50s. Tag pages deliver 17-19 posts each in rendered data-sjs JSON (/tag/hiring 19, /tag/lowker 17, /tag/infokerja 18; /tag/hiringindonesia and /tag/lowkerindonesia: 0 — too small). Raw curl of a tag page also returns no post data — hydration is mandatory. The earlier ~20-26-posts-per-search claim (dev.to sources) did not reproduce.
- Post data lives in `<script type="application/json" data-sjs>` blobs (Relay/Next-style `ScheduledServerJS` → `thread_items`). Verified fields: `caption.text`, `taken_at` (unix seconds), `id` (`{pk}_{user_pk}`), `pk`, `code`, `user.username`, `like_count`. No stable DOM `data-testid` selectors are documented anywhere — embedded JSON is the evidence-backed extraction route.
- Permalink: `https://www.threads.com/@{username}/post/{code}`; `code` is derivable from `pk` via the Instagram base64url shortcode algorithm (gist sclark39; pk↔code pair confirmed in ScrapFly 2026 output).
- Vanilla headless Playwright with default settings works on threads.com; Meta's own protection is comparatively light; no Cloudflare/DataDome evidence. Stealth plugins can clash (chrome.runtime issues). Behavior from GitHub Actions datacenter IPs specifically is UNTESTED — the Slice 1 smoke gate must verify it.
- GitHub Actions: public repos get unlimited free standard-runner minutes; private = 2,000 Linux-min/month. `contents: write` + github-actions[bot] identity for commit-back; a GITHUB_TOKEN push does not re-trigger workflows. `*/10 * * * *` cron is valid; scheduled runs are best-effort. Playwright browser caching via actions/cache is officially discouraged.
- Public repos auto-disable scheduled workflows after 60 days without repo activity — state commit-backs count as activity, but long no-match stretches need a manual dispatch.

## Scope

### Building
- `src/types.ts` — Post contract and raw Threads JSON shapes (foundation)
- `src/config.ts` — query, tag surfaces (THREADS_TAGS-configurable), keywords, env-var names, state path
- `src/extract.ts` — data-sjs JSON → Post[] with dedupe by pk and permalink reconstruction
- `src/fetch-threads.ts` — Playwright: three configurable tag pages, retry ×3, minimal hardening
- `src/keywords.ts` — case-insensitive keyword pre-filter
- `src/judge.ts` — OpenAI-compatible LLM call per maybe-post, strict-JSON verdict
- `src/state.ts` — load/diff/atomic-write of state/seen-posts.json
- `src/email.ts` — plain-text Gmail digest via nodemailer; zero-match no-send
- `src/index.ts` — CLI pipeline wiring with fail-visible exit codes
- `.github/workflows/watch.yml` — cron + workflow_dispatch, browser install, commit-back
- `state/seen-posts.json` — versioned seed state
- Tests: extract, keywords, email suites + committed HTML fixture
- `README.md` — secrets setup, public-repo requirement, smoke-run instructions

### Not Building
- No web UI or dashboard (FRD non-goal)
- No additional hashtags/queries beyond `#hiring indonesia` (FRD suggested follow-up, deferred)
- No login/session mode for deeper feeds (solutions artifact deferral)
- No other platforms (LinkedIn, etc.)
- No DB — the JSON state file is the only persistence

## Decisions

### D1: Extract from embedded data-sjs JSON, not rendered DOM
**Ambiguity**: solutions artifact said "extract from the rendered DOM".
**Explored**: (A) DOM selectors — no stable data-testid documented for Threads posts; brittle to redeployments. (B) data-sjs JSON blobs — fields verified in 2026 output (ScrapFly guide): `caption.text`, `taken_at`, `pk`, `code`, `user.username`.
**Decision**: (B). Stable field names, no selector maintenance. Evidence: scrapfly.io/blog/posts/how-to-scrape-threads.

### D2: Minimal browser hardening, no stealth plugins
**Ambiguity**: solutions artifact proposed stealth settings; 2026 evidence shows vanilla headless works on threads.com and stealth plugins can clash.
**Decision**: patch `navigator.webdriver` and set a realistic UA/viewport/locale (~10 lines); no playwright-stealth/extra. If the smoke run gets blocked, hardening escalates then — recorded as an escalation path, not built now.

### D3: One LLM call per maybe-post returning strict JSON
**Ambiguity**: FRD left verdict parsing and location derivation open.
**Decision**: keyword maybes get one chat-completions call; prompt demands strict JSON `{"relevant": boolean, "locationOk": boolean}`. Rationale: LLM already sees the post, so location is a second boolean, not a second call; JSON parsing is deterministic. Parse failure after 1 retry → post skipped for this run, NOT written to state, logged visibly (no silent loss, no state corruption).

### D4: Post id = pk; permalink from code
**Decision**: dedup key is the numeric `pk` string. Permalink is `https://www.threads.com/@{author}/post/{code}` using the `code` field; if `code` is missing, derive it from `pk` via the base64url shortcode algorithm (deterministic, verified against a known pair).

### D5: Multi-surface sampling (developer choice; revised in Slice 2)
Tag pages sampled per run — /tag/hiring, /tag/lowker, /tag/infokerja (live-probed 2026-10-24: 19/17/18 posts each) — deduped by pk. Surface failure tolerated while ≥1 succeeds; all-fail fails the run visibly (FRD reliability). Original surface set (2 search URLs + /tag/hiring) revised: both search surfaces returned 0 posts logged-out — see D11.

### D6: Public repository (developer choice)
~11,000 Linux-min/month at */10 with ~2-3 min runs vs 2,000 free private minutes. Public = free unlimited. State file holds only public post ids; secrets stay in Actions secrets.

### D7: TypeScript + tsx (developer choice)
FRD said "Node.js or TypeScript". TS with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; tsx runs directly, no build step.

### D8: State file is atomic and match-gated
Schema `{"version": 1, "seenPostIds": string[]}`. Load → diff → write via temp-file + rename, only when the run has ≥1 new match (FRD #9). A failure before the write leaves the file byte-identical.

### D9: timeout-minutes: 10
Typical run 2-3 min ("well under 6" per FRD). Ceiling 10 rides documented apt-install outliers (8-11 min) while failing fast vs the 360-min default.

### D10: node:test for tests, zero test framework
Node 22 + `tsx --test tests/*.test.ts`. No vitest dependency; assertions via node:assert/strict.

### D11: Surfaces are configurable tag pages (Slice 2 checkpoint, developer decision)
Live logged-out probes (2026-10-24, Playwright, residential IP): both locked search surfaces return 0 posts — no post data in the initial HTML, the rendered DOM, or XHR traffic within 50s. Tag pages deliver 17-19 posts each: /tag/hiring 19, /tag/lowker 17, /tag/infokerja 18; /tag/hiringindonesia and /tag/lowkerindonesia return 0 (tags too small). Raw curl of tag pages also returns no post data, so hydration is mandatory and Playwright stays. Decision: the tag list is configurable via a THREADS_TAGS env var (comma-separated), defaulting to `hiring,lowker,infokerja`. config.ts (locked Slice 1) carries the old SEARCH_SURFACES; its revision folds into Slice 3 alongside fetch-threads.ts.

### D12: ThreadItemRaw retired (Slice 2, slice-verifier finding)
The locked Slice 1 types.ts declared ThreadItemRaw with a wrapper-less shape and a "refined in Slice 2" claim. Real capture evidence shows items nested as { post: ... } and no consumer ever imports the type. Retired in Slice 2: types.ts keeps Post and JudgeVerdict only; the raw-shape documentation lives in extract.ts where it is evidence-backed. Re-verification passed (Decisions OK, Cross-slice OK).

## Architecture

### package.json — NEW
Project manifest: type module, node >=22, runtime deps (playwright, nodemailer), tsx/typescript dev deps, start/test/typecheck scripts.

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

### tsconfig.json — NEW
Strict TS config: NodeNext modules, ES2022 target, noEmit, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes.

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

### src/types.ts — NEW
Post and JudgeVerdict contracts shared by every slice; the raw Threads item shape is documented in src/extract.ts (verified against a real capture, Slice 2).

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

### src/config.ts — NEW
Tag surfaces (THREADS_TAGS-configurable, D11), keyword list, env-var name map, state path. Static data only — no secrets. Revised in Slice 3: SEARCH_SURFACES/SEARCH_QUERY retired (tag pages replace the logged-out search, which returned 0 posts).

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

### src/extract.ts — NEW
Parse rendered HTML → collect data-sjs JSON blobs → walk generically for thread_items arrays → narrow `.post` media objects → map to Post[] → dedupe by pk → build permalinks (code, pk-fallback via codeFromPk). Tolerates missing fields by dropping the item and logging the count.

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

### src/fetch-threads.ts — NEW
Launch one Chromium (webdriver patch + realistic UA/viewport/locale), fetch each tag page, wait until a data-sjs blob carries hydrated thread_items (string-expression probe — no DOM lib under the locked tsconfig), return per-surface HTML; retry ×3 with linear backoff per surface; tolerate single-surface failure; throw when all fail.

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
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

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

### src/keywords.ts — NEW
Case-insensitive keyword pre-filter (FRD #3) matching post text against KEYWORDS from src/config.ts. Exports matchesKeywords and filterPostsByKeywords.

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

### src/judge.ts — NEW
OpenAI-compatible LLM judge (FRD #4, #5, D3) calling /chat/completions via native fetch. Evaluates candidate posts for relevance and Indonesia/remote location with strict JSON output. Retries once on failure; skips unrecoverable posts with visible logging.

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

### src/state.ts — NEW
Persistence state management (FRD #6, #8, #9, D8). Handles load, diff, atomic temp+rename save, and match-gating so disk writes only occur when ≥1 new post matches. Carries version: 1 with migration validation.

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

### src/email.ts — NEW
buildDigest(posts): string — plain text, one block per post (text, author, permalink). sendDigest via nodemailer Gmail SMTP (env credentials). Caller skips send on zero matches.

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

### src/index.ts — NEW
Pipeline wiring: fetch → extract → dedupe vs state → keywords → judge → filter → email → state commit. Fail-visible errors (non-zero exit), logs each stage count.

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

### state/seen-posts.json — NEW
Seed state file initialized with schema version 1 and an empty seenPostIds array.

```json
{
  "version": 1,
  "seenPostIds": []
}
```

### tests/fixture/tag-page.html — NEW
Trimmed REAL logged-out tag page (Playwright capture of /tag/hiring, 2026-10-24; trim rule documented in the file's HTML comment), the extract test's input. Six edges: 4 real posts + 1 pk-duplicate (dedupe) + 1 code-stripped (pk→code fallback) + 1 caption-stripped (drop).

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

### tests/extract.test.ts — NEW
Fixture → expected Post[] (byte-exact first post, capture order); dedupe; missing-field drop; pk→code fallback asserted against real captured codes; unparsable-blob tolerance; empty-input case; codeFromPk vs 5 real pairs.

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

### tests/keywords.test.ts — NEW
Test suite covering keyword matching, case-insensitivity, compound word matching, non-tech rejection, custom keyword list, Post array filtering, LLM verdict parsing, config resolution, and judgePost retry logic with mock fetch.

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KEYWORDS } from "../src/config.js";
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

### tests/email.test.ts — NEW
Digest format (plain text, one link per post); zero-match produces null/empty digest so caller sends nothing. 15 tests across buildSubject, buildDigest, resolveEmailConfig, sendDigest (mock transporter).

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

### .github/workflows/watch.yml — NEW
ubuntu-latest; schedule cron */10 + workflow_dispatch; permissions contents: write; node 22; npm ci; playwright install --with-deps chromium; tsx src/index.ts with env from secrets; commit-back step (github-actions[bot]) only when state changed; timeout-minutes: 10.

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

### README.md — NEW
Setup: required Actions secrets (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, GMAIL_USER, GMAIL_APP_PASSWORD), public-repo rationale, smoke-run instructions (workflow_dispatch), local run steps.

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
- An immediate re-run logs `no new matches` and sends nothing.

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

## Slices

### Slice 1: Scaffold + contracts
**Files**: `package.json`, `tsconfig.json`, `src/types.ts`, `src/config.ts`

#### Automated Verification:
- [ ] `npm install` exits 0 and creates node_modules
- [ ] `npx tsc --noEmit` exits 0
- [ ] `grep -rni "password\|api_key" .` over slice files matches only the env-var NAME constants in src/config.ts (GMAIL_APP_PASSWORD, LLM_API_KEY), never values
- [ ] `npm pkg get type` returns "module"

#### Manual Verification:
- [ ] `npm start` fails only with "Cannot find module src/index.ts" (expected until Slice 7), not a config or dependency error

### Slice 2: Extraction
**Files**: `src/types.ts` (MODIFY — ThreadItemRaw retired), `src/extract.ts`, `tests/fixture/tag-page.html`, `tests/extract.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npx tsc --noEmit` exits 0
- [ ] Extraction suite passes: `npx tsx --test tests/extract.test.ts` exits 0 (8 tests)
- [ ] Fixture carries real capture data: `grep -c "DevQHRdD4Bm" tests/fixture/tag-page.html` returns 1
- [ ] ThreadItemRaw retired: `grep -c "ThreadItemRaw" src/types.ts` returns 0
- [ ] Secret hygiene: `grep -rniE "password|api_key" src tests` matches only env-var NAME constants, never values

#### Manual Verification:
- [ ] Fixture comment documents the trim rule; every retained value traces to the 2026-10-24 logged-out /tag/hiring capture
- [ ] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

### Slice 3: Fetch (Playwright)
**Files**: `src/fetch-threads.ts`, `src/config.ts` (MODIFY — D11 surface revision)

#### Automated Verification:
- [ ] Type checking passes: `npx tsc --noEmit` exits 0
- [ ] Extract regression: `npx tsx --test tests/extract.test.ts` exits 0 (config.ts change breaks no locked consumer)
- [ ] Old search surfaces retired: `grep -c "SEARCH_SURFACES\|SEARCH_QUERY" src/config.ts` returns 0
- [ ] THREADS_TAGS configurable: `grep -c "THREADS_TAGS" src/config.ts` returns 1 or more
- [ ] No stealth plugin (D2): `grep -ci "stealth" src/fetch-threads.ts` returns 0
- [ ] Secret hygiene: `grep -rniE "password|api_key" src tests` matches only env-var NAME constants (LLM_API_KEY, GMAIL_APP_PASSWORD), never values

#### Manual Verification:
- [ ] After `npx playwright install chromium`, a scratch script calling `fetchTagPages(["hiring"])` returns HTML containing data-sjs with thread_items for the surface (post data hydrated, not just blob presence)
- [ ] A scratch run with `THREADS_TAGS="hiring, nonexistent-tag-zz"` still succeeds (single-failure tolerance, D11) and logs the failed surface
- [ ] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

### Slice 4: Filters (keywords + LLM judge)
**Files**: `src/keywords.ts`, `src/judge.ts`, `tests/keywords.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npx tsc --noEmit` exits 0
- [ ] Filter test suite passes: `npx tsx --test tests/keywords.test.ts` exits 0 (18 tests)
- [ ] Extract regression: `npx tsx --test tests/extract.test.ts` exits 0 (filter modules break no locked extraction consumer)
- [ ] Secret hygiene: `grep -rniE "password|api_key" src tests` matches only env-var NAME constants (LLM_API_KEY, GMAIL_APP_PASSWORD) and test fixture strings ("test-key"), never secrets
- [ ] Config exports preserved: `grep -c "KEYWORDS" src/config.ts` returns 1 or more

#### Manual Verification:
- [ ] Verify `matchesKeywords` correctly rejects the non-tech hiring posts in `tests/fixture/tag-page.html` (Barista, VA, Safety Officer)
- [ ] Verify `judgePosts` handles mock LLM responses with code fences, whitespace, and malformed JSON with 1 retry before skipping
- [ ] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

### Slice 5: State
**Files**: `src/state.ts`, `state/seen-posts.json`

#### Automated Verification:
- [ ] Type checking passes: `npx tsc --noEmit` exits 0
- [ ] Regression tests pass: `npx tsx --test tests/extract.test.ts tests/keywords.test.ts` exits 0 (state additions break no locked consumers)
- [ ] Seed state exists and validates: `node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; const s = JSON.parse(fs.readFileSync("state/seen-posts.json", "utf8")); assert.equal(s.version, 1); assert.deepEqual(s.seenPostIds, []);'` exits 0
- [ ] Atomic save-gating verified: `npx tsx -e 'import assert from "node:assert/strict"; import { saveState, createInitialState } from "./src/state.js"; const s = createInitialState(); const res = await saveState(s, []); assert.equal(res.saved, false); assert.equal(res.addedCount, 0); assert.deepEqual(res.state.seenPostIds, []);'` exits 0
- [ ] Atomic write and diff verified: `npx tsx -e 'import assert from "node:assert/strict"; import { createInitialState, diffNew, diffNewIds, saveState } from "./src/state.js"; const s = createInitialState(); const posts = [{ id: "1", text: "t", author: "a", permalink: "p", timestamp: "ts" }]; assert.equal(diffNew(s, posts).length, 1); assert.deepEqual(diffNewIds(s, ["1", "2"]), ["1", "2"]);'` exits 0
- [ ] Secret hygiene: `grep -rniE "password|api_key" src state` matches only env-var NAME constants (LLM_API_KEY, GMAIL_APP_PASSWORD), never values

#### Manual Verification:
- [ ] Verify `state/seen-posts.json` is formatted with 2-space indentation and newline, carrying version: 1
- [ ] Verify `saveState` never touches disk when 0 new posts match (FRD #9, D8)
- [ ] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

### Slice 6: Email digest

**Files**: `src/email.ts`, `tests/email.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npx tsc --noEmit` exits 0
- [ ] Email digest test suite passes: `npx tsx --test tests/email.test.ts` exits 0 (15 tests)
- [ ] Regression tests pass: `npx tsx --test tests/extract.test.ts tests/keywords.test.ts` exits 0 (email additions break no locked consumers)
- [ ] Secret hygiene: `grep -rniE "password|api_key" src tests` matches only env-var NAME constants (LLM_API_KEY, GMAIL_APP_PASSWORD) and test fixture strings ("test-key", "app-password"), never secrets
- [ ] Config exports preserved: `grep -c "ENV_NAMES" src/config.ts` returns 1 or more

#### Manual Verification:
- [ ] Verify `buildDigest` formats plain-text output matching the FRD format: numbered list with caption, author with `@`, permalink on its own line, double-newline separation
- [ ] Verify `sendDigest` returns `{ sent: false, postCount: 0 }` and skips nodemailer transport invocation when post list is empty (FRD #8)
- [ ] `npm start` still fails only with the expected missing-entry-point error (Slice 1 criterion unchanged)

### Slice 7: CLI + workflow + README

**Files**: `src/index.ts`, `.github/workflows/watch.yml`, `README.md`

#### Automated Verification:
- [ ] `npm install` exits 0 and produces package-lock.json
- [ ] Type checking passes: `npx tsc --noEmit` exits 0
- [ ] Full suite passes: `npm test` exits 0 (41 tests: 8 extract + 18 keywords + 15 email)
- [ ] Secret hygiene: `grep -rniE "password|api_key" src tests .github README.md` matches only env-var NAME constants and README placeholder mentions — never secret values
- [ ] Workflow triggers: `grep -c "workflow_dispatch" .github/workflows/watch.yml` returns 1; `grep -F 'cron: "*/10 * * * *"' .github/workflows/watch.yml` returns 1
- [ ] Bot commit-back gated: `grep -c "github-actions\\[bot\\]" .github/workflows/watch.yml` returns 2 or more; the commit step runs `git commit` only when the staged diff is non-empty
- [ ] D9 timeout present: `grep -c "timeout-minutes: 10" .github/workflows/watch.yml` returns 1
- [ ] Overlap guard present: `grep -c "concurrency:" .github/workflows/watch.yml` returns 1

#### Manual Verification:
- [ ] BOT-DETECTION SMOKE GATE (blocker per Verification Notes): push to the public repo, trigger workflow_dispatch — run logs show per-surface post counts > 0 and finish green. If blocked, escalate hardening per D2 or fall back per the solutions artifact.
- [ ] With GMAIL_* secrets seeded, a dispatch that finds matches delivers the plain-text digest (numbered posts + permalinks); an immediate second dispatch sends nothing and logs "no new matches"
- [ ] State commit appears authored by github-actions[bot] with message "state: N new seen post ids", only on match runs
- [ ] README quick-start works top-to-bottom on a fresh clone

## Desired End State
The repo is public on GitHub. Every 10 minutes (best-effort), Actions runs:
- Fetch + extract logs: `surface default: 22 items, tags: 19 items, tag/hiring: 24 items → 58 unique posts`
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
- Zero-match runs log `no new matches` and send nothing.

Local run: `npm install && npx playwright install chromium && npm start`.

## File Map
```
package.json                    # NEW — manifest, scripts, deps
tsconfig.json                   # NEW — strict TS, NodeNext, noEmit
src/types.ts                    # NEW — Post, JudgeVerdict
src/config.ts                    # NEW — tag surfaces (THREADS_TAGS), keywords, env names, state path
src/extract.ts                  # NEW — data-sjs JSON → Post[]
src/fetch-threads.ts            # NEW — Playwright multi-surface fetch
src/keywords.ts                 # NEW — keyword pre-filter
src/judge.ts                    # NEW — LLM relevance+location verdict
src/state.ts                    # NEW — state load/diff/atomic write
src/email.ts                    # NEW — Gmail plain-text digest
src/index.ts                    # NEW — CLI pipeline
state/seen-posts.json           # NEW — seed state
tests/fixture/tag-page.html     # NEW — extraction fixture (real capture)
tests/extract.test.ts           # NEW — extraction suite
tests/keywords.test.ts          # NEW — keyword suite
tests/email.test.ts             # NEW — digest suite
.github/workflows/watch.yml     # NEW — cron + commit-back workflow
README.md                       # NEW — setup + smoke-run guide
```

## Ordering Constraints
- Slice 1 (contracts/config) blocks everything — every slice imports its types.
- Slice 2 (extract) needs only Slice 1; Slice 3 (fetch) wraps Slice 2's parser and carries the config.ts surface revision (D11).
- Slice 4 needs Slice 1 only (types + config), not fetch — pure functions.
- Slice 5 needs Slice 1; Slice 6 needs Slice 1; independent of 2-4.
- Slice 7 wires 2-6 and must come last; it carries the project-baseline checks.
- Strictly sequential per the iterative design loop (one slice per session).

## Verification Notes
- **Bot-detection smoke gate (blocker)**: a manual `workflow_dispatch` run must return posts from GitHub Actions runner IPs. This is the solutions artifact's named blocker; verify at Slice 7 before considering the design proven. If blocked: escalate hardening (D2) or fall back per solutions artifact alternatives.
- **Secret hygiene**: `grep -rni "password\|api_key" .` over the repo matches only env-var NAME constants in src/config.ts and README placeholder mentions — never values (FRD acceptance criterion).
- **Fixture realism**: extraction tests run against a real saved tag page (trimmed 2026-10-24 Playwright capture), not a synthetic one.
- **Quota guard**: public repo is a hard requirement at */10 cadence; private would cost ~$53/month (11,000 min × $0.006 − 2,000 free).
- **60-day disable**: scheduled workflows in public repos auto-disable after 60 days of no repo activity; state commit-backs count, but long no-match stretches need a manual dispatch to stay alive.
- **No re-trigger loops**: GITHUB_TOKEN pushes do not start new runs (GitHub docs) — required for the cron design to converge.
- **No browser caching**: actions/cache for Playwright browsers is officially discouraged (restore ≈ download; apt deps not cacheable).
- **Git history unavailable**: no .git exists, so no precedent scan was possible for this design.

## Performance Considerations
- Typical run 2-3 min: browser launch ~2-4s; 3 surfaces × goto+wait ~15-45s total (one browser instance, new page per surface); extraction <1s; LLM one call per maybe-post (1-2s each); SMTP ~1-2s; git commit ~2-5s.
- timeout-minutes: 10 absorbs rare apt outliers (8-11 min documented) without nearing the 360-min default.
- LLM cost bounded: keywords trim the ~20-80 post feed to maybes; never more than one LLM call per maybe per run; parse-failed posts are not retried beyond one attempt.
- No N+1: extraction is in-memory JSON walking; no per-post HTTP beyond the single LLM call.

## Migration Notes
Greenfield — no existing data. The state file carries `version: 1` for future schema migrations (a version-keyed migration function in state.ts). Rollback for a bad run is `git revert` of the state commit; the atomic write means a crashed run cannot leave a partial file.

## Pattern References
- FRD recommended architecture: single CLI entry point run by a scheduled workflow (`.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md:69`)
- Fetch mechanism selection: `.rpiv/artifacts/solutions/explore_threads-hiring-alerts.md` (Option 1: Playwright)
- Threads data-sjs extraction pattern: https://scrapfly.io/blog/posts/how-to-scrape-threads (2026)
- pk→shortcode algorithm: https://gist.github.com/sclark39/9daf13eea9c0b381667b61e3d2e7bc11
- Logged-out search behavior measurements: https://dev.to/alom_d/threads-search-shows-logged-out-visitors-about-20-posts-heres-how-i-get-60-to-85-2g6l
- Playwright CI pattern: https://playwright.dev/docs/ci#github-actions

## Developer Context
**Checkpoint round 1 (design scope):**
- Q: How much should this design cover — full v1 pipeline or fetch module only (per solutions artifact scope)? **A: Full v1 pipeline.**
- Q: Logged-out search returns ~20 posts/query, no pagination — single screenful or multi-surface? **A: Multi-surface (3 surfaces, dedupe by pk).**
- Q: ~11,000 Linux-min/month vs 2,000 free private minutes — public repo, private hourly, or pay overage? **A: Public repo.**
- Q: FRD says "Node.js or TypeScript" — which? **A: TypeScript + tsx.**

**Pre-announced decisions ratified with the full-pipeline choice:** extraction from data-sjs JSON (D1, evidence-backed; supersedes the solutions artifact's DOM phrasing), minimal browser hardening without stealth plugins (D2), single LLM call returning {relevant, locationOk} collapsing the FRD's two open questions (D3), state schema {"version": 1, "seenPostIds": []} (D8).

**Corrections absorbed during design:** run-time estimate corrected from ~1 min to ~2-3 min (Playwright install + page loads), which forced the public-repo decision; FRD's "6-minute job timeout" clarified as a self-imposed budget — the Actions default is 360 min (timeout-minutes: 10 set explicitly, D9).

**Slice 2 session (resume, 2026-10-24):**
- Live probes contradicted the locked surface set (search = 0 posts; tags = 17-19 each). **A: the tag list becomes configurable** — THREADS_TAGS env, default `hiring,lowker,infokerja` (D11); config.ts revision folded into Slice 3.
- Fixture built from a real Playwright capture during the slice session (not deferred to implement); pk→code algorithm verified 19/19 against real pk/code pairs before the slice was generated.
- Slice-verifier VIOLATION (ThreadItemRaw orphaned export + false refinement claim) resolved by retiring the type (D12); re-verification passed; prose sweep folded into the lock edit.

**Slice 6 session (resume, 2026-10-25):**
- Full slice validated before presentation: src/email.ts + tests/email.test.ts type-checked against nodemailer 6.9.16 + @types/nodemailer 6.4.17 under the locked tsconfig (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax) and run with `tsx --test` — 15/15 pass in a scratch project. No unverified code shipped to the checkpoint.
- sendDigest accepts an optional Transporter parameter for unit testing (mirrors judgePost's injectable fetchFn pattern, src/judge.ts).
- slice-verifier returned Decisions OK, Cross-slice OK, Research OK (no violations). Slice approved as generated at the micro-checkpoint.

**Slice 7 session (resume, 2026-10-25):**
- Wiring decision surfaced at the checkpoint: state persists every judged id (relevant or not) on match runs to bound re-judging; skipped ids stay unseen (D3); no-match runs persist nothing (FRD #9). Keyword-rejected posts are never persisted (cheap re-filter, stays re-evaluable).
- slice-verifier: Decisions OK, Cross-slice OK; one Research WARNING — the persistence comment over-claimed a cross-run cost bound (judged posts re-judge during no-match stretches because FRD #9 forbids persisting there). Comment corrected in the lock edit; behavior unchanged. Slice approved as generated at the micro-checkpoint.

## Design History
- Slice 1: Scaffold + contracts — approved as generated
- Slice 2: Extraction — approved as generated (revised: ThreadItemRaw retired from src/types.ts per slice-verifier; fixture renamed to tests/fixture/tag-page.html; D5 surfaces revised to configurable tag pages per live probes — D11/D12)
- Slice 3: Fetch (Playwright) — approved as generated (revised during verification: fetchOne consumes tagPageUrl — orphan resolved per D12; hydration probe moved to a waitForFunction string expression — DOM globals broke the locked DOM-less tsconfig; D9 all-fail worst-case budget WARNING surfaced and ratified — per-attempt warn keeps failure visible when the workflow kill wins)
- Slice 4: Filters (keywords + LLM judge) — approved as generated
- Slice 5: State — approved as generated
- Slice 6: Email digest — approved as generated
- Slice 7: CLI + workflow + README — approved as generated

## References
- `.rpiv/artifacts/discover/2026-10-24_13-36-02_threads-hiring-alerts.md` — FRD (requirements source)
- `.rpiv/artifacts/research/2026-10-24_14-30-29_threads-hiring-alerts.md` — research report
- `.rpiv/artifacts/solutions/explore_threads-hiring-alerts.md` — fetch-mechanism decision (Playwright)
- https://playwright.dev/docs/ci — Playwright CI setup and caching guidance
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows — schedule + GITHUB_TOKEN no-retrigger
- https://scrapfly.io/blog/posts/how-to-scrape-threads — data-sjs structure and field names
- Live logged-out probes (2026-10-24, this design session): search = 0 posts; /tag/hiring 19, /tag/lowker 17, /tag/infokerja 18; permalink format verified (HTTP 200 on a captured @user/code pair); pk→code algorithm verified on 19/19 real pairs
