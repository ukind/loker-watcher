/**
 * Provider health circuit for the LLM judge pool: per-account health marks
 * that survive 10-minute ticks in the committed state/judge-health.json,
 * the in-run outcome ledger the exhaustion alarm renders with real causes,
 * and the outage episode bit.
 *
 * Module boundary (solutions 2026-11-07, verdict pass): a sibling of
 * judge-ceilings.ts — pure resolver, never-throw reader, atomic writer —
 * so judge-rotation.ts keeps its zero-runtime-import identity (the
 * half-open predicate reads plain state fields inlined in the pick; this
 * module is never imported by judge-rotation). The edge points one way at
 * runtime: judge.ts and index.ts import downward from here. The ledger
 * helpers take a STRUCTURAL slice of the rotation state (declared below)
 * rather than importing RotationState, so this module typechecks
 * standalone at HEAD and RotationState satisfies it structurally once
 * Phase 3 lands the fields.
 *
 * Byte-stability doctrine: the envelope carries NO timestamps and NO
 * staleness bound. Marks self-heal — a stale mark costs at most the
 * 1-request probe per tick until the first success clears it — so the
 * file can stay byte-identical on no-op runs, which is what stops every
 * tick from minting a commit. flushHealthIfChanged extends the saveState
 * gate doctrine (src/state.ts:237-254) with the content comparison that
 * gate's input-derived skip cannot express.
 *
 * The writer lives here (not in scripts/) for the exact reason
 * judge-ceilings.ts:16-18 established: its production call sites are
 * index.ts's success tail and main's entry-module catch
 * (src/index.ts:393-406), which no test reaches.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { JUDGE_HEALTH_PATH } from "./config.js";
import type { LlmAccount } from "./judge.js";
import { stateTempPath } from "./state.js";
import type { AccountFailure } from "./types.js";

/** Envelope version; bump on a shape change, keep the reader tolerant. */
export const HEALTH_VERSION = 1;

/**
 * Consecutive hard-failed ticks (terminal 5xx / transport / 401 / 403 —
 * never 429) that cap an account at ceiling 1. judge-rotation.ts keeps a
 * paired local constant for its inlined pick predicate (no import exists
 * by design); the two MUST stay equal.
 */
export const HARD_FAIL_TICKS_TO_CAP = 2;

/**
 * The committed file shape: byte-stable (no timestamps), self-healing
 * (success clears), single-writer (the watch run; the workflow commits).
 */
export interface HealthFile {
  version: number;
  /** trimmed baseUrl -> consecutive hard-failed ticks (>= 2 caps at 1). Healthy accounts are absent. */
  marks: Record<string, number>;
  /** True while an outage alarm has fired and no healthy dispatch has cleared it. */
  outageOpen: boolean;
}

/** One account's LAST dispatch outcome this tick — the ledger's value type. */
export type AccountTickOutcome = { kind: "ok" } | { kind: "hard-failed"; reason: string };

/** Per-account outcomes of one judge run — the flush unit and the payload the exhaustion error carries. */
export interface TickOutcomes {
  /** Account indexes whose last dispatch succeeded (streak resets; the episode clears on any). */
  readonly ok: readonly number[];
  /** Account index -> the recorded real cause of its last hard failure. */
  readonly failed: ReadonlyMap<number, string>;
}

/** What the reader returns: pool-indexed streaks plus the parsed envelope base for the flush. */
export interface HealthRead {
  /** 0-based account index -> hard-failed streak; a missing index is healthy. */
  readonly marks: ReadonlyMap<number, number>;
  /** The parsed envelope, undefined when absent, unreadable, or unusable. */
  readonly file: HealthFile | undefined;
}

/**
 * The structural slice of RotationState the ledger helpers need — declared
 * here so this module never imports judge-rotation (the boundary) and
 * typechecks standalone at HEAD. RotationState satisfies it structurally
 * once Phase 3 lands the fields; the doc at each field site keeps
 * the two in sync.
 */
export interface OutcomeLedgerState {
  readonly accounts: readonly LlmAccount[];
  readonly cooldownUntil: Map<number, number>;
  readonly healthMarks: Map<number, number>;
  readonly probedThisTick: Set<number>;
  readonly outcomeLedger: Map<number, AccountTickOutcome>;
}

