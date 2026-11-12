---
date: 2026-11-12T15:41:06+0700
author: Yogiswara Utama
commit: 559ad54
branch: main
repository: loker-watcher
topic: "LinkedIn operator chain (login -> probe -> one fetch tick)"
tags: [plan, linkedin-chain, probe-linkedin, runProbe, scripts, pc-local]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-12_10-34-39_linkedin-operator-chain.md"
phase_count: 5
phases:
  - { n: 1, title: "runProbe extraction + its offline suite", files: ["scripts/probe-linkedin.ts", "tests/probe-linkedin.test.ts"], depends_on: [] }
  - { n: 2, title: "the chain entry + npm wiring", files: ["scripts/linkedin-chain.ts", "scripts/login-linkedin.ts", "package.json"], depends_on: [1] }
  - { n: 3, title: "the chain suite", files: ["tests/linkedin-chain.test.ts"], depends_on: [2] }
  - { n: 4, title: "the doc sweep", files: ["README.md", "AGENTS.md", ".rpiv/guidance/architecture.md", ".rpiv/guidance/scripts/architecture.md", ".rpiv/guidance/tests/architecture.md", ".rpiv/guidance/src/architecture.md"], depends_on: [3] }
  - { n: 5, title: "the session-hygiene fold-in (declared post-validate)", files: ["scripts/login-linkedin.ts", "src/linkedin-fetch.ts", "tests/login-linkedin.test.ts", "tests/fetch-linkedin.test.ts", "README.md", "AGENTS.md", ".rpiv/guidance/scripts/architecture.md"], depends_on: [4] }
last_updated: 2026-11-12T18:09:03+0700
last_updated_by: Kailee
last_updated_note: "post-validate revise: the login/linkedin-fetch changes folded into declared scope (new Phase 5) per the two commit blockers; NOT-DOING line corrected with declared exceptions; SCROLL_JS/msedge offline pins + live-rehearsal evidence added; the floor criterion's D4 contradiction dropped; artifacts-commit note added"
---

# LinkedIn Operator Chain Implementation Plan

## Overview

One PC-local command, `npm run linkedin-chain`, sequences the decided operator protocol inside one process: the login hold -> the probe walk -> on pass, exactly one fetch tick. `scripts/probe-linkedin.ts` stops running at import and exports `runProbe` behind the entry guard; the chain and the offline suites drive it. Six proven doc-drift claims are corrected in the same change.

Phasing inherits the design's `## Slices` 1:1 (slice-verifier approved at design 6.2). Success Criteria pass through unchanged. Per the design's Ordering Constraints the phases are strictly sequential: Phase 2 imports `runProbe` (Phase 1's export), Phase 3 imports `runLinkedInChain` (Phase 2's export), Phase 4 documents symbols that only exist after Phases 1-2. No parallel phases; each phase leaves the repo green.

## Desired End State

The operator, on the dedicated clone of main with a committed tree, runs:

    npm run linkedin-chain

The headed browser opens; the operator logs in by hand (2FA included); the helper harvests, writes the cookie file + the `.env` line, warms up the feed, and holds until Enter. Enter closes the browser; the probe walk runs against the first configured surface and prints its elapsed line; on pass exactly one tick runs — payload written and pushed — and the process exits 0. Outside the working window or with the latch set, the chain prints the no-op line and exits 0. A probe wall, a dead session, a mis-homed checkout, a dead leg, or a push failure prints which gate failed and exits 1. The watch loop stays a separate manual start, unchanged.

## What We're NOT Doing

- No timed cooldown (FR-4 dropped upstream), no auto-start of watch-linkedin, no new env vars or config keys.
- No hosted-run (GitHub Actions) changes — CI invokes no PC linkedin script.
- No probe subprocess shape (rejected upstream: spawnSync doubles lose the offline order pins), no slash-command shape (rejected: no TTY for the login leg).
- No LINKEDIN_RESPONSE_RE widening, no FR-2 stop-line visibility, no round-1 loadMore-0 skip — fixed scope riding from research, not options here.
- No change to fetchTick, the watch loop, or runLoginHelper's HARVEST semantics — the chain composes them as-is. DECLARED exceptions (the post-validate revise, 2026-11-12T18:09): runLoginHelper gains the additive keepOpen/enterWait deps (Phase 2's own fence calls keepOpen: true) plus the mandatory feed warm-up and --auto-close (Phase 5); the walk's factory gains channel "msedge" and SCROLL_JS the container-detection revision (Phase 5).

## Phase 1: runProbe extraction + its offline suite

### Overview

`scripts/probe-linkedin.ts` is the only linkedin entry without an export: it awaits `loadWatcherConfig` at module top level, filters surfaces, and runs the whole walk in a top-level try/catch with five `process.exit(1)` arms plus a pre-try zero-surfaces exit — importing the file runs the gate. This phase restructures the whole file: `runProbe(deps)` becomes the exported seam (gate failures THROW, the fetchTick model; `ProbeResult {postCount, elapsedMs}` on pass), the entry guard + `.catch` arm mapping lands at the bottom preserving today's CLI output byte-for-byte, and its own offline suite pins the rewrite with zero browser. All module-scope work moves inside the function — the ea11969 lesson: an entry guard alone was insufficient before. (D1, D5, D6.)

### Changes Required:

