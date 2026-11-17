---
date: 2026-11-17T14:46:10+0700
author: Yogiswara Utama
commit: 2fb8ed4
branch: ukind/feature-update-waiting-linkedin
repository: feature-update-waiting-linkedin
topic: "Configurable LinkedIn watch-loop wake cadence"
tags: [research, codebase, linkedin-behavior, watch-linkedin, config-file]
status: ready
last_updated: 2026-11-17T14:46:10+0700
last_updated_by: Yogiswara Utama
---

# Research: Configurable LinkedIn watch-loop wake cadence

## Research Question

How does the PC loop's hard-coded jittered 28–33-minute wake band (`npm run watch-linkedin`) become two optional integer keys in `watcher.config.json` — `linkedinWakeMinMinutes` / `linkedinWakeMaxMinutes`, each independently defaulting to 60 minutes, read once at startup, invalid values fail-visible — while keeping the hermetic loop tests offline, the hosted run safe, and the 40-minute payload staleness rule untouched (operator-accepted degradation)?

Chained from the FRD: `.rpiv/artifacts/discover/2026-11-17_14-11-59_linkedin-wake-cadence-config.md`.

## Summary

The change is a clean clone of the `scrollRounds` optional-key pattern (`src/config-file.ts:309-319`) plus a parameterized draw. Registration (ALLOWED_KEYS, `src/config-file.ts:60-69`) and reading (two `readScrollRounds`-shaped readers with default 60) are two edits in one file; the unknown-key gate at `:108-114` runs before any reader. The draw `sampleTickDelayMs` (`src/linkedin-behavior.ts:46-48`) takes the bounds as parameters — the module's IO-free doctrine (`:12-14`) extends naturally, and the degenerate 60/60 band needs zero sampler arithmetic (span 0 collapses to exactly 3,600,000 ms).

The load-bearing discovery: the PC loop's tick faults are warn-and-continue (`scripts/watch-linkedin.ts:63-73`), so a config read reached through the tick path (`scripts/fetch-linkedin.ts:361`, re-loaded every wake today) can never stop the loop. The read must live in the entry guard (`scripts/watch-linkedin.ts:85-90`), whose `.catch` → `process.exit(1)` is the only fail-stop seam; the resolved bounds inject through new `RunLoopDeps` fields to keep the hermetic suite (`tests/watch-linkedin.test.ts:31-77`) offline.

Developer decisions at the checkpoint: the wake log gains a band suffix; the cross-key `min > max` rule lives loop-side only (hosted run stays green); the committed `watcher.config.json` gains both keys = 60 explicitly.

## Detailed Findings

### Config layer: one key, three edits, one file

- `WatcherConfig` gains `linkedinWakeMinMinutes: number` / `linkedinWakeMaxMinutes: number` beside `scrollRounds: number` (`src/config-file.ts:57`); the interface + reader calls + return literal (`src/config-file.ts:125-134`) form one type-checked cluster.
- `ALLOWED_KEYS` (`src/config-file.ts:60-69`) is a separate registration edit: TypeScript never cross-checks it against the interface. Committing the new keys to `watcher.config.json` without registration kills every config load with `config: <path> has unknown key "…"` (`src/config-file.ts:111`) — the hosted run at `src/index.ts:231` exit-1s via `src/index.ts:674-678`.
- Reader clone template `readScrollRounds` (`src/config-file.ts:309-319`): named default constant (`:302`), absent branch returns the default (`:310-312` — JSON never produces `undefined`, so absence is exactly "operator omitted the key"; explicit JSON `null` falls through and fails visibly), invalid guard rejects string/boolean/fraction/zero/negative/NaN in one expression (`:313-316`), valid value passes through untransformed (`:318`).
- Readers run in block order (`src/config-file.ts:116-123`); appending the wake readers after `:123` means a malformed earlier key surfaces first when multiple keys are broken.
- Test plan already pinned for this shape: `tests/config-file.test.ts:240-268` (absent→default, ok, fraction rejected, zero rejected, non-number rejected with got-clause) plus the unknown-key pin at `:83`. The wake keys mirror all six assertions per key.
- Error precedence note: per-key validation (integer ≥ 1, default 60) is inherited by ALL four `loadWatcherConfig` consumers. Only the pairwise `min ≤ max` rule is loop-side (developer decision below).

