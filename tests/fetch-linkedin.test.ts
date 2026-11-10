/**
 * Offline suite for the PC fetch tick (slice 4).
 *
 * Pins pushPayload's single-path rebase+retry discipline over a fake
 * GitRunner, fetchTick's composition over the injected seams, the
 * leg-dead episode-marker edge, the Phase 8 tick guards (an all-faulted
 * walk is a quiet-zeros no-op while a fine-empty walk still writes and
 * pushes, defb8af), and the Phase 10 preflight + honest git failures: the
 * checkout guard (branch main + clean porcelain) runs BEFORE any fetch,
 * and every push-discipline failure carries git's own merged output.
 * Zero network, zero real email; the doubles carry every behavior pin
 * (realGit is exercised only by two read-only git spawns in its block).
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
import type { Surface, WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import {
  HALT_BUDGET_REASON,
  HALT_RATE_LIMIT_REASON,
  localDateKey,
} from "../src/linkedin-behavior.js";
import { type Transport, isHalt, isLegDead, legDead } from "../src/linkedin-fetch.js";
import { PAYLOAD_VERSION, type PayloadEnvelope } from "../src/linkedin-payload.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
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

/** Build a §6-shaped 200 body carrying the given activity ids (linkedin-fetch suite shape). */
const pageBody = (ids: readonly string[]): string =>
  JSON.stringify({
    data: {
      searchDashClustersByAll: {
        elements: [
          {
            items: ids.map((id) => ({
              item: {
                searchFeedUpdate: {
                  update: {
                    metadata: { backendUrn: `urn:li:activity:${id}` },
                    commentary: { text: { text: `post ${id}` } },
                    actor: { name: { text: `author ${id}` } },
                    socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                  },
                },
              },
            })),
          },
        ],
      },
    },
    included: [],
  });

/** Distinct activity ids at 1-second spacing (linkedin-fetch suite idiom). */
const idAt = (n: number): string => (BigInt(Date.UTC(2026, 9, 26, 9, 14, n)) << 22n).toString();

