/**
 * Offline suite for the LinkedIn capture sink (Slice 1): atomic envelope
 * writes, the lazy session stamp, slug minting, and the
 * first-failure-warns-once policy. Zero repo writes — every suite touches
 * mkdtemp dirs only; the production root constant is never exercised here.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  CAPTURE_KEEP_SESSIONS,
  CAPTURE_MAX_BODY_BYTES,
  CAPTURE_SCHEMA_VERSION,
  type CaptureRecord,
  captureOnce,
  makeFsCaptureSink,
  sessionStamp,
  surfaceSlug,
} from "../src/linkedin-capture.js";

/** Pinned clock: 2026-11-13T04:24:35.000Z (month is 0-based). */
const NOW = Date.UTC(2026, 10, 13, 4, 24, 35);

/**
 * One record; the DEFAULT shape is unmatched (no minted/fresh keys —
 * exactOptionalPropertyTypes forbids undefined assignment, so matched
 * tests add real numbers via overrides).
 */
const record = (overrides: Partial<CaptureRecord> = {}): CaptureRecord => ({
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  capturedAt: new Date(NOW).toISOString(),
  label: "linkedin/#hiring indonesia",
  ordinal: 1,
  received: 1,
  url: "https://www.linkedin.com/flagship-web/search/results/content/?keywords=%23hiring",
  status: 200,
  matched: true,
  body: '0:I["$1",[],"default"]\n1a:{"tracking":{}}',
  ...overrides,
});

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

/** A fresh sub-root per test inside the one lazy suite dir. */
async function tempRoot(): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-capture-"));
  const root = join(dir, `root-${Math.random().toString(36).slice(2)}`);
  await mkdir(root);
  return root;
}

describe("sessionStamp", () => {
  it("formats the pinned clock Windows-safe: no colons, lexical order, Z suffix", () => {
    assert.equal(
      sessionStamp(() => NOW),
      "20261113T042435Z",
    );
  });
});

describe("surfaceSlug", () => {
  it("strips the linkedin/ prefix and folds a #keyword phrase to one slug", () => {
    assert.equal(surfaceSlug("linkedin/#hiring indonesia"), "hiring-indonesia");
  });

  it("caps at 40 chars and re-trims a hyphen cut by the cap", () => {
    const slug = surfaceSlug(`${"a".repeat(39)}-b`);
    assert.equal(slug, "a".repeat(39));
  });

  it("falls back to surface for a DEGENERATE keyword (emoji-only sanitizes empty)", () => {
    assert.equal(surfaceSlug("linkedin/\u{1F525}\u{1F525}"), "surface");
  });
});

