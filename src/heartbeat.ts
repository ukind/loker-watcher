import type { Transporter } from "nodemailer";
import { type EmailConfig, sendText } from "./email.js";
/**
 * No-match heartbeat (Phase 9).
 *
 * The watcher sends no email when a run finds no match, so the operator has
 * no signal that the pipeline is alive — and no way to see why a run found
 * nothing without opening the Actions log. Measured 2026-10-25: the
 * authenticated feed carries ~300 recent posts per run, and zero-match runs
 * are the normal case. This module builds and sends a status email for
 * those runs: the scan funnel plus the candidate posts that came closest,
 * each with its permalink.
 *
 * The candidate net comes from watcher.config.json ("candidateTerms") and is
 * deliberately broader than the keyword list the judge uses: a post that
 * names no configured keyword can still be worth a human look.
 */
import type { Post } from "./types.js";

/** Maximum candidates listed in one heartbeat email. */
export const MAX_CANDIDATES = 10;

/** Funnel counts for one run, collected by src/index.ts. */
export interface HeartbeatStats {
  /** ISO 8601 UTC timestamp of the run start. */
  ranAt: string;
  /** Unique posts after cross-surface dedupe. */
  unique: number;
  /** Posts kept by the recency filter. */
  recent: number;
  /** Recency window in hours. */
  recencyHours: number;
  /** Posts sent to the LLM judge (all recency+seen survivors). */
  judged: number;
  /** Posts the judge marked relevant AND located. */
  relevantLocated: number;
  /** Posts the judge could not evaluate. */
  skipped: number;
  /** Actions run URL, when the workflow provides the ambient variables. */
  runUrl?: string;
}

/** One candidate post plus why it is in the list. */
export interface Candidate {
  post: Post;
  /** "judged" went to the LLM judge; "near-miss" only the broader net. */
  reason: "judged" | "near-miss";
}

/**
 * True when the text mentions any candidate term (case-insensitive).
 */
export function matchesCandidateTerms(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.trim().toLowerCase()));
}

/**
 * Pick the posts worth a human look: every judged candidate first (the
 * strongest signal), then the newest near-misses, capped at `limit`.
 */
export function selectCandidates(
  recent: readonly Post[],
  judged: readonly Post[],
  terms: readonly string[],
  limit: number = MAX_CANDIDATES,
): Candidate[] {
  const out: Candidate[] = judged.map((post) => ({
    post,
    reason: "judged" as const,
  }));
  if (out.length >= limit) return out.slice(0, limit);

  const judgedIds = new Set(judged.map((post) => post.id));
  const nearMisses = recent
    .filter((post) => !judgedIds.has(post.id) && matchesCandidateTerms(post.text, terms))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  for (const post of nearMisses) {
    if (out.length >= limit) break;
    out.push({ post, reason: "near-miss" });
  }
  return out;
}

/** One-line text preview: whitespace collapsed, truncated at `max` chars. */
export function snippet(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Age of a post in whole hours relative to `now`; 0 when unparseable. */
export function ageHours(timestamp: string, now: number): number {
  const takenAt = new Date(timestamp).getTime();
  if (!Number.isFinite(takenAt)) return 0;
  return Math.max(0, Math.floor((now - takenAt) / 3_600_000));
}

/** Subject line for the heartbeat email. */
export function buildHeartbeatSubject(stats: HeartbeatStats): string {
  return `loker-watcher: 0 new matches — ${stats.recent} post(s) scanned`;
}

/** Plain-text body: the funnel, then the candidates with permalinks. */
export function buildHeartbeatBody(
  stats: HeartbeatStats,
  candidates: readonly Candidate[],
  now: number,
): string {
  const lines: string[] = [
    `loker-watcher — ${stats.ranAt}`,
    "",
    "0 new job matches.",
    "",
    `  ${stats.unique} unique post(s)`,
    `  ${stats.recent} within ${stats.recencyHours}h`,
    `  ${stats.judged} judged candidate(s)`,
    `  ${stats.relevantLocated} relevant + located`,
    `  ${stats.skipped} skipped by the judge`,
    "",
  ];

  if (candidates.length === 0) {
    lines.push("No candidate posts in this run.");
  } else {
    lines.push(`Closest ${candidates.length} candidate(s), newest first:`);
    lines.push("");
    candidates.forEach((candidate, index) => {
      const age = ageHours(candidate.post.timestamp, now);
      const tag = candidate.reason === "judged" ? " [judged]" : "";
      lines.push(`${index + 1}. @${candidate.post.author} — ${age}h ago${tag}`);
      lines.push(`   ${snippet(candidate.post.text)}`);
      lines.push(`   ${candidate.post.permalink}`);
      lines.push("");
    });
  }

  if (stats.runUrl !== undefined) {
    lines.push(`Run: ${stats.runUrl}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Send the heartbeat email. Reuses the digest transport path so both emails
 * share one credential resolution and one fail-visible error shape.
 * Accepts an optional Transporter for unit testing, exactly as sendDigest
 * does — without it the function would open a real Gmail connection.
 */
export async function sendHeartbeat(
  stats: HeartbeatStats,
  candidates: readonly Candidate[],
  config: EmailConfig,
  now: number = Date.now(),
  transport?: Transporter,
): Promise<void> {
  await sendText(
    buildHeartbeatSubject(stats),
    buildHeartbeatBody(stats, candidates, now),
    config,
    transport,
  );
  console.log(
    `heartbeat: sent status email — ${stats.recent} post(s) scanned, ${candidates.length} candidate(s)`,
  );
}
