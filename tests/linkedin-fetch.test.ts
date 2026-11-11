/**
 * Offline suite for the LinkedIn browser walk (browser-walk migration,
 * slice 4). Covers: the byte-exact content-search navigation, the session
 * DOCUMENT the factory receives, the flagship-web response join (attach-
 * before-goto; off-endpoint and non-200 noise ignored; first-wins urn
 * dedupe; the N008 parsed-body OK-line counter), Load-more pagination
 * (click ceiling = scrollRounds, the dry-round exit, the 150-post cap),
 * the fault vocabulary (checkpoint URL -> HaltError at all three detector
 * sites — post-navigation, in the liveness poll, post-settle; no flagship
 * response -> LegDeadError; a plain goto failure -> surface fault), the
 * runPool skeleton (rng=0 shuffle transcript, input-order reassembly,
 * sibling starvation on halt, halt > leg-dead join priority, the
 * all-faulted throw, partial-post discard), pacing riding NAVIGATIONS
 * (floor pin, band sweep, reserve-before-sleep no-burst), teardown on
 * every path, the empty-surface no-launch guard, and the tagged guards.
 *
 * Zero network and zero real sleeps: structural ContextLike doubles carry
 * the tests (the fetch-threads suite idiom). Every response fires from
 * the page double itself — goto fires the initial body, a click's settle
 * fires the round's staged body — the same async shape as a real capture,
 * and every waitForTimeout yields one setImmediate tick so the walk's
 * async body reads drain deterministically before the walk's next
 * observation. Importing the module never loads Playwright.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextLike, LocatorLike, PageLike, ResponseLike } from "../src/fetch-threads.js";
import {
  type LinkedinSurface,
  PACE_MAX_MS,
  PACE_MIN_MS,
  allSurfacesFaulted,
  fetchLinkedInPosts,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
} from "../src/linkedin-fetch.js";
import type { Post } from "../src/types.js";

/** The profile path the walk opens; the suite pins it rides through untouched. */
const PROFILE = "C:/loker-secrets/linkedin-chromium-profile";

/** An instant sleepFn: multi-surface tests pin dispatch order, not pacing. */
const instantSleep = async (): Promise<void> => undefined;

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Drain the walk's async body reads: one setImmediate tick per flush. */
const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

const surface = (value: string): LinkedinSurface => ({ type: "linkedin", value });

/**
 * Capture-shaped ids: BigInt(epochMs) << 22n — the exact inverse of the
 * parser's BigInt(id) >> 22n clock. One minute of spacing keeps every id
 * distinct and time-ordered by n.
 */
const BASE_MS = Date.UTC(2026, 10, 11, 8, 0, 0);
const idAt = (n: number): string => (BigInt(BASE_MS + n * 60_000) << 22n).toString();
const postText = (n: number): string => `hiring post ${n} — Jakarta`;

/** One flight line. */
const row = (id: string, payload: unknown): string => `${id}:${JSON.stringify(payload)}`;

let cardSeq = 0;

/** One capture-shaped card: the activityUrn row precedes the commentary_text row. */
const cardBody = (id: string, text: string): string => {
  const n = (cardSeq += 1) * 10;
  return [
    row(String(n), { tracking: { activityUrn: { activityId: id } } }),
    row(String(n + 1), [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: [text] } }],
      },
    ]),
  ].join("\n");
};

/** Multi-card body: one (id, text) pair per card, cards in pair order. */
const cardBodyMany = (pairs: ReadonlyArray<readonly [string, string]>): string =>
  pairs.map(([id, cardText]) => cardBody(id, cardText)).join("\n");

/** A parseable flight body that mints ZERO posts (an empty-results page). */
const emptyBody = (): string => row("e1", { tracking: { activityUrn: { activityId: idAt(999) } } });

const SEARCH_RESULT_URL = "https://www.linkedin.com/search/results/content/";
const FLAGSHIP_SEARCH_URL = "https://www.linkedin.com/flagship-web/search/results/content/";
const PAGINATION_URL = "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination";
const CHECKPOINT_URL = "https://www.linkedin.com/checkpoint/challenge";

