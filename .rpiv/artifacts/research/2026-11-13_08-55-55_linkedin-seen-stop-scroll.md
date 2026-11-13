---
date: 2026-11-13T08:55:55+0700
author: Yogiswara Utama
commit: 33e17dc
branch: main
repository: loker-watcher
topic: "LinkedIn walk stops scrolling at already-seen posts"
tags: [research, codebase, linkedin-fetch, state, fetch-linkedin, probe-linkedin, linkedin-payload]
status: ready
last_updated: 2026-11-13T08:55:55+0700
last_updated_by: Yogiswara Utama
---

# Research: LinkedIn walk stops scrolling at already-seen posts

## Research Question
The PC LinkedIn walk keeps clicking Load-more through posts it has already judged and recorded in `state/seen-posts.json`, minting duplicates and burning scroll rounds on dead feed. How should the seen-id set flow into `fetchLinkedInPosts`, where does the N-consecutive-seen count accrue across the walk's async-mint/sync-observe boundary, and which surrounding contracts (reader fault posture, tick guard order, probe exemption, hosted backstop) constrain the design?

## Summary
- Inject the seen set as a 9th positional parameter of `fetchLinkedInPosts` (after `minClicks`, default empty) and a 6th of `walkLinkedInSurface`, threaded at the single call site src/linkedin-fetch.ts:722. Slot 9 shifts zero existing call sites; slot 8 breaks the probe (scripts/probe-linkedin.ts:171) and two walk-suite pins (tests/linkedin-fetch.test.ts:413, :436).
- The streak accrues handler-side over FRESH INSERTS ONLY (after the first-wins check :513-514), in closure locals beside received/parsed (:470-471); the loop decides and logs. Any fresh (unseen) insert resets the streak; a dry round leaves it untouched. A per-surface counter is forced by FR-4/FR-6 plus the width-2 worker pool — a global closure counter would cross-reset between workers.
- `readSeenIdSet(path)` lands in src/state.ts as a degrade-everything reader: existence probe, then `loadState`, then `new Set(Object.keys(state.seenPostIds))`, one catch-all, exactly ONE console.warn, empty set. Advisor decision: warn on ABSENT as well as malformed (the loadAccountCeilings precedent in src/judge-ceilings.ts, not the payload reader's quiet-absent; FR-2's acceptance test then pins verbatim).
- Advisor decision: load the FULL history (no recency argument). A pruned id's post is recency-ineligible at the hosted run anyway (firstSeenAt >= minted timestamp; the recency filter drops it first, src/index.ts:331), so full history cannot strand a re-judge, stops earliest, and adds no clock dependency.
- The tick loads the set via a new `seenPath?: string` dep (default STATE_PATH, the latchPath/markerPath idiom), read after the cookie gate (:357-361) and before the walk (:374), OUTSIDE the fault try. scripts/watch-linkedin.ts needs zero changes. Seven walk-reaching tests in tests/fetch-linkedin.test.ts gain a one-line `seenPath` pointing at an absent temp file (they must not read the real 1.6MB committed file — the offline doctrine).
- The probe exemption stays structural: the probe passes 8 args, slot 9 defaults empty, ProbeDeps gains no seen field. The seen-stop needs NO minClicks-style floor — the probe structurally never trips it, and a production keyword whose initial body is fully seen can legitimately stop with zero clicks.
- The hosted chain (payload envelope, dedupe, recency, diffNew, saveState gate) is untouched: an early break only shortens the walk's returned array.

## Detailed Findings

### Walk loop: async mint, sync observe
- The response handler is fire-and-forget (`void (async () => ...)` at src/linkedin-fetch.ts:506): `collectLinkedInPosts(body)` (:510, parser at src/linkedin-parser.ts:216) mints into the `posts` Map with first-wins-by-urn insertion (:513-514). The click loop (header :576) only observes aggregate growth: `gained = posts.size - before` (:627) after the 2.5s settle (:622). The loop never sees which ids arrived.
- JS run-to-completion makes handler mutations visible at each loop await — the settle window is the existing handshake, and the offline doubles drain with one setImmediate (the deterministic handoff both suites pin). No new crossing mechanism is needed: closure locals beside received/parsed (:470-471) suffice.
- Mint order is feed order: within one body the parser emits posts sorted by derived time (BigInt id ascending), so a handler-side streak counts in freshness order, not raw network arrival order.
- The all-seen feed is a HIGH-GAIN feed today: `gained` measures walk-local Map growth only (the :625-627 comment says so), so a fully-seen keyword logs non-dry rounds, keeps dryRounds at 0, and burns all scrollRounds to the 150 cap. That is the FRD's resource waste — and the reason the stop line is the operator's only early-stop signal.

