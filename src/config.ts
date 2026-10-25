/**
 * Static, non-secret configuration. Every credential is read from the
 * environment at run time (FRD security requirement) and lives in
 * GitHub Actions secrets. Surfaces are tag pages (D11): logged-out search
 * returned 0 posts, tag pages returned 17-19 posts each in the 2026-10-24
 * live probes.
 */

/** Case-insensitive keyword pre-filter: frontend / fullstack + adjacent (FRD #3).
 * TEMPORARY (2026-10-25): the last five entries are a test widening to seed a
 * match for the Phase 7 smoke gate. Revert before merge.
 */
export const KEYWORDS: readonly string[] = [
  "frontend", "front-end", "front end",
  "fullstack", "full-stack", "full stack",
  "web developer", "web dev",
  "react", "vue", "next.js", "nextjs", "nuxt",
  "angular", "svelte", "typescript", "javascript",
  "node.js", "nodejs",
  "developer", "programmer", "engineer", "software", "it support",
];

/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsTags: "THREADS_TAGS",
  threadsSession: "THREADS_SESSION_STATE",
  recencyHours: "RECENCY_HOURS",
  heartbeat: "HEARTBEAT_ENABLED",
  llmBaseUrl: "LLM_BASE_URL",
  llmApiKey: "LLM_API_KEY",
  llmModel: "LLM_MODEL",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;

/** Default freshness window in hours (measured: 89/92 posts ≤72h). */
export const DEFAULT_RECENCY_HOURS = 72;

/**
 * Resolve the heartbeat kill switch. Defaults to true; only an explicit
 * "false" (any casing, surrounding whitespace ignored) disables it. The
 * heartbeat fires on every zero-match run, which at the 10-minute cron
 * is 144 emails a day — this is the one-line valve when that is too many.
 */
export function isHeartbeatEnabled(
  env: Record<string, string | undefined>,
): boolean {
  const raw: string | undefined = env[ENV_NAMES.heartbeat];
  if (raw === undefined) return true;
  return raw.trim().toLowerCase() !== "false";
}

/**
 * Build the Actions run URL from the ambient GITHUB_* variables, or
 * undefined when they are absent (a local run).
 */
export function runUrlFromEnv(
  env: Record<string, string | undefined>,
): string | undefined {
  const server: string | undefined = env["GITHUB_SERVER_URL"];
  const repo: string | undefined = env["GITHUB_REPOSITORY"];
  const runId: string | undefined = env["GITHUB_RUN_ID"];
  if (server === undefined || repo === undefined || runId === undefined) {
    return undefined;
  }
  return `${server}/${repo}/actions/runs/${runId}`;
}

/**
 * Resolve the recency window (hours) from the environment, falling back to
 * DEFAULT_RECENCY_HOURS when unset, blank, or not a positive number.
 */
export function resolveRecencyHours(
  env: Record<string, string | undefined>,
): number {
  const raw: string | undefined = env[ENV_NAMES.recencyHours];
  if (raw === undefined || raw.trim() === "") return DEFAULT_RECENCY_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECENCY_HOURS;
  return Math.floor(parsed);
}

/** Tag surfaces sampled when THREADS_TAGS is unset (live-probed 2026-10-24: 19/17/18 posts). */
export const DEFAULT_TAGS: readonly string[] = ["hiring", "lowker", "infokerja"];

/**
 * Resolve the tag list from the environment (comma-separated), falling back
 * to DEFAULT_TAGS when unset, empty, or all-blank.
 */
export function resolveTags(
  env: Record<string, string | undefined>,
): string[] {
  const raw: string | undefined = env[ENV_NAMES.threadsTags];
  if (raw === undefined || raw.trim() === "") return [...DEFAULT_TAGS];
  const tags = raw
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  return tags.length > 0 ? tags : [...DEFAULT_TAGS];
}

/** Canonical URL of one tag page (consumed by src/fetch-threads.ts). */
export function tagPageUrl(tag: string): string {
  return `https://www.threads.com/tag/${encodeURIComponent(tag)}`;
}

/** Commit-back location of the seen-state file (FRD #6). */
export const STATE_PATH = "state/seen-posts.json";
