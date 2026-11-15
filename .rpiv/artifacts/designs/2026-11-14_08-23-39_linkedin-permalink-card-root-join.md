---
date: 2026-11-14T08:23:39+0700
author: Yogiswara Utama
commit: 3ed60f0
branch: ukind/fix-incorrect-link-email
repository: fix-incorrect-link-email
topic: "LinkedIn digest permalinks — card-root urn join replaces the positional zip"
tags: [design, linkedin-parser, replay-linkedin, linkedin-fetch, state, fixtures]
status: ready
parent: ".rpiv/artifacts/research/2026-11-14_07-48-28_linkedin-permalink-card-root-join.md"
last_updated: 2026-11-14T18-45-23+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Slice 3 locked: replay harness on the shared card join + re-pinned tallies; cross-slice parser export flip + urn-regex de-globalization (/g lastIndex hazard); slice-verifier clean"
---

# Design: LinkedIn digest permalinks — the card-root urn join

## Summary

Rewrite `collectLinkedInPosts` as the measured card join: every top-level commentary marker row climbs the $-reference graph to the outermost ancestor whose subtree holds exactly one marker row, collects the urn strings reachable forward from that card root, and mints with the kept, guarded `mintPost` — `Post.id` stays the activity urn (the dedupe key), `Post.permalink` becomes the card's own urn type (share/ugcPost resolve; the activity urn of a share id returns "Post not found"). The timestamp-ordered zip, its `>> 22n` sort, the global id/text consolidation, and the count-mismatch warn are deleted (FRD req 8); drops are counted and named on ONE log line per body (FRD reqs 6/7/9). The replay harness upgrades in the same change through a shared helper export from the parser (its frozen regex copies and zip cross-check die with the zip); real-capture fixtures are distilled into `tests/fixture/`; `state/seen-posts.json` loses its 449 zip-era urn keys in a one-time committed edit so the FRD's re-send decision can actually execute.

## Requirements

From the FRD (`.rpiv/artifacts/discover/2026-11-14_07-15-07_linkedin-permalink-card-join.md`):

- FR1 Join each commentary text to the id carried by its own post card.
- FR2 Climb from the commentary marker to the outermost row whose subtree holds exactly one marker.
- FR3 Collect the urns reachable from that card root.
- FR4 Use the single `urn:li:activity:` id the card carries.
- FR5 Build the permalink from the card's own urn, keeping the urn type.
- FR6 Drop a card that yields no activity urn, and count it.
- FR7 Drop a card that yields more than one activity urn, and count it.
- FR8 Never pair text and id by position.
- FR9 Log one line per body, naming the cards linked and the cards dropped.
- Acceptance: typecheck/lint/test green; a replay test asserts minted id == card-root id per card; drop+count tests for 0-urn and 2-urn cards; the pairing log names each minted id and its text head; a freshly minted permalink opens that post.
- Developer decisions (checkpoint 2026-11-14): re-send the wrongly-linked posts; card urn, type kept; drop and count the urn edge cases; delete the redundant digit-field and urn-object-key capture rules; upgrade the harness in the same change; purge seen keys via a one-time edit; hand-distill fixtures now.

## Current State Analysis

`collectLinkedInPosts` (src/linkedin-parser.ts:216-322) runs a six-stage positional pipeline: the per-row `visit` closure collects activity ids (urn strings :226-231, `activityId` digit fields :247-251, urn object keys :262-265) and one longest-wins text per row (:274); a global first-appearance id list (:270-272) is filtered to usable ids (:284-292), sorted by `BigInt(id) >> 22n` (:294-300), and zipped positionally with the text list (:301-313) behind a count-mismatch warn. The stream carries no text-to-id link, so the zip mis-pairs — measured 340/340 disagree (dry run, `.rpiv/tmp/scan9.ts`), and "mis-pairs, does not merely drop" (plan 2026-11-11 VERIFIED; row-180 incident 2026-11-13; 3x recurrences).

### Key Discoveries

- The join needs no new graph: `parseFlightRows` (:87-105) is the node set; the harness already materializes forward containment (`refTargets`, scripts/replay-linkedin.ts:281-307) and its inversion (:485-492). Edges only join rows the stream carried.
- The validated climb lives in the dry-run instrument `.rpiv/tmp/scan9.ts` (340/340 disagreement proof; 423/423 card join): marker rows = payloads containing `"legacyControlName":"commentary_text"`; seeds = marker rows not reachable from another marker row; climb hops <= 12 along parents whose forward span holds exactly one marker row; urn strings collected forward from the root; exactly-one-activity-urn filter. The production walk supersedes two instrument limitations: text harvest walks any row shape (not only bare React-element rows) with the longest-wins pick per marker row, and containment counts the candidate row itself in its span.
- Both ref forms count: whole refs (`$L<hex>`) and path refs (`$L<hex>:path`) — the 462-top-level-marker measurement used the ref-graph form; the census's whole-ref-only `hasMarker` (scripts/replay-linkedin.ts:387-389) is the stale side.
- Body 080's forward 107 / reverse 0 verdict proves urn collection must go FORWARD from the climbed root (BOTH marker+id rows are the live join shape); the module header's "BFS reaches zero id rows" claim (:27-29) is falsified and gets rewritten with the code (the ce567af lesson).
- `mintPost` (:185-203) derives id AND permalink from one activity id (:194, :200); the split needs a signature change. Its RangeError/non-positive-epoch guard is kept verbatim and its verdict joins the req-9 tally (the :284-292 pre-filter subsumes into it).
- `Post.permalink` is read verbatim by exactly two template literals (src/email.ts:137, src/heartbeat.ts:160); nothing reconstructs it from `Post.id`. Payload admission pins only `row.id` to `ACTIVITY_URN_RE` (src/linkedin-payload.ts:65, :93-94) and checks `permalink` non-empty (:99-100) — a share/ugcPost permalink passes untouched, `PAYLOAD_VERSION = 2` stays (:30; a bump would blackout the leg during rollout skew).
- Every id-keyed consumer survives untouched: walk first-wins dedupe + seen-stop (src/linkedin-fetch.ts:562-577, :569-574), `dedupePosts`/`mergeSurfaceStamps` (src/index.ts:606-637), `diffNew` (src/state.ts:207-212), judge inputs (src/judge.ts:260, :282 — never see a permalink).
- The re-send blocker: `state/seen-posts.json` holds 449 `urn:li:activity:` keys (grep, 2026-11-14); the persist-stamp + 72 h prune (src/state.ts:115-134) always outlives the id-clock + 72 h recency window (src/recency.ts:17-21), so no corrected post can naturally re-send. The purge is a one-time edit of the committed file, before the first fixed tick.
- The harness is coupled to the live parser by import (scripts/replay-linkedin.ts:53), frozen regex copies (:96-99), `zipByText` execution (:449-457), zip dispositions (:417-421), and the cross-check zip identity (tests/replay-linkedin.test.ts:268-280). Keeping the old rule replayable has no mechanism (no version pin; vendoring = a second pairing walk maintained forever).
- FRESH CORPUS HARVESTED (2026-11-14 12:53, resolves the eviction for Slice 2): `npm run linkedin-chain` from H:/fork/loker-watcher landed session `20261114T055257Z` — 12 matched bodies (005-016, ~1.6 MB each), 27 posts. The zip-era pairing logs disagree with card truth on bodies 006/012/013 — measured mis-pairings this design corrects.
- CORPUS EVICTED (discovered 2026-11-14, pre-slice): the retention clock (`CAPTURE_KEEP_SESSIONS = 20`, src/linkedin-capture.ts:46) pruned every matched session. All 20 remaining H:/fork/loker-watcher/captures/ sessions are single-file UNMATCHED diagnostic captures from today (SSR firehose: markers=0 urns=0); the 157-body / 423-card evidence base and dbg9's session 20261113T103653Z are gone from disk. The dry-run numbers survive only in committed artifacts; real bodies must be RE-HARVESTED fresh (Slice 2). A pre-slice scratch validation (.rpiv/tmp/verify-join.ts) over the remaining bodies could not exercise the climb — 60 cards, all zero-urn — confirming only that the remaining corpus cannot validate anything.
- `gate-destructive.js` blocks only shell redirects into `state/seen-posts.json` (RULES[5]); the purge runs as a node fs rewrite, not a redirect.

## Scope

### Building

- `src/linkedin-parser.ts`: the card join (`joinCards` + rewritten `collectLinkedInPosts`), widened urn-string pattern, deleted digit-field/urn-key/sort/zip/warn machinery, `mintPost` split signature, shared exports (`URN_RE`, `WHOLE_REF_RE`, `PATH_REF_RE`, `CardJoin`), rewritten module header.
- `tests/linkedin-parser.test.ts`: re-based suite — zip-era pins die, join pins + drop-count pins + log-shape pins land.
- `tests/fixture/linkedin-*.txt` (3 files): real-trimmed flight bodies — multi-card, share-typed card, minimal join-ref card; in-test mutations cover 0-urn / 2-urn / dead-id.
- `scripts/replay-linkedin.ts` + `tests/replay-linkedin.test.ts`: harness re-pointed at the card join via the shared exports; frozen copies deleted; dispositions re-based to card-linked/card-dropped; cross-check re-pinned to the card identity; tallies re-pinned.
- `state/seen-posts.json`: one-time purge of `urn:li:activity:` keys (449 today), committed.

### Not Building

- The mint/junk gate (bare-URL/email/hashtag mints) — named follow-up; the join does not fix text-shape junk.
- `PAYLOAD_VERSION` bump or any payload admission change — the id pin must NOT widen; a bump blackouts the leg.
- Repairing the 291 zip-era rows in `state/linkedin-posts.json` by hand — the next PC tick rewrites it (FRD non-goal).
- A fixture generator script — hand-distilled fixtures are tracked forever; generator deferred.
- Threads leg, judge, digest layout, email transport (FRD non-goals).

## Decisions

### Urn collection: strings only, pattern widened

Ambiguity: keep the digit-field (`activityId`) and urn-object-key capture rules, or delete them?

Explored: keeping them adds same-id sources that cannot produce share/ugcPost urns and forces in-card dedupe to avoid false FR7 drops; the measured instrument (`.rpiv/tmp/scan9.ts:13` = `urn:li:(share|ugcPost|activity):`) collected strings only, 423/423 cards.

Decision: delete both rules (src/linkedin-parser.ts:247-251, :262-265); collect urn strings matching `/^urn:li:(share|ugcPost|activity):(\d{10,})$/`. `DIGITS_RE` (:80) dies.

### The climb: $L-strict edges; seeds-only span; closure text harvest

Ambiguity: which containment semantics — whole-ref-only (census) or both forms (ref-graph)?

Explored: the 462-marker FRD measurement used the ref-graph form; the census's whole-ref-only `hasMarker` under-counts.

Decision (AMENDED 2026-11-14, fresh session 20261114T055257Z — developer-approved reopen): edges from $L-PREFIXED whole and path refs only, filtered to stream-carried rows (an optional-$L form made a bare "24" data string in row 5f a phantom reference to marker 24 and nest-killed the seed); marker rows detected by the `commentary_text` payload hint; seeds exclude marker rows reachable from another marker row; the climb walks parents while the candidate's forward span (itself included) holds exactly one CARD SEED — a seed's own nested markers do not block the climb, a container holding two sibling seeds does — <= 12 hops; the card's text is the longest commentary across the seed's marker closure (image cards carry the commentary in a nested marker row: body 005's lnkd.in post — seed 24 harvests empty, nested marker 5f carries the text). Validated on all 12 fresh bodies: 27/27 linked with card-true pairs (`.rpiv/tmp/join-live-v3.mjs`); the locked pre-amendment code minted 26/27 and dropped body 005's third post. The zip-log disagreements on bodies 006/012/013 are the zip's measured mis-pairings this design corrects (e.g. "Car-Mounted 360°" went out with id ...212608; the card-true id is ...154304).

### mintPost kept + guard; signature (activityId, permalink, text)

Simple: FRD Recommended Approach keeps `mintPost` and its guard (:185-203). The caller picks the permalink urn — the first non-activity urn when the card carries one (share/ugcPost resolve), else the activity urn — and passes the FULL URL. `Post.id` stays `urn:li:activity:<activityId>` (req 4). Multiple non-activity urns: first in walk order (deterministic; the measured shape is exactly one).

### Drops counted; one req-9 log line per body

Simple: outcome per card — `linked` | `no-text` | `no-urn` (FR6) | `multi-urn` (FR7) | `dead-id` (the mintPost guard verdict, subsuming the :284-292 pre-filter). One `console.log` line per body: linked count, dropped count with per-cause numbers, and every minted `id-tail↔"text head"` pair (acceptance criterion; the ↔ glyph is the live pairing-oracle precedent). Stream order of marker rows is the mint order (req 8 deletes the sort).

### Harness upgraded in the same change via shared exports

Directional (developer-confirmed; exports AMENDED 2026-11-14 with the $L-strict split): the parser exports `URN_ANYWHERE_RE` / `GRAPH_WHOLE_RE` / `GRAPH_PATH_RE` / `CardJoin` / `joinCards` (the $L-optional text-walk forms stay module-private); the harness deletes its frozen copies (:96-99), re-points `zipByText` at the join (:449-457), re-bases dispositions to card-linked/card-dropped (:417-421), replaces the cross-check identity with the card-root identity (tests/replay-linkedin.test.ts:268-280), and re-pins tallies. The instrumented census walk stays (it names row-level drops the parser swallows).

### Seen-key purge: one-time edit, no permanent script

Genuine ambiguity resolved (developer choice): rewrite the committed `state/seen-posts.json` once during implement (node fs rewrite, zero-urn-key grep gate, then commit). Keeps the four-writers doctrine — no fifth writer, no forever-logic in `loadState`. `gate-destructive.js` does not block it (fs rewrite, not a shell redirect).

### Fixtures hand-distilled; generator deferred

Genuine ambiguity resolved (developer choice), AMENDED after the eviction discovery: fixtures are still hand-distilled real-trimmed flight bodies — but the source is a FRESH matched session harvested at slice time, because the retention clock emptied the corpus. Harvest = run `npm run linkedin-chain` (or `npm run fetch-linkedin`) from the DEDICATED main clone (H:/fork/loker-watcher — guardCheckout rejects this branch clone), which captures matched bodies via the production sink; distill within the same session, well inside the 20-session window. `parseFlightRows` is line-based — trim keeps row hexes and $-ref targets byte-exact; provenance headers name the session. 0-urn/2-urn/dead-id classes ride in-test mutations of the fixtures (the tests/ doctrine: variants by mutation). Documented fallback if the harvest yields no matched body: synthesize the minimal join-ref fixture from the protocol shapes JOIN_BODY pinned (recorded in committed artifacts), and flag the loss in the slice's Manual Verification.

## Architecture

### src/linkedin-parser.ts:26-35,77-105,176-330 — MODIFY

Header PAIRING paragraph rewritten to the climb evidence; regex constants widened/exported; `mintPost` signature split; `collectLinkedInPosts` rewritten as the card join over the kept `parseFlightRows`/`textFromChildren`.

Three replacement regions, in file order — everything else in the file stays byte-identical:

**Region 1 — the module header (replaces lines 1-44):**

```ts
/**
 * The LinkedIn content-search Flight parser (the pure core the deleted
 * REST search client held) plus the search-URL builder.
 *
 * The logged-in search app streams results as React Flight bodies
 * ("hex-id":JSON per line) over /flagship-web/search/results/content/
 * (initial page) and /flagship-web/rsc-action/actions/pagination (each
 * "Load more" click — the only pagination trigger; scrolling fires
 * nothing, verified live 2026-11-11). The parser splits the rows and
 * mints posts by the CARD JOIN (design 2026-11-14, replaces the
 * deleted positional zip):
 *
 * - a card seeds at a commentary_text marker row (viewTrackingSpecs
 *   legacyControlName "commentary_text") no other marker row can reach,
 *   and climbs $-reference parents to the outermost ancestor row whose
 *   forward span holds exactly ONE CARD SEED (FRD req 2, <= 12 hops) —
 *   the card's own nested markers belong to its seed and do not block
 *   the climb; a container holding TWO seeds (sibling cards) does.
 * - graph edges follow $L-PREFIXED references only ($L<hex> and
 *   $L<hex>:path): a bare hex-ish string in a tracking payload is DATA,
 *   never a reference (fresh-corpus lesson 2026-11-14: a bare "24"
 *   string phantom-ref'd marker 5f to marker 24 and nest-killed the
 *   seed). The text walk keeps its historical $L-optional forms.
 * - the card's text is the LONGEST commentary across the seed's marker
 *   closure (seed + its nested markers): image cards carry the
 *   commentary in the nested marker row (session 20261114T055257Z body
 *   005, the lnkd.in image post — the seed's own harvest is empty).
 * - the card's urn strings are collected FORWARD from that root
 *   (capture body 080: forward 107 / reverse 0 — urns live ahead of the
 *   marker, never behind it). The pattern matches share, ugcPost and
 *   activity urns, embedded or standalone (scan9's measured form).
 * - Post.id stays the card's single urn:li:activity:<id> — the dedupe
 *   key every downstream consumer reads. Post.permalink is the card's
 *   OWN urn type (FRD req 5): share/ugcPost resolve to the exact post;
 *   urn:li:activity:<shareId> returns "Post not found" (live-verified).
 * - a card with no activity urn, two or more, an id the timestamp guard
 *   rejects, or an empty text harvest is DROPPED AND COUNTED (FRD reqs
 *   6/7). ONE log line per body names linked + dropped counts and every
 *   minted id<->text head (FRD req 9).
 *
 * POSITIONAL PAIRING IS GONE (FRD req 8): the old rule paired the i-th
 * distinct text with the i-th usable id sorted by derived time —
 * measured 340/340 wrong on the dry run, and a position zip mis-pairs
 * (never merely drops) after any gap. The deleted pairing header's
 * premise ("BFS reaches zero id rows") was falsified by body 080.
 *
 * timestamps are NOT in the body: the activity id encodes creation time
 * as BigInt(id) >> 22n (epoch ms, 4-6 min drift against the rendered
 * age label, proven on live ids 2026-11-11).
 *
 * Member names are absent from the response bodies, so Post.author is a
 * placeholder (the deleted walk's finding, unchanged).
 *
 * mintPost guards its timestamp the way the deleted REST client's
 * id-clock guard did — a BigInt RangeError or a non-positive epoch
 * yields null, never a thrown parse.
 *
 * Testability: every export is a pure string function; importing this
 * module never loads Playwright and touches no I/O (the one log line
 * rides console.log, the sanctioned offline oracle).
 */
```

**Region 2 — the regex constants (replaces the `FLIGHT_LINE_RE`..`DIGITS_RE` block; `URN_RE` and `DIGITS_RE` die):**

```ts
const FLIGHT_LINE_RE = /^([0-9a-f]+):([\s\S]*)$/;

/** Text-walk reference forms ($L-optional — the restored historical walk). */
const WHOLE_REF_RE = /^\$L?([0-9a-f]+)$/;
const PATH_REF_RE = /^\$L?([0-9a-f]+):(.+)$/;

/**
 * Graph-edge reference forms — the $L prefix is REQUIRED (fresh corpus
 * 2026-11-14: an optional-$L form turned a bare "24" data string in row
 * 5f's payload into a phantom reference to marker 24 and nest-killed
 * the seed). Flight references are always $-prefixed. EXPORTED for the
 * replay harness: its probe arms measure the same graph the join climbs.
 */
export const GRAPH_WHOLE_RE = /^\$L([0-9a-f]+)$/;
export const GRAPH_PATH_RE = /^\$L([0-9a-f]+):(.+)$/;

/**
 * Urn strings join embedded or standalone (scan9's measured form).
 * EXPORTED for the replay harness's census. NOT global: a shared /g
 * regex carries lastIndex across exec calls, so a match whose end sits
 * past the next string's length silently drops that string's urn
 * (order-dependent misses; every use takes the first match only).
 */
export const URN_ANYWHERE_RE = /urn:li:(share|ugcPost|activity):(\d{10,})/;

const MARKER_CONTROL = "commentary_text";
const MAX_CLIMB_HOPS = 12;
```

**Region 3 — `mintPost` + the join (replaces everything from the `Mint one Post` doc-comment to end of file):**

```ts
/**
 * The guarded id-clock: a BigInt RangeError or a non-positive epoch
 * yields null — a broken id can never mint a post with an invalid Date.
 */
function timestampFromId(activityId: string): string | null {
  try {
    const ms = BigInt(activityId) >> 22n;
    if (ms <= 0n) return null;
    return new Date(Number(ms)).toISOString();
  } catch {
    return null;
  }
}

/**
 * Mint one Post from capture-verified facts; the id carries the timestamp.
 * Returns null on an unusable id (the guarded id-clock contract). The
 * permalink arrives fully built — the CARD's own urn decides its type
 * (FRD req 5); the id stays the activity urn (req 4).
 */
function mintPost(activityId: string, permalink: string, text: string): Post | null {
  const timestamp = timestampFromId(activityId);
  if (timestamp === null) return null;
  return {
    platform: "linkedin",
    id: `urn:li:activity:${activityId}`,
    text,
    author: AUTHOR_PLACEHOLDER,
    permalink,
    timestamp,
  };
}

/**
 * Every $L-prefixed reference one row's subtree names (both forms);
 * stream-carried rows only. The $L prefix is REQUIRED — a bare hex-ish
 * string in a tracking payload is DATA, never a reference (the
 * phantom-edge guard, fresh corpus 2026-11-14).
 */
function refTargets(payload: unknown, rows: Map<string, unknown>, into: Set<string>): void {
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const whole = GRAPH_WHOLE_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (rows.has(id)) into.add(id);
        return;
      }
      const scoped = GRAPH_PATH_RE.exec(node);
      if (scoped !== null) {
        const id: string = scoped[1] ?? "";
        if (rows.has(id)) into.add(id);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const value of Object.values(node as Record<string, unknown>)) visit(value);
  };
  visit(payload);
}

/** True when the row's subtree carries a commentary_text marker (no $-ref following). */
function hasMarkerSpec(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.some(hasMarkerSpec);
  if (payload === null || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const specs: unknown = record.viewTrackingSpecs;
  if (
    specs !== null &&
    typeof specs === "object" &&
    (specs as Record<string, unknown>).legacyControlName === MARKER_CONTROL
  ) {
    return true;
  }
  return Object.values(record).some(hasMarkerSpec);
}

/** Every commentary_text harvest in one row; empty harvests stay out (the old early-return kept). */
function harvestTexts(payload: unknown, rows: Map<string, unknown>): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const specs: unknown = record.viewTrackingSpecs;
    if (
      specs !== null &&
      typeof specs === "object" &&
      (specs as Record<string, unknown>).legacyControlName === MARKER_CONTROL
    ) {
      const text = textFromChildren(record.children, rows);
      if (text.length > 0) out.push(text);
      return; // the commentary subtree is text; it carries no urns
    }
    for (const key of Object.keys(record)) visit(record[key]);
  };
  visit(payload);
  return out;
}

/**
 * Distinct SEED rows (non-nested markers) reachable forward from one
 * row, itself included, memoized per joinCards call (the memo dies with
 * the call — the parser stays pure, no module state). The climb counts
 * seeds, not all markers: a card's own nested marker belongs to its
 * seed and must not block the climb; a container holding TWO seeds
 * (sibling cards) still does (fresh corpus 2026-11-14, body 005).
 */
function makeSpanCounter(
  refs: Map<string, Set<string>>,
  seedRows: Set<string>,
): (hex: string) => number {
  const memo = new Map<string, number>();
  return (hex: string): number => {
    const cached = memo.get(hex);
    if (cached !== undefined) return cached;
    const seen = new Set<string>([hex]);
    const stack: string[] = [hex];
    let count = seedRows.has(hex) ? 1 : 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      for (const target of refs.get(current) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        if (seedRows.has(target)) count += 1;
        stack.push(target);
      }
    }
    memo.set(hex, count);
    return count;
  };
}

/**
 * Distinct urn strings reachable FORWARD from one row (cycle-guarded;
 * depth-first in payload key order — the refTargets/harvestTexts idiom).
 * Urns embedded inside longer strings join too (URN_ANYWHERE_RE — scan9's
 * measured form).
 */
function collectUrnStrings(rows: Map<string, unknown>, start: string): string[] {
  const seen = new Set<string>([start]);
  const out: string[] = [];
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const match = URN_ANYWHERE_RE.exec(node);
      if (match !== null) {
        const urn = match[0];
        if (urn !== undefined && !found.has(urn)) {
          found.add(urn);
          out.push(urn);
        }
        return;
      }
      const whole = WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (rows.has(id) && !seen.has(id)) {
          seen.add(id);
          visit(rows.get(id));
        }
        return;
      }
      const scoped = PATH_REF_RE.exec(node);
      if (scoped !== null) {
        const id: string = scoped[1] ?? "";
        if (rows.has(id) && !seen.has(id)) {
          seen.add(id);
          visit(rows.get(id));
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) visit(value);
    }
  };
  visit(rows.get(start));
  return out;
}

/**
 * Every row reachable forward from one row, itself included — the
 * seed's card closure (the text-harvest span).
 */
function forwardClosure(refs: Map<string, Set<string>>, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const stack: string[] = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const target of refs.get(current) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      stack.push(target);
    }
  }
  return seen;
}

/** One card's join facts — the decision record per marker row (the replay harness reads it too). */
export interface CardJoin {
  /** The seed marker row (flight hex id). */
  marker: string;
  /** The card root the climb landed on (flight hex id). */
  root: string;
  /** The card's longest commentary text across the seed's marker closure; null when nothing harvested. */
  text: string | null;
  /** Distinct urn strings reachable from the root, walk order. */
  urns: string[];
  /** The single activity id's digits; null unless outcome is "linked". */
  activityId: string | null;
  /** The permalink urn — the card's own non-activity urn, else the activity urn; null when dropped. */
  linkUrn: string | null;
  /** The card's fate: linked, or the drop cause (FRD reqs 6/7 + the guard). */
  outcome: "linked" | "no-text" | "no-urn" | "multi-urn" | "dead-id";
}

/**
 * Join every card a flight body carries: the pure facts the mint (and the
 * replay harness) read. Seeds are the marker rows no other marker row can
 * reach; each seed climbs parents to the outermost ancestor whose forward
 * span holds exactly one CARD SEED (FRD req 2 — the card's own nested
 * markers do not block the climb; $L-strict edges keep phantom data
 * strings out of the graph), and the urn strings reachable FORWARD
 * from that root decide the card (FRD req 3; body 080's forward 107 /
 * reverse 0 verdict). The card's text is the longest commentary across
 * the seed's marker closure (image cards carry it in a nested marker;
 * fresh corpus 2026-11-14). A card yields exactly one
 * urn:li:activity: id (req 4) or it drops with its cause (reqs 6/7).
 */
export function joinCards(body: string): CardJoin[] {
  const rows = parseFlightRows(body);
  const entries = [...rows.entries()];
  const markerRows = new Set<string>();
  for (const [hex, payload] of entries) {
    if (hasMarkerSpec(payload)) markerRows.add(hex);
  }
  if (markerRows.size === 0) return [];
  const refs = new Map<string, Set<string>>();
  const parents = new Map<string, string[]>();
  for (const [hex, payload] of entries) {
    const targets = new Set<string>();
    refTargets(payload, rows, targets);
    refs.set(hex, targets);
    for (const target of targets) {
      if (target === hex) continue;
      const list = parents.get(target) ?? [];
      list.push(hex);
      parents.set(target, list);
    }
  }
  // Seeds: a marker row another marker row can reach is nested, never a seed.
  const nested = new Set<string>();
  for (const marker of markerRows) {
    const seen = new Set<string>([marker]);
    const stack: string[] = [marker];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      for (const target of refs.get(current) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        if (markerRows.has(target)) nested.add(target);
        stack.push(target);
      }
    }
  }
  const seedRows = new Set<string>([...markerRows].filter((marker) => !nested.has(marker)));
  const spanOf = makeSpanCounter(refs, seedRows);
  const cards: CardJoin[] = [];
  for (const [hex, payload] of entries) {
    if (!markerRows.has(hex) || nested.has(hex)) continue;
    // The card's text: the longest commentary across the seed's marker
    // closure — image cards carry the commentary in a nested marker row.
    const closure = forwardClosure(refs, hex);
    const texts: string[] = [];
    for (const rowHex of closure) {
      const rowPayload = rows.get(rowHex);
      if (rowPayload !== undefined && hasMarkerSpec(rowPayload)) {
        texts.push(...harvestTexts(rowPayload, rows));
      }
    }
    if (texts.length === 0) {
      cards.push({
        marker: hex,
        root: hex,
        text: null,
        urns: [],
        activityId: null,
        linkUrn: null,
        outcome: "no-text",
      });
      continue;
    }
    const text = texts.reduce((a, b) => (b.length > a.length ? b : a));
    let root = hex;
    for (let hop = 0; hop < MAX_CLIMB_HOPS; hop += 1) {
      const next = (parents.get(root) ?? []).find((parent) => spanOf(parent) === 1);
      if (next === undefined) break;
      root = next;
    }
    const urns = collectUrnStrings(rows, root);
    const activityIds: string[] = [];
    let linkUrn: string | null = null;
    for (const urn of urns) {
      const match = URN_ANYWHERE_RE.exec(urn);
      const kind = match?.[1];
      const digits = match?.[2];
      if (kind === undefined || digits === undefined) continue;
      if (kind === "activity") activityIds.push(digits);
      else if (linkUrn === null) linkUrn = urn;
    }
    const dropped = (outcome: CardJoin["outcome"]): CardJoin => ({
      marker: hex,
      root,
      text,
      urns,
      activityId: null,
      linkUrn: null,
      outcome,
    });
    if (activityIds.length === 0) {
      cards.push(dropped("no-urn"));
      continue;
    }
    if (activityIds.length > 1) {
      cards.push(dropped("multi-urn"));
      continue;
    }
    const activityId = activityIds[0] ?? "";
    if (timestampFromId(activityId) === null) {
      cards.push(dropped("dead-id"));
      continue;
    }
    cards.push({
      marker: hex,
      root,
      text,
      urns,
      activityId,
      linkUrn: linkUrn ?? `urn:li:activity:${activityId}`,
      outcome: "linked",
    });
  }
  return cards;
}

/**
 * Mint every post the body's cards carry, in marker-row stream order
 * (FRD req 8 — no sort, no positional pairing). Drops are counted per
 * cause; ONE log line per body names linked + dropped counts and every
 * minted id<->text head (FRD req 9).
 */
export function collectLinkedInPosts(body: string): Post[] {
  const cards = joinCards(body);
  const posts: Post[] = [];
  let noText = 0;
  let noUrn = 0;
  let multiUrn = 0;
  let deadId = 0;
  for (const card of cards) {
    if (card.outcome !== "linked" || card.activityId === null || card.linkUrn === null) {
      if (card.outcome === "no-urn") noUrn += 1;
      else if (card.outcome === "multi-urn") multiUrn += 1;
      else if (card.outcome === "dead-id") deadId += 1;
      else noText += 1;
      continue;
    }
    const post = mintPost(
      card.activityId,
      `https://www.linkedin.com/feed/update/${card.linkUrn}`,
      card.text ?? "",
    );
    if (post === null) {
      deadId += 1;
      continue;
    }
    posts.push(post);
  }
  const dropped = noUrn + multiUrn + deadId + noText;
  const pairs = posts.map((post) => `${post.id.slice(-6)}↔"${post.text.slice(0, 25)}"`).join(", ");
  console.log(
    `linkedin-parser: ${posts.length} card(s) linked, ${dropped} dropped (${noUrn} no-urn, ${multiUrn} multi-urn, ${deadId} dead-id, ${noText} no-text) — ${pairs}`,
  );
  return posts;
}
```

### scripts/replay-linkedin.ts:1-99,417-457,478-492,535-589 — MODIFY

The merged result below is the WHOLE file — implement replaces the file wholesale (the unchanged regions are reproduced verbatim from the on-disk original, so the fence is the single source of truth).

```ts
/**
 * Offline replay for the LinkedIn raw-body captures (the card-join
 * harness, design 2026-11-14): read one or more CaptureRecord files
 * written by the walk's capture sink (src/linkedin-capture.ts),
 * re-analyze each body per root row, and print the evidence the
 * shipped join produced (the census names the row-level facts and
 * drops the join swallows; this script decides nothing).
 *
 * The join itself is the PARSER'S (src/linkedin-parser.ts exports
 * joinCards/CardJoin + the $L-strict graph forms + the urn-string
 * form): this file imports them instead of copying — the frozen-copy
 * era ended when the parser shipped the join. One local instrument
 * remains: the text walk mirrors the parser's PRIVATE textFromChildren
 * rule for rule with drop counting, so it carries its own $L-optional
 * forms.
 *
 * Per body, every line rides the stable `replay:` prefix (the
 * oracle-channel doctrine — distinct outcomes never share a line):
 * - the census header: root rows, distinct texts, distinct urn digits
 *   (re-derived row by row);
 * - one line per root row: ids=, texts=, the classification (BOTH /
 *   IDS-ONLY / TEXTS-ONLY / EMPTY), what the CARD JOIN did with the
 *   row's text (card-linked ↔ <urn tail> / card-dropped (<cause>) /
 *   join-unlinked), and the junk-cause signal — cta-suspect names the
 *   text shape (the marker specs are byte-identical between CTA
 *   components and real posts, so the text is the only signal);
 *   shrink-suspect counts the $-refs the text walk dropped (missing
 *   targets, already-consumed rows, path misses); text lost names the
 *   empty-harvest case;
 * - the six-point probe summary: forward BFS from the commentary
 *   marker rows over the SAME $L-strict graph the join climbs,
 *   reverse BFS from the id rows over the same edges, the
 *   contentTrackingId grouping, the adjacency invariants (stream
 *   distance between marker and id rows), and the marker taxonomy
 *   (every viewTrackingSpecs shape) — regression instrumentation now
 *   (a forward-0 body is a body the join cannot link, not a missing
 *   feature);
 * - the verdict: the body's card tally (linked + dropped, the
 *   joinCards outcome counts) and the ids-only skip share.
 *
 * The cross-check suite pins this walk's tallies to the card-root
 * identity on the same bodies: every card joinCards finds must read
 * back from the census lines, and every census disposition must name
 * a card the join produced — drift fails a test instead of shipping
 * wrong evidence.
 *
 * Shape: the probe-linkedin idiom (design D2) — exported runReplay +
 * ReplayDeps (gate failures THROW, the caller owns the exit), one
 * tagged local gate (zero argv), entry-guarded main whose wrapper
 * prints the usage line bare and wraps every other failure as
 * `replay: FAILED — <message>` + exit 1.
 *
 * Usage: npx tsx scripts/replay-linkedin.ts <capture.json> [more.json ...]
 *   (captures roll off after ~20 sessions — one working day; copy captures/
 *   out first — CAPTURE_KEEP_SESSIONS, src/linkedin-capture.ts)
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CAPTURE_SCHEMA_VERSION, type CaptureRecord } from "../src/linkedin-capture.js";
import {
  type CardJoin,
  GRAPH_PATH_RE,
  GRAPH_WHOLE_RE,
  joinCards,
  parseFlightRows,
  URN_ANYWHERE_RE,
} from "../src/linkedin-parser.js";

/**
 * The usage line — the zero-argv gate's message, printed bare by the CLI
 * wrapper. Carries the retention window (CAPTURE_KEEP_SESSIONS,
 * src/linkedin-capture.ts): evidence rolls off after ~20 sessions — one
 * working day at the loop cadence — so replay promptly or copy captures/
 * out first (the operator-visible half of D8; a silent roll-off would
 * void the capture premise on D4's slower clock).
 */
