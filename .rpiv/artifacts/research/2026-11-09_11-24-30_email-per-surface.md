---
date: 2026-11-09T11:24:30+0700
author: Yogiswara Utama
commit: dc75365
branch: ukind/feature-email-per-surface
repository: feature-email-per-surface
topic: "Email digest per surface"
tags: [research, email, notify, linkedin-payload, surfaces, heartbeat, dedupe]
status: ready
last_updated: 2026-11-09T12:02:55+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Added unattributed-match policy and URL-subject truncation as Open Questions; spot-checked judge + pool citations"
---

# Research: Email digest per surface

## Research Question
Split the single combined job-match digest into one plain-text email per `watcher.config.json` surface that produced matches. Subject names the exact surface (`3 new job posts — linkedin: "hiring react"`). Zero-match surfaces send nothing; the run-level heartbeat stays one combined email. Chained from the discover FRD (all 8 product decisions already locked there).

## Summary
Attribution does not exist anywhere in the pipeline today: `Post` (`src/types.ts:10-23`) carries six fields, and both walkers destroy their in-memory per-surface grouping at a terminal flatten (`src/linkedin-fetch.ts:525`, `src/fetch-threads.ts:326`). The fix has four parts: (1) an optional `surfaces` identity array on `Post`, stamped at the two walks where the surface is in scope; (2) the payload row contract learns the optional field behind a `PAYLOAD_VERSION` 1→2 bump with the existing strict guard kept (developer ruling: the PC leg updates via git pull, so overlap is one tick); (3) `dedupePosts` (`src/index.ts:552-562`) switches from first-wins drop to surface-set merge — otherwise multi-surface membership dies there; (4) the single `sendDigest` call (`src/index.ts:497-500`) becomes a loop over a config-order `Map` keyed `type|value`, with the subject naming the surface and the pin dropped. The heartbeat stays untouched by construction: Gates 1 and 2 (`src/index.ts:381-390`, `473-491`) return before the only digest call site. One acceptance criterion is NOT met until design settles Open Question 1: posts tagged only with surfaces that fell out of config still match, join no group, and drop out of the union of emails.

## Detailed Findings

### The Post contract and the attribution shape
- `Post` (`src/types.ts:10-23`) has exactly six fields: `id`, `platform` ("threads" | "linkedin"), `text`, `author`, `permalink`, `timestamp`. No surface identity. `platform` exists to drive digest marking (`src/types.ts:14` doc).
- The pipeline passes `Post` objects by reference: judging wraps the same object (`src/judge.ts:1050-1054`), matches map back to it (`src/index.ts:462-466`). One optional field on `Post` therefore reaches the notify seam with no extra plumbing.
- The canonical identity is the `{type, value}` pair, not the value alone: `Surface` is a discriminated union (`src/config-file.ts:16-20`) and the same `value` is legal under two types (a tag "hiring" and a linkedin "hiring" are distinct surfaces). `platform` cannot recover the type: threads posts can come from `tag` or `url`.
- Shape: `surfaces?: Array<{type, value}>` — store the pair, render per channel. Pre-rendered label strings would bake presentation into data; the log renders `linkedin/hiring react` (`src/index.ts` surfaceLabel) while the subject renders `linkedin: "hiring react"`.
- Under `exactOptionalPropertyTypes` the field is `surfaces?: SurfaceIdentity[]` and every read site must handle `undefined`. Optional (not required) keeps the ~18 full-Post test literals in `tests/email.test.ts` and the extract fixtures valid.

