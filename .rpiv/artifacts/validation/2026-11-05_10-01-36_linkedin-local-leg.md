---
date: 2026-11-05T10:01:36+0700
author: Yogiswara Utama
commit: 4c11e0f
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "Validation of LinkedIn leg on the local PC"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md"
tags: [validation, linkedin, voyager-graphql, curl-impersonate, playwright, local-loop, payload-handoff, sdk-removal, login-helper]
blockers:
  - id: b1
    command: "npx tsx .rpiv/tmp/session-dead-rehearsal.mjs"
    file: "src/linkedin-fetch.ts"
    line: 173
  - id: b2
    command: "npx tsx .rpiv/tmp/session-dead-rehearsal.mjs"
    file: "scripts/fetch-linkedin.ts"
    line: 218
last_updated: 2026-11-05T10:01:36+0700
---

## Validation Report: LinkedIn leg on the local PC

### Implementation Status

- ✓ Phase 1: Voyager client core (pure) — Fully implemented
- ✓ Phase 2: Session cookies module — Fully implemented
- ✓ Phase 3: Fetch module — transport adapters, fault classification, runPool walk — Fully implemented (classifier premise disproven live — see Findings)
- ⚠️ Phase 4: Payload + PC scripts + alarm + wiring — Partially implemented (see Findings: session-dead rehearsal failed under live execution)
- ✓ Phase 5: Watch-side ingest re-key — Fully implemented
- ✓ Phase 6: SDK removal + residue sweep + docs — Fully implemented
- ✓ Phase 7: Login helper + auto-env — Fully implemented

All 7 phases' code is present and matches the plan fences; every automated gate passes (333/333 tests). The verdict fails on one live-rehearsed criterion: **a dead session does not surface as leg-dead — the tick pushes an empty payload instead of alarming.**

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — no errors
- ✓ Lint: `npm run lint` — 52 files checked, no fixes needed
- ✓ Tests: `npm test` — 333/333 pass, 77 suites, 0 fail, 0 skipped
- ✓ Fixture scrub — 0 hits for `li_at|jsessionid|cookie|authorization|csrf` in `tests/fixture/voyager-search-response.json`
- ✓ `src/judge-rotation.ts` byte-identical after the re-key — `git diff --name-only` empty
- ✓ Residue sweep — 0 lines for `linkedapi|linked_api|LINKED_API|fetch-linkedin-api` outside `.rpiv/artifacts/**`
- ✓ Wording sweep — 0 hits for `linked API|linked-api` in src/tests/scripts; the only surviving `SDK` is the `src/judge.ts:4` "no SDK" note (still true)
- ✓ `ENV_NAMES` final state — 3 LinkedIn names in (`LINKEDIN_COOKIES_FILE`, `LINKEDIN_TRANSPORT`, `CURL_IMPERSONATE_BIN`), the SDK-era `linkedApi*` pair fully removed
- ✓ `@linkedapi/node` gone from dependencies (`nodemailer`, `playwright` only); `.gitignore` carries `linkedin-cookies*.json` and the episode flag, no `linkedin-state*.b64` residue
- ✓ package.json — all four npm entries present; lint + format globs include all four PC scripts
- ✓ Plan-command artifact, not a failure: the Phase 7 criterion's `git grep -n "envWithDotEnv" -- scripts` matches nothing because the four PC scripts are untracked (`git grep` searches tracked files only). Plain grep confirms all four wire `envWithDotEnv` — the env resolution the criterion checks for is present.
- ✓ No regressions detected — threads, judge, state, and heartbeat suites untouched and green

### Code Review Findings

#### Matches Plan:

- Conflict rehearsal (Phase 4 manual item) **PASS** over real git: a bot commit landed on a local bare remote between the PC clone's checkout and its push; `pushPayload` rebased the payload commit on top and pushed — remote log carries both commits (`linkedin: payload 0 post(s)` above the bot commit).
- Corrupt-cookie probe exits 1 (`npm run probe-linkedin` → resolver rejects malformed JSON naming `LINKEDIN_COOKIES_FILE`); `npm run fetch-linkedin` also exits 1, and the resolver failure happens before any episode-marker write.
- Doc spot-checks all match byte-for-byte: §4.2 worked example (`hiring%20react`, with the plan-sanctioned §12.4 orderBy omission + `sortBy:date_posted` addition), §12.7 canonical URL (`#`→`%23`, queryId/queryName exact), §10 cookie template (`li_at` unquoted first, `JSESSIONID` quoted last, csrf quote-stripped).
- Phase 7 resolver message verified live: the unset-cookie probe failure points at `npm run login-linkedin` exactly as the criterion requires.
- Wiring matches the fences: `index.ts` re-key (`linkedinFetch: (payloadPath, now) => Promise<PayloadRead>` defaulting to `readPayloadPosts`, D13 belt catch), heartbeat leg line with conditional spread, `buildDigest(leg?)` + `legDetailSuffix`, `buildLegDeadAlarmText`/`sendLegDeadAlarm`, entry guards on both PC entry scripts, `LINKEDIN_PAYLOAD_PATH = "state/linkedin-posts.json"`, watch.yml SDK secret mappings removed.
- Module export surfaces match the plan fences across all five new src modules and both exported-script modules.

#### Deviations from Plan:

- Phase 4 manual criterion "**Session-dead rehearsal: corrupt the cookie-file copy → the tick throws leg-dead → exactly ONE alarm email and the loop continues**" failed under live execution. A shape-valid dead cookie pair driven through the real `fetchTick` produced a **pushed empty payload**, not a leg-dead abort. Three code sites:
  - `src/linkedin-fetch.ts:173` — `classifyFault` branches only on 403/401/400/500 (lines 140–173); HTTP 302 falls through to the generic `fault` branch → the walk warn+skips the surface (398 → 414) instead of flagging leg-dead.
  - `src/linkedin-fetch.ts` `createPlaywrightTransport.get` — Playwright follows the redirect loop, exhausts 20 redirects, and **throws** `Max redirect count exceeded`; no status ever reaches the classifier, and the throw lands in the same generic-fault catch. Both transports mis-present the dead leg as a skippable surface fault.
  - `scripts/fetch-linkedin.ts:218` — `fetchTick` writes and pushes the payload unconditionally after the walk; an all-surfaces-faulted tick publishes a fresh, empty `state/linkedin-posts.json`, which the hosted reader scores `leg: "ok"` (fresh writtenAt, zero posts) — the dead leg becomes invisible hosted-side and the previous good payload is clobbered. This defeats D13's legibility intent ("PC off → payload goes stale → one log line").
- The plan's classifier fence was transcribed verbatim from `DOCUMENTATION.md` §13.3/§13.1, and the doc's premise does not hold for this client stack: §13.1 states the API answers 401/400/403 and that 302-to-login is browser-navigation behavior only, but the live trace shows the API-request context receiving 302 loops (with `set-cookie: li_at=delete me` and Cloudflare `__cf_bm` cookies in the chain). This is a plan/deviation, not implementer error — the fence it copied is contradicted by live observation. Whether the 302 means session-death or edge-level fingerprint blocking does not change the remedy (refresh cookies / switch transport), so classifying the redirect loop as leg-dead is correct without resolving root cause.

#### Pattern Conformance:

- ✓ Tagged-error idiom (`LegDeadError` mirrors `judge-rotation.ts`), entry-guard idiom (`index.ts` shape on both PC entries), atomic-write idiom (`state.ts` shape in payload + cookie file), `runPool` reuse with side arrays, dynamic-import quarantine for playwright, offline `node:test` suites with injected clocks/sleeps/seams — all follow established repo conventions.
- Minor observation (acceptable variation, not a deviation): the phase-4 probe fence read `process.env` directly; Phase 7 rewired it through `envWithDotEnv()` per the plan's own revision — consistent with the revised plan.

#### Potential Issues:

- **[blocking, b1]** Dead-session redirect loop not classified leg-dead — `src/linkedin-fetch.ts:173` (curl path: 302 → generic fault) and the `createPlaywrightTransport.get` throw path (playwright: max-redirects error → generic fault). Fix both sites: classify a 302/3xx on the finder as leg-dead, and surface the transport-level redirect-exhaustion as leg-dead rather than a plain error.
- **[blocking, b2]** `fetchTick` publishes the empty payload of a fully-faulted walk — `scripts/fetch-linkedin.ts:218`. An all-surfaces-faulted (or leg-dead-until-fixed) tick must not write/push an empty payload over the last good one; the dead leg must stay legible hosted-side.
- [non-blocking] Redirect loops are not behind the pacing gate: one `transport.get()` on a dead leg costs up to 20 unpaced HTTP requests (redirect chain), repeated per surface per 10-minute tick against an already-burned IP. Consider bounding redirects (`maxRedirects: 0` + explicit handling) when fixing b1.
- [non-blocking] `pushPayload` reports any failed `pull --rebase` as "rebase conflicted — aborting" (`scripts/fetch-linkedin.ts`), including non-conflict failures such as a missing remote ref; observed during rehearsal setup. Diagnostic accuracy nit only — the abort-loud-and-never-push behavior itself is correct and was proven by the passing rehearsal.
- [non-blocking] Playwright fallback viability: the 302 loop with Cloudflare cookies suggests edge-level fingerprinting may be in play for non-Chrome-TLS clients; the fallback transport may be effectively unusable regardless of session health. Unverifiable from this checkout — the operator's probe protocol (twice, ≥6h apart) on the dedicated clone should settle it.
- [non-blocking] `.codebase-memory/artifact.json` is modified outside every phase's declared write-set — local indexer churn from graph tooling (the guidance documents the index as rewritten on reindex), not run work. Explained; no action.

### Manual Testing Required:

Executed this run (results above): conflict rehearsal PASS, corrupt-cookie probe exit 1, §4.2/§10/§12.7 spot-checks, unset-resolver message check, and the session-dead rehearsal (FAILED — the b1/b2 finding). Remaining items are human-gated:

1. Session-dead **email** leg (the machinery half passed with an injected alarm): from the dedicated clone with live GMAIL env, corrupt the cookie copy → exactly ONE alarm email arrives → restore the file → the next tick heals. Re-run after b1/b2 are fixed.
2. First live push from a dedicated clone under probe supervision — not yet possible: `state/linkedin-posts.json` has never landed on origin/main (the payload hand-off has never run in production; base 4c11e0f is not an ancestor of origin/main, which still runs the pre-branch pipeline on state commits only).
3. `npm run probe-linkedin` exit 0 on a live leg — needs the cookie file + `CURL_IMPERSONATE_BIN` in the dedicated clone (this checkout has neither). The **curl** transport's dead-session presentation is likewise unverified live; the b1 fix should be confirmed against both transports.
4. PC-off rehearsal (≥31 min dark → stale line, threads-only run, heartbeat fires) — post-merge: the deployed pipeline on origin/main does not yet carry the leg-line code.
5. Manual watch.yml dispatch green with no LinkedIn secret mapped — post-merge for the same reason (watch.yml changes are uncommitted on this branch).
6. Headed `npm run login-linkedin` real run + refresh rehearsal (harvest on a still-signed-in profile without a new login) — requires the human in the browser loop (2FA).

### Recommendations:

- Fix b1/b2 (three sites, two files), re-run the blocker command `npx tsx .rpiv/tmp/session-dead-rehearsal.mjs` to green, then re-run `/skill:validate`.
- Because the fix amends a verbatim-transcribed design fence (§13.3), decide the fork deliberately: a localized in-place fix + re-validate is defensible; if the §13.3 table in the design artifact should be amended to include the redirect-loop mechanism, run `/skill:revise .rpiv/artifacts/plans/2026-11-04_14-38-16_linkedin-local-leg.md` first.
- Do **not** commit while `verdict: fail` — the blocker command is the remediation arm's only handle.
- Keep `.rpiv/tmp/session-dead-rehearsal.mjs` until the fix lands: it is the blocker command, not scratch.
