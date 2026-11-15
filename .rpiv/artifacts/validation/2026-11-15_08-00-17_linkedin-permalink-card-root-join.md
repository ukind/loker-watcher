---
template_version: 1
date: 2026-11-15T08:00:17+0700
author: Yogiswara Utama
commit: 20c5f28
branch: ukind/fix-incorrect-link-email
repository: fix-incorrect-link-email
topic: "Validation of LinkedIn digest permalinks — card-root urn join replaces the positional zip"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-14_20-28-21_linkedin-permalink-card-root-join.md"
tags: [validation, linkedin-parser, replay-linkedin, linkedin-payload, state, fixtures]
last_updated: 2026-11-15T08:00:17+0700
---

## Validation Report: LinkedIn digest permalinks — card-root urn join replaces the positional zip

### Implementation Status

- ✓ Phase 1: Parser core — the card join — Fully implemented (all 8 automated criteria verified; scoped lint clean on both phase files)
- ✓ Phase 2: Fixtures — real-capture distillation — Fully implemented (all 4 automated criteria verified; fixture headers byte-match the plan fences)
- ✓ Phase 3: Harness upgrade — shared helper + re-pinned tallies — Fully implemented (all 9 automated criteria verified; 13/13 harness tests)
- ✓ Phase 4: Seen-state purge — Fully implemented (purge verified: 0 urn keys, v2 parse, deletions-only commit 587273c; terminal-slice gates green)

### Automated Verification Results

- ✓ Parser suite: `npx tsx --test tests/linkedin-parser.test.ts` — 25 tests, 0 fail (plan-pinned 25 after Phase 2)
- ✓ Harness suite: `npx tsx --test tests/replay-linkedin.test.ts` — 13 tests, 0 fail
- ✓ Type check: `npm run typecheck` — clean over src, tests, scripts
- ✓ Lint: `npm run lint` — 69 files, 0 errors (the three lint/style/useTemplate sites from the prior run are fixed with the template-literal form at tests/fetch-linkedin.test.ts:154, tests/linkedin-fetch.test.ts:96, tests/probe-linkedin.test.ts:131)
- ✓ Full suite: `npm test` — 634 tests / 153 suites, 0 fail
- ✓ No zip-era machinery survives: `grep -c "DIGITS_RE\|count mismatch\|pair(s)" src/linkedin-parser.ts` — 0
- ✓ Amendment pins: `grep -c "phantom bait\|sibling seeds\|image-card" tests/linkedin-parser.test.ts` — 3 (>= 3)
- ✓ Id pin did NOT widen: `ACTIVITY_URN_RE` still `/^urn:li:activity:\d{9,}$/` (src/linkedin-payload.ts:65)
- ✓ `PAYLOAD_VERSION = 2` unchanged (src/linkedin-payload.ts:30)
- ✓ Walk arm compiles against the parser: `collectLinkedInPosts` at src/linkedin-fetch.ts:57,564 (unchanged `Post[]` signature)
- ✓ Fixture provenance: `grep -l "20261114T055257Z" tests/fixture/linkedin-*.txt` — all three files
- ✓ No frozen copies in the harness: `grep -cE "^(const|let) (WHOLE_REF_RE|PATH_REF_RE|URN_RE|DIGITS_RE)" scripts/replay-linkedin.ts` — 0; `collectLinkedInPosts` absent; `joinCards` rides import + use sites (lines 65, 467)
- ✓ Shared exports: `GRAPH_WHOLE_RE`/`GRAPH_PATH_RE`/`URN_ANYWHERE_RE` exported (3/3); `URN_ANYWHERE_RE` carries no `/g` flag (src/linkedin-parser.ts:114)
- ✓ No zip vocabulary in the harness: `zipByText|zip-paired|zip-unlinked|joinCandidate` — 0
- ✓ Purge: `grep -c "urn:li:activity:" state/seen-posts.json` — 0; parse probe prints `parses; version 2 ; keys 76053`
- ✓ Purge diff deletions-only: `git show --numstat 587273c -- state/seen-posts.json` — 0 insertions / 449 deletions
- ✓ Suite regression measured — base 587273c (detached worktree run): 626 tests / 626 pass / 0 fail; delta -> 634/634 (+8 join/replay pins)
- ✓ Output equivalence on the real corpus — base (587273c, zip) parser vs card join over session 20261114T055257Z bodies 001-016: 27 posts minted by BOTH parsers; 9 ids carry REPAIRED pairs (the zip had swapped card texts between posts — bodies 005/006/008/012); 2 card-true ids the zip never minted (013: ...0694400, 016: ...0331136) with 2 foreign zip ids gone (...5193728, ...422401 — the zip had paired real post text with wrong activity ids entirely); the other 16 id+text pairs byte-identical

