---
date: 2026-11-12T10:34:39+0700
author: Yogiswara Utama
commit: 559ad54
branch: main
repository: loker-watcher
topic: "LinkedIn operator chain (login -> probe -> one fetch tick)"
tags: [design, linkedin-chain, probe-linkedin, runProbe, scripts, pc-local]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-12_09-55-42_linkedin-operator-chain.md
last_updated: 2026-11-12T10:34:39+0700
last_updated_by: Yogiswara Utama
---

# Design: LinkedIn operator chain (login -> probe -> one fetch tick)

## Summary

One new PC-local entry, scripts/linkedin-chain.ts (npm run linkedin-chain), sequences the decided operator protocol inside one process: the login hold (operator presses Enter in the terminal; the helper's finally block closes the browser) -> the probe walk -> on pass, exactly one fetchTick. Every gate failure exits nonzero and names its gate; the tick's quiet-zero no-ops are reported as no-ops, never failures. scripts/probe-linkedin.ts stops running at import and exports runProbe behind the entry guard so the chain and the offline suite can drive it. The six proven doc-drift claims are corrected in the same change.

## Requirements

- One command runs login -> probe -> exactly one fetch tick, in that order (solutions artifact, Option 1).
- The login hold releases only on Enter in a real TTY; a hand-closed window does not release it.
- Fail visible: every gate failure exits nonzero with a message that names the gate.
- The tick's quiet-zero outcomes (working-hours window, halt latch, halt trip, all-faulted walk, zero surfaces) are reported as no-ops with exit 0.
- No new env knobs, no config keys, no timed cooldown (FR-4 dropped by decision).
- Docs match code: the probe floor is 10 everywhere (today three surfaces still say 2).
- The offline suite pins the order, the single-tick stop, and every failure mapping with zero browser.

## Current State Analysis

scripts/probe-linkedin.ts is the only linkedin entry without an export: it awaits loadWatcherConfig at module top level (line 33), filters surfaces, and runs the whole walk in a top-level try/catch (lines 55-105) with five process.exit(1) arms (HALT, LEG DEAD, FAILED x2, floor) plus a pre-try zero-surfaces exit (lines 45-48). Importing the file runs the gate. It has no test file; guidance records this as "NO TESTS BY DESIGN ... its run IS the gate" (.rpiv/guidance/tests/architecture.md lines 48-49). The walk call is fetchLinkedInPosts with 8 positional args: [surface], LINKEDIN_PROFILE_DIR, undefined factory, CONFIG.scrollRounds, undefined sleep, undefined now, undefined rng, PROBE_MIN_CLICKS=5 (lines 72-79). The floor is posts.length < 10 (lines 83-88).

### Key Discoveries

- Composition precedent: scripts/watch-linkedin.ts line 21 imports fetchTick from ./fetch-linkedin.js and composes it in runLoop's default-tick closure (lines 48-59); scripts/reset-linkedin.ts lines 28-29 import DEFAULT_LATCH / DEFAULT_COOKIE_PATH / DEFAULT_PROFILE_DIR across scripts. Cross-script import is safe only when the exporter is import-safe.
- Exported-entry + injected-deps idiom: runLoginHelper(deps) at scripts/login-linkedin.ts line 179, fetchTick(deps) at scripts/fetch-linkedin.ts line 315, runLoop(deps) at scripts/watch-linkedin.ts line 48 — every dep optional, every default resolved lazily as deps.x ?? default.
- Entry-guard idiom, verbatim in four scripts: if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) { runX().catch(...) } — login-linkedin.ts line 255, fetch-linkedin.ts line 413, watch-linkedin.ts line 85, reset-linkedin.ts line 100.
- Env divergence: fetchTick alone defaults to process.env (scripts/fetch-linkedin.ts line 316); runLoginHelper and runLoop default to envWithDotEnv(). Both production entries resolve envWithDotEnv() once and pass it in (watch-linkedin.ts lines 49-50, fetch-linkedin.ts line 416).
- fetchTick outcome surface: returns FetchTickResult {wrote, pushed, postCount}. Five distinct gates return identical quiet zeros {wrote:false, pushed:false, postCount:0}: no surfaces (line 324), window (line 337), latch (line 343), halt trip (line 391), all-faulted (line 402). Failures always THROW: guardCheckout (line 349), cookie resolver (line 350), stampless cookie (lines 357-362), leg-dead and other walk errors (line 404), payload write (line 407), push failures (pushPayload throws at lines 290-294 and 309-311). Exit code alone cannot distinguish ran from no-op — the chain must read the result object.
- Login hold: runLoginHelper keepOpen prints the LOCKED warning, then const enterWait = deps.enterWait ?? waitForEnter and awaits it (login-linkedin.ts lines 240-247); waitForEnter is a readline on process.stdin (lines 167-171) — no TTY check exists, so a piped-stdin invocation rejects uncaught and exits 1 after the cookie file already landed. The finally block closes the context on every path (lines 250-252); the mandatory feed warm-up runs before the hold and warns without discarding the harvest (lines 223-238).
- Tagged error predicates: isHalt / isLegDead / isAllSurfacesFaulted from src/linkedin-fetch.js; the probe's catch maps them in that order with the fallback last (probe-linkedin.ts lines 91-105).
- Registration spine: package.json line 13 (lint list) and line 14 (format list) enumerate scripts explicitly; line 19 area holds the npm scripts. tsconfig (include src/tests/scripts), biome.json, lint-staged, husky, .claude/settings.json, and watch.yml all need NO edits for a new scripts/ file (directory/glob-driven; CI invokes no PC linkedin script).
- Doc drift ledger (verified against the working tree): probe floor "fewer than 2 posts" at README.md line 314, AGENTS.md lines 36-38, .rpiv/guidance/architecture.md line 41, .rpiv/guidance/scripts/architecture.md line 90, and the probe's own header line 10; "headless context from the harvested cookie DOCUMENT" at guidance/scripts lines 39-40 and guidance/src line 7 (the walk is headed on the persistent profile; the cookie document is preflight-only); "top-level await gate" at guidance/scripts line 39 (what this refactor deletes); "Eight files" at guidance/scripts line 4; the NO-TESTS-BY-DESIGN probe line at guidance/tests lines 48-49.
- Hard runtime constraint: guardCheckout requires a clean committed main checkout (fetch-linkedin.ts line 349) — the chain code must be committed before the chain runs. The current working tree carries uncommitted edits to 4 files, which is fine for development, not for running the chain.
- Precedent lesson (ea11969): an entry guard alone is insufficient — ALL module-scope work (the top-level await, the env read) must move inside the exported function.

## Scope

### Building

- scripts/probe-linkedin.ts refactor: runProbe(deps) export, entry guard, tagged errors propagate, ProbeResult {postCount, elapsedMs} on pass; CLI behavior preserved byte-for-byte.
- scripts/linkedin-chain.ts: runLinkedInChain(deps) sequencing login hold -> runProbe -> exactly one fetchTick, with per-gate failure mapping and no-op reporting.
- package.json: the npm script + the lint and format list entries.
- tests/probe-linkedin.test.ts: the probe rewrite's own offline suite.
- tests/linkedin-chain.test.ts: order pin, one-tick stop, failure mappings, no-op reporting, entry-guard pins.
- Doc sweep: chain registered in README.md, AGENTS.md, and three guidance files; the six drift claims corrected.

### Not Building

- No timed cooldown (FR-4 dropped upstream), no auto-start of watch-linkedin, no new env vars or config keys.
- No hosted-run (GitHub Actions) changes — CI invokes no PC linkedin script.
- No probe subprocess shape (rejected upstream: spawnSync doubles lose the offline order pins), no slash-command shape (rejected: no TTY for the login leg).
- No LINKEDIN_RESPONSE_RE widening, no FR-2 stop-line visibility, no round-1 loadMore-0 skip — fixed scope riding from research, not options here.
- No change to fetchTick, runLoginHelper, or the watch loop — the chain composes them as-is.

## Decisions

### D1: runProbe throws tagged errors; the caller owns the exit

