/**
 * Offline suite for the probe gate's runProbe seam (operator-chain
 * design, Slice 1). Importing scripts/probe-linkedin.ts IS the
 * entry-guard pin: the module used to walk at import time, so reaching
 * this suite without a browser launch proves the guard. The rest pins
 * the behavior the chain depends on: the first-pass-wins keyword loop
 * (thin-skip and fault-skip lines), the instant aborts (halt / leg-dead /
 * plain errors rethrow — the caller owns the exit), the all-thin/
 * all-faulted floor terminal naming every keyword, the two local tagged
 * gates, the zero-surfaces guard, the
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
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import { LINKEDIN_PROFILE_DIR } from "../src/linkedin-fetch.js";

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
  linkedinWakeMinMinutes: 60,
  linkedinWakeMaxMinutes: 60,
};

/** A config carrying the given linkedin keywords, in config order (per-keyword loop cases). */
const configWithSurfaces = (...values: string[]): WatcherConfig => ({
  ...CONFIG,
  surfaces: values.map((value) => ({ type: "linkedin" as const, value })),
});

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

/**
 * One capture-shaped card (the card join reads URN STRINGS, never digit fields):
 * the id row carries the urn string and the marker row $-refs it - the join's
 * forward edge, the live split-card shape.
 */
const cardBody = (id: string, text: string): string => {
  const n = (cardSeq += 1) * 10;
  return [
    row(String(n), { tracking: { activityUrn: { urn: `urn:li:activity:${id}` } } }),
    row(String(n + 1), [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: [text] } }],
        interactionTypes: `$${n}`,
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
 * trimmed): one context, one page, one script PER BUILD — `script` runs
 * every build the same way, `scripts` serves build N from scripts[N]
 * (the per-keyword loop cases). Records the built count and the profile
 * path the walk opened.
 */
function contextFactoryFor(options: {
  built?: { value: number };
  profileDirs?: unknown[];
  /** The script EVERY build runs (single-keyword cases). */
  script?: PageScript;
  /** Per-build scripts in build order — build N runs scripts[N]. */
  scripts?: readonly PageScript[];
}): LinkedInContextFactory {
  const scriptFor = (build: number): PageScript => {
    const chosen = options.scripts !== undefined ? options.scripts[build] : options.script;
    if (chosen === undefined) {
      throw new Error(`test double: no script for build ${build}`);
    }
    return chosen;
  };
  let builds = 0;
  const factory: LinkedInContextFactory = async (profileDir): Promise<ContextLike> => {
    const build = builds++;
    if (options.built !== undefined) options.built.value += 1;
    options.profileDirs?.push(profileDir);
    const script = scriptFor(build);
    const listeners: Array<(response: ResponseLike) => void> = [];
    const fire = (response: ResponseLike): void => {
      for (const listener of listeners) listener(response);
    };
    let clickCount = 0;
    let settleArmed = false;
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => ({
        url: () => script.url ?? "https://www.linkedin.com/search/results/content/",
        goto: async () => {
          if (script.gotoError !== undefined) throw new Error(script.gotoError);
          const initial = script.initialBody;
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
              const visible = script.loadMoreVisible?.(clickCount + 1) ?? false;
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
        evaluate: async () => (script.initialBody !== undefined ? 8 : 0),
        waitForTimeout: async () => {
          if (settleArmed) {
            settleArmed = false;
            const body = script.clickBodies?.[clickCount - 1];
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
  it("walks the configured linkedin keywords in config order (first to clear the floor) on the persistent profile and resolves the post count", async (t) => {
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
    assert.ok(lines.some((line) => /^probe: 10 post\(s\)$/.test(line)));
    assert.ok(lines.some((line) => line === "probe: all checks passed"));
    // Capture-first (design 2026-11-13): the probe records the body it
    // walked — gitignored scratch, the replay's input.
    assert.equal(capture.records.length, 1);
    assert.equal(capture.records[0]?.matched, true);
  });
});

describe("runProbe keyword loop", () => {
  it("skips a thin keyword and passes on the first clearing surface (first-pass-wins)", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{ initialBody: bodyMinting(4) }, { initialBody: bodyMinting(12) }],
    });
    const capture = recordingSink();
    const result = await runProbe({
      config: configWithSurfaces("react jakarta", "hiring jakarta", "react indonesia"),
      env: await cookieEnv(),
      contextFactory,
      captureSink: capture,
      now: () => T0,
    });
    assert.deepEqual(result, { postCount: 12, elapsedMs: 0 }); // the WINNING attempt's clock
    assert.equal(built.value, 2); // first-pass-wins: the third keyword never launched
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.some((line) => /content search for "react jakarta"/.test(line)));
    assert.ok(
      lines.some((line) =>
        /probe: react jakarta — 4 post\(s\), below the 10-post floor; trying the next surface/.test(
          line,
        ),
      ),
    ); // thin-skip: one line naming the keyword and its count, then move on
    assert.ok(lines.some((line) => /content search for "hiring jakarta"/.test(line)));
    assert.ok(lines.some((line) => /^probe: 12 post\(s\)$/.test(line)));
    assert.ok(lines.some((line) => line === "probe: all checks passed"));
    // Order: the thin-skip line lands BEFORE the second keyword's banner.
    const thinAt = lines.findIndex((line) => line.includes("below the 10-post floor"));
    const secondBannerAt = lines.findIndex((line) => line.includes('"hiring jakarta"'));
    assert.ok(thinAt !== -1 && secondBannerAt !== -1 && thinAt < secondBannerAt);
    assert.equal(capture.records.length, 2); // both walked bodies captured (one per attempt)
  });

  it("skips a faulted keyword and passes on the next surface", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{ gotoError: "navigation failed" }, { initialBody: bodyMinting(12) }],
    });
    const capture = recordingSink();
    const result = await runProbe({
      config: configWithSurfaces("react jakarta", "hiring jakarta"),
      env: await cookieEnv(),
      contextFactory,
      captureSink: capture,
      now: () => T0,
    });
    assert.deepEqual(result, { postCount: 12, elapsedMs: 0 });
    assert.equal(built.value, 2);
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(
      lines.some((line) =>
        /probe: react jakarta faulted — linkedin-fetch: all 1 surface\(s\) faulted — nothing fetched; trying the next surface/.test(
          line,
        ),
      ),
    ); // fault-skip names the keyword AND the aggregate message
    assert.ok(lines.some((line) => /content search for "hiring jakarta"/.test(line)));
  });
});

