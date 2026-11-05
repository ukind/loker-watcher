/**
 * Offline suite for the voyager fetch leg.
 *
 * Covers: the §13.3 fault-classifier table incl. the 3xx redirect-loop rows
 * (live-observed 2026-11-05, Phase 8); the curl transport over a fake
 * exec (header set, status-sentinel parse, exec failure, missing-binary
 * fail-visible); the transport resolver accept/reject matrix; the runPool
 * surface walk over a scripted VoyagerGet — partial-page stop, exhaustion
 * stop, input-order reassembly under out-of-order completion, per-surface
 * fault skip, leg-dead drain-then-throw with sibling stop (the scripted-302
 * live-regression pin), leg-dead-beats-faults, all-faulted tagged throw vs
 * partial-fault degrade, pacing-gate spacing, drop-count warn,
 * empty-is-success, transport disposal. Zero
 * network and zero real sleeps: the VoyagerGet seam is the test double and
 * the multi-GET walk tests inject controlled sleeps; the playwright adapter
 * stays unexercised (the chromiumContextFactory precedent — the seam
 * carries the tests).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type LinkedinSurface,
  PAGE_SIZE,
  type VoyagerGet,
  type VoyagerResponse,
  allSurfacesFaulted,
  classifyFault,
  createCurlTransport,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isLegDead,
  legDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const COOKIES: LinkedInCookies = { liAt: "AQE-test", jsessionId: "ajax:0123456789012345678" };

/** An instant sleepFn: multi-GET walk tests pin paging order, not pacing. */
const instantSleep = async (): Promise<void> => undefined;

/** Build a §6-shaped 200 body carrying the given activity ids. */
const okBody = (ids: readonly string[]): string =>
  JSON.stringify({
    data: {
      searchDashClustersByAll: {
        elements: [
          {
            items: ids.map((id) => ({
              item: {
                searchFeedUpdate: {
                  update: {
                    metadata: { backendUrn: `urn:li:activity:${id}` },
                    commentary: { text: { text: `post ${id}` } },
                    actor: { name: { text: `author ${id}` } },
                    socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                  },
                },
              },
            })),
          },
        ],
      },
    },
    included: [],
  });

const page = (ids: readonly string[], status = 200, body?: string): VoyagerResponse => ({
  status,
  body: body ?? okBody(ids),
});

/** Distinct activity ids; second-resolution spacing keeps them unique. */
const idAt = (n: number): string => (BigInt(Date.UTC(2026, 9, 26, 9, 14, n)) << 22n).toString();
const FULL_PAGE: readonly string[] = Array.from({ length: PAGE_SIZE }, (_, i) => idAt(i));

const startOf = (url: string): string => /start:(\d+)/.exec(url)?.[1] ?? "";
/** The keyword token as it rides the URL (already URL-encoded); routes match raw. */
const surfaceOf = (url: string): string => /keywords:([^,)]+)/.exec(url)?.[1] ?? "";

/** Scripted transport: responds per URL matcher; records every call. */
function scriptGet(
  routes: ReadonlyArray<{
    match: (url: string) => boolean;
    respond: () => VoyagerResponse | Promise<VoyagerResponse>;
  }>,
): VoyagerGet & { calls: string[] } {
  const calls: string[] = [];
  const get: VoyagerGet = async (url) => {
    calls.push(url);
    const route = routes.find((candidate) => candidate.match(url));
    if (route === undefined) throw new Error(`unexpected GET: ${url}`);
    return route.respond();
  };
  return Object.assign(get, { calls });
}