const transportFor = (
  body: string | Error,
): Transport & { disposeCount: () => number; gets: () => number } => {
  let disposeCount = 0;
  let getCount = 0;
  const get = async (): Promise<{ status: number; body: string }> => {
    getCount += 1;
    if (body instanceof Error) throw body;
    return { status: 200, body };
  };
  const dispose = async (): Promise<void> => {
    disposeCount += 1;
  };
  const transport: Transport = { get, dispose };
  return Object.assign(transport, { disposeCount: () => disposeCount, gets: () => getCount });
};

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
describe("fetchTick (compose cookies → transport → walk → payload → push)", () => {
  it("composes the tick end to end: payload written, single-path push, marker cleared", async () => {
    const payload = await workPath("tick-ok.json");
    const marker = await workPath("tick-ok.flag");
    await writeFile(marker, "dead session\n", "utf8"); // a stale episode: a clean tick clears it
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-1.flag"),
      budgetPath: await workPath("budget-1.json"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      transport,
      payloadPath: payload,
      git,
      env: {},
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
      text: `post ${idAt(1)}`,
      author: `author ${idAt(1)}`,
      permalink: `https://www.linkedin.com/posts/x-${idAt(1)}`,
      timestamp: new Date(Number(BigInt(idAt(1)) >> 22n)).toISOString(),
    };
    assert.deepEqual(envelope.posts, [expected]);
    assert.equal(transport.disposeCount(), 0); // caller-owned: fetchTick never disposes it
    assert.equal(await exists(marker), false); // the healthy tick cleared the episode
    // The two preflight reads (clean main, empty porcelain) precede the push discipline.
    assert.deepEqual(git.calls[0], ["rev-parse", "--abbrev-ref", "HEAD"]);
    assert.deepEqual(git.calls[1], ["status", "--porcelain"]);
    assert.equal(git.calls[2]?.[0], "add");
    assert.equal(git.calls[2]?.[1], payload); // ONLY the injected payload path
    assert.ok(git.calls.some((args) => args[0] === "commit"));
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });

  it("propagates leg-dead without writing the payload, pushing, or disposing", async () => {
    const payload = await workPath("tick-dead.json");
    const marker = await workPath("tick-dead.flag");
    const alarms: string[] = [];
    const transport = transportFor(legDead("bare HTTP 400 — dead session"));
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-2.flag"),
          budgetPath: await workPath("budget-2.json"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          transport,
          payloadPath: payload,
          git,
          env: {},
          markerPath: marker,
          alarm: async (reason) => {
            alarms.push(reason);
          },
        }),
      (error: unknown) => isLegDead(error) && /dead session/.test(error.reason),
    );
    assert.equal(transport.disposeCount(), 0); // caller-owned, even on failure
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
    const transport = transportFor(new Error("surface blew up"));
    const git = scriptGit({ "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-3.flag"),
      budgetPath: await workPath("budget-3.json"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      transport,
      payloadPath: payload,
      git,
      env: {},
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
    assert.equal(transport.disposeCount(), 0); // caller-owned, even on the no-op path
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /all 1 linkedin surface\(s\) faulted/.test(line)));
  });

  it("still writes and pushes a fine-empty walk's payload (defb8af: 0 faults + 0 posts is an outcome)", async () => {
    const payload = await workPath("tick-fine-empty.json");
    const marker = await workPath("tick-fine-empty.flag");
    const transport = transportFor(pageBody([])); // 200, zero posts, zero faults
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-4.flag"),
      budgetPath: await workPath("budget-4.json"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      transport,
      payloadPath: payload,
      git,
      env: {},
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
      budgetPath: await workPath("budget-5.json"),
      bypassWindow: true,
      config: { ...CONFIG, surfaces: [{ type: "tag", value: "hiring" }] },
      git,
      env: {}, // no LINKEDIN_COOKIES_FILE — the cookie resolver would throw if reached
      markerPath: await workPath("tick-noop.flag"),
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(git.calls.length, 0); // the guard sits AFTER this return — a threads-only config never demands a main checkout
  });

  it("opens the transport through resolveLinkedInTransport when none is injected", async () => {
    const payloadPath = await workPath("tick-resolver.json");
    const markerPath = await workPath("tick-resolver.flag");
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-6.flag"),
          budgetPath: await workPath("budget-6.json"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          env: { LINKEDIN_TRANSPORT: "wget" },
          payloadPath,
          git: scriptGit({ "rev-parse": { code: 0, output: "main" } }),
          markerPath,
        }),
      /LINKEDIN_TRANSPORT="wget" is not one of: curl, playwright/,
    );
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

  it("rejects a wrong branch naming it and the wrong-ref consequence — zero GETs, no payload", async () => {
    const payload = await workPath("tick-wrong-branch.json");
    const marker = await workPath("tick-wrong-branch.flag");
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({
      "rev-parse": { code: 0, output: "feature/add-support-for-linkeind" },
    });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-7.flag"),
          budgetPath: await workPath("budget-7.json"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          transport,
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
    assert.equal(transport.gets(), 0); // the guard precedes the walk — zero voyager GETs
    assert.equal(await exists(payload), false); // nothing written before the rejection
    assert.deepEqual(git.calls, [["rev-parse", "--abbrev-ref", "HEAD"]]); // throws before status
  });

  it("rejects a dirty tree naming the path count and the paths — zero GETs, no payload", async () => {
    const payload = await workPath("tick-dirty.json");
    const marker = await workPath("tick-dirty.flag");
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({
      "rev-parse": { code: 0, output: "main" },
      status: { code: 0, output: " M src/linkedin-fetch.ts\n M README.md" },
    });
    await assert.rejects(
      async () =>
        fetchTick({
          latchPath: await workPath("latch-8.flag"),
          budgetPath: await workPath("budget-8.json"),
          bypassWindow: true,
          config: CONFIG,
          cookies: COOKIES,
          transport,
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
    assert.equal(transport.gets(), 0); // no live fetch burned on a mis-homed checkout
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

// --- the anti-restriction preflight band + budget wrapper + latch (design 2026-11-09) ---

describe("the anti-restriction preflight band (design 2026-11-09)", () => {
  it("blocks a latched tick: zero GETs, zero git spawns, quiet zeros", async () => {
    const latchPath = await workPath("latch-1.flag");
    await writeFile(latchPath, "HTTP 429 rate limit\n", "utf8");
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      transport,
      git,
      payloadPath: await workPath("payload-latched.json"),
      latchPath,
      budgetPath: await workPath("budget-9.json"),
      bypassWindow: true,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(transport.gets(), 0);
    assert.equal(git.calls.length, 0);
  });

  it("outside the working window the tick is a quiet no-op (Saturday noon local)", async () => {
    const saturdayNoon = new Date(2026, 9, 31, 12, 0).getTime(); // 2026-10-31 is a Saturday
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      transport,
      git,
      payloadPath: await workPath("payload-weekend.json"),
      latchPath: await workPath("latch-9.flag"),
      budgetPath: await workPath("budget-10.json"),
      now: () => saturdayNoon,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(transport.gets(), 0);
    assert.equal(git.calls.length, 0);
  });

  it("inside the window (Monday 10:00 local, latch absent) the tick reaches the checkout guard", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime(); // 2026-10-26 is a Monday
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit({ "rev-parse": { code: 0, output: "feature\n" } });
    await assert.rejects(
      async () =>
        fetchTick({
          config: CONFIG,
          transport,
          git,
          payloadPath: await workPath("payload-weekday.json"),
          latchPath: await workPath("latch-10.flag"),
          budgetPath: await workPath("budget-11.json"),
          now: () => mondayTen,
          env: {},
        }),
      /not main/,
    );
    assert.ok(git.calls.length >= 1); // the band let it through to the guard
    assert.equal(transport.gets(), 0); // the guard threw before any GET
  });

  it("a spent daily budget skips the walk before any GET or git spawn", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const budgetPath = await workPath("budget-1.json");
    const dayKey = localDateKey(new Date(mondayTen));
    await writeFile(budgetPath, JSON.stringify({ localDate: dayKey, count: 150 }), "utf8");
    const transport = transportFor(pageBody([idAt(1)]));
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      transport,
      git,
      payloadPath: await workPath("payload-spent.json"),
      latchPath: await workPath("latch-11.flag"),
      budgetPath,
      now: () => mondayTen,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(transport.gets(), 0);
    assert.equal(git.calls.length, 0);
  });
});

describe("the budget wrapper on the VoyagerGet seam (design 2026-11-09)", () => {
  it("reserves and persists BEFORE each GET: the ledger counts every GET", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const budgetPath = await workPath("budget-2.json");
    const payloadPath = await workPath("payload-budget.json");
    const twoSurfaces = {
      ...CONFIG,
      surfaces: [
        { type: "linkedin", value: "#a" } as Surface,
        { type: "linkedin", value: "#b" } as Surface,
      ],
    };
    await fetchTick({
      config: twoSurfaces,
      cookies: COOKIES,
      transport: transportFor(pageBody([idAt(1)])),
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath,
      latchPath: await workPath("latch-12.flag"),
      budgetPath,
      now: () => mondayTen,
      bypassWindow: true,
      env: {},
    });
    const dayKey = localDateKey(new Date(mondayTen));
    const ledger = JSON.parse(await readFile(budgetPath, "utf8")) as {
      localDate: string;
      count: number;
    };
    assert.deepEqual(ledger, { localDate: dayKey, count: 2 });
  });

  it("a malformed budget file degrades to fresh with one warning naming the path", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const budgetPath = await workPath("budget-3.json");
    await writeFile(budgetPath, "{not json", "utf8");
    await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      transport: transportFor(pageBody([idAt(1)])),
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath: await workPath("payload-degraded.json"),
      latchPath: await workPath("latch-13.flag"),
      budgetPath,
      now: () => mondayTen,
      bypassWindow: true,
      env: {},
    });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    const budgetLine = lines.find((line) => line.includes("budget file unreadable"));
    assert.ok(budgetLine !== undefined);
    assert.ok(budgetLine!.includes(budgetPath));
    // The walk proceeded and the ledger came back valid.
    const ledger = JSON.parse(await readFile(budgetPath, "utf8")) as { count: number };
    assert.equal(ledger.count, 1);
  });

  it("a budget spent MID-WALK trips the latch with the budget reason", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const budgetPath = await workPath("budget-4.json");
    const latchPath = await workPath("latch-2.flag");
    const dayKey = localDateKey(new Date(mondayTen));
    await writeFile(budgetPath, JSON.stringify({ localDate: dayKey, count: 149 }), "utf8");
    const alarms: string[] = [];
    const twoSurfaces = {
      ...CONFIG,
      surfaces: [
        { type: "linkedin", value: "#a" } as Surface,
        { type: "linkedin", value: "#b" } as Surface,
      ],
    };
    const result = await fetchTick({
      config: twoSurfaces,
      cookies: COOKIES,
      transport: transportFor(pageBody([idAt(1)])),
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath: await workPath("payload-midwalk.json"),
      latchPath,
      budgetPath,
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async (reason) => {
        alarms.push(reason);
      },
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    const flag = await readFile(latchPath, "utf8");
    assert.equal(flag, `${HALT_BUDGET_REASON}\n`);
    assert.deepEqual(alarms, [HALT_BUDGET_REASON]);
  });
});

describe("the halt-latch trip (FR-7, design 2026-11-09)", () => {
  it("a 429 walks to a halt, trips the latch with the canonical reason, alarms once", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const latchPath = await workPath("latch-3.flag");
    const payloadPath = await workPath("payload-429.json");
    const alarms: string[] = [];
    const transport: Transport = {
      get: async () => ({ status: 429, body: "" }),
      dispose: async () => undefined,
    };
    const result = await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      transport,
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath,
      latchPath,
      budgetPath: await workPath("budget-12.json"),
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async (reason) => {
        alarms.push(reason);
      },
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    const flag = await readFile(latchPath, "utf8");
    assert.equal(flag, `${HALT_RATE_LIMIT_REASON}\n`);
    assert.deepEqual(alarms, [HALT_RATE_LIMIT_REASON]);
    assert.equal(await exists(payloadPath), false); // no payload on a halted tick
  });

  it("the latch trip never writes the leg-dead episode marker (separate channels)", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime();
    const latchPath = await workPath("latch-4.flag");
    const markerPath = await workPath("episode.flag");
    const transport: Transport = {
      get: async () => ({ status: 429, body: "" }),
      dispose: async () => undefined,
    };
    await fetchTick({
      config: CONFIG,
      cookies: COOKIES,
      transport,
      git: scriptGit({ "rev-parse": { code: 0, output: "main\n" } }),
      payloadPath: await workPath("payload-channels.json"),
      latchPath,
      budgetPath: await workPath("budget-13.json"),
      markerPath,
      now: () => mondayTen,
      bypassWindow: true,
      haltAlarm: async () => undefined,
      env: {},
    });
    assert.equal(await exists(latchPath), true);
    assert.equal(await exists(markerPath), false);
  });
});

describe("FR-0 stamp gate (slice 5)", () => {
  it("rejects a stampless cookie file before the transport opens or any GET", async () => {
    const stampless: LinkedInCookies = {
      liAt: "AQE-test",
      jsessionId: "ajax:0123456789012345678",
    };
    const payloadPath = await workPath("payload-stamp.json");
    const latchPath = await workPath("latch-stamp.flag");
    const budgetPath = await workPath("budget-stamp.json");
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
          transport: {
            get: async () => {
              throw new Error("no GET may leave on a stampless tick");
            },
            dispose: async () => undefined,
          },
          git,
          payloadPath,
          latchPath,
          budgetPath,
          now: () => new Date(2026, 9, 26, 10, 0).getTime(),
          bypassWindow: true,
          env: {},
        }),
      /harvestedAt.*login-linkedin/,
    );
    // The gate sits after the checkout guard: two git reads happened, zero writes.
    assert.deepEqual(gitCalls, ["rev-parse --abbrev-ref HEAD", "status --porcelain"]);
    assert.equal(await exists(payloadPath), false);
  });
});