/**
 * The search URL the walk must navigate for a raw surface value — the
 * independent byte-exact goto oracle (the parser suite pins the builder;
 * this suite pins that the walk USES it).
 */
const searchUrl = (value: string): string =>
  `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(value)}&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D`;

/** One surface's script: what its page does at goto, click, and settle time. */
interface PageScript {
  /** The URL the page reports after goto (defaults to the navigated URL). */
  readonly url?: string;
  /** Goto throws this message (the surface fault arm, never leg-dead). */
  readonly gotoError?: string;
  /** The initial flagship-web body fired during goto; absent = silence. */
  readonly initialBody?: string;
  /** Fires only once this promise resolves (the parked no-burst fixture). */
  readonly initialGate?: Promise<void>;
  /** The initial response's status (default 200; non-200 never satisfies liveness). */
  readonly initialStatus?: number;
  /** True when round N's Load-more waitFor resolves (default always). */
  readonly loadMoreVisible?: (round: number) => boolean;
  /** The pagination body fired by round N's click settle (index 0 = round 1). */
  readonly clickBodies?: readonly string[];
  /**
   * Called with the 1-based waitForTimeout call count and the page's URL
   * setter — the mid-walk checkpoint fixtures.
   */
  readonly onWait?: (call: number, setUrl: (url: string) => void) => void;
  /** Extra responses fired on the first settle (the noise fixtures). */
  readonly noiseOnFirstSettle?: readonly ResponseLike[];
}

/** One created page, with the handles a test needs to steer and observe it. */
interface FakePage {
  readonly page: PageLike;
  readonly gotos: string[];
  readonly clicks: number[];
  readonly waits: number[];
  /** Every page.evaluate script, in call order — the scroll pin. */
  readonly evaluates: string[];
  setUrl(url: string): void;
}

/** The factory double: one page per newPage call, scripts matched by goto-URL fragment. */
function fakeContextFactory(options: {
  closed?: { value: boolean };
  profileDirs?: unknown[];
  built?: { value: number };
  scripts: ReadonlyArray<{ fragment: string; script: PageScript }>;
}): ((profileDir: string) => Promise<ContextLike>) & { pages: FakePage[] } {
  const pages: FakePage[] = [];
  const factory = async (profileDir: string): Promise<ContextLike> => {
    if (options.built !== undefined) options.built.value += 1;
    options.profileDirs?.push(profileDir);
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        let open = true;
        const listeners: Array<(response: ResponseLike) => void> = [];
        const fire = (response: ResponseLike): void => {
          for (const listener of listeners) listener(response);
        };
        const gotos: string[] = [];
        const clicks: number[] = [];
        const waits: number[] = [];
        const evaluates: string[] = [];
        let clickCount = 0;
        let waitCalls = 0;
        let settleArmed = false;
        let currentUrl = "";
        let matched: PageScript | undefined;
        const setUrl = (url: string): void => {
          currentUrl = url;
        };
        const page: PageLike = {
          url: () => (currentUrl === "" ? "about:blank" : currentUrl),
          goto: async (url) => {
            gotos.push(url);
            matched = options.scripts.find((candidate) => url.includes(candidate.fragment))?.script;
            if (matched?.gotoError !== undefined) throw new Error(matched.gotoError);
            currentUrl = matched?.url ?? url;
            const initial = matched?.initialBody;
            if (initial !== undefined) {
              const deliver = (): void => {
                fire({
                  url: () => FLAGSHIP_SEARCH_URL,
                  status: () => matched?.initialStatus ?? 200,
                  text: async () => initial,
                });
              };
              if (matched?.initialGate === undefined) deliver();
              else void matched.initialGate.then(deliver);
            }
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => {
            const handle: LocatorLike = {
              first: () => handle,
              waitFor: async () => {
                const visible = matched?.loadMoreVisible?.(clickCount + 1) ?? true;
                if (!visible) throw new Error("locator wait timeout");
              },
              click: async () => {
                clickCount += 1;
                clicks.push(clickCount);
                settleArmed = true;
              },
            };
            return handle;
          },
          evaluate: async (script: string) => {
            evaluates.push(script);
            // The liveness gate reads the rendered post count: the initial
            // results are server-rendered, not a flagship body. A script
            // with an initial body simulates a healthy page; a silent
            // script simulates a dead session.
            return script.includes("lazy-column") && matched?.initialBody !== undefined ? 8 : 0;
          },
          waitForTimeout: async (ms: number) => {
            waits.push(ms);
            waitCalls += 1;
            matched?.onWait?.(waitCalls, setUrl);
            if (settleArmed) {
              settleArmed = false;
              const body = matched?.clickBodies?.[clickCount - 1];
              if (body !== undefined) {
                fire({
                  url: () => PAGINATION_URL,
                  status: () => 200,
                  text: async () => body,
                });
              }
              if (clickCount === 1) {
                for (const noise of matched?.noiseOnFirstSettle ?? []) fire(noise);
              }
            }
            // One macrotask tick: the walk's async body reads drain before
            // its next observation (the deterministic handoff).
            await new Promise<void>((resolve) => setImmediate(resolve));
          },
          close: async () => {
            if (!open) return;
            open = false;
          },
        };
        pages.push({ page, gotos, clicks, waits, evaluates, setUrl });
        return page;
      },
      addInitScript: async () => undefined,
      close: async () => {
        if (options.closed !== undefined) options.closed.value = true;
      },
    };
    return context;
  };
  return Object.assign(factory, { pages });
}

