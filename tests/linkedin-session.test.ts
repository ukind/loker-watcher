/**
 * Offline suite for the cookie-file session module (slice 2).
 *
 * Pins the D4 fail-visible resolver matrix (every rejection message names
 * LINKEDIN_COOKIES_FILE), the §3/§10 quote asymmetry (the Cookie header
 * keeps JSESSIONID quoted and last; the csrf-token value carries the
 * quotes stripped), and the storageState synthesis for the slice-3
 * Playwright adapter. Cookie files are written to OS temp only.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ENV_NAMES } from "../src/config.js";
import {
  buildCookieHeader,
  csrfToken,
  resolveLinkedInCookies,
  toStorageState,
} from "../src/linkedin-session.js";

const ENV_NAME = ENV_NAMES.linkedinCookiesFile;

let dir: string | undefined;
let fileSeq = 0;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

/** Write one cookie file into the suite's OS-temp dir; returns its path. */
async function cookieFile(content: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-linkedin-cookies-"));
  fileSeq += 1;
  const path = join(dir, `cookies-${fileSeq}.json`);
  await writeFile(path, content, "utf8");
  return path;
}

function envFor(path: string): Record<string, string | undefined> {
  return { [ENV_NAME]: path };
}

const PAIR = JSON.stringify({ liAt: "AQE-test-li-at", jsessionid: "ajax:0123456789012345678" });

describe("resolveLinkedInCookies", () => {
  it("throws naming the variable when it is unset", () => {
    assert.throws(() => resolveLinkedInCookies({}), /LINKEDIN_COOKIES_FILE is not set/);
  });

  it("throws naming the variable when it is blank", () => {
    assert.throws(() => resolveLinkedInCookies({ [ENV_NAME]: "   " }), /is not set/);
  });

  it("throws when the file does not exist", () => {
    const missing = join(tmpdir(), "lw-linkedin-cookies-absent", "nope.json");
    assert.throws(
      () => resolveLinkedInCookies(envFor(missing)),
      /LINKEDIN_COOKIES_FILE points at .*nope\.json, which does not exist/,
    );
  });

  it("throws when the file is not valid JSON", async () => {
    const path = await cookieFile("{not json");
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /which is not valid JSON/);
  });

  it("throws when the JSON is not an object", async () => {
    const path = await cookieFile("[1,2]");
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /which is not a JSON object/);
  });

  it("throws when liAt is missing or empty", async () => {
    const missing = await cookieFile(JSON.stringify({ jsessionid: "ajax:123" }));
    const empty = await cookieFile(JSON.stringify({ liAt: "  ", jsessionid: "ajax:123" }));
    assert.throws(() => resolveLinkedInCookies(envFor(missing)), /no usable "liAt"/);
    assert.throws(() => resolveLinkedInCookies(envFor(empty)), /no usable "liAt"/);
  });

  it("throws when jsessionid is missing or empty", async () => {
    const missing = await cookieFile(JSON.stringify({ liAt: "AQE" }));
    const empty = await cookieFile(JSON.stringify({ liAt: "AQE", jsessionid: "" }));
    assert.throws(() => resolveLinkedInCookies(envFor(missing)), /no usable "jsessionid"/);
    assert.throws(() => resolveLinkedInCookies(envFor(empty)), /no usable "jsessionid"/);
  });

  it("throws when jsessionid is only one quote pair (empty after stripping)", async () => {
    const path = await cookieFile(JSON.stringify({ liAt: "AQE", jsessionid: '""' }));
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /no usable "jsessionid"/);
  });

  it("names the variable in every rejection message", async () => {
    const badJson = await cookieFile("{nope");
    const badField = await cookieFile(JSON.stringify({ liAt: "", jsessionid: "ajax:1" }));
    const cases: Record<string, string | undefined>[] = [
      {},
      { [ENV_NAME]: "   " },
      envFor(join(tmpdir(), "lw-linkedin-cookies-absent-2", "nope.json")),
      envFor(badJson),
      envFor(badField),
    ];
    for (const env of cases) {
      assert.throws(
        () => resolveLinkedInCookies(env),
        (error: unknown) => {
          assert.match((error as Error).message, new RegExp(`^linkedin-cookies: ${ENV_NAME}`));
          return true;
        },
      );
    }
  });

  it("resolves the pair from an unquoted jsessionid export", async () => {
    const path = await cookieFile(PAIR);
    assert.deepEqual(resolveLinkedInCookies(envFor(path)), {
      liAt: "AQE-test-li-at",
      jsessionId: "ajax:0123456789012345678",
    });
  });

  it("resolves the same canonical pair from a quoted jsessionid export", async () => {
    const path = await cookieFile(
      JSON.stringify({ liAt: "AQE-test-li-at", jsessionid: '"ajax:0123456789012345678"' }),
    );
    assert.deepEqual(resolveLinkedInCookies(envFor(path)), {
      liAt: "AQE-test-li-at",
      jsessionId: "ajax:0123456789012345678",
    });
  });

  it("throws when jsessionid carries quotes beyond one surrounding pair", async () => {
    const path = await cookieFile(JSON.stringify({ liAt: "AQE", jsessionid: '"aj"ax:123"' }));
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /stray quotes inside "jsessionid"/);
  });

  it("throws when liAt carries quotes", async () => {
    const path = await cookieFile(JSON.stringify({ liAt: 'AQ"E', jsessionid: "ajax:1" }));
    assert.throws(() => resolveLinkedInCookies(envFor(path)), /quote inside "liAt"/);
  });
});

describe("buildCookieHeader", () => {
  const cookies = { liAt: "AQE-test-li-at", jsessionId: "ajax:0123456789012345678" };

  it("rides li_at first unquoted and JSESSIONID last quoted (§10 template, §14.5 ordering)", () => {
    assert.equal(
      buildCookieHeader(cookies),
      'li_at=AQE-test-li-at; JSESSIONID="ajax:0123456789012345678"',
    );
  });
});

describe("csrfToken", () => {
  it("returns the jsessionid with quotes stripped (§3 header value)", () => {
    assert.equal(csrfToken({ liAt: "A", jsessionId: "ajax:123" }), "ajax:123");
  });
});

describe("toStorageState", () => {
  const cookies = { liAt: "AQE-test-li-at", jsessionId: "ajax:0123456789012345678" };

  it("synthesizes the .linkedin.com pair with the quoted JSESSIONID value", () => {
    const state = toStorageState(cookies);
    assert.equal(state.cookies.length, 2);
    const [liAtCookie, jsessionidCookie] = state.cookies;
    assert.deepEqual(liAtCookie, {
      name: "li_at",
      value: "AQE-test-li-at",
      domain: ".linkedin.com",
      path: "/",
      secure: true,
    });
    assert.equal(jsessionidCookie?.name, "JSESSIONID");
    assert.equal(jsessionidCookie?.value, '"ajax:0123456789012345678"');
    assert.equal(jsessionidCookie?.domain, ".linkedin.com");
    assert.equal(jsessionidCookie?.secure, true);
  });

  it("carries no origins", () => {
    assert.deepEqual(toStorageState(cookies).origins, []);
  });
});
