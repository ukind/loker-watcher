---
date: 2026-11-13T10:27:17+0700
author: Yogiswara Utama
commit: 33e17dc
branch: main
repository: loker-watcher
topic: "LinkedIn walk seen-stop: stop a surface after N consecutive already-seen posts"
tags: [design, linkedin-fetch, state, fetch-linkedin, seen-stop]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-13_09-47-30_linkedin-seen-stop-scroll.md
last_updated: 2026-11-13T12:05:02+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Slice 2 post-log fragment widened to carry the dry-arm deletion"
---

# Design: LinkedIn walk seen-stop

## Summary

The PC LinkedIn walk stops a surface early once it mints 3 consecutive first-wins inserts of post ids already recorded in state/seen-posts.json, logging a mandatory `fetch: <label> seen-stop: <id>` line. The tick reads the seen file once into a `ReadonlySet<string>` (new degrade-everything reader `readSeenIdSet` in src/state.ts) and passes it as a trailing slot-9 parameter of `fetchLinkedInPosts`; the probe keeps its byte-identical 8-argument call, so its exemption is structural (empty-set default). Fully-seen keywords stop before burning scroll rounds instead of exhausting all 50 (the reflog payload bursts 1195/2182/2207/1941/2243 posts are the receipt of that waste).

## Requirements

- Stop a surface scroll loop when N consecutive FRESH inserts are seen ids (fresh inserts only; a re-served id never re-counts).
- Load the full-history seen set (no recency argument); the reader degrades on absent AND malformed with exactly one warn each.
- The probe ignores seen posts structurally (empty-set default; no new probe field).
- Posts minted before the stop ride the payload; the hosted chain stays untouched.
- The stop is per-surface; the set is global across keywords (no keyword column in the state schema).
- A mandatory stop log line in the `fetch:` register (success-path console.log, never warn).
- N is a module constant (`SEEN_STOP_CONSECUTIVE = 3`) in the tuning block, never config or env.
- Offline tests stay hermetic: the seven walk-reaching tick tests must not read the real committed seen file.

## Current State Analysis

Re-verified at 33e17dc by full reads of every referenced file.

### Key Discoveries

- Walk loop: bound `round <= scrollRounds && posts.size < LINKEDIN_MAX_POSTS` (src/linkedin-fetch.ts:576, cap 150 at :104), settle :622, `gained = posts.size - before` :627 measures walk-local Map growth only — a seen post is fresh to the walk-local Map, so a fully-seen feed never trips the dry exit.
- Response handler: fire-and-forget `void (async () => ...)` :506; mint :510; first-wins `posts.has` skip :513; fresh counting :511-516; count-only logging :522-524.
- Signatures: `walkLinkedInSurface(context, surface, label, scrollRounds, minClicks)` :461-467 (module-private); `fetchLinkedInPosts` 8 positional ending `minClicks = 0` :678-686; single threading site :722.
- Tick: `FetchTickDeps` 13 optional-field-with-default entries (scripts/fetch-linkedin.ts:84-122); fault try :363-405; the walk call :374-382 passes 7 args today; `markerPath` dep idiom :106-107.
- State: AppState v2 (src/state.ts:23-26); `loadState` :139-158 is ENOENT-only degrade and swallows ENOENT silently; `diffNew` builds `new Set(Object.keys(state.seenPostIds))` :176-193 — the id shape is the full post id (LinkedIn posts persist as `urn:li:activity:<id>`), matching the walk's map keys verbatim.
- Degrade-everything reader to copy: `loadAccountCeilings` (src/judge-ceilings.ts:93-121) — one warn per fault, never throws.
- Probe: 8-arg call ending `minClicks` (scripts/probe-linkedin.ts:163-172); `PROBE_MIN_CLICKS = 5` :49; `PROBE_MIN_POSTS = 10` :175-176.
- Test doubles: the walk suite's `fakeContextFactory` matches scripts by goto-URL fragment (tests/linkedin-fetch.test.ts) and drains async body reads with one setImmediate per waitForTimeout — the deterministic handshake that makes handler-accrued state readable by the loop offline. The tick suite's `contextFactoryFor` carries ONE script for all pages (single-surface tests); per-surface differentials belong at walk level.
- Seven walk-reaching tick tests (tests/fetch-linkedin.test.ts: tick-ok, tick-dead, tick-all-faulted, tick-fine-empty, scrollRounds-threads, halt-latch-cp, latch-channels) currently reach the walk without a seenPath — after this design they must inject one or they read the real committed file (hermeticity rule).