describe("runProbe gate arms", () => {
  it("rethrows the tagged halt instantly — later keywords never walk", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{ url: CHECKPOINT_URL }, { initialBody: bodyMinting(12) }],
    });
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) =>
        isHalt(error) && (error as { reason: string }).reason === HALT_CHECKPOINT_REASON,
    );
    assert.equal(built.value, 1); // the checkpoint aborted BEFORE the second keyword's launch
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.every((line) => !line.includes("hiring jakarta"))); // no banner for keyword 2
  });

  it("rethrows the tagged leg-dead instantly — later keywords never walk", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{}, { initialBody: bodyMinting(12) }],
    });
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) =>
        isLegDead(error) && /session may be dead/.test((error as { reason: string }).reason),
    );
    assert.equal(built.value, 1);
  });

  it("rethrows a plain factory error instantly — later keywords never walk", async () => {
    const built = { value: 0 };
    const contextFactory: LinkedInContextFactory = async () => {
      built.value += 1;
      throw new Error("context factory exploded");
    };
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      /context factory exploded/,
    );
    assert.equal(built.value, 1); // no second launch: the wall recurs for every keyword
  });

  it("throws the tagged floor terminal when every keyword is thin", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{ initialBody: bodyMinting(4) }, { initialBody: bodyMinting(3) }],
    });
    const capture = recordingSink();
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          captureSink: capture,
          now: () => T0,
        }),
      (error: unknown) => {
        assert.equal(isProbeFloor(error), true); // the same tag the CLI floor arm prints bare
        assert.match(
          (error as Error).message,
          /probe: no linkedin surface cleared 10 posts — react jakarta 4, hiring jakarta 3/,
        );
        assert.equal(isHalt(error), false); // disjoint from the walk's tags
        assert.equal(isLegDead(error), false);
        assert.equal(isAllSurfacesFaulted(error), false);
        return true;
      },
    );
    assert.equal(built.value, 2); // every keyword walked
  });

  it("throws the tagged floor terminal when every keyword faults", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      script: { gotoError: "navigation failed" },
    });
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) => {
        assert.equal(isProbeFloor(error), true); // the walk's all-faulted tag NEVER reaches the caller
        assert.match(
          (error as Error).message,
          /probe: no linkedin surface cleared 10 posts — react jakarta 0 \(faulted\), hiring jakarta 0 \(faulted\)/,
        );
        assert.equal(isAllSurfacesFaulted(error), false);
        return true;
      },
    );
    assert.equal(built.value, 2);
  });

  it("names thin and faulted keywords together in the floor terminal message", async () => {
    const contextFactory = contextFactoryFor({
      scripts: [
        { initialBody: bodyMinting(4) },
        { gotoError: "navigation failed" },
        { initialBody: bodyMinting(3) },
      ],
    });
    const capture = recordingSink();
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta", "react indonesia"),
          env: await cookieEnv(),
          contextFactory,
          captureSink: capture,
          now: () => T0,
        }),
      (error: unknown) => {
        assert.equal(isProbeFloor(error), true);
        assert.match(
          (error as Error).message,
          /probe: no linkedin surface cleared 10 posts — react jakarta 4, hiring jakarta 0 \(faulted\), react indonesia 3/,
        );
        return true;
      },
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
