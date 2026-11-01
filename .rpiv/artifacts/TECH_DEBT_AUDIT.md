# Tech Debt Audit — loker-watcher

Generated: 2026-10-31 (repeat run #3). HEAD at audit time: 4c10d0c (main).
Prior runs: #1 2026-10-29 against 395ee63 — 24 findings (0 Critical / 1 High), remediation merged via PR #3 (2e064a8). #2 2026-10-31 against b92fa9f — all 24 verified RESOLVED except partial F004, reopened as N001; 5 open findings (N001-N005). Run-2 remediation merged via PR #4 (caee7be). This run audits the delta b92fa9f..4c10d0c: the run-2 fixes (636a4be, ced76f8, 732a082), the CI hardening series (89c8bc5..bc760cb), and the LinkedIn second-surface feature (68c1e2d, +617 src lines across 15 files). Living document at .rpiv/artifacts/TECH_DEBT_AUDIT.md.

Tooling: tsc --noEmit clean. Biome clean (36 files). npm test: 238/238, 0 skipped (was 195 — +43 tests from the LinkedIn, hostile-path, and CI-adjacent suites). npm audit: 0 vulnerabilities. depcheck clean. knip: 1 unused export (N006). madge: 2 cycles — judge.ts <-> judge-rotation.ts (run-#1 known, type-only) and NEW fetch-linkedin.ts > fetch-threads.ts (also type-only; both in looks-fine). No any / as any / @ts-ignore anywhere in src/ or scripts/. Scratch/binary hygiene still clean.

## Executive summary

- All four open run-2 findings are RESOLVED and verified in code, not just claimed: N001's phantom probe line is gone from guidance and README, N002's command-injection hole in the format hook is closed by a charset allowlist with a pinned hostile-path test, N003's four doc fragments are fixed, N004's four dead exports are unexported.
- Open debt: 5 findings — 0 Critical, 0 High, 1 Medium, 4 Low. N005 (judge-dispatch split) remains deferred by its own prescription: judge.ts was not touched for real work since (its 8-line diff is doc wording).
- The one new Medium (N007) is in the newest, least-reviewed code: the state commit-back's rebase-conflict skip loop exists as two verbatim copies inside watch.yml, and the copies carry the step's core invariant (skip ONLY state-file conflicts) — a one-sided edit diverges them silently.
- The LinkedIn feature landed unusually clean for its size: pure parser exports, the shared ContextLike seam (no second Playwright import site), capture-verified constant provenance, 381 lines of offline tests. Its debt is one misleading error message (N008), one unused export (N006), and declared placeholder tuning constants (open question).
- Fresh dimension sweeps found nothing else material: zero type holes, secrets env-only, funnel order intact, pools bounded, fail-visible contracts hold at every boundary.

## Architectural mental model

Shape is run #2's plus a second platform. The funnel order is still the invariant: fetch -> extract -> dedupe -> recency -> seen-diff -> judge -> notify -> persist, notify strictly before persist (src/index.ts:296-306 match path; Gate 1 zero-unseen short-circuit at :266-278, Gate 2 zero-match persist at :282-293). Acquisition is now platform-split before session resolution (src/index.ts:161-233): Threads keeps its null-session logged-out fallback; a null LINKEDIN_SESSION_STATE skips LinkedIn surfaces with a warn (never logged-out — anonymous LinkedIn hits an authwall), and a mixed logged-out dispatch downgrades a LinkedIn-arm all-fail to a warn so Threads posts survive. fetch-threads.ts remains the walker and the ONLY Playwright import site; fetch-linkedin.ts (338 LOC) rides the type-only ContextLike seam and walks LinkedIn's flagship-web Flight streams: hex-id JSON rows, dollar-reference resolution, commentary_text harvesting, facts minted from the activity id (id right-shift 22 = epoch ms, permalink constructed). The judge cluster is unchanged (dispatchLlmCall core, rotation park, parsers, shared runPool). The state commit-back grew the F021 skip loop: a conflicting rebase skips state-file-only conflicts (bounded at 50), aborts on any other path, pushes with --force-with-lease, retries once. Session temp dirs still die with the walk (src/index.ts:228-231); the workflow is still the only production writer to state/.

## Findings (open) — N006-N009 NEW this run, N005 carried

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|----------|-----------|----------|--------|-------------|----------------|
| N005 | Architectural decay (residual) | src/judge.ts (828 LOC, 302 comment lines) | Low | M | Carried from run #2, unchanged: F010's prescription was executed in full but judge.ts sits above the 500-line god-file threshold. Its only delta since b92fa9f is doc wording (8 lines). Mitigating: ~36% is doc comments (repo convention), and the module holds three concerns (env parsing + prompts, dispatch core, orchestration), not six. | Keep deferred: move dispatchLlmCall + wrapper warn wiring into judge-dispatch.ts when judge.ts is next touched for real work. Not worth a dedicated PR. |
| N006 | Architectural decay (dead export) | src/fetch-threads.ts:91 | Low | S | NEW: knip flags PageMouseLike — exported with zero external consumers (tests included); its only use is the optional mouse field at :110. The LinkedIn feature reintroduced the N004 class the same day ced76f8 cleaned it. | Drop the export keyword (keep the interface). One-line change; typecheck + tests confirm. |
| N007 | Architectural decay (duplicated logic) | .github/workflows/watch.yml:123-143 and :145-163 | Medium | M | NEW: the state commit-back's rebase-conflict skip loop exists as two verbatim ~18-line copies (first-push path and retry path). The copies carry the step's safety invariant — skip ONLY when the conflict set is exactly state/seen-posts.json, else abort and fail loudly — plus the 50-iteration bound and the set -e-proof skip-or-true. YAML gives no way to share the block, so every future edit must land twice; a one-sided edit silently diverges the failure semantics of the run's only write path. This loop was written in five rushed CI commits (89c8bc5..bc760cb) and is the least-reviewed code in the repo. | Extract the block into a committed script (scripts/commit-state-rebase.sh, called by both paths) or a local composite action; the script joins lint scope, and its conflict-classification branch becomes unit-testable the way scripts/hooks already are. Fold the 50-skip mid-rebase fall-through (see looks-fine) into the same rewrite. |
| N008 | Error handling (misleading diagnosis) | src/fetch-linkedin.ts:296-303 | Low | S | NEW: the first-response poll counts only bodies that parsed to at least one post (the handler increments responses at :281; non-200 responses and parse failures exit silently at :271/:279). So a surface serving flagship-web responses that are blocked, non-200, or flight-format-changed waits the full 30s and throws "no flagship-web response ... the session may be dead" — sending the operator to refresh a healthy session while the real cause is upstream. | Count received flagship-web responses (any status) separately from parsed ones; include both counts in the timeout error ("0 of 7 responses parsed — format change?"). ~6 lines plus a test. |
| N009 | Documentation rot | src/index.ts:152-154 | Low | S | NEW: the acquisition stage opens with a stale copy of its own comment — the pre-LinkedIn "session resolution + surface fetch timed as one span" block sits directly above the superseding per-platform version (:155-157). Leftover from the 68c1e2d edit; reads as two conflicting descriptions of one stage. | Delete the stale three lines. |

## Resolved ledger

Run-2 findings, verified resolved against 4c10d0c:

| ID | Was | Fixed in / verified at | Note |
|----|-----|------------------------|------|
| N001 | guidance documented a probe line the probe never printed | 732a082; guidance/scripts rewritten (ceiling ramp, no floor, every-account walk, exit 1), README.md:77 carries ceiling=N | The F024 class closed at both levels |
| N002 | format-on-edit spawn injected shell metacharacters (Medium) | 636a4be; format-on-edit.js charset allowlist before the shell:true spawn; tests/format-on-edit.test.ts pins a hostile path | The only open finding that executed commands |
| N003 | four doc-sync fragments | 732a082; judge.ts:190 now says "above"; WatcherDeps fence carries sleepFn; root guidance commands table matches package.json | Verified this run |
| N004 | four dead exports | ced76f8; symbols unexported, knip clean of them | New class instance tracked as N006 |
| N005 | judge.ts residual god file | — | NOT resolved; deferred by prescription (see findings) |

Run-#1 findings F001-F024: all RESOLVED (verified in run #2 against b92fa9f). This run re-checked the touched subset — judge.ts changed docs-only, state/heartbeat/email deltas are the LinkedIn markers and subject suffix, fetch-threads grew the LinkedIn dispatch — and the full gate is green. Ledger stands.

## Top 5 — if you fix nothing else, fix these

**1. N007 — one copy of the commit-back skip loop (1-2 hours).**
Extract watch.yml:123-143 / :145-163 into scripts/commit-state-rebase.sh; both call sites become one line. The script inherits lint coverage and becomes black-box testable (fake conflict states via a scratch repo) the way scripts/hooks already are. While there: decide the 50-skip fall-through (open question 2).

**2. N008 — make the LinkedIn timeout error tell the truth (30 minutes).**
Track received (every flagship-web response) apart from parsed-only responses at fetch-linkedin.ts:271-281; render both in the :302 throw. One new test case: 3 received, 0 parsed.

**3. N006 — unexport PageMouseLike (2 minutes).**
src/fetch-threads.ts:91. Run typecheck + tests to prove nothing imports it.

**4. N009 — delete the stale acquisition comment (1 minute).**
src/index.ts:152-154.

**5. N005 — judge-dispatch split (still deferred).**
Unchanged trigger: only when judge.ts is next touched for real work.

## Quick wins

- [ ] N006: drop export on PageMouseLike (2 min)
- [ ] N009: delete src/index.ts:152-154 (1 min)
- [ ] N008: received-vs-parsed counts in the fetch-linkedin timeout error (30 min)
- [ ] N007: extract the skip loop to a script (1-2 h — the only non-trivial item)

## Things that look bad but are actually fine

- **madge cycle #2: fetch-linkedin.ts > fetch-threads.ts.** Type-only: fetch-linkedin imports ContextLike with import type (src/fetch-linkedin.ts:38), erased by verbatimModuleSyntax; the runtime edge is one-way (fetch-threads dispatches the LinkedIn walk). Same ruling as the judge cycle (run #1). Leave both.
- **LinkedIn wheel constants are declared PLACEHOLDERS** (src/fetch-linkedin.ts:41-44, "pending the live retune"). Debt declared at the exact site, with provenance, an expected follow-up commit, and a precedent (93a3f38). Tracked as an open question, not a finding — the code says what it is.
- **Post.author is a placeholder ("linkedin-member") for every LinkedIn post.** The response bodies carry no member names and the DOM carries no ids; the two sources cannot join. Documented at mintPost and rendered deliberately in digests. Correct call under the constraint.
- **The mixed logged-out dispatch passes a "vestigial" base context argument** (src/index.ts:216-222, D12). The walker builds the base context lazily, so the argument never becomes a context; the comment says so. Ugly signature, correct behavior, documented.
- **A 50-skip cap mid-rebase falls through to the push.** Needs 50 consecutive state-file-only conflicts. Mid-rebase HEAD is detached, so git push fails (not on a branch), the retry path also fails, and the run exits 1 with "state push failed twice" — visible, safe, just noisy. Fold into N007's rewrite rather than patching now.
- **The LinkedIn response handler is fire-and-forget (void async IIFE).** Everything it can throw is inside its own try/catch; the drain wait (LINKEDIN_XHR_DRAIN_MS) bounds the settle window. The race it implies is the documented best-effort drain contract.
- **Timing poll busy-waits at 250ms for the first LinkedIn response** (fetch-linkedin.ts:296). Bounded at 30s, page-scoped, and Playwright's waitForResponse cannot express "first response matching two endpoints with any status". Fine.
- **Carried from run #2, re-verified standing:** the judge rotation cycle (type-only), heartbeat errors swallowed as warns (sanctioned best-effort), user!/pass! in email.ts (guarded above), Math.random in stateTempPath (unique-sibling legitimacy), logged-out fallback on invalid session (sanctioned degradable), gate-destructive fail-open (seatbelt not sandbox), the probe's weak success check (transport-health classifier, documented), the 429 rewind bound (proven at judge.ts:405-411).

## Open questions for the maintainer

1. **Have the LinkedIn wheel constants been live-retuned yet?** src/fetch-linkedin.ts:41-44 expects a validation-revision commit after the first real runs. If real runs have happened, the placeholders are stale; if not, the first 10-minute cron with a LinkedIn surface is the experiment. Either way, close the loop.
2. **Should the skip loop's 50-skip exhaustion state be distinguishable in the log?** Today it degrades into confusing push failures (see looks-fine). One echo before falling through would make a once-in-a-blue-moon path legible. Cosmetic — fold into N007 if you do it.
3. .rpiv/artifacts/ keeps growing (carried twice). Now includes three audit revisions, three designs, two plans, two validations, and the LinkedIn dispatch artifacts. Pruning policy, or intentional archive?
4. Is reasoning_effort verified against every endpoint in the pool? (Carried; live-only.) The probe's minimal call would surface a proxy that rejects the field.
5. Should the probe's ramp logic have tests? (Carried, twice.) scripts/probe-judge.ts:139-177 remains the only uncovered non-trivial logic in the repo.
6. Negative state deltas still read as "state: -N new seen post ids" (watch.yml commit message arithmetic; carried). Deliberate greppability, or should a negative delta say "pruned"?
