/**
 * Offline suite for the pure voyager client core (slice 1).
 *
 * FIXTURE PROVENANCE: tests/fixture/voyager-search-response.json is a
 * trimmed, scrubbed copy of the 2026-11-03 live capture
 * (.rpiv/tmp/voyager-capture.json — curl probe, keywords "#hiring react",
 * datePosted past-24h, start 0, count 5, HTTP 200). Masking policy: author
 * names genericized, company/member urn digits and rcm tracking values
 * masked, post texts truncated at 200 chars; activity ids kept VERBATIM so
 * the timestamp-derivation edge stays real. JSON carries no comments —
 * this header and the test titles are the provenance record. Pinned
 * edges: (1) header cluster ignored, (2) feedback card ignored, (3) two
 * valid posts mapped through the §6 walk, (4) one malformed row dropped
 * and counted.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  VOYAGER_GRAPHQL_ENDPOINT,
  VOYAGER_QUERY_ID,
  VOYAGER_QUERY_NAME,
  buildSearchUrl,
  encodeRestliValue,
  encodeSearchVariables,
  parseSearchResponse,
  timestampFromActivityId,
} from "../src/linkedin-voyager.js";
import type { Post } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixture", "voyager-search-response.json"), "utf8");

describe("encodeRestliValue", () => {
  it("escapes the §12.5 matrix: comma + space", () => {
    assert.equal(encodeRestliValue("hiring react, remote"), "hiring%20react%2C%20remote");
  });

  it("escapes parens (§12.5)", () => {
    assert.equal(encodeRestliValue("hiring (react)"), "hiring%20%28react%29");
  });

  it("escapes colons (§12.5)", () => {
    assert.equal(encodeRestliValue("hiring: react"), "hiring%3A%20react");
  });

  it("escapes ampersands at the URL layer (§12.5)", () => {
    assert.equal(encodeRestliValue("hiring & react"), "hiring%20%26%20react");
  });

  it("escapes single quotes (phrase keywords, §12.5)", () => {
    assert.equal(encodeRestliValue("'hiring react'"), "%27hiring%20react%27");
  });

  it("encodes # at the URL layer — a raw # truncates the GET query (live capture)", () => {
    assert.equal(encodeRestliValue("#hiring"), "%23hiring");
  });
});

describe("buildSearchUrl", () => {
  it("reproduces the §12.7 canonical latest-posts URL byte-for-byte", () => {
    assert.equal(
      buildSearchUrl("#hiring react", 0, 50),
      `${VOYAGER_GRAPHQL_ENDPOINT}?queryId=${VOYAGER_QUERY_ID}&queryName=${VOYAGER_QUERY_NAME}&variables=(query:(keywords:%23hiring%20react,flagshipSearchIntent:SEARCH_SRP,queryParameters:(resultType:CONTENT,datePosted:past-24h,sortBy:date_posted)),origin:GLOBAL_SEARCH_HEADER,start:0,count:50)`,
    );
  });

  it("omits orderBy entirely (§12.4: ignored; sortBy:date_posted is the real switch)", () => {
    const variables = encodeSearchVariables("#hiring", 25, 50);
    assert.ok(!variables.includes("orderBy"));
    assert.ok(variables.includes("sortBy:date_posted"));
    assert.ok(variables.includes("start:25"));
    assert.ok(variables.includes("count:50"));
  });
});

describe("timestampFromActivityId", () => {
  it("derives epoch ms from the activity id (low 22 bits stripped)", () => {
    const id = "7523281949587681280";
    const expected = new Date(Number(BigInt(id) >> 22n)).toISOString();
    assert.equal(timestampFromActivityId(`urn:li:activity:${id}`), expected);
  });

  it("inverts the tests/index.test.ts:93 forward trick", () => {
    const ms = Date.UTC(2026, 9, 26, 9, 14, 0);
    const id = (BigInt(ms) << 22n).toString();
    assert.equal(timestampFromActivityId(`urn:li:activity:${id}`), new Date(ms).toISOString());
  });

  it("rejects non-activity urns and non-urn strings", () => {
    assert.equal(timestampFromActivityId("urn:li:share:123456789"), null);
    assert.equal(timestampFromActivityId("not-a-urn"), null);
  });
});

describe("parseSearchResponse", () => {
  const result = parseSearchResponse(fixture);

  it("parses the scrubbed 2026-11-03 live capture (edges 1-4 pinned below)", () => {
    assert.equal(result.kind, "ok");
  });

  it("maps the two valid posts through the §6 walk (edge 3)", () => {
    assert.ok(result.kind === "ok");
    assert.equal(result.posts.length, 2);
    const first = result.posts[0] as Post;
    assert.equal(first.platform, "linkedin");
    assert.equal(first.id, "urn:li:activity:7523281949587681280");
    assert.match(first.text, /^#hiring Technology Manager/);
    assert.equal(first.author, "Author One");
    assert.equal(
      first.permalink,
      "https://www.linkedin.com/posts/member-handle_httpsjobsrminecomjobnltechnology-manager-activity-7523281949587681280-5dUC",
    );
    assert.equal(first.timestamp, timestampFromActivityId(first.id));
  });

  it("ignores the header and feedback clusters (edges 1-2)", () => {
    assert.ok(result.kind === "ok");
    assert.ok(result.posts.every((post) => post.author !== "243 results"));
    assert.ok(result.posts.every((post) => post.id.startsWith("urn:li:activity:")));
  });

  it("drops the malformed row and counts it (edge 4)", () => {
    assert.ok(result.kind === "ok");
    assert.equal(result.dropped, 1);
    assert.ok(result.posts.every((post) => post.id !== "urn:li:activity:7523282112511242241"));
  });

  it("never reads metadata.totalResultCount (§12.1: it fluctuates 481-492)", () => {
    const noMeta = parseSearchResponse(
      JSON.stringify({ data: { searchDashClustersByAll: { elements: [] } }, included: [] }),
    );
    assert.deepEqual(noMeta, { kind: "ok", posts: [], dropped: 0 });
  });

  it("maps an exhausted page (elements: []) to ok with zero posts (§12.8 terminal signal)", () => {
    const exhausted = parseSearchResponse(
      JSON.stringify({ data: { searchDashClustersByAll: { elements: [] } }, included: [] }),
    );
    assert.deepEqual(exhausted, { kind: "ok", posts: [], dropped: 0 });
  });

  it("surfaces unparsable bodies without throwing", () => {
    const bad = parseSearchResponse("<html>challenge</html>");
    assert.equal(bad.kind, "unparsable");
  });
});
