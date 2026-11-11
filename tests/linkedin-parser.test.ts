/**
 * Offline suite for the LinkedIn Flight parser core (slice 2): the
 * restored 68c1e2d collectLinkedInPosts/parseFlightRows cases re-based
 * on the timestamp-zip pairing rule (design 2026-11-11), plus the
 * pairing, hashtag-chip, timestamp-guard, oracle-log, and payload
 * round-trip cases the restored suite never carried.
 *
 * FIXTURE PROVENANCE: every Flight body is a synthetic literal built in
 * the captured field layout — commentary_text view marker,
 * textProps.children React element trees, activityUrn.activityId ids,
 * "$<row>" / "$<row>:path" references (evidence: the deleted walk's
 * suite at 68c1e2d and the 2026-11-10 live capture,
 * .rpiv/tmp/linkedin-pagination-body.txt). The capture-shaped body
 * mints ids with the (BigInt(epochMs) << 22n) forward trick (the
 * tests/index.test.ts idiom) from the live capture's pinned epochs, so
 * BigInt(id) >> 22n recovers them exactly; no real member data rides in
 * this file. Importing the module under test never loads Playwright.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  LINKEDIN_RESPONSE_RE,
  buildContentSearchUrl,
  collectLinkedInPosts,
  parseFlightRows,
} from "../src/linkedin-parser.js";
import { readPayloadPosts, writePayloadAtomic } from "../src/linkedin-payload.js";
import type { Post } from "../src/types.js";

/** Capture-verified ids (the deleted walk's suite, research 2026-10-31): BigInt(id) >> 22n pins both epochs. */
const ID_A = "7522028760582447104"; // 2026-10-30T20:16:49.059Z
const ID_B = "7522121950970900481"; // 2026-10-31T02:27:07.379Z

/** The 2026-11-10 live capture's three pinned epochs (design Key Discoveries). */
const FULL_STACK_MS = Date.UTC(2026, 10, 10, 22, 11, 39, 858);
const CHEF_MS = Date.UTC(2026, 10, 10, 22, 16, 28, 628);
const PCB_MS = Date.UTC(2026, 10, 10, 22, 18, 16, 583);

/** Mint one capture-shaped id: the forward trick, the exact inverse of BigInt(id) >> 22n. */
const idFor = (ms: number): string => (BigInt(ms) << 22n).toString();

/** The capture's three posts, text-first, in stream (= page) order. */
const FULL_STACK_TEXT =
  "Full-Stack Developer (Remote) — Indonesian product team, React + Node. DM for the JD.";
const CHEF_TEXT = "Chef needed for a new restaurant in Bandung. Send your CV and expected salary.";
const PCB_TEXT =
  "PCB layout engineer at a Jakarta hardware startup. 3+ years of Altium experience.";

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

/**
 * One card carrying the real text AND the short "#hiring" chip as
 * sibling commentary_text components in the SAME row (capture row 34,
 * 2026-11-11: 1923-char post + 7-char chip, identical specs except the
 * chip's interactionTypes is a $-ref). The row's LONGEST text must win.
 */
const chipCardBody = (id: string, text: string, chip: string): string => {
  const n = (cardSeq += 1) * 10;
  const marker = (innerText: string): unknown => [
    "$",
    "$Lmark",
    null,
    {
      viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
      children: ["$", "$Ldiv", null, { textProps: { children: [innerText] } }],
    },
  ];
  return [
    row(String(n), { tracking: { activityUrn: { activityId: id } } }),
    row(String(n + 1), [marker(text), marker(chip)]),
  ].join("\n");
};

