import { pathToFileURL } from "node:url";
import type { Transporter } from "nodemailer";
import {
  type ResolvedSurface,
  type WatcherConfig,
  loadWatcherConfig,
  resolveSurfaces,
} from "./config-file.js";
import { ENV_NAMES, STATE_PATH, isHeartbeatEnabled, runUrlFromEnv } from "./config.js";
import { resolveEmailConfig, sendDigest, sendExhaustionEmail } from "./email.js";
/**
 * CLI entry point: the full pipeline (FRD #1-#9; fast-workflow-runtime
 * D7-D9; rotation exhaustion path).
 *
 * fetch → extract → dedupe vs state → judge → notify → state commit. Every
 * stage logs its counts and its duration; any thrown error exits non-zero
 * and leaves state untouched (persistence is ordered after the notification
 * send, so a failed run never marks posts seen).
 *
 * Persistence (D7/D8): EVERY judged post id is persisted — including
 * zero-match runs — so no judged post is ever fed to the LLM twice.
 * Skipped ids stay unseen and retry next run. A run whose LLM_ACCOUNTS
 * pool is exhausted throws the tagged RotationExhausted error: the alarm
 * email is best-effort and the run exits 1 (state was never reached).
 *
 * What to watch and how to filter comes from watcher.config.json (Phase 10),
 * loaded once at startup. A missing or malformed file fails the run.
 */
import { extractPosts } from "./extract.js";
import {
  type AuthenticatedFetchOptions,
  type ContextFactory,
  fetchSurfaces,
  fetchSurfacesAuthenticated,
} from "./fetch-threads.js";
import { type HeartbeatStats, selectCandidates, sendHeartbeat } from "./heartbeat.js";
import { isRotationExhausted } from "./judge-rotation.js";
import {
  type JudgedPost,
  judgePosts,
  parseJudgeConcurrency,
  resolveJudgeConfig,
  sleep,
} from "./judge.js";
import { filterRecent } from "./recency.js";
import { type AppState, diffNew, loadState, saveState } from "./state.js";
import { cleanupSessionDir, resolveSession } from "./threads-session.js";
import type { Post } from "./types.js";

/**
 * Best-effort status email for a zero-match run.
 *
 * Unlike the digest, a heartbeat that cannot be sent must not fail the run:
 * the pipeline did its job, only the notification failed. Logged loudly so a
 * broken GMAIL_* configuration is visible in the run log. Env, the clock,
 * and the transport arrive from WatcherDeps so an offline run can inject all
 * three.
 */
async function heartbeat(
  stats: HeartbeatStats,
  recent: readonly Post[],
  judged: readonly Post[],
  candidateTerms: readonly string[],
  env: Record<string, string | undefined>,
  now: () => number,
  transport?: Transporter,
): Promise<void> {
  if (!isHeartbeatEnabled(env)) {
    console.log("heartbeat: disabled by HEARTBEAT_ENABLED");
    return;
  }
  try {
    const config = resolveEmailConfig(env);
    const candidates = selectCandidates(recent, judged, candidateTerms);
    await sendHeartbeat(stats, candidates, config, now(), transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`heartbeat: not sent — ${message}`);
  }
}

/**
 * Run one pipeline stage and report its wall-clock duration (D9). The clock
 * is injectable so tests assert durations without waiting; production
 * passes nothing and measures real time. The caller logs the returned
 * durationMs — one order-stable line per stage await, at stage level only
 * (inner logs interleave once stages do real work).
 */
export async function timeStage<T>(
  run: () => Promise<T>,
  now: () => number = Date.now,
): Promise<{ value: T; durationMs: number }> {
  const startedAtMs = now();
  const value = await run();
  return { value, durationMs: Math.max(0, now() - startedAtMs) };
}

/**
 * Injectable dependencies for one watcher run; every field has the
 * production default the pipeline uses when omitted. This is the unit seam
 * the offline suite operates (tests/index.test.ts): env, config, surface
 * fetch, LLM transport, SMTP transport, state file, and the clock all
 * inject, so a full pipeline run executes offline.
 */
