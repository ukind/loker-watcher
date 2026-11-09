/**
 * Offline pipeline suite for the Gate 2 unit seam (Slice 6, D7-D9).
 * runWatcher takes every I/O boundary as an injection — env literal,
 * context-factory double, fetch double, transport double, temp state file,
 * pinned clock — so a full pipeline run executes with zero network, zero
 * browser, and zero writes inside the repo. Covers: the zero-match run
 * persisting judged ids (Gate 2), the digest path, the all-seen Gate 1
 * byte-identity, heartbeat-disabled persistence, judge-skip persistence
 * (D3), the payload-seam mixed run, the absent-payload and belt degrades
 * (D13), the D13/D14 acquisition-shape pins, and the timeStage duration
 * measurement.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import type { WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import type {
  ContextFactory,
  ContextLike,
  LocatorLike,
  PageLike,
  ResponseLike,
} from "../src/fetch-threads.js";
import { flushAndSendExhaustionAlarm, runWatcher, timeStage } from "../src/index.js";
import type { AvailabilityResult } from "../src/judge-availability.js";
import { type HealthFile, loadAccountHealth } from "../src/judge-health.js";
import { isRotationExhausted } from "../src/judge-rotation.js";
import type { LlmAccount } from "../src/judge.js";
import type { PayloadRead } from "../src/linkedin-payload.js";
import type { AppState } from "../src/state.js";
import type { AccountFailure, JudgeVerdict, Post } from "../src/types.js";

// Pinned clock (UTC): 2026-10-26T09:14:00.000Z — every stage reads it
// through deps.now; the tests never touch the system clock.
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: ["hiring", "loker"],
  surfaces: [{ type: "tag", value: "hiring" }],
  platforms: { linkedin: true, threads: true },
  recencyHours: 72,
  reasoningEffort: "medium",
  scrollRounds: 8,
};

/** Mixed-platform config: the tag surface plus one linkedin surface. */
const MIXED_CONFIG: WatcherConfig = {
  ...CONFIG,
  surfaces: [
    { type: "tag", value: "hiring" },
    { type: "linkedin", value: "#hiring" },
  ],
};

const BASE_ENV: Record<string, string | undefined> = {
  THREADS_SESSION_STATE: Buffer.from(
    JSON.stringify({ cookies: [{ name: "session", value: "x" }] }),
  ).toString("base64"),
  LLM_ACCOUNTS: JSON.stringify([
    { baseUrl: "https://mock.api/v1", apiKey: "test-key", model: "test-model" },
  ]),
  GMAIL_USER: "alerts@example.com",
  GMAIL_APP_PASSWORD: "app-password",
};

/** 19-digit post id, mirroring the judge tests' helper. */
const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

/** Minimal graphql capture body: one thread_item per post, 1h old. */
const graphqlBody = (entries: ReadonlyArray<{ id: string; text: string }>): string =>
  JSON.stringify({
    data: {
      thread_items: entries.map((entry) => ({
        post: {
          pk: entry.id,
          caption: { text: entry.text },
          user: { username: `author-${entry.id.slice(-2)}` },
          taken_at: Math.floor((NOW - HOUR) / 1000),
        },
      })),
    },
  });

/** Response double the walk's graphql filter accepts. */
const graphqlResponse = (body: string): ResponseLike => ({
  url: () => "https://www.threads.com/api/graphql",
  status: () => 200,
  text: async () => body,
});

/** LinkedIn activity id whose embedded epoch ms equals the pinned NOW. */
const linkedinIdNow = (BigInt(NOW) << 22n).toString();

/** One normalized LinkedIn post for the injected payload-reader double. */
const linkedinPost = (id: string): Post => ({
  platform: "linkedin",
  id: `urn:li:activity:${id}`,
  text: `LinkedIn hiring post ${id}`,
  author: "linkedin-member",
  permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
  timestamp: iso(NOW),
});

/** Build a PayloadRead for the re-keyed linkedinFetch double (D6). */
const payloadRead = (posts: Post[], leg: PayloadRead["leg"], detail?: string): PayloadRead =>
  detail !== undefined ? { posts, leg, detail } : { posts, leg };

/** Minimal logged-out tag page: one data-sjs blob carrying the thread items. */
const tagPageHtml = (
  entries: ReadonlyArray<{ id: string; text: string; author: string }>,
): string =>
  `<html><head><script type="application/json" data-sjs="">${JSON.stringify({
    data: {
      thread_items: entries.map((entry) => ({
        post: {
          pk: entry.id,
          caption: { text: entry.text },
          user: { username: entry.author },
          taken_at: Math.floor((NOW - HOUR) / 1000),
        },
      })),
    },
  })}</script></head><body>hydrated</body></html>`;

