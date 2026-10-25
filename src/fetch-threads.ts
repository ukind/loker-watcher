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
 */
import { type BrowserContext, chromium } from "playwright";
import type { ResolvedSurface } from "./config-file.js";
import { collectThreadItems, normalizeThreadItem } from "./extract.js";
import type { Post } from "./types.js";

const NAV_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;

// Authenticated fetch tuning (Phase 8, measured 2026-10-25).
const RECENT_TAB_LABEL = "Recent";
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
}

/**
 * Fetch every configured surface and return the successes in input order.
 * Throws when every surface fails (message lists per-surface errors).
 */
export async function fetchSurfaces(surfaces: readonly ResolvedSurface[]): Promise<SurfaceFetch[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
    });
    await context.addInitScript(
      "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
    );

    const results: SurfaceFetch[] = [];
    const failures: string[] = [];
    for (const surface of surfaces) {
      try {
        results.push({ label: surface.label, html: await fetchOne(context, surface) });
        console.log(`fetch: ${surface.label} OK`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${surface.label}: ${message}`);
        console.warn(`fetch: ${surface.label} FAILED — ${message}`);
      }
    }

    if (results.length === 0) {
      throw new Error(`fetch: all ${surfaces.length} surface(s) failed:\n${failures.join("\n")}`);
    }
    return results;
  } finally {
    await browser.close();
  }
}

/** Fetch one surface: up to MAX_ATTEMPTS tries with linear backoff. */
async function fetchOne(context: BrowserContext, surface: ResolvedSurface): Promise<string> {
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
 * Fetch posts from the configured surfaces with an authenticated session.
 *
 * The logged-in tag page defaults to the Top view (old, popular posts) and
 * hydrates post data through graphql XHR responses instead of the initial
 * data-sjs blobs (measured 2026-10-25: 1 post in the blobs vs 92 via XHR).
 * This function clicks the Recent tab, captures graphql response bodies,
 * walks them for thread_items arrays with the same helpers extractPosts
 * uses, and scrolls until the feed stops yielding new posts.
 *
 * The Recent-tab click is best-effort for every surface: profile pages and
 * search URLs have no such tab, and a `filter=recent` search URL is recent
 * by construction.
 *
 * Throws when every surface fails (message lists per-surface errors).
 */
export async function fetchSurfacesAuthenticated(
  surfaces: readonly ResolvedSurface[],
  storageStatePath: string,
): Promise<Post[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: storageStatePath,
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
    });
    await context.addInitScript(
      "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
    );

    const results: Post[] = [];
    const failures: string[] = [];
    const empty: string[] = [];
    for (const surface of surfaces) {
      try {
        const posts = await fetchOneAuthenticated(context, surface);
        console.log(`extract: ${surface.label}: ${posts.length} post(s) (authenticated)`);
        // A surface that yields 0 posts is NOT a thrown failure, so it never
        // reaches `failures`. Track it separately or the all-fail error below
        // lists nothing and the run dies with no diagnostic.
        if (posts.length === 0) empty.push(surface.label);
        results.push(...posts);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${surface.label}: ${message}`);
        console.warn(`fetch: ${surface.label} FAILED — ${message}`);
      }
    }

    if (results.length === 0) {
      const detail: string[] = [...failures];
      if (empty.length > 0) {
        detail.push(
          `${empty.join(", ")}: 0 post(s) extracted — the Recent tab or the graphql XHR capture yielded nothing`,
        );
      }
      throw new Error(
        `fetch: all ${surfaces.length} authenticated surface(s) failed:\n${detail.join("\n")}`,
      );
    }
    return results;
  } finally {
    await browser.close();
  }
}

/** One authenticated surface: Recent tab, XHR capture, scroll to accumulate. */
async function fetchOneAuthenticated(
  context: BrowserContext,
  surface: ResolvedSurface,
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
    const recentTab = page.locator(`[aria-label="${RECENT_TAB_LABEL}"]`).first();
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
    for (let round = 1; round <= MAX_SCROLL_ROUNDS; round += 1) {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
