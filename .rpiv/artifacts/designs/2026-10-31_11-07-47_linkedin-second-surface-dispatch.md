---
date: 2026-10-31T11:07:47+0700
author: Yogiswara Utama
commit: b92fa9f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn second surface + configurable scroll"
tags: [design, config-file, fetch-threads, fetch-linkedin, index, linkedin, scroll-rounds, platform]
status: ready
parent: .rpiv/artifacts/solutions/2026-10-31_10-32-31_linkedin-second-surface-dispatch.md
last_updated: 2026-10-31T17:01:04+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Updated post-finalize fixes: phantom Hunk G heading; Slice 6 tsx -e TLA criterion rewritten to .then form (verified); D12 lazy base-context build (S3 walker + pin, S4 comment)"
---

# Design: LinkedIn second surface + configurable scroll

## Summary

Add a second watched platform: a `linkedin` config arm (keywords string) rides the existing acquisition seam beside Threads, walked by a sibling `src/fetch-linkedin.ts` (flagship-web RSC interception, urn-minted ids, wheel scroll). A carried `platform` discriminant on `ResolvedSurface` and `Post` replaces label sniffing as the dispatch mechanism, `scrollRounds` (integer >= 1, default 8) bounds both walks, and `LINKEDIN_SESSION_STATE` mirrors the Threads session contract. With no linkedin surface and no new key present, every existing behavior and test stays unchanged except the two declared literal edits.

## Requirements

- FR#1: a `linkedin` surface type whose value is a keywords string; config validation stays fail-visible (path + key in every error).
- FR#2/FR#3: the LinkedIn search URL is built byte-exactly: `encodeURIComponent` keywords, `origin=FACETED_SEARCH`, `sortBy=%5B%22date_posted%22%5D`, `datePosted=%5B%22past-24h%22%5D`.
- FR#4: validated `scrollRounds` key — `Number.isInteger`, >= 1, default 8; consumed by BOTH walks.
- FR#5/FR#6/FR#7: `Post.platform: "threads" | "linkedin"` required end to end; judge prompts platform-neutral everywhere (developer decision); digest marks non-Threads lines with a platform token; subject switches only when a LinkedIn match is present.
- FR#8: LinkedIn joins the existing shared `runPool` acquisition — no new serial stage, no second pool.
- Acceptance: (1) mixed run judges and emails both platforms; a LinkedIn failure never discards Threads results; (2) absent-feature run keeps behavior and tests unchanged (two declared literal edits aside); (3) config errors exit nonzero naming the problem.

## Current State Analysis

The pipeline is Threads-only end to end. The config union (`src/config-file.ts:14`) is 2-arm; `resolveSurfaces` (`:190-197`) erases type into `{label, url}`; dispatch downstream sniffs the `tag/` label prefix (`src/fetch-threads.ts:180-182`, an acknowledged workaround). Acquisition (`src/index.ts:150-165`) resolves ONE session, branches authenticated vs logged-out on one fused boolean, and pairs one `cleanupSessionDir` in `finally`. The authenticated walker (`src/fetch-threads.ts:275-320`) builds one cookie-bearing context, drains the mixed list through `runPool` (width 4), tolerates per-surface failures via caller-owned side arrays, and its all-fail predicate counts POSTS (`:304`) — already cross-platform-safe. Its XHR collector filters `/graphql/i` (`:337`), which a LinkedIn RSC stream never passes. `MAX_SCROLL_ROUNDS = 8` (`:44`) has exactly one consumer (loop bound, `:394`). State is platform-blind raw id strings (`src/state.ts:25`); `dedupePosts` is first-seen-wins on `post.id` (`src/index.ts:299-308`).

### Key Discoveries

- Live capture (research artifact): LinkedIn content search is logged-in-only; ids are `urn:li:activity:<19-digit>`; timestamps derive as `BigInt(id) >> 22n` (epoch ms, verified on two ids); permalinks construct as `https://www.linkedin.com/feed/update/urn:li:activity:<id>`; ~3 posts per pagination round; the app renders in a nested frame where only `page.mouse.wheel` drove pagination; sessions die server-side mid-run (expiry is routine).
- One Post minting site for Threads: `normalizeThreadItem` (`src/extract.ts:105-111`) — a required `Post.platform` is tsc-enforced complete at compile time.
- The bulk lead-in "Judge each Threads post below" (`src/judge.ts:265`) is matched by 7 mock-fetch doubles across 3 suites (`tests/judge.test.ts:153,445,483`; `tests/index.test.ts:140,162`; `tests/judge-rotation.test.ts:331,594`) — the neutral-wording decision requires lockstep edits at all 7.
- Digest subject (`src/email.ts:54-59`) is pinned at 5 sites in `tests/email.test.ts`; the conditional subject scheme keeps all-Threads subjects byte-identical.
- The all-fail predicate counts posts, not surfaces (`src/fetch-threads.ts:304`), so a dead LinkedIn surface inside the shared pool leaves Threads results intact by construction.
- Precedents (git-verified): b050436 (surface type, 12 files, tests in-commit), d8fc15b (optional key with default, 7 files), 9e1c8ef (session secret + walker, 12 files), 93a3f38 (live-run retune, +1729). No commit has ever run two sessions or two contexts — the split is genuinely new.

## Scope

### Building

- `linkedin` config arm: union member, whitelist + error message move together, keywords URL builder (byte-exact facets).
- `platform` discriminant on `ResolvedSurface` and `Post`; stamped at `resolveSurfaces` and the two minting sites (extract + fetch-linkedin).
- `scrollRounds` config key: validator cloning the reasoningEffort shape (`Number.isInteger`, >= 1, default 8), consumed by both walks.
- `LINKEDIN_SESSION_STATE`: `ENV_NAMES` entry, env-name-parameterized `resolveSession`, watch.yml secret mapping; absent => LinkedIn surfaces warn + yield 0 posts (never the logged-out path).
- Fetcher dispatch: one options object `{ linkedinSessionPath?, scrollRounds? }` as 4th trailing param of `fetchSurfacesAuthenticated`; worker branches on `surface.platform`; second context built inside the same function.
- `src/fetch-linkedin.ts`: RSC/SDUI response parse, urn ids, id-derived ISO timestamps, constructed permalinks, wheel scroll loop, offline-pinnable parser.
- Judge wording: platform-neutral everywhere (bulk + single-post), with the 7-site lockstep test edits.
- Digest: `[linkedin]` token on non-Threads item lines; subject gains a platform suffix only when a LinkedIn match is present.
- `watcher.config.json` gains a live linkedin surface; README documents the session export.

### Not Building

- Automated username/password login (challenge/restriction risk) — session secret only.
- A LinkedIn probe script — doctrine: hard-code until volume justifies measuring.
- Heartbeat platform-dimension redesign — subject/body stay platform-neutral.
- A dedicated LinkedIn cron — stays `*/10`; revisit when volume demands (design-gate follow-up).
- No persisted-state migration — `state/seen-posts.json` accepts any non-empty string id today.

## Decisions

### D1: Carried platform discriminant (solutions Option 1)

`Surface` already carries `type`; `resolveSurfaces` stops erasing it. Adoption: 3 construction sites + 1 read; all existing label/url reads compile untouched. Type-safe at the pool worker; pairs with `Post.platform` for one vocabulary end to end. Evidence: `src/config-file.ts:14,190-197`; solutions artifact Comparison table.

### D2: Post id = raw urn (interpreted from developer answer "same as current")

LinkedIn posts mint `id = "urn:li:activity:<19-digit>"` exactly as captured. Colons make Threads dedupe collisions structurally impossible (`src/index.ts:299-308`; Threads ids are digit strings of the same magnitude, so stripping digits would risk real collisions). Zero transformation code. Permanent: switching the form later re-emails in-window posts once. Capture evidence: research artifact "Id namespace".

### D3: Judge wording neutral everywhere (developer decision)

Both prompts drop the platform word: bulk lead-in becomes "Judge each post below" (`src/judge.ts:265`), single-post becomes "Analyze the following post by @<author>" (`:238`). Cost: lockstep edits at the 7 bulk-dispatch mock strings across `tests/judge.test.ts`, `tests/index.test.ts`, `tests/judge-rotation.test.ts` — otherwise suites silently reroute bulk batches to the single-post path. Rejected: conditional scheme (kept verbatim Threads strings) — developer chose the simpler prompt code.

### D4: scrollRounds consumed by both walks (developer decision)

The validated knob replaces `MAX_SCROLL_ROUNDS` as the Threads loop bound and threads into the LinkedIn wheel loop as the same bound. Default 8 keeps every existing scroll pin green (dry-stop 3, ceiling 8, cap 1). Evidence: `src/fetch-threads.ts:44,394`; pins `tests/fetch-threads.test.ts:299-364`.

### D5: LINKEDIN_SESSION_STATE contract mirrors Threads

`ENV_NAMES.linkedinSession` (`src/config.ts:14-21` pattern); `resolveSession` gains a trailing `envName` parameter defaulting to the Threads var; warn messages interpolate the actual name. Absent/invalid => null => LinkedIn surfaces are SKIPPED with a warn (never routed logged-out — anonymous LinkedIn hits an authwall). A linkedin-only config with no session degrades to warn + empty funnel + heartbeat; the run never fails on a dead session (capture incident: expiry is routine).

### D6: One options object as the 4th fetcher parameter

`fetchSurfacesAuthenticated(surfaces, storageStatePath, contextFactory, options?)` with `options?: { linkedinSessionPath?: string; scrollRounds?: number }`. Named fields stay positional-stable for the 11 existing test call sites (developer deferred the shape choice; standard option taken).

### D7: Type-only module back-edge

`src/fetch-linkedin.ts` imports `PageLike`/`ContextLike`/`ResponseLike` types from `src/fetch-threads.ts` via `import type` (erased at runtime under verbatimModuleSyntax); `fetch-threads.ts` runtime-imports the LinkedIn walk function. No runtime cycle, no new files, no existing import edits (developer deferred; standard option taken).

### D8: Session resolver parameterization

`resolveSession(env, envName = ENV_NAMES.threadsSession)` — one function, both platforms, zero new exports (developer deferred; standard option taken).

### D9: LinkedIn-session-absent skip semantics

Platform split happens BEFORE session resolution. Threads session absent => Threads surfaces take the existing logged-out path. LinkedIn session absent => LinkedIn surfaces skip with a warn line naming the env var. Both sessions absent with mixed config => logged-out Threads + skipped LinkedIn. The fused boolean at `src/index.ts:151-155` defuses into per-platform resolution; both temp dirs pair their cleanups in the same `finally`.

### D10: Digest platform marking (solutions scheme)

Item lines render `[linkedin] ` prefix iff `post.platform !== "threads"`; subject appends " + LinkedIn" only when at least one LinkedIn match is present (`src/email.ts:54-75`). All-Threads digests stay byte-identical; the 5 subject pins and existing item pins hold.

### D11: Byte-identical absence bar

With no linkedin surface and no `scrollRounds` key: every module behaves identically. Declared unavoidable edits: `tests/config-file.test.ts` resolveSurfaces deepEquals gain `platform: "threads"`, `tests/fetch-threads.test.ts` surface() helper gains `platform: "threads"`, `tests/index.test.ts` CONFIG gains `scrollRounds: 8` (all forced by required fields), plus the Post-fixture `platform: "threads"` lines forced by `Post.platform`.

### D12: Lazy base-context build (post-finalize amendment)

The walker built the base context eagerly, so a dispatch whose surfaces are all linkedin (the logged-out arm calling with `linkedinSurfaces`; a linkedin-only config whose Threads secret is set) opened an idle browser context from a path no surface walks. Flagged in post-finalize review 2026-10-31. Fix: build the base context only when `surfaces.some((surface) => surface.platform === "threads")`, with a `threadsContext()` null guard mirroring `walkLinkedInSurface`'s session guard. Rejected: a surfaces-only entry point (duplicates the pool and all-fail machinery for one rare dispatch shape). Call sites are unchanged — the logged-out arm keeps passing the LinkedIn path as the vestigial base argument.

## Architecture

### src/config-file.ts — MODIFY

Surface union third arm; whitelist + error message; `scrollRounds` validator (`Number.isInteger`, >= 1, default 8) + `ALLOWED_KEYS` + `WatcherConfig`; `ResolvedSurface.platform`; `resolveSurfaces` stamps + third URL arm with byte-exact facets.

```typescript
// --- Block 1: replaces lines 13-22 (Surface union + ResolvedSurface) ---
/** One surface to sample. `tag` builds the tag-page URL; `url` is verbatim;
 * `linkedin` builds a LinkedIn content-search URL from keywords. */
export type Surface =
  | { type: "tag"; value: string }
  | { type: "url"; value: string }
  | { type: "linkedin"; value: string };

/** A surface resolved to the URL Playwright loads, plus its log label. */
export interface ResolvedSurface {
  /** Which platform walker drives this surface. */
  platform: "threads" | "linkedin";
  /** Log label: `tag/hiring`, `linkedin/<keywords>`, or the full URL for a `url` surface. */
  label: string;
  /** Absolute URL to load. */
  url: string;
}

// --- Block 2: WatcherConfig + ALLOWED_KEYS gain scrollRounds ---
/** Shape of watcher.config.json. */
export interface WatcherConfig {
  keywords: string[];
  candidateTerms: string[];
  surfaces: Surface[];
  recencyHours: number;
  reasoningEffort: ReasoningEffort;
  scrollRounds: number;
}

const ALLOWED_KEYS = [
  "keywords",
  "candidateTerms",
  "surfaces",
  "recencyHours",
  "reasoningEffort",
  "scrollRounds",
] as const;

// --- Block 3: validateConfig wires the validator (replaces the body tail) ---
  const keywords = readStringArray(record.keywords, "keywords", filePath, true);
  const candidateTerms = readStringArray(record.candidateTerms, "candidateTerms", filePath, false);
  const surfaces = readSurfaces(record.surfaces, filePath);
  const recencyHours = readRecencyHours(record.recencyHours, filePath);
  const reasoningEffort = readReasoningEffort(record.reasoningEffort, filePath);
  const scrollRounds = readScrollRounds(record.scrollRounds, filePath);

  return { keywords, candidateTerms, surfaces, recencyHours, reasoningEffort, scrollRounds };

// --- Block 4: new validator, after readReasoningEffort ---
/** Scroll-round bound for both walks; defaults to the Threads-measured 8. */
const DEFAULT_SCROLL_ROUNDS = 8;

/**
 * Optional scroll knob: absent -> the measured default, present but not a
 * whole number >= 1 -> fail with the path and key. Flooring a walk length
 * silently changes operator intent, so fractions are rejected, not floored.
 */
function readScrollRounds(value: unknown, filePath: string): number {
  if (value === undefined) {
    return DEFAULT_SCROLL_ROUNDS;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `config: ${filePath} "scrollRounds" must be an integer >= 1, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

