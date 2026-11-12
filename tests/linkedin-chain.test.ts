/**
 * Offline suite for the operator chain (operator-chain design 2026-11-12,
 * Slice 3): the recording-legs transcript IS the oracle. Pins the order
 * (login -> probe -> EXACTLY one tick, then stop), the abort arms (a login
 * or probe throw never reaches the next stage and propagates untouched —
 * the entry wrapper owns the exit), the D2 cookie-path forwarding (the
 * harvested path joins the threaded env ONLY when the env lacks
 * LINKEDIN_COOKIES_FILE — the first-ever run; the caller's env object is
 * never mutated), and the D3 outcome rule (a quiet-zero tick is a reported
 * no-op with the chain still resolving; a written payload — even 0 posts —
 * is an outcome, never a noop).
 *
 * Zero browser, zero git, zero network, zero ambient env: every leg is an
 * injected recording double, the clock is pinned, and the env literal
 * starts empty.
 *
 * Importing scripts/linkedin-chain.ts in this file IS the entry-guard
 * pin: the module reads no env and loads no config at its top level, so
 * reaching this suite proves main stayed off.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FetchTickResult } from "../scripts/fetch-linkedin.js";
import { type ChainDeps, type ChainResult, runLinkedInChain } from "../scripts/linkedin-chain.js";
import type { LoginHelperResult } from "../scripts/login-linkedin.js";
import type { ProbeResult } from "../scripts/probe-linkedin.js";
import { ENV_NAMES } from "../src/config.js";

type Env = Record<string, string | undefined>;

const T0 = Date.UTC(2026, 11, 12, 9, 14, 0);

const HARVEST: LoginHelperResult = {
  cookiePath: "C:/loker-secrets/chain-cookies.json",
  dotEnvUpdated: true,
};
const PROBE_PASS: ProbeResult = { postCount: 12, elapsedMs: 41_000 };
const TICK_WROTE: FetchTickResult = { wrote: true, pushed: true, postCount: 7 };

/** Everything the assertions read back from the injected legs. */
interface Recording {
  order: string[];
  loginEnvs: Env[];
  probeEnvs: Env[];
  tickEnvs: Env[];
  tickCalls: number;
}

/**
 * Recording legs with per-leg overrides: every leg records FIRST, then
 * delegates (an override that throws still lands in the transcript, so
 * the abort arms can pin exactly how far the chain got).
 */
function recordingLegs(options: {
  login?: (env: Env) => Promise<LoginHelperResult>;
  probe?: (env: Env) => Promise<ProbeResult>;
  tick?: (env: Env) => Promise<FetchTickResult>;
}): { legs: ChainDeps; recording: Recording } {
  const recording: Recording = {
    order: [],
    loginEnvs: [],
    probeEnvs: [],
    tickEnvs: [],
    tickCalls: 0,
  };
  const login = async (env: Env): Promise<LoginHelperResult> => {
    recording.order.push("login");
    recording.loginEnvs.push(env);
    return options.login !== undefined ? options.login(env) : HARVEST;
  };
  const probe = async (env: Env): Promise<ProbeResult> => {
    recording.order.push("probe");
    recording.probeEnvs.push(env);
    return options.probe !== undefined ? options.probe(env) : PROBE_PASS;
  };
  const tick = async (env: Env): Promise<FetchTickResult> => {
    recording.order.push("tick");
    recording.tickCalls += 1;
    recording.tickEnvs.push(env);
    return options.tick !== undefined ? options.tick(env) : TICK_WROTE;
  };
  return { legs: { login, probe, tick }, recording };
}

describe("entry guard", () => {
  it("importing the module runs no leg — no env read, no config load, no browser", async () => {
    // The import above already ran the module top level: reaching this
    // test with nothing else having fired IS the pin (the four-script idiom).
    assert.equal(typeof runLinkedInChain, "function");
  });
});

describe("runLinkedInChain order and result", () => {
  it("runs login -> probe -> EXACTLY one tick, then stops — the transcript is the oracle", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const { legs, recording } = recordingLegs({});
    await runLinkedInChain({ ...legs, env: {}, now: () => T0 });
    assert.deepEqual(recording.order, ["login", "probe", "tick"]);
    assert.equal(recording.tickCalls, 1); // one tick, then stop — no loop
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.some((line) => /stage 1\/3 login /.test(line)));
    assert.ok(lines.some((line) => /stage 2\/3 probe /.test(line)));
    assert.ok(lines.some((line) => /stage 3\/3 tick /.test(line)));
    assert.ok(
      lines.some((line) =>
        /done — probe 12 post\(s\), tick wrote 7 post\(s\), 0ms total/.test(line),
      ),
    );
  });

  it("resolves the full ChainResult — every stage outcome, tickNoop=false on a written tick", async () => {
    // The stepped clock brackets the whole chain: two reads, started + total.
    const clock = [T0, T0 + 750];
    const result: ChainResult = await runLinkedInChain({
      ...recordingLegs({}).legs,
      env: {},
      now: () => clock.shift() ?? T0 + 750,
    });
    assert.deepEqual(result, {
      login: HARVEST,
      probe: PROBE_PASS,
      tick: TICK_WROTE,
      tickNoop: false,
      totalMs: 750,
    });
  });
});