### LinkedIn collection: the walk and the flatten
- `fetchLinkedInPosts` (`src/linkedin-fetch.ts:452-526`) walks surfaces under `runPool` width 2. Results ride a caller-owned side array `perSurface: Array<Post[] | undefined>` keyed by the claim index (`src/linkedin-fetch.ts:464`; runPool returns void, `src/pool.ts:36`). Claim index == partition position (the synchronous cursor claim, `src/pool.ts:44`).
- Each worker pages `buildSearchUrl(surface.value, start, PAGE_SIZE)` (`:479`), feeds `collected.push(...parsed.posts)` (`:490`), then publishes `perSurface[index] = collected` (`:494`) only on a clean paging loop. A faulted surface's slot stays `undefined` (`:498-511`) — a slot is a complete per-surface post set or nothing.
- The terminal flatten `perSurface.filter(...).flat()` (`:525`) destroys the mapping. After it, a post walked by N surfaces exists as N independent, unstamped row objects (each `parseSearchResponse` call mints fresh objects; no dedupe in the walk).
- The mint site needs NO change: `parseSearchResponse(body)` (`src/linkedin-voyager.ts:161`) is the pure core ("No I/O lives here", module doc); the Post literal is minted in `mapUpdate` (`src/linkedin-voyager.ts:215`); passing a surface down would touch the probe caller (`scripts/probe-linkedin.ts:55`) and 4 test call sites for zero behavior change. Stamp inside the worker where `surface` is lexically in scope (`src/linkedin-fetch.ts:470`), at the feed point (`:490`) or just before the slot write (`:494`).
- Order is deterministic end to end: `readSurfaces` pushes in file order, `filter` preserves index order, claim index == partition position, filter+flat reassembles in slot order. Config order is the stable send order.
- The PC-leg caller partitions config itself, independent of the watcher's flag-gated partition: `scripts/fetch-linkedin.ts:239` filters `type === "linkedin"` with no `platforms` flag consult, then hands the flat array to `writePayloadAtomic` (`scripts/fetch-linkedin.ts:275`).

### Threads collection: surface-blind extraction, stamping at the walks
- `extractPosts(html)` (`src/extract.ts:36`) and `normalizeThreadItem` (`src/extract.ts:87`, Post literal `:105-112`, `platform: "threads"` at `:106`) know nothing of the surface. Its in-page dedupe (`src/extract.ts:50,59`) is per-surface and harmless.
- A parameter on `extractPosts` cannot reach the authenticated path at all: that path bypasses `extractPosts` and calls `collectThreadItems` + `normalizeThreadItem` directly inside the XHR handler (`src/fetch-threads.ts:369`, values returned at `:441`). Stamping at the two walk sites solves both legs; rewriting the extraction signature solves half.
- Logged-out path: `fetchLoggedOutPosts` (`src/index.ts`, iterates `SurfaceFetch{label, html}` from `fetchSurfaces`) stamps in its per-surface loop. Authenticated path: the worker holds `surface` before `perSurface[index] = posts` (`src/fetch-threads.ts:318`); the flatten at `:326` is the destruction point, mirroring LinkedIn.
- `ResolvedSurface` (`src/config-file.ts:22-29`) carries only `platform/label/url` — no raw `{type, value}`. Recovery: hoist the raw threads partition (`src/index.ts` partition at the linkedinSurfaces precedent) and zip before fetching — the success filter at `src/fetch-threads.ts:226` destroys positional alignment after the fact. `resolveSurfaces` is a 1:1 map (`src/config-file.ts:284-300`), so zip-by-index is exact. Label-derived recovery (`tag/` prefix is provably unambiguous — url values must be `https://www.threads.com/...`, `src/config-file.ts:183-185`) is the fallback.
- Threads is off today (`watcher.config.json` `platforms.threads: false`) but the contract must land for both platforms at once (FRD FR1).

