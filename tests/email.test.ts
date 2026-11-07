import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import {
  type EmailConfig,
  buildDigest,
  buildExhaustionText,
  buildSubject,
  resolveEmailConfig,
  sendDigest,
  sendExhaustionEmail,
} from "../src/email.js";
import type { AccountFailure, Post } from "../src/types.js";

describe("buildSubject", () => {
  it("returns null for empty post array", () => {
    assert.equal(buildSubject([]), null);
  });

  it("formats subject for a single post without plural s", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
    ];
    assert.equal(buildSubject(posts), "1 new job post on Threads (#hiring indonesia)");
  });

  it("formats subject for multiple posts with plural s", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        platform: "threads",
        id: "2",
        text: "Looking for Vue dev",
        author: "startup",
        permalink: "https://www.threads.com/@startup/post/2",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
      {
        platform: "threads",
        id: "3",
        text: "Senior Frontend Lead",
        author: "agency",
        permalink: "https://www.threads.com/@agency/post/3",
        timestamp: "2026-10-24T02:00:00.000Z",
      },
    ];
    assert.equal(buildSubject(posts), "3 new job posts on Threads (#hiring indonesia)");
  });

  it("appends + LinkedIn to the subject only when a linkedin match is present", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        platform: "linkedin",
        id: "urn:li:activity:7522028760582447104",
        text: "Hiring backend engineer, remote",
        author: "sometechguy",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
    ];
    assert.equal(buildSubject(posts), "2 new job posts on Threads + LinkedIn (#hiring indonesia)");
  });

  it("keeps all-Threads subjects free of the + LinkedIn suffix", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "1",
        text: "Hiring React dev",
        author: "techcorp",
        permalink: "https://www.threads.com/@techcorp/post/1",
        timestamp: "2026-10-24T00:00:00.000Z",
      },
      {
        platform: "threads",
        id: "2",
        text: "Looking for Vue dev",
        author: "startup",
        permalink: "https://www.threads.com/@startup/post/2",
        timestamp: "2026-10-24T01:00:00.000Z",
      },
      {
        platform: "threads",
        id: "3",
        text: "Senior Frontend Lead",
        author: "agency",
        permalink: "https://www.threads.com/@agency/post/3",
        timestamp: "2026-10-24T02:00:00.000Z",
      },
    ];
    const subject = buildSubject(posts);
    assert.equal(subject, "3 new job posts on Threads (#hiring indonesia)");
    assert.ok(!subject?.includes("+ LinkedIn"));
  });
});

