/**
 * The LinkedIn fetch leg (browser-walk migration, design 2026-11-11):
 * a real Playwright browser walks the logged-in content-search page —
 * one paced navigation plus up to `scrollRounds` "Load more" clicks per
 * surface — through the runPool surface walk the transport leg built.
 *
 * Session: the LinkedInContextFactory (below) opens the persistent PROFILE
 * scripts/login-linkedin.ts maintains, headed; the walk owns the context
 * and closes it on every path. REVISED 2026-11-11T18:40+0700 after the live
 * rehearsal: a fresh browser with the harvested cookie document gets a page
 * with no Load-more button, so the click loop had nothing to click. The
 * profile gets the button and paginates 6 posts per click.
 *
 * Extraction: every response whose URL matches LINKEDIN_RESPONSE_RE and
 * whose status is 200 parses through src/linkedin-parser.ts (pure,
 * never throws); minted posts dedupe FIRST-WINS by urn — a post seen on
 * an earlier body keeps its first mint.
 *
 * Fault vocabulary (design decision "Fault vocabulary re-mapped"):
 * - a checkpoint/login/authwall page URL (checked after the navigation,
 *   on every liveness poll tick, and after every click settle) throws
 *   the tagged HaltError carrying HALT_CHECKPOINT_REASON — the
 *   operator-cleared latch, never leg-dead;
 * - no flagship-web response inside the liveness window throws the
 *   tagged LegDeadError — one alarm per episode via the repo-local
 *   marker; a plain Error (the b1/b2 class) never reaches the join;
 * - anything else is a per-surface fault (warn + skip, the index arm
 *   owns the per-surface skip summary).
 *
 * The walk reuses runPool — verified contract: runPool RETURNS VOID
 * (src/pool.ts:33-52), so results ride caller-owned side arrays indexed
 * by the claim index, the worker stays total for surface faults, and
 * leg-dead/halt abort via the repo's drain-then-throw shape (judgePosts
 * fallback pool, src/judge.ts:681; fast-workflow-runtime D11). A shared
 * per-walk pacing gate (5-15 s between NAVIGATIONS, any surface) keeps
 * the global navigation rate identical to a sequential walk — the
 * anti-bot rate is pacing-bound, not width-bound. Intra-surface
 * Load-more clicks ride the ~2.5 s settle window and never trip the gate.
 *
 * Testability: importing this module never loads Playwright — the one
 * dynamic await import lives inside makeLinkedInContextFactory (the site
 * the deleted playwright request transport frees) — and the offline
 * suite injects structural ContextLike doubles.
 */
import type { Surface } from "./config-file.js";
import type { ContextLike, LocatorLike, PageLike } from "./fetch-threads.js";
import { HALT_CHECKPOINT_REASON, type RandomFn } from "./linkedin-behavior.js";
import {
  LINKEDIN_RESPONSE_RE,
  buildContentSearchUrl,
  collectLinkedInPosts,
} from "./linkedin-parser.js";
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

/** One configured linkedin surface (raw keyword string, never a URL). */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;

/** Injectable sleep for the pacing gate (judge.ts trailing-param idiom). */
export type SleepFn = (ms: number) => Promise<void>;

/** Walk width. The pacing gate, not this number, bounds the navigation rate. */
export const LINKEDIN_FETCH_CONCURRENCY = 2;

/** Pace floor: minimum spacing between page navigations, shared across surfaces (§13.3). */
export const PACE_MIN_MS = 5_000;

/**
 * Pace ceiling: EXCLUSIVE upper bound of the spacing draw (the anti-
 * restriction profile's 5-15 s band, design 2026-11-09). floor() keeps a
 * draw at most MAX - 1 ms, mirroring the wake-cadence bounds.
 */
export const PACE_MAX_MS = 15_000;

// --- browser-walk tuning (the deleted walk's constants that carry over,
//     plus the Load-more mechanics new in the 2026-11-11 design) ---

