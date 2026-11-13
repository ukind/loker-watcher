/**
 * Offline suite for the fetch pools + context factory seam (D4/D5).
 * Every case injects a ContextFactory double — importing this file never
 * loads Playwright. Covers: input-order results, partial failure, all-fail
 * throw (both message shapes), empty-surface tracking, FETCH_CONCURRENCY
 * peak, the single storage-state context, and context teardown.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedSurface } from "../src/config-file.js";
import {
  type ContextFactory,
  type ContextLike,
  FETCH_CONCURRENCY,
  type LocatorLike,
  type PageLike,
  type ResponseLike,
  fetchSurfaces,
  fetchSurfacesAuthenticated,
} from "../src/fetch-threads.js";

const surface = (label: string): ResolvedSurface => ({
  platform: "threads",
  label,
  url: `https://www.threads.com/${label}`,
  type: label.startsWith("tag/") ? "tag" : "url",
  value: label.startsWith("tag/") ? label.slice("tag/".length) : `https://www.threads.com/${label}`,
});

/** 19-digit post id, mirroring the judge tests' id helper. */
const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

/** Minimal graphql capture body: one thread_item carrying one post. */
const graphqlBody = (id: string): string =>
  JSON.stringify({
    data: {
      thread_items: [
        {
          post: {
            pk: id,
            caption: { text: `Hiring frontend developer ${id}` },
            user: { username: `author-${id.slice(-2)}` },
            taken_at: 1_792_755_976,
          },
        },
      ],
    },
  });

/** Multi-item graphql capture body: N thread_items carrying N posts
 * (F014: the post-cap and scroll-gain fixtures need bulk captures; the
 * thread_item shape mirrors the single-id graphqlBody helper exactly). */
const graphqlBodyMany = (ids: readonly string[]): string =>
  JSON.stringify({
    data: {
      thread_items: ids.map((id) => ({
        post: {
          pk: id,
          caption: { text: `Hiring frontend developer ${id}` },
          user: { username: `author-${id.slice(-2)}` },
          taken_at: 1_792_755_976,
        },
      })),
    },
  });

/** Response double the walk's graphql filter accepts (url + status + body). */
const graphqlResponse = (body: string): ResponseLike => ({
  url: () => "https://www.threads.com/api/graphql",
  status: () => 200,
  text: async () => body,
});

/** One data-sjs blob page: thread_items SSR'd into the document (the
 * search-surface shape — run 43399922260 measured 0 graphql XHRs there). */
const blobPage = (ids: readonly string[]): string =>
  `<html><head><script type="application/json" data-sjs>${JSON.stringify({
    data: {
      thread_items: ids.map((id) => ({
        post: {
          pk: id,
          caption: { text: `Hiring frontend developer ${id}` },
          user: { username: `author-${id.slice(-2)}` },
          taken_at: 1_792_755_976,
        },
      })),
    },
  })}</script></head><body></body></html>`;

/**
 * Context factory double. Pages decide success/failure at goto time by URL
 * substring (pool workers claim surface indexes at microtask boundaries, so
 * pages cannot be mapped to labels at creation time). When the URL matches
 * an xhr entry, the double fires the response listener with a graphql body
 * — the same async shape as a real capture. The Recent-tab locator never
 * becomes visible unless recentTabVisible is set (both walks tolerate its
 * absence), and waits resolve immediately. Each evaluate call (one scroll
 * round of the authenticated walk) bumps the evaluate counter and fires the
 * response listener with the round's staged scroll body, so the dry-round
 * counter, the scroll ceiling, and the post cap are all observable offline.
 * Tracks open pages for the concurrency peak, records Recent-tab clicks and
 * settle waits, and flags context teardown.
 */
