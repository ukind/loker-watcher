---
date: 2026-11-13T15:27:41+0700
author: Yogiswara Utama
commit: 33e17dc
branch: ukind/feature-fix-incorrect-link-linkedin
repository: feature-fix-incorrect-link-linkedin
topic: "LinkedIn raw-body capture + replay harness"
tags: [plan, linkedin-capture, replay-linkedin, linkedin-fetch]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-13_11-24-35_linkedin-post-link-pairing.md"
phase_count: 4
phases:
  - { n: 1, title: Capture sink foundation, files: [src/config.ts, src/linkedin-capture.ts, tests/linkedin-capture.test.ts], depends_on: [] }
  - { n: 2, title: Walk bolt-in, files: [src/linkedin-fetch.ts, tests/linkedin-fetch.test.ts], depends_on: [1] }
  - { n: 3, title: Replay script, files: [scripts/replay-linkedin.ts, tests/replay-linkedin.test.ts], depends_on: [1] }
  - { n: 4, title: PC wiring + repo plumbing, files: [scripts/fetch-linkedin.ts, scripts/probe-linkedin.ts, package.json, .gitignore, tests/fetch-linkedin.test.ts, tests/probe-linkedin.test.ts], depends_on: [1, 2, 3] }
last_updated: 2026-11-13T15:27:41+0700
last_updated_by: Yogiswara Utama
---

# LinkedIn raw-body capture + replay harness Implementation Plan

## Overview

Implements the design artifact's capture-first precondition: an injectable sink records every intercepted flagship-web response body as one atomic JSON file under `captures/<UTC session stamp>/`, and `scripts/replay-linkedin.ts` re-analyzes recorded bodies offline. The replay output is the evidence the follow-up mint-path design must be written from (the recorded R4 decision); the mint change itself is NOT in scope.

Design decisions D1-D9 are settled — no re-evaluation here. Code blocks pass through from the design's `## Architecture`; Success Criteria pass through from the design's `## Slices` unchanged (slice-verifier already validated them). Phases 2 and 3 run in parallel after Phase 1. Phase 4 lands last: its `npm run lint` gate reads Phase 3's file through package.json's explicit lists.

## Desired End State

## Desired End State

```bash
# One probe rehearsal records every body:
npm run probe-linkedin
# captures/20261113T042435Z/001-hiring-indonesia.json  (one per response body)

# Offline replay names each row's fate:
npx tsx scripts/replay-linkedin.ts captures/20261113T042435Z/001-hiring-indonesia.json
# replay: body 1 — 12 root row(s), 3 distinct text(s), 130 distinct id(s)
# replay: row 3 — ids=1 texts=1 — BOTH (zip-paired ↔ <urn tail>)
# replay: row 7 — ids=1 texts=0 — IDS-ONLY (no text harvest)
# replay: probe — forwardBFS from 3 marker row(s): 0 id row(s) reached; reverse from 131 id row(s): 0 marker row(s) reached
# replay: verdict — no card-scoped join found; 12/15 row(s) skipped ids-only

> Sample shapes updated at Step 5 triage to the emitted output: fence filenames are zero-padded `001-…` with the `linkedin/` prefix stripped from the slug, the replay prints `zip-paired ↔ <urn tail>` vocabulary and `distinct` counts. The design's identical block carries the same staleness — upstream follow-up noted in the Plan Review resolution.
```

The next `/skill:design` run (the mint change) cites these lines as its evidence base.

## What We're NOT Doing

- The mint change: optional `Post.permalink`, payload admission relaxation (`:99-100`), email/heartbeat render changes — blocked on replay evidence (R4).
- Any parser change — the junk-gate predicate freezes only after the replay names causes per row.
- `PAYLOAD_VERSION` bump or any payload shape change; the hosted reader.
- Threads side; refuse-on-mismatch; duplicate-repost collapse.

## Phase 1: Capture sink foundation

### Overview
Delivers the standalone capture sink: the `LINKEDIN_CAPTURES_ROOT` constant, the `CaptureRecord` envelope, the `CaptureSink` seam, the atomic fs sink with best-effort retention, the lazy session stamp, the slug helpers, and the warn-once fire-and-forget wrapper — with its own offline suite. Nothing imports the sink yet; the pipeline is untouched.

### Changes Required:

**Files**: `src/config.ts`, `src/linkedin-capture.ts`, `tests/linkedin-capture.test.ts`

#### src/config.ts (insert after the LINKEDIN_PAYLOAD_PATH block, before the JUDGE_CEILINGS_PATH comment) — MODIFY

```ts
/**
 * Diagnostic capture root for the LinkedIn raw-body capture harness
 * (capture-first precondition, design 2026-11-13): every intercepted
 * flagship-web response body lands under captures/<UTC session stamp>/ as
 * one atomic JSON file, read back offline by scripts/replay-linkedin.ts.
 * Untracked scratch, NOT committed state: the one-writer-per-file doctrine
 * does not apply (the PC walk is the only writer by construction and the
 * hosted run never captures — src/index.ts imports only a type from
 * linkedin-fetch). Gitignored in the same change as the sink, because
 * guardCheckout throws on any untracked path before every tick
 * (scripts/fetch-linkedin.ts:254-261).
 */
export const LINKEDIN_CAPTURES_ROOT = "captures";
```

#### src/linkedin-capture.ts — NEW

```ts
/**
 * The LinkedIn raw-body capture sink (capture-first precondition, design
 * 2026-11-13): every intercepted flagship-web response body lands as ONE
 * atomic JSON file under captures/<UTC session stamp>/<padded ordinal>-<keyword-slug>.json
 * so scripts/replay-linkedin.ts can re-analyze the walk offline.
 *
 * Contract, in order:
 * - The sink WRITES; it never decides policy. A failed write rejects with
 *   the target named (the writePayloadAtomic shape) — the walk's
 *   captureOnce call owns the failure policy.
 * - captureOnce is the fire-and-forget seam the listener arms use: a sink
 *   rejection NEVER rejects the walk. The first failure per surface walk
 *   warns once (the handleLegDeadEpisode one-alarm-per-episode discipline,
 *   scaled down to a log line); later failures stay quiet.
 * - The session stamp mints LAZILY on the first capture, so a walk whose
 *   pages fire no bodies creates no directory at all.
 *
 * Testability: the sink is a plain injectable closure — the offline suite
 * passes a tmp root (mkdtemp) or a recording fake; production builds it
 * once per tick/probe from LINKEDIN_CAPTURES_ROOT (src/config.ts). A
 * sink-less walk captures nothing, so npm test never writes into the repo.
 *
 * exactOptionalPropertyTypes: the matched-only envelope fields (minted,
 * fresh) are OMITTED via conditional spread — never undefined-assigned
 * (the surfaces-stamp precedent, src/types.ts:28).
 */
import { mkdir, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LINKEDIN_CAPTURES_ROOT } from "./config.js";
import { stateTempPath } from "./state.js";

/** Envelope schema for one captured response body. Bumped on a shape change. */
export const CAPTURE_SCHEMA_VERSION = 1;

/**
 * Retention for the captures root (follow-up 2026-11-13): after each write
 * the sink prunes session-stamp directories beyond the newest N — at the
 * working-hours tick cadence (~24-28 walks per weekday, 2-6 MB per walk)
 * capture scratch would otherwise grow by roughly 1-3 GB/month on the PC
 * with no alarm when the disk fills (D4's own silent-void rationale).
 */
export const CAPTURE_KEEP_SESSIONS = 20;

/** Session-stamp directory shape (sessionStamp's output). */
const SESSION_DIR_RE = /^\d{8}T\d{6}Z$/;

/**
 * The metadata envelope INSIDE each capture file: the walk's facts at the
 * moment the body landed. `url` is FULL — only the unmatched arm's LOG
 * LINE truncates to 80 chars (src/linkedin-fetch.ts), never the record.
 */
export interface CaptureRecord {
  /** Envelope version (CAPTURE_SCHEMA_VERSION), independent of PAYLOAD_VERSION. */
  schemaVersion: number;
  /** ISO instant of the capture (the injected walk clock). */
  capturedAt: string;
  /** The walk label, "linkedin/<keyword>" — the keyword is the slug material. */
  label: string;
  /** 1-based per-walk ordinal, incremented synchronously in the listener. */
  ordinal: number;
  /** Matched-body count at capture time (liveness context; matched arm only). */
  received: number;
  /** FULL response URL. */
  url: string;
  /** HTTP status (the walk captures 200 matched bodies; unmatched can be any). */
  status: number;
  /** LINKEDIN_RESPONSE_RE match — the mint arm (true) vs the diagnostic arm (false). */
  matched: boolean;
  /** The verbatim response body. */
  body: string;
  /** Matched arm only: posts the parser minted (conditional spread — omitted when unmatched). */
  minted?: number;
  /** Matched arm only: posts that were NEW after urn dedupe (conditional spread). */
  fresh?: number;
}

/**
 * The sink seam the walk receives. A sink MAY reject — captureOnce turns
 * that into the warn-once policy; it must never be awaited by the walk.
 */
export type CaptureSink = (record: CaptureRecord) => Promise<void>;

/**
 * Warn-once state for one surface walk: the page-local unit that owns the
 * listener. Created per walkLinkedInSurface invocation.
 */
export interface CaptureWarnState {
  warned: boolean;
}

/**
 * UTC session stamp for the captures directory: 2026-11-13T04:24:35.000Z
 * reads 20261113T042435Z — Windows-safe (no colon), sorts lexically.
 */
export function sessionStamp(now: () => number = Date.now): string {
  return new Date(now())
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Filename slug from a walk label's KEYWORD: the "linkedin/" prefix is
 * stripped first, then lowercase, non-alphanumeric runs fold to one hyphen,
 * trimmed, capped at 40 chars (re-trimmed), empty -> "surface". A keyword
 * like "#hiring indonesia" reads "hiring-indonesia"; a degenerate keyword
 * (pure emoji or CJK text sanitizes to nothing) reads "surface" — reachable
 * and collision-safe, because the padded ordinal keeps names unique within
 * the session stamp.
 */
export function surfaceSlug(label: string): string {
  const keyword = label.startsWith("linkedin/") ? label.slice("linkedin/".length) : label;
  const slug = keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "surface";
}

/**
 * The production sink: atomic whole-file writes (sibling temp via
 * stateTempPath + rename, the writePayloadAtomic shape) under
 * <root>/<session stamp>/<padded ordinal>-<slug>.json. The ordinal pads to
 * 3 digits so lexical order IS arrival order past 10 files. The session
 * stamp mints on the FIRST capture — a body-less walk creates no directory.
 * Retention (follow-up 2026-11-13): after every successful write the sink
 * prunes session-stamp directories beyond the newest CAPTURE_KEEP_SESSIONS
 * — best-effort; a failed prune never fails the capture that just landed.
 * A failed write cleans the temp file and rejects naming the target;
 * captureOnce owns the warn policy.
 */
export function makeFsCaptureSink(
  root: string = LINKEDIN_CAPTURES_ROOT,
  now: () => number = Date.now,
  // Testability (the best-effort-prune pin): inject a throwing readdir to
  // prove a failed prune never fails the capture that just landed — the
  // ESM namespace cannot be monkey-patched (non-configurable properties).
  readdirFn: (path: string) => Promise<string[]> = readdir,
): CaptureSink {
  let session: string | undefined;
  return async (record: CaptureRecord): Promise<void> => {
    session ??= sessionStamp(now);
    const dir = join(root, session);
    const target = join(
      dir,
      `${String(record.ordinal).padStart(3, "0")}-${surfaceSlug(record.label)}.json`,
    );
    const tempPath = stateTempPath(dir, now());
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      await rename(tempPath, target);
    } catch (error) {
      try {
        await unlink(tempPath);
      } catch {
        // Best-effort temp cleanup (the writePayloadAtomic arm)
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`capture: atomic write failed for ${target}: ${message}`);
    }
    // Retention (follow-up 2026-11-13): keep only the newest
    // CAPTURE_KEEP_SESSIONS session stamps. A failed prune NEVER fails the
    // capture — the write already landed (the best-effort temp-cleanup
    // idiom); the next successful prune cleans up.
    try {
      const stale = (await readdirFn(root))
        .filter((name) => SESSION_DIR_RE.test(name))
        .sort()
        .slice(0, -CAPTURE_KEEP_SESSIONS);
      for (const name of stale) {
        await rm(join(root, name), { recursive: true, force: true });
      }
    } catch {
      // best-effort: never converts a landed capture into a sink failure
    }
  };
}

/**
 * Fire-and-forget capture with the first-failure-warns-once policy: the
 * sink's rejection NEVER propagates (the listener arms' page-close-race
 * catches stay the only swallows in the walk). The first rejection warns
 * once naming the error; later rejections stay quiet — a persistently
 * broken sink must not spam every body, and a fully silent sink would void
 * the capture precondition invisibly (the replay would find nothing).
 */
export function captureOnce(
  sink: CaptureSink,
  record: CaptureRecord,
  state: CaptureWarnState,
): void {
  void sink(record).catch((error: unknown) => {
    if (state.warned) return;
    state.warned = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `linkedin-capture: sink failed (first this walk; further failures stay quiet) — ${message}`,
    );
  });
}

```

