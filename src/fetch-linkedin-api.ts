/**
 * Fetch LinkedIn posts via the Linked API SDK post search (@linkedapi/node).
 *
 * The SDK is a two-call flow: searchPosts.execute(params) submits a cloud-
 * browser workflow and returns tracking details immediately; searchPosts.
 * result(workflowId) polls to completion and returns { data, errors }.
 * Sources pinned 2026-11-01: linkedapi.io/sdks/handling-results.md,
 * /docs/action-st-search-posts.md, /docs/working-hours.md, /docs/common-errors.md.
 *
 * Degrade contract (FRD D5/D10): this module is TOTAL — a failed client build
 * or failed surface warns instead of throwing, the loop moves on per surface,
 * an empty result is success, and the function never rejects. Token resolution
 * is silent (resolveSession model, threads-session.ts); the caller owns the
 * missing-token warn and the skip decision.
 *
 * The sequential loop replaces the blocked Playwright walker (FR4: no
 * parallelism for LinkedIn; Threads keeps its bounded pool in fetch-threads.ts).
 *
 * Quarantine: the dynamic import inside createLinkedApiClient is the ONLY
 * @linkedapi/node import site, so importing this module never loads the SDK
 * (the fetch-threads.ts:150 Playwright pattern) and the offline suites inject
 * structural doubles over LinkedApiClientLike.
 */
import type { Surface } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import type { Post } from "./types.js";

// Module constants by design — no config key (repo doctrine: only probe-
// measured values are env-tunable). Window + sort per the developer decision
// 2026-11-01 (supersedes FRD D9's pastWeek; recencyHours: 72 effectively
// governs Threads only). Limit max 100 per the SDK docs; a search may return
// fewer than the limit, and LinkedIn may widen a narrow query on its own.
const SEARCH_LIMIT = 100;
const SEARCH_SORT = "latest";
const SEARCH_DATE_POSTED = "past24Hours";

/** One raw linkedin surface straight from watcher.config.json. */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;

/** Both Linked API tokens, resolved from the environment. */
export interface LinkedInApiTokens {
  readonly linkedApiToken: string;
  readonly identificationToken: string;
}

/** Minimal structural view of one SDK search result item (field names per docs). */
export interface LinkedInSearchResultItem {
  readonly url?: string | null;
  readonly activityUrn?: string | null;
  readonly time?: string | null;
  readonly author?: { readonly name?: string | null } | null;
  readonly text?: string | null;
  readonly repostText?: string | null;
}

/**
 * Structural seam over the SDK client surface this module drives. Narrow on
 * purpose: the offline doubles implement exactly this, and the real client is
 * only ever touched inside createLinkedApiClient.
 */
export interface LinkedApiClientLike {
  searchPosts: {
    execute(params: {
      readonly term: string;
      readonly limit: number;
      readonly filter: { readonly sort: "latest"; readonly datePosted: "past24Hours" };
    }): Promise<{
      readonly workflowId: string;
      readonly workflowStatus: string;
      readonly pendingReason?: string | null;
      readonly message?: string | null;
    }>;
    result(workflowId: string): Promise<{
      readonly data?: readonly LinkedInSearchResultItem[] | null;
      readonly errors?: readonly { readonly type: string; readonly message: string }[] | null;
    }>;
  };
}

/**
 * Resolve both Linked API tokens, or null when either is unset or blank.
 * Silent by contract (resolveSession, threads-session.ts:42): an opaque token
 * has no offline-validatable payload, so there is exactly one exit. The
 * caller decides the warn-and-skip policy.
 */
export function resolveLinkedApiTokens(
  env: Record<string, string | undefined> = process.env,
): LinkedInApiTokens | null {
  const linkedApiToken = env[ENV_NAMES.linkedApiToken];
  const identificationToken = env[ENV_NAMES.linkedApiIdentificationToken];
  if (
    linkedApiToken === undefined ||
    linkedApiToken.trim() === "" ||
    identificationToken === undefined ||
    identificationToken.trim() === ""
  ) {
    return null;
  }
  return { linkedApiToken, identificationToken };
}

/**
 * Build one SDK client. The dynamic import inside is the ONLY @linkedapi/node
 * import site, so importing this module never loads the SDK and the offline
 * suites inject doubles instead.
 */
async function createLinkedApiClient(tokens: LinkedInApiTokens): Promise<LinkedApiClientLike> {
  // Named import: the published d.ts declares the class as a NAMED export;
  // the default import resolves to the CJS namespace object, which is NOT
  // constructable under NodeNext + verbatimModuleSyntax (seam check vs
  // @linkedapi/node 2.3.20, 2026-11-02: default → TS2351, named → tsc exit 0).
  const { LinkedApi } = await import("@linkedapi/node");
  // The seam is structural and narrower than the SDK's published types; this
  // one cast keeps this factory the only place that knows the real shape.
  return new LinkedApi({
    linkedApiToken: tokens.linkedApiToken,
    identificationToken: tokens.identificationToken,
  }) as unknown as LinkedApiClientLike;
}

const URN_IN_URL_RE = /urn:li:activity:(\d{9,})/;

/**
 * Map one SDK result item to a Post, or null when a required fact is missing.
 * Guarded conversion BEFORE toISOString (extract.ts:87-113 shape): an invalid
 * time string drops the row instead of throwing RangeError. Drops feed the
 * caller's counter — one malformed row must never poison seen-state
 * (persistJudged stamps ids forever) or burn a paid judge attempt.
 */
