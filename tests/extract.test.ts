import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { codeFromPk, extractPosts } from "../src/extract.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixture", "tag-page.html"), "utf8");

describe("extractPosts", () => {
  it("extracts real posts from the captured tag page", () => {
    const posts = extractPosts(fixture);
    assert.equal(posts.length, 4);
    assert.deepEqual(posts[0], {
      id: "4012496661532082278",
      text: "Anyone tengah open for hiring? Please please let me know.",
      author: "hasrashidd",
      permalink: "https://www.threads.com/@hasrashidd/post/DevQHRdD4Bm",
      timestamp: "2026-10-21T01:41:38.000Z",
    });
  });

  it("keeps capture order", () => {
    const posts = extractPosts(fixture);
    assert.deepEqual(
      posts.map((p) => p.id),
      [
        "4012496661532082278",
        "4001747734230078501",
        "3998973357877860537",
        "3993862290835326832",
      ],
    );
  });

  it("dedupes by pk (fixture edge 4 duplicates edge 1)", () => {
    const posts = extractPosts(fixture);
    assert.equal(new Set(posts.map((p) => p.id)).size, posts.length);
  });

  it("derives the shortcode from pk when code is missing (edge 5)", () => {
    // Edge 5 is a real capture post with its code removed; the derived code
    // must equal the real one from the capture.
    const posts = extractPosts(fixture);
    const derived = posts.find((p) => p.id === "3993862290835326832");
    assert.ok(derived);
    assert.equal(
      derived.permalink,
      "https://www.threads.com/@meyyah.ah/post/DdtDJfXEUdw",
    );
  });

  it("drops items without caption text (edge 6)", () => {
    const posts = extractPosts(fixture);
    assert.equal(posts.some((p) => p.id === "3982574977840405311"), false);
  });

  it("tolerates unparsable data-sjs blobs", () => {
    const noisy = fixture.replace(
      "</head>",
      '<script type="application/json" data-sjs="">{"broken": </script></head>',
    );
    assert.deepEqual(extractPosts(noisy), extractPosts(fixture));
  });

  it("returns an empty array for pages without data-sjs blobs", () => {
    assert.deepEqual(extractPosts("<html><body>nothing here</body></html>"), []);
  });
});

describe("codeFromPk", () => {
  it("matches real pk/code pairs from the capture", () => {
    assert.equal(codeFromPk("4012496661532082278"), "DevQHRdD4Bm");
    assert.equal(codeFromPk("4001747734230078501"), "DeJEFyzghQl");
    assert.equal(codeFromPk("3998973357877860537"), "Dd_NRTej5i5");
    assert.equal(codeFromPk("3993862290835326832"), "DdtDJfXEUdw");
    assert.equal(codeFromPk("3982574977840405311"), "DdE8td9iVs_");
  });
});

