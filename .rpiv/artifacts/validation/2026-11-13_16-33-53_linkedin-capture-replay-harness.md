---
template_version: 1
date: 2026-11-13T16:33:53+0700
author: Yogiswara Utama
commit: 33e17dc
branch: ukind/feature-fix-incorrect-link-linkedin
repository: feature-fix-incorrect-link-linkedin
topic: "Validation of LinkedIn raw-body capture + replay harness"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-13_15-27-41_linkedin-capture-replay-harness.md"
tags: [validation, linkedin-capture, replay-linkedin, linkedin-fetch]
last_updated: 2026-11-13T16:33:53+0700
---

## Validation Report: LinkedIn raw-body capture + replay harness

### Implementation Status

- ✓ Phase 1: Capture sink foundation — Fully implemented
- ✓ Phase 2: Walk bolt-in — Fully implemented
- ✓ Phase 3: Replay script — Fully implemented
- ✓ Phase 4: PC wiring + repo plumbing — Fully implemented

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — clean, exit 0
- ✓ Lint: `npm run lint` — 69 files checked, no fixes applied, exit 0
- ✓ Tests: `npm test` — 616 tests / 148 suites, 616 pass, 0 fail (matches the plan's Phase 4 count)
- ✓ No regressions detected — base 33e17dc measured: 585 tests / 585 pass / 0 fail; delta -> 616/616. Composition of the +31: 27 tests in the two new suites (linkedin-capture 14, replay-linkedin 13), 4 walk-capture pins in tests/linkedin-fetch.test.ts; suites 138 -> 148 (+9 new-file suites, +1 capture describe block). Measured via a clean clone of 33e17dc with node_modules junctioned; the working tree's own suite runs were cross-checked with an explicit file enumeration.
- ✓ Whole-plan gate: `npm run typecheck && npm run lint && npm test` — all three green as individually recorded above
- ✓ Replay CLI contract (manual run): `npx tsx scripts/replay-linkedin.ts <capture>` prints the census block under the stable `replay:` prefix; zero argv prints the usage line bare (naming the ~20-session retention window); a missing path prints `replay: FAILED — ENOENT…`
- ✓ Live probe rehearsal (manual run): `npm run probe-linkedin` — 129 posts, `probe: all checks passed`, 138.8 s; wrote `captures/20261113T095039Z/` with 54 zero-padded files (50 matched walk bodies + 4 unmatched diagnostic bodies — both listener arms visible on disk)
- ✓ Live replay over the full session (manual run): 50 of 54 bodies return `join CANDIDATE (forward 68-110, reverse 0)`; the 4 unmatched bodies return `no card-scoped join found`. The Option-A promotion condition fired on live data.
- ✓ `captures/` gitignore shield (manual run): with 82 MB of captures present, `git status --short -uall` shows no `captures/` entry — `guardCheckout`'s porcelain read stays empty
- ✓ Scratch-harness walk (manual run): `fetchLinkedInPosts` + `makeFsCaptureSink` over an mkdtemp root wrote `001-hiring-indonesia.json` — schemaVersion 1, trailing newline, verbatim body, FULL url (114 chars, no truncation), matched envelope carrying minted/fresh; the walk itself never noticed the sink (posts minted normally)

### Code Review Findings

#### Matches Plan:

- src/config.ts:61-74 — `LINKEDIN_CAPTURES_ROOT = "captures"` sits after the LINKEDIN_PAYLOAD_PATH block and before the JUDGE_CEILINGS_PATH comment, doc names the guardCheckout line refs (scripts/fetch-linkedin.ts:254-261)
- src/linkedin-capture.ts:1-204 — matches the plan's Phase 1 fence: CAPTURE_SCHEMA_VERSION, CAPTURE_KEEP_SESSIONS = 20, SESSION_DIR_RE, the CaptureRecord envelope (minted/fresh optional keys), CaptureSink, CaptureWarnState, sessionStamp, surfaceSlug, makeFsCaptureSink (atomic temp+rename, lazy stamp, best-effort prune, injectable readdirFn), captureOnce (warn-once)
- src/linkedin-fetch.ts:48-53 the capture import; :466-476 the walkLinkedInSurface doc addition; :483-491 the signature gains captureSink/captureOrdinal/nowFn plus the per-walk captureWarn; :513-533 the unmatched arm captures (no minted/fresh); :565-587 the matched arm captures (minted/fresh); :741-747 the fetchLinkedInPosts doc; :757 the 9th defaulted trailing param; :769-772 the shared per-tick ordinal; :797-806 the sole call site
- scripts/fetch-linkedin.ts:40 the sink import; :98-107 FetchTickDeps.captureSink; :393-394 the walk call's explicit `undefined` minClicks slot + `deps.captureSink ?? makeFsCaptureSink()`
- scripts/probe-linkedin.ts:36 the sink import; :12-17 the module doc's read-only claim corrected to name the gitignored capture scratch as its one write; :115-123 ProbeDeps.captureSink; :184 the walk call's 9th arg
- package.json — `scripts/replay-linkedin.ts` joins the lint and format lists; `replay-linkedin` joins the scripts aliases
- .gitignore:8 — `captures/` joins the scratch family between `slice*-recon/` and `linkedin-cookies*.json`
- tests/linkedin-capture.test.ts — 14 tests / 4 suites, all plan pins present (round-trip deepEqual + trailing newline, lazy stamp ENOENT, 001/002/012 filenames, write-failure message naming the target, omitted minted/fresh, 21-session retention, best-effort prune with a throwing readdirFn, warn-once across three failures)
- tests/replay-linkedin.test.ts — 13 tests / 5 suites, all plan pins present (entry guard, zero-argv tagged gate, ENOENT passthrough, non-envelope rejection, schemaVersion mismatch, exact census lines, CTA/shrink/lost causes, six-point probe arms incl. the CANDIDATE flip, cross-check against the frozen parser, multi-file order)
- tests/linkedin-fetch.test.ts — the capture describe block (both arms, shared ordinal across surfaces, SSR-shaped minted 0/0, warn-once on a failing sink) plus the in-file absence oracle (repoCaptures snapshotted at load, asserted in after())
- tests/fetch-linkedin.test.ts (3 recording-sink injections + oracle) and tests/probe-linkedin.test.ts (2 injections + oracle) — all five body-firing script-suite cases inject the double; pass-through pins present
- Scope: the dirty set is exactly the plan's declared write-set — 9 modified + 4 new code files; the only other untracked paths are this workflow's own artifacts under .rpiv/artifacts/. No quarantine manifest exists under .rpiv/artifacts/verdicts/.

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ New modules follow the repo's established shape: tagged-error idiom (REPLAY_NO_INPUT + replayNoInput() + isReplayNoInput(), the rotationExhausted shape), entry-guarded main via `import.meta.url === pathToFileURL(process.argv[1]).href`, `.js` import specifiers, node:assert/strict, pinned clocks, lazy mkdtemp + one after()
- ✓ The sink reuses the existing atomic-write idiom (stateTempPath + temp/rename from src/state.ts) — no second atomic-write pattern introduced
- ✓ Test doubles are hand-written literals per the tests/ doctrine; no mock libraries; console access via call-through `t.mock.method` spies
- Minor observation (acceptable variation, not a deviation): the replay's analyzeBody re-derives the parser's row rules as an instrumented copy — the parser is frozen by design, and the cross-check suite pins the two walks together, so drift fails a test instead of shipping wrong evidence

#### Potential Issues:

- Disk reality exceeds the plan's estimate: one probe session measured 82 MB (50 bodies × ~1.5 MB), not the plan's 2-6 MB per walk. CAPTURE_KEEP_SESSIONS = 20 still bounds the root (~1.6 GB ceiling), but the churn rate is ~15-20× the Migration Notes figure. Non-blocking; the operator may want fewer kept sessions or slimmer noise-body capture later.
- Live data shape: the reverse BFS arm returned 0 on every body (reverse 0 in all 50 CANDIDATE verdicts) — only the forward direction carries signal here. Worth a sentence in the follow-up mint-path design so the Option-A decision cites the right arm.
- `.env` in this workspace has no `LINKEDIN_COOKIES_FILE` line; the live probe required passing the var inline (the cookie file itself exists at C:/loker-secrets/linkedin-cookies.json). Environment gap, not an implementation defect — the dedicated clone's own .env presumably carries the line for the running loop.
- Cosmetic: the plan's package.json fence carried the `"lint"` line unindented and the paste kept it (biome does not scope package.json, so no gate catches it). JSON-valid; straighten the indent whenever the file is next touched.

### Manual Testing Required:

All executable manual criteria were executed this run (the input asked for manual verification):

1. Live probe → capture → replay loop:
   - [x] `npm run probe-linkedin` writes `captures/<stamp>/001-<slug>.json` — verified: captures/20261113T095039Z/, 54 files, zero-padded ordinals, `linkedin/` prefix stripped from the slug
   - [x] `npx tsx scripts/replay-linkedin.ts captures/<stamp>/*.json` prints the census — verified: 50/54 bodies `join CANDIDATE (forward 68-110, reverse 0)`; the verdict line states plainly that the Option-A promotion condition is met
   - [x] Shares read against the committed census prior — verified on live body 035: 439 root rows, 4 distinct texts, 3 distinct ids, 7 marker rows, 104 id rows reached forward; matched envelopes carry minted/fresh (035: minted 3, fresh 3, received 31)
2. guardCheckout with captures present:
   - [x] `git status --short -uall` with 82 MB of captures shows no `captures/` entry — the porcelain read stays empty
3. Scratch-harness walk:
   - [x] `fetchLinkedInPosts` + `makeFsCaptureSink` over mkdtemp produced one file per body with matched/unmatched envelopes distinguishable (matched carries minted/fresh; unmatched omits them entirely — verified on live captures 001/004 as well: matched:false envelopes have no minted/fresh keys)
4. Replay CLI failure arms:
   - [x] Zero argv prints the usage line bare; a missing path prints `replay: FAILED — ENOENT…`

Still owed by a human (not executable from this workspace):

- [ ] `npm run fetch-linkedin` on the clean dedicated clone of main — the payload push landing with gitignored `captures/` present. Low risk: the porcelain shield is verified directly; the tick shares guardCheckout's read.

Note: the live capture session captures/20261113T095039Z/ (82 MB) was left in place as the R4 evidence base — gitignored, invisible to the floor, pruned by retention after ~20 more sessions. Copy it out before the mint-path design needs it.

### Recommendations:

- Ready to commit — implementation is complete and validated.
- The R4 evidence is in hand: 50/50 matched bodies show a forward card-scoped join (68-110 id rows reached from marker rows, reverse 0). The next /skill:design run should cite captures/20261113T095039Z/ (copy the directory out first).
- Add the LINKEDIN_COOKIES_FILE line to this workspace's .env so the next probe needs no inline var.
- Straighten the package.json `"lint"` line indent at the next touch.
