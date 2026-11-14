/**
 * The LinkedIn surface walk (N042b): one paced navigation plus up to
 * scrollRounds "Load more" clicks, parsing every intercepted flagship-web
 * response — moved verbatim out of linkedin-fetch.ts, with its 14 tuning
 * constants and its two JS snippets.
 *
 * The pacing gate does NOT live here: the walk never calls it.
 * fetchLinkedInPosts awaits gate.wait() and only then calls this function,
 * and the walk's signature has no gate parameter. The gate, defaultSleep,
 * PACE_MIN_MS, PACE_MAX_MS, LINKEDIN_FETCH_CONCURRENCY, and
 * LINKEDIN_DEFAULT_SCROLL_ROUNDS stay orchestration-side in
 * linkedin-fetch.ts.
 */
import type { ContextLike } from "./fetch-threads.js";
import { HALT_CHECKPOINT_REASON } from "./linkedin-behavior.js";
import {
  CAPTURE_SCHEMA_VERSION,
  type CaptureSink,
  type CaptureWarnState,
  captureOnce,
} from "./linkedin-capture.js";
import { halt, legDead } from "./linkedin-context.js";
// Type-only back-edge (the judge-rotation.ts:38-40 idiom): verbatimModuleSyntax
// erases it, so linkedin-fetch.ts can import this module's runtime symbol with
// no runtime cycle. Moving LinkedinSurface to linkedin-context.ts would put a
// surface type in a browser-context module for no gain.
import type { LinkedinSurface } from "./linkedin-fetch.js";
import {
  LINKEDIN_RESPONSE_RE,
  buildContentSearchUrl,
  collectLinkedInPosts,
} from "./linkedin-parser.js";
import type { Post } from "./types.js";
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

/** Per-surface post cap (rides from the deleted walk; the perf budget assumes it). */
const LINKEDIN_MAX_POSTS = 150;

/**
 * Consecutive FIRST-WINS inserts of already-seen ids that stop a surface's
 * walk early (design 2026-11-13): a fully-seen keyword stops before it
 * burns scroll rounds re-minting what the hosted run already recorded.
 * Accrued handler-side inside the fresh-insert block: a fresh unseen
 * insert resets the count, and a re-served id never reaches the block, so
 * it never re-counts. Tuning constant, never config or env (repo doctrine).
 */
const SEEN_STOP_CONSECUTIVE = 3;

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
/**
 * The closed-target vocabulary Playwright raises when a body read loses the
 * page. Anything else reaching a listener catch is a real fault (N048): the
 * parser is documented never-throws, so a RangeError from it — or from the
 * capture path's Date conversion — is a defect worth one warn.
 */
const PAGE_CLOSE_RACE_MESSAGES = [
  "Response body is unavailable",
  "Target page, context or browser has been closed",
  "Execution context was destroyed",
] as const;

function isPageCloseRace(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { name?: unknown }).name === "TargetClosedError") return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return PAGE_CLOSE_RACE_MESSAGES.some((fragment) => message.includes(fragment));
}
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
 *
 * Capture (design 2026-11-13, capture-first): when a sink rides the walk,
 * BOTH listener arms record the raw body as one CaptureRecord — the
 * matched arm adds minted/fresh, the unmatched diagnostic arm omits them.
 * captureOrdinal is the SHARED per-tick counter minted by
 * fetchLinkedInPosts (D7), incremented synchronously after each body read
 * so filenames stay unique and arrival-ordered across surfaces within the
 * session stamp. captureOnce is fire-and-forget: a sink rejection never
 * rejects the walk and warns once per surface walk (D4). A sink-less walk
 * captures nothing.
 */
