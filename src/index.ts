/**
 * CLI entry point: the full v1 pipeline (FRD #1-#9).
 *
 * fetch → extract → dedupe vs state → keywords → judge → filter → email →
 * state commit. Every stage logs its counts; any thrown error exits non-zero
 * and leaves state untouched (D8: the write is match-gated and ordered after
 * the email send, so a failed run never marks posts seen).
 */
import { extractPosts } from "./extract.js";
import { fetchTagPages } from "./fetch-threads.js";
import { resolveTags } from "./config.js";
import { filterPostsByKeywords } from "./keywords.js";
import { judgePosts, resolveJudgeConfig } from "./judge.js";
import { diffNew, loadState, saveState } from "./state.js";
import { resolveEmailConfig, sendDigest } from "./email.js";
import type { Post } from "./types.js";

async function main(): Promise<void> {
  const tags = resolveTags(process.env);
  console.log(`watch: surfaces: ${tags.join(", ")}`);

  const surfaces = await fetchTagPages(tags);

  const seen = new Set<string>();
  const posts: Post[] = [];
  for (const surface of surfaces) {
    const extracted = extractPosts(surface.html);
    console.log(`extract: tag/${surface.tag}: ${extracted.length} post(s)`);
    for (const post of extracted) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
  }
  console.log(
    `extract: ${posts.length} unique post(s) across ${surfaces.length} surface(s)`,
  );

  const state = await loadState();
  const newPosts = diffNew(state, posts);
  if (newPosts.length === 0) {
    console.log("no new matches");
    return;
  }
  console.log(`state: ${newPosts.length} unseen post(s)`);

  const maybes = filterPostsByKeywords(newPosts);
  if (maybes.length === 0) {
    console.log("keywords: 0 maybes");
    console.log("no new matches");
    return;
  }

  const { judged, skippedPostIds } = await judgePosts(
    maybes,
    resolveJudgeConfig(process.env),
  );
  const matches = judged
    .filter((j) => j.verdict.relevant && j.verdict.locationOk)
    .map((j) => j.post);
  console.log(
    `keywords: ${maybes.length} maybes, judge: ${matches.length} relevant+located, skipped: ${skippedPostIds.length}`,
  );

  if (matches.length === 0) {
    console.log("no new matches");
    return;
  }

  // Email before state: a failed send exits non-zero and leaves state
  // untouched, so the next run re-judges and re-sends these matches (D3, D8).
  await sendDigest(matches, resolveEmailConfig(process.env));

  // Persist every successfully judged post id — relevant or not — so match
  // runs bound re-judging (no-match runs persist nothing, per FRD #9).
  // Skipped ids stay unseen and are retried next run (D3). saveState stays
  // gated: this line is reached only when matches.length > 0.
  const judgedIds = judged.map((j) => j.post.id);
  const result = await saveState(state, judgedIds);
  console.log(`state: ${result.addedCount} new seen post id(s)`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`watch: FAILED — ${message}`);
  process.exit(1);
});