export function mapLinkedInSearchResult(item: LinkedInSearchResultItem): Post | null {
  const url = readNonEmpty(item.url);
  if (url === null) return null;
  const id = readNonEmpty(item.activityUrn) ?? readUrnFromUrl(url);
  if (id === null) return null;
  const text = readNonEmpty(item.text) ?? readNonEmpty(item.repostText);
  if (text === null) return null;
  const author = readNonEmpty(item.author?.name);
  if (author === null) return null;
  const timestamp = readTimestamp(item.time);
  if (timestamp === null) return null;
  return { platform: "linkedin", id, text, author, permalink: url, timestamp };
}

/** Fetch every linkedin surface sequentially, in input order. Total by contract. */
export async function fetchLinkedInPosts(
  surfaces: readonly LinkedinSurface[],
  tokens: LinkedInApiTokens,
  clientFactory: (
    tokens: LinkedInApiTokens,
  ) => Promise<LinkedApiClientLike> = createLinkedApiClient,
): Promise<Post[]> {
  // One client for the whole run: one Linked API instance per LinkedIn
  // account (SDK installation docs), built once before the serial loop.
  // Totality: the build is wrapped — a factory fault (broken install, bad
  // import) degrades to warn + [] like any other surface failure, so the
  // function never rejects and no caller needs a catch to be correct.
  let client: LinkedApiClientLike;
  try {
    client = await clientFactory(tokens);
  } catch (error) {
    console.warn(`fetch: linkedin client FAILED — ${describeError(error)}`);
    return [];
  }
  const posts: Post[] = [];
  for (const surface of surfaces) {
    const label = `linkedin/${surface.value}`;
    try {
      const workflow = await client.searchPosts.execute({
        term: surface.value,
        limit: SEARCH_LIMIT,
        filter: { sort: SEARCH_SORT, datePosted: SEARCH_DATE_POSTED },
      });
      // Default account policy PARKS the workflow — pendingReason carries the
      // cause. ANY non-null reason parks: the SDK docs pin "outsideWorkingHours"
      // today, but the field exists so the account policy can defer for other
      // causes too. Never await result() on a parked workflow: result() polls
      // to completion — possibly the next working day — and the 8-minute job
      // cap would kill the whole run. The skip costs one execute() round-trip
      // (working-hours.md, 2026-11-01); a false skip costs one surface-tick,
      // a false fall-through costs the run.
      if (workflow.pendingReason !== undefined && workflow.pendingReason !== null) {
        const reason = workflow.pendingReason;
        const detail =
          workflow.message === undefined || workflow.message === null
            ? ""
            : ` (${workflow.message})`;
        const cause =
          reason === "outsideWorkingHours"
            ? "outside Linked API working hours"
            : `parked (pendingReason: ${reason})`;
        console.warn(`fetch: ${label} skipped — ${cause}${detail}`);
        continue;
      }
      const { data, errors } = await client.searchPosts.result(workflow.workflowId);
      // Action-level errors never throw: they ride the result (docs,
      // handling-results.md). filterNotApplied is permanent;
      // searchingNotAllowed may be transient — either way the surface
      // degrades with its cause named, and the loop moves on.
      for (const error of errors ?? []) {
        console.warn(`fetch: ${label} action error — ${error.type}: ${error.message}`);
      }
      const collected = collectPosts(data ?? []);
      if (collected.dropped > 0) {
        console.warn(`fetch: ${label}: dropped ${collected.dropped} malformed result(s)`);
      }
      console.log(`fetch: ${label} OK — ${collected.posts.length} post(s)`);
      posts.push(...collected.posts);
    } catch (error) {
      // Message passthrough (fetch-threads.ts:390-394 idiom); a LinkedApiError
      // carries .type, prefixed when present so working-hours vs token vs
      // limit causes stay distinguishable in the log.
      console.warn(`fetch: ${label} FAILED — ${describeError(error)}`);
    }
  }
  return posts;
}

/** Dedupe by id in first-seen order; count malformed rows for the caller's warn. */
function collectPosts(items: readonly LinkedInSearchResultItem[]): {
  posts: Post[];
  dropped: number;
} {
  const byId = new Map<string, Post>();
  let dropped = 0;
  for (const item of items) {
    const post = mapLinkedInSearchResult(item);
    if (post === null) {
      dropped += 1;
      continue;
    }
    if (!byId.has(post.id)) byId.set(post.id, post);
  }
  return { posts: [...byId.values()], dropped };
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Guard before the property read: throw null / throw "str" are legal and
  // must degrade, not crash the degrading path (this module survives bad SDK
  // behavior — that is its reason to exist).
  const type: unknown =
    error !== null && typeof error === "object" ? (error as { type?: unknown }).type : undefined;
  return typeof type === "string" ? `${type}: ${message}` : message;
}

function readNonEmpty(value: string | null | undefined): string | null {
  // extract.ts readText/readUsername idiom: whitespace-only is missing.
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readUrnFromUrl(url: string): string | null {
  const match = URN_IN_URL_RE.exec(url);
  return match === null ? null : `urn:li:activity:${match[1]}`;
}

function readTimestamp(time: string | null | undefined): string | null {
  const raw = readNonEmpty(time);
  if (raw === null) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
