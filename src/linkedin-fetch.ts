/**
 * The LinkedIn voyager fetch leg: transport adapters, §13 fault
 * classification, and the runPool surface walk (design slices 3/D11).
 *
 * Two transports behind one seam — `VoyagerGet`, one GET per call:
 *
 * - curl (default): spawns the lexiforest curl-impersonate single binary
 *   (CURL_IMPERSONATE_BIN, fail-visible when unset — the message names
 *   both remedies: npm run setup-curl, or the playwright .env line) with
 *   the §3/§10 header set on top of the pinned chrome116 profile. The
 *   profile owns the UA + TLS + HTTP/2 fingerprint as one consistent set
 *   (D2 amendment 2026-11-05); the HTTP status rides a write-out sentinel
 *   after the body — one exec, no temp files. The exec runner is
 *   injectable for offline tests.
 * - playwright: a standalone API-request context
 *   (`request.newContext({ storageState })`) behind the SAME dynamic-import
 *   quarantine idiom as makeChromiumContextFactory (fetch-threads.ts:129).
 *   NOT ContextFactory: ContextLike (fetch-threads.ts:106) exposes no
 *   request surface, and an API GET needs no browser launch (verified
 *   2026-11-04). storageState carries the cookie pair; csrf-token and the
 *   static headers ride extraHTTPHeaders.
 *
 * `LINKEDIN_TRANSPORT` selects the adapter (`curl` default | `playwright`,
 * else throw — switching after a failed probe is an operator action, D2).
 *
 * The walk (D11) reuses runPool — verified contract: runPool RETURNS VOID
 * (src/pool.ts:33-52), so results ride caller-owned side arrays indexed by
 * the claim index, the worker stays total for surface faults (warn + skip,
 * the caller-owned skip warn stays in index.ts), and leg-dead aborts via
 * the repo's drain-then-throw shape (judgePosts fallback pool,
 * src/judge.ts:681; fast-workflow-runtime D11): catch isLegDead in the
 * worker, set a shared flag, stop claiming, throw once after the join.
 * A shared per-walk pacing gate (5s between voyager GETs, any surface)
 * keeps the global call rate identical to a sequential walk — the anti-bot
 * rate is pacing-bound, not width-bound (§13.3 throttling was observed at
 * ~40 rapid calls).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Surface } from "./config-file.js";
import { ENV_NAMES } from "./config.js";
import {
  type LinkedInCookies,
  buildCookieHeader,
  csrfToken,
  resolveLinkedInCookies,
  toStorageState,
} from "./linkedin-session.js";
import { VOYAGER_STATIC_HEADERS, buildSearchUrl, parseSearchResponse } from "./linkedin-voyager.js";
import { runPool } from "./pool.js";
import type { Post } from "./types.js";

/** One configured linkedin surface (raw keyword string, never a URL). */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;

/** Injectable sleep for the pacing gate (judge.ts trailing-param idiom). */
export type SleepFn = (ms: number) => Promise<void>;

/** Walk width. The pacing gate, not this number, bounds the voyager rate. */
export const LINKEDIN_FETCH_CONCURRENCY = 2;

/** §12.1: count 50 is unclamped server-side; `start += count` pages. */
export const PAGE_SIZE = 50;

/** Minimum spacing between voyager GETs, shared across surfaces (§13.3). */
export const PACE_MS = 5_000;

/** One curl exec's wall-clock cap; mirrored by --max-time inside curl. */
const REQUEST_TIMEOUT_MS = 30_000;

/** curl -w appends this sentinel + status after the response body. */
const STATUS_SENTINEL = "___CURL_STATUS:";

/**
 * The pinned impersonation profile (lexiforest single binary, §D2
 * amendment 2026-11-05). The profile owns the UA + TLS + HTTP/2 headers
 * as ONE consistent set — chrome116 is the Windows-10 Chrome profile the
 * release ships. The transport's own `user-agent` header is deliberately
 * GONE: overriding the profile's UA with a different Chrome version is a
 * mismatched fingerprint signal. Our §3/§10 -H overrides (cookie,
 * csrf-token, the static set) ride ON TOP of the profile defaults.
 */
export const CURL_IMPERSONATE_PROFILE = "chrome116";

