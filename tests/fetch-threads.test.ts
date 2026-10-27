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
 * an xhr entry, the double fires the walk's response listener with a
 * graphql body — the same async shape as a real capture. The Recent-tab
 * locator never becomes visible (both walks tolerate its absence), and
 * waits resolve immediately. Tracks open pages for the concurrency peak
 * and flags context teardown.
 */
function fakeContextFactory(options: {
  concurrency: { inFlight: number; peak: number };
  failUrls?: ReadonlySet<string>;
  xhrBySubstring?: ReadonlyMap<string, string>;
  closed?: { value: boolean };
}): ContextFactory {
  const failUrls = options.failUrls ?? new Set<string>();
  const xhrBySubstring = options.xhrBySubstring ?? new Map<string, string>();
  return async () => {
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        options.concurrency.inFlight += 1;
        options.concurrency.peak = Math.max(options.concurrency.peak, options.concurrency.inFlight);
        let open = true;
        const listeners: Array<(response: ResponseLike) => void> = [];
        const page: PageLike = {
          goto: async (url: string) => {
            if ([...failUrls].some((fragment) => url.includes(fragment))) {
              throw new Error(`navigation failed for ${url}`);
            }
            const entry = [...xhrBySubstring.entries()].find(([fragment]) =>
              url.includes(fragment),
            );
            if (entry !== undefined) {
              const response = graphqlResponse(entry[1]);
              for (const listener of listeners) listener(response);
            }
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => {
            const missingTab: LocatorLike = {
              first: () => missingTab,
              waitFor: async () => {
                throw new Error("locator not found"); // recentVisible = false path
              },
              click: async () => undefined,
            };
            return missingTab;
          },
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
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
});
