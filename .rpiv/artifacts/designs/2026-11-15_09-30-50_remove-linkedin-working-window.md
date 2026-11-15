---
date: 2026-11-15T09:30:50+0700
author: Yogiswara Utama
commit: be5407a
branch: main
repository: loker-watcher
topic: "Remove the LinkedIn working-hours window"
tags: [design, linkedin-pc-leg, working-window, fetch-tick, linkedin-behavior]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-15_09-30-50_remove-linkedin-working-window.md
last_updated: 2026-11-15T09:30:50+0700
last_updated_by: Yogiswara Utama
---

# Design: Remove the LinkedIn working-hours window

## Summary
Full excision of the working-hours window from the PC-local LinkedIn leg: the predicate trio in `src/linkedin-behavior.ts`, the preflight gate and `bypassWindow` seam in `scripts/fetch-linkedin.ts`, the 16 test injections, and every doc claim. The halt latch becomes the first preflight gate; every tick runs any day, any hour. Two commits mirror the budget-deletion precedent: code excision (`8e8f22b` shape), then a docs-only sweep (`a88494e` shape).

## Requirements
- Every tick runs on any day at any hour: manual runs, `fetch-linkedin`, `watch-linkedin`, and `linkedin-chain` alike.
- The window predicate, its two constants, the tick gate, the `bypassWindow` seam, and their tests are deleted, not stubbed.
- The three cadence-derived claims are recomputed to the 24/7 bound, not annotated.
- The quiet-zero/exit-0 contract, the halt latch, the leg-dead episode alarm, and the `harvestedAt` stamp gate keep their current behavior.
- No replacement gate and no bypass switch (discover Decision).

## Current State Analysis

### Key Discoveries
- Window trio: `WINDOW_START_HOUR` (`src/linkedin-behavior.ts:26`), `WINDOW_END_HOUR` (:33, exclusive-end half-open contract), `isWithinWorkingHours` (:43-48, local-time only). Module header names the machine twice (:5, :15-19 worst-case arithmetic: 13 h window → 28 wake-ups/local day).
- Sole production consumer: preflight gate `scripts/fetch-linkedin.ts:376-394` — comment (:376-379, "Order: window -> latch"), `at` (:382, sole clock read), gate (:383), quiet-zero return (:384-387).
- Sole bypass seam: `FetchTickDeps.bypassWindow` (`scripts/fetch-linkedin.ts:133-138`), read only at :383; 16 test injections at `tests/fetch-linkedin.test.ts` lines 418, 471, 505, 542, 573, 597, 615, 632, 667, 701, 822, 890, 916, 944, 979, 1038 (verified current at commit be5407a).
- The gate test at `tests/fetch-linkedin.test.ts:830-847` cannot survive removal as-is: with no bypass flag and an unscripted `scriptGit` default (:316-325), post-removal the tick proceeds to `guardCheckout` and throws `/not main/` — the quiet-zero assertion at :844 becomes unreachable. The Monday pin (:849-869) survives verbatim.
- `now` survives the gate deletion at :434 (walk clock), :445 (halt latch stamp), :477 (payload stamp); `at` (:382) is the only time-of-day read that dies.
- Six quiet-zero return sites today (zero-surfaces :374, window gate :387, latch :393, halt trip :448, all-faulted :459, zero-post :475); five survive. The chain classifier (`scripts/linkedin-chain.ts:116`) is shape-only — behaviorally immune.
- Precedent: `8e8f22b` (2026-11-11) deleted the daily GET budget machine from the same module through the same gate band, single-commit, 25 files, 2,155+/2,790−; docs swept 78 seconds later in `a88494e` (7 files, docs-only). The window itself landed single-commit in `7558747` (23 files, 1,969+/235−).
- Guards: tsconfig has NO `noUnusedLocals`; biome recommended catches the unused import; knip (CI, `.github/workflows/ci.yml:36`) catches dead exports; excess-property checking sweeps the 16 injections.
- Invisible-to-grep sites: `scripts/fetch-linkedin.ts:379` ("Order: window -> latch", no window vocabulary) and `scripts/replay-linkedin.ts:54,72-73,79` ("one working day", invisible to bare `working-hours`).

## Scope

### Building
- Slice 1 (code commit): the excision — behavior trio + header reword, gate + seam + band comment, the 16 injections, the test inversion, the new out-of-hours pin, the Monday retitle.
- Slice 2 (docs commit): the lockstep doc sweep and the 24/7 recomputation of the three cadence-derived claims.
- Verification: the two greps (`working-hours` AND `working day`), the four gates, and a live rehearsal.

