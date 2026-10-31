/**
 * Pipeline-wide contracts. Slice 1 defined the Post and JudgeVerdict shapes
 * every later slice imports. The raw Threads item shape (entries wrapped as
 * { post: ... } inside "thread_items" arrays) is documented and narrowed in
 * src/extract.ts against a real 2026-10-24 /tag/hiring capture; no separate
 * raw type is exported until a consumer needs one.
 */

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

/** LLM verdict for one candidate post (judge, Slice 4). */
export interface JudgeVerdict {
  /** The post is a genuine job opening related to the configured keywords. */
  relevant: boolean;
  /** The role is in Indonesia or remote. */
  locationOk: boolean;
}

/** One LLM account's failure, recorded when rotation moves off it. */
export interface AccountFailure {
  /** 1-based position in the LLM_ACCOUNTS pool. */
  account: number;
  /** The account's chat-completions base URL. */
  baseUrl: string;
  /** Human-readable cause: "HTTP 429" or the transport error message. */
  reason: string;
}