/**
 * Resolve the index-keyed streak map for one account pool from the parsed
 * health file (undefined when absent, unreadable, or unusable). Never
 * throws: a marks entry that fails the shape contract drops silently —
 * missing data IS the good state, so there are no per-account floor
 * warnings (the ceilings doctrine inverted: per-account degradation is
 * communicated through the email line). Keys are trimmed before matching
 * because parseLlmAccounts trims baseUrl (src/judge.ts:163-172). Pure.
 */
export function resolveAccountHealth(
  accounts: readonly LlmAccount[],
  parsed: HealthFile | undefined,
): ReadonlyMap<number, number> {
  const byKey = new Map<string, number>();
  if (parsed !== undefined && parsed.marks !== null && typeof parsed.marks === "object") {
    for (const [key, streak] of Object.entries(parsed.marks)) {
      if (typeof streak === "number" && Number.isInteger(streak) && streak >= 1) {
        byKey.set(key.trim(), streak);
      }
    }
  }
  const marks = new Map<number, number>();
  for (const [index, account] of accounts.entries()) {
    const streak = byKey.get(account.baseUrl.trim());
    if (streak !== undefined) marks.set(index, streak);
  }
  return marks;
}

/**
 * Read + resolve the health file for one account pool. Never throws (the
 * degrade doctrine): an absent file is the normal healthy state and reads
 * QUIET; an unreadable, non-object, unknown-version, or malformed-envelope
 * file warns ONCE naming the file and reads as absent. The parsed envelope
 * rides the result (`file`) as the flush's base.
 */
export async function loadAccountHealth(
  accounts: readonly LlmAccount[],
  filePath: string = JUDGE_HEALTH_PATH,
): Promise<HealthRead> {
  let parsed: HealthFile | undefined;
  try {
    const json: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      console.warn(`judge: ${filePath} is not a JSON object — treating as absent`);
    } else {
      const envelope = json as Record<string, unknown>;
      if (envelope.version !== HEALTH_VERSION) {
        console.warn(
          `judge: ${filePath} unknown version ${String(envelope.version)} (expected ${HEALTH_VERSION}) — treating as absent`,
        );
      } else if (
        envelope.marks === null ||
        typeof envelope.marks !== "object" ||
        Array.isArray(envelope.marks)
      ) {
        console.warn(`judge: ${filePath} carries a malformed marks object — treating as absent`);
      } else {
        parsed = {
          version: HEALTH_VERSION,
          marks: envelope.marks as Record<string, number>,
          outageOpen: envelope.outageOpen === true,
        };
      }
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
  }
  return { marks: resolveAccountHealth(accounts, parsed), file: parsed };
}

/**
 * Record one hard-failed dispatch on the in-run ledger — the judge core
 * calls this exactly where attemptIndex and the cause coexist
 * (src/judge.ts:421-483). HTTP 429 is the NON-countable flavor: the
 * cooldown map already carries it into the exhaustion record; never stamp
 * a 429 here.
 */
export function stampFailure(state: OutcomeLedgerState, index: number, reason: string): void {
  state.outcomeLedger.set(index, { kind: "hard-failed", reason });
}

/**
 * Record a successful dispatch: the ledger flips to ok (last outcome
 * wins), the half-open probe slot frees, and an in-run cap clears — the
 * account rejoins at its COMMITTED ceiling for the rest of the tick
 * (research decision 5). In-run maps only: the ceilings map and the FILE
 * are untouched; the flush applies the reset to the file at end of tick.
 */
export function stampSuccess(state: OutcomeLedgerState, index: number): void {
  state.outcomeLedger.set(index, { kind: "ok" });
  state.probedThisTick.delete(index);
  state.healthMarks.delete(index);
}

/**
 * Derive the tick's per-account outcomes from the ledger — the flush unit
 * index.ts persists and the RotationExhausted health payload carries. Last
 * outcome per account wins: failure-then-success reads ok, the reverse
 * reads the failure reason.
 */
