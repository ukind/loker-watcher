/**
 * Offline suite for the LinkedIn Flight parser core (the card join,
 * design 2026-11-14, amended: $L-strict graph edges, seeds-only climb,
 * closure text harvest): split-card climbs through interactionTypes-style
 * $-refs, share/ugcPost permalink types, the drop-and-count classes,
 * stream-order mints, and the one req-9 log line. Synthetic bodies carry
 * the join the way the live stream does — the marker row $-refs the id
 * row, and id rows carry urn STRINGS (scan9's measured form; the deleted
 * digit-field rule fed only the zip). Capture-fixture-driven cases land
 * with tests/fixture/ (Slice 2); ids mint with the (BigInt(ms) << 22n)
 * forward trick so BigInt(id) >> 22n recovers the pinned epochs exactly.
 * Importing the module under test never loads Playwright.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildContentSearchUrl,
  type CardJoin,
  collectLinkedInPosts,
  joinCards,
  LINKEDIN_RESPONSE_RE,
  parseFlightRows,
} from "../src/linkedin-parser.js";
import { readPayloadPosts, writePayloadAtomic } from "../src/linkedin-payload.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Capture-verified ids: BigInt(ms) << 22n — the forward trick (the exact clock inverse). */
const BASE_MS = Date.UTC(2026, 11, 13, 4, 0, 0);
const idAt = (n: number): string => (BigInt(BASE_MS + n * 60_000) << 22n).toString();

/** The share/ugcPost id is a DIFFERENT number from the activity id (research 2026-10-31). */
const shareFor = (activityId: string): string => (BigInt(activityId) - 1n).toString();

/** One flight line. */
const row = (hex: string, payload: unknown): string => `${hex}:${JSON.stringify(payload)}`;

const markerEl = (children: unknown[], extra: Record<string, unknown> = {}): unknown => [
  "$",
  "$Lmark",
  null,
  {
    viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
    children: ["$", "$Ldiv", null, { textProps: { children } }],
    ...extra,
  },
];

/** The id row carries the urn STRING — the join reads strings, never digit fields. */
const idRow = (activityId: string): unknown => ({
  tracking: { activityUrn: { urn: `urn:li:activity:${activityId}` } },
});

const idRowWithShare = (activityId: string): unknown => ({
  tracking: {
    activityUrn: { urn: `urn:li:activity:${activityId}` },
    shareUrn: `urn:li:share:${shareFor(activityId)}`,
  },
});

/**
 * The live split-card shape: the id row precedes the marker row, whose
 * interactionTypes $-refs it (JOIN_BODY, capture-verified).
 */
const joinCardBody = (firstHex: number, activityId: string, text: string): string =>
  [
    row(String(firstHex), idRow(activityId)),
    row(String(firstHex + 1), {
      commentary: markerEl([text], { interactionTypes: `$${firstHex}` }),
    }),
  ].join("\n");