/**
 * The Load-more button handle (live capture 2026-11-11, design Decision
 * "LOAD_MORE_SELECTOR"): the button carries no aria-label and no id, and
 * its class list is a per-deploy hash — the visible text is the only
 * stable attribute. The context pins locale en-US, which pins this
 * English label; a LinkedIn copy change breaks the selector VISIBLY (a
 * stream of dry rounds with zero minted posts), never silently.
 */
const LOAD_MORE_SELECTOR = 'button:has-text("Load more")';

/** Per-click settle: the pagination response lands inside this window (the deleted walk's constant). */
const LINKEDIN_SETTLE_MS = 2_500;

/** The Load-more visibility window before a round counts dry. */
const LINKEDIN_LOAD_MORE_WAIT_MS = 5_000;

/** Consecutive low-gain rounds before the surface exits early (the Threads loop's shape). */
const LINKEDIN_MAX_DRY_ROUNDS = 3;

/** A round gaining fewer posts than this is dry (the Threads loop's threshold). */
const LINKEDIN_MIN_GAIN = 2;

/** Loop-bound default (the config scrollRounds key overrides; the Threads walk carries the same fallback). */
const LINKEDIN_DEFAULT_SCROLL_ROUNDS = 8;

/** Per-surface post cap (rides from the deleted walk; the perf budget assumes it). */
const LINKEDIN_MAX_POSTS = 150;

/** Final drain: let in-flight response bodies land before the page closes. */
const LINKEDIN_XHR_DRAIN_MS = 1_500;

/** One page navigation's wall-clock cap. */
const LINKEDIN_NAV_TIMEOUT_MS = 30_000;

/** The first flagship-web response must land inside this window, or the leg is dead. */
const LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS = 30_000;

/** Liveness poll interval for the first flagship-web response. */
const LINKEDIN_FIRST_RESPONSE_POLL_MS = 250;

/**
 * The one-shot DOM probe (live rehearsal 2026-11-11). Reports the button
 * count, the Load-more count, and the lazy column's scroll metrics, so one
 * run distinguishes three cases: the button is absent (loadMore 0), it is
 * present but off-screen (loadMore 1, top > viewportH), or the column is
 * scrollable and the walk scrolled the wrong node (colScrollH > colClientH
 * with colScrollTop still 0).
 */
const DOM_PROBE_JS = `(() => {
  const col = document.querySelector('[data-testid="lazy-column"]');
  const all = [...document.querySelectorAll("button")];
  const lm = all.filter((b) => /load more/i.test(b.textContent || ""));
  const rect = lm[0]?.getBoundingClientRect();
  return JSON.stringify({
    buttons: all.length,
    loadMore: lm.length,
    top: rect ? Math.round(rect.top) : null,
    colScrollH: col ? col.scrollHeight : null,
    colClientH: col ? col.clientHeight : null,
    colScrollTop: col ? Math.round(col.scrollTop) : null,
    docH: document.documentElement.scrollHeight,
    viewportH: window.innerHeight,
  });
})()`;

/**
 * Scroll the ACTUAL scroll container (REVISED 2026-11-12, live run): the
 * variant the persistent profile serves scrolls `<main>` — the lazy column
 * and the window measure zero travel there, so scrolling them paginated
 * nothing (the "3 posts, dry exit" root cause). Measure every candidate
 * (window scrollingElement, main, lazy column, finite-scroll scaffold),
 * scroll the one with the most travel to its end, keep the window nudge
 * for document-scrolled variants, and bring a Load-more button into view
 * when one renders (the click arm still owns button variants). The return
 * value names the container that moved, as JSON.
 */
