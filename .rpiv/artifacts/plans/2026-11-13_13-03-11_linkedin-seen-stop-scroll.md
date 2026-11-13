---
date: 2026-11-13T13:03:11+0700
author: Yogiswara Utama
commit: 33e17dc
branch: main
repository: loker-watcher
topic: "LinkedIn walk seen-stop"
tags: [plan, linkedin-fetch, state, fetch-linkedin]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-13_10-27-17_linkedin-seen-stop-scroll.md"
phase_count: 3
phases:
  - { n: 1, title: "seen-set reader (foundation)", files: [src/state.ts, tests/state.test.ts], depends_on: [] }
  - { n: 2, title: "the walk counts seen streaks and stops", files: [src/linkedin-fetch.ts, tests/linkedin-fetch.test.ts], depends_on: [] }
  - { n: 3, title: "tick wiring (terminal)", files: [scripts/fetch-linkedin.ts, tests/fetch-linkedin.test.ts], depends_on: [1, 2] }
last_updated: 2026-11-13T13:18:09+0700
last_updated_by: Kailee (implement-session revise)
last_updated_note: "Phase 1 round-trip fence seeds an empty base state — the STATE fixture ids leaked into the seen set"
---

# LinkedIn walk seen-stop Implementation Plan

## Overview

The PC LinkedIn walk stops a surface early once it mints 3 consecutive first-wins inserts of post ids already recorded in state/seen-posts.json, logging a mandatory `fetch: <label> seen-stop: <id>` line. The tick reads the seen file once into a `ReadonlySet<string>` (new degrade-everything reader `readSeenIdSet` in src/state.ts) and passes it as a trailing slot-9 parameter of `fetchLinkedInPosts`; the probe keeps its byte-identical 8-argument call, so its exemption is structural (empty-set default). Fully-seen keywords stop before burning scroll rounds instead of exhausting all 50 (the reflog payload bursts 1195/2182/2207/1941/2243 posts are the receipt of that waste).

Design artifact: `.rpiv/artifacts/designs/2026-11-13_10-27-17_linkedin-seen-stop-scroll.md` (status: ready). Phase boundaries inherit its `## Slices` 1:1; Success Criteria pass through unchanged (slice-verifier-validated at design 6.2). Delivery is single-commit (the 93a3f38 pattern): slices are review units, not deploy units.

## Desired End State

A fully-seen keyword's tick log, after this design:

```
fetch: linkedin/loker linkedin terbaru 2026 liveness: 1 body(ies), 8 rendered post(s)
fetch: linkedin/loker linkedin terbaru 2026 dom probe (before scroll): {...}
fetch: linkedin/loker linkedin terbaru 2026 seen-stop: urn:li:activity:7351234567890123456
fetch: linkedin/loker linkedin terbaru 2026 OK — 8 post(s) from 1 response(s), 0 click(s) fired
```

The tick passes the set without any other change; the payload still carries the pre-stop mints; the hosted run dedupes them as today. A partially-seen keyword resets the streak on every fresh insert and walks exactly as before.

## What We're NOT Doing

- Hosted-chain changes (dedupe, recency, diffNewIds, payload envelope all untouched).
- Parser changes (stays pure and seen-blind).
- Probe behavior changes (structural exemption only).
- scripts/watch-linkedin.ts changes.
- A config or env knob for N; any new pruning of the seen file; per-keyword seen tracking.

## Phase 1: seen-set reader (foundation)

### Overview
Delivers the degrade-everything `readSeenIdSet` reader (full-history id set; warn-exactly-once on absent, malformed, or wrong-shape; no recency argument) plus its offline battery.

Parallelism: Independent of Phase 2 (no shared files, no import) — can run in parallel per the design's Ordering Constraints.

### Changes Required:

#### 1. seen-set reader
**File**: `src/state.ts`
**Changes**: readSeenIdSet degrade-everything reader