## Scope

### Building

- `readSeenIdSet` in src/state.ts: full-history id set; absent/malformed → exactly one warn, empty set.
- `SEEN_STOP_CONSECUTIVE = 3` in the walk tuning block; slot 6 on `walkLinkedInSurface`; two closure locals beside received/parsed; accrual inside the fresh-insert block; stop checks pre-round and after the round logs; the `seen-stop:` log line; slot 9 on `fetchLinkedInPosts` + pass-through.
- `seenPath` dep on FetchTickDeps (default STATE_PATH); one read between the harvestedAt gate and the walk, OUTSIDE the fault try; call site gains `0` (minClicks) + the set.
- Tests: state reader battery; walk-level streak semantics; tick-level seen-stop; 7 one-line `seenPath` edits.

### Not Building

- Hosted-chain changes (dedupe, recency, diffNewIds, payload envelope all untouched).
- Parser changes (stays pure and seen-blind).
- Probe behavior changes (structural exemption only).
- scripts/watch-linkedin.ts changes.
- A config or env knob for N; any new pruning of the seen file; per-keyword seen tracking.

## Decisions

### Slot-9 trailing param, empty-set default (simple)

`fetchLinkedInPosts(..., minClicks = 0, seenIds: ReadonlySet<string> = new Set())`. Only 3 of 28 walk-suite call sites reach slot 8; slot 9 shifts none. The probe's 8-arg call (scripts/probe-linkedin.ts:163-172) stays byte-identical — its exemption is the absence of the argument. Evidence: the trailing-injection idiom (src/linkedin-fetch.ts:678-686, src/judge-ceilings.ts:93-96, src/state.ts:196).

### Streak accrues handler-side, inside the fresh block (simple)

Two closure locals beside received/parsed (src/linkedin-fetch.ts:470-471): `seenStreak` increments on each first-wins insert whose id is in the set, resets on any fresh unseen insert; dry rounds touch nothing. The first-wins `posts.has` skip (:513) makes re-serve double-counting structurally impossible. The loop reads the counter at the same settle boundary `gained` uses (:627) — the one-setImmediate drain in the doubles (tests/linkedin-fetch.test.ts) makes it deterministic offline.

### Stop checks: pre-round AND after the round logs; seen-stop wins ties (decided by developer)

Two 3-line check sites share one shape: `if (seenStreak >= SEEN_STOP_CONSECUTIVE) { log; break; }`. The pre-round site fires before any click work so a fully-seen initial body stops with zero clicks (required by the walk test "stops before round 1"). The post-log site sits after the round's dry/gain log block and BEFORE the relocated dry-exit condition, so on a tie round the dry line prints with its increment and THEN the seen-stop line breaks — the developer decision "print both lines". The dry-exit condition moves out of the dry arm unchanged (`gained < LINKEDIN_MIN_GAIN && dryRounds >= LINKEDIN_MAX_DRY_ROUNDS && (clicks === 0 || clicks >= minClicks)`); with the streak at 0 its behavior is byte-equivalent to today.

### readSeenIdSet: degrade-everything with warn-on-absent (simple, posture per solutions artifact)

`stat` pre-probe (because `loadState` swallows ENOENT internally) then ONE `loadState` call with no recency argument (full history — a pruned id is recency-ineligible hosted-side anyway, so the stop fires earliest with no clock dependency). Absent → one warn; non-ENOENT stat fault → one warn; loadState throw (malformed JSON, wrong shape) → one warn; every fault returns an empty set. Note: `loadAccountCeilings` is quiet on ENOENT; this reader deliberately deviates — the seen file is committed data in the PC clone, so absence is anomalous and worth its own line.

### seenPath dep on FetchTickDeps, read outside the fault try (simple)

`seenPath?: string` defaulting to STATE_PATH (the `markerPath` idiom, scripts/fetch-linkedin.ts:106-107). The read sits between the harvestedAt gate (:357-361) and `let posts` (:362), outside the fault try: a reader fault degrades to an empty set by contract, so the walk's fault vocabulary stays browser-shaped (halt/leg-dead/fault only). The tick never writes seen-posts.json — single-writer doctrine (the bot owns it).