### Not Building
- Any replacement gate or bypass switch (discover Decision).
- Any cadence retune — the `PAYLOAD_MAX_AGE_MS` 40-min freshness margin (`src/linkedin-payload.ts:38`) is sized against the 33-min wake ceiling; touching cadence re-opens that contract.
- The `harvestedAt` stamp AGE check — the FRD's flagged follow-up, more load-bearing under 24/7, deserves its own change.
- README edit (verified clean — zero vocabulary hits).
- The stale knip line in `.rpiv/guidance/.github/workflows/architecture.md` (guidance lists typecheck → lint → test; CI runs knip at `ci.yml:36`) — adjacent debt, not this change.

## Decisions

### D1: Excision, not stub
**Ambiguity**: keep an always-true predicate (smallest diff) vs delete the trio. **Explored**: Option A (stub) leaves every guard blind — no `noUnusedLocals`, biome fires nothing on a constant-returning function, knip cannot flag a symbol with a live importer — and both test files still break (constants imported at `tests/linkedin-behavior.test.ts:17-18`, describe :38-63 fails). Option B (excision) makes every guard enforce the deletion-set. **Decision**: excision. History comments remember deleted machines (`src/linkedin-behavior.ts:2-4`), never stubs.

### D2: Commit shape — code then docs
**Ambiguity**: one atomic commit vs the precedent's split. **Explored**: `8e8f22b` (code, 25 files) then `a88494e` (docs-only, 7 files) 78 seconds later; the doctrine line says sweep in the same commit. **Decision**: mirror the precedent — two commits, code first. Slices map 1:1 to commits.

### D3: Test inversion — Saturday-noon becomes a proceeds-pin
**Ambiguity**: delete the doomed test vs invert it. **Explored**: post-removal the same deps (no bypass flag, unscripted `scriptGit` default :316-325) reach `guardCheckout` and throw `/not main/` — the quiet-zero assertion at :844 is unreachable. **Decision**: invert into a proceeds-pin asserting the `/not main/` throw with zero browser builds; it blocks day-of-week gate reintroduction.

### D4: New out-of-hours weekday proceeds-pin
**Ambiguity**: neither surviving pinned clock (Saturday noon, Monday 10:00) defeats an hours-only gate reintroduction — a 08-21-every-day gate admits both. **Decision**: add one weekday out-of-hours pin (Wednesday 23:30 local) asserting the tick proceeds to `guardCheckout`.

### D5: Cadence claims recomputed to 24/7
**Ambiguity**: annotate vs recompute. **Explored**: 1440/28 = 52 wake-ups/day (1.86× the old 28); capture churn 1440/33 ≈ 43.6 to 1440/28 ≈ 51.4 walks/day × ~85 MB ≈ 3.7-4.3 GB/day; 20 sessions ÷ 43-51 ≈ 9-11 hours. **Decision**: recompute all three (`src/linkedin-behavior.ts:15-19`, `src/linkedin-capture.ts:41`, `scripts/replay-linkedin.ts:54,71-80`).

### D6: Verification greps — two literals
**Ambiguity**: the FRD's six-literal alternation misses `scripts/replay-linkedin.ts`'s "one working day" phrasing. **Decision**: verify with bare `working-hours` AND bare `working day` (zero false positives across live paths for both).

## Architecture

### src/linkedin-behavior.ts:1-48 — MODIFY

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

### scripts/fetch-linkedin.ts:39,133-138,376-388 — MODIFY

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

### tests/linkedin-behavior.test.ts:10-21,23-28,38-64 — MODIFY

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

### tests/fetch-linkedin.test.ts — MODIFY (16 discrete injection sites: 418, 471, 505, 542, 573, 597, 615, 632, 667, 701, 822, 890, 916, 944, 979, 1038; band describe 807-870)

