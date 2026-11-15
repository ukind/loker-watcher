---
date: 2026-11-14T07:15:07+0700
author: Yogiswara Utama
commit: 3ed60f0
branch: ukind/fix-incorrect-link-email
repository: fix-incorrect-link-email
topic: "LinkedIn digest permalinks"
tags: [intent, frd, linkedin-parser, linkedin-fetch, permalink]
status: ready
last_updated: 2026-11-14T07:15:07+0700
last_updated_by: Yogiswara Utama
---

# FRD: LinkedIn digest permalinks

## Summary

The LinkedIn digest emails a permalink that sometimes opens a different post. The parser pairs post text with post ids by position, and that pairing is wrong on every card. This FRD replaces the positional pairing with a join from the post card itself.

## Problem & Intent

The developer's words: "me, i cannot check the original source of info by link".

A digest item shows a job post and a link. The link must open that same post. Today it often opens a different one, so the reader cannot verify the source. The reader stops trusting every link in the digest.

Live evidence. The QA Engineer item linked to `urn:li:activity:7526496255288508416`. That link opens a Satya Anggara post about Oil & Gas hiring at Abhitech. The IT Programmer item linked to `urn:li:activity:7526481300308946944`. That link opens the correct IT Programmer post.

## Goals

- Every LinkedIn item in the digest links to the post whose text it shows.
- The link works when clicked, for every urn type the card carries.
- The parser reports how many cards it did not link.

## Non-Goals

- Changing the Threads leg.
- Changing the judge, the digest layout, or the email transport.
- Repairing the 291 posts already in `state/linkedin-posts.json` by hand.

## Functional Requirements

1. The parser SHALL join each commentary text to the id carried by its own post card.
2. The parser SHALL climb from the commentary marker to the outermost row whose subtree holds exactly one marker.
3. The parser SHALL collect the urns reachable from that card root.
4. The parser SHALL use the single `urn:li:activity:` id the card carries.
5. The parser SHALL build the permalink from the card's own urn, and keep the urn type.
6. The parser SHALL drop a card that yields no activity urn, and count it.
7. The parser SHALL drop a card that yields more than one activity urn, and count it.
8. The parser SHALL NOT pair text and id by position.
9. The parser SHALL log one line per body, naming the cards it linked and the cards it dropped.

## Non-Functional Requirements

- **Performance**: no new network request. The join runs on the body already in memory.
- **Security**: no change. No new secret and no new endpoint.
- **UX / Accessibility**: no change to the email layout.
- **Reliability**: the parser stays pure and never throws. A bad card drops and counts.

## Constraints & Assumptions

- `src/linkedin-parser.ts` stays a pure string module. It must not import Playwright.
- The tests stay offline. They use capture fixtures under `tests/fixture/`.
- Assumption: a real card carries exactly one `urn:li:activity:`. Measured on 423 of 423 cards across 157 bodies.
- Assumption: a card carries a second urn (`share` or `ugcPost`) that resolves to the same post. Verified live on two cards.
- Assumption: the card root is reachable by climbing the `$`-reference graph. Measured on 462 top-level markers.

## Acceptance Criteria

- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm test` exits 0.
- [ ] A new test replays a capture body and asserts the minted id equals the card-root id for every card.
- [ ] A new test asserts the parser drops and counts a card with no activity urn.
- [ ] A new test asserts the parser drops and counts a card with two activity urns.
- [ ] The pairing log names each minted id and its text head.
- [ ] Clicking the permalink of a freshly minted post opens that post.

## Recommended Approach

Rewrite `collectLinkedInPosts` in `src/linkedin-parser.ts` to walk the Flight rows, find top-level commentary markers, climb each marker to its card root, and read the card's own urn. Delete the timestamp-ordered zip and the `>> 22n` sort. Keep `mintPost` and its guard.

## Decisions

### Root cause
**Question**: The probe says the wrong link comes from the positional zip in `src/linkedin-parser.ts:225-268` — the i-th text pairs with the i-th id by time, and the stream carries no real text-to-id link. Is that the fault to fix?
**Recommended**: Yes, fix the pairing.
**Chosen**: "dry run first to validate your potential solution".
**Rationale**: The dry run confirmed the fault. 340 of 340 cards disagree with the zip.

### Fix shape
**Question**: The shareId join is verified but only present in 76 of 175 bodies. Which fix shape do you want the FRD to specify?
**Recommended**: shareId, then DOM fallback.
**Chosen**: "shareId is good, but how come not all have shareId? also find another way instead of using DOM fallback?"
**Rationale**: The card-root join replaces both. It needs no shareId and no DOM. 423 of 423 real cards carry exactly one activity urn.

### Permalink shape
**Question**: The card carries one urn, but its type varies (activity, share, ugcPost). Which permalink shape should the FRD specify?
**Recommended**: Card urn, type kept.
**Chosen**: Card urn, type kept.
**Rationale**: `urn:li:activity:<shareId>` returns "Post not found". `urn:li:share:<id>` and `urn:li:ugcPost:<id>` resolve to the exact post.

### Already-emailed posts
**Question**: After the fix, posts already emailed with wrong links will come back under correct ids. What should happen to them?
**Recommended**: Re-send with correct links.
**Chosen**: Re-send with correct links.
**Rationale**: The reader gets the right link for each post. A repeat email costs less than a link the reader cannot trust.

### Cards with no urn or many urns
**Question**: When a card yields no urn, or more than one, what should the parser do?
**Recommended**: Drop and count.
**Chosen**: Drop and count, after the developer asked what a card looks like.
**Rationale**: A real card carries exactly one activity urn and one share or ugcPost urn, and both resolve to the same post. The edge case does not occur in 423 cards. Dropping and counting keeps the parser honest if it ever does.

## Open Questions

- None deferred.

## Suggested Follow-ups

- The text harvest returns 0 texts on 2 of 175 bodies, so those bodies mint nothing. `src/linkedin-parser.ts:131-171`.
- `state/linkedin-posts.json` holds 46 ids that carry two different texts, and 59 text heads that repeat. The next tick rewrites the file.
- The replay harness reports `join CANDIDATE (forward 107, reverse 0)` on body 080, which contradicts the module header's "zero id rows" claim. `scripts/replay-linkedin.ts`.
- The dry-run scripts live in `.rpiv/tmp/scan*.ts` and `.rpiv/tmp/dbg*.ts`. They are scratch and untracked.

## References

- `src/linkedin-parser.ts`
- `src/linkedin-fetch.ts`
- `state/linkedin-posts.json`
- `scripts/replay-linkedin.ts`
- `H:/fork/loker-watcher/captures/` (200 raw bodies, 175 with commentary markers)
