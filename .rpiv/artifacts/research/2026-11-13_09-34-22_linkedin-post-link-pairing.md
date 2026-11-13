---
date: 2026-11-13T09:34:22+0700
author: Yogiswara Utama
commit: 33e17dc
branch: ukind/feature-fix-incorrect-link-linkedin
repository: feature-fix-incorrect-link-linkedin
topic: "LinkedIn post-link pairing"
tags: [research, linkedin-parser, linkedin-fetch, linkedin-payload, email, heartbeat, capture, replay]
status: ready
last_updated: 2026-11-13T09:34:22+0700
last_updated_by: Yogiswara Utama
---

# Research: LinkedIn post-link pairing

## Research Question
Chained from the discover FRD (its Recommended Approach): rewrite the mint path in `src/linkedin-parser.ts` around a proven per-post join — locate the card-scoped id-to-text association in fresh Flight captures (or prove none exists, making unlinked mints the norm); add a non-post mint gate, optional `Post.permalink` with digest handling, raw-body capture in `src/linkedin-fetch.ts`, and `scripts/replay-linkedin.ts` for offline proof. Research bounds: (1) does a card-scoped id↔text join exist in the Flight stream bodies; (2) what causes the junk mints; (3) how far the optional-permalink change ripples; (4) where capture bolts into the walk; (5) what the replay script and the surviving test suite look like.

## Summary
- **Developer decision (this session): capture-first.** The raw-body capture harness lands as its own change; one live walk is recorded; the replay names each row's mint decision; the mint-path design (join vs unlinked-by-default) is written from that evidence, not before.
- Committed measurements already say the join does not exist (BFS depth 12, both directions, zero id rows — designs/2026-11-11 §Key Discoveries; row-local pairing resolved 3 of 6 text rows and was disproved — design:170), but the capture that proved it (`.rpiv/tmp/linkedin-pagination-body.txt`) no longer exists on this branch. The FRD demands re-verification on a fresh capture.
- Today's zip mispairs by position (proven, plan VERIFIED). 15 junk rows live in the current payload (22 across FRD history). Artifacts pre-measure one cause — CTA contamination with spec-identical `commentary_text` markers — independent of the FRD's $-ref-shrink hypothesis; both mechanisms are real and the replay must name which fired per row.
- Optional `Post.permalink` ripples to exactly THREE readers: payload admission (`isValidRow` drops unlinked rows today), the digest item (`src/email.ts:137`), and the heartbeat candidate line (`src/heartbeat.ts:160` — a template literal over string|undefined, so `tsc` will NOT flag the "   undefined" that would ship). Recommendation: mirror `stampsAreValid` and keep `PAYLOAD_VERSION = 2` — a v3 bump blackouts the whole leg during PC-clone/hosted rollout skew.
- Capture bolts into the walk's two existing response arms (matched + unmatched-flagship), fire-and-forget inside the existing page-close-race catches; replay is a thin argv→readFile→collectLinkedInPosts→table script that MUST be registered in `package.json` `lint` AND `format` (explicit lists, not globs) and gets a new `.gitignore` entry that is load-bearing (`guardCheckout` throws on any untracked file before every tick).
- Test fallout is small and mapped: 4 parser tests die with the zip, the oracle-line test is rewritten, no fetch test dies, and email/heartbeat get their first permalink-less fixtures.

## Detailed Findings

