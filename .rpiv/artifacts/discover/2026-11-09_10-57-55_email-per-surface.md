---
date: 2026-11-09T10:57:55+0700
author: Yogiswara Utama
commit: dc75365
branch: ukind/feature-email-per-surface
repository: feature-email-per-surface
topic: "Email digest per surface"
tags: [intent, frd, email, notify, surfaces, config, linkedin-payload]
status: ready
last_updated: 2026-11-09T10:57:55+0700
last_updated_by: Yogiswara Utama
---

# FRD: Email digest per surface

## Summary
Split the single combined digest into one plain-text email per `watcher.config.json` surface that produced matches. The subject names the exact surface (`3 new job posts — linkedin: "hiring react"`), so the operator can triage, archive, or delete one surface's email without touching the rest. Zero-match surfaces send nothing; the run-level heartbeat stays one combined email.

## Problem & Intent
Developer's words, verbatim:

> "currenly all digest send to email is only by 1 email. it should be separated by per surfaces based on in watcher.config.json . so 1 git workflow can be send many email at once based on how many surfaces there is active or find the found the result"

> "if the watch key is too many. the email being sent is not very tidy. also i want to able distinguist if the email comes from where surface"

The pain is inbox tidiness and source legibility: one mixed email hides which surface produced which post. The fix is separation at the notify seam, not filtering.

## Goals
- One email per configured surface that found ≥1 matched post in the run.
- The subject line identifies the surface, so the inbox itself answers "where did this post come from".
- The operator can delete or archive one surface's email with no effect on the others.

## Non-Goals
- Per-surface recipients / routing to different addresses — one inbox (GMAIL_USER) stays; separation is subject and body only.
- Per-surface keyword lists — the 13 global keywords in `watcher.config.json` keep filtering every surface identically.
- Per-surface heartbeat — zero-match runs keep sending exactly one combined status email.
- Shrinking any single surface's post count — split changes grouping, not volume.

## Functional Requirements
1. Every `Post` SHALL carry its originating surface identity (surface type + configured value) from extraction through the whole pipeline: Threads extraction (`src/extract.ts`), the LinkedIn leg (`src/linkedin-fetch.ts` per-surface walk), and the payload rows of `state/linkedin-posts.json` (`src/linkedin-payload.ts` — row contract + validator update, envelope version bump with a tolerant reader).
2. A matched post SHALL be attributed to EVERY surface whose walk collected it (multi-surface membership, not first-wins).
3. The notify stage SHALL group matches by surface and send one digest email per surface with ≥1 matched post; the subject SHALL name the surface (accepted pattern: `3 new job posts — linkedin: "hiring react"`; exact template settled in design).
4. A surface with zero matched posts SHALL send nothing. A zero-match RUN SHALL still send exactly one combined heartbeat (current Gate 1/Gate 2 behavior unchanged).
5. Duplicate policy: a post found by N surfaces SHALL appear in all N surface emails; a post found by one surface SHALL appear exactly once.
6. The judge stage, the global keyword list, and `platforms` flags SHALL be unchanged: disabled platforms contribute no surfaces and no emails; a surface on a disabled platform is never "active".
7. All-or-nothing delivery (notify-before-persist preserved): every surface email SHALL be sent before any state write; any single failed send SHALL exit the run non-zero, mark nothing seen, and the next run SHALL re-send every surface's matches (accepted duplicate risk after an SMTP outage).
8. The run log SHALL report per-surface notify counts (one line per surface email sent, plus the existing `timing: notify` pair).
9. Email riders keep their current rules: the LinkedIn leg line rides when the leg is not ok, and the degraded-accounts line rides every email (per-surface or not — exact carrier settled in design).

