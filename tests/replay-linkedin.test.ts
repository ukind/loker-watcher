/**
 * Offline suite for scripts/replay-linkedin.ts (Slice 3, the replay
 * harness): the entry-guard import pin, the zero-argv gate, the
 * envelope gates, and the analysis pins — per-row census lines, the
 * zip-paired/zip-unlinked dispositions, the junk causes (CTA shape vs
 * $-ref shrink), the six-point probe arms, and the verdict — against
 * synthetic captures built from the parser fixture shapes
 * (tests/linkedin-parser.test.ts). Cross-check: this suite pins the
 * replay's tallies to collectLinkedInPosts on the same bodies, so the
 * instrumented walk cannot drift from the frozen parser. Files live in
 * OS temp only (mkdtemp + one after) — the repo tree is never touched.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, after, describe, it } from "node:test";
import {
  type BodyAnalysis,
  REPLAY_NO_INPUT,
  isReplayNoInput,
  runReplay,
} from "../scripts/replay-linkedin.js";
import { CAPTURE_SCHEMA_VERSION, type CaptureRecord } from "../src/linkedin-capture.js";
import { collectLinkedInPosts } from "../src/linkedin-parser.js";

const NOW = Date.UTC(2026, 11, 13, 5, 0, 0);

/** Capture-shaped ids: BigInt(epochMs) << 22n — the parser fixtures' forward trick. */
const BASE_MS = Date.UTC(2026, 11, 13, 4, 0, 0);
const idAt = (n: number): string => (BigInt(BASE_MS + n * 60_000) << 22n).toString();

/** One flight line. */
const row = (id: string, payload: unknown): string => `${id}:${JSON.stringify(payload)}`;

/** The commentary_text marker element (the parser fixture's shape). */
const marker = (children: unknown[]): unknown => [
  "$",
  "$Lmark",
  null,
  {
    viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
    children: ["$", "$Ldiv", null, { textProps: { children } }],
  },
];

/** The bare id row (tracking.activityUrn.activityId). */
const idRow = (id: string): unknown => ({ tracking: { activityUrn: { activityId: id } } });

/** A card the way the real stream splits it: the id row, then the marker row. */
const splitCard = (n: number, id: string, text: string): string =>
  [row(String(n), idRow(id)), row(String(n + 1), marker([text]))].join("\n");

/** A card merged into ONE root row — ids=1 texts=1, the BOTH shape. */
const mergedCard = (n: number, id: string, text: string): string =>
  row(String(n), { tracking: { activityUrn: { activityId: id } }, commentary: marker([text]) });

/**
 * The mixed census body: manifest + garbage (skipped), a merged BOTH
 * card, a split card (ids-only row + texts-only row), a chip BOTH row
 * (textCount 2 — the longest text wins), and a bare id row.
 */
const MIXED_BODY = [
  '0:I["$1",[],"default"]',
  "not-a-flight-line",
  mergedCard(10, idAt(1), "first posting — Jakarta"),
  splitCard(20, idAt(2), "second posting — Bandung"),
  row("30", {
    tracking: { activityUrn: { activityId: idAt(3) } },
    commentary: [marker(["third posting, long form — Surabaya"]), marker(["#hiring"])],
  }),
  row("40", idRow(idAt(4))),
].join("\n");

/** A marker row whose subtree $-refs an id row OUTSIDE the text (the chip's interactionTypes class). */
const JOIN_BODY = [
  row("1", {
    commentary: [
      "$",
      "$Lmark",
      null,
      {
        viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
        children: ["$", "$Ldiv", null, { textProps: { children: ["join target text"] } }],
        interactionTypes: "$2",
      },
    ],
  }),
  row("2", idRow(idAt(9))),
].join("\n");

/** One row whose text survives beside a dropped path-ref; one row whose ONLY content is a dead path-ref. */
const SHRINK_BODY = [
  row("1", { commentary: marker(["kept words — ", "$9:textProps:children"]) }),
  row("2", { commentary: marker(["$8:textProps:children"]) }),
].join("\n");

/** A BOTH row whose harvested text is a bare URL — the census prior's CTA junk shape. */
const CTA_BODY = mergedCard(10, idAt(6), "https://example.com/jobs");

/** A commentary marker beside a non-commentary viewTrackingSpecs shape — the taxonomy pair. */
const TAX_BODY = [
  row("1", {
    commentary: marker(["text one"]),
    singular: [
      "$",
      "$Ls",
      null,
      { viewTrackingSpecs: { viewName: "feed-singular", legacyControlName: "singular_component" } },
    ],
  }),
  row("2", idRow(idAt(5))),
].join("\n");

/** Two rows share one contentTrackingId value; a third carries its own. */
const TRACK_BODY = [
  row("1", { contentTrackingId: "t1", commentary: marker(["one"]) }),
  row("2", { contentTrackingId: "t1", tracking: { activityUrn: { activityId: idAt(7) } } }),
  row("3", { contentTrackingId: "t2" }),
].join("\n");