describe("buildContentSearchUrl", () => {
  it("reproduces the 2026-11-11 live search URL byte-for-byte (origin, date_posted sort, past-24h)", () => {
    assert.equal(
      buildContentSearchUrl("hiring indonesia"),
      "https://www.linkedin.com/search/results/content/?keywords=hiring%20indonesia&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D",
    );
  });

  it("encodes a # keyword at the query layer — a raw # would truncate the GET query", () => {
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

describe("joinCards", () => {
  it("joins a split card: the marker row is the root (the id row's span holds zero markers) and forward refs decide the urns", () => {
    const cards = joinCards(joinCardBody(10, idAt(1), "first posting — Jakarta"));
    assert.equal(cards.length, 1);
    const card = cards[0] as CardJoin;
    assert.equal(card.marker, "11");
    assert.equal(card.root, "11");
    assert.equal(card.outcome, "linked");
    assert.equal(card.activityId, idAt(1));
    assert.deepEqual(card.urns, [`urn:li:activity:${idAt(1)}`]);
    assert.equal(card.linkUrn, `urn:li:activity:${idAt(1)}`);
  });

  it("keeps the permalink the card's own share urn (FRD req 5 — the type resolves, the activity urn does not)", () => {
    const body = [
      row("1", idRowWithShare(idAt(2))),
      row("2", { commentary: markerEl(["second posting — Bandung"], { interactionTypes: "$1" }) }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.linkUrn, `urn:li:share:${shareFor(idAt(2))}`);
    assert.equal(cards[0]?.activityId, idAt(2));
  });

  it("collects a urn embedded inside a longer string (the unanchored collection form, scan9-measured)", () => {
    const body = [
      row("1", {
        tracking: {
          activityUrn: { urn: `urn:li:activity:${idAt(3)}` },
          clickUrl: `https://www.linkedin.com/feed/update/urn:li:share:${shareFor(idAt(3))}/`,
        },
      }),
      row("2", { commentary: markerEl(["third — embedded"], { interactionTypes: "$1" }) }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.linkUrn, `urn:li:share:${shareFor(idAt(3))}`);
    assert.deepEqual(cards[0]?.urns, [
      `urn:li:activity:${idAt(3)}`,
      `urn:li:share:${shareFor(idAt(3))}`,
    ]);
  });

  it("climbs past the card's own nested marker to the one-seed container and harvests the closure's longest text (005 image-card shape)", () => {
    const body = [
      row("1", idRowWithShare(idAt(4))),
      row("2", idRow(idAt(4))),
      row("5", { card: { body: "$L10", share: "$L1", tracking: "$L2" } }),
      row("10", {
        commentary: markerEl([], { interactionTypes: "$L11" }),
      }),
      row("11", { commentary: markerEl(["https://lnkd.in/gcrX7sNZ"]) }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    const card = cards[0] as CardJoin;
    assert.equal(card.marker, "10"); // the seed — 11 is nested (10 refs it)
    assert.equal(card.root, "5"); // the climb lands on the one-seed container
    assert.equal(card.outcome, "linked");
    assert.equal(card.activityId, idAt(4));
    assert.equal(card.linkUrn, `urn:li:share:${shareFor(idAt(4))}`);
    assert.equal(card.text, "https://lnkd.in/gcrX7sNZ"); // the nested row's text
  });

  it("never merges two sibling seeds sharing one container — each card mints its own id", () => {
    const body = [
      row("1", idRow(idAt(7))),
      row("2", idRow(idAt(8))),
      row("5", { feed: ["$10", "$20"] }),
      row("10", { commentary: markerEl(["first sibling"], { id: "$1" }) }),
      row("20", { commentary: markerEl(["second sibling"], { id: "$2" }) }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 2);
    assert.deepEqual(
      cards.map((card) => card.activityId),
      [idAt(7), idAt(8)],
    );
    assert.deepEqual(
      cards.map((card) => card.root),
      ["10", "20"], // the climb never enters 5 — its span holds two seeds
    );
  });

  it("a bare hex-ish data string is never a graph reference — a phantom edge cannot nest-kill a seed or pollute its urns", () => {
    const body = [
      row("1", idRow(idAt(5))),
      row("24", idRow(idAt(6))), // the would-be phantom target: a FOREIGN id row
      row("5", { card: "$L10", share: "$L1" }),
      row("10", {
        commentary: markerEl(["real post — phantom bait"], { bait: "24" }),
      }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    const card = cards[0] as CardJoin;
    assert.equal(card.marker, "10");
    assert.equal(card.root, "5");
    assert.equal(card.outcome, "linked");
    assert.equal(card.activityId, idAt(5)); // never idAt(6) — row 24 is unreachable
    assert.deepEqual(card.urns, [`urn:li:activity:${idAt(5)}`]);
  });

  it("keeps a chip row ONE card with the row's longest commentary text", () => {
    const body = [
      row("10", idRow(idAt(5))),
      row("11", {
        commentary: [
          markerEl(["third posting, long form — Surabaya"], { interactionTypes: "$10" }),
          markerEl(["#hiring"]),
        ],
      }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.text, "third posting, long form — Surabaya");
    assert.equal(cards[0]?.outcome, "linked");
  });

  it("drops and classifies every edge card: no-urn, multi-urn, dead-id, no-text (FRD reqs 6/7)", () => {
    const body = [
      joinCardBody(10, idAt(6), "ok card"),
      row("20", { commentary: markerEl(["no urn anywhere"]) }),
      row("30", { commentary: markerEl(["two urns"], { a: "$31", b: "$32" }) }),
      row("31", idRow(idAt(7))),
      row("32", idRow(idAt(8))),
      row("40", idRow("0000000001")),
      row("41", { commentary: markerEl(["bad clock"], { interactionTypes: "$40" }) }),
      row("50", { commentary: markerEl([["$", "br", "0", {}]]) }),
    ].join("\n");
    assert.deepEqual(
      joinCards(body).map((card) => card.outcome),
      ["linked", "no-urn", "multi-urn", "dead-id", "no-text"],
    );
  });
});

describe("collectLinkedInPosts", () => {
  it("mints in marker-row stream order, not clock order (FRD req 8 — no sort), with id-derived timestamps", () => {
    const later = idAt(9);
    const earlier = idAt(8);
    const body = [
      [
        row("10", idRowWithShare(later)),
        row("11", { commentary: markerEl(["stream-first"], { interactionTypes: "$10" }) }),
      ].join("\n"),
      joinCardBody(20, earlier, "stream-second"),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(posts, [
      {
        platform: "linkedin",
        id: `urn:li:activity:${later}`,
        text: "stream-first",
        author: "linkedin-member",
        permalink: `https://www.linkedin.com/feed/update/urn:li:share:${shareFor(later)}`,
        timestamp: new Date(BASE_MS + 9 * 60_000).toISOString(),
      },
      {
        platform: "linkedin",
        id: `urn:li:activity:${earlier}`,
        text: "stream-second",
        author: "linkedin-member",
        permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${earlier}`,
        timestamp: new Date(BASE_MS + 8 * 60_000).toISOString(),
      },
    ]);
  });

  it("counts drops on the ONE req-9 log line, naming each minted id tail and text head", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const body = [
      joinCardBody(10, idAt(6), "ok card"),
      row("20", { commentary: markerEl(["no urn anywhere"]) }),
      row("30", { commentary: markerEl(["two urns"], { a: "$31", b: "$32" }) }),
      row("31", idRow(idAt(7))),
      row("32", idRow(idAt(8))),
      row("40", idRow("0000000001")),
      row("41", { commentary: markerEl(["bad clock"], { interactionTypes: "$40" }) }),
      row("50", { commentary: markerEl([["$", "br", "0", {}]]) }),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.equal(posts.length, 1);
    assert.equal(logs.mock.callCount(), 1);
    const line = String(logs.mock.calls[0]?.arguments[0] ?? "");
    assert.match(
      line,
      /^linkedin-parser: 1 card\(s\) linked, 4 dropped \(1 no-urn, 1 multi-urn, 1 dead-id, 1 no-text\) — /,
    );
    assert.ok(line.includes(`${idAt(6).slice(-6)}↔"ok card"`), line);
  });

  it("mints two cards sharing one text — the global text dedupe is gone (fetch dedupes by urn)", () => {
    const body = [
      joinCardBody(10, idAt(10), "same words"),
      joinCardBody(20, idAt(11), "same words"),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.equal(posts.length, 2);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(10)}`, `urn:li:activity:${idAt(11)}`],
    );
  });

  it("skips module-manifest rows and garbage lines around the cards", () => {
    const body = [
      '0:I["$1",[],"default"]',
      "not-a-flight-line",
      joinCardBody(10, idAt(12), "clean card"),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.text, "clean card");
  });

  it("logs the 0/0 line on a body with no marker rows", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = collectLinkedInPosts(row("1", { unrelated: true }));
    assert.deepEqual(posts, []);
    assert.equal(logs.mock.callCount(), 1);
    assert.match(
      String(logs.mock.calls[0]?.arguments[0] ?? ""),
      /^linkedin-parser: 0 card\(s\) linked, 0 dropped \(0 no-urn, 0 multi-urn, 0 dead-id, 0 no-text\)/,
    );
  });
});

describe("payload round-trip", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("a share-typed permalink passes payload admission (leg ok, zero drops)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-parser-"));
    const path = join(dir, "linkedin-posts.json");
    const NOW = Date.UTC(2026, 11, 13, 8, 0, 0);
    const body = [
      row("1", idRowWithShare(idAt(13))),
      row("2", { commentary: markerEl(["share-typed round trip"], { interactionTypes: "$1" }) }),
    ].join("\n");
    const minted = collectLinkedInPosts(body);
    assert.equal(minted.length, 1);
    await writePayloadAtomic(minted, path, () => NOW);
    const read = await readPayloadPosts(path, () => NOW + 60_000);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, minted);
    assert.equal(warns.mock.callCount(), 0);
  });
});

describe("capture fixtures (real-trimmed, session 20261114T055257Z)", () => {
  const loadFixture = (name: string): string => readFileSync(join(here, "fixture", name), "utf8");

  it("multicard body: two cards mint their own ids in marker stream order (no global consolidation)", () => {
    const posts = collectLinkedInPosts(loadFixture("linkedin-multicard-body.txt"));
    assert.equal(posts.length, 2);
    assert.deepEqual(
      posts.map((post) => post.id),
      ["urn:li:activity:7527236651333419008", "urn:li:activity:7527242172845154304"],
    );
    assert.match(posts[0]?.text ?? "", /^Hiring at volume\? Our RPO model/);
    assert.match(posts[1]?.text ?? "", /^HIRING: Car-Mounted 360°/);
  });

  it("multicard body: the ONE req-9 log line names both minted id tails", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    collectLinkedInPosts(loadFixture("linkedin-multicard-body.txt"));
    assert.equal(logs.mock.callCount(), 1);
    const line = String(logs.mock.calls[0]?.arguments[0] ?? "");
    assert.match(
      line,
      /^linkedin-parser: 2 card\(s\) linked, 0 dropped \(0 no-urn, 0 multi-urn, 0 dead-id, 0 no-text\)/,
    );
    assert.ok(line.includes('419008↔"Hiring at volume? Our RPO"'), line);
    assert.ok(line.includes('154304↔"HIRING: Car-Mounted 360° "'), line);
  });

  it("share card: the permalink keeps the card's own share urn (FR5) while the id stays the activity urn (FR4)", () => {
    const posts = collectLinkedInPosts(loadFixture("linkedin-share-card-body.txt"));
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.id, "urn:li:activity:7527236651333419008");
    assert.equal(
      posts[0]?.permalink,
      "https://www.linkedin.com/feed/update/urn:li:share:7527236650461134849",
    );
    assert.equal(
      posts[0]?.timestamp,
      new Date(Number(BigInt("7527236651333419008") >> 22n)).toISOString(),
    );
  });

  it("share card, 0-urn mutation: the card drops and counts (FR6)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const body = loadFixture("linkedin-share-card-body.txt").replaceAll("urn:li:", "urn:xx:");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(posts, []);
    const line = String(logs.mock.calls[0]?.arguments[0] ?? "");
    assert.match(
      line,
      /^linkedin-parser: 0 card\(s\) linked, 1 dropped \(1 no-urn, 0 multi-urn, 0 dead-id, 0 no-text\)/,
    );
  });

  it("image card: the seed's own harvest is empty — the text rides the nested marker (closure harvest); the climb passes it (seeds-only span)", () => {
    const posts = collectLinkedInPosts(loadFixture("linkedin-joinref-card-body.txt"));
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.text, "https://lnkd.in/gcrX7sNZ");
    assert.equal(posts[0]?.id, "urn:li:activity:7527241854124249088");
    assert.equal(
      posts[0]?.permalink,
      "https://www.linkedin.com/feed/update/urn:li:share:7527126866378375168",
    );
  });
});