```typescript
// tests/fetch-linkedin.test.ts — four hunks (anchors verified on disk):
// HUNK A — DELETE the 16 single lines reading "bypassWindow: true," at
//   418, 471, 505, 542, 573, 597, 615, 632, 667, 701, 822, 890, 916, 944, 979, 1038
//   (each one line inside a fetchTick deps object; nothing else changes there).
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

#### Automated Verification:
- [ ] `grep -rn "bypassWindow\|isWithinWorkingHours\|WINDOW_START_HOUR\|WINDOW_END_HOUR" src tests scripts` returns zero hits
- [ ] `grep -rn "working-hours" src/linkedin-behavior.ts scripts/fetch-linkedin.ts tests/linkedin-behavior.test.ts tests/fetch-linkedin.test.ts` returns EXACTLY three lines — the deletion epitaphs in src/linkedin-behavior.ts (header), scripts/fetch-linkedin.ts (band comment), and tests/fetch-linkedin.test.ts (header) — each carrying BOTH the literal and its 2026-11-15 stamp on the SAME line, so `| grep -v "2026-11-15"` returns zero. The epitaphs keep the machine's real name (the src/linkedin-behavior.ts:2-4 idiom) so a future reader can connect them to the FRD and git history. The repo-wide end-state check (zero unstamped hits across src tests scripts) is Slice 2's criterion — HEAD's four remaining carriers (src/config-file.ts:75, src/linkedin-capture.ts:41, scripts/linkedin-chain.ts:21, scripts/watch-linkedin.ts:4) die there
- [ ] `grep -rn "working day" src/linkedin-behavior.ts scripts/fetch-linkedin.ts tests/linkedin-behavior.test.ts tests/fetch-linkedin.test.ts` returns zero hits — the repo-wide check is Slice 2's criterion (scripts/replay-linkedin.ts:54,73,79 are the last carriers)
- [ ] `npm run typecheck` passes — excess-property checking proves all 16 injections are gone
- [ ] `npm run lint` passes — biome flags the orphaned import, any unused helper (MONDAY/at), AND any double-blank-line residue (both delete hunks include their trailing blanks)
- [ ] `npm test` passes — the inverted Saturday pin, the retitled Monday pin, and the new Wednesday-night pin all pass; the behavior suite's cadence + halt-vocabulary describes pass unchanged
- [ ] `npm run knip` passes — no surviving window export

#### Manual Verification:
- [ ] Reading scripts/fetch-linkedin.ts:374-396 shows the latch as the first gate with no clock read (the "Order:" comment is grep-invisible — read the band)
- [ ] The four band tests each name the observable outcome (latched block, Saturday proceeds, weekday proceeds, night proceeds)
```

### scripts/linkedin-chain.ts:21-22,112-115 — MODIFY

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

### scripts/watch-linkedin.ts:2-9 — MODIFY

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

### src/config-file.ts:73-81 — MODIFY

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

### src/linkedin-capture.ts:35-46 — MODIFY

```typescript
// src/linkedin-capture.ts — REPLACE lines 35-45 (the retention doc comment)
// with the D5 24/7 recomputation (1440 min over the 28-33-minute wake band
// = ~43-51 walks/day; at the measured ~85 MB/walk that is ~3.7-4.3 GB/day;
// line 46 "export const CAPTURE_KEEP_SESSIONS = 20;" is untouched):
/**
 * Retention for the captures root (follow-up 2026-11-13): after each write
 * the sink prunes session-stamp directories beyond the newest N. MEASURED
 * session (2026-11-13: one surface, 54 bodies): ~85 MB per walk — the
 * unmatched diagnostic arm records the SSR firehose bodies that dominate
 * the bytes, which the first estimate's 2-6 MB per walk never counted.
 * At the 24/7 cadence (43-51 walks per day; 1440 minutes over the
 * 28-33-minute wake band) that is ~3.7-4.3 GB of write churn per day; the
 * DISK bound is not monthly growth but keep-N × ~85 MB (~1.7 GB
 * steady-state at 20), with no alarm when the disk fills (D4's own
 * silent-void rationale).
 */
```

### scripts/replay-linkedin.ts:53-55,69-79 — MODIFY