/** The page a fragment matched (by its first goto). */
const pageFor = (factory: { pages: FakePage[] }, fragment: string): FakePage => {
  const found = factory.pages.find((page) => page.gotos.some((url) => url.includes(fragment)));
  if (found === undefined) throw new Error(`no page navigated ${fragment}`);
  return found;
};

/** The keywords-token transcript across every created page, in navigation order. */
const dispatchTranscript = (factory: { pages: FakePage[] }): string[] =>
  factory.pages.flatMap((page) => page.gotos).map((url) => /keywords=([^&]+)/.exec(url)?.[1] ?? "");

describe("fetchLinkedInPosts (browser walk)", () => {
  it("navigates the byte-exact content-search URL and returns parsed posts in input order", async () => {
    const closed = { value: false };
    const factory = fakeContextFactory({
      closed,
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        { fragment: "%23b", script: { initialBody: cardBody(idAt(2), postText(2)) } },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#a"), surface("#b")],
      PROFILE,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0.999999999,
    );
    assert.deepEqual(pageFor(factory, "%23a").gotos, [searchUrl("#a")]);
    assert.deepEqual(pageFor(factory, "%23b").gotos, [searchUrl("#b")]);
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [
        [`urn:li:activity:${idAt(1)}`, postText(1)],
        [`urn:li:activity:${idAt(2)}`, postText(2)],
      ],
    );
    assert.equal(closed.value, true); // teardown on the happy path
  });

  it("hands the factory the persistent profile path, not a cookie document", async () => {
    // REVISED 2026-11-11T18:40+0700: the browser rides the profile. A fresh
    // context with the synthesized cookie document gets a page with no
    // Load-more button (measured), so the walk must never build one.
    const profileDirs: unknown[] = [];
    const factory = fakeContextFactory({
      profileDirs,
      scripts: [{ fragment: "%23s", script: { initialBody: cardBody(idAt(1), postText(1)) } }],
    });
    await fetchLinkedInPosts([surface("#s")], PROFILE, factory, 8, instantSleep);
    assert.deepEqual(profileDirs, [PROFILE]);
  });

  it("clicks Load more up to the scrollRounds ceiling while every round gains", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23ceil",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            clickBodies: [
              cardBodyMany([
                [idAt(2), postText(2)],
                [idAt(3), postText(3)],
              ]),
              cardBodyMany([
                [idAt(4), postText(4)],
                [idAt(5), postText(5)],
              ]),
              cardBodyMany([
                [idAt(6), postText(6)],
                [idAt(7), postText(7)],
              ]),
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#ceil")], PROFILE, factory, 2, instantSleep);
    assert.deepEqual(pageFor(factory, "%23ceil").clicks, [1, 2]); // the knob, not the staged third body
    assert.equal(posts.length, 5); // 1 initial + 2 rounds x 2 posts
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /linkedin\/#ceil OK — 5 post\(s\) from 3 response\(s\)/.test(line)),
    );
  });

  it("exits on the third dry round when the Load-more button stops being visible", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23dry",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            loadMoreVisible: (round) => round === 1,
            clickBodies: [
              cardBodyMany([
                [idAt(2), postText(2)],
                [idAt(3), postText(3)],
                [idAt(4), postText(4)],
              ]),
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#dry")], PROFILE, factory, 8, instantSleep);
    assert.deepEqual(pageFor(factory, "%23dry").clicks, [1]);
    assert.deepEqual(
      posts.map((post) => post.id),
      [1, 2, 3, 4].map((n) => `urn:li:activity:${idAt(n)}`),
    );
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /\(dry 3\/3, total 4\)/.test(line)));
  });

  it("scrolls the lazy column before waiting for Load more (the Threads loop's shape)", async () => {
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23scroll",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            clickBodies: [cardBody(idAt(2), postText(2))],
          },
        },
      ],
    });
    await fetchLinkedInPosts([surface("#scroll")], PROFILE, factory, 1, instantSleep);
    const page = pageFor(factory, "%23scroll");
    // Round 1: DOM probe, column scroll, then a re-probe after the settle.
    assert.equal(page.evaluates.length, 3);
    assert.match(page.evaluates[0] ?? "", /loadMore/); // probe before the scroll
    assert.match(page.evaluates[1] ?? "", /lazy-column/); // the column scroll
    assert.match(page.evaluates[1] ?? "", /scrollIntoView/); // brings the button into view
    assert.match(page.evaluates[2] ?? "", /colScrollH/); // probe after the scroll
    // The scroll precedes the click, not the other way round.
    assert.equal(page.clicks.length, 1);
  });

  it("defers the dry exit until minClicks clicks have landed", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    // Every round is dry (no click body ever fires), so the dry counter
    // reaches 3 at round 3 — but the floor keeps the loop clicking.
    const factory = fakeContextFactory({
      scripts: [{ fragment: "%23floor", script: { initialBody: cardBody(idAt(1), postText(1)) } }],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#floor")],
      PROFILE,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
      5, // minClicks
    );
    assert.deepEqual(pageFor(factory, "%23floor").clicks, [1, 2, 3, 4, 5]);
    assert.equal(posts.length, 1); // only the initial body ever minted
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /\(dry 3\/3, total 1\)/.test(line))); // dry 3 did NOT break
  });

  it("does not apply the minClicks floor when no click ever fired (absent button)", async (t) => {
    // An absent button must not burn every round on a waitFor timeout: the
    // floor exists to sample bodies, and there are none without a click.
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23absent",
          script: { initialBody: cardBody(idAt(1), postText(1)), loadMoreVisible: () => false },
        },
      ],
    });
    await fetchLinkedInPosts(
      [surface("#absent")],
      PROFILE,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
      5, // minClicks — must NOT force 8 rounds
    );
    assert.equal(pageFor(factory, "%23absent").clicks.length, 0);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    // Three dry rounds end it, exactly as with minClicks 0 — round 4 never runs.
    assert.ok(lines.some((line) => /click 3: no button/.test(line)));
    assert.equal(
      lines.some((line) => /click 4:/.test(line)),
      false,
    );
  });

  it("names the click failure in the log — no button is never mistaken for a dry click", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23nobtn",
          script: { initialBody: cardBody(idAt(1), postText(1)), loadMoreVisible: () => false },
        },
      ],
    });
    await fetchLinkedInPosts([surface("#nobtn")], PROFILE, factory, 8, instantSleep);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /click 1: no button \(locator wait timeout\)/.test(line)));
    assert.equal(
      lines.some((line) => /click 1: fired/.test(line)),
      false,
    );
  });

  it("never clicks past the 150-post cap", async () => {
    const all = Array.from({ length: 150 }, (_, i) => [idAt(i + 1), postText(i + 1)] as const);
    const factory = fakeContextFactory({
      scripts: [{ fragment: "%23cap", script: { initialBody: cardBodyMany(all) } }],
    });
    const posts = await fetchLinkedInPosts([surface("#cap")], PROFILE, factory, 8, instantSleep);
    assert.equal(posts.length, 150); // one body may carry all 150 (the cap bounds clicks, not a body)
    assert.deepEqual(pageFor(factory, "%23cap").clicks, []);
  });

  it("dedupes a repeated urn across bodies — the first mint wins", async () => {
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23dup",
          script: {
            initialBody: cardBody(idAt(1), "first mint"),
            clickBodies: [
              cardBodyMany([
                [idAt(1), "second mint"],
                [idAt(2), postText(2)],
              ]),
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#dup")], PROFILE, factory, 1, instantSleep);
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [
        [`urn:li:activity:${idAt(1)}`, "first mint"],
        [`urn:li:activity:${idAt(2)}`, postText(2)],
      ],
    );
  });

  it("ignores off-endpoint and non-200 responses — the join never leaves the flagship filter", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23noise",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            noiseOnFirstSettle: [
              {
                url: () => "https://www.threads.com/api/graphql",
                status: () => 200,
                text: async () => cardBody(idAt(50), "noise threads body"),
              },
              {
                url: () => "https://www.linkedin.com/flagship-web/search/results/content/",
                status: () => 500,
                text: async () => cardBody(idAt(51), "noise 500 body"),
              },
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#noise")], PROFILE, factory, 1, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`],
    );
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /linkedin\/#noise OK — 1 post\(s\) from 1 response\(s\)/.test(line)),
    );
  });

  it("treats a zero-post page as success — the OK line counts parsed bodies (N008), not received", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23empty",
          script: { initialBody: emptyBody(), loadMoreVisible: () => false },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#empty")], PROFILE, factory, 8, instantSleep);
    assert.deepEqual(posts, []);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /linkedin\/#empty OK — 0 post\(s\) from 0 response\(s\)/.test(line)),
    );
  });

  it("throws the tagged LegDeadError when no flagship response arrives in the liveness window", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const closed = { value: false };
    const factory = fakeContextFactory({
      closed,
      scripts: [{ fragment: "%23silent", script: {} }],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts([surface("#silent")], PROFILE, factory, 8, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
    assert.equal(isHalt(caught), false);
    assert.match(
      (caught as Error).message,
      /no flagship-web response and no rendered post within 30000ms/,
    );
    assert.equal(pageFor(factory, "%23silent").waits.length, 120); // the full poll budget, 250ms x 120
    assert.equal(closed.value, true); // teardown on the leg-dead path
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#silent LEG DEAD/.test(line)));
  });

  it("ignores a non-200 flagship body — the rendered DOM satisfies liveness, the body mints nothing", async () => {
    // REVISED 2026-11-11T20:00+0700: liveness is the rendered post count,
    // not a flagship body (the initial results are server-rendered). A 503
    // body is still never parsed, so it mints nothing — but it no longer
    // decides whether the walk is alive.
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23slow5",
          script: { initialBody: cardBody(idAt(1), postText(1)), initialStatus: 503 },
        },
      ],
    });
    const posts = await fetchLinkedInPosts([surface("#slow5")], PROFILE, factory, 8, instantSleep);
    assert.deepEqual(posts, []);
  });

  it("halts on a checkpoint URL right after the navigation (never leg-dead, never a fault)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const closed = { value: false };
    const factory = fakeContextFactory({
      closed,
      scripts: [{ fragment: "%23cp", script: { url: CHECKPOINT_URL } }],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts([surface("#cp")], PROFILE, factory, 8, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.equal(isLegDead(caught), false);
    assert.match((caught as Error).message, /re-harvest/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#cp HALT/.test(line)));
    assert.equal(closed.value, true); // teardown on the halt path
  });

  it("halts when a checkpoint lands during the liveness poll — the halt class wins the race", async () => {
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23slow",
          script: {
            onWait: (call, setUrl) => {
              if (call === 3) setUrl(CHECKPOINT_URL);
            },
          },
        },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts([surface("#slow")], PROFILE, factory, 8, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.equal(isLegDead(caught), false);
  });

  it("halts when a checkpoint lands after a click settle", async () => {
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23mid",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            clickBodies: [cardBody(idAt(2), postText(2))],
            onWait: (call, setUrl) => {
              if (call === 1) setUrl(CHECKPOINT_URL);
            },
          },
        },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts([surface("#mid")], PROFILE, factory, 8, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.match((caught as Error).message, /re-harvest/);
  });

  it("starves the remaining surface once a sibling halts and discards partial posts", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        { fragment: "%23b", script: { url: CHECKPOINT_URL } },
        { fragment: "%23c", script: { initialBody: cardBody(idAt(3), postText(3)) } },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        [surface("#a"), surface("#b"), surface("#c")],
        PROFILE,
        factory,
        8,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    // rng=0 dispatches [B, C, A]: B halts, C completes, A never claims.
    assert.deepEqual(dispatchTranscript(factory), ["%23b", "%23c"]);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#b HALT/.test(line)));
  });

  it("aborts the whole tick when a surface goes dead — the sibling's posts are discarded", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23dead", script: {} },
        { fragment: "%23ok", script: { initialBody: cardBody(idAt(2), postText(2)) } },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        [surface("#dead"), surface("#ok")],
        PROFILE,
        factory,
        8,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
    assert.match(
      (caught as Error).message,
      /no flagship-web response and no rendered post within 30000ms/,
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#dead LEG DEAD/.test(line)));
  });

  it("skips a faulted navigation (warn) and keeps the sibling's posts", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23bad", script: { gotoError: "navigation failed" } },
        { fragment: "%23good", script: { initialBody: cardBody(idAt(2), postText(2)) } },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#bad"), surface("#good")],
      PROFILE,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
    );
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(2)}`],
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#bad FAILED — navigation failed/.test(line)));
  });

  it("throws AllSurfacesFaulted with faulted === 2 when every navigation fails", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23x", script: { gotoError: "navigation failed" } },
        { fragment: "%23y", script: { gotoError: "navigation failed" } },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        [surface("#x"), surface("#y")],
        PROFILE,
        factory,
        8,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isAllSurfacesFaulted(caught));
    assert.equal((caught as { faulted?: number }).faulted, 2);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.filter((line) => /FAILED/.test(line)).length, 2);
  });

  it("never launches a browser for an empty surface list", async () => {
    const built = { value: 0 };
    const profileDirs: unknown[] = [];
    const factory = fakeContextFactory({ built, profileDirs, scripts: [] });
    const posts = await fetchLinkedInPosts([], PROFILE, factory, 8, instantSleep);
    assert.deepEqual(posts, []);
    assert.equal(built.value, 0);
    assert.deepEqual(profileDirs, []);
  });

  it("halts outrank leg-dead at the join when both flags set in one walk", async () => {
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23cp", script: { url: CHECKPOINT_URL } },
        { fragment: "%23dead", script: {} },
      ],
    });
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        [surface("#cp"), surface("#dead")],
        PROFILE,
        factory,
        8,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.equal(isLegDead(caught), false);
    assert.equal(isAllSurfacesFaulted(caught), false);
  });
});

describe("fetchLinkedInPosts surface shuffle (FR-5)", () => {
  it("dispatches [B, C, A] under rng=0 while output stays input order", async () => {
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        { fragment: "%23b", script: { initialBody: cardBody(idAt(2), postText(2)) } },
        { fragment: "%23c", script: { initialBody: cardBody(idAt(3), postText(3)) } },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#a"), surface("#b"), surface("#c")],
      PROFILE,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
    );
    // The goto transcript proves the shuffle happened; reassembly is
    // structural (input order), independent of dispatch.
    assert.deepEqual(dispatchTranscript(factory), ["%23b", "%23c", "%23a"]);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`, `urn:li:activity:${idAt(3)}`],
    );
  });
});

