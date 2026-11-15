---
date: 2026-11-14T07:48:28+0700
author: Yogiswara Utama
commit: 3ed60f0
branch: ukind/fix-incorrect-link-email
repository: fix-incorrect-link-email
topic: "LinkedIn digest permalinks — card-root urn join replaces the positional zip"
tags: [research, codebase, linkedin-parser, linkedin-fetch, linkedin-payload, replay-linkedin, state]
status: ready
last_updated: 2026-11-14T07-48-28+0700
last_updated_by: Yogiswara Utama
---

# Research: LinkedIn digest permalinks — card-root urn join replaces the positional zip

## Research Question

How does the fix specified by the FRD (join each commentary text to the id carried by its own post card, delete the timestamp-ordered zip and the `>> 22n` sort, keep `mintPost` and its guard) map onto the live code: what exactly is deleted from `collectLinkedInPosts`, what does "climb the marker to its card root" mean against the real `$`-reference graph, which downstream contracts must hold for the id/permalink split, and what breaks when the pairing rule is rewritten?

## Summary

The positional zip lives in six stages inside `collectLinkedInPosts` (src/linkedin-parser.ts:216-322); three survive verbatim (`parseFlightRows`, `textFromChildren`, `mintPost`), one relocates (longest-wins text pick, per marker row), one transforms (whole-ref traversal becomes the climb graph), and two dissolve (global id/text consolidation, the sort + zip + warn). The climb needs no new graph: the replay harness already materializes forward containment (`refTargets`, scripts/replay-linkedin.ts:281-307) and its inversion (`reverse`, :485-492); the climb is a per-marker walk of `reverse` plus a forward urn collection from the root. Body 080's `forward 107, reverse 0` verdict proves forward joins originate at BOTH (marker∩id) rows, so urn collection must go forward from the card root, and the module header's "BFS reaches zero id rows" claim (:27-29) is the stale side. The id/permalink split is clean end to end: `Post.id` stays the activity urn (req 4) and every id-keyed consumer (walk dedupe, seen-stop, payload admission, dedupe, state) survives untouched; `Post.permalink` is read verbatim by exactly two template literals (src/email.ts:137, src/heartbeat.ts:160) and nothing reconstructs it from `Post.id`. Two findings block a naive implementation and were resolved at the checkpoint: (1) the FRD's re-send decision cannot self-execute — seen-state already holds the zip-era urn keys and the 72 h prune can never release them, so the checkpoint chose a one-time purge of LinkedIn urn keys from `state/seen-posts.json`; (2) the replay harness is coupled to the live parser by import and pinned tallies, so the checkpoint chose to upgrade it in the same change.

## Detailed Findings

### The deletion surface: six stages of `collectLinkedInPosts` (src/linkedin-parser.ts:216-322)

- **S0 `parseFlightRows` (src/linkedin-parser.ts:87-105)** — survives verbatim; it is the join substrate. The offline test pinning manifest/garbage skipping (tests/linkedin-parser.test.ts:288-291) keeps passing unchanged.
- **S1 the per-row `visit` closure (:221-268)** — five rules with different fates:
  - Urn-string capture (:226-231, `URN_RE` at :79) survives but must WIDEN: the FRD collects the card's non-activity urn (req 3/5), and the measured instrument matches `urn:li:(share|ugcPost|activity):` strings (.rpiv/tmp/scan9.ts:13, identical in scan6/7/8).
  - Whole-ref traversal (:232-240) survives relocated — inverted over all rows it becomes the `parents` map the climb walks (.rpiv/tmp/scan8.ts:77-84 builds it; the climb predicate `count === 1` at :97 is FRD req 2 verbatim). `seenRows` (:222, :236) doubles as the cycle guard in both roles.
  - The `activityId` digit-field rule (:247-251, `DIGITS_RE` :80) and the urn-key rule (:262-265) have NO role in the join: no dry-run instrument collects digit fields or urn keys, and keeping the digit-field rule would turn a clean card carrying both an `activityUrn.activityId` object and its urn string into a req-7 multi-urn drop. This is the sharpest subsumption decision in the rewrite.
  - The marker branch (:252-261) survives as the SEED DETECTOR; the early `return` at :260 stays load-bearing (the commentary subtree carries no ids). The marker row stops being a terminal harvest site and becomes a climb seed.
