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
const LINKEDIN_RESPONSE_RE =
  /flagship-web\/(search\/results\/content|rsc-action\/actions\/pagination)/i;

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

/** Mint one Post from capture-verified facts; the id carries the timestamp. */
function mintPost(activityId: string, text: string): Post {
  const urn = `urn:li:activity:${activityId}`;
  return {
    platform: "linkedin",
    id: urn,
    text,
    author: AUTHOR_PLACEHOLDER,
    permalink: `https://www.linkedin.com/feed/update/${urn}`,
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
            const id = `urn:li:activity:${currentId}`;
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
        `no flagship-web response within ${LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS}ms — the session may be dead`,
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
          `fetch: ${surface.label} scroll ${round}: +${gained} (dry ${dryRounds}/${LINKEDIN_MAX_DRY_ROUNDS})`,
        );
        if (dryRounds >= LINKEDIN_MAX_DRY_ROUNDS) break;
      } else {
        dryRounds = 0;
        console.log(`fetch: ${surface.label} scroll ${round}: +${gained}`);
      }
      if (posts.size >= LINKEDIN_MAX_POSTS) break;
    }

    // Let in-flight response handlers settle before the page goes away.
    await page.waitForTimeout(LINKEDIN_XHR_DRAIN_MS);
    console.log(`fetch: ${surface.label} OK — ${posts.size} post(s) from ${responses} response(s)`);
    return [...posts.values()];
  } finally {
    await page.close();
  }
}
