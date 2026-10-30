---
date: 2026-10-29T12:15:34+0700
author: Yogiswara Utama
commit: 395ee63
branch: main
repository: loker-watcher
topic: "tech-debt-audit-remediation"
tags: [research, codebase, judge, heartbeat, workflow, docs, refactor, deps, hygiene, tests]
status: ready
last_updated: 2026-10-29T12:15:34+0700
last_updated_by: Yogiswara Utama
---

# Research: Tech-Debt Audit Remediation (24 findings, F001-F024)

## Research Question
Remediate every finding in TECH_DEBT_AUDIT.md (generated at commit 395ee63) in one PR, in the audit's priority order (top-5 first, themed commits): sync all stale docs to the cooldown+park rotation model, fix the silent-failure and broken-knob bugs, extract the four copied worker pools and two HTTP retry loops and split judge.ts, add tests to the authenticated walk and hook scripts, bump nodemailer to v10, untrack scratch files and the binary graph DB, and fit the exhaustion alarm inside the 8-minute run envelope. This research re-verifies the audit's file:line claims for the seams the refactor touches (src/judge.ts, src/fetch-threads.ts, .github/workflows/watch.yml) before planning slices.

## Summary
7 analysis agents + 1 precedent sweep re-verified all 24 findings against the live tree at main (395ee63). The audit's substance holds everywhere; 7 of its line references are imprecise (corrected inline below and in the Detailed Findings). No blocker to the FRD's plan was found. The load-bearing discoveries:

- **The refactor cluster F007+F008+F010 is bound by arithmetic, not just convention.** The F010 split alone leaves judge.ts near ~650 LOC (rotation move ~175, parser move ~95); only the dispatcher dedupe (F008, ~130 duplicated lines) and the runPool extraction (F007) bring it under ~500.
- **The four pool sites share one invariant the shared pool must preserve: the join never rejects.** Workers must be total (never throw); failure is encoded in return values or worker-local side channels, and exhaustion converts to a throw only after the join (drain-then-throw).
- **The F010 split has a no-runtime-cycle arrangement**: keep `LlmAccount` and `sleep`/`SleepFn` physically in judge.ts (`SleepFn` gains `export`), have judge-rotation.ts import them type-only — under `verbatimModuleSyntax` (tsconfig.json:11) type-only imports erase, so madge sees nothing, and scripts/probe-judge.ts:25 needs **zero edits**.
- **External fact (web-verified)**: nodemailer 10 is written in TypeScript and ships its own type definitions; `@types/nodemailer` must be **removed**, not bumped (checkpoint decision).
- **The FRD acceptance grep ("run-sticky", "rotateOnRateLimit", "no wait", "default 72") is a floor, not the spec.** At least 5 drift phrases survive it: AGENTS.md:38 "no backoff", README.md:44 and :53 "rotates", .rpiv/guidance/architecture.md:3 "429 rotation", README.md:89 "Default `72`" (capitalized — needs a case-insensitive grep).

## Detailed Findings

