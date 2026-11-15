/**
 * The LinkedIn surface walk statics (N060): the 11 tuning constants, the
 * DOM_PROBE_JS and SCROLL_JS snippets, the checkpoint/Activity regexes, and
 * the page-close vocabulary — moved verbatim out of linkedin-walk.ts so the
 * walk drops under the 500-line bar. Byte-identical strings: the pinned
 * SCROLL_JS content test (tests/fetch-linkedin.test.ts:986) must stay green.
 */
import { ACTIVITY_ID_PATTERN } from "./linkedin-parser.js";
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
export const LOAD_MORE_SELECTOR = 'button:has-text("Load more")';

/** Per-click settle: the pagination response lands inside this window (the deleted walk's constant). */
export const LINKEDIN_SETTLE_MS = 2_500;

/** The Load-more visibility window before a round counts dry. */
export const LINKEDIN_LOAD_MORE_WAIT_MS = 5_000;

/** Consecutive low-gain rounds before the surface exits early (the Threads loop's shape). */
export const LINKEDIN_MAX_DRY_ROUNDS = 3;

/** A round gaining fewer posts than this is dry (the Threads loop's threshold). */
export const LINKEDIN_MIN_GAIN = 2;

/** Per-surface post cap (rides from the deleted walk; the perf budget assumes it). */
export const LINKEDIN_MAX_POSTS = 150;

/**
 * Consecutive FIRST-WINS inserts of already-seen ids that stop a surface's
 * walk early (design 2026-11-13): a fully-seen keyword stops before it
 * burns scroll rounds re-minting what the hosted run already recorded.
 * Accrued handler-side inside the fresh-insert block: a fresh unseen
 * insert resets the count, and a re-served id never reaches the block, so
 * it never re-counts. Tuning constant, never config or env (repo doctrine).
 */
export const SEEN_STOP_CONSECUTIVE = 3;

/** Final drain: let in-flight response bodies land before the page closes. */
export const LINKEDIN_XHR_DRAIN_MS = 1_500;

/** One page navigation's wall-clock cap. */
export const LINKEDIN_NAV_TIMEOUT_MS = 30_000;

/** The first flagship-web response must land inside this window, or the leg is dead. */
export const LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS = 30_000;

/** Liveness poll interval for the first flagship-web response. */
export const LINKEDIN_FIRST_RESPONSE_POLL_MS = 250;

/**
 * The one-shot DOM probe (live rehearsal 2026-11-11). Reports the button
 * count, the Load-more count, and the lazy column's scroll metrics, so one
 * run distinguishes three cases: the button is absent (loadMore 0), it is
 * present but off-screen (loadMore 1, top > viewportH), or the column is
 * scrollable and the walk scrolled the wrong node (colScrollH > colClientH
 * with colScrollTop still 0).
 */
export const DOM_PROBE_JS = `(() => {
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
export const LINKEDIN_CHECKPOINT_URL_RE = /(^|\/)(checkpoint|authwall|login)(\/|$|\?)/i;

// Hoisted (N055): the digit floor is shared with the parser and the payload
// reader. String.prototype.matchAll clones the regex, so reuse across bodies
// never leaks lastIndex.
export const ACTIVITY_ID_RE = new RegExp(`urn:li:activity:(${ACTIVITY_ID_PATTERN})`, "g");
/**
 * The closed-target vocabulary Playwright raises when a body read loses the
 * page. Anything else reaching a listener catch is a real fault (N048): the
 * parser is documented never-throws, so a RangeError from it — or from the
 * capture path's Date conversion — is a defect worth one warn.
 */
export const PAGE_CLOSE_RACE_MESSAGES = [
  "Response body is unavailable",
  "Target page, context or browser has been closed",
  "Execution context was destroyed",
] as const;