export const SCROLL_JS = `(() => {
  const cands = [];
  const doc = document.scrollingElement;
  if (doc && doc.scrollHeight > doc.clientHeight + 50) {
    cands.push({ sel: "window", dist: doc.scrollHeight - doc.clientHeight, el: doc });
  }
  document.querySelectorAll("main, [data-testid='lazy-column'], .scaffold-finite-scroll").forEach((el) => {
    if (el.scrollHeight > el.clientHeight + 50) {
      cands.push({ sel: el.tagName.toLowerCase(), dist: el.scrollHeight - el.clientHeight, el });
    }
  });
  cands.sort((a, b) => b.dist - a.dist);
  const pick = cands[0];
  if (pick) pick.el.scrollTop = pick.el.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /load more/i.test(b.textContent || ""),
  );
  if (btn) btn.scrollIntoView({ block: "center" });
  return JSON.stringify(
    pick
      ? { sel: pick.sel, top: Math.round(pick.el.scrollTop), sh: pick.el.scrollHeight, ch: pick.el.clientHeight }
      : { sel: "none", top: 0, sh: 0, ch: 0 },
  );
})()`;

/**
 * The checkpoint/login/authwall page-URL detector (FR-7): LinkedIn
 * interposes these paths when the session tripped a security challenge
 * or died — the account-safety terminal (halt), never a leg-dead.
 * Segment-bounded, so a keyword that contains "login" can never false-
 * positive: query values ride after "=" or percent-encoded, never as a
 * bare path segment.
 */
const LINKEDIN_CHECKPOINT_URL_RE = /(^|\/)(checkpoint|authwall|login)(\/|$|\?)/i;

// --- LegDeadError: the tagged-error idiom (judge-rotation.ts:51-75) ---

export const LEG_DEAD = "LegDeadError";

/**
 * Thrown once per tick when the session leg is dead (D7). Factory-assigned
 * fields stay mutable — the RotationExhausted idiom (judge-rotation.ts:61-70).
 */
