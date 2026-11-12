---
date: 2026-11-12T09:55:42+0700
author: Yogiswara Utama
commit: 559ad54
branch: main
repository: loker-watcher
topic: "LinkedIn operator chain shape (login -> probe -> one fetch tick)"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, linkedin-chain, login-linkedin, probe-linkedin, fetch-linkedin, watch-linkedin, scripts]
last_updated: 2026-11-12T10:34:06+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Option 4 agent-scored; hold mechanic corrected everywhere; effort labels unified; verdict confirmed"
---

# Solution Analysis: LinkedIn operator chain shape (login -> probe -> one fetch tick)

**Date**: 2026-11-12T09:55:42+0700
**Author**: Yogiswara Utama
**Commit**: 559ad54 (the working tree carries same-day uncommitted edits to scripts/login-linkedin.ts, scripts/probe-linkedin.ts, src/linkedin-fetch.ts, tests/login-linkedin.test.ts — all evidence below describes the WORKING TREE)
**Branch**: main
**Repository**: loker-watcher

## Research Question
Chained from `.rpiv/artifacts/research/2026-11-12_09-30-27_linkedin-scroll-pagination-session-hygiene.md`: the operator chain login (operator presses Enter in the terminal; the script closes the browser) -> probe-linkedin -> on pass, one fetch-linkedin tick -> stop is decided protocol, but nothing chains the three entries today. Which shape runs the chain: a new wrapper script, a probe gate inside the fetch tick, a Claude Code slash command, or documented operator commands?

## Summary
**Problem**: three verified entries (login, probe, tick) exist but nothing sequences them; the decided session-hygiene protocol needs a shape that fails visibly when a gate fails.
**Recommended**: Chain wrapper script — one new PC-local entry sequences the whole chain and maps every gate failure to a nonzero exit; it rides the strongest precedents (scripts import scripts; 3 of 4 entries already export an entry function) and verifies fully offline.
**Effort**: Medium (1 day)
**Confidence**: High

## Problem Statement

**Requirements:**
- Run login -> probe -> exactly one fetch tick, in the decided order, with the operator hand on the login release only (Enter in the terminal, not a hand-closed window).
- Fail visible: every gate failure exits nonzero with a message that names the problem.
- Add no env knobs, no config keys, no timed cooldown (FR-4 dropped by decision).

**Constraints:**
- Hard: guardCheckout requires a clean main checkout (scripts/fetch-linkedin.ts:349, :246-262) — the chain code must be committed before the chain runs.
- Hard: the persistent profile (C:/loker-secrets/linkedin-chromium-profile, scripts/login-linkedin.ts:35; src/linkedin-fetch.ts:385) tolerates one browser at a time.
- Hard: the probe is contractually read-only and standalone ("the fetch tick never consults it", scripts/probe-linkedin.ts:12-14).
- Soft: the tick's window/latch no-ops exit 0 (scripts/fetch-linkedin.ts:333-344) — the exit code alone does not distinguish "ran" from "no-op".

**Success criteria:**
- One command runs the whole chain; a probe failure or a tick failure exits nonzero and names the gate.
- The offline suite pins the order (login -> probe -> tick), the single-tick stop, and every failure mapping.
- Docs match code: probe floor 10 everywhere (today AGENTS.md:38, README.md:314, and .rpiv/guidance/scripts/architecture.md:90 still say 2).

## Current State

**Existing implementation:**
- Login ends at close: Enter -> context.close() (scripts/login-linkedin.ts:245-251); keep-open is the default (`keepOpen: !--auto-close`, :255-257); profile-lock warning :242-244; feed-first warm-up :227-239.
- Probe: top-level await runs the walk on import — it exports NO function (scripts/probe-linkedin.ts:33, :55-105); exit contract HALT / LEG DEAD / FAILED / floor all exit 1 (:91-105); floor 10 (:83-88); PROBE_MIN_CLICKS=5 (:40).
- Tick: preflight order window -> halt latch -> guardCheckout -> cookie + harvestedAt presence -> walk (scripts/fetch-linkedin.ts:333-361); walk :374-382; halt trips the latch and alarms (:387-391); latch repo-local (:139); window/latch no-ops return quiet zeros and exit 0.
- Watch: runLoop composes fetchTick (scripts/watch-linkedin.ts:21, default tick :50) — immediate first tick + 28-33 min jitter (:41-79).