Ambiguity: keep process.exit(1) inside the probe body (today's shape) or convert to throws. Explored: exits-inside means the chain cannot name the probe gate and cannot be driven offline; throws mean the CLI wrapper and the chain each own their exit mapping. Decision: runProbe re-throws tagged errors (isHalt / isLegDead / isAllSurfacesFaulted) and every other failure; it resolves ProbeResult {postCount, elapsedMs} on pass. The entry wrapper maps arms exactly as today (HALT / LEG DEAD / FAILED order, fallback last) — the fetchTick model (scripts/fetch-linkedin.ts line 404, entry wrapper lines 413-424). The two local gates (floor, no-surfaces) carry their own tags (the halt/legDead idiom: name constant + factory + type guard); their messages keep the "probe: " prefix and the CLI wrapper prints them bare, so today's exact lines survive and callers classify them; every other plain failure keeps the FAILED fallback (the reset-linkedin.ts:89-91 prefix discipline). Directional confirm locked with the developer (2026-11-12).

### D2: the chain resolves the merged env once and passes it to all three legs

envWithDotEnv() at chain start, threaded into runLoginHelper, runProbe, and fetchTick as deps.env. Required because fetchTick alone defaults to process.env (fetch-linkedin.ts line 316); without this a .env-only setup reaches login and probe but silently misses the tick. Matches watch-linkedin.ts lines 49-50 and the fetch entry line 416. Directional confirm locked (2026-11-12).

**Amendment (ratified at the Slice 2 micro-checkpoint, 2026-11-12)**: the login leg's harvested cookiePath joins the threaded env for stages 2-3 when the env lacks LINKEDIN_COOKIES_FILE (no second envWithDotEnv read). Without it the first-ever chain run (no .env cookie line yet) fails at the probe preflight: the helper writes the .env line mid-chain, and an env resolved at chain start cannot see it. D2's single envWithDotEnv read is unchanged; the forwarding rides the login RESULT, not a re-read.

### D3: the tick outcome is classified by result, not exit code

The chain reads FetchTickResult. Quiet zeros log a "no-op" line and the chain exits 0; only a throw fails the chain. Five zero-return paths make exit-code classification wrong (fetch-linkedin.ts lines 324, 337, 343, 391, 402); defb8af is the precedent that 0 posts is an outcome, not a failure. Directional confirm locked (2026-11-12).

### D4: the doc drift fixes ride this design

Six claims corrected in the doc slice (locations in Current State Analysis). Rationale: prose-only drift survived three surfaces before (the floor-2 case) and nothing machine-checks markdown; the repo's own precedent (7dcaeb3) shows docs-later costs an audit. Directional confirm locked (2026-11-12).

### D5: the probe rewrite gets its own offline suite

tests/probe-linkedin.test.ts pins the rewrite directly: floor, the three tagged arms, the zero-surfaces guard, the cookie preflight ordering, the pass-through of scrollRounds/minClicks, and the side-effect-free import. Developer picked this over chain-only coverage (2026-11-12) — the rewrite is the risk-bearing change and the repo rule is one test file per script (watch-linkedin superseded its NO-TESTS line the same way).

### D6 (simple): runProbe's dep surface

ProbeDeps {config?, env?, contextFactory?, minClicks?, now?} with lazy production defaults: config ?? loadWatcherConfig(), env ?? envWithDotEnv(), minClicks ?? PROBE_MIN_CLICKS (the module constant stays as the default), now ?? Date.now. scrollRounds rides config (no forking); LINKEDIN_PROFILE_DIR stays the module import passed at argument 2 (the tick hard-passes it too); the walk call keeps its exact 8-positional-argument shape; the zero-surfaces guard converts from process.exit(1) to a tagged thrown Error with the same message. Evidence: FetchTickDeps shape (fetch-linkedin.ts lines 85-134), analyzer findings.

### D7 (simple): the chain's dep surface and shape

ChainDeps {env?, login?, probe?, tick?, now?} — the three legs default to closures over the real entries (the runLoop default-tick closure model, watch-linkedin.ts lines 48-50). runLinkedInChain returns a ChainResult naming each stage outcome; the entry wrapper maps failures to exit 1 with the linkedin-chain: prefix. The entry guard is the four-script verbatim idiom. No TTY check is added: an agent-mediated or piped run fails at stage 1 exactly as documented in the solutions artifact (the helper's readline rejects uncaught) — the header comment says the wrapper MUST run in a real TTY.

## Architecture

### scripts/probe-linkedin.ts — MODIFY

Full-body restructure: the header keeps the read-only contract and operator protocol, gains the entry-guard note; PROBE_MIN_CLICKS and a PROBE_MIN_POSTS=10 constant stay module-level; runProbe + ProbeDeps + ProbeResult become exports; the top-level await, surfaces filter, walk, floor check, and catch arms move inside runProbe (exits become throws; stdout lines preserved); the entry guard + .catch arm mapping lands at the bottom. Line range of the change: the whole file (107 lines -> ~150).

```typescript
/**
 * LinkedIn transport gate (design D8, the probe-judge pattern; rebuilt on
 * the browser walk, migration 2026-11-11): drive the SAME production stack
 * — the cookie resolver, the headed persistent-profile Chromium context
 * factory, the content-search browser walk with its flagship-web response
 * join — against the first configured linkedin surface, one real browser
 * page.
 *
 * Exit 1 on a checkpoint or login wall (the walk's tagged halt), a dead
 * session (no flagship-web response within the liveness window — the
 * tagged leg-dead), every surface faulted, or fewer than 10 posts. The
 * probe writes nothing: no payload, no push, no latch, no episode
 * marker — it is a read-only diagnostic the fetch tick never consults.
 *
 * Entry-guarded main (the login-linkedin.ts idiom): importing the module
 * stays side-effect free — no config load, no cookie read, no browser.
 * runProbe is the exported seam the offline suite and the operator chain
 * drive: gate failures THROW (the fetchTick model), so every caller owns
 * its exit and can name the gate. The two local gates (floor,
 * no-surfaces) are TAGGED so this file's CLI wrapper prints today's
 * exact lines and callers can classify them.
 *
 * Operator protocol (Nov 1 research rule): run twice >=6h apart with the
 * stored cookies only before trusting the loop; re-run after every
 * session re-harvest (npm run login-linkedin).
 *
 * Usage: npx tsx scripts/probe-linkedin.ts   (needs LINKEDIN_COOKIES_FILE;
 * runs from the repo root — it loads watcher.config.json at startup)
 */
import { pathToFileURL } from "node:url";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { envWithDotEnv } from "../src/env-file.js";
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedInContextFactory,
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-fetch.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";

/**
 * The probe's Load-more click floor (live rehearsal 2026-11-11): the dry
 * exit may not fire before this many clicks have landed, so one probe run
 * samples several pagination bodies instead of stopping at the first.
 */
const PROBE_MIN_CLICKS = 5;

/** The probe's post floor: pagination must prove out across several bodies. */
const PROBE_MIN_POSTS = 10;

// --- the probe's two local gates: the halt/legDead idiom (name constant +
//     factory + type guard), local to this file because only the probe
//     defines these failure modes ---

export const PROBE_FLOOR = "ProbeFloorError";

/** Thrown when the walk minted fewer than PROBE_MIN_POSTS posts. */
export interface ProbeFloor extends Error {
  name: string;
}

export function probeFloor(): ProbeFloor {
  const error = new Error(
    "probe: fewer than 10 posts — pagination did not prove out (need >= 10 across several bodies)",
  ) as ProbeFloor;
  error.name = PROBE_FLOOR;
  return error;
}

export function isProbeFloor(error: unknown): error is ProbeFloor {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === PROBE_FLOOR
  );
}

export const PROBE_NO_SURFACES = "ProbeNoSurfacesError";

/** Thrown when the config carries no linkedin surface for the probe to walk. */
export interface ProbeNoSurfaces extends Error {
  name: string;
}

export function probeNoSurfaces(): ProbeNoSurfaces {
  const error = new Error(
    "probe: no linkedin surfaces configured in watcher.config.json",
  ) as ProbeNoSurfaces;
  error.name = PROBE_NO_SURFACES;
  return error;
}

export function isProbeNoSurfaces(error: unknown): error is ProbeNoSurfaces {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === PROBE_NO_SURFACES
  );
}

export interface ProbeDeps {
  /** Pre-resolved config. Default: loadWatcherConfig() — fail-visible. */
  config?: WatcherConfig;
  /** Environment for the cookie preflight. Default: envWithDotEnv(). */
  env?: Record<string, string | undefined>;
  /** Browser-context factory. Default: the walk module's own production factory. */
  contextFactory?: LinkedInContextFactory;
  /** The walk's Load-more click floor. Default: PROBE_MIN_CLICKS. */
  minClicks?: number;
  /** Clock for the elapsed report. Default: Date.now. */
  now?: () => number;
}

/** What a passed probe reports to its caller (the chain, the offline suite). */
export interface ProbeResult {
  postCount: number;
  elapsedMs: number;
}

/**
 * Run the probe: resolve config, pick the FIRST configured linkedin
 * surface, preflight the cookie file (presence/parse only — the browser
 * rides the persistent PROFILE, not this document), walk the surface
 * read-only, and enforce the 10-post floor. Resolves with the post count
 * and the elapsed wall clock on pass. Every failure THROWS — the walk's
 * tagged gate errors (halt, leg-dead, all-faulted) keep their names, the
 * two local gates carry theirs, and the cookie resolver's plain error
 * passes through: the caller maps them all (the fetchTick model).
 */
export async function runProbe(deps: ProbeDeps = {}): Promise<ProbeResult> {
  const config = deps.config ?? (await loadWatcherConfig());
  const surfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  if (surfaces.length === 0) {
    throw probeNoSurfaces();
  }
  const surface = surfaces[0] as LinkedinSurface;
  // The merged env, resolved once: .env fills ONLY unset keys, the real
  // shell wins — an .env-only setup reaches the browser leg unaided.
  const env = deps.env ?? envWithDotEnv();
  // Preflight only (REVISED 2026-11-11T18:40+0700): the cookie file must
  // exist and parse, but the browser rides the persistent PROFILE, not
  // this document. resolveLinkedInCookies throws fail-visibly on a
  // missing or malformed file, which is the check worth keeping.
  resolveLinkedInCookies(env);
  const minClicks = deps.minClicks ?? PROBE_MIN_CLICKS;
  console.log(
    `probe: browser walk — content search for "${surface.value}" (scrollRounds ${config.scrollRounds}, minClicks ${minClicks}, headed on the persistent profile)`,
  );
  const now = deps.now ?? Date.now;
  const started = now();
  // The undefined contextFactory selects the walk module's own production
  // factory (the persistent profile, headed, the Playwright import lazy
  // inside it) — the same lazy-default the tick suite pins.
  // minClicks: the probe must sample several pagination bodies, not stop
  // at the first dry exit — each body carries ~3 posts (live rehearsal
  // 2026-11-11), so the floor proves the pagination leg works.
  // scrollRounds stays the ceiling.
  const posts = await fetchLinkedInPosts(
    [surface],
    LINKEDIN_PROFILE_DIR,
    deps.contextFactory,
    config.scrollRounds,
    undefined, // default sleep
    deps.now, // Date.now when unset — the exact production call shape
    undefined, // Math.random
    minClicks,
  );
  const elapsedMs = now() - started;
  console.log(`probe: ${elapsedMs}ms — ${posts.length} post(s)`);
  if (posts.length < PROBE_MIN_POSTS) {
    throw probeFloor();
  }
  console.log("probe: all checks passed");
  return { postCount: posts.length, elapsedMs };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The exact CLI contract, arm for arm: the walk's tagged arms keep
  // today's byte-for-byte lines, the two local gates print their already-
  // prefixed message bare — the same line the pre-refactor script printed
  // — and the fallback keeps the FAILED wrapper.
  runProbe().catch((error: unknown) => {
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
    if (isProbeNoSurfaces(error)) {
      console.error(error.message);
      process.exit(1);
    }
    if (isProbeFloor(error)) {
      console.error(error.message);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`probe: FAILED — ${message}`);
    process.exit(1);
  });
}
```

### tests/probe-linkedin.test.ts — NEW

Offline suite for runProbe: entry-guard import pin, pass path (pinned clock, >= 10 posts), floor rejection, halt / leg-dead / all-faulted propagation, zero-surfaces rejection, cookie preflight before any browser build, scrollRounds + profile pass-through.

```typescript
/**
 * Offline suite for the probe gate's runProbe seam (operator-chain
 * design, Slice 1). Importing scripts/probe-linkedin.ts IS the
 * entry-guard pin: the module used to walk at import time, so reaching
 * this suite without a browser launch proves the guard. The rest pins
 * the behavior the chain depends on: the 10-post floor, the tagged gate
 * arms (halt / leg-dead / all-faulted propagate — the caller owns the
 * exit), the two local tagged gates, the zero-surfaces guard, the
 * cookie preflight BEFORE any browser build, and the production
 * pass-through (scrollRounds rides config, minClicks defaults to 5, the
 * profile dir reaches the factory). Zero network, zero browser: the
 * fetch-linkedin suite's contextFactory double, trimmed. Hermetic: the
 * cookie preflight runs the REAL resolver, so the env points at a real
 * temp cookie file (the login-linkedin suite idiom), never at the
 * operator's live path.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  isProbeFloor,
  isProbeNoSurfaces,
  runProbe,
} from "../scripts/probe-linkedin.js";
import { ENV_NAMES } from "../src/config.js";
import type { WatcherConfig } from "../src/config-file.js";
import type { ContextLike, LocatorLike, PageLike, ResponseLike } from "../src/fetch-threads.js";
import { HALT_CHECKPOINT_REASON } from "../src/linkedin-behavior.js";
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-fetch.js";

const T0 = Date.UTC(2026, 11, 12, 9, 14, 0);

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: [],
  negativeKeywords: [],
  surfaces: [{ type: "linkedin", value: "#hiring react" }],
  platforms: { linkedin: true, threads: true },
  recencyHours: 72,
  reasoningEffort: "low",
  scrollRounds: 8,
};

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

/**
 * A real cookie file in OS temp (the login-linkedin suite idiom): the
 * probe's preflight runs the REAL resolver, so the env must point at a
 * file that exists and parses on every machine — never at the operator's
 * live path. The quoted JSESSIONID rides verbatim (the jar dialect).
 */
async function cookieEnv(): Promise<Record<string, string | undefined>> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-probe-linkedin-"));
  const cookiePath = join(dir, "cookies.json");
  await writeFile(
    cookiePath,
    `${JSON.stringify(
      {
        liAt: "AQE-probe",
        jsessionid: '"ajax:0123456789012345678"',
        harvestedAt: "2026-11-10T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { [ENV_NAMES.linkedinCookiesFile]: cookiePath };
}

// --- the walk doubles (capture-shaped flight bodies + one context factory) ---

const FLAGSHIP_SEARCH_URL = "https://www.linkedin.com/flagship-web/search/results/content/";
const PAGINATION_URL = "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination";
const CHECKPOINT_URL = "https://www.linkedin.com/checkpoint/challenge";

/**
 * Capture-shaped ids: BigInt(epochMs) << 22n — the exact inverse of the
 * parser's BigInt(id) >> 22n clock. One minute of spacing keeps every id
 * distinct and time-ordered by n.
 */
const BASE_MS = Date.UTC(2026, 11, 12, 9, 0, 0);
const idAt = (n: number): string => (BigInt(BASE_MS + n * 60_000) << 22n).toString();

/** One flight line. */
const row = (id: string, payload: unknown): string => `${id}:${JSON.stringify(payload)}`;

let cardSeq = 0;

/** One capture-shaped card: the activityUrn row precedes the commentary_text row. */
const cardBody = (id: string, text: string): string => {
  const n = (cardSeq += 1) * 10;
  return [
    row(String(n), { tracking: { activityUrn: { activityId: id } } }),
    row(String(n + 1), [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: [text] } }],
      },
    ]),
  ].join("\n");
};