### Code Review Findings

#### Matches Plan:

- src/linkedin-parser.ts — the card join matches the Phase 1 fence: $L-strict graph forms (`GRAPH_WHOLE_RE`/`GRAPH_PATH_RE`), unanchored non-global `URN_ANYWHERE_RE`, guarded `timestampFromId`/`mintPost`, `joinCards` (seeds-only climb, closure text harvest, forward urn collection), stream-order `collectLinkedInPosts` with the ONE req-9 line
- tests/linkedin-parser.test.ts — the re-based suite carries every plan pin: split-card join, share-typed permalink, embedded urn, nested-marker image card, sibling-seed non-merge, phantom-bait guard, chip longest-wins, four drop classes, stream order, req-9 log shape, share-typed payload round-trip, plus the five capture-fixture cases
- tests/fixture/linkedin-{multicard,share,joinref}-card-body.txt — provenance/trim/edge headers byte-match the plan fences, including the reworded bait claim ("lives only in the UNTRIMMED capture")
- scripts/replay-linkedin.ts — rides the shared `joinCards`/`CardJoin` exports; prints per-row card-linked dispositions and the verdict tally
- state/seen-posts.json — the purge landed exactly as planned: 449 urn keys removed, deletions-only, committed with the plan's message
- tests/fetch-linkedin.test.ts:135-158, tests/linkedin-fetch.test.ts:77-100, tests/probe-linkedin.test.ts:112-135 — the three sibling `cardBody` helpers re-pinned to the urn-string row shape (digit-field rows mint nothing under the join); necessary in-goal work the phases' `files:` lists did not declare — recorded as a plan deviation below

#### Deviations from Plan:

- Plan write-set gap (non-blocking): the three sibling test files above were modified without any phase declaring them — the card join reads urn STRINGS, so their digit-field `cardBody` rows minted 0 posts under the new parser. The re-pin is committed (20c5f28). The plan's `files:` lists should name the three files — follow-up revise item, not a code gap
- Plan manual criterion "27/27 linked ... across bodies 005-016" is NOT MET AS WRITTEN: measured 27 linked / 9 dropped. DIAGNOSED: all 9 drops are honest — every dropped card's text harvest is empty at BOTH the seed and the root closure (seedTexts=0, rootTexts=0 on all 9; body 014's three commentary_text markers ALL harvest 0 chars, and the body carries 9 image alt-text specs the join's commentary_text scope deliberately does not read). No join-unlinked text row exists anywhere in these bodies. The digest emits nothing for body 014 because the capture holds no post text — correct-by-contract, not a harvest miss. Residual scope note: a post whose ONLY text lives in an article_description or update_image spec drops by design; that extension belongs to the deferred mint/junk-gate follow-up, not this plan

#### Pattern Conformance:

- ✓ The three re-pinned `cardBody` helpers mirror the parser suite's marker/id-row idiom (`markerEl` shape, urn-string `idRow` equivalent)
- ✓ scripts/replay-linkedin.ts keeps the scripts/ conventions: entry guard, exported pure `analyzeBody`, imports point scripts -> src only
- Minor observation: the marker/id-row builders stay duplicated per test file — the pre-existing pattern of this suite (acceptable variation, not a deviation)

#### Potential Issues:

- Harness blind spot for the no-text class: scripts/replay-linkedin.ts:467-471 puts only cards with `text !== null` into `joinByText`, so a no-text drop can never match a census row and `card-dropped (no-text)` can never print (the verdict tally still counts it — the 9 drops in bodies 012-016 are these). Grepping the replay output for card-dropped on such bodies comes back empty BY CONSTRUCTION; the diagnosis probes from this validation are the way to inspect them. Follow-up plan, not this one
- Phase 1 Manual criterion 1 is UNMET: main is NOT merged into this branch. `origin/main` is not an ancestor of HEAD (`git rev-list --left-right --count origin/main...HEAD` = 161 / 1); no merge commit exists anywhere in `origin/main..HEAD`. Merge `origin/main` into this branch BEFORE merge-back (src/linkedin-fetch.ts is the known 3-file conflict set). Non-blocking for the verdict: the ordering hazard it guarded against is closed — the parser fix (20c5f28) is committed AHEAD of the purge (587273c), so no push/merge/cherry-pick of this branch can re-send the 449 mis-paired posts
- tests/linkedin-parser.test.ts:8-9 — the header still reads "Capture-fixture-driven cases land with tests/fixture/ (Slice 2)" — future tense now that Phase 2 landed the fixtures. Comment-only; non-blocking

### Manual Testing Required

Executed during this validation (live browser + replay harness + validation probes):

1. Permalink click-through (FRD acceptance) — VERIFIED live:
   - [x] `https://www.linkedin.com/feed/update/urn:li:share:7527236650461134849` renders the card-true post (Andrew Hairs, "Hiring at volume? Our RPO model can cut hiring costs by up to 60%.")
   - [x] The zip-era broken form `urn:li:activity:7527236650461134849` (share id in an activity urn) renders "Post not found — This post was deleted or removed"
- [x] The minted id's own form `urn:li:activity:7527236651333419008` renders the same post
2. req-9 log line on a real body — VERIFIED: the multicard fixture prints `linkedin-parser: 2 card(s) linked, 0 dropped (0 no-urn, 0 multi-urn, 0 dead-id, 0 no-text) — 419008↔"Hiring at volume? Our RPO", 154304↔"HIRING: Car-Mounted 360° "` (trailing-space 25-char head exactly as pinned)
3. Fresh-session replay (session 20261114T055257Z, 16 bodies) — run as specified: 27 linked / 9 dropped, forward-only (reverse 0 on every body), per-row card-linked ↔ urn-tail dispositions print. The 27/27 claim is NOT MET AS WRITTEN (27 linked + 9 honest drops — see Deviations); the pairing itself is card-true throughout
4. Still open — needs the operator or the hosted runtime:
   - [ ] Merge `origin/main` into this branch before merge-back (161-commit divergence; see Potential Issues)
   - [ ] Re-send decision on the first post-purge hosted tick: "HIRING: Car-Mounted 360°" re-judged, digest link opens the card-true post (...154304)
   - [ ] Next hosted commit-back shows judged-id additions only (no urn keys re-appearing from stale rows)

### Recommendations:

- Merge `origin/main` into this branch (the skipped Phase 1 manual step), then `/skill:commit`
- Follow-up revise on the plan: declare the three sibling test files in Phase 1's `files:` list, and reword the 27/27 manual criterion to the measured 27-linked + 9-honest-drops form
- The stale "land with tests/fixture/" header sentence in tests/linkedin-parser.test.ts can drop in the same touch-up (comment-only)
- Optional harness follow-up (not this plan): let `analyzeBody` print a `card-dropped (no-text)` row — e.g., seed the census from the CardJoin records instead of the text map — so the no-text class is visible in replay output

Validation notes: no --goal/--baseline/--scope/--acceptance were provided — criteria judged against the whole working tree; the plan carries no risks: array (no risk rulings due); .rpiv/artifacts/verdicts/ holds no quarantine manifests. Validation scratch (base-suite worktree, drop-diagnosis and corpus-equivalence probes) was created under .rpiv/tmp/ and removed. Supersedes the 2026-11-15T07:29:44 report (verdict fail, blockers b1-b3 — all three lint sites fixed and committed in 20c5f28).
