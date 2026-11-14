/**
 * The LinkedIn browser-context seam and its fault vocabulary (N042b): the
 * factory type, the persistent-profile factory, and the three tagged-error
 * families — moved verbatim out of linkedin-fetch.ts.
 *
 * The errors land HERE, not with the walk, because both halves import them:
 * the walk calls halt and legDead; the orchestration calls isHalt, isLegDead,
 * halt, legDead, and allSurfacesFaulted at the join.
 *
 * The factory stays a LinkedIn-local seam on purpose (design decision
 * "Structural layer duplicated, not shared"): the shared ContextFactory in
 * fetch-threads.ts carries a storage-state PATH and a headless launch, and
 * widening it breaks all three existing doubles under strictFunctionTypes.
 * The two hardening constants it shares with the Threads factory live in
 * browser-constants.ts (N059).
 */
import { BROWSER_USER_AGENT, WEBDRIVER_PATCH } from "./browser-constants.js";
import type { ContextLike, LocatorLike, PageLike } from "./fetch-threads.js";
// --- LegDeadError: the tagged-error idiom (judge-rotation.ts:51-75) ---

const LEG_DEAD = "LegDeadError";

/**
 * Thrown once per tick when the session leg is dead (D7). Factory-assigned
 * fields stay mutable — the RotationExhausted idiom (judge-rotation.ts:61-70).
 */
interface LegDead extends Error {
  name: string;
  reason: string;
}

export function legDead(reason: string): LegDead {
  const error = new Error(`linkedin-fetch: leg dead — ${reason}`) as LegDead;
  error.name = LEG_DEAD;
  error.reason = reason;
  return error;
}

export function isLegDead(error: unknown): error is LegDead {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === LEG_DEAD
  );
}

// --- AllSurfacesFaulted: the tagged-error idiom (judge-rotation.ts:51-75) ---

const ALL_SURFACES_FAULTED = "AllSurfacesFaulted";

/** Thrown when EVERY configured surface faulted and none published posts (D13: the tick, not the walk, decides the write). */
interface AllSurfacesFaulted extends Error {
  name: string;
  faulted: number;
}

export function allSurfacesFaulted(faulted: number): AllSurfacesFaulted {
  const error = new Error(
    `linkedin-fetch: all ${faulted} surface(s) faulted — nothing fetched`,
  ) as AllSurfacesFaulted;
  error.name = ALL_SURFACES_FAULTED;
  error.faulted = faulted;
  return error;
}

export function isAllSurfacesFaulted(error: unknown): error is AllSurfacesFaulted {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === ALL_SURFACES_FAULTED
  );
}

// --- HaltError: the tagged-error idiom (judge-rotation.ts:51-75) ---
// The account-safety terminal (design 2026-11-09): a security checkpoint
// or login wall stops the walk and fetchTick trips the operator-cleared
// latch. It deliberately does NOT ride LegDeadError: a dead session
// self-heals on a cookie refresh, a halt must not.

const HALT = "HaltError";

/** Thrown once per walk when the account hit the account-safety terminal. */
interface Halt extends Error {
  name: string;
  reason: string;
}

export function halt(reason: string): Halt {
  const error = new Error(`linkedin-fetch: halt — ${reason}`) as Halt;
  error.name = HALT;
  error.reason = reason;
  return error;
}

export function isHalt(error: unknown): error is Halt {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === HALT;
}
// --- the LinkedIn browser context factory (browser-walk migration,
//     design 2026-11-11) ---

/**
 * The LinkedIn walk's context factory seam: one persistent PROFILE PATH in,
 * one session-carrying browser context out. NOT the shared ContextFactory
 * (fetch-threads.ts): that seam carries a storage-state PATH and a headless
 * launch, and widening it breaks all three existing doubles under
 * strictFunctionTypes — the launch/adapter mechanics duplicate here instead
 * (design decision "Structural layer duplicated, not shared"; re-exporting
 * the private shared factory re-introduces the knip N012 dead-export
 * finding).
 *
 * REVISED 2026-11-11T18:40+0700 (live rehearsal): the original seam took a
 * storageState DOCUMENT synthesized from the harvested cookie pair and
 * opened a FRESH browser. LinkedIn serves that identity a content-search
 * page with NO Load-more button (54 buttons present, 0 matching), so the
 * click loop had nothing to click and the walk reported 3 posts. The
 * profile + headed configuration gets the button and paginates 6 posts per
 * click. See the design's Key Discoveries for the four-config matrix.
 */
export type LinkedInContextFactory = (profileDir: string) => Promise<ContextLike>;

/**
 * Build the LinkedIn browser context on the persistent PROFILE, headed. The
 * dynamic await import inside is this module's Playwright quarantine site —
 * importing this module never loads Playwright, and the offline suites stay
 * Playwright-free. The factory owns the browser: closing the context closes
 * the browser.
 *
 * REVISED 2026-11-11T18:40+0700 (live rehearsal): the session rides the
 * PROFILE, not a synthesized cookie document. A fresh browser with the
 * harvested pair gets a page with no Load-more button; the profile gets the
 * button and paginates. Headed is required for the button to render and is
 * acceptable because this leg runs on the PC (watch-linkedin), never in
 * GitHub Actions.
 *
 * locale pins en-US: the walk's Load-more click is a TEXT selector on the
 * English label — the only stable handle (live capture 2026-11-11: one
 * candidate, no aria-label, deploy-hashed classes). A LinkedIn copy change
 * breaks the selector visibly (a stream of dry rounds), never silently.
 *
 * Pages carry url() (the new optional PageLike seam): the walk's
 * checkpoint detector reads it after every navigation.
 */
export function makeLinkedInContextFactory(profileDir: string): LinkedInContextFactory {
  const factory: LinkedInContextFactory = async (): Promise<ContextLike> => {
    const { chromium } = await import("playwright");
    // launchPersistentContext, not launch + newContext: the profile IS the
    // session. viewport null lets the operator's window size ride (the
    // login helper's shape, scripts/login-linkedin.ts:127-130).
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: "msedge",
      headless: false,
      viewport: null,
      userAgent: BROWSER_USER_AGENT,
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
        // launchPersistentContext owns the browser: closing the context
        // closes it. There is no separate browser handle to close.
        await context.close();
      },
    };
  };
  return factory;
}