// --- Block 5: readSurfaces whitelist + message (replaces the type gate) ---
    if (type !== "tag" && type !== "url" && type !== "linkedin") {
      throw new Error(
        `config: ${filePath} surface "type" must be "tag", "url", or "linkedin", got ${JSON.stringify(type)}`,
      );
    }

// --- Block 6: resolveSurfaces + builders (replaces the file tail) ---
/** Resolve configured surfaces to the URLs Playwright loads. */
export function resolveSurfaces(surfaces: readonly Surface[]): ResolvedSurface[] {
  return surfaces.map((surface): ResolvedSurface => {
    if (surface.type === "tag") {
      return {
        platform: "threads",
        label: `tag/${surface.value}`,
        url: tagPageUrlFor(surface.value),
      };
    }
    if (surface.type === "linkedin") {
      return {
        platform: "linkedin",
        label: `linkedin/${surface.value}`,
        url: linkedinSearchUrlFor(surface.value),
      };
    }
    return { platform: "threads", label: surface.value, url: surface.value };
  });
}

/** Tag-page URL. Kept local so src/config.ts no longer owns surface policy. */
function tagPageUrlFor(tag: string): string {
  return `https://www.threads.com/tag/${encodeURIComponent(tag)}`;
}

/**
 * LinkedIn content-search URL from a keywords string. The facets ride the
 * URL as server-side arguments (live capture 2026-10-31): sortBy is
 * newest-first and datePosted is the past 24 hours. encodeURIComponent and
 * not URLSearchParams because spaces must render as %20 (the operator
 * example URL byte) and URLSearchParams emits +.
 */
function linkedinSearchUrlFor(keywords: string): string {
  const encoded = encodeURIComponent(keywords);
  const sortBy = encodeURIComponent('["date_posted"]');
  const datePosted = encodeURIComponent('["past-24h"]');
  return `https://www.linkedin.com/search/results/content/?keywords=${encoded}&origin=FACETED_SEARCH&sortBy=${sortBy}&datePosted=${datePosted}`;
}
```

### src/types.ts — MODIFY

`Post.platform: "threads" | "linkedin"` required, with doc comment.

```typescript
// --- Post gains the required platform discriminant; other members stay verbatim ---
/** One post from any watched platform, normalized. Produced by extract (Threads) and each fetcher. */
export interface Post {
  /** Stable dedup key: numeric post id, e.g. "3388928313420694692". */
  id: string;
  /** Which platform minted the post; drives digest marking (src/email.ts). Colons in urn ids cannot collide with Threads digit ids. */
  platform: "threads" | "linkedin";
  /** Full post text (caption). May contain newlines. */
  text: string;
  /** Author handle without the leading "@". */
  author: string;
  /** Canonical permalink: Threads keeps https://www.threads.com/@{author}/post/{code}. */
  permalink: string;
  /** Post time, ISO 8601 UTC, e.g. "2026-10-24T08:15:00.000Z". */
  timestamp: string;
}
```

### src/extract.ts — MODIFY

`normalizeThreadItem` stamps `platform: "threads"` (the single Threads minting site, covering both collection paths).

```typescript
// --- normalizeThreadItem return literal gains the platform stamp ---
  return {
    platform: "threads",
    id: pk,
    text,
    author,
    permalink: `https://www.threads.com/@${author}/post/${code}`,
    timestamp: new Date(takenAt * 1000).toISOString(),
  };
```

### src/config.ts — MODIFY

`ENV_NAMES.linkedinSession = "LINKEDIN_SESSION_STATE"`.

```typescript
// --- ENV_NAMES gains the LinkedIn session name, paired beside the Threads one ---
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  linkedinSession: "LINKEDIN_SESSION_STATE",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  judgeConcurrency: "JUDGE_CONCURRENCY",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;
```

### src/threads-session.ts — MODIFY

`resolveSession(env, envName?)` parameterized; warn messages interpolate the var name.

```typescript
// --- Header doc replaced; isValidStorageState body unchanged; cleanupSessionDir untouched ---
/**
 * Session resolution for both watched platforms (Phase 8; extended for
 * LinkedIn).
 *
 * An authenticated walk replays a Playwright storageState document
 * exported from a real browser login. The document travels base64-encoded
 * in a session environment variable (a GitHub Actions secret): it is
 * account-equivalent, so it never enters the repo and never enters
 * state/seen-posts.json. The decoded document is written to an OS temp
 * file that Playwright loads as the browser context's storage state.
 *
 * The variable name is a parameter defaulting to the Threads var, so one
 * resolver serves THREADS_SESSION_STATE and LINKEDIN_SESSION_STATE. A null
 * return means "no usable session"; what happens next is the caller's
 * policy — Threads falls back to the logged-out walk, LinkedIn surfaces
 * are skipped with a warn (an anonymous LinkedIn page hits an authwall,
 * never a logged-out walk).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ENV_NAMES } from "./config.js";

/** Minimal shape check for a Playwright storageState document. */
export function isValidStorageState(doc: unknown): boolean {
  if (doc === null || typeof doc !== "object") return false;
  const cookies: unknown = (doc as { cookies?: unknown }).cookies;
  return Array.isArray(cookies) && cookies.length > 0;
}

/**
 * Decode the named base64 session secret and write it to a temp file.
 * Returns the file path, or null when the secret is unset or invalid.
 * Warn messages interpolate the variable name so an operator sees which
 * secret is bad.
 */
export async function resolveSession(
  env: Record<string, string | undefined> = process.env,
  envName: string = ENV_NAMES.threadsSession,
): Promise<string | null> {
  const raw: string | undefined = env[envName];
  if (raw === undefined || raw.trim() === "") return null;

  let doc: unknown;
  try {
    doc = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    console.warn(`session: ${envName} is not valid base64 JSON — continuing without it`);
    return null;
  }
  if (!isValidStorageState(doc)) {
    console.warn(`session: ${envName} carries no cookies — continuing without it`);
    return null;
  }

  const dir = await mkdtemp(join(tmpdir(), "loker-session-"));
  const filePath = join(dir, "storage-state.json");
  await writeFile(filePath, JSON.stringify(doc), "utf8");
  return filePath;
}
```

### src/fetch-linkedin.ts — NEW

LinkedIn walker: flagship-web response filter, flight-stream parse (row split, $-reference resolution, commentary_text marker, textProps.children text harvest), urn id minting, BigInt(id) >> 22n timestamps, constructed permalinks, wheel-driven scroll loop with dry counter and the shared scrollRounds bound. Member names are absent from the captured response bodies, so Post.author is the "linkedin-member" placeholder (deviation from the earlier aria-label assumption, ratified at the Slice-3 checkpoint). Exports parseFlightRows / collectLinkedInPosts / fetchLinkedInSurface for offline tests.

```typescript
/**
 * Fetch LinkedIn content-search posts with Playwright (flagship-web RSC).
 *
 * The logged-in search app streams results over the network: the initial
 * page rides POST /flagship-web/search/results/content/ and each scroll
 * round rides POST /flagship-web/rsc-action/actions/pagination (capture
 * 2026-10-31). The DOM carries no post ids at all, so extraction is
 * network-only: response bodies are split into React Flight rows
 * ("hex-id":JSON per line), $-references between rows are resolved, and
 * every feed card is minted from capture-verified facts —
 *
 * - the activity id lives under ...activityUrn.activityId objects, and as
 *   urn:li:activity:<id> strings and object keys;
 * - the post text lives under the component whose viewTrackingSpecs carry
 *   legacyControlName "commentary_text", inside textProps.children React
 *   element trees (br elements are newlines; "$<row>:props.path" strings
 *   are shared-subtree references);
 * - timestamps and permalinks are NOT in the body: the id encodes creation
 *   time as BigInt(id) >> 22n (epoch ms, verified on two capture ids), and
 *   the permalink constructs as /feed/update/urn:li:activity:<id>.
 *
 * Member names are absent from the response bodies (zero name-shaped
 * strings across 11 capture bodies), while the rendered DOM carries names
 * but no ids — the two sources cannot be joined, so Post.author is a
 * placeholder rather than a real handle.
 *
 * Pagination is wheel-driven: the app renders in a nested frame where
 * window.scrollTo is a no-op; page.mouse.wheel over the results area
 * drives it (validated live). Session expiry is routine (capture incident:
 * the session died mid-capture) — a dead walk fails its own surface and
 * the caller's side arrays keep the rest of the run alive.
 *
 * Testability: the parser helpers are pure string -> Post[] functions and
 * the walk takes the shared ContextLike seam, so offline suites inject
 * structural doubles — importing this module never loads Playwright.
 */
import type { ResolvedSurface } from "./config-file.js";
import type { ContextLike } from "./fetch-threads.js";
import type { Post } from "./types.js";

// LinkedIn walk tuning (capture 2026-10-31; PLACEHOLDERS pending the live
// retune — expect a validation-revision commit after the first real runs,
// the 93a3f38 precedent). Wheel coordinates target the results viewport.
const LINKEDIN_WHEEL_X = 600;
const LINKEDIN_WHEEL_Y = 450;
const LINKEDIN_WHEEL_DELTA_Y = 2500;
const LINKEDIN_SETTLE_MS = 2500;
const LINKEDIN_MAX_DRY_ROUNDS = 3;
const LINKEDIN_MIN_GAIN = 2;
const LINKEDIN_MAX_POSTS = 150;
const LINKEDIN_XHR_DRAIN_MS = 1500;
const LINKEDIN_NAV_TIMEOUT_MS = 30_000;
const LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS = 30_000;
const LINKEDIN_FIRST_RESPONSE_POLL_MS = 250;

/**
 * Digests and judge prompts render this handle for LinkedIn posts: member
 * names exist only in the DOM, which carries no ids to join them with.
 */
const AUTHOR_PLACEHOLDER = "linkedin-member";

/** The two flagship-web endpoints that carry search posts (capture 2026-10-31). */
const LINKEDIN_RESPONSE_RE = /flagship-web\/(search\/results\/content|rsc-action\/actions\/pagination)/i;

const FLIGHT_LINE_RE = /^([0-9a-f]+):([\s\S]*)$/;
const WHOLE_REF_RE = /^\$L?([0-9a-f]+)$/;
const PATH_REF_RE = /^\$L?([0-9a-f]+):(.+)$/;
const URN_RE = /^urn:li:activity:(\d{10,})$/;
const DIGITS_RE = /^\d{10,}$/;

/**
 * Split a flight stream and JSON-parse every data row. Lines outside the
 * "hex-id":payload form, and module-manifest rows like I[...], are skipped.
 * Row order is stream order.
 */
export function parseFlightRows(body: string): Map<string, unknown> {
  const rows = new Map<string, unknown>();
  for (const line of body.split("\n")) {
    const match = FLIGHT_LINE_RE.exec(line);
    if (match === null) continue;
    try {
      rows.set(match[1] ?? "", JSON.parse(match[2] ?? ""));
    } catch {
      // module-manifest rows are not JSON; skip them
    }
  }
  return rows;
}

/**
 * Leaf strings of a textProps.children React tree: element arrays
 * (["$", type, key, props]) recurse into props.children and props.textProps
 * only, so class names, styles and action payloads stay out of the text.
 * br elements become newlines. "$<row>" strings resolve whole rows and
 * "$<row>:props.path" strings resolve path-scoped values (memoized); a
 * triple newline collapses to one paragraph break.
 */
function textFromChildren(children: unknown, rows: Map<string, unknown>): string {
  const parts: string[] = [];
  const seenRows = new Set<string>();
  const memo = new Map<string, unknown>();
  const resolve = (id: string, path: string | undefined): unknown => {
    const root: unknown = rows.get(id);
    if (root === undefined) return undefined;
    if (path === undefined) return root;
    const key = id + ":" + path;
    const cached: unknown = memo.get(key);
    if (cached !== undefined) return cached;
    let current: unknown = root;
    for (const segment of path.split(":")) {
      if (current === null || typeof current !== "object") return undefined;
      current = Array.isArray(current)
        ? current[Number(segment)]
        : (current as Record<string, unknown>)[segment];
      if (current === undefined) return undefined;
    }
    memo.set(key, current);
    return current;
  };
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      const whole = WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (rows.has(id) && !seenRows.has(id)) {
          seenRows.add(id);
          walk(rows.get(id));
        }
        return;
      }
      const scoped = PATH_REF_RE.exec(node);
      if (scoped !== null) {
        walk(resolve(scoped[1] ?? "", scoped[2]));
        return;
      }
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 0 && node[0] === "$") {
        if (node[1] === "br") {
          parts.push("\n");
          return;
        }
        const props: unknown = node[3];
        if (props !== null && typeof props === "object" && !Array.isArray(props)) {
          const record = props as Record<string, unknown>;
          if (record.children !== undefined) walk(record.children);
          if (record.textProps !== undefined) walk(record.textProps);
        }
        return;
      }
      for (const child of node) walk(child);
      return;
    }
    if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.children !== undefined) walk(record.children);
    }
  };
  walk(children);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/** Mint one Post from capture-verified facts; the id carries the timestamp. */
function mintPost(activityId: string, text: string): Post {
  const urn = "urn:li:activity:" + activityId;
  return {
    platform: "linkedin",
    id: urn,
    text,
    author: AUTHOR_PLACEHOLDER,
    permalink: "https://www.linkedin.com/feed/update/" + urn,
    timestamp: new Date(Number(BigInt(activityId) >> 22n)).toISOString(),
  };
}

/**
 * Mint every post a flight body carries, in stream order, deduped by
 * activity urn. The walk tracks the most recent activity id (activityId
 * fields, urn strings and urn object keys all register it) so a
 * commentary_text component pairs with its card; a commentary whose id has
 * not been seen yet, or whose text harvest is empty, is skipped.
 */