### The injection seam (slot 9, not slot 8)
- Signature today: 8 positional params ending `minClicks = 0` (:678-686). Every walk input is a trailing injectable with a production default — the convention the FRD "Seam shape" decision invokes.
- Slot-8 insertion (before minClicks) breaks three call sites at compile time: the probe's 8th arg (scripts/probe-linkedin.ts:171, a number into the Set slot) and the two walk-suite pins passing `5` positionally (tests/linkedin-fetch.test.ts:413-434, :436-461). Slot-9 append shifts nobody; the probe already holds earlier slots with explicit `undefined` (:168, :170), so the exemption extends positionally.
- Two typecheck-invisible omissions remain under slot 9: forgetting the :722 threading (the walk-level empty-set default silently covers) and forgetting the tick argument. Exactly one test catches each — the walk-level seen-stop injection test and the tick-level seen-stop test — and both are FRD acceptance items.
- `SEEN_STOP_CONSECUTIVE = 3` belongs in the tuning-constants block (:77-116, beside LINKEDIN_MAX_DRY_ROUNDS :95 and LINKEDIN_MIN_GAIN :98). Doctrine contrast: `scrollRounds` is the ONE loop bound promoted to config (operator intent, validated in src/config-file.ts); N is a heuristic — module constant, never an env knob.

