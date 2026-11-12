/**
 * The LinkedIn operator chain (operator-chain design 2026-11-12): ONE
 * command runs the decided operator protocol in order —
 *
 *   login hold -> probe walk -> exactly one fetch tick
 *
 * Stage 1 opens the headed browser; the OPERATOR logs in by hand (2FA
 * included); the helper harvests the cookie file + the .env line, warms up
 * the feed, and holds until Enter — Enter closes the browser and releases
 * the profile lock. Stage 2 walks the first configured surface read-only
 * (the gate). Stage 3 runs exactly ONE fetch tick and stops — no loop; the
 * watch loop stays a separate manual start.
 *
 * The login harvest feeds the later legs: the harvested cookie path joins
 * the threaded env when the env lacks LINKEDIN_COOKIES_FILE (the first-ever
 * run — the .env line the helper writes mid-chain cannot appear in an env
 * resolved at chain start).
 *
 * Fail visible: every gate failure THROWS and the entry wrapper prints
 * linkedin-chain: FAILED — <gate and remedy>, exit 1. The tick quiet-zero
 * gates (working-hours window, halt latch, halt trip, all-faulted walk,
 * zero surfaces) are OUTCOMES, not failures (the defb8af rule): the chain
 * reports the no-op shape and exits 0.
 *
 * The wrapper MUST run in a real TTY: the login hold reads Enter from
 * stdin. A piped or agent-mediated run fails at stage 1 (the helper
 * readline rejects uncaught) — no TTY check is added here, by decision.
 *
 * Run from a DEDICATED clone of main with a committed tree:
 * npm run linkedin-chain (stage 3 guardCheckout enforces branch main +
 * a clean tree BEFORE any fetch — the chain CODE itself must be committed
 * first, or stage 3 names the dirty paths).
 *
 * Entry-guarded main (the four-script idiom): importing the module stays
 * side-effect free — no env read, no config load, no browser.
 */
import { pathToFileURL } from "node:url";
import { ENV_NAMES } from "../src/config.js";
import { envWithDotEnv } from "../src/env-file.js";
import { type FetchTickResult, fetchTick } from "./fetch-linkedin.js";
import { type LoginHelperResult, runLoginHelper } from "./login-linkedin.js";
import { type ProbeResult, runProbe } from "./probe-linkedin.js";

/** The merged-env shape every PC-local leg already takes. */
type Env = Record<string, string | undefined>;

/** Injectables for the offline suite; production defaults run the real legs. */
export interface ChainDeps {
  /** Environment for all three legs, resolved ONCE. Default: envWithDotEnv(). */
  env?: Env;
  /** Stage 1. Default: runLoginHelper({ env, keepOpen: true }) — hold until Enter. */
  login?: (env: Env) => Promise<LoginHelperResult>;
  /** Stage 2. Default: runProbe({ env }). */
  probe?: (env: Env) => Promise<ProbeResult>;
  /** Stage 3 — called at most once. Default: fetchTick({ env }). */
  tick?: (env: Env) => Promise<FetchTickResult>;
  /** Clock for the total-duration report. Default: Date.now. */
  now?: () => number;
}

/** What one chain run reports: each stage outcome, in call order. */
export interface ChainResult {
  /** Stage 1 — the harvest: cookie file written, .env line state. */
  login: LoginHelperResult;
  /** Stage 2 — the gate: post count + elapsed wall clock on a pass. */
  probe: ProbeResult;
  /** Stage 3 — the single tick outcome object. */
  tick: FetchTickResult;
  /** True when the tick landed on a quiet-zero gate — an outcome, never a failure. */
  tickNoop: boolean;
  /** Total wall clock across the three stages. */
  totalMs: number;
}

/**
 * Run the chain: the login hold, the probe gate, exactly one tick — in
 * that order, aborting on the first throw. The merged env resolves ONCE
 * (D2) and threads into all three legs; the harvested cookie path joins it
 * for stages 2-3 when the env lacks LINKEDIN_COOKIES_FILE (the first-ever
 * run: the helper writes the .env line mid-chain, and an env resolved at
 * start cannot see it).
 */
export async function runLinkedInChain(deps: ChainDeps = {}): Promise<ChainResult> {
  const env = deps.env ?? envWithDotEnv();
  const login = deps.login ?? ((legEnv: Env) => runLoginHelper({ env: legEnv, keepOpen: true }));
  const probe = deps.probe ?? ((legEnv: Env) => runProbe({ env: legEnv }));
  const tick = deps.tick ?? ((legEnv: Env) => fetchTick({ env: legEnv }));
  const now = deps.now ?? Date.now;
  const started = now();

  console.log(
    "linkedin-chain: stage 1/3 login — log in by hand in the opened window, press Enter HERE when done",
  );
  const loginResult = await login(env);
  // The harvest feeds the gate + the tick: the output cookie path of stage 1 is
  // authoritative (the helper just wrote that file), so it rides forward instead
  // of a second envWithDotEnv read.
  const cookiePath = loginResult.cookiePath;
  // Blank counts as unset (the helper and the resolver both trim): a
  // LINKEDIN_COOKIES_FILE= (empty) .env line must not block the forwarding.
  const legEnv: Env =
    (env[ENV_NAMES.linkedinCookiesFile] ?? "").trim() === "" && cookiePath !== ""
      ? { ...env, [ENV_NAMES.linkedinCookiesFile]: cookiePath }
      : env;

  console.log("linkedin-chain: stage 2/3 probe — read-only walk of the first configured surface");
  const probeResult = await probe(legEnv);

  console.log("linkedin-chain: stage 3/3 tick — exactly one fetch tick, then stop");
  const tickResult = await tick(legEnv);

  // Quiet-zero classification reads the RESULT, not an exit code (D3): five
  // gates return the identical {wrote:false, pushed:false, postCount:0} — the
  // tick itself already logged which gate held, so the chain reports the
  // no-op shape. A written payload (even 0 posts) is an outcome, not a noop.
  const tickNoop = !tickResult.wrote && !tickResult.pushed && tickResult.postCount === 0;
  if (tickNoop) {
    console.log(
      "linkedin-chain: tick no-op — a quiet gate held, nothing written or pushed (exit stays 0)",
    );
  }
  const totalMs = now() - started;
  console.log(
    `linkedin-chain: done — probe ${probeResult.postCount} post(s), tick ${
      tickNoop ? "no-op" : `wrote ${tickResult.postCount} post(s)`
    }, ${totalMs}ms total`,
  );
  return { login: loginResult, probe: probeResult, tick: tickResult, tickNoop, totalMs };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The catch-all wrapper owns the exit: domain gates throw and this arm
  // prints the failure with its gate name. Tagged errors (halt, leg-dead)
  // carry the human reason on .reason — surface it so the operator never
  // needs the tag vocabulary.
  runLinkedInChain().catch((error: unknown) => {
    const base = error instanceof Error ? error.message : String(error);
    const reason = (error as { reason?: unknown }).reason;
    const detail =
      typeof reason === "string" && reason !== "" && !base.includes(reason) ? ` — ${reason}` : "";
    console.error(`linkedin-chain: FAILED — ${base}${detail}`);
    process.exit(1);
  });
}
