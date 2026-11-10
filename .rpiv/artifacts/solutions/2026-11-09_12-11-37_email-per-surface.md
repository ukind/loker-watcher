---
date: 2026-11-09T12:11:37+0700
author: Yogiswara Utama
commit: dc75365
branch: ukind/feature-email-per-surface
repository: feature-email-per-surface
topic: "Email digest per surface"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, email, notify, attribution, linkedin-payload, dedupe, surfaces]
last_updated: 2026-11-09T12:11:37+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Email digest per surface

**Date**: 2026-11-09T12:11:37+0700
**Author**: Yogiswara Utama
**Commit**: dc75365
**Branch**: ukind/feature-email-per-surface
**Repository**: feature-email-per-surface

## Research Question
Split the single combined job-match digest into one plain-text email per `watcher.config.json` surface that produced matches. The subject names the exact surface (`3 new job posts — linkedin: "hiring react"`). Zero-match surfaces send nothing. The run-level heartbeat stays one combined email. Chained from the discover FRD, which locks 8 product decisions.

## Summary
**Problem**: No surface attribution exists anywhere in the pipeline. Both walkers destroy per-surface grouping at a terminal flatten, dedupe drops duplicates first-wins, and one `sendDigest` call sends one combined email.
**Recommended**: Stamp-on-Post surfaces array — the only candidate whose bill is limited to the unavoidable one. Attribution rides the row itself through the PC-to-hosted payload round-trip, and every run-scoped invariant inherits untouched.
**Effort**: Medium (~3-4 days including the ~25-pin test rewrite)
**Confidence**: High

## Problem Statement

**Requirements:**
- FR1 — the attribution contract lands for both platforms at once (Threads is off today; the contract still lands)
- FR2 — a post collected by N surfaces rides every matching surface's email
- FR5 — a post appears exactly once across the union of emails
- FR6 — disabled platforms contribute no surfaces and no emails
- FR7 — all-or-nothing: any failed send exits the run before persist; the next run re-sends everything
- FR8 — one `timing: notify` pair per run, plus one log line per surface email
- FR9 — the linkedinLeg and degraded-accounts riders ride every surface email when present
- Zero-match runs keep exactly one combined heartbeat; per-surface subjects drop the `(#hiring indonesia)` pin

**Constraints:**
- Hard: strict payload version bump 1→2 (guard shape unchanged; developer ruling: PC leg git-pulls, overlap ≤ one tick)
- Hard: locked FRD decisions; offline node:test suite; no new runtime dependency; no new secrets or env vars
- Soft: config-order send order; duplicate configured surfaces collapse to one email plus a load-time warn

**Success criteria:**
- The union of surface emails equals the judged match set (no silent losses)
- A zero-match run still sends exactly one heartbeat
- A v1 payload envelope degrades to one logged threads-only tick
- CI gates unchanged: typecheck, lint, test

## Current State

