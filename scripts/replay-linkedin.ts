/**
 * Offline replay for the LinkedIn raw-body captures (capture-first
 * precondition, design 2026-11-13): read one or more CaptureRecord
 * files written by the walk's capture sink (src/linkedin-capture.ts),
 * re-analyze each body per root row, and print the evidence the
 * mint-path design must be written from (the recorded R4 decision —
 * the replay output selects or upgrades the mint policy; this script
 * decides nothing).
 *
 * Per body, every line rides the stable `replay:` prefix (the
 * oracle-channel doctrine — distinct outcomes never share a line):
 * - the census header: root rows, distinct texts, distinct ids (the
 *   parser's own global tallies, re-derived row by row);
 * - one line per root row: ids=, texts=, the classification (BOTH /
 *   IDS-ONLY / TEXTS-ONLY / EMPTY), what the incumbent zip did with
 *   the row's text (zip-paired ↔ <urn tail> / zip-unlinked), and the
 *   junk-cause signal — cta-suspect names the text shape (the marker
 *   specs are byte-identical between CTA components and real posts,
 *   so the text is the only signal); shrink-suspect counts the $-refs
 *   the text walk dropped (missing targets, already-consumed rows,
 *   path misses); text lost names the empty-harvest case;
 * - the six-point probe summary: forward BFS from the commentary
 *   marker rows over the $-ref graph, reverse BFS from the id rows
 *   over the same edges, the contentTrackingId grouping, the
 *   adjacency invariants (stream distance between marker and id
 *   rows), and the marker taxonomy (every viewTrackingSpecs shape);
 * - the verdict: whether any card-scoped join EXISTS (either BFS
 *   direction reaching across = the Option-A promotion condition)
 *   and the ids-only skip share.
 *
 * The row walk here is an INSTRUMENTED copy of the parser's per-row
 * rules (src/linkedin-parser.ts collects the same ids and texts but
 * flattens the rows and swallows the $-ref drops silently). The
 * parser is frozen (the design's Not Building list), and Cause B is
 * exactly the drops the parser hides — so this walk records them.
 * The cross-check suite pins these tallies to collectLinkedInPosts
 * on the same bodies: drift between the two walks fails a test
 * instead of shipping wrong evidence.
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
import { collectLinkedInPosts, parseFlightRows } from "../src/linkedin-parser.js";

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

// Frozen copies of the parser's private shapes (src/linkedin-parser.ts
// is out of scope by design): the $-ref forms and the urn forms. The
// cross-check suite pins this walk's tallies to collectLinkedInPosts,
// so drift here fails a test instead of shipping wrong evidence.
const WHOLE_REF_RE = /^\$L?([0-9a-f]+)$/;
const PATH_REF_RE = /^\$L?([0-9a-f]+):(.+)$/;
const URN_RE = /^urn:li:activity:(\d{10,})$/;
const DIGITS_RE = /^\d{10,}$/;

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
  /** Distinct ids in first-appearance order (the parser's rule). */
  ids: string[];
  /** Commentary texts harvested (before the longest-wins pick). */
  textCount: number;
  /** The row's longest commentary text; null when none harvested. */
  bestText: string | null;
  /** Carries at least one commentary_text view marker (BFS start set). */
  hasMarker: boolean;
  /** Every viewTrackingSpecs shape seen in this row ("viewName/control"). */
  markerShapes: string[];
  /** What the incumbent zip did with this row's text; null when no text. */
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
  /** Either BFS direction reached across — the Option-A promotion condition. */
  joinCandidate: boolean;
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
 */
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
      const whole = WHOLE_REF_RE.exec(node);
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
      const scoped = PATH_REF_RE.exec(node);
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

/** Every $-ref target one row's subtree points at (whole and path forms). */
function refTargets(payload: unknown, rows: Map<string, unknown>, into: Set<string>): void {
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const whole = WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id = whole[1] ?? "";
        if (rows.has(id)) into.add(id);
        return;
      }
      const scoped = PATH_REF_RE.exec(node);
      if (scoped !== null) {
        const id = scoped[1] ?? "";
        if (rows.has(id)) into.add(id);
        return;
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
 * The instrumented per-row walk: the parser's collectLinkedInPosts row
 * rules with the drops counted and the shapes named. Urn strings,
 * activityId digit fields, urn object keys; a commentary_text marker
 * harvests its text and RETURNS (its subtree carries no ids); every
 * other viewTrackingSpecs shape is recorded for the taxonomy and
 * recursed (the parser ignores it silently).
 */
function collectRowCensus(
  hex: string,
  index: number,
  payload: unknown,
  rows: Map<string, unknown>,
  zipByText: Map<string, string>,
): RowCensus {
  const ids = new Set<string>();
  const rowTexts: string[] = [];
  const markerShapes: string[] = [];
  let hasMarker = false;
  const drops: TextDrops = { missing: 0, seen: 0, pathMiss: 0 };
  const seenRows = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const urn = URN_RE.exec(node);
      if (urn !== null) {
        ids.add(urn[1] ?? "");
        return;
      }
      const whole = WHOLE_REF_RE.exec(node);
      if (whole !== null) {
        const id = whole[1] ?? "";
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
    const activityId: unknown = record.activityId;
    if (typeof activityId === "string" && DIGITS_RE.test(activityId)) ids.add(activityId);
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
    for (const key of Object.keys(record)) {
      const urnKey = URN_RE.exec(key);
      if (urnKey !== null) ids.add(urnKey[1] ?? "");
    }
    for (const key of Object.keys(record)) visit(record[key]);
  };
  visit(payload);
  const bestText =
    rowTexts.length > 0 ? rowTexts.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  let disposition: string | null = null;
  if (bestText !== null) {
    const paired = zipByText.get(bestText);
    disposition = paired === undefined ? "zip-unlinked" : `zip-paired ↔ ${paired.slice(-6)}`;
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
 * marker taxonomy), and the incumbent zip's disposition per row.
 * Pure over the record's body — the only log line is the parser's own
 * pairing oracle, which rides along as extra evidence.
 */
export function analyzeBody(record: CaptureRecord): BodyAnalysis {
  const rows = parseFlightRows(record.body);
  const entries = [...rows.entries()];
  // The incumbent zip's own output: which text got paired with which
  // id. A paired urn is the pairing's CHOICE, never a proven
  // association (the parser's header says why).
  const zipByText = new Map<string, string>();
  for (const post of collectLinkedInPosts(record.body)) {
    zipByText.set(post.text, post.id);
  }
  const rowsCensus = entries.map(([hex, payload], index) =>
    collectRowCensus(hex, index, payload, rows, zipByText),
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
  // Six-point probe, arms 1-2: the $-ref graph in both directions. A
  // hit in either arm is the Option-A promotion condition; zero in
  // both is the committed census's answer re-measured on fresh bodies.
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
    joinCandidate: forwardReached > 0 || reverseReached > 0,
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
  if (!analysis.joinCandidate) {
    return `replay: verdict — no card-scoped join found; ${analysis.idsOnly}/${analysis.rootRows} row(s) skipped ids-only`;
  }
  return `replay: verdict — join CANDIDATE (forward ${analysis.forwardReached}, reverse ${analysis.reverseReached}) — the Option-A promotion condition is met; inspect the reachable rows before any pairing rule changes`;
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