export async function walkLinkedInSurface(
  context: ContextLike,
  surface: LinkedinSurface,
  label: string,
  scrollRounds: number,
  minClicks: number,
  seenIds: ReadonlySet<string>,
  captureSink: CaptureSink | undefined,
  captureOrdinal: { value: number },
  nowFn: () => number,
): Promise<Post[]> {
  const page = await context.newPage();
  const posts = new Map<string, Post>();
  let received = 0; // matched flagship-web bodies fully read — the liveness signal
  let parsed = 0; // bodies that carried at least one post — the OK-line counter (N008)
  const captureWarn: CaptureWarnState = { warned: false };
  let seenStreak = 0; // consecutive first-wins inserts of seen ids — the seen-stop signal
  let lastSeenId = ""; // the id that tipped the streak — named by the seen-stop line
  // Stream-order fold (N046): the listener arms are microtask continuations
  // after `await response.text()`, so two bodies can complete out of fire
  // order. The sequence number is minted SYNCHRONOUSLY when the arm starts —
  // before the try, before the await — and every (id, seen) entry carries
  // it. The fold recomputes the streak from scratch in seq order, so a body
  // that fires early but completes late cannot reset a streak that stream
  // order says should stand. Bounded by the post cap plus drain inserts.
  let seenSeq = 0;
  const seenEntries: Array<{ seq: number; id: string; seen: boolean }> = [];
  const foldSeenStreak = (): void => {
    let streak = 0;
    let last = lastSeenId;
    for (const entry of [...seenEntries].sort((a, b) => a.seq - b.seq)) {
      if (entry.seen) {
        streak += 1;
        last = entry.id;
      } else {
        streak = 0;
      }
    }
    seenStreak = streak;
    lastSeenId = last;
  };
  // Body-fault warn-once (N048): the two listener arms swallow the known
  // page-close race, but a parser RangeError or a capture-path RangeError
  // must not look identical to it. First real fault per walk warns; later
  // ones stay quiet (the captureOnce policy).
  const bodyFaultWarn: CaptureWarnState = { warned: false };
  const warnBodyFault = (arm: string, error: unknown): void => {
    if (bodyFaultWarn.warned) return;
    bodyFaultWarn.warned = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `fetch: ${label} ${arm} body fault (first this walk; further faults stay quiet) — ${message}`,
    );
  };
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
          // Capture-first (design 2026-11-13): the diagnostic arm records
          // the body too — the SSR firehose (ids=0, markers=0) is a REAL
          // response, and the replay needs it (commit 9fa2a7e).
          if (captureSink !== undefined) {
            captureOrdinal.value += 1;
            captureOnce(
              captureSink,
              {
                schemaVersion: CAPTURE_SCHEMA_VERSION,
                capturedAt: new Date(nowFn()).toISOString(),
                label,
                ordinal: captureOrdinal.value,
                received,
                url,
                status: response.status(),
                matched: false,
                body,
              },
              captureWarn,
            );
          }
          const ids = new Set([...body.matchAll(/urn:li:activity:(\d{10,})/g)].map((m) => m[1]))
            .size;
          const markers = (body.match(/legacyControlName":"commentary_text/g) || []).length;
          console.log(
            `fetch: ${label} flagship (unmatched): ${response.status()} ids=${ids} markers=${markers} ${url.slice(0, 80)}`,
          );
        } catch (error) {
          // The body read can race the page close — that class stays
          // silent. Anything else is a real fault: warn once per walk.
          if (!isPageCloseRace(error)) warnBodyFault("unmatched", error);
        }
      })();
      return;
    }
    if (!matched) return;
    // Mint the stream-order sequence SYNCHRONOUSLY, before the try and
    // before the await: this is the body's FIRE order, not its completion
    // order (N046).
    const seq = (seenSeq += 1);
    void (async () => {
      try {
        const body = await response.text();
        received += 1;
        const minted = collectLinkedInPosts(body);
        let fresh = 0;
        for (const post of minted) {
          if (posts.has(post.id)) continue; // first-wins by urn
          posts.set(post.id, post);
          // The entry carries the PRE-AWAIT seq: id and seen only exist
          // after the parse, but the order is the fire order.
          seenEntries.push({ seq, id: post.id, seen: seenIds.has(post.id) });
          fresh += 1;
        }
        // Fold in seq order, not completion order (N046).
        if (fresh > 0) foldSeenStreak();
        if (minted.length > 0) parsed += 1;
        // Extensive logging (live rehearsal 2026-11-11): every body names
        // its size, its mint count, and how many were NEW. Without this,
        // "no body arrived" and "body arrived, all duplicates" look alike.
        console.log(
          `fetch: ${label} body ${received}: ${body.length}B — ${minted.length} minted, ${fresh} new, ${minted.length - fresh} dup (total ${posts.size})`,
        );
        // Capture-first (design 2026-11-13): the matched arm adds minted/
        // fresh to the envelope — the replay names the mint decision per
        // row against these facts.
        if (captureSink !== undefined) {
          captureOrdinal.value += 1;
          captureOnce(
            captureSink,
            {
              schemaVersion: CAPTURE_SCHEMA_VERSION,
              capturedAt: new Date(nowFn()).toISOString(),
              label,
              ordinal: captureOrdinal.value,
              received,
              url,
              status: response.status(),
              matched: true,
              body,
              minted: minted.length,
              fresh,
            },
            captureWarn,
          );
        }
      } catch (error) {
        // The body read can race the page close — that class stays silent.
        if (!isPageCloseRace(error)) warnBodyFault("matched", error);
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
      // Seen-stop, pre-round (design 2026-11-13): a streak accrued by the
      // initial body stops before ANY round work — no DOM probe, no click.
      // The pre-stop mints ride the payload; the hosted chain dedupes them.
      if (seenStreak >= SEEN_STOP_CONSECUTIVE) {
        console.log(`fetch: ${label} seen-stop: ${lastSeenId}`);
        break;
      }
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
      } else {
        dryRounds = 0;
        console.log(
          `fetch: ${label} click ${round}: ${outcome} +${gained} new (total ${posts.size})`,
        );
      }
      // Seen-stop, post-log (design 2026-11-13, "print both lines"): on a
      // tie round the dry line above prints with its increment, THEN this
      // line breaks — ahead of the relocated dry exit below.
      if (seenStreak >= SEEN_STOP_CONSECUTIVE) {
        console.log(`fetch: ${label} seen-stop: ${lastSeenId}`);
        break;
      }
      // The probe's floor: the dry exit may not fire before minClicks
      // clicks have landed, so one probe run samples several bodies
      // (live rehearsal 2026-11-11: 3 posts per body). The floor is
      // skipped when NO click has ever fired — an absent button would
      // otherwise burn every remaining round on a 5s waitFor timeout
      // (measured: 8 rounds x 5s = 40s of pure timeout). Moved out of the
      // dry arm UNCHANGED (same condition): with the streak at 0, the loop
      // is byte-equivalent to the pre-seen-stop walk.
      if (
        gained < LINKEDIN_MIN_GAIN &&
        dryRounds >= LINKEDIN_MAX_DRY_ROUNDS &&
        (clicks === 0 || clicks >= minClicks)
      ) {
        break;
      }
    }
    // Let in-flight response bodies settle before the page goes away.
    await page.waitForTimeout(LINKEDIN_XHR_DRAIN_MS);
    console.log(
      `fetch: ${label} OK — ${posts.size} post(s) from ${parsed} response(s), ${received} body(ies) received, ${clicks} click(s) fired`,
    );
    // The cap is a real bound (N047): the listener keeps inserting during
    // the drain, so the map can exceed LINKEDIN_MAX_POSTS. Map order is
    // ARRIVAL order, not recency — each body mints ascending, but a later
    // page carries older posts — so a plain slice would keep the wrong 150.
    // Sort by derived timestamp and keep the newest.
    const collected = [...posts.values()];
    if (collected.length <= LINKEDIN_MAX_POSTS) return collected;
    return collected
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
      .slice(-LINKEDIN_MAX_POSTS);
  } finally {
    await page.close();
  }
}
