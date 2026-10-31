/**
 * Offline suite for the LinkedIn walker (Phase 3).
 *
 * The flight bodies are synthetic literals built in the captured field
 * layout — commentary_text view marker, textProps.children React element
 * trees, activityUrn.activityId ids, "$<row>" / "$<row>:path" references
 * (evidence: .rpiv/tmp/pw/body-*.txt, capture 2026-10-31; one real minting
 * row transitively pulls ~380KB of stream, so the rows are documented here
 * in trimmed form). Every case injects a ContextLike double — importing
 * this file never loads Playwright.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedSurface } from "../src/config-file.js";
import {
  collectLinkedInPosts,
  fetchLinkedInSurface,
  parseFlightRows,
} from "../src/fetch-linkedin.js";
import type { ContextLike, LocatorLike, PageLike, ResponseLike } from "../src/fetch-threads.js";

/** Capture-verified ids: BigInt(id) >> 22n pins both epochs (research 2026-10-31). */
const ID_A = "7522028760582447104"; // 2026-10-30T20:16:49.059Z
const ID_B = "7522121950970900481"; // 2026-10-31T02:27:07.379Z

const linkedinSurface = (label: string): ResolvedSurface => ({
  platform: "linkedin",
  label,
  url: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(label)}`,
});

/** One flight line. */
const row = (id: string, payload: unknown): string => `${id}:${JSON.stringify(payload)}`;

let cardSeq = 0;

/** Self-contained card stream: the activityUrn row precedes the commentary_text row. */
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

/** One captured card, trimmed: strong/br elements, a plain string, and a
 * "$3:textProps.children" shared-subtree path reference in the text. */
const richCardBody = (): string =>
  [
    row("1", { tracking: { activityUrn: { activityId: ID_A } } }),
    row("2", [
      "$",
      "$L3",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: [
          "$",
          "$Ltext",
          null,
          {
            textProps: {
              fontFamily: "sans",
              children: [
                ["$", "strong", "text-attr-0", { children: ["WE ARE HIRING"] }],
                ["$", "br", "0", {}],
                "Calling new grads in Vancouver.",
                "$3:textProps:children",
              ],
            },
          },
        ],
      },
    ]),
    row("3", { textProps: { children: ["Shared tail"] } }),
  ].join("\n");

/**
 * Context double: the page fires the initial body at goto time and one
 * staged body per wheel round — the same async shape as a real capture.
 * Tracks wheel calls, waitForTimeout durations, and page teardown.
 */
function fakeContext(options: {
  initialBody?: string;
  wheelBodies?: readonly string[];
  wheel?: { calls: number };
  settleWaits?: number[];
  closed?: { value: boolean };
  gotoError?: Error;
  noWheel?: boolean;
}): ContextLike {
  return {
    newPage: async (): Promise<PageLike> => {
      const listeners: Array<(response: ResponseLike) => void> = [];
      let open = true;
      const fire = (body: string): void => {
        const response: ResponseLike = {
          url: () => "https://www.linkedin.com/flagship-web/search/results/content/?keywords=x",
          status: () => 200,
          text: async () => body,
        };
        for (const listener of listeners) listener(response);
      };
      const wheel = options.wheel ?? { calls: 0 };
      if (options.wheel === undefined) options.wheel = wheel;
      const page: PageLike = {
        goto: async () => {
          if (options.gotoError !== undefined) throw options.gotoError;
          if (options.initialBody !== undefined) fire(options.initialBody);
          return undefined;
        },
        waitForFunction: async () => undefined,
        content: async () => "<html></html>",
        on: (_event, listener) => {
          listeners.push(listener);
          return undefined;
        },
        locator: (): LocatorLike => {
          throw new Error("locator not expected on the LinkedIn page");
        },
        evaluate: async () => undefined,
        waitForTimeout: async (ms: number) => {
          options.settleWaits?.push(ms);
        },
        ...(options.noWheel
          ? {}
          : {
              mouse: {
                move: async () => undefined,
                wheel: async () => {
                  const round = wheel.calls + 1;
                  wheel.calls = round;
                  const body = options.wheelBodies?.[round - 1];
                  if (body !== undefined) fire(body);
                },
              },
            }),
        close: async () => {
          if (!open) return;
          open = false;
        },
      };
      return page;
    },
    addInitScript: async () => undefined,
    close: async () => {
      if (options.closed !== undefined) options.closed.value = true;
    },
  };
}

describe("collectLinkedInPosts", () => {
  it("mints the capture-verified card: path-ref text, urn id, id-derived timestamp", () => {
    const posts = collectLinkedInPosts(richCardBody());
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0], {
      platform: "linkedin",
      id: `urn:li:activity:${ID_A}`,
      text: "WE ARE HIRING\nCalling new grads in Vancouver.Shared tail",
      author: "linkedin-member",
      permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${ID_A}`,
      timestamp: "2026-10-30T20:16:49.059Z",
    });
  });

  it("dedupes a repeated activity id, keeping the first mint", () => {
    const body = [cardBody(ID_A, "first"), cardBody(ID_A, "second")].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [[`urn:li:activity:${ID_A}`, "first"]],
    );
  });

  it("preserves stream order across two cards", () => {
    const body = [cardBody(ID_A, "a"), cardBody(ID_B, "b")].join("\n");
    assert.deepEqual(
      collectLinkedInPosts(body).map((post) => post.id),
      [`urn:li:activity:${ID_A}`, `urn:li:activity:${ID_B}`],
    );
  });

  it("skips module-manifest rows and garbage lines around the data rows", () => {
    const body = ['0:I["$1",[],"default"]', "not-a-flight-line", richCardBody()].join("\n");
    assert.equal(collectLinkedInPosts(body).length, 1);
  });

  it("skips a commentary_text card whose activity id has not been seen", () => {
    const markerOnly = row("7", [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: ["orphan"] } }],
      },
    ]);
    assert.deepEqual(collectLinkedInPosts(markerOnly), []);
  });

  it("skips a card whose text harvest is empty", () => {
    const n = (cardSeq += 1) * 10;
    const body = [
      row(String(n), { tracking: { activityUrn: { activityId: ID_A } } }),
      row(String(n + 1), [
        "$",
        "$Lmark",
        null,
        {
          viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
          children: ["$", "$Ldiv", null, { textProps: { children: [["$", "br", "0", {}]] } }],
        },
      ]),
    ].join("\n");
    assert.deepEqual(collectLinkedInPosts(body), []); // br-only text trims to ""
  });
});