### Behavior layer: the draw becomes a function of the band

- Current: `sampleTickDelayMs(rng)` (`src/linkedin-behavior.ts:46-48`) reads module constants `WAKE_MIN_MS = 28 * 60_000` (`:31`) and `WAKE_MAX_MS = 33 * 60_000` (`:39`). Contract: `Math.floor(min + rng() * (max - min))`, floor never round (rounding could land ON the exclusive ceiling, `:43`), `rng() === 0` pins the floor exactly (`:44`), ceiling exclusive because `RandomFn` is `[0, 1)` (`:28`).
- Exactly 8 call sites (grep-verified): 1 production (`scripts/watch-linkedin.ts:74`), 3 in `tests/linkedin-behavior.test.ts` (`:32`, `:39`, `:49`), 4 in `tests/watch-linkedin.test.ts` (`:46-49`, the transcript oracle). A signature change is enforced mechanically by `tsc --noEmit`.
- Two viable shapes: (A) required bounds args, constants deleted; (B) optional args defaulting to repurposed constants (both re-valued 60). The FRD's acceptance list implies B — the pins "become assertions on the *default* bounds (both 60)". Either shape must keep `rng()` the first argument and one `rng()` call per draw — the transcript oracle depends on exact rng-stream consumption.
- Degenerate band is free: min === max makes `max - min === 0`, so every draw is exactly `min` (3,600,000 ms flat) with no special-casing anywhere.
- Purity doctrine survives: bounds join dates and rng as injected inputs (`src/linkedin-behavior.ts:12-14`); `RandomFn` is unchanged and shared with the pacing gate (`src/linkedin-fetch.ts:30,145,181,196-197`) — the config keys scope to the wake seam only; do NOT touch `PACE_MIN_MS`/`PACE_MAX_MS` (`src/linkedin-fetch.ts:78,85`).

### Loop wiring: the entry guard is the only fail-stop seam

- `scripts/watch-linkedin.ts` imports no config module today (imports are `:17-21` only). Config reaches the loop indirectly and per-tick: default tick `() => fetchTick({ env })` (`:50`) → `fetchTick` re-loads the file every wake (`scripts/fetch-linkedin.ts:361`).
- The loop's per-iteration try/catch (`scripts/watch-linkedin.ts:64-73`) routes leg-dead to `onLegDead` (`:67-68`) and everything else to `console.warn` + continue (`:69-72`). A config error on the tick path warns forever and the loop keeps running at the old cadence — fail-visible per tick but NOT fail-stop. The FRD's read-once-at-startup requirement exists to close exactly this.
- Correct placement: `loadWatcherConfig()` awaited in the entry-guarded main (`scripts/watch-linkedin.ts:85-90`), top-level-await style — the verbatim precedent is `scripts/probe-judge.ts:49-50` ("Read once at startup; a missing or malformed file fails the probe loudly"). The throw lands in the guard's `.catch` → `watch-linkedin: FAILED — <message>` + `process.exit(1)` (`:86-89`), before iteration 1.
- Why not `runLoop` defaults: `tests/watch-linkedin.test.ts` constructs bare `runLoop({…})` calls with no fs/env in five places (`:31-40`, `:59-69`, `:74-82`, `:87-93`, fault arms) — a filesystem default at resolution time (`scripts/watch-linkedin.ts:49-59`) would read the repo's production config in tests and break hermeticity (contrast: `envWithDotEnv()` is legal there because ENOENT degrades quietly; `loadWatcherConfig` throws on absence). Also importing the module must stay side-effect free — that import IS the entry-guard pin (`tests/watch-linkedin.test.ts:8-10`).
- Injection: new optional `RunLoopDeps` field(s) (`scripts/watch-linkedin.ts:24-39`) carrying the resolved ms bounds; `undefined` falls back to sensible defaults in the prologue (`:49-59`), exactly like `rng ?? Math.random` (`:58`). Unit conversion (minutes → ms, `* 60_000`) belongs at the injection site; config keeps operator units (minutes), mirroring `readRecencyHours` keeping hours (`src/config-file.ts:276-281`).
- Band-suffix decision (checkpoint): the log line gains `(band 55-65 min)` — derivable from the already-injected ms bounds (`Math.round(minMs / 60_000)`–`Math.round(maxMs / 60_000)`), so NO extra deps field is needed beyond the bounds. Place the suffix after `(hh:mm local)` so the existing substring pins `tests/watch-linkedin.test.ts:95-96` stay structurally green.

