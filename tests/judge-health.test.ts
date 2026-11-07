import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type AccountTickOutcome,
  type HealthFile,
  type OutcomeLedgerState,
  buildDegradedAccountsLine,
  buildFailuresFromLedger,
  episodeAlarmDue,
  flushExhaustionHealth,
  flushHealthIfChanged,
  flushTickHealth,
  loadAccountHealth,
  nextHealthFile,
  readTickOutcomes,
  resolveAccountHealth,
  stampFailure,
  stampSuccess,
  writeHealthAtomic,
} from "../src/judge-health.js";
import type { LlmAccount } from "../src/judge.js";

/** Two accounts with distinct hosts — the capped/streak cases need both. */
const ACCOUNTS: LlmAccount[] = [
  { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
  { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
];

/** Envelope builder: marks keyed by trimmed baseUrl, episode bit explicit. */
const file = (marks: Record<string, number>, outageOpen = false): HealthFile => ({
  version: 1,
  marks,
  outageOpen,
});

describe("resolveAccountHealth", () => {
  it("maps each marked account's streak by index", () => {
    const marks = resolveAccountHealth(ACCOUNTS, file({ "https://account-one.api/v1": 2 }));
    assert.deepEqual([...marks.entries()], [[0, 2]]);
  });

  it("drops zero, fractional, and non-numeric entries silently (missing data is the good state)", () => {
    const parsed = {
      "https://account-one.api/v1": 0,
      "https://account-two.api/v1": 2.5,
    } as unknown as HealthFile;
    assert.deepEqual([...resolveAccountHealth(ACCOUNTS, parsed).entries()], []);
  });

  it("drops a non-numeric entry", () => {
    const parsed = {
      "https://account-one.api/v1": "2",
    } as unknown as HealthFile;
    assert.deepEqual([...resolveAccountHealth(ACCOUNTS, parsed).entries()], []);
  });

  it("matches keys after trimming on both sides", () => {
    const marks = resolveAccountHealth(ACCOUNTS, file({ " https://account-one.api/v1 ": 2 }));
    assert.deepEqual([...marks.entries()], [[0, 2]]);
  });

  it("treats an undefined file as an empty map", () => {
    assert.deepEqual([...resolveAccountHealth(ACCOUNTS, undefined).entries()], []);
  });

  it("gives twin accounts sharing one baseUrl the same streak silently", () => {
    const twins: LlmAccount[] = [
      { baseUrl: "https://twin.api/v1", apiKey: "key-a", model: "model-a" },
      { baseUrl: "https://twin.api/v1", apiKey: "key-b", model: "model-b" },
    ];
    const marks = resolveAccountHealth(twins, file({ "https://twin.api/v1": 2 }));
    assert.deepEqual(
      [...marks.entries()],
      [
        [0, 2],
        [1, 2],
      ],
    );
  });
});

describe("nextHealthFile (the pure tick merge)", () => {
  it("increments a hard-failed account's streak", () => {
    const next = nextHealthFile(
      ACCOUNTS,
      file({ "https://account-one.api/v1": 2 }),
      { ok: [], failed: new Map([[1, "HTTP 503"]]) },
      false,
    );
    assert.deepEqual(next.marks, {
      "https://account-one.api/v1": 2,
      "https://account-two.api/v1": 1,
    });
  });

  it("resets a success to absent", () => {
    const next = nextHealthFile(
      ACCOUNTS,
      file({ "https://account-one.api/v1": 2, "https://account-two.api/v1": 1 }),
      { ok: [0], failed: new Map() },
      false,
    );
    assert.deepEqual(next.marks, { "https://account-two.api/v1": 1 });
  });

  it("keeps accounts the tick did not touch", () => {
    const next = nextHealthFile(
      ACCOUNTS,
      file({ "https://account-one.api/v1": 2 }),
      { ok: [], failed: new Map() },
      false,
    );
    assert.deepEqual(next.marks, { "https://account-one.api/v1": 2 });
  });

  it("prunes marks for accounts no longer in the pool", () => {
    const stale = file({ "https://gone.api/v1": 3, "https://account-one.api/v1": 1 });
    const next = nextHealthFile(ACCOUNTS, stale, { ok: [], failed: new Map() }, false);
    assert.deepEqual(next.marks, { "https://account-one.api/v1": 1 });
  });

  it("carries the outage bit verbatim", () => {
    const next = nextHealthFile(ACCOUNTS, file({}, true), { ok: [0], failed: new Map() }, true);
    assert.equal(next.outageOpen, true);
    assert.equal(next.version, 1);
  });
});

describe("stampFailure / stampSuccess / readTickOutcomes (the in-run ledger)", () => {
  /** Fresh hand-built OutcomeLedgerState: account 1 capped and probe-spent. */
  const ledgerState = (): OutcomeLedgerState => ({
    accounts: ACCOUNTS,
    cooldownUntil: new Map(),
    healthMarks: new Map([[1, 2]]),
    probedThisTick: new Set([1]),
    outcomeLedger: new Map<number, AccountTickOutcome>(),
  });

  it("stampFailure records the real cause on the ledger", () => {
    const state = ledgerState();
    stampFailure(state, 0, "HTTP 503");
    assert.deepEqual(state.outcomeLedger.get(0), { kind: "hard-failed", reason: "HTTP 503" });
  });

  it("stampSuccess clears the ledger to ok, frees the probe slot, and lifts the in-run cap", () => {
    const state = ledgerState();
    stampSuccess(state, 1);
    assert.deepEqual(state.outcomeLedger.get(1), { kind: "ok" });
    assert.equal(state.probedThisTick.has(1), false);
    assert.equal(state.healthMarks.has(1), false);
  });

  it("readTickOutcomes: last outcome wins — failure then success reads ok", () => {
    const state = ledgerState();
    stampFailure(state, 0, "HTTP 503");
    stampSuccess(state, 0);
    const outcomes = readTickOutcomes(state);
    assert.deepEqual(outcomes.ok, [0]);
    assert.equal(outcomes.failed.size, 0);
  });

  it("readTickOutcomes: last outcome wins — success then failure reads the reason", () => {
    const state = ledgerState();
    stampSuccess(state, 1);
    stampFailure(state, 1, "network error: socket hung up");
    const outcomes = readTickOutcomes(state);
    assert.deepEqual(outcomes.ok, []);
    assert.deepEqual([...outcomes.failed.entries()], [[1, "network error: socket hung up"]]);
  });
});

describe("buildFailuresFromLedger (the unified exhaustion record)", () => {
  it("carries real causes in pool order with the cooling-only fallback", () => {
    const state: OutcomeLedgerState = {
      accounts: ACCOUNTS,
      cooldownUntil: new Map([[0, 1000]]),
      healthMarks: new Map(),
      probedThisTick: new Set(),
      outcomeLedger: new Map([[1, { kind: "hard-failed", reason: "HTTP 503" }]]),
    };
    assert.deepEqual(buildFailuresFromLedger(state), [
      { account: 1, baseUrl: "https://account-one.api/v1", reason: "HTTP 429" },
      { account: 2, baseUrl: "https://account-two.api/v1", reason: "HTTP 503" },
    ]);
  });

  it("an all-cooling pool still produces a non-empty record (the 429 pin)", () => {
    const state: OutcomeLedgerState = {
      accounts: ACCOUNTS,
      cooldownUntil: new Map([
        [0, 1000],
        [1, 2000],
      ]),
      healthMarks: new Map(),
      probedThisTick: new Set(),
      outcomeLedger: new Map(),
    };
    const failures = buildFailuresFromLedger(state);
    assert.equal(failures.length, 2);
    assert.ok(failures.every((failure) => failure.reason === "HTTP 429"));
  });

  it("an account with no entry stays out of the record", () => {
    const state: OutcomeLedgerState = {
      accounts: ACCOUNTS,
      cooldownUntil: new Map([[1, 1000]]),
      healthMarks: new Map(),
      probedThisTick: new Set(),
      outcomeLedger: new Map(),
    };
    assert.deepEqual(buildFailuresFromLedger(state), [
      { account: 2, baseUrl: "https://account-two.api/v1", reason: "HTTP 429" },
    ]);
  });
});

describe("buildDegradedAccountsLine", () => {
  it("is undefined when no account is capped", () => {
    assert.equal(buildDegradedAccountsLine(ACCOUNTS, new Map([[0, 1]])), undefined);
    assert.equal(buildDegradedAccountsLine(ACCOUNTS, new Map()), undefined);
  });

  it("lists capped accounts, 1-based, with their base URLs", () => {
    const line = buildDegradedAccountsLine(ACCOUNTS, new Map([[0, 2]]));
    assert.match(line ?? "", /#1 https:\/\/account-one\.api\/v1/);
    assert.equal((line ?? "").includes("account-two"), false);
  });

  it("lists a capped account at exactly the threshold", () => {
    const line = buildDegradedAccountsLine(ACCOUNTS, new Map([[1, 2]]));
    assert.match(line ?? "", /#2 https:\/\/account-two\.api\/v1/);
  });
});

describe("writeHealthAtomic + loadAccountHealth", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  /** Lazy temp dir, one per suite (tests/judge-ceilings.test.ts idiom). */
  const path = async (name: string): Promise<string> => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-judge-health-"));
    return join(dir, name);
  };

  it("round-trips: write then load resolves the committed marks and episode bit", async () => {
    const target = await path("round-trip.json");
    await writeHealthAtomic(file({ "https://account-one.api/v1": 2 }, true), target);
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.deepEqual([...read.marks.entries()], [[0, 2]]);
    assert.equal(read.file?.outageOpen, true);
  });

  it("an absent file reads quiet — no marks, no envelope, no warn", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const read = await loadAccountHealth(ACCOUNTS, await path("absent.json"));
    assert.equal(read.file, undefined);
    assert.deepEqual([...read.marks.entries()], []);
    assert.equal(warns.mock.calls.length, 0);
  });

  it("a malformed file degrades with a reason warning", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("malformed.json");
    await writeFile(target, "{not json", "utf8");
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.equal(read.file, undefined);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /unreadable/);
  });

  it("a non-object file (an array) degrades", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("array.json");
    await writeFile(target, "[1, 2]", "utf8");
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.equal(read.file, undefined);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /not a JSON object/);
  });

  it("an unknown version degrades naming the version", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("wrong-version.json");
    await writeFile(target, JSON.stringify({ version: 99, marks: {}, outageOpen: false }), "utf8");
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.equal(read.file, undefined);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /unknown version 99/);
  });

  it("a malformed marks object degrades", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("bad-marks.json");
    await writeFile(
      target,
      JSON.stringify({ version: 1, marks: [1, 2], outageOpen: false }),
      "utf8",
    );
    const read = await loadAccountHealth(ACCOUNTS, target);
    assert.equal(read.file, undefined);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /malformed marks/);
  });

  it("a failed write names the target", async () => {
    const blocker = await path("blocker");
    await writeFile(blocker, "occupies the directory slot", "utf8");
    await assert.rejects(
      () => writeHealthAtomic(file({}), join(blocker, "health.json")),
      (error: unknown) => {
        assert.match((error as Error).message, /^health: atomic write failed for /);
        return true;
      },
    );
  });
});