### The mint path today (the zip)
- `collectLinkedInPosts` spans `src/linkedin-parser.ts:216-322` (graph-confirmed). Per top-level Flight row, the visit closure collects rowIds (three id forms: `urn:li:activity:<id>` strings, digit `record.activityId` fields, urn-shaped object keys) and rowTexts (components whose `viewTrackingSpecs.legacyControlName === "commentary_text"`, harvested by `textFromChildren`; empty harvests drop; the marker's subtree is NOT scanned for ids — the early return at ~:260).
- The row-scoped association is then destroyed: ids flatten into a global array in first-appearance order and each row's texts collapse to ONE longest winner before any pairing happens. The tail block: usable-id filter (the BigInt guard applied one step early), numeric sort (`>> 22n` is monotonic, so numeric order IS derived-time order), `paired = min(ids, texts)`, the mismatch `console.warn`, the prefix zip loop, `mintPost` per pair, and the pairing-oracle `console.log` line (`N pair(s) — id↔text-head`).
- `mintPost` `src/linkedin-parser.ts:185-203`: timestamp = `BigInt(id) >> 22n` (null on RangeError or non-positive epoch); the permalink constructs UNCONDITIONALLY at :200 from the paired id — the line where "proven" must gate. Timestamp and permalink are body-absent facts derived from the id; author is the `linkedin-member` placeholder.

### The join question — committed evidence, stale capture
- Header claim `src/linkedin-parser.ts:26-36`: BFS over the $-ref graph from every marker row reaches ZERO id rows; `contentTrackingId` is shared list-level. Written 2026-11-11 from a 1.5 MB capture (448 rows, BFS depth 12, both directions sampled).
- design:170 measured row-local pairing: 3 root rows carry both id+text, 130 ids-only, 3 texts-only. A blanket "no co-location" is false; what is proven is "no unambiguous, ref-reachable join" — a many-ids/one-marker container row cannot say WHICH id belongs to the text. Row-local pairing resolved 3 of 6 text rows and was DISPROVED.
- The capture file is gone from the branch — the negative claim currently has no inspectable evidence artifact in the repo, only prose.
- Fresh-capture probe protocol (what the capture+replay analysis must check per body): (1) forward BFS from every marker row, depth and both directions recorded; (2) reverse-direction refs FROM id rows (the current code never follows refs from id rows, so a reverse link would be invisible today); (3) per-root-row classification — exactly-one-id+one-marker (provable 1:1), many-ids/one-marker (ambiguous container), marker-only; (4) `contentTrackingId` grouping (list-level vs per-card); (5) adjacency invariants — first-appearance order is proven NOT time order (fixture `captureBody`), so adjacency alone cannot replace pairing; (6) marker taxonomy — `translatable-commentary` placeholders with a null comment urn harvest zero text, so a probe that counts markers but not harvest outcomes misreports the join.
- The test fixture manufactures co-location the real stream lacks: `cardBody` emits the tracking row and the marker row as adjacent sibling root rows — the fixture proves the code path, not the field structure.

### Junk mints — two real causes; replay must name which
- 22 junk rows in FRD history; 15 live in the current `state/linkedin-posts.json` (9 bare `lnkd.in` URLs, 4 bare emails, 2 lone hashtags). Every one carries full identity: urn id, derived timestamp, and a permalink built from its paired id.
- Cause A — CTA contamination (pre-measured, design:80): a contact-CTA component carries a `commentary_text` marker whose specs are BYTE-IDENTICAL to a real post's (`viewName`, `interactionTypes`, `contentTrackingId`, `legacyControlName`). A 33-char email address harvests as the post's entire text. No $-ref failure involved. design:82: "The real fix is upstream: filter CTA components out of the text harvest."
- Cause B — $-ref shrink (the FRD hypothesis): `textFromChildren` silently drops on two paths — a whole-row ref whose target row is missing from THIS body or already in `seenRows` pushes nothing; a path-ref `resolve()` miss pushes nothing. A shrunk real text loses the longest-text contest to a sibling chip, or zeroes and a chip-only row mints outright.
- Evidence shape: all 15 junk texts are single tokens (no whitespace, 9-25 chars) matching `^https?://\S+$` / `^\S+@\S+\.\S+$` / `^#\S+$`; real minted texts in the same file are multi-line, 100-2000+ chars. The bare emails match Cause A's measured signature verbatim.
- The gate predicate the evidence supports today: a whitespace-free single token matching URL/email/hashtag — one predicate naming all three classes. But the FRD's bar stands: the replay names the true cause per row BEFORE the predicate freezes. If Cause B dominates on junk rows, `textFromChildren` hardening is the real cure (already a recorded follow-up) and the gate is a symptom fix.
- The per-row diagnostic the replay must print: the full rowTexts candidate list, which candidate won and why (length), and per marker whether any ref resolved or silently dropped — the only way to separate Cause A from Cause B.

### Mint outcomes and the log contract
- Today there are TWO outcomes: paired-with-link and dropped. Unlinked does not exist. Skips are anonymous: empty harvests never enter rowTexts, `seenTexts` dedupe collapses repeats, and the usable filter folds guard failures into the count-mismatch warn (test-pinned: "(1 text(s), 0 id(s))").
- The oracle `console.log` (the sanctioned offline oracle channel) is the FR6 extension surface; the walk wraps it with per-body context lines (size, minted, new, dup; the OK line counts bodies that carried posts).
- Structural decision for design: unlinked mints SHOULD still consume an id from the sorted usable list — the timestamp derives from the id regardless, the id guard must still pass, and the walk's first-wins dedupe plus the payload row contract are id-keyed (`Post.id` is the pipeline-wide dedupe key; the seen-posts ledger is keyed by id). Text-only mints would need a synthetic id scheme across four modules plus the seen-posts contract.
- Gate placement is observable in tests: gating at rowTexts accumulation vs post-assembly differs under Cause B (whether a shrunk real text still mints). Design decides with replay evidence.

### Optional permalink ripple — three readers, one admission decision
- `Post` lives at `src/types.ts:11-32`: `permalink: string` required at :21; the optional precedent is `surfaces?: Surface[]` at :28 with the admission doctrine in its doc comment. `exactOptionalPropertyTypes` is ON (`tsconfig.json:10`): absence means the key is not present, never undefined-assigned. Conditional-spread precedents: `src/index.ts` `mergeSurfaceStamps` (`{ ...kept, ...(merged.length > 0 ? { surfaces: merged } : {}) }`) and `tests/email.test.ts` `postFor`.
- Consumer sweep (grep `.permalink` across src/tests/scripts): exactly THREE readers — payload admission (`isValidRow` :99-100 requires a non-empty string), the digest item (`src/email.ts:137`), and the heartbeat candidate line (`src/heartbeat.ts:160`). `state.ts`, `recency.ts`, `judge.ts`, and `dedupePosts` touch id/timestamp only. Threads (`src/extract.ts`) keeps constructing always-linked permalinks.
- Payload admission: an unlinked row under today's gate is dropped+counted with leg still "ok" — posts vanish between walk and digest behind one aggregate warn. The tolerant-reader precedent is `stampsAreValid` (`src/linkedin-payload.ts:83-85`): `value === undefined` passes; present-but-malformed fails the row.
- Version/skew matrix (the reader's version check is EXACT equality, `PAYLOAD_VERSION = 2` at :38-41): (a) bump to v3 — the old hosted reader rejects the WHOLE envelope, the entire leg reads malformed during the PC-clone/hosted skew window (test-pinned intended behavior); (b) keep v2 + an undefined-passes permalink check — the old reader drops only unlinked rows with the count warn, and a new reader plus an old payload is unchanged. Recommendation: keep v2, mirror `stampsAreValid`. The first v3-worthy change is data an old reader must not MISINTERPRET; absence is not that.
- The writer is row-shape-agnostic (`writePayloadAtomic` stamps only version + writtenAt); the walk's stamp-at-slot-write spread preserves whatever permalink shape the parser minted and never fabricates one.

### Digest renderer
- `src/email.ts:137` interpolates `post.permalink` inside ONE template string; once the type goes optional it still compiles and would print "   undefined".
- The exact unlinked item (FR3: omit the link line) is the linked item minus the trailing `"\n   ${post.permalink}"` segment — numbering unchanged, platform token unchanged, the author line survives, and NO trailing whitespace (a naive `?? ""` substitution would leave a three-space line). Build the item from a lines array and push the link line only when `post.permalink !== undefined`.
- Byte-stability pins: the linked-item exact-string test (`tests/email.test.ts:123-140`) keeps passing untouched — that IS the linked half of acceptance. New pins: the exact unlinked string, `!digest.includes("undefined")`, no `"\n   \n"`, and a mixed-list test proving an unlinked post does not disturb numbering of subsequent linked items.
- No permalink-less `Post` fixture exists anywhere in the test suite today.

### Heartbeat — the consumer the FRD never names
- `src/heartbeat.ts:160` pushes `"   ${candidate.post.permalink}"` per candidate; template literals accept undefined without a tsc error, so the "   undefined" line ships silently. The module doc's promise "each with its permalink" needs the same amendment.
- Unlinked rows CAN reach candidacy: `selectCandidates` (`src/heartbeat.ts:73-96`) makes EVERY judged post a "judged" candidate with no term filter, and near-misses draw from `recent`. Threads stay always-linked.
- Decision evidence: OMIT the line (here it is one `lines.push` deleted — no whitespace hazard, unlike the digest) and do NOT exclude unlinked posts from candidacy — exclusion under-reports what the judge saw in the one email that explains zero-match runs, and it tangles the MAX_CANDIDATES cap.
- Test gap: the `tests/heartbeat.test.ts` factory always sets permalink; the only link pin asserts an include. Needed: an unlinked factory variant (key omitted), the exact 2-line candidate block pin, and a `!body.includes("undefined")` assertion.

### Capture harness (the posture's first deliverable)
- Seam: `page.on("response")` attached BEFORE navigation in `walkLinkedInSurface` (`src/linkedin-fetch.ts:481-528`). Two arms: matched (`LINKEDIN_RESPONSE_RE` + status 200 → text read → `collectLinkedInPosts` → first-wins urn dedupe) and the unmatched-flagship diagnostic arm (born from the documented incident: five flagship responses arrived on an endpoint the regex missed). Capture rides BOTH try-blocks — the join key may live on an unmatched endpoint.
- Fire-and-forget with the page-close race caught-and-skipped, exactly as both existing readers are; the 1.5 s `LINKEDIN_XHR_DRAIN_MS` drain (:107) is the only grace window. A lost capture is acceptable; a lost walk is not.
- PC-local verified: the hosted run imports only a TYPE from `linkedin-fetch`; watch.yml comments record the leg is PC-only; the factory is headed on the persistent profile. Capture bolted into the walk automatically rides every entry point (tick, loop, probe, chain) and can never run hosted.
- No credentials can leak BY CONSTRUCTION: `ResponseLike` exposes url/status/text only — never request or response headers (the session material is the cookie pair + profile, both outside the repo). The residual surface is public search-result content plus the surface keyword.
- Designed contract: ONE file per body, not a shared JSONL — concurrency 2 plus out-of-order body reads have no atomic-append story, bodies are raw Flight streams (a JSONL wrapper would escape multi-hundred-KB strings per line), and whole-file completeness is the replay guarantee. Naming: `captures/<UTC session stamp>/<zero-padded ordinal>-<surface-slug>.json`; the ordinal increments SYNCHRONOUSLY in the listener (`received` counts matched bodies only and reads complete out of order); the slug sanitizes the surface keyword.
- Metadata rides INSIDE each file: `schemaVersion`, `capturedAt` (the walk's injectable `now`), `label`, `ordinal`, `received`, the FULL url (the unmatched arm truncates to 80 chars in logs — store full), `status`, `matched`, and the VERBATIM body (byte-identical to what `collectLinkedInPosts` parsed, so replay == production parse).
- Directory: a repo-local `captures/` (not `state/` — the committed single-writer zone; not OS temp — contradicts the repo-local marker doctrine). The `.gitignore` entry is LOAD-BEARING: `guardCheckout` (`scripts/fetch-linkedin.ts:246-283`) runs `git status --porcelain` and throws before every tick, so one untracked capture wedges the whole PC loop.
- Constant home: `src/config.ts` (the ENV_NAMES + paths owner), env-overridable, tmp-injected in tests (the offline rule forbids repo writes in tests; every suite mkdtemps). The capture sink must be injectable — the `fetchLinkedInPosts` call shape is pinned by every fetch test.
- Replay's minimum on-disk contract: whole-file atomicity (the sibling-temp + rename shape), a self-describing versioned envelope (unknown version = visible fail), a verbatim body, reconstructable order (ordinal + capturedAt + label), and no reader-side state.

### Replay script + registration
- Shape: argv capture path → `readFile` → `collectLinkedInPosts(body)` → print the mint table (id, text head, linked/unlinked/skipped + cause). None of `fetchTick`'s subsystems are needed — cookies, working-hours window, halt latch, `guardCheckout`, the browser, the payload push, and the alarms all drop (traced per-subsystem).
- Exported injectable logic + the entry-guard idiom shared by all six PC scripts (`process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href`); `probe-linkedin.ts` is the model for export-a-call + guarded arm. `FetchTickDeps` (`scripts/fetch-linkedin.ts:85-131`) is the injectable-deps precedent.
- Exit contract (fail-visible doctrine): missing argv → a usage line + exit 1; unreadable file → `replay-linkedin: FAILED — <message>` + exit 1 in the catch wrapper (the `scripts/fetch-linkedin.ts:413-421` idiom).
- Registration is mandatory in BOTH explicit lists: `package.json` `lint` (:13) and `format` (:14 — note format does NOT list `scripts/hooks`); an unregistered `scripts/replay-linkedin.ts` escapes biome entirely. Typecheck covers it automatically (`tsconfig.json` include: src, tests, scripts). The npm alias `"replay-linkedin": "tsx scripts/replay-linkedin.ts"` matches the six existing tsx entries.

### Test inventory when the zip dies
- DIE: `tests/linkedin-parser.test.ts:212-222` (the zip flagship 3/3 proof), :231-243 and :245-260 (count-mismatch prefix pairing + warn pins).
- HALF-DIE: :262-267 and :269-286 (the timestamp-guard drop survives; the mismatch-warn assertions become FR4/FR6 cause-naming pins).
- REWRITTEN: :298-308 (the oracle-line contract survives, extended with linked/unlinked/skipped counts).
- SURVIVE: the URL-builder tests, `LINKEDIN_RESPONSE_RE` tests, `parseFlightRows`, the rich-card mint (a 1:1 card has no positional choice), the hashtag-chip longest-wins case, manifest/garbage skipping, the newline collapse, and the payload round-trip (rebaseline the implicit count if proven-join mints differ).
- `tests/linkedin-fetch.test.ts`: NO test dies — every fixture is a 1:1 card. The `:989-1005` stamp test pins `first.permalink` and flips to key-absence IFF the fresh capture proves no join; the cross-body dedupe test pins the walk's first-wins map, not pairing.
- Replacements: a proven-join case over `captureBody` (each text under its TRUE id or unlinked — never crossed), an unlinked-mint case (permalink key ABSENT, conditional spread), a skipped-junk case naming the cause (proven to fire before AND after `seenTexts` dedupe), the exact-string digest unlinked case, and the heartbeat 2-line candidate case.
- Purity constraints kept: the parser stays pure string functions (never Playwright, console oracle sanctioned); the fetch suite stays doubles-only; the capture sink injects so offline doubles never hit real disk.

## Code References
- `src/linkedin-parser.ts:26-36` — the pairing header claim (BFS zero id rows; list-level contentTrackingId)
- `src/linkedin-parser.ts:73-74` — LINKEDIN_RESPONSE_RE (the two flagship endpoints)
- `src/linkedin-parser.ts:109-177` — textFromChildren (silent ref drops: whole-ref seen/missing; path-ref miss)
- `src/linkedin-parser.ts:185-203` — mintPost (id clock guard; unconditional permalink at :200)
- `src/linkedin-parser.ts:216-322` — collectLinkedInPosts (row walk, longest-winner, flat arrays, usable filter, sort, zip, oracle line)
- `src/linkedin-fetch.ts:481-528` — the response join: unmatched diagnostic arm + matched mint arm (the capture bolt-in sites)
- `src/linkedin-fetch.ts:107` — LINKEDIN_XHR_DRAIN_MS 1500 (the page-close grace window)
- `src/linkedin-payload.ts:38-41` — PAYLOAD_VERSION = 2
- `src/linkedin-payload.ts:83-85` — stampsAreValid (the undefined-passes tolerance precedent)
- `src/linkedin-payload.ts:88-105` — isValidRow (permalink required at :99-100)
- `src/linkedin-payload.ts:178-181` — the exact-equality version gate (whole-envelope degrade)
- `src/types.ts:21` — permalink: string (required)
- `src/types.ts:28` — surfaces?: Surface[] (the optional-member precedent)
- `src/email.ts:126-148` — buildSurfaceDigest (item template :137; rider conditionals :140-145)
- `src/heartbeat.ts:130-166` — buildHeartbeatBody (candidate loop; permalink push :160; rider idiom :145-146)
- `src/heartbeat.ts:73-96` — selectCandidates (every judged post becomes a candidate)
- `src/index.ts:246` and `src/index.ts:294-315` — the LinkedIn payload arm (readPayloadPosts default; merge into the funnel)
- `src/index.ts:606-632` — dedupePosts + mergeSurfaceStamps (id-keyed; conditional-spread precedent)
- `scripts/fetch-linkedin.ts:85-131` — FetchTickDeps (the injectable-deps precedent)
- `scripts/fetch-linkedin.ts:413-421` — entry guard + FAILED/exit-1 wrapper
- `scripts/fetch-linkedin.ts:246-283` — guardCheckout (clean-tree gate; makes the .gitignore capture entry load-bearing)
- `package.json:13-14` — lint and format explicit script lists (replay MUST join both)
- `tsconfig.json:10` and `tsconfig.json:36` — exactOptionalPropertyTypes; include covers src, tests, scripts
- `.gitignore` — no capture entry yet
- `tests/linkedin-parser.test.ts:43`, `:58-96`, `:137-145` — idFor, cardBody, chipCardBody, captureBody fixtures
- `tests/linkedin-parser.test.ts:212-222`, `:231-243`, `:245-260`, `:262-286`, `:298-308` — the zip-era tests (die / half-die / rewrite)
- `tests/email.test.ts:123-140` — the linked-item exact-string pin
- `tests/heartbeat.test.ts:24-33`, `:198-205` — the factory + link pin (no unlinked case exists)

## Integration Points
### Inbound References
- `src/linkedin-fetch.ts:510` — the walk feeds every matched flagship body to collectLinkedInPosts; first-wins urn dedupe at :513-514
- `scripts/fetch-linkedin.ts:374` — fetchTick drives fetchLinkedInPosts (the PC tick)
- `scripts/probe-linkedin.ts:163` — the gate probe drives a one-surface walk
- `scripts/watch-linkedin.ts` / `scripts/linkedin-chain.ts` — reach the walk only through fetchTick/runProbe
- `src/index.ts:300-301` — the hosted run reads state/linkedin-posts.json via readPayloadPosts
### Outbound Dependencies
- `src/linkedin-parser.ts` → `src/types.ts` (Post); the parser imports nothing else at runtime
- `src/linkedin-payload.ts` → `src/state.ts` (the stateTempPath atomic idiom) and `src/config.ts` (LINKEDIN_PAYLOAD_PATH)
- `src/email.ts:137` / `src/heartbeat.ts:160` → Post.permalink (the two renderers)
- `src/heartbeat.ts` → `src/linkedin-payload.ts` (LegLine) — the modules already couple
### Infrastructure Wiring
- `.github/workflows/watch.yml` — the hosted job reads the pushed payload only (the PC-only leg is recorded in workflow comments)
- `.gitignore` — the future captures/ entry; guardCheckout enforces a clean tree before every tick
- `package.json` — the npm alias + the two explicit biome lists
- `state/linkedin-posts.json` — the payload envelope {version, writtenAt, posts} the hosted run consumes

## Architecture Insights
- Position is not identity: the zip's only diagnostic (count symmetry) breaks exactly when it is wrong. The mispair is committed evidence, not theory.
- The repo's tolerance doctrine is "absent passes; present-must-be-well-formed" (stampsAreValid) — the permalink admission change is that doctrine's third application.
- Rollout skew is a first-class constraint: the PC clone of main and the hosted run deploy independently, so every wire-format change must degrade per-row (visible warn) rather than per-envelope (leg blackout).
- Observability rides console lines with stable prefixes; every mint decision must stay in that channel (FR6) because it is the only evidence channel a replay can re-read offline.
- Silent-drop sites (ref-resolution misses, seenRows dedupe, empty harvests) are where data loss hides; the replay harness's job is to name them per row.
- The atomic-write + injectable-paths discipline extends to captures: sibling temp + rename, paths from config constants, tmpdir injection in tests.

## Precedents & Lessons
3 similar past changes analyzed.

### Precedent: the browser-walk migration that introduced the zip
**Commit(s)**: `8e8f22b` — "Migrate the LinkedIn leg to a browser walk" (2026-11-11)
**Blast radius**: 25 files across 5 layers (src/, scripts/, package.json, .gitignore, tests) — the same file set this feature touches
**Follow-up fixes**:
- `6493f2a` (+2h) — observability bolted on after the walk reported "3 posts" with no why
- `9fa2a7e` (+3h) — the cookie-document session was dead on arrival; liveness moved to the rendered DOM
- `e624cec` — close-without-feed-warm tripped LinkedIn's checkpoint twice
- `119dc25` — scrollRounds config lagged the code by 2 days
**Lessons from docs**: designs/2026-11-11 §Key Discoveries — session model, liveness gate, and pairing were all revised within hours of landing; "measured correct" was only ever true offline
**Takeaway**: budget observability, session, and liveness into the same change, and rehearse one live walk before declaring pairing behavior correct.

### Precedent: the pairing-rule three-way failure
**Commit(s)**: `8e8f22b` (the zip) → `ebd2561` (refuse-on-mismatch written into design+plan, 2026-11-11 19:07) → `ce567af` (the plan fence reverted 4 minutes later, 2026-11-11 19:11)
**Blast radius**: docs only — the refuse rule never landed in src/
**Follow-up fixes**:
- `ce567af` — the plan still carried the superseded refuse rule; because /skill:implement reads plans, the fence nearly landed code the design forbade
**Lessons from docs**: refuse-on-mismatch drops 2/3 bodies (starvation — media-only posts are real data); row-local pairing resolves 3/6 text rows (disproved); "the count-mismatch zip mis-pairs, it does not merely drop" (ids A,B,C + texts [A,C] → A↔A correct, B↔C wrong — every pairing after a gap shifts); CTA markers are spec-identical to real posts
**Takeaway**: both half-fixes are measured dead ends; unlinked-by-default is the only untried branch — and capture-first is how the next guess gets evidence before code.

### Precedent: the email-per-surface change
**Commit(s)**: `a910163` — "Send one email per surface" (2026-11-09)
**Blast radius**: 14 files (+1028/−390) — email.ts, types.ts, heartbeat.ts, linkedin-payload.ts, index.ts, config-file.ts, fetch-threads.ts, 6 test suites
**Follow-up fixes**:
- `f1812b4` — knip N020 dead exports needed their own remediation pass
- `b54f963` — N023 one Gmail transport per run
**Lessons from docs**: house style verifies rendering with exact-string builder tests; type changes ripple into payload round-trip suites
**Takeaway**: the optional-permalink change ripples the same file set; keep knip clean in the same change rather than in a later remediation phase.

### Composite Lessons
- Every "measured correct offline" claim in the 2026-11-11 migration broke within hours under live rehearsal — capture + replay + one live rehearsal is the acceptance instrument, not a nice-to-have (`6493f2a`, `9fa2a7e`, `e624cec`).
- Plans are executable contracts: a superseded rule left in a fence nearly landed forbidden code (`ce567af`). When the pairing design changes, sync every fence byte-identically in the same pass.
- Position pairing is proven wrong twice with committed measurements; keep no variant of it under any guard.
- Repost duplicates are legitimate (one text under 14 ids) — the mispair fix must not silently collapse them (recorded follow-up).

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-11-13_08-49-04_linkedin-post-pairing.md` — the FRD this research chains from (decisions, incident evidence, follow-ups)
- `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md` — the stream measurements: BFS, the row-local census, CTA contamination, the superseded refuse rule
- `.rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md` — the VERIFIED mis-pair repro and the plan-fence revert lesson

## Developer Context
**Q (discover: Defect locus: the mint layer, not the email):** Keep the fix in the mint/pairing layer, or also touch the email side?
A: Diagnose first; diagnosis confirmed the mint layer is the origin. No email-side guard.
**Q (discover: Pairing strategy: replace the position zip):** Replace/repair the timestamp zip, or keep it with guards?
A: Replace — find the real id-to-text link in the stream, or refuse to pair.
**Q (discover: Unprovable-link fallback: ship without a link):** When the parser cannot prove which link belongs to a post's text, what happens to that post?
A: Ship without link.
**Q (discover: Junk mints: make non-post minting impossible):** Stop bare-link, bare-email, and lone-hashtag mints in this feature, or leave for later?
A: In scope, with the impossibility bar: non-post rows can never mint; the replay names the true cause first.
**Q (discover: Duplicate reposts: out of scope):** Collapse duplicate-text reposts now, or leave as-is?
A: Leave as-is; follow-up.
**Q (discover: Proof harness: capture + replay in scope):** Add raw-body capture and a replay script to this feature?
A: Capture + replay.
**Q (`src/linkedin-parser.ts:26-36` + `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md`):** The committed BFS evidence says no join exists, but its capture file is gone from the branch. When does the mint-path design get written?
A: Capture-first (developer decision, this session): land the raw-body capture harness as its own change, record one live walk, replay it, and write the mint design from that evidence. Unlinked-by-default remains the likely outcome per the committed measurements.

## Related Research
- (none enumerated in .rpiv/artifacts/research/ this session)

## Open Questions
- The fresh-capture decider: does a card-scoped id↔text join exist on a live capture (checked with the six-point probe protocol)? Provable permalinks, or unlinked-by-default.
- Per-row junk cause: does the replay show refs resolving cleanly on junk rows (Cause A — gate only) or silently dropped refs (Cause B — textFromChildren hardening becomes the real cure)? The gate predicate freezes only after the replay names this.
