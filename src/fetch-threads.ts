/**
 * Fetch rendered HTML for Threads surfaces with Playwright.
 *
 * Every surface — a tag page, a profile page or a search URL — hydrates post
 * data into <script type="application/json" data-sjs> blobs; extraction
 * (src/extract.ts) parses those blobs from the HTML, so this module only has
 * to deliver hydrated page HTML per surface. Hydration gate: wait until some
 * data-sjs blob actually contains "thread_items" (raw page HTML has NO post
 * data — probes confirmed).
 *
 * Hardening is minimal (D2): patch navigator.webdriver and set a realistic
 * UA/viewport/locale. Vanilla headless Chromium worked on threads.com in
 * the 2026-10-24 logged-out probes; if GitHub Actions runner IPs get
 * blocked, hardening escalates here (see Verification Notes smoke gate).
 *
 * Surface policy (D11): every surface is attempted with retries; a failed
 * surface is tolerated while at least one succeeds; all-fail throws. The
 * surface list itself lives in watcher.config.json (Phase 10).
 *
 * Concurrency (D4): each walk drains its surfaces through a bounded
 * slot-array pool capped at FETCH_CONCURRENCY, so results reassemble in
 * input order and the in-flight page peak never exceeds the cap.
 *
 * Testability (D5): both walks take a trailing ContextFactory — the ONLY
 * Playwright import site is the dynamic await import inside the default
 * chromiumContextFactory, so importing this module never loads Playwright
 * and offline suites inject structural doubles.
 */
import type { ResolvedSurface } from "./config-file.js";
import { collectThreadItems, normalizeThreadItem } from "./extract.js";
import { sleep } from "./judge.js";
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

const NAV_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;

/** Surfaces walked at once by either fetch loop (D4). */
export const FETCH_CONCURRENCY = 4;

// Authenticated fetch tuning (Phase 8, measured 2026-10-25).
const RECENT_TAB_LABEL = "Recent";
/** Loop-bound default for BOTH walks; the config scrollRounds key overrides (D4). */
const MAX_SCROLL_ROUNDS = 8;
const SCROLL_MIN_GAIN = 2;
const MAX_POSTS_PER_SURFACE = 150;
const RECENT_SETTLE_MS = 5000;
const SCROLL_SETTLE_MS = 2500;
const XHR_DRAIN_MS = 1500;

/** Phase 8 revision constants (2026-10-25 validation blocker). These join the
 * authenticated-fetch tuning block above (RECENT_TAB_LABEL, MAX_SCROLL_ROUNDS,
 * SCROLL_MIN_GAIN, MAX_POSTS_PER_SURFACE, RECENT_SETTLE_MS, SCROLL_SETTLE_MS,
 * XHR_DRAIN_MS). RECENT_TAB_TIMEOUT_MS and MAX_DRY_SCROLL_ROUNDS are new.
 */
const RECENT_TAB_TIMEOUT_MS = 15_000;
const MAX_DRY_SCROLL_ROUNDS = 3;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Browser-side hydration probe for waitForFunction, kept as a string so the
 * Node build needs no DOM lib (locked tsconfig: lib ES2023, types node).
 * True once a data-sjs blob carries hydrated post data.
 */
const HAS_THREAD_ITEMS = `() =>
  Array.from(
    document.querySelectorAll('script[type="application/json"][data-sjs]'),
  ).some((el) => (el.textContent || '').includes('thread_items'))`;

const WEBDRIVER_PATCH = "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });";

/** One graphql/HTTP response the authenticated walk may read. */
export interface ResponseLike {
  url(): string;
  status(): number;
  text(): Promise<string>;
}

/** One feed tab locator (the Recent tab is the only one the walk touches). */
export interface LocatorLike {
  first(): LocatorLike;
  waitFor(options: { state: "visible"; timeout: number }): Promise<void>;
  click(): Promise<void>;
}

