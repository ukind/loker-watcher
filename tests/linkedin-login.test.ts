/**
 * Offline suite for the Phase 7 credential-login fallback
 * (src/linkedin-login.ts): URL outcome classification, the verified
 * autocomplete + below-layout selector anchors, the cookie pin, the
 * cooldown marker gate, and the context-level login/export lifecycle.
 * Every double is a hand-written literal; nothing here touches a network
 * or a browser.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import type { ContextFactory, ContextLike, LocatorLike, PageLike } from "../src/fetch-threads.js";
import {
  type LoginAttemptResult,
  type LoginMarker,
  clearLoginMarker,
  loginAllowed,
  loginLinkedIn,
  loginLinkedInContext,
  looksAuthenticated,
  writeLoginMarker,
} from "../src/linkedin-login.js";

// Pinned clock (UTC): 2026-10-26T09:14:00.000Z — every gate reads it
// through an injected now; the tests never touch the system clock.
const NOW = Date.UTC(2026, 9, 26, 9, 14, 0);
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

// Selector pins, live-verified 2026-10-31 (headless chromium, production
// conditions): the /login page carries NO #session_key/#session_password
// ids — the stable anchors are the autocomplete attributes plus the
// primary button below the password field. See src/linkedin-login.ts.
const EMAIL_SELECTOR = 'input[autocomplete="username"]:visible';
const PASSWORD_SELECTOR = 'input[autocomplete="current-password"]:visible';
const SUBMIT_SELECTOR = 'button:visible:below(input[autocomplete="current-password"]:visible)';

/** Fresh-session cookies the login context reports. */
const FRESH_COOKIES = [{ name: "li_at", value: "x" }];

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Temp path for markers and exported sessions; seeded when content given. */
async function tempPath(name: string, content?: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-login-"));
  const path = join(dir, name);
  if (content !== undefined) {
    await writeFile(path, content, "utf8");
  }
  return path;
}

/**
 * Login-page double: records every selector and every fill, and reports
 * the fixed outcome URL the classification reads after the settle window.
 */
function loginPageDouble(finalUrl: string): {
  page: LoginPageDouble;
  selectors: string[];
  fills: Array<{ selector: string; value: string }>;
} {
  const selectors: string[] = [];
  const fills: Array<{ selector: string; value: string }> = [];
  const page = {
    goto: async () => undefined,
    locator: (selector: string) => {
      selectors.push(selector);
      const loc = {
        first: () => loc,
        fill: async (value: string) => {
          fills.push({ selector, value });
        },
        click: async () => undefined,
      };
      return loc;
    },
    waitForTimeout: async () => undefined,
    url: () => finalUrl,
    close: async () => undefined,
  };
  return { page, selectors, fills };
}

/** The login page shape the flow drives (structural, test-local). */
type LoginPageDouble = import("../src/linkedin-login.js").LoginPageLike;

/**
 * Context double for loginLinkedInContext: one page running the login
 * flow, a cookie jar for the fresh-session export, and a close flag.
 */
function loginContextDouble(options: {
  finalUrl: string;
  cookies?: ReadonlyArray<{ name: string }>;
  omitCookies?: boolean;
  /** Thrown by page.goto — simulates a network/firewall infra fault. */
  gotoError?: Error;
}): { factory: ContextFactory; closed: () => boolean; storagePaths: Array<string | undefined> } {
  let closed = false;
  const storagePaths: Array<string | undefined> = [];
  const { page } = loginPageDouble(options.finalUrl);
  if (options.gotoError !== undefined) {
    page.goto = async () => {
      throw options.gotoError;
    };
  }
  const context: ContextLike = {
    newPage: async () => page as PageLike,
    addInitScript: async () => undefined,
    close: async () => {
      closed = true;
    },
    ...(options.omitCookies === true
      ? {}
      : { cookies: async () => options.cookies ?? FRESH_COOKIES }),
  };
  const factory: ContextFactory = async (storageStatePath?: string) => {
    storagePaths.push(storageStatePath);
    return context;
  };
  return { factory, closed: () => closed, storagePaths };
}

describe("loginLinkedIn", () => {
  it("classifies a /checkpoint/ landing as challenge", async () => {
    const { page } = loginPageDouble("https://www.linkedin.com/checkpoint/challengesV2/collect");
    assert.equal(await loginLinkedIn(page, "op@example.com", "pw"), "challenge");
  });

  it("classifies a /login landing as bad credentials", async () => {
    const { page } = loginPageDouble("https://www.linkedin.com/login");
    assert.equal(await loginLinkedIn(page, "op@example.com", "pw"), "bad-credentials");
  });

  it("classifies a feed landing as ok (the walk is the real oracle)", async () => {
    const { page } = loginPageDouble("https://www.linkedin.com/feed/");
    assert.equal(await loginLinkedIn(page, "op@example.com", "pw"), "ok");
  });

  it("types into the verified autocomplete anchors, never the dead ids", async () => {
    const { page, selectors, fills } = loginPageDouble("https://www.linkedin.com/feed/");
    await loginLinkedIn(page, "op@example.com", "op-password");
    // Exactly the three live-verified anchors, in order.
    assert.deepEqual(selectors, [EMAIL_SELECTOR, PASSWORD_SELECTOR, SUBMIT_SELECTOR]);
    // The credentials rode the autocomplete inputs.
    assert.deepEqual(fills, [
      { selector: EMAIL_SELECTOR, value: "op@example.com" },
      { selector: PASSWORD_SELECTOR, value: "op-password" },
    ]);
    // The falsified id selectors never appear (plan revision 2026-10-31).
    assert.ok(selectors.every((s) => !s.includes("session_key")));
    assert.ok(selectors.every((s) => !s.includes("session_password")));
  });
});