**Existing implementation:**
- `Post` (`src/types.ts:10-23`): six required fields, no optional fields, no surface identity. `platform` drives digest marking only (`:14`).
- Surface identity: the `{type, value}` union (`src/config-file.ts:16-20`). `ResolvedSurface` carries platform/label/url only (`:22-29`); `resolveSurfaces` is a 1:1 map (`:284-300`). `readSurfaces` has no duplicate detection (`:149-193`).
- Production config carries the duplicate `linkedin: "hiring react"` twice (`watcher.config.json:86`, `:138`), 19 distinct overlapping linkedin queries, and `platforms.threads: false`.
- Walkers keep per-surface side arrays, then destroy them: `src/linkedin-fetch.ts:464` / slot write `:494` (surface in scope) / flatten `:525`; `src/fetch-threads.ts:305` / `:318` / `:326`. The logged-out path mints posts in `fetchLoggedOutPosts` (`src/index.ts:530-541`); the authenticated XHR path bypasses `extractPosts` (`src/fetch-threads.ts:369`, `:441`).
- Payload: `PAYLOAD_VERSION = 1` (`src/linkedin-payload.ts:28`); `isValidRow` runs six checks and pushes the original row through (`:62-78`, `:174-184`), so extra fields pass silently today; strict version guard `:151-155` degrades to one warn + `leg: "malformed"` threads-only tick; payload max age 30 min (`:31`). PC leg: partition `scripts/fetch-linkedin.ts:239` → walk `:256` → write `:275`.
- Funnel: dedupe first-wins drop `src/index.ts:556-557`; the notify seam is one `sendDigest` call inside `timeStage` (`src/index.ts:497-500`) with `persistJudged` after it (`:501`, stamps every judged id at `:521`); Gates 1 and 2 return before the seam (`:381-391`, `:473-491`); `timeStage` doctrine `:147-158`.
- Email: `buildSubject` `src/email.ts:55-71` (platform Set join `:63-68`, pin at the return); `sendText` `:119-152` (wrapped fail-visible throw `:144-147`); `sendDigest` `:157-190` (empty gate `:164-168`, per-call log `:182`).
- Heartbeat: one `sendText` (`src/heartbeat.ts:184-189`), own subject `:111-113`; `HeartbeatStats` `:30-52`.
- Judge wraps by reference: `judged.push({ post, verdict })` (`src/judge.ts:1054`) — attribution enriched anywhere before notify reaches the seam free.

**Relevant patterns:**
- Caller-owned side arrays before a terminal flatten: `src/pool.ts:10-17` doctrine; used in both walkers and the judge slots.
- Optional fields with conditional reads: `LegLine.detail?` (`src/linkedin-payload.ts:44-46`), `PayloadRead.detail?` (`:56-58`), `HeartbeatStats` riders (`src/heartbeat.ts:46-52`), the conditional spread (`src/email.ts:186`). `Post` itself has none yet.
- Email variants through one seam: digest, heartbeat, exhaustion, leg-dead all ride `sendText` (`src/email.ts:119-152`).

**Integration points:**
- `src/index.ts:497-500` — where the loop replaces the single call
- `src/index.ts:556-557` — where the drop becomes a merge
- `src/linkedin-fetch.ts:494` / `src/fetch-threads.ts:318` / `src/index.ts:530-541` — the three stamp sites
- `src/linkedin-payload.ts:28` + `:62-78` — version bump and row admission
- `src/config-file.ts:149-193` — duplicate-surface warn

## Solution Options

### Option 1: Stamp-on-Post surfaces array (selected)
**How it works:**
Add `surfaces?: SurfaceIdentity[]` to `Post`. Stamp inside both walkers where `surface` is lexically in scope, before the terminal flattens. Change the dedupe drop to a surface-set union merge (new array). Replace the single `sendDigest` call with a loop over a config-order `Map` keyed `type|value`.

**Pros:**
- Attribution rides the row through the PC-to-hosted payload round-trip by construction — the round-trip that kills the side-index candidate is a non-event here
- Every run-scoped invariant inherits untouched: FR7 via the existing `timeStage` closure order, FR8 via one stage pair, FR9 via unchanged call arguments, heartbeat isolation by gate construction
- The stamping idiom already exists (both walkers own side arrays); the optional-field idiom has 4+ incumbents on sibling contracts
- External precedent is strong: ECST, Fat Event, CloudEvents context attributes, Debezium envelope, DynamoDB single-table Type stamps — no deprecation signals

**Cons:**
- The logged-out stamp site is the swing item: `SurfaceFetch`/`ResolvedSurface` carry no raw pair, so the design must zip the raw threads partition before the `:226` filter destroys alignment, or widen the shapes (~15-30 lines)
- The unattributed-match hazard becomes silent permanent loss if unsettled: a match with no active-config surface joins no group, yet `persistJudged` (`:521`) still marks it seen. Today no loss occurs — the single call sends the whole match array
- ~25 test pins rewrite (18 subject pins + 25 `subjects.length` assertions, census grep-settled); one payload deepEqual breaks (`tests/fetch-linkedin.test.ts:284-292`)

