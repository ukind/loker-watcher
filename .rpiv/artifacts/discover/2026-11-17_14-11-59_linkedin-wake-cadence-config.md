---
date: 2026-11-17T14:11:59+0700
author: Yogiswara Utama
commit: 2fb8ed4
branch: ukind/feature-update-waiting-linkedin
repository: feature-update-waiting-linkedin
topic: "Configurable LinkedIn watch-loop wake cadence"
tags: [intent, frd, linkedin-behavior, watch-linkedin, config-file]
status: ready
last_updated: 2026-11-17T14:11:59+0700
last_updated_by: Yogiswara Utama
---

# FRD: Configurable LinkedIn watch-loop wake cadence

## Summary

The PC-local LinkedIn loop (`npm run watch-linkedin`) currently wakes on a hard-coded jittered 28–33 minute band. The operator gains two new keys in `watcher.config.json` — `linkedinWakeMinMinutes` and `linkedinWakeMaxMinutes` — that set the band; each key independently defaults to 60 minutes when absent, so an untouched config means a flat 60-minute wake. The knob is read once at loop startup; a bad value stops the run with an error naming the key.

## Problem & Intent

> "currently the linkedin leg for command: npm run watch-linkedin . it runs between 30 minutes, i want to changed it to 60 minutes or make it configurable in watcher.config.json"

> "i want it to be configurable by my side"

The operator runs the always-on PC loop and wants to control its cadence without a code change. Success is editing one committed file and restarting the loop.

## Goals

