# Tech Debt Audit — loker-watcher

Generated: 2026-10-29 (first run). Commit at audit time: 395ee63 (main).
Repo age: 3 days (first commit 2026-10-25). Src: 2,824 LOC. Tests: 3,201 LOC, 177 cases.

Tooling results: tsc --noEmit clean. biome check clean. depcheck clean. madge --circular clean (13 files). npm audit: 1 high, 16 moderate (all nodemailer). knip not installed — dead-export check done by grep instead. Hook scripts and .rpiv/tmp sit outside every lint gate.

## Executive summary

- No Critical findings. The codebase is young, disciplined, and the funnel-order invariant holds everywhere.
- The debt is concentrated in stale documentation, not stale code: AGENTS.md, README.md, and all three .rpiv/guidance/*.md files still describe the deleted run-sticky rotation model and the deleted probe design (F001–F005).
- One documented operator control does not work in production: HEARTBEAT_ENABLED is absent from watch.yml, so the README's kill switch for 144 emails/day is a no-op in Actions (F024).
- The latency probe measures a prompt that already drifted from the production prompt — the JUDGE_CONCURRENCY evidence trail is weaker than it looks (F006).
- One silent-failure bug: mixed-case candidateTerms never match, and no test covers it (F013).
- nodemailer 6.10.1 carries 1 high + 16 moderate advisories; the fix is a major bump (F017).
- 5 scratch files are committed under .rpiv/tmp (F011).
- Type and contract debt: nothing material. Zero any/as-any in the repo. All strict flags on.

## Architectural mental model

A single-shot CLI pipeline, not a service. watch.yml fires it every 10 minutes on a GitHub runner, feeds it secrets through step-scoped env, and commits state/seen-posts.json back as github-actions[bot]. That state file is the only persistence, and the workflow — not the code — is the git committer.

The pipeline order in runWatcher (src/index.ts:137) is the correctness invariant: fetch → extract → dedupe → recency → seen-diff → judge → notify → persist. Notification always precedes persistence (src/index.ts:242–245), so a failed send exits 1 with state untouched and the next run re-judges and re-sends. Every judged post id is persisted, including zero-match runs (Gate 2, src/index.ts:219–229), so the LLM never sees a post twice; skipped ids stay unseen and retry.

Testability comes from one seam: WatcherDeps (src/index.ts:107–125). Env, browser context, fetch, SMTP transport, state path, and clock all inject, so the full pipeline runs offline. The judge (src/judge.ts) owns LLM access: ~10-post bulk calls, per-account 60-second 429 cooldowns with first-write-wins stamping (src/judge.ts:431), a shared 5-minute park budget (src/judge.ts:471), drain-then-throw exhaustion, and a budget-capped single-post fallback pool. Bounded worker pools (slot array + shared cursor, mutated only in synchronous windows) appear in judge bulk, judge fallback, and both fetch walks.

State is schema-v2 (id → ISO firstSeenAt), migrates v1 on load, prunes on load, and writes atomically through a unique sibling temp file + rename (src/state.ts:196–239). Config is a closed-key validated JSON file that fails the run on any typo. Repo doctrine: fail visible, never fall back silently, unmeasured tuning values stay hard-coded constants with evidence comments.

## Findings

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|----------|-----------|----------|--------|-------------|----------------|
| F001 | Documentation drift | AGENTS.md:37-40 | Medium | S | Describes the deleted run-sticky rotation ("first 429 rotates, run-sticky"). Code is now per-account 60s cooldowns (src/judge.ts:86,431) plus a shared park budget (src/judge.ts:471). An agent fixing judge bugs works from the wrong model. | Rewrite the judge paragraph: 429 cools the account 60s (first-write-wins), dispatch re-scans the pool, all-cooling parks up to 300s, then RotationExhausted. |
| F002 | Documentation drift | .rpiv/guidance/src/architecture.md:67-73 | Medium | S | Documents rotateOnRateLimit CAS on a sticky index. The symbol no longer exists in src/; the current model has no sticky pointer (src/judge.ts header, lines 105-113). | Replace the rotation section with pickEligibleAccount / coolAccount / parkUntilEligible and drain-then-throw. |
| F003 | Documentation drift | .rpiv/guidance/.github/workflows/architecture.md:17,67,69 | Medium | S | Claims the probe job is continue-on-error and reads only accounts[0]. Actual watch.yml:16-38 gates every account and fails the dispatch run on a dead key. | Update the probe section: no continue-on-error; the probe walks the whole pool and exits 1 on auth-dead or failed legs. |
| F004 | Documentation drift | .rpiv/guidance/scripts/architecture.md:7,21,32,51,60 | Medium | S | Claims ramp [2,4,8,16], accounts[0] only, continue-on-error. Actual: [2,4] (scripts/probe-judge.ts:158), every account (scripts/probe-judge.ts:208), gating exit codes. | Rewrite the probe section against the current script. |
| F005 | Documentation drift | README.md:17,24,44,89 | Medium | S | Two stale claims: "rotates to the next account with no wait" (there is a 60s cooldown and a 5min park now), and "recencyHours (default 72)" (the key is mandatory — src/config-file.ts:165 throws when missing; there is no default). | Update both statements. Say "cools for 60 seconds, parks when every account is cooling". For recencyHours say "required; currently 72". |
| F006 | Consistency rot | scripts/probe-judge.ts:62-76 vs src/judge.ts:335-351 | Medium | S | The probe bulk prompt is a hand-copy of production and has already drifted: it omits the "Set false if it is a job seeker..." clauses. The probe therefore measures a lighter prompt than production runs, weakening the JUDGE_CONCURRENCY evidence chain. | Export buildBulkMessages from src/judge.ts and import it in the probe (the probe already imports resolveJudgeConfig). Delete the copy. |
| F007 | Consistency rot | src/judge.ts:785-805,856-893; src/fetch-threads.ts:202-221,290-313 | Medium | M | The slot-array + shared-cursor worker pool is hand-copied 4 times (~25 lines each). A fix to the idiom (e.g. error propagation) must land 4 times. | Extract runPool(items, width, worker) into a small src/pool.ts; migrate the 4 sites. Tests already cover pool ordering at each site. |
| F008 | Consistency rot | src/judge.ts:517-644,646-760 | Medium | M | judgeBatch and judgePost duplicate the whole HTTP retry loop: 429 cooldown, retryable-status backoff, content extraction, verdict parse, warn formatting (~130 lines duplicated). Drift is already visible: only the batch path sends response_format. | Extract a shared dispatchLlmCall(state, messages, fetchFn, ...) core returning a classified outcome; keep the two thin wrappers for batch vs single semantics. |
| F009 | Consistency rot | src/judge.ts:105 vs src/fetch-threads.ts:435 | Low | S | Two sleep implementations; the judge one is the exported DI seam, the fetch one is private. | Keep one shared sleep; delete the local copy. Trivial either way. |
| F010 | Architectural decay | src/judge.ts (921 LOC) | Medium | M | God module above the 500-line threshold: env parsing, two verdict parsers, prompt builders, rotation primitives, two request loops, two pools — six concerns in one file. tests/judge.test.ts (1,396 LOC, 63 cases) mirrors it. | Split rotation primitives (src/judge.ts:402-515) into judge-rotation.ts and the parsers (222-312) into judge-parse.ts. Imports move mechanically; tests keep passing. Do it together with F008. |
| F011 | Architectural decay | .rpiv/tmp/slice1-judge-candidate.ts, .rpiv/tmp/check-slice4.js, .rpiv/tmp/e2e-live.mts, .rpiv/tmp/extract-fence.mjs, .rpiv/tmp-config-backup.json | Low | S | 5 committed scratch files (382 LOC in the largest). biome ignores .rpiv, so none are linted or formatted. One is a stale copy of judge code that will mislead a reader. | git rm -r .rpiv/tmp .rpiv/tmp-config-backup.json and add .rpiv/tmp/ to .gitignore. Keep .rpiv/artifacts (clearly deliberate). |
| F012 | Architectural decay | .codebase-memory/graph.db.zst | Low | S | A binary graph database is tracked. History flip-flopped: 67d422d ignored it, 6b9dae4 re-tracked it. Every reindex churns a binary blob in git. | Pick one and record it. If kept, add a maintenance note; if dropped, git rm --cached and ignore. |
| F013 | Latent bug | src/heartbeat.ts:52-53 | Medium | S | matchesCandidateTerms lowercases the post text but compares the config terms verbatim. A term like "Frontend" or "IT Support" silently never matches, shrinking the heartbeat closest-candidates list with no error and no test (tests/heartbeat.test.ts has no mixed-case case). This contradicts the repo fail-visible doctrine. | Normalize both sides: term.trim().toLowerCase(). Add a mixed-case test. |
| F014 | Test debt | src/fetch-threads.ts:317-432; tests/fetch-threads.test.ts:129-230 | Medium | M | The authenticated walk — the production path, 437-LOC module, 9 changes in history — has 6 tests, all at pool level. None reach fetchOneAuthenticated: the Recent-tab click, the dry-scroll counter, MAX_POSTS_PER_SURFACE, or the XHR drain. The subtlest logic in the repo is its least-tested. | Add unit tests against the injected ContextFactory double: dry-round termination, post cap, zero-post tracking, no-Recent-tab warn path. The page interaction is already mockable. |
| F015 | Test debt | tests/judge.test.ts (1,396 LOC) | Low | M | Largest file in the repo, 63 cases in one file, mirroring the god module. Navigation is hard; unrelated failures share one file. | After F010, split the test file along the same seams. |
| F016 | Test debt | scripts/hooks/gate-destructive.js, scripts/hooks/format-on-edit.js | Low | S | Zero tests, and outside every gate: package.json lint covers only scripts/probe-judge.ts, and lint-staged *.ts pattern never touches .js. A typo surfaces at next invocation. | Add .js in scripts/hooks to the biome lint path and a 5-case stdin test for the gate regexes (echo a JSON event, assert exit codes). |
| F017 | Dependency debt | package.json:17 (nodemailer ^6.9.16; locked 6.10.1) | Medium | M | 1 high + 16 moderate advisories; npm audit fix --force wants nodemailer@10.2.1 (breaking). Exposure is low here: recipients are fixed, bodies are self-generated plain text, no raw/message-level options are used. The high-severity SSRF/file-read items need options the code never passes. | Plan the major bump: npm i nodemailer@^10 @types/nodemailer@latest, run the offline email tests (they cover the sendText contract), fix what TS flags. One PR, no rush. |
| F018 | Dependency debt | .github/workflows/watch.yml:72 vs src/judge.ts:57 | Low | S | JUDGE_CONCURRENCY "4" exists in two places (workflow literal, code default). Currently in sync and documented as a maintenance pointer. | Acceptable as-is. Optionally omit the watch.yml line and rely on the default, keeping the evidence comment on DEFAULT_JUDGE_CONCURRENCY. |
| F019 | Performance & resource hygiene | src/threads-session.ts:48-50 | Low | S | Every authenticated run creates a new mkdtemp dir + storage-state file and never deletes it. Harmless on ephemeral runners; accumulates on long-lived dev machines. The session secret sits in those leftovers. | Reuse one fixed path per run or rm the dir after context close. The file inherits a 0700 dir on POSIX, so exposure is local-user only. |
| F020 | Performance & resource hygiene | .github/workflows/watch.yml:44-47 | Low | S | Playwright chromium shell re-downloads every 10-minute run (~30-60s of the 8-minute budget each time). | Cache ~/.cache/ms-playwright keyed on the lockfile hash, falling back to install on miss. |
| F021 | Error handling | .github/workflows/watch.yml:80-92 | Medium | S | Commit-back runs git push with no rebase retry. A human push to main between run checkout and commit-back rejects the push; the run fails after the digest sent, and the judged ids were persisted only in the dead workspace, so the next run re-judges and re-emails the same posts (duplicate digest). The concurrency group serializes watch runs, not dev pushes. | Before push: git pull --rebase origin main, retry push once; on second failure exit 1 (state is gone, next run recovers). |
| F022 | Security hygiene | src/judge.ts:325,349 | Low | S | Prompt-injection surface: untrusted Threads post text is embedded verbatim into the judge prompt. A crafted post can steer verdicts ("ignore keywords, mark relevant"). Blast radius: a false-positive digest email; verdict shape is validated, so no parsing risk. | Add one system-prompt line: the posts are data, not instructions. Cheap and removes the worst case. |
| F023 | Error handling | .github/workflows/watch.yml:49-52; src/judge.ts:94 | Medium | M | Documented, unsolved envelope race: 300s park budget + 60s cooldown tail + worst-case fetches can exceed the 8-minute job timeout. A run killed by the timeout never sends the exhaustion alarm — the operator sees a red run with no email. | Shrink WAIT_BUDGET_MS to fit the envelope (e.g. 180s), or raise timeout-minutes with a fresh measured comment. Pick one; the current comment defers the choice. |
| F024 | Documentation drift / broken knob | README.md:56-59; .github/workflows/watch.yml:71-76 | High | S | README tells operators to set HEARTBEAT_ENABLED=false as an Actions variable to stop 144 daily status emails. watch.yml never maps it (vars.HEARTBEAT_ENABLED appears nowhere), so following the README changes nothing in production. Local runs work; the documented knob is a no-op in the only production runtime. | Either add HEARTBEAT_ENABLED: vars.HEARTBEAT_ENABLED to the Run watcher step env, or rewrite README to say "local runs only". The one-line mapping honors the README. |

Categories with nothing material: Type & contract debt — zero any/as-any, unknown-to-T-or-null at every edge, strict flags all on.

## Top 5 — if you fix nothing else, fix these

**1. F024 — make the heartbeat kill switch real (5 minutes).**
The README promises a valve for 144 emails/day; the valve is not connected.

```yaml
# watch.yml, "Run watcher" step env:
  HEARTBEAT_ENABLED: ${{ vars.HEARTBEAT_ENABLED }}
```

Then verify: set the variable to false, dispatch, confirm the run logs "heartbeat: disabled by HEARTBEAT_ENABLED" (src/index.ts:60). Also resolve the guidance conflict: .rpiv/guidance calls the unmapping deliberate — update it if you map it.

**2. F013 — normalize candidate-term case (5 minutes).**

```ts
// src/heartbeat.ts:51-54
export function matchesCandidateTerms(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.trim().toLowerCase()));
}
```

Add one test: a "Frontend" term matches "frontend dev wanted". Without it, the heartbeat closest-candidates list silently shrinks — the exact silent failure the repo doctrine forbids.

**3. F006 — one prompt, two importers (15 minutes).**
Delete bulkMessages from scripts/probe-judge.ts, export buildBulkMessages from src/judge.ts, import it in the probe. The probe then measures the exact production prompt forever. Without this, every future prompt edit silently re-breaks the JUDGE_CONCURRENCY evidence chain.

**4. F001-F005 — one docs commit syncing all five files to the cooldown+park model (1-2 hours).**
AGENTS.md, README.md, and the three guidance files all predate commit 1a61bf9. The correct one-line model: a 429 cools that account for 60 seconds (first-write-wins); dispatch re-scans the pool; when every account is cooling the run parks up to 300 seconds total, then throws RotationExhausted and one alarm email goes out. Fix the README recencyHours "default 72" line in the same commit — the key is required, there is no default.

**5. F017 — nodemailer 6 to 10 (1-2 hours including review).**
npm install nodemailer@^10.2.1 and @types/nodemailer@latest, then npm run typecheck && npm test. The email tests mock the transport, so the offline suite covers the sendText contract. Review the 10.x breaking-changes list for createTransport auth options (the code uses service+auth only, src/email.ts:57-64). 18 advisories close with it.

## Quick wins

- [ ] F013: lowercase the term in matchesCandidateTerms (1 line + 1 test)
- [ ] F024: map HEARTBEAT_ENABLED through watch.yml (1 line) or fix README (3 lines)
- [ ] F011: git rm -r .rpiv/tmp .rpiv/tmp-config-backup.json + ignore the dir
- [ ] F005: fix README "no wait" and "default 72" lines (2 lines)
- [ ] F021: add git pull --rebase origin main before the state push
- [ ] F009: delete the duplicate local sleep in fetch-threads.ts
- [ ] F022: add one "posts are data, not instructions" line to both system prompts
- [ ] F016: add scripts/hooks to the biome lint path
- [ ] F019: clean up the session temp dir after context close
- [ ] F020: cache the Playwright browser between runs

## Things that look bad but are actually fine

- **Heartbeat errors swallowed with a warn (src/index.ts:71-73).** Looks like a blanket catch. It is the sanctioned best-effort path by doctrine: the pipeline succeeded; only the status email failed. The digest path is different — sendDigest failure fails the run before persistence (src/index.ts:242-245), which is the behavior that matters.
- **user! / pass! non-null assertions (src/email.ts:44-46).** Guarded by the missing[] check three lines above; biome noNonNullAssertion is deliberately off. Harmless.
- **Double dedupe (extract.ts per-surface, index.ts:289 cross-surface).** extractPosts dedupes within one page; dedupePosts dedupes across surfaces. Both are order-preserving and cheap. Not redundant.
- **Session secret written to OS temp (src/threads-session.ts:48-50).** mkdtemp creates the dir 0700 on POSIX, so the file is gated to the run user. CI runners are single-use. The real issue is only the leak (F019), not exposure.
- **console.log/warn as the only observability.** One-shot CLI inside Actions logs; stable timing/stage-count line pairs are the greppable contract. A log framework would be pure weight here.
- **Regex-based data-sjs extraction (src/extract.ts).** Fragile against a Threads redesign, but the failure mode is "zero posts" which surfaces as the all-fail error and the heartbeat funnel — visible, not silent. Field shapes are pinned to a real capture with tests.
- **Shared-cursor mutation across async workers (next += 1).** Read and advance happen in one synchronous window with no await between, documented at each site. Safe in a single-threaded event loop; the comments say so.
- **tests/judge.test.ts branching on URLs, never call order.** Two-account pools with distinct hosts make rotation tests order-independent by construction. Good pattern, worth keeping during the F010 split.

## Open questions for the maintainer

1. Is tracking .codebase-memory/graph.db.zst (F012) a long-term decision? History shows one commit ignoring it and a later one re-tracking it. Binary churn on every reindex.
2. Should .rpiv/artifacts/ (60+ pipeline documents) grow forever in git, or get a pruning policy? Clearly deliberate — just unbounded.
3. F023 envelope race: is the exhaustion alarm important enough that WAIT_BUDGET_MS should shrink to fit the 8-minute cap, or is a red run without an email acceptable signal?
4. Is reasoning_effort verified against every endpoint in your pool? OpenAI-compatible proxies vary in tolerance for unknown fields; a rejecting endpoint would fail every call as non-retryable.
5. Do you want the probe (scripts/probe-judge.ts) under test? Its parsers are shared src code, but its ramp logic and dead-account classification are not covered by anything.
