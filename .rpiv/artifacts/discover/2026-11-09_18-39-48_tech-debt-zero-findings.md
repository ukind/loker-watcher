---
date: 2026-11-09T18:39:48+0700
author: Yogiswara Utama
commit: fd53570
branch: ukind/fix-tech-debt
repository: fix-tech-debt
topic: "Tech debt zero-findings pass (N018-N029 + N005)"
tags: [intent, frd, tech-debt, judge-dispatch, linkedin-payload, dead-exports]
status: ready
last_updated: 2026-11-09T18:39:48+0700
last_updated_by: Yogiswara Utama
---

# FRD: Tech debt zero-findings pass (N018-N029 + N005)

## Summary
Fix every open finding in the run-#5 tech debt audit (12 new findings N018-N029 plus the carried N005) so the next audit run opens nothing. The pass is behavior-preserving except for two deliberate operator-visible contracts: the LinkedIn payload reader stays v2-only (N018 closes as accepted-and-documented), and the stray canary file is deleted. The one structural change is extracting the judge dispatch core into src/judge-dispatch.ts with an options-object signature.

## Problem & Intent
The developer's framing, verbatim where possible: "based on this tech debt report at .rpiv/artifacts/TECH_DEBT_AUDIT.md fix all the tech debt". When asked what success looks like: "Zero open findings" — every open finding N018-N029 plus N005 gets fixed this pass, and the next audit run finds nothing new. The audit is repeat-run #5; the dead-export class alone has recurred four times (N004, N006, N012, N020), so this pass also clears the ledger to a verifiable zero rather than a partial pass.

## Goals
- All 13 open findings (N018, N005, N019, N020, N021, N022, N023, N024, N025, N026, N027, N028, N029) resolved in one pass on branch ukind/fix-tech-debt.
- N005 fixed at full depth: dispatch core extracted to src/judge-dispatch.ts, judgePosts' 11 positional params folded into one options object.
- Verifiable done state: the repo's three gates exit 0 AND knip reports zero unused exports.

## Non-Goals
- No v1 payload bridge. The reader stays strict (PAYLOAD_VERSION = 2, reject with warn). The developer explicitly chose this over the audit's recommendation.
- No knip gate in CI. The developer declined the anti-regrowth option; the dead-export class may regrow silently. Accepted.
- No work on the audit's open questions (see Open Questions) — findings only.
- No change to the two madge cycles (type-only, documented as fine by the audit).
- No new runtime dependencies.

