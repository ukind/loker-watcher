---
name: validate-e2e
description: Run a full end-to-end validation of the loker-watcher pipeline against the live Threads feed and the real LLM judge endpoint. Use when the user asks to validate, smoke-test, or prove the watcher works before a release or a config change.
---

# End-to-end validation of loker-watcher

Work under a scratch directory (`.rpiv/tmp/`). Never touch `state/seen-posts.json`.

1. Replicate the `src/index.ts` flow in a scratch harness.
2. Inject a mock nodemailer transport that captures the digest in memory.
3. Point state at a temp file, not `state/seen-posts.json`.
4. Pass real credentials via `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` so
   the judge uses the real endpoint.
5. When the live feed has zero default-keyword matches, pass a widened
   keyword override to `filterPostsByKeywords` so the judge and email stages
   still run.
6. Hash the state file before and after the run. The two hashes must match.
7. Check fail-visible: point `loadState` at a corrupt file and expect
   exit code 1 with the state file untouched.

Report: funnel counts per stage, the judge verdicts, the digest recipient,
the state hash comparison, and the fail-visible check result.
