/**
 * Offline suite for the Linked API SDK fetcher. The client seam is a plain
 * object, so nothing here touches the network or loads @linkedapi/node.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type LinkedApiClientLike,
  type LinkedInApiTokens,
  type LinkedInSearchResultItem,
  fetchLinkedInPosts,
  mapLinkedInSearchResult,
  resolveLinkedApiTokens,
} from "../src/fetch-linkedin-api.js";

const TOKENS: LinkedInApiTokens = {
  linkedApiToken: "test-linked-api-token",
  identificationToken: "test-identification-token",
};

const SURFACE = { type: "linkedin", value: "#hiring react" } as const;

/** One SDK-shaped result item; every field optional, fill what the case needs. */
function resultItem(overrides: Partial<LinkedInSearchResultItem> = {}): LinkedInSearchResultItem {
  return {
    url: "https://www.linkedin.com/feed/update/urn:li:activity:7440011668937568257",
    activityUrn: "urn:li:activity:7440011668937568257",
    time: "2026-11-01T08:15:00Z",
    author: { name: "Example Person" },
    text: "Hiring a frontend developer in Jakarta",
    ...overrides,
  };
}

interface ExecuteParamsRecord {
  term: string;
  limit: number;
  filter: { sort: string; datePosted: string };
}

interface StubClientOptions {
  executeResult?: {
    workflowId?: string;
    pendingReason?: string | null;
    message?: string | null;
  };
  executeError?: unknown;
  data?: LinkedInSearchResultItem[] | null;
  errors?: { type: string; message: string }[] | null;
}

/** Build a recording double over the module's structural seam. */
function stubClient(options: StubClientOptions = {}): {
  client: LinkedApiClientLike;
  executeTerms: string[];
  executeParams: ExecuteParamsRecord[];
  resultCalls: string[];
} {
  const executeTerms: string[] = [];
  const executeParams: ExecuteParamsRecord[] = [];
  const resultCalls: string[] = [];
  const client: LinkedApiClientLike = {
    searchPosts: {
      execute: async (params) => {
        if (options.executeError !== undefined) throw options.executeError;
        executeTerms.push(params.term);
        executeParams.push({
          term: params.term,
          limit: params.limit,
          filter: { sort: params.filter.sort, datePosted: params.filter.datePosted },
        });
        const pending = options.executeResult?.pendingReason;
        return {
          workflowId: options.executeResult?.workflowId ?? "wf-1",
          workflowStatus: pending === undefined ? "running" : "pending",
          ...(pending === undefined ? {} : { pendingReason: pending }),
          ...(options.executeResult?.message === undefined
            ? {}
            : { message: options.executeResult.message }),
        };
      },
      result: async (workflowId) => {
        resultCalls.push(workflowId);
        return { data: options.data ?? null, errors: options.errors ?? null };
      },
    },
  };
  return { client, executeTerms, executeParams, resultCalls };
}

describe("resolveLinkedApiTokens", () => {
  it("returns both tokens when both env vars are set", () => {
    const tokens = resolveLinkedApiTokens({
      LINKED_API_TOKEN: "a-token",
      LINKED_API_IDENTIFICATION_TOKEN: "an-id-token",
    });
    assert.deepEqual(tokens, {
      linkedApiToken: "a-token",
      identificationToken: "an-id-token",
    });
  });

  it("returns null silently when either token is unset or blank", (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    assert.equal(resolveLinkedApiTokens({}), null);
    assert.equal(resolveLinkedApiTokens({ LINKED_API_TOKEN: "a" }), null);
    assert.equal(
      resolveLinkedApiTokens({ LINKED_API_TOKEN: "a", LINKED_API_IDENTIFICATION_TOKEN: "  " }),
      null,
    );
    assert.equal(warns.mock.calls.length, 0, "the resolver is silent; the caller owns the warn");
  });
});

