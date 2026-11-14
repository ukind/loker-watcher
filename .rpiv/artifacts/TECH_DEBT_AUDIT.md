# Tech Debt Audit — loker-watcher

Generated: 2026-11-13 (repeat run #6). Audited state: `main` @ `df890a9`, clean working tree.
Prior runs: #1 2026-10-29 (F001-F024), #2 2026-10-31 (N001-N004), #3 2026-11-01 (N005-N009),
#4 2026-11-02 (N010-N017), #5 (N018-N040, remediation FRD 2026-11-13).
Living document at `.rpiv/artifacts/TECH_DEBT_AUDIT.md`.

**Tooling.** `tsc --noEmit` clean. Biome clean (69 files). `npm test`: 626/626, 0 skipped.
`npm audit`: 0 vulnerabilities. `depcheck` clean. `knip`: 7 unused exports + 3 unused exported types.
`madge`: 2 cycles, both type-only. No `any` / `@ts-ignore` in `src/` or `scripts/`; every
`as unknown as` cast lives in `tests/`. This run read every `src/` module, all nine `scripts/`
entries, the workflow, the commit-back script, and the full `git log` churn profile.

## Executive summary

- **No Critical, no High.** Every gate is green, and both prior Critical/High classes are gone: the
  LinkedIn credential blob (N010) is deleted and absent from all history, and the uncommitted SDK
  cutover (N011) was reverted wholesale — the browser-walk leg is committed on `main`.
- **The SDK cutover was rolled back and the browser walk came back bigger.** `src/linkedin-fetch.ts`
  is 898 LOC, `scripts/replay-linkedin.ts` is 685 LOC, `tests/linkedin-fetch.test.ts` is 1388 LOC.
  Three new `src/` modules (`linkedin-behavior`, `linkedin-capture`, `judge-availability`) and two
  new scripts (`replay-linkedin`, `reset-linkedin`) landed since run #4.
- **`judge.ts` grew 830 -> 1091 LOC and the N005 deferral trigger has fired.** Five commits touched
  it for real work (`522395a`, `89cbd42`, `154c473`, `2338274`, `cabd1ba`). The "split it when next
  touched for real work" condition is met; the file is now 2.2x the 500-line threshold.
- **The dead-export class recurred for the fourth run in a row** (N041): knip reports 7 unused
  exports + 3 unused exported types. There is no knip gate in CI, so nothing stops the fifth.
- **Capture is on by default in production and writes ~85 MB per walk** (N051). `captures/` is
  273 MB on disk today across 3 sessions; retention is 20 sessions (~1.7 GB steady state). No disk
  alarm, no off switch, no size cap — the module's own comment says so.
- **Repo growth worsened sharply** (N043): `state/seen-posts.json` is 4.0 MB (was 1.6 MB at run #4),
  1273 commits touch it, and `.git` is 189 MB — 172 MB of it loose objects a `git gc` would reclaim.
- **Documentation drift is now the largest single cluster** (N044, N045): five modules appear in no
  doc layer (AGENTS.md, README, all four guidance files), and AGENTS.md's lint list omits
  `scripts/replay-linkedin.ts`.
- **The new LinkedIn code is well-built where it counts.** The parser is pure and total, the capture
  sink is injectable and warn-once, the payload reader degrades on four classes, and the fault
  vocabulary (halt > leg-dead > all-faulted) is tagged and tested. The debt is in size, docs, and
  resource bounds — not in the happy path.
- **Two real logic gaps in the walk** (N046, N047): the seen-stop streak is mutated after an `await`
  inside a concurrent listener, so "consecutive" counts body-completion order; and
  `LINKEDIN_MAX_POSTS` is checked only at the loop top, so the drain can overshoot it.
- **The pairing heuristic is still the biggest correctness unknown.** The parser pairs the i-th text
  with the i-th id by timestamp because the stream carries no link. The replay harness exists to
  settle it; until its output is read, every LinkedIn post's text-to-permalink mapping is a guess.

## Architectural mental model

The shape is run #4's funnel with the LinkedIn leg swapped back from a paid SDK to a browser walk.
The funnel order is still the invariant: fetch -> extract -> dedupe -> recency -> seen-diff ->
availability pre-check -> judge -> notify -> persist, notify strictly before persist
(`src/index.ts` Gate 1 / Gate 2 / match path).

Acquisition is a two-arm split on the RAW config partition (`src/index.ts:180-198`). Threads resolves
a storageState session and walks 9 surfaces through Playwright (`fetch-threads.ts`, bounded pool,
Recent-tab + graphql-XHR capture, logged-out `data-sjs` fallback). LinkedIn partitions raw
`{type:"linkedin"}` surfaces to the PC leg: `scripts/fetch-linkedin.ts` runs one tick — working-hours
window -> halt latch -> `guardCheckout` (branch `main` + clean tree) -> cookie `harvestedAt` gate ->
`readSeenIdSet` -> `fetchLinkedInPosts` -> `writePayloadAtomic` -> `pushPayload` — and the hosted run
only READS `state/linkedin-posts.json` through the total `readPayloadPosts`.

The walk itself (`src/linkedin-fetch.ts`) opens ONE headed persistent-profile Chromium context
(`launchPersistentContext`, msedge channel, viewport null, locale en-US), shuffles the surfaces
(FR-5), walks them at width 2 behind a shared 5-15 s pacing gate, and per surface: navigates the
content-search URL, waits for liveness (a flagship-web body OR a rendered lazy-column card), then
clicks "Load more" up to `scrollRounds` times with a 3-dry-round exit and a 3-consecutive-seen stop.
Every intercepted flagship-web body parses through the pure `linkedin-parser.ts`; both listener arms
optionally write a `CaptureRecord` through the injectable sink.

The judge cluster is unchanged in shape and larger in code: the availability pre-check
(`judge-availability.ts`, one tiny parallel call per account, never throws), the rotation dial with
per-account ceilings, the health circuit with its half-open probe, the 180 s park budget, and the
tagged `RotationExhausted` that sends one alarm per episode. `judge.ts` now holds all of it plus the
prompts and the env parsing.

Committed state is four files, one writer each: `seen-posts.json` (watch job), `judge-ceilings.json`
(probe job), `judge-health.json` (watch job, success and failure paths), `linkedin-posts.json` (PC
loop, its own clone). `captures/` is untracked scratch, gitignored in the same change as the sink
because `guardCheckout` throws on any untracked path.

## Findings — open (N041-N059 new this run; N005, N017 carried)

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|----------|-----------|----------|--------|-------------|----------------|
| N041 | Architectural decay (dead exports) | `src/email.ts:309`; `src/judge-health.ts:39`; `src/linkedin-fetch.ts:69,208,234,265,340`; `src/config-file.ts:40`; `src/linkedin-payload.ts:47`; `src/linkedin-session.ts:159` | Low | S | knip: 7 unused exports (`buildLegDeadAlarmText`, `HEALTH_VERSION`, `LINKEDIN_FETCH_CONCURRENCY`, `LEG_DEAD`, `ALL_SURFACES_FAULTED`, `HALT`, `makeLinkedInContextFactory`) + 3 unused exported types (`PlatformFlags`, `LegStatus`, `LinkedInStorageCookie`). Fourth consecutive run of this class (N004, N006, N012). No knip gate in CI, so the class recurs by construction. | Drop `export` on each (all keep internal use) and add `npx knip` to `ci.yml`. ~15 min. |
| N042 | Architectural decay (god files) | `src/judge.ts:1-1091`; `src/linkedin-fetch.ts:1-898` | Medium | M | Two files above the 500-line threshold. `judge.ts` holds env parsing + prompts + the dispatch core + orchestration and grew 31% this cycle; the N005 deferral trigger ("next touched for real work") has now fired five times. `linkedin-fetch.ts` holds the context factory, three tagged-error families, the pacing gate, a ~330-line surface walk (`walkLinkedInSurface`, 470-780), and the pool orchestration. | Split `judge.ts`: `dispatchLlmCall` + `DispatchWarns`/`DispatchOutcome` -> `judge-dispatch.ts`; the two prompt builders + `systemMessage` -> `judge-prompts.ts`. Split `linkedin-fetch.ts`: context factory + tagged errors -> `linkedin-context.ts`; `walkLinkedInSurface` -> `linkedin-walk.ts`. Behavior-neutral; tests unchanged. |
| N043 | Performance / resource hygiene (repo growth) | `state/seen-posts.json` (4.0 MB); `state/linkedin-posts.json` (517 KB); `.git` (189 MB) | Medium | M | N017 worsened 2.5x. `seen-posts.json` is rewritten and committed on every match run (1273 commits); the payload adds 20. `.git` is 189 MB, of which 172 MB is loose objects (`size-pack` 12.4 MiB) — a `git gc` reclaims most of it, but nothing runs one. Clone and CI checkout cost grow without bound on a public repo at 144 ticks/day. | (a) run `git gc --aggressive` once and document it, (b) schedule a gc, or (c) move seen-state out of git. Pick one and record it in the guidance. |
| N044 | Documentation drift (agent-facing) | `AGENTS.md:30` | Low | S | The lint command list omits `scripts/replay-linkedin.ts`, which `package.json:16` includes. An agent following AGENTS.md would lint 8 of the 9 enumerated scripts. | Add the path. 1 minute. |
| N045 | Documentation drift (all layers) | `AGENTS.md:44-110`; `README.md`; `.rpiv/guidance/src/architecture.md:21,103`; `.rpiv/guidance/scripts/architecture.md:4` | Low | S | Five modules added since the last guidance sync appear in NO doc layer: `src/judge-availability.ts`, `src/linkedin-behavior.ts`, `src/linkedin-capture.ts`, `scripts/replay-linkedin.ts`, `scripts/reset-linkedin.ts`. The scripts guidance still opens "Nine files" and lists nine. | One bullet per module in AGENTS.md, one line per module in the two guidance files, "Nine files" -> "Eleven files". ~20 min. |
| N046 | Consistency rot (async race) | `src/linkedin-fetch.ts:503-504,570-573` | Low | S | `seenStreak`/`lastSeenId` are mutated inside the async response listener AFTER `await response.text()`. Two bodies in flight resolve in arbitrary order, so "consecutive" counts body-completion order, not stream order — the stop can fire early (missing posts) or late (wasted rounds). The tests drive bodies sequentially, so they cannot catch it. | Move the streak fold out of the listener: collect `(id, seen)` pairs per body, fold them in arrival order after the drain. Or accept and document the heuristic. ~30 min + 1 test. |
| N047 | Logic (cap not enforced) | `src/linkedin-fetch.ts:110,659,754` | Low | S | `LINKEDIN_MAX_POSTS = 150` is checked only at the loop top. The response listener keeps inserting during the 1.5 s drain (line 754), so a surface can return more than 150 posts. The cap is advisory, not a bound. | Slice the returned array to the cap, or check inside the insert. 2 lines. |
| N048 | Error handling (broad swallow) | `src/linkedin-fetch.ts:553,607` | Low | S | Both listener arms end in a bare `catch {}` commented as "the body read can race the page close". It also swallows parser faults and any error from the capture path, so a systematically broken parse looks exactly like a page-close race: zero posts, no warn. | Narrow the catch to the known race, or warn once on a non-race error (the `captureOnce` warn-once idiom). ~10 min. |
| N049 | Error handling (non-atomic flag writes) | `scripts/fetch-linkedin.ts:183,232` | Low | S | The episode marker and the halt latch are written with a bare `writeFile`, not the repo's temp+rename idiom. A crash mid-write leaves a truncated flag; the exists probes only test readability, so a zero-byte file still counts as present — the failure direction is safe, but the reason text can be lost. | Use `stateTempPath` + rename (the `writePayloadAtomic` shape). ~10 min. |
| N050 | Observability (zero-post success overwrites the last good payload) | `scripts/fetch-linkedin.ts:434` | Low | S | A walk that succeeds with zero posts publishes an empty payload, overwriting the last good one. The hosted run then reads leg "ok" with 0 posts — indistinguishable from a genuinely quiet day. The all-faulted arm preserves the last good payload; the zero-post arm does not. | Skip the write on zero posts (and log it), or add `postCount` to the envelope so the heartbeat can render "ok — 0 posts". ~15 min. |
| N051 | Performance / resource hygiene (capture disk) | `src/linkedin-capture.ts:46,157`; `scripts/fetch-linkedin.ts:408`; `scripts/probe-linkedin.ts:185` | Medium | M | Capture is ON by default in production (both call sites default to `makeFsCaptureSink()`), writes the FULL body pretty-printed, and retention is 20 sessions x ~85 MB = ~1.7 GB steady state. Measured today: 273 MB across 3 sessions. No disk-space alarm, no off switch, no size cap — the module's own comment says "no alarm when the disk fills". | Add an env kill switch (`LINKEDIN_CAPTURE=off`) and a size guard that skips the write above a threshold with one warn. Or drop the pretty-print (halves the bytes). ~30 min. |
| N052 | Security hygiene (PII at rest) | `captures/` (273 MB, gitignored) | Low | S | The sink writes verbatim LinkedIn response bodies — post text and member identifiers — to an untracked directory in the working tree, unencrypted, with automatic roll-off as the only cleanup. | Document the retention and the manual purge in README; consider capturing only the matched arm by default. ~10 min. |
| N053 | Security hygiene (hardcoded operator path) | `src/linkedin-fetch.ts:401` | Low | S | `LINKEDIN_PROFILE_DIR = "C:/loker-secrets/linkedin-chromium-profile"` is a hardcoded absolute Windows path in a `src/` module. Not a secret, and the hosted run imports only a type from this module (erased), but it pins the PC leg to one machine and one drive letter with no override. | Read it from an env var with this as the default (the `ENV_NAMES` idiom). ~10 min. |
| N054 | Type & contract debt (positional parameter list) | `src/linkedin-fetch.ts:792-802`; `scripts/fetch-linkedin.ts:404` | Low | S | `fetchLinkedInPosts` now takes 10 positional parameters, 8 defaulted. Call sites pass `undefined` placeholders (`fetch-linkedin.ts:404` passes `undefined` for `sleepFn`). A positional insert silently shifts every later argument. | Convert to a deps object (the `FetchTickDeps` idiom). ~30 min, mechanical. |
| N055 | Consistency rot (two URN digit floors) | `src/linkedin-parser.ts:88` vs `src/linkedin-payload.ts:63` | Low | S | The parser mints only 10+ digit activity ids; the payload reader accepts 9+. A 9-digit id would pass the reader and never be minted. Harmless today (LinkedIn ids are 19 digits), but the two contracts disagree. | Share one constant. 5 min. |
| N056 | Dependency & config debt (dead ignore rules / dead artifact) | `.gitignore:11,15,16`; `state/linkedin-get-budget.json` | Low | S | `state/linkedin-get-budget.json` is still gitignored and still on disk (47 bytes) although the budget machine was deleted 2026-11-11; `README.md:334` already calls it orphaned. `slice*-recon/`, `outputs/.drafts/`, `outputs/.plans/` match no directory in the tree. | Delete the file and the four rules. 2 min. |
| N057 | Config debt (shared scrollRounds) | `watcher.config.json` (`scrollRounds: 50`); `src/config-file.ts:307` | Low | S | `scrollRounds` is shared by the Threads walk and the LinkedIn walk. 50 rounds x (5 s waitFor + 2.5 s settle) = 375 s worst case per surface; with 5 LinkedIn surfaces at width 2 that is ~16 min per tick against a 28-min floor. The dry-round exit usually stops it early, but the knob has no per-platform split. | Lower the value, or add a per-platform override. Measure first: the logs carry the click count per surface. |
| N058 | Test debt | `scripts/probe-judge.ts` (340 LOC) | Low | M | Still the only uncovered non-trivial logic (carried x5). `src/config.ts`, `src/pool.ts`, `src/threads-session.ts` also have no direct test file (`pool` is exercised indirectly). | Extract the ramp decision (`rampLevel`'s ceiling arithmetic) into a pure function and test it. ~1 h. |
| N059 | Consistency rot (duplicated context factory) | `src/linkedin-fetch.ts:340-395` vs `src/fetch-threads.ts` | Low | S | The LinkedIn context factory duplicates ~55 lines of the shared chromium factory (UA string, webdriver patch, page adapter). The module documents why (widening the shared seam breaks three doubles under `strictFunctionTypes`). The duplication is deliberate — but the UA string and the webdriver patch are two copies that must move together. | Extract the shared constants into a tiny module both import; leave the adapter duplication. ~15 min. |
| N005 | Architectural decay (residual, carried) | `src/judge.ts` (1091 LOC) | Medium | M | Carried from runs #2-#5 and now WORSE: 830 -> 1091 LOC (+31%). The deferral condition ("move `dispatchLlmCall` + `DispatchWarns`/`DispatchOutcome` into `judge-dispatch.ts` when `judge.ts` is next touched for real work") has been met five times over. | Fold into N042. The split is the same work; do it once. |
| N017 | Performance / resource hygiene (repo growth) | `state/seen-posts.json` | Medium | M | Carried from run #4 and now WORSE: 1.6 MB -> 4.0 MB, 1273 commits, `.git` 189 MB. | Fold into N043. |


**Executed 2026-11-14 (same session):** all four cuts landed. One deviation from the plan above: the blocked-pick helper went to **`judge-exhaustion.ts`**, not `judge-rotation.ts` — the architecture guidance binds rotation to a ZERO-RUNTIME-IMPORT identity (paired constant + structural slice), and the helper needs rotation primitives at runtime; the one-way edge runs exhaustion -> rotation, and the module name is now accurate (it holds the D4/D11 policy the exhaustion terminal decides on). Final: `judge-dispatch.ts` 645 -> **466**, `linkedin-walk.ts` 541 -> **420**; new modules `judge-shared.ts` (173), `judge-exhaustion.ts` (67), `linkedin-walk-static.ts` (145), `sleep.ts` (17). Gates: typecheck rc=0, lint rc=0 (78 files), tests **638 pass / 0 fail** — the same count as before the cuts, so the extraction is behavior-preserving. The pinned `SCROLL_JS` test stayed green.

## Resolved ledger

Run-#4 findings, verified against `main` @ `df890a9`:

| ID | Was | Status | Verified by |
|----|-----|--------|-------------|
| N010 | LinkedIn credential blob `linkedin-state.b64` committable in the repo root | RESOLVED | `ls linkedin-state*` empty; `git log --all -- '*linkedin-state*'` empty; the SDK cutover that minted it was reverted, so the ignore rule is no longer needed |
| N011 | Entire SDK cutover uncommitted in the working tree | RESOLVED | the cutover was reverted wholesale; `git status --porcelain` is empty; the browser-walk leg is committed on `main` |
| N012 | 3 dead exports (`createLinkedApiClient`, `makeChromiumContextFactory`, `chromiumContextFactory`) | RESOLVED (class recurred) | all three are gone with `src/fetch-linkedin-api.ts`; knip now reports 10 NEW dead symbols — see N041 |
| N013 | Parked-workflow guard matched only one `pendingReason` | SUPERSEDED | `src/fetch-linkedin-api.ts` is deleted; the browser walk has no `pendingReason` path |
| N014 | `captureLines` silenced console by direct reassignment | RESOLVED | `tests/fetch-linkedin-api.test.ts` is deleted; `rg 'console\[' tests` is empty and 77 sites use `t.mock.method(console, ..., console.log.bind(console))` |
| N015 | AGENTS.md described a Threads-only watcher | RESOLVED | AGENTS.md now names both platforms, the browser walk, the PC loop, and the payload hand-off — but new drift landed: N044, N045 |
| N016 | Four orphaned GitHub secrets from the SDK cutover | SUPERSEDED | the cutover was reverted, so the secrets may be live again; cannot verify from the repo — see open question 5 |
| N009 | stale acquisition comment | RESOLVED | the block was replaced by the browser-walk acquisition comments |

Run-#6 findings, verified against `main` after the run-6 remediation:

| ID | Was | Status | Verified by |
|----|-----|--------|-------------|
| N041 | 10 dead exports (7 values + 3 types) | RESOLVED | `npm run knip` exits 0; the pinned gate runs in ci.yml after Test |
| N042 | Two god files above 500 LOC | RESOLVED (named files only) | `wc -l src/judge.ts src/linkedin-fetch.ts` both under 500; the split created two new >500 files, tracked as N060 |
| N043 | Repo growth, 172 MB loose objects | RESOLVED (policy) | one `git gc --aggressive`; the policy is recorded in `.rpiv/guidance/architecture.md` |
| N044 | AGENTS.md lint list omits replay-linkedin | RESOLVED | the lint list matches `package.json`'s script |
| N045 | Five modules in no doc layer | RESOLVED | the six-layer grep pass finds every module name |
| N046 | Seen-streak counts completion order | RESOLVED | the reversed-completion-order test names the stream-order id |
| N047 | The 150-post cap is advisory | RESOLVED | a 200-post walk returns exactly 150, the newest |
| N048 | Both listener arms swallow every fault | RESOLVED | a parser fault warns once; the page-close race stays silent |
| N049 | Flag writes are not atomic | RESOLVED | a failed rename leaves no truncated flag and no temp |
| N050 | A zero-post walk overwrites the last good payload | RESOLVED | the guard test asserts the payload is untouched |
| N051 | Capture disk has no bound | RESOLVED | an 8 MB per-body bound skips the write whole with one warn |
| N052 | Capture PII at rest is undocumented | RESOLVED | README carries the retention and purge section |
| N053 | The profile dir is a hardcoded literal | RESOLVED | `LINKEDIN_PROFILE_DIR` reaches the browser; the override test pins it |
| N054 | Ten positional parameters | RESOLVED | `FetchLinkedInDeps`; no positional call site remains |
| N055 | Two URN digit floors disagree | RESOLVED | one `ACTIVITY_ID_PATTERN`, three readers |
| N056 | Dead ignore rules | RESOLVED (partial, by design) | the two `outputs/` rules deleted; the recon and budget rules stay (D5) |
| N059 | The context factory duplicates the UA + patch | RESOLVED | both live once, in `src/browser-constants.ts` |
| N005 | `judge.ts` residual | RESOLVED | folded into N042 |
| N017 | `seen-posts.json` growth | RESOLVED (policy) | folded into N043 |
| N060 | Two god files regrown by the run-6 split (judge-dispatch 645, linkedin-walk 541) | RESOLVED | executed same session as the scoping: sleep seam -> `src/sleep.ts`, shared vocabulary -> `judge-shared.ts`, blocked-pick policy (D4/D11 flavor split) -> `judge-exhaustion.ts` (target moved off judge-rotation: the guidance binds rotation to ZERO-RUNTIME-IMPORT), walk statics -> `linkedin-walk-static.ts`; `wc -l`: 466 / 420; typecheck + lint + 638 tests green; the pinned SCROLL_JS test byte-identical |

Run-#1 F001-F024, run-#2 N001-N004, run-#3 N005-N009, run-#5 N018-N040: the ledgers stand. The
touched subset was re-checked this run — `state.ts`, `email.ts`, `heartbeat.ts`, and `pool.ts` are
unchanged since run #4 except for `readSeenIdSet` (new, tested).

## Top 5 — if you fix nothing else, fix these

**1. N042 + N005 — split `judge.ts` now (about 2 hours).**
The deferral trigger has fired five times. Move `dispatchLlmCall` + `DispatchWarns` +
`DispatchOutcome` + `AttemptDirective` + `ContentDecision` into `judge-dispatch.ts`; move
`systemMessage` + `buildMessages` + `buildBulkMessages` into `judge-prompts.ts`. `judge.ts` keeps
`judgeBatch`, `judgePost`, `judgePosts`, and the env resolvers. No behavior change; the 1274-line
test file needs no edit because every moved symbol is already exported or reachable through
`judgePosts`.

**2. N051 — bound the capture disk (about 30 minutes).**
`captures/` is 273 MB today and the steady state is ~1.7 GB with no alarm. Add
`LINKEDIN_CAPTURE=off` as an env kill switch, and skip the write above a size threshold with one
warn. Drop the `null, 2` pretty-print — it roughly halves the bytes for zero loss.

**3. N043 + N017 — reclaim `.git` and pick a state-history policy (15 minutes, then a decision).**
`git gc --aggressive --prune=now` reclaims most of the 172 MB of loose objects. Then decide: accept
the growth, schedule a gc, or move seen-state out of git. Record the choice in the guidance so the
next run stops re-asking.

**4. N045 + N044 — sync the docs (about 20 minutes).**
Five modules appear in no doc layer. Add one bullet per module to AGENTS.md, one line per module to
`.rpiv/guidance/src/architecture.md` and `.rpiv/guidance/scripts/architecture.md`, and add
`scripts/replay-linkedin.ts` to AGENTS.md's lint list.

**5. N041 — unexport the 10 dead symbols and add knip to CI (about 15 minutes).**
Drop `export` on each of the 10. Then add `npx knip` to `ci.yml` — without a gate, this class has
recurred four runs running.

## Quick wins

- [ ] N044: add `scripts/replay-linkedin.ts` to AGENTS.md's lint list (1 min)
- [ ] N056: delete `state/linkedin-get-budget.json` + 4 stale ignore rules (2 min)
- [ ] N047: slice the walk's return to `LINKEDIN_MAX_POSTS` (2 min)
- [ ] N055: share one URN digit floor between parser and payload reader (5 min)
- [ ] N041: drop `export` on 10 symbols (10 min)
- [ ] N049: atomic marker/latch writes via `stateTempPath` (10 min)
- [ ] N053: env override for `LINKEDIN_PROFILE_DIR` (10 min)
- [ ] N045: five module bullets across three docs (20 min)

## Things that look bad but are actually fine

- **madge's two cycles (`judge.ts` <-> `judge-health.ts`, `judge.ts` <-> `judge-rotation.ts`).**
  Both are type-only (`import type`), erased by `verbatimModuleSyntax`; the runtime edge is one-way.
  Same ruling as runs #1-#5. Leave them.
- **The duplicated LinkedIn context factory** (`linkedin-fetch.ts:340-395`). It reads as copy-paste
  debt, and it is — but the alternative (widening the shared `ContextFactory` seam) breaks three
  existing doubles under `strictFunctionTypes`, and re-exporting the private shared factory
  re-introduces the knip finding. The duplication is the cheaper of two real costs. Only the two
  constants are worth sharing (N059).
- **`checkJudgeAvailability`'s catch block** (`judge-availability.ts:96-101`). `Promise.allSettled`
  never rejects, so the catch looks unreachable. It is Layer 2 of a documented two-layer contract:
  it fires for module-code faults around the orchestration, and it degrades to all-available with
  one warn. Defensive, not dead.
- **`readSeenIdSet`'s `stat` pre-probe** (`state.ts:177-192`). Looks redundant next to `loadState`,
  which already handles ENOENT. It is not: `loadState` swallows ENOENT into an empty state, so the
  `stat` exists to give the absent file its own warn line in the PC clone, where the file is
  committed data.
- **The parser's pairing heuristic** (`linkedin-parser.ts:270-300`). Pairing the i-th text with the
  i-th id by timestamp looks like a bug waiting to happen. It is a documented, evidence-backed guess
  (the stream carries no id<->text link; BFS over the $-ref graph reaches zero id rows), and the
  alternative — minting nothing — is strictly worse. The replay harness exists to settle it.
- **`collectLinkedInPosts`'s per-body `console.log`** (`linkedin-parser.ts:305-311`). One line per
  body naming every pairing looks like debug noise left in. It is the only mis-pair detector that
  exists, and the module says so.
- **`stateTempPath`'s `Math.random`** (`state.ts:250`). Not a security primitive, not a collision
  risk: it mints a unique sibling temp name so a crashed write cannot clobber the next one. The
  20478d1 bug is why it exists.
- **`guardCheckout`'s clean-tree requirement** (`fetch-linkedin.ts:254-261`). Hostile to a working
  tree, correct for the job: a dirty tree wedges the rebase AFTER a live fetch is burned, and a
  non-`main` branch pushes the payload to a ref the hosted run never reads. Two git reads, zero
  network, before any navigation.
- **`page.url?.()` optional calls** (`linkedin-fetch.ts:508`). The optional seam exists for
  pre-Slice-3 doubles; the production adapters always supply `url`. The comment says so.
- **`judge-availability`'s 10 s timeout** (`judge-availability.ts:36`). Deliberately decoupled from
  the judge's 60 s batch contract: the probe is a tiny call, and every account is probed in
  parallel, so 10 s bounds the whole stage.
- **`index.ts`'s hoisted `resolveJudgeConfig`** (`index.ts:352`). It moves a malformed
  `LLM_ACCOUNTS` failure earlier — a Gate-1 tick that used to exit 0 now exits 1. Recorded and
  accepted: the degraded-accounts line must ride every email, and that needs the pool size.
- **`cancel-in-progress: true`** (`watch.yml:19`). Can produce a duplicate digest (a run cancelled
  after `sendDigest` but before `persistJudged`). That is F021's accepted one-duplicate cost, and
  the alternative — queueing behind a parked run — backs the schedule up unboundedly.
- **`npm test` absent from `watch.yml`.** Tests are the merge gate (`ci.yml`), not a per-tick cost.
  The 10-minute cadence rewards that.
- **`linkedin-capture.ts`'s best-effort prune** (`linkedin-capture.ts:168-181`). A failed prune
  never fails the capture that just landed. Correct direction: the write already succeeded, and the
  next successful prune cleans up.
- **`captureOnce`'s warn-once** (`linkedin-capture.ts:194-207`). A persistently broken sink must not
  spam every body, and a fully silent sink would void the capture premise invisibly. One warn per
  surface walk is the right dose.

## Open questions for the maintainer

1. **Is the pairing heuristic good enough to ship?** The replay harness exists; has its output been
   read? If the zip mis-pairs, every LinkedIn digest links the wrong text to the wrong permalink —
   and the judge scores the wrong text. This is the highest-consequence unknown in the repo.
2. **What is the accepted capture disk budget?** ~1.7 GB steady state with no alarm (N051). Fine on
   the operator's disk, or should the sink be off by default and on only for a probe run?
3. **`state/` history growth (N043): accept, gc periodically, or move out of git?** Today's answer is
   implicit (accept). Make it explicit in the guidance before the clone size forces the question.
4. **`.rpiv/artifacts` is 168 tracked files with no pruning policy.** Intentional archive, or prune?
   Carried x4.
5. **Are the four orphaned GitHub secrets still set?** `LINKEDIN_SESSION_STATE`, `LINKEDIN_EMAIL`,
   `LINKEDIN_PASSWORD`, `LINKEDIN_SECRET_WRITER` were orphaned by the SDK cutover, which was then
   reverted — so they may be live again, or dead. Cannot verify from the repo. Check Settings ->
   Secrets and delete what nothing maps.
6. **Is `scrollRounds: 50` intentional for the LinkedIn walk** (N057), or a Threads value that
   leaked into the shared knob? The logs carry the click count per surface — one walk answers it.
7. Carried x5: should the probe's ramp logic (`scripts/probe-judge.ts`) have tests? Still the only
   uncovered non-trivial logic in the repo (N058).
8. Carried x3: negative state deltas still commit as "state: -N new seen post ids". Deliberate
   greppability, or should a negative delta say "pruned"?
9. Carried x3: is `reasoning_effort` verified against every endpoint in the pool? Live-only; the
   probe's minimal call would surface a proxy that rejects the field.
