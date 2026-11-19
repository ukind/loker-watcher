/**
 * Judge latency probe. Run inside GitHub Actions (workflow_dispatch only)
 * to measure how long the configured LLM endpoint really takes from a
 * runner. The plan's 15s timeout was validated only on a developer machine;
 * run 40264368939 proved the runner path is slower.
 *
 * Revision 2026-10-26: run 40268599609 showed the original synthetic
 * fixtures under-measure latency by 5.2x (5.3s measured vs 27.75s real),
 * because 5 synthetic keywords and ~200-char filler posts are smaller than
 * the 19 configured keywords and real Threads captions. The probe now
 * loads the real keyword list from watcher.config.json and judges a
 * fixture set of real captured post texts. It ramps concurrent bulk calls
 * per account, doubling 2→4→8→16→32 and stopping at the first refused
 * level: Z.AI publishes no concurrency number (tier-based, dynamically
 * adjusted, higher off-peak).
 *
 * Revision 2026-11-06: the measured per-account ceilings no longer feed a
 * single global width knob — the probe commits them to
 * state/judge-ceilings.json (writeCeilingsAtomic, live-only, BEFORE the
 * dead gate: even a red run records what it measured) and the dispatch run
 * spreads judge dispatches across the pool under those caps
 * (src/judge-ceilings.ts). A missing entry floors that account at ceiling 1
 * with one warning; nothing here reads the file back.
 *
 * Revision 2026-11-07: the old ramp verified only levels 2 and 4, capping
 * every committed ceiling at 4, so the spread's Σ-ceilings width inherited
 * that cap. Operator asked for maximal concurrency: the ramp doubles to
 * the RAMP_MAX safety cap of 32 (worst case 62 verified calls per
 * account), and the dispatch run serializes probe→watch (watch.yml) so
 * the same run's watch starts on the fresh maximal readings.
 *
 * Revision 2026-11-07 (freshness gate): the write stamps probedAt (epoch
 * seconds) - the dispatch probe job skips itself for 8h after a success; a
 * failed probe never starts the window.
 *
 * Usage:
 *   LLM_ACCOUNTS='[{"baseUrl":"https://api.example.com/v1","apiKey":"key","model":"model"}]' npx tsx scripts/probe-judge.ts
 * Exits 1 when any account is auth-dead (401/403) or has a failed leg,
 * so a rotten key in the pool fails the gating probe job loudly. A 429-
 * refused leg is data (the account is busy), not a gate failure — the
 * watch job itself is the real gate for throttling.
 */
import { pathToFileURL } from "node:url";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { JUDGE_CEILINGS_PATH } from "../src/config.js";
import type { LlmAccount } from "../src/judge-account.js";
import { writeCeilingsAtomic } from "../src/judge-ceilings.js";
import { buildBulkMessages } from "../src/judge-prompts.js";
import { type ProbeOutcome, findConcurrencyCeiling, probeFetch } from "../src/judge-ramp.js";
import { resolveJudgeConfig } from "../src/judge.js";
import type { Post } from "../src/types.js";

/**
 * Real captured Threads captions, kept verbatim so token counts match
 * production. The long hashtagged one matters most: it is the shape that
 * made the synthetic fixture under-measure by 5.2x.
 */