**Complexity:** Medium (~3-4 days)
- Files to modify: ~7 (~120 lines)
- Files to create: 0 (tests extend existing files)
- Risk level: Low-Medium

### Option 2: Side attribution index
**How it works:**
Keep `Post` untouched. Build a run-scoped `Map<postId, SurfaceIdentity[]>` inside both walkers, thread it beside the post array, and read it at the notify seam to group matches.

**Pros:**
- Fits the codebase's strongest idiom (`src/pool.ts:10-17` side-channel doctrine; three side arrays in one closure; judge slots)
- Cross-boundary precedent exists (`PayloadRead`, the run-scoped `stats` accumulator)
- All full-Post test literals stay byte-valid

**Cons:**
- The core premise breaks on the LinkedIn leg: the walker with surface scope runs in the PC process, and the hosted reader cannot recover grouping from a flat envelope. A sibling attribution block plus a new from-scratch validator is unavoidable — the candidate does not avoid payload-layer work, it relocates and enlarges it
- Skipping the envelope work forces collapse-to-all-surfaces, which invents memberships and breaks FR5
- Worse diagnosability: a matched post with no map entry carries no hint that attribution should exist
- Walker return-shape changes break ~6-8 assertions; the version-guard test matrix inverts (v1 becomes the rejected class)

**Complexity:** Medium-High (~4-5 days)
- Files to modify: ~8-9
- Risk level: Medium-High

### Option 3: Per-surface funnel runs
**How it works:**
Partition posts per surface after fetch and run dedupe/recency/seen/judge/notify once per surface. Structure carries attribution; no metadata field.

**Pros:**
- Conceptually clean isolation per surface; no contract change in the best case
- Every adoption site sits on an existing idiom (6 sites)

**Cons:**
- As stated it re-runs the funnel N times: each `judgePosts` call mints a fresh `RotationState` (`src/judge.ts:885-897`), re-hits 429-cooled accounts cold, re-spends the 180 s wait budget, and re-runs the availability check — against `watch.yml`'s 8-minute cap, with 20 overlapping linkedin surfaces multiplying LLM spend materially
- `saveState` merges against the caller's snapshot (`src/state.ts:257`): sequential per-surface persists drop earlier surfaces' ids — silent seen-state corruption
- N zero-match surface runs mean N heartbeats unless the run-level concerns are hoisted
- The agent's own viability fix (hoist the judge to once per post, fan out at notify) converges the candidate back onto Option 1's shape — while Option 1's full bill (attribution field, envelope v2, dedupe merge, notify loop) stays due. Strictly dominates Option 1

**Complexity:** High (~6-8 days; 68c1e2d-class blast radius: 27 files / ~1707 insertions precedent)
- Risk level: High

### Option 4: Single-origin tag
**How it works:**
One `origin?: {type, value}` on `Post`, stamped at the walks. Dedupe keeps its first-wins drop — the drop becomes the ownership rule. Each post lands in exactly one surface email.

**Pros:**
- Cheapest shape at dedupe (zero change) and at grouping
- The per-post-field → label → group pattern exists verbatim (`src/email.ts:63-65`); first-wins is existing doctrine
- FR5 holds stronger; FR7/FR8/FR9 mechanically unaffected

**Cons:**
- Fatal, not negotiable: direct hot-path conflict with locked FR2. A single origin carries exactly one membership while 19 of 20 linkedin surfaces are distinct overlapping queries — first-seen-wins strips membership by construction, zero-match-after-claim surfaces go silent, and ownership is decided by invisible config array order
- Aggravates the unattributed-match hazard: if the one origin leaves the config, the post has no email home with no merge fallback
- External precedent is mainstream first-touch attribution (HubSpot, Salesforce, Piwik PRO) — and the industry's momentum runs toward multi-touch, which is the direction FR2 already chose

**Complexity:** Medium (~3 days) — but non-shippable as specified
- Risk level: High (product-decision conflict)

## Comparison