describe("makeFsCaptureSink", () => {
  it("atomic write round-trips the envelope deep-equal with a trailing newline", async () => {
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW);
    const rec = record({ minted: 3, fresh: 2 });
    await sink(rec);
    const file = join(
      root,
      sessionStamp(() => NOW),
      "001-hiring-indonesia.json",
    );
    const text = await readFile(file, "utf8");
    assert.deepEqual(JSON.parse(text) as CaptureRecord, rec);
    assert.ok(text.endsWith("\n"));
  });

  it("mints the session stamp lazily: no directory until the first capture", async () => {
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW);
    await assert.rejects(
      () =>
        readdir(
          join(
            root,
            sessionStamp(() => NOW),
          ),
        ),
      /ENOENT/,
    );
    await sink(record());
    const entries = await readdir(
      join(
        root,
        sessionStamp(() => NOW),
      ),
    );
    assert.deepEqual(entries, ["001-hiring-indonesia.json"]);
  });

  it("skips a body over the bound, warns once, and creates no directory (N051)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW);
    // 8 MB of ASCII is 8,388,608 bytes — one byte over the bound. Built by
    // repeat, not by a literal, so the test carries no 8 MB string in source.
    const over = "x".repeat(CAPTURE_MAX_BODY_BYTES + 1);
    await sink(record({ body: over, ordinal: 1 }));
    await sink(record({ body: over, ordinal: 2 }));
    // No directory: the guard ran before the lazy stamp and before mkdir.
    await assert.rejects(
      () =>
        readdir(
          join(
            root,
            sessionStamp(() => NOW),
          ),
        ),
      /ENOENT/,
    );
    assert.equal(warns.mock.callCount(), 1); // one warn per sink, not per body
    const line = String(warns.mock.calls[0]?.arguments[0] ?? "");
    assert.match(line, /linkedin-capture: skipped/);
    assert.match(line, /8388609 bytes exceeds the 8388608-byte bound/);
  });

  it("measures UTF-8 bytes, not UTF-16 code units (N051)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW);
    // 4,194,305 two-byte characters: 4,194,305 UTF-16 code units (well
    // under the bound) but 8,388,610 UTF-8 bytes (over it). A
    // String.length guard would write this body; the byte guard skips it.
    const multi = record({ body: "\u00e9".repeat(4_194_305) });
    await sink(multi);
    await assert.rejects(
      () =>
        readdir(
          join(
            root,
            sessionStamp(() => NOW),
          ),
        ),
      /ENOENT/,
    );
    assert.equal(warns.mock.callCount(), 1);
    assert.match(String(warns.mock.calls[0]?.arguments[0] ?? ""), /8388610 bytes/);
  });

  it("a skipped body does not disturb the session stamp of a later write (N051)", async () => {
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW);
    await sink(record({ body: "x".repeat(CAPTURE_MAX_BODY_BYTES + 1) }));
    await sink(record({ ordinal: 2, body: "small" }));
    const entries = await readdir(
      join(
        root,
        sessionStamp(() => NOW),
      ),
    );
    assert.deepEqual(entries, ["002-hiring-indonesia.json"]);
  });

  it("keeps two records in one session dir named <padded ordinal>-<slug>.json", async () => {
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW);
    await sink(record({ ordinal: 1, matched: false, body: "first" }));
    await sink(
      record({ ordinal: 2, label: "linkedin/react", body: "second", minted: 1, fresh: 1 }),
    );
    const entries = await readdir(
      join(
        root,
        sessionStamp(() => NOW),
      ),
    );
    assert.deepEqual(entries, ["001-hiring-indonesia.json", "002-react.json"]);
  });

  it("zero-pads the ordinal so lexical order is arrival order past 10 files", async () => {
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW);
    await sink(record({ ordinal: 12, body: "twelfth" }));
    const entries = await readdir(
      join(
        root,
        sessionStamp(() => NOW),
      ),
    );
    assert.deepEqual(entries, ["012-hiring-indonesia.json"]);
  });

  it("rejects naming the target when the write fails (session path is a file)", async () => {
    const root = await tempRoot();
    const blocker = join(
      root,
      sessionStamp(() => NOW),
    );
    await writeFile(blocker, "not a dir", "utf8");
    const sink = makeFsCaptureSink(root, () => NOW);
    await assert.rejects(
      () => sink(record()),
      (error: unknown) => {
        assert.match((error as Error).message, /^capture: atomic write failed for /);
        assert.match((error as Error).message, /001-hiring-indonesia\.json/);
        return true;
      },
    );
  });

  it("omits minted/fresh from the file when the producer leaves them off", async () => {
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW);
    await sink(record({ matched: false }));
    const file = join(
      root,
      sessionStamp(() => NOW),
      "001-hiring-indonesia.json",
    );
    const text = await readFile(file, "utf8");
    assert.ok(!text.includes("minted"));
    assert.ok(!text.includes("fresh"));
  });

  it("prunes session stamps beyond the newest 20 — best-effort retention", async () => {
    const root = await tempRoot();
    // 21 sessions one minute apart: every sink closure mints its own stamp.
    for (let i = 0; i <= CAPTURE_KEEP_SESSIONS; i += 1) {
      await makeFsCaptureSink(root, () => NOW + i * 60_000)(record({ body: `session ${i}` }));
    }
    const entries = (await readdir(root)).sort();
    assert.equal(entries.length, CAPTURE_KEEP_SESSIONS); // the oldest stamp is gone
    assert.equal(
      entries[0],
      sessionStamp(() => NOW + 60_000),
    );
    assert.ok(entries.includes(sessionStamp(() => NOW + CAPTURE_KEEP_SESSIONS * 60_000)));
  });

  it("a failed prune never fails the capture that just landed (best-effort)", async (t) => {
    const root = await tempRoot();
    // The prune's readdir seam takes a throwing double: the sink call must
    // RESOLVE (the write already landed), the envelope must be on disk, and
    // no warn may fire (a failed prune is swallowed, not a sink failure).
    const warnSpy = t.mock.method(console, "warn", console.warn.bind(console));
    const sink = makeFsCaptureSink(
      root,
      () => NOW,
      async (): Promise<string[]> => {
        throw new Error("prune exploded");
      },
    );
    await sink(record({ ordinal: 5 })); // resolves — the write already landed
    const file = join(
      root,
      sessionStamp(() => NOW),
      "005-hiring-indonesia.json",
    );
    const text = await readFile(file, "utf8"); // the capture is on disk
    assert.deepEqual(JSON.parse(text) as CaptureRecord, record({ ordinal: 5 }));
    assert.equal(warnSpy.mock.callCount(), 0); // a failed prune is silent, not warn-once
  });
});

describe("captureOnce", () => {
  it("never rejects on a failing sink and warns ONCE across repeated failures", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const state = { warned: false };
    const failing = async (): Promise<void> => {
      throw new Error("disk full");
    };
    captureOnce(failing, record(), state);
    captureOnce(failing, record(), state);
    captureOnce(failing, record(), state);
    await new Promise((resolve) => setImmediate(resolve)); // drain the void'd rejections
    assert.equal(warns.mock.callCount(), 1);
    assert.match(String(warns.mock.calls[0]?.arguments[0] ?? ""), /disk full/);
    assert.match(String(warns.mock.calls[0]?.arguments[0] ?? ""), /first this walk/);
    assert.equal(state.warned, true);
  });

  it("delivers the record on success and leaves the warn state untouched", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const state = { warned: false };
    const written: CaptureRecord[] = [];
    const sink = async (rec: CaptureRecord): Promise<void> => {
      written.push(rec);
    };
    captureOnce(sink, record({ ordinal: 3 }), state);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      written.map((rec) => rec.ordinal),
      [3],
    );
    assert.equal(warns.mock.callCount(), 0);
    assert.equal(state.warned, false);
  });
});
