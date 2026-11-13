---
date: 2026-11-13T10:20:27+0700
author: Yogiswara Utama
commit: 33e17dc
branch: ukind/feature-fix-incorrect-link-linkedin
repository: feature-fix-incorrect-link-linkedin
topic: "LinkedIn post-link pairing"
confidence: medium
complexity: medium
status: ready
verdict: pass
tags: [solutions, linkedin-parser, linkedin-fetch, linkedin-payload, email, heartbeat]
last_updated: 2026-11-13T11:13:50+0700
last_updated_note: "Round 4: harness-citation sweep - wedge and biome claims confirmed, concurrency cite corrected to :63, wrapper span to :413-422, 4 over-eager fixes reverted, stamps appended"
last_updated_by: Yogiswara Utama
---

# Solution Analysis: LinkedIn post-link pairing

**Date**: 2026-11-13T10:20:27+0700
**Author**: Yogiswara Utama
**Commit**: 33e17dc
**Branch**: ukind/feature-fix-incorrect-link-linkedin
**Repository**: feature-fix-incorrect-link-linkedin

## Research Question
Rewrite the mint path in `src/linkedin-parser.ts` around a proven per-post join: locate the card-scoped id-to-text association in fresh Flight captures (or prove none exists, making unlinked mints the norm); add a non-post mint gate, optional `Post.permalink` with digest handling, raw-body capture in `src/linkedin-fetch.ts`, and `scripts/replay-linkedin.ts` for offline proof. Chained from `.rpiv/artifacts/research/2026-11-13_09-34-22_linkedin-post-link-pairing.md`.

## Summary
**Problem**: The position zip in `collectLinkedInPosts` pairs ids to texts by array position after destroying the per-row association. The mispair is committed evidence: payload row 180 minted the QA Engineer text under a foreign id, and 15 junk mints live in the current payload.
**Recommended**: Unlinked-by-default — mint ONLY rows with a harvested text — the ranked prior among the three mint policies, explicitly evidence-gated. The capture + replay harness is a precondition (the recorded capture-first decision, not a finding of this analysis); the replay output selects or upgrades the policy.
**Effort**: Med (2–3 days for the precondition harness + rehearsal, assuming a live LinkedIn cookie — a dead session adds a headed `npm run login-linkedin` hold, which is operator-gated, not engineer-gated; the mint change is sized after the replay)
**Confidence**: Medium — the ranking rests on committed evidence; the deciding facts arrive with the replay.

## Problem Statement

**Requirements:**
- R1: A post permalink can only come from a proven id↔text association. Every variant of position pairing dies.
- R2: Non-post rows (bare URL, bare email, lone hashtag) can never mint. The replay names the true cause per row before the gate predicate freezes.
- R3: Posts without a provable link ship without one: `Post.permalink` goes optional, the digest omits the link line, the heartbeat omits the candidate link.
- R4: Raw-body capture in `src/linkedin-fetch.ts` and `scripts/replay-linkedin.ts` land first (developer decision, capture-first).
- R5: The oracle channel (console lines with stable prefixes) names linked/unlinked/skipped per body.
- R6: Duplicate reposts stay as-is. No collapse.

**Constraints:**
- Hard: the PC walker and the hosted reader deploy independently, and `PAYLOAD_VERSION = 2` is checked with exact equality. Per-envelope degradation blackouts the whole leg; only per-row degradation is acceptable.
- Hard: `exactOptionalPropertyTypes` is on. An optional field is omitted, never undefined-assigned.
- Hard: offline tests never write to the repo tree; every suite mkdtemps.
- Hard: `guardCheckout` throws on any untracked file before every tick. Any new artifact directory must be gitignored in the same change.
- Hard: the mint predicate requires a harvested text; `isValidRow:95` must NOT be relaxed (see Current State).
- Soft: keep the file set inside what the 2026-11-11 migration touched (src/, scripts/, package.json, .gitignore, tests).

**Success criteria:**
- The capture harness rides every PC entry point (tick, loop, probe, chain) and cannot run hosted.
- Replay names, per row: the mint decision (linked/unlinked/skipped) and the cause (CTA contamination vs $-ref shrink).
- The mint-path design is written from replay evidence, not before.
- `npm run typecheck && npm run lint && npm test` stays green after each change.

## Current State