export function collectLinkedInPosts(body: string): Post[] {
  const rows = parseFlightRows(body);
  const posts = new Map<string, Post>();
  // Stream-order register: the id row of a card may precede (or share a row
  // with) its commentary_text row; the most recent id pairs with the marker.
  let currentId: string | null = null;
  for (const root of rows.values()) {
    const seenRows = new Set<string>();
    const visit = (node: unknown): void => {
      if (typeof node === "string") {
        const urn = URN_RE.exec(node);
        if (urn !== null) {
          currentId = urn[1] ?? null;
          return;
        }
        const whole = WHOLE_REF_RE.exec(node);
        if (whole !== null) {
          const id: string = whole[1] ?? "";
          if (rows.has(id) && !seenRows.has(id)) {
            seenRows.add(id);
            visit(rows.get(id));
          }
        }
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      if (node !== null && typeof node === "object") {
        const record = node as Record<string, unknown>;
        const activityId: unknown = record.activityId;
        if (typeof activityId === "string" && DIGITS_RE.test(activityId)) {
          currentId = activityId;
        }
        const specs: unknown = record.viewTrackingSpecs;
        if (
          specs !== null &&
          typeof specs === "object" &&
          (specs as Record<string, unknown>).legacyControlName === "commentary_text"
        ) {
          const text = textFromChildren(record.children, rows);
          if (currentId !== null && text.length > 0) {
            const id = "urn:li:activity:" + currentId;
            if (!posts.has(id)) posts.set(id, mintPost(currentId, text));
          }
          return; // the commentary subtree is text; it carries no ids
        }
        for (const key of Object.keys(record)) {
          const urnKey = URN_RE.exec(key);
          if (urnKey !== null) currentId = urnKey[1] ?? null;
        }
        for (const key of Object.keys(record)) visit(record[key]);
      }
    };
    visit(root);
  }
  return [...posts.values()];
}

/**
 * Walk one LinkedIn surface: load the search URL, wait for the initial
 * flagship-web response, then wheel-scroll until dry rounds, the round
 * ceiling (scrollRounds, the config knob shared with the Threads walk) or
 * the post cap stops the loop. Throws when no response arrives inside the
 * window or the page exposes no wheel.
 */
export async function fetchLinkedInSurface(
  context: ContextLike,
  surface: ResolvedSurface,
  scrollRounds: number,
): Promise<Post[]> {
  const page = await context.newPage();
  const posts = new Map<string, Post>();
  let responses = 0;

  // Attach before navigation: results stream through flagship-web POSTs.
  page.on("response", (response) => {
    if (posts.size >= LINKEDIN_MAX_POSTS) return;
    if (!LINKEDIN_RESPONSE_RE.test(response.url()) || response.status() !== 200) return;
    void (async () => {
      try {
        const body = await response.text();
        const parsed = collectLinkedInPosts(body);
        if (parsed.length === 0) return;
        responses += 1;
        for (const post of parsed) {
          if (!posts.has(post.id)) posts.set(post.id, post);
        }
      } catch {
        // not every flagship-web response parses; skip it
      }
    })();
  });

  try {
    await page.goto(surface.url, {
      waitUntil: "domcontentloaded",
      timeout: LINKEDIN_NAV_TIMEOUT_MS,
    });

    // The DOM carries no ids, so there is no hydration probe: the initial
    // results ride the first flagship-web response instead.
    const maxPolls = Math.ceil(
      LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS / LINKEDIN_FIRST_RESPONSE_POLL_MS,
    );
    let polls = 0;
    while (responses === 0 && polls < maxPolls) {
      await page.waitForTimeout(LINKEDIN_FIRST_RESPONSE_POLL_MS);
      polls += 1;
    }
    if (responses === 0) {
      throw new Error(
        "no flagship-web response within " + LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS + "ms — the session may be dead",
      );
    }

    // Wheel-driven pagination (nested frame; window.scrollTo is a no-op).
    const mouse = page.mouse;
    if (mouse === undefined) {
      throw new Error("page exposes no wheel — cannot drive LinkedIn pagination");
    }
    let dryRounds = 0;
    for (let round = 1; round <= scrollRounds; round += 1) {
      const before = posts.size;
      await mouse.move(LINKEDIN_WHEEL_X, LINKEDIN_WHEEL_Y);
      await mouse.wheel(0, LINKEDIN_WHEEL_DELTA_Y);
      await page.waitForTimeout(LINKEDIN_SETTLE_MS);
      const gained = posts.size - before;
      if (gained < LINKEDIN_MIN_GAIN) {
        dryRounds += 1;
        console.log(
          "fetch: " + surface.label + " scroll " + round + ": +" + gained + " (dry " + dryRounds + "/" + LINKEDIN_MAX_DRY_ROUNDS + ")",
        );
        if (dryRounds >= LINKEDIN_MAX_DRY_ROUNDS) break;
      } else {
        dryRounds = 0;
        console.log("fetch: " + surface.label + " scroll " + round + ": +" + gained);
      }
      if (posts.size >= LINKEDIN_MAX_POSTS) break;
    }

    // Let in-flight response handlers settle before the page goes away.
    await page.waitForTimeout(LINKEDIN_XHR_DRAIN_MS);
    console.log(
      "fetch: " + surface.label + " OK — " + posts.size + " post(s) from " + responses + " response(s)",
    );
    return [...posts.values()];
  } finally {
    await page.close();
  }
}
```

### src/fetch-threads.ts — MODIFY

`fetchSurfacesAuthenticated` 4th options param; second context built when `linkedinSessionPath` present; pool worker dispatches on `surface.platform`; `PageLike` gains optional `mouse`/`frame` members; imported walker wired into the dispatch.

```typescript
// --- Hunk 1: import block gains the walker (runtime import, one direction only) ---
import type { ResolvedSurface } from "./config-file.js";
import { collectThreadItems, normalizeThreadItem } from "./extract.js";
import { fetchLinkedInSurface } from "./fetch-linkedin.js";
import { sleep } from "./judge.js";
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

// --- Hunk 2: MAX_SCROLL_ROUNDS becomes the documented default (D4) ---
const RECENT_TAB_LABEL = "Recent";
/** Loop-bound default for BOTH walks; the config scrollRounds key overrides (D4). */
const MAX_SCROLL_ROUNDS = 8;

// --- Hunk 3: PageLike gains the optional wheel surface ---
/** Wheel-driven scroll controller (LinkedIn pagination; Threads scrolls via evaluate). */
export interface PageMouseLike {
  move(x: number, y: number): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
}

/** One browser page, narrowed to the surface the walks actually drive. */
export interface PageLike {
  goto(url: string, options?: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  waitForFunction(
    pageFunction: string,
    arg?: unknown,
    options?: { timeout?: number; polling?: number },
  ): Promise<void>;
  content(): Promise<string>;
  on(event: "response", listener: (response: ResponseLike) => void): void;
  locator(selector: string): LocatorLike;
  evaluate(script: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  /** Wheel controller; absent on pages that cannot wheel-scroll. */
  readonly mouse?: PageMouseLike;
  close(): Promise<void>;
}

// --- Hunk 4: the chromium adapter builds the wheel (inside newPage's adapter, before return) ---
        const mouse: PageMouseLike = {
          move: async (x, y) => {
            await page.mouse.move(x, y);
          },
          wheel: async (deltaX, deltaY) => {
            await page.mouse.wheel(deltaX, deltaY);
          },
        };
        return {
          goto: (url, options) => page.goto(url, options),
          // ...existing adapter members unchanged...
          waitForTimeout: (ms) => page.waitForTimeout(ms),
          mouse,
          close: () => page.close(),
        };

// --- Hunk 5: options object, platform dispatch, second context, paired teardown ---
/**
 * Walk-shaping options for the authenticated dispatch (D6). Both fields
 * are optional: the absent feature (no linkedin surfaces, no scrollRounds
 * key) behaves byte-identically to the pre-LinkedIn walker.
 */
export interface AuthenticatedFetchOptions {
  /** Storage-state file for the LinkedIn context; linkedin surfaces fail without it. */
  readonly linkedinSessionPath?: string;
  /** Loop bound for BOTH walks; absent means the Threads-measured default (D4). */
  readonly scrollRounds?: number;
}

/**
 * Fetch posts from the configured surfaces with authenticated sessions.
 * [existing doc paragraphs unchanged] Dispatch is platform-typed (D1):
 * threads surfaces walk the storageState context through the graphql-XHR
 * walk, linkedin surfaces walk a second context built from
 * options.linkedinSessionPath through the flagship-web walk
 * (src/fetch-linkedin.ts). The base context is built lazily (D12): a
 * dispatch with no threads surfaces never builds it. Throws when every
 * surface fails (message lists per-surface errors).
 */
export async function fetchSurfacesAuthenticated(
  surfaces: readonly ResolvedSurface[],
  storageStatePath: string,
  contextFactory: ContextFactory = chromiumContextFactory,
  options: AuthenticatedFetchOptions = {},
): Promise<Post[]> {
  // The base context is built lazily (D12): a dispatch whose surfaces are
  // all linkedin (the logged-out Threads arm; a linkedin-only config whose
  // Threads secret is set) never walks it, so eager building would open an
  // idle browser context from a path no surface reads.
  const threadsPresent = surfaces.some((surface) => surface.platform === "threads");
  const context: ContextLike | null = threadsPresent
    ? await contextFactory(storageStatePath)
    : null;
  const scrollRounds = options.scrollRounds ?? MAX_SCROLL_ROUNDS;
  let linkedinContext: ContextLike | null = null;
  try {
    if (options.linkedinSessionPath !== undefined) {
      linkedinContext = await contextFactory(options.linkedinSessionPath);
    }
    const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
    const failures: Array<string | undefined> = Array.from({ length: surfaces.length });
    const emptyLabels: Array<string | undefined> = Array.from({ length: surfaces.length });
    // Platform dispatch (D9): the caller filters surfaces it cannot walk;
    // a linkedin surface arriving with no session path is a wiring bug and
    // fails that surface (visible in the all-fail detail).
    const walkLinkedInSurface = async (
      linkedinContext: ContextLike | null,
      surface: ResolvedSurface,
      rounds: number,
    ): Promise<Post[]> => {
      if (linkedinContext === null) {
        throw new Error("linkedin surface walked without a session path");
      }
      return fetchLinkedInSurface(linkedinContext, surface, rounds);
    };
    // Mirror of the LinkedIn guard: a threads surface arriving in a
    // dispatch that built no base context is a wiring bug and fails that
    // surface (unreachable — the context exists iff a threads surface does).
    const threadsContext = (): ContextLike => {
      if (context === null) {
        throw new Error("threads surface walked without a base context");
      }
      return context;
    };
    // Same migration as fetchSurfaces (F007): the empty-surface side
    // channel rides the closure, the worker stays total.
    await runPool(surfaces, FETCH_CONCURRENCY, async (surface, index) => {
      try {
        const posts =
          surface.platform === "linkedin"
            ? await walkLinkedInSurface(linkedinContext, surface, scrollRounds)
            : await fetchOneAuthenticated(threadsContext(), surface, scrollRounds);
        console.log("extract: " + surface.label + ": " + posts.length + " post(s) (authenticated)");
        if (posts.length === 0) emptyLabels[index] = surface.label;
        perSurface[index] = posts;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures[index] = surface.label + ": " + message;
        console.warn("fetch: " + surface.label + " FAILED — " + message);
      }
    });

    // [all-fail predicate unchanged: counts POSTS, so a dead LinkedIn
    // surface inside the pool leaves Threads results intact]
    const results = perSurface.filter((posts): posts is Post[] => posts !== undefined).flat();
    if (results.length === 0) {
      const detail: string[] = failures.filter((entry): entry is string => entry !== undefined);
      const empties = emptyLabels.filter((label): label is string => label !== undefined);
      if (empties.length > 0) {
        detail.push(
          empties.join(", ") + ": 0 post(s) extracted — the Recent tab or the graphql XHR capture yielded nothing",
        );
      }
      throw new Error(
        "fetch: all " + surfaces.length + " authenticated surface(s) failed:\n" + detail.join("\n"),
      );
    }
    return results;
  } finally {
    if (linkedinContext !== null) await linkedinContext.close();
    if (context !== null) await context.close();
  }
}

// --- Hunk 6: the scroll bound threads down as a required scalar ---
/** One authenticated surface: Recent tab, XHR capture, scroll to accumulate. */
async function fetchOneAuthenticated(
  context: ContextLike,
  surface: ResolvedSurface,
  scrollRounds: number,
): Promise<Post[]> {
  // [body unchanged up to the scroll loop]
  let dryRounds = 0;
  for (let round = 1; round <= scrollRounds; round += 1) {
    // [loop body unchanged: evaluate scroll, settle, gain check, dry counter, cap]
```

### src/index.ts — MODIFY

Acquisition defuse: split surfaces by platform, resolve up to two sessions, per-platform dispatch (authenticated / logged-out / linkedin-walker skip), paired cleanups in one `finally`.

```typescript
// --- Hunk 1: the fetch-threads import gains the options type ---
import {
  type AuthenticatedFetchOptions,
  type ContextFactory,
  fetchSurfaces,
  fetchSurfacesAuthenticated,
} from "./fetch-threads.js";

// --- Hunk 2: replaces the acquisition timeStage block in runWatcher ---
  // Acquisition stage (D9): per-platform session resolution + surface
  // fetch timed as one span. Extraction happens inside the walk; the
  // dedupe count logs right after the duration line.
  const { value: collected, durationMs: fetchMs } = await timeStage(async () => {
    // D9: the platform split happens BEFORE session resolution. Each
    // platform resolves its own session variable; a null Threads session
    // keeps the existing logged-out walk, while a null LinkedIn session
    // SKIPS its surfaces with a warn (anonymous LinkedIn hits an authwall —
    // never the logged-out path).
    const threadsSurfaces = surfaces.filter((s) => s.platform === "threads");
    const linkedinSurfaces = surfaces.filter((s) => s.platform === "linkedin");
    const threadsSessionPath = await resolveSession(env);
    const linkedinSessionPath =
      linkedinSurfaces.length > 0
        ? await resolveSession(env, ENV_NAMES.linkedinSession)
        : null;
    if (linkedinSurfaces.length > 0 && linkedinSessionPath === null) {
      console.warn(
        "fetch: " +
          ENV_NAMES.linkedinSession +
          " missing or invalid — skipping " +
          linkedinSurfaces.length +
          " linkedin surface(s)",
      );
    }
    try {
      if (threadsSessionPath !== null) {
        // One authenticated dispatch carries the mixed pool: the LinkedIn
        // context is built inside the walk from linkedinSessionPath (D6),
        // and both platform types share the walk's own runPool (FR#8).
        const walkedSurfaces = linkedinSessionPath !== null ? surfaces : threadsSurfaces;
        // A linkedin-only config with no LinkedIn session walks nothing:
        // D5 degrades to warn + empty funnel + heartbeat, never a throw
        // (an empty surfaces array would trip the walker's all-fail gate).
        if (walkedSurfaces.length === 0) return [];
        const options: AuthenticatedFetchOptions =
          linkedinSessionPath !== null
            ? { linkedinSessionPath, scrollRounds: config.scrollRounds }
            : { scrollRounds: config.scrollRounds };
        return await fetchSurfacesAuthenticated(
          walkedSurfaces,
          threadsSessionPath,
          deps.contextFactory,
          options,
        );
      }
      // Threads logged-out: blob extraction per surface. A configured
      // LinkedIn surface with its own session walks alone here (rare mixed
      // config: no Threads secret but a LinkedIn one) — the walker builds
      // only the LinkedIn context for this dispatch (lazy base, D12: no
      // threads surfaces, no base context), so the base argument below is
      // vestigial and never becomes a context.
      const loggedOut =
        threadsSurfaces.length > 0
          ? await fetchLoggedOutPosts(threadsSurfaces, deps.contextFactory)
          : [];
      if (linkedinSessionPath === null) return loggedOut;
      // A walk-time dead LinkedIn session must not discard the logged-out
      // Threads results (acceptance 1, D5 — expiry is routine): the
      // LinkedIn arm's all-fail throw downgrades to a warn and zero posts,
      // and the run goes on. The mixed dispatch above needs no such guard:
      // there the side arrays already keep Threads posts alive inside one
      // call, and a total all-fail is the pre-existing throw contract.
      try {
        const linkedinPosts = await fetchSurfacesAuthenticated(
          linkedinSurfaces,
          linkedinSessionPath,
          deps.contextFactory,
          { linkedinSessionPath, scrollRounds: config.scrollRounds },
        );
        return [...loggedOut, ...linkedinPosts];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("fetch: linkedin surfaces FAILED — " + message);
        return loggedOut;
      }
    } finally {
      // F019 pairing, extended: each created session dir dies with the run.
      // Contexts close inside the walks' own finally, so these run strictly
      // after close, on both the success and the throw path.
      if (threadsSessionPath !== null) await cleanupSessionDir(threadsSessionPath);
      if (linkedinSessionPath !== null) await cleanupSessionDir(linkedinSessionPath);
    }
  });
```

### src/judge.ts — MODIFY

Neutral prompt wording: bulk lead-in (`:265`) and single-post lead-in (`:238`) drop "Threads".

```typescript
// --- Hunk 1: module header — the platform word leaves the doc (comment-only) ---
- * LLM relevance and location judge for candidate Threads posts (FRD #4, #5, D3).
+ * LLM relevance and location judge for candidate posts (FRD #4, #5, D3).

// --- Hunk 2: single-post lead-in (buildMessages user content, :238) ---
    {
      role: "user",
      content: `Analyze the following post by @${post.author}:\n\n\"${post.text}\"\n\nDetermine two criteria:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above. Set false if it is a job seeker seeking work, an internship inquiry, a training promotion, or an unrelated role.\n2. locationOk: true ONLY if the job is located in Indonesia (e.g. Jakarta, Bali, Surabaya, hybrid in ID), or explicitly remote / work from anywhere. Set false if the role is on-site or hybrid in another country with no remote option.\n\nRespond with ONLY a raw JSON object matching this schema:\n{"relevant": boolean, "locationOk": boolean}`,
    },

// --- Hunk 3: bulk lead-in (buildBulkMessages user content, :265) ---
    {
      role: "user",
      content: `Judge each post below against the criteria.\n\n${listing}\n\nDetermine two criteria per post:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above. Set false if it is a job seeker seeking work, an internship inquiry, a training promotion, or an unrelated role.\n2. locationOk: true ONLY if the job is located in Indonesia (e.g. Jakarta, Bali, Surabaya, hybrid in ID), or explicitly remote / work from anywhere. Set false if the role is on-site or hybrid in another country with no remote option.\n\nRespond with ONLY a raw JSON object mapping EACH post id above to its verdict, exactly like:\n{"<post id>": {"relevant": boolean, "locationOk": boolean}}`,
    },
```

### src/email.ts — MODIFY

`buildSubject` conditional "+ LinkedIn" suffix; `buildDigest` item lines gain the `[linkedin]` token for non-Threads posts.

```typescript
// --- Hunk 1: header doc — platform-neutral (comment-only) ---
- * Formats new relevant Threads job posts into a clean plain-text email digest
+ * Formats new relevant job posts into a clean plain-text email digest

// --- Hunk 2: buildSubject gains the conditional suffix (D10) ---
export function buildSubject(posts: readonly Post[]): string | null {
  if (posts.length === 0) return null;
  const count = posts.length;
  const plural = count === 1 ? "" : "s";
  // D10: the suffix rides only when at least one LinkedIn match is present;
  // an all-Threads subject stays byte-identical to the pre-LinkedIn pin.
  const suffix = posts.some((post) => post.platform !== "threads") ? " + LinkedIn" : "";
  return `${count} new job post${plural} on Threads${suffix} (#hiring indonesia)`;
}

// --- Hunk 3: buildDigest item lines gain the [linkedin] token (D10) ---
  const items = posts.map((post, index) => {
    const author = post.author.replace(/^@+/, "");
    const platformToken = post.platform === "threads" ? "" : "[linkedin] ";
    return `${index + 1}. ${platformToken}${post.text}\n   — @${author}\n   ${post.permalink}`;
  });
```

### .github/workflows/watch.yml — MODIFY

`LINKEDIN_SESSION_STATE: ${{ secrets.LINKEDIN_SESSION_STATE }}` beside `THREADS_SESSION_STATE` in the Run watcher step env.

```yaml
# --- "Run watcher" step env: the LinkedIn secret joins beside the Threads one (1:1 name mirroring) ---
          THREADS_SESSION_STATE: ${{ secrets.THREADS_SESSION_STATE }}
          LINKEDIN_SESSION_STATE: ${{ secrets.LINKEDIN_SESSION_STATE }}   # absent secret => resolver null => LinkedIn surfaces skip (src/threads-session.ts)
```

### watcher.config.json — MODIFY

One linkedin surface entry joins the surfaces array, appended last. No other key changes: `reasoningEffort` and `scrollRounds` stay absent (optional keys; `scrollRounds` defaults to 8 per D4/`readScrollRounds`), matching the byte-identity bar in D11 for everything except the declared new surface.

```json
  "surfaces": [
    { "type": "tag", "value": "hiring" },
    { "type": "tag", "value": "loker" },
    { "type": "tag", "value": "infokerja" },
    { "type": "url", "value": "https://www.threads.com/@hiresflow" },
    { "type": "url", "value": "https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent" },
    { "type": "url", "value": "https://www.threads.com/search?q=Loker%20jakarta&serp_type=deeplink&filter=recent" },
    { "type": "url", "value": "https://www.threads.com/search?q=Loker%20IT&serp_type=default&filter=recent" },
    { "type": "url", "value": "https://www.threads.com/search?q=Loker%20IT%20Jakarta&serp_type=tags&filter=recent" },
    { "type": "url", "value": "https://www.threads.com/search?q=techthreads&serp_type=tags&filter=recent" },
    { "type": "linkedin", "value": "#hiring frontend developer indonesia" }
  ],
```

### README.md — MODIFY

Seven hunks: A = intro names both platforms; B = pipeline list gains a LinkedIn step (renumbered 9 → 10 steps; carried steps keep their bodies verbatim except three declared tweaks — step 1 narrows to "every Threads surface" because step 2 now owns LinkedIn, the dedupe step gains "and platforms", and the digest step (8) gains the D10 marking clause); C = secrets table row; D = surfaces table row covers the linkedin type; E = scrollRounds table row; F = linkedin surface example beside the existing url example; G = new "Refresh the LinkedIn session" section (9e1c8ef README pattern: secrets table row + session-export section).

Hunk A — intro paragraph (replace):

```markdown
Threads + LinkedIn #hiring Indonesia job alerts. A GitHub Actions workflow
loads the surfaces listed in `watcher.config.json` every 10 minutes, has an
LLM judge posts against the configured keywords (Indonesia or remote roles),
and emails new matches as a plain-text digest. No web UI; the only
persistence is `state/seen-posts.json`.
```

Hunk B — "## Pipeline" ordered list (full replacement):

```markdown
1. Playwright loads every Threads surface listed in `watcher.config.json` —
   tag pages, profile pages and search URLs. With `THREADS_SESSION_STATE`
   set it signs in, clicks the **Recent** tab where one exists, and reads
   posts from the `graphql` XHR responses; otherwise it loads each surface
   logged out and reads posts from the embedded `data-sjs` JSON blobs.
2. LinkedIn surfaces are walked with a signed-in session from
   `LINKEDIN_SESSION_STATE`, reading posts from the LinkedIn flagship-web
   search responses. With that secret unset or invalid, those surfaces are
   skipped with a warning and the run continues on Threads alone.
3. Posts are deduplicated across surfaces and platforms.
4. Posts older than `recencyHours` are dropped.
5. Posts already in `state/seen-posts.json` are dropped.
6. Every surviving post goes to the LLM judge in ~10-post bulk calls. The
   `keywords` list is sent as the relevance criterion; a post the bulk
   response misses falls back to a single-post call. A batch the endpoint
   does not answer is deferred whole — those posts stay unseen and retry
   on the next run. Accounts come from the `LLM_ACCOUNTS` pool: an HTTP 429
   cools that account for 60 seconds and dispatches re-scan past cooling
   accounts; when every account is cooling, calls park up to a shared
   3-minute wait budget, then an exhausted pool sends one alarm email and
   fails the run. Up to `JUDGE_CONCURRENCY`
   batches run at once, so a 280-post backlog judges in about 3 minutes
   instead of 13.
7. Each candidate gets a `{relevant, locationOk}` verdict. A judgment that
   fails is skipped — the post stays unseen and retries on the next run.
8. New relevant + located posts are emailed as the job digest; LinkedIn
   item lines carry a `[linkedin]` marker and the subject appends
   `+ LinkedIn` when at least one LinkedIn post matched.
9. On match runs the state file is committed back as `github-actions[bot]`.
10. **Zero-match runs email a status digest instead** — the scan funnel plus
    the closest candidate posts with their permalinks — so a quiet run is
    still legible. Set `HEARTBEAT_ENABLED=false` to turn it off.
```

Hunk C — Setup secrets table: row appended directly after the `THREADS_SESSION_STATE` row:

```markdown
   | `THREADS_SESSION_STATE` | base64 storageState | Threads login session (see below) |
   | `LINKEDIN_SESSION_STATE` | base64 storageState | LinkedIn login session (see below) |
```

Hunk D — "Configure what to watch" table: the `surfaces` row is replaced with:

```markdown
| `surfaces` | What to sample. Each entry is `{ "type": "tag", "value": "hiring" }`, `{ "type": "url", "value": "https://www.threads.com/@someone" }`, or `{ "type": "linkedin", "value": "#hiring ..." }`. Tags build `threads.com/tag/<value>`; URLs are used verbatim and must be `https://www.threads.com/...`; linkedin entries build a LinkedIn content search (newest first, past 24 hours) from a keywords string and need `LINKEDIN_SESSION_STATE`. |
```

Hunk E — same table, new `scrollRounds` row appended directly after the `reasoningEffort` row:

```markdown
| `scrollRounds` | Upper bound on scroll rounds per surface walk, shared by the Threads scroll loop and LinkedIn pagination. Must be a whole number >= 1; absent defaults to `8`. |
```

Hunk F — after the existing "Adding a profile or a search URL is the same edit as adding a tag:" json example block, a sibling paragraph + example is inserted:

````markdown
A LinkedIn content search is the same kind of edit — a keywords string, not
a URL:

```json
{ "type": "linkedin", "value": "#hiring frontend developer indonesia" }
```
````

Hunk G — new section `## Refresh the LinkedIn session` (exact H2 heading, named here rather than inside the fence so it cannot parse as an artifact-level section) inserted between the "Refresh the Threads session" section and "## Local run". The fence carries the section body:

````markdown
LinkedIn content search is logged-in-only — an anonymous page hits an
authwall, so unlike Threads there is no logged-out fallback. LinkedIn
surfaces walk a session from `LINKEDIN_SESSION_STATE`; with the secret
unset or invalid they are skipped with a warning naming the variable, and
the run continues on Threads alone.

1. Log in to linkedin.com in a regular Firefox session.
2. Export the cookies for `.linkedin.com` as a Playwright storageState
   document and convert it exactly as in the Threads section above — the
   same `sameSite` mapping and `{ "cookies": [...], "origins": [] }`
   wrapper apply. Keep `li_at` (the session cookie); the remaining
   `.linkedin.com` cookies can ride along.
3. Base64-encode the file and set the secret:

   ```bash
   gh secret set LINKEDIN_SESSION_STATE < linkedin-state.json.b64
   ```

The session lasts roughly a year (`li_at` expiry). When runs start logging
the skip warning, or linkedin surfaces log `FAILED` while Threads surfaces
stay healthy, repeat the export. LinkedIn also kills sessions server-side;
that is routine and looks the same — a fresh export fixes it.
````

### scripts/probe-judge.ts — MODIFY

The synthetic probe post literal gains `platform: "threads"` (typecheck covers `scripts/`).

```typescript
// --- syntheticPost gains the platform stamp (typecheck covers scripts/) ---
function syntheticPost(index: number): Post {
  const text = FIXTURE_TEXTS[index % FIXTURE_TEXTS.length] ?? "";
  return {
    platform: "threads",
    id: `90000000000000000${index}`,
    author: `probe${index}`,
    permalink: `https://www.threads.com/@probe${index}/post/90000000000000000${index}`,
    timestamp: "2026-10-26T00:00:00.000Z",
    text,
  };
}
```

### tests/config-file.test.ts — MODIFY

Existing resolveSurfaces deepEquals gain `platform: "threads"`; new cases: linkedin accepts, empty/non-string value rejects, unknown type still rejects, byte-exact URL assertion, scrollRounds "five"/5.5/0 reject + default-8 accepts.

```typescript
// --- Existing resolveSurfaces deepEqual literals gain platform: "threads";
// the unknown-type pin (regex /surface "type" must be/) still matches the new message.
describe("resolveSurfaces", () => {
  it("builds the tag-page URL and label", () => {
    const resolved = resolveSurfaces([{ type: "tag", value: "hiring" }]);
    assert.deepEqual(resolved, [
      {
        platform: "threads",
        label: "tag/hiring",
        url: "https://www.threads.com/tag/hiring",
      },
    ]);
  });

  it("uses a url surface verbatim", () => {
    const url = "https://www.threads.com/@hiresflow";
    const resolved = resolveSurfaces([{ type: "url", value: url }]);
    assert.deepEqual(resolved, [{ platform: "threads", label: url, url }]);
  });

  it("percent-encodes a tag that needs it", () => {
    const resolved = resolveSurfaces([{ type: "tag", value: "a b" }]);
    assert.equal(resolved[0]?.url, "https://www.threads.com/tag/a%20b");
  });

  // --- New: linkedin arm ---
  it("builds a linkedin content-search URL byte-exactly", () => {
    const resolved = resolveSurfaces([
      { type: "linkedin", value: "#hiring engineer developer jakarta" },
    ]);
    assert.deepEqual(resolved, [
      {
        platform: "linkedin",
        label: "linkedin/#hiring engineer developer jakarta",
        url:
          "https://www.linkedin.com/search/results/content/?keywords=%23hiring%20engineer%20developer%20jakarta&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D",
      },
    ]);
  });
});

// --- New cases in the "loadWatcherConfig — failures" describe ---
  it("accepts a linkedin surface", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "linkedin", value: "#hiring" }],
    });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.surfaces, [{ type: "linkedin", value: "#hiring" }]);
  });

  it("rejects an empty linkedin surface value", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "linkedin", value: "   " }],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /surface "value" must be a non-empty string/,
    );
  });

  it("rejects a non-string linkedin surface value", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [{ type: "linkedin", value: 123 }],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /surface "value" must be a non-empty string/,
    );
  });

