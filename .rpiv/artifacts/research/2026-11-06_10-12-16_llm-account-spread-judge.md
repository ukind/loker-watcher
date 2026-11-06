---
date: 2026-11-06T10:12:16+0700
author: Yogiswara Utama
commit: 04424f5
branch: main
repository: loker-watcher
topic: "Spread LLM judge load across all accounts using probe-measured per-account ceilings"
tags: [research, codebase, judge, judge-rotation, judge-ceilings, probe-judge, watch-workflow]
status: ready
last_updated: 2026-11-06T10:12:16+0700
last_updated_by: Yogiswara Utama
---

# Research: Spread LLM judge load across all accounts using probe-measured per-account ceilings

## Research Question

How does the reactive account rotation in the LLM judge work today, and what must change — in `src/judge-rotation.ts`, `src/judge.ts`, `scripts/probe-judge.ts`, `.github/workflows/watch.yml`, and `scripts/commit-state-rebase.sh` — so every `LLM_ACCOUNTS` entry carries load from the first dispatch, each capped at its probe-measured concurrency ceiling persisted to a committed JSON file, with `JUDGE_CONCURRENCY` superseded? Chained from the discover FRD `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md`.

## Summary

- Today every dispatch scans the pool from account 1 with no memory (`pickEligibleAccount`, `src/judge-rotation.ts:84-95`); the pool spreads only after 429s cool earlier accounts. Five tests in `tests/judge-rotation.test.ts` pin this reactive order and are directly falsified by the acceptance criterion "first 5 judge calls hit 5 distinct accounts" — the rewrite list is explicit and exhaustive because `src/judge.ts:378` is the single pick site.
- The probe already computes a per-account ceiling (`findConcurrencyCeiling`, `scripts/probe-judge.ts:133-156`, domain {0, 1, 2, 4}) but only prints it (`:233-235`); nothing writes it. Dead accounts can carry plausible ceilings (auth-dead reads as 1; a failed-leg account can ramp clean to 4), so the checkpoint settled: **write live-only readings, before the gate**.
- The ceilings file is a flat `{baseUrl: ceiling}` map (no staleness bound — the FRD open question is resolved by decision), read by a degrade-never-throws reader in the `readPayloadPosts` style but with a per-account default of 1 plus exactly one warning — a fourth reader doctrine between `loadWatcherConfig` (fail-visible) and `loadState` (ENOENT-only degrade).
- The watch job can never read the same-run probe's write: the probe and watch jobs run in parallel on dispatch (no `needs:`, `watch.yml:24-45` vs `:47+`), and the watch checkout snapshots the dispatch SHA. Checkpoint settled: **the probe job commits the ceilings file** (it gains `fetch-depth: 0`, bot identity, and a ceilings-only add + rebase/push reusing `commit-state-rebase.sh`); fresh readings reach the next run (~10 min later). The script's conflict check (`:47-51`) is a single-literal equality and needs set semantics for the second path.
- A ceiling-aware pick creates a second "nothing dispatchable" cause the current park cannot handle: `parkUntilEligible` (`src/judge-rotation.ts:143-176`) wakes only on cooldown expiries, so an all-at-ceiling pick would charge the whole 180s budget in one park against `earliest = Infinity` and can false-trip the exhaustion alarm on a healthy backlog (all-at-ceiling is the normal steady state at width = Σ ceilings). Checkpoint settled: **ceiling-blocked dispatches wake on release (a deferred resolved by the next release decrement) and never charge the budget** — the 180s budget and the alarm stay exclusive to cooldown parks, preserving the FRD non-goal.
- `JUDGE_CONCURRENCY` is a four-site chain (registry `src/config.ts:22` → parser `src/judge.ts:194-209` → parameter `src/judge.ts:687` fed at `src/index.ts:276` → literal `watch.yml:102`); width becomes Σ per-index ceilings with per-account caps enforced inside the rotation scan and no overall clamp. One open item remains: delete the env name outright (recommended) or leave it unused.
- The new fields on `RotationState` (`ceilings` map, `inFlight` map, dispatch counter, release waiters) must be **required members**: strict TS then forces all three known construction literals (`src/judge.ts:691-695`, `tests/judge-rotation.test.ts:37-45`, `tests/judge.test.ts:15-23`) to grow, and no existing test asserts a whole `RotationState` object, so nothing else breaks.

## Detailed Findings

### Current dispatch and rotation machinery (what the spread replaces)