**Existing implementation:**
- `src/linkedin-parser.ts:216-322` — `collectLinkedInPosts`: the per-root-row walk collects `rowIds` (:223) and `rowTexts` (:224), then destroys the association. Ids flatten into a global array (:270-272). Each row's texts collapse to one longest winner (:273-279). Then: usable filter (:284-291), numeric sort (:296-300, the `>> 22n` clock is monotonic), `paired = min(ids, texts)` (:301), mismatch warn (:302-306), prefix zip (:307-311), oracle line (:316-320).
- `src/linkedin-parser.ts:185-203` — `mintPost`: timestamp = `BigInt(id) >> 22n`; the permalink constructs UNCONDITIONALLY at :200 from the paired id. This is the line where "proven" must gate.
- `src/linkedin-parser.ts:109-177` — `textFromChildren`: silent drops on the whole-row ref (target missing or already seen) and the path-ref miss. This is junk Cause B.
- `src/linkedin-parser.ts:26-36` — header claim: BFS from every marker row reaches zero id rows (2026-11-11, 1.5 MB capture, depth 12). The capture file no longer exists on this branch.
- `src/linkedin-fetch.ts:481-528` — the response join: the unmatched-flagship diagnostic arm (:486-503) and the matched mint arm (:506-528), both fire-and-forget inside page-close-race catches. `LINKEDIN_XHR_DRAIN_MS = 1500` (:106-107) is the only grace window. `LINKEDIN_FETCH_CONCURRENCY = 2` (:63).
- `src/linkedin-payload.ts` — `PAYLOAD_VERSION = 2` (:30); exact-equality gate (:178-181); `stampsAreValid` tolerance precedent (:83-85); `isValidRow` requires non-empty permalink (:99-100) AND non-empty text (:95-96); per-row drop+count (:200-209).
- `src/types.ts:11-32` — `Post`: `permalink: string` required (:21); `surfaces?: Surface[]` optional (:28, the precedent); `text: string` required (:14-17).
- `src/email.ts:126-148` — the digest item template interpolates `post.permalink` at :137.
- `src/heartbeat.ts:160` — the heartbeat candidate line interpolates `candidate.post.permalink`; it serves Threads candidates too.
- `src/index.ts` — the hosted LinkedIn arm reads the payload (`linkedinFetch ?? readPayloadPosts`, :294-315); it imports only a TYPE from linkedin-fetch (:58); `mergeSurfaceStamps` holds the conditional-spread precedent (:615-632).

**THE FINDING THIS RUN ADDS — the text gate, stated as a constraint:**
`isValidRow` requires non-empty text (`src/linkedin-payload.ts:95-96`). The research swept `.permalink` across the codebase and mapped only :99-100; it missed :95-96. The gate is a CORRECT BACKSTOP, and the committed census (design:170 — of 136 rows, 3 carry both id and text, 130 ids-only, 3 texts-only) turns it into a design constraint rather than a hazard:
- A "mint every usable id" premise yields ~133 mints per census-shaped body, of which 130 carry no text. `:95` drops all 130: the payload file bloats by 130 dead rows every tick, the hosted reader emits its "malformed row(s)" warn on every run — masking real malformation behind a permanent false positive — and delivered yield is unchanged from today.
- The incumbent zip already limited yield to text-bearing rows via `paired = min(ids, texts)` (:301). Minting shells buys nothing and costs payload churn plus the false warn.
- The first run's "non-empty by construction" phrasing was wrong: it describes the text that gets attached, not that every mint has one. Empty harvests never enter `rowTexts` (:259), so ids-only rows have NO text to attach — "attach text to every unlinked mint" was impossible for the majority, and the third exit (do not mint textless rows) is what the incumbent already did.

**Constraint:** the mint predicate must require a harvested text (plus a usable id — no id means no clock and no key, which is why the 3 texts-only rows cannot mint either). `isValidRow:95` must NOT be relaxed. The downstream empty-text failure modes the first run catalogued (empty-prompt judge calls at index.ts:450/judge.ts:260, junk digest items at email.ts:137, empty heartbeat snippets) die with this constraint: textless rows never exist as Posts.

**Relevant patterns:**
- Fire-and-forget catch: `src/linkedin-fetch.ts:490-503` and :506-528 — 2 uses in one function
- Optional member + tolerant read: `src/types.ts:28` + `src/linkedin-payload.ts:83-85` + `tests/linkedin-payload.test.ts:194,202,217,226` — one complete precedent cycle (surfaces)
- Conditional spread (key omitted): `src/index.ts:629-631`, `src/email.ts:224`, `src/heartbeat.ts:141-142`, `tests/index.test.ts:122-130` — 4 sites
- Injectable deps: `FetchTickDeps` `scripts/fetch-linkedin.ts:85-131` (three injected paths + rng/now); trailing param `minClicks = 0` at `src/linkedin-fetch.ts:686`
- Entry-guarded diagnostic script: `scripts/probe-linkedin.ts:1-33`; guard + FAILED wrapper at `scripts/fetch-linkedin.ts:413-421`
- Atomic write (temp + rename): `src/state.ts`, reused by the payload writer

