/**
 * The LinkedIn content-search Flight parser (the pure core the deleted
 * REST search client held) plus the search-URL builder.
 *
 * The logged-in search app streams results as React Flight bodies
 * ("hex-id":JSON per line) over /flagship-web/search/results/content/
 * (initial page) and /flagship-web/rsc-action/actions/pagination (each
 * "Load more" click — the only pagination trigger; scrolling fires
 * nothing, verified live 2026-11-11). The parser splits the rows and
 * mints posts by the CARD JOIN (design 2026-11-14, replaces the
 * deleted positional zip):
 *
 * - a card seeds at a commentary_text marker row (viewTrackingSpecs
 *   legacyControlName "commentary_text") no other marker row can reach,
 *   and climbs $-reference parents to the outermost ancestor row whose
 *   forward span holds exactly ONE CARD SEED (FRD req 2, <= 12 hops) —
 *   the card's own nested markers belong to its seed and do not block
 *   the climb; a container holding TWO seeds (sibling cards) does.
 * - graph edges follow $L-PREFIXED references only ($L<hex> and
 *   $L<hex>:path): a bare hex-ish string in a tracking payload is DATA,
 *   never a reference (fresh-corpus lesson 2026-11-14: a bare "24"
 *   string phantom-ref'd marker 5f to marker 24 and nest-killed the
 *   seed). The text walk keeps its historical $L-optional forms.
 * - the card's text is the LONGEST commentary across the seed's marker
 *   closure (seed + its nested markers): image cards carry the
 *   commentary in the nested marker row (session 20261114T055257Z body
 *   005, the lnkd.in image post — the seed's own harvest is empty).
 * - the card's urn strings are collected FORWARD from that root
 *   (capture body 080: forward 107 / reverse 0 — urns live ahead of the
 *   marker, never behind it). The pattern matches share, ugcPost and
 *   activity urns, embedded or standalone (scan9's measured form).
 * - Post.id stays the card's single urn:li:activity:<id> — the dedupe
 *   key every downstream consumer reads. Post.permalink is the card's
 *   OWN urn type (FRD req 5): share/ugcPost resolve to the exact post;
 *   urn:li:activity:<shareId> returns "Post not found" (live-verified).
 * - a card with no activity urn, two or more, an id the timestamp guard
 *   rejects, or an empty text harvest is DROPPED AND COUNTED (FRD reqs
 *   6/7). ONE log line per body names linked + dropped counts and every
 *   minted id<->text head (FRD req 9).
 *
 * POSITIONAL PAIRING IS GONE (FRD req 8): the old rule paired the i-th
 * distinct text with the i-th usable id sorted by derived time —
 * measured 340/340 wrong on the dry run, and a position zip mis-pairs
 * (never merely drops) after any gap. The deleted pairing header's
 * premise ("BFS reaches zero id rows") was falsified by body 080.
 *
 * timestamps are NOT in the body: the activity id encodes creation time
 * as BigInt(id) >> 22n (epoch ms, 4-6 min drift against the rendered
 * age label, proven on live ids 2026-11-11).
 *
 * Member names are absent from the response bodies, so Post.author is a
 * placeholder (the deleted walk's finding, unchanged).
 *
 * mintPost guards its timestamp the way the deleted REST client's
 * id-clock guard did — a BigInt RangeError or a non-positive epoch
 * yields null, never a thrown parse.
 *
 * Testability: every export is a pure string function; importing this
 * module never loads Playwright and touches no I/O (the one log line
 * rides console.log, the sanctioned offline oracle).
 */

import type { Post } from "./types.js";

/**
 * Digests and judge prompts render this handle for LinkedIn posts: member
 * names exist only in the DOM, which carries no ids to join them with.
 */
const AUTHOR_PLACEHOLDER = "linkedin-member";

