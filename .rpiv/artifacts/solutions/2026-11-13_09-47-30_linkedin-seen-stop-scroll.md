---
date: 2026-11-13T09:47:30+0700
author: Yogiswara Utama
commit: 33e17dc
branch: main
repository: loker-watcher
topic: "LinkedIn walk stops scrolling at already-seen posts"
confidence: high
complexity: low
status: ready
verdict: pass
tags: [solutions, linkedin-fetch, state, fetch-linkedin, linkedin-parser]
last_updated: 2026-11-13T09:47:30+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: LinkedIn walk stops scrolling at already-seen posts

**Date**: 2026-11-13T09:47:30+0700
**Author**: Yogiswara Utama
**Commit**: 33e17dc
**Branch**: main
**Repository**: loker-watcher

## Research Question
The PC LinkedIn walk keeps clicking Load-more through posts it has already judged and recorded in `state/seen-posts.json`, minting duplicates and burning scroll rounds on dead feed. How should the seen-id set flow into `fetchLinkedInPosts`, where does the N-consecutive-seen count accrue across the async-mint/sync-observe boundary, and which surrounding contracts constrain the design?

## Summary
**Problem**: A fully-seen LinkedIn keyword burns every configured scroll round (`watcher.config.json` ships `scrollRounds: 50` across 5 surfaces) because `gained` measures walk-local Map growth only, and a seen post is fresh to the walk-local Map. The reflog payload bursts (1195, 2182, 2207, 1941, 2243 posts) are the operational receipt of that waste.
**Recommended**: Handler-side seen streak — two closure locals accrue N=3 consecutive seen-id first-wins inserts inside the mint handler; the loop breaks after settle and logs a `fetch: ... seen-stop: <id>` line. The set rides slot 9 of `fetchLinkedInPosts`; the probe exemption stays structural.
**Effort**: Low (~1 day: ~+170-230 lines across 3 source files, 7 one-line test edits, 3-4 new tests)
**Confidence**: High

## Problem Statement

**Requirements:**
- Stop a surface scroll loop when N consecutive FRESH inserts are seen ids (fresh inserts only; a re-served id never re-counts).
- Load the full-history seen set (no recency argument); the reader degrades on absent AND malformed with exactly one warn.
- The probe ignores seen posts structurally (empty-set default; no new probe field).
- Posts minted before the stop ride the payload; the hosted chain stays untouched.
- The stop is per-surface; the set is global across keywords (no keyword column in the state schema).
- A mandatory stop log line in the `fetch:` register (success-path console.log, never warn).

**Constraints:**
- The 8-positional walk call stays intact for the probe (`scripts/probe-linkedin.ts:163-172`) and the two minClicks pins (`tests/linkedin-fetch.test.ts:413-434`, `:436-461`).
- N is a module constant (`SEEN_STOP_CONSECUTIVE = 3`) in the tuning block, never config or env.
- Offline tests stay deterministic and hermetic; the seven walk-reaching tick tests must not read the real 1.6MB committed seen file.
- Strict TS flags stay on; fail-visible doctrine for config and state exits.

**Success criteria:**
- A fully-seen keyword stops early with a log line distinguishable from the dry exit, the round ceiling, and the 150 cap.
- Zero changes to the hosted chain and zero walk-suite call-site edits.
- `npm run typecheck`, `npm run lint`, `npm test` pass; one live tick receipt confirms the stop fires.

## Current State

**Existing implementation** (re-verified at 33e17dc by all three analysis agents; drift audit against the research artifact corrected `markerExists` to `scripts/fetch-linkedin.ts:141-148`, `FetchTickDeps` to `:84-122`, the tuning block to `src/linkedin-fetch.ts:75-116`, and the walk-suite helpers to `:68`/`:77`):
- Walk loop: loop bound `round <= scrollRounds && posts.size < LINKEDIN_MAX_POSTS` (`src/linkedin-fetch.ts:576`, cap 150 at `:104`), settle `:622`, `gained = posts.size - before` `:627` (size-only), dry exit `:640`, drain and return `:649-653`.
- Response handler: fire-and-forget `void (async () => ...)` `:506`; mint `:510`; first-wins `:513-514`; fresh counting `:511-516`; count-only logging `:522-524`.
- Signatures: `walkLinkedInSurface(context, surface, label, scrollRounds, minClicks)` `:461-467`; `fetchLinkedInPosts` 8 positional ending `minClicks = 0` `:678-686`; single threading site `:722`.
- Tick: `FetchTickDeps` `:84-122` (13 optional-field-plus-default entries); fault try `:363-405` (halt arm, all-faulted arm, rethrow `:404`); the walk call `:374-382` passes 7 args today.
- State: AppState v2 `src/state.ts:23-26`; `loadState` `:139-158` is ENOENT-only degrade; `diffNewIds` `:176-193`; `pruneState` `:115-132`; save write gate `:241-254`.
- Probe: 8-arg call ending `minClicks` at `scripts/probe-linkedin.ts:163-172`; `PROBE_MIN_CLICKS = 5` `:49`; `PROBE_MIN_POSTS = 10` floor `:175-176`.
- Hosted backstop: dedupe `src/index.ts:323`, filterRecent `:331`, prune-on-load `:383`, diffNew `:384`; `readPayloadPosts` never throws (`src/linkedin-payload.ts:143`).