export interface LegDead extends Error {
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

export const ALL_SURFACES_FAULTED = "AllSurfacesFaulted";

/** Thrown when EVERY configured surface faulted and none published posts (D13: the tick, not the walk, decides the write). */
export interface AllSurfacesFaulted extends Error {
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

export const HALT = "HaltError";

/** Thrown once per walk when the account hit the account-safety terminal. */
export interface Halt extends Error {
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

/** The pinned UA (the shared Threads factory's hardening set, duplicated with this section). */
const LINKEDIN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * The webdriver patch, kept as a string so the Node build needs no DOM lib
 * (locked tsconfig: lib ES2023, types node) — the shared factory's idiom.
 */
const LINKEDIN_WEBDRIVER_PATCH =
  "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });";

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
      userAgent: LINKEDIN_USER_AGENT,
      locale: "en-US",
    });
    await context.addInitScript(LINKEDIN_WEBDRIVER_PATCH);
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

/**
 * The persistent profile the login helper maintains (scripts/login-linkedin.ts:34).
 * The walk reuses it rather than opening a fresh browser with the harvested
 * cookie pair — see the factory's REVISED note and the design's Key
 * Discoveries.
 */
export const LINKEDIN_PROFILE_DIR = "C:/loker-secrets/linkedin-chromium-profile";

/**
 * The production factory: the persistent profile, headed. Module-PRIVATE on
 * purpose — the browser walk defaults to it in-module, and an exported
 * factory nobody imports is the knip dead-export finding class, not a seam.
 */
const linkedinChromiumContextFactory: LinkedInContextFactory =
  makeLinkedInContextFactory(LINKEDIN_PROFILE_DIR);
// --- the surface walk ---

interface PacingGate {
  readonly wait: () => Promise<void>;
}

/**
 * Shared pacing gate: every page NAVIGATION starts PACE_MIN_MS or more
 * after the previous one, regardless of which surface issued it. The slot
 * is RESERVED BEFORE SLEEPING — the stamp advances synchronously on entry,
 * so concurrent workers can never compute the same wake time and fire a
 * burst; with width 2 the navigations still space PACE_MIN_MS apart
 * globally (pacing-bound, not width-bound, D11). A per-walk closure (not
 * module state): two ticks must not inherit each other's stamp, and each
 * test run gets a fresh gate.
 */
function makePacingGate(
  now: () => number,
  sleepFn: SleepFn,
  rng: RandomFn = Math.random,
): PacingGate {
  let nextFreeAt = Number.NEGATIVE_INFINITY;
  return {
    wait: async () => {
      const slotAt = Math.max(now(), nextFreeAt);
      // The gap is a fresh uniform draw in [PACE_MIN_MS, PACE_MAX_MS) per
      // reservation — randomized spacing, same reserve-before-sleep shape.
      nextFreeAt = slotAt + Math.floor(PACE_MIN_MS + rng() * (PACE_MAX_MS - PACE_MIN_MS));
      const waitMs = slotAt - now();
      if (waitMs > 0) {
        await sleepFn(waitMs);
      }
    },
  };
}

const defaultSleep: SleepFn = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Walk one LinkedIn surface in the shared browser context: navigate the
 * content-search URL, wait for the first flagship-web response, then
 * click "Load more" until dry rounds, the click ceiling (scrollRounds,
 * the config knob shared with the Threads walk) or the post cap stops
 * the loop.
 *
 * Fault vocabulary (design decision "Fault vocabulary re-mapped"):
 * - a checkpoint/login/authwall page URL — checked after the navigation,
 *   on every liveness poll tick, and after every click settle — throws
 *   the tagged HaltError carrying HALT_CHECKPOINT_REASON (FR-7: the
 *   operator-cleared latch, one alarm; never leg-dead);
 * - no flagship-web response inside the liveness window throws the
 *   tagged LegDeadError (a dead session is routine — the b1/b2 plain-
 *   Error class never reaches the join);
 * - a page still on the search URL with zero posts is a success — the
 *   OK — 0 post(s) log, defb8af.
 *
 * The response join attaches BEFORE the navigation: the initial results
 * ride the page's first /flagship-web/ response, and each Load-more
 * click rides a pagination response (the only pagination trigger —
 * scrolling fires nothing, verified live 2026-11-11). Bodies parse
 * through the pure parser; minted posts dedupe first-wins by urn, and
 * the OK line counts bodies that CARRIED posts (N008: parsed, not
 * received).
 */
async function walkLinkedInSurface(
  context: ContextLike,
  surface: LinkedinSurface,
  label: string,
  scrollRounds: number,
  minClicks: number,
): Promise<Post[]> {
  const page = await context.newPage();
  const posts = new Map<string, Post>();
  let received = 0; // matched flagship-web bodies fully read — the liveness signal
  let parsed = 0; // bodies that carried at least one post — the OK-line counter (N008)
  const assertNoCheckpoint = (): void => {
    // url() is the optional Slice 3 seam; absence (a pre-Slice-3 double)
    // reads as no checkpoint. The production adapters always supply it.
    if (LINKEDIN_CHECKPOINT_URL_RE.test(page.url?.() ?? "")) throw halt(HALT_CHECKPOINT_REASON);
  };

  // Attach before navigation: the initial results stream through the
  // page's first flagship-web response. The parser never throws, so the
  // one catch guards only the body read racing the page close.
  page.on("response", (response) => {
    const url = response.url();
    const matched = LINKEDIN_RESPONSE_RE.test(url) && response.status() === 200;
    // Diagnostic (live rehearsal 2026-11-11): an UNMATCHED flagship-web body
    // is read once and named with what it carries. A headed run failed LEG
    // DEAD while the page fired five flagship responses — the results were
    // arriving on an endpoint LINKEDIN_RESPONSE_RE does not match, and
    // nothing said so. This line makes that visible instead of silent.
    if (!matched && /flagship-web/i.test(url)) {
      void (async () => {
        try {
          const body = await response.text();
          const ids = new Set([...body.matchAll(/urn:li:activity:(\d{10,})/g)].map((m) => m[1]))
            .size;
          const markers = (body.match(/legacyControlName":"commentary_text/g) || []).length;
          console.log(
            `fetch: ${label} flagship (unmatched): ${response.status()} ids=${ids} markers=${markers} ${url.slice(0, 80)}`,
          );
        } catch {
          // the body read can race the page close; skip it
        }
      })();
      return;
    }
    if (!matched) return;
    void (async () => {
      try {
        const body = await response.text();
        received += 1;
        const minted = collectLinkedInPosts(body);
        let fresh = 0;
        for (const post of minted) {
          if (posts.has(post.id)) continue; // first-wins by urn
          posts.set(post.id, post);
          fresh += 1;
        }
        if (minted.length > 0) parsed += 1;
        // Extensive logging (live rehearsal 2026-11-11): every body names
        // its size, its mint count, and how many were NEW. Without this,
        // "no body arrived" and "body arrived, all duplicates" look alike.
        console.log(
          `fetch: ${label} body ${received}: ${body.length}B — ${minted.length} minted, ${fresh} new, ${minted.length - fresh} dup (total ${posts.size})`,
        );
      } catch {
        // the body read can race the page close; skip it
      }
    })();
  });

  try {
    await page.goto(buildContentSearchUrl(surface.value), {
      waitUntil: "domcontentloaded",
      timeout: LINKEDIN_NAV_TIMEOUT_MS,
    });
    // Log the landing URL BEFORE the checkpoint check: a halt that fires
    // first leaves the operator without the URL that tripped it.
    console.log(`fetch: ${label} landed: ${page.url?.() ?? "?"}`);
    assertNoCheckpoint();
    // The DOM carries no ids, so there is no hydration probe: the initial
    // results ride the first flagship-web response instead. A checkpoint
    // redirect can land on any poll tick — the per-tick URL re-check keeps
    // the halt class ahead of the dead-session timeout.
    // Liveness (REVISED 2026-11-11T20:00+0700, measured): the initial
    // results are SERVER-RENDERED. The page fires actions/component,
    // server-request and app-config — all with ids=0 markers=0 — and no
    // flagship-web body carrying posts. Waiting for one therefore times
    // out on a perfectly healthy page (the LEG DEAD this replaces). The
    // real signal is the DOM: the lazy column renders post cards. A
    // flagship body still counts, so either satisfies liveness.
    const maxPolls = Math.ceil(
      LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS / LINKEDIN_FIRST_RESPONSE_POLL_MS,
    );
    let polls = 0;
    let domPosts = 0;
    while (received === 0 && domPosts === 0 && polls < maxPolls) {
      await page.waitForTimeout(LINKEDIN_FIRST_RESPONSE_POLL_MS);
      assertNoCheckpoint();
      domPosts = Number(
        await page.evaluate(
          `document.querySelectorAll('[data-testid="lazy-column"] > div').length`,
        ),
      );
      polls += 1;
    }
    if (received === 0 && domPosts === 0) {
      throw legDead(
        `no flagship-web response and no rendered post within ${LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS}ms — the session may be dead`,
      );
    }
    console.log(`fetch: ${label} liveness: ${received} body(ies), ${domPosts} rendered post(s)`);
    // The adapter's locator is already the first text match; a transient
    // 0-match is a harmless dry round (the artifact's dry-round exit).
    const loadMore = page.locator(LOAD_MORE_SELECTOR);
    let dryRounds = 0;
    let clicks = 0;
    for (let round = 1; round <= scrollRounds && posts.size < LINKEDIN_MAX_POSTS; round += 1) {
      const before = posts.size;
      let clicked = false;
      let clickError = "";
      if (round === 1) {
        // One-shot DOM probe (live rehearsal 2026-11-11): a waitFor timeout
        // cannot distinguish "no button in the DOM" from "button present but
        // off-screen". Measured 18:15: loadMore 0 with 54 buttons present and
        // docH === viewportH — the button is absent and the document does not
        // scroll. The column metrics separate "column is scrollable and we
        // scrolled the wrong node" from "the page variant has no pagination".
        const domProbe = await page.evaluate(DOM_PROBE_JS);
        console.log(`fetch: ${label} dom probe (before scroll): ${String(domProbe)}`);
      }
      try {
        // Scroll the LAZY COLUMN, not the window (live rehearsal
        // 2026-11-11): the results live in [data-testid="lazy-column"],
        // which has its own scroll container — window.scrollTo moves
        // nothing ("no movement - page already at the top"). Scroll the
        // column to its end, then bring the button into view if it has
        // rendered. The return value names which case we are in.
        const scrollResult = await page.evaluate(SCROLL_JS);
        if (round === 1) {
          console.log(`fetch: ${label} scroll: ${String(scrollResult)}`);
          // Re-probe AFTER the scroll settles: the button may render
          // asynchronously once the column moves.
          await page.waitForTimeout(1_500);
          const after = await page.evaluate(DOM_PROBE_JS);
          console.log(`fetch: ${label} dom probe (after scroll): ${String(after)}`);
        }
        await loadMore.waitFor({ state: "visible", timeout: LINKEDIN_LOAD_MORE_WAIT_MS });
        await loadMore.click();
        clicked = true;
      } catch (error) {
        // No clickable button this round: the feed ended, or the next
        // batch is slow — a harmless dry round, no settle owed. The
        // message rides the log so "no button" and "clicked, no posts"
        // never look alike (live rehearsal 2026-11-11).
        clickError = error instanceof Error ? error.message : String(error);
      }
      if (clicked) {
        clicks += 1;
        // The settle window is the deleted walk's constant, unchanged: a
        // body that lands later costs ONE dry round and recovers on the
        // next good round (dryRounds resets below) — the same recovery the
        // Threads loop relies on (src/fetch-threads.ts:437-438).
        await page.waitForTimeout(LINKEDIN_SETTLE_MS);
        assertNoCheckpoint();
      }
      // Gain is the deduped map's growth: NEW posts only, never a re-served
      // urn — the same rule as the Threads loop (src/fetch-threads.ts:445).
      const gained = posts.size - before;
      const outcome = clicked ? "fired" : `no button (${clickError})`;
      if (gained < LINKEDIN_MIN_GAIN) {
        dryRounds += 1;
        console.log(
          `fetch: ${label} click ${round}: ${outcome} +${gained} new (dry ${dryRounds}/${LINKEDIN_MAX_DRY_ROUNDS}, total ${posts.size})`,
        );
        // The probe's floor: the dry exit may not fire before minClicks
        // clicks have landed, so one probe run samples several bodies
        // (live rehearsal 2026-11-11: 3 posts per body). The floor is
        // skipped when NO click has ever fired — an absent button would
        // otherwise burn every remaining round on a 5s waitFor timeout
        // (measured: 8 rounds x 5s = 40s of pure timeout).
        if (dryRounds >= LINKEDIN_MAX_DRY_ROUNDS && (clicks === 0 || clicks >= minClicks)) break;
      } else {
        dryRounds = 0;
        console.log(
          `fetch: ${label} click ${round}: ${outcome} +${gained} new (total ${posts.size})`,
        );
      }
    }
    // Let in-flight response bodies settle before the page goes away.
    await page.waitForTimeout(LINKEDIN_XHR_DRAIN_MS);
    console.log(
      `fetch: ${label} OK — ${posts.size} post(s) from ${parsed} response(s), ${received} body(ies) received, ${clicks} click(s) fired`,
    );
    return [...posts.values()];
  } finally {
    await page.close();
  }
}

/**
 * Walk every configured linkedin surface through the session browser:
 * ONE context for the whole walk (opened from the synthesized session
 * document, closed on every path), one paced navigation plus up to
 * `scrollRounds` Load-more clicks per surface, one log line per surface
 * (empty-is-success, defb8af). Surface faults warn + skip; leg-dead
 * aborts the tick whole via drain-then-throw; a checkpoint aborts via
 * the halt channel (the latch, not the episode marker); when EVERY
 * surface faulted, the tagged AllSurfacesFaulted throws — the caller
 * decides the write (D13: a partial fault still publishes the survivors).
 *
 * FR-5 (shuffled surface order): Fisher-Yates over {surface, index}
 * pairs with the injected rng — the navigation dispatch order varies per
 * tick while perSurface keeps ORIGINAL indexes, so the flat() reassembly
 * order stays input-order structural no matter how the shuffle lands.
 *
 * contextFactory defaults to the in-module production factory (the persistent
 * profile, headed); the PC scripts and the offline suite inject explicitly.
 */
export async function fetchLinkedInPosts(
  surfaces: readonly LinkedinSurface[],
  profileDir: string = LINKEDIN_PROFILE_DIR,
  contextFactory: LinkedInContextFactory = linkedinChromiumContextFactory,
  scrollRounds: number = LINKEDIN_DEFAULT_SCROLL_ROUNDS,
  sleepFn: SleepFn = defaultSleep,
  now: () => number = Date.now,
  rng: RandomFn = Math.random,
  minClicks = 0,
): Promise<Post[]> {
  // An empty surface list must never launch a browser: the callers guard
  // surfaces.length > 0, and this early return keeps the invariant local
  // (a zero-surface walk opens no context and closes nothing).
  if (surfaces.length === 0) return [];
  // REVISED 2026-11-11T18:40+0700: the browser opens on the persistent
  // profile, not a synthesized cookie document. The cookie file is a
  // preflight validity check in the CALLERS (resolveLinkedInCookies throws
  // on a missing/malformed file before the walk is reached).
  const context = await contextFactory(profileDir);
  const gate = makePacingGate(now, sleepFn, rng);
  const order = surfaces.map((surface, index) => ({ surface, index }));
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  // Side arrays indexed by the ORIGINAL surface index — runPool returns
  // void (src/pool.ts:33-52); reassembly order comes from the filter+flat walk.
  const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
  let faultedCount = 0;
  let deadReason: string | undefined;
  let haltReason: string | undefined;

  try {
    await runPool(order, LINKEDIN_FETCH_CONCURRENCY, async (entry) => {
      const surface = entry.surface;
      const label = `linkedin/${surface.value}`;
      try {
        // Drain checks: stop claiming the moment a halt or leg-dead is
        // flagged; the join re-throws once.
        if (deadReason !== undefined || haltReason !== undefined) return;
        await gate.wait();
        if (deadReason !== undefined || haltReason !== undefined) return;
        const posts = await walkLinkedInSurface(context, surface, label, scrollRounds, minClicks);
        // Stamp at the slot write (email-per-surface): the surface is a
        // LinkedinSurface, so type is always "linkedin" here. Fresh post
        // objects — the walk's parsed array is never mutated.
        perSurface[entry.index] = posts.map((post) => ({
          ...post,
          surfaces: [{ type: surface.type, value: surface.value }],
        }));
      } catch (error) {
        if (isHalt(error)) {
          // The checkpoint terminal drains like a leg-dead but lands in
          // the halt arm at the join — the account-safety latch, whose
          // alarm the operator must clear (design 2026-11-09).
          haltReason ??= error.reason;
          console.warn(`fetch: ${label} HALT — ${error.reason}`);
          return;
        }
        if (isLegDead(error)) {
          // Drain-then-throw (judgePosts D11 shape): flag, stop claiming,
          // re-throw once after the join. The tick aborts whole — partial
          // posts are discarded, never half-written.
          deadReason ??= error.reason;
          console.warn(`fetch: ${label} LEG DEAD — ${error.reason}`);
          return;
        }
        faultedCount += 1; // fault arm only; the halt/leg-dead arms return above
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch: ${label} FAILED — ${message}`);
      }
    });
  } finally {
    await context.close();
  }

  // Halt outranks leg-dead at the join: a checkpoint is the account-
  // safety terminal; a same-walk dead session still self-heals.
  if (haltReason !== undefined) {
    throw halt(haltReason);
  }
  if (deadReason !== undefined) {
    throw legDead(deadReason);
  }
  if (surfaces.length > 0 && faultedCount === surfaces.length) {
    throw allSurfacesFaulted(faultedCount);
  }
  return perSurface.filter((entry): entry is Post[] => entry !== undefined).flat();
}
