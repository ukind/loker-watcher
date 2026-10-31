---
date: 2026-10-31T09:44:40+0700
author: Yogiswara Utama
commit: b92fa9f
branch: main
repository: loker-watcher
topic: tech-debt-run2-remediation
tags: [plan, hooks, docs-guidance, dead-exports, artifact-lifecycle, remediation]
status: ready
parent: .rpiv/artifacts/solutions/2026-10-31_09-27-45_tech-debt-run2-remediation.md
phase_count: 4
phases:
  - { n: 1, title: Hook charset guard, files: [scripts/hooks/format-on-edit.js], depends_on: [] }
  - { n: 2, title: Hostile-path test pin, files: [tests/format-on-edit.test.ts], depends_on: [1] }
  - { n: 3, title: Docs truth pass, files: [.rpiv/guidance/scripts/architecture.md, .rpiv/guidance/src/architecture.md, .rpiv/guidance/architecture.md, README.md, src/judge.ts], depends_on: [] }
  - { n: 4, title: Unexports + supersede flip, files: [src/fetch-threads.ts, src/heartbeat.ts, src/judge-rotation.ts, src/state.ts, .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md], depends_on: [] }
unresolved_phase_count: 0
last_updated: 2026-10-31T11:52:22+0700
last_updated_by: Yogiswara Utama
last_updated_note: "revise: Phase 4 gate criterion 33→34 files (Phase 2 lands the 34th; 33 was the audit's pre-draft count) and a Windows-safe Desired End State smoke transcript (node harness, file created first per D4)"
---

# Tech-Debt Run #2 Remediation (N001-N004; N005 deferred) Implementation Plan

## Overview
One remediation round against audit run #2 (TECH_DEBT_AUDIT.md at b92fa9f), chained from the discover FRD through the research and solutions artifacts. Four vertical slices: a charset-allowlist guard on the format-on-edit hook's `shell: true` spawn plus its hostile-path stdin pin, a docs truth pass over five doc surfaces (AGENTS.md proved clean read-only) that describe a probe contract that does not ship, four dead exports unexported, and the superseded 2026-10-29 design artifact flipped with a pointer. N005 (the judge.ts dispatch split) is explicitly deferred by the audit.

## Requirements
From the FRD (`.rpiv/artifacts/discover/2026-10-31_07-47-21_tech-debt-run2-remediation.md`):
- **N002**: `scripts/hooks/format-on-edit.js` rejects any `tool_input.file_path` failing `^[A-Za-z0-9 _.()/\\:+-]+$` after the existing extension + existsSync gate, prints a one-line warn, exits 0 without spawning. `shell: true` stays (npx is npx.cmd on Windows).
- **N002 test**: `tests/format-on-edit.test.ts` pins a hostile path (exit 0, warn, spawns nothing) alongside the draft pins; offline, spawnSync stdin idiom.
- **N001**: `.rpiv/guidance/scripts/architecture.md` describes the real probe contract — per-account `ceiling=N` summary lines, every-account walk, exit 1 on failed/auth-dead (401/403)/broken-ramp legs, no floor at 4 — and the hook pattern fragment names the charset guard.
- **N001 rider**: README's probe wording says per-account ceilings, not "a recommended width".
- **N003**: guidance/src:10 names the probe's real imports; the WatcherDeps fence gains `sleepFn`; the root guidance commands table matches package.json (lint includes scripts/hooks; format is `biome format --write src tests`, not repo-wide); `src/judge.ts:190` says "above" not "below".
- **N004**: `chromiumContextFactory`, `MAX_CANDIDATES`, `ROTATION_EXHAUSTED`, `createInitialState` lose the `export` keyword.
- **Supersede**: the 2026-10-29 design artifact flips to `status: superseded` with a pointer to the run #2 FRD.
- Gates: `npm run typecheck && npm run lint && npm test` all exit 0.