/**
 * The content-search URL for one configured surface keyword (measured
 * 2026-11-11 on the live logged-in session; the params are structural,
 * not session-specific: origin, the date_posted sort, the past-24h
 * filter — sortBy:date_posted is the REAL recency switch (the §12.4
 * sort finding, carried over to the web app).
 */
const SEARCH_URL_PREFIX = "https://www.linkedin.com/search/results/content/";
const SEARCH_URL_PARAMS =
  "&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D";

/** Build the content-search URL for one raw surface keyword. */
export function buildContentSearchUrl(keywords: string): string {
  return `${SEARCH_URL_PREFIX}?keywords=${encodeURIComponent(keywords)}${SEARCH_URL_PARAMS}`;
}

/** The two flagship-web endpoints that carry search posts (capture 2026-10-31, re-verified 2026-11-11). */
export const LINKEDIN_RESPONSE_RE =
  /flagship-web\/(search\/results\/content|rsc-action\/actions\/pagination)/i;

const FLIGHT_LINE_RE = /^([0-9a-f]+):([\s\S]*)$/;

/** Text-walk reference forms ($L-optional — the restored historical walk). */
const WHOLE_REF_RE = /^\$L?([0-9a-f]+)$/;
const PATH_REF_RE = /^\$L?([0-9a-f]+):(.+)$/;

/**
 * Graph-edge reference forms — the $L prefix is REQUIRED (fresh corpus
 * 2026-11-14: an optional-$L form turned a bare "24" data string in row
 * 5f's payload into a phantom reference to marker 24 and nest-killed
 * the seed). Flight references are always $-prefixed. EXPORTED for the
 * replay harness: its probe arms measure the same graph the join climbs.
 */
export const GRAPH_WHOLE_RE = /^\$L([0-9a-f]+)$/;
export const GRAPH_PATH_RE = /^\$L([0-9a-f]+):(.+)$/;

/**
 * Urn strings join embedded or standalone (scan9's measured form).
 * EXPORTED for the replay harness's census. NOT global: a shared /g
 * regex carries lastIndex across exec calls, so a match whose end sits
 * past the next string's length silently drops that string's urn
 * (order-dependent misses; every use takes the first match only).
 */
export const URN_ANYWHERE_RE = /urn:li:(share|ugcPost|activity):(\d{10,})/;

const MARKER_CONTROL = "commentary_text";
const MAX_CLIMB_HOPS = 12;

/**
 * The activity-id digit floor (N055): LinkedIn ids are 19 digits, so 10 is a
 * safety floor, not a real bound. ONE definition, two readers — the payload
 * reader's row validator (src/linkedin-payload.ts) and the ACTIVITY_ID_RE
 * for the walk's diagnostic id count, built in src/linkedin-walk-static.ts;
 * the card join replaced this parser's own mint regexes. The payload reader
 * used to accept 9+, so a 9-digit row passed the reader and could never be
 * minted.
 */
export const ACTIVITY_ID_PATTERN = "\\d{10,}";

/**
 * Split a flight stream and JSON-parse every data row. Lines outside the
 * "hex-id":payload form, and module-manifest rows like I[...], are skipped.
 * Row order is stream order. (Restored verbatim from 68c1e2d.)
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
 * triple newline collapses to one paragraph break. (Restored verbatim.)
 */
