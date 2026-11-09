---
date: 2026-11-09T12:36:00+0700
author: Yogiswara Utama
commit: dc75365
branch: ukind/feature-email-per-surface
repository: feature-email-per-surface
topic: "Email digest per surface"
tags: [design, email, notify, attribution, linkedin-payload, dedupe, surfaces]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-09_12-11-37_email-per-surface.md
last_updated: 2026-11-09T12:36:00+0700
last_updated_by: Yogiswara Utama
---

# Design: Email digest per surface

## Summary

Split the single combined job-match digest into one plain-text email per configured surface that produced matches. Attribution rides the post itself: an optional `surfaces?: Surface[]` field stamped inside each fetcher where the surface is lexically in scope, carried through the PC-to-hosted LinkedIn payload round-trip by a strict `PAYLOAD_VERSION` 1→2 bump, and merged (not dropped) at the cross-surface dedupe. The notify stage replaces the single `sendDigest` call with a config-order loop inside the existing `timeStage` closure, so every run-scoped invariant (notify-before-persist, one timing pair, riders on every email, heartbeat isolation) inherits untouched.

## Requirements

- FR1 — the attribution contract lands for both platforms at once (Threads is off today; the contract still lands)
- FR2 — a post collected by N surfaces rides every matching surface's email
- FR5 — a post appears exactly once across the union of emails
- FR6 — disabled platforms contribute no surfaces and no emails
- FR7 — all-or-nothing: any failed send exits the run before persist; the next run re-sends everything
- FR8 — one `timing: notify` pair per run, plus one log line per surface email
- FR9 — the linkedinLeg and degraded-accounts riders ride every surface email when present
- Zero-match runs keep exactly one combined heartbeat; per-surface subjects drop the `(#hiring indonesia)` pin
- Hard: strict payload version bump 1→2 (guard shape unchanged; developer ruling: PC leg git-pulls, overlap ≤ one tick)
- Hard: locked FRD decisions; offline node:test suite; no new runtime dependency; no new secrets or env vars
- Soft: config-order send order; duplicate configured surfaces collapse to one email plus a load-time warn

## Current State Analysis

`Post` (`src/types.ts:10-23`) carries six required fields and no surface identity; `platform` drives digest marking only. Surface identity is the `{type, value}` union (`src/config-file.ts:16-20`); `ResolvedSurface` (`:22-29`) carries platform/label/url only, and `resolveSurfaces` (`:284-300`) is a 1:1 map that discards the raw pair.

Both walkers keep per-surface side arrays and then destroy them at a terminal flatten: `src/linkedin-fetch.ts:494` (slot write) / `:525` (flatten); `src/fetch-threads.ts:318` (slot write) / `:326` (flatten). The logged-out path is worse — `fetchSurfaces` compacts its slot array through a `filter` at `src/fetch-threads.ts:226`, so position no longer identifies the surface, and `SurfaceFetch` (`:192-196`) carries only `{label, html}`. `fetchLoggedOutPosts` (`src/index.ts:530-541`) then flattens again.

The payload envelope is `PAYLOAD_VERSION = 1` (`src/linkedin-payload.ts:28`); `isValidRow` (`:62-78`) runs six checks and pushes the original row through (`:174-184`), so extra fields pass silently today. The strict version guard (`:151-155`) degrades to one warn + `leg: "malformed"` threads-only tick.

The funnel drops duplicates first-wins (`src/index.ts:556-557`); the notify seam is one `sendDigest` call inside `timeStage` (`src/index.ts:497-500`) with `persistJudged` after it (`:501`, stamps every judged id at `:521`). Gates 1 and 2 return before the seam (`:381-391`, `:473-491`).

`buildSubject` (`src/email.ts:55-71`) joins a platform Set and appends the `(#hiring indonesia)` pin at the return. `sendText` (`:119-152`) is the one transport seam; `sendDigest` (`:157-190`) gates on empty and logs per call.

The judge wraps by reference — `judged.push({ post, verdict })` (`src/judge.ts:1054`) — so attribution enriched anywhere before notify reaches the seam free.

### Key Discoveries

- `src/pool.ts:10-17` — the caller-owned side-array doctrine: workers write pre-sized slots, the join reassembles by index. All three stamp sites sit exactly where a slot is written.
- `src/email.ts:186` conditional spread, `PayloadRead.detail?` (`src/linkedin-payload.ts:56-58`), `HeartbeatStats` riders (`src/heartbeat.ts:46-52`) — the optional-field-with-conditional-read idiom has 4+ incumbents on sibling contracts; `Post` itself has none yet, so `surfaces?` is the first.
- `src/linkedin-payload.ts:7-19` — drop + count, never silent: the row-admission policy the stamp validator must follow.
- `tests/fetch-linkedin.test.ts:284-292` — one `deepEqual` on the whole envelope breaks the moment a stamp rides the row.
- `tests/index.test.ts` — 25 `subjects.length` / `mails.length` assertions (lines 362, 386, 417, 438, 465, 544, 597, 627, 661, 690, 714, 768, 794, 820, 847, 917, 956, 1019, 1060, 1119, 1172, 1175, 1208, 1230, 1244) plus ~18 subject pins (8 in `tests/email.test.ts`, 10 regex pins in `tests/index.test.ts`).
- `watcher.config.json:86` and `:138` — the duplicate `linkedin: "hiring react"`; 19 distinct overlapping linkedin queries; `platforms.threads: false`.

## Scope

### Building

- `surfaces?: Surface[]` on `Post`, stamped at all three fetch sites
- `PAYLOAD_VERSION` 2 with row admission for the stamp (absent = valid; present = array of `{type, value}`)
- Dedupe drop → surface-set union merge into fresh arrays
- Config-order per-surface notify loop inside the existing `timeStage` closure
- Per-surface subject template; the `(#hiring indonesia)` pin dropped
- Duplicate-surface load-time warn in `readSurfaces`
- Orphaned-match policy: loud warn naming the post, skipped from every email
- Full test rewrite: subject pins, count assertions, envelope deepEqual, plus FR2/FR5/FR7/FR8/FR9 clusters

### Not Building

- Multi-recipient routing (one inbox stays)
- Per-surface keywords or per-surface scan counts in the heartbeat
- A lenient payload version guard
- Per-surface funnel runs (rejected: judge cost ×N, lost seen-state updates, N heartbeats)
- Any change to the PC leg's git discipline or the commit-back script

## Decisions

### D1 — `Post.surfaces?: Surface[]` reuses the config union

**Ambiguity**: the stamp needs the `{type, value}` shape. `types.ts` is the zero-import contracts leaf; the union lives in `src/config-file.ts:16-20`.

**Explored**: (A) `import type { Surface }` into types.ts — one definition, no drift, type-only so no runtime edge is created; (B) move the union to types.ts and re-export — contracts live in the leaf, but two files churn and the doc comment moves; (C) mirror a structural copy in types.ts — types.ts stays import-free, but a future fourth surface type can drift silently.

**Decision**: A. `src/types.ts` gains `import type { Surface } from "./config-file.js"` and `surfaces?: Surface[]`. Developer-confirmed.

### D2 — Widen `ResolvedSurface` and `SurfaceFetch` rather than thread the raw partition

**Ambiguity**: the logged-out walk compacts its slot array at `src/fetch-threads.ts:226`, so position no longer identifies the surface, and `SurfaceFetch` (`:192-196`) carries only `{label, html}`.

**Explored**: (A) widen both shapes with `type` + `value` — ~10 lines across 4 files, zero signature changes, results become self-describing past the filter; (B) pass the raw `Surface[]` into `fetchSurfaces` and zip before the filter — ~10 lines across 2 files, but the signature ripples into every call site and test double.

**Decision**: A. `ResolvedSurface` (`src/config-file.ts:22-29`) and `SurfaceFetch` (`src/fetch-threads.ts:192-196`) each gain `type` and `value`; `resolveSurfaces` fills them from the raw pair it already holds. Developer-confirmed with a worked example (targets `[tag/hiring, url/…@hiresflow]`; if the first fails the list compacts and position lies).

### D3 — Orphaned match: loud warn, skip

**Ambiguity**: a match stamped with surfaces that left the config joins no surface email, yet `persistJudged` (`src/index.ts:521`) still marks it seen — permanent silent loss.

**Explored**: (A) drop from all emails with one loud warn per post naming id + stamps; (B) one extra combined "unattributed" email; (C) deliver into every active surface email (duplicates).

**Decision**: A. The solutions doc's default assumption, developer-confirmed. The warn names the post id, its stamps, and the remedy (re-add the surface).

### D4 — Subject template: full URL for url surfaces

**Ambiguity**: `3 new job posts — <surface>` needs a rendering for each surface type.

**Explored**: (A) strip `https://www.threads.com`, keep path + query (~70 chars, surfaces stay distinguishable); (B) truncate the whole token at ~40 chars; (C) the complete URL verbatim.

**Decision**: C — `tag: "hiring"`, `linkedin: "hiring react"`, `url: https://www.threads.com/search?q=…` verbatim. Developer-confirmed (zero ambiguity chosen over short subjects).

### D5 — Dedupe drop becomes a union merge

**Simple**: `src/index.ts:556-557` keeps first-seen order and drops later duplicates. FR2 requires the later duplicate's surfaces to merge into the kept post. The merge writes a fresh array — never mutates an input's array — and retains the first-seen position.

### D6 — Notify loop inside the existing `timeStage` closure

**Simple**: `src/index.ts:497-500` wraps one `sendDigest`. The loop replaces the call body, so FR7 (all-or-nothing), FR8 (one timing pair), and FR9 (riders on every email) inherit by construction. Grouping keys on `type|value` and iterates config order, seeded from the flag-gated partitions at `src/index.ts:257-263`.

### D7 — Duplicate configured surfaces collapse with a load-time warn

**Simple**: `readSurfaces` (`src/config-file.ts:149-193`) has no duplicate detection. Two identical entries produce one group key, hence one email; the warn names the duplicate so the operator can clean the config.

### D8 — Strict version bump, writer and reader in the same change

**Simple**: `PAYLOAD_VERSION` 1→2 keeps the guard shape (`src/linkedin-payload.ts:151-155`) byte-identical. The existing `version: 99` pin survives. The PC leg git-pulls before its next tick, so overlap is ≤ one tick with one logged warn — the developer ruling recorded in the solutions doc.

## Architecture

### src/types.ts — MODIFY

```ts
import type { Surface } from "./config-file.js";
```

In the `Post` interface, the final field becomes:

```ts
  /** Post time, ISO 8601 UTC, e.g. "2026-10-24T08:15:00.000Z". */
  timestamp: string;
  /** Which configured surfaces collected this post (email-per-surface):
   *  stamped by every fetcher before the funnel; absent on rows that
   *  predate the stamp (payload admission keeps those valid). Type-only
   *  import — types.ts stays a runtime leaf. */
  surfaces?: Surface[];
}
```

### src/linkedin-payload.ts — MODIFY

```ts
import type { Surface } from "./config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "./config.js";
import { stateTempPath } from "./state.js";
import type { Post } from "./types.js";
```

The version constant:

```ts
/** Envelope version; bump on a shape change, keep the reader tolerant.
 *  v2 (email-per-surface): rows may carry surfaces stamps. */
export const PAYLOAD_VERSION = 2;
```

New guards, placed immediately above `isValidRow`:

```ts
/** One surface stamp inside a payload row (email-per-surface). */
function isValidStamp(stamp: unknown): stamp is Surface {
  if (stamp === null || typeof stamp !== "object") return false;
  const entry = stamp as Record<string, unknown>;
  return (
    (entry.type === "tag" || entry.type === "url" || entry.type === "linkedin") &&
    typeof entry.value === "string" &&
    entry.value.length > 0
  );
}

/**
 * The stamp is optional on a v2 row (legacy-shaped rows stay valid) but a
 * PRESENT stamp must be a well-formed Surface[] — one malformed stamp fails
 * the whole row (drop + count, the module doctrine).
 */
function stampsAreValid(value: unknown): value is Surface[] {
  return value === undefined || (Array.isArray(value) && value.every(isValidStamp));
}
```

`isValidRow`'s return expression gains one conjunct:

```ts
    typeof row.timestamp === "string" &&
    !Number.isNaN(Date.parse(row.timestamp)) &&
    stampsAreValid(row.surfaces)
  );
```

### src/config-file.ts — MODIFY

```ts
/** A surface resolved to the URL Playwright loads, plus its log label. */
export interface ResolvedSurface {
  /** Always "threads": LinkedIn rides the PC fetch leg and never resolves here. */
  platform: "threads";
  /** Log label: `tag/hiring`, or the full URL for a `url` surface. */
  label: string;
  /** Absolute URL to load. */
  url: string;
  /** The raw surface type (email-per-surface stamp, design D2): results
   *  carry their own identity past any list compaction downstream. */
  type: "tag" | "url";
  /** The raw surface value exactly as configured. */
  value: string;
}
```

In `readSurfaces`, the tail (after the `out.push({ type, value: surfaceValue });` loop) becomes:

```ts
  warnDuplicateSurfaces(out, filePath);
  return out;
```

New private helper, placed immediately after `readSurfaces`:

```ts
/**
 * Duplicate configured surfaces (design D7): two identical entries produce
 * one group key downstream, hence one email. The load stays valid — the
 * warn names the duplicate so the operator can clean the config.
 */
function warnDuplicateSurfaces(surfaces: readonly Surface[], filePath: string): void {
  const seen = new Set<string>();
  const warned = new Set<string>();
  for (const surface of surfaces) {
    const key = `${surface.type}/${surface.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    if (warned.has(key)) continue;
    warned.add(key);
    console.warn(
      `config: ${filePath} duplicate surface ${surface.type} "${surface.value}" — watched once; delete the extra entry from "surfaces"`,
    );
  }
}
```

Both `resolveSurfaces` return arms gain the raw pair:

```ts
    if (surface.type === "tag") {
      return {
        platform: "threads",
        label: `tag/${surface.value}`,
        url: tagPageUrlFor(surface.value),
        type: surface.type,
        value: surface.value,
      };
    }
    return {
      platform: "threads",
      label: surface.value,
      url: surface.value,
      type: surface.type,
      value: surface.value,
    };
```

### src/fetch-threads.ts — MODIFY

```ts
/** Rendered HTML for one surface, ready for extractPosts(). */
export interface SurfaceFetch {
  label: string;
  html: string;
  /** The raw surface pair (email-per-surface stamp, design D2): the page
   *  carries its own identity past the successes filter, which compacts
   *  the slot array so position no longer identifies the surface. */
  type: "tag" | "url";
  value: string;
}
```

The logged-out walk's slot write:

```ts
        results[index] = {
          label: surface.label,
          html,
          type: surface.type,
          value: surface.value,
        };
```

The authenticated walk's slot write:

```ts
        // Stamp at the slot write (email-per-surface): a fresh post object
        // per row — the walk's input arrays are never mutated.
        perSurface[index] = posts.map((post) => ({
          ...post,
          surfaces: [{ type: surface.type, value: surface.value }],
        }));
```

### src/linkedin-fetch.ts — MODIFY

```ts
        // Stamp at the slot write (email-per-surface): the surface is a
        // LinkedinSurface, so type is always "linkedin" here. Fresh post
        // objects — the walk's collected array is never mutated.
        perSurface[index] = collected.map((post) => ({
          ...post,
          surfaces: [{ type: surface.type, value: surface.value }],
        }));
```

`scripts/fetch-linkedin.ts` needs NO change: `fetchTick` passes the walk's return straight into `writePayloadAtomic`, so the stamps ride the pushed payload for free.

### src/index.ts — MODIFY

```ts
// --- top of file: the email import gains the per-surface names ---
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Transporter } from "nodemailer";
import {
  type ResolvedSurface,
  type Surface,
  type WatcherConfig,
  loadWatcherConfig,
  resolveSurfaces,
} from "./config-file.js";
import { LINKEDIN_PAYLOAD_PATH, STATE_PATH, isHeartbeatEnabled, runUrlFromEnv } from "./config.js";
import {
  groupMatchesBySurface,
  resolveEmailConfig,
  sendExhaustionEmail,
  sendSurfaceDigest,
} from "./email.js";

// --- inside runWatcher, the match path (replaces the single combined send) ---
  // Email before state: a failed send exits non-zero and leaves state
  // untouched, so the next run re-judges and re-sends these matches (D3,
  // D8). The per-surface loop (D6) replaces the single combined-digest
  // call inside the SAME timeStage closure: one timing pair (FR8), any
  // failed send throws before persist (FR7), and the leg + degraded
  // riders ride every surface email when present (FR9; the body renders
  // the leg line only when it is not ok, D13 — undefined omits it
  // entirely). Surfaces iterate in config order, disabled platforms
  // filtered out (FR6); duplicate configured surfaces collapse to one
  // group key, one email (D7 — the load already warned).
  const { durationMs: notifyMs } = await timeStage(async () => {
    const notifySurfaces = config.surfaces.filter((surface) =>
      surface.type === "linkedin" ? config.platforms.linkedin : config.platforms.threads,
    );
    const { groups, orphans } = groupMatchesBySurface(matches, notifySurfaces);
    for (const orphan of orphans) {
      const stamps = (orphan.surfaces ?? []).map(surfaceLabel).join(", ");
      console.warn(
        `notify: match ${orphan.id} carries no configured surface (${stamps === "" ? "no stamps" : stamps}) — skipped from every email; re-add the surface to watcher.config.json`,
      );
    }
    const emailConfig = resolveEmailConfig(env);
    for (const group of groups) {
      if (group.posts.length === 0) continue;
      await sendSurfaceDigest(
        group.surface,
        group.posts,
        emailConfig,
        deps.transport,
        linkedinLeg,
        degradedLine,
      );
    }
  });
  console.log(`timing: notify ${notifyMs}ms`);
  const saved = await persistJudged(state, judged, statePath, now());

// --- tail of file: the logged-out walker (Slice 2, unchanged in Slice 3) ---
/** Logged-out path: blob extraction per surface, in input order. */
async function fetchLoggedOutPosts(
  surfaces: readonly ResolvedSurface[],
  contextFactory?: ContextFactory,
): Promise<Post[]> {
  const fetched = await fetchSurfaces(surfaces, contextFactory);
  const posts: Post[] = [];
  for (const page of fetched) {
    // Stamp from the page own pair (design D2): the successes filter
    // compacted the slot list, so the page carries the only identity left.
    const extracted = extractPosts(page.html).map((post) => ({
      ...post,
      surfaces: [{ type: page.type, value: page.value }],
    }));
    console.log(`extract: ${page.label}: ${extracted.length} post(s)`);
    posts.push(...extracted);
  }
  return posts;
}

// --- tail of file: dedupe gains the D5 union merge ---
/**
 * Dedupe posts by id, keeping first-seen order (D5). Surface stamps on a
 * later duplicate merge into the kept post — a post collected by N
 * surfaces rides every matching surface email (FR2). Map re-sets keep the
 * first-seen position; the inputs and their stamp arrays are never
 * mutated.
 */
function dedupePosts(posts: readonly Post[]): Post[] {
  const byId = new Map<string, Post>();
  for (const post of posts) {
    const kept = byId.get(post.id);
    byId.set(post.id, kept === undefined ? post : mergeSurfaceStamps(kept, post));
  }
  return [...byId.values()];
}

/**
 * Union of the stamps on two duplicate posts (D5): kept stamps first, then
 * the unseen ones from the duplicate, into a FRESH array. Under
 * exactOptionalPropertyTypes the field stays off the post entirely when
 * no stamps exist (legacy payload rows predate the stamp).
 */
function mergeSurfaceStamps(kept: Post, duplicate: Post): Post {
  const merged = [...(kept.surfaces ?? [])];
  for (const stamp of duplicate.surfaces ?? []) {
    const key = `${stamp.type}|${stamp.value}`;
    if (merged.some((existing) => `${existing.type}|${existing.value}` === key)) continue;
    merged.push(stamp);
  }
  return {
    ...kept,
    ...(merged.length > 0 ? { surfaces: merged } : {}),
  };
}
```

Slice 2 + Slice 3 merged state: the email import, the seam loop, and the tail merge functions above are the complete designed delta for this file (position separators mark where each part lands). The orphan warn reuses `surfaceLabel` (unchanged on disk). `tests/index.test.ts` pins ids, counts, and subjects — Slice 4 rewrites them; this slice keeps its criteria scoped to `tests/email.test.ts`.

### src/email.ts — MODIFY

Per-surface family replaces the combined trio. Deleted: `buildSubject`, `buildDigest`, `sendDigest` (index.ts was their only caller; no test imports them — verified). Unchanged byte-identical: `EmailConfig`, `SendDigestResult`, `resolveEmailConfig`, `sendText`, `legDetailSuffix`, `buildExhaustionText`, `sendExhaustionEmail`, `buildLegDeadAlarmText`, `sendLegDeadAlarm`. Position comments mark where each block replaces the old code.

```ts
/**
 * Gmail plain-text notification senders (FRD #7, #8; email-per-surface):
 * one plain-text digest email per configured surface that produced
 * matches (D6), dispatched via Gmail SMTP using nodemailer, plus the
 * exhaustion and leg-dead alarms. A surface with zero matches sends no
 * email.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { Surface } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import type { LegLine } from "./linkedin-payload.js";
import type { AccountFailure, Post } from "./types.js";

// --- replaces the old combined subject builder ---
/**
 * Render one surface for subjects, logs, and orphan warnings (D4): tag
 * and linkedin render as `type: "value"`; a url surface renders its full
 * URL verbatim — zero ambiguity over short subjects.
 */
export function renderSurface(surface: Surface): string {
  if (surface.type === "url") return `url: ${surface.value}`;
  return `${surface.type}: "${surface.value}"`;
}

/**
 * Per-surface digest subject (D4): `3 new job posts — tag: "hiring"`. The
 * combined digest pin `(#hiring indonesia)` is gone — each subject names
 * the one surface the email is about.
 */
export function buildSurfaceSubject(surface: Surface, postCount: number): string {
  const plural = postCount === 1 ? "" : "s";
  return `${postCount} new job post${plural} — ${renderSurface(surface)}`;
}

/** One surface share of the matches (email-per-surface, D6). */
export interface SurfaceGroup {
  surface: Surface;
  posts: Post[];
}

/**
 * Group matches per configured surface, in the same order as the
 * surfaces argument (D6). A post rides every group whose surface appears
 * in its stamps (FR2) — once per group, never twice (FR5; a surface
 * listed twice on one post still places it once). Duplicate configured
 * surfaces collapse to one group (D7). Posts whose stamps name no
 * configured surface — and unstamped posts — return as orphans: the
 * caller warns and skips them (D3: the stamps left the config, the
 * posts belong to no email).
 */
export function groupMatchesBySurface(
  matches: readonly Post[],
  surfaces: readonly Surface[],
): { groups: SurfaceGroup[]; orphans: Post[] } {
  const groups: SurfaceGroup[] = [];
  const seen = new Set<string>();
  for (const surface of surfaces) {
    const key = `${surface.type}|${surface.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({ surface, posts: [] });
  }
  const orphans: Post[] = [];
  for (const post of matches) {
    let placed = false;
    for (const group of groups) {
      const stamped = (post.surfaces ?? []).some(
        (stamp) => stamp.type === group.surface.type && stamp.value === group.surface.value,
      );
      if (stamped) {
        group.posts.push(post);
        placed = true;
      }
    }
    if (!placed) orphans.push(post);
  }
  return { groups, orphans };
}

// --- replaces the old combined body builder (legDetailSuffix keeps its place below) ---
/**
 * Per-surface digest body (email-per-surface). Same item rendering and
 * rider lines as the retired combined digest — only the subject line is
 * per-surface now. The LinkedIn leg line (D13) rides ONLY when the leg
 * is not ok; the degraded-accounts line rides ONLY when some account is
 * capped. Returns null when the post list is empty.
 */
export function buildSurfaceDigest(
  surface: Surface,
  posts: readonly Post[],
  leg?: LegLine,
  degradedAccounts?: string,
): string | null {
  if (posts.length === 0) return null;
  const subject = buildSurfaceSubject(surface, posts.length);
  const items = posts.map((post, index) => {
    const author = post.author.replace(/^@+/, "");
    const platformToken = post.platform === "threads" ? "" : "[linkedin] ";
    return `${index + 1}. ${platformToken}${post.text}\n   — @${author}\n   ${post.permalink}`;
  });
  const legLine =
    leg !== undefined && leg.status !== "ok"
      ? `\n\nLinkedIn leg: ${leg.status}${legDetailSuffix(leg)}`
      : "";
  const degradedLine =
    degradedAccounts !== undefined && degradedAccounts !== "" ? `\n\n${degradedAccounts}` : "";
  return `${subject}\n\n${items.join("\n\n")}${legLine}${degradedLine}\n`;
}

// --- replaces the old combined sender (after sendText) ---
/**
 * Send one surface digest email via nodemailer (email-per-surface, D6).
 * Gated: returns { sent: false, postCount: 0 } when the surface produced
 * no posts. Throws when nodemailer fails to deliver (sendText wraps the
 * transport error) — the notify loop is all-or-nothing before persist
 * (FR7).
 */
export async function sendSurfaceDigest(
  surface: Surface,
  posts: readonly Post[],
  config: EmailConfig,
  transport?: Transporter,
  leg?: LegLine,
  degradedAccounts?: string,
): Promise<SendDigestResult> {
  const text = buildSurfaceDigest(surface, posts, leg, degradedAccounts);
  if (text === null) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const subject = buildSurfaceSubject(surface, posts.length);
  const messageId = await sendText(subject, text, config, transport);
  const recipient = config.to ?? config.user;
  console.log(
    `email: sent digest for ${renderSurface(surface)} with ${posts.length} post(s) to ${recipient}`,
  );

  return {
    sent: true,
    ...(messageId !== undefined ? { messageId } : {}),
    recipient,
    postCount: posts.length,
  };
}
```

### src/heartbeat.ts:170-175 — MODIFY (comment only)

The doc comment names the deleted `sendDigest`; the reference becomes `sendSurfaceDigest`. No code change.

```ts
/**
 * Send the heartbeat email. Reuses the digest transport path so both emails
 * share one credential resolution and one fail-visible error shape.
 * Accepts an optional Transporter for unit testing, exactly as
 * sendSurfaceDigest does — without it the function would open a real
 * Gmail connection.
 */
```

### tests/linkedin-payload.test.ts — MODIFY

Append one describe block (helpers `post` / `envelopeFor` / `payloadPath` / `seedEnvelope` / `T0` / `MINUTE` already exist in the file):

```ts
describe("payload v2 — surfaces stamps", () => {
  const stamped = (n: number): Post => ({
    ...post(n),
    surfaces: [{ type: "linkedin", value: "hiring react" }],
  });

  it("class: ok — a row with a well-formed stamp passes admission", async () => {
    const path = await payloadPath("stamp-ok.json");
    await seedEnvelope(path, envelopeFor([stamped(1)]));
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [stamped(1)]);
  });

  it("class: ok — a row without a stamp stays valid (legacy shape)", async () => {
    const path = await payloadPath("stamp-absent.json");
    await seedEnvelope(path, envelopeFor([post(1)]));
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(1)]);
  });

  it("class: rows — a malformed stamp fails the whole row (drop + count)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await payloadPath("stamp-bad.json");
    const bad = {
      ...post(1),
      surfaces: [{ type: "linkedin", value: "" }],
    };
    await seedEnvelope(path, envelopeFor([post(2), bad as unknown as Post]));
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [post(2)]);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /payload carried 1 malformed row/.test(line)));
  });

  it("class: rows — a stamp that is not an array fails the whole row", async () => {
    const path = await payloadPath("stamp-not-array.json");
    const bad = { ...post(1), surfaces: "hiring react" };
    await seedEnvelope(path, envelopeFor([bad as unknown as Post]));
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, []);
  });

  it("class: rows — an unknown stamp type fails the whole row", async () => {
    const path = await payloadPath("stamp-bad-type.json");
    const bad = { ...post(1), surfaces: [{ type: "profile", value: "x" }] };
    await seedEnvelope(path, envelopeFor([bad as unknown as Post]));
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, []);
  });

  it("class: malformed — a version 1 envelope degrades after the v2 bump", async () => {
    const path = await payloadPath("v1-envelope.json");
    await seedEnvelope(path, { ...envelopeFor([post(1)]), version: 1 });
    const read = await readPayloadPosts(path, () => T0);
    assert.equal(read.leg, "malformed");
    assert.match(read.detail ?? "", /unknown version 1/);
    assert.deepEqual(read.posts, []);
  });

  it("v2 round trip: a stamped row survives write → read byte-faithful", async () => {
    const path = await payloadPath("stamp-round-trip.json");
    await writePayloadAtomic([stamped(1)], path, () => T0);
    const read = await readPayloadPosts(path, () => T0 + 1 * MINUTE);
    assert.equal(read.leg, "ok");
    assert.deepEqual(read.posts, [stamped(1)]);
  });
});
```

### tests/fetch-threads.test.ts — MODIFY

The `surface` helper gains the raw pair (mirrors `resolveSurfaces`' shapes: a tag's value is the tag; a url's value is the full URL):

```ts
const surface = (label: string): ResolvedSurface => ({
  platform: "threads",
  label,
  url: `https://www.threads.com/${label}`,
  type: label.startsWith("tag/") ? "tag" : "url",
  value: label.startsWith("tag/")
    ? label.slice("tag/".length)
    : `https://www.threads.com/${label}`,
});
```

New test in `describe("fetchSurfaces")` — design D2's worked example (the first surface fails, the list compacts, the survivor must still self-describe):

```ts
  it("carries the raw surface pair past the successes filter (the stamp survives compaction)", async () => {
    const surfaces: ResolvedSurface[] = [
      {
        platform: "threads",
        label: "tag/hiring",
        url: "https://www.threads.com/tag/hiring",
        type: "tag",
        value: "hiring",
      },
      {
        platform: "threads",
        label: "https://www.threads.com/@hiresflow",
        url: "https://www.threads.com/@hiresflow",
        type: "url",
        value: "https://www.threads.com/@hiresflow",
      },
    ];
    const failUrls = new Set(["tag/hiring"]);

    const result = await fetchSurfaces(
      surfaces,
      fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, failUrls }),
    );

    assert.deepEqual(
      result.map((fetched) => ({ type: fetched.type, value: fetched.value })),
      [{ type: "url", value: "https://www.threads.com/@hiresflow" }],
    );
  });
