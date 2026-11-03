---
date: 2026-11-01T21:35:44+0700
author: Yogiswara Utama
commit: ecc9865
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn SDK post-search cutover — Playwright path deleted"
tags: [design, fetch-linkedin-api, linkedapi-node, index-ts, fetch-threads, config-file, watch-yml, env-names, phase7-deletion]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-01_20-34-14_linkedin-api-fetcher-integration-shape.md
last_updated: 2026-11-02T13:16:29+0700
llast_updated_note: "Post-finalize developer review folded in (five findings): package-lock joined S1 (npm ci gate); index.ts confirmed in the S4 scratch compile (tsc exit 0 re-run); test fences compiled AND executed in scratch — 226/226 after fixing one execution-found fence defect (D14 empty capture tripped the kept Threads all-fail gate); live-dispatch gate now a merge-blocking PR checklist item; deliberately-left record names both stale future-fetcher mechanisms"
last_updated_by: Yogiswara Utama
---

# Design: LinkedIn via Linked API SDK post search (Playwright path deleted)

## Summary

Replace the production-blocked Playwright LinkedIn fetch path with an @linkedapi/node
SDK post-search fetcher in a new module, src/fetch-linkedin-api.ts, behind an optional
WatcherDeps field. The module owns degradable token resolvers, an injectable client
seam, and a sequential per-surface loop that never throws (warn + skip per surface,
empty results are success). The old path — session machinery, credential-login fallback,
refresh workflow, marker commits — is deleted wholesale. watch.yml flips
cancel-in-progress to true and rewrites the F023 comment pair in lockstep with judge.ts.

## Requirements

