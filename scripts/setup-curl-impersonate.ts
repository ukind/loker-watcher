/**
 * curl-impersonate one-command setup (Phase 9, operator feedback
 * 2026-11-05: the first live run died on the probe's fail-visible
 * `CURL_IMPERSONATE_BIN is not set` right after the login helper — the
 * goal stays the least manual setup). Downloads the checksum-pinned
 * lexiforest/curl-impersonate single binary, extracts it into
 * tools/curl-impersonate/ beside the clone, and writes the
 * CURL_IMPERSONATE_BIN line into <cwd>/.env — done.
 *
 * BINARY OF RECORD: the lexiforest fork's single `curl-impersonate`
 * binary, release v2.3.2 — the ONLY active distribution shipping Windows
 * builds (verified live 2026-11-05 via the GitHub releases API:
 * x86_64-win32 / arm64-win32 assets with release-published sha256
 * digests; upstream lwthiker ships linux/mac/docker only). The digests
 * below are the release-published values, verbatim.
 *
 * DOCTRINE: the binary is PC-local and gitignored (tools/) — it never
 * enters the repo or the lockfile; there is no npm dependency (the
 * "no new runtime dependency" rule holds). Extraction uses the OS `tar`
 * (Windows 10+ ships bsdtar as tar.exe); the archive's inner layout is
 * NEVER assumed — the extracted tree is searched for curl-impersonate*.exe
 * and a miss fails visibly naming the archive. A non-win32 platform fails
 * visibly printing the manual README step (no silent platform guessing).
 *
 * D2 policy unchanged: curl stays the default transport, switching to
 * playwright stays an explicit operator act, and there is NO auto-fallback
 * in code — setup merely automates the operator action. EVERY failure
 * path names both remedies: re-run this script, or put
 * LINKEDIN_TRANSPORT=playwright in .env (the escape hatch).
 *
 * Entry-guarded like every PC script: importing stays side-effect free.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ENV_NAMES } from "../src/config.js";
import { DOT_ENV_PATH, envWithDotEnv, upsertDotEnvLine } from "../src/env-file.js";
import { stateTempPath } from "../src/state.js";

/** Pinned lexiforest release tag. */
export const CURL_IMPERSONATE_TAG = "v2.3.2";

/** Asset base URL for the pinned release. */
export const CURL_IMPERSONATE_ASSET_BASE =
  "https://github.com/lexiforest/curl-impersonate/releases/download/v2.3.2/";

/** x86_64 Windows asset (any non-arm64 machine). */
export const CURL_IMPERSONATE_X64_ASSET = "curl-impersonate-v2.3.2.x86_64-win32.tar.gz";

/** arm64 Windows asset. */
export const CURL_IMPERSONATE_ARM64_ASSET = "curl-impersonate-v2.3.2.arm64-win32.tar.gz";

/** Release-published sha256, x86_64-win32 — verbatim from the GitHub release. */
export const CURL_IMPERSONATE_X64_SHA256 =
  "94affc91c64991552403d427cf0e6656ee74f85dcbe58c0ba389f540819f40db";

/** Release-published sha256, arm64-win32 — verbatim from the GitHub release. */
export const CURL_IMPERSONATE_ARM64_SHA256 =
  "e9c1d8d5b4d2001835b1de92dde9b6ce49ee9ab621b612eaa53a5cd4db5408d8";

/**
 * The escape hatch appended to EVERY failure message before exit 1: the
 * playwright transport needs no binary, and D2 forbids auto-fallback —
 * the switch stays the operator's explicit act.
 */
export const SETUP_CURL_ESCAPE_HATCH =
  "Or put LINKEDIN_TRANSPORT=playwright in .env to skip the binary (no auto-fallback — you choose).";

/** Install target beside the clone; gitignored via tools/. */
export const DEFAULT_TARGET_DIR = join(process.cwd(), "tools", "curl-impersonate");

/** Injectable extraction runner, execFile-shaped (linkedin-fetch ExecFn idiom). */
export type TarRunner = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

const execFilePromised = promisify(execFile);

const realTar: TarRunner = (file, args) =>
  execFilePromised(file, [...args], { timeout: 120_000, windowsHide: true });

/** Injectable existence probe (the already-configured gate). */
type ExistsFn = (path: string) => Promise<boolean>;

const realExists: ExistsFn = (path) => Promise.resolve(existsSync(path));

export interface SetupCurlDeps {
  /** Downloader. Default: global fetch (plain fetch → arrayBuffer; ~2 MB fits memory). */
  fetchFn?: typeof fetch;
  /** Extraction runner. Default: OS `tar -xzf <archive> -C <targetDir>`. */
  tarRunner?: TarRunner;
  /** Environment for the already-configured gate. Default: envWithDotEnv(). */
  env?: Record<string, string | undefined>;
  /** The .env document to upsert. Default: <cwd>/.env. */
  envPath?: string;
  /** Install target. Default: tools/curl-impersonate/ beside the clone. */
  targetDir?: string;
  /** Existence probe. Default: existsSync. */
  exists?: ExistsFn;
  /** Expected digest override (tests inject the fixture's own computed sha256). Default: pinned. */
  expectedSha256?: string;
  /** Platform gate. Default: process.platform — non-win32 fails visibly. */
  platform?: NodeJS.Platform;
  /** Asset selector. Default: process.arch — arm64 → arm64 asset, anything else → x86_64. */
  arch?: string;
}

