---
date: 2026-11-19T13:14:31+0700
author: Yogiswara Utama
commit: 7087c44
branch: ukind/fix-techdebt-2
repository: fix-techdebt-2
topic: "tech-debt full-ledger remediation (N065-N092): 6-phase implementation plan"
tags: [plan, tech-debt, judge, linkedin, tests, docs, facades, type-moves]
status: ready
parent: .rpiv/artifacts/research/2026-11-19_12-14-03_tech-debt-full-ledger-remediation.md
phase_count: 6
unresolved_phase_count: 0
phases:
  - { n: 1, title: Live signals, files: [tests/config-file.test.ts, scripts/watch-linkedin.ts, tests/watch-linkedin.test.ts, scripts/probe-judge.ts, src/linkedin-walk-static.ts, src/linkedin-walk.ts, src/fetch-threads.ts, tests/fetch-threads.test.ts, scripts/hooks/format-on-edit.js, tests/format-on-edit.test.ts, scripts/login-linkedin.ts, tests/login-linkedin.test.ts, scripts/fetch-linkedin.ts, tests/fetch-linkedin.test.ts, src/linkedin-capture.ts, tests/linkedin-capture.test.ts, tests/pool.test.ts, tests/config.test.ts, tests/judge-exhaustion.test.ts], depends_on: [] }
  - { n: 2, title: Type homes + deps object, files: [src/judge-account.ts, src/judge.ts, src/config-file.ts, src/linkedin-fetch.ts, src/linkedin-walk.ts, src/index.ts, src/judge-availability.ts, src/judge-ceilings.ts, src/judge-dispatch.ts, src/judge-health.ts, src/judge-rotation.ts, scripts/probe-judge.ts, scripts/fetch-linkedin.ts, scripts/probe-linkedin.ts, tests/judge-helpers.ts, tests/judge.test.ts, tests/judge-rotation.test.ts, tests/judge-availability.test.ts, tests/judge-ceilings.test.ts, tests/judge-health.test.ts, tests/index.test.ts, tests/linkedin-fetch.test.ts, tests/judge-exhaustion.test.ts], depends_on: [] }
  - { n: 3, title: Facade execution, files: [src/judge.ts, src/linkedin-fetch.ts, src/linkedin-walk-static.ts, tests/judge.test.ts, tests/judge-rotation.test.ts, tests/linkedin-fetch.test.ts, tests/probe-linkedin.test.ts, tests/fetch-linkedin.test.ts, tests/watch-linkedin.test.ts, scripts/probe-judge.ts, scripts/watch-linkedin.ts, scripts/fetch-linkedin.ts, scripts/probe-linkedin.ts], depends_on: [2] }
  - { n: 4, title: Extractions, files: [src/pipeline-helpers.ts, src/judge-ramp.ts, src/index.ts, scripts/probe-judge.ts, tests/index.test.ts], depends_on: [2] }
  - { n: 5, title: Test consolidation, files: [tests/judge-helpers.ts, tests/judge.test.ts, tests/judge-rotation.test.ts, tests/judge-ramp.test.ts, src/judge-ramp.ts, .rpiv/guidance/tests/architecture.md], depends_on: [4] }
  - { n: 6, title: Doc pass, files: [AGENTS.md, README.md, package.json, .rpiv/guidance/architecture.md, .rpiv/guidance/src/architecture.md, .rpiv/guidance/scripts/architecture.md, .rpiv/guidance/.github/workflows/architecture.md, src/linkedin-behavior.ts, scripts/linkedin-chain.ts, tests/probe-linkedin.test.ts], depends_on: [2, 4] }
last_updated: 2026-11-19T13:14:31+0700
last_updated_by: Yogiswara Utama
---

# Tech-debt Full-ledger Remediation Implementation Plan

## Overview

Land every open finding from `.rpiv/artifacts/TECH_DEBT_AUDIT.md` run #8 (N065–N092) as one PR on `ukind/fix-techdebt-2`, in the FRD's fixed cluster order: live signals → type homes (+ the walk deps object) → facade execution → extractions → test consolidation → doc pass. Six phases, each ending green on the three gates. All moves are byte-verbatim (the `f14d9f9`→`2338274` lesson); all facade deletions re-point every importer in the same phase; no old-path re-export shims anywhere (knip).

## Requirements

- N089: de-pin both wake-band pin pairs to shape assertions; suite goes green (669/670 → all pass).
- N091: warn once per loop start when the wake band floor crosses `PAYLOAD_MAX_AGE_MS`; warning only, never throws.
- N090: write the numeric gc revisit threshold into the N043 policy section; the gc itself is an operator operation (manual verification).
- N092: move `LlmAccount` to a zero-import leaf and `LinkedinSurface` beside `Surface`; re-point all 19 importers; madge → 0.
- N067+N076: execute both REMOVAL NOTE facades; re-point every facade-path importer; delete the SCROLL_JS source-text describe.
- N065: probe leg success = JSON parse + required `"choices"` key.
- N069: `walkLinkedInSurface` nine positionals → deps object.
- N066/N070/N081: 17 doc edits + the full sweep (chain banner, probe test title, consistency rows).
- N071/N072/N073/N085/N088: warn-once port (timeouts = absence), node+launcher hook spawn, "pair captured" reword, abort-output fold, compact capture + `LINKEDIN_CAPTURE=off`.
- N075/N080: extract `src/pipeline-helpers.ts` and the probe ramp (pure `src/` module + entry guard) with new suites.
- N078/N079/N077: shared fetch-double factory + canonical `freshState` + the wall-clock gate removed via a recording-sleep assertion; doctrine lines rewritten in the same commit set.

## Current State Analysis

Branch `ukind/fix-techdebt-2` @ `7087c44`. `npm test` is 669/670 red (`tests/config-file.test.ts:57` pins 60 against the committed 15/45 band). `madge --circular` reports 9 cycles, all in the judge/linkedin type graph. Two REMOVAL NOTE facades (run #7 leftovers) still re-export 10 symbols. `scripts/probe-judge.ts` runs `loadWatcherConfig()` + `main()` at import time (no entry guard — the only unguarded script). `tests/judge-helpers.ts` hosts 7 pure fixtures; doubles stay per-suite (64 `as unknown as typeof fetch` casts + 21 sleep-double sites across the two judge suites). The doc layers carry the deleted "timestamp-ordered zip", a wrong probe walk order (5 sites), and 5 more count/name drifts.

### Key Discoveries

- `PAYLOAD_MAX_AGE_MS` is at `src/linkedin-payload.ts:43` (not :48); freeze comment `:33-42`; stale check `:193`.
- `resolveLinkedInWakeBand` (`src/linkedin-behavior.ts:76-87`) has exactly one production caller: `scripts/watch-linkedin.ts:136-140` (startLoop). Module header `:12-14` + suite header `tests/linkedin-behavior.test.ts:7` declare IO-free — the warn goes at the call site (developer decision).
- `src/judge-shared.ts:13` runtime-imports `judge-health.js`, which type-imports `LlmAccount` (`src/judge-health.ts:34`) — the audit's judge-shared home recreates a cycle; only a leaf zeroes madge.
- `tests/linkedin-fetch.test.ts:32-45` moves **six** facade symbols (the FRD missed `allSurfacesFaulted`, used at `:1179`).
- The probe ramp's floor return is `scripts/probe-judge.ts:190` and the full-clean return `:193` (FRD had them swapped); `timed` closes over global fetch (`:107-108`), so the ramp module needs a `fetchFn` param; nothing in the ramp path sleeps.
- `mergeSurfaceStamps` (`src/index.ts:616-627`) has no caller outside `dedupePosts` — it must stay module-private in the new module or knip fails.
- `npx` is `npx.cmd`; Node >= 22 rejects `.cmd` targets without a shell (EINVAL, CVE-2024-27980) — N072 spawns `process.execPath` + `@biomejs/biome`'s `bin/biome` JS launcher (developer decision).
- The recent-tab catch (`src/fetch-threads.ts:417-419`) fires mainly on a designed-absence timeout — the ported warn classifies timeouts as absence (developer decision).
- The chain banner text after `stage 2/3 probe ` is not pinned (`tests/linkedin-chain.test.ts:100-108` pins only the prefix) — the full-sweep banner edit is safe.
- 39 casts in `tests/judge.test.ts` (not 38), 25 in `tests/judge-rotation.test.ts`; the wall-clock case (`tests/judge-rotation.test.ts:386-404`) injects no sleep today.

## Desired End State

- `npm test` exits 0 with > 670 passing tests; `npm run typecheck`, `npm run lint`, `npx knip` exit 0; `npx madge --circular src scripts` reports 0 cycles.
- `grep -n "linkedinWake" tests/config-file.test.ts` shows shape assertions at both former pair sites (`:57-58`, `:278-279`).
- A wake band floor >= 40 min emits one warning line naming `PAYLOAD_MAX_AGE_MS` at loop start.
- No REMOVAL NOTE text remains; no type-symbol imports of `LlmAccount` from `judge.js`; no `as unknown as typeof fetch` in the two judge suites.
- `grep -rn "timestamp-ordered zip" AGENTS.md .rpiv/guidance src` returns no hits; `negativeKeywords` documented; the probe walk order reads config-order everywhere (docs + banner + test title).
- `grep -n "shell: true" scripts/hooks/format-on-edit.js` empty; capture files single-line; `LINKEDIN_CAPTURE=off` disables capture.
- Importing `scripts/probe-judge.ts` performs no config load and no main run.

## What We're NOT Doing

- No operator config change: wake band stays 15/45; `PAYLOAD_MAX_AGE_MS` stays 40 min; N091 is a warning, never a validation.
- No redesign of flagged-but-fine items: `linkedin-parser.ts` stays cohesive-pure (documented exception); `stateTempPath`'s `Math.random` untouched.
- No new runtime dependency; no behavior change to the funnel, judge semantics, or state-write atomicity.
- No scheduled git gc (N043 amended only by the numeric threshold). The one-time `git gc --aggressive` is an operator operation recorded as manual verification, not a phase.
- No `LINKEDIN_CAPTURE` entry in `ENV_NAMES` (bare opt-in env read; E15's doc line counts stay 7).
- No re-export shims on any old path (knip flags them as unused exports).
- `mergeSurfaceStamps` is not exported from `src/pipeline-helpers.ts`.
- The FRD's live-only open questions (scrollRounds 50, orphaned secrets, reasoning_effort support, artifacts pruning policy) stay open.

## Decisions

### D-BP1 — Phase map follows the FRD cluster order; N069 rides the type-homes phase
Confirmed (developer): 6 phases — live signals → type homes (+N069) → facades → extractions → test consolidation → doc pass. N069 edits the same two files as N092 (`src/linkedin-walk.ts:95-105` + `src/linkedin-fetch.ts:286-296`, plus the `:27` import flip).

### D-BP2 — The three zero-dependency suites land with the test-consolidation phase
Confirmed (developer): `tests/pool.test.ts`, `tests/config.test.ts`, `tests/judge-exhaustion.test.ts` are Phase 1 deliverables (they gate nothing downstream); the ramp suite waits for the Phase 4 extraction and lands in Phase 5.

### D-BP3 — `isPageCloseRace` is exported from the static leaf
Confirmed (developer): the shared predicate lives in `src/linkedin-walk-static.ts` beside `PAGE_CLOSE_RACE_MESSAGES` (`:141-145`; the module's only import is `linkedin-parser.js:8`). Exporting from `src/linkedin-walk.ts` would mint a new fetch-threads → linkedin-walk runtime cycle (`linkedin-walk.ts:14` type-imports `ContextLike` from `fetch-threads.js`).

### D-BP4 — N079 before N078
Confirmed (developer): freshState consolidates first (pure move, zero cast churn), then the factory migration runs against a settled file.

### D-BP5 — `scrollRounds` is a required deps field
Confirmed (developer): `WalkLinkedInDeps.scrollRounds` is required; `fetchLinkedInPosts` keeps passing its own resolved value (`src/linkedin-fetch.ts:245`). `LINKEDIN_DEFAULT_SCROLL_ROUNDS` stays orchestration-side; both module headers stay true.

### D-BP6 — The ramp module splits the classifier out
Confirmed (developer): the new module exports a pure `classifyResponse(status, body)` (where the N065 JSON+`"choices"` check lands), plus `rampLevel` and `findConcurrencyCeiling` taking `fetchFn`, plus `RAMP_MAX` and the `ProbeOutcome` type. `timed`'s IO wrapper stays in the script and delegates to `classifyResponse`.

### D-BP7 — N072 spawns node + the Biome JS launcher
Confirmed (developer, from research): `spawnSync(process.execPath, [biomeJsBin, "format", "--write", file])` — no shell, cross-platform. The allowlist gate stays physically (its test pin depends on it); its rationale comment is rewritten.

### D-BP8 — N091 warns at the loop start
Confirmed (developer, from research): the warn lives in `scripts/watch-linkedin.ts` immediately after `resolveLinkedInWakeBand` returns. No purity headers touched; the loop suite owns the spy idiom.

### D-BP9 — N071 timeouts are absence
Confirmed (developer, from research): the recent-tab catch stays silent on timeout-shaped errors; only genuine faults warn once. The graphql catch warns once per walk on non-page-close errors.

### D-BP10 — Doc pass is the full sweep
Confirmed (developer, from research): 17 enumerated edits + the chain banner (`scripts/linkedin-chain.ts:106`, prefix-only pin verified) + the probe test title rename + consistency rows (guidance Commands table, the duplicate revisit trigger at `.rpiv/guidance/.github/workflows/architecture.md:138`).

## Phase 1: Live signals

### Overview
Delivers every red/noise signal fix: N089 (green suite), N091 (loop-start warn), N065 (probe gate), N071 (warn-once port with the shared leaf guard), N072 (hook spawn), N073 (reword), N085 (abort fold), N088 (compact capture + kill switch), plus the three zero-dependency suites (D-BP2). Depends on nothing; runs first so every later phase lands on a green suite.

### Changes Required:

#### 1. tests/config-file.test.ts:44-59
**File**: tests/config-file.test.ts
**Changes**: MODIFY — N089 pair #1: replace the two `=== 60` pins (`:57-58`) with shape assertions mirroring the platforms idiom at `:54-55`.

```ts
    assert.equal(typeof config.platforms.linkedin, "boolean");
    assert.equal(typeof config.platforms.threads, "boolean");
    assert.equal(config.recencyHours, 72);
    // N089: the wake band is operator-editable committed data, exactly
    // like the platforms flags above — pin the shape, not the values.
    assert.equal(typeof config.linkedinWakeMinMinutes, "number");
    assert.ok(config.linkedinWakeMinMinutes >= 1);
    assert.equal(typeof config.linkedinWakeMaxMinutes, "number");
    assert.ok(config.linkedinWakeMaxMinutes >= 1);
  });
```

(The two `=== 60` pins at `:57-58` are replaced by the six new lines; the recencyHours + platforms pins are context, unchanged.)

#### 2. tests/config-file.test.ts:274-280
**File**: tests/config-file.test.ts
**Changes**: MODIFY — N089 pair #2: de-pin the defaults case (`:278-279`) to the same shape assertions.

```ts
  it("applies the >= 1 shape bound to both keys when absent (N089 — the loader default stays unpinned operator-adjacent data)", async () => {
    const path = await writeConfig({ ...VALID });
    const config = await loadWatcherConfig(path);
    // N089: this case pins the LOADER DEFAULT path (code, not operator
    // data) — the de-pin keeps one assertion shape for the wake keys
    // across the file. The 60/60 default stays covered indirectly
    // (tests/linkedin-behavior.test.ts degenerate band, the watch suite's
    // flat-60 case), never re-pinned by value here.
    assert.equal(typeof config.linkedinWakeMinMinutes, "number");
    assert.ok(config.linkedinWakeMinMinutes >= 1);
    assert.equal(typeof config.linkedinWakeMaxMinutes, "number");
    assert.ok(config.linkedinWakeMaxMinutes >= 1);
  });
```

#### 3. scripts/watch-linkedin.ts:130-146
**File**: scripts/watch-linkedin.ts
**Changes**: MODIFY — N091: after `resolveLinkedInWakeBand` returns in `startLoop`, warn once when the band floor crosses `PAYLOAD_MAX_AGE_MS` (D-BP8). Adds the `PAYLOAD_MAX_AGE_MS` import from `../src/linkedin-payload.js`.

```ts
import { PAYLOAD_MAX_AGE_MS } from "../src/linkedin-payload.js";
```

(startLoop body — inserted between the band resolve and the runLoop call:)

```ts
  const band = resolveLinkedInWakeBand(
    resolved.linkedinWakeMinMinutes,
    resolved.linkedinWakeMaxMinutes,
    CONFIG_PATH,
  );
  // N091: warn once per loop start when the band floor reaches the pushed
  // payload's freshness bound — wakes in the tail can read the leg DARK and
  // degrade the hosted run to threads-only. Warning only: the 40-minute
  // bound is operator-frozen (src/linkedin-payload.ts) and the band is
  // deliberate pacing (FRD D8) — the crossing is documented, not fixed.
  if (resolved.linkedinWakeMinMinutes * 60_000 >= PAYLOAD_MAX_AGE_MS) {
    console.warn(
      `watch-linkedin: wake band floor ${resolved.linkedinWakeMinMinutes} min reaches PAYLOAD_MAX_AGE_MS (${Math.round(PAYLOAD_MAX_AGE_MS / 60_000)} min) — wakes in the ${resolved.linkedinWakeMinMinutes}-${resolved.linkedinWakeMaxMinutes} min band can read the pushed payload stale (freshness rule: the payload must be younger than PAYLOAD_MAX_AGE_MS to count ok)`,
    );
  }
  await runLoop({
    ...loopDeps,
    linkedinWakeMinMs: band.minMs,
    linkedinWakeMaxMs: band.maxMs,
  });
```

#### 4. tests/watch-linkedin.test.ts:194-250
**File**: tests/watch-linkedin.test.ts
**Changes**: MODIFY — N091 test: a crossing-band startLoop case asserting one warn line matching `/PAYLOAD_MAX_AGE_MS/` and one non-crossing case asserting zero such lines (the spy idiom at `:157`/`:178`).

```ts
  it("warns once naming PAYLOAD_MAX_AGE_MS when the band floor reaches it (N091)", async (t) => {
    const warn = t.mock.method(console, "warn", console.warn.bind(console));
    await startLoop({
      config: {
        ...BASE_CONFIG,
        linkedinWakeMinMinutes: 45,
        linkedinWakeMaxMinutes: 60,
      },
      tick: async () => {},
      sleepFn: async () => {},
      rng: seededRng(2026_11_09),
      maxIterations: 1,
    });
    const lines = warn.mock.calls.map((call) => call.arguments.join(" "));
    const fresh = lines.filter((line) => /PAYLOAD_MAX_AGE_MS/.test(line));
    assert.equal(fresh.length, 1);
    assert.match(fresh[0] ?? "", /freshness rule/);
  });

  it("stays quiet when the band floor is below the freshness bound (N091)", async (t) => {
    const warn = t.mock.method(console, "warn", console.warn.bind(console));
    await startLoop({
      config: {
        ...BASE_CONFIG,
        linkedinWakeMinMinutes: 15,
        linkedinWakeMaxMinutes: 45,
      },
      tick: async () => {},
      sleepFn: async () => {},
      rng: seededRng(2026_11_09),
      maxIterations: 1,
    });
    const lines = warn.mock.calls.map((call) => call.arguments.join(" "));
    assert.equal(lines.filter((line) => /PAYLOAD_MAX_AGE_MS/.test(line)).length, 0);
  });
```

#### 5. scripts/probe-judge.ts:116-127
**File**: scripts/probe-judge.ts
**Changes**: MODIFY — N065: replace `body.includes("{")` with a JSON parse requiring a `"choices"` key; a parse miss is a failed leg. (Phase 4 lifts this check into `classifyResponse`; landing it here first keeps the live gate fixed in this phase per the FRD cluster order.)

```ts
/**
 * N065: classify one probe response. The old gate — a bare
 * `body.includes("{")` — matched any brace-carrying text, so a refusal
 * rendered as prose with one brace read OK. A real completion PARSES as
 * JSON and carries a chat-completions "choices" array; anything else is a
 * failed leg (a refusal-as-data body with valid error JSON still fails the
 * choices check). Phase 4 lifts this function verbatim into
 * src/judge-ramp.ts.
 */
function classifyResponse(status: number, body: string): ProbeOutcome {
  if (status < 200 || status >= 300) return { kind: "refused", status };
  try {
    const parsed = JSON.parse(body) as { choices?: unknown };
    if (parsed.choices === undefined) {
      return { kind: "failed", message: "response carried no chat-completions choices" };
    }
    return { kind: "ok" };
  } catch {
    return { kind: "failed", message: "response was not valid JSON" };
  }
}
```

(timed's tail — replaces the `if (!response.ok)` block + the `body.includes("{")` lines; the trailing catch is unchanged:)

```ts
    const body = await response.text();
    const elapsed = Date.now() - started;
    const outcome = classifyResponse(response.status, body);
    if (outcome.kind === "refused") {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} REFUSED`);
    } else if (outcome.kind === "failed") {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} NO CHOICES`);
    } else {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} OK`);
    }
    return outcome;