### src/state.ts — MODIFY (new export readSeenIdSet after loadState :139-158; add `stat` to the node:fs/promises import)

```typescript
// import line (:7) — add stat to the existing node:fs/promises import:
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";

// new export — placed directly after loadState (:139-158):
/**
 * Read the full-history seen-id set for the PC walk's seen-stop (design
 * 2026-11-13): every key of seenPostIds, unpruned — a pruned id is
 * recency-ineligible hosted-side anyway, so the stop fires earliest with
 * no clock dependency. Degrade-everything (the loadAccountCeilings
 * posture, src/judge-ceilings.ts:93-121): an absent, unreadable, or
 * malformed file warns exactly once and yields an empty set — a broken
 * seen file must never fail a fetch tick, it only costs the stop.
 *
 * The stat pre-probe exists because loadState swallows ENOENT internally
 * (its empty-state return): the absent file is worth its own warn line in
 * the PC clone, where seen-posts.json is committed data and its absence
 * means the clone predates the bot's first commit-back.
 */
export async function readSeenIdSet(
  filePath: string = STATE_PATH,
): Promise<ReadonlySet<string>> {
  try {
    await stat(filePath);
  } catch (error) {
    const isEnoent =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT";
    const message = error instanceof Error ? error.message : String(error);
    if (isEnoent) {
      console.warn(`state: ${filePath} absent — seen-stop set is empty (every mint counts fresh)`);
    } else {
      console.warn(`state: ${filePath} unreadable (${message}) — seen-stop set is empty`);
    }
    return new Set();
  }
  try {
    const state = await loadState(filePath);
    return new Set(Object.keys(state.seenPostIds));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`state: ${filePath} malformed — seen-stop set is empty (${message})`);
    return new Set();
  }
}
```

#### 2. reader battery
**File**: `tests/state.test.ts`
**Changes**: readSeenIdSet battery

### tests/state.test.ts — MODIFY (new describe("readSeenIdSet") battery)

