import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type CeilingsFile,
  loadAccountCeilings,
  resolveCeilings,
  writeCeilingsAtomic,
} from "../src/judge-ceilings.js";
import type { LlmAccount } from "../src/judge.js";

/** Two accounts with distinct hosts — the missing-entry case needs one. */
const ACCOUNTS: LlmAccount[] = [
  { baseUrl: "https://account-one.api/v1", apiKey: "key-1", model: "model-1" },
  { baseUrl: "https://account-two.api/v1", apiKey: "key-2", model: "model-2" },
];

describe("resolveCeilings", () => {
  it("maps each account's committed ceiling by index", () => {
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, {
      "https://account-one.api/v1": 4,
      "https://account-two.api/v1": 2,
    });
    assert.deepEqual(
      [...ceilings.entries()],
      [
        [0, 4],
        [1, 2],
      ],
    );
    assert.deepEqual(warnings, []);
  });

  it("floors a missing account at ceiling 1 with exactly one warning naming the baseUrl", () => {
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, { "https://account-one.api/v1": 4 });
    assert.equal(ceilings.get(0), 4);
    assert.equal(ceilings.get(1), 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /account-two\.api/);
  });

  it("treats an undefined file as every account missing", () => {
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, undefined);
    assert.deepEqual(
      [...ceilings.entries()],
      [
        [0, 1],
        [1, 1],
      ],
    );
    assert.equal(warnings.length, 2);
  });

  it("treats zero, fractional, and non-numeric entries as missing", () => {
    const parsed = {
      "https://account-one.api/v1": 0,
      "https://account-two.api/v1": "4",
    } as unknown as CeilingsFile;
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, parsed);
    assert.deepEqual(
      [...ceilings.entries()],
      [
        [0, 1],
        [1, 1],
      ],
    );
    assert.equal(warnings.length, 2);
  });

  it("treats a fractional ceiling as missing", () => {
    const parsed = { "https://account-one.api/v1": 2.5 } as unknown as CeilingsFile;
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, parsed);
    assert.equal(ceilings.get(0), 1);
    assert.equal(warnings.length, 2); // account-one floors; account-two was never present
  });

  it("shares one ceiling silently across pool entries with the same baseUrl", () => {
    const twins: LlmAccount[] = [
      { baseUrl: "https://twin.api/v1", apiKey: "key-a", model: "model-a" },
      { baseUrl: "https://twin.api/v1", apiKey: "key-b", model: "model-b" },
    ];
    const { ceilings, warnings } = resolveCeilings(twins, { "https://twin.api/v1": 2 });
    assert.deepEqual(
      [...ceilings.entries()],
      [
        [0, 2],
        [1, 2],
      ],
    );
    assert.deepEqual(warnings, []);
  });

  it("matches keys after trimming on both sides", () => {
    const parsed = { " https://account-one.api/v1 ": 4 } as unknown as CeilingsFile;
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, parsed);
    assert.equal(ceilings.get(0), 4);
    assert.deepEqual(
      warnings.filter((warning) => warning.includes("account-one")),
      [],
    );
  });

  it("ignores the probedAt freshness key - only account keys resolve", () => {
    const parsed = {
      "https://account-one.api/v1": 8,
      "https://account-two.api/v1": 4,
      probedAt: 1730000000,
    };
    const { ceilings, warnings } = resolveCeilings(ACCOUNTS, parsed);
    assert.deepEqual(
      [...ceilings.entries()],
      [
        [0, 8],
        [1, 4],
      ],
    );
    assert.deepEqual(warnings, []);
  });
});

describe("writeCeilingsAtomic + loadAccountCeilings", () => {
  let dir: string | undefined;
  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  /** Lazy temp dir, one per suite (tests/state.test.ts idiom). */
  const path = async (name: string): Promise<string> => {
    dir ??= await mkdtemp(join(tmpdir(), "lw-judge-ceilings-"));
    return join(dir, name);
  };

  it("round-trips: write then load resolves the committed ceilings", async () => {
    const target = await path("round-trip.json");
    await writeCeilingsAtomic(
      { "https://account-one.api/v1": 4, "https://account-two.api/v1": 2 },
      target,
    );
    const stored = JSON.parse(await readFile(target, "utf8")) as CeilingsFile;
    assert.deepEqual(stored, {
      "https://account-one.api/v1": 4,
      "https://account-two.api/v1": 2,
    });
    assert.deepEqual(
      [...(await loadAccountCeilings(ACCOUNTS, target)).entries()],
      [
        [0, 4],
        [1, 2],
      ],
    );
  });

  it("an absent file floors every account at ceiling 1 — quiet, no reason warn", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const ceilings = await loadAccountCeilings(ACCOUNTS, await path("absent.json"));
    assert.deepEqual(
      [...ceilings.entries()],
      [
        [0, 1],
        [1, 1],
      ],
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.length, 2); // one floor warning per account, no file-reason line
    assert.match(lines[0] ?? "", /no usable ceiling for https:\/\/account-one\.api/);
  });

  it("a malformed file degrades to ceiling 1 with a reason warning", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("malformed.json");
    await writeFile(target, "{not json", "utf8");
    const ceilings = await loadAccountCeilings(ACCOUNTS, target);
    assert.deepEqual(
      [...ceilings.entries()],
      [
        [0, 1],
        [1, 1],
      ],
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.match(lines[0] ?? "", /unreadable/);
    assert.equal(lines.length, 3); // reason + one floor warning per account
  });

  it("a non-object file (an array) degrades to ceiling 1", async () => {
    const target = await path("array.json");
    await writeFile(target, "[1, 2]", "utf8");
    const ceilings = await loadAccountCeilings(ACCOUNTS, target);
    assert.deepEqual(
      [...ceilings.entries()],
      [
        [0, 1],
        [1, 1],
      ],
    );
  });

  it("prints exactly one warning per missing account when the file carries only some", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const target = await path("partial.json");
    await writeCeilingsAtomic({ "https://account-one.api/v1": 4 }, target);
    const ceilings = await loadAccountCeilings(ACCOUNTS, target);
    assert.equal(ceilings.get(0), 4);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    const floors = lines.filter((line) => line.includes("no usable ceiling"));
    assert.equal(floors.length, 1);
    assert.match(floors[0] ?? "", /account-two\.api/);
  });

  it("a failed write names the target", async () => {
    const blocker = await path("blocker");
    await writeFile(blocker, "occupies the directory slot", "utf8");
    await assert.rejects(
      () =>
        writeCeilingsAtomic({ "https://account-one.api/v1": 1 }, join(blocker, "ceilings.json")),
      (error: unknown) => {
        assert.match((error as Error).message, /^ceilings: atomic write failed for /);
        return true;
      },
    );
  });

  it("writeCeilingsAtomic round-trips a file that carries probedAt", async () => {
    const target = await path("ceilings-probed-at.json");
    await writeCeilingsAtomic({ "https://account-one.api/v1": 8, probedAt: 1730000000 }, target);
    const back = JSON.parse(await readFile(target, "utf8")) as Record<string, number>;
    assert.equal(back.probedAt, 1730000000);
    assert.equal(back["https://account-one.api/v1"], 8);
  });
});
