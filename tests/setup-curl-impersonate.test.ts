/**
 * Offline suite for the curl-impersonate one-command setup (Phase 9).
 *
 * The network boundary (fetchFn) and the extraction boundary (tarRunner)
 * are injected. The fixture "archive" is a tiny byte buffer whose sha256
 * THIS SUITE COMPUTES ITSELF (the assertion recomputes the digest — never
 * a hard-coded fixture hash) and the happy path injects it as
 * expectedSha256; the release-pinned digests are pinned separately as
 * verbatim module constants. The fake tar simulates extraction by writing
 * the .exe into the target dir it was handed (-C <targetDir>). Zero
 * network, zero real downloads; every file write lands in OS temp.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import {
  CURL_IMPERSONATE_ARM64_ASSET,
  CURL_IMPERSONATE_ARM64_SHA256,
  CURL_IMPERSONATE_ASSET_BASE,
  CURL_IMPERSONATE_TAG,
  CURL_IMPERSONATE_X64_ASSET,
  CURL_IMPERSONATE_X64_SHA256,
  type TarRunner,
  runSetupCurl,
} from "../scripts/setup-curl-impersonate.js";
import { ENV_NAMES as ENV } from "../src/config.js";

let dir: string | undefined;
after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

async function workPath(name: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "lw-setup-curl-"));
  return join(dir, name);
}

/** The tiny fixture "archive": its bytes are arbitrary; its digest is computed, never hard-coded. */
const FIXTURE_BYTES = Buffer.from(
  "fake archive bytes — the suite computes this buffer's sha256 itself",
);
const FIXTURE_SHA = createHash("sha256").update(FIXTURE_BYTES).digest("hex");

/** A fetch double serving the fixture bytes; records every requested URL. */
function fetchServing(bytes: Buffer): { fetchFn: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (async (url: unknown) => {
    urls.push(String(url));
    return new Response(new Uint8Array(bytes), { status: 200 });
  }) as typeof fetch;
  return { fetchFn, urls };
}

/** A fetch double answering a non-200 (the download-failure path). */
function fetchAnswering(status: number): { fetchFn: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (async (url: unknown) => {
    urls.push(String(url));
    return new Response("nope", { status });
  }) as typeof fetch;
  return { fetchFn, urls };
}

/** The fake tar: parses -C <targetDir> from its args and simulates the extracted tree. */
const fakeExtract: TarRunner = async (_file, args) => {
  const target = args[3] ?? "";
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "curl-impersonate-v2.3.2.exe"), "MZ fake binary");
  return { stdout: "" };
};

describe("pinned constants (release-published, verbatim)", () => {
  it("carries the lexiforest v2.3.2 Windows assets and their release sha256 digests", () => {
    assert.equal(CURL_IMPERSONATE_TAG, "v2.3.2");
    assert.equal(
      CURL_IMPERSONATE_ASSET_BASE,
      `https://github.com/lexiforest/curl-impersonate/releases/download/${CURL_IMPERSONATE_TAG}/`,
    );
    assert.equal(CURL_IMPERSONATE_X64_ASSET, "curl-impersonate-v2.3.2.x86_64-win32.tar.gz");
    assert.equal(CURL_IMPERSONATE_ARM64_ASSET, "curl-impersonate-v2.3.2.arm64-win32.tar.gz");
    assert.equal(
      CURL_IMPERSONATE_X64_SHA256,
      "94affc91c64991552403d427cf0e6656ee74f85dcbe58c0ba389f540819f40db",
    );
    assert.equal(
      CURL_IMPERSONATE_ARM64_SHA256,
      "e9c1d8d5b4d2001835b1de92dde9b6ce49ee9ab621b612eaa53a5cd4db5408d8",
    );
  });
});