**Relevant patterns:**
- Closure-local walk counters: `src/linkedin-fetch.ts:470-471` (received/parsed) and `:574-575` (dryRounds/clicks); Threads twin `src/fetch-threads.ts:439/:444` — 3 instances.
- Trailing-param injection with production defaults: `:678-686`, `loadState` `:139-143`, `readPayloadPosts` `:143-145`, `loadAccountCeilings` `src/judge-ceilings.ts:93-96`, `stateTempPath` `src/state.ts:196`, ProbeDeps `minClicks` `:111-112/:150` — 5 signatures plus 1 deps resolution.
- Degrade-everything readers: `loadAccountCeilings` (warn malformed `:101`, warn unreadable `:113`), `readPayloadPosts` absent leg `:153-156`, `markerExists` degrade-to-false `:141-148` — 3 instances; `loadState` is the documented counter-example, and `judge-ceilings.ts:8-11` records the posture split on purpose.
- `FetchTickDeps` optional-field-with-documented-default: 13 instances; `seenPath` clones `markerPath` `:106-107`.
- Latch/marker default idiom: `:330`, `:159`, `:187`, `:406`; 7 tick tests inject `latchPath` lines (`:377`, `:423`, `:456`, `:488`, `:759`, `:772`, `:800`).

**Integration points:**
- `src/linkedin-fetch.ts:678-686` — slot 9 (`ReadonlySet<string>`, empty default); `:461-467` slot 6 on the walk; `:722` threading; `:75-116` tuning constant; `:631-647` stop-check placement.
- `src/state.ts` — new `readSeenIdSet` export: existence probe, one `loadState` call (full history, no recency arg), `new Set(Object.keys(state.seenPostIds))`, one catch-all with exactly one warn, empty-set degrade.
- `scripts/fetch-linkedin.ts:84-122` — `seenPath` dep; read slot between the harvestedAt gate (`:357-361`) and `let posts` (`:362`), OUTSIDE the fault try; call site `:374-382` gains 2 args (0 for minClicks + the set).
- `tests/fetch-linkedin.test.ts` — the seven walk-reaching tests (`:366`, `:413`, `:448`, `:482`, `:745`, `:770`, `:798`) gain a one-line `seenPath` each.

## Solution Options

### Option 1: Handler-side seen streak (slot-9 injection)
**How it works:**
The tick reads the seen set once (`seenPath` dep defaulting to `STATE_PATH`) and passes it as slot 9. Inside the walk, two closure locals beside `received`/`parsed` (`:470-471`) track the streak: the handler increments it inside the existing fresh block (`:511-516`) for each first-wins insert of a seen id, and resets it on any fresh unseen insert; dry rounds leave it untouched. The loop reads the counter after settle (`:622`) beside `gained` (`:627`) and breaks at N=3 after printing the round, logging `fetch: <label> seen-stop: <id>` (success-path console.log). The parser stays pure and seen-blind; the probe stays exempt by absence.

**Pros:**
- Pure assembly of existing shapes: 5/5 constituent patterns already in the codebase with 3-13 instances each; no novel mechanism ships.
- Zero compile-time breakage: the slot-9 append shifts none of the 28 positional walk-suite calls (enumerated; only 3 reach slot 8) and leaves the probe call byte-identical.
- Fresh-inserts-only semantics are structural: accrual sits inside the first-wins branch, so a re-served id cannot re-count by construction.
- The async boundary needs no new machinery: the doubles already drain the handler with one setImmediate (`tests/linkedin-fetch.test.ts:243-245`), and the initial body drains via the first liveness poll, so a fully-seen initial body deterministically trips before round 1.

**Cons:**
- Two compile-invisible omission traps: forgetting the `:722` threading or the tick argument fails silently under the empty-set default. Each is closed by exactly one named new test.
- Cross-layer fan-out (3 source files plus 3 test files) for one behavior; mitigated by single-commit delivery, the `93a3f38` pattern.