- **S2 global consolidation (:269-279)** — the `ids` first-appearance dedupe (:270-272) dissolves with the zip. The longest-wins reduce (:274) survives RELOCATED per marker row; the `seenTexts` dedupe (:275-277) dissolves — under the join two cards with the same text are two distinct posts (fetch dedupe keys by urn, src/linkedin-fetch.ts:567), which un-hides the "59 repeating text heads" recorded in the FRD follow-ups.
- **S3 the `usable` BigInt pre-filter (:284-292)** — subsumed by `mintPost`'s guard (:185-203, the same predicate); its own comment says it exists "before the sort" (:281-283). FRD reqs 6/7 require drops to be COUNTED, so the guard's verdict must surface in the req-9 tally instead of vanishing into a null mint.
- **S4 the monotonic sort (:294-300)** — deleted outright (req 8; Recommended Approach). `>> 22n` survives only inside `mintPost` (:188) as timestamp derivation. The PAIRING header paragraph (:26-35) is the rationale being deleted; its factual premise ("BFS reaches zero id rows") is already falsified by body 080.
- **S5 the prefix zip + mismatch warn (:301-313)** — deleted (req 8). Four tests pin the warn byte-shape (tests/linkedin-parser.test.ts:231-243, :245-260, :262-267, :269-286) and the zip proof test :212-223 pins the fault itself — all die or re-base onto req 9.
- **S6 the pairing-oracle log (:312-320)** — partially survives: the acceptance criterion pins the `id.slice(-6)↔"text head"` naming; req 9 adds the linked/dropped counts, making one line per body carry both.
- **Kept verbatim:** `mintPost` (:185-203) with its RangeError/non-positive-epoch guard (:186-193) — but its permalink construction (:200) hardcodes the activity urn and must take the card's resolving urn; `textFromChildren` (:109-175) survives untouched.

### The climb against the real `$`-reference graph

- The harness machinery: `refTargets` (scripts/replay-linkedin.ts:281-307) collects row→row edges for whole-ref (`$L<hex>`) and path-ref (`$L<hex>:path`) forms; `reachableCount` (:330-350) is set-level and count-only — it discards which marker reached which id, which is exactly what the climb needs. `analyzeBody` builds `refs` (:478-483) and inverts it to `reverse` (:485-492).
- The climb decomposes on the JOIN_BODY miniature (tests/replay-linkedin.test.ts:76-92): start at the marker's containing row, walk `reverse` upward while the ancestor's subtree holds exactly one marker (needs a per-row marker count the harness never materializes — census has only boolean `hasMarker` :402 and `textCount` :403-404), then walk `refs` forward from the root collecting urns. Cycle guard: the BFS's visited-set idiom (:335, :341-342).
- The card root is always a root row in `parseFlightRows` order — every graph node is a key of that map (edges only added when `rows.has(id)`, :288/:294).
- **Body 080 resolved:** forward 107 / reverse 0 is algebraically possible only if every forward join originates at a BOTH (marker∩id) row and no marker-only row is contained by an id-bearing row — reverse BFS starts are seeded (:335) so they never count. Consequence: the climb (reverse containment) locates the card root, but urn collection must go FORWARD from it; the merged card is the live join shape. The header claim, not the probe, is stale.
- Containment-semantics gap to resolve: census `hasMarker` follows whole-refs only (:387-389) while `refTargets` counts both forms (:291-296). "Subtree holds exactly one marker" must pick one; the FRD's measured claim (462 top-level markers) was measured against the ref-graph form.
- Corpus arithmetic: 462 top-level markers vs 423 single-activity-urn cards across 157 bodies leaves ~39 marker rows in the zero-urn / share-only buckets — the req-6 drop class the counts must make visible. Multi-marker rows exist (MIXED_BODY row "30", chipCardBody) and the climb's exactly-one-marker predicate partitions them into separate roots; a longest-wins pick per MARKER ROW is required, a per-CARD pick has no corpus support.
- Chips/CTA junk: the zip was the leak doorway (equal-count mispairs mint with no warn, :302 requires inequality); the join removes the doorway, the relocated longest-wins absorbs the sibling chip, and residual junk becomes per-card drop counts on the req-9 line. CTA markers are spec-identical to real posts (junkCause doc, scripts/replay-linkedin.ts:174-180) — only the text shape can name them.