// --- New describe (mirrors the reasoningEffort pin shape) ---
describe("scrollRounds", () => {
  it("defaults to 8 when absent", async () => {
    const path = await writeConfig({ ...VALID });
    const config = await loadWatcherConfig(path);
    assert.equal(config.scrollRounds, 8);
  });

  it("accepts a positive integer", async () => {
    const path = await writeConfig({ ...VALID, scrollRounds: 5 });
    const config = await loadWatcherConfig(path);
    assert.equal(config.scrollRounds, 5);
  });

  it("rejects a fractional value", async () => {
    const path = await writeConfig({ ...VALID, scrollRounds: 5.5 });
    await assert.rejects(() => loadWatcherConfig(path), /"scrollRounds" must be an integer >= 1/);
  });

  it("rejects zero", async () => {
    const path = await writeConfig({ ...VALID, scrollRounds: 0 });
    await assert.rejects(() => loadWatcherConfig(path), /"scrollRounds" must be an integer >= 1/);
  });

  it("rejects a non-numeric value", async () => {
    const path = await writeConfig({ ...VALID, scrollRounds: "five" });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /"scrollRounds" must be an integer >= 1, got "five"/,
    );
  });
});
```

### tests/fetch-threads.test.ts — MODIFY

surface() helper gains `platform`; new pins: mixed-surface run keeps Threads posts while the linkedin surface lands in failures (acceptance pin), dispatch routing, scrollRounds:5 oracle, one-context linkedin-only dispatch (D12).

```typescript
// --- surface() helper gains the platform stamp (the only ResolvedSurface
// literal outside resolveSurfaces; Slice 3's dispatch pins merge below) ---
const surface = (label: string): ResolvedSurface => ({
  platform: "threads",
  label,
  url: `https://www.threads.com/${label}`,
});