```

#### 6. src/linkedin-walk-static.ts:140-145
**File**: src/linkedin-walk-static.ts
**Changes**: MODIFY — D-BP3: export `isPageCloseRace` beside `PAGE_CLOSE_RACE_MESSAGES`; zero new imports.

```ts
/**
 * The page-close-race predicate the two walkers share (N071): a body read
 * or a settle step losing to the page closing is EXPECTED churn, not a
 * fault — name check plus a message-fragment scan over
 * PAGE_CLOSE_RACE_MESSAGES. This leaf is the shared home (its only import
 * is linkedin-parser) so fetch-threads.ts can import it without a
 * fetch-threads -> linkedin-walk runtime edge, which would close a type
 * cycle: linkedin-walk type-imports ContextLike from fetch-threads.
 */
export function isPageCloseRace(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { name?: unknown }).name === "TargetClosedError") return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return PAGE_CLOSE_RACE_MESSAGES.some((fragment) => message.includes(fragment));
}
```

#### 7. src/linkedin-walk.ts:52-58
**File**: src/linkedin-walk.ts
**Changes**: MODIFY — dedupe: replace the private `isPageCloseRace` with the static-leaf import (byte-verbatim behavior); the private function block (`:52-58`) is deleted entirely and `PAGE_CLOSE_RACE_MESSAGES` leaves this import (the deleted fn was its sole consumer here).

```ts
import {
  ACTIVITY_ID_RE,
  DOM_PROBE_JS,
  LINKEDIN_CHECKPOINT_URL_RE,
  LINKEDIN_FIRST_RESPONSE_POLL_MS,
  LINKEDIN_FIRST_RESPONSE_TIMEOUT_MS,
  LINKEDIN_LOAD_MORE_WAIT_MS,
  LINKEDIN_MAX_DRY_ROUNDS,
  LINKEDIN_MAX_POSTS,
  LINKEDIN_MIN_GAIN,
  LINKEDIN_NAV_TIMEOUT_MS,
  LINKEDIN_SETTLE_MS,
  LINKEDIN_XHR_DRAIN_MS,
  LOAD_MORE_SELECTOR,
  SCROLL_JS,
  SEEN_STOP_CONSECUTIVE,
  isPageCloseRace,
} from "./linkedin-walk-static.js";
```

#### 8. src/fetch-threads.ts:360-430
**File**: src/fetch-threads.ts
**Changes**: MODIFY — N071: add the `CaptureWarnState` latch beside `let xhrBodies = 0` (`:371`), a `warnBodyFault` closure, and apply it at both catches (`:389-391` graphql: warn once on non-page-close errors; `:417-419` recent-tab: timeout = absence per D-BP9). Imports `isPageCloseRace` + `type CaptureWarnState` (new downward edges, cycle-free).

```ts
import { type CaptureWarnState } from "./linkedin-capture.js";
import { isPageCloseRace } from "./linkedin-walk-static.js";
```

(module-level helper, after the FETCH_CONCURRENCY consts:)

```ts
/**
 * The Recent-tab waitFor timeout IS the designed absence signal (N071):
 * Playwright timeouts carry the TimeoutError name, and the absence is
 * logged by the branch that consumes recentVisible. A genuine locator
 * fault (a plain Error) warns once per walk instead.
 */
function isTimeoutAbsence(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError"
  );
}
```

(fetchOneAuthenticated frame, after `let xhrBodies = 0;`:)

```ts
  // N071 warn-once latch (the linkedin-walk warnBodyFault idiom): the two
  // swallows below keep their DESIGNED silences (the page-close race; the
  // Recent tab's timeout-as-absence), but a parser RangeError or a genuine
  // locator fault must not vanish next to them. First real fault per
  // surface walk warns; later ones stay quiet.
  const bodyFaultWarn: CaptureWarnState = { warned: false };
  const warnBodyFault = (arm: string, error: unknown): void => {
    if (bodyFaultWarn.warned) return;
    bodyFaultWarn.warned = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `fetch: ${surface.label} ${arm} body fault (first this walk; further faults stay quiet) — ${message}`,
    );
  };
```

(the graphql listener catch, `:389-391`, becomes:)

```ts
      } catch (error) {
        // The page-close race stays silent; a real body fault warns once
        // per walk (N071) instead of vanishing next to the designed swallow.
        if (!isPageCloseRace(error)) warnBodyFault("graphql", error);
      }
```

(the recent-tab catch, `:417-419`, becomes:)

```ts
    } catch (error) {
      // N071: the timeout is the DESIGNED absence (logged below); a
      // genuine fault warns once per walk; the page-close race stays silent.
      if (!isTimeoutAbsence(error) && !isPageCloseRace(error)) {
        warnBodyFault("recent-tab", error);
      }
      recentVisible = false;
    }
```

#### 9. tests/fetch-threads.test.ts:137-156
**File**: tests/fetch-threads.test.ts
**Changes**: MODIFY — N071 tests: a `TimeoutError`-shaped locator variant; three cases — graphql fault warns once then stays quiet, page-close race stays silent, recent-tab timeout stays absent-silent while a genuine locator fault warns once.

```ts
const graphqlResponse = (body: string, noise?: string): ResponseLike => ({
  url: () => "https://www.threads.com/api/graphql",
  status: () => 200,
  text:
    noise !== undefined
      ? (): Promise<string> => {
          throw new Error(noise);
        }
      : async () => body,
});
```

(goto's fire line becomes `if (entry !== undefined) fire(graphqlResponse(entry[1], options.noiseOnXhr));`; the options type gains `recentTabFault?: boolean;` and `noiseOnXhr?: string;`; the missing-tab locator's waitFor becomes:)

```ts
              waitFor: async () => {
                if (options.recentTabFault === true) {
                  throw new Error("locator wiring broke"); // a genuine fault (N071)
                }
                const timeoutError = new Error("locator not found"); // the designed absence
                timeoutError.name = "TimeoutError";
                throw timeoutError;
              },
```

(new its, after the existing "warns when a tag surface has no Recent tab":)

```ts
  it("stays silent on the designed Recent-tab timeout — no body-fault warn (N071)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    await fetchSurfacesAuthenticated(
      [surface("tag/noTab")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        xhrBySubstring: new Map([["tag/noTab", graphqlBody(id19(1))]]),
      }),
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !line.includes("body fault")));
    assert.ok(lines.some((line) => /tag\/noTab has no Recent tab/.test(line)));
  });

  it("warns once when the Recent-tab locator genuinely faults (N071)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    await fetchSurfacesAuthenticated(
      [surface("tag/faulty")],
      "session-state.json",
      fakeContextFactory({
        concurrency: { inFlight: 0, peak: 0 },
        recentTabFault: true,
        xhrBySubstring: new Map([["tag/faulty", graphqlBody(id19(1))]]),
      }),
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    const faults = lines.filter((line) => /recent-tab body fault/.test(line));
    assert.equal(faults.length, 1);
    assert.match(faults[0] ?? "", /locator wiring broke/);
  });

  it("warns once per walk on graphql body faults — later faults stay quiet (N071)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    await assert.rejects(
      () =>
        fetchSurfacesAuthenticated(
          [surface("tag/noisy")],
          "session-state.json",
          fakeContextFactory({
            concurrency: { inFlight: 0, peak: 0 },
            scrollBodies: ["thread_items noise one {{", "thread_items noise two ["],
            xhrBySubstring: new Map([["tag/noisy", "thread_items <<< not json"]]),
          }),
        ),
      /all 1 authenticated surface\(s\) failed/,
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    const faults = lines.filter((line) => /graphql body fault/.test(line));
    assert.equal(faults.length, 1);
    assert.match(faults[0] ?? "", /first this walk/);
  });

  it("a page-close race in the graphql arm stays silent (N071)", async (t) => {
    const warns = t.mock.method(console, "warn", console.warn.bind(console));
    await assert.rejects(
      () =>
        fetchSurfacesAuthenticated(
          [surface("tag/closed")],
          "session-state.json",
          fakeContextFactory({
            concurrency: { inFlight: 0, peak: 0 },
            noiseOnXhr: "Response body is unavailable",
            xhrBySubstring: new Map([["tag/closed", "whatever"]]),
          }),
        ),
      /all 1 authenticated surface\(s\) failed/,
    );
    const lines = warns.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.every((line) => !line.includes("body fault")));
  });