/** Recent-tab locator that never becomes visible (both walks tolerate it). */
const missingTab = (): LocatorLike => {
  const tab: LocatorLike = {
    first: () => tab,
    waitFor: async () => {
      throw new Error("locator not found");
    },
    click: async () => undefined,
  };
  return tab;
};

/**
 * Context factory double for the authenticated walk: one page whose goto
 * fires the response listener with the given graphql capture.
 */
function singlePageContextFactory(capture: string): ContextFactory {
  return async () => {
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        const listeners: Array<(response: ResponseLike) => void> = [];
        return {
          goto: async () => {
            const response = graphqlResponse(capture);
            for (const listener of listeners) listener(response);
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => missingTab(),
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

/**
 * Context-factory double for the platform-split acquisition (Phase 4):
 * each page dispatches on its goto URL — threads URLs fire the graphql
 * capture (authenticated walk) or deliver threadsHtml via content()
 * (logged-out walk). Records every requested URL and every storage-state
 * path so a test can pin which surfaces were walked and that the session
 * temp dir was cleaned. (The LinkedIn leg rides the pushed payload since
 * slice 5 — no linkedin URL is ever walked.)
 */
function dualPlatformContextFactory(options: {
  threadsCapture: string;
  /** Page HTML for the logged-out Threads walk; absent = bare hydrated page. */
  threadsHtml?: string;
  urls?: string[];
  sessionPaths?: string[];
}): ContextFactory {
  return async (storageStatePath?: string) => {
    options.sessionPaths?.push(storageStatePath ?? "");
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        const listeners: Array<(response: ResponseLike) => void> = [];
        return {
          goto: async (url: string) => {
            options.urls?.push(url);
            for (const listener of listeners) listener(graphqlResponse(options.threadsCapture));
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => options.threadsHtml ?? "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => missingTab(),
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

/** Chat-completions 200 response carrying one message. */
const ok = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

/**
 * Chat-completions double: bulk calls answer every listed id with the given
 * verdict; single-post fallbacks answer the plain verdict object.
 */
function judgeFetch(verdict: JudgeVerdict): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each post below")) {
      const ids = content.match(/\b(?:urn:li:activity:)?\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) answer[id] = verdict;
      return ok(JSON.stringify(answer));
    }
    return ok(JSON.stringify(verdict));
  }) as unknown as typeof fetch;
}

/**
 * Bulk answers exactly the ids present in the verdict map (missing ids stay
 * absent — the post falls back); single-post retries fail with a 500 so the
 * fallback exhausts and the post is skipped (D3). The 500 shape and its
 * bounded backoff are the same pin the judge suite already ships.
 */
function partialBulkThenFailFetch(verdicts: Record<string, JudgeVerdict>): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each post below")) {
      const ids = content.match(/\b\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) {
        const verdict = verdicts[id];
        if (verdict !== undefined) answer[id] = verdict;
      }
      return ok(JSON.stringify(answer));
    }
    return new Response("Internal Server Error", { status: 500 });
  }) as unknown as typeof fetch;
}

/** Transport double recording subject lines and plain-text bodies. */
function recordingTransport() {
  const subjects: string[] = [];
  const texts: string[] = [];
  const transport = {
    sendMail: async (options: { subject: string; text: string }) => {
      subjects.push(options.subject);
      texts.push(options.text);
      return { messageId: "msg-1" };
    },
  } as unknown as Transporter;
  return { transport, subjects, texts };
}

/**
 * Pass-all availability double (D10): every judge-stage test injects it.
 * The DEFAULT checker would probe the judge fetch doubles — a 429/500
 * answer would mis-mark accounts unavailable, and the all-down skip
 * branch would flip mid-run exhaustion tests into green skip runs.
 */
const availabilityPassAll = async (): Promise<AvailabilityResult> => ({
  failures: [],
  degraded: false,
});

/** Three-account pool for the some-pass, all-down, and degrade scenarios. */
const THREE_ACCOUNT_ENV: Record<string, string | undefined> = {
  ...BASE_ENV,
  LLM_ACCOUNTS: JSON.stringify([
    { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
    { baseUrl: "https://two.api/v1", apiKey: "k2", model: "m2" },
    { baseUrl: "https://three.api/v1", apiKey: "k3", model: "m3" },
  ]),
};

const threeAccounts: LlmAccount[] = [
  { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
  { baseUrl: "https://two.api/v1", apiKey: "k2", model: "m2" },
  { baseUrl: "https://three.api/v1", apiKey: "k3", model: "m3" },
];

// Temp state files (offline rule: OS temp only, cleaned up once).
let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Temp state file path; seeds the file with a state document when given. */
async function tempStatePath(name: string, seed?: AppState): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));
  const path = join(dir, name);
  if (seed !== undefined) {
    await writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  }
  return path;
}