### The payload envelope: version, validator, writer
- `PAYLOAD_VERSION = 1` (`src/linkedin-payload.ts:28`); writer stamps it (`:84-113`); reader guard is exact equality (`:151-155`) → one warn, `leg: "malformed"`, threads-only run. The staleness check (`:157-166`, 30-min window) and row loop (`:174-184`) run only after the version guard passes.
- `isValidRow` (`:62-78`) whitelists six checks and pushes the ORIGINAL row through (`:176`), so extra fields pass silently today. This is what makes an added optional field safe at the row level.
- Required validator update: `row.surfaces === undefined` → valid (legacy v1 rows); when present → array of `{type ∈ tag|url|linkedin, value: non-empty string}`, mirroring `readSurfaces` per-entry rules. An invalid `surfaces` drops + counts the row (`:178`, warn `:181-184`) — never accept a surface-less row silently (module doctrine "nothing is silent", `:7-19`; a surface-less accepted post could join no group and vanish from digests).
- Version bump ruling (developer): strict bump — guard shape unchanged. Rationale recorded verbatim: "the pc will do the git pull, so the old post will not appear." Both halves deploy from the same repo (PC leg = dedicated clone of main, `scripts/fetch-linkedin.ts:193`; hosted run checks out main), so a v1 envelope meets the v2 reader for at most one 10-minute tick and degrades with the existing one logged line.
- The writer's `[...posts]` shallow copy needs no deep clone: serialization is synchronous (`JSON.stringify` at `:98`). No shared Post object crosses surfaces (each surface's walk mints its own rows), so there is no aliasing hazard in the payload.
- Rows are pretty-printed into a git-committed file (`:98`, pushed by `pushPayload` at `scripts/fetch-linkedin.ts:193`); nested surface arrays add bytes to repo history (~144 small commits/day accepted, precedent a8752bf).

### The notify seam: grouping, loop, all-or-nothing
- The entire behavioral change surface is one call site: `sendDigest(matches, resolveEmailConfig(env), deps.transport, linkedinLeg, degradedLine)` inside `timeStage` at `src/index.ts:497-500`; `persistJudged` runs after (`src/index.ts:501`).
- Grouping: a `Map` keyed `"${type}|${value}"`, seeded with one empty group per active surface in config order (platform-flag-gated exactly like the existing partitions at `src/index.ts`: linkedin arm needs `platforms.linkedin`, threads arm `platforms.threads`). JS Map iterates in insertion order → config-order send order for free; identical duplicate surfaces collapse for free. Groups left empty are skipped before any send; `sendDigest`'s empty gate (`src/email.ts:164-168`) stays as a backstop, not the mechanism.
- `timeStage` wraps the WHOLE loop, not each send: FR8 says one line per surface email PLUS the existing `timing: notify` pair (singular); the stage doctrine is "one order-stable line per stage await, at stage level only" (`src/index.ts:147-158`). The `timing: notify` pair exists exactly once per run today on each of the three paths (Gate 1, Gate 2, match path).
- One failed send out of N: `sendText` throws wrapped (`src/email.ts:144-147`); inside a sequential loop the first rejection aborts the loop (remaining surfaces NOT attempted), leaves `persistJudged` unreached, and rejects the run → entry catch → exit 1 (`src/index.ts` bootstrap). This IS FR7: nothing marked seen, next run re-sends every surface (state `diffNew` filters by id, so all posts re-flag unseen). Do NOT add per-send try/catch — partial continuation would split the match set across runs and contradict the chosen all-or-nothing decision.
- FR8 log line: `sendDigest` already logs once per successful call (`src/email.ts:180-183`, `email: sent digest with N post(s) to <recipient>`); looping yields one line per surface for free — extend the string to carry the surface label. Per-surface log-line precedent: `fetch: ${label} OK — N post(s)` (`src/linkedin-fetch.ts:497` region) and `extract: ${surface.label}: N post(s)` (`src/index.ts` logged-out loop).
- `matches` is ordered identically to `newPosts` (`judgePosts` reassembles slots in candidate input order, `src/judge.ts:1050`-1054), so grouping is stable without sorting.

### Subject, body, riders
- `buildSubject` (`src/email.ts:55-71`): count + plural, platform names joined " + " in first-seen order, and the fixed `(#hiring indonesia)` pin. The pin is DROPPED on per-surface subjects (developer ruling); the accepted pattern `3 new job posts — linkedin: "hiring react"` replaces the platform-name logic; a url surface renders its URL verbatim (matching the log-label convention); the heartbeat keeps its own subject (`src/heartbeat.ts:111-113`). Subject shapes are pinned by ~18 "new job post" regexes across `tests/email.test.ts` + `tests/index.test.ts` — enumerate the pins in design.
- `buildDigest` (`src/email.ts:84-105`): body header line IS the subject (`:89,104`), numbered `[linkedin]`-tokenized items (`:92-96`), leg line rides only when `leg.status !== "ok"` (`:98-101`), degraded line rides only when non-empty (`:102-103`).
- Rider carrier ruling (developer): riders ride EVERY surface email. Simplest carrier — pass the same `linkedinLeg`/`degradedAccounts` to every iteration; healthy defaults stay quiet, so the repetition only appears when something is wrong.
- `SendDigestResult` (`src/email.ts:23-28`: sent/messageId?/recipient?/postCount) returns per iteration; the `exactOptionalPropertyTypes`-safe conditional-spread idiom (`:186`) is the pattern for any new per-surface field.
- `sendText` (`src/email.ts:119-152`) is the single transport seam: one nodemailer transport (`:126-134`), `config.to ?? config.user` recipient (`:125` — the one-inbox non-goal), wrapped fail-visible throw. The per-surface loop changes nothing here.

