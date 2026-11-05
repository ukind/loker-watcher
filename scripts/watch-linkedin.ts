/**
 * The always-on PC loop (design D1/D7): one fetch tick, then a 10-minute
 * sleep, forever. Leg-dead edges send ONE alarm per episode (the marker
 * file in scripts/fetch-linkedin.ts) and the loop keeps running — a
 * cookie-file refresh self-heals on a later tick without a restart. Any
 * other tick fault warns and the loop continues; Ctrl-C stops it.
 *
 * Run from a dedicated clone of main: `npm run watch-linkedin`.
 */
import { envWithDotEnv } from "../src/env-file.js";
import { isLegDead } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";

/** The 10-minute cadence, in code (D1: an always-on npm script). */
const TICK_MS = 600_000;

/** The merged env, resolved once: .env fills unset keys, the real shell wins. */
const ENV = envWithDotEnv();

async function main(): Promise<void> {
  for (;;) {
    try {
      await fetchTick({ env: ENV });
    } catch (error) {
      if (isLegDead(error)) {
        await handleLegDeadEpisode(error.reason);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`watch-linkedin: tick FAILED — ${message}`);
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, TICK_MS);
    });
  }
}

void main();