**Complexity:** Low (~1 day)
- Files to create: 0
- Files to modify: 6 (`src/linkedin-fetch.ts` ~+12-18, `src/state.ts` ~+25-35, `scripts/fetch-linkedin.ts` ~+8-10, three test files)
- New test lines: ~120-160 plus 7 one-line edits; zero deletions
- Risk level: Low (hazards exhaustively mapped; each closed by one named test)

### Option 2: Loop-side id diff (per-body minted-id ledger)
**How it works:**
Same slot-9 injection and the same state and tick work. The handler records WHICH ids each body minted into a closure ledger — only the `:513-515` branch is safe; raw mints from `:510` double-count re-served ids (proven by the dup fixture `tests/linkedin-fetch.test.ts:497-521`). The loop consumes the ledger through a monotonic cursor after each settle, computes the streak beside `gained` (`:627`), and breaks at N.

**Pros:**
- All stop policy sits in the loop beside `gained` — one decision frame; the handler stays a dumb recorder.
- The parser stays untouched either way; the 11-case parser suite (`tests/linkedin-parser.test.ts:199-298` + round-trip `:316`) stands.
- Zero existing tests change; the doubles drive per-body accounting through the existing handshake.

**Cons:**
- Introduces the FIRST walk-side id ledger: both loops deliberately observe aggregate size only (LinkedIn `:577`/`:627`, Threads twin `:441`/`:444`), and the handler logs counts, not ids (`:522-524`). The candidate fights a deliberate idiom.
- A second piece of async-crossing state (writer plus cursor consumer); a cursor bug double-counts bodies into the streak.
- Strictly dominated costs: +8-12 production lines and 2-3 extra tests (~90-140 lines) over Option 1, including a re-serve guard test whose only purpose is a hazard Option 1 structurally cannot have.

**Complexity:** Low-Medium (~1.5 days)
- Files to create: 0
- Files to modify: the same 6 as Option 1
- Risk level: Medium (cursor hazard class new to this codebase)

### Option 3: Timestamp watermark (age floor, no seen-set plumbing)
**How it works:**
No state read, no tick dep, no slot-9. The walk derives each minted timestamp (already computed in `mintPost`, `src/linkedin-parser.ts:188-190`, via `BigInt(id) >> 22n`) and stops a surface after N consecutive mints older than a floor constant.

**Pros:**
- Smallest seam: 2 files touched; derivation exists and is monotonic (parser `:291-293`); the `idAt` fixture helpers are the exact inverse (`tests/fetch-linkedin.test.ts:106-112`).
- Skips the entire state layer (`readSeenIdSet` plus its fault battery) and all tick wiring.

**Cons:**
- The predicate mismatches the goal. A re-served judged post is FRESH: the search facet pins `datePosted=past-24h` (parser `:47-49`), so a post judged 2h ago mints at ~2h — no sane floor rejects it, and the steady-state seen feed still burns every round. Meanwhile an old-but-unseen backfill post is cut even though the hosted gates would keep it (`filterRecent` drops ZERO LinkedIn posts today: `recencyHours: 72` vs the 24h facet, `watcher.config.json:125`). Recall loss needs a floor near zero; tripping on the seen feed needs minutes; the parser documents 4-6 min derived-clock drift (`:22-23`). Jointly unsatisfiable.
- Feed-order amplifier: mints are ascending-time within a body, so the streak trips on the OLDEST 24h posts first — it can stop the initial body before any fresh post is minted.
- The probe exemption is NOT structural: the watermark inherits into the probe call and can fail the 10-post floor (`:175-176`); exemption needs a new seam. The seen design gets this for free.
- Re-introduces the clock dependency the advisor decisions rejected, against an in-repo precedent of refusing a clock gate on this exact leg (cookie stamp gate: presence required, age never checked, `scripts/fetch-linkedin.ts:351-352`).
- Fixture ripple: any floor above ~46 min marks every existing tick-suite fixture post stale (`BASE_MS` `:111` vs `T0` `:845`), flipping walk-continuation assertions.

**Complexity:** Low (~0.5 day) — but the goal is unmet regardless of cost.
- Files to create: 0
- Files to modify: 2
- Risk level: High (wrong posts stopped, probe floor hazard, recall loss)

## Comparison