```

New test in `describe("fetchSurfacesAuthenticated")` — both stamp shapes (tag + url) pinned in one walk:

```ts
  it("stamps every captured post with the surface that collected it (email-per-surface)", async () => {
    const surfaces = [surface("tag/a1"), surface("url/x")];
    const xhrBySubstring = new Map(
      surfaces.map((s, i) => [s.label, graphqlBody(id19(i + 1))] as const),
    );

    const result = await fetchSurfacesAuthenticated(
      surfaces,
      "session-state.json",
      fakeContextFactory({ concurrency: { inFlight: 0, peak: 0 }, xhrBySubstring }),
    );

    assert.deepEqual(
      result.map((post) => ({ id: post.id, surfaces: post.surfaces })),
      [
        { id: id19(1), surfaces: [{ type: "tag", value: "a1" }] },
        { id: id19(2), surfaces: [{ type: "url", value: "https://www.threads.com/url/x" }] },
      ],
    );
  });
```

### tests/fetch-linkedin.test.ts — MODIFY

The tick-ok envelope pin carries the stamp (the walk stamps before `writePayloadAtomic`, so the pushed payload rides it):

```ts
    const expected: Post = {
      platform: "linkedin",
      id: `urn:li:activity:${idAt(1)}`,
      text: `post ${idAt(1)}`,
      author: `author ${idAt(1)}`,
      permalink: `https://www.linkedin.com/posts/x-${idAt(1)}`,
      timestamp: new Date(Number(BigInt(idAt(1)) >> 22n)).toISOString(),
      surfaces: [{ type: "linkedin", value: "#hiring react" }],
    };
```

No other pin changes: the suite's remaining walk assertions key on ids and counts, and `tests/linkedin-fetch.test.ts` pins walk output field-wise — the stamp rides invisibly, so that file stays untouched.

### tests/config-file.test.ts — MODIFY

Two pins in the existing `describe("resolveSurfaces")` gain the raw pair:

```ts
  it("builds the tag-page URL and label", () => {
    const resolved = resolveSurfaces([{ type: "tag", value: "hiring" }]);
    assert.deepEqual(resolved, [
      {
        platform: "threads",
        label: "tag/hiring",
        url: "https://www.threads.com/tag/hiring",
        type: "tag",
        value: "hiring",
      },
    ]);
  });

  it("uses a url surface verbatim", () => {
    const url = "https://www.threads.com/@hiresflow";
    const resolved = resolveSurfaces([{ type: "url", value: url }]);
    assert.deepEqual(resolved, [
      { platform: "threads", label: url, url, type: "url", value: url },
    ]);
  });
```

New describe block, appended after the `platforms` describe:

```ts
describe("duplicate surfaces (email-per-surface: the notify loop groups on type|value)", () => {
  it("warns once naming the duplicate and still loads the config", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await writeConfig({
      ...VALID,
      surfaces: [
        { type: "tag", value: "hiring" },
        { type: "tag", value: "hiring" },
      ],
    });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.surfaces, [
      { type: "tag", value: "hiring" },
      { type: "tag", value: "hiring" },
    ]);
    const dupes = warns.mock.calls
      .map((call) => call.arguments.join(" "))
      .filter((line) => /duplicate surface/.test(line));
    assert.equal(dupes.length, 1);
    assert.match(dupes[0] ?? "", /duplicate surface tag "hiring"/);
  });

  it("warns once even when a surface is listed three times", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await writeConfig({
      ...VALID,
      surfaces: [
        { type: "linkedin", value: "hiring react" },
        { type: "linkedin", value: "hiring react" },
        { type: "linkedin", value: "hiring react" },
      ],
    });
    await loadWatcherConfig(path);
    const dupes = warns.mock.calls
      .map((call) => call.arguments.join(" "))
      .filter((line) => /duplicate surface/.test(line));
    assert.equal(dupes.length, 1);
    assert.match(dupes[0] ?? "", /duplicate surface linkedin "hiring react"/);
  });

  it("stays quiet when every surface is distinct", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const path = await writeConfig({
      ...VALID,
      surfaces: [
        { type: "tag", value: "hiring" },
        { type: "tag", value: "loker" },
        { type: "linkedin", value: "hiring react" },
      ],
    });
    await loadWatcherConfig(path);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !/duplicate surface/.test(line)));
  });
});
```

### tests/email.test.ts — MODIFY

Full pin rewrite for the per-surface family (the 3b005cb lesson: subject pins land in the same change as the subject builder). Untouched suites stay byte-identical: `resolveEmailConfig`, the three `buildExhaustionText` describe blocks, `sendExhaustionEmail`. The import block and the five suites in the fence replace everything else.

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import type { Surface } from "../src/config-file.js";
import {
  type EmailConfig,
  buildExhaustionText,
  buildSurfaceDigest,
  buildSurfaceSubject,
  groupMatchesBySurface,
  renderSurface,
  resolveEmailConfig,
  sendExhaustionEmail,
  sendSurfaceDigest,
} from "../src/email.js";
import type { AccountFailure, Post } from "../src/types.js";

describe("renderSurface", () => {
  it("quotes tag and linkedin values and renders url verbatim (D4)", () => {
    assert.equal(renderSurface({ type: "tag", value: "loker" }), `tag: "loker"`);
    assert.equal(
      renderSurface({ type: "linkedin", value: "react indonesia" }),
      `linkedin: "react indonesia"`,
    );
    assert.equal(
      renderSurface({ type: "url", value: "https://www.threads.com/@hiresflow" }),
      "url: https://www.threads.com/@hiresflow",
    );
  });
});

describe("buildSurfaceSubject", () => {
  const tag: Surface = { type: "tag", value: "hiring" };
  const linkedin: Surface = { type: "linkedin", value: "hiring react" };

  it("renders one post singular with the tag surface", () => {
    assert.equal(buildSurfaceSubject(tag, 1), `1 new job post — tag: "hiring"`);
  });

  it("renders several posts plural with the linkedin surface", () => {
    assert.equal(buildSurfaceSubject(linkedin, 3), `3 new job posts — linkedin: "hiring react"`);
  });

  it("renders a url surface as the full URL verbatim (D4)", () => {
    const url: Surface = {
      type: "url",
      value: "https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent",
    };
    assert.equal(
      buildSurfaceSubject(url, 2),
      "2 new job posts — url: https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent",
    );
  });

  it("drops the combined subject pin (#hiring indonesia)", () => {
    const subject = buildSurfaceSubject(tag, 5);
    assert.ok(!subject.includes("#hiring indonesia"));
    assert.ok(!subject.includes("on Threads"));
  });
});

describe("buildSurfaceDigest", () => {
  const tag: Surface = { type: "tag", value: "hiring" };
  const threadsPost: Post = {
    platform: "threads",
    id: "101",
    text: "First job post",
    author: "companyA",
    permalink: "https://www.threads.com/@companyA/post/P1",
    timestamp: "2026-10-24T08:00:00.000Z",
  };

  it("returns null for an empty post list", () => {
    assert.equal(buildSurfaceDigest(tag, []), null);
  });

  it("opens with the per-surface subject and renders author + permalink", () => {
    const digest = buildSurfaceDigest(tag, [
      {
        platform: "threads",
        id: "201",
        text: "Looking for a Next.js frontend dev in Jakarta, hybrid...",
        author: "pttechcareers",
        permalink: "https://www.threads.com/@pttechcareers/post/C8H5FiCtESk",
        timestamp: "2026-10-24T08:15:00.000Z",
      },
    ]);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith(`1 new job post — tag: "hiring"\n\n`));
    assert.ok(digest.includes("1. Looking for a Next.js frontend dev in Jakarta, hybrid..."));
    assert.ok(digest.includes("   — @pttechcareers"));
    assert.ok(digest.includes("   https://www.threads.com/@pttechcareers/post/C8H5FiCtESk"));
  });

  it("keeps multi-line captions and sequential numbering intact", () => {
    const digest = buildSurfaceDigest(tag, [
      {
        platform: "threads",
        id: "103",
        text: "HIRING NOW!\n- React\n- TypeScript\nApply via DM",
        author: "recruiter",
        permalink: "https://www.threads.com/@recruiter/post/P3",
        timestamp: "2026-10-24T10:00:00.000Z",
      },
      {
        platform: "threads",
        id: "104",
        text: "Vue dev needed",
        author: "@companyB",
        permalink: "https://www.threads.com/@companyB/post/P4",
        timestamp: "2026-10-24T11:00:00.000Z",
      },
    ]);
    assert.ok(digest !== null);
    assert.ok(
      digest.includes("1. HIRING NOW!\n- React\n- TypeScript\nApply via DM\n   — @recruiter"),
    );
    assert.ok(digest.includes("2. Vue dev needed\n   — @companyB"));
  });

  it("marks only linkedin item lines with the [linkedin] token", () => {
    const digest = buildSurfaceDigest({ type: "linkedin", value: "hiring react" }, [
      {
        platform: "linkedin",
        id: "urn:li:activity:7522028760582447104",
        text: "Second job post",
        author: "sometechguy",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
        timestamp: "2026-10-24T09:00:00.000Z",
      },
    ]);
    assert.ok(digest !== null);
    assert.ok(
      digest.includes(
        "1. [linkedin] Second job post\n   — @sometechguy\n   https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
      ),
    );
  });

  it("renders the leg line only when the leg is not ok (D13)", () => {
    const okDigest = buildSurfaceDigest(tag, [threadsPost], { status: "ok" });
    assert.ok(okDigest !== null);
    assert.ok(!okDigest.includes("LinkedIn leg:"));
    const staleDigest = buildSurfaceDigest(tag, [threadsPost], {
      status: "stale",
      detail: "payload 2h old",
    });
    assert.ok(staleDigest !== null);
    assert.ok(staleDigest.includes("\n\nLinkedIn leg: stale — payload 2h old\n"));
  });

  it("appends the degraded line after the leg line when both riders ride", () => {
    const LINE = "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick";
    const digest = buildSurfaceDigest(
      tag,
      [threadsPost],
      { status: "stale", detail: "payload 2h old" },
      LINE,
    );
    assert.ok(digest !== null);
    assert.ok(digest.endsWith(`${LINE}\n`));
    const legAt = digest.indexOf("LinkedIn leg: stale");
    const degradedAt = digest.indexOf("Degraded LLM");
    assert.ok(legAt >= 0);
    assert.ok(degradedAt > legAt);
  });

  it("keeps the body byte-identical when no rider rides", () => {
    const LINE = "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick";
    const withRider = buildSurfaceDigest(tag, [threadsPost], undefined, LINE);
    const without = buildSurfaceDigest(tag, [threadsPost]);
    assert.ok(withRider !== null && without !== null);
    assert.ok(withRider.startsWith(without));
    assert.ok(!without.includes("Degraded LLM"));
  });
});

describe("groupMatchesBySurface (email-per-surface grouping)", () => {
  const tagHiring: Surface = { type: "tag", value: "hiring" };
  const tagLoker: Surface = { type: "tag", value: "loker" };
  const linkedinReact: Surface = { type: "linkedin", value: "hiring react" };

  const postFor = (id: string, surfaces?: Surface[]): Post => ({
    platform: "threads",
    id,
    text: `post ${id}`,
    author: "author",
    permalink: `https://www.threads.com/@author/post/${id}`,
    timestamp: "2026-10-24T00:00:00.000Z",
    ...(surfaces !== undefined ? { surfaces } : {}),
  });

  it("sends a shared post to every surface that stamped it (FR2)", () => {
    const shared = postFor("1", [tagHiring, linkedinReact]);
    const onlyTag = postFor("2", [tagHiring]);
    const { groups, orphans } = groupMatchesBySurface(
      [shared, onlyTag],
      [tagHiring, linkedinReact],
    );
    assert.deepEqual(
      groups.map((group) => [group.surface, group.posts.map((post) => post.id)]),
      [
        [tagHiring, ["1", "2"]],
        [linkedinReact, ["1"]],
      ],
    );
    assert.deepEqual(orphans, []);
  });

  it("keeps a post once per group even when its stamps list the surface twice (FR5)", () => {
    const stamped = postFor("1", [tagHiring, { type: "tag", value: "hiring" }]);
    const { groups, orphans } = groupMatchesBySurface([stamped], [tagHiring]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.posts.length, 1);
    assert.deepEqual(orphans, []);
  });

  it("collapses duplicate configured surfaces to one group (D7)", () => {
    const stamped = postFor("1", [linkedinReact]);
    const { groups } = groupMatchesBySurface([stamped], [
      linkedinReact,
      { type: "linkedin", value: "hiring react" },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.posts.length, 1);
  });

  it("keeps group order following the surfaces argument (config order, D6)", () => {
    const stamped = postFor("1", [tagLoker, tagHiring]);
    const { groups } = groupMatchesBySurface([stamped], [tagHiring, tagLoker]);
    assert.deepEqual(
      groups.map((group) => group.surface.value),
      ["hiring", "loker"],
    );
  });

  it("returns posts whose stamps name no configured surface as orphans (D3)", () => {
    const orphaned = postFor("1", [{ type: "tag", value: "removed-tag" }]);
    const placed = postFor("2", [tagHiring]);
    const { groups, orphans } = groupMatchesBySurface([orphaned, placed], [tagHiring]);
    assert.deepEqual(
      orphans.map((post) => post.id),
      ["1"],
    );
    assert.deepEqual(
      groups[0]?.posts.map((post) => post.id),
      ["2"],
    );
  });

  it("returns an unstamped post as an orphan (legacy payload rows)", () => {
    const unstamped = postFor("1");
    const { groups, orphans } = groupMatchesBySurface([unstamped], [tagHiring]);
    assert.deepEqual(
      orphans.map((post) => post.id),
      ["1"],
    );
    assert.equal(groups[0]?.posts.length, 0);
  });
});