### The urn contract: `Post.id` vs `Post.permalink`

- Today the parser knows one urn shape (`URN_RE` :79, `^urn:li:activity:(\d{10,})$`) and zero live code handles `urn:li:share:`/`urn:li:ugcPost:` (repo grep: only .rpiv/artifacts hits). `mintPost(activityId, text)` (:185-203) derives id AND permalink from one argument (:194, :200) — the split requires a signature change to receive the card's urn set or chosen permalink urn.
- `Post.id` stays `urn:li:activity:<activityId>` (req 4 — the dedupe key); `Post.permalink` keeps the card's own urn type (req 5). `Post.permalink` is a plain required string (src/types.ts:21) — type-compatible with no shape change.
- The share/ugcPost id is a DIFFERENT number from the activity id, committed twice: the live-rehearsal table (.rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md, "times 321ms apart — 3 posts, not 6") and .rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface-and-scroll-rounds.md:66 ("activity and share ids DIFFER").
- The second urn sits in a sibling component/row of the card, never inside the text marker (the commentary early return :259-260). Its exact field path is unpinned by committed artifacts — the dry-run instruments match urns anywhere in the card-root-reachable span, which is why the FRD specifies the join reachability-based rather than field-path-based.
- The drop rules (reqs 6/7) are the card-level guard replacing id-list dedup, mirroring the payload layer's doctrine — "malformed rows: dropped + counted, leg stays ok" (src/linkedin-payload.ts:17, loop :199-210). Measured headroom: the edge case does not occur in 423 cards.

### Downstream permalink path (all green under the split)

- Payload admission (src/linkedin-payload.ts:88-107): `row.id` pinned to `ACTIVITY_URN_RE = /^urn:li:activity:\d{9,}$/` (:65) at :93-94; `permalink` only non-empty (:99-100) — a share/ugcPost-typed permalink passes untouched. `PAYLOAD_VERSION = 2` (:30) checked by exact equality (:178-181) — no bump needed, and a bump would blackout the whole leg during PC-clone/hosted rollout skew.
- Funnel: seam default src/index.ts:246, payload read :300, id-keyed `dedupePosts` :323 (impl :606-613), `mergeSurfaceStamps` (:621-637) spreads the kept object so the permalink rides byte-identical.
- The judge never sees a permalink (src/judge.ts:260 uses author+text; :282 uses id/author/text).
- Complete consumer sweep for `.permalink`: mint sites (src/linkedin-parser.ts:200, src/extract.ts:110), admission (:99-100), verbatim renders (src/email.ts:137, src/heartbeat.ts:160), the field itself (src/types.ts:21). Nothing reconstructs a permalink from `Post.id` — the only `feed/update` construction site in the pipeline is the parser mint.
- `isValidRow`'s id pin does NOT widen. The contract to preserve: share/ugcPost urns may appear only in `permalink`, never in `id` — a share-typed id would drop every row while the leg reads "ok", the module's worst failure class. Latent asymmetry to keep in mind: the parser mints `\d{10,}` (:79), admission admits `\d{9,}` (:65).

### Identity flow: dedupe, seen-stop, and the re-send blocker

