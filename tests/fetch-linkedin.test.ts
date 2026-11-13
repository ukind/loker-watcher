/**
 * Offline suite for the PC fetch tick (browser-walk migration, slice 5).
 *
 * Pins pushPayload's single-path rebase+retry discipline over a fake
 * GitRunner, fetchTick's composition over the injected seams — the tick
 * hands the walk a LinkedInContextFactory and the config scrollRounds,
 * and owns no browser lifecycle of its own — the leg-dead episode-marker
 * edge, the fault arms (an all-faulted walk is a quiet-zeros no-op while
 * a fine-empty walk still writes and pushes, defb8af; a checkpoint walk
 * trips the halt latch with the canonical reason), and the preflight
 * band: window -> latch -> checkout guard BEFORE any browser launch.
 * Zero network, zero real email, zero Playwright; the doubles carry every
 * behavior pin (realGit is exercised only by two read-only git spawns in
 * its block). The budget suites died with the budget machine (slice 5).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type GitRunner,
  fetchTick,
  guardCheckout,
  handleLegDeadEpisode,
  pushPayload,
  realGit,
} from "../scripts/fetch-linkedin.js";
import type { WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import type { ContextLike, LocatorLike, PageLike, ResponseLike } from "../src/fetch-threads.js";
import { HALT_CHECKPOINT_REASON } from "../src/linkedin-behavior.js";
import { type LinkedInContextFactory, SCROLL_JS, isLegDead } from "../src/linkedin-fetch.js";
import { PAYLOAD_VERSION, type PayloadEnvelope } from "../src/linkedin-payload.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import { CURRENT_STATE_VERSION, saveState } from "../src/state.js";
import type { Post } from "../src/types.js";

const T0 = Date.UTC(2026, 9, 26, 9, 14, 0);
const COOKIES: LinkedInCookies = {
  liAt: "AQE-test",
  jsessionId: "ajax:0123456789012345678",
  harvestedAt: "2026-11-10T00:00:00.000Z", // FR-0: present, age never checked
};

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: [],
  negativeKeywords: [],
  surfaces: [{ type: "linkedin", value: "#hiring react" }],
  platforms: { linkedin: true, threads: true },
  recencyHours: 72,
  reasoningEffort: "low",
  scrollRounds: 1,
};

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function workPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-fetch-linkedin-"));
  return join(dir, name);
}

async function exists(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}

/** Fake GitRunner: records every invocation; exit code + output scripted per command. */
function scriptGit(
  script: Partial<
    Record<
      string,
      number | { code: number; output: string } | Array<number | { code: number; output: string }>
    >
  > = {},
): GitRunner & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    const command = args[0] ?? "";
    calls.push([...args]);
    const scripted = script[command];
    const index = calls.filter((entry) => entry[0] === command).length - 1;
    const entry = Array.isArray(scripted)
      ? (scripted[index] ?? scripted[scripted.length - 1])
      : scripted;
    if (entry === undefined) return { code: 0, output: "" };
    if (typeof entry === "number") return { code: entry, output: "" };
    return { code: entry.code, output: entry.output };
  };
  return Object.assign(git, { calls });
}

// --- the browser-walk doubles (capture-shaped flight bodies + one context factory) ---

const FLAGSHIP_SEARCH_URL = "https://www.linkedin.com/flagship-web/search/results/content/";
const PAGINATION_URL = "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination";
const CHECKPOINT_URL = "https://www.linkedin.com/checkpoint/challenge";

/**
 * Capture-shaped ids: BigInt(epochMs) << 22n — the exact inverse of the
 * parser's BigInt(id) >> 22n clock. One minute of spacing keeps every id
 * distinct and time-ordered by n.
 */
const BASE_MS = Date.UTC(2026, 9, 26, 9, 14, 0);
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

/** A parseable flight body that mints ZERO posts (an empty-results page). */
const EMPTY_BODY = "9:{}";

/** What the fake page does at goto, click, and settle time (one script per factory). */
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
 * The LinkedInContextFactory double: one context, one page, one script.
 * Records the built count and the profile path the walk opened; the click
 * transcript rides the returned handle; context closes set the closed flag
 * so teardown pins ride on it.
 */