```

#### 10. scripts/hooks/format-on-edit.js:18-31
**File**: scripts/hooks/format-on-edit.js
**Changes**: MODIFY — N072 (D-BP7): drop `shell: true`, spawn `process.execPath` + the Biome JS launcher, add the nonzero-status warn beside the error arm, rewrite the `:18-20` shell rationale comment.

```js
#!/usr/bin/env node
// PostToolUse feedback hook: formats the file an agent just edited with Biome.
// Reads one JSON event on stdin. Never blocks: always exits 0.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let event;
try {
  event = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const file = String(event?.tool_input?.file_path ?? "");
if (!/\.(ts|tsx|js|mjs|cjs|json)$/.test(file) || !existsSync(file)) process.exit(0);

// Defense-in-depth keep (N072): the spawn below no longer runs through a
// shell, so cmd.exe cannot tokenize the path — but the allowlist still
// blocks exotic paths (option-looking leading dashes) and its test pin
// depends on it.
if (!/^[A-Za-z0-9 _.()/\\:+-]+$/.test(file)) {
  console.error(`format-on-edit: skipped (path outside the allowlist): ${file}`);
  process.exit(0);
}

// N072: spawn node + Biome's JS launcher directly — no shell. The old
// spawn ran `npx` under shell:true; npx is npx.cmd on Windows and Node
// >= 22 refuses .cmd targets without a shell (EINVAL, the CVE-2024-27980
// mitigation), so the no-shell form needs a real executable target.
const biomeJsBin = fileURLToPath(
  new URL("../../node_modules/@biomejs/biome/bin/biome", import.meta.url),
);
const result = spawnSync(process.execPath, [biomeJsBin, "format", "--write", file], {
  stdio: "ignore",
});
if (result.error) {
  console.error(`format-on-edit: could not run Biome: ${result.error.message}`);
} else if (result.status !== 0) {
  console.error(`format-on-edit: Biome exited ${result.status} (format skipped)`);
}
process.exit(0);
```

#### 11. tests/format-on-edit.test.ts:9-14
**File**: tests/format-on-edit.test.ts
**Changes**: MODIFY — N072 test: rewrite the header comment (it describes the deleted result.error-only behavior) and add the nonzero-status pin (unparseable file → status 0 exit, stderr warning, content unchanged).

```ts
// Black-box: the hook runs via process.execPath with the event on stdin;
// run.status + run.stderr + file mutation are the only observables
// (stdio: "ignore" inside the hook). N072: the spawn is node + Biome's JS
// launcher (no shell), a nonzero child status warns on stderr, and the
// hook still always exits 0.
```

(new test appended to the describe:)

```ts
  it("warns on stderr when Biome exits nonzero and leaves the file unchanged (N072)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lw-format-on-edit-"));
    try {
      const target = join(dir, "broken.ts");
      await writeFile(target, "const x = (", "utf8"); // biome cannot parse this
      const run = runHook(JSON.stringify({ tool_input: { file_path: target } }));
      assert.equal(run.status, 0); // the hook never vetoes an edit
      assert.match(run.stderr, /Biome exited/);
      assert.equal(await readFile(target, "utf8"), "const x = (");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
```

(the suite's fs/promises import gains `writeFile` if absent — mkdtemp/readFile/rm are already imported.)

#### 12. scripts/login-linkedin.ts:224
**File**: scripts/login-linkedin.ts
**Changes**: MODIFY — N073: "session captured" → "pair captured".

```ts
    console.log(`login-linkedin: pair captured — ${cookiePath}`);
```

#### 13. tests/login-linkedin.test.ts:92-131
**File**: tests/login-linkedin.test.ts
**Changes**: MODIFY — N073 test: console-spy pin — `/login-linkedin: pair captured/` present, `/session captured/` absent.

```ts
  it("logs 'pair captured' and never 'session captured' (N073)", async (t) => {
    const cookiePath = await workPath("pair-cookies.json");
    const dotEnvPath = await workPath("pair.env");
    const logs = t.mock.method(console, "log", console.log.bind(console));
    let polls = 0;
    const context: LoginContext = {
      cookies: async () => {
        polls += 1;
        return polls >= 2 ? JAR : JAR.filter((cookie) => cookie.name !== "li_at");
      },
      close: async () => {},
    };
    const result = await runLoginHelper({
      openContext: async () => context,
      cookiePath,
      dotEnvPath,
      env: {},
      pollMs: 2_000,
      sleepFn: async () => {},
      now: () => Date.UTC(2026, 10, 10, 0, 0, 0),
    });
    assert.deepEqual(result, { cookiePath, dotEnvUpdated: true });
    const lines = logs.mock.calls.map((call) => call.arguments.join(" "));
    assert.ok(lines.some((line) => /login-linkedin: pair captured — /.test(line)));
    assert.ok(lines.every((line) => !line.includes("session captured")));
  });
```

#### 14. scripts/fetch-linkedin.ts:353-368
**File**: scripts/fetch-linkedin.ts
**Changes**: MODIFY — N085: capture `git rebase --abort`'s exit code + output into `lastFailure`.

```ts
  const attempt = async (): Promise<boolean> => {
    const rebase = await git(["pull", "--rebase", "origin", "main"]);
    if (rebase.code !== 0) {
      lastFailure = rebase.output;
      console.error(`git: rebase failed — aborting — git said: ${rebase.output || "(no output)"}`);
      // N085: the abort itself can fail (e.g. no rebase in progress); its
      // exit code and output join lastFailure like every other git read —
      // the real cause is never silently discarded.
      const abort = await git(["rebase", "--abort"]);
      if (abort.code !== 0) {
        lastFailure = `${lastFailure}
rebase --abort also failed (code ${abort.code}): ${abort.output}`;
      }
      return false;
    }
    const push = await git(["push"]);
    if (push.code !== 0) lastFailure = push.output;
    return push.code === 0;
  };
```

#### 15. tests/fetch-linkedin.test.ts:362-382
**File**: tests/fetch-linkedin.test.ts
**Changes**: MODIFY — N085 test: script the abort (`rebase: { code: 1, output: "fatal: no rebase in progress" }`) and extend the reject predicate to assert the thrown message carries the abort's output.

```ts
  it("folds the abort's own failure into the failure record (N085)", async () => {
    const git = scriptGit({
      diff: 1,
      pull: { code: 1, output: "CONFLICT (content): Merge conflict in state/linkedin-posts.json" },
      rebase: { code: 1, output: "fatal: no rebase in progress" },
    });
    const payload = await workPath("push-abort-fail.json");
    await assert.rejects(
      () => pushPayload(git, 2, payload),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(message, /payload push failed twice/);
        assert.match(message, /fatal: no rebase in progress/);
        return true;
      },
    );
    assert.equal(git.calls.filter((args) => args[0] === "rebase" && args[1] === "--abort").length, 2);
  });
```

#### 16. src/linkedin-capture.ts:159-193
**File**: src/linkedin-capture.ts
**Changes**: MODIFY — N088: single-line JSON (drop `null, 2`, keep `\n`) and the `LINKEDIN_CAPTURE=off` switch in `makeFsCaptureSink` (env param defaulting to `process.env`; returns a no-op sink when off; never reads ambient env inside the sink body).

```ts
export function makeFsCaptureSink(
  root: string = LINKEDIN_CAPTURES_ROOT,
  now: () => number = Date.now,
  // Testability (the best-effort-prune pin): inject a throwing readdir to
  // prove a failed prune never fails the capture that just landed — the
  // ESM namespace cannot be monkey-patched (non-configurable properties).
  readdirFn: (path: string) => Promise<string[]> = readdir,
  // N088 kill switch: LINKEDIN_CAPTURE=off disables capture writing (the
  // operator's disk-pressure escape). Bare opt-in env read — deliberately
  // NOT an ENV_NAMES member (the sink is an injectable closure; the
  // documented default is capture ON).
  env: Record<string, string | undefined> = process.env,
): CaptureSink {
  if (env.LINKEDIN_CAPTURE === "off") {
    return async () => {};
  }
```

(and the write line, `:193`:)

```ts
      await writeFile(tempPath, `${JSON.stringify(record)}\n`, "utf8");
```

#### 17. tests/linkedin-capture.test.ts:82-110
**File**: tests/linkedin-capture.test.ts
**Changes**: MODIFY — N088 tests: no-interior-newline pin; kill switch via the lazy-stamp ENOENT idiom (`:97-110`); both new tests pass an explicit env argument so the suite stays hermetic under a `LINKEDIN_CAPTURE=off` operator shell.

```ts
  it("writes single-line JSON — no interior newline, trailing newline kept (N088)", async () => {
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW, readdir, {});
    await sink(record({ minted: 3, fresh: 2 }));
    const file = join(root, sessionStamp(() => NOW), "001-hiring-indonesia.json");
    const text = await readFile(file, "utf8");
    assert.ok(text.endsWith("\n"));
    assert.ok(!text.slice(0, -1).includes("\n"));
  });

  it("LINKEDIN_CAPTURE=off returns a no-op sink — no directory, no file (N088)", async () => {
    const root = await tempRoot();
    const sink = makeFsCaptureSink(root, () => NOW, readdir, { LINKEDIN_CAPTURE: "off" });
    await sink(record());
    await assert.rejects(() => readdir(join(root, sessionStamp(() => NOW))), /ENOENT/);
  });
```

#### 18. tests/pool.test.ts
**File**: tests/pool.test.ts
**Changes**: NEW — the runPool suite: claim order, width clamp, empty no-op, rejecting worker propagates (`judge-parse.test.ts` skeleton; `deferred` + `setImmediate` flush for out-of-order cases).

```ts
/**
 * runPool suite (N080): claim positionality, the width clamp, the empty
 * no-op, the concurrency cap, and the join contract — a rejecting worker
 * propagates (the caller owns the error), width 0 runs nothing (the caller
 * owns the floor; judgePosts wraps its width in Math.max(1, ...)).
 * judge-parse skeleton: pure leaf, no doubles beyond closures.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPool } from "../src/pool.js";

describe("runPool", () => {
  it("delivers the ORIGINAL index with each item", async () => {
    const seen: Array<[string, number]> = [];
    await runPool(["x", "y", "z"], 3, async (item, index) => {
      seen.push([item, index]);
    });
    assert.deepEqual(seen.sort((a, b) => a[1] - b[1]), [
      ["x", 0],
      ["y", 1],
      ["z", 2],
    ]);
  });

  it("runs every item exactly once across concurrent workers", async () => {
    const counts = new Map<string, number>();
    await runPool(["a", "b", "c", "d", "e"], 2, async (item) => {
      counts.set(item, (counts.get(item) ?? 0) + 1);
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.deepEqual([...counts.entries()].sort(), [
      ["a", 1],
      ["b", 1],
      ["c", 1],
      ["d", 1],
      ["e", 1],
    ]);
  });

  it("caps concurrent workers at the width", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5, 6], 2, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    assert.equal(peak, 2);
  });

  it("clamps the width to the item count — 10 over 2 items peaks at 2", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool([1, 2], 10, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
    });
    assert.equal(peak, 2);
  });

  it("runs an empty list as a no-op", async () => {
    let calls = 0;
    await runPool([], 4, async () => {
      calls += 1;
    });
    assert.equal(calls, 0);
  });

  it("width 0 runs nothing — the caller owns the floor (judgePosts Math.max(1, ...))", async () => {
    let calls = 0;
    await runPool([1, 2, 3], 0, async () => {
      calls += 1;
    });
    assert.equal(calls, 0);
  });

  it("propagates a rejecting worker (the caller owns the error)", async () => {
    await assert.rejects(
      () =>
        runPool([1, 2, 3], 2, async (item) => {
          if (item === 2) throw new Error("worker fault");
        }),
      /worker fault/,
    );
  });
});
```

#### 19. tests/config.test.ts
**File**: tests/config.test.ts
**Changes**: NEW — the config suite: `isHeartbeatEnabled` (default true, only exact "false" disables, trims + lowercases) and `runUrlFromEnv` (three GITHUB_* vars, undefined when any absent).

```ts
/**
 * Config suite (N080): the two pure env resolvers on src/config.ts —
 * isHeartbeatEnabled's exact-"false" contract (trimmed + lowercased, so
 * " FALSE " disables too) and runUrlFromEnv's three-variable GITHUB_* join.
 * Env literals only; no fs, no doubles.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHeartbeatEnabled, runUrlFromEnv } from "../src/config.js";

describe("isHeartbeatEnabled", () => {
  it("defaults to enabled when HEARTBEAT_ENABLED is absent", () => {
    assert.equal(isHeartbeatEnabled({}), true);
  });

  it("disables only on the exact string false, case- and whitespace-insensitive", () => {
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "false" }), false);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "  FALSE  " }), false);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "False" }), false);
  });

  it("stays enabled for any other value", () => {
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "true" }), true);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "1" }), true);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "0" }), true);
    assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "" }), true);
  });
});

describe("runUrlFromEnv", () => {
  it("returns undefined when any GITHUB_* variable is absent", () => {
    assert.equal(runUrlFromEnv({}), undefined);
    assert.equal(
      runUrlFromEnv({
        GITHUB_SERVER_URL: "https://github.com/owner/repo",
        GITHUB_REPOSITORY: "owner/repo",
      }),
      undefined,
    );
    assert.equal(
      runUrlFromEnv({
        GITHUB_SERVER_URL: "https://github.com/owner/repo",
        GITHUB_RUN_ID: "123",
      }),
      undefined,
    );
  });

  it("composes the run URL when all three variables are present", () => {
    assert.equal(
      runUrlFromEnv({
        GITHUB_SERVER_URL: "https://github.com/owner/repo",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_RUN_ID: "123",
      }),
      "https://github.com/owner/repo/actions/runs/123",
    );
  });
});
```

#### 20. tests/judge-exhaustion.test.ts
**File**: tests/judge-exhaustion.test.ts
**Changes**: NEW — the judge-exhaustion suite: `resolveBlockedPick`'s flavor arms (outstanding release → true at zero charge; active cooldown + budget → true with charge-before-sleep at earliest + 500ms jitter; cooldown + spent budget → false; all-blocked quiet pool → false; free-seat trailing arm → false) with fake `RotationState` + injected sleeps.

```ts
/**
 * judge-exhaustion suite (N080): resolveBlockedPick's D4 flavor split over
 * fake RotationState fixtures — the release wake re-picks at ZERO budget
 * charge, the cooldown park is the only budget draw (charge-before-sleep:
 * earliest + 500ms jitter), a spent budget is the exhaustion terminal, a
 * fully blocked quiet pool is terminal (the D11 dead-pool guard), and a
 * quiet pool with a free seat falls to the trailing terminal.
 * LlmAccount imports from ../src/judge.js today — Phase 2 re-points it to
 * the leaf. The fixture mirrors tests/judge-rotation.test.ts's canonical
 * freshState shape (it moves to judge-helpers in Phase 5; a .test.ts file
 * cannot be imported across files).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBlockedPick } from "../src/judge-exhaustion.js";
import type { LlmAccount } from "../src/judge.js";
import type { RotationState } from "../src/judge-rotation.js";

const ACCOUNTS: LlmAccount[] = [
  { baseUrl: "https://one.api/v1", apiKey: "k1", model: "m1" },
  { baseUrl: "https://two.api/v1", apiKey: "k2", model: "m2" },
];

const NOW = Date.UTC(2026, 10, 19, 5, 0, 0);
const inertSleep = async (): Promise<void> => {};

function state(overrides: Partial<RotationState> = {}): RotationState {
  return {
    accounts: ACCOUNTS,
    cooldownUntil: new Map(),
    ceilings: new Map(),
    blocked: new Map(),
    inFlight: new Map(),
    healthMarks: new Map(),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: 180_000,
    ...overrides,
  };
}

describe("resolveBlockedPick", () => {
  it("re-picks true at ZERO budget charge when a release is outstanding", async () => {
    const s = state({ inFlight: new Map([[0, 1]]) });
    const pending = resolveBlockedPick(s, () => NOW, inertSleep);
    await new Promise((resolve) => setImmediate(resolve)); // the waiter registers
    const waiter = s.ceilingWaiters[0];
    if (typeof waiter !== "function") {
      assert.fail("the release waiter never registered");
    }
    waiter(); // the release fires
    assert.equal(await pending, true);
    assert.equal(s.waitBudgetRemainingMs, 180_000);
  });

  it("parks on the cooldown within budget — charge-before-sleep (earliest + 500ms jitter)", async () => {
    const s = state({ cooldownUntil: new Map([[0, NOW + 4_000]]) });
    let tick = NOW;
    const result = await resolveBlockedPick(
      s,
      () => tick,
      async (ms) => {
        tick += ms; // the injected sleep advances the injected clock
      },
    );
    assert.equal(result, true);
    assert.equal(s.waitBudgetRemainingMs, 180_000 - 4_500);
  });

  it("returns false when the wait budget is spent — the exhaustion terminal", async () => {
    const s = state({ cooldownUntil: new Map([[0, NOW + 60_000]]), waitBudgetRemainingMs: 0 });
    assert.equal(await resolveBlockedPick(s, () => NOW, inertSleep), false);
    assert.equal(s.waitBudgetRemainingMs, 0);
  });

  it("returns false on a fully blocked quiet pool (the D11 dead-pool guard)", async () => {
    const s = state({
      blocked: new Map([
        [0, "refused: 503"],
        [1, "refused: 401"],
      ]),
    });
    assert.equal(await resolveBlockedPick(s, () => NOW, inertSleep), false);
  });

  it("returns false on a quiet pool with a merely free seat (the trailing terminal)", async () => {
    const s = state({ blocked: new Map([[0, "refused: 503"]]) });
    assert.equal(await resolveBlockedPick(s, () => NOW, inertSleep), false);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass with the new suites: `npm test` (expects > 670 passing; the N089 red pair green)
- [x] The three new suites pass standalone: `npx tsx --test tests/pool.test.ts tests/config.test.ts tests/judge-exhaustion.test.ts`
- [x] N089: `grep -n "linkedinWakeMinMinutes, 60" tests/config-file.test.ts` and `grep -n "linkedinWakeMaxMinutes, 60" tests/config-file.test.ts` return only the intentional explicit-value pins (the 55/65 and partial-band its), zero hits in the two former pair sites
- [x] N091: the two startLoop warn cases pass (crossing band warns once matching /PAYLOAD_MAX_AGE_MS/; 15/45 stays quiet)
- [x] N065: `grep -n "body.includes" scripts/probe-judge.ts` returns no hits (classifyResponse owns the gate)
- [x] N072: `grep -n "shell: true" scripts/hooks/format-on-edit.js` returns no hits
- [x] N073: `grep -n "session captured" scripts/login-linkedin.ts` returns no hits

#### Manual Verification:
- [ ] With `LINKEDIN_CAPTURE=off` in the environment, a real `npm run fetch-linkedin` tick creates no captures/ directory (operator-run; the offline pin covers the sink seam)
- [ ] The N091 warn reads as one plain console line naming PAYLOAD_MAX_AGE_MS and the freshness rule (eyeball in the loop suite output or a local loop start)

## Phase 2: Type homes + deps object

### Overview
N092: `LlmAccount` → new leaf `src/judge-account.ts` (14 importer re-points), `LinkedinSurface` → `src/config-file.ts` beside `Surface` (5 importer re-points), six stale constraint comments die; N069: `walkLinkedInSurface` → deps object (D-BP5: `scrollRounds` required). Byte-verbatim moves only. Depends on nothing logically; runs after Phase 1 on a green suite.

### Changes Required:

#### 1. src/judge-account.ts
**File**: src/judge-account.ts
**Changes**: NEW — the zero-import leaf holding only the `LlmAccount` interface (verbatim from `src/judge.ts:70-74` with its doc comment).

```ts
/**
 * One LLM account from the LLM_ACCOUNTS pool (N092's leaf home): ordered;
 * index 0 is tried first. Zero imports — a true leaf, so every judge-side
 * importer points INTO it without a runtime or type cycle (the
 * judge-shared -> judge-health -> judge back-edge family this move
 * deletes; madge --circular reads zero cycles with it).
 */

