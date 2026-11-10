import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import type { Surface } from "../src/config-file.js";
import {
  type EmailConfig,
  buildExhaustionText,
  buildHaltAlarmText,
  buildSurfaceDigest,
  buildSurfaceSubject,
  createSmtpResolver,
  groupMatchesBySurface,
  renderSurface,
  resolveEmailConfig,
  sendExhaustionEmail,
  sendHaltAlarm,
  sendSurfaceDigest,
} from "../src/email.js";
import type { AccountFailure, Post } from "../src/types.js";

describe("renderSurface", () => {
  it("quotes tag and linkedin values and renders url verbatim (D4)", () => {
    assert.equal(renderSurface({ type: "tag", value: "loker" }), `tag: "loker"`);
    assert.equal(
      renderSurface({ type: "linkedin", value: "react indonesia" }),
      `linkedin: "react indonesia"`,
    );
    assert.equal(
      renderSurface({ type: "url", value: "https://www.threads.com/@hiresflow" }),
      "url: https://www.threads.com/@hiresflow",
    );
  });
});

describe("buildSurfaceSubject", () => {
  const tag: Surface = { type: "tag", value: "hiring" };
  const linkedin: Surface = { type: "linkedin", value: "hiring react" };

  it("renders one post singular with the tag surface", () => {
    assert.equal(buildSurfaceSubject(tag, 1), `1 new job post — tag: "hiring"`);
  });

  it("renders several posts plural with the linkedin surface", () => {
    assert.equal(buildSurfaceSubject(linkedin, 3), `3 new job posts — linkedin: "hiring react"`);
  });

  it("renders a url surface as the full URL verbatim (D4)", () => {
    const url: Surface = {
      type: "url",
      value: "https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent",
    };
    assert.equal(
      buildSurfaceSubject(url, 2),
      "2 new job posts — url: https://www.threads.com/search?q=hiring&serp_type=deeplink&filter=recent",
    );
  });

  it("drops the combined subject pin (#hiring indonesia)", () => {
    const subject = buildSurfaceSubject(tag, 5);
    assert.ok(!subject.includes("#hiring indonesia"));
    assert.ok(!subject.includes("on Threads"));
  });
});

describe("buildSurfaceDigest", () => {
  const tag: Surface = { type: "tag", value: "hiring" };
  const threadsPost: Post = {
    platform: "threads",
    id: "101",
    text: "First job post",
    author: "companyA",
    permalink: "https://www.threads.com/@companyA/post/P1",
    timestamp: "2026-10-24T08:00:00.000Z",
  };

  it("returns null for an empty post list", () => {
    assert.equal(buildSurfaceDigest(tag, []), null);
  });

  it("opens with the per-surface subject and renders author + permalink", () => {
    const digest = buildSurfaceDigest(tag, [
      {
        platform: "threads",
        id: "201",
        text: "Looking for a Next.js frontend dev in Jakarta, hybrid...",
        author: "pttechcareers",
        permalink: "https://www.threads.com/@pttechcareers/post/C8H5FiCtESk",
        timestamp: "2026-10-24T08:15:00.000Z",
      },
    ]);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith(`1 new job post — tag: "hiring"\n\n`));
    assert.ok(digest.includes("1. Looking for a Next.js frontend dev in Jakarta, hybrid..."));
    assert.ok(digest.includes("   — @pttechcareers"));
    assert.ok(digest.includes("   https://www.threads.com/@pttechcareers/post/C8H5FiCtESk"));
  });

  it("keeps multi-line captions and sequential numbering intact", () => {
    const digest = buildSurfaceDigest(tag, [
      {
        platform: "threads",
        id: "103",
        text: "HIRING NOW!\n- React\n- TypeScript\nApply via DM",
        author: "recruiter",
        permalink: "https://www.threads.com/@recruiter/post/P3",
        timestamp: "2026-10-24T10:00:00.000Z",
      },
      {
        platform: "threads",
        id: "104",
        text: "Vue dev needed",
        author: "@companyB",
        permalink: "https://www.threads.com/@companyB/post/P4",
        timestamp: "2026-10-24T11:00:00.000Z",
      },
    ]);
    assert.ok(digest !== null);
    assert.ok(
      digest.includes("1. HIRING NOW!\n- React\n- TypeScript\nApply via DM\n   — @recruiter"),
    );
    assert.ok(digest.includes("2. Vue dev needed\n   — @companyB"));
  });

  it("marks only linkedin item lines with the [linkedin] token", () => {
    const digest = buildSurfaceDigest({ type: "linkedin", value: "hiring react" }, [
      {
        platform: "linkedin",
        id: "urn:li:activity:7522028760582447104",
        text: "Second job post",
        author: "sometechguy",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
        timestamp: "2026-10-24T09:00:00.000Z",
      },
    ]);
    assert.ok(digest !== null);
    assert.ok(
      digest.includes(
        "1. [linkedin] Second job post\n   — @sometechguy\n   https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
      ),
    );
  });

  it("renders the leg line only when the leg is not ok (D13)", () => {
    const okDigest = buildSurfaceDigest(tag, [threadsPost], { status: "ok" });
    assert.ok(okDigest !== null);
    assert.ok(!okDigest.includes("LinkedIn leg:"));
    const staleDigest = buildSurfaceDigest(tag, [threadsPost], {
      status: "stale",
      detail: "payload 2h old",
    });
    assert.ok(staleDigest !== null);
    assert.ok(staleDigest.includes("\n\nLinkedIn leg: stale — payload 2h old\n"));
  });

  it("appends the degraded line after the leg line when both riders ride", () => {
    const LINE = "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick";
    const digest = buildSurfaceDigest(
      tag,
      [threadsPost],
      { status: "stale", detail: "payload 2h old" },
      LINE,
    );
    assert.ok(digest !== null);
    assert.ok(digest.endsWith(`${LINE}\n`));
    const legAt = digest.indexOf("LinkedIn leg: stale");
    const degradedAt = digest.indexOf("Degraded LLM");
    assert.ok(legAt >= 0);
    assert.ok(degradedAt > legAt);
  });

  it("keeps the body byte-identical when no rider rides", () => {
    const LINE = "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick";
    const withRider = buildSurfaceDigest(tag, [threadsPost], undefined, LINE);
    const without = buildSurfaceDigest(tag, [threadsPost]);
    assert.ok(withRider !== null && without !== null);
    assert.ok(withRider.startsWith(without));
    assert.ok(!without.includes("Degraded LLM"));
  });
});

