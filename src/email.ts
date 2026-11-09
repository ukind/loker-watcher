/**
 * Gmail plain-text notification senders (FRD #7, #8; email-per-surface):
 * one plain-text digest email per configured surface that produced
 * matches (D6), dispatched via Gmail SMTP using nodemailer, plus the
 * exhaustion and leg-dead alarms. A surface with zero matches sends no
 * email.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { Surface } from "./config-file.js";
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

// --- replaces the old combined subject builder ---
/**
 * Render one surface for subjects, logs, and orphan warnings (D4): tag
 * and linkedin render as `type: "value"`; a url surface renders its full
 * URL verbatim — zero ambiguity over short subjects.
 */
export function renderSurface(surface: Surface): string {
  if (surface.type === "url") return `url: ${surface.value}`;
  return `${surface.type}: "${surface.value}"`;
}

/**
 * Per-surface digest subject (D4): `3 new job posts — tag: "hiring"`. The
 * old combined subject pin is gone — each subject names the one surface
 * the email is about.
 */
export function buildSurfaceSubject(surface: Surface, postCount: number): string {
  const plural = postCount === 1 ? "" : "s";
  return `${postCount} new job post${plural} — ${renderSurface(surface)}`;
}

/** One surface share of the matches (email-per-surface, D6). */
export interface SurfaceGroup {
  surface: Surface;
  posts: Post[];
}

/**
 * Group matches per configured surface, in the same order as the
 * surfaces argument (D6). A post rides every group whose surface appears
 * in its stamps (FR2) — once per group, never twice (FR5; a surface
 * listed twice on one post still places it once). Duplicate configured
 * surfaces collapse to one group (D7). Posts whose stamps name no
 * configured surface — and unstamped posts — return as orphans: the
 * caller warns and skips them (D3: the stamps left the config, the
 * posts belong to no email).
 */
export function groupMatchesBySurface(
  matches: readonly Post[],
  surfaces: readonly Surface[],
): { groups: SurfaceGroup[]; orphans: Post[] } {
  const groups: SurfaceGroup[] = [];
  const seen = new Set<string>();
  for (const surface of surfaces) {
    const key = `${surface.type}|${surface.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({ surface, posts: [] });
  }
  const orphans: Post[] = [];
  for (const post of matches) {
    let placed = false;
    for (const group of groups) {
      const stamped = (post.surfaces ?? []).some(
        (stamp) => stamp.type === group.surface.type && stamp.value === group.surface.value,
      );
      if (stamped) {
        group.posts.push(post);
        placed = true;
      }
    }
    if (!placed) orphans.push(post);
  }
  return { groups, orphans };
}

// --- replaces the old combined body builder (legDetailSuffix keeps its place below) ---
/**
 * Per-surface digest body (email-per-surface). Same item rendering and
 * rider lines as the retired combined digest — only the subject line is
 * per-surface now. The LinkedIn leg line (D13) rides ONLY when the leg
 * is not ok; the degraded-accounts line rides ONLY when some account is
 * capped. Returns null when the post list is empty.
 */
export function buildSurfaceDigest(
  surface: Surface,
  posts: readonly Post[],
  leg?: LegLine,
  degradedAccounts?: string,
): string | null {
  if (posts.length === 0) return null;
  const subject = buildSurfaceSubject(surface, posts.length);
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

// --- replaces the old combined sender (after sendText) ---
/**
 * Send one surface digest email via nodemailer (email-per-surface, D6).
 * Gated: returns { sent: false, postCount: 0 } when the surface produced
 * no posts. Throws when nodemailer fails to deliver (sendText wraps the
 * transport error) — the notify loop is all-or-nothing before persist
 * (FR7).
 */
export async function sendSurfaceDigest(
  surface: Surface,
  posts: readonly Post[],
  config: EmailConfig,
  transport?: Transporter,
  leg?: LegLine,
  degradedAccounts?: string,
): Promise<SendDigestResult> {
  const text = buildSurfaceDigest(surface, posts, leg, degradedAccounts);
  if (text === null) {
    return {
      sent: false,
      postCount: 0,
    };
  }

  const subject = buildSurfaceSubject(surface, posts.length);
  const messageId = await sendText(subject, text, config, transport);
  const recipient = config.to ?? config.user;
  console.log(
    `email: sent digest for ${renderSurface(surface)} with ${posts.length} post(s) to ${recipient}`,
  );

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
