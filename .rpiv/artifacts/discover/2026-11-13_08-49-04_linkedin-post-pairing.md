---
date: 2026-11-13T08:49:04+0700
author: Yogiswara Utama
commit: 33e17dc
branch: ukind/feature-fix-incorrect-link-linkedin
repository: feature-fix-incorrect-link-linkedin
topic: "LinkedIn post-link pairing"
tags: [intent, frd, linkedin-parser, linkedin-fetch, email]
status: ready
last_updated: 2026-11-13T08:49:04+0700
last_updated_by: Yogiswara Utama
---

# FRD: LinkedIn post-link pairing

## Summary
Replace the LinkedIn parser's position-based id-to-text pairing (the global timestamp zip) with a proven link between a post's text and its activity id. When no link can be proven, the post still ships in the digest but carries no deep link. Non-post rows (bare links, bare emails, lone hashtags) can no longer mint, and a raw-body capture plus offline replay proves the whole fix on real data.

## Problem & Intent
The developer reported: "the mint data from linkedin is sometimes not accurate." A digest item showed the QA Engineer job text with the link `https://www.linkedin.com/feed/update/urn:li:activity:7526496255288508416` — clicking it opens a different post entirely (an Oil & Gas hiring post). Other items link correctly. Asked what actually hurts, the developer chose: "Source data wrong — the minted post itself pairs content with the wrong activity URN. The email is just where I notice it." Asked how to proceed, the developer said "diagnose first" — and this session's payload diagnosis confirmed the mechanism before any fix was scoped.

Diagnosis evidence (state/linkedin-posts.json, 204 posts, writtenAt 2026-11-13T01:33:43.125Z):
- Row 180 mints the QA Engineer text under urn id `...88508416` = `7526496255288508416` — the id whose live content is the Oil & Gas post. Row 179 mints the Oil & Gas text under a different id. Position-pairing crossed them.
- The zip's precondition (stream order = derived-time order, and a 1:1 id/text count) silently fails in production. The repo's own verification artifact already recorded the family: "the count-mismatch zip mis-pairs, it does not merely drop" (`.rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md`).
- 22 junk mints in the same payload: texts that are only a URL (rows 35, 83, 94, 99, 102, 105, 127, 159, 196), only an email address (rows 69, 162, 182, 183), or only a hashtag (rows 147, 202).

## Goals
- A digest link never opens a different job post than the text shown. Wrong links become impossible, not rare.
- Pairing is provable from the stream, or the post ships without a link. Position is not identity.
- Non-post rows cannot mint.
- Future pairing defects are diagnosable: raw stream bodies are captured and replayable offline.

## Non-Goals
- The Threads leg is untouched.
- Post.author stays the `linkedin-member` placeholder (member names are absent from response bodies).
- Duplicate reposts (one job text under many repost ids — row 1 text appears 14 times) stay as-is; a follow-up, per developer decision.
- No email-side re-validation layer: the mint is the single source of truth; the digest renders what the parser produced.

## Functional Requirements
1. The parser SHALL NOT pair text with an activity id by position. The global timestamp zip in `collectLinkedInPosts` (`src/linkedin-parser.ts:218-320`, zip loop `:286-300`) is removed.
2. The parser SHALL attach a permalink only when the id-to-text link is proven from the stream itself. When unproven, it SHALL mint the post with no permalink (`Post.permalink` becomes optional in `src/types.ts`) and count the unlinked posts in a visible log line.
3. The digest SHALL omit the link line for a post with no permalink (rendering site `src/email.ts:137`).
4. The parser SHALL NOT mint rows whose text is not a post: a bare URL, a bare email address, a lone hashtag. The exact predicate SHALL be derived from replayed capture evidence (harvest artifact vs genuinely link-only post), and the replay output SHALL name the cause.
5. The walk (`src/linkedin-fetch.ts`) SHALL save every intercepted raw stream body to a local git-ignored folder, and a replay script (`scripts/replay-linkedin.ts`) SHALL re-run the parser over a saved body offline and print the mint table (id, text head, linked/unlinked/skipped).
6. Every mint decision — paired, unlinked, skipped, with counts — SHALL stay visible in log lines, extending the existing pairing-oracle line contract (`src/linkedin-parser.ts` mint loop).

## Non-Functional Requirements
- **Performance**: no specific constraint; the parser remains a single O(rows) pass per body; capture writes are local disk only.
- **Security**: captured bodies are git-ignored and never committed (session-scoped content); no credentials inside parser fixtures.
- **UX / Accessibility**: digest items either carry a correct deep link or no link line at all — never a wrong one.
- **Reliability**: the parser stays pure and never throws on data; an unprovable link degrades visibly (warn naming counts), never fails the walk or the run.

## Constraints & Assumptions
- Repo non-negotiables hold: strict TS flags, Node >= 22 ESM, no new runtime dependencies, parser pure and offline-testable, atomic state writes untouched.
- The module header's 2026-11-11 claim that BFS from commentary rows reaches zero id rows needs re-verification on a fresh capture — a card-scoped join key may exist in structures not yet probed. Research's first job: find the real join, or prove there is none.
- Assumption to verify by replay: junk rows are a text-harvest defect (unresolved $-refs shrinking the longest-text winner), not mispairing — pairing cannot create text content, but the harvest cause is unproven. The developer explicitly challenged this and the replay must answer it.
- Reposts legitimately repeat one text across many ids; duplicate texts alone are not proof of mispairing.

