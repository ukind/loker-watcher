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