## Current State Analysis
- `scripts/hooks/format-on-edit.js` (23 lines, always-exit-0): stdin parse fail-open (:8-13), extension+existsSync gate (:16, existsSync is cwd-relative), `spawnSync("npx", [...], { stdio: "ignore", shell: true })` (:18-21), spawn-fail warn (:22), unconditional exit 0 (:23). Registered PostToolUse "Edit|Write" in `.claude/settings.json:16-24`. Invisible to tsc (no allowJs) — biome lint plus the black-box suite are its only gates.
- `tests/format-on-edit.test.ts` exists as an **untracked draft** (`git status`: `??`) with 3 pre-guard pins (happy-path content mutation, fail-open "not json", silent existsSync miss); all pass; ~1.1s. The `tsx --test tests/*.test.ts` glob picks it up, so today's suite total is **198/198** (verified this session) — the solutions artifact's "195 growing to 198" estimate predates this counting; after Phase 2 the total is **199**.
- Probe truth (`scripts/probe-judge.ts`): `findConcurrencyCeiling` (:139-155) returns 0 on a failed leg, `level/2` on a partial level, bare `4` only after a fully clean 2→4 ramp — no `Math.max` floor anywhere. `classifyDead` (:164-177): failed leg, auth-dead 401/403, ceiling < 1. `main` walks EVERY account (:190), prints one per-account summary line with `ceiling=N` (:232-234), exits 1 naming dead accounts (:237-243).
- Four dead exports, zero importers repo-wide (grep-verified this session; sole outside reference is the JSDoc comment at `src/index.ts:105`): `src/fetch-threads.ts:125` (module-local default-param uses at :198 and :278 survive), `src/heartbeat.ts:21` (default-param use at :66 survives), `src/judge-rotation.ts:51` (`typeof` type-operand use at :55 survives unexport), `src/state.ts:38` (call at :155 survives).
- Stale docs surfaces: `.rpiv/guidance/scripts/architecture.md:12` ("imports src parsers"), :27 (phantom `Math.max(4, ceiling)` floor line), :32 (exit-1 row missing auth-dead), :46-47 (hook pattern without the guard), :58 ("only account 0 is measured"), :61 ("floored at 4"); `.rpiv/guidance/src/architecture.md:10` ("imports its parsers"), :44-52 (WatcherDeps fence missing `sleepFn`, live at `src/index.ts:116`); `.rpiv/guidance/architecture.md:29-30,33` (lint/format/probe rows); `README.md:66-70` ("prints a recommended width"); `src/judge.ts:190` ("parseLlmAccounts below" — `parseLlmAccounts` is at :132, above).
- `.rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md:9` still reads `status: ready`; its next pending Slice 11 (F020+F021) already landed on disk (`watch.yml:73`, `:113-123`, commit 510ff2a).