/** A manually-resolved promise: stages one GET response for the pacing test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("classifyFault (§13.3 table)", () => {
  it("classifies the CSRF-403 text body as leg-dead", () => {
    const fault = classifyFault(403, "CSRF check failed.");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /CSRF/);
  });

  it("classifies a Cloudflare challenge 403 as leg-dead", () => {
    const fault = classifyFault(403, "<html>Just a moment... cf-ray: abc</html>");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /challenge/);
  });

  it("classifies 401 {status:401} as leg-dead (dead li_at)", () => {
    const fault = classifyFault(401, '{"status":401}');
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /li_at/);
  });

  it("classifies the bare 400 on the finder as leg-dead (no member context)", () => {
    const fault = classifyFault(400, '{"status":400}');
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /member context|dead session/);
  });

  it("classifies the graphql-envelope 400 as a fault (bad variables — our bug)", () => {
    const fault = classifyFault(400, '{"data":{"status":400},"included":[]}');
    assert.equal(fault.kind, "fault");
    assert.match(fault.reason, /bad variables/);
  });

  it("classifies 500 as a fault (queryId expiry, §15)", () => {
    const fault = classifyFault(500, "Internal Server Error");
    assert.equal(fault.kind, "fault");
    assert.match(fault.reason, /queryId/);
  });

  it("classifies any other non-200 as a fault", () => {
    assert.equal(classifyFault(503, "").kind, "fault");
  });

  it("classifies 302 as leg-dead naming the redirect loop (live-observed 2026-11-05)", () => {
    const fault = classifyFault(302, "");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /HTTP 302 redirect loop/);
    assert.match(fault.reason, /refresh the cookie file/);
  });

  it("pins the whole 3xx band: 301 and 307 are leg-dead too", () => {
    assert.equal(classifyFault(301, "").kind, "legDead");
    assert.equal(classifyFault(307, "").kind, "legDead");
  });

  it("classifies a 302 carrying a body as leg-dead (the body never matters)", () => {
    const fault = classifyFault(302, "<html>moved temporarily</html>");
    assert.equal(fault.kind, "legDead");
    assert.match(fault.reason, /redirect loop/);
  });
});

describe("createCurlTransport", () => {
  const RESPONSE_BODY = '{"data":{"searchDashClustersByAll":{"elements":[]}},"included":[]}';

  it("passes the URL, the §3/§10 header set, and parses the status sentinel", async () => {
    const execCalls: Array<{ file: string; args: readonly string[] }> = [];
    const make = createCurlTransport(
      COOKIES,
      { CURL_IMPERSONATE_BIN: "curl-chrome" },
      async (file, args) => {
        execCalls.push({ file, args });
        return { stdout: `${RESPONSE_BODY}\n___CURL_STATUS:200` };
      },
    );
    const transport = await make();
    const response = await transport.get("https://www.linkedin.com/voyager/api/graphql?x=1");

    assert.equal(response.status, 200);
    assert.equal(response.body, RESPONSE_BODY);
    assert.equal(execCalls.length, 1);
    const call = execCalls[0];
    assert.equal(call?.file, "curl-chrome");
    assert.ok(call?.args.includes("https://www.linkedin.com/voyager/api/graphql?x=1"));
    const headers = (call?.args ?? []).filter((arg, index) => call?.args[index - 1] === "-H");
    assert.ok(headers.includes('cookie: li_at=AQE-test; JSESSIONID="ajax:0123456789012345678"'));
    assert.ok(headers.includes("csrf-token: ajax:0123456789012345678"));
    assert.ok(headers.includes("x-restli-protocol-version: 2.0.0"));
    assert.ok(headers.includes("accept: application/json"));
    // Phase 8's 3xx leg-dead branch only sees the status because curl does
    // NOT follow redirects: one -L/--location in the arg array would follow
    // the dead 302 loop and republish the b2 empty-payload failure via curl.
    assert.ok(call?.args.every((arg) => arg !== "-L" && arg !== "--location"));
  });

  it("throws a surface fault (not leg-dead) when the exec fails", async () => {
    const make = createCurlTransport(COOKIES, { CURL_IMPERSONATE_BIN: "curl-chrome" }, async () => {
      throw new Error("connection reset");
    });
    const transport = await make();
    await assert.rejects(() => transport.get("https://x"), /curl exec failed — connection reset/);
  });

  it("fails visibly naming the variable when CURL_IMPERSONATE_BIN is unset", async () => {
    const make = createCurlTransport(COOKIES, {});
    await assert.rejects(() => make(), /CURL_IMPERSONATE_BIN is not set/);
  });
});

describe("resolveLinkedInTransport", () => {
  it("opens the curl transport by default over the injected exec", async () => {
    const transport = await resolveLinkedInTransport(
      { CURL_IMPERSONATE_BIN: "curl-chrome" },
      COOKIES,
      async () => ({ stdout: "\n___CURL_STATUS:200" }),
    );
    const response = await transport.get("https://x");
    assert.equal(response.status, 200);
    await transport.dispose();
  });

  it("opens the curl transport when LINKEDIN_TRANSPORT is explicitly curl", async () => {
    const transport = await resolveLinkedInTransport(
      { LINKEDIN_TRANSPORT: "curl", CURL_IMPERSONATE_BIN: "curl-chrome" },
      COOKIES,
      async () => ({ stdout: "\n___CURL_STATUS:200" }),
    );
    const response = await transport.get("https://x");
    assert.equal(response.status, 200);
    await transport.dispose();
  });

  it("throws naming the allowed values on an unknown LINKEDIN_TRANSPORT", async () => {
    await assert.rejects(
      () =>
        resolveLinkedInTransport(
          { LINKEDIN_TRANSPORT: "wget", CURL_IMPERSONATE_BIN: "curl-chrome" },
          COOKIES,
          async () => ({ stdout: "" }),
        ),
      /LINKEDIN_TRANSPORT="wget" is not one of: curl, playwright/,
    );
  });
});

describe("fetchLinkedInPosts (runPool walk)", () => {
  const oneSurface: readonly LinkedinSurface[] = [{ type: "linkedin", value: "#hiring react" }];

  it("stops on a partial page and returns the parsed posts in input order", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([idAt(1), idAt(2), idAt(3)]) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.equal(get.calls.length, 1);
    assert.deepEqual(
      posts.map((post) => post.id),
      [idAt(1), idAt(2), idAt(3)].map((id) => `urn:li:activity:${id}`),
    );
  });

  it("pages a full page, then stops on the exhaustion page (elements: [])", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page(FULL_PAGE) },
      { match: (url) => startOf(url) === "50", respond: () => page([]) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get, instantSleep);
    assert.equal(get.calls.length, 2);
    assert.equal(posts.length, PAGE_SIZE);
    assert.ok(get.calls[1]?.includes("start:50"));
  });

  it("paces voyager GETs PACE_MS apart through the injected clock and sleep", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page(FULL_PAGE) },
      { match: (url) => startOf(url) === "50", respond: () => page([idAt(99)]) },
    ]);
    await fetchLinkedInPosts(
      oneSurface,
      COOKIES,
      get,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
    );
    assert.deepEqual(sleeps, [5000]); // first GET is free; the second waits
    assert.equal(get.calls.length, 2);
  });

  it("reserves the pacing slot before sleeping, so concurrent waiters never share a wake time", async () => {
    // The width-2 walk must never fire a burst: each waiter reserves its
    // slot SYNCHRONOUSLY on entry (reserve-before-sleep), so B's target is
    // a full PACE_MS beyond A's in-flight reservation. An update-after-
    // sleep stamp would compute B's wake from the stale stamp and both
    // workers would GET together every PACE_MS. Deferred sleeps + deferred
    // GETs make the reservation order observable deterministically.
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const sleeps: number[] = [];
    const heldSleeps: Array<() => void> = [];
    const sleepFn = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => {
        heldSleeps.push(resolve);
      });
    };
    let tick = 0;
    const get0 = deferred<VoyagerResponse>();
    const get1 = deferred<VoyagerResponse>();
    const get2 = deferred<VoyagerResponse>();
    const get3 = deferred<VoyagerResponse>();
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "0",
        respond: () => get0.promise,
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "0",
        respond: () => get1.promise,
      },
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "50",
        respond: () => get2.promise,
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "50",
        respond: () => get3.promise,
      },
    ]);
    const walk = fetchLinkedInPosts(surfaces, COOKIES, get, sleepFn, () => tick);
    const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

    // A's first GET is open on the free slot; B reserved the NEXT slot
    // while A's GET was still in flight — call starts space PACE_MS apart.
    await flush();
    assert.deepEqual(sleeps, [5000]);

    // A's second reservation (its GET answered) lands a full PACE_MS beyond
    // B's in-flight reservation — the shared wake (burst) never happens.
    get0.resolve(page(FULL_PAGE));
    await flush();
    assert.deepEqual(sleeps, [5000, 10000]);

    // Release in reservation order: B GETs, then reserves beyond A again.
    heldSleeps[0]?.();
    tick += 5000;
    await flush();
    get1.resolve(page(FULL_PAGE));
    await flush();
    assert.deepEqual(sleeps, [5000, 10000, 10000]);

    // Drain the remaining held sleeps and GETs to completion.
    heldSleeps[1]?.();
    tick += 10000;
    await flush();
    get2.resolve(page([]));
    await flush();
    heldSleeps[2]?.();
    tick += 10000;
    await flush();
    get3.resolve(page([]));
    await flush();
    const posts = await walk;
    assert.equal(get.calls.length, 4);
    assert.equal(posts.length, PAGE_SIZE * 2); // both surfaces survived
  });

  it("reassembles two surfaces in input order under out-of-order completion", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15)); // B finishes first
          return page([idAt(1)]);
        },
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
  });

  it("skips a faulted surface (warn) and keeps the sibling's posts", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 400, '{"data":{"status":400},"included":[]}'),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(2)}`],
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a FAILED — .*bad variables/.test(line)));
  });

  it("drains then throws leg-dead once, and the sibling stops paging", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "0",
        respond: () => page(FULL_PAGE),
      },
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "50",
        respond: () => page([], 400, '{"status":400}'), // bare 400 = leg dead
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "0",
        respond: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25)); // still in flight when A flags
          return page(FULL_PAGE);
        },
      },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /dead session/);
    // Sibling stop: B never fired its second page after A flagged.
    assert.equal(
      get.calls.filter((url) => surfaceOf(url) === "%23b" && startOf(url) === "50").length,
      0,
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a LEG DEAD/.test(line)));
  });

  it("drains then throws leg-dead once on a scripted 302, sibling pager stopped (live-regression pin)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "0",
        respond: () => page(FULL_PAGE),
      },
      {
        match: (url) => surfaceOf(url) === "%23a" && startOf(url) === "50",
        respond: () => page([], 302, ""), // the live-observed dead-session presentation
      },
      {
        match: (url) => surfaceOf(url) === "%23b" && startOf(url) === "0",
        respond: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25)); // still in flight when A flags
          return page(FULL_PAGE);
        },
      },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /redirect loop/);
    assert.equal(isAllSurfacesFaulted(caught), false); // leg-dead, not the generic no-op
    // Sibling stop: B never fired its second page after A flagged.
    assert.equal(
      get.calls.filter((url) => surfaceOf(url) === "%23b" && startOf(url) === "50").length,
      0,
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a LEG DEAD/.test(line)));
  });

  it("leg-dead beats faults: 302 + 500 surfaces throw leg-dead, not AllSurfacesFaulted", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([], 302, "") },
      {
        match: (url) => surfaceOf(url) === "%23b",
        respond: () => page([], 500, "Internal Server Error"),
      },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isLegDead(caught)); // the drain check precedes the all-faulted throw
    assert.equal(isAllSurfacesFaulted(caught), false);
  });

  it("throws AllSurfacesFaulted when the ONLY surface hits an unparsable 200 body (a fault, never leg-dead)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([], 200, "<html>weird</html>") },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(oneSurface, COOKIES, get);
    } catch (error) {
      caught = error;
    }
    assert.ok(isAllSurfacesFaulted(caught));
    assert.equal((caught as Error).name, "AllSurfacesFaulted");
    assert.ok(!isLegDead(caught));
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /unparsable 200 body/.test(line)));
  });

  it("degrades on 1-of-2 faulted: the fine-empty survivor publishes [] with no throw", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 500, "Internal Server Error"),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([]) }, // fine-empty survivor
    ]);
    const posts = await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    assert.deepEqual(posts, []); // partial fault degrades; defb8af preserved
    const warned = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(warned.some((line) => /linkedin\/#a FAILED/.test(line)));
    const logged = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(logged.some((line) => /linkedin\/#b OK — 0 post\(s\)/.test(line)));
  });

  it("throws AllSurfacesFaulted with faulted === 2 when both surfaces fault", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 500, "Internal Server Error"),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([], 503, "") },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    assert.ok(isAllSurfacesFaulted(caught));
    assert.equal((caught as { faulted?: number }).faulted, 2);
    assert.match((caught as Error).message, /all 2 surface\(s\) faulted/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.filter((line) => /FAILED/.test(line)).length, 2);
  });

  it("counts dropped rows in a warn and keeps the valid rest", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const raw = JSON.stringify({
      data: {
        searchDashClustersByAll: {
          elements: [
            {
              items: [
                {
                  item: {
                    searchFeedUpdate: {
                      update: { metadata: { backendUrn: "urn:li:activity:7523282112511242241" } },
                    },
                  },
                },
                ...FULL_PAGE.slice(0, 2).map((id) => ({
                  item: {
                    searchFeedUpdate: {
                      update: {
                        metadata: { backendUrn: `urn:li:activity:${id}` },
                        commentary: { text: { text: `post ${id}` } },
                        actor: { name: { text: `author ${id}` } },
                        socialContent: { shareUrl: `https://www.linkedin.com/posts/x-${id}` },
                      },
                    },
                  },
                })),
              ],
            },
          ],
        },
      },
      included: [],
    });
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => ({ status: 200, body: raw }) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.equal(posts.length, 2);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /dropped 1 malformed row/.test(line)));
  });

  it("treats a zero-post surface as success (defb8af: empty is an outcome)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const get = scriptGet([{ match: (url) => startOf(url) === "0", respond: () => page([]) }]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get);
    assert.deepEqual(posts, []);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#hiring react OK — 0 post\(s\)/.test(line)));
  });

  it("disposes an opened Transport (not a bare VoyagerGet) in finally", async () => {
    let disposed = false;
    const transport = {
      get: scriptGet([{ match: () => true, respond: () => page([]) }]),
      dispose: async () => {
        disposed = true;
      },
    };
    await fetchLinkedInPosts(oneSurface, COOKIES, transport);
    assert.equal(disposed, true);
  });

  it("exposes the tagged leg-dead guard", () => {
    assert.ok(isLegDead(legDead("because")));
    assert.equal(isLegDead(new Error("plain")), false);
  });

  it("exposes the tagged all-faulted guard (judge-rotation idiom)", () => {
    const error = allSurfacesFaulted(2);
    assert.ok(isAllSurfacesFaulted(error));
    assert.equal(error.faulted, 2);
    assert.equal(isAllSurfacesFaulted(new Error("plain")), false);
    assert.equal(isAllSurfacesFaulted(legDead("because")), false);
  });
});

describe("Post shape (walk output)", () => {
  it("maps a parsed row to the normalized Post contract", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page([idAt(5)]) },
    ]);
    const posts = await fetchLinkedInPosts(
      [{ type: "linkedin", value: "#x" }] as const,
      COOKIES,
      get,
    );
    const first = posts[0] as Post;
    assert.equal(first.platform, "linkedin");
    assert.equal(first.text, `post ${idAt(5)}`);
    assert.equal(first.author, `author ${idAt(5)}`);
    assert.equal(first.permalink, `https://www.linkedin.com/posts/x-${idAt(5)}`);
    assert.equal(first.timestamp, new Date(Number(BigInt(idAt(5)) >> 22n)).toISOString());
  });
});
