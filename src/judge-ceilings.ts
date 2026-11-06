/**
 * Probe-measured per-account judge ceilings: the flat {baseUrl: ceiling}
 * map the probe job commits to state/judge-ceilings.json, resolved into
 * the index-keyed ceilings the rotation state enforces.
 *
 * Reader doctrine — a fourth kind between loadState (ENOENT-only degrade)
 * and readPayloadPosts (degrade-everything): a COMMITTED measured-data
 * file whose absence or corruption must never fail a run. Every account
 * without a usable entry is floored at ceiling 1 with exactly one warning
 * naming its baseUrl; the judged output is unchanged. Pool entries that
 * share one baseUrl share one ceiling silently — warnings are for missing
 * data, not for endpoint identity. File keys are trimmed before matching
 * because parseLlmAccounts trims baseUrl (src/judge.ts:163-172) and a
 * stray-space key must not silently miss into the default.
 *
 * The writer lives here (not in scripts/) so the write path is
 * unit-testable: the probe script has no test suite, and this module is
 * its only automated coverage (the writeStateAtomic precedent).
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { JUDGE_CEILINGS_PATH } from "./config.js";
import type { LlmAccount } from "./judge.js";
import { stateTempPath } from "./state.js";

/** The committed file shape: trimmed baseUrl -> positive integer ceiling. */
export type CeilingsFile = Record<string, number>;

/** Result of the pure resolver: index-keyed ceilings plus the warnings. */
export interface ResolvedCeilings {
  ceilings: Map<number, number>;
  warnings: readonly string[];
}

/** One ceiling a value must pass to be usable: a positive integer. */
function usableCeiling(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

/**
 * Resolve the index-keyed ceiling map for one account pool from the parsed
 * ceilings file (undefined when the file is absent, unreadable, or not a
 * JSON object). Never throws: every failure mode degrades to ceiling 1
 * plus a warning. Pure — warnings are RETURNED, not printed, so the
 * acceptance test asserts the array and the wrapper owns the console.
 */
export function resolveCeilings(
  accounts: readonly LlmAccount[],
  parsed: CeilingsFile | undefined,
): ResolvedCeilings {
  const byKey = new Map<string, number>();
  if (parsed !== undefined) {
    for (const [key, value] of Object.entries(parsed)) {
      const usable = usableCeiling(value);
      if (usable !== undefined) byKey.set(key.trim(), usable);
    }
  }
  const ceilings = new Map<number, number>();
  const warnings: string[] = [];
  for (const [index, account] of accounts.entries()) {
    const key = account.baseUrl.trim();
    const ceiling = byKey.get(key);
    if (ceiling === undefined) {
      ceilings.set(index, 1);
      warnings.push(
        `judge: no usable ceiling for ${key} — capping at 1 (slow waves until the probe commits ${JUDGE_CEILINGS_PATH})`,
      );
    } else {
      ceilings.set(index, ceiling);
    }
  }
  return { ceilings, warnings };
}

/**
 * Read + resolve the ceilings file for one account pool. Never throws
 * (the degrade doctrine): an absent file is the normal first-run state
 * and floors every account at ceiling 1; an unreadable or non-object file
 * warns with the reason and does the same. Prints each resolveCeilings
 * warning once (they already carry the judge: prefix).
 */
export async function loadAccountCeilings(
  accounts: readonly LlmAccount[],
  filePath: string = JUDGE_CEILINGS_PATH,
): Promise<Map<number, number>> {
  let parsed: CeilingsFile | undefined;
  try {
    const json: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      console.warn(`judge: ${filePath} is not a JSON object — treating as absent`);
    } else {
      parsed = json as CeilingsFile;
    }
  } catch (error) {
    const isEnoent =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT";
    if (!isEnoent) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`judge: ${filePath} unreadable (${message}) — treating as absent`);
    }
    parsed = undefined;
  }
  const { ceilings, warnings } = resolveCeilings(accounts, parsed);
  for (const warning of warnings) {
    console.warn(warning);
  }
  return ceilings;
}

/**
 * Write the ceilings map atomically (sibling unique temp + rename, the
 * writeStateAtomic shape): a crashed probe never leaves a partial file.
 * The probe job is the only writer (single-writer doctrine, the
 * JUDGE_CEILINGS_PATH doc-comment in src/config.ts).
 */
export async function writeCeilingsAtomic(
  entries: CeilingsFile,
  filePath: string = JUDGE_CEILINGS_PATH,
  now: () => number = Date.now,
): Promise<void> {
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, now());
  const jsonContent = `${JSON.stringify(entries, null, 2)}\n`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, jsonContent, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup of temp file
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ceilings: atomic write failed for ${filePath}: ${message}`);
  }
}