### Key Discoveries
- Guard placement is FRD-locked: AFTER the existsSync gate (`format-on-edit.js:16`). Consequence: a hostile path that does not exist exits silently at :16 — the FRD's acceptance echo bullet only holds with a file-exists precondition. The stdin pin therefore creates `bad&name.ts` in the temp dir (research-verified: the 3/3 draft pins pass with this shape today).
- The charset class excludes every cmd.exe active char (`& | < > ^ % ! " ' , ; =`); in-class space/parens are benign in a bare single command line (OWASP cheat sheet; SS64; DEP0190 docs — adversarially verified in research).
- In the JS regex literal, `:` must be unescaped (biome useless-escape rule) and an unescaped `/` inside a character class is legal.
- `parseLlmAccounts` sits at `src/judge.ts:132` — "above" is the correct direction for the :190 fix.
- Expected totals after this plan: suite 198 → 199; lint count 33 → 34 (the Phase 2 test file joins biome's path list; biome also counts the tests/fixture JSON).

## Desired End State
- A hostile path never reaches cmd.exe (Windows-safe harness: the file is created first — a nonexistent path exits silently at the existsSync gate, per D4; a bare POSIX $TMP path resolves to a nonexistent C:\tmp\... on Windows and passes vacuously):
  ```
  $ node -e "const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lw-'));const f=path.join(dir,'bad&name.ts');fs.writeFileSync(f,'const x=1');const r=cp.spawnSync(process.execPath,['scripts/hooks/format-on-edit.js'],{input:JSON.stringify({tool_input:{file_path:f}}),encoding:'utf8'});console.log('status='+r.status);console.log(r.stderr.trim());fs.rmSync(dir,{recursive:true,force:true});"
  status=0
  format-on-edit: skipped (path outside the allowlist): C:\Users\utama\AppData\Local\Temp\lw-XXXXXX\bad&name.ts
  ```
  (exit 0, one warn line, file unformatted, no spawn)
- `npx tsx --test tests/format-on-edit.test.ts` reports 4 passing pins; the full suite reports 199.
- The five edited doc surfaces describe the probe that ships (AGENTS.md verified clean by the same greps); every phantom grep returns zero hits.
- `grep -rnE "export (const|function|async function) (chromiumContextFactory|MAX_CANDIDATES|ROTATION_EXHAUSTED|createInitialState)" src/` returns nothing; typecheck stays green.
- The 10-29 design artifact reads `status: superseded` with a pointer to the run #2 FRD; nobody resumes its landed Slice 11.

## What We're NOT Doing
- **N005** (judge.ts dispatch split into judge-dispatch.ts) — deferred by audit decision; only "when judge.ts is next touched for real work".
- **No spawn-target change** — Option 2 (direct binary spawn, retiring DEP0190) is recorded as the follow-up for when the hook is next touched; the FRD's fix is the guard, shell:true stays.
- **No Biome JS API** — fails the fit filter (1.9.4 CLI vs 2.x WASM engine split; alpha; atomicity loss; new deps).
- **No knip config** — four keyword deletions beat new tooling.
- **No .rpiv/artifacts pruning policy** — audit open question 1 stays open.
- **No AGENTS.md edits** — swept clean by research (zero phantom fragments).
- **No judge/funnel/pipeline behavior change**; no new dependencies.

## Decisions

### D1: Charset allowlist guard, inserted after the extension+existsSync gate
The guard is a 3-statement block between `format-on-edit.js:16` and the :18 spawn: comment, `if (!/^[A-Za-z0-9 _.()/\\:+-]+$/.test(file))`, warn + exit 0. Placement is FRD functional requirement 1 verbatim ("checked after the existing extension + existsSync gate"); it preserves the file's gate→spawn shape and keeps "warn means biome never ran" true. Precedents: the same charset `.test()` shape at `src/extract.ts:126`; the warn+skip idiom at `format-on-edit.js:22`.

### D2: shell:true stays
`shell: true` is load-bearing on Windows (npx maps to npx.cmd; Node >= 22 refuses .cmd without a shell — CVE-2024-27980 hardening). The guard, not shell removal, is the fix. DEP0190 pressure is accepted and recorded as a follow-up (Option 2), not resolved here.

### D3: Warn wording follows the file's own idiom
One line on stderr, `format-on-edit: \` prefix, names the reason and the offending path — mirroring `:22` (`format-on-edit: could not run Biome: …`). Still exit 0; the hook can never veto an edit.

### D4: The hostile pin creates the file it feeds the hook
With the guard after the existsSync gate, a nonexistent path exits silently — a vacuous pin. The pin writes `bad&name.ts` into its mkdtemp dir and feeds the absolute path (allowlist-clean except `&`). This is also the red-to-green signal: the pin fails while the guard is absent, passes once it lands. FRD acceptance echo bullet inherits the same create-file precondition.

### D5: Unexport exactly the four keywords, change nothing else
Zero importers repo-wide (grep-verified; the sole outside reference is a JSDoc comment, `src/index.ts:105`, which stays accurate — the symbols keep existing module-locally). The `typeof ROTATION_EXHAUSTED` type-operand (`judge-rotation.ts:55`), the default-param uses (`heartbeat.ts:66`, `fetch-threads.ts:198,278`), and the internal call (`state.ts:155`) all survive unexport. JSDoc blocks stay.

### D6: Docs truth = probe-judge.ts as shipped
Every replacement wording is transcribed from `scripts/probe-judge.ts`: ramp semantics (:139-155), the three dead causes (:164-177), the every-account walk (:190), the per-account `ceiling=N` summary line (:232-234), exit 1 with named dead accounts (:237-243). No floor at 4 — `4` is only the fully-clean-ramp reading.

### D7: Rider A — guidance/scripts:12 imports fragment joins the pass
`:12` says "imports src parsers"; the FRD corrects the identical claim at guidance/src:10 (real imports: `buildBulkMessages`, `resolveJudgeConfig`). Same fragment class, same file already edited, one line.

### D8: Rider B — WatcherDeps fence gains the sleepFn row
`.rpiv/guidance/src/architecture.md` fence lists every WatcherDeps field but `sleepFn` (live at `src/index.ts:115-116`). The new row mirrors that JSDoc.

### D9: judge.ts:190 "below" → "above"
`parseLlmAccounts` is defined at `src/judge.ts:132`, above :190. Neighbors :65 and :265 stay (the :265 direction is correct — the pinned bulk prompt, six test sites).

### D10: Supersede = status flip + folded note + one-line banner
`status: ready` → `status: superseded` (:9); `last_updated`/`last_updated_by`/`last_updated_note` updated with the pointer to the run #2 FRD (:11-13); a one-line blockquote banner under the title (:16) per the research follow-up recommendation.

## Ordering Constraints
- Phase 2 depends on Phase 1: the hostile pin asserts the guard's warn + no-spawn behavior.
- Phases 3 and 4 depend on nothing and are independent of Phases 1-2 and each other — all four file sets are disjoint, so the phases are parallel-implement safe.
- Whole-repo read-only baseline gates ride the terminal phase (Phase 4 carries them); write-scoped fixers never run inside a phase; validate re-runs the full gate over the finished plan.

## Verification Notes
- Whole-plan gate (validate-owned): `npm run typecheck && npm run lint && npm test` all exit 0. Expected: lint 34 files (33 tracked floor + this plan's Phase 2 test file; biome also counts the tests/fixture JSON), suite **199/199** (198 today + 1 pin).
- Phantom-grep family across the doc surfaces after Phase 3 (five edited files; AGENTS.md grepped read-only) — all must return zero hits:
- Hostile-pin vacuous-pass risk (file absent → silent :16 exit) — mitigated by D4; research empirically verified the draft pins pass with file-creating pins.
- Regex-drift risk (charset edited to admit metachars later) — mitigated: the hostile pin (`&` in filename) fails the suite if `&` is ever admitted.
- Known false-rejection class (accepted trade-off, FRD-locked charset): a legitimate path whose absolute form carries a char outside the allowlist (non-ASCII Windows username, `'`/`=` in a redirected TMP) is warn-and-skip, not formatted — the hook stays best-effort. The happy-path pin requires an allowlist-clean OS temp dir; on an exotic-TMP machine it reds legitimately.
- The hook's only static gate is biome (`scripts/hooks` is inside `npm run lint`'s path list; tsc has no allowJs) — Phase 1's automated check is scoped biome, Phase 2's is the black-box suite.
- FRD acceptance echo precondition: the manual echo command only warns when the fed path EXISTS — create the file first (see D4).
- Post-edit export grep: `grep -rnE "export (const|function|async function) (chromiumContextFactory|MAX_CANDIDATES|ROTATION_EXHAUSTED|createInitialState)" src/` returns nothing.