function contextFactoryFor(options: {
  closed?: { value: boolean };
  profileDirs?: unknown[];
  built?: { value: number };
  script: PageScript;
}): LinkedInContextFactory & { clicks: () => number[] } {
  const clicks: number[] = [];
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
              clicks.push(clickCount);
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
          // One macrotask tick: the walk's async body reads drain first
          // (the deterministic handoff the walk suite pins).
          await new Promise<void>((resolve) => setImmediate(resolve));
        },
        close: async () => undefined,
      }),
      addInitScript: async () => undefined,
      close: async () => {
        if (options.closed !== undefined) options.closed.value = true;
      },
    };
    return context;
  };
  return Object.assign(factory, { clicks: (): number[] => clicks });
}

describe("realGit (git's merged output, resolved and rejected paths)", () => {
  it("captures git's stdout on success and its stderr + exit code on failure", async (t) => {
    const probe = await realGit(["--version"]); // read-only: no repo state touched
    if (probe.code !== 0) {
      t.skip("git is not on PATH — the read-only spawn pins need a real git");
      return;
    }
    assert.match(probe.output, /git version/); // resolved path: stdout rides output
    const dead = await realGit(["rev-parse", "--verify", "lw-no-such-ref-realgit-pin"]);
    assert.notEqual(dead.code, 0); // rejected path: the real exit code survives
    assert.ok(dead.output.length > 0); // git's own stderr, merged and trimmed
  });
});

describe("pushPayload (single-path rebase+retry discipline)", () => {
  it("stages ONLY the injected path, commits, rebases onto main, and pushes", async () => {
    const payload = await workPath("push-ok.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 3, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
      ["commit", "-m", "linkedin: payload 3 post(s)"],
      ["pull", "--rebase", "origin", "main"],
      ["push"],
    ]);
  });

  it("never stages the module-constant path when a temp payload is injected", async () => {
    const payload = await workPath("push-injected.json");
    const git = scriptGit({ diff: 1 });
    await pushPayload(git, 1, payload);
    const addCalls = git.calls.filter((args) => args[0] === "add");
    assert.equal(addCalls.length, 1);
    assert.equal(addCalls[0]?.[1], payload);
    assert.ok(git.calls.every((args) => !args.includes(LINKEDIN_PAYLOAD_PATH)));
  });

  it("throws loudly when the commit itself fails: names the identity fix AND carries git's output", async () => {
    const git = scriptGit({
      diff: 1,
      commit: { code: 128, output: "fatal: unable to auto-detect email address" },
    });
    const payload = await workPath("push-commit-fail.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /payload commit failed — configure the clone's git identity first/);
        assert.match(message, /git said: fatal: unable to auto-detect email address/);
        return true;
      },
    );
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 0);
  });

  it("skips commit + rebase + push when nothing is staged (no-op guard)", async () => {
    const payload = await workPath("push-noop.json");
    const git = scriptGit({ diff: 0 });
    await pushPayload(git, 0, payload);
    assert.deepEqual(git.calls, [
      ["add", payload],
      ["diff", "--cached", "--quiet"],
    ]);
  });

  it("retries once when the push is rejected, then succeeds", async () => {
    const git = scriptGit({ diff: 1, push: [1, 0] });
    await pushPayload(git, 2, await workPath("push-retry.json"));
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "pull").length, 2);
  });

  it("throws after the second push rejection (loud, exit-1 contract)", async () => {
    const git = scriptGit({ diff: 1, push: 1 });
    const payload = await workPath("push-fail.json");
    await assert.rejects(() => pushPayload(git, 2, payload), /payload push failed twice/);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 2);
  });

  it("aborts the rebase loudly on failure and never pushes — git's own line rides the error", async () => {
    const git = scriptGit({
      diff: 1,
      pull: { code: 1, output: "CONFLICT (content): Merge conflict in state/linkedin-posts.json" },
    });
    const payload = await workPath("push-conflict.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /payload push failed twice/);
        assert.match(
          message,
          /git said: CONFLICT \(content\): Merge conflict in state\/linkedin-posts\.json/,
        );
        return true;
      },
    );
    const aborts = git.calls.filter((args) => args[0] === "rebase" && args[1] === "--abort");
    assert.equal(aborts.length, 2);
    assert.equal(git.calls.filter((args) => args[0] === "push").length, 0);
  });

  it("surfaces git's real cause, not a misread conflict (the unstaged-changes misdiagnosis)", async () => {
    const git = scriptGit({
      diff: 1,
      pull: { code: 1, output: "error: cannot pull with rebase: You have unstaged changes." },
    });
    const payload = await workPath("push-rebase-output.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(
          message,
          /git said: error: cannot pull with rebase: You have unstaged changes\./,
        );
        assert.ok(!message.includes("rebase conflicted"));
        return true;
      },
    );
  });
});