**Integration points:**
- `src/linkedin-fetch.ts:481-528` — the capture bolt-in sites (both arms)
- `src/linkedin-fetch.ts:678-687`, :461, :722 — fetchLinkedInPosts signature, walkLinkedInSurface definition, its one call
- `scripts/fetch-linkedin.ts:246-262` — guardCheckout: makes a .gitignore captures/ entry load-bearing
- `package.json:13-14` — the lint and format explicit lists (already asymmetric); any new script must join both
- `src/linkedin-payload.ts:95-96`, :99-100 — :95 is the backstop the mint predicate must satisfy by construction; :99-100 is the admission gate the optional-permalink change relaxes
- `src/email.ts:137`, `src/heartbeat.ts:160` — the render sites for the optional-permalink change

## Solution Options

All three candidates are MINT POLICIES — how the parser attaches text and permalinks to ids. The capture + replay harness is not a candidate; it is the precondition that produces the deciding evidence (see Scope Boundaries). The shared ripple set below is scored once; the options differ only in the pairing rule inside the parser and in what evidence promotes them.

**Shared ripple set (every policy pays this):**
- `Post.permalink` goes optional (types.ts:21; the surfaces? precedent :28; conditional spread at 4 sites; `exactOptionalPropertyTypes` forbids undefined-assignment).
- Payload admission: :99-100 relaxes to the `stampsAreValid` shape (undefined passes, present-malformed fails the row); `PAYLOAD_VERSION` stays 2 — per-row degrade, never per-envelope blackout. `:95` stays STRICT under every policy (the constraint above).
- Renderers: email :137 rebuilt as a lines array (no trailing whitespace, exact-string pins); heartbeat :160 gets a presence guard — the line serves Threads too, outright deletion is over-broad.
- Deploy ordering: the relaxed hosted reader must go live before (or with) the walker change that ships unlinked rows. A skew window degrades per-row (drop+count warn, rows lost), never a blackout. The PC clone should pull after one hosted cron has passed, or one tick of rows is lost with a visible warn.
- The text gate is a constraint, not a hazard: every policy's mint predicate requires a harvested text; only the link is optional.

**The three policies form a pairing-strength ladder:** B (never link) ⊂ C (link within-row 1:1) ⊂ A (link wherever the stream proves it). Upgrading B to C or A never discards B's work — the ripple set is identical; only which text-bearing rows become linked changes.

### Option A: Proven-join pairing (stream-scoped)
**How it works:**
A $-ref join across the Flight graph (forward from marker rows, reverse from id rows) attaches text AND permalink where the association is proven; text-bearing rows without a proven association mint unlinked. The six-point probe protocol decides whether the join exists.

**Dimension scores** (orchestrator-scored from committed evidence + the shared ripple cells; the premise is already answered by committed evidence, so no fresh dispatch was spent):
- precedent-fit: no join mechanism exists anywhere in the codebase. The committed BFS census (`linkedin-parser.ts:26-36`, depth 12, both directions) says the association is ABSENT from the stream. The branch is dead code unless the fresh capture contradicts the header claim.
- integration-risk: the shared ripple set plus novel join logic; a never-firing branch is pure complexity with no failure surface — waste, not danger.
- migration-cost: highest of the three (join detection over the $-ref graph + the full ripple set).
- verification-cost: the join branch has NO offline fixture — `cardBody` manufactures adjacency, not refs. Entirely replay-gated.

**Verdict:** fails today on committed evidence. PROMOTION CONDITION: the fresh capture's six-point probe finds a card-scoped join — then A becomes the pairing rule and B's ripple work carries over unchanged.

### Option B: Unlinked-by-default (text-required mints)
**How it works:**
Only rows with a harvested text mint a Post. Ids-only rows (130 of 136 in the committed census) never mint, so the text gate (:95-96) never fires and the payload carries only deliverable rows. The text is the row's own harvest — the incumbent's longest-winner machinery (:273-279) — filtered by the junk gate (R2). The permalink key is omitted in this policy's pure form. The id side stays evidence-gated: the replay classifies text-bearing rows by id count (the six-point probe), and the mint design picks the id rule from that; a text-bearing row with no usable id has no clock (the timestamp derives from the id) and no key, so it cannot mint either. No cross-row claim is ever made, so no wrong link can ship. Delivered yield matches the incumbent zip's text-bearing limit (`min(ids, texts)`, :301) — minus mispairs, minus junk.