## Performance Considerations
One regex `.test()` per edit event — negligible against the existing spawn cost. The hook suite grows by one spawnSync case (~0.3s); the full suite stays seconds. No runtime (watcher pipeline) path is touched.

## Migration Notes
Not applicable — no schema, no persisted data, no config keys. Rollback: revert the commit.

## Pattern References
- `src/extract.ts:126` — charset `.test()` allowlist shape to mirror.
- `scripts/hooks/format-on-edit.js:22` — the warn+skip idiom and message prefix.
- `tests/gate-destructive.test.ts:8-13,44-52` — spawnSync stdin black-box test idiom (`process.execPath`, shebang inert on Windows).
- `tests/state.test.ts:22-27` + the draft suite itself — mkdtemp + single cleanup pattern.
- `scripts/probe-judge.ts:139-155,164-177,190,232-235,237-243` — the doc-pass source of truth.

## Developer Context
- **Step 4 checkpoint (2026-10-31)**: design summary presented with two riders (A: guidance/scripts:12 fragment; B: sleepFn fence row). Developer chose **Proceed** — decisions and riders ratified as stated. Zero genuine ambiguities remained: fix set (N001-N004, N005 deferred), guard shape (charset allowlist, shell:true stays), warn+skip, unexport shape, and supersede handling were all locked by the discover FRD; the phantom-family scope, three-cause exit row, and pointer placement were locked by research.
- **Correction recorded**: the solutions artifact's test-total estimate ("195 growing to 198") predates the untracked draft: verified this session, the suite reports 198/198 today (glob includes the untracked draft) and 199 after Phase 2.
- **FRD acceptance-bullet inconsistency recorded**: acceptance bullet 1's echo (nonexistent `x&calc.ts`) can never warn with the FRD-locked guard placement; functional requirement 1 wins, the bullet gains the file-exists precondition (D4).
- Slice checkpoints: recorded per-phase in Plan History as they are approved.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 1 §1 (format-on-edit.js) | tests/format-on-edit.test.ts:21 | concern | code-quality | The FRD-locked allowlist also rejects *legitimate* paths: the kept happy-path pin formats a file under `tmpdir()`, so on any machine whose temp path carries an out-of-class char (non-ASCII Windows username, `~` in an 8.3 profile short name, `'`/`=` in a redirected TMP) the guard fires on a real file, biome never runs, and the pre-existing pin flips red — contradicting the plan's unconditional "suite reports 199" and the "normal … edit still triggers Biome formatting" gate, which the artifact records no limitation for | Add a Verification Notes line recording the known false-rejection class (legit out-of-class paths warn-and-skip; the happy-path pin requires an allowlist-clean temp dir) — the charset itself stays FRD-locked | applied: Verification Notes gains the known false-rejection class; charset stays FRD-locked |
| coverage | ## Verification Notes §1 | <n/a> | concern | verification-coverage | Note "Whole-plan gate (validate-owned): `npm run typecheck && npm run lint && npm test` all exit 0. Expected: lint floor 33 files, suite 199/199" — criteria: NOT FOUND (no phase bullet runs the full gate; typecheck/lint/test exist only as scoped bullets, and the concrete expectations "lint floor 33 files" and "suite 199/199" are asserted nowhere — Phase 2 asserts only "4 passing" within its own file, so suite-total drift or a lint path-list regression passes every phase), code: NOT FOUND | Add a whole-plan gate bullet under Phase 4's `#### Automated Verification:` — `npm run typecheck && npm run lint && npm test` exits 0 with lint reporting 33 files and the suite reporting 199 passing | applied: terminal-phase baseline gate bullet added to Phase 4 AV (read-only); Ordering Constraints corrected — the write-scope rule bars write-scoped fixers from phases, not read-only baseline checks |
| code     | Phase 2 §2 (format-on-edit.test.ts) | tests/format-on-edit.test.ts:20 | suggestion | actionability | Region B1 cites the describe title "at :21" but HEAD has it at :20 (:21 is the happy-path `it(`), and the cite only becomes :21 after Region A's 5→6-line header swap — while Region C's ":39-43" uses pre-edit HEAD numbering, so the two cites mix post- and pre-edit frames | State both cites in the pre-edit frame (:20 and :39-43) or mark B1's ":21" as post-Region-A numbering | applied: heading + Region B1 cite moved to the pre-edit frame (:20) |
| code     | Plan §Desired End State (smoke transcript) | <n/a> | suggestion | code-quality | The end-state echo pipes `{"tool_input{"file_path":""$TMP/bad&name.ts"}}}` — malformed JSON (stray `{` after `tool_input`, doubled quotes) — which hits the parse fail-open and exits 0 with *no output*, contradicting the transcript's own shown `skipped (path outside the allowlist)` warn line | Fix the transcript's JSON to `{"tool_input":{"file_path":"$TMP/bad&name.ts"}}` | applied: transcript JSON fixed |
| code     | Plan (Overview / Desired End State) | <n/a> | suggestion | code-quality | Plan-level prose says "six surfaces" twice ("a docs truth pass over six surfaces", "The six doc surfaces describe the probe that ships") but Phase 3's Overview says "Five surfaces" and both the phase body and frontmatter `phases[2].files` enumerate exactly five files | Align the plan-level count to five or name the sixth surface | applied: count aligned — five files edited, AGENTS.md verified clean read-only (Overview, Desired End State, Verification Notes) |

