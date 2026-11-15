---
date: 2026-11-15T11:41:53+0700
author: Yogiswara Utama
commit: be5407a
branch: main
repository: loker-watcher
topic: "Remove the LinkedIn working-hours window"
tags: [plan, linkedin-pc-leg, working-window, fetch-tick, linkedin-behavior]
status: ready
parent: .rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md
phase_count: 2
phases:
  - { n: 1, title: Code excision, files: [src/linkedin-behavior.ts, scripts/fetch-linkedin.ts, tests/linkedin-behavior.test.ts, tests/fetch-linkedin.test.ts], depends_on: [] }
  - { n: 2, title: Doc sweep + 24/7 recomputation, files: [scripts/linkedin-chain.ts, scripts/watch-linkedin.ts, src/config-file.ts, src/linkedin-capture.ts, scripts/replay-linkedin.ts, AGENTS.md, .rpiv/guidance/scripts/architecture.md], depends_on: [1] }
last_updated: 2026-11-15T11:41:53+0700
last_updated_by: Yogiswara Utama
---

# Remove the LinkedIn working-hours window Implementation Plan

## Overview

Full excision of the working-hours window from the PC-local LinkedIn leg: the predicate trio in `src/linkedin-behavior.ts`, the preflight gate and `bypassWindow` seam in `scripts/fetch-linkedin.ts`, the 16 test injections, and every doc claim. The halt latch becomes the first preflight gate; every tick runs any day, any hour. Two commits mirror the budget-deletion precedent: code excision (`8e8f22b` shape), then a docs-only sweep (`a88494e` shape).

Design artifact: `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md`

## Desired End State

`src/linkedin-behavior.ts` keeps only the cadence + halt vocabulary and a 24/7 worst-case bound (52 wake-ups per local day at the 28-minute floor). `scripts/fetch-linkedin.ts` preflight band starts at the latch; `guardCheckout` is the second gate; no clock read gates the tick. A Saturday-noon tick traverses the full band: latch (absent) -> guardCheckout (main + clean) -> cookies -> stamp -> walk.

## What We're NOT Doing

- Any replacement gate or bypass switch (discover Decision).
- Any cadence retune — the `PAYLOAD_MAX_AGE_MS` 40-min freshness margin (`src/linkedin-payload.ts:38`) is sized against the 33-min wake ceiling; touching cadence re-opens that contract.
- The `harvestedAt` stamp AGE check — the FRD's flagged follow-up, more load-bearing under 24/7, deserves its own change.
- README edit (verified clean — zero vocabulary hits).
- The stale knip line in `.rpiv/guidance/.github/workflows/architecture.md` — adjacent debt, not this change.

## Phase 1: Code excision

### Overview

Delete the window predicate trio, the preflight gate, the `bypassWindow` seam, the 16 test injections, and the window describe; invert the doomed Saturday test into a proceeds-pin, retitle the Monday pin, and add a new weekday out-of-hours pin. All four gates (typecheck, lint, test, knip) stay green.

### Changes Required:

#### 1. src/linkedin-behavior.ts
**File**: `src/linkedin-behavior.ts`
**Changes**: Replace the header comment (24/7 worst-case arithmetic) and delete the window trio (WINDOW_START_HOUR, WINDOW_END_HOUR, isWithinWorkingHours).