- LinkedIn surfaces fetch via @linkedapi/node searchPosts: term verbatim from
  watcher.config.json, sort "latest", datePosted "past24Hours" (developer decision
  2026-11-01 — supersedes FRD D9's pastWeek), limit 100.
- LinkedIn failures degrade: warn + skip the surface, run exits 0 (FRD D5).
- Missing tokens skip LinkedIn with one warn naming LINKED_API_TOKEN before any fetch
  call; run exits 0 (FRD D10, caller-warns split).
- The blocked Playwright LinkedIn path is deleted entirely (FRD D7), including every
  orphaned seam member its deletion strands.
- LinkedIn fetch is sequential — no runPool (FR4). Threads keeps runPool +
  FETCH_CONCURRENCY + its all-fail throw, byte-for-byte in behavior.
- Posts normalize into the existing Post shape before dedupe; malformed rows drop with
  a count and a conditional warn.
- The fetch await sits inside the existing acquisition timeStage closure; one
  stage-level timing line (fetchMs) — no new stage-level lines.
- watcher.config.json stays byte-identical; the config Surface union keeps its
  "linkedin" member.
- ResolvedSurface.platform narrows to "threads" (no producer or consumer of
  "linkedin" remains post-cutover).
- Docs sync lands in the same change: README sections/rows + 4 .rpiv/guidance mirrors
  (AGENTS.md verified clean — no edit needed).

## Current State Analysis

The acquisition closure (src/index.ts:165-253) runs a three-branch, session-conditional
dispatch: platform split (:171-172), Threads session resolve (:173), guarded LinkedIn
session resolve (:174-175), credential-login fallback (:182-188) into
recoverLinkedInSession (:362-411), skip-warn (:190-193), mixed authenticated dispatch
(:196-215), logged-out Threads arm (:220-226) with a logged-out LinkedIn arm + catch-
degrade (:230-243), paired finally cleanup (:249-252). fetchSurfacesAuthenticated
(src/fetch-threads.ts:331-415) carries the LinkedIn context build (:346-350), the
walkLinkedInSurface closure (:357-366), the platform ternary (:381-382), and the
LinkedIn teardown (:412). The wheel walk lives in src/fetch-linkedin.ts (346 lines);
the credential fallback in src/linkedin-login.ts (315) + scripts/linkedin-login.ts
(120). watch.yml carries LinkedIn env lines (:94-97), the "Refresh LinkedIn session
secret" step (:103-129), and the marker branch in Commit state (:143-144).

### Key Discoveries

- The SDK is a two-call flow: `searchPosts.execute(params)` returns
  `{workflowId, workflowStatus, pendingReason?, message?}` immediately;
  `searchPosts.result(workflowId)` polls to completion and returns
  `{data, errors}` (data nullable; errors = non-critical {type,message}[]).
  Sources: linkedapi.io/sdks/handling-results.md, /docs/action-st-search-posts.md
  (fetched 2026-11-01).
- Working-hours park: default account policy QUEUES the workflow;
  `pendingReason: "outsideWorkingHours"` can hold until the next working day —
  awaiting result() on a parked workflow would hang the run until the 8-minute job
  timeout kills it (/docs/working-hours.md). Reject policy throws
  `LinkedApiError(type: "outsideWorkingHours")` at execute().
- Critical errors throw as `LinkedApiError` with `.type`/`.message`
  (invalidLinkedApiToken, tooManyRequests, linkedinAccountSignedOut,
  workingHoursWaitExpired, httpError for network, and more — /sdks/handling-results.md,
  /docs/common-errors.md). Action-level failures arrive in result().errors[]
  (filterNotApplied, searchingNotAllowed) — never thrown.
- Result item shape: url (always), activityUrn ("if available"), time (ISO string),
  type original|repost, author (nullable; name/profileUrl for person,
  name/companyUrl for company), reposter (reposts only), text (nullable),
  repostText (nullable), hashtags/mentions/externalLinks/images, counts.
- Search caps: term 1-50 chars, limit max 100 (20 with child actions — unused here),
  LinkedIn widens narrow queries (a non-empty result does not prove the term matched).
- Import form (CORRECTED by the 2026-11-02 seam check): NAMED import —
  `const { LinkedApi } = await import("@linkedapi/node")`. The default import
  resolves to the CJS namespace object and is not constructable (TS2351) under
  NodeNext + verbatimModuleSyntax, despite the default-import examples in the
  official docs. Package is CJS, no exports map; the d.ts declares `export default`
  plus named exports, but the NodeNext CJS lens wins.
- Deleting linkedin-login.ts orphans ContextLike.cookies (fetch-threads.ts:127),
  LocatorLike.fill (:98), PageLike.url? (:116), PageLike.mouse (:114), PageMouseLike
  (:93-96) and their factory adapters (:178-199) — consumers die with the login module.
- Deletion ripple zone verified by integration scan: package.json:11 lint path,
  .gitignore:8, README.md three sections + env rows, 4 guidance mirrors, plus
  untracked local artifacts (.env LinkedIn lines, root linkedin-state.b64,
  .rpiv/tmp/ linkedin scratch) — operator hygiene, not code.
- Precedent lessons: one-commit deletion+rewire is the proven pattern (e316cb5);
  empty-results-are-success shipped as a fix within 12h last time (defb8af); CI-side
  integrations shipped 4 same-day defects (f571904 → audit N3-N7); docs drift never
  self-heals (audit N1/N2); expect one declared retune commit after first live runs
  (93a3f38).

## Scope

### Building

- src/fetch-linkedin-api.ts: token resolvers (silent null), production client factory
  (the only dynamic import site of @linkedapi/node), sequential per-surface loop
  (catch-and-continue, no all-fail throw), drop-and-count Post mapping, pending + error
  shape handling.
- tests/fetch-linkedin-api.test.ts: offline suite over a stubbed client seam.
- runWatcher rewiring: optional WatcherDeps field, raw-surface partition, skip-warn
  re-key to LINKED_API_TOKEN, deletion of recoverLinkedInSession + login imports +
  LinkedIn cleanup.
- Threads-only shed of fetch-threads.ts + orphaned seam member sweep; config-file.ts
  linkedin arm + linkedinSearchUrlFor deletion; ResolvedSurface.platform narrowed.
- Phase 7 deletion: linkedin-login.ts, scripts/linkedin-login.ts, their tests, watch.yml
  LinkedIn steps/env/marker branch, ENV_NAMES swap, threads-session.ts docstring,
  package.json lint path, .gitignore entry.
- watch.yml guard flip (cancel-in-progress: true) + F023 comment pair rewrite in
  lockstep (watch.yml + judge.ts) without the dead 71s term.
- Doc sync: README + 4 guidance mirrors.

### Not Building

- Jobs search (D6); CLI process wrapper (D8); LinkedIn parallelism (FR4).
- Config changes: watcher.config.json byte-identical; recencyHours stays 72 (LinkedIn
  posts arrive within 24h of publication; the 72h window effectively governs Threads
  only — deliberate, per developer decision 2026-11-01).
- Any change to judge/digest/heartbeat/state stages beyond the F023 comment text.
- A Linked API probe script (suggested follow-up only).
- Untracked local hygiene (.env lines, linkedin-state.b64, .rpiv/tmp scratch) —
  operator-side, noted in Migration Notes.

## Decisions

### D1: New module fetch-linkedin-api.ts (solutions Option 1)

Every element has a same-repo precedent (module-per-stage, resolver-beside-consumer,
optional WatcherDeps fields, structural doubles). Zero coupling into the Threads
all-fail gate — the D5 bug class 68c1e2d shipped once already. The name marks the
transport (the "fetch-linkedin" name stays dead with the Playwright walker).

### D2: Import + seam shape (corrected 2026-11-02 by the live seam check)

Production client construction via dynamic NAMED import `const { LinkedApi } = await
import("@linkedapi/node")` inside one factory (the Playwright-quarantine pattern,
fetch-threads.ts:150) — importing the module never loads the SDK, keeping the offline
suite honest. Type-only static imports allowed. CORRECTION: the DEFAULT import is NOT
constructable under NodeNext + verbatimModuleSyntax — it resolves to the CJS namespace
object (TS2351); the d.ts declares the class as a NAMED export. Verified against the
installed @linkedapi/node 2.3.20 under the exact repo flags (tsc exit 0 on the exact
dynamic pattern; runtime: default = object, LinkedApi = function). The default-import
examples in the official docs do not survive this repo tsconfig.

### D3: Degradable token resolvers, caller warns

`resolveLinkedApiTokens(env)` returns
`{linkedApiToken, identificationToken}` or null — silent on unset/blank (either
token missing = null; an opaque token has no offline-validatable payload; single exit
like resolveSession at threads-session.ts:42). runWatcher's skip slot
(index.ts:190-193 topology) emits the one warn. The message names BOTH token
variables — `fetch: LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN missing or
blank — skipping N linkedin surface(s)` — because the single-exit resolver contract
cannot say which half is absent, and the tokens ship as a pair (follow-up
2026-11-01). The Slice 2 test regex pins the full message.

### D4: Sequential loop, total function

Per-surface try/catch borrows the fetch-threads.ts:390-394 idiom (message passthrough,
never rethrow). The all-fail throw (fetch-threads.ts:397-409) is NOT ported. An empty
result logs "OK — 0 post(s)" and returns [] (216a617 lesson). Awaited inside the
acquisition timeStage closure so fetchMs stays the one timing line.

### D5: Pending + error handling

- execute() returning pendingReason "outsideWorkingHours" → warn (the message names
  the reopen time) + skip the surface; result() is never awaited on a parked workflow.
- LinkedApiError at either call → warn `<type>: <message>` + skip the surface.
- result().errors[] → warn each `<type>: <message>`; keep posts collected so far.
- queued pendingReason → proceed to result() (bounded: minutes per docs).

### D6: Post mapping

- id: activityUrn; when null, parse urn:li:activity:<id> from url; drop+count if
  neither yields an id.
- text: text ?? repostText; drop+count when both null/empty.
- author: author.name required (person and company authors both carry name);
  drop+count when author or name is null.
- timestamp: guard `Number.isFinite(new Date(time).getTime())` BEFORE
  toISOString (extract.ts:87-113 shape); drop+count on failure.
- permalink: url verbatim. platform: "linkedin".
- Per-surface Map accumulator dedupes re-mints (fetch-linkedin.test.ts:281-297 port);
  global dedupe stays in runWatcher's dedupePosts.
- Drops carry a conditional warn per surface:
  `fetch: linkedin/<value>: dropped N malformed result(s)` (extract.ts:63-64
  shape).

### D7: Search call shape (developer decision 2026-11-01)

`{ term, limit: 100, filter: { sort: "latest", datePosted: "past24Hours" } }` —
term passed verbatim from the raw surface value. LinkedIn posts older than 24h never
arrive; recencyHours: 72 effectively governs Threads only (deliberate).

### D8: ResolvedSurface.platform narrows to "threads"

Post-cutover the union member "linkedin" has zero producers (the resolveSurfaces arm
at config-file.ts:229-234 dies) and zero consumers (index.ts:172 rekeys to the raw
partition; fetch-threads.ts:381-382 ternary dies). The config Surface union KEEPS
"linkedin" — linkedin entries keep validating and load byte-identically; they simply
no longer become resolved records.

### D9: Full orphan sweep

PageMouseLike, PageLike.mouse + adapter, ContextLike.cookies + factory cookies,
LocatorLike.fill + adapter fill, PageLike.url? — every member whose only consumer dies
with linkedin-login.ts goes in the same change (developer decision 2026-11-01).
Surviving test doubles trimmed in the same slices.

### D10: Values stay; comments get rewritten; retune is declared

WAIT_BUDGET_MS stays 180_000; watch.yml timeout-minutes stays 8. The F023 comment pair
(watch.yml:48-55 + judge.ts:98-107) is rewritten in lockstep without the dead 71s
term; the fetch term is marked pending-measurement. One declared retune commit follows
the first live run (93a3f38 precedent) (developer decision 2026-11-01).

### D11: Docs sync in-change

README + 4 guidance mirrors updated in the same change (audit N1/N2: drift never
self-heals) (developer decision 2026-11-01). AGENTS.md verified clean — no edit.

### D12: Fault boundary — the module first, the caller belt second (revised 2026-11-02)

fetchLinkedInPosts wraps its one-time client construction in try/catch and degrades to
warn + [] — the module honors its own total-by-contract docstring, and no caller needs
a catch to be correct. Slice 2 still keeps a thin arm-level catch as defense-in-depth
for unanticipated faults and for a throwing injected stub (the logged-out-arm
catch-degrade precedent, index.ts:230-243) — the belt, not the required boundary. The
required boundary lives in the module.

### D13: Single-return acquisition tail (Slice 2 shape) (follow-up 2026-11-01)

The acquisition closure returns at THREE sites today: index.ts:204 (empty-pool guard),
:226 (logged-out early return), :240 (the concat return). A linkedin-only config with
THREADS_SESSION_STATE set hits :204 and silently drops every LinkedIn post. Slice 2
hoists a threadsPosts variable, runs the Threads arm, then the LinkedIn arm, and uses
ONE return: [...threadsPosts, ...linkedinPosts].

### D14: Startup log reflects the raw partition (Slice 2) (follow-up 2026-11-02)

index.ts:160 logs `watch: surfaces:` from the RESOLVED array; once Slice 3 narrows
ResolvedSurface.platform to threads, that line would silently lose the linkedin labels
while the run still fetches them — a one-stable-line-per-stage regression. Slice 2
re-keys the log to the RAW config.surfaces partition (labels: tag/<value>, url
verbatim, linkedin/<value>) so the startup line lists every surface the run attempts.

### D15: SDK seam verified against the installed package (2026-11-02, pre-implement)

The implement-time seam check ran EARLY, in a scratch project outside the repo
(@linkedapi/node 2.3.20, repo-exact tsc flags incl. noUncheckedIndexedAccess and
exactOptionalPropertyTypes):
- The exact dynamic named-import pattern of createLinkedApiClient compiles:
  tsc exit 0.
- The default import is the CJS namespace (not constructable, TS2351) — D2 corrected.
- The LinkedApiError constructor is POSITIONAL (type, message); e.type and e.message
  read as documented, and instanceof works. The duck-typed .type read in describeError
  stays valid and needs no class import — the quarantine holds.
- Static named import `import { LinkedApi }` compiles and runs — available if the
  quarantine ever needs to become static.

## Architecture

<!-- NEW files get full implementation; MODIFY files get only the changed/added code.
     Deleted files are listed, not fenced. -->

### src/fetch-linkedin-api.ts — NEW

Token resolvers + client factory + sequential fetch loop + Post mapping.

```typescript
/**
 * Fetch LinkedIn posts via the Linked API SDK post search (@linkedapi/node).
 *
 * The SDK is a two-call flow: searchPosts.execute(params) submits a cloud-
 * browser workflow and returns tracking details immediately; searchPosts.
 * result(workflowId) polls to completion and returns { data, errors }.
 * Sources pinned 2026-11-01: linkedapi.io/sdks/handling-results.md,
 * /docs/action-st-search-posts.md, /docs/working-hours.md, /docs/common-errors.md.
 *
 * Degrade contract (FRD D5/D10): this module is TOTAL — a failed client build
 * or failed surface warns instead of throwing, the loop moves on per surface,
 * an empty result is success, and the function never rejects. Token resolution
 * is silent (resolveSession model, threads-session.ts); the caller owns the
 * missing-token warn and the skip decision.
 *
 * The sequential loop replaces the blocked Playwright walker (FR4: no
 * parallelism for LinkedIn; Threads keeps its runPool in fetch-threads.ts).
 *
 * Quarantine: the dynamic import inside createLinkedApiClient is the ONLY
 * @linkedapi/node import site, so importing this module never loads the SDK
 * (the fetch-threads.ts:150 Playwright pattern) and the offline suites inject
 * structural doubles over LinkedApiClientLike.
 */
import type { Surface } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import type { Post } from "./types.js";

// Module constants by design — no config key (repo doctrine: only probe-
// measured values are env-tunable). Window + sort per the developer decision
// 2026-11-01 (supersedes FRD D9's pastWeek; recencyHours: 72 effectively
// governs Threads only). Limit max 100 per the SDK docs; a search may return
// fewer than the limit, and LinkedIn may widen a narrow query on its own.
const SEARCH_LIMIT = 100;
const SEARCH_SORT = "latest";
const SEARCH_DATE_POSTED = "past24Hours";

/** One raw linkedin surface straight from watcher.config.json. */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;

/** Both Linked API tokens, resolved from the environment. */
export interface LinkedInApiTokens {
  readonly linkedApiToken: string;
  readonly identificationToken: string;
}

/** Minimal structural view of one SDK search result item (field names per docs). */
export interface LinkedInSearchResultItem {
  readonly url?: string | null;
  readonly activityUrn?: string | null;
  readonly time?: string | null;
  readonly author?: { readonly name?: string | null } | null;
  readonly text?: string | null;
  readonly repostText?: string | null;
}

/**
 * Structural seam over the SDK client surface this module drives. Narrow on
 * purpose: the offline doubles implement exactly this, and the real client is
 * only ever touched inside createLinkedApiClient.
 */
export interface LinkedApiClientLike {
  searchPosts: {
    execute(params: {
      readonly term: string;
      readonly limit: number;
      readonly filter: { readonly sort: "latest"; readonly datePosted: "past24Hours" };
    }): Promise<{
      readonly workflowId: string;
      readonly workflowStatus: string;
      readonly pendingReason?: string | null;
      readonly message?: string | null;
    }>;
    result(workflowId: string): Promise<{
      readonly data?: readonly LinkedInSearchResultItem[] | null;
      readonly errors?: readonly { readonly type: string; readonly message: string }[] | null;
    }>;
  };
}

/**
 * Resolve both Linked API tokens, or null when either is unset or blank.
 * Silent by contract (resolveSession, threads-session.ts:42): an opaque token
 * has no offline-validatable payload, so there is exactly one exit. The
 * caller decides the warn-and-skip policy.
 */
export function resolveLinkedApiTokens(
  env: Record<string, string | undefined> = process.env,
): LinkedInApiTokens | null {
  const linkedApiToken = env[ENV_NAMES.linkedApiToken];
  const identificationToken = env[ENV_NAMES.linkedApiIdentificationToken];
  if (
    linkedApiToken === undefined ||
    linkedApiToken.trim() === "" ||
    identificationToken === undefined ||
    identificationToken.trim() === ""
  ) {
    return null;
  }
  return { linkedApiToken, identificationToken };
}

/**
 * Build one SDK client. The dynamic import inside is the ONLY @linkedapi/node
 * import site, so importing this module never loads the SDK and the offline
 * suites inject doubles instead.
 */
export async function createLinkedApiClient(
  tokens: LinkedInApiTokens,
): Promise<LinkedApiClientLike> {
  // Named import: the published d.ts declares the class as a NAMED export;
  // the default import resolves to the CJS namespace object, which is NOT
  // constructable under NodeNext + verbatimModuleSyntax (seam check vs
  // @linkedapi/node 2.3.20, 2026-11-02: default → TS2351, named → tsc exit 0).
  const { LinkedApi } = await import("@linkedapi/node");
  // The seam is structural and narrower than the SDK's published types; this
  // one cast keeps this factory the only place that knows the real shape.
  return new LinkedApi({
    linkedApiToken: tokens.linkedApiToken,
    identificationToken: tokens.identificationToken,
  }) as unknown as LinkedApiClientLike;
}

const URN_IN_URL_RE = /urn:li:activity:(\d{9,})/;

/**
 * Map one SDK result item to a Post, or null when a required fact is missing.
 * Guarded conversion BEFORE toISOString (extract.ts:87-113 shape): an invalid
 * time string drops the row instead of throwing RangeError. Drops feed the
 * caller's counter — one malformed row must never poison seen-state
 * (persistJudged stamps ids forever) or burn a paid judge attempt.
 */
export function mapLinkedInSearchResult(item: LinkedInSearchResultItem): Post | null {
  const url = readNonEmpty(item.url);
  if (url === null) return null;
  const id = readNonEmpty(item.activityUrn) ?? readUrnFromUrl(url);
  if (id === null) return null;
  const text = readNonEmpty(item.text) ?? readNonEmpty(item.repostText);
  if (text === null) return null;
  const author = readNonEmpty(item.author?.name);
  if (author === null) return null;
  const timestamp = readTimestamp(item.time);
  if (timestamp === null) return null;
  return { platform: "linkedin", id, text, author, permalink: url, timestamp };
}

/** Fetch every linkedin surface sequentially, in input order. Total by contract. */
export async function fetchLinkedInPosts(
  surfaces: readonly LinkedinSurface[],
  tokens: LinkedInApiTokens,
  clientFactory: (tokens: LinkedInApiTokens) => Promise<LinkedApiClientLike> =
    createLinkedApiClient,
): Promise<Post[]> {
  // One client for the whole run: one Linked API instance per LinkedIn
  // account (SDK installation docs), built once before the serial loop.
  // Totality: the build is wrapped — a factory fault (broken install, bad
  // import) degrades to warn + [] like any other surface failure, so the
  // function never rejects and no caller needs a catch to be correct.
  let client: LinkedApiClientLike;
  try {
    client = await clientFactory(tokens);
  } catch (error) {
    console.warn(`fetch: linkedin client FAILED — ${describeError(error)}`);
    return [];
  }
  const posts: Post[] = [];
  for (const surface of surfaces) {
    const label = `linkedin/${surface.value}`;
    try {
      const workflow = await client.searchPosts.execute({
        term: surface.value,
        limit: SEARCH_LIMIT,
        filter: { sort: SEARCH_SORT, datePosted: SEARCH_DATE_POSTED },
      });
      // Default account policy PARKS the workflow until the working window
      // reopens — possibly the next working day. Never await result() on a
      // parked workflow: the 8-minute job cap would kill the whole run. The
      // skip costs one execute() round-trip (working-hours.md, 2026-11-01).
      if (workflow.pendingReason === "outsideWorkingHours") {
        const detail =
          workflow.message === undefined || workflow.message === null
            ? ""
            : ` (${workflow.message})`;
        console.warn(`fetch: ${label} skipped — outside Linked API working hours${detail}`);
        continue;
      }
      const { data, errors } = await client.searchPosts.result(workflow.workflowId);
      // Action-level errors never throw: they ride the result (docs,
      // handling-results.md). filterNotApplied is permanent;
      // searchingNotAllowed may be transient — either way the surface
      // degrades with its cause named, and the loop moves on.
      for (const error of errors ?? []) {
        console.warn(`fetch: ${label} action error — ${error.type}: ${error.message}`);
      }
      const collected = collectPosts(data ?? []);
      if (collected.dropped > 0) {
        console.warn(`fetch: ${label}: dropped ${collected.dropped} malformed result(s)`);
      }
      console.log(`fetch: ${label} OK — ${collected.posts.length} post(s)`);
      posts.push(...collected.posts);
    } catch (error) {
      // Message passthrough (fetch-threads.ts:390-394 idiom); a LinkedApiError
      // carries .type, prefixed when present so working-hours vs token vs
      // limit causes stay distinguishable in the log.
      console.warn(`fetch: ${label} FAILED — ${describeError(error)}`);
    }
  }
  return posts;
}

/** Dedupe by id in first-seen order; count malformed rows for the caller's warn. */
function collectPosts(items: readonly LinkedInSearchResultItem[]): {
  posts: Post[];
  dropped: number;
} {
  const byId = new Map<string, Post>();
  let dropped = 0;
  for (const item of items) {
    const post = mapLinkedInSearchResult(item);
    if (post === null) {
      dropped += 1;
      continue;
    }
    if (!byId.has(post.id)) byId.set(post.id, post);
  }
  return { posts: [...byId.values()], dropped };
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Guard before the property read: throw null / throw "str" are legal and
  // must degrade, not crash the degrading path (this module survives bad SDK
  // behavior — that is its reason to exist).
  const type: unknown =
    error !== null && typeof error === "object" ? (error as { type?: unknown }).type : undefined;
  return typeof type === "string" ? `${type}: ${message}` : message;
}

function readNonEmpty(value: string | null | undefined): string | null {
  // extract.ts readText/readUsername idiom: whitespace-only is missing.
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readUrnFromUrl(url: string): string | null {
  const match = URN_IN_URL_RE.exec(url);
  return match === null ? null : `urn:li:activity:${match[1]}`;
}

function readTimestamp(time: string | null | undefined): string | null {
  const raw = readNonEmpty(time);
  if (raw === null) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
```

### tests/fetch-linkedin-api.test.ts — NEW

Offline suite: stubbed client seam.

```typescript
/**
 * Offline suite for the Linked API SDK fetcher. The client seam is a plain
 * object, so nothing here touches the network or loads @linkedapi/node.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type LinkedApiClientLike,
  type LinkedInApiTokens,
  type LinkedInSearchResultItem,
  fetchLinkedInPosts,
  mapLinkedInSearchResult,
  resolveLinkedApiTokens,
} from "../src/fetch-linkedin-api.js";
import type { Post } from "../src/types.js";

const TOKENS: LinkedInApiTokens = {
  linkedApiToken: "test-linked-api-token",
  identificationToken: "test-identification-token",
};

const SURFACE = { type: "linkedin", value: "#hiring react" } as const;

/** One SDK-shaped result item; every field optional, fill what the case needs. */
function resultItem(overrides: Partial<LinkedInSearchResultItem> = {}): LinkedInSearchResultItem {
  return {
    url: "https://www.linkedin.com/feed/update/urn:li:activity:7440011668937568257",
    activityUrn: "urn:li:activity:7440011668937568257",
    time: "2026-11-01T08:15:00Z",
    author: { name: "Example Person" },
    text: "Hiring a frontend developer in Jakarta",
    ...overrides,
  };
}

interface ExecuteParamsRecord {
  term: string;
  limit: number;
  filter: { sort: string; datePosted: string };
}

interface StubClientOptions {
  executeResult?: {
    workflowId?: string;
    pendingReason?: string | null;
    message?: string | null;
  };
  executeError?: unknown;
  data?: LinkedInSearchResultItem[] | null;
  errors?: { type: string; message: string }[] | null;
}

/** Build a recording double over the module's structural seam. */
function stubClient(options: StubClientOptions = {}): {
  client: LinkedApiClientLike;
  executeTerms: string[];
  executeParams: ExecuteParamsRecord[];
  resultCalls: string[];
} {
  const executeTerms: string[] = [];
  const executeParams: ExecuteParamsRecord[] = [];
  const resultCalls: string[] = [];
  const client: LinkedApiClientLike = {
    searchPosts: {
      execute: async (params) => {
        if (options.executeError !== undefined) throw options.executeError;
        executeTerms.push(params.term);
        executeParams.push({
          term: params.term,
          limit: params.limit,
          filter: { sort: params.filter.sort, datePosted: params.filter.datePosted },
        });
        const pending = options.executeResult?.pendingReason;
        return {
          workflowId: options.executeResult?.workflowId ?? "wf-1",
          workflowStatus: pending === undefined ? "running" : "pending",
          ...(pending === undefined ? {} : { pendingReason: pending }),
          ...(options.executeResult?.message === undefined
            ? {}
            : { message: options.executeResult.message }),
        };
      },
      result: async (workflowId) => {
        resultCalls.push(workflowId);
        return { data: options.data ?? null, errors: options.errors ?? null };
      },
    },
  };
  return { client, executeTerms, executeParams, resultCalls };
}

async function captureLines(
  method: "log" | "warn",
  run: () => Promise<Post[]>,
): Promise<{ value: Post[]; lines: string[] }> {
  const lines: string[] = [];
  const original = console[method];
  console[method] = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const value = await run();
    return { value, lines };
  } finally {
    console[method] = original;
  }
}

describe("resolveLinkedApiTokens", () => {
  it("returns both tokens when both env vars are set", () => {
    const tokens = resolveLinkedApiTokens({
      LINKED_API_TOKEN: "a-token",
      LINKED_API_IDENTIFICATION_TOKEN: "an-id-token",
    });
    assert.deepEqual(tokens, {
      linkedApiToken: "a-token",
      identificationToken: "an-id-token",
    });
  });

  it("returns null silently when either token is unset or blank", () => {
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.join(" "));
    };
    try {
      assert.equal(resolveLinkedApiTokens({}), null);
      assert.equal(resolveLinkedApiTokens({ LINKED_API_TOKEN: "a" }), null);
      assert.equal(
        resolveLinkedApiTokens({ LINKED_API_TOKEN: "a", LINKED_API_IDENTIFICATION_TOKEN: "  " }),
        null,
      );
      assert.equal(warns.length, 0, "the resolver is silent; the caller owns the warn");
    } finally {
      console.warn = original;
    }
  });
});

describe("mapLinkedInSearchResult", () => {
  it("maps a full result item to a Post", () => {
    const post = mapLinkedInSearchResult(resultItem());
    assert.deepEqual(post, {
      platform: "linkedin",
      id: "urn:li:activity:7440011668937568257",
      text: "Hiring a frontend developer in Jakarta",
      author: "Example Person",
      permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7440011668937568257",
      timestamp: "2026-11-01T08:15:00.000Z",
    });
  });

  it("falls back to the urn inside url when activityUrn is null", () => {
    const post = mapLinkedInSearchResult(resultItem({ activityUrn: null }));
    assert.equal(post?.id, "urn:li:activity:7440011668937568257");
  });

  it("uses repostText when text is absent", () => {
    const post = mapLinkedInSearchResult(resultItem({ text: null, repostText: "Repost note" }));
    assert.equal(post?.text, "Repost note");
  });

  it("returns null when a required fact is missing", () => {
    assert.equal(mapLinkedInSearchResult(resultItem({ url: null })), null);
    assert.equal(
      mapLinkedInSearchResult(resultItem({ activityUrn: null, url: "https://x" })),
      null,
    );
    assert.equal(mapLinkedInSearchResult(resultItem({ text: null, repostText: null })), null);
    assert.equal(mapLinkedInSearchResult(resultItem({ author: null })), null);
    assert.equal(mapLinkedInSearchResult(resultItem({ author: { name: null } })), null);
  });

  it("drops an unparseable timestamp instead of throwing", () => {
    assert.equal(mapLinkedInSearchResult(resultItem({ time: "not-a-date" })), null);
    assert.equal(mapLinkedInSearchResult(resultItem({ time: null })), null);
  });
});

describe("fetchLinkedInPosts", () => {
  it("maps results in SDK order and dedupes re-mints by id", async () => {
    const first = resultItem();
    const dupe = resultItem({ text: "same urn, different text" });
    const second = resultItem({
      activityUrn: "urn:li:activity:7440011668937568258",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7440011668937568258",
      time: "2026-11-01T09:30:00Z",
    });
    const { client } = stubClient({ data: [first, dupe, second] });
    const { value: posts } = await captureLines("log", () =>
      fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client)),
    );
    assert.deepEqual(
      posts.map((post) => post.id),
      ["urn:li:activity:7440011668937568257", "urn:li:activity:7440011668937568258"],
    );
  });

  it("treats an empty result as success: [] plus an OK 0-post log", async () => {
    const { client } = stubClient({ data: [] });
    const { value, lines } = await captureLines("log", () =>
      fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client)),
    );
    assert.deepEqual(value, []);
    assert.ok(lines.some((line) => line.includes("OK — 0 post(s)")));
  });

  it("warns and skips every surface whose execute() throws — the loop continues", async () => {
    // One client per run (one Linked API instance per account): a thrown
    // request-level error degrades BOTH surfaces, neither stops the loop.
    const failing = stubClient({
      executeError: Object.assign(new Error("The provided token is invalid"), {
        type: "invalidLinkedApiToken",
      }),
    });
    const second = { type: "linkedin", value: "#hiring" } as const;
    const { value, lines } = await captureLines("warn", () =>
      fetchLinkedInPosts([SURFACE, second], TOKENS, () => Promise.resolve(failing.client)),
    );
    assert.deepEqual(value, []);
    const failed = lines.filter((line) =>
      line.includes("FAILED — invalidLinkedApiToken: The provided token is invalid"),
    );
    assert.equal(failed.length, 2, "both surfaces warn with the typed cause");
  });

  it("delivers posts from a healthy surface alongside a failing one", async () => {
    // The seam varies behavior per execute() call (stateful double): the
    // first call throws, the second returns data — the run keeps the second
    // surface's posts.
    const calls: Array<{ type: string; message: string } | null> = [
      { type: "searchingNotAllowed", message: "LinkedIn has blocked performing the search." },
      null,
    ];
    let call = 0;
    const client: LinkedApiClientLike = {
      searchPosts: {
        execute: async () => {
          // noUncheckedIndexedAccess: index reads add undefined — normalize
          // to the T|null the guard checks (extract.ts match[1] ?? "" idiom).
          const failure: { type: string; message: string } | null = calls[call] ?? null;
          call += 1;
          if (failure !== null) {
            throw Object.assign(new Error(failure.message), { type: failure.type });
          }
          return {
            workflowId: "wf-2",
            workflowStatus: "running",
          };
        },
        result: async () => ({
          data: [resultItem({ activityUrn: "urn:li:activity:111", url: "https://u/111" })],
          errors: null,
        }),
      },
    };
    const healthy = { type: "linkedin", value: "#hiring" } as const;
    const { value, lines } = await captureLines("warn", () =>
      fetchLinkedInPosts([SURFACE, healthy], TOKENS, () => Promise.resolve(client)),
    );
    assert.equal(value.length, 1, "the failed surface skips, the healthy one delivers");
    assert.ok(lines.some((line) => line.includes("linkedin/#hiring react FAILED")));
  });

  it("warns result().errors[] entries and keeps the posts collected so far", async () => {
    const { client } = stubClient({
      data: [resultItem({ activityUrn: "urn:li:activity:222", url: "https://u/222" })],
      errors: [{ type: "filterNotApplied", message: "fromMembers: no match" }],
    });
    const { value, lines } = await captureLines("warn", () =>
      fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client)),
    );
    assert.equal(value.length, 1);
    assert.ok(lines.some((line) => line.includes("filterNotApplied: fromMembers: no match")));
  });

  it("skips a parked workflow without awaiting result()", async () => {
    const { client, resultCalls } = stubClient({
      executeResult: {
        pendingReason: "outsideWorkingHours",
        message: "starts when working hours open at Mon, 09:00",
      },
      data: [resultItem()],
    });
    const { value, lines } = await captureLines("warn", () =>
      fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client)),
    );
    assert.deepEqual(value, [], "a parked workflow contributes no posts");
    assert.deepEqual(resultCalls, [], "result() is never awaited on a parked workflow");
    assert.ok(lines.some((line) => line.includes("outside Linked API working hours")));
    assert.ok(lines.some((line) => line.includes("starts when working hours open")));
  });

  it("drops malformed rows with a count and a conditional warn", async () => {
    const good = resultItem({ activityUrn: "urn:li:activity:333", url: "https://u/333" });
    const { client } = stubClient({ data: [resultItem({ author: null }), good] });
    const { value, lines } = await captureLines("warn", () =>
      fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client)),
    );
    assert.equal(value.length, 1);
    assert.ok(lines.some((line) => line.includes("dropped 1 malformed result(s)")));
  });

  it("survives a thrown null — describeError guards non-Error throws", async () => {
    const failing = stubClient({ executeError: null });
    const { value, lines } = await captureLines("warn", () =>
      fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(failing.client)),
    );
    assert.deepEqual(value, []);
    assert.ok(lines.some((line) => line.includes("FAILED — null")), "thrown null degrades");
  });

  it("degrades to warn + [] when the client factory itself rejects", async () => {
    const { value, lines } = await captureLines("warn", () =>
      fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.reject(new Error("install broken"))),
    );
    assert.deepEqual(value, [], "a factory fault contributes no posts and never rejects");
    assert.ok(lines.some((line) => line.includes("linkedin client FAILED — install broken")));
    assert.ok(
      !lines.some((line) => line.includes("linkedin/#hiring react")),
      "no surface runs when the client cannot build",
    );
  });

  it("passes the term verbatim with the pinned search shape", async () => {
    const { client, executeParams } = stubClient({ data: [] });
    await fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client));
    assert.equal(executeParams.length, 1);
    assert.deepEqual(executeParams[0], {
      term: "#hiring react",
      limit: 100,
      filter: { sort: "latest", datePosted: "past24Hours" },
    });
  });
});
```

### src/config.ts — MODIFY (:14-25 ENV_NAMES — Slice 1 added linkedApiToken + linkedApiIdentificationToken; Slice 4 deleted the four linkedin* entries)

One heading per file: Slice 4 rewrote this fence — the merged result (final):

```typescript
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  linkedApiToken: "LINKED_API_TOKEN",
  linkedApiIdentificationToken: "LINKED_API_IDENTIFICATION_TOKEN",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  judgeConcurrency: "JUDGE_CONCURRENCY",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;
```

### package.json — MODIFY (:11 lint path, :20-24 dependencies — Slice 1 added @linkedapi/node; Slice 4 dropped scripts/linkedin-login.ts from the lint path)

One heading per file: Slice 4 rewrote this fence — the merged result (final):

```json
"lint": "biome check src tests scripts/probe-judge.ts scripts/hooks",
```

```json
"dependencies": {
    "@linkedapi/node": "^2.3.20",
    "nodemailer": "^10.3.0",
    "playwright": "^1.49.1"
  },
```

### package-lock.json — MODIFY (regenerated, machine-written)

One command; no hand-written content:

```text
npm install   # regenerates package-lock.json with @linkedapi/node ^2.3.20; COMMIT the result — watch.yml runs npm ci, which fails hard on a stale lockfile
```

### src/index.ts — MODIFY (:47-54, :171-253, :362-411 region)

Modified regions only, top-down (imports → WatcherDeps → runWatcher head →
acquisition closure → deletion → helper). The untouched remainder of the file
is on disk.

```typescript
// ── Region 1: imports ─────────────────────────────────────────────
// REMOVE entirely (fs/path served only the deleted refresh hand-off):
//   import { readFile, writeFile } from "node:fs/promises";
//   import { dirname, join } from "node:path";
// REMOVE entirely (the login module import dies with recoverLinkedInSession):
//   import {
//     TRANSIENT_ESCALATION_ATTEMPTS,
//     clearLoginMarker,
//     loginAllowed,
//     loginLinkedInContext,
//     writeLoginMarker,
//   } from "./linkedin-login.js";

// config-file.js type import gains Surface:
import {
  type ResolvedSurface,
  type Surface,
  type WatcherConfig,
  loadWatcherConfig,
  resolveSurfaces,
} from "./config-file.js";

// ADD after the fetch-threads.js import block (module-quarantine safe:
// importing this module never loads @linkedapi/node — only the factory
// body's dynamic import does):
import {
  type LinkedinSurface,
  type LinkedInApiTokens,
  fetchLinkedInPosts,
  resolveLinkedApiTokens,
} from "./fetch-linkedin-api.js";

// ── Region 2: WatcherDeps ─────────────────────────────────────────
// Interface docstring, seam list gains the SDK fetch:
//   "...env, config, surface fetch, the LinkedIn SDK fetch, LLM
//    transport, SMTP transport, state file, and the clock all
//    inject, so a full pipeline run executes offline."
// New optional field, after contextFactory:
  /** LinkedIn SDK fetcher (Slice 2 seam). Default: fetchLinkedInPosts — the module owns its degrade contract. */
  readonly linkedinFetch?: (
    surfaces: readonly LinkedinSurface[],
    tokens: LinkedInApiTokens,
  ) => Promise<Post[]>;

// ── Region 3: runWatcher head (replaces the old resolveSurfaces +
//    startup-log two-liner) ───────────────────────────────────────
  const linkedinFetch = deps.linkedinFetch ?? fetchLinkedInPosts;
  // D14: labels come from the RAW config partition, not the resolved
  // array — Slice 3 narrows ResolvedSurface to threads-only, and this
  // line must keep listing every surface the run attempts, linkedin
  // included. Labels: tag/<value>, url verbatim, linkedin/<value>.
  console.log(`watch: surfaces: ${config.surfaces.map(surfaceLabel).join(", ")}`);
  // Raw partition first: the SDK fetcher takes raw linkedin surfaces
  // (value verbatim), the walker takes resolved threads records. Slice 3
  // narrows ResolvedSurface.platform to "threads"; partitioning here keeps
  // linkedin entries out of resolveSurfaces from this slice on.
  const linkedinSurfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  const surfaces = resolveSurfaces(
    config.surfaces.filter((surface) => surface.type !== "linkedin"),
  );

// ── Region 4: the acquisition closure (full replacement of the old
//    timeStage body, index.ts:165-253, including its trailing timing +
//    extract lines) ────────────────────────────────────────────────
  // Acquisition stage (D9): the per-platform fetches timed as one span.
  // Extraction happens inside the walk; the dedupe count logs right after
  // the duration line. Threads keeps its Playwright walks; LinkedIn rides
  // the SDK fetcher (Slice 2 rewiring) with a caller-owned token warn.
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
        const tokens = resolveLinkedApiTokens(env);
        if (tokens === null) {
          // D3: the resolver is silent; the caller owns the warn. One
          // message names BOTH variables — the single-exit resolver cannot
          // say which half is absent, and the tokens ship as a pair.
          console.warn(
            `fetch: ${ENV_NAMES.linkedApiToken} / ${ENV_NAMES.linkedApiIdentificationToken} missing or blank — skipping ${linkedinSurfaces.length} linkedin surface(s)`,
          );
        } else {
          try {
            linkedinPosts = await linkedinFetch(linkedinSurfaces, tokens);
          } catch (error) {
            // D12 belt: the module is total by contract (it warns + returns
            // [] internally), so this catches only unanticipated faults and
            // throwing injected stubs — warn + empty, the run goes on (the
            // logged-out-arm catch-degrade precedent, old index.ts:230-243).
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`fetch: linkedin surfaces FAILED — ${message}`);
          }
        }
      }
      // D13: ONE return. The old early returns (empty-pool guard, logged-out
      // arm) silently dropped LinkedIn posts on a linkedin-only config with
      // a Threads secret.
      return [...threadsPosts, ...linkedinPosts];
    } finally {
      // F019 pairing: the Threads session dir dies with the run. The
      // LinkedIn leg keeps no session (SDK tokens, not storage state).
      if (threadsSessionPath !== null) await cleanupSessionDir(threadsSessionPath);
    }
  });
  console.log(`timing: fetch ${fetchMs}ms`);
  const posts = dedupePosts(collected);
  console.log(`extract: ${posts.length} unique post(s) across ${config.surfaces.length} surface(s)`);
  // (the extract line counts config.surfaces.length — the resolved array is
  // threads-only from this slice on; the count is the surfaces ATTEMPTED)

// ── Region 5: DELETION ────────────────────────────────────────────
// DELETE the whole "--- Phase 7: the cooldown-gated credential-login
// fallback ---" section comment and the recoverLinkedInSession function
// (old index.ts:335-411). No other function is removed.

// ── Region 6: module helper (added beside dedupePosts) ────────────
/** D14 log label for one raw config surface. */
function surfaceLabel(surface: Surface): string {
  if (surface.type === "linkedin") return `linkedin/${surface.value}`;
  if (surface.type === "tag") return `tag/${surface.value}`;
  return surface.value; // url surfaces log verbatim
}
```

### tests/index.test.ts — MODIFY (re-keyed warns; Phase 7 suite dies)

Modified regions only, top-down. Tests 1-6 (Gate 2, digest, Gate 1,
heartbeat-off, D3 skip, rotation exhaustion) are untouched.

```typescript
// ── Region 1: header + imports ────────────────────────────────────
// Header coverage list gains: ", the SDK-seam mixed run, the token-skip
// and belt degrades, and the D13/D14 acquisition-shape pins".
// REMOVE: import type { LoginMarker } from "../src/linkedin-login.js";
// REMOVE mkdir from the fs import (tempScenarioDir dies):
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
// ADD after the fetch-threads.js type import:
import type { LinkedInApiTokens, LinkedinSurface } from "../src/fetch-linkedin-api.js";
// EXTEND the types.js import:
import type { JudgeVerdict, Post } from "../src/types.js";

// ── Region 2: fixtures ────────────────────────────────────────────
// KEEP linkedinIdNow (the fixture id below uses it).
// DELETE the linkedinCardBody fixture (no test drives a LinkedIn flight
// body any more — the LinkedIn leg rides the injected SDK fetcher double).
// ADD where linkedinCardBody stood:
/** One SDK-shaped LinkedIn post for the injected fetcher double. */
const linkedinPost = (id: string): Post => ({
  platform: "linkedin",
  id: `urn:li:activity:${id}`,
  text: `LinkedIn hiring post ${id}`,
  author: "linkedin-member",
  permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
  timestamp: iso(NOW),
});

// ── Region 3: dualPlatformContextFactory — linkedinBody goes optional
//    (no test drives the linkedin URL branch after the SDK rekey; the
//    branch itself dies with the walker in Slice 3) ────────────────
function dualPlatformContextFactory(options: {
  threadsCapture: string;
  /** Flight body for linkedin URLs; optional since Slice 2 rekeyed the
   * LinkedIn leg onto the SDK fetcher (unused until Slice 3 sheds the
   * branch). */
  linkedinBody?: string;
  /** Page HTML for the logged-out Threads walk; absent = bare hydrated page. */
  threadsHtml?: string;
  /** Thrown by goto on linkedin URLs — forces a walk-time LinkedIn failure. */
  linkedinGotoError?: Error;
  urls?: string[];
  sessionPaths?: string[];
}): ContextFactory {
  // ...body unchanged EXCEPT one line inside goto's linkedin branch:
  //   text: async () => options.linkedinBody ?? "",

// ── Region 4: tempScenarioDir — DELETE the whole helper (its only
//    consumers were the Phase 7 login tests). The mkdtemp-based
//    tempStatePath helper stays. ──────────────────────────────────

// ── Region 5: rewritten mixed-run test (replaces the old "walks a
//    mixed run through both platform sessions..." test) ───────────
  it("walks a mixed run: Threads through its session, LinkedIn through the SDK fetcher, and cleans the session dir", async () => {
    const urls: string[] = [];
    const sessionPaths: string[] = [];
    const linkedinCalls: Array<{
      surfaces: readonly LinkedinSurface[];
      tokens: LinkedInApiTokens;
    }> = [];
    const statePath = await tempStatePath("mixed-platform.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: {
        ...BASE_ENV,
        LINKED_API_TOKEN: "linked-api-token",
        LINKED_API_IDENTIFICATION_TOKEN: "identification-token",
      },
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([
          { id: id19(11), text: "Hiring: python developer, jakarta remote" },
          { id: id19(12), text: "Hiring: devops engineer, bandung on-site" },
        ]),
        urls,
        sessionPaths,
      }),
      linkedinFetch: async (surfaces, tokens) => {
        linkedinCalls.push({ surfaces, tokens });
        return [linkedinPost(linkedinIdNow)];
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 3, matches: 3, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /3 new job posts/);
    // The SDK fetcher got the raw surface value verbatim and both tokens.
    assert.deepEqual(linkedinCalls, [
      {
        surfaces: [{ type: "linkedin", value: "#hiring" }],
        tokens: {
          linkedApiToken: "linked-api-token",
          identificationToken: "identification-token",
        },
      },
    ]);
    // The Playwright walk never drove a linkedin URL...
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    // ...both platform id forms reached the state file...
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [
      id19(11),
      id19(12),
      `urn:li:activity:${linkedinIdNow}`,
    ]);
    // ...and the Threads session temp file died with the run (F019; the
    // LinkedIn leg keeps no session dir — SDK tokens, not storage state).
    assert.equal(sessionPaths.length, 1);
    for (const path of sessionPaths) {
      await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
    }
  });

// ── Region 6: re-keyed token-absent test (replaces the old
//    LINKEDIN_SESSION_STATE-absent test) ──────────────────────────
  it("completes with Threads posts only when the Linked API tokens are absent, skipping the linkedin surface with a warn", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const urls: string[] = [];
    const statePath = await tempStatePath("linkedin-tokens-absent.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV, // no LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([{ id: id19(13), text: "Hiring: react developer, remote" }]),
        urls,
      }),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The tokenless LinkedIn arm never discards Threads results
    // (acceptance 1) and never routes the surface logged-out.
    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) =>
        /LINKED_API_TOKEN \/ LINKED_API_IDENTIFICATION_TOKEN missing or blank — skipping 1 linkedin surface/.test(
          line,
        ),
      ),
    );
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(13)]);
    assert.equal(subjects.length, 1); // the Gate 2 heartbeat still fires
  });

// ── Region 7: re-keyed linkedin-only test (replaces the old
//    no-LINKEDIN_SESSION_STATE degrade test) ───────────────────────
  it("degrades a linkedin-only config with no tokens to warn + empty funnel + heartbeat", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-only-no-tokens.json");
    const { transport, subjects } = recordingTransport();
    let linkedinCalls = 0;

    const run = await runWatcher({
      env: BASE_ENV, // THREADS_SESSION_STATE present; no LINKED_API_* tokens
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: no threads surfaces
      linkedinFetch: async () => {
        linkedinCalls += 1;
        return [];
      },
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(linkedinCalls, 0, "the fetcher never runs without tokens");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) =>
        /LINKED_API_TOKEN \/ LINKED_API_IDENTIFICATION_TOKEN missing or blank — skipping 1 linkedin surface/.test(
          line,
        ),
      ),
    );
    assert.equal(subjects.length, 1); // the Gate 1 heartbeat still fires
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // nothing persisted
  });

// ── Region 8: transformed belt test (replaces the old "keeps logged-out
//    Threads results when the LinkedIn walk dies at walk time" test) ─
  it("keeps Threads results when the LinkedIn fetch faults at run time (acceptance 1, the D12 belt)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-fetch-throws.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: {
        ...BASE_ENV,
        THREADS_SESSION_STATE: undefined, // logged-out Threads walk
        LINKED_API_TOKEN: "linked-api-token",
        LINKED_API_IDENTIFICATION_TOKEN: "identification-token",
      },
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([]), // unused: the Threads walk is logged-out
        threadsHtml: tagPageHtml([
          { id: id19(14), text: "Hiring: kotlin developer, jakarta", author: "techco" },
        ]),
      }),
      linkedinFetch: async () => {
        throw new Error("sdk socket hang up");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The belt degrades the fault to a warn; the logged-out Threads posts
    // survive and the run completes (exit 0 shape).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin surfaces FAILED — sdk socket hang up/.test(line)));
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(14)]);
  });

// ── Region 9: NEW D13 test ────────────────────────────────────────
  it("keeps LinkedIn posts on a linkedin-only config when a Threads session exists (D13 single return)", async () => {
    const statePath = await tempStatePath("linkedin-only-with-threads-session.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: {
        ...BASE_ENV, // THREADS_SESSION_STATE present
        LINKED_API_TOKEN: "linked-api-token",
        LINKED_API_IDENTIFICATION_TOKEN: "identification-token",
      },
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: zero threads surfaces
      linkedinFetch: async () => [linkedinPost(linkedinIdNow)],
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The old empty-pool guard returned [] before the LinkedIn arm ran;
    // the single return keeps the LinkedIn posts (D13).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [`urn:li:activity:${linkedinIdNow}`]);
  });

// ── Region 10: NEW D14 test ───────────────────────────────────────
  it("logs every surface from the raw config partition in the startup line (D14)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    // The tokenless skip warn fires mid-run; keep the spy call-through.
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("startup-surface-line.json");
    const { transport } = recordingTransport();

    await runWatcher({
      env: BASE_ENV, // tokens absent: the linkedin surface skips after the startup line
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        // A real post: an EMPTY authenticated capture trips the kept Threads
        // all-fail gate and the run dies before the startup line is logged.
        threadsCapture: graphqlBody([{ id: id19(15), text: "Hiring: golang developer, remote" }]),
      }),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /watch: surfaces: tag\/hiring, linkedin\/#hiring/.test(line)));
  });

// ── Region 11: DELETIONS ──────────────────────────────────────────
// DELETE in full: loginFallbackContextFactory (the ~55-line context
// double), LOGIN_ENV_CREDS, and the entire
// "describe(\"runWatcher — Phase 7 credential-login fallback\")" block
// (7 tests: login-ok, challenge, cooldown, session-primary, no-creds,
// transient ladder). No other describe block changes.

// ── Region 12 (Slice 4): dualPlatformContextFactory — the page double's
//    mouse member DELETED (PageLike loses mouse in Slice 4; an excess
//    member on a typed literal fails typecheck) ──────────────────────
// DELETE from the page double inside dualPlatformContextFactory:
//   mouse: {
//     move: async () => undefined,
//     wheel: async () => undefined, // the initial body already carried the posts
//   },
```

### src/fetch-threads.ts — MODIFY (:31 import, :295-305 options, :307-415 dispatch)

Slice 4 deletes, in this same file, the FIVE login/wheel seam members with their last
consumers (D9 sweep, amended 2026-11-02): PageMouseLike (:93-96), LocatorLike.fill? +
doc (:98), PageLike.url? + doc and PageLike.mouse + doc (:114-116),
ContextLike.cookies? + doc (:127), and their factory adapters (:170-199: locator
fill, page url, page mouse, context cookies). Last consumers, all dying in Slice 4:
src/fetch-linkedin.ts (:304 page.url?, :315 page.mouse), src/linkedin-login.ts
(:97/:134 url, :149 fill, :196 cookies), scripts/linkedin-login.ts (:64 cookies).
This file's test double is already clean (Slice 3 trimmed it);
tests/index.test.ts's dualPlatformContextFactory mouse member trims in Slice 4.
No second heading here — the config.ts/package.json precedent.

```typescript
// ── Region 1: imports (DELETE the fetch-linkedin line — Slice 3 sheds the
//    dispatch; the block becomes) ───────────────────────────────────
import type { ResolvedSurface } from "./config-file.js";
import { collectThreadItems, normalizeThreadItem } from "./extract.js";
import { sleep } from "./judge.js";
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

// ── Region 2: AuthenticatedFetchOptions (replaces :295-305;
//    linkedinSessionPath DELETED — the Slice-2 caller stopped passing it) ──
/**
 * Walk-shaping options for the authenticated walk (D6). All fields are
 * optional: the absent scrollRounds key behaves byte-identically to the
 * pre-config walker.
 */
export interface AuthenticatedFetchOptions {
  /** Loop bound for the walk; absent means the Threads-measured default (D4). */
  readonly scrollRounds?: number;
}

// ── Region 3: fetchSurfacesAuthenticated (replaces the docstring + body,
//    :307-415; LinkedIn dispatch plumbing DELETED, eager single context).
//    fetchOneAuthenticated below is UNTOUCHED. ─────────────────────────
/**
 * Fetch posts from the configured Threads surfaces with authenticated
 * sessions.
 *
 * The logged-in tag page defaults to the Top view (old, popular posts) and
 * hydrates post data through graphql XHR responses instead of the initial
 * data-sjs blobs (measured 2026-10-25: 1 post in the blobs vs 92 via XHR).
 * This walk clicks the Recent tab, captures graphql response bodies, walks
 * them for thread_items arrays with the same helpers extractPosts uses, and
 * scrolls until the feed stops yielding new posts.
 *
 * The Recent-tab click is best-effort for every surface: profile pages and
 * search URLs have no such tab, and a `filter=recent` search URL is recent
 * by construction.
 *
 * Surfaces drain through the same bounded slot-array pool as the logged-out
 * walk (D4): results reassemble in input order, peak <= FETCH_CONCURRENCY.
 * Throws when every surface fails (message lists per-surface errors).
 */
export async function fetchSurfacesAuthenticated(
  surfaces: readonly ResolvedSurface[],
  storageStatePath: string,
  contextFactory: ContextFactory = chromiumContextFactory,
  options: AuthenticatedFetchOptions = {},
): Promise<Post[]> {
  // Eager build is safe: the only caller (index.ts) guards surfaces.length > 0
  // before dispatching, so an empty-surface run can never open an idle browser.
  const context = await contextFactory(storageStatePath);
  const scrollRounds = options.scrollRounds ?? MAX_SCROLL_ROUNDS;
  try {
    const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
    const failures: Array<string | undefined> = Array.from({ length: surfaces.length });
    const emptyLabels: Array<string | undefined> = Array.from({ length: surfaces.length });
    // Same migration as fetchSurfaces (F007): the empty-surface side
    // channel rides the closure, the worker stays total.
    await runPool(surfaces, FETCH_CONCURRENCY, async (surface, index) => {
      try {
        const posts = await fetchOneAuthenticated(context, surface, scrollRounds);
        console.log(`extract: ${surface.label}: ${posts.length} post(s) (authenticated)`);
        // A surface that yields 0 posts is NOT a thrown failure, so it never
        // reaches `failures`. Track it separately or the all-fail error below
        // lists nothing and the run dies with no diagnostic.
        if (posts.length === 0) emptyLabels[index] = surface.label;
        perSurface[index] = posts;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures[index] = `${surface.label}: ${message}`;
        console.warn(`fetch: ${surface.label} FAILED — ${message}`);
      }
    });

    const results = perSurface.filter((posts): posts is Post[] => posts !== undefined).flat();
    if (results.length === 0) {
      const detail: string[] = failures.filter((entry): entry is string => entry !== undefined);
      const empties = emptyLabels.filter((label): label is string => label !== undefined);
      if (empties.length > 0) {
        detail.push(
          `${empties.join(", ")}: 0 post(s) extracted — the Recent tab or the graphql XHR capture yielded nothing`,
        );
      }
      throw new Error(
        `fetch: all ${surfaces.length} authenticated surface(s) failed:\n${detail.join("\n")}`,
      );
    }
    return results;
  } finally {
    await context.close();
  }
}

// ── Region 4: seam-member deletions (Slice 4, the D9 sweep — executed
//    WITH the deletion of their last consumers). DELETE each block;
//    the surviving members keep their order. ────────────────────────

// LocatorLike — DELETE the member + its doc line (:98):
//   /** Type into an input (the credential-login fallback, Phase 7); absent on minimal doubles. */
//   fill?(value: string): Promise<void>;

// PageMouseLike — DELETE the whole interface + its doc line (:93-96):
//   /** Wheel-driven scroll controller (LinkedIn pagination; Threads scrolls via evaluate). */
//   interface PageMouseLike {
//     move(x: number, y: number): Promise<void>;
//     wheel(deltaX: number, deltaY: number): Promise<void>;
//   }

// PageLike — DELETE the two members + their doc lines (:114-116):
//   /** Current URL (the Phase 7 login outcome classifier); absent on minimal doubles. */
//   readonly url?: () => string;
//   /** Wheel controller; absent on pages that cannot wheel-scroll. */
//   readonly mouse?: PageMouseLike;

// ContextLike — DELETE the member + its doc block (:127):
//   /**
//    * Cookie-jar read for the Phase 7 credential-login fallback (the fresh
//    * session exports from here); absent on minimal doubles.
//    */
//   readonly cookies?: () => Promise<ReadonlyArray<{ name: string }>>;

// makeChromiumContextFactory — DELETE the four adapter members the above
//    strands (:170-199):
//   locator adapter:   fill: (value) => chain.fill(value),
//   page adapter:      url: () => page.url(),
//   page adapter:      mouse: { move: ..., wheel: ... },   (the whole object)
//   context adapter:   cookies: async () => await context.cookies(),
// and fix the factory docstring phrase that names the dead context:
//   "zero-arg calls (test doubles, the fresh credential-login context) simply
//    build a context from no stored session."
//   → "zero-arg calls (test doubles) simply build a context from no stored session."
```

### tests/fetch-threads.test.ts — MODIFY (:1-7 header, :90-96 options block, :129-137 mouse member, :518-643 dispatch block)

```typescript
// ── Region 1: header docstring (drop the stale "(Slice 3, D4/D5)" phase
//    tag; the coverage list gains the single-context pin) ────────────
/**
 * Offline suite for the fetch pools + context factory seam (D4/D5).
 * Every case injects a ContextFactory double — importing this file never
 * loads Playwright. Covers: input-order results, partial failure, all-fail
 * throw (both message shapes), empty-surface tracking, FETCH_CONCURRENCY
 * peak, the single storage-state context, and context teardown.
 */

// ── Region 2: fakeContextFactory options — DELETE linkedinBodiesBySubstring,
//    wheelBodies, and wheel (their only consumers die with the dispatch
//    block, Region 5); sessionPaths stays, re-documented ──────────────
function fakeContextFactory(options: {
  concurrency: { inFlight: number; peak: number };
  failUrls?: ReadonlySet<string>;
  xhrBySubstring?: ReadonlyMap<string, string>;
  /** The storage-state path per context creation — the authenticated walk builds exactly one. */
  sessionPaths?: string[];
  closed?: { value: boolean };
  /** One graphql body per scroll round; evaluate round N fires element N-1. */
  scrollBodies?: readonly string[];
  /** Per-round counter — the dry-round, scroll-ceiling, and cap oracle. */
  evaluate?: { calls: number };
  /** When true the Recent tab resolves; default keeps the missing-tab path. */
  recentTabVisible?: boolean;
  /** Click spy for the visible-tab path. */
  recentTabClicks?: number[];
  /** waitForTimeout durations in call order (the settle-window oracle). */
  settleWaits?: number[];
}): ContextFactory {

// ── Region 3: the page double's goto — the linkedinEntry branch DELETED ──
          goto: async (url: string) => {
            if ([...failUrls].some((fragment) => url.includes(fragment))) {
              throw new Error(`navigation failed for ${url}`);
            }
            const entry = [...xhrBySubstring.entries()].find(([fragment]) =>
              url.includes(fragment),
            );
            if (entry !== undefined) fire(graphqlResponse(entry[1]));
            return undefined;
          },

// ── Region 4: the page double's mouse member DELETED in full (the double
//    ends: ..., waitForTimeout, close) ────────────────────────────────

// ── Region 5: the describe("fetchSurfacesAuthenticated — platform
//    dispatch") block (LINKEDIN_ID, linkedinBody, linkedinSurfaceEntry +
//    4 tests) DELETED — EXCEPT its Threads scrollRounds test, re-homed
//    VERBATIM into describe("fetchSurfacesAuthenticated") after the
//    Recent-tab-click test, joined by ONE new test ────────────────────
  it("builds its one context from the storage-state path and tears it down", async () => {
    const sessionPaths: string[] = [];
    const closed = { value: false };

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/ctx")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/ctx", graphqlBody(id19(1))]]),
        sessionPaths,
        closed,
      }),
    );

    assert.deepEqual(sessionPaths, ["session-state.json"]); // one context, from the session
    assert.equal(closed.value, true);
    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1)],
    );
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
```

### src/config-file.ts — MODIFY (:20-30 Surface/ResolvedSurface, :219-256 resolveSurfaces + tagPageUrlFor — platform narrowed, linkedin arm + linkedinSearchUrlFor deleted, fail-visible guard added)

```typescript
// ── Region A: Surface union doc + ResolvedSurface (replaces :20-30;
//    the Surface union KEEPS "linkedin" — D8: watcher.config.json stays
//    byte-identical, linkedin entries keep validating) ────────────────
/** One surface to sample. `tag` builds the tag-page URL; `url` is verbatim;
 * `linkedin` stays a valid config value whose raw keyword string the SDK
 * fetcher consumes directly (it never resolves to a URL here). */
export type Surface =
  | { type: "tag"; value: string }
  | { type: "url"; value: string }
  | { type: "linkedin"; value: string };

/** A surface resolved to the URL Playwright loads, plus its log label. */
export interface ResolvedSurface {
  /** Always "threads": LinkedIn rides the SDK fetcher and never resolves here. */
  platform: "threads";
  /** Log label: `tag/hiring`, or the full URL for a `url` surface. */
  label: string;
  /** Absolute URL to load. */
  url: string;
}

// ── Region B: resolveSurfaces + tagPageUrlFor (replaces :219-256; the
//    linkedin arm and linkedinSearchUrlFor + its doc comment are DELETED).
//    The guard mirrors the repo's unreachable-wiring-bug idiom (the old
//    threadsContext() guard): the only caller partitions linkedin surfaces
//    out first (Slice 2), so one arriving here is a wiring bug — fail
//    visible, never a silent garbage-URL fall-through. ────────────────
/**
 * Resolve configured surfaces to the URLs Playwright loads. Only threads
 * surfaces resolve: linkedin entries stay valid config, but the SDK fetcher
 * (src/fetch-linkedin-api.ts) consumes their raw value, so the caller
 * partitions them out first — one reaching this function is a wiring bug
 * and fails visibly.
 */
export function resolveSurfaces(surfaces: readonly Surface[]): ResolvedSurface[] {
  return surfaces.map((surface): ResolvedSurface => {
    if (surface.type === "linkedin") {
      throw new Error(
        `linkedin surface "${surface.value}" reached resolveSurfaces — a wiring bug: partition linkedin surfaces out before resolving (the SDK fetcher takes their raw value)`,
      );
    }
    if (surface.type === "tag") {
      return {
        platform: "threads",
        label: `tag/${surface.value}`,
        url: tagPageUrlFor(surface.value),
      };
    }
    return { platform: "threads", label: surface.value, url: surface.value };
  });
}

/** Tag-page URL. Kept local so src/config.ts no longer owns surface policy. */
function tagPageUrlFor(tag: string): string {
  return `https://www.threads.com/tag/${encodeURIComponent(tag)}`;
}
```

### tests/config-file.test.ts — MODIFY (:192-203 dies → guard test replaces it)

```typescript
// The "builds a linkedin content-search URL byte-exactly" test (inside
// describe("resolveSurfaces")) is DELETED and replaced by:
  it("fails visibly when a linkedin surface reaches resolveSurfaces (the SDK fetcher consumes them raw)", () => {
    assert.throws(
      () => resolveSurfaces([{ type: "linkedin", value: "#hiring" }]),
      /linkedin surface "#hiring" reached resolveSurfaces/,
    );
  });