```typescript
// scripts/replay-linkedin.ts — three hunks (anchors verified on disk):
// HUNK A — REPLACE lines 54-55 (the header Usage tail, verbatim today:)
//   *   (captures roll off after ~20 sessions — one working day; copy captures/
//   *   out first — CAPTURE_KEEP_SESSIONS, src/linkedin-capture.ts)
// with (line 53 " * Usage: npx tsx ..." is untouched):
 *   (captures roll off after ~20 sessions — about 9-11 hours at the 24/7
 *   loop cadence; copy captures/ out first — CAPTURE_KEEP_SESSIONS,
//   src/linkedin-capture.ts)
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

### AGENTS.md:58-59,103-105 — MODIFY

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

### .rpiv/guidance/scripts/architecture.md:10,32,112-114 — MODIFY

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

## Slices

### Slice 1: Code excision

**Files**: `src/linkedin-behavior.ts`, `scripts/fetch-linkedin.ts`, `tests/linkedin-behavior.test.ts`, `tests/fetch-linkedin.test.ts`

#### Automated Verification:
- [ ] `grep -rn "bypassWindow\|isWithinWorkingHours\|WINDOW_START_HOUR\|WINDOW_END_HOUR" src tests scripts` returns zero hits
- [ ] `grep -rn "working-hours" src/linkedin-behavior.ts scripts/fetch-linkedin.ts tests/linkedin-behavior.test.ts tests/fetch-linkedin.test.ts` returns EXACTLY three lines — the deletion epitaphs in src/linkedin-behavior.ts (header), scripts/fetch-linkedin.ts (band comment), and tests/fetch-linkedin.test.ts (header) — each carrying BOTH the literal and its 2026-11-15 stamp on the SAME line, so `| grep -v "2026-11-15"` returns zero. The epitaphs keep the machine's real name (the src/linkedin-behavior.ts:2-4 idiom) so a future reader can connect them to the FRD and git history. The repo-wide end-state check (zero unstamped hits across src tests scripts) is Slice 2's criterion — HEAD's four remaining carriers (src/config-file.ts:75, src/linkedin-capture.ts:41, scripts/linkedin-chain.ts:21, scripts/watch-linkedin.ts:4) die there
- [ ] `grep -rn "working day" src/linkedin-behavior.ts scripts/fetch-linkedin.ts tests/linkedin-behavior.test.ts tests/fetch-linkedin.test.ts` returns zero hits — the repo-wide check is Slice 2's criterion (scripts/replay-linkedin.ts:54,73,79 are the last carriers)
- [ ] `npm run typecheck` passes — excess-property checking proves all 16 injections are gone
- [ ] `npm run lint` passes — biome flags the orphaned import, any unused helper (MONDAY/at), AND any double-blank-line residue (both delete hunks include their trailing blanks)
- [ ] `npm test` passes — the inverted Saturday pin, the retitled Monday pin, and the new Wednesday-night pin all pass; the behavior suite's cadence + halt-vocabulary describes pass unchanged
- [ ] `npm run knip` passes — no surviving window export

#### Manual Verification:
- [ ] Reading scripts/fetch-linkedin.ts:374-396 shows the latch as the first gate with no clock read (the "Order:" comment is grep-invisible — read the band)
- [ ] The four band tests each name the observable outcome (latched block, Saturday proceeds, weekday proceeds, night proceeds)



### Slice 2: Doc sweep + 24/7 recomputation

**Files**: `scripts/linkedin-chain.ts`, `scripts/watch-linkedin.ts`, `src/config-file.ts`, `src/linkedin-capture.ts`, `scripts/replay-linkedin.ts`, `AGENTS.md`, `.rpiv/guidance/scripts/architecture.md`

#### Automated Verification:
- [ ] `grep -rn "working-hours" src tests scripts *.md .github .claude .cursor .rpiv/guidance | grep -c "2026-11-15"` returns exactly 3 — the sole survivors are the Slice-1 epitaphs (src/linkedin-behavior.ts header, scripts/fetch-linkedin.ts band comment, tests/fetch-linkedin.test.ts header), each stamped on its own line (scope includes .rpiv/guidance — the tracked live doc this slice edits)
- [ ] `grep -rn "working-hours" src tests scripts *.md .github .claude .cursor .rpiv/guidance | grep -v "2026-11-15"` returns zero — the nine live carriers (src/config-file.ts:75, src/linkedin-capture.ts:41, scripts/linkedin-chain.ts:21, scripts/watch-linkedin.ts:4, AGENTS.md:58+104, .rpiv/guidance/scripts/architecture.md:10+32+112) are gone (D6 end-state, widened scope)
- [ ] `grep -rn "working day" src tests scripts *.md .github .claude .cursor .rpiv/guidance` returns zero — scripts/replay-linkedin.ts:54,73,79 (the last carriers) are gone (D6, second literal, widened scope)
- [ ] `grep -c "9-11 hours" scripts/replay-linkedin.ts` returns 3 — header usage, USAGE doc, USAGE string (the D5 recomputation landed in all three carriers)
- [ ] `grep -n "43-51 walks per day" src/linkedin-capture.ts` returns 1 — the capture churn claim reads the 24/7 bound
- [ ] `grep -n "(D3): four" scripts/linkedin-chain.ts` returns 1 — the chain's quiet-zero gate count reads four
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes — the replay zero-argv pin (tests/replay-linkedin.test.ts:197 regexes the usage prefix only) stays green on the new USAGE string

#### Manual Verification:
- [ ] LIVE REHEARSAL (Ordering Constraints; the `8e8f22b` precedent risk — "mandatory, not optional"): after both commits land, from the dedicated clone, run one tick outside the old window — `npm run fetch-linkedin` — and confirm the walk completes (a written/pushed payload, or a tagged no-op with exit 0); the line `fetch-linkedin: outside the working window` must not appear
- [ ] scripts/watch-linkedin.ts header names only the halt latch — no window claim, no dead "daily budget" half
- [ ] src/config-file.ts FR-8 comment bounds the five-surface fleet by cadence x click cap only
- [ ] AGENTS.md and .rpiv/guidance/scripts/architecture.md read consistently: the chain quiet-zero list is the same four gates in both (halt latch, halt trip, all-faulted walk, zero surfaces)

## Desired End State
```typescript
// src/linkedin-behavior.ts — the window machine is gone; the module keeps
// the cadence + halt vocabulary and a 24/7 worst-case bound.
export const WAKE_MIN_MS = 28 * 60_000;
export const WAKE_MAX_MS = 33 * 60_000;
export function sampleTickDelayMs(rng: RandomFn): number { /* unchanged */ }
export const HALT_RATE_LIMIT_REASON =
  "HTTP 429 rate limit — LinkedIn told this account to slow down";