```typescript
// import addition — readSeenIdSet joins the ../src/state.js import list:
import {
  type AppState,
  CURRENT_STATE_VERSION,
  diffNew,
  diffNewIds,
  loadState,
  migrateState,
  pruneState,
  readSeenIdSet,
  saveState,
  stateTempPath,
  writeStateAtomic,
} from "../src/state.js";

// new describe block — placed after the loadState describe:
describe("readSeenIdSet", () => {
  it("warns exactly once and returns an empty set when the file is absent", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await tempStateFile("seen-absent.json"); // unseeded: no file exists yet
    assert.deepEqual(await readSeenIdSet(path), new Set());
    assert.equal(warns.mock.callCount(), 1);
  });

  it("warns exactly once and returns an empty set when the JSON is malformed", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await tempStateFile("seen-broken.json");
    await writeFile(path, "{ not json", "utf8");
    assert.deepEqual(await readSeenIdSet(path), new Set());
    assert.equal(warns.mock.callCount(), 1);
  });

  it("warns exactly once and returns an empty set when the envelope is the wrong shape", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await tempStateFile("seen-shape.json", { version: 99, seenPostIds: {} });
    assert.deepEqual(await readSeenIdSet(path), new Set());
    assert.equal(warns.mock.callCount(), 1);
  });

  it("returns every key unpruned — an entry older than any window survives (full history)", async () => {
    const path = await tempStateFile("seen-full.json", {
      version: CURRENT_STATE_VERSION,
      seenPostIds: {
        fresh: iso(NOW),
        ancient: iso(NOW - 1000 * HOUR), // would die under any recency prune
      },
    });
    const ids = await readSeenIdSet(path);
    assert.equal(ids.size, 2);
    assert.ok(ids.has("fresh"));
    assert.ok(ids.has("ancient"));
  });

  it("round-trips with saveState: every saved id lands in the set", async () => {
    const path = await tempStateFile("seen-round.json");
    await saveState({ version: CURRENT_STATE_VERSION, seenPostIds: {} }, ["a", "b"], path, NOW);
    const ids = await readSeenIdSet(path);
    assert.deepEqual([...ids].sort(), ["a", "b"]);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the slice's files: `npx biome check src/state.ts tests/state.test.ts`
- [x] Slice tests pass: `npx tsx --test tests/state.test.ts`
- [x] Each fault case warns exactly once: `warns.mock.callCount() === 1` in all three fault tests (absent, malformed, wrong shape)
- [x] Full history: the `returns every key unpruned` test proves a 1000h-old entry survives (no recency argument)
- [x] Additive only: no pre-existing state.test.ts case changed

#### Manual Verification:
- [x] None — offline reader, fully covered by the battery above

---

## Phase 2: the walk counts seen streaks and stops

### Overview
The walk counts consecutive first-wins inserts of seen ids, resets on every fresh insert, stops pre-round and post-log (the print-both-lines tie-break), and logs the mandatory `seen-stop:` line. Slot 6 on `walkLinkedInSurface`, slot 9 on `fetchLinkedInPosts` with the empty-set default (the probe's structural 8-arg exemption), the threading pass-through, and the four walk-level streak tests.

Parallelism: Independent of Phase 1 (receives a `ReadonlySet`; imports nothing from Phase 1) — can run in parallel per the design's Ordering Constraints.

### Changes Required:

#### 1. walk streaks + stop
**File**: `src/linkedin-fetch.ts`
**Changes**: SEEN_STOP_CONSECUTIVE, slot 6 walk param, streak accrual, stop checks + log, slot 9 + threading

### src/linkedin-fetch.ts — MODIFY (anchors HEAD-relative @ 33e17dc; fences show post-application code — tuning const NEW after LINKEDIN_MAX_POSTS :104; walk slot 6 :461; closure locals :470; accrual :511; pre-round check :576; round tail RESTRUCTURED, deletes the dry-arm inline break :627; slot 9 :686; threading :722)

*This fence is a fragment collection, not one contiguous edit: apply each fragment at its own `:NNN` anchor against the on-disk HEAD file, in anchor order.*

```typescript
// --- tuning block — NEW const SEEN_STOP_CONSECUTIVE, inserts after LINKEDIN_MAX_POSTS (:104 @ HEAD) ---
/**
 * Consecutive FIRST-WINS inserts of already-seen ids that stop a surface's
 * walk early (design 2026-11-13): a fully-seen keyword stops before it
 * burns scroll rounds re-minting what the hosted run already recorded.
 * Accrued handler-side inside the fresh-insert block: a fresh unseen
 * insert resets the count, and a re-served id never reaches the block, so
 * it never re-counts. Tuning constant, never config or env (repo doctrine).
 */
const SEEN_STOP_CONSECUTIVE = 3;