describe("mapLinkedInSearchResult", () => {
  it("maps a full result item to a Post", () => {
    const post = mapLinkedInSearchResult(resultItem());
    assert.deepEqual(post, {
      platform: "linkedin",
      id: "urn:li:activity:7440011668937568257",
      text: "Hiring a frontend developer in Jakarta",
      author: "Example Person",
      permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7440011668937568257",
      timestamp: "2026-11-01T08:15:00.000Z",
    });
  });

  it("falls back to the urn inside url when activityUrn is null", () => {
    const post = mapLinkedInSearchResult(resultItem({ activityUrn: null }));
    assert.equal(post?.id, "urn:li:activity:7440011668937568257");
  });

  it("uses repostText when text is absent", () => {
    const post = mapLinkedInSearchResult(resultItem({ text: null, repostText: "Repost note" }));
    assert.equal(post?.text, "Repost note");
  });

  it("returns null when a required fact is missing", () => {
    assert.equal(mapLinkedInSearchResult(resultItem({ url: null })), null);
    assert.equal(
      mapLinkedInSearchResult(resultItem({ activityUrn: null, url: "https://x" })),
      null,
    );
    assert.equal(mapLinkedInSearchResult(resultItem({ text: null, repostText: null })), null);
    assert.equal(mapLinkedInSearchResult(resultItem({ author: null })), null);
    assert.equal(mapLinkedInSearchResult(resultItem({ author: { name: null } })), null);
  });

  it("drops an unparseable timestamp instead of throwing", () => {
    assert.equal(mapLinkedInSearchResult(resultItem({ time: "not-a-date" })), null);
    assert.equal(mapLinkedInSearchResult(resultItem({ time: null })), null);
  });
});

