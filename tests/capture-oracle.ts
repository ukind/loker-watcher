/**
 * The capture doctrine's shared absence-oracle (F015, 2026-11-15): one
 * snapshot + one assert for the three walk-driving suites. The snapshot
 * is taken at module load, before any test runs; each suite calls
 * assertNoFreshCaptures() from its after(). A FRESH captures/ directory
 * at the repo root means a body-firing case skipped its sink injection —
 * the failure names every leaked session dir and its files, so the
 * leaking case is identifiable from the message alone. A directory that
 * already existed (a live operator run) is not the suites' problem: the
 * assert stays silent.
 *
 * Replaces the three hand-rolled copies whose ENOENT assert skipped
 * forever once captures/ existed — the disarm that hid F001's leak.
 */
import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoCaptures = join(dirname(fileURLToPath(import.meta.url)), "..", "captures");
const repoCapturesBefore = await access(repoCaptures).then(
  () => true,
  () => false,
);

/**
 * Fail the suite when a FRESH repo-root captures/ tree appeared. Silent
 * when captures/ pre-dated the run (the operator-run carve-out, verbatim
 * from the three oracles this helper replaces).
 */
export async function assertNoFreshCaptures(): Promise<void> {
  if (repoCapturesBefore) return;
  const fresh = await access(repoCaptures).then(
    () => true,
    () => false,
  );
  if (!fresh) return;
  const sessions = await readdir(repoCaptures);
  const report: string[] = [];
  for (const session of sessions) {
    const files = await readdir(join(repoCaptures, session));
    report.push(`captures/${session}/ (${files.length} file(s): ${files.join(", ")})`);
  }
  assert.fail(
    `capture oracle: npm test wrote into the repo — a fresh captures/ appeared with ${report.length} session dir(s):\n  ${report.join("\n  ")}`,
  );
}
