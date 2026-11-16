---
date: 2026-11-16T10:54:22+0700
author: Yogiswara Utama
commit: 408eead
branch: ukind/fix-limited-linkedin
repository: fix-limited-linkedin
topic: "LinkedIn surface cap removal and probe thin-surface skip"
tags: [design, config-file, probe-linkedin, linkedin-chain]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-16_10-35-30_linkedin-surface-cap-and-probe-skip.md
last_updated: 2026-11-16T12:52:20+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Post-lock re-verification recorded: full contextFactoryFor body audited OK by slice-verifier (775s run, zero violations); payload regenerated from the fences"
---

# Design: LinkedIn surface cap removal and probe thin-surface skip

## Summary

Remove the exact-5 linkedin surface cap in `src/config-file.ts` (accept 1 or more) and convert the probe's single `surfaces[0]` read into an ordered first-pass-wins loop that skips thin and faulted keywords and stops at the first keyword clearing `PROBE_MIN_POSTS`. `ProbeResult` keeps its shape, so the operator chain compiles and runs unedited.

## Requirements

- Config accepts 1 or more linkedin surfaces. Zero linkedin still rejects with a message that names the count.
- The probe walks keywords in config order. A thin keyword (< 10 posts) logs one line and the probe moves on.
- A faulted keyword logs one line and the probe moves on. Halt and leg-dead stay instant aborts.
- First pass wins: the gate passes on the first keyword with >= 10 posts.
- Exit 1 only when every keyword is thin or faulted.

## Current State Analysis

### Key Discoveries

- The cap is three things in one file: the FR-8 rationale comment (`src/config-file.ts:73-79`), the constant `LINKEDIN_SURFACE_COUNT = 5` (`:80`), and the `!==` enforcement (`:210-215`). Repo-wide the constant has exactly three code hits (`:80`, `:211`, `:213`); no runtime consumer counts the fleet — every consumer partitions and zero-guards (`src/index.ts:257-263`, `scripts/fetch-linkedin.ts:361-368`, `scripts/probe-linkedin.ts:147-153`).
- The guard chain in `readSurfaces` (`src/config-file.ts:168-218`) is order-load-bearing: not-an-array, empty-array (`:172-174`, keys on TOTAL length, runs first), per-entry object, type whitelist, value non-empty, url absolute, threads-host, count, duplicate warn (non-throw). The count error therefore owns only the "non-empty but zero linkedin" shape.
- The probe today (`scripts/probe-linkedin.ts:145-192`): filter linkedin surfaces, throw `probeNoSurfaces()` on empty, take `surfaces[0]` (`:153`), resolve env, cookie preflight (`:161`), banner (`:163-165`), one clock (`:167`), ONE `fetchLinkedInPosts([surface], {...})` call (`:175-184`), elapsed (`:185`), result line (`:186`), floor check (`:187-189`), pass line (`:190`), return (`:191`).
- Thin is a RETURN, not a throw: the walk exits dry (`src/linkedin-walk.ts:394-400`), the join returns posts (`src/linkedin-fetch.ts:340`), and the probe manufactures the floor failure itself (`scripts/probe-linkedin.ts:187-189`).
- A keyword fault arrives as `AllSurfacesFaulted` with `faulted === 1` (one-element array; `src/linkedin-fetch.ts:337-339`). Halt and leg-dead rethrow immediately; tag classification is total (disjoint `name` constants, one producer each, `src/linkedin-context.ts:21-95`; join precedence halt > leg-dead > all-faulted by short-circuit, `src/linkedin-fetch.ts:331-339`).
- The skip-and-continue worker loop at `src/linkedin-fetch.ts:276-321` is the direct template: halt arm (`:304-311`), leg-dead arm (`:312-319`), fault arm counts and continues (`:320-322`).
- Two untagged edges exist outside the tag system: a `contextFactory` rejection (`src/linkedin-fetch.ts:255`, before the try) and a `context.close()` rejection in the `finally` (`:325-327`, which overrides a pending tagged throw). Both surface as plain Errors.
- The capture sink default (`scripts/probe-linkedin.ts:183`) mints the session stamp lazily on first capture (`src/linkedin-capture.ts:166`); evaluated inside the loop it would mint N stamps and N `captures/<stamp>/` dirs. Distinct keywords produce distinct filename slugs (`:185-188`), so no collision — but a repeated keyword reuses slug + ordinal space and silently overwrites the earlier capture (atomic rename at `:193`).
- The pacing gate is minted per `fetchLinkedInPosts` call (`src/linkedin-fetch.ts:256`), so each keyword's first navigation is unpaced relative to the previous keyword's last. The `scrollRounds` cap is per-surface (`src/linkedin-walk.ts:308`).
- The committed-spread pin (`tests/config-file.test.ts:399-409`) is RED today: `npx tsx --test tests/config-file.test.ts` on 2026-11-16T10:27+0700 reported 47 pass / 1 fail (actual `['react jakarta', ...]` vs expected `['hiring indonesia', ...]` — operator edit `a5af2a6`).
- The CLI exit arms (`scripts/probe-linkedin.ts:199-223`) are a byte-stable contract: isHalt, isLegDead, isAllSurfacesFaulted, the two local gates print bare, fallback wraps. Success resolves and Node exits 0 implicitly — there is no `process.exit(0)`.