### N = 3, module constant (simple)

`const SEEN_STOP_CONSECUTIVE = 3;` in the tuning block (src/linkedin-fetch.ts:75-116), private like its siblings. Never config, never env (repo doctrine: tuning values are hard-coded module constants; probe-measured values are the committed exception).

## Architecture

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
    await saveState(STATE, ["a", "b"], path, NOW);
    const ids = await readSeenIdSet(path);
    assert.deepEqual([...ids].sort(), ["a", "b"]);
  });
});
```

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

## Slices

### Slice 1: seen-set reader (foundation)

**Files**: `src/state.ts`, `tests/state.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes on the slice's files: `npx biome check src/state.ts tests/state.test.ts`
- [ ] Slice tests pass: `npx tsx --test tests/state.test.ts`
- [ ] Each fault case warns exactly once: `warns.mock.callCount() === 1` in all three fault tests (absent, malformed, wrong shape)
- [ ] Full history: the `returns every key unpruned` test proves a 1000h-old entry survives (no recency argument)
- [ ] Additive only: no pre-existing state.test.ts case changed

#### Manual Verification:
- [ ] None — offline reader, fully covered by the battery above

### Slice 2: the walk counts seen streaks and stops

**Files**: `src/linkedin-fetch.ts`, `tests/linkedin-fetch.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes on the slice's files: `npx biome check src/linkedin-fetch.ts tests/linkedin-fetch.test.ts`
- [ ] Slice tests pass: `npx tsx --test tests/linkedin-fetch.test.ts`
- [ ] Pre-round stop: `stops before round 1 when the initial body is fully seen` asserts zero clicks, no DOM-probe evaluate, 3 posts riding the payload, and the `seen-stop:` line
- [ ] Streak reset: `a fresh unseen insert resets the streak` proves a fresh id minted between seen ids keeps the walk running (clicks [1, 2], the stop only after round 2)
- [ ] Re-serve immunity: `a re-served id never re-counts` proves the first-wins skip cannot tip the streak (all 3 rounds run, no `seen-stop:` line)
- [ ] Tie-break: `tie round: the dry line prints with its increment, then the seen-stop line breaks` asserts BOTH `(dry 3/3, total 5)` and the `seen-stop:` line, and that round 4 never runs
- [ ] Threading pin: the 9-arg call in `stops before round 1` fails if the :722 pass-through is dropped (empty default → no stop → rounds run)
- [ ] Probe exemption: the existing 8-arg `defers the dry exit until minClicks clicks have landed` test passes unchanged
- [ ] Additive only: all 29 pre-existing linkedin-fetch tests pass unchanged

#### Manual Verification:
- [ ] None — offline walk, fully covered by the battery above

### Slice 3: tick wiring (terminal)

**Files**: `scripts/fetch-linkedin.ts`, `tests/fetch-linkedin.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes on the slice's files: `npx biome check scripts/fetch-linkedin.ts tests/fetch-linkedin.test.ts`
- [ ] Slice tests pass: `npx tsx --test tests/fetch-linkedin.test.ts`
- [ ] Tick seen-stop: `stops the walk before round 1 on a seeded seen file` asserts `{wrote: true, pushed: true, postCount: 3}`, the 3 pre-stop mints in the envelope, `clicks() === []`, the `seen-stop:` line, and the push
- [ ] Threading pin: the new tick test fails if the call site drops `seenIds` (empty-set default → no stop → rounds run → clicks non-empty)
- [ ] Hermeticity: each of the seven walk-reaching tests (tick-ok, tick-dead, tick-all-faulted, tick-fine-empty, scrollRounds-threads, halt-latch-cp, latch-channels) carries its own `seenPath` key — grep EACH NAME, not a match count
- [ ] Fault vocabulary: the seen read sits OUTSIDE the fault try — a reader fault degrades to an empty set by Slice 1's contract, so the walk's fault arms stay halt/leg-dead/all-faulted only (the existing fault tests pass unchanged)
- [ ] Probe exemption untouched: `scripts/probe-linkedin.ts` keeps its 8-arg call (the probe never reads the seen set)
- [ ] Additive only: all 31 pre-existing fetch-linkedin tests pass unchanged
- [ ] Whole-repo gates: `npm test` and `npm run lint` both exit 0

