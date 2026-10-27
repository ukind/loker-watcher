/**
 * Live end-to-end validation harness.
 *
 * Follows .claude/skills/validate-e2e/SKILL.md step for step:
 *   1. replicate the src/index.ts flow
 *   2. mock nodemailer transport that captures the digest in memory
 *   3. point state at a temp file, never state/seen-posts.json
 *   4. real credentials from .env (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)
 *   5. widened keyword override when the live feed has zero matches
 *   6. hash state/seen-posts.json before and after — the two must match
 *   7. fail-visible: loadState on a corrupt file exits 1 with the file untouched
 *
 * Self-loads .env from the repo root so no secret is ever typed on a command
 * line. Prints presence and length only — never a secret value.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs .rpiv/tmp/e2e-live.mts
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Transporter } from "nodemailer";
import { loadWatcherConfig, resolveSurfaces } from "../../src/config-file.js";
import { sendDigest } from "../../src/email.js";
import { extractPosts } from "../../src/extract.js";
import { fetchSurfaces, fetchSurfacesAuthenticated } from "../../src/fetch-threads.js";
import { judgePosts, resolveJudgeConfig } from "../../src/judge.js";
import { filterRecent } from "../../src/recency.js";
import { resolveSession } from "../../src/threads-session.js";
import { diffNew, loadState, saveState } from "../../src/state.js";
import type { Post } from "../../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const REAL_STATE = join(REPO, "state", "seen-posts.json");

/** Broadened criterion for runbook step 5 (zero-match feeds). */
const WIDENED = [
  "hiring", "loker", "lowongan", "recruit", "recruitment", "career", "careers",
  "job", "jobs", "kerja", "vacancy", "openings", "developer", "engineer",
  "programmer", "designer", "remote", "magang", "internship",
];

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function hashRealState(): Promise<string> {
  try {
    return sha(await readFile(REAL_STATE, "utf8"));
  } catch {
    return "ABSENT";
  }
}

/** Load .env into process.env without ever printing a value. */
async function loadDotEnv(): Promise<string[]> {
  const loaded: string[] = [];
  let text: string;
  try {
    text = await readFile(join(REPO, ".env"), "utf8");
  } catch {
    console.log("e2e: .env not found at the repo root — create it first");
    process.exit(1);
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip one layer of matching surrounding quotes (dotenv convention):
    // LLM_BASE_URL="https://..." must not reach the endpoint builder quoted.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "" || value === "") continue;
    process.env[key] = value;
    loaded.push(key);
  }
  return loaded;
}