**Dimension scores** (structure inherited from first-run agent evidence, agent 41fd1c9a; the integration-risk cell is RE-SCORED against the corrected premise):
- precedent-fit: the strongest. Every mechanism has a shipped precedent: optional Post field (surfaces?, types.ts:28), tolerant read (`stampsAreValid`, linkedin-payload.ts:83-85), v2 without a bump, conditional spread at 4 production sites. 1 producer, 3 readers. The text-required predicate is a restoration, not an invention — the zip's `min(ids, texts)` already enforced it implicitly.
- integration-risk: agent 41fd1c9a scored a REAL blocker against the first-run premise ("every usable id mints"): textless shells dropped at :95-96 while the leg reads "ok". That blocker is resolved by the premise change, not by a gate relaxation — textless rows are never minted, the payload never carries a dead row, and the "malformed row(s)" channel (:200-209) stays reserved for real malformation instead of firing permanently. Residual observability requirement: skipped ids-only rows must surface in the oracle line (R5) as skipped-with-cause, so a low mint count reads as filtering, not silent loss.
- migration-cost: the smallest parser delta — make the incumbent's implicit yield limit an explicit mint predicate, delete the zip tail (:284-311), no join branch, extend the oracle line (R5).
- verification-cost: moderate. No paired branch to test. The zip-era parser tests die (:212-222, :231-243, :245-260), the oracle test rewrites (:298-308), email/heartbeat get their first permalink-less fixtures, payload gains tolerant-read cases. New pins: an ids-only body mints ZERO with a skipped-with-cause oracle line; a texts-only row skips (no clock, no key).

**Verdict:** clears on today's committed evidence. The junk-gate predicate stays replay-gated (R2) — the policy ships only after the replay names Cause A vs Cause B per junk row.

### Option C: Row-local 1:1 (within-row only)
**How it works:**
A root row carrying exactly one usable id AND one text marker pairs within the row; text-bearing rows that fail the strict gate mint unlinked with per-row text. No cross-row pairing ever. In ladder terms: C is B plus a per-row upgrade rule.

**Dimension scores** (inherited from first-run agent evidence, agent b34af545):
- precedent-fit: the per-row state is the incumbent (`rowIds` :223, `rowTexts` :224); the gate is one size check where the flatten runs (:270-272). The loose form was DISPROVED (design:170: resolved 3 of 6 text rows); the strict exactly-one-id form is untried.
- integration-risk: shared ripples; plus residual pool-consumption mis-assignment for unlinked text-bearing rows whose ids come from the pool, and a mis-consumed id lands in the id-keyed seen-posts ledger (state.ts:25), where it can suppress the true owner of that id on a later run. Plus the chip row fails the strict gate by construction (design:86: a 1923-char post and a hashtag chip share one row — that real post mints unlinked).
- migration-cost: moderate; the size gate plus the full ripple set.
- verification-cost: the fixture-validity trap — no fixture row qualifies under the strict gate (`cardBody` emits id-row and marker-row as separate adjacent roots, :58-72), so the paired branch needs manufactured shapes and a green suite proves only the unlinked path. Heaviest pin re-basing of the three.

**Verdict:** clears mechanically; its doubts are measured, not speculative. PROMOTION CONDITION: the replay shows exactly-1:1 rows are common — then C's size gate upgrades B's text-bearing rows to linked ones at almost no extra code.

## Comparison

| Criteria | A: Proven-join | B: Unlinked-by-default (text-required) | C: Row-local 1:1 |
|----------|----------|----------|----------|
| Pairing strength (linked yield) | Highest IF the join exists | None — all unlinked (R3-legal) | 3 of 6 text rows measured (loose form); strict unmeasured |
| Committed-evidence fit | Contradicted (:26-36) | Supported | Loose form disproved (:170); strict untried |
| Parser delta | Join logic + ripple set | Text-required predicate + delete zip + ripple set (smallest) | Size gate + ripple set |
| Mint yield vs incumbent | Same text-bearing limit | Same text-bearing limit (min(ids,texts), by predicate) | Same text-bearing limit |
| Paired branch testable offline | No fixture possible | No paired branch | Fixture trap — needs manufactured shapes |
| Failure mode if wrong | Dead branch (waste) | Zero links shipped (accepted by R3) | Ledger suppression + chip-row misses |
| Text gate (:95-96) posture | Backstop only — every mint is text-bearing | Correctly filtered; textless rows must not mint | Backstop only — every mint is text-bearing |
| What promotes it | Probe finds a join | Default — clears today | Replay shows common 1:1 rows |