function textFromChildren(children: unknown, rows: Map<string, unknown>): string {
  const parts: string[] = [];
  const seenRows = new Set<string>();
  const memo = new Map<string, unknown>();
  const resolve = (id: string, path: string | undefined): unknown => {
    const root: unknown = rows.get(id);
    if (root === undefined) return undefined;
    if (path === undefined) return root;
    const key = `${id}:${path}`;
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
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The guarded id-clock: a BigInt RangeError or a non-positive epoch
 * yields null — a broken id can never mint a post with an invalid Date.
 */
function timestampFromId(activityId: string): string | null {
  try {
    const ms = BigInt(activityId) >> 22n;
    if (ms <= 0n) return null;
    return new Date(Number(ms)).toISOString();
  } catch {
    return null;
  }
}

/**
 * Mint one Post from capture-verified facts; the id carries the timestamp.
 * Returns null on an unusable id (the guarded id-clock contract). The
 * permalink arrives fully built — the CARD's own urn decides its type
 * (FRD req 5); the id stays the activity urn (req 4).
 */
function mintPost(activityId: string, permalink: string, text: string): Post | null {
  const timestamp = timestampFromId(activityId);
  if (timestamp === null) return null;
  return {
    platform: "linkedin",
    id: `urn:li:activity:${activityId}`,
    text,
    author: AUTHOR_PLACEHOLDER,
    permalink,
    timestamp,
  };
}

/**
 * Every $L-prefixed reference one row's subtree names (both forms);
 * stream-carried rows only. The $L prefix is REQUIRED — a bare hex-ish
 * string in a tracking payload is DATA, never a reference (the
 * phantom-edge guard, fresh corpus 2026-11-14).
 */
function refTargets(payload: unknown, rows: Map<string, unknown>, into: Set<string>): void {
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const whole = GRAPH_WHOLE_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (rows.has(id)) into.add(id);
        return;
      }
      const scoped = GRAPH_PATH_RE.exec(node);
      if (scoped !== null) {
        const id: string = scoped[1] ?? "";
        if (rows.has(id)) into.add(id);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const value of Object.values(node as Record<string, unknown>)) visit(value);
  };
  visit(payload);
}

/** True when the row's subtree carries a commentary_text marker (no $-ref following). */
function hasMarkerSpec(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.some(hasMarkerSpec);
  if (payload === null || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const specs: unknown = record.viewTrackingSpecs;
  if (
    specs !== null &&
    typeof specs === "object" &&
    (specs as Record<string, unknown>).legacyControlName === MARKER_CONTROL
  ) {
    return true;
  }
  return Object.values(record).some(hasMarkerSpec);
}

/** Every commentary_text harvest in one row; empty harvests stay out (the old early-return kept). */
function harvestTexts(payload: unknown, rows: Map<string, unknown>): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const specs: unknown = record.viewTrackingSpecs;
    if (
      specs !== null &&
      typeof specs === "object" &&
      (specs as Record<string, unknown>).legacyControlName === MARKER_CONTROL
    ) {
      const text = textFromChildren(record.children, rows);
      if (text.length > 0) out.push(text);
      return; // the commentary subtree is text; it carries no urns
    }
    for (const key of Object.keys(record)) visit(record[key]);
  };
  visit(payload);
  return out;
}

/**
 * Distinct SEED rows (non-nested markers) reachable forward from one
 * row, itself included, memoized per joinCards call (the memo dies with
 * the call — the parser stays pure, no module state). The climb counts
 * seeds, not all markers: a card's own nested marker belongs to its
 * seed and must not block the climb; a container holding TWO seeds
 * (sibling cards) still does (fresh corpus 2026-11-14, body 005).
 */
function makeSpanCounter(
  refs: Map<string, Set<string>>,
  seedRows: Set<string>,
): (hex: string) => number {
  const memo = new Map<string, number>();
  return (hex: string): number => {
    const cached = memo.get(hex);
    if (cached !== undefined) return cached;
    const seen = new Set<string>([hex]);
    const stack: string[] = [hex];
    let count = seedRows.has(hex) ? 1 : 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      for (const target of refs.get(current) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        if (seedRows.has(target)) count += 1;
        stack.push(target);
      }
    }
    memo.set(hex, count);
    return count;
  };
}

/**
 * Distinct urn strings reachable FORWARD from one row (cycle-guarded;
 * depth-first in payload key order — the refTargets/harvestTexts idiom).
 * Urns embedded inside longer strings join too (URN_ANYWHERE_RE — scan9's
 * measured form).
 */