/** One captured card, trimmed: strong/br elements, a plain string, and a
 * "$3:textProps:children" shared-subtree path reference in the text. */
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
 * The capture-shaped body (design Decision "Pairing"): three distinct
 * texts in stream order (Full-Stack, Chef, PCB) and three ids whose
 * FIRST-APPEARANCE order is NOT time order (the latest id rides the
 * first card — the capture's "row 0 emits B before A" fact), so a
 * first-appearance zip mispairs all three and the timestamp zip must
 * pair 3/3.
 */
const captureBody = (): string =>
  [
    '0:I["$1",[],"default"]', // module-manifest row — skipped
    "not-a-flight-line", // garbage — skipped
    cardBody(idFor(PCB_MS), FULL_STACK_TEXT),
    cardBody(idFor(FULL_STACK_MS), CHEF_TEXT),
    cardBody(idFor(CHEF_MS), PCB_TEXT),
  ].join("\n");

describe("buildContentSearchUrl", () => {
  it("reproduces the 2026-11-11 live search URL byte-for-byte (origin, date_posted sort, past-24h)", () => {
    assert.equal(
      buildContentSearchUrl("hiring indonesia"),
      "https://www.linkedin.com/search/results/content/?keywords=hiring%20indonesia&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D",
    );
  });

  it("encodes a # keyword at the query layer — a raw # would truncate the GET query (§12.5 carry-over)", () => {
    assert.equal(
      buildContentSearchUrl("#hiring react"),
      "https://www.linkedin.com/search/results/content/?keywords=%23hiring%20react&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D",
    );
  });
});

describe("LINKEDIN_RESPONSE_RE", () => {
  it("matches the initial content-search response URL", () => {
    assert.ok(
      LINKEDIN_RESPONSE_RE.test(
        "https://www.linkedin.com/flagship-web/search/results/content/?keywords=x",
      ),
    );
  });

  it("matches the Load-more pagination action response URL", () => {
    assert.ok(
      LINKEDIN_RESPONSE_RE.test(
        "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination",
      ),
    );
  });

  it("rejects unrelated responses — the walk's body filter must never fire on a Threads response", () => {
    assert.equal(LINKEDIN_RESPONSE_RE.test("https://www.threads.com/api/graphql"), false);
    assert.equal(
      LINKEDIN_RESPONSE_RE.test("https://www.linkedin.com/voyager/api/search/blended"),
      false,
    );
  });
});

describe("parseFlightRows", () => {
  it("parses data rows in stream order and skips module-manifest rows and garbage lines", () => {
    const rows = parseFlightRows(
      ['0:I["$1",[],"default"]', row("1", { a: 1 }), row("2", [1, 2])].join("\n"),
    );
    assert.deepEqual([...rows.keys()], ["1", "2"]);
    assert.deepEqual(rows.get("1"), { a: 1 });
  });
});

describe("collectLinkedInPosts", () => {
  it("mints the restored capture-verified card: path-ref text, br newline, urn id, id-derived timestamp", () => {
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

  it("pairs capture-shaped texts (stream order) with ids (time order) 3/3 — not first-appearance order", () => {
    const posts = collectLinkedInPosts(captureBody());
    assert.deepEqual(
      posts.map((post) => [post.text, post.timestamp]),
      [
        [FULL_STACK_TEXT, new Date(FULL_STACK_MS).toISOString()],
        [CHEF_TEXT, new Date(CHEF_MS).toISOString()],
        [PCB_TEXT, new Date(PCB_MS).toISOString()],
      ],
    );
  });

  it("keeps the sibling hashtag chip out of the mint (the row's longest commentary text wins)", () => {
    const posts = collectLinkedInPosts(chipCardBody(ID_A, CHEF_TEXT, "#hiring"));
    assert.equal(posts.length, 1);
    assert.equal((posts[0] as Post).text, CHEF_TEXT);
    assert.ok(posts.every((post) => post.text !== "#hiring"));
  });

  it("dedupes a repeated activity id, keeps the first mint, and warns the 2-text/1-id mismatch", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const body = [cardBody(ID_A, "first"), cardBody(ID_A, "second")].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(
      posts.map((post) => [post.id, post.text]),
      [[`urn:li:activity:${ID_A}`, "first"]],
    );
    assert.match(
      String(warns.mock.calls[0]?.arguments[0] ?? ""),
      /id\/text count mismatch \(2 text\(s\), 1 id\(s\)\)/,
    );
  });

  it("pairs the prefix when ids outnumber texts (1 text, 2 ids) and warns", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const body = [
      cardBody(ID_A, "only text"),
      row("9", { tracking: { activityUrn: { activityId: ID_B } } }),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${ID_A}`],
    );
    assert.match(
      String(warns.mock.calls[0]?.arguments[0] ?? ""),
      /id\/text count mismatch \(1 text\(s\), 2 id\(s\)\)/,
    );
  });

  it("drops an id the timestamp guard rejects (leading zeros mint a non-positive epoch) and warns", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const posts = collectLinkedInPosts(cardBody("0000000001", "text without a usable id"));
    assert.deepEqual(posts, []);
    assert.match(String(warns.mock.calls[0]?.arguments[0] ?? ""), /\(1 text\(s\), 0 id\(s\)\)/);
  });

  it("drops a commentary marker whose text harvest is empty (br-only children) and warns", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
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
    assert.deepEqual(collectLinkedInPosts(body), []);
    assert.match(String(warns.mock.calls[0]?.arguments[0] ?? ""), /\(0 text\(s\), 1 id\(s\)\)/);
  });

  it("skips module-manifest rows and garbage lines around the data rows", () => {
    const body = ['0:I["$1",[],"default"]', "not-a-flight-line", richCardBody()].join("\n");
    assert.equal(collectLinkedInPosts(body).length, 1);
  });

  it("collapses 3+ newlines to one paragraph break in minted text", () => {
    const posts = collectLinkedInPosts(cardBody(ID_A, "a\n\n\n\nb"));
    assert.equal((posts[0] as Post).text, "a\n\nb");
  });

  it("logs one pairing-oracle line per call naming each minted id ↔ text head", (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = collectLinkedInPosts(captureBody());
    assert.equal(posts.length, 3);
    assert.equal(logs.mock.callCount(), 1);
    const line = String(logs.mock.calls[0]?.arguments[0] ?? "");
    assert.match(line, /^linkedin-parser: 3 pair\(s\) — /);
    assert.ok(line.includes(`↔"${FULL_STACK_TEXT.slice(0, 25)}"`));
    assert.ok(line.includes(`↔"${PCB_TEXT.slice(0, 25)}"`));
  });
});

describe("payload round-trip", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("writePayloadAtomic → readPayloadPosts keeps minted posts whole (leg ok, zero drops)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-parser-"));
    const path = join(dir, "linkedin-posts.json");
    const NOW = Date.UTC(2026, 10, 11, 8, 0, 0);
    const minted = collectLinkedInPosts(captureBody());
    await writePayloadAtomic(minted, path, () => NOW);
    const read = await readPayloadPosts(path, () => NOW + 60_000);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, minted);
    assert.equal(warns.mock.callCount(), 0); // a dropped row would warn "malformed row(s)"
  });
});