_Step 8 tallies: 0 blockers, 2 concerns, 3 suggestions._

## Plan History
- Phase 1: Hook charset guard — approved as generated
- Phase 2: Hostile-path test pin — approved as generated; revised at Step 9 (heading cite to pre-edit frame)
- Phase 3: Docs truth pass — approved as generated
- Phase 4: Unexports + supersede flip — approved as generated; revised at Step 9 (terminal-phase baseline gate bullet)

## References
- `.rpiv/artifacts/solutions/2026-10-31_09-27-45_tech-debt-run2-remediation.md` — parent solution analysis (verdict: pass)
- `.rpiv/artifacts/research/2026-10-31_08-04-57_tech-debt-run2-remediation.md` — grounding research (all file:line citations)
- `.rpiv/artifacts/discover/2026-10-31_07-47-21_tech-debt-run2-remediation.md` — FRD (requirements, acceptance greps, locked decisions)
- `TECH_DEBT_AUDIT.md` — audit run #2 input
- OWASP OS Command Injection Defense Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html
- Node DEP0190 — https://nodejs.org/api/deprecations.html#dep0190-passing-args-to-nodechild_process-execfile--spawn-with-shell-option
- SS64 cmd escaping — https://ss64.com/nt/syntax-esc.html

## Phase 1: Hook charset guard
### Overview
Insert the charset-allowlist rejection between the extension+existsSync gate (`format-on-edit.js:16`) and the spawn (:18): comment, one `if`, warn + exit 0. The spawn block stays byte-identical. Foundation for Phase 2's pin; independent of Phases 3-4.
### Changes Required:

#### 1. scripts/hooks/format-on-edit.js:16-18
**File**: scripts/hooks/format-on-edit.js
**Changes**: MODIFY — insert the guard block after the gate line; nothing else moves.

```js
// The spawn runs with shell:true (npx is npx.cmd on Windows), so cmd.exe
// tokenizes `file`. Reject any path carrying a character outside this
// allowlist — the class excludes every cmd.exe metacharacter.
if (!/^[A-Za-z0-9 _.()/\\:+-]+$/.test(file)) {
  console.error(`format-on-edit: skipped (path outside the allowlist): ${file}`);
  process.exit(0);
}
```

(Insertion point: immediately after the existing line
`if (!/\.(ts|tsx|js|mjs|cjs|json)$/.test(file) || !existsSync(file)) process.exit(0);`
and before the existing `const result = spawnSync("npx", [...]` block, which stays byte-identical.)

### Success Criteria:

#### Automated Verification:
- [x] `npx biome check scripts/hooks/format-on-edit.js` exits 0 (formatter + lint clean; biome lineWidth 100)
- [x] `echo 'not json' | node scripts/hooks/format-on-edit.js` exits 0 silently (parse fail-open path unchanged)
- [x] Hostile-path smoke (file created first): piping `{"tool_input":{"file_path":"<abs path containing &>"}}` into the hook exits 0 and stderr matches `/skipped \(path outside the allowlist\)/`

#### Manual Verification:
- [x] A normal repo .ts edit still triggers Biome formatting with no warn — allowlist-clean absolute paths pass the guard

## Phase 2: Hostile-path test pin
### Overview
Extend the untracked draft suite with the hostile pin (file created, exit 0, warn matched, content unmutated) and flip the stale pre-guard wording (header comment + describe title). Depends on Phase 1; independent of Phases 3-4.
### Changes Required:

#### 2. tests/format-on-edit.test.ts:9-13,20,39-43
**File**: tests/format-on-edit.test.ts
**Changes**: MODIFY — rewrite the header comment and describe title (draft wording out), add the hostile pin inside the existing describe.

