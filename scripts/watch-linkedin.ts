/**
 * The always-on PC loop (design 2026-11-09, the anti-restriction
 * profile): one fetch tick, then a jittered 28-33-minute sleep, forever.
 * Every fetch gate (the working-hours window, the halt latch, the daily
 * budget) rides fetchTick — the loop stays a dumb cadence: tick, sleep,
 * repeat. Leg-dead edges send ONE alarm per episode (the marker file in
 * scripts/fetch-linkedin.ts) and the loop keeps running — a cookie-file
 * refresh self-heals on a later tick without a restart. Any other tick
 * fault warns and the loop continues; Ctrl-C stops it.
 *
 * Entry-guarded main (the fetch-linkedin.ts idiom): importing the module
 * stays side-effect free — runLoop exports for the offline suite, and the
 * real loop starts only when this file is the process entry.
 *
 * Run from a dedicated clone of main: `npm run watch-linkedin`.
 */
import { pathToFileURL } from "node:url";
import { envWithDotEnv } from "../src/env-file.js";
import { type RandomFn, sampleTickDelayMs } from "../src/linkedin-behavior.js";
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
  /** Leg-dead episode handler. Default: handleLegDeadEpisode (one alarm per episode). */
  onLegDead?: (reason: string) => Promise<void>;
  /** Environment for the default tick. Default: the merged env — .env fills unset keys, the real shell wins. */
  env?: Record<string, string | undefined>;
  /** Tick cap for the offline suite; undefined (the default) loops forever. */
  maxIterations?: number;
}

/**
 * The loop: tick, then a uniform 28-33-minute sleep (sampleTickDelayMs),
 * forever — or until maxIterations when the suite caps it. The first tick
 * runs immediately; every iteration pairs one tick with one sleep. The
 * wake log names the delay and the local wall-clock wake time so a quiet
 * overnight stretch stays legible in the run log.
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
    const delayMs = sampleTickDelayMs(rng);
    const wakeAt = new Date(now() + delayMs);
    const hh = String(wakeAt.getHours()).padStart(2, "0");
    const mm = String(wakeAt.getMinutes()).padStart(2, "0");
    console.log(
      `watch-linkedin: next wake in ~${Math.round(delayMs / 60_000)} min (${hh}:${mm} local)`,
    );
    await sleepFn(delayMs);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLoop().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`watch-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
