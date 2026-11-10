/**
 * Offline suite for the voyager fetch leg.
 *
 * Covers: the §13.3 fault-classifier table incl. the 3xx redirect-loop rows
 * (live-observed 2026-11-05, Phase 8); the curl transport over a fake
 * exec (header set, status-sentinel parse, exec failure, missing-binary
 * fail-visible with BOTH Phase 9 remedies, --impersonate chrome116 pin,
 * user-agent absence pin); the transport resolver accept/reject matrix; the runPool
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
  PACE_MAX_MS,
  PACE_MIN_MS,
  PAGE_SIZE,
  type VoyagerGet,
  type VoyagerResponse,
  allSurfacesFaulted,
  classifyFault,
  createCurlTransport,
  fetchLinkedInPosts,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
  resolveLinkedInTransport,
} from "../src/linkedin-fetch.js";
import type { LinkedInCookies } from "../src/linkedin-session.js";
import type { Post } from "../src/types.js";

const COOKIES: LinkedInCookies = {
  liAt: "AQE-test",
  jsessionId: "ajax:0123456789012345678",
  harvestedAt: "2026-11-10T00:00:00.000Z", // FR-0: present, age never checked
};

/** An instant sleepFn: multi-GET walk tests pin paging order, not pacing. */
const instantSleep = async (): Promise<void> => undefined;