describe("sendSurfaceDigest", () => {
  const sampleConfig: EmailConfig = {
    user: "alerts@gmail.com",
    pass: "app-password",
    to: "alerts@gmail.com",
  };
  const tag: Surface = { type: "tag", value: "hiring" };
  const samplePosts: Post[] = [
    {
      platform: "threads",
      id: "201",
      text: "Hiring React dev",
      author: "devteam",
      permalink: "https://www.threads.com/@devteam/post/201",
      timestamp: "2026-10-24T00:00:00.000Z",
    },
  ];

  it("does not send email when the surface produced no posts", async () => {
    let called = false;
    const mockTransport = {
      sendMail: async () => {
        called = true;
        return { messageId: "msg-123" };
      },
    } as unknown as Transporter;

    const result = await sendSurfaceDigest(tag, [], sampleConfig, mockTransport);
    assert.equal(result.sent, false);
    assert.equal(result.postCount, 0);
    assert.equal(called, false);
  });

  it("sends one email whose subject names the surface", async () => {
    let capturedOptions: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        capturedOptions = options;
        return { messageId: "msg-456" };
      },
    } as unknown as Transporter;

    const result = await sendSurfaceDigest(tag, samplePosts, sampleConfig, mockTransport);
    assert.equal(result.sent, true);
    assert.equal(result.postCount, 1);
    assert.equal(result.messageId, "msg-456");
    assert.equal(result.recipient, "alerts@gmail.com");

    const mail = capturedOptions as {
      from: string;
      to: string;
      subject: string;
      text: string;
    };
    assert.equal(mail.from, "Loker Watcher <alerts@gmail.com>");
    assert.equal(mail.to, "alerts@gmail.com");
    assert.equal(mail.subject, `1 new job post — tag: "hiring"`);
    assert.ok(mail.text.includes("Hiring React dev"));
  });

  it("logs one per-surface line naming the surface (FR8)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const mockTransport = {
      sendMail: async () => ({ messageId: "msg-log" }),
    } as unknown as Transporter;

    await sendSurfaceDigest(
      { type: "linkedin", value: "hiring react" },
      samplePosts,
      sampleConfig,
      mockTransport,
    );
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.includes(
        `email: sent digest for linkedin: "hiring react" with 1 post(s) to alerts@gmail.com`,
      ),
    );
  });

  it("uses custom recipient if specified in config", async () => {
    let capturedRecipient = "";
    const mockTransport = {
      sendMail: async (options: unknown) => {
        capturedRecipient = (options as { to: string }).to;
        return { messageId: "msg-789" };
      },
    } as unknown as Transporter;

    const customConfig: EmailConfig = {
      user: "sender@gmail.com",
      pass: "pass",
      to: "recipient@company.com",
    };

    const result = await sendSurfaceDigest(tag, samplePosts, customConfig, mockTransport);
    assert.equal(result.sent, true);
    assert.equal(result.recipient, "recipient@company.com");
    assert.equal(capturedRecipient, "recipient@company.com");
  });

  it("throws fail-visible error when transport fails", async () => {
    const mockTransport = {
      sendMail: async () => {
        throw new Error("SMTP connection timeout");
      },
    } as unknown as Transporter;

    await assert.rejects(
      () => sendSurfaceDigest(tag, samplePosts, sampleConfig, mockTransport),
      /email: failed to send: SMTP connection timeout/,
    );
  });
});
```

### tests/index.test.ts — MODIFY

```ts
/**
 * Offline pipeline suite for the Gate 2 unit seam (Slice 6, D7-D9).
 * runWatcher takes every I/O boundary as an injection — env literal,
 * context-factory double, fetch double, transport double, temp state file,
 * pinned clock — so a full pipeline run executes with zero network, zero
 * browser, and zero writes inside the repo. Covers: the zero-match run
 * persisting judged ids (Gate 2), the per-surface digest loop
 * (email-per-surface: FR2 cross-surface rides, FR5 once per body, FR7
 * all-or-nothing before persist, FR8 one timing pair, FR9 riders on every
 * surface email, D3 orphan skips, D7 duplicate-surface collapse), the
 * all-seen Gate 1 byte-identity, heartbeat-disabled persistence, judge-skip
 * persistence (D3), the payload-seam mixed run, the absent-payload and belt
 * degrades (D13), the D13/D14 acquisition-shape pins, and the timeStage
 * duration measurement.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import type { Surface, WatcherConfig } from "../src/config-file.js";
import { LINKEDIN_PAYLOAD_PATH } from "../src/config.js";
import type {
  ContextFactory,
  ContextLike,
  LocatorLike,
  PageLike,
  ResponseLike,
} from "../src/fetch-threads.js";
import { flushAndSendExhaustionAlarm, runWatcher, timeStage } from "../src/index.js";
import type { AvailabilityResult } from "../src/judge-availability.js";
import { type HealthFile, loadAccountHealth } from "../src/judge-health.js";
import { isRotationExhausted } from "../src/judge-rotation.js";
import type { LlmAccount } from "../src/judge.js";
import type { PayloadRead } from "../src/linkedin-payload.js";
import type { AppState } from "../src/state.js";
import type { AccountFailure, JudgeVerdict, Post } from "../src/types.js";

// Pinned clock (UTC): 2026-10-26T09:14:00.000Z — every stage reads it
// through deps.now; the tests never touch the system clock.
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const CONFIG: WatcherConfig = {
  keywords: ["hiring"],
  candidateTerms: ["hiring", "loker"],
  surfaces: [{ type: "tag", value: "hiring" }],
  platforms: { linkedin: true, threads: true },
  recencyHours: 72,
  reasoningEffort: "medium",
  scrollRounds: 8,
};

/** Mixed-platform config: the tag surface plus one linkedin surface. */
const MIXED_CONFIG: WatcherConfig = {
  ...CONFIG,
  surfaces: [
    { type: "tag", value: "hiring" },
    { type: "linkedin", value: "#hiring" },
  ],
};

const BASE_ENV: Record<string, string | undefined> = {
  THREADS_SESSION_STATE: Buffer.from(
    JSON.stringify({ cookies: [{ name: "session", value: "x" }] }),
  ).toString("base64"),
  LLM_ACCOUNTS: JSON.stringify([
    { baseUrl: "https://mock.api/v1", apiKey: "test-key", model: "test-model" },
  ]),
  GMAIL_USER: "alerts@example.com",
  GMAIL_APP_PASSWORD: "app-password",
};

/** 19-digit post id, mirroring the judge tests' helper. */
const id19 = (n: number): string => `722463891274392${String(n).padStart(4, "0")}`;

/** Minimal graphql capture body: one thread_item per post, 1h old. */
const graphqlBody = (entries: ReadonlyArray<{ id: string; text: string }>): string =>
  JSON.stringify({
    data: {
      thread_items: entries.map((entry) => ({
        post: {
          pk: entry.id,
          caption: { text: entry.text },
          user: { username: `author-${entry.id.slice(-2)}` },
          taken_at: Math.floor((NOW - HOUR) / 1000),
        },
      })),
    },
  });

/** Response double the walk's graphql filter accepts. */
const graphqlResponse = (body: string): ResponseLike => ({
  url: () => "https://www.threads.com/api/graphql",
  status: () => 200,
  text: async () => body,
});

/** LinkedIn activity id whose embedded epoch ms equals the pinned NOW. */
const linkedinIdNow = (BigInt(NOW) << 22n).toString();

/**
 * One normalized LinkedIn post for the injected payload-reader double. The
 * optional stamps mirror a v2 payload row: the PC leg stamps rows with its
 * configured linkedin surface (Slice 2), so a payload post joins a surface
 * email only when its stamps name a configured surface (D3) — unstamped
 * legacy-shaped rows come back as orphans.
 */
const linkedinPost = (id: string, surfaces?: Surface[]): Post => ({
  platform: "linkedin",
  id: `urn:li:activity:${id}`,
  text: `LinkedIn hiring post ${id}`,
  author: "linkedin-member",
  permalink: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
  timestamp: iso(NOW),
  ...(surfaces !== undefined ? { surfaces } : {}),
});

/** The MIXED_CONFIG linkedin surface, stamped as the PC leg stamps rows. */
const stampedLinkedinPost = (id: string): Post =>
  linkedinPost(id, [{ type: "linkedin", value: "#hiring" }]);

/** Build a PayloadRead for the re-keyed linkedinFetch double (D6). */
const payloadRead = (posts: Post[], leg: PayloadRead["leg"], detail?: string): PayloadRead =>
  detail !== undefined ? { posts, leg, detail } : { posts, leg };

/** Minimal logged-out tag page: one data-sjs blob carrying the thread items. */
const tagPageHtml = (
  entries: ReadonlyArray<{ id: string; text: string; author: string }>,
): string =>
  `<html><head><script type="application/json" data-sjs="">${JSON.stringify({
    data: {
      thread_items: entries.map((entry) => ({
        post: {
          pk: entry.id,
          caption: { text: entry.text },
          user: { username: entry.author },
          taken_at: Math.floor((NOW - HOUR) / 1000),
        },
      })),
    },
  })}</script></head><body>hydrated</body></html>`;

/** Recent-tab locator that never becomes visible (both walks tolerate it). */
const missingTab = (): LocatorLike => {
  const tab: LocatorLike = {
    first: () => tab,
    waitFor: async () => {
      throw new Error("locator not found");
    },
    click: async () => undefined,
  };
  return tab;
};

/**
 * Context factory double for the authenticated walk: one page whose goto
 * fires the response listener with the given graphql capture.
 */