## Functional Requirements
1. **N018 — document the strict-reader contract.** The reader in src/linkedin-payload.ts stays v2-only (rejects envelope.version !== 2 with the existing warn, :174-178). Add the operator contract to the PAYLOAD_VERSION doc comment and the linkedin-payload guidance: after a payload-format merge, the PC loop must pull and restart watch-linkedin, or the leg reads "malformed — unknown version 1" until it does. The committed state/linkedin-posts.json v1 file is NOT edited by code; it converts to v2 on the PC loop's next tick after restart (operator action, outside the repo).
2. **N005 — extract judge-dispatch.ts.** Move from src/judge.ts into new src/judge-dispatch.ts: dispatchLlmCall (:474), the wrappers judgeBatch (:693) and judgePost (:795), and the types exclusive to them (DispatchWarns :353, DispatchOutcome :325, AttemptDirective :341, plus BatchOutcome :300 / ContentDecision :310 if nothing outside the core uses them). judge.ts keeps orchestration (judgePosts, resolveJudgeConfig, parseLlmAccounts, normalizeEndpoint, builders systemMessage/buildMessages/buildBulkMessages, terminalFailureReason if shared). Shared helpers stay in judge.ts and are imported by judge-dispatch.ts. Imports across the new seam are type-only where type-only (verbatimModuleSyntax). The two known madge cycles must stay type-only (no new runtime cycle).
3. **N005 — options object.** judgePosts' tail params (ceilings, now, sleepFn, healthMarks, blocked, negativeKeywords — :910-915) fold into one options-object parameter; fetchFn, reasoningEffort may stay positional or join the object — implementer's choice, documented at the call site. index.ts and tests/ re-point imports; behavior unchanged.
4. **N019 — collapse the dead exhausted pair.** Delete allAvailabilityBlocked (judge.ts:391-398) and collapse the :542-546 three-arm split to a single `{ status: "exhausted" }` return; keep the comment explaining the terminal-not-a-timerless-wait intent. Zero behavior change; test outcomes unchanged.
5. **N020 — unexport 12 dead exports.** Drop the export keyword at: email.ts:309 (buildLegDeadAlarmText), judge-health.ts:39 (HEALTH_VERSION), linkedin-fetch.ts:60 (LINKEDIN_FETCH_CONCURRENCY), :66 (PAGE_SIZE), :83 (CURL_IMPERSONATE_PROFILE), :110 (LEG_DEAD), :136 (ALL_SURFACES_FAULTED), :163 (FaultKind type), :337 (createPlaywrightTransport), config-file.ts:40 (PlatformFlags interface), linkedin-payload.ts:43 (LegStatus type), linkedin-session.ts:144 (VoyagerStorageCookie interface). Internal uses stay. knip afterwards reports 0 unused exports and 0 unused exported types.
6. **N021 — probe uses normalizeEndpoint.** scripts/probe-judge.ts:107 imports normalizeEndpoint from src/judge.ts instead of the hand-rolled `${baseUrl.replace(/\/+$/, "")}/chat/completions`. Removes the live drift (an account whose baseUrl already ends in /chat/completions works in production and breaks the probe).
7. **N022 — paired-constant equality test.** One new test importing HEALTH_CAP_STREAK (src/judge-rotation.ts:63, non-exported — test may import it; the src zero-runtime-import boundary stays intact)... wait, it is NOT exported, so a test cannot import it. The test imports HARD_FAIL_TICKS_TO_CAP from src/judge-health.ts and asserts the rotation behavior bounded by the local copy: assert that judge-health's exported constant equals 2 AND that the rotation cap behavior matches (or: export nothing new — instead test the OBSERVABLE contract: a streak >= 2 caps the account at effective ceiling 1 and >= 3 does not differ). Implementer picks the strongest offline pin that does not add a new export; minimum is one test that fails if either side drifts from 2.
8. **N023 — one SMTP transport per run.** runWatcher (src/index.ts) creates one nodemailer transport lazily on first send (or eagerly at notify entry — implementer's choice, lazy preferred) and passes it to every send path it already threads: sendSurfaceDigest (:537), heartbeat (:390, :486), sendExhaustionEmail (:142). sendText's per-call createTransport (email.ts:167-175) remains as the fallback for tests/injection. Result: one SMTP handshake + auth per run instead of one per email.
9. **N024 — README sync.** Rewrite README.md step 8's subject sentence (lines 58-60): subjects now name their one surface (per-surface digest, email.ts buildSurfaceSubject); the `[linkedin]` body-marker claim stays. Add a negativeKeywords row to the config-key table.
10. **N025 — AGENTS.md module bullet.** Add one bullet to the Architecture module list: judge-availability.ts — the parallel availability pre-check; never throws, degrades to all-available.
11. **N026 — delete the duplicate config surface.** watcher.config.json has "hiring developer jakarta" twice (entries at lines 103-106 and 115-118). Delete the second entry (lines 115-118). One remains; the config-file duplicate warning disappears.
12. **N027 — entry guard.** scripts/watch-linkedin.ts:38: replace `void main();` with the standard guard `if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void main();` (importing the module must not start the loop).
13. **N028 — download timeout.** scripts/setup-curl-impersonate.ts:163: `fetchFn(url)` gains `AbortSignal.timeout(120_000)`, mirroring the tar runner's 120s bound. Failure exits 1 through the existing fail-visible path.
14. **N029 — delete the canary.** `git rm .probe-dispatch-canary` (tracked, content "probe", zero references in the tree).

## Non-Functional Requirements
- **Performance**: the N023 change removes N-1 SMTP handshakes per match run (one per surface digest + heartbeat + alarms collapse to shared transport). No other performance work.
- **Security**: no secret, cookie, or env handling changes. The payload reader's strict rejection stays (no new parser surface).
- **UX / Accessibility**: no user-facing surfaces; the only visible changes are log/doc text.
- **Reliability**: behavior-preserving. The 536-test suite pins outcomes through the N005 extraction. No new best-effort paths; no state-write changes; atomic-write idioms untouched.

## Constraints & Assumptions
- Node >= 22, ESM, strict TS flags stay on (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax).
- No new runtime dependency (audit + AGENTS.md doctrine).
- src/judge-rotation.ts keeps its zero-runtime-import identity: the N022 test must not force a new export or an import edge between judge-rotation and judge-health.
- The PC loop restart (N018 operator contract) is an operator action on the dedicated clone of main — code cannot do it.
- Assumption recorded: the four batch-2 decisions (acceptance bar, N018 closure mode, open-question deferral, canary deletion) were locked on the recommended options after the developer's "now what?" prompt; the canary deletion was already covered by the batch-1 hygiene selection. Any can be corrected by editing this FRD before implement.
- knip/depcheck/madge have no npm-script or CI wiring in this repo (verified: package.json scripts, ci.yml, watch.yml) — they run ad hoc via npx. The acceptance check uses `npx knip` directly.

## Acceptance Criteria
- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0 — 536 or more tests, 0 skipped (count grows by the N022 test)
- [ ] `npx knip` reports 0 unused exports and 0 unused exported types
- [ ] `git grep -n "hiring developer jakarta" watcher.config.json` returns exactly 1 hit
- [ ] `git ls-files .probe-dispatch-canary` returns empty
- [ ] `git grep -n "void main();" scripts/watch-linkedin.ts` returns empty; the entry-guard idiom is present
- [ ] `git grep -n "normalizeEndpoint" scripts/probe-judge.ts` returns a hit; no `/chat/completions` string concat remains in the probe
- [ ] `git grep -n "AbortSignal.timeout" scripts/setup-curl-impersonate.ts` returns a hit on the download fetch
- [ ] judgePosts takes an options object: `git grep -n "healthMarks: ReadonlyMap" src/judge.ts` returns no positional-param hit
- [ ] src/judge-dispatch.ts exists; `git grep -c "dispatchLlmCall" src/judge-dispatch.ts` >= 1
- [ ] README step 8 names per-surface subjects and the config table has a negativeKeywords row
- [ ] AGENTS.md Architecture list contains "judge-availability"
- [ ] Existing payload tests still pin: a version-1 envelope reads malformed (strict reject unchanged)

## Recommended Approach
Behavior-preserving debt pass on the current branch (ukind/fix-tech-debt): one new module src/judge-dispatch.ts carrying the judge dispatch core + an options-object judgePosts signature; 12 mechanical unexports; eight small fixes across scripts/, src/index.ts email plumbing, watcher.config.json, README.md, and AGENTS.md; git rm the canary. Verify with the three gates plus `npx knip` (expect 0/0). The operator then restarts watch-linkedin on merged main so the committed payload converts v1 -> v2.

## Decisions

### Success bar (intent)
**Question**: What does "fix all the tech debt" mean for you here — what does success look like when this pass is done?
**Recommended**: n/a — intent question
**Chosen**: Zero open findings
**Rationale**: Developer's own words; every open finding N018-N029 + N005 fixed this pass, next audit opens nothing.

### Hygiene batch scope
**Question**: Which hygiene fixes should I apply as recommended?
**Recommended**: all four groups
**Chosen**: all four groups + "everything reported" (config/repo/docs, script guards, micro-fixes, email transport)
**Rationale**: Developer selected every group verbatim; covers N021, N022, N023, N024, N025, N026, N027, N028, N029.

### N018 reader policy
**Question**: The committed LinkedIn payload is version 1 but the reader only accepts version 2 (linkedin-payload.ts:174). How should the reader treat v1 envelopes?
**Recommended**: Accept v1 + warn (bridge)
**Chosen**: Keep v2-only reject
**Rationale**: Developer's explicit pick against the recommendation; strict schema contract wins over platform continuity.

### N018 closure mode
**Question**: You chose to keep the v2-only reject. So how does N018 close?
**Recommended**: Document the contract
**Chosen**: Document the contract (accepted-and-documented)
**Rationale**: Locked on the recommendation after "now what?"; matches the existing row-level orphan doctrine (index.ts:517-522 already tells the operator to update the clone and restart). Assumption flagged in Constraints.

### N005 extraction depth
**Question**: judge.ts is 1,092 lines and judgePosts takes 11 positional params. How far should the split go?
**Recommended**: Full extract + options object
**Chosen**: Full extract + options object
**Rationale**: Developer's pick; audit Top-5 #2; the judge-rotation.ts module precedent; 536 tests pin behavior.

### N019 dead branch
**Question**: Pre-resolved from codebase evidence — collapse the byte-identical exhausted pair?
**Recommended**: Collapse to one return, keep the comment
**Chosen**: Collapse (covered by the zero-findings mandate and the audit Top-5)
**Rationale**: evidence: src/judge.ts:391-398,542-546 — both arms return { status: "exhausted" }; the predicate computes and discards.

### N020 scope
**Question**: knip flags 12 dead exports. Unexport all, and add a knip gate to CI?
**Recommended**: Unexport all 12 (gate offered as an option)
**Chosen**: Unexport all 12; NO knip CI gate
**Rationale**: Developer declined the anti-regrowth option explicitly; recorded as a Non-Goal.

### Acceptance bar
**Question**: What must pass before this counts as done?
**Recommended**: 3 gates + knip 0
**Chosen**: 3 gates + knip 0
**Rationale**: Locked on the recommendation after "now what?"; knip 0 is the zero-findings metric for the N020 class. Assumption flagged in Constraints.

### Open questions folding
**Question**: The audit carries 8 open questions. Fold any into this pass?
**Recommended**: Defer all
**Chosen**: Defer (6 remain open; Q1 and Q8 are resolved by the N018 and canary decisions)
**Rationale**: Locked on the recommendation after "now what?"; findings-only pass. Assumption flagged in Constraints.

### Canary deletion
**Question**: .probe-dispatch-canary is tracked at the repo root. Delete it?
**Recommended**: Delete it
**Chosen**: Delete it
**Rationale**: Already inside the developer's batch-1 hygiene selection; content "probe", zero tree references (verified).

## Open Questions
- Audit Q2: platforms.linkedin is pinned false while the PC loop keeps fetching ~19 surfaces/tick — intentional for how long? Gating the PC loop on the same key would save tick load and account exposure.
- Audit Q3 (carried, operator-side): were the orphaned GitHub secrets deleted — LINKEDIN_SESSION_STATE, LINKEDIN_EMAIL, LINKEDIN_PASSWORD, LINKEDIN_SECRET_WRITER, plus any @linkedapi/node token pair from the SDK era? Unverifiable from the tree.
- Audit Q4 (carried x3): is reasoning_effort verified against every pool endpoint? The availability probe omits the field; a proxy that rejects it passes availability and then fails every judge batch as a non-distinct cause.
- Audit Q5 (carried x4): tests for the probe's ramp math — findConcurrencyCeiling's boundary math is pure and testable; still the only nontrivial logic without a test.
- Audit Q6 (carried x4): .rpiv/artifacts keeps growing (~50 tracked md files). Pruning policy, or intentional archive?
- Audit Q7 (carried x3): negative state deltas still commit as "state: -N new seen post ids" — deliberate greppability, or should a negative delta say "pruned"?

## Suggested Follow-ups
- knip gate declined (N020): the dead-export class has recurred four times (runs #1-#5); without a CI gate it can silently regrow. Revisit if run #6 flags it again.
- Madge's 2 type-only cycles (judge.ts > judge-rotation.ts, judge.ts > judge-health.ts) remain by design; a leaf-contracts module would fix them and the audit rules it not worth the churn. If the N005 extraction touches those edges, keep them type-only.
- Operator: after this lands on main, restart watch-linkedin on the dedicated clone (git pull + restart) so the committed payload converts to v2 — the N018 contract.
- Operator (carried): verify orphaned GitHub secrets (open question 3).
- probe-judge.ts:107 drift is live today: an LLM_ACCOUNTS entry ending in /chat/completions works in production and double-appends in the probe — N021 fixes it, worth a fast follow if this pass slips.

## References
- .rpiv/artifacts/TECH_DEBT_AUDIT.md (run #5, the input report; all N-numbers and file:line citations)
- .rpiv/guidance/src/architecture.md (judge funnel, DI seams, payload reader contract)
- .rpiv/guidance/scripts/architecture.md (PC script exit contracts, entry-guard idiom)
- .rpiv/guidance/tests/architecture.md (offline suite rules for the N022 test)
- AGENTS.md (conventions, gates, module list)
