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

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

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
    collectThreadItems(parsed, rawItems);
  }

  const seen = new Set<string>();
  const posts: Post[] = [];
  let dropped = 0;
  for (const item of rawItems) {
    const post = normalizeThreadItem(item);
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
export function collectThreadItems(node: unknown, out: unknown[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectThreadItems(child, out);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value: unknown = record[key];
    if (key === "thread_items" && Array.isArray(value)) {
      out.push(...value);
    }
    collectThreadItems(value, out);
  }
}

/** Map one raw thread item to a Post, or null when it lacks required fields. */
export function normalizeThreadItem(item: unknown): Post | null {
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
  const code = typeof post.code === "string" && post.code.length > 0 ? post.code : codeFromPk(pk);
  return {
    platform: "threads",
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
  return post !== null && typeof post === "object" ? (post as Record<string, unknown>) : record;
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