| Criteria | 1 Stamp-on-Post | 2 Side index | 3 Per-surface funnel | 4 Single-origin |
|----------|-----------------|--------------|----------------------|-----------------|
| Complexity | M | M-H | H | M (but blocked) |
| Codebase fit | H | H | M (only via hoists that revert it to 1) | M |
| Risk | L-M | M-H | H | H |
| Novelty | L (strong precedent) | L (canonical) | L (orchestrator-assessed) | L (mainstream; momentum opposes) |

## Recommendation

**Selected:** Option 1 — Stamp-on-Post surfaces array

**Rationale:**
- Only candidate with no blocking dimension. It pays the unavoidable bill (subject pins, version bump, stamp sites, duplicate warn) and nothing else
- In-band attribution survives the PC-to-hosted payload round-trip by construction — the decisive seam the side-index candidate fails
- By-reference flow (`src/judge.ts:1054`) carries enrichment to the seam with zero plumbing
- External evidence agrees: self-describing rows are the established, actively-maintained pattern; the one industry momentum signal found (multi-touch over first-touch) argues for FR2's multi-membership over Option 4

**Why not alternatives:**
- Option 2: clears the filter but strictly worsens the decisive seam — envelope extension is unavoidable, the validator is written from scratch, and diagnosability of missing entries drops
- Option 3: fails integration-risk (run-scoped invariants break per surface: judge cost ×N, lost seen-state updates, N heartbeats) and migration-cost (strictly dominates Option 1; its viable variant is Option 1)
- Option 4: fails on locked FR2 — a discover-level re-decision would be required before it could ship

**Trade-offs:**
- Accepting the logged-out stamp swing item (~15-30 lines) for a contract that never leaks identity into fetcher signatures
- Accepting the ~25-pin rewrite up front (the 3b005cb lesson: subject pins get deferred and bite later)
- Accepting one payload-version tick of overlap per the strict-bump ruling