// --- fakeContextFactory options gain the dispatch surfaces (existing fields unchanged) ---
function fakeContextFactory(options: {
  concurrency: { inFlight: number; peak: number };
  failUrls?: ReadonlySet<string>;
  xhrBySubstring?: ReadonlyMap<string, string>;
  /** Flagship-web bodies fired with a linkedin URL (the walker's filter accepts these). */
  linkedinBodiesBySubstring?: ReadonlyMap<string, string>;
  /** Storage-state path per context creation, in creation order. */
  sessionPaths?: string[];
  /** One staged body per wheel round of the LinkedIn walk. */
  wheelBodies?: readonly string[];
  /** Per-round wheel counter — the LinkedIn walk's round oracle. */
  wheel?: { calls: number };
  closed?: { value: boolean };
  evaluate?: { calls: number };
  scrollBodies?: readonly string[];
  recentTabVisible?: boolean;
  recentTabClicks?: number[];
  settleWaits?: number[];
}): ContextFactory {
  const failUrls = options.failUrls ?? new Set<string>();
  const xhrBySubstring = options.xhrBySubstring ?? new Map<string, string>();
  const scrollBodies = options.scrollBodies ?? [];
  return async (storageStatePath?: string) => {
    options.sessionPaths?.push(storageStatePath ?? "");
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        // [inFlight/peak tracking unchanged]
        let open = true;
        const listeners: Array<(response: ResponseLike) => void> = [];
        const fire = (response: ResponseLike): void => {
          for (const listener of listeners) listener(response);
        };
        const page: PageLike = {
          goto: async (url: string) => {
            if ([...failUrls].some((fragment) => url.includes(fragment))) {
              throw new Error("navigation failed for " + url);
            }
            const linkedinEntry = [...(options.linkedinBodiesBySubstring ?? new Map()).entries()].find(
              ([fragment]) => url.includes(fragment),
            );
            if (linkedinEntry !== undefined) {
              fire({
                url: () => "https://www.linkedin.com/flagship-web/search/results/content/?keywords=x",
                status: () => 200,
                text: async () => linkedinEntry[1],
              });
              return undefined;
            }
            const entry = [...xhrBySubstring.entries()].find(([fragment]) => url.includes(fragment));
            if (entry !== undefined) fire(graphqlResponse(entry[1]));
            return undefined;
          },
          // [waitForFunction/content/on/locator unchanged; evaluate now
          // wraps its staged body in graphqlResponse for the re-typed fire]
          evaluate: async () => {
            const round = (options.evaluate?.calls ?? 0) + 1;
            if (options.evaluate !== undefined) options.evaluate.calls = round;
            const body = scrollBodies[round - 1];
            if (body !== undefined) fire(graphqlResponse(body));
            return undefined;
          },
          waitForTimeout: async (ms: number) => {
            options.settleWaits?.push(ms);
            return undefined;
          },
          mouse: {
            move: async () => undefined,
            wheel: async () => {
              const round = (options.wheel?.calls ?? 0) + 1;
              if (options.wheel !== undefined) options.wheel.calls = round;
              const body = options.wheelBodies?.[round - 1];
              if (body !== undefined) {
                fire({
                  url: () => "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination",
                  status: () => 200,
                  text: async () => body,
                });
              }
            },
          },
          close: async () => {
            if (!open) return;
            open = false;
            options.concurrency.inFlight -= 1;
          },
        };
        return page;
      },
      addInitScript: async () => undefined,
      close: async () => {
        if (options.closed !== undefined) options.closed.value = true;
      },
    };
    return context;
  };
}

// --- new describe appended after the existing fetchSurfacesAuthenticated describe ---
describe("fetchSurfacesAuthenticated — platform dispatch", () => {
  const LINKEDIN_ID = "7522028760582447104"; // capture-verified epoch id

  /** Minimal flagship-web flight body: one activityUrn row + one commentary_text row. */
  const linkedinBody = (id: string): string =>
    [
      "1:" + JSON.stringify({ tracking: { activityUrn: { activityId: id } } }),
      "2:" + JSON.stringify([
        "$",
        "$Lmark",
        null,
        {
          viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
          children: ["$", "$Ldiv", null, { textProps: { children: ["LinkedIn hiring post " + id] } }],
        },
      ]),
    ].join("\n");

  const linkedinSurfaceEntry = (): ResolvedSurface => ({
    platform: "linkedin",
    label: "linkedin/kw",
    url: "https://www.linkedin.com/search/results/content/?keywords=kw",
  });

  it("keeps Threads posts when a linkedin surface has no session path", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/ok"), linkedinSurfaceEntry()],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/ok", graphqlBody(id19(1))]]),
      }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1)],
    ); // the LinkedIn failure never discards Threads results (acceptance pin)
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) =>
        /linkedin\/kw FAILED — linkedin surface walked without a session path/.test(line),
      ),
    );
  });

  it("walks a linkedin surface through a second context built from its session path", async () => {
    const sessionPaths: string[] = [];
    const closed = { value: false };

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/ok"), linkedinSurfaceEntry()],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/ok", graphqlBody(id19(1))]]),
        // keyed by a NAV-URL substring (the label "linkedin/kw" never occurs in the URL)
        linkedinBodiesBySubstring: new Map([["search/results/content", linkedinBody(LINKEDIN_ID)]]),
        sessionPaths,
        closed,
      }),
      { linkedinSessionPath: "li-state.json" },
    );

    assert.deepEqual(sessionPaths, ["session-state.json", "li-state.json"]); // two contexts
    assert.equal(result.length, 2);
    const linkedinPost = result[1];
    assert.equal(linkedinPost?.platform, "linkedin");
    assert.equal(linkedinPost?.id, "urn:li:activity:" + LINKEDIN_ID);
    assert.equal(
      linkedinPost?.permalink,
      "https://www.linkedin.com/feed/update/urn:li:activity:" + LINKEDIN_ID,
    );
    assert.equal(closed.value, true); // both contexts tear down
  });

  it("bounds the Threads scroll loop with scrollRounds: 5 while every round gains", async () => {
    const evaluate = { calls: 0 };
    const scrollBodies = [1, 2, 3, 4, 5, 6, 7, 8].map((round) =>
      graphqlBodyMany([id19(3 * round - 1), id19(3 * round), id19(3 * round + 1)]),
    );

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/bounded")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/bounded", graphqlBody(id19(1))]]),
        evaluate,
        scrollBodies,
      }),
      { scrollRounds: 5 },
    );

    assert.equal(result.length, 16); // 1 captured at goto + 5 rounds x 3 posts
    assert.equal(evaluate.calls, 5); // the config knob, not the 8-round default
  });

  it("builds one context for a linkedin-only dispatch (D12: no idle base)", async () => {
    const sessionPaths: string[] = [];
    const closed = { value: false };

    const result = await fetchSurfacesAuthenticated(
      [linkedinSurfaceEntry()],
      "session-state.json", // vestigial base path: never becomes a context
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        linkedinBodiesBySubstring: new Map([["search/results/content", linkedinBody(LINKEDIN_ID)]]),
        sessionPaths,
        closed,
      }),
      { linkedinSessionPath: "li-state.json" },
    );

    assert.deepEqual(sessionPaths, ["li-state.json"]); // the base path built nothing
    assert.equal(result.length, 1);
    assert.equal(closed.value, true);
  });
});
```

### tests/fetch-linkedin.test.ts — NEW

Offline suite: RSC parse (trimmed fixture from captured bodies), urn->timestamp, permalink construction, dedupe-safe id form, wheel-scroll round accounting + dry-stop.

```typescript
/**
 * Offline suite for the LinkedIn walker (Slice 3).
 *
 * The flight bodies are synthetic literals built in the captured field
 * layout — commentary_text view marker, textProps.children React element
 * trees, activityUrn.activityId ids, "$<row>" / "$<row>:path" references
 * (evidence: .rpiv/tmp/pw/body-*.txt, capture 2026-10-31; one real minting
 * row transitively pulls ~380KB of stream, so the rows are documented here
 * in trimmed form). Every case injects a ContextLike double — importing
 * this file never loads Playwright.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedSurface } from "../src/config-file.js";
import { collectLinkedInPosts, fetchLinkedInSurface, parseFlightRows } from "../src/fetch-linkedin.js";
import type { ContextLike, LocatorLike, PageLike, ResponseLike } from "../src/fetch-threads.js";

/** Capture-verified ids: BigInt(id) >> 22n pins both epochs (research 2026-10-31). */
const ID_A = "7522028760582447104"; // 2026-10-30T20:16:49.059Z
const ID_B = "7522121950970900481"; // 2026-10-31T02:27:07.379Z

const linkedinSurface = (label: string): ResolvedSurface => ({
  platform: "linkedin",
  label,
  url: "https://www.linkedin.com/search/results/content/?keywords=" + encodeURIComponent(label),
});

/** One flight line. */
const row = (id: string, payload: unknown): string => id + ":" + JSON.stringify(payload);

let cardSeq = 0;

/** Self-contained card stream: the activityUrn row precedes the commentary_text row. */
const cardBody = (id: string, text: string): string => {
  const n = (cardSeq += 1) * 10;
  return [
    row(String(n), { tracking: { activityUrn: { activityId: id } } }),
    row(String(n + 1), [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: [text] } }],
      },
    ]),
  ].join("\n");
};

/** One captured card, trimmed: strong/br elements, a plain string, and a
 * "$3:textProps.children" shared-subtree path reference in the text. */
const richCardBody = (): string =>
  [
    row("1", { tracking: { activityUrn: { activityId: ID_A } } }),
    row("2", [
      "$",
      "$L3",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: [
          "$",
          "$Ltext",
          null,
          {
            textProps: {
              fontFamily: "sans",
              children: [
                ["$", "strong", "text-attr-0", { children: ["WE ARE HIRING"] }],
                ["$", "br", "0", {}],
                "Calling new grads in Vancouver.",
                "$3:textProps:children",
              ],
            },
          },
        ],
      },
    ]),
    row("3", { textProps: { children: ["Shared tail"] } }),
  ].join("\n");

/**
 * Context double: the page fires the initial body at goto time and one
 * staged body per wheel round — the same async shape as a real capture.
 * Tracks wheel calls, waitForTimeout durations, and page teardown.
 */
function fakeContext(options: {
  initialBody?: string;
  wheelBodies?: readonly string[];
  wheel?: { calls: number };
  settleWaits?: number[];
  closed?: { value: boolean };
  gotoError?: Error;
  noWheel?: boolean;
}): ContextLike {
  return {
    newPage: async (): Promise<PageLike> => {
      const listeners: Array<(response: ResponseLike) => void> = [];
      let open = true;
      const fire = (body: string): void => {
        const response: ResponseLike = {
          url: () => "https://www.linkedin.com/flagship-web/search/results/content/?keywords=x",
          status: () => 200,
          text: async () => body,
        };
        for (const listener of listeners) listener(response);
      };
      const wheel = options.wheel ?? { calls: 0 };
      if (options.wheel === undefined) options.wheel = wheel;
      const page: PageLike = {
        goto: async () => {
          if (options.gotoError !== undefined) throw options.gotoError;
          if (options.initialBody !== undefined) fire(options.initialBody);
          return undefined;
        },
        waitForFunction: async () => undefined,
        content: async () => "<html></html>",
        on: (_event, listener) => {
          listeners.push(listener);
          return undefined;
        },
        locator: (): LocatorLike => {
          throw new Error("locator not expected on the LinkedIn page");
        },
        evaluate: async () => undefined,
        waitForTimeout: async (ms: number) => {
          options.settleWaits?.push(ms);
        },
        ...(options.noWheel
          ? {}
          : {
              mouse: {
                move: async () => undefined,
                wheel: async () => {
                  const round = wheel.calls + 1;
                  wheel.calls = round;
                  const body = options.wheelBodies?.[round - 1];
                  if (body !== undefined) fire(body);
                },
              },
            }),
        close: async () => {
          if (!open) return;
          open = false;
        },
      };
      return page;
    },
    addInitScript: async () => undefined,
    close: async () => {
      if (options.closed !== undefined) options.closed.value = true;
    },
  };
}