describe("the D2 cookie-path forwarding", () => {
  it("joins the harvested cookie path for stages 2-3 when the env lacks LINKEDIN_COOKIES_FILE (the first-ever run)", async () => {
    const { legs, recording } = recordingLegs({});
    const env: Env = { OTHER_TEST_VAR: "untouched" };
    await runLinkedInChain({ ...legs, env, now: () => T0 });
    assert.equal(recording.loginEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], undefined); // stage 1 runs on the bare env
    assert.equal(recording.probeEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], HARVEST.cookiePath); // the harvest feeds the gate
    assert.equal(recording.tickEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], HARVEST.cookiePath); // ...and the tick
    assert.equal(recording.probeEnvs[0]?.OTHER_TEST_VAR, "untouched"); // forwarding spreads, never replaces
    assert.equal(env[ENV_NAMES.linkedinCookiesFile], undefined); // the caller's env object was never mutated
  });

  it("leaves the env untouched when it already carries LINKEDIN_COOKIES_FILE — the operator's line wins", async () => {
    const { legs, recording } = recordingLegs({});
    const env: Env = { [ENV_NAMES.linkedinCookiesFile]: "C:/loker-secrets/live.json" };
    await runLinkedInChain({ ...legs, env, now: () => T0 });
    for (const captured of [...recording.probeEnvs, ...recording.tickEnvs]) {
      assert.equal(captured[ENV_NAMES.linkedinCookiesFile], "C:/loker-secrets/live.json");
    }
    assert.equal(
      recording.loginEnvs[0]?.[ENV_NAMES.linkedinCookiesFile],
      "C:/loker-secrets/live.json",
    );
  });

  it("keeps the env bare when the login result carries an empty cookiePath", async () => {
    const { legs, recording } = recordingLegs({
      login: async () => ({ cookiePath: "", dotEnvUpdated: false }),
    });
    await runLinkedInChain({ ...legs, env: {}, now: () => T0 });
    assert.equal(recording.probeEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], undefined);
    assert.equal(recording.tickEnvs[0]?.[ENV_NAMES.linkedinCookiesFile], undefined);
  });
});

describe("failure arms", () => {
  it("aborts before the probe when the login leg throws — its error propagates untouched", async () => {
    const boom = new Error("login-linkedin: no LinkedIn session appeared within 5 min");
    const { legs, recording } = recordingLegs({
      login: async () => {
        throw boom;
      },
    });
    await assert.rejects(
      () => runLinkedInChain({ ...legs, env: {}, now: () => T0 }),
      (error: unknown) => error === boom,
    );
    assert.deepEqual(recording.order, ["login"]); // probe and tick never ran
  });

  it("aborts before the tick when the probe gate throws — the probe's error propagates untouched", async () => {
    const floor = new Error("probe: fewer than 10 posts — pagination did not prove out");
    const { legs, recording } = recordingLegs({
      probe: async () => {
        throw floor;
      },
    });
    await assert.rejects(
      () => runLinkedInChain({ ...legs, env: {}, now: () => T0 }),
      (error: unknown) => error === floor,
    );
    assert.deepEqual(recording.order, ["login", "probe"]); // the tick never ran
    assert.equal(recording.tickCalls, 0);
  });

  it("propagates a tick failure to the caller (the entry wrapper owns the exit)", async () => {
    const dead = new Error("fetch-linkedin: LEG DEAD — HTTP 401");
    const { legs } = recordingLegs({
      tick: async () => {
        throw dead;
      },
    });
    await assert.rejects(
      () => runLinkedInChain({ ...legs, env: {}, now: () => T0 }),
      (error: unknown) => error === dead,
    );
  });
});

describe("tick outcome classification (D3)", () => {
  it("reports a quiet-zero tick as a no-op — an outcome, never a failure", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const { legs } = recordingLegs({
      tick: async () => ({ wrote: false, pushed: false, postCount: 0 }),
    });
    const result = await runLinkedInChain({ ...legs, env: {}, now: () => T0 });
    assert.equal(result.tickNoop, true);
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.some((line) => /tick no-op — a quiet gate held/.test(line)));
    assert.ok(lines.some((line) => /done — probe 12 post\(s\), tick no-op,/.test(line)));
  });

  it("counts a written payload as an outcome even at 0 posts — tickNoop stays false", async () => {
    const { legs } = recordingLegs({
      tick: async () => ({ wrote: true, pushed: true, postCount: 0 }),
    });
    const result = await runLinkedInChain({ ...legs, env: {}, now: () => T0 });
    assert.equal(result.tickNoop, false);
  });
});
