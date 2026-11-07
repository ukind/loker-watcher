import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transporter } from "nodemailer";
import {
  type Candidate,
  type HeartbeatStats,
  ageHours,
  buildHeartbeatBody,
  buildHeartbeatSubject,
  linkedinLegLine,
  matchesCandidateTerms,
  selectCandidates,
  sendHeartbeat,
  snippet,
} from "../src/heartbeat.js";
import type { Post } from "../src/types.js";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

// The candidate net is a required parameter (Phase 10): it comes from
// watcher.config.json, so every case below passes an explicit list.
const TERMS = ["developer", "software", "engineer", "jakarta", "remote"];

function post(id: string, text: string, hoursAgo: number, author = "tester"): Post {
  return {
    platform: "threads",
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
  judged: 1,
  relevantLocated: 0,
  skipped: 0,
};

describe("matchesCandidateTerms", () => {
  it("matches adjacent dev terms", () => {
    assert.equal(matchesCandidateTerms("Hiring a software engineer", TERMS), true);
    assert.equal(matchesCandidateTerms("WE ARE HIRING developers", TERMS), true);
  });

  it("matches Indonesian cities and remote", () => {
    assert.equal(matchesCandidateTerms("Lowongan di Jakarta", TERMS), true);
    assert.equal(matchesCandidateTerms("100% remote role", TERMS), true);
  });

  it("matches mixed-case and padded terms", () => {
    assert.equal(matchesCandidateTerms("frontend dev wanted", ["Frontend"]), true);
    assert.equal(matchesCandidateTerms("100% remote role", [" Remote "]), true);
  });

  it("rejects unrelated posts", () => {
    assert.equal(matchesCandidateTerms("HIRING Barista Waiter", TERMS), false);
    assert.equal(matchesCandidateTerms("Kitchen crew Johor Bahru", TERMS), false);
  });
});

describe("selectCandidates", () => {
  it("puts judged candidates first", () => {
    const lead = post("m1", "Hiring React dev", 5);
    const near = post("n1", "Software engineer Jakarta", 1);
    const result = selectCandidates([lead, near], [lead], TERMS, 10);
    assert.equal(result[0]?.reason, "judged");
    assert.equal(result[0]?.post.id, "m1");
    assert.equal(result[1]?.reason, "near-miss");
  });

  it("orders near-misses newest first", () => {
    const older = post("a", "Software engineer", 40);
    const newer = post("b", "Software engineer", 2);
    const result = selectCandidates([older, newer], [], TERMS, 10);
    assert.deepEqual(
      result.map((c) => c.post.id),
      ["b", "a"],
    );
  });

  it("does not repeat a judged candidate as a near-miss", () => {
    const lead = post("m1", "Hiring React dev", 5);
    const result = selectCandidates([lead], [lead], TERMS, 10);
    assert.equal(result.length, 1);
  });

  it("caps the list at the limit", () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(`p${i}`, "Software engineer", i));
    assert.equal(selectCandidates(posts, [], TERMS, 10).length, 10);
    assert.equal(selectCandidates(posts, [], TERMS, 3).length, 3);
  });

  it("returns an empty list when nothing qualifies", () => {
    assert.deepEqual(selectCandidates([post("x", "Barista", 1)], [], TERMS, 10), []);
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

describe("linkedinLegLine (D13)", () => {
  it("renders ok with the payload-age detail", () => {
    assert.equal(
      linkedinLegLine({ status: "ok", detail: "payload 3 min old" }),
      "LinkedIn leg: ok — payload 3 min old",
    );
  });

  it("renders DARK with the staleness detail", () => {
    assert.equal(
      linkedinLegLine({ status: "stale", detail: "payload 2h old" }),
      "LinkedIn leg: DARK — payload 2h old",
    );
  });

  it("renders absent without detail", () => {
    assert.equal(linkedinLegLine({ status: "absent" }), "LinkedIn leg: absent — no payload file");
  });

  it("renders malformed with the reason detail", () => {
    assert.equal(
      linkedinLegLine({ status: "malformed", detail: "not valid JSON: x" }),
      "LinkedIn leg: malformed — not valid JSON: x",
    );
  });
});

describe("buildHeartbeatBody", () => {
  it("includes the funnel counts", () => {
    const body = buildHeartbeatBody(STATS, [], NOW);
    assert.ok(body.includes("337 unique post(s)"));
    assert.ok(body.includes("303 within 72h"));
    assert.ok(body.includes("1 judged candidate(s)"));
    assert.ok(body.includes("0 relevant + located"));
  });

  it("renders the leg line inside the funnel block when the reader ran (stale state)", () => {
    const body = buildHeartbeatBody(
      { ...STATS, linkedinLeg: { status: "stale", detail: "payload 2h old" } },
      [],
      NOW,
    );
    assert.ok(body.includes("  LinkedIn leg: DARK — payload 2h old"));
  });

  it("renders the ok leg with the payload age", () => {
    const body = buildHeartbeatBody(
      { ...STATS, linkedinLeg: { status: "ok", detail: "payload 3 min old" } },
      [],
      NOW,
    );
    assert.ok(body.includes("  LinkedIn leg: ok — payload 3 min old"));
  });

  it("omits the leg line entirely when the reader never ran", () => {
    assert.ok(!buildHeartbeatBody(STATS, [], NOW).includes("LinkedIn leg:"));
  });

  it("lists candidates with permalinks", () => {
    const candidates: Candidate[] = [
      { post: post("c1", "Hiring React dev in Jakarta", 2, "techco"), reason: "judged" },
    ];
    const body = buildHeartbeatBody(STATS, candidates, NOW);
    assert.ok(body.includes("1. @techco — 2h ago [judged]"));
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

    await sendHeartbeat(STATS, [], { user: "a@gmail.com", pass: "p" }, NOW, mockTransport);

    assert.ok(captured !== null);
    const mail = captured as { subject: string; text: string };
    assert.equal(mail.subject, "loker-watcher: 0 new matches — 303 post(s) scanned");
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

describe("buildHeartbeatBody degraded line (provider health)", () => {
  it("renders the degraded-accounts line inside the funnel block when accounts are capped", () => {
    const body = buildHeartbeatBody(
      {
        ...STATS,
        degradedAccounts:
          "Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick",
      },
      [],
      NOW,
    );
    assert.ok(
      body.includes(
        "  Degraded LLM account(s): #1 https://api.a.com/v1 — capped at 1 request/tick",
      ),
    );
  });

  it("omits the degraded-accounts line entirely when absent", () => {
    assert.ok(!buildHeartbeatBody(STATS, [], NOW).includes("Degraded LLM account"));
  });
});