```ts
// Region A — flip the header comment (replaces the "Draft pins … pre-N002-guard" block at :9-13):
// Black-box pins for the format-on-edit hook (registered PostToolUse
// "Edit|Write" in .claude/settings.json). Gate order: JSON parse (fail-open)
// → extension + existsSync → charset allowlist → spawn. The hook sets
// stdio:"ignore" and ignores biome's exit status (it checks only
// result.error), so file-content mutation is the only honest observable for
// the format path; the hostile pin asserts the warn + no-mutation instead.

// Region B1 — flip the describe title at :20 (HEAD numbering):
describe("format-on-edit hook", () => {

// Region B2 — insert the hostile pin after the happy-path test:
  it("rejects a hostile path: exits 0, warns, never formats", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lw-format-on-edit-"));
    try {
      // The file must exist: the existsSync gate exits silently otherwise,
      // and this pin would pass vacuously.
      const target = join(dir, "bad&name.ts");
      await writeFile(target, "const x=1", "utf8");
      const run = runHook(JSON.stringify({ tool_input: { file_path: target } }));
      assert.equal(run.status, 0);
      assert.match(run.stderr, /skipped \(path outside the allowlist\)/);
      assert.equal(await readFile(target, "utf8"), "const x=1"); // biome never ran
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

// Region C — add a gate-order comment inside the existsSync-miss pin at :39-43
// (the pin's title and assertions stay unchanged):
  it("exits silently when the file does not exist (existsSync gate)", () => {
    // A hostile NONEXISTENT path: the existsSync gate fires before the
    // charset allowlist, so the miss stays silent (exit 0, empty stderr).
```

(The runHook helper, the happy-path pin, and the fail-open pin stay byte-identical. runHook:
`spawnSync(process.execPath, [HOOK], { input, encoding: "utf8" })` with
`HOOK = fileURLToPath(new URL("../scripts/hooks/format-on-edit.js", import.meta.url))`.)

### Success Criteria:

#### Automated Verification:
- [x] `npx biome check tests/format-on-edit.test.ts` exits 0
- [x] `npx tsx --test tests/format-on-edit.test.ts` exits 0 — 4 passing (3 draft pins + the hostile pin)
- [x] `npx tsc --noEmit` exits 0 (read-only, repo-wide)

#### Manual Verification:
- [x] Hostile-path warn copy reads exactly `format-on-edit: skipped (path outside the allowlist): <path>` in a terminal run

## Phase 3: Docs truth pass
### Overview
Five surfaces describe the probe and tooling that actually ship: guidance/scripts (probe contract + hook pattern + imports fragment), guidance/src (consumer line + sleepFn fence row), the root guidance commands table (lint/format/probe rows from package.json truth), README (per-account ceilings), and the judge.ts:190 direction word. Independent of Phases 1-2 and 4.
### Changes Required:

#### 3. .rpiv/guidance/scripts/architecture.md:12,27,32,46-47,58,61
**File**: .rpiv/guidance/scripts/architecture.md
**Changes**: MODIFY — real probe contract (imports fragment, ramp tail, three-cause exit row, every-account runbook, no-floor reading) and the charset guard folded into the hook-pattern fence.

```md
Edit 1 — :12 (structure fence):
- old: probe-judge.ts               # .ts, top-level await; imports src parsers; INSIDE typecheck + lint + lint-staged
+ new: probe-judge.ts               # .ts, top-level await; imports buildBulkMessages + resolveJudgeConfig; INSIDE typecheck + lint + lint-staged

Edit 2 — :27 (inside the ramp fence):
- old: console.log(`probe: recommended JUDGE_CONCURRENCY = ${Math.max(4, ceiling)}`);  // floored — rotation protects a stale 4
+ new: return 4;                                   // only a fully clean 2→4 ramp reads 4 — no floor, no Math.max

Edit 3 — :32 (exit-code fence):
- old: probe-judge.ts              exit 1 on any failed leg or ceiling < 1 — the probe job is a gate, so this reddens the dispatch run
+ new: probe-judge.ts              exit 1 on any failed leg, auth-dead 401/403, or ceiling < 1 — the probe job is a gate, so this reddens the dispatch run

Edit 4 — :46-47 (hooks fence):
- old: // format-on-edit.js (PostToolUse, "Edit|Write"): extension + existsSync gate, then
- old: // spawnSync("npx", ["biome", "format", "--write", file], { stdio: "ignore", shell: true }) → always exit 0.
+ new: // format-on-edit.js (PostToolUse, "Edit|Write"): extension + existsSync gate, then a
+ new: // charset-allowlist gate (^[A-Za-z0-9 _.()/\\:+-]+$ — hostile path → one-line warn, exit 0, no spawn), then
+ new: // spawnSync("npx", ["biome", "format", "--write", file], { stdio: "ignore", shell: true }) → always exit 0.

Edit 5 — :58 (probe runbook step 1):
- old: 1. Env: `LLM_ACCOUNTS` = JSON array of `{baseUrl, apiKey, model}` (only account 0 is measured)
+ new: 1. Env: `LLM_ACCOUNTS` = JSON array of `{baseUrl, apiKey, model}` (every account is walked; each must pass)

Edit 6 — :61 (probe runbook step 4):
- old: 4. Read the line `probe: recommended JUDGE_CONCURRENCY = N` — floored at 4; any failed leg exits 1
+ new: 4. Read each account's summary line `probe: account N (<baseUrl>) — minimal=… bulk=… bulkAgain=… ceiling=N` — no floor; a failed, auth-dead (401/403), or broken-ramp account exits 1
```