function singlePageContextFactory(capture: string): ContextFactory {
  return async () => {
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        const listeners: Array<(response: ResponseLike) => void> = [];
        return {
          goto: async () => {
            const response = graphqlResponse(capture);
            for (const listener of listeners) listener(response);
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => missingTab(),
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

/**
 * Context-factory double for the platform-split acquisition (Phase 4):
 * each page dispatches on its goto URL — threads URLs fire the graphql
 * capture (authenticated walk) or deliver threadsHtml via content()
 * (logged-out walk). Records every requested URL and every storage-state
 * path so a test can pin which surfaces were walked and that the session
 * temp dir was cleaned. (The LinkedIn leg rides the pushed payload since
 * slice 5 — no linkedin URL is ever walked.)
 */
function dualPlatformContextFactory(options: {
  threadsCapture: string;
  /** Page HTML for the logged-out Threads walk; absent = bare hydrated page. */
  threadsHtml?: string;
  urls?: string[];
  sessionPaths?: string[];
}): ContextFactory {
  return async (storageStatePath?: string) => {
    options.sessionPaths?.push(storageStatePath ?? "");
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => {
        const listeners: Array<(response: ResponseLike) => void> = [];
        return {
          goto: async (url: string) => {
            options.urls?.push(url);
            for (const listener of listeners) listener(graphqlResponse(options.threadsCapture));
            return undefined;
          },
          waitForFunction: async () => undefined,
          content: async () => options.threadsHtml ?? "<html><body>hydrated</body></html>",
          on: (_event, listener) => {
            listeners.push(listener);
            return undefined;
          },
          locator: () => missingTab(),
          evaluate: async () => undefined,
          waitForTimeout: async () => undefined,
          close: async () => undefined,
        };
      },
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
}

/** Chat-completions 200 response carrying one message. */
const ok = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

/**
 * Chat-completions double: bulk calls answer every listed id with the given
 * verdict; single-post fallbacks answer the plain verdict object.
 */
function judgeFetch(verdict: JudgeVerdict): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each post below")) {
      const ids = content.match(/\b(?:urn:li:activity:)?\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) answer[id] = verdict;
      return ok(JSON.stringify(answer));
    }
    return ok(JSON.stringify(verdict));
  }) as unknown as typeof fetch;
}

/**
 * Bulk answers exactly the ids present in the verdict map (missing ids stay
 * absent — the post falls back); single-post retries fail with a 500 so the
 * fallback exhausts and the post is skipped (D3). The 500 shape and its
 * bounded backoff are the same pin the judge suite already ships.
 */
function partialBulkThenFailFetch(verdicts: Record<string, JudgeVerdict>): typeof fetch {
  return (async (_url: unknown, options?: unknown): Promise<Response> => {
    const body = JSON.parse((options as { body: string }).body) as {
      messages: Array<{ content: string }>;
    };
    const content = body.messages[1]?.content ?? "";
    if (content.includes("Judge each post below")) {
      const ids = content.match(/\b\d{16,}\b/g) ?? [];
      const answer: Record<string, JudgeVerdict> = {};
      for (const id of ids) {
        const verdict = verdicts[id];
        if (verdict !== undefined) answer[id] = verdict;
      }
      return ok(JSON.stringify(answer));
    }
    return new Response("Internal Server Error", { status: 500 });
  }) as unknown as typeof fetch;
}

/** Transport double recording subject lines and plain-text bodies. */
function recordingTransport() {
  const subjects: string[] = [];
  const texts: string[] = [];
  const transport = {
    sendMail: async (options: { subject: string; text: string }) => {
      subjects.push(options.subject);
      texts.push(options.text);
      return { messageId: "msg-1" };
    },
  } as unknown as Transporter;
  return { transport, subjects, texts };
}

/**
 * Pass-all availability double (D10): every judge-stage test injects it.
 * The DEFAULT checker would probe the judge fetch doubles — a 429/500
 * answer would mis-mark accounts unavailable, and the all-down skip
 * branch would flip mid-run exhaustion tests into green skip runs.
 */
const availabilityPassAll = async (): Promise<AvailabilityResult> => ({
  failures: [],
  degraded: false,
});

/** Three-account pool for the some-pass, all-down, and degrade scenarios. */
const THREE_ACCOUNT_ENV: Record<string, string | undefined> = {
  ...BASE_ENV,
  LLM_ACCOUNTS: JSON.stringify([
    { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
    { baseUrl: "https://two.api/v1", apiKey: "k2", model: "m2" },
    { baseUrl: "https://three.api/v1", apiKey: "k3", model: "m3" },
  ]),
};

const threeAccounts: LlmAccount[] = [
  { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
  { baseUrl: "https://two.api/v1", apiKey: "k2", model: "m2" },
  { baseUrl: "https://three.api/v1", apiKey: "k3", model: "m3" },
];

// Temp state files (offline rule: OS temp only, cleaned up once).
let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Temp state file path; seeds the file with a state document when given. */
async function tempStatePath(name: string, seed?: AppState): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));
  const path = join(dir, name);
  if (seed !== undefined) {
    await writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  }
  return path;
}

/** Temp health-file path for the flush assertions (same lazy dir). */
async function tempHealthPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-index-"));
  return join(dir, name);
}

describe("runWatcher", () => {
  it("persists judged ids on a zero-match run and still sends the heartbeat (Gate 2)", async () => {
    const posts = [
      { id: id19(1), text: "Looking for work as a frontend developer" },
      { id: id19(2), text: "Selling an ergonomic chair, barely used" },
    ];
    const statePath = await tempStatePath("gate2-zero-match.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 0, skipped: 0, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.equal(stored.version, 2);
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(1), id19(2)]);
    assert.equal(subjects.length, 1); // Gate 2 skips neither email nor write
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("sends the digest and persists judged ids when posts match", async () => {
    const posts = [
      { id: id19(3), text: "Hiring: senior backend engineer, remote in Indonesia" },
      { id: id19(4), text: "Hiring: frontend developer in Jakarta" },
    ];
    const statePath = await tempStatePath("match-digest.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 2, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `2 new job posts — tag: "hiring"`);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(3), id19(4)]);
  });

  it("leaves the state file byte-identical when everything is already seen (Gate 1) and still sends the heartbeat", async () => {
    const posts = [
      { id: id19(5), text: "Hiring: react developer, bandung on-site" },
      { id: id19(6), text: "Hiring: data analyst, remote" },
    ];
    const seed: AppState = {
      version: 2,
      seenPostIds: { [id19(5)]: iso(NOW - HOUR), [id19(6)]: iso(NOW - HOUR) },
    };
    const statePath = await tempStatePath("gate1-all-seen.json", seed);
    const before = await readFile(statePath, "utf8");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(await readFile(statePath, "utf8"), before);
    assert.equal(subjects.length, 1); // Gate 1 still notifies
    assert.match(subjects[0] ?? "", /0 new matches/);
  });

  it("still persists judged ids when the heartbeat is disabled", async () => {
    const posts = [{ id: id19(7), text: "Junior QA engineer opening in Surabaya" }];
    const statePath = await tempStatePath("heartbeat-off.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: { ...BASE_ENV, HEARTBEAT_ENABLED: "false" },
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.equal(subjects.length, 0); // disabled — yet the state write still ran
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(7)]);
  });

  it("keeps judge-skipped ids unseen while persisting the judged rest (D3)", async () => {
    const posts = [
      { id: id19(8), text: "Hiring: golang engineer, remote" },
      { id: id19(9), text: "Hiring: vue developer in Bali" },
    ];
    const statePath = await tempStatePath("skip-d3.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: partialBulkThenFailFetch({ [id19(8)]: { relevant: true, locationOk: true } }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 1, skipped: 1, saved: true });
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(8)]); // the skipped id stays unseen
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — tag: "hiring"`);
  });

  it("rejects with the complete pool-ordered exhaustion record and never touches state at budget death", async () => {
    const posts = [{ id: id19(10), text: "Hiring: rust engineer, remote" }];
    const statePath = await tempStatePath("budget-death.json");
    const { transport, subjects } = recordingTransport();
    // Hand-stepped clock + inert park: three cooldown parks drain the
    // 3-minute budget instantly.
    let tick = 0;
    const now = (): number => tick;
    const sleepFn = (ms: number): Promise<void> => {
      tick += ms;
      return Promise.resolve();
    };
    const all429 = (async (): Promise<Response> =>
      new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await runWatcher({
        env: BASE_ENV,
        config: CONFIG,
        contextFactory: singlePageContextFactory(graphqlBody(posts)),
        fetchFn: all429,
        judgeAvailability: availabilityPassAll,
        transport,
        statePath,
        now,
        sleepFn,
      });
    } catch (error) {
      caught = error;
    }

    // The entry guard's contract: the tagged error with the complete
    // record — it turns that into exactly one exhaustion email + exit 1.
    assert.ok(isRotationExhausted(caught));
    assert.deepEqual(
      (caught as { failures: Array<{ account: number }> }).failures.map((f) => f.account),
      [1],
    );
    // The judge throw happened before any notification or persistence:
    // no email fired, and the state file was never written.
    assert.deepEqual(subjects, []);
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/);
  });

  it("walks a mixed run: Threads through its session, LinkedIn through the pushed payload, and cleans the session dir", async () => {
    const urls: string[] = [];
    const sessionPaths: string[] = [];
    const linkedinCalls: Array<{ path: string; nowMs: number }> = [];
    const statePath = await tempStatePath("mixed-platform.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([
          { id: id19(11), text: "Hiring: python developer, jakarta remote" },
          { id: id19(12), text: "Hiring: devops engineer, bandung on-site" },
        ]),
        urls,
        sessionPaths,
      }),
      linkedinFetch: async (path, nowFn) => {
        linkedinCalls.push({ path, nowMs: nowFn() });
        return payloadRead([stampedLinkedinPost(linkedinIdNow)], "ok", "payload 0 min old");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 3, matches: 3, skipped: 0, saved: true });
    // One email per surface, in config order (D6): the tag email first, the
    // linkedin email second — the combined Threads+LinkedIn subject form
    // is gone.
    assert.equal(subjects.length, 2);
    assert.equal(subjects[0], `2 new job posts — tag: "hiring"`);
    assert.equal(subjects[1], `1 new job post — linkedin: "#hiring"`);
    // The reader got the fixed repo payload path and the injected clock.
    assert.deepEqual(linkedinCalls, [{ path: LINKEDIN_PAYLOAD_PATH, nowMs: NOW }]);
    // The Playwright walk never drove a linkedin URL...
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    // ...the tag email carries only the threads posts (no [linkedin] token),
    // the linkedin email carries the payload post with its token, and an ok
    // leg renders no rider line on either email (D13)...
    assert.ok(texts[0]?.includes("1. Hiring: python developer, jakarta remote"));
    assert.ok(!texts[0]?.includes("[linkedin]"));
    assert.ok(texts[1]?.includes("1. [linkedin] LinkedIn hiring post"));
    assert.ok(!texts[0]?.includes("LinkedIn leg:"));
    assert.ok(!texts[1]?.includes("LinkedIn leg:"));
    // ...both platform id forms reached the state file...
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [
      id19(11),
      id19(12),
      `urn:li:activity:${linkedinIdNow}`,
    ]);
    // ...and the Threads session temp file died with the run (F019; the
    // payload reader keeps no session dir — cookies ride the PC leg).
    assert.equal(sessionPaths.length, 1);
    for (const path of sessionPaths) {
      await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
    }
  });

  it("completes threads-only when the payload is absent, rendering the absent leg on the heartbeat", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const urls: string[] = [];
    const statePath = await tempStatePath("linkedin-payload-absent.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([{ id: id19(13), text: "Hiring: react developer, remote" }]),
        urls,
      }),
      linkedinFetch: async () => payloadRead([], "absent"),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    // The absent payload is the PC-off NORMAL (D13): a green threads-only
    // run, zero linkedin warns (the reader logs one quiet line instead).
    assert.deepEqual(run, { judged: 1, matches: 0, skipped: 0, saved: true });
    assert.ok(urls.every((url) => !url.includes("linkedin.com")));
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !/linkedin/.test(line)));
    // The Gate 2 heartbeat renders the absent leg line — a threads-only run
    // is permanently quiet, so the heartbeat is where the dark leg shows.
    assert.equal(subjects.length, 1);
    assert.ok(texts[0]?.includes("LinkedIn leg: absent — no payload file"));
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(13)]);
  });

  it("degrades a linkedin-only config with an absent payload to a quiet threads-only heartbeat (Gate 1)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-only-absent.json");
    const { transport, subjects, texts } = recordingTransport();
    let linkedinCalls = 0;

    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: no threads surfaces
      linkedinFetch: async () => {
        linkedinCalls += 1;
        return payloadRead([], "absent");
      },
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(linkedinCalls, 1, "the reader runs whenever linkedin surfaces are configured");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !/linkedin/.test(line))); // absent is a quiet log, never a warn
    assert.equal(subjects.length, 1); // the Gate 1 heartbeat still fires
    assert.ok(texts[0]?.includes("LinkedIn leg: absent — no payload file"));
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // nothing persisted
  });

  it("keeps Threads results when the payload read faults at run time (acceptance 1, the D12 belt)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("linkedin-payload-throws.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: { ...BASE_ENV, THREADS_SESSION_STATE: undefined }, // logged-out Threads walk
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        threadsCapture: graphqlBody([]), // unused: the Threads walk is logged-out
        threadsHtml: tagPageHtml([
          { id: id19(14), text: "Hiring: kotlin developer, jakarta", author: "techco" },
        ]),
      }),
      linkedinFetch: async () => {
        throw new Error("payload io exploded");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    // The belt degrades the fault to a warn + a malformed leg; the
    // logged-out Threads posts survive and the run completes (exit 0 shape).
    // The logged-out walk stamps from the page's own pair (D2), so the
    // match joins the tag surface email.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /linkedin payload FAILED — payload io exploded/.test(line)));
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — tag: "hiring"`);
    // The not-ok leg rides the digest (D13).
    assert.ok(texts[0]?.includes("LinkedIn leg: malformed — payload io exploded"));
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [id19(14)]);
  });

  it("renders the stale leg line on a match-run digest even when the leg contributed no posts (D13)", async () => {
    const statePath = await tempStatePath("stale-leg-digest.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: singlePageContextFactory(
        graphqlBody([{ id: id19(16), text: "Hiring: scala developer, remote" }]),
      ),
      linkedinFetch: async () => payloadRead([], "stale", "payload 3h old"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    // One threads match; the stale leg rides the surface email so a dark
    // leg stays visible on a match run too.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — tag: "hiring"`);
    assert.ok(!texts[0]?.includes("[linkedin]")); // the stale leg contributed no posts
    assert.ok(texts[0]?.includes("\n\nLinkedIn leg: stale — payload 3h old\n"));
  });

  it("keeps LinkedIn posts on a linkedin-only config when a Threads session exists (D13 single return)", async () => {
    const statePath = await tempStatePath("linkedin-only-with-threads-session.json");
    const { transport, subjects } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV, // THREADS_SESSION_STATE present
      config: { ...CONFIG, surfaces: [{ type: "linkedin", value: "#hiring" }] },
      contextFactory: singlePageContextFactory(graphqlBody([])), // never driven: zero threads surfaces
      linkedinFetch: async () => payloadRead([stampedLinkedinPost(linkedinIdNow)], "ok"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    // The old empty-pool guard returned [] before the LinkedIn arm ran;
    // the single return keeps the LinkedIn posts (D13).
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — linkedin: "#hiring"`);
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds), [`urn:li:activity:${linkedinIdNow}`]);
  });

  it("logs every surface from the raw config partition in the startup line (D14)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const statePath = await tempStatePath("startup-surface-line.json");
    const { transport } = recordingTransport();

    await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: dualPlatformContextFactory({
        // A real post: an EMPTY authenticated capture trips the kept
        // all-fail gate and the run dies before the startup line is logged.
        threadsCapture: graphqlBody([{ id: id19(15), text: "Hiring: golang developer, remote" }]),
      }),
      linkedinFetch: async () => payloadRead([], "absent"),
      fetchFn: judgeFetch({ relevant: false, locationOk: false }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /watch: surfaces: tag\/hiring, linkedin\/#hiring/.test(line)));
  });

  it("threads off: LinkedIn posts flow through the payload and no Threads walk runs", async () => {
    const statePath = await tempStatePath("threads-off.json");
    const { transport, subjects, texts } = recordingTransport();
    let payloadReads = 0;
    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...MIXED_CONFIG, platforms: { linkedin: true, threads: false } },
      contextFactory: async () => {
        throw new Error("the Threads walker must not run while platforms.threads is false");
      },
      linkedinFetch: async () => {
        payloadReads += 1;
        return payloadRead([stampedLinkedinPost(linkedinIdNow)], "ok");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.equal(payloadReads, 1);
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — linkedin: "#hiring"`);
    assert.doesNotMatch(subjects[0] ?? "", /Threads/);
    assert.ok(texts[0]?.includes("LinkedIn hiring post"));
  });

  it("both on: a LinkedIn-only match renders a LinkedIn-only subject", async () => {
    const statePath = await tempStatePath("linkedin-only-subject.json", {
      version: 2,
      seenPostIds: { [id19(41)]: iso(NOW - HOUR) }, // the Threads post is already seen — it never reaches the judge
    });
    const { transport, subjects } = recordingTransport();
    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: singlePageContextFactory(
        graphqlBody([{ id: id19(41), text: "Hiring: golang developer, remote" }]),
      ), // the Threads walk is healthy; everything it captured is already seen
      linkedinFetch: async () => payloadRead([stampedLinkedinPost(linkedinIdNow)], "ok"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — linkedin: "#hiring"`);
    assert.doesNotMatch(subjects[0] ?? "", /Threads/);
  });

  it("linkedin off: the payload reader is never called and the Threads walk still runs", async () => {
    const posts = [{ id: id19(31), text: "Hiring: svelte developer, remote" }];
    const statePath = await tempStatePath("linkedin-off.json");
    const { transport, subjects } = recordingTransport();
    let payloadReads = 0;
    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...MIXED_CONFIG, platforms: { linkedin: false, threads: true } },
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      linkedinFetch: async () => {
        payloadReads += 1;
        return payloadRead([], "absent");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.equal(payloadReads, 0);
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — tag: "hiring"`);
    assert.doesNotMatch(subjects[0] ?? "", /LinkedIn/);
  });

  it("both off: the parked run fetches nothing, emails nothing, and never touches state", async () => {
    const statePath = await tempStatePath("both-off.json");
    const { transport, subjects } = recordingTransport();
    let payloadReads = 0;
    const run = await runWatcher({
      env: BASE_ENV,
      config: { ...MIXED_CONFIG, platforms: { linkedin: false, threads: false } },
      contextFactory: async () => {
        throw new Error("no fetch stage work may run while both platforms are off");
      },
      linkedinFetch: async () => {
        payloadReads += 1;
        return payloadRead([], "absent");
      },
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
    });

    assert.equal(payloadReads, 0);
    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(subjects.length, 0); // no heartbeat, no digest
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // never read, never written
  });
});

