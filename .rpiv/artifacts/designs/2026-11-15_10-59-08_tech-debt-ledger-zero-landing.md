---
date: 2026-11-15T10:59:08+0700
author: Yogiswara Utama
commit: be5407a
branch: ukind/feature-auto-login-threads
repository: feature-auto-login-threads
topic: "Tech-debt ledger zero — landing (run #7)"
tags: [design, tech-debt, capture-sink, facades, ci, judge, linkedin-leg, tooling-majors]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-15_10-27-02_tech-debt-ledger-zero-landing.md
last_updated: 2026-11-15T10:59:08+0700
last_updated_by: Yogiswara Utama
---

# Design: Tech-debt ledger zero — landing (run #7)

## Summary

Land all 15 actionable findings of `TECH_DEBT_AUDIT.md` as four gated commits on this branch (single phased PR — the repo's only merged landing shape). Slice 1 closes the capture-sink leak through a shared oracle helper and deletes `captures/`; Slice 2 removes both run-#7 facades atomically with the 10-site re-point, transplants the envelope gate into the probe, and lands the smalls; Slice 3 adds the madge + audit CI gates and the format/env hygiene; Slice 4 bumps the dev-tool majors last, policed by the frozen gates, and zeroes the ledger. Every interlock maps 1:1 onto a slice boundary.

## Requirements

- Land all 15 actionable findings with the six interlocks intact (knip atomicity, lockfile ordering, captures-deletion ordering, the F014 re-export consumer, F005's live validator, majors-last cache economics).
- Gate-green at every slice boundary: `npm run typecheck`, `npm run lint`, `npm test` (run6 gated-slice doctrine, developer-confirmed).
- F007 majors land LAST, policed by the gates frozen in Slice 3.
- `TECH_DEBT_AUDIT.md` reads zero at the end (F002 recorded deferred, F016 as-is); ledger marks land per phase (developer-confirmed).
- `grep -rn "run #7" src/` empty; `npm run knip` exit 0; the committed madge script exits 0 on the type-only graph; two clean-checkout `npm test` runs pass with no `captures/` regrowth; a staged commit fires lint-staged 17.

## Current State Analysis

### Key Discoveries

- **The capture leak seam** (F001): `scripts/fetch-linkedin.ts:438` and `scripts/probe-linkedin.ts:183` resolve `captureSink: deps.captureSink ?? makeFsCaptureSink()`. The `??` makes an undefined override re-create the production sink, so `tests/fetch-linkedin.test.ts:1036` (the seen-stop case, 3-card body, no sink) writes `captures/<stamp>/001-hiring-react.json` on every run. The three hand-rolled oracles (`tests/fetch-linkedin.test.ts:63-76`, `tests/probe-linkedin.test.ts:54-67`, `tests/linkedin-fetch.test.ts:1318-1328`) snapshot `captures/` at module load and skip forever once it exists — that is why repeat runs went green.
- **NEW discovery (beyond the research doc)**: the two `??` defaults are not the only production seams. Four more pass NO sink and would silently lose capture when the defaults are removed: `scripts/watch-linkedin.ts:50` (`fetchTick({ env })`), `scripts/linkedin-chain.ts:86-87` (`runProbe({ env })` + `fetchTick({ env })`), and the two CLI entries (`scripts/fetch-linkedin.ts:487`, `scripts/probe-linkedin.ts:199`). Developer decision: fix all six seams — every production caller passes `makeFsCaptureSink()` explicitly; tests inject `NOOP_CAPTURE_SINK`.
- **The facades** (F006): `src/judge.ts:25-36` (2 symbols, 3 importers) and `src/linkedin-fetch.ts:46-68` (8 symbols, 7 importers). 6 of the 10 real sites are MIXED imports (facade + permanent symbol on one specifier) — each edit is a split, not a swap. The phantom eighth linkedin importer (`src/index.ts:52` imports `LinkedinSurface`, a local export at :70) stays. The five type-only `LlmAccount` importers stay (the type is declared in judge.ts:70-74; the back-edge comment at `src/judge-dispatch.ts:49-52` pins it there).
- **F014**: the duplicate `SleepFn` at `src/linkedin-fetch.ts:72-73` becomes `export type { SleepFn } from "./sleep.js"` (canonical `src/sleep.ts:17`). `scripts/watch-linkedin.ts:20` is the re-export's only external consumer and SPLITS: `isLegDead` re-points to `linkedin-context.js`, `type SleepFn` stays on `linkedin-fetch.js`. Re-pointing SleepFn to sleep.js would orphan the re-export and redden knip.
- **F005**: `scripts/probe-judge.ts:122` — `const ok = body.includes("{")` — counts any 2xx with a brace as a good leg. The fix transplants the availability pre-check's envelope gate (`src/judge-availability.ts:138-146`). The replay test needs the CLI importable: today a bare `await main()` at :340 launches the whole probe on import. Developer-approved seam: entry guard + `timed` exported with an injectable fetch defaulting to global fetch; `CONFIG` (module-level `await loadWatcherConfig()` at :47) moves into `main()`.
- **F004**: `HEALTH_CAP_STREAK = 2` (`src/judge-rotation.ts:66`, unexported) and `HARD_FAIL_TICKS_TO_CAP = 2` (`src/judge-health.ts:47`, exported) must stay equal; only a one-sided pin exists (`tests/judge-rotation.test.ts:909`). Fix: export + equality test in `tests/judge-health.test.ts`.
- **F003**: 9 madge cycles, all closing through type-only imports erased by `verbatimModuleSyntax` (`tsconfig.json:11`). Stock `npx madge --circular` exits non-zero on them, so the FRD's literal criterion is unachievable; developer decision: devDependency + `npm run cycles` script, exact invocation verified locally BEFORE the YAML merges.
- **F012**: `format` (`package.json:15`) covers 9 targets; `lint` (:13) covers 11. Delta: `scripts/probe-judge.ts`, `scripts/hooks`, `watcher.config.json` (3-space indent — the repo's only style violation). All three join format; `watcher.config.json` deliberately does NOT join lint.
- **F010**: `.github/workflows/watch.yml:69` interpolates `${{ inputs.force }}` into the gate bash. Safe today (typed boolean); fix = step-level `env: FORCE` + `[ "$FORCE" = "true" ]`.
- **F007**: lockfile-resolved today — TS 5.9.3, biome 1.9.4, knip 5.88.1, lint-staged 15.5.2, @types/node 22.20.5. Targets: TS 7.0, biome 2.6.7, knip 6.45.1, lint-staged 17.6.0, @types/node 26.6.6; minors playwright 1.65.1, nodemailer 10.5.0. `biome.json` is a 1.x-format file (schema pin :2, `files.ignore` :3-11) — the 2.x migration is inside the afternoon budget.

## Scope

### Building

- Slice 1: `NOOP_CAPTURE_SINK` export; `tests/capture-oracle.ts`; six production seams pass the fs sink explicitly; 18 test blocks inject the no-op (13 fetchTick + 5 runProbe — re-measured at be5407a; the research doc's 25 double-counted the 7 already-injected blocks); three oracles re-point to the helper; `captures/` deletion (operator `rm`); two clean-checkout `npm test` runs.
- Slice 2: both facade deletions + 10-site re-point (atomic); SleepFn re-export + watch-linkedin split; `HEALTH_CAP_STREAK` export + equality test; probe envelope gate + entry guard + injectable fetch + replay tests; F008 comment rewrite; F009 README PC-path docs.
- Slice 3: madge devDependency + `.madgerc` (the `skipTypeImports` seam) + `npm run cycles` + ci.yml step (invocation measured locally first: exit 1 → exit 0, 2026-11-16); `npm audit --omit=dev` non-blocking step; watch.yml env-indirect FORCE; format list extension.
- Slice 4: dev-tool majors + two minors; biome.json 2.x migration; staged-commit lint-staged 17 check; final ledger marks (F002 deferred, F016 as-is); one final clean-checkout `npm test`.

### Not Building

- Multi-PR / stacked-PR landing (rejected: 0-of-5 precedent; two broken interlocks).
- F002 (deferred by developer — the alarm keeps citing the missing DOCUMENTATION.md sections).
- F016 (leave as-is, recorded).
- Re-opening any of the ~19 locked per-finding decisions.
- Per-account freshness windows; moving seen-state out of git (N043 policy stands).
- Any behavior change beyond F005's leg classification.

## Decisions

### D1 — Landing shape: single phased PR
**Ambiguity**: single phased PR vs risk-tiered PRs vs module-vertical slices.
**Explored**: Option 1 (single phased PR) — the only shape with a merged track record (run4, audit-run1, run6); every interlock maps onto a commit boundary. Option 2 (risk-tiered) — novel granularity (0/5), ~4x CI round-trips, F009 unassigned as named. Option 3 (module slices) — two broken interlocks (ci.yml F013/F003 double-touch inverts the madge-then-audit wiring; the only red gate's fix lands second, so 2 of 3 units run green-blind).
**Decision**: Option 1. Evidence: `.rpiv/artifacts/solutions/2026-11-15_10-27-02_tech-debt-ledger-zero-landing.md` (Comparison table); run5 (`f1812b4`) never merged — the recorded counter-example.

### D2 — Gated-slice doctrine
**Decision**: every slice green under typecheck, lint, test at its own commit boundary (developer-confirmed). Evidence: `plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md:29`.

### D3 — F001: undefined sink = capture disabled; six explicit production seams
**Ambiguity**: research scoped F001 to the two `??` defaults + 25 test injections. Live re-read found four more production seams passing no sink (watch-linkedin, chain, both CLI entries) — removing the defaults would silently kill loop/chain capture.
**Explored**: (A) fix all six seams — loop/chain/CLI keep capture ON, tests inject the no-op; (B) fix only the two defaults — loop and chain capture nothing after landing; (C) default inside fetchTick/runProbe — re-arms the exact leak (contradicts `scripts/fetch-linkedin.ts:100-107`'s doc: "Passing nothing means CAPTURE TO DISK, not capture disabled").
**Decision**: A — fix all six seams (developer-confirmed).

### D4 — F006: facade deletion atomic with the 10-site re-point
**Decision**: one commit deletes both blocks and re-points all 10 sites (6 splits, 4 swaps). Re-point without deleting = zero-importer exports (knip red); delete without re-pointing = TS2305. Evidence: `src/judge.ts:25-36`, `src/linkedin-fetch.ts:46-68`; importer census in the research doc's Code References. (Census corrected at Slice 2 verification: the measured split/swap counts at be5407a are 8 mixed-import splits + 2 pure swaps — the action is unchanged, code is source of truth.)

### D5 — F014: re-export keeps its consumer
**Decision**: `export type { SleepFn } from "./sleep.js"` replaces the local declaration; `scripts/watch-linkedin.ts:20` splits (`isLegDead` → `linkedin-context.js`, `type SleepFn` stays on `linkedin-fetch.js`). Re-pointing SleepFn to sleep.js orphans the re-export and reddens knip.

### D6 — F005: envelope gate + entry guard + injectable fetch
**Decision**: transplant `src/judge-availability.ts:138-146`'s gate into `timed()`; entry-guard the CLI (`process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href` — the four-script idiom); export `timed` with an injectable fetch defaulting to global fetch; move `CONFIG` into `main()`. Developer-approved (research Developer Context).

### D7 — F003: madge as devDependency + npm script, verified before the YAML
**Decision**: `npm run cycles` script; the exact invocation that exits 0 on the type-only graph is verified locally BEFORE the ci.yml step merges; the acceptance criterion is amended to "the committed npm script exits 0". Evidence: knip precedent (`f50067d`: "the lockfile is the pin; the CI step runs npm run knip, never npx knip").

### D8 — F008: measured-evidence comment idiom
**Decision**: rewrite `src/judge-dispatch.ts:56-62` in the `WAIT_BUDGET_MS` form (`src/judge.ts:52-66`): value + run 40264368939 + measured fact, no open questions (developer-confirmed).

### D9 — F012: format list extension, lint asymmetry preserved
**Decision**: append `scripts/probe-judge.ts`, `scripts/hooks`, `watcher.config.json` to the format value; `watcher.config.json` does NOT join lint (deliberate — CI never checks it).

### D10 — F007: majors last, lockfile commit precedes
**Decision**: the madge devDependency + regenerated lockfile land in Slice 3; the majors bump lands in Slice 4 policed by the frozen gates. `npm ci` (ci.yml:24) hard-fails on drift, so the ordering is load-bearing.

### D11 — Ledger marks per phase
**Decision**: each slice's commit marks its own findings resolved in `TECH_DEBT_AUDIT.md` (developer-confirmed) — the ledger is truthful at every boundary.

### D12 — F003 mechanism: the `.madgerc` skipTypeImports seam (measured, 2026-11-16)
**Ambiguity**: how does the committed script exit 0 when stock madge exits 1 on the 9 type-only cycles?
**Explored**: the CLI has no flag for it (`--help` audited, v8.0.0). Measured: a root `.madgerc` with `detectiveOptions.ts.skipTypeImports: true` flips the same invocation from exit 1 (9 cycles) to exit 0 — the rc file is the only seam. Rejected alternatives: an output-filtering pipe (cannot distinguish a NEW runtime cycle's line from the type-only ones), a wrapper script (a new lintable surface for a 6-line config), inline `node -e` (knip cannot see the madge binary → knip red).
**Decision**: `.madgerc` (NEW, repo root) + `"madge": "^8.0.0"` + `"cycles": "madge --circular --extensions ts src"`. The write-once rc file stays out of lint/format lists. Verified before the ci.yml content merged (D7's own rule); the amendment (Slice 3 Files gains `.madgerc`) ratified at the 6.3 checkpoint.

## Architecture

### src/linkedin-capture.ts — MODIFY

Adds the no-op sink the offline suites inject (F001). Insert directly after the CaptureSink type:

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

### tests/capture-oracle.ts — NEW

The shared absence-oracle (F015): one snapshot + one assert for the three walk-driving suites.

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

### tests/fetch-linkedin.test.ts — MODIFY

Merged fence (Slice 1 + Slice 2): the capture doctrine (F001/F015) and the :35 facade swap (F006) in one fence. Hunk A carries the ratified Slice 1 amendment — the merged capture import wraps (101 cols single-line fails biome).

```ts
Hunk A — imports (Slice 1 hunks + the :35 swap):

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

WAS (:35):
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

### tests/probe-linkedin.test.ts — MODIFY

Merged fence (Slice 1 + Slice 2): the capture doctrine (F001/F015) and the :29-35 facade split (F006). Hunk A carries the ratified Slice 1 amendment — the wrapped capture import also lands the NOOP_CAPTURE_SINK symbol Hunk D's five injections use.

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
ADD at the end of the import block:
import { assertNoFreshCaptures } from "./capture-oracle.js";

Hunk B — DELETE lines :52-58 (the local snapshot block, closing ); included):

# The capture doctrine's absence-oracle snapshot (design 2026-11-13):
# taken at module load, before any test runs.
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

### tests/linkedin-fetch.test.ts — MODIFY

Merged fence (Slice 1 + Slice 2): the oracle re-point (F015) and the :32-45 facade split (F006) in one fence — the path join dies with the oracle, so the whole node:path import goes.

```ts
Hunk A — imports:

DELETE the whole line: import { access } from "node:fs/promises";
DELETE the whole line: import { dirname, join } from "node:path";
DELETE the whole line: import { fileURLToPath } from "node:url";
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

### scripts/fetch-linkedin.ts — MODIFY

Merged fence (Slice 1 + Slice 2): the capture-sink seam fix (F001) and the facade import split (F006) land in one fence — implement applies both.

```ts
Hunk A — FetchTickDeps.captureSink JSDoc (:100-107), replace:

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

Hunk D — the facade import split (:41-49); the FOUR facade symbols move to
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

### scripts/probe-linkedin.ts — MODIFY

Merged fence (Slice 1 + Slice 2): the capture-sink seam fix (F001) and the facade import split (F006) — same shape as scripts/fetch-linkedin.ts.

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

Hunk D — the facade import split (:37-45), identical shape to
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

### scripts/watch-linkedin.ts — MODIFY

Merged fence (Slice 1 + Slice 2): the loop's default tick gains the explicit fs sink (F001) and the F014/F006 import split lands in the same block.

```ts
Hunk A — the import block (:17-21) becomes (biome byte order: env-file <
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

Hunk B — the default tick (:50), the loop keeps capture:

WAS:
  const tick = deps.tick ?? (() => fetchTick({ env }));
NOW:
  const tick = deps.tick ?? (() => fetchTick({ env, captureSink: makeFsCaptureSink() }));
```

### scripts/linkedin-chain.ts — MODIFY

Both stage defaults gain the explicit fs sink (F001, seam 6 of six).

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

### src/judge.ts — MODIFY

Deletes the N042a re-export facade (F006, run #7) atomically with the 10-site re-point below — its three importers move in this same slice.

```ts
DELETE lines :25-36 — the facade comment block and both re-exports, verbatim:

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

The module's own import of judgeBatch + judgePost from "./judge-dispatch.js"
STAYS — judgePost remains in internal use in the fallback pool. No other
change: parseLlmAccounts, resolveJudgeConfig, judgePosts, and LlmAccount
keep their real exports (knip consumes them from src/index.ts, the two
suites, and scripts/probe-judge.ts).
```

### src/linkedin-fetch.ts — MODIFY

Deletes the N042b facade (F006) atomically with the re-point, drops the orphaned internal import, and re-exports SleepFn from sleep.ts (F014).

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

Hunk C — F014: add the type import after the pool.js import (biome order:
pool.js < sleep.js < types.js), and REPLACE the local declaration (:72-73):

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

### src/judge-rotation.ts — MODIFY

Exports the paired cap constant so the equality test can pin it (F004).

```ts
WAS (:62-66):
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

### tests/judge-health.test.ts — MODIFY

The equality test pins the paired cap constants (F004) — the zero-import boundary keeps two copies; this test is the drift guard.

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

### scripts/probe-judge.ts — MODIFY

F005 (D6): the leg classifier gains the availability gate's envelope check; the CLI becomes importable (entry guard + injectable fetch + CONFIG into main) so the replay suite can drive it offline.

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

Hunk B — DELETE the module-level config read (:47-50, comment included):

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

### tests/probe-judge.test.ts — NEW

The F005 replay suite. The bare import IS the entry-guard pin: importing the module must not read the config, resolve accounts, or fire a live call.

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
  const fetchFn = (async (input: RequestInfo | URL) => {
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

### tests/judge.test.ts — MODIFY

Re-points the facade import block (:8-15): judgePost to judge-dispatch.js, buildBulkMessages to judge-prompts.js; the rest stays on judge.js (F006).

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

### tests/judge-rotation.test.ts — MODIFY

Splits the mixed facade import (:22) and inserts the dispatch import ahead of the rotation block (F006).

```ts
Hunk A — insert BEFORE the :9-21 judge-rotation.js block:

import { judgePost } from "../src/judge-dispatch.js";

Hunk B — the mixed import (:22) splits:

WAS:
import { type LlmAccount, judgePost, judgePosts } from "../src/judge.js";
NOW:
import { type LlmAccount, judgePosts } from "../src/judge.js";
```

### tests/watch-linkedin.test.ts — MODIFY

Re-points legDead to its canonical home (F006).

```ts
WAS (:16):
import { legDead } from "../src/linkedin-fetch.js";
NOW:
import { legDead } from "../src/linkedin-context.js";
```

### src/judge-dispatch.ts — MODIFY

Rewrites the REQUEST_TIMEOUT_MS comment in the measured-evidence idiom (F008, D8) — value + run id + measured facts, no open questions.

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

### README.md — MODIFY

Documents the two machine-default PC paths and their env overrides in the PC-leg section (F009) — they lived in code comments only.

```md
In "## The LinkedIn leg on your PC (browser walk)", insert after the "Env
setup note:" paragraph:

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

### .madgerc — NEW

madge's rc config (cwd lookup): the ONLY seam to detectiveOptions — the madge
CLI (checked via --help, v8.0.0) exposes no flag for it. Write-once config; it
does NOT join lint or format lists (watcher.config.json's F012 treatment is for
human-edited JSON; this file is never edited by hand again).

```json
{
  "detectiveOptions": {
    "ts": {
      "skipTypeImports": true
    }
  }
}
```

File Map amendment (the decomposition amendment's third leg — the ## Slices
Files line and this Architecture entry are the first two): insert into ## File
Map, before the package.json line:

```
.madgerc                        # NEW — madge rc: skipTypeImports for the cycles gate (F003)
```

### package.json — MODIFY

Merged fence (Slice 3 + Slice 4): the cycles gate cluster and the format extension (F003/F012) plus the dev-tool majors and the two runtime minors (F007, landed last per D10).

```
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

Hunk C — devDependencies, majors in their alphabetical positions (Slice 4
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

Hunk D — dependencies, the two runtime minors (the audit's npm outdated
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

(The lockfile regenerates with the Slice 3 install and again here — D10:
the madge commit precedes the majors and npm ci hard-fails on drift, so
the ordering is load-bearing. knip resolves madge through the cycles npm
script's binary; knip 6 needs Node >= 20.19 — engines' >=22 satisfies it.
knip 6's breaking changes are CLI/reporter-level — this repo has no knip
config file, and none is needed. lint-staged 17 keeps the package.json
key and the .husky/pre-commit `npx lint-staged` line; the staged-commit
check is the criterion.)
```

### .github/workflows/ci.yml — MODIFY

One hunk — two new gate steps after the Unused exports step:

```
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

### .github/workflows/watch.yml — MODIFY

One hunk — the Freshness gate step gains a step-scoped env; the run body swaps
the interpolation for the variable (F010). The comment block and the rest of
the body are unchanged:

```
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

### biome.json — MODIFY

The 2.x migration (F007), grounded in the 2.x configuration reference
(biomejs.dev, fetched 2026-11-16): the 1.x hard `files.ignore` maps to
`files.includes` with `!!` force-exclude negations — excluded from all
operations including indexing, the faithful equivalent (a single `!`
keeps the paths indexed for the type-aware rules this repo does not
enable). `node_modules` is always ignored in 2.x; its row stays only for
parity with the 1.x list. Dot-dirs are not auto-ignored without vcs
integration, so the four dot entries stay explicit. `organizeImports`
moves under `assist.actions.source`. The formatter/linter/javascript
blocks keep their 1.x values byte-identical. `recommended: true` stays
valid in 2.x — if 2.6.7 emits a deprecation error, the equivalent is
`"rules": { "preset": "recommended" }` (the gates arbitrate).
`npx biome migrate --write` produces this same shape; implement may run
it and diff against this fence.

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

### TECH_DEBT_AUDIT.md — MODIFY

Per-phase ledger marks (D11) — the Resolution table's final state: all 16 findings marked (the Slice 4 approve flipped the last PENDING row; F002 stays DEFERRED, F016 stays AS-IS).

```md
Insert after the Executive summary bullet list, before '## Architectural mental model':

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
| F007 | RESOLVED — Slice 4 | dev-tool majors + the two runtime minors landed last, policed by the frozen gates (typecheck → lint → test → knip → cycles → audit); `biome.json` migrated to the 2.x schema |
| F011 | OPERATOR | `git worktree prune` on the main clone — one operator command, not a code change; the N043 policy stands |
```

## Slices

### Slice 1: capture sinks + shared oracle

**Files**: `src/linkedin-capture.ts`, `tests/capture-oracle.ts`, `tests/fetch-linkedin.test.ts`, `tests/probe-linkedin.test.ts`, `tests/linkedin-fetch.test.ts`, `scripts/fetch-linkedin.ts`, `scripts/probe-linkedin.ts`, `scripts/watch-linkedin.ts`, `scripts/linkedin-chain.ts`, `TECH_DEBT_AUDIT.md`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] `grep -c "captureSink:" tests/fetch-linkedin.test.ts` returns 18; `grep -c "captureSink:" tests/probe-linkedin.test.ts` returns 7
- [ ] `grep -rn "?? makeFsCaptureSink" scripts/` returns nothing
- [ ] `grep -c "makeFsCaptureSink()" scripts/fetch-linkedin.ts scripts/probe-linkedin.ts scripts/watch-linkedin.ts scripts/linkedin-chain.ts` — each file has >= 1 non-import occurrence
- [ ] `grep -rn "repoCapturesBefore" tests/*.test.ts` returns nothing (the shared helper keeps its own snapshot)

#### Manual Verification:
- [ ] Operator: `rm -rf captures/` (gitignored scratch — never a git operation; run AFTER the slice commit is staged)
- [ ] Two clean checkouts each pass `npm test` with no captures/ regrowth
- [ ] An intentionally sink-less scratch case fails the oracle naming the leaked session dir and its files

### Slice 2: smalls + probe fix + facades

**Files**: `src/judge.ts`, `src/linkedin-fetch.ts`, `src/judge-rotation.ts`, `tests/judge-health.test.ts`, `scripts/probe-judge.ts`, `tests/probe-judge.test.ts`, `src/judge-dispatch.ts`, `tests/judge.test.ts`, `tests/judge-rotation.test.ts`, `tests/watch-linkedin.test.ts`, `scripts/fetch-linkedin.ts`, `scripts/probe-linkedin.ts`, `scripts/watch-linkedin.ts`, `tests/fetch-linkedin.test.ts`, `tests/probe-linkedin.test.ts`, `tests/linkedin-fetch.test.ts`, `README.md`, `TECH_DEBT_AUDIT.md`

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] Knip passes: `npm run knip`
- [ ] `grep -rn "run #7" src/` returns nothing
- [ ] `grep -rn "re-export facade" src/` returns nothing
- [ ] `grep -n "SCROLL_JS" src/linkedin-fetch.ts` returns nothing
- [ ] `grep -n "export type { SleepFn }" src/linkedin-fetch.ts` returns exactly 1 hit
- [ ] `grep -n "export const HEALTH_CAP_STREAK" src/judge-rotation.ts` returns 1 hit
- [ ] `grep -n "HEALTH_CAP_STREAK" tests/judge-health.test.ts` returns at least 1 hit
- [ ] `grep -c "includes(\"{\")" scripts/probe-judge.ts` returns 0
- [ ] `grep -rn "linkedin-fetch.js" tests/watch-linkedin.test.ts` returns nothing

#### Manual Verification:
- [ ] Two consecutive `npm test` runs stay green with no `captures/` regrowth (the Slice 1 oracle holds after the import churn)
- [ ] The next live dispatch after merge classifies 2xx error envelopes as failed legs; ceiling changes in the next state commit are expected (F005 live validation, precedent `7cc7250`)
- [ ] README's PC-path table matches the two code literals (`LINKEDIN_PROFILE_DIR`, `DEFAULT_COOKIE_PATH` in `scripts/login-linkedin.ts`)

### Slice 3: CI additions

**Files**: `package.json`, `.madgerc` (NEW), `.github/workflows/ci.yml`, `.github/workflows/watch.yml`, `TECH_DEBT_AUDIT.md` (+ the artifact's own File Map gains the `.madgerc` line)

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] Knip passes with the new devDependency: `npm run knip`
- [ ] The committed cycles script exits 0 on the type-only graph: `npm run cycles`
- [ ] Audit baseline holds: `npm audit --omit=dev` exits 0 ("found 0 vulnerabilities")
- [ ] The audit step is non-blocking: `grep -c "continue-on-error" .github/workflows/ci.yml` returns 1
- [ ] One interpolation left, and it is the env mapping: `grep -n '${{ inputs.force }}' .github/workflows/watch.yml` returns exactly 1 hit — the step `env:` line; the gate's `run:` body reads `$FORCE` (the :47 doc comment "inputs.force re-probes immediately" is prose, not code)
- [ ] Format/lint asymmetry preserved (D9): `grep -c "watcher.config.json" package.json` returns 1 (format only, never lint); `grep -c "scripts/hooks" package.json` returns 2 (both lists)
- [ ] The cycles gate is pinned to the lockfile: `grep -n "npx madge" .github/workflows/ci.yml package.json` returns nothing
- [ ] The artifact's File Map carries the amendment: the File Map section contains exactly one `.madgerc` line

#### Manual Verification:
- [ ] D7 evidence stands on this checkout: without `.madgerc`, `npx madge@8.0.0 --circular --extensions ts src` exits 1 listing the 9 type-only cycles; with it, exit 0 (measured 2026-11-16)
- [ ] A scratch runtime back-edge (a plain `import` added between two judge modules in a scratch copy) reddens `npm run cycles` — the gate catches real cycles, not only today's type-only ones
- [ ] A manual dispatch of watch.yml with force=true still bypasses the freshness window
- [ ] `npm run format` re-indents `watcher.config.json` 3-space → 2-space; `npm test` stays green after (JSON.parse is whitespace-blind)

### Slice 4: majors last + ledger zero

**Files**: `package.json`, `biome.json`, `TECH_DEBT_AUDIT.md`

#### Automated Verification:
- [ ] Gates green on the bumped toolchain, in order: `npm run typecheck`, `npm run lint`, `npm test`, `npm run knip`, `npm run cycles`, `npm audit --omit=dev`
- [ ] The lockfile is regenerated and drift-free: `npm ci` exits 0
- [ ] The majors landed: `grep -n '"@biomejs/biome": "^2.6.7"\|"@types/node": "^26.6.6"\|"knip": "^6.45.1"\|"lint-staged": "^17.6.0"\|"typescript": "^7.0.2"' package.json` returns 5 hits; the minors: `grep -n '"playwright": "^1.65.1"\|"nodemailer": "^10.5.0"' package.json` returns 2 hits; `"madge": "^8.0.0"` keeps its alphabetical slot
- [ ] biome.json carries the 2.x schema: `grep -c "schemas/2.6.7/schema.json" biome.json` returns 1
- [ ] No 1.x-only keys remain: `grep -c '"ignore"' biome.json` returns 0 and `grep -c '"organizeImports"' biome.json` returns exactly 1 (the assist occurrence — the top-level key is gone)
- [ ] The ledger reads zero: `grep -c "PENDING" TECH_DEBT_AUDIT.md` returns 0
- [ ] The ledger marks all 16 findings: `grep -c "RESOLVED\|DEFERRED\|AS-IS\|OPERATOR" TECH_DEBT_AUDIT.md` returns 16
- [ ] `grep -rn "run #7" src/` returns nothing (carried from Slice 2 — stays green after the churn)

#### Manual Verification:
- [ ] A staged commit fires the husky/lint-staged 17 chain (lint-staged 17 keeps the package.json key and the `.husky/pre-commit` `npx lint-staged` line — no config migration)
- [ ] One final clean checkout passes `npm test` with no `captures/` regrowth
- [ ] `npm run format` re-indents `watcher.config.json` 3-space → 2-space; `npm test` stays green after
- [ ] Operator: `git worktree prune` on the main clone (F011); `git count-objects` no longer warns "garbage found"
- [ ] The watch job's first post-merge run installs playwright 1.65.1 (one cache miss — `watch.yml:179` hashes `package-lock.json`) and stays green

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

## File Map

```
src/linkedin-capture.ts          # MODIFY — export NOOP_CAPTURE_SINK (F001)
tests/capture-oracle.ts          # NEW — shared snapshot + assert-absent + leaked-dir report (F015)
tests/fetch-linkedin.test.ts     # MODIFY — (Slice 1) 13 injections + oracle re-point; (Slice 2 merges the facade split)
tests/probe-linkedin.test.ts     # MODIFY — (Slice 1) 5 injections + oracle re-point; (Slice 2 merges the facade split)
tests/linkedin-fetch.test.ts     # MODIFY — (Slice 1) oracle re-point; (Slice 2 merges the facade split)
scripts/fetch-linkedin.ts        # MODIFY — (Slice 1) drop the ?? default + explicit CLI sink; (Slice 2 merges the F006 import split)
scripts/probe-linkedin.ts        # MODIFY — (Slice 1) drop the ?? default + explicit CLI sink; (Slice 2 merges the F006 import split)
scripts/watch-linkedin.ts        # MODIFY — (Slice 1) tick passes the fs sink; (Slice 2 merges the F014 SleepFn split)
scripts/linkedin-chain.ts        # MODIFY — probe + tick calls pass the fs sink (F001)
src/judge.ts                     # MODIFY — delete the facade :25-36 (F006)
src/linkedin-fetch.ts            # MODIFY — delete the facade :46-68; SleepFn re-export (F006/F014)
src/judge-rotation.ts            # MODIFY — export HEALTH_CAP_STREAK (F004)
tests/judge-health.test.ts       # MODIFY — equality test (F004)
tests/judge.test.ts              # MODIFY — re-point the facade import block (F006)
tests/judge-rotation.test.ts     # MODIFY — split the mixed facade import (F006)
tests/watch-linkedin.test.ts     # MODIFY — re-point legDead (F006)
scripts/probe-judge.ts           # MODIFY — envelope gate, entry guard, injectable fetch (F005)
tests/probe-judge.test.ts        # NEW — replay suite (F005)
src/judge-dispatch.ts            # MODIFY — measured-evidence comment (F008)
README.md                        # MODIFY — PC-path defaults + overrides (F009)
.madgerc                         # NEW — madge rc: skipTypeImports for the cycles gate (F003)
package.json                     # MODIFY — cycles script, format list, majors (F003/F012/F007)
.github/workflows/ci.yml         # MODIFY — madge + audit steps (F003/F013)
.github/workflows/watch.yml      # MODIFY — env-indirect FORCE (F010)
biome.json                       # MODIFY — 2.x migration (F007)
TECH_DEBT_AUDIT.md               # MODIFY — per-phase ledger marks (D11)
```

## Ordering Constraints

- Slice 1 before everything: the leak is the only red gate; every later slice's `npm test` depends on the armed oracle.
- `captures/` deletion AFTER the 18 injections land (operator `rm -rf captures/`, never a commit — the dir is gitignored).
- Slice 2's facade deletion and 10-site re-point MUST be one commit (knip atomicity).
- F014's re-export and its only consumer (`scripts/watch-linkedin.ts:20`) land in the same commit.
- Slice 2 rewrites the WHOLE fences of the six files Slice 1 already filled (`scripts/fetch-linkedin.ts`, `scripts/probe-linkedin.ts`, `scripts/watch-linkedin.ts`, `tests/fetch-linkedin.test.ts`, `tests/probe-linkedin.test.ts`, `tests/linkedin-fetch.test.ts`) — merge the F006/F014 import-split hunks with the Slice 1 capture hunks into one fence per file (6.4 step 2), never append alongside.
- Slice 3's madge devDependency + regenerated lockfile MUST precede Slice 4's majors (`npm ci` drift).
- Slice 4 last: majors-last bounds the playwright cache (`watch.yml:179`) to exactly one miss.
- F005's live validation is the next dispatch after Slice 2 merges — expected, not a regression.

## Verification Notes

- `grep -rn "run #7" src/` — exactly two hits today (`src/judge.ts:31`, `src/linkedin-fetch.ts:53`); must be empty after Slice 2.
- `npm run knip` exit 0 after Slice 2 (the facade deletions + F014 re-export are the knip-sensitive edits).
- The committed `npm run cycles` script exits 0 on the type-only graph — verified locally BEFORE the ci.yml step merges (the amended F003 criterion). Measured at design time (2026-11-16, be5407a): without `.madgerc` madge 8.0.0 exits 1 on the 9 type-only cycles; with it, exit 0. Implement re-runs `npm run cycles` after the install.
- Two clean-checkout `npm test` runs after `captures/` deletion (Slice 1), one more after Slice 4.
- A staged commit fires the husky/lint-staged 17 chain after the bump (Slice 4).
- `npm audit --omit=dev` stays non-blocking (0 vulnerabilities today; the step is inert).
- F005 passes offline and is corrected live (precedent `7cc7250` one day after `73d6786`): the next live dispatch is the validator; ceiling changes in the next state commit are expected.
- New CI gates may break on first land (precedent `42b8cf8`, `510ff2a`): budget a same-day fix window.
- Majors churn (biome 2 migration, TS 7 under the strict quartet): the FRD's "an afternoon" budget.
- `assertNoFreshCaptures` message edge (recorded, Slice 1 locked): an EMPTY `captures/` directory at the repo root fails with "0 session dir(s)" and an empty report — equivalent in effect to the old ENOENT assert, but the message reads as a bug. An empty captures/ is operator-created scratch, not a test leak.
- **Injection census re-measured (composite lesson: re-measure every count)**: 18 `fetchTick` call sites in `tests/fetch-linkedin.test.ts` (5 already inject at :422, :546, :577, :601, :886 — 13 need the injection) and 7 `runProbe` call sites in `tests/probe-linkedin.test.ts` (2 already inject at :275, :308 — 5 need it). Total injections: 18, not the research doc's 25 (which double-counted the 7 already-injected blocks).
- Agent results unavailable at design time (the Step-2 Agent dispatch returned no output); all line numbers were re-verified by direct file reads at `be5407a`. Cosmetic drift from the research doc recorded: `scripts/probe-judge.ts`'s bare `await main()` sits at :340 (file is 341 lines), not :349.

## Performance Considerations

- The probe's ramp is unchanged (worst case 62 calls per account); the envelope gate adds one `JSON.parse` per leg — negligible.
- `NOOP_CAPTURE_SINK` is a synchronous no-op closure: it removes the void'd-sink-promise teardown race (`tests/linkedin-fetch.test.ts:1300` documents the class) rather than narrowing it.
- Slice 4's lockfile rewrite costs one playwright cache miss + one 30-60s browser reinstall on the watch job (`watch.yml:179`) — bounded, accepted.

## Migration Notes

- `captures/` is gitignored scratch: deletion is an operator `rm -rf captures/`, never a commit. Two leaked session dirs exist today (`captures/20261115T021815Z/`, `captures/20261115T022011Z/`).
- `biome.json` migrates from the 1.x schema to 2.x (schema pin, `files.ignore` → includes); `watcher.config.json` re-indents 3-space → 2-space (JSON.parse is whitespace-blind — invisible to `loadWatcherConfig`).
- No committed state file changes shape in this pass.

## Pattern References

- `src/judge.ts:52-66` — the measured-evidence comment idiom (WAIT_BUDGET_MS) F008 follows.
- `src/judge-availability.ts:138-146` — the envelope gate F005 transplants.
- `scripts/probe-linkedin.ts:199` — the entry-guard idiom (`process.argv[1]` + `pathToFileURL`) the probe-judge refactor follows.
- `scripts/fetch-linkedin.ts:100-107` — the captureSink doc contract ("Passing nothing means CAPTURE TO DISK") the six-seam fix preserves.
- `tests/judge-helpers.ts` — the shared-test-helper shape `tests/capture-oracle.ts` follows (named exports, `.js` specifiers).
- `plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md:29`, :126 — gated-slice doctrine; verbatim-vs-logic separation.
- `f50067d` — gate-tool pinning (devDependency + npm script, never npx).

## Developer Context

**Q (Step 4, directional): follow the run6 gated-slice doctrine — every slice green under typecheck, lint, test at its own commit boundary?**
A: Follow run6 doctrine.

**Q (Step 4, directional): F008 comment rewrite follows the WAIT_BUDGET_MS measured-evidence idiom (value + run id, no open questions)?**
A: Follow the idiom.

**Q (Step 4, directional): TECH_DEBT_AUDIT.md resolution marks land per phase or as one final edit?**
A: Per phase.

**Q (Step 4, genuine ambiguity — NEW discovery): removing the two `?? makeFsCaptureSink()` defaults also silences four seams passing no sink (`scripts/watch-linkedin.ts:50`, `scripts/linkedin-chain.ts:86-87`, `scripts/fetch-linkedin.ts:487` CLI entry, `scripts/probe-linkedin.ts:199` CLI entry). The research doc scoped F001 to the two defaults + 25 test injections and did not see these. How handled?**
A: Fix all six seams — every production caller passes `makeFsCaptureSink()` explicitly; tests inject `NOOP_CAPTURE_SINK`. (Options presented: fix all six / fix only the two defaults — loop and chain capture nothing / default inside tick+probe — re-arms the leak.)

**Q (Step 5, decomposition): 4 slices — capture sinks+oracle (foundation), smalls+probe+facades, CI additions, majors+ledger zero. Approve?**
A: Approve 4 slices.

**Q (6.3 micro-checkpoint, Slice 1): approve the 10-file slice (v3 payload — 18 injections, 6 seams, shared oracle)?**
A: Approved — by INFERENCE, not an explicit approve click: the developer answered the presentation with "resume", which the next turn ratified by requesting the retry of the 6.4 write. Recorded as approval with that caveat so a future session does not over-trust it. (slice-verifier v2: V1 violations 1-4 resolved, V2 found two anchor drifts — probe block :52-58, linkedin-fetch block :1312-1328 — both locked by direct read before the write.)

**Q (post-lock ratification, Slice 1): the three load-bearing decisions asked point-by-point — (1) D3 six-seam fix, (2) conditional-spread passthrough (the TS2379 fix), (3) the 18-injection census (13 fetchTick + 5 runProbe).**
A: All three RATIFIED via "resume" — the session's established approval convention; each question carried a Ratify-Recommended option plus a reopen path. Slice 1's lock is now explicit. Census verification stands on two independent walks (slice-verifier v1 and v2, both 18/7 with matching line lists).

**Q (6.3 micro-checkpoint, Slice 2): approve the 18-file slice (facades deleted + 10-site re-point, probe envelope gate + entry guard + injectable fetch + replay suite, F004/F008/F009/F014 smalls)?**
A: Approve. The presentation also carried one ratification: Slice 1's locked Hunk A line `import { type CaptureRecord, type CaptureSink, NOOP_CAPTURE_SINK } from "../src/linkedin-capture.js";` is 101 columns and fails `biome check` (no >=101-col single-line import exists on disk; `src/index.ts:37` at exactly 100 is the inclusive-bound proof). Slice 2's merged fences for `tests/fetch-linkedin.test.ts` and `tests/probe-linkedin.test.ts` carry the canonical wrapped 3-member form, and Slice 1's fences are amended to the same form — the amendment also lands the `NOOP_CAPTURE_SINK` symbol the probe suite's five injections need. Recorded in Design History.

**Q (design-time measurement, Slice 3): the D7 invocation — does stock madge exit 0 on the type-only graph, and if not, what seam?**
A: Measured (2026-11-16, be5407a): madge 8.0.0 exits 1 on exactly the 9 type-only cycles; `--help` exposes no skip-type-imports flag; a root `.madgerc` with `detectiveOptions.ts.skipTypeImports: true` flips the same invocation to exit 0 (throwaway file removed; tree clean). `npm audit --omit=dev` measured "found 0 vulnerabilities" (the F013 step is inert today). Recorded as D12.

**Q (6.3 micro-checkpoint, Slice 3): approve the 5-file slice (package.json hunks + .madgerc NEW + ci.yml steps + watch.yml FORCE swap + ledger marks; the .madgerc decomposition amendment ratified with the approve)?**
A: Approve (explicit approve at the 6.3 checkpoint). slice-verifier v2: Decisions OK, Cross-slice OK, Research OK (v1 found two violations — the missing File Map amendment hunk and the inputs.force grep criterion matching watch.yml:47's prose — both fixed and re-verified).

## Design History

- Slice 1: capture sinks + shared oracle — revised twice in verification (v1→v2: TS2379 conditional spread, biome import order, criterion scoped to tests/*.test.ts, :396 reformatted block; v2→v3: probe anchor :52-58, linkedin-fetch anchor :1312-1328, path-join import deleted) — approved by inference: "resume" + the retry request ratified it (caveat recorded in Developer Context). **Verification gap recorded**: the v1→v3 chain did not measure column widths, so the locked Hunk A capture import shipped at 101 columns and fails `biome check`; Slice 2's approval ratified the amendment (wrapped 3-member form) — a future session must not treat Slice 1's lock as format-verified.
- Slice 2: smalls + probe fix + facades — revised five times in verification (v1→v2: added the missing F004 equality-test fence, corrected biome byte order in tests/judge.test.ts and tests/fetch-linkedin.test.ts; v2→v3: scrubbed "run #7" from the slice's own new src/ content so its grep criterion passes against its own output, corrected the facade anchors to :25-36 / :46-68; v3→v4: every multi-member import emitted in biome's canonical multi-line form; v4→v5: restored the exactly-100-column judge.js import to single-line (lineWidth 100 is inclusive — src/index.ts:37 is the disk-green proof), wrapped `timed`'s parameters, and recorded the Slice 1 format amendment) — approved as generated (explicit approve at the 6.3 checkpoint).
- Slice 3: CI additions — revised once in verification (v1→v2: added the explicit File Map amendment hunk for `.madgerc`; re-scoped the inputs.force grep criterion to the literal `${{ inputs.force }}` interpolation after v1 measured the 2-hit prose match at watch.yml:47) — approved as generated (explicit approve at the 6.3 checkpoint; the `.madgerc` NEW decomposition amendment ratified with it; D12 recorded).
- Slice 4: majors last + ledger zero — approved as generated (explicit approve at the 6.3 checkpoint; slice-verifier: Decisions OK, Cross-slice OK, Research OK — zero violations; watch.yml:179 verified live as the playwright cache key; ledger arithmetic 14+2=16 exact). One docs-grounded refinement at write time: biome.json's negations use the `!!` force-exclude form — the faithful map of the 1.x hard ignore per the 2.x configuration reference (single `!` keeps paths indexed for type-aware rules this repo does not enable); also repaired a duplicated `### package.json — MODIFY` heading left by the Slice 3 write.

## References

- `.rpiv/artifacts/solutions/2026-11-15_10-27-02_tech-debt-ledger-zero-landing.md` — the landing-shape analysis this design implements.
- `.rpiv/artifacts/research/2026-11-15_09-54-32_tech-debt-ledger-zero.md` — the finding census and locked per-finding decisions.
- `.rpiv/artifacts/discover/2026-11-15_09-31-23_tech-debt-zero.md` — the FRD.
- `TECH_DEBT_AUDIT.md` — the ledger this pass zeroes.
- `plans/2026-11-13_20-40-20_tech-debt-run6-remediation.md` — the gated-slice doctrine and the run5 counter-example.
- `.rpiv/artifacts/validation/2026-11-14_08-15-48_tech-debt-run6-remediation.md` — per-phase local gating precedent.
- `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/tests/architecture.md`, `.rpiv/guidance/scripts/architecture.md`, `.rpiv/guidance/.github/workflows/architecture.md` — the four doctrine layers.