## Recommendation

**Honest framing:** the first run of this artifact recommended the capture + replay harness with `confidence: high`. That restated the developer's recorded capture-first decision — circular, and the confidence overstated the yield. What the analysis actually produced is three things: the text-gate constraint (:95-96, missed by the research's `.permalink`-only sweep), the corrected candidate set (three mint policies on a nesting ladder), and the shared ripple + deploy-ordering map. Round 2 corrected Option B's premise: mint only rows with a harvested text — the every-id premise was self-defeating against the census.

**Selected:** B — Unlinked-by-default with text-required mints, as the ranked prior, explicitly evidence-gated.

**Rationale:**
- Only B is consistent with all committed evidence: A is contradicted by the BFS census (:26-36), C's loose form by design:170, and C's strict form is unmeasured.
- The text gate is a constraint B satisfies by definition: it mints only text-bearing rows — the incumbent's own `min(ids, texts)` yield limit restored as an explicit predicate — so `:95` stays strict, the payload never bloats with dead rows, and the malformed-warn channel stays honest.
- B is the floor of the ladder: C and A upgrade text-bearing unlinked rows to linked ones when evidence supports it, and none of B's ripple work is discarded by an upgrade.

**Why not A or C today:**
- A: dead branch on committed evidence — build it only if the probe finds the join.
- C: chip-row by-construction misses, the fixture-validity trap, and ledger suppression — all measured; adopt its size gate only if the replay shows 1:1 rows are common.

**Conditions that change the ranking:**
- The six-point probe finds a card-scoped join → A becomes the pairing rule; B's ripple work carries over.
- The replay shows exactly-1:1 rows are common → C's size gate upgrades B.
- The replay shows $-ref shrink (Cause B) dominates junk rows → `textFromChildren` hardening lands before or with the gate; the gate alone is a symptom fix.

**Implementation approach:**
1. Precondition change (recorded decision): the capture + replay harness — see Scope Boundaries for the design notes. ~2-3 days including one live rehearsal, assuming a live cookie.
2. Rehearsal + replay: one live walk, the six-point probe per body, the per-row junk-cause table.
3. Mint change: the selected policy (B, upgraded by C or A as evidence allows) + the shared ripple set + the junk gate frozen only after R2 is satisfied. Sized from the replay output.

**Integration points (mint change):**
- `src/linkedin-parser.ts:185-203` (mintPost conditional permalink), :216-322 (the zip dies), :109-177 (Cause B hardening if indicated)
- `src/types.ts:21`, `src/linkedin-payload.ts:99-100`, `src/email.ts:137`, `src/heartbeat.ts:160`
- Patterns: tolerant read `linkedin-payload.ts:83-85`; conditional spread `src/index.ts:629-631`; lines-array rendering per the email exact-string pin `tests/email.test.ts:123-140`

## Scope Boundaries

**Precondition (the recorded capture-first decision — not a candidate, restated here because the whole plan sits on it):**
Land the raw-body capture harness and `scripts/replay-linkedin.ts` as their own change, record one live walk, replay it, and only then write the mint-path design. Design notes that survive from the first run verbatim:
- Sink: atomic whole-file writes (sibling temp + rename, the `state.ts` idiom); ONE file per body under `captures/<UTC session stamp>/<ordinal>-<surface-slug>.json`; metadata envelope INSIDE each file (schemaVersion, capturedAt, label, ordinal, received, FULL url — the unmatched arm truncates only its log line to 80 chars, status, matched, verbatim body); the ordinal increments synchronously in the listener; the sink is injectable (config constant in `src/config.ts`, tmp injection in tests).
- Bolt-in: inside BOTH existing try-blocks (`linkedin-fetch.ts:490-503`, :506-528), fire-and-forget under the existing page-close-race catches; a defaulted trailing param on `fetchLinkedInPosts` (:678-687); thread `walkLinkedInSurface` (:461 → :722). None of the 28 call sites breaks.
- Wiring: the .gitignore `captures/` entry lands IN THE SAME CHANGE — `guardCheckout` (:246-262) throws on any untracked file before every tick, so the first successful capture would otherwise wedge the whole PC loop. The replay script joins BOTH biome lists (package.json:13 lint, :14 format) plus the npm alias, or it escapes lint entirely.
- Isolation: the hosted run imports only a type from linkedin-fetch (`src/index.ts:58`) — capture cannot run on GitHub Actions.
- Accepted losses: a capture lost inside the 1.5 s drain (:107) is acceptable; a lost walk is not. A persistently failing sink is silent under the comment-only catches — design decides whether first-failure-per-warns.
- Content surface: no credentials by construction (`ResponseLike` exposes url/status/text only); the residual surface is public search-result content plus the surface keyword.
- Patterns: fire-and-forget catch (:490-503); `FetchTickDeps` (:85-131); entry guard + FAILED wrapper (:413-422); the probe-linkedin export-a-call shape; trailing param (:686).

