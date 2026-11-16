---
date: 2026-11-16T09:38:05+0700
author: Yogiswara Utama
commit: be5407a
branch: ukind/feature-auto-login-threads
repository: feature-auto-login-threads
topic: "Tech-debt ledger zero — landing (run #7)"
tags: [plan, tech-debt, capture-sink, facades, ci, judge, linkedin-leg, tooling-majors]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-15_10-59-08_tech-debt-ledger-zero-landing.md"
phase_count: 4
phases:
  - { n: 1, title: "capture sinks + shared oracle", files: [src/linkedin-capture.ts, tests/capture-oracle.ts, tests/fetch-linkedin.test.ts, tests/probe-linkedin.test.ts, tests/linkedin-fetch.test.ts, scripts/fetch-linkedin.ts, scripts/probe-linkedin.ts, scripts/watch-linkedin.ts, scripts/linkedin-chain.ts, TECH_DEBT_AUDIT.md], depends_on: [] }
  - { n: 2, title: "smalls + probe fix + facades", files: [src/judge.ts, src/linkedin-fetch.ts, src/judge-rotation.ts, tests/judge-health.test.ts, scripts/probe-judge.ts, tests/probe-judge.test.ts, src/judge-dispatch.ts, tests/judge.test.ts, tests/judge-rotation.test.ts, tests/watch-linkedin.test.ts, scripts/fetch-linkedin.ts, scripts/probe-linkedin.ts, scripts/watch-linkedin.ts, tests/fetch-linkedin.test.ts, tests/probe-linkedin.test.ts, tests/linkedin-fetch.test.ts, README.md, TECH_DEBT_AUDIT.md], depends_on: [1] }
  - { n: 3, title: "CI additions", files: [package.json, .madgerc, .github/workflows/ci.yml, .github/workflows/watch.yml, TECH_DEBT_AUDIT.md], depends_on: [2] }
  - { n: 4, title: "majors last + ledger zero", files: [package.json, biome.json, TECH_DEBT_AUDIT.md], depends_on: [3] }
last_updated: 2026-11-16T09:38:05+0700
last_updated_by: Yogiswara Utama
---

# Tech-debt ledger zero — landing (run #7) Implementation Plan

## Overview