describe("pacing rides navigations", () => {
  it("pins the floor: the second navigation sleeps exactly PACE_MIN_MS under rng=0", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        { fragment: "%23b", script: { initialBody: cardBody(idAt(2), postText(2)) } },
      ],
    });
    await fetchLinkedInPosts(
      [surface("#a"), surface("#b")],
      PROFILE,
      factory,
      8,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
      () => 0,
    );
    assert.deepEqual(sleeps, [PACE_MIN_MS]); // B free; A waits the floor
    assert.deepEqual(dispatchTranscript(factory), ["%23b", "%23a"]);
  });

  it("keeps every navigation spacing inside [5s, 15s) under a seeded rng", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const five = ["#a", "#b", "#c", "#d", "#e"].map(surface);
    const factory = fakeContextFactory({
      scripts: five.map((s) => ({
        fragment: encodeURIComponent(s.value),
        script: { initialBody: cardBody(idAt(1), postText(1)) },
      })),
    });
    await fetchLinkedInPosts(
      five,
      PROFILE,
      factory,
      8,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
      seededRng(2026_11_09),
    );
    assert.equal(sleeps.length, 4); // first navigation free; four reservations
    for (const ms of sleeps) {
      assert.ok(ms >= PACE_MIN_MS && ms < PACE_MAX_MS, `out of band: ${ms}`);
    }
  });

  it("reserves the pacing slot before sleeping, so a width-2 sibling never bursts", async () => {
    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const sleeps: number[] = [];
    const heldSleeps: Array<() => void> = [];
    const sleepFn = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => {
        heldSleeps.push(resolve);
      });
    };
    const factory = fakeContextFactory({
      scripts: [
        { fragment: "%23a", script: { initialBody: cardBody(idAt(1), postText(1)) } },
        {
          fragment: "%23b",
          script: {
            initialBody: cardBody(idAt(2), postText(2)),
            initialGate: gateB, // B's response parks until released
          },
        },
      ],
    });
    const walk = fetchLinkedInPosts(
      [surface("#a"), surface("#b")],
      PROFILE,
      factory,
      8,
      sleepFn,
      () => 0,
      () => 0,
    );
    await flush();
    // rng=0 dispatches [B, A]: B takes the free slot (no sleep recorded),
    // A reserves the NEXT slot synchronously — its floor sleep is recorded
    // while B's response is still parked (reserve-before-sleep).
    assert.deepEqual(sleeps, [PACE_MIN_MS]);
    releaseB();
    await flush();
    heldSleeps[0]?.();
    const posts = await walk;
    // A never recorded a second sleep — its reservation was made while B
    // was in flight, not after B completed.
    assert.deepEqual(sleeps, [PACE_MIN_MS]);
    // Output order stays structural despite the [B, A] dispatch.
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
  });
});