### Wake log: one variable feeds log AND sleep

- The line (`scripts/watch-linkedin.ts:74-80`): `delayMs = sampleTickDelayMs(rng)` → `wakeAt = new Date(now() + delayMs)` → local hh:mm → `watch-linkedin: next wake in ~${Math.round(delayMs / 60_000)} min (${hh}:${mm} local)`. The sleep at `:81` uses the same `delayMs`, so the logged number can never disagree with the actual sleep regardless of bounds source.
- Under 60/60: `Math.round(3_600_000 / 60_000) = 60` exactly (no rounding hazard) → `~60 min`; the `(14:33 local)` wall-clock pin (`tests/watch-linkedin.test.ts:96`) is reproduced by seeding `now` at 13:05 (+60 = 14:33) — the `now` seam (`scripts/watch-linkedin.ts:57`, test injection `:91`) decouples clock from delay.
- `getHours()`/`getMinutes()` are local-time; the test's `new Date(2026, 9, 26, 14, 5)` local constructor makes the pin timezone-independent (`tests/watch-linkedin.test.ts:91`).

### Blast radius: all four config consumers inherit per-key validation

| Consumer | Load site | Throws when key invalid | Exit path | Names the key? |
|---|---|---|---|---|
| Hosted run | `src/index.ts:231` | before any work | fallback `src/index.ts:674-678` → exit 1 | yes (message carries it) |
| PC tick (one-shot) | `scripts/fetch-linkedin.ts:361` | before git/cookies/browser | fallback `scripts/fetch-linkedin.ts:479-483` → exit 1 | yes |
| PC tick (inside loop, current wiring) | same, per tick | per wake | loop catch `scripts/watch-linkedin.ts:69-72` → warn + continue | yes (but loop survives) |
| Probe gate | `scripts/probe-linkedin.ts:165` | first statement, before cookies/browser (`:179`, `:208`) | fallback `scripts/probe-linkedin.ts:277-279` → exit 1 | yes |
| Probe-judge | `scripts/probe-judge.ts:50` (top-level await) | before `main()` (`:274`) | raw unhandled rejection + stack trace → non-zero | yes (no tidy prefix) |

- The throw is an untagged plain `Error` matching no tagged classifier (`isHalt`/`isLegDead`/`isRotationExhausted`/probe gates), so every consumer drains to its generic `FAILED` printer — the single reason the key name is guaranteed on every exit path.
- Hosted-cron assessment: a bad wake value reds every scheduled run within ≤10 min (`watch.yml:5` cron + `src/index.ts:231`) — byte-for-byte the existing fail-visible doctrine for every other key, explicitly accepted by the FRD constraint ("the new keys are validated everywhere even though only the PC loop consumes them"). Valid values change hosted behavior by exactly zero (absent → 60 at the reader).
- Dispatch probe (`watch.yml:120-121` gates on probe success) would red at `scripts/probe-judge.ts:50` before any LLM spend; the scheduled path skips the probe inside the freshness window (`watch.yml:41-78`), so scheduled ticks are unaffected by probe-judge.
- Post-change ordering insight: push-to-main-first ⇒ hosted reds in ≤10 min; restart-the-loop-first ⇒ loop dies instantly at startup. Either way all surfaces name the key — "the two surfaces fail together or not at all" for per-key validation.

### Cross-key rule (min > max): loop-side only (developer decision)