describe("groupMatchesBySurface (email-per-surface grouping)", () => {
  const tagHiring: Surface = { type: "tag", value: "hiring" };
  const tagLoker: Surface = { type: "tag", value: "loker" };
  const linkedinReact: Surface = { type: "linkedin", value: "hiring react" };

  const postFor = (id: string, surfaces?: Surface[]): Post => ({
    platform: "threads",
    id,
    text: `post ${id}`,
    author: "author",
    permalink: `https://www.threads.com/@author/post/${id}`,
    timestamp: "2026-10-24T00:00:00.000Z",
    ...(surfaces !== undefined ? { surfaces } : {}),
  });

  it("sends a shared post to every surface that stamped it (FR2)", () => {
    const shared = postFor("1", [tagHiring, linkedinReact]);
    const onlyTag = postFor("2", [tagHiring]);
    const { groups, orphans } = groupMatchesBySurface(
      [shared, onlyTag],
      [tagHiring, linkedinReact],
    );
    assert.deepEqual(
      groups.map((group) => [group.surface, group.posts.map((post) => post.id)]),
      [
        [tagHiring, ["1", "2"]],
        [linkedinReact, ["1"]],
      ],
    );
    assert.deepEqual(orphans, []);
  });

  it("keeps a post once per group even when its stamps list the surface twice (FR5)", () => {
    const stamped = postFor("1", [tagHiring, { type: "tag", value: "hiring" }]);
    const { groups, orphans } = groupMatchesBySurface([stamped], [tagHiring]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.posts.length, 1);
    assert.deepEqual(orphans, []);
  });

  it("collapses duplicate configured surfaces to one group (D7)", () => {
    const stamped = postFor("1", [linkedinReact]);
    const { groups } = groupMatchesBySurface(
      [stamped],
      [linkedinReact, { type: "linkedin", value: "hiring react" }],
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.posts.length, 1);
  });

  it("keeps group order following the surfaces argument (config order, D6)", () => {
    const stamped = postFor("1", [tagLoker, tagHiring]);
    const { groups } = groupMatchesBySurface([stamped], [tagHiring, tagLoker]);
    assert.deepEqual(
      groups.map((group) => group.surface.value),
      ["hiring", "loker"],
    );
  });

  it("returns posts whose stamps name no configured surface as orphans (D3)", () => {
    const orphaned = postFor("1", [{ type: "tag", value: "removed-tag" }]);
    const placed = postFor("2", [tagHiring]);
    const { groups, orphans } = groupMatchesBySurface([orphaned, placed], [tagHiring]);
    assert.deepEqual(
      orphans.map((post) => post.id),
      ["1"],
    );
    assert.deepEqual(
      groups[0]?.posts.map((post) => post.id),
      ["2"],
    );
  });

  it("returns an unstamped post as an orphan (legacy payload rows)", () => {
    const unstamped = postFor("1");
    const { groups, orphans } = groupMatchesBySurface([unstamped], [tagHiring]);
    assert.deepEqual(
      orphans.map((post) => post.id),
      ["1"],
    );
    assert.equal(groups[0]?.posts.length, 0);
  });
});

