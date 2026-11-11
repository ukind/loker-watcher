/**
 * LinkedIn transport gate (design D8, the probe-judge pattern; rebuilt on
 * the browser walk, migration 2026-11-11): drive the SAME production stack
 * — the cookie resolver, the headless Chromium context factory, the
 * content-search browser walk with its flagship-web response join —
 * against the first configured linkedin surface, one real browser page.
 *
 * Exit 1 on a checkpoint or login wall (the walk's tagged halt), a dead
 * session (no flagship-web response within the liveness window — the
 * tagged leg-dead), every surface faulted, or fewer than 2 posts. The
 * probe writes nothing: no payload, no push, no latch, no episode
 * marker — it is a read-only diagnostic the fetch tick never consults.
 *
 * Operator protocol (Nov 1 research rule): run twice >=6h apart with the
 * stored cookies only before trusting the loop; re-run after every
 * session re-harvest (npm run login-linkedin).
 *
 * Usage: npx tsx scripts/probe-linkedin.ts   (needs LINKEDIN_COOKIES_FILE;
 * runs from the repo root — it loads watcher.config.json at startup)
 */
import { loadWatcherConfig } from "../src/config-file.js";
import { envWithDotEnv } from "../src/env-file.js";
import {
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-fetch.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";

const CONFIG = await loadWatcherConfig();

const surfaces = CONFIG.surfaces.filter(
  (surface): surface is LinkedinSurface => surface.type === "linkedin",
);
if (surfaces.length === 0) {
  console.error("probe: no linkedin surfaces configured in watcher.config.json");
  process.exit(1);
}
const surface = surfaces[0] as LinkedinSurface;

try {
  // The merged env, resolved once: .env fills ONLY unset keys, the real
  // shell wins — an .env-only setup reaches the browser leg unaided.
  const env = envWithDotEnv();
  const cookies = resolveLinkedInCookies(env);
  console.log(
    `probe: browser walk — content search for "${surface.value}" (scrollRounds ${CONFIG.scrollRounds}, headless)`,
  );
  const started = Date.now();
  // The undefined contextFactory selects the walk module's own production
  // factory (headless Chromium, the session document in, the Playwright
  // import lazy inside it) — the same lazy-default the tick suite pins.
  const posts = await fetchLinkedInPosts([surface], cookies, undefined, CONFIG.scrollRounds);
  const elapsed = Date.now() - started;
  console.log(`probe: ${elapsed}ms — ${posts.length} post(s)`);
  if (posts.length < 2) {
    console.error("probe: fewer than 2 posts — the session answered but the leg looks wrong");
    process.exit(1);
  }
  console.log("probe: all checks passed");
} catch (error) {
  if (isHalt(error)) {
    console.error(`probe: HALT — ${error.reason}`);
    process.exit(1);
  }
  if (isLegDead(error)) {
    console.error(`probe: LEG DEAD — ${error.reason}`);
    process.exit(1);
  }
  if (isAllSurfacesFaulted(error)) {
    console.error(`probe: FAILED — ${error.message}`);
    process.exit(1);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`probe: FAILED — ${message}`);
  process.exit(1);
}