#### tests/linkedin-capture.test.ts — NEW

```ts
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
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Sink pins: envelope round-trip deepEqual + trailing-newline file shape; lazy session stamp (readdir ENOENT before the first capture); zero-padded filenames `001-hiring-indonesia.json` / `002-react.json` / `012-hiring-indonesia.json` (lexical order = arrival order past 10 files); write failure rejects `/^capture: atomic write failed for /` naming the target; the unmatched envelope omits minted/fresh keys from the FILE; sessionStamp pins `20261113T042435Z`; slug strips the "linkedin/" prefix ("hiring-indonesia"), falls back to "surface" for a degenerate emoji-only keyword, and re-trims a hyphen cut by the 40-char cap
- [x] Retention pin: 21 session-stamp writes leave exactly CAPTURE_KEEP_SESSIONS (20) stamp dirs — the oldest pruned, the newest kept
- [x] Best-effort pin: a throwing readdirFn double leaves the capture RESOLVED and on disk with zero warns (a failed prune is silent, never a warn-once sink failure)
- [x] captureOnce pins: exactly ONE console.warn across three sink failures (message names the cause and "first this walk"); zero warns on success; the caller never rejects

#### Manual Verification:
- [ ] Spot-check one capture file written by the suite's temp dir: valid JSON, schemaVersion 1, FULL url (no truncation), verbatim body

---

## Phase 2: Walk bolt-in

### Overview
Bolts the sink into the walk: a 9th defaulted trailing param on `fetchLinkedInPosts`, a shared per-tick ordinal counter, capture in BOTH listener arms (matched adds minted/fresh, unmatched omits them), and the walk suite's capture pins + in-file absence oracle. A sink-less walk captures nothing — all 28 pre-existing call sites pass unchanged.

### Changes Required:

**Files**: `src/linkedin-fetch.ts`, `tests/linkedin-fetch.test.ts`

#### src/linkedin-fetch.ts — MODIFY

> Line refs in this block are POST-APPLICATION positions (each fence assumes the earlier fences of this phase applied), not HEAD positions — at HEAD: `walkLinkedInSurface` at 461, the `minClicks = 0` default at 686, the sole call site at 722.

```ts
// --- 1. the sink import (47-53) ---
import { HALT_CHECKPOINT_REASON, type RandomFn } from "./linkedin-behavior.js";
import {
  CAPTURE_SCHEMA_VERSION,
  type CaptureSink,
  type CaptureWarnState,
  captureOnce,
} from "./linkedin-capture.js";

// --- 2. walkLinkedInSurface doc addition (466-476) ---
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