// The linkedin config-validation tests (accepts a linkedin surface; rejects
// an empty / non-string linkedin value) stay UNTOUCHED — D8: linkedin keeps
// validating at the config level.
```

### tests/fetch-linkedin.test.ts — MODIFY (bridge edit; the file is DELETED in Slice 4)

The platform narrowing (config-file.ts Region A) breaks exactly one literal outside the
dying dispatch tests: this suite's linkedinSurface helper. The walk reads surface.url
(:291) and surface.label (logs) only — no surface.platform read (verified by
slice-verifier against the on-disk source).

```typescript
const linkedinSurface = (label: string): ResolvedSurface => ({
  // Slice 3 narrowed ResolvedSurface.platform to "threads" (the SDK cutover);
  // this walk reads label/url only. The literal dies with the module (Slice 4).
  platform: "threads",
  label,
  url: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(label)}`,
});
```

### src/judge.ts — MODIFY (:98-107 F023 comment twin)

The WAIT_BUDGET_MS docstring is the only change; the const value stays 180_000 (D10). Written by Slice 4:

```typescript
/**
 * Shared in-run park budget: the total time both judge phases may spend
 * parked on cooling accounts before the run converts to the exhaustion
 * alarm. Drawn down charge-before-sleep, re-charged with the actual
 * elapsed after wake.
 *
 * Sized by arithmetic from measured numbers (F023), not a new probe: the
 * 480s job cap minus the 60-100s setup prologue (checkout + npm ci +
 * Playwright install; the watch.yml ms-playwright cache removes 30-60s of
 * it) minus the 60s abort tail leaves ~320-360s for the fetch stage,
 * judge waves, and parks. The fetch term is PENDING MEASUREMENT: LinkedIn
 * rides the sequential Linked API SDK workflows now, and the first live
 * dispatch's `timing: fetch <N>ms` line pastes into this comment and into
 * watch.yml in the one declared retune commit. A 180s park budget keeps
 * the exhaustion alarm ~1-2 min inside the 8-minute envelope, and the run
 * still dies before the next 10-minute tick queues.
 */
const WAIT_BUDGET_MS = 180_000;
```

### src/threads-session.ts — MODIFY (:13 docstring)

Docstring only: two paragraph rewrites (the header line and the closing paragraph). The resolver body, the envName parameter, and every other line are untouched. Written by Slice 4:

```typescript
/**
 * Session resolution for the Threads walk (Phase 8).
 *
 * An authenticated walk replays a Playwright storageState document
 * exported from a real browser login. The document travels base64-encoded
 * in a session environment variable (a GitHub Actions secret): it is
 * account-equivalent, so it never enters the repo and never enters
 * state/seen-posts.json. The decoded document is written to an OS temp
 * file that Playwright loads as the browser context's storage state.
 *
 * The variable name is a parameter defaulting to the Threads var. A null
 * return means "no usable session"; what happens next is the caller's
 * policy — Threads falls back to the logged-out walk. LinkedIn rides the
 * Linked API SDK tokens (src/fetch-linkedin-api.ts) and resolves no
 * session at all.
 */
```

### tests/session.test.ts — MODIFY (:55-85 dies)

Written by Slice 4:

```typescript
// ── Region 1: imports — DELETE the ENV_NAMES line (its only consumers
//    were the four LinkedIn-var tests below) ────────────────────────
//   import { ENV_NAMES } from "../src/config.js";

// ── Region 2: inside describe("resolveSession") — DELETE the four
//    LinkedIn-var tests; LINKEDIN_SESSION_STATE dies with the SDK
//    cutover (the SDK resolves no session for LinkedIn) ─────────────
// DELETE "resolves the LinkedIn var when it is given as the env name"
//   (resolveSession({ LINKEDIN_SESSION_STATE: VALID }, ENV_NAMES.linkedinSession))
// DELETE "returns null for the LinkedIn var when only the Threads var is set"
//   (resolveSession({ THREADS_SESSION_STATE: VALID }, ENV_NAMES.linkedinSession))
// DELETE "warns naming the LinkedIn var when its value is not base64 JSON"
// DELETE "warns naming the LinkedIn var when its document carries no cookies"
// The resolveSession signature keeps its envName parameter (generic API);
// no test passes a second argument after this slice. The remaining
// resolveSession / isValidStorageState / cleanupSessionDir tests are
// untouched.
```

### .gitignore — MODIFY (:8 dies)

Written by Slice 4 — the final file (the linkedin-state*.b64 line is gone):

```
node_modules/
.env
.env.*
.pi/
.rpiv/tmp/
.codebase-memory/graph.db.zst
slice*-recon/
run.log
```

### .github/workflows/watch.yml — MODIFY (:11-13, :43-55, :94-97, :103-129, :141-146)

Written by Slice 4 — five regions (the concurrency comment, the timeout comment, the env swap, the refresh-step deletion, the commit-marker collapse):

```yaml
# ── Region 1: concurrency (:11-13) — queue becomes cancel (D10) ────
concurrency:
  group: watch
  # The SDK cutover flips queue to cancel: a run parked on a Linked API
  # workflow can hold the whole 8-minute cap, and queueing every 10-minute
  # tick behind it backs the schedule up without bound. Cancel keeps at
  # most one run alive — which still serializes the state read-modify-
  # write (the in-flight run is dead, never concurrent) — and the newest
  # run is the one worth keeping. State writes stay atomic + rebase-safe
  # either way.
  cancel-in-progress: true

# ── Region 2: the watch job's timeout comment (:43-55) — the 71s term
#    is out and the fetch term is marked pending-measurement (D10, in
#    lockstep with src/judge.ts); timeout-minutes stays 8 ────────────
    # Width-4 judge (the probe job's reading): 30 bulk calls clear in ~8
    # waves, and the 40-call fallback budget adds about a minute. Measured
    # 2026-10-27: 8-wide bursts drew HTTP 429s from the endpoint, 4-wide
    # ran clean. The 8-minute cap keeps a hung run under the 10-minute
    # cron interval — it dies before the next tick queues (cancel-in-
    # progress now drops a superseded run instead of queueing it).
    # Timeout envelope arithmetic (F023): 480s job cap - 60-100s setup
    # prologue (checkout + npm ci + Playwright install; the ms-playwright
    # cache removes 30-60s of it) - 60s abort tail leaves ~320-360s for
    # the fetch stage, judge waves, and parks. The fetch term is PENDING
    # MEASUREMENT: LinkedIn rides the sequential Linked API SDK workflows
    # now, and the first live dispatch's `timing: fetch <N>ms` line pastes
    # here and into src/judge.ts in the one declared retune commit.
    # WAIT_BUDGET_MS (180s, src/judge.ts) caps the parked wait before the
    # exhaustion alarm, so the alarm lands ~1-2 min inside the cap and the
    # run still dies before the next 10-minute tick queues.
    timeout-minutes: 8

# ── Region 3: Run watcher env (:94-97) — the four LINKEDIN_* lines are
#    DELETED and the Linked API token pair joins (1:1 secrets mirroring;
#    JUDGE_CONCURRENCY / HEARTBEAT_ENABLED / THREADS_SESSION_STATE /
#    LLM_ACCOUNTS / GMAIL_* lines unchanged) ─────────────────────────
      - name: Run watcher
        env:
          JUDGE_CONCURRENCY: "4"   # probe run 40455686221 reading, z.ai burst-verified — paste a fresh measuring run's reading
          HEARTBEAT_ENABLED: ${{ vars.HEARTBEAT_ENABLED }}   # zero-match status email kill switch; unset = enabled
          THREADS_SESSION_STATE: ${{ secrets.THREADS_SESSION_STATE }}
          LINKED_API_TOKEN: ${{ secrets.LINKED_API_TOKEN }}   # absent/blank => linkedin surfaces skip with one warn (src/fetch-linkedin-api.ts); Threads still runs
          LINKED_API_IDENTIFICATION_TOKEN: ${{ secrets.LINKED_API_IDENTIFICATION_TOKEN }}   # ships as a pair with LINKED_API_TOKEN
          LLM_ACCOUNTS: ${{ secrets.LLM_ACCOUNTS }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: npx tsx src/index.ts

# ── Region 4: DELETE the whole "Refresh LinkedIn session secret" step
#    (:103-129) — no credential login, no refresh hand-off, no
#    LINKEDIN_SECRET_WRITER use anywhere in the workflow ─────────────

# ── Region 5: Commit state (:141-146) — the linkedin-login.json marker
#    branch collapses to a single state-file add ─────────────────────
      - name: Commit state
        # F021: the queue serializes watcher runs, but a human push can land
        # between this run's checkout and its commit-back. The rebase, the
        # state-only conflict skip, the lease push, and the single retry all
        # live in the committed script under scripts/ — this step keeps only
        # the YAML-owned head: bot identity, the state-file-only add, the
        # no-op guard, and the jq delta commit.
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
          bash scripts/commit-state-rebase.sh
```

### Deleted files (Slice 4)

- src/linkedin-login.ts (315 lines)
- scripts/linkedin-login.ts (120 lines)
- src/fetch-linkedin.ts (346 lines) — added 2026-11-02: Slice 3 strips its last
  importer (fetch-threads.ts), and its page.mouse/page.url? reads are the consumers
  the amended D9 sweep deletes alongside it (FRD D7: the Playwright path is deleted
  entirely)
- tests/linkedin-login.test.ts
- tests/fetch-linkedin.test.ts

### README.md — MODIFY (:16-19, :66-69, :101, :106, :114-115, :207, :242-307; :36-38 pinned and verified unchanged)

````markdown
Docs sync — the post-cutover reader-facing truth. Hunks are REPLACE/WITH;
line numbers are pre-edit. Pinned-and-verified-UNCHANGED: README.md:36-38
(the `[linkedin]` digest marker + "+ LinkedIn" subject step) — email.ts is
untouched by the cutover. Dry-run green pre-checkpoint: every anchor unique,
all gates pass on the assembled tree (.rpiv/tmp/slice5-docs/, 2026-11-02).

── Region 1: Pipeline step 2 (:16-19) ──
REPLACE:
  2. LinkedIn surfaces are walked with a signed-in session from
     `LINKEDIN_SESSION_STATE`, reading posts from the LinkedIn flagship-web
     search responses. With that secret unset or invalid, those surfaces are
     skipped with a warning and the run continues on Threads alone.
WITH:
  2. LinkedIn surfaces run one Linked API post search each — the surface's
     keywords string goes verbatim to the `@linkedapi/node` SDK (`sort:
     latest`, past 24 hours, up to 100 posts). With `LINKED_API_TOKEN` or
     `LINKED_API_IDENTIFICATION_TOKEN` unset or blank, those surfaces are
     skipped with one warning and the run continues on Threads alone.

── Region 2: Secrets table rows (:66-69) ──
REPLACE the four rows:
     | `LINKEDIN_SESSION_STATE` | base64 storageState | LinkedIn login session (see below) |
     | `LINKEDIN_EMAIL` | you@gmail.com | Optional. With `LINKEDIN_PASSWORD`, enables the fallback login below |
     | `LINKEDIN_PASSWORD` | your-linkedin-password | Optional. Only sent to linkedin.com at login time |
     | `LINKEDIN_SECRET_WRITER` | fine-grained PAT | Optional. Lets a successful fallback login rewrite `LINKEDIN_SESSION_STATE` (this repo only, **Actions secrets read/write**, short expiry) |
WITH two rows:
     | `LINKED_API_TOKEN` | your-linked-api-token | Linked API token for the LinkedIn post search (see below) |
     | `LINKED_API_IDENTIFICATION_TOKEN` | your-identification-token | Linked API identification token — ships as a pair with `LINKED_API_TOKEN` |

── Region 3: surfaces config row tail (:101) ──
REPLACE:
  linkedin entries build a LinkedIn content search (newest first, past 24 hours) from a keywords string and need `LINKEDIN_SESSION_STATE`. |
WITH:
  linkedin entries feed a keywords string to the Linked API post search (newest first, past 24 hours) and need `LINKED_API_TOKEN` + `LINKED_API_IDENTIFICATION_TOKEN`. |

── Region 4: scrollRounds row (:106) ──
REPLACE:
  | `scrollRounds` | Upper bound on scroll rounds per surface walk, shared by the Threads scroll loop and LinkedIn pagination. Must be a whole number >= 1; absent defaults to `8`. |
WITH:
  | `scrollRounds` | Upper bound on scroll rounds per Threads surface walk. Must be a whole number >= 1; absent defaults to `8`. |

── Region 5: LinkedIn snippet lead-in (:114-115) ──
REPLACE:
  A LinkedIn content search is the same kind of edit — a keywords string, not
  a URL:
WITH:
  A LinkedIn search is the same kind of edit — a keywords string the Linked
  API post search runs, not a URL:
(The ```json block under it is unchanged: `{ "type": "linkedin", ... }` is
still the config shape — D8 keeps linkedin a valid config value.)

── Region 6: the two LinkedIn sections (:242-307) ──
DELETE in full — heading through final paragraph, all three:
  "## Refresh the LinkedIn session"
  "## Optional: the fallback login (self-refreshing session)"
  "### When CI login keeps hitting checkpoints"
INSERT in their place (immediately before "## Local run"):
  ## LinkedIn tokens (Linked API)
  
  LinkedIn posts come from the [Linked API](https://linkedapi.io) post
  search — a cloud-browser service, so no LinkedIn session, cookie export,
  or password is stored anywhere. The watcher needs a paid Linked API seat
  with a connected LinkedIn account and both tokens:
  
  1. Sign up at linkedapi.io, connect your LinkedIn account, and create an
     API token and an identification token in the dashboard.
  2. Set both secrets:
  
     ```bash
     gh secret set LINKED_API_TOKEN --body "your-linked-api-token"
     gh secret set LINKED_API_IDENTIFICATION_TOKEN --body "your-identification-token"
     ```
  
  With either secret unset or blank, linkedin surfaces are skipped with one
  warning naming both variables, and the run continues on Threads alone. A
  surface the Linked API cannot serve — an error, or the search parked
  outside Linked API working hours — logs a `FAILED` line and the rest of
  the run continues. LinkedIn has no logged-out fallback, but one bad
  surface never fails the run.

── Region 7: external-cron concurrency sentence (:207)  [DISCLOSED ADDITION — D10 lockstep] ──
REPLACE:
  (`watch.yml:11-13`), so overlapping triggers queue instead of racing.
WITH:
  (`watch.yml:11-13`), so overlapping triggers cancel the older run instead of racing it.
````

### .rpiv/guidance/architecture.md — MODIFY (:9, :38)

````markdown
── Region 1: architecture tree, src/ line (:9) ──
REPLACE:
  src/                # the pipeline: fetch (threads + linkedin) → extract → dedupe → recency → seen → judge → notify → persist
WITH:
  src/                # the pipeline: fetch (threads Playwright walks + linkedin Linked API SDK) → extract → dedupe → recency → seen → judge → notify → persist

── Region 2: Business Context (:38) ──
REPLACE:
  A missing optional session secret (e.g. `LINKEDIN_SESSION_STATE`) skips that platform's surfaces with a warn; the run still completes and the heartbeat still fires.
WITH:
  Missing optional credentials (e.g. the Linked API token pair `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN`) skip that platform's surfaces with a warn; the run still completes and the heartbeat still fires.
````

### .rpiv/guidance/src/architecture.md — MODIFY (:7, :16-17, :64-76)

````markdown
── Region 1: Dependencies bullet (:7) ──
REPLACE:
  - **playwright**: quarantined behind the single dynamic-import site — `chromiumContextFactory` in fetch-threads.ts is the ONLY `await import("playwright")` in src/; fetch-linkedin.ts consumes the seam type-only
WITH two bullets:
  - **playwright**: quarantined behind the single dynamic-import site — `chromiumContextFactory` in fetch-threads.ts is the ONLY `await import("playwright")` in src/ (Threads walks only)
  - **@linkedapi/node**: quarantined the same way — `createLinkedApiClient` in fetch-linkedin-api.ts is the ONLY `await import("@linkedapi/node")` in src/; the import is NAMED (the default export is the CJS namespace object — not constructable under NodeNext + verbatimModuleSyntax, D2/D15)

── Region 2: Module Structure, ACQUISITION group (:16-17) ──
REPLACE (column alignment follows the surrounding block):
  threads-session.ts, fetch-threads.ts,    # ACQUISITION: session secret → storageState | walker + *Like seam +
  fetch-linkedin.ts, extract.ts            #   contextFactory + platform dispatch | LinkedIn wheel walk | data-sjs walk
WITH:
  threads-session.ts, fetch-threads.ts,    # ACQUISITION: session secret → storageState | Threads walker + *Like seam +
  fetch-linkedin-api.ts, extract.ts        #   contextFactory | LinkedIn SDK post search (sequential, never throws) | data-sjs walk

── Region 3: the platform-fetcher section (:64-76) ──
REPLACE the whole section — the heading plus its fenced typescript block
through the Flight-stream comment line (ends right before "## State:"):
WITH:
  ## fetch-linkedin-api.ts: the second platform rides the Linked API SDK
  
  ```typescript
  // SEARCH SHAPE (module constants, not config — repo doctrine): term verbatim from the raw linkedin
  // surface value, limit 100 (the SDK max), filter { sort: "latest", datePosted: "past24Hours" }.
  // TOKEN RESOLVER (silent null, the resolveSession model): resolveLinkedApiTokens(env) returns both tokens
  // or null when either is unset/blank; runWatcher owns the ONE warn naming BOTH variables — a single-exit
  // resolver cannot say which half is absent, and the tokens ship as a pair. Missing tokens ⇒ surfaces skip,
  // run exits 0.
  // SEAM: LinkedApiClientLike structural double for the offline suite; createLinkedApiClient (dynamic NAMED
  // import — the default export is the CJS namespace, TS2351) is the module's only @linkedapi/node touch.
  // TOTAL BY CONTRACT (never rejects): the sequential per-surface loop (FR4 — no runPool for LinkedIn) warns
  // + skips a surface whose execute()/result() throws (LinkedApiError.type + message); a parked workflow
  // (pendingReason "outsideWorkingHours") warns and NEVER awaits result(); result().errors[] warns each entry
  // and keeps the posts so far; an empty result is success ("OK — 0 post(s)"); a failed client build degrades
  // to warn + [] (D12: the module is the required boundary, the caller's catch is belt).
  // MAPPING: id = activityUrn ?? the urn parsed from url (drop+count when neither); text = text ??
  // repostText (drop+count when both empty); author.name required; the timestamp is guarded BEFORE
  // toISOString; per-surface Map dedupe by id (global dedupe stays in runWatcher's dedupePosts).
  // DIGEST: post lines carry the [linkedin] marker and the subject appends " + LinkedIn" when >=1 match —
  // unchanged (email.ts never knew how posts were fetched).
  ```
````

### .rpiv/guidance/tests/architecture.md — MODIFY (:7, :17; :7 is the ratified SDK-never-loads clause)

````markdown
── Region 1: Dependencies bullet (:7)  [DISCLOSED ADDITION — the SDK-never-loads clause] ──
REPLACE:
  - nodemailer contributes types only (fake transports); Playwright is never imported at test time (structural `*Like` doubles)
WITH:
  - nodemailer contributes types only (fake transports); Playwright is never imported at test time (structural `*Like` doubles); the Linked API SDK never loads either (the factory's dynamic import is the only site)

── Region 2: Coverage map line (:17) ──
REPLACE:
  fetch-linkedin.ts  → fetch-linkedin.test.ts  # synthetic Flight bodies; staged-response ContextLike double
WITH:
  fetch-linkedin-api.ts → fetch-linkedin-api.test.ts  # stubbed LinkedApiClientLike: typed errors, parked workflows, errors[], drop-count
````

### .rpiv/guidance/.github/workflows/architecture.md — MODIFY (:7, :17, :34-35, :46; :17 + :34-35 are the ratified D10 additions)

````markdown
── Region 1: Sync points, env-count bullet (:7) ──
REPLACE:
  - Step `env:` keys ↔ `ENV_NAMES` in `src/config.ts` — 1:1 name mirroring (7 today, incl. `LINKEDIN_SESSION_STATE`); `HEARTBEAT_ENABLED` maps via `vars.` (not `secrets.` — the one non-secret knob); unset means enabled
WITH:
  - Step `env:` keys ↔ `ENV_NAMES` in `src/config.ts` — 1:1 name mirroring (8 today, incl. the Linked API pair `LINKED_API_TOKEN` / `LINKED_API_IDENTIFICATION_TOKEN`); `HEARTBEAT_ENABLED` maps via `vars.` (not `secrets.` — the one non-secret knob); unset means enabled

── Region 2: Structure block, watch.yml line (:17)  [DISCLOSED ADDITION — D10 lockstep] ──
REPLACE:
  watch.yml   # cron */10 + dispatch | permissions: contents: write | concurrency: watch (queue)
WITH:
  watch.yml   # cron */10 + dispatch | permissions: contents: write | concurrency: watch (cancel)

── Region 3: the concurrency yaml lines (:34-35)  [DISCLOSED ADDITION — D10 lockstep] ──
REPLACE:
    cancel-in-progress: false    # QUEUE, never kill: the state read-modify-write must serialize
      # (job-level) timeout-minutes: 8 — a hung run dies BEFORE the next */10 tick queues
WITH:
    cancel-in-progress: true     # the SDK cutover flipped queue to cancel: a parked Linked API workflow can
                                 # hold the whole 8-minute cap, and queueing every 10-minute tick behind it
                                 # backs the schedule up without bound. Cancel keeps at most one run alive —
                                 # which still serializes the state read-modify-write (the in-flight run is
                                 # dead, never concurrent)
      # (job-level) timeout-minutes: 8 — a hung run dies BEFORE the next */10 tick (cancel drops a superseded run instead of queueing it)

── Region 4: step-scoped secrets env (:46) ──
REPLACE:
      LINKEDIN_SESSION_STATE: ${{ secrets.LINKEDIN_SESSION_STATE }}   # absent secret ⇒ resolver null ⇒ surfaces skip
WITH:
      LINKED_API_TOKEN: ${{ secrets.LINKED_API_TOKEN }}   # absent/blank ⇒ linkedin surfaces skip with one warn (fetch-linkedin-api.ts); Threads still runs
      LINKED_API_IDENTIFICATION_TOKEN: ${{ secrets.LINKED_API_IDENTIFICATION_TOKEN }}   # ships as a pair with LINKED_API_TOKEN
````

## Slices

### Slice 1: SDK fetcher module

**Files**: `src/fetch-linkedin-api.ts` (NEW), `tests/fetch-linkedin-api.test.ts` (NEW), `src/config.ts` (MODIFY — two ENV_NAMES entries join), `package.json` (MODIFY — @linkedapi/node dependency), `package-lock.json` (MODIFY — regenerated by npm install, committed)

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck` (after `npm install` picks up the in-slice package.json dependency)
- [ ] Lockfile in sync: `npm install` regenerates `package-lock.json` with @linkedapi/node and the result is COMMITTED — `npm ci` exits 0 (watch.yml installs with npm ci, which fails hard on a lockfile/package.json mismatch)
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass (incl. the new suite): `npm test`
- [ ] Quarantine holds — `grep -c 'await import("@linkedapi/node")' src/fetch-linkedin-api.ts` returns exactly 1
- [ ] No pool, no all-fail throw — `grep -c "runPool" src/fetch-linkedin-api.ts` returns 0 and `grep -c "all .*failed" src/fetch-linkedin-api.ts` returns 0
- [ ] Env names registered — `grep -c "LINKED_API_" src/config.ts` returns 2

#### Manual Verification:
- [ ] Live SDK behavior is NOT verifiable offline — the live dispatch gate lands in Slice 4 (operator precondition: Linked API seat + both tokens)

### Slice 2: runWatcher rewiring

**Files**: `src/index.ts`, `tests/index.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] `grep -c "recoverLinkedInSession" src/index.ts` returns 0
- [ ] `grep -c "linkedin-login" src/index.ts` returns 0
- [ ] `grep -c "LINKEDIN_SESSION_STATE" src/index.ts` returns 0 — the skip warn names LINKED_API_TOKEN (tests/index.test.ts pins the regex)
- [ ] `grep -c "threadsPosts, ...linkedinPosts" src/index.ts` returns exactly 1 — the D13 single return
- [ ] SDK seam result carried, not re-run: D15 (2026-11-02 scratch-project check) already proved the exact dynamic named-import quarantine compiles under repo-exact flags

#### Manual Verification:
- [ ] Live SDK dispatch is NOT verifiable offline — the live gate lands in Slice 4 (operator precondition: Linked API seat + both tokens in GitHub secrets)
- [ ] Startup line: a mixed-config run logs `watch: surfaces: tag/hiring, linkedin/#hiring` (D14; pinned by a test, visible in `npm test` output)

### Slice 3: Threads-only shed + config-file arm death

**Files**: `src/fetch-threads.ts`, `tests/fetch-threads.test.ts`, `src/config-file.ts`, `tests/config-file.test.ts`, `tests/fetch-linkedin.test.ts` (3-line bridge — the file is DELETED in Slice 4)

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test` — includes the re-homed scrollRounds test, the new single-context test, the new resolveSurfaces guard test, and the bridged fetch-linkedin suite
- [ ] Dispatch shed: `grep -c "linkedinSessionPath" src/fetch-threads.ts` returns 0; `grep -c "walkLinkedInSurface" src/fetch-threads.ts` returns 0; `grep -c "fetch-linkedin" src/fetch-threads.ts` returns 0
- [ ] Config arm death: `grep -c "linkedinSearchUrlFor" src/config-file.ts` returns 0 and `grep -c "linkedinSearchUrlFor" tests/config-file.test.ts` returns 0
- [ ] Platform narrowed: `grep -c 'platform: "threads" | "linkedin"' src/config-file.ts` returns 0
- [ ] Sweep deferral intact for Slice 4: `grep -c "interface PageMouseLike" src/fetch-threads.ts` returns 1 and `grep -c "readonly cookies?" src/fetch-threads.ts` returns 1

#### Manual Verification:
- [ ] `grep -in "linkedin" src/config-file.ts` — every match sits in an intended docstring, type member, validator, or guard message (Surface union doc + member line, the ResolvedSurface.platform docstring — "Always \"threads\": LinkedIn rides the SDK fetcher and never resolves here." —, readSurfaces check + message, resolveSurfaces doc + guard + message); zero in URL building
- [ ] `grep -in "linkedin" src/fetch-threads.ts` — exactly 1 match remains: the PageMouseLike docstring ("LinkedIn pagination"), inside a member Slice 4 deletes with its last consumer (src/fetch-linkedin.ts); zero in imports, options, dispatch, or teardown

### Slice 4: Phase 7 deletion + env swap + F023 lockstep

**Files**: `src/config.ts`, `src/judge.ts`, `src/threads-session.ts`, `tests/session.test.ts`, `package.json`, `.gitignore`, `.github/workflows/watch.yml`, `src/fetch-threads.ts` (Slice-4 half: the five seam-member deletions + factory adapters, amended 2026-11-02), `tests/index.test.ts` (dualPlatformContextFactory mouse-member trim); DELETE `src/linkedin-login.ts`, `scripts/linkedin-login.ts`, `src/fetch-linkedin.ts` (added 2026-11-02 — verifier-found orphan), `tests/linkedin-login.test.ts`, `tests/fetch-linkedin.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] Scratch compile (standing instruction 4, DONE 2026-11-02 pre-checkpoint): `npx tsc -p .rpiv/tmp/slice4-compile/tsconfig.json --noEmit` exit 0 — the post-cutover src tree (on-disk originals + locked S1-S3 fences + S4 fences, the five deleted modules absent, @linkedapi/node 2.3.20 from the D15 sdk-check install) compiles clean under repo-exact flags; compiler-proves the ENV_NAMES deletion, the seam-member deletions, and the patched S1 rename (`LinkedInSearchItem` → `LinkedInSearchResultItem`, 2 refs in the locked S1 fence, patched in this pass)
- [ ] ENV_NAMES accessor gate (standing instruction 1; pre-implement reading reconciled 2026-11-02): `grep -rn "ENV_NAMES.linkedin" src/ tests/ scripts/` returns 0 matches — the index.ts hits (:175/:192/:368/:369/:408) die in locked Slice 2, the tests/session.test.ts hits (:55/:63/:72/:82) die in this slice
- [ ] LINKEDIN_ literal gate (README.md excluded — it is Slice 5's file; its literal gate is the Verification Notes hand-off below): `grep -rn "LINKEDIN_" src/ tests/ .github/` returns 0 matches (the src/ hits die with src/fetch-linkedin.ts — deleted this slice; config.ts :16-19 die with the ENV_NAMES swap; watch.yml :94-97/:110-125 die in Regions 3-4; the tests/session.test.ts :55-85 region dies; the tests/index.test.ts LINKEDIN_ strings died in locked Slice 2)
- [ ] F023 lockstep gate: `grep -rn "71s" .github/workflows/watch.yml src/judge.ts` returns 0 matches
- [ ] Deleted modules absent: `test ! -f src/linkedin-login.ts && test ! -f src/fetch-linkedin.ts && test ! -f scripts/linkedin-login.ts && test ! -f tests/linkedin-login.test.ts && test ! -f tests/fetch-linkedin.test.ts` succeeds
- [ ] No importer remains: `grep -rln -E "fetch-linkedin\.js|linkedin-login\.js" src/ tests/ scripts/` returns 0 matches (the fetch-linkedin.js importer, src/fetch-threads.ts:31, dies in locked Slice 3; the linkedin-login.js importers, src/index.ts:47-54 + tests/index.test.ts:27, die in locked Slice 2; the remaining importers are the deleted files themselves)
- [ ] D15 citation (carried, not re-run): the SDK seam was verified pre-implement 2026-11-02 against the installed @linkedapi/node 2.3.20 under repo-exact flags

#### Manual Verification:
- [ ] LIVE DISPATCH GATE (owner: the operator, post-merge — never CI): with the Linked API seat connected and both tokens in GitHub secrets, one workflow_dispatch run of watch.yml completes green AND a second run with a deliberately bad LINKED_API_TOKEN proves the single warn + Threads delivery + exit 0; capture `timing: fetch <N>ms` from the good run for the declared retune commit. Per the repo precedent (68c1e2d, f571904 — live-unproven fetch paths shipped twice), this run is a completion gate of the design, not a nicety: the cutover is NOT done until it passes.
- [ ] Merge gate: the live-dispatch gate above rides the cutover PR's checklist as a merge-blocking item — this artifact records two live-unproven fetch paths shipping (68c1e2d, f571904); a merge without the gate means the declared retune commit is scheduled blind

### Slice 5: Docs sync

**Files**: `README.md`, `.rpiv/guidance/architecture.md`, `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/tests/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint` (docs live outside the Biome globs — CI-parity gate only)
- [ ] Tests pass: `npm test`
- [ ] README literal gate: `grep -rn -E "LINKEDIN_|linkedin-login|linkedin-state" README.md` returns 0 matches — all eleven enumerated literal rows sit inside replaced regions
- [ ] Guidance literal gate: `grep -rn -E "LINKEDIN_|fetch-linkedin\.|linkedin-login|linkedin-state|wheel walk" .rpiv/guidance/` returns 0 matches (fetch-linkedin-api mentions remain and are the live module)
- [ ] Token pair carried: `grep -c "LINKED_API_IDENTIFICATION_TOKEN" README.md` returns >= 3 (pipeline step 2, secrets table, token-setup section)
- [ ] Docs name the new module: `grep -c "fetch-linkedin-api" .rpiv/guidance/src/architecture.md` returns >= 1 and the same grep on `.rpiv/guidance/tests/architecture.md` returns >= 1
- [ ] Concurrency docs match the flipped watch.yml: `grep -c "cancel-in-progress: true" .rpiv/guidance/.github/workflows/architecture.md` returns exactly 1
- [ ] Scope pins honored: every hunk sits in a design-pinned region or one of the three disclosed additions recorded in Developer Context (README queue sentence; workflows-guidance Regions 2-3; tests-guidance Region 1)

#### Manual Verification:
- [ ] README reads coherently post-cutover: no dangling "fallback login below" pointers; the two LinkedIn walk sections replaced by one "LinkedIn tokens (Linked API)" section
- [ ] Pinned-and-verified-unchanged recorded: the README digest-marker step (email.ts untouched), the guidance "Adding a New Platform Fetcher" block — BOTH stale mechanisms named: step 2 (ENV_NAMES.<platform>Session + resolveSession) and step 5 (platform filter + AuthenticatedFetchOptions rider + runPool worker arm — all three mechanisms deleted by Slices 2-3) — left generic for future platforms, "Adding a New Scheduled Job" step 4 (queue stays the generic new-job default), the README Local run section (tokens optional, stays minimal)
- [ ] Gates were dry-run pre-checkpoint: anchors proven unique and all gates green on the assembled tree (.rpiv/tmp/slice5-docs/, 2026-11-02)

## Desired End State

A scheduled run with linkedin surfaces in watcher.config.json:

- `LINKED_API_TOKEN` + `LINKED_API_IDENTIFICATION_TOKEN` present → each
  linkedin surface runs one searchPosts workflow sequentially (past24Hours, latest,
  limit 100); posts land in the digest marked `[linkedin]`; the subject carries
  " + LinkedIn" when at least one matched; `timing: fetch <N>ms` covers both
  platforms.
- Tokens missing → one warn (`fetch: LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN
  missing or blank — skipping 2 linkedin surface(s)`), Threads runs normally,
  heartbeat/digest still fire, exit 0. A rejecting client factory degrades the same
  way (D12): warn + empty, never exit 1.
- One surface failing (or parked outside working hours) → that surface warns and
  skips; other surfaces and Threads posts still deliver; exit 0.
- No Playwright LinkedIn code anywhere: no linkedin-login files, no refresh step, no
  marker branch, no LINKEDIN_* LinkedIn env vars (THREADS_SESSION_STATE remains).

## File Map

- src/fetch-linkedin-api.ts  # NEW — SDK fetcher: resolvers, factory, loop, mapping
- tests/fetch-linkedin-api.test.ts  # NEW — offline suite (stubbed client seam)
- src/config.ts  # MODIFY — +2 env names (S1), -4 env names (S4)
- package.json  # MODIFY — +dependency (S1), lint path edit (S4)
- package-lock.json  # MODIFY — lockfile regen with @linkedapi/node (S1); npm ci requires it in sync
- src/index.ts  # MODIFY — WatcherDeps field, raw partition, warn re-key, machinery out
- tests/index.test.ts  # MODIFY — re-keyed warns; Phase 7 suite dies (S2); mouse-member trim (S4)
- src/fetch-threads.ts  # MODIFY — Threads-only shed (S3) + seam-member deletions (S4, amended)
- tests/fetch-threads.test.ts  # MODIFY — dispatch tests triaged
- src/config-file.ts  # MODIFY — linkedin arm + builder die; platform narrows
- tests/config-file.test.ts  # MODIFY — builder test dies
- src/judge.ts  # MODIFY — F023 comment twin
- src/threads-session.ts  # MODIFY — docstring sentence
- tests/session.test.ts  # MODIFY — linkedin-var cases die
- .gitignore  # MODIFY — linkedin-state*.b64 line dies
- .github/workflows/watch.yml  # MODIFY — guard flip, env swap, steps out, F023 rewrite
- README.md  # MODIFY — LinkedIn sections + rows rewritten
- .rpiv/guidance/architecture.md  # MODIFY — overview line
- .rpiv/guidance/src/architecture.md  # MODIFY — fetcher + quarantine lines
- .rpiv/guidance/tests/architecture.md  # MODIFY — test-file list line
- .rpiv/guidance/.github/workflows/architecture.md  # MODIFY — env count + step lines
- src/fetch-linkedin.ts  # DELETE (S4 — added 2026-11-02; last importer dies in S3)
- src/linkedin-login.ts  # DELETE
- scripts/linkedin-login.ts  # DELETE
- tests/linkedin-login.test.ts  # DELETE
- tests/fetch-linkedin.test.ts  # MODIFY (S3 bridge: one literal re-keys) then DELETE (S4)

## Ordering Constraints

- Slice 1 → 2 → 3 → 4 → 5, strictly sequential (each builds on the previous).
- Slice 1 before 2: index.ts cannot compile against a module that does not exist.
- Slice 2 before 3: index.ts must stop passing linkedinSessionPath before
  fetch-threads.ts drops the option.
- Slice 3 before 4: the Phase 7 file deletion orphans the last seam consumers
  (cookies/fill/url/mouse); the shed removes the remaining LinkedIn plumbing first so
  the deletion lands without dangling references.
- Amended 2026-11-02 (Slice 3 approval): the five seam-member deletions (PageMouseLike,
  PageLike.mouse + adapter, PageLike.url? + adapter, LocatorLike.fill + adapter,
  ContextLike.cookies + factory) execute in Slice 4 ALONGSIDE the deletion of their
  last consumers — src/fetch-linkedin.ts (:304 page.url?, :315 page.mouse),
  src/linkedin-login.ts (:97/:134 url, :149 fill, :196 cookies),
  scripts/linkedin-login.ts (:64 cookies) — so every intermediate slice typechecks
  (D9 "same change" honored). tests/fetch-threads.test.ts's double trims in Slice 3
  (its consumers die there); tests/index.test.ts's dualPlatformContextFactory mouse
  member trims in Slice 4.
- Slice 4 last among code: ENV_NAMES deletions break every consumer, so every consumer
  must already be gone.
- package.json is touched by Slices 1 and 4 (dependency first, lint path with the
  script deletion) — merged in the artifact, sequential on disk.

## Verification Notes

- Gates per slice: `npm run typecheck && npm run lint && npm test` (CI parity).
- Slice 1: `grep -c "runPool" src/fetch-linkedin-api.ts` returns 0 — no pool in
  the new module; the all-fail throw is absent by construction (grep "all .*failed"
  returns 0).
- Slice 1: `grep -c 'await import("@linkedapi/node")' src/fetch-linkedin-api.ts`
  returns exactly 1 — the quarantined import site.
- Slice 2: `grep -c "recoverLinkedInSession" src/index.ts` returns 0.
- Slice 2: warn regexes pin LINKED_API_TOKEN (moved from LINKEDIN_SESSION_STATE,
  tests/index.test.ts:573/:603).
- Slice 3: `grep -in "linkedin" src/fetch-threads.ts src/config-file.ts` returns
  matches only where the new docs demand them (verify at generation time).
- Slice 4: `grep -rn "LINKEDIN_" src/ tests/ .github/` returns 0 matches
  (THREADS_SESSION_STATE excepted — it contains no LINKEDIN_ substring).
  README.md is excluded: it is Slice 5's file and carries the literals until
  the docs sync (verified 2026-11-02, slice-verifier pass 1; scripts/ checked
  not a hole in pass 2 — its only carrier, scripts/linkedin-login.ts, deletes
  this slice).
- Slice 5: README literal gate — `grep -rn -E "LINKEDIN_|linkedin-login|linkedin-state" README.md`
  returns 0 matches after the docs sync. The rows carrying the literals today
  (verified 2026-11-02): README.md:17, :66-69, :101, :246, :259, :270-271,
  :278, :281, :283, :298, :305 — including three lowercase rows (:259
  linkedin-state.json.b64, :278 state/linkedin-login.json, :298
  scripts/linkedin-login.ts) the LINKEDIN_ pattern alone never sees.
- Slice 4: accessor-form gate (added 2026-11-02) — `grep -rn "ENV_NAMES.linkedin"
  src/ tests/ scripts/` returns 0 after the config.ts deletion. The LINKEDIN_ literal
  grep does NOT match member accessors like ENV_NAMES.linkedinSession, so a missed
  one surfaces only as a typecheck failure (TS2339) with no gate to catch it.
  Pre-implement reading (2026-11-02, original source): src/index.ts:175/:192
  (linkedinSession — die in Slice 2 with the closure rewrite) and :368/:369/:408
  (email/password/refreshPath — die in Slice 2 with recoverLinkedInSession);
  tests/session.test.ts:55/:63/:72/:82 (linkedinSession — die in Slice 4 with the
  linkedin-var cases; the LAST survivors). Note tests/session.test.ts:63 pairs the
  accessor with THREADS_SESSION_STATE, so the accessor is its only linkedin marker
  and the literal grep never sees it.
- Slice 4: F023 pair — `grep -c "71s" .github/workflows/watch.yml src/judge.ts`
  returns 0 for both.
- Post-cutover (manual, operator precondition): paid Linked API seat, connected
  account, both tokens in GitHub secrets; one live workflow_dispatch run; capture
  fetchMs for the retune commit; one deliberate bad-token run proves the single warn
  + Threads delivery + exit 0.
- This repo has twice shipped live-unproven fetch paths (68c1e2d, f571904) — the live
  dispatch is a completion gate, not a nicety.
- SDK seam check: DONE pre-implement (2026-11-02, D15) — the exact quarantine
  pattern compiles against the installed @linkedapi/node 2.3.20 under repo-exact
  flags, and the result-item reads (url/activityUrn/time/author.name/text/repostText,
  errors[].type) all type-check against the real d.ts. Slice 2 carries the RESULT,
  not the task: cite D15 in its Automated Verification instead of re-running.
- Slice 3 scratch compile: DONE post-write (2026-11-02, the D15 pattern; standing
  instruction going forward: run it BEFORE the checkpoint) — the two src/ fences
  assembled from the on-disk originals + the fenced regions in .rpiv/tmp/slice3-
  compile/ (index.ts excluded: the original reads platform === "linkedin", Slice 2's
  rewrite concern; fetch-linkedin.ts and linkedin-login.ts INCLUDED) compile clean
  under repo-exact flags: `npx tsc -p .rpiv/tmp/slice3-compile/tsconfig.json
  --noEmit` exit 0. Compiler-proven: the deferral compiles — fetch-linkedin.ts
  (page.mouse :315, page.url? :304) and linkedin-login.ts (fill :149, cookies :196,
  url :97/:134) type-check against the post-Slice-3 seam. Retroactive per-file diff
  (same pass): both src diffs contain exactly the fenced hunks and nothing else —
  the stale "four members" block was the only draft drift in Slice 3.
- Slice 2 assertions (from D3/D12/D13/D14): the skip-warn regex pins the BOTH-names
  message; a THROWING injected linkedinFetch double proves the arm-level belt
  degrades to warn + empty (the real module already degrades internally — D12
  revised); a linkedin-only config WITH THREADS_SESSION_STATE proves the single
  return keeps LinkedIn posts (D13); the startup `watch: surfaces:` line lists
  linkedin labels after the ResolvedSurface narrowing (D14).
- Follow-up (2026-11-02, developer review of the finished design): package-lock.json
  joined Slice 1 — regenerate + commit, never hand-edit (the npm ci gate). index.ts
  was inside the Slice 4 scratch compile (re-run post-finalize: exit 0). The test
  fences were then compiled AND executed in scratch (.rpiv/tmp/slice5-tests/):
  tsc exit 0; suite 226/226 — after one defect found by EXECUTION: the D14 test
  used an empty authenticated Threads capture, tripping the kept all-fail gate;
  fixed in the fence (real post id19(15)) and re-verified. plan inherits tests
  that compile and pass.

## Performance Considerations

- The LinkedIn leg is sequential by design (FR4): two cloud-browser workflows run
  serially, each seconds-to-minutes per docs; the run-level cap stays 8 minutes
  pending the live measurement (D10).
- A parked (outside-working-hours) workflow is never awaited — the skip path costs
  one HTTP execute() round-trip.
- Rate limits: 100 req/min per endpoint per token (600 for result polling) — two
  surfaces per 10-minute run sit orders of magnitude below.
- Threads concurrency, pool width, and scroll behavior are untouched.

## Migration Notes

- No schema change: state/seen-posts.json keys are generic strings; urn ids already
  coexist with Threads digit ids (state.ts:23-26).
- Secrets: operator swaps LINKEDIN_SESSION_STATE/EMAIL/PASSWORD/SECRET_WRITER for
  LINKED_API_TOKEN + LINKED_API_IDENTIFICATION_TOKEN in GitHub secrets (and local
  .env if used). Untracked local artifacts (root linkedin-state.b64, .rpiv/tmp/
  linkedin scratch) are operator hygiene, not code.
- Rollback: revert the cutover commit(s); the old path is deleted, so rollback means
  reverting to the pre-cutover commit — acceptable (the old path never worked in
  production; datacenter-IP blocking is what motivated the change).
- Expected follow-up: one declared retune commit after the first live runs (fetchMs
  into the F023 comments; possibly WAIT_BUDGET_MS).

## Pattern References

- Degradable resolver contract: src/threads-session.ts:37-60 (silent null; caller
  owns policy).
- Per-surface catch idiom: src/fetch-threads.ts:390-394.
- Drop-and-count + guarded conversion: src/extract.ts:36-70, :87-113.
- Import quarantine (dynamic import site): src/fetch-threads.ts:148-150.
- WatcherDeps optional field + production default: src/index.ts:115-132.
- Strict-resolver contrast (what NOT to do for tokens): src/judge.ts:132-178.
- Offline doubles: tests/index.test.ts:499-544 (dualPlatformContextFactory);
  tests/judge.test.ts:120-183 (fake fetchFn).
- SDK usage: linkedapi.io/sdks/installation.md, /sdks/handling-results.md,
  /docs/action-st-search-posts.md, /docs/working-hours.md, /docs/common-errors.md
  (all fetched 2026-11-01).

## Developer Context

**Q (solutions checkpoint, inherited): Where the fetcher gets the raw surface value?**
A: runWatcher partitions raw config.surfaces by type === "linkedin"; surface.value
goes straight to searchPosts. ResolvedSurface unchanged structurally.
(src/index.ts:154/:159; config-file.ts:220-221)

**Q (solutions checkpoint, inherited): Where the missing-token warn lives?**
A: Caller warns; resolver returns null silently; the runWatcher skip slot re-keys to
LINKED_API_TOKEN (src/index.ts:190-193 topology; threads-session.ts:42 model).

**Q (design checkpoint 2026-11-01): May ResolvedSurface.platform drop "linkedin"?**
A: First answer "i dont understand"; re-asked in plain words; developer asked "but we
do add support for linkedin, how the config work if without linkedin? yes we add
linkedin sdk, but no linkedin config?" — answered: the config Surface keeps
"linkedin" (watcher.config.json byte-identical); only the resolved record's union
drops the value nothing can produce. Decision: narrow. (config-file.ts:21-28 vs
:229-234; consumers rekey to the raw partition)

**Q (design checkpoint 2026-11-01): Orphaned seam members — sweep now?**
A: "Full orphan sweep (Recommended)" — approved as recommended.

**Q (design checkpoint 2026-11-01): Doc sync in-change?**
A: "Include doc sync (Recommended)" — approved as recommended.

**Q (design checkpoint 2026-11-01): WAIT_BUDGET_MS / timeout-minutes?**
A: First answer "i dont understand"; re-asked in plain words. "Keep numbers, fixcomments (Recommended)" — 180s and 8-min stay; comments rewritten; one declared
retune commit post-live-run.

**Q (design checkpoint 2026-11-01): LinkedIn search window?**
A: Developer asked whether the 24h filter + latest sort were in the requirements;
answered (sort latest yes; window pastWeek per FRD D9 to cover recencyHours: 72) and
offered the 24h option. Answer: "for linkedin past24 hours + latest, for thread leave
as is" — D9 pastWeek superseded: datePosted past24Hours + sort latest for LinkedIn;
Threads untouched; recencyHours stays 72 (governs Threads effectively).

**Q (design checkpoint 2026-11-01): Decomposition?**
A: "Approve (Recommended)" — 5 slices with the file-list corrections (config-file
test → S3; judge.ts + session.test.ts → S4).

## Design History

- Follow-up (2026-11-02, post-finalize developer review, five findings ranked): (1) package-lock.json joined Slice 1 (Files + criteria + File Map + Architecture note) — npm ci fails hard on a lockfile/package.json mismatch; (2) index.ts CONFIRMED inside the Slice 4 scratch compile — tsc re-run post-finalize (exit 0), new-closure markers at :121/:162/:167/:212/:226/:378, zero old-closure remnants; the "index.ts excluded" note belonged to the Slice 3 compile; (3) the test fences now compile AND execute: the post-cutover tests tree assembled in scratch (.rpiv/tmp/slice5-tests/ — on-disk originals + locked S2/S3/S4 test regions + the S1 new suite, over the post-cutover src), tsc exit 0 under repo-exact flags, then executed: 226/226 pass — execution caught ONE real fence defect: the D14 startup-line test used an EMPTY authenticated Threads capture, tripping the kept all-fail gate (fetch-threads.ts:397-409) and killing the run before the startup-line assertion; fence fixed (real post id19(15)) with the reason as an in-fence comment, scratch re-run green; (4) the live-dispatch gate is now a merge-blocking PR checklist item (Slice 4 Manual); (5) the deliberately-left record names BOTH stale "Adding a New Platform Fetcher" mechanisms (step 2 + step 5).
- Follow-up (2026-11-02 11:04:39+0700, post-Slice-3 write, developer review): three
  standing instructions for Slice 4+.
  (1) GATE GAP — before writing Slice 4, run
  `grep -rn "ENV_NAMES.linkedin" src/ tests/ scripts/` and reconcile every hit
  against the config.ts deletion; the artifact's LINKEDIN_ literal greps never
  match accessors like ENV_NAMES.linkedinSession, so a missed one surfaces only as
  a typecheck failure at Slice 4. Add the accessor-form grep to Slice 4's criteria
  (Verification Notes carries the pre-implement reading: index.ts hits die in
  Slice 2; tests/session.test.ts:55/:63/:72/:82 die in Slice 4 and are the last
  survivors).
  (2) BYTE-DIFF DISCIPLINE — Slice 3's fence shipped one stale draft block (a
  "four members" cross-slice note, since moved to heading prose); Slice 4 is the
  largest slice (11 files, 5 deletions): diff each approved payload against its
  written fence before stopping — per file, not by spot grep.
  (3) WARNING DISCIPLINE — a slice-verifier WARNING naming a concrete artifact
  edit gets the same fix-and-verify loop as a VIOLATION (the Slice-3 Research
  WARNING's grep-enumeration omission survived into the artifact and needed a
  post-write fix).
  (4) COMPILE-BEFORE-CHECKPOINT — run the D15-style scratch compile of the slice's
  src/ fences BEFORE the 6.3 presentation, not after the write (Slice 3's ran
  post-write; tsc exit 0, recorded in Verification Notes).
  Also in this pass: the eager-context safety argument (the only caller guards
  surfaces.length > 0) is now a comment line inside the Slice-3 fetch-threads.ts
  fence.
- Follow-up (2026-11-02 10:11:01+0700, post-Slice-2 approval): LIVE DISPATCH GATE promoted from prose (Verification Notes) to an explicit owned Slice 4 Manual criterion — no slice asserted an actual live run before, so the gate could evaporate; and a standing instruction for Slice 3+: RE-TEST the slice-verifier agent before using the direct-verification fallback again (it returned empty output ×3 during Slice 2; the fallback is recorded on the Slice 2 Design History line and was accepted by the developer only because it caught a real bug).- Slice 1: SDK fetcher module — approved as generated
  (see the 2026-11-02 follow-up above before resuming: verifier re-test + live-gate criterion)
- Slice 2: runWatcher rewiring — approved as generated (slice-verifier unavailable — empty output ×3, harness fault; verification ran directly: Decisions/Cross-slice/Research all OK; one bug caught pre-write: extract line re-keyed to config.surfaces.length)
- Slice 3: Threads-only shed + config-file arm death — approved as generated
  (amended 2026-11-02: the five seam-member deletions move to Slice 4 with their last
  consumers so every intermediate slice typechecks; tests/fetch-linkedin.test.ts joins
  this slice as a 3-line bridge for the platform narrowing; slice-verifier re-test
  SUCCESS after the Slice-2 ×3 empty-output failures — no fallback used; its one
  VIOLATION — src/fetch-linkedin.ts missing from Slice 4's delete list — fixed in
  this write)
- Slice 4: Phase 7 deletion + env swap + F023 lockstep — approved as generated
  (amended scope executed: the five seam-member deletions + the tests/index.test.ts
  mouse-member trim + DELETE src/fetch-linkedin.ts; compile-before-checkpoint tsc
  exit 0 on .rpiv/tmp/slice4-compile/ — the assembled post-cutover src tree with
  the five deletions absent, @linkedapi/node 2.3.20 mapped from the D15 sdk-check
  install; slice-verifier pass 1: Decisions OK, Research OK, one VIOLATION fixed
  per citation — the LINKEDIN_ literal gate rescoped to src/ tests/ .github/ with
  the README gate handed to Slice 5 in Verification Notes (15 README rows carry
  the literals until the docs sync); pass 2 re-verified the fix (scripts/ not a
  hole) and ratified two write-time edits performed in this write: the S1 fence
  LinkedInSearchItem → LinkedInSearchResultItem rename (compiler-forced, 2 refs)
  and the Verification Notes rescoping + hand-off line)
- Slice 5: Docs sync — approved as generated (final slice; verification: slice-verifier agent unavailable — Agent tool unreachable from the session, harness-confirmed; direct verification per the Slice 2 precedent with developer ratification: Decisions OK (ENV_NAMES 8-entry pair, D3 wording, watch.yml post-S4 shape, D8 config validity — 10 cross-checks), Cross-slice OK (dead-identifier sweep CLEAN, additions complete), Research OK (anchors unique ×14, gates green); three D10-driven disclosed additions ratified: README:207 queue sentence, workflows-guidance :17+:34-35 cancel lines, tests-guidance :7 SDK-never-loads clause; pre-checkpoint dry-run at .rpiv/tmp/slice5-docs/)

- Follow-up (post-approval, same day): deduped the src/config.ts + package.json
  Architecture headings (one per file; Slice 4 rewrites the fence); added D12 + D13;
  the D3 warn now names both token variables; Verification Notes gain the implement-
  time seam check (owner: Slice 2). [Tail restored 2026-11-02: a truncated read-
  write had clobbered everything after this point.]
- Slice 1 revision (developer review, 2026-11-02, Revise path): client build wrapped
  in try/catch — the module is total again and the docstring tells the truth (D12
  revised: module is the required boundary, the Slice 2 catch is belt);
  describeError guards non-Object throws (throw null degrades); two tests added
  (thrown null; rejecting factory). The urn match[1] fallback idiom from the earlier
  follow-up is folded into this pass. Delta re-verified by slice-verifier (run
  3085eecf): Decisions OK, Cross-slice OK, Research WARNING (ledger drift) resolved
  by this sync.
- Seam check + D2 correction (2026-11-02, pre-Slice 2): scratch-project compile of
  the exact quarantine pattern proved the default-import form WRONG (TS2351: the
  default is the CJS namespace) and the NAMED dynamic import correct (tsc exit 0
  under repo-exact flags; runtime LinkedApi = function). D15 added; module
  quarantine site patched (rev 5); LinkedApiError constructor pinned as positional
  (type, message); Key Discoveries import-form bullet corrected.

## References

- .rpiv/artifacts/solutions/2026-11-01_20-34-14_linkedin-api-fetcher-integration-shape.md
  — governing solutions artifact (Option 1 selected)
- .rpiv/artifacts/research/2026-11-01_19-34-17_linkedin-post-search-surface.md —
  parent research (deletion enumeration, precedents; SDK facts superseded by the
  2026-11-01 docs fetches where they differ)
- .rpiv/artifacts/discover/2026-11-01_18-53-36_linkedin-cli-post-search-surface.md —
  governing FRD (D1-D12, FR4; D9 window superseded by developer decision)
- .rpiv/guidance/src/architecture.md — funnel gates, WatcherDeps, resolver families
- .rpiv/guidance/.github/workflows/architecture.md — step-scoped secrets, F023
- .rpiv/guidance/tests/architecture.md — offline conventions
- linkedapi.io docs (fetched 2026-11-01): /sdks/installation, /sdks/handling-results,
  /docs/action-st-search-posts, /docs/working-hours, /docs/common-errors