describe("sendSurfaceDigest", () => {
  const sampleConfig: EmailConfig = {
    user: "alerts@gmail.com",
    pass: "app-password",
    to: "alerts@gmail.com",
  };
  const tag: Surface = { type: "tag", value: "hiring" };
  const samplePosts: Post[] = [
    {
      platform: "threads",
      id: "201",
      text: "Hiring React dev",
      author: "devteam",
      permalink: "https://www.threads.com/@devteam/post/201",
      timestamp: "2026-10-24T00:00:00.000Z",
    },
  ];

  it("does not send email when the surface produced no posts", async () => {
    let called = false;
    const mockTransport = {
      sendMail: async () => {
        called = true;
        return { messageId: "msg-123" };
      },
    } as unknown as Transporter;

    const result = await sendSurfaceDigest(tag, [], sampleConfig, mockTransport);
    assert.equal(result.sent, false);
    assert.equal(result.postCount, 0);
    assert.equal(called, false);
  });

  it("sends one email whose subject names the surface", async () => {
    let capturedOptions: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        capturedOptions = options;
        return { messageId: "msg-456" };
      },
    } as unknown as Transporter;

    const result = await sendSurfaceDigest(tag, samplePosts, sampleConfig, mockTransport);
    assert.equal(result.sent, true);
    assert.equal(result.postCount, 1);
    assert.equal(result.messageId, "msg-456");
    assert.equal(result.recipient, "alerts@gmail.com");

    const mail = capturedOptions as {
      from: string;
      to: string;
      subject: string;
      text: string;
    };
    assert.equal(mail.from, "Loker Watcher <alerts@gmail.com>");
    assert.equal(mail.to, "alerts@gmail.com");
    assert.equal(mail.subject, `1 new job post — tag: "hiring"`);
    assert.ok(mail.text.includes("Hiring React dev"));
  });

  it("logs one per-surface line naming the surface (FR8)", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const mockTransport = {
      sendMail: async () => ({ messageId: "msg-log" }),
    } as unknown as Transporter;

    await sendSurfaceDigest(
      { type: "linkedin", value: "hiring react" },
      samplePosts,
      sampleConfig,
      mockTransport,
    );
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.includes(
        `email: sent digest for linkedin: "hiring react" with 1 post(s) to alerts@gmail.com`,
      ),
    );
  });

  it("uses custom recipient if specified in config", async () => {
    let capturedRecipient = "";
    const mockTransport = {
      sendMail: async (options: unknown) => {
        capturedRecipient = (options as { to: string }).to;
        return { messageId: "msg-789" };
      },
    } as unknown as Transporter;

    const customConfig: EmailConfig = {
      user: "sender@gmail.com",
      pass: "pass",
      to: "recipient@company.com",
    };

    const result = await sendSurfaceDigest(tag, samplePosts, customConfig, mockTransport);
    assert.equal(result.sent, true);
    assert.equal(result.recipient, "recipient@company.com");
    assert.equal(capturedRecipient, "recipient@company.com");
  });

  it("throws fail-visible error when transport fails", async () => {
    const mockTransport = {
      sendMail: async () => {
        throw new Error("SMTP connection timeout");
      },
    } as unknown as Transporter;

    await assert.rejects(
      () => sendSurfaceDigest(tag, samplePosts, sampleConfig, mockTransport),
      /email: failed to send: SMTP connection timeout/,
    );
  });
});

