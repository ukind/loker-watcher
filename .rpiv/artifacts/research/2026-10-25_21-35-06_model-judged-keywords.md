---
date: 2026-10-25T21:35:06+0700
author: Yogiswara Utama
commit: 67d422d
branch: main
repository: loker-watcher
topic: "Model-judged keyword filtering"
tags: [research, codebase, judge, keywords, heartbeat, state, tests]
status: ready
last_updated: 2026-10-25T21:35:06+0700
last_updated_by: Yogiswara Utama
---

# Research: Model-judged keyword filtering

## Research Question
Developer's words: "currently the rules is: keywords is Pre-filter. A post must contain one of these to reach the judge. but i want to changed it instead. the filter is solely by the model but based on the keywords. so if the model as the judge think the post is related to the 'list of that keywords' the it pass / valid" — plus "can we process in builk?" (fewer LLM calls than one-per-post).

## Summary
The keyword gate (`filterPostsByKeywords`, called `src/index.ts:94`) is removed; `newPosts` from `diffNew` (`src/index.ts:86`) flows straight into `judgePosts` (`src/index.ts:103`). `src/judge.ts` is rewritten around sequential ~10-post batches: one chat-completions call per batch, an id-keyed-object verdict response (`{"<post id>": {"relevant": ..., "locationOk": ...}}`), per-item validation, and per-item fallback to the unchanged single-post `judgePost` (`src/judge.ts:120-179`). The config `keywords` list reaches the prompt via a widened signature (plain param before trailing `fetchFn`), serialized as JSON in the system message. `stats.maybes` becomes a judged-candidates count meaning **posts sent to the judge** (`newPosts.length`); all "keyword maybe" vocabulary leaves stats, email copy, and test names. The D3 persistence invariant (skipped ids stay unseen, retry next run) holds structurally — skipped ids never enter the write path. No dead code: `src/keywords.ts` is deleted and judge tests move to `tests/judge.test.ts`.

## Detailed Findings