/** A body minting exactly count distinct posts (numbered capture-shaped cards). */
const bodyMinting = (count: number): string =>
  Array.from({ length: count }, (_, i) =>
    cardBody(idAt(i + 1), `hiring post ${i + 1} — Jakarta`),
  ).join("\n");

/** What the fake page does at goto, click, and settle time. */
interface PageScript {
  /** The URL the page reports (default: the search results page). */
  readonly url?: string;
  /** Goto throws this message (the surface fault arm, never leg-dead). */
  readonly gotoError?: string;
  /** The initial flagship-web body fired during goto; absent = silence (leg-dead). */
  readonly initialBody?: string;
  /** True when round N's Load-more waitFor resolves (default never: zero clicks). */
  readonly loadMoreVisible?: (round: number) => boolean;
  /** The pagination body fired by round N's click settle (index 0 = round 1). */
  readonly clickBodies?: readonly string[];
}

/**
 * The LinkedInContextFactory double (the fetch-linkedin suite's shape,
 * trimmed): one context, one page, one script. Records the built count
 * and the profile path the walk opened.
 */
function contextFactoryFor(options: {
  built?: { value: number };
  profileDirs?: unknown[];
  script: PageScript;
}): LinkedInContextFactory {
  const factory: LinkedInContextFactory = async (profileDir): Promise<ContextLike> => {
    if (options.built !== undefined) options.built.value += 1;
    options.profileDirs?.push(profileDir);
    const listeners: Array<(response: ResponseLike) => void> = [];
    const fire = (response: ResponseLike): void => {
      for (const listener of listeners) listener(response);
    };
    let clickCount = 0;
    let settleArmed = false;
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => ({
        url: () => options.script.url ?? "https://www.linkedin.com/search/results/content/",
        goto: async () => {
          if (options.script.gotoError !== undefined) throw new Error(options.script.gotoError);
          const initial = options.script.initialBody;
          if (initial !== undefined) {
            fire({
              url: () => FLAGSHIP_SEARCH_URL,
              status: () => 200,
              text: async () => initial,
            });
          }
          return undefined;
        },
        waitForFunction: async () => undefined,
        content: async () => "<html></html>",
        on: (_event, listener) => {
          listeners.push(listener);
          return undefined;
        },
        locator: () => {
          const handle: LocatorLike = {
            first: () => handle,
            waitFor: async () => {
              const visible = options.script.loadMoreVisible?.(clickCount + 1) ?? false;
              if (!visible) throw new Error("locator wait timeout");
            },
            click: async () => {
              clickCount += 1;
              settleArmed = true;
            },
          };
          return handle;
        },
        // The liveness gate reads the rendered post count (the initial
        // results are server-rendered, not a flagship body). A script with
        // an initial body simulates a healthy page; a silent script
        // simulates a dead session.
        evaluate: async () => (options.script.initialBody !== undefined ? 8 : 0),
        waitForTimeout: async () => {
          if (settleArmed) {
            settleArmed = false;
            const body = options.script.clickBodies?.[clickCount - 1];
            if (body !== undefined) {
              fire({ url: () => PAGINATION_URL, status: () => 200, text: async () => body });
            }
          }
          // One macrotask tick: the walk's async body reads drain first.
          await new Promise<void>((resolve) => setImmediate(resolve));
        },
        close: async () => undefined,
      }),
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
  return factory;
}

describe("entry guard", () => {
  it("importing the module stays side-effect free (no config load, no browser walk)", async () => {
    // The import above already ran the module top level: reaching this
    // test without a walk IS the pin (the guard kept main off) — before
    // Slice 1 this file ran the whole gate at import time.
    assert.equal(typeof runProbe, "function");
  });
});

describe("runProbe pass path", () => {
  it("walks the first configured surface on the persistent profile and resolves the post count", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const built = { value: 0 };
    const profileDirs: unknown[] = [];
    const contextFactory = contextFactoryFor({
      built,
      profileDirs,
      script: { initialBody: bodyMinting(10) },
    });
    const result = await runProbe({
      config: CONFIG,
      env: await cookieEnv(),
      contextFactory,
      now: () => T0,
    });
    assert.deepEqual(result, { postCount: 10, elapsedMs: 0 }); // the pinned clock reports the elapsed delta
    assert.equal(built.value, 1); // exactly one context: the production shape
    assert.deepEqual(profileDirs, [LINKEDIN_PROFILE_DIR]); // the walk rides the persistent profile
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(
      lines.some((line) =>
        /probe: browser walk — content search for "#hiring react" \(scrollRounds 8, minClicks 5, headed on the persistent profile\)/.test(
          line,
        ),
      ),
    ); // scrollRounds rides config; minClicks defaults to PROBE_MIN_CLICKS
    assert.ok(lines.some((line) => /probe: 0ms — 10 post\(s\)/.test(line)));
    assert.ok(lines.some((line) => line === "probe: all checks passed"));
  });
});

