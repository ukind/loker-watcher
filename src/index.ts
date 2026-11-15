import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Transporter } from "nodemailer";
import {
  type ResolvedSurface,
  type Surface,
  type WatcherConfig,
  loadWatcherConfig,
  resolveSurfaces,
} from "./config-file.js";
import { LINKEDIN_PAYLOAD_PATH, STATE_PATH, isHeartbeatEnabled, runUrlFromEnv } from "./config.js";
import {
  groupMatchesBySurface,
  resolveEmailConfig,
  sendExhaustionEmail,
  sendSurfaceDigest,
} from "./email.js";
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
import { type ContextFactory, fetchSurfaces, fetchSurfacesAuthenticated } from "./fetch-threads.js";
import { type HeartbeatStats, selectCandidates, sendHeartbeat } from "./heartbeat.js";
import { type AvailabilityResult, checkJudgeAvailability } from "./judge-availability.js";
import { loadAccountCeilings } from "./judge-ceilings.js";
import {
  type HealthRead,
  type TickOutcomes,
  buildDegradedAccountsLine,
  episodeAlarmDue,
  flushExhaustionHealth,
  flushTickHealth,
  loadAccountHealth,
} from "./judge-health.js";
import { isRotationExhausted } from "./judge-rotation.js";
import { type JudgedPost, type LlmAccount, judgePosts, resolveJudgeConfig } from "./judge.js";
import type { LinkedinSurface } from "./linkedin-fetch.js";
import { type LegLine, type PayloadRead, readPayloadPosts } from "./linkedin-payload.js";
import { filterRecent } from "./recency.js";
import { sleep } from "./sleep.js";
import { type AppState, diffNew, loadState, saveState } from "./state.js";
import { cleanupSessionDir, resolveSession } from "./threads-session.js";
import type { AccountFailure, Post } from "./types.js";

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
 * The shared exhaustion-episode sequence (D8): the pre-flush
 * episodeAlarmDue read, the exhaustion health flush, then the
 * suppress-or-send alarm. The skip branch calls it with the injected
 * pool, the hoisted health snapshot, and deps.transport; the entry catch
 * calls it with the bootstrap re-resolve (production nodemailer default;
 * process.exit(1) stays in the catch). The pre-flush discipline: the
 * flush OPENS the episode bit, so an open bit read BEFORE it means a
 * previous run already alarmed — one alarm per episode.
 * flushExhaustionHealth never throws, so a failed flush cannot swallow
 * the alarm: the due-read already happened and the send still fires
 * (fail-visible — a duplicate alarm costs one email, a suppressed alarm
 * costs the outage). The email's pool size rides as accounts.length
 * (D9): the skip path reads "3 of 3 accounts failed" against a 0-of-N
 * availability log line, and the mid-run catch path finally composes
 * pool-truthful wording.
 *
 * The caller passes a FRESH read: a stale snapshot can only DUPLICATE
 * the alarm — never suppress it — the fail-safe direction the doctrine
 * already picks (a duplicate costs one email, a suppressed alarm costs
 * the outage). The entry catch re-resolves per invocation; the skip
 * branch passes the run's hoisted snapshot, which no in-run write has
 * touched (a skip run never reaches the tick flush).
 */