function fakeContextFactory(options: {
  concurrency: { inFlight: number; peak: number };
  failUrls?: ReadonlySet<string>;
  xhrBySubstring?: ReadonlyMap<string, string>;
  /** The storage-state path per context creation — the authenticated walk builds exactly one. */
  sessionPaths?: string[];
  closed?: { value: boolean };
  /** One graphql body per scroll round; evaluate round N fires element N-1. */
  scrollBodies?: readonly string[];
  /** Per-round counter — the dry-round, scroll-ceiling, and cap oracle. */
  evaluate?: { calls: number };
  /** When true the Recent tab resolves; default keeps the missing-tab path. */
  recentTabVisible?: boolean;
  /** Click spy for the visible-tab path. */
  recentTabClicks?: number[];
  /** waitForTimeout durations in call order (the settle-window oracle). */
  settleWaits?: number[];
  /** The HTML page.content() serves; default keeps the blob-free body. */
  pageContent?: string;
}): ContextFactory {
  const failUrls = options.failUrls ?? new Set<string>();
  const xhrBySubstring = options.xhrBySubstring ?? new Map<string, string>();
  const scrollBodies = options.scrollBodies ?? [];
  return async (storageStatePath?: string) => {
    options.sessionPaths?.push(storageStatePath ?? "");
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        options.concurrency.inFlight += 1;
        options.concurrency.peak = Math.max(options.concurrency.peak, options.concurrency.inFlight);
        let open = true;
        const listeners: Array<(response: ResponseLike) => void> = [];
        const fire = (response: ResponseLike): void => {
          for (const listener of listeners) listener(response);
        };
        const page: PageLike = {
          goto: async (url: string) => {
            if ([...failUrls].some((fragment) => url.includes(fragment))) {
              throw new Error(`navigation failed for ${url}`);
            }
            const entry = [...xhrBySubstring.entries()].find(([fragment]) =>
              url.includes(fragment),
            );
            if (entry !== undefined) fire(graphqlResponse(entry[1]));
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => options.pageContent ?? "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => {
            if (options.recentTabVisible === true) {
              const visibleTab: LocatorLike = {
                first: () => visibleTab,
                waitFor: async () => undefined,
                click: async () => {
                  options.recentTabClicks?.push(1);
                },
              };
              return visibleTab;
            }
            const missingTab: LocatorLike = {
              first: () => missingTab,
              waitFor: async () => {
                throw new Error("locator not found"); // recentVisible = false path
              },
              click: async () => undefined,
            };
            return missingTab;
          },
          evaluate: async () => {
            const round = (options.evaluate?.calls ?? 0) + 1;
            if (options.evaluate !== undefined) options.evaluate.calls = round;
            const body = scrollBodies[round - 1];
            if (body !== undefined) fire(graphqlResponse(body));
            return undefined;
          },
          waitForTimeout: async (ms: number) => {
            options.settleWaits?.push(ms);
            return undefined;
          },
          close: async () => {
            if (!open) return;
            open = false;
            options.concurrency.inFlight -= 1;
          },
        };
        return page;
      },
      addInitScript: async () => undefined,
      close: async () => {
        if (options.closed !== undefined) options.closed.value = true;
      },
    };
    return context;
  };
}

describe("fetchSurfaces", () => {
  it("returns HTML in input order while at most FETCH_CONCURRENCY pages are open", async () => {
    const surfaces = Array.from({ length: 8 }, (_, i) => surface(`tag/s${i + 1}`));
    const concurrency = { inFlight: 0, peak: 0 };
    const closed = { value: false };

    const result = await fetchSurfaces(surfaces, fakeContextFactory({ concurrency, closed }));

    assert.deepEqual(
      result.map((fetched) => fetched.label),
      surfaces.map((s) => s.label),
    );
    assert.ok(concurrency.peak > 1, `pages never overlapped (peak ${concurrency.peak})`);
    assert.ok(
      concurrency.peak <= FETCH_CONCURRENCY,
      `peak ${concurrency.peak} exceeded FETCH_CONCURRENCY ${FETCH_CONCURRENCY}`,
    );
    assert.equal(closed.value, true);
  });

  it("keeps successes in input order when some surfaces fail", async () => {
    const surfaces = [1, 2, 3, 4].map((i) => surface(`tag/s${i}`));
    const failUrls = new Set(["tag/s2", "tag/s4"]);

    const result = await fetchSurfaces(
      surfaces,
      fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, failUrls }),
    );

    assert.deepEqual(
      result.map((fetched) => fetched.label),
      ["tag/s1", "tag/s3"],
    );
  });

  it("carries the raw surface pair past the successes filter (the stamp survives compaction)", async () => {
    const surfaces: ResolvedSurface[] = [
      {
        platform: "threads",
        label: "tag/hiring",
        url: "https://www.threads.com/tag/hiring",
        type: "tag",
        value: "hiring",
      },
      {
        platform: "threads",
        label: "https://www.threads.com/@hiresflow",
        url: "https://www.threads.com/@hiresflow",
        type: "url",
        value: "https://www.threads.com/@hiresflow",
      },
    ];
    const failUrls = new Set(["tag/hiring"]);

    const result = await fetchSurfaces(
      surfaces,
      fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, failUrls }),
    );

    assert.deepEqual(
      result.map((fetched) => ({ type: fetched.type, value: fetched.value })),
      [{ type: "url", value: "https://www.threads.com/@hiresflow" }],
    );
  });

  it("throws with per-surface errors in input order when every surface fails", async () => {
    const surfaces = [1, 2].map((i) => surface(`tag/s${i}`));
    const failUrls = new Set(["tag/s1", "tag/s2"]);

    await assert.rejects(
      () =>
        fetchSurfaces(
          surfaces,
          fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, failUrls }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^fetch: all 2 surface\(s\) failed:\n/);
        assert.match(error.message, /tag\/s1: navigation failed/);
        assert.match(error.message, /tag\/s2: navigation failed/);
        assert.ok(error.message.indexOf("tag/s1") < error.message.indexOf("tag/s2"));
        return true;
      },
    );
  });
});

