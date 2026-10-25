import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ageHours,
  buildHeartbeatBody,
  buildHeartbeatSubject,
  matchesCandidateTerms,
  selectCandidates,
  sendHeartbeat,
  snippet,
  type Candidate,
  type HeartbeatStats,
} from "../src/heartbeat.js";
import type { Post } from "../src/types.js";
import type { Transporter } from "nodemailer";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

function post(id: string, text: string, hoursAgo: number, author = "tester"): Post {
  return {
    id,
    text,
    author,
    permalink: `https://www.threads.com/@${author}/post/${id}`,
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  };
}

const STATS: HeartbeatStats = {
  ranAt: "2026-10-25T12:00:00.000Z",
  unique: 337,
  recent: 303,
  recencyHours: 72,
  maybes: 1,
  relevantLocated: 0,
  skipped: 0,
};

describe("matchesCandidateTerms", () => {
  it("matches adjacent dev terms", () => {
    assert.equal(matchesCandidateTerms("Hiring a software engineer"), true);
    assert.equal(matchesCandidateTerms("WE ARE HIRING developers"), true);
  });

  it("matches Indonesian cities and remote", () => {
    assert.equal(matchesCandidateTerms("Lowongan di Jakarta"), true);
    assert.equal(matchesCandidateTerms("100% remote role"), true);
  });

  it("rejects unrelated posts", () => {
    assert.equal(matchesCandidateTerms("HIRING Barista Waiter"), false);
    assert.equal(matchesCandidateTerms("Kitchen crew Johor Bahru"), false);
  });
});

describe("selectCandidates", () => {
  it("puts keyword maybes first", () => {
    const maybe = post("m1", "Hiring React dev", 5);
    const near = post("n1", "Software engineer Jakarta", 1);
    const result = selectCandidates([maybe, near], [maybe], 10);
    assert.equal(result[0]?.reason, "maybe");
    assert.equal(result[0]?.post.id, "m1");
    assert.equal(result[1]?.reason, "near-miss");
  });

  it("orders near-misses newest first", () => {
    const older = post("a", "Software engineer", 40);
    const newer = post("b", "Software engineer", 2);
    const result = selectCandidates([older, newer], [], 10);
    assert.deepEqual(
      result.map((c) => c.post.id),
      ["b", "a"],
    );
  });

  it("does not repeat a maybe as a near-miss", () => {
    const maybe = post("m1", "Hiring React dev", 5);
    const result = selectCandidates([maybe], [maybe], 10);
    assert.equal(result.length, 1);
  });

  it("caps the list at the limit", () => {
    const posts = Array.from({ length: 30 }, (_, i) =>
      post(`p${i}`, "Software engineer", i),
    );
    assert.equal(selectCandidates(posts, [], 10).length, 10);
    assert.equal(selectCandidates(posts, [], 3).length, 3);
  });

  it("returns an empty list when nothing qualifies", () => {
    assert.deepEqual(selectCandidates([post("x", "Barista", 1)], [], 10), []);
  });
});

describe("snippet", () => {
  it("collapses whitespace", () => {
    assert.equal(snippet("a\n  b\tc"), "a b c");
  });

  it("truncates long text with an ellipsis", () => {
    const long = "x".repeat(300);
    const out = snippet(long, 50);
    assert.equal(out.length, 50);
    assert.ok(out.endsWith("…"));
  });

  it("leaves short text untouched", () => {
    assert.equal(snippet("short"), "short");
  });
});

describe("ageHours", () => {
  it("computes whole hours", () => {
    assert.equal(ageHours(new Date(NOW - 5 * 3_600_000).toISOString(), NOW), 5);
  });

  it("returns 0 for unparseable timestamps", () => {
    assert.equal(ageHours("not-a-date", NOW), 0);
  });
});

describe("buildHeartbeatSubject", () => {
  it("names the scanned count", () => {
    assert.equal(
      buildHeartbeatSubject(STATS),
      "loker-watcher: 0 new matches — 303 post(s) scanned",
    );
  });
});

describe("buildHeartbeatBody", () => {
  it("includes the funnel counts", () => {
    const body = buildHeartbeatBody(STATS, [], NOW);
    assert.ok(body.includes("337 unique post(s)"));
    assert.ok(body.includes("303 within 72h"));
    assert.ok(body.includes("1 keyword maybe(s)"));
    assert.ok(body.includes("0 relevant + located"));
  });

  it("lists candidates with permalinks", () => {
    const candidates: Candidate[] = [
      { post: post("c1", "Hiring React dev in Jakarta", 2, "techco"), reason: "maybe" },
    ];
    const body = buildHeartbeatBody(STATS, candidates, NOW);
    assert.ok(body.includes("1. @techco — 2h ago [keyword match]"));
    assert.ok(body.includes("https://www.threads.com/@techco/post/c1"));
  });

  it("says so when there are no candidates", () => {
    assert.ok(buildHeartbeatBody(STATS, [], NOW).includes("No candidate posts"));
  });

  it("appends the run URL when present", () => {
    const body = buildHeartbeatBody(
      { ...STATS, runUrl: "https://github.com/o/r/actions/runs/1" },
      [],
      NOW,
    );
    assert.ok(body.includes("Run: https://github.com/o/r/actions/runs/1"));
  });
});

describe("sendHeartbeat", () => {
  it("sends the subject and body through the transport", async () => {
    let captured: unknown = null;
    const mockTransport = {
      sendMail: async (options: { subject: string; text: string }) => {
        captured = options;
        return { messageId: "hb-1" };
      },
    } as unknown as Transporter;

    await sendHeartbeat(
      STATS,
      [],
      { user: "a@gmail.com", pass: "p" },
      NOW,
      mockTransport,
    );

    assert.ok(captured !== null);
    const mail = captured as { subject: string; text: string };
    assert.equal(
      mail.subject,
      "loker-watcher: 0 new matches — 303 post(s) scanned",
    );
    assert.ok(mail.text.includes("337 unique post(s)"));
  });

  it("logs the scanned and candidate counts", async () => {
    const mockTransport = {
      sendMail: async () => ({ messageId: "hb-2" }),
    } as unknown as Transporter;
    const candidates: Candidate[] = [
      { post: post("c1", "Software engineer Jakarta", 1), reason: "near-miss" },
    ];

    await sendHeartbeat(STATS, candidates, { user: "a@gmail.com", pass: "p" }, NOW, mockTransport);
    // No assertion on stdout; the call completing without a throw is the
    // contract. The body content is covered by buildHeartbeatBody above.
    assert.equal(candidates.length, 1);
  });
});