const FIXTURE_TEXTS: readonly string[] = [
  "We're growing our team!\n\nRolling Glory is looking for new talents to join our team in these positions:\n• Program Manager\n• Backend Developer\n• Frontend Developer\n\n📍 Bandung-based\n💻 Remote / Hybrid\n\nIf you're ready to build, create, and grow with us, we'd love to hear from you.\n\n📩 Detail posisi & cara melamar tersedia di poster.",
  "NGH Property is hiring!\n\nWe're hiring: Full-Stack Developer — on-site in Uluwatu, Bali 🌴\n\nReady to build with us? 👉 Check the poster for application details.\n\n𝘋𝘳𝘪𝘷𝘦𝘯 𝘣𝘺 𝘋𝘶𝘵𝘤𝘩 𝘌𝘹𝘱𝘦𝘳𝘵𝘪𝘴𝘦. 𝘐𝘯𝘴𝘱𝘪𝘳𝘦𝘥 𝘣𝘺 𝘉𝘢𝘭𝘪.\n\n━━━━━━━━\n📌 Job opportunities shared here are for talents in Indonesia.\n\nLooking for your next opportunity?\n🔔 Join our WhatsApp Channel - link in bio.\n\n#hiresflow #lokerbali #lowongankerjabali #lokerIT #lokerprogrammer #FullStackDeveloper #SoftwareDeveloper #WebDeveloper #BaliJobs",
  "Lowongan kerja probe post 3. We are hiring a frontend developer with React and TypeScript experience. Jakarta or remote. Kirim lamaran ke DM kami. Fresh graduate welcome, minimal 1 tahun pengalaman.",
  "Hiring backend engineer, remote friendly. DM for details.",
  "Butuh admin pajak di kantor Jakarta. Kirim CV ke HR.",
  "Open recruitment: UI/UX Designer & Product Manager. Hybrid Bandung.",
  "Magang mahasiswa semester akhir, bagian marketing. Tidak dibayar.",
  "We are looking for a DevOps engineer with Kubernetes experience, on-site in Surabaya.",
  "Jual kaos distro custom, harga murah. Order via WA.",
  "Fullstack dev wanted — Next.js, Postgres, AWS. Remote within Indonesia.",
];

function syntheticPost(index: number): Post {
  const text = FIXTURE_TEXTS[index % FIXTURE_TEXTS.length] ?? "";
  return {
    platform: "threads",
    id: `90000000000000000${index}`,
    author: `probe${index}`,
    permalink: `https://www.threads.com/@probe${index}/post/90000000000000000${index}`,
    timestamp: "2026-10-26T00:00:00.000Z",
    text,
  };
}

/** One account's full probe record. */
interface AccountProbe {
  position: number; // 1-based, matches the alarm record's account numbering
  label: string;
  minimal: ProbeOutcome;
  bulk: ProbeOutcome;
  bulkAgain: ProbeOutcome;
  ceiling: number;
}

/**
 * Classify one account's record. An auth rejection (401/403 anywhere) or
 * a failed leg (network error, 2xx without JSON) makes the account DEAD —
 * the probe exits 1 naming it. A broken ramp (ceiling 0) is dead too.
 * Refused legs that are not auth failures mean the account is busy:
 * reported, distinct from dead.
 */
function classifyDead(probe: AccountProbe): string | null {
  for (const leg of [probe.minimal, probe.bulk, probe.bulkAgain]) {
    if (leg.kind === "failed") {
      return `failed leg: ${leg.message}`;
    }
    if (leg.kind === "refused" && (leg.status === 401 || leg.status === 403)) {
      return `auth-dead: HTTP ${leg.status}`;
    }
  }
  if (probe.ceiling < 1) {
    return `broken concurrency ramp (ceiling ${probe.ceiling})`;
  }
  return null;
}

/**
 * One account's full probe, run concurrently with its peers: the minimal
 * call, the 10-post bulk call twice (variance), then the ramp — the
 * production order, unchanged. The ramp levels stay SEQUENTIAL within the
 * account because each level's verdict gates the next. Every line this
 * prints carries the account label, so interleaved peer output stays
 * attributable; the per-account summary line prints here so output streams
 * as each account progresses.
 */