describe("parseFlightRows", () => {
  it("parses data rows in stream order and skips module rows", () => {
    const rows = parseFlightRows(
      ['0:I["$1",[],"default"]', row("1", { a: 1 }), row("2", [1, 2])].join("\n"),
    );
    assert.deepEqual([...rows.keys()], ["1", "2"]);
    assert.deepEqual(rows.get("1"), { a: 1 });
  });
});

describe("fetchLinkedInSurface", () => {
  it("mints the initial response and staged wheel pages in order, then drains", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const wheel = { calls: 0 };
    const settleWaits: number[] = [];

    const posts = await fetchLinkedInSurface(
      fakeContext({
        initialBody: cardBody(ID_A, "a"),
        wheelBodies: [
          [cardBody("7522130389847670784", "b1"), cardBody("7522130389847670785", "b2")].join("\n"),
          [cardBody("7522130389847670786", "c1"), cardBody("7522130389847670787", "c2")].join("\n"),
        ],
        wheel,
        settleWaits,
      }),
      linkedinSurface("linkedin/#hiring"),
      8,
    );

    assert.deepEqual(
      posts.map((post) => post.id),
      [
        `urn:li:activity:${ID_A}`,
        "urn:li:activity:7522130389847670784",
        "urn:li:activity:7522130389847670785",
        "urn:li:activity:7522130389847670786",
        "urn:li:activity:7522130389847670787",
      ],
    );
    assert.equal(wheel.calls, 5); // rounds 1-2 gain, rounds 3-5 go dry (3/3)
    assert.equal(settleWaits[0], 2500); // the scroll settle rides before the drain
    assert.equal(settleWaits[settleWaits.length - 1], 1500);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /linkedin\/#hiring OK — 5 post\(s\) from 3 response\(s\)/.test(line)),
      `no OK line in: ${JSON.stringify(lines)}`,
    );
  });

  it("re-minting an already-seen id keeps the first mint across responses", async () => {
    const posts = await fetchLinkedInSurface(
      fakeContext({
        initialBody: cardBody(ID_A, "first"),
        wheelBodies: [[cardBody(ID_A, "second"), cardBody(ID_B, "b")].join("\n")],
      }),
      linkedinSurface("linkedin/#hiring"),
      8,
    );
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [
        [`urn:li:activity:${ID_A}`, "first"],
        [`urn:li:activity:${ID_B}`, "b"],
      ],
    );
  });

  it("stops after 3 dry wheel rounds and logs the dry counter", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const wheel = { calls: 0 };

    const posts = await fetchLinkedInSurface(
      fakeContext({ initialBody: cardBody(ID_A, "a"), wheel }),
      linkedinSurface("linkedin/#hiring"),
      8,
    );

    assert.equal(posts.length, 1);
    assert.equal(wheel.calls, 3); // the dry counter stops the walk, not the ceiling
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /\(dry 3\/3\)/.test(line)));
  });

  it("bounds the walk with scrollRounds while every round still gains", async () => {
    const wheel = { calls: 0 };
    const gaining = (a: string, b: string): string => [cardBody(a, a), cardBody(b, b)].join("\n");

    const posts = await fetchLinkedInSurface(
      fakeContext({
        initialBody: cardBody(ID_A, "a"),
        wheelBodies: [
          gaining("7522130389847670784", "7522130389847670785"),
          gaining("7522130389847670786", "7522130389847670787"),
          gaining("7522130389847670788", "7522130389847670789"),
        ],
        wheel,
      }),
      linkedinSurface("linkedin/#hiring"),
      2,
    );

    assert.equal(posts.length, 5); // 1 initial + 2 rounds x 2 posts
    assert.equal(wheel.calls, 2); // the ceiling stops the walk, not dry rounds
  });

  it("breaks on the post cap after one wheel round", async () => {
    const wheel = { calls: 0 };
    const ids = Array.from({ length: 150 }, (_, i) =>
      (7500000000000000000n + BigInt(i)).toString(),
    );
    const body = ids.map((id) => cardBody(id, `post ${id}`)).join("\n");

    const posts = await fetchLinkedInSurface(
      fakeContext({ initialBody: body, wheel, wheelBodies: [cardBody(ID_A, "late")] }),
      linkedinSurface("linkedin/#hiring"),
      8,
    );

    assert.equal(posts.length, 150);
    assert.equal(wheel.calls, 1); // the cap break fires after round 1's dry log
    assert.ok(posts.every((post) => post.id !== `urn:li:activity:${ID_A}`));
  });

  it("throws when no flagship-web response arrives inside the window", async () => {
    await assert.rejects(
      () => fetchLinkedInSurface(fakeContext({}), linkedinSurface("linkedin/#hiring"), 8),
      /no flagship-web response within 30000ms/,
    );
  });

  it("throws when the page exposes no wheel", async () => {
    await assert.rejects(
      () =>
        fetchLinkedInSurface(
          fakeContext({ initialBody: cardBody(ID_A, "a"), noWheel: true }),
          linkedinSurface("linkedin/#hiring"),
          8,
        ),
      /page exposes no wheel/,
    );
  });

  it("propagates a goto failure as a thrown error", async () => {
    await assert.rejects(
      () =>
        fetchLinkedInSurface(
          fakeContext({ gotoError: new Error("navigation failed") }),
          linkedinSurface("linkedin/#hiring"),
          8,
        ),
      /navigation failed/,
    );
  });
});
