/**
 * Cooldown-gated credential login for LinkedIn (Phase 7).
 *
 * The primary session contract is unchanged (src/threads-session.ts): a
 * base64 storageState secret. This module is the fallback that runs when
 * that secret is absent or invalid and LINKEDIN_EMAIL + LINKEDIN_PASSWORD
 * are configured: ONE headless login attempt per run. A LinkedIn-facing
 * verdict (checkpoint, bad credentials) cools the account down for 6h;
 * transient infra faults degrade WITHOUT cooling, so a network blip never
 * silences the login. Every failure path lands in the caller's
 * skip-and-warn policy (D5) — never a thrown run.
 *
 * Evidence basis (research, session/auth): automated credential login is
 * the most-challenged LinkedIn pattern — CAPTCHAs, email OTP, device
 * verification, account restriction. The single attempt, the 6h cooldown
 * (10-min cron = at most 4 attempts/day), and the outcome classification
 * all exist to keep the account off LinkedIn's restriction radar.
 *
 * Layering: this module imports fetch-threads types only (type-only, erased
 * at runtime), so the walker direction is preserved and importing this
 * module never loads Playwright. Offline tests inject structural doubles.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextFactory, ContextLike, LocatorLike, PageLike } from "./fetch-threads.js";

/** Outcome of one credential login attempt. */
export type LoginOutcome = "ok" | "challenge" | "bad-credentials";

/** Login navigation and settle windows. Unmeasured until the first CI runs. */
const LOGIN_NAV_TIMEOUT_MS = 30_000;
const LOGIN_SETTLE_MS = 5_000;

/**
 * The page the login flow drives: a PageLike whose url and locator seam are
 * required. The production adapter provides both; the standalone shape keeps
 * the requirement local instead of forcing every walk double to grow
 * login-only members (same policy as the optional mouse wheel).
 */