/** Wrap fetch so every LLM call is counted and timed. */
function instrumentedFetch(): { fetchFn: typeof fetch; stats: { calls: number; ms: number } } {
  const stats = { calls: 0, ms: 0 };
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    stats.calls += 1;
    const started = Date.now();
    try {
      return await fetch(input, init);
    } finally {
      stats.ms += Date.now() - started;
    }
  }) as unknown as typeof fetch;
  return { fetchFn, stats };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const loaded = await loadDotEnv();
  console.log(`e2e: .env keys loaded: ${loaded.join(", ") || "(none)"}`);
  for (const key of loaded) {
    const value = process.env[key] ?? "";
    console.log(`e2e:   ${key} present, ${value.length} chars`);
  }

  const judgeConfig = resolveJudgeConfig(process.env);
  console.log(`e2e: judge endpoint ${judgeConfig.baseUrl}, model ${judgeConfig.model}`);

  // ---- runbook step 6: hash the real state file before anything runs ----
  const before = await hashRealState();
  console.log(`e2e: state/seen-posts.json hash before = ${before}`);

  const dir = await mkdtemp(join(tmpdir(), "lw-e2e-"));
  const statePath = join(dir, "state.json");

  // ---- runbook step 1: replicate the index.ts flow ----
  const config = await loadWatcherConfig();
  const surfaces = resolveSurfaces(config.surfaces);
  console.log(`e2e: surfaces: ${surfaces.map((s) => s.label).join(", ")}`);

  const sessionPath = await resolveSession(process.env);
  const collected: Post[] =
    sessionPath !== null
      ? await fetchSurfacesAuthenticated(surfaces, sessionPath)
      : (await fetchSurfaces(surfaces)).flatMap((s) => extractPosts(s.html));
  console.log(`e2e: fetched ${collected.length} post(s) (${sessionPath !== null ? "authenticated" : "logged-out"})`);

  const seen = new Set<string>();
  const posts = collected.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const recent = filterRecent(posts, config.recencyHours);
  console.log(`e2e: ${posts.length} unique, ${recent.length} within ${config.recencyHours}h`);

  const state = await loadState(statePath);
  const allNew = diffNew(state, recent);
  // Optional cap for a fast smoke run: E2E_MAX_POSTS=20 judges 2 bulk calls.
  // Unset means the whole unseen backlog, which is the real production shape.
  const cap = Number(process.env.E2E_MAX_POSTS ?? "");
  const newPosts = Number.isFinite(cap) && cap > 0 ? allNew.slice(0, cap) : allNew;
  console.log(
    `e2e: ${allNew.length} unseen post(s)` +
      (newPosts.length < allNew.length ? ` — capped to ${newPosts.length} by E2E_MAX_POSTS` : ""),
  );

  // ---- runbook step 4: real credentials, real endpoint ----
  const { fetchFn, stats } = instrumentedFetch();
  let keywords = config.keywords;
  let judged = await judgePosts(newPosts, judgeConfig, keywords, fetchFn);
  console.log(
    `e2e: pass 1 (config.keywords) — ${stats.calls} call(s), ${stats.ms}ms, ` +
      `${judged.judged.length} judged, ${judged.skippedPostIds.length} skipped`,
  );

  let matches = judged.judged.filter((j) => j.verdict.relevant && j.verdict.locationOk).map((j) => j.post);

  // ---- runbook step 5: widened keyword override on a zero-match feed ----
  if (matches.length === 0 && newPosts.length > 0) {
    console.log("e2e: zero matches — retrying with the widened keyword list (runbook step 5)");
    keywords = WIDENED;
    const before2 = stats.calls;
    judged = await judgePosts(newPosts, judgeConfig, keywords, fetchFn);
    console.log(
      `e2e: pass 2 (widened) — ${stats.calls - before2} call(s), ` +
        `${judged.judged.length} judged, ${judged.skippedPostIds.length} skipped`,
    );
    matches = judged.judged.filter((j) => j.verdict.relevant && j.verdict.locationOk).map((j) => j.post);
  }

  console.log(
    `e2e: judge total — ${stats.calls} call(s), ${stats.ms}ms, ` +
      `avg ${stats.calls > 0 ? Math.round(stats.ms / stats.calls) : 0}ms per call`,
  );

  // ---- runbook step 2: mock transport captures the digest in memory ----
  const captured: Array<{ subject: string; text: string }> = [];
  const mockTransport = {
    sendMail: async (mail: { subject: string; text: string }) => {
      captured.push({ subject: mail.subject, text: mail.text });
      return { messageId: "mock-" + captured.length };
    },
  } as unknown as Transporter;

  const emailConfig = { user: "mock@local", pass: "mock" };
  const digest = await sendDigest(matches, emailConfig, mockTransport);
  console.log(`e2e: digest sent=${digest.sent} postCount=${digest.postCount} recipient=${digest.recipient}`);
  if (captured.length > 0) {
    console.log("e2e: ---- captured digest (no email left this machine) ----");
    console.log(captured[0]?.text ?? "");
    console.log("e2e: ---- end captured digest ----");
  }

  // ---- runbook step 3: state lands on the temp file only ----
  const save = await saveState(state, judged.judged.map((j) => j.post.id), statePath);
  console.log(`e2e: saveState saved=${save.saved} added=${save.addedCount} (temp path)`);

  // ---- runbook step 6: the real state file must be untouched ----
  const after = await hashRealState();
  const untouched = before === after;
  console.log(`e2e: state/seen-posts.json hash after  = ${after}`);
  console.log(`e2e: REAL STATE UNTOUCHED = ${untouched}`);

  // ---- runbook step 7: fail-visible on a corrupt state file ----
  const corruptPath = join(dir, "corrupt.json");
  await writeFile(corruptPath, "{ not json", "utf8");
  const corruptBefore = await readFile(corruptPath, "utf8");
  let threw = false;
  try {
    await loadState(corruptPath);
  } catch (error) {
    threw = true;
    console.log(`e2e: corrupt state threw as expected: ${error instanceof Error ? error.message : String(error)}`);
  }
  const corruptAfter = await readFile(corruptPath, "utf8");
  console.log(`e2e: FAIL-VISIBLE threw=${threw} fileUntouched=${corruptBefore === corruptAfter}`);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `e2e: DONE in ${elapsed}s — matches=${matches.length} judged=${judged.judged.length} ` +
      `skipped=${judged.skippedPostIds.length} llmCalls=${stats.calls} realStateUntouched=${untouched} ` +
      `failVisible=${threw && corruptBefore === corruptAfter}`,
  );
  if (!untouched || !threw || corruptBefore !== corruptAfter) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`e2e: FAILED — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