export function readTickOutcomes(state: OutcomeLedgerState): TickOutcomes {
  const ok: number[] = [];
  const failed = new Map<number, string>();
  for (const [index, outcome] of state.outcomeLedger) {
    if (outcome.kind === "ok") {
      ok.push(index);
    } else {
      failed.set(index, outcome.reason);
    }
  }
  return { ok, failed };
}

/**
 * Build the exhaustion record in pool order — the unified builder that
 * replaces failuresFromCooldowns (src/judge-rotation.ts:233-251): a
 * hard-failed account carries its recorded real cause; a cooling-only
 * account carries "HTTP 429". Entry existence (not freshness) is the
 * criterion — a freshness filter could empty the record and revive the
 * email-silent path in src/email.ts:181-182. Throw sites fire only when
 * the pick found nothing, so the record is non-empty by construction.
 */
export function buildFailuresFromLedger(state: OutcomeLedgerState): AccountFailure[] {
  const failures: AccountFailure[] = [];
  for (const [index, account] of state.accounts.entries()) {
    const outcome = state.outcomeLedger.get(index);
    if (outcome?.kind === "hard-failed") {
      failures.push({ account: index + 1, baseUrl: account.baseUrl, reason: outcome.reason });
    } else if (state.cooldownUntil.has(index)) {
      failures.push({ account: index + 1, baseUrl: account.baseUrl, reason: "HTTP 429" });
    }
  }
  return failures;
}

/**
 * Merge one tick's outcomes into the envelope (pure): an ok account's
 * streak entry deletes (reset), a hard-failed account's streak increments,
 * an account absent from both maps keeps its streak (a tick where it
 * dispatched nothing — 429-only included — is neither success nor hard
 * failure). Mark keys for accounts no longer in the pool are pruned.
 * `outageOpen` is the caller's episode decision (the flush wrappers own
 * the policy). Returns the next envelope; nothing touches disk.
 */
export function nextHealthFile(
  accounts: readonly LlmAccount[],
  base: HealthFile | undefined,
  outcomes: TickOutcomes,
  outageOpen: boolean,
): HealthFile {
  const poolKeys = new Set(accounts.map((account) => account.baseUrl.trim()));
  const marks: Record<string, number> = {};
  for (const [key, streak] of Object.entries(base?.marks ?? {})) {
    if (poolKeys.has(key) && typeof streak === "number" && streak >= 1) {
      marks[key] = streak;
    }
  }
  for (const index of outcomes.ok) {
    const key = accounts[index]?.baseUrl.trim();
    if (key !== undefined) delete marks[key];
  }
  for (const index of outcomes.failed.keys()) {
    const key = accounts[index]?.baseUrl.trim();
    if (key !== undefined) marks[key] = (marks[key] ?? 0) + 1;
  }
  return { version: HEALTH_VERSION, marks, outageOpen };
}

/**
 * One degraded-accounts line for the digest and the heartbeat: every
 * capped account (streak >= HARD_FAIL_TICKS_TO_CAP), 1-based, with its
 * base URL. undefined when none is capped — the line must be ABSENT from
 * healthy emails, not empty (byte-compatibility with the pre-health
 * fixtures, the LegLine rider shape).
 */
export function buildDegradedAccountsLine(
  accounts: readonly LlmAccount[],
  marks: ReadonlyMap<number, number>,
): string | undefined {
  const capped: string[] = [];
  for (const [index, account] of accounts.entries()) {
    if ((marks.get(index) ?? 0) >= HARD_FAIL_TICKS_TO_CAP) {
      capped.push(`#${index + 1} ${account.baseUrl}`);
    }
  }
  if (capped.length === 0) return undefined;
  return `Degraded LLM account(s): ${capped.join(", ")} — capped at 1 request/tick`;
}

/** Canonical serialization: the semantic-change comparison key (sorted mark keys, so byte-stability does not depend on insertion order). */
function canonicalHealthJson(file: HealthFile): string {
  const marks: Record<string, number> = {};
  for (const key of Object.keys(file.marks).sort()) {
    const streak = file.marks[key];
    if (streak !== undefined) marks[key] = streak;
  }
  return JSON.stringify({ version: file.version, marks, outageOpen: file.outageOpen });
}