**Building next (the mint change):** the selected policy + shared ripple set + junk gate, sized from the replay.
**NOT building:** duplicate-repost collapse; any payload version bump; a :95 relaxation; Threads-side changes; a refuse-on-mismatch rule (starvation — measured dead end).

## Testing Strategy

**Precondition change (harness):**
- Sink: atomic whole-file write; synchronous ordinal increment; metadata completeness (full URL); BOTH arms captured; a lost capture never fails the walk.
- Replay: entry-guarded import stays side-effect free; missing argv → usage + exit 1; unreadable file → FAILED + exit 1.
- No-op default proof: all 26 existing `fetchLinkedInPosts` test call sites (`tests/linkedin-fetch.test.ts:290-993`) and the stamp test (:989-1005) pass unchanged.
- Offline replay of synthetic captures generated from parser fixtures (`tests/linkedin-parser.test.ts:43-145`) — legal because the parser is pure (:33-36).

**Mint change (sized by the chosen policy):**
- The research's parser inventory holds: 4 zip-era tests die (:212-222, :231-243, :245-260), 2 half-die (:262-286), the oracle test rewrites (:298-308).
- B's new pins: an ids-only body mints ZERO with a skipped-with-cause oracle line; a texts-only row skips (no clock, no key); the payload round-trip carries zero dead rows.
- The exact-string digest unlinked case (no link line, no trailing whitespace), the mixed-numbering case, the heartbeat 2-line candidate case, and `!includes("undefined")` guards.
- If C or A is promoted: a paired case whose pairing follows the evidence, never crossed — verified against the replay, not the fixture (the fixture trap).

**Manual verification:**
- [ ] One live walk recorded; captures/ holds one file per body.
- [ ] The replay table names, per row: the mint decision and the cause (CTA contamination vs $-ref shrink).
- [ ] The six-point probe protocol results recorded per body (forward BFS, reverse refs FROM id rows, per-root-row classification, contentTrackingId grouping, adjacency invariants, marker taxonomy).
- [ ] One PC tick runs clean after captures exist (`guardCheckout` passes with the gitignored directory).

## Open Questions
**EVIDENCE-GATED — the replay decides (these ARE the mint design):**
- The mint predicate's id rule: text is REQUIRED (constraint above); which id a text-bearing row consumes is evidence-gated. The replay classifies text-bearing rows by id count (the six-point probe) and the mint design picks the rule from that.
- Is the row-harvested text trustworthy? The replay names Cause A contamination vs Cause B shrink per junk row — the junk gate predicate freezes only after this.
- Does a card-scoped id↔text join exist on a live capture? (six-point probe) — promotes A.
- Are exactly-1:1 rows common? — promotes C's size gate.
- Texts-only rows (no usable id, no clock) cannot mint; the oracle must count them as skipped-with-cause.

**Resolved during research:**
- Does capture run hosted? No — `src/index.ts:58` imports only a type, and watch.yml records the leg as PC-only.
- Does the replay need fetchTick's subsystems? No — every subsystem (cookies, working-hours gate, halt latch, guardCheckout, browser, payload push, alarms) is reachable only through fetchTick (`scripts/fetch-linkedin.ts:315`).
- Can a shared JSONL capture stream work? No — concurrency 2, out-of-order complete bodies, raw multi-hundred-KB Flight streams. One file per body with a synchronous ordinal.

**Requires user input:**
- None material. The remaining decisions (sink failure surfacing, capture naming details) are design-stage decisions gated on the precondition change.

**Blockers:**
- None. The mint-policy selection is INTENTIONALLY blocked on the replay evidence — that gate is the plan, not an obstacle.