#### Manual Verification:
- [ ] None — offline tick, fully covered by the battery above

## Desired End State

A fully-seen keyword's tick log, after this design:

```
fetch: linkedin/loker linkedin terbaru 2026 liveness: 1 body(ies), 8 rendered post(s)
fetch: linkedin/loker linkedin terbaru 2026 dom probe (before scroll): {...}
fetch: linkedin/loker linkedin terbaru 2026 seen-stop: urn:li:activity:7351234567890123456
fetch: linkedin/loker linkedin terbaru 2026 OK — 8 post(s) from 1 response(s), 0 click(s) fired
```

The tick passes the set without any other change; the payload still carries the pre-stop mints; the hosted run dedupes them as today. A partially-seen keyword resets the streak on every fresh insert and walks exactly as before.

## File Map

- `src/state.ts`  # MODIFY — readSeenIdSet degrade-everything reader
- `src/linkedin-fetch.ts`  # MODIFY — SEEN_STOP_CONSECUTIVE, slot 6 walk param, streak accrual, stop checks + log, slot 9 + threading
- `scripts/fetch-linkedin.ts`  # MODIFY — seenPath dep, the read, call-site args
- `tests/state.test.ts`  # MODIFY — readSeenIdSet battery
- `tests/linkedin-fetch.test.ts`  # MODIFY — walk-level streak tests
- `tests/fetch-linkedin.test.ts`  # MODIFY — tick seen-stop test + 7 one-line seenPath edits

## Ordering Constraints

- Slice 3 depends on Slices 1 and 2 (the tick imports readSeenIdSet and fills slot 9).
- Slice 2 does NOT import from Slice 1 — the walk receives a ReadonlySet; the two are independent and could land in either order; the plan sequences 1 → 2 → 3.
- Single-commit delivery (the 93a3f38 pattern): all three slices ship together; slices are review units, not deploy units.

## Verification Notes

- Gate every slice: `npm run typecheck` then `npm run lint`; the terminal slice adds `npm test`.
- Two compile-invisible omission traps, each closed by exactly one named test: a forgotten :722 threading or a forgotten tick argument fails silently under the empty-set default — the walk-level injection test catches the first, the tick-level seen-stop test catches the second.
- Hermeticity: the seven walk-reaching tick tests — tick-ok, tick-dead, tick-all-faulted, tick-fine-empty, scrollRounds-threads, halt-latch-cp, latch-channels (tests/fetch-linkedin.test.ts) — must each inject `seenPath` in its own deps literal; after Slice 3's edits, grep EACH NAME for a `seenPath` key rather than trusting a match count (one miss reads the real committed ~1.6MB state/seen-posts.json and stops the walk early).
- History class 8e8f22b: walk-behavior changes needed observability follow-ups (9fa2a7e, 6493f3a class) — the stop line is mandatory in the SAME change.
- Seen-file staleness (tick N reads commits as of tick N-1 via the push rebase): accepted; the hosted diffNew backstop still dedupes anything re-served.
- Hosted-chain pins must stay green untouched: payload version pins, readPayloadPosts never-throw, the dup fixture test, the OK-line pins.
- Probe exemption: the existing minClicks-floor walk test IS the probe-shaped call (8 args + explicit slot 9 default) — it passing unchanged pins the exemption; typecheck catches any slot reorder (number vs ReadonlySet).

## Performance Considerations

One stat + one full read + JSON.parse of the committed seen file (~1.6MB, thousands of keys) per tick — negligible against a 25s+ browser walk. The set is shared read-only across all surface walks in one tick. No new O(n²) surface: Set.has is O(1) per minted post.

## Migration Notes

Not applicable — no schema change; seen-posts.json keeps its v2 envelope; readers and writers unchanged.

## Pattern References

- Degrade-everything reader: src/judge-ceilings.ts:93-121 (warn per fault, never throw)
- Optional dep with documented default: scripts/fetch-linkedin.ts:106-107 (markerPath)
- Trailing injectable param: src/linkedin-fetch.ts:678-686 (minClicks = 0)
- Closure-local walk counters: src/linkedin-fetch.ts:470-471, :574-575
- Tuning-constant block: src/linkedin-fetch.ts:94-116
- Deterministic async drain in doubles: tests/linkedin-fetch.test.ts (one setImmediate per waitForTimeout)