const USAGE =
  "replay: usage — npx tsx scripts/replay-linkedin.ts <capture.json> [more.json ...]" +
  " — captures roll off after ~20 sessions (one working day); copy captures/ out first";

// --- the tagged zero-argv gate (the probeFloor idiom: name constant +
//     factory + guard), local to this file because only the replay
//     defines this failure mode ---

export const REPLAY_NO_INPUT = "ReplayNoInputError";

/** Thrown when runReplay receives no capture path. */
export interface ReplayNoInput extends Error {
  name: string;
}

export function replayNoInput(): ReplayNoInput {
  const error = new Error(USAGE) as ReplayNoInput;
  error.name = REPLAY_NO_INPUT;
  return error;
}

export function isReplayNoInput(error: unknown): error is ReplayNoInput {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === REPLAY_NO_INPUT
  );
}

/** $-refs the instrumented text walk dropped during one text harvest. */
interface TextDrops {
  /** Whole-ref to a row the stream never carried. */
  missing: number;
  /** Whole-ref to a row an earlier ref in THIS harvest already consumed. */
  seen: number;
  /** Path-ref that resolved to nothing (missing row or dead path). */
  pathMiss: number;
}

/** Per-root-row census facts — one row line of the replay table. */
export interface RowCensus {
  /** The flight row id (hex key). */
  hex: string;
  /** Stream position of the row. */
  index: number;
  /** Distinct urn digits in first-appearance order (the join's rule). */
  ids: string[];
  /** Commentary texts harvested (before the longest-wins pick). */
  textCount: number;
  /** The row's longest commentary text; null when none harvested. */
  bestText: string | null;
  /** Carries at least one commentary_text view marker (BFS start set). */
  hasMarker: boolean;
  /** Every viewTrackingSpecs shape seen in this row ("viewName/control"). */
  markerShapes: string[];
  /** What the card join did with this row's text; null when no text. */
  disposition: string | null;
  /** Junk-cause signal for the row's text; null when it looks clean. */
  cause: string | null;
}

/** The analysis of one capture body — the facts behind the printed lines. */
export interface BodyAnalysis {
  ordinal: number;
  rootRows: number;
  distinctTexts: number;
  distinctIds: number;
  rows: RowCensus[];
  /** Rows carrying at least one commentary marker. */
  markerRowCount: number;
  /** Rows carrying at least one id. */
  idRowCount: number;
  /** Distinct id rows reachable from the marker rows (forward BFS). */
  forwardReached: number;
  /** Distinct marker rows reachable from the id rows (reverse BFS). */
  reverseReached: number;
  /** contentTrackingId grouping: distinct values, largest group size. */
  tracking: { values: number; largest: number };
  /** marker→id stream distance histogram. */
  adjacency: { within1: number; at2: number; further: number };
  /** Marker taxonomy: shape → marker count, in stream order. */
  markerTally: Map<string, number>;
  /** Rows with ids but no text harvest (the skip share). */
  idsOnly: number;
  /** The body's card tally — joinCards outcomes (the verdict line reads it). */
  cards: { linked: number; dropped: number };
}

/** "viewName/legacyControlName" for one viewTrackingSpecs record; "-" for an absent name. */
function specShape(specs: Record<string, unknown>): string {
  const viewName = typeof specs.viewName === "string" ? specs.viewName : "-";
  const control = typeof specs.legacyControlName === "string" ? specs.legacyControlName : "-";
  return `${viewName}/${control}`;
}

/** The CTA text shapes from the census prior: bare URL, bare email, lone hashtag. */
function ctaShape(text: string): string | null {
  if (/^https?:\/\/\S+$/.test(text)) return "bare URL";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "bare email";
  if (/^#[A-Za-z0-9_-]+$/.test(text)) return "lone hashtag";
  return null;
}

/**
 * The junk-cause signal for one row (evidence, never a verdict).
 * CTA-suspect: the marker specs are byte-identical between CTA
 * components and real posts, so only the text shape can name Cause A.
 * Shrink-suspect / text lost: the $-refs the instrumented walk had to
 * drop name Cause B (the parser's silent branches).
 */
function junkCause(bestText: string | null, drops: TextDrops): string | null {
  const dropped = drops.missing + drops.seen + drops.pathMiss;
  if (bestText !== null) {
    const causes: string[] = [];
    const cta = ctaShape(bestText);
    if (cta !== null) causes.push(`cta-suspect (${cta})`);
    if (dropped > 0) causes.push(`shrink-suspect (${dropped} dropped $-ref(s))`);
    return causes.length > 0 ? causes.join(" + ") : null;
  }
  return dropped > 0 ? `lost (shrink: ${dropped} dropped $-ref(s))` : null;
}

/**
 * The parser's text walk (textFromChildren), copied rule for rule with
 * one addition: every silent drop site counts into `drops` — the whole-
 * ref to a missing row, the whole-ref to a row this harvest already
 * consumed, the path-ref that resolved to nothing. Those drops are
 * Cause B ($-ref shrink); the parser hides them, the replay names them.
 * The walk carries its OWN $L-optional reference forms ($-prefixed,
 * optional L — the historical text-walk shapes): the parser keeps its
 * text-walk forms module-private by design, and the GRAPH forms above
 * are the shared $L-strict edges (bare hex-ish data strings are never
 * references — the phantom-edge guard, fresh corpus 2026-11-14).
 */
const TEXT_WHOLE_REF_RE = /^\$L?([0-9a-f]+)$/;
const TEXT_PATH_REF_RE = /^\$L?([0-9a-f]+):(.+)$/;

function textFromChildrenInstrumented(
  children: unknown,
  rows: Map<string, unknown>,
  drops: TextDrops,
): string {
  const parts: string[] = [];
  const seenRows = new Set<string>();
  const memo = new Map<string, unknown>();
  const resolve = (id: string, path: string): unknown => {
    const root: unknown = rows.get(id);
    if (root === undefined) return undefined;
    const key = `${id}:${path}`;
    const cached: unknown = memo.get(key);
    if (cached !== undefined) return cached;
    let current: unknown = root;
    for (const segment of path.split(":")) {
      if (current === null || typeof current !== "object") return undefined;
      current = Array.isArray(current)
        ? current[Number(segment)]
        : (current as Record<string, unknown>)[segment];
      if (current === undefined) return undefined;
    }
    memo.set(key, current);
    return current;
  };
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      const whole = TEXT_WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (!rows.has(id)) {
          drops.missing += 1;
          return;
        }
        if (seenRows.has(id)) {
          drops.seen += 1;
          return;
        }
        seenRows.add(id);
        walk(rows.get(id));
        return;
      }
      const scoped = TEXT_PATH_REF_RE.exec(node);
      if (scoped !== null) {
        const resolved = resolve(scoped[1] ?? "", scoped[2] ?? "");
        if (resolved === undefined) drops.pathMiss += 1;
        walk(resolved);
        return;
      }
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 0 && node[0] === "$") {
        if (node[1] === "br") {
          parts.push("\n");
          return;
        }
        const props: unknown = node[3];
        if (props !== null && typeof props === "object" && !Array.isArray(props)) {
          const record = props as Record<string, unknown>;
          if (record.children !== undefined) walk(record.children);
          if (record.textProps !== undefined) walk(record.textProps);
        }
        return;
      }
      for (const child of node) walk(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.children !== undefined) walk(record.children);
  };
  walk(children);
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every $L-strict graph edge one row's subtree names (the join's own edge forms). */
function refTargets(payload: unknown, rows: Map<string, unknown>, into: Set<string>): void {
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const whole = GRAPH_WHOLE_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (rows.has(id)) into.add(id);
        return;
      }
      const scoped = GRAPH_PATH_RE.exec(node);
      if (scoped !== null) {
        const id: string = scoped[1] ?? "";
        if (rows.has(id)) into.add(id);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const value of Object.values(node as Record<string, unknown>)) visit(value);
  };
  visit(payload);
}

/** contentTrackingId values in one row's subtree (the shared list-level value). */
function collectTrackingIds(payload: unknown, into: Set<string>): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const value = record.contentTrackingId;
    if (typeof value === "string" && value.length > 0) into.add(value);
    for (const child of Object.values(record)) visit(child);
  };
  visit(payload);
}

/**
 * BFS over row-to-row ref edges; counts DISTINCT target-set rows newly
 * reached. Start rows sit in the visited set from the beginning, so a
 * start never counts as its own discovery.
 */
function reachableCount(
  starts: Set<string>,
  edges: Map<string, Set<string>>,
  targets: Set<string>,
): number {
  const visited = new Set(starts);
  const queue = [...starts];
  let hits = 0;
  while (queue.length > 0) {
    const hex = queue.shift();
    if (hex === undefined) break;
    for (const next of edges.get(hex) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      if (targets.has(next)) hits += 1;
      queue.push(next);
    }
  }
  return hits;
}

/**
 * The instrumented per-row walk: the join's row-level facts with the
 * drops counted and the shapes named. Urn STRINGS (share/ugcPost/
 * activity, embedded or standalone — the parser's URN_ANYWHERE_RE; the
 * deleted digit-field and urn-object-key rules ride with the zip they
 * served); a commentary_text marker harvests its text and RETURNS (its
 * subtree carries no ids); every other viewTrackingSpecs shape is
 * recorded for the taxonomy and recursed (the join ignores it silently).
 */
function collectRowCensus(
  hex: string,
  index: number,
  payload: unknown,
  rows: Map<string, unknown>,
  joinByText: Map<string, CardJoin>,
): RowCensus {
  const ids = new Set<string>();
  const rowTexts: string[] = [];
  const markerShapes: string[] = [];
  let hasMarker = false;
  const drops: TextDrops = { missing: 0, seen: 0, pathMiss: 0 };
  const seenRows = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const urn = URN_ANYWHERE_RE.exec(node);
      if (urn !== null) {
        const digits: string = urn[2] ?? "";
        if (digits.length > 0) ids.add(digits);
        return;
      }
      const whole = TEXT_WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id: string = whole[1] ?? "";
        if (rows.has(id) && !seenRows.has(id)) {
          seenRows.add(id);
          visit(rows.get(id));
        }
        return;
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const specs: unknown = record.viewTrackingSpecs;
    if (specs !== null && typeof specs === "object") {
      const specRecord = specs as Record<string, unknown>;
      markerShapes.push(specShape(specRecord));
      if (specRecord.legacyControlName === "commentary_text") {
        hasMarker = true;
        const text = textFromChildrenInstrumented(record.children, rows, drops);
        if (text.length > 0) rowTexts.push(text);
        return; // the commentary subtree is text; it carries no ids
      }
    }
    for (const key of Object.keys(record)) visit(record[key]);
  };
  visit(payload);
  const bestText =
    rowTexts.length > 0 ? rowTexts.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  let disposition: string | null = null;
  if (bestText !== null) {
    const card = joinByText.get(bestText);
    if (card === undefined) {
      disposition = "join-unlinked";
    } else if (card.outcome === "linked" && card.linkUrn !== null) {
      disposition = `card-linked ↔ ${card.linkUrn.slice(-6)}`;
    } else {
      disposition = `card-dropped (${card.outcome})`;
    }
  }
  return {
    hex,
    index,
    ids: [...ids],
    textCount: rowTexts.length,
    bestText,
    hasMarker,
    markerShapes,
    disposition,
    cause: junkCause(bestText, drops),
  };
}

/**
 * Analyze one capture body: the per-row census, the six-point probe
 * (forward + reverse BFS, contentTrackingId grouping, adjacency,
 * marker taxonomy), and the shipped join's card tally. Pure over the
 * record's body — joinCards is silent, so the only log lines are the
 * census block itself.
 */