/** Every row carries the SAME contentTrackingId value — the list-level shape. */
const LIST_BODY = [
  row("1", { contentTrackingId: "t1", commentary: marker(["one"]) }),
  row("2", { contentTrackingId: "t1" }),
].join("\n");

const capture = (body: string, overrides: Partial<CaptureRecord> = {}): CaptureRecord => ({
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  capturedAt: new Date(NOW).toISOString(),
  label: "linkedin/#hiring indonesia",
  ordinal: 7,
  received: 2,
  url: "https://www.linkedin.com/flagship-web/search/results/content/?keywords=%23hiring",
  status: 200,
  matched: true,
  body,
  ...overrides,
});

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

let seq = 0;

/** Write one synthetic capture to OS temp and replay it; returns the analysis. */
async function replayBody(
  body: string,
  overrides: Partial<CaptureRecord> = {},
): Promise<BodyAnalysis> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
  seq += 1;
  const path = join(dir, `capture-${seq}.json`);
  await writeFile(path, `${JSON.stringify(capture(body, overrides))}\n`, "utf8");
  const { reports } = await runReplay({ argv: [path] });
  const first = reports[0];
  assert.ok(first);
  return first;
}

/** Replay one body under a call-through log spy; returns the stable-prefix lines only. */
async function replayLines(
  t: TestContext,
  body: string,
  overrides: Partial<CaptureRecord> = {},
): Promise<string[]> {
  const logs = t.mock.method(console, "log", console.log.bind(console));
  await replayBody(body, overrides);
  return logs.mock.calls
    .map((call) => String(call.arguments[0]))
    .filter((line) => line.startsWith("replay:"));
}

describe("entry guard", () => {
  it("importing the module stays side-effect free (no reads, no replay)", () => {
    assert.equal(typeof runReplay, "function");
  });
});

describe("runReplay gates", () => {
  it("throws the tagged zero-argv gate carrying the usage line", async () => {
    await assert.rejects(
      () => runReplay({ argv: [] }),
      (error: unknown) => {
        assert.equal(isReplayNoInput(error), true);
        assert.equal((error as { name?: unknown }).name, REPLAY_NO_INPUT);
        assert.match(
          (error as Error).message,
          /^replay: usage — npx tsx scripts\/replay-linkedin\.ts/,
        );
        return true;
      },
    );
  });

  it("rejects an unreadable path with the raw fs error (the wrapper wraps it as FAILED)", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
    const path = join(dir, "absent.json");
    await assert.rejects(() => runReplay({ argv: [path] }), /ENOENT/);
  });

  it("rejects a JSON file that is not a CaptureRecord envelope, naming the path", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
    const path = join(dir, "not-a-record.json");
    await writeFile(path, '{"hello": 1}\n', "utf8");
    await assert.rejects(() => runReplay({ argv: [path] }), /not a CaptureRecord envelope/);
  });

  it("rejects an unsupported capture schemaVersion, naming both versions", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
    const path = join(dir, "old-schema.json");
    const stale = { ...capture("1:skipped"), schemaVersion: 99 };
    await writeFile(path, `${JSON.stringify(stale)}\n`, "utf8");
    await assert.rejects(
      () => runReplay({ argv: [path] }),
      /capture schemaVersion 99, this replay reads version 1/,
    );
  });
});