function fail(reason: string): Error {
  return new Error(`setup-curl: ${reason}. ${SETUP_CURL_ESCAPE_HATCH}`);
}

/** Arch-selected asset + pinned digest (arm64 → arm64, anything else on win32 → x86_64). */
function selectAsset(arch: string): { asset: string; sha256: string } {
  return arch === "arm64"
    ? { asset: CURL_IMPERSONATE_ARM64_ASSET, sha256: CURL_IMPERSONATE_ARM64_SHA256 }
    : { asset: CURL_IMPERSONATE_X64_ASSET, sha256: CURL_IMPERSONATE_X64_SHA256 };
}

/** Walk the extracted tree for curl-impersonate*.exe (case-insensitive; layout never assumed). */
async function findBinary(targetDir: string): Promise<string> {
  const entries = await readdir(targetDir, { recursive: true });
  const relative = entries.find((entry) => /curl-impersonate[^/\\]*\.exe$/i.test(entry));
  return relative === undefined ? "" : resolve(targetDir, relative);
}

/**
 * Run the setup: already-configured short-circuit → platform gate →
 * download + sha256 pin → tar extract → exe walk → .env upsert. Resolves
 * (exit 0) or throws one fail-visible Error that names the failing step
 * AND the escape hatch — the entry wrapper prints it and exits 1.
 */
export async function runSetupCurl(deps: SetupCurlDeps = {}): Promise<void> {
  const env = deps.env ?? envWithDotEnv();
  const envPath = deps.envPath ?? join(process.cwd(), DOT_ENV_PATH);
  const targetDir = deps.targetDir ?? DEFAULT_TARGET_DIR;
  const exists = deps.exists ?? realExists;
  const fetchFn = deps.fetchFn ?? fetch;
  const tarRunner = deps.tarRunner ?? realTar;
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;

  // 1. Already configured — the shell env (or a prior run via .env) wins;
  // zero downloads. resolve() normalizes a relative .env value for the log.
  const configured = env[ENV_NAMES.curlImpersonateBin]?.trim();
  if (configured !== undefined && configured !== "" && (await exists(configured))) {
    console.log(`setup-curl: already configured — ${resolve(configured)}`);
    return;
  }

  // 2. Platform gate: this script downloads Windows assets only. No silent
  // platform guessing — anything else gets the manual README step.
  if (platform !== "win32") {
    throw fail(
      `${platform} is not supported by this script — install curl-impersonate by hand per README: PC operations`,
    );
  }
  const selected = selectAsset(arch);
  const expectedSha256 = deps.expectedSha256 ?? selected.sha256;
  const url = `${CURL_IMPERSONATE_ASSET_BASE}${selected.asset}`;
  console.log(`setup-curl: downloading ${selected.asset} (tag ${CURL_IMPERSONATE_TAG})...`);
  const response = await fetchFn(url);
  if (!response.ok) {
    throw fail(`${url} answered HTTP ${response.status} — download failed`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw fail(
      `sha256 mismatch for ${url} — expected ${expectedSha256} (pinned), got ${actualSha256}`,
    );
  }

  // 3. Extract with the OS tar; a missing/failed tar fails naming it.
  await mkdir(targetDir, { recursive: true });
  const archivePath = stateTempPath(targetDir, Date.now());
  try {
    await writeFile(archivePath, bytes);
    try {
      await tarRunner("tar", ["-xzf", archivePath, "-C", targetDir]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw fail(`tar extraction failed — ${message} (is the OS tar on PATH?)`);
    }
  } finally {
    // Best-effort archive cleanup — a leftover .tmp in gitignored tools/ is harmless.
    try {
      await unlink(archivePath);
    } catch {
      // Ignore
    }
  }

  // 4. Find the binary — the archive's inner layout is never assumed.
  const binaryPath = await findBinary(targetDir);
  if (binaryPath === "") {
    throw fail(`no curl-impersonate*.exe found inside ${selected.asset} — the layout changed`);
  }

  // 5. Wire the .env line and point at the probe.
  await upsertDotEnvLine(envPath, ENV_NAMES.curlImpersonateBin, binaryPath);
  console.log(`setup-curl: binary — ${binaryPath}`);
  console.log(`setup-curl: ${envPath} updated with ${ENV_NAMES.curlImpersonateBin}`);
  console.log("setup-curl: done — run npm run probe-linkedin");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSetupCurl().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`setup-curl: FAILED — ${message}`);
    process.exit(1);
  });
}