describe("flushHealthIfChanged (the byte-stability gate)", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  const path = async (name: string): Promise<string> => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-judge-health-gate-"));
    return join(dir, name);
  };

  it("skips the write when the next file is semantically identical", async () => {
    const target = await path("no-op.json");
    await writeHealthAtomic(file({ "https://account-one.api/v1": 2 }), target);
    const before = await readFile(target, "utf8");
    const wrote = await flushHealthIfChanged(file({ "https://account-one.api/v1": 2 }), target);
    assert.equal(wrote, false);
    assert.equal(await readFile(target, "utf8"), before);
  });

  it("writes when a mark changes", async () => {
    const target = await path("changed.json");
    await writeHealthAtomic(file({ "https://account-one.api/v1": 2 }), target);
    const wrote = await flushHealthIfChanged(file({ "https://account-one.api/v1": 3 }), target);
    assert.equal(wrote, true);
  });

  it("is order-insensitive: a different key insertion order with the same content writes nothing", async () => {
    const target = await path("key-order.json");
    await writeFile(
      target,
      `${JSON.stringify(
        { version: 1, outageOpen: false, marks: { "https://z.api/v1": 2, "https://a.api/v1": 1 } },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const wrote = await flushHealthIfChanged(
      file({ "https://a.api/v1": 1, "https://z.api/v1": 2 }),
      target,
    );
    assert.equal(wrote, false);
  });

  it("repairs a corrupted current file", async () => {
    const target = await path("corrupt.json");
    await writeFile(target, "{broken", "utf8");
    const wrote = await flushHealthIfChanged(file({}, false), target);
    assert.equal(wrote, true);
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.version, 1);
  });
});

describe("the episode lifecycle through the flush wrappers", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  const path = async (name: string): Promise<string> => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-judge-health-episode-"));
    return join(dir, name);
  };

  it("opens on the first exhaustion flush and records the streak", async () => {
    const target = await path("episode-1.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    assert.equal(stored.marks["https://account-one.api/v1"], 1);
  });

  it("stays open across later dead ticks while streaks grow (alarm quietness is index's job)", async () => {
    const target = await path("episode-2.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const base = (await loadAccountHealth(ACCOUNTS, target)).file;
    await flushExhaustionHealth(
      ACCOUNTS,
      base,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    assert.equal(stored.marks["https://account-one.api/v1"], 2);
  });

  it("clears on a run with a healthy dispatch and resets the streak", async () => {
    const target = await path("episode-3.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const base = (await loadAccountHealth(ACCOUNTS, target)).file;
    await flushTickHealth(ACCOUNTS, base, { ok: [0], failed: new Map() }, target);
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, false);
    assert.equal(stored.marks["https://account-one.api/v1"], undefined);
  });

  it("re-opens on the next outage", async () => {
    const target = await path("episode-4.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    await flushTickHealth(
      ACCOUNTS,
      (await loadAccountHealth(ACCOUNTS, target)).file,
      { ok: [0], failed: new Map() },
      target,
    );
    await flushExhaustionHealth(
      ACCOUNTS,
      (await loadAccountHealth(ACCOUNTS, target)).file,
      { ok: [], failed: new Map([[1, "network error: socket hung up"]]) },
      target,
    );
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
    assert.equal(stored.marks["https://account-two.api/v1"], 1);
  });

  it("stays open on a green run where nothing dispatched ok", async () => {
    const target = await path("episode-5.json");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map([[0, "HTTP 503"]]) },
      target,
    );
    const base = (await loadAccountHealth(ACCOUNTS, target)).file;
    await flushTickHealth(ACCOUNTS, base, { ok: [], failed: new Map() }, target);
    const stored = JSON.parse(await readFile(target, "utf8")) as HealthFile;
    assert.equal(stored.outageOpen, true);
  });

  it("a failed flush warns instead of throwing (best-effort)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const blocker = await path("flush-blocker");
    await writeFile(blocker, "occupies the directory slot", "utf8");
    await flushExhaustionHealth(
      ACCOUNTS,
      undefined,
      { ok: [], failed: new Map() },
      join(blocker, "health.json"),
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /flush failed/.test(line)));
  });

  it("a green no-op tick writes nothing at all", async () => {
    const target = await path("no-op-tick.json");
    await writeHealthAtomic(file({}, false), target);
    const before = await readFile(target, "utf8");
    await flushTickHealth(ACCOUNTS, file({}, false), { ok: [], failed: new Map() }, target);
    assert.equal(await readFile(target, "utf8"), before);
  });
});

describe("episodeAlarmDue (the one-alarm gate)", () => {
  it("is true when no file exists (absent, unreadable, first-ever run)", () => {
    assert.equal(episodeAlarmDue(undefined), true);
  });

  it("is true when the episode bit is closed", () => {
    assert.equal(episodeAlarmDue(file({}, false)), true);
  });

  it("is false when the episode bit is open — the alarm already fired", () => {
    assert.equal(episodeAlarmDue(file({}, true)), false);
  });
});
