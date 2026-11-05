/**
 * LinkedIn transport gate (design D8, the probe-judge pattern): drive the
 * SAME production stack — cookie resolver, transport selection, §12.7 URL
 * builder, response parser — against the first configured linkedin
 * surface, one small page.
 *
 * Exit 1 on leg-dead, an HTTP fault, an unparsable 200, or fewer than 2
 * posts. Operator protocol (Nov 1 research rule): run twice ≥6h apart with
 * stored cookies only before trusting the loop; re-run after any
 * LINKEDIN_TRANSPORT change.
 *
 * Usage: npx tsx scripts/probe-linkedin.ts   (needs LINKEDIN_COOKIES_FILE;
 * runs from the repo root — it loads watcher.config.json at startup)
 */
import { loadWatcherConfig } from "../src/config-file.js";
import { ENV_NAMES } from "../src/config.js";
import { envWithDotEnv } from "../src/env-file.js";
import {
  type LinkedinSurface,
  isLegDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";
import { buildSearchUrl, parseSearchResponse } from "../src/linkedin-voyager.js";

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
  // shell wins — an .env-only setup reaches the transport leg unaided.
  const env = envWithDotEnv();
  const cookies = resolveLinkedInCookies(env);
  const transportSelection = env[ENV_NAMES.linkedinTransport]?.trim() || "curl";
  console.log(
    `probe: transport ${transportSelection} — GET voyager search for "${surface.value}" (count 10)`,
  );
  const started = Date.now();
  const transport = await resolveLinkedInTransport(env, cookies);
  try {
    const response = await transport.get(buildSearchUrl(surface.value, 0, 10));
    const elapsed = Date.now() - started;
    if (response.status !== 200) {
      console.error(`probe: HTTP ${response.status} — ${response.body.slice(0, 120)}`);
      process.exit(1);
    }
    const parsed = parseSearchResponse(response.body);
    if (parsed.kind !== "ok") {
      console.error(`probe: 200 body unparsable — ${parsed.reason}`);
      process.exit(1);
    }
    console.log(
      `probe: ${elapsed}ms — HTTP 200 — ${parsed.posts.length} post(s), ${parsed.dropped} dropped`,
    );
    if (parsed.posts.length < 2) {
      console.error("probe: fewer than 2 posts — the endpoint answered but the leg looks wrong");
      process.exit(1);
    }
    console.log("probe: all checks passed");
  } finally {
    await transport.dispose();
  }
} catch (error) {
  if (isLegDead(error)) {
    console.error(`probe: LEG DEAD — ${error.reason}`);
    process.exit(1);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`probe: FAILED — ${message}`);
  process.exit(1);
}
