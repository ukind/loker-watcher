/**
 * The LinkedIn content-search Flight parser (the pure core the deleted
 * REST search client held) plus the search-URL builder.
 *
 * The logged-in search app streams results as React Flight bodies
 * ("hex-id":JSON per line) over /flagship-web/search/results/content/
 * (initial page) and /flagship-web/rsc-action/actions/pagination (each
 * "Load more" click — the only pagination trigger; scrolling fires
 * nothing, verified live 2026-11-11). The parser splits the rows,
 * resolves $-references, and mints posts from capture-verified facts:
 *
 * - the activity id lives under ...activityUrn.activityId objects, as
 *   urn:li:activity:<id> strings, and as urn object keys;
 * - the post text lives under the component whose viewTrackingSpecs
 *   carry legacyControlName "commentary_text", inside textProps.children
 *   React element trees (br elements are newlines; "$<row>:props.path"
 *   strings are shared-subtree references). The real text and a short
 *   hashtag chip can share ONE row as sibling components — the row's
 *   LONGEST text is its one candidate (the "#hiring" chip must not mint
 *   a post).
 * - timestamps and permalinks are NOT in the body: the id encodes
 *   creation time as BigInt(id) >> 22n (epoch ms, 4-6 min drift against
 *   the rendered age label, proven on live ids 2026-11-11), and the
 *   permalink constructs as /feed/update/urn:li:activity:<id>.
 *
 * PAIRING (design 2026-11-11, replaces the deleted walk's currentId
 * register): the stream carries NO reachable link between a post's text
 * and its id — BFS over the $-ref graph from every marker row reaches
 * zero id rows, and contentTrackingId is a shared list-level value. The
 * i-th distinct commentary text (stream order) therefore pairs with the
 * i-th usable id sorted by derived time ascending — the page sorts by
 * date_posted, so stream order is time order; the id's high bits ARE the
 * creation clock. A count mismatch warns and mints the paired prefix
 * (the remainder drops VISIBLY, never silently). The deleted register
 * mis-paired 1 of 3 posts on the live capture; the zip pairs 3/3.
 *
 * Member names are absent from the response bodies, so Post.author is a
 * placeholder (the deleted walk's finding, unchanged).
 *
 * mintPost guards its timestamp the way the deleted REST client's
 * id-clock guard did — a BigInt RangeError or a non-positive epoch
 * yields null, never a thrown parse.
 *
 * Testability: every export is a pure string function; importing this
 * module never loads Playwright and touches no I/O (the one warn rides
 * console.warn, the sanctioned offline oracle).
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
const WHOLE_REF_RE = /^\$L?([0-9a-f]+)$/;
const PATH_REF_RE = /^\$L?([0-9a-f]+):(.+)$/;
/**
 * The activity-id digit floor (N055): LinkedIn ids are 19 digits, so 10 is a
 * safety floor, not a real bound. ONE definition, three readers — the two
 * mint regexes here, the payload reader's row validator
 * (src/linkedin-payload.ts), and the walk's diagnostic id count
 * (src/linkedin-walk.ts). The payload reader used to accept 9+, so a
 * 9-digit row passed the reader and could never be minted.
 */
export const ACTIVITY_ID_PATTERN = "\\d{10,}";

const URN_RE = new RegExp(`^urn:li:activity:(${ACTIVITY_ID_PATTERN})$`);
const DIGITS_RE = new RegExp(`^${ACTIVITY_ID_PATTERN}$`);

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
 * Mint one Post from capture-verified facts; the id carries the timestamp.
 * Returns null on a unusable id (BigInt RangeError or non-positive epoch)
 * — the guarded id-clock contract — so a broken id can
 * never mint a post with an invalid Date. (Restored + guarded.)
 */
