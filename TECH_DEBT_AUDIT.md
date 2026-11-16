# Tech Debt Audit — loker-watcher

Generated: 2026-11-15 · branch `ukind/feature-auto-login-threads` · commit `be5407a` · 24.1k LOC (src+scripts+tests, 656 tests)

## Executive summary

- Static gates are green: `tsc --noEmit` clean, `biome check` 78 files clean, `knip` clean, `npm audit` 0 vulnerabilities. The only red is one test file (F001).
- `npm test` fails on a clean Windows checkout: the capture absence-oracle in `tests/fetch-linkedin.test.ts` caught a real leak — a `fetchTick` test fired a response body through the production capture sink and wrote `captures/<stamp>/001-hiring-react.json`. The oracle self-disables once `captures/` exists, so repeat local runs go green and mask the leak (F001).
- The leg-dead alarm's operator remedy cites `DOCUMENTATION.md §13/§14` — a file absent from the repo. The LinkedIn spec of record lives on a private drive path (`H:/fork/linkedin-reverse/DOCUMENTATION.md`) (F002).
- madge finds 9 import cycles in the judge cluster + `linkedin-fetch ↔ linkedin-walk`. All verified type-only by the documented idiom, but no CI step freezes that property (F003).
- `HEALTH_CAP_STREAK` and `HARD_FAIL_TICKS_TO_CAP` must stay equal and are enforced only by comments (F004).
- The probe accepts any 2xx whose body contains `{` as a good leg — error-shaped 2xx bodies inflate committed ceilings (F005).
- Two re-export facades wait on the documented "run #7" removal; knip cannot see them (F006).
- Dev tooling majors lag (biome 1→2, knip 5→6, lint-staged 15→17, TS 5.9→7.0); runtime deps are near-current (F007).
- Debt density is low for 24.1k LOC: 16 findings (2 High, 4 Medium, 10 Low). Most big risks are documented accepted costs with revisit triggers.

## Resolution — run #7 (design 2026-11-15; marks land per phase)

| ID | Status | Where |
|----|--------|-------|
| F001 | RESOLVED — Slice 1 | six production seams pass the fs sink explicitly; 18 test blocks inject `NOOP_CAPTURE_SINK`; the two `??` defaults are gone |
| F015 | RESOLVED — Slice 1 | `tests/capture-oracle.ts` (shared snapshot + assert-absent + leaked-dir report); three suites re-pointed |
| F002 | DEFERRED | developer decision — the alarm keeps citing the missing DOCUMENTATION.md sections |
| F016 | AS-IS | leave the git-dependent skip; the skip message names the cause |
| F004 | RESOLVED — Slice 2 | `HEALTH_CAP_STREAK` exported; the equality test pins the pair in `tests/judge-health.test.ts` |
| F005 | RESOLVED — Slice 2 | the availability envelope gate replaces `includes("{")`; entry guard + injectable fetch + the replay suite `tests/probe-judge.test.ts` |
| F006 | RESOLVED — Slice 2 | both facades deleted; all 10 sites re-pointed atomically (8 mixed-import splits, 2 pure swaps) |
| F008 | RESOLVED — Slice 2 | `REQUEST_TIMEOUT_MS` rewritten as measured evidence (value + run 40264368939 + measured facts, no open questions) |
| F009 | RESOLVED — Slice 2 | README's PC-leg section documents both machine-default paths + their env overrides |
| F014 | RESOLVED — Slice 2 | `linkedin-fetch.ts` re-exports `SleepFn` from `sleep.js`; the `watch-linkedin.ts` consumer split keeps the re-export alive |
| F003 | RESOLVED — Slice 3 | `madge` devDependency + root `.madgerc` (`detectiveOptions.ts.skipTypeImports`) + `npm run cycles`; the committed script exits 0 on the type-only graph — verified locally before the ci.yml step merged (D7) |
| F010 | RESOLVED — Slice 3 | the freshness gate reads `FORCE` from step `env:`; no `${{ inputs.force }}` interpolation inside the gate bash |
| F012 | RESOLVED — Slice 3 | `format` covers `scripts/probe-judge.ts`, `scripts/hooks`, `watcher.config.json`; the config file deliberately stays out of lint (D9) |
| F013 | RESOLVED — Slice 3 | `npm audit --omit=dev` rides ci.yml as a non-blocking step (`continue-on-error`) |
| F007 | RESOLVED — Slice 4 | dev-tool majors + the two runtime minors landed last, policed by the frozen gates (typecheck → lint → test → knip → cycles → audit); `biome.json` migrated to the 2.x schema; TS 7 DEFERRED — madge 8's parser chain (ts-api-utils) crashes on the TS 7 API and pins the peer at ^5.4.4, so typescript stays ^5.9.3 until madge supports it |
| F011 | OPERATOR | `git worktree prune` on the main clone — one operator command, not a code change; the N043 policy stands |
| F017 | ACCEPTED — Slice 4 | 2 moderate advisories (minimatch ReDoS, GHSA-g3hv-75wg-m249) arrive with madge 8's dev-only chain (precinct → @typescript-eslint/typescript-estree → minimatch); `npm audit --omit=dev` stays 0, the runtime closure is clean, and no fix exists upstream — revisit when madge's detective deps bump |