describe("runProbe gate arms", () => {
  it("throws the tagged floor gate on a short walk", async () => {
    const contextFactory = contextFactoryFor({ script: { initialBody: bodyMinting(4) } });
    await assert.rejects(
      async () =>
        runProbe({
          config: CONFIG,
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) => {
        assert.equal(isProbeFloor(error), true); // tagged: the CLI prints today's exact line, the chain classifies it
        assert.match(
          (error as Error).message,
          /probe: fewer than 10 posts — pagination did not prove out/,
        );
        assert.equal(isHalt(error), false); // disjoint from the walk's tags
        assert.equal(isLegDead(error), false);
        assert.equal(isAllSurfacesFaulted(error), false);
        return true;
      },
    );
  });

  it("propagates the walk's tagged halt on a checkpoint URL — the caller maps it", async () => {
    const contextFactory = contextFactoryFor({ script: { url: CHECKPOINT_URL } });
    await assert.rejects(
      async () =>
        runProbe({
          config: CONFIG,
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) =>
        isHalt(error) && (error as { reason: string }).reason === HALT_CHECKPOINT_REASON,
    );
  });

  it("propagates the tagged leg-dead on a silent walk (no body, no rendered posts)", async () => {
    const contextFactory = contextFactoryFor({ script: {} });
    await assert.rejects(
      async () =>
        runProbe({
          config: CONFIG,
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) =>
        isLegDead(error) && /session may be dead/.test((error as { reason: string }).reason),
    );
  });

  it("propagates the tagged all-faulted error when the single surface faults", async () => {
    const contextFactory = contextFactoryFor({ script: { gotoError: "navigation failed" } });
    await assert.rejects(
      async () =>
        runProbe({
          config: CONFIG,
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) => isAllSurfacesFaulted(error) && (error as { faulted: number }).faulted === 1,
    );
  });
});

describe("runProbe preflight", () => {
  it("rejects a config with zero linkedin surfaces before any browser build", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    await assert.rejects(
      () =>
        runProbe({
          config: { ...CONFIG, surfaces: [{ type: "tag", value: "hiring" }] },
          env: {}, // would also fail the cookie gate — this error must win first
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) => {
        assert.equal(isProbeNoSurfaces(error), true); // tagged local gate
        assert.match((error as Error).message, /no linkedin surfaces configured/);
        return true;
      },
    );
    assert.equal(built.value, 0); // the surfaces guard precedes the walk
  });

  it("rejects on the cookie preflight before any browser build (preflight precedes the walk)", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    await assert.rejects(
      () => runProbe({ config: CONFIG, env: {}, contextFactory, now: () => T0 }),
      /LINKEDIN_COOKIES_FILE/,
    );
    assert.equal(built.value, 0); // no browser was ever built
  });
});
```

### scripts/linkedin-chain.ts — NEW

runLinkedInChain(deps): login hold -> runProbe -> exactly one fetchTick; ChainResult; per-gate failure mapping; no-op reporting; entry guard.

```typescript
/**
 * The LinkedIn operator chain (operator-chain design 2026-11-12): ONE
 * command runs the decided operator protocol in order —
 *
 *   login hold -> probe walk -> exactly one fetch tick
 *
 * Stage 1 opens the headed browser; the OPERATOR logs in by hand (2FA
 * included); the helper harvests the cookie file + the .env line, warms up
 * the feed, and holds until Enter — Enter closes the browser and releases
 * the profile lock. Stage 2 walks the first configured surface read-only
 * (the gate). Stage 3 runs exactly ONE fetch tick and stops — no loop; the
 * watch loop stays a separate manual start.
 *
 * The login harvest feeds the later legs: the harvested cookie path joins
 * the threaded env when the env lacks LINKEDIN_COOKIES_FILE (the first-ever
 * run — the .env line the helper writes mid-chain cannot appear in an env
 * resolved at chain start).
 *
 * Fail visible: every gate failure THROWS and the entry wrapper prints
 * linkedin-chain: FAILED — <gate and remedy>, exit 1. The tick quiet-zero
 * gates (working-hours window, halt latch, halt trip, all-faulted walk,
 * zero surfaces) are OUTCOMES, not failures (the defb8af rule): the chain
 * reports the no-op shape and exits 0.
 *
 * The wrapper MUST run in a real TTY: the login hold reads Enter from
 * stdin. A piped or agent-mediated run fails at stage 1 (the helper
 * readline rejects uncaught) — no TTY check is added here, by decision.
 *
 * Run from a DEDICATED clone of main with a committed tree:
 * npm run linkedin-chain (stage 3 guardCheckout enforces branch main +
 * a clean tree BEFORE any fetch — the chain CODE itself must be committed
 * first, or stage 3 names the dirty paths).
 *
 * Entry-guarded main (the four-script idiom): importing the module stays
 * side-effect free — no env read, no config load, no browser.
 */
import { pathToFileURL } from "node:url";
import { ENV_NAMES } from "../src/config.js";
import { envWithDotEnv } from "../src/env-file.js";
import { type FetchTickResult, fetchTick } from "./fetch-linkedin.js";
import { type LoginHelperResult, runLoginHelper } from "./login-linkedin.js";
import { type ProbeResult, runProbe } from "./probe-linkedin.js";

/** The merged-env shape every PC-local leg already takes. */
type Env = Record<string, string | undefined>;

/** Injectables for the offline suite; production defaults run the real legs. */
export interface ChainDeps {
  /** Environment for all three legs, resolved ONCE. Default: envWithDotEnv(). */
  env?: Env;
  /** Stage 1. Default: runLoginHelper({ env, keepOpen: true }) — hold until Enter. */
  login?: (env: Env) => Promise<LoginHelperResult>;
  /** Stage 2. Default: runProbe({ env }). */
  probe?: (env: Env) => Promise<ProbeResult>;
  /** Stage 3 — called at most once. Default: fetchTick({ env }). */
  tick?: (env: Env) => Promise<FetchTickResult>;
  /** Clock for the total-duration report. Default: Date.now. */
  now?: () => number;
}

/** What one chain run reports: each stage outcome, in call order. */
export interface ChainResult {
  /** Stage 1 — the harvest: cookie file written, .env line state. */
  login: LoginHelperResult;
  /** Stage 2 — the gate: post count + elapsed wall clock on a pass. */
  probe: ProbeResult;
  /** Stage 3 — the single tick outcome object. */
  tick: FetchTickResult;
  /** True when the tick landed on a quiet-zero gate — an outcome, never a failure. */
  tickNoop: boolean;
  /** Total wall clock across the three stages. */
  totalMs: number;
}

/**
 * Run the chain: the login hold, the probe gate, exactly one tick — in
 * that order, aborting on the first throw. The merged env resolves ONCE
 * (D2) and threads into all three legs; the harvested cookie path joins it
 * for stages 2-3 when the env lacks LINKEDIN_COOKIES_FILE (the first-ever
 * run: the helper writes the .env line mid-chain, and an env resolved at
 * start cannot see it).
 */
export async function runLinkedInChain(deps: ChainDeps = {}): Promise<ChainResult> {
  const env = deps.env ?? envWithDotEnv();
  const login = deps.login ?? ((legEnv: Env) => runLoginHelper({ env: legEnv, keepOpen: true }));
  const probe = deps.probe ?? ((legEnv: Env) => runProbe({ env: legEnv }));
  const tick = deps.tick ?? ((legEnv: Env) => fetchTick({ env: legEnv }));
  const now = deps.now ?? Date.now;
  const started = now();

  console.log(
    "linkedin-chain: stage 1/3 login — log in by hand in the opened window, press Enter HERE when done",
  );
  const loginResult = await login(env);
  // The harvest feeds the gate + the tick: the output cookie path of stage 1 is
  // authoritative (the helper just wrote that file), so it rides forward instead
  // of a second envWithDotEnv read.
  const cookiePath = loginResult.cookiePath;
  const legEnv: Env =
    env[ENV_NAMES.linkedinCookiesFile] === undefined && cookiePath !== ""
      ? { ...env, [ENV_NAMES.linkedinCookiesFile]: cookiePath }
      : env;

  console.log("linkedin-chain: stage 2/3 probe — read-only walk of the first configured surface");
  const probeResult = await probe(legEnv);

  console.log("linkedin-chain: stage 3/3 tick — exactly one fetch tick, then stop");
  const tickResult = await tick(legEnv);

  // Quiet-zero classification reads the RESULT, not an exit code (D3): five
  // gates return the identical {wrote:false, pushed:false, postCount:0} — the
  // tick itself already logged which gate held, so the chain reports the
  // no-op shape. A written payload (even 0 posts) is an outcome, not a noop.
  const tickNoop = !tickResult.wrote && !tickResult.pushed && tickResult.postCount === 0;
  if (tickNoop) {
    console.log(
      "linkedin-chain: tick no-op — a quiet gate held, nothing written or pushed (exit stays 0)",
    );
  }
  const totalMs = now() - started;
  console.log(
    `linkedin-chain: done — probe ${probeResult.postCount} post(s), tick ${
      tickNoop ? "no-op" : `wrote ${tickResult.postCount} post(s)`
    }, ${totalMs}ms total`,
  );
  return { login: loginResult, probe: probeResult, tick: tickResult, tickNoop, totalMs };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The catch-all wrapper owns the exit: domain gates throw and this arm
  // prints the failure with its gate name. Tagged errors (halt, leg-dead)
  // carry the human reason on .reason — surface it so the operator never
  // needs the tag vocabulary.
  runLinkedInChain().catch((error: unknown) => {
    const base = error instanceof Error ? error.message : String(error);
    const reason = (error as { reason?: unknown }).reason;
    const detail =
      typeof reason === "string" && reason !== "" && !base.includes(reason) ? ` — ${reason}` : "";
    console.error(`linkedin-chain: FAILED - ${base}${detail}`);
    process.exit(1);
  });
}
```

### package.json — MODIFY

The npm script "linkedin-chain" plus the explicit lint (line 13) and format (line 14) list entries, each inserting scripts/linkedin-chain.ts after scripts/reset-linkedin.ts.

```diff
@@ the npm scripts (insert after reset-linkedin, before prepare)
     "reset-linkedin": "tsx scripts/reset-linkedin.ts",
+    "linkedin-chain": "tsx scripts/linkedin-chain.ts",
     "prepare": "husky"
@@ the lint list (insert scripts/linkedin-chain.ts after scripts/reset-linkedin.ts, before scripts/hooks)
-    "lint": "biome check src tests scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/hooks",
+    "lint": "biome check src tests scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/linkedin-chain.ts scripts/hooks",
@@ the format list (append scripts/linkedin-chain.ts after scripts/reset-linkedin.ts)
-    "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts",
+    "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/linkedin-chain.ts",
```

### tests/linkedin-chain.test.ts — NEW

Offline pins: order (login -> probe -> tick), exactly one tick then stop, probe failure -> no tick, tick failure -> nonzero-shaped result, quiet-zero no-op reported not failed, entry-guard import pin.

```typescript
/**
 * Offline suite for the operator chain (operator-chain design 2026-11-12,
 * Slice 3): the recording-legs transcript IS the oracle. Pins the order
 * (login -> probe -> EXACTLY one tick, then stop), the abort arms (a login
 * or probe throw never reaches the next stage and propagates untouched —
 * the entry wrapper owns the exit), the D2 cookie-path forwarding (the
 * harvested path joins the threaded env ONLY when the env lacks
 * LINKEDIN_COOKIES_FILE — the first-ever run; the caller's env object is
 * never mutated), and the D3 outcome rule (a quiet-zero tick is a reported
 * no-op with the chain still resolving; a written payload — even 0 posts —
 * is an outcome, never a noop).
 *
 * Zero browser, zero git, zero network, zero ambient env: every leg is an
 * injected recording double, the clock is pinned, and the env literal
 * starts empty.
 *
 * Importing scripts/linkedin-chain.ts in this file IS the entry-guard
 * pin: the module reads no env and loads no config at its top level, so
 * reaching this suite proves main stayed off.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FetchTickResult } from "../scripts/fetch-linkedin.js";
import { type ChainDeps, type ChainResult, runLinkedInChain } from "../scripts/linkedin-chain.js";
import type { LoginHelperResult } from "../scripts/login-linkedin.js";
import type { ProbeResult } from "../scripts/probe-linkedin.js";
import { ENV_NAMES } from "../src/config.js";

type Env = Record<string, string | undefined>;

const T0 = Date.UTC(2026, 11, 12, 9, 14, 0);

const HARVEST: LoginHelperResult = {
  cookiePath: "C:/loker-secrets/chain-cookies.json",
  dotEnvUpdated: true,
};
const PROBE_PASS: ProbeResult = { postCount: 12, elapsedMs: 41_000 };
const TICK_WROTE: FetchTickResult = { wrote: true, pushed: true, postCount: 7 };

/** Everything the assertions read back from the injected legs. */
interface Recording {
  order: string[];
  loginEnvs: Env[];
  probeEnvs: Env[];
  tickEnvs: Env[];
  tickCalls: number;
}

/**
 * Recording legs with per-leg overrides: every leg records FIRST, then
 * delegates (an override that throws still lands in the transcript, so
 * the abort arms can pin exactly how far the chain got).
 */
function recordingLegs(options: {
  login?: (env: Env) => Promise<LoginHelperResult>;
  probe?: (env: Env) => Promise<ProbeResult>;
  tick?: (env: Env) => Promise<FetchTickResult>;
}): { legs: ChainDeps; recording: Recording } {
  const recording: Recording = {
    order: [],
    loginEnvs: [],
    probeEnvs: [],
    tickEnvs: [],
    tickCalls: 0,
  };
  const login = async (env: Env): Promise<LoginHelperResult> => {
    recording.order.push("login");
    recording.loginEnvs.push(env);
    return options.login !== undefined ? options.login(env) : HARVEST;
  };
  const probe = async (env: Env): Promise<ProbeResult> => {
    recording.order.push("probe");
    recording.probeEnvs.push(env);
    return options.probe !== undefined ? options.probe(env) : PROBE_PASS;
  };
  const tick = async (env: Env): Promise<FetchTickResult> => {
    recording.order.push("tick");
    recording.tickCalls += 1;
    recording.tickEnvs.push(env);
    return options.tick !== undefined ? options.tick(env) : TICK_WROTE;
  };
  return { legs: { login, probe, tick }, recording };
}

describe("entry guard", () => {
  it("importing the module runs no leg — no env read, no config load, no browser", async () => {
    // The import above already ran the module top level: reaching this
    // test with nothing else having fired IS the pin (the four-script idiom).
    assert.equal(typeof runLinkedInChain, "function");
  });
});

describe("runLinkedInChain order and result", () => {
  it("runs login -> probe -> EXACTLY one tick, then stops — the transcript is the oracle", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const { legs, recording } = recordingLegs({});
    await runLinkedInChain({ ...legs, env: {}, now: () => T0 });
    assert.deepEqual(recording.order, ["login", "probe", "tick"]);
    assert.equal(recording.tickCalls, 1); // one tick, then stop — no loop
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.some((line) => /stage 1\/3 login /.test(line)));
    assert.ok(lines.some((line) => /stage 2\/3 probe /.test(line)));
    assert.ok(lines.some((line) => /stage 3\/3 tick /.test(line)));
    assert.ok(
      lines.some((line) =>
        /done — probe 12 post\(s\), tick wrote 7 post\(s\), 0ms total/.test(line),
      ),
    );
  });

  it("resolves the full ChainResult — every stage outcome, tickNoop=false on a written tick", async () => {
    // The stepped clock brackets the whole chain: two reads, started + total.
    const clock = [T0, T0 + 750];
    const result: ChainResult = await runLinkedInChain({
      ...recordingLegs({}).legs,
      env: {},
      now: () => clock.shift() ?? T0 + 750,
    });
    assert.deepEqual(result, {
      login: HARVEST,
      probe: PROBE_PASS,
      tick: TICK_WROTE,
      tickNoop: false,
      totalMs: 750,
    });
  });
});

describe("the D2 cookie-path forwarding", () => {
  it("joins the harvested cookie path for stages 2-3 when the env lacks LINKEDIN_COOKIES_FILE (the first-ever run)", async () => {
    const { legs, recording } = recordingLegs({});
    const env: Env = { OTHER_TEST_VAR: "untouched" };
    await runLinkedInChain({ ...legs, env, now: () => T0 });
    assert.equal(recording.loginEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], undefined); // stage 1 runs on the bare env
    assert.equal(recording.probeEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], HARVEST.cookiePath); // the harvest feeds the gate
    assert.equal(recording.tickEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], HARVEST.cookiePath); // ...and the tick
    assert.equal(recording.probeEnvs[0]?.OTHER_TEST_VAR, "untouched"); // forwarding spreads, never replaces
    assert.equal(env[ENV_NAMES.linkedinCookiesFile], undefined); // the caller's env object was never mutated
  });

  it("leaves the env untouched when it already carries LINKEDIN_COOKIES_FILE — the operator's line wins", async () => {
    const { legs, recording } = recordingLegs({});
    const env: Env = { [ENV_NAMES.linkedinCookiesFile]: "C:/loker-secrets/live.json" };
    await runLinkedInChain({ ...legs, env, now: () => T0 });
    for (const captured of [...recording.probeEnvs, ...recording.tickEnvs]) {
      assert.equal(captured[ENV_NAMES.linkedinCookiesFile], "C:/loker-secrets/live.json");
    }
    assert.equal(
      recording.loginEnvs[0]?.[ENV_NAMES.linkedinCookiesFile],
      "C:/loker-secrets/live.json",
    );
  });

  it("keeps the env bare when the login result carries an empty cookiePath", async () => {
    const { legs, recording } = recordingLegs({
      login: async () => ({ cookiePath: "", dotEnvUpdated: false }),
    });
    await runLinkedInChain({ ...legs, env: {}, now: () => T0 });
    assert.equal(recording.probeEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], undefined);
    assert.equal(recording.tickEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], undefined);
  });
});