describe("per-row census", () => {
  it("prints the mixed-body census: BOTH/IDS-ONLY/TEXTS-ONLY rows, zip dispositions, verdict", async (t) => {
    const lines = await replayLines(t, MIXED_BODY);
    assert.deepEqual(lines, [
      "replay: body 7 — 5 root row(s), 3 distinct text(s), 4 distinct id(s)",
      `replay: row 10 — ids=1 texts=1 — BOTH (zip-paired ↔ ${idAt(1).slice(-6)})`,
      "replay: row 20 — ids=1 texts=0 — IDS-ONLY (no text harvest)",
      `replay: row 21 — ids=0 texts=1 — TEXTS-ONLY (zip-paired ↔ ${idAt(2).slice(-6)})`,
      `replay: row 30 — ids=1 texts=2 — BOTH (zip-paired ↔ ${idAt(3).slice(-6)})`,
      "replay: row 40 — ids=1 texts=0 — IDS-ONLY (no text harvest)",
      "replay: probe — forwardBFS from 3 marker row(s): 0 id row(s) reached; reverse from 4 id row(s): 0 marker row(s) reached",
      "replay: tracking — no contentTrackingId found",
      "replay: adjacency — marker→id distance within 1: 3, at 2: 0, further: 0",
      "replay: markers — feed-commentary/commentary_text: 4",
      "replay: verdict — no card-scoped join found; 2/5 row(s) skipped ids-only",
    ]);
  });

  it("names the zip-unlinked disposition and the $-ref shrink cause; an empty harvest reads as text lost", async (t) => {
    const lines = await replayLines(t, SHRINK_BODY);
    assert.deepEqual(lines, [
      "replay: body 7 — 2 root row(s), 1 distinct text(s), 0 distinct id(s)",
      "replay: row 1 — ids=0 texts=1 — TEXTS-ONLY (zip-unlinked) — text shrink-suspect (1 dropped $-ref(s))",
      "replay: row 2 — ids=0 texts=0 — EMPTY (empty row) — text lost (shrink: 1 dropped $-ref(s))",
      "replay: probe — forwardBFS from 2 marker row(s): 0 id row(s) reached; reverse from 0 id row(s): 0 marker row(s) reached",
      "replay: tracking — no contentTrackingId found",
      "replay: adjacency — marker→id distance within 1: 0, at 2: 0, further: 2",
      "replay: markers — feed-commentary/commentary_text: 2",
      "replay: verdict — no card-scoped join found; 0/2 row(s) skipped ids-only",
    ]);
  });

  it("names the CTA shape on a BOTH row whose text is a bare URL", async (t) => {
    const lines = await replayLines(t, CTA_BODY);
    assert.deepEqual(lines, [
      "replay: body 7 — 1 root row(s), 1 distinct text(s), 1 distinct id(s)",
      `replay: row 10 — ids=1 texts=1 — BOTH (zip-paired ↔ ${idAt(6).slice(-6)}) — text cta-suspect (bare URL)`,
      "replay: probe — forwardBFS from 1 marker row(s): 0 id row(s) reached; reverse from 1 id row(s): 0 marker row(s) reached",
      "replay: tracking — no contentTrackingId found",
      "replay: adjacency — marker→id distance within 1: 1, at 2: 0, further: 0",
      "replay: markers — feed-commentary/commentary_text: 1",
      "replay: verdict — no card-scoped join found; 0/1 row(s) skipped ids-only",
    ]);
  });

  it("cross-checks the instrumented tallies against the frozen parser on the mixed body", async () => {
    const analysis = await replayBody(MIXED_BODY);
    const minted = collectLinkedInPosts(MIXED_BODY);
    assert.equal(Math.min(analysis.distinctIds, analysis.distinctTexts), minted.length);
    for (const row of analysis.rows) {
      if (row.disposition?.startsWith("zip-paired")) {
        const tail = row.disposition.slice(-6);
        assert.ok(
          minted.some((post) => post.id.endsWith(tail)),
          `zip-paired tail ${tail} names no urn the parser minted`,
        );
      }
    }
  });
});

describe("six-point probe", () => {
  it("finds the join in both BFS directions when a marker row refs an id row — verdict flips to CANDIDATE", async (t) => {
    const lines = await replayLines(t, JOIN_BODY);
    assert.deepEqual(lines, [
      "replay: body 7 — 2 root row(s), 1 distinct text(s), 1 distinct id(s)",
      `replay: row 1 — ids=0 texts=1 — TEXTS-ONLY (zip-paired ↔ ${idAt(9).slice(-6)})`,
      "replay: row 2 — ids=1 texts=0 — IDS-ONLY (no text harvest)",
      "replay: probe — forwardBFS from 1 marker row(s): 1 id row(s) reached; reverse from 1 id row(s): 1 marker row(s) reached",
      "replay: tracking — no contentTrackingId found",
      "replay: adjacency — marker→id distance within 1: 1, at 2: 0, further: 0",
      "replay: markers — feed-commentary/commentary_text: 1",
      "replay: verdict — join CANDIDATE (forward 1, reverse 1) — the Option-A promotion condition is met; inspect the reachable rows before any pairing rule changes",
    ]);
  });

  it("groups contentTrackingId values and flags the list-level single value", async (t) => {
    const lines = await replayLines(t, TRACK_BODY);
    assert.ok(
      lines.includes("replay: tracking — 2 value(s); largest group 2 of 3 row(s)"),
      lines.join("\n"),
    );
    const listLines = await replayLines(t, LIST_BODY);
    assert.ok(
      listLines.includes("replay: tracking — 1 value(s); largest group 2 of 2 row(s) (list-level)"),
      listLines.join("\n"),
    );
  });

  it("tallies every viewTrackingSpecs shape, not just commentary_text", async (t) => {
    const lines = await replayLines(t, TAX_BODY);
    assert.ok(
      lines.includes(
        "replay: markers — feed-commentary/commentary_text: 1, feed-singular/singular_component: 1",
      ),
      lines.join("\n"),
    );
  });
});

describe("multi-file", () => {
  it("replays files in order, one analysis per file", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
    const first = join(dir, "a.json");
    const second = join(dir, "b.json");
    await writeFile(first, `${JSON.stringify(capture(MIXED_BODY))}\n`, "utf8");
    await writeFile(second, `${JSON.stringify(capture(CTA_BODY, { ordinal: 3 }))}\n`, "utf8");
    const { reports } = await runReplay({ argv: [first, second] });
    assert.equal(reports.length, 2);
    const headers = logs.mock.calls
      .map((call) => String(call.arguments[0]))
      .filter((line) => line.startsWith("replay: body"));
    assert.deepEqual(headers, [
      "replay: body 7 — 5 root row(s), 3 distinct text(s), 4 distinct id(s)",
      "replay: body 3 — 1 root row(s), 1 distinct text(s), 1 distinct id(s)",
    ]);
  });
});