describe("collectLinkedInPosts", () => {
  it("mints the capture-verified card: path-ref text, urn id, id-derived timestamp", () => {
    const posts = collectLinkedInPosts(richCardBody());
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0], {
      platform: "linkedin",
      id: "urn:li:activity:" + ID_A,
      text: "WE ARE HIRING\nCalling new grads in Vancouver.Shared tail",
      author: "linkedin-member",
      permalink: "https://www.linkedin.com/feed/update/urn:li:activity:" + ID_A,
      timestamp: "2026-10-30T20:16:49.059Z",
    });
  });

  it("dedupes a repeated activity id, keeping the first mint", () => {
    const body = [cardBody(ID_A, "first"), cardBody(ID_A, "second")].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [["urn:li:activity:" + ID_A, "first"]],
    );
  });

  it("preserves stream order across two cards", () => {
    const body = [cardBody(ID_A, "a"), cardBody(ID_B, "b")].join("\n");
    assert.deepEqual(
      collectLinkedInPosts(body).map((post) => post.id),
      ["urn:li:activity:" + ID_A, "urn:li:activity:" + ID_B],
    );
  });

  it("skips module-manifest rows and garbage lines around the data rows", () => {
    const body = ['0:I["$1",[],"default"]', "not-a-flight-line", richCardBody()].join("\n");
    assert.equal(collectLinkedInPosts(body).length, 1);
  });

  it("skips a commentary_text card whose activity id has not been seen", () => {
    const markerOnly = row("7", [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: ["orphan"] } }],
      },
    ]);
    assert.deepEqual(collectLinkedInPosts(markerOnly), []);
  });

  it("skips a card whose text harvest is empty", () => {
    const n = (cardSeq += 1) * 10;
    const body = [
      row(String(n), { tracking: { activityUrn: { activityId: ID_A } } }),
      row(String(n + 1), [
        "$",
        "$Lmark",
        null,
        {
          viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
          children: ["$", "$Ldiv", null, { textProps: { children: [["$", "br", "0", {}]] } }],
        },
      ]),
    ].join("\n");
    assert.deepEqual(collectLinkedInPosts(body), []); // br-only text trims to ""
  });
});

describe("parseFlightRows", () => {
  it("parses data rows in stream order and skips module rows", () => {
    const rows = parseFlightRows(
      ['0:I["$1",[],"default"]', row("1", { a: 1 }), row("2", [1, 2])].join("\n"),
    );
    assert.deepEqual([...rows.keys()], ["1", "2"]);
    assert.deepEqual(rows.get("1"), { a: 1 });
  });
});

describe("fetchLinkedInSurface", () => {
  it("mints the initial response and staged wheel pages in order, then drains", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const wheel = { calls: 0 };
    const settleWaits: number[] = [];

    const posts = await fetchLinkedInSurface(
      fakeContext({
        initialBody: cardBody(ID_A, "a"),
        wheelBodies: [
          [cardBody("7522130389847670784", "b1"), cardBody("7522130389847670785", "b2")].join("\n"),
          [cardBody("7522130389847670786", "c1"), cardBody("7522130389847670787", "c2")].join("\n"),
        ],
        wheel,
        settleWaits,
      }),
      linkedinSurface("linkedin/#hiring"),
      8,
    );

    assert.deepEqual(
      posts.map((post) => post.id),
      [
        "urn:li:activity:" + ID_A,
        "urn:li:activity:7522130389847670784",
        "urn:li:activity:7522130389847670785",
        "urn:li:activity:7522130389847670786",
        "urn:li:activity:7522130389847670787",
      ],
    );
    assert.equal(wheel.calls, 5); // rounds 1-2 gain, rounds 3-5 go dry (3/3)
    assert.equal(settleWaits[0], 2500); // the scroll settle rides before the drain
    assert.equal(settleWaits[settleWaits.length - 1], 1500);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /linkedin\/#hiring OK — 5 post\(s\) from 3 response\(s\)/.test(line)),
      "no OK line in: " + JSON.stringify(lines),
    );
  });

  it("re-minting an already-seen id keeps the first mint across responses", async () => {
    const posts = await fetchLinkedInSurface(
      fakeContext({
        initialBody: cardBody(ID_A, "first"),
        wheelBodies: [[cardBody(ID_A, "second"), cardBody(ID_B, "b")].join("\n")],
      }),
      linkedinSurface("linkedin/#hiring"),
      8,
    );
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [
        ["urn:li:activity:" + ID_A, "first"],
        ["urn:li:activity:" + ID_B, "b"],
      ],
    );
  });

  it("stops after 3 dry wheel rounds and logs the dry counter", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const wheel = { calls: 0 };

    const posts = await fetchLinkedInSurface(
      fakeContext({ initialBody: cardBody(ID_A, "a"), wheel }),
      linkedinSurface("linkedin/#hiring"),
      8,
    );

    assert.equal(posts.length, 1);
    assert.equal(wheel.calls, 3); // the dry counter stops the walk, not the ceiling
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /\(dry 3\/3\)/.test(line)));
  });

  it("bounds the walk with scrollRounds while every round still gains", async () => {
    const wheel = { calls: 0 };
    const gaining = (a: string, b: string): string => [cardBody(a, a), cardBody(b, b)].join("\n");

    const posts = await fetchLinkedInSurface(
      fakeContext({
        initialBody: cardBody(ID_A, "a"),
        wheelBodies: [
          gaining("7522130389847670784", "7522130389847670785"),
          gaining("7522130389847670786", "7522130389847670787"),
          gaining("7522130389847670788", "7522130389847670789"),
        ],
        wheel,
      }),
      linkedinSurface("linkedin/#hiring"),
      2,
    );

    assert.equal(posts.length, 5); // 1 initial + 2 rounds x 2 posts
    assert.equal(wheel.calls, 2); // the ceiling stops the walk, not dry rounds
  });

  it("breaks on the post cap after one wheel round", async () => {
    const wheel = { calls: 0 };
    const ids = Array.from({ length: 150 }, (_, i) => (7500000000000000000n + BigInt(i)).toString());
    const body = ids.map((id) => cardBody(id, "post " + id)).join("\n");

    const posts = await fetchLinkedInSurface(
      fakeContext({ initialBody: body, wheel, wheelBodies: [cardBody(ID_A, "late")] }),
      linkedinSurface("linkedin/#hiring"),
      8,
    );

    assert.equal(posts.length, 150);
    assert.equal(wheel.calls, 1); // the cap break fires after round 1's dry log
    assert.ok(posts.every((post) => post.id !== "urn:li:activity:" + ID_A));
  });

  it("throws when no flagship-web response arrives inside the window", async () => {
    await assert.rejects(
      () => fetchLinkedInSurface(fakeContext({}), linkedinSurface("linkedin/#hiring"), 8),
      /no flagship-web response within 30000ms/,
    );
  });

  it("throws when the page exposes no wheel", async () => {
    await assert.rejects(
      () =>
        fetchLinkedInSurface(
          fakeContext({ initialBody: cardBody(ID_A, "a"), noWheel: true }),
          linkedinSurface("linkedin/#hiring"),
          8,
        ),
      /page exposes no wheel/,
    );
  });

  it("propagates a goto failure as a thrown error", async () => {
    await assert.rejects(
      () =>
        fetchLinkedInSurface(
          fakeContext({ gotoError: new Error("navigation failed") }),
          linkedinSurface("linkedin/#hiring"),
          8,
        ),
      /navigation failed/,
    );
  });
});
```

### tests/index.test.ts — MODIFY

CONFIG gains `scrollRounds: 8` (Slice 1); Slice 4 adds the mixed-platform fixtures and doubles, the urn-aware bulk-id mock regex, and the four acquisition pins. Slice 5 landed the two bulk-dispatch mock lead-ins here (`judgeFetch`, `partialBulkThenFailFetch`) in the same lockstep edit as `src/judge.ts` (D3, 7-site).

```typescript
// --- Slice 1: CONFIG gains scrollRounds ---
const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: ["hiring", "loker"],
  surfaces: [{ type: "tag", value: "hiring" }],
  recencyHours: 72,
  reasoningEffort: "medium",
  scrollRounds: 8,
};

// --- Slice 4, Hunk 1: MIXED_CONFIG after CONFIG ---
/** Mixed-platform config: the tag surface plus one linkedin surface. */
const MIXED_CONFIG: WatcherConfig = {
  ...CONFIG,
  surfaces: [{ type: "tag", value: "hiring" }, { type: "linkedin", value: "#hiring" }],
};

// --- Slice 4, Hunk 2: after graphqlBody — LinkedIn flight fixtures + a
// logged-out page fixture (minimal card, same shape as the
// fetch-threads/fetch-linkedin suite doubles; the blob rides extractPosts'
// generic thread_items walk) ---
/** LinkedIn activity id whose embedded epoch ms equals the pinned NOW. */
const linkedinIdNow = (BigInt(NOW) << 22n).toString();

/** Minimal flagship-web flight body: one activityUrn row + one commentary_text row. */
const linkedinCardBody = (id: string): string =>
  [
    `1:${JSON.stringify({ tracking: { activityUrn: { activityId: id } } })}`,
    `2:${JSON.stringify([
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: [`LinkedIn hiring post ${id}`] } }],
      },
    ])}`,
  ].join("\n");

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

// --- Slice 4, Hunk 3: after singlePageContextFactory — the URL-dispatching double ---
/**
 * Context-factory double for the platform-split acquisition (Slice 4):
 * each page dispatches on its goto URL — threads URLs fire the graphql
 * capture (authenticated walk) or deliver threadsHtml via content()
 * (logged-out walk), linkedin URLs fire a flagship-web flight body from
 * the initial response. Records every requested URL and every storage-state
 * path so a test can pin which surfaces were walked and that both session
 * temp dirs were cleaned.
 */
function dualPlatformContextFactory(options: {
  threadsCapture: string;
  linkedinBody: string;
  /** Page HTML for the logged-out Threads walk; absent = bare hydrated page. */
  threadsHtml?: string;
  /** Thrown by goto on linkedin URLs — forces a walk-time LinkedIn failure. */
  linkedinGotoError?: Error;
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
            if (url.includes("linkedin.com")) {
              if (options.linkedinGotoError !== undefined) throw options.linkedinGotoError;
              const response: ResponseLike = {
                url: () =>
                  "https://www.linkedin.com/flagship-web/search/results/content/?keywords=x",
                status: () => 200,
                text: async () => options.linkedinBody,
              };
              for (const listener of listeners) listener(response);
              return undefined;
            }
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
          mouse: {
            move: async () => undefined,
            wheel: async () => undefined, // the initial body already carried the posts
          },
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

// --- Slice 4, Hunk 4: judgeFetch's bulk id regex goes urn-aware (the
// rendered listing carries "id urn:li:activity:<digits>"; the optional
// prefix keeps bare digit ids matching identically;
// partialBulkThenFailFetch stays digit-only — its case feeds only Threads
// ids). Slice 5 moved the lead-in strings themselves (judgeFetch :140 and
// partialBulkThenFailFetch :162) to the neutral wording in the same edit
// (3-suite lockstep, D3) ---
    if (content.includes("Judge each post below")) {
      const ids = content.match(/\b(?:urn:li:activity:)?\d{16,}\b/g) ?? [];
      // ...rest of the bulk branch unchanged (answer map keyed by each matched id)

// --- Slice 4, Hunk 5: four its appended inside describe("runWatcher"),
// after the exhaustion case ---
  it("walks a mixed run through both platform sessions, judges both, and cleans both session dirs", async () => {
    const urls: string[] = [];
    const sessionPaths: string[] = [];
    const statePath = await tempStatePath("mixed-platform.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: {
        ...BASE_ENV,
        LINKEDIN_SESSION_STATE: Buffer.from(
          JSON.stringify({ cookies: [{ name: "li_at", value: "x" }] }),
        ).toString("base64"),
      },
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([
          { id: id19(11), text: "Hiring: python developer, jakarta remote" },
          { id: id19(12), text: "Hiring: devops engineer, bandung on-site" },
        ]),
        linkedinBody: linkedinCardBody(linkedinIdNow),
        urls,
        sessionPaths,
      }),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 3, matches: 3, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /3 new job posts/);
    // Both platform sessions resolved into two contexts...
    assert.equal(sessionPaths.length, 2);
    // ...both platform id forms reached the state file...
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [
      id19(11),
      id19(12),
      `urn:li:activity:${linkedinIdNow}`,
    ]);
    // ...and each session temp file died with the run (paired cleanup, D9).
    for (const path of sessionPaths) {
      await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
    }
  });

  it("completes with Threads posts only when LINKEDIN_SESSION_STATE is absent, skipping the linkedin surface with a warn", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const urls: string[] = [];
    const statePath = await tempStatePath("linkedin-session-absent.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV, // THREADS_SESSION_STATE set; LINKEDIN_SESSION_STATE absent
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([{ id: id19(13), text: "Hiring: react developer, remote" }]),
        linkedinBody: linkedinCardBody(linkedinIdNow), // never fired: the surface is skipped
        urls,
      }),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The dead LinkedIn arm never discards Threads results (acceptance 1)
    // and never routes the surface logged-out (D9).
    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) =>
        /LINKEDIN_SESSION_STATE missing or invalid — skipping 1 linkedin surface/.test(line),
      ),
    );
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(13)]);
    assert.equal(subjects.length, 1); // the Gate 2 heartbeat still fires
  });

  it("degrades a linkedin-only config with no LINKEDIN_SESSION_STATE to warn + empty funnel + heartbeat (D5)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-only-no-session.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV, // THREADS_SESSION_STATE present; LINKEDIN_SESSION_STATE absent
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([]),
        linkedinBody: linkedinCardBody(linkedinIdNow), // never fired: nothing is walked
      }),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) =>
        /LINKEDIN_SESSION_STATE missing or invalid — skipping 1 linkedin surface/.test(line),
      ),
    );
    assert.equal(subjects.length, 1); // the Gate 1 heartbeat still fires
    assert.match(subjects[0] ?? "", /0 new matches/);
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // nothing persisted
  });

  it("keeps logged-out Threads results when the LinkedIn walk dies at walk time (acceptance 1, D5)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-walk-dead.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: {
        ...BASE_ENV,
        THREADS_SESSION_STATE: undefined, // logged-out Threads walk
        LINKEDIN_SESSION_STATE: Buffer.from(
          JSON.stringify({ cookies: [{ name: "li_at", value: "x" }] }),
        ).toString("base64"), // present, but the walk dies below
      },
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([]), // unused: the Threads walk is logged-out
        threadsHtml: tagPageHtml([
          { id: id19(14), text: "Hiring: kotlin developer, jakarta", author: "techco" },
        ]),
        linkedinBody: linkedinCardBody(linkedinIdNow),
        linkedinGotoError: new Error("navigation failed — session dead"),
      }),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The LinkedIn arm's all-fail throw downgrades to a warn; the logged-out
    // Threads posts survive and the run completes (exit 0 shape).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin surfaces FAILED —/.test(line)));
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(14)]);
  });
```

### tests/extract.test.ts — MODIFY

Both `deepEqual` expected-Post literals gain the stamp (forced by the `src/extract.ts` minting-site change).

```typescript
// --- Both deepEqual expected-Post literals gain the platform stamp ---
    assert.deepEqual(posts[0], {
      platform: "threads",
      id: "4012496661532082278",
      text: "Anyone tengah open for hiring? Please please let me know.",
      author: "hasrashidd",
      permalink: "https://www.threads.com/@hasrashidd/post/DevQHRdD4Bm",
      timestamp: "2026-10-21T01:41:38.000Z",
    });