function collectUrnStrings(rows: Map<string, unknown>, start: string): string[] {
  const seen = new Set<string>([start]);
  const out: string[] = [];
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const match = URN_ANYWHERE_RE.exec(node);
      if (match !== null) {
        const urn = match[0];
        if (urn !== undefined && !found.has(urn)) {
          found.add(urn);
          out.push(urn);
        }
        return;
      }
      const whole = WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (rows.has(id) && !seen.has(id)) {
          seen.add(id);
          visit(rows.get(id));
        }
        return;
      }
      const scoped = PATH_REF_RE.exec(node);
      if (scoped !== null) {
        const id: string = scoped[1] ?? "";
        if (rows.has(id) && !seen.has(id)) {
          seen.add(id);
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
      for (const value of Object.values(node as Record<string, unknown>)) visit(value);
    }
  };
  visit(rows.get(start));
  return out;
}

/**
 * Every row reachable forward from one row, itself included — the
 * seed's card closure (the text-harvest span).
 */
function forwardClosure(refs: Map<string, Set<string>>, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const stack: string[] = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const target of refs.get(current) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      stack.push(target);
    }
  }
  return seen;
}

/** One card's join facts — the decision record per marker row (the replay harness reads it too). */
export interface CardJoin {
  /** The seed marker row (flight hex id). */
  marker: string;
  /** The card root the climb landed on (flight hex id). */
  root: string;
  /** The card's longest commentary text across the seed's marker closure; null when nothing harvested. */
  text: string | null;
  /** Distinct urn strings reachable from the root, walk order. */
  urns: string[];
  /** The single activity id's digits; null unless outcome is "linked". */
  activityId: string | null;
  /** The permalink urn — the card's own non-activity urn, else the activity urn; null when dropped. */
  linkUrn: string | null;
  /** The card's fate: linked, or the drop cause (FRD reqs 6/7 + the guard). */
  outcome: "linked" | "no-text" | "no-urn" | "multi-urn" | "dead-id";
}

/**
 * Join every card a flight body carries: the pure facts the mint (and the
 * replay harness) read. Seeds are the marker rows no other marker row can
 * reach; each seed climbs parents to the outermost ancestor whose forward
 * span holds exactly one CARD SEED (FRD req 2 — the card's own nested
 * markers do not block the climb; $L-strict edges keep phantom data
 * strings out of the graph), and the urn strings reachable FORWARD
 * from that root decide the card (FRD req 3; body 080's forward 107 /
 * reverse 0 verdict). The card's text is the longest commentary across
 * the seed's marker closure (image cards carry it in a nested marker;
 * fresh corpus 2026-11-14). A card yields exactly one
 * urn:li:activity: id (req 4) or it drops with its cause (reqs 6/7).
 */
