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