## Developer Context

- Q (Step 4, first phrasing): tie-break phrased with dry-round jargon — user replied "i dont understand"; re-asked in plain words. Lesson recorded: plain-language options first.
- Q (Step 4, re-asked): "On the round where the 3-seen-in-a-row stop fires at the same time as a nothing-new-loaded round, what should the log print?" → **"Print both lines (Recommended)"** — the dry line prints with its increment, then the seen-stop line breaks. Fixed as the tie-break decision.
- Design summary confirm → **Proceed**. Decomposition confirm (3 slices) → **Approve**.
- Harness deviation, disclosed: the skill's slice-verifier agent and research agents are unavailable in this harness (tool_search returned no agent tools). Step 2 research inherited the solutions artifact's three analysis agents (line refs re-verified by full reads at 33e17dc). Per-slice 6.2 verification runs as an inline self-review pass against Decisions / Cross-slice / Research with findings reported at the micro-checkpoint.
- Slice 2 checkpoint → **Approve** (33/33 walk-suite tests, biome + tsc clean, tree restored to baseline). Lesson from the two test-design iterations before green: the parser's timestamp-ordered zip re-sorts minted ids ascending — planted stream order does not survive, so accrual-order tests plant ids in ascending timestamp order.
- Slice 3 checkpoint → **Approve** (inline sandbox gate: state 21/21, linkedin-fetch 33/33 with the probe-exemption test unchanged inside, fetch-linkedin 32/32; biome + typecheck + lint + full `npm test` all exit 0; tree restored byte-exact, porcelain clean). Hermeticity verified PER-NAME on all seven walk-reaching tick tests, not by match count (the artifact's own rule).
- Sandbox lessons (2026-11-13, Slice 3 resume): (1) artifact fences that carry prose instruction comments — strip blank lines BETWEEN the comments too; a ^-anchored strip misses a comment preceded by a blank line and re-applies the fence's import line as code (biome noRedeclare catches it). (2) The CC safety net BLOCKS `git checkout -- <paths>`; the remedy is `git stash push -m <label> -- <paths>` (bytes recoverable), then capture the true HEAD bytes from the now-clean tree for the write-back restore — never snapshot "orig" from a dirty tree.

## Design History

- Slice 1: seen-set reader (foundation) — approved as generated
- Slice 2: the walk counts seen streaks and stops — approved as generated
- Slice 2 — revised post-approval: fence anchors re-stamped HEAD-relative @ 33e17dc (they were sandbox-relative, shifted ~11 lines by the tuning-const insertion); test fence marker relabeled EOF. Gate re-confirmed with explicit reporter totals; fence content later widened once (next line).
- Slice 2 — revised post-approval (2): the post-log fragment widened to the FULL round tail (:627) so the fence carries the dry-arm inline-break DELETION — the short fragment showed only additions, and implement keeping the old `if (dryRounds >= …) break;` would exit a tie round before the seen-stop line, breaking "print both lines". Fragment byte-matched against s2.fmtSrc.
- Slice 3: tick wiring (terminal) — approved as generated (inline sandbox, Slice-2 precedent: biome 0, typecheck 0, lint 0, npm test 0; state 21/21, linkedin-fetch 33/33 — probe-exemption test unchanged inside, fetch-linkedin 32/32; hermeticity verified per-name on all seven walk-reaching tests)

## References

- .rpiv/artifacts/solutions/2026-11-13_09-47-30_linkedin-seen-stop-scroll.md — the solution analysis this design implements (Option 1)
- .rpiv/artifacts/research/2026-11-13_08-55-55_linkedin-seen-stop-scroll.md — the anatomy research
- .rpiv/artifacts/discover/2026-11-13_08-40-38_linkedin-seen-stop-scroll.md — the FRD
- src/linkedin-fetch.ts:469-527 — the walk handler and accrual site
- src/linkedin-fetch.ts:576-653 — the click loop and its exits
- src/state.ts:139-158 — loadState, the contract contrast
- src/judge-ceilings.ts:93-121 — loadAccountCeilings, the degrade posture
- scripts/fetch-linkedin.ts:84-122 — FetchTickDeps
- tests/linkedin-fetch.test.ts — the walk doubles and drain handshake
- tests/fetch-linkedin.test.ts:366-820 — the seven walk-reaching tick tests