describe("looksAuthenticated", () => {
  it("is true with li_at outside the checkpoint", () => {
    assert.equal(looksAuthenticated(FRESH_COOKIES, "https://www.linkedin.com/feed/"), true);
  });

  it("is false without li_at", () => {
    assert.equal(
      looksAuthenticated([{ name: "bcookie" }], "https://www.linkedin.com/feed/"),
      false,
    );
  });

  it("is false on the checkpoint even with li_at", () => {
    assert.equal(
      looksAuthenticated(FRESH_COOKIES, "https://www.linkedin.com/checkpoint/challengesV2/collect"),
      false,
    );
  });
});

describe("loginAllowed", () => {
  it("allows when no marker exists", async () => {
    const markerPath = await tempPath("gate-absent.json");
    assert.equal(await loginAllowed(markerPath, () => NOW), true);
  });

  it("blocks within the 6h cooldown after a failure", async () => {
    const markerPath = await tempPath(
      "gate-fresh.json",
      JSON.stringify({ lastAttempt: iso(NOW - HOUR), lastOutcome: "challenge" }),
    );
    assert.equal(await loginAllowed(markerPath, () => NOW), false);
  });

  it("allows once the cooldown has passed (boundary inclusive)", async () => {
    const markerPath = await tempPath(
      "gate-expired.json",
      JSON.stringify({ lastAttempt: iso(NOW - 6 * HOUR), lastOutcome: "bad-credentials" }),
    );
    assert.equal(await loginAllowed(markerPath, () => NOW), true);
  });

  it("fails open on a corrupt marker", async () => {
    const markerPath = await tempPath("gate-corrupt.json", "not json {{{");
    assert.equal(await loginAllowed(markerPath, () => NOW), true);
  });

  it("fails open when lastOutcome is missing", async () => {
    const markerPath = await tempPath(
      "gate-no-outcome.json",
      JSON.stringify({ lastAttempt: iso(NOW) }),
    );
    assert.equal(await loginAllowed(markerPath, () => NOW), true);
  });

  it("fails open when lastAttempt is not ISO", async () => {
    const markerPath = await tempPath(
      "gate-bad-stamp.json",
      JSON.stringify({ lastAttempt: "yesterday", lastOutcome: "challenge" }),
    );
    assert.equal(await loginAllowed(markerPath, () => NOW), true);
  });

  it("blocks on the third consecutive transient and lifts after the cooldown", async () => {
    const markerPath = await tempPath("gate-streak.json");
    await writeLoginMarker(markerPath, "transient", () => NOW - 3 * HOUR);
    assert.equal(await loginAllowed(markerPath, () => NOW), true); // 1st: retry
    await writeLoginMarker(markerPath, "transient", () => NOW - 2 * HOUR);
    assert.equal(await loginAllowed(markerPath, () => NOW), true); // 2nd: retry
    await writeLoginMarker(markerPath, "transient", () => NOW - HOUR);
    assert.equal(await loginAllowed(markerPath, () => NOW), false); // 3rd: persistent fault
    assert.equal(await loginAllowed(markerPath, () => NOW + 4 * HOUR), false);
    assert.equal(await loginAllowed(markerPath, () => NOW + 5 * HOUR), true); // boundary
    // The expired series does not carry over: a fresh transient restarts at 1.
    const streak = await writeLoginMarker(markerPath, "transient", () => NOW + 5 * HOUR);
    assert.equal(streak, 1);
  });

  it("a LinkedIn verdict between transients resets the streak", async () => {
    const markerPath = await tempPath("gate-verdict-reset.json");
    await writeLoginMarker(markerPath, "transient", () => NOW - 2 * HOUR);
    await writeLoginMarker(markerPath, "bad-credentials", () => NOW - HOUR);
    const stored = JSON.parse(await readFile(markerPath, "utf8")) as LoginMarker;
    assert.equal(stored.consecutiveTransients, 0);
    const streak = await writeLoginMarker(markerPath, "transient", () => NOW);
    assert.equal(streak, 1); // fresh series, not a continuation
  });

  it("clearLoginMarker removes the marker so success resets any series", async () => {
    const markerPath = await tempPath("gate-clear.json");
    await writeLoginMarker(markerPath, "transient", () => NOW);
    await clearLoginMarker(markerPath);
    await assert.rejects(() => readFile(markerPath, "utf8"), /ENOENT/);
  });
});