- The single-key reader pattern cannot express it — each reader sees one value (`src/config-file.ts:309-319`); no reader in the module compares two sibling keys today.
- Decision (checkpoint): the pairwise check lives in a loop-side resolution step (e.g. a `resolveLinkedinWakeBand`-style helper over the validated ints), called once at loop startup inside the entry guard. A broken band exit-1s ONLY the PC loop; the hosted run, probes, and tick stay green (per-key validation still applies everywhere via the readers).
- The error names both keys and their values — new error vocabulary for the config module's contract (`config: <path> "linkedinWakeMinMinutes" (70) must not exceed "linkedinWakeMaxMinutes" (60)` shape). No precedent exists for a two-key error message (`src/config-file.ts:315` is the closest shape).
- Partial-band semantics fall out of the independent defaults with no special-casing: both absent → `[60, 60)` flat; min-only 55 → `[55, 60)`; max-only 90 → `[60, 90)`.

### Tests: pins that go red, tests that are born

`tests/linkedin-behavior.test.ts`:
- `:35` and `:40` — literal pins `28 * 60_000` / `33 * 60_000` become default-bounds pins (both 60 → 3,600,000).
- `:39-42` — ceiling probe asserts `delay < WAKE_MAX_MS` at `rng() = 0.999999999`; under degenerate defaults `3_600_000 < 3_600_000` is FALSE. Must inject a non-degenerate band (e.g. `[55, 60)`: max draw 3,599,999 ✓) or the assert relaxes on the default path.
- `:45-55` — the seeded sweep's anti-collapse guard (`:54`, `draws.size > 1`) INVERTS on the default path (all 1,000 draws identical is now correct behavior). Extract a bounds-parameterized sweep helper and instantiate three ways: `[55, 65)` (support 600,000), `[55, 60)` (support 300,000, proves exclusivity is a draw property, not a constant property), and the degenerate `[60, 60)` (every draw === 3,600,000, size === 1).

`tests/watch-linkedin.test.ts`:
- `:44-51` — the transcript oracle (recompute expected via the same LCG seed) still passes under flat-60 but loses ALL discriminative power (every stream yields the same constant). A band-injected runLoop variant must carry the seed-determinism oracle forward.
- `:53` — the band assert `ms >= WAKE_MIN_MS && ms < WAKE_MAX_MS` breaks outright under degenerate defaults; must become degenerate-safe (`<=` or equality when span 0).
- `:54` — the `notEqual(ms, 600_000)` old-fixed-10-min regression guard survives untouched.
- `:95-96` — the log pins move in lockstep: `~28 min` → `~60 min`, `14:33 local` → re-seed `now` one hour earlier; with the band suffix decision the line reads `… (14:33 local) (band 60-60 min)` — substring pins survive the suffix placement.
- Untouched: order test (`:58-71`), cap-0 (`:74-83`), both fault arms (`:101+`) — band-agnostic.

Gate mechanics: `npm run typecheck` forces all 8 sampler call sites through the signature change; `npm test` runs every pin above — there is no exit-0 path that leaves a 28/33 literal standing.

### Staleness contract: kept, degraded, doc-truthfulness only

- `PAYLOAD_MAX_AGE_MS = 2_400_000` (40 min) stays the literal at `src/linkedin-payload.ts:38`; enforcement `ageMs > PAYLOAD_MAX_AGE_MS` at `:188` (strict `>` — exactly 40 min is still ok, pinned `tests/linkedin-payload.test.ts:109`). Never derive it from the configured band — deriving would silently re-tighten under fast operator bands (the original 2026-11-09 DARK bug shape).
- Under the 60-min default the payload is fresh 40 of every 60 minutes → ~1 hosted run in 3 reads `stale` (`src/linkedin-payload.ts:188-194` returns `{ posts: [], leg: "stale", detail: "payload 1h old" }` — hour-granularity rounding renders "1h old" for any age ≥ 40 min < 90 min at `:189-191`) and degrades to threads-only. D13: never fails a run; surfaces as an email leg line (`src/index.ts:295-300` → `src/email.ts:139-142`).
- Doc claims that go FALSE (truthfulness edits, behavior untouched):
  - `src/linkedin-payload.ts:33-37` — "worst case (33 minutes) plus margin" → the bound is now operator-frozen at 40 min, decoupled from the configurable cadence, ~1-in-3 stale accepted (decision 2026-11-17).
  - `src/linkedin-behavior.ts:36-37` — "PAYLOAD_MAX_AGE_MS 30 -> 40 min clears this worst case with margin" → demote to history; the live worst case is operator-configured.
  - `src/linkedin-fetch.ts:84` — "mirroring the wake-cadence bounds" → re-point at the floor idiom (`sampleTickDelayMs`), not "the bounds" (which become parameters, not a stable referent).
  - `tests/linkedin-payload.test.ts:79` — test NAME carries the false claim ("the 33-minute worst-case wake plus margin"); the assertion at `:80` is the keep-the-rule enforcement and stays verbatim.
