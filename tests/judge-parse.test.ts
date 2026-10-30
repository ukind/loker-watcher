/**
 * Verdict-parser suite (F015): the parseVerdict and parseBulkVerdicts
 * describes moved intact from tests/judge.test.ts along the F010 seam —
 * pure string-in/string-out, no doubles, no shared helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBulkVerdicts, parseVerdict } from "../src/judge-parse.js";

describe("parseVerdict", () => {
  it("parses clean JSON objects", () => {
    const verdict = parseVerdict('{"relevant": true, "locationOk": false}');
    assert.deepEqual(verdict, { relevant: true, locationOk: false });
  });

  it("parses markdown code fenced JSON", () => {
    const raw = '```json\n{"relevant": true, "locationOk": true}\n```';
    assert.deepEqual(parseVerdict(raw), { relevant: true, locationOk: true });
  });

  it("parses JSON with surrounding conversational text", () => {
    const raw = 'Here is the verdict: {"relevant": false, "locationOk": false}. Let me know!';
    assert.deepEqual(parseVerdict(raw), { relevant: false, locationOk: false });
  });

  it("returns null for malformed or non-boolean JSON", () => {
    assert.equal(parseVerdict("not json"), null);
    assert.equal(parseVerdict('{"relevant": "yes", "locationOk": true}'), null);
    assert.equal(parseVerdict('{"relevant": true}'), null);
    assert.equal(parseVerdict(""), null);
  });
});

describe("parseBulkVerdicts", () => {
  it("parses an id-keyed verdict object into a Map", () => {
    const verdicts = parseBulkVerdicts(
      '{"7224638912743920001": {"relevant": true, "locationOk": false}}',
    );
    assert.equal(verdicts?.size, 1);
    assert.deepEqual(verdicts?.get("7224638912743920001"), { relevant: true, locationOk: false });
  });

  it("tolerates code fences and surrounding text", () => {
    const raw = [
      "Here you go:",
      "```json",
      '{"1": {"relevant": false, "locationOk": true}}',
      "```",
      "Done.",
    ].join("\n");
    const verdicts = parseBulkVerdicts(raw);
    assert.deepEqual(verdicts?.get("1"), { relevant: false, locationOk: true });
  });

  it("keeps 19-digit ids exact, never Number-coerced", () => {
    const id = "7224638912743920001";
    const verdicts = parseBulkVerdicts(
      JSON.stringify({ [id]: { relevant: true, locationOk: true } }),
    );
    assert.ok(verdicts?.has(id));
  });

  it("keeps hostile keys as data, not prototype pollution", () => {
    const verdicts = parseBulkVerdicts('{"__proto__": {"relevant": true, "locationOk": true}}');
    assert.deepEqual(verdicts?.get("__proto__"), { relevant: true, locationOk: true });
  });

  it("drops malformed items without failing the batch", () => {
    const verdicts = parseBulkVerdicts(
      '{"1": {"relevant": true, "locationOk": true}, "2": {"relevant": "yes"}, "3": "broken"}',
    );
    assert.equal(verdicts?.size, 1);
    assert.ok(verdicts?.has("1"));
    assert.equal(verdicts?.has("2"), false);
  });

  it("returns an empty Map when the container parses but no item is valid", () => {
    const verdicts = parseBulkVerdicts('{"relevant": true}');
    assert.ok(verdicts !== null);
    assert.equal(verdicts.size, 0);
  });

  it("returns null for unrecoverable containers", () => {
    assert.equal(parseBulkVerdicts("not json"), null);
    assert.equal(parseBulkVerdicts(""), null);
    assert.equal(parseBulkVerdicts("[1, 2, 3]"), null);
    assert.equal(parseBulkVerdicts("no braces here"), null);
  });
});