describe("writeLoginMarker", () => {
  it("records a verdict with an ISO stamp and a reset streak", async () => {
    const markerPath = await tempPath("marker-failure.json");
    const streak = await writeLoginMarker(markerPath, "bad-credentials", () => NOW);
    assert.equal(streak, 0); // a verdict resets the series
    const stored = JSON.parse(await readFile(markerPath, "utf8")) as LoginMarker;
    assert.deepEqual(stored, {
      lastAttempt: iso(NOW),
      lastOutcome: "bad-credentials",
      consecutiveTransients: 0,
    });
  });

  it("records a transient with a running streak", async () => {
    const markerPath = await tempPath("marker-transient.json");
    assert.equal(await writeLoginMarker(markerPath, "transient", () => NOW - HOUR), 1);
    assert.equal(await writeLoginMarker(markerPath, "transient", () => NOW), 2);
    const stored = JSON.parse(await readFile(markerPath, "utf8")) as LoginMarker;
    assert.equal(stored.lastOutcome, "transient");
    assert.equal(stored.consecutiveTransients, 2);
  });

  it("rejects ok at compile time — success needs no cooldown marker", () => {
    // If writeLoginMarker's outcome type ever widens back to include "ok",
    // the @ts-expect-error directive goes unused and tsc fails the build.
    // @ts-expect-error — "ok" is not a cooldown outcome.
    const widened: Parameters<typeof writeLoginMarker>[1] = "ok";
    assert.equal(widened, "ok");
  });
});

describe("loginLinkedInContext", () => {
  const exported: string[] = [];
  after(async () => {
    for (const path of exported) {
      await rm(path, { force: true });
      await rm(dirname(path), { recursive: true, force: true });
    }
  });

  it("exports the fresh session to a temp storage-state file on ok", async () => {
    const { factory, closed, storagePaths } = loginContextDouble({
      finalUrl: "https://www.linkedin.com/feed/",
    });
    const result: LoginAttemptResult = await loginLinkedInContext(factory, "op@example.com", "pw");
    assert.equal(result.outcome, "ok");
    assert.notEqual(result.sessionPath, null);
    // The fresh context was built from NO stored session.
    assert.deepEqual(storagePaths, [undefined]);
    // The export is a storageState document carrying the cookie jar.
    const document = JSON.parse(await readFile(result.sessionPath ?? "", "utf8")) as {
      cookies: ReadonlyArray<{ name: string }>;
      origins: unknown[];
    };
    assert.deepEqual(document.cookies, FRESH_COOKIES);
    assert.deepEqual(document.origins, []);
    // The context closed; the temp dir stays for the caller (paired cleanup).
    assert.equal(closed(), true);
    if (result.sessionPath !== null) exported.push(result.sessionPath);
  });

  it("returns the outcome with no path on a challenge and closes the context", async () => {
    const { factory, closed } = loginContextDouble({
      finalUrl: "https://www.linkedin.com/checkpoint/challengesV2/collect",
    });
    const result = await loginLinkedInContext(factory, "op@example.com", "pw");
    assert.deepEqual(result, { outcome: "challenge", sessionPath: null });
    assert.equal(closed(), true);
  });

  it("returns bad credentials when the page stays on /login", async () => {
    const { factory, closed } = loginContextDouble({ finalUrl: "https://www.linkedin.com/login" });
    const result = await loginLinkedInContext(factory, "op@example.com", "pw");
    assert.deepEqual(result, { outcome: "bad-credentials", sessionPath: null });
    assert.equal(closed(), true);
  });

  it("classifies a navigation fault as transient — never LinkedIn's challenge verdict", async () => {
    const { factory, closed } = loginContextDouble({
      finalUrl: "https://www.linkedin.com/feed/",
      gotoError: new Error(
        "page.goto: net::ERR_NETWORK_ACCESS_DENIED at https://www.linkedin.com/login",
      ),
    });
    const result = await loginLinkedInContext(factory, "op@example.com", "pw");
    // A network fault must not cool the account down as a challenge.
    assert.deepEqual(result, { outcome: "transient", sessionPath: null });
    assert.equal(closed(), true);
  });

  it("reclassifies a feed landing without li_at as bad credentials", async () => {
    const { factory } = loginContextDouble({
      finalUrl: "https://www.linkedin.com/feed/",
      cookies: [{ name: "bcookie" }],
    });
    const result = await loginLinkedInContext(factory, "op@example.com", "pw");
    assert.deepEqual(result, { outcome: "bad-credentials", sessionPath: null });
  });

  it("degrades a cookie-less context to a transient fault, never a throw", async () => {
    const { factory } = loginContextDouble({
      finalUrl: "https://www.linkedin.com/feed/",
      omitCookies: true,
    });
    const result = await loginLinkedInContext(factory, "op@example.com", "pw");
    assert.deepEqual(result, { outcome: "transient", sessionPath: null });
  });
});