**Relevant patterns:**
- Script imports script: watch-linkedin.ts:21 composes fetchTick; reset-linkedin.ts:28-29 imports constants from the fetch and login scripts. Used by 2 scripts.
- Exported entry function + injected deps: runLoginHelper (scripts/login-linkedin.ts:194; tests/login-linkedin.test.ts:22-27), fetchTick (tests/fetch-linkedin.test.ts:26-31), runLoop (tests/watch-linkedin.test.ts:14-16). Used by 3 of 4 linkedin entries — probe is the only holdout.
- Side-effect-free entry pin: tests/watch-linkedin.test.ts:9-11.

**Integration points:**
- scripts/probe-linkedin.ts:55-105 — the only entry without an export; a wrapper needs runProbe or a subprocess.
- scripts/fetch-linkedin.ts:413 — the one-shot tick entry; fetchTick({env}) is the reusable seam (:315).
- package.json:12-13 — npm scripts + the explicit lint/format enumeration for any new scripts/ entry.
- README.md:301-315, AGENTS.md:36-52, .rpiv/guidance/scripts/architecture.md:84-92 — the four doc surfaces that carry operator protocol today.

## Solution Options

### Option 1: Chain wrapper script
**How it works:**
A new PC-local entry scripts/linkedin-chain.ts (npm run linkedin-chain) hosts the whole sequence: it opens the login helper and holds until the operator presses Enter in the terminal (the helper's finally block closes the browser), then runs the probe (refactored to export runProbe), and on pass runs exactly one fetchTick. The wrapper must run in a real TTY — waitForEnter is a readline on process.stdin (scripts/login-linkedin.ts:167-171). Each stage failure maps to a nonzero exit that names the gate; the tick's quiet-zero no-ops are reported as no-ops, not as failures.

**Pros:**
- Strongest precedent: scripts already import scripts (watch-linkedin.ts:21, reset-linkedin.ts:28-29); 3 of 4 linkedin entries already export an entry function the wrapper can call.
- Fully offline-verifiable: the import + injected-deps idiom (tests/watch-linkedin.test.ts:14-16, tests/fetch-linkedin.test.ts:13-15) covers order, the single-tick stop, and every failure mapping with zero browser.
- One automation boundary to audit: the navigation cadence stays "login, one probe walk, one tick" — exactly the decided protocol, nothing more.

**Cons:**
- probe-linkedin.ts exports nothing today — a refactor is required (top-level await walks on import, probe-linkedin.ts:33, :55-105).
- Largest single change of the three: a new file of ~80-120 lines plus npm script, lint enumeration, and docs.

**Complexity:** Medium (~1 day)
- Files to create: 2 (scripts/linkedin-chain.ts ~80-120 lines; tests/linkedin-chain.test.ts ~100 lines)
- Files to modify: 5 (probe export ~20-40 lines, package.json, AGENTS.md, README.md, guidance scripts arch)
- Risk level: Low

### Option 2: Probe-gated fetch tick
**How it works:**
No new entry. scripts/fetch-linkedin.ts gains a probeWalk preflight gate: after the cheap gates, it runs a read-only probe walk and aborts before the real walk when the probe fails.

**Pros:**
- Smallest diff surface: one gate + dep in fetch-linkedin.ts (~40-70 lines) and its existing test file (~60-100 lines).
- No npm script, no lint enumeration, no docs rewrite beyond the chain description.

**Cons:**
- Violates the probe's written contract: "no payload, no push, no latch... the fetch tick never consults it" (scripts/probe-linkedin.ts:12-14).
- Two headed walks on the same persistent profile per tick (src/linkedin-fetch.ts:332, :385) — doubled navigation cadence and roughly doubled wall-clock on EVERY 28-33 min watch tick (scripts/watch-linkedin.ts:74), not just post-login. That re-heats the exact session risk this topic defuses.
- Preflight pricing inversion: the band's own comments price gates cheap-first ("zero git spawns, zero cookie reads, zero browser navigations", scripts/fetch-linkedin.ts:326-331); a walk is the most expensive preflight possible.
- Halt semantics blur: the tick's halt arm trips the operator-cleared latch + alarm (:387-391) while the probe's contract is clean exit-1, latch-free (:90-93).

**Complexity:** Medium (~1 day)
- Files to create: 0
- Files to modify: 2 (scripts/fetch-linkedin.ts ~40-70 lines; tests/fetch-linkedin.test.ts ~60-100 lines)
- Risk level: High (per-tick session heat + contract violation)

### Option 3: Documented operator protocol
**How it works:**
No new code. The chain is written into README.md:301-315, AGENTS.md:36-52, and .rpiv/guidance/scripts/architecture.md:84-92; the operator runs the three existing commands by hand, in order.

**Pros:**
- Lowest cost of all: ~4 files, ~60 lines; doc-only commits carrying operational weight have direct precedent ("docs: document external cron-job.org trigger", "docs: document judge concurrency and the probe ramp").
- Protocol prose already lives in four places (README.md:301-315; AGENTS.md:36-52; guidance arch :84-92; the in-code comment scripts/probe-linkedin.ts:25-27) — this option consolidates rather than invents.

**Cons:**
- Prose cannot satisfy fail-visible (AGENTS.md Conventions): docs never exit nonzero and never alarm; a failed gate "succeeds" silently in the operator shell.
- Drift is proven, not hypothetical: the probe floor moved 2 -> 10 in code and the docs still say 2 on three surfaces (AGENTS.md:38, README.md:314, guidance arch :90); guidance arch :39-40 still says "headless context from the cookie document" vs the headed persistent profile (probe-linkedin.ts:55-79).
- Nothing machine-reads the docs (biome ignores .rpiv, biome.json:7; no CI or hook checks markdown) — nothing catches a wrong doc.
- The duplicated in-code protocol comment (probe-linkedin.ts:25-27) drifts again by construction.

**Complexity:** Low (~2 hours)
- Files to create: 0
- Files to modify: 3-4 (~60 lines)
- Risk level: Medium (silent failure mode, proven drift)

### Option 4: Claude Code slash command
**How it works:**
A markdown command under `.claude/commands/` (existing precedent: `.claude/commands/e2e-validate.md`, a one-line pointer to a skill) instructs the agent to run the three npm scripts in order. No new TypeScript, no lint enumeration, no package.json entry.

**Pros:**
- Zero code: no new file inside typecheck/lint/lint-staged, no npm script, no probe export refactor.
- Exit codes still propagate through the agent's Bash calls, so a failed gate is visible in the transcript.

**Cons:**
- **Cannot own the login leg**: `waitForEnter` is a readline on `process.stdin` (scripts/login-linkedin.ts:167-171). An agent-spawned Bash call has no TTY: `rl.question` rejects on piped/closed stdin, no catch exists, so the leg runs to FAILED exit 1 — with the cookie file and `.env` line ALREADY written (scripts/login-linkedin.ts:207-220). The command covers probe -> tick only, after a separately-run login.
- Fail-visible is delegated to the agent's judgment rather than a process exit contract; nothing pins the order offline.
- `.claude/settings.json` gates Bash through `gate-destructive.js`; the hook matches none of the three npm scripts today (scripts/hooks/gate-destructive.js:6-19), but any mid-chain denial leaves earlier legs executed — no rollback mechanism exists.
- Sequencing is untestable: the login test injects `enterWait` (tests/login-linkedin.test.ts:189-192) and probe has NO test file, so nothing exercises the production stdin path or the command's order — prose-carried sequencing has no machine pin (the floor-2 drift precedent).

**Complexity:** Low (~1 hour)
- Files to create: 1 (`.claude/commands/linkedin-chain.md`, ~10 lines)
- Files to modify: 0
- Risk level: Medium (no offline pin; login leg fails without a TTY)

## Comparison

| Criteria | Option 1: Chain wrapper | Option 2: Probe-gated tick | Option 3: Docs only | Option 4: Slash command |
|----------|----------|----------|----------|----------|
| approach-shape | new composition entry (script imports scripts) | inline gate inside an existing entry | prose only | agent-mediated command file |
| Complexity | M (~1 day) | M (~1 day) | L (~2 h) | L (~1 h) |
| Codebase fit | H (3 of 4 entries already export; scripts import scripts) | L (violates probe contract + preflight pricing) | M (doc precedent strong; fail-visible unsatisfiable) | M (command precedent exists; login leg excluded) |
| Risk | L (one-shot; cadence = decided protocol) | H (2 walks per tick, forever) | M (drift proven, silent failure) | M (no offline pin; login leg fails without a TTY) |

## Dimension Coverage

Five dimensions were confirmed at the Step 3 checkpoint. Four (precedent-fit, integration-risk, migration-cost, verification-cost) were scored per candidate by three parallel codebase-analyzer agents against the working tree, plus one follow-up agent for the late-added Option 4. The fifth, **approach-shape**, is the hybrid dimension the orchestrator scores after the agents return; it is the first row of the comparison table above — the category of solution each candidate is (composition entry / inline gate / prose / agent-mediated command file). No cell was dropped.

## Recommendation

**Selected:** Option 1 — Chain wrapper script

**Candidate-set status:** confirmed. The full four-candidate set was re-presented and approved; Option 4 was then scored by a dedicated codebase-analyzer pass (working tree), which confirmed and sharpened the disqualifier: an agent-spawned login fails exit 1 after a half-complete harvest (`rl.question` rejects on piped stdin, scripts/login-linkedin.ts:167-171; the cookie write lands at :207-220), probe has no test file, and no lock-check code guards the shared profile — the prose warning (scripts/login-linkedin.ts:243) is the only guard. Option 1 (chain wrapper script) stands.

**Rationale:**
- It is the only shape that keeps the decided cadence (one login, one probe walk, one tick) AND fails visibly: every gate failure maps to a nonzero exit that names the gate, and the tick's quiet-zero no-ops are reported as no-ops.
- The precedent is quantified: 3 of 4 linkedin entries already export an entry function with injected deps (login-linkedin.ts:194, fetch-linkedin.ts:315, watch-linkedin.ts:41); scripts already import scripts (watch-linkedin.ts:21, reset-linkedin.ts:28-29). The wrapper is the missing fourth export consumer, not a new pattern.
- Verification is fully offline: the entry-guard pin, the order pin, the one-tick stop, and the failure mappings all ride the existing import + injected-deps test idiom (tests/watch-linkedin.test.ts:9-16, tests/fetch-linkedin.test.ts:13-15).

**Why not alternatives:**
- Option 2: a per-tick probe doubles automated navigations on every 28-33 min tick — it re-heats the session risk the whole topic exists to defuse — and it contradicts two written contracts (the probe is never consulted by the tick, probe-linkedin.ts:12-14; cheap-first preflight pricing, fetch-linkedin.ts:326-331).
- Option 3: prose cannot exit nonzero or alarm, so the repo's fail-visible non-negotiable is unsatisfiable; the floor-2 drift surviving across three doc surfaces is the existence proof.
- Option 4: cannot own the login leg — `waitForEnter` is a readline on `process.stdin` (scripts/login-linkedin.ts:167-171) and an agent-spawned Bash call has no TTY — `rl.question` rejects (no catch), so the login leg exits 1 after a half-complete harvest. It covers probe -> tick only, delegates fail-visible to agent judgment, and pins nothing offline.

**Trade-offs:**
- Accepting a probe export refactor (probe-linkedin.ts walks at import today) in exchange for subprocess-free composition and offline tests.
- Accepting that the wrapper runs only from a clean, committed main clone (guardCheckout, fetch-linkedin.ts:349) — the operator precondition already in force.

**Implementation approach:**
1. Extract runProbe from scripts/probe-linkedin.ts (entry-guarded, import stays side-effect free) — mirrors the runLoginHelper shape.
2. Add scripts/linkedin-chain.ts: login hold (operator presses Enter in the terminal; runLoginHelper's finally block closes the browser) -> runProbe -> on pass, exactly one fetchTick; map probe exit-1 and tick failure to nonzero exits that name the gate; report window/latch quiet-zero no-ops distinctly. The wrapper MUST run in a real TTY: waitForEnter is a readline on process.stdin (scripts/login-linkedin.ts:167-171), so a piped-stdin or agent-spawned invocation FAILS at stage 1: `rl.question` rejects, no catch exists, and the run exits 1 after the harvest already landed on disk.
3. Register the npm script and append the entry to the explicit lint/format enumeration (package.json:12-13).
4. Offline tests: side-effect-free import pin, order pin, one-tick-then-stop, probe-fail -> no tick + nonzero, tick-fail -> nonzero, no-op -> reported not failed.
5. Docs: rewrite README.md:301-315 and the AGENTS.md chain text around the wrapper; fix the stale probe floor (AGENTS.md:38, README.md:314, guidance arch :90) and the stale headless/cookie-document line (guidance arch :39-40).

**Integration points:**
- `scripts/probe-linkedin.ts:55-105` - add the runProbe export behind the existing entry guard.
- `scripts/linkedin-chain.ts` (new) - the sequence + failure mapping.
- `package.json:12-13` - npm script + lint/format enumeration.
- `README.md:301-315`, `AGENTS.md:36-52`, `.rpiv/guidance/scripts/architecture.md:84-92` - chain docs + drift fixes.
- `tests/linkedin-chain.test.ts` (new) - offline pins riding the tests/watch-linkedin.test.ts:9-16 idiom.

**Patterns to follow:**
- Exported entry + injected deps: scripts/login-linkedin.ts:194 (LoginContext seam, tests/login-linkedin.test.ts:22-27).
- Script-imports-script composition: scripts/watch-linkedin.ts:21.
- Entry-guard side-effect-free pin: tests/watch-linkedin.test.ts:9-11.

**Risks:**
- Back-to-back probe + tick navigations post-login: accepted by decision — the observed kick trigger was the missing feed visit, not timing; feed-first is mandatory (login-linkedin.ts:227-239). The wrapper stays one-shot; watch-linkedin keeps its manual start.
- Profile lock while the login window is open: the wrapper ticks only after runLoginHelper resolves (Enter -> finally close, scripts/login-linkedin.ts:246-252); the LOCKED warning (:242-244) stays the operator signal. A hand-closed window does NOT release the hold — only Enter does. No lock-check code exists — the prose warning (scripts/login-linkedin.ts:243) is the only guard (confirmed by the Option 4 scoring pass).

## Scope Boundaries
- We are building: the one-shot chain entry, the probe export it needs, the offline test pins, and the doc corrections that make the chain legible.
- We are NOT doing: any timed cooldown (FR-4 dropped), any auto-start of watch-linkedin, new env vars or config keys, the LINKEDIN_RESPONSE_RE widening / FR-2 stop-line visibility / the round-1 loadMore-0 skip (all decided in research; they ride design and implement as fixed scope, not as options here), or any change to the hosted run.

## Testing Strategy

**Unit tests:**
- Import is side-effect free (entry-guard pin, mirrors tests/watch-linkedin.test.ts:9-11).
- Order pin: login -> probe -> tick, and no tick without a probe pass (extends the fetch order-pin idiom, tests/fetch-linkedin.test.ts:10-12).
- Probe failure (exit 1) -> no tick, wrapper exits nonzero and names the gate.
- Tick failure -> wrapper exits nonzero; the halt latch state stays visible in the report.
- Window/latch no-op (quiet zeros, exit 0 from fetchTick) -> reported as no-op; the wrapper does not treat it as a run.
- Exactly one tick then stop (no loop, no watch hand-off).

**Integration tests:**
- None offline-reachable; the browser walks stay behind the injected seams.

**Manual verification:**
- [ ] Run the chain on the dedicated clone after the next login harvest: probe passes -> exactly one payload push -> process exits 0.
- [ ] Trip the probe gate deliberately (expired session) -> wrapper exits nonzero, no navigation after the probe.
- [ ] Hold the login window open past the hold -> the LOCKED warning prints, no second browser launches.

## Open Questions
**Resolved during research:**
- Does any script already sequence another entry? Yes — watch-linkedin.ts:21 composes fetchTick; reset-linkedin.ts:28-29 imports both scripts. The wrapper extends this pattern.
- Can the wrapper call the probe directly? Not today — probe-linkedin.ts walks at import and exports nothing (:33, :55-105). The export refactor is part of this option; a subprocess needs the heavier spawnSync-doubles idiom (tests/gate-destructive.test.ts:12) and loses the offline order pins — rejected.
- Does the exit code alone tell \"ran\" from \"no-op\"? No — the tick's window/latch no-ops exit 0 (fetch-linkedin.ts:333-344). The wrapper inspects postCount and the latch, not the exit code alone.
- What releases the login hold? Enter in the terminal, NOT a hand-closed browser window: waitForEnter is a readline on process.stdin (scripts/login-linkedin.ts:167-171) and the finally block closes the browser (:250-252). A hand-closed window does not release the hold. Without a TTY, `rl.question` rejects (no catch) and the leg exits 1 after a half-complete harvest. Consequence: the wrapper must run in a real TTY, and any agent-mediated shape (Option 4) cannot own the login leg.

**Requires user input:**
- None blocking. The login-leg ownership question is resolved by the hold mechanic: the wrapper owns the full sequence and must run in a TTY (Enter releases stage 1; a hand-closed window does not).

**Blockers:**
- None. Three independent agents verified all anchors against the working tree.

## References

- `.rpiv/artifacts/research/2026-11-12_09-30-27_linkedin-scroll-pagination-session-hygiene.md` - the research this solution chains from (chain decision, widening decision, doc-drift findings)
- `.rpiv/artifacts/discover/2026-11-12_07-50-38_linkedin-scroll-pagination-session-hygiene.md` - the FRD (9 decisions, viewport-variant addendum)
- `scripts/fetch-linkedin.ts:315-361` - the verified preflight gate order any chain must respect
- `scripts/probe-linkedin.ts:12-14, :83-105` - the read-only contract and the exit-contract table
- `scripts/login-linkedin.ts:227-261` - feed-first warm-up, keep-open hold, entry guard
- `scripts/watch-linkedin.ts:21, :41-79` - the script-composition precedent and the loop this option does NOT touch
- `.rpiv/guidance/scripts/architecture.md:84-92` - the exit-contract table (the stale floor rides implement)
- `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` - the PC-local leg design (tick/loop/probe/login shapes)