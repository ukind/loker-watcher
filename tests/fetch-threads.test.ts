/**
 * Offline suite for the fetch pools + context factory seam (Slice 3, D4/D5).
 * Every case injects a ContextFactory double — importing this file never
 * loads Playwright. Covers: input-order results, partial failure, all-fail
 * throw (both message shapes), empty-surface tracking, FETCH_CONCURRENCY
 * peak, and context teardown.
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
  /** Flagship-web bodies fired with a linkedin URL (the walker's filter accepts these). */
  linkedinBodiesBySubstring?: ReadonlyMap<string, string>;
  /** Storage-state path per context creation, in creation order. */
  sessionPaths?: string[];
  /** One staged body per wheel round of the LinkedIn walk. */
  wheelBodies?: readonly string[];
  /** Per-round wheel counter — the LinkedIn walk's round oracle. */
  wheel?: { calls: number };
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
            const linkedinEntry = [
              ...(options.linkedinBodiesBySubstring ?? new Map()).entries(),
            ].find(([fragment]) => url.includes(fragment));
            if (linkedinEntry !== undefined) {
              fire({
                url: () =>
                  "https://www.linkedin.com/flagship-web/search/results/content/?keywords=x",
                status: () => 200,
                text: async () => linkedinEntry[1],
              });
              return undefined;
            }
            const entry = [...xhrBySubstring.entries()].find(([fragment]) =>
              url.includes(fragment),
            );
            if (entry !== undefined) fire(graphqlResponse(entry[1]));
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html><body>hydrated</body></html>",
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
          mouse: {
            move: async () => undefined,
            wheel: async () => {
              const round = (options.wheel?.calls ?? 0) + 1;
              if (options.wheel !== undefined) options.wheel.calls = round;
              const body = options.wheelBodies?.[round - 1];
              if (body !== undefined) {
                fire({
                  url: () => "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination",
                  status: () => 200,
                  text: async () => body,
                });
              }
            },
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
          /tag\/a1, tag\/a2: 0 post\(s\) extracted — the Recent tab or the graphql XHR capture yielded nothing/,
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

  it("warns when a tag surface has no Recent tab", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));

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
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /tag\/noTab has no Recent tab — using the default view/.test(line)),
    );
  });

  it("logs the URL-selected view for a profile surface and never warns about the tab", async (t) => {
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
      logLines.some((line) =>
        /profile\/dev has no Recent tab — the URL selects its own view/.test(line),
      ),
    );
    const warnLines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(warnLines.every((line) => !line.includes("no Recent tab")));
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
});

describe("fetchSurfacesAuthenticated — platform dispatch", () => {
  const LINKEDIN_ID = "7522028760582447104"; // capture-verified epoch id

  /** Minimal flagship-web flight body: one activityUrn row + one commentary_text row. */
  const linkedinBody = (id: string): string =>
    [
      `1:${JSON.stringify({ tracking: { activityUrn: { activityId: id } } })}`,
      `2:${JSON.stringify([
        "$",
        "$Lmark",
        null,
        {
          viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
          children: [
            "$",
            "$Ldiv",
            null,
            { textProps: { children: [`LinkedIn hiring post ${id}`] } },
          ],
        },
      ])}`,
    ].join("\n");

  const linkedinSurfaceEntry = (): ResolvedSurface => ({
    platform: "linkedin",
    label: "linkedin/kw",
    url: "https://www.linkedin.com/search/results/content/?keywords=kw",
  });

  it("keeps Threads posts when a linkedin surface has no session path", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/ok"), linkedinSurfaceEntry()],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/ok", graphqlBody(id19(1))]]),
      }),
    );

    assert.deepEqual(
      result.map((post) => post.id),
      [id19(1)],
    ); // the LinkedIn failure never discards Threads results (acceptance pin)
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) =>
        /linkedin\/kw FAILED — linkedin surface walked without a session path/.test(line),
      ),
    );
  });

  it("walks a linkedin surface through a second context built from its session path", async () => {
    const sessionPaths: string[] = [];
    const closed = { value: false };

    const result = await fetchSurfacesAuthenticated(
      [surface("tag/ok"), linkedinSurfaceEntry()],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/ok", graphqlBody(id19(1))]]),
        // keyed by a NAV-URL substring (the label "linkedin/kw" never occurs in the URL)
        linkedinBodiesBySubstring: new Map([["search/results/content", linkedinBody(LINKEDIN_ID)]]),
        sessionPaths,
        closed,
      }),
      { linkedinSessionPath: "li-state.json" },
    );

    assert.deepEqual(sessionPaths, ["session-state.json", "li-state.json"]); // two contexts
    assert.equal(result.length, 2);
    const linkedinPost = result[1];
    assert.equal(linkedinPost?.platform, "linkedin");
    assert.equal(linkedinPost?.id, `urn:li:activity:${LINKEDIN_ID}`);
    assert.equal(
      linkedinPost?.permalink,
      `https://www.linkedin.com/feed/update/urn:li:activity:${LINKEDIN_ID}`,
    );
    assert.equal(closed.value, true); // both contexts tear down
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

  it("builds one context for a linkedin-only dispatch (D12: no idle base)", async () => {
    const sessionPaths: string[] = [];
    const closed = { value: false };

    const result = await fetchSurfacesAuthenticated(
      [linkedinSurfaceEntry()],
      "session-state.json", // vestigial base path: never becomes a context
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        linkedinBodiesBySubstring: new Map([["search/results/content", linkedinBody(LINKEDIN_ID)]]),
        sessionPaths,
        closed,
      }),
      { linkedinSessionPath: "li-state.json" },
    );

    assert.deepEqual(sessionPaths, ["li-state.json"]); // the base path built nothing
    assert.equal(result.length, 1);
    assert.equal(closed.value, true);
  });
});