export function joinCards(body: string): CardJoin[] {
  const rows = parseFlightRows(body);
  const entries = [...rows.entries()];
  const markerRows = new Set<string>();
  for (const [hex, payload] of entries) {
    if (hasMarkerSpec(payload)) markerRows.add(hex);
  }
  if (markerRows.size === 0) return [];
  const refs = new Map<string, Set<string>>();
  const parents = new Map<string, string[]>();
  for (const [hex, payload] of entries) {
    const targets = new Set<string>();
    refTargets(payload, rows, targets);
    refs.set(hex, targets);
    for (const target of targets) {
      if (target === hex) continue;
      const list = parents.get(target) ?? [];
      list.push(hex);
      parents.set(target, list);
    }
  }
  // Seeds: a marker row another marker row can reach is nested, never a seed.
  const nested = new Set<string>();
  for (const marker of markerRows) {
    const seen = new Set<string>([marker]);
    const stack: string[] = [marker];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      for (const target of refs.get(current) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        if (markerRows.has(target)) nested.add(target);
        stack.push(target);
      }
    }
  }
  const seedRows = new Set<string>([...markerRows].filter((marker) => !nested.has(marker)));
  const spanOf = makeSpanCounter(refs, seedRows);
  const cards: CardJoin[] = [];
  for (const [hex] of entries) {
    if (!markerRows.has(hex) || nested.has(hex)) continue;
    // The card's text: the longest commentary across the seed's marker
    // closure — image cards carry the commentary in a nested marker row.
    const closure = forwardClosure(refs, hex);
    const texts: string[] = [];
    for (const rowHex of closure) {
      const rowPayload = rows.get(rowHex);
      if (rowPayload !== undefined && hasMarkerSpec(rowPayload)) {
        texts.push(...harvestTexts(rowPayload, rows));
      }
    }
    if (texts.length === 0) {
      cards.push({
        marker: hex,
        root: hex,
        text: null,
        urns: [],
        activityId: null,
        linkUrn: null,
        outcome: "no-text",
      });
      continue;
    }
    const text = texts.reduce((a, b) => (b.length > a.length ? b : a));
    let root = hex;
    for (let hop = 0; hop < MAX_CLIMB_HOPS; hop += 1) {
      const next = (parents.get(root) ?? []).find((parent) => spanOf(parent) === 1);
      if (next === undefined) break;
      root = next;
    }
    const urns = collectUrnStrings(rows, root);
    const activityIds: string[] = [];
    let linkUrn: string | null = null;
    for (const urn of urns) {
      const match = URN_ANYWHERE_RE.exec(urn);
      const kind = match?.[1];
      const digits = match?.[2];
      if (kind === undefined || digits === undefined) continue;
      if (kind === "activity") activityIds.push(digits);
      else if (linkUrn === null) linkUrn = urn;
    }
    const dropped = (outcome: CardJoin["outcome"]): CardJoin => ({
      marker: hex,
      root,
      text,
      urns,
      activityId: null,
      linkUrn: null,
      outcome,
    });
    if (activityIds.length === 0) {
      cards.push(dropped("no-urn"));
      continue;
    }
    if (activityIds.length > 1) {
      cards.push(dropped("multi-urn"));
      continue;
    }
    const activityId = activityIds[0] ?? "";
    if (timestampFromId(activityId) === null) {
      cards.push(dropped("dead-id"));
      continue;
    }
    cards.push({
      marker: hex,
      root,
      text,
      urns,
      activityId,
      linkUrn: linkUrn ?? `urn:li:activity:${activityId}`,
      outcome: "linked",
    });
  }
  return cards;
}

/**
 * Mint every post the body's cards carry, in marker-row stream order
 * (FRD req 8 — no sort, no positional pairing). Drops are counted per
 * cause; ONE log line per body names linked + dropped counts and every
 * minted id<->text head (FRD req 9).
 */
export function collectLinkedInPosts(body: string): Post[] {
  const cards = joinCards(body);
  const posts: Post[] = [];
  let noText = 0;
  let noUrn = 0;
  let multiUrn = 0;
  let deadId = 0;
  for (const card of cards) {
    if (card.outcome !== "linked" || card.activityId === null || card.linkUrn === null) {
      if (card.outcome === "no-urn") noUrn += 1;
      else if (card.outcome === "multi-urn") multiUrn += 1;
      else if (card.outcome === "dead-id") deadId += 1;
      else noText += 1;
      continue;
    }
    const post = mintPost(
      card.activityId,
      `https://www.linkedin.com/feed/update/${card.linkUrn}`,
      card.text ?? "",
    );
    if (post === null) {
      deadId += 1;
      continue;
    }
    posts.push(post);
  }
  const dropped = noUrn + multiUrn + deadId + noText;
  const pairs = posts.map((post) => `${post.id.slice(-6)}↔"${post.text.slice(0, 25)}"`).join(", ");
  console.log(
    `linkedin-parser: ${posts.length} card(s) linked, ${dropped} dropped (${noUrn} no-urn, ${multiUrn} multi-urn, ${deadId} dead-id, ${noText} no-text) — ${pairs}`,
  );
  return posts;
}