describe("fetchTick (compose cookies → context factory → walk → payload → push)", () => {
  it("composes the tick end to end: payload written, single-path push, marker cleared", async () => {
    const payload = await workPath("tick-ok.json");
    const marker = await workPath("tick-ok.flag");
    await writeFile(marker, "dead session\n", "utf8"); // a stale episode: a clean tick clears it
    const closed = { value: false };
    const contextFactory = contextFactoryFor({
      closed,
      script: { initialBody: cardBody(idAt(1), "hiring post — Jakarta") },
    });
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-1.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      payloadPath: payload,
      git,
      env: {},
      seenPath: await workPath("seen-tick.json"),
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 1 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.version, PAYLOAD_VERSION);
    assert.equal(new Date(envelope.writtenAt).getTime(), T0);
    const expected: Post = {
      platform: "linkedin",
      id: `urn:li:activity:${idAt(1)}`,
      text: "hiring post — Jakarta",
      author: "linkedin-member",
      permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${idAt(1)}`,
      timestamp: new Date(BASE_MS + 60_000).toISOString(),
      surfaces: [{ type: "linkedin", value: "#hiring react" }],
    };
    assert.deepEqual(envelope.posts, [expected]);
    assert.equal(closed.value, true); // the walk closed the context; the tick owns no browser lifecycle
    assert.equal(await exists(marker), false); // the healthy tick cleared the episode
    // The two preflight reads (clean main, empty porcelain) precede the push discipline.
    assert.deepEqual(git.calls[0], ["rev-parse", "--abbrev-ref", "HEAD"]);
    assert.deepEqual(git.calls[1], ["status", "--porcelain"]);
    assert.equal(git.calls[2]?.[0], "add");
    assert.equal(git.calls[2]?.[1], payload); // ONLY the injected payload path
    assert.ok(git.calls.some((args) => args[0] === "commit"));
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });

  it("propagates leg-dead without writing the payload, pushing, or leaving a context open", async () => {
    const payload = await workPath("tick-dead.json");
    const marker = await workPath("tick-dead.flag");
    const alarms: string[] = [];
    const closed = { value: false };
    const contextFactory = contextFactoryFor({ closed, script: {} }); // silence: the liveness window dies
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-2.flag"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          contextFactory,
          payloadPath: payload,
          git,
          env: {},
          seenPath: await workPath("seen-tick.json"),
          markerPath: marker,
          alarm: async (reason) => {
            alarms.push(reason);
          },
        }),
      (error: unknown) => isLegDead(error) && /no flagship-web response/.test(error.reason),
    );
    assert.equal(closed.value, true); // the walk still closed its context on the dead path
    assert.equal(await exists(payload), false); // the walk aborted before any write
    // Only the two preflight reads ran (the guard precedes the walk); zero push-discipline calls.
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
    assert.deepEqual(alarms, []); // the alarm policy belongs to the entry/loop callers
  });

  it("returns quiet zeros on an all-faulted walk — no payload, no git, marker untouched", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const payload = await workPath("tick-all-faulted.json");
    const marker = await workPath("tick-all-faulted.flag");
    await writeFile(marker, "stale episode\n", "utf8"); // must survive untouched
    const contextFactory = contextFactoryFor({ script: { gotoError: "navigation failed" } });
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-3.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      payloadPath: payload,
      git,
      env: {},
      seenPath: await workPath("seen-tick.json"),
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(await exists(payload), false); // b2: the last good payload stays
    // The preflight ran (it precedes the walk); still zero add/commit/push on a faulted tick.
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
    assert.equal(await readFile(marker, "utf8"), "stale episode\n"); // never cleared
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /all 1 linkedin surface\(s\) faulted/.test(line)));
    assert.ok(
      lines.some((line) => /linkedin\/#hiring react FAILED — navigation failed/.test(line)),
    );
  });

  it("still writes and pushes a fine-empty walk's payload (defb8af: 0 faults + 0 posts is an outcome)", async () => {
    const payload = await workPath("tick-fine-empty.json");
    const marker = await workPath("tick-fine-empty.flag");
    const contextFactory = contextFactoryFor({ script: { initialBody: EMPTY_BODY } });
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-4.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      payloadPath: payload,
      git,
      env: {},
      seenPath: await workPath("seen-tick.json"),
      markerPath: marker,
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 0 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.version, PAYLOAD_VERSION);
    assert.deepEqual(envelope.posts, []); // the guard keys on FAULTS, not post count
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });

  it("returns early when no linkedin surfaces are configured (resolvers AND the checkout preflight never run)", async () => {
    const git = scriptGit({});
    const result = await fetchTick({
      latchPath: await workPath("latch-5.flag"),
      bypassWindow: true,
      config: { ...CONFIG, surfaces: [{ type: "tag", value: "hiring" }] },
      git,
      env: {}, // no LINKEDIN_COOKIES_FILE — the cookie resolver would throw if reached
      markerPath: await workPath("tick-noop.flag"),
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(git.calls.length, 0); // the guard sits AFTER this return — a threads-only config never demands a main checkout
  });

  it("resolves cookies before building any browser context (the production factory is lazy)", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-factory.flag"),
          bypassWindow: true,
          config: CONFIG,
          contextFactory,
          git: scriptGit({ "rev-parse": { code: 0, output: "main" } }),
          env: {}, // no LINKEDIN_COOKIES_FILE — the resolver throws first
          now: () => T0,
        }),
      /LINKEDIN_COOKIES_FILE/,
    );
    assert.equal(built.value, 0); // no browser was ever built
  });
});

describe("checkout preflight (guardCheckout before any fetch — Phase 10)", () => {
  it("passes on clean main with exactly the two guard reads (direct pin)", async () => {
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } }); // status → empty porcelain
    await guardCheckout(git); // must not throw
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
  });

  it("rejects a wrong branch naming it and the wrong-ref consequence — zero navigations, no payload", async () => {
    const payload = await workPath("tick-wrong-branch.json");
    const marker = await workPath("tick-wrong-branch.flag");
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit({
      "rev-parse": { code: 0, output: "feature/add-support-for-linkeind" },
    });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-7.flag"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          contextFactory,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /on branch "feature\/add-support-for-linkeind", not main/);
        assert.match(message, /wrong ref/); // the hosted run would never read that push
        return true;
      },
    );
    assert.equal(built.value, 0); // the guard precedes the walk — no browser was ever built
    assert.equal(await exists(payload), false); // nothing written before the rejection
    assert.deepEqual(git.calls, [["rev-parse", "--abbrev-ref", "HEAD"]]); // throws before status
  });

  it("rejects a dirty tree naming the path count and the paths — zero navigations, no payload", async () => {
    const payload = await workPath("tick-dirty.json");
    const marker = await workPath("tick-dirty.flag");
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit({
      "rev-parse": { code: 0, output: "main" },
      status: { code: 0, output: " M src/linkedin-fetch.ts\n M README.md" },
    });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-8.flag"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          contextFactory,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /not clean \(2 path\(s\)/);
        assert.match(message, /src\/linkedin-fetch\.ts/);
        assert.match(message, /README\.md/);
        return true;
      },
    );
    assert.equal(built.value, 0); // no live fetch burned on a mis-homed checkout
    assert.equal(await exists(payload), false);
    assert.deepEqual(git.calls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
    ]);
  });
});

describe("handleLegDeadEpisode (one alarm per episode)", () => {
  it("alarms once on the healthy→dead edge and writes the marker", async () => {
    const marker = await workPath("episode-1.flag");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, ["dead session"]);
    assert.equal(await readFile(marker, "utf8"), "dead session\n");
  });

  it("stays quiet on later dead ticks (marker already present)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-2.flag");
    await writeFile(marker, "dead session\n", "utf8");
    const alarms: string[] = [];
    await handleLegDeadEpisode("dead session again", {
      markerPath: marker,
      env: {},
      alarm: async (reason) => {
        alarms.push(reason);
      },
    });
    assert.deepEqual(alarms, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /leg still dead/.test(line)));
  });

  it("survives a restart: the marker file, not module state, edges the episode", async () => {
    const marker = await workPath("episode-3.flag");
    const alarms: string[] = [];
    const deps = {
      markerPath: marker,
      env: {},
      alarm: async (reason: string): Promise<void> => {
        alarms.push(reason);
      },
    };
    await handleLegDeadEpisode("dead", deps); // pre-restart process
    await handleLegDeadEpisode("dead", deps); // post-restart process: same file, still quiet
    assert.deepEqual(alarms, ["dead"]);
  });

  it("default alarm is best-effort: a broken GMAIL env warns instead of throwing", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const marker = await workPath("episode-4.flag");
    await handleLegDeadEpisode("dead", { markerPath: marker, env: {} });
    assert.equal(await readFile(marker, "utf8"), "dead\n"); // marker persists despite the send failure
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /alarm not sent/.test(line)));
  });
});

// --- the anti-restriction preflight band (design 2026-11-09; window -> latch, slice 5) ---

describe("the anti-restriction preflight band (window -> latch)", () => {
  it("blocks a latched tick: zero browser builds, zero git spawns, quiet zeros", async () => {
    const latchPath = await workPath("latch-9.flag");
    await writeFile(latchPath, "LinkedIn security checkpoint\n", "utf8");
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      contextFactory,
      git,
      payloadPath: await workPath("payload-latched.json"),
      latchPath,
      bypassWindow: true,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(built.value, 0);
    assert.equal(git.calls.length, 0);
  });

  it("outside the working window the tick is a quiet no-op (Saturday noon local)", async () => {
    const saturdayNoon = new Date(2026, 9, 31, 12, 0).getTime(); // 2026-10-31 is a Saturday
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      contextFactory,
      git,
      payloadPath: await workPath("payload-weekend.json"),
      latchPath: await workPath("latch-10.flag"),
      now: () => saturdayNoon,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(built.value, 0);
    assert.equal(git.calls.length, 0);
  });

  it("inside the window (Monday 10:00 local, latch absent) the tick reaches the checkout guard", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime(); // 2026-10-26 is a Monday
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit({ "rev-parse": { code: 0, output: "feature\n" } });
    await assert.rejects(
      async () =>
        fetchTick({
          config: CONFIG,
          contextFactory,
          git,
          payloadPath: await workPath("payload-weekday.json"),
          latchPath: await workPath("latch-11.flag"),
          now: () => mondayTen,
          env: {},
        }),
      /not main/,
    );
    assert.ok(git.calls.length >= 1); // the band let it through to the guard
    assert.equal(built.value, 0); // the guard threw before any browser was built
  });
});

describe("the scrollRounds click bound rides the config into the walk", () => {
  it("threads config.scrollRounds into the walk as the per-surface click ceiling", async () => {
    const contextFactory = contextFactoryFor({
      script: {
        initialBody: cardBody(idAt(1), "hiring post — Jakarta"),
        loadMoreVisible: () => true, // every round's button resolves; the gains stay dry
      },
    });
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      config: { ...CONFIG, scrollRounds: 3 },
      cookies: COOKIES,
      contextFactory,
      git,
      payloadPath: await workPath("payload-rounds.json"),
      latchPath: await workPath("latch-rounds.flag"),
      bypassWindow: true,
      env: {},
      seenPath: await workPath("seen-tick.json"),
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 1 });
    assert.deepEqual(contextFactory.clicks(), [1, 2, 3]); // the knob, not the dry-round exit, stopped the loop
  });
});

describe("the halt-latch trip (FR-7)", () => {
  it("a checkpoint walk trips the latch with the canonical reason and alarms once", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const latchPath = await workPath("latch-cp.flag");
    const payloadPath = await workPath("payload-cp.json");
    const alarms: string[] = [];
    const contextFactory = contextFactoryFor({ script: { url: CHECKPOINT_URL } });
    const git = scriptGit({ "rev-parse": { code: 0, output: "main\n" } });
    const result = await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      git,
      payloadPath,
      latchPath,
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async (reason) => {
        alarms.push(reason);
      },
      env: {},
      seenPath: await workPath("seen-tick.json"),
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    const flag = await readFile(latchPath, "utf8");
    assert.equal(flag, `${HALT_CHECKPOINT_REASON}\n`);
    assert.deepEqual(alarms, [HALT_CHECKPOINT_REASON]);
    assert.equal(await exists(payloadPath), false); // no payload on a halted tick
  });

  it("the latch trip never writes the leg-dead episode marker (separate channels)", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const latchPath = await workPath("latch-channels.flag");
    const markerPath = await workPath("episode.flag");
    const contextFactory = contextFactoryFor({ script: { url: CHECKPOINT_URL } });
    await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath: await workPath("payload-channels.json"),
      latchPath,
      markerPath,
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async () => undefined,
      env: {},
      seenPath: await workPath("seen-tick.json"),
    });
    assert.equal(await exists(latchPath), true);
    assert.equal(await exists(markerPath), false);
  });
});

describe("FR-0 stamp gate (slice 5)", () => {
  it("rejects a stampless cookie file before the browser is built or any navigation", async () => {
    const stampless: LinkedInCookies = {
      liAt: "AQE-test",
      jsessionId: "ajax:0123456789012345678",
    };
    const payloadPath = await workPath("payload-stamp.json");
    const latchPath = await workPath("latch-stamp.flag");
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const gitCalls: string[] = [];
    const git: GitRunner = async (args) => {
      gitCalls.push(args.join(" "));
      return args[0] === "rev-parse" ? { code: 0, output: "main" } : { code: 0, output: "" };
    };
    await assert.rejects(
      () =>
        fetchTick({
          config: CONFIG,
          cookies: stampless,
          contextFactory,
          git,
          payloadPath,
          latchPath,
          now: () => new Date(2026, 9, 26, 10, 0).getTime(),
          bypassWindow: true,
          env: {},
        }),
      /harvestedAt.*login-linkedin/,
    );
    // The gate sits after the checkout guard: two git reads happened, zero writes, zero browsers.
    assert.deepEqual(gitCalls, ["rev-parse --abbrev-ref HEAD", "status --porcelain"]);
    assert.equal(built.value, 0);
    assert.equal(await exists(payloadPath), false);
  });
});

describe("SCROLL_JS content (Phase 5: the live-only revision, pinned as a string)", () => {
  it("carries all four scroll-container candidates", () => {
    assert.ok(SCROLL_JS.includes("document.scrollingElement"));
    assert.ok(
      SCROLL_JS.includes(
        "querySelectorAll(\"main, [data-testid='lazy-column'], .scaffold-finite-scroll\")",
      ),
    );
    assert.ok(SCROLL_JS.includes('sel: "window"'));
    assert.ok(SCROLL_JS.includes("el.tagName.toLowerCase()"));
  });

  it("reports the JSON contract (sel/top/sh/ch, sel none when nothing qualifies)", () => {
    assert.ok(SCROLL_JS.includes("JSON.stringify"));
    assert.ok(SCROLL_JS.includes("sel: pick.sel"));
    assert.ok(SCROLL_JS.includes("top: Math.round(pick.el.scrollTop)"));
    assert.ok(SCROLL_JS.includes("sh: pick.el.scrollHeight"));
    assert.ok(SCROLL_JS.includes("ch: pick.el.clientHeight"));
    assert.ok(SCROLL_JS.includes('sel: "none"'));
  });
});

describe("the seen-stop set rides the tick into the walk (design 2026-11-13)", () => {
  it("stops the walk before round 1 on a seeded seen file — zero clicks, pre-stop mints still push", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const seenPath = await workPath("seen-tick-stop-seed.json");
    // The REAL contract seeds the file: saveState's v2 envelope carrying
    // the three urns the initial body is about to mint.
    await saveState(
      { version: CURRENT_STATE_VERSION, seenPostIds: {} },
      [1, 2, 3].map((n) => `urn:li:activity:${idAt(n)}`),
      seenPath,
      T0,
    );
    const payload = await workPath("payload-seen-stop.json");
    const contextFactory = contextFactoryFor({
      script: {
        initialBody: [
          cardBody(idAt(1), "hiring post — Jakarta"),
          cardBody(idAt(2), "hiring post — Bandung"),
          cardBody(idAt(3), "hiring post — Surabaya"),
        ].join("\n"),
      },
    });
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-seen-stop.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      payloadPath: payload,
      git,
      env: {},
      seenPath,
      markerPath: await workPath("marker-seen-stop.flag"),
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 3 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.posts.length, 3); // the pre-stop mints ride the payload
    assert.deepEqual(contextFactory.clicks(), []); // the stop fired BEFORE any round work
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.endsWith(`seen-stop: urn:li:activity:${idAt(3)}`)));
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });
});