describe("walk guards and post shape", () => {
  it("exposes the tagged error guards", () => {
    assert.ok(isLegDead(legDead("because")));
    assert.equal(isLegDead(new Error("plain")), false);
    assert.ok(isHalt(halt("because")));
    assert.equal(isHalt(legDead("because")), false);
    const error = allSurfacesFaulted(2);
    assert.ok(isAllSurfacesFaulted(error));
    assert.equal(error.faulted, 2);
    assert.equal(isAllSurfacesFaulted(legDead("because")), false);
  });

  it("stamps every minted post with the surface pair and keeps the parser's fields whole", async () => {
    const factory = fakeContextFactory({
      scripts: [{ fragment: "%23x", script: { initialBody: cardBody(idAt(1), postText(1)) } }],
    });
    const posts = await fetchLinkedInPosts([surface("#x")], PROFILE, factory, 8, instantSleep);
    const first = posts[0] as Post;
    assert.equal(first.platform, "linkedin");
    assert.equal(first.author, "linkedin-member");
    assert.equal(first.id, `urn:li:activity:${idAt(1)}`);
    assert.equal(
      first.permalink,
      `https://www.linkedin.com/feed/update/urn:li:activity:${idAt(1)}`,
    );
    assert.equal(first.timestamp, new Date(BASE_MS + 60_000).toISOString());
    assert.deepEqual(first.surfaces, [{ type: "linkedin", value: "#x" }]);
  });
});