describe("failure arms", () => {
  it("aborts before the probe when the login leg throws — its error propagates untouched", async () => {
    const boom = new Error("login-linkedin: no LinkedIn session appeared within 5 min");
    const { legs, recording } = recordingLegs({
      login: async () => {
        throw boom;
      },
    });
    await assert.rejects(
      () => runLinkedInChain({ ...legs, env: {}, now: () => T0 }),
      (error: unknown) => error === boom,
    );
    assert.deepEqual(recording.order, ["login"]); // probe and tick never ran
  });

  it("aborts before the tick when the probe gate throws — the probe's error propagates untouched", async () => {
    const floor = new Error("probe: fewer than 10 posts — pagination did not prove out");
    const { legs, recording } = recordingLegs({
      probe: async () => {
        throw floor;
      },
    });
    await assert.rejects(
      () => runLinkedInChain({ ...legs, env: {}, now: () => T0 }),
      (error: unknown) => error === floor,
    );
    assert.deepEqual(recording.order, ["login", "probe"]); // the tick never ran
    assert.equal(recording.tickCalls, 0);
  });

  it("propagates a tick failure to the caller (the entry wrapper owns the exit)", async () => {
    const dead = new Error("fetch-linkedin: LEG DEAD — HTTP 401");
    const { legs } = recordingLegs({
      tick: async () => {
        throw dead;
      },
    });
    await assert.rejects(
      () => runLinkedInChain({ ...legs, env: {}, now: () => T0 }),
      (error: unknown) => error === dead,
    );
  });
});

describe("tick outcome classification (D3)", () => {
  it("reports a quiet-zero tick as a no-op — an outcome, never a failure", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const { legs } = recordingLegs({
      tick: async () => ({ wrote: false, pushed: false, postCount: 0 }),
    });
    const result = await runLinkedInChain({ ...legs, env: {}, now: () => T0 });
    assert.equal(result.tickNoop, true);
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.some((line) => /tick no-op — a quiet gate held/.test(line)));
    assert.ok(lines.some((line) => /done — probe 12 post\(s\), tick no-op,/.test(line)));
  });

  it("counts a written payload as an outcome even at 0 posts — tickNoop stays false", async () => {
    const { legs } = recordingLegs({
      tick: async () => ({ wrote: true, pushed: true, postCount: 0 }),
    });
    const result = await runLinkedInChain({ ...legs, env: {}, now: () => T0 });
    assert.equal(result.tickNoop, false);
  });
});
```

### README.md — MODIFY

The PC-leg steps gain the chain as the one-command path; the command block gains npm run linkedin-chain; the stale floor line 314 corrected to 10.

````
--- README.md:295-301 — INSERT (the chain as the one-command lead-in above the numbered steps)
 (unchanged) unconfigured identity fails the tick loudly instead of pushing nothing.
 
+One command runs the whole protocol — login hold, probe walk, exactly one
+fetch tick, in that order: `npm run linkedin-chain` (needs a real terminal;
+the login hold waits for Enter). The steps it sequences, for running them
+individually:
+
 1. `npm run login-linkedin` — opens a real Chrome window; log in by hand
    (2FA included). The helper waits for the session, writes the cookie

--- README.md:311-315 — MODIFY (floor drift: 2 -> 10)
 2. `npm run probe-linkedin` — twice, ≥6h apart, stored cookies only; walks
    the first configured surface read-only and exits 1 on a checkpoint
    wall (`probe: HALT`), a dead session (`probe: LEG DEAD`), a faulted
-   walk (`probe: FAILED`), or fewer than 2 posts. Re-run after every
+   walk (`probe: FAILED`), or fewer than 10 posts. Re-run after every
    `npm run login-linkedin` re-harvest.

--- README.md:351-359 — MODIFY (the command block: four -> five entries, the chain first)
-The four LinkedIn leg entries (PC only — no LLM_* or GMAIL_* needed for
+The five LinkedIn leg entries (PC only — no LLM_* or GMAIL_* needed for
 them, and the cookie file must exist):
 
 ```bash