## Scope

### Building

- The >= 1 linkedin surface check with a count-naming message; FR-8 comment and constant deleted.
- The ordered first-pass-wins probe loop with thin-skip and fault-skip lines; halt and leg-dead instant aborts; the all-thin/all-faulted terminal reusing the `probeFloor` tag with per-keyword counts.
- Test updates: config acceptances (1, 6), zero-linkedin re-pin, spread pin deletion; probe thin-skip, fault-skip, halt rethrow, leg-dead rethrow, all-thin terminal, first-pass-wins early exit.

### Not Building

- No config keyword additions (the operator edits `watcher.config.json` later).
- No walk-seam changes: no context hand-off, no per-surface results out of `fetchLinkedInPosts`.
- No chain summary changes (`ProbeResult` keeps its shape; the winning keyword stays unnamed).
- No README, guidance, or module-doc edits in the code commit — a docs-only follow-up commit per the `9fded75` pattern.
- No new runtime dependencies.

## Decisions

### D1: Config check accepts 1 or more linkedin surfaces

**Ambiguity**: the exact-5 rule's justification (a daily GET budget) was deleted by the browser-walk migration; the cap outlived its arithmetic. **Decision**: replace the `!==` check with a `< 1` guard and the message `config: <path> has N linkedin surfaces — at least 1 is required`. The FR-8 comment (`src/config-file.ts:73-79`) and the constant (`:80`) die in the same edit — the `7558747` → `8e8f22b` → `f0340d7`/`9fded75` lesson: never leave a stale rationale. The empty-array throw (`:172-174`) stays generic and keeps running first, so the count error owns only the Threads-only shape (developer decision, research Developer Context).

### D2: Inline ordered loop in runProbe (Option 1)

**Ambiguity**: three shapes were weighed — inline loop, per-keyword attempt helper, loop report accumulator. **Decision**: the inline loop. Smallest diff (one contiguous hunk in the probe plus one edit block in config-file); `ProbeResult` unchanged so the chain compiles unedited; the error taxonomy has an in-repo template one layer down (`src/linkedin-fetch.ts:303-321`). Option 2 adds an injection seam with no coverage gain (the offline doubles already reach every outcome through `runProbe`). Option 3 moves ~9 pins and widens a cross-script type for a benefit (naming the winning keyword in the chain summary) that is out of scope by developer decision.

### D3: Thin-skip and fault-skip are two distinct arms

**Ambiguity**: thin (a normal return below the floor) and faulted (`AllSurfacesFaulted` with `faulted === 1`) are different classes that must not be conflated. **Decision**: the per-keyword catch checks `isHalt` then `isLegDead` (rethrow), then `isAllSurfacesFaulted` (fault-skip line naming the keyword and the aggregate message), and a normal return below `PROBE_MIN_POSTS` becomes a thin-skip line (keyword + count). This mirrors the `6493f2a`/`cd2297f`/`defb8af` history: thin ≠ broken, and the line must say which.

### D4: Duplicate keywords walk as listed