describe("runSetupCurl", () => {
  it("happy path: extracts the exe into targetDir, lands the absolute .env line, logs the probe pointer", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const targetDir = await workPath("happy-tools");
    const envPath = await workPath("happy.env");
    const { fetchFn, urls } = fetchServing(FIXTURE_BYTES);

    await runSetupCurl({
      fetchFn,
      env: {},
      envPath,
      targetDir,
      arch: "x64",
      expectedSha256: FIXTURE_SHA, // the suite computed this digest from the fixture bytes itself
      tarRunner: fakeExtract,
    });

    assert.equal(urls.length, 1);
    assert.equal(urls[0], `${CURL_IMPERSONATE_ASSET_BASE}${CURL_IMPERSONATE_X64_ASSET}`);
    const expectedBinary = resolve(targetDir, "curl-impersonate-v2.3.2.exe");
    const text = await readFile(envPath, "utf8");
    assert.equal(text, `${ENV.curlImpersonateBin}=${expectedBinary}\n`);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line === "setup-curl: done — run npm run probe-linkedin"));
  });

  it("already configured: a set bin pointing at an existing file exits 0 with zero downloads", async () => {
    const binFile = await workPath("existing-bin.exe");
    await writeFile(binFile, "MZ");
    const { fetchFn, urls } = fetchServing(FIXTURE_BYTES);
    const envPath = await workPath("already.env");

    await runSetupCurl({
      fetchFn,
      env: { [ENV.curlImpersonateBin]: binFile },
      envPath,
      targetDir: await workPath("already-tools"),
      // The short-circuit must precede any extraction: a rejecting tar proves it.
      tarRunner: async () => {
        throw new Error("tar must not run when already configured");
      },
    });

    assert.equal(urls.length, 0);
    await assert.rejects(() => readFile(envPath), /ENOENT/); // .env untouched — never written
  });

  it("fails naming the URL and both digests on a sha256 mismatch", async () => {
    const targetDir = await workPath("mismatch-tools");
    const envPath = await workPath("mismatch.env");
    const { fetchFn } = fetchServing(FIXTURE_BYTES);
    const url = `${CURL_IMPERSONATE_ASSET_BASE}${CURL_IMPERSONATE_X64_ASSET}`;

    await assert.rejects(
      async () =>
        runSetupCurl({
          fetchFn,
          env: {},
          envPath,
          targetDir,
          arch: "x64",
          // No expectedSha256 override: the real pinned digest cannot match the tiny fixture.
          tarRunner: fakeExtract,
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.ok(message.includes("sha256 mismatch"));
        assert.ok(message.includes(url)); // names the URL
        assert.ok(message.includes(CURL_IMPERSONATE_X64_SHA256)); // the pinned expected digest
        assert.ok(message.includes(FIXTURE_SHA)); // the computed actual digest
        assert.ok(message.includes("LINKEDIN_TRANSPORT=playwright")); // the escape hatch
        return true;
      },
    );
  });

  it("fails naming tar when extraction fails", async () => {
    const { fetchFn } = fetchServing(FIXTURE_BYTES);
    await assert.rejects(
      async () =>
        runSetupCurl({
          fetchFn,
          env: {},
          envPath: await workPath("tarfail.env"),
          targetDir: await workPath("tarfail-tools"),
          arch: "x64",
          expectedSha256: FIXTURE_SHA,
          tarRunner: async () => {
            throw new Error("spawn tar ENOENT");
          },
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.ok(message.includes("tar extraction failed"));
        assert.ok(message.includes("spawn tar ENOENT"));
        assert.ok(message.includes("LINKEDIN_TRANSPORT=playwright"));
        return true;
      },
    );
  });

  it("fails naming the archive when no curl-impersonate*.exe is found in the extracted tree", async () => {
    const { fetchFn } = fetchServing(FIXTURE_BYTES);
    await assert.rejects(
      async () =>
        runSetupCurl({
          fetchFn,
          env: {},
          envPath: await workPath("noexe.env"),
          targetDir: await workPath("noexe-tools"),
          arch: "x64",
          expectedSha256: FIXTURE_SHA,
          tarRunner: async () => ({ stdout: "" }), // extracts nothing
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.ok(
          message.includes(`no curl-impersonate*.exe found inside ${CURL_IMPERSONATE_X64_ASSET}`),
        );
        assert.ok(message.includes("LINKEDIN_TRANSPORT=playwright"));
        return true;
      },
    );
  });

  it("fails naming the manual README step and the escape hatch on a non-win32 platform (no download)", async () => {
    const { fetchFn, urls } = fetchServing(FIXTURE_BYTES);
    await assert.rejects(
      async () =>
        runSetupCurl({
          fetchFn,
          env: {},
          envPath: await workPath("linux.env"),
          targetDir: await workPath("linux-tools"),
          platform: "linux",
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.ok(message.includes("linux is not supported"));
        assert.ok(message.includes("README: PC operations"));
        assert.ok(message.includes("LINKEDIN_TRANSPORT=playwright"));
        return true;
      },
    );
    assert.equal(urls.length, 0); // the platform gate precedes any download
  });

  it("selects the arm64 asset on arch arm64", async () => {
    const targetDir = await workPath("arm-tools");
    const { fetchFn, urls } = fetchServing(FIXTURE_BYTES);
    await runSetupCurl({
      fetchFn,
      env: {},
      envPath: await workPath("arm.env"),
      targetDir,
      arch: "arm64",
      expectedSha256: FIXTURE_SHA,
      tarRunner: fakeExtract,
    });
    assert.equal(urls[0], `${CURL_IMPERSONATE_ASSET_BASE}${CURL_IMPERSONATE_ARM64_ASSET}`);
  });

  it("fails naming the URL on a download non-200 (escape hatch included)", async () => {
    const { fetchFn, urls } = fetchAnswering(503);
    await assert.rejects(
      async () =>
        runSetupCurl({
          fetchFn,
          env: {},
          envPath: await workPath("dl503.env"),
          targetDir: await workPath("dl503-tools"),
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.ok(message.includes("HTTP 503 — download failed"));
        assert.ok(message.includes(CURL_IMPERSONATE_X64_ASSET));
        assert.ok(message.includes("LINKEDIN_TRANSPORT=playwright"));
        return true;
      },
    );
    assert.equal(urls.length, 1);
  });
});