#### 1. The probe gate rewrite
**File**: `scripts/probe-linkedin.ts`
**Changes**: MODIFY — full-body restructure (~107 -> ~150 lines): `PROBE_MIN_CLICKS` and a new `PROBE_MIN_POSTS = 10` stay module-level; the two local gates (floor, no-surfaces) become tagged errors (name constant + factory + type guard, the halt/legDead idiom); `runProbe` / `ProbeDeps` / `ProbeResult` become exports; the top-level await, surfaces filter, cookie preflight, walk, floor check, and catch arms move inside `runProbe` (exits become throws, stdout lines preserved); the entry guard + `.catch` arm mapping lands at the bottom printing today's exact lines.

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

#### 2. The probe rewrite's offline suite
**File**: `tests/probe-linkedin.test.ts`
**Changes**: NEW — entry-guard import pin, pass path under a pinned clock (>= 10 posts), the tagged floor gate disjoint from the walk's tags, halt/leg-dead/all-faulted propagation, zero-surfaces rejection, cookie preflight before any browser build, and the production pass-through (scrollRounds rides config, minClicks defaults to 5, the profile dir reaches the factory). Hermetic: the cookie preflight runs the REAL resolver against an OS-temp cookie file (the login-linkedin suite idiom), never the operator's live path.

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

### Success Criteria:

#### Automated Verification:
- [x] The new suite passes in isolation: `npx tsx --test tests/probe-linkedin.test.ts` (EXECUTED in a sandbox against the real src tree: 8 pass / 0 fail)
- [x] Importing scripts/probe-linkedin.ts opens no browser, loads no config, reads no cookies (the entry-guard describe)
- [x] runProbe resolves {postCount, elapsedMs} on a >= 10-post walk under a pinned clock
- [x] runProbe throws the TAGGED floor gate (isProbeFloor) on a short walk, disjoint from isHalt/isLegDead/isAllSurfacesFaulted
- [x] runProbe propagates isHalt + HALT_CHECKPOINT_REASON on a checkpoint URL, isLegDead on a silent walk, isAllSurfacesFaulted (faulted: 1) on a faulted walk
- [x] runProbe throws the TAGGED no-surfaces gate (isProbeNoSurfaces) on a zero-linkedin config with zero browser builds
- [x] runProbe rejects /LINKEDIN_COOKIES_FILE/ with env {} before any browser build (preflight precedes the walk)
- [x] The banner line carries the config scrollRounds and the default minClicks 5; the factory receives LINKEDIN_PROFILE_DIR
- [x] The CLI wrapper prints today's exact lines: bare message for the two local gates, probe: HALT / probe: LEG DEAD / probe: FAILED for the walk's arms, probe: FAILED fallback last

#### Manual Verification:
- [ ] `npm run probe-linkedin` behaves exactly as before from a terminal: same banner line, same elapsed line, exit-1 HALT / LEG DEAD / FAILED arms byte-for-byte — the floor line is intentionally NEW (10-post wording, the D4 fix), so byte-for-byte applies to the arms, not the floor message
- [x] The neighboring script suites stay green: `npx tsx --test tests/fetch-linkedin.test.ts tests/watch-linkedin.test.ts tests/login-linkedin.test.ts` (nothing else imports the probe file — zero blast radius per the integration scan)

---

## Phase 2: the chain entry + npm wiring

### Overview

New PC-local entry `scripts/linkedin-chain.ts`: `runLinkedInChain(deps)` sequences the login hold -> runProbe -> exactly one fetchTick in that order, aborting on the first throw. The merged env resolves ONCE (D2) and threads to all three legs, with the ratified amendment: the login's harvested cookiePath joins the threaded env for stages 2-3 when the env lacks `LINKEDIN_COOKIES_FILE` (the first-ever run). The tick outcome is classified by result, not exit code (D3): quiet zeros are reported no-ops with exit 0; only a throw fails the chain. The dep surface defaults to closures over the real entries (D7). `package.json` registers the npm script and adds the file to both explicit lists.

### Changes Required:

