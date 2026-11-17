/**
 * The always-on PC loop (design 2026-11-09, the anti-restriction
 * profile): one fetch tick, then a sleep drawn from the configured wake
 * band (watcher.config.json linkedinWakeMinMinutes/MaxMinutes, 60 minutes
 * flat by default), forever. Every fetch gate (the halt latch) rides fetchTick — the loop stays a
 * dumb cadence: tick, sleep, repeat. Leg-dead edges send ONE alarm per
 * episode (the marker file in scripts/fetch-linkedin.ts) and the loop
 * keeps running — a cookie-file refresh self-heals on a later tick
 * without a restart. Any other tick fault warns and the loop continues;
 * Ctrl-C stops it.
 *
 * Entry-guarded main (the fetch-linkedin.ts idiom): importing the module
 * stays side-effect free — runLoop exports for the offline suite, and the
 * real loop starts only when this file is the process entry.
 *
 * Run from a dedicated clone of main: `npm run watch-linkedin`.
 */
import { pathToFileURL } from "node:url";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { CONFIG_PATH } from "../src/config.js";
import { envWithDotEnv } from "../src/env-file.js";
import {
  DEFAULT_WAKE_MAX_MS,
  DEFAULT_WAKE_MIN_MS,
  type RandomFn,
  resolveLinkedInWakeBand,
  sampleTickDelayMs,
} from "../src/linkedin-behavior.js";
import { type SleepFn, isLegDead } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";

/** Injectables for the offline suite; production defaults run the real tick. */
export interface RunLoopDeps {
  /** One fetch tick. Default: fetchTick with the merged env (resolved once). */
  tick?: () => Promise<unknown>;
  /** Sleep between ticks. Default: a setTimeout promise. */
  sleepFn?: SleepFn;
  /** Clock for the wake log. Default: Date.now. */
  now?: () => number;
  /** Jitter draw for the cadence. Default: Math.random. */
  rng?: RandomFn;
  /** Wake band floor in ms. Default: DEFAULT_WAKE_MIN_MS (60 min flat). */
  linkedinWakeMinMs?: number;
  /** Wake band ceiling in ms, EXCLUSIVE. Default: DEFAULT_WAKE_MAX_MS (60 min flat). */
  linkedinWakeMaxMs?: number;
  /** Leg-dead episode handler. Default: handleLegDeadEpisode (one alarm per episode). */
  onLegDead?: (reason: string) => Promise<void>;
  /** Environment for the default tick. Default: the merged env — .env fills unset keys, the real shell wins. */
  env?: Record<string, string | undefined>;
  /** Tick cap for the offline suite; undefined (the default) loops forever. */
  maxIterations?: number;
}

/**
 * startLoop deps: RunLoopDeps plus a config override. The offline suite
 * injects a config literal; production reads watcher.config.json once —
 * the loop's only fail-stop seam (a tick-path read would warn-and-continue
 * forever; the tick arms at scripts/watch-linkedin.ts catch and continue).
 */
export interface StartLoopDeps extends RunLoopDeps {
  /** Pre-resolved config. Default: loadWatcherConfig() — fail-visible. */
  config?: WatcherConfig;
}

/**
 * The loop: tick, then a sleep drawn from the configured wake band
 * (sampleTickDelayMs over the injected bounds; DEFAULT_WAKE_MIN_MS/
 * DEFAULT_WAKE_MAX_MS flat 60 when the deps omit them), forever — or
 * until maxIterations when the suite caps it. The first tick runs
 * immediately; every iteration pairs one tick with one sleep. The wake
 * log names the delay, the local wall-clock wake time, and the band so a
 * quiet overnight stretch stays legible in the run log.
 */
export async function runLoop(deps: RunLoopDeps = {}): Promise<void> {
  const env = deps.env ?? envWithDotEnv();
  const tick = deps.tick ?? (() => fetchTick({ env }));
  const sleepFn =
    deps.sleepFn ??
    ((ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const now = deps.now ?? Date.now;
  const rng: RandomFn = deps.rng ?? Math.random;
  const wakeMinMs = deps.linkedinWakeMinMs ?? DEFAULT_WAKE_MIN_MS;
  const wakeMaxMs = deps.linkedinWakeMaxMs ?? DEFAULT_WAKE_MAX_MS;
  const onLegDead = deps.onLegDead ?? ((reason: string) => handleLegDeadEpisode(reason));

  const max = deps.maxIterations;

  for (let iteration = 1; max === undefined || iteration <= max; iteration += 1) {
    try {
      await tick();
    } catch (error) {
      if (isLegDead(error)) {
        await onLegDead(error.reason);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`watch-linkedin: tick FAILED — ${message}`);
      }
    }
    const delayMs = sampleTickDelayMs(wakeMinMs, wakeMaxMs, rng);
    const wakeAt = new Date(now() + delayMs);
    const hh = String(wakeAt.getHours()).padStart(2, "0");
    const mm = String(wakeAt.getMinutes()).padStart(2, "0");
    const bandMin = Math.round(wakeMinMs / 60_000);
    const bandMax = Math.round(wakeMaxMs / 60_000);
    console.log(
      `watch-linkedin: next wake in ~${Math.round(delayMs / 60_000)} min (${hh}:${mm} local) (band ${bandMin}-${bandMax} min)`,
    );
    await sleepFn(delayMs);
  }
}

/**
 * Startup: read the config once (the probe-judge.ts read-once idiom),
 * resolve the wake band — the loop-side min > max gate, so a broken band
 * stops ONLY this loop — and run with the bounds injected. A missing or
 * malformed config, or a broken band, throws into the guard's catch:
 * exit 1 naming the key(s). Exported for the offline suite: the guard's
 * failure path is pinned here, offline. The resolved band overrides any
 * injected bounds deps.
 */
export async function startLoop(deps: StartLoopDeps = {}): Promise<void> {
  const { config, ...loopDeps } = deps;
  const resolved = config ?? (await loadWatcherConfig());
  const band = resolveLinkedInWakeBand(
    resolved.linkedinWakeMinMinutes,
    resolved.linkedinWakeMaxMinutes,
    CONFIG_PATH,
  );
  await runLoop({
    ...loopDeps,
    linkedinWakeMinMs: band.minMs,
    linkedinWakeMaxMs: band.maxMs,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startLoop().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`watch-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