describe("resolveEmailConfig", () => {
  it("resolves valid credentials and trims whitespace", () => {
    const env = {
      GMAIL_USER: "  user@gmail.com  ",
      GMAIL_APP_PASSWORD: "  abcd efgh ijkl mnop  ",
    };
    const config = resolveEmailConfig(env);
    assert.deepEqual(config, {
      user: "user@gmail.com",
      pass: "abcd efgh ijkl mnop",
      to: "user@gmail.com",
    });
  });

  it("throws when GMAIL_USER is missing", () => {
    const env = {
      GMAIL_APP_PASSWORD: "pass",
    };
    assert.throws(
      () => resolveEmailConfig(env),
      /email: missing required environment variables: GMAIL_USER/,
    );
  });

  it("throws when GMAIL_APP_PASSWORD is missing", () => {
    const env = {
      GMAIL_USER: "user@gmail.com",
    };
    assert.throws(
      () => resolveEmailConfig(env),
      /email: missing required environment variables: GMAIL_APP_PASSWORD/,
    );
  });

  it("throws when both credentials are missing", () => {
    assert.throws(
      () => resolveEmailConfig({}),
      /email: missing required environment variables: GMAIL_USER, GMAIL_APP_PASSWORD/,
    );
  });
});

describe("buildExhaustionText", () => {
  it("returns null for an empty failure list", () => {
    assert.equal(buildExhaustionText([]), null);
  });

  it("lists every account with its reason in pool order", () => {
    const text = buildExhaustionText([
      { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
      { account: 2, baseUrl: "https://api.b.com/v1", reason: "socket hang up" },
    ]);
    assert.ok(text?.includes("account 1 (https://api.a.com/v1) — HTTP 429"));
    assert.ok(text?.includes("account 2 (https://api.b.com/v1) — socket hang up"));
    assert.ok(text?.includes("LLM_ACCOUNTS"));
  });
});

describe("buildExhaustionText pool-truthful wording (D9)", () => {
  const failures: AccountFailure[] = [
    { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
    { account: 2, baseUrl: "https://api.b.com/v1", reason: "network error: socket hang up" },
  ];

  it("with poolSize the header reads X of N and survivors render by set-difference", () => {
    const text = buildExhaustionText(failures, 3);
    assert.ok(
      text?.startsWith("The LLM judge pool is exhausted — 2 of 3 LLM_ACCOUNTS accounts failed.\n"),
    );
    assert.ok(text?.includes("1. account 1 (https://api.a.com/v1) — HTTP 429"));
    assert.ok(text?.includes("account 2 (https://api.b.com/v1) — network error: socket hang up"));
    assert.ok(text?.includes("Still working this run: account 3."));
  });

  it("without poolSize the legacy body stands byte-identical (every-account header, no survivors)", () => {
    const text = buildExhaustionText(failures);
    assert.ok(
      text?.startsWith("The LLM judge pool is exhausted — every LLM_ACCOUNTS account failed.\n"),
    );
    assert.ok(!text?.includes("Still working"));
  });

  it("pluralizes the survivors line for multiple never-failed seats", () => {
    const text = buildExhaustionText(
      [{ account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" }],
      3,
    );
    assert.ok(text?.includes("Still working this run: accounts 2, 3."));
  });

  it("an X-of-N pool with no survivors renders no survivors line", () => {
    const text = buildExhaustionText(failures, 2);
    assert.ok(
      text?.startsWith("The LLM judge pool is exhausted — 2 of 2 LLM_ACCOUNTS accounts failed.\n"),
    );
    assert.ok(!text?.includes("Still working"));
  });
});

describe("sendExhaustionEmail", () => {
  const sampleConfig: EmailConfig = {
    user: "alerts@gmail.com",
    pass: "app-password",
    to: "alerts@gmail.com",
  };
  const failures: AccountFailure[] = [
    { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
  ];

  it("sends one alarm naming every failed account", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        captured = options;
        return { messageId: "msg-exh" };
      },
    } as unknown as Transporter;

    const messageId = await sendExhaustionEmail(failures, sampleConfig, mockTransport);
    assert.equal(messageId, "msg-exh");
    const mail = captured as { subject: string; text: string };
    assert.match(mail.subject, /judge pool exhausted/);
    assert.ok(mail.text.includes("account 1 (https://api.a.com/v1) — HTTP 429"));
  });

  it("sends nothing when the failure list is empty", async () => {
    let called = false;
    const mockTransport = {
      sendMail: async () => {
        called = true;
        return { messageId: "msg-x" };
      },
    } as unknown as Transporter;

    const messageId = await sendExhaustionEmail([], sampleConfig, mockTransport);
    assert.equal(messageId, undefined);
    assert.equal(called, false);
  });

  it("throws fail-visible when the transport fails", async () => {
    const mockTransport = {
      sendMail: async () => {
        throw new Error("SMTP connection timeout");
      },
    } as unknown as Transporter;

    await assert.rejects(
      () => sendExhaustionEmail(failures, sampleConfig, mockTransport),
      /email: failed to send: SMTP connection timeout/,
    );
  });

  it("subject reads X of N when poolSize rides", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        captured = options;
        return { messageId: "msg-23" };
      },
    } as unknown as Transporter;

    const midRun: AccountFailure[] = [
      { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 429" },
      { account: 2, baseUrl: "https://api.b.com/v1", reason: "network error: socket hang up" },
    ];
    const messageId = await sendExhaustionEmail(midRun, sampleConfig, mockTransport, 3);
    assert.equal(messageId, "msg-23");
    const mail = captured as { subject: string; text: string };
    assert.equal(mail.subject, "LLM judge pool exhausted (2 of 3 accounts failed)");
    assert.ok(mail.text.includes("Still working this run: account 3."));
  });

  it("legacy subject form stands without poolSize", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        captured = options;
        return { messageId: "msg-2" };
      },
    } as unknown as Transporter;

    const messageId = await sendExhaustionEmail(failures, sampleConfig, mockTransport);
    assert.equal(messageId, "msg-2");
    const mail = captured as { subject: string };
    assert.equal(mail.subject, "LLM judge pool exhausted (1 account failed)");
  });
});