#### 4. .rpiv/guidance/src/architecture.md:10,51-52
**File**: .rpiv/guidance/src/architecture.md
**Changes**: MODIFY — consumer line names the real imports; WatcherDeps fence gains the sleepFn row mirroring index.ts:115-116.

```md
Edit 1 — :10 (Consumers bullet, tail only):
- old: …tests/ drive the seams offline; scripts/probe-judge.ts imports its parsers
+ new: …tests/ drive the seams offline; scripts/probe-judge.ts imports buildBulkMessages and resolveJudgeConfig

Edit 2 — WatcherDeps fence: insert one row between the `now` row and the closing brace:
-   readonly now?: () => number;                         // default Date.now
+   readonly now?: () => number;                         // default Date.now
+   readonly sleepFn?: (ms: number) => Promise<void>;   // park wait for cooldown parking; default: the judge module's sleep
  }
```

#### 5. .rpiv/guidance/architecture.md:29-30,33
**File**: .rpiv/guidance/architecture.md
**Changes**: MODIFY — commands table rows corrected to package.json truth (lint path, format scope) and the per-account probe wording.

```md
Edit 1 — :29 lint row:
- old: | `npm run lint` | Biome check over src, tests, and scripts/probe-judge.ts |
+ new: | `npm run lint` | Biome check over src, tests, scripts/probe-judge.ts, and scripts/hooks |

Edit 2 — :30 format row:
- old: | `npm run format` | Biome format in place, repo-wide |
+ new: | `npm run format` | `biome format --write src tests` in place (src and tests only — not repo-wide) |

Edit 3 — :33 probe row:
- old: | `npx tsx scripts/probe-judge.ts` | measure the LLM endpoint; prints the recommended JUDGE_CONCURRENCY (needs LLM_ACCOUNTS) |
+ new: | `npx tsx scripts/probe-judge.ts` | gate every LLM_ACCOUNTS entry: latency, bulk shape, per-account `ceiling=N`; exit 1 on a dead account (needs LLM_ACCOUNTS) |
```

#### 6. README.md:66-70
**File**: README.md
**Changes**: MODIFY — "prints a recommended width" becomes per-account `ceiling=N` wording with the dead-account exit.

```md
Edit — :69 (one line becomes three; lines 66-68 and 70-75 untouched, ~72-col wrap kept):
- old:    concurrent calls against the endpoint and prints a recommended width.
+ new:    concurrent calls against the endpoint and prints a per-account
+ new:    `ceiling=N` summary line; a dead account (failed leg, HTTP 401/403, or a
+ new:    broken ramp) fails the probe job.
```

#### 7. src/judge.ts:190
**File**: src/judge.ts
**Changes**: MODIFY — "parseLlmAccounts below" → "parseLlmAccounts above" (defined at :132).

```md
Edit — :190 (comment word only; neighbors :65 and :265 stay untouched):
- old:  * (fail-visible - same rule as parseLlmAccounts below).
+ new:  * (fail-visible - same rule as parseLlmAccounts above).
```

### Success Criteria:

#### Automated Verification:
- [x] `! grep -rn "recommended JUDGE_CONCURRENCY" src tests scripts .rpiv/guidance README.md AGENTS.md` exits 0 (zero hits)
- [x] `! grep -rn "only account 0" .rpiv/guidance README.md AGENTS.md` exits 0
- [x] `! grep -rn "recommended width" README.md AGENTS.md .rpiv/guidance` exits 0
- [x] `! grep -n "parseLlmAccounts below" src/judge.ts` exits 0
- [x] `! grep -n "floored" .rpiv/guidance/scripts/architecture.md` exits 0
- [x] `grep -c "ceiling=N" .rpiv/guidance/scripts/architecture.md` returns >= 1
- [x] `grep -c "sleepFn" .rpiv/guidance/src/architecture.md` returns >= 1
- [x] `npx biome check src/judge.ts` exits 0

#### Manual Verification:
- [x] The probe runbook block in guidance/scripts reads end-to-end against a real dispatch probe run's log lines (operator-facing copy matches output exactly)

## Phase 4: Unexports + supersede flip
### Overview
Drop the `export` keyword on the four dead symbols (verified zero importers; module-local uses survive), and flip the 2026-10-29 design artifact to superseded with a pointer to the run #2 FRD. Independent of Phases 1-3.
### Changes Required:

#### 8. src/fetch-threads.ts:125
**File**: src/fetch-threads.ts
**Changes**: MODIFY — `export const chromiumContextFactory` → `const chromiumContextFactory`.

```diff
-export const chromiumContextFactory: ContextFactory = async (
+const chromiumContextFactory: ContextFactory = async (
```

#### 9. src/heartbeat.ts:21
**File**: src/heartbeat.ts
**Changes**: MODIFY — `export const MAX_CANDIDATES` → `const MAX_CANDIDATES`.

```diff
-export const MAX_CANDIDATES = 10;
+const MAX_CANDIDATES = 10;
```