- `RotationState` (`src/judge-rotation.ts:41-48`) carries exactly `accounts`, `cooldownUntil: Map<number, number>`, `waitBudgetRemainingMs`. Created once per run in `judgePosts` (`src/judge.ts:691-695`), passed by reference to both pools (`src/judge.ts:708-714`, `:777-789`) and every wrapper call. The "no sticky pointer" doctrine is stated twice (`src/judge-rotation.ts:34-40`, `src/judge.ts:676-680`).
- The pick is synchronous and pre-await: `dispatchLlmCall`'s loop top calls `pickEligibleAccount(state, now())` at `src/judge.ts:378` before the first await (`:393`). `pickEligibleAccount` scans from index 0 and returns the first account whose cooldown entry is missing/expired (`src/judge-rotation.ts:84-95`); `undefined` ⟺ every account cooling.
- 429 → `coolAccount` + rewind that spends no attempt (`src/judge.ts:402-413`); first-write-wins stamping dedups concurrent 429s to one 60s window (`src/judge-rotation.ts:103-112`, `COOLDOWN_MS` at `:24`). 5xx → same-account backoff [1s, 2s, 4s] (`:414-425`). Transport error → nothing cools (`:448-458`).
- Pick-undefined → `parkUntilEligible` (`src/judge-rotation.ts:143-176`): charge-before-sleep against the shared 180s budget (`WAIT_BUDGET_MS`, `src/judge.ts:109`), wake at earliest cooldown expiry + 500ms jitter (`WAKE_JITTER_MS`, `:31`). Spent budget → `{status: "exhausted"}` returned at `src/judge.ts:385-387`, converted to the tagged `RotationExhausted` at exactly three sites (`src/judge.ts:643-646`, `:726-730`, `:804-805`) → `src/email.ts:181-209` (text builder returns null on an empty record at `:182`) → `src/index.ts:392-400` (alarm + exit 1).
- The exhaustion record is built per `cooldownUntil` entry with hard-coded `reason: "HTTP 429"` (`failuresFromCooldowns`, `src/judge-rotation.ts:113-135`); its non-empty-by-construction proof depends on "throw sites fire only when the pick found nothing". An all-at-ceiling misclassification would produce an empty record — the email-silent path the docblock explicitly warns against.
- Width today: one scalar `concurrency` (`DEFAULT_JUDGE_CONCURRENCY = 4`, `src/judge.ts:68`), clamped per pool by `Math.min(width, items.length)` (`src/pool.ts:50`, cursor sync-window at `:36-41`). The fallback pool reuses the same width under `FALLBACK_CALL_BUDGET = 40` (`src/judge.ts:81`), with tail starvation on a spent budget (`:801-807`).
- `parseLlmAccounts` trims every field including `baseUrl` (`src/judge.ts:134-183`, trim at `:163-172`) — pool identity is the *trimmed* baseUrl, and the probe derives keys from the same parser path (`resolveJudgeConfig` at `scripts/probe-judge.ts:182`), which is what makes the baseUrl keying symmetric between writer and reader.

### RotationState extension — shape, construction sites, mirror sites

- Sole production construction: `src/judge.ts:691-695`. Canonical test copy: `freshState()` at `tests/judge-rotation.test.ts:37-45` (docblock pins the mirrored `180_000` literal). Mirror copy: `tests/judge.test.ts:15-23` (a `.test.ts` cannot import the canonical copy; used at `:580`, `:596`, `:700`). `tests/judge-helpers.ts` builds no state (`singleAccount` at `:16-18` is an account fixture, where a multi-account fixture belongs).
- **Required members, not optional-with-default** — three converging arguments: (1) `waitBudgetRemainingMs` is the precedent for a required mutable scalar added by the last reshape of this interface (`.rpiv/artifacts/plans/2026-10-27_17-55-19_per-batch-llm-rotation.md:95`); (2) strict TS with required fields makes `npm run typecheck` enumerate the three literals, while optional fields would let a forgotten mirror silently disable the ceiling check (fail-visible doctrine, `src/judge.ts:197-202`); (3) no existing assertion does a whole-object `deepEqual` on a `RotationState` — all assertions are field-level (`tests/judge-rotation.test.ts:157`, `:185`, `:223`, `:253`, `:287`, `:299`), so new fields break compilation, not assertions.
- Proposed shape (facts, not recipe): `ceilings: Map<number, number>` (index → max in-flight), `inFlight: Map<number, number>` (index → current), a mutable dispatch-sequence scalar, and a release-waiter queue — `ceilings`/`cooldownUntil`-style maps stay `readonly`-referenced, mutable cells follow the `waitBudgetRemainingMs` convention. Ceilings must be **index-keyed on the state**: the pick is synchronous, so per-pick re-reads of the file are impossible without breaking the coherence contract (`src/judge-rotation.ts:34-40`, `:80-83`); the baseUrl→index translation happens once at startup because `accounts.entries()` position is the only index↔baseUrl pairing (`:88`, `:122-127`).
- The guidance fence that pins the state literal must be re-synced post-change: `.rpiv/guidance/src/architecture.md:59-64`.

### Claim and release placement in dispatchLlmCall