**Ambiguity**: a repeated keyword reuses the capture slug + per-call ordinal space and silently overwrites the earlier capture (`src/linkedin-capture.ts:185-193`). **Decision** (developer): walk every entry — no dedupe, no extra log. The capture overwrite is accepted; the probe's captures are diagnostic scratch, and `warnDuplicateSurfaces` (`src/config-file.ts:216`, `:225-240`) already warns at config load.

### D5: All-thin/all-faulted terminal reuses the probeFloor tag

**Ambiguity**: the terminal failure needs a tag the CLI can classify; a new tag means a new CLI arm and more moved pins. **Decision** (developer): reuse `probeFloor` with new message text listing each skipped keyword and its count, so the CLI floor arm (`scripts/probe-linkedin.ts:216-219`) survives byte-identical. One message regex pin moves (`tests/probe-linkedin.test.ts:313`).

### D6: Plain Errors rethrow

**Ambiguity**: a `contextFactory` rejection (`src/linkedin-fetch.ts:255`) and a `context.close()` rejection (`:325-327`) escape as plain Errors, outside the three-tag spec. **Decision**: rethrow. A factory failure recurs for every keyword, so skipping would burn N launches to reach the same wall; the CLI fallback arm (`:220-222`) already renders it fail-visible.

### D7: Capture sink hoisted above the loop; clock resets per keyword

**Ambiguity**: the sink default evaluated inside the loop mints N session stamps and N `captures/<stamp>/` dirs; a single `started` clock makes the pinned result line meaningless across attempts. **Decision**: hoist the capture-sink default above the loop (one stamp for the whole run, the injected-sink pins keep working) and reset `started` per keyword so `elapsedMs` is the winning attempt's duration.

## Architecture

### src/config-file.ts:73-80 — MODIFY

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

### src/config-file.ts:210-215 — MODIFY

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

### scripts/probe-linkedin.ts:6-11,47,69-84,145-192 — MODIFY

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

// --- B) import addition, after the linkedin-session.js import ---
import type { Post } from "../src/types.js";

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

