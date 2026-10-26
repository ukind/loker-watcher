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
 * fixture set of real captured post texts. It also ramps concurrent bulk
 * calls until the endpoint refuses one: Z.AI publishes no concurrency
 * number (tier-based, dynamically adjusted, higher off-peak), so the
 * ceiling is read by escalating 2 -> 4 -> 8 -> 16.
 *
 * Usage:
 *   LLM_ACCOUNTS='[{"baseUrl":"https://api.example.com/v1","apiKey":"key","model":"model"}]' npx tsx scripts/probe-judge.ts
 * Exits 1 when any call fails, so a dead endpoint fails the step loudly.
 */
import { loadWatcherConfig } from "../src/config-file.js";
import { type LlmAccount, resolveJudgeConfig } from "../src/judge.js";
import type { Post } from "../src/types.js";

// Read once at startup; a missing or malformed file fails the probe loudly.
const CONFIG = await loadWatcherConfig();
const KEYWORDS = CONFIG.keywords;

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
    id: `90000000000000000${index}`,
    author: `probe${index}`,
    permalink: `https://www.threads.com/@probe${index}/post/90000000000000000${index}`,
    timestamp: "2026-10-26T00:00:00.000Z",
    text,
  };
}

/** The production bulk prompt shape: keyword criterion plus id+text pairs. */
function bulkMessages(posts: readonly Post[]): Array<{ role: string; content: string }> {
  const listing = posts
    .map((post) => `id ${post.id} by @${post.author}:\n"${post.text}"`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: `You are an automated evaluation filter for job alerts. A post is relevant when it is a genuine job opening related to at least one of these keywords: ${JSON.stringify(KEYWORDS)}. You also determine whether the position is in Indonesia or remote.`,
    },
    {
      role: "user",
      content: `Judge each Threads post below against the criteria.\n\n${listing}\n\nDetermine two criteria per post:\n1. relevant: true ONLY if the post is a genuine job opening or hiring announcement related to at least one keyword above.\n2. locationOk: true ONLY if the job is located in Indonesia, or explicitly remote.\n\nRespond with ONLY a raw JSON object mapping EACH post id above to its verdict:\n{"<post id>": {"relevant": boolean, "locationOk": boolean}}`,
    },
  ];
}

/** One probe call's classified outcome. */
type ProbeOutcome =
  | { kind: "ok" }
  | { kind: "refused"; status: number }
  | { kind: "failed"; message: string };

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

/**
 * Escalate 2 -> 4 -> 8 -> 16 and stop at the first level where any call
 * fails. Never fires a level the previous one already ruled out, so a low
 * ceiling costs one refused round rather than four. A level with failed
 * calls is a broken endpoint: return 0 so the probe exits nonzero.
 */
async function findConcurrencyCeiling(payload: unknown, account: LlmAccount): Promise<number> {
  for (const level of [2, 4, 8, 16]) {
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
  return 16;
}

async function main(): Promise<void> {
  let account: LlmAccount;
  try {
    const first = resolveJudgeConfig(process.env)[0];
    if (first === undefined) {
      throw new Error("judge: LLM_ACCOUNTS must not be empty");
    }
    account = first;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`probe: ${message}`);
    process.exit(1);
  }

  const minimal = await timed(
    "minimal call (one short message)",
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
    messages: bulkMessages(ten),
    temperature: 0,
    response_format: { type: "json_object" },
  };
  const bulk = await timed("bulk call (10 posts, production prompt shape)", bulkPayload, account);
  const again = await timed("bulk call again (10 posts, variance check)", bulkPayload, account);

  const ceiling = await findConcurrencyCeiling(bulkPayload, account);
  console.log(`probe: recommended JUDGE_CONCURRENCY = ${Math.max(4, ceiling)}`);

  console.log(
    `probe: summary — minimal=${minimal.kind} bulk=${bulk.kind} bulkAgain=${again.kind} ceiling=${ceiling}`,
  );
  if (minimal.kind !== "ok" || bulk.kind !== "ok" || again.kind !== "ok" || ceiling < 1) {
    process.exit(1);
  }
}

await main();
