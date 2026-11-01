/**
 * Headed LinkedIn login — the operator escape hatch when CI's headless
 * credential login keeps hitting checkpoints (research: automated login is
 * the most-challenged LinkedIn pattern; ONE headed login from a residential
 * IP usually clears it).
 *
 * Usage:
 *   npx tsx scripts/linkedin-login.ts
 *
 * Credentials come from LINKEDIN_EMAIL + LINKEDIN_PASSWORD, or from a
 * readline prompt when either is unset (the password prompt echoes — run
 * it in a private window if that bothers you). The automated pass runs
 * first; when LinkedIn challenges it, the headed browser STAYS OPEN and
 * the script polls for li_at while you solve the CAPTCHA / OTP / device
 * check in it (up to 5 minutes). On success the fresh session lands
 * base64-encoded in the OS temp dir and the exact gh-secret-set command
 * is printed. The file is account-equivalent: never commit it, never
 * paste it anywhere but the secret.
 *
 * Exit codes: 0 on an exported session, 1 on a failure (no credentials,
 * challenge never solved, or no li_at cookie at the end).
 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { makeChromiumContextFactory } from "../src/fetch-threads.js";
import {
  type LoginOutcome,
  loginLinkedIn,
  loginPageFrom,
  looksAuthenticated,
} from "../src/linkedin-login.js";

/** How long the script waits for the operator to solve a challenge. */
const CHALLENGE_DEADLINE_MS = 5 * 60 * 1000;
const CHALLENGE_POLL_MS = 2_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const env = process.env;
let email = env.LINKEDIN_EMAIL ?? "";
let password = env.LINKEDIN_PASSWORD ?? "";

if (email === "" || password === "") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  if (email === "") email = (await rl.question("LinkedIn email: ")).trim();
  if (password === "") password = await rl.question("LinkedIn password (echoed): ");
  rl.close();
}
if (email === "" || password === "") {
  console.error("linkedin-login: empty email or password — nothing to attempt");
  process.exit(1);
}

console.log("linkedin-login: opening a headed browser — do not close it");
const contextFactory = makeChromiumContextFactory(false);
const context = await contextFactory();

let outcome: LoginOutcome = "challenge";
let exportedPath: string | null = null;
try {
  const page = await context.newPage();
  const readCookies = context.cookies;
  // The bridge validates the url seam once; loginPage.url() is the
  // required-shape accessor from here on.
  const loginPage = loginPageFrom(page);
  const pageUrl = (): string => loginPage.url();
  outcome = await loginLinkedIn(loginPage, email, password);
  if (outcome !== "ok") {
    // The automated pass was challenged. The headed browser stays open:
    // solve the challenge in it and the poll exports the session the
    // moment li_at exists.
    console.log(
      `linkedin-login: login ended with ${outcome} — solve the challenge in the browser; waiting up to 5 minutes`,
    );
    const startedAt = Date.now();
    while (readCookies !== undefined && Date.now() - startedAt < CHALLENGE_DEADLINE_MS) {
      const jar = await readCookies.call(context);
      if (looksAuthenticated(jar, pageUrl())) {
        outcome = "ok";
        break;
      }
      await sleep(CHALLENGE_POLL_MS);
    }
  }
  if (outcome === "ok") {
    // Belt and braces, mirroring src: a session without li_at cannot walk,
    // so "ok" without the cookie is a failure, not an export.
    if (readCookies === undefined) {
      throw new Error("context exposes no cookies — cannot export the session");
    }
    const jar = await readCookies.call(context);
    if (!looksAuthenticated(jar, pageUrl())) {
      throw new Error("no li_at cookie after login — session not usable");
    }
    exportedPath = join(tmpdir(), "linkedin-state.json.b64");
    const storageDocument = JSON.stringify({ cookies: jar, origins: [] });
    await writeFile(exportedPath, Buffer.from(storageDocument).toString("base64"));
  }
} catch (error) {
  // A navigation or browser fault (firewall block, no network) must exit
  // cleanly with the failure contract, not crash with a stack trace.
  const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
  console.error(`linkedin-login: failed — ${message}`);
  await context.close().catch(() => undefined);
  process.exit(1);
} finally {
  await context.close().catch(() => undefined);
}

if (exportedPath === null) {
  console.error(`linkedin-login: never authenticated (${outcome}) — no session exported`);
  process.exit(1);
}

console.log(`linkedin-login: session exported to ${exportedPath}`);
console.log("Set the secret with:");
console.log(`  gh secret set LINKEDIN_SESSION_STATE --body-file "${exportedPath}"`);
process.exit(0);