## References
- `.rpiv/artifacts/research/2026-11-13_09-34-22_linkedin-post-link-pairing.md` — the chained research (evidence base for every claim above)
- `.rpiv/artifacts/discover/2026-11-13_08-49-04_linkedin-post-pairing.md` — the FRD (decisions, incident evidence, follow-ups)
- `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md` — the BFS zero-id-rows measurement, the row-local census (:170), CTA contamination (:80-82), the chip row (:86)
- `.rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md` — the VERIFIED mis-pair repro; the plan-fence revert lesson
- `src/linkedin-parser.ts:216-322` — the incumbent zip
- `src/linkedin-fetch.ts:481-528` — the capture bolt-in sites
- `src/linkedin-payload.ts:83-105`, :178-181 — admission gates + version gate (the mint change's surface)

---

## Follow-up Analysis 2026-11-13T10:55:07+0700

**Trigger:** developer review of the first run. Four findings, all accepted.

1. **Circular recommendation.** The first run scored the capture + replay harness as "Option 2" and returned it as the verdict with `confidence: high` — but it was already the developer's recorded decision in the research doc. The harness is now a precondition paragraph under Scope Boundaries; it was never a candidate. Frontmatter confidence drops to medium and the Summary says what the analysis actually added.
2. **Category error in the grid.** The first grid scored a sequencing decision against two wire-changing mint policies ("Wire contract change: No", "Complexity: Low-Med") — a designer would misread it as "the harness is cheaper than the fix." The grid is re-run over three mint policies only, framed as a pairing-strength ladder (B ⊂ C ⊂ A) where upgrades never discard lower-rung work.
3. **Stranded finding.** The text gate at `src/linkedin-payload.ts:95-96` — `isValidRow` requires non-empty text, missed by the research's `.permalink`-only sweep — was buried in Option 1's Cons list. It is now in Current State.
4. **Orchestration note for future runs.** The first poll waited sequentially on all three agents under one 600 s script timeout; the agents ran 327 s / 565 s / 797 s, so the timeout was guaranteed. Future multi-agent dispatches poll per-agent from the start.

**Evidence provenance:** B and C cells inherit from the first run's per-candidate agents (41fd1c9a — unlinked-by-default; b34af545 — row-local 1:1). A's cells are orchestrator-scored from committed evidence (`src/linkedin-parser.ts:26-36`; design:170) plus the shared ripple cells — no fresh dispatch, because A's premise (a stream join exists) is already answered by committed evidence and the replay re-verifies it. Where the first run's scoring conflicts with later sections, the later sections supersede.

**Superseded first-run record:** candidates were (1) unlinked-by-default, (2) proven-join-first harness, (3) row-local 1:1 hybrid; verdict pass, confidence high, recommendation "proven-join-first" (the harness).

---

## Follow-up Analysis 2026-11-13T10:59:50+0700 — premise correction (review round 2)

**Trigger:** second developer review. Four corrections, all applied.

1. **Option B premise corrected:** "mint every usable id" → "mint only rows with a harvested text." The census (design:170: 3 both / 130 ids-only / 3 texts-only of 136) makes the old premise self-defeating: ~133 mints, 130 textless, all dropped at `isValidRow:95` — payload bloat of 130 dead rows every tick, a permanent false "malformed row(s)" warn masking real malformation, and delivered yield unchanged from the incumbent's `min(ids, texts)` limit (:301). Minting shells buys nothing.
2. **The text-gate finding re-framed as a constraint.** The gate at :95-96 is a correct backstop; `:95` must NOT be relaxed. The first follow-up's Exit 2 ("attach text to every unlinked mint — non-empty by construction") was impossible for the majority: empty harvests never enter `rowTexts` (:259), so ids-only rows have no text to attach — "non-empty by construction" described the attached text, not mint coverage. The third exit — do not mint textless rows — is what the incumbent already did, and it is now a hard constraint in Problem Statement and Current State, obeyed by every policy.
3. **Two cells corrected.** Option B's integration-risk cell re-scored against the premise change — agent 41fd1c9a's blocker was real under the every-id premise and stays credited; the premise change resolves it (textless rows never mint, so the gate never fires and the payload carries zero dead rows). Comparison row B changed from "Solved by its own definition" to "Correctly filtered; textless rows must not mint," and the row itself renamed to posture, with A and C reading "backstop only."
4. **Effort line amended.** The 2–3 day estimate assumes a live LinkedIn cookie; a dead session adds a headed `npm run login-linkedin` hold, which is operator-gated, not engineer-gated.

**Consistency sweep:** the constraint propagates to Problem Statement (new hard constraint), the shared ripple set, Option B's how-it-works and verification-cost cells (new zero-mint and skip-cause pins), the Comparison table, the Recommendation rationale, Scope Boundaries (NOT building: a :95 relaxation), and the Open Questions (the id rule replaces the dead text-attachment question).

---

## Follow-up Analysis 2026-11-13T11:08:05+0700 - citation verification (review round 3)

**Trigger:** developer directive. Every file:line in this artifact was agent-inherited; the five load-bearing citations were verified against source with grep -n before anything designs from this artifact.

**Verdict on the five:** facts all hold; 3 of 5 line numbers were wrong and are corrected. Text check is :95-96 (not :94-95 - line 94 is ACTIVITY_URN_RE.test(row.id)); permalink admission :99-100 exact; paired=min at :301 (not :300); src/index.ts:58 exact; guardCheckout spans :246-262 (not :246-283), untracked-throw at :254-261.

**Corrections applied (11):** :94-95 to :95-96 (all refs); (:300) and , :300) to (:301); 246-283 to 246-262; (:143-152) to (:200-209) - the drop+count block per grep; (:38-41) to (:30) - PAYLOAD_VERSION; oracle (:311-319) to (:316-320); warn (:301-305) to (:302-306); zip loop (:306-310) to (:307-311); sort (:295-300) to (:296-300); zip tail (:281-310) to (:284-311).