```typescript
// src/linkedin-behavior.ts — REPLACE lines 1-20 (the header comment) with:
/**
 * Behavioral policy machines for the PC-local LinkedIn leg (the
 * anti-restriction profile, design 2026-11-09; the daily GET budget
 * machine deleted by the browser-walk migration 2026-11-11; the
 * working-hours window deleted 2026-11-15 — every tick runs any day,
 * any hour): the jittered wake cadence and the halt-latch reason
 * vocabulary.
 *
 * Extraction idiom (src/judge-rotation.ts:5-7): pure machines + constants
 * live here; IO and policy placement stay at the consumer
 * (scripts/fetch-linkedin.ts wires the preflight band,
 * scripts/watch-linkedin.ts wires the loop cadence). The module is
 * IO-free: dates and rng draws arrive as arguments, so the offline suite
 * pins every edge with zero doubles.
 *
 * Worst-case arithmetic (the account-safety bound): 1440 minutes per
 * local day; at the 28-minute floor that is at most 52 wake-ups per
 * local day, and each wake walks at most 5 surfaces x (1 navigation
 * + scrollRounds Load-more clicks). The click cap rides the walk
 * (src/linkedin-fetch.ts).
 */
// DELETE lines 21-48 (verified on disk): the WINDOW_START_HOUR doc+decl
// (21-26), the WINDOW_END_HOUR doc+decl (27-33), the isWithinWorkingHours
// doc+fn (34-48). Everything from the RandomFn doc comment (line 50) on is
// untouched.
```

#### 2. scripts/fetch-linkedin.ts
**File**: `scripts/fetch-linkedin.ts`
**Changes**: Delete the import, the `bypassWindow` seam, the band comment reword, and the window gate (`at` + `isWithinWorkingHours` + quiet-zero return).

```typescript
// scripts/fetch-linkedin.ts — four hunks (anchors verified on disk):
// HUNK A — DELETE line 39 (verbatim):
//   import { isWithinWorkingHours } from "../src/linkedin-behavior.js";
// HUNK B — DELETE lines 133-138 (verbatim block, inside FetchTickDeps):
//   /**
//    * Bypass the working-hours window gate. Default: false (the gate is on).
//    * The offline suite injects true so a tick can run at any pinned clock;
//    * production never sets it.
//    */
//   bypassWindow?: boolean;
// HUNK C — REPLACE lines 376-379 (the band comment, verbatim today:)
//   // The anti-restriction preflight band (design 2026-11-09; the budget step
//   // deleted by the browser-walk migration 2026-11-11) runs BEFORE the
//   // checkout guard: a gated no-op costs zero git spawns, zero cookie reads,
//   // and zero browser navigations. Order: window -> latch.
// with (the epitaph's literal and its 2026-11-15 stamp share ONE line):
  // The preflight band runs BEFORE the checkout guard: a gated no-op costs
  // zero git spawns, zero cookie reads, and zero browser navigations. The
  // budget step is gone (browser-walk migration 2026-11-11); the
  // working-hours window is gone too (removed 2026-11-15). Order: latch ->
  // checkout guard.
// HUNK D — DELETE lines 382-388 (verbatim):
//   const at = new Date(now());
//   if (deps.bypassWindow !== true && !isWithinWorkingHours(at)) {
//     console.log(
//       "fetch-linkedin: outside the working window (Mon-Fri 08:00-21:00 local) — nothing to do",
//     );
//     return { wrote: false, pushed: false, postCount: 0 };
//   }
// (latchPath line 380, rng line 381, and the latch branch 389-394 are
//  untouched — the latch becomes the first gate without moving.)
```

#### 3. tests/linkedin-behavior.test.ts
**File**: `tests/linkedin-behavior.test.ts`
**Changes**: Delete the window imports, the MONDAY/`at` helpers, and the `isWithinWorkingHours` describe.