// --- walkLinkedInSurface signature, slot 6 (:461 @ HEAD) ---
async function walkLinkedInSurface(
  context: ContextLike,
  surface: LinkedinSurface,
  label: string,
  scrollRounds: number,
  minClicks: number,
  seenIds: ReadonlySet<string>,
): Promise<Post[]> {

// --- closure locals beside received/parsed (:470 @ HEAD) ---
  let received = 0; // matched flagship-web bodies fully read — the liveness signal
  let parsed = 0; // bodies that carried at least one post — the OK-line counter (N008)
  let seenStreak = 0; // consecutive first-wins inserts of seen ids — the seen-stop signal
  let lastSeenId = ""; // the id that tipped the streak — named by the seen-stop line

// --- accrual, inside the first-wins insert block (:511 @ HEAD) ---
          if (seenIds.has(post.id)) {
            seenStreak += 1;
            lastSeenId = post.id;
          } else {
            seenStreak = 0;
          }

// --- stop check, PRE-ROUND — inserts after the loop head (:576 @ HEAD), before the DOM probe ---
      // Seen-stop, pre-round (design 2026-11-13): a streak accrued by the
      // initial body stops before ANY round work — no DOM probe, no click.
      // The pre-stop mints ride the payload; the hosted chain dedupes them.
      if (seenStreak >= SEEN_STOP_CONSECUTIVE) {
        console.log(`fetch: ${label} seen-stop: ${lastSeenId}`);
        break;
      }

// --- round tail, RESTRUCTURED (:627 @ HEAD): swap the HEAD span from "const gained..." through the dry-arm's closing brace with this whole block — the old inline dry-exit break inside the dry arm is DELETED ---
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
// --- fetchLinkedInPosts slot 9, empty-set default = the probe's structural exemption (:686 @ HEAD) ---
  minClicks = 0,
  seenIds: ReadonlySet<string> = new Set(),
): Promise<Post[]> {

// --- threading site (:722 @ HEAD) ---
        const posts = await walkLinkedInSurface(
          context,
          surface,
          label,
          scrollRounds,
          minClicks,
          seenIds,
        );
```

#### 2. walk streak tests
**File**: `tests/linkedin-fetch.test.ts`
**Changes**: walk-level streak tests

### tests/linkedin-fetch.test.ts — MODIFY (new walk-level streak tests, appended :1007)

```typescript
// --- new describe block, appended at EOF ---
describe("seen-stop (design 2026-11-13)", () => {
  it("stops before round 1 when the initial body is fully seen — the pre-stop mints ride", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const seen = new Set([1, 2, 3].map((n) => `urn:li:activity:${idAt(n)}`));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23seenfull",
          script: {
            initialBody: cardBodyMany([
              [idAt(1), postText(1)],
              [idAt(2), postText(2)],
              [idAt(3), postText(3)],
            ]),
            clickBodies: [cardBody(idAt(4), postText(4))], // must never be reached
          },
        },
      ],
    });
    // The full 9-arg call — slot 9 carries the tick's seen set, so this
    // test doubles as the :722 threading pin (a dropped pass-through
    // leaves the walk the empty default, no stop fires, the rounds run).
    const posts = await fetchLinkedInPosts(
      [surface("#seenfull")],
      PROFILE,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
      0,
      seen,
    );
    const page = pageFor(factory, "%23seenfull");
    assert.deepEqual(page.clicks, []); // zero clicks — no round ever ran
    assert.equal(
      page.evaluates.some((script) => script.includes("loadMore")),
      false,
    ); // not even the round-1 DOM probe ran
    assert.equal(posts.length, 3); // the pre-stop mints ride the payload
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.endsWith(`seen-stop: urn:li:activity:${idAt(3)}`)));
    assert.ok(
      lines.some((line) => /OK — 3 post\(s\) from 1 response\(s\).*0 click\(s\) fired/.test(line)),
    );
  });

  it("a fresh unseen insert resets the streak — only consecutive seen ids stop the walk", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const seen = new Set([1, 2, 4, 5, 6].map((n) => `urn:li:activity:${idAt(n)}`));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23reset",
          script: {
            // Mints emerge in TIMESTAMP order (the parser's zip), so the
            // fresh id sits BETWEEN the seen ids: s1, s2, FRESH(3), s4 —
            // a naive seen-count reads 3 and stops before round 1; the
            // reset makes the true streak 1.
            initialBody: cardBodyMany([
              [idAt(1), postText(1)],
              [idAt(2), postText(2)],
              [idAt(3), postText(3)],
              [idAt(4), postText(4)],
            ]),
            clickBodies: [cardBody(idAt(5), postText(5)), cardBody(idAt(6), postText(6))],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#reset")],
      PROFILE,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
      0,
      seen,
    );
    const page = pageFor(factory, "%23reset");
    assert.deepEqual(page.clicks, [1, 2]); // round 1 ran; the stop fires after round 2
    assert.equal(posts.length, 6); // 4 initial + 1 + 1
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.endsWith(`seen-stop: urn:li:activity:${idAt(6)}`)));
  });

  it("a re-served id never re-counts — the walk-local skip cannot tip the streak", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const seen = new Set([1, 2, 3].map((n) => `urn:li:activity:${idAt(n)}`));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23reserve",
          script: {
            initialBody: cardBodyMany([
              [idAt(1), postText(1)], // seen — streak 1
              [idAt(2), postText(2)], // seen — streak 2
            ]),
            clickBodies: [
              // Re-serves the walk-local idAt(1): the first-wins skip must
              // NOT accrue (a re-count would tip 2 → 3 and stop at this
              // round), and the fresh unseen id resets the streak to 0.
              cardBodyMany([
                [idAt(1), "second mint"],
                [idAt(33), postText(33)],
              ]),
              cardBody(idAt(31), postText(31)), // fresh unseen — stays reset
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#reserve")],
      PROFILE,
      factory,
      3,
      instantSleep,
      () => 0,
      () => 0,
      0,
      seen,
    );
    const page = pageFor(factory, "%23reserve");
    assert.deepEqual(page.clicks, [1, 2, 3]); // all three rounds ran
    assert.equal(posts.length, 4); // 2 initial + 1 + 1 (the re-served id minted once)
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(
      lines.some((line) => line.includes("seen-stop:")),
      false,
    ); // the re-served id never re-counted; the fresh resets kept the streak low
  });

  it("tie round: the dry line prints with its increment, then the seen-stop line breaks", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const seen = new Set([1, 2, 3, 4].map((n) => `urn:li:activity:${idAt(n)}`));
    const factory = fakeContextFactory({
      scripts: [
        {
          fragment: "%23tie",
          script: {
            initialBody: cardBodyMany([
              [idAt(9), postText(9)], // fresh — streak stays 0
              [idAt(8), postText(8)],
            ]),
            clickBodies: [
              cardBody(idAt(1), postText(1)), // seen — streak 1, +1 new → dry 1/3
              cardBody(idAt(2), postText(2)), // seen — streak 2, +1 new → dry 2/3
              cardBody(idAt(3), postText(3)), // seen — streak 3 AND dry 3/3: the tie
            ],
          },
        },
      ],
    });
    const posts = await fetchLinkedInPosts(
      [surface("#tie")],
      PROFILE,
      factory,
      8,
      instantSleep,
      () => 0,
      () => 0,
      0,
      seen,
    );
    const page = pageFor(factory, "%23tie");
    assert.deepEqual(page.clicks, [1, 2, 3]); // the tie breaks after round 3; round 4 never runs
    assert.equal(posts.length, 5); // 2 fresh + 3 seen, all minted pre-stop
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /\(dry 3\/3, total 5\)/.test(line)));
    assert.ok(lines.some((line) => line.endsWith(`seen-stop: urn:li:activity:${idAt(3)}`)));
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the slice's files: `npx biome check src/linkedin-fetch.ts tests/linkedin-fetch.test.ts`
- [x] Slice tests pass: `npx tsx --test tests/linkedin-fetch.test.ts`
- [x] Pre-round stop: `stops before round 1 when the initial body is fully seen` asserts zero clicks, no DOM-probe evaluate, 3 posts riding the payload, and the `seen-stop:` line
- [x] Streak reset: `a fresh unseen insert resets the streak` proves a fresh id minted between seen ids keeps the walk running (clicks [1, 2], the stop only after round 2)
- [x] Re-serve immunity: `a re-served id never re-counts` proves the first-wins skip cannot tip the streak (all 3 rounds run, no `seen-stop:` line)
- [x] Tie-break: `tie round: the dry line prints with its increment, then the seen-stop line breaks` asserts BOTH `(dry 3/3, total 5)` and the `seen-stop:` line, and that round 4 never runs
- [x] Threading pin: the 9-arg call in `stops before round 1` fails if the :722 pass-through is dropped (empty default → no stop → rounds run)
- [x] Probe exemption: the existing 8-arg `defers the dry exit until minClicks clicks have landed` test passes unchanged
- [x] Additive only: all 29 pre-existing linkedin-fetch tests pass unchanged

