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
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isProbeFloor, isProbeNoSurfaces, runProbe } from "../scripts/probe-linkedin.js";
import type { WatcherConfig } from "../src/config-file.js";
import { ENV_NAMES } from "../src/config.js";
import type { ContextLike, LocatorLike, PageLike, ResponseLike } from "../src/fetch-threads.js";
import { HALT_CHECKPOINT_REASON } from "../src/linkedin-behavior.js";
import type { CaptureRecord, CaptureSink } from "../src/linkedin-capture.js";
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

// The capture doctrine's absence-oracle snapshot (design 2026-11-13):
// taken at module load, before any test runs.
const repoCaptures = join(dirname(fileURLToPath(import.meta.url)), "..", "captures");
const repoCapturesBefore = await access(repoCaptures).then(
  () => true,
  () => false,
);

after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  // The capture doctrine's absence oracle (design 2026-11-13): a FRESH
  // captures/ directory at the repo root means a body-firing case above
  // skipped its sink injection. A directory that already existed (a live
  // operator run) is not this suite's problem.
  if (!repoCapturesBefore) {
    await assert.rejects(() => access(repoCaptures), /ENOENT/);
  }
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

/**
 * Recording capture sink (capture-first, design 2026-11-13): the probe's
 * production default WRITES captures/ into the current directory, so the
 * walk-driving cases inject this in-memory double — npm test touches OS
 * temp only, and the pass-path pins the probe → walk pass-through.
 */
function recordingSink(): CaptureSink & { records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  const sink: CaptureSink = async (record) => {
    records.push(record);
  };
  return Object.assign(sink, { records });
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
    const capture = recordingSink();
    const result = await runProbe({
      config: CONFIG,
      env: await cookieEnv(),
      contextFactory,
      captureSink: capture,
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
    // Capture-first (design 2026-11-13): the probe records the body it
    // walked — gitignored scratch, the replay's input.
    assert.equal(capture.records.length, 1);
    assert.equal(capture.records[0]?.matched, true);
  });
});

describe("runProbe gate arms", () => {
  it("throws the tagged floor gate on a short walk", async () => {
    const contextFactory = contextFactoryFor({ script: { initialBody: bodyMinting(4) } });
    const capture = recordingSink();
    await assert.rejects(
      async () =>
        runProbe({
          config: CONFIG,
          env: await cookieEnv(),
          contextFactory,
          captureSink: capture,
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
      (error: unknown) =>
        isAllSurfacesFaulted(error) && (error as { faulted: number }).faulted === 1,
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