### Dedupe and multi-surface membership
- `dedupePosts` (`src/index.ts:552-562`) is first-seen-wins DROP (`seen.has(post.id)` → continue, `:556-557`). This is the exact first-wins behavior FR2 overrides: dropping the second copy would silently strip that surface's membership.
- Required change: keep first-seen order but MERGE — union the incoming duplicate's `surfaces` into the kept post, building a new array (the two copies are independent row instances from the payload; never push into either input's array).
- The judge wraps, never clones (`src/judge.ts:1050-1054`), so attribution enriched at dedupe time flows to the notify seam by reference.
- State stores judged ids only (`persistJudged` → `saveState`; `diffNew` filters by id against the seen map, `src/state.ts:166`) — attribution never round-trips through `state/seen-posts.json`, which is what makes FR7's byte-identical-on-failure criterion structural.
- FR5 invariant ("a post found by one surface appears exactly once") holds because each payload row carries exactly its own surface set and dedupe never invents memberships; duplicates ride every matching surface only when N surfaces genuinely collected the post. Exception — Open Question 1: rows whose surfaces all sit outside the active config match but join no group, so the union of emails falls short of the match set until design settles the unattributed policy.

### Heartbeat and the funnel gates
- The heartbeat is a single run-level email entirely inside `src/heartbeat.ts`: `HeartbeatStats` (`:30-52`, riders `linkedinLeg?` `:48`, `degradedAccounts?` `:51`), `sendHeartbeat` (`:177-193`) makes exactly ONE `sendText` call (`:184-189`).
- Call sites: the best-effort `heartbeat()` helper (`src/index.ts:69-90` — enabled-gate first, self-contained catch that warns and never rethrows) from Gate 1 (`src/index.ts:381-390`, zero unseen, no disk write) and Gate 2 (`src/index.ts:473-491`, heartbeat at `:480` BEFORE `persistJudged` at `:483`).
- "Zero-match run sends exactly ONE email" holds BY CONSTRUCTION: the gates and the match path are mutually exclusive returning branches; the only `sendDigest` call in src is `src/index.ts:498`, structurally unreachable on a zero-match run. A run with ≥1 match sends no heartbeat. Caveats outside the fixture path: the all-down availability skip (`src/index.ts:413-425`) sends 0-1 exhaustion alarms and no heartbeat; the parked run (`:358-361`) sends zero emails.
- `HeartbeatStats` gains nothing: the stats literal (`src/index.ts:363-374`) is built from surface-agnostic totals, per-surface scan counts do not exist before attribution lands, and the FRD locks the heartbeat as run-level. If per-surface scan counts are ever wanted, they belong in run-log lines (FR8 pattern), not the email contract.

