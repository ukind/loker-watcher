/**
 * Gmail plain-text digest notification sender (FRD #7, #8).
 *
 * Formats new relevant job posts into a clean plain-text email digest
 * and dispatches it via Gmail SMTP using nodemailer.
 * Gated by post count: sends no email when candidate matches are zero (FRD #8).
 */
import nodemailer, { type Transporter } from "nodemailer";
import { ENV_NAMES } from "./config.js";
import type { LegLine } from "./linkedin-payload.js";
import type { AccountFailure, Post } from "./types.js";

export interface EmailConfig {
  user: string;
  pass: string;
  to?: string;
}

export interface SendDigestResult {
  sent: boolean;
  messageId?: string;
  recipient?: string;
  postCount: number;
}

/**
 * Resolve email credentials from an environment record.
 * Throws when mandatory credentials are missing or empty.
 */
export function resolveEmailConfig(
  env: Record<string, string | undefined> = process.env,
): EmailConfig {
  const user = env[ENV_NAMES.gmailUser]?.trim();
  const pass = env[ENV_NAMES.gmailAppPassword]?.trim();

  const missing: string[] = [];
  if (!user) missing.push(ENV_NAMES.gmailUser);
  if (!pass) missing.push(ENV_NAMES.gmailAppPassword);

  if (missing.length > 0) {
    throw new Error(`email: missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    user: user!,
    pass: pass!,
    to: user!,
  };
}

/**
 * Build the digest email subject line.
 * Returns null when posts array is empty.
 */
export function buildSubject(posts: readonly Post[]): string | null {
  if (posts.length === 0) return null;
  const count = posts.length;
  const plural = count === 1 ? "" : "s";
  // D10: the suffix rides only when at least one LinkedIn match is present;
  // an all-Threads subject stays byte-identical to the pre-LinkedIn pin.
  const suffix = posts.some((post) => post.platform !== "threads") ? " + LinkedIn" : "";

  return `${count} new job post${plural} on Threads${suffix} (#hiring indonesia)`;
}

/**
 * Build plain-text digest body (FRD #7, UX non-functional requirement).
 * Returns null when posts array is empty.
 *
 * The LinkedIn leg line (D13): rides the body ONLY when the leg state is
 * not ok — an ok leg is the quiet default, and sendDigest renders the
 * line only then; undefined omits it entirely. The ` — detail` suffix
 * rides the legDetailSuffix helper.
 *
 * The degraded-accounts line (provider health): the pre-rendered string
 * from judge-health's buildDegradedAccountsLine rides ONLY when some
 * account is capped — absent from healthy emails, never empty (byte
 * compatibility with the pre-health fixtures).
 */
export function buildDigest(
  posts: readonly Post[],
  leg?: LegLine,
  degradedAccounts?: string,
): string | null {
  const subject = buildSubject(posts);
  if (subject === null) return null;

  const items = posts.map((post, index) => {
    const author = post.author.replace(/^@+/, "");
    const platformToken = post.platform === "threads" ? "" : "[linkedin] ";
    return `${index + 1}. ${platformToken}${post.text}\n   — @${author}\n   ${post.permalink}`;
  });

  const legLine =
    leg !== undefined && leg.status !== "ok"
      ? `\n\nLinkedIn leg: ${leg.status}${legDetailSuffix(leg)}`
      : "";
  const degradedLine =
    degradedAccounts !== undefined && degradedAccounts !== "" ? `\n\n${degradedAccounts}` : "";
  return `${subject}\n\n${items.join("\n\n")}${legLine}${degradedLine}\n`;
}

/** The ` — detail` suffix for a leg line; empty when no detail rides. */
function legDetailSuffix(leg: LegLine): string {
  return leg.detail !== undefined && leg.detail !== "" ? ` — ${leg.detail}` : "";
}

/**
 * Send one plain-text email through the Gmail transport.
 *
 * Shared by the digest (Phase 6) and the heartbeat (Phase 9) so both paths
 * resolve credentials once and fail the same way. Returns the message id
 * when the transport reports one.
 */
export async function sendText(
  subject: string,
  text: string,
  config: EmailConfig,
  transport?: Transporter,
): Promise<string | undefined> {
  const recipient = config.to ?? config.user;
  const mailer =
    transport ??
    nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

  try {
    const info = await mailer.sendMail({
      from: `Loker Watcher <${config.user}>`,
      to: recipient,
      subject,
      text,
    });
    return typeof info?.messageId === "string" ? info.messageId : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`email: failed to send: ${message}`);
  }
}

/**
 * Send a digest email for new matched posts via nodemailer (FRD #7, #8).
 *
 * Gated: returns { sent: false, postCount: 0 } immediately when posts is empty.
 * Accepts an optional custom Transporter instance for unit testing.
 * Throws when nodemailer fails to deliver, ensuring fail-visible execution.
 */
export async function sendDigest(
  posts: readonly Post[],
  config: EmailConfig,
  transport?: Transporter,
  leg?: LegLine,
  degradedAccounts?: string,
): Promise<SendDigestResult> {
  if (posts.length === 0) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const subject = buildSubject(posts);
  const text = buildDigest(posts, leg, degradedAccounts);
  if (subject === null || text === null) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const messageId = await sendText(subject, text, config, transport);
  const recipient = config.to ?? config.user;
  console.log(`email: sent digest with ${posts.length} post(s) to ${recipient}`);

  return {
    sent: true,
    ...(messageId !== undefined ? { messageId } : {}),
    recipient,
    postCount: posts.length,
  };
}

/**
 * Build the plain-text body for the judge-pool exhaustion alarm.
 * Lists every account with its recorded failure, in pool order. Returns
 * null when the failure list is empty (no alarm to send).
 *
 * With poolSize the header is pool-truthful — "X of N LLM_ACCOUNTS
 * accounts failed" — and the pool seats that never entered the record
 * render as one "Still working" line, computed by set-difference against
 * the 1-based pool positions (the builder sees only failures, not the
 * account list, so survivors render as numbers). Without poolSize the
 * legacy body stands byte-identical.
 */
export function buildExhaustionText(
  failures: readonly AccountFailure[],
  poolSize?: number,
): string | null {
  if (failures.length === 0) return null;
  const lines = failures.map(
    (failure, index) =>
      `${index + 1}. account ${failure.account} (${failure.baseUrl}) — ${failure.reason}`,
  );
  const header =
    poolSize === undefined
      ? "The LLM judge pool is exhausted — every LLM_ACCOUNTS account failed."
      : `The LLM judge pool is exhausted — ${failures.length} of ${poolSize} LLM_ACCOUNTS accounts failed.`;
  const parts: string[] = [header, "", ...lines];
  if (poolSize !== undefined) {
    const failed = new Set(failures.map((failure) => failure.account));
    const survivors: number[] = [];
    for (let seat = 1; seat <= poolSize; seat += 1) {
      if (!failed.has(seat)) survivors.push(seat);
    }
    if (survivors.length > 0) {
      const label =
        survivors.length === 1 ? `account ${survivors[0]!}` : `accounts ${survivors.join(", ")}`;
      parts.push("", `Still working this run: ${label}.`);
    }
  }
  parts.push(
    "",
    "No digest was sent and no posts were marked seen; they retry next run.",
    "Add a working account to the LLM_ACCOUNTS secret and re-run.",
  );
  return parts.join("\n");
}

/**
 * Send the judge-pool exhaustion alarm through the same Gmail transport as
 * the digest. Returns the message id when the transport reports one, or
 * undefined when there is nothing to send. Throws fail-visible when
 * nodemailer fails to deliver (sendText wraps the transport error).
 * With poolSize the subject reads "LLM judge pool exhausted (X of N
 * accounts failed)" — the /judge pool exhausted/ pin fragment survives;
 * without it the legacy count-only subject stands.
 */
export async function sendExhaustionEmail(
  failures: readonly AccountFailure[],
  config: EmailConfig,
  transport?: Transporter,
  poolSize?: number,
): Promise<string | undefined> {
  const text = buildExhaustionText(failures, poolSize);
  if (text === null) return undefined;
  const counts =
    poolSize === undefined
      ? `${failures.length} account${failures.length === 1 ? "" : "s"} failed`
      : `${failures.length} of ${poolSize} accounts failed`;
  const subject = `LLM judge pool exhausted (${counts})`;
  const messageId = await sendText(subject, text, config, transport);
  console.log(`email: sent exhaustion alarm for ${failures.length} account(s)`);
  return messageId;
}

/**
 * Build the plain-text body for the LinkedIn leg-dead alarm (design D7).
 * One email per episode, sent by the PC fetch leg (the fault's origin);
 * the hosted run never sends it. The body names the remedy — the cookie
 * file refresh — so the operator can act without opening the docs.
 */
export function buildLegDeadAlarmText(reason: string): string {
  return [
    "The LinkedIn fetch leg is dead.",
    "",
    `Signature: ${reason}`,
    "",
    "The loop keeps running. Refresh the cookie file (LINKEDIN_COOKIES_FILE —",
    "re-export the pair from a logged-in browser) and the next tick heals;",
    "no restart needed. Failure matrix: DOCUMENTATION.md §13; session: §14.",
  ].join("\n");
}

/**
 * Send the leg-dead alarm through the same Gmail transport as the digest.
 * The PC loop caller owns the best-effort try/catch policy — a broken
 * GMAIL_* configuration must not mask the exit code the tick earned.
 */
export async function sendLegDeadAlarm(
  reason: string,
  config: EmailConfig,
  transport?: Transporter,
): Promise<string | undefined> {
  const messageId = await sendText(
    "LinkedIn fetch leg is dead — refresh the cookie file",
    buildLegDeadAlarmText(reason),
    config,
    transport,
  );
  console.log("email: sent leg-dead alarm");
  return messageId;
}