// ...and in "graphql XHR body extraction":
    assert.deepEqual(posts[0], {
      platform: "threads",
      id: "4014250536231619721",
      text: "We're Hiring warga threads !! [ URGENT ]\n\nKantor aku lagi urgently hiring cari kandidat sebagai Staf Admin Entry di Start Dinamics \nSistem kerja: Full Remote\nEst. Salary: UMK \nTerbuka untuk semua kalangan yang berpengalaman dan non pengalaman ya !!",
      author: "hamimakania40",
      permalink: "https://www.threads.com/@hamimakania40/post/De1e5gjgcyJ",
      timestamp: new Date(1792755976 * 1000).toISOString(),
    });
```

### tests/session.test.ts — MODIFY

Parameterized resolver cases: LinkedIn var absent => null; invalid LinkedIn value => warn naming LINKEDIN_SESSION_STATE + null.

```typescript
// --- Import block gains ENV_NAMES in biome organize-imports position ---
import { describe, it } from "node:test";
import { ENV_NAMES } from "../src/config.js";
import { cleanupSessionDir, isValidStorageState, resolveSession } from "../src/threads-session.js";

// --- 4 new cases appended to the "resolveSession" describe ---
  it("resolves the LinkedIn var when it is given as the env name", async () => {
    const path = await resolveSession({ LINKEDIN_SESSION_STATE: VALID }, ENV_NAMES.linkedinSession);
    assert.ok(path !== null);
    const doc = JSON.parse(await readFile(path, "utf8")) as { cookies: unknown[] };
    assert.equal(doc.cookies.length, 1);
  });

  it("returns null for the LinkedIn var when only the Threads var is set", async () => {
    assert.equal(
      await resolveSession({ THREADS_SESSION_STATE: VALID }, ENV_NAMES.linkedinSession),
      null,
    );
  });

  it("warns naming the LinkedIn var when its value is not base64 JSON", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await resolveSession(
      { LINKEDIN_SESSION_STATE: "!!!not-base64!!!" },
      ENV_NAMES.linkedinSession,
    );
    assert.equal(path, null);
    assert.equal(warns.mock.calls.length, 1);
    assert.match(String(warns.mock.calls[0]?.arguments[0]), /LINKEDIN_SESSION_STATE/);
  });

  it("warns naming the LinkedIn var when its document carries no cookies", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const empty = Buffer.from(JSON.stringify({ cookies: [] }), "utf8").toString("base64");
    const path = await resolveSession({ LINKEDIN_SESSION_STATE: empty }, ENV_NAMES.linkedinSession);
    assert.equal(path, null);
    assert.equal(warns.mock.calls.length, 1);
    assert.match(String(warns.mock.calls[0]?.arguments[0]), /LINKEDIN_SESSION_STATE/);
  });
```

### tests/judge-helpers.ts — MODIFY

Shared Post fixtures gain `platform: "threads"`.

```typescript
// --- bulkPost gains the platform stamp ---
export function bulkPost(id: string): Post {
  return {
    platform: "threads",
    id,
    text: `Hiring a frontend developer — post ${id}`,
    author: "techco",
    permalink: `https://www.threads.com/@techco/post/${id}`,
    timestamp: "2026-10-24T00:00:00.000Z",
  };
}
```

### tests/state.test.ts — MODIFY

Post fixtures gain `platform: "threads"`.

```typescript
// --- post() helper gains the platform stamp ---
const post = (id: string): Post => ({
  platform: "threads",
  id,
  text: `post ${id}`,
  author: "tester",
  permalink: `https://www.threads.com/@tester/post/${id}`,
  timestamp: iso(NOW - HOUR),
});
```

### tests/heartbeat.test.ts — MODIFY

Post fixtures gain `platform: "threads"`.

```typescript
// --- post() helper gains the platform stamp ---
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
```

### tests/recency.test.ts — MODIFY

Post fixtures gain `platform: "threads"`.

```typescript
// --- post() helper gains the platform stamp ---
function post(id: string, hoursAgo: number): Post {
  return {
    platform: "threads",
    id,
    text: `post ${id}`,
    author: "tester",
    permalink: `https://www.threads.com/@tester/post/${id}`,
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  };
}
```

### tests/email.test.ts — MODIFY

Inline Post literals gain `platform`; new pins: mixed subject suffix, `[linkedin]` item token, all-Threads subject unchanged.

```typescript
// --- Every inline Post literal gains `platform: "threads",` as its first member
// --- (9 sites, Slice 2). Insert before each id line: ---
//   :23   id: "1",    buildSubject single
//   :36   id: "1",    buildSubject multi (first)
//   :43   id: "2",    buildSubject multi (second)
//   :50   id: "3",    buildSubject multi (third)
//   :69   id: "101",  buildDigest single
//   :88   id: "101",  buildDigest multi (first)
//   :95   id: "102",  buildDigest multi (second)
//  :121   id: "103",  buildDigest multi-line caption
//  :188   id: "201",  sendDigest samplePosts
// Each site reads, after the edit:
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },

// --- Slice 5: three marking pins (D10) ---
  it("appends + LinkedIn to the subject only when a linkedin match is present", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        platform: "linkedin",
        id: "urn:li:activity:7522028760582447104",
        text: "Hiring backend engineer, remote",
        author: "sometechguy",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
    ];
    assert.equal(buildSubject(posts), "2 new job posts on Threads + LinkedIn (#hiring indonesia)");
  });

  it("keeps all-Threads subjects free of the + LinkedIn suffix", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        platform: "threads",
        id: "2",
        text: "Looking for Vue dev",
        author: "startup",
        permalink: "https://www.threads.com/@startup/post/2",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
      {
        platform: "threads",
        id: "3",
        text: "Senior Frontend Lead",
        author: "agency",
        permalink: "https://www.threads.com/@agency/post/3",
        timestamp: "2026-10-24T02:00:00.000Z",
      },
    ];
    const subject = buildSubject(posts);
    assert.equal(subject, "3 new job posts on Threads (#hiring indonesia)");
    assert.ok(!subject?.includes("+ LinkedIn"));
  });

  it("marks only the linkedin item lines with the [linkedin] token", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "101",
        text: "First job post",
        author: "companyA",
        permalink: "https://www.threads.com/@companyA/post/P1",
        timestamp: "2026-10-24T08:00:00.000Z",
      },
      {
        platform: "linkedin",
        id: "urn:li:activity:7522028760582447104",
        text: "Second job post",
        author: "sometechguy",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
        timestamp: "2026-10-24T09:00:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith("2 new job posts on Threads + LinkedIn (#hiring indonesia)\n\n"));
    assert.ok(
      digest.includes(
        "1. First job post\n   — @companyA\n   https://www.threads.com/@companyA/post/P1",
      ),
    );
    assert.ok(
      digest.includes(
        "2. [linkedin] Second job post\n   — @sometechguy\n   https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
      ),
    );
  });