describe("fetchSurfacesAuthenticated", () => {
  it("collects graphql-captured posts in input order across concurrent surfaces", async () => {
    const surfaces = [1, 2, 3].map((i) => surface(`tag/a${i}`));
    const xhrBySubstring = new Map(surfaces.map((s, i) => [s.label, graphqlBody(id19(i + 1))]));

    const result = await fetchSurfacesAuthenticated(
      surfaces,
      "session-state.json",
      fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, xhrBySubstring }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1), id19(2), id19(3)],
    );
  });

  it("stamps every captured post with the surface that collected it (email-per-surface)", async () => {
    const surfaces = [surface("tag/a1"), surface("url/x")];
    const xhrBySubstring = new Map(
      surfaces.map((s, i) => [s.label, graphqlBody(id19(i + 1))] as const),
    );

    const result = await fetchSurfacesAuthenticated(
      surfaces,
      "session-state.json",
      fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, xhrBySubstring }),
    );

    assert.deepEqual(
      result.map((post) => ({ id: post.id, surfaces: post.surfaces })),
      [
        { id: id19(1), surfaces: [{ type: "tag", value: "a1" }] },
        { id: id19(2), surfaces: [{ type: "url", value: "https://www.threads.com/url/x" }] },
      ],
    );
  });

  it("extracts the data-sjs blob posts when the graphql capture stays empty (search-surface shape)", async () => {
    const surfaces = [surface("tag/a1")];

    const result = await fetchSurfacesAuthenticated(
      surfaces,
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        pageContent: blobPage([id19(1), id19(2)]),
      }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1), id19(2)],
    );
  });

  it("merges blob posts after the graphql capture, first-wins by id (no duplicates)", async () => {
    const surfaces = [surface("tag/a1")];

    const result = await fetchSurfacesAuthenticated(
      surfaces,
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/a1", graphqlBody(id19(1))]]),
        pageContent: blobPage([id19(1), id19(2)]),
      }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1), id19(2)],
    );
  });

  it("throws listing each failure when every authenticated surface fails", async () => {
    const surfaces = [1, 2].map((i) => surface(`tag/a${i}`));
    const failUrls = new Set(["tag/a1", "tag/a2"]);

    await assert.rejects(
      () =>
        fetchSurfacesAuthenticated(
          surfaces,
          "session-state.json",
          fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, failUrls }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^fetch: all 2 authenticated surface\(s\) failed:\n/);
        assert.match(error.message, /tag\/a1: navigation failed/);
        assert.match(error.message, /tag\/a2: navigation failed/);
        assert.doesNotMatch(error.message, /0 post\(s\) extracted/);
        return true;
      },
    );
  });

  it("tracks zero-post surfaces in the all-fail detail when nothing is extracted", async () => {
    const surfaces = [1, 2].map((i) => surface(`tag/a${i}`));

    await assert.rejects(
      () =>
        fetchSurfacesAuthenticated(
          surfaces,
          "session-state.json",
          fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 } }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^fetch: all 2 authenticated surface\(s\) failed:\n/);
        assert.match(
          error.message,
          /tag\/a1, tag\/a2: 0 post\(s\) extracted — the Recent tab, the graphql XHR capture, and the data-sjs blobs yielded nothing/,
        );
        assert.doesNotMatch(error.message, /navigation failed/);
        return true;
      },
    );
  });

  it("stops after 3 dry scroll rounds and keeps the captured post", async (t) => {
    const evaluate = { calls: 0 };
    const logs = t.mock.method(console, "log", console.log.bind(console));

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/dry")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/dry", graphqlBody(id19(1))]]),
        evaluate,
      }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1)],
    );
    assert.equal(evaluate.calls, 3); // the dry counter stops the walk, not the scroll ceiling
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /\(dry 3\/3\)/.test(line)),
      `no (dry 3/3) log line in: ${JSON.stringify(lines)}`,
    );
  });

  it("keeps scrolling to the 8-round ceiling while every round gains fresh posts", async () => {
    const evaluate = { calls: 0 };
    // Rounds 1-6 each gain 3 posts (the dry counter resets); rounds 7-8 gain
    // 0 — only two drys, so the loop ends at the scroll ceiling, not dry 3/3.
    const scrollBodies = [1, 2, 3, 4, 5, 6].map((round) =>
      graphqlBodyMany([id19(3 * round - 1), id19(3 * round), id19(3 * round + 1)]),
    );

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/reset")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/reset", graphqlBody(id19(1))]]),
        evaluate,
        scrollBodies,
      }),
    );

    assert.equal(result.length, 19); // 1 captured at goto + 6 rounds x 3 posts
    assert.equal(evaluate.calls, 8);
  });

  it("breaks on the post cap after one scroll round with exactly 150 posts", async () => {
    const evaluate = { calls: 0 };
    const all = Array.from({ length: 150 }, (_, i) => id19(i + 1));

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/cap")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/cap", graphqlBodyMany(all)]]),
        evaluate,
      }),
    );

    assert.equal(result.length, 150); // one response may carry all 150 (the cap is not per-item)
    assert.equal(evaluate.calls, 1); // the cap break fires after round 1's dry log
  });

  it("ignores graphql responses that arrive once the post cap is reached", async () => {
    const evaluate = { calls: 0 };
    const all = Array.from({ length: 150 }, (_, i) => id19(i + 1));
    const late = Array.from({ length: 100 }, (_, i) => id19(151 + i));

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/late")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/late", graphqlBodyMany(all)]]),
        evaluate,
        scrollBodies: [graphqlBodyMany(late)], // fired by the round-1 evaluate
      }),
    );

    assert.equal(result.length, 150);
    assert.ok(result.every((post) => !late.includes(post.id)));
  });

  it("keeps walking when one surface yields zero posts and another captures posts", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/empty"), surface("tag/rich")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/rich", graphqlBody(id19(1))]]),
      }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1)],
    ); // tracked, not thrown
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /tag\/empty: 0 post\(s\) \(authenticated\)/.test(line)));
  });

  it("logs the tab-timeout line when the Recent tab never renders", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/noTab")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/noTab", graphqlBody(id19(1))]]),
      }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1)],
    ); // the default view still captures
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) =>
        /tag\/noTab — the Recent tab did not render within 45s, keeping the URL's default view/.test(
          line,
        ),
      ),
    );
  });

  it("logs the tab-timeout line for a profile surface too and never warns", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const warns = t.mock.method(console, "warn", console.warn.bind(console));

    const result = await fetchSurfacesAuthenticated(
      [surface("profile/dev")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["profile/dev", graphqlBody(id19(1))]]),
      }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1)],
    );
    const logLines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      logLines.some((line) => /profile\/dev — the Recent tab did not render within 45s/.test(line)),
    );
    const warnLines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(warnLines.every((line) => !line.includes("Recent tab")));
  });

  it("clicks the Recent tab once and waits the settle window when it is visible", async () => {
    const evaluate = { calls: 0 };
    const recentTabClicks: number[] = [];
    const settleWaits: number[] = [];

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/recent")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/recent", graphqlBody(id19(1))]]),
        evaluate,
        recentTabVisible: true,
        recentTabClicks,
        settleWaits,
      }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1)],
    );
    assert.equal(recentTabClicks.length, 1); // one click, not one per scroll round
    assert.equal(settleWaits[0], 5000); // the Recent settle rides before the scroll settles
  });
  it("clicks the Recent tab on a url surface too (search pages carry the tab)", async () => {
    const recentTabClicks: number[] = [];

    await fetchSurfacesAuthenticated(
      [surface("url/search")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["url/search", graphqlBody(id19(1))]]),
        recentTabVisible: true,
        recentTabClicks,
      }),
    );

    assert.equal(recentTabClicks.length, 1);
  });

  it("builds its one context from the storage-state path and tears it down", async () => {
    const sessionPaths: string[] = [];
    const closed = { value: false };

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/ctx")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/ctx", graphqlBody(id19(1))]]),
        sessionPaths,
        closed,
      }),
    );

    assert.deepEqual(sessionPaths, ["session-state.json"]); // one context, from the session
    assert.equal(closed.value, true);
    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1)],
    );
  });

  it("bounds the Threads scroll loop with scrollRounds: 5 while every round gains", async () => {
    const evaluate = { calls: 0 };
    const scrollBodies = [1, 2, 3, 4, 5, 6, 7, 8].map((round) =>
      graphqlBodyMany([id19(3 * round - 1), id19(3 * round), id19(3 * round + 1)]),
    );

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/bounded")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/bounded", graphqlBody(id19(1))]]),
        evaluate,
        scrollBodies,
      }),
      { scrollRounds: 5 },
    );

    assert.equal(result.length, 16); // 1 captured at goto + 5 rounds x 3 posts
    assert.equal(evaluate.calls, 5); // the config knob, not the 8-round default
  });
});
