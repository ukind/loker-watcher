/**
 * The always-on PC loop (design D1/D7): one fetch tick, then a 10-minute
 * sleep, forever. Leg-dead edges send ONE alarm per episode (the marker
 * file in scripts/fetch-linkedin.ts) and the loop keeps running — a
 * cookie-file refresh self-heals on a later tick without a restart. Any
 * other tick fault warns and the loop continues; Ctrl-C stops it.
 *
 * Run from a dedicated clone of main: `npm run watch-linkedin`.
 */
import { pathToFileURL } from "node:url";
import { envWithDotEnv } from "../src/env-file.js";
import { isLegDead } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";

/** The 10-minute cadence, in code (D1: an always-on npm script). */
const TICK_MS = 600_000;

async function main(): Promise<void> {
  // Resolved once per process, before the first tick (semantics unchanged:
  // the merged env feeds every tick via the loop below). Moved from module
  // scope (N027): the module-scope readFileSync of .env is a side effect
  // the entry guard alone cannot suppress.
  const ENV = envWithDotEnv();
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

// Entry guard (the PC-script contract, fetch-linkedin.ts shape): importing
// stays side-effect free. A throw outside the loop body is not expected —
// fetchTick catches tick faults and envWithDotEnv is a quiet no-op on a
// missing .env — but it exits 1 fail-visibly, mirroring the sibling wrapper.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`watch-linkedin: FAILED — ${message}`);
    process.exit(1);
  });
}