```

### tests/judge.test.ts — MODIFY

Bulk-dispatch mock strings go neutral (`:153`, `:445`, `:483`); prompt-content pins updated.

```typescript
// --- Slice 5: the three bulk-dispatch discriminators go neutral (D3
// --- lockstep; :153 the shared bulkMissThenAnswer helper, :445 the
// --- keeps-input-order inline mockFetch, :483 the burst-demotion double) ---
-      if (content.includes("Judge each Threads post below")) {
+      if (content.includes("Judge each post below")) {
-      if (!content.includes("Judge each Threads post below")) {
+      if (!content.includes("Judge each post below")) {
```

### tests/judge-rotation.test.ts — MODIFY

The `samplePost` fixture stamp (`:71`) landed in Slice 2; the bulk-dispatch mock strings went neutral (`:331`, `:594`) in Slice 5.

```typescript
// --- The describe("judgePost") samplePost literal gains the platform stamp
// --- (the file's ONLY inline Post literal; all other fixtures ride bulkPost). ---
  const samplePost: Post = {
    platform: "threads",
    id: "100",
    text: "Hiring React developer in Jakarta",
    author: "techco",
    permalink: "https://www.threads.com/@techco/post/100",
    timestamp: "2026-10-24T00:00:00.000Z",
  };

// --- Slice 5: the two bulk-dispatch mock discriminators go neutral (D3
// --- lockstep; :331 the drain-then-throw double, :594 the spent-budget
// --- inline mockFetch) ---
-      if (content.includes("Judge each Threads post below")) {
+      if (content.includes("Judge each post below")) {
```

## Slices

### Slice 1: Config spine

**Files**: `src/config-file.ts`, `tests/config-file.test.ts`, `tests/fetch-threads.test.ts` (surface() helper line only), `tests/index.test.ts` (CONFIG scrollRounds line only)

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes on touched files: `npx biome check src/config-file.ts tests/config-file.test.ts tests/fetch-threads.test.ts tests/index.test.ts`
- [ ] Config suite passes with the new linkedin + scrollRounds cases: `npx tsx --test tests/config-file.test.ts`
- [ ] Ripple-only suites pass unchanged: `npx tsx --test tests/fetch-threads.test.ts` and `npx tsx --test tests/index.test.ts`

#### Manual Verification:
- [ ] The committed watcher.config.json (no linkedin surface, no scrollRounds key) still loads; scrollRounds resolves to 8

### Slice 2: Contracts + session

**Files**: `src/types.ts`, `src/extract.ts`, `src/config.ts`, `src/threads-session.ts`, `.github/workflows/watch.yml`, `scripts/probe-judge.ts`, `tests/session.test.ts`, `tests/judge-helpers.ts`, `tests/state.test.ts`, `tests/heartbeat.test.ts`, `tests/recency.test.ts`, `tests/email.test.ts` (fixture lines only), `tests/extract.test.ts`, `tests/judge-rotation.test.ts` (samplePost stamp only)

#### Automated Verification:
- [ ] Type checking passes across src, tests, and scripts with the required Post.platform ripple applied everywhere: `npm run typecheck`
- [ ] Lint passes on touched files: `npx biome check src/types.ts src/extract.ts src/config.ts src/threads-session.ts scripts/probe-judge.ts tests/session.test.ts tests/judge-helpers.ts tests/state.test.ts tests/heartbeat.test.ts tests/recency.test.ts tests/email.test.ts tests/extract.test.ts tests/judge-rotation.test.ts`
- [ ] Session suite passes with the parameterized resolver cases: `npx tsx --test tests/session.test.ts`
- [ ] Ripple suites pass unchanged: `npx tsx --test tests/extract.test.ts tests/state.test.ts tests/heartbeat.test.ts tests/recency.test.ts tests/email.test.ts`
- [ ] Judge suites still pass with the stamped shared helper and pre-neutral prompts: `npx tsx --test tests/judge.test.ts tests/judge-rotation.test.ts`
- [ ] The Threads-specific fallback tail is gone from the resolver warns: `grep -rn "using the logged-out fetch" src/` returns no hits

#### Manual Verification:
- [ ] A run with THREADS_SESSION_STATE unset still takes the logged-out Threads path (default parameter preserves the existing contract)

### Slice 3: LinkedIn walker

**Files**: `src/fetch-linkedin.ts` (NEW), `src/fetch-threads.ts`, `tests/fetch-linkedin.test.ts` (NEW), `tests/fetch-threads.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes on touched files: `npx biome check src/fetch-linkedin.ts src/fetch-threads.ts tests/fetch-linkedin.test.ts tests/fetch-threads.test.ts`
- [ ] LinkedIn walker suite passes: `npx tsx --test tests/fetch-linkedin.test.ts`
- [ ] Threads suite passes unchanged (the default-8 dry/ceiling/cap pins hold): `npx tsx --test tests/fetch-threads.test.ts`
- [ ] A linkedin-only dispatch builds only the LinkedIn context (D12): `npx tsx --test tests/fetch-threads.test.ts` — the "builds one context for a linkedin-only dispatch" pin deep-equals `sessionPaths` to `["li-state.json"]`
- [ ] Dispatch is platform-typed, not label-sniffed: `grep -n 'platform === "linkedin"' src/fetch-threads.ts` returns at least 1 hit
- [ ] The module back-edge stays type-only into fetch-linkedin: `grep -c "^import type" src/fetch-linkedin.ts` equals 3, and the only fetch-threads import line is an `import type`

#### Manual Verification:
- [ ] With a live session (decode LINKEDIN_SESSION_STATE to a temp file), a scratch tsx script calls `fetchSurfacesAuthenticated` directly — one linkedin ResolvedSurface, `chromiumContextFactory`, `{ linkedinSessionPath: <temp file> }` — and logs `fetch: linkedin/... OK — N post(s) from M response(s)` (operator-run; needs a live session; defer to the live-retune commit if the session is dead; the end-to-end runWatcher path lands in Slice 4 and the sample config in Slice 6)

### Slice 4: Acquisition split

**Files**: `src/index.ts`, `tests/index.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes on touched files: `npx biome check src/index.ts tests/index.test.ts`
- [ ] Pipeline suite passes — 8 pre-existing cases untouched (Threads-only byte-identity, Verification Notes) plus the 4 new acquisition pins: `npx tsx --test tests/index.test.ts`
- [ ] The dispatch pins this split rides still hold: `npx tsx --test tests/fetch-threads.test.ts`
- [ ] The session resolver parameterization still holds: `npx tsx --test tests/session.test.ts`
- [ ] No session variable name hardcoded in the split: `grep -n "LINKEDIN_SESSION_STATE" src/index.ts` returns no hits (src/index.ts references ENV_NAMES.linkedinSession)

#### Manual Verification:
- [ ] A local run with a mixed watcher.config.json and LINKEDIN_SESSION_STATE unset logs the skip warn naming the variable and completes on Threads posts alone (operator-run; mirrors the absent-session pin offline)

### Slice 5: Judge + digest marking

**Files**: `src/judge.ts`, `src/email.ts`, `tests/judge.test.ts`, `tests/judge-rotation.test.ts`, `tests/index.test.ts`, `tests/email.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes on touched files: `npx biome check src/judge.ts src/email.ts tests/judge.test.ts tests/judge-rotation.test.ts tests/index.test.ts tests/email.test.ts`
- [ ] Judge suites pass with the neutral bulk dispatch strings: `npx tsx --test tests/judge.test.ts tests/judge-rotation.test.ts`
- [ ] Pipeline suite passes — bulk batches still route through the bulk path in every double: `npx tsx --test tests/index.test.ts`
- [ ] Email suite passes with the three marking pins: `npx tsx --test tests/email.test.ts`
- [ ] The lockstep edit is complete — no suite can silently reroute bulk batches to the fallback: `grep -rn "Judge each Threads post below" src/ tests/` returns no hits
- [ ] The singular-form all-Threads subject pins hold byte-identical: `grep -c "1 new job post on Threads (#hiring indonesia)" tests/email.test.ts` still returns 3

#### Manual Verification:
- [ ] A mixed-run digest shows `[linkedin]` only on LinkedIn item lines and "+ LinkedIn" in the subject only when a LinkedIn match is present (operator-run; verify in the first real mixed run — defer to live validation when no LinkedIn session is configured yet)

### Slice 6: Sample config + gates

**Files**: `watcher.config.json`, `README.md`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes repo-wide: `npm run lint`
- [ ] Full test suite passes: `npm test`
- [ ] The committed config loads with the linkedin surface and the default knob: `npx tsx -e "import('./src/config-file.js').then(async ({ loadWatcherConfig, resolveSurfaces }) => { const config = await loadWatcherConfig('watcher.config.json'); const linkedin = resolveSurfaces(config.surfaces).filter((surface) => surface.platform === 'linkedin'); console.log('scrollRounds:', config.scrollRounds); console.log(linkedin.map((surface) => surface.url).join('\n')); })"` prints `scrollRounds: 8` and `https://www.linkedin.com/search/results/content/?keywords=%23hiring%20frontend%20developer%20indonesia&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D` (`.then` form, no top-level await — the direct `await import` eval fails under tsx's cjs transform; command shape verified 2026-10-31)
- [ ] Exactly one linkedin surface is live: `grep -c '"type": "linkedin"' watcher.config.json` returns 1
- [ ] The README names the secret wherever an operator meets it: `grep -c "LINKEDIN_SESSION_STATE" README.md` returns >= 3

#### Manual Verification:
- [ ] Dispatch Actions → watch with `LINKEDIN_SESSION_STATE` unset: the run exits 0, logs `LINKEDIN_SESSION_STATE missing or invalid — skipping 1 linkedin surface(s)`, and the Threads digest/heartbeat still lands (live D5 confirmation)
- [ ] With a live LinkedIn session set, a run logs `fetch: linkedin/... OK — N post(s) from M response(s)` and LinkedIn matches carry the `[linkedin]` token in the digest (operator-run; defer to live validation when no session is available yet — the 93a3f38 retune precedent)

## Desired End State

Config gains one entry and the run picks it up with no code change:

```json
{ "type": "linkedin", "value": "#hiring engineer developer jakarta" }
```

A mixed run logs per-platform acquisition and delivers one digest:

```
watch: surfaces: tag/hiring, linkedin/#hiring engineer developer jakarta, ...
fetch: linkedin/#hiring engineer developer jakarta OK — 9 post(s) from 4 response(s)
email: sent digest with 12 post(s)
```

Digest lines:

```
1. Hiring: frontend developer, Jakarta HQ
   — @sometechguy
   https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104
2. Hiring: react dev, remote
   — @lokerjakarta
   https://www.threads.com/@lokerjakarta/post/abc123
```

Non-Threads lines carry the platform token; the subject reads "12 new job posts on Threads + LinkedIn (#hiring indonesia)" only when a LinkedIn match is present.

## File Map

- `src/config-file.ts` # MODIFY — linkedin arm, scrollRounds validator, platform stamps, URL builder
- `src/types.ts` # MODIFY — Post.platform required
- `src/extract.ts` # MODIFY — stamp platform on the Threads minting site
- `src/config.ts` # MODIFY — ENV_NAMES.linkedinSession
- `src/threads-session.ts` # MODIFY — env-name-parameterized resolver
- `src/fetch-linkedin.ts` # NEW — LinkedIn walker + parser
- `src/fetch-threads.ts` # MODIFY — options param, worker dispatch, PageLike members
- `src/index.ts` # MODIFY — per-platform acquisition split
- `src/judge.ts` # MODIFY — neutral prompt wording
- `src/email.ts` # MODIFY — platform-marked subject + item lines
- `.github/workflows/watch.yml` # MODIFY — LINKEDIN_SESSION_STATE mapping
- `watcher.config.json` # MODIFY — live linkedin surface entry
- `README.md` # MODIFY — surface + session docs
- `tests/config-file.test.ts` # MODIFY — new cases + platform in deepEquals
- `tests/fetch-threads.test.ts` # MODIFY — helper line, mixed-surface + dispatch + scroll + one-context (D12) pins
- `tests/fetch-linkedin.test.ts` # NEW — walker offline suite
- `tests/index.test.ts` # MODIFY — CONFIG line, neutral mocks, absent-session pin
- `tests/session.test.ts` # MODIFY — parameterized resolver cases
- `tests/judge-helpers.ts` # MODIFY — platform on shared fixtures
- `tests/state.test.ts` # MODIFY — platform on fixtures
- `tests/heartbeat.test.ts` # MODIFY — platform on fixtures
- `tests/recency.test.ts` # MODIFY — platform on fixtures
- `tests/email.test.ts` # MODIFY — platform on literals + marking pins
- `tests/extract.test.ts` # MODIFY — platform on the 2 deepEqual expected literals
- `scripts/probe-judge.ts` # MODIFY — platform on the synthetic probe post
- `tests/judge.test.ts` # MODIFY — neutral mock strings + prompt pins
- `tests/judge-rotation.test.ts` # MODIFY — neutral mock strings (`:331`, `:594`, Slice 5) + samplePost stamp (Slice 2)

## Ordering Constraints

- Slice 1 first: the required `platform` on `ResolvedSurface` and `scrollRounds` on `WatcherConfig` force the two literal ripples included there.
- Slice 2 before 3: the walker mints `Post`s (needs `Post.platform`) and takes a session path (needs the parameterized resolver).
- Slice 3 before 4: the acquisition split dispatches to the walker, so the walker + dispatch point must exist first.
- Slice 5 depends only on Slice 2 (Post.platform exists); it is sequenced fifth to keep Threads-only behavior byte-identical as long as possible.
- Slice 6 last: sample config + README + the full project gate (`npm run typecheck` && `npm run lint` && `npm test`).
- No parallelism: slices are strictly sequential by design.

## Verification Notes

- RSC field layout rotates without notice: pin the parser against trimmed capture fixtures; re-capture at implement time if parses fail live. Keep extraction isolated in `src/fetch-linkedin.ts` so rotation is a one-file fix.
- Neutral bulk wording is a 3-suite lockstep edit (7 sites): if any one site is missed, that suite silently degrades bulk batches to the single-post path without failing — grep for `Judge each Threads post below` must return ZERO hits after Slice 5.
- Expect one live-validation retune commit after the first real runs (93a3f38 precedent): wheel deltas, settle ms, and round counts are placeholder constants until measured.
- LinkedIn session expiry is routine: the dead-session path (warn + zero posts + Threads intact + exit 0) is a first-class pin, not an error path.
- Byte-identity check: after Slices 1-4, a Threads-only config must produce identical run output; `grep -rn "linkedin" src/ | grep -v fetch-linkedin` shows only stamps and session plumbing.
- scrollRounds validation rejects `"five"`, `5.5`, `0` fail-visibly with path + key; default-8 acceptance pin mirrors the reasoningEffort cases (`tests/config-file.test.ts:121-129` shape).

## Performance Considerations

- Shared `runPool` width 4 unchanged; LinkedIn surfaces join the same pool — no new serial stage (FR#8).
- LinkedIn yields ~3 posts per pagination round; the `scrollRounds` bound (default 8) caps walker time the same way the Threads loop does.
- Wheel delta (2500), coordinates (600,450), and settle windows are unmeasured placeholders pending the live retune; each gets a measured-date comment placeholder in the tuning block.
- watch.yml 8-minute budget: re-checked in the retune commit; the LinkedIn walk adds at most a few scroll rounds x settle ms per surface.

## Migration Notes

Not applicable. `state/seen-posts.json` accepts any non-empty string id (`src/state.ts:79-101`); urn ids with colons cannot collide with Threads digit pks in `dedupePosts`. No schema change, no migration, rollback is pure deletion of the feature commit.

## Pattern References

- Optional-key validator with default: `src/config-file.ts:172-188` (d8fc15b) — scrollRounds clones it with the stricter integer guard.
- Trailing-optional parameter idiom: `src/fetch-threads.ts:278`.
- Side-array failure discipline: `src/fetch-threads.ts:283-284,294-312`.
- Measured-date tuning block: `src/fetch-threads.ts:51-55` — extend for the LinkedIn constants.
- XHR interception seam: `src/fetch-threads.ts:333-350` — the LinkedIn response filter mirrors it.
- Test doubles: `tests/fetch-threads.test.ts:85-104` (fakeContextFactory options surface), `tests/index.test.ts:96-118` (singlePageContextFactory).
- Byte-exact URL pin style: `tests/config-file.test.ts:152-155`.
- Session resolver contract: `src/threads-session.ts:28-52` + `tests/session.test.ts`.

## Developer Context

**Q (directional batch): fetchSurfacesAuthenticated 4th param shape?** A: "i dont understand" — developer deferred internal plumbing; standard option taken (options object, D6), vetoable at the summary checkpoint (not vetoed).

**Q (directional batch): module reference shape between fetch-threads and fetch-linkedin?** A: "i dont understand" — deferred; type-only back-edge taken (D7).

**Q (directional batch): session resolver parameterization?** A: "i dont understand" — deferred; env-name parameter taken (D8).

**Q (design gate): post id form in state/seen-posts.json?** A: "same as current: linkedin post text and url source" — interpreted as "treat LinkedIn like Threads": raw id form as emitted by the platform (D2, raw urn). Flagged in the summary for correction; developer proceeded.

**Q (design gate): judge wording?** A: "Neutral everywhere" — D3. The 7-site lockstep test edit cost was stated and accepted.

**Q (design gate): scrollRounds scope?** A: "Both (Recommended)" — D4.

**Q (summary): proceed to decomposition?** A: "Proceed (Recommended)".

**Q (decomposition): approve 6 slices?** A: "Approve (Recommended)" — with the correction that fixture-ripple files moved into the slices whose type changes force them (S1 ripples, S2 fixture lines), and Slice 6 narrowed to sample config + README + full gates.

**Q (Slice 3 checkpoint): approve the LinkedIn walker with two declared deviations?** A: "Approve (Recommended)" — ratified: (1) Post.author is the "linkedin-member" placeholder (11 captured flagship-web bodies carry zero member names; the DOM carries names but no ids, so the sources cannot join — the earlier "author from aria-label" assumption is retired); (2) tests use synthetic flight literals in the captured field layout (a real minting row transitively pulls ~380KB). slice-verifier ran three rounds (fire call-site + dispatch key + Manual criterion fixed in r1; per-row currentId blocker + two nits fixed in r2; r3 clean) and the fixed parser was executed against all 11 capture bodies: 33/33 distinct posts, 0 near-empty, 0 markup junk.

## Design History

- Slice 1: Config spine — approved as generated
- Slice 2: Contracts + session — revised then approved: fixture-ripple scope grew by `scripts/probe-judge.ts`, `tests/extract.test.ts`, and the `tests/judge-rotation.test.ts` samplePost stamp (grep-verified Post literals forced by the required field); resolver warn tail neutralized to "continuing without it" (the parameterized resolver no longer knows the caller's fallback policy); slice-verifier re-run clean
- Slice 3: LinkedIn walker — revised then approved: slice-verifier r1 fixed the double re-typing fallout (evaluate wraps graphqlResponse for the ResponseLike fire), the dispatch pin key (nav-URL substring, not the surface label), and the Manual criterion (now drives fetchSurfacesAuthenticated directly, reachable at the Slice-3-only state); r2 caught the per-row currentId reset (hoisted to the stream-order register) and two nits (biome import order; fixture path ref corrected to the colon-separated flight format) — the fixed parser was then executed against all 11 capture bodies (33/33 distinct posts, 0 near-empty, 0 markup junk); r3 clean; post-finalize amendment (2026-10-31): base context now lazy (D12) — one-context linkedin-only dispatch pin added to tests and Success Criteria
- Slice 4: Acquisition split — revised then approved: slice-verifier r1 caught a linkedin-only config with no LinkedIn session feeding an empty surfaces array into the walker's all-fail gate (exit 1 instead of D5's warn + empty funnel + heartbeat) — fixed with the walkedSurfaces empty guard plus the D5 degrade pin; r2 caught the logged-out path discarding collected Threads posts when the isolated LinkedIn walk's all-fail threw (branch 5) — fixed with the try/catch downgrade plus the walk-time-death pin, and both warn lines moved to the S3 concatenation style; r3 clean (one 101-char fixture line wrapped); post-finalize amendment (2026-10-31): logged-out-branch comment cites the lazy base build (D12); call sites unchanged
- Slice 5: Judge + digest marking — revised then approved: slice-verifier r1 fixed two self-broken Success Criteria (grep-count vs the new pin's own subject text; a 102-char pin line over biome lineWidth 100), r2 caught three over-wrapped lines the formatter would join plus a swapped :153 site label (the shared bulkMissThenAnswer helper, not the keeps-input-order inline), r3 clean (Decisions OK / Cross-slice OK / Research OK). Scope correction ratified across all dispatches: tests/index.test.ts joins the slice (the artifact's zero-hit grep bar and its own "Still owed by Slice 5" note require the :140/:162 lead-in edits here; the Files line gains it)
- Slice 6: Sample config + gates — approved as generated: slice-verifier r1 flagged one undeclared wording tweak in carried pipeline step 1 ("every surface" -> "every Threads surface"; step 2 now owns LinkedIn) — declared in the Hunk B preamble; r2 clean (Decisions OK / Cross-slice OK / Research OK)

## References

- `.rpiv/artifacts/solutions/2026-10-31_10-32-31_linkedin-second-surface-dispatch.md` — parent: recommended option, comparison, integration points
- `.rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface-and-scroll-rounds.md` — evidence base: live capture, seams, test-impact map
- `.rpiv/artifacts/discover/2026-10-31_07-45-40_linkedin-second-surface.md` — FRD
- `.rpiv/guidance/src/architecture.md` — funnel gates, DI seams, new-surface-type checklist
- `.rpiv/guidance/tests/architecture.md` — offline conventions, doubles, fixtures
- `.rpiv/guidance/.github/workflows/architecture.md` — secret mapping pattern
- Commits: b050436, d8fc15b, 9e1c8ef, 93a3f38 — precedent blast radii

## Follow-up 2026-10-31T16:47:40+0700

Post-finalize review fixes, applied before `/skill:plan`:

1. **Phantom heading**: the README Hunk G heading moved from fence column 0 into the hunk prose (inline code); heading-based readers see exactly the 17 template sections.
2. **Slice 6 tsx criterion rewritten, verified**: the direct `await import` eval fails in this repo — tsx/esbuild transforms eval to cjs and rejects top-level await (reproduced 2026-10-31, exit 1). The criterion now chains `.then(async (...))`; the same command shape ran exit 0 against current source.
3. **Idle base context removed (D12)**: Slice 3's walker builds the base context lazily; Slice 4's logged-out-branch comment updated; one-context dispatch pin added to Slice 3's tests and Success Criteria.
4. **Verifier warnings cleared**: two glued code-fence closers (fetch-threads.ts and fetch-linkedin.test.ts entry tails) split onto their own lines; Slice 3 pin enumerations (tests preamble + File Map) now list the D12 one-context pin.
