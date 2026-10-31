---
date: 2026-10-31T10:32:31+0700
author: Yogiswara Utama
commit: b92fa9f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn second surface + configurable scroll"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, config-file, fetch-threads, fetch-linkedin, index, linkedin, scroll-rounds, platform]
last_updated: 2026-10-31T10:32:31+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: LinkedIn second surface + configurable scroll

**Date**: 2026-10-31T10:32:31+0700
**Author**: Yogiswara Utama
**Commit**: b92fa9f
**Branch**: feature/add-support-for-linkeind
**Repository**: feature-add-support-for-linkeind

## Research Question
Chain from `.rpiv/artifacts/discover/2026-10-31_07-45-40_linkedin-second-surface.md`: how does a `linkedin` keywords surface enter the config, ride the acquisition seam, get extracted, judged, and emailed beside Threads — and how does a validated `scrollRounds` key thread into the scroll loop — without breaking the byte-identical Threads-only acceptance?

## Summary
**Problem**: Dispatch a second platform through the pipeline whose acquisition seam erases the surface type (`ResolvedSurface` carries only label/url), while keeping Threads-only behavior byte-identical when the new pieces are absent.
**Recommended**: Carried platform discriminant — stamp `platform: "threads" | "linkedin"` onto `ResolvedSurface` in `resolveSurfaces`, dispatch the shared-pool worker on the field, and put the LinkedIn walk in a sibling `fetch-linkedin.ts`.
**Effort**: Med (~2-3 days; wiring ~100-140 lines, walk+parser 150-250, tests 200-350, across 8-10 files; expect one live-validation retune commit per the 93a3f38 precedent)
**Confidence**: High

## Problem Statement

**Requirements:**
- FR#1/FR#4: a `linkedin` config arm (keywords string) and a validated `scrollRounds` key (integer >= 1, default 8).
- FR#2/FR#3: build the LinkedIn search URL byte-exactly (`encodeURIComponent`, `origin=FACETED_SEARCH`, `sortBy=["date_posted"]`, `datePosted=["past-24h"]`).
- FR#8: ride the acquisition seam and the shared `runPool`; "no new serial stage".
- Acceptance: with no linkedin surface and no `scrollRounds` key, behavior and tests stay byte-identical; a LinkedIn failure must never discard Threads results; config errors fail visibly.

**Constraints:**
- Hard: strict TS flags stay on; state writes atomic; secrets only in GitHub Actions secrets; offline deterministic tests; no new runtime dependency without stated need.
- Hard (capture-settled): LinkedIn content search is logged-in-only; session expiry is routine; ids are `urn:li:activity:<19-digit>`; timestamps derive from `BigInt(id) >> 22n`; scrolling needs `page.mouse.wheel` in a nested frame.
- Soft: only probe-measured values are env-tunable; hard-code the rest with measured-date comments.

**Success criteria:**
- Mixed run: Threads and LinkedIn posts both judged and emailed; LinkedIn failure leaves Threads results intact.
- Absent-feature run: existing 26-case fetch/index suites pass without edits (the free absence proof).
- Dead LinkedIn session: warn + zero posts; Threads results still flow; the zero-post LinkedIn line is visible in run output.

## Current State

**Existing implementation:**
- `Surface` (`src/config-file.ts:14`) is a 2-arm discriminated union; the literal-guard chain at `:137-141` narrows for the push at `:160`; `resolveSurfaces` (`:190-197`) maps to `{label, url}` — the one-way type erasure.
- Acquisition (`src/index.ts:150-165`): ONE session (`:151`), one fused boolean (`:153-155`) picking `fetchSurfacesAuthenticated` vs `fetchLoggedOutPosts`, one `cleanupSessionDir` in `finally`.
- `fetchSurfacesAuthenticated` (`src/fetch-threads.ts:275-320`): one cookie-bearing context (`:280`), mixed surfaces through `runPool` (`:287`, width 4), per-surface failures in caller-owned side arrays; all-fail predicate `results.length === 0` (`:304`) counts posts, so it is already implicitly cross-platform.
- `isTagSurface` (`src/fetch-threads.ts:180-182`) sniffs the `tag/` label prefix; its doc comment concedes the prefix is the only discriminator available — the erasure is already an acknowledged workaround.
- XHR collector (`:332-350`) filters `/graphql/i` and `JSON.parse`s bodies — a LinkedIn RSC stream never passes it (filter misses; parse throws into the swallow-catch).