async function probeAccount(
  index: number,
  account: LlmAccount,
  config: WatcherConfig,
): Promise<{ probe: AccountProbe; ceiling: number }> {
  const label = `account ${index + 1} (${account.baseUrl})`;
  console.log(`probe: === ${label} ===`);

  const minimal = await probeFetch(
    `${label} minimal call`,
    {
      model: account.model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      temperature: 0,
    },
    account,
  );

  const ten = Array.from({ length: 10 }, (_, i) => syntheticPost(i + 1));
  const bulkPayload = {
    model: account.model,
    messages: buildBulkMessages(ten, config.keywords),
    temperature: 0,
    reasoning_effort: config.reasoningEffort,
    response_format: { type: "json_object" },
  };
  const bulk = await probeFetch(
    `${label} bulk call (10 posts, production prompt shape)`,
    bulkPayload,
    account,
  );
  const again = await probeFetch(`${label} bulk call again (variance check)`, bulkPayload, account);

  const ceiling = await findConcurrencyCeiling(bulkPayload, account, label);
  const probe: AccountProbe = {
    position: index + 1,
    label,
    minimal,
    bulk,
    bulkAgain: again,
    ceiling,
  };
  console.log(
    `probe: ${label} — minimal=${minimal.kind} bulk=${bulk.kind} bulkAgain=${again.kind} ceiling=${ceiling}`,
  );
  return { probe, ceiling };
}

async function main(): Promise<void> {
  // Read once at startup; a missing or malformed file fails the probe loudly.
  const config = await loadWatcherConfig();
  let accounts: LlmAccount[];
  try {
    accounts = [...resolveJudgeConfig(process.env)];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`probe: ${message}`);
    process.exit(1);
  }

  // All accounts probe CONCURRENTLY (2026-11-07, Actions run 42354544399):
  // wall time is the slowest single account, not the sum. Ramping levels
  // stay sequential within an account (probeAccount); only the accounts
  // interleave. probeFetch converts network failures to failed outcomes, so a
  // rejection here is an unexpected bug — containment keeps the other
  // accounts' readings alive.
  const settled = await Promise.allSettled(
    accounts.map((account, index) => probeAccount(index, account, config)),
  );
  const ceilings: Record<string, number> = {};
  const dead: string[] = [];
  for (const [index, account] of accounts.entries()) {
    const label = `account ${index + 1} (${account.baseUrl})`;
    const outcome = settled[index];
    if (outcome?.status !== "fulfilled") {
      const reason = outcome?.status === "rejected" ? String(outcome.reason) : "missing result";
      dead.push(`${label} — probe crashed: ${reason}`);
      continue;
    }
    const { probe, ceiling } = outcome.value;
    // File key = trimmed baseUrl (resolveCeilings trims both sides). Twins
    // sharing a baseUrl share one reading — last write wins; one entry per
    // endpoint is the file's shape.
    ceilings[account.baseUrl.trim()] = ceiling;
    const cause = classifyDead(probe);
    if (cause !== null) {
      dead.push(`${label} — ${cause}`);
    }
  }

  // Live-only persistence BEFORE the dead gate: this run's readings ARE the
  // whole file — no merge with previous content, no staleness logic (the
  // probe runs dispatch-only, so readings legitimately age for days). A
  // dead account's 0 (broken ramp) floors at 1 in the reader with a
  // warning — the honest signal for a rotten key.
  // The freshness clock (Phase 9): epoch seconds the watch.yml gate reads.
  // Stamped on every SUCCESSFUL probe - bytes change even when the ceilings
  // are identical, so the Commit ceilings no-op guard cannot strand the
  // gate on a stale window. The COMMIT only lands on a green gate (the
  // Commit step is skipped on failure), so a red probe never starts a
  // window.
  ceilings.probedAt = Math.floor(Date.now() / 1000);
  await writeCeilingsAtomic(ceilings, JUDGE_CEILINGS_PATH);
  const ceilingCount = Object.keys(ceilings).length - 1; // minus probedAt
  console.log(`probe: committed ${ceilingCount} ceiling(s) + probedAt to ${JUDGE_CEILINGS_PATH}`);

  if (dead.length > 0) {
    console.error("probe: DEAD account(s) — failing the gating probe:");
    for (const line of dead) {
      console.error(`probe:   ${line}`);
    }
    process.exit(1);
  }
  console.log("probe: all accounts verified — gating probe passed");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
