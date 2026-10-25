/**
 * Recency filter (Phase 8).
 *
 * Tag feeds mix fresh posts with weeks-old ones (measured 2026-10-25: the
 * logged-out /tag/hiring feed had a median age of ~23 days, and the
 * authenticated Recent tab still surfaced one 122-day outlier). Posts
 * older than the window are dropped before dedupe and judging, so the
 * digest only carries recent openings and LLM calls stay bounded.
 */
import type { Post } from "./types.js";

/** Keep only posts whose timestamp is within `hours` of `now`. */
export function filterRecent(
  posts: readonly Post[],
  hours: number,
  now: number = Date.now(),
): Post[] {
  if (!Number.isFinite(hours) || hours <= 0) return [...posts];
  const cutoff = now - hours * 3_600_000;
  return posts.filter((post) => {
    const takenAt = new Date(post.timestamp).getTime();
    return Number.isFinite(takenAt) && takenAt >= cutoff;
  });
}