function mintPost(activityId: string, text: string): Post | null {
  let timestamp: string;
  try {
    const ms = BigInt(activityId) >> 22n;
    if (ms <= 0n) return null;
    timestamp = new Date(Number(ms)).toISOString();
  } catch {
    return null;
  }
  const urn = `urn:li:activity:${activityId}`;
  return {
    platform: "linkedin",
    id: urn,
    text,
    author: AUTHOR_PLACEHOLDER,
    permalink: `https://www.linkedin.com/feed/update/${urn}`,
    timestamp,
  };
}

/**
 * Mint every post a flight body carries: distinct commentary texts in
 * stream order paired with distinct usable ids in derived-time order
 * (see the module header for the pairing rule and its evidence). The
 * walk tracks, per row: every activity id it passes (urn strings,
 * activityId fields, urn object keys) and ONE text candidate — the row's
 * longest commentary text, so the sibling hashtag chip never wins. A
 * text/id count mismatch warns and pairs the prefix; a marker row whose
 * text harvest is empty, and an id that fails the timestamp guard, drop
 * without minting.
 */
export function collectLinkedInPosts(body: string): Post[] {
  const rows = parseFlightRows(body);
  const ids: string[] = [];
  const texts: string[] = [];
  const seenTexts = new Set<string>();
  for (const root of rows.values()) {
    const seenRows = new Set<string>();
    const rowIds = new Set<string>();
    const rowTexts: string[] = [];
    const visit = (node: unknown): void => {
      if (typeof node === "string") {
        const urn = URN_RE.exec(node);
        if (urn !== null) {
          rowIds.add(urn[1] ?? "");
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
          rowIds.add(activityId);
        }
        const specs: unknown = record.viewTrackingSpecs;
        if (
          specs !== null &&
          typeof specs === "object" &&
          (specs as Record<string, unknown>).legacyControlName === "commentary_text"
        ) {
          const text = textFromChildren(record.children, rows);
          if (text.length > 0) rowTexts.push(text);
          return; // the commentary subtree is text; it carries no ids
        }
        for (const key of Object.keys(record)) {
          const urnKey = URN_RE.exec(key);
          if (urnKey !== null) rowIds.add(urnKey[1] ?? "");
        }
        for (const key of Object.keys(record)) visit(record[key]);
      }
    };
    visit(root);
    for (const id of rowIds) {
      if (!ids.includes(id)) ids.push(id);
    }
    if (rowTexts.length > 0) {
      const best = rowTexts.reduce((a, b) => (b.length > a.length ? b : a));
      if (!seenTexts.has(best)) {
        seenTexts.add(best);
        texts.push(best);
      }
    }
  }
  // Usable ids only: a BigInt RangeError or a non-positive epoch would
  // mint an invalid Date — filter before the sort, the mintPost guard's
  // contract applied one step earlier.
  const usable = ids.filter((id) => {
    try {
      return BigInt(id) >> 22n > 0n;
    } catch {
      return false;
    }
  });
  // >> 22n is monotonic for positive bigints, so numeric id order IS
  // derived-time order (the live capture's 22:11 < 22:16 < 22:18). The
  // comparator is total (-1/0/1); equality cannot occur because ids are
  // deduped upstream, and a total comparator stays correct if that
  // precondition ever drifts.
  const sorted = [...usable].sort((a, b) => {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const paired = Math.min(sorted.length, texts.length);
  if (sorted.length !== texts.length) {
    console.warn(
      `linkedin-parser: id/text count mismatch (${texts.length} text(s), ${sorted.length} id(s)) — pairing the first ${paired} by timestamp order`,
    );
  }
  const posts: Post[] = [];
  for (let i = 0; i < paired; i += 1) {
    const post = mintPost(sorted[i] ?? "", texts[i] ?? "");
    if (post !== null) posts.push(post);
  }
  // The spot-check oracle: the stream carries no id<->text link, so a
  // same-count wrong-order zip mints valid-looking posts. This one line
  // per body names every pairing; the live rehearsal reads it against
  // the rendered page.
  console.log(
    `linkedin-parser: ${posts.length} pair(s) — ${posts
      .map((post) => `${post.id.slice(-6)}↔"${post.text.slice(0, 25)}"`)
      .join(", ")}`,
  );
  return posts;
}