describe("buildExhaustionText health reasons", () => {
  it("renders the health reasons verbatim (HTTP 503, key dead, network error)", () => {
    const text = buildExhaustionText([
      { account: 1, baseUrl: "https://api.a.com/v1", reason: "HTTP 503" },
      { account: 2, baseUrl: "https://api.b.com/v1", reason: "HTTP 401 — key dead" },
      { account: 3, baseUrl: "https://api.c.com/v1", reason: "network error: socket hang up" },
    ]);
    assert.ok(text?.includes("account 1 (https://api.a.com/v1) — HTTP 503"));
    assert.ok(text?.includes("account 2 (https://api.b.com/v1) — HTTP 401 — key dead"));
    assert.ok(text?.includes("account 3 (https://api.c.com/v1) — network error: socket hang up"));
  });
});

describe("createSmtpResolver (the N023 memo)", () => {
  const CONFIG: EmailConfig = { user: "user@gmail.com", pass: "app-password" };

  it("returns the injected transport untouched and never memoizes it", () => {
    const injected = { sendMail: async () => ({}) } as unknown as Transporter;
    const smtp = createSmtpResolver(injected);
    assert.equal(smtp(CONFIG), injected);
    assert.equal(smtp(CONFIG), injected);
  });

  it("constructs once and reuses one transport for the whole run", () => {
    const smtp = createSmtpResolver(undefined);
    const first = smtp(CONFIG);
    assert.equal(smtp(CONFIG), first);
    assert.equal(typeof first.sendMail, "function");
  });
});

describe("halt-latch alarm (design 2026-11-09)", () => {
  it("builds a body that names the latch file, the reason, and the reset command", () => {
    const text = buildHaltAlarmText(
      "HTTP 429 rate limit — LinkedIn told this account to slow down",
    );
    assert.ok(text.includes("HALTED"));
    assert.ok(text.includes("state/linkedin-halt.flag"));
    assert.ok(text.includes("npm run reset-linkedin"));
    assert.ok(text.includes("HTTP 429 rate limit"));
  });

  it("sends a subject naming the remedy through the injected transport", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (o: unknown) => {
        captured = o;
        return { messageId: "m-halt" };
      },
    } as unknown as Transporter;
    const config: EmailConfig = { user: "a@b.c", pass: "pw" };
    const messageId = await sendHaltAlarm("budget spent", config, mockTransport);
    assert.equal(messageId, "m-halt");
    const mail = captured as { subject: string; text: string };
    assert.match(mail.subject, /halted — clear the latch/i);
    assert.ok(mail.text.includes("budget spent"));
  });
});