- The coupling lives ONLY in these four doc sites (grep-confirmed) plus historical artifacts; the writers' side is `scripts/fetch-linkedin.ts:465` (`writePayloadAtomic` per successful tick, `writtenAt` stamp `src/linkedin-payload.ts:117-121`), with the halt/all-faulted/zero-post arms deliberately preserving the last good payload (`scripts/fetch-linkedin.ts:453-462`).

## Code References

- `src/config-file.ts:48-58` — `WatcherConfig` interface; two new fields beside `scrollRounds: number` (`:57`)
- `src/config-file.ts:60-69` — `ALLOWED_KEYS`; registration edit, `"scrollRounds"` at `:68`
- `src/config-file.ts:108-114` — unknown-key gate (throw message `:111`); runs before readers
- `src/config-file.ts:116-123` — sequential reader block; wire the two wake readers after `:123`
- `src/config-file.ts:125-134` — typed return literal (field at `:133`)
- `src/config-file.ts:302-319` — `DEFAULT_SCROLL_ROUNDS` (`:302`) + `readScrollRounds` (`:309-319`): absent branch `:310-312`, guard `:313`, message `:315`, pass-through `:318` — the clone template
- `src/config-file.ts:355+` — `resolveSurfaces`: precedent for exported pure resolvers over validated config
- `src/config.ts:111-116` — `CONFIG_PATH = "watcher.config.json"` (loader default `src/config-file.ts:77`)
- `src/linkedin-behavior.ts:12-14` — IO-free doctrine (bounds join rng/dates as arguments)
- `src/linkedin-behavior.ts:16-20` — "at most 52 wake-ups per local day" arithmetic; FALSE once any positive integer is allowed — rewrite as a formula over the configured floor
- `src/linkedin-behavior.ts:28` — `RandomFn` type; unchanged, shared with the pacing gate
- `src/linkedin-behavior.ts:30-39` — `WAKE_MIN_MS` (`:31`) / `WAKE_MAX_MS` (`:39`) + margin claim `:36-37` (goes historical)
- `src/linkedin-behavior.ts:46-48` — `sampleTickDelayMs`; the parameterization site
- `scripts/watch-linkedin.ts:3,42-43` — "jittered/uniform 28-33-minute sleep" prose (stale after the change)
- `scripts/watch-linkedin.ts:24-39` — `RunLoopDeps`; gains bounds fields
- `scripts/watch-linkedin.ts:49-59` — `runLoop` prologue; bounds resolution beside `rng ?? Math.random` (`:58`)
- `scripts/watch-linkedin.ts:63-73` — tick fault arms: warn-and-continue (`:69-72`) — why the read cannot live on the tick path
- `scripts/watch-linkedin.ts:74-81` — draw (`:74`), wake log (`:78-80`), sleep (`:81`) — one `delayMs` feeds log AND sleep
- `scripts/watch-linkedin.ts:85-90` — entry guard + `.catch` → exit 1: the startup-read seam (precedent `scripts/probe-judge.ts:49-50`)
- `scripts/fetch-linkedin.ts:87` — deps comment "Pre-resolved config. Default: loadWatcherConfig() — fail-visible." (clone for the new RunLoopDeps doc)
- `scripts/fetch-linkedin.ts:361,420` — per-tick config load; `scrollRounds: config.scrollRounds` into the walk
- `scripts/fetch-linkedin.ts:453-467` — zero-post arm preserves payload (`:453-462`); `writePayloadAtomic` (`:465`) + push (`:467`)
- `scripts/probe-linkedin.ts:111-112,165,192,208` — ProbeDeps.config, `runProbe`, probe log, walk options (validation inherited, key never consumed)
- `scripts/probe-judge.ts:49-50` — top-level `const CONFIG = await loadWatcherConfig()` — the startup-load precedent to clone
- `src/index.ts:172,231,283` — WatcherDeps config comment; hosted load; scrollRounds forwarded to Threads fetch (wake keys ride validation only)
- `src/index.ts:295-300` — payload read arm; `linkedinLeg` build
- `src/index.ts:634-679` — entry guard fallback (`:674-678`) prints `watch: FAILED — config: …`
- `src/linkedin-payload.ts:33-38` — staleness doc (`:33-37`) + `PAYLOAD_MAX_AGE_MS = 2_400_000` (`:38`); value frozen
- `src/linkedin-payload.ts:185-194` — stale branch: gate `:188`, hour-rounded age `:189-191`, log `:192`, return `:193`
- `src/linkedin-fetch.ts:78-85` — `PACE_MIN_MS`/`PACE_MAX_MS` + the `:84` mirror note (re-point wording)
- `src/email.ts:139-142` — leg line rendered only when `status !== "ok"` (where ~1-in-3 staleness surfaces)
- `watcher.config.json:159` — `"scrollRounds":50`; the two new keys land beside it (with values 60, per decision)
- `tests/config-file.test.ts:83,240-268` — unknown-key pin; the scrollRounds reader test plan to mirror per key
- `tests/linkedin-behavior.test.ts:30-55` — floor/ceiling/sweep pins (`:35`, `:40`, `:42`, `:50-51`, `:54`); sweep extraction + degenerate variant
- `tests/watch-linkedin.test.ts:8-10,31-56,85-97` — entry-guard import pin; transcript oracle (`:44-51`) + band assert (`:53`) + 600k guard (`:54`); log pins (`:95-96`)
- `tests/linkedin-payload.test.ts:79-80,98,109` — keep-the-rule pins (name reworded, assertions verbatim)
- `.github/workflows/watch.yml:5,41-78,120-121,200` — cron, probe freshness window, dispatch gating, the run step