**Relevant patterns:**
- Optional-key validator with default: `src/config-file.ts:172-188` (commit d8fc15b) — scrollRounds clones it, with `Number.isInteger` + `>= 1` instead of flooring.
- Trailing-optional parameter idiom: `src/fetch-threads.ts:278` (`contextFactory`), judge `fetchFn`.
- Side-array failure discipline: `src/fetch-threads.ts:283-284` (`failures`/`emptyLabels`).
- Measured-date tuning comment: `src/fetch-threads.ts:51-55`.
- Byte-exact URL pin style: `tests/config-file.test.ts:152-155`.

**Integration points:**
- `src/config-file.ts:137-141` — whitelist + error message move together with the union arm.
- `src/config-file.ts:190-197` — stamps + third URL arm (`encodeURIComponent`).
- `src/index.ts:150-165` — the fused session boolean; the one block every candidate must restructure.
- `src/fetch-threads.ts:275-287` — 4th trailing-optional session param + worker dispatch.
- `.github/workflows/watch.yml` — `LINKEDIN_SESSION_STATE` secret mapping beside `THREADS_SESSION_STATE`.

## Solution Options

### Option 1: Carried platform discriminant (RECOMMENDED)
**How it works:**
Add `platform: "threads" | "linkedin"` to `ResolvedSurface`; `resolveSurfaces` stamps it per arm. Split surfaces by platform before the session branch; resolve up to two sessions; pass the LinkedIn session path as a 4th trailing-optional param to `fetchSurfacesAuthenticated`, which builds a second context and dispatches the shared-pool worker on `surface.platform`. The LinkedIn walk lives in a sibling `src/fetch-linkedin.ts` (flagship-web interception, RSC parse, urn minting, wheel scroll).