Land all 15 actionable findings of `TECH_DEBT_AUDIT.md` as four gated commits on this branch (single phased PR — the repo's only merged landing shape). Decomposed 1:1 from the design artifact's `## Slices` section: phase boundaries, file lists, and success criteria are inherited, not re-authored. Slice 1 closes the capture-sink leak through a shared oracle helper and deletes `captures/`; Slice 2 removes both run-#7 facades atomically with the 10-site re-point, transplants the envelope gate into the probe, and lands the smalls; Slice 3 adds the madge + audit CI gates and the format/env hygiene; Slice 4 bumps the dev-tool majors last, policed by the frozen gates, and zeroes the ledger.

Design: `.rpiv/artifacts/designs/2026-11-15_10-59-08_tech-debt-ledger-zero-landing.md` (status ready; every Developer Context question answered; decisions D1-D12 settled there — this plan does not re-evaluate them).

## Desired End State

```bash
# Slice 1 landed: the leak is closed and the oracle is armed
npm test   # green on a clean checkout, twice in a row, no captures/ regrowth
ls captures 2>/dev/null || echo "absent — the oracle holds"

# Slice 2 landed: the facades are gone, the probe parses the envelope
grep -rn "run #7" src/   # empty
npm test tests/probe-judge.test.ts   # replay: a 2xx error envelope fails the leg

# Slice 3 landed: the graph is frozen and the audit rides CI
npm run cycles   # exit 0 on the type-only graph

# Slice 4 landed: majors verified, ledger zero
grep -c "RESOLVED\|DEFERRED\|AS-IS\|OPERATOR" TECH_DEBT_AUDIT.md   # 16 findings marked
```

## What We're NOT Doing

- Multi-PR / stacked-PR landing (rejected: 0-of-5 precedent; two broken interlocks).
- F002 (deferred by developer — the alarm keeps citing the missing DOCUMENTATION.md sections).
- F016 (leave as-is, recorded).
- Re-opening any of the ~19 locked per-finding decisions.
- Per-account freshness windows; moving seen-state out of git (N043 policy stands).
- Any behavior change beyond F005's leg classification.

---

## Phase 1: capture sinks + shared oracle

### Overview

Closes the capture leak (F001) and arms the shared absence-oracle (F015). `NOOP_CAPTURE_SINK` is exported from `src/linkedin-capture.ts`; all SIX production seams pass `makeFsCaptureSink()` explicitly (the two `??` defaults become conditional spreads; watch-linkedin, linkedin-chain, and both CLI entries gain the explicit sink); 18 walk-driving test blocks inject the no-op (13 `fetchTick` + 5 `runProbe`); the three hand-rolled oracles re-point to `tests/capture-oracle.ts`; the operator deletes `captures/` (gitignored scratch, never a commit). This phase is the foundation: every later phase's `npm test` depends on the armed oracle.

### Changes Required:

#### 1. The no-op sink export
**File**: `src/linkedin-capture.ts`
**Changes**: Insert directly after the `CaptureSink` type:

```ts
/**
 * The no-op sink (F001, 2026-11-15): the offline suites inject this into
 * every walk-driving deps literal so the defaulting seam can never
 * re-create the production fs sink. A body fired with this sink writes
 * nothing, so `npm test` never touches the repo. Production callers
 * construct makeFsCaptureSink() explicitly at the script-entry seams —
 * the defaulting seam lives at script entries, never inside the tick or
 * the probe (the harness guarantee 14ccec5 broke at exactly this seam).
 */
export const NOOP_CAPTURE_SINK: CaptureSink = async () => undefined;
```

#### 2. The shared absence-oracle (NEW)
**File**: `tests/capture-oracle.ts`
**Changes**: Create the file — one snapshot + one assert for the three walk-driving suites:

```ts
/**
 * The capture doctrine's shared absence-oracle (F015, 2026-11-15): one
 * snapshot + one assert for the three walk-driving suites. The snapshot
 * is taken at module load, before any test runs; each suite calls
 * assertNoFreshCaptures() from its after(). A FRESH captures/ directory
 * at the repo root means a body-firing case skipped its sink injection —
 * the failure names every leaked session dir and its files, so the
 * leaking case is identifiable from the message alone. A directory that
 * already existed (a live operator run) is not the suites' problem: the
 * assert stays silent.
 *
 * Replaces the three hand-rolled copies whose ENOENT assert skipped
 * forever once captures/ existed — the disarm that hid F001's leak.
 */
import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoCaptures = join(dirname(fileURLToPath(import.meta.url)), "..", "captures");
const repoCapturesBefore = await access(repoCaptures).then(
  () => true,
  () => false,
);

/**
 * Fail the suite when a FRESH repo-root captures/ tree appeared. Silent
 * when captures/ pre-dated the run (the operator-run carve-out, verbatim
 * from the three oracles this helper replaces).
 */
export async function assertNoFreshCaptures(): Promise<void> {
  if (repoCapturesBefore) return;
  const fresh = await access(repoCaptures).then(
    () => true,
    () => false,
  );
  if (!fresh) return;
  const sessions = await readdir(repoCaptures);
  const report: string[] = [];
  for (const session of sessions) {
    const files = await readdir(join(repoCaptures, session));
    report.push(`captures/${session}/ (${files.length} file(s): ${files.join(", ")})`);
  }
  assert.fail(
    `capture oracle: npm test wrote into the repo — a fresh captures/ appeared with ${report.length} session dir(s):\n  ${report.join("\n  ")}`,
  );
}
```

#### 3. The fetch suite — capture doctrine (F001/F015)
**File**: `tests/fetch-linkedin.test.ts`
**Changes**: The design merges this file's Slice 1 + Slice 2 hunks into ONE fence (the F006 facade swap must never be appended alongside the capture hunks). **Phase 1 applies ONLY the capture hunks below; the `:35` facade swap inside Hunk A is Phase 2 scope — skip it here.**

```ts
Hunk A — imports:

WAS:
import type { CaptureRecord, CaptureSink } from "../src/linkedin-capture.js";
NOW (AMENDED form — wraps at lineWidth 100):
import {
  type CaptureRecord,
  type CaptureSink,
  NOOP_CAPTURE_SINK,
} from "../src/linkedin-capture.js";

DELETE the whole line (sole use removed in Hunk B): import { fileURLToPath } from "node:url";
(access, readdir, dirname, and join all keep non-oracle uses below — the
fs and path imports stay.)

[PHASE 2 SCOPE — SKIP IN PHASE 1] WAS (:35):
import { type LinkedInContextFactory, SCROLL_JS, isLegDead } from "../src/linkedin-fetch.js";
NOW (F006: the context pair at the :35 slot; SCROLL_JS after
linkedin-session.js :37 — byte order session < walk-static < state):
import { type LinkedInContextFactory, isLegDead } from "../src/linkedin-context.js";
...
import { SCROLL_JS } from "../src/linkedin-walk-static.js";

ADD after the last ../src import:
import { assertNoFreshCaptures } from "./capture-oracle.js";

Hunk B — DELETE lines :61-67 (the local snapshot block):

# The capture doctrine's absence-oracle snapshot (design 2026-11-13):
# taken at module load, before any test runs.
const repoCaptures = join(dirname(fileURLToPath(import.meta.url)), "..", "captures");
const repoCapturesBefore = await access(repoCaptures).then(
  () => true,
  () => false,
);

Hunk C — after() (:69-78), replace the oracle arm:

after(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  // The capture doctrine's absence oracle (F015, shared helper): fails
  // naming the leaked session dirs when a body-firing case above skipped
  // its sink injection; silent when captures/ pre-dated the run.
  await assertNoFreshCaptures();
});

Hunk D — 13 injections: insert `captureSink: NOOP_CAPTURE_SINK,` as the FIRST
property line after each `fetchTick({` at: 469, 503, 613, 630, 665, 699, 816,
835, 856, 908, 935, 971, 1036. The five sites at :422/:546/:577/:601/:886 keep
recordingSink(). Verbatim example — the leak itself (:1036, the seen-stop seed case):

    const result = await fetchTick({
      captureSink: NOOP_CAPTURE_SINK,
      latchPath: await workPath("latch-seen-stop.flag"),
      bypassWindow: true,
      config: CONFIG,
      cookies: COOKIES,
      contextFactory,
      payloadPath: payload,
      git,
      env: {},
      seenPath,
      markerPath: await workPath("marker-seen-stop.flag"),
      now: () => T0,
    });
```

#### 4. The probe suite — capture doctrine (F001/F015)
**File**: `tests/probe-linkedin.test.ts`
**Changes**: Same merged-fence shape. **Phase 1 applies ONLY the capture hunks; the `:29-35` facade split inside Hunk A is Phase 2 scope.**

```ts
Hunk A — imports:

WAS:
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
NOW:
import { mkdtemp, rm, writeFile } from "node:fs/promises";
WAS:
import { dirname, join } from "node:path";
NOW:
import { join } from "node:path";
DELETE the whole line:
import { fileURLToPath } from "node:url";
WAS:
import type { CaptureRecord, CaptureSink } from "../src/linkedin-capture.js";
NOW (AMENDED form — wraps at lineWidth 100):
import {
  type CaptureRecord,
  type CaptureSink,
  NOOP_CAPTURE_SINK,
} from "../src/linkedin-capture.js";

[PHASE 2 SCOPE — SKIP IN PHASE 1] WAS (:29-35):
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-fetch.js";
NOW (F006 split):
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import { LINKEDIN_PROFILE_DIR } from "../src/linkedin-fetch.js";

ADD at the end of the import block:
import { assertNoFreshCaptures } from "./capture-oracle.js";

Hunk B — DELETE lines :52-58 (the local snapshot block, closing ); included):

# The capture doctrine's absence-oracle snapshot… (comment block)
const repoCaptures = join(dirname(fileURLToPath(import.meta.url)), "..", "captures");
const repoCapturesBefore = await access(repoCaptures).then(
  () => true,
  () => false,
);

Hunk C — after() (:60-69), replace the oracle arm (same shape as the fetch
suite's Hunk C).

Hunk D — 5 injections:
- :329 (tagged halt), :344 (leg-dead), :359 (all-faulted), :377 (zero-surfaces): insert
  `captureSink: NOOP_CAPTURE_SINK,` as the FIRST property line (multi-line literals — plain insert).
- :396 (cookie preflight) is a SINGLE-LINE literal — reformat verbatim:

WAS:
      () => runProbe({ config: CONFIG, env: {}, contextFactory, now: () => T0 }),
NOW:
      () =>
        runProbe({
          captureSink: NOOP_CAPTURE_SINK,
          config: CONFIG,
          env: {},
          contextFactory,
          now: () => T0,
        }),

The two sites at :275/:308 keep recordingSink().
```

#### 5. The walk suite — oracle re-point (F015)
**File**: `tests/linkedin-fetch.test.ts`
**Changes**: Merged fence (Slice 1 + Slice 2). **Phase 1 applies the import deletions, the oracle-import ADD, and Hunk B; the `:32-45` facade split inside Hunk A is Phase 2 scope.**

```ts
Hunk A — imports:

[PHASE 1 SCOPE] DELETE the whole line: import { access } from "node:fs/promises";
[PHASE 1 SCOPE] DELETE the whole line: import { dirname, join } from "node:path";
[PHASE 1 SCOPE] DELETE the whole line: import { fileURLToPath } from "node:url";

[PHASE 2 SCOPE — SKIP IN PHASE 1] WAS (:32-45):
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedinSurface,
  PACE_MAX_MS,
  PACE_MIN_MS,
  allSurfacesFaulted,
  fetchLinkedInPosts,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
NOW (F006 split — the six facade symbols move to linkedin-context.js; the six
permanent exports stay):
import {
  allSurfacesFaulted,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
} from "../src/linkedin-context.js";
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedinSurface,
  PACE_MAX_MS,
  PACE_MIN_MS,
  fetchLinkedInPosts,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";

ADD after the last ../src import:
import { assertNoFreshCaptures } from "./capture-oracle.js";

Hunk B — DELETE lines :1312-1328 (comment header starts at :1312) and REPLACE with:

// --- the offline-capture doctrine oracle (F015, shared helper): this
// suite drives fetchLinkedInPosts DIRECTLY, so a future case handing the
// walk a production-default sink fails HERE instead of writing captures/
// into the repo.
after(async () => {
  await assertNoFreshCaptures();
});
```

#### 6. The tick — sink seam fix (F001, seams 1-2)
**File**: `scripts/fetch-linkedin.ts`
**Changes**: Merged fence (Slice 1 + Slice 2). **Phase 1 applies Hunks A-C; Hunk D (the facade import split) is Phase 2 scope.**

```ts
Hunk A — FetchTickDeps.captureSink JSDoc (:99-108), replace — WAS verbatim, then NOW:

WAS:
  /**
   * Capture sink for the walk (capture-first, design 2026-11-13). Default:
   * the production fs sink — one atomic JSON file per intercepted body
   * under captures/<UTC session stamp>/ (LINKEDIN_CAPTURES_ROOT; gitignored
   * scratch, never committed state). Passing nothing means CAPTURE TO
   * DISK, not capture disabled: the offline suite injects a recording
   * sink in every walk-driving case, because npm test must never write
   * captures/ into the repo.
   */
  captureSink?: CaptureSink;
NOW:
  /**
   * Capture sink for the walk (capture-first, design 2026-11-13). No
   * default: passing nothing means CAPTURE DISABLED — the walk's guards
   * skip capture when the sink is undefined (src/linkedin-walk.ts:173,
   * :235). The production entry passes makeFsCaptureSink() explicitly
   * (F001: the defaulting seam lives at script entries); the offline
   * suite injects NOOP_CAPTURE_SINK or a recording sink in every
   * walk-driving case, because npm test must never write captures/.
   */
  captureSink?: CaptureSink;

Hunk B — the internal default (:438), exactOptionalPropertyTypes-safe passthrough:

WAS:
      captureSink: deps.captureSink ?? makeFsCaptureSink(),
NOW:
      ...(deps.captureSink !== undefined ? { captureSink: deps.captureSink } : {}),

Hunk C — CLI entry (:487), wrapped for the 100-col lint:

WAS:
  fetchTick({ env: envWithDotEnv() }).catch(async (error: unknown) => {
NOW:
  fetchTick({
    env: envWithDotEnv(),
    captureSink: makeFsCaptureSink(),
  }).catch(async (error: unknown) => {

[PHASE 2 SCOPE — SKIP IN PHASE 1] Hunk D — the facade import split (:41-49); the FOUR facade symbols move to
linkedin-context.js, the THREE permanent exports stay (biome byte order:
linkedin-context.js < linkedin-fetch.js):

WAS:
import {
  type LinkedInContextFactory,
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
NOW:
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import {
  type LinkedinSurface,
  fetchLinkedInPosts,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
```

#### 7. The probe gate — sink seam fix (F001, seams 3-4)
**File**: `scripts/probe-linkedin.ts`
**Changes**: Merged fence (Slice 1 + Slice 2), same shape as scripts/fetch-linkedin.ts. **Phase 1 applies Hunks A-C; Hunk D is Phase 2 scope.**

```ts
Hunk A — ProbeDeps.captureSink JSDoc (:115-122), replace:

  /**
   * Capture sink for the walk (capture-first, design 2026-11-13). No
   * default: passing nothing means CAPTURE DISABLED — the walk's guards
   * skip capture when the sink is undefined. The production CLI entry
   * passes makeFsCaptureSink() explicitly (F001: the defaulting seam
   * lives at script entries); the offline suite injects NOOP_CAPTURE_SINK
   * or a recording sink.
   */
  captureSink?: CaptureSink;

Hunk B — the internal default (:183):

WAS:
    captureSink: deps.captureSink ?? makeFsCaptureSink(),
NOW:
    ...(deps.captureSink !== undefined ? { captureSink: deps.captureSink } : {}),

Hunk C — CLI entry (:199):

WAS:
  runProbe().catch((error: unknown) => {
NOW:
  runProbe({ captureSink: makeFsCaptureSink() }).catch((error: unknown) => {

[PHASE 2 SCOPE — SKIP IN PHASE 1] Hunk D — the facade import split (:37-45), identical shape to
scripts/fetch-linkedin.ts Hunk D (the FOUR facade symbols move to
linkedin-context.js; the THREE permanent exports stay):

WAS:
import {
  type LinkedInContextFactory,
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
NOW:
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import {
  type LinkedinSurface,
  fetchLinkedInPosts,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
```

#### 8. The loop — explicit tick sink (F001, seam 5)
**File**: `scripts/watch-linkedin.ts`
**Changes**: Phase 1 adds the sink import and the default tick's explicit sink. The FULL Hunk A import-block rewrite (the F006/F014 split) lands in Phase 2 — do not split the imports here.

```ts
[PHASE 1 SCOPE] Insert after the behavior import (biome byte order: env-file < behavior < capture < …):

import { makeFsCaptureSink } from "../src/linkedin-capture.js";

Hunk B — the default tick (:50), the loop keeps capture:

WAS:
  const tick = deps.tick ?? (() => fetchTick({ env }));
NOW:
  const tick = deps.tick ?? (() => fetchTick({ env, captureSink: makeFsCaptureSink() }));

[PHASE 2 SCOPE — SKIP IN PHASE 1] Hunk A — the import block (:17-21) becomes (biome byte order: env-file <
behavior < capture < context < fetch; the F001 sink import and the F006/F014
split merge into one block):

WAS:
import { pathToFileURL } from "node:url";
import { envWithDotEnv } from "../src/env-file.js";
import { type RandomFn, sampleTickDelayMs } from "../src/linkedin-behavior.js";
import { type SleepFn, isLegDead } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";
NOW:
import { pathToFileURL } from "node:url";
import { envWithDotEnv } from "../src/env-file.js";
import { type RandomFn, sampleTickDelayMs } from "../src/linkedin-behavior.js";
import { makeFsCaptureSink } from "../src/linkedin-capture.js";
import { isLegDead } from "../src/linkedin-context.js";
import { type SleepFn } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";

(isLegDead re-points to linkedin-context.js — F006; type SleepFn STAYS on
linkedin-fetch.js — D5: re-pointing it to sleep.js would orphan the F014
re-export and redden knip.)
```

#### 9. The chain — explicit stage sinks (F001, seam 6)
**File**: `scripts/linkedin-chain.ts`
**Changes**: Both stage defaults gain the explicit fs sink:

```ts
Hunk A — imports (insert after the env-file import):

import { makeFsCaptureSink } from "../src/linkedin-capture.js";

Hunk B — the stage defaults (:86-87), wrapped for 100 cols; the chain keeps capture:

WAS:
  const probe = deps.probe ?? ((legEnv: Env) => runProbe({ env: legEnv }));
  const tick = deps.tick ?? ((legEnv: Env) => fetchTick({ env: legEnv }));
NOW:
  const probe =
    deps.probe ?? ((legEnv: Env) => runProbe({ env: legEnv, captureSink: makeFsCaptureSink() }));
  const tick =
    deps.tick ?? ((legEnv: Env) => fetchTick({ env: legEnv, captureSink: makeFsCaptureSink() }));
```

#### 10. Ledger marks (D11 — per phase)
**File**: `TECH_DEBT_AUDIT.md`
**Changes**: Insert the Resolution section after the Executive summary bullet list, before `'## Architectural mental model'`. This commit creates the section with Phase 1's rows plus the two standing rows (F002, F016); each later phase extends the table with its own rows (in the final table's order); Phase 4 completes it to the exact 16-row table.

```md
## Resolution — run #7 (design 2026-11-15; marks land per phase)

| ID | Status | Where |
|----|--------|-------|
| F001 | RESOLVED — Slice 1 | six production seams pass the fs sink explicitly; 18 test blocks inject `NOOP_CAPTURE_SINK`; the two `??` defaults are gone |
| F015 | RESOLVED — Slice 1 | `tests/capture-oracle.ts` (shared snapshot + assert-absent + leaked-dir report); three suites re-pointed |
| F002 | DEFERRED | developer decision — the alarm keeps citing the missing DOCUMENTATION.md sections |
| F016 | AS-IS | leave the git-dependent skip; the skip message names the cause |
```

(The F011 OPERATOR row joins LAST, at Phase 4, so the final table matches the design exactly.)

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] `grep -c "captureSink:" tests/fetch-linkedin.test.ts` returns 18; `grep -c "captureSink:" tests/probe-linkedin.test.ts` returns 7
- [x] `grep -rn "?? makeFsCaptureSink" scripts/` returns nothing
- [x] `grep -c "makeFsCaptureSink()" scripts/fetch-linkedin.ts scripts/probe-linkedin.ts scripts/watch-linkedin.ts scripts/linkedin-chain.ts` — each file has >= 1 non-import occurrence
- [x] `grep -rn "repoCapturesBefore" tests/*.test.ts` returns nothing (the shared helper keeps its own snapshot)

#### Manual Verification:
- [ ] Operator: `rm -rf captures/` (gitignored scratch — never a git operation; run AFTER the slice commit is staged)
- [ ] Two clean checkouts each pass `npm test` with no captures/ regrowth
- [ ] An intentionally sink-less scratch case fails the oracle naming the leaked session dir and its files

---

## Phase 2: smalls + probe fix + facades

### Overview

Deletes BOTH run-#7 re-export facades atomically with the 10-site re-point (D4 — re-point without deleting is knip-red; delete without re-pointing is TS2305), transplants the availability pre-check's envelope gate into the probe leg classifier (F005) with the entry guard + injectable fetch + offline replay suite (D6), and lands the smalls: F004's equality pin, F008's measured-evidence comment, F009's README PC-path docs, F014's SleepFn re-export. One commit — knip atomicity. F005's live validation is the NEXT dispatch after merge (expected ceiling changes, precedent 7cc7250), not a gate here.

### Changes Required:

#### 1. Judge facade — DELETE (F006, D4)
**File**: `src/judge.ts`
**Changes**: Delete lines :25-36 — the facade comment block and both re-exports, verbatim:

```ts
// The re-export facade (N042a). Two symbols keep their old import path so
// the offline suite stays unedited: tests/judge.test.ts:9-15 and
// tests/judge-rotation.test.ts:22 import buildBulkMessages and judgePost
// from ../src/judge.js, and scripts/probe-judge.ts:46 imports
// buildBulkMessages from judge.js.
//
// REMOVAL NOTE (run #7): re-point those three imports at ./judge-prompts.js
// and ./judge-dispatch.js, then delete this block. The run-5 plan's D3
// forbade exactly this as a "second import path" drift class; the run-6
// "tests unedited" criterion wins for this pass.
export { buildBulkMessages } from "./judge-prompts.js";
export { judgePost };
```

The module's own import of judgeBatch + judgePost from `"./judge-dispatch.js"` STAYS — judgePost remains in internal use in the fallback pool. No other change: parseLlmAccounts, resolveJudgeConfig, judgePosts, and LlmAccount keep their real exports (knip consumes them from src/index.ts, the two suites, and scripts/probe-judge.ts).

#### 2. LinkedIn facade — DELETE + SleepFn re-export (F006/F014)
**File**: `src/linkedin-fetch.ts`
**Changes**: Deletes the N042b facade atomically with the re-point, drops the orphaned internal import, and re-exports SleepFn from sleep.ts:

```ts
Hunk A — DELETE lines :46-68 (the facade comment block, the export block,
and the SCROLL_JS re-export), verbatim:

// The re-export facade (N042b). Eight symbols keep their old import path so
// three scripts and four test files stay unedited:
//   scripts/fetch-linkedin.ts, scripts/probe-linkedin.ts,
//   scripts/watch-linkedin.ts, src/index.ts,
//   tests/linkedin-fetch.test.ts, tests/fetch-linkedin.test.ts,
//   tests/probe-linkedin.test.ts, tests/watch-linkedin.test.ts.
//
// REMOVAL NOTE (run #7): re-point those imports at ./linkedin-context.js and
// ./linkedin-walk.js, then delete this block. The N012 class is "export with
// no cross-module importer" — every symbol below has one, so the facade is
// knip-safe. It must NOT grow: makeLinkedInContextFactory, the two UA
// constants, and the production factory have no importer from this
// specifier.
export {
  type LinkedInContextFactory,
  allSurfacesFaulted,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
};
export { SCROLL_JS } from "./linkedin-walk-static.js";

(The comment's importer list names src/index.ts, but index.ts imports
LinkedinSurface — a local export — not the facade; the phantom eighth
importer stays.)

Hunk B — the internal linkedin-context import drops isAllSurfacesFaulted
(its sole use was the facade export; every other name is used internally):

WAS:
import {
  type LinkedInContextFactory,
  allSurfacesFaulted,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
  makeLinkedInContextFactory,
} from "./linkedin-context.js";
NOW:
import {
  type LinkedInContextFactory,
  allSurfacesFaulted,
  halt,
  isHalt,
  isLegDead,
  legDead,
  makeLinkedInContextFactory,
} from "./linkedin-context.js";

Hunk C — F014: add the literal type import between the pool.js and types.js
imports (biome order: pool.js < sleep.js < types.js), and REPLACE the local
declaration (:72-73):

+ import { type SleepFn } from "./sleep.js";

WAS:
/** Injectable sleep for the pacing gate (judge.ts trailing-param idiom). */
export type SleepFn = (ms: number) => Promise<void>;
NOW:
// Injectable sleep for the pacing gate (judge.ts trailing-param idiom).
// F014 (2026-11-15): sleep.ts is the canonical declaration; this module
// re-exports it because scripts/watch-linkedin.ts keeps importing SleepFn
// from here (D5 — re-pointing the consumer to sleep.js would orphan this
// re-export and redden knip).
export type { SleepFn };
```

#### 3. Paired cap constant — export (F004)
**File**: `src/judge-rotation.ts`
**Changes**:

```ts
WAS (:60-66):
/**
 * Consecutive hard-failed ticks that cap an account at ceiling 1 — the
 * paired twin of the judge-health module's HARD_FAIL_TICKS_TO_CAP (no
 * import exists: this module reads plain state fields only, the D5
 * boundary). The two MUST stay equal; both doc sites say so.
 */
const HEALTH_CAP_STREAK = 2;
NOW:
/**
 * Consecutive hard-failed ticks that cap an account at ceiling 1 — the
 * paired twin of the judge-health module's HARD_FAIL_TICKS_TO_CAP (no
 * import exists: this module reads plain state fields only, the D5
 * boundary). The two MUST stay equal; the equality test in
 * tests/judge-health.test.ts pins the pair (F004, 2026-11-15).
 */
export const HEALTH_CAP_STREAK = 2;
```

#### 4. Equality test — the drift guard (F004)
**File**: `tests/judge-health.test.ts`
**Changes**:

```ts
Hunk A — the ../src/judge-health.js brace list gains HARD_FAIL_TICKS_TO_CAP
(ASCII order: AccountTickOutcome < HARD_FAIL_TICKS_TO_CAP < HealthFile):

  import {
    type AccountTickOutcome,
+   HARD_FAIL_TICKS_TO_CAP,
    type HealthFile,
    type OutcomeLedgerState,
    ... (rest unchanged)

Hunk B — a new import line between the judge-health.js block and the
judge.js type import (biome order: judge-health.js < judge-rotation.js <
judge.js):

+ import { HEALTH_CAP_STREAK } from "../src/judge-rotation.js";
  import type { LlmAccount } from "../src/judge.js";

Hunk C — append at the end of the file:

describe("the paired cap constants (F004, 2026-11-15)", () => {
  it("rotation's HEALTH_CAP_STREAK equals health's HARD_FAIL_TICKS_TO_CAP - the zero-import boundary keeps two copies", () => {
    assert.equal(HEALTH_CAP_STREAK, HARD_FAIL_TICKS_TO_CAP);
  });
});
```

#### 5. Probe leg classifier — envelope gate + importable CLI (F005, D6)
**File**: `scripts/probe-judge.ts`
**Changes**: The leg classifier gains the availability gate's envelope check; the CLI becomes importable (entry guard + injectable fetch + CONFIG into main) so the replay suite can drive it offline:

```ts
Hunk A — imports (buildBulkMessages re-pointed off the judge.js facade;
node:url added for the entry guard; biome byte order — judge-prompts.js
sorts before judge.js because "-" < "."):

WAS:
import { loadWatcherConfig } from "../src/config-file.js";
import { JUDGE_CEILINGS_PATH } from "../src/config.js";
import { writeCeilingsAtomic } from "../src/judge-ceilings.js";
import { type LlmAccount, buildBulkMessages, resolveJudgeConfig } from "../src/judge.js";
import type { Post } from "../src/types.js";
NOW:
import { pathToFileURL } from "node:url";
import { type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
import { JUDGE_CEILINGS_PATH } from "../src/config.js";
import { writeCeilingsAtomic } from "../src/judge-ceilings.js";
import { buildBulkMessages } from "../src/judge-prompts.js";
import { type LlmAccount, resolveJudgeConfig } from "../src/judge.js";
import type { Post } from "../src/types.js";

Hunk B — DELETE the module-level config read (:49-50, comment included):

// Read once at startup; a missing or malformed file fails the probe loudly.
const CONFIG = await loadWatcherConfig();

and add the same two lines as the FIRST statements of main() (the import
stays side-effect free — a bare import no longer reads the config file):

async function main(): Promise<void> {
  // Read once at startup; a missing or malformed file fails the probe loudly.
  const CONFIG = await loadWatcherConfig();
  let accounts: LlmAccount[];
  ...

probeAccount gains a trailing param and reads it instead of the module
constant (signature + the two CONFIG.* reads):

WAS:
async function probeAccount(index: number, account: LlmAccount): Promise<...>
  messages: buildBulkMessages(ten, CONFIG.keywords),
  reasoning_effort: CONFIG.reasoningEffort,
NOW:
async function probeAccount(
  index: number,
  account: LlmAccount,
  config: WatcherConfig,
): Promise<...>
  messages: buildBulkMessages(ten, config.keywords),
  reasoning_effort: config.reasoningEffort,

and main's collector passes it through:

WAS:
  const settled = await Promise.allSettled(
    accounts.map((account, index) => probeAccount(index, account)),
  );
NOW:
  const settled = await Promise.allSettled(
    accounts.map((account, index) => probeAccount(index, account, CONFIG)),
  );

Hunk C — timed is exported with an injectable fetch (params wrap at
lineWidth 100; the live callers stay on global fetch):

WAS:
async function timed(label: string, payload: unknown, account: LlmAccount): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetch(`${account.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
NOW:
export async function timed(
  label: string,
  payload: unknown,
  account: LlmAccount,
  fetchFn: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetchFn(`${account.baseUrl.replace(/\/+$/, "")}/chat/completions`, {

Hunk D — the envelope gate replaces the brace probe (:122):

WAS:
    const ok = body.includes("{");
    console.log(
      `probe: ${label} — ${elapsed}ms — HTTP ${response.status} ${ok ? "OK" : "NO JSON"}`,
    );
    return ok ? { kind: "ok" } : { kind: "failed", message: "response carried no JSON" };
NOW:
    const ok = carriesAnswerEnvelope(body);
    console.log(
      `probe: ${label} — ${elapsed}ms — HTTP ${response.status} ${ok ? "OK" : "NO ENVELOPE"}`,
    );
    return ok
      ? { kind: "ok" }
      : { kind: "failed", message: "response carried no chat-completions envelope" };

plus the new module-private helper, placed directly above timed (the
transplant of src/judge-availability.ts:136-146's gate shape):

/**
 * True when a 2xx body carries the production answer envelope: parsable
 * JSON with a non-empty choices[0].message.content string. An error
 * envelope, an HTML interstitial, or a truncated answer is a FAILED leg,
 * not a good one — the old includes("{") check counted all three as ok and
 * inflated committed ceilings (F005, 2026-11-15).
 */
function carriesAnswerEnvelope(body: string): boolean {
  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  } catch {
    return false;
  }
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim().length > 0;
}

Hunk E — the header gains a revision note in the file's own style (after
the 2026-11-07 freshness-gate note):

 * Revision 2026-11-15 (F005): a leg counts as ok only when the 2xx body
 * carries the production answer envelope (choices[0].message.content is a
 * non-empty string) — an error-shaped 2xx no longer inflates committed
 * ceilings. The CLI is now importable: the entry guard replaces the bare
 * await main(), the config read moved into main(), and timed takes an
 * injectable fetch, so tests/probe-judge.test.ts replays the classifier
 * offline.

Hunk F — the bare tail (:340) becomes the four-script entry guard:

WAS:
await main();
NOW:
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
```

#### 6. Probe replay suite (NEW, F005)
**File**: `tests/probe-judge.test.ts`
**Changes**: Create the file — the F005 replay suite. The bare import IS the entry-guard pin: importing the module must not read the config, resolve accounts, or fire a live call.

```ts
/**
 * Offline replay of the probe's leg classifier (F005, 2026-11-15): the
 * old includes("{") check counted any 2xx carrying a brace as a good leg,
 * so an error envelope or an HTML interstitial inflated committed ceilings
 * for the next 8 hours. The gate now requires the production answer
 * envelope; these cases pin it. Importing scripts/probe-judge.js here is
 * the entry-guard pin — a side-effecting import would read
 * watcher.config.json and launch the live probe.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timed } from "../scripts/probe-judge.js";
import type { LlmAccount } from "../src/judge.js";

/** One account; the trailing slash pins the endpoint normalization. */
const ACCOUNT: LlmAccount = {
  baseUrl: "https://probe.api/v1/",
  apiKey: "key",
  model: "model",
};

/** The minimal production answer envelope. */
const ANSWER = JSON.stringify({
  choices: [{ message: { role: "assistant", content: "ok" } }],
});

/**
 * Fetch double: answers every call with the given body + status and records
 * the request URLs. Returns real Response objects (the suite's idiom).
 */
function fetchAnswering(body: string, status = 200) {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL) => {
    urls.push(String(input));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

describe("timed — the probe leg classifier (F005)", () => {
  it("a 2xx answer envelope is ok", async () => {
    const { fetchFn } = fetchAnswering(ANSWER);
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), { kind: "ok" });
  });

  it("a 2xx JSON error envelope is a failed leg — the includes-brace bug", async () => {
    const { fetchFn } = fetchAnswering(JSON.stringify({ error: { message: "quota" } }));
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), {
      kind: "failed",
      message: "response carried no chat-completions envelope",
    });
  });

  it("a 2xx non-JSON body is a failed leg", async () => {
    const { fetchFn } = fetchAnswering("<html>interstitial</html>");
    assert.equal((await timed("leg", {}, ACCOUNT, fetchFn)).kind, "failed");
  });

  it("a 2xx envelope with whitespace-only content is a failed leg", async () => {
    const blank = JSON.stringify({ choices: [{ message: { content: "   " } }] });
    const { fetchFn } = fetchAnswering(blank);
    assert.equal((await timed("leg", {}, ACCOUNT, fetchFn)).kind, "failed");
  });

  it("HTTP 429 is refused, not failed — the account is busy", async () => {
    const { fetchFn } = fetchAnswering("{}", 429);
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), {
      kind: "refused",
      status: 429,
    });
  });

  it("HTTP 401 is refused — classifyDead turns it into auth-dead", async () => {
    const { fetchFn } = fetchAnswering("{}", 401);
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), {
      kind: "refused",
      status: 401,
    });
  });

  it("a transport throw is a failed leg carrying the error message", async () => {
    const fetchFn = (async () => {
      throw new Error("socket hung up");
    }) as unknown as typeof fetch;
    assert.deepEqual(await timed("leg", {}, ACCOUNT, fetchFn), {
      kind: "failed",
      message: "socket hung up",
    });
  });

  it("posts to the normalized chat-completions endpoint", async () => {
    const { fetchFn, urls } = fetchAnswering(ANSWER);
    await timed("leg", {}, ACCOUNT, fetchFn);
    assert.deepEqual(urls, ["https://probe.api/v1/chat/completions"]);
  });

  it("logs the NO ENVELOPE token for a failed 2xx leg", async (t) => {
    const logs = t.mock.method(console, "log", console.log.bind(console));
    const { fetchFn } = fetchAnswering(JSON.stringify({ error: {} }));
    await timed("account 1 (https://probe.api/v1/) minimal call", {}, ACCOUNT, fetchFn);
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(
      lines.some(
        (line) =>
          line.includes("account 1 (https://probe.api/v1/) minimal call") &&
          line.includes("NO ENVELOPE"),
      ),
    );
  });
});
```

#### 7. Judge suite — facade import re-point (F006)
**File**: `tests/judge.test.ts`
**Changes**:

```ts
WAS (:8-15):
import {
  type LlmAccount,
  buildBulkMessages,
  judgePost,
  judgePosts,
  parseLlmAccounts,
  resolveJudgeConfig,
} from "../src/judge.js";
NOW (three-way re-point; biome byte order judge-dispatch.js <
judge-prompts.js < judge-rotation.js < judge.js — src/judge-dispatch.ts:29-30
proves prompts sorts before rotation, so the existing :3-7 rotation block
MOVES after the new prompts line; its members are unchanged):