## Architectural mental model

Single-shot CLI pipeline, no server: every 10 minutes GitHub Actions runs `src/index.ts` → fetch (Threads via Playwright walks; LinkedIn via a payload file pushed by an always-on PC browser loop) → extract → dedupe → recency → seen-dedupe → LLM judge (~10-post bulk calls across an account pool with 429 cooldowns, probe-measured per-account ceilings, provider-health caps) → per-surface email digest (heartbeat on zero matches) → atomic state persist → workflow commit-back via `scripts/commit-state-rebase.sh` (rebase + state-conflict skips + lease push + one retry). Composition rules are unusually disciplined: DI seams (`WatcherDeps`, trailing-param I/O), tagged errors instead of classes, `ENV_NAMES` as the single env-name source, fail-visible config validation with a closed key set, atomic temp+rename writes through `stateTempPath` with exactly one writer per committed state file, and oracle-channel logging (distinct outcomes never share a line prefix). The judge dispatch core (`judge-dispatch.ts`) returns directives instead of throwing; the terminal exhaustion is thrown once, after the join, carrying the health ledger for the flush. Type-only back-edges plus three module splits (rotation/shared/exhaustion) keep the dispatch graph acyclic at runtime — a property currently guarded by comments, not tooling. The PC-local LinkedIn leg (`scripts/*-linkedin.ts`) mirrors the same idioms with its own entry guards and exit contracts. The mental model matches AGENTS.md and README; no contradiction found. A prior audit's influence is visible in the code (commit-state-rebase.sh cites "TECH_DEBT_AUDIT.md:74" in its deviation ledger); that file is not in this worktree, so this report is a fresh baseline, not a repeat run.