- Walk arm (src/linkedin-fetch.ts:562-577): `received += 1` (:563, the liveness signal), `minted = collectLinkedInPosts(body)` (:564), first-wins by urn (:567-568), seen-streak accrual with reset on unseen insert (:569-574), walk-local `fresh` (:575 — "new to this map", not "unseen globally"), `parsed += 1` iff `minted.length > 0` (:577, declared :501).
- `seenIds` comes from scripts/fetch-linkedin.ts:385 → `readSeenIdSet` (src/state.ts:176-204), loaded WITHOUT a recency window (:194) — the full-history key set, degrade-to-empty on fault.
- `state/seen-posts.json` verifiably holds zip-era urn keys: first urn key at state/seen-posts.json:52289; both FRD evidence urns at :53117 and :53125; the payload-head id at :60426. The overlap is structural: the zip mints every usable id in the `min()` prefix, each paired with some text; every judged id is persisted (src/index.ts:560-568).
- Hosted suppression: `diffNew` (src/state.ts:207-212) filters by id only; the 72 h window (watcher.config.json `recencyHours`) prunes seen keys at persist-stamp + 72 h (src/state.ts:115-134) while recency admits posts only until id-clock + 72 h (src/recency.ts:17-21) — persist stamp is always later than the id clock, so **no corrected post whose id carries a seen key can ever naturally re-send**. First fixed ticks would heal the payload and send zero re-send emails. Checkpoint decision: purge the LinkedIn urn keys from `state/seen-posts.json` once, before the first fixed tick.
- Seen-stop: streak counts id occurrences, not pairings — the id set per body is essentially unchanged, so the stop fires at the same bodies; cards whose true ids were never zip-minted now reset the streak (:573). The pre-round stop is by-design non-lossy (mints ride the payload; comment :660-662; return :758).
- The mismatch warn feeds nothing (bare console.warn; no counter or branch reads it). `parsed` is not liveness (liveness is `received` :500/:563 + the DOM probe :636-653). What changes: `parsed`'s condition becomes "body with ≥1 linked card" — a body whose cards all drop mints 0 where the zip minted a (wrong) prefix, tightening the dry-round gain accounting (:717-720) and shrinking the OK-line denominator (:755-757). The capture envelope still records `matched: true, minted: 0` (:587-606), preserving replay visibility.

### The replay harness coupling (checkpoint decision: upgrade in the same change)

- Freeze declaration scripts/replay-linkedin.ts:31-38 ← the design's Not Building list (.rpiv/artifacts/designs/2026-11-13_11-24-35_linkedin-post-link-pairing.md); `collectRowCensus` (:352-434) is a rule-for-rule instrumented copy of the parser's row walk (drop accounting split into `drops.missing`/`drops.seen`/`drops.pathMiss`, :230-248).
- Live couplings the rewrite invalidates: `zipByText` executes `collectLinkedInPosts` on every analysis (:449-457); the disposition column renders `zip-paired ↔ <tail>` / `zip-unlinked` (:417-421, printed :546-556); the cross-check test asserts `min(distinctIds, distinctTexts) === minted.length` (tests/replay-linkedin.test.ts:268-280) — the zip's identity, not the join's; the Option-A verdict machinery (:535, :584-589) describes a decision already made.
- The parser's own suite pins the fault: tests/linkedin-parser.test.ts:213-224 asserts the zip's crosswise pairing on `captureBody` (latest id mounted on the first card, :102-105) — under the join it asserts the opposite of the ratified fix.
- Keeping the old rule replayable has no mechanism (the harness imports the live parser, :53; no version pin — `CAPTURE_SCHEMA_VERSION` gates envelope shape only); it would require vendoring a frozen copy, a second pairing walk maintained forever. Upgrading re-points `zipByText`/disposition at the card join, re-pins the tallies, and replaces the cross-check identity with the FRD's card-root identity.
- The frozen regex copies (:96-99, byte-identical to parser :77-80) lose their drift-guard the moment the parser's urn pattern widens — the copy mechanism itself argues for a shared helper exported from src/linkedin-parser.ts and imported by the harness.
- Latent era-mixing: capture envelopes on disk carry `minted` counts produced by the old rule; after the rewrite the same field means "cards linked". `readCapture` (:623-639) validates shape, not semantics.

### The fixture plan (acceptance criteria imply a new fixture class, distilled now)