### Judge core: bulk rewrite of `judgePosts`
- Current shape: sequential `for..of` calling `judgePost` per post (`src/judge.ts:185-205`), pushing to `judged`/`skippedPostIds` (`JudgeBatchResult`, `src/judge.ts:27-30`).
- Frozen return contract, consumed at: `src/index.ts:103` (destructure), `:104-106` (matches filter needs the **original Post objects** with text/permalink/author), `:107-108` (stats), `:127-128` (persist ALL judged ids, relevant or not; skipped stay unseen per D3 comment `src/index.ts:123-126`).
- Reused pieces: endpoint normalization `src/judge.ts:125-127`; payload `{model, messages, temperature: 0}` `:129-134`; `AbortSignal.timeout(REQUEST_TIMEOUT_MS = 15_000)` `:14,:144` — 15s now bounds the whole 10-post call, so a timed-out batch is a whole-batch miss routing all items to fallback; response unwrap `choices?.[0]?.message?.content` `:155-158` (already noUncheckedIndexedAccess-safe).
- `judgePosts` must absorb LLM failures into the result, never throw: `src/index.ts:103` has no try/catch; a throw routes to `main().catch` and skips BOTH the digest and the state write for the whole run.
- A post lands in exactly one of `judged` / `skippedPostIds`; a skipped post must have exhausted bulk miss + 2 fallback attempts (FRD #4).

### Bulk verdict parser (id-keyed object — checkpoint decision)
- `parseVerdict` today (`src/judge.ts:63-95`): fence strip `:65-69`, slice first `{` to last `}` `:71-77`, requires both booleans `:80-89`, returns null on any failure — a total function.
- New parser: `parseBulkVerdicts(content: string): Map<string, JudgeVerdict> | null`. Container-level null ONLY when the whole response is unrecoverable (JSON.parse throw, non-object container, no braces). Per-item validator (`unknown → JudgeVerdict | null`, mirroring `:83-84`); a malformed item is absent from the map, never fails the batch.
- Typing under `noUncheckedIndexedAccess` (`tsconfig.json:9`): build the Map via `Object.entries` (`[string, unknown][]`), look up with `map.get(post.id)` → `JudgeVerdict | undefined` — no non-null assertions anywhere. `Map` also neutralizes hostile keys (`__proto__`, `constructor`). Chunk with `candidates.slice(i, i + BATCH_SIZE)` + `for..of` (no manual indexing).
- `Post.id` is a numeric string (`src/types.ts:10-12`, e.g. `"3388928313420694692"` — exceeds `Number.MAX_SAFE_INTEGER`); never coerce ids through `Number()`.
- Edge cases: extra ids are never looked up (router iterates the batch's Posts, `map.get` per id); mangled id → `undefined` → fallback; duplicate JSON keys collapse to last occurrence by construction; non-boolean fields → item absent → fallback.
- Prompt: id-echo instruction replaces the schema tail at `src/judge.ts:111` ("Respond with ONLY a raw JSON object mapping each post id to its verdict..."); ids are listed inline with each post in the same user message; the per-post `buildMessages` stays for the fallback path.

### Fallback semantics and retry budget
- `judgePost` (`src/judge.ts:120-179`) is reused VERBATIM as the fallback: attempt loop `:135`, HTTP fail `:147-151`, missing content `:159-162`, parse null `:164-171`, catch `:172-175`, null return `:178`, skip+warn in `judgePosts` `:196-199`.
- Whole-batch failure (HTTP / missing content / container-parse null) = zero valid verdicts = every item drops into per-item fallback. The batch itself gets NO retry attempts — `judgePost`'s loop remains the only retry mechanism, keeping worst-case call counts deterministic.
- Budget: happy path = ceil(N/10) calls; per missed item ≤ 2 fallback fetches; whole-batch miss worst case = 1 + 10×2 = 21; global worst = ceil(N/10) + 2N (vs 2N today). Worst wall-clock per doomed post = 3 × 15s.
- Warn lines: batch-stage warns are NEW and must NOT copy the `/2` suffix (batch has exactly 1 attempt) — e.g. `judge: batch N (M posts) HTTP ...` and `... failed to parse bulk verdicts — falling back to M single-post call(s)`. The skip warn (`:199`) should name both stages. Fallback warns (`:149,:160,:170,:174`) stay accurate as-is.

### Funnel: gate removal and stats
- Gate: `filterPostsByKeywords` `src/keywords.ts:33-35` (`matchesKeywords` `:16-31`, case-insensitive substring), imported `src/index.ts:19`, called `:94` as `const maybes = filterPostsByKeywords(newPosts, config.keywords)`.
- Deleting `:94-101` collapses the zero-maybes early return entirely (nothing can zero the funnel between `diffNew` `:86` and judge `:103`). The no-new-posts branch `:87-91` survives unchanged (heartbeat already gets `[]`). Post-change, `newPosts.length > 0` with everything skipped lands in the existing `matches.length === 0` return `:113-117`. Two early returns remain (`:87-91`, `:113-117`).
- Stats: `maybes: 0` init `src/index.ts:79`, set `:95` → becomes the judged-candidates count = `newPosts.length` (checkpoint decision: posts SENT — same meaning as old `maybes`, consistent with the funnel convention that each stage logs its input; judge outputs are already counted by `relevantLocated` `:107` and `skipped` `:108`). The set position stays valid (value known at `:86`, before any heartbeat at `:88`/`:114`).
- Log `src/index.ts:109-111` (`keywords: N maybes, judge: M relevant+located, skipped: K`) becomes ONE judge stage line, e.g. `judge: N candidate(s) judged, M relevant+located, skipped: K` — log N equals the heartbeat stat, preserving the log↔heartbeat funnel consistency.
- `heartbeat()` helper (`src/index.ts:32-50`, third param `:35`) now carries `newPosts`. Passing judged-relevant matches would be dead code: the heartbeat only fires on zero-match runs where `matches` is empty by definition. Call sites `:88` (stays `[]`), `:114` (becomes `newPosts`).
- Pipeline doc comment `src/index.ts:6-7` drops the `keywords` stage from the stage list.

### Prompt criterion and config flow
- `buildMessages` (unexported, `src/judge.ts:100-114`, called once from payload `:131`): system message `:105-107` hardcodes "...genuine job opening for frontend or fullstack web development,"; user criterion 1 `:111` hardcodes frontend/fullstack exemplars (React, Vue, Next.js...). Both are REPLACED; criterion 2 (Indonesia-or-remote → `locationOk`) stays byte-identical. Exemplars must be deleted too, or the subject matter stays hardcoded behind the config list.
- keywords path: `watcher.config.json` → `readStringArray(record.keywords, "keywords", filePath, /*requireNonEmpty*/ true)` `src/config-file.ts:79` (error texts `:100-118` UNCHANGED per FRD #7) → `WatcherConfig.keywords` `src/config-file.ts:26` → `main()` `src/index.ts:54` → judge call.
- Signature widening: plain `keywords: readonly string[]` param BEFORE the trailing `fetchFn` on both `judgePosts` and `judgePost` (repo DI convention; do NOT fold into `JudgeConfig` — that is env config, keywords is file config, and the repo separates the two sources). Callers: `src/index.ts:103`, `src/judge.ts:194` (loop), `tests/keywords.test.ts:186,205,217` (judgePost), `:255` (judgePosts).
- Serialization: `JSON.stringify(keywords)` in one labeled sentence in the SYSTEM message (criteria channel; user message stays the data channel). JSON form is deterministic for operator keywords containing commas/quotes/newlines (`readStringArray` only requires non-empty strings). Injection surface unchanged: `post.text` interpolated raw at `src/judge.ts:111` is frozen by the FRD security NFR; keywords are operator-authored (lower risk).
- Module header doc (`src/judge.ts:2-9`, "Calls the endpoint once per candidate post") needs rewriting.

### Heartbeat and candidate vocabulary
- `HeartbeatStats` `src/heartbeat.ts:24-41`: `maybes: number` `:34`, doc `:33` ("Posts that passed the keyword pre-filter"). Renderer `buildHeartbeatBody` `:103-141`: funnel lines `:110-117`, banned copy `N keyword maybe(s)` `:115`; candidate tag `[keyword match]` `:128` gated on `reason === "maybe"`.
- `Candidate` `src/heartbeat.ts:44-48`: `reason: "maybe" | "near-miss"` `:47`. `selectCandidates` `:60-82`: judged tier `:66-69`, cap `:70-71`, dedup via `maybeIds` Set `:72`, near-misses from `recent` `:73-75` newest-first `:77-80`. `candidateTerms` is separate config (`src/config-file.ts:27`, may be empty `:80`) — untouched.
- Checkpoint decision: rename `reason: "maybe"` → `"judged"` (and `:68`), tag `:128` → `"[judged]"` — post-gate the old labels are false statements; "near-miss" survives untouched.
- Stats triad rule (guidance "Adding a New Pipeline Stage" step 5): field + init + renderer together — `src/heartbeat.ts:34`, `src/index.ts:79`, `src/index.ts:95`, `src/heartbeat.ts:115`.
- Heartbeat tests that break: `tests/heartbeat.test.ts:38` (`maybes: 1` fixture — typecheck break propagated to every STATS consumer), `:61` ("puts keyword maybes first" — reason vocabulary), `:138` ("1 keyword maybe(s)" copy), `:142-149` (`reason: "maybe"` at `:144` + `[keyword match]` assert at `:147` — a fourth break the FRD list missed). Unaffected: `matchesCandidateTerms` `:41-59`, snippet, ageHours, subject, selectCandidates tests passing `[]` (`:70,:87,:99`), sendHeartbeat `:165-196`.
- `heartbeat()` stays best-effort: it swallows its own errors (`src/index.ts:46-50`); no heartbeat path can fail the run.

### State: partial-failure persistence
- Write path: `sendDigest` `src/index.ts:121` → `judgedIds = judged.map(...)` `:127` → `saveState(state, judgedIds)` `:128`. Double-gated: the `matches.length === 0` return `:113-117` prevents the call, AND `saveState` re-gates via `diffNewIds` (`src/state.ts:120-132`, called `:175`) returning `{saved: false}` before ANY disk call when `freshIds.length === 0` (`:177-183` — mkdir lives only inside `writeStateAtomic` `:143-151`, so a no-op save doesn't even create the directory).
- Mixed-outcome trace (10 candidates: bulk valid A1-A8, A9 fallback success, A10 all-fail): `judged` = A1-A9, `skippedPostIds` = [A10]. If ≥1 match: all 9 judged ids persisted (relevant or not, per D3 comment `src/index.ts:123-126`); A10 never written, re-enters via `diffNew` next run. If 0 matches: NOTHING persists — even judged-irrelevant ids only persist when ≥1 match exists (subtle; worth a test comment).
- Skipped id → marked seen is structurally impossible: the only disk writer is `writeStateAtomic` (`src/state.ts:139`) ← `saveState:190` ← `judgedIds` (`src/index.ts:127`). `skippedPostIds` is consumed only by stats (`src/index.ts:108`), the log (`:110`), and the heartbeat render (`src/heartbeat.ts:118`).
- Serialization format pinned at `src/state.ts:147` (2-space JSON + trailing newline); atomic sibling-temp + rename `:146,:150-151`.
- Acceptance test strategy (byte-identical state) needs TWO tests: the judge half in `tests/judge.test.ts` (skippedPostIds contract; `src/judge.ts` touches no disk) and the state half in a NEW `tests/state.test.ts` (1:1 naming; `src/index.ts` has no injection seam — guidance untested-module backlog says new work in state.ts starts with tests; `filePath` seams exist at `src/state.ts:87,:173`). Assert `result.saved === false` in addition to byte equality (bytes alone could pass vacuously); include a positive control (`saveState(state, ["2"], path)` → `saved: true`, round-trips) so the suite cannot pass because both halves silently no-op.

### Test relocation and conventions
- `npm test` = `tsx --test tests/*.test.ts` (`package.json:9`): new file auto-discovered; the old file must be renamed/deleted, never copied (a leftover `tests/keywords.test.ts` fails typecheck on its `../src/keywords.js` import anyway).
- Conventions (guidance + existing files): `node:test` describe/it + `node:assert/strict`; responses as `new Response(JSON.stringify({choices:[{message:{content}}]}), {status, headers})`; integer call counters; "assert the RETRY happened, not just the outcome"; config fixture = top-level `await loadWatcherConfig("watcher.config.json")` (`tests/keywords.test.ts:16`; reword its comment — keywords stays required, only its role changed).
- Fate table for `tests/keywords.test.ts`: imports `:1-10,:12` keep (delete `:11` keywords import); CONFIG `:14-16` keep + reword; `matchesKeywords`/`filterPostsByKeywords`/`shipped-config` describes `:18-116` DELETE; `parseVerdict` describe `:118-140` RELOCATE verbatim; `resolveJudgeConfig` describe `:142-160` RELOCATE verbatim; `judgePost` describe `:162-221` (fixtures `:163-175`, 3 its with `callCount === 2` at `:206,:218`) RELOCATE verbatim — it is the fallback's correctness proof; `judgePosts` describe `:223-265` REWORK into the AC seeds (two-post fixture "101"/"102" and the skipped-id assertion carry over).
- AC test designs: (a) 10 posts → assert `calls === 1` AND `judged.length === 10` (one call alone doesn't prove all ten parsed). (b) bulk response missing/corrupt item (`relevant: "yes"` — the exact class `:82-94` rejects) → assert `calls === 2` (1 bulk + 1 successful fallback) AND the id present in `judged` AND exactly one post-bulk body mentions that id. (c) judge half: bulk omits id + both fallback attempts fail → `calls === 3`, id in `skippedPostIds`, absent from `judged`; state half in `tests/state.test.ts` per above. (d) capture `opts.body` across calls (pattern `tests/keywords.test.ts:242-254`); assert every `CONFIG.keywords` entry present and the full `:106` phrase "frontend or fullstack web development" absent (assert the full phrase — bare "frontend"/"fullstack" substrings are not the test).
- Mock routing must change: `opts.body.includes("Failing post")` is ambiguous post-bulk (the bulk body contains ALL candidate texts, so the mock would 500 the bulk call and silently test only the all-fallback path). Use call-count routing (call 1 → bulk verdicts, calls ≥2 → 500) or parse-body routing; deterministic because batches are sequential.

## Code References
- `src/judge.ts:14` — `REQUEST_TIMEOUT_MS = 15_000`; batch-size constant belongs beside it
- `src/judge.ts:27-30` — `JudgeBatchResult` return contract (frozen)
- `src/judge.ts:63-95` — `parseVerdict` (single-object; seed for the bulk parser's fence/slice tolerances)
- `src/judge.ts:100-114` — `buildMessages` (hardcoded criterion to replace; prompt construction)
- `src/judge.ts:120-179` — `judgePost` (fallback path, reused verbatim; retry loop `:135`)
- `src/judge.ts:125-158` — endpoint normalization, payload, timeout, response unwrap (reused by batch calls)
- `src/judge.ts:185-205` — `judgePosts` (the rewrite target)
- `src/index.ts:6-7` — pipeline stage doc comment (drop `keywords`)
- `src/index.ts:32-50` — `heartbeat()` helper (third param carries `newPosts`)
- `src/index.ts:74-83` — stats init (`maybes: 0` at `:79`)
- `src/index.ts:86-101` — `diffNew` + the two branches (zero-maybes branch deleted)
- `src/index.ts:94` — the gate call (deleted)
- `src/index.ts:103-111` — judge call + stats + funnel log (rewired to `newPosts`)
- `src/index.ts:113-117` — zero-matches early return (heartbeat gets `newPosts`)
- `src/index.ts:119-129` — email-before-state ordering (untouched)
- `src/keywords.ts:16-35` — module to delete (`matchesKeywords`, `filterPostsByKeywords`)
- `src/config-file.ts:25-30` — `WatcherConfig` (keywords `:26`, candidateTerms `:27`)
- `src/config-file.ts:79` — keywords validation (required + non-empty; errors `:100-118` unchanged)
- `src/heartbeat.ts:24-41` — `HeartbeatStats` (`maybes` `:34`, doc `:33`)
- `src/heartbeat.ts:44-48` — `Candidate` (`reason` union `:47`)
- `src/heartbeat.ts:60-82` — `selectCandidates` (receives `newPosts`)
- `src/heartbeat.ts:103-141` — `buildHeartbeatBody` (banned copy `:115`, tag `:128`)
- `src/state.ts:110-132` — `diffNew`/`diffNewIds` (retry-invariant read halves)
- `src/state.ts:170-197` — `saveState` (re-gate `:175-183`, format `:147`, atomic write `:185-190`)
- `src/types.ts:10-12` — `Post.id` numeric string (never `Number()`)
- `src/types.ts:24-30` — `JudgeVerdict` (`relevant` doc `:25` rewords; `locationOk` `:27` unchanged)
- `tsconfig.json:8-11` — strict flags (`noUncheckedIndexedAccess: true` at `:9`)
- `package.json:9` — test glob `tsx --test tests/*.test.ts`
- `tests/keywords.test.ts:118-221` — describes relocating verbatim (parseVerdict, resolveJudgeConfig, judgePost)
- `tests/keywords.test.ts:223-265` — judgePosts describe reworking into AC seeds (body-sniff mock `:242-254`)
- `tests/heartbeat.test.ts:38,61,138,142-149` — the four breaking heartbeat tests

## Integration Points

### Inbound References
- `src/index.ts:103` — the only production consumer of `judgePosts` (destructures `{ judged, skippedPostIds }`)
- `src/judge.ts:194` — `judgePosts` loop calls `judgePost` per post (fallback threading)
- `tests/keywords.test.ts:186,205,217,255` — test callers of `judgePost`/`judgePosts` (move to `tests/judge.test.ts`)
- `src/index.ts:88,114` — heartbeat call sites feeding `selectCandidates`

### Outbound Dependencies
- `src/judge.ts:125-134` — OpenAI-compatible POST `{baseUrl}/chat/completions` (bulk prompts ~10 posts must be accepted by the endpoint — FRD assumption to verify live)
- `src/judge.ts:11` — `ENV_NAMES` via `resolveJudgeConfig` (`src/judge.ts:20-46`; env-only, unchanged)
- `src/config-file.ts:26` — `keywords` source of truth (`watcher.config.json`, validation unchanged)

### Infrastructure Wiring
- `src/judge.ts:123,188` — `fetchFn: typeof fetch = fetch` trailing DI seam (test injection; must survive)
- `src/state.ts:87,141,173` — `filePath` trailing DI seams (enable the new `tests/state.test.ts`)
- `package.json:9` — test glob auto-discovers `tests/judge.test.ts` + `tests/state.test.ts`
- `.github/workflows/watch.yml` — unchanged (runs `npx tsx src/index.ts`; state commit-back)

## Architecture Insights
- Funnel convention: every stage logs its INPUT size; judge outputs already have their own counters (`relevantLocated`, `skipped`) — this forced the "posts sent" meaning of the judged-candidates stat.
- One retry mechanism: `judgePost`'s 2-attempt loop is the only retry in the module; the batch call gets none — deterministic worst-case call counts (ceil(N/10) + 2N).
- Instruction/data split in the prompt: criteria (keywords list) in the system message, post payloads in the user message — preserved from the current shape.
- env config vs file config separation: keywords rides as a plain parameter, not folded into `JudgeConfig` (which is env-resolved).
- `Map` over `Record` for the verdict lookup: `Map.get` types cleanly under `noUncheckedIndexedAccess` and neutralizes prototype-polluting keys a model might echo.
- Double-gated persistence: pipeline guard (`src/index.ts:113-117`) + `saveState` re-gate (`src/state.ts:177-183`) — the bulk rewrite changes neither.
- Parse-don't-validate at the LLM edge: per-item null = count-and-continue (fallback); container null = whole-batch miss (all items fall back). Never throw across the judge boundary.
- Email-before-state and skipped-stay-unseen (D3) are untouched by design; the bulk path must not reorder or re-gate them.

## Precedents & Lessons
6 similar past changes analyzed.

### Precedent: Initial pipeline with keyword pre-filter + single-post judge
**Commit(s)**: `1a9e353` — "feat: threads #hiring indonesia job alert pipeline (v1)" (2026-10-25)
**Blast radius**: 20 files, all layers — introduced `src/judge.ts`, `src/keywords.ts`, `src/index.ts` funnel, `tests/keywords.test.ts`.
**Follow-up fixes**: `67a9bd2` (2026-10-25) — zero-match runs sent no email at all (pre-filter precision made silent runs the norm); README corrections for docs drift.
**Lessons from docs**: validation 2026-10-25_12-11-38 — judge verified live (z.ai glm-5.3-flash): parseVerdict handles prose-wrapped JSON; email-before-state keeps failed sends from marking posts seen. Design D3 — parse failure → skipped, NOT written to state, logged visibly.
**Takeaway**: skip/retry/seen-retry semantics already exist — the bulk path must reproduce them per-item exactly.

### Precedent: Heartbeat introduction (the vocabulary being reworked)
**Commit(s)**: `67a9bd2` — "feat: no-match heartbeat status email" (2026-10-25)
**Blast radius**: 3 layers — `src/heartbeat.ts` (maybes counter, copy, tag), `src/index.ts` (3 zero-match exits), `src/email.ts`.
**Follow-up fixes**: `c64c427`/`18246dd` — heartbeat revealed zero-match is the normal case.
**Lessons from docs**: validation 2026-10-25_14-19-21 — `maybes` lives in index stats AND heartbeat body AND tests simultaneously; renaming touches all three.
**Takeaway**: "keyword maybe" vocabulary is spread across stats, email copy, tests, and README — grep and update in one commit.

### Precedent: Keyword widening failed to seed a match
**Commit(s)**: `c64c427` + revert `18246dd` — "test: widen keywords temporarily..." (2026-10-25)
**Blast radius**: 1 file each (`src/config.ts`), byte-exact revert.
**Lessons from docs**: widening surfaced 3 maybes, judge rejected all 3; live-feed probe found 59 unique posts, zero dev-term posts. Converse (validation 2026-10-25_14-52-43): one added keyword moved funnel 0 → 8 maybes, 8 relevant+located.
**Takeaway**: the keyword list is the precision lever — it now moves into the prompt; expect the funnel to shift dramatically and verify a real match run end-to-end (the digest + state-commit paths have NEVER executed in production across 6 validation rounds).

### Precedent: Config validation governing keywords
**Commit(s)**: `b050436` — "feat: json config as source of truth with url surfaces" (2026-10-25)
**Blast radius**: 12 files — `src/config-file.ts` (strict unknown-key rejection), keywords became required param.
**Takeaway**: keep `keywords` required/non-empty with unchanged errors (FRD #7); batch size stays a module constant — don't leak a new config key.

### Precedent: Volume expansion via authenticated fetch
**Commit(s)**: `9e1c8ef` — "authenticated threads fetch with recency cutoff" (2026-10-25)
**Blast radius**: 8 files; direct behavioral follow-up was the heartbeat (`67a9bd2`).
**Takeaway**: measured 288-504 unique posts/run but seen-state diffing leaves only a handful unseen per run — bulk batches mean typically 1-2 LLM calls/run, not tens; the "tens worst-case" estimate holds.

### Precedent: Mechanical reformat
**Commit(s)**: `20478d1` — "chore: add biome and pre-commit hooks, reformat sources" (2026-10-25)
**Blast radius**: 22 files, formatting-only, touched all six target files; `3d4326b` added CI gates.
**Takeaway**: older docs' line references may drift; always run `npm run typecheck && npm run lint && npm test`.

### Composite Lessons
- Skip-and-retry-later is the safety contract: judge failures leave posts unseen and retry next run; state writes are match-gated and ordered after email (`1a9e353`, design D3). The bulk path must reproduce this per-item or risk silent post loss.
- The digest + state-commit paths have never fired in production — after removing the gate, explicitly verify a real match run end-to-end (the standing unchecked criterion in every validation doc).
- Verdict parsing must stay prose/fence-tolerant and gains id-alignment checks; per-item fallback to the single-post call is the proven mitigation for misalignment.
- Keyword list = precision lever: as prompt guidance it will behave differently than as a substring filter (model judgment, not matching); the hardcoded "frontend/fullstack web development" wording must go or it will fight the config list.
- "keyword maybe" copy is load-bearing in three code sites + README (`67a9bd2` needed follow-up commits purely for stale README claims) — update all in one change.
- Widening/tuning keywords empirically failed (`c64c427`/`18246dd`) — funnel problems were never fixable by list editing, which is why this change exists.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-10-25_21-20-20_model-judged-keywords.md` — the FRD this research grounds
- `.rpiv/artifacts/designs/2026-10-24_17-18-15_threads-hiring-alerts.md` — original design introducing the keyword filter + single-post judge (superseded decisions D3 relevant)
- `.rpiv/artifacts/plans/2026-10-25_10-48-08_threads-hiring-alerts.md` — original implementation plan for the keyword-filter pipeline
- `.rpiv/artifacts/validation/2026-10-25_12-11-38_threads-hiring-alerts.md` — first live judge validation (z.ai glm-5.3-flash)
- `.rpiv/artifacts/validation/2026-10-25_14-19-21_threads-hiring-alerts.md` — validation documenting maybes across stats/heartbeat/tests
- `.rpiv/artifacts/validation/2026-10-25_14-52-43_threads-hiring-alerts.md` — validation proving keywords = precision lever (0 → 8 maybes)

## Developer Context
**Q (discover: Keywords config role): `keywords` is a required, non-empty array in watcher.config.json (`src/config-file.ts:79`). Keep that unchanged — only its role changes from hard filter to judge guidance?**
A: Keep config — same validation, new role as judge-prompt guidance.

**Q (discover: Remove the hard gate): Remove the hard-gate call at `src/index.ts:94-102` so keyword matching no longer drops any post before the judge?**
A: Remove gate — all recency+seen survivors reach the judge.

**Q (discover: Delete the keywords module): After the gate goes, `src/keywords.ts` has zero callers. Delete the module, or keep it as dormant code?**
A: Delete module + move judge tests to `tests/judge.test.ts`.

**Q (discover: Prompt criterion): In the judge prompt (`src/judge.ts:93-113`), should the keyword list REPLACE the current hardcoded relevance criterion, or ADD to it?**
A: Replace — relevance = "related to any keyword in the list"; locationOk unchanged.

**Q (discover: Judge call shape): How should the judge call the LLM — keep one call per post, or go bulk?**
A: Bulk + fallback — ~10 posts per call, id-keyed verdicts, per-item validation, failed items retried as single-post calls.

**Q (discover: Batch size is a constant, not config): Where does the bulk size live?**
A: Module constant in `src/judge.ts` (~10); no new config key.

**Q (discover: Uncapped candidates per run): Without the gate, every surviving post costs judge calls. Accept uncapped candidates per run, or add a cap?**
A: No cap.

**Q (discover: Stats and heartbeat rework): What happens to the `maybes` counter and heartbeat copy?**
A: `maybes` becomes a judged-candidates count; "keyword maybe(s)" copy removed; `HeartbeatStats` field/init/renderer and heartbeat tests updated.

**Q (research checkpoint, `src/judge.ts:63-95`): What wire shape should the bulk verdict response use — id-keyed object or array of items carrying ids?**
A: Id-keyed object — `{"<post id>": {"relevant": ..., "locationOk": ...}}`; parser builds a `Map` via `Object.entries`; ids are never Number-coerced; duplicate keys collapse by JSON semantics.

**Q (research checkpoint, `src/index.ts:79,95`): What does the judged-candidates count (replacing `maybes`) mean numerically?**
A: Posts SENT to the judge (`newPosts.length`) — same meaning as the old `maybes`, consistent with the funnel's input-counting convention; judge outputs remain `relevantLocated` + `skipped`.

**Q (research checkpoint, `src/heartbeat.ts:47,128`): Do `Candidate.reason "maybe"` and the `[keyword match]` tag join the rename?**
A: Yes — `reason` becomes `"judged"`, tag becomes `"[judged]"`; post-gate the old labels are false statements; "near-miss" survives.

## Related Research
- None yet — first research artifact for this topic.

## Open Questions
None — FRD branches resolved during the interview; the three checkpoint decisions above are recorded in Developer Context.
