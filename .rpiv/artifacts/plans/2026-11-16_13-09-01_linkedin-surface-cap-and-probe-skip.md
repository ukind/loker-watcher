---
date: 2026-11-16T13:09:01+0700
author: Yogiswara Utama
commit: 408eead
branch: ukind/fix-limited-linkedin
repository: fix-limited-linkedin
topic: "LinkedIn surface cap removal and probe thin-surface skip"
tags: [plan, config-file, probe-linkedin, linkedin-chain]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-16_10-54-22_linkedin-surface-cap-and-probe-skip.md"
phase_count: 2
phases:
  - { n: 1, title: "Config surface-count rule (>= 1)", files: ["src/config-file.ts", "tests/config-file.test.ts"], depends_on: [] }
  - { n: 2, title: "Probe first-pass-wins loop", files: ["scripts/probe-linkedin.ts", "tests/probe-linkedin.test.ts"], depends_on: [1] }
last_updated: 2026-11-16T13:33:41+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Step 4 review triaged: 3 actionability concerns applied (337-410 anchor, spread-pin comment reword, runProbe docstring deletion made explicit)"
---

# LinkedIn surface cap removal and probe thin-surface skip — Implementation Plan

## Overview

Remove the exact-5 linkedin surface cap in `src/config-file.ts` (accept 1 or more) and convert the probe's single `surfaces[0]` read into an ordered first-pass-wins loop that skips thin and faulted keywords and stops at the first keyword clearing `PROBE_MIN_POSTS`. `ProbeResult` keeps its shape, so the operator chain compiles and runs unedited.

Implements design `.rpiv/artifacts/designs/2026-11-16_10-54-22_linkedin-surface-cap-and-probe-skip.md` (Option 1, inline loop). Phase boundaries are inherited 1:1 from the design's `## Slices`; Success Criteria pass through unchanged.

## Desired End State

```ts
// Config: any linkedin fleet size >= 1 loads.
const config = await loadWatcherConfig("watcher.config.json");
// 6 linkedin surfaces -> loads. 0 linkedin (threads-only) -> throws naming the count.

// Probe: first keyword thin, second clears the floor.
const result = await runProbe({ config, env, contextFactory, captureSink });
// -> { postCount: 12, elapsedMs: <winning attempt ms> }
// logs: probe: browser walk — content search for "react jakarta" ...
//       probe: react jakarta — 4 post(s), below the 10-post floor; trying the next surface
//       probe: browser walk — content search for "hiring jakarta" ...
//       probe: 12 post(s)
//       probe: all checks passed

// Probe: every keyword thin or faulted.
// -> throws probeFloor: "probe: no linkedin surface cleared 10 posts — react jakarta 4, hiring jakarta 3, hiring developer indonesia 0 (faulted)"
```

Verified by: `npm run typecheck && npm run lint && npm test` green (CI runs the same three), plus the per-phase Automated Verification below.

## What We're NOT Doing

- No config keyword additions (the operator edits `watcher.config.json` later).
- No walk-seam changes: no context hand-off, no per-surface results out of `fetchLinkedInPosts`.
- No chain summary changes (`ProbeResult` keeps its shape; the winning keyword stays unnamed).
- No README, guidance, or module-doc edits in the code commit — a docs-only follow-up commit per the `9fded75` pattern.
- No new runtime dependencies.

## Phase 1: Config surface-count rule (>= 1)

### Overview

Replace the exact-5 linkedin surface check with a `>= 1` guard whose message names the count. The FR-8 rationale comment and the `LINKEDIN_SURFACE_COUNT` constant die in the same edit (the `7558747` → `8e8f22b` → `f0340d7`/`9fded75` lesson: never leave a stale rationale). The empty-array throw stays generic and keeps running first, so the count error owns only the non-empty, zero-linkedin shape. Test suite re-pinned: acceptances for 1, 4, and 6 surfaces; zero-linkedin re-pin to the new message; the red committed-spread pin deleted.

### Changes Required:

#### 1. `src/config-file.ts:73-80` — delete the FR-8 comment block and the constant
**File**: `src/config-file.ts`
**Changes**: Delete lines 73-80 (the FR-8 rationale comment + `LINKEDIN_SURFACE_COUNT = 5`) PLUS ONE adjacent blank line (the block's trailing blank, old line 81) — Biome collapses consecutive blank lines, so leaving both blanks fails `npm run lint` on the intermediate state.

```ts
// DELETE lines 73-80 (the FR-8 comment block + the constant) PLUS ONE
// adjacent blank line (the block's trailing blank, old line 81) — Biome
// collapses consecutive blank lines, so leaving both blanks fails
// npm run lint on the intermediate state.
//
// REMOVED (was):
/**
 * FR-8 (browser-walk migration 2026-11-11): exactly 5 linkedin surfaces —
 * the PC leg's account-safety bound (the jittered cadence, times the
 * per-surface scrollRounds click cap) is calibrated for a five-surface
 * fleet. The count is the invariant, not the keywords: an operator may
 * swap a surface's value, never grow the fleet.
 */
const LINKEDIN_SURFACE_COUNT = 5;
```

#### 2. `src/config-file.ts:210-215` — rewrite the count check to `>= 1`
**File**: `src/config-file.ts`
**Changes**: Replace the `!==` enforcement at lines 210-215 with a `< 1` guard and the message `config: <path> has N linkedin surfaces — at least 1 is required`. The fleet size is a pacing decision, not a code invariant — any count >= 1 loads. This check owns only the non-empty, zero-linkedin shape: a fully empty surfaces array dies at the empty-array rule above.

```ts
  // The PC leg walks every linkedin surface the operator configures (the
  // probe: one browser launch per keyword; the tick: the production walk).
  // The fleet size is a pacing decision, not a code invariant — any count
  // >= 1 loads. This check owns only the non-empty, zero-linkedin shape:
  // a fully empty surfaces array dies at the empty-array rule above.
  const linkedinCount = out.filter((surface) => surface.type === "linkedin").length;
  if (linkedinCount < 1) {
    throw new Error(
      `config: ${filePath} has ${linkedinCount} linkedin surfaces — at least 1 is required`,
    );
  }
```

#### 3. `tests/config-file.test.ts:337-410` — re-pin the FR-8 suite
**File**: `tests/config-file.test.ts`
**Changes**: Replace the rejection pins (reject-4 `:366-372`, reject-6 `:374-383`) with acceptances for four and six linkedin surfaces; add a one-surface acceptance; re-pin the zero-linkedin rejection (`:385-397`) to the new message; delete the committed-spread pin (`:399-410`, including the describe's closing brace on line 410) — it pinned operator-editable committed data (violating the pin-the-shape-not-the-values doctrine at `:51-53`) and was already red before this change (operator edit `a5af2a6` put "react jakarta" first; 47 pass / 1 fail on 2026-11-16T10:27+0700).

```ts
describe("linkedin surface count (at least one)", () => {
  const FIVE = [
    { type: "linkedin", value: "hiring indonesia" },
    { type: "linkedin", value: "hiring jakarta" },
    { type: "linkedin", value: "hiring developer indonesia" },
    { type: "linkedin", value: "hiring engineer jakarta" },
    { type: "linkedin", value: "react indonesia" },
  ];

  it("accepts five linkedin surfaces and keeps their values", async () => {
    const path = await writeConfig({ ...VALID, surfaces: FIVE });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.surfaces, FIVE);
  });

  it("accepts one linkedin surface", async () => {
    const ONE = [{ type: "linkedin", value: "hiring indonesia" }];
    const path = await writeConfig({ ...VALID, surfaces: ONE });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.surfaces, ONE);
  });

  it("accepts four linkedin surfaces", async () => {
    const path = await writeConfig({ ...VALID, surfaces: FIVE.slice(0, 4) });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.surfaces, FIVE.slice(0, 4));
  });

  it("accepts six linkedin surfaces", async () => {
    const SIX = [...FIVE, { type: "linkedin", value: "engineer indonesia" }];
    const path = await writeConfig({ ...VALID, surfaces: SIX });
    const config = await loadWatcherConfig(path);
    assert.deepEqual(config.surfaces, SIX);
  });

  it("accepts five linkedin surfaces mixed with threads surfaces", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [
        { type: "tag", value: "hiring" },
        ...FIVE,
        { type: "url", value: "https://www.threads.com/@hiresflow" },
      ],
    });
    const config = await loadWatcherConfig(path);
    assert.equal(config.surfaces.filter((s) => s.type === "linkedin").length, 5);
    assert.equal(config.surfaces.length, 7);
  });

  it("rejects zero linkedin surfaces", async () => {
    const path = await writeConfig({
      ...VALID,
      surfaces: [
        { type: "tag", value: "hiring" },
        { type: "url", value: "https://www.threads.com/@hiresflow" },
      ],
    });
    await assert.rejects(
      () => loadWatcherConfig(path),
      /0 linkedin surfaces — at least 1 is required/,
    );
  });

  // The old FRD-five spread pin is DELETED:
  // it pinned operator-editable committed data (the doctrine stated in the
  // happy-path block above — pin the shape, not the values) and was already
  // red before this change (operator edit a5af2a6 put "react jakarta" first).
});
```

### Success Criteria:

#### Automated Verification:
- [x] Config suite passes: `npx tsx --test tests/config-file.test.ts`
- [x] No stale constant references: `grep -rn "LINKEDIN_SURFACE_COUNT" src/ scripts/ tests/` returns nothing
- [x] No stale message: `grep -rn "exactly 5 are required" src/ tests/` returns nothing
- [x] No stale spread pin: `grep -n "committed spread" tests/config-file.test.ts` returns nothing

#### Manual Verification:
- [x] A threads-only `watcher.config.json` (0 linkedin) fails `npm start` with a message naming the count
- [x] Adding a 6th linkedin keyword passes config validation (revert the edit after)

---

## Phase 2: Probe first-pass-wins loop

### Overview

Convert `runProbe` from a single `surfaces[0]` read into an ordered loop over the configured linkedin keywords. Each keyword gets one `fetchLinkedInPosts([surface])` call. The per-keyword catch rethrows halt, leg-dead, and plain errors instantly; converts `AllSurfacesFaulted` (`faulted === 1`) to a fault-skip line; and turns a normal return below `PROBE_MIN_POSTS` into a thin-skip line. The first keyword at >= 10 posts prints the result line and pass line and returns. After the loop, the all-thin/all-faulted terminal rethrows the `probeFloor` tag with the loop-scope keyword list, so the CLI floor arm survives byte-identical. The capture-sink default hoists above the loop (one session stamp for the whole run); the clock resets per keyword so `elapsedMs` is the winning attempt's duration.

_Depends on Phase 1 (design Ordering Constraints: the cap removal admits the fleets the loop walks)._

### Changes Required:

#### 1. `scripts/probe-linkedin.ts` — module header docstring (edit A)
**File**: `scripts/probe-linkedin.ts`
**Changes**: Replace the "against the first configured linkedin surface, one real browser page" sentence with the config-order, first-pass-wins description; replace the exit-1 sentence tail so the floor terminal names each keyword and its count.

```ts
// --- A) module header, the sentences replacing "against the first configured linkedin surface, one real browser page." and the exit-1 sentence tail ---
OLD:
 * factory, the content-search browser walk with its flagship-web response
 * join — against the first configured linkedin surface, one real browser
 * page.
 *
 * Exit 1 on a checkpoint or login wall (the walk's tagged halt), a dead
 * session (no flagship-web response within the liveness window — the
 * tagged leg-dead), every surface faulted, or fewer than 10 posts. The
NEW:
 * factory, the content-search browser walk with its flagship-web response
 * join — against the configured linkedin keywords IN CONFIG ORDER, one
 * real browser page per keyword. First pass wins: the probe passes on the
 * first keyword that clears the post floor; a thin or faulted keyword
 * logs one line and the walk moves on.
 *
 * Exit 1 on a checkpoint or login wall (the walk's tagged halt), a dead
 * session (no flagship-web response within the liveness window — the
 * tagged leg-dead), or when EVERY keyword is thin or faulted (the floor
 * terminal names each keyword and its count). The
```

#### 2. `scripts/probe-linkedin.ts` — import the `Post` type (edit B)
**File**: `scripts/probe-linkedin.ts`
**Changes**: Add `import type { Post } from "../src/types.js";` after the linkedin-session import — the loop declares `let posts: Post[]` per attempt.

```ts
// --- B) import addition, after the linkedin-session.js import ---
import type { Post } from "../src/types.js";
```

#### 3. `scripts/probe-linkedin.ts` — `probeFloor` docstring + factory signature (edit C)
**File**: `scripts/probe-linkedin.ts`
**Changes**: The docstring now describes the no-keyword-cleared terminal; the factory takes a `message: string` parameter instead of minting the fixed floor text. The tag name (`PROBE_FLOOR`) is unchanged, so the CLI's bare-print floor arm survives byte-identical. One message regex pin moves (`tests/probe-linkedin.test.ts:313`).

```ts
// --- C) probeFloor docstring + factory ---
OLD:
/** Thrown when the walk minted fewer than PROBE_MIN_POSTS posts. */
export interface ProbeFloor extends Error {
  name: string;
}

export function probeFloor(): ProbeFloor {
  const error = new Error(
    "probe: fewer than 10 posts — pagination did not prove out (need >= 10 across several bodies)",
  ) as ProbeFloor;
  error.name = PROBE_FLOOR;
  return error;
}
NEW:
/** Thrown when NO configured keyword cleared PROBE_MIN_POSTS (every keyword thin or faulted). */
export interface ProbeFloor extends Error {
  name: string;
}

export function probeFloor(message: string): ProbeFloor {
  const error = new Error(message) as ProbeFloor;
  error.name = PROBE_FLOOR;
  return error;
}
```

#### 4. `scripts/probe-linkedin.ts` — `SkippedSurface` + `runProbe` full replacement (edit D)
**File**: `scripts/probe-linkedin.ts`
**Changes**: Add the `SkippedSurface` interface (value, count, faulted) directly above `runProbe`. Replace `runProbe` wholesale — the replacement span is lines 135-192: the existing function docstring at `:135-144` ("pick the FIRST configured linkedin surface") is DELETED along with the function, and the fence's new docstring takes its place (leaving the old docstring stacked above `SkippedSurface` is the stale-rationale failure Phase 1 §1 forbids). The replacement body: filter + zero guard + env + cookie preflight + minClicks + now stay before the loop; the capture-sink default hoists above the loop; the loop walks surfaces in config order with a per-keyword banner, per-keyword clock, one `fetchLinkedInPosts([surface], {...})` call, a catch that rethrows halt/leg-dead/plain errors and converts all-faulted to a fault-skip line, a thin-skip line below the floor, and the pass path (result line + pass line + return) on the first clearing keyword. After the loop, the floor terminal builds the per-keyword report and throws `probeFloor`.

```ts
// --- D) SkippedSurface (new, placed directly above runProbe) + runProbe full replacement ---
/**
 * One keyword that did not clear the post floor, carried to the terminal
 * line: a thin walk records its post count, a faulted walk records the
 * (faulted) marker with count 0.
 */
interface SkippedSurface {
  readonly value: string;
  readonly count: number;
  readonly faulted: boolean;
}

/**
 * Run the probe: resolve config, preflight the cookie file (presence/parse
 * only — the browser rides the persistent PROFILE, not this document),
 * then walk the configured linkedin keywords in CONFIG ORDER, one
 * fetchLinkedInPosts call per keyword, read-only. First pass wins: the
 * first keyword minting >= PROBE_MIN_POSTS posts resolves the run with
 * THAT attempt's count and wall clock. A keyword below the floor (thin)
 * or one whose walk faulted (AllSurfacesFaulted, faulted === 1) logs one
 * line and the loop moves on; the walk's tagged halt and leg-dead rethrow
 * INSTANTLY, as does any plain error (a contextFactory or close failure
 * recurs for every keyword — skipping would burn N launches to reach the
 * same wall). When every keyword is thin or faulted, the floor terminal
 * throws the probeFloor tag with one line naming each keyword and its
 * count. Every failure THROWS — the caller maps them (the fetchTick
 * model).
 */
export async function runProbe(deps: ProbeDeps = {}): Promise<ProbeResult> {
  const config = deps.config ?? (await loadWatcherConfig());
  const surfaces = config.surfaces.filter(
    (surface): surface is LinkedinSurface => surface.type === "linkedin",
  );
  if (surfaces.length === 0) {
    throw probeNoSurfaces();
  }
  // The merged env, resolved once: .env fills ONLY unset keys, the real
  // shell wins — an .env-only setup reaches the browser leg unaided.
  const env = deps.env ?? envWithDotEnv();
  // Preflight only (REVISED 2026-11-11T18:40+0700): the cookie file must
  // exist and parse, but the browser rides the persistent PROFILE, not
  // this document. resolveLinkedInCookies throws fail-visibly on a
  // missing or malformed file, which is the check worth keeping.
  resolveLinkedInCookies(env);
  const minClicks = deps.minClicks ?? PROBE_MIN_CLICKS;
  const now = deps.now ?? Date.now;
  // Hoisted ABOVE the loop: the production sink mints its session stamp
  // lazily on first capture — inside the loop it would mint one stamp
  // (and one captures/<stamp>/ directory) PER KEYWORD.
  const captureSink = deps.captureSink ?? makeFsCaptureSink();
  const skipped: SkippedSurface[] = [];
  // Duplicates walk as listed (D4): a repeated keyword reuses its capture
  // slug and overwrites the earlier capture — accepted;
  // warnDuplicateSurfaces already warns at config load.
  for (const surface of surfaces) {
    console.log(
      `probe: browser walk — content search for "${surface.value}" (scrollRounds ${config.scrollRounds}, minClicks ${minClicks}, headed on the persistent profile)`,
    );
    // Per-keyword clock: elapsedMs is the WINNING attempt's duration.
    const started = now();
    let posts: Post[];
    try {
      // The undefined contextFactory selects the walk module's own production
      // factory (the persistent profile, headed, the Playwright import lazy
      // inside it) — the same lazy-default the tick suite pins.
      // minClicks: the probe must sample several pagination bodies, not stop
      // at the first dry exit — each body carries ~3 posts (live rehearsal
      // 2026-11-11), so the floor proves the pagination leg works.
      // scrollRounds stays the ceiling.
      posts = await fetchLinkedInPosts([surface], {
        profileDir: resolveLinkedInProfileDir(env),
        contextFactory: deps.contextFactory,
        scrollRounds: config.scrollRounds,
        now,
        minClicks,
        // seenIds stays unset: the probe never stops on seen ids, it needs the
        // full walk. sleepFn and rng stay unset: the production defaults.
        captureSink,
      });
    } catch (error) {
      // Halt and leg-dead abort the run instantly, and a plain error
      // rethrows too: a factory failure recurs for every keyword, so
      // skipping would burn N launches to reach the same wall.
      if (isHalt(error) || isLegDead(error) || !isAllSurfacesFaulted(error)) {
        throw error;
      }
      // Fault-skip: one line naming the keyword and the aggregate, then
      // the next keyword.
      console.log(`probe: ${surface.value} faulted — ${error.message}; trying the next surface`);
      skipped.push({ value: surface.value, count: 0, faulted: true });
      continue;
    }
    if (posts.length < PROBE_MIN_POSTS) {
      // Thin-skip: a normal return below the floor is not a fault — one
      // line naming the keyword and its count, then the next keyword.
      console.log(
        `probe: ${surface.value} — ${posts.length} post(s), below the ${PROBE_MIN_POSTS}-post floor; trying the next surface`,
      );
      skipped.push({ value: surface.value, count: posts.length, faulted: false });
      continue;
    }
    console.log(`probe: ${posts.length} post(s)`);
    console.log("probe: all checks passed");
    return { postCount: posts.length, elapsedMs: now() - started };
  }
  // The floor terminal: every keyword thin or faulted. The probeFloor tag
  // keeps the CLI's bare-print arm; the message names each keyword.
  const report = skipped
    .map((entry) => (entry.faulted ? `${entry.value} 0 (faulted)` : `${entry.value} ${entry.count}`))
    .join(", ");
  throw probeFloor(`probe: no linkedin surface cleared ${PROBE_MIN_POSTS} posts — ${report}`);
}
```

#### 5. `tests/probe-linkedin.test.ts` — per-keyword loop coverage (edits 1-6)
**File**: `tests/probe-linkedin.test.ts`
**Changes**: Update the header comment's behavior list (1); add the `configWithSurfaces` helper after the CONFIG literal (2); replace `contextFactoryFor` with the per-build script-table version — build N runs `scripts[N]` (3); swap the pass-path result-line pin to the bare `probe: N post(s)` form (4); add the `runProbe keyword loop` describe — first-pass-wins, fault-skip (5); replace the `runProbe gate arms` describe wholesale — halt rethrow, leg-dead rethrow, plain-error rethrow, all-thin terminal, all-faulted terminal, mixed terminal (6); remove the two superseded tests ("throws the tagged floor gate on a short walk", "propagates the tagged all-faulted error when the single surface faults").

```ts
// --- 1) header comment, the behavior-list sentence ---
OLD:
 * the behavior the chain depends on: the 10-post floor, the tagged gate
 * arms (halt / leg-dead / all-faulted propagate — the caller owns the
 * exit), the two local tagged gates, the zero-surfaces guard, the
NEW:
 * the behavior the chain depends on: the first-pass-wins keyword loop
 * (thin-skip and fault-skip lines), the instant aborts (halt / leg-dead /
 * plain errors rethrow — the caller owns the exit), the all-thin/
 * all-faulted floor terminal naming every keyword, the two local tagged
 * gates, the zero-surfaces guard, the

// --- 2) helper, placed directly after the CONFIG literal ---
/** A config carrying the given linkedin keywords, in config order (per-keyword loop cases). */
const configWithSurfaces = (...values: string[]): WatcherConfig => ({
  ...CONFIG,
  surfaces: values.map((value) => ({ type: "linkedin" as const, value })),
});

// --- 3) contextFactoryFor: FULL replacement (per-build scripts; the whole function, copy-pasteable) ---
/**
 * The LinkedInContextFactory double (the fetch-linkedin suite's shape,
 * trimmed): one context, one page, one script PER BUILD — `script` runs
 * every build the same way, `scripts` serves build N from scripts[N]
 * (the per-keyword loop cases). Records the built count and the profile
 * path the walk opened.
 */
function contextFactoryFor(options: {
  built?: { value: number };
  profileDirs?: unknown[];
  /** The script EVERY build runs (single-keyword cases). */
  script?: PageScript;
  /** Per-build scripts in build order — build N runs scripts[N]. */
  scripts?: readonly PageScript[];
}): LinkedInContextFactory {
  const scriptFor = (build: number): PageScript => {
    const chosen = options.scripts !== undefined ? options.scripts[build] : options.script;
    if (chosen === undefined) {
      throw new Error(`test double: no script for build ${build}`);
    }
    return chosen;
  };
  let builds = 0;
  const factory: LinkedInContextFactory = async (profileDir): Promise<ContextLike> => {
    const build = builds++;
    if (options.built !== undefined) options.built.value += 1;
    options.profileDirs?.push(profileDir);
    const script = scriptFor(build);
    const listeners: Array<(response: ResponseLike) => void> = [];
    const fire = (response: ResponseLike): void => {
      for (const listener of listeners) listener(response);
    };
    let clickCount = 0;
    let settleArmed = false;
    const context: ContextLike = {
      newPage: async (): Promise<PageLike> => ({
        url: () => script.url ?? "https://www.linkedin.com/search/results/content/",
        goto: async () => {
          if (script.gotoError !== undefined) throw new Error(script.gotoError);
          const initial = script.initialBody;
          if (initial !== undefined) {
            fire({
              url: () => FLAGSHIP_SEARCH_URL,
              status: () => 200,
              text: async () => initial,
            });
          }
          return undefined;
        },
        waitForFunction: async () => undefined,
        content: async () => "<html></html>",
        on: (_event, listener) => {
          listeners.push(listener);
          return undefined;
        },
        locator: () => {
          const handle: LocatorLike = {
            first: () => handle,
            waitFor: async () => {
              const visible = script.loadMoreVisible?.(clickCount + 1) ?? false;
              if (!visible) throw new Error("locator wait timeout");
            },
            click: async () => {
              clickCount += 1;
              settleArmed = true;
            },
          };
          return handle;
        },
        // The liveness gate reads the rendered post count (the initial
        // results are server-rendered, not a flagship body). A script with
        // an initial body simulates a healthy page; a silent script
        // simulates a dead session.
        evaluate: async () => (script.initialBody !== undefined ? 8 : 0),
        waitForTimeout: async () => {
          if (settleArmed) {
            settleArmed = false;
            const body = script.clickBodies?.[clickCount - 1];
            if (body !== undefined) {
              fire({ url: () => PAGINATION_URL, status: () => 200, text: async () => body });
            }
          }
          // One macrotask tick: the walk's async body reads drain first.
          await new Promise<void>((resolve) => setImmediate(resolve));
        },
        close: async () => undefined,
      }),
      addInitScript: async () => undefined,
      close: async () => undefined,
    };
    return context;
  };
  return factory;
}

// --- 4) pass-path pin swap ---
OLD: assert.ok(lines.some((line) => /probe: 0ms — 10 post\(s\)/.test(line)));
NEW: assert.ok(lines.some((line) => /^probe: 10 post\(s\)$/.test(line)))

// --- 5) NEW describe block "runProbe keyword loop" (insert after the pass-path describe) ---
describe("runProbe keyword loop", () => {
  it("skips a thin keyword and passes on the first clearing surface (first-pass-wins)", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{ initialBody: bodyMinting(4) }, { initialBody: bodyMinting(12) }],
    });
    const capture = recordingSink();
    const result = await runProbe({
      config: configWithSurfaces("react jakarta", "hiring jakarta", "react indonesia"),
      env: await cookieEnv(),
      contextFactory,
      captureSink: capture,
      now: () => T0,
    });
    assert.deepEqual(result, { postCount: 12, elapsedMs: 0 }); // the WINNING attempt's clock
    assert.equal(built.value, 2); // first-pass-wins: the third keyword never launched
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.some((line) => /content search for "react jakarta"/.test(line)));
    assert.ok(
      lines.some((line) =>
        /probe: react jakarta — 4 post\(s\), below the 10-post floor; trying the next surface/.test(line),
      ),
    ); // thin-skip: one line naming the keyword and its count, then move on
    assert.ok(lines.some((line) => /content search for "hiring jakarta"/.test(line)));
    assert.ok(lines.some((line) => /^probe: 12 post\(s\)$/.test(line)));
    assert.ok(lines.some((line) => line === "probe: all checks passed"));
    // Order: the thin-skip line lands BEFORE the second keyword's banner.
    const thinAt = lines.findIndex((line) => line.includes("below the 10-post floor"));
    const secondBannerAt = lines.findIndex((line) => line.includes('"hiring jakarta"'));
    assert.ok(thinAt !== -1 && secondBannerAt !== -1 && thinAt < secondBannerAt);
    assert.equal(capture.records.length, 2); // both walked bodies captured (one per attempt)
  });

  it("skips a faulted keyword and passes on the next surface", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{ gotoError: "navigation failed" }, { initialBody: bodyMinting(12) }],
    });
    const capture = recordingSink();
    const result = await runProbe({
      config: configWithSurfaces("react jakarta", "hiring jakarta"),
      env: await cookieEnv(),
      contextFactory,
      captureSink: capture,
      now: () => T0,
    });
    assert.deepEqual(result, { postCount: 12, elapsedMs: 0 });
    assert.equal(built.value, 2);
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(
      lines.some((line) =>
        /probe: react jakarta faulted — linkedin-fetch: all 1 surface\(s\) faulted — nothing fetched; trying the next surface/.test(
          line,
        ),
      ),
    ); // fault-skip names the keyword AND the aggregate message
    assert.ok(lines.some((line) => /content search for "hiring jakarta"/.test(line)));
  });
});

// --- 6) describe "runProbe gate arms" REPLACED wholesale ---
describe("runProbe gate arms", () => {
  it("rethrows the tagged halt instantly — later keywords never walk", async (t) => {
    const log = t.mock.method(console, "log", console.log.bind(console));
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{ url: CHECKPOINT_URL }, { initialBody: bodyMinting(12) }],
    });
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) =>
        isHalt(error) && (error as { reason: string }).reason === HALT_CHECKPOINT_REASON,
    );
    assert.equal(built.value, 1); // the checkpoint aborted BEFORE the second keyword's launch
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.every((line) => !line.includes("hiring jakarta"))); // no banner for keyword 2
  });

  it("rethrows the tagged leg-dead instantly — later keywords never walk", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{}, { initialBody: bodyMinting(12) }],
    });
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) =>
        isLegDead(error) && /session may be dead/.test((error as { reason: string }).reason),
    );
    assert.equal(built.value, 1);
  });

  it("rethrows a plain factory error instantly — later keywords never walk", async () => {
    const built = { value: 0 };
    const contextFactory: LinkedInContextFactory = async () => {
      built.value += 1;
      throw new Error("context factory exploded");
    };
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      /context factory exploded/,
    );
    assert.equal(built.value, 1); // no second launch: the wall recurs for every keyword
  });

  it("throws the tagged floor terminal when every keyword is thin", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      scripts: [{ initialBody: bodyMinting(4) }, { initialBody: bodyMinting(3) }],
    });
    const capture = recordingSink();
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          captureSink: capture,
          now: () => T0,
        }),
      (error: unknown) => {
        assert.equal(isProbeFloor(error), true); // the same tag the CLI floor arm prints bare
        assert.match(
          (error as Error).message,
          /probe: no linkedin surface cleared 10 posts — react jakarta 4, hiring jakarta 3/,
        );
        assert.equal(isHalt(error), false); // disjoint from the walk's tags
        assert.equal(isLegDead(error), false);
        assert.equal(isAllSurfacesFaulted(error), false);
        return true;
      },
    );
    assert.equal(built.value, 2); // every keyword walked
  });

  it("throws the tagged floor terminal when every keyword faults", async () => {
    const built = { value: 0 };
    const contextFactory = contextFactoryFor({
      built,
      script: { gotoError: "navigation failed" },
    });
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta"),
          env: await cookieEnv(),
          contextFactory,
          now: () => T0,
        }),
      (error: unknown) => {
        assert.equal(isProbeFloor(error), true); // the walk's all-faulted tag NEVER reaches the caller
        assert.match(
          (error as Error).message,
          /probe: no linkedin surface cleared 10 posts — react jakarta 0 \(faulted\), hiring jakarta 0 \(faulted\)/,
        );
        assert.equal(isAllSurfacesFaulted(error), false);
        return true;
      },
    );
    assert.equal(built.value, 2);
  });

  it("names thin and faulted keywords together in the floor terminal message", async () => {
    const contextFactory = contextFactoryFor({
      scripts: [
        { initialBody: bodyMinting(4) },
        { gotoError: "navigation failed" },
        { initialBody: bodyMinting(3) },
      ],
    });
    const capture = recordingSink();
    await assert.rejects(
      async () =>
        runProbe({
          config: configWithSurfaces("react jakarta", "hiring jakarta", "react indonesia"),
          env: await cookieEnv(),
          contextFactory,
          captureSink: capture,
          now: () => T0,
        }),
      (error: unknown) => {
        assert.equal(isProbeFloor(error), true);
        assert.match(
          (error as Error).message,
          /probe: no linkedin surface cleared 10 posts — react jakarta 4, hiring jakarta 0 \(faulted\), react indonesia 3/,
        );
        return true;
      },
    );
  });
});

REMOVED tests (superseded): "throws the tagged floor gate on a short walk" (the per-attempt floor throw is now the thin-skip line) and "propagates the tagged all-faulted error when the single surface faults" (all-faulted is now a skip, never a propagation). The old floor message regex pin moves to the terminal message pins above.
```

### Success Criteria:

#### Automated Verification:
- [x] Probe suite passes: `npx tsx --test tests/probe-linkedin.test.ts`
- [x] Chain suite untouched and green: `npx tsx --test tests/linkedin-chain.test.ts`
- [x] Type check passes: `npm run typecheck`
- [x] Lint passes: `npm run lint`
- [x] Full suite green: `npm test`
- [x] Old per-attempt floor message gone from this slice's files: `grep -rn "pagination did not prove out" src/ scripts/ tests/probe-linkedin.test.ts` returns nothing (tests/linkedin-chain.test.ts keeps its own floor double — the chain suite is not edited)
- [x] CLI arms byte-identical: `git diff scripts/probe-linkedin.ts` shows no change inside the `runProbe().catch` block

#### Manual Verification:
- [x] A thin first keyword logs `probe: <keyword> — N post(s), below the 10-post floor; trying the next surface` and the probe moves on
- [x] A faulted keyword logs the fault line naming the keyword and the aggregate message, then moves on
- [x] A checkpoint URL aborts instantly — no banner for the second keyword
- [x] The all-exhausted terminal prints one line naming every keyword and its count
- [x] The default capture path mints ONE `captures/<stamp>/` directory across several keywords (hoisted sink)

---

## Testing Strategy

### Automated:
- Phase 1: `npx tsx --test tests/config-file.test.ts` plus the three grep oracles (no stale constant, no stale message, no stale spread pin).
- Phase 2: `npx tsx --test tests/probe-linkedin.test.ts`, `npx tsx --test tests/linkedin-chain.test.ts` (untouched, must stay green), `npm run typecheck`, `npm run lint`, `npm test`, the floor-message grep oracle, and the `git diff` CLI-arms byte-stability check.
- Whole-plan gate (owned by `validate`): `npm run typecheck && npm run lint && npm test` — CI runs the same three.

### Manual Testing Steps:
1. `npm run probe-linkedin` against the live profile with the real 5-keyword config — read the skip lines and the pass line.
2. `npm run linkedin-chain` end to end once after the probe change.
3. A threads-only `watcher.config.json` (0 linkedin) fails `npm start` with a message naming the count; adding a 6th linkedin keyword passes config validation (revert the edit after).

## Performance Considerations

- Per-tick duration is fleet-additive: each added keyword adds one 5-15 s pacing-gate slot, one <=30 s liveness window, and up to `scrollRounds` settle waits (~19 min worst case per keyword at the live `scrollRounds: 150`, `watcher.config.json:123`). The dry exit (`src/linkedin-walk.ts:394-400`) and seen-stop (`:312-315`) are the practical bounds. The 5-figure was descriptive only; the real bound is tick duration vs the 40-min payload freshness margin (`src/linkedin-payload.ts:38`) against the 28-33 min sleep.
- The all-thin worst case walks every keyword with capture on (~85 MB per walk measured, `src/linkedin-capture.ts` retention note) — the probe is a manual operator gate, not a scheduled job, so this is acceptable.
- First-pass-wins keeps the common case at one launch: a healthy first keyword exits after one context.

## Migration Notes

- No persisted schema changes. `watcher.config.json` keeps its current 5 linkedin surfaces and stays valid under the new rule; the operator may add or remove keywords later with no code change.
- Rollback: revert the two production files; the config file itself needs no edit in either direction.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 1 §3 (tests/config-file.test.ts) | tests/config-file.test.ts:410 | concern | actionability | The heading anchors the FR-8 suite at "337-409", but the `describe` actually spans 337-410 — line 410 is its closing `});` (the "duplicate surfaces" describe starts at 412) — so replacing 337-409 literally leaves a stray `});` that fails typecheck. | Correct the anchor to `tests/config-file.test.ts:337-410`. | applied: anchor corrected to 337-410 in the Phase 1 §3 heading and Changes text, closing brace included. Plan-local fix — the design's own 337-409 heading is a design follow-up. |
| code     | Phase 1 §3 (tests/config-file.test.ts) | <n/a> | concern | actionability | The fence's own trailing comment contains the literal "committed spread" (`// The old "keeps the committed spread at the FRD five" pin is DELETED:`), which the phase's oracle `grep -n "committed spread" tests/config-file.test.ts` requires to return nothing — the verification checkbox fails with the fence applied verbatim. | Reword the trailing comment to avoid the literal "committed spread" (e.g. "the old FRD-five spread pin"). | applied (plan-local; design follow-up: the upstream design carries the identical comment against its identical grep oracle) — comment reworded to "The old FRD-five spread pin is DELETED:", oracle stays clean. |
| code     | Phase 2 §4 (scripts/probe-linkedin.ts) | scripts/probe-linkedin.ts:135-144 | concern | actionability | "Replace `runProbe` wholesale" scopes to the function (:145-192), but the fence payload supplies a replacement docstring while the existing runProbe docstring at :135-144 ("pick the FIRST configured linkedin surface") is never marked for deletion — a function-only replacement leaves the stale docstring stacked above `SkippedSurface`, the exact stale-rationale failure the plan's own Phase 1 §1 doctrine forbids. | State explicitly that the wholesale replacement includes deleting the existing docstring at scripts/probe-linkedin.ts:135-144. | applied: Phase 2 §4 Changes now states the :135-144 docstring deletion explicitly and scopes the replacement span to lines 135-192. |

_Coverage reviewer: no findings — all 8 design Verification Notes entries land in phase Success Criteria or code mirrors; Slice 1 and Slice 2 criteria are byte-identical in the plan._

## Developer Context

_Empty at skeleton write; Step 4.4 fallback notes and any post-write developer interactions land here._

## References

- Design: `.rpiv/artifacts/designs/2026-11-16_10-54-22_linkedin-surface-cap-and-probe-skip.md`
- Solution: `.rpiv/artifacts/solutions/2026-11-16_10-35-30_linkedin-surface-cap-and-probe-skip.md`
- Research: `.rpiv/artifacts/research/2026-11-16_09-38-22_linkedin-surface-cap-and-probe-skip.md`
- Discover (FRD): `.rpiv/artifacts/discover/2026-11-16_09-00-43_linkedin-surface-cap-and-probe-skip.md`
- `src/linkedin-fetch.ts:276-339` — the loop's error-taxonomy template and join precedence.
- `scripts/probe-linkedin.ts:145-223` — the conversion site, the local gates, and the CLI arms.
- `src/config-file.ts:168-218` — the guard chain (order is load-bearing).
- `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md` — the code-commit + docs-follow-up pattern.
- `.rpiv/artifacts/plans/2026-11-12_15-41-06_linkedin-operator-chain.md` — the side-effect-free-import lesson.