#### Manual Verification:
- [x] None — offline walk, fully covered by the battery above

---

## Phase 3: tick wiring (terminal)

### Overview
The tick reads the seen file once (the `seenPath` dep, OUTSIDE the fault try) and passes `0` + the set as slots 8-9 of the walk call. Seven per-name hermeticity edits plus the seeded tick seen-stop test. Terminal phase: whole-repo gates.

Parallelism: Runs AFTER Phases 1 and 2 (imports `readSeenIdSet`, fills slot 9).

### Changes Required:

#### 1. tick wiring
**File**: `scripts/fetch-linkedin.ts`
**Changes**: seenPath dep, the read, call-site args

### scripts/fetch-linkedin.ts — MODIFY (seenPath dep :84-122; read slot :357-362; call site :374-382)

```typescript
// --- config import (:36 @ HEAD) — STATE_PATH joins the existing import ---
import { LINKEDIN_PAYLOAD_PATH, STATE_PATH } from "../src/config.js";

// --- NEW import, directly after the linkedin-session import (:50 @ HEAD) ---
import { readSeenIdSet } from "../src/state.js";

// --- FetchTickDeps, after markerPath (:106 @ HEAD) — the markerPath idiom ---
  /**
   * Seen-posts state file for the walk's seen-stop (design 2026-11-13).
   * Default: STATE_PATH — the committed seen file the hosted bot writes
   * back. The offline suite injects a temp path to stay hermetic.
   */
  seenPath?: string;

// --- the read, between the harvestedAt gate and `let posts` (:362 @ HEAD), OUTSIDE the fault try ---
  // The seen-stop set (design 2026-11-13): the full-history seen ids feed
  // the walk's consecutive-seen stop. Outside the fault try BY CONTRACT:
  // readSeenIdSet degrades to an empty set on every fault, so the walk's
  // fault vocabulary stays browser-shaped (halt / leg-dead / all-faulted
  // only) — a broken seen file costs the stop, never the tick.
  const seenIds = await readSeenIdSet(deps.seenPath ?? STATE_PATH);

// --- call site, slots 8-9 (:374-381 @ HEAD) ---
    posts = await fetchLinkedInPosts(
      surfaces,
      LINKEDIN_PROFILE_DIR,
      deps.contextFactory,
      config.scrollRounds,
      undefined,
      now,
      rng,
      0, // minClicks — the tick carries no click floor (the probe owns PROBE_MIN_CLICKS)
      seenIds,
    );

```