/**
 * Write the health envelope atomically (sibling unique temp + rename, the
 * writeStateAtomic shape): a crashed run never leaves a partial file.
 * Throws fail-visible — the flush wrappers own the best-effort policy.
 */
export async function writeHealthAtomic(
  file: HealthFile,
  filePath: string = JUDGE_HEALTH_PATH,
  now: () => number = Date.now,
): Promise<void> {
  const dir = dirname(filePath);
  const tempPath = stateTempPath(dir, now());
  const jsonContent = `${JSON.stringify(file, null, 2)}\n`;
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
    throw new Error(`health: atomic write failed for ${filePath}: ${message}`);
  }
}

/** A parsed value this module's gate can canonicalize: right version, object-shaped marks. */
function isUsableEnvelope(
  value: unknown,
): value is { version: unknown; marks: Record<string, unknown>; outageOpen: unknown } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === HEALTH_VERSION &&
    record.marks !== null &&
    typeof record.marks === "object" &&
    !Array.isArray(record.marks)
  );
}

/**
 * Flush the next envelope ONLY on semantic change: the committed file must
 * stay byte-identical on no-op ticks or every 10-minute run mints a commit.
 * The current file is canonicalized tolerantly — an absent, unreadable, or
 * unusable current file compares as "different" so the write repairs it.
 * Returns true when a write happened. Throws only from writeHealthAtomic.
 */
export async function flushHealthIfChanged(
  next: HealthFile,
  filePath: string = JUDGE_HEALTH_PATH,
): Promise<boolean> {
  let current: string | undefined;
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (isUsableEnvelope(parsed)) {
      current = canonicalHealthJson({
        version: HEALTH_VERSION,
        marks: parsed.marks as Record<string, number>,
        outageOpen: parsed.outageOpen === true,
      });
    }
  } catch {
    // absent or unreadable: nothing comparable — the write proceeds and repairs
  }
  if (current !== undefined && current === canonicalHealthJson(next)) {
    return false;
  }
  await writeHealthAtomic(next, filePath);
  return true;
}

/**
 * Success-path flush: merge the tick's outcomes into the loaded envelope,
 * keep the episode bit open only when it stood AND nothing dispatched ok
 * (an episode ends only on a run with >= 1 healthy dispatch), and write
 * only on semantic change. Best-effort BY CONTRACT: never throws — any
 * fault warns once and returns, so a broken state dir cannot fail an
 * otherwise green run.
 */
export async function flushTickHealth(
  accounts: readonly LlmAccount[],
  base: HealthFile | undefined,
  outcomes: TickOutcomes,
  filePath: string = JUDGE_HEALTH_PATH,
): Promise<void> {
  const outageOpen = (base?.outageOpen ?? false) && outcomes.ok.length === 0;
  try {
    await flushHealthIfChanged(nextHealthFile(accounts, base, outcomes, outageOpen), filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`judge: ${filePath} flush failed — ${message}`);
  }
}

/**
 * Exhaustion-path flush: the failed run's outcomes land with the episode
 * bit OPEN, before process.exit(1) (src/index.ts:393-406). Best-effort by
 * contract (never throws — the catch must not mask the earned exit 1); a
 * failed write warns and the run still exits.
 */
export async function flushExhaustionHealth(
  accounts: readonly LlmAccount[],
  base: HealthFile | undefined,
  outcomes: TickOutcomes,
  filePath: string = JUDGE_HEALTH_PATH,
): Promise<void> {
  try {
    await flushHealthIfChanged(nextHealthFile(accounts, base, outcomes, true), filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`judge: ${filePath} flush failed — ${message}`);
  }
}

/**
 * True when this exhaustion deserves an alarm: the episode bit was NOT
 * already open. Reads the PRE-FLUSH snapshot — the caller flushes (which
 * opens the bit) before alarming, so a post-flush read would suppress
 * every alarm. An undefined file (absent, unreadable, first-ever run)
 * reads as alarm-due: fail-visible — a duplicate alarm costs one email,
 * a suppressed alarm costs the outage.
 */
export function episodeAlarmDue(file: HealthFile | undefined): boolean {
  return file?.outageOpen !== true;
}