/**
 * §10 client fingerprint for the PLAYWRIGHT adapter only (no profile
 * system there — `request.newContext` presents no TLS fingerprint, so the
 * explicit UA header is the only browser signal it can send).
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** One voyager GET's outcome: the HTTP status and the raw body. */
export interface VoyagerResponse {
  readonly status: number;
  readonly body: string;
}

/** The transport seam: one GET per call, shared by both adapters. */
export type VoyagerGet = (url: string) => Promise<VoyagerResponse>;

/** An opened transport: the GET plus its teardown (a no-op for curl). */
export interface Transport {
  readonly get: VoyagerGet;
  readonly dispose: () => Promise<void>;
}

// --- LegDeadError: the tagged-error idiom (judge-rotation.ts:51-75) ---

export const LEG_DEAD = "LegDeadError";

/**
 * Thrown once per tick when the session leg is dead (D7). Factory-assigned
 * fields stay mutable — the RotationExhausted idiom (judge-rotation.ts:61-70).
 */
export interface LegDead extends Error {
  name: string;
  reason: string;
}

export function legDead(reason: string): LegDead {
  const error = new Error(`linkedin-fetch: leg dead — ${reason}`) as LegDead;
  error.name = LEG_DEAD;
  error.reason = reason;
  return error;
}

export function isLegDead(error: unknown): error is LegDead {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === LEG_DEAD
  );
}

// --- AllSurfacesFaulted: the tagged-error idiom (judge-rotation.ts:51-75) ---

export const ALL_SURFACES_FAULTED = "AllSurfacesFaulted";

/** Thrown when EVERY configured surface faulted and none published posts (D13: the tick, not the walk, decides the write). */
export interface AllSurfacesFaulted extends Error {
  name: string;
  faulted: number;
}

export function allSurfacesFaulted(faulted: number): AllSurfacesFaulted {
  const error = new Error(
    `linkedin-fetch: all ${faulted} surface(s) faulted — nothing fetched`,
  ) as AllSurfacesFaulted;
  error.name = ALL_SURFACES_FAULTED;
  error.faulted = faulted;
  return error;
}

export function isAllSurfacesFaulted(error: unknown): error is AllSurfacesFaulted {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === ALL_SURFACES_FAULTED
  );
}

// --- §13.3 fault classification ---

export type FaultKind = "legDead" | "fault";

export interface Fault {
  readonly kind: FaultKind;
  readonly reason: string;
}

/**
 * §13.3 detection recipe, HTTP responses only (connection-level failures
 * throw from the transport and land as surface faults, never leg-dead —
 * a dead network is not a dead session):
 *
 * - 302/3xx redirect loop: live-observed 2026-11-05 (validate rehearsal) —
 *   a dead session presents as a 302 loop on this client stack, with
 *   `set-cookie: li_at=delete me` and Cloudflare `__cf_bm` cookies in the
 *   chain. DOCUMENTATION.md §13.1's API-vs-browser redirect claim does not
 *   hold for this stack; root cause (session death vs edge fingerprint
 *   block) is unresolved ON PURPOSE — both carry the same operator remedy.
 *   The endpoint never legitimately redirects a GET — any 3xx is leg dead
 *   (§13.1 amendment: same remedy as 401).
 * - 403 "CSRF check failed." text, or a Cloudflare challenge page: the
 *   session/CSRF pair is broken or the IP reputation is burned — leg dead.
 * - 401 {"status":401}: dead or absent li_at — leg dead.
 * - bare 400 {"status":400} on the finder: no member context (dead
 *   session) — leg dead (§13.1: same remedy as 401).
 * - graphql-envelope 400: known query, bad variables — OUR bug, a fault.
 * - 500: unknown queryId — the hash expired server-side (§15); re-derive
 *   from a current APK, do not debug variables — a fault.
 */