### 1. The four worker pools → src/pool.ts runPool (F007, F009)
- Sites (verified): judge batch pool src/judge.ts:784-805 (`outcomes` :784, cursor :785, join :805); fallback pool :856-903 (`slots` lives in judgePosts' frame :820, budget/exhausted flags :857-858, join :892-894, flag→throw conversion :895-897, starved warn :898-903); logged-out fetch src/fetch-threads.ts:200-227 (results :200, failures :201, join :221, all-fail throw :224-227); authenticated fetch :287-331 (perSurface :287, failures :288, emptyLabels :289, join :313, flat + all-fail with empties detail :315-327). `src/pool.ts` does not exist yet.
- Shared semantics: cursor advance in one synchronous window (judge.ts:788-789, :861-862; fetch-threads.ts:205-206, :293-294 — safety documented judge.ts:107-113 and :753-756); in-order claiming; slot-indexed reassembly; width = `Math.min(width, work)` joins; bounds-check + `noUncheckedIndexedAccess` guard at every site.
- Slot variant nuance: the fallback pool writes `slots[item.slot]` (judge.ts:879) — a **carried candidate index**, not the claimed work index. `runPool` returning by work index covers the other three sites directly; the fallback site either keeps the caller-frame `slots` write in its worker closure or post-joins `results[i] → slots[fallbackWork[i].slot]`. Both preserve input order, which is what tests pin.
- Worker-side vs caller-side: the exhaustion snapshot scan (judge.ts:807-814) **must stay caller-side** — its comment (:807-811) says throwing inside a worker would let siblings mutate the record after the snapshot. The fallback's `isRotationExhausted` check (:884-886) genuinely is worker-body behavior (sets the flag, stops claiming). Fetch tolerates per-item failure inside the worker (`failures[index]`) and throws only post-join.
- runPool contract: workers are total (never reject) — a tagged throw escaping a worker would break drain-then-throw, pinned by tests/judge.test.ts:881-905 and :1118-1163 (1-based pool-ordered failure records); worker receives `(item, index)` so judgeBatch's `batchIndex` log labels survive (:793-802); side-channel arrays (failures, emptyLabels) stay worker-closure effects; `RotationState` keeps being shared by closure (judge.ts:773-777) — runPool must not snapshot or re-wrap items.
- Early-stop gates (`exhausted`/`budget`) sit in the claim condition pre-await (judge.ts:863-865): keep them there, or budget decrements burn on claimed-but-aborted items. Head-first starvation order is pinned (tests/judge.test.ts:822-848).
- Width pins: peak exactly 4 for a 28-batch backlog (tests/judge.test.ts:755-771), `min(width, batches)` for short lists (:773-791), fallback width 3 (:793-820), fetch peak within FETCH_CONCURRENCY=4 (src/fetch-threads.ts:38; tests/fetch-threads.test.ts:129-147). All-fail message shapes pinned: tests/fetch-threads.test.ts:175-178, :215, :230-238.
- `context.close()` teardown rides the same try/finally as the join (fetch-threads.ts:229-231, :329-331) — the migration must not move the join out of the finally's try.
- F009: judge's `sleep` is the exported DI seam (judge.ts:105-106); the fetch copy is private (~fetch-threads.ts:435), used only by fetchOne's backoff (:253). Delete toward one home; do not create a third.

### 2. The two HTTP retry loops → dispatchLlmCall (F008)
- judgeBatch src/judge.ts:517-632 vs judgePost :646-733. Shared skeleton: build messages once pre-loop (:530 / :655), scan `pickEligibleAccount` at loop top (:538 / :658), all-cooling converts outside the try (:545-546 returns `{status:"exhausted"}` / :664-666 **throws** `rotationExhausted`), rewind (:548 / :667), 429 → `coolAccount` + warn + rewind without spending an attempt (:574-581 / :689-695), content extraction (:599-601 / :704-707), parser (:610 / :716).
- Divergences the core must parameterize (8): (1) messages are wrapper-built — also what keeps F006/F022 composable; (2) `response_format: {type:"json_object"}` rider batch-only (:559) — FRD pins it; tests enforce from three directions (rider present on bulk, absent on fallback, in the same run: tests/judge.test.ts:724-740; mocks discriminate the paths BY the rider: :1029-1033, :1332-1354); (3) parser identity; (4) attempt count/base — 4 iterations 0-based indexing `RETRY_DELAYS_MS[attempt]` (:586) vs 2 iterations 1-based ("attempt N/2" in warns :699); (5) retryable-status policy — `RETRYABLE_STATUSES` {500,502,503,504} (:77) + `RETRY_DELAYS_MS` [1s,2s,4s] (:79) with same-account backoff (:585-592) vs **no status gate and no sleep** (:698-702); (6) missing content — batch defers whole (:602-607) vs post burns an attempt (:708-713); (7) parse-null — batch returns answered-with-empty-Map to trigger per-item fallback (:611-616; pinned: tests/judge.test.ts:720-739 — a parse miss costs exactly 1 bulk + 1 fallback call) vs post retries (:720-723); (8) transport error — batch defers immediately, "the pointer does not move" (:618-627) vs post retries (:724-728).
- Shared 429 mechanics: `coolAccount` stamps `now() + COOLDOWN_MS` (60s, first-write-wins; :431-443). Both all-cooling terminals rebuild the record via the same `failuresFromCooldowns` (:448-468). Batch 5xx backoff pinned (delays [1000], "a 5xx never rotates": tests/judge.test.ts:1041-1062); batch 403 defers whole with zero fallback calls (:698-719); post 502-then-success and 500-twice→null (:262-283, :285-301).
- Outcome totality is the thinness condition: the classification must cover exactly six leaf outcomes (parsed / parsed-empty-container / missing-content / http-429 / http-retryable / http-other / transport) plus the pre-loop all-cooling terminal. A missed class falls to batch's unreachable final return (:629-631 — silent swallow) or post's re-throw path reaching judge.ts:888, which **rejects the join**, breaks drain-then-throw, and makes the exhaustion email (src/index.ts:310-318) unreachable.
- Warn strings: 11 literals (judge.ts:575, :587-589, :593-595, :604-606, :612-614, :623-625, :691, :698-700, :710-712, :721-723, :726-728). **No test asserts any console.warn** — unification cannot break assertions, but keep the "skipping batch (posts stay unseen and retry next run)" suffix: it documents the D3 skipped-ids-retry contract (src/index.ts:219-229, :278-289). Core needs a subject-label parameter (batch: `batch N (M posts)`; post: `post <id> attempt N/2`).

### 3. The judge.ts split + test split (F010, F015)
- judge.ts is 921 LOC, six concerns. Verified symbol map vs the audit's two ranges — both ranges mis-bucket at their edges:
  - **Moves to src/judge-rotation.ts**: `RotationState` (:126-134, doc :120-125), `ROTATION_EXHAUSTED` (:136), `RotationExhausted` interface (:139-144 — in the audit's range but absent from every symbol list; must move), `rotationExhausted` (:146-156), `isRotationExhausted` (:158-160), `pickEligibleAccount` (:412-429), `coolAccount` (:431-443), `failuresFromCooldowns` (:448-468 — must move though neither the audit nor the question names it), `parkUntilEligible` (:471-512). Constants `COOLDOWN_MS` (:86) and `WAKE_JITTER_MS` (:101) move — sole consumers are coolAccount (:434) and parkUntilEligible (:487).
  - **Stays in judge.ts**: `BatchOutcome` (:400-403 — inside the audit's "402-515" range but it is judgeBatch's return union consumed by the pool; NOT rotation); `WAIT_BUDGET_MS` (:94 — sole consumer is judgePosts' RotationState construction :773-777, so F023's citation target survives the split); `parseLlmAccounts` (:169-206), `parseJudgeConcurrency` (:229-243) and the `ENV_NAMES` import (audit leaves env parsing in place); `normalizeEndpoint` (:292-297 — inside the audit's "222-312" range but it is the URL joiner used by both retry loops (:562, :678); belongs with the F008 HTTP core, not the parsers); prompt builders `buildMessages` (:314-328) and `buildBulkMessages` (:335-362) — the audit lists them nowhere; keeping them in judge.ts is what keeps the probe import (:25) stable.
  - **Moves to src/judge-parse.ts**: `parseVerdict` (:257-289), `readVerdict` (:299-311 — sole consumer is parseBulkVerdicts (:385) though it sits ~55 lines away; the move is non-contiguous), `parseBulkVerdicts` (:364-398 — the audit's "222-312" misses it).
  - **Ownership decision (minimal churn)**: `LlmAccount` (:112-116) and `SleepFn` (:109, currently unexported) stay in judge.ts; `SleepFn` gains `export`; judge-rotation.ts imports both type-only. Under `verbatimModuleSyntax` this creates no runtime cycle. Moving `LlmAccount` instead would add two more edit sites for nothing.
- The four importer sites (repo census: exactly 4): src/index.ts:32-39 (remove `isRotationExhausted` from the "./judge.js" block — sole call site src/index.ts:310; add "./judge-rotation.js"); tests/index.test.ts:26 (path swap; sole usage :365); tests/judge.test.ts:3-15 (splits three ways: parseBulkVerdicts + parseVerdict → judge-parse; RotationExhausted + RotationState + isRotationExhausted → judge-rotation; the rest stay); scripts/probe-judge.ts:25 (**zero edits** under the ownership decision). A missed import fails `npm run typecheck` (tsconfig include: src, tests, scripts) with TS2305 at the first commit.
- LOC arithmetic: rotation ~175 + parsers ~95 → judge.ts ~650; F008 + F007 must land in the same unit to cross under ~500. The dispatcher calls pickEligibleAccount/coolAccount/parkUntilEligible/failuresFromCooldowns/rotationExhausted from both wrappers, so the rotation boundary must exist **before** the dispatcher is written — ordering is load-bearing.
- Test split: tests/judge.test.ts is 1,397 lines, 10 describes, 62 `it(` declarations (audit's "63" uses a different count). Destinations: **tests/judge-parse.test.ts** — parseVerdict (:101) + parseBulkVerdicts (:468) describes; zero helpers needed (pure string-in/string-out). **tests/judge-rotation.test.ts** — rotation cases inside judgePost (:283-435: 283, 305, 325, 343, 374, 400, 435) and judgePosts (:881, 1018, 1030, 1118, 1171, 1204, 1252, plus boundary cases :1066 "5xx never rotates" and :1100 "transport error cools nothing"); needs 10 of the 12 top-level helpers. **Residual tests/judge.test.ts** — env-parsing describes (:125, :142, :192), pipeline/pool judgePosts cases (:572-975 set), payload/reasoning_effort describes (:1286, :1321, :1362); 6 helpers + 2 describe-local doubles (`measuredFetch` :531-553, `bulkMissThenAnswer` :554-570).
- Helpers: the URL-branching pattern the audit calls "good, worth keeping" — `twoAccounts` (:28-33), `threeAccounts` (:37-42), `freshState` (:46-49; **hardcodes waitBudgetRemainingMs 300_000**, mirroring WAIT_BUDGET_MS — F023's shrink must update it), `accountTwoAnswering` (:56-71) — is consumed **exclusively by rotation tests**: move it intact (co-location preserves the pattern; duplication would drift it). ~6 pure helpers (~35 LOC: KEYWORDS :20, singleAccount :23-25, ok :74-79, id19 :82, bulkPost :84-92, bulkContent :95-99) are shared by two files → extract tests/judge-helpers.ts (safe: `npm test` glob `tsx --test tests/*.test.ts` (package.json:9) never executes a non-.test.ts helper; typecheck and lint cover tests/) or duplicate.
- Cross-cutting pins to carry through the split intact: the park-ladder test :343-372 asserts `[60_500, 60_500, 60_500, 60_500, 58_000]` and its comment couples to WAKE_JITTER_MS + the 300k budget (F023 rewrites it); response_format batch-only is re-pinned at :734-753 and :1362+.

### 4. Prompt copy + injection line (F006, F022)
- `buildBulkMessages` src/judge.ts:335-362 (system literal :345, user literal :349, listing :339-341; sole caller judgeBatch :530, built once outside the retry loop). Probe copy: scripts/probe-judge.ts:62-77, reads module-level KEYWORDS (:30, fed by loadWatcherConfig :29), sole caller :225 inside `bulkPayload` (:222-229).
- Drift = 3 deltas, all in the USER message (system prompts are byte-identical): production appends the job-seeker/internship/training exclusion clause (:351), the Indonesia examples "(e.g. Jakarta, Bali, Surabaya, hybrid in ID)" + the on-site-abroad exclusion, and ", exactly like" — all absent from the probe. The probe therefore measures a lighter prompt, weakening the JUDGE_CONCURRENCY evidence chain (watch.yml:72 cites probe run 40455686221; DEFAULT_JUDGE_CONCURRENCY's doc judge.ts:48-56 points at the probe).
- Export surface: adding `export` at judge.ts:335 breaks nobody (sole caller :530); the probe extends its existing import (probe-judge.ts:25 already imports resolveJudgeConfig + LlmAccount) and swaps one expression at :225 — `bulkMessages(ten)` → `buildBulkMessages(ten, KEYWORDS)`. `WatcherConfig["keywords"]` is `string[]` (src/config-file.ts:29), assignable to `readonly string[]` (judge.ts:337). Only the messages field changes: response_format (:229) and reasoning_effort (:228) stay probe-side, mirroring production (:551-556).
- F022 placement: system role only (the user message is where injection lands) — judge.ts:321 (buildMessages) and judge.ts:345 (buildBulkMessages); post text embedded verbatim at :323 and :341-343/:347-351. After F006 deletes the probe copy, :345 is the only bulk system literal in the repo and the probe inherits the line automatically. **Order matters**: F006 before F022, or the editor must patch the probe copy too. The probe's minimal leg (probe-judge.ts:216-221, "Reply with the single word: ok") is not a judge prompt — untouched.
- Hidden third consumer of prompt text: the user-message opening "Judge each Threads post below" (judge.ts:349) is the bulk-vs-single discriminator inside 7 test doubles (tests/index.test.ts:140, :162; tests/judge.test.ts:565, :857, :888, :932, :1259). F006/F022 edit only the system message — but any future rewrite of that opening silently reclassifies every bulk response as fallback in 7 doubles. Treat it as API.
- Adjacent, out of F006's stated scope: the probe joins its URL inline (probe-judge.ts:109), duplicating `normalizeEndpoint` (judge.ts:292-297) minus its `/chat/completions` tolerance. Exporting it would fit the zero-re-copying goal; the acceptance criterion ("no bulk-prompt string literal") does not require it.

### 5. watch.yml seams (F024, F021, F020, F023, F018 guard)
- Structure (verified): probe job :16-38 (dispatch-only :17, gates every account per comment :18-23, env LLM_ACCOUNTS :36-37), watch job :40-60 (comment :42-50, `timeout-minutes: 8` :51), Install Playwright :62-68 (`--only-shell` :68, rationale :63-67), Run watcher :70-77 (env :71-76, run :77), Commit state :79-91 (no-op guard :84-87, jq delta :88-89, commit :90, **bare `git push` :91**). Concurrency group :11-13; `continue-on-error` appears nowhere in the file.
- **F024**: HEARTBEAT_ENABLED is mapped nowhere; code gate src/index.ts:63 → log "heartbeat: disabled by HEARTBEAT_ENABLED" at **src/index.ts:64** (the FRD/acceptance says :60 — corrected); resolver `isHeartbeatEnabled` src/config.ts:29-35 (undefined → enabled; literal "false" disables, case/whitespace-tolerant); name in ENV_NAMES src/config.ts:16. Both zero-match gates consult it (src/index.ts:184-190 call :188; :222-227 call :226) — which is why local runs honor the variable and the 10-minute cron ignores it. Add `HEARTBEAT_ENABLED: ${{ vars.HEARTBEAT_ENABLED }}` to env (:71-76) — `vars.`, not `secrets.`: the one non-secret variable. Same-commit guidance flip: .rpiv/guidance/.github/workflows/architecture.md:7 ("deliberately NOT mapped") and :89 ("established pattern").
- **F021**: insert `git pull --rebase origin main` between commit (:90) and push (:91); retry push once; second failure exit 1. The jq PREV read (:88) reads HEAD **post-rebase**, so the delta count stays correct. The concurrency group serializes watch runs only — it cannot see a dev push. Recovery is sound: next run re-judges, re-sends once, re-persists (audit accepts one duplicate digest).
- **F020**: the only caching today is setup-node `cache: npm` (:57-59), which covers ~/.npm. Add an actions/cache step: path `~/.cache/ms-playwright`, key `hashFiles('package-lock.json')` (npm ci :60 pins the exact Playwright version); keep the install step (:68) unconditional — no-op on hit, download on miss (the FRD's "falling back to install on miss"). F020's ~30-60s saving enlarges the headroom that makes F023's shrink safer; state the F023 arithmetic for the no-cache worst case or measure after the cache lands.
- **F023**: `timeout-minutes: 8` (:51) exists so a hung run dies before the next */10 tick (:44-46). The envelope comment :48-50 ("Envelope race, documented not solved") must be **rewritten in the same commit** — leaving it claims an unsolved race that no longer exists. Code arithmetic: WAIT_BUDGET_MS 300_000 (judge.ts:94, "Unmeasured value stays a constant" doc :88-93) + 60s abort tail (REQUEST_TIMEOUT_MS judge.ts:43) + fetch worst case (~71s measured, watch.yml:43-44) vs 480s budget. Fix: shrink judge.ts:94 to a probe-fitted value (~180s suggested) with a fresh measured evidence comment replacing :89-93; timeout-minutes stays 8.
- **F018 guard**: do not touch DEFAULT_JUDGE_CONCURRENCY (judge.ts:57, evidence comment :48-56) or the watch.yml:72 literal + its run-id comment. F023's rewrite sits directly above :72 and F024's env line directly below — both edits must preserve line 72's text.
- Safe within-file order: F023 comment+constant → F020 cache step → F024 env line → F021 rebase/retry.

### 6. Heartbeat case bug (F013)
- src/heartbeat.ts:51-54: haystack lowercased (:52) but the term is compared verbatim (:53) — `"frontend dev wanted".includes("Frontend")` is false. The JSDoc (:50) promises "(case-insensitive)" — false on the term side. `trim()` is also missing: a stray-space term never matches either.
- Latent, not active: watcher.config.json:10-21 is all lowercase today. Nothing enforces that — `readStringArray` validates non-empty strings but pushes entries verbatim (src/config-file.ts:98 → :112). The first operator who writes "IT Support" silently shrinks the near-miss net.
- Sole production consumer: the near-miss filter in `selectCandidates` (heartbeat.ts:74). Affects only tier two (near-miss) — judged posts pass through (:65-68). That tier exists to be broader than the judge keywords (module header :10-14), so a dead term defeats its design purpose. Sole caller of selectCandidates: src/index.ts:69, inside the best-effort wrapper (:54-75) whose catch downgrades any error to a warn (:71-73) — sanctioned doctrine (audit "Things that look bad but are actually fine"). Two silence layers: the bug does not even throw, and a throw would be downgraded anyway. The guardrail must be the test.
- Existing tests cover only the working direction (uppercase TEXT vs lowercase terms, tests/heartbeat.test.ts:46; the fixture :21 mirrors the all-lowercase production config — the two blind spots hide each other).
- Fix + test (FRD-bound): `term.trim().toLowerCase()` at heartbeat.ts:53; mixed-case cases in the :43-58 describe — "Frontend" vs "frontend dev wanted", plus an "IT Support" variant covering trim + all-caps.

### 7. Untested seams (F014, F016)
- **F014**: `fetchOneAuthenticated` is module-private (src/fetch-threads.ts:335-433); its only caller is the exported `fetchSurfacesAuthenticated` walk (:280-331), injectable via the trailing `contextFactory` param (:283, default `chromiumContextFactory` :123-180 — the module's sole Playwright import :126-128). Seam types are exported and structural: ResponseLike :73-78, LocatorLike :80-85, PageLike :87-101, ContextLike :103-113, ContextFactory :115 (the brief's ":115-150" covered only the factory — corrected).
- **Decision (FRD-bound): drive through the exported walk — do NOT export the private function.** (1) All four required behaviors are externally observable: dry-round termination → `evaluate` call count (scroll loop :405-422, dry break :416, `MAX_DRY_SCROLL_ROUNDS` = 3 at **:55** — brief said :59; `MAX_SCROLL_ROUNDS` :42, `SCROLL_MIN_GAIN` = 2 :43, reset :418, log format :413-414); post cap → return length (`MAX_POSTS_PER_SURFACE` = 150 :44, checked :346 and :421); zero-post tracking → `emptyLabels` via assert.rejects (stamped :304, surfaced :315-322); no-Recent-tab warn → console.warn vs log discrimination by `isTagSurface` (:178-180; warn :395, log :398, `RECENT_TAB_LABEL` = "Recent" at **:41** — brief said :40; timeout :54, click+settle :390-392). (2) FRD FR#16 says "against the injected ContextFactory double". (3) Module D5 doctrine (:19-23) designates ContextFactory as the seam. (4) An export would bypass the pool-wrapper logic the coverage must include (:304, :307-311, :315-322).
- Current doubles stop at pool level (tests/fetch-threads.test.ts, 230 lines, 6 cases): responses fire only during goto (:80-94), the locator always rejects (:99-108), `evaluate` is an unobserved no-op (:109) — the dry counter, cap, and tab branches never execute; single-post fixtures keep posts.size ≤ 1 so the cap checks are structurally unreachable. Required extensions: evaluate counter (optionally firing a stored-listener response per round), locator toggle (resolving waitFor + click spy), N-item graphqlBody, `t.mock.method(console, "log"/"warn")`.
- Case specs: dry → exactly 3 evaluates, result carries the 1 post, log shows `(dry 3/3)`; reset → ≥2 new posts per round resets dryRounds, exactly 8 evaluates; cap-break → a single exactly-150-item response → 1 evaluate, length 150 (the cap is NOT enforced per-item :355-357 — a single response may overshoot, so the exact-150 fixture is what genuinely pins :421); late-response short-circuit :346 → evaluate fires 100 more after the cap → still 150; mixed zero-post → surface B empty, walk still resolves (the complement of the existing all-empty case :224); Recent tab → tag/ + rejecting locator → warn /no Recent tab/; profile/ → log /URL selects its own view/, no warn; optional resolving-tab case → click called once + settle wait.
- **F016**: scripts/hooks/gate-destructive.js — six RULES (:7-14), fail-open: `JSON.parse(readFileSync(0))` catch → exit 0 (:16-21), command extraction :23, first regex hit → stderr + exit 2 (:24-29), allow → exit 0 (:30). Registered as a PreToolUse hook (.claude/settings.json:9); nothing else runs it — no CI step, no npm script, tsc has no allowJs, biome's path excludes it, lint-staged matches only *.ts. A regex typo is a SyntaxError at import time: every later Bash call hits a crashing hook, silently.
- Test spec: tests/gate-destructive.test.ts using `spawnSync(process.execPath, [scriptPath], { input, encoding: "utf8" })` — process.execPath because the shebang is inert on Windows; resolve the script via `new URL("../scripts/hooks/gate-destructive.js", import.meta.url)`. 5 cases: (1) `rm -rf build/` → exit 2, stderr contains "recursive force delete (rm -rf)"; (2) `git push origin main --force` → 2 (minds the `[^|;&]*` gap constraint in the regex); (3) `git reset --hard HEAD~1` → 2; (4) compound `psql -c 'Drop Table users'; mkfs -t ext4; echo x > state/seen-posts.json` → 2 (covers rules 4-6 in one event + the /i flags via "Drop Table"); (5) `not json` → 0 (fail-open). Cheap 6th ride-along: `npm test` → 0 — the allow path exits at a different line (:30) than fail-open (:20); case 5 alone cannot distinguish them.
- Gate changes (same commit): package.json:11 `lint` appends `scripts/hooks` as a **directory** (npm scripts run through cmd.exe on Windows — globs do not expand; Biome traverses a directory itself). biome.json needs NO change — its ignore list (:4-11) does not exclude scripts/hooks, and both hook files already conform to the configured style. lint-staged (:15-19) gains `"scripts/hooks/*.js": ["biome check --write --no-errors-on-unmatched"]` (lint-staged micromatches staged paths; a glob is safe there, unlike shell scripts). AGENTS.md:19's lint description — the brief said :24, corrected — is already stale (it omits scripts/probe-judge.ts, which package.json:11 lints today); update it to name all four roots in the same commit (`npm run lint` is step 2 of AGENTS.md:64-66's definition-of-done). format-on-edit.js (always exits 0 :25, shells to npx biome format :18-22) is covered by the path change automatically; the FRD mandates no dedicated test for it.

### 8. Hygiene + nodemailer (F011, F012, F019, F017)
- **F011**: .rpiv/tmp/ holds exactly 4 tracked files + .rpiv/tmp-config-backup.json (backup presence verified). slice1-judge-candidate.ts is a stale pre-refactor copy of judge.ts (~384 LOC) that will mislead a reader; check-slice4.js and extract-fence.mjs slice .rpiv/artifacts docs; e2e-live.mts self-loads .env with real credentials — unsuitable for tracking. History: the un-ignore happened in a validation pass (validation/2026-10-27_12-39-16:70), then **3c70779** "docs: track the fast-workflow-runtime tmp harnesses and config backup" tracked them. .gitignore (5 lines: node_modules/, .env, .env.*, .pi/) has no .rpiv entry; biome.json ignores .rpiv (:4-11). FRD: `git rm -r .rpiv/tmp .rpiv/tmp-config-backup.json` + ignore `.rpiv/tmp/`; .rpiv/artifacts stays tracked (it hosts this pipeline's docs).
- **F012**: .codebase-memory/ = .gitattributes (`graph.db.zst binary merge=ours`), artifact.json (manifest records commit 6b9dae4…, 1452 nodes, ~1MB compressed — the churn quantified), graph.db.zst. Flip-flop verified via reflog: **67d422d** (amended) "chore: ignore the local codebase-memory index" → **6b9dae4** "chore: track the codebase-memory graph index". Fix: `git rm --cached .codebase-memory/graph.db.zst` + ignore entry + record the decision in **.rpiv/guidance/** (checkpoint decision; neither guidance nor README mentions codebase-memory today, so this is a NEW note — the only existing prose is the validation doc). artifact.json and .gitattributes are not covered by the FRD and stay tracked (the .gitattributes rule becomes inert).
- **F019**: src/threads-session.ts imports ONLY `{ mkdtemp, writeFile }` (:11); the leak is :48-50 — `mkdtemp(join(tmpdir(), "loker-session-"))` + storage-state.json, never deleted. Call path: `resolveSession` at src/index.ts:151-155 → `contextFactory(storageStatePath)` (fetch-threads.ts:285); the context owner `chromiumContextFactory` (:123-180) builds the context at :128-131; `ContextLike.close()` (:163-167, closes context then browser) is invoked in the walk's cleanup (:330). **Checkpoint decision: delete after context close** — `rm(dir, {recursive: true})` exported from threads-session.ts and invoked at the close seam (or a finally around src/index.ts:149-155). Every run's secret is removed; no fixed-path residue.
- **F017**: pins — package.json:21 `nodemailer: ^6.9.16` (the audit row says :17 — corrected), :27 `@types/nodemailer: ^6.4.17`, lockfile 6.10.1 (package-lock.json:1187). The entire production API surface is one call: `nodemailer.createTransport({service: "gmail", auth})` (src/email.ts:92-99, createTransport :93; sole nodemailer import :8) inside `sendText` (:84-100); the rest is transport-agnostic (sendMail :101-106, fail-visible rethrow :108-111). Callers: sendDigest (email.ts:122, send :143; production src/index.ts:242 — notify-before-persist :239-245), sendExhaustionEmail (email.ts:182, send :191; production src/index.ts:313, best-effort), sendHeartbeat (**src/heartbeat.ts:148-160** — the brief said :126-141, corrected; production src/index.ts:70). Safety net: 9 transport-mocked tests (tests/email.test.ts 4 + 3; tests/heartbeat.test.ts:165-195 2) — the mocks never touch createTransport, so v10's contract is covered by typecheck + the sendMail mocks.
- **Web-verified breaking changes 6→10**: Node >= 20 (repo requires >= 22 — fine), NoAuth → ENOAUTH error code (repo always passes auth — fine), TLS validation on remote-fetch features (unused — fine), TypeScript/ESM rewrite. **Nodemailer 10 ships its own type definitions; @types/nodemailer must be REMOVED** (its npm README: "should be removed from your project to avoid conflicting declarations") — checkpoint decision overrides the FRD's "bump @types to latest". This is the repo's first major dependency bump — no in-repo precedent; lean on typecheck + the 9 mocked tests.

### 9. Doc drift map (F001-F005)
- **AGENTS.md:36-43** (the judge bullet): drift at :38 ("rotates … with no backoff") and :39 ("run-sticky"); :40's alarm/exit-1 claim is still true (src/index.ts:310-318). Replace with: 429 cools the account 60s first-write-wins (judge.ts:86, :431-443); dispatch re-scans via pickEligibleAccount (:412-429); all-cooling parks under the shared budget (judge.ts:94, charge-before-sleep parkUntilEligical :471-512), then rotationExhausted (:146-156); one alarm email + exit 1 (src/index.ts:310-318). Also stale independently: **AGENTS.md:19** lint description (omits scripts/probe-judge.ts).
- **README.md**: :17 + :89 recencyHours "default 72" — the audit's claim re-verifies TRUE: `readRecencyHours` is called unconditionally (src/config-file.ts:92) and throws on missing (:165-169, throw at :167); `reasoningEffort` (:173-177) is the only keyed default; the live 72 comes from watcher.config.json. Rewrite both to "required; currently 72" (note :89 is capitalized "Default `72`" — a case-sensitive grep misses it). :24 "with no wait" (the only "no wait" hit in the repo); **:44 and :53 also teach rotation** ("rotates to the next account on the first HTTP 429") but contain none of the four trigger strings — a zero-hit grep passes while these still teach the deleted model.
- **.rpiv/guidance/src/architecture.md:65-78**: the whole "Judge rotation: 429 CAS" section documents the deleted sticky-index design (`rotateOnRateLimit` — the only occurrence in the repo; `state.index`/`state.failures` — the real RotationState has `cooldownUntil` Map + `waitBudgetRemainingMs`, "There is no sticky pointer" judge.ts:121). Three factual errors beyond the symbol: the wait DOES exist (parkUntilEligible :471); exhaustion DOES throw mid-pool in the fallback path (judgePost :666 → worker catch :884-886 → join re-throw :895-897) — only the bulk phase defers to its join (:813); failure accumulation is the cooldown map via failuresFromCooldowns, not a pushed array.
- **.rpiv/guidance/.github/workflows/architecture.md**: :17 (structure block "continue-on-error"), :63-75 ("measurement is data, never a gate" + "reads only accounts[0]" + `continue-on-error: true`) — actual watch.yml:16-38 gates every account and exits 1; plus :7/:89 (HEARTBEAT_ENABLED unmapping rationale — flips with F024).
- **.rpiv/guidance/scripts/architecture.md**: :7 ("continue-on-error"), :21 (ramp `[2, 4, 8, 16]` — actual `[2, 4]` probe-judge.ts:158, docstring :149-156 explains why), :32 ("the CI job is continue-on-error"), :51 ("reads only accounts[0]" — actual whole-pool walk :208, exit 1 :260/:204), :60 (ramp wording). :23 claims "production prompt shape" — becomes true only post-F006; write the F004 rewrite against the post-F006 script.
- **.rpiv/guidance/architecture.md** (the unlisted fourth file): :3 ("an account pool with 429 rotation"), :8, :11, :31 (probe phrasing), :35 ("unset means enabled" — resolver-true but review alongside F024).
- Grep coverage map (current hits): "run-sticky" → AGENTS.md:39, guidance/src:67 · "rotateOnRateLimit" → guidance/src:68 · "no wait" → README:24 · "default 72" → README:17 + :89 (case-insensitive needed). Survivors the four terms miss: AGENTS.md:38 "no backoff", README:44/:53 "rotates", guidance/architecture.md:3 "429 rotation", .rpiv/guidance/tests/architecture.md:62 (a test description in old framing — the test itself stays true). Treat the four-term grep as the floor; add a supplemental README/guidance grep for "rotat" to the acceptance check.

## Code References
- src/judge.ts:43 — REQUEST_TIMEOUT_MS = 60_000 (the envelope's "60s abort tail")
- src/judge.ts:46 — BATCH_SIZE = 10
- src/judge.ts:48-57 — DEFAULT_JUDGE_CONCURRENCY = 4 + probe-pointer evidence comment (F018: do not touch)
- src/judge.ts:70 — FALLBACK_CALL_BUDGET = 40
- src/judge.ts:77-79 — RETRYABLE_STATUSES + RETRY_DELAYS_MS [1s,2s,4s]
- src/judge.ts:86 — COOLDOWN_MS = 60_000 (first-write-wins doc :81-85) — moves to judge-rotation.ts
- src/judge.ts:88-94 — WAIT_BUDGET_MS = 300_000 + "Unmeasured value stays a constant" doc (F023 rewrites both; stays in judge.ts)
- src/judge.ts:101 — WAKE_JITTER_MS = 500 (moves; park-ladder test :343-372 couples to it)
- src/judge.ts:105-109 — exported sleep + SleepFn seam (F009 home; export SleepFn)
- src/judge.ts:112-116 — LlmAccount (stays; probe import depends on it)
- src/judge.ts:126-160 — RotationState + ROTATION_EXHAUSTED + RotationExhausted + rotationExhausted + isRotationExhausted → judge-rotation.ts
- src/judge.ts:169-243 — parseLlmAccounts + parseJudgeConcurrency (stay)
- src/judge.ts:257-311 — parseVerdict + normalizeEndpoint (:292-297 stays) + readVerdict → judge-parse.ts (non-contiguous)
- src/judge.ts:314-362 — buildMessages + buildBulkMessages (stay; F022 edits :321 + :345; F006 exports :335)
- src/judge.ts:364-398 — parseBulkVerdicts → judge-parse.ts (audit range missed it)
- src/judge.ts:400-406 — BatchOutcome (stays — NOT rotation despite the audit range)
- src/judge.ts:412-512 — pickEligibleAccount / coolAccount / failuresFromCooldowns / parkUntilEligible → judge-rotation.ts
- src/judge.ts:517-632 / :646-733 — judgeBatch / judgePost (F008 collapses into dispatchLlmCall + thin wrappers)
- src/judge.ts:784-816 — batch pool + post-join exhaustion snapshot (caller-side; do not move into a worker)
- src/judge.ts:820-903 — fallback pool (carried-slot variant :879; flag conversion :895-897)
- src/fetch-threads.ts:38-55 — FETCH_CONCURRENCY / MAX_POSTS_PER_SURFACE / MAX_DRY_SCROLL_ROUNDS / RECENT_TAB_LABEL constants
- src/fetch-threads.ts:73-115 — structural seam types + ContextFactory
- src/fetch-threads.ts:123-180 — chromiumContextFactory (sole Playwright import; F019 close seam :163-167)
- src/fetch-threads.ts:200-227 / :287-331 — the two fetch pools (F007 sites 3+4; join must stay in the try/finally :229-231, :329-331)
- src/fetch-threads.ts:335-433 — fetchOneAuthenticated (F014 target, driven via the exported walk)
- src/fetch-threads.ts:435 — private sleep copy (F009: delete)
- src/heartbeat.ts:50-54 — matchesCandidateTerms bug (fix :53: term.trim().toLowerCase())
- src/heartbeat.ts:60-82 — selectCandidates (sole consumer of the bug; near-miss filter :74)
- src/heartbeat.ts:148-160 — sendHeartbeat (F017 caller)
- src/index.ts:32-39 — judge.js import block (F010: isRotationExhausted moves)
- src/index.ts:54-75 — heartbeat() wrapper (gate :63, log :64, catch-to-warn :71-73)
- src/index.ts:151-155 — resolveSession + fetchSurfacesAuthenticated call (F019 finally anchor)
- src/index.ts:184-190 / :222-227 — Gate 1 / Gate 2 heartbeat call sites (:188 / :226)
- src/index.ts:239-245 — notify-before-persist (sendDigest :242, persistJudged :245)
- src/index.ts:310-318 — RotationExhausted → one alarm email → exit 1
- src/threads-session.ts:11, :48-50 — mkdtemp/writeFile-only import + the leak
- src/email.ts:84-111 — sendText (createTransport :92-99; the F017 bump surface)
- src/email.ts:122 / :182 — sendDigest / sendExhaustionEmail signatures
- src/config-file.ts:92, :165-169 — readRecencyHours call + missing-key throw (F005 claim verified)
- src/config-file.ts:98, :112 — readStringArray pushes terms verbatim (why F013 is latent)
- src/config.ts:16, :29-35 — ENV_NAMES.heartbeat + isHeartbeatEnabled resolver
- .github/workflows/watch.yml:11-13, :17, :44-51, :57-60, :62-68, :70-77, :79-91 — concurrency, dispatch-only probe, 8-min timeout + envelope comment, npm cache, Playwright install, Run watcher env, Commit state
- scripts/probe-judge.ts:25, :29-30, :62-77, :109, :149-159, :208, :216-221, :222-229, :225, :260 — imports, KEYWORDS, prompt copy, inline URL join, ramp, pool walk, minimal leg, bulkPayload, exit 1
- scripts/hooks/gate-destructive.js:7-14, :16-21, :23-30 — RULES, fail-open read, extraction + exits
- package.json:9-11, :15-19, :21, :27 — test/typecheck/lint, lint-staged, nodemailer, @types/nodemailer
- tests/judge.test.ts:20-99 — shared helpers (trio :28-71; freshState :46-49 hardcodes 300_000)
- tests/judge.test.ts:343-372 — park-ladder pin (couples to WAKE_JITTER_MS + budget)
- tests/judge.test.ts:724-740, :755-791, :822-848, :881-905, :1029-1062, :1118-1163 — response_format / width / starvation / drain-then-throw / 5xx pins
- tests/fetch-threads.test.ts:56-124 — fakeContextFactory (extensions spec'd in §7)
- tests/heartbeat.test.ts:21, :43-58 — lowercase fixture + matchesCandidateTerms suite (add mixed-case here)
- .rpiv/guidance/.github/workflows/architecture.md:7, :17, :63-75, :89 — F003 + F024 flips

## Integration Points

### Inbound References
- src/index.ts:32-39 — imports isRotationExhausted, judgePosts, parseJudgeConcurrency, resolveJudgeConfig, sleep from "./judge.js" (call site :310)
- tests/index.test.ts:26 — imports isRotationExhausted (usage :365)
- tests/judge.test.ts:3-15 — the three-way import split target
- scripts/probe-judge.ts:25 — imports resolveJudgeConfig + LlmAccount (zero-edit site under the ownership decision)
- src/heartbeat.ts:74 ← src/index.ts:69 ← gates :188/:226 — the candidateTerms flow (verbatim from watcher.config.json via config-file.ts:112)
- src/index.ts:153-155 → src/fetch-threads.ts:283 → :123 — session path into chromiumContextFactory
- src/email.ts sendText ← :143 (sendDigest), :191 (sendExhaustionEmail), src/heartbeat.ts:155-160 (sendHeartbeat)

### Outbound Dependencies
- src/judge.ts → raw fetch + AbortSignal.timeout (:569/:685); no SDK (repo doctrine)
- scripts/probe-judge.ts → src/judge.js (today: resolveJudgeConfig, LlmAccount; post-F006: + buildBulkMessages) and loadWatcherConfig (src/config-file.ts)
- scripts/hooks/gate-destructive.js → node:fs readFileSync(0) stdin contract (spawnSync-testable)
- src/threads-session.ts → node:fs/promises {mkdtemp, writeFile} (F019 adds rm)

### Infrastructure Wiring
- .github/workflows/watch.yml — probe job :16-38 (dispatch-only, gates the pool), watch job :40-60 (timeout 8 < cron 10), steps :62-91; concurrency group :11-13; permissions contents: write
- .claude/settings.json:9 — gate-destructive.js registered as PreToolUse hook on Bash (its only executor)
- package.json:9-13 — test glob tsx --test tests/*.test.ts; typecheck tsc --noEmit; lint biome path; husky prepare
- .husky/pre-commit → npx lint-staged (*.ts only today; F016 adds scripts/hooks/*.js)
- biome.json:4-11 — ignores (.rpiv, .codebase-memory, state, .pi, node_modules, .git); scripts/hooks NOT ignored
- .gitignore — 5 lines, no .rpiv entry (F011/F012 add two)

## Architecture Insights
- **Join-never-rejects is the pools' invariant**: workers are total; failure is encoded in outcomes/flags/side channels; exhaustion throws only after the join. A shared runPool must promise this or drain-then-throw breaks and the exhaustion email becomes unreachable.
- **Caller-side post-join conversion is deliberate** (snapshot comment judge.ts:807-811) — do not fold it into the worker.
- **Type-only back-imports kill the cycle**: judge.ts ⇄ judge-rotation.ts with `import type` for LlmAccount/SleepFn is invisible to madge under verbatimModuleSyntax.
- **LlmAccount/SleepFn ownership decides the migration cost**: keeping them in judge.ts makes the probe a zero-edit site and the whole split "mechanical" as the audit claims.
- **Prompt builders stay in judge.ts** (F010 moves rotation + parsers only) — the probe's import path stays stable across the cluster.
- **The user-message opening is a test discriminator** ("Judge each Threads post below", judge.ts:349 — 7 doubles) — treat prompt structure as API.
- **response_format batch-only is pinned three ways** (explicit test, mock discrimination, payload describes) — F008 keeps it batch-only.
- **freshState mirrors WAIT_BUDGET_MS** (300_000 hardcoded, tests/judge.test.ts:47) and the park-ladder test couples to WAKE_JITTER_MS — F023's value change ripples into both test files.
- **The heartbeat's silence is doctrine**: the wrapper's catch-to-warn is sanctioned (audit "fine" list), so the F013 guardrail is the new test, not runtime surfacing.
- **F020 and F023 share one budget**: the cache saving enlarges the headroom that makes the WAIT_BUDGET_MS shrink safe; write the evidence comment against the no-cache worst case or measure after the cache lands.
- **Docs sync must end with a grep-verified pass** — precedent 1a61bf9 updated guidance files and STILL shipped 5 doc-drift findings; the acceptance grep needs supplemental terms (see §9).

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: rotation model rewrite v1→v2 (the origin of the doc drift)
**Commit(s)**: `869feed` "feat: rotate llm accounts to avoid the rate limit" (2026-10-26, PR #1) → `1a61bf9` "feat: per-batch LLM account rotation with cooldown park and gating probe" (2026-10-28)
**Blast radius**: 17 files across 5 layers (judge.ts +315, probe, watch.yml, 4 guidance docs, tests) + graph.db.zst binary churn in the same feature commit.
**Follow-up fixes**: none for semantics (validation 2026-10-28_07-04-59: 176/176 tests, two live dispatch runs) — but the doc sync was partial: 1a61bf9 touched guidance docs yet left AGENTS.md/README untouched, and even .rpiv/guidance/src/architecture.md:65-78 still documents the deleted rotateOnRateLimit API.
**Lessons from docs**: the validation used grep pins for CODE (rotateOnRateLimit = 0 in src) but had no DOC-side grep — stale docs passed validation.
**Takeaway**: a model rewrite ends with a grep-verified docs pass over ALL surfaces; the FRD's four-term acceptance grep exists because this failed once.

### Precedent: watch.yml runtime tuning — first-land failures twice in a row
**Commit(s)**: `73d6786` probe + budget (2026-10-26); `93a3f38` 8-minute runtime cut (2026-10-27); fixes `7cc7250` (+14 min: width 8 → 429 bursts, all 8 batches rotated to account 2 within ~50 ms) and `1c8a68c` (+17 min: probe un-gated after openrouter daily-cap false failures; --with-deps dropped, apt-get ate the budget); `1a61bf9` re-gated the probe (safe only because coverage changed to every-account).
**Blast radius**: watch.yml + judge.ts/fetch-threads.ts/state.ts + tests.
**Follow-up fixes**: two same-day; the probe gating flip-flopped (gate → un-gate → re-gate).
**Lessons from docs**: validation/2026-10-27_12-39-16 caught all three deviations via live dispatch runs annotated with run IDs; the width literal is explicitly "paste the measuring run's reading".
**Takeaway**: any watch.yml value touching concurrency/budget/gating was wrong on first land twice — budget a live-dispatch validation with a same-day fix window; live validation requires pushed refs (plan branch choreography for F023/F024 checks).

### Precedent: judge.ts evolution + the abandoned extraction
**Commit(s)**: `e316cb5` bulk judge (2026-10-26) → `fda50c2` FIX +52 min (defer unanswered batches, raise timeout) → `1d4faed` bounded worker pool → `93a3f38` idiom "generalized" by copying 4×; .rpiv/tmp/slice1-judge-candidate.ts (2026-10-26) is a prior extraction candidate left as tracked scratch (3c70779).
**Blast radius**: judge.ts 921 LOC / 6 concerns; tests/judge.test.ts 1,397 LOC.
**Follow-up fixes**: fda50c2 within the hour — batch calls with no retry were the deterministic worst case.
**Takeaway**: judge.ts changes historically needed same-day fixes; the last seam "generalization" landed as 4 copies — this time extract once, migrate mechanically, let the 63 existing tests pin behavior before moving imports.

### Precedent: the .gitignore → scratch + binary flip-flop
**Commit(s)**: `67d422d` "chore: ignore the local codebase-memory index" (2026-10-25) → `93a3f38` (2026-10-27) guts .gitignore inside a 12-file feat commit (deletes .rpiv/*, !.rpiv/artifacts/, .codebase-memory/) → `3c70779` tracks 5 scratch files → `6b9dae4` (+4 min) tracks the 880KB binary.
**Blast radius**: 1 file per commit; a four-commit circle ending in tracked scratch + a re-churning binary (grew again in 1a61bf9).
**Follow-up fixes**: none — only re-decided; the audit's remedy is "pick one and record it".
**Takeaway**: hygiene decisions smuggled into feature commits flip-flop — land F011/F012 as dedicated commits that record the decision where it can be found (guidance note, per checkpoint).

### Precedent: heartbeat/email surfaces + the unpinned version
**Commit(s)**: `67a9bd2` "feat: no-match heartbeat status email"; nodemailer ^6.9.16 pinned since `1a9e353` (2026-10-25), never bumped.
**Blast radius**: src/heartbeat.ts (4 commits ever), src/email.ts (4 commits).
**Follow-up fixes**: none — which IS finding F013: the mixed-case hole survived because no test pins case normalization.
**Takeaway**: F013's test is the actual fix; F017 is the repo's first major bump — no in-repo precedent, lean on typecheck + the 9 mocked transport tests.

### Composite Lessons
- Doc drift is the repo's most recurring failure mode (5 of 24 findings): two doc-sync opportunities both left load-bearing sections stale, and one guidance doc rationalized a broken knob as intentional (HEARTBEET_ENABLED "deliberately NOT mapped"). End every behavior change with a grep-verified docs pass.
- Workflow values broke on first land twice in a row; validate watch.yml changes with a live dispatch and expect a same-day fix. Live validation needs pushed refs.
- Copied idioms drift silently (probe prompt already diverged; pool idiom ×4). One extraction, mechanical migration, tests first.
- Hygiene smuggled into feature commits is what created F011/F012; dedicated commits with a written decision are the cure.

## Historical Context (from .rpiv/artifacts/)
- TECH_DEBT_AUDIT.md — the input report: 24 findings, top-5, quick wins, "looks bad but is fine" list, maintainer open questions
- .rpiv/artifacts/discover/2026-10-29_11-55-47_tech-debt-audit-remediation.md — the FRD binding this remediation (F001-F024, decisions, acceptance criteria)
- .rpiv/artifacts/validation/2026-10-28_07-04-59_per-batch-llm-rotation.md — rotation rewrite validation; source of the "code grep but no doc grep" lesson
- .rpiv/artifacts/validation/2026-10-27_12-39-16_fast-workflow-runtime.md — runtime-cut validation; records the three watch.yml deviations + the tmp-tracking un-ignore
- .rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md — design whose slices merged into plan phases; origin of slice1-judge-candidate.ts
- .rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md — earlier plan referenced by the tmp fence-slicers

## Developer Context
**Q (discover: Scope: the whole list): This sweep fixes 24 audit findings — when the debt stays, who hits the pain first — what is this mainly protecting?**
A: "The whole list" — the report is the backlog; work all 24 findings, top-5 first, across docs, code, tests, deps.

**Q (discover: Work order: audit order): In what order should the 24 findings land?**
A: Audit order — top-5 first (F024, F013, F006, F001-F005, F017), then the remaining 19 by theme.

**Q (discover: Refactor cluster: together): How should the judge.ts refactor cluster land?**
A: F007 + F008 + F010 as one unit; F015 test split follows. (Research adds: the binding is mechanical — the split alone leaves judge.ts ~650 LOC.)

**Q (discover: nodemailer bump: own PR inside the sweep): Does the nodemailer 6→10 bump (F017) land in this sweep?**
A: Own PR — separate commit/PR inside the sweep: bump, typecheck, offline email tests.

**Q (discover: F024 heartbeat knob: map it): How should the HEARTBEAT_ENABLED kill switch be made real?**
A: Map vars.HEARTBEAT_ENABLED through the watch.yml step; update the guidance note that called the unmapping deliberate.

**Q (discover: Delivery: one PR, all at once): How should the fixes reach main?**
A: "PR all at once" — a single PR containing every fix (themed commits inside for bisectability).

**Q (discover: F023 envelope: shrink the wait): Worst-case runs can outlive the 8-minute cap and die before sending the exhaustion alarm — which way?**
A: Shrink WAIT_BUDGET_MS (src/judge.ts:94) to fit the envelope so the alarm always fires.

**Q (discover: F012 graph binary: untrack): .codebase-memory/graph.db.zst is tracked and reindexing rewrites it — pick a side?**
A: git rm --cached + ignore; record the decision so history does not flip-flop again.

**Q (src/email.ts:92-99, checkpoint): nodemailer 10 bundles its own TypeScript types — what happens to @types/nodemailer?**
A: Remove it (devDependency deleted, not bumped) — keeping it creates conflicting declarations; nodemailer's own README instructs removal on v10.

**Q (src/threads-session.ts:48-50, checkpoint): The leaked loker-session-* dir holds the session secret — which cleanup shape?**
A: Delete after context close — rm(dir, {recursive:true}) via the existing ContextLike.close() seam (src/fetch-threads.ts:163-167, :330); no fixed-path residue.

**Q (.codebase-memory/, checkpoint): Where is the graph.db.zst untrack decision recorded?**
A: A new note in .rpiv/guidance/ (neither guidance nor README mentions codebase-memory today; agents are the audience that re-tracks).

## Related Research
None — first research artifact in this chain.

## Open Questions
1. **F023 evidence production**: the FRD requires "a fresh measured evidence comment" for the new WAIT_BUDGET_MS value — live dispatch probe (precedent says expect a same-day fix; local Windows probe has a known exit-127 quirk) vs arithmetic from existing measured numbers (71s fetch, 60s tail). Exact value (~180s suggested) is unmeasured. Decide at design.
2. **F018 pointer refresh**: after F006 lands, the next probe run is the first reading against the true production prompt — schedule the run that refreshes the watch.yml:72 evidence comment.
3. **F019 rm placement**: exported cleanup invoked at the ContextLike.close() seam vs a finally in src/index.ts:149-155 — decision recorded (delete-after-close), placement is a design choice.
4. FRD non-goal follow-ups stay out of scope: .rpiv/artifacts/ pruning policy, reasoning_effort tolerance across the pool, probe ramp-logic tests.