/** One LLM account from the LLM_ACCOUNTS pool (ordered; index 0 is tried first). */
export interface LlmAccount {
  baseUrl: string;
  apiKey: string;
  model: string;
}
```

#### 2. src/judge.ts:1-74
**File**: src/judge.ts
**Changes**: MODIFY — remove the `LlmAccount` definition; add `import type { LlmAccount } from "./judge-account.js";`. No re-export shim (knip). The facade block (`:25-36`) stays until Phase 3.

```ts
/** One LLM account from the LLM_ACCOUNTS pool (ordered; index 0 is tried first). */
export interface LlmAccount {
  baseUrl: string;
  apiKey: string;
  model: string;
}
```

(the interface block + doc comment above are DELETED from the file, and one type import is ADDED before the judge-dispatch import:)

```ts
import type { LlmAccount } from "./judge-account.js";
```

#### 3. src/index.ts:51
**File**: src/index.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `./judge-account.js` (the `JudgedPost`/`judgePosts`/`resolveJudgeConfig` members stay on `./judge.js`).

```ts
import type { LlmAccount } from "./judge-account.js";
import { type JudgedPost, judgePosts, resolveJudgeConfig } from "./judge.js";
```

(the new import lands immediately BEFORE the judge-availability import block — biome sort; replaces the single-line judge.js import)

#### 4. src/judge-availability.ts:28
**File**: src/judge-availability.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `./judge-account.js`.

```ts
import type { LlmAccount } from "./judge-account.js";
import { normalizeEndpoint, terminalFailureReason } from "./judge-shared.js";
```

#### 5. src/judge-ceilings.ts:13,28
**File**: src/judge-ceilings.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `./judge-account.js` (`:28`); the line-number rot citing `src/judge.ts:163-172` (`:13`) is fixed by DROPPING the cite (it re-rots on every judge.ts edit — the sentence reads "because parseLlmAccounts trims baseUrl and …").

```ts
import { JUDGE_CEILINGS_PATH } from "./config.js";
import type { LlmAccount } from "./judge-account.js";
import { stateTempPath } from "./state.js";
```

#### 6. src/judge-dispatch.ts:20-23,49-53
**File**: src/judge-dispatch.ts
**Changes**: MODIFY — `LlmAccount` type import re-points (`:53`); the stale cycle-doctrine comments (`:20-23` module header, `:49-52` "LlmAccount stays in judge.ts") are rewritten for the leaf home.

```ts
 * Cycle doctrine (N092): no ./judge.js import remains — LlmAccount lives
 * in the judge-account.ts leaf, so this module's judge-side edges point
 * INTO the leaf or DOWNWARD. judge.ts imports this module's runtime
 * symbols; a runtime edge back would close a real cycle. judgePost
 * defaults sleepFn to sleep from ./sleep.js (N060).