/** Temp health-file path for the flush assertions (same lazy dir). */
async function tempHealthPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));
  return join(dir, name);
}

describe("runWatcher", () => {
  it("persists judged ids on a zero-match run and still sends the heartbeat (Gate 2)", async () => {
    const posts = [
      { id: id19(1), text: "Looking for work as a frontend developer" },
      { id: id19(2), text: "Selling an ergonomic chair, barely used" },
    ];
    const statePath = await tempStatePath("gate2-zero-match.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 0, skipped: 0, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.equal(stored.version, 2);
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(1), id19(2)]);
    assert.equal(subjects.length, 1); // Gate 2 skips neither email nor write
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("sends the digest and persists judged ids when posts match", async () => {
    const posts = [
      { id: id19(3), text: "Hiring: senior backend engineer, remote in Indonesia" },
      { id: id19(4), text: "Hiring: frontend developer in Jakarta" },
    ];
    const statePath = await tempStatePath("match-digest.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 2, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /2 new job posts/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(3), id19(4)]);
  });

  it("leaves the state file byte-identical when everything is already seen (Gate 1) and still sends the heartbeat", async () => {
    const posts = [
      { id: id19(5), text: "Hiring: react developer, bandung on-site" },
      { id: id19(6), text: "Hiring: data analyst, remote" },
    ];
    const seed: AppState = {
      version: 2,
      seenPostIds: { [id19(5)]: iso(NOW - HOUR), [id19(6)]: iso(NOW - HOUR) },
    };
    const statePath = await tempStatePath("gate1-all-seen.json", seed);
    const before = await readFile(statePath, "utf8");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(await readFile(statePath, "utf8"), before);
    assert.equal(subjects.length, 1); // Gate 1 still notifies
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("still persists judged ids when the heartbeat is disabled", async () => {
    const posts = [{ id: id19(7), text: "Junior QA engineer opening in Surabaya" }];
    const statePath = await tempStatePath("heartbeat-off.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: { ...BASE_ENV, HEARTBEAT_ENABLED: "false" },
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.equal(subjects.length, 0); // disabled — yet the state write still ran
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(7)]);
  });

  it("keeps judge-skipped ids unseen while persisting the judged rest (D3)", async () => {
    const posts = [
      { id: id19(8), text: "Hiring: golang engineer, remote" },
      { id: id19(9), text: "Hiring: vue developer in Bali" },
    ];
    const statePath = await tempStatePath("skip-d3.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: partialBulkThenFailFetch({ [id19(8)]: { relevant: true, locationOk: true } }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 1, skipped: 1, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(8)]); // the skipped id stays unseen
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
  });

  it("rejects with the complete pool-ordered exhaustion record and never touches state at budget death", async () => {
    const posts = [{ id: id19(10), text: "Hiring: rust engineer, remote" }];
    const statePath = await tempStatePath("budget-death.json");
    const { transport, subjects } = recordingTransport();
    // Hand-stepped clock + inert park: three cooldown parks drain the
    // 3-minute budget instantly.
    let tick = 0;
    const now = (): number => tick;
    const sleepFn = (ms: number): Promise<void> => {
      tick += ms;
      return Promise.resolve();
    };
    const all429 = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await runWatcher({
        env: BASE_ENV,
        config: CONFIG,
        contextFactory: singlePageContextFactory(graphqlBody(posts)),
        fetchFn: all429,
        judgeAvailability: availabilityPassAll,
        transport,
        statePath,
        now,
        sleepFn,
      });
    } catch (error) {
      caught = error;
    }

    // The entry guard's contract: the tagged error with the complete
    // record — it turns that into exactly one exhaustion email + exit 1.
    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as { failures: Array<{ account: number }> }).failures.map((f) => f.account),
      [1],
    );
    // The judge throw happened before any notification or persistence:
    // no email fired, and the state file was never written.
    assert.deepEqual(subjects, []);
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/);
  });

  it("walks a mixed run: Threads through its session, LinkedIn through the pushed payload, and cleans the session dir", async () => {
    const urls: string[] = [];
    const sessionPaths: string[] = [];
    const linkedinCalls: Array<{ path: string; nowMs: number }> = [];
    const statePath = await tempStatePath("mixed-platform.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([
          { id: id19(11), text: "Hiring: python developer, jakarta remote" },
          { id: id19(12), text: "Hiring: devops engineer, bandung on-site" },
        ]),
        urls,
        sessionPaths,
      }),
      linkedinFetch: async (path, nowFn) => {
        linkedinCalls.push({ path, nowMs: nowFn() });
        return payloadRead([linkedinPost(linkedinIdNow)], "ok", "payload 0 min old");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 3, matches: 3, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /3 new job posts on Threads \+ LinkedIn/);
    // The reader got the fixed repo payload path and the injected clock.
    assert.deepEqual(linkedinCalls, [{ path: LINKEDIN_PAYLOAD_PATH, nowMs: NOW }]);
    // The Playwright walk never drove a linkedin URL...
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    // ...the digest marks the linkedin row and carries no leg line on ok...
    assert.ok(texts[0]?.includes("3. [linkedin] LinkedIn hiring post"));
    assert.ok(!texts[0]?.includes("LinkedIn leg:"));
    // ...both platform id forms reached the state file...
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [
      id19(11),
      id19(12),
      `urn:li:activity:${linkedinIdNow}`,
    ]);
    // ...and the Threads session temp file died with the run (F019; the
    // payload reader keeps no session dir — cookies ride the PC leg).
    assert.equal(sessionPaths.length, 1);
    for (const path of sessionPaths) {
      await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
    }
  });

  it("completes threads-only when the payload is absent, rendering the absent leg on the heartbeat", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const urls: string[] = [];
    const statePath = await tempStatePath("linkedin-payload-absent.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([{ id: id19(13), text: "Hiring: react developer, remote" }]),
        urls,
      }),
      linkedinFetch: async () => payloadRead([], "absent"),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    // The absent payload is the PC-off NORMAL (D13): a green threads-only
    // run, zero linkedin warns (the reader logs one quiet line instead).
    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !/linkedin/.test(line)));
    // The Gate 2 heartbeat renders the absent leg line — a threads-only run
    // is permanently quiet, so the heartbeat is where the dark leg shows.
    assert.equal(subjects.length, 1);
    assert.ok(texts[0]?.includes("LinkedIn leg: absent — no payload file"));
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(13)]);
  });

  it("degrades a linkedin-only config with an absent payload to a quiet threads-only heartbeat (Gate 1)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-only-absent.json");
    const { transport, subjects, texts } = recordingTransport();
    let linkedinCalls = 0;

    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: no threads surfaces
      linkedinFetch: async () => {
        linkedinCalls += 1;
        return payloadRead([], "absent");
      },
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(linkedinCalls, 1, "the reader runs whenever linkedin surfaces are configured");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !/linkedin/.test(line))); // absent is a quiet log, never a warn
    assert.equal(subjects.length, 1); // the Gate 1 heartbeat still fires
    assert.ok(texts[0]?.includes("LinkedIn leg: absent — no payload file"));
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // nothing persisted
  });

  it("keeps Threads results when the payload read faults at run time (acceptance 1, the D12 belt)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-payload-throws.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: { ...BASE_ENV, THREADS_SESSION_STATE: undefined }, // logged-out Threads walk
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([]), // unused: the Threads walk is logged-out
        threadsHtml: tagPageHtml([
          { id: id19(14), text: "Hiring: kotlin developer, jakarta", author: "techco" },
        ]),
      }),
      linkedinFetch: async () => {
        throw new Error("payload io exploded");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    // The belt degrades the fault to a warn + a malformed leg; the
    // logged-out Threads posts survive and the run completes (exit 0 shape).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin payload FAILED — payload io exploded/.test(line)));
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
    // The not-ok leg rides the digest (D13).
    assert.ok(texts[0]?.includes("LinkedIn leg: malformed — payload io exploded"));
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(14)]);
  });

  it("renders the stale leg line on a match-run digest even when the leg contributed no posts (D13)", async () => {
    const statePath = await tempStatePath("stale-leg-digest.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: singlePageContextFactory(
        graphqlBody([{ id: id19(16), text: "Hiring: scala developer, remote" }]),
      ),
      linkedinFetch: async () => payloadRead([], "stale", "payload 3h old"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    // One threads match; the stale leg rides the digest so a dark leg
    // stays visible on a match run too.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.ok(!texts[0]?.includes("[linkedin]")); // the stale leg contributed no posts
    assert.ok(texts[0]?.includes("\n\nLinkedIn leg: stale — payload 3h old\n"));
  });

  it("keeps LinkedIn posts on a linkedin-only config when a Threads session exists (D13 single return)", async () => {
    const statePath = await tempStatePath("linkedin-only-with-threads-session.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV, // THREADS_SESSION_STATE present
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: zero threads surfaces
      linkedinFetch: async () => payloadRead([linkedinPost(linkedinIdNow)], "ok"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    // The old empty-pool guard returned [] before the LinkedIn arm ran;
    // the single return keeps the LinkedIn posts (D13).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post on LinkedIn/);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [`urn:li:activity:${linkedinIdNow}`]);
  });

  it("logs every surface from the raw config partition in the startup line (D14)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const statePath = await tempStatePath("startup-surface-line.json");
    const { transport } = recordingTransport();

    await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        // A real post: an EMPTY authenticated capture trips the kept
        // all-fail gate and the run dies before the startup line is logged.
        threadsCapture: graphqlBody([{ id: id19(15), text: "Hiring: golang developer, remote" }]),
      }),
      linkedinFetch: async () => payloadRead([], "absent"),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /watch: surfaces: tag\/hiring, linkedin\/#hiring/.test(line)));
  });

  it("threads off: LinkedIn posts flow through the payload and no Threads walk runs", async () => {
    const posts = [linkedinPost(linkedinIdNow)];
    const statePath = await tempStatePath("threads-off.json");
    const { transport, subjects, texts } = recordingTransport();
    let payloadReads = 0;
    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...MIXED_CONFIG, platforms: { linkedin: true, threads: false } },
      contextFactory: async () => {
        throw new Error("the Threads walker must not run while platforms.threads is false");
      },
      linkedinFetch: async () => {
        payloadReads += 1;
        return payloadRead(posts, "ok");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.equal(payloadReads, 1);
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post on LinkedIn/);
    assert.doesNotMatch(subjects[0] ?? "", /Threads/);
    assert.ok(texts[0]?.includes("LinkedIn hiring post"));
  });

  it("both on: a LinkedIn-only match renders a LinkedIn-only subject", async () => {
    const statePath = await tempStatePath("linkedin-only-subject.json", {
      version: 2,
      seenPostIds: { [id19(41)]: iso(NOW - HOUR) }, // the Threads post is already seen — it never reaches the judge
    });
    const { transport, subjects } = recordingTransport();
    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: singlePageContextFactory(
        graphqlBody([{ id: id19(41), text: "Hiring: golang developer, remote" }]),
      ), // the Threads walk is healthy; everything it captured is already seen
      linkedinFetch: async () => payloadRead([linkedinPost(linkedinIdNow)], "ok"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post on LinkedIn/);
    assert.doesNotMatch(subjects[0] ?? "", /Threads/);
  });

  it("linkedin off: the payload reader is never called and the Threads walk still runs", async () => {
    const posts = [{ id: id19(31), text: "Hiring: svelte developer, remote" }];
    const statePath = await tempStatePath("linkedin-off.json");
    const { transport, subjects } = recordingTransport();
    let payloadReads = 0;
    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...MIXED_CONFIG, platforms: { linkedin: false, threads: true } },
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      linkedinFetch: async () => {
        payloadReads += 1;
        return payloadRead([], "absent");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.equal(payloadReads, 0);
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post on Threads/);
    assert.doesNotMatch(subjects[0] ?? "", /LinkedIn/);
  });

  it("both off: the parked run fetches nothing, emails nothing, and never touches state", async () => {
    const statePath = await tempStatePath("both-off.json");
    const { transport, subjects } = recordingTransport();
    let payloadReads = 0;
    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...MIXED_CONFIG, platforms: { linkedin: false, threads: false } },
      contextFactory: async () => {
        throw new Error("no fetch stage work may run while both platforms are off");
      },
      linkedinFetch: async () => {
        payloadReads += 1;
        return payloadRead([], "absent");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.equal(payloadReads, 0);
    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(subjects.length, 0); // no heartbeat, no digest
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // never read, never written
  });
});