export async function flushAndSendExhaustionAlarm(deps: {
  readonly accounts: readonly LlmAccount[];
  readonly health: HealthRead;
  readonly outcomes: TickOutcomes;
  readonly failures: readonly AccountFailure[];
  readonly env: Record<string, string | undefined>;
  readonly transport: Transporter | undefined;
  readonly judgeHealthPath: string | undefined;
}): Promise<void> {
  const episodeAlreadyOpen = !episodeAlarmDue(deps.health.file);
  await flushExhaustionHealth(deps.accounts, deps.health.file, deps.outcomes, deps.judgeHealthPath);
  if (episodeAlreadyOpen) {
    console.warn(
      "watch: outage episode already open — exhaustion alarm suppressed (one per episode)",
    );
    return;
  }
  try {
    await sendExhaustionEmail(
      deps.failures,
      resolveEmailConfig(deps.env),
      deps.transport,
      deps.accounts.length,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`email: exhaustion alarm not sent — ${message}`);
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
 * fetch, the LinkedIn payload reader, LLM transport, SMTP transport, state
 * file, and the clock all inject, so a full pipeline run executes offline.
 */
export interface WatcherDeps {
  /** Environment record for every resolver. Default: process.env. */
  readonly env?: Record<string, string | undefined>;
  /** Pre-resolved watcher config. Default: loadWatcherConfig() — fail-visible. */
  readonly config?: WatcherConfig;
  /** Browser-context factory for the surface walks (Slice 3 seam). Default: chromiumContextFactory. */
  readonly contextFactory?: ContextFactory;
  /** LinkedIn payload reader (D6 seam). Default: readPayloadPosts — the module owns its degrade contract (D13). */
  readonly linkedinFetch?: (payloadPath: string, now: () => number) => Promise<PayloadRead>;
  /** Judge ceiling resolver (D3 seam, the linkedinFetch shape). Default:
   *  loadAccountCeilings — the module owns its degrade contract (an absent
   *  or malformed ceilings file floors every account at ceiling 1 with one
   *  warning per account; it never fails the run). */
  readonly judgeCeilings?: (accounts: readonly LlmAccount[]) => Promise<Map<number, number>>;
  /** Judge health resolver (the judgeCeilings seam shape). Default:
   *  loadAccountHealth — the module owns its degrade contract (an absent
   *  or malformed health file reads as the healthy default and never
   *  fails the run). */
  readonly judgeHealth?: (accounts: readonly LlmAccount[]) => Promise<HealthRead>;
  /** Availability pre-check (D6 seam, the judgeCeilings shape). Default:
   *  checkJudgeAvailability over deps.fetchFn — the module owns its
   *  never-throw degrade contract: per-account refusals come back as
   *  failures, a checker fault degrades to all-available (degraded:
   *  true) and the run proceeds unfiltered. */
  readonly judgeAvailability?: (accounts: readonly LlmAccount[]) => Promise<AvailabilityResult>;
  /** Health file location for the flushes. Default: beside the state file —
   *  dirname(statePath)/judge-health.json, which equals JUDGE_HEALTH_PATH
   *  in production. Tests point either knob at a temp dir — the offline
   *  rule forbids writes inside the repo. */
  readonly judgeHealthPath?: string;
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
  // The health file lives beside the state file: dirname(STATE_PATH) is the
  // committed state/ dir, so the default derives exactly JUDGE_HEALTH_PATH
  // in production while tests that point statePath at a temp dir keep the
  // flush inside the temp dir (the offline rule forbids repo writes).
  const judgeHealthPath = deps.judgeHealthPath ?? join(dirname(statePath), "judge-health.json");
  const startedAt = now();
  const linkedinFetch = deps.linkedinFetch ?? readPayloadPosts;
  console.log(
    `watch: platforms: linkedin=${config.platforms.linkedin ? "on" : "off"}, threads=${config.platforms.threads ? "on" : "off"}`,
  );
  // D14: labels come from the RAW config partition, not the resolved array,
  // and they stay raw when a platform flag is off — this line mirrors
  // watcher.config.json surfaces array, linkedin included. The platforms
  // line above carries what this run enables. Labels: tag/<value>, url
  // verbatim, linkedin/<value>.
  console.log(`watch: surfaces: ${config.surfaces.map(surfaceLabel).join(", ")}`);
  // Raw partition, gated by the platforms flags: a false flag empties its arm —
  // the fetch stage existing empty-guards then skip the platform with no new
  // skip machinery. The PC leg payload reader takes the fixed repo path (no
  // surface arguments), the walker takes resolved threads records. Slice 3
  // narrows ResolvedSurface.platform to "threads"; partitioning here keeps
  // linkedin entries out of resolveSurfaces.
  const linkedinSurfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface =>
      surface.type === "linkedin" && config.platforms.linkedin,
  );
  const surfaces = resolveSurfaces(
    config.surfaces.filter((surface) => surface.type !== "linkedin" && config.platforms.threads),
  );

  // Acquisition stage (D4): the per-platform fetches timed as one span.
  // Extraction happens inside the walk; the dedupe count logs right after
  // the duration line. Threads keeps its Playwright walks; LinkedIn reads
  // the PC leg's pushed payload (D6/D13 — the reader is total, absent and
  // stale degrade to a logged threads-only run).
  let linkedinLeg: LegLine | undefined;
  const { value: collected, durationMs: fetchMs } = await timeStage(async () => {
    const threadsSessionPath = await resolveSession(env);
    try {
      let threadsPosts: Post[] = [];
      // An empty threads partition never reaches the walker: its all-fail
      // gate throws on zero surfaces (fetch-threads.ts:397-409). D13 keeps
      // the LinkedIn arm alive regardless of the Threads partition shape.
      if (threadsSessionPath !== null && surfaces.length > 0) {
        threadsPosts = await fetchSurfacesAuthenticated(
          surfaces,
          threadsSessionPath,
          deps.contextFactory,
          { scrollRounds: config.scrollRounds },
        );
      } else if (threadsSessionPath === null && surfaces.length > 0) {
        threadsPosts = await fetchLoggedOutPosts(surfaces, deps.contextFactory);
      }
      let linkedinPosts: Post[] = [];
      if (linkedinSurfaces.length > 0) {
        // D6/D13: the arm reads the PC leg's pushed payload. The reader is
        // total — absent/stale/malformed all degrade to a logged
        // threads-only run, never a nonzero exit — so this belt catches
        // only unanticipated faults and throwing injected stubs (D12).
        try {
          const read = await linkedinFetch(LINKEDIN_PAYLOAD_PATH, now);
          linkedinPosts = read.posts;
          linkedinLeg =
            read.detail !== undefined
              ? { status: read.leg, detail: read.detail }
              : { status: read.leg };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`fetch: linkedin payload FAILED — ${message}`);
          linkedinLeg = { status: "malformed", detail: message };
        }
      }
      // D13: ONE return. The old early returns (empty-pool guard, logged-out
      // arm) silently dropped LinkedIn posts on a linkedin-only config with
      // a Threads secret.
      return [...threadsPosts, ...linkedinPosts];
    } finally {
      // F019 pairing: the Threads session dir dies with the run. The
      // payload reader keeps no session dir (cookies ride the PC leg).
      if (threadsSessionPath !== null) await cleanupSessionDir(threadsSessionPath);
    }
  });
  console.log(`timing: fetch ${fetchMs}ms`);
  const posts = dedupePosts(collected);
  console.log(
    `extract: ${posts.length} unique post(s) across ${config.surfaces.length} surface(s)`,
  );
  // (the extract line counts config.surfaces.length — the raw-config mirror per
  // D14; per-platform enabled state rides the startup platforms line)

  const recencyHours = config.recencyHours;
  const recent = filterRecent(posts, recencyHours, now());
  console.log(`recency: ${recent.length} post(s) within ${recencyHours}h`);

  // exactOptionalPropertyTypes: attach runUrl only when the ambient
  // GITHUB_* variables are present (a local run has none).
  const runUrl = runUrlFromEnv(env);

  // Provider-health resolve (the D3-seam family): hoisted above the gates so
  // the degraded-accounts line rides every email — a Gate-1 heartbeat
  // renders marks from PREVIOUS ticks (zero dispatches cannot clear them,
  // FR7). resolveJudgeConfig hoists with it: the line needs pool size and
  // stable indexing. The hoist moves a malformed-LLM_ACCOUNTS failure
  // EARLIER: on a nothing-unseen (Gate-1) tick this flips exit 0 (with a
  // heartbeat) into exit 1 before it — a recorded, accepted trade.
  const judgeAccounts = resolveJudgeConfig(env);
  // The READ defaults to the derived path too (not the bare constant): the
  // read/write pair must agree, or once a live run commits the file, repo
  // state leaks into hermetic test runs as phantom degraded lines and caps.
  const health = await (
    deps.judgeHealth ??
    ((accounts: readonly LlmAccount[]) => loadAccountHealth(accounts, judgeHealthPath))
  )(judgeAccounts);
  const degradedLine = buildDegradedAccountsLine(judgeAccounts, health.marks);
  if (degradedLine !== undefined) {
    console.warn(degradedLine);
  }

  // Both platforms off: the parked run. The secret resolve above already ran
  // (locked discover decision — a malformed LLM_ACCOUNTS still exits 1 while
  // parked, the recorded trade untouched), and nothing below this line runs:
  // no state read, no heartbeat, no state write. The Gate-1 return shape keeps
  // the parked tick indistinguishable from a nothing-unseen tick to callers.
  if (!config.platforms.linkedin && !config.platforms.threads) {
    console.log("watch: platforms off — parked");
    return { judged: 0, matches: 0, skipped: 0, saved: false };
  }

  const stats: HeartbeatStats = {
    ranAt: new Date(startedAt).toISOString(),
    unique: posts.length,
    recent: recent.length,
    recencyHours,
    judged: 0,
    relevantLocated: 0,
    skipped: 0,
    ...(runUrl !== undefined ? { runUrl } : {}),
    ...(linkedinLeg !== undefined ? { linkedinLeg } : {}),
    ...(degradedLine !== undefined ? { degradedAccounts: degradedLine } : {}),
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

  const checkAvailability =
    deps.judgeAvailability ??
    ((accounts: readonly LlmAccount[]) => checkJudgeAvailability(accounts, deps.fetchFn));
  const { value: availability, durationMs: availabilityMs } = await timeStage(() =>
    checkAvailability(judgeAccounts),
  );
  console.log(`timing: availability ${availabilityMs}ms`);
  const availableCount = judgeAccounts.length - availability.failures.length;
  console.log(`availability: ${availableCount} of ${judgeAccounts.length} account(s) available`);
  // One sit-out line per refused account: the run's visibility into who
  // sits out and why (the mask below carries the same reasons).
  for (const failure of availability.failures) {
    console.log(
      `availability: account ${failure.account} (${failure.baseUrl}) sits out — ${failure.reason}`,
    );
  }
  // The all-down skip (D7): zero survivors on a trustworthy verdict — no
  // judge calls, ids stay unseen, the episode alarm fires at most once,
  // and the run resolves exit-0 green. A degraded check never skips: an
  // unfiltered run is the contract (the checker warned once already).
  if (
    judgeAccounts.length > 0 &&
    !availability.degraded &&
    availability.failures.length === judgeAccounts.length
  ) {
    console.log(
      `availability: skipping the judge stage — every account refused, ${newPosts.length} post(s) stay unseen`,
    );
    await flushAndSendExhaustionAlarm({
      accounts: judgeAccounts,
      health,
      outcomes: { ok: [], failed: new Map<number, string>() },
      failures: availability.failures,
      env,
      transport: deps.transport,
      judgeHealthPath,
    });
    return { judged: 0, matches: 0, skipped: newPosts.length, saved: false };
  }
  // The mask (D2): 1-based failure account numbers become 0-based
  // RotationState indexes. Survivors dispatch at their committed
  // ceilings; refused seats never dispatch and never count toward width.
  const blocked = new Map(
    availability.failures.map((failure) => [failure.account - 1, failure.reason] as const),
  );

  const { value: judgeOutcome, durationMs: judgeMs } = await timeStage(async () => {
    // D3 seam: the ceilings resolver mirrors linkedinFetch — injected in
    // tests, the fs-reading default in production. Its degrade contract
    // (never throws) keeps an absent state/judge-ceilings.json a quiet
    // floor-at-1 run.
    const ceilings = await (deps.judgeCeilings ?? loadAccountCeilings)(judgeAccounts);
    return judgePosts(
      newPosts,
      judgeAccounts,
      config.keywords,
      deps.fetchFn,
      config.reasoningEffort,
      ceilings,
      now,
      sleepFn,
      health.marks,
      blocked,
      config.negativeKeywords,
    );
  });
  console.log(`timing: judge ${judgeMs}ms`);
  // Provider-health flush (best-effort — never throws): the tick's outcomes
  // land in the health file; the episode bit clears only when some account
  // dispatched ok. Gate 1 never dispatches and never flushes (FR7).
  await flushTickHealth(judgeAccounts, health.file, judgeOutcome.outcomes, judgeHealthPath);
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
  // The per-surface loop (D6) replaces the single combined-digest
  // call inside the SAME timeStage closure: one timing pair (FR8), any
  // failed send throws before persist (FR7), and the leg + degraded
  // riders ride every surface email when present (FR9; the body renders
  // the leg line only when it is not ok, D13 — undefined omits it
  // entirely). Surfaces iterate in config order, disabled platforms
  // filtered out (FR6); duplicate configured surfaces collapse to one
  // group key, one email (D7 — the load already warned).
  const { durationMs: notifyMs } = await timeStage(async () => {
    const notifySurfaces = config.surfaces.filter((surface) =>
      surface.type === "linkedin" ? config.platforms.linkedin : config.platforms.threads,
    );
    const { groups, orphans } = groupMatchesBySurface(matches, notifySurfaces);
    for (const orphan of orphans) {
      const stamps = orphan.surfaces ?? [];
      if (stamps.length === 0) {
        // Legacy payload row (no stamps): the fetcher that produced it
        // predates stamping — the PC loop running old code. The remedy
        // is updating that clone, not the config.
        console.warn(
          `notify: match ${orphan.id} carries no surface stamp — the payload row predates stamping; update the PC loop's clone of main (git pull) and restart watch-linkedin so rows carry stamps`,
        );
        continue;
      }
      const labels = stamps.map(surfaceLabel).join(", ");
      console.warn(
        `notify: match ${orphan.id} carries no configured surface (${labels}) — skipped from every email; re-add the surface if it left watcher.config.json, or enable its platform in "platforms" if the platform switch is off`,
      );
    }
    const emailConfig = resolveEmailConfig(env);
    for (const group of groups) {
      if (group.posts.length === 0) continue;
      await sendSurfaceDigest(
        group.surface,
        group.posts,
        emailConfig,
        deps.transport,
        linkedinLeg,
        degradedLine,
      );
    }
  });
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
  for (const page of fetched) {
    // Stamp from the page own pair (design D2): the successes filter
    // compacted the slot list, so the page carries the only identity left.
    const extracted = extractPosts(page.html).map((post) => ({
      ...post,
      surfaces: [{ type: page.type, value: page.value }],
    }));
    console.log(`extract: ${page.label}: ${extracted.length} post(s)`);
    posts.push(...extracted);
  }
  return posts;
}

/** D14 log label for one raw config surface. */
function surfaceLabel(surface: Surface): string {
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
      let episodeHandled = false;
      try {
        const bootstrapAccounts = resolveJudgeConfig(process.env);
        const healthRead = await loadAccountHealth(bootstrapAccounts);
        await flushAndSendExhaustionAlarm({
          accounts: bootstrapAccounts,
          health: healthRead,
          outcomes: error.health ?? { ok: [], failed: new Map<number, string>() },
          failures: error.failures,
          env: process.env,
          transport: undefined,
          judgeHealthPath: undefined,
        });
        episodeHandled = true;
      } catch (healthError) {
        const healthMessage =
          healthError instanceof Error ? healthError.message : String(healthError);
        console.warn(`judge: health flush failed — ${healthMessage}`);
        // episodeHandled stays false → the fallback below sends the alarm
        // unsuppressed (fail-visible: a duplicate alarm costs one email, a
        // suppressed alarm costs the outage). Pool size unknowable on a
        // bootstrap fault — the legacy wording stands (D9).
      }
      if (!episodeHandled) {
        try {
          await sendExhaustionEmail(error.failures, resolveEmailConfig(process.env));
        } catch (emailError) {
          const emailMessage =
            emailError instanceof Error ? emailError.message : String(emailError);
          console.warn(`email: exhaustion alarm not sent — ${emailMessage}`);
        }
      }
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`watch: FAILED — ${message}`);
    process.exit(1);
  });
}