## Non-Functional Requirements
- **Performance**: N sequential SMTP sends at the 10-minute cron cadence are acceptable; no parallel-send requirement; no new runtime dependency (nodemailer `sendText` path unchanged).
- **Security**: no new secrets, no new env vars; single Gmail credential set as today (`ENV_NAMES` untouched).
- **UX / Accessibility**: plain-text digest bodies stay the current format (numbered posts, author, permalink, platform tokens); the surface name is machine-readable in the subject.
- **Reliability**: atomic state writes and fail-visible errors unchanged; the payload reader stays total (absent/stale/malformed degrade to a logged threads-only run — attribution faults drop + count rows like today's malformed rows).

## Constraints & Assumptions
- Strict TypeScript flags stay on (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`); Node ≥ 22 ESM; no new runtime dependency without a stated need.
- The LinkedIn attribution originates on the PC leg: `scripts/fetch-linkedin.ts` → `fetchLinkedInPosts` → `writePayloadAtomic` — the per-surface arrays already exist inside `linkedin-fetch.ts`'s walk and are flattened today; tagging must happen before the flatten and survive the payload round-trip (`PAYLOAD_VERSION` bump, reader stays tolerant of old envelopes).
- One GitHub Actions run sends all surface emails; no per-surface workflow jobs or matrices.
- Assumption: identical duplicate surface values in `watcher.config.json` (linkedin "hiring react" appears twice) are collapsed to one email — otherwise the same surface sends twice per run.
- Assumption: fetch/collection order defines the stable order of a post's surface set and the email send order.

## Acceptance Criteria
- [ ] `npm run typecheck && npm run lint && npm test` exits 0.
- [ ] A fixture run with matched posts on 3 surfaces sends exactly 3 emails; each subject names exactly one surface; the union of email posts equals the run's match set, with multi-surface posts repeated per decision 5.
- [ ] A fixture run where one surface has 0 matches sends no email carrying that surface's name.
- [ ] A zero-match fixture run sends exactly ONE email total (the heartbeat), not one per surface.
- [ ] A fixture run with a mock transport that fails the 2nd of 3 surface sends: run exits non-zero, `state/seen-posts.json` is byte-identical, and the next fixture run re-sends all 3 surfaces' matches.
- [ ] A payload envelope written by the updated PC leg parses under the updated reader, and a legacy (version-bumped) envelope degrades with one logged line instead of failing the run.
- [ ] The notify stage logs one `email: sent digest ...` line per surface with per-surface counts.

## Recommended Approach
Extend `Post` with per-surface attribution collected before the LinkedIn flatten (and in Threads extraction), carry it through the payload row contract, then group matches by surface at the notify seam in `src/index.ts` and loop the existing `sendDigest`/`sendText` path once per surface group — one transport, one recipient, subjects naming the surface; heartbeat, judge, state, and workflow machinery unchanged.

## Decisions

### Split by configured surface, not platform
**Question**: Post carries no surface field today (src/types.ts:10-23). Per-surface emails need surface identity added to Post and threaded through extract, linkedin-payload validation, and email. Which split?
**Recommended**: Per configured surface
**Chosen**: Per configured surface (chosen after a concrete inbox-preview example)
**Rationale**: the stated intent is per-surface distinction; per-platform collapses 31 surfaces into 2 and — with Threads off — changes nothing today (evidence: src/types.ts:10-23, watcher.config.json platforms.threads=false)

### Send rule: only surfaces with matches
**Question**: 20 LinkedIn surfaces are live. Should a surface with zero matches still send an email?
**Recommended**: Only surfaces with matches
**Chosen**: Only surfaces with matches
**Rationale**: "every active surface" means up to 20 emails per 10-minute run around the clock; matches-only keeps the inbox calm (intent: tidiness)

### Duplicates ride every matching surface
**Question**: Overlapping surfaces ("hiring react", "hiring frontend") can find the same post — where does it land?
**Recommended**: First surface wins
**Chosen**: Every matching surface (chosen after seeing both inbox previews)
**Rationale**: the operator wants the full per-surface picture and accepted seeing a post more than once

### Heartbeat stays one combined email
**Question**: With per-surface digests, what happens to the zero-match heartbeat?
**Recommended**: Keep one combined heartbeat
**Chosen**: Keep one combined heartbeat
**Rationale**: heartbeat is run-level funnel status, not surface output; per-surface heartbeats would fire up to 20 quiet-run emails (evidence: src/heartbeat.ts, src/index.ts Gate 1/Gate 2)

### Recipients: non-goal — one inbox
**Question**: Multi-recipient routing as a non-goal?
**Recommended**: Non-goal — one inbox
**Chosen**: Non-goal — one inbox
**Rationale**: intent asks "which surface sent this", not "who should receive it" (evidence: src/email.ts:13-17 — EmailConfig.to resolves to the Gmail user)

### Keywords stay global
**Question**: Per-surface keyword scoping in scope?
**Recommended**: Keep global keywords
**Chosen**: Keep global keywords (chosen after a concrete email-content preview)
**Rationale**: the complaint is grouping/legibility, not filtering; per-surface keywords add config schema + judge-call cost for an unrequested behavior change

### Send failure: keep all-or-nothing
**Question**: Gmail fails on one surface's email mid-run — what should happen?
**Recommended**: Keep all-or-nothing
**Chosen**: Keep all-or-nothing (chosen after a concrete failure-timeline preview)
**Rationale**: preserves the documented notify-before-persist invariant (evidence: src/index.ts match path — sendDigest before persistJudged; a failed send exits non-zero, state untouched); accepted cost: duplicated emails after an SMTP outage

### Subject names the surface
**Question**: How does an email identify its surface? (implicit in the split preview the developer selected)
**Recommended**: Subject carries the surface label
**Chosen**: Subject carries the surface label — accepted pattern `3 new job posts — linkedin: "hiring react"`
**Rationale**: the inbox list itself must answer "where is this from" (intent answer); exact template is a design detail (evidence: preview selected in interview)

## Open Questions
None — every interviewed branch resolved; nothing was explicitly deferred.

## Suggested Follow-ups
- `watcher.config.json` surfaces array lists linkedin `"hiring react"` twice — with per-surface emails this double-sends identical emails unless duplicate surface values collapse (see Constraints assumption).
- `watcher.config.json` carries the probable typo `"hiring developer jakkarta"` — a real surface today; unaffected by this feature, worth a config pass.
- Two near-duplicate techthreads URL surfaces (`serp_type=tags&filter=recent` with and without `exact_match=false`) — same overlap concern as the duplicate keyword surface once Threads is re-enabled.
- The digest subject suffix pin "(#hiring indonesia)" (src/email.ts buildSubject) needs a per-surface keep/drop ruling in design.
- Which per-surface email carries the linkedinLeg / degraded-accounts riders (all of them vs the first) is a design decision left open by requirement 9.

## References
- `watcher.config.json` — the surfaces array driving the split (31 entries; 20 LinkedIn live, Threads off)
- `src/types.ts` — Post contract (no surface field today)
- `src/email.ts` — sendDigest / buildDigest / buildSubject / sendText (the notify seam)
- `src/index.ts` — runWatcher funnel, Gate 1/Gate 2 heartbeat, notify-before-persist match path
- `src/heartbeat.ts` — the combined zero-match status email (unchanged)
- `src/linkedin-payload.ts` — payload envelope/validator (needs surface-aware rows + version bump)
- `src/linkedin-fetch.ts` — per-surface walk (perSurface arrays) flattened today
- `scripts/fetch-linkedin.ts` — PC leg payload writer (attribution origin)
- `.rpiv/guidance/src/architecture.md`, `.rpiv/guidance/scripts/architecture.md` — doctrine: funnel gates, notify-before-persist, PC-leg contract