- The walk cadence is set from `watcher.config.json`, not from module constants.
- Absent keys → 60 minutes (the operator's stated target), not today's 28–33.
- A fixed cadence and a randomized band are both expressible.
- A typo in either key stops the run with a message naming the key.

## Non-Goals

- Changing the 40-minute payload staleness rule on the hosted side (explicitly kept).
- Making the cadence hot-reloadable mid-run (restart applies changes).
- Adding a numeric env-var parser (the `.env` route was offered and declined).
- Touching the hosted 10-minute cron, the judge, or the notify path.

## Functional Requirements

1. The system SHALL accept `linkedinWakeMinMinutes` and `linkedinWakeMaxMinutes` in `watcher.config.json` as optional integer minute values.
2. Each key SHALL independently default to 60; with both absent the loop SHALL wake every 60 minutes flat (no jitter).
3. When both keys are present, the loop SHALL draw each wake delay uniformly from `[minMinutes, maxMinutes)`.
4. When `minMinutes === maxMinutes`, the loop SHALL wake on that fixed interval.
5. The loop SHALL read the keys once at startup, before the first sleep.
6. An invalid value (non-integer, non-positive, `min > max`) SHALL stop the run with `config: <path> "<key>" must be …` naming the key and the offending value.
7. The existing wake log line SHALL report the configured band, not the old constants.

## Non-Functional Requirements

- **Performance**: no constraint — the knob only changes PC-loop sleep length; the hosted path is untouched.
- **Security**: none — no new secrets, no new IO surface beyond the config file already read.
- **UX / Accessibility**: one committed file, two keys, fail-visible errors. The operator never edits source.
- **Reliability**: config is read once at startup, so a broken config fails loudly before the first tick rather than degrading mid-loop.

## Constraints & Assumptions

- `watcher.config.json` is loaded by the hosted run (`src/index.ts:231`), `scripts/probe-linkedin.ts:165`, and `scripts/probe-judge.ts:50` — the new keys are validated everywhere even though only the PC loop consumes them. The N053 precedent (`src/config.ts:18-23`) is why PC-only knobs normally go to `.env`; the operator chose the config file anyway.
- The 40-minute payload staleness bound (`src/linkedin-payload.ts:38`) stays. At a 60-minute cadence the hosted LinkedIn leg degrades to threads-only on roughly 1 run in 3 — accepted by the operator.
- `scripts/watch-linkedin.ts` imports no config module today; the startup read must not break the hermetic no-deps loop tests (`tests/watch-linkedin.test.ts:31-77`).
- Literal-value pins at `tests/linkedin-behavior.test.ts:35,40` (`28 * 60_000` / `33 * 60_000`) must move to the new default.
- Assumption: the operator restarts `npm run watch-linkedin` to apply an edit.

## Acceptance Criteria

- [ ] `npm run typecheck && npm run lint && npm test` exits 0.
- [ ] With both keys absent, a loop test asserts the next sleep is 3,600,000 ms.
- [ ] With `linkedinWakeMinMinutes: 55, linkedinWakeMaxMinutes: 65`, a seeded-rng test asserts every draw lands in `[55, 65)` minutes.
- [ ] With only `linkedinWakeMinMinutes: 55`, draws land in `[55, 60)` minutes (absent max → 60).
- [ ] With both keys `60`, the wake log reports ~60 min and the sleep is exactly 3,600,000 ms.
- [ ] `linkedinWakeMinMinutes: "sixty"` (or `0`, or `1.5`) → exit 1 with a message containing `"linkedinWakeMinMinutes"` and the offending value.
- [ ] `linkedinWakeMinMinutes: 70, linkedinWakeMaxMinutes: 60` → exit 1 naming both keys.
- [ ] `watcher.config.json` with the new keys present still loads clean on the hosted path (existing keys unchanged).

## Recommended Approach

Two optional integer keys on `WatcherConfig` (`src/config-file.ts:48-58`) plus `ALLOWED_KEYS` (`:60-69`), read by a `readLinkedinWakeMinutes`-style pair of readers cloned from `readScrollRounds` (`:309-318`); the loop entry (`scripts/watch-linkedin.ts`) loads the config once at startup and passes the resolved bounds into `runLoop` via a new `RunLoopDeps` field, and `sampleTickDelayMs` (`src/linkedin-behavior.ts:46-48`) takes the bounds as parameters instead of reading `WAKE_MIN_MS`/`WAKE_MAX_MS` (`:31,39`).

## Decisions

### Knob location
**Question**: Where should the cadence knob live?
**Recommended**: `watcher.config.json` — mirrors the `scrollRounds` reader (`src/config-file.ts:309-318`); cost: the hosted run also validates the key.
**Chosen**: `watcher.config.json`.
**Rationale**: The operator asked for that file by name and already edits `scrollRounds` there (`watcher.config.json:159`).

### Default when absent
**Question**: When the key is absent, what should the loop do?
**Recommended**: Keep today's 28–33 min jittered band as the documented default.
**Chosen**: 60 minutes flat.
**Rationale**: Operator's words: "absen 60 minutes" — the shipped default moves to the target cadence.

### Randomization shape
**Question**: How should randomizing between two durations look in `watcher.config.json`?
**Recommended**: One key accepting a number or a `{minMinutes, maxMinutes}` object.
**Chosen**: Two keys, `linkedinWakeMinMinutes` and `linkedinWakeMaxMinutes`; a fixed cadence sets both equal.
**Rationale**: Operator picked the two-key preview; it matches the existing flat-key style of the file.

### Partial band config (one key present)
**Question**: Pre-resolved from codebase evidence — if only one of the two keys is present, what bounds the other side?
**Recommended**: (evidence-derived) absent key → 60.
**Chosen**: Each key independently optional; an absent key defaults to 60 (min-only `55` → band `[55, 60)`; max-only `90` → band `[60, 90)`).
**Rationale**: evidence: `src/config-file.ts:311` — `readScrollRounds` returns its default when absent; both readers clone that pattern, and present-but-invalid stays fail-visible per the Invalid-values decision.

### Staleness rule
**Question**: A 60-minute cadence exceeds the 40-minute payload staleness bound (`src/linkedin-payload.ts:38`), so LinkedIn posts would drop from roughly 1 email in 3. What should change?
**Recommended**: Scale the staleness bound with the cadence.
**Chosen**: Keep the 40-minute rule.
**Rationale**: Operator chose to keep current behavior after a plain-words explanation; the degradation is accepted rather than engineered away.

### Invalid values
**Question**: If the value is nonsense — `"sixty"` or `-5` — what should the run do?
**Recommended**: Stop with a clear error naming the key.
**Chosen**: Stop with a clear error naming the key.
**Rationale**: Matches the fail-visible doctrine and the `scrollRounds` error shape (`src/config-file.ts:313-316`).

### Speed floor
**Question**: What is the fastest walk time the setting should allow?
**Recommended**: 28 minutes or slower, preserving the ≤52-wakes-per-day arithmetic (`src/linkedin-behavior.ts:16-20`).
**Chosen**: Any value, even 1 minute.
**Rationale**: Operator wants full control; the safety arithmetic is knowingly traded away.

### Apply timing
**Question**: You edit `watcher.config.json` while the loop is running. When should the new walk time take effect?
**Recommended**: On restart.
**Chosen**: On restart.
**Rationale**: A single startup read keeps a broken config loud and the loop simple.

### Knob seam
**Question**: Pre-resolved from codebase evidence — the 28–33 min band is defined at `src/linkedin-behavior.ts:31,39` and consumed once at `scripts/watch-linkedin.ts:74`. Make that the knob's seam?
**Recommended**: Yes, that seam.
**Chosen**: Carried as the probe-derived seam; not separately confirmed by the operator.
**Rationale**: evidence: `src/linkedin-behavior.ts:31,39,46-48`; `scripts/watch-linkedin.ts:74` — single consumer, injectable `rng` already present.

## Suggested Follow-ups

- The 40-minute staleness bound vs. slower cadence: if LinkedIn posts vanishing from emails becomes unwanted, scale `PAYLOAD_MAX_AGE_MS` with the cadence (`src/linkedin-payload.ts:38`; margin argument at `src/linkedin-behavior.ts:36-37`).
- The ≤52-wakes-per-day safety comment (`src/linkedin-behavior.ts:16-20`) no longer holds once sub-28-minute values are allowed — the doc block needs rewriting when this lands.
- A flat 60-minute wake loses the human-pattern jitter the old band provided; the operator can restore it via the two keys (document the band example in the README).
- No numeric env parser exists anywhere (`src/config.ts:14-31`); a future PC-only knob would need that parser first.

## References

- Input: free-text feature description (session metadata 2026-11-17T14:11:59+0700, commit 2fb8ed4).
- Prior art for adding a config key: `.rpiv/artifacts/designs/2026-10-27_10-29-33_reasoning-effort-llm-judge.md`.
