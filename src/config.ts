/**
 * Static, non-secret configuration. Every credential is read from the
 * environment at run time (FRD security requirement) and lives in
 * GitHub Actions secrets. Surfaces are tag pages (D11): logged-out search
 * returned 0 posts, tag pages returned 17-19 posts each in the 2026-10-24
 * live probes.
 */

/** Case-insensitive keyword pre-filter: frontend / fullstack + adjacent (FRD #3). */
export const KEYWORDS: readonly string[] = [
  "frontend", "front-end", "front end",
  "fullstack", "full-stack", "full stack",
  "web developer", "web dev",
  "react", "vue", "next.js", "nextjs", "nuxt",
  "angular", "svelte", "typescript", "javascript",
  "node.js", "nodejs",
];

/** Environment variable names; values never appear in the repo. */
export const ENV_NAMES = {
  threadsTags: "THREADS_TAGS",
  llmBaseUrl: "LLM_BASE_URL",
  llmApiKey: "LLM_API_KEY",
  llmModel: "LLM_MODEL",
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
} as const;

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
