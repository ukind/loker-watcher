/**
 * Offline suite for the login helper core (Phase 7).
 *
 * The headed browser never opens here: runLoginHelper's context seam is
 * injected, sleeps and the clock are injected, and the file writes land
 * in OS temp. Pins the harvest contract (verbatim cookie values, quoted
 * JSESSIONID kept), the atomic cookie-file write, and the poll/timeout
 * loop over injected doubles. (The .env upsert unit pins moved to
 * tests/env-file.test.ts in Phase 9 — the writer now lives in
 * src/env-file.ts; the runLoginHelper pin below still proves the line
 * lands.)
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type LoginContext,
  findSessionCookies,
  keepOpenForArgv,
  runLoginHelper,
  writeCookieFile,
} from "../scripts/login-linkedin.js";
import { ENV_NAMES } from "../src/config.js";
import { resolveLinkedInCookies } from "../src/linkedin-session.js";

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function workPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-login-linkedin-"));
  return join(dir, name);
}

const JAR: Array<{ name: string; value: string }> = [
  { name: "bcookie", value: "noise" },
  { name: "JSESSIONID", value: '"ajax:0123456789012345678"' },
  { name: "li_at", value: "AQE-live-li-at" },
];

describe("findSessionCookies", () => {
  it("returns null until BOTH li_at and JSESSIONID are present and non-empty", () => {
    assert.equal(findSessionCookies([]), null);
    assert.equal(findSessionCookies([{ name: "li_at", value: "AQE" }]), null);
    assert.equal(findSessionCookies([{ name: "JSESSIONID", value: '"ajax:1"' }]), null);
    assert.equal(findSessionCookies([{ name: "li_at", value: "  " }, ...JAR.slice(1)]), null);
  });

  it("harvests the pair verbatim — the quoted JSESSIONID stays quoted", () => {
    assert.deepEqual(findSessionCookies(JAR), {
      liAt: "AQE-live-li-at",
      jsessionid: '"ajax:0123456789012345678"',
    });
  });
});

const STAMP = "2026-11-10T00:00:00.000Z";

describe("writeCookieFile", () => {
  it("writes the canonical JSON atomically and the session resolver reads it back", async () => {
    const path = await workPath("cookies.json");
    await writeCookieFile(
      { liAt: "AQE-live-li-at", jsessionid: '"ajax:0123456789012345678"' },
      path,
      STAMP,
    );
    const entries = await readdir(dirname(path));
    assert.ok(entries.every((entry) => !entry.endsWith(".tmp")));
    // The quoted-jar dialect resolves to the same canonical pair (slice 2 contract).
    assert.deepEqual(resolveLinkedInCookies({ [ENV_NAMES.linkedinCookiesFile]: path }), {
      liAt: "AQE-live-li-at",
      jsessionId: "ajax:0123456789012345678",
      harvestedAt: STAMP,
    });
  });

  it("records the FR-0 stamp verbatim in the file", async () => {
    const path = await workPath("stamped.json");
    await writeCookieFile({ liAt: "AQE", jsessionid: '"ajax:1"' }, path, STAMP);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      liAt: "AQE",
      jsessionid: '"ajax:1"',
      harvestedAt: STAMP,
    });
  });
});

describe("runLoginHelper", () => {
  it("polls until the jar holds the session, then writes the cookie file and the .env line", async () => {
    const cookiePath = await workPath("helper-cookies.json");
    const dotEnvPath = await workPath("helper.env");
    let polls = 0;
    const sleeps: number[] = [];
    let closed = false;
    const context: LoginContext = {
      cookies: async () => {
        polls += 1;
        return polls >= 3 ? JAR : JAR.filter((cookie) => cookie.name !== "li_at");
      },
      close: async () => {
        closed = true;
      },
    };
    const result = await runLoginHelper({
      openContext: async () => context,
      cookiePath,
      dotEnvPath,
      env: {},
      pollMs: 2_000,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      now: () => Date.UTC(2026, 10, 10, 0, 0, 0),
    });
    assert.deepEqual(result, { cookiePath, dotEnvUpdated: true });
    assert.deepEqual(sleeps, [2_000, 2_000]); // two empty polls, then the harvest
    assert.equal(closed, true);
    assert.equal(
      await readFile(dotEnvPath, "utf8"),
      `${ENV_NAMES.linkedinCookiesFile}=${cookiePath}\n`,
    );
    // The stamp comes from the injected clock, never the ambient one.
    assert.deepEqual(resolveLinkedInCookies({ [ENV_NAMES.linkedinCookiesFile]: cookiePath }), {
      liAt: "AQE-live-li-at",
      jsessionId: "ajax:0123456789012345678",
      harvestedAt: STAMP,
    });
  });

  it("times out fail-visibly and still closes the context", async () => {
    const cookiePath = await workPath("timeout-cookies.json");
    const dotEnvPath = await workPath("timeout.env");
    let closed = false;
    const context: LoginContext = {
      cookies: async () => JAR.filter((cookie) => cookie.name !== "li_at"),
      close: async () => {
        closed = true;
      },
    };
    let tick = 0;
    await assert.rejects(
      () =>
        runLoginHelper({
          openContext: async () => context,
          cookiePath,
          dotEnvPath,
          env: {},
          pollMs: 1_000,
          timeoutMs: 5_000,
          sleepFn: async (ms) => {
            tick += ms; // the injected sleep advances the injected clock
          },
          now: () => tick,
        }),
      /no LinkedIn session appeared/,
    );
    assert.equal(closed, true);
  });
});

describe("entry guard", () => {
  it("importing the module stays side-effect free (no browser opens)", async () => {
    // The import above already ran the module top level: reaching this
    // test without a headed Chromium launch IS the pin (the guard kept
    // main off). runLoginHelper is the exported seam the tests drive.
    assert.equal(typeof runLoginHelper, "function");
  });
});

describe("runLoginHelper keep-open", () => {
  it("holds the browser open until Enter fires, then closes (Enter BEFORE close)", async () => {
    const cookiePath = await workPath("keepopen-cookies.json");
    const dotEnvPath = await workPath("keepopen.env");
    let closed = false;
    const context: LoginContext = {
      cookies: async () => JAR,
      close: async () => {
        closed = true;
      },
    };
    const result = await runLoginHelper({
      openContext: async () => context,
      cookiePath,
      dotEnvPath,
      env: {},
      keepOpen: true,
      enterWait: async () => {
        assert.equal(closed, false, "the browser must still be open while Enter is awaited");
      },
      now: () => Date.UTC(2026, 10, 10, 0, 0, 0),
    });
    assert.deepEqual(result, { cookiePath, dotEnvUpdated: true });
    assert.equal(closed, true);
  });
});

describe("runLoginHelper mandatory feed warm-up", () => {
  it("visits the feed via the context seam BEFORE close, harvest kept on write", async () => {
    const cookiePath = await workPath("feedwarm-cookies.json");
    const dotEnvPath = await workPath("feedwarm.env");
    const order: string[] = [];
    const context: LoginContext = {
      cookies: async () => JAR,
      gotoFeed: async () => {
        order.push("feed");
      },
      close: async () => {
        order.push("close");
      },
    };
    await runLoginHelper({
      openContext: async () => context,
      cookiePath,
      dotEnvPath,
      env: {},
      now: () => Date.UTC(2026, 10, 10, 0, 0, 0),
    });
    assert.deepEqual(order, ["feed", "close"]);
    assert.deepEqual(JSON.parse(await readFile(cookiePath, "utf8")), {
      liAt: "AQE-live-li-at",
      jsessionid: '"ajax:0123456789012345678"',
      harvestedAt: "2026-11-10T00:00:00.000Z",
    });
  });

  it("keeps the harvest when the feed warm-up fails (warn, never discard)", async () => {
    const cookiePath = await workPath("feedwarm-fail-cookies.json");
    const dotEnvPath = await workPath("feedwarm-fail.env");
    let closed = false;
    const context: LoginContext = {
      cookies: async () => JAR,
      gotoFeed: async () => {
        throw new Error("feed did not load");
      },
      close: async () => {
        closed = true;
      },
    };
    const result = await runLoginHelper({
      openContext: async () => context,
      cookiePath,
      dotEnvPath,
      env: {},
      now: () => Date.UTC(2026, 10, 10, 0, 0, 0),
    });
    assert.deepEqual(result, { cookiePath, dotEnvUpdated: true });
    assert.equal(closed, true);
    assert.ok(
      await readFile(cookiePath, "utf8").then(
        () => true,
        () => false,
      ),
    );
  });
});

describe("keepOpenForArgv (the --auto-close seam, Phase 5)", () => {
  it("defaults to keep-open when the flag is absent", () => {
    assert.equal(keepOpenForArgv(["node", "scripts/login-linkedin.ts"]), true);
  });

  it("--auto-close restores fire-and-close", () => {
    assert.equal(keepOpenForArgv(["node", "scripts/login-linkedin.ts", "--auto-close"]), false);
  });
});