describe("fetchLinkedInPosts", () => {
  it("maps results in SDK order and dedupes re-mints by id", async () => {
    const first = resultItem();
    const dupe = resultItem({ text: "same urn, different text" });
    const second = resultItem({
      activityUrn: "urn:li:activity:7440011668937568258",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7440011668937568258",
      time: "2026-11-01T09:30:00Z",
    });
    const { client } = stubClient({ data: [first, dupe, second] });
    const posts = await fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client));
    assert.deepEqual(
      posts.map((post) => post.id),
      ["urn:li:activity:7440011668937568257", "urn:li:activity:7440011668937568258"],
    );
  });

  it("treats an empty result as success: [] plus an OK 0-post log", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const { client } = stubClient({ data: [] });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client));
    assert.deepEqual(value, []);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("OK — 0 post(s)")));
  });

  it("warns and skips every surface whose execute() throws — the loop continues", async (t) => {
    // One client per run (one Linked API instance per account): a thrown
    // request-level error degrades BOTH surfaces, neither stops the loop.
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const failing = stubClient({
      executeError: Object.assign(new Error("The provided token is invalid"), {
        type: "invalidLinkedApiToken",
      }),
    });
    const second = { type: "linkedin", value: "#hiring" } as const;
    const value = await fetchLinkedInPosts([SURFACE, second], TOKENS, () =>
      Promise.resolve(failing.client),
    );
    assert.deepEqual(value, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    const failed = lines.filter((line) =>
      line.includes("FAILED — invalidLinkedApiToken: The provided token is invalid"),
    );
    assert.equal(failed.length, 2, "both surfaces warn with the typed cause");
  });

  it("delivers posts from a healthy surface alongside a failing one", async (t) => {
    // The seam varies behavior per execute() call (stateful double): the
    // first call throws, the second returns data — the run keeps the second
    // surface's posts.
    const calls: Array<{ type: string; message: string } | null> = [
      { type: "searchingNotAllowed", message: "LinkedIn has blocked performing the search." },
      null,
    ];
    let call = 0;
    const client: LinkedApiClientLike = {
      searchPosts: {
        execute: async () => {
          // noUncheckedIndexedAccess: index reads add undefined — normalize
          // to the T|null the guard checks (extract.ts match[1] ?? "" idiom).
          const failure: { type: string; message: string } | null = calls[call] ?? null;
          call += 1;
          if (failure !== null) {
            throw Object.assign(new Error(failure.message), { type: failure.type });
          }
          return {
            workflowId: "wf-2",
            workflowStatus: "running",
          };
        },
        result: async () => ({
          data: [resultItem({ activityUrn: "urn:li:activity:111", url: "https://u/111" })],
          errors: null,
        }),
      },
    };
    const healthy = { type: "linkedin", value: "#hiring" } as const;
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const value = await fetchLinkedInPosts([SURFACE, healthy], TOKENS, () =>
      Promise.resolve(client),
    );
    assert.equal(value.length, 1, "the failed surface skips, the healthy one delivers");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("linkedin/#hiring react FAILED")));
  });

  it("warns result().errors[] entries and keeps the posts collected so far", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const { client } = stubClient({
      data: [resultItem({ activityUrn: "urn:li:activity:222", url: "https://u/222" })],
      errors: [{ type: "filterNotApplied", message: "fromMembers: no match" }],
    });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client));
    assert.equal(value.length, 1);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("filterNotApplied: fromMembers: no match")));
  });

  it("skips a parked workflow without awaiting result()", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const { client, resultCalls } = stubClient({
      executeResult: {
        pendingReason: "outsideWorkingHours",
        message: "starts when working hours open at Mon, 09:00",
      },
      data: [resultItem()],
    });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client));
    assert.deepEqual(value, [], "a parked workflow contributes no posts");
    assert.deepEqual(resultCalls, [], "result() is never awaited on a parked workflow");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("outside Linked API working hours")));
    assert.ok(lines.some((line) => line.includes("starts when working hours open")));
  });

  it("parks on any pendingReason, not just outsideWorkingHours, without awaiting result()", async (t) => {
    // N013 red-first: this test FAILS against the strict === guard (result()
    // gets awaited, posts non-empty) and PASSES once the guard widens to any
    // non-nullish pendingReason. Two-arm message: the generic arm names the
    // reason ("parked (pendingReason: <reason>)"); the working-hours arm keeps
    // its existing line (see the test above).
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const { client, resultCalls } = stubClient({
      executeResult: {
        pendingReason: "accountUnderReview",
        message: "try again later",
      },
      data: [resultItem()],
    });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client));
    assert.deepEqual(value, [], "an unrecognized pendingReason still parks: no posts");
    assert.deepEqual(resultCalls, [], "result() is never awaited on a parked workflow");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => line.includes("pendingReason: accountUnderReview")),
      `no parked-reason warn in: ${JSON.stringify(lines)}`,
    );
    assert.ok(lines.some((line) => line.includes("try again later")));
  });

  it("drops malformed rows with a count and a conditional warn", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const good = resultItem({ activityUrn: "urn:li:activity:333", url: "https://u/333" });
    const { client } = stubClient({ data: [resultItem({ author: null }), good] });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client));
    assert.equal(value.length, 1);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("dropped 1 malformed result(s)")));
  });

  it("survives a thrown null — describeError guards non-Error throws", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const failing = stubClient({ executeError: null });
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.resolve(failing.client),
    );
    assert.deepEqual(value, []);
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some((line) => line.includes("FAILED — null")),
      "thrown null degrades",
    );
  });

  it("degrades to warn + [] when the client factory itself rejects", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    const value = await fetchLinkedInPosts([SURFACE], TOKENS, () =>
      Promise.reject(new Error("install broken")),
    );
    assert.deepEqual(value, [], "a factory fault contributes no posts and never rejects");
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => line.includes("linkedin client FAILED — install broken")));
    assert.ok(
      !lines.some((line) => line.includes("linkedin/#hiring react")),
      "no surface runs when the client cannot build",
    );
  });

  it("passes the term verbatim with the pinned search shape", async () => {
    const { client, executeParams } = stubClient({ data: [] });
    await fetchLinkedInPosts([SURFACE], TOKENS, () => Promise.resolve(client));
    assert.equal(executeParams.length, 1);
    assert.deepEqual(executeParams[0], {
      term: "#hiring react",
      limit: 100,
      filter: { sort: "latest", datePosted: "past24Hours" },
    });
  });
});