describe("buildDigest", () => {
  it("returns null for empty post list", () => {
    assert.equal(buildDigest([]), null);
  });

  it("formats single post digest with author and permalink", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "101",
        text: "Looking for a Next.js frontend dev in Jakarta, hybrid...",
        author: "pttechcareers",
        permalink: "https://www.threads.com/@pttechcareers/post/C8H5FiCtESk",
        timestamp: "2026-10-24T08:15:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith("1 new job post on Threads (#hiring indonesia)\n\n"));
    assert.ok(digest.includes("1. Looking for a Next.js frontend dev in Jakarta, hybrid..."));
    assert.ok(digest.includes("   — @pttechcareers"));
    assert.ok(digest.includes("   https://www.threads.com/@pttechcareers/post/C8H5FiCtESk"));
  });

  it("formats multi-post digest with sequential numbers and double spacing", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "101",
        text: "First job post",
        author: "companyA",
        permalink: "https://www.threads.com/@companyA/post/P1",
        timestamp: "2026-10-24T08:00:00.000Z",
      },
      {
        platform: "threads",
        id: "102",
        text: "Second job post",
        author: "@companyB",
        permalink: "https://www.threads.com/@companyB/post/P2",
        timestamp: "2026-10-24T09:00:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith("2 new job posts on Threads (#hiring indonesia)\n\n"));
    assert.ok(
      digest.includes(
        "1. First job post\n   — @companyA\n   https://www.threads.com/@companyA/post/P1",
      ),
    );
    assert.ok(
      digest.includes(
        "2. Second job post\n   — @companyB\n   https://www.threads.com/@companyB/post/P2",
      ),
    );
  });

  it("preserves multi-line captions without breaking post structure", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "103",
        text: "HIRING NOW!\n- React\n- TypeScript\nApply via DM",
        author: "recruiter",
        permalink: "https://www.threads.com/@recruiter/post/P3",
        timestamp: "2026-10-24T10:00:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(
      digest.includes("1. HIRING NOW!\n- React\n- TypeScript\nApply via DM\n   — @recruiter"),
    );
  });

  it("marks only the linkedin item lines with the [linkedin] token", () => {
    const posts: Post[] = [
      {
        platform: "threads",
        id: "101",
        text: "First job post",
        author: "companyA",
        permalink: "https://www.threads.com/@companyA/post/P1",
        timestamp: "2026-10-24T08:00:00.000Z",
      },
      {
        platform: "linkedin",
        id: "urn:li:activity:7522028760582447104",
        text: "Second job post",
        author: "sometechguy",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
        timestamp: "2026-10-24T09:00:00.000Z",
      },
    ];

    const digest = buildDigest(posts);
    assert.ok(digest !== null);
    assert.ok(digest.startsWith("2 new job posts on Threads + LinkedIn (#hiring indonesia)\n\n"));
    assert.ok(
      digest.includes(
        "1. First job post\n   — @companyA\n   https://www.threads.com/@companyA/post/P1",
      ),
    );
    assert.ok(
      digest.includes(
        "2. [linkedin] Second job post\n   — @sometechguy\n   https://www.linkedin.com/feed/update/urn:li:activity:7522028760582447104",
      ),
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

describe("sendDigest", () => {
  const sampleConfig: EmailConfig = {
    user: "alerts@gmail.com",
    pass: "app-password",
    to: "alerts@gmail.com",
  };

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

  it("does not send email when posts array is empty (FRD #8)", async () => {
    let called = false;
    const mockTransport = {
      sendMail: async () => {
        called = true;
        return { messageId: "msg-123" };
      },
    } as unknown as Transporter;

    const result = await sendDigest([], sampleConfig, mockTransport);
    assert.equal(result.sent, false);
    assert.equal(result.postCount, 0);
    assert.equal(called, false);
  });

  it("sends digest when new posts match", async () => {
    let capturedOptions: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        capturedOptions = options;
        return { messageId: "msg-456" };
      },
    } as unknown as Transporter;

    const result = await sendDigest(samplePosts, sampleConfig, mockTransport);
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
    assert.equal(mail.subject, "1 new job post on Threads (#hiring indonesia)");
    assert.ok(mail.text.includes("Hiring React dev"));
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

    const result = await sendDigest(samplePosts, customConfig, mockTransport);
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
      () => sendDigest(samplePosts, sampleConfig, mockTransport),
      /email: failed to send: SMTP connection timeout/,
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
});

describe("buildDigest degraded line (provider health)", () => {
  const posts: Post[] = [
    {
      platform: "threads",
      id: "301",
      text: "Hiring React dev",
      author: "devteam",
      permalink: "https://www.threads.com/@devteam/post/301",
      timestamp: "2026-10-24T00:00:00.000Z",
    },
  ];
  const LINE = "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick";

  it("renders the degraded line after the items when provided", () => {
    const digest = buildDigest(posts, undefined, LINE);
    assert.ok(digest !== null);
    assert.ok(digest.includes(`\n\n${LINE}\n`));
    assert.ok(digest.endsWith(`${LINE}\n`));
  });

  it("keeps the body byte-identical when the line is absent", () => {
    const withRider = buildDigest(posts, undefined, LINE);
    const without = buildDigest(posts);
    assert.ok(withRider !== null && without !== null);
    assert.equal(withRider.startsWith(without), true);
    assert.ok(!without.includes("Degraded LLM"));
  });

  it("still renders the leg line when both riders ride (leg first, degraded last)", () => {
    const digest = buildDigest(posts, { status: "stale", detail: "payload 2h old" }, LINE);
    assert.ok(digest !== null);
    const legAt = digest.indexOf("LinkedIn leg: stale");
    const degradedAt = digest.indexOf("Degraded LLM");
    assert.ok(legAt >= 0);
    assert.ok(degradedAt > legAt);
  });
});

describe("sendDigest degraded pass-through", () => {
  const sampleConfig: EmailConfig = {
    user: "alerts@gmail.com",
    pass: "app-password",
    to: "alerts@gmail.com",
  };
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

  it("passes the degraded line into the rendered body", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: unknown) => {
        captured = options;
        return { messageId: "msg-d1" };
      },
    } as unknown as Transporter;

    await sendDigest(
      samplePosts,
      sampleConfig,
      mockTransport,
      undefined,
      "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick",
    );
    const mail = captured as { text: string };
    assert.ok(mail.text.includes("Degraded LLM account(s)"));
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