```

(the module-header comment above replaces the old "Cycle doctrine (the judge-rotation.ts:38-40 idiom)" block; the 4-line back-edge comment and the old judge.js type line are DELETED, replaced by one import placed with the other judge-* imports — immediately before judge-exhaustion:)

```ts
import type { LlmAccount } from "./judge-account.js";
import { resolveBlockedPick } from "./judge-exhaustion.js";
```

#### 7. src/judge-health.ts:34,102
**File**: src/judge-health.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `./judge-account.js` (`:34`); the line-number rot citing `src/judge.ts:163-172` (`:102`) is fixed by DROPPING the cite ("…trims baseUrl. Pure.").

```ts
import { JUDGE_HEALTH_PATH } from "./config.js";
import type { LlmAccount } from "./judge-account.js";
import { stateTempPath } from "./state.js";
```

#### 8. src/judge-rotation.ts:37-42
**File**: src/judge-rotation.ts
**Changes**: MODIFY — `LlmAccount` type import re-points (`:42`); the `:37-40` type-only-imports comment (the idiom other files cite) is rewritten for the leaf home.

```ts
// Type-only imports (D5): verbatimModuleSyntax erases them, so judge.ts and
// judge-dispatch.ts can import this module's runtime symbols with no runtime
// cycle. SleepFn moved to judge-dispatch.ts with judgePost (N042a) — the
// default `sleepFn: SleepFn = sleep` lives there now. N092: LlmAccount
// comes from the judge-account.ts leaf — this module's ZERO-RUNTIME-IMPORT
// identity is now total: no ./judge.js edge remains, type or runtime.
import type { LlmAccount } from "./judge-account.js";
import type { TickOutcomes } from "./judge-health.js";
import type { SleepFn } from "./sleep.js";
import type { AccountFailure } from "./types.js";
```

#### 9. scripts/probe-judge.ts:46
**File**: scripts/probe-judge.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `../src/judge-account.js` (lands immediately before the judge-ceilings import — biome sort).

```ts
import type { LlmAccount } from "../src/judge-account.js";
import { buildBulkMessages, resolveJudgeConfig } from "../src/judge.js";
```

(buildBulkMessages still rides the judge.js facade until Phase 3 re-points it.)

#### 10. tests/judge-helpers.ts:8
**File**: tests/judge-helpers.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `../src/judge-account.js`.

```ts
import type { LlmAccount } from "../src/judge-account.js";
```

#### 11. tests/judge.test.ts:9
**File**: tests/judge.test.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `../src/judge-account.js` (lands immediately before the judge-rotation import block — biome sort); the judge.js block loses the member (the `buildBulkMessages`/`judgePost` facade members stay until Phase 3).

```ts
import type { LlmAccount } from "../src/judge-account.js";
import {
  buildBulkMessages,
  judgePost,
  judgePosts,
  parseLlmAccounts,
  resolveJudgeConfig,
} from "../src/judge.js";
```

#### 12. tests/judge-rotation.test.ts:22
**File**: tests/judge-rotation.test.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `../src/judge-account.js` (lands immediately before the file's first judge-* import — biome sort).

```ts
import type { LlmAccount } from "../src/judge-account.js";
import { judgePost, judgePosts } from "../src/judge.js";
```

#### 13. tests/judge-availability.test.ts:4
**File**: tests/judge-availability.test.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `../src/judge-account.js` (lands immediately before the judge-availability import).

```ts
import type { LlmAccount } from "../src/judge-account.js";
import { checkJudgeAvailability } from "../src/judge-availability.js";
```

#### 14. tests/judge-ceilings.test.ts:12
**File**: tests/judge-ceilings.test.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `../src/judge-account.js` (lands immediately before the judge-ceilings import block).

```ts
import type { LlmAccount } from "../src/judge-account.js";
```

#### 15. tests/judge-health.test.ts:24
**File**: tests/judge-health.test.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `../src/judge-account.js` (lands immediately before the judge-health import block).

```ts
import type { LlmAccount } from "../src/judge-account.js";
```

#### 16. tests/index.test.ts:35
**File**: tests/index.test.ts
**Changes**: MODIFY — `LlmAccount` type import re-points to `../src/judge-account.js` (lands after the index.js import, before the judge-availability import).

```ts
import type { LlmAccount } from "../src/judge-account.js";
```

#### 17. src/config-file.ts:16-19
**File**: src/config-file.ts
**Changes**: MODIFY — add `LinkedinSurface` beside `Surface` (verbatim `Extract<Surface, { type: "linkedin" }>` with its doc comment).

```ts
/** One configured linkedin surface (raw keyword string, never a URL). */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;
```

#### 18. src/linkedin-fetch.ts:28,70
**File**: src/linkedin-fetch.ts
**Changes**: MODIFY — remove the local `LinkedinSurface` export; extend the existing `import type { Surface }` from `./config-file.js` with `LinkedinSurface`.

```ts
import type { LinkedinSurface } from "./config-file.js";
```

(and the local definition + doc comment are DELETED verbatim from the file; the merged import drops `Surface` — the deleted Extract was its last use in the file)

```ts
/** One configured linkedin surface (raw keyword string, never a URL). */
export type LinkedinSurface = Extract<Surface, { type: "linkedin" }>;
```

#### 19. src/index.ts:52
**File**: src/index.ts
**Changes**: MODIFY — `LinkedinSurface` type import re-points to `./config-file.js`.

```ts
import {
  type LinkedinSurface,
  type ResolvedSurface,
  type Surface,
  type WatcherConfig,
  loadWatcherConfig,
  resolveSurfaces,
} from "./config-file.js";
```

(and the `import type { LinkedinSurface } from "./linkedin-fetch.js";` line is DELETED)

#### 20. scripts/fetch-linkedin.ts:42
**File**: scripts/fetch-linkedin.ts
**Changes**: MODIFY — `LinkedinSurface` type import re-points to `../src/config-file.js`.

```ts
import { type LinkedinSurface, type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
```

(and `  type LinkedinSurface,` is REMOVED from the linkedin-fetch import block at `:40-48`)

#### 21. scripts/probe-linkedin.ts:42
**File**: scripts/probe-linkedin.ts
**Changes**: MODIFY — `LinkedinSurface` type import re-points to `../src/config-file.js` (the same member-merge into this script's config-file import as §20; verify the exact config-file import line on disk) and is removed from the linkedin-fetch block (`:40-48`).

```ts
import { type LinkedinSurface, type WatcherConfig, loadWatcherConfig } from "../src/config-file.js";
```

#### 22. tests/linkedin-fetch.test.ts:34
**File**: tests/linkedin-fetch.test.ts
**Changes**: MODIFY — `LinkedinSurface` type import re-points to `../src/config-file.js` (the facade members on this same import block are re-pointed in Phase 3).

```ts
import type { LinkedinSurface } from "../src/config-file.js";
```

(and `  type LinkedinSurface,` is REMOVED from the linkedin-fetch import block at `:29-45`)

#### 23. src/linkedin-walk.ts:23-27
**File**: src/linkedin-walk.ts
**Changes**: MODIFY — N092 flip + N069 conversion: the `LinkedinSurface` import re-points to `./config-file.js` and the stale back-edge comment (`:23-26`) dies; the nine-positional signature becomes `walkLinkedInSurface(context, surface, deps: WalkLinkedInDeps)` with a top-of-function defaults block (`captureOrdinal` required field; `captureSink` the sole `| undefined` field; `scrollRounds` required per D-BP5; `label`/`minClicks`/`seenIds`/`nowFn` optional with "Default: ..." JSDoc mirroring `FetchLinkedInDeps`).

```ts
import type { LinkedinSurface } from "./config-file.js";
```

(the linkedin-fetch type import + its 4-line back-edge comment are DELETED; the module header `:7-13` gains one line after "stay orchestration-side in linkedin-fetch.ts.": "The walk's trailing options live in WalkLinkedInDeps (N069); scrollRounds stays a REQUIRED deps field — the caller passes its resolved value, so the default constant never moves here." The new interface + signature replace the nine-positional signature; the body is UNCHANGED below the defaults block:)

```ts
/**
 * The walk's options (N069): the seven trailing positional parameters of
 * walkLinkedInSurface collapsed into one object — the FetchLinkedInDeps
 * idiom (optional fields with "Default: ..." JSDoc, defaults resolved at
 * the top of the function). `context` and `surface` stay positional (the
 * required lead pair, the "`surfaces` stays first positional" doctrine).
 * `scrollRounds` and `captureOrdinal` are REQUIRED deps fields: the walk
 * header keeps the scroll-rounds default orchestration-side (the caller
 * always passes its resolved value) and the ordinal is the shared
 * per-tick counter minted by fetchLinkedInPosts (D7 — a walk-minted
 * default would break cross-surface filename uniqueness). `captureSink`
 * is the one `| undefined` field: exactOptionalPropertyTypes forbids
 * assigning undefined to a plain optional field (the contextFactory
 * rule, src/linkedin-fetch.ts:124-127).
 */
interface WalkLinkedInDeps {
  /** Load-more click ceiling (the config knob). Required: the caller resolves it. */
  scrollRounds: number;
  /** The probe's Load-more click floor. Default: 0 (no floor — the tick's shape). */
  minClicks?: number;
  /** Seen ids feeding the consecutive-seen stop. Default: a FRESH empty set per call. */
  seenIds?: ReadonlySet<string>;
  /** Capture sink. Default: undefined — capture DISABLED. */
  captureSink?: CaptureSink | undefined;
  /** Shared per-tick capture ordinal minted by fetchLinkedInPosts (D7). Required. */
  captureOrdinal: { value: number };
  /** Clock for the capture stamps. Default: Date.now. */
  nowFn?: () => number;
  /** Log label. Default: `linkedin/${surface.value}`. */
  label?: string;
}

export async function walkLinkedInSurface(
  context: ContextLike,
  surface: LinkedinSurface,
  deps: WalkLinkedInDeps,
): Promise<Post[]> {
  // Defaults resolved once, at the top (the FetchLinkedInDeps idiom).
  const label = deps.label ?? `linkedin/${surface.value}`;
  const scrollRounds = deps.scrollRounds;
  const minClicks = deps.minClicks ?? 0;
  const seenIds = deps.seenIds ?? new Set<string>();
  const captureSink = deps.captureSink;
  const captureOrdinal = deps.captureOrdinal;
  const nowFn = deps.nowFn ?? Date.now;
```

#### 24. src/linkedin-fetch.ts:286-296
**File**: src/linkedin-fetch.ts
**Changes**: MODIFY — N069 call site: the nine positional args collapse to `(context, surface, { scrollRounds, minClicks, seenIds, captureSink, captureOrdinal, now })`.

```ts
        const posts = await walkLinkedInSurface(context, surface, {
          scrollRounds,
          minClicks,
          seenIds,
          captureSink,
          captureOrdinal,
          nowFn: now,
        });
```

(the local `label` const at `:279` STAYS — the catch arms `fetch: ${label} HALT` / `LEG DEAD` / `FAILED` read it; the walk now derives its own identical label; the deps key is `nowFn: now` — the deps field is `nowFn`, the fetchLinkedInPosts local is `now`)

#### 25. tests/judge-exhaustion.test.ts
**File**: tests/judge-exhaustion.test.ts
**Changes**: MODIFY — the Phase 1 suite's `LlmAccount` import re-points to the leaf (lands immediately before the judge-exhaustion import — biome sort); the header comment's "Phase 2 re-points it" sentence becomes past tense.

```ts
import type { LlmAccount } from "../src/judge-account.js";
```

(replaces `import type { LlmAccount } from "../src/judge.js";` — judge.ts exports no LlmAccount after §2)

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Zero cycles: `npx madge --circular src scripts` reports 0 cycles
- [x] knip stays clean: `npx knip` exits 0 (the leaf has 15 importers; no re-export shim anywhere)
- [x] N092: `grep -n "export interface LlmAccount" src/judge.ts` returns no hits AND `grep -rl 'from "./judge-account.js"' src | wc -l` returns 7 (judge.ts, index.ts, judge-availability, judge-ceilings, judge-dispatch, judge-health, judge-rotation — the complete src set, verifier-grepped)
- [x] N092: LinkedinSurface resolves from `config-file.js` everywhere (linkedin-fetch.ts has no LinkedinSurface export)
- [x] N069: `grep -rn "walkLinkedInSurface" tests/` returns zero hits (no test callers) and the signature reads `(context, surface, deps)`
- [x] Import order normalized: `npx biome check --write src/judge.ts src/judge-account.ts src/index.ts src/judge-availability.ts src/judge-ceilings.ts src/judge-dispatch.ts src/judge-health.ts src/judge-rotation.ts scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/probe-linkedin.ts tests/judge-helpers.ts tests/judge.test.ts tests/judge-rotation.test.ts tests/judge-availability.test.ts tests/judge-ceilings.test.ts tests/judge-health.test.ts tests/index.test.ts tests/linkedin-fetch.test.ts src/config-file.ts src/linkedin-fetch.ts src/linkedin-walk.ts tests/judge-exhaustion.test.ts` exits 0 with no remaining diffs (write-scoped to this phase's file set)

#### Manual Verification:
- [ ] The walk header :7-13 and the new WalkLinkedInDeps JSDoc tell one consistent story about where the scroll default lives

## Phase 3: Facade execution

### Overview
N067+N076: delete both REMOVAL NOTE blocks and re-point every facade-path importer in the same phase (the `44dafd7` lesson — partial execution does not compound). The SCROLL_JS source-text describe dies with its facade import. Depends on Phase 2 (`tests/linkedin-fetch.test.ts:32-45` is edited twice: the LinkedinSurface flip landed in Phase 2, the facade-symbol move lands here).

### Changes Required:

#### 1. src/judge.ts:25-36
**File**: src/judge.ts
**Changes**: MODIFY — delete the judge facade block (comment + both re-exports). `judge.ts` now exports only natives.

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

(the whole block above is DELETED; the native `import { judgeBatch, judgePost } from "./judge-dispatch.js";` at `:17` STAYS — judgePosts' body calls judgePost)

#### 2. tests/judge.test.ts:8-15
**File**: tests/judge.test.ts
**Changes**: MODIFY — split the six-symbol import: `buildBulkMessages` → `../src/judge-prompts.js`, `judgePost` → `../src/judge-dispatch.js`; `judgePosts`/`parseLlmAccounts`/`resolveJudgeConfig` stay on `../src/judge.js`.

```ts
import { judgePost } from "../src/judge-dispatch.js";
import { buildBulkMessages } from "../src/judge-prompts.js";
import { judgePosts, parseLlmAccounts, resolveJudgeConfig } from "../src/judge.js";
```

(judge-account import unchanged from Phase 2 §11; biome order: judge-account, judge-dispatch, judge-prompts, the rotation block, judge.js)

#### 3. tests/judge-rotation.test.ts:22
**File**: tests/judge-rotation.test.ts
**Changes**: MODIFY — `judgePost` → `../src/judge-dispatch.js`; `judgePosts` stays native.

```ts
import { judgePost } from "../src/judge-dispatch.js";
import { judgePosts } from "../src/judge.js";
```

(replaces the 2-member judge.js import; the judge-account import from Phase 2 §12 is unchanged)

#### 4. scripts/probe-judge.ts:46
**File**: scripts/probe-judge.ts
**Changes**: MODIFY — `buildBulkMessages` → `../src/judge-prompts.js`; `resolveJudgeConfig` stays.

```ts
import { buildBulkMessages } from "../src/judge-prompts.js";
import { resolveJudgeConfig } from "../src/judge.js";
```

(replaces the 2-member judge.js import; the judge-account import from Phase 2 §9 is unchanged; Phase 1 §5's classifyResponse sits in a disjoint region)

#### 5. src/linkedin-fetch.ts:46-68
**File**: src/linkedin-fetch.ts
**Changes**: MODIFY — delete the linkedin-fetch facade block (stale consumer list included).

```ts
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
```

(the whole block above is DELETED; natives stay: SleepFn, PACE_MIN_MS/PACE_MAX_MS, LINKEDIN_PROFILE_DIR, resolveLinkedInProfileDir, fetchLinkedInPosts; linkedin-fetch.ts consumes the context symbols via its own :32-41 import — untouched)

#### 6. tests/linkedin-fetch.test.ts:32-45
**File**: tests/linkedin-fetch.test.ts
**Changes**: MODIFY — the SIX facade symbols (`allSurfacesFaulted`, `halt`, `isAllSurfacesFaulted`, `isHalt`, `isLegDead`, `legDead`) move to `../src/linkedin-context.js`; the native members stay.

```ts
import {
  allSurfacesFaulted,
  halt,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
  legDead,
} from "../src/linkedin-context.js";
```

(the new context import lands BEFORE the linkedin-fetch block — biome sort; the linkedin-fetch block shrinks to its natives: LINKEDIN_PROFILE_DIR, PACE_MAX_MS, PACE_MIN_MS, fetchLinkedInPosts, resolveLinkedInProfileDir; verifier finding applied: the file NEVER imported `type LinkedInContextFactory` — its double `fakeContextFactory` at :176 is structurally typed — so the context import carries exactly six members, no type member)

#### 7. tests/probe-linkedin.test.ts:31-37
**File**: tests/probe-linkedin.test.ts
**Changes**: MODIFY — `LinkedInContextFactory` + the three guards → `../src/linkedin-context.js`; `LINKEDIN_PROFILE_DIR` stays.

```ts
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import { LINKEDIN_PROFILE_DIR } from "../src/linkedin-fetch.js";
```

(replaces the mixed block at `:31-37` on the post-Phase-2 base)

#### 8. tests/fetch-linkedin.test.ts:35,1048-1068
**File**: tests/fetch-linkedin.test.ts
**Changes**: MODIFY — N076 (D14): delete the SCROLL_JS source-text describe (`:1048-1068`) and drop the `SCROLL_JS` member from the `:35` import (the remaining facade members move per the Phase 3 split).

```ts
import { type LinkedInContextFactory, isLegDead } from "../src/linkedin-context.js";
```

(the `:35` import line is replaced by the line above — LinkedInContextFactory + isLegDead move to context, SCROLL_JS dies with the describe below — and the SCROLL_JS source-text describe is DELETED whole:)

```ts
describe("SCROLL_JS content (Phase 5: the live-only revision, pinned as a string)", () => {
  it("carries all four scroll-container candidates", () => {
    assert.ok(SCROLL_JS.includes("document.scrollingElement"));
    assert.ok(
      SCROLL_JS.includes(
        "querySelectorAll(\"main, [data-testid='lazy-column'], .scaffold-finite-scroll\")",
      ),
    );
    assert.ok(SCROLL_JS.includes('sel: "window"'));
    assert.ok(SCROLL_JS.includes("el.tagName.toLowerCase()"));
  });

  it("reports the JSON contract (sel/top/sh/ch, sel none when nothing qualifies)", () => {
    assert.ok(SCROLL_JS.includes("JSON.stringify"));
    assert.ok(SCROLL_JS.includes("sel: pick.sel"));
    assert.ok(SCROLL_JS.includes("top: Math.round(pick.el.scrollTop)"));
    assert.ok(SCROLL_JS.includes("sh: pick.el.scrollHeight"));
    assert.ok(SCROLL_JS.includes("ch: pick.el.clientHeight"));
    assert.ok(SCROLL_JS.includes('sel: "none"'));
  });
});
```

#### 9. scripts/watch-linkedin.ts:29
**File**: scripts/watch-linkedin.ts
**Changes**: MODIFY — `isLegDead` → `../src/linkedin-context.js`; native `SleepFn` stays on `../src/linkedin-fetch.js`.

```ts
import { isLegDead } from "../src/linkedin-context.js";
import { type SleepFn } from "../src/linkedin-fetch.js";
```

(replaces the single mixed import line; biome: linkedin-context before linkedin-fetch, after linkedin-behavior; Phase 1's payload import lands at :30 — disjoint region)

#### 10. tests/watch-linkedin.test.ts:17
**File**: tests/watch-linkedin.test.ts
**Changes**: MODIFY — `legDead` → `../src/linkedin-context.js`.

```ts
import { legDead } from "../src/linkedin-context.js";
```

(replaces the linkedin-fetch legDead import line; lands between the linkedin-behavior and linkedin-fetch imports — biome sort; Phase 1's two N091 tests sit in a disjoint region)

#### 11. scripts/fetch-linkedin.ts:40-48
**File**: scripts/fetch-linkedin.ts
**Changes**: MODIFY — the import block splits: `LinkedInContextFactory`/`isAllSurfacesFaulted`/`isHalt`/`isLegDead` → `../src/linkedin-context.js`; `fetchLinkedInPosts`/`resolveLinkedInProfileDir` stay; `LinkedinSurface` already on `config-file.js` from Phase 2.

```ts
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import { fetchLinkedInPosts, resolveLinkedInProfileDir } from "../src/linkedin-fetch.js";
```

(replaces the mixed block; Phase 1 §14's attempt-closure edit sits in a disjoint region)

#### 12. scripts/probe-linkedin.ts:40-48
**File**: scripts/probe-linkedin.ts
**Changes**: MODIFY — the same split: `LinkedInContextFactory`/`isAllSurfacesFaulted`/`isHalt`/`isLegDead` → `../src/linkedin-context.js`; `fetchLinkedInPosts`/`resolveLinkedInProfileDir` stay.

```ts
import {
  type LinkedInContextFactory,
  isAllSurfacesFaulted,
  isHalt,
  isLegDead,
} from "../src/linkedin-context.js";
import { fetchLinkedInPosts, resolveLinkedInProfileDir } from "../src/linkedin-fetch.js";
```

(replaces the mixed block; Phase 2 §21's config-file member-merge is in a disjoint region)

#### 13. src/linkedin-walk-static.ts:6
**File**: src/linkedin-walk-static.ts
**Changes**: MODIFY — the header's stale SCROLL_JS content-test citation (`tests/fetch-linkedin.test.ts:986`) dies with the describe.

```ts
// (the header clause "...SCROLL_JS content test (tests/fetch-linkedin.test.ts:986)"
//  is DROPPED — the sentence now ends at the module provenance without the
//  stale pin reference; the pin was already stale at HEAD — the describe
//  lived at :1048)
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Zero cycles: `npx madge --circular src scripts` reports 0 cycles
- [x] knip stays clean: `npx knip` exits 0
- [x] N067: `grep -rn "REMOVAL NOTE" src/` returns no hits
- [x] N067: `grep -nE "\\bbuildBulkMessages\\b|\\bjudgePost\\b" tests/judge.test.ts tests/judge-rotation.test.ts scripts/probe-judge.ts | grep "src/judge.js"` returns no hits (the facade members re-pointed; word-boundary form — `judgePost` is a substring of the native `judgePosts`, the plain-substring grep cannot return zero)
- [x] N067: `grep -rn "from \"../src/linkedin-fetch.js\"\|from \"./linkedin-fetch.js\"" src scripts tests | grep -E "LinkedInContextFactory|allSurfacesFaulted|halt|isAllSurfacesFaulted|isHalt|isLegDead|legDead|SCROLL_JS"` returns no hits (zero facade-path consumers remain)
- [x] N076: `grep -n "SCROLL_JS" tests/fetch-linkedin.test.ts` returns no hits
- [x] Import order normalized: `npx biome check --write src/judge.ts src/linkedin-fetch.ts src/linkedin-walk-static.ts tests/judge.test.ts tests/judge-rotation.test.ts tests/linkedin-fetch.test.ts tests/probe-linkedin.test.ts tests/fetch-linkedin.test.ts tests/watch-linkedin.test.ts scripts/probe-judge.ts scripts/watch-linkedin.ts scripts/fetch-linkedin.ts scripts/probe-linkedin.ts` exits 0 with no remaining diffs

#### Manual Verification:
- [ ] judge.ts's export surface is natives-only (parseLlmAccounts, resolveJudgeConfig, judgePosts, JudgedPost); linkedin-fetch.ts's export surface is natives-only (SleepFn, PACE_MIN_MS, PACE_MAX_MS, LINKEDIN_PROFILE_DIR, resolveLinkedInProfileDir, fetchLinkedInPosts)

## Phase 4: Extractions

### Overview
N075: `src/pipeline-helpers.ts` (surfaceLabel + dedupePosts exported, mergeSurfaceStamps private) with index.ts slimmed and the one test import re-pointed. N080: `src/judge-ramp.ts` (classifyResponse + rampLevel + findConcurrencyCeiling + RAMP_MAX, fetchFn-injected per D-BP6), the probe's entry guard lands, and N065's check moves into `classifyResponse`. Depends on Phase 2 (probe-judge.ts import block settled).

### Changes Required:

#### 1. src/pipeline-helpers.ts
**File**: src/pipeline-helpers.ts
**Changes**: NEW — the three helpers moved verbatim from `src/index.ts:587-627` (`surfaceLabel` + `dedupePosts` exported; `mergeSurfaceStamps` module-private); type-only imports of `./types.js` + `./config-file.js`.

```ts
/**
 * The pipeline's pure helpers (N075): the dedupe/funnel-join and the D14
 * log-label functions, moved verbatim out of src/index.ts so the entry
 * module owns orchestration only and the pure tail is unit-testable in
 * isolation. surfaceLabel and dedupePosts are EXPORTED (index.ts and
 * tests/index.test.ts consume them); mergeSurfaceStamps stays
 * module-private (its only caller is dedupePosts, which moved with it —
 * an export with zero importers fails knip). Type-only imports of
 * types/config-file keep this module a zero-runtime-import leaf
 * (verbatimModuleSyntax erases both).
 */
import type { Surface } from "./config-file.js";
import type { Post } from "./types.js";

/** D14 log label for one raw config surface. */
export function surfaceLabel(surface: Surface): string {
  if (surface.type === "linkedin") return `linkedin/${surface.value}`;
  if (surface.type === "tag") return `tag/${surface.value}`;
  return surface.value; // url surfaces log verbatim
}

/**
 * Dedupe posts by id, keeping first-seen order (D5). Surface stamps on a
 * later duplicate merge into the kept post — a post collected by N
 * surfaces rides every matching surface email (FR2). Map re-sets keep the
 * first-seen position; the inputs and their stamp arrays are never
 * mutated.
 */
export function dedupePosts(posts: readonly Post[]): Post[] {
  const byId = new Map<string, Post>();
  for (const post of posts) {
    const kept = byId.get(post.id);
    byId.set(post.id, kept === undefined ? post : mergeSurfaceStamps(kept, post));
  }
  return [...byId.values()];
}

/**
 * Union of the stamps on two duplicate posts (D5): kept stamps first, then
 * the unseen ones from the duplicate, into a FRESH array. Under
 * exactOptionalPropertyTypes the field stays off the post entirely when
 * no stamps exist (legacy payload rows predate the stamp).
 */
function mergeSurfaceStamps(kept: Post, duplicate: Post): Post {
  const merged = [...(kept.surfaces ?? [])];
  for (const stamp of duplicate.surfaces ?? []) {
    const key = `${stamp.type}|${stamp.value}`;
    if (merged.some((existing) => `${existing.type}|${existing.value}` === key)) continue;
    merged.push(stamp);
  }
  return {
    ...kept,
    ...(merged.length > 0 ? { surfaces: merged } : {}),
  };
}
```

#### 2. src/index.ts:1-30,586-628
**File**: src/index.ts
**Changes**: MODIFY — remove the three functions and their doc comments; add `import { dedupePosts, surfaceLabel } from "./pipeline-helpers.js";`. The entry guard (`:629-634`) and its purity comment are untouched.

```ts
import { dedupePosts, surfaceLabel } from "./pipeline-helpers.js";
```

(the helper block :586-628 is DELETED whole; because surfaceLabel was the module's sole bare `Surface` use, the config-file import block also drops its now-dead `type Surface` member:)

```ts
import {
  type LinkedinSurface,
  type ResolvedSurface,
  type WatcherConfig,
  loadWatcherConfig,
  resolveSurfaces,
} from "./config-file.js";
```

#### 3. tests/index.test.ts:31
**File**: tests/index.test.ts
**Changes**: MODIFY — `dedupePosts` moves to the new module import; `flushAndSendExhaustionAlarm`/`runWatcher`/`timeStage` stay on `../src/index.js`.

```ts
import { flushAndSendExhaustionAlarm, runWatcher, timeStage } from "../src/index.js";
import { dedupePosts } from "../src/pipeline-helpers.js";
```

#### 4. src/judge-ramp.ts
**File**: src/judge-ramp.ts
**Changes**: NEW — the pure ramp module: `ProbeOutcome`, `RAMP_MAX = 32`, `classifyResponse(status, body)` (JSON parse + required `"choices"` — N065's check), `probeFetch(...)` (the old `timed`, fetchFn-injected), `rampLevel(...)`, `findConcurrencyCeiling(...)` — bodies verbatim from `scripts/probe-judge.ts:104-194`; lands with ENTRY-ONLY exports (probeFetch/findConcurrencyCeiling/ProbeOutcome — the script's imports); classifyResponse/rampLevel/RAMP_MAX gain `export` in Phase 5 when the suite imports them; endpoint normalization rides `normalizeEndpoint` called BARE (it returns the full URL — the F006 precedent, judge-availability.ts:116).

```ts
/**
 * The probe's ramp decision machinery (N080): the per-call outcome
 * classifier, the IO probe call, the parallel ramp level, and the doubling
 * ceiling walk — moved out of scripts/probe-judge.ts so they are
 * unit-testable offline (the judge-ceilings.ts precedent: the probe's
 * writer lives in src/ for exactly this reason). fetchFn is a trailing
 * injected parameter (the judge.ts fetchFn idiom) so the offline suite
 * scripts responses; nothing in the ramp path sleeps — a refused level IS
 * the ceiling signal, and the 120s AbortSignal stays verbatim. Phase 4
 * lands the module with ENTRY-ONLY exports (probeFetch,
 * findConcurrencyCeiling, ProbeOutcome — the script's imports); Phase 5's
 * ramp suite adds `export` to classifyResponse, rampLevel, and RAMP_MAX
 * when it starts importing them (knip flags exports with zero importers).
 * classifyResponse owns the N065 success gate: a completion PARSES as JSON
 * and carries a chat-completions "choices" array; anything else is a
 * failed leg.
 */
import type { LlmAccount } from "./judge-account.js";
import { normalizeEndpoint } from "./judge-shared.js";

/** One probe call's classified outcome (verbatim from scripts/probe-judge.ts). */
export type ProbeOutcome =
  | { kind: "ok" }
  | { kind: "refused"; status: number }
  | { kind: "failed"; message: string };

/**
 * N065: classify one probe response. The old gate — a bare
 * `body.includes("{")` — matched any brace-carrying text, so a refusal
 * rendered as prose with one brace read OK. A real completion PARSES as
 * JSON and carries a chat-completions "choices" array; anything else is a
 * failed leg (a refusal-as-data body with valid error JSON still fails the
 * choices check).
 */
function classifyResponse(status: number, body: string): ProbeOutcome {
  if (status < 200 || status >= 300) return { kind: "refused", status };
  try {
    const parsed = JSON.parse(body) as { choices?: unknown };
    if (parsed.choices === undefined) {
      return { kind: "failed", message: "response carried no chat-completions choices" };
    }
    return { kind: "ok" };
  } catch {
    return { kind: "failed", message: "response was not valid JSON" };
  }
}

/**
 * One probe call: fetch + classify, with the per-call attributable log
 * line (every line carries the account label, so interleaved peer output
 * stays attributable). Body verbatim from scripts/probe-judge.ts's timed
 * (:104-135) with fetchFn threaded and the endpoint normalization riding
 * judge-shared's normalizeEndpoint — called BARE: it returns the FULL
 * endpoint URL (the F006 drift-proofing export's documented shape).
 */
export async function probeFetch(
  label: string,
  payload: unknown,
  account: LlmAccount,
  fetchFn: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetchFn(normalizeEndpoint(account.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    const elapsed = Date.now() - started;
    const outcome = classifyResponse(response.status, body);
    if (outcome.kind === "refused") {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} REFUSED`);
    } else if (outcome.kind === "failed") {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} NO CHOICES`);
    } else {
      console.log(`probe: ${label} — ${elapsed}ms — HTTP ${response.status} OK`);
    }
    return outcome;
  } catch (error) {
    const elapsed = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`probe: ${label} — ${elapsed}ms — FAILED: ${message}`);
    return { kind: "failed", message };
  }
}

/**
 * Safety cap for the doubling ramp: the probe never fires more than 32
 * concurrent calls per account, even against an endpoint that never
 * refuses. Overrides the earlier stop-at-4 quota economy (2026-11-07
 * operator decision: maximal per-account concurrency requested). Worst
 * case is 2+4+8+16+32 = 62 verified calls per account per probe.
 */
const RAMP_MAX = 32;

/**
 * Fire `count` bulk calls at once and classify each outcome; each call's
 * label names the account ("<account label> ramp L<count>") so interleaved
 * peer output stays attributable. Body verbatim (:138-154) with probeFetch.
 */
async function rampLevel(
  count: number,
  payload: unknown,
  account: LlmAccount,
  label: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: number; refused: number; failed: number; ms: number }> {
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: count }, () =>
      probeFetch(`${label} ramp L${count}`, payload, account, fetchFn),
    ),
  );
  return {
    ok: results.filter((result) => result.kind === "ok").length,
    refused: results.filter((result) => result.kind === "refused").length,
    failed: results.filter((result) => result.kind === "failed").length,
    ms: Date.now() - started,
  };
}

/**
 * Doubling ramp 2 -> 4 -> 8 -> 16 -> 32 (RAMP_MAX): each level fires
 * `level` concurrent verified bulk calls and the walk stops at the first
 * level that is not fully clean, so the ceiling reads as high as the
 * endpoint actually allows. A refused level reads the ceiling below it; a
 * failed call means a broken endpoint, not a ceiling (return 0). The walk
 * never fires a level the previous one ruled out. Body verbatim
 * (:172-194) with rampLevel(fetchFn).
 */
export async function findConcurrencyCeiling(
  payload: unknown,
  account: LlmAccount,
  label: string,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  for (let level = 2; level <= RAMP_MAX; level *= 2) {
    const result = await rampLevel(level, payload, account, label, fetchFn);
    console.log(
      `probe: ${label} — concurrency ${level} — ${result.ok}/${level} ok, ${result.refused} refused, ${result.failed} failed in ${result.ms}ms`,
    );
    if (result.failed > 0) {
      console.log(
        `probe: ${label} — a ramp call failed — broken endpoint, not a concurrency ceiling`,
      );
      return 0;
    }
    if (result.ok < level) {
      console.log(`probe: ${label} — concurrency ceiling is below ${level}`);
      return level / 2;
    }
  }
  return RAMP_MAX;
}
```

#### 5. scripts/probe-judge.ts:1-60,104-200,335-340
**File**: scripts/probe-judge.ts
**Changes**: MODIFY — supersedes this file's Phase 1 §5 fence (the N065 check now lives in `classifyResponse`; this phase's fence is the change set applied on top of the Phase 1 state). `timed`/`rampLevel`/`RAMP_MAX`/`findConcurrencyCeiling` bodies AND the local `type ProbeOutcome` (`:83-87` — it moves verbatim into the module; keeping both is a TS2440 duplicate) are deleted, superseding Phase 1 §5's inline `classifyResponse`; the top-level `const CONFIG = await loadWatcherConfig()` (`:50`) moves inside `main()`, and `CONFIG` threads into `probeAccount` as a parameter (`probeAccount(index, account, config)` — it reads `CONFIG.keywords`/`CONFIG.reasoningEffort` at `:247`; `main()` passes it at the `accounts.map` call); the bare `await main()` (`:340`) is wrapped in the seven-sibling entry guard (adds the `node:url` + `pathToFileURL` import) — importing the module now performs no config load and no main run.

