/**
 * The probe's ramp decision machinery (N080): the per-call outcome
 * classifier, the IO probe call, the parallel ramp level, and the doubling
 * ceiling walk — moved out of scripts/probe-judge.ts so they are
 * unit-testable offline (the judge-ceilings.ts precedent: the probe's
 * writer lives in src/ for exactly this reason). fetchFn is a trailing
 * injected parameter (the judge.ts fetchFn idiom) so the offline suite
 * scripts responses; nothing in the ramp path sleeps — a refused level IS
 * the ceiling signal, and the 120s AbortSignal stays verbatim. Phase 4
 * lands the module with ENTRY-ONLY exports (probeFetch,
 * findConcurrencyCeiling, ProbeOutcome — the script's imports); Phase 5's
 * ramp suite adds `export` to classifyResponse, rampLevel, and RAMP_MAX
 * when it starts importing them (knip flags exports with zero importers).
 * classifyResponse owns the N065 success gate: a completion PARSES as JSON
 * and carries a chat-completions "choices" array; anything else is a
 * failed leg.
 */
import type { LlmAccount } from "./judge-account.js";
import { normalizeEndpoint } from "./judge-shared.js";

/** One probe call's classified outcome (verbatim from scripts/probe-judge.ts). */
export type ProbeOutcome =
  | { kind: "ok" }
  | { kind: "refused"; status: number }
  | { kind: "failed"; message: string };

/**
 * N065: classify one probe response. The old gate — a bare substring
 * brace check — matched any brace-carrying text, so a refusal
 * rendered as prose with one brace read OK. A real completion PARSES as
 * JSON and carries a chat-completions "choices" array; anything else is a
 * failed leg (a refusal-as-data body with valid error JSON still fails the
 * choices check).
 */
export function classifyResponse(status: number, body: string): ProbeOutcome {
  if (status < 200 || status >= 300) return { kind: "refused", status };
  try {
    const parsed = JSON.parse(body) as { choices?: unknown };
    if (parsed.choices === undefined) {
      return { kind: "failed", message: "response carried no chat-completions choices" };
    }
    return { kind: "ok" };
  } catch {
    return { kind: "failed", message: "response was not valid JSON" };
  }
}

/**
 * One probe call: fetch + classify, with the per-call attributable log
 * line (every line carries the account label, so interleaved peer output
 * stays attributable). Body verbatim from scripts/probe-judge.ts's timed
 * with fetchFn threaded and the endpoint normalization riding
 * judge-shared's normalizeEndpoint — called BARE: it returns the FULL
 * endpoint URL (the F006 drift-proofing export's documented shape).
 */
export async function probeFetch(
  label: string,
  payload: unknown,
  account: LlmAccount,
  fetchFn: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetchFn(normalizeEndpoint(account.baseUrl), {
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
    const outcome = classifyResponse(response.status, body);
    if (outcome.kind === "refused") {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} REFUSED`);
    } else if (outcome.kind === "failed") {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} NO CHOICES`);
    } else {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} OK`);
    }
    return outcome;
  } catch (error) {
    const elapsed = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`probe: ${label} — ${elapsed}ms — FAILED: ${message}`);
    return { kind: "failed", message };
  }
}

/**
 * Safety cap for the doubling ramp: the probe never fires more than 32
 * concurrent calls per account, even against an endpoint that never
 * refuses. Overrides the earlier stop-at-4 quota economy (2026-11-07
 * operator decision: maximal per-account concurrency requested). Worst
 * case is 2+4+8+16+32 = 62 verified calls per account per probe.
 */
export const RAMP_MAX = 32;

/**
 * Fire `count` bulk calls at once and classify each outcome; each call's
 * label names the account ("<account label> ramp L<count>") so interleaved
 * peer output stays attributable. Body verbatim with probeFetch.
 */
export async function rampLevel(
  count: number,
  payload: unknown,
  account: LlmAccount,
  label: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: number; refused: number; failed: number; ms: number }> {
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: count }, () =>
      probeFetch(`${label} ramp L${count}`, payload, account, fetchFn),
    ),
  );
  return {
    ok: results.filter((result) => result.kind === "ok").length,
    refused: results.filter((result) => result.kind === "refused").length,
    failed: results.filter((result) => result.kind === "failed").length,
    ms: Date.now() - started,
  };
}

/**
 * Doubling ramp 2 -> 4 -> 8 -> 16 -> 32 (RAMP_MAX): each level fires
 * `level` concurrent verified bulk calls and the walk stops at the first
 * level that is not fully clean, so the ceiling reads as high as the
 * endpoint actually allows.
 * A refused level reads the ceiling below it; a failed call means a
 * broken endpoint, not a ceiling (return 0). The walk never fires a
 * level the previous one ruled out.
 */
export async function findConcurrencyCeiling(
  payload: unknown,
  account: LlmAccount,
  label: string,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  for (let level = 2; level <= RAMP_MAX; level *= 2) {
    const result = await rampLevel(level, payload, account, label, fetchFn);
    console.log(
      `probe: ${label} — concurrency ${level} — ${result.ok}/${level} ok, ${result.refused} refused, ${result.failed} failed in ${result.ms}ms`,
    );
    if (result.failed > 0) {
      console.log(
        `probe: ${label} — a ramp call failed — broken endpoint, not a concurrency ceiling`,
      );
      return 0;
    }
    if (result.ok < level) {
      console.log(`probe: ${label} — concurrency ceiling is below ${level}`);
      return level / 2;
    }
  }
  return RAMP_MAX;
}