describe("per-surface notify loop (email-per-surface)", () => {
  it("a post collected by two surfaces rides both surface emails, once per body (FR2, FR5, FR8)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [
      { id: id19(42), text: "Hiring: senior backend engineer, remote in Indonesia" },
      { id: id19(43), text: "Hiring: frontend developer in Jakarta" },
    ];
    const statePath = await tempStatePath("fr2-ride.json");
    const { transport, subjects, texts } = recordingTransport();

    // Both tag walks capture the same two posts: the dedupe union merge
    // (D5) keeps first-seen order and unions the stamps, so each post
    // carries both surface stamps and joins both groups.
    const run = await runWatcher({
      env: BASE_ENV,
      config: {
        ...CONFIG,
        surfaces: [
          { type: "tag", value: "hiring" },
          { type: "tag", value: "loker" },
        ],
      },
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    assert.deepEqual(run, { judged: 2, matches: 2, skipped: 0, saved: true });
    // One email per surface, config order (D6) — two surfaces, two emails.
    assert.equal(subjects.length, 2);
    assert.equal(subjects[0], `2 new job posts — tag: "hiring"`);
    assert.equal(subjects[1], `2 new job posts — tag: "loker"`);
    // FR2: the shared post rides both bodies...
    for (const text of texts) {
      assert.ok(text?.includes("Hiring: senior backend engineer, remote in Indonesia"));
      assert.ok(text?.includes("Hiring: frontend developer in Jakarta"));
    }
    // ...FR5: exactly once per body — no duplicate render inside one email.
    const shared = texts[0] ?? "";
    assert.equal(
      shared.indexOf("Hiring: senior backend engineer"),
      shared.lastIndexOf("Hiring: senior backend engineer"),
    );
    // FR8: one timing pair for the whole loop, one sent-line per email.
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.filter((line) => line.startsWith("timing: notify")).length, 1);
    assert.equal(lines.filter((line) => line.includes("email: sent digest for")).length, 2);
    // The state write still landed (notify-before-persist held for both).
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(Object.keys(stored.seenPostIds).sort(), [id19(42), id19(43)]);
  });

  it("collapses duplicate configured surfaces to one email (D7)", async () => {
    const posts = [{ id: id19(44), text: "Hiring: embedded c developer, bandung" }];
    const statePath = await tempStatePath("d7-collapse.json");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: {
        ...CONFIG,
        surfaces: [
          { type: "tag", value: "hiring" },
          { type: "tag", value: "hiring" },
        ],
      },
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    // The load-time warn lives in readSurfaces (config-file suite); the run
    // itself groups on the type|value key, so the duplicate collapses to
    // one group and one email.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — tag: "hiring"`);
    assert.ok(texts[0]?.includes("Hiring: embedded c developer, bandung"));
  });

  it("skips matches whose stamps name no configured surface, with one loud warn each (D3)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const statePath = await tempStatePath("d3-orphans.json");
    const { transport, subjects } = recordingTransport();
    const retiredId = (BigInt(NOW - HOUR) << 22n).toString();

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: singlePageContextFactory(
        graphqlBody([{ id: id19(45), text: "Hiring: react developer, remote" }]),
      ),
      linkedinFetch: async () =>
        payloadRead(
          [
            // A row stamped by a surface that left the config...
            linkedinPost(linkedinIdNow, [{ type: "linkedin", value: "retired-query" }]),
            // ...and a legacy-shaped row with no stamps at all.
            linkedinPost(retiredId),
          ],
          "ok",
        ),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
    });

    // Three matches judged; only the threads post joins an email.
    assert.deepEqual(run, { judged: 3, matches: 3, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — tag: "hiring"`);
    // One loud warn per orphan, naming id + stamps + the remedy.
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) =>
        line.includes(
          `notify: match urn:li:activity:${linkedinIdNow} carries no configured surface (linkedin/retired-query)`,
        ),
      ),
    );
    assert.ok(
      lines.some((line) =>
        line.includes(
          `notify: match urn:li:activity:${retiredId} carries no configured surface (no stamps)`,
        ),
      ),
    );
    // The orphans were still JUDGED — persistJudged marks every judged id,
    // so the next run never re-judges them (the loss is loud, not silent).
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(
      Object.keys(stored.seenPostIds).sort(),
      [id19(45), `urn:li:activity:${linkedinIdNow}`, `urn:li:activity:${retiredId}`].sort(),
    );
  });

  it("a failed surface email rejects the run before persist; the earlier email is already out (FR7)", async () => {
    const posts = [
      { id: id19(46), text: "Hiring: rails developer, remote" },
      { id: id19(47), text: "Hiring: django developer, jakarta" },
    ];
    const statePath = await tempStatePath("fr7-mid-loop.json");
    const subjects: string[] = [];
    let sendCount = 0;
    const transport = {
      sendMail: async (options: { subject: string }) => {
        sendCount += 1;
        if (sendCount === 1) {
          subjects.push(options.subject);
          return { messageId: "msg-1" };
        }
        throw new Error("smtp died mid-loop");
      },
    } as unknown as Transporter;

    // Two tag surfaces, same capture: both match, the SECOND surface's
    // email is the one that fails.
    let caught: unknown;
    try {
      await runWatcher({
        env: BASE_ENV,
        config: {
          ...CONFIG,
          surfaces: [
            { type: "tag", value: "hiring" },
            { type: "tag", value: "loker" },
          ],
        },
        contextFactory: singlePageContextFactory(graphqlBody(posts)),
        fetchFn: judgeFetch({ relevant: true, locationOk: true }),
        judgeAvailability: availabilityPassAll,
        transport,
        statePath,
        now: () => NOW,
      });
    } catch (error) {
      caught = error;
    }

    // sendText wraps the transport error fail-visibly; the run rejects...
    assert.match((caught as Error).message, /email: failed to send: smtp died mid-loop/);
    // ...the FIRST surface email was already out and the second never
    // rendered...
    assert.deepEqual(subjects, [`2 new job posts — tag: "hiring"`]);
    assert.equal(sendCount, 2);
    // ...and state was never reached: the next run re-judges and re-sends
    // both surfaces whole (F021's accepted duplicate is the failure
    // currency).
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/);
  });

  it("the leg and degraded riders ride EVERY surface email when present (FR9)", async () => {
    const statePath = await tempStatePath("fr9-riders.json");
    const { transport, subjects, texts } = recordingTransport();
    const DEGRADED = "Degraded LLM account(s): #1 https://mock.api/v1 — capped at 1 request/tick";

    const run = await runWatcher({
      env: BASE_ENV,
      config: MIXED_CONFIG,
      contextFactory: singlePageContextFactory(
        graphqlBody([{ id: id19(48), text: "Hiring: scala developer, remote" }]),
      ),
      linkedinFetch: async () =>
        payloadRead([stampedLinkedinPost(linkedinIdNow)], "stale", "payload 3h old"),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      judgeAvailability: availabilityPassAll,
      transport,
      statePath,
      now: () => NOW,
      judgeHealth: async () => ({
        marks: new Map([[0, 2]]),
        file: { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
      }),
    });

    // Two matches, two emails; the not-ok leg AND the degraded line ride
    // both (FR9 — riders are per-email, not per-run).
    assert.deepEqual(run, { judged: 2, matches: 2, skipped: 0, saved: true });
    assert.equal(subjects.length, 2);
    assert.equal(subjects[0], `1 new job post — tag: "hiring"`);
    assert.equal(subjects[1], `1 new job post — linkedin: "#hiring"`);
    for (const text of texts) {
      assert.ok(text?.includes("\n\nLinkedIn leg: stale — payload 3h old\n"));
      assert.ok(text?.includes(DEGRADED));
    }
    const stored = JSON.parse(await readFile(statePath, "utf8")) as AppState;
    assert.deepEqual(
      Object.keys(stored.seenPostIds).sort(),
      [id19(48), `urn:li:activity:${linkedinIdNow}`].sort(),
    );
  });
});

// Provider health (the entry wiring): the resolve above Gate 1, the marks
// arg into judgePosts, the success-path flush, and the Gate-1 no-flush pin.
describe("provider health (the entry wiring)", () => {
  it("acceptance: hard-fail builds a streak, the second tick caps, and a probe success clears and rejoins", async () => {
    const posts = [
      { id: id19(20), text: "Hiring: elixir developer, remote" },
      { id: id19(21), text: "Hiring: react native developer, jakarta" },
    ];
    const statePath = await tempStatePath("acceptance-state.json");
    const healthPath = await tempHealthPath("acceptance-health.json");
    const { transport, subjects, texts } = recordingTransport();
    let accountOneOk = false;
    const auths: string[] = [];
    const fetchFn = (async (url: unknown): Promise<Response> => {
      auths.push(new URL(String(url)).host);
      if (!accountOneOk) {
        return new Response("Service Unavailable", { status: 503 });
      }
      // The recovered endpoint answers the whole batch in one call.
      return ok(
        JSON.stringify({
          [id19(20)]: { relevant: true, locationOk: true },
          [id19(21)]: { relevant: true, locationOk: true },
        }),
      );
    }) as unknown as typeof fetch;
    const runOnce = async (): Promise<{
      judged: number;
      matches: number;
      skipped: number;
      saved: boolean;
    }> =>
      runWatcher({
        env: BASE_ENV,
        config: CONFIG,
        contextFactory: singlePageContextFactory(graphqlBody(posts)),
        fetchFn,
        judgeAvailability: availabilityPassAll,
        transport,
        statePath,
        now: () => NOW,
        sleepFn: () => Promise.resolve(), // inert: the 503 backoffs never wait
        judgeHealth: (accounts) => loadAccountHealth(accounts, healthPath),
        judgeHealthPath: healthPath,
      });

    // Tick 1: the 503 stamps a hard failure — the streak builds to 1 (not yet capped).
    assert.deepEqual(await runOnce(), { judged: 2, matches: 0, skipped: 2, saved: false });
    assert.equal(auths.length, 4); // the terminal attempt + the three same-account backoffs
    let stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.marks["https://mock.api/v1"], 1);

    // Tick 2: the second hard-failed tick — the streak reaches the cap threshold.
    assert.deepEqual(await runOnce(), { judged: 2, matches: 0, skipped: 2, saved: false });
    stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.marks["https://mock.api/v1"], 2);

    // Tick 3: capped at 1 request/tick — the probe. The endpoint recovered:
    // the success clears the mark in-run and the batch answers in that call.
    auths.length = 0;
    accountOneOk = true;
    assert.deepEqual(await runOnce(), { judged: 2, matches: 2, skipped: 0, saved: true });
    assert.equal(auths.length, 1); // exactly the probe dispatch — half-open
    // Three emails: two Gate-2 heartbeats, then the match digest — which
    // still renders the degraded line (the load-time marks were capped).
    assert.equal(subjects.length, 3);
    assert.equal(subjects[2], `2 new job posts — tag: "hiring"`);
    assert.ok(
      texts[2]?.includes(
        "Degraded LLM account(s): #1 https://mock.api/v1 — capped at 1 request/tick",
      ),
    );
    // The flush cleared the mark (the success reset the streak).
    stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.deepEqual(stored.marks, {});
    assert.equal(stored.outageOpen, false);
  });

  it("renders the degraded-accounts line on the Gate 1 heartbeat — marks load above the gate", async () => {
    const posts = [{ id: id19(22), text: "Hiring: pragma developer, remote" }];
    const seed: AppState = {
      version: 2,
      seenPostIds: { [id19(22)]: iso(NOW - HOUR) },
    };
    const statePath = await tempStatePath("gate1-degraded.json", seed);
    const before = await readFile(statePath, "utf8");
    const { transport, subjects, texts } = recordingTransport();

    const run = await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
      judgeHealth: async () => ({
        marks: new Map([[0, 2]]),
        file: { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
      }),
    });

    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 0, saved: false });
    assert.equal(await readFile(statePath, "utf8"), before); // Gate 1: state untouched
    assert.equal(subjects.length, 1); // the Gate 1 heartbeat still fires
    assert.ok(
      texts[0]?.includes(
        "Degraded LLM account(s): #1 https://mock.api/v1 — capped at 1 request/tick",
      ),
    );
  });

  it("never flushes health on Gate 1 — zero dispatches cannot clear marks (FR7)", async () => {
    const posts = [{ id: id19(23), text: "Hiring: elm developer, remote" }];
    const seed: AppState = { version: 2, seenPostIds: { [id19(23)]: iso(NOW - HOUR) } };
    const statePath = await tempStatePath("gate1-no-flush.json", seed);
    const healthPath = await tempHealthPath("gate1-no-flush-health.json");
    const { transport } = recordingTransport();

    await runWatcher({
      env: BASE_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: judgeFetch({ relevant: true, locationOk: true }),
      transport,
      statePath,
      now: () => NOW,
      judgeHealth: async () => ({
        marks: new Map([[0, 2]]),
        file: { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
      }),
      judgeHealthPath: healthPath,
    });

    await assert.rejects(() => readFile(healthPath, "utf8"), /ENOENT/);
  });
});

describe("availability pre-check (the entry wiring)", () => {
  it("runs the default checker over deps.fetchFn — an all-pass pool behaves exactly as today (FR4)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [{ id: id19(30), text: "Hiring: ruby developer, remote" }];
    const statePath = await tempStatePath("availability-all-pass.json");
    const { transport, subjects } = recordingTransport();
    const bodies: string[] = [];
    const judgeDouble = judgeFetch({ relevant: true, locationOk: true }) as (
      url: unknown,
      options?: unknown,
    ) => Promise<Response>;
    const probingFetch = (async (url: unknown, options?: unknown): Promise<Response> => {
      bodies.push((options as { body: string }).body);
      return judgeDouble(url, options);
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: probingFetch,
      transport,
      statePath,
      now: () => NOW,
    });

    // FR4: same digest, same persistence — the only additions are the
    // availability log lines.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], `1 new job post — tag: "hiring"`);
    // One tiny probe per account rode the same production fetch default,
    // then the judged batch.
    const probeBodies = bodies.filter((body) => body.includes("Reply with the single word"));
    assert.equal(probeBodies.length, 3);
    assert.equal(bodies.length - probeBodies.length, 1);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /availability: 3 of 3 account\(s\) available/.test(line)));
  });

  it("some-pass: refused accounts sit out with their reason and only survivors dispatch", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [{ id: id19(31), text: "Hiring: swift developer, remote" }];
    const statePath = await tempStatePath("availability-some-pass.json");
    const { transport, subjects } = recordingTransport();
    const judgeHosts: string[] = [];
    const fetchFn = (async (url: unknown): Promise<Response> => {
      judgeHosts.push(new URL(String(url)).host);
      return ok(JSON.stringify({ [id19(31)]: { relevant: true, locationOk: true } }));
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({
        failures: [
          { account: 1, baseUrl: "https://one.api/v1", reason: "HTTP 429" },
          { account: 3, baseUrl: "https://three.api/v1", reason: "HTTP 503" },
        ],
        degraded: false,
      }),
    });

    // The run completed on the survivors and the digest went out.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    // The refused seats never dispatched: only the survivor's host called.
    assert.ok(judgeHosts.length > 0);
    assert.ok(judgeHosts.every((host) => host === "two.api"));
    // The sit-out lines name each refused account with its real reason.
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => /account 1 \(https:\/\/one\.api\/v1\) sits out — HTTP 429/.test(line)),
    );
    assert.ok(
      lines.some((line) => /account 3 \(https:\/\/three\.api\/v1\) sits out — HTTP 503/.test(line)),
    );
    assert.ok(lines.some((line) => /availability: 1 of 3 account\(s\) available/.test(line)));
  });

  it("all-down: no judge call, ids stay unseen, one alarm reads 3 of 3, exit-0 run shape", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const posts = [
      { id: id19(32), text: "Hiring: php developer, remote" },
      { id: id19(33), text: "Hiring: laravel developer, bandung" },
    ];
    const statePath = await tempStatePath("availability-all-down.json");
    const healthPath = await tempHealthPath("availability-all-down-health.json");
    const { transport, subjects, texts } = recordingTransport();
    let judgeCalls = 0;
    const fetchFn = (async (): Promise<Response> => {
      judgeCalls += 1;
      return ok("{}");
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({
        failures: [
          { account: 1, baseUrl: "https://one.api/v1", reason: "HTTP 429" },
          { account: 2, baseUrl: "https://two.api/v1", reason: "network error: socket hang up" },
          {
            account: 3,
            baseUrl: "https://three.api/v1",
            reason: "unusable answer: missing message content",
          },
        ],
        degraded: false,
      }),
      judgeHealth: (accounts) => loadAccountHealth(accounts, healthPath),
      judgeHealthPath: healthPath,
    });

    // FR5: the honest skip run — exit 0 by resolution, nothing judged,
    // nothing persisted, the alarm the only mail (no heartbeat on skip).
    assert.deepEqual(run, { judged: 0, matches: 0, skipped: 2, saved: false });
    assert.equal(judgeCalls, 0); // no judge call reached the dead pool
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // ids stay unseen
    assert.equal(subjects.length, 1); // the alarm, not the heartbeat
    assert.match(subjects[0] ?? "", /LLM judge pool exhausted \(3 of 3 accounts failed\)/);
    assert.ok(texts[0]?.includes("1. account 1 (https://one.api/v1) — HTTP 429"));
    assert.ok(!texts[0]?.includes("Still working")); // no survivors line
    // The run log names 0 of N: the counts line and the skip line.
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /availability: 0 of 3 account\(s\) available/.test(line)));
    assert.ok(lines.some((line) => /skipping the judge stage/.test(line)));
    // The skip flush flipped the episode bit and preserved every mark
    // (empty outcomes — pre-check 429s never reach the marks merge).
    const stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    assert.deepEqual(stored.marks, {});
  });

  it("two consecutive skips alarm once and preserve marks: the skip flush passes empty outcomes", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const posts = [{ id: id19(34), text: "Hiring: go developer, remote" }];
    const statePath = await tempStatePath("availability-dedup-state.json");
    const healthPath = await tempHealthPath("availability-dedup-health.json");
    // Seed: one account mid-streak, no open episode — the skip flushes
    // must not touch the mark (a pre-check refusal is NOT a provider
    // health failure) and the second tick must not re-alarm.
    await writeFile(
      healthPath,
      `${JSON.stringify(
        { version: 1, marks: { "https://mock.api/v1": 2 }, outageOpen: false },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const { transport, subjects } = recordingTransport();
    const deps = {
      env: BASE_ENV, // the single-account pool
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn: (async (): Promise<Response> => {
        throw new Error("judge must never dispatch on a skip run");
      }) as unknown as typeof fetch,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({
        failures: [{ account: 1, baseUrl: "https://mock.api/v1", reason: "HTTP 429" }],
        degraded: false,
      }),
      judgeHealth: (accounts: readonly LlmAccount[]) => loadAccountHealth(accounts, healthPath),
      judgeHealthPath: healthPath,
    };

    // Tick 1: the episode opens and the alarm fires.
    assert.deepEqual(await runWatcher(deps), { judged: 0, matches: 0, skipped: 1, saved: false });
    assert.equal(subjects.length, 1);
    // Tick 2: same pool, same refusal — the open bit suppresses.
    assert.deepEqual(await runWatcher(deps), { judged: 0, matches: 0, skipped: 1, saved: false });
    assert.equal(subjects.length, 1); // one alarm per episode
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /outage episode already open/.test(line)));
    // The seeded mark survived both skip flushes verbatim; the bit is open.
    const stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.deepEqual(stored.marks, { "https://mock.api/v1": 2 });
    assert.equal(stored.outageOpen, true);
    await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/);
  });

  it("a degraded checker result runs the stage unfiltered — the tick never crashes on the pre-check", async () => {
    const posts = [{ id: id19(35), text: "Hiring: kotlin developer, remote" }];
    const statePath = await tempStatePath("availability-degraded.json");
    const { transport, subjects } = recordingTransport();
    let judgeCalls = 0;
    const fetchFn = (async (): Promise<Response> => {
      judgeCalls += 1;
      return ok(JSON.stringify({ [id19(35)]: { relevant: true, locationOk: true } }));
    }) as unknown as typeof fetch;

    const run = await runWatcher({
      env: THREE_ACCOUNT_ENV,
      config: CONFIG,
      contextFactory: singlePageContextFactory(graphqlBody(posts)),
      fetchFn,
      transport,
      statePath,
      now: () => NOW,
      judgeAvailability: async () => ({ failures: [], degraded: true }),
    });

    // Degraded = all-available: the judge dispatched, the run completed.
    assert.deepEqual(run, { judged: 1, matches: 1, skipped: 0, saved: true });
    assert.equal(subjects.length, 1);
    assert.ok(judgeCalls >= 1);
  });

  it("the extracted alarm helper passes the pool size: a mid-run record reads 2 of 3 (D8/D9)", async () => {
    const healthPath = await tempHealthPath("availability-wording-health.json");
    const { transport, subjects, texts } = recordingTransport();
    const alarmDeps = {
      accounts: threeAccounts,
      health: { marks: new Map<number, number>(), file: undefined },
      outcomes: { ok: [] as number[], failed: new Map<number, string>() },
      failures: [
        { account: 1, baseUrl: "https://one.api/v1", reason: "HTTP 429" },
        { account: 2, baseUrl: "https://two.api/v1", reason: "network error: socket hang up" },
      ] as AccountFailure[],
      env: BASE_ENV,
      transport,
      judgeHealthPath: healthPath,
    };

    await flushAndSendExhaustionAlarm(alarmDeps);

    assert.equal(subjects.length, 1);
    assert.equal(subjects[0], "LLM judge pool exhausted (2 of 3 accounts failed)");
    assert.ok(
      texts[0]?.includes("The LLM judge pool is exhausted — 2 of 3 LLM_ACCOUNTS accounts failed."),
    );
    assert.ok(texts[0]?.includes("Still working this run: account 3."));
    // The flush ran through the injected path and opened the episode bit.
    const stored = JSON.parse(await readFile(healthPath, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    // A second episode call on the same file suppresses (one per episode):
    // the helper reads its PRE-FLUSH snapshot, so the caller re-resolves
    // the read from disk exactly like the entry catch does per invocation.
    const reloaded = await loadAccountHealth(threeAccounts, healthPath);
    await flushAndSendExhaustionAlarm({ ...alarmDeps, health: reloaded });
    assert.equal(subjects.length, 1);
  });
});

