/**
 * Keyword pre-filter for Threads posts (FRD #3).
 *
 * Checks post captions against the keyword list from watcher.config.json.
 * Normalizes text and keywords to lowercase for case-insensitive matching.
 * Substring matching allows catching variants like "ReactJS" or punctuated
 * forms like "React/Vue". The list is a required parameter: the JSON file is
 * the only source, so there is no built-in default to fall back to.
 */
import type { Post } from "./types.js";

/**
 * Returns true if text contains at least one keyword from the list.
 * Performs case-insensitive substring matching.
 */
export function matchesKeywords(text: string, keywords: readonly string[]): boolean {
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
export function filterPostsByKeywords(posts: readonly Post[], keywords: readonly string[]): Post[] {
  return posts.filter((post) => matchesKeywords(post.text, keywords));
}