```ts
import { type ProbeOutcome, findConcurrencyCeiling, probeFetch } from "../src/judge-ramp.js";
```

(and the WatcherConfig type import is added — a separate line, lint-clean; biome sorts it with the config-file block:)

```ts
import type { WatcherConfig } from "../src/config-file.js";
```

(the DELETED-whole list: `timed` :104-135, `rampLevel` :138-154, the `RAMP_MAX` const + doc :156-161, `findConcurrencyCeiling` :172-194, Phase 1 §5's inline `classifyResponse`, and the local `type ProbeOutcome` :83-87)

(probeAccount's signature gains the config parameter:)

```ts
async function probeAccount(
  index: number,
  account: LlmAccount,
  config: WatcherConfig,
): Promise<{ probe: AccountProbe; ceiling: number }> {
```

(its bulkPayload reads become config reads:)

```ts
  const bulkPayload = {
    model: account.model,
    messages: buildBulkMessages(ten, config.keywords),
    temperature: 0,
    reasoning_effort: config.reasoningEffort,
    response_format: { type: "json_object" },
  };
```

(the three timed call sites become probeFetch — same arg order, the fourth param defaults:)

```ts
  const minimal = await probeFetch(
    `${label} minimal call`,
    {
      model: account.model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      temperature: 0,
    },
    account,
  );
```

```ts
  const bulk = await probeFetch(
    `${label} bulk call (10 posts, production prompt shape)`,
    bulkPayload,
    account,
  );
  const again = await probeFetch(`${label} bulk call again (variance check)`, bulkPayload, account);
```

(main gains the config read as its first statement and threads it:)

```ts
async function main(): Promise<void> {
  // Read once at startup; a missing or malformed file fails the probe loudly.
  const config = await loadWatcherConfig();
  let accounts: LlmAccount[];
```

```ts
  const settled = await Promise.allSettled(
    accounts.map((account, index) => probeAccount(index, account, config)),
  );
```

(the bare tail is wrapped in the seven-sibling entry guard — the `import { pathToFileURL } from "node:url";` import is added:)

```ts
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Tests pass: `npm test`
- [x] Zero cycles: `npx madge --circular src scripts` reports 0 cycles
- [x] N075: `grep -n "function surfaceLabel\|function dedupePosts\|function mergeSurfaceStamps" src/index.ts` returns no hits (the block moved) and `grep -n "export function surfaceLabel\|export function dedupePosts" src/pipeline-helpers.ts` returns 2 hits (mergeSurfaceStamps stays private)
- [x] N075: `grep -n "pipeline-helpers" src/index.ts tests/index.test.ts` shows the import in both files
- [x] N080: `npx tsx -e "import('./scripts/probe-judge.ts').then(() => { console.log('import clean'); process.exit(0); })"` exits 0 printing "import clean" — no config load, no fetch, no main run (the entry guard)
- [x] N080: `grep -n "await loadWatcherConfig" scripts/probe-judge.ts` shows exactly one hit, inside main()
- [x] NOTE: `npx knip` is deliberately NOT a Phase 4 gate — judge-ramp.ts lands with entry-only exports (classifyResponse/rampLevel/RAMP_MAX gain `export` in Phase 5 when the suite imports them); knip runs at the Phase 5 gate (Ordering Constraints amended)

#### Manual Verification:
- [ ] The probe's output lines are byte-identical to the pre-move script (same REFUSED/NO CHOICES/OK/FAILED wording, same ramp lines, same account labels)

## Phase 5: Test consolidation

### Overview
N079 first (freshState canonical into `tests/judge-helpers.ts`, mirror deleted, 10 call sites re-pointed), then N078 (shared `fakeFetch` + `recordingSleep` factory; the 39+25 cast sites migrate onto it) and N077 (the wall-clock bound becomes a zero-recorded-sleep assertion), plus the ramp suite. The doctrine line (`tests/judge-helpers.ts:4-5`) and its guidance copy are rewritten in this phase (D7 same-commit rule). Depends on Phase 4 (the ramp suite imports `src/judge-ramp.js`).

### Changes Required:

#### 1. tests/judge-helpers.ts:1-9
**File**: tests/judge-helpers.ts
**Changes**: MODIFY — rewrite the doctrine header (D-BP4/D7: the shared factory is now deliberate), add the ported canonical `freshState` (verbatim from `tests/judge-rotation.test.ts:56-74`), and the shared doubles: `FetchCall`, `fakeFetch(respond)` (the repo's ONE fetch double-cast; handler admits `Response | Promise<Response>`; throws propagate), `recordingSleep()`.

```ts
/**
 * Shared pure helpers for the judge suites (D3, F015; REVISED D7 2026-11-19):
 * the pure fixtures every judge suite would otherwise duplicate, the
 * canonical freshState (N079 — the rotation suite's copy moved here, the
 * judge.test.ts mirror deleted), and the ONE shared typed fetch-double
 * factory + sleep recorder (N078 — the former per-suite doctrine was
 * overridden by the full-ledger pass; 64 as-unknown-as casts consolidated;
 * this factory holds the repo's single fetch double-cast). Type-only
 * imports (D5): erased at runtime, and the tests/*.test.ts glob never
 * executes this file.
 */
import type { LlmAccount } from "../src/judge-account.js";
import type { RotationState } from "../src/judge-rotation.js";
import type { Post } from "../src/types.js";
```

(then the existing seven fixtures, unchanged; then the new blocks — FetchCall stays MODULE-PRIVATE: an exported-but-unimported interface fails knip, and the handlers type structurally:)

```ts
/**
 * Canonical freshState (N079): the richer three-param signature moved
 * byte-verbatim from tests/judge-rotation.test.ts:56-74 (its mirror in
 * tests/judge.test.ts:18-39 is deleted this phase). The
 * waitBudgetRemainingMs literal mirrors the module-private WAIT_BUDGET_MS.
 * ceilings default: an empty map reads as ceiling 1 per account (the
 * pick's ?? 1 floor) — the same degrade as an absent ceilings file.
 */
export function freshState(
  accounts: LlmAccount[],
  ceilings: ReadonlyMap<number, number> = new Map(),
  blocked: ReadonlyMap<number, string> = new Map(),
): RotationState {
  return {
    accounts,
    cooldownUntil: new Map(),
    ceilings,
    blocked,
    inFlight: new Map(),
    dispatchCounter: 0,
    ceilingWaiters: [],
    waitBudgetRemainingMs: 180_000,
    healthMarks: new Map(),
    probedThisTick: new Set(),
    outcomeLedger: new Map(),
  };
}

/** One normalized fetch call the handler inspects (N078). Module-private:
 *  handlers receive it structurally; naming it is the factory's job. */
interface FetchCall {
  url: string;
  headers: Record<string, string>;
  bodyText: string;
  /** Parsed request body; undefined when the body is not JSON. */
  json: unknown;
}

/**
 * The shared typed fetch double (N078): the repo's ONE
 * `as unknown as typeof fetch` cast lives here (guidance Idiom A — exactly
 * one double-cast, at construction). The handler receives the normalized
 * call and returns a Response, a still-pending Promise<Response> (the
 * parked-gate doubles), or throws (the transport-error doubles — the
 * judge's catch sees the throw).
 */
export function fakeFetch(
  respond: (call: FetchCall) => Response | Promise<Response>,
): typeof fetch {
  const handler = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    const raw = (init?.headers ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) headers[key] = String(value);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = undefined;
    }
    return await respond({ url: String(_url), headers, bodyText, json });
  };
  return handler as unknown as typeof fetch;
}

/**
 * The shared recording sleep (N077/N078): returns the no-op seam AND the
 * recorded durations, so a test asserts the transcript instead of a
 * wall-clock proxy.
 */
export function recordingSleep(): {
  sleeps: number[];
  sleep: (ms: number) => Promise<void>;
} {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}
```

#### 2. tests/judge.test.ts:18-39
**File**: tests/judge.test.ts
**Changes**: MODIFY — N079: delete the 1-param `freshState` mirror; import the canonical from `./judge-helpers.js` (10 one-arg call sites unchanged — defaulted maps absorb them). N078: migrate the 39 `as unknown as typeof fetch` casts onto `fakeFetch` (mechanical rule: drop the cast, lift the arrow body into `respond`; canned one-liners, call counters, body-branchers migrate directly; the named local factories `measuredFetch`/`bulkMissThenAnswer`/`hostRecorder` become thin wrappers preserving their signatures; parked-gate doubles return pending promises from `respond`).

```ts
import {
  KEYWORDS,
  bulkContent,
  bulkPost,
  fakeFetch,
  freshState,
  id19,
  ok,
  singleAccount,
} from "./judge-helpers.js";
```

(the mirror block :18-39 — comment :18-21 + function :22-39 — is DELETED whole; the `type RotationState` import (:4-5 area) dies with it — grep confirms the mirror was its sole use in this file)

(N078 migration — the mechanical rule for all 39 casts, with three worked examples; each lifts the ORIGINAL body verbatim into respond — no behavioral rewrites:)

```ts
// A canned status one-liner (:871-874 today — a canned 401) becomes:
const fetchFn = fakeFetch(() => new Response("Unauthorized", { status: 401 }));

// A call-counting closure (:165-167 today) becomes (the live body emits
// ok(bulkContent(posts.map((p) => p.id))) — lifted verbatim):
let calls = 0;
const fetchFn = fakeFetch(() => {
  calls += 1;
  return ok(bulkContent([id19(1)]));
});

