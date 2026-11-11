/**
 * LinkedIn session material for the PC-local browser leg (design D4).
 *
 * One cookie file OUTSIDE the repo — exported interactively from a
 * logged-in browser (DOCUMENTATION.md §2.4 VERIFIED; 2FA dead-ends headless
 * login, so no automated re-login exists) — resolves to every shape the
 * leg needs:
 *
 * - resolveLinkedInCookies: fail-visible read + validation. The leg has no
 *   reason to exist without a session, so this is stricter than the
 *   silent-null Threads model (resolveSession in src/threads-session.ts).
 * - buildCookieHeader: the browser session's Cookie header. li_at rides first
 *   and unquoted; JSESSIONID keeps its quotes and rides last (§10 template;
 *   §14.5 keeps JSESSIONID last in the header).
 * - csrfToken: the csrf-token header value — the JSESSIONID value with the
 *   quotes stripped (§3, §7 gotcha 5). A wrong or absent value is a 403
 *   "CSRF check failed." on every authenticated request (§13.1).
 * - toStorageState: a storageState document for the Playwright adapter
 *   (slice 3), synthesized from the same pair.
 *
 * The stored jsessionid is normalized once on resolve (one surrounding `"`
 * pair stripped when present): the browser jar stores the value quoted and
 * export tools differ — both dialects resolve to one canonical internal
 * form, and the quote asymmetry is re-applied at the two build sites.
 * SPEC OF RECORD: H:/fork/linkedin-reverse/DOCUMENTATION.md.
 */
import { readFileSync } from "node:fs";
import { ENV_NAMES } from "./config.js";

/** The resolved cookie pair; jsessionId is canonical (quotes stripped). */
export interface LinkedInCookies {
  readonly liAt: string;
  readonly jsessionId: string;
  /**
   * Machine-written harvest stamp (FR-0, design 2026-11-09): an ISO-8601
   * instant scripts/login-linkedin.ts records at harvest time. Optional on
   * read by contract — the resolver tolerates its absence (a legacy cookie
   * file keeps working for scripts/probe-linkedin.ts); ENFORCEMENT is the
   * fetchTick gate in scripts/fetch-linkedin.ts, where presence is required
   * and age is never checked.
   */
  readonly harvestedAt?: string;
}

function fail(reason: string): Error {
  return new Error(`linkedin-cookies: ${reason}`);
}

/**
 * Strip one surrounding quote pair from an exported JSESSIONID value. An
 * empty stripped value is no session — the jar's value always carries the
 * `ajax:<digits>` token (§1), and an empty one mints an empty csrf-token
 * header, a guaranteed 403 "CSRF check failed." on every GET (§13.1) — so
 * it fails here, naming the file, not remotely on tick 1. Any quote deeper
 * than the stripped pair marks a malformed export.
 */
function canonicalJsessionid(value: string, where: string): string {
  const unquoted =
    value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  if (unquoted === "") {
    throw fail(`${where} no usable "jsessionid" value`);
  }
  if (unquoted.includes('"')) {
    throw fail(`${where} stray quotes inside "jsessionid"`);
  }
  return unquoted;
}

/**
 * Read one required string field. Missing, non-string, and empty values are
 * one failure class (D4 "missing cookies"); li_at never carries quotes, so
 * a quoted li_at is malformed too.
 */
function readCookieField(
  doc: Record<string, unknown>,
  key: "liAt" | "jsessionid",
  where: string,
): string {
  const raw: unknown = doc[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw fail(`${where} no usable "${key}" value`);
  }
  const value = raw.trim();
  if (key === "liAt" && value.includes('"')) {
    throw fail(`${where} a quote inside "liAt"`);
  }
  return value;
}

/**
 * Read LINKEDIN_COOKIES_FILE — a JSON `{ liAt, jsessionid }` pair exported
 * interactively from a logged-in browser — and return the canonical pair.
 * Fail-visible by contract (D4): unset/blank/unreadable/missing-file/
 * malformed-JSON/missing-field all THROW with a message naming the
 * variable; the fetch leg has no reason to run without a session.
 */
export function resolveLinkedInCookies(
  env: Record<string, string | undefined> = process.env,
): LinkedInCookies {
  const envName = ENV_NAMES.linkedinCookiesFile;
  const raw = env[envName];
  const filePath = raw === undefined ? "" : raw.trim();
  if (filePath === "") {
    throw fail(
      `${envName} is not set — run "npm run login-linkedin" to create the cookie file (README: PC operations)`,
    );
  }
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw fail(
        `${envName} points at ${filePath}, which does not exist — run "npm run login-linkedin" to create it, or fix the path (README: PC operations)`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw fail(`${envName} points at ${filePath}, which is unreadable — ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw fail(`${envName} points at ${filePath}, which is not valid JSON — ${message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw fail(`${envName} points at ${filePath}, which is not a JSON object`);
  }
  const doc = parsed as Record<string, unknown>;
  const where = `${envName} points at ${filePath} with`;
  const liAt = readCookieField(doc, "liAt", where);
  const jsessionId = canonicalJsessionid(readCookieField(doc, "jsessionid", where), where);
  // FR-0, tolerant read (design 2026-11-09): present + non-empty string rides
  // through trimmed; anything else leaves the key ABSENT — enforcement is the
  // fetchTick gate's job, never this resolver's (the probe must keep working
  // on a legacy stampless file).
  const stamp = doc.harvestedAt;
  return typeof stamp === "string" && stamp.trim() !== ""
    ? { liAt, jsessionId, harvestedAt: stamp.trim() }
    : { liAt, jsessionId };
}

/**
 * The browser session's Cookie header (§10 template): li_at first, unquoted;
 * JSESSIONID last, keeping the quotes the browser jar stores (§14.5 keeps
 * JSESSIONID last in the header).
 */
export function buildCookieHeader(cookies: LinkedInCookies): string {
  return `li_at=${cookies.liAt}; JSESSIONID="${cookies.jsessionId}"`;
}

/** The csrf-token header value: the JSESSIONID value, quotes stripped (§3, §7 gotcha 5). */
export function csrfToken(cookies: LinkedInCookies): string {
  return cookies.jsessionId;
}

/** One cookie entry shaped for Playwright's storageState contract (extras stay optional on Playwright's side). */
export interface LinkedInStorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}

/**
 * A storageState document for the Playwright adapter (slice 3). Mutable
 * field shapes on purpose: readonly arrays would not assign to Playwright's
 * storageState context option; this factory returns a fresh object per
 * call, so purity is not at risk.
 */
export interface LinkedInStorageState {
  cookies: LinkedInStorageCookie[];
  origins: never[];
}

/**
 * Synthesize the storageState the Playwright adapter feeds newContext()
 * (slice 3). The JSESSIONID value keeps its quotes — that is the jar's
 * literal value, so adapter requests emit `Cookie: ... JSESSIONID="ajax:..."`
 * (§10). domain ".linkedin.com" covers the www host; both cookies are
 * Secure in a real browser jar.
 */
export function toStorageState(cookies: LinkedInCookies): LinkedInStorageState {
  return {
    cookies: [
      { name: "li_at", value: cookies.liAt, domain: ".linkedin.com", path: "/", secure: true },
      {
        name: "JSESSIONID",
        value: `"${cookies.jsessionId}"`,
        domain: ".linkedin.com",
        path: "/",
        secure: true,
      },
    ],
    origins: [],
  };
}
