/**
 * Static, non-secret configuration. Every credential is read from the
 * environment at run time (FRD security requirement) and lives in
 * GitHub Actions secrets.
 *
 * What the watcher samples and how it filters is NOT here: the surface list,
 * the keyword list, the heartbeat candidate net and the recency window all
 * live in watcher.config.json (Phase 10), loaded and validated by
 * src/config-file.ts. This module keeps only the environment variable names,
 * the heartbeat kill switch, the Actions run-URL helper and the file paths.
 */

/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsSession: "THREADS_SESSION_STATE",
  linkedinSession: "LINKEDIN_SESSION_STATE",
  linkedinEmail: "LINKEDIN_EMAIL",
  linkedinPassword: "LINKEDIN_PASSWORD",
  linkedinRefreshPath: "LINKEDIN_REFRESH_PATH",
  heartbeat: "HEARTBEAT_ENABLED",
  llmAccounts: "LLM_ACCOUNTS",
  judgeConcurrency: "JUDGE_CONCURRENCY",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;

/**
 * Resolve the heartbeat kill switch. Defaults to true; only an explicit
 * "false" (any casing, surrounding whitespace ignored) disables it. The
 * heartbeat fires on every zero-match run, which at the 10-minute cron
 * is 144 emails a day — this is the one-line valve when that is too many.
 */
export function isHeartbeatEnabled(env: Record<string, string | undefined>): boolean {
  const raw: string | undefined = env[ENV_NAMES.heartbeat];
  if (raw === undefined) return true;
  return raw.trim().toLowerCase() !== "false";
}

/**
 * Build the Actions run URL from the ambient GITHUB_* variables, or
 * undefined when they are absent (a local run).
 */
export function runUrlFromEnv(env: Record<string, string | undefined>): string | undefined {
  const server: string | undefined = env.GITHUB_SERVER_URL;
  const repo: string | undefined = env.GITHUB_REPOSITORY;
  const runId: string | undefined = env.GITHUB_RUN_ID;
  if (server === undefined || repo === undefined || runId === undefined) {
    return undefined;
  }
  return `${server}/${repo}/actions/runs/${runId}`;
}

/** Commit-back location of the seen-state file (FRD #6). */
export const STATE_PATH = "state/seen-posts.json";

/**
 * Location of the JSON source of truth for surfaces, keywords, candidate
 * terms and the recency window. Committed and hand-edited; never written
 * by a run. A missing or malformed file fails the run (src/config-file.ts).
 */
export const CONFIG_PATH = "watcher.config.json";