#### 1. The operator chain entry
**File**: `scripts/linkedin-chain.ts`
**Changes**: NEW — `runLinkedInChain(deps)` (login hold -> runProbe -> exactly one fetchTick), `ChainDeps` / `ChainResult` exports, the D2 single `envWithDotEnv()` read + cookiePath forwarding (rides the login RESULT, no second env read), quiet-zero no-op reporting (exit 0), the entry wrapper's failure arm (`linkedin-chain: FAILED — <gate and remedy>`, exit 1), and the entry guard (the four-script idiom; importing stays side-effect free).

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
  // Blank counts as unset (the helper and the resolver both trim): a
  // LINKEDIN_COOKIES_FILE= (empty) .env line must not block the forwarding.
  const legEnv: Env =
    (env[ENV_NAMES.linkedinCookiesFile] ?? "").trim() === "" && cookiePath !== ""
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
    console.error(`linkedin-chain: FAILED — ${base}${detail}`);
    process.exit(1);
  });
}
```

#### 2. npm wiring
**File**: `package.json`
**Changes**: MODIFY — the npm script `"linkedin-chain"` inserted after `"reset-linkedin"` before `"prepare"`, plus `scripts/linkedin-chain.ts` inserted after `scripts/reset-linkedin.ts` in the lint list and appended to the format list at the same position.

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

#### 3. The login dep the chain's fence requires
**File**: `scripts/login-linkedin.ts`
**Changes**: MODIFY — additive only (declared by the post-validate revise; the code already exists in the tree and is tested): `LoginHelperDeps` gains the optional `keepOpen` (the chain's default closure passes `keepOpen: true`) and `enterWait` (production default: a stdin readline; tests inject). The Phase 2 fence above calls `runLoginHelper({ env: legEnv, keepOpen: true })`, so this interface change is load-bearing for Phase 2's own code — without it the fence does not typecheck. The harvest semantics (env, poll, cookie write, .env upsert) are untouched; the NOT-DOING line's intent holds for them.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes with the chain file present: `npx tsc --noEmit` (EXECUTED in the sandbox: clean)
- [x] Biome clean: `npx biome check scripts/linkedin-chain.ts` (EXECUTED: clean)
- [x] Importing scripts/linkedin-chain.ts runs no leg — no env read, no config load, no browser (EXECUTED import smoke: `GUARD-OK exports: runLinkedInChain`, zero other output)
- [x] envWithDotEnv appears exactly once in scripts/linkedin-chain.ts (the D2 single-read pin)
- [x] package.json carries the npm script "linkedin-chain" AND scripts/linkedin-chain.ts in both the lint and format lists (grep pins)
- [x] Behavior pins (EXECUTED in the sandbox with injected legs, 6/6): call order is exactly login -> probe -> tick; the login's cookiePath joins the threaded env for stages 2-3 when the env lacks LINKEDIN_COOKIES_FILE; an env already carrying the key stays untouched; a probe throw aborts before the tick (tick never called); a tick throw propagates; quiet zeros set tickNoop=true while a written payload (even 0 posts) sets tickNoop=false
- [x] LoginHelperDeps carries the optional keepOpen + enterWait; the chain's default closure typechecks: `npx tsc --noEmit` (clean — validate 2026-11-12)
- [x] tests/login-linkedin.test.ts pins the keep-open order (Enter awaited BEFORE close): passing in the full suite (580/580 — validate 2026-11-12)

#### Manual Verification:
- [ ] `npm run linkedin-chain` from a real TTY on the dedicated clone (post-implement, committed tree): the login hold releases only on Enter, the browser closes, the probe prints its banner + elapsed line, exactly one tick runs, exit 0
- [ ] With the login window held open past the hold (Enter not pressed): the LOCKED profile-lock warning prints and no second browser launches — the probe and tick stay queued behind runLoginHelper's finally-close
- [ ] First-ever run (no LINKEDIN_COOKIES_FILE in .env beforehand): the harvested cookie path carries stages 2-3 without a manual re-run (the D2 amendment's point)
- [ ] A probe gate failure (expired session) exits 1 and names the gate; no navigation after the probe
- [ ] A quiet-zero tick prints the no-op line and exits 0 — never a failure

---

## Phase 3: the chain suite

### Overview

`tests/linkedin-chain.test.ts` pins the chain offline: the recording-legs transcript IS the oracle. Pins the order (login -> probe -> EXACTLY one tick, then stop), the abort arms by error IDENTITY, the D2 cookiePath forwarding (the caller's env object never mutated), the D3 outcome rule (a quiet-zero tick is a reported no-op; a written payload — even 0 posts — is an outcome, never a noop), and the entry-guard import pin. Zero browser, zero git, zero network, zero ambient env: every leg is an injected recording double and the clock is pinned.

### Changes Required:

#### 1. The chain's offline pins
**File**: `tests/linkedin-chain.test.ts`
**Changes**: NEW — recording legs that record FIRST then delegate (a throwing override still lands in the transcript, so the abort arms pin exactly how far the chain got), the entry-guard import pin, the order + one-tick-stop transcript, the full ChainResult deepEqual under a stepped clock (totalMs 750), the three D2 forwarding pins, the three abort arms, and the two D3 classification pins.

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

### Success Criteria:

#### Automated Verification:
- [x] The new suite passes in isolation: `npx tsx --test tests/linkedin-chain.test.ts` (EXECUTED in a sandbox against the real src tree: 11 pass / 0 fail)
- [x] Importing scripts/linkedin-chain.ts runs no leg — no env read, no config load, no browser (the entry-guard describe)
- [x] The call order is exactly login -> probe -> tick and the tick runs EXACTLY once (recording transcript + tickCalls === 1)
- [x] A login throw aborts before the probe (order === ["login"]) and a probe throw aborts before the tick (order === ["login", "probe"], tickCalls === 0); all three throws propagate by IDENTITY (error === thrown)
- [x] The D2 forwarding: the harvested cookiePath joins stages 2-3 only when the env lacks LINKEDIN_COOKIES_FILE; the caller's env object is never mutated; an env already carrying the key stays untouched; an empty cookiePath keeps the env bare
- [x] The D3 outcome rule: a quiet-zero tick sets tickNoop=true and logs the no-op line; a written payload (even 0 posts) sets tickNoop=false
- [x] ChainResult deepEquals {login, probe, tick, tickNoop, totalMs} under a stepped clock (totalMs 750)
- [x] Biome clean: `npx biome check tests/linkedin-chain.test.ts scripts/linkedin-chain.ts` (EXECUTED: clean)
- [x] Type checking passes: `npx tsc --noEmit` (EXECUTED: clean)

#### Manual Verification:
- [x] The neighboring script suites stay green: `npx tsx --test tests/watch-linkedin.test.ts tests/login-linkedin.test.ts` (EXECUTED in the sandbox: exit 0)

---

## Phase 4: the doc sweep

### Overview

The chain is registered on every doc surface and the six proven drift claims are corrected (D4): the probe floor is 10 everywhere (README, AGENTS, guidance root, guidance scripts, and the probe's own header — the last fixed by Phase 1's rewrite), the walk factory is headed on the persistent profile (guidance/scripts + guidance/src + AGENTS.md flagged fold-ins), the "top-level await gate" claim goes with the refactor, "Eight files" becomes nine, the NO-TESTS-BY-DESIGN probe clause becomes two suite rows, and the storageState clause with no consumer is dropped.

### Changes Required:

#### 1. README.md
**File**: `README.md`
**Changes**: MODIFY — the chain becomes the one-command lead-in above the numbered PC-leg steps; the stale floor line (2 -> 10); the command block gains the chain entry (four -> five LinkedIn leg entries).

````
--- README.md:295-301 — INSERT (the chain as the one-command lead-in above the numbered steps)
 (unchanged) unconfigured identity fails the tick loudly instead of pushing nothing.
 
+One command runs the whole protocol — login hold, probe walk, exactly one
+fetch tick, in that order: `npm run linkedin-chain` (needs a real terminal;
+the login hold waits for Enter). The login and probe steps it sequences, for
+running them individually:
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

#### 2. AGENTS.md
**File**: `AGENTS.md`
**Changes**: MODIFY — the lint-list line gains the chain (plus the flagged reset-linkedin fold-in), a new chain command bullet, the stale probe floor fixed (2 -> 10), the flagged storageState-clause drop, the flagged headed-profile factory fix in the linkedin-fetch bullet, and a chain entry in the Architecture module list.

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

#### 3. Guidance root architecture
**File**: `.rpiv/guidance/architecture.md`
**Changes**: MODIFY — the commands table gains the chain row, the probe row's floor fixed (2 -> 10), and the flagged tree-line fold-in gains the chain in the leg enumeration.

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
#### 4. Guidance scripts architecture
**File**: `.rpiv/guidance/scripts/architecture.md`
**Changes**: MODIFY — "Eight files" -> nine (the leg gains chain); the invoker line gains the chain and its exit contract; the probe block rewritten to the Slice 1 contract (entry-guarded runProbe export, headed persistent profile, PROBE_MIN_POSTS=10); the exit-contract block gains the chain row and the corrected floor.

```
--- .rpiv/guidance/scripts/architecture.md:4 — MODIFY (Eight -> Nine; the leg gains chain; the chain clause inserted)
-Eight files, deliberately separate from src/ (the production watcher): `commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of ALL THREE commit-back steps (watch.yml's Commit state, the probe job's Commit ceilings, and watch.yml's Commit health), executed by the hosted write paths; `probe-judge.ts` measures the LLM endpoint's latency and per-account ceiling, then writes them to `state/judge-ceilings.json` (live-only, BEFORE the dead-account gate, plus a `probedAt` freshness stamp) from an Actions runner; `fetch-linkedin.ts` + `watch-linkedin.ts` + `probe-linkedin.ts` are the PC-local LinkedIn leg (tick, loop, gate); `login-linkedin.ts` is the headed cookie harvest; `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/ — the arrow points one way: scripts → src (the probe is a "zero-edit site" of judge.ts's API, measuring the EXACT production prompt).
+Nine files, deliberately separate from src/ (the production watcher): `commit-state-rebase.sh` is PRODUCTION RUNTIME — the body of ALL THREE commit-back steps (watch.yml's Commit state, the probe job's Commit ceilings, and watch.yml's Commit health), executed by the hosted write paths; `probe-judge.ts` measures the LLM endpoint's latency and per-account ceiling, then writes them to `state/judge-ceilings.json` (live-only, BEFORE the dead-account gate, plus a `probedAt` freshness stamp) from an Actions runner; `fetch-linkedin.ts` + `watch-linkedin.ts` + `probe-linkedin.ts` + `linkedin-chain.ts` are the PC-local LinkedIn leg (tick, loop, gate, chain); `login-linkedin.ts` is the headed cookie harvest; `hooks/gate-destructive.js` and `hooks/format-on-edit.js` are Claude Code stdin hooks. Nothing here is imported by src/ — the arrow points one way: scripts → src (the probe is a "zero-edit site" of judge.ts's API, measuring the EXACT production prompt).

--- .rpiv/guidance/scripts/architecture.md:9 — INSERT (the chain invoker row, after the four-script line)
 - **fetch-linkedin.ts / watch-linkedin.ts / probe-linkedin.ts / login-linkedin.ts**: run via `npm run fetch-linkedin` / `watch-linkedin` / `probe-linkedin` / `login-linkedin` from a DEDICATED clone of main; exit contracts: tick = leg-dead exits 1 after the episode alarm (an all-faulted walk is a tagged no-op exit 0, payload untouched), loop = never exits on leg-dead, probe = gate exit 1, login = exit 1 on timeout/no session
+- **linkedin-chain.ts**: run via `npm run linkedin-chain` from a DEDICATED clone of main (stage 3's guardCheckout enforces branch main + a clean tree BEFORE any fetch — the chain code itself must be committed first); exit contract: 0 when all three stages ran — a quiet-zero tick (working-hours window, halt latch, halt trip, all-faulted walk, zero surfaces) is a REPORTED NO-OP, still exit 0 (the defb8af rule) — and 1 when any stage throws (the wrapper prints `linkedin-chain: FAILED — <gate and remedy>`); INTERACTIVE: the login hold reads Enter, so a real TTY is required

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
+linkedin-chain.ts            # .ts, entry-guarded (imports the three legs side-effect free); exports
+                             #   runLinkedInChain / ChainDeps / ChainResult; ONE command: login hold ->
+                             #   runProbe -> exactly one fetchTick; the merged env resolves ONCE (D2) and
+                             #   the login's harvested cookiePath joins it for stages 2-3 when the env
+                             #   lacks LINKEDIN_COOKIES_FILE; a quiet-zero tick is a reported no-op, exit 0
+                             #   (defb8af); INTERACTIVE (the login hold reads Enter);
+                             #   INSIDE typecheck + lint + lint-staged
                             #   from src/env-file.ts since the Phase 9 hoist); INSIDE typecheck + lint + lint-staged
 hooks/gate-destructive.js    # plain .js for bare node (instant start, no tsx); INSIDE lint ONLY — lint-staged's

--- .rpiv/guidance/scripts/architecture.md:88-91 — MODIFY (the exit-contract block: floor 10 + the chain row)
 watch entries               watch-linkedin.ts never exits on leg-dead; probe-linkedin.ts exits 1 on a checkpoint
                             wall (probe: HALT), a dead session (probe: LEG DEAD), a faulted walk (probe: FAILED),
-                            or fewer than 2 posts (gate)
+                            or fewer than 10 posts (gate)
+linkedin-chain.ts           exit 0 when all three stages ran — a quiet-zero tick (working-hours window, halt
+                            latch, halt trip, all-faulted walk, zero surfaces) is a REPORTED NO-OP, still
+                            exit 0 (defb8af); exit 1 when any stage throws — the wrapper prints
+                            `linkedin-chain: FAILED — <gate>`; INTERACTIVE (real TTY for the login hold)
 login-linkedin.ts           exit 1 on timeout (no session within the budget) or a failed poll/context — one alarm-free operator gate
```

#### 5. Guidance tests architecture
**File**: `.rpiv/guidance/tests/architecture.md`
**Changes**: MODIFY — the coverage map: probe-linkedin.test.ts and linkedin-chain.test.ts rows replace the NO-TESTS-BY-DESIGN probe clause (probe-judge keeps its clause).

```
--- .rpiv/guidance/tests/architecture.md:48-49 — MODIFY (the NO-TESTS-BY-DESIGN probe clause -> two suite rows; probe-judge keeps its clause)
-scripts/probe-judge.ts, probe-linkedin.ts — NO TESTS BY DESIGN: probe-judge drives a LIVE LLM endpoint (the
#                                              #   dispatch gate is its check); probe-linkedin's run IS the gate
+scripts/probe-judge.ts — NO TESTS BY DESIGN: it drives a LIVE LLM endpoint (the dispatch gate is its check)
+probe-linkedin.ts  → probe-linkedin.test.ts   # the runProbe rewrite: entry-guard import pin, pass path under
+#                                             #   a pinned clock, the 10-post floor, the TAGGED local gates
+#                                             #   (floor, no-surfaces) disjoint from the walk's halt/leg-dead/
+#                                             #   all-faulted propagation, cookie preflight BEFORE any browser
+linkedin-chain.ts  → linkedin-chain.test.ts   # the recording-legs transcript: login -> probe -> EXACTLY one
+#                                             #   tick, abort arms by IDENTITY, the D2 cookiePath forwarding
+#                                             #   (env never mutated), the D3 quiet-zero noop vs written outcome
```

#### 6. Guidance src architecture
**File**: `.rpiv/guidance/src/architecture.md`
**Changes**: MODIFY — the stale "headless-Chromium context factory" claims corrected to the headed persistent-profile factory (the playwright quarantine line + the spec-of-record block's flagged fold-in), and the flagged closing leg-enumeration fold-in ((tick, loop, gate, login) gains chain).

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

--- .rpiv/guidance/src/architecture.md:146 — MODIFY (the spec-block closing line's leg enumeration gains chain)
-// The PC scripts themselves live in scripts/ (tick, loop, gate, login) — see
+// The PC scripts themselves live in scripts/ (tick, loop, gate, login, chain) — see
```

### Success Criteria:

#### Automated Verification:
- [x] Whole-project gates (the terminal slice carries the baseline): `npm run typecheck && npm run lint && npm test`
- [x] Floor drift gone from the docs: `grep -rn "fewer than 2 posts" README.md AGENTS.md .rpiv/guidance/` returns 0 matches (the probe file's own copy is fixed by Slice 1's rewrite)
- [x] The chain is registered on all four surfaces: `grep -l "linkedin-chain" README.md AGENTS.md .rpiv/guidance/architecture.md .rpiv/guidance/scripts/architecture.md` names all four, and `grep -c "npm run linkedin-chain" README.md` returns >= 2 (protocol line + command block)
- [x] Coverage map updated: `grep -n "NO TESTS BY DESIGN" .rpiv/guidance/tests/architecture.md` matches the probe-judge-only line; `grep -n "probe-linkedin.test.ts" .rpiv/guidance/tests/architecture.md` and `grep -n "linkedin-chain.test.ts" .rpiv/guidance/tests/architecture.md` both match
- [x] "Nine files" landed: `grep -n "Nine files" .rpiv/guidance/scripts/architecture.md` matches; `grep -n "Eight files" .rpiv/guidance/scripts/architecture.md` returns 0
- [x] Factory drift gone: `grep -rn "headless-Chromium" .rpiv/guidance/ AGENTS.md` and `grep -rn "cookie DOCUMENT" .rpiv/guidance/ AGENTS.md` both return 0 matches
- [x] The probe block names the new contract: `grep -n "runProbe" .rpiv/guidance/scripts/architecture.md` and `grep -n "PROBE_MIN_POSTS=10" .rpiv/guidance/scripts/architecture.md` both match

#### Manual Verification:
- [x] README's PC-leg section reads correctly top-to-bottom: the chain lead-in -> the three individual steps -> the five-entry command block; the floor says 10
- [x] AGENTS.md Commands + Architecture list name the chain with the exit contract and the no-op rule; the module bullet sits between login-linkedin and src/extract.ts
- [x] guidance/scripts' probe block matches the Slice 1 fence's header contract (entry-guarded runProbe, headed persistent profile, floor 10) — read both side by side
- [x] No CHAIN doc names a contract the chain code lacks: spot-check each chain claim against scripts/linkedin-chain.ts after implement lands Phases 1-3 (chain claims only — the standalone-login Enter hold slipped past exactly this scoping and is Phase 5's doc-drift criterion)

---

## Phase 5: the session-hygiene fold-in (declared post-validate)

### Overview

The tree carries verified-but-undeclared production changes: the login helper's mandatory feed warm-up + keep-open hold + `--auto-close`, and the walk's `channel: "msedge"` + SCROLL_JS container-detection revision. The validate gate (2026-11-12_17-52-38) flagged them as out-of-plan writes; the developer blocked the commit until they are declared scope WITH verification. The production code is already in the tree and live-rehearsed (2026-11-12: close-without-feed tripped the checkpoint twice; feed-first passed twice — the protocol record lives in the code comments and the research artifact). This phase's NEW work is only the missing offline pins for the two live-only revisions, the --auto-close decision seam, and the standalone-login doc drift fix. Everything else is declaration.

### Changes Required:

#### 1. Offline pins for the live-only revisions
**File**: `src/linkedin-fetch.ts` + `tests/fetch-linkedin.test.ts`
**Changes**: MODIFY — export `SCROLL_JS` (a string constant; exporting breaks no consumer) and pin its string CONTENT offline: the four candidate selectors (the window scrollingElement, `main`, the lazy column, `.scaffold-finite-scroll`) and the JSON return shape (sel/top/sh/ch, sel "none" when nothing qualifies). The travel-desc sort runs inside page.evaluate — the offline doubles return canned values, so no offline pin can observe it; sort correctness stays with the live rehearsal. Knip note (verified 2026-11-12): knip sits in NO gate — not in devDependencies, not in .github/ or .husky, no config file — the guidance's N012 warning is historical rationale for the duplicated factory, so this test-only export is safe. Plus the msedge source pins in both factories.

#### 2. The standalone-login doc drift fix
**File**: `README.md` + `AGENTS.md` + `.rpiv/guidance/scripts/architecture.md`
**Changes**: MODIFY — standalone `npm run login-linkedin` now holds for Enter before closing the browser (keep-open defaults ON at the CLI; `--auto-close` restores the old fire-and-close behavior). Name the hold and the escape in: README PC-leg step 1, the AGENTS.md login command row, and the guidance/scripts login rows (invoker line, structure block, exit-contract block).

#### 3. The --auto-close decision seam
**File**: `scripts/login-linkedin.ts` + `tests/login-linkedin.test.ts`
**Changes**: MODIFY — the CLI's keep-open decision (`keepOpen: !process.argv.includes("--auto-close")`) is inline branch logic with no pin. Export a one-liner `keepOpenForArgv(argv: string[]): boolean` (default true, the flag false), use it in the entry arm, and pin both arms in tests/login-linkedin.test.ts (the repo rule: export the logic, not a side effect).

### Success Criteria:

#### Automated Verification:
- [x] SCROLL_JS is exported from src/linkedin-fetch.ts, and tests/fetch-linkedin.test.ts pins the string CONTENT: the four candidate selectors (the window scrollingElement, main, the lazy column, .scaffold-finite-scroll) and the sel/top/sh/ch return shape — the travel-desc SORT runs inside page.evaluate, so no offline pin can observe it; sort correctness stays with the live rehearsal
- [x] `grep -n 'channel: "msedge"' src/linkedin-fetch.ts scripts/login-linkedin.ts` matches BOTH files (one hit each)
- [x] keepOpenForArgv is exported and pinned both ways in tests/login-linkedin.test.ts: default (no flag) true, --auto-close false
- [x] The standalone entry arm reads `runLoginHelper({ keepOpen: keepOpenForArgv(process.argv) })` — no inline flag logic remains
- [x] Whole-project gates stay green: `npm run typecheck && npm run lint && npm test`

#### Manual Verification:
- [ ] The session-hygiene commit message cites the recorded 2026-11-12 live rehearsal (checkpoint A/B: close-without-feed tripped the checkpoint twice, feed-first passed twice) — the record is verified on disk: the discover artifact carries the A/B counts (its "verified protocol" and "Rationale" lines), the research artifact carries the kick mechanism (the "repeated login->probe storms" answer), and the code comments carry the protocol
- [x] README step 1, the AGENTS.md login row, and the guidance/scripts login rows all name the standalone Enter hold and the --auto-close escape

---

## Testing Strategy

### Automated:
- Phase 1: `npx tsx --test tests/probe-linkedin.test.ts`
- Phase 5: the SCROLL_JS shape pins + the msedge grep pins (the Phase 5 criteria)
- Phase 2: `npx tsc --noEmit` + `npx biome check scripts/linkedin-chain.ts` + the package.json/entry-guard grep pins
- Phase 3: `npx tsx --test tests/linkedin-chain.test.ts` + `npx biome check tests/linkedin-chain.test.ts scripts/linkedin-chain.ts`
- Whole-project gates ride the terminal phase: `npm run typecheck && npm run lint && npm test`
- Whole-plan: validate re-runs the three project gates over the finished tree (the design's gates: typecheck, lint, test — the offline suite stays deterministic and browser-free)

### Manual Testing Steps:
1. Run the chain on the dedicated clone after the next login harvest: probe passes -> exactly one payload push -> exit 0
2. Trip the probe gate deliberately (expired session) -> exits nonzero, no navigation after the probe
3. Hold the login window open past the hold -> the LOCKED warning prints, no second browser launches
4. Probe CLI contract preserved byte-for-byte from a terminal (same banner, elapsed, floor, HALT / LEG DEAD / FAILED arms)
5. First-ever chain run (no LINKEDIN_COOKIES_FILE in .env beforehand): the harvested cookie path carries stages 2-3 without a manual re-run
6. Standalone `npm run login-linkedin`: the Enter hold prints, and `--auto-close` restores fire-and-close (Phase 5)

## Performance Considerations

The chain adds zero extra navigations beyond the decided cadence (one login, one probe walk, one tick). The persistent profile tolerates one browser at a time — the tick runs only after runLoginHelper resolves (the finally block closes the context first). No new browser contexts, no new intervals, no polling beyond the legs' own.

## Migration Notes

Commit the artifacts WITH the code: this plan file (corrupted once mid-run and rebuilt — the reconstruction is the only surviving record of the approved scope) plus the design, research, discover, and solutions artifacts land in the same push as their implementation. No persisted schema changes, no state files touched. Behavioral note for the operator: npm run probe-linkedin and every other existing entry behave exactly as before; the chain is additive. Hard runtime constraint (unchanged): guardCheckout requires a clean committed main checkout — the chain code must be committed before the chain runs.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| coverage | ## Testing Strategy ## Manual Testing Steps §3 | <n/a> | blocker | verification-coverage | Step "Hold the login window open past the hold -> the LOCKED warning prints, no second browser launches" (same intent also carried by design ## Verification Notes §7's third manual sub-check) — criteria: NOT FOUND (Phase 2's Manual Verification bullet 1 pins only the Enter-release path "the login hold releases only on Enter"; no bullet in any phase names the LOCKED warning or the no-second-browser invariant); code: NOT FOUND (the Phase 2 fence's `keepOpen: true` closure and sequential awaits touch the hold without mirroring either assertion). Severity rides the must-not clause "no second browser launches"; the warning-print half alone would be concern-grade | Add a manual bullet under Phase 2's `#### Manual Verification:` — "With the login window held open past the hold (Enter not pressed): the LOCKED profile-lock warning prints and no second browser launches — the probe and tick stay queued behind runLoginHelper's finally-close" | applied: added the LOCKED-warning / no-second-browser manual bullet to Phase 2 |
| code | Phase 2 §1 (linkedin-chain.ts) | scripts/login-linkedin.ts:181 | concern | code-quality | The D2 forwarding gates on `env[ENV_NAMES.linkedinCookiesFile] === undefined` only, but `runLoginHelper` (`.trim()` check) and `resolveLinkedInCookies` both treat a blank value as unset — with a `LINKEDIN_COOKIES_FILE=` (empty) .env line the fresh harvest is not forwarded and stage 2 still dies with "LINKEDIN_COOKIES_FILE is not set", defeating the amendment's first-ever-run guarantee | Mirror the helper's trim check in the forwarding condition: treat `""` like `undefined` (`env[...]?.trim() === undefined \|\| env[...].trim() === ""`) before joining `cookiePath` | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-11-12_10-34-39_linkedin-operator-chain.md — blank counts as unset in the D2 forwarding) |
| code | Phase 2 §1 (linkedin-chain.ts) | scripts/watch-linkedin.ts:88 | concern | codebase-fit | The wrapper prints `linkedin-chain: FAILED - ${base${detail` with an ASCII hyphen while every sibling wrapper prints `FAILED — ` (em dash — fetch-linkedin.ts:422, login-linkedin.ts:258, reset-linkedin.ts:103) and guidance/scripts "Adding a PC-local Script" step 5 documents `FAILED — <message>`; the fence's own header comment also claims the em-dash form, contradicting the code ten lines below | Print `linkedin-chain: FAILED — ` with the em dash so the wrapper matches its own header comment and the six-script `FAILED — <message>` convention | applied: chain code line + plan prose + both guidance/scripts doc spots flipped to the em-dash form (design follow-up: .rpiv/artifacts/designs/2026-11-12_10-34-39_linkedin-operator-chain.md) |
| code | Phase 1 §2 (tests/probe-linkedin.test.ts) | tests/fetch-linkedin.test.ts:765 | suggestion | code-quality | The trimmed double keeps the click machinery (`loadMoreVisible`, `clickBodies`, `settleArmed`) but no test drives a click, so `scrollRounds`/`minClicks` pass-through into `fetchLinkedInPosts` is pinned only via banner strings — unlike the cited fetch suite, which pins scrollRounds by asserting the clicks transcript (`the knob, not the dry-round exit, stopped the loop`) | Drive one click path (`loadMoreVisible: () => true` + `clickBodies`) asserting the dry exit honors `minClicks`, or delete the unexercised double branches | dismissed: the trimmed double is deliberate per D5 (the design suite is locked, executed 8/8); the banner assertion pins the minClicks default; plan does not invent test code outside the design |
| code | Phase 4 §1 (README.md) | README.md:316 | suggestion | code-quality | The inserted lead-in says "The steps it sequences, for running them individually:" directly above a numbered list whose step 3 (`npm run watch-linkedin`) the chain does not sequence | Reword the lead-in to scope the claim to the login/probe steps (e.g. "The login and probe steps it sequences, for running them individually:") so the unsequenced watch step is not claimed | applied: README lead-in scoped to "The login and probe steps it sequences" |
| code | Phase 4 §4 (architecture.md) | <n/a> | suggestion | code-quality | The inserted structure line reads "entry-guarded (imports runLinkedInChain side-effect free)" while the same line says "exports runLinkedInChain" — the chain module defines runLinkedInChain and imports the three legs, so the parenthetical is factually wrong | Change the parenthetical to "entry-guarded (imports the three legs side-effect free); exports runLinkedInChain / ChainDeps / ChainResult" | applied: parenthetical corrected to "imports the three legs side-effect free" |
| code | Phase 4 (doc sweep) | .rpiv/guidance/src/architecture.md:146 | suggestion | codebase-fit | The guidance/src spec-of-record closing line "The PC scripts themselves live in scripts/ (tick, loop, gate, login)" is the same leg-enumeration class the plan fixes elsewhere (the guidance-root tree line gains `/chain`, "Eight files" becomes nine) but is left stale once the chain lands | Extend the parenthetical to "(tick, loop, gate, login, chain)" in the same Phase 4 doc slice | applied: third hunk added to the Phase 4 guidance/src block extending the line to (tick, loop, gate, login, chain) |

## Developer Context

- Step 5 triage (2026-11-12): 7 reviewer findings — 6 applied (LOCKED-warning manual bullet; D2 blank-as-unset forwarding, plan-local with design follow-up; the em-dash FAILED line across the chain code + plan prose + both guidance/scripts spots; README lead-in scoping; the guidance/scripts chain parenthetical; the guidance/src closing leg enumeration), 1 dismissed (probe test click-path — the trimmed double is deliberate per D5). Same pass repaired 6 glued doc-fence closers (an extraction defect, not a reviewer finding).

## References

- Design: `.rpiv/artifacts/designs/2026-11-12_10-34-39_linkedin-operator-chain.md`
- Solutions: `.rpiv/artifacts/solutions/2026-11-12_09-55-42_linkedin-operator-chain.md`
- Research: `.rpiv/artifacts/research/2026-11-12_09-30-27_linkedin-scroll-pagination-session-hygiene.md`
- FRD: `.rpiv/artifacts/discover/2026-11-12_07-50-38_linkedin-scroll-pagination-session-hygiene.md`
- Shape precedent: `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md`

## Follow-up — 2026-11-12T17:44:49+0700

Trigger: post-implement review after /skill:implement ran all four phases of this plan (580/580 tests, typecheck and lint clean, 37/43 checkboxes — the 6 open items are operator manual runs needing a real TTY).

Incident: the Phase 1-2 checkbox flips wrote a 50KB-capped read back over this 51KB untracked file twice, without a backup. The destruction removed roughly 46 lines of Phase 4 sections 4-6 hunk bodies and the Plan Review table; no byte-exact copy existed to restore from.

Restoration: the file was rebuilt from captured context. Bytes through the Phase 3 fence are original; Phase 4 sections 4-6 are a complete-in-substance reconstruction whose minus/context lines were byte-verified against the live guidance files (including the :48/49 hunk line-48 context restored from live bytes). The six D4 drift claims and every Automated Verification pin are intact. tests/linkedin-chain.test.ts was re-extracted from the restored fence, then proven byte-identical to the design's locked suite (design lines 858-1085) after removing two corruption-lineage artifacts (one stray blank line, one doubled backslash in a regex).

Ownership correction: an implement-written restoration note that briefly sat in Developer Context was removed — implement owns checkboxes, not plan content. Developer Context holds its pre-implement single bullet.

Advice to validate: treat Phase 4 sections 4-6 hunks as a live-byte-verified reconstruction, not the reviewed artifact; the code is authoritative for contract checks. Frontmatter stamps above were refreshed by this revision.

## Follow-up — 2026-11-12T18:09:03+0700

Trigger: the validate gate (2026-11-12_17-52-38) ruled the tree green, but the developer blocked the commit on two gaps. (1) The delivered runLoginHelper/linkedin-fetch changes violated this plan's NOT-DOING line — a plan-level defect needing revise, not a pass with recommendations. (2) The SCROLL_JS rewrite and the msedge channels ship live-only-verified with zero offline pins, onto the always-on PC loop — a tidy side commit would launder undeclared scope into main. Plus: this plan file is untracked and was corrupted/rebuilt mid-run — the reconstruction is the only surviving record of the approved scope and must commit alongside the code.

Resolution: the NOT-DOING line now names its declared exceptions; scripts/login-linkedin.ts joined Phase 2's files (keepOpen is load-bearing for the Phase 2 fence, two checked criteria added with validate evidence); new Phase 5 declares the session-hygiene fold-in and adds its missing verification (SCROLL_JS export + offline shape pins, the msedge grep pins, the rehearsal-evidence citation in the commit message, the standalone-login doc drift fix); the Phase 1 floor criterion dropped its "same floor message" contradiction with D4; Migration Notes require the artifacts to commit with the code.

Next: /skill:implement Phase 5 (the pins and the doc fix are the only NEW work — the production code is already in the tree), then a fresh /skill:validate, then /skill:commit with the split from the report's Recommendations.