export function analyzeBody(record: CaptureRecord): BodyAnalysis {
  const rows = parseFlightRows(record.body);
  const entries = [...rows.entries()];
  // The shipped join's own output: which card claimed which text (the
  // CardJoin record IS the decision — outcome carries the drop cause;
  // the tally feeds the verdict line). joinCards is silent — the one
  // req-9 log line belongs to the parser's mint path.
  const joinByText = new Map<string, CardJoin>();
  let linked = 0;
  let dropped = 0;
  for (const card of joinCards(record.body)) {
    if (card.outcome === "linked") linked += 1;
    else dropped += 1;
    if (card.text !== null) joinByText.set(card.text, card);
  }
  const rowsCensus = entries.map(([hex, payload], index) =>
    collectRowCensus(hex, index, payload, rows, joinByText),
  );
  const distinctIds = new Set<string>();
  const distinctTexts = new Set<string>();
  const markerTally = new Map<string, number>();
  let markerRowCount = 0;
  let idRowCount = 0;
  let idsOnly = 0;
  for (const row of rowsCensus) {
    for (const id of row.ids) distinctIds.add(id);
    if (row.bestText !== null) distinctTexts.add(row.bestText);
    if (row.ids.length > 0) idRowCount += 1;
    if (row.ids.length > 0 && row.textCount === 0) idsOnly += 1;
    if (!row.hasMarker) continue;
    markerRowCount += 1;
    for (const shape of row.markerShapes) {
      markerTally.set(shape, (markerTally.get(shape) ?? 0) + 1);
    }
  }
  const markerHexes = new Set(rowsCensus.filter((row) => row.hasMarker).map((row) => row.hex));
  const idHexes = new Set(rowsCensus.filter((row) => row.ids.length > 0).map((row) => row.hex));
  // Six-point probe, arms 1-2: the $-ref graph in both directions over
  // the SAME $L-strict edges the join climbs. A hit in either arm is
  // regression evidence the graph still carries the join; zero in both
  // is a body the join cannot link, not a missing feature.
  const refs = new Map<string, Set<string>>();
  for (const [hex, payload] of entries) {
    const targets = new Set<string>();
    refTargets(payload, rows, targets);
    refs.set(hex, targets);
  }
  const forwardReached = reachableCount(markerHexes, refs, idHexes);
  const reverse = new Map<string, Set<string>>();
  for (const [hex, targets] of refs) {
    for (const target of targets) {
      const sources = reverse.get(target) ?? new Set<string>();
      sources.add(hex);
      reverse.set(target, sources);
    }
  }
  const reverseReached = reachableCount(idHexes, reverse, markerHexes);
  // Arm 3 — contentTrackingId grouping (the shared list-level value).
  const trackingCounts = new Map<string, number>();
  for (const [, payload] of entries) {
    const values = new Set<string>();
    collectTrackingIds(payload, values);
    for (const value of values) {
      trackingCounts.set(value, (trackingCounts.get(value) ?? 0) + 1);
    }
  }
  const tracking = {
    values: trackingCounts.size,
    largest: trackingCounts.size > 0 ? Math.max(...trackingCounts.values()) : 0,
  };
  // Arm 4 — adjacency: stream distance from every marker row to the
  // nearest id row (the split-card capture shape sits at distance 1).
  const adjacency = { within1: 0, at2: 0, further: 0 };
  for (const marker of rowsCensus) {
    if (!marker.hasMarker) continue;
    let nearest = Number.POSITIVE_INFINITY;
    for (const row of rowsCensus) {
      if (row.ids.length === 0) continue;
      nearest = Math.min(nearest, Math.abs(row.index - marker.index));
    }
    if (nearest <= 1) adjacency.within1 += 1;
    else if (nearest === 2) adjacency.at2 += 1;
    else adjacency.further += 1;
  }
  return {
    ordinal: record.ordinal,
    rootRows: rowsCensus.length,
    distinctTexts: distinctTexts.size,
    distinctIds: distinctIds.size,
    rows: rowsCensus,
    markerRowCount,
    idRowCount,
    forwardReached,
    reverseReached,
    tracking,
    adjacency,
    markerTally,
    idsOnly,
    cards: { linked, dropped },
  };
}

function rowClassification(row: RowCensus): string {
  if (row.ids.length > 0 && row.textCount > 0) return "BOTH";
  if (row.ids.length > 0) return "IDS-ONLY";
  if (row.textCount > 0) return "TEXTS-ONLY";
  return "EMPTY";
}

function rowLine(row: RowCensus): string {
  let note: string;
  if (row.disposition !== null) {
    note = ` (${row.disposition})`;
  } else if (row.ids.length > 0) {
    note = " (no text harvest)";
  } else {
    note = " (empty row)";
  }
  const cause = row.cause === null ? "" : ` — text ${row.cause}`;
  return `replay: row ${row.hex} — ids=${row.ids.length} texts=${row.textCount} — ${rowClassification(row)}${note}${cause}`;
}

function probeLine(analysis: BodyAnalysis): string {
  return (
    `replay: probe — forwardBFS from ${analysis.markerRowCount} marker row(s): ` +
    `${analysis.forwardReached} id row(s) reached; reverse from ${analysis.idRowCount} id row(s): ` +
    `${analysis.reverseReached} marker row(s) reached`
  );
}

function trackingLine(analysis: BodyAnalysis): string {
  if (analysis.tracking.values === 0) return "replay: tracking — no contentTrackingId found";
  const listLevel =
    analysis.tracking.values === 1 && analysis.tracking.largest === analysis.rootRows;
  const suffix = listLevel ? " (list-level)" : "";
  return (
    `replay: tracking — ${analysis.tracking.values} value(s); ` +
    `largest group ${analysis.tracking.largest} of ${analysis.rootRows} row(s)${suffix}`
  );
}

function markersLine(analysis: BodyAnalysis): string {
  if (analysis.markerTally.size === 0) return "replay: markers — none";
  const parts = [...analysis.markerTally.entries()].map(([shape, count]) => `${shape}: ${count}`);
  return `replay: markers — ${parts.join(", ")}`;
}

function verdictLine(analysis: BodyAnalysis): string {
  return (
    `replay: verdict — ${analysis.cards.linked} card(s) linked, ${analysis.cards.dropped} dropped ` +
    `(forward ${analysis.forwardReached}, reverse ${analysis.reverseReached}); ` +
    `${analysis.idsOnly}/${analysis.rootRows} row(s) ids-only`
  );
}

/** Print one body's evidence block — every line under the `replay:` prefix. */
export function printBodyAnalysis(analysis: BodyAnalysis): void {
  console.log(
    `replay: body ${analysis.ordinal} — ${analysis.rootRows} root row(s), ${analysis.distinctTexts} distinct text(s), ${analysis.distinctIds} distinct id(s)`,
  );
  for (const row of analysis.rows) console.log(rowLine(row));
  console.log(probeLine(analysis));
  console.log(trackingLine(analysis));
  console.log(
    `replay: adjacency — marker→id distance within 1: ${analysis.adjacency.within1}, at 2: ${analysis.adjacency.at2}, further: ${analysis.adjacency.further}`,
  );
  console.log(markersLine(analysis));
  console.log(verdictLine(analysis));
}

function isCaptureRecord(value: unknown): value is CaptureRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<CaptureRecord>;
  return (
    typeof record.schemaVersion === "number" &&
    typeof record.capturedAt === "string" &&
    typeof record.label === "string" &&
    typeof record.ordinal === "number" &&
    typeof record.received === "number" &&
    typeof record.url === "string" &&
    typeof record.status === "number" &&
    typeof record.matched === "boolean" &&
    typeof record.body === "string"
  );
}

/** Read + validate one capture file. Every failure THROWS — the wrapper wraps it as FAILED. */
async function readCapture(
  path: string,
  readText: (path: string) => Promise<string>,
): Promise<CaptureRecord> {
  const parsed: unknown = JSON.parse(await readText(path));
  if (!isCaptureRecord(parsed)) {
    throw new Error(
      `replay: ${path} — not a CaptureRecord envelope (schemaVersion/capturedAt/label/ordinal/received/url/status/matched/body)`,
    );
  }
  if (parsed.schemaVersion !== CAPTURE_SCHEMA_VERSION) {
    throw new Error(
      `replay: ${path} — capture schemaVersion ${String(parsed.schemaVersion)}, this replay reads version ${CAPTURE_SCHEMA_VERSION}`,
    );
  }
  return parsed;
}

export interface ReplayDeps {
  /** Capture file paths to replay, in input order. Default: process.argv.slice(2). */
  argv?: readonly string[];
  /** Reads one capture file. Default: readFile(path, "utf8"). */
  readText?: (path: string) => Promise<string>;
}

export interface ReplayResult {
  /** One analysis per input file, in input order. */
  reports: BodyAnalysis[];
}

/**
 * Run the replay over one or more capture files: read, validate,
 * analyze, print each body's evidence block, and resolve with the
 * per-body analyses. Gate failures THROW (the fetchTick model): the
 * zero-argv gate is tagged, every read/parse/shape failure keeps its
 * own message for the FAILED wrapper.
 */
export async function runReplay(deps: ReplayDeps = {}): Promise<ReplayResult> {
  const argv = deps.argv ?? process.argv.slice(2);
  if (argv.length === 0) throw replayNoInput();
  const readText = deps.readText ?? (async (path: string) => readFile(path, "utf8"));
  const reports: BodyAnalysis[] = [];
  for (const path of argv) {
    const analysis = analyzeBody(await readCapture(path, readText));
    printBodyAnalysis(analysis);
    reports.push(analysis);
  }
  return { reports };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The CLI contract: the usage line bare on zero argv, every other
  // failure wrapped as `replay: FAILED — <message>`, exit 1 either way.
  runReplay().catch((error: unknown) => {
    if (isReplayNoInput(error)) {
      console.error(error.message);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`replay: FAILED — ${message}`);
    process.exit(1);
  });
}
```

### tests/linkedin-parser.test.ts — MODIFY (rewrite)

Zip-era pins (pairing 3/3, four mismatch-warn pins, oracle-line shape) die; join pins land: split-card join via $-ref, merged card, chip longest-wins, share-typed permalink, 0-urn/2-urn/dead-id/no-text drop+count, stream-order mints, same-text-two-cards mint both, one req-9 log line shape, payload round-trip with a share-typed permalink.

```ts
/**
 * Offline suite for the LinkedIn Flight parser core (the card join,
 * design 2026-11-14, amended: $L-strict graph edges, seeds-only climb,
 * closure text harvest): split-card climbs through interactionTypes-style
 * $-refs, share/ugcPost permalink types, the drop-and-count classes,
 * stream-order mints, and the one req-9 log line. Synthetic bodies carry
 * the join the way the live stream does — the marker row $-refs the id
 * row, and id rows carry urn STRINGS (scan9's measured form; the deleted
 * digit-field rule fed only the zip). Capture-fixture-driven cases land
 * with tests/fixture/ (Slice 2); ids mint with the (BigInt(ms) << 22n)
 * forward trick so BigInt(id) >> 22n recovers the pinned epochs exactly.
 * Importing the module under test never loads Playwright.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type CardJoin,
  LINKEDIN_RESPONSE_RE,
  buildContentSearchUrl,
  collectLinkedInPosts,
  joinCards,
  parseFlightRows,
} from "../src/linkedin-parser.js";
import { readPayloadPosts, writePayloadAtomic } from "../src/linkedin-payload.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Capture-verified ids: BigInt(ms) << 22n — the forward trick (the exact clock inverse). */
const BASE_MS = Date.UTC(2026, 11, 13, 4, 0, 0);
const idAt = (n: number): string => (BigInt(BASE_MS + n * 60_000) << 22n).toString();

/** The share/ugcPost id is a DIFFERENT number from the activity id (research 2026-10-31). */
const shareFor = (activityId: string): string => (BigInt(activityId) - 1n).toString();

/** One flight line. */
const row = (hex: string, payload: unknown): string => `${hex}:${JSON.stringify(payload)}`;

const markerEl = (children: unknown[], extra: Record<string, unknown> = {}): unknown => [
  "$",
  "$Lmark",
  null,
  {
    viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
    children: ["$", "$Ldiv", null, { textProps: { children } }],
    ...extra,
  },
];

/** The id row carries the urn STRING — the join reads strings, never digit fields. */
const idRow = (activityId: string): unknown => ({
  tracking: { activityUrn: { urn: `urn:li:activity:${activityId}` } },
});

const idRowWithShare = (activityId: string): unknown => ({
  tracking: {
    activityUrn: { urn: `urn:li:activity:${activityId}` },
    shareUrn: `urn:li:share:${shareFor(activityId)}`,
  },
});

/**
 * The live split-card shape: the id row precedes the marker row, whose
 * interactionTypes $-refs it (JOIN_BODY, capture-verified).
 */
const joinCardBody = (firstHex: number, activityId: string, text: string): string =>
  [
    row(String(firstHex), idRow(activityId)),
    row(String(firstHex + 1), {
      commentary: markerEl([text], { interactionTypes: `$${firstHex}` }),
    }),
  ].join("\n");

describe("buildContentSearchUrl", () => {
  it("reproduces the 2026-11-11 live search URL byte-for-byte (origin, date_posted sort, past-24h)", () => {
    assert.equal(
      buildContentSearchUrl("hiring indonesia"),
      "https://www.linkedin.com/search/results/content/?keywords=hiring%20indonesia&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D",
    );
  });

  it("encodes a # keyword at the query layer — a raw # would truncate the GET query", () => {
    assert.equal(
      buildContentSearchUrl("#hiring react"),
      "https://www.linkedin.com/search/results/content/?keywords=%23hiring%20react&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-24h%22%5D",
    );
  });
});

describe("LINKEDIN_RESPONSE_RE", () => {
  it("matches the initial content-search response URL", () => {
    assert.ok(
      LINKEDIN_RESPONSE_RE.test(
        "https://www.linkedin.com/flagship-web/search/results/content/?keywords=x",
      ),
    );
  });

  it("matches the Load-more pagination action response URL", () => {
    assert.ok(
      LINKEDIN_RESPONSE_RE.test(
        "https://www.linkedin.com/flagship-web/rsc-action/actions/pagination",
      ),
    );
  });

  it("rejects unrelated responses — the walk's body filter must never fire on a Threads response", () => {
    assert.equal(LINKEDIN_RESPONSE_RE.test("https://www.threads.com/api/graphql"), false);
    assert.equal(
      LINKEDIN_RESPONSE_RE.test("https://www.linkedin.com/voyager/api/search/blended"),
      false,
    );
  });
});

describe("parseFlightRows", () => {
  it("parses data rows in stream order and skips module-manifest rows and garbage lines", () => {
    const rows = parseFlightRows(
      ['0:I["$1",[],"default"]', row("1", { a: 1 }), row("2", [1, 2])].join("\n"),
    );
    assert.deepEqual([...rows.keys()], ["1", "2"]);
    assert.deepEqual(rows.get("1"), { a: 1 });
  });
});

