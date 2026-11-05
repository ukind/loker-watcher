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

describe("writeCookieFile", () => {
  it("writes the canonical JSON atomically and the session resolver reads it back", async () => {
    const path = await workPath("cookies.json");
    await writeCookieFile(
      { liAt: "AQE-live-li-at", jsessionid: '"ajax:0123456789012345678"' },
      path,
    );
    const entries = await readdir(dirname(path));
    assert.ok(entries.every((entry) => !entry.endsWith(".tmp")));
    // The quoted-jar dialect resolves to the same canonical pair (slice 2 contract).
    assert.deepEqual(resolveLinkedInCookies({ [ENV_NAMES.linkedinCookiesFile]: path }), {
      liAt: "AQE-live-li-at",
      jsessionId: "ajax:0123456789012345678",
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
    });
    assert.deepEqual(result, { cookiePath, dotEnvUpdated: true });
    assert.deepEqual(sleeps, [2_000, 2_000]); // two empty polls, then the harvest
    assert.equal(closed, true);
    assert.equal(
      await readFile(dotEnvPath, "utf8"),
      `${ENV_NAMES.linkedinCookiesFile}=${cookiePath}\n`,
    );
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