- tests/fixture/ holds only Threads artifacts; the sanctioned file-fixture idiom is tests/extract.test.ts:14-29 (readFileSync + whole-array deep-equal against exact `Post[]`).
- The zip-era synthetic fixtures cannot express the join: `cardBody`'s id row is unreachable from its marker row (tests/linkedin-parser.test.ts:58-76) — a join-minting parser would drop it, correctly. `JOIN_BODY` (tests/replay-linkedin.test.ts:76-92) is the only existing shape with the `$`-ref back-reference the join needs.
- Retention forces the timing: `CAPTURE_KEEP_SESSIONS = 20` (src/linkedin-capture.ts:46) and the replay usage warning "captures roll off after ~one working day; copy captures/ out first" (scripts/replay-linkedin.ts:46-52). The 200-body evidence base at H:/fork/loker-watcher/captures/ is outside every clone and on an eviction clock — fixtures must be distilled into tracked tests/fixture/ now, and a generator script makes that repeatable.
- Fixture matrix (one exemplar per outcome class): (1) real-layout multi-row card with the urn reachable only from the climbed root (modeled on JOIN_BODY, real rows pinned by .rpiv/tmp/dbg9.ts/dbg10.ts); (2) share/ugcPost-typed card (FR4/FR5 — `mintPost`'s activity hardcode :194-200 must widen); (3) 0-urn card (FR6); (4) 2-activity-urn card (FR7); (5) multi-card body with manifest/garbage rows (FR8 + the req-9 log pin).
- Generator script shape: the `runReplay`/`ReplayDeps` gate (scripts/replay-linkedin.ts:641-671) + the `readCapture` envelope gate (:623-639) + entry-guarded FAILED wrapper (:673-686); registration in package.json lint and format lists (:12-13) plus an npm alias is mandatory or the script escapes Biome. Repo writes by an operator script do not violate the offline doctrine (it is a test-suite rule); new artifact dirs must be gitignored in the same change (`guardCheckout` throws on untracked files, scripts/fetch-linkedin.ts:246-283).
- Trim doctrine: byte-real values, compressed skeleton, in-file provenance (tests/fixture/tag-page.html:2-7). Trim is safe because `parseFlightRows` is line-based — preserve row hexes and `$`-ref targets byte-exactly. The `idFor`/`idAt` forward-trick ids stay valid (`mintPost`'s clock survives).

## Code References

- src/linkedin-parser.ts:216-322 — `collectLinkedInPosts`: the six-stage positional pipeline being rewritten
- src/linkedin-parser.ts:79-80 — `URN_RE` / `DIGITS_RE`: the id-shape constants; :79 must widen to share/ugcPost
- src/linkedin-parser.ts:87-105 — `parseFlightRows`: survives verbatim (join substrate)
- src/linkedin-parser.ts:109-175 — `textFromChildren`: survives untouched
- src/linkedin-parser.ts:185-203 — `mintPost` + guard: kept per FRD; :200 permalink construction must take the card urn
- src/linkedin-parser.ts:221-268 — the `visit` closure: urn capture (widen), whole-ref traversal (relocate), marker seed (:252-261), digit-field/urn-key rules (drop)
- src/linkedin-parser.ts:269-313 — global consolidation, usable filter, sort, zip + warn: deleted/relocated per stage table
- src/linkedin-parser.ts:312-320 — the pairing-oracle log: re-based into the req-9 line
- src/linkedin-parser.ts:26-35 — the PAIRING header paragraph: deleted; rewrite names the climb's evidence
- src/linkedin-fetch.ts:562-577 — the mint arm: first-wins dedupe, seen-streak, `fresh`, `parsed`
- src/linkedin-fetch.ts:587-606 — the capture arm: envelope with `minted`/`fresh`
- src/linkedin-fetch.ts:660-666,733-736 — seen-stop checks; :717-720 dry-round gain
- src/linkedin-payload.ts:65,88-107 — `ACTIVITY_URN_RE` + `isValidRow`: id pinned, permalink non-empty
- src/linkedin-payload.ts:30,143-235 — `PAYLOAD_VERSION` + `readPayloadPosts` (never throws)
- src/linkedin-capture.ts:33,46,56-78 — `CAPTURE_SCHEMA_VERSION`, `CAPTURE_KEEP_SESSIONS = 20`, `CaptureRecord`
- src/state.ts:115-134,176-204,207-212 — prune, `readSeenIdSet` (unpruned), `diffNew` (id-only)
- src/index.ts:246,300-331,560-568 — seam default, funnel arm, `persistJudged`
- src/index.ts:606-637 — `dedupePosts` + `mergeSurfaceStamps` (id-keyed; permalink rides)
- src/email.ts:137, src/heartbeat.ts:160 — the two verbatim permalink renders
- src/types.ts:21 — `Post.permalink` (plain string; no shape change)
- src/judge.ts:260,282 — judge prompts: id/author/text only, never permalink
- scripts/replay-linkedin.ts:53 — the live-parser import; :96-99 frozen regex copies; :281-307 `refTargets`; :330-350 `reachableCount`; :352-434 `collectRowCensus`; :449-457 `zipByText`; :478-492 refs+reverse; :535,:584-589 the Option-A verdict; :623-639 `readCapture`; :641-686 gate shape + entry guard
- scripts/fetch-linkedin.ts:385,398-407 — `seenIds` load + threading into the walk
- tests/linkedin-parser.test.ts:212-224,231-286,298-311 — the zip proof, four warn pins, oracle pin (die/re-base)
- tests/replay-linkedin.test.ts:63-92,149-160,224-297 — MIXED_BODY/JOIN_BODY, the mkdtemp replay idiom, the pinned tallies
- tests/extract.test.ts:14-29 — the file-fixture idiom to copy
- tests/fixture/tag-page.html:2-7 — the byte-real trim doctrine
- watcher.config.json — `recencyHours: 72` (the re-send math input)
- state/seen-posts.json:52289,53117,53125,60426 — the zip-era urn keys (purge target)

## Integration Points

### Inbound References
- src/linkedin-fetch.ts:564 — the only production caller of `collectLinkedInPosts` (the mint arm inside the response interception)
- scripts/replay-linkedin.ts:53,449-457 — the harness imports the live parser and executes it per analyzed body (`zipByText`)
- tests/linkedin-parser.test.ts, tests/replay-linkedin.test.ts:268-280 — both suites pin parser output shapes
- src/index.ts:300-331 — the hosted funnel consumes the payload rows the PC leg wrote from these mints
- src/email.ts:137, src/heartbeat.ts:160 — render `post.permalink` verbatim (the bug surface)

### Outbound Dependencies
- src/linkedin-parser.ts imports only `type Post` from src/types.ts — a pure leaf; no Playwright, no I/O (:43-46 purity header)
- The climb depends on nothing new: `parseFlightRows`'s row map is the graph's node set; `$`-ref regexes (:77-78) are the edge rules
- src/state.ts:176-204 — the walk's `seenIds` (unpruned full history) and the hosted seen-gate (pruned) read the same file with different windows

### Infrastructure Wiring
- scripts/fetch-linkedin.ts:385,434-438 — `seenIds` load; payload write + push (the PC leg's tick)
- watcher.config.json — `recencyHours: 72` gates both the recency filter and the seen-key prune
- .gitignore:3,6 — `.rpiv/tmp/` scratch and `captures/` root are untracked by decision; `guardCheckout` (scripts/fetch-linkedin.ts:246-283) throws on untracked files
- package.json:12-13,28 — lint/format file lists + npm alias: any new script must be registered or it escapes Biome

## Architecture Insights

- `Post.id` is the pipeline's primary key; `Post.permalink` is presentation-only. That division is why reqs 4 and 5 decouple cleanly: every join (walk :567, dedupe :606, state :210, persist :566) and every LLM input (:260, :282) uses id/text/timestamp; exactly two template literals touch permalink.
- Drop-and-count is one doctrine in two layers: the parser's new card guard (reqs 6/7) and payload admission's row gate (:199-210) both degrade visibly without failing the run.
- One graph, two consumers: `refs`/`reverse` are simultaneously the climb's raw material and the probe arms whose asymmetry (forward 107 / reverse 0 on body 080) is the evidence that unfroze the parser. BOTH (marker∩id) rows are the live join shape.
- Copy-with-instrumentation exists only because the parser was frozen; upgrading dissolves the copies into a shared helper export — the drift-guard's own mechanism argues for it once the urn regex widens.
- Pinned-string drift alarms are the designed tripwire: the rewrite trips every zip-era pin on purpose; the harness and header rewrites must land in the same change or the tripwires fire without their fix.
- Timestamps ride the activity id clock (`BigInt(id) >> 22n`, kept in `mintPost` :188) while the permalink may embed a share id — the guard still protects the dedupe key, never the link.

## Precedents & Lessons

3 similar past changes analyzed.

### Precedent: PR #22 — the prior "fix incorrect link" attempt shipped only the harness, not the fix
**Commit(s)**: `14ccec5` — "linkedin: add capture/replay harness for raw bodies" (2026-11-13); `fcca189` — "linkedin: pairing and capture-replay artifacts"; merged as `4f3970a` (2026-11-13)
**Blast radius**: 19 files across scripts, src, tests, .rpiv — scripts/replay-linkedin.ts (685 new), src/linkedin-capture.ts (207 new), src/linkedin-fetch.ts (+81); **src/linkedin-parser.ts untouched — the zip survived the merge**

**Follow-up fixes**:
- `92974a5` (2026-11-13) — main-into-branch conflicts in exactly 3 recurring files: scripts/fetch-linkedin.ts, src/linkedin-fetch.ts, tests/linkedin-fetch.test.ts

**Lessons from docs**:
- .rpiv/artifacts/discover/2026-11-13_08-49-04_linkedin-post-pairing.md — the capture-first split that deferred this fix; diagnose-first is done
- .rpiv/artifacts/solutions/2026-11-13_10-20-27_linkedin-post-link-pairing.md — hard constraints that still bind: `PAYLOAD_VERSION` exact equality, `exactOptionalPropertyTypes` omission style, `guardCheckout` + gitignore-in-same-change, `isValidRow` must NOT relax non-empty text/permalink

**Takeaway**: This branch is the deferred second half — consume the harness, land the parser rewrite in one change, do not re-split.

### Precedent: the browser-walk migration that created the parser
**Commit(s)**: `8e8f22b` — "Migrate the LinkedIn leg to a browser walk" (2026-11-11); 25 files, deleted the Voyager/curl leg, created src/linkedin-parser.ts (322 lines)

**Follow-up fixes** (5 within 3 days):
- `6493f2a` — walk reported 3 posts with no way to tell why (the observability that later enabled diagnosis)
- `ce567af` — reverted the plan's Phase 1 pairing rule to match source: "the implementer follows the doc"
- `9fa2a7e`, `e624cec`, `4983bc1` — session/liveness/scroll corrections; `572e76d` — bot-pushed state churn

**Lessons from docs**:
- .rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md — VERIFIED: "the count-mismatch zip mis-pairs, it does not merely drop" (every pair after a gap shifts); the row-local pairing rule was disproved (3/6)
- .rpiv/artifacts/designs/2026-11-13_11-24-35_linkedin-post-link-pairing.md — census 3 BOTH / 130 ids-only / 3 texts-only; CTA markers are spec-identical to real posts; the junk-gate remains a named follow-up, out of this FRD's scope
- .rpiv/artifacts/research/2026-11-13_09-34-22_linkedin-post-link-pairing.md — shareId join present in only 76/175 bodies (why the card-root join was chosen); the oracle line was the only mis-pair detector

**Takeaway**: Pairing logic has burned twice on measured evidence; keep every plan fence byte-identical to intended source, and update header prose, fences, and the log contract in the same change.

### Precedent: the module header still asserts the claim this fix disproves
**Commit(s)**: `de4fde5` — "On main: run6-final-snapshot" (2026-11-14) — last parser touch (+14 header/PAIRING prose) and an 829-line src/linkedin-fetch.ts rewrite

**Follow-up fixes**: none yet — the "BFS reaches zero id rows" claim (:27-29) is live on main and falsified by body 080.

**Takeaway**: The fix is bigger than `collectLinkedInPosts`: the header PAIRING/permalink prose and `mintPost`'s unconditional permalink construction encode the old design and must change together, or the header will lie exactly like the plan fence did in `ce567af`.

### Composite Lessons
- Position/count pairing shifts every pair after a gap — "mis-pairs, does not merely drop" (recurring 3×: synthetic VERIFIED 2026-11-11, production row-180 incident 2026-11-13, dry run 340/340 disagree 2026-11-14). No zip/prefix/min() fallback is acceptable; unprovable = drop and count.
- Junk mints are a harvest defect, not a pairing defect — the card-root join will NOT fix bare-URL/email/hashtag text mints; the mint gate stays a named follow-up.
- src/linkedin-fetch.ts is the highest-churn file (rewritten twice; the recurring 3-file conflict set) — keep this branch short-lived and merge main early.

## Historical Context (from `.rpiv/artifacts/`)
- .rpiv/artifacts/discover/2026-11-14_07-15-07_linkedin-permalink-card-join.md — the FRD driving this research
- .rpiv/artifacts/discover/2026-11-13_08-49-04_linkedin-post-pairing.md — the prior FRD that scoped the same bug and split harness-first
- .rpiv/artifacts/designs/2026-11-13_11-24-35_linkedin-post-link-pairing.md — the replay-era design; Not Building list that froze the parser
- .rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md — the walk migration design; the rejected row-local pairing measurement
- .rpiv/artifacts/research/2026-11-13_09-34-22_linkedin-post-link-pairing.md — the pairing research (shareId 76/175; oracle-line doctrine)
- .rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md — the migration plan (zip mis-pair proof; share-urn 321 ms table)
- .rpiv/artifacts/plans/2026-11-13_15-27-41_linkedin-capture-replay-harness.md — the capture/replay harness plan
- .rpiv/artifacts/solutions/2026-11-13_10-20-27_linkedin-post-link-pairing.md — the binding hard-constraints record

## Developer Context
**Q (discover: Root cause): The probe says the wrong link comes from the positional zip in src/linkedin-parser.ts — the i-th text pairs with the i-th id by time, and the stream carries no real text-to-id link. Is that the fault to fix?**
A: "dry run first to validate your potential solution". The dry run confirmed the fault: 340 of 340 cards disagree with the zip.

**Q (discover: Fix shape): The shareId join is verified but only present in 76 of 175 bodies. Which fix shape do you want the FRD to specify?**
A: "shareId is good, but how come not all have shareId? also find another way instead of using DOM fallback?" — the card-root join replaces both; it needs no shareId and no DOM (423/423 real cards carry exactly one activity urn).

**Q (discover: Permalink shape): The card carries one urn, but its type varies (activity, share, ugcPost). Which permalink shape should the FRD specify?**
A: Card urn, type kept. `urn:li:activity:<shareId>` returns "Post not found"; `urn:li:share:` and `urn:li:ugcPost:` resolve to the exact post.

**Q (discover: Already-emailed posts): After the fix, posts already emailed with wrong links will come back under correct ids. What should happen to them?**
A: Re-send with correct links.

**Q (discover: Cards with no urn or many urns): When a card yields no urn, or more than one, what should the parser do?**
A: Drop and count. A real card carries exactly one activity urn and one share or ugcPost urn; the edge case does not occur in 423 cards.

**Q (src/state.ts:207-212): The re-send decision cannot self-execute — diffNew is id-only, state/seen-posts.json already holds the zip-era urn keys (:53117, :53125), and the persist-stamp + 72 h prune always outlives the id clock + 72 h, so no corrected post with a seen key can ever naturally re-send. How does re-send execute?**
A: Purge LinkedIn urn keys — a one-time deletion of all `urn:li:activity:` keys from state/seen-posts.json before the first fixed tick; everything judged under the zip re-judges and re-sends.

**Q (scripts/replay-linkedin.ts:53): The harness imports the live parser, pins zip tallies (tests/replay-linkedin.test.ts:268-280), and carries frozen regex copies (:96-99) that the widened urn pattern breaks. What happens to the replay harness?**
A: Upgrade in the same change — re-point the harness at the card-root join via a shared helper export from the parser; re-pin tallies and cross-checks.

## Related Research
- .rpiv/artifacts/research/2026-11-13_09-34-22_linkedin-post-link-pairing.md — the direct predecessor: zip mis-pair mechanics, shareId join coverage, the harness charter

## Open Questions
None deferred from the FRD. Note: the second urn's field path inside the card subtree is unpinned by committed artifacts; the join is specified reachability-based (req 3), so no open question rides on it. The H:/fork/loker-watcher/captures/ corpus is outside this workspace and on a ~20-session eviction clock — fixture distillation is time-sensitive.