**Also verified exact this pass:** linkedin-payload.ts :83-85 stampsAreValid, :178-181 version gate; linkedin-parser.ts :185 mintPost def with unconditional permalink at :200, :216-322 collectLinkedInPosts span, :223-224 rowIds/rowTexts, :259 rowTexts.push guard, :284 usable filter; src/index.ts:58; heartbeat.ts:160; email.ts:137; types.ts:21 and :28.

**Process note:** the first patch script had a broken lookup key that produced :undefined/NaN substitutions in 8 ranges; the damage check caught all of them and every value was re-derived from grep -n evidence before repair. Post-repair grep is CLEAN. A silent fallback timestamp had shipped in round 1 (hardcoded 11:30:00 vs real 10:55:07); the timestamp path now fails loudly instead.

**Still agent-inherited, unverified:** linkedin-fetch.ts :481-528, :490-503, :506-528, :678-687, :686; scripts/fetch-linkedin.ts :85-131, :315, :413-421; package.json :13-14; design-artifact page cites (design:80-86, :170); the chained research doc.
---

## Follow-up Analysis 2026-11-13T11:13:50+0700 - harness-citation sweep (review round 4)

**Scope:** the remaining agent-inherited cites named in round 3 - the .gitignore wedge, the biome dual lists, the linkedin-fetch.ts and scripts/fetch-linkedin.ts spans, and the design-doc page cites.

**Verified exact:** .gitignore has NO captures/ entry (the wedge claim stands: the first successful capture would trip guardCheckout, untracked-throw at :254-261, and wedge the PC loop); package.json lint at :13 and format at :14, format omits scripts/hooks (the asymmetry claim stands); entry guard :413 with the FAILED line at :422 (wrapper span corrected to :413-422); fetchTick :315; FetchTickDeps interface :85; walkLinkedInSurface def :461 and its call :722; fetchLinkedInPosts :678; minClicks = 0 :686; the walk arm page.on at :481 (the :349 listener seam is a different site); LINKEDIN_XHR_DRAIN_MS :107; LINKEDIN_FETCH_CONCURRENCY :63 (corrected from :37-38); design doc: CTA contamination :80-82, chip row :86, row-local census :170 - all exact.

**Reverted:** the first patch script of this pass used first-occurrence grep matching and corrupted four CORRECT citations with plausible-looking wrong numbers (:686 became :466, the :481 family became :349 family, :85-131 became :157-203, design:170 became design:13). Caught by re-reading the grep evidence against the sed plan; all four reverted the same pass. Same failure class as round 3, but worse: the wrong values looked real, so the undefined/NaN guard could not catch them. Rule recorded: a cite is patched only when the matched line CONTENT matches the claim, never on line number alone.

**Post-revert state:** grep CLEAN for every corruption string. Every load-bearing cite in Current State, Integration Points, and Scope Boundaries is now grep-verified at its anchor line. Span ends inside linkedin-fetch.ts (503/528) and FetchTickDeps (131) remain agent-claimed; their anchors are verified. Remaining unverified: test-fixture cites (low stakes, design-time references) and the research/design doc narrative claims.