#### 10. src/judge-rotation.ts:51
**File**: src/judge-rotation.ts
**Changes**: MODIFY — `export const ROTATION_EXHAUSTED` → `const ROTATION_EXHAUSTED` (the `typeof` operand at :55 survives).

```diff
-export const ROTATION_EXHAUSTED = "RotationExhaustedError";
+const ROTATION_EXHAUSTED = "RotationExhaustedError";
```

#### 11. src/state.ts:38
**File**: src/state.ts
**Changes**: MODIFY — `export function createInitialState` → `function createInitialState`.

```diff
-export function createInitialState(): AppState {
+function createInitialState(): AppState {
```

#### 12. .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md:9-16
**File**: .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md
**Changes**: MODIFY — status flip, pointer folded into last_updated_note, one-line banner under the title.

```md
Edit 1 — :9:
- old: status: ready
+ new: status: superseded

Edit 2 — :11:
- old: last_updated: 2026-10-30T13:37:51+0700
+ new: last_updated: 2026-10-31T09:44:40+0700
(:12 last_updated_by stays — same author as this round.)

Edit 3 — :13 (whole line replaced):
- old: last_updated_note: "Slice 15 (F016) locked — manifest merged fence (F017 + lint path gains scripts/hooks as a directory), format-on-edit import-order fix (the one live biome violation), gate-destructive zero-edit evidence entry, new 6-case black-box stdin test, AGENTS.md + guidance/scripts staleness flips; slice-verifier 1 VIOLATION (unsatisfiable F017 grep backslash form) fixed per citation; hunk-faithful mechanical gate green (anchors unique, biome clean, tsc clean, 6/6 + 176/176)"
+ new: last_updated_note: "Superseded by the run #2 remediation FRD (.rpiv/artifacts/discover/2026-10-31_07-47-21_tech-debt-run2-remediation.md): its Slice 11 (F020+F021) already landed on disk (watch.yml:73, :113-123, commit 510ff2a); do not resume this artifact."

Edit 4 — :16 (banner inserted directly after the title line, blank line between):
  # Design: Tech-Debt Audit Remediation (24 findings, F001-F024)
+
+ > **SUPERSEDED 2026-10-31:** by the run #2 remediation FRD — .rpiv/artifacts/discover/2026-10-31_07-47-21_tech-debt-run2-remediation.md. All landed slices are on disk; do not resume.
```

### Success Criteria:

#### Automated Verification:
- [x] `! grep -rnE "export (const|function|async function) (chromiumContextFactory|MAX_CANDIDATES|ROTATION_EXHAUSTED|createInitialState)" src/` exits 0 (zero hits)
- [x] `npm run typecheck` exits 0 (read-only, repo-wide)
- [x] `npx tsx --test tests/fetch-threads.test.ts tests/heartbeat.test.ts tests/judge-rotation.test.ts tests/state.test.ts` exits 0 (scoped to the four touched modules) — 75/75 pass
- [x] `grep -c "^status: superseded" .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md` returns 1
- [x] `grep -c "discover/2026-10-31_07-47-21_tech-debt-run2-remediation" .rpiv/artifacts/designs/2026-10-29_13-19-57_tech-debt-audit-remediation.md` returns >= 2 (note + banner) — actual 2
- [x] `npm run typecheck && npm run lint && npm test` all exit 0 — lint reports 34 files, the suite reports 199 passing (whole-plan baseline gate; terminal phase, read-only) — verified: typecheck 0, lint 0 @ 34 files, suite 199/199

#### Manual Verification:
- [x] The banner reads as a one-line blockquote directly under the design title — the artifact is unmistakably not resumable (banner at design :18)

## Follow-ups

### 2026-10-31T11:52:22+0700 — revise: gate-count correction + Windows-safe smoke transcript
- Phase 4 baseline-gate criterion: "lint reports 33 files" → "lint reports 34 files". The 33 was inherited from the run #2 audit's pre-draft tree (32 JS/TS + 1 JSON fixture counted by biome); this plan's Phase 2 lands the 34th file (tests/format-on-edit.test.ts), so the suite total (199) and the lint count (34) now agree. Developer-confirmed mid-implement; the box was checked on an annotated deviation and is now checked on the corrected criterion.
- Desired End State smoke transcript: replaced the POSIX $TMP/bad&name.ts echo-pipe — vacuous on Windows (the POSIX path resolves to a nonexistent C:\tmp\..., so the existsSync gate exits before the guard; empirically caught mid-implement) — with the node harness verified this session (creates the file under the real OS temp dir first, per D4). Consistency pass: the same 33→34 correction applied to Verification Notes and Key Discoveries.
- Worktree note (outside this plan's write-set, disclosed for validate): TECH_DEBT_AUDIT.md moved onto its tracked living-document path .rpiv/artifacts/TECH_DEBT_AUDIT.md — run #2 content replaces run #1 (preserved in git history); collapsed the pre-existing tracked-deletion + untracked-copy pair into one modification. Developer-approved.