/** One browser page, narrowed to the surface the walks actually drive. */
export interface PageLike {
  goto(url: string, options?: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  /**
   * The page's current URL after navigation, for URL-level detectors (the
   * LinkedIn walk's checkpoint detector is the only consumer). Optional so
   * the existing structural doubles stay assignable without edits.
   */
  url?(): string;
  waitForFunction(
    pageFunction: string,
    arg?: unknown,
    options?: { timeout?: number; polling?: number },
  ): Promise<void>;
  content(): Promise<string>;
  on(event: "response", listener: (response: ResponseLike) => void): void;
  locator(selector: string): LocatorLike;
  evaluate(script: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
}

/** One browser context, narrowed to the surface the walks actually use. */
export interface ContextLike {
  newPage(): Promise<PageLike>;
  addInitScript(script: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Build one browser context for a walk. The optional path is the session
 * storage state file: the authenticated walk passes it so the default
 * factory attaches the logged-in cookies, while zero-arg test doubles stay
 * assignable and the logged-out walk simply never passes one.
 */
export type ContextFactory = (storageStatePath?: string) => Promise<ContextLike>;

/**
 * Build one browser context for a walk at a fixed headless mode. The
 * dynamic await import inside is the ONLY Playwright import site, so
 * importing this module never loads Playwright — the offline suites rely
 * on that — and the factory owns the browser, closing it when the context
 * closes. The optional storage-state path is the session file the
 * authenticated walk passes so the context attaches the logged-in cookies;
 * zero-arg calls (test doubles) simply build a context from no stored session.
 */
function makeChromiumContextFactory(headless: boolean): ContextFactory {
  const factory: ContextFactory = async (storageStatePath?: string): Promise<ContextLike> => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      ...(storageStatePath === undefined ? {} : { storageState: storageStatePath }),
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
    });
    await context.addInitScript(WEBDRIVER_PATCH);
    return {
      newPage: async (): Promise<PageLike> => {
        const page = await context.newPage();
        return {
          url: () => page.url(),
          goto: (url, options) => page.goto(url, options),
          waitForFunction: async (pageFunction, arg, options) => {
            await page.waitForFunction(pageFunction, arg, options);
          },
          content: () => page.content(),
          on: (event, listener) => {
            page.on(event, (response) => listener(response));
            return undefined;
          },
          locator: (selector) => {
            const chain = page.locator(selector).first();
            const adapted: LocatorLike = {
              first: () => adapted,
              waitFor: (options) => chain.waitFor(options),
              click: () => chain.click(),
            };
            return adapted;
          },
          evaluate: (script) => page.evaluate(script),
          waitForTimeout: (ms) => page.waitForTimeout(ms),
          close: () => page.close(),
        };
      },
      addInitScript: async (script) => {
        await context.addInitScript(script);
      },
      close: async () => {
        await context.close();
        await browser.close();
      },
    };
  };
  return factory;
}

/** The production factory: headless, hardened, storage-state aware. */
const chromiumContextFactory: ContextFactory = makeChromiumContextFactory(true);

/**
 * A `tag` surface logs as `tag/<value>`; a `url` surface logs as its full
 * URL. resolveSurfaces (src/config-file.ts) builds the labels, so the prefix
 * is the only discriminator available here — and it is unambiguous, because
 * a `url` surface is always an absolute https://www.threads.com/... URL.
 */
function isTagSurface(surface: ResolvedSurface): boolean {
  return surface.label.startsWith("tag/");
}

/** Rendered HTML for one surface, ready for extractPosts(). */
export interface SurfaceFetch {
  label: string;
  html: string;
  /** The raw surface pair (email-per-surface stamp, design D2): the page
   *  carries its own identity past the successes filter, which compacts
   *  the slot array so position no longer identifies the surface. */
  type: "tag" | "url";
  value: string;
}

/**
 * Fetch every configured surface and return the successes in input order.
 * Surfaces drain through a bounded slot-array pool (D4), so the in-flight
 * page peak never exceeds FETCH_CONCURRENCY while the output stays ordered.
 * Throws when every surface fails (message lists per-surface errors).
 */
export async function fetchSurfaces(
  surfaces: readonly ResolvedSurface[],
  contextFactory: ContextFactory = chromiumContextFactory,
): Promise<SurfaceFetch[]> {
  const context = await contextFactory();
  try {
    const results: Array<SurfaceFetch | undefined> = Array.from({ length: surfaces.length });
    const failures: Array<string | undefined> = Array.from({ length: surfaces.length });
    // Cursor, width clamp, and join live in runPool (F007); failures ride
    // the side array, so the worker stays total (join-never-rejects).
    await runPool(surfaces, FETCH_CONCURRENCY, async (surface, index) => {
      try {
        const html = await fetchOne(context, surface);
        results[index] = {
          label: surface.label,
          html,
          type: surface.type,
          value: surface.value,
        };
        console.log(`fetch: ${surface.label} OK`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures[index] = `${surface.label}: ${message}`;
        console.warn(`fetch: ${surface.label} FAILED — ${message}`);
      }
    });

    const successes = results.filter((entry): entry is SurfaceFetch => entry !== undefined);
    if (successes.length === 0) {
      const listed = failures.filter((entry): entry is string => entry !== undefined);
      throw new Error(`fetch: all ${surfaces.length} surface(s) failed:\n${listed.join("\n")}`);
    }
    return successes;
  } finally {
    await context.close();
  }
}

/** Fetch one surface: up to MAX_ATTEMPTS tries with linear backoff. */
async function fetchOne(context: ContextLike, surface: ResolvedSurface): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const page = await context.newPage();
    try {
      await page.goto(surface.url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForFunction(HAS_THREAD_ITEMS, undefined, {
        timeout: NAV_TIMEOUT_MS,
        polling: 500,
      });
      return await page.content();
    } catch (error) {
      lastError = error;
      console.warn(`fetch: ${surface.label} attempt ${attempt}/${MAX_ATTEMPTS} failed`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    } finally {
      await page.close();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Walk-shaping options for the authenticated walk (D6). All fields are
 * optional: the absent scrollRounds key behaves byte-identically to the
 * pre-config walker.
 */
export interface AuthenticatedFetchOptions {
  /** Loop bound for the walk; absent means the Threads-measured default (D4). */
  readonly scrollRounds?: number;
}

/**
 * Fetch posts from the configured Threads surfaces with authenticated
 * sessions.
 *
 * The logged-in tag page defaults to the Top view (old, popular posts) and
 * hydrates post data through graphql XHR responses instead of the initial
 * data-sjs blobs (measured 2026-10-25: 1 post in the blobs vs 92 via XHR).
 * This walk clicks the Recent tab, captures graphql response bodies, walks
 * them for thread_items arrays with the same helpers extractPosts uses, and
 * scrolls until the feed stops yielding new posts.
 *
 * The Recent-tab click is best-effort for every surface: profile pages and
 * search URLs have no such tab, and a `filter=recent` search URL is recent
 * by construction.
 *
 * Surfaces drain through the same bounded slot-array pool as the logged-out
 * walk (D4): results reassemble in input order, peak <= FETCH_CONCURRENCY.
 * Throws when every surface fails (message lists per-surface errors).
 */
export async function fetchSurfacesAuthenticated(
  surfaces: readonly ResolvedSurface[],
  storageStatePath: string,
  contextFactory: ContextFactory = chromiumContextFactory,
  options: AuthenticatedFetchOptions = {},
): Promise<Post[]> {
  // Eager build is safe: the only caller (index.ts) guards surfaces.length > 0
  // before dispatching, so an empty-surface run can never open an idle browser.
  const context = await contextFactory(storageStatePath);
  const scrollRounds = options.scrollRounds ?? MAX_SCROLL_ROUNDS;
  try {
    const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
    const failures: Array<string | undefined> = Array.from({ length: surfaces.length });
    const emptyLabels: Array<string | undefined> = Array.from({ length: surfaces.length });
    // Same migration as fetchSurfaces (F007): the empty-surface side
    // channel rides the closure, the worker stays total.
    await runPool(surfaces, FETCH_CONCURRENCY, async (surface, index) => {
      try {
        const posts = await fetchOneAuthenticated(context, surface, scrollRounds);
        console.log(`extract: ${surface.label}: ${posts.length} post(s) (authenticated)`);
        // Stamp at the slot write (email-per-surface): a fresh post object
        // per row — the walk's input arrays are never mutated.
        perSurface[index] = posts.map((post) => ({
          ...post,
          surfaces: [{ type: surface.type, value: surface.value }],
        }));
        // A surface that yields 0 posts is NOT a thrown failure, so it never
        // reaches `failures`. Track it separately or the all-fail error below
        // lists nothing and the run dies with no diagnostic.
        if (posts.length === 0) emptyLabels[index] = surface.label;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures[index] = `${surface.label}: ${message}`;
        console.warn(`fetch: ${surface.label} FAILED — ${message}`);
      }
    });

    const results = perSurface.filter((posts): posts is Post[] => posts !== undefined).flat();
    if (results.length === 0) {
      const detail: string[] = failures.filter((entry): entry is string => entry !== undefined);
      const empties = emptyLabels.filter((label): label is string => label !== undefined);
      if (empties.length > 0) {
        detail.push(
          `${empties.join(", ")}: 0 post(s) extracted — the Recent tab or the graphql XHR capture yielded nothing`,
        );
      }
      throw new Error(
        `fetch: all ${surfaces.length} authenticated surface(s) failed:\n${detail.join("\n")}`,
      );
    }
    return results;
  } finally {
    await context.close();
  }
}

/** One authenticated surface: Recent tab, XHR capture, scroll to accumulate. */
async function fetchOneAuthenticated(
  context: ContextLike,
  surface: ResolvedSurface,
  scrollRounds: number,
): Promise<Post[]> {
  const page = await context.newPage();
  const posts = new Map<string, Post>();
  let xhrBodies = 0;

  // Attach before navigation: the logged-in feed streams post data through
  // graphql XHR responses, not the initial data-sjs blobs.
  page.on("response", (response) => {
    if (posts.size >= MAX_POSTS_PER_SURFACE) return;
    if (!/graphql/i.test(response.url()) || response.status() !== 200) return;
    void (async () => {
      try {
        const body = await response.text();
        if (!body.includes("thread_items")) return;
        xhrBodies += 1;
        const items: unknown[] = [];
        collectThreadItems(JSON.parse(body), items);
        for (const item of items) {
          const post = normalizeThreadItem(item);
          if (post !== null) posts.set(post.id, post);
        }
      } catch {
        // not every graphql response is JSON we care about; skip it
      }
    })();
  });

  try {
    await page.goto(surface.url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForFunction(HAS_THREAD_ITEMS, undefined, {
      timeout: NAV_TIMEOUT_MS,
      polling: 500,
    });

    // The default view is Top (old posts); Recent is the fresh feed.
    // The tab renders AFTER the hydration gate resolves (measured 2026-10-25:
    // count() === 0 at gate time, === 1 ~6s later), so WAIT for it instead of
    // probing once. A one-shot count() silently keeps the Top view, which
    // emits no thread_items XHR bodies at all.
    const recentTab = page.locator(`[aria-label="${RECENT_TAB_LABEL}"]`);
    let recentVisible = true;
    try {
      await recentTab.waitFor({
        state: "visible",
        timeout: RECENT_TAB_TIMEOUT_MS,
      });
    } catch {
      recentVisible = false;
    }
    if (recentVisible) {
      await recentTab.click();
      await page.waitForTimeout(RECENT_SETTLE_MS);
    } else if (isTagSurface(surface)) {
      // A tag page should carry a Recent tab; its absence is unexpected.
      console.warn(`fetch: ${surface.label} has no Recent tab — using the default view`);
    } else {
      // A profile or search URL selects its own view; no tab is expected.
      console.log(`fetch: ${surface.label} has no Recent tab — the URL selects its own view`);
    }

    // `posts` is filled by ASYNC response handlers, so a single settle window
    // almost always measures +0 on round 1 (measured: round 1 +0, round 2 +25,
    // round 3 +13). Stop only after MAX_DRY_SCROLL_ROUNDS consecutive rounds
    // that gain fewer than SCROLL_MIN_GAIN posts.
    let dryRounds = 0;
    for (let round = 1; round <= scrollRounds; round += 1) {
      const before = posts.size;
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await page.waitForTimeout(SCROLL_SETTLE_MS);
      const gained = posts.size - before;
      if (gained < SCROLL_MIN_GAIN) {
        dryRounds += 1;
        console.log(
          `fetch: ${surface.label} scroll ${round}: +${gained} (dry ${dryRounds}/${MAX_DRY_SCROLL_ROUNDS})`,
        );
        if (dryRounds >= MAX_DRY_SCROLL_ROUNDS) break;
      } else {
        dryRounds = 0;
        console.log(`fetch: ${surface.label} scroll ${round}: +${gained}`);
      }
      if (posts.size >= MAX_POSTS_PER_SURFACE) break;
    }

    // Let in-flight response handlers settle before the page goes away.
    await page.waitForTimeout(XHR_DRAIN_MS);
    console.log(
      `fetch: ${surface.label} OK — ${posts.size} post(s) from ${xhrBodies} XHR response(s)`,
    );
    return [...posts.values()];
  } finally {
    await page.close();
  }
}