## Findings

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|----------|-----------|----------|--------|-------------|----------------|
| F001 | Test debt | tests/fetch-linkedin.test.ts:75-77, scripts/fetch-linkedin.ts:438 | High | S | `fetchTick` defaults `captureSink: deps.captureSink ?? makeFsCaptureSink()`; `??` makes an undefined override re-create the production sink, so any fetchTick test whose fake page fires a flagship-web body writes repo-root `captures/`. Only 5 of 18 fetchTick test blocks mention `captureSink`. The `after()` oracle fails the whole FILE on a clean checkout (observed 2026-11-15: `captures/20261115T021815Z/001-hiring-react.json`); once `captures/` exists the oracle skips forever, hiding the leak locally | Pass an explicit no-op sink in every body-firing case (or export a `NOOP_CAPTURE_SINK` and default to it in tests); make the oracle name the leaked session dir and its files so the leaking case is identifiable from the failure alone |
| F002 | Documentation drift | src/email.ts:317; src/linkedin-session.ts:5,25; scripts/login-linkedin.ts:12 | High | S | The leg-dead alarm text — the operator's worst-day email — says "Failure matrix: DOCUMENTATION.md §13; session: §14". No `DOCUMENTATION.md` exists in the repo. The LinkedIn protocol spec of record is an absolute private path (`H:/fork/linkedin-reverse/DOCUMENTATION.md`), unreadable to any other contributor or checkout | Commit a `docs/failure-matrix.md` (or inline the matrix rows into the alarm text — it is a handful of lines); replace private-drive citations with repo-relative links; note the upstream doc's location as provenance, not as the pointer |
| F003 | Architectural decay (unpoliced invariant) | .github/workflows/ci.yml:24-31; src/judge-dispatch.ts:47-49; src/linkedin-walk.ts:24-27 | Medium | S | `npx madge --circular --extensions ts src` reports 9 cycles (judge cluster + linkedin-fetch↔linkedin-walk). Each edge is a documented type-only import erased by `verbatimModuleSyntax` — verified — but the "zero runtime cycle" property is enforced by comments only. One accidental runtime import silently closes a real cycle; no tool in CI would notice | Add one CI step: `npx madge --circular --extensions ts src`. It freezes today's clean runtime graph for ~one line of YAML |
| F004 | Type & contract debt | src/judge-rotation.ts:66; src/judge-health.ts:47 | Medium | S | `HEALTH_CAP_STREAK = 2` (rotation's inlined pick predicate) and `HARD_FAIL_TICKS_TO_CAP = 2` (health module) are a paired-constant pair that "MUST stay equal" per doc comments at both sites. The deliberate zero-import boundary means a one-sided change compiles and passes the behavioral pin (tests/judge-rotation.test.ts:909 pins 2 on one side only) while silently splitting the cap semantics | Add a three-line test importing both constants and asserting equality. The duplication is the right call for the boundary; the equality is currently unaudited |
| F005 | Gate quality | scripts/probe-judge.ts:122 | Medium | S | Ramp "ok" is `body.includes("{")` on any 2xx: an error envelope, an HTML interstitial, or a truncated answer counts as a good leg, inflating committed per-account ceilings in `state/judge-ceilings.json` for the next 8 hours. The guidance docs flag this as a known caveat; it remains live | Require the minimal production shape (`choices[0].message.content` is a string) for a leg to count as ok. Keeps the "probe measures the exact production call" property |
| F006 | Architectural decay | src/judge.ts:31-36; src/linkedin-fetch.ts:46-58 | Medium | M | Two re-export facades kept so tests/scripts stay unedited, each with a REMOVAL NOTE tagged "run #7": judge.ts (2 symbols, 3 import sites) and linkedin-fetch.ts (8 symbols, 7 files). They are knip-safe by design, so the CI "Unused exports" gate cannot flag them; the debt is tracked but unbounded in time | Do run #7: re-point the 10 import sites, delete both blocks, let the removal notes' file references go with them. One PR, no behavior change |
| F007 | Dependency debt | package.json:33-41 (npm outdated, 2026-11-15) | Medium | M | Dev-tooling majors lag: @biomejs/biome 1.9.4→2.6.7, knip 5.88.1→6.45.1, lint-staged 15.5.2→17.6.0, @types/node 22.20.5→26.6.6, typescript 5.9.3→7.0.2. Runtime deps near-current (playwright 1.64.1→1.65.1, nodemailer 10.3.1→10.5.0). `npm audit`: 0 vulnerabilities, so nothing is security-driven | One bump PR for dev deps, gates verify. TS 7 and biome 2 may carry rule changes — budget an afternoon for lint/format churn, keep playwright/nodemailer minor bumps in the same PR |
| F008 | Documentation drift | src/judge-dispatch.ts:56-62 | Low | S | The `REQUEST_TIMEOUT_MS` comment still narrates an open question ("15s was never validated… Phase 0 measures the real latency from the runner and confirms this value") above a value that has been 60s since that measurement shipped. Reads as an unresolved TODO; the probe revisions through 2026-11-07 are the actual evidence | Rewrite as the repo's measured-evidence form: "60_000 — runner-measured (run 40264368939: 15s timed out every batch); the probe's minimal call confirms headroom" |
| F009 | Config debt | src/linkedin-fetch.ts:97; scripts/login-linkedin.ts:33 | Low | S | Windows-literal machine defaults committed in code: `LINKEDIN_PROFILE_DIR = "C:/loker-secrets/linkedin-chromium-profile"`, `DEFAULT_COOKIE_PATH = "C:/loker-secrets/linkedin-cookies.json"`. Both PC-local (the hosted run never resolves them) and both carry env escape hatches (`LINKEDIN_PROFILE_DIR`, `LINKEDIN_COOKIES_FILE`), so this is a portability wart, not a defect | Document both paths + overrides in README's PC-leg section (they currently live in code comments); or derive a home-relative default with the C:/ literal as the documented legacy fallback |
| F010 | Security hygiene | .github/workflows/watch.yml:69 | Low | S | `${{ inputs.force }}` is interpolated directly into the freshness gate's bash. Safe today because the input is a typed boolean (renders only "true"/"false"), but the pattern is the one the repo's own doctrine warns about for secrets | Route through step `env:` (`FORCE: ${{ inputs.force }}` → `[ "$FORCE" = "true" ]`). Pure hygiene; no behavior change |
| F011 | Operational | H:/fork/loker-watcher/.git (git count-objects, 2026-11-15) | Low | S | `git count-objects` warns "garbage found: .git/worktrees/8836-…/refs" — a stale worktree ref in the shared .git this worktree hangs off. Pack size is 18.08 MiB, up from the 12.4 MiB recorded at the N043 audit — the documented growth curve is on schedule | `git worktree prune` on the main clone. The N043 policy (gc once, no schedule; revisit when clone size/checkout time bites) stands — 18 MiB is not yet the trigger |
| F012 | Consistency | package.json:15; watcher.config.json:1 | Low | S | `npm run format` covers src, tests, and enumerated scripts — not `watcher.config.json` (3-space indent, the one JSON file a human edits most) nor `scripts/hooks/*.js` (linted, never formatted) | Add the config file and hooks to the format list (biome formats JSON). Or accept and note it |
| F013 | CI gap | .github/workflows/ci.yml:24-31 | Low | S | `npm audit` runs only when someone remembers it; CI checks typecheck/lint/test/knip but no dependency audit | Add `npm audit --omit=dev` (or full) as a non-blocking CI step; schedule the result review with the F007 bump |
| F014 | Consistency | src/linkedin-fetch.ts:73; src/sleep.ts:17 | Low | S | `SleepFn` is declared twice: the cross-domain seam module (sleep.ts) and a local copy in linkedin-fetch.ts. Consumers import from either (watch-linkedin.ts imports the linkedin-fetch one). Same concept, two names, drift risk is cosmetic but real | Re-export `SleepFn` from sleep.ts in linkedin-fetch (`export type { SleepFn } from "./sleep.js"`) and keep one canonical declaration |
| F015 | Test consistency | tests/fetch-linkedin.test.ts:63-79; tests/probe-linkedin.test.ts:54-67; tests/linkedin-fetch.test.ts:1318-1326 | Low | S | The captures absence-oracle is hand-rolled three times with the same snapshot-in-`after` shape (and a fourth variant asserting a production-default sink throws). Each copy must stay in sync with the sink's root resolution (`LINKEDIN_CAPTURES_ROOT`, src/config.ts:81) | Extract `tests/capture-oracle.ts` helper (snapshot + assert-absent + leaked-dir report); the F001 fix should land through it so all three suites inherit the improvement |
| F016 | Test portability | tests/fetch-linkedin.test.ts:283 | Low | S | The git-pinning suite `t.skip`s when git is not on PATH — a soft dependency in an otherwise hermetic suite. Correct on CI (git always present), invisible locally | Leave as-is; the skip message names the cause. Recorded so the suite's "offline and deterministic" claim carries this one asterisk |

## Top 5 — if you fix nothing else, fix these

1. **F001 — Close the capture-sink leak.** Export a `NOOP_CAPTURE_SINK` from `src/linkedin-capture.ts`; in `tests/fetch-linkedin.test.ts` pass it in every `fetchTick({…})` block that can fire a body (the 13 blocks that do not mention `captureSink` today); do the same for the 7 `runProbe` calls in `tests/probe-linkedin.test.ts` (`scripts/probe-linkedin.ts:183` has the identical `?? makeFsCaptureSink()` default). Then delete the leaked `captures/` dir and run `npm test` twice from a clean checkout — both must be green. ~30 minutes; the full suite re-runs in ~23 seconds.
2. **F002 — Fix the worst-day pointer.** The leg-dead alarm is the email you read when the PC leg dies. Either commit `docs/failure-matrix.md` with the §13/§14 content from `H:/fork/linkedin-reverse/DOCUMENTATION.md`, or inline the matrix into `buildLegDeadAlarmText` (src/email.ts:317). ~1 hour for the committed doc, ~15 minutes to inline.
3. **F003 — Freeze the acyclic runtime graph.** Add to ci.yml after the knip step:
   ```yaml
   - name: No runtime import cycles
     run: npx madge --circular --extensions ts src
   ```
   Today it passes (all 9 madge cycles are type-only, verified edge by edge). Its job is to fail the first accidental runtime back-edge. ~10 minutes.
4. **F004 — Pin the paired constant.** In `tests/judge-health.test.ts`:
   ```ts
   import { HARD_FAIL_TICKS_TO_CAP } from "../src/judge-health.js";
   import { HEALTH_CAP_STREAK } from "../src/judge-rotation.js";
   it("the paired cap constants stay equal", () => {
     assert.equal(HEALTH_CAP_STREAK, HARD_FAIL_TICKS_TO_CAP);
   });
   ```
   ~10 minutes. This is the cheapest drift guard in the report.
5. **F005 — Tighten the probe's leg check.** Replace `const ok = body.includes("{")` (scripts/probe-judge.ts:122) with a parse: `const ok = (() => { try { return typeof (JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content === "string"; } catch { return false; } })();` — mirrors the dispatch core's own read of the same envelope (src/judge-dispatch.ts:209). Ceilings stop inheriting error-body inflation. ~20 minutes including a replay test.

## Quick wins (Low effort × Medium+ severity)

- [ ] F004: paired-constant equality test (3 lines)
- [ ] F003: madge step in ci.yml (3 lines of YAML)
- [ ] F008: rewrite the stale REQUEST_TIMEOUT_MS comment as measured evidence
- [ ] F010: env-indirect `inputs.force` in the freshness gate
- [ ] F011: `git worktree prune` on the main clone
- [ ] F014: single `SleepFn` declaration via re-export

## Things that look bad but are actually fine

- **9 circular dependencies from madge.** The headline number is real; the edges are not. Every cycle closes through a type-only import (`import type`) that `verbatimModuleSyntax` erases — the idiom is documented at each site (src/judge-dispatch.ts:47-49, src/linkedin-walk.ts:24-27, src/judge-rotation.ts:44-48) and the module splits exist precisely to keep runtime edges one-way. Risk is future drift, which F003's CI step addresses — the design itself is sound.
- **state/seen-posts.json history growth** (4.3 MB file, 1,519 commits, pack now 18.08 MiB). Looks alarming in `git log --stat`; it is the documented N043 policy with explicit revisit triggers, and the state file stays bounded by the 72h prune.
- **Machine-literal defaults** (F009's paths). Hosted runs never resolve them; both have env overrides; single-operator PC leg. Fine as long as they stay documented.
- **Console.log/warn as the only observability.** Normally a finding. Here it is a deliberate oracle-channel doctrine — stable prefixes, one line per outcome — consumed by a human reading Actions logs and by tests asserting exact strings. No log aggregation exists to shortchange.
- **`as` casts on the LLM envelope** (src/judge-dispatch.ts:209) and non-null assertions (`user!` in email.ts). Both sit behind shape-tolerant reads (`?.` chains) and validated resolvers; biome's `noNonNullAssertion` is explicitly off with the trade documented.
- **Bash commit-back script outside typecheck/lint.** `commit-state-rebase.sh` is unlintable by biome but is spawnSync-tested offline by tests/commit-state-rebase.test.ts with a deviation ledger in its header — better guarded than most YAML inlined bodies.
- **The 62-call probe worst case.** Documented in the workflow comment with the freshness gate bounding it to once per 8 hours; deliberate measured-evidence spend, not runaway cost.
- **`tsc` "failure" during this audit** was an empty `node_modules` in this worktree, not code debt — resolved by `npm ci`, exit 0 after.

## Open questions for the maintainer

- Is CI currently green on the latest PR to main? The F001 leak fires on a fresh checkout here; if a body-firing fetchTick case runs on Linux too, ci.yml's Test step should be red on this branch — worth one Actions look before trusting the suite.
- Was `DOCUMENTATION.md` (§2.4, §13, §14) ever intended for the repo, or is the private `H:/fork/linkedin-reverse` copy its permanent home? F002's fix shape depends on the answer.
- Is `C:/loker-secrets` the permanent operator standard for profile/cookies, or should a second development machine expect to override both env vars on day one?
- The "run #7" facade removals (F006) — is there a planned run #7, or should they be a standalone PR independent of the run cadence?
- The freshness gate hard-codes 28800 (8h) in watch.yml and `probedAt` is the committed clock — intentional per the tuning-values doctrine, but the gate and the probe's writer must drift together. Confirm no plan to make the window per-account.