## Code References
- `src/types.ts:10-23` — Post contract (six fields; add optional `surfaces` here)
- `src/config-file.ts:16-20` — Surface union (the `{type, value}` identity pair)
- `src/config-file.ts:284-300` — resolveSurfaces (1:1 map; linkedin entries throw = wiring-bug guard)
- `src/linkedin-fetch.ts:452-526` — fetchLinkedInPosts walk (side array, slot write, terminal flatten)
- `src/linkedin-fetch.ts:464` / `:494` / `:525` — perSurface array / stamp-and-publish point / the flatten that destroys grouping
- `src/linkedin-voyager.ts:161` / `:215` — parseSearchResponse signature / the Post mint literal (no change needed)
- `src/extract.ts:36` / `:87` / `:105-112` — surface-blind extraction / normalizeThreadItem / the Post literal
- `src/fetch-threads.ts:294` / `:318` / `:326` — authenticated walk / slot write / flatten (the Threads destruction point)
- `src/fetch-threads.ts:369` / `:441` — authenticated XHR path bypasses extractPosts (why a parameter cannot reach it)
- `src/linkedin-payload.ts:28` — PAYLOAD_VERSION (bump 1→2)
- `src/linkedin-payload.ts:62-78` — isValidRow (add optional surfaces admission; invalid → drop + count)
- `src/linkedin-payload.ts:151-155` — strict version guard (unchanged per developer ruling)
- `src/linkedin-payload.ts:84-113` — writePayloadAtomic (shallow copy is safe)
- `scripts/fetch-linkedin.ts:239` / `:275` / `:193` — PC-leg partition / payload write call / pushPayload
- `src/index.ts:497-500` — THE notify seam (single sendDigest call → per-surface loop)
- `src/index.ts:501` — persistJudged call (notify-before-persist; failed send never reaches it)
- `src/index.ts:552-562` — dedupePosts (drop at :556-557 → must become merge)
- `src/index.ts:381-390` / `:473-491` — Gate 1 / Gate 2 (both return before :498; heartbeat stays one email)
- `src/index.ts:69-90` — heartbeat() helper (best-effort, self-contained catch)
- `src/index.ts:363-374` — HeartbeatStats literal (gains nothing)
- `src/index.ts:147-158` — timeStage (wrap the whole loop, one timing: notify pair)
- `src/email.ts:55-71` — buildSubject (pin at the return; drop it on per-surface subjects)
- `src/email.ts:84-105` — buildDigest (header = subject; leg line :98-101; degraded line :102-103)
- `src/email.ts:119-152` — sendText (the one transport seam; wrapped throw :144-147)
- `src/email.ts:157-190` — sendDigest (empty gate :164-168; per-call log :180-183 → the FR8 line)
- `src/email.ts:23-28` — SendDigestResult (per-iteration return shape)
- `src/heartbeat.ts:30-52` / `:111-113` / `:177-193` — HeartbeatStats / heartbeat subject / single sendText call
- `src/judge.ts:188` — JudgedPost interface / `src/judge.ts:1050-1054` — the reassembly loop that wraps by reference (`judged.push({ post, verdict })`)
- `watcher.config.json` — surfaces array: duplicate linkedin "hiring react" at [11] and [24]; near-duplicate techthreads urls at [8] and [9]; "hiring developer jakkarta" typo at [17]; platforms.threads = false

## Integration Points

### Inbound References
- `.github/workflows/watch.yml` — cron runs `npx tsx src/index.ts`, then commits all three state files back (the loop feeds per-surface digests)
- `scripts/fetch-linkedin.ts:234` + `:275` — the PC leg: partition → fetchLinkedInPosts → writePayloadAtomic → push (attribution ORIGIN; stamped rows must survive this round-trip)
- `scripts/probe-linkedin.ts:55` — probe calls parseSearchResponse (why the mint site must not gain a surface param)
- `tests/index.test.ts:273-285`, `tests/email.test.ts:294-305` — recording transports (the loop stays offline-testable through the same seam)

### Outbound Dependencies
- `src/email.ts:119-152` — sendText → nodemailer (one transport for digest, heartbeat, alarms; unchanged)
- `src/state.ts` — saveState/diffNew (ids only; re-send semantics after a failed run)
- `src/config-file.ts` — readSurfaces (add the duplicate-value warn per developer ruling)
- `src/heartbeat.ts` — rides sendText; zero coupling to the per-surface loop

### Infrastructure Wiring
- `src/index.ts` WatcherDeps — `transport?` (SMTP seam), `linkedinFetch?` (payload reader seam), `statePath?` (tests point these at temp dirs)
- `src/index.ts` platform partitions — linkedin arm flag-gated (`platforms.linkedin`), threads arm flag-gated (`platforms.threads`); disabled platforms contribute no surfaces and no emails (FR6)
- `.github/workflows/watch.yml` — no new secrets/env vars (FRD NFR); GMAIL_USER/GMAIL_APP_PASSWORD unchanged