## Integration Points

### Inbound References
- `scripts/watch-linkedin.ts:50,74` — the loop is the ONLY consumer of the wake band (via `sampleTickDelayMs` → sleep + log)
- `src/index.ts:231`, `scripts/fetch-linkedin.ts:361`, `scripts/probe-linkedin.ts:165`, `scripts/probe-judge.ts:50` — the four config loads that inherit per-key validation without consuming the values
- `.github/workflows/watch.yml:200` — `npx tsx src/index.ts` (the hosted reader of the PC-written payload, not of the band)

### Outbound Dependencies
- `src/config-file.ts:77` → `CONFIG_PATH` (`src/config.ts:116`) — the loader the entry guard will call
- `src/linkedin-behavior.ts:46-48` — the draw the loop calls; bounds become parameters
- `src/linkedin-payload.ts:188` — the staleness gate downstream of the cadence (kept, decoupled)

### Infrastructure Wiring
- `watcher.config.json:159` — the operator edit surface; gains both keys = 60 (decision)
- `.github/workflows/watch.yml` — no change: no new secrets/env; validation rides the existing config load
- `README.md:144` — config table row pattern (`scrollRounds` "absent defaults to 8") to extend with the two new keys

## Architecture Insights

- **Fail-stop vs warn-and-continue is structural, not stylistic**: the loop's catch (`scripts/watch-linkedin.ts:63-73`) makes any tick-path config read incapable of stopping the loop. Read-once-at-startup in the entry guard is the only placement where "stop the run" has teeth — and it converts today's silent per-tick neutering (warn forever, fetch nothing) into one loud exit.
- **Two default layers, both FRD requirements satisfied at once**: the config layer defaults each KEY to 60 (absent → 60, per reader), the deps layer defaults the FIELD sensibly for hermetic tests. The loop never touches the filesystem in tests; production never runs unconfigured.
- **The degenerate band needs zero special-casing** in the sampler (`max - min === 0` → constant draw) — the special-casing lives only in TESTS, where anti-collapse guards invert to equality assertions on the default path.
- **The band suffix needs no new deps field**: derive `(band X-Y min)` from the already-injected ms bounds.
- **Error vocabulary travels in the message**: every consumer's fallback printer already names the key because `validateConfig` embeds path + key + `JSON.stringify(value)` in the message — no consumer needs wake-key awareness.
- **Untagged plain `Error` is the blast-radius design**: config errors drain to every consumer's generic `FAILED` arm; only the PC loop gains a pairwise loop-side gate (per developer decision).

