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
 * Usage:
 *   LLM_ACCOUNTS='[{"baseUrl":"https://api.example.com/v1","apiKey":"key","model":"model"}]' npx tsx scripts/probe-judge.ts
 * Exits 1 when any account is auth-dead (401/403) or has a failed leg,
 * so a rotten key in the pool fails the gating probe job loudly. A 429-
 * refused leg is data (the account is busy), not a gate failure — the
 * watch job itself is the real gate for throttling.
 */
import { loadWatcherConfig } from "../src/config-file.js";
import { JUDGE_CEILINGS_PATH } from "../src/config.js";
import { writeCeilingsAtomic } from "../src/judge-ceilings.js";
import { type LlmAccount, buildBulkMessages, resolveJudgeConfig } from "../src/judge.js";
import type { Post } from "../src/types.js";

// Read once at startup; a missing or malformed file fails the probe loudly.
const CONFIG = await loadWatcherConfig();

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

/** One probe call's classified outcome. */
type ProbeOutcome =
  | { kind: "ok" }
  | { kind: "refused"; status: number }
  | { kind: "failed"; message: string };

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
 * Time one call and classify the outcome. A refused call (non-2xx) is a
 * concurrency signal; a failed call (network error, or a 2xx without JSON)
 * is a broken endpoint. The ramp needs the difference: a level where every
 * call is refused is a ceiling, a level with failed calls fails the probe.
 */
async function timed(label: string, payload: unknown, account: LlmAccount): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetch(`${account.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    const elapsed = Date.now() - started;
    if (!response.ok) {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} REFUSED`);
      return { kind: "refused", status: response.status };
    }
    const ok = body.includes("{");
    console.log(
      `probe: ${label} — ${elapsed}ms — HTTP ${response.status} ${ok ? "OK" : "NO JSON"}`,
    );
    return ok ? { kind: "ok" } : { kind: "failed", message: "response carried no JSON" };
  } catch (error) {
    const elapsed = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`probe: ${label} — ${elapsed}ms — FAILED: ${message}`);
    return { kind: "failed", message };
  }
}

/** Fire `count` bulk calls at once and classify each outcome. */
async function rampLevel(
  count: number,
  payload: unknown,
  account: LlmAccount,
): Promise<{ ok: number; refused: number; failed: number; ms: number }> {
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: count }, () => timed("ramp", payload, account)),
  );
  return {
    ok: results.filter((result) => result.kind === "ok").length,
    refused: results.filter((result) => result.kind === "refused").length,
    failed: results.filter((result) => result.kind === "failed").length,
    ms: Date.now() - started,
  };
}

/** Safety cap for the doubling ramp: the probe never fires more than 32
 *  concurrent calls per account, even against an endpoint that never
 *  refuses. Overrides the earlier stop-at-4 quota economy (2026-11-07
 *  operator decision: maximal per-account concurrency requested). Worst
 *  case is 2+4+8+16+32 = 62 verified calls per account per probe. */
const RAMP_MAX = 32;

/**
 * Doubling ramp 2 -> 4 -> 8 -> 16 -> 32 (RAMP_MAX): each level fires
 * `level` concurrent verified bulk calls and the walk stops at the first
 * level that is not fully clean, so the ceiling reads as high as the
 * endpoint actually allows.
 * A refused level reads the ceiling below it; a failed call means a
 * broken endpoint, not a ceiling (return 0). The walk never fires a
 * level the previous one ruled out.
 */
async function findConcurrencyCeiling(payload: unknown, account: LlmAccount): Promise<number> {
  for (let level = 2; level <= RAMP_MAX; level *= 2) {
    const result = await rampLevel(level, payload, account);
    console.log(
      `probe: concurrency ${level} — ${result.ok}/${level} ok, ${result.refused} refused, ${result.failed} failed in ${result.ms}ms`,
    );
    if (result.failed > 0) {
      console.log("probe: a ramp call failed — broken endpoint, not a concurrency ceiling");
      return 0;
    }
    if (result.ok < level) {
      console.log(`probe: concurrency ceiling is below ${level}`);
      return level / 2;
    }
  }
  return RAMP_MAX;
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

async function main(): Promise<void> {
  let accounts: LlmAccount[];
  try {
    accounts = [...resolveJudgeConfig(process.env)];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`probe: ${message}`);
    process.exit(1);
  }

  const ceilings: Record<string, number> = {};
  const dead: string[] = [];
  for (const [index, account] of accounts.entries()) {
    const label = `account ${index + 1} (${account.baseUrl})`;
    console.log(`probe: === ${label} ===`);

    const minimal = await timed(
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
      messages: buildBulkMessages(ten, CONFIG.keywords),
      temperature: 0,
      reasoning_effort: CONFIG.reasoningEffort,
      response_format: { type: "json_object" },
    };
    const bulk = await timed(
      `${label} bulk call (10 posts, production prompt shape)`,
      bulkPayload,
      account,
    );
    const again = await timed(`${label} bulk call again (variance check)`, bulkPayload, account);

    const ceiling = await findConcurrencyCeiling(bulkPayload, account);
    // File key = trimmed baseUrl (resolveCeilings trims both sides). Twins
    // sharing a baseUrl share one reading — last write wins; one entry per
    // endpoint is the file's shape.
    ceilings[account.baseUrl.trim()] = ceiling;
    const probe: AccountProbe = {
      position: index + 1,
      label,
      minimal,
      bulk,
      bulkAgain: again,
      ceiling,
    };
    const cause = classifyDead(probe);
    if (cause !== null) {
      dead.push(`${label} — ${cause}`);
    }
    console.log(
      `probe: ${label} — minimal=${minimal.kind} bulk=${bulk.kind} bulkAgain=${again.kind} ceiling=${ceiling}`,
    );
  }

  // Live-only persistence BEFORE the dead gate: this run's readings ARE the
  // whole file — no merge with previous content, no staleness logic (the
  // probe runs dispatch-only, so readings legitimately age for days). A
  // dead account's 0 (broken ramp) floors at 1 in the reader with a
  // warning — the honest signal for a rotten key.
  await writeCeilingsAtomic(ceilings, JUDGE_CEILINGS_PATH);
  console.log(
    `probe: committed ${Object.keys(ceilings).length} ceiling(s) to ${JUDGE_CEILINGS_PATH}`,
  );

  if (dead.length > 0) {
    console.error("probe: DEAD account(s) — failing the gating probe:");
    for (const line of dead) {
      console.error(`probe:   ${line}`);
    }
    process.exit(1);
  }
  console.log("probe: all accounts verified — gating probe passed");
}

await main();