// Provider health (the entry wiring): the resolve above Gate 1, the marks
// arg into judgePosts, the success-path flush, and the Gate-1 no-flush pin.
describe("provider health (the entry wiring)", () => {
  it("acceptance: hard-fail builds a streak, the second tick caps, and a probe success clears and rejoins", async () => {
    const posts = [
      { id: id19(20), text: "Hiring: elixir developer, remote" },
      { id: id19(21), text: "Hiring: react native developer, jakarta" },
    ];
    const statePath = await tempStatePath("acceptance-state.json");
    const healthPath = await tempHealthPath("acceptance-health.json");
    const { transport, subjects, texts } = recordingTransport();
    let accountOneOk = false;
    const auths: string[] = [];
    const fetchFn = (async (url: unknown): Promise<Response> => {
      auths.push(new URL(String(url)).host);
      if (!accountOneOk) {
        return new Response("Service Unavailable", { status: 503 });
      }
      // The recovered endpoint answers the whole batch in one call.
      return ok(
        JSON.stringify({
          [id19(20)]: { relevant: true, locationOk: true },
          [id19(21)]: { relevant: true, locationOk: true },
        }),
      );
    }) as unknown as typeof fetch;
    const runOnce = async (): Promise<{
      judged: number;
      matches: number;
      skipped: number;
      saved: boolean;
    }> =>
      runWatcher({
        env: BASE_ENV,
        config: CONFIG,
        contextFactory: singlePageContextFactory(graphqlBody(posts)),
        fetchFn,
        judgeAvailability: availabilityPassAll,
        transport,
        statePath,
        now: () => NOW,
        sleepFn: () => Promise.resolve(), // inert: the 503 backoffs never wait
        judgeHealth: (accounts) => loadAccountHealth(accounts, healthPath),
        judgeHealthPath: healthPath,
      });

    // Tick 1: the 503 stamps a hard failure — the streak builds to 1 (not yet capped).
    assert.deepEqual(await runOnce(), { judged: 2, matches: 0, skipped: 2, saved: false });
    assert.equal(auths.length, 4); // the terminal attempt + the three same-account backoffs
    let stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.marks["https://mock.api/v1"], 1);

    // Tick 2: the second hard-failed tick — the streak reaches the cap threshold.
    assert.deepEqual(await runOnce(), { judged: 2, matches: 0, skipped: 2, saved: false });
    stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.marks["https://mock.api/v1"], 2);

    // Tick 3: capped at 1 request/tick — the probe. The endpoint recovered:
    // the success clears the mark in-run and the batch answers in that call.
    auths.length = 0;
    accountOneOk = true;
    assert.deepEqual(await runOnce(), { judged: 2, matches: 2, skipped: 0, saved: true });
    assert.equal(auths.length, 1); // exactly the probe dispatch — half-open
    // Three emails: two Gate-2 heartbeats, then the match digest — which
    // still renders the degraded line (the load-time marks were capped).
    assert.equal(subjects.length, 3);
    assert.match(subjects[2] ?? "", /2 new job posts/);
    assert.ok(
      texts[2]?.includes(
        "Degraded LLM account(s): #1 https://mock.api/v1 — capped at 1 request/tick",
      ),
    );
    // The flush cleared the mark (the success reset the streak).
    stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.deepEqual(stored.marks, {});
    assert.equal(stored.outageOpen, false);
  });

  it("renders the degraded-accounts line on the Gate 1 heartbeat — marks load above the gate", async () => {
    const posts = [{ id: id19(22), text: "Hiring: pragma developer, remote" }];
    const seed: AppState = {
      version: 2,
      seenPostIds: { [id19(22)]: iso(NOW - HOUR) },
    };
    const statePath = await tempStatePath("gate1-degraded.json", seed);
    const before = await readFile(statePath, "utf8");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
      judgeHealth: async () => ({
        marks: new Map([[0, 2]]),
        file: { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
      }),
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(await readFile(statePath, "utf8"), before); // Gate 1: state untouched
    assert.equal(subjects.length, 1); // the Gate 1 heartbeat still fires
    assert.ok(
      texts[0]?.includes(
        "Degraded LLM account(s): #1 https://mock.api/v1 — capped at 1 request/tick",
      ),
    );
  });

  it("never flushes health on Gate 1 — zero dispatches cannot clear marks (FR7)", async () => {
    const posts = [{ id: id19(23), text: "Hiring: elm developer, remote" }];
    const seed: AppState = { version: 2, seenPostIds: { [id19(23)]: iso(NOW - HOUR) } };
    const statePath = await tempStatePath("gate1-no-flush.json", seed);
    const healthPath = await tempHealthPath("gate1-no-flush-health.json");
    const { transport } = recordingTransport();

    await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
      judgeHealth: async () => ({
        marks: new Map([[0, 2]]),
        file: { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
      }),
      judgeHealthPath: healthPath,
    });

    await assert.rejects(() => readFile(healthPath, "utf8"), /ENOENT/);
  });
});