/** Deterministic LCG (Numerical Recipes constants) — no ambient Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

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

  it("classifies 429 as a HALT, never leg-dead (the account must slow down)", () => {
    const fault = classifyFault(429, "");
    assert.equal(fault.kind, "halt");
    assert.match(fault.reason, /429/);
    assert.equal(isLegDead(fault), false);
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
    // Phase 9: the pinned lexiforest profile rides the args, adjacent pair;
    // the profile OWNS the UA, so no user-agent pair may ride the -H values.
    const curlArgs = call?.args ?? [];
    const impersonateAt = curlArgs.indexOf("--impersonate");
    assert.ok(impersonateAt >= 0);
    assert.equal(curlArgs[impersonateAt + 1], "chrome116");
    assert.ok(headers.every((header) => !/^user-agent:/i.test(header)));
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

  it("names both remedies when CURL_IMPERSONATE_BIN is unset (Phase 9: setup-curl + the playwright line)", async () => {
    const make = createCurlTransport(COOKIES, {});
    await assert.rejects(
      () => make(),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /CURL_IMPERSONATE_BIN is not set/); // the Phase 3 prefix pin survives unchanged
        assert.match(message, /npm run setup-curl/);
        assert.match(message, /LINKEDIN_TRANSPORT=playwright in \.env/);
        return true;
      },
    );
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

  it("fetches ONE page per surface per tick — a full page never pages again (FR-3)", async () => {
    const get = scriptGet([
      { match: (url) => startOf(url) === "0", respond: () => page(FULL_PAGE) },
      { match: (url) => startOf(url) === "50", respond: () => page([]) },
    ]);
    const posts = await fetchLinkedInPosts(oneSurface, COOKIES, get, instantSleep);
    assert.equal(get.calls.length, 1); // the exhaustion route never fires
    assert.equal(posts.length, PAGE_SIZE);
    assert.equal(get.calls.filter((url) => startOf(url) === "50").length, 0);
  });

  it("paces voyager GETs a randomized 5-15 s apart through the injected rng", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([idAt(1)]) },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    // rng() === 0 pins the floor exactly: 5000 ms. Two surfaces — the cap
    // means one GET each, so A's GET is free and B's waits the floor.
    await fetchLinkedInPosts(
      [
        { type: "linkedin", value: "#a" },
        { type: "linkedin", value: "#b" },
      ],
      COOKIES,
      get,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
      () => 0,
    );
    assert.deepEqual(sleeps, [PACE_MIN_MS]);
    assert.equal(get.calls.length, 2);
  });

  it("keeps every pacing draw inside [5 s, 15 s) under a seeded rng", async () => {
    const sleeps: number[] = [];
    let tick = 0;
    const five: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
      { type: "linkedin", value: "#c" },
      { type: "linkedin", value: "#d" },
      { type: "linkedin", value: "#e" },
    ];
    const get = scriptGet([{ match: () => true, respond: () => page([idAt(1)]) }]);
    await fetchLinkedInPosts(
      five,
      COOKIES,
      get,
      (ms) => {
        sleeps.push(ms);
        tick += ms;
        return Promise.resolve();
      },
      () => tick,
      seededRng(2026_11_09),
    );
    assert.equal(sleeps.length, 4); // first GET free; four reservations
    for (const ms of sleeps) {
      assert.ok(ms >= PACE_MIN_MS && ms < PACE_MAX_MS, `out of band: ${ms}`);
    }
  });

  it("reserves the pacing slot before sleeping, so concurrent waiters never share a wake time", async () => {
    // The width-2 walk must never fire a burst: each waiter reserves its
    // slot SYNCHRONOUSLY on entry (reserve-before-sleep). Deferred sleeps
    // + deferred GETs make the reservation order observable. rng() === 0
    // shuffles [A, B] to [B, A], so B claims the free slot and A waits.
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
    const getA = deferred<VoyagerResponse>();
    const getB = deferred<VoyagerResponse>();
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => getA.promise },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => getB.promise },
    ]);
    const walk = fetchLinkedInPosts(
      surfaces,
      COOKIES,
      get,
      sleepFn,
      () => tick,
      () => 0,
    );
    const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

    // B's GET is open on the free slot; A reserved the NEXT slot while B's
    // GET was still in flight — call starts spaced apart, never together.
    await flush();
    assert.deepEqual(sleeps, [5000]);

    // B's GET answers; A's in-flight reservation is untouched — no burst.
    getB.resolve(page([idAt(2)]));
    await flush();
    assert.deepEqual(sleeps, [5000]);

    // Release A's sleep: A GETs, both surfaces complete.
    heldSleeps[0]?.();
    tick += 5000;
    await flush();
    getA.resolve(page([idAt(1)]));
    const posts = await walk;
    assert.equal(get.calls.length, 2);
    // Output order stays structural (input order) despite the [B, A] dispatch.
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
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

  it("drains then throws leg-dead once on page 0, and nothing publishes", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 400, '{"status":400}'), // bare 400 = leg dead
      },
      {
        match: (url) => surfaceOf(url) === "%23b",
        respond: () => page(FULL_PAGE),
      },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    // Tick-abort semantics: the walk THREW, so no surface's posts publish.
    // The post-wait drain check may starve the sibling's GET entirely —
    // a GET saved — so only the flag is pinned, never a call count.
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /dead session/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#a LEG DEAD/.test(line)));
  });

  it("drains then throws leg-dead once on a scripted page-0 302 (live-regression pin)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 302, ""), // the live-observed dead-session presentation
      },
      {
        match: (url) => surfaceOf(url) === "%23b",
        respond: () => page(FULL_PAGE),
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

  it("aborts the whole walk on an unparsable 200 (FR-4 ratified): leg-dead, never all-faulted", async (t) => {
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
    // FR-4 (ratified 2026-11-09): a changed response shape stops the
    // machine — the leg-dead channel's episode marker emails once per
    // episode and auto-clears on the next good tick.
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /unparsable 200 body/);
    assert.equal(isAllSurfacesFaulted(caught), false);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#hiring react LEG DEAD/.test(line)));
  });

  it("discards the tick when a surface goes unparsable, sibling included (tick abort)", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      {
        match: (url) => surfaceOf(url) === "%23a",
        respond: () => page([], 200, "<html>weird</html>"),
      },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page(FULL_PAGE) },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep);
    } catch (error) {
      caught = error;
    }
    // FR-4: the walk throws on the unparsable 200 — even a healthy
    // sibling's posts are discarded (nothing publishes from a stopped tick).
    assert.ok(isLegDead(caught));
    assert.match((caught as Error).message, /unparsable 200 body/);
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

describe("fetchLinkedInPosts surface shuffle (FR-5)", () => {
  it("dispatches in the shuffled order while output stays input order (rng=0 -> [B, C, A])", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
      { type: "linkedin", value: "#c" },
    ];
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([idAt(1)]) },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
      { match: (url) => surfaceOf(url) === "%23c", respond: () => page([idAt(3)]) },
    ]);
    const posts = await fetchLinkedInPosts(
      surfaces,
      COOKIES,
      get,
      instantSleep,
      () => 0,
      () => 0,
    );
    // rng() === 0 drives every Fisher-Yates swap to index 0: two swaps
    // (C<->A, then B<->C) take [A, B, C] to [B, C, A] — the GET transcript
    // proves the shuffle happened.
    assert.deepEqual(
      get.calls.map((url) => surfaceOf(url)),
      ["%23b", "%23c", "%23a"],
    );
    // Output order is structural (input order), independent of dispatch.
    assert.deepEqual(
      posts.map((post) => post.id),
      [idAt(1), idAt(2), idAt(3)].map((id) => `urn:li:activity:${id}`),
    );
  });

  it("preserves input order under a near-one rng (every swap lands on itself)", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
    ];
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([idAt(1)]) },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
    ]);
    const posts = await fetchLinkedInPosts(
      surfaces,
      COOKIES,
      get,
      instantSleep,
      () => 0,
      () => 0.999999999,
    );
    assert.deepEqual(
      get.calls.map((url) => surfaceOf(url)),
      ["%23a", "%23b"],
    );
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    );
  });

  it("pins the seeded Fisher-Yates dispatch transcript (the transcript IS the oracle)", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
      { type: "linkedin", value: "#c" },
    ];
    // Recompute the permutation with the same seed and the same swap loop.
    const order = surfaces.map((surface) => surface.value);
    const rng = seededRng(2026_11_09);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([]) },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([]) },
      { match: (url) => surfaceOf(url) === "%23c", respond: () => page([]) },
    ]);
    await fetchLinkedInPosts(surfaces, COOKIES, get, instantSleep, () => 0, seededRng(2026_11_09));
    assert.deepEqual(
      get.calls.map((url) => surfaceOf(url)),
      order.map((value) => encodeURIComponent(value)),
    );
  });
});

describe("fetchLinkedInPosts halt channel (429)", () => {
  it("throws the tagged HaltError on a 429, never leg-dead or all-faulted", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const get = scriptGet([{ match: () => true, respond: () => page([], 429, "") }]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts([{ type: "linkedin", value: "#hiring react" }], COOKIES, get);
    } catch (error) {
      caught = error;
    }
    assert.ok(isHalt(caught));
    assert.equal(isLegDead(caught), false);
    assert.equal(isAllSurfacesFaulted(caught), false);
    assert.match((caught as Error).message, /429/);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin\/#hiring react HALT/.test(line)));
  });

  it("stops claiming on a 429: no GET fires after the flag", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" },
      { type: "linkedin", value: "#b" },
      { type: "linkedin", value: "#c" },
    ];
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => page([], 429, "") },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => page([idAt(2)]) },
      { match: (url) => surfaceOf(url) === "%23c", respond: () => page([idAt(3)]) },
    ]);
    let caught: unknown;
    try {
      await fetchLinkedInPosts(
        surfaces,
        COOKIES,
        get,
        instantSleep,
        () => 0,
        () => 0,
      );
    } catch (error) {
      caught = error;
    }
    // rng=0 dispatch order [B, C, A]: B GETs fine, C GETs fine, A's 429
    // flags the halt — the walk throws and C's posts are discarded.
    assert.ok(isHalt(caught));
    assert.equal(get.calls.length, 3);
  });

  it("halt outranks leg-dead at the join: a 429 + a dead session throws HaltError", async () => {
    const surfaces: readonly LinkedinSurface[] = [
      { type: "linkedin", value: "#a" }, // 429
      { type: "linkedin", value: "#b" }, // 302
    ];
    // Park BOTH responses: both GETs issue (rng=0 dispatches [B, A]), THEN
    // the flags set — the both-flags race is the only way this join
    // priority is reachable (a flag set before a sibling's GET starves
    // that sibling via the post-wait drain check, and the lone flag wins).
    const getA = deferred<VoyagerResponse>();
    const getB = deferred<VoyagerResponse>();
    const get = scriptGet([
      { match: (url) => surfaceOf(url) === "%23a", respond: () => getA.promise },
      { match: (url) => surfaceOf(url) === "%23b", respond: () => getB.promise },
    ]);
    // Capture the outcome FIRST: the walk rejects while the test is still
    // in its flush sequence, and an unhandled rejection would fail the
    // test before the try block ever runs.
    const outcome = fetchLinkedInPosts(
      surfaces,
      COOKIES,
      get,
      instantSleep,
      () => 0,
      () => 0,
    ).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
    await flush();
    getB.resolve(page([], 302, "")); // B flags leg-dead first
    await flush();
    getA.resolve(page([], 429, "")); // A's in-flight response still classifies
    await flush();
    const settled = await outcome;
    assert.equal(settled.ok, false);
    const caught = settled.ok ? undefined : settled.error;
    assert.ok(isHalt(caught)); // the account-safety terminal outranks self-heal
    assert.equal(isLegDead(caught), false);
  });

  it("exposes the tagged halt guard", () => {
    assert.ok(isHalt(halt("because")));
    assert.equal(isHalt(new Error("plain")), false);
    assert.equal(isHalt(legDead("because")), false);
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