export function classifyFault(status: number, body: string): Fault {
  const trimmed = body.trim();
  // Live-observed 2026-11-05 (validate rehearsal): a dead session presents
  // as a 302 redirect loop on this endpoint — DOCUMENTATION.md §13.1 says
  // only browser navigations redirect; the claim does not hold for this
  // client stack. Root cause (session death vs edge fingerprint block) is
  // unresolved ON PURPOSE: both carry the same operator remedy, so the
  // classification must not wait on it. The endpoint never legitimately
  // redirects a GET — any 3xx is leg-dead, same remedy as 401 (§13.1).
  if (status >= 300 && status < 400) {
    return {
      kind: "legDead",
      reason: `HTTP ${status} redirect loop — dead session or edge block; refresh the cookie file (live-observed 2026-11-05, §13.1 amendment)`,
    };
  }
  if (status === 403) {
    const challenge = /Just a moment|challenge|cf-ray/i.test(trimmed);
    return {
      kind: "legDead",
      reason: challenge
        ? "HTTP 403 challenge page — IP/session reputation burned (§13.3)"
        : 'HTTP 403 "CSRF check failed." — session/JSESSIONID mismatch (§13.1)',
    };
  }
  if (status === 401) {
    return {
      kind: "legDead",
      reason: `HTTP 401 ${trimmed.slice(0, 60)} — dead li_at session (§13.1)`,
    };
  }
  if (status === 400) {
    if (trimmed === '{"status":400}') {
      return {
        kind: "legDead",
        reason: 'bare HTTP 400 {"status":400} — no member context; dead session (§13.1)',
      };
    }
    return {
      kind: "fault",
      reason: `HTTP 400 graphql envelope — bad variables (our bug): ${trimmed.slice(0, 80)}`,
    };
  }
  if (status === 500) {
    return {
      kind: "fault",
      reason: "HTTP 500 — unknown queryId; the hash expired (§15), re-derive from a current APK",
    };
  }
  return { kind: "fault", reason: `HTTP ${status}` };
}

// --- curl-impersonate transport ---

/** Injectable exec seam for offline tests: binary + args → stdout. */
export type ExecFn = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

const execFilePromised = promisify(execFile);