**Implementation approach:**
1. Contract + payload — `surfaces?: SurfaceIdentity[]` on `Post` (`src/types.ts:10-23`); `PAYLOAD_VERSION` 2 (`src/linkedin-payload.ts:28`); `isValidRow` admission (absent = valid; present = array of `{type ∈ tag|url|linkedin, value: non-empty}`; invalid → drop + count, `:62-78`, warn shape `:182`); duplicate-surface warn in `readSurfaces` (`src/config-file.ts:149-193`)
2. Stamping — LinkedIn worker before the slot write (`src/linkedin-fetch.ts:490-494`); Threads authenticated worker (`src/fetch-threads.ts:318`); logged-out path: zip the raw threads partition against `resolveSurfaces` output before the `:226` filter, or widen `SurfaceFetch`/`ResolvedSurface` (design decision)
3. Dedupe merge — `src/index.ts:556-557` drop becomes a surface-set union into a fresh array (never mutate an input's array)
4. Notify loop — config-order `Map` keyed `type|value`, seeded from the flag-gated partitions (`src/index.ts:257-263`), loop inside the existing `timeStage` closure (`:496-498`); per-surface subject (pin dropped; `buildSubject` `:55-71`); riders pass through unchanged
5. Tests — rewrite the 18 subject pins + re-derive the 25 `subjects.length` assertions; add FR2/FR5/FR7/FR8/FR9 clusters, the FR7 mid-loop rejection test (no precedent exists), the unattributed policy test, the v1-degrade line test, and the lost-update regression pin

**Integration points:**
- `src/types.ts:10-23` — add the optional field (keeps all ~30 full-Post test literals valid under `exactOptionalPropertyTypes`)
- `src/index.ts:497-500` — loop replaces the single call; `:501` persist ordering untouched
- `src/index.ts:556-557` — merge replaces the drop
- `src/linkedin-payload.ts:28`, `:62-78` — version + admission
- `src/config-file.ts:149-193` — duplicate warn

**Patterns to follow:**
- Optional field + conditional read: `src/email.ts:186` conditional spread; `PayloadRead.detail?`
- Caller-side stamping before the flatten: `src/pool.ts:10-17` doctrine, both walkers
- Email variant recipe: pure `buildX` → thin `sendX` → caller owns failure policy (`.rpiv/guidance/src/architecture.md`)
- Drop + count, never silent: `src/linkedin-payload.ts:7-19` module doctrine

**Risks:**
- Unattributed-match silent loss: mitigation is a design-level policy decision (Open Question 1) — drop + count with a loud run-log line is the default assumption
- Mid-loop SMTP failure now blocks later surfaces' emails for one run: accepted — it IS FR7; the missing rejection test gets written, not the behavior changed
- Strict version bump overlap: accepted, ≤ one tick, one logged line

## Scope Boundaries
- Building: per-surface digest emails, in-band attribution, payload v2, dedupe merge, config-order grouping, duplicate warn
- Not building: multi-recipient routing (one inbox stays), per-surface keywords, per-surface scan counts in the heartbeat, a lenient payload version guard, per-surface funnels

## Testing Strategy

**Unit tests:**
- Stamp pins per walker: `surfaces` deep-equal per slot, faulted slot leaves no stamp (`tests/linkedin-fetch.test.ts:273-290` idiom)
- Dedupe merge: union order, new-array non-aliasing, first-seen position retained
- Grouping: config-order iteration, zero-match surface sends nothing, duplicate `surfaces[11]`/`[24]` collapse
- Payload v2: admission matrix; v1 envelope → `leg: "malformed"` one-tick degrade (`tests/linkedin-payload.test.ts:120-126` shape)
- Config: duplicate-surface warn (`tests/config-file.test.ts` style)

**Integration tests:**
- FR7: rejecting transport on send N with a later surface pending → `statePath` byte-identical, no partial persist, next run re-sends (new — no precedent test)
- FR2/FR5: one post, two surfaces → rides both emails, appears once per email
- FR8: exactly one `timing: notify` line + N `email: sent digest` lines
- FR9: riders on every surface email when present (`tests/index.test.ts:669-690` pattern)

**Manual verification:**
- [ ] Local run with a two-surface config produces two emails whose subjects name each surface
- [ ] Remove a surface from config while the payload is fresh: the unattributed policy fires its logged line, no silent loss
- [ ] Heartbeat run (zero matches) sends exactly one combined email

## Open Questions
**Resolved during research:**
- Email-count pin census — 25 `subjects.length` assertions in `tests/index.test.ts` (grep-settled: lines 362, 386, 417, 438, 465, 544, 597, 627, 661, 690, 714, 768, 794, 820, 847, 917, 956, 1019, 1060, 1119, 1172, 1175, 1208, 1230, 1244); the agents' 22/26/~21 counts were partial slices
- `Post` has no optional fields today — the optional-field idiom lives on sibling contracts; Option 1's `surfaces?` is the first on `Post`

**Requires user input:**
- Unattributed-match policy (research Open Question 1): drop + count with a loud run-log line, a fallback "unattributed" email, or a payload-read-time filter. Default assumption for planning: drop + count with the loud line
- URL-surface subject truncation (research Open Question 2): default assumption: strip `https://www.threads.com`, keep path + full query (~70 chars; keeps surfaces[8]/[9] distinguishable)

**Blockers:**
- None blocking implementation start; the two questions above gate only the subject template and the grouping fallback, both late-phase

## References
- `.rpiv/artifacts/research/2026-11-09_11-24-30_email-per-surface.md` — the input research doc (all anchors re-verified live this session)
- `.rpiv/artifacts/discover/2026-11-09_10-57-55_email-per-surface.md` — the FRD (8 locked decisions)
- `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md` — attribution-shape permanence warning
- `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` — payload envelope D5/D9/D13
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — F021 duplicate-digest acceptance; notify-before-persist
- Fit agent reports (session store): `fit-stamp-on-post-raw`, `fit-side-index-raw`, `fit-per-surface-funnel-raw`, `fit-single-origin-raw`, `novelty-*-raw`