#### 2. tick tests
**File**: `tests/fetch-linkedin.test.ts`
**Changes**: tick seen-stop test + 7 one-line seenPath edits

### tests/fetch-linkedin.test.ts — MODIFY (7 one-line seenPath edits + new tick seen-stop test)

```typescript
// --- import addition (:35 @ HEAD) ---
import { CURRENT_STATE_VERSION, saveState } from "../src/state.js";

// --- the seven hermeticity edits (one line each, inside each test's deps literal) ---
//   tick-ok — after the "latch-1.flag" deps literal's `env: {},` line:
      seenPath: await workPath("seen-tick.json"),
//   tick-dead — after the "latch-2.flag" deps literal's `env: {},` line:
      seenPath: await workPath("seen-tick.json"),
//   tick-all-faulted — after the "latch-3.flag" deps literal's `env: {},` line:
      seenPath: await workPath("seen-tick.json"),
//   tick-fine-empty — after the "latch-4.flag" deps literal's `env: {},` line:
      seenPath: await workPath("seen-tick.json"),
//   scrollRounds-threads — after the "latch-rounds.flag" deps literal's `env: {},` line:
      seenPath: await workPath("seen-tick.json"),
//   halt-latch-cp — after the "latch-cp.flag" deps literal's `env: {},` line:
      seenPath: await workPath("seen-tick.json"),
//   latch-channels — after the "latch-channels.flag" deps literal's `env: {},` line:
      seenPath: await workPath("seen-tick.json"),

// --- NEW describe block, appended at EOF ---
describe("the seen-stop set rides the tick into the walk (design 2026-11-13)", () => {
  it("stops the walk before round 1 on a seeded seen file — zero clicks, pre-stop mints still push", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const seenPath = await workPath("seen-tick-stop-seed.json");
    // The REAL contract seeds the file: saveState's v2 envelope carrying
    // the three urns the initial body is about to mint.
    await saveState(
      { version: CURRENT_STATE_VERSION, seenPostIds: {} },
      [1, 2, 3].map((n) => `urn:li:activity:${idAt(n)}`),
      seenPath,
      T0,
    );
    const payload = await workPath("payload-seen-stop.json");
    const contextFactory = contextFactoryFor({
      script: {
        initialBody: [
          cardBody(idAt(1), "hiring post — Jakarta"),
          cardBody(idAt(2), "hiring post — Bandung"),
          cardBody(idAt(3), "hiring post — Surabaya"),
        ].join("\n"),
      },
    });
    const git = scriptGit({ diff: 1, "rev-parse": { code: 0, output: "main" } });
    const result = await fetchTick({
      latchPath: await workPath("latch-seen-stop.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      payloadPath: payload,
      git,
      env: {},
      seenPath,
      markerPath: await workPath("marker-seen-stop.flag"),
      now: () => T0,
    });
    assert.deepEqual(result, { wrote: true, pushed: true, postCount: 3 });
    const envelope = JSON.parse(await readFile(payload, "utf8")) as PayloadEnvelope;
    assert.equal(envelope.posts.length, 3); // the pre-stop mints ride the payload
    assert.deepEqual(contextFactory.clicks(), []); // the stop fired BEFORE any round work
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.endsWith(`seen-stop: urn:li:activity:${idAt(3)}`)));
    assert.ok(git.calls.some((args) => args[0] === "push"));
  });
});

```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes on the slice's files: `npx biome check scripts/fetch-linkedin.ts tests/fetch-linkedin.test.ts`
- [x] Slice tests pass: `npx tsx --test tests/fetch-linkedin.test.ts`
- [x] Tick seen-stop: `stops the walk before round 1 on a seeded seen file` asserts `{wrote: true, pushed: true, postCount: 3}`, the 3 pre-stop mints in the envelope, `clicks() === []`, the `seen-stop:` line, and the push
- [x] Threading pin: the new tick test fails if the call site drops `seenIds` (empty-set default → no stop → rounds run → clicks non-empty)
- [x] Hermeticity: each of the seven walk-reaching tests (tick-ok, tick-dead, tick-all-faulted, tick-fine-empty, scrollRounds-threads, halt-latch-cp, latch-channels) carries its own `seenPath` key — grep EACH NAME, not a match count
- [x] Fault vocabulary: the seen read sits OUTSIDE the fault try — a reader fault degrades to an empty set by Slice 1's contract, so the walk's fault arms stay halt/leg-dead/all-faulted only (the existing fault tests pass unchanged)
- [x] Probe exemption untouched: `scripts/probe-linkedin.ts` keeps its 8-arg call (the probe never reads the seen set)
- [x] Additive only: all 31 pre-existing fetch-linkedin tests pass unchanged
- [x] Whole-repo gates: `npm test` and `npm run lint` both exit 0

