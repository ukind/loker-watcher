/**
 * The pipeline's pure helpers (N075): the dedupe/funnel-join and the D14
 * log-label functions, moved verbatim out of src/index.ts so the entry
 * module owns orchestration only and the pure tail is unit-testable in
 * isolation. surfaceLabel and dedupePosts are EXPORTED (index.ts and
 * tests/index.test.ts consume them); mergeSurfaceStamps stays
 * module-private (its only caller is dedupePosts, which moved with it —
 * an export with zero importers fails knip). Type-only imports of
 * types/config-file keep this module a zero-runtime-import leaf
 * (verbatimModuleSyntax erases both).
 */
import type { Surface } from "./config-file.js";
import type { Post } from "./types.js";

/** D14 log label for one raw config surface. */
export function surfaceLabel(surface: Surface): string {
  if (surface.type === "linkedin") return `linkedin/${surface.value}`;
  if (surface.type === "tag") return `tag/${surface.value}`;
  return surface.value; // url surfaces log verbatim
}

/**
 * Dedupe posts by id, keeping first-seen order (D5). Surface stamps on a
 * later duplicate merge into the kept post — a post collected by N
 * surfaces rides every matching surface email (FR2). Map re-sets keep the
 * first-seen position; the inputs and their stamp arrays are never
 * mutated.
 */
export function dedupePosts(posts: readonly Post[]): Post[] {
  const byId = new Map<string, Post>();
  for (const post of posts) {
    const kept = byId.get(post.id);
    byId.set(post.id, kept === undefined ? post : mergeSurfaceStamps(kept, post));
  }
  return [...byId.values()];
}

/**
 * Union of the stamps on two duplicate posts (D5): kept stamps first, then
 * the unseen ones from the duplicate, into a FRESH array. Under
 * exactOptionalPropertyTypes the field stays off the post entirely when
 * no stamps exist (legacy payload rows predate the stamp).
 */
function mergeSurfaceStamps(kept: Post, duplicate: Post): Post {
  const merged = [...(kept.surfaces ?? [])];
  for (const stamp of duplicate.surfaces ?? []) {
    const key = `${stamp.type}|${stamp.value}`;
    if (merged.some((existing) => `${existing.type}|${existing.value}` === key)) continue;
    merged.push(stamp);
  }
  return {
    ...kept,
    ...(merged.length > 0 ? { surfaces: merged } : {}),
  };
}