## Precedents & Lessons

4 similar past changes analyzed.

### Precedent: the scrollRounds config key — the exact reader pattern
**Commit(s)**: `68c1e2d` — "feat: linkedin second surface with configurable scroll rounds" (2026-10-31)
**Blast radius**: 27 files across config, service, scripts, tests, docs
- `src/config-file.ts` — optional key, named default, `readScrollRounds`, ALLOWED_KEYS entry

**Follow-up fixes**:
- `119dc25` — "Add scrollRounds property to watcher.config.json" (2026-11-13) — the key shipped with a reader + default but no config line for 13 days; operators ran the default unaware the knob existed
- `4983bc1` — "linkedin: stop the scroll after 3 consecutive seen posts" (2026-11-13) — round-count alone burned GETs; the knob needed a smarter stop condition
- `9b92a40` — "Clean up LinkedIn entries and adjust scrollRounds" (2026-11-16) — operator retune (→50)

**Lessons from docs**:
- `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md` — FR-8 once pinned "exactly 5 linkedin surfaces" justified BY cadence arithmetic; cadence-derived invariants attract re-litigation

**Takeaway**: ship the reader, the validator, AND the committed config lines in the same change-set (this repo forgot once and paid a 13-day-later fix commit). The decision to add both keys = 60 to `watcher.config.json` pre-empts exactly this.

### Precedent: the 28–33 band + rng seam + staleness amendment (one commit)
**Commit(s)**: `7558747` — "Add LinkedIn humanlike fetch behavior" (2026-11-10); `a8752bf` (2026-11-05) introduced MAX_AGE at 30 min
**Blast radius**: 23 files, 1969+/235− across scripts, src, tests, config

**Follow-up fixes**:
- `7dcaeb3` — "N018+N024+N025: sync the payload contract and the docs with the code (phase 9/9)" (2026-11-10) — README/AGENTS/guidance still said "10-minute sleep / 600s / 30-min staleness"
- `ea11969` — "N027+N028: watch-linkedin entry guard…" (2026-11-10) — the new loop shipped WITHOUT its entry guard; same-day fix
- `69e7b46` — validation record logging the drift explicitly

**Takeaway**: every constant change leaked into ≥5 prose files outside the write-set; plan the docs sweep as a first-class slice (the two-commit doctrine: code, then docs-only with recomputed arithmetic — `f0340d7` + `9fded75`, 2026-11-15, is the working example).

### Precedent: the staleness coupling was re-opened before
**Commit(s)**: the 2026-11-15 working-window removal refused cadence changes with the explicit warning that `PAYLOAD_MAX_AGE_MS` is "sized against the 33-min wake ceiling; touching cadence re-opens that contract" (`.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md`); MAX_AGE was born 30 (2026-11-04) and amended 30→40 (`7558747`) precisely because the 28–33 band broke it.

**Takeaway**: this feature is the second opening of that contract; the operator's keep-the-rule decision settles it — record the decoupling in the four doc sites instead of re-deriving the bound.

### Precedent: config surface-count validation retune
**Commit(s)**: `22a6324` — "linkedin: config surface-count >= 1 + probe first-pass-wins loop" (2026-11-16); follow-ups `bcf5e7f`, `db94bfc`

**Takeaway**: moving pacing decisions from code invariants to operator choices is the established direction; expect the remaining cadence-derived prose (wake-up counts, staleness window, test transcripts) to need explicit re-derivation in the same change-set.