import { judgePost } from "../src/judge-dispatch.js";
import { buildBulkMessages } from "../src/judge-prompts.js";
import {
  type RotationExhausted,
  type RotationState,
  isRotationExhausted,
} from "../src/judge-rotation.js";
import { type LlmAccount, judgePosts, parseLlmAccounts, resolveJudgeConfig } from "../src/judge.js";
import { KEYWORDS, bulkContent, bulkPost, id19, ok, singleAccount } from "./judge-helpers.js";

(The judge.js line is exactly 100 columns — biome's inclusive bound, the
src/index.ts:37 disk-green proof. The ./judge-helpers.js line is unchanged
and shown for position only.)
```

#### 8. Rotation suite — mixed import split (F006)
**File**: `tests/judge-rotation.test.ts`
**Changes**:

```ts
Hunk A — insert BEFORE the :9-21 judge-rotation.js block:

import { judgePost } from "../src/judge-dispatch.js";

Hunk B — the mixed import (:22) splits:

WAS:
import { type LlmAccount, judgePost, judgePosts } from "../src/judge.js";
NOW:
import { type LlmAccount, judgePosts } from "../src/judge.js";
```

#### 9. Watch suite — legDead re-point (F006)
**File**: `tests/watch-linkedin.test.ts`
**Changes**:

```ts
WAS (:16):
import { legDead } from "../src/linkedin-fetch.js";
NOW:
import { legDead } from "../src/linkedin-context.js";
```

#### 10. Tick — facade import split (F006, Phase 1 Hunk D)
**File**: `scripts/fetch-linkedin.ts`
**Changes**: Apply the Phase 1 fence's Hunk D — the FOUR facade symbols move to linkedin-context.js, the THREE permanent exports stay (biome byte order: linkedin-context.js < linkedin-fetch.js):

```ts
WAS:
import {
  type LinkedInContextFactory,
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
NOW:
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import {
  type LinkedinSurface,
  fetchLinkedInPosts,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
```

#### 11. Probe gate — facade import split (F006, Phase 1 Hunk D)
**File**: `scripts/probe-linkedin.ts`
**Changes**: Apply the Phase 1 fence's Hunk D — identical shape to scripts/fetch-linkedin.ts (the FOUR facade symbols move to linkedin-context.js; the THREE permanent exports stay):

```ts
WAS:
import {
  type LinkedInContextFactory,
  type LinkedinSurface,
  fetchLinkedInPosts,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
NOW:
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import {
  type LinkedinSurface,
  fetchLinkedInPosts,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
```

#### 12. Loop — F006/F014 import split (Phase 1 Hunk A)
**File**: `scripts/watch-linkedin.ts`
**Changes**: Apply the Phase 1 fence's Hunk A — the import block (:17-21) becomes (biome byte order: env-file < behavior < capture < context < fetch; the F001 sink import and the F006/F014 split merge into one block):

```ts
WAS:
import { pathToFileURL } from "node:url";
import { envWithDotEnv } from "../src/env-file.js";
import { type RandomFn, sampleTickDelayMs } from "../src/linkedin-behavior.js";
import { type SleepFn, isLegDead } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";
NOW:
import { pathToFileURL } from "node:url";
import { envWithDotEnv } from "../src/env-file.js";
import { type RandomFn, sampleTickDelayMs } from "../src/linkedin-behavior.js";
import { makeFsCaptureSink } from "../src/linkedin-capture.js";
import { isLegDead } from "../src/linkedin-context.js";
import { type SleepFn } from "../src/linkedin-fetch.js";
import { fetchTick, handleLegDeadEpisode } from "./fetch-linkedin.js";

(isLegDead re-points to linkedin-context.js — F006; type SleepFn STAYS on
linkedin-fetch.js — D5: re-pointing it to sleep.js would orphan the F014
re-export and redden knip.)
```

#### 13. Fetch suite — facade swap (F006, Phase 1 Hunk A)
**File**: `tests/fetch-linkedin.test.ts`
**Changes**: Apply the Phase 1 fence's Hunk A `:35` swap — the context pair at the :35 slot; SCROLL_JS after linkedin-session.js :37 (byte order session < walk-static < state):

```ts
WAS (:35):
import { type LinkedInContextFactory, SCROLL_JS, isLegDead } from "../src/linkedin-fetch.js";
NOW:
import { type LinkedInContextFactory, isLegDead } from "../src/linkedin-context.js";
...
import { SCROLL_JS } from "../src/linkedin-walk-static.js";
```

#### 14. Probe suite — facade split (F006, Phase 1 Hunk A)
**File**: `tests/probe-linkedin.test.ts`
**Changes**: Apply the Phase 1 fence's Hunk A `:29-35` split:

```ts
WAS (:29-35):
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-fetch.js";
NOW (F006 split):
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import { LINKEDIN_PROFILE_DIR } from "../src/linkedin-fetch.js";
```

#### 15. Walk suite — facade split (F006, Phase 1 Hunk A)
**File**: `tests/linkedin-fetch.test.ts`
**Changes**: Apply the Phase 1 fence's Hunk A `:32-45` split — the six facade symbols move to linkedin-context.js; the six permanent exports stay:

```ts
WAS (:32-45):
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedinSurface,
  PACE_MAX_MS,
  PACE_MIN_MS,
  allSurfacesFaulted,
  fetchLinkedInPosts,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
NOW (F006 split):
import {
  allSurfacesFaulted,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
} from "../src/linkedin-context.js";
import {
  LINKEDIN_PROFILE_DIR,
  type LinkedinSurface,
  PACE_MAX_MS,
  PACE_MIN_MS,
  fetchLinkedInPosts,
  resolveLinkedInProfileDir,
} from "../src/linkedin-fetch.js";
```

#### 16. Measured-evidence comment (F008, D8)
**File**: `src/judge-dispatch.ts`
**Changes**:

```ts
WAS (:56-62):
/**
 * Per-request timeout. 15s was never validated from a GitHub runner: run
 * 40264368939 timed out every batch and every fallback call at exactly
 * 15.0s. Phase 0 measures the real latency from the runner and confirms
 * this value.
 */
const REQUEST_TIMEOUT_MS = 60_000;
NOW:
/**
 * Per-request timeout, sized from measured numbers: run 40264368939
 * timed out every batch and every fallback call at exactly 15.0s from
 * the GitHub runner, and the real-caption probe measured one bulk leg at
 * 27.75s — 15s was never a valid bound on either machine. 60s covers the
 * measured worst leg with headroom inside the 480s job budget. Unmeasured
 * values stay constants — raise it only with a probe- or runner-measured
 * reason.
 */
const REQUEST_TIMEOUT_MS = 60_000;
```

#### 17. README — PC-path defaults (F009)
**File**: `README.md`
**Changes**: In "## The LinkedIn leg on your PC (browser walk)", insert after the "Env setup note:" paragraph:

```md
Machine-default paths — single-operator Windows defaults, both overridable:

| What | Default | Override |
|---|---|---|
| Browser profile the walk and the login helper open | `C:/loker-secrets/linkedin-chromium-profile` | `LINKEDIN_PROFILE_DIR` |
| Cookie file `login-linkedin` writes and the tick reads | `C:/loker-secrets/linkedin-cookies.json` | `LINKEDIN_COOKIES_FILE` (the `.env` line the login helper writes) |

An override set in the shell or `.env` wins over the default. A clone that
overrides either variable must override it consistently for the login
helper, the probe, and the tick, so the browser that logs in and the
browser that walks share one profile.
```

#### 18. Ledger marks (D11 — per phase)
**File**: `TECH_DEBT_AUDIT.md`
**Changes**: Extend the Resolution table with Phase 2's rows (insert after the F016 row, keeping the final table's order):

```md
| F004 | RESOLVED — Slice 2 | `HEALTH_CAP_STREAK` exported; the equality test pins the pair in `tests/judge-health.test.ts` |
| F005 | RESOLVED — Slice 2 | the availability envelope gate replaces `includes("{")`; entry guard + injectable fetch + the replay suite `tests/probe-judge.test.ts` |
| F006 | RESOLVED — Slice 2 | both facades deleted; all 10 sites re-pointed atomically (8 mixed-import splits, 2 pure swaps) |
| F008 | RESOLVED — Slice 2 | `REQUEST_TIMEOUT_MS` rewritten as measured evidence (value + run 40264368939 + measured facts, no open questions) |
| F009 | RESOLVED — Slice 2 | README's PC-leg section documents both machine-default paths + their env overrides |
| F014 | RESOLVED — Slice 2 | `linkedin-fetch.ts` re-exports `SleepFn` from `sleep.js`; the `watch-linkedin.ts` consumer split keeps the re-export alive |
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Knip passes: `npm run knip`
- [x] `grep -rn "run #7" src/` returns nothing
- [x] `grep -rn "re-export facade" src/` returns nothing
- [x] `grep -n "SCROLL_JS" src/linkedin-fetch.ts` returns nothing
- [x] `grep -n "export type { SleepFn }" src/linkedin-fetch.ts` returns exactly 1 hit
- [x] `grep -n "export const HEALTH_CAP_STREAK" src/judge-rotation.ts` returns 1 hit
- [x] `grep -n "HEALTH_CAP_STREAK" tests/judge-health.test.ts` returns at least 1 hit
- [x] `grep -c "includes(\"{\")" scripts/probe-judge.ts` returns 0
- [x] `grep -rn "linkedin-fetch.js" tests/watch-linkedin.test.ts` returns nothing

#### Manual Verification:
- [ ] Two consecutive `npm test` runs stay green with no `captures/` regrowth (the Slice 1 oracle holds after the import churn)
- [ ] The next live dispatch after merge classifies 2xx error envelopes as failed legs; ceiling changes in the next state commit are expected (F005 live validation, precedent `7cc7250`)
- [ ] README's PC-path table matches the two code literals (`LINKEDIN_PROFILE_DIR`, `DEFAULT_COOKIE_PATH` in `scripts/login-linkedin.ts`)

---

## Phase 3: CI additions

### Overview

Freezes the runtime-import graph and gives the production dependency audit a CI seat: the madge devDependency + root `.madgerc` (the `skipTypeImports` seam, D12) + `npm run cycles` script + the ci.yml gate step, the non-blocking `npm audit --omit=dev` step (F013), watch.yml's env-indirect FORCE (F010), and the format-list extension (F012/D9). D7's own rule: the exact `npm run cycles` invocation is verified locally (exit 1 -> exit 0 with the rc file, measured 2026-11-16) BEFORE the ci.yml content merges. The madge devDependency + regenerated lockfile MUST land here, before Phase 4's majors (D10 — `npm ci` hard-fails on drift).

### Changes Required:

#### 1. Cycles gate + format extension (F003/F012)
**File**: `package.json`
**Changes**: Merged fence (Slice 3 + Slice 4). **Phase 3 applies Hunks A and B, and adds the madge devDependency line; Hunks C and D are Phase 4 scope.**

```json
Hunk A — the cycles script joins the gate cluster (after knip):

WAS:
    "knip": "knip",
NOW:
    "knip": "knip",
    "cycles": "madge --circular --extensions ts src",

Hunk B — format extension (F012/D9): append the three uncovered targets;
lint is UNCHANGED:

WAS:
    "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/linkedin-chain.ts scripts/replay-linkedin.ts",
NOW:
    "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/linkedin-chain.ts scripts/replay-linkedin.ts scripts/probe-judge.ts scripts/hooks watcher.config.json",

[PHASE 3 SCOPE, from Hunk C's context] devDependencies gains the madge line in
its alphabetical slot (between lint-staged and tsx); the other seven lines are
UNTOUCHED in Phase 3:

WAS:
    "lint-staged": "^15.3.0",
    "tsx": "^4.19.2",
NOW (after the madge line lands; majors still Phase 4):
    "lint-staged": "^15.3.0",
    "madge": "^8.0.0",
    "tsx": "^4.19.2",

[PHASE 4 SCOPE — SKIP IN PHASE 3] Hunk C — devDependencies, majors in their alphabetical positions (Slice 4
bumps five ranges; Slice 3's madge line keeps its slot; husky and tsx are
untouched — absent from the audit's npm outdated list):

WAS (the projected post-Slice-3 state — Slice 3's Hunk C already added the
madge line; the on-disk pre-Slice-3 file lacks it):
    "@biomejs/biome": "^1.9.4",
    "@types/node": "^22.10.1",
    "husky": "^9.1.7",
    "knip": "^5.88.1",
    "lint-staged": "^15.3.0",
    "madge": "^8.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
NOW:
    "@biomejs/biome": "^2.6.7",
    "@types/node": "^26.6.6",
    "husky": "^9.1.7",
    "knip": "^6.45.1",
    "lint-staged": "^17.6.0",
    "madge": "^8.0.0",
    "tsx": "^4.19.2",
    "typescript": "^7.0.2"

[PHASE 4 SCOPE — SKIP IN PHASE 3] Hunk D — dependencies, the two runtime minors (the audit's npm outdated
measured playwright 1.64.1→1.65.1 and nodemailer 10.3.1→10.5.0 at the
lockfile; the ranges floor at the measured targets):

WAS:
  "dependencies": {
    "nodemailer": "^10.3.0",
    "playwright": "^1.49.1"
  },
NOW:
  "dependencies": {
    "nodemailer": "^10.5.0",
    "playwright": "^1.65.1"
  },
```

(The lockfile regenerates with the Phase 3 install and again in Phase 4 — D10: the madge commit precedes the majors and `npm ci` hard-fails on drift, so the ordering is load-bearing. knip resolves madge through the cycles npm script's binary; knip 6 needs Node >= 20.19 — engines' >=22 satisfies it. knip 6's breaking changes are CLI/reporter-level — this repo has no knip config file, and none is needed. lint-staged 17 keeps the package.json key and the `.husky/pre-commit` `npx lint-staged` line; the staged-commit check is the criterion.)

#### 2. madge rc — the skipTypeImports seam (F003, D12, NEW)
**File**: `.madgerc`
**Changes**: Create at the repo root — madge's rc config (cwd lookup): the ONLY seam to detectiveOptions (the madge CLI, checked via --help, v8.0.0, exposes no flag for it). Write-once config; it does NOT join lint or format lists.

```json
{
  "detectiveOptions": {
    "ts": {
      "skipTypeImports": true
    }
  }
}
```

File Map amendment (the decomposition amendment's third leg — the design's `## Slices` Files line and its Architecture entry are the first two): insert into the design's `## File Map`, before the package.json line:

```
.madgerc                        # NEW — madge rc: skipTypeImports for the cycles gate (F003)
```

#### 3. CI gates — cycles + audit (F003/F013)
**File**: `.github/workflows/ci.yml`
**Changes**: One hunk — two new gate steps after the Unused exports step:

```yaml
WAS:
      - name: Unused exports
        run: npm run knip
NOW:
      - name: Unused exports
        run: npm run knip

      - name: No runtime import cycles
        # F003: the runtime-graph invariant, frozen. .madgerc sets
        # detectiveOptions.ts.skipTypeImports, so the type-only back-edges
        # (erased by verbatimModuleSyntax) stay invisible to the gate and
        # the first runtime cycle fails this step. Verified locally (D7,
        # 2026-11-16): madge 8.0.0 exits 1 on the 9 type-only cycles
        # without the rc file and exits 0 with it. The npm script runs
        # the pinned devDependency, never npx — the lockfile is the pin
        # (f50067d doctrine).
        run: npm run cycles

      - name: Audit runtime deps
        # F013: the production-dependency audit rides CI as an advisory
        # gate — continue-on-error keeps the job green while a new
        # advisory annotates this step for triage against the F007 bump
        # cadence. --omit=dev audits the closure the Actions runtime
        # installs and runs (playwright, nodemailer); 0 vulnerabilities
        # today, so the step is inert until an advisory lands.
        continue-on-error: true
        run: npm audit --omit=dev
```

#### 4. Freshness gate — env-indirect FORCE (F010)
**File**: `.github/workflows/watch.yml`
**Changes**: One hunk — the Freshness gate step gains a step-scoped env; the run body swaps the interpolation for the variable. The comment block and the rest of the body are unchanged:

```yaml
WAS:
      - name: Freshness gate (8h)
        id: freshness
        # The 8-hour window (28800 s) is a hard-coded workflow literal, not
        # an env knob (the tuning-values doctrine). The clock is the
        # probedAt entry the probe script stamps on SUCCESS - a failed
        # probe commits nothing, so the next dispatch re-probes. The gate
        # only ever widens the skip: scheduled ticks never run this job.
        run: |
          LAST=$(jq -r '.probedAt // 0' state/judge-ceilings.json 2>/dev/null || echo 0)
          if [ "${{ inputs.force }}" = "true" ]; then
            echo "probe: force re-probe requested - ignoring the freshness window"
            LAST=0
          fi
NOW:
      - name: Freshness gate (8h)
        id: freshness
        env:
          # F010: the dispatch input rides step env — the bash reads the
          # variable, never a ${{ }} interpolation inside the script (the
          # hygiene the doctrine mandates for secrets, applied to the one
          # input the gate reads). The typed boolean renders "true"/"false".
          FORCE: ${{ inputs.force }}
        # The 8-hour window (28800 s) is a hard-coded workflow literal, not
        # an env knob (the tuning-values doctrine). The clock is the
        # probedAt entry the probe script stamps on SUCCESS - a failed
        # probe commits nothing, so the next dispatch re-probes. The gate
        # only ever widens the skip: scheduled ticks never run this job.
        run: |
          LAST=$(jq -r '.probedAt // 0' state/judge-ceilings.json 2>/dev/null || echo 0)
          if [ "$FORCE" = "true" ]; then
            echo "probe: force re-probe requested - ignoring the freshness window"
            LAST=0
          fi
```

#### 5. Ledger marks (D11 — per phase)
**File**: `TECH_DEBT_AUDIT.md`
**Changes**: Extend the Resolution table with Phase 3's rows (after the F014 row, keeping the final table's order):

```md
| F003 | RESOLVED — Slice 3 | `madge` devDependency + root `.madgerc` (`detectiveOptions.ts.skipTypeImports`) + `npm run cycles`; the committed script exits 0 on the type-only graph — verified locally before the ci.yml step merged (D7) |
| F010 | RESOLVED — Slice 3 | the freshness gate reads `FORCE` from step `env:`; no `${{ inputs.force }}` interpolation inside the gate bash |
| F012 | RESOLVED — Slice 3 | `format` covers `scripts/probe-judge.ts`, `scripts/hooks`, `watcher.config.json`; the config file deliberately stays out of lint (D9) |
| F013 | RESOLVED — Slice 3 | `npm audit --omit=dev` rides ci.yml as a non-blocking step (`continue-on-error`) |
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Knip passes with the new devDependency: `npm run knip`
- [x] The committed cycles script exits 0 on the type-only graph: `npm run cycles`
- [x] Audit baseline holds: `npm audit --omit=dev` exits 0 ("found 0 vulnerabilities")
- [x] The audit step is non-blocking: `grep -c "continue-on-error" .github/workflows/ci.yml` returns 1
- [x] One interpolation left, and it is the env mapping: `grep -n '${{ inputs.force }}' .github/workflows/watch.yml` returns exactly 1 hit — the step `env:` line; the gate's `run:` body reads `$FORCE` (the :47 doc comment "inputs.force re-probes immediately" is prose, not code)
- [x] Format/lint asymmetry preserved (D9): `grep -c "watcher.config.json" package.json` returns 1 (format only, never lint); `grep -c "scripts/hooks" package.json` returns 2 (both lists)
- [x] The cycles gate is pinned to the lockfile: `grep -n "npx madge" .github/workflows/ci.yml package.json` returns nothing
- [x] The artifact's File Map carries the amendment: the File Map section contains exactly one `.madgerc` line

#### Manual Verification:
- [ ] D7 evidence stands on this checkout: without `.madgerc`, `npx madge@8.0.0 --circular --extensions ts src` exits 1 listing the 9 type-only cycles; with it, exit 0 (measured 2026-11-16)
- [ ] A scratch runtime back-edge (a plain `import` added between two judge modules in a scratch copy) reddens `npm run cycles` — the gate catches real cycles, not only today's type-only ones
- [ ] A manual dispatch of watch.yml with force=true still bypasses the freshness window
- [ ] `npm run format` re-indents `watcher.config.json` 3-space → 2-space; `npm test` stays green after (JSON.parse is whitespace-blind)

---

## Phase 4: majors last + ledger zero

### Overview

Bumps the five dev-tool majors and the two runtime minors (F007) LAST, policed by the gates frozen in Phase 3, migrates `biome.json` to the 2.x schema, and completes the ledger: all 16 findings marked, `TECH_DEBT_AUDIT.md` reads zero (F002 recorded deferred, F016 as-is). Majors-last bounds the playwright cache to exactly one miss (`watch.yml:179` hashes `package-lock.json`).

### Changes Required:

#### 1. Dev-tool majors + runtime minors (F007, D10)
**File**: `package.json`
**Changes**: Apply the Phase 3 fence's Hunks C and D (quoted there, verbatim): the five majors (`@biomejs/biome` ^2.6.7, `@types/node` ^26.6.6, `knip` ^6.45.1, `lint-staged` ^17.6.0, `typescript` ^7.0.2) and the two minors (`nodemailer` ^10.5.0, `playwright` ^1.65.1). `madge` ^8.0.0 keeps its alphabetical slot; husky and tsx are untouched. Then regenerate the lockfile (`npm install`) — `npm ci` must exit 0.

#### 2. biome.json — the 2.x migration (F007)
**File**: `biome.json`
**Changes**: Grounded in the 2.x configuration reference (biomejs.dev, fetched 2026-11-16): the 1.x hard `files.ignore` maps to `files.includes` with `!!` force-exclude negations — excluded from all operations including indexing, the faithful equivalent (a single `!` keeps the paths indexed for the type-aware rules this repo does not enable). `node_modules` is always ignored in 2.x; its row stays only for parity with the 1.x list. Dot-dirs are not auto-ignored without vcs integration, so the four dot entries stay explicit. `organizeImports` moves under `assist.actions.source`. The formatter/linter/javascript blocks keep their 1.x values byte-identical. `recommended: true` stays valid in 2.x — if 2.6.7 emits a deprecation error, the equivalent is `"rules": { "preset": "recommended" }` (the gates arbitrate). `npx biome migrate --write` produces this same shape; implement may run it and diff against this fence.

```json
{
  "$schema": "https://biomejs.dev/schemas/2.6.7/schema.json",
  "files": {
    "includes": [
      "**",
      "!!node_modules",
      "!!state",
      "!!.rpiv",
      "!!.pi",
      "!!.codebase-memory",
      "!!.git"
    ]
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "noNonNullAssertion": "off" },
      "suspicious": { "noAssignInExpressions": "off" }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  }
}
```

#### 3. Ledger zero (D11)
**File**: `TECH_DEBT_AUDIT.md`
**Changes**: Append the final two rows (after the F013 row), completing the table to the design's exact final state — all 16 findings marked:

```md
| F007 | RESOLVED — Slice 4 | dev-tool majors + the two runtime minors landed last, policed by the frozen gates (typecheck → lint → test → knip → cycles → audit); `biome.json` migrated to the 2.x schema |
| F011 | OPERATOR | `git worktree prune` on the main clone — one operator command, not a code change; the N043 policy stands |
```

### Success Criteria:

#### Automated Verification:
- [x] Gates green on the bumped toolchain, in order: `npm run typecheck`, `npm run lint`, `npm test`, `npm run knip`, `npm run cycles`, `npm audit --omit=dev`
- [x] The lockfile is regenerated and drift-free: `npm ci` exits 0
- [x] The majors landed: `grep -n '"@biomejs/biome": "^2.6.7"\|"@types/node": "^26.6.6"\|"knip": "^6.45.1"\|"lint-staged": "^17.6.0"\|"typescript": "^7.0.2"'` package.json` returns 5 hits; the minors: `grep -n '"playwright": "^1.65.1"\|"nodemailer": "^10.5.0"'` package.json` returns 2 hits; `"madge": "^8.0.0"` keeps its alphabetical slot — DEVIATION (user-approved): typescript stays `^5.9.3`, so this grep reads 4 hits; madge 8's parser crashes on the TS 7 API and its peer pins ^5.4.4 (ledger F007 row records the deferral)
- [x] biome.json carries the 2.x schema: `grep -c "schemas/2.6.7/schema.json" biome.json` returns 1 — DEVIATION (user-approved): `^2.6.7` installs CLI 2.6.8, which rejects the 2.6.7 schema label; biome.json carries `schemas/2.6.8/schema.json` (the plan's own `biome migrate` escape hatch)
- [x] No 1.x-only keys remain: `grep -c '"ignore"' biome.json` returns 0 and `grep -c '"organizeImports"' biome.json` returns exactly 1 (the assist occurrence — the top-level key is gone)
- [x] The ledger reads zero: `grep -c "PENDING" TECH_DEBT_AUDIT.md` returns 0
- [x] The ledger marks all 16 findings: `grep -c "RESOLVED\|DEFERRED\|AS-IS\|OPERATOR" TECH_DEBT_AUDIT.md` returns 16
- [x] `grep -rn "run #7" src/` returns nothing (carried from Phase 2 — stays green after the churn)

#### Manual Verification:
- [ ] A staged commit fires the husky/lint-staged 17 chain (lint-staged 17 keeps the package.json key and the `.husky/pre-commit` `npx lint-staged` line — no config migration)
- [ ] One final clean checkout passes `npm test` with no `captures/` regrowth
- [ ] `npm run format` re-indents `watcher.config.json` 3-space → 2-space; `npm test` stays green after
- [ ] Operator: `git worktree prune` on the main clone (F011); `git count-objects` no longer warns "garbage found"
- [ ] The watch job's first post-merge run installs playwright 1.65.1 (one cache miss — `watch.yml:179` hashes `package-lock.json`) and stays green

---

## Testing Strategy

### Automated:
- The project's three standing gates at every phase boundary (run6 gated-slice doctrine, D2): `npm run typecheck`, `npm run lint`, `npm test` — each phase's Success Criteria encode them.
- Phase 2 adds `npm run knip` (the facade deletions + F014 re-export are the knip-sensitive edits — exit 0 required).
- Phases 3-4 add `npm run cycles` and `npm audit --omit=dev` to the gate set; Phase 4 adds `npm ci` (lockfile drift).
- The committed `npm run cycles` script exits 0 on the type-only graph — verified locally BEFORE the ci.yml step merges (the amended F003 criterion; D12 measured at design time, be5407a: without `.madgerc` madge 8.0.0 exits 1 on the 9 type-only cycles, with it exit 0).

### Manual Testing Steps:
1. Two clean-checkout `npm test` runs after `captures/` deletion (Phase 1), one more after Phase 4.
2. `grep -rn "run #7" src/` — exactly two hits today (`src/judge.ts:31`, `src/linkedin-fetch.ts:53`); must be empty after Phase 2.
3. F005 passes offline and is corrected live (precedent `7cc7250` one day after `73d6786`): the next live dispatch is the validator; ceiling changes in the next state commit are expected, not a regression.
4. A staged commit fires the husky/lint-staged 17 chain after the bump (Phase 4).
5. New CI gates may break on first land (precedent `42b8cf8`, `510ff2a`): budget a same-day fix window.
6. Majors churn (biome 2 migration, TS 7 under the strict quartet): the FRD's "an afternoon" budget.
7. `assertNoFreshCaptures` message edge (recorded, Phase 1 locked): an EMPTY `captures/` directory at the repo root fails with "0 session dir(s)" and an empty report — equivalent in effect to the old ENOENT assert, but the message reads as a bug. An empty captures/ is operator-created scratch, not a test leak.
8. Injection census re-measured at be5407a: 18 `fetchTick` call sites in `tests/fetch-linkedin.test.ts` (5 already inject at :422, :546, :577, :601, :886 — 13 need the injection) and 7 `runProbe` call sites in `tests/probe-linkedin.test.ts` (2 already inject at :275, :308 — 5 need it). Total injections: 18, not the research doc's 25 (which double-counted the 7 already-injected blocks).

## Performance Considerations

- The probe's ramp is unchanged (worst case 62 calls per account); the envelope gate adds one `JSON.parse` per leg — negligible.
- `NOOP_CAPTURE_SINK` is a synchronous no-op closure: it removes the void'd-sink-promise teardown race (`tests/linkedin-fetch.test.ts:1300` documents the class) rather than narrowing it.
- Phase 4's lockfile rewrite costs one playwright cache miss + one 30-60s browser reinstall on the watch job (`watch.yml:179`) — bounded, accepted.

## Migration Notes

- `captures/` is gitignored scratch: deletion is an operator `rm -rf captures/`, never a commit. Two leaked session dirs exist today (`captures/20261115T021815Z/`, `captures/20261115T022011Z/`).
- `biome.json` migrates from the 1.x schema to 2.x (schema pin, `files.ignore` → includes); `watcher.config.json` re-indents 3-space → 2-space (JSON.parse is whitespace-blind — invisible to `loadWatcherConfig`).
- No committed state file changes shape in this pass.

## Developer Context

- Step 5 triage: all 10 findings applied (see Plan Review resolutions). Row 6 (RequestInfo) is a plan-local fix — the design artifact's probe-judge.test.ts fence still carries `RequestInfo | URL`; patch it there if the design is ever re-consumed.
- Step 4 coverage review first dispatch failed on a provider rate limit (429); the retry completed clean with 0 findings.

## References

- Design: `.rpiv/artifacts/designs/2026-11-15_10-59-08_tech-debt-ledger-zero-landing.md`
- Landing-shape analysis: `.rpiv/artifacts/solutions/2026-11-15_10-27-02_tech-debt-ledger-zero-landing.md`
- Research (finding census + locked per-finding decisions): `.rpiv/artifacts/research/2026-11-15_09-54-32_tech-debt-ledger-zero.md`
- FRD: `.rpiv/artifacts/discover/2026-11-15_09-31-23_tech-debt-zero.md`
- Ledger: `TECH_DEBT_AUDIT.md`
- Gated-slice doctrine + run5 counter-example: `plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md`
- Per-phase local gating precedent: `.rpiv/artifacts/validation/2026-11-14_08-15-48_tech-debt-run6-remediation.md`
- Doctrine layers: `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/tests/architecture.md`, `.rpiv/guidance/scripts/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md`

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5. Coverage note: the first coverage dispatch failed on a provider rate limit (429); the retry completed clean. Span and type claims re-verified against HEAD before triage._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| ------ | -------- | ------------ | -------- | --------- | ------- | -------------- | ---------- |
| code | Phase 1 §2 (capture-oracle.ts) | <n/a> | blocker | actionability | The NEW-file fence's template literals are brace-corrupted — the plan has ${{session} / ${{files.length} / ${{report.length} where the design fence (the 1:1 source) has single braces; applied verbatim this is a TS syntax error, so the Phase 1 typecheck gate fails | Replace both lines verbatim from the design artifact's capture-oracle fence (single-brace interpolations) | applied: single-brace interpolations restored from the design fence |
| code | Phase 1 §6 Hunk A (fetch-linkedin.ts) | scripts/fetch-linkedin.ts:99 | blocker | actionability | The span ":100-107" excludes the `/**` opener at :99 and the field line at :108 (verified live), and the fence carries no WAS block — a span-literal replace leaves the stale opener and duplicates the `captureSink` field → duplicate-identifier compile error at the Phase 1 gate | Re-cite the span as :99-108 and add the verbatim WAS JSDoc block to the fence | applied: span re-cited :99-108; WAS JSDoc block added to Hunk A |
| code | Phase 2 §3 (judge-rotation.ts) | src/judge-rotation.ts:60 | blocker | actionability | The span ":62-66" starts mid-comment (the block's `/**` is at :60, verified live) — span-literal replacement leaves a dangling `/**` plus duplicated comment text → unterminated-comment compile failure | Re-cite the WAS span as :60-66 | applied: WAS span re-cited :60-66 |
| code | Phase 2 §5 Hunk B (probe-judge.ts) | scripts/probe-judge.ts:49 | blocker | actionability | The delete span ":47-50" actually covers the Post import (:47) plus a blank line (:48); the quoted 2-line config read sits at :49-50 (verified live) — span-literal deletion removes the Post import still used by `syntheticPost` → TS2304 at the Phase 2 gate | Re-cite the delete span as :49-50 | applied: delete span re-cited :49-50 |
| code | Phase 2 §5 Hunks C-D (probe-judge.ts) | scripts/probe-judge.ts:107 | blocker | actionability | Both hunks' template literals are brace-corrupted — WAS `await fetch(${{account...` and `probe: ${{label}...` do not byte-match the live single-brace lines (:107, :122-125), and the NOW lines are invalid TS | Take the WAS/NOW lines verbatim from the design artifact's probe-judge fence (single-brace interpolations) | applied: single-brace interpolations restored from the design fence |
| code | Phase 2 §6 (probe-judge.test.ts) | tsconfig.json:6 | blocker | actionability | The fetch double annotates `(input: RequestInfo \| URL)` but `RequestInfo` is not a global under `"lib": ["ES2023"]` + `"types": ["node"]` — it is only exported by undici-types and no repo file uses it → TS2304 in the new suite at the Phase 2 gate | Follow the repo's double idiom behind the existing `as unknown as typeof fetch` cast: annotate `(input: string \| URL)` — the double only ever receives URL strings | applied (plan-local; design follow-up: patch the design's probe-judge.test.ts fence to the same annotation if re-consumed) |
| code | Phase 3 §4 (watch.yml) | .github/workflows/watch.yml:69 | blocker | actionability | The fence writes tripled braces — WAS `[ "${{{ inputs.force }}"` does not match the live two-brace line at :69, and NOW `FORCE: ${{{ inputs.force }}` is an invalid Actions expression that breaks the workflow on first dispatch | Apply the design fence's two-brace form (`FORCE: ${{ inputs.force }}`, `[ "$FORCE" = "true" ]`) | applied: two-brace Actions form restored (env mapping, run body, and comment) |
| code | Phase 3 (Success Criteria) | .github/workflows/watch.yml:69 | blocker | actionability | The criterion grep pattern `'${{{ inputs.force }}'` can never match the design-correct file, which contains exactly one two-brace interpolation → the slice fails its own verification when implemented correctly | Re-cite the criterion's grep pattern as `${{ inputs.force }}` | applied: criterion pattern re-cited to the two-brace interpolation |
| code | Phase 2 §2 Hunk C (linkedin-fetch.ts) | src/linkedin-fetch.ts:73 | concern | actionability | The F014 type import exists only in the hunk's prose ("add the type import after the pool.js import"); the fenced NOW `export type { SleepFn };` references an unimported name — a fence-literal implementer leaves TS2304 | Add the explicit line `import { type SleepFn } from "./sleep.js";` to the fence, between the pool.js and types.js imports | applied: literal import line added to Hunk C's fence |
| code | Phase 1 §10 | <n/a> | suggestion | code-quality | The prose says the Phase 1 table carries "the three standing rows" but the fenced table holds only two (F002, F016), and the parenthetical explicitly defers F011 to Phase 4 | Reword to "plus the two standing rows (F002, F016)" | applied: prose reworded to two standing rows |

_Coverage review: **0 findings** — all 12 design `## Verification Notes` entries and all 53 `## Slices` verification bullets (Slice 1: 7A+3M, Slice 2: 12A+3M, Slice 3: 11A+4M, Slice 4: 8A+5M) land in the plan: 53/53 criteria bullets verbatim 1:1, every VN entry in a phase criterion, a Testing Strategy line, or phase prose/fence._