```typescript
// tests/linkedin-behavior.test.ts — three hunks (anchors verified on disk):
// HUNK A — REPLACE lines 10-21 (the import block, verbatim today:)
//   import assert from "node:assert/strict";
//   import { describe, it } from "node:test";
//   import {
//     HALT_CHECKPOINT_REASON,
//     HALT_RATE_LIMIT_REASON,
//     WAKE_MAX_MS,
//     WAKE_MIN_MS,
//     WINDOW_END_HOUR,
//     WINDOW_START_HOUR,
//     isWithinWorkingHours,
//     sampleTickDelayMs,
//   } from "../src/linkedin-behavior.js";
// with:
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HALT_CHECKPOINT_REASON,
  HALT_RATE_LIMIT_REASON,
  WAKE_MAX_MS,
  WAKE_MIN_MS,
  sampleTickDelayMs,
} from "../src/linkedin-behavior.js";
// HUNK B — DELETE lines 23-28 (verbatim — line 28 is the blank separator;
// deleting only 23-27 leaves a double blank that biome's formatter collapses
// and the lint gate then flags):
//   /** 2026-10-26 is a Monday; Oct 31 is the Saturday, Nov 1 the Sunday. */
//   const MONDAY = { y: 2026, m: 9, d: 26 };
//
//   const at = (y: number, m: number, d: number, hour: number, min = 0, sec = 0, ms = 0): Date =>
//     new Date(y, m, d, hour, min, sec, ms);
// (seededRng and the sampleTickDelayMs describe survive unchanged.)
// HUNK C — DELETE lines 38-64 (the whole describe PLUS its trailing blank
// line — same double-blank guard as HUNK B):
//   describe("isWithinWorkingHours", () => { ... });   // through its closing });
```

#### 4. tests/fetch-linkedin.test.ts
**File**: `tests/fetch-linkedin.test.ts`
**Changes**: Strip the 16 `bypassWindow: true,` injections, reword the header band line, and replace the band describe with the four-pin block.