## Architecture Insights
- Notify-before-persist is the correctness invariant: a failed send exits the run before `saveState`, so the next run re-judges (ids never marked seen) and re-sends. The per-surface loop must stay inside the existing `timeStage` closure to inherit this for free.
- Caller-side stamping before the flatten is the codebase's own idiom: both walkers already keep per-surface side arrays and both already destroy them with filter+flat. Stamping at the slot write extends the idiom instead of inventing a new seam.
- One identity, many renderings: store `{type, value}`; the run log renders `linkedin/<value>` (surfaceLabel), the subject renders `linkedin: "<value>"`, url surfaces render verbatim. Never store pre-rendered labels.
- Best-effort vs fail-closed email classes: digest = fail the run; heartbeat/alarms = warn and continue. The loop changes the digest class only.
- Duplicate-suppression convention: a duplicate costs one email, a suppressed signal costs the outage (episode-alarm doctrine) — the every-email rider ruling and the warn-not-fail duplicate ruling both follow it.

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: digest subject names only matching platforms
**Commit(s)**: `3b005cb` — "email: digest subject names only the platforms with matched posts" (2026-11-09), via PR #12 `fe14e20`
**Blast radius**: 2 files across src + tests
  src/email.ts — buildSubject rewrite; tests/index.test.ts — 3 subject regex pins
**Follow-up fixes**: none for the subject; `154c473` re-touched email.ts the same day via a parallel branch (concurrent features share email.ts)
**Lessons from docs**:
- .rpiv/artifacts/plans/2026-11-08_17-48-48_platform-toggle.md — the plan locked render changes OUT, yet validation flagged a prose-vs-render gap; the render change shipped as this separate commit
**Takeaway**: subject changes look tiny in src but are pinned across two test files; this repo already once split "gate behavior" from "subject naming" into two commits — plan the pins from day one.

### Precedent: second surface added end-to-end (attribution threading)
**Commit(s)**: `68c1e2d` — "feat: linkedin second surface with configurable scroll rounds" (2026-10-31)
**Blast radius**: 27 files, ~1707 insertions, every layer (types, config, extract, email, index, both fetchers, 12 test files)
**Follow-up fixes**: `defb8af`/`216a617` — "fix: treat an empty linkedin search window as zero results" (2026-11-01, same fix on two branches)
**Lessons from docs**:
- .rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md — "switching the form later re-emails in-window posts once": identity/attribution shape is effectively permanent
**Takeaway**: threading a new field through Post touches every layer; get the attribution shape right the first time.

### Precedent: LinkedIn payload envelope + PC-local leg
**Commit(s)**: `a8752bf` — "feat: run the linkedin leg on the local pc (voyager transport, payload push, login helper)" (2026-11-05)
**Blast radius**: payload writer, reader/watch seam, riders, transport (multi-layer)
**Follow-up fixes**: `625b15e` — fail the tick on a mis-homed checkout; design-time catch: a silent no-commit push bug (commit-exit check added, suite re-gated)
**Lessons from docs**:
- .rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md — D13: payload faults degrade, never exit; per-row malformation drops + counts
**Takeaway**: every envelope extension needs the version bump; the writer side (PC leg) is where silent push failures have already bitten once.

### Precedent: new email variant (heartbeat status email)
**Commit(s)**: `67a9bd2` — "feat: no-match heartbeat status email" (2026-10-25)
**Blast radius**: 7 files (new module + email + config + index + 2 test files)
**Follow-up fixes**: `8a8c0a0` — "fix: trim and lowercase candidate terms before matching" (2026-10-30, found 5 days post-ship)
**Lessons from docs**:
- .rpiv/guidance/src/architecture.md — "Adding an Email Variant" recipe: pure buildX → thin sendX → caller sets the failure policy
- .rpiv/artifacts/TECH_DEBT_AUDIT.md — F021: cancel-in-progress can produce a duplicate digest; accepted. Notify stays strictly BEFORE persist
**Takeaway**: normalization bugs surface after shipping; the run already accepts duplicate emails as a cost — per-surface splitting multiplies the blast radius of a mid-loop SMTP failure N-fold, so keep all-or-nothing.

