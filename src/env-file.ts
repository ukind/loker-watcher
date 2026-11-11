/**
 * .env auto-load for the PC-local scripts (Phase 7, operator feedback
 * 2026-11-05: least-manual setup). `npm run` does NOT read .env, so the
 * README's ".env" hint was dead without shell setup. This module reads
 * <cwd>/.env when present and merges it UNDER the real environment: a
 * variable already set in the shell always wins, .env fills ONLY unset
 * keys, and a missing .env is the quiet normal case. The fail-visible
 * doctrine stays with the resolvers: when a required variable is still
 * unset after the merge, they throw naming it. No dependency: KEY=VALUE
 * lines, # comments, blank lines; one pair of surrounding quotes on a
 * value is stripped; anything else warns once (file + line) and is
 * skipped.
 */
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The convenience file the PC scripts read beside the working directory. */
export const DOT_ENV_PATH = ".env";

/** Parse .env text: KEY=VALUE lines; # comments; blank lines; quoted values stripped. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      console.warn(`env-file: ${DOT_ENV_PATH} line ${i + 1} is not KEY=VALUE — skipped`);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/**
 * The merged environment for the PC scripts: <cwd>/.env (when present)
 * fills ONLY the keys `env` leaves unset — the real environment always
 * wins. A missing .env returns `env` untouched (the quiet normal); an
 * unreadable one warns and does the same, and the resolvers then fail
 * visibly naming the variables they still miss.
 */
export function envWithDotEnv(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Record<string, string | undefined> {
  let text: string;
  try {
    text = readFileSync(join(cwd, DOT_ENV_PATH), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== undefined && code !== "ENOENT") {
      console.warn(`env-file: ${DOT_ENV_PATH} is unreadable (${code}) — continuing without it`);
    }
    return env;
  }
  const merged: Record<string, string | undefined> = { ...env };
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

/**
 * Append or replace ONE KEY=VALUE line in the .env file; idempotent.
 * Returns true when the file changed. Values ride verbatim (the .env
 * parser in this module takes the whole rest of the line — no quote
 * games needed for paths with spaces).
 *
 * Hoisted here (Phase 9) from scripts/login-linkedin.ts VERBATIM:
 * env-file owns the whole .env contract, and scripts/login-linkedin.ts
 * imports the writer back from here.
 */
export async function upsertDotEnvLine(
  filePath: string,
  key: string,
  value: string,
): Promise<boolean> {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    // Absent .env: start from an empty document.
  }
  const line = `${key}=${value}`;
  const lines = text === "" ? [] : text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const index = lines.findIndex((candidate) => candidate.startsWith(`${key}=`));
  if (index >= 0 && lines[index] === line) return false;
  if (index >= 0) lines[index] = line;
  else lines.push(line);
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return true;
}