### tests/config-file.test.ts:337-409 — MODIFY

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

  // The old "keeps the committed spread at the FRD five" pin is DELETED:
  // it pinned operator-editable committed data (the doctrine stated in the
  // happy-path block above — pin the shape, not the values) and was already
  // red before this change (operator edit a5af2a6 put "react jakarta" first).
});
```

### tests/probe-linkedin.test.ts — MODIFY

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

## Slices

### Slice 1: Config surface-count rule (>= 1)

**Files**: `src/config-file.ts`, `tests/config-file.test.ts`

#### Automated Verification:
- [ ] Config suite passes: `npx tsx --test tests/config-file.test.ts`
- [ ] No stale constant references: `grep -rn "LINKEDIN_SURFACE_COUNT" src/ scripts/ tests/` returns nothing
- [ ] No stale message: `grep -rn "exactly 5 are required" src/ tests/` returns nothing
- [ ] No stale spread pin: `grep -n "committed spread" tests/config-file.test.ts` returns nothing

#### Manual Verification:
- [ ] A threads-only `watcher.config.json` (0 linkedin) fails `npm start` with a message naming the count
- [ ] Adding a 6th linkedin keyword passes config validation (revert the edit after)

### Slice 2: Probe first-pass-wins loop

**Files**: `scripts/probe-linkedin.ts`, `tests/probe-linkedin.test.ts`

#### Automated Verification:
- [ ] Probe suite passes: `npx tsx --test tests/probe-linkedin.test.ts`
- [ ] Chain suite untouched and green: `npx tsx --test tests/linkedin-chain.test.ts`
- [ ] Type check passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Full suite green: `npm test`
- [ ] Old per-attempt floor message gone from this slice's files: `grep -rn "pagination did not prove out" src/ scripts/ tests/probe-linkedin.test.ts` returns nothing (tests/linkedin-chain.test.ts keeps its own floor double — the chain suite is not edited)
- [ ] CLI arms byte-identical: `git diff scripts/probe-linkedin.ts` shows no change inside the `runProbe().catch` block

#### Manual Verification:
- [ ] A thin first keyword logs `probe: <keyword> — N post(s), below the 10-post floor; trying the next surface` and the probe moves on
- [ ] A faulted keyword logs the fault line naming the keyword and the aggregate message, then moves on
- [ ] A checkpoint URL aborts instantly — no banner for the second keyword
- [ ] The all-exhausted terminal prints one line naming every keyword and its count
- [ ] The default capture path mints ONE `captures/<stamp>/` directory across several keywords (hoisted sink)

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

## File Map

- `src/config-file.ts`  # MODIFY — delete the FR-8 comment + constant; rewrite the count check to >= 1
- `scripts/probe-linkedin.ts`  # MODIFY — the ordered first-pass-wins loop, thin/fault skips, terminal
- `tests/config-file.test.ts`  # MODIFY — acceptances for 1 and 6; zero-linkedin re-pin; spread pin deleted
- `tests/probe-linkedin.test.ts`  # MODIFY — per-keyword script table; thin-skip, fault-skip, halt/leg-dead rethrow, all-thin terminal, first-pass-wins

## Ordering Constraints

- Slice 1 before Slice 2: the cap removal admits the fleets the loop walks. The two suites are otherwise independent and could run in parallel, but the config change is the foundation.
- Within Slice 2: the capture-sink hoist and the per-keyword clock reset must land in the same hunk as the loop — splitting them leaves a window where the loop mints N session stamps.

## Verification Notes

- `npm run typecheck && npm run lint && npm test` green (CI runs the same three).
- The committed-spread pin (`tests/config-file.test.ts:399-409`) is deleted — it is RED today (47 pass / 1 fail, 2026-11-16T10:27+0700) and violates the pin-the-shape-not-the-values doctrine (`tests/config-file.test.ts:51-53`).
- The CLI exit arms (`scripts/probe-linkedin.ts:199-223`) stay byte-identical — the terminal reuses the `probeFloor` tag so the floor arm survives unchanged.
- `ProbeResult {postCount, elapsedMs}` keeps its pinned shape (`tests/linkedin-chain.test.ts:37`, deep-equal at `:119-125`) — the chain suite is NOT edited.
- The probe's seen-stop exemption stays structural: `seenIds` stays unset per keyword call (`scripts/probe-linkedin.ts:181-182`).
- The preflight order pins survive: `probeNoSurfaces()` and the cookie gate both precede iteration 0 (`tests/probe-linkedin.test.ts:389`, `:399`, `built.value === 0`).
- The capture absence-oracle (`tests/probe-linkedin.test.ts` module scope) still holds: every walk-driving case injects the recording sink.
- Importing `scripts/probe-linkedin.ts` stays side-effect free — the entry guard is untouched.

## Performance Considerations

- Per-tick duration is fleet-additive: each added keyword adds one 5-15 s pacing-gate slot, one <=30 s liveness window, and up to `scrollRounds` settle waits (~19 min worst case per keyword at the live `scrollRounds: 150`, `watcher.config.json:123`). The dry exit (`src/linkedin-walk.ts:394-400`) and seen-stop (`:312-315`) are the practical bounds. The 5-figure was descriptive only; the real bound is tick duration vs the 40-min payload freshness margin (`src/linkedin-payload.ts:38`) against the 28-33 min sleep.
- The all-thin worst case walks every keyword with capture on (~85 MB per walk measured, `src/linkedin-capture.ts` retention note) — the probe is a manual operator gate, not a scheduled job, so this is acceptable.
- First-pass-wins keeps the common case at one launch: a healthy first keyword exits after one context.

## Migration Notes

- No persisted schema changes. `watcher.config.json` keeps its current 5 linkedin surfaces and stays valid under the new rule; the operator may add or remove keywords later with no code change.
- Rollback: revert the two production files; the config file itself needs no edit in either direction.

## Pattern References

- `src/linkedin-fetch.ts:276-321` — the skip-and-continue worker loop: halt arm, leg-dead arm, fault arm counts and continues. The direct template for the probe's per-keyword catch.
- `scripts/probe-linkedin.ts:47-106` — the tagged-gate idiom (name constant + factory + type guard) the terminal reuses.
- `src/judge-rotation.ts:132-139` — result-riding reports in config order (the precedent the report-accumulator option would have followed).
- `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md` — the code-commit + docs-only-follow-up pattern (`f0340d7` then `9fded75`).

## Developer Context

**Q (design checkpoint): Under the new probe loop, what happens when the config lists the same linkedin keyword twice?**
A: Walk every entry — no dedupe, no extra log. The capture overwrite (`src/linkedin-capture.ts:185-193`) is accepted; `warnDuplicateSurfaces` (`src/config-file.ts:216`) already warns at config load.

**Q (design checkpoint): When every keyword is thin or faulted, how should the probe fail?**
A: Reuse the `probeFloor` tag with new message text listing each skipped keyword and its count, so the CLI floor arm (`scripts/probe-linkedin.ts:216-219`) survives byte-identical. Example operator line: `probe: no linkedin surface cleared 10 posts — react jakarta 4, hiring jakarta 3, hiring developer indonesia 0 (faulted)`.

**Inherited from research (recorded, never re-asked):**
- Config accepts any number, 1 or more.
- First pass wins: try keywords in config order; a keyword under 10 posts logs one line and moves on; the gate passes when one clears 10; exit 1 only when every keyword is thin.
- Code fix only — the developer edits the config later.
- The cap is an exact-equality check (`!== 5`) at `src/config-file.ts:211`, not a max; nothing truncates the array.
- The probe hard-picks `surfaces[0]` (`scripts/probe-linkedin.ts:153`) and applies a global 10-post floor (`:187-189`); no loop, no skip.
- Production treats a thin or zero-post surface as success (`defb8af`); only halt, leg-dead, and all-faulted abort.
- A keyword that loads but errors out: skip to the next keyword. Halt and leg-dead stay instant aborts.
- Pacing arithmetic: click cap per-surface (`src/linkedin-walk.ts:308`); navigation rate fleet-global but N-invariant; durations fleet-additive; the 5 is descriptive only.
- The committed-spread pin is deleted (confirmed red before the decision: 47 pass / 1 fail, 2026-11-16T10:27+0700).
- Browser shape: N launches, one per keyword. The production walk seam stays untouched.
- Zero-linkedin error: keep the guard order — the empty-array throw stays generic; only the Threads-only shape names the linkedin count.

**Micro-checkpoint (Slice 2):** approved as generated. Out-of-scope note accepted at the checkpoint: `scripts/linkedin-chain.ts:60` banner text ("read-only walk of the first configured surface") goes stale under the loop — covered by the docs-only follow-up commit (the `9fded75` pattern), never edited by this design.

## Design History

- Slice 1: Config surface-count rule (>= 1) — approved as generated (slice-verifier OK; one concern fixed in the same edit: the FR-8 delete also drops one adjacent blank line so Biome stays green)
- Slice 2: Probe first-pass-wins loop — approved as generated (slice-verifier: two rounds — round 1 findings fixed pre-lock: the thin-skip line gains the keyword, the test double's per-build script index moved to an internal builds counter, the floor-message grep scoped to this slice's files; round 2 OK on all rows)
- Slice 2 post-lock re-verification (follow-up 2026-11-16): the test fence's prose placeholder was replaced by the full contextFactoryFor body and the payload regenerated verbatim from the fences; slice-verifier re-dispatched (775s) — full-function audit OK (all six options.script.X reads switched, nothing dropped, scriptFor guard + internal builds counter confirmed), prior findings still resolved, D2-D7 + cross-slice + criteria all OK, zero violations.

## References

- `.rpiv/artifacts/solutions/2026-11-16_10-35-30_linkedin-surface-cap-and-probe-skip.md` — the solution analysis this design implements (Option 1, inline loop).
- `.rpiv/artifacts/research/2026-11-16_09-38-22_linkedin-surface-cap-and-probe-skip.md` — the full evidence base behind every file:line cited here.
- `.rpiv/artifacts/discover/2026-11-16_09-00-43_linkedin-surface-cap-and-probe-skip.md` — the FRD this chain serves.
- `src/linkedin-fetch.ts:276-339` — the loop's error-taxonomy template and join precedence.
- `scripts/probe-linkedin.ts:145-223` — the conversion site, the local gates, and the CLI arms.
- `src/config-file.ts:168-218` — the guard chain (order is load-bearing).
- `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md` — the code-commit + docs-follow-up pattern.
- `.rpiv/artifacts/plans/2026-11-12_15-41-06_linkedin-operator-chain.md` — the side-effect-free-import lesson.
