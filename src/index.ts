/**
 * CLI entry point: the full v1 pipeline (FRD #1-#9).
 *
 * fetch → extract → dedupe vs state → keywords → judge → filter → email →
 * state commit. Every stage logs its counts; any thrown error exits non-zero
 * and leaves state untouched (D8: the write is match-gated and ordered after
 * the email send, so a failed run never marks posts seen).
 *
 * What to watch and how to filter comes from watcher.config.json (Phase 10),
 * loaded once at startup. A missing or malformed file fails the run.
 */
import { extractPosts } from "./extract.js";
import {
  fetchSurfaces,
  fetchSurfacesAuthenticated,
} from "./fetch-threads.js";
import {
  loadWatcherConfig,
  resolveSurfaces,
  type ResolvedSurface,
} from "./config-file.js";
import { isHeartbeatEnabled, runUrlFromEnv } from "./config.js";
import { filterPostsByKeywords } from "./keywords.js";
import { judgePosts, resolveJudgeConfig } from "./judge.js";
import { diffNew, loadState, saveState } from "./state.js";
import { resolveEmailConfig, sendDigest } from "./email.js";
import { resolveSession } from "./threads-session.js";
import { filterRecent } from "./recency.js";
import {
  selectCandidates,
  sendHeartbeat,
  type HeartbeatStats,
} from "./heartbeat.js";
import type { Post } from "./types.js";

/**
 * Best-effort status email for a zero-match run.
 *
 * Unlike the digest, a heartbeat that cannot be sent must not fail the run:
 * the pipeline did its job, only the notification failed. Logged loudly so a
 * broken GMAIL_* configuration is visible in the run log.
 */
async function heartbeat(
  stats: HeartbeatStats,
  recent: readonly Post[],
  maybes: readonly Post[],
  candidateTerms: readonly string[],
): Promise<void> {
  if (!isHeartbeatEnabled(process.env)) {
    console.log("heartbeat: disabled by HEARTBEAT_ENABLED");
    return;
  }
  try {
    const config = resolveEmailConfig(process.env);
    const candidates = selectCandidates(recent, maybes, candidateTerms);
    await sendHeartbeat(stats, candidates, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`heartbeat: not sent — ${message}`);
  }
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const config = await loadWatcherConfig();
  const surfaces = resolveSurfaces(config.surfaces);
  console.log(`watch: surfaces: ${surfaces.map((s) => s.label).join(", ")}`);

  const sessionPath = await resolveSession(process.env);
  const collected: Post[] =
    sessionPath !== null
      ? await fetchSurfacesAuthenticated(surfaces, sessionPath)
      : await fetchLoggedOutPosts(surfaces);
  const posts = dedupePosts(collected);
  console.log(
    `extract: ${posts.length} unique post(s) across ${surfaces.length} surface(s)`,
  );

  const recencyHours = config.recencyHours;
  const recent = filterRecent(posts, recencyHours);
  console.log(`recency: ${recent.length} post(s) within ${recencyHours}h`);

  // exactOptionalPropertyTypes: attach runUrl only when the ambient
  // GITHUB_* variables are present (a local run has none).
  const runUrl = runUrlFromEnv(process.env);

  const stats: HeartbeatStats = {
    ranAt: startedAt.toISOString(),
    unique: posts.length,
    recent: recent.length,
    recencyHours,
    maybes: 0,
    relevantLocated: 0,
    skipped: 0,
    ...(runUrl !== undefined ? { runUrl } : {}),
  };

  const state = await loadState();
  const newPosts = diffNew(state, recent);
  if (newPosts.length === 0) {
    await heartbeat(stats, recent, [], config.candidateTerms);
    console.log("no new matches");
    return;
  }
  console.log(`state: ${newPosts.length} unseen post(s)`);

  const maybes = filterPostsByKeywords(newPosts, config.keywords);
  stats.maybes = maybes.length;
  if (maybes.length === 0) {
    await heartbeat(stats, recent, maybes, config.candidateTerms);
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
  stats.relevantLocated = matches.length;
  stats.skipped = skippedPostIds.length;
  console.log(
    `keywords: ${maybes.length} maybes, judge: ${matches.length} relevant+located, skipped: ${skippedPostIds.length}`,
  );

  if (matches.length === 0) {
    await heartbeat(stats, recent, maybes, config.candidateTerms);
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

/** Logged-out path: blob extraction per surface, in input order. */
async function fetchLoggedOutPosts(
  surfaces: readonly ResolvedSurface[],
): Promise<Post[]> {
  const fetched = await fetchSurfaces(surfaces);
  const posts: Post[] = [];
  for (const surface of fetched) {
    const extracted = extractPosts(surface.html);
    console.log(`extract: ${surface.label}: ${extracted.length} post(s)`);
    posts.push(...extracted);
  }
  return posts;
}

/** Dedupe posts by id, keeping first-seen order. */
function dedupePosts(posts: readonly Post[]): Post[] {
  const seen = new Set<string>();
  const unique: Post[] = [];
  for (const post of posts) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    unique.push(post);
  }
  return unique;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`watch: FAILED — ${message}`);
  process.exit(1);
});