describe("timeStage", () => {
  it("returns the stage value and its duration under an injected clock", async () => {
    let tick = 100;
    const { value, durationMs } = await timeStage(
      async () => {
        tick += 50;
        return "done";
      },
      () => tick,
    );
    assert.equal(value, "done");
    assert.equal(durationMs, 50);
  });

  it("never reports a negative duration when the clock steps back", async () => {
    let tick = 100;
    const { durationMs } = await timeStage(
      async () => {
        tick -= 5;
        return undefined;
      },
      () => tick,
    );
    assert.equal(durationMs, 0);
  });
});
```

## Slices

### Slice 1: Contract + payload v2

**Files**: `src/types.ts`, `src/linkedin-payload.ts`, `tests/linkedin-payload.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Tests pass: `npx tsx --test tests/linkedin-payload.test.ts`
- [ ] `grep -n "PAYLOAD_VERSION = 2" src/linkedin-payload.ts` returns exactly one hit
- [ ] `grep -n "stampsAreValid(row.surfaces)" src/linkedin-payload.ts` returns one hit (the guard gates isValidRow)

#### Manual Verification:
- [ ] A v1-shaped envelope read by readPayloadPosts logs "unknown version 1" and resolves leg malformed (threads-only degrade)

### Slice 2: Stamping at all three fetch sites

