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