export interface WatcherDeps {
  /** Environment record for every resolver. Default: process.env. */
  readonly env?: Record<string, string | undefined>;
  /** Pre-resolved watcher config. Default: loadWatcherConfig() — fail-visible. */
  readonly config?: WatcherConfig;
  /** Browser-context factory for the surface walks (Slice 3 seam). Default: chromiumContextFactory. */
  readonly contextFactory?: ContextFactory;
  /** LLM HTTP transport. Default: global fetch. */
  readonly fetchFn?: typeof fetch;
  /** SMTP transport for the digest and the heartbeat. Default: nodemailer. */
  readonly transport?: Transporter;
  /** State file path. Default: STATE_PATH (the commit-back location). */
  readonly statePath?: string;
  /** Clock for recency, prune, state stamps, and heartbeat ages. Default: Date.now. */
  readonly now?: () => number;
  /** Park wait for the judge's cooldown parking. Default: the judge module's sleep. */
  readonly sleepFn?: (ms: number) => Promise<void>;
}

/** Funnel outcome of one run: the summary handle tests assert on. */
export interface WatcherRun {
  /** Posts sent to the LLM judge (recency + seen survivors). */
  judged: number;
  /** Posts the judge marked relevant AND located. */
  matches: number;
  /** Posts the judge could not evaluate (they stay unseen). */
  skipped: number;
  /** Whether this run persisted judged ids to the state file. */
  saved: boolean;
}

/**
 * One watcher run: the linear funnel with Gate 1 (nothing unseen), Gate 2
 * (judged but zero matches), and the match path. Stage awaits carry
 * timeStage timers; persistence (D7/D8) happens on every run that judged
 * posts, ordered after the notification send.
 */