### Composite Lessons
- Ship code + committed config lines + doc sweep as one coordinated change-set; every past constant change drifted prose (`7558747`→`7dcaeb3`, `8e8f22b`→`a88494e`).
- Guide docs also pin the band: `.rpiv/guidance/architecture.md`, `.rpiv/guidance/scripts/architecture.md`, `.rpiv/guidance/tests/architecture.md` ("seeded cadence transcript (28-33 min…)") — include them in the docs sweep.
- Watch for "invisible-to-grep" comment sites (comments without the keyword vocabulary).

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-11-17_14-11-59_linkedin-wake-cadence-config.md` — the FRD this research chains from (9 decisions, acceptance criteria)
- `.rpiv/artifacts/designs/2026-11-09_19-24-42_linkedin-humanlike-fetch-behavior.md` — introduced the 28–33 band, the rng seam, the wake log, and the 30→40 staleness amendment
- `.rpiv/artifacts/designs/2026-10-27_10-29-33_reasoning-effort-llm-judge.md` — prior art for adding a config key end-to-end
- `.rpiv/artifacts/designs/2026-11-15_09-30-50_remove-linkedin-working-window.md` — the staleness-coupling warning and the docs-sweep doctrine
- `.rpiv/artifacts/designs/2026-11-12_10-34-39_linkedin-operator-chain.md` — probe config-load doctrine
- `.rpiv/artifacts/designs/2026-11-04_07-57-15_linkedin-local-leg.md` — payload staleness born at 30 min ("twice the cadence")

## Developer Context

**Q (discover: Knob location): Where should the cadence knob live?**
A: `watcher.config.json`.

**Q (discover: Default when absent): When the key is absent, what should the loop do?**
A: 60 minutes flat.

**Q (discover: Randomization shape): How should randomizing between two durations look in `watcher.config.json`?**
A: Two keys, `linkedinWakeMinMinutes` and `linkedinWakeMaxMinutes`; a fixed cadence sets both equal.

**Q (discover: Partial band config (one key present)): Pre-resolved from codebase evidence — if only one of the two keys is present, what bounds the other side?**
A: Each key independently optional; an absent key defaults to 60 (min-only `55` → band `[55, 60)`; max-only `90` → band `[60, 90)`).

**Q (discover: Staleness rule): A 60-minute cadence exceeds the 40-minute payload staleness bound (`src/linkedin-payload.ts:38`), so LinkedIn posts would drop from roughly 1 email in 3. What should change?**
A: Keep the 40-minute rule.

**Q (discover: Invalid values): If the value is nonsense — `"sixty"` or `-5` — what should the run do?**
A: Stop with a clear error naming the key.

**Q (discover: Speed floor): What is the fastest walk time the setting should allow?**
A: Any value, even 1 minute.

**Q (discover: Apply timing): You edit `watcher.config.json` while the loop is running. When should the new walk time take effect?**
A: On restart.

**Q (discover: Knob seam): Pre-resolved from codebase evidence — the 28–33 min band is defined at `src/linkedin-behavior.ts:31,39` and consumed once at `scripts/watch-linkedin.ts:74`. Make that the knob's seam?**
A: Carried as the probe-derived seam; not separately confirmed by the operator.

**Q (`scripts/watch-linkedin.ts:78-80`): Should the wake log carry only the drawn delay, or also the configured band?**
A: Show the band — the line grows e.g. `(band 55-65 min)` after the wall-clock stamp, derived from the injected ms bounds (no extra deps field).

**Q (`src/config-file.ts:116-123` vs loop-side): Where does the pairwise min > max check live?**
A: Loop-side only — a resolver called once at loop startup inside the entry guard; only the PC loop exits 1 on a broken band. Per-key validation (integer ≥ 1, default 60) still applies at every `loadWatcherConfig` consumer. The hosted run, probes, and tick stay green on min > max.

**Q (`watcher.config.json:159`): Should the committed config gain the two keys explicitly?**
A: Yes — both keys present with value 60, so the knob is discoverable in the operator's own file (pre-empts the `119dc25` 13-day-lag precedent).

## Related Research

- (none — first research artifact for this feature)

## Open Questions

None — the developer checkpoint resolved all research-level ambiguities (wake-log band suffix; min>max loop-side scope; committed config keys = 60).