| Criteria | Option 1 | Option 2 | Option 3 |
|----------|----------|----------|----------|
| Complexity | L (~1d) | L-M (~1.5d) | L (~0.5d) |
| Codebase fit | H (5/5 shapes present) | M (first walk-side id ledger vs a deliberate size-only idiom) | L (predicate mismatch; clock-gate refusal precedent) |
| Risk | L (2 mapped traps, 2 named tests) | M (cursor hazard) | H (goal unmet) |
| Existing tests changed | 7 one-liners | 7 one-liners (identical) | fixture ripple (~46-min boundary) |
| New tests | 3-4 | 5-6 | 4-5, semantics live-only |

## Recommendation

**Selected:** Option 1 — Handler-side seen streak.

**Rationale:**
- It measures the goal predicate directly: seen-ness at the first-wins insert, where `fresh` is already computed (`:511-516`). No proxy, no clock.
- Pure assembly: every constituent shape exists (closure counters, trailing-param injection, degrade-everything reader, deps-with-default, latch/marker idiom). Nothing novel ships.
- Zero breakage: slot 9 shifts none of 28 call sites; the probe exemption stays an absence, matching the operator-chain D6 pin.
- Deterministic support exists today: the one-setImmediate drain (`:243-245`) and the liveness-poll drain of the initial body make the boundary test-provable offline; it is the same boundary `gained` already uses (`:627`).

**Why not alternatives:**
- Option 2: works, but strictly dominated — identical base work, plus a cursor hazard, plus 2-3 extra tests guarding a hazard Option 1 structurally cannot have. The per-body ledger also breaks a deliberate idiom (aggregate-only observation) with no offsetting need.
- Option 3: fails the fit filter on integration-risk — the stop predicate diverges from seen-ness in both directions (fresh-but-seen not stopped; old-but-unseen cut), no floor value satisfies both requirements, the probe floor becomes collateral, and it re-introduces a rejected clock dependency.

**Trade-offs:**
- Accepting two compile-invisible omission traps for zero call-site breakage; each trap is closed by exactly one named test (walk-level injection catches a forgotten `:722` threading; tick-level seen-stop catches the forgotten tick argument).
- Accepting the `8e8f22b` history class (walk-behavior changes needed observability follow-ups `9fa2a7e` and `6493f2a`) by making the stop line mandatory in the same change; one live-tick receipt remains the residual risk.

**Conditions that would change the recommendation:**
- If LinkedIn drops the 24h datePosted pin and stale-tail waste dominates, Option 3 becomes a worthwhile COMPLEMENT (tail savings), never a replacement.
- If the walk later needs per-body id telemetry beyond the stop decision, adopt the Option 2 ledger then, as the carrier.

**Implementation approach:**
1. State leg — `readSeenIdSet` in `src/state.ts` plus its battery in `tests/state.test.ts` (absent, malformed, wrong-shape, round-trip; warn-once via `t.mock.method(console, "warn")`, `callCount() === 1`).
2. Walk leg — `SEEN_STOP_CONSECUTIVE = 3` in the tuning block (`:75-116`); slot 6 on `walkLinkedInSurface` (`:461-467`); two closure locals beside `:470-471`; accrual in the `:511-516` fresh block; break check after the round logs (`:631-647`) with the `fetch:` stop line; never touch `dryRounds`.
3. Dispatch leg — slot 9 on `fetchLinkedInPosts` (`:678-686`); pass-through at `:722`.
4. Tick leg — `seenPath` dep (`:84-122`, markerPath style); resolution beside `:330`; read between `:361` and `:362`, outside the fault try; call site `:374-382` gains `0` plus the set.
5. Tests — the 7 one-line `seenPath` edits (`:366`, `:413`, `:448`, `:482`, `:745`, `:770`, `:798`); walk-level injection test; tick-level seen-stop (two surfaces via the `:754` spread precedent, `clicks()` differential, `postCount`, captured stop line); recommended probe exemption pin.
6. Receipt — one live tick confirming the stop fires relative to the dry stop.

**Integration points:**
- `src/linkedin-fetch.ts:75-116` — the tuning constant
- `src/linkedin-fetch.ts:461-467` — `walkLinkedInSurface` slot 6
- `src/linkedin-fetch.ts:511-516` — streak accrual inside the fresh block
- `src/linkedin-fetch.ts:631-647` — stop check plus log, after the round logs
- `src/linkedin-fetch.ts:678-686` — `fetchLinkedInPosts` slot 9
- `src/linkedin-fetch.ts:722` — the threading site
- `src/state.ts` — the `readSeenIdSet` export
- `scripts/fetch-linkedin.ts:84-122` — the `seenPath` dep
- `scripts/fetch-linkedin.ts:357-362` — the read slot
- `scripts/fetch-linkedin.ts:374-382` — the call site gains 2 args