```typescript
// tests/fetch-linkedin.test.ts — four hunks (anchors verified on disk):
// HUNK A — DELETE the 15 single lines reading "bypassWindow: true," at
//   418, 471, 505, 542, 573, 597, 615, 632, 667, 701, 890, 916, 944, 979, 1038
//   (each one line inside a fetchTick deps object; nothing else changes there).
//   The 16th injection (line 822) dies inside HUNK C's block replacement below.
//   All line numbers are HEAD-relative (commit be5407a) and content-anchored:
//   apply each hunk by content, never by re-counting after an earlier hunk
//   shifts the file.
// HUNK B — REPLACE line 11 (verbatim today:)
//    * band: window -> latch -> checkout guard BEFORE any browser launch.
// with (one line — the epitaph's literal and stamp share it):
//    * band: latch -> checkout guard BEFORE any browser launch (the working-hours window removed 2026-11-15).
//   (line 10 ends "...trips the halt latch with the canonical reason), and the preflight" — it stays.)
// HUNK C — REPLACE lines 807-870 (the band describe) with the block below.
// --- the preflight band (latch -> checkout guard; the window gate removed 2026-11-15) ---

describe("the preflight band (latch -> checkout guard)", () => {
  it("blocks a latched tick: zero browser builds, zero git spawns, quiet zeros", async () => {
    const latchPath = await workPath("latch-9.flag");
    await writeFile(latchPath, "LinkedIn security checkpoint\n", "utf8");
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit();
    const result = await fetchTick({
      config: CONFIG,
      contextFactory,
      git,
      payloadPath: await workPath("payload-latched.json"),
      latchPath,
      env: {},
    });
    assert.deepEqual(result, { wrote: false, pushed: false, postCount: 0 });
    assert.equal(built.value, 0);
    assert.equal(git.calls.length, 0);
  });

  it("a Saturday-noon tick proceeds to the checkout guard (no day-of-week gate)", async () => {
    const saturdayNoon = new Date(2026, 9, 31, 12, 0).getTime(); // 2026-10-31 is a Saturday
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit(); // unscripted rev-parse -> empty branch -> /not main/
    await assert.rejects(
      async () =>
        fetchTick({
          config: CONFIG,
          contextFactory,
          git,
          payloadPath: await workPath("payload-weekend.json"),
          latchPath: await workPath("latch-10.flag"),
          now: () => saturdayNoon,
          env: {},
        }),
      /not main/,
    );
    assert.ok(git.calls.length >= 1); // the band let it through to the guard
    assert.equal(built.value, 0); // the guard threw before any browser was built
  });

  it("any weekday clock reaches the checkout guard (Monday 10:00 local, latch absent)", async () => {
    const mondayTen = new Date(2026, 9, 26, 10, 0).getTime(); // 2026-10-26 is a Monday
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit({ "rev-parse": { code: 0, output: "feature\n" } });
    await assert.rejects(
      async () =>
        fetchTick({
          config: CONFIG,
          contextFactory,
          git,
          payloadPath: await workPath("payload-weekday.json"),
          latchPath: await workPath("latch-11.flag"),
          now: () => mondayTen,
          env: {},
        }),
      /not main/,
    );
    assert.ok(git.calls.length >= 1); // the band let it through to the guard
    assert.equal(built.value, 0); // the guard threw before any browser was built
  });

  it("a Wednesday-night tick proceeds to the checkout guard (no hours gate)", async () => {
    const wednesdayNight = new Date(2026, 9, 28, 23, 30).getTime(); // 2026-10-28 is a Wednesday
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({ built, script: {} });
    const git = scriptGit(); // unscripted rev-parse -> empty branch -> /not main/
    await assert.rejects(
      async () =>
        fetchTick({
          config: CONFIG,
          contextFactory,
          git,
          payloadPath: await workPath("payload-night.json"),
          latchPath: await workPath("latch-12.flag"),
          now: () => wednesdayNight,
          env: {},
        }),
      /not main/,
    );
    assert.ok(git.calls.length >= 1); // no clock gate held
    assert.equal(built.value, 0); // the guard threw before any browser was built
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] `grep -rn "bypassWindow\|isWithinWorkingHours\|WINDOW_START_HOUR\|WINDOW_END_HOUR" src tests scripts` returns zero hits
- [x] `grep -rn "working-hours" src/linkedin-behavior.ts scripts/fetch-linkedin.ts tests/linkedin-behavior.test.ts tests/fetch-linkedin.test.ts` returns EXACTLY three lines — the deletion epitaphs in src/linkedin-behavior.ts (header), scripts/fetch-linkedin.ts (band comment), and tests/fetch-linkedin.test.ts (header) — each carrying BOTH the literal and its 2026-11-15 stamp on the SAME line, so `| grep -v "2026-11-15"` returns zero. The epitaphs keep the machine's real name (the src/linkedin-behavior.ts:2-4 idiom) so a future reader can connect them to the FRD and git history. The repo-wide end-state check (zero unstamped hits across src tests scripts) is Slice 2's criterion — HEAD's four remaining carriers (src/config-file.ts:75, src/linkedin-capture.ts:41, scripts/linkedin-chain.ts:21, scripts/watch-linkedin.ts:4) die there
- [x] `grep -rn "working day" src/linkedin-behavior.ts scripts/fetch-linkedin.ts tests/linkedin-behavior.test.ts tests/fetch-linkedin.test.ts` returns zero hits — the repo-wide check is Slice 2's criterion (scripts/replay-linkedin.ts:54,73,79 are the last carriers)
- [x] `npm run typecheck` passes — excess-property checking proves all 16 injections are gone
- [x] `npm run lint` passes — biome flags the orphaned import, any unused helper (MONDAY/at), AND any double-blank-line residue (both delete hunks include their trailing blanks)
- [x] `npm test` passes — the inverted Saturday pin, the retitled Monday pin, and the new Wednesday-night pin all pass; the behavior suite's cadence + halt-vocabulary describes pass unchanged
- [x] `npm run knip` passes — no surviving window export

#### Manual Verification:
- [x] Reading scripts/fetch-linkedin.ts:374-396 shows the latch as the first gate with no clock read (the "Order:" comment is grep-invisible — read the band)
- [x] The four band tests each name the observable outcome (latched block, Saturday proceeds, weekday proceeds, night proceeds)

---

## Phase 2: Doc sweep + 24/7 recomputation

### Overview

Prose-only sweep: drop the window from every doc claim, recompute the three cadence-derived claims to the 24/7 bound, and drop the dead daily-budget half from the watch header. No executable behavior changes.

### Changes Required:

#### 1. scripts/linkedin-chain.ts
**File**: `scripts/linkedin-chain.ts`
**Changes**: Header gate list drops the window; the quiet-zero gate count reads four.

```typescript
// scripts/linkedin-chain.ts — two hunks (anchors verified on disk):
// HUNK A — REPLACE lines 21-22 (verbatim today:)
//   * gates (working-hours window, halt latch, halt trip, all-faulted walk,
//   * zero surfaces) are OUTCOMES, not failures (the defb8af rule): the chain
// with (line 23 " * reports the no-op shape and exits 0." is untouched):
 * gates (halt latch, halt trip, all-faulted walk, zero surfaces) are
 * OUTCOMES, not failures (the defb8af rule): the chain