#### Manual Verification:
- [x] None — offline tick, fully covered by the battery above

## Testing Strategy

### Automated:
- Per phase: `npm run typecheck`, the phase's scoped `npx biome check <phase files>`, and the phase's scoped `npx tsx --test <phase suite>` (each phase's Success Criteria carry the exact commands, write-scoped to that phase's files).
- Whole-plan (validate): `npm run typecheck`, `npm test`, `npm run lint` — all exit 0. Evidence the gates are green at base plus this plan's changes: the design's sandbox ran all three over the fully applied tree (2026-11-13: state 21/21, linkedin-fetch 33/33, fetch-linkedin 32/32, lint 0).

### Manual Testing Steps:
1. On the PC dedicated clone, run one tick against a fully-seen keyword and confirm the `fetch: <label> seen-stop: <urn>` line and `0 click(s) fired` in the OK line (the design's Desired End State log).
2. Run `npm run probe-linkedin` once and confirm the probe still clears its 10-post floor — its 8-arg walk call is untouched, the exemption is structural.

## Performance Considerations

One stat + one full read + JSON.parse of the committed seen file (~1.6MB, thousands of keys) per tick — negligible against a 25s+ browser walk. The set is shared read-only across all surface walks in one tick. No new O(n²) surface: Set.has is O(1) per minted post.

## Migration Notes

Not applicable — no schema change; seen-posts.json keeps its v2 envelope; readers and writers unchanged.

## Developer Context

- Step 4 reviewers unavailable in this harness (no Agent tool; the same deviation disclosed at design time). Both passes ran INLINE against HEAD at 33e17dc with the same dimensions: the code pass audited every Phase fence (all six were sandbox-verified at design time — compile, suites, biome, full `npm test` over the applied tree, bytes restored); the coverage pass mapped all seven design Verification Notes entries into phase criteria or scope mirrors. Findings persisted in `## Plan Review (Step 4)` below.

## References

- Design: `.rpiv/artifacts/designs/2026-11-13_10-27-17_linkedin-seen-stop-scroll.md`
- Solutions: `.rpiv/artifacts/solutions/2026-11-13_09-47-30_linkedin-seen-stop-scroll.md`
- Research: `.rpiv/artifacts/research/2026-11-13_08-55-55_linkedin-seen-stop-scroll.md`
- FRD: `.rpiv/artifacts/discover/2026-11-13_08-40-38_linkedin-seen-stop-scroll.md`

## Plan Review (Step 4)

_Independent post-finalization review. The subagent pair is unavailable in this harness; both reviews ran inline (see Developer Context). Coverage pass: all seven design Verification Notes entries land in phase Success Criteria or visible scope mirrors — zero coverage findings. Findings triaged at Step 5._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 3 → Success Criteria → whole-repo gates bullet | (repo-wide: `npm test`, `npm run lint`) | concern | write-scope | Whole-repo `npm test` and `npm run lint` sit inside Phase 3's Automated Verification; the plan write-scope rule reserves whole-repo build/test for validate's whole-plan block | Either accept — Phase 3 depends_on [1, 2] so it runs last and no sibling phase is in flight — or drop both bullets here (they already live in Testing Strategy → whole-plan) and let validate own them | accepted: Phase 3 depends_on [1, 2] so it runs last with no sibling phase in flight — the write-scope hazard is structurally absent; the design's terminal-slice intent ("the terminal slice adds npm test") and the pass-through rule both favor keeping the criteria verbatim |

## Follow-ups

### 2026-11-13T13:18:09+0700 — Phase 1 round-trip fence seeds an empty base state

- Phase 1 `tests/state.test.ts` round-trip fence: `saveState(STATE, ["a", "b"], ...)` → `saveState({ version: CURRENT_STATE_VERSION, seenPostIds: {} }, ["a", "b"], ...)`. Cause: the suite's `STATE` fixture already holds ids "1" and "2", and `saveState` merges fresh ids into the base state — the written file carried 4 ids and the fenced assertion failed on first run. Seeding an empty base state makes the test exactly the round-trip its title claims. Surfaced by the /skill:implement Phase 1 pre-flight; fix approved by the operator in the mismatch flow.