- Control-flow map (verified): loop top pick `src/judge.ts:378` → park branch `:379-389` (never claims) → destructure `:391` → `try` `:392` → first await `:393` → 429 rewind `:402-413` → 5xx backoff `:414-425` → statusFailure/defer `:426-432` → json + onContent `:435-443` → answered `:444` / unanswered `:447` → catch `:448-458` → `attemptsExhausted` `:461`.
- The **claim must sit between `:391` and `:392`** — in the same pre-await sync window as the pick. A claim placed after `:393` lets N workers each observe sub-ceiling counts before any increments: all N dispatch onto one account, the exact thundering herd the spread exists to prevent.
- The **release** may run after awaits (only the claim is window-bound; the release's own read-modify-write is atomic with no await between). A `try/finally` around the attempt body mechanically covers every exit: answered `:444`, all four unanswered paths (`:430`, `:447`, `:457`, transport-spends-an-attempt falling through `:451-458`), the 429 rewind `:402-413` (finally releases, loop top re-picks, `:391` re-claims — the explicit release/re-claim cycle), and the 5xx backoff `:414-425` (slot legitimately free during the sleep — the ceiling counts HTTP requests in flight, not logical calls).
- Leak audit: the park path never claims, so the budget-spent return at `:386` exits at zero balance; `attemptsExhausted` at `:461` is reached only after the final iteration's finally. The fatal placement is claim-after-await; release-after-await is safe.
- The 429-rewind bound documented at `src/judge.ts:407-411` stays finite under ceilings: every iteration either cools a new account (≤ pool, first-write-wins), consumes an attempt (≤ maxAttempts: 4 batch `:515`, 2 post `:608`), or parks (budget-bounded, `src/judge-rotation.ts:148-150`).
- Doctrinal shape for the helpers: claim/release/waiter-resolve belong in `src/judge-rotation.ts` beside `coolAccount` — one module owns all state mutation, mirroring the F010 split rationale (`src/judge-rotation.ts:1-5`).

### Ceiling-blocked wait (checkpoint decision: wake on release, no budget charge)

- Today pick-undefined has one cause (all cooling) and one remedy (time park). With a ceiling-aware pick it gains a second cause (all not-cooling but at ceiling). Walking the current park with an empty `cooldownUntil`: `earliest = Infinity` (`src/judge-rotation.ts:153-157`), `waitMs = Infinity`, `charge = min(Infinity, budget) = 180_000` (`:159-161`) — the entire budget burns in one park, there is no wake-on-release, and the next park refuses (`:148-150`) → exhausted → false alarm on a healthy backlog. The funnel would then produce an empty failure record (no cooldown entries) — the email-silent exit-1 path (`src/email.ts:182`, `:208-209`).
- Decision recorded: ceiling-blocked dispatches await a deferred resolved by the next release decrement (a condition-variable in miniature on the state); **zero budget charge** — `waitBudgetRemainingMs` keeps its documented meaning ("the total time both judge phases may spend parked on *cooling* accounts", `src/judge.ts:93-95`) and the three exhaustion conversion sites stay cooldown-only. Termination is safe: a ceiling-wait returns exactly when a sibling's HTTP request completes (real network I/O, bounded by pool widths); `setImmediate` hot-spin and `sleepFn(0)` polling were considered and set aside.
- A `coolAccount` stamp must also resolve waiters: a fresh 429 reduces effective capacity, so a ceiling-parked worker must re-run the pick — it may now face the all-cooling path, and *that* park legitimately charges the budget.
- Rejected alternative (for the record): stamping busy-until (`now + REQUEST_TIMEOUT_MS`, `src/judge.ts:54`) at claim so the existing park math works unchanged — rejected because ceiling waits would charge the 180s budget (60s worst-case parks for events that land in 5-30s) and could false-trip the alarm the FRD says to preserve.
- Fallback-phase interaction is already ceiling-safe by check ordering: the budget decrement and exhausted flag run in the same sync window as the claim (`src/judge.ts:778-780`), so a worker that parks has already paid; ceiling-induced parks cannot reorder or resurrect spend; tail starvation stays a pure function of `fallbackWork.length - 40` (`:801-807`); the terminal conversion path (`:792-800`) is untouched.

### Dispatch counter semantics and the test rewrite list

- Reactive order emerges from: `runPool` hands batches to `Math.min(width, batches)` workers in input order (`src/pool.ts:36-50`), and every worker's first pick resolves to account 1 (`src/judge.ts:378` → `src/judge-rotation.ts:88-91`). The 429 ladder is the only spread mechanism today.
- Counter design facts: advanced inside the pick's sync window; scan start `= counter % N` then `(start + offset) % N`. Three conventions must be pinned by tests: (1) **claim-time-only advance** — a 429 rewind or park re-pick is a retry within a claim and must not advance (else the post-park-retry pin at `tests/judge-rotation.test.ts:582` breaks); (2) **zero-based first claim** (claim 0 designates account 1 — keeps `:367-368` green and the acceptance fixture symmetric); (3) **state-owned, not drain-owned** — a closure local beside `budget` (`src/judge.ts:770`) would reset at the phase boundary; the state field spans both phases for free (the wait budget is the precedent for a cross-phase cell: `src/judge-rotation.ts:46-49`, pinned by the shared-budget test at `tests/judge-rotation.test.ts:256-290`).
- **Falsified by the acceptance criterion (rewrite list)**: the monotonicity pair `firstKey2 > lastKey1` / `firstKey3 > lastKey2` (`tests/judge-rotation.test.ts:502-507`) — under the spread the first wave is already key-1, key-2, key-3, key-1; the multi-worker-visit counts `count("key-2") >= 2` (`:495-497`) become vacuous (their burden transfers to a distinct-first-claims assertion); the mechanism titles/comments at `:372-379` and `:509` describe scan-from-0, which no longer exists (docblocks `src/judge.ts:676-680` and `src/judge-rotation.ts:34-40` need the same rewrite).
- **Must keep passing**: pool-ordered exhaustion records `[1,2,3]`/`[1,2]`/`[1]` (`:471-483`, `:340-345`, `:617-621`) — built from `state.accounts.entries()`, dispatch-order independent; first-write-wins 429 dedup; expired-entry re-stamp (`:180-197`); the park-budget quartet (`:198-323`); judge.test.ts width pins (`:343-437`, all `singleAccount`) survive iff a 1-account pool's resolved ceiling equals the passed width. ⚠️ The cooldown-skip precedence invariant is currently "exercised" only by `:372-406`, which under the spread lands on account 2 either way — a new fixture is needed where the *designated* account is the cooling one.
- Reachability is free: the counter scan visits all N accounts before returning undefined, so a ceiling-blocked worker never waits "behind" a busy account — it parks only when *every* account is cooling-or-at-ceiling. Spare capacity needs no extra logic.

### Ceilings reader — doctrine, placement, seam, key translation

- Reader precedents: `loadWatcherConfig` fail-visible (`src/config-file.ts:59-85`, wrapper vs pure `validateConfig` at `:83`); `readPayloadPosts` degrade-never-throws with injected `now` for the staleness boundary (`src/linkedin-payload.ts:116-231`, absent `:121-131`, malformed `:137-149`); `loadState` the committed-file middle (ENOENT → fresh, anything else throws, `src/state.ts:135-161`). The FRD demands a **fourth doctrine**: committed file, absence non-fatal, ceiling 1 per account + exactly one warning naming the account. Present-but-malformed should follow the payload leg treatment (degrade + warn naming the reason) — the FRD's NFR wording ("missing or stale ... never fails the run") covers it.
- Placement: a new `src/judge-ceilings.ts` in the FUNNEL group, beside `judge-rotation.ts`. Judge.ts currently has zero fs involvement (imports at `src/judge.ts:35-41` are types + pure modules); F010 is the direct precedent for moving concerns out; the probe gains a shared type home (it already imports from `src/`, `scripts/probe-judge.ts:25-27`); judge.ts is already ~850 lines against the tech-debt target of "under ~500". Type-only import of `LlmAccount` follows the D5 pattern (`src/judge-rotation.ts:8-9`, `verbatimModuleSyntax` erases it — no runtime cycle).
- Pure-core/wrapper split (the `loadWatcherConfig`/`validateConfig` shape): a pure `resolveCeilings(accounts, parsed | undefined)` returning the index-keyed map + warnings makes the acceptance test "absent account → ceiling 1 + one warning" fs-free; the fs wrapper reads the file with the path resolved like `CONFIG_PATH` — a cwd-relative constant (`src/config.ts`, `watcher.config.json` read via `readFile` at `src/config-file.ts:52-53`; the probe's own contract is "run from the repo root", `scripts/probe-judge.ts:29` header).
- Resolution seam: the `judgePosts` call site, not inside `judgePosts`. The call at `src/index.ts:268-280` already resolves pool (`:272`) and width (`:276`) at the boundary; `WatcherDeps` is the sanctioned injection surface (the `linkedinFetch` field with fs-reading default is the verbatim template, `src/index.ts:115-116`, defaulted `:155`, invoked `:202`). Inside-`judgePosts` fails on signature economics (8 positional params; tests pass width positionally at `tests/judge.test.ts:343-370`) and on the D1' precedent rejecting wider carriers (`.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md:72-73`).
- Key translation is the reader's actual job: file is baseUrl-keyed, state is index-keyed (`pickEligibleAccount`, `coolAccount`, `failuresFromCooldowns` all key by 0-based index, `src/judge-rotation.ts:88`, `:106-113`, `:117-127`). Both pool indices sharing one trimmed baseUrl get the **same ceiling value, no warning** (endpoint-identity semantics; the FRD accepted the collision, and warnings are for *missing* data). File keys must be normalized with the same `.trim()` or a trailing-space key silently misses into the default.
- Path constant: beside `STATE_PATH` / `LINKEDIN_PAYLOAD_PATH` / `CONFIG_PATH` in `src/config.ts:52-81`, copying the `LINKEDIN_PAYLOAD_PATH` single-writer doc-comment doctrine (`src/config.ts:55-63`). A `state/` location matches the existing commit shape; `.gitignore` excludes only `state/linkedin-leg-dead.flag` (`:6`), so a third committed `state/` file lands on main.

### Probe persistence and commit-back wiring (checkpoint decisions recorded)

- `findConcurrencyCeiling` (`scripts/probe-judge.ts:133-156`): ramp `[2, 4]`, `timed()` classifies refused (non-2xx, `:100-103`) vs failed (error or 2xx-without-`{`, `:104-112`); return ladder → `0` on any failed ramp leg (`:146-149`), `level / 2` on a refused level (`:150-153`), `4` clean (`:155`). Domain is exactly {0, 1, 2, 4} — integers by construction.
- Dead accounts can carry plausible ceilings: auth-dead 401/403 refusals read as level/2 = 1; an account whose `bulkAgain` leg failed can still ramp clean to 4 while `classifyDead` kills it via the failed-leg rule (`:165-178`). This is why "write all readings" and "write live-only" differ in content, not just timing.
- Checkpoint decision: **live-only, written before the gate** (`:238-243`). A dead account contributes no entry, so its watch-side ceiling is exactly the FR3 default (ceiling 1 + warn) — the degrade path is the designed behavior for untrusted readings. The write itself should follow the repo's atomic-write shape (`stateTempPath` `src/state.ts:125-135`, `writeStateAtomic` `src/state.ts:151-181`, `writePayloadAtomic` `src/linkedin-payload.ts:90-113`) and must be awaited before `process.exit`. In CI, GH step-chaining skips any subsequent commit step when the probe exits 1 — so live-only-before-gate and all-readings differ only in local runs unless a commit step carries `if: always()`.
- Checkpoint decision: **the probe job commits the file**. Topology facts: probe (`watch.yml:24-45`) and watch (`:47+`) are sibling jobs, no `needs:` — both start in parallel on dispatch; the watch checkout (`:68-72`) snapshots the dispatch SHA, so same-run freshness is impossible without re-ordering. The probe job currently has no commit step and its checkout lacks `fetch-depth: 0` (`:34`); workflow-level `permissions: contents: write` (`:8-9`) already covers it. `needs: probe` on watch was rejected: on cron ticks the probe is skipped (`:25`) and a plain `needs:` would skip watch too without an `if:` guard — risky for the 10-minute lane; next-run freshness (~10 min) is acceptable because ceilings drift slowly and the 429 rotation remains the correctness net.
- The skip-set is mandatory regardless of which job pushes: `scripts/commit-state-rebase.sh:47-51` is a whole-string equality against the single literal `state/seen-posts.json`. A ceilings-only conflict aborts the run (`:48-51`); a simultaneous state+ceilings conflict yields a two-line string matching no single literal. Joining the skip-set requires per-line set membership over `{state/seen-posts.json, <ceilings path>}`; skip granularity is one whole commit (`git rebase --skip || true`, `:55`), so a combined conflicted commit drops both deltas — the F021 accepted-cost doctrine extends to "the next probe run re-measures". The deviation ledger at `:24-27` ("the ONLY deliberate deviation") grows a second entry. `tests/commit-state-rebase.test.ts` (its suite: `makeScratch` seeds only seen-posts `:74-103`; `advanceOrigin` arms `:104-124`; state-skip pin `:183-214`; non-state abort pin `:216-245`; retry pin `:247-282`) needs a third `advanceOrigin` arm + a ceilings-skip test + a two-line-conflict fixture.
- The probe script itself has no test suite (no `tests/probe-judge.test.ts` exists) — the ceilings writer's only path to automated coverage is unit-testing it as a `src/` module (the `state.test.ts` / `linkedin-payload.test.ts` precedent).

### JUDGE_CONCURRENCY retirement inventory (verified)

| Site | Reference | Action |
|---|---|---|
| Registry name | `src/config.ts:22` | delete (every other of the 9 names has a live consumer; an unused entry recreates the F024 pathology) |
| Parser + default | `src/judge.ts:194-209`, `:60-68` | delete; default-4-on-absence semantics do not survive (absent ceilings → N × 1, not a flat 4) |
| Call-site feed | `src/index.ts:276` (+ import) | replace with ceilings resolution |
| `judgePosts` param | `src/judge.ts:687` | width becomes Σ per-index ceilings, derived inside from state; both `runPool` launches re-storied (`:708`, `:777`) |
| Module docblock | `src/judge.ts:1-33` (esp. `:24-30`) | re-story width model: per-account ceilings bound dispatches; total = Σ; no overall clamp; reassembly order unchanged (slot-indexed) |
| Workflow literal | `watch.yml:102` | delete line + evidence comment; the ceilings file becomes the paste target |
| Wave-math comment | `watch.yml:50-55` (envelope `:56-65`) | "30 bulk calls clear in ~8 waves" is wrong arithmetic once width is dynamic — make it formulaic or drop the number |
| Tests | `tests/judge.test.ts:91-111` (parse describe), width pins `:343-437`; `tests/index.test.ts:58-67` (BASE_ENV has no JUDGE_CONCURRENCY — exercises absent→4 silently today) | delete/re-pin to per-account peaks |
| F018 guard | literal + `DEFAULT_JUDGE_CONCURRENCY` treated as one documented pointer (`.rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md:44`, `:74`, grep gates `:3469`/`:3493`) | superseded, not violated — the ceilings file inherits the pointer's safety-net role: an unpaste never produces a broken run, only a slower one |

### Test surface and env surface

- Harness idioms to reuse: host-branching recording fetch (`accountTwoAnswering`, `tests/judge-rotation.test.ts:44-70` — distinct hosts per account make per-baseUrl recorders possible); the in-flight/peak recorder precedent (`measuredFetch` + `bulkMissThenAnswer`, `tests/judge.test.ts:111-159`, introduced by `.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md:725-775`) keyed by host for the peak-per-baseUrl assertion; console-spy idiom for the exactly-one-warning criterion (`t.mock.method(console, "warn", ...)` — precedents at `tests/env-file.test.ts:61-71`, `tests/fetch-threads.test.ts:410`); `mkdtemp` + one `after()` for the one file-resolution test (`tests/state.test.ts:22-27` idiom).
- The three acceptance criteria map to: (1) `fiveAccounts()` fixture (5 distinct hosts, into `tests/judge-helpers.ts` — the shared-helpers file takes pure fixtures only; recorders stay per-suite) + 50 posts → 5 batches, assert `new Set(auths.slice(0, 5)).size === 5`; (2) per-host peak recorder across BOTH phases (a bulk-miss double so the fallback drain participates), assert every host's peak ≤ its ceiling; (3) console spy + a ceilings map missing one account, assert one matching warn naming the baseUrl and unchanged judged output.
- The spread/ceiling invariants belong in `tests/judge-rotation.test.ts` (its charter, `:1-5`); the pure ceilings-parser tests beside the `parseLlmAccounts` describes in `tests/judge.test.ts:42-90`.
- Env surface: `LLM_ACCOUNTS` reaches PC-local runs via `envWithDotEnv` (`src/env-file.ts:52-79`, `.env` merged under real env, `DOT_ENV_PATH` at `:19`). The ceilings file does NOT ride `.env` — it is measured committed data; it resolves cwd-relative like `watcher.config.json` for both the probe's write and watch's read.
- The state-owned counter and caps make the acceptance tests pure-state tests (grown `freshState` literals, no file fixtures) — the only file fixture the feature strictly requires is the ceilings reader's cwd-resolution test.

## Code References

- `src/judge.ts:346-475` — dispatchLlmCall retry core: pick :378 (pre-await), park :379-389, exhausted return :385-387, 429 rewind :402-413, 5xx backoff :414-425, exits :444/:447/:457/:461
- `src/judge.ts:54-81` — REQUEST_TIMEOUT_MS :54, DEFAULT_JUDGE_CONCURRENCY :68, FALLBACK_CALL_BUDGET :81
- `src/judge.ts:96-109` — WAIT_BUDGET_MS docblock (envelope arithmetic) + constant
- `src/judge.ts:127-183` — parseLlmAccounts (baseUrl trimmed at :163-172)
- `src/judge.ts:194-209` — parseJudgeConcurrency (retire)
- `src/judge.ts:487-570` — judgeBatch wrapper (exhausted → outcome union :560-561)
- `src/judge.ts:575-690` — judgePost wrapper (tagged throw :643-646, D6 note :684-689)
- `src/judge.ts:674-812` — judgePosts: state :691-695, batching :698-701, bulk pool :708, exhaustion throw :726-730, reassembly walk :745-768, fallback pool :769-812
- `src/judge-rotation.ts:19-31` — COOLDOWN_MS :24, WAKE_JITTER_MS :31
- `src/judge-rotation.ts:41-48` — RotationState
- `src/judge-rotation.ts:84-95` — pickEligibleAccount (scan from index 0)
- `src/judge-rotation.ts:103-112` — coolAccount (first-write-wins)
- `src/judge-rotation.ts:113-135` — failuresFromCooldowns (non-empty-by-construction docblock :113-118)
- `src/judge-rotation.ts:143-176` — parkUntilEligible (cooldown-only wake, charge-before-sleep :159-165)
- `src/pool.ts:36-50` — cursor sync-window :36-41, width clamp :50
- `scripts/probe-judge.ts:83-113` — timed classifier (refused vs failed)
- `scripts/probe-judge.ts:115-131` — rampLevel
- `scripts/probe-judge.ts:133-156` — findConcurrencyCeiling (domain {0,1,2,4})
- `scripts/probe-judge.ts:165-178` — classifyDead (ceiling < 1 → dead)
- `scripts/probe-judge.ts:180-246` — main: resolve :182, per-account loop :191-236, ceiling computed :223, summary line :233-235, dead gate :238-243
- `.github/workflows/watch.yml:24-45` — probe job (dispatch-only :25, checkout :34 WITHOUT fetch-depth: 0, run :43-45)
- `.github/workflows/watch.yml:47-72` — watch job head (timeout 8 :49, wave-math :50-55, envelope :56-65, fetch-depth: 0 :68-72)
- `.github/workflows/watch.yml:95-110` — Run watcher env (JUDGE_CONCURRENCY literal :102)
- `.github/workflows/watch.yml:114-133` — Commit state (bot identity :115-116, add :124, no-op guard :125-128, jq delta :129-131, script :132)
- `scripts/commit-state-rebase.sh:24-27` — deviation ledger ("the ONLY deliberate deviation")
- `scripts/commit-state-rebase.sh:40-74` — attempt() (skip check :47-51, whole-commit skip :55, bound :61-63, lease push :65-66, retry :69-72)
- `src/config.ts:14-25` — ENV_NAMES (judgeConcurrency :22)
- `src/config.ts:52-81` — path constants (STATE_PATH, LINKEDIN_PAYLOAD_PATH single-writer doctrine, CONFIG_PATH never-written)
- `src/index.ts:103-126` — WatcherDeps (linkedinFetch seam template :115-116)
- `src/index.ts:155` / `:202` — seam default / invocation
- `src/index.ts:268-280` — judgePosts call site (resolveJudgeConfig :272, parseJudgeConcurrency feed :276)
- `src/index.ts:392-400` — isRotationExhausted catch → alarm + exit 1
- `src/email.ts:181-209` — buildExhaustionText (null on empty :182), sendExhaustionEmail (silent on empty :208-209)
- `src/config-file.ts:50-85` — loadWatcherConfig (read :52-53, throw paths :60-78) + pure validateConfig :83
- `src/linkedin-payload.ts:38` / `:71-77` / `:90-113` / `:116-231` — PAYLOAD_MAX_AGE_MS, envelope shape, writePayloadAtomic, readPayloadPosts degrade classes
- `src/state.ts:125-181` — stateTempPath, writeStateAtomic (the atomic-write shape to clone)
- `src/env-file.ts:19` / `:52-79` — DOT_ENV_PATH, envWithDotEnv merge
- `tests/judge-rotation.test.ts:36-45` — freshState canonical copy
- `tests/judge-rotation.test.ts:44-70` — accountTwoAnswering host-branching recorder
- `tests/judge-rotation.test.ts:361-370` / `:372-406` / `:457-507` / `:509-540` / `:541-586` — the five reactive-order pins (monotonicity :502-507)
- `tests/judge-rotation.test.ts:256-290` — shared wait-budget cell across calls
- `tests/judge.test.ts:15-23` — mirror freshState
- `tests/judge.test.ts:91-111` — parseJudgeConcurrency describe (retire)
- `tests/judge.test.ts:111-159` — measuredFetch + bulkMissThenAnswer (per-host peak recorder precedent)
- `tests/judge.test.ts:343-437` — width pins + budget starvation
- `tests/commit-state-rebase.test.ts:74-282` — scratch-repo suite (arms :104-124, pins :183-282)

## Integration Points

### Inbound References
- `src/index.ts:268-280` — the only production caller of judgePosts; resolves pool, keywords, width at the boundary
- `src/index.ts:392-400` — consumes the tagged RotationExhausted; alarm email + exit 1
- `scripts/probe-judge.ts:25-27` — imports buildBulkMessages/resolveJudgeConfig/loadWatcherConfig ("zero-edit site" — measures the exact production prompt); gains a ceilings WRITE side under this feature
- `tests/judge-rotation.test.ts:1-5` / `tests/judge.test.ts` — drive the wrappers + state directly
- `.github/workflows/watch.yml:102` — feeds JUDGE_CONCURRENCY into the Run watcher step

### Outbound Dependencies
- `src/judge.ts:35-41` — judge-parse, judge-rotation (runtime + D5 type-only), pool, config ENV_NAMES, types; zero fs today
- `src/judge-rotation.ts:8-9` — type-only imports from judge.js and types.js (verbatimModuleSyntax erasure — the pattern for judge-ceilings.ts)
- `scripts/probe-judge.ts:24-27` — src/config-file.js, src/judge.js, src/types.js
- The new ceilings reader → `node:fs/promises` readFile + the new `src/config.ts` path constant

### Infrastructure Wiring
- `.github/workflows/watch.yml:8-9` — workflow-level `permissions: contents: write` already covers a probe-job commit
- `.github/workflows/watch.yml:114-133` + `scripts/commit-state-rebase.sh` — the commit-back body the probe job reuses (fetch-depth: 0 must be ADDED to the probe checkout at `:34`)
- `scripts/commit-state-rebase.sh:47-51` — the skip-set literal that must become per-line set membership
- `.gitignore:6` — only `state/linkedin-leg-dead.flag` excluded; a committed `state/` ceilings file needs no ignore change

## Architecture Insights

- **Sync-window doctrine is the load-bearing wall**: every cross-worker observation (pick, claim, counter advance, waiter push/resolve) happens between two awaits of the observing worker — no locks anywhere (`src/judge-rotation.ts:34-40`, `src/pool.ts:36-41`, `src/judge.ts:676-677`). Claims are pre-await; releases may be post-await.
- **Terminal outcomes are RETURNED, never thrown in the core** (D6): both catches in dispatchLlmCall are total transport converters; the ceiling-wait must return a resolvable outcome like the cooldown park, and the tagged error is thrown only at wrapper level (`src/judge.ts:643-646`).
- **Compile-forced mirrors**: required new fields on RotationState make `tsc --noEmit` enumerate all three construction literals — the repo's mechanism for keeping test copies in sync without imports.
- **One pick site** (`src/judge.ts:378`): makes the test rewrite list exhaustive AND makes the counter-span question decidable (state-owned field spans both phases for free).
- **Reader doctrine map**: fail-visible (`loadWatcherConfig`) / ENOENT-only-degrade (`loadState`) / degrade-everything (`readPayloadPosts`) / NEW: committed + degrade-everything + per-account warn (ceilings).
- **Single-writer-per-file doctrine** for `state/` artifacts (`src/config.ts:55-63`): the ceilings file's writer is the probe (via its job), its reader the watch run — document it in the path constant's doc-comment.
- **Disputed data is dropped loudly, not merged silently** — the probe's dead gate (`probe-judge.ts:238-243`) and the rebase skip-set (`commit-state-rebase.sh:47-51`) are the same policy at run level and commit level.
- **baseUrl is trimmed display identity; index is operational identity**: file keys translate to index keys once at startup; shared-baseUrl entries share one ceiling silently (warnings are for missing data).

## Precedents & Lessons

5 similar past changes analyzed.

### Precedent: First account rotation (reactive)
**Commit(s)**: `869feed` — "feat: rotate llm accounts to avoid the rate limit" (2026-10-26)
**Blast radius**: 12 files — src/judge.ts (+373), scripts/probe-judge.ts, src/config.ts, watch.yml, email, tests
**Follow-up fixes**: superseded 2 days later by `1a61bf9` after run 40463798717 — one burst-429 cascaded the whole pool, 327 posts unjudged.
**Takeaway**: a run-sticky rotation pointer is fragile; the per-batch redesign directly answered that failure — and this feature is the next iteration of the same lesson.

### Precedent: Probe + concurrency ramp, and the width fix
**Commit(s)**: `73d6786` — "probe judge latency and raise the watch job budget" (2026-10-26); `5f6a328` — "ramp concurrent calls in the judge probe" (2026-10-26)
**Follow-up fixes**: `7cc7250` — "drop JUDGE_CONCURRENCY to the probe reading of 4 — 8-wide bursts trip the endpoint's limiter" (2026-10-27, watch.yml only). Guessed width 8 tripped the limiter within one day.
**Lessons from docs**: `.rpiv/artifacts/` validation `2026-10-26_20-14-35_llm-account-rotation.md` — live ramp measured ceiling 4 with a real 429 at 8-wide; transient all-429 windows observed minutes earlier on the same endpoint.
**Takeaway**: never guess concurrency width — the probe-measured ceiling is the fix for exactly this; a stale optimistic ceiling costs throughput, never correctness (the 429 rotation is the net).

### Precedent: Per-batch rotation + cooldown park + gating probe (closest prior)
**Commit(s)**: `1a61bf9` — "feat: per-batch LLM account rotation with cooldown park and gating probe" (2026-10-28)
**Blast radius**: 17 files — src/judge.ts (+315), scripts/probe-judge.ts (+141), watch.yml, src/index.ts, 4 rotation artifacts; probe made gating (continue-on-error removed)
**Follow-up fixes**: `f14d9f9` — "split the judge into pool, rotation, and parse modules" (2026-10-30: judge-rotation.ts +167, pool.ts +52, judge-rotation.test.ts +619) because judge.ts grew to 779 lines; `ced76f8` — "unexport four internal symbols" (2026-10-31)
**Lessons from docs**: `.rpiv/artifacts/plans/2026-10-27_17-55-19_per-batch-llm-rotation.md` — (a) sync-before-await dispatch discipline, no locks; (b) mock.timers disqualified — use injected now/sleepFn; (c) never throw across the bulk try/catch — return sentinels; (d) exhaustion records must be non-empty by construction (email silently skips empty records). Validation 2026-10-28: gating probe verified live (dead key 401 reddens the run, watch survives).
**Takeaway**: build the spread in judge-rotation.ts (and its tests) from the start — the last rotation feature doubled judge.ts and forced a split within 2 days.

### Precedent: Committed state via workflow commit-back (the ceilings-file pattern)
**Commit(s)**: `510ff2a` — "ci: cache the Playwright browser and rebase state pushes" (2026-10-30, watch.yml +40) → `b779ff7` — "extract the state commit-back into scripts/commit-state-rebase.sh" (2026-11-01, script +74, tests +342)
**Follow-up fixes** — five in one day (2026-10-31), all watch.yml/script: `89c8bc5` fetch full history for the merge base; `8b777e6` force-with-lease after rebase; `45bcbd3` skip conflicted state commits instead of failing; `2e28916` set -e-proof bounded skip loop; `bc760cb` gate the skip on the conflicted path.
**Lessons from docs**: TECH_DEBT_AUDIT / run3 plan — state commit-back growth accepted and documented; the workflow stabilized only after extraction into a tested script.
**Takeaway**: writing a committed JSON from a CI job burned 6 commits in 3 days before the scriptified+tested form — reuse `commit-state-rebase.sh` (the FRD constraint already says this) and expect rebase/race/conflict edges, not happy-path git.

### Composite Lessons
- **Probe-measure, never guess** (`7cc7250`): the ceilings file makes the measurement authoritative — but only if the probe job actually commits it every green run.
- **CI git plumbing fails in clusters** (`89c8bc5`→`bc760cb`→`b779ff7`): any new committed artifact inherits rebase/race/conflict risk; extend the tested script, and budget a live-dispatch validation with a same-day fix window (the F018 rationale at `.rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md:62` — watch.yml runtime values broke on first land twice).
- **Rotation invariants are fragile**: sync-before-await, injected clocks (never mock.timers), sentinels-not-throws across the core's catches, non-empty failure records — all four transfer to the ceiling-wait design unchanged.
- **Offline tests passed both prior times; live runs caught the real failure**: the recording-fetchFn acceptance tests are necessary; schedule one workflow_dispatch smoke run against the real endpoint before calling it done.
- **judge.ts sprawls under rotation features** (`869feed`, `1a61bf9` → forced `f14d9f9`): the ceilings reader goes in its own module and the counter/caps go in judge-rotation.ts.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-11-06_09-41-50_llm-account-spread-judge.md` — the input FRD: settled decisions, acceptance criteria, suggested follow-ups
- `.rpiv/artifacts/plans/2026-10-27_17-55-19_per-batch-llm-rotation.md` — the rotation plan: the four invariants and the RotationState reshape precedent
- `.rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md` — D1' (rejected wrapper carrier), the peak-recorder test precedent (:725-775)
- `.rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md` — F010 split manifest, F018 dual-site guard rationale
- `.rpiv/artifacts/` validation `2026-10-26_20-14-35_llm-account-rotation.md` — live rotation validation (8-wide 429s, 4-wide clean)

## Developer Context
**Q (discover: Replace reactive rotation with proactive spread):** From the probe I inferred — today every concurrent worker picks account 1 first, and the pool only spreads after a 429 cools an account (`src/judge-rotation.ts:85-99`, `src/judge.ts:707-720`). Is that the behavior you want replaced?
A: Yes — replace it. Single-account judging is too slow against the 8-minute Actions cap.

**Q (discover: Spread mechanism: shared dispatch counter):** How should a dispatch pick its starting account so 5 accounts get used in parallel from the first batch?
A: Dispatch counter — one shared counter advanced at claim time covers both phases with a single mechanism and wears accounts evenly.

**Q (discover: Width semantics: per-account concurrency, not accounts in flight):** With 5 accounts and `JUDGE_CONCURRENCY=4` (`watch.yml:102`), only 4 accounts are in flight per wave. Raise the concurrency to match the pool size, or keep 4?
A: "the 5 (X) account is dynamic you must detect it yourself how many are they" — width is per-account parallelism; total = accounts × per-account value; the pool size is detected from `LLM_ACCOUNTS`.

**Q (discover: Per-account ceilings come from the probe):** How should watch enforce "each account at most its probe-measured ceiling in flight"?
A: Strict per-account cap, ceilings sourced from the probe workflow — the burst-verified reading is authoritative.

**Q (discover: No overall concurrency clamp):** Is total in-flight = accounts × per-account cap with no extra overall cap?
A: No total cap — accounts are separate providers/keys; an overall clamp would idle paid capacity.

**Q (discover: Ceilings persisted to a committed JSON file):** Where should the per-account probe ceilings live so the watch job can use them?
A: Committed JSON file — the reading must survive across runs; the repo already has a state commit-back pattern.

**Q (discover: Missing ceiling defaults to 1 with a warning):** What happens when an account in `LLM_ACCOUNTS` has no ceiling in the committed file?
A: Default 1 + warn — a stale file must never fail the run.

**Q (discover: Ceilings keyed by baseUrl):** What key should the ceilings file use to match a reading to an `LLM_ACCOUNTS` entry?
A: baseUrl — stable across pool reordering and already what the probe reports.

**Q (discover: Park budget and exhaustion alarm unchanged):** The 180s park budget and the pool-exhaustion alarm stay as-is (`src/judge.ts:110`, `src/judge-rotation.ts:144`)?
A: Keep unchanged — only account picking changes.

**Q (`scripts/probe-judge.ts:238-243`): Dead accounts can carry plausible ceilings (auth-dead → 1 via :150-153; failed-leg → clean ramp to 4). When should the probe write the ceilings file relative to the dead-account gate?**
A: Live-only, written before the gate. A dead account contributes no entry, so its watch-side ceiling is exactly the FR3 default (ceiling 1 + one warning) — the degrade path matches the probe's own distrust.

**Q (`.github/workflows/watch.yml:24-45`): The probe and watch jobs run in parallel on dispatch (no `needs:`), so the watch checkout can never read the same-run probe's write. How should ceilings readings reach main?**
A: The probe job commits the file (it gains `fetch-depth: 0`, bot identity, ceilings-only add, reusing commit-state-rebase.sh). Jobs stay parallel; fresh readings reach the next run (~10 min later). `needs: probe` rejected — it would skip watch on cron ticks without an `if:` guard.

**Q (FRD open question, resolved): Does the ceilings file need a staleness bound?**
A: No — flat `{baseUrl: ceiling}` map, no `writtenAt`, matching the AC wording verbatim. The probe runs dispatch-only so readings legitimately age for days; a bound sized for that cadence adds fragility without protection, and the 429 rotation remains the correctness net (the `7cc7250` lesson: a stale optimistic ceiling costs throughput, never correctness).

**Q (`src/judge-rotation.ts:143-176`): An all-at-ceiling pick has no cooldown expiry, so the current park would charge the whole 180s budget against `earliest = Infinity`. With width = Σ ceilings, all-at-ceiling is normal steady state. How should a dispatch wait for a free slot?**
A: Wake on release — ceiling-blocked dispatches await a deferred resolved by the next release decrement; zero budget charge; the 180s budget and exhaustion alarm stay exclusive to cooldown parks (FRD non-goal preserved). A `coolAccount` stamp also resolves waiters (a fresh 429 reduces capacity, so the worker re-picks and may legitimately hit the cooldown park).

## Related Research
- `.rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md` — temp-file test idiom precedent (mkdtemp + after())

## Open Questions
- Whether `JUDGE_CONCURRENCY` is deleted outright or left in `ENV_NAMES` as an unused name — the FRD deferred this as low-stakes; research recommendation is delete outright (every other of the 9 registry names has a live consumer; an unused entry recreates the F024 pathology the tech-debt audit fixed).
- The FRD's suggested follow-up about an E2E harness passing single-credential `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` env vars was NOT verified this session — confirm whether such a harness exists in-repo and whether it needs a multi-account pool + ceilings fixture.
- Probe-job commit mechanics on the first dispatch need live validation: the probe checkout gains `fetch-depth: 0` and identity, and a green probe must push cleanly before any cron tick depends on the reading (the composite lesson: one workflow_dispatch smoke run, same-day fix window).