**Files**: `src/linkedin-fetch.ts`, `src/fetch-threads.ts`, `src/config-file.ts`, `src/index.ts`, `tests/fetch-threads.test.ts`, `tests/fetch-linkedin.test.ts`, `tests/config-file.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Tests pass: `npx tsx --test tests/config-file.test.ts tests/fetch-threads.test.ts tests/fetch-linkedin.test.ts`
- [ ] Stamp sits at each slot write: `grep -rn "value: surface.value" src/fetch-threads.ts src/linkedin-fetch.ts` returns one hit per file; `grep -rn "value: page.value" src/index.ts` returns one hit
- [ ] The raw pair rides both resolved shapes: `grep -c '"tag" | "url"' src/config-file.ts src/fetch-threads.ts` returns one hit per file
- [ ] Duplicate warn exists: `grep -n "duplicate surface" src/config-file.ts` returns one hit

#### Manual Verification:
- [ ] `npm start` with the committed watcher.config.json logs `config: watcher.config.json duplicate surface linkedin "hiring react"` exactly once before the run proceeds (the real duplicate — two `hiring react` linkedin entries)
- [ ] Log-line shapes are unchanged (the stamp never appears in logs): `fetch: <label> OK`, `extract: <label>: N post(s)` — pinned by the untouched existing log pins

### Slice 3: Dedupe merge + per-surface notify + subjects

**Files**: `src/index.ts`, `src/email.ts`, `src/heartbeat.ts`, `tests/email.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Email suite passes: `npx tsx --test tests/email.test.ts`
- [ ] The combined trio is gone: `grep -rnE "\b(buildSubject|buildDigest|sendDigest)\b" src/` returns no hits
- [ ] The pin is gone from subjects: `grep -rn "hiring indonesia" src/` returns no hits
- [ ] The seam is the loop: `grep -n "groupMatchesBySurface(matches, notifySurfaces)" src/index.ts` returns one hit
- [ ] The merge exists: `grep -c "mergeSurfaceStamps" src/index.ts` returns 2

#### Manual Verification:
- [ ] A staged run with two matching surfaces sends exactly two emails in config order; subjects read `N new job post(s) — <surface>` (D4); the leg + degraded riders ride both (FR9)
- [ ] A zero-match run still sends exactly ONE combined heartbeat (Gates 1 and 2 untouched)
- [ ] An orphaned match logs `notify: match <id> carries no configured surface …`, appears in no email, and is still marked seen (D3)

Note: `tests/index.test.ts` goes behaviorally red after this slice (old subjects and counts) — its rewrite is Slice 4, and full `npm test` is the terminal slice baseline check.

### Slice 4: Integration rewrite

**Files**: `tests/index.test.ts`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Full offline suite passes (terminal baseline): `npm test`
- [ ] The combined subject forms are gone: `grep -nE "on Threads|on LinkedIn" tests/index.test.ts` returns no hits
- [ ] The FR7 pin exists: `grep -c "email: failed to send" tests/index.test.ts` returns 1
- [ ] The D3 pin exists: `grep -c "carries no configured surface" tests/index.test.ts` returns 1 or more
- [ ] The FR8 pin exists: `grep -c "timing: notify" tests/index.test.ts` returns 1 or more

#### Manual Verification:
- [ ] `npm test` output lists the five new integration titles green: the FR2 ride, the D7 collapse, the D3 orphan skips, the FR7 mid-loop send failure, the FR9 rider ride
- [ ] The suite grows from 28 to 33 it() blocks; every updated digest pin asserts the exact `N new job post(s) — <surface>` form

## Desired End State

```ts
// A run with two surfaces that both matched sends two emails:
// subject: 3 new job posts — linkedin: "hiring react"
// subject: 1 new job post — tag: "hiring"
// A post found by both surfaces rides both bodies, once per body.
// A zero-match run still sends exactly one combined heartbeat.
```

## File Map

- `src/types.ts`  # MODIFY — `surfaces?: Surface[]` on `Post`
- `src/linkedin-payload.ts`  # MODIFY — `PAYLOAD_VERSION` 2 + stamp row admission
- `src/config-file.ts`  # MODIFY — `ResolvedSurface` gains type/value; duplicate-surface warn
- `src/fetch-threads.ts`  # MODIFY — `SurfaceFetch` gains type/value; authenticated stamp
- `src/linkedin-fetch.ts`  # MODIFY — stamp at the slot write
- `src/index.ts`  # MODIFY — logged-out stamp; dedupe union merge; per-surface notify loop
- `src/email.ts`  # MODIFY — per-surface digest family (combined trio deleted)
- `src/heartbeat.ts`  # MODIFY — doc comment only (`sendDigest` reference becomes `sendSurfaceDigest`)
- `tests/linkedin-payload.test.ts`  # MODIFY — v2 admission matrix
- `tests/fetch-threads.test.ts`  # MODIFY — stamp pins + widened `SurfaceFetch` literals
- `tests/fetch-linkedin.test.ts`  # MODIFY — envelope deepEqual carries the stamp
- `tests/config-file.test.ts`  # MODIFY — duplicate warn + `resolveSurfaces` pins
- `tests/email.test.ts`  # MODIFY — subject pins
- `tests/index.test.ts`  # MODIFY — count assertions + FR2/FR5/FR7/FR8/FR9 clusters

## Ordering Constraints

- Slice 1 before everything: the field and the envelope version are the contract every later slice compiles against.
- Slice 2 before Slice 3: the notify loop groups on stamps that do not exist until the fetchers write them.
- Slice 3 before Slice 4: the integration rewrite asserts the loop's behavior.
- Within Slice 2, `src/config-file.ts` lands before `src/fetch-threads.ts` (the widened `ResolvedSurface` is what `SurfaceFetch` copies from).
- No slice may run in parallel: each reads the previous slice's locked code fences.

## Verification Notes

- CI gates unchanged: `npm run typecheck && npm run lint && npm test` (CI runs the same three).
- `exactOptionalPropertyTypes` is on: every `surfaces` attach site must use a conditional spread or a definite assignment, never `surfaces: undefined`.
- The union merge must never mutate an input post's array — a fresh array per merged post, asserted by a non-aliasing pin.
- The 3b005cb lesson: subject pins historically got deferred into follow-up commits and bit later. Every subject pin is rewritten in the same change as `buildSubject`.
- The strict version guard means a stale on-disk v1 payload degrades to one warn + `leg: "malformed"` after the bump. Writer and reader ship together; the PC leg git-pulls before its next tick.
- F021 (TECH_DEBT_AUDIT.md:81): one duplicate digest is the accepted failure currency when a run dies between send and persist. Preserve notify-before-persist ordering.
- No precedent exists for a mid-loop send rejection test — the FR7 cluster is new work, not a rewrite.

## Performance Considerations

None material. The stamp is one array reference per post; the merge allocates one fresh array per duplicated post (bounded by the duplicate count, which the dedupe already walked); the notify loop is one `sendText` per surface instead of one per run — the SMTP call count rises with the surface count, which is the feature.

## Migration Notes

`state/linkedin-posts.json` on disk is v1 until the PC leg's next tick. After the bump the hosted reader rejects it once (`leg: "malformed"`, one warn) and degrades to a threads-only run; the PC leg git-pulls and rewrites v2 on its next tick. No state migration script is needed — the payload is derived data, not committed state, and the degrade is one logged tick. `state/seen-posts.json` and `state/judge-health.json` are untouched.

## Pattern References

- `src/pool.ts:10-17` — caller-owned side arrays before a terminal flatten; the stamping idiom all three sites follow.
- `src/email.ts:186` — conditional spread for an optional field under `exactOptionalPropertyTypes`.
- `src/linkedin-payload.ts:7-19`, `:174-184` — drop + count, never silent; the row-admission policy for the stamp validator.
- `src/email.ts:119-152` — one `sendText` seam; every email variant rides it.
- `src/judge.ts:1054` — by-reference wrapping; enrichment before notify reaches the seam free.
- `.rpiv/guidance/src/architecture.md` — "Adding an Email Variant": pure `buildX` → thin `sendX` → caller owns failure policy.

## Developer Context

**Q1 (type home)**: "Post.surfaces needs the {type, value} union (today `Surface` in src/config-file.ts:16-20). Where should the stamp's type live? types.ts is the zero-import contracts leaf." — first asked in compiler terms; the developer answered "i dont understand", so it was re-asked as "Posts will carry a small label saying which watch target found them. Should that label reuse the exact format your watcher.config.json already uses, or keep its own copy?" **Answer: Share the config's format.** → D1.

**Q2 (logged-out stamp site)**: "The logged-out Threads walker destroys surface alignment at fetch-threads.ts:226 (successes filter). How should the surface pair reach the logged-out stamp site (src/index.ts:530-541)?" — re-asked twice; the second phrasing added the worked example (targets `[tag/hiring, url/…@hiresflow]`; if the first fails the list compacts and position no longer identifies the target). **Answer: Page carries its own name.** → D2.

**Q3 (orphaned match)**: "A match stamped with surfaces that left the config (e.g. a surface removed while the payload is still fresh) joins no surface email — yet persistJudged still marks it seen (src/index.ts:501). Permanent loss. Policy?" — re-asked as "Say you delete a watch target from the config while its matched posts are still fresh. Those posts now belong to no remaining email — and they get marked as already-sent, so they'd never be emailed. What should happen?" **Answer: Warn in log, skip.** → D3.

**Q4 (subject template)**: "Per-surface subject template: `3 new job posts — <surface>` (pin `(#hiring indonesia)` dropped). tag renders `tag: "hiring"`, linkedin renders `linkedin: "hiring react"`. How do URL surfaces render?" — re-asked as "Email subjects will read like: 3 new job posts — linkedin: "hiring react". Tags render as tag: "hiring". What should a Threads search-URL target show as its name?" **Answer: Full URL.** → D4.

**Lesson recorded**: the first pass at all four questions used compiler vocabulary ("type home", "stamp site", "orphaned match") and drew four "i dont understand" answers. The second pass used the operator's own words ("watch target", "label", "email") and got four decisions. Keep checkpoint questions in the developer's vocabulary.

## Design History

- Slice 1: Contract + payload v2 — approved as generated
- Slice 2: Stamping at all three fetch sites — approved as generated
- Slice 3: Dedupe merge + per-surface notify + subjects — approved as generated
- Slice 4: Integration rewrite — approved as generated

## References

- `.rpiv/artifacts/solutions/2026-11-09_12-11-37_email-per-surface.md` — the input solutions doc (Option 1 selected)
- `.rpiv/artifacts/research/2026-11-09_11-24-30_email-per-surface.md` — the input research doc
- `.rpiv/artifacts/discover/2026-11-09_10-57-55_email-per-surface.md` — the FRD (8 locked decisions)
- `.rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md` — attribution-shape permanence warning
- `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` — payload envelope D5/D9/D13
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — F021 duplicate-digest acceptance; notify-before-persist
- `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/tests/architecture.md` — pipeline + suite doctrine