describe("joinCards", () => {
  it("joins a split card: the marker row is the root (the id row's span holds zero markers) and forward refs decide the urns", () => {
    const cards = joinCards(joinCardBody(10, idAt(1), "first posting — Jakarta"));
    assert.equal(cards.length, 1);
    const card = cards[0] as CardJoin;
    assert.equal(card.marker, "11");
    assert.equal(card.root, "11");
    assert.equal(card.outcome, "linked");
    assert.equal(card.activityId, idAt(1));
    assert.deepEqual(card.urns, [`urn:li:activity:${idAt(1)}`]);
    assert.equal(card.linkUrn, `urn:li:activity:${idAt(1)}`);
  });

  it("keeps the permalink the card's own share urn (FRD req 5 — the type resolves, the activity urn does not)", () => {
    const body = [
      row("1", idRowWithShare(idAt(2))),
      row("2", { commentary: markerEl(["second posting — Bandung"], { interactionTypes: "$1" }) }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.linkUrn, `urn:li:share:${shareFor(idAt(2))}`);
    assert.equal(cards[0]?.activityId, idAt(2));
  });

  it("collects a urn embedded inside a longer string (the unanchored collection form, scan9-measured)", () => {
    const body = [
      row("1", {
        tracking: {
          activityUrn: { urn: `urn:li:activity:${idAt(3)}` },
          clickUrl: `https://www.linkedin.com/feed/update/urn:li:share:${shareFor(idAt(3))}/`,
        },
      }),
      row("2", { commentary: markerEl(["third — embedded"], { interactionTypes: "$1" }) }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.linkUrn, `urn:li:share:${shareFor(idAt(3))}`);
    assert.deepEqual(cards[0]?.urns, [
      `urn:li:activity:${idAt(3)}`,
      `urn:li:share:${shareFor(idAt(3))}`,
    ]);
  });

  it("climbs past the card's own nested marker to the one-seed container and harvests the closure's longest text (005 image-card shape)", () => {
    const body = [
      row("1", idRowWithShare(idAt(4))),
      row("2", idRow(idAt(4))),
      row("5", { card: { body: "$10", share: "$1", tracking: "$2" } }),
      row("10", {
        commentary: markerEl([], { interactionTypes: "$11" }),
      }),
      row("11", { commentary: markerEl(["https://lnkd.in/gcrX7sNZ"]) }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    const card = cards[0] as CardJoin;
    assert.equal(card.marker, "10"); // the seed — 11 is nested (10 refs it)
    assert.equal(card.root, "5"); // the climb lands on the one-seed container
    assert.equal(card.outcome, "linked");
    assert.equal(card.activityId, idAt(4));
    assert.equal(card.linkUrn, `urn:li:share:${shareFor(idAt(4))}`);
    assert.equal(card.text, "https://lnkd.in/gcrX7sNZ"); // the nested row's text
  });

  it("never merges two sibling seeds sharing one container — each card mints its own id", () => {
    const body = [
      row("1", idRow(idAt(7))),
      row("2", idRow(idAt(8))),
      row("5", { feed: ["$10", "$20"] }),
      row("10", { commentary: markerEl(["first sibling"], { id: "$1" }) }),
      row("20", { commentary: markerEl(["second sibling"], { id: "$2" }) }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 2);
    assert.deepEqual(
      cards.map((card) => card.activityId),
      [idAt(7), idAt(8)],
    );
    assert.deepEqual(
      cards.map((card) => card.root),
      ["10", "20"], // the climb never enters 5 — its span holds two seeds
    );
  });

  it("a bare hex-ish data string is never a graph reference — a phantom edge cannot nest-kill a seed or pollute its urns", () => {
    const body = [
      row("1", idRow(idAt(5))),
      row("24", idRow(idAt(6))), // the would-be phantom target: a FOREIGN id row
      row("5", { card: "$10" }),
      row("10", {
        commentary: markerEl(["real post — phantom bait"], { bait: "24" }),
      }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    const card = cards[0] as CardJoin;
    assert.equal(card.marker, "10");
    assert.equal(card.root, "5");
    assert.equal(card.outcome, "linked");
    assert.equal(card.activityId, idAt(5)); // never idAt(6) — row 24 is unreachable
    assert.deepEqual(card.urns, [`urn:li:activity:${idAt(5)}`]);
  });

  it("keeps a chip row ONE card with the row's longest commentary text", () => {
    const body = [
      row("10", idRow(idAt(5))),
      row("11", {
        commentary: [
          markerEl(["third posting, long form — Surabaya"], { interactionTypes: "$10" }),
          markerEl(["#hiring"]),
        ],
      }),
    ].join("\n");
    const cards = joinCards(body);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.text, "third posting, long form — Surabaya");
    assert.equal(cards[0]?.outcome, "linked");
  });

  it("drops and classifies every edge card: no-urn, multi-urn, dead-id, no-text (FRD reqs 6/7)", () => {
    const body = [
      joinCardBody(10, idAt(6), "ok card"),
      row("20", { commentary: markerEl(["no urn anywhere"]) }),
      row("30", { commentary: markerEl(["two urns"], { a: "$31", b: "$32" }) }),
      row("31", idRow(idAt(7))),
      row("32", idRow(idAt(8))),
      row("40", idRow("0000000001")),
      row("41", { commentary: markerEl(["bad clock"], { interactionTypes: "$40" }) }),
      row("50", { commentary: markerEl([["$", "br", "0", {}]]) }),
    ].join("\n");
    assert.deepEqual(
      joinCards(body).map((card) => card.outcome),
      ["linked", "no-urn", "multi-urn", "dead-id", "no-text"],
    );
  });
});

describe("collectLinkedInPosts", () => {
  it("mints in marker-row stream order, not clock order (FRD req 8 — no sort), with id-derived timestamps", () => {
    const later = idAt(9);
    const earlier = idAt(8);
    const body = [
      [
        row("10", idRowWithShare(later)),
        row("11", { commentary: markerEl(["stream-first"], { interactionTypes: "$10" }) }),
      ].join("\n"),
      joinCardBody(20, earlier, "stream-second"),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(posts, [
      {
        platform: "linkedin",
        id: `urn:li:activity:${later}`,
        text: "stream-first",
        author: "linkedin-member",
        permalink: `https://www.linkedin.com/feed/update/urn:li:share:${shareFor(later)}`,
        timestamp: new Date(BASE_MS + 9 * 60_000).toISOString(),
      },
      {
        platform: "linkedin",
        id: `urn:li:activity:${earlier}`,
        text: "stream-second",
        author: "linkedin-member",
        permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${earlier}`,
        timestamp: new Date(BASE_MS + 8 * 60_000).toISOString(),
      },
    ]);
  });

  it("counts drops on the ONE req-9 log line, naming each minted id tail and text head", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const body = [
      joinCardBody(10, idAt(6), "ok card"),
      row("20", { commentary: markerEl(["no urn anywhere"]) }),
      row("30", { commentary: markerEl(["two urns"], { a: "$31", b: "$32" }) }),
      row("31", idRow(idAt(7))),
      row("32", idRow(idAt(8))),
      row("40", idRow("0000000001")),
      row("41", { commentary: markerEl(["bad clock"], { interactionTypes: "$40" }) }),
      row("50", { commentary: markerEl([["$", "br", "0", {}]]) }),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.equal(posts.length, 1);
    assert.equal(logs.mock.callCount(), 1);
    const line = String(logs.mock.calls[0]?.arguments[0] ?? "");
    assert.match(
      line,
      /^linkedin-parser: 1 card\(s\) linked, 4 dropped \(1 no-urn, 1 multi-urn, 1 dead-id, 1 no-text\) — /,
    );
    assert.ok(line.includes(`${idAt(6).slice(-6)}↔"ok card"`), line);
  });

  it("mints two cards sharing one text — the global text dedupe is gone (fetch dedupes by urn)", () => {
    const body = [
      joinCardBody(10, idAt(10), "same words"),
      joinCardBody(20, idAt(11), "same words"),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.equal(posts.length, 2);
    assert.deepEqual(
      posts.map((post) => post.id),
      [`urn:li:activity:${idAt(10)}`, `urn:li:activity:${idAt(11)}`],
    );
  });

  it("skips module-manifest rows and garbage lines around the cards", () => {
    const body = [
      '0:I["$1",[],"default"]',
      "not-a-flight-line",
      joinCardBody(10, idAt(12), "clean card"),
    ].join("\n");
    const posts = collectLinkedInPosts(body);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.text, "clean card");
  });

  it("logs the 0/0 line on a body with no marker rows", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = collectLinkedInPosts(row("1", { unrelated: true }));
    assert.deepEqual(posts, []);
    assert.equal(logs.mock.callCount(), 1);
    assert.match(
      String(logs.mock.calls[0]?.arguments[0] ?? ""),
      /^linkedin-parser: 0 card\(s\) linked, 0 dropped \(0 no-urn, 0 multi-urn, 0 dead-id, 0 no-text\)/,
    );
  });
});

describe("payload round-trip", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("a share-typed permalink passes payload admission (leg ok, zero drops)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-parser-"));
    const path = join(dir, "linkedin-posts.json");
    const NOW = Date.UTC(2026, 11, 13, 8, 0, 0);
    const body = [
      row("1", idRowWithShare(idAt(13))),
      row("2", { commentary: markerEl(["share-typed round trip"], { interactionTypes: "$1" }) }),
    ].join("\n");
    const minted = collectLinkedInPosts(body);
    assert.equal(minted.length, 1);
    await writePayloadAtomic(minted, path, () => NOW);
    const read = await readPayloadPosts(path, () => NOW + 60_000);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, minted);
    assert.equal(warns.mock.callCount(), 0);
  });
});

describe("capture fixtures (real-trimmed, session 20261114T055257Z)", () => {
  const loadFixture = (name: string): string =>
    readFileSync(join(here, "fixture", name), "utf8");

  it("multicard body: two cards mint their own ids in marker stream order (no global consolidation)", () => {
    const posts = collectLinkedInPosts(loadFixture("linkedin-multicard-body.txt"));
    assert.equal(posts.length, 2);
    assert.deepEqual(
      posts.map((post) => post.id),
      [
        "urn:li:activity:7527236651333419008",
        "urn:li:activity:7527242172845154304",
      ],
    );
    assert.match(posts[0]?.text ?? "", /^Hiring at volume\? Our RPO model/);
    assert.match(posts[1]?.text ?? "", /^HIRING: Car-Mounted 360°/);
  });

  it("multicard body: the ONE req-9 log line names both minted id tails", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    collectLinkedInPosts(loadFixture("linkedin-multicard-body.txt"));
    assert.equal(logs.mock.callCount(), 1);
    const line = String(logs.mock.calls[0]?.arguments[0] ?? "");
    assert.match(line, /^linkedin-parser: 2 card\(s\) linked, 0 dropped \(0 no-urn, 0 multi-urn, 0 dead-id, 0 no-text\)/);
    assert.ok(line.includes('419008↔"Hiring at volume? Our RPO"'), line);
    assert.ok(line.includes('154304↔"HIRING: Car-Mounted 360°"'), line);
  });

  it("share card: the permalink keeps the card's own share urn (FR5) while the id stays the activity urn (FR4)", () => {
    const posts = collectLinkedInPosts(loadFixture("linkedin-share-card-body.txt"));
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.id, "urn:li:activity:7527236651333419008");
    assert.equal(posts[0]?.permalink, "https://www.linkedin.com/feed/update/urn:li:share:7527236650461134849");
    assert.equal(posts[0]?.timestamp, new Date(Number(BigInt("7527236651333419008") >> 22n)).toISOString());
  });

  it("share card, 0-urn mutation: the card drops and counts (FR6)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const body = loadFixture("linkedin-share-card-body.txt").replaceAll("urn:li:", "urn:xx:");
    const posts = collectLinkedInPosts(body);
    assert.deepEqual(posts, []);
    const line = String(logs.mock.calls[0]?.arguments[0] ?? "");
    assert.match(line, /^linkedin-parser: 0 card\(s\) linked, 1 dropped \(1 no-urn, 0 multi-urn, 0 dead-id, 0 no-text\)/);
  });

  it("image card: the seed's own harvest is empty — the text rides the nested marker (closure harvest); the climb passes it (seeds-only span)", () => {
    const posts = collectLinkedInPosts(loadFixture("linkedin-joinref-card-body.txt"));
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.text, "https://lnkd.in/gcrX7sNZ");
    assert.equal(posts[0]?.id, "urn:li:activity:7527241854124249088");
    assert.equal(posts[0]?.permalink, "https://www.linkedin.com/feed/update/urn:li:share:7527126866378375168");
  });
});
```

### tests/replay-linkedin.test.ts — MODIFY (rewrite)

Synthetic bodies re-shaped to the join (every card carries the $-ref join); expected census lines re-pinned; the cross-check asserts the card identity; the six-point probe arms stay (they measure the graph, not the pairing).

```ts
/**
 * Offline suite for scripts/replay-linkedin.ts (Slice 3, the replay
 * harness on the card join): the entry-guard import pin, the zero-argv
 * gate, the envelope gates, and the analysis pins — per-row census
 * lines, the card-linked/card-dropped dispositions, the junk causes
 * (CTA shape vs $-ref shrink), the six-point probe arms, and the
 * verdict — against synthetic captures built the way the shipped join
 * reads them: every card carries the $-ref join and urn STRINGS
 * (tests/linkedin-parser.test.ts shapes). Cross-check: this suite
 * pins the replay's tallies to the card-root identity on the same
 * bodies — every card joinCards finds reads back from the census
 * lines, and every census disposition names a card the join produced.
 * Files live in OS temp only (mkdtemp + one after) — the repo tree is
 * never touched.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, after, describe, it } from "node:test";
import {
  type BodyAnalysis,
  REPLAY_NO_INPUT,
  isReplayNoInput,
  runReplay,
} from "../scripts/replay-linkedin.js";
import { CAPTURE_SCHEMA_VERSION, type CaptureRecord } from "../src/linkedin-capture.js";
import { joinCards } from "../src/linkedin-parser.js";

const NOW = Date.UTC(2026, 11, 13, 5, 0, 0);

/** Capture-shaped ids: BigInt(epochMs) << 22n — the parser fixtures' forward trick. */
const BASE_MS = Date.UTC(2026, 11, 13, 4, 0, 0);
const idAt = (n: number): string => (BigInt(BASE_MS + n * 60_000) << 22n).toString();

/** One flight line. */
const row = (id: string, payload: unknown): string => `${id}:${JSON.stringify(payload)}`;

/** The commentary_text marker element (the parser fixture's shape; extra rides interactionTypes-style props). */
const marker = (children: unknown[], extra: Record<string, unknown> = {}): unknown => [
  "$",
  "$Lmark",
  null,
  {
    viewTrackingSpecs: { viewName: "feed-commentary", legacyControlName: "commentary_text" },
    children: ["$", "$Ldiv", null, { textProps: { children } }],
    ...extra,
  },
];

/** The bare id row carries the urn STRING — the join reads strings, never digit fields. */
const idRow = (id: string): unknown => ({
  tracking: { activityUrn: { urn: `urn:li:activity:${id}` } },
});

/** A card the way the live stream splits it: the id row, then the marker row $-ref'ing it. */
const splitCard = (n: number, id: string, text: string): string =>
  [
    row(String(n), idRow(id)),
    row(String(n + 1), marker([text], { interactionTypes: `$${n}` })),
  ].join("\n");

/** A card merged into ONE root row — ids+text in the same row, the BOTH shape. */
const mergedCard = (n: number, id: string, text: string): string =>
  row(String(n), {
    tracking: { activityUrn: { urn: `urn:li:activity:${id}` } },
    commentary: marker([text]),
  });

/**
 * The mixed census body: manifest + garbage (skipped), a merged BOTH
 * card, a split card (the marker row $-refs its id row), a chip BOTH
 * row (textCount 2 — the longest text wins), and a bare id row.
 */
const MIXED_BODY = [
  '0:I["$1",[],"default"]',
  "not-a-flight-line",
  mergedCard(10, idAt(1), "first posting — Jakarta"),
  splitCard(20, idAt(2), "second posting — Bandung"),
  row("30", {
    tracking: { activityUrn: { urn: `urn:li:activity:${idAt(3)}` } },
    commentary: [marker(["third posting, long form — Surabaya"]), marker(["#hiring"])],
  }),
  row("40", idRow(idAt(4))),
].join("\n");

/** A marker row whose subtree $-refs an id row OUTSIDE the text (the interactionTypes join). */
const JOIN_BODY = [
  row("1", {
    commentary: [marker(["join target text"], { interactionTypes: "$2" })],
  }),
  row("2", idRow(idAt(9))),
].join("\n");

/** One row whose text survives beside a dropped path-ref; one row whose ONLY content is a dead path-ref. */
const SHRINK_BODY = [
  row("1", { commentary: marker(["kept words — ", "$9:textProps:children"]) }),
  row("2", { commentary: marker(["$8:textProps:children"]) }),
].join("\n");

/** A BOTH row whose harvested text is a bare URL — the census prior's CTA junk shape. */
const CTA_BODY = mergedCard(10, idAt(6), "https://example.com/jobs");

/** A commentary marker beside a non-commentary viewTrackingSpecs shape — the taxonomy pair. */
const TAX_BODY = [
  row("1", {
    commentary: marker(["text one"]),
    singular: [
      "$",
      "$Ls",
      null,
      { viewTrackingSpecs: { viewName: "feed-singular", legacyControlName: "singular_component" } },
    ],
  }),
  row("2", idRow(idAt(5))),
].join("\n");

/** Two rows share one contentTrackingId value; a third carries its own. */
const TRACK_BODY = [
  row("1", { contentTrackingId: "t1", commentary: marker(["one"]) }),
  row("2", { contentTrackingId: "t1", tracking: { activityUrn: { urn: `urn:li:activity:${idAt(7)}` } } }),
  row("3", { contentTrackingId: "t2" }),
].join("\n");

/** Every row carries the SAME contentTrackingId value — the list-level shape. */
const LIST_BODY = [
  row("1", { contentTrackingId: "t1", commentary: marker(["one"]) }),
  row("2", { contentTrackingId: "t1" }),
].join("\n");

const capture = (body: string, overrides: Partial<CaptureRecord> = {}): CaptureRecord => ({
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  capturedAt: new Date(NOW).toISOString(),
  label: "linkedin/#hiring indonesia",
  ordinal: 7,
  received: 2,
  url: "https://www.linkedin.com/flagship-web/search/results/content/?keywords=%23hiring",
  status: 200,
  matched: true,
  body,
  ...overrides,
});

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

let seq = 0;

/** Write one synthetic capture to OS temp and replay it; returns the analysis. */
async function replayBody(
  body: string,
  overrides: Partial<CaptureRecord> = {},
): Promise<BodyAnalysis> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
  seq += 1;
  const path = join(dir, `capture-${seq}.json`);
  await writeFile(path, `${JSON.stringify(capture(body, overrides))}\n`, "utf8");
  const { reports } = await runReplay({ argv: [path] });
  const first = reports[0];
  assert.ok(first);
  return first;
}

/** Replay one body under a call-through log spy; returns the stable-prefix lines only. */
async function replayLines(
  t: TestContext,
  body: string,
  overrides: Partial<CaptureRecord> = {},
): Promise<string[]> {
  const logs = t.mock.method(console, "log", console.log.bind(console));
  await replayBody(body, overrides);
  return logs.mock.calls
    .map((call) => String(call.arguments[0]))
    .filter((line) => line.startsWith("replay:"));
}

describe("entry guard", () => {
  it("importing the module stays side-effect free (no reads, no replay)", () => {
    assert.equal(typeof runReplay, "function");
  });
});

describe("runReplay gates", () => {
  it("throws the tagged zero-argv gate carrying the usage line", async () => {
    await assert.rejects(
      () => runReplay({ argv: [] }),
      (error: unknown) => {
        assert.equal(isReplayNoInput(error), true);
        assert.equal((error as { name?: unknown }).name, REPLAY_NO_INPUT);
        assert.match(
          (error as Error).message,
          /^replay: usage — npx tsx scripts\/replay-linkedin\.ts/,
        );
        return true;
      },
    );
  });

  it("rejects an unreadable path with the raw fs error (the wrapper wraps it as FAILED)", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
    const path = join(dir, "absent.json");
    await assert.rejects(() => runReplay({ argv: [path] }), /ENOENT/);
  });

  it("rejects a JSON file that is not a CaptureRecord envelope, naming the path", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
    const path = join(dir, "not-a-record.json");
    await writeFile(path, '{"hello": 1}\n', "utf8");
    await assert.rejects(() => runReplay({ argv: [path] }), /not a CaptureRecord envelope/);
  });

  it("rejects an unsupported capture schemaVersion, naming both versions", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
    const path = join(dir, "old-schema.json");
    const stale = { ...capture("1:skipped"), schemaVersion: 99 };
    await writeFile(path, `${JSON.stringify(stale)}\n`, "utf8");
    await assert.rejects(
      () => runReplay({ argv: [path] }),
      /capture schemaVersion 99, this replay reads version 1/,
    );
  });
});

describe("per-row census", () => {
  it("prints the mixed-body census: BOTH/IDS-ONLY/TEXTS-ONLY rows, card dispositions, verdict", async (t) => {
    const lines = await replayLines(t, MIXED_BODY);
    assert.deepEqual(lines, [
      "replay: body 7 — 5 root row(s), 3 distinct text(s), 4 distinct id(s)",
      `replay: row 10 — ids=1 texts=1 — BOTH (card-linked ↔ ${idAt(1).slice(-6)})`,
      "replay: row 20 — ids=1 texts=0 — IDS-ONLY (no text harvest)",
      `replay: row 21 — ids=0 texts=1 — TEXTS-ONLY (card-linked ↔ ${idAt(2).slice(-6)})`,
      `replay: row 30 — ids=1 texts=2 — BOTH (card-linked ↔ ${idAt(3).slice(-6)})`,
      "replay: row 40 — ids=1 texts=0 — IDS-ONLY (no text harvest)",
      "replay: probe — forwardBFS from 3 marker row(s): 1 id row(s) reached; reverse from 4 id row(s): 1 marker row(s) reached",
      "replay: tracking — no contentTrackingId found",
      "replay: adjacency — marker→id distance within 1: 3, at 2: 0, further: 0",
      "replay: markers — feed-commentary/commentary_text: 4",
      `replay: verdict — 3 card(s) linked, 0 dropped (forward 1, reverse 1); 2/5 row(s) ids-only`,
    ]);
  });

  it("names the card-dropped disposition and the $-ref shrink cause; an empty harvest reads as text lost", async (t) => {
    const lines = await replayLines(t, SHRINK_BODY);
    assert.deepEqual(lines, [
      "replay: body 7 — 2 root row(s), 1 distinct text(s), 0 distinct id(s)",
      "replay: row 1 — ids=0 texts=1 — TEXTS-ONLY (card-dropped (no-urn)) — text shrink-suspect (1 dropped $-ref(s))",
      "replay: row 2 — ids=0 texts=0 — EMPTY (empty row) — text lost (shrink: 1 dropped $-ref(s))",
      "replay: probe — forwardBFS from 2 marker row(s): 0 id row(s) reached; reverse from 0 id row(s): 0 marker row(s) reached",
      "replay: tracking — no contentTrackingId found",
      "replay: adjacency — marker→id distance within 1: 0, at 2: 0, further: 2",
      "replay: markers — feed-commentary/commentary_text: 2",
      "replay: verdict — 0 card(s) linked, 2 dropped (forward 0, reverse 0); 0/2 row(s) ids-only",
    ]);
  });

  it("names the CTA shape on a BOTH row whose text is a bare URL", async (t) => {
    const lines = await replayLines(t, CTA_BODY);
    assert.deepEqual(lines, [
      "replay: body 7 — 1 root row(s), 1 distinct text(s), 1 distinct id(s)",
      `replay: row 10 — ids=1 texts=1 — BOTH (card-linked ↔ ${idAt(6).slice(-6)}) — text cta-suspect (bare URL)`,
      "replay: probe — forwardBFS from 1 marker row(s): 0 id row(s) reached; reverse from 1 id row(s): 0 marker row(s) reached",
      "replay: tracking — no contentTrackingId found",
      "replay: adjacency — marker→id distance within 1: 1, at 2: 0, further: 0",
      "replay: markers — feed-commentary/commentary_text: 1",
      "replay: verdict — 1 card(s) linked, 0 dropped (forward 0, reverse 0); 0/1 row(s) ids-only",
    ]);
  });

  it("cross-checks the census lines to the card-root identity on the mixed body", async () => {
    const analysis = await replayBody(MIXED_BODY);
    const cards = joinCards(MIXED_BODY);
    assert.equal(analysis.cards.linked, cards.filter((card) => card.outcome === "linked").length);
    assert.equal(analysis.cards.dropped, cards.filter((card) => card.outcome !== "linked").length);
    for (const card of cards) {
      const line = analysis.rows.find((census) => census.hex === card.marker);
      assert.ok(line, `card marker ${card.marker} has no census row`);
      if (card.outcome === "linked" && card.linkUrn !== null) {
        assert.ok(
          line.disposition?.includes(`card-linked ↔ ${card.linkUrn.slice(-6)}`),
          `card ${card.linkUrn} missing from row ${card.marker}: ${String(line.disposition)}`,
        );
      } else {
        assert.equal(line.disposition, `card-dropped (${card.outcome})`);
      }
    }
    for (const census of analysis.rows) {
      if (census.disposition?.startsWith("card-linked")) {
        const tail = census.disposition.slice(-6);
        assert.ok(
          cards.some(
            (card) =>
              card.outcome === "linked" && (card.linkUrn ?? "").endsWith(tail),
          ),
          `card-linked tail ${tail} names no card the join produced`,
        );
      }
    }
  });
});

describe("six-point probe", () => {
  it("measures the same $L-strict graph the join climbs — a marker row ref'ing its id row links", async (t) => {
    const lines = await replayLines(t, JOIN_BODY);
    assert.deepEqual(lines, [
      "replay: body 7 — 2 root row(s), 1 distinct text(s), 1 distinct id(s)",
      `replay: row 1 — ids=0 texts=1 — TEXTS-ONLY (card-linked ↔ ${idAt(9).slice(-6)})`,
      "replay: row 2 — ids=1 texts=0 — IDS-ONLY (no text harvest)",
      "replay: probe — forwardBFS from 1 marker row(s): 1 id row(s) reached; reverse from 1 id row(s): 1 marker row(s) reached",
      "replay: tracking — no contentTrackingId found",
      "replay: adjacency — marker→id distance within 1: 1, at 2: 0, further: 0",
      "replay: markers — feed-commentary/commentary_text: 1",
      "replay: verdict — 1 card(s) linked, 0 dropped (forward 1, reverse 1); 1/2 row(s) ids-only",
    ]);
  });

  it("groups contentTrackingId values and flags the list-level single value", async (t) => {
    const lines = await replayLines(t, TRACK_BODY);
    assert.ok(
      lines.includes("replay: tracking — 2 value(s); largest group 2 of 3 row(s)"),
      lines.join("\n"),
    );
    const listLines = await replayLines(t, LIST_BODY);
    assert.ok(
      listLines.includes("replay: tracking — 1 value(s); largest group 2 of 2 row(s) (list-level)"),
      listLines.join("\n"),
    );
  });

  it("tallies every viewTrackingSpecs shape, not just commentary_text", async (t) => {
    const lines = await replayLines(t, TAX_BODY);
    assert.ok(
      lines.includes(
        "replay: markers — feed-commentary/commentary_text: 1, feed-singular/singular_component: 1",
      ),
      lines.join("\n"),
    );
  });
});

describe("multi-file", () => {
  it("replays files in order, one analysis per file", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    dir ??= await mkdtemp(join(tmpdir(), "lw-replay-linkedin-"));
    const first = join(dir, "a.json");
    const second = join(dir, "b.json");
    await writeFile(first, `${JSON.stringify(capture(MIXED_BODY))}\n`, "utf8");
    await writeFile(second, `${JSON.stringify(capture(CTA_BODY, { ordinal: 3 }))}\n`, "utf8");
    const { reports } = await runReplay({ argv: [first, second] });
    assert.equal(reports.length, 2);
    const headers = logs.mock.calls
      .map((call) => String(call.arguments[0]))
      .filter((line) => line.startsWith("replay: body"));
    assert.deepEqual(headers, [
      "replay: body 7 — 5 root row(s), 3 distinct text(s), 4 distinct id(s)",
      "replay: body 3 — 1 root row(s), 1 distinct text(s), 1 distinct id(s)",
    ]);
  });
});
```



### tests/fixture/linkedin-multicard-body.txt — NEW

Real-trimmed multi-card flight body (session 20261114T055257Z, body 006): two joined cards in stream order, share-typed permalinks, provenance + manifest lines; container rows compressed to their real kept-row $L refs (the live container fans out to ~110 chrome rows carrying no card urns). No chip row exists in this session — the chip longest-wins pin stays with the synthetic suite.

```text
# multi-card body
# provenance: REAL LinkedIn flagship-web Flight body, session 20261114T055257Z (harvest 2026-11-14 12:53 +0700, H:/fork/loker-watcher), file 006-hiring-indonesia.json
# trim: marker/urn/text rows byte-exact (row hexes and $-ref targets byte-exact); each card CONTAINER row is compressed to its real $L refs aimed at the kept rows (the live container fans out to ~110 chrome rows that carry no card urns); rows > 20KB and unrelated cards dropped; parseFlightRows skips this header
# edge: two cards in stream order; each mints its own id (no global consolidation)
# edge: card 1 (marker 23) share-typed; card 2 (marker 33) share-typed with distinct id
# edge: no chip row exists in this session's bodies - the chip longest-wins pin stays synthetic
2:I["$1",[],"default"]
a:I["$9",[],"ClientComponent"]
5d:"$Sreact.fragment"
10:["$L22","$L23","$L28"]
2d:["$L32","$L33","$L34","$L38"]
22:["$","$La",null,{"componentKey":"681cdba7-79a2-4834-b9d3-f6b7642ba93a","viewTrackingSpecs":{"viewName":"feed-control-menu","interactionTypes":["SHORT_PRESS"],"contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"control_menu"},"children":["$","$L51",null,{"buttonProps":{"category":"ghost","icon":["$","$L54",null,{"display":"block","imageId":383,"aria-label":"","aria-hidden":true,"enableForcedColorStyles":false,"width":"2x","minWidth":"2x","height":"2x","minHeight":"2x","className":"k4dmbm"}],"iconEnding":false,"isSingleLine":false,"loader":["$","$L5a",null,{"a11yText":"In progress","size":16,"text":null,"type":"circular","valueExpression":{"$type":"proto.sdui.expressions.IntegerExpression","expression":{"$case":"intValue","intValue":-1},"isReactive":false},"strokeWidthExpression":2,"value":-1}],"loadingText":["Loading"],"text":null,"size":"small","tapTarget":"condensed","useDeprecatedStyle":false,"componentkey":"681cdba7-79a2-4834-b9d3-f6b7642ba93a","offsetTop":"1x","offsetStart":"1x","offsetEnd":"0.5x","height":"4x","width":"4x","aria-label":"Open control menu for post by Andrew Hairs","flexShrink":0},"triggers":[{"$type":"proto.sdui.triggers.Trigger","type":{"$case":"click","click":{"$type":"proto.sdui.triggers.ClickTrigger"}},"action":{"actions":[{"$type":"proto.sdui.actions.core.ConditionalAction","value":{"expression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"control-menu-open-statetesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"whenTrue":{"actions":[{"$type":"proto.sdui.actions.core.CloseMenu","value":{}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-statetesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"dismissMenu"}},"whenFalse":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-loadingtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-statetesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.ServerRequest","value":{"requestId":"feedUpdateControlMenuRequest","requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","requestedStateKeys":[],"payload":{"updateKey":{"feedType":10,"items":[{"feedUpdateUrn":{"updateUrnActivityUrn":{"activityUrn":{"activityId":"7527236651333419008"}}},"trackingId":"3oCFIyj6T8+9Qttrq65QhA=="}],"aggregationReasonTypes":[],"isVideoCarousel":false},"requestId":"no-request-id","collapseBehaviorType":"InPlace","isSponsored":false,"isRepost":false,"isUpdateInCarousel":false,"moduleKey":"Search","contentReplaceableRef":"feedControlMenutesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","viewerProfileId":"ACoAABDU8ikBBtjP4A4ebgEhDVyXwl5eKlQ-fCI","threadUrn":{"threadUrnActivityThreadUrn":{"activityUrn":{"activityId":"7527236651333419008"}}},"rootUrn":"urn:li:share:7527236650461134849"},"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"}},"onClientRequestFailureAction":{"actions":[{"$type":"proto.sdui.actions.core.CloseMenu","value":{}},{"$type":"proto.sdui.actions.core.ShowToast","value":{"duration":"ToastDuration_UNKNOWN","key":"d7379523-3f52-432e-b551-c57ae3c6934d","presetToast":{"category":"ToastPresetCategory_ERROR","text":["Sorry, something went wrong!"]}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-loadingtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-statetesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}}]},"isApfcEnabled":false,"isStreaming":false,"rumPageKey":"","maxRetries":0,"backOffMultiplier":0,"maxSeconds":0}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"expandControl"}}}}],"actionLabel":"View more options"},"viewTrackingSpecs":"$22:props:viewTrackingSpecs"}],"viewTrackingSpecs":"$22:props:viewTrackingSpecs","loading":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"control-menu-loadingtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}]}]
23:["$","$La",null,{"componentKey":"e05c9436-39aa-4aa9-abfb-3b0b2e2ebf28","viewTrackingSpecs":{"viewName":"feed-commentary","interactionTypes":["SHORT_PRESS"],"contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"commentary_text"},"children":["$","$L5c",null,{"textProps":{"fontFamily":"sans","fontSize":"small","fontStyle":"normal","fontWeight":"normal","lineHeight":"custom","customVars":{"var(--k4dkp)":"1.4285999536514282"},"textAlign":"start","children":[["$","$5d","text-attr-0",{"children":[[null,[["$","$5d","0",{"children":[null,"Hiring at volume? Our RPO model can cut hiring costs by up to 60%."]}],["$","$5d","1",{"children":[["$","br",null,{}],""]}],["$","$5d","2",{"children":[["$","br",null,{}],"A dedicated Select Headhunter recruiter works in your office up to three days a week, running your hiring as part of your team."]}],["$","$5d","3",{"children":[["$","br",null,{}],""]}],["$","$5d","4",{"children":[["$","br",null,{}],"Find out more:"]}]],["$","span",null,{"className":"k4dljb k4dl59","children":" "}]],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":true,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/safety/go/?url=https%3A%2F%2Flnkd%2Ein%2Fg6BTUuFx&urlhash=ws7q&mt=41so0VAT3PrgVN9yoiSllr4B0aXczceyk3qrAoa6whZl7HCq5fBaIZMlFfve1Jr7CtIx_Z_srC_D3pXLnwYMQYSHf8eIZVUhCvoOmy-WhuFCTtG4Q__jheRhaCVx0NZ2Jwr_Cq3-gEMXFdoVroXUZ7tRnFq3OPDz1hksr3ZyrotQWsZi1YA_agPUCoo3SHs&isSdui=true"},"openBehaviorConfig":{"$case":"openInNewTabOrWindow","openInNewTabOrWindow":{"$type":"google.protobuf.Empty"}}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[{"$type":"proto.sdui.tracking.TrackingBreadcrumb","breadcrumbType":"UPDATE_COMMENTARY_LINK_CLICKED","content":{"type":"Buffer","data":[123,34,117,114,110,34,58,34,117,114,110,58,108,105,58,97,99,116,105,118,105,116,121,58,55,53,50,55,50,51,54,54,53,49,51,51,51,52,49,57,48,48,56,34,44,34,117,114,108,34,58,34,104,116,116,112,115,58,47,47,108,110,107,100,46,105,110,47,103,54,66,84,85,117,70,120,34,125]}}],"actionType":"viewLink"},"actionLabel":"Open https://lnkd.in/g6BTUuFx"},"viewTrackingSpecs":{"viewName":"feed-commentary","interactionTypes":"$23:props:viewTrackingSpecs:interactionTypes","contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"commentary_text"},"linkStyle":{"$type":"proto.sdui.components.core.text.LinkStyle","style":{"$case":"colorStateListIdentifier","colorStateListIdentifier":0},"shouldSupportVisitedState":false,"linkFormatting":"LinkFormatting_NONE"},"children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["https://lnkd.in/g6BTUuFx"]}]]}]]}],null]}],["$","$5d","text-attr-1",{"children":[[[["$","br","0",{}],["$","br","1",{}]],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23rpo&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #rpo"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#RPO"]}]]}]]}],null]}],["$","$5d","text-attr-2",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23recruitmentprocessoutsourcing&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #recruitmentprocessoutsourcing"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":["$L5e"]}]]}],"$L5f"]}],"$L60","$L61","$L62"],"componentkey":"e05c9436-39aa-4aa9-abfb-3b0b2e2ebf28","insetTop":"0.5x","insetBottom":"1x","insetStart":"1.5x","insetEnd":"1.5x","linkHoverDecoration":"none","lineClamp":3,"hasShowMore":false,"expandButtonText":"more","shouldCollapseNewLines":false,"noopOverride":false},"bindingKey":{"key":{"value":{"$case":"id","id":"expandable_text_block_auto-component-ca0e5f5a-98a9-466f-9bf6-60df59841a4b"}},"namespace":""},"expandButtonTextColorExpression":179,"maxLineCountExpression":3,"onShowMoreAction":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"expandable_text_block_auto-component-ca0e5f5a-98a9-466f-9bf6-60df59841a4b"}},"namespace":""},"value":{"$case":"stringValue","stringValue":"Expanded"}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"expandCommentaryText"}},"onShowLessAction":"$undefined","textColorExpression":"$undefined","viewTrackingSpecs":"$23:props:viewTrackingSpecs"}]}]
28:["$","div",null,{"className":"k4dl5v k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dia7 k4dl59","children":[["$","$La",null,{"displayedExpression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxLoadErrorVisibletesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"children":["$","div",null,{"className":"k4dlam k4dlbi k4dayy k4diu3 k4dj1t k4dj03 k4dj1j k4dix7 k4dhqz k4dia7 k4dj1i k4dl59","aria-atomic":true,"aria-live":"assertive","children":["$","$L16",null,{"direction":"horizontal","children":["$L97",["$","$L1d",null,{"maxLineCountExpression":0,"textColorExpression":295,"textProps":{"fontFamily":"sans","fontSize":"small","fontStyle":"normal","fontWeight":"normal","lineHeight":"default","typeStyle":"supportiveM","typeStyleClassName":"k4dlo0","textAlign":"start","children":["Comment input could not be loaded. Click the comment icon to try again."],"linkHoverDecoration":"underline"}}]]}]}]}],["$","$La",null,{"displayedExpression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"andExpression","andExpression":{"$type":"proto.sdui.expressions.AndExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-commentBoxExpandedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"b":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"notExpression","notExpression":{"$type":"proto.sdui.expressions.NotExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"commentingDisabled-urn:li:activity:7527236651333419008"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}},"isReactive":true}}},"isReactive":true},"children":["$","div",null,{"className":"k4dl5v k4dlcd k4dlcu k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dia7 k4dl59","children":[["$","$La",null,{"componentKey":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","children":["$","$L13","CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH",{"componentKey":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","initialContent":["$","$La",null,{"visibilityTriggers":[{"$type":"proto.sdui.triggers.Trigger","type":{"$case":"onComponentAppear","onComponentAppear":{"$type":"proto.sdui.triggers.ComponentVisibilityTrigger","visibilityRatio":0,"debounceInMilliseconds":0}},"action":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxLoadErrorVisibletesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.ConditionalAction","value":{"expression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"notExpression","notExpression":{"$type":"proto.sdui.expressions.NotExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxRequestedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}},"isReactive":true},"whenTrue":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxRequestedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.ServerRequest","value":{"requestId":"com.linkedin.sdui.requests.comments.deferredCommentBox","requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","requestedStateKeys":[{"key":{"value":{"$case":"id","id":"commentBoxIsFocusRequested-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},{"key":{"value":{"$case":"id","id":"commentBoxText-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}}],"payload":{"updateKey":{"feedType":10,"items":[{"feedUpdateUrn":{"updateUrnActivityUrn":{"activityUrn":{"activityId":"7527236651333419008"}}},"trackingId":"3oCFIyj6T8+9Qttrq65QhA=="}],"aggregationReasonTypes":[],"isVideoCarousel":false},"threadUrn":{"threadUrnActivityThreadUrn":{"activityUrn":{"activityId":"7527236651333419008"}}},"focusOnFirstAppearField":{"key":"commentBoxIsFocusRequested-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"initialTextField":{"key":"commentBoxText-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"slotRef":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","requestGuardBinding":{"key":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxRequestedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"showIdentitySwitcherIfAvailable":true},"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"}},"onClientRequestFailureAction":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxRequestedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"commentBoxIsFocusRequested-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-commentBoxExpandedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxLoadErrorVisibletesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}}]},"isApfcEnabled":false,"isStreaming":false,"rumPageKey":"","maxRetries":0,"backOffMultiplier":0,"maxSeconds":0}}]}}}]}}],"children":"$L98"}],"componentkey":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","renderWithoutWrapper":false}]}]]}]}]]}]
32:["$","$La",null,{"componentKey":"121f3f9c-9bdc-430c-9520-c26405569fb3","viewTrackingSpecs":{"viewName":"feed-control-menu","interactionTypes":["SHORT_PRESS"],"contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"control_menu"},"children":["$","$L51",null,{"buttonProps":{"category":"ghost","icon":["$","$L54",null,{"display":"block","imageId":383,"aria-label":"","aria-hidden":true,"enableForcedColorStyles":false,"width":"2x","minWidth":"2x","height":"2x","minHeight":"2x","className":"k4dmbm"}],"iconEnding":false,"isSingleLine":false,"loader":["$","$L5a",null,{"a11yText":"In progress","size":16,"text":null,"type":"circular","valueExpression":{"$type":"proto.sdui.expressions.IntegerExpression","expression":{"$case":"intValue","intValue":-1},"isReactive":false},"strokeWidthExpression":2,"value":-1}],"loadingText":["Loading"],"text":null,"size":"small","tapTarget":"condensed","useDeprecatedStyle":false,"componentkey":"121f3f9c-9bdc-430c-9520-c26405569fb3","offsetTop":"1x","offsetStart":"1x","offsetEnd":"0.5x","height":"4x","width":"4x","aria-label":"Open control menu for post by Subham Rai","flexShrink":0},"triggers":[{"$type":"proto.sdui.triggers.Trigger","type":{"$case":"click","click":{"$type":"proto.sdui.triggers.ClickTrigger"}},"action":{"actions":[{"$type":"proto.sdui.actions.core.ConditionalAction","value":{"expression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"control-menu-open-state2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"whenTrue":{"actions":[{"$type":"proto.sdui.actions.core.CloseMenu","value":{}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-state2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"dismissMenu"}},"whenFalse":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-loading2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-state2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.ServerRequest","value":{"requestId":"feedUpdateControlMenuRequest","requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","requestedStateKeys":[],"payload":{"updateKey":{"feedType":10,"items":[{"feedUpdateUrn":{"updateUrnActivityUrn":{"activityUrn":{"activityId":"7527242172845154304"}}},"trackingId":"nFgu/jMWTGylE6mlrcQ59A=="}],"aggregationReasonTypes":[],"isVideoCarousel":false},"requestId":"no-request-id","collapseBehaviorType":"InPlace","isSponsored":false,"isRepost":false,"isUpdateInCarousel":false,"moduleKey":"Search","contentReplaceableRef":"feedControlMenu2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH","viewerProfileId":"ACoAABDU8ikBBtjP4A4ebgEhDVyXwl5eKlQ-fCI","threadUrn":{"threadUrnActivityThreadUrn":{"activityUrn":{"activityId":"7527242172845154304"}}},"rootUrn":"urn:li:share:7527242170991472640"},"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"}},"onClientRequestFailureAction":{"actions":[{"$type":"proto.sdui.actions.core.CloseMenu","value":{}},{"$type":"proto.sdui.actions.core.ShowToast","value":{"duration":"ToastDuration_UNKNOWN","key":"675f5f8f-5481-4ae9-8b83-e8b4aabb7089","presetToast":{"category":"ToastPresetCategory_ERROR","text":["Sorry, something went wrong!"]}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-loading2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-state2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}}]},"isApfcEnabled":false,"isStreaming":false,"rumPageKey":"","maxRetries":0,"backOffMultiplier":0,"maxSeconds":0}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"expandControl"}}}}],"actionLabel":"View more options"},"viewTrackingSpecs":"$32:props:viewTrackingSpecs"}],"viewTrackingSpecs":"$32:props:viewTrackingSpecs","loading":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"control-menu-loading2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}]}]
33:["$","$La",null,{"componentKey":"8e316233-c65c-4dde-b6ca-5d88d8cde602","viewTrackingSpecs":{"viewName":"feed-commentary","interactionTypes":["SHORT_PRESS"],"contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"commentary_text"},"children":["$","$L5c",null,{"textProps":{"fontFamily":"sans","fontSize":"small","fontStyle":"normal","fontWeight":"normal","lineHeight":"custom","customVars":{"var(--k4dkp)":"1.4285999536514282"},"textAlign":"start","children":[["$","$5d","text-attr-0",{"children":[[null,[["$","$5d","0",{"children":[null,"HIRING: Car-Mounted 360° Video Recorder"]}],["$","$5d","1",{"children":[["$","br",null,{}],""]}],["$","$5d","2",{"children":[["$","br",null,{}],"micro1 | Global, fully remote | $15–$30/hr | Contractor "]}],["$","$5d","3",{"children":[["$","br",null,{}],""]}],["$","$5d","4",{"children":[["$","br",null,{}],"About"]}],["$","$5d","5",{"children":[["$","br",null,{}],"Capture immersive, high-quality vehicle-navigation footage to help train next-generation AI systems. Record your vehicle navigating real-world environments from a trailing third-person perspective — local roads, turns and stops, intersections, parking areas, and moving between road or neighborhood environments. Flexible: fits around trips or commutes you already make."]}],["$","$5d","6",{"children":[["$","br",null,{}],""]}],["$","$5d","7",{"children":[["$","br",null,{}],"Work"]}],["$","$5d","8",{"children":[["$","br",null,{}],"Select vehicle-navigation assignments from a predefined list · Capture stable, continuous footage from the required trailing third-person perspective · Record varied local driving with natural turns, stops, intersections, and parking activity · Export and submit footage per assignment requirements"]}],["$","$5d","9",{"children":[["$","br",null,{}],""]}],["$","$5d","10",{"children":[["$","br",null,{}],"Need"]}],["$","$5d","11",{"children":[["$","br",null,{}],"Must already own or have access to: a compatible 360° action camera (Insta360, GoPro MAX, or comparable) · Software capable of reframing and exporting 360° footage in trailing third-person view · A secure, vehicle-rated camera mounting system for exterior third-person perspective strongly preferred (limited equipment support may be available for qualified individuals)"]}],["$","$5d","12",{"children":[["$","br",null,{}],""]}],["$","$5d","13",{"children":[["$","br",null,{}],"Ideal: already use a 360° camera for automotive, travel, action-sports, or driving footage · understand camera mounting, stabilization, reframing, and video export · drive regularly and can incorporate assignments into existing trips · strong attention to camera angle, video quality, and environmental coverage · can independently verify footage before submission"]}],["$","$5d","14",{"children":[["$","br",null,{}],""]}],["$","$5d","15",{"children":[["$","br",null,{}],"Apply here:"]}]],["$","span",null,{"className":"k4dljb k4dl59","children":" "}]],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":true,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/safety/go/?url=https%3A%2F%2Flnkd%2Ein%2FdmA5HqNe&urlhash=1ddL&mt=iEZKGoV6fszUAxwqXvT3boNSAvghB7n419_p9bmsnEqc2yzLMfRrCTK0x62d1gUkZQrSnVJCQcwi3geVF5kSjaATC0JkIOblOpV0E5XFmdX8RpCYFi01GDpoEmZ1RdmGyoIHW8wNw2yjAhyg0Bbtct3m6m89IfpM9br9p8oak_lxKfG561UvYyzBfxnNLlI&isSdui=true"},"openBehaviorConfig":{"$case":"openInNewTabOrWindow","openInNewTabOrWindow":{"$type":"google.protobuf.Empty"}}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[{"$type":"proto.sdui.tracking.TrackingBreadcrumb","breadcrumbType":"UPDATE_COMMENTARY_LINK_CLICKED","content":{"type":"Buffer","data":[123,34,117,114,110,34,58,34,117,114,110,58,108,105,58,97,99,116,105,118,105,116,121,58,55,53,50,55,50,52,50,49,55,50,56,52,53,49,53,52,51,48,52,34,44,34,117,114,108,34,58,34,104,116,116,112,115,58,47,47,108,110,107,100,46,105,110,47,100,109,65,53,72,113,78,101,34,125]}}],"actionType":"viewLink"},"actionLabel":"Open https://lnkd.in/dmA5HqNe"},"viewTrackingSpecs":{"viewName":"feed-commentary","interactionTypes":"$33:props:viewTrackingSpecs:interactionTypes","contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"commentary_text"},"linkStyle":{"$type":"proto.sdui.components.core.text.LinkStyle","style":{"$case":"colorStateListIdentifier","colorStateListIdentifier":0},"shouldSupportVisitedState":false,"linkFormatting":"LinkFormatting_NONE"},"children":["$La1"]}]]}],"$La2"]}],"$La3","$La4","$La5","$La6","$La7","$La8","$La9","$Laa","$Lab","$Lac","$Lad","$Lae","$Laf","$Lb0","$Lb1","$Lb2","$Lb3","$Lb4","$Lb5","$Lb6","$Lb7","$Lb8","$Lb9","$Lba","$Lbb","$Lbc","$Lbd","$Lbe","$Lbf","$Lc0","$Lc1","$Lc2","$Lc3","$Lc4","$Lc5","$Lc6","$Lc7","$Lc8","$Lc9","$Lca","$Lcb","$Lcc","$Lcd","$Lce","$Lcf","$Ld0","$Ld1","$Ld2","$Ld3","$Ld4","$Ld5","$Ld6","$Ld7","$Ld8","$Ld9","$Lda","$Ldb","$Ldc","$Ldd","$Lde","$Ldf","$Le0","$Le1","$Le2","$Le3","$Le4","$Le5","$Le6","$Le7","$Le8","$Le9","$Lea","$Leb","$Lec","$Led","$Lee","$Lef","$Lf0","$Lf1","$Lf2","$Lf3","$Lf4","$Lf5","$Lf6"],"componentkey":"8e316233-c65c-4dde-b6ca-5d88d8cde602","insetTop":"0.5x","insetBottom":"1x","insetStart":"1.5x","insetEnd":"1.5x","linkHoverDecoration":"none","lineClamp":3,"hasShowMore":false,"expandButtonText":"more","shouldCollapseNewLines":false,"noopOverride":false},"bindingKey":{"key":{"value":{"$case":"id","id":"expandable_text_block_auto-component-3576fa7a-97d4-4f31-8bf6-3c65953cda46"}},"namespace":""},"expandButtonTextColorExpression":179,"maxLineCountExpression":3,"onShowMoreAction":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"expandable_text_block_auto-component-3576fa7a-97d4-4f31-8bf6-3c65953cda46"}},"namespace":""},"value":{"$case":"stringValue","stringValue":"Expanded"}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"expandCommentaryText"}},"onShowLessAction":"$undefined","textColorExpression":"$undefined","viewTrackingSpecs":"$33:props:viewTrackingSpecs"}]}]
38:["$","div",null,{"className":"k4dl5v k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dia7 k4dl59","children":[["$","$La",null,{"displayedExpression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxLoadErrorVisible2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"children":["$","div",null,{"className":"k4dlam k4dlbi k4dayy k4diu3 k4dj1t k4dj03 k4dj1j k4dix7 k4dhqz k4dia7 k4dj1i k4dl59","aria-atomic":true,"aria-live":"assertive","children":["$","$L16",null,{"direction":"horizontal","children":["$L128",["$","$L1d",null,{"maxLineCountExpression":0,"textColorExpression":295,"textProps":{"fontFamily":"sans","fontSize":"small","fontStyle":"normal","fontWeight":"normal","lineHeight":"default","typeStyle":"supportiveM","typeStyleClassName":"k4dlo0","textAlign":"start","children":["Comment input could not be loaded. Click the comment icon to try again."],"linkHoverDecoration":"underline"}}]]}]}]}],["$","$La",null,{"displayedExpression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"andExpression","andExpression":{"$type":"proto.sdui.expressions.AndExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgICzrIG4kfbQAQ-commentBoxExpanded2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"b":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"notExpression","notExpression":{"$type":"proto.sdui.expressions.NotExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"commentingDisabled-urn:li:activity:7527242172845154304"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}},"isReactive":true}}},"isReactive":true},"children":["$","div",null,{"className":"k4dl5v k4dlcd k4dlcu k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dia7 k4dl59","children":[["$","$La",null,{"componentKey":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxSlot2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH","children":["$","$L13","CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxSlot2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH",{"componentKey":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxSlot2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH","initialContent":["$","$La",null,{"visibilityTriggers":[{"$type":"proto.sdui.triggers.Trigger","type":{"$case":"onComponentAppear","onComponentAppear":{"$type":"proto.sdui.triggers.ComponentVisibilityTrigger","visibilityRatio":0,"debounceInMilliseconds":0}},"action":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxLoadErrorVisible2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.ConditionalAction","value":{"expression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"notExpression","notExpression":{"$type":"proto.sdui.expressions.NotExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxRequested2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}},"isReactive":true},"whenTrue":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxRequested2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.ServerRequest","value":{"requestId":"com.linkedin.sdui.requests.comments.deferredCommentBox","requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","requestedStateKeys":[{"key":{"value":{"$case":"id","id":"commentBoxIsFocusRequested-CgsIgICzrIG4kfbQAQ-2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},{"key":{"value":{"$case":"id","id":"commentBoxText-CgsIgICzrIG4kfbQAQ-2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}}],"payload":{"updateKey":{"feedType":10,"items":[{"feedUpdateUrn":{"updateUrnActivityUrn":{"activityUrn":{"activityId":"7527242172845154304"}}},"trackingId":"nFgu/jMWTGylE6mlrcQ59A=="}],"aggregationReasonTypes":[],"isVideoCarousel":false},"threadUrn":{"threadUrnActivityThreadUrn":{"activityUrn":{"activityId":"7527242172845154304"}}},"focusOnFirstAppearField":{"key":"commentBoxIsFocusRequested-CgsIgICzrIG4kfbQAQ-2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"initialTextField":{"key":"commentBoxText-CgsIgICzrIG4kfbQAQ-2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"slotRef":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxSlot2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH","requestGuardBinding":{"key":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxRequested2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"showIdentitySwitcherIfAvailable":true},"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"}},"onClientRequestFailureAction":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxRequested2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"commentBoxIsFocusRequested-CgsIgICzrIG4kfbQAQ-2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgICzrIG4kfbQAQ-commentBoxExpanded2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxLoadErrorVisible2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}}]},"isApfcEnabled":false,"isStreaming":false,"rumPageKey":"","maxRetries":0,"backOffMultiplier":0,"maxSeconds":0}}]}}}]}}],"children":"$L129"}],"componentkey":"CgsIgICzrIG4kfbQAQ-asyncInlineCommentBoxSlot2URAeLVhnYAF-s6ZI0sqfznzgOJZdubB3yBdFZ-jt40FeedType_FLAGSHIP_SEARCH","renderWithoutWrapper":false}]}]]}]}]]}]
5e:["$","strong","text-attr-0",{"className":"k4dlp8","children":["#RecruitmentProcessOutsourcing"]}]
5f:null
60:["$","$5d","text-attr-3",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23talentacquisition&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #talentacquisition"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#TalentAcquisition"]}]]}]]}],null]}]
61:["$","$5d","text-attr-4",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23indonesia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #indonesia"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Indonesia"]}]]}]]}],null]}]
62:["$","$5d","text-attr-5",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23selectheadhunter&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #selectheadhunter"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#SelectHeadhunter"]}]]}]]}],null]}]
a1:["$","strong","text-attr-0",{"className":"k4dlp8","children":["https://lnkd.in/dmA5HqNe"]}]
a2:null
a3:["$","$5d","text-attr-1",{"children":[[[["$","br","0",{}],["$","br","1",{}]],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23usa&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #usa"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#USA"]}]]}]]}],null]}]
a4:["$","$5d","text-attr-2",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23canada&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #canada"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Canada"]}]]}]]}],null]}]
a5:["$","$5d","text-attr-3",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23uk&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #uk"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#UK"]}]]}]]}],null]}]
a6:["$","$5d","text-attr-4",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23ireland&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #ireland"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Ireland"]}]]}]]}],null]}]
a7:["$","$5d","text-attr-5",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23germany&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #germany"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Germany"]}]]}]]}],null]}]
a8:["$","$5d","text-attr-6",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23france&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #france"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#France"]}]]}]]}],null]}]
a9:["$","$5d","text-attr-7",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23netherlands&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #netherlands"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Netherlands"]}]]}]]}],null]}]
aa:["$","$5d","text-attr-8",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23belgium&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #belgium"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Belgium"]}]]}]]}],null]}]
ab:["$","$5d","text-attr-9",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23switzerland&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #switzerland"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Switzerland"]}]]}]]}],null]}]
ac:["$","$5d","text-attr-10",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23austria&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #austria"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Austria"]}]]}]]}],null]}]
ad:["$","$5d","text-attr-11",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23sweden&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #sweden"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Sweden"]}]]}]]}],null]}]
ae:["$","$5d","text-attr-12",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23norway&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #norway"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Norway"]}]]}]]}],null]}]
af:["$","$5d","text-attr-13",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23denmark&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #denmark"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Denmark"]}]]}]]}],null]}]
b0:["$","$5d","text-attr-14",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23finland&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #finland"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Finland"]}]]}]]}],null]}]
b1:["$","$5d","text-attr-15",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23iceland&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #iceland"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Iceland"]}]]}]]}],null]}]
b2:["$","$5d","text-attr-16",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23italy&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #italy"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Italy"]}]]}]]}],null]}]
b3:["$","$5d","text-attr-17",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23spain&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #spain"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Spain"]}]]}]]}],null]}]
b4:["$","$5d","text-attr-18",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23portugal&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #portugal"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Portugal"]}]]}]]}],null]}]
b5:["$","$5d","text-attr-19",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23poland&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #poland"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Poland"]}]]}]]}],null]}]
b6:["$","$5d","text-attr-20",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23czechrepublic&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #czechrepublic"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#CzechRepublic"]}]]}]]}],null]}]
b7:["$","$5d","text-attr-21",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23slovakia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #slovakia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Slovakia"]}]]}]]}],null]}]
b8:["$","$5d","text-attr-22",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23hungary&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #hungary"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Hungary"]}]]}]]}],null]}]
b9:["$","$5d","text-attr-23",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23romania&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #romania"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Romania"]}]]}]]}],null]}]
ba:["$","$5d","text-attr-24",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23bulgaria&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #bulgaria"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Bulgaria"]}]]}]]}],null]}]
bb:["$","$5d","text-attr-25",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23greece&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #greece"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Greece"]}]]}]]}],null]}]
bc:["$","$5d","text-attr-26",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23croatia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #croatia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Croatia"]}]]}]]}],null]}]
bd:["$","$5d","text-attr-27",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23slovenia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #slovenia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Slovenia"]}]]}]]}],null]}]
be:["$","$5d","text-attr-28",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23serbia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #serbia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Serbia"]}]]}]]}],null]}]
bf:["$","$5d","text-attr-29",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23estonia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #estonia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Estonia"]}]]}]]}],null]}]
c0:["$","$5d","text-attr-30",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23latvia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #latvia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Latvia"]}]]}]]}],null]}]
c1:["$","$5d","text-attr-31",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23lithuania&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #lithuania"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Lithuania"]}]]}]]}],null]}]
c2:["$","$5d","text-attr-32",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23luxembourg&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #luxembourg"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Luxembourg"]}]]}]]}],null]}]
c3:["$","$5d","text-attr-33",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23malta&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #malta"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Malta"]}]]}]]}],null]}]
c4:["$","$5d","text-attr-34",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23cyprus&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #cyprus"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Cyprus"]}]]}]]}],null]}]
c5:["$","$5d","text-attr-35",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23australia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #australia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Australia"]}]]}]]}],null]}]
c6:["$","$5d","text-attr-36",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23newzealand&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #newzealand"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#NewZealand"]}]]}]]}],null]}]
c7:["$","$5d","text-attr-37",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23japan&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #japan"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Japan"]}]]}]]}],null]}]
c8:["$","$5d","text-attr-38",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23southkorea&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #southkorea"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#SouthKorea"]}]]}]]}],null]}]
c9:["$","$5d","text-attr-39",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23taiwan&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #taiwan"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Taiwan"]}]]}]]}],null]}]
ca:["$","$5d","text-attr-40",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23singapore&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #singapore"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Singapore"]}]]}]]}],null]}]
cb:["$","$5d","text-attr-41",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23malaysia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #malaysia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Malaysia"]}]]}]]}],null]}]
cc:["$","$5d","text-attr-42",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23thailand&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #thailand"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Thailand"]}]]}]]}],null]}]
cd:["$","$5d","text-attr-43",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23vietnam&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #vietnam"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Vietnam"]}]]}]]}],null]}]
ce:["$","$5d","text-attr-44",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23philippines&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #philippines"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Philippines"]}]]}]]}],null]}]
cf:["$","$5d","text-attr-45",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23indonesia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #indonesia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Indonesia"]}]]}]]}],null]}]
d0:["$","$5d","text-attr-46",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23india&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #india"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#India"]}]]}]]}],null]}]
d1:["$","$5d","text-attr-47",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23israel&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #israel"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Israel"]}]]}]]}],null]}]
d2:["$","$5d","text-attr-48",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23uae&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #uae"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#UAE"]}]]}]]}],null]}]
d3:["$","$5d","text-attr-49",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23saudiarabia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #saudiarabia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#SaudiArabia"]}]]}]]}],null]}]
d4:["$","$5d","text-attr-50",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23qatar&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #qatar"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Qatar"]}]]}]]}],null]}]
d5:["$","$5d","text-attr-51",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23turkey&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #turkey"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Turkey"]}]]}]]}],null]}]
d6:["$","$5d","text-attr-52",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23southafrica&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #southafrica"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#SouthAfrica"]}]]}]]}],null]}]
d7:["$","$5d","text-attr-53",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23nigeria&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #nigeria"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Nigeria"]}]]}]]}],null]}]
d8:["$","$5d","text-attr-54",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23kenya&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #kenya"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Kenya"]}]]}]]}],null]}]
d9:["$","$5d","text-attr-55",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23egypt&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #egypt"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Egypt"]}]]}]]}],null]}]
da:["$","$5d","text-attr-56",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23morocco&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #morocco"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Morocco"]}]]}]]}],null]}]
db:["$","$5d","text-attr-57",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23ghana&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #ghana"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Ghana"]}]]}]]}],null]}]
dc:["$","$5d","text-attr-58",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23brazil&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #brazil"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Brazil"]}]]}]]}],null]}]
dd:["$","$5d","text-attr-59",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23mexico&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #mexico"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Mexico"]}]]}]]}],null]}]
de:["$","$5d","text-attr-60",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23argentina&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #argentina"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Argentina"]}]]}]]}],null]}]
df:["$","$5d","text-attr-61",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23chile&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #chile"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Chile"]}]]}]]}],null]}]
e0:["$","$5d","text-attr-62",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23colombia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #colombia"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Colombia"]}]]}]]}],null]}]
e1:["$","$5d","text-attr-63",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23peru&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #peru"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Peru"]}]]}]]}],null]}]
e2:["$","$5d","text-attr-64",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23costarica&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #costarica"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#CostaRica"]}]]}]]}],null]}]
e3:["$","$5d","text-attr-65",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23uruguay&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #uruguay"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Uruguay"]}]]}]]}],null]}]
e4:["$","$5d","text-attr-66",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23ecuador&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #ecuador"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Ecuador"]}]]}]]}],null]}]
e5:["$","$5d","text-attr-67",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23panama&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #panama"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Panama"]}]]}]]}],null]}]
e6:["$","$5d","text-attr-68",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23globalremote&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #globalremote"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#GlobalRemote"]}]]}]]}],null]}]
e7:["$","$5d","text-attr-69",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23remotejobs&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #remotejobs"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#RemoteJobs"]}]]}]]}],null]}]
e8:["$","$5d","text-attr-70",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23workfromhome&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #workfromhome"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#WorkFromHome"]}]]}]]}],null]}]
e9:["$","$5d","text-attr-71",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23360video&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #360video"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#360Video"]}]]}]]}],null]}]
ea:["$","$5d","text-attr-72",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23insta360&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #insta360"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Insta360"]}]]}]]}],null]}]
eb:["$","$5d","text-attr-73",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23gopromax&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #gopromax"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#GoProMAX"]}]]}]]}],null]}]
ec:["$","$5d","text-attr-74",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23actioncamera&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #actioncamera"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#ActionCamera"]}]]}]]}],null]}]
ed:["$","$5d","text-attr-75",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23videoproduction&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #videoproduction"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#VideoProduction"]}]]}]]}],null]}]
ee:["$","$5d","text-attr-76",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23automotive&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #automotive"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Automotive"]}]]}]]}],null]}]
ef:["$","$5d","text-attr-77",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23dashcam&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #dashcam"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Dashcam"]}]]}]]}],null]}]
f0:["$","$5d","text-attr-78",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23contentcreation&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #contentcreation"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#ContentCreation"]}]]}]]}],null]}]
f1:["$","$5d","text-attr-79",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23aitraining&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #aitraining"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#AITraining"]}]]}]]}],null]}]
f2:["$","$5d","text-attr-80",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23videojobs&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #videojobs"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#VideoJobs"]}]]}]]}],null]}]
f3:["$","$5d","text-attr-81",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23remotework&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #remotework"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#RemoteWork"]}]]}]]}],null]}]
f4:["$","$5d","text-attr-82",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23hiring&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #hiring"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Hiring"]}]]}]]}],null]}]
f5:["$","$5d","text-attr-83",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23jobopening&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #jobopening"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#JobOpening"]}]]}]]}],null]}]
f6:["$","$5d","text-attr-84",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23micro1&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #micro1"},"viewTrackingSpecs":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$33:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#micro1"]}]]}]]}],null]}]
34:["$","$L1c6",null,{"children":["$","$La",null,{"componentKey":"8a81e849-e16d-45a4-9715-f07781c47ae8","viewTrackingSpecs":{"viewName":"feed-article","interactionTypes":["SHORT_PRESS"],"contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"article_description"},"children":["$","$L1c8",null,{"triggers":[{"$type":"proto.sdui.triggers.Trigger","type":{"$case":"click","click":{"$type":"proto.sdui.triggers.ClickTrigger"}},"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":true,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fjobs%2Emicro1%2Eai%2Fpost%2F36e1b1f6-b8bf-4273-a09a-94116a1f4b39&urlhash=p1ZT&mt=mq08kQLQGIWTXWVonNyMqX1YTXgeqz_ULj_lpnQEiZsGO31PWnxx5RJ1XFYGHgt9ZRGVCpkzCWQpSCHnJ3Ind_Xc_DWzOuRujRuo_AtyBpkwrJw5dHGqB0qK9L4xMjeNxlpBmXc7O7NKC4KkDoRvlI1ETfvYU8jfrh3RgsqxoNbbxev-yw5qpVO4VA0L7DE&isSdui=true"},"legacyFeedTrackingData":{"$type":"proto.sdui.actions.core.LegacyFeedUrlTrackingData","updateUrn":"urn:li:activity:7527242172845154304","trackingId":"nFgu/jMWTGylE6mlrcQ59A==","isSponsored":false},"openBehaviorConfig":{"$case":"openInNewTabOrWindow","openInNewTabOrWindow":{"$type":"google.protobuf.Empty"}}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewLink"},"actionLabel":"View link https://jobs.micro1.ai/post/36e1b1f6-b8bf-4273-a09a-94116a1f4b39"},"viewTrackingSpecs":"$34:props:children:props:viewTrackingSpecs"}],"viewTrackingSpecs":"$34:props:children:props:viewTrackingSpecs","offsetStart":"1.5x","offsetEnd":"1.5x","componentkey":"8a81e849-e16d-45a4-9715-f07781c47ae8","children":["$","div",null,{"className":"k4dvo k4d0g k4d48 k4d90 k4dafi k4daka k4dao2 k4datu k4divr k4dlce k4dlcv k4dldc k4dldt k4dayy k4diu3 k4dj1t k4dj08 k4dj1j k4diyv k4dd3s k4daeg k4da29 k4dl59","componentkey":"8a81e849-e16d-45a4-9715-f07781c47ae8","children":["$","$L16",null,{"direction":"horizontal","children":["$L1d7",["$","div",null,{"className":"k4dl5v k4divr k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dj1a k4dl59","children":[["$","$L1d",null,{"maxLineCountExpression":2,"textColorExpression":176,"textProps":{"fontFamily":"sans","fontSize":"small","fontStyle":"normal","fontWeight":"bold","lineHeight":"default","typeStyle":"titleS","typeStyleClassName":"k4dlo4","textAlign":"start","children":[["$","span",null,{"className":"k4da2y k4dl59","children":["Car-Mounted 360° Video Recorder | Apply on Job"]}],["$","span",null,{"aria-hidden":"true","children":["Car-Mounted 360° Video Recorder | Apply on Job"]}]],"alignSelf":"flexStart","linkHoverDecoration":"none"}}],["$","$L1d",null,{"maxLineCountExpression":1,"textColorExpression":179,"textProps":{"fontFamily":"sans","fontSize":"xsmall","fontStyle":"normal","fontWeight":"normal","lineHeight":"default","typeStyle":"supportiveS","typeStyleClassName":"k4dloy","textAlign":"start","children":["jobs.micro1.ai"],"offsetTop":"0.5x","alignSelf":"flexStart","linkHoverDecoration":"none"}}]]}]]}]}]}]}]}]
```

### tests/fixture/linkedin-share-card-body.txt — NEW

Real-trimmed share-typed card (session 20261114T055257Z, body 006 card 1): the permalink keeps `urn:li:share:` (FR5) while the id stays the activity urn (FR4) — pins FR5 end to end on a real body.

```text
# share-typed card
# provenance: REAL LinkedIn flagship-web Flight body, session 20261114T055257Z (harvest 2026-11-14 12:53 +0700, H:/fork/loker-watcher), file 006-hiring-indonesia.json
# trim: marker/urn/text rows byte-exact (row hexes and $-ref targets byte-exact); each card CONTAINER row is compressed to its real $L refs aimed at the kept rows (the live container fans out to ~110 chrome rows that carry no card urns); rows > 20KB and unrelated cards dropped; parseFlightRows skips this header
# edge: share urn resolves the permalink (FR5); the activity urn stays the id (FR4)
# edge: the 61-urn tracking row sits outside the kept set - the join reads the card's own urn rows
2:I["$1",[],"default"]
a:I["$9",[],"ClientComponent"]
5d:"$Sreact.fragment"
10:["$L22","$L23","$L28"]
22:["$","$La",null,{"componentKey":"681cdba7-79a2-4834-b9d3-f6b7642ba93a","viewTrackingSpecs":{"viewName":"feed-control-menu","interactionTypes":["SHORT_PRESS"],"contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"control_menu"},"children":["$","$L51",null,{"buttonProps":{"category":"ghost","icon":["$","$L54",null,{"display":"block","imageId":383,"aria-label":"","aria-hidden":true,"enableForcedColorStyles":false,"width":"2x","minWidth":"2x","height":"2x","minHeight":"2x","className":"k4dmbm"}],"iconEnding":false,"isSingleLine":false,"loader":["$","$L5a",null,{"a11yText":"In progress","size":16,"text":null,"type":"circular","valueExpression":{"$type":"proto.sdui.expressions.IntegerExpression","expression":{"$case":"intValue","intValue":-1},"isReactive":false},"strokeWidthExpression":2,"value":-1}],"loadingText":["Loading"],"text":null,"size":"small","tapTarget":"condensed","useDeprecatedStyle":false,"componentkey":"681cdba7-79a2-4834-b9d3-f6b7642ba93a","offsetTop":"1x","offsetStart":"1x","offsetEnd":"0.5x","height":"4x","width":"4x","aria-label":"Open control menu for post by Andrew Hairs","flexShrink":0},"triggers":[{"$type":"proto.sdui.triggers.Trigger","type":{"$case":"click","click":{"$type":"proto.sdui.triggers.ClickTrigger"}},"action":{"actions":[{"$type":"proto.sdui.actions.core.ConditionalAction","value":{"expression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"control-menu-open-statetesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"whenTrue":{"actions":[{"$type":"proto.sdui.actions.core.CloseMenu","value":{}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-statetesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"dismissMenu"}},"whenFalse":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-loadingtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-statetesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.ServerRequest","value":{"requestId":"feedUpdateControlMenuRequest","requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","requestedStateKeys":[],"payload":{"updateKey":{"feedType":10,"items":[{"feedUpdateUrn":{"updateUrnActivityUrn":{"activityUrn":{"activityId":"7527236651333419008"}}},"trackingId":"3oCFIyj6T8+9Qttrq65QhA=="}],"aggregationReasonTypes":[],"isVideoCarousel":false},"requestId":"no-request-id","collapseBehaviorType":"InPlace","isSponsored":false,"isRepost":false,"isUpdateInCarousel":false,"moduleKey":"Search","contentReplaceableRef":"feedControlMenutesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","viewerProfileId":"ACoAABDU8ikBBtjP4A4ebgEhDVyXwl5eKlQ-fCI","threadUrn":{"threadUrnActivityThreadUrn":{"activityUrn":{"activityId":"7527236651333419008"}}},"rootUrn":"urn:li:share:7527236650461134849"},"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"}},"onClientRequestFailureAction":{"actions":[{"$type":"proto.sdui.actions.core.CloseMenu","value":{}},{"$type":"proto.sdui.actions.core.ShowToast","value":{"duration":"ToastDuration_UNKNOWN","key":"d7379523-3f52-432e-b551-c57ae3c6934d","presetToast":{"category":"ToastPresetCategory_ERROR","text":["Sorry, something went wrong!"]}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-loadingtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-statetesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}}]},"isApfcEnabled":false,"isStreaming":false,"rumPageKey":"","maxRetries":0,"backOffMultiplier":0,"maxSeconds":0}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"expandControl"}}}}],"actionLabel":"View more options"},"viewTrackingSpecs":"$22:props:viewTrackingSpecs"}],"viewTrackingSpecs":"$22:props:viewTrackingSpecs","loading":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"control-menu-loadingtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}]}]
23:["$","$La",null,{"componentKey":"e05c9436-39aa-4aa9-abfb-3b0b2e2ebf28","viewTrackingSpecs":{"viewName":"feed-commentary","interactionTypes":["SHORT_PRESS"],"contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"commentary_text"},"children":["$","$L5c",null,{"textProps":{"fontFamily":"sans","fontSize":"small","fontStyle":"normal","fontWeight":"normal","lineHeight":"custom","customVars":{"var(--k4dkp)":"1.4285999536514282"},"textAlign":"start","children":[["$","$5d","text-attr-0",{"children":[[null,[["$","$5d","0",{"children":[null,"Hiring at volume? Our RPO model can cut hiring costs by up to 60%."]}],["$","$5d","1",{"children":[["$","br",null,{}],""]}],["$","$5d","2",{"children":[["$","br",null,{}],"A dedicated Select Headhunter recruiter works in your office up to three days a week, running your hiring as part of your team."]}],["$","$5d","3",{"children":[["$","br",null,{}],""]}],["$","$5d","4",{"children":[["$","br",null,{}],"Find out more:"]}]],["$","span",null,{"className":"k4dljb k4dl59","children":" "}]],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":true,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/safety/go/?url=https%3A%2F%2Flnkd%2Ein%2Fg6BTUuFx&urlhash=ws7q&mt=41so0VAT3PrgVN9yoiSllr4B0aXczceyk3qrAoa6whZl7HCq5fBaIZMlFfve1Jr7CtIx_Z_srC_D3pXLnwYMQYSHf8eIZVUhCvoOmy-WhuFCTtG4Q__jheRhaCVx0NZ2Jwr_Cq3-gEMXFdoVroXUZ7tRnFq3OPDz1hksr3ZyrotQWsZi1YA_agPUCoo3SHs&isSdui=true"},"openBehaviorConfig":{"$case":"openInNewTabOrWindow","openInNewTabOrWindow":{"$type":"google.protobuf.Empty"}}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[{"$type":"proto.sdui.tracking.TrackingBreadcrumb","breadcrumbType":"UPDATE_COMMENTARY_LINK_CLICKED","content":{"type":"Buffer","data":[123,34,117,114,110,34,58,34,117,114,110,58,108,105,58,97,99,116,105,118,105,116,121,58,55,53,50,55,50,51,54,54,53,49,51,51,51,52,49,57,48,48,56,34,44,34,117,114,108,34,58,34,104,116,116,112,115,58,47,47,108,110,107,100,46,105,110,47,103,54,66,84,85,117,70,120,34,125]}}],"actionType":"viewLink"},"actionLabel":"Open https://lnkd.in/g6BTUuFx"},"viewTrackingSpecs":{"viewName":"feed-commentary","interactionTypes":"$23:props:viewTrackingSpecs:interactionTypes","contentTrackingId":"0Wah8aEbS56xsoxj/cZegQ==","legacyControlName":"commentary_text"},"linkStyle":{"$type":"proto.sdui.components.core.text.LinkStyle","style":{"$case":"colorStateListIdentifier","colorStateListIdentifier":0},"shouldSupportVisitedState":false,"linkFormatting":"LinkFormatting_NONE"},"children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["https://lnkd.in/g6BTUuFx"]}]]}]]}],null]}],["$","$5d","text-attr-1",{"children":[[[["$","br","0",{}],["$","br","1",{}]],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23rpo&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #rpo"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#RPO"]}]]}]]}],null]}],["$","$5d","text-attr-2",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23recruitmentprocessoutsourcing&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #recruitmentprocessoutsourcing"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":["$L5e"]}]]}],"$L5f"]}],"$L60","$L61","$L62"],"componentkey":"e05c9436-39aa-4aa9-abfb-3b0b2e2ebf28","insetTop":"0.5x","insetBottom":"1x","insetStart":"1.5x","insetEnd":"1.5x","linkHoverDecoration":"none","lineClamp":3,"hasShowMore":false,"expandButtonText":"more","shouldCollapseNewLines":false,"noopOverride":false},"bindingKey":{"key":{"value":{"$case":"id","id":"expandable_text_block_auto-component-ca0e5f5a-98a9-466f-9bf6-60df59841a4b"}},"namespace":""},"expandButtonTextColorExpression":179,"maxLineCountExpression":3,"onShowMoreAction":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"expandable_text_block_auto-component-ca0e5f5a-98a9-466f-9bf6-60df59841a4b"}},"namespace":""},"value":{"$case":"stringValue","stringValue":"Expanded"}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"expandCommentaryText"}},"onShowLessAction":"$undefined","textColorExpression":"$undefined","viewTrackingSpecs":"$23:props:viewTrackingSpecs"}]}]
28:["$","div",null,{"className":"k4dl5v k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dia7 k4dl59","children":[["$","$La",null,{"displayedExpression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxLoadErrorVisibletesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"children":["$","div",null,{"className":"k4dlam k4dlbi k4dayy k4diu3 k4dj1t k4dj03 k4dj1j k4dix7 k4dhqz k4dia7 k4dj1i k4dl59","aria-atomic":true,"aria-live":"assertive","children":["$","$L16",null,{"direction":"horizontal","children":["$L97",["$","$L1d",null,{"maxLineCountExpression":0,"textColorExpression":295,"textProps":{"fontFamily":"sans","fontSize":"small","fontStyle":"normal","fontWeight":"normal","lineHeight":"default","typeStyle":"supportiveM","typeStyleClassName":"k4dlo0","textAlign":"start","children":["Comment input could not be loaded. Click the comment icon to try again."],"linkHoverDecoration":"underline"}}]]}]}]}],["$","$La",null,{"displayedExpression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"andExpression","andExpression":{"$type":"proto.sdui.expressions.AndExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-commentBoxExpandedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"b":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"notExpression","notExpression":{"$type":"proto.sdui.expressions.NotExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"commentingDisabled-urn:li:activity:7527236651333419008"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}},"isReactive":true}}},"isReactive":true},"children":["$","div",null,{"className":"k4dl5v k4dlcd k4dlcu k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dia7 k4dl59","children":[["$","$La",null,{"componentKey":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","children":["$","$L13","CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH",{"componentKey":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","initialContent":["$","$La",null,{"visibilityTriggers":[{"$type":"proto.sdui.triggers.Trigger","type":{"$case":"onComponentAppear","onComponentAppear":{"$type":"proto.sdui.triggers.ComponentVisibilityTrigger","visibilityRatio":0,"debounceInMilliseconds":0}},"action":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxLoadErrorVisibletesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.ConditionalAction","value":{"expression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"notExpression","notExpression":{"$type":"proto.sdui.expressions.NotExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxRequestedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}},"isReactive":true},"whenTrue":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxRequestedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.ServerRequest","value":{"requestId":"com.linkedin.sdui.requests.comments.deferredCommentBox","requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","requestedStateKeys":[{"key":{"value":{"$case":"id","id":"commentBoxIsFocusRequested-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},{"key":{"value":{"$case":"id","id":"commentBoxText-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}}],"payload":{"updateKey":{"feedType":10,"items":[{"feedUpdateUrn":{"updateUrnActivityUrn":{"activityUrn":{"activityId":"7527236651333419008"}}},"trackingId":"3oCFIyj6T8+9Qttrq65QhA=="}],"aggregationReasonTypes":[],"isVideoCarousel":false},"threadUrn":{"threadUrnActivityThreadUrn":{"activityUrn":{"activityId":"7527236651333419008"}}},"focusOnFirstAppearField":{"key":"commentBoxIsFocusRequested-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"initialTextField":{"key":"commentBoxText-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"slotRef":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","requestGuardBinding":{"key":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxRequestedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"showIdentitySwitcherIfAvailable":true},"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"}},"onClientRequestFailureAction":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxRequestedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"commentBoxIsFocusRequested-CgsIgIC88M72jvbQAQ-tesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-commentBoxExpandedtesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxLoadErrorVisibletesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}}]},"isApfcEnabled":false,"isStreaming":false,"rumPageKey":"","maxRetries":0,"backOffMultiplier":0,"maxSeconds":0}}]}}}]}}],"children":"$L98"}],"componentkey":"CgsIgIC88M72jvbQAQ-asyncInlineCommentBoxSlottesFtcaj_EAI6HeKo8Rneg6dvVJw9r7g-JzuxMms62UFeedType_FLAGSHIP_SEARCH","renderWithoutWrapper":false}]}]]}]}]]}]
5e:["$","strong","text-attr-0",{"className":"k4dlp8","children":["#RecruitmentProcessOutsourcing"]}]
5f:null
60:["$","$5d","text-attr-3",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23talentacquisition&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #talentacquisition"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#TalentAcquisition"]}]]}]]}],null]}]
61:["$","$5d","text-attr-4",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23indonesia&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #indonesia"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#Indonesia"]}]]}]]}],null]}]
62:["$","$5d","text-attr-5",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$L4e","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23selectheadhunter&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #selectheadhunter"},"viewTrackingSpecs":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:viewTrackingSpecs","linkStyle":"$23:props:children:props:textProps:children:0:props:children:1:props:children:0:props:linkStyle","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#SelectHeadhunter"]}]]}]]}],null]}]
```

### tests/fixture/linkedin-joinref-card-body.txt — NEW

Real-trimmed image card (session 20261114T055257Z, body 005 card 1) — the live split-card shape, superseding the synthetic JOIN_BODY model: seed marker 24's harvest is empty, the text rides nested marker 5f (closure harvest), the climb passes 5f to container 10 (seeds-only span), and row 5f's bare "24" data string pins the $L-strict phantom-edge guard.

```text
# image card - nested marker + closure harvest + container climb
# provenance: REAL LinkedIn flagship-web Flight body, session 20261114T055257Z (harvest 2026-11-14 12:53 +0700, H:/fork/loker-watcher), file 005-hiring-indonesia.json
# trim: marker/urn/text rows byte-exact (row hexes and $-ref targets byte-exact); each card CONTAINER row is compressed to its real $L refs aimed at the kept rows (the live container fans out to ~110 chrome rows that carry no card urns); rows > 20KB and unrelated cards dropped; parseFlightRows skips this header
# edge: seed marker 24's own commentary harvest is EMPTY; the text rides nested marker 5f (closure harvest)
# edge: the climb passes the seed's own nested marker (seeds-only span) to container 10
# edge: row 5f carries a bare '24' data string - a phantom edge under an optional-$L graph form (the amendment's guard)
2:I["$1",[],"default"]
a:I["$9",[],"ClientComponent"]
53:"$Sreact.fragment"
10:["$L23","$L24","$L29"]
23:["$","$L4f",null,{"buttonProps":{"category":"ghost","icon":["$","$L52",null,{"display":"block","imageId":383,"aria-label":"","aria-hidden":true,"enableForcedColorStyles":false,"width":"2x","minWidth":"2x","height":"2x","minHeight":"2x","className":"k4dmbm"}],"iconEnding":false,"isSingleLine":false,"loader":["$","$L56",null,{"a11yText":"In progress","size":16,"text":null,"type":"circular","valueExpression":{"$type":"proto.sdui.expressions.IntegerExpression","expression":{"$case":"intValue","intValue":-1},"isReactive":false},"strokeWidthExpression":2,"value":-1}],"loadingText":["Loading"],"text":null,"size":"small","tapTarget":"condensed","useDeprecatedStyle":false,"componentkey":"35966483-cdec-4fee-8758-06d19fe3c7bf","offsetTop":"1x","offsetStart":"1x","offsetEnd":"0.5x","height":"4x","width":"4x","aria-label":"Open control menu for post by LOKER INDONESIA","flexShrink":0},"triggers":[{"$type":"proto.sdui.triggers.Trigger","type":{"$case":"click","click":{"$type":"proto.sdui.triggers.ClickTrigger"}},"action":{"actions":[{"$type":"proto.sdui.actions.core.ConditionalAction","value":{"expression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"control-menu-open-state1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"whenTrue":{"actions":[{"$type":"proto.sdui.actions.core.CloseMenu","value":{}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-state1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"dismissMenu"}},"whenFalse":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-loading1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-state1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.ServerRequest","value":{"requestId":"feedUpdateControlMenuRequest","requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","requestedStateKeys":[],"payload":{"updateKey":{"feedType":10,"items":[{"feedUpdateUrn":{"updateUrnActivityUrn":{"activityUrn":{"activityId":"7527241854124249088"}}},"trackingId":"kviI1BBtS4Ct3MT07+ieTQ=="}],"aggregationReasonTypes":[],"isVideoCarousel":false},"requestId":"no-request-id","collapseBehaviorType":"InPlace","isSponsored":false,"isRepost":false,"isUpdateInCarousel":false,"moduleKey":"Search","contentReplaceableRef":"feedControlMenu1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH","viewerProfileId":"ACoAABDU8ikBBtjP4A4ebgEhDVyXwl5eKlQ-fCI","threadUrn":{"threadUrnActivityThreadUrn":{"activityUrn":{"activityId":"7527241854124249088"}}},"rootUrn":"urn:li:share:7527126866378375168"},"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"}},"onClientRequestFailureAction":{"actions":[{"$type":"proto.sdui.actions.core.CloseMenu","value":{}},{"$type":"proto.sdui.actions.core.ShowToast","value":{"duration":"ToastDuration_UNKNOWN","key":"1eaf472e-13f3-4586-9a8d-3eaad1b650af","presetToast":{"category":"ToastPresetCategory_ERROR","text":["Sorry, something went wrong!"]}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-loading1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"control-menu-open-state1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}}]},"isApfcEnabled":false,"isStreaming":false,"rumPageKey":"","maxRetries":0,"backOffMultiplier":0,"maxSeconds":0}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"expandControl"}}}}],"actionLabel":"View more options"},"viewTrackingSpecs":"$10:0:1:props:children:props:initialContent:props:children:props:children:0:props:children:props:children:1:props:children:props:children:3:props:viewTrackingSpecs"}],"viewTrackingSpecs":"$10:0:1:props:children:props:initialContent:props:children:props:children:0:props:children:props:children:1:props:children:props:children:3:props:viewTrackingSpecs","loading":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"control-menu-loading1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}]
24:["$","$La",null,{"componentKey":"702431e4-4b49-4c2e-96be-d8357f39c8b9","viewTrackingSpecs":{"viewName":"feed-commentary","interactionTypes":["SHORT_PRESS"],"contentTrackingId":"0CmyL594SUa+uOt3HyTGGQ==","legacyControlName":"commentary_text"},"children":["$","div",null,{"className":"k4dl5v k4dlcb k4dldc k4dldt k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dl59","componentkey":"702431e4-4b49-4c2e-96be-d8357f39c8b9","children":[["$","$La",null,{"componentKey":"translatable-commentary-FeTranslationUrn(contentUrnCommentUrn=null, contentUrnGroupPostUrn=null, contentUrnShareUrn=ContentUrnShareUrn(shareUrn=ShareUrn(shareId=7527126866378375168)), contentUrnUgcPostUrn=null, detectedLocale=, targetLocale=en)","children":["$","$L13","translatable-commentary-FeTranslationUrn(contentUrnCommentUrn=null, contentUrnGroupPostUrn=null, contentUrnShareUrn=ContentUrnShareUrn(shareUrn=ShareUrn(shareId=7527126866378375168)), contentUrnUgcPostUrn=null, detectedLocale=, targetLocale=en)",{"componentKey":"translatable-commentary-FeTranslationUrn(contentUrnCommentUrn=null, contentUrnGroupPostUrn=null, contentUrnShareUrn=ContentUrnShareUrn(shareUrn=ShareUrn(shareId=7527126866378375168)), contentUrnUgcPostUrn=null, detectedLocale=, targetLocale=en)","initialContent":["$","$La",null,{"componentKey":"67f3c8dc-a1c1-4ed6-87e8-48490297ed8e","viewTrackingSpecs":{"viewName":"feed-commentary","interactionTypes":["SHORT_PRESS"],"contentTrackingId":"0CmyL594SUa+uOt3HyTGGQ==","legacyControlName":"commentary_text"},"children":["$","$L58",null,{"textProps":{"fontFamily":"sans","fontSize":"small","fontStyle":"normal","fontWeight":"normal","lineHeight":"custom","customVars":{"var(--k4dkp)":"1.4285999536514282"},"textAlign":"start","children":[["$","$53","text-attr-0",{"children":[[null,[["$","$53","0",{"children":[null,"Lowongan Kerja PT Petrosea Tbk"]}],["$","$53","1",{"children":[["$","br",null,{}],""]}],["$","$53","2",{"children":[["$","br",null,{}],"Posisi Operator"]}],["$","$53","3",{"children":[["$","br",null,{}],"- Operator Big Excavator (PC 2000, HIT EX2500)"]}],["$","$53","4",{"children":[["$","br",null,{}],"- Operator Medium Excavator (PC 1250, HIT EX1200)"]}],["$","$53","5",{"children":[["$","br",null,{}],"- Operator Small Excavator (PC200-500, CAT320-345)"]}],["$","$53","6",{"children":[["$","br",null,{}],"- Operator Grader (14M, 535-5)"]}],["$","$53","7",{"children":[["$","br",null,{}],"- Operator Fuel Truck (Scania, Renault)"]}],["$","$53","8",{"children":[["$","br",null,{}],"- Operator Wash Truck (Scania, Renault)"]}],["$","$53","9",{"children":[["$","br",null,{}],"- Operator Service Truck (Scania, Renault)"]}],["$","$53","10",{"children":[["$","br",null,{}],"- Operator Dump Truck (HD 785 / CAT 777)"]}],["$","$53","11",{"children":[["$","br",null,{}],"- Operator Driller (Sandvik, Epiroc, CAT)"]}],["$","$53","12",{"children":[["$","br",null,{}],"- Operator Dozer (D85SS, D8, D8R, D9, D10)"]}],["$","$53","13",{"children":[["$","br",null,{}],""]}],["$","$53","14",{"children":[["$","br",null,{}],"Persyaratan:"]}],["$","$53","15",{"children":[["$","br",null,{}],"- Lulusan SMA/SMK sederajat"]}],["$","$53","16",{"children":[["$","br",null,{}],"- Memiliki Pengalaman kerja minimal 3 Tahun"]}],["$","$53","17",{"children":[["$","br",null,{}],"- Memiliki SIM B II Umum aktif"]}],["$","$53","18",{"children":[["$","br",null,{}],"- Siap ditempatkan di seluruh project Kalimantan Tengah"]}],["$","$53","19",{"children":[["$","br",null,{}],""]}],["$","$53","20",{"children":[["$","br",null,{}],"Posisi Mekanik & Trades"]}],["$","$53","21",{"children":[["$","br",null,{}],"- Inspector (Heavy Equipment Mechanic & Auto Electrician)"]}],["$","$53","22",{"children":[["$","br",null,{}],"- PM Technician (Mechanic & Auto Electrician Skill)"]}],["$","$53","23",{"children":[["$","br",null,{}],"- Heavy Equipment Auto Electrician"]}],["$","$53","24",{"children":[["$","br",null,{}],"- Heavy Equipment Mechanic"]}],["$","$53","25",{"children":[["$","br",null,{}],"- Tyreman"]}],["$","$53","26",{"children":[["$","br",null,{}],"- Lifting Equipment Operator"]}],["$","$53","27",{"children":[["$","br",null,{}],"- Rigger"]}],["$","$53","28",{"children":[["$","br",null,{}],"- Welder"]}],["$","$53","29",{"children":[["$","br",null,{}],"- Machinist (Milling, Boring)"]}],["$","$53","30",{"children":[["$","br",null,{}],""]}],["$","$53","31",{"children":[["$","br",null,{}],"Persyaratan:"]}],["$","$53","32",{"children":[["$","br",null,{}],"- Lulusan SMA/SMK sederajat"]}],"$L59","$L5a","$L5b","$L5c","$L5d"],"$L5e"],"$L5f","$L60"]}],"$L61","$L62","$L63","$L64","$L65","$L66","$L67","$L68","$L69","$L6a","$L6b","$L6c"],"componentkey":"67f3c8dc-a1c1-4ed6-87e8-48490297ed8e","linkHoverDecoration":"underline","lineClamp":3,"hasShowMore":false,"expandButtonText":"more","shouldCollapseNewLines":false,"noopOverride":false},"bindingKey":{"key":{"value":{"$case":"id","id":"expandable_text_block_auto-component-fb3a105e-70b0-4fb3-a226-50b0dc431d2b"}},"namespace":""},"expandButtonTextColorExpression":179,"maxLineCountExpression":3,"onShowMoreAction":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"expandable_text_block_auto-component-fb3a105e-70b0-4fb3-a226-50b0dc431d2b"}},"namespace":""},"value":{"$case":"stringValue","stringValue":"Expanded"}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"expandCommentaryText"}},"onShowLessAction":"$undefined","textColorExpression":"$undefined","viewTrackingSpecs":"$24:props:children:props:children:0:props:children:props:initialContent:props:viewTrackingSpecs"}]}],"componentkey":"translatable-commentary-FeTranslationUrn(contentUrnCommentUrn=null, contentUrnGroupPostUrn=null, contentUrnShareUrn=ContentUrnShareUrn(shareUrn=ShareUrn(shareId=7527126866378375168)), contentUrnUgcPostUrn=null, detectedLocale=, targetLocale=en)","renderWithoutWrapper":false}]}]]}]}]
29:["$","div",null,{"className":"k4dl5v k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dia7 k4dl59","children":[["$","$La",null,{"displayedExpression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxLoadErrorVisible1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"children":["$","div",null,{"className":"k4dlam k4dlbi k4dayy k4diu3 k4dj1t k4dj03 k4dj1j k4dix7 k4dhqz k4dia7 k4dj1i k4dl59","aria-atomic":true,"aria-live":"assertive","children":["$","$L16",null,{"direction":"horizontal","children":["$La4",["$","$L1d",null,{"maxLineCountExpression":0,"textColorExpression":295,"textProps":{"fontFamily":"sans","fontSize":"small","fontStyle":"normal","fontWeight":"normal","lineHeight":"default","typeStyle":"supportiveM","typeStyleClassName":"k4dlo0","textAlign":"start","children":["Comment input could not be loaded. Click the comment icon to try again."],"linkHoverDecoration":"underline"}}]]}]}]}],["$","$La",null,{"displayedExpression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"andExpression","andExpression":{"$type":"proto.sdui.expressions.AndExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgMC62LqlkfbQAQ-commentBoxExpanded1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true},"b":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"notExpression","notExpression":{"$type":"proto.sdui.expressions.NotExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"commentingDisabled-urn:li:activity:7527241854124249088"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}},"isReactive":true}}},"isReactive":true},"children":["$","div",null,{"className":"k4dl5v k4dlcd k4dlcu k4dayy k4diun k4dj1t k4dj08 k4dj1j k4dixb k4dia7 k4dl59","children":[["$","$La",null,{"componentKey":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxSlot1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH","children":["$","$L13","CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxSlot1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH",{"componentKey":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxSlot1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH","initialContent":["$","$La",null,{"visibilityTriggers":[{"$type":"proto.sdui.triggers.Trigger","type":{"$case":"onComponentAppear","onComponentAppear":{"$type":"proto.sdui.triggers.ComponentVisibilityTrigger","visibilityRatio":0,"debounceInMilliseconds":0}},"action":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxLoadErrorVisible1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.ConditionalAction","value":{"expression":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"notExpression","notExpression":{"$type":"proto.sdui.expressions.NotExpression","a":{"$type":"proto.sdui.expressions.BooleanExpression","expression":{"$case":"bindableBoolean","bindableBoolean":{"$type":"proto.sdui.bindings.core.Bindable","key":{"key":{"value":{"$case":"id","id":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxRequested1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"content":{"$case":"booleanBinding","booleanBinding":{}}}},"isReactive":true}}},"isReactive":true},"whenTrue":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxRequested1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}},{"$type":"proto.sdui.actions.core.ServerRequest","value":{"requestId":"com.linkedin.sdui.requests.comments.deferredCommentBox","requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","requestedStateKeys":[{"key":{"value":{"$case":"id","id":"commentBoxIsFocusRequested-CgsIgMC62LqlkfbQAQ-1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},{"key":{"value":{"$case":"id","id":"commentBoxText-CgsIgMC62LqlkfbQAQ-1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}}],"payload":{"updateKey":{"feedType":10,"items":[{"feedUpdateUrn":{"updateUrnActivityUrn":{"activityUrn":{"activityId":"7527241854124249088"}}},"trackingId":"kviI1BBtS4Ct3MT07+ieTQ=="}],"aggregationReasonTypes":[],"isVideoCarousel":false},"threadUrn":{"threadUrnActivityThreadUrn":{"activityUrn":{"activityId":"7527241854124249088"}}},"focusOnFirstAppearField":{"key":"commentBoxIsFocusRequested-CgsIgMC62LqlkfbQAQ-1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"initialTextField":{"key":"commentBoxText-CgsIgMC62LqlkfbQAQ-1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"slotRef":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxSlot1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH","requestGuardBinding":{"key":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxRequested1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH","namespace":"MemoryNamespace"},"showIdentitySwitcherIfAvailable":true},"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"}},"onClientRequestFailureAction":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxRequested1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"commentBoxIsFocusRequested-CgsIgMC62LqlkfbQAQ-1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgMC62LqlkfbQAQ-commentBoxExpanded1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":false}}}},{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxLoadErrorVisible1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH"}}},"value":{"$case":"booleanValue","booleanValue":true}}}}]},"isApfcEnabled":false,"isStreaming":false,"rumPageKey":"","maxRetries":0,"backOffMultiplier":0,"maxSeconds":0}}]}}}]}}],"children":"$La5"}],"componentkey":"CgsIgMC62LqlkfbQAQ-asyncInlineCommentBoxSlot1GolEH2pqh97iIdqUl796EJ0CS3vUwC9h_h82lI_dk4FeedType_FLAGSHIP_SEARCH","renderWithoutWrapper":false}]}]]}]}]]}]
59:["$","$53","33",{"children":[["$","br",null,{}],"- Memiliki Pengalaman kerja minimal 3 Tahun"]}]
5a:["$","$53","34",{"children":[["$","br",null,{}],"- Memiliki Sertifikasi BNSP/SIO aktif (Poin 6-8)"]}]
5b:["$","$53","35",{"children":[["$","br",null,{}],"- Siap ditempatkan di seluruh project Kalimantan Tengah"]}]
5c:["$","$53","36",{"children":[["$","br",null,{}],""]}]
5d:["$","$53","37",{"children":[["$","br",null,{}],"Info lengkap dan cara melamarnya klik link dibawah ini"]}]
5e:[["$","br","0",{}]]
5f:["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":true,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/safety/go/?url=https%3A%2F%2Flnkd%2Ein%2FgcrX7sNZ&urlhash=St1G&mt=1dWBlXeziRuL9rug3tZ5iKpfrZX0FhGM7zz9Z5p5lq2E2namNI9oEY1D-J7feYrXVZ3BHdBwf0BjdHgKHJDSRSSyQpokU4dpEmw5F2DXNmmEn4kRfFoSNoBF79BJpc5ReoEeAKuLd4bZ0P7ZLEnLJXpiW0FYHEfUcnb37qeIj-2slHXBv3lwmXFM9wdGKyY&isSdui=true"},"openBehaviorConfig":{"$case":"openInNewTabOrWindow","openInNewTabOrWindow":{"$type":"google.protobuf.Empty"}}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[{"$type":"proto.sdui.tracking.TrackingBreadcrumb","breadcrumbType":"UPDATE_COMMENTARY_LINK_CLICKED","content":{"type":"Buffer","data":[123,34,117,114,110,34,58,34,117,114,110,58,108,105,58,97,99,116,105,118,105,116,121,58,55,53,50,55,50,52,49,56,53,52,49,50,52,50,52,57,48,56,56,34,44,34,117,114,108,34,58,34,104,116,116,112,115,58,47,47,108,110,107,100,46,105,110,47,103,99,114,88,55,115,78,90,34,125]}}],"actionType":"viewLink"},"actionLabel":"Open https://lnkd.in/gcrX7sNZ"},"viewTrackingSpecs":{"viewName":"feed-commentary","interactionTypes":"$24:props:children:props:children:0:props:children:props:initialContent:props:viewTrackingSpecs:interactionTypes","contentTrackingId":"0CmyL594SUa+uOt3HyTGGQ==","legacyControlName":"commentary_text"},"children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["https://lnkd.in/gcrX7sNZ"]}]]}]]}]
60:null
61:["$","$53","text-attr-1",{"children":[[[["$","br","0",{}],["$","br","1",{}]],"Join telegram :",["$","span",null,{"className":"k4dljb k4dl59","children":" "}]],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":true,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/safety/go/?url=http%3A%2F%2Ft%2Eme%2Flokernusantara_com&urlhash=QK_7&mt=VhD5UeGYgSUPM8SaLsMeQTN53e1nxAgQHd8v9AxldE11AmLpFGlfyGt2N3YaMzEkjjhOmmmwoGhl5HSyL54nCp9_4NBjRKf0bv4f5mjR2wwc0n5ek-P0SiXXaaNdn9X2dylbgJt8fpdrC6CLkN2D6SlVowbhPu_9JLJ4dVBl60A6Bane00aiTo6oWXlCg7Y&isSdui=true"},"openBehaviorConfig":{"$case":"openInNewTabOrWindow","openInNewTabOrWindow":{"$type":"google.protobuf.Empty"}}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[{"$type":"proto.sdui.tracking.TrackingBreadcrumb","breadcrumbType":"UPDATE_COMMENTARY_LINK_CLICKED","content":{"type":"Buffer","data":[123,34,117,114,110,34,58,34,117,114,110,58,108,105,58,97,99,116,105,118,105,116,121,58,55,53,50,55,50,52,49,56,53,52,49,50,52,50,52,57,48,56,56,34,44,34,117,114,108,34,58,34,104,116,116,112,58,47,47,116,46,109,101,47,108,111,107,101,114,110,117,115,97,110,116,97,114,97,95,99,111,109,34,125]}}],"actionType":"viewLink"},"actionLabel":"Open http://t.me/lokernusantara_com"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["t.me/lokernusantara_com"]}]]}]]}],null]}]
62:["$","$53","text-attr-2",{"children":[[[["$","br","0",{}],["$","br","1",{}]],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23lowongankerja&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #lowongankerja"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#lowongankerja"]}]]}]]}],null]}]
63:["$","$53","text-attr-3",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23lokernusantara&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #lokernusantara"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#lokernusantara"]}]]}]]}],null]}]
64:["$","$53","text-attr-4",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23lokerterbaru&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #lokerterbaru"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#lokerterbaru"]}]]}]]}],null]}]
65:["$","$53","text-attr-5",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23infoloker&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #infoloker"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#infoloker"]}]]}]]}],null]}]
66:["$","$53","text-attr-6",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23lowongan&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #lowongan"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#lowongan"]}]]}]]}],null]}]
67:["$","$53","text-attr-7",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23jobs&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #jobs"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#jobs"]}]]}]]}],null]}]
68:["$","$53","text-attr-8",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23karir&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #karir"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#karir"]}]]}]]}],null]}]
69:["$","$53","text-attr-9",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23infokarir&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #infokarir"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#infokarir"]}]]}]]}],null]}]
6a:["$","$53","text-attr-10",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23hiring&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #hiring"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#hiring"]}]]}]]}],null]}]
6b:["$","$53","text-attr-11",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23wearehiring&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #wearehiring"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#wearehiring"]}]]}]]}],null]}]
6c:["$","$53","text-attr-12",{"children":[[["$","span",null,{"className":"k4dljb k4dl59","children":" "}],"",null],["$","span",null,{"className":"k4dgm6 k4dl59","children":[["$","$Laf","text-attr-0",{"action":{"actions":[{"$type":"proto.sdui.actions.core.Navigate","value":{"content":{"$case":"url","url":{"$type":"proto.sdui.actions.core.NavigateToUrl","openInNewTab":false,"interop":false,"clearBackStack":false,"urlValue":{"$case":"url","url":"https://www.linkedin.com/search/results/all/?keywords=%23loker&origin=HASH_TAG_FROM_FEED"}}}}}],"tracking":{"$type":"proto.sdui.components.core.ActionTrackingAnnotations","breadcrumbs":[],"actionType":"viewHashtagFeed"},"actionLabel":"View hashtag: #loker"},"viewTrackingSpecs":"$5f:props:children:0:props:viewTrackingSpecs","children":[["$","strong","text-attr-0",{"className":"k4dlp8","children":["#loker"]}]]}]]}],null]}]
```

### state/seen-posts.json — MODIFY (one-time data edit)

Purge procedure (executed once during implement, before the first fixed tick):

```bash
# One-time purge of the zip-era urn:li:activity: seen keys — run from the repo
# root, AFTER Slice 1 merges, BEFORE the first fixed tick (Ordering Constraints).
# Measured 2026-11-14: 449 urn keys (stamps 2026-11-13T01:23..10:49Z, four bulk
# batches), 76,053 Threads digit keys, version 2, JSON.stringify(state,null,2)+"\n"
# round-trips byte-identical. The urn count ACCRUES with every judged LinkedIn
# post (persistJudged stamps post.id), so the run-time count can exceed 449 —
# the procedure purges ALL urn keys and prints the counts; nothing is
# hard-pinned except "zero urn keys survive".

# 0. Preflight — record the current count (expect >= 449).
grep -c "urn:li:activity:" state/seen-posts.json

# 1. The rewrite (throwaway script under untracked .rpiv/tmp/ — no fifth state
#    writer, Decisions; on Windows write the file with the editor instead of
#    the heredoc).
cat > .rpiv/tmp/purge-seen-urn-keys.cjs <<'EOF'
const fs = require("node:fs");
const path = "state/seen-posts.json";
const raw = fs.readFileSync(path, "utf8");
const state = JSON.parse(raw);
if (state.version !== 2 || typeof state.seenPostIds !== "object" || state.seenPostIds === null) {
  console.error("purge: unexpected state shape (version/seenPostIds) — aborting untouched");
  process.exit(1);
}
const all = Object.keys(state.seenPostIds);
const kept = all.filter((id) => !id.startsWith("urn:li:activity:"));
if (kept.length === all.length) {
  console.error("purge: no urn:li:activity: keys found — premise moved, aborting untouched");
  process.exit(1);
}
const seenPostIds = {};
for (const id of kept) seenPostIds[id] = state.seenPostIds[id];
const out = `${JSON.stringify({ version: state.version, seenPostIds }, null, 2)}\n`;
const tmp = `${path}.purge-tmp`; // sibling temp + rename — the writeStateAtomic idiom
fs.writeFileSync(tmp, out, "utf8");
fs.renameSync(tmp, path);
console.log(`purge: removed ${all.length - kept.length} urn keys, ${kept.length} keys kept`);
EOF
node .rpiv/tmp/purge-seen-urn-keys.cjs

# 2. Gates — all three must pass before the commit.
#    (grep -c prints 0 AND exits 1 on zero matches — the PRINT is the gate;
#    the exit code is grep's no-match signal, not a failure.)
grep -c "urn:li:activity:" state/seen-posts.json   # must print 0
node -e "const s=JSON.parse(require('node:fs').readFileSync('state/seen-posts.json','utf8')); console.log('parses; version', s.version, '; keys', Object.keys(s.seenPostIds).length)"
git diff --numstat -- state/seen-posts.json        # deletions-only (0 insertions; see criteria)

# 3. Commit (implement runs this once; the message names the decision).
git add state/seen-posts.json
git commit -m "purge zip-era urn:li:activity: seen keys (card-join re-send)"
```

## Slices

### Slice 1: Parser core — the card join

**Files**: `src/linkedin-parser.ts`, `tests/linkedin-parser.test.ts`

#### Automated Verification:
- [ ] The re-based parser suite passes: `npx tsx --test tests/linkedin-parser.test.ts` (18 tests, 0 fail)
- [ ] Type checking passes on the two touched files: `npx tsc --noEmit` (repo tsconfig)
- [ ] Lint passes on the two touched files: `npx biome check src/linkedin-parser.ts tests/linkedin-parser.test.ts`
- [ ] No zip-era machinery survives: `grep -c "DIGITS_RE\|count mismatch\|pair(s)" src/linkedin-parser.ts` returns 0
- [ ] Amendment pins pass: `grep -c "phantom bait\|sibling seeds\|image-card" tests/linkedin-parser.test.ts` returns >= 3
- [ ] The id pin did NOT widen: `grep -n "ACTIVITY_URN_RE = " src/linkedin-payload.ts` still reads `/^urn:li:activity:\d{9,}$/`
- [ ] `PAYLOAD_VERSION` still reads 2: `grep -n "PAYLOAD_VERSION = " src/linkedin-payload.ts`
- [ ] The walk arm still compiles against the parser: `grep -n "collectLinkedInPosts" src/linkedin-fetch.ts` resolves to the unchanged `Post[]` signature

#### Manual Verification:
- [ ] The req-9 log line reads `linkedin-parser: N card(s) linked, M dropped (a no-urn, b multi-urn, c dead-id, d no-text) — <id-tail>↔"<text head>"` on a real body
- [ ] A freshly minted digest item's permalink opens that same post (the FRD's click-through acceptance; share/ugcPost resolve, `urn:li:activity:<shareId>` does not)
- [ ] The amended join replays the fresh session: 27/27 linked with card-true pairs across bodies 005-016 (the `.rpiv/tmp/join-live-v3.mjs` scratch pattern, run with the implemented parser)

### Slice 2: Fixtures — real-capture distillation

**Files**: `tests/fixture/linkedin-multicard-body.txt`, `tests/fixture/linkedin-share-card-body.txt`, `tests/fixture/linkedin-joinref-card-body.txt`, `tests/linkedin-parser.test.ts`

#### Automated Verification:
- [ ] Fixture-driven pins pass: `npx tsx --test tests/linkedin-parser.test.ts` (the capture-fixtures describe green)
- [ ] Type checking passes: `npx tsc --noEmit`
- [ ] Lint passes on the touched test file: `npx biome check tests/linkedin-parser.test.ts`
- [ ] Provenance headers name the session: `grep -l "20261114T055257Z" tests/fixture/linkedin-*.txt` returns all three files

#### Manual Verification:
- [ ] Fixture facts byte-match the fresh-session full-body join (distiller PASS transcript: share 7527236650461134849↔...419008, joinref 7527126866378375168↔...4249088, multicard ...419008 + ...154304)
- [ ] No chip row exists in the session's bodies — the chip longest-wins pin stays with the synthetic suite (recorded in the fixture header)

### Slice 3: Harness upgrade — shared helper + re-pinned tallies

**Files**: `scripts/replay-linkedin.ts`, `tests/replay-linkedin.test.ts` (+ the disclosed cross-slice contribution to `src/linkedin-parser.ts`: export keywords on the shared forms + the urn-regex de-globalization)

#### Automated Verification:
- [ ] The re-based harness suite passes: `npx tsx --test tests/replay-linkedin.test.ts`
- [ ] The parser suite stays green beside the export flip + de-globalized urn regex: `npx tsx --test tests/linkedin-parser.test.ts`
- [ ] Type checking passes: `npx tsc --noEmit` (repo tsconfig)
- [ ] Lint passes on the touched files: `npx biome check src/linkedin-parser.ts scripts/replay-linkedin.ts tests/replay-linkedin.test.ts`
- [ ] No frozen copy survives: `grep -cE "^(const|let) (WHOLE_REF_RE|PATH_REF_RE|URN_RE|DIGITS_RE)" scripts/replay-linkedin.ts` returns 0
- [ ] The harness rides the shared join: `grep -c "collectLinkedInPosts" scripts/replay-linkedin.ts` returns 0, and `grep -n "joinCards" scripts/replay-linkedin.ts` resolves to the import + use sites
- [ ] The parser exports the shared forms: `grep -cE "export const (GRAPH_WHOLE_RE|GRAPH_PATH_RE|URN_ANYWHERE_RE)" src/linkedin-parser.ts` returns 3
- [ ] The shared urn regex is stateless: `grep -n "URN_ANYWHERE_RE = " src/linkedin-parser.ts` shows no `/g` flag
- [ ] No zip-era vocabulary survives: `grep -cE "zipByText|zip-paired|zip-unlinked|joinCandidate" scripts/replay-linkedin.ts` returns 0

#### Manual Verification:
- [ ] The replay output on a copied-out fresh-session capture (session 20261114T055257Z) names card-linked/card-dropped per marker row and the card tally in the verdict line
- [ ] The replay card tally equals the parser's own req-9 line on the same body (both read joinCards); the census rows carry the row-level facts the req-9 line omits

### Slice 4: Seen-state purge

**Files**: `state/seen-posts.json`

#### Automated Verification:
- [ ] Preflight count recorded: `grep -c "urn:li:activity:" state/seen-posts.json` returns the run-time count (449 measured 2026-11-14; the count accrues with judged LinkedIn posts, so >= 449 at run time is consistent)
- [ ] The purge script exits 0 and prints `purge: removed <N> urn keys, <kept> keys kept`
- [ ] Zero urn keys survive: `grep -c "urn:li:activity:" state/seen-posts.json` prints 0
- [ ] The file still parses as v2 state: the parse probe prints `parses; version 2` and the kept key count
- [ ] The diff is deletions-only: `git diff --numstat -- state/seen-posts.json` reports 0 insertions (dry-run-verified 2026-11-14: 449 removed / 0 added; a urn key sitting last in map order at run time adds exactly one comma-reflow insertion — inspect, do not fail)
- [ ] Threads digit keys untouched: the parse probe's kept count equals pre-purge keys minus the printed removed count
- [ ] Terminal-slice project gates: `npm run typecheck`, `npm run lint`, `npm test`

#### Manual Verification:
- [ ] Ordering held: the purge lands AFTER Slice 1 merges and BEFORE the first hosted tick that runs the card join (Ordering Constraints)
- [ ] The re-send decision executes: a known mis-paired post (session 20261114T055257Z, e.g. "HIRING: Car-Mounted 360°" — zip id ...212608, card-true id ...154304) is re-judged on the first post-purge tick and its digest link opens the card-true post
- [ ] The next hosted commit-back shows judged-id additions only — no urn keys re-appearing from stale rows (they re-accrue only from newly judged posts, which is intended)
- [ ] gate-destructive.js never fired: the rewrite ran as a node fs script, not a shell redirect (RULES[5] untouched)

## Desired End State

A freshly minted LinkedIn digest item carries its own post's link:

```text
1. [linkedin] Chef needed for a new restaurant in Bandung. Send your CV ...
   — @linkedin-member
   https://www.linkedin.com/feed/update/urn:li:share:7526496255288508416
```

The parser's body log reads like:

```text
linkedin-parser: 12 card(s) linked, 3 dropped (2 no-urn, 1 multi-urn, 0 dead-id, 0 no-text) — 858416↔"Chef needed for a new rest", ...
```

The replay harness prints per-row card-linked/card-dropped dispositions against the same join the parser shipped:

```text
replay: row 10 — ids=1 texts=1 — BOTH (card-linked ↔ 858416)
```

## File Map

- src/linkedin-parser.ts — MODIFY — the card join + shared exports + rewritten header
- scripts/replay-linkedin.ts — MODIFY — harness on the shared join, frozen copies gone
- tests/linkedin-parser.test.ts — MODIFY — join + drop-count + log pins
- tests/replay-linkedin.test.ts — MODIFY — re-shaped bodies + card-identity cross-check
- tests/fixture/linkedin-multicard-body.txt — NEW — real multi-card body
- tests/fixture/linkedin-share-card-body.txt — NEW — real share-typed card body
- tests/fixture/linkedin-joinref-card-body.txt — NEW — minimal join-ref card body
- state/seen-posts.json — MODIFY — one-time urn-key purge

## Ordering Constraints

- Slice 1 is the foundation: every later slice imports or validates against the join.
- Slice 2 needs Slice 1's final shapes (fixture expectations must byte-match the AMENDED join's output) and distills from the ALREADY-HARVESTED session `20261114T055257Z` (H:/fork/loker-watcher/captures/, landed 2026-11-14 12:53) — distill inside the 20-session window (`CAPTURE_KEEP_SESSIONS` prunes oldest first).
- Slice 3 needs Slice 1's exports (the harness imports them); its tests keep synthetic bodies, so Slices 2 and 3 are independent of each other.
- Slice 4 (purge) must land AFTER Slice 1 merges and BEFORE the first fixed tick runs the new parser against the hosted seen file.

## Verification Notes

- Project gates (CI parity): `npm run typecheck` -> `npm run lint` -> `npm test` — on the terminal slice.
- Zip-era tripwires fire on purpose: tests/linkedin-parser.test.ts:212-224 (zip proof), :231-286 (four warn pins + oracle), tests/replay-linkedin.test.ts:268-280 (cross-check) must be REWRITTEN in the same change as the parser, or CI is red without its fix (precedent ce567af).
- Payload admission must NOT widen: `grep -n "ACTIVITY_URN_RE" src/linkedin-payload.ts` stays `^urn:li:activity:\d{9,}$` pinned to `row.id` only; a share-typed id would drop every row while the leg reads "ok".
- `PAYLOAD_VERSION` stays 2 (exact-equality check, src/linkedin-payload.ts:178-181).
- The purge verification: `grep -c "urn:li:activity:" state/seen-posts.json` returns 0 (449 today) and a JSON.parse probe proves the file still parses.
- Acceptance "clicking the permalink opens that post": manual — the FRD verified `urn:li:share:`/`urn:li:ugcPost:` resolve and `urn:li:activity:<shareId>` does not; a fresh-tick digest spot-check covers it.
- Slice 1 amendment evidence (2026-11-14): the fresh-corpus validation scratch is `.rpiv/tmp/join-live-v3.mjs` (27/27 linked, card-true pairs across session 20261114T055257Z); the pre-amendment locked code (`.rpiv/tmp/join-live.mjs`) minted 26/27. Implement re-runs the v3 pattern against the `tests/fixture/` distillations — fixture expected-facts must byte-match the amended join.
- Corpus reality (verified 2026-11-14): all 20 remaining H: sessions are unmatched single-file diagnostics; zero matched bodies exist on disk. Slice 2 opens with the harvest step and distills from its fresh session; check the harvested session's files carry BOTH `commentary_text` and `urn:li:activity:` before distilling (the grep pair used in the discovery).
- src/linkedin-fetch.ts is the highest-churn file — merge main into this branch before implement (the recurring 3-file conflict set).

## Performance Considerations

- No new network request; the join runs on the body already in memory (FRD NFR).
- Cost per body: one `JSON.stringify` per row for marker detection + one forward-span walk per climb candidate + one forward urn walk per card — bounded by <= 12 hops and small closures on ~50-100-row bodies (measured corpus; the dry run ran this shape over 157 bodies without timing notes).
- `markerCount` is memoized per row within one `joinCards` call; the memo dies with the call (parser stays pure, no module state).

## Migration Notes

- `state/seen-posts.json`: 449 `urn:li:activity:` keys deleted once (Slice 4) — the FRD's re-send decision executes because `diffNew` (src/state.ts:207-212) is id-only and the prune can never release those keys naturally.
- `state/linkedin-posts.json`: 291 zip-era rows self-heal on the next PC tick (FRD non-goal: no hand repair); payload admission keeps them valid until then.
- Capture envelopes: on-disk `minted` counts keep their zip-era meaning (readCapture validates shape, not semantics); after this change the field means "cards linked". Recorded, no migration.
- Rollback: revert the parser commit — the purge is data, not code; re-purged keys re-accrue only from new judged posts.

## Pattern References

- The climb reference implementation: `.rpiv/tmp/scan9.ts` (dry-run instrument, 340/340 + 423/423) — superseded only at text-harvest shape and containment-self counting.
- Tagged-error + guard idioms stay: `mintPost`'s null-mint (src/linkedin-parser.ts:185-203), drop-and-count (src/linkedin-payload.ts:199-210, src/extract.ts:73-77).
- Fixture trim doctrine: tests/fixture/tag-page.html:2-7 (byte-real values, compressed skeleton, in-file provenance); fixture loading idiom: tests/extract.test.ts:14-29.
- CLI/suite shapes for the harness: scripts/replay-linkedin.ts:641-686 (gate + entry guard), tests/replay-linkedin.test.ts mkdtemp + call-through log spy.
- Header-prose discipline: precedent ce567af — prose, fences, and log contracts land in the same change.

## Developer Context

Checkpoint 2026-11-14 (design, Step 4 — batched; answers recorded verbatim):

- Q: Delete the digit-field (`activityId`, src/linkedin-parser.ts:247-251) and urn-object-key (:262-265) rules; collect urn strings only (widened pattern)? — A: "Follow: delete both".
- Q: Upgrade the replay harness in this same change via a shared parser export, deleting the frozen regex copies (scripts/replay-linkedin.ts:53, :96-99; tests/replay-linkedin.test.ts:268-280)? — A: "Follow: upgrade now".
- Q: How does the one-time purge of the 449 `urn:li:activity:` keys in `state/seen-posts.json` happen? — A: "One-time edit (Recommended)" — rewrite the committed file once during implement, zero-count grep gate, no permanent script.
- Q: Hand-distill the 5-class fixture matrix now, or also build a generator script? — A: "Hand-distill now (Recommended)" — generator deferred as a named follow-up.
- Decomposition (Step 5): approved as proposed — 4 slices: parser core (foundation) -> fixtures -> harness upgrade -> seen purge.

Inherited from research (recorded, never re-asked): re-send the wrongly-linked posts (purge executes it); card urn, type kept; drop and count urn edge cases; upgrade-in-same-change (harness); the FRD's measured assumptions (423/423 single activity urn; 462 top-level markers).

Slice 2 micro-checkpoint (2026-11-14 13:52 +0700): the harvest question surfaced before any fixture bytes were written (disk re-check confirmed zero usable matched sessions — the two synthetic replay artifacts excluded); developer ran `npm run linkedin-chain` (session 20261114T055257Z, 12 matched bodies, 27 posts). Slice-verifier dispatched on the generated slice: Decisions OK, Research OK, Cross-slice VIOLATION (BigInt passed to new Date in the share-card timestamp pin — TS2769 under strict flags), fixed exactly as prescribed; developer approved at the 6.3 checkpoint.

Pre-slice grounding check (2026-11-14, before Slice 1 codegen): the containment A-vs-B validation scratch (.rpiv/tmp/verify-join.ts) ran against the live corpus and exposed the eviction — 20 sessions, 0 matched bodies, 60/60 cards zero-urn (meaningless input). Consequences applied: containment A locked on semantics + disjoint-tree equivalence (Decisions), Slice 2 gained the harvest-first step (Decisions, Ordering Constraints, Verification Notes). No developer input needed; recorded here for the artifact trail.

## Design History

- Slice 1: Parser core — the card join — approved as generated; AMENDED 2026-11-14 (developer-approved reopen after the fresh harvest): $L-strict graph edges, seeds-only climb span, closure text harvest; re-validated 27/27 on session 20261114T055257Z
- Slice 2: Fixtures — real-capture distillation — approved as generated (harvest session 20261114T055257Z; slice-verifier: Decisions/Research OK, one Cross-slice pin fixed per its citation — Number() around the BigInt shift in the share-card timestamp pin)
- Slice 3: Harness upgrade — shared helper + re-pinned tallies — approved as generated; carries a disclosed cross-slice parser contribution: +export on GRAPH_WHOLE_RE/GRAPH_PATH_RE/URN_ANYWHERE_RE and the /g flag removed (a shared global regex carries lastIndex across exec calls — sandbox-verified order-dependent urn drops; the locked Slice 2 share-urn synthetic pin fails under /g); slice-verifier Decisions/Cross-slice/Research OK with all three census expectations independently reproduced
- Slice 4: Seen-state purge — approved as generated (one-time node fs purge of every urn:li:activity: key — 449 measured 2026-11-14, count accrues so the procedure pins >= 449 and purges ALL urn keys; emit byte-matches writeStateAtomic (JSON.stringify(state,null,2)+"\n", sibling temp + rename); gates = grep-0 + parse probe + deletions-only numstat; slice-verifier Decisions/Cross-slice/Research OK)

## References

- Research: `.rpiv/artifacts/research/2026-11-14_07-48-28_linkedin-permalink-card-root-join.md` (this design's parent)
- FRD: `.rpiv/artifacts/discover/2026-11-14_07-15-07_linkedin-permalink-card-join.md`
- Dry-run instruments: `.rpiv/tmp/scan9.ts` (the climb), `.rpiv/tmp/dbg9.ts`/`.rpiv/tmp/dbg10.ts` (real card rows)
- Prior design (frozen-parser Not Building list): `.rpiv/artifacts/designs/2026-11-13_11-24-35_linkedin-post-link-pairing.md`
- Zip mis-pair proof: `.rpiv/artifacts/plans/2026-11-11_14-43-00_linkedin-browser-walk-migration.md`
- Binding hard constraints: `.rpiv/artifacts/solutions/2026-11-13_10-20-27_linkedin-post-link-pairing.md`