const realExec: ExecFn = (file, args) =>
  execFilePromised(file, [...args], {
    timeout: REQUEST_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

/**
 * curl-impersonate transport (developer-selected primary transport, D2
 * amendment 2026-11-05): the LEXIFOREST single binary — upstream lwthiker
 * ships linux/mac/docker only, so lexiforest is the Windows distribution
 * of record, installed by `npm run setup-curl`. The profile headers + our
 * overrides compose per the fork README (`-H` overrides individual
 * profile headers), so the §3/§10 set rides on top of chrome116's own
 * UA/TLS/HTTP/2 fingerprint. One exec per GET: `--impersonate` selects the
 * pinned profile, `-sS` body to stdout, `--max-time` mirrors the exec
 * timeout, and `-w` appends the status sentinel after the body —
 * parseable without temp files or stderr games. Exec-level failures
 * (connection reset, timeout, missing binary) throw plain errors: surface
 * faults, never leg-dead.
 */
export function createCurlTransport(
  cookies: LinkedInCookies,
  env: Record<string, string | undefined> = process.env,
  execFn: ExecFn = realExec,
): () => Promise<Transport> {
  return async (): Promise<Transport> => {
    const bin = env[ENV_NAMES.curlImpersonateBin]?.trim();
    if (bin === undefined || bin === "") {
      throw new Error(
        `linkedin-fetch: ${ENV_NAMES.curlImpersonateBin} is not set — run npm run setup-curl, or put LINKEDIN_TRANSPORT=playwright in .env to skip the binary (README: PC operations)`,
      );
    }
    // No user-agent pair here ON PURPOSE: the chrome116 profile owns the
    // UA + TLS + HTTP/2 set; overriding its UA is the mismatched-signal
    // class the fingerprint exists to avoid (D2 amendment).
    const headerPairs = [
      `cookie: ${buildCookieHeader(cookies)}`,
      `csrf-token: ${csrfToken(cookies)}`,
      ...Object.entries(VOYAGER_STATIC_HEADERS).map(([name, value]) => `${name}: ${value}`),
    ];
    const get: VoyagerGet = async (url) => {
      const args = [
        "--impersonate",
        CURL_IMPERSONATE_PROFILE,
        "-sS",
        "--max-time",
        String(Math.round(REQUEST_TIMEOUT_MS / 1000)),
        "--compressed",
        url,
        ...headerPairs.flatMap((header) => ["-H", header]),
        "-w",
        `\n${STATUS_SENTINEL}%{http_code}`,
      ];
      let stdout: string;
      try {
        ({ stdout } = await execFn(bin, args));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`linkedin-fetch: curl exec failed — ${message}`);
      }
      const marker = stdout.lastIndexOf(STATUS_SENTINEL);
      if (marker === -1) {
        throw new Error("linkedin-fetch: curl produced no status marker (binary or flag mismatch)");
      }
      const status = Number(stdout.slice(marker + STATUS_SENTINEL.length).trim());
      if (!Number.isInteger(status) || status <= 0) {
        throw new Error("linkedin-fetch: curl status marker unparsable");
      }
      // The -w template writes "\n" before the sentinel: that separator is
      // not part of the body (a body with its own trailing newline keeps it).
      const raw = stdout.slice(0, marker);
      const body = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
      return { status, body };
    };
    return { get, dispose: async () => undefined };
  };
}

/**
 * Playwright API-request transport (the tested fallback, D2). The module's
 * dynamic-import quarantine site — the only `await import("playwright")`
 * outside fetch-threads. storageState carries the cookie pair (toStorageState
 * in linkedin-session.ts); the csrf-token and static headers ride
 * extraHTTPHeaders. Unexercised by the offline suite, like
 * chromiumContextFactory — the VoyagerGet seam carries the tests.
 */
export function createPlaywrightTransport(cookies: LinkedInCookies): () => Promise<Transport> {
  return async (): Promise<Transport> => {
    const { request } = await import("playwright");
    // Complete the session-module cookie shape to Playwright's storageState
    // wire type: session cookies carry no jar expiry (-1), and an
    // API-request context runs no scripts, so httpOnly/sameSite are inert
    // defaults. The session module stays the minimal contract (slice 2).
    const storageState = {
      cookies: toStorageState(cookies).cookies.map((cookie) => ({
        ...cookie,
        expires: -1,
        httpOnly: false,
        sameSite: "Lax" as const,
      })),
      origins: [],
    };
    const context = await request.newContext({
      storageState,
      extraHTTPHeaders: {
        "csrf-token": csrfToken(cookies),
        "user-agent": BROWSER_UA, // identical fingerprint to the curl adapter (plan-review amendment)
        ...VOYAGER_STATIC_HEADERS,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const get: VoyagerGet = async (url) => {
      // maxRedirects: 0 — a dead session presents as a 302 redirect loop;
      // following it burns ~20 unpaced redirects and ends in a plain throw
      // that bypasses the classifier. The status itself must reach the
      // §13.3 classifier, where the 3xx branch flags leg-dead (Phase 8).
      const response = await context.get(url, { maxRedirects: 0 });
      return { status: response.status(), body: await response.text() };
    };
    return {
      get,
      dispose: async () => {
        await context.dispose();
      },
    };
  };
}

/**
 * Resolve AND open the configured transport: `LINKEDIN_TRANSPORT` selects
 * `curl` (default, empty/unset included) or `playwright`; anything else
 * throws naming the allowed values (D2: no silent auto-switching — a
 * failed probe is followed by an operator edit + re-probe).
 */
export async function resolveLinkedInTransport(
  env: Record<string, string | undefined> = process.env,
  cookies: LinkedInCookies = resolveLinkedInCookies(env),
  execFn: ExecFn = realExec,
): Promise<Transport> {
  const selection = env[ENV_NAMES.linkedinTransport]?.trim() ?? "";
  const maker =
    selection === "" || selection === "curl"
      ? createCurlTransport(cookies, env, execFn)
      : selection === "playwright"
        ? createPlaywrightTransport(cookies)
        : null;
  if (maker === null) {
    throw new Error(
      `linkedin-fetch: ${ENV_NAMES.linkedinTransport}="${selection}" is not one of: curl, playwright`,
    );
  }
  return maker();
}

// --- the surface walk ---

interface PacingGate {
  readonly wait: () => Promise<void>;
}

/**
 * Shared pacing gate: every voyager GET starts PACE_MS or more after the
 * previous one, regardless of which surface issued it. The slot is
 * RESERVED BEFORE SLEEPING — the stamp advances synchronously on entry, so
 * concurrent workers can never compute the same wake time and fire a burst;
 * with width 2 the GET starts still space PACE_MS apart globally
 * (pacing-bound, not width-bound, D11). A per-walk closure (not module
 * state): two ticks must not inherit each other's stamp, and each test
 * run gets a fresh gate.
 */
function makePacingGate(now: () => number, sleepFn: SleepFn): PacingGate {
  let nextFreeAt = Number.NEGATIVE_INFINITY;
  return {
    wait: async () => {
      const slotAt = Math.max(now(), nextFreeAt);
      nextFreeAt = slotAt + PACE_MS;
      const waitMs = slotAt - now();
      if (waitMs > 0) {
        await sleepFn(waitMs);
      }
    },
  };
}

const defaultSleep: SleepFn = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Walk every configured linkedin surface: count-50 pages with
 * stop on a partial page (§12.8: returned posts < count
 * is the last page; `elements: []` lands as zero posts), one log line per
 * surface (empty-is-success, defb8af). Surface faults warn + skip (the
 * index arm owns the per-surface skip summary); leg-dead aborts the tick
 * whole via drain-then-throw; when EVERY surface faulted (none leg-dead),
 * the tagged AllSurfacesFaulted throws — the caller decides the write
 * (D13: a partial fault still publishes the survivors). Accepts a bare
 * VoyagerGet (tests, probe — no ownership) or an opened Transport
 * (scripts — disposed in finally).
 */
export async function fetchLinkedInPosts(
  surfaces: readonly LinkedinSurface[],
  cookies: LinkedInCookies,
  transport: VoyagerGet | Transport,
  sleepFn: SleepFn = defaultSleep,
  now: () => number = Date.now,
): Promise<Post[]> {
  const ownsTransport = typeof transport !== "function";
  const get: VoyagerGet = ownsTransport ? (transport as Transport).get : transport;
  const gate = makePacingGate(now, sleepFn);
  // Side arrays indexed by runPool's claim index — runPool returns void
  // (src/pool.ts:33-52); reassembly order comes from the filter+flat walk.
  const perSurface: Array<Post[] | undefined> = Array.from({ length: surfaces.length });
  let dropped = 0;
  let faultedCount = 0;
  let deadReason: string | undefined;

  try {
    await runPool(surfaces, LINKEDIN_FETCH_CONCURRENCY, async (surface, index) => {
      const label = `linkedin/${surface.value}`;
      try {
        const collected: Post[] = [];
        let start = 0;
        for (;;) {
          if (deadReason !== undefined) return; // stop claiming; the join re-throws
          await gate.wait();
          if (deadReason !== undefined) return;
          const response = await get(buildSearchUrl(surface.value, start, PAGE_SIZE));
          if (response.status !== 200) {
            const fault = classifyFault(response.status, response.body);
            if (fault.kind === "legDead") throw legDead(fault.reason);
            throw new Error(`${label} page ${start}: ${fault.reason}`);
          }
          const parsed = parseSearchResponse(response.body);
          if (parsed.kind === "unparsable") {
            throw new Error(`${label} page ${start}: unparsable 200 body — ${parsed.reason}`);
          }
          dropped += parsed.dropped;
          collected.push(...parsed.posts);
          if (parsed.posts.length < PAGE_SIZE) break;
          start += PAGE_SIZE;
        }
        // Stamp at the slot write (email-per-surface): the surface is a
        // LinkedinSurface, so type is always "linkedin" here. Fresh post
        // objects — the walk's collected array is never mutated.
        perSurface[index] = collected.map((post) => ({
          ...post,
          surfaces: [{ type: surface.type, value: surface.value }],
        }));
        // Empty-is-success keyed on the observable signal (defb8af): a
        // surface that yields 0 posts is an outcome, not a fault.
        console.log(`fetch: ${label} OK — ${collected.length} post(s)`);
      } catch (error) {
        if (isLegDead(error)) {
          // Drain-then-throw (judgePosts D11 shape): flag, stop claiming,
          // re-throw once after the join. The tick aborts whole — partial
          // posts are discarded, never half-written.
          deadReason ??= error.reason;
          console.warn(`fetch: ${label} LEG DEAD — ${error.reason}`);
          return;
        }
        faultedCount += 1; // non-leg-dead arm only; the leg-dead arm returns above
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`fetch: ${label} FAILED — ${message}`);
      }
    });
  } finally {
    if (ownsTransport) await (transport as Transport).dispose();
  }

  if (deadReason !== undefined) {
    throw legDead(deadReason);
  }
  if (surfaces.length > 0 && faultedCount === surfaces.length) {
    throw allSurfacesFaulted(faultedCount);
  }
  if (dropped > 0) {
    console.warn(`fetch: linkedin dropped ${dropped} malformed row(s)`);
  }
  return perSurface.filter((entry): entry is Post[] => entry !== undefined).flat();
}