describe("availability pre-check (the entry wiring)", () => {
  it("runs the default checker over deps.fetchFn — an all-pass pool behaves exactly as today (FR4)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [{ id: id19(30), text: "Hiring: ruby developer, remote" }];
    const statePath = await tempStatePath("availability-all-pass.json");
    const { transport, subjects } = recordingTransport();
    const bodies: string[] = [];
    const judgeDouble = judgeFetch({ relevant: true, locationOk: true }) as (
      url: unknown,
      options?: unknown,
    ) => Promise<Response>;
    const probingFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      bodies.push((options as { body: string }).body);
      return judgeDouble(url, options);
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: probingFetch,
      transport,
      statePath,
      now: () => NOW,
    });

    // FR4: same digest, same persistence — the only additions are the
    // availability log lines.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.match(subjects[0] ?? "", /1 new job post/);
    // One tiny probe per account rode the same production fetch default,
    // then the judged batch.
    const probeBodies = bodies.filter((body) => body.includes("Reply with the single word"));
    assert.equal(probeBodies.length, 3);
    assert.equal(bodies.length - probeBodies.length, 1);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /availability: 3 of 3 account\(s\) available/.test(line)));
  });

  it("some-pass: refused accounts sit out with their reason and only survivors dispatch", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [{ id: id19(31), text: "Hiring: swift developer, remote" }];
    const statePath = await tempStatePath("availability-some-pass.json");
    const { transport, subjects } = recordingTransport();
    const judgeHosts: string[] = [];
    const fetchFn = (async (url: unknown): Promise<Response> => {
      judgeHosts.push(new URL(String(url)).host);
      return ok(JSON.stringify({ [id19(31)]: { relevant: true, locationOk: true } }));
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({
        failures: [
          { account: 1, baseUrl: "https://one.api/v1", reason: "HTTP 429" },
          { account: 3, baseUrl: "https://three.api/v1", reason: "HTTP 503" },
        ],
        degraded: false,
      }),
    });

    // The run completed on the survivors and the digest went out.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    // The refused seats never dispatched: only the survivor's host called.
    assert.ok(judgeHosts.length > 0);
    assert.ok(judgeHosts.every((host) => host === "two.api"));
    // The sit-out lines name each refused account with its real reason.
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /account 1 \(https:\/\/one\.api\/v1\) sits out — HTTP 429/.test(line)),
    );
    assert.ok(
      lines.some((line) => /account 3 \(https:\/\/three\.api\/v1\) sits out — HTTP 503/.test(line)),
    );
    assert.ok(lines.some((line) => /availability: 1 of 3 account\(s\) available/.test(line)));
  });

  it("all-down: no judge call, ids stay unseen, one alarm reads 3 of 3, exit-0 run shape", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [
      { id: id19(32), text: "Hiring: php developer, remote" },
      { id: id19(33), text: "Hiring: laravel developer, bandung" },
    ];
    const statePath = await tempStatePath("availability-all-down.json");
    const healthPath = await tempHealthPath("availability-all-down-health.json");
    const { transport, subjects, texts } = recordingTransport();
    let judgeCalls = 0;
    const fetchFn = (async (): Promise<Response> => {
      judgeCalls += 1;
      return ok("{}");
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({
        failures: [
          { account: 1, baseUrl: "https://one.api/v1", reason: "HTTP 429" },
          { account: 2, baseUrl: "https://two.api/v1", reason: "network error: socket hang up" },
          {
            account: 3,
            baseUrl: "https://three.api/v1",
            reason: "unusable answer: missing message content",
          },
        ],
        degraded: false,
      }),
      judgeHealth: (accounts) => loadAccountHealth(accounts, healthPath),
      judgeHealthPath: healthPath,
    });

    // FR5: the honest skip run — exit 0 by resolution, nothing judged,
    // nothing persisted, the alarm the only mail (no heartbeat on skip).
    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 2, saved: false });
    assert.equal(judgeCalls, 0); // no judge call reached the dead pool
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // ids stay unseen
    assert.equal(subjects.length, 1); // the alarm, not the heartbeat
    assert.match(subjects[0] ?? "", /LLM judge pool exhausted \(3 of 3 accounts failed\)/);
    assert.ok(texts[0]?.includes("1. account 1 (https://one.api/v1) — HTTP 429"));
    assert.ok(!texts[0]?.includes("Still working")); // no survivors line
    // The run log names 0 of N: the counts line and the skip line.
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /availability: 0 of 3 account\(s\) available/.test(line)));
    assert.ok(lines.some((line) => /skipping the judge stage/.test(line)));
    // The skip flush flipped the episode bit and preserved every mark
    // (empty outcomes — pre-check 429s never reach the marks merge).
    const stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    assert.deepEqual(stored.marks, {});
  });

  it("two consecutive skips alarm once and preserve marks: the skip flush passes empty outcomes", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const posts = [{ id: id19(34), text: "Hiring: go developer, remote" }];
    const statePath = await tempStatePath("availability-dedup-state.json");
    const healthPath = await tempHealthPath("availability-dedup-health.json");
    // Seed: one account mid-streak, no open episode — the skip flushes
    // must not touch the mark (a pre-check refusal is NOT a provider
    // health failure) and the second tick must not re-alarm.
    await writeFile(
      healthPath,
      `${JSON.stringify(
        { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const { transport, subjects } = recordingTransport();
    const deps = {
      env: BASE_ENV, // the single-account pool
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: (async (): Promise<Response> => {
        throw new Error("judge must never dispatch on a skip run");
      }) as unknown as typeof fetch,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({
        failures: [{ account: 1, baseUrl: "https://mock.api/v1", reason: "HTTP 429" }],
        degraded: false,
      }),
      judgeHealth: (accounts: readonly LlmAccount[]) => loadAccountHealth(accounts, healthPath),
      judgeHealthPath: healthPath,
    };

    // Tick 1: the episode opens and the alarm fires.
    assert.deepEqual(await runWatcher(deps), { judged: 0, matches: 0, skipped: 1, saved: false });
    assert.equal(subjects.length, 1);
    // Tick 2: same pool, same refusal — the open bit suppresses.
    assert.deepEqual(await runWatcher(deps), { judged: 0, matches: 0, skipped: 1, saved: false });
    assert.equal(subjects.length, 1); // one alarm per episode
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /outage episode already open/.test(line)));
    // The seeded mark survived both skip flushes verbatim; the bit is open.
    const stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.deepEqual(stored.marks, { "https://mock.api/v1": 2 });
    assert.equal(stored.outageOpen, true);
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/);
  });

  it("a degraded checker result runs the stage unfiltered — the tick never crashes on the pre-check", async () => {
    const posts = [{ id: id19(35), text: "Hiring: kotlin developer, remote" }];
    const statePath = await tempStatePath("availability-degraded.json");
    const { transport, subjects } = recordingTransport();
    let judgeCalls = 0;
    const fetchFn = (async (): Promise<Response> => {
      judgeCalls += 1;
      return ok(JSON.stringify({ [id19(35)]: { relevant: true, locationOk: true } }));
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({ failures: [], degraded: true }),
    });

    // Degraded = all-available: the judge dispatched, the run completed.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.ok(judgeCalls >= 1);
  });

  it("the extracted alarm helper passes the pool size: a mid-run record reads 2 of 3 (D8/D9)", async () => {
    const healthPath = await tempHealthPath("availability-wording-health.json");
    const { transport, subjects, texts } = recordingTransport();
    const alarmDeps = {
      accounts: threeAccounts,
      health: { marks: new Map<number, number>(), file: undefined },
      outcomes: { ok: [] as number[], failed: new Map<number, string>() },
      failures: [
        { account: 1, baseUrl: "https://one.api/v1", reason: "HTTP 429" },
        { account: 2, baseUrl: "https://two.api/v1", reason: "network error: socket hang up" },
      ] as AccountFailure[],
      env: BASE_ENV,
      transport,
      judgeHealthPath: healthPath,
    };

    await flushAndSendExhaustionAlarm(alarmDeps);

    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], "LLM judge pool exhausted (2 of 3 accounts failed)");
    assert.ok(
      texts[0]?.includes("The LLM judge pool is exhausted — 2 of 3 LLM_ACCOUNTS accounts failed."),
    );
    assert.ok(texts[0]?.includes("Still working this run: account 3."));
    // The flush ran through the injected path and opened the episode bit.
    const stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    // A second episode call on the same file suppresses (one per episode):
    // the helper reads its PRE-FLUSH snapshot, so the caller re-resolves
    // the read from disk exactly like the entry catch does per invocation.
    const reloaded = await loadAccountHealth(threeAccounts, healthPath);
    await flushAndSendExhaustionAlarm({ ...alarmDeps, health: reloaded });
    assert.equal(subjects.length, 1);
  });
});

describe("timeStage", () => {
  it("returns the stage value and its duration under an injected clock", async () => {
    let tick = 100;
    const { value, durationMs } = await timeStage(
      async () => {
        tick += 50;
        return "done";
      },
      () => tick,
    );
    assert.equal(value, "done");
    assert.equal(durationMs, 50);
  });

  it("never reports a negative duration when the clock steps back", async () => {
    let tick = 100;
    const { durationMs } = await timeStage(
      async () => {
        tick -= 5;
        return undefined;
      },
      () => tick,
    );
    assert.equal(durationMs, 0);
  });
});