### Precedent: config-gated platform switch
**Commit(s)**: `de0ad53` — "config: platforms switch gates each leg; both off parks the run" (2026-11-09); `89cbd42` — provider-health circuit (2026-11-07, 16 files)
**Blast radius**: config-file.ts + watcher.config.json + index.ts + tests
**Lessons from docs**:
- .rpiv/artifacts/validation/2026-11-09_07-08-49_platform-toggle.md — "src/config-file.ts and watcher.config.json must land in the same commit"
**Takeaway**: config validator changes ride together with the config file; the duplicate-surface warn belongs in readSurfaces with its tests.

### Composite Lessons
- Subject/render changes are pin-heavy and historically got deferred into follow-up commits (`3b005cb`); enumerate all ~18 subject pins in design before touching buildSubject.
- Attribution shape is permanent (`68c1e2d`'s re-email warning); the `{type, value}` pair + config-order Map key is the shape to lock.
- Envelope extensions ride the version bump + degrade-never-exit doctrine (`a8752bf`, D13); the strict guard already provides the one-logged-line degradation the acceptance criterion demands.
- Duplicates are the accepted failure currency (F021, `8a8c0a0`); per-surface splitting makes the all-or-nothing ordering the critical invariant to preserve.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-11-09_10-57-55_email-per-surface.md` — the FRD: 8 locked decisions, acceptance criteria, follow-ups
- `.rpiv/artifacts/research/2026-10-29_12-15-34_tech-debt-audit-remediation.md` — runPool side-array semantics verified for both perSurface sites
- `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` — payload envelope design (D5/D9/D13)
- `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md` — attribution-threading precedent, id-namespace warning
- `.rpiv/artifacts/plans/2026-11-08_17-48-48_platform-toggle.md` — subject-render deferral precedent
- `.rpiv/artifacts/validation/2026-11-09_07-08-49_platform-toggle.md` — config-file + config-file-data one-commit rule
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — F021 duplicate-digest acceptance; notify-before-persist
- `.rpiv/guidance/src/architecture.md` — funnel gates, DI seams, email-variant recipe, platform-fetcher recipe
- `.rpiv/guidance/scripts/architecture.md` — PC-leg contracts, exit codes

## Developer Context
**Q (discover: Split by configured surface, not platform): Per-surface or per-platform split?**
A: Per configured surface

**Q (discover: Send rule: only surfaces with matches): Do zero-match surfaces send?**
A: Only surfaces with matches

**Q (discover: Duplicates ride every matching surface): Where does an overlapping post land?**
A: Every matching surface

**Q (discover: Heartbeat stays one combined email): What happens to the zero-match heartbeat?**
A: Keep one combined heartbeat

**Q (discover: Recipients: non-goal — one inbox): Multi-recipient routing?**
A: Non-goal — one inbox

**Q (discover: Keywords stay global): Per-surface keyword scoping?**
A: Keep global keywords

**Q (discover: Send failure: keep all-or-nothing): One surface's send fails mid-run?**
A: Keep all-or-nothing

**Q (discover: Subject names the surface): How does an email identify its surface?**
A: Subject carries the surface label — `3 new job posts — linkedin: "hiring react"`

**Q (`src/linkedin-payload.ts:151-155`: payload version tolerance on the 1→2 bump)**
A: Strict bump — guard shape unchanged; a v1 envelope degrades to one logged threads-only tick. Developer: "the pc will do the git pull, so the old post will not appear."

**Q (`src/email.ts:98-103`: which per-surface emails carry the linkedinLeg + degraded-accounts riders, FR9)**
A: Every surface email carries the riders when present.

**Q (`src/email.ts:67`: keep or drop the (#hiring indonesia) pin on per-surface subjects)**
A: Drop the pin on per-surface subjects; the heartbeat keeps its own subject.

**Q (`src/config-file.ts` readSurfaces: duplicate configured surface values)**
A: Warn at config load (one log line naming the repeated value); grouping collapses duplicates to one email.

## Related Research
- `.rpiv/artifacts/research/2026-10-29_12-15-34_tech-debt-audit-remediation.md` — the runPool side-array contract this feature stamps into

## Open Questions

1. **Unattributed-match policy — silent post loss at the notify seam.** A matched post can join no per-surface group, and the FRD does not settle where it goes. Concrete trigger: the operator removes a surface from `watcher.config.json`, but `state/linkedin-posts.json` stays fresh for up to 30 minutes (`src/linkedin-payload.ts:31`, `PAYLOAD_MAX_AGE_MS`) and still carries posts tagged with the removed surface. Those posts pass dedupe, get judged, match — then join no group and vanish with no log line, breaking the acceptance criterion that the union of email posts equals the match set. The strict-bump ruling closed only the version path; this is the attribution path of the same hazard. Design must pick one: drop + count with a loud run-log line, a fallback "unattributed" email, or a payload-read-time filter of rows whose surfaces all sit outside the active config set.

2. **URL-surface subject truncation.** Rendering `url` surfaces verbatim puts ~90-character URLs into the subject line. Mail clients truncate subjects near 60-80 characters, and the two near-duplicate techthreads surfaces (`watcher.config.json` surfaces[8] and [9]) become indistinguishable in the inbox — the exact legibility failure this feature exists to fix. A shortening rule must exist before the subject template locks — and it must keep the distinguishing parameter: rendering only the `q` value gives "techthreads" for both surfaces[8] and [9] (they differ only by `exact_match=false`), which reproduces the exact indistinguishability the question names. Workable example: strip the `https://www.threads.com` prefix and keep path + full query (`/search?exact_match=false&q=techthreads&serp_type=tags&filter=recent` — ~70 chars, under most truncation limits; surfaces[8] vs [9] stay distinguishable).

## Follow-up Research 2026-11-09T12:02:55+0700
- Added Open Questions 1 and 2 ahead of design: the unattributed-match policy (silent post loss when payload surfaces fall out of config) and URL-subject truncation. Both surfaced in re-review of the analysis; neither was settled by a developer checkpoint.
- Spot-check, corrected: the first pass was a string heuristic, not a read, and it pinned the wrong site (`src/judge.ts:1050-1054` is wherever the interface landed, not the wrap). The by-reference wrap is now proven at the measured reassembly push `judged.push({ post, verdict })` with `post = candidates[index]` (`src/judge.ts:1054`), inside the slots loop (`src/judge.ts:1050`). runPool: signature returns void (`src/pool.ts:36`), cursor advances synchronously (`src/pool.ts:44`). All line numbers for judge.ts, pool.ts, state.ts, fetch-threads.ts, scripts/fetch-linkedin.ts, src/linkedin-voyager.ts and scripts/probe-linkedin.ts in this doc are now measured from the files directly.
- Citation provenance: the 8 previously subagent-only cited files are now opened and every cited anchor in them is measured from the file (judge.ts, pool.ts, state.ts, fetch-threads.ts, scripts/fetch-linkedin.ts, src/linkedin-voyager.ts; src/config.ts and src/recency.ts carry no :line citation in this doc). Anchors that did not match measured content were demoted to path-only citations, per the cite-what-you-read fallback
- Measured anchors (main-agent read, this pass): JudgedPost interface `src/judge.ts:188`; reassembly loop `:1050`, by-reference push `:1054`; runPool signature `src/pool.ts:33` (returns void `:36`, cursor claim `:44`); diffNew `src/state.ts:166` (Set over seenPostIds keys, filter by id); fetch-threads walk `src/fetch-threads.ts:294`, slot write `:318`, flatten `:326`, success filter `:226`, posts.set `:369`, values return `:441`; fetch-linkedin fetchTick `scripts/fetch-linkedin.ts:234`, partition `:239`, writePayloadAtomic call `:275`, pushPayload def `:193`, dedicated-clone note `:103`; voyager parseSearchResponse `src/linkedin-voyager.ts:161`, mint literal `:215`; probe parse call `scripts/probe-linkedin.ts:55`..