// --- 3. walkLinkedInSurface signature + per-walk warn state (477-491) ---
async function walkLinkedInSurface(
  context: ContextLike,
  surface: LinkedinSurface,
  label: string,
  scrollRounds: number,
  minClicks: number,
  captureSink: CaptureSink | undefined,
  captureOrdinal: { value: number },
  nowFn: () => number,
): Promise<Post[]> {
  const page = await context.newPage();
  const posts = new Map<string, Post>();
  let received = 0; // matched flagship-web bodies fully read — the liveness signal
  let parsed = 0; // bodies that carried at least one post — the OK-line counter (N008)
  const captureWarn: CaptureWarnState = { warned: false };

// --- 4. the UNMATCHED diagnostic arm captures (509-535) ---
    if (!matched && /flagship-web/i.test(url)) {
      void (async () => {
        try {
          const body = await response.text();
          // Capture-first (design 2026-11-13): the diagnostic arm records
          // the body too — the SSR firehose (ids=0, markers=0) is a REAL
          // response, and the replay needs it (commit 9fa2a7e).

[2043 more lines in file. Use offset=401 to continue.]
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

// --- 5. the MATCHED mint arm captures (562-588) ---
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
      } catch {

// --- 6. fetchLinkedInPosts doc addition (741-747) ---
 *
 * captureSink (capture-first, design 2026-11-13): the 9th defaulted
 * trailing param, undefined = capture disabled — the offline suite passes
 * nothing and nothing writes; the PC scripts pass the production fs sink.
 * The per-tick ordinal counter is minted here and shared across every
 * surface walk (D7).
 */

// --- 7. the 9th defaulted trailing param (757) ---
  captureSink?: CaptureSink,

// --- 8. the shared per-tick ordinal (768-772) ---
  const gate = makePacingGate(now, sleepFn, rng);
  // Shared per-tick capture ordinal (D7): one counter across every surface
  // walk, incremented synchronously in the response listener — filenames
  // stay unique and arrival-ordered within the session stamp.
  const captureOrdinal = { value: 0 };

// --- 9. the sole walkLinkedInSurface call site (797-806) ---
        const posts = await walkLinkedInSurface(
          context,
          surface,
          label,
          scrollRounds,
          minClicks,
          captureSink,
          captureOrdinal,
          now,
        );
```

#### tests/linkedin-fetch.test.ts (capture-arm additions) — MODIFY

```ts
// --- 1. the type-only capture import (28) ---
import type { CaptureRecord, CaptureSink } from "../src/linkedin-capture.js";

// --- 1b. the doctrine-oracle imports, emitted concretely (Step 5 triage; the design's
//     identical block at Phase 4 fence 1b is the canonical form) ---
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// `after` joins the existing node:test import: import { after, describe, it } from "node:test";

// --- 2. the >80-char unmatched URL constant (the design's fence was empty here — completed at Step 5 triage) ---
// Flagship-web class (passes the unmatched arm's /flagship-web/i gate), >80 chars, and missing
// LINKEDIN_RESPONSE_RE by URL (the mint regex accepts only search/results/content and
// rsc-action/actions/pagination) — the same miss class as the SSR firehose noise below, so the
// 500-status body routes to the UNMATCHED arm. The 80-char cut is the unmatched LOG LINE's,
// never the record's: fence 4 pins the FULL url against this constant.
const LONG_FLAGSHIP_URL =
  "https://www.linkedin.com/flagship-web/rsc-action/actions/component?keywords=%23hiring%20indonesia&origin=SWITCH_SEARCH_VERTICAL&searchId=flagship-noise-capture";

// --- 3. the recording sink double (287-300) ---
/**
 * Recording capture sink (the capture-arm oracle): stores every record in
 * arrival order; `failAfter` makes every call from that point REJECT —
 * the trigger for the warn-once policy pin.
 */
function recordingSink(options: { failAfter?: number } = {}): {
  sink: CaptureSink;
  records: CaptureRecord[];
} {
  const records: CaptureRecord[] = [];
  const sink: CaptureSink = async (record) => {
    if (options.failAfter !== undefined && records.length >= options.failAfter) {
      throw new Error("disk full");
    }
    records.push(record);
  };
  return { sink, records };
}

// --- 4. the capture describe block, appended at end of file (1033-EOF) ---
describe("fetchLinkedInPosts capture bolt-in (capture-first, design 2026-11-13)", () => {
  it("captures BOTH arms when a sink rides — matched carries minted/fresh, unmatched omits them", async () => {
    const { sink, records } = recordingSink();
    const NOW_MS = Date.UTC(2026, 10, 13, 4, 24, 35);
    const ssrNoiseBody = row("n1", { tracking: { activityUrn: { activityId: idAt(51) } } });
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23cap",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            clickBodies: [cardBody(idAt(2), postText(2))],
            noiseOnFirstSettle: [
              {
                url: () => LONG_FLAGSHIP_URL,
                status: () => 500,
                text: async () => cardBody(idAt(50), "noise 500 body"),
              },
              {
                // Misses LINKEDIN_RESPONSE_RE by URL — the SSR firehose class.
                url: () => "https://www.linkedin.com/flagship-web/rsc-action/actions/component",
                status: () => 200,
                text: async () => ssrNoiseBody,
              },
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#cap")],
      PROFILE,
      factory,
      1,
      instantSleep,

[1644 more lines in file. Use offset=800 to continue.]
      () => NOW_MS,
      () => 0,
      0,
      sink,
    );
    assert.equal(posts.length, 2);
    assert.equal(records.length, 4); // initial + click + two diagnostic bodies
    assert.deepEqual(
      records.map((rec) => rec.ordinal),
      [1, 2, 3, 4],
    ); // arrival order
    const [initial, click, noise500, ssr] = records;
    // Matched arm: minted/fresh present; received counts the body itself;
    // capturedAt rides the injected walk clock.
    assert.equal(initial?.matched, true);
    assert.equal(initial?.minted, 1);
    assert.equal(initial?.fresh, 1);
    assert.equal(initial?.received, 1);
    assert.equal(initial?.capturedAt, new Date(NOW_MS).toISOString());
    assert.equal(click?.matched, true);
    assert.equal(click?.minted, 1);
    assert.equal(click?.fresh, 1);
    assert.equal(click?.received, 2);
    // Unmatched arm: FULL url (the 80-char cut is the log line's, never the
    // record's), verbatim status, and NO minted/fresh keys at all.
    assert.equal(noise500?.matched, false);
    assert.equal(noise500?.status, 500);
    assert.equal(noise500?.url, LONG_FLAGSHIP_URL); // FULL — past any 80-char cut
    assert.equal("minted" in (noise500 ?? {}), false);
    assert.equal("fresh" in (noise500 ?? {}), false);
    assert.equal(ssr?.matched, false);
    assert.equal("minted" in (ssr ?? {}), false);
  });

  it("shares one ordinal counter across surfaces — ordinals stay unique within the walk", async () => {
    const { sink, records } = recordingSink();
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
      instantSleep,
      () => 0,
      () => 0,
      0,
      sink,
    );
    assert.deepEqual(
      records.map((rec) => rec.ordinal).sort((a, b) => a - b),
      [1, 2],
    );
    assert.deepEqual(records.map((rec) => rec.label).sort(), ["linkedin/#a", "linkedin/#b"]);
  });

  it("captures an SSR-shaped matched body with minted 0 / fresh 0", async () => {
    const { sink, records } = recordingSink();
    const factory = fakeContextFactory({
      scripts: [{ fragment: "%23ssr", script: { initialBody: emptyBody() } }],
    });
    await fetchLinkedInPosts(
      [surface("#ssr")],
      PROFILE,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
      0,
      sink,
    );
    assert.equal(records.length, 1);
    assert.equal(records[0]?.matched, true);
    assert.equal(records[0]?.minted, 0);
    assert.equal(records[0]?.fresh, 0);
  });

  it("never rejects on a failing sink and warns exactly once across repeated failures", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const { sink, records } = recordingSink({ failAfter: 0 });
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23failing",
          script: {
            initialBody: cardBody(idAt(1), postText(1)),
            clickBodies: [cardBody(idAt(2), postText(2))],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#failing")],
      PROFILE,
      factory,
      1,
      instantSleep,
      () => 0,
      () => 0,
      0,
      sink,
    );
    await flush(); // drain the void'd sink rejections
    assert.deepEqual(records, []); // every write failed
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(1)}`, `urn:li:activity:${idAt(2)}`],
    ); // the walk never noticed
    assert.equal(warns.mock.callCount(), 1); // one warn per walk, not per failure
    assert.match(String(warns.mock.calls[0]?.arguments[0] ?? ""), /linkedin-capture: sink failed/);
    assert.match(String(warns.mock.calls[0]?.arguments[0] ?? ""), /disk full/);
  });
});

// --- the offline-capture doctrine oracle (follow-up 2026-11-13): this
// suite drives fetchLinkedInPosts DIRECTLY, so a future case handing the
// walk a production-default sink fails HERE instead of writing captures/
// into the repo. The imports gain access (node:fs/promises), dirname/join
// (node:path), fileURLToPath (node:url), and after joins the node:test
// import; the block sits before PROFILE at module top level.
const repoCaptures = join(dirname(fileURLToPath(import.meta.url)), "..", "captures");
const repoCapturesBefore = await access(repoCaptures).then(
  () => true,
  () => false,
);

after(async () => {
  if (!repoCapturesBefore) {
    await assert.rejects(() => access(repoCaptures), /ENOENT/);
  }
});

```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [x] Both arms capture when a sink is passed: matched records carry minted/fresh and received; unmatched records omit minted/fresh entirely (no undefined-assigned keys) and carry the FULL url (pinned against a >80-char URL) plus the verbatim status
- [x] The ordinal increments synchronously across BOTH arms in arrival order and is shared across surfaces within one walk (filenames stay unique)
- [x] capturedAt rides the injected walk clock, not Date.now
- [x] A failing sink never rejects the walk: posts still mint, and exactly ONE console.warn fires per surface walk naming the cause
- [x] A sink-less walk captures nothing — all 28 pre-existing call sites pass unchanged
- [x] The walk suite carries the absence oracle (repo-root `captures/` snapshotted at load, asserted in after()) — a future case handing the walk a production-default sink fails the suite, not the operator's disk
- [x] Existing walk pins unchanged: dedupe, dry-round exit, minClicks floor, pacing, fault vocabulary, teardown

#### Manual Verification:
- [ ] Scratch-harness walk (fetchLinkedInPosts + makeFsCaptureSink() over a mkdtemp root, no repo writes) produces one file per body under <root>/<stamp>/ with matched/unmatched envelopes distinguishable

---

## Phase 3: Replay script

### Overview
Delivers the offline replay harness: per-row census lines, junk-cause signals (CTA shape vs $-ref shrink), the six-point probe, the verdict lines, and the frozen-parser cross-check suite. Depends only on Phase 1's `CaptureRecord` shape — no walk dependency.

### Changes Required:

**Files**: `scripts/replay-linkedin.ts`, `tests/replay-linkedin.test.ts`

#### scripts/replay-linkedin.ts — NEW

The offline replay harness (D2, the probe-linkedin script shape): tagged zero-argv gate, entry-guarded main, the instrumented per-row walk with the six-point probe and the cross-checked tallies.

```ts
/**
 * Offline replay for the LinkedIn raw-body captures (capture-first
 * precondition, design 2026-11-13): read one or more CaptureRecord
 * files written by the walk's capture sink (src/linkedin-capture.ts),
 * re-analyze each body per root row, and print the evidence the
 * mint-path design must be written from (the recorded R4 decision —
 * the replay output selects or upgrades the mint policy; this script
 * decides nothing).
 *
 * Per body, every line rides the stable `replay:` prefix (the
 * oracle-channel doctrine — distinct outcomes never share a line):
 * - the census header: root rows, distinct texts, distinct ids (the
 *   parser's own global tallies, re-derived row by row);
 * - one line per root row: ids=, texts=, the classification (BOTH /
 *   IDS-ONLY / TEXTS-ONLY / EMPTY), what the incumbent zip did with
 *   the row's text (zip-paired ↔ <urn tail> / zip-unlinked), and the
 *   junk-cause signal — cta-suspect names the text shape (the marker
 *   specs are byte-identical between CTA components and real posts,
 *   so the text is the only signal); shrink-suspect counts the $-refs
 *   the text walk dropped (missing targets, already-consumed rows,
 *   path misses); text lost names the empty-harvest case;
 * - the six-point probe summary: forward BFS from the commentary
 *   marker rows over the $-ref graph, reverse BFS from the id rows
 *   over the same edges, the contentTrackingId grouping, the
 *   adjacency invariants (stream distance between marker and id
 *   rows), and the marker taxonomy (every viewTrackingSpecs shape);
 * - the verdict: whether any card-scoped join EXISTS (either BFS
 *   direction reaching across = the Option-A promotion condition)
 *   and the ids-only skip share.
 *
 * The row walk here is an INSTRUMENTED copy of the parser's per-row
 * rules (src/linkedin-parser.ts collects the same ids and texts but
 * flattens the rows and swallows the $-ref drops silently). The
 * parser is frozen (the design's Not Building list), and Cause B is
 * exactly the drops the parser hides — so this walk records them.
 * The cross-check suite pins these tallies to collectLinkedInPosts
 * on the same bodies: drift between the two walks fails a test
 * instead of shipping wrong evidence.
 *
 * Shape: the probe-linkedin idiom (design D2) — exported runReplay +
 * ReplayDeps (gate failures THROW, the caller owns the exit), one
 * tagged local gate (zero argv), entry-guarded main whose wrapper
 * prints the usage line bare and wraps every other failure as
 * `replay: FAILED — <message>` + exit 1.
 *
 * Usage: npx tsx scripts/replay-linkedin.ts <capture.json> [more.json ...]
 *   (captures roll off after ~20 sessions — one working day; copy captures/
 *   out first — CAPTURE_KEEP_SESSIONS, src/linkedin-capture.ts)
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CAPTURE_SCHEMA_VERSION, type CaptureRecord } from "../src/linkedin-capture.js";
import { collectLinkedInPosts, parseFlightRows } from "../src/linkedin-parser.js";

/**
 * The usage line — the zero-argv gate's message, printed bare by the CLI
 * wrapper. Carries the retention window (CAPTURE_KEEP_SESSIONS,
 * src/linkedin-capture.ts): evidence rolls off after ~20 sessions — one
 * working day at the loop cadence — so replay promptly or copy captures/
 * out first (the operator-visible half of D8; a silent roll-off would
 * void the capture premise on D4's slower clock).
 */
const USAGE =
  "replay: usage — npx tsx scripts/replay-linkedin.ts <capture.json> [more.json ...]" +
  " — captures roll off after ~20 sessions (one working day); copy captures/ out first";

// --- the tagged zero-argv gate (the probeFloor idiom: name constant +
//     factory + guard), local to this file because only the replay
//     defines this failure mode ---

export const REPLAY_NO_INPUT = "ReplayNoInputError";

/** Thrown when runReplay receives no capture path. */
export interface ReplayNoInput extends Error {
  name: string;
}

export function replayNoInput(): ReplayNoInput {
  const error = new Error(USAGE) as ReplayNoInput;
  error.name = REPLAY_NO_INPUT;
  return error;
}

export function isReplayNoInput(error: unknown): error is ReplayNoInput {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === REPLAY_NO_INPUT
  );
}

// Frozen copies of the parser's private shapes (src/linkedin-parser.ts
// is out of scope by design): the $-ref forms and the urn forms. The
// cross-check suite pins this walk's tallies to collectLinkedInPosts,
// so drift here fails a test instead of shipping wrong evidence.
const WHOLE_REF_RE = /^\$L?([0-9a-f]+)$/;
const PATH_REF_RE = /^\$L?([0-9a-f]+):(.+)$/;
const URN_RE = /^urn:li:activity:(\d{10,})$/;
const DIGITS_RE = /^\d{10,}$/;

/** $-refs the instrumented text walk dropped during one text harvest. */
interface TextDrops {
  /** Whole-ref to a row the stream never carried. */
  missing: number;
  /** Whole-ref to a row an earlier ref in THIS harvest already consumed. */
  seen: number;
  /** Path-ref that resolved to nothing (missing row or dead path). */
  pathMiss: number;
}

/** Per-root-row census facts — one row line of the replay table. */
export interface RowCensus {
  /** The flight row id (hex key). */
  hex: string;
  /** Stream position of the row. */
  index: number;
  /** Distinct ids in first-appearance order (the parser's rule). */
  ids: string[];
  /** Commentary texts harvested (before the longest-wins pick). */
  textCount: number;
  /** The row's longest commentary text; null when none harvested. */
  bestText: string | null;
  /** Carries at least one commentary_text view marker (BFS start set). */
  hasMarker: boolean;
  /** Every viewTrackingSpecs shape seen in this row ("viewName/control"). */
  markerShapes: string[];
  /** What the incumbent zip did with this row's text; null when no text. */
  disposition: string | null;
  /** Junk-cause signal for the row's text; null when it looks clean. */
  cause: string | null;
}

/** The analysis of one capture body — the facts behind the printed lines. */
export interface BodyAnalysis {
  ordinal: number;
  rootRows: number;
  distinctTexts: number;
  distinctIds: number;
  rows: RowCensus[];
  /** Rows carrying at least one commentary marker. */
  markerRowCount: number;
  /** Rows carrying at least one id. */
  idRowCount: number;
  /** Distinct id rows reachable from the marker rows (forward BFS). */
  forwardReached: number;
  /** Distinct marker rows reachable from the id rows (reverse BFS). */
  reverseReached: number;
  /** contentTrackingId grouping: distinct values, largest group size. */
  tracking: { values: number; largest: number };
  /** marker→id stream distance histogram. */
  adjacency: { within1: number; at2: number; further: number };
  /** Marker taxonomy: shape → marker count, in stream order. */
  markerTally: Map<string, number>;
  /** Rows with ids but no text harvest (the skip share). */
  idsOnly: number;
  /** Either BFS direction reached across — the Option-A promotion condition. */
  joinCandidate: boolean;
}

/** "viewName/legacyControlName" for one viewTrackingSpecs record; "-" for an absent name. */
function specShape(specs: Record<string, unknown>): string {
  const viewName = typeof specs.viewName === "string" ? specs.viewName : "-";
  const control = typeof specs.legacyControlName === "string" ? specs.legacyControlName : "-";
  return `${viewName}/${control}`;
}

/** The CTA text shapes from the census prior: bare URL, bare email, lone hashtag. */
function ctaShape(text: string): string | null {
  if (/^https?:\/\/\S+$/.test(text)) return "bare URL";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "bare email";
  if (/^#[A-Za-z0-9_-]+$/.test(text)) return "lone hashtag";
  return null;
}

/**
 * The junk-cause signal for one row (evidence, never a verdict).
 * CTA-suspect: the marker specs are byte-identical between CTA
 * components and real posts, so only the text shape can name Cause A.
 * Shrink-suspect / text lost: the $-refs the instrumented walk had to
 * drop name Cause B (the parser's silent branches).
 */
function junkCause(bestText: string | null, drops: TextDrops): string | null {
  const dropped = drops.missing + drops.seen + drops.pathMiss;
  if (bestText !== null) {
    const causes: string[] = [];
    const cta = ctaShape(bestText);
    if (cta !== null) causes.push(`cta-suspect (${cta})`);
    if (dropped > 0) causes.push(`shrink-suspect (${dropped} dropped $-ref(s))`);
    return causes.length > 0 ? causes.join(" + ") : null;
  }
  return dropped > 0 ? `lost (shrink: ${dropped} dropped $-ref(s))` : null;
}

/**
 * The parser's text walk (textFromChildren), copied rule for rule with
 * one addition: every silent drop site counts into `drops` — the whole-
 * ref to a missing row, the whole-ref to a row this harvest already
 * consumed, the path-ref that resolved to nothing. Those drops are
 * Cause B ($-ref shrink); the parser hides them, the replay names them.
 */
function textFromChildrenInstrumented(
  children: unknown,
  rows: Map<string, unknown>,
  drops: TextDrops,
): string {
  const parts: string[] = [];
  const seenRows = new Set<string>();
  const memo = new Map<string, unknown>();
  const resolve = (id: string, path: string): unknown => {
    const root: unknown = rows.get(id);
    if (root === undefined) return undefined;
    const key = `${id}:${path}`;
    const cached: unknown = memo.get(key);
    if (cached !== undefined) return cached;
    let current: unknown = root;
    for (const segment of path.split(":")) {
      if (current === null || typeof current !== "object") return undefined;
      current = Array.isArray(current)
        ? current[Number(segment)]
        : (current as Record<string, unknown>)[segment];
      if (current === undefined) return undefined;
    }
    memo.set(key, current);
    return current;
  };
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      const whole = WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (!rows.has(id)) {
          drops.missing += 1;
          return;
        }
        if (seenRows.has(id)) {
          drops.seen += 1;
          return;
        }
        seenRows.add(id);
        walk(rows.get(id));
        return;
      }
      const scoped = PATH_REF_RE.exec(node);
      if (scoped !== null) {
        const resolved = resolve(scoped[1] ?? "", scoped[2] ?? "");
        if (resolved === undefined) drops.pathMiss += 1;
        walk(resolved);
        return;
      }
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 0 && node[0] === "$") {
        if (node[1] === "br") {
          parts.push("\n");

[1244 more lines in file. Use offset=1200 to continue.]
          return;
        }
        const props: unknown = node[3];
        if (props !== null && typeof props === "object" && !Array.isArray(props)) {
          const record = props as Record<string, unknown>;
          if (record.children !== undefined) walk(record.children);
          if (record.textProps !== undefined) walk(record.textProps);
        }
        return;
      }
      for (const child of node) walk(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.children !== undefined) walk(record.children);
  };
  walk(children);
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every $-ref target one row's subtree points at (whole and path forms). */
function refTargets(payload: unknown, rows: Map<string, unknown>, into: Set<string>): void {
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const whole = WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id = whole[1] ?? "";
        if (rows.has(id)) into.add(id);
        return;
      }
      const scoped = PATH_REF_RE.exec(node);
      if (scoped !== null) {
        const id = scoped[1] ?? "";
        if (rows.has(id)) into.add(id);
        return;
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const value of Object.values(node as Record<string, unknown>)) visit(value);
  };
  visit(payload);
}

/** contentTrackingId values in one row's subtree (the shared list-level value). */
function collectTrackingIds(payload: unknown, into: Set<string>): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const value = record.contentTrackingId;
    if (typeof value === "string" && value.length > 0) into.add(value);
    for (const child of Object.values(record)) visit(child);
  };
  visit(payload);
}

/**
 * BFS over row-to-row ref edges; counts DISTINCT target-set rows newly
 * reached. Start rows sit in the visited set from the beginning, so a
 * start never counts as its own discovery.
 */
function reachableCount(
  starts: Set<string>,
  edges: Map<string, Set<string>>,
  targets: Set<string>,
): number {
  const visited = new Set(starts);
  const queue = [...starts];
  let hits = 0;
  while (queue.length > 0) {
    const hex = queue.shift();
    if (hex === undefined) break;
    for (const next of edges.get(hex) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      if (targets.has(next)) hits += 1;
      queue.push(next);
    }
  }
  return hits;
}

/**
 * The instrumented per-row walk: the parser's collectLinkedInPosts row
 * rules with the drops counted and the shapes named. Urn strings,
 * activityId digit fields, urn object keys; a commentary_text marker
 * harvests its text and RETURNS (its subtree carries no ids); every
 * other viewTrackingSpecs shape is recorded for the taxonomy and
 * recursed (the parser ignores it silently).
 */
function collectRowCensus(
  hex: string,
  index: number,
  payload: unknown,
  rows: Map<string, unknown>,
  zipByText: Map<string, string>,
): RowCensus {
  const ids = new Set<string>();
  const rowTexts: string[] = [];
  const markerShapes: string[] = [];
  let hasMarker = false;
  const drops: TextDrops = { missing: 0, seen: 0, pathMiss: 0 };
  const seenRows = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const urn = URN_RE.exec(node);
      if (urn !== null) {
        ids.add(urn[1] ?? "");
        return;
      }
      const whole = WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id = whole[1] ?? "";
        if (rows.has(id) && !seenRows.has(id)) {
          seenRows.add(id);
          visit(rows.get(id));
        }
        return;
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const activityId: unknown = record.activityId;
    if (typeof activityId === "string" && DIGITS_RE.test(activityId)) ids.add(activityId);
    const specs: unknown = record.viewTrackingSpecs;
    if (specs !== null && typeof specs === "object") {
      const specRecord = specs as Record<string, unknown>;
      markerShapes.push(specShape(specRecord));
      if (specRecord.legacyControlName === "commentary_text") {
        hasMarker = true;
        const text = textFromChildrenInstrumented(record.children, rows, drops);
        if (text.length > 0) rowTexts.push(text);
        return; // the commentary subtree is text; it carries no ids
      }
    }
    for (const key of Object.keys(record)) {
      const urnKey = URN_RE.exec(key);
      if (urnKey !== null) ids.add(urnKey[1] ?? "");
    }
    for (const key of Object.keys(record)) visit(record[key]);
  };
  visit(payload);
  const bestText =
    rowTexts.length > 0 ? rowTexts.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  let disposition: string | null = null;
  if (bestText !== null) {
    const paired = zipByText.get(bestText);
    disposition = paired === undefined ? "zip-unlinked" : `zip-paired ↔ ${paired.slice(-6)}`;
  }
  return {
    hex,
    index,
    ids: [...ids],
    textCount: rowTexts.length,
    bestText,
    hasMarker,
    markerShapes,
    disposition,
    cause: junkCause(bestText, drops),
  };
}

/**
 * Analyze one capture body: the per-row census, the six-point probe
 * (forward + reverse BFS, contentTrackingId grouping, adjacency,
 * marker taxonomy), and the incumbent zip's disposition per row.
 * Pure over the record's body — the only log line is the parser's own
 * pairing oracle, which rides along as extra evidence.
 */
export function analyzeBody(record: CaptureRecord): BodyAnalysis {
  const rows = parseFlightRows(record.body);
  const entries = [...rows.entries()];
  // The incumbent zip's own output: which text got paired with which
  // id. A paired urn is the pairing's CHOICE, never a proven
  // association (the parser's header says why).
  const zipByText = new Map<string, string>();
  for (const post of collectLinkedInPosts(record.body)) {
    zipByText.set(post.text, post.id);
  }
  const rowsCensus = entries.map(([hex, payload], index) =>
    collectRowCensus(hex, index, payload, rows, zipByText),
  );
  const distinctIds = new Set<string>();
  const distinctTexts = new Set<string>();
  const markerTally = new Map<string, number>();
  let markerRowCount = 0;
  let idRowCount = 0;
  let idsOnly = 0;
  for (const row of rowsCensus) {
    for (const id of row.ids) distinctIds.add(id);
    if (row.bestText !== null) distinctTexts.add(row.bestText);
    if (row.ids.length > 0) idRowCount += 1;
    if (row.ids.length > 0 && row.textCount === 0) idsOnly += 1;
    if (!row.hasMarker) continue;
    markerRowCount += 1;
    for (const shape of row.markerShapes) {
      markerTally.set(shape, (markerTally.get(shape) ?? 0) + 1);
    }
  }
  const markerHexes = new Set(rowsCensus.filter((row) => row.hasMarker).map((row) => row.hex));
  const idHexes = new Set(rowsCensus.filter((row) => row.ids.length > 0).map((row) => row.hex));
  // Six-point probe, arms 1-2: the $-ref graph in both directions. A
  // hit in either arm is the Option-A promotion condition; zero in
  // both is the committed census's answer re-measured on fresh bodies.
  const refs = new Map<string, Set<string>>();
  for (const [hex, payload] of entries) {
    const targets = new Set<string>();
    refTargets(payload, rows, targets);
    refs.set(hex, targets);
  }
  const forwardReached = reachableCount(markerHexes, refs, idHexes);
  const reverse = new Map<string, Set<string>>();
  for (const [hex, targets] of refs) {
    for (const target of targets) {
      const sources = reverse.get(target) ?? new Set<string>();
      sources.add(hex);
      reverse.set(target, sources);
    }
  }
  const reverseReached = reachableCount(idHexes, reverse, markerHexes);
  // Arm 3 — contentTrackingId grouping (the shared list-level value).
  const trackingCounts = new Map<string, number>();
  for (const [, payload] of entries) {
    const values = new Set<string>();
    collectTrackingIds(payload, values);
    for (const value of values) {
      trackingCounts.set(value, (trackingCounts.get(value) ?? 0) + 1);
    }
  }
  const tracking = {
    values: trackingCounts.size,
    largest: trackingCounts.size > 0 ? Math.max(...trackingCounts.values()) : 0,
  };
  // Arm 4 — adjacency: stream distance from every marker row to the
  // nearest id row (the split-card capture shape sits at distance 1).
  const adjacency = { within1: 0, at2: 0, further: 0 };
  for (const marker of rowsCensus) {
    if (!marker.hasMarker) continue;
    let nearest = Number.POSITIVE_INFINITY;
    for (const row of rowsCensus) {
      if (row.ids.length === 0) continue;
      nearest = Math.min(nearest, Math.abs(row.index - marker.index));
    }
    if (nearest <= 1) adjacency.within1 += 1;
    else if (nearest === 2) adjacency.at2 += 1;
    else adjacency.further += 1;
  }
  return {
    ordinal: record.ordinal,
    rootRows: rowsCensus.length,
    distinctTexts: distinctTexts.size,
    distinctIds: distinctIds.size,
    rows: rowsCensus,
    markerRowCount,
    idRowCount,
    forwardReached,
    reverseReached,
    tracking,
    adjacency,
    markerTally,
    idsOnly,
    joinCandidate: forwardReached > 0 || reverseReached > 0,
  };
}

function rowClassification(row: RowCensus): string {
  if (row.ids.length > 0 && row.textCount > 0) return "BOTH";
  if (row.ids.length > 0) return "IDS-ONLY";
  if (row.textCount > 0) return "TEXTS-ONLY";
  return "EMPTY";
}

function rowLine(row: RowCensus): string {
  let note: string;
  if (row.disposition !== null) {
    note = ` (${row.disposition})`;
  } else if (row.ids.length > 0) {
    note = " (no text harvest)";
  } else {
    note = " (empty row)";
  }
  const cause = row.cause === null ? "" : ` — text ${row.cause}`;
  return `replay: row ${row.hex} — ids=${row.ids.length} texts=${row.textCount} — ${rowClassification(row)}${note}${cause}`;
}

function probeLine(analysis: BodyAnalysis): string {
  return (
    `replay: probe — forwardBFS from ${analysis.markerRowCount} marker row(s): ` +
    `${analysis.forwardReached} id row(s) reached; reverse from ${analysis.idRowCount} id row(s): ` +
    `${analysis.reverseReached} marker row(s) reached`
  );
}

function trackingLine(analysis: BodyAnalysis): string {
  if (analysis.tracking.values === 0) return "replay: tracking — no contentTrackingId found";
  const listLevel =
    analysis.tracking.values === 1 && analysis.tracking.largest === analysis.rootRows;
  const suffix = listLevel ? " (list-level)" : "";
  return (
    `replay: tracking — ${analysis.tracking.values} value(s); ` +
    `largest group ${analysis.tracking.largest} of ${analysis.rootRows} row(s)${suffix}`
  );
}

function markersLine(analysis: BodyAnalysis): string {
  if (analysis.markerTally.size === 0) return "replay: markers — none";
  const parts = [...analysis.markerTally.entries()].map(([shape, count]) => `${shape}: ${count}`);
  return `replay: markers — ${parts.join(", ")}`;
}

function verdictLine(analysis: BodyAnalysis): string {
  if (!analysis.joinCandidate) {
    return `replay: verdict — no card-scoped join found; ${analysis.idsOnly}/${analysis.rootRows} row(s) skipped ids-only`;
  }
  return `replay: verdict — join CANDIDATE (forward ${analysis.forwardReached}, reverse ${analysis.reverseReached}) — the Option-A promotion condition is met; inspect the reachable rows before any pairing rule changes`;
}

/** Print one body's evidence block — every line under the `replay:` prefix. */
export function printBodyAnalysis(analysis: BodyAnalysis): void {
  console.log(
    `replay: body ${analysis.ordinal} — ${analysis.rootRows} root row(s), ${analysis.distinctTexts} distinct text(s), ${analysis.distinctIds} distinct id(s)`,
  );
  for (const row of analysis.rows) console.log(rowLine(row));
  console.log(probeLine(analysis));
  console.log(trackingLine(analysis));
  console.log(
    `replay: adjacency — marker→id distance within 1: ${analysis.adjacency.within1}, at 2: ${analysis.adjacency.at2}, further: ${analysis.adjacency.further}`,
  );
  console.log(markersLine(analysis));
  console.log(verdictLine(analysis));
}

function isCaptureRecord(value: unknown): value is CaptureRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<CaptureRecord>;
  return (
    typeof record.schemaVersion === "number" &&
    typeof record.capturedAt === "string" &&
    typeof record.label === "string" &&
    typeof record.ordinal === "number" &&
    typeof record.received === "number" &&
    typeof record.url === "string" &&
    typeof record.status === "number" &&
    typeof record.matched === "boolean" &&
    typeof record.body === "string"
  );
}

/** Read + validate one capture file. Every failure THROWS — the wrapper wraps it as FAILED. */
async function readCapture(
  path: string,
  readText: (path: string) => Promise<string>,
): Promise<CaptureRecord> {
  const parsed: unknown = JSON.parse(await readText(path));
  if (!isCaptureRecord(parsed)) {
    throw new Error(
      `replay: ${path} — not a CaptureRecord envelope (schemaVersion/capturedAt/label/ordinal/received/url/status/matched/body)`,
    );
  }
  if (parsed.schemaVersion !== CAPTURE_SCHEMA_VERSION) {
    throw new Error(
      `replay: ${path} — capture schemaVersion ${String(parsed.schemaVersion)}, this replay reads version ${CAPTURE_SCHEMA_VERSION}`,
    );
  }
  return parsed;
}

export interface ReplayDeps {
  /** Capture file paths to replay, in input order. Default: process.argv.slice(2). */
  argv?: readonly string[];
  /** Reads one capture file. Default: readFile(path, "utf8"). */
  readText?: (path: string) => Promise<string>;
}

export interface ReplayResult {
  /** One analysis per input file, in input order. */
  reports: BodyAnalysis[];
}

/**
 * Run the replay over one or more capture files: read, validate,
 * analyze, print each body's evidence block, and resolve with the
 * per-body analyses. Gate failures THROW (the fetchTick model): the

[844 more lines in file. Use offset=1600 to continue.]
 * zero-argv gate is tagged, every read/parse/shape failure keeps its
 * own message for the FAILED wrapper.
 */
export async function runReplay(deps: ReplayDeps = {}): Promise<ReplayResult> {
  const argv = deps.argv ?? process.argv.slice(2);
  if (argv.length === 0) throw replayNoInput();
  const readText = deps.readText ?? (async (path: string) => readFile(path, "utf8"));
  const reports: BodyAnalysis[] = [];
  for (const path of argv) {
    const analysis = analyzeBody(await readCapture(path, readText));
    printBodyAnalysis(analysis);
    reports.push(analysis);
  }
  return { reports };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The CLI contract: the usage line bare on zero argv, every other
  // failure wrapped as `replay: FAILED — <message>`, exit 1 either way.
  runReplay().catch((error: unknown) => {
    if (isReplayNoInput(error)) {
      console.error(error.message);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`replay: FAILED — ${message}`);
    process.exit(1);
  });
}
```

#### tests/replay-linkedin.test.ts — NEW

The black-box suite: entry-guard import pin, the envelope gates, exact per-row census/junk-cause/probe/verdict line pins on synthetic parser-fixture captures, the frozen-parser cross-check, multi-file order.

```ts
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
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint` (Slice 4 adds scripts/replay-linkedin.ts to package.json's explicit lists; until then the file's scoped gate is `npx biome check scripts/replay-linkedin.ts tests/replay-linkedin.test.ts` — clean, biome-canonical bytes)
- [x] Tests pass: `npm test` (13 new replay cases green alongside the existing suites)
- [x] Entry guard: importing scripts/replay-linkedin.ts stays side-effect free (the suite's import IS the pin)
- [x] Gates: zero argv throws the tagged ReplayNoInputError carrying the `replay: usage —` line; an unreadable path rejects with the raw fs error the CLI wrapper prints as `replay: FAILED —` + exit 1; a non-envelope JSON file and a schemaVersion ≠ 1 capture both reject naming the path
- [x] The usage line (and the module doc) names the retention window: ~20 sessions / one working day; copy captures/ out first — the operator-visible half of D8
- [x] Census pins on the mixed synthetic body (parser-fixture shapes + a merged BOTH card): exact per-row lines — BOTH (zip-paired ↔ urn tail), IDS-ONLY (no text harvest), TEXTS-ONLY (zip-paired), a chip row with texts=2; header `5 root row(s), 3 distinct text(s), 4 distinct id(s)`; adjacency `within 1: 3, at 2: 0, further: 0`; taxonomy `feed-commentary/commentary_text: 4`; verdict `no card-scoped join found; 2/5 row(s) skipped ids-only`
- [x] Junk causes: a bare-URL BOTH row reads `— text cta-suspect (bare URL)`; a dropped path-ref reads `— text shrink-suspect (1 dropped $-ref(s))`; an empty harvest reads `— text lost (shrink: 1 dropped $-ref(s))`
- [x] Six-point probe pins: a marker row $-reffing an id row flips BOTH BFS arms to 1 and the verdict to `join CANDIDATE`; contentTrackingId lines pin the two-value shape and the `(list-level)` single-value shape; a non-commentary viewTrackingSpecs shape rides the taxonomy line
- [x] Cross-check: `Math.min(distinctIds, distinctTexts)` equals `collectLinkedInPosts(body).length` on the same body, and every zip-paired tail names a urn the parser minted
- [x] Multi-file: N paths replay in order, one analysis per file (reports.length === N)

#### Manual Verification:
- [ ] One live capture replayed: the BOTH/IDS-ONLY shares read against the committed census prior (design:170 — 3 both / 130 ids-only / 3 texts-only shape), and the verdict line states plainly whether the Option-A promotion condition fired

---

## Phase 4: PC wiring + repo plumbing

### Overview
Wires the production sink into `fetchTick` and `runProbe` (passing nothing means CAPTURE TO DISK), injects the in-memory recording double into the five body-firing script-suite cases, and lands the repo plumbing: package.json lint/format lists + the replay alias, and `.gitignore` `captures/` so `guardCheckout` stays green. The `.gitignore` entry must never be omitted while the sink default is live.

### Changes Required:

**Files**: `scripts/fetch-linkedin.ts`, `scripts/probe-linkedin.ts`, `package.json`, `.gitignore`, `tests/fetch-linkedin.test.ts`, `tests/probe-linkedin.test.ts`

#### scripts/fetch-linkedin.ts:85-131,~370-385 — MODIFY

FetchTickDeps gains the capture sink (production fs default); the walk call reaches the 9th arg with an explicit `undefined` in the `minClicks` slot.

```ts
// --- 1. the sink import ---
import { isWithinWorkingHours } from "../src/linkedin-behavior.js";
import { type CaptureSink, makeFsCaptureSink } from "../src/linkedin-capture.js";

// --- 2. FetchTickDeps.captureSink (after contextFactory) ---
  contextFactory?: LinkedInContextFactory;
  /**
   * Capture sink for the walk (capture-first, design 2026-11-13). Default:
   * the production fs sink — one atomic JSON file per intercepted body
   * under captures/<UTC session stamp>/ (LINKEDIN_CAPTURES_ROOT; gitignored
   * scratch, never committed state). Passing nothing means CAPTURE TO
   * DISK, not capture disabled: the offline suite injects a recording
   * sink in every walk-driving case, because npm test must never write
   * captures/ into the repo.
   */
  captureSink?: CaptureSink;


[444 more lines in file. Use offset=2000 to continue.]
// --- 3. the walk call gains the 9th arg (8th slot explicit undefined keeps minClicks defaulted) ---
    posts = await fetchLinkedInPosts(
      surfaces,
      LINKEDIN_PROFILE_DIR,
      deps.contextFactory,
      config.scrollRounds,
      undefined,
      now,
      rng,
      undefined, // default minClicks (0) — the tick has no probe-style click floor
      deps.captureSink ?? makeFsCaptureSink(),
    );
```

#### scripts/probe-linkedin.ts (ProbeDeps + runProbe sink default) — MODIFY

The probe gains the same sink default; the module doc's read-only claim is corrected to name the gitignored capture scratch as its one write (D5).

```ts
// --- 1. the module doc: the read-only sentence gains the capture exception ---
 * tagged leg-dead), every surface faulted, or fewer than 10 posts. The
 * probe writes no tracked state — no payload, no push, no latch, no
 * episode marker: it is a read-only diagnostic the fetch tick never
 * consults. Its ONE write is the capture harness's gitignored scratch
 * (captures/<UTC session stamp>/, design 2026-11-13): diagnostic evidence
 * replayed offline by scripts/replay-linkedin.ts, never committed.

// --- 2. the sink import ---
import { envWithDotEnv } from "../src/env-file.js";
import { type CaptureSink, makeFsCaptureSink } from "../src/linkedin-capture.js";

// --- 3. ProbeDeps.captureSink (after contextFactory) ---
  /** Browser-context factory. Default: the walk module's own production factory. */
  contextFactory?: LinkedInContextFactory;
  /**
   * Capture sink for the walk (capture-first, design 2026-11-13). Default:
   * the production fs sink under captures/<UTC session stamp>/ — gitignored
   * scratch (D5: the probe stays read-only for TRACKED state; the captures
   * are diagnostic evidence). Passing nothing means CAPTURE TO DISK: the
   * offline suite injects a recording sink in its walk-driving cases.
   */
  captureSink?: CaptureSink;

// --- 4. the walk call gains the 9th arg ---
  const posts = await fetchLinkedInPosts(
    [surface],
    LINKEDIN_PROFILE_DIR,
    deps.contextFactory,
    config.scrollRounds,
    undefined, // default sleep
    deps.now, // Date.now when unset — the exact production call shape
    undefined, // Math.random
    minClicks,
    deps.captureSink ?? makeFsCaptureSink(),
  );
```

#### package.json:13-20 — MODIFY

scripts/replay-linkedin.ts joins the explicit lint AND format lists; the replay alias joins the scripts block.

```json
  "lint": "biome check src tests scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/linkedin-chain.ts scripts/replay-linkedin.ts scripts/hooks",
  "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/linkedin-chain.ts scripts/replay-linkedin.ts",
  "fetch-linkedin": "tsx scripts/fetch-linkedin.ts",
  "watch-linkedin": "tsx scripts/watch-linkedin.ts",
  "probe-linkedin": "tsx scripts/probe-linkedin.ts",
  "login-linkedin": "tsx scripts/login-linkedin.ts",
  "reset-linkedin": "tsx scripts/reset-linkedin.ts",
  "linkedin-chain": "tsx scripts/linkedin-chain.ts",
  "replay-linkedin": "tsx scripts/replay-linkedin.ts",
```

#### .gitignore — MODIFY

The captures root joins the scratch family — guardCheckout's porcelain read stays empty once captures exist.

```text
slice*-recon/
captures/
linkedin-cookies*.json
```

#### tests/fetch-linkedin.test.ts (sink injections) — MODIFY

The ratified scope amendment: the tick's production-default sink would make `npm test` write `captures/`, so all three body-firing cases inject the in-memory recordingSink double; the end-to-end and fine-empty cases pin the pass-through.

```ts
// --- 1. the capture import ---
import { HALT_CHECKPOINT_REASON } from "../src/linkedin-behavior.js";
import type { CaptureRecord, CaptureSink } from "../src/linkedin-capture.js";
import { type LinkedInContextFactory, SCROLL_JS, isLegDead } from "../src/linkedin-fetch.js";

// --- 1b. the doctrine-oracle imports (merged into the existing lines) ---
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// --- 2. the recording sink double (after contextFactoryFor) ---
/**
 * Recording capture sink (capture-first, design 2026-11-13): the tick's
 * production default WRITES captures/ into the current directory, so every
 * walk-driving case injects this in-memory double — npm test touches OS
 * temp only, and the end-to-end cases pin the tick → walk pass-through on
 * the records.
 */
function recordingSink(): CaptureSink & { records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  const sink: CaptureSink = async (record) => {
    records.push(record);
  };
  return Object.assign(sink, { records });
}

// --- 3a. "composes the tick end to end": declare the double ---
    const closed = { value: false };
    const capture = recordingSink();

// --- 3b. "composes the tick end to end": the deps object gains the sink ---
    const result = await fetchTick({
      latchPath: await workPath("latch-1.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      captureSink: capture,
      payloadPath: payload,

// --- 3c. the pass-through pin (case tail) ---
    assert.ok(git.calls.some((args) => args[0] === "push"));
    // Capture-first (design 2026-11-13): the tick threads the sink into
    // the walk — one matched body fired, one record, arrival ordinal 1.
    assert.equal(capture.records.length, 1);
    assert.equal(capture.records[0]?.matched, true);
    assert.equal(capture.records[0]?.ordinal, 1);

// --- 4a. "still writes and pushes a fine-empty walk's payload": declare the double ---
    const contextFactory = contextFactoryFor({ script: { initialBody: EMPTY_BODY } });
    const capture = recordingSink();

// --- 4b. "still writes and pushes a fine-empty walk's payload": the deps object gains the sink ---
    const result = await fetchTick({
      latchPath: await workPath("latch-4.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      captureSink: capture,
      payloadPath: payload,

// --- 4c. the 0-post capture pin (case tail) ---
    assert.ok(git.calls.some((args) => args[0] === "push"));
    // Even a 0-post body is evidence: the matched arm captured it.
    assert.equal(capture.records.length, 1);

// --- 5a. "threads config.scrollRounds into the walk": declare the double ---
    const capture = recordingSink();
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });

// --- 5b. the deps object gains the sink ---
      contextFactory,
      captureSink: capture,
      git,

// --- 6. the absence oracle: snapshotted before, asserted after ---
const repoCaptures = join(dirname(fileURLToPath(import.meta.url)), "..", "captures");
const repoCapturesBefore = await access(repoCaptures).then(
  () => true,
  () => false,
);

after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  // The capture doctrine's absence oracle (design 2026-11-13): a FRESH
  // captures/ directory at the repo root means a body-firing case above
  // skipped its sink injection. A directory that already existed (a live
  // operator run) is not this suite's problem.
  if (!repoCapturesBefore) {
    await assert.rejects(() => access(repoCaptures), /ENOENT/);
  }
});
```

#### tests/probe-linkedin.test.ts (sink injections) — MODIFY

The ratified scope amendment: the two body-firing probe cases inject the recordingSink double; the pass-path pins the probe → walk pass-through.

```ts
// --- 1. the capture import ---
import { HALT_CHECKPOINT_REASON } from "../src/linkedin-behavior.js";
import type { CaptureRecord, CaptureSink } from "../src/linkedin-capture.js";
import {
  LINKEDIN_PROFILE_DIR,

// --- 1b. the doctrine-oracle imports (merged into the existing lines) ---
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// --- 2. the recording sink double (after contextFactoryFor) ---
/**
 * Recording capture sink (capture-first, design 2026-11-13): the probe's
 * production default WRITES captures/ into the current directory, so the
 * walk-driving cases inject this in-memory double — npm test touches OS
 * temp only, and the pass-path pins the probe → walk pass-through.
 */
function recordingSink(): CaptureSink & { records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  const sink: CaptureSink = async (record) => {
    records.push(record);
  };
  return Object.assign(sink, { records });
}

// --- 3a. "walks the first configured surface …": declare the double + deps ---
    const capture = recordingSink();
    const result = await runProbe({
      config: CONFIG,
      env: await cookieEnv(),
      contextFactory,
      captureSink: capture,
      now: () => T0,
    });

// --- 3b. the pass-through pin (case tail) ---
    assert.ok(lines.some((line) => line === "probe: all checks passed"));
    // Capture-first (design 2026-11-13): the probe records the body it
    // walked — gitignored scratch, the replay's input.
    assert.equal(capture.records.length, 1);
    assert.equal(capture.records[0]?.matched, true);

// --- 4a. "throws the tagged floor gate on a short walk": declare the double ---
    const contextFactory = contextFactoryFor({ script: { initialBody: bodyMinting(4) } });
    const capture = recordingSink();

// --- 4b. the deps object gains the sink (10-space indent inside assert.rejects; the
//     bodyMinting(4) contextFactoryFor line anchors this fence uniquely to the floor case) ---
    const contextFactory = contextFactoryFor({ script: { initialBody: bodyMinting(4) } });
    const capture = recordingSink();

          contextFactory,
          captureSink: capture,
          now: () => T0,

// --- 5. the absence oracle: snapshotted before, asserted after ---
const repoCaptures = join(dirname(fileURLToPath(import.meta.url)), "..", "captures");
const repoCapturesBefore = await access(repoCaptures).then(
  () => true,
  () => false,
);

after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  // The capture doctrine's absence oracle (design 2026-11-13): a FRESH
  // captures/ directory at the repo root means a body-firing case above
  // skipped its sink injection. A directory that already existed (a live
  // operator run) is not this suite's problem.
  if (!repoCapturesBefore) {
    await assert.rejects(() => access(repoCaptures), /ENOENT/);
  }
});
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint` (the new list includes `scripts/replay-linkedin.ts`)
- [x] Tests pass: `npm test` (616 tests — the plan's recon-tree count was 612; four walk-capture pins land with the bolt-in)
- [x] `fetchTick`/`runProbe` default to the production fs sink: `deps.captureSink ?? makeFsCaptureSink()` at both walk call sites, with an explicit `undefined` in the 8th (`minClicks`) slot
- [x] The five body-firing script-suite cases inject recording sinks; all three walk-driving suites (walk, tick, probe) carry an in-file absence oracle (repo-root `captures/` snapshotted at load, asserted in after()) — a forgotten injection fails its own suite
- [x] `package.json` carries `replay-linkedin` in the `lint` list, the `format` list, and the scripts aliases
- [x] `.gitignore` contains `captures/`; `guardCheckout`'s porcelain check passes with captures present

#### Manual Verification:
- [ ] One live `npm run probe-linkedin` writes `captures/<stamp>/001-<slug>.json`; `npx tsx scripts/replay-linkedin.ts captures/<stamp>/*.json` prints the census
- [ ] `npm run fetch-linkedin` on a clean dedicated clone of main: `guardCheckout` passes with the gitignored `captures/` present, the payload push still lands

---

## Testing Strategy

### Automated:
- Each phase's own Automated Verification block runs the repo gates: `npm run typecheck`, `npm run lint`, `npm test` (read-only, repo-wide; every phase must leave the tree green).
- Whole-plan gate after all four phases land: `npm run typecheck && npm run lint && npm test` — the design's recon tree measured 612/612 tests green at these exact fences.

### Manual Testing Steps:
1. One live `npm run probe-linkedin` walk writes `captures/<stamp>/` with one file per response body.
2. `npx tsx scripts/replay-linkedin.ts captures/<stamp>/*.json` prints the census; the verdict line names the join question for the mint-path design.
3. `npm run fetch-linkedin` on the dedicated clone: `guardCheckout` passes with the gitignored `captures/` present, and the payload push still lands.

## Performance Considerations

## Performance Considerations

Capture adds one fs write per response body (bodies up to hundreds of KB, ~10-30 per walk) — fire-and-forget, never awaited by the walk; the ordinal increments synchronously in the listener. No pacing impact; no new runtime dependency (`node:fs/promises` + `node:path` only). Replay is offline, whole-file reads, pure string analysis over the existing parser primitives. The retention prune (follow-up) rides the write path best-effort — one readdir + sort + bounded rm per capture, never awaited by the walk.

## Migration Notes

## Migration Notes

No persisted schema. `captures/` is untracked scratch WITH a retention rule: the sink prunes session stamps beyond the newest 20 after each write (`CAPTURE_KEEP_SESSIONS`, best-effort — a failed prune never fails a capture), bounding the gated tick cadence (~24-28 walks per weekday at 2-6 MB per walk) to roughly one working day of evidence instead of 1-3 GB/month. The window is OPERATOR-VISIBLE: scripts/replay-linkedin.ts's usage line names it — replay within ~20 sessions (one working day at the 28-33-minute loop cadence) or copy captures/ out first, or the evidence the mint-path design needs rolls off (the R4 premise). `PAYLOAD_VERSION` untouched. Rollback = drop the sink args from the two scripts.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 2 §2 (tests/linkedin-fetch.test.ts) | tests/linkedin-fetch.test.ts:101 | blocker | actionability | Fence #2 announces "the >80-char unmatched URL constant (112-108)" but emits NO code, while fence #4 references `LONG_FLAGSHIP_URL` twice (`url: () => LONG_FLAGSHIP_URL` and `assert.equal(noise500?.url, LONG_FLAGSHIP_URL)`) and no such constant exists anywhere at HEAD — `npm run typecheck` fails with "Cannot find name 'LONG_FLAGSHIP_URL'" (repo-wide grep finds it only in the design/plan artifacts; the defect roots in the design's identically empty fence at design:746-747, so the patch belongs upstream in the design) | Add the missing fence content upstream in the design and pass it through: define `const LONG_FLAGSHIP_URL = "<flagship-web URL >80 chars>"` alongside FLAGSHIP_SEARCH_URL so fence #4's two references resolve | applied (plan-local; design follow-up: design's identically empty fence — LONG_FLAGSHIP_URL now defined in Phase 2 fence 2, rsc-action/component miss class verified against the live LINKEDIN_RESPONSE_RE, >80 chars) |
| code | Phase 2 §3 (tests/linkedin-fetch.test.ts) | <n/a> | blocker | code-quality | The `recordingSink` fence is truncated mid-body — it ends after the `throw new Error("disk full"); }` of the `failAfter` guard with no `records.push(record)`, no `return { sink, records };`, and no closing braces for the `sink` arrow or the function, so pasting it verbatim is a syntax error, and even brace-completed it never stores a record, failing every record-based pin in fence #4 (e.g. `records.length === 4`); the defect roots in the design's identically truncated fence (design:754-760), so the patch belongs upstream in the design | Complete the double upstream in the design and pass it through: `records.push(record);` after the guard, then `return Object.assign(sink, { records });` with all braces closed | applied (plan-local; design follow-up: design's identically truncated fence — completed with records.push + return { sink, records } per the design's own Phase 4 canonical double) |
| code | Phase 2 §5 (tests/linkedin-fetch.test.ts) | tests/linkedin-fetch.test.ts:26 | concern | actionability | The absence-oracle fence references `access`, `join`, `dirname`, `fileURLToPath`, and `after`, but the phase's only import fence (#1) adds just the capture import — the walk suite at HEAD has no `node:fs/promises`/`node:path`/`node:url` imports and imports only `{ describe, it }` from node:test, and the required merges exist solely as prose inside the fence comment ("The imports gain access…"), unlike Phase 4 which emits them as concrete fence 1b lines | Emit the merged import lines as a fence (mirroring Phase 4's fence 1b): `import { access } from "node:fs/promises"`, `import { dirname, join } from "node:path"`, `import { fileURLToPath } from "node:url"`, and `after` added to the node:test import | applied: concrete 1b fence emitted (access / dirname+join / fileURLToPath; `after` joining node:test named in the fence comment) |
| code | Phase 4 §4 (tests/probe-linkedin.test.ts) | tests/probe-linkedin.test.ts:263-336 | suggestion | actionability | Fence 4b's two-line anchor `contextFactory,` / `now: () => T0,` at 10-space indent matches five runProbe cases at HEAD (floor 263, halt 287, leg-dead 302, all-faulted 317, zero-surfaces 335), so only fence 4a's case name disambiguates the injection target | Include one unique neighboring line from the floor case (e.g. `contextFactoryFor({ script: { initialBody: bodyMinting(4) } })`) in the 4b fence to make the anchor single-match | applied: 4b fence carries the bodyMinting(4) contextFactoryFor anchor line — single-match against the live floor case |
| code | Phase 2 §3 (src/linkedin-fetch.ts) | src/linkedin-fetch.ts:461 | suggestion | actionability | The src fence-header line refs ("(466-476)", "(757)", "(797-806)", etc.) match no HEAD positions — walkLinkedInSurface is at 461, `minClicks = 0` at 686, the sole call site at 722 — they silently assume all earlier fences in the block are already applied (cumulative positions), unlike Phase 4 whose refs ("85-131", "~370-385") are HEAD-accurate | Annotate the Phase 2 src-fence refs as post-application positions within the phase (or restate them against HEAD) so an implementer navigating by line numbers lands correctly | applied: post-application line-ref note added atop the Phase 2 src block (HEAD positions named) |
| coverage | ## Desired End State §1 | <n/a> | suggestion | verification-coverage | Design ## Desired End State probe→replay evidence loop lands in Testing Strategy Manual steps 1-2 and Phase 4 Manual bullet 1, but the plan's copied sample block is stale against the plan's own emitted Phase 1/Phase 3 code (intent originates at design ## Desired End State): it shows `captures/20261113T042435Z/1-linkedin-hiring-indonesia.json` (unpadded ordinal) and `replay: row 3 — ... — BOTH (mint candidate)` / `3 text(s)`, while the sink fences emit zero-padded `001-` filenames and the replay code prints the Slice-3-ratified `BOTH (zip-paired ↔ <urn tail>)` vocabulary and `N distinct text(s)` header — an operator running the manual rehearsal against this template reads a false mismatch (criteria path otherwise FOUND; code mirrors FOUND and correct) | Update the plan's Desired End State sample block to the emitted line shapes (`001-linkedin-hiring-indonesia.json`, `— BOTH (zip-paired ↔ <tail>)`, `N distinct text(s)`) so the manual probe→replay evidence rehearsal compares against real output | applied: sample block updated to emitted shapes (001- slug-stripped filename, zip-paired vocabulary, distinct counts, row(s) units); design's identical block flagged as upstream follow-up |

## Developer Context

Step 4 completed with both reviewers (code + coverage): 6 findings (2 blockers, 1 concern, 3 suggestions), all triaged APPLIED at Step 5. Both blockers root in the design's truncated Phase 2 fences and were fixed plan-local with upstream follow-ups recorded in the Plan Review resolutions.

## References

- Design: `.rpiv/artifacts/designs/2026-11-13_11-24-35_linkedin-post-link-pairing.md`
- Upstream solution: `.rpiv/artifacts/solutions/2026-11-13_10-20-27_linkedin-post-link-pairing.md`
- Chained research: `.rpiv/artifacts/research/2026-11-13_09-34-22_linkedin-post-link-pairing.md`
- Census prior (previous design): `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md`
- Log-line taxonomy lesson (previous plan): `.rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md`