### The state reader contract (readSeenIdSet)
- loadState (:139-158) is ENOENT-only-degrade: silent empty state on absent (:149-155), wrapped throw on everything else (`state: failed to load state from ...`, :158). migrateState (:57-107) throws on: non-object envelope, bad version, non-array v1 ids, bad v1 item, non-map v2 seenPostIds, unparseable v2 stamp, unsupported version. All emerge as ONE wrapped Error with no machine-readable tag — so the reader's only correct catch scope is a single catch-all around one loadState call.
- Reader shape: existence probe first (the markerExists pattern, scripts/fetch-linkedin.ts:222-228), then `loadState(path)` with NO recency argument (advisor D2), then `new Set(Object.keys(state.seenPostIds))` — the diffNew/diffNewIds idiom (:168, :178). Catch-all: exactly one console.warn naming file plus fault, then `new Set<string>()`.
- Advisor D1: warn on absent AND malformed. loadState alone cannot do this — it swallows ENOENT internally, hence the pre-probe. Precedent: loadAccountCeilings (src/judge-ceilings.ts) warns on absent-or-malformed; a missing tracked state file inside a dedicated clone of main has no designed meaning (unlike the payload's absent = PC-off normal).
- Exactly-one-warn holds structurally: the tick reads once per tick; the success path warns zero times.
- Fixtures exist: tempStateFile (tests/state.test.ts:48-55) for schema faults; raw `writeFile(path, "{not json")` for bad JSON (the payload suite's pattern); the absent case is a no-seed tempStateFile path; warning capture via `t.mock.method(console, "warn", ...)` asserting callCount() === 1.

### The tick wiring (fetchTick)
- FetchTickDeps (:85-121) is one optional field plus documented default per input; the default IS production behavior — scripts/watch-linkedin.ts calls `fetchTick({ env })` and inherits whatever the tick defaults to, so the loop needs zero changes.
- New dep: `seenPath?: string` defaulting to STATE_PATH (src/config.ts:50) — the latchPath/markerPath pattern verbatim. A bare `seenIds` dep would hide the file layer and split FR-2's test across two seams; seenPath tests it end-to-end through a temp file.
- Read slot: after the harvestedAt gate (:357-361), immediately before the walk call (:374-382), OUTSIDE the fault try (:363 onward — its catch arms are halt and all-faulted; the seen read never throws and must not route through them). Three grounded reasons: (1) the pre-browser band (:326-329) keeps gated no-ops at zero reads — an earlier read would warn on every latched or off-window tick; (2) guardCheckout (:349) certifies the CWD is the dedicated clone before the file is trusted; (3) FR-1 "before the walk starts" is satisfied alongside the other preflights.
- Freshness: the push rebase (inside scripts/fetch-linkedin.ts:294-311, invoked at :409) freshens the clone AFTER each walk, so tick N reads the bot's commits as of tick N-1 — exactly the FRD's accepted staleness.
- Offline test shape: point seenPath at a workPath temp; write a v2 document carrying three consecutive idAt(n) ids (idAt :112, cardBody :120, the v2 on-disk shape `{"version":2,"seenPostIds":{...}}`); spread CONFIG with a second surface (the :754 scrollRounds-spread precedent); assert `factory.clicks()` shows surface A stopped early while surface B kept clicking, postCount carries the pre-stop mints, and the console capture pins the `fetch: ... seen-stop: <id>` line.
- Hermeticity: the seven walk-reaching tick tests (compose end-to-end :366-412, leg-dead :413-447, all-faulted :448-481, fine-empty :482-505, scrollRounds threading :745-768, checkpoint latch :770-797, latch channels :798-820) gain a one-line `seenPath` to an absent temp file each — otherwise they read the real committed state file at CWD and emit the absent warning. Tests that reject before the walk (no-surfaces, cookie gate, wrong-branch, dirty-tree, preflight band, FR-0 stamp) never reach the read and stay untouched.

### The probe exemption (structural)
- runProbe passes exactly 8 positional args ending in minClicks (scripts/probe-linkedin.ts:163-172; PROBE_MIN_CLICKS = 5 at :49, resolved :150; PROBE_MIN_POSTS = 10 at :52). ProbeDeps carries no seen field and the script imports nothing from src/state.js — the exemption is an absence, not a flag.
- The 10-post floor (:175-176) stays safe: empty set means the streak never advances, so no early stop. The seen-stop needs NO minClicks-style floor: the probe structurally never trips it, and a production keyword whose initial body is fully seen can legitimately stop with zero clicks (the initial body's handler completes during the liveness polls).
- tests/probe-linkedin.test.ts pins the call shape only indirectly (the pre-call log names "minClicks 5"; the pass-path fixture exits via the clicks === 0 dry arm regardless). Recommended addition: an explicit pin proving no seen set is forwarded.

### The hosted backstop (unchanged chain)
- Walk return -> slot stamp (src/linkedin-fetch.ts:723-729, spread-copy, never mutates the parsed array) -> `perSurface.filter().flat()` join (:767; undefined slots drop only faulted keywords) -> tick `writePayloadAtomic` (scripts/fetch-linkedin.ts:407; envelope built at src/linkedin-payload.ts:116-120 with PAYLOAD_VERSION :30) -> `pushPayload` (:409; stages ONLY the payload path, rebase plus one retry).
- Hosted side: readPayloadPosts never throws (src/linkedin-payload.ts:143, the D13 total reader); dedupePosts (src/index.ts:323, first-wins by id, surface stamps merged :606-630); filterRecent (:331, keyed on the minted timestamp); prune-on-load (`loadState` at :383); diffNew (:384); judge; persistJudged -> saveState -> diffNewIds write gate (src/state.ts:247-254; zero fresh ids means no disk write).
- A seen-stop increments none of haltReason/deadReason/faultedCount — it is a plain return, so no join arm (:758-765) can misfire. The envelope shape invariant holds: the version-pinned reader (src/linkedin-payload.ts:178-182) and the suite's PAYLOAD_VERSION pins are unaffected; a keyword stopping early changes only WHICH posts ride.
- Non-goals verified against current main: diffNewIds stays the backstop (untouched); mintPost (src/linkedin-parser.ts:194 urn mint, :216 collector) stays pure — the seen set structurally cannot enter the parser because it is not plumbed into that module.

## Code References
- src/linkedin-fetch.ts:95 — LINKEDIN_MAX_DRY_ROUNDS = 3 (the streak constant's neighbor)
- src/linkedin-fetch.ts:98 — LINKEDIN_MIN_GAIN = 2
- src/linkedin-fetch.ts:104 — LINKEDIN_MAX_POSTS = 150 (the cap)
- src/linkedin-fetch.ts:461-467 — walkLinkedInSurface signature (gains seen set as slot 6)
- src/linkedin-fetch.ts:470-471 — received/parsed closure locals (the streak's home pattern)
- src/linkedin-fetch.ts:506-526 — the matched-response handler (mint loop; streak accrues at :513-514)
- src/linkedin-fetch.ts:574-576 — loop init and header (the fourth exit joins here)
- src/linkedin-fetch.ts:622 — the settle wait (the async/sync handshake)
- src/linkedin-fetch.ts:627 — gained = posts.size - before (size-only observation)
- src/linkedin-fetch.ts:640 — the dry-round exit with the minClicks floor
- src/linkedin-fetch.ts:649-653 — drain, OK line (:651), return of the whole Map
- src/linkedin-fetch.ts:678-686 — fetchLinkedInPosts signature (seen set rides slot 9)
- src/linkedin-fetch.ts:715 — label = linkedin/<kw>
- src/linkedin-fetch.ts:722 — the single walkLinkedInSurface call (the threading site)
- src/linkedin-fetch.ts:723-729 — surface stamp at the slot write
- src/linkedin-fetch.ts:767 — the filter().flat() join
- src/state.ts:23-26 — AppState v2 (seenPostIds keyed by urn strings)
- src/state.ts:57-107 — migrateState (the v1/v2 validator readSeenIdSet reuses)
- src/state.ts:115-132 — pruneState (NOT used by the reader — full history)
- src/state.ts:139-158 — loadState (ENOENT-only degrade; the deliberate contrast)
- src/state.ts:176-193 — diffNewIds (the id-set idiom and the hosted backstop)
- src/state.ts:241-254 — saveState write gate
- scripts/fetch-linkedin.ts:85-121 — FetchTickDeps (seenPath joins here)
- scripts/fetch-linkedin.ts:222-228 — markerExists (the existence-probe pattern)
- scripts/fetch-linkedin.ts:349-361 — guardCheckout + harvestedAt gate (the seen read slots after)
- scripts/fetch-linkedin.ts:374-382 — the tick's positional walk call (gains the 9th arg)
- scripts/fetch-linkedin.ts:407-409 — payload write + push
- scripts/probe-linkedin.ts:49,:52,:150,:163-172,:175-176 — the probe constants, call, and floor gate
- src/index.ts:246,:300 — the hosted linkedinFetch arm
- src/index.ts:323,:331,:383,:384 — dedupe, recency, prune-on-load, diffNew
- src/config.ts:50,:59 — STATE_PATH, LINKEDIN_PAYLOAD_PATH
- src/linkedin-parser.ts:79,:194,:216 — URN shape, urn mint, the pure collector
- src/linkedin-payload.ts:30,:40,:111,:116-120,:143,:178-182 — version, envelope, writer, reader, version pin
- tests/fetch-linkedin.test.ts:45,:53,:112,:120,:754 — CONFIG pin, scrollRounds 1, idAt, cardBody, the spread precedent
- tests/linkedin-fetch.test.ts:413-434,:436-461 — the two minClicks positional pins (slot-8 tripwires)
- tests/state.test.ts:48-55 — tempStateFile (the reader's fixture harness)

## Integration Points

### Inbound References
- scripts/fetch-linkedin.ts:374-382 — the tick, the ONLY production caller that passes the set (7 args today)
- scripts/probe-linkedin.ts:163-172 — the probe, passes nothing (structural exemption)
- tests/linkedin-fetch.test.ts — 28 direct positional calls; only :420-429 and :448-457 reach minClicks; all untouched under slot 9
- scripts/watch-linkedin.ts — calls fetchTick({env}); inherits the seenPath default, zero changes

### Outbound Dependencies
- src/linkedin-parser.ts:216 — collectLinkedInPosts (pure mint; stays seen-blind)
- src/state.ts:139,:176-193 — loadState (degrade base) and diffNewIds (hosted backstop)
- src/linkedin-payload.ts:111,:143 — writePayloadAtomic and readPayloadPosts (envelope custody)

### Infrastructure Wiring
- FetchTickDeps gains `seenPath?: string` (default STATE_PATH, src/config.ts:50)
- fetchLinkedInPosts gains slot 9 (`ReadonlySet<string>`, empty default); walkLinkedInSurface gains slot 6; threaded at src/linkedin-fetch.ts:722
- SEEN_STOP_CONSECUTIVE = 3 in the tuning block (src/linkedin-fetch.ts:77-116)
- The stop log rides console.log in the fetch: vocabulary (success-path register, never warn)

## Architecture Insights
- Trailing-param injection with production defaults IS the exemption mechanism — a flag would be a second mechanism; the repo chose seams everywhere.
- The async-mint/sync-observe boundary needs no new machinery: the handler ACCRUES, the loop READS, DECIDES, and LOGS.
- Streak semantics (checkpoint-pinned): fresh inserts only; any unseen insert resets; dry rounds untouched; per-body order is feed order.
- Exit-order recommendation (design decides): place the seen-stop check after the round's own click line (:631-645) so the stopping round still prints; let seen-stop win ties with the dry exit (operator visibility); never touch dryRounds from the seen path — a seen streak is not feed-health evidence.
- The stop line is console.log register (a success-path early exit), not warn — the fault terminals HALT/LEG DEAD/FAILED (:736-749) are the warn register.
- The counter is per-surface (forced); the SET is global across keywords by design (no keyword column in the state schema) — a post judged under keyword B legitimately stops keyword A.

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: LinkedIn browser walk migration
**Commit(s)**: `8e8f22b` — "Migrate the LinkedIn leg to a browser walk" (2026-11-11)
**Blast radius**: 25 files across all layers — src/linkedin-fetch.ts rewritten (749 lines), new parser, both PC scripts, both suites.
**Follow-up fixes**:
- `9fa2a7e` — "ride the persistent profile and gate liveness on the DOM" (2026-11-11) — wrong session identity, missing liveness gate
- `6493f2a` — "instrument the walk's click loop and response join" (2026-11-11) — observability added retroactively
- `ce567af` + `263a77c` — plan fences drifted from source, twice
**Lessons from docs**:
- .rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md — rollback doctrine: git revert restores the leg whole
- .rpiv/artifacts/research/2026-11-12_09-30-27_linkedin-scroll-pagination-session-hygiene.md — loop anatomy: loop :576, dry exit, 8-positional signature
**Takeaway**: every early-exit mystery was an observability or identity gap — the fetch: seen-stop line is mandatory, and one live tick should confirm the stop fires relative to the dry stop.

### Precedent: runProbe seam + operator chain
**Commit(s)**: `e624cec` — "linkedin: add the operator chain and the runProbe seam" (2026-11-12)
**Blast radius**: 15 files — probe restructured into runProbe(deps), its own offline suite, new chain script.
**Follow-up fixes**:
- `5292e65` — "make the keep-open hold name the piped-stdin failure" (2026-11-12) — failure-naming gap found immediately
**Lessons from docs**:
- .rpiv/artifacts/designs/2026-11-12_10-34-39_linkedin-operator-chain.md — D6: the walk call keeps its exact 8-positional shape; D2 amendment: the first-run staleness class
**Takeaway**: a 9th param is safe only as an optional default-empty trailing arg; add a probe-suite pin proving no set is forwarded.

### Precedent: state v2 + migrateState conventions
**Commit(s)**: `93a3f38` — "cut watch runtime with judge/fetch pools, state v2, and an 8-minute budget" (2026-10-27); `ced76f8` — "unexport four internal symbols" (2026-10-31)
**Blast radius**: src/state.ts (+150), tests/state.test.ts (+233), index/fetch/judge layers.
**Follow-up fixes**:
- `ced76f8` + the N020 phase — exports that outlive their consumers become tracked debt
**Lessons from docs**:
- .rpiv/artifacts/TECH_DEBT_AUDIT.md — N017: state/seen-posts.json is a ~1.6MB tracked file rewritten per tick; pruneState drops ids outside the window each run
**Takeaway**: readSeenIdSet diverges from the throw convention ON PURPOSE — reuse migrateState for v1/v2 tolerance, leave loadState untouched, wire the export into the tick in the SAME change.

### Precedent: second surface + scrollRounds knob
**Commit(s)**: `68c1e2d` — "feat: linkedin second surface with configurable scroll rounds" (2026-10-31)
**Blast radius**: 20 files.
**Follow-up fixes**:
- `defb8af`/`216a617` — empty-input crash fixed with its test (2026-10-31)
- `119dc25` — the committed config lagged the code knob by 12 days (2026-11-13)
**Lessons from docs**:
- .rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface-and-scroll-rounds.md — origin of per-surface scroll bounds
**Takeaway**: the module constant N=3 avoids the 119dc25 config-lag class entirely.

### Composite Lessons
- Walk-behavior changes need a named stop line plus one live receipt (8e8f22b -> 9fa2a7e -> 6493f2a; the wrong-node SCROLL_JS). Offline tests alone never caught live walk faults.
- Four exit conditions will share one loop (dry 3-consecutive plus clicks-gate, round ceiling, 150 cap, seen N=3) — each must stay distinguishable in logs.
- Keep the 8-positional walk-call shape intact: slot 9 plus empty-set default makes the probe exemption structural (matches e624cec D6 and the probe suite).
- readSeenIdSet diverges from state.ts's throw convention deliberately; pin the divergence with its own tests (tests/state.test.ts pins 8 throws today).
- Plan/design fences drift from source within hours (ce567af, 263a77c) — the FRD cites :583; current main is :576. Re-verify line refs at implement time.
- New exports without same-change consumers become debt (ced76f8, N020); wire readSeenIdSet into fetchTick in the same change.

## Historical Context (from .rpiv/artifacts/)
- .rpiv/artifacts/discover/2026-11-13_08-40-38_linkedin-seen-stop-scroll.md — the FRD: goals, 8 FRs, 7 decisions, acceptance criteria
- .rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md — the browser-walk migration design
- .rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md — the second-surface dispatch design
- .rpiv/artifacts/designs/2026-11-12_10-34-39_linkedin-operator-chain.md — the operator-chain design (D6 positional pin)
- .rpiv/artifacts/research/2026-11-12_09-30-27_linkedin-scroll-pagination-session-hygiene.md — loop anatomy and session hygiene
- .rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface-and-scroll-rounds.md — the second-surface research
- .rpiv/artifacts/TECH_DEBT_AUDIT.md — N017 seen-file size, N020 dead exports

## Developer Context
**Q (discover: Seen-set source and freshness): The walk reads seen ids from this PC clone's state/seen-posts.json (read-only). Absent or malformed reads as an empty set — keep?**
A: Degrade (treat as empty).
**Q (discover: Stop scope): When a minted post id is already seen, what stops?**
A: Surface only.
**Q (discover: Posts minted before the seen hit): What happens to posts minted before the stop?**
A: Keep — they ride the payload; the hosted dedupe stays the backstop.
**Q (discover: Probe exemption): Should probe-linkedin also stop on seen posts?**
A: Probe ignores seen.
**Q (discover: Seam shape): Injected parameter, or read directly inside the walk?**
A: Inject the set.
**Q (discover: Stop trigger): What exactly triggers the stop inside the scroll loop?**
A: N consecutive seen posts (N=3).
**Q (discover: Stop log line): What should the stop log look like?**
A: fetch: prefix.
**Q (src/linkedin-fetch.ts:513-514): Does a re-served already-seen id re-count toward the streak each time LinkedIn re-serves it?**
A: Fresh inserts only — counted at the first-wins insert; a re-served id never re-counts. (Developer, checkpoint)
**Q (src/state.ts:149-155 vs FR-2): Does a MISSING seen file warn, or degrade quietly like loadState's ENOENT arm?**
A: Warn on both absent and malformed. (Advisor: the loadAccountCeilings precedent; the reader pre-probes existence because loadState swallows ENOENT internally; FR-2's acceptance test pins verbatim.)
**Q (src/state.ts:147 + src/index.ts:383): Does the walk compare against the full committed history or the recency-pruned set?**
A: Full history, no recency argument. (Advisor: firstSeenAt >= minted timestamp, so a pruned id's post is recency-ineligible at the hosted run anyway; earliest stop; no clock dependency.)

## Related Research
- .rpiv/artifacts/research/2026-11-12_09-30-27_linkedin-scroll-pagination-session-hygiene.md — the loop anatomy this change extends

## Open Questions
- Seen-stop vs dry-exit tie-break in a mixed round (some fresh, some seen): recommendation is seen-stop wins ties, with the check placed after the round's own click line; the design stage picks the final order and whether that round's dry increment still prints.