// A body-branching capture (:692-701 today) becomes (bodies + the live
// prompt-content branch lifted verbatim):
const bodies: string[] = [];
const fetchFn = fakeFetch((call) => {
  bodies.push(call.bodyText);
  const prompt = call.json as { messages: Array<{ content: string }> };
  if (bodies.length === 1) {
    return ok(bulkContent([id19(1)]));
  }
  return ok(prompt.messages[0]?.content.includes("Judge each post below") ? "{}" : "{}");
});
```

#### 3. tests/judge-rotation.test.ts:52-74
**File**: tests/judge-rotation.test.ts
**Changes**: MODIFY — N079: the local canonical `freshState` moves out; all 29 call sites import from `./judge-helpers.js`. N078: migrate the 25 casts onto `fakeFetch`. N077: the wall-clock case (`:394-404`) injects `recordingSleep()` and asserts `deepEqual(sleeps, [])` — `started`/`elapsed`/`elapsed < 500` die, and the case's existing `auths` pins STAY. The 5 clock-advancing recorder sleeps (`:241`, `:267`, `:560`, `:333`, `:615`) stay local (they couple to each test's hand-stepped `now`).

```ts
import {
  KEYWORDS,
  bulkContent,
  bulkPost,
  fakeFetch,
  freshState,
  id19,
  ok,
  recordingSleep,
  singleAccount,
} from "./judge-helpers.js";
```

(the freshState definition :52-74 + its doc comment :52-55 is DELETED — it moved to judge-helpers per §1; the `type RotationState` import (:11) dies — grep confirms :60 was its sole remaining use; every wrapper lifts the ORIGINAL double body verbatim into respond — accountTwoAnswering keeps its recorded-host + url-branch behavior:)

```ts
function accountTwoAnswering(auths: string[]): typeof fetch {
  return fakeFetch((call) => {
    // The recorded host + Authorization pair — lifted verbatim from the
    // live double ("<host> <authorization>"):
    auths.push(`${new URL(call.url).host} ${call.headers.Authorization ?? ""}`);
    if (call.url.includes("account-one")) return new Response("ratelimited", { status: 429 });
    const ids = [...call.bodyText.matchAll(/id (\d+) by @/g)].map((m) => m[1] ?? "");
    return ok(bulkContent(ids));
  });
}
```

(N077 — the wall-clock case REWRITTEN; it declares its own pinned clock:)

```ts
  it("cools to account 2 on the first 429 with no backoff wait", async () => {
    const NOW = Date.UTC(2026, 10, 19, 5, 0, 0); // pinned — never ambient
    const auths: string[] = [];
    const { sleeps, sleep } = recordingSleep();
    const result = await judgePosts(
      [bulkPost(id19(1))],
      twoAccounts(),
      KEYWORDS,
      accountTwoAnswering(auths),
      "medium",
      new Map(),
      () => NOW,
      sleep,
    );
    assert.equal(result.judged.length, 1); // the retry landed on account 2
    assert.match(auths[0] ?? "", /account-one\.api/); // the pins this case always carried
    assert.match(auths[1] ?? "", /account-two\.api/);
    assert.deepEqual(sleeps, [], "rotation must not sleep"); // zero-charge path
  });
```

#### 4. tests/judge-ramp.test.ts
**File**: tests/judge-ramp.test.ts
**Changes**: NEW — the ramp suite: `classifyResponse` (ok / no-JSON failed / refusal-shape), `rampLevel` (counts per kind), `findConcurrencyCeiling` (failed → 0; refused level → level/2; clean walk → RAMP_MAX) with a scripted `fetchFn` double from `fakeFetch` — no network, no sleeps.

```ts
/**
 * The ramp suite (N080): classifyResponse's N065 gate, rampLevel's
 * tallies, and findConcurrencyCeiling's three verdicts — all offline over
 * scripted fetchFn doubles (fakeFetch from judge-helpers). No network, no
 * sleeps: a refused level IS the ceiling signal.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RAMP_MAX,
  classifyResponse,
  findConcurrencyCeiling,
  rampLevel,
} from "../src/judge-ramp.js";
import { fakeFetch, ok } from "./judge-helpers.js";

const ACCOUNT = { baseUrl: "https://one.api/v1", apiKey: "k", model: "m" };
const PAYLOAD = { messages: [{ role: "user", content: "probe" }] };

/** The counting refusal double: ok for the first `refuseFrom - 1` calls, 429 after. */
function refuseFromCall(refuseFrom: number): typeof fetch {
  let n = 0;
  return fakeFetch(() => {
    n += 1;
    if (n >= refuseFrom) return new Response("busy", { status: 429 });
    return ok("{}");
  });
}

describe("classifyResponse", () => {
  it("reads a real completion as ok (JSON + choices)", () => {
    const outcome = classifyResponse(200, JSON.stringify({ choices: [{ message: {} }] }));
    assert.deepEqual(outcome, { kind: "ok" });
  });

  it("fails a 2xx without choices — the N065 gate (refusal prose with a brace is not ok)", () => {
    const outcome = classifyResponse(200, "refused: {rate limited}");
    assert.equal(outcome.kind, "failed");
  });

  it("fails a 2xx with non-JSON body", () => {
    const outcome = classifyResponse(200, "<html>busy</html>");
    assert.equal(outcome.kind, "failed");
  });

  it("classifies non-2xx as refused (data, not failure)", () => {
    const outcome = classifyResponse(429, "ratelimited");
    assert.deepEqual(outcome, { kind: "refused", status: 429 });
  });
});

describe("rampLevel", () => {
  it("tallies per-kind outcomes across parallel calls", async (t) => {
    t.mock.method(console, "log", console.log.bind(console));
    let n = 0;
    const fetchFn = fakeFetch(() => {
      n += 1;
      if (n === 2) return new Response("busy", { status: 429 });
      return ok("{}");
    });
    const result = await rampLevel(3, PAYLOAD, ACCOUNT, "account 1", fetchFn);
    assert.equal(result.ok, 2);
    assert.equal(result.refused, 1);
    assert.equal(result.failed, 0);
    assert.ok(result.ms >= 0);
  });
});