export async function runWatcher(deps: WatcherDeps = {}): Promise<WatcherRun> {
  const env = deps.env ?? process.env;
  const config = deps.config ?? (await loadWatcherConfig());
  const now = deps.now ?? Date.now;
  const sleepFn = deps.sleepFn ?? sleep;
  const statePath = deps.statePath ?? STATE_PATH;
  const startedAt = now();
  const surfaces = resolveSurfaces(config.surfaces);
  console.log(`watch: surfaces: ${surfaces.map((s) => s.label).join(", ")}`);

  // Acquisition stage (D9): session resolution + surface fetch timed as one
  // span. Extraction happens inside the walk; the dedupe count logs right
  // after the duration line.
  // Acquisition stage (D9): per-platform session resolution + surface
  // fetch timed as one span. Extraction happens inside the walk; the
  // dedupe count logs right after the duration line.
  const { value: collected, durationMs: fetchMs } = await timeStage(async () => {
    // D9: the platform split happens BEFORE session resolution. Each
    // platform resolves its own session variable; a null Threads session
    // keeps the existing logged-out walk, while a null LinkedIn session
    // SKIPS its surfaces with a warn (anonymous LinkedIn hits an authwall —
    // never the logged-out path).
    const threadsSurfaces = surfaces.filter((s) => s.platform === "threads");
    const linkedinSurfaces = surfaces.filter((s) => s.platform === "linkedin");
    const threadsSessionPath = await resolveSession(env);
    const linkedinSessionPath =
      linkedinSurfaces.length > 0 ? await resolveSession(env, ENV_NAMES.linkedinSession) : null;
    if (linkedinSurfaces.length > 0 && linkedinSessionPath === null) {
      console.warn(
        `fetch: ${ENV_NAMES.linkedinSession} missing or invalid — skipping ${linkedinSurfaces.length} linkedin surface(s)`,
      );
    }
    try {
      if (threadsSessionPath !== null) {
        // One authenticated dispatch carries the mixed pool: the LinkedIn
        // context is built inside the walk from linkedinSessionPath (D6),
        // and both platform types share the walk's own runPool (FR#8).
        const walkedSurfaces = linkedinSessionPath !== null ? surfaces : threadsSurfaces;
        // A linkedin-only config with no LinkedIn session walks nothing:
        // D5 degrades to warn + empty funnel + heartbeat, never a throw
        // (an empty surfaces array would trip the walker's all-fail gate).
        if (walkedSurfaces.length === 0) return [];
        const options: AuthenticatedFetchOptions =
          linkedinSessionPath !== null
            ? { linkedinSessionPath, scrollRounds: config.scrollRounds }
            : { scrollRounds: config.scrollRounds };
        return await fetchSurfacesAuthenticated(
          walkedSurfaces,
          threadsSessionPath,
          deps.contextFactory,
          options,
        );
      }
      // Threads logged-out: blob extraction per surface. A configured
      // LinkedIn surface with its own session walks alone here (rare mixed
      // config: no Threads secret but a LinkedIn one) — the walker builds
      // only the LinkedIn context for this dispatch (lazy base, D12: no
      // threads surfaces, no base context), so the base argument below is
      // vestigial and never becomes a context.
      const loggedOut =
        threadsSurfaces.length > 0
          ? await fetchLoggedOutPosts(threadsSurfaces, deps.contextFactory)
          : [];
      if (linkedinSessionPath === null) return loggedOut;
      // A walk-time dead LinkedIn session must not discard the logged-out
      // Threads results (acceptance 1, D5 — expiry is routine): the
      // LinkedIn arm's all-fail throw downgrades to a warn and zero posts,
      // and the run goes on. The mixed dispatch above needs no such guard:
      // there the side arrays already keep Threads posts alive inside one
      // call, and a total all-fail is the pre-existing throw contract.
      try {
        const linkedinPosts = await fetchSurfacesAuthenticated(
          linkedinSurfaces,
          linkedinSessionPath,
          deps.contextFactory,
          { linkedinSessionPath, scrollRounds: config.scrollRounds },
        );
        return [...loggedOut, ...linkedinPosts];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch: linkedin surfaces FAILED — ${message}`);
        return loggedOut;
      }
    } finally {
      // F019 pairing, extended: each created session dir dies with the run.
      // Contexts close inside the walks' own finally, so these run strictly
      // after close, on both the success and the throw path.
      if (threadsSessionPath !== null) await cleanupSessionDir(threadsSessionPath);
      if (linkedinSessionPath !== null) await cleanupSessionDir(linkedinSessionPath);
    }
  });
  console.log(`timing: fetch ${fetchMs}ms`);
  const posts = dedupePosts(collected);
  console.log(`extract: ${posts.length} unique post(s) across ${surfaces.length} surface(s)`);

  const recencyHours = config.recencyHours;
  const recent = filterRecent(posts, recencyHours, now());
  console.log(`recency: ${recent.length} post(s) within ${recencyHours}h`);

  // exactOptionalPropertyTypes: attach runUrl only when the ambient
  // GITHUB_* variables are present (a local run has none).
  const runUrl = runUrlFromEnv(env);

  const stats: HeartbeatStats = {
    ranAt: new Date(startedAt).toISOString(),
    unique: posts.length,
    recent: recent.length,
    recencyHours,
    judged: 0,
    relevantLocated: 0,
    skipped: 0,
    ...(runUrl !== undefined ? { runUrl } : {}),
  };

  // Prune-on-load (D6/D7): state entries outside the recency window drop
  // before dedupe, so the seen map cannot grow without bound.
  const state = await loadState(statePath, recencyHours, now());
  const newPosts = diffNew(state, recent);
  stats.judged = newPosts.length;
  if (newPosts.length === 0) {
    // Gate 1 (zero unseen): nothing was judged, so nothing persists — the
    // state file stays byte-identical. The heartbeat still runs (timed).
    const { durationMs: notifyMs } = await timeStage(() =>
      heartbeat(stats, recent, newPosts, config.candidateTerms, env, now, deps.transport),
    );
    console.log(`timing: notify ${notifyMs}ms`);
    console.log("no new matches");
    return { judged: 0, matches: 0, skipped: 0, saved: false };
  }
  console.log(`state: ${newPosts.length} unseen post(s)`);

  const { value: judgeOutcome, durationMs: judgeMs } = await timeStage(() =>
    judgePosts(
      newPosts,
      resolveJudgeConfig(env),
      config.keywords,
      deps.fetchFn,
      config.reasoningEffort,
      parseJudgeConcurrency(env[ENV_NAMES.judgeConcurrency]),
      now,
      sleepFn,
    ),
  );
  console.log(`timing: judge ${judgeMs}ms`);
  const { judged, skippedPostIds } = judgeOutcome;
  const matches = judged
    .filter((j) => j.verdict.relevant && j.verdict.locationOk)
    .map((j) => j.post);
  stats.relevantLocated = matches.length;
  stats.skipped = skippedPostIds.length;
  console.log(
    `judge: ${newPosts.length} candidate(s) judged, ${matches.length} relevant+located, skipped: ${skippedPostIds.length}`,
  );

  if (matches.length === 0) {
    // Gate 2 (D7/D8): the run JUDGED these posts even though none matched.
    // Persist every judged id — heartbeat first, then state, mirroring the
    // notification-before-persistence convention — so the next run never
    // feeds the same posts to the LLM again. Skipped ids stay unseen and
    // retry next run (D3).
    const { durationMs: notifyMs } = await timeStage(() =>
      heartbeat(stats, recent, newPosts, config.candidateTerms, env, now, deps.transport),
    );
    console.log(`timing: notify ${notifyMs}ms`);
    const saved = await persistJudged(state, judged, statePath, now());
    console.log("no new matches");
    return {
      judged: newPosts.length,
      matches: 0,
      skipped: skippedPostIds.length,
      saved,
    };
  }

  // Email before state: a failed send exits non-zero and leaves state
  // untouched, so the next run re-judges and re-sends these matches (D3, D8).
  const { durationMs: notifyMs } = await timeStage(() =>
    sendDigest(matches, resolveEmailConfig(env), deps.transport),
  );
  console.log(`timing: notify ${notifyMs}ms`);
  const saved = await persistJudged(state, judged, statePath, now());
  return {
    judged: newPosts.length,
    matches: matches.length,
    skipped: skippedPostIds.length,
    saved,
  };
}

// --- New: the shared persistence tail (D8) ---

/**
 * Stamp every judged id — relevant or not — as seen (D8) and log the delta.
 * Skipped ids never reach this call, so they stay unseen and retry next run
 * (D3). saveState keeps its internal gate: an empty id list writes nothing.
 */
async function persistJudged(
  state: AppState,
  judged: readonly JudgedPost[],
  filePath: string,
  nowMs: number,
): Promise<boolean> {
  const judgedIds = judged.map((entry) => entry.post.id);
  const result = await saveState(state, judgedIds, filePath, nowMs);
  console.log(`state: ${result.addedCount} new seen post id(s)`);
  return result.saved;
}

/** Logged-out path: blob extraction per surface, in input order. */
async function fetchLoggedOutPosts(
  surfaces: readonly ResolvedSurface[],
  contextFactory?: ContextFactory,
): Promise<Post[]> {
  const fetched = await fetchSurfaces(surfaces, contextFactory);
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

// Pipeline entry: the run starts only when this file IS the entry module
// (npm start, watch.yml). Importing the module — as tests/index.test.ts
// does — stays side-effect free.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatcher().catch(async (error: unknown) => {
    // Pool exhausted: one alarm email, then the standard failed-run exit.
    // The email is best-effort — a broken GMAIL_* configuration must not
    // mask the exit code the run already earned. State was never reached
    // (the throw happened in the judge stage), so no post is marked seen
    // (D3, D8).
    if (isRotationExhausted(error)) {
      console.error(`watch: FAILED — ${error.message}`);
      try {
        await sendExhaustionEmail(error.failures, resolveEmailConfig(process.env));
      } catch (emailError) {
        const emailMessage = emailError instanceof Error ? emailError.message : String(emailError);
        console.warn(`email: exhaustion alarm not sent — ${emailMessage}`);
      }
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`watch: FAILED — ${message}`);
    process.exit(1);
  });
}