+npm run linkedin-chain   # login hold -> probe -> exactly one tick, in order (real terminal)
 npm run login-linkedin   # headed login: writes the cookie file + the .env line
 npm run probe-linkedin   # browser-walk gate: exit 1 on a wall/dead/short walk
 npm run fetch-linkedin   # one tick: walk → payload → push
 npm run watch-linkedin   # the always-on loop: tick + 28-33-minute sleep
 ```
````

### AGENTS.md — MODIFY

The lint-list line 30, a new chain command bullet, the stale floor in the probe bullet, and a chain entry in the Architecture module list.

```
--- AGENTS.md:30 — MODIFY (lint list gains the chain; reset-linkedin was missing from this bullet — FLAGGED fold-in, matches package.json's real lint list)
-- `npm run lint` - Biome check over `src/`, `tests/`, `scripts/probe-judge.ts`, `scripts/fetch-linkedin.ts`, `scripts/watch-linkedin.ts`, `scripts/probe-linkedin.ts`, `scripts/login-linkedin.ts`, and `scripts/hooks`
+- `npm run lint` - Biome check over `src/`, `tests/`, `scripts/probe-judge.ts`, `scripts/fetch-linkedin.ts`, `scripts/watch-linkedin.ts`, `scripts/probe-linkedin.ts`, `scripts/login-linkedin.ts`, `scripts/reset-linkedin.ts`, `scripts/linkedin-chain.ts`, and `scripts/hooks`

--- AGENTS.md:36-39 — MODIFY (probe floor drift: 2 -> 10; context lines carry the file's two-space indent)
   walk of the first configured surface; exit 1 on a checkpoint wall
   (`probe: HALT`), a dead session (`probe: LEG DEAD`), a faulted walk
-  (`probe: FAILED`), or fewer than 2 posts; run twice >=6h apart with
+  (`probe: FAILED`), or fewer than 10 posts; run twice >=6h apart with
   stored cookies before trusting the loop (needs `LINKEDIN_COOKIES_FILE`)

--- AGENTS.md:51/52 — INSERT (the chain command bullet, after login-linkedin, before playwright install)
   without a new login)
+- `npm run linkedin-chain` - the one-command operator chain from a
+  dedicated clone of main: login hold -> probe gate -> exactly one fetch
+  tick, in that order; the login's harvested cookie file carries the
+  later stages when `.env` has no cookie line yet; a quiet-zero tick
+  (working-hours window, halt latch, halt trip, all-faulted walk, zero
+  surfaces) is a reported no-op with exit 0; any stage failure exits 1
+  naming the gate (needs a real TTY for the login hold)
 - `npx playwright install chromium` - one-time browser install for local runs

--- AGENTS.md:72-73 — MODIFY (FLAGGED fold-in: the storageState clause has no consumer — the walk factory rides the profile, src/linkedin-fetch.ts:324-365 has no storageState option)
 - `src/linkedin-session.ts` - the `LINKEDIN_COOKIES_FILE` resolver
   (fail-visible; the cookie file lives OUTSIDE the repo), the Cookie
-  header (JSESSIONID quoted, last), the csrf token, and the storageState
-  synthesis the walk's context factory consumes
+  header (JSESSIONID quoted, last), and the csrf token; the walk's
+  session rides the persistent profile — the cookie pair gates the run,
+  it never synthesizes a browser document anymore

--- AGENTS.md:74-78 — MODIFY (FLAGGED fold-in: the factory is headed on the persistent profile — src/linkedin-fetch.ts:330-332 headless:false launchPersistentContext)
 - `src/linkedin-fetch.ts` - the browser-walk fetch leg: a LinkedIn-local
-  `LinkedInContextFactory` (headless Chromium from its own dynamic-import
-  quarantine, the harvested cookie DOCUMENT completed per cookie, locale
-  en-US) walks each surface — one paced navigation (shared 5-15s gate)
+  `LinkedInContextFactory` (headed Chromium on the persistent profile via
+  `launchPersistentContext` — msedge channel, viewport null — from its
+  own dynamic-import quarantine; the session rides the PROFILE and locale
+  en-US pins the Load-more text selector) walks each surface — one paced
+  navigation (shared 5-15s gate)
   plus up to `scrollRounds` "Load more" clicks — parses every intercepted

--- AGENTS.md:101/102 — INSERT (the chain module bullet, after login-linkedin, before src/extract.ts)
   importing stays side-effect free)
+- `scripts/linkedin-chain.ts` - the one-command operator chain:
+  `runLinkedInChain(deps)` sequences login hold -> probe -> exactly one
+  tick; the merged env resolves once and threads to all three legs, and
+  the login's harvested cookie path joins it for stages 2-3 when the env
+  lacks `LINKEDIN_COOKIES_FILE`; quiet-zero ticks are reported no-ops
+  (exit 0); entry-guarded, importing stays side-effect free
 - `src/extract.ts` - parses posts from graphql XHR responses or `data-sjs` blobs