## Acceptance Criteria
- [ ] Replaying the captured stream class that produced the incident mints the QA Engineer text either under its true id or with no link — never under `7526496255288508416`.
- [ ] The replayed payload contains zero posts whose text is only a URL, only an email address, or only a hashtag.
- [ ] A post with an unproven link renders in the digest without a link line (builder test in `tests/email.test.ts` asserts the exact string).
- [ ] Capture output lands in a git-ignored folder; `npx tsx scripts/replay-linkedin.ts <capture-file>` runs offline and prints the mint table.
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` all exit 0.

## Recommended Approach
Rewrite the mint path in `src/linkedin-parser.ts` around a proven per-post join: research locates the card-scoped id-to-text association in fresh Flight captures (or proves none exists, making unlinked mints the norm); add a non-post mint gate, optional `Post.permalink` with digest handling, raw-body capture in `src/linkedin-fetch.ts`, and `scripts/replay-linkedin.ts` for offline proof.

## Decisions

### Defect locus: the mint layer, not the email
**Question**: Keep the fix in the mint/pairing layer, or also touch the email side?
**Recommended**: Mint layer only.
**Chosen**: Diagnose first; diagnosis confirmed the mint layer is the origin. No email-side guard.
**Rationale**: developer instruction "diagnose first"; evidence `src/linkedin-parser.ts:185-203` (mintPost builds the permalink from the paired id), `src/email.ts:137` renders verbatim.

### Pairing strategy: replace the position zip
**Question**: Replace/repair the timestamp zip, or keep it with guards?
**Recommended**: Replace/repair.
**Chosen**: Replace — find the real id-to-text link in the stream, or refuse to pair.
**Rationale**: "position is not identity"; a same-count mis-order warns nothing and count-mismatch prefix pairing mispairs (verified artifact `.rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md`).

### Unprovable-link fallback: ship without a link
**Question**: When the parser cannot prove which link belongs to a post's text, what happens to that post?
**Recommended**: Ship without link.
**Chosen**: Ship without link.
**Rationale**: apply contacts (emails, gform links) live in the text; dropping loses real jobs; a missing link cannot be wrong.

### Junk mints: make non-post minting impossible
**Question**: Stop bare-link, bare-email, and lone-hashtag mints in this feature, or leave for later?
**Recommended**: Clean in this feature via a minimum-text gate.
**Chosen**: In scope, with the impossibility bar: non-post rows can never mint; the replay names the true cause first.
**Rationale**: developer challenged the cause ("might be because the bugs we currently handle? means not well paired") — pairing cannot create those texts (they come from `commentary_text` components), but the harvest root cause is unproven; the gate's predicate comes from replay evidence.

### Duplicate reposts: out of scope
**Question**: Collapse duplicate-text reposts now, or leave as-is?
**Recommended**: Leave as-is.
**Chosen**: Leave as-is; follow-up.
**Rationale**: not the wrong-link bug; collapsing changes mint semantics and state behavior.

### Proof harness: capture + replay in scope
**Question**: Add raw-body capture and a replay script to this feature?
**Recommended**: Capture + replay.
**Chosen**: Capture + replay.
**Rationale**: acceptance needs proof on real data; "diagnose first" requires the instrument to persist beyond this session.

## Open Questions
None — every branch resolved in the interview; deferred items were recorded as follow-ups instead.

## Suggested Follow-ups
- Duplicate-text reposts flood the digest and judge load (one text under 14 ids — `state/linkedin-posts.json` rows 1-34). Candidate: collapse to one item per unique text, newest id wins.
- If replay proves junk rows are unresolved $-ref harvest failures, the text-harvest walker (`textFromChildren`, `src/linkedin-parser.ts`) deserves its own hardening pass — the mint gate would then be a symptom fix.
- The IT Programmer digest item showed a whitespace-only text diff ("Gform :https://..." vs "Gform : https://...") between email and live post — harmless, but the mint normalizes text; confirm normalization stays stable.

## References
- `state/linkedin-posts.json` — incident payload, 204 posts, writtenAt 2026-11-13T01:33:43.125Z
- `src/linkedin-parser.ts` — pairing module header, mintPost :185-203, collectLinkedInPosts :218-320
- `src/linkedin-fetch.ts` — the walk that intercepts stream bodies (capture site)
- `src/email.ts:137` — digest permalink rendering
- `.rpiv/artifacts/designs/2026-11-11_07-46-39_linkedin-browser-walk-migration.md` — the pairing design and its superseded refuse-on-mismatch revision
- `.rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md` — "VERIFIED — the count-mismatch zip mis-pairs, it does not merely drop"
- Browser verification 2026-11-13 (bladebro, read-only): `urn:li:activity:7526496255288508416` live-opens Satya Anggara's Oil & Gas / Abhitech post (`recruitment-01@abhitech.co.id`, `lnkd.in/gzU6NafM`, `#oilandgasjobs`) — the digest's QA-text link target confirmed wrong on the live site.
- The QA post's true id is still uncaptured: the copy-link chain reached `linkedin.com/posts/alfianarindhaanggraeni_qa-qualityassurance-reactnative…` before the tab crashed. The FRD's capture harness should recover it on the first walk.
- Rendered DOM carries zero `urn:li:activity:` strings (full-HTML eval scan) — no id-to-text join exists in the DOM, matching the parser header's stream finding. The join must come from the Flight stream bodies.
- Developer email samples — QA Engineer item with the wrong link; IT Programmer item with the correct link