**Pros:**
- The discriminant already exists on `Surface` (`src/config-file.ts:14`) — the candidate stops discarding it rather than inventing a pattern. Adoption: exactly 3 literal sites (2 in `resolveSurfaces`, 1 test helper) + 1 new read; all 17 label reads and 2 url reads compile untouched.
- One dispatch point selects both the walk AND the context — type-safe at the worker, and pairs with `Post.platform` (FR#5-7) for one vocabulary end to end.
- Failure isolation is inherited free: a LinkedIn throw lands in the `failures` side array (`:298`) while Threads posts survive; the post-counted all-fail predicate already tolerates a dead platform.
- Verification: exactly 3 declared test edit sites; the untouched 26-case fetch/index suite is itself the byte-identical-absence regression gate.

**Cons:**
- The fused session boolean (`src/index.ts:151-155`) must be defused: with only `THREADS_SESSION_STATE` absent, linkedin surfaces would silently enter the logged-out path and burn 3×30s timeouts each while `LINKEDIN_SESSION_STATE` is ignored. Restructuring that block (and doubling the F019 cleanup pairing) is the one edit reshaping existing control flow.
- `PageLike` (`src/fetch-threads.ts:89-103`) grows optional mouse/frame members — interface growth is the real test-double cost, not `ContextFactory` (20 zero-arg doubles stay assignable under TS fewer-params rules even for a required param).

**Complexity:** Med (~2-3 days)
- Files to create: 2 (`src/fetch-linkedin.ts` ~150-250 lines, `tests/fetch-linkedin.test.ts` ~150-250)
- Files to modify: 6-8 (config-file, fetch-threads, index, threads-session, config, watch.yml, + 3 test files with tiny edits)
- Risk level: Med (one HIGH seam, self-resolving — the candidate's own first step defuses the boolean)

### Option 2: Label-prefix sniff
**How it works:**
No type changes. `resolveSurfaces` labels LinkedIn entries `linkedin/<keywords>` (mirroring `tag/<value>`); a new `isLinkedinSurface` beside `isTagSurface` (`src/fetch-threads.ts:180-182`) routes the pool worker on the label prefix.

**Pros:**
- Cheapest headline diff: zero type changes; 17 passive label carriers (logs, side arrays, run header) inherit `linkedin/`-grepable output for free.
- Byte-identity is ~90% pre-purchased: all 11 fetcher pins + 6 runWatcher pins compile and pass untouched.

**Cons:**
- Dispatch selects the walk but not the context: the shared pool runs on ONE Threads-cookie context (`src/fetch-threads.ts:280`); an unguarded pre-pool LinkedIn-context failure can discard Threads results — a structural violation of the acceptance bar until patched.
- The label contract is two unlinked literals (`config-file.ts:194` vs `fetch-threads.ts:181`): a `linkeind/`-style typo (the branch name itself is the live example) has no fail-visible gate and degrades silently to the wrong branch.
- Both fixes require adding exactly the typed guarantees Option 1 provides — you rebuild Option 1 out of string comparisons while losing its compile-time safety.

**Complexity:** Low-Med (~1.5-2.5 days)
- Files to create: same 2 walk files
- Files to modify: similar set minus the type stamps, plus label-gate patches the option does not include by default
- Risk level: Med-High (acceptance-bar violation lives in the option's core shape)

### Option 3: Parallel acquisition branch
**How it works:**
`index.ts` splits surfaces into threads/linkedin groups, resolves a second session/context, drains LinkedIn through its own `runPool` in a new `fetchSurfacesLinkedIn`, merges before `dedupePosts`, pairs per-platform cleanup, and relocates the all-fail decision to `index.ts` via per-platform catch-downgrade. `src/fetch-threads.ts` stays byte-untouched.

**Pros:**
- Perfect walker isolation: all 11 `fetchSurfacesAuthenticated` pins green untouched; revert is pure deletion.
- Merge half reuses proven structure (`dedupePosts` at `src/index.ts:299-311`; 5th `runPool` site is item-agnostic).

**Cons:**
- Two sessions/contexts/browsers/temp-dirs per run is unprecedented anywhere in src or tests (today: exactly one of each, mutually exclusive).
- Fails the observability requirement from the capture incident: a dead-LinkedIn-session run is indistinguishable from Threads-only in the heartbeat (`HeartbeatStats` has no platform dimension) — the logout signature survives only as an Actions warn log.
- Session cleanup on partial failure is offline-unverifiable: session resolution is not in `WatcherDeps` (`env` read directly at `src/index.ts:151`), so the pairing cannot be pinned without adding a new seam (more surface area).
- Soft NFR conflict: a separate (or sequential second) pool is not "joins the existing bounded pool ... no new serial stage" (FR#8 performance line); the 8-minute budget arithmetic (F023 comment) must be re-derived.
- A null LinkedIn session must skip the pool entirely or every surface burns 30s×3 auth-walled timeouts — a third branch the fused boolean never needed.

**Complexity:** Med-High (~3-4 days)
- Files to create: 2 walk files + session-test additions
- Files to modify: index.ts block rewrite (16 → ~50-70 lines), watch.yml, config/session
- Risk level: High (unobservable degradation + unverifiable cleanup pairing + budget re-arithmetic)

## Comparison

| Criteria | Option 1 Discriminant | Option 2 Label sniff | Option 3 Parallel branch |
|----------|----------|----------|----------|
| Complexity | M | L-M | M-H |
| Codebase fit | H (pattern already on Surface) | M (one-site workaround promoted to boundary) | M-L (merge fits; session doubling unprecedented) |
| Risk | M (one HIGH, self-resolving) | M-H (acceptance violation in core shape) | H |
| Verification cost | L-M (3 edit sites + ~6 pins) | L (~8-11 pins) | M-H (session pairing unpinnable offline) |
| Revert cost | M (2 files byte-restore) | M | L-M (mostly deletions, except heartbeat creep) |

## Recommendation

**Selected:** Option 1 — Carried platform discriminant

**Rationale:**
- The typed discriminant already exists on `Surface` (`src/config-file.ts:14`); Option 1 stops erasing it at `resolveSurfaces` (`:190-197`) instead of re-deriving platform from a string. Adoption: 3 construction sites + 1 new read; 19 existing property reads compile untouched.
- One dispatch point selects walk AND context, keeping the acceptance invariant (a LinkedIn failure never discards Threads results) structural rather than patched: worker throws land in the side arrays (`src/fetch-threads.ts:298`), and the post-counted all-fail predicate (`:304`) already tolerates a dead platform.
- Verification is the cheapest with the strongest proof: exactly 3 declared test edits (`tests/config-file.test.ts:141-143`, `:149`; `tests/fetch-threads.test.ts:22-25` helper) + ~6 new pins, while the untouched 26-case suite is the byte-identical-absence gate.
- `platform` pairs with `Post.platform` (FR#5-7) — one vocabulary from config to digest line.

**Why not alternatives:**
- Option 2: its two core failure modes (dispatch does not select context; typo labels degrade silently — `linkeind/` is the live branch-name example) both require re-adding Option 1's typed guarantees as string-comparison guards. The "zero type changes" advantage shrinks with every patch while the stringly contract spreads.
- Option 3: fails two kept dimensions — degradation is unobservable (heartbeat has no platform dimension, contradicting the capture-incident requirement that a dead LinkedIn session be legible) and partial-failure session cleanup is offline-unverifiable (no session seam in `WatcherDeps`). Plus a soft FR#8 conflict ("no new serial stage").

**Trade-offs:**
- Accepting one restructure of the fused session block (`src/index.ts:150-165`) — the only existing control flow reshaped — for type-safe dispatch everywhere downstream.
- Accepting optional `PageLike` growth (mouse/frame members) for a single `PageLike` type across both walks.

**Implementation approach:**
1. Config spine — union arm, whitelist + message (`src/config-file.ts:137-141`), stamps + third URL arm (`:190-197`), scrollRounds validator cloning `:172-188` with `Number.isInteger`/`>= 1`.
2. Session — `ENV_NAMES.linkedinSession` (`src/config.ts:14-21`), parametrized resolver in `src/threads-session.ts`, `watch.yml` secret line.
3. Acquisition — defuse `src/index.ts:150-165`: split surfaces by platform, resolve up to two sessions, pair both cleanups in `finally`, pass the LinkedIn path down.
4. Walker — new `src/fetch-linkedin.ts` (flagship-web response filter, RSC parse, urn minting, id-derived timestamps, constructed permalinks, wheel scroll), `PageLike` optional members, worker dispatch at `src/fetch-threads.ts:287`.
5. Tests in the same commit (b050436/9e1c8ef precedent), then a live validation run — budget one retune commit (93a3f38 precedent).

**Integration points:**
- `src/config-file.ts:137-141` — whitelist + error message gain "linkedin" in the same commit as the union arm.
- `src/config-file.ts:190-197` — `platform` stamps + third URL arm; pin the URL byte-exactly (style of `tests/config-file.test.ts:152-155`).
- `src/index.ts:150-165` — the defused session block; LinkedIn-session-absent skips the LinkedIn walk with a warn (never routes it logged-out).
- `src/fetch-threads.ts:275-287` — 4th trailing-optional param + worker dispatch; second context from the same factory call shape (`:280`).
- `src/fetch-threads.ts:89-103` — `PageLike` optional mouse/frame members (keeps both existing page doubles compiling).
- `.github/workflows/watch.yml` — `LINKEDIN_SESSION_STATE` beside `THREADS_SESSION_STATE`.

**Patterns to follow:**
- Optional-key validator: `src/config-file.ts:172-188` (undefined-to-default, fail-visible otherwise, `JSON.stringify(value)` in the message).
- Trailing-optional parameter: `src/fetch-threads.ts:278`.
- Side-array failure discipline: `src/fetch-threads.ts:283-284`.
- Measured-date tuning comment: `src/fetch-threads.ts:51-55` — extend to whatever the LinkedIn walk measures (wheel deltas, settle ms).
- Fail-visible error formula: module, file, key, fault, allowed values (`src/config-file.ts:139`).

**Risks:**
- Fused session boolean misroutes LinkedIn to logged-out when only Threads session is absent: mitigated by the explicit platform split and a LinkedIn-session-null skip pin in `tests/index.test.ts`.
- LinkedIn RSC field layout rotates without notice: pin the parser against the 11 saved bodies (`.rpiv/tmp/pw/body-*.txt`) and a fresh capture at implement time; keep extraction isolated in `fetch-linkedin.ts` so rotation is a one-file fix.
- Session revoked mid-run: treat as normal — warn + zero posts + emptyLabels diagnostic; operator refreshes the secret (the capture incident made this a routine event, not an exception).

## Scope Boundaries
- Building: linkedin config arm + URL builder, `platform` on `ResolvedSurface` (and `Post`), typed dispatch, sibling LinkedIn walk, `LINKEDIN_SESSION_STATE`, `scrollRounds` key, conditional digest/subject platform marking per the research doc's scheme.
- NOT doing: automated username/password login (challenge/restriction risk); a LinkedIn probe script (doctrine: hard-code until volume justifies measuring); heartbeat platform-dimension redesign; unconditional judge rewording (conditional wording keeps all 7 bulk-dispatch mock strings green); LinkedIn-specific cron (design-gate follow-up if volume demands).

## Testing Strategy

**Unit tests:**
- config-file: linkedin accepts; empty/non-string value rejects with path+key; unknown-type still rejects; URL byte-exact assertion (keywords + `origin=FACETED_SEARCH` + `sortBy` + `datePosted`) beside `:152-155`; scrollRounds `"five"`/`5.5`/`0` reject, default-8 accepts.
- fetch-threads: 3 edit sites (`surface()` helper + 2 deepEqual literals); mixed-surface pin where the linkedin label lands in `failUrls` while Threads posts persist (the acceptance pin, via `xhrBySubstring` `:116-118`); dispatch-routing pin; scrollRounds:5 oracle pin (continuously-gaining feed, assert 5 evaluate rounds).
- index: mixed config with `LINKEDIN_SESSION_STATE` absent → run completes, Threads posts judged, state written (needs the URL-dispatching page double, pattern at `tests/fetch-threads.test.ts:116-118`).
- fetch-linkedin (new): RSC parse, urn→timestamp (`BigInt(id) >> 22n`), permalink construction, dedupe-safe id form, wheel-scroll round accounting — against saved capture bodies.
- Lockstep guard: judge wording stays conditional, so all 7 bulk-dispatch mock strings across 3 suites stay green.

**Integration tests:**
- None new — CI remains the offline gate; the live GitHub Actions run is the real integration (watch.yml timeout budget re-checked in the retune commit).

**Manual verification:**
- [ ] Real-session run: LinkedIn matches appear in the digest beside Threads matches, platform-marked lines render correctly.
- [ ] Dead-session run: expired `LINKEDIN_SESSION_STATE` → warn + zero LinkedIn posts, Threads results still delivered, run exits 0.
- [ ] Quiet mixed run: heartbeat subject/body stays platform-neutral and legible.

## Open Questions
**Resolved during research:**
- Id form: `urn:li:activity:<19-digit>` kept raw — colons make Threads dedupe collisions structurally impossible (`dedupePosts`, `src/index.ts:299-308`); stripping digits would risk real collisions. Capture-settled.
- Timestamps: absent from bodies; `BigInt(id) >> 22n` = epoch ms, verified on two ids. Capture-settled.
- Facets: `sortBy`/`datePosted` are server-side arguments carried by the URL. Capture-settled.
- Scroll mechanics: nested frame defeats body scroll; `page.mouse.wheel` drives pagination. Capture-settled.
- Mechanism: Playwright + session-cookie storageState + response interception — same seam as Threads (`src/fetch-threads.ts:333-350`). Capture-settled.

**Requires user input:**
- Id prefix (raw urn recommended vs `linkedin:` prefix for state-file readability) — design gate.
- Judge wording (conditional recommended — all-Threads batches keep the verbatim lead-in, mixed batches neutral; zero test-dispatch edits) — design gate.
- LinkedIn cron cadence (current */10 vs a slower dedicated schedule; past-24h facet suggests 1/day may suffice) — design gate.
- Whether `scrollRounds` applies to both walks or Threads-only — design gate (default: whichever walk consumes it).

**Blockers:**
- None critical. RSC markup rotation is a schedule risk, not a blocker — re-capture at implement time.

## References
- `.rpiv/artifacts/research/2026-10-31_08-01-06_linkedin-second-surface-and-scroll-rounds.md` — evidence base: capture, seams, test-impact map
- `.rpiv/artifacts/discover/2026-10-31_07-45-40_linkedin-second-surface.md` — FRD: goals, FRs, decisions
- `.rpiv/guidance/src/architecture.md` — pipeline stages, DI seams, "Adding a New Surface Type"
- `.rpiv/guidance/.github/workflows/architecture.md` — secret mapping pattern
- `src/config-file.ts:14,137-141,172-188,190-197` — union, gates, validator precedent, erasure point
- `src/fetch-threads.ts:180-182,275-320,332-350` — stringly dispatch precedent, walker, XHR collector
- `src/index.ts:150-165` — the fused session boolean
- Commits: b050436 (surface type addition, 12 files), d8fc15b (optional key, 7 files), 9e1c8ef (session + walker, 12 files), 93a3f38 (live-run retune, +1729)