```

### .rpiv/guidance/architecture.md — MODIFY

The commands table: chain row added; the stale floor in the probe-linkedin row corrected.

```
--- .rpiv/guidance/architecture.md:15 — MODIFY (FLAGGED fold-in: the tree line's leg enumeration gains chain)
-, the PC-local LinkedIn leg (fetch/watch/probe/login), + Claude Code hooks
+, the PC-local LinkedIn leg (fetch/watch/probe/login/chain), + Claude Code hooks

--- .rpiv/guidance/architecture.md:41 — MODIFY (probe row floor drift: 2 -> 10)
-| `npm run probe-linkedin` | gate the LinkedIn browser walk: a read-only walk of the first configured surface; exit 1 on a checkpoint wall, a dead session, a faulted walk, or fewer than 2 posts |
+| `npm run probe-linkedin` | gate the LinkedIn browser walk: a read-only walk of the first configured surface; exit 1 on a checkpoint wall, a dead session, a faulted walk, or fewer than 10 posts |

--- .rpiv/guidance/architecture.md:42/43 — INSERT (the chain row, after the login row)
 | `npm run login-linkedin` | headed cookie harvest: the operator logs in by hand; writes the cookie file + the `.env` line |
+| `npm run linkedin-chain` | one-command operator chain: login hold -> probe -> exactly one fetch tick, in order, from a dedicated clone of main; a quiet-zero tick is a reported no-op (exit 0); any stage failure exits 1 naming the gate (real TTY for the login hold) |
 | `npx playwright install chromium` | one-time browser install for local runs |
```

### .rpiv/guidance/scripts/architecture.md — MODIFY

"Eight files" -> nine; the invoker line gains the chain and its exit contract; the probe block rewritten (entry-guarded runProbe export, headed persistent profile, floor 10); the exit-contract block gains the chain row and the corrected floor.

```
--- .rpiv/guidance/scripts/architecture.md:4 — MODIFY (Eight -> Nine; the leg gains chain; the chain clause inserted)
-Eight files, deliberately separate from src/ (the production watcher): `commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of ALL THREE commit-back steps (watch.yml's Commit state, the probe job's Commit ceilings, and watch.yml's Commit health), executed by the hosted write paths; `probe-judge.ts` measures the LLM endpoint's latency and per-account ceiling, then writes them to `state/judge-ceilings.json` (live-only, BEFORE the dead-account gate, plus a `probedAt` freshness stamp) from an Actions runner; `fetch-linkedin.ts` + `watch-linkedin.ts` + `probe-linkedin.ts` are the PC-local LinkedIn leg (tick, loop, gate); `login-linkedin.ts` is the headed cookie harvest; `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/ — the arrow points one way: scripts → src (the probe is a "zero-edit site" of judge.ts's API, measuring the EXACT production prompt).
+Nine files, deliberately separate from src/ (the production watcher): `commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of ALL THREE commit-back steps (watch.yml's Commit state, the probe job's Commit ceilings, and watch.yml's Commit health), executed by the hosted write paths; `probe-judge.ts` measures the LLM endpoint's latency and per-account ceiling, then writes them to `state/judge-ceilings.json` (live-only, BEFORE the dead-account gate, plus a `probedAt` freshness stamp) from an Actions runner; `fetch-linkedin.ts` + `watch-linkedin.ts` + `probe-linkedin.ts` + `linkedin-chain.ts` are the PC-local LinkedIn leg (tick, loop, gate, chain); `login-linkedin.ts` is the headed cookie harvest; `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/ — the arrow points one way: scripts → src (the probe is a "zero-edit site" of judge.ts's API, measuring the EXACT production prompt).

--- .rpiv/guidance/scripts/architecture.md:9 — INSERT (the chain invoker row, after the four-script line)
 - **fetch-linkedin.ts / watch-linkedin.ts / probe-linkedin.ts / login-linkedin.ts**: run via `npm run fetch-linkedin` / `watch-linkedin` / `probe-linkedin` / `login-linkedin` from a DEDICATED clone of main; exit contracts: tick = leg-dead exits 1 after the episode alarm (an all-faulted walk is a tagged no-op exit 0, payload untouched), loop = never exits on leg-dead, probe = gate exit 1, login = exit 1 on timeout/no session
+- **linkedin-chain.ts**: run via `npm run linkedin-chain` from a DEDICATED clone of main (stage 3's guardCheckout enforces branch main + a clean tree BEFORE any fetch — the chain code itself must be committed first); exit contract: 0 when all three stages ran — a quiet-zero tick (working-hours window, halt latch, halt trip, all-faulted walk, zero surfaces) is a REPORTED NO-OP, still exit 0 (the defb8af rule) — and 1 when any stage throws (the wrapper prints `linkedin-chain: FAILED - <gate and remedy>`); INTERACTIVE: the login hold reads Enter, so a real TTY is required

--- .rpiv/guidance/scripts/architecture.md:39-43 — MODIFY (the probe block rewrite: entry-guarded runProbe export, headed persistent profile, floors)
-probe-linkedin.ts            # .ts, top-level await gate: the production walk READ-ONLY — one headless
-                             #   context from the harvested cookie DOCUMENT, the FIRST configured surface,
-                             #   config.scrollRounds as the click bound; no payload write, no push, no latch,
-                             #   no episode-marker write;
+probe-linkedin.ts            # .ts, entry-guarded (importing stays side-effect free — the import IS the pin);
+                             #   exports runProbe / ProbeDeps / ProbeResult + the two TAGGED local gates
+                             #   (probeFloor / probeNoSurfaces + isProbe* guards): resolve config, pick the
+                             #   FIRST configured surface, preflight the cookie file (resolveLinkedInCookies
+                             #   — presence/parse only; the browser rides the PROFILE), then the HEADED
+                             #   persistent-profile production walk READ-ONLY — config.scrollRounds as the
+                             #   click bound, PROBE_MIN_CLICKS=5 as the click floor, PROBE_MIN_POSTS=10 as
+                             #   the gate; gate failures THROW (halt / leg-dead / all-faulted keep their
+                             #   tags, the local gates carry theirs — the caller owns the exit); no payload
+                             #   write, no push, no latch, no episode-marker write;
                              #   INSIDE typecheck + lint + lint-staged

--- .rpiv/guidance/scripts/architecture.md:48/49 — INSERT (the chain entry in the Structure block, after login-linkedin.ts, before hooks)
+linkedin-chain.ts            # .ts, entry-guarded (imports runLinkedInChain side-effect free); exports
+                             #   runLinkedInChain / ChainDeps / ChainResult; ONE command: login hold ->
+                             #   runProbe -> exactly one fetchTick; the merged env resolves ONCE (D2) and
+                             #   the login's harvested cookiePath joins it for stages 2-3 when the env
+                             #   lacks LINKEDIN_COOKIES_FILE; a quiet-zero tick is a reported no-op, exit 0
+                             #   (defb8af); INTERACTIVE (the login hold reads Enter);
+                             #   INSIDE typecheck + lint + lint-staged
 hooks/gate-destructive.js    # plain .js for bare node (instant start, no tsx); INSIDE lint ONLY — lint-staged's

--- .rpiv/guidance/scripts/architecture.md:88-91 — MODIFY (the exit-contract block: floor 10 + the chain row)
 watch entries               watch-linkedin.ts never exits on leg-dead; probe-linkedin.ts exits 1 on a checkpoint
                             wall (probe: HALT), a dead session (probe: LEG DEAD), a faulted walk (probe: FAILED),
-                            or fewer than 2 posts (gate)
+                            or fewer than 10 posts (gate)
+linkedin-chain.ts           exit 0 when all three stages ran — a quiet-zero tick (working-hours window, halt
+                            latch, halt trip, all-faulted walk, zero surfaces) is a REPORTED NO-OP, still
+                            exit 0 (defb8af); exit 1 when any stage throws — the wrapper prints
+                            `linkedin-chain: FAILED - <gate>`; INTERACTIVE (real TTY for the login hold)
 login-linkedin.ts           exit 1 on timeout (no session within the budget) or a failed poll/context — one alarm-free operator gate
```

### .rpiv/guidance/tests/architecture.md — MODIFY

The coverage map: probe-linkedin.test.ts and linkedin-chain.test.ts rows replace the NO-TESTS-BY-DESIGN probe clause.

```
--- .rpiv/guidance/tests/architecture.md:48-49 — MODIFY (the NO-TESTS-BY-DESIGN probe clause -> two suite rows; probe-judge keeps its clause)
-scripts/probe-judge.ts, probe-linkedin.ts — NO TESTS BY DESIGN: probe-judge drives a LIVE LLM endpoint (the
-#                                              #   dispatch gate is its check); probe-linkedin's run IS the gate
+scripts/probe-judge.ts — NO TESTS BY DESIGN: it drives a LIVE LLM endpoint (the dispatch gate is its check)
+probe-linkedin.ts  → probe-linkedin.test.ts   # the runProbe rewrite: entry-guard import pin, pass path under
+#                                             #   a pinned clock, the 10-post floor, the TAGGED local gates
+#                                             #   (floor, no-surfaces) disjoint from the walk's halt/leg-dead/
+#                                             #   all-faulted propagation, cookie preflight BEFORE any browser
+linkedin-chain.ts  → linkedin-chain.test.ts   # the recording-legs transcript: login -> probe -> EXACTLY one
+#                                             #   tick, abort arms by IDENTITY, the D2 cookiePath forwarding
+#                                             #   (env never mutated), the D3 quiet-zero noop vs written outcome
```

### .rpiv/guidance/src/architecture.md — MODIFY

The stale "headless-Chromium context factory" line corrected to the headed persistent-profile factory.

```
--- .rpiv/guidance/src/architecture.md:7 — MODIFY (the factory drift: headless -> headed persistent profile)
-- **playwright**: THREE dynamic-import quarantine sites — the chromium ContextFactory in fetch-threads.ts, the LinkedIn-local headless-Chromium context factory in linkedin-fetch.ts (own `await import("playwright")`), AND the login helper's headed `launchPersistentContext` in scripts/login-linkedin.ts; no new runtime dep
+- **playwright**: THREE dynamic-import quarantine sites — the chromium ContextFactory in fetch-threads.ts, the LinkedIn-local headed persistent-profile context factory in linkedin-fetch.ts (own `await import("playwright")`), AND the login helper's headed `launchPersistentContext` in scripts/login-linkedin.ts; no new runtime dep

--- .rpiv/guidance/src/architecture.md:121-125 — MODIFY (FLAGGED fold-in: same factory claim, second site in the spec-of-record block; src/linkedin-fetch.ts:324-365 is authoritative)
-// linkedin-fetch.ts: the browser walk — a LinkedIn-local LinkedInContextFactory (~120 lines duplicated
-// from the shared factory: widening breaks the 3 doubles under strictFunctionTypes, re-exporting the
-// private factory re-introduces knip N012; headless Chromium, own dynamic-import quarantine, the
-// harvested cookie DOCUMENT remapped per cookie — expires -1, httpOnly false, sameSite Lax — locale
-// en-US) walks each surface: one paced navigation (shared per-walk 5-15s gate, makePacingGate RESERVES
+// linkedin-fetch.ts: the browser walk — a LinkedIn-local LinkedInContextFactory (~120 lines duplicated
+// from the shared factory: widening breaks the 3 doubles under strictFunctionTypes, re-exporting the
+// private factory re-introduces knip N012; HEADED persistent-profile Chromium (launchPersistentContext,
+// msedge channel, viewport null — the session rides the PROFILE; the harvested cookie pair is only the
+// resolver's fail-visible gate, never a synthesized document), own dynamic-import quarantine, locale
+// en-US pins the Load-more text selector) walks each surface: one paced navigation (shared per-walk
+// 5-15s gate, makePacingGate RESERVES
```

## Slices

### Slice 1: runProbe extraction + its offline suite

**Files**: scripts/probe-linkedin.ts, tests/probe-linkedin.test.ts

#### Automated Verification:
- [ ] The new suite passes in isolation: `npx tsx --test tests/probe-linkedin.test.ts` (EXECUTED in a sandbox against the real src tree: 8 pass / 0 fail)
- [ ] Importing scripts/probe-linkedin.ts opens no browser, loads no config, reads no cookies (the entry-guard describe)
- [ ] runProbe resolves {postCount, elapsedMs} on a >= 10-post walk under a pinned clock
- [ ] runProbe throws the TAGGED floor gate (isProbeFloor) on a short walk, disjoint from isHalt/isLegDead/isAllSurfacesFaulted
- [ ] runProbe propagates isHalt + HALT_CHECKPOINT_REASON on a checkpoint URL, isLegDead on a silent walk, isAllSurfacesFaulted (faulted: 1) on a faulted walk
- [ ] runProbe throws the TAGGED no-surfaces gate (isProbeNoSurfaces) on a zero-linkedin config with zero browser builds
- [ ] runProbe rejects /LINKEDIN_COOKIES_FILE/ with env {} before any browser build (preflight precedes the walk)
- [ ] The banner line carries the config scrollRounds and the default minClicks 5; the factory receives LINKEDIN_PROFILE_DIR
- [ ] The CLI wrapper prints today's exact lines: bare message for the two local gates, probe: HALT / probe: LEG DEAD / probe: FAILED for the walk's arms, probe: FAILED fallback last

#### Manual Verification:
- [ ] `npm run probe-linkedin` behaves exactly as before from a terminal: same banner line, same elapsed line, same floor message, exit-1 HALT / LEG DEAD / FAILED arms — the CLI contract preserved byte-for-byte
- [ ] The neighboring script suites stay green: `npx tsx --test tests/fetch-linkedin.test.ts tests/watch-linkedin.test.ts tests/login-linkedin.test.ts` (nothing else imports the probe file — zero blast radius per the integration scan)

### Slice 2: the chain entry + npm wiring

**Files**: scripts/linkedin-chain.ts, package.json

#### Automated Verification:
- [ ] Type checking passes with the chain file present: `npx tsc --noEmit` (EXECUTED in the sandbox: clean)
- [ ] Biome clean: `npx biome check scripts/linkedin-chain.ts` (EXECUTED: clean)
- [ ] Importing scripts/linkedin-chain.ts runs no leg — no env read, no config load, no browser (EXECUTED import smoke: `GUARD-OK exports: runLinkedInChain`, zero other output)
- [ ] envWithDotEnv appears exactly once in scripts/linkedin-chain.ts (the D2 single-read pin)
- [ ] package.json carries the npm script "linkedin-chain" AND scripts/linkedin-chain.ts in both the lint and format lists (grep pins)
- [ ] Behavior pins (EXECUTED in the sandbox with injected legs, 6/6): call order is exactly login -> probe -> tick; the login's cookiePath joins the threaded env for stages 2-3 when the env lacks LINKEDIN_COOKIES_FILE; an env already carrying the key stays untouched; a probe throw aborts before the tick (tick never called); a tick throw propagates; quiet zeros set tickNoop=true while a written payload (even 0 posts) sets tickNoop=false

#### Manual Verification:
- [ ] `npm run linkedin-chain` from a real TTY on the dedicated clone (post-implement, committed tree): the login hold releases only on Enter, the browser closes, the probe prints its banner + elapsed line, exactly one tick runs, exit 0
- [ ] First-ever run (no LINKEDIN_COOKIES_FILE in .env beforehand): the harvested cookie path carries stages 2-3 without a manual re-run (the D2 amendment's point)
- [ ] A probe gate failure (expired session) exits 1 and names the gate; no navigation after the probe
- [ ] A quiet-zero tick prints the no-op line and exits 0 — never a failure

### Slice 3: the chain suite

**Files**: tests/linkedin-chain.test.ts

#### Automated Verification:
- [ ] The new suite passes in isolation: `npx tsx --test tests/linkedin-chain.test.ts` (EXECUTED in a sandbox against the real src tree: 11 pass / 0 fail)
- [ ] Importing scripts/linkedin-chain.ts runs no leg — no env read, no config load, no browser (the entry-guard describe)
- [ ] The call order is exactly login -> probe -> tick and the tick runs EXACTLY once (recording transcript + tickCalls === 1)
- [ ] A login throw aborts before the probe (order === ["login"]) and a probe throw aborts before the tick (order === ["login", "probe"], tickCalls === 0); all three throws propagate by IDENTITY (error === thrown)
- [ ] The D2 forwarding: the harvested cookiePath joins stages 2-3 only when the env lacks LINKEDIN_COOKIES_FILE; the caller's env object is never mutated; an env already carrying the key stays untouched; an empty cookiePath keeps the env bare
- [ ] The D3 outcome rule: a quiet-zero tick sets tickNoop=true and logs the no-op line; a written payload (even 0 posts) sets tickNoop=false
- [ ] ChainResult deepEquals {login, probe, tick, tickNoop, totalMs} under a stepped clock (totalMs 750)
- [ ] Biome clean: `npx biome check tests/linkedin-chain.test.ts scripts/linkedin-chain.ts` (EXECUTED: clean)
- [ ] Type checking passes: `npx tsc --noEmit` (EXECUTED: clean)

#### Manual Verification:
- [ ] The neighboring script suites stay green: `npx tsx --test tests/watch-linkedin.test.ts tests/login-linkedin.test.ts` (EXECUTED in the sandbox: exit 0)

### Slice 4: the doc sweep

**Files**: README.md, AGENTS.md, .rpiv/guidance/architecture.md, .rpiv/guidance/scripts/architecture.md, .rpiv/guidance/tests/architecture.md, .rpiv/guidance/src/architecture.md

#### Automated Verification:
- [ ] Whole-project gates (the terminal slice carries the baseline): `npm run typecheck && npm run lint && npm test`
- [ ] Floor drift gone from the docs: `grep -rn "fewer than 2 posts" README.md AGENTS.md .rpiv/guidance/` returns 0 matches (the probe file's own copy is fixed by Slice 1's rewrite)
- [ ] The chain is registered on all four surfaces: `grep -l "linkedin-chain" README.md AGENTS.md .rpiv/guidance/architecture.md .rpiv/guidance/scripts/architecture.md` names all four, and `grep -c "npm run linkedin-chain" README.md` returns >= 2 (protocol line + command block)
- [ ] Coverage map updated: `grep -n "NO TESTS BY DESIGN" .rpiv/guidance/tests/architecture.md` matches the probe-judge-only line; `grep -n "probe-linkedin.test.ts" .rpiv/guidance/tests/architecture.md` and `grep -n "linkedin-chain.test.ts" .rpiv/guidance/tests/architecture.md` both match
- [ ] "Nine files" landed: `grep -n "Nine files" .rpiv/guidance/scripts/architecture.md` matches; `grep -n "Eight files" .rpiv/guidance/scripts/architecture.md` returns 0
- [ ] Factory drift gone: `grep -rn "headless-Chromium" .rpiv/guidance/ AGENTS.md` and `grep -rn "cookie DOCUMENT" .rpiv/guidance/ AGENTS.md` both return 0 matches
- [ ] The probe block names the new contract: `grep -n "runProbe" .rpiv/guidance/scripts/architecture.md` and `grep -n "PROBE_MIN_POSTS=10" .rpiv/guidance/scripts/architecture.md` both match

#### Manual Verification:
- [ ] README's PC-leg section reads correctly top-to-bottom: the chain lead-in -> the three individual steps -> the five-entry command block; the floor says 10
- [ ] AGENTS.md Commands + Architecture list name the chain with the exit contract and the no-op rule; the module bullet sits between login-linkedin and src/extract.ts
- [ ] guidance/scripts' probe block matches the Slice 1 fence's header contract (entry-guarded runProbe, headed persistent profile, floor 10) — read both side by side
- [ ] No doc names a contract the code lacks: spot-check each chain claim against scripts/linkedin-chain.ts after implement lands Slices 1-3

## Desired End State

The operator, on the dedicated clone of main with a committed tree, runs:

    npm run linkedin-chain

The headed browser opens; the operator logs in by hand (2FA included); the helper harvests, writes the cookie file + the .env line, warms up the feed, and holds until Enter. Enter closes the browser; the probe walk runs against the first configured surface and prints its elapsed line; on pass exactly one tick runs — payload written and pushed — and the process exits 0. Outside the working window or with the latch set, the chain prints the no-op line and exits 0. A probe wall, a dead session, a mis-homed checkout, a dead leg, or a push failure prints which gate failed and exits 1. The watch loop stays a separate manual start, unchanged.

## File Map

    scripts/probe-linkedin.ts              # MODIFY — runProbe export behind the entry guard; CLI contract preserved
    tests/probe-linkedin.test.ts           # NEW — the probe rewrite's offline suite
    scripts/linkedin-chain.ts              # NEW — the one-command operator chain
    package.json                           # MODIFY — npm script + lint/format list entries
    tests/linkedin-chain.test.ts           # NEW — order/stop/failure/no-op offline pins
    README.md                              # MODIFY — chain steps + floor fix
    AGENTS.md                              # MODIFY — chain command + lint list + module entry + floor fix
    .rpiv/guidance/architecture.md         # MODIFY — commands table chain row + floor fix
    .rpiv/guidance/scripts/architecture.md # MODIFY — nine files, probe block rewrite, chain contract, floor fix
    .rpiv/guidance/tests/architecture.md   # MODIFY — coverage map rows for both new suites
    .rpiv/guidance/src/architecture.md     # MODIFY — headed factory line fix

## Ordering Constraints

Slice 1 -> Slice 2 -> Slice 3 -> Slice 4, strictly sequential. Slice 2 imports runProbe (Slice 1's export). Slice 3 imports runLinkedInChain (Slice 2's export) and rides the same doubles idioms. Slice 4 documents symbols that only exist after Slices 1-2. No parallel work. Each slice leaves the repo green: Slice 1 changes behavior of nothing else (nothing imports probe-linkedin.ts today — confirmed by the integration scan).

## Verification Notes

- Gates: npm run typecheck, npm run lint, npm test (whole-project baseline rides the terminal slice).
- Entry-guard pins: importing scripts/probe-linkedin.ts and scripts/linkedin-chain.ts in their suites opens no browser, loads no config, and starts no walk — the import IS the pin (tests/watch-linkedin.test.ts lines 9-11 idiom, plus the explicit describe block from tests/login-linkedin.test.ts).
- The probe CLI contract is preserved byte-for-byte: same banner line, same elapsed line, same HALT / LEG DEAD / FAILED / floor messages, exit 1 on every failure arm.
- Chain order pin: a recording-deps transcript asserting the exact call order ["login", "probe", "tick"].
- One-tick stop: tick called exactly once, no loop.
- Probe failure -> tick never called; tick failure -> nonzero; quiet zeros -> reported as no-op.
- Manual (from the solutions artifact): run the chain on the dedicated clone after the next login harvest (probe passes -> exactly one payload push -> exit 0); trip the probe gate deliberately (expired session) -> exits nonzero, no navigation after the probe; hold the login window open past the hold -> the LOCKED warning prints, no second browser launches.
- Risk-bearing behavior: the refactor must hoist ALL module-scope work into runProbe (the ea11969 lesson — a guard alone was insufficient before).
- Slice 2 verification ran IN-BAND (pi harness has no subagent tool — disclosed adaptation, established at Slice 1): the sandbox applied Slice 1's locked probe code from this artifact, wrote scripts/linkedin-chain.ts + two scratch probes, executed `npx tsc --noEmit` (clean), `npx biome check` (clean), an entry-guard import smoke (`GUARD-OK exports: runLinkedInChain`, zero side-effect output), and 6/6 behavior pins (order login->probe->tick; cookiePath forwarding; env-with-key untouched; probe-throw stops before the tick; tick-throw propagates; quiet-zero noop vs written-payload outcome), then restored the operator's uncommitted bytes byte-identical (git status unchanged). Update (Slice 4, 2026-11-12 session): the harness gained a working Agent tool — Slice 4's slice-verifier ran as a REAL subagent dispatch, twice (round 1: two VIOLATIONs fixed; round 2: Decisions OK / Cross-slice OK / one WARNING fixed); the in-band adaptation above applies to Slices 1-3 only.

## Performance Considerations

The chain adds zero extra navigations beyond the decided cadence (one login, one probe walk, one tick). The persistent profile tolerates one browser at a time — the tick runs only after runLoginHelper resolves (the finally block closes the context first). No new browser contexts, no new intervals, no polling beyond the legs' own.

## Migration Notes

None — no persisted schema changes, no state files touched. Behavioral note for the operator: npm run probe-linkedin and every other existing entry behave exactly as before; the chain is additive.

## Pattern References

- scripts/login-linkedin.ts:179-261 — runLoginHelper(deps) shape, the keep-open hold, the finally close, the entry guard.
- scripts/fetch-linkedin.ts:315-361, 413-424 — fetchTick deps surface, quiet-zero gates, the tagged-arm entry wrapper.
- scripts/watch-linkedin.ts:21, 48-59 — the composition entry this chain extends.
- scripts/reset-linkedin.ts:28-29 — the cross-script import precedent (probe-linkedin.ts gains its first importer).
- tests/watch-linkedin.test.ts:9-16 — the entry-guard import pin + recording doubles.
- tests/fetch-linkedin.test.ts — the contextFactory doubles, cardBody/idAt capture-shaped fixtures, scriptGit transcript-oracle style.
- .rpiv/guidance/scripts/architecture.md, "Adding a PC-local Script" — the 8-step recipe this design follows.

## Developer Context

- 2026-11-12 checkpoint (directional confirms, first pass): the four questions were answered "i dont understand" — re-explained in plain language (failure reporting, one .env read, no-op vs failure, doc fixes) — then locked: "All 4 as stated (Recommended)" -> D1-D4.
- 2026-11-12 checkpoint (probe tests): "Does the probe rewrite get its own small test file?" -> "Small probe suite (Recommended)" -> D5.
- 2026-11-12 design summary confirm -> "Proceed (Recommended)".
- 2026-11-12 decomposition confirm -> "Approve (Recommended)" (4 slices as listed).
- 2026-11-12 Slice 2 micro-checkpoint: the D2 amendment surfaced as a flagged addition during generation (verbatim D2 fails every first-ever chain run at the probe preflight) — developer ratified via "Approve (Recommended)".

## Design History

- Slice 1: runProbe extraction + its offline suite — approved as generated (2 verifier violations fixed in-loop: hermetic cookie env via OS-temp cookieEnv(), forward file mention removed from the header; plus an async-thunk transform fix caught by execution; suite executed 8/8 against the real walk module; slice-verifier verdict OK on re-audit)
- Slice 2: the chain entry + npm wiring — approved as generated (D2 amendment ratified at the micro-checkpoint: the login's cookiePath forwards to stages 2-3 when the env lacks LINKEDIN_COOKIES_FILE; verifier ran IN-BAND per the harness adaptation: tsc clean, biome clean, entry-guard import smoke, 6/6 behavior pins, the operator's uncommitted probe bytes restored byte-identical)
- Slice 3: the chain suite — approved as generated (11/11 executed in the sandbox: biome clean, tsc clean, neighbors green; two first-pass failures fixed in-loop — the throwing leg overrides replaced the recording doubles, so the abort-arm transcript was empty; record-then-delegate doubles fixed it. Slice 1 fence correction folded in: the artifact's locked probe fence carried a one-line biome format drift in isProbeFloor, now split to the canonical 3-line form — byte-format only, zero semantic change)
- Slice 4: the doc sweep — approved as generated (slice-verifier round 1: 2 VIOLATIONs fixed — AGENTS.md floor hunk missing the file two-space indents, doc em dash where the locked Slice 2 fence prints ASCII FAILED - ; round 2: Decisions OK / Cross-slice OK / Research WARNING fixed — README lead-in double blank; five flagged fold-ins ratified at the micro-checkpoint: AGENTS lint-list reset-linkedin, storageState-clause drop, AGENTS factory headed-profile, guidance tree /chain, guidance/src spec-block factory)

## References

- .rpiv/artifacts/solutions/2026-11-12_09-55-42_linkedin-operator-chain.md — the upstream solution (Option 1 selected, verdict pass).
- .rpiv/artifacts/research/2026-11-12_09-30-27_linkedin-scroll-pagination-session-hygiene.md — the chained research (chain decision, doc-drift findings).
- .rpiv/artifacts/discover/2026-11-12_07-50-38_linkedin-scroll-pagination-session-hygiene.md — the FRD (9 decisions, viewport-variant addendum).
- .rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md — the PC-local leg design whose shape this artifact mirrors.
- scripts/probe-linkedin.ts, scripts/login-linkedin.ts, scripts/fetch-linkedin.ts, scripts/watch-linkedin.ts, scripts/reset-linkedin.ts — the working-tree sources this design composes.