export interface LoginPageLike {
  goto(url: string, options?: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  locator(selector: string): LoginLocatorLike;
  waitForTimeout(ms: number): Promise<void>;
  url(): string;
  close(): Promise<void>;
}

/** A locator the login flow can type into and click. */
export interface LoginLocatorLike {
  first(): LoginLocatorLike;
  fill(value: string): Promise<void>;
  click(): Promise<void>;
}

/**
 * Drive one headless credential login on a fresh page. LinkedIn's challenge
 * wall (CAPTCHA, email OTP, device verification) redirects to /checkpoint/,
 * which headless CI cannot answer — that outcome is "challenge", never a
 * retry: the 6h cooldown (see the index wiring) keeps the account off
 * LinkedIn's restriction radar. Landing anywhere else than /checkpoint/ or
 * /login is classified "ok", but the walker's first-response window stays
 * the real success oracle.
 */
export async function loginLinkedIn(
  page: LoginPageLike,
  email: string,
  password: string,
): Promise<LoginOutcome> {
  await page.goto("https://www.linkedin.com/login", {
    waitUntil: "domcontentloaded",
    timeout: LOGIN_NAV_TIMEOUT_MS,
  });
  // Selectors verified live 2026-10-31 (headless chromium, production
  // conditions): the /login page carries NO #session_key / #session_password
  // ids (React-generated ids, no name attributes, no <form> element) and the
  // Login button is type="button" with per-deploy obfuscated classes and
  // locale-dependent text ("Sign in" / "Login"). The stable anchors are the
  // autocomplete attributes plus the primary button's layout position below
  // the password field. Inputs exist TWICE (desktop + mobile layouts; the
  // first copy is hidden) and the form hydrates after domcontentloaded, so
  // every locator filters :visible and rides Playwright's actionability wait.
  await page.locator('input[autocomplete="username"]:visible').first().fill(email);
  await page.locator('input[autocomplete="current-password"]:visible').first().fill(password);
  // Exactly one visible button candidate sits below the password input; the
  // layout anchor is locale-free and .first() rides the LocatorLike seam.
  await page
    .locator('button:visible:below(input[autocomplete="current-password"]:visible)')
    .first()
    .click();
  // Settle the POST + redirect before classifying. Verified with a failed
  // dummy-credential login (2026-10-31): the POST fires
  // (/flagship-web/rsc-action/actions/server-request), the inline error
  // renders, and the URL stays on /login -> "bad-credentials"; /checkpoint/
  // -> "challenge".
  await page.waitForTimeout(LOGIN_SETTLE_MS);
  const url = page.url();
  if (url.includes("/checkpoint/")) return "challenge";
  if (url.includes("/login")) return "bad-credentials";
  return "ok";
}

/** True when the login page is done challenging and a session cookie exists. */
export function looksAuthenticated(cookies: ReadonlyArray<{ name: string }>, url: string): boolean {
  return !url.includes("/checkpoint/") && cookies.some((cookie) => cookie.name === "li_at");
}

/**
 * Result of one full login attempt against a context factory: the outcome
 * plus, on success, the fresh storage-state file path. The path's temp dir
 * is the caller's to clean up (paired teardown, F019) so the walk can read
 * it first; on any failure the dir is already gone.
 *
 * The outcome union separates WHO failed, because the cooldown policy
 * differs: "challenge" / "bad-credentials" are LinkedIn's verdict and cool
 * the account down; "transient" is OUR side (network fault, navigation
 * error, a half-capable adapter, a failed state export) and must NOT cool
 * down — a 6h silence for a network blip would defeat the login's purpose
 * and mislabel the account as challenged.
 */
export interface LoginAttemptResult {
  outcome: LoginOutcome | "transient";
  /** Fresh storage-state file path on "ok"; null on every other outcome. */
  sessionPath: string | null;
}

/**
 * Bridge a PageLike onto the login page shape, failing visibly when the
 * adapter cannot support the flow. Lives here (not on the shared seam) so
 * the walk doubles stay minimal; exported for the headed operator script,
 * which drives the same flow through the same adapter.
 */
export function loginPageFrom(page: PageLike): LoginPageLike {
  const url = page.url;
  if (url === undefined) {
    throw new Error("page exposes no url — cannot classify the login outcome");
  }
  return {
    goto: (target, options) => page.goto(target, options),
    locator: (selector) => loginLocatorFrom(page.locator(selector)),
    waitForTimeout: (ms) => page.waitForTimeout(ms),
    url: () => url.call(page),
    close: () => page.close(),
  };
}

/** Bridge a LocatorLike onto the login locator shape (fill required). */
function loginLocatorFrom(locator: LocatorLike): LoginLocatorLike {
  const fill = locator.fill;
  if (fill === undefined) {
    throw new Error("locator exposes no fill — the login flow cannot type credentials");
  }
  const adapted: LoginLocatorLike = {
    first: () => adapted,
    fill: (value) => fill.call(locator, value),
    click: () => locator.click(),
  };
  return adapted;
}

/**
 * Run the credential login against a context factory and, on success,
 * export the fresh session to a temp storage-state file.
 *
 * The context is built from NO stored session (a fresh browser). A
 * LinkedIn-facing failure (checkpoint, bad credentials) closes the context,
 * removes the temp dir, and returns the verdict — the caller cools the
 * account down. An infra fault (network, navigation, a half-capable
 * adapter, a failed export leg) degrades to "transient": warned, no
 * cooldown, surfaces skip this run — because a half-exported session must
 * never walk, but a network blip must not silence the login for 6h (D5:
 * login failures never crash the run).
 */
export async function loginLinkedInContext(
  contextFactory: ContextFactory,
  email: string,
  password: string,
): Promise<LoginAttemptResult> {
  const dir = await mkdtemp(join(tmpdir(), "loker-linkedin-login-"));
  const sessionPath = join(dir, "storage-state.json");
  let keepDir = false;
  let context: ContextLike | null = null;
  try {
    context = await contextFactory();
    const page = await context.newPage();
    // The bridge validates the url seam once; loginPage.url() is the
    // required-shape accessor from here on.
    const loginPage = loginPageFrom(page);
    const outcome = await loginLinkedIn(loginPage, email, password);
    if (outcome !== "ok") {
      return { outcome, sessionPath: null };
    }
    // Belt and braces: the URL said ok, but a session without li_at cannot
    // walk — classify it as bad credentials rather than hand the walker an
    // authwall-bound context.
    const readCookies = context.cookies;
    if (readCookies === undefined) {
      throw new Error("context exposes no cookies — cannot export the fresh session");
    }
    const jar = await readCookies.call(context);
    if (!looksAuthenticated(jar, loginPage.url())) {
      return { outcome: "bad-credentials", sessionPath: null };
    }
    await writeFile(sessionPath, JSON.stringify({ cookies: jar, origins: [] }), "utf8");
    keepDir = true;
    return { outcome: "ok", sessionPath };
  } catch (error) {
    // Infra fault, NOT LinkedIn's verdict: no cooldown marker — only a
    // genuine /checkpoint/ or /login landing may cool the account down.
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.warn(`fetch: linkedin login attempt failed (transient) — ${message}`);
    return { outcome: "transient", sessionPath: null };
  } finally {
    if (context !== null) await context.close();
    if (!keepDir) await rm(dir, { recursive: true, force: true });
  }
}

// --- The cooldown marker -------------------------------------------------

/**
 * One LinkedIn-facing failure silences further attempts for 6h (10-min
 * cron = at most 4 attempts/day worst case). A TRANSIENT failure does not
 * cool down on its own — but three transients in a row are a PERSISTENT
 * fault (the runner IP is blocked, a local security tool eats the
 * network), so the third escalates to the same 6h cooldown. At the 10-min
 * cron that bounds the worst case at three attempts per 6h+ window
 * instead of 144 unbounded retries/day against LinkedIn.
 */
const LOGIN_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Consecutive transients that escalate to the full 6h cooldown. */
export const TRANSIENT_ESCALATION_ATTEMPTS = 3;

/** What a failed attempt wrote: LinkedIn's verdicts, or our fault count. */
export type LoginMarkerOutcome = Exclude<LoginOutcome, "ok"> | "transient";

/** What a failed attempt wrote, and when. "ok" never writes a marker. */
export interface LoginMarker {
  lastAttempt: string; // ISO 8601
  lastOutcome: LoginMarkerOutcome;
  /** Running count of consecutive transients; any verdict or success resets it. */
  consecutiveTransients: number;
}

/** Read and shape-check a marker; null when absent, corrupt, or unstamped. */
async function readMarker(markerPath: string): Promise<LoginMarker | null> {
  const raw = await readFile(markerPath, "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    const marker = JSON.parse(raw) as LoginMarker;
    if (!Number.isFinite(Date.parse(marker.lastAttempt))) return null;
    return marker;
  } catch {
    return null; // corrupt marker = fail open; the login itself still degrades safely
  }
}

/**
 * True when an attempt is allowed: no marker, a corrupt or unreadable
 * marker (fail open — the login itself still degrades safely), a
 * LinkedIn-verdict failure old enough that the cooldown has passed, or a
 * transient series that has not yet reached the escalation threshold.
 */
export async function loginAllowed(markerPath: string, now: () => number): Promise<boolean> {
  const marker = await readMarker(markerPath);
  if (marker === null) return true;
  if (marker.lastOutcome === undefined) return true; // legacy/stamped-only marker: fail open
  const at = Date.parse(marker.lastAttempt);
  if (!Number.isFinite(at)) return true;
  const cooling =
    marker.lastOutcome !== "transient" ||
    (marker.consecutiveTransients ?? 0) >= TRANSIENT_ESCALATION_ATTEMPTS;
  return now() - at >= LOGIN_COOLDOWN_MS || !cooling;
}

/**
 * Record a failed attempt and return the transient streak it wrote (0 for
 * a LinkedIn verdict — a verdict RESETS the streak). "ok" is not accepted
 * (success needs no cooldown — the fresh secret is the gate); the
 * parameter type rejects it. A transient within the cooldown window
 * continues the previous series; an older one starts a fresh series at 1.
 */
export async function writeLoginMarker(
  markerPath: string,
  outcome: LoginMarkerOutcome,
  now: () => number,
): Promise<number> {
  const previous = await readMarker(markerPath);
  let consecutiveTransients = 0;
  if (outcome === "transient") {
    const previousAt = previous !== null ? Date.parse(previous.lastAttempt) : Number.NaN;
    const recent =
      previous !== null && Number.isFinite(previousAt) && now() - previousAt < LOGIN_COOLDOWN_MS;
    consecutiveTransients =
      recent && previous.lastOutcome === "transient"
        ? (previous.consecutiveTransients ?? 0) + 1
        : 1;
  }
  const marker: LoginMarker = {
    lastAttempt: new Date(now()).toISOString(),
    lastOutcome: outcome,
    consecutiveTransients,
  };
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  return consecutiveTransients;
}

/**
 * Remove the marker entirely — the success reset. A stale transient series
 * from earlier runs must not count against the next fault.
 */
export async function clearLoginMarker(markerPath: string): Promise<void> {
  await rm(markerPath, { force: true }).catch(() => undefined);
}