**Patterns to follow:**
- Degrade-everything reader: `src/judge-ceilings.ts:93-121` (warn on absent AND malformed, exactly one warn)
- Existence pre-probe: `scripts/fetch-linkedin.ts:141-148`
- Optional dep with documented default: `scripts/fetch-linkedin.ts:106-107` (markerPath)
- Trailing injectable param: `src/linkedin-fetch.ts:678-686` (minClicks = 0)
- Tuning-constant block: `src/linkedin-fetch.ts:94-98`

**Risks:**
- Forgotten threading or tick arg (silent under the empty default): closed by the two named new tests.
- Mixed-round tie-break ambiguity: recommendation — seen-stop wins ties, checked after the round click logs; the design stage finalizes whether that round still prints its dry increment.
- Live-walk fault class (history: `8e8f22b` needed `9fa2a7e` and `6493f2a`): mandatory stop line in the same change plus one live receipt.
- Seen-file staleness (tick N reads commits as of tick N-1 via the push rebase): accepted by the FRD; the hosted `diffNew` backstop still dedupes anything re-served.

## Scope Boundaries
- Building: the per-surface seen-stop in the PC walk, its state reader, its tick wiring, and its tests.
- Not building: hosted-chain changes (dedupe, recency, diffNewIds, payload envelope all untouched), parser changes (stays pure and seen-blind), probe behavior changes (structural exemption only), `scripts/watch-linkedin.ts` changes, a config or env knob for N, any new pruning of the seen file.

## Testing Strategy

**Unit tests:**
- `readSeenIdSet`: absent path (unseeded tempStateFile), malformed JSON, wrong-shape envelope, success round-trip; exactly one warn per fault case.
- Walk-level streak semantics via the 9-arg call: fully-seen initial body stops before round 1; mixed body resets on a fresh insert; re-served id never re-counts (structural here); dry round leaves the streak untouched; stop line pinned.
- Tick-level seen-stop: two surfaces, `seenPath` at a workPath v2 document, `clicks()` differential (A stops early, B continues), `postCount` carries pre-stop mints, stop line captured.

**Integration tests:**
- Hosted chain pins stand untouched: payload version pins, `readPayloadPosts` never-throw, dup test `:497-521` unchanged, OK-line pins `:355`/`:555`/`:573` unchanged.

**Manual verification:**
- [ ] One live tick: confirm `fetch: ... seen-stop: <id>` fires and its relationship to the dry stop is legible.
- [ ] `npm run probe-linkedin` still gates normally (empty set, streak never advances).

## Open Questions
**Resolved during research:**
- Accrual side of the async boundary: handler accrues, loop reads — the one-setImmediate drain (`tests/linkedin-fetch.test.ts:243-245`) makes it deterministic; no new crossing mechanism.
- Slot 9 vs slot 8: slot 9; only 3 of 28 call sites reach slot 8, and slot 9 breaks none.
- Fresh-inserts-only counting: accrual inside the `:513-515` branch makes re-serve double-counting structurally impossible.
- Absent-file posture: warn on absent AND malformed (`loadAccountCeilings` precedent); the reader pre-probes existence because `loadState` swallows ENOENT internally.
- Full history vs pruned: full history; a pruned id is recency-ineligible hosted-side anyway, so the stop is earliest with no clock dependency.

**Requires user input:**
- None blocking. The mixed-round tie-break order is a design-stage call with a recommendation attached (seen-stop wins, after the round logs).

**Blockers:**
- None. All line references re-verified at 33e17dc by all three analysis agents; drifts found were corrected inline (markerExists `:141-148`; FetchTickDeps `:84-122`; walk-suite helpers `:68`/`:77`; tuning block `:75-116`).

## References

- `.rpiv/artifacts/research/2026-11-13_08-55-55_linkedin-seen-stop-scroll.md` - the anatomy research this analysis scored against
- `.rpiv/artifacts/discover/2026-11-13_08-40-38_linkedin-seen-stop-scroll.md` - the FRD: goals, FRs, decisions, acceptance criteria
- `src/linkedin-fetch.ts:469-527` - the walk handler and the accrual site
- `src/linkedin-fetch.ts:576-653` - the click loop and its exits
- `src/state.ts:139-158` - `loadState`, the deliberate contract contrast
- `src/judge-ceilings.ts:93-121` - `loadAccountCeilings`, the degrade-everything posture to copy
- `scripts/fetch-linkedin.ts:84-122` - `FetchTickDeps`, the dep pattern to extend
- `tests/linkedin-fetch.test.ts:219-250` - the deterministic drain handshake
- `tests/fetch-linkedin.test.ts:366-820` - the seven walk-reaching tick tests