// HUNK B — REPLACE line 112 (verbatim today:)
//   // Quiet-zero classification reads the RESULT, not an exit code (D3): five
// with (the chain's own gate list drops the window, so the count follows):
  // Quiet-zero classification reads the RESULT, not an exit code (D3): four
```

#### 2. scripts/watch-linkedin.ts
**File**: `scripts/watch-linkedin.ts`
**Changes**: Header names only the halt latch — no window claim, no dead "daily budget" half.

```typescript
// scripts/watch-linkedin.ts — REPLACE lines 2-9 (the header paragraph; it today
// reads "Every fetch gate (the working-hours window, the halt latch, the daily
// budget) rides fetchTick") with (the window AND the dead daily-budget half die
// — the budget machine was deleted by the browser-walk migration 2026-11-11;
// the block stays 8 lines):
 * The always-on PC loop (design 2026-11-09, the anti-restriction
 * profile): one fetch tick, then a jittered 28-33-minute sleep, forever.
 * Every fetch gate (the halt latch) rides fetchTick — the loop stays a
 * dumb cadence: tick, sleep, repeat. Leg-dead edges send ONE alarm per
 * episode (the marker file in scripts/fetch-linkedin.ts) and the loop
 * keeps running — a cookie-file refresh self-heals on a later tick
 * without a restart. Any other tick fault warns and the loop continues;
 * Ctrl-C stops it.
```

#### 3. src/config-file.ts
**File**: `src/config-file.ts`
**Changes**: FR-8 comment bounds the five-surface fleet by cadence x click cap only.

```typescript
// src/config-file.ts — REPLACE lines 73-80 (the FR-8 doc comment) with
// (the window conjunct drops — the bound is cadence x click cap only;
// line 81 "const LINKEDIN_SURFACE_COUNT = 5;" is untouched):
/**
 * FR-8 (browser-walk migration 2026-11-11): exactly 5 linkedin surfaces —
 * the PC leg's account-safety bound (the jittered cadence, times the
 * per-surface scrollRounds click cap) is calibrated for a five-surface
 * fleet. The count is the invariant, not the keywords: an operator may
 * swap a surface's value, never grow the fleet.
 */
```

#### 4. src/linkedin-capture.ts
**File**: `src/linkedin-capture.ts`
**Changes**: Retention math recomputed to 24/7 (~44-52 walks/day, ~3.7-4.3 GB/day).

```typescript
// src/linkedin-capture.ts — REPLACE lines 35-45 (the retention doc comment)
// with the D5 24/7 recomputation (1440 min over the 28-33-minute wake band
// = ~44-52 walks/day; at the measured ~85 MB/walk that is ~3.7-4.3 GB/day;
// line 46 "export const CAPTURE_KEEP_SESSIONS = 20;" is untouched):
/**
 * Retention for the captures root (follow-up 2026-11-13): after each write
 * the sink prunes session-stamp directories beyond the newest N. MEASURED
 * session (2026-11-13: one surface, 54 bodies): ~85 MB per walk — the
 * unmatched diagnostic arm records the SSR firehose bodies that dominate
 * the bytes, which the first estimate's 2-6 MB per walk never counted.
 * At the 24/7 cadence (44-52 walks per day; 1440 minutes over the
 * 28-33-minute wake band) that is ~3.7-4.3 GB of write churn per day; the
 * DISK bound is not monthly growth but keep-N × ~85 MB (~1.7 GB
 * steady-state at 20), with no alarm when the disk fills (D4's own
 * silent-void rationale).
 */
```

#### 5. scripts/replay-linkedin.ts
**File**: `scripts/replay-linkedin.ts`
**Changes**: "one working day" -> ~9-11 hours in all three carriers (header usage, USAGE doc, USAGE string).

```typescript
// scripts/replay-linkedin.ts — three hunks (anchors verified on disk):
// HUNK A — REPLACE lines 54-55 (the header Usage tail, verbatim today:)
//   *   (captures roll off after ~20 sessions — one working day; copy captures/
//   *   out first — CAPTURE_KEEP_SESSIONS, src/linkedin-capture.ts)
// with (line 53 " * Usage: npx tsx ..." is untouched):
 *   (captures roll off after ~20 sessions — about 9-11 hours at the 24/7
 *   loop cadence; copy captures/ out first — CAPTURE_KEEP_SESSIONS,
 *   src/linkedin-capture.ts)
// HUNK B — REPLACE lines 70-75 (the USAGE doc body; lines 69 "/**" and 76
// " */" are untouched) with:
 * The usage line — the zero-argv gate's message, printed bare by the CLI
 * wrapper. Carries the retention window (CAPTURE_KEEP_SESSIONS,
 * src/linkedin-capture.ts): evidence rolls off after ~20 sessions — about
 * 9-11 hours at the 24/7 loop cadence — so replay promptly or copy
 * captures/ out first (the operator-visible half of D8; a silent roll-off
 * would void the capture premise on D4's slower clock).
// HUNK C — REPLACE line 79 (the USAGE string tail, verbatim today:)
//   " — captures roll off after ~20 sessions (one working day); copy captures/ out first";
// with:
  " — captures roll off after ~20 sessions (about 9-11 hours); copy captures/ out first";
// Test-safety (verified on disk): tests/replay-linkedin.test.ts:189-197 pins
// the zero-argv gate with the PREFIX regex
// /^replay: usage — npx tsx scripts\/replay-linkedin\.ts/ — the string tail
// swap stays green; no test edits belong to this slice.
```

#### 6. AGENTS.md
**File**: `AGENTS.md`
**Changes**: Chain quiet-zero list drops the window; the behavior machine list drops the window.

```markdown
<!-- AGENTS.md — two hunks (anchors verified on disk): -->
<!-- HUNK A — REPLACE lines 57-59 (the chain bullet's quiet-zero tail): -->
  later stages when `.env` has no cookie line yet; a quiet-zero tick
  (halt latch, halt trip, all-faulted walk, zero surfaces) is a reported
  no-op with exit 0; any stage failure exits 1
<!-- HUNK B — REPLACE lines 103-105 (the src/linkedin-behavior.ts bullet): -->
- `src/linkedin-behavior.ts` - the PC leg's pure policy machines: the
  jittered 28-33-minute wake cadence and the halt-latch reason vocabulary
```

#### 7. .rpiv/guidance/scripts/architecture.md
**File**: `.rpiv/guidance/scripts/architecture.md`
**Changes**: Chain exit contract + fetch structure comment + exit-contract row drop the window.

```markdown
<!-- .rpiv/guidance/scripts/architecture.md — three hunks (anchors verified on
<!-- disk). HUNK A — line 10 (the Invokers chain bullet): the phrase
<!-- "(working-hours window, halt latch, halt trip, all-faulted walk, zero
<!-- surfaces)" becomes "(halt latch, halt trip, all-faulted walk, zero
<!-- surfaces)"; the rest of the line is untouched. -->
<!-- HUNK B — line 32 (the fetch-linkedin.ts structure row), verbatim today: -->
                             #   (the working-hours window and the checkpoint latch, then guardCheckout:
<!-- becomes: -->
                             #   (the checkpoint latch, then guardCheckout:
<!-- HUNK C — REPLACE lines 112-114 (the exit-contract chain row) with: -->
linkedin-chain.ts           exit 0 when all three stages ran — a quiet-zero tick (halt latch, halt trip,
                            all-faulted walk, zero surfaces) is a REPORTED NO-OP, still exit 0 (defb8af);
                            exit 1 when any stage throws — the wrapper prints
<!-- (line 115 "`linkedin-chain: FAILED — <gate>`; INTERACTIVE ..." is untouched.) -->
```

### Success Criteria:

#### Automated Verification:
- [x] `grep -rn "working-hours" src tests scripts *.md .github .claude .cursor .rpiv/guidance | grep -c "2026-11-15"` returns exactly 3 — the sole survivors are the Slice-1 epitaphs (src/linkedin-behavior.ts header, scripts/fetch-linkedin.ts band comment, tests/fetch-linkedin.test.ts header), each stamped on its own line (scope includes .rpiv/guidance — the tracked live doc this slice edits)
- [x] `grep -rn "working-hours" src tests scripts *.md .github .claude .cursor .rpiv/guidance | grep -v "2026-11-15"` returns zero — the nine live carriers (src/config-file.ts:75, src/linkedin-capture.ts:41, scripts/linkedin-chain.ts:21, scripts/watch-linkedin.ts:4, AGENTS.md:58+104, .rpiv/guidance/scripts/architecture.md:10+32+112) are gone (D6 end-state, widened scope)
- [x] `grep -rn "working day" src tests scripts *.md .github .claude .cursor .rpiv/guidance` returns zero — scripts/replay-linkedin.ts:54,73,79 (the last carriers) are gone (D6, second literal, widened scope)
- [x] `grep -c "9-11 hours" scripts/replay-linkedin.ts` returns 3 — header usage, USAGE doc, USAGE string (the D5 recomputation landed in all three carriers)
- [x] `grep -n "44-52 walks per day" src/linkedin-capture.ts` returns 1 — the capture churn claim reads the 24/7 bound
- [x] `grep -n "(D3): four" scripts/linkedin-chain.ts` returns 1 — the chain's quiet-zero gate count reads four
- [x] `npm run typecheck` passes
- [x] `npm run lint` passes
- [x] `npm test` passes — the replay zero-argv pin (tests/replay-linkedin.test.ts:197 regexes the usage prefix only) stays green on the new USAGE string
- [x] The two commits stay split: `git show --stat --format="%h %s" HEAD~1 HEAD` — the older commit's file set equals Phase 1's four files, the newer equals Phase 2's seven files (the design's `8e8f22b` + `a88494e` two-commit shape)

#### Manual Verification:
- [ ] LIVE REHEARSAL (Ordering Constraints; the `8e8f22b` precedent risk — "mandatory, not optional"): after both commits land, from the dedicated clone, run one tick outside the old window — `npm run fetch-linkedin` — and confirm the walk completes (a written/pushed payload, or a tagged no-op with exit 0); the line `fetch-linkedin: outside the working window` must not appear
- [x] scripts/watch-linkedin.ts header names only the halt latch — no window claim, no dead "daily budget" half
- [x] src/config-file.ts FR-8 comment bounds the five-surface fleet by cadence x click cap only
- [x] AGENTS.md and .rpiv/guidance/scripts/architecture.md read consistently: the chain quiet-zero list is the same four gates in both (halt latch, halt trip, all-faulted walk, zero surfaces)

---

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 1 §4 (fetch-linkedin.test.ts) | tests/fetch-linkedin.test.ts:822 | concern | actionability | HUNK A's 16-line deletion list includes line 822, which sits inside the 807-870 block HUNK C replaces wholesale — applying HUNK A's line-number deletions first shifts the band describe to 807-869 so a literal `REPLACE lines 807-870` swallows old line 871 (blank) and the `describe("the scrollRounds click bound...")` opener, and applying HUNK C first (net +~23 lines) invalidates HUNK A's numbers ≥890 | Drop 822 from HUNK A's list ("dies with HUNK C") and add a one-line note that all hunks are content-anchored with HEAD-relative line numbers | applied: 822 dropped from HUNK A's list (dies with HUNK C); HEAD-relative content-anchor note added to the fence |
| code     | Phase 2 §5 (replay-linkedin.ts) | scripts/replay-linkedin.ts:55 | concern | actionability | HUNK A's replacement block writes its third line as `//   src/linkedin-capture.ts)` — carrying the fence's narration `//` prefix inside what must be a JSDoc continuation line, unlike every other replacement block in the plan (HUNK B/C in the same fence are bare) — so a literal application inserts a non-` *` line into the module header | Write the replacement's third line as ` *   src/linkedin-capture.ts)` | applied: third line written as ` *   src/linkedin-capture.ts)` |
| coverage | ## Migration Notes §2 | <n/a> | concern | verification-coverage | Rollback claim "the docs commit reverts independently" (rests on Overview's precedent shape "code excision (`8e8f22b` shape), then a docs-only sweep (`a88494e` shape)") — no Success Criteria bullet verifies the two commits stay split (Phase 2 Manual bullet 1's "after both commits land" presupposes but never checks commit separation), no code fence enforces commit hygiene | Add an automated bullet under Phase 2's `#### Automated Verification:` that runs `git show --stat` on both commits and asserts the code commit touches only the four Phase-1 files and the docs commit only the seven Phase-2 files | applied: Phase 2 automated bullet added — `git show --stat` over both commits, file sets asserted against the phase file lists |
| code     | Phase 2 §4 (linkedin-capture.ts) | src/linkedin-capture.ts:41 | suggestion | code-quality | Phase 2 §4's replacement quantifies the same 1440-min/28-min-floor bound as "43-51 walks per day" (floor convention) while Phase 1 §1's replacement header asserts "at most 52 wake-ups per local day" (ceil convention) — the two edited docs will disagree on the worst case by one | Align both to one convention (e.g. "44-52 walks per day" in the capture comment to match the 52 ceiling) | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md) — capture comment aligned to the 52 ceiling ("44-52 walks per day"); the Phase-2 grep criterion updated in lockstep so it still matches the fence |

---

## Testing Strategy

### Automated:
- Phase 1: `npm run typecheck`, `npm run lint`, `npm test`, `npm run knip` plus the two scoped greps.
- Phase 2: `npm run typecheck`, `npm run lint`, `npm test` plus the widened greps.

### Manual Testing Steps:
1. LIVE REHEARSAL: after both commits land, from the dedicated clone, run `npm run fetch-linkedin` outside the old window and confirm the walk completes (written/pushed payload, or a tagged no-op with exit 0); `fetch-linkedin: outside the working window` must not appear.
2. Read `scripts/fetch-linkedin.ts:374-396` and confirm the latch is the first gate with no clock read.
3. Read `scripts/watch-linkedin.ts` header and confirm only the halt latch is named.
4. Read `src/config-file.ts` FR-8 comment and confirm the bound is cadence x click cap only.
5. Read `AGENTS.md` and `.rpiv/guidance/scripts/architecture.md` and confirm the chain quiet-zero list is the same four gates in both.

## Performance Considerations

Worst-case wake-ups rise from 28 to 52 per local day (1.86x); capture write churn rises from ~2-2.4 GB/day to ~3.7-4.3 GB/day, bounded by `CAPTURE_KEEP_SESSIONS` (~1.7 GB steady-state). No new runtime cost: the change deletes code; the tick spawns one fewer date read.

## Migration Notes

No schema, no state file, no runtime artifact: the window's quiet-zero is stateless (unlike the budget's orphaned ledger). Rollback: `git revert` of the code commit restores the predicate, gate, and seam; the docs commit reverts independently.

## Developer Context

Empty at skeleton write; Step 4.4 fallback notes and any post-write developer interactions land here.

## References

- Design: `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md`
- Research: `.rpiv/artifacts/research/2026-11-15_09-09-30_remove-linkedin-working-window.md`
- Original ticket: `.rpiv/artifacts/discover/2026-11-15_08-44-36_remove-linkedin-working-window.md`