export const HALT_CHECKPOINT_REASON =
  "LinkedIn security checkpoint or login wall — re-harvest the session (npm run login-linkedin)";
```
```typescript
// scripts/fetch-linkedin.ts — the preflight band starts at the latch;
// guardCheckout is the second gate; no clock read for gating.
const latchPath = deps.latchPath ?? DEFAULT_LATCH;
const rng = deps.rng ?? Math.random;
if (await latchPresent(latchPath)) { /* quiet zeros */ }
await guardCheckout(deps.git ?? realGit);
```
```typescript
// A Saturday-noon tick now traverses the full band:
// latch (absent) → guardCheckout (main + clean) → cookies → stamp → walk.
```

## File Map
- `src/linkedin-behavior.ts`  # MODIFY — delete the window trio + reword the header arithmetic to 24/7
- `scripts/fetch-linkedin.ts`  # MODIFY — delete the import, the seam, the band comment, `at`, the gate
- `tests/linkedin-behavior.test.ts`  # MODIFY — delete the window imports + predicate describe
- `tests/fetch-linkedin.test.ts`  # MODIFY — strip 16 injections; invert :830-847; retitle :849-869; add the out-of-hours pin
- `scripts/linkedin-chain.ts`  # MODIFY — header gate list + five→four count
- `scripts/watch-linkedin.ts`  # MODIFY — header: drop the window + the dead "daily budget" half
- `src/config-file.ts`  # MODIFY — FR-8 comment: drop the window conjunct
- `src/linkedin-capture.ts`  # MODIFY — retention math to 24/7 (~43-51 walks/day, ~3.7-4.3 GB/day)
- `scripts/replay-linkedin.ts`  # MODIFY — "one working day" → ~9-11 hours (header + USAGE doc + USAGE string)
- `AGENTS.md`  # MODIFY — chain quiet-zero list + behavior machine list
- `.rpiv/guidance/scripts/architecture.md`  # MODIFY — chain exit contract + fetch structure comment + exit-contract row

## Ordering Constraints
- Slice 1 must land first and alone: it is the only atom that keeps all four gates green (typecheck, lint, test, knip). A partial excision fails typecheck (the 16 injections) or knip (dead exports).
- Slice 2 is prose-only (comments + .md); it can land immediately after Slice 1 (the `a88494e` pattern) and touches no executable behavior.
- The live rehearsal runs after both commits, from the dedicated clone.
- No file is touched by both slices — the split is clean.

## Verification Notes
- `grep -rn "working-hours" src tests scripts *.md .github .claude .cursor` returns exactly the deletion epitaphs, each stamped 2026-11-15 (`| grep -v "2026-11-15"` returns zero) — the epitaphs keep the machine's real name per the src/linkedin-behavior.ts:2-4 idiom. This supersedes the solutions artifact's zero-hits wording. END-STATE CHECK — passes only after Slice 2 lands (HEAD's four remaining carriers: src/config-file.ts:75, src/linkedin-capture.ts:41, scripts/linkedin-chain.ts:21, scripts/watch-linkedin.ts:4); Slice 1's lock gate runs the same grep scoped to its four files.
- `grep -rn "working day" src tests scripts *.md` returns zero hits — the second literal, added because replay's phrasing is invisible to the first. No epitaph uses it, so no carve-out applies. END-STATE CHECK — passes only after Slice 2 (scripts/replay-linkedin.ts:54,73,79 are the last carriers); Slice 1's lock gate scopes it to its four files.
- `scripts/fetch-linkedin.ts:379` ("Order: window -> latch") carries no window vocabulary — read the band, do not rely on grep, to confirm it is gone.
- `npm run typecheck` — excess-property checking sweeps the 16 injections; a missed one fails here.
- `npm run lint` — biome recommended flags the orphaned import at `scripts/fetch-linkedin.ts:39`.
- `npm test` — the inverted Saturday pin and the new out-of-hours pin both pass; the chain/watch suites are untouched by construction.
- `npm run knip` — CI runs it (`ci.yml:36`); a surviving export fails here.
- Precedent risk: `8e8f22b` needed 3 corrective commits in 4 days once it met the live account — the live rehearsal is mandatory, not optional.
- The quiet-zero contract: five surviving return sites, all emitting the identical literal; the chain classifier is shape-only.

## Performance Considerations
- Worst-case wake-ups rise from 28 to 52 per local day (1.86×); capture write churn rises from ~2-2.4 GB/day to ~3.7-4.3 GB/day, bounded by `CAPTURE_KEEP_SESSIONS` (~1.7 GB steady-state).
- No new runtime cost: the change deletes code; the tick spawns one fewer date read.

## Migration Notes
- No schema, no state file, no runtime artifact: the window's quiet-zero is stateless (unlike the budget's orphaned ledger).
- Rollback: `git revert` of the code commit restores the predicate, gate, and seam; the docs commit reverts independently.

## Pattern References
- `8e8f22b` — the budget-machine deletion: same module, same gate band, same two test files, same doc set; single-commit code + docs split.
- `src/linkedin-behavior.ts:2-4` — the history-comment idiom for a deleted machine.
- `scripts/fetch-linkedin.ts:376-394` — the preflight band the latch inherits.
- `tests/fetch-linkedin.test.ts:316-325` — the `scriptGit` default arm that makes the inversion mandatory.

## Developer Context
- Q (Step 4 directional): commit shape — code then docs, or one atomic commit? A: mirror the precedent (`8e8f22b` + `a88494e`, 78 seconds apart).
- Q (Step 4 design summary): proceed to decomposition? A: proceed.
- Q (Step 5 decomposition): 2 slices — code excision, then doc sweep? A: approve.
- Inherited from discover (research artifact Developer Context): delete the window entirely; the loop goes 24/7 too; remove `bypassWindow` with the gate; update AGENTS.md + guidance with the code; fix all three residue sites; keep both band tests retitled; reword the header to the 24/7 bound.
- Slice-2 resume (2026-11-15): anchors re-verified on disk for all seven files; replay USAGE test-safety confirmed (tests/replay-linkedin.test.ts:197 pins the prefix regex only). Verifier round 1: Decisions/Cross-slice OK + two Research warnings (live rehearsal unpinned; grep scope omitted .rpiv/guidance). Revision: criteria 1-3 widened with .rpiv/guidance (independent repo grep: 11 working-hours lines + 3 working-day lines at HEAD, zero unexpected live carriers; the .rpiv/tmp/ hits are untracked scratch); manual criterion 1 pins the live rehearsal. Verifier round 2: all three rows OK. Developer approved at the 6.3 checkpoint. Mechanical sync: Slice 1's locked criteria (embedded in the Architecture fence at its lock) copied byte-identical into its ## Slices entry.

## Design History
- Slice 1: Code excision — approved as generated (4 verifier rounds; v4 criteria-scope fix applied as prescribed)
- Slice 2: Doc sweep + 24/7 recomputation — approved as generated (verifier round 2: Decisions/Cross-slice/Research all OK; one revision — criteria widened to .rpiv/guidance + live rehearsal pinned, closing round 1's two warnings)

## References
- `.rpiv/artifacts/solutions/2026-11-15_09-30-50_remove-linkedin-working-window.md` — the solutions artifact (parent).
- `.rpiv/artifacts/research/2026-11-15_09-09-30_remove-linkedin-working-window.md` — the driving research artifact.
- `.rpiv/artifacts/discover/2026-11-15_08-44-36_remove-linkedin-working-window.md` — the FRD with the original Decisions.
- `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md` — the budget-deletion precedent design.