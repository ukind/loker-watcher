/**
 * Fetch rendered HTML for Threads tag pages with Playwright.
 *
 * Tag pages hydrate post data into <script type="application/json"
 * data-sjs> blobs; extraction (src/extract.ts) parses those blobs from the
 * HTML, so this module only has to deliver hydrated page HTML per surface.
 * Hydration gate: wait until some data-sjs blob actually contains
 * "thread_items" (raw page HTML has NO post data — probes confirmed).
 *
 * Hardening is minimal (D2): patch navigator.webdriver and set a realistic
 * UA/viewport/locale. Vanilla headless Chromium worked on threads.com in
 * the 2026-10-24 logged-out probes; if GitHub Actions runner IPs get
 * blocked, hardening escalates here (see Verification Notes smoke gate).
 *
 * Surface policy (D11): every tag is attempted with retries; a failed
 * surface is tolerated while at least one succeeds; all-fail throws.
 */
import { chromium, type BrowserContext } from "playwright";
import { tagPageUrl } from "./config.js";

const NAV_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;

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

/** Rendered HTML for one tag surface, ready for extractPosts(). */
export interface SurfaceFetch {
  tag: string;
  html: string;
}

/**
 * Fetch every tag page and return the successes in input order.
 * Throws when every surface fails (message lists per-surface errors).
 */
export async function fetchTagPages(
  tags: readonly string[],
): Promise<SurfaceFetch[]> {
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
    for (const tag of tags) {
      try {
        results.push({ tag, html: await fetchOne(context, tag) });
        console.log(`fetch: /tag/${tag} OK`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`/tag/${tag}: ${message}`);
        console.warn(`fetch: /tag/${tag} FAILED — ${message}`);
      }
    }

    if (results.length === 0) {
      throw new Error(
        `fetch: all ${tags.length} surface(s) failed:\n${failures.join("\n")}`,
      );
    }
    return results;
  } finally {
    await browser.close();
  }
}

/** Fetch one tag page: up to MAX_ATTEMPTS tries with linear backoff. */
async function fetchOne(
  context: BrowserContext,
  tag: string,
): Promise<string> {
  const url = tagPageUrl(tag);
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const page = await context.newPage();
    try {
      await page.goto(url, {
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
      console.warn(
        `fetch: /tag/${tag} attempt ${attempt}/${MAX_ATTEMPTS} failed`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    } finally {
      await page.close();
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

