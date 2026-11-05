---
date: 2026-11-02T22:53:12+0700
author: Yogiswara Utama
commit: ecc9865
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Tech-debt audit remediation (run #4: N010-N017)"
tags: [research, codebase, tech-debt, linkedin-cutover, security-hygiene, fetch-linkedin-api]
status: ready
last_updated: 2026-11-03T07:44:28+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Added follow-up research: first-hand N010 git verification + five citation spot-checks + full verification pass 2 (sweep, counts, eight ranges)"
---

# Research: Tech-debt audit remediation (run #4: N010-N017)

## Research Question
How to execute the run #4 remediation on the mid-cutover working tree: guard the exposed LinkedIn credential (N010) first, commit the uncommitted LinkedIn SDK cutover in four reviewable slices (N011) with the small fixes folded in (N012 unexport, N013 fail-safe park guard, N014 test-idiom port, N015 AGENTS.md sync), record the N017 accept-and-document policy, and carry the N016 operator checklist into the PR. Chained from .rpiv/artifacts/discover/2026-11-02_22-40-38_tech-debt-audit-remediation.md.

## Summary
The tree is ready for the remediation as the FRD shapes it. The slice-2 rewiring is verified complete and clean: zero lingering references to the five deleted modules or the four old LINKEDIN_* env names anywhere in src/, tests/, scripts/, .github/, README.md, or AGENTS.md, and the deleted suites' coverage is re-homed (login coverage correctly died with the mechanism). N010's exact restoration is established verbatim: `linkedin-state*.b64`* returns at `.gitignore:8`, already a glob that covers future mints. N012/N013/N014 each have a verified seam: the three factories have no external importers and unexport safely over the default-param injection seams; the N013 guard widens to a nullish check with a two-arm message; the N014 port produces the same `lines: string[]` shape so no assertion churns. N015 and N017 have exact insertion points with in-repo writing models. Checkpoint decisions: N014 also ports the silent-resolver test (delta found by research); N015 also fixes .claude/skills/validate-e2e/SKILL.md:3; AGENTS.md:21 (npm start env list) is left untouched. The blocking precondition is unchanged: N010 lands before any slice commit.

## Detailed Findings

### N010 — credential guard (must land before slice 1)
- The deleted rule was verbatim `linkedin-state*.b64`*, standing at .gitignore:8 (between slice*-recon/ and run.log). Four in-repo artifacts agree: the cutover plan quotes the post-cutover file in full, byte-identical to the current working tree (.rpiv/artifacts/plans/2026-11-02_13-52-20_linkedin-sdk-post-search-cutover.md:1751-1765, the "(deleted)" note at :1765); two earlier research/validation docs record the line at :8 (.rpiv/artifacts/research/2026-11-01_19-34-17_linkedin-post-search-surface.md:102, .rpiv/artifacts/validation/2026-11-01_08-00-29_linkedin-second-surface-dispatch.md:67); the audit names the line and the fix (.rpiv/artifacts/TECH_DEBT_AUDIT.md:25,:53).
- Verbatim restore already delivers the generalization: the glob matches the current root blob linkedin-state.b64, the Phase-7-era mint name linkedin-state.json.b64, and any future middle-segment mint.
- The blob linkedin-state.b64 sits untracked at repo root (confirmed by git status --porcelain in this session; the 3,852-byte size is the audit's measurement, TECH_DEBT_AUDIT.md:9). The audit verified it is NOT in git history (TECH_DEBT_AUDIT.md:25), and this session re-verified first-hand via git log -p --all -- .gitignore (see Follow-up Research). Delete + ignore restores a clean posture without history scrubbing.
- Sequencing is the whole point: the slice-commit sweep is exactly the command that would ship the blob (TECH_DEBT_AUDIT.md:53). AGENTS.md:65-66 already forbids committing credentials semantically; the ignore rule is the mechanical enforcement that survives a habituated git add .
- Research-tooling caveat: the precedent agent has no shell, so the verbatim wording rests on the artifact triangulation above plus the byte-identical plan quote, not a direct git log -p -- .gitignore read.

### N012 — unexport three idle factories (slice 1)
- createLinkedApiClient (src/fetch-linkedin-api.ts:107) is consumed only by its own module default param at src/fetch-linkedin-api.ts:152. makeChromiumContextFactory (src/fetch-threads.ts:129) and chromiumContextFactory (src/fetch-threads.ts:180) are consumed only inside fetch-threads.ts default params at :206 and :297. Exhaustive grep across src/, tests/, scripts/, .github/ found zero external importers; src/index.ts:112 is JSDoc prose naming the default value, not an import.
- Removing export breaks nothing: all test call sites pass explicit factory args and never rely on the defaults — 10/10 fetchLinkedInPosts invocations in tests/fetch-linkedin-api.test.ts (:192-193, :203-204, :219-221, :260-262, :272-274, :287-289, :299-300, :308-310, :319-321, :331-333) and 16/16 Threads walk invocations in tests/fetch-threads.test.ts (:189, :207, :224, :245, :263, :284, :306, :336, :355, :374, :392, :412, :435, :463, :488, :513). The symbols stay alive at module scope, so the default-param references and the makeChromiumContextFactory(true) call at :180 still resolve.
- Keep exported: ContextFactory (src/fetch-threads.ts:118) and LinkedApiClientLike (src/fetch-linkedin-api.ts:66) — the seams the suites type against.
- Doc references stay accurate post-unexport: the quarantine bullets at .rpiv/guidance/src/architecture.md:7-8 name import sites (src/fetch-threads.ts:131, src/fetch-linkedin-api.ts:120), both still inside the now module-local factories. Same precedent as run #2's N004 (.rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md:56-63): drop the keyword, keep the symbol.
- No configured gate enforces export hygiene: package.json has no knip script or devDependency (the audit's knip run was ad hoc via npx); ci.yml:27-33 runs only typecheck/lint/test. The FRD's acceptance criterion is an ad-hoc npx knip run.

### N013 — fail-safe parked-workflow guard (slice 1)
- Current guard: src/fetch-linkedin-api.ts:179 `if (workflow.pendingReason === "outsideWorkingHours")` — strict match; any other non-null reason falls through to client.searchPosts.result(workflow.workflowId) at :187 and can hang the run into the 8-minute job cap (watch.yml:65 timeout-minutes: 8). Rationale comment block: :175-178.
- Current message construction: :180-183 builds detail with explicit undefined AND null checks (the exactOptionalPropertyTypes idiom for the message?: string | null type at :71); :184 warns `fetch: <label> skipped — outside Linked API working hours<detail>` with label = linkedin/<value> (:168); :185 continues.
- Generalized shape: widen :179 to a nullish check (!== undefined && !== null, mirroring the :181 style), then select the message inside — the existing :184 string verbatim for the outsideWorkingHours arm (FRD requirement), and a parallel arm for unknown reasons carrying the reason in the discriminating tail, e.g. `fetch: <label> skipped — parked by Linked API (<reason>)<detail>`. The shared scaffold and optional message suffix apply to both arms. The existing parked test's substring assertions (tests/fetch-linkedin-api.test.ts:292-293) keep passing untouched.
- The type already admits unknown strings: pendingReason?: string | null at src/fetch-linkedin-api.ts:70 (plain string, not a literal union). Grep confirms pendingReason appears only at :70 and the :179 comparison.
- New test: reuse the stubClient harness (tests/fetch-linkedin-api.test.ts:55-91) — stubClient({ executeResult: { pendingReason: "someNewReason", message: ... }, data: [resultItem()] }), assert resultCalls deepEqual [] (the :84-87 result double is the hang-oracle) and value deepEqual []. Red today: under the strict ===, someNewReason falls through to :187, the double records resultCalls = ["wf-1"] and data yields one post — both assertions fail. Keeping data: [resultItem()] sharpens the red signal. Write it directly in the post-N014 spy idiom since both fixes land in slice 1.
- Edge consistent with the FRD: pendingReason: "" is non-nullish, so under "ANY non-null" it parks too — a false skip costs one execute() round-trip, a false fall-through costs the run (the audit's fail-safe asymmetry).
- Adjacent hazards observed, out of N013 scope: an empty/garbage workflowId at :187 is unguarded (type claims string; runtime "" would poll a nonexistent workflow); workflowStatus (:69) is dead weight — the parked decision keys on pendingReason alone; result() has no timeout wrapper, so a NON-parked long workflow can still hit the 8-minute cap. None fold in — the FRD is strictly the pendingReason contract.

### N014 — t.mock.method port (slice 1)
- Violation: captureLines at tests/fetch-linkedin-api.test.ts:93-106 reassigns console[method] directly (:98-101, try/finally restore :102-105). Repo idiom: call-through spies `t.mock.method(console, "<method>", console.<method>.bind(console))` per .rpiv/guidance/tests/architecture.md ("console access is call-through spies only... never a silencing stub").
- Exemplars: tests/fetch-threads.test.ts:304, :390, :410, :432-433; tests/index.test.ts:547, :583, :617, :684-686 (with the "keep the spy call-through" comment at :685); tests/session.test.ts:65.
- Nine captureLines call sites (:192, :203, :219, :260, :272, :287, :299, :308, :319). Every line assertion is a some/filter over a string[] — no index-based or exact-equal assertions — so a port producing the same lines: string[] churns zero assertions. (The term-verbatim test at :331-334 uses no console capture; its OK log hits runner stdout today, unchanged.)
- Helper shape: add t: TestContext (type-only import from node:test; the file imports only describe/it at :4) as first param; inside, t.mock.method(console, method, method === "log" ? console.log.bind(console) : console.warn.bind(console)) (the ternary satisfies the literal-fn parameter type on the "log" | "warn" union); const lines = spy.mock.calls.map((call) => call.arguments.map(String).join(" ")); return { value, lines }. t.mock auto-restores after each test — the try/finally disappears. Keep .map(String) (the :99 semantics): every console call site in src/fetch-linkedin-api.ts (:163, :184, :193, :197, :199, :205) passes one template string, so it is byte-identical to exemplar projections and zero-churn.
- Exemplar read patterns: lines = spy.mock.calls.map((call) => call.arguments.join(" ")) (tests/fetch-threads.test.ts:321, :405, :425, :448, :454; tests/index.test.ts:569, :604, :647, :704); counts = .mock.calls.length (tests/session.test.ts:68); no exemplar uses callCount().
- CHECKPOINT DELTA (folded in): the silent-resolver test "returns null silently when either token is unset or blank" at tests/fetch-linkedin-api.test.ts:122-139 also hand-rolls a console.warn reassignment (:124 original capture, :125-127 reassignment, :135 asserts warns.length === 0, :136-138 finally-restore). Same violation class; the FRD names only captureLines. It cannot reuse the async captureLines helper (sync body, returns nulls), so its port is a bare inline spy mirroring tests/session.test.ts:65 + :68: const warns = t.mock.method(console, "warn", console.warn.bind(console)) then assert.equal(warns.mock.calls.length, 0); the it() callback gains t (node:test passes context to sync callbacks too).

### N011 slice 2 — deletions + rewiring (verified complete and clean)
- All five deletions confirmed in-tree: src/fetch-linkedin.ts, src/linkedin-login.ts, scripts/linkedin-login.ts, tests/fetch-linkedin.test.ts, tests/linkedin-login.test.ts are absent; src/ contains only fetch-linkedin-api.ts, tests/ only fetch-linkedin-api.test.ts.
- Sweep result: zero references to the deleted modules or the old LINKEDIN_* names (LINKEDIN_SESSION_STATE, LINKEDIN_EMAIL, LINKEDIN_PASSWORD, LINKEDIN_SECRET_WRITER) in src/, tests/, scripts/, .github/, README.md, AGENTS.md. The one .github hit is watch.yml:104's degrade comment naming the LIVE module (src/fetch-linkedin-api.ts). src/fetch-threads.ts has zero case-insensitive "linkedin" mentions — even the PageMouseLike docstring the cutover design expected to survive is already shed.
- Rewiring surface, verified end to end:
  - src/index.ts:166-168 partitions linkedin surfaces from RAW config (D14: labels must list every attempted surface; startup log :161 uses surfaceLabel :364-368 emitting linkedin/<value>); :169-171 resolves only non-linkedin surfaces.
  - src/index.ts:114-118 declares the WatcherDeps.linkedinFetch seam; :156 defaults to fetchLinkedInPosts (imported :32-37).
  - src/index.ts:195-206: token guard, then the single caller-owned warn naming BOTH env vars (:201-203, names from src/config.ts:16-17), else-branch drives linkedinFetch (:204-206); D12 belt catch :207-214 warns "fetch: linkedin surfaces FAILED — ..." (:213).
  - src/index.ts:220 returns combined posts (D13 single return; the old early returns silently dropped LinkedIn posts on a linkedin-only config); :223 finally-note: the LinkedIn leg keeps no session; :224 cleans only the Threads session dir.
  - src/config-file.ts:19 keeps linkedin in the Surface union; :147-149 validation accepts it; :229-232 resolveSurfaces REJECTS linkedin entries with the wiring-bug error (message at :231).
  - src/threads-session.ts:13-14 documents LinkedIn-rides-tokens; src/judge.ts:101-105 carries the PENDING-MEASUREMENT retune contract (mirrored at watch.yml:58-61).
- Modified-test coverage of the seams: tests/index.test.ts:481-545 (mixed run: raw value + both tokens verbatim :519-528, no linkedin.com Playwright URL :529-530, combined seen-state with urn ids :533-539, one session dir :540-545); :546-581 and :582-615 (missing-token skip warn pinned at :569-573 and :604-608; linkedin-only-no-tokens never runs the fetcher :603); :616-654 (D12 belt :648); :655-682 (D13 linkedin-only-with-session persists :674-680); :683-706 (D14 startup log :705). tests/config-file.test.ts:137-143 (linkedin accepted), :146-156 (blank rejected), :157-166 (non-string rejected), :192-198 (wiring-bug guard). tests/fetch-threads.test.ts:484-505 (re-homed single-context test), :507-522 (re-homed scrollRounds test). tests/session.test.ts is now Threads-only (:29-56).
- Deleted-suite coverage disposition: tests/fetch-linkedin.test.ts re-homed into tests/fetch-linkedin-api.test.ts (describes at :110-141, :142-181, :182-332 — including the old per-surface re-mint dedupe port at :183); tests/linkedin-login.test.ts coverage died entirely with the credential mechanism — correct by design (no replacement should exist; the session.test.ts parameterized LinkedIn-var cases died with it; src/threads-session.ts:41 envName param is now exercised only at its default).
- Out-of-scope leftovers (operator hygiene, not slice-2 commits): .env:1,2,6 still carries old LINKEDIN_* values locally (gitignored at .gitignore:2-3).

### N011 slice 3 — workflow + deps (exactly three files)
- Files: .github/workflows/watch.yml, package.json, package-lock.json (FRD FR#4). watcher.config.json's two linkedin surfaces (:10-11) are already-valid config from the earlier phase — not part of slice 3 despite the older cutover plan listing it.
- watch.yml shape: cron */10 (:4-5) + workflow_dispatch (:6); permissions contents:write (:8-9); concurrency group watch with cancel-in-progress: true (:12-20, flipped by this cutover — a parked Linked API workflow can hold the 8-minute cap; comment :13-19); dispatch-only probe job (:23-45); watch job (:47-128) with timeout-minutes: 8 (:65), fetch-depth: 0 checkout (:67-71), Playwright cache + --only-shell install (:79-97), env block :100-108 — JUDGE_CONCURRENCY "4" (:101), HEARTBEAT_ENABLED (:102), THREADS_SESSION_STATE (:103), LINKED_API_TOKEN (:104) and LINKED_API_IDENTIFICATION_TOKEN (:105) with degrade comments — then npx tsx src/index.ts (:109), and the Commit state step :111-128 (bot identity :118-119, adds ONLY state/seen-posts.json :120, no-op guard, jq delta, bash scripts/commit-state-rebase.sh :128).
- No old LINKEDIN_* secrets remain mapped anywhere under .github/workflows/ (ci.yml maps no secrets at all, ci.yml:20-27).
- PR description must carry (per AGENTS.md:64 repo rule + FRD FR#7): (1) the @linkedapi/node need — package.json:21 pins ^2.3.20, the only new runtime entry; grounded statement: sole transport for the LinkedIn post search, quarantined behind the only await import("@linkedapi/node") site (named import inside createLinkedApiClient, src/fetch-linkedin-api.ts:107-121 — the default export is the CJS namespace, TS2351 under NodeNext + verbatimModuleSyntax), replacing the deleted Playwright walker + credential login, eliminating LinkedIn session/cookie/password storage, tests stay offline over the LinkedApiClientLike seam. (2) The N016 operator checklist: delete GitHub Actions secrets LINKEDIN_SESSION_STATE, LINKEDIN_EMAIL, LINKEDIN_PASSWORD, LINKEDIN_SECRET_WRITER (the last a fine-grained PAT with Actions secrets read/write on this repo — revoke at github.com if it has other uses); nothing in the tree maps them anymore (TECH_DEBT_AUDIT.md:31).

### N011 slice 4 + N015 — docs, artifacts, AGENTS.md
- AGENTS.md current line map (read in full this session): intro :5-12, Commands :14-22, Architecture :24-54, Conventions :56-68, checklist :70-73. Zero LinkedIn/LINKED mentions; module list runs :30-54. (The audit's N015 row cites stale line numbers; the anchors below are from the live file.)
- Three insertions: (1) intro :7 — "on Threads" becomes "on Threads and LinkedIn" (writing model: README.md:3 "Threads + LinkedIn #hiring Indonesia job alerts."; root guidance .rpiv/guidance/architecture.md:3 already names both). (2) module bullet between :32 and :33 — after the fetch-threads/threads-session bullet, preserving pipeline order; content per the module header (src/fetch-linkedin-api.ts:1-29): Linked API SDK post search, sequential, never throws, skip-with-warn on missing tokens; env names LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN inline in the bullet — the established AGENTS.md convention (THREADS_SESSION_STATE at :31, LLM_ACCOUNTS at :37). (3) The pipeline sentence :26-28 is already platform-neutral and survives unchanged.
- CHECKPOINT DECISION: AGENTS.md:21 (npm start "needs LLM_* and GMAIL_* env vars") is NOT generalized in this pass — user chose the skill-line fix only; the stale line stays for a later pass.
- CHECKPOINT DELTA (folded in): .claude/skills/validate-e2e/SKILL.md:3 says "live Threads feed" — the only stale Threads-only claim in the .claude/ tree (grep case-insensitive; .claude/agents/digest-reviewer.md and .claude/commands/e2e-validate.md are platform-agnostic clean; .cursor/rules/*.mdc clean — workflow-safety.mdc:9 "Only state/seen-posts.json is committed back" stays accurate post-cutover). One-line edit to name both platforms.
- The five .rpiv/guidance/ files are already synced (root :3 names both platforms; workflows guidance :22-23 maps the token pair; validation confirms both guidance mirrors name fetch-linkedin-api at .rpiv/artifacts/validation/2026-11-02_15-52-31:35). AGENTS.md was the one missed doc layer.
- Slice 4 also commits: README.md (already cutover-complete), the four modified .rpiv/guidance/ files, TECH_DEBT_AUDIT.md, the 10 untracked cutover artifacts, and .rpiv/artifacts/handoffs/ (contains 2026-11-01_21-14-47_design-stage-linkedin-sdk-fetcher.md).

### N017 — accept-and-document policy target
- The note lands in .rpiv/guidance/.github/workflows/architecture.md inside the Commit-back section, immediately after :75. Rationale: :75 already carries the exact rhetorical pattern — "Accepted cost (F021): a skipped state conflict means the next run re-judges..." — a named, bounded-tolerance decision paragraph. The root .rpiv/guidance/architecture.md is an index-level overview (:3, :14) and structurally carries no policy paragraphs.
- The factual half is already documented in three places, the note just joins them: file bounded by prune-on-load (src/state.ts:7, :115 pruneState, :147 prune on every load; guidance mirror .rpiv/guidance/src/architecture.md:88-92; window recencyHours: 72 in watcher.config.json; the ~1.6 MB size is the audit's measurement at TECH_DEBT_AUDIT.md N017 row, with +10,816/−5,767 lines on the branch since 4c10d0c); history unbounded (watch.yml:5 cron → 144 ticks/day, every match run commits a near-full rewrite).
- Drafted paragraph (modeled on the :75 F021 sentence): "Accepted cost (N017): the state file is bounded, its git history is not. Prune-on-load (src/state.ts, 72h recencyHours window) holds state/seen-posts.json around ~1.6 MB, but every match run commits a near-full rewrite, so history grows by one rewrite per run forever — ~144 ticks/day. Policy: accept and document. Clone size and CI checkout cost are tolerable at this repo's age; revisit only when clone size forces the question. Escalation options, if ever needed: a periodic git-filter-repo squash of state: commits, or moving seen-state out of git entirely (a redesign, not a config change)."

### Order, gates, and the one fragile step
- Execution order is fixed by the FRD: N010 (ignore rule + rm blob) BEFORE slice 1; gates (npm run typecheck, npm run lint, npm test) between slices; slices 1→4; then open the PR.
- Precedent warning for slice 3: the state commit-back is the most fix-prone area in repo history (five same-day CI fixes then extraction-with-tests, 2026-10-30/31 — see Precedents). Slice 3 edits watch.yml around that step; tests/commit-state-rebase.test.ts runs under npm test anyway — keep it green per slice.
- The N013 guidance mirror: .rpiv/guidance/src/architecture.md:78 pins the parked contract to the specific string ("a parked workflow (pendingReason outsideWorkingHours) warns and NEVER awaits result()"). It must widen to ANY non-null pendingReason when N013 lands — the only guidance edit either slice-1 fix forces (the :7-8 quarantine bullets stay accurate post-N012).

## Code References
- .gitignore:1-8 — current 8 rules; the restore point for linkedin-state*.b64 is :8 (before run.log)
- src/fetch-linkedin-api.ts:66-71 — LinkedApiClientLike seam; pendingReason?: string | null at :70
- src/fetch-linkedin-api.ts:104-121 — resolveLinkedApiTokens (silent null) + createLinkedApiClient (the only @linkedapi/node import, named)
- src/fetch-linkedin-api.ts:149-152 — fetchLinkedInPosts signature; clientFactory default param
- src/fetch-linkedin-api.ts:175-187 — parked-workflow comment block + strict guard + message + continue + result() call
- src/fetch-linkedin-api.ts:188-206 — errors[] warn loop, drop count, OK log, per-surface catch
- src/fetch-threads.ts:129, :180, :206, :297 — makeChromiumContextFactory, chromiumContextFactory, the two default-param seams
- src/index.ts:114-118, :156, :166-171, :195-206, :220, :223 — linkedinFetch seam, default, raw partition, token guard + warn, combined return, no-session note
- src/config.ts:16-17 — ENV_NAMES.linkedApiToken / linkedApiIdentificationToken
- src/config-file.ts:19, :147-149, :229-232 — Surface union, validation, resolveSurfaces wiring-bug guard
- src/state.ts:115, :147 — pruneState, prune-on-load (N017 factual half)
- tests/fetch-linkedin-api.test.ts:55-91 — stubClient harness (resultCalls hang-oracle at :84-87)
- tests/fetch-linkedin-api.test.ts:93-106 — captureLines (N014 violation #1)
- tests/fetch-linkedin-api.test.ts:122-139 — silent-resolver test (N014 violation #2, checkpointed in)
- tests/fetch-linkedin-api.test.ts:279-293 — existing parked test (template for the new unknown-reason test)
- tests/fetch-threads.test.ts:304, :410 — t.mock.method call-through exemplars
- tests/session.test.ts:65-68 — sync inline warn spy exemplar
- .github/workflows/watch.yml:12-20, :65, :100-108, :111-128 — concurrency flip, job cap, env block incl. token pair :104-105, commit-back
- package.json:21 — @linkedapi/node ^2.3.20
- AGENTS.md:7, :21, :26-28, :30-33, :64-66 — intro, npm start env list, pipeline sentence, module list head, dependency + secrets rules
- .claude/skills/validate-e2e/SKILL.md:3 — the "live Threads feed" line (checkpointed into N015)
- .rpiv/guidance/.github/workflows/architecture.md:59-75 — commit-back mechanism section; :75 the Accepted-cost pattern; N017 note lands after it
- .rpiv/guidance/src/architecture.md:7-8, :78 — quarantine bullets (stay accurate), parked-contract sentence (must widen with N013)
- .rpiv/artifacts/plans/2026-11-02_13-52-20_linkedin-sdk-post-search-cutover.md:1751-1765 — the byte-identical .gitignore quote proving the verbatim N010 restore
- .rpiv/artifacts/TECH_DEBT_AUDIT.md:25, :31, :53 — N010 row + history verification, N016 secrets, guard-first fix

## Integration Points

### Inbound References
- src/index.ts:32-37 — imports fetchLinkedInPosts + types from ./fetch-linkedin-api.js; the only src consumer of the module
- src/index.ts:156 — WatcherDeps default drives fetchLinkedInPosts; tests drive the same seam with doubles (10/10 explicit factory args)
- tests/fetch-linkedin-api.test.ts:12-19 — imports the module's exported surface (fetchLinkedInPosts, mapLinkedInSearchResult, resolveLinkedApiTokens, the three types — none of the three factories)
- .github/workflows/watch.yml:104-105 — maps the token pair; the degrade comment names src/fetch-linkedin-api.ts
- scripts/probe-judge.ts — no relationship to this module (probes the judge endpoint only)

### Outbound Dependencies
- @linkedapi/node — the single dynamic named import inside createLinkedApiClient (src/fetch-linkedin-api.ts:120); importing the module never loads the SDK
- src/config.js (ENV_NAMES) — src/fetch-linkedin-api.ts:74-75 reads ENV_NAMES.linkedApiToken / linkedApiIdentificationToken
- src/config-file.js (Surface) and src/types.js (Post) — type-only imports

### Infrastructure Wiring
- .github/workflows/watch.yml — the only runtime; commit-back step adds state/seen-posts.json only (:120) via scripts/commit-state-rebase.sh (:128)
- .github/workflows/ci.yml:20-33 — the three gates (typecheck, lint, test); no knip, no export-hygiene gate
- .gitignore:8 — the N010 restore point; the rule is the mechanical credential guard behind AGENTS.md:65-66's semantic rule
- watcher.config.json:10-11 — the two linkedin surfaces consumed raw by the SDK fetcher

## Architecture Insights
- Optional-trailing-default-param injection seams are the repo's universal testability mechanism — they are exactly why N012 is safe: production defaults stay module-local while every test passes explicit doubles.
- Degrade contracts live at the module boundary and the caller owns policy: fetch-linkedin-api.ts is total (warn + [], never rejects), index.ts owns the missing-token warn and the belt catch; the resolver is silent by contract (resolveSession model).
- Raw-partition dispatch: platform choice happens on config.surfaces BEFORE resolution; a linkedin surface reaching resolveSurfaces is defined as a wiring bug and throws (src/config-file.ts:229-232).
- Fail-safe asymmetry governs N013's shape: a false skip costs one surface-tick, a false fall-through costs the whole run (8-minute cap, lost state commit) — hence skip on any non-null reason.
- Single dynamic-import quarantine per external SDK (Playwright in fetch-threads.ts:131, @linkedapi/node in fetch-linkedin-api.ts:120) keeps the offline suites structural.
- Guidance carries the contract mirror: src guidance :78 pins the parked contract and must move with N013 — guidance edits are part of the fix, not an afterthought.
- Doc policy pattern: "Accepted cost (F021/N017):" paragraphs in .rpiv/guidance/.github/workflows/architecture.md record deliberate, bounded-tolerance decisions next to the mechanism they govern.
- Export hygiene is enforced ad hoc (npx knip), not in CI — the FRD's acceptance criterion is a manual run.

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: LinkedIn credential-login fallback + secret refresh + the ignore rule's birth
**Commit(s)**: f571904 — "feat: linkedin credential-login fallback with workflow secret refresh" (2026-11-01); duplicate 2b74c61 stranded on backup/pre-rebase-14aaf74 by a rebase accident
**Blast radius**: 11 files, +1442/−63 across 4 layers — watch.yml (+41, 3 new secrets + refresh step + linkedin-login.json commit-back), .gitignore (+2: linkedin-state*.b64, run.log), src/ (new linkedin-login.ts 315 lines, fetch-threads.ts heavily edited), tests/ (+753)
**Follow-up fixes**: defb8af and ad66f02 the same day; the whole mechanism superseded within ~1 day (datacenter IP block) by the SDK cutover now being committed
**Takeaway**: gitignore credential rules are coupled to the consuming mechanism — removing the mechanism without removing the artifact re-exposes a live credential. Guard (N010) is step zero.

### Precedent: LinkedIn second surface (the Playwright walker the cutover deletes)
**Commit(s)**: 68c1e2d — "feat: linkedin second surface with configurable scroll rounds" (2026-10-31)
**Blast radius**: 21 files — new src/fetch-linkedin.ts (338) + 381-line test, fetch-threads.ts +86, index.ts +91, watch.yml +1, README +82
**Follow-up fixes**: defb8af (2026-11-01) — an empty search window crashed the shared all-fail throw instead of degrading; solutions doc .rpiv/artifacts/solutions/2026-11-01_20-34-14 flags that exact bug class
**Takeaway**: every LinkedIn fetcher must degrade warn+skip per-surface and never throw into the shared all-fail gate; plans systematically under-declare ripple files (.gitignore, package.json, README) — enumerate them explicitly.

### Precedent: Threads-era platform-fetcher introduction
**Commit(s)**: 1a9e353 — "feat: threads #hiring indonesia job alert pipeline (v1)" (2026-10-25); 9e1c8ef — "feat: authenticated threads fetch with recency cutoff" (2026-10-25)
**Blast radius**: v1 = 20 files, +2460; auth follow-up = 12 files, +501 (THREADS_SESSION_STATE secret → resolver → temp storageState → ignore artifacts)
**Follow-up fixes**: 9e1c8ef + b050436 same day; 93a3f38 (2026-10-27) — state v2 rewrite, 12 files, also touched .gitignore
**Takeaway**: platform-fetcher landings of this scale get amended the same day and rewritten within two — land in reviewable slices; the THREADS_SESSION_STATE-era secret pattern is the template whose LinkedIn copy just had to be torn out again.

### Precedent: state commit-back growth decisions (rebase → skip → extract)
**Commit(s)**: 510ff2a (2026-10-30) → five same-day CI fixes (89c8bc5, 8b777e6, 45bcbd3, 2e28916, bc760cb, 2026-10-31) → b779ff7 (2026-11-01, extraction to scripts/commit-state-rebase.sh + 342-line black-box suite)
**Blast radius**: watch.yml for the fix chain; 4 files (+423/−55) for the extraction
**Follow-up fixes**: the fix chain IS the follow-up — a naive rebase+push needed five corrections inside one day; f571904 had extended commit-back to conditionally carry state/linkedin-login.json (dying with the cutover)
**Takeaway**: the commit-back is the most fix-prone area in repo history — run tests/commit-state-rebase.test.ts after any watch.yml edit (npm test covers it; keep it green per slice).

### Precedent: AGENTS.md platform-scope updates
**Commit(s)**: 30d7561 (2026-10-25, created) through b0b7dbe (2026-10-30, last touch, 7 files)
**Blast radius**: 1-7 files per update, docs-only
**Follow-up fixes**: none — the gap is the finding: zero LinkedIn-era commits (68c1e2d, f571904, ad66f02, ecc9865) touched AGENTS.md
**Takeaway**: AGENTS.md is a recurring blind spot in platform-scope changes — the current cutover repeats the miss; N015 closes it, and the .claude/skills validate-e2e line (checkpointed in) is the same blind spot one layer down.

### Composite Lessons
- Guard the credential before anything moves (recurring #1): the rule tracks the mechanism, not the artifact — f571904 added it, the cutover deleted it while the blob remained. Restore + rm first, then slices.
- Blast radius is consistently under-declared: two prior validations flagged missing ripple files; AGENTS.md was missed twice across eras. Enumerate docs + config + ignore files explicitly in every slice.
- Mechanism swaps leave secret orphans: each credential approach accreted secrets (THREADS_SESSION_STATE era → LINKEDIN_* era → LINKED_API_* pair); orphans with high privilege (the SECRET_WRITER PAT) sit unrotated — the N016 checklist rides the PR.
- Big fetchers break or get replaced within a day: land the cutover in reviewable slices because it is currently one uncommitted blob, and one rebase accident already produced the backup/pre-rebase-14aaf74 duplicate.
- Degrade, never throw: the all-fail-throw bug shipped once (68c1e2d); N013 generalizes the same doctrine to the parked-workflow path (skip on any non-null reason).

## Historical Context (from .rpiv/artifacts/)
- .rpiv/artifacts/discover/2026-11-02_22-40-38_tech-debt-audit-remediation.md — the chained FRD driving this research (N010-N017 resolutions, slice plan, decisions)
- .rpiv/artifacts/TECH_DEBT_AUDIT.md — run #4 audit rows N010-N017 with severities and measured evidence
- .rpiv/artifacts/plans/2026-11-02_13-52-20_linkedin-sdk-post-search-cutover.md — the cutover plan (source of the byte-identical .gitignore quote)
- .rpiv/artifacts/validation/2026-11-02_15-52-31_linkedin-sdk-post-search-cutover.md — cutover validation (gates green on the tree, guidance sync confirmed)
- .rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md — run #2 research; N004 unexport precedent at :56-63
- .rpiv/artifacts/solutions/2026-11-01_20-34-14_linkedin-api-fetcher-integration-shape.md — flags the all-fail-throw bug class 68c1e2d shipped
- .rpiv/artifacts/handoffs/2026-11-01_21-14-47_design-stage-linkedin-sdk-fetcher.md — pre-cutover watch.yml shape (old four LINKEDIN_* mappings, refresh step, marker branch)

## Related Research
- .rpiv/artifacts/research/2026-11-01_09-29-22_linkedin-watch-off-my-pc.md — the host-migration research behind the cutover's origin
- .rpiv/artifacts/research/2026-11-01_19-34-17_linkedin-post-search-surface.md — the post-search surface research (records the old .gitignore:8 line)
- .rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md — run #2 remediation research (N004 unexport precedent)

## Open Questions
- N005 judge.ts split (move dispatchLlmCall + DispatchWarns/DispatchOutcome into judge-dispatch.ts) — explicitly deferred until judge.ts is next touched for real work.
- Probe ramp tests, negative-delta commit wording, reasoning_effort endpoint verification — explicitly deferred; remain audit open questions 6-8.

## Follow-up Research 2026-11-03T07:44:28+0700
Developer review flagged that the N010 claim was second-hand (the precedent agent disclosed it had no shell) and that load-bearing citations came from subagent reports. Closed first-hand in the main session:

- **N010 verbatim + position CONFIRMED via git**: `git log -p --all -- .gitignore` shows commit f571904 ("feat: linkedin credential-login fallback with workflow secret refresh", 2026-11-01) adding exactly `+linkedin-state*.b64` and `+run.log` after `slice*-recon/` (duplicate commit 2b74c61, identical stat — the rebase accident recorded in Precedents). `git show HEAD:.gitignore` confirms HEAD holds the rule at line 8 with run.log at line 9 — the doc's ":8, between slice*-recon/ and run.log" is exact. The working tree deletes it (` M .gitignore`), which is the N010 exposure. The document stands as written.
- **Five load-bearing citations spot-checked, all exact**: .rpiv/guidance/src/architecture.md:78 (the parked-contract sentence pins "outsideWorkingHours" — must widen with N013); .rpiv/artifacts/TECH_DEBT_AUDIT.md:9/:25/:31/:53 (blob size + untracked, N010 row + history-clean verification, N016 four secrets + PAT wording, guard-first fix); src/index.ts:166-171 (raw linkedin partition + resolveSurfaces on the complement); src/state.ts:115/:147 (pruneState signature, prune-on-load); .rpiv/guidance/.github/workflows/architecture.md:75 (the "Accepted cost (F021):" paragraph — the N017 note lands immediately after it).
- **Bonus**: tests/fetch-linkedin-api.test.ts:122 — the silent-resolver test ("returns null silently when either token is unset or blank") confirmed at the cited :122-139 range (the N014 checkpoint delta).
- **Process notes**: (1) the blob's untracked state was confirmed via git status --porcelain, not ls — line 27 corrected above; (2) the skill's compiled scan (Step 3.3) was skipped — synthesis went straight to the checkpoint; the write gate ran on the checkpoint questions alone; (3) the scope-tracer contract was replaced inline after two empty subagent returns (288s empty, then "No result provided") — disclosed at dispatch time, retained as a harness pitfall for future sessions.

### Verification pass 2 (2026-11-03T07:48:41+0700) — the remaining subagent-sourced claims, closed first-hand in the main session
- **Zero-lingering-references sweep CONFIRMED**: grep -rnE 'fetch-linkedin\.|linkedin-login|LINKEDIN_SESSION_STATE|LINKEDIN_EMAIL|LINKEDIN_PASSWORD|LINKEDIN_SECRET_WRITER' over src/ tests/ scripts/ .github/ README.md AGENTS.md — literally zero hits.
- **Counts reconciled**: fetchLinkedInPosts( = 10 invocation lines (:193, :204, :220, :261, :273, :288, :300, :309, :320, :332 — all inside the doc's listed ranges) — 10/10 exact. captureLines( = 10 lines = 1 definition (:93) + 9 call sites — exact. fetchSurfaces mentions = 20 lines = 2 imports (:18-19) + 2 describe titles (:183, :240) + 16 invocations — the doc's list of 16 lines was correct, its "15/15" label was off by one; corrected to 16/16 above.
- **All eight ranges CONFIRMED exact**: src/index.ts:114-118 (linkedinFetch seam JSDoc + signature), :156 (deps default), :195-206 (token guard, both-var warn verbatim, else-branch drive), :220 (combined return), :223 (no-session note); src/config-file.ts:229-232 (wiring-bug throw verbatim); tests/index.test.ts:481-486/:546-552/:655-660/:683-690 (mixed-run, token-absent spy, D13, D14 with the :685 call-through comment); watch.yml:12-20 (cancel-in-progress + rationale comment), :65 (timeout-minutes: 8), :111-128 (bot identity, state-only add, no-op guard, jq delta); README.md:3/:14-21/:66-68 (both-platform lead, unset-or-blank skip-with-warn, token pair table); .claude/skills/validate-e2e/SKILL.md:3 ("live Threads feed" present); .rpiv/guidance/.github/workflows/architecture.md:59-75 (Commit-back section, Accepted-cost (F021) paragraph at :75).
- **Provenance status after pass 2**: every load-bearing file:line in this doc is now first-hand (main-session grep/sed/git, or main-session file reads). The ~17 precedent commit hashes were read from git by the precedent-locator agent (which has bash; its report quotes git log output) — one (f571904, the N010-load-bearing commit) re-verified first-hand via git log -p --all; the rest stand at subagent-read-git confidence. The five citations verified in the first follow-up round plus these eight ranges close every reference design/plan will consume.