describe("findConcurrencyCeiling", () => {
  it("reads the ceiling below the first refused level (6 clean calls then refusal -> 4)", async (t) => {
    t.mock.method(console, "log", console.log.bind(console));
    // Levels 2 and 4 fire 6 clean calls; level 8's first call refuses.
    assert.equal(await findConcurrencyCeiling(PAYLOAD, ACCOUNT, "account 1", refuseFromCall(7)), 4);
  });

  it("returns 0 when any call fails (broken endpoint, not a ceiling)", async (t) => {
    t.mock.method(console, "log", console.log.bind(console));
    // Level 2's first call is clean; its second call throws — a failed
    // call is a broken endpoint, not a ceiling.
    let n = 0;
    const flaky = fakeFetch(() => {
      n += 1;
      if (n >= 2) throw new Error("socket dropped");
      return ok("{}");
    });
    assert.equal(await findConcurrencyCeiling(PAYLOAD, ACCOUNT, "account 1", flaky), 0);
  });

  it("returns RAMP_MAX when every level is fully clean (2..32)", async (t) => {
    t.mock.method(console, "log", console.log.bind(console));
    const fetchFn = fakeFetch(() => ok("{}"));
    assert.equal(await findConcurrencyCeiling(PAYLOAD, ACCOUNT, "account 1", fetchFn), RAMP_MAX);
  });
});
```

#### 5. .rpiv/guidance/tests/architecture.md
**File**: .rpiv/guidance/tests/architecture.md
**Changes**: MODIFY — the Architectural Boundaries doctrine copy ("doubles and mock-fetch factories stay per-suite", six-fixtures count) is rewritten to match the new shared-factory + canonical-freshState shape (D7); the Clock section's wall-clock sentence joins the rewrite (it names the deleted `elapsed < 500` test).

```markdown
- **No mock libraries**; the ONE shared-helpers exception is `tests/judge-helpers.ts` (the pure fixtures + the canonical `freshState` (N079) + the shared typed `fakeFetch` factory and `recordingSleep` (N078) — the repo's single fetch double-cast lives in the factory)
```

(and the Clock sentence "One wall-clock assertion exists: the 429 \"no backoff\" elapsed < 500ms test (judge-rotation)" is REPLACED by:)

```markdown
// Clock and env are parameters — pinned, never ambient. N077 removed the
// suite's last wall-clock assertion: the 429 "no backoff" case now injects
// recordingSleep() and asserts the zero-sleep transcript directly.
```

#### 6. src/judge-ramp.ts
**File**: src/judge-ramp.ts
**Changes**: MODIFY — the export flip: three members gain `export` (composing with Phase 4 §4's private versions — doc comments unchanged; this is what makes knip green at this phase's gate).

```ts
export function classifyResponse(status: number, body: string): ProbeOutcome {
```

```ts
export const RAMP_MAX = 32;
```

```ts
export async function rampLevel(
```

### Success Criteria:
- [x] The ramp suite passes standalone: `npx tsx --test tests/judge-ramp.test.ts`
- [x] N078: `grep -c "as unknown as typeof fetch" tests/judge.test.ts tests/judge-rotation.test.ts` returns 0/0
- [x] N078: `grep -c "as unknown as" tests/judge-helpers.ts` returns exactly 1 (the factory's)
- [x] N079: `grep -n "function freshState" tests/judge.test.ts tests/judge-rotation.test.ts` returns no hits and `grep -n "export function freshState" tests/judge-helpers.ts` returns 1
- [x] N077: `grep -n "elapsed < 500" tests/judge-rotation.test.ts` returns no hits and `grep -n "rotation must not sleep" tests/judge-rotation.test.ts` returns 1
- [x] Doctrine: `grep -n "stay per-suite" tests/judge-helpers.ts .rpiv/guidance/tests/architecture.md` returns no hits
- [x] knip is clean NOW: `npx knip` exits 0 (classifyResponse/rampLevel/RAMP_MAX have importers; the Ordering Constraints gate lands here)
- [x] Zero cycles: `npx madge --circular src scripts` reports 0 cycles

#### Manual Verification:
- [ ] The N077 test still fails if rotation ever sleeps (inject a recording sleep into a cooldown path and watch deepEqual(sleeps, []) go red — sanity, run once locally)

## Phase 6: Doc pass

### Overview
E1–E17 plus the full sweep (D-BP10): the zip blurbs → card join, the negativeKeywords row + clause, the probe walk order at all 5 doc sites + banner + test title, Chrome → msedge, reset-linkedin command rows, format scope, ENV_NAMES count, the 4-gate claim, the gc threshold. Depends on nothing logically; runs last so doc claims match the landed code.

### Changes Required:

#### 1. AGENTS.md:76-78,36,123,185,27-61
**File**: AGENTS.md
**Changes**: MODIFY — E1 zip blurb → card join; E6+E7 walk order (2 sites); E5 negativeKeywords clause; E12 reset-linkedin command entry.

```text
E1 (:76-78) today:
  and the timestamp-ordered zip pairs the i-th distinct text with the
  i-th distinct id by timestamp (a count mismatch warns and mints the
  paired prefix)
E1 new:
  and the card join pairs each commentary marker row with its outermost
  card ancestor: the card's text is the longest commentary in the marker
  closure, its single forward-collected urn is Post.id, and a card with
  zero/multiple/rejected urns or empty text drops with a count (a
  linked+dropped line per body)

E6 (:36) today: walk of the first configured surface; exit 1 on a checkpoint wall
E6 new: walk-each-until-floor over the configured linkedin keywords in config order; exit 1 on a checkpoint wall

E7 (:123) today: probe = a read-only walk of the first configured surface, gate exit 1)
E7 new: probe = a read-only walk over the configured linkedin keywords in config order until one clears the floor, gate exit 1)

E5 (:185) today: - `src/config.ts`, `src/config-file.ts` - `watcher.config.json` validation
E5 new: - `src/config.ts`, `src/config-file.ts` - `watcher.config.json` validation (negativeKeywords is the judge's veto list: absent or [] means no veto)

E12 — insert after the login-linkedin command entry (its tail: "...the feed-first rest keeps the session alive"):
- `npm run reset-linkedin` - the operator reset: deletes the cookie file,
  the browser profile, and the halt latch, in that order
```

#### 2. README.md:141,316,330,386-393
**File**: README.md
**Changes**: MODIFY — E4 negativeKeywords table row; E11 Chrome → headed msedge-channel profile; E8 walk order; E13 five → seven LinkedIn leg entries + two added lines.

```text
E4 — insert after the candidateTerms table row (:141):
| `negativeKeywords` | Terms that veto a post the judge would otherwise accept. Absent or `[]` means no veto. |

E11 (:316) today: 1. `npm run login-linkedin`: opens a real Chrome window; log in by hand
E11 new: 1. `npm run login-linkedin`: opens a headed browser window on the persistent msedge-channel profile; log in by hand

E8 (:330) today: the first configured surface read-only and exits 1 on a checkpoint
E8 new: the configured linkedin keywords in config order (first to clear the floor) read-only and exits 1 on a checkpoint

E13 (:386) today: The five LinkedIn leg entries (PC only; no LLM_* or GMAIL_* needed for
E13 new: The seven LinkedIn leg entries (PC only; no LLM_* or GMAIL_* needed for
E13 — the :388-393 block gains two lines (alphabetical position within the block):
npm run replay-linkedin  # re-run the parser over a captures/ session, offline
npm run reset-linkedin   # delete the cookie file, the browser profile, and the halt latch
```

#### 3. package.json:15
**File**: package.json
**Changes**: MODIFY — E14: add `scripts/probe-judge.ts` to the `format` list (mirroring `lint`).

```text
(:15) today: "format": "biome format --write src tests scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/linkedin-chain.ts scripts/replay-linkedin.ts"
new: "format": "biome format --write src tests scripts/probe-judge.ts scripts/fetch-linkedin.ts scripts/watch-linkedin.ts scripts/probe-linkedin.ts scripts/login-linkedin.ts scripts/reset-linkedin.ts scripts/linkedin-chain.ts scripts/replay-linkedin.ts"
```

#### 4. .rpiv/guidance/architecture.md:43,60,65,36-48
**File**: .rpiv/guidance/architecture.md
**Changes**: MODIFY — E9 walk order; E17 the "150 MiB loose or 30 s checkout" threshold on the N043 revisit bullet; E16 "same three" → four gates; optional consistency: reset-linkedin + replay-linkedin rows in the Commands table.

```text
E9 (:43) today: gate the LinkedIn browser walk: a read-only walk of the first configured surface; exit 1 on a checkpoint wall
E9 new: gate the LinkedIn browser walk: a read-only walk over the configured linkedin keywords in config order until one clears the floor; exit 1 on a checkpoint wall

E17 (:60) today: - Revisit trigger: clone size or CI checkout time becomes a visible cost. The options then are
E17 new: - Revisit trigger: re-gc at 150 MiB loose or 30 s checkout. The options then are

E16 (:65) today: 3. Gates: `npm run typecheck && npm run lint && npm test` (CI runs the same three)
E16 new: 3. Gates: `npm run typecheck && npm run lint && npm test` (CI runs these three plus knip)

Consistency — the Commands table gains, after the probe row:
| `npm run reset-linkedin` | the operator reset: deletes the cookie file, the browser profile, and the halt latch, in that order |
| `npm run replay-linkedin` | offline replay of a capture session: re-runs the parser over every recorded body |

Straggler — the format row today: `biome format --write src tests` in place (src and tests only — not repo-wide)
Straggler new: `biome format --write` in place over the enumerated lint scope (src, tests, and the scripts list — see package.json)
```

#### 5. .rpiv/guidance/src/architecture.md:13,118-120,178
**File**: .rpiv/guidance/src/architecture.md
**Changes**: MODIFY — E2 zip blurb → card join; the module map gains `judge-account.ts`, `pipeline-helpers.ts`, `judge-ramp.ts` (and the `:178` boundary sentence's pipeline-shape note).

```text
E2 (:118-120) today:
// ms<=0n rejected. Pairing: the timestamp-ordered zip — the i-th distinct commentary text
// (stream order) pairs with the i-th distinct id sorted by derived timestamp ascending; a
// count mismatch warns naming the counts and mints the paired prefix. Every call logs ONE
E2 new:
// ms<=0n rejected. Pairing: the card join — each commentary marker row seeds a card and
// climbs $-reference parents to the outermost ancestor holding exactly one card seed; the
// card's text is the longest commentary in the closure, its single forward urn is Post.id,
// and a zero/many/rejected-urn or empty-text card drops with a count. Every call logs ONE
(the trailing pairing-oracle sentence at :120 stays)

Module map — exact insertions: the judge-cluster line `judge.ts, judge-prompts.ts,` gains
`judge-account.ts,` before `judge-prompts.ts`; the entry line's comment
`# ENTRY: runWatcher(deps) / WatcherDeps / timeStage; guarded CLI bootstrap`
appends ` | pipeline-helpers.ts (N075 pure helpers), judge-ramp.ts (N080 ramp)`.

:178 today: **Pipeline shape lives only in `index.ts`**
:178 new: **Pipeline shape lives only in `index.ts`** (the pure dedupe/label helpers live in `pipeline-helpers.ts` (N075); the probe's ramp decision machinery lives in `judge-ramp.ts` (N080))
```

#### 6. .rpiv/guidance/scripts/architecture.md:43
**File**: .rpiv/guidance/scripts/architecture.md
**Changes**: MODIFY — E10 walk order in the probe-linkedin.ts Structure entry.

```text
E10 (:43) today: #   FIRST configured surface, preflight the cookie file (resolveLinkedInCookies
E10 new: #   configured linkedin keywords in CONFIG ORDER (first to clear the floor), preflight the cookie file (resolveLinkedInCookies
```

#### 7. .rpiv/guidance/.github/workflows/architecture.md:7,138
**File**: .rpiv/guidance/.github/workflows/architecture.md
**Changes**: MODIFY — E15 "5 of the 7 ENV_NAMES" + both unmapped LinkedIn names; align the duplicate N017 revisit trigger with E17; the ci.yml gate lines gain knip (same-class straggler).

```text
E15 (:7) today: watch.yml maps 5 of the 6 ENV_NAMES (`HEARTBEAT_ENABLED` via `vars.` — the one non-secret knob); the LinkedIn name (`LINKEDIN_COOKIES_FILE`) is deliberately NOT mapped — PC-only, never enters Actions; unset means enabled
E15 new: watch.yml maps 5 of the 7 ENV_NAMES (`HEARTBEAT_ENABLED` via `vars.` — the one non-secret knob); the LinkedIn names (`LINKEDIN_COOKIES_FILE`, `LINKEDIN_PROFILE_DIR`) are deliberately NOT mapped — PC-only, never enter Actions; unset means enabled

:138 today: Revisit when clone size or checkout time becomes a visible cost
:138 new: Revisit at 150 MiB loose objects or a 30 s checkout (the N043 threshold)

Straggler — the Responsibility/Structure lines describing ci.yml as `typecheck → lint → test` gain `→ knip` (ci.yml:39-40 runs `npm run knip`)
```

#### 8. src/linkedin-behavior.ts:19-20
**File**: src/linkedin-behavior.ts
**Changes**: MODIFY — E3: "5 surfaces" → "7 configured surfaces" (count source `watcher.config.json:57`).

```text
(:19-20) today:
 * floor gave 52, the number older docs quote). Each wake walks at most
 * 5 surfaces x (1 navigation + scrollRounds Load-more clicks). The click
new:
 * floor gave 52, the number older docs quote). Each wake walks at most
 * 7 configured surfaces x (1 navigation + scrollRounds Load-more clicks). The click
```

#### 9. scripts/linkedin-chain.ts:10,106
**File**: scripts/linkedin-chain.ts
**Changes**: MODIFY — full sweep: module doc + the stage-2 banner read config-order/first-to-clear-the-floor (the test pins only the `stage 2/3 probe ` prefix — verified safe).

```text
(:10) today: Stage 2 walks the first configured surface read-only
(:10) new: Stage 2 walks the configured linkedin keywords in config order (first to clear the floor) read-only

(:106) today: console.log("linkedin-chain: stage 2/3 probe — read-only walk of the first configured surface");
(:106) new: console.log("linkedin-chain: stage 2/3 probe — read-only walk over the configured linkedin keywords (first to clear the floor)");
```

#### 10. tests/probe-linkedin.test.ts:286
**File**: tests/probe-linkedin.test.ts
**Changes**: MODIFY — full sweep: the test title reads the config-order walk.

```text
(:286) today: it("walks the first configured surface on the persistent profile and resolves the post count"
(:286) new: it("walks the configured linkedin keywords in config order (first to clear the floor) on the persistent profile and resolves the post count"
```

### Success Criteria:

#### Automated Verification:
- [x] N066: `grep -rn "timestamp-ordered zip" AGENTS.md .rpiv/guidance src` returns no hits
- [x] N066: `grep -n "5 surfaces" src/linkedin-behavior.ts` returns no hits
- [x] N070: `grep -n "negativeKeywords" README.md AGENTS.md` returns >= 1 hit in each
- [x] N081: `grep -rni "first configured surface" AGENTS.md README.md .rpiv/guidance scripts tests` returns no hits (docs + banner + test title all swept)
- [x] N081: `grep -n "Chrome window" README.md` returns no hits
- [x] N081: `grep -n "probe-judge" package.json` returns 2 hits (lint + format)
- [x] N081: `grep -n "5 of the 6" .rpiv/guidance/.github/workflows/architecture.md` returns no hits and "5 of the 7" present
- [x] N081: `grep -n "same three" .rpiv/guidance/architecture.md` returns no hits
- [x] N081 stragglers: the guidance format row no longer says "src and tests only", and the workflows-arch ci.yml lines carry `→ knip`
- [x] N090: `grep -n "150 MiB loose" .rpiv/guidance/architecture.md .rpiv/guidance/.github/workflows/architecture.md` returns 1 hit in each
- [x] N081: `grep -c "reset-linkedin" AGENTS.md` returns >= 2 (command entry + inventory)
- [x] The banner prefix pin holds: `npx tsx --test tests/linkedin-chain.test.ts` passes
- [x] The renamed probe title holds: `npx tsx --test tests/probe-linkedin.test.ts` passes
- [x] Docs stay markdown-consistent: the edited docs' fence counts are unchanged from their pre-edit counts

#### Manual Verification:
- [ ] The gc itself (N090): run `git gc --aggressive` once from this full clone, then `git count-objects -v` shows loose size in the low MiB range (from 161.6 MiB)

## Ordering Constraints

- Phases run sequentially in the listed order; each ends green on `npm run typecheck && npm run lint && npm test`.
- Phase 3 must follow Phase 2: `tests/linkedin-fetch.test.ts:32-45` and the judge import blocks are edited by both (type flip first, facade split second).
- Phase 5 must follow Phase 4: the ramp suite imports `src/judge-ramp.js`.
- Within Phase 1, the static-leaf guard export (§6) precedes the fetch-threads port (§8) and the walk dedupe (§7).
- Within Phase 5, N079 precedes N078 (D-BP4); the doctrine rewrite lands with the factory in the same phase.
- The N065 inline fix (Phase 1 §5) precedes the classifyResponse lift (Phase 4 §4) so the live gate never regresses mid-sequence.
- `npx madge --circular src scripts` and `npx knip` verify after Phases 2, 3, and 5 (the move-heavy phases; knip deliberately waits for Phase 5 — judge-ramp.ts lands with entry-only exports in Phase 4, and classifyResponse/rampLevel/RAMP_MAX gain `export` when the Phase 5 suite imports them).

## Verification Notes

- Gates: `npm run typecheck`, `npm run lint`, `npm test` after every phase; `npx knip` after Phases 2, 3, and 5 (see Ordering Constraints); `npx madge --circular src scripts` = 0 cycles after Phases 2 onward.
- `npm test` exits 0 with > 670 passing tests (new suites: pool, config, judge-exhaustion, judge-ramp).
- N089: `grep -n "linkedinWake" tests/config-file.test.ts` — shape assertions only at both former pair sites (`, 60)` may legitimately remain at `:297`).
- N091: unit-observable via the startLoop seam — one warn line matching `/PAYLOAD_MAX_AGE_MS/` on a crossing band; zero on 15/45.
- N065: the ramp module's `classifyResponse` suite pins JSON+`"choices"` (FRD acceptance: unit-test observable once the ramp module exists).
- Entry guard: importing `scripts/probe-judge.ts` performs no config load and no main run.
- N078: `grep -c "as unknown as typeof fetch" tests/judge.test.ts tests/judge-rotation.test.ts` returns 0/0; the old doctrine header line is gone from both `tests/judge-helpers.ts` and the guidance copy.
- N067: no REMOVAL NOTE text in `src/judge.ts` / `src/linkedin-fetch.ts`; `grep -rn "from \"./judge.js\"" src scripts tests` shows no type-symbol `LlmAccount` imports.
- N072: `grep -n "shell: true" scripts/hooks/format-on-edit.js` empty; failing formatter produces a stderr warning.
- N073: `grep -n "session captured" scripts/login-linkedin.ts` empty; "pair captured" present.
- N088: capture files single-line JSON; `LINKEDIN_CAPTURE=off` creates nothing.
- N066: `grep -rn "timestamp-ordered zip" AGENTS.md .rpiv/guidance src` empty; `negativeKeywords` in the README table + AGENTS.md.
- N090: guidance N043 contains "150 MiB loose or 30 s checkout"; the gc itself is operator-run manual verification (`git gc --aggressive` from this full clone, then `git count-objects -v` loose in the low MiB range).
- Offline suite rules hold: no network, no browser, no repo writes; new suites follow the `judge-parse` skeleton and `judge-ceilings` temp-dir idioms.
- Precedent lessons: byte-verbatim moves (no logic edits inside a move); re-run knip/tsc/biome per cluster; land docs with code.

## Performance Considerations

- No regression to walk pacing, judge dispatch, or wake-loop timing: N069 and N092 are signature/import-only; the ramp module is a verbatim lift; the warn is one console line per loop start.
- The capture sink gets smaller (single-line JSON bodies shrink `captures/` on disk).
- The shared `fakeFetch` factory must not add per-call allocation on the judge hot path in tests (closure per double, not per call).

## Migration Notes

- No persisted schema changes; no state-file format changes; no env var additions to `ENV_NAMES` (`LINKEDIN_CAPTURE` is a bare opt-in read).
- Rollback = git revert per phase; every phase is self-contained green.
- The one-time `git gc --aggressive` runs from a full clone only (never shallow) — operator action, recorded here as manual verification.

## Pattern References

- Deps-object idiom: `src/linkedin-fetch.ts:116-164` (`FetchLinkedInDeps`) — optional fields, "Default: ..." JSDoc, one `| undefined` field, defaults resolved at the top.
- Trailing-param injection: `src/judge-ceilings.ts:130` (`writeCeilingsAtomic`) — the ramp module's `fetchFn` follows it.
- Entry guard: `scripts/watch-linkedin.ts:148` (and six siblings) — the idiom probe-judge.ts adopts.
- Warn-once latch: `src/linkedin-walk.ts:140-148` (`warnBodyFault` + `CaptureWarnState`) — the fetch-threads port mirrors it.
- Console-spy + filter-and-assert: `tests/config-file.test.ts:477-486`, `tests/watch-linkedin.test.ts:157-190`.
- Leaf pure-module suite: `tests/judge-parse.test.ts:1-14`; fs-writing suite: `tests/judge-ceilings.test.ts:123-133` (mkdtemp + after).
- Black-box hook harness: `tests/format-on-edit.test.ts:15-19`.
- Scripted git double: `tests/fetch-linkedin.test.ts:95-119` (`scriptGit` keys by `args[0]`).

## Developer Context

**Q (Phase map): FRD cluster order with N069 riding type-homes?** A: Follow FRD order (6 phases; N069 shares both files with N092).

**Q (Suite timing): three zero-dep suites early or with the test phase?** A: With test phase — but as Phase 1 deliverables inside the live-signals phase (they gate nothing downstream). Recorded as D-BP2.

**Q (Shared guard): where does the shared `isPageCloseRace` live?** A: Exported from `src/linkedin-walk-static.ts` (D-BP3) — a linkedin-walk export would mint a new type cycle.

**Q (Test order): N079 vs N078 first?** A: N079 then N078 (D-BP4).

**Q (Scroll default): `scrollRounds` default home?** A: Required deps field; the constant stays orchestration-side (D-BP5).

**Q (Ramp surface): module export shape?** A: `classifyResponse` split out + `rampLevel`/`findConcurrencyCeiling` with `fetchFn` (D-BP6).

## Plan History

- Phase 1: Live signals — approved as generated (slice-verifier OK after 2 fixes: §20 noUncheckedIndexedAccess narrowing via assert.fail; §9 test-3 fault bodies now carry thread_items; §2 retitled; §17 explicit env args)
- Phase 2: Type homes + deps object — approved as generated (2 verifier rounds: biome-sort landing positions for the judge-account import in 7 files; N092 grep threshold corrected to 7 src files; §5/§7 stale line-cites dropped instead of re-pinned; tests/judge-exhaustion.test.ts added to the phase file set)
- Phase 3: Facade execution — approved as generated (slice-verifier OK; §6's phantom seventh member `type LinkedInContextFactory` removed at write time — the file never imported it; zero facade-path consumers grep-verified post-slice)
- Phase 4: Extractions — approved as generated (slice-verifier OK after 3 fixes: probeFetch calls normalizeEndpoint bare — it returns the full URL, the composed form double-appended; the local `type ProbeOutcome` joins the deleted-whole list; index.ts's now-dead `type Surface` member dropped; knip gate moved to Phase 5 — judge-ramp lands entry-only exports, Phase 5's suite imports the private three)
- Phase 5: Test consolidation — approved as generated (slice-verifier OK after 5 fixes: FetchCall stays module-private — an exported-but-unimported interface fails knip; the N077 fence keeps the auths pins and wrappers lift original bodies verbatim; the N077 fence declares its own pinned NOW clock; fakeFetch/recordingSleep join both import fences; the stranded RotationState/ProbeOutcome/fetchFn unused imports trimmed; guidance Clock line joins the doctrine rewrite)
- Phase 6: Doc pass — approved as generated (slice-verifier OK: all E1-E17 anchors byte-verified, walk-order sweep complete at 8 sites, banner prefix-pin safe; 2 directive-fences firmed to exact text + 2 same-class stragglers added at write time: workflows-arch's ci.yml gate lines, guidance format-row scope)

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9 (all 7 applied: 3 blockers fixed in fences, the judge-ramp export flip gained its own Phase 5 §6 fence, 3 suggestions taken). Coverage review returned zero findings — all 15 verification intents land in phase criteria._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
|---|---|---|---|---|---|---|---|
| code | Phase 2 §24 | src/linkedin-fetch.ts:286 | blocker | actionability | call site passes `now,` but WalkLinkedInDeps declares `nowFn` — TS2353 | change the key to `nowFn: now` | applied: fence now reads `nowFn: now` |
| code | Phase 5 §3 | tests/judge-rotation.test.ts:84 | blocker | code-quality | wrapper recorded only the Authorization header, not the verbatim host+auth pair | record `${new URL(call.url).host} ${Authorization}` | applied: wrapper lifted verbatim; N077 pins tightened to /account-one\.api/ |
| code | Phase 5 §4 | <n/a> | blocker | actionability | ramp suite calls fakeFetch without importing it — TS2304 | add fakeFetch to the judge-helpers import | applied: import fence gains fakeFetch |
| code | Phase 5 | <n/a> | concern | actionability | the judge-ramp export flip existed only as prose — no per-file fence | add an explicit Phase 5 subsection | applied: Phase 5 §6 fences the three export flips |
| code | Phase 2 §18 | src/linkedin-fetch.ts:70 | suggestion | codebase-fit | Surface becomes a dead type import after the move | drop the member | applied: merged import drops Surface |
| code | Phase 6 §2 | <n/a> | suggestion | code-quality | E13's added lines claimed alphabetical order but reset preceded replay | swap the two lines | applied: replay before reset |
| code | Phase 1 §11 | tests/format-on-edit.test.ts:9 | suggestion | code-quality | header fence was a ` *`-prefixed fragment replacing // comments — a literal paste breaks parsing | show complete // lines | applied: fence rewritten as // lines |
| coverage | (all 15 Verification Notes intents) | <n/a> | none | verification-coverage | no findings — every intent lands in phase criteria | — | n/a |

## References

- `.rpiv/artifacts/research/2026-11-19_12-14-03_tech-debt-full-ledger-remediation.md` — the verified research artifact (all anchors, drift corrections, integration points)
- `.rpiv/artifacts/discover/2026-11-19_10-11-11_tech-debt-full-ledger.md` — the FRD (16 decisions D1-D16)
- `.rpiv/artifacts/TECH_DEBT_AUDIT.md` — the audit input spec (N065-N092)
