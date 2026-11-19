/**
 * Config suite (N080): the two pure env resolvers on src/config.ts —
 * isHeartbeatEnabled's exact-"false" contract (trimmed + lowercased, so
 * " FALSE " disables too) and runUrlFromEnv's three-variable GITHUB_* join.
 * Env literals only; no fs, no doubles.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHeartbeatEnabled, runUrlFromEnv } from "../src/config.js";

describe("isHeartbeatEnabled", () => {
  it("defaults to enabled when HEARTBEAT_ENABLED is absent", () => {
    assert.equal(isHeartbeatEnabled({}), true);
  });

  it("disables only on the exact string false, case- and whitespace-insensitive", () => {
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "false" }), false);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "  FALSE  " }), false);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "False" }), false);
  });

  it("stays enabled for any other value", () => {
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "true" }), true);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "1" }), true);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "0" }), true);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "" }), true);
  });
});

describe("runUrlFromEnv", () => {
  it("returns undefined when any GITHUB_* variable is absent", () => {
    assert.equal(runUrlFromEnv({}), undefined);
    assert.equal(
      runUrlFromEnv({
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "owner/repo",
      }),
      undefined,
    );
    assert.equal(
      runUrlFromEnv({
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_RUN_ID: "123",
      }),
      undefined,
    );
  });

  it("composes the run URL when all three variables are present", () => {
    assert.equal(
      runUrlFromEnv({
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_RUN_ID: "123",
      }),
      "https://github.com/owner/repo/actions/runs/123",
    );
  });
});
