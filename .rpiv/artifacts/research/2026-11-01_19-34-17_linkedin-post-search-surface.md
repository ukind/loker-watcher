---
date: 2026-11-01T19:34:17+0700
author: Yogiswara Utama
commit: 14aaf74
branch: feature/add-support-for-linkeind
repository: feature-add-support-for-linkeind
topic: "LinkedIn surface via Linked API post search"
tags: [research, codebase, fetch-linkedin-api, linkedapi-node, index-ts, fetch-threads, config-file, watch-yml, env-names, overlap-guard]
status: ready
last_updated: 2026-11-01T19:34:17+0700
last_updated_by: Yogiswara Utama
---

# Research: LinkedIn surface via Linked API post search

## Research Question
Chained from discover (FRD: .rpiv/artifacts/discover/2026-11-01_18-53-36_linkedin-cli-post-search-surface.md): how to replace the blocked Playwright LinkedIn fetch path with an @linkedapi/node SDK post-search fetcher wired through the existing pipeline — what exactly must be rewired in runWatcher, what contract fetch-threads.ts sheds, how the token resolvers and degrade semantics work, how SDK results map onto Post, how the surface value reaches the SDK, what the full deletion blast radius is, and what the overlap-guard flip does to the timeout envelope.

Provenance note: src/index.ts and src/fetch-threads.ts were read in full and every cited line re-pinned by literal grep against the working tree (commit 14aaf74) after two agent reports were found to carry drifted numbers (example: recoverLinkedInSession was reported as :365-421 and :365-424 by different agents; grep pins the function at :365 and the full read closes it at :417). Citations in the remaining files come from agent traces, spot-verified by grep wherever the symbol appears (extract.ts, recency.ts, email.ts, judge.ts, judge-rotation.ts, pool.ts, state.ts, threads-session.ts, config.ts, config-file.ts, watch.yml, and the pinned test regexes); a few deep-range cites inside verified files (e.g. test-body ranges) remain agent-reported. The FRD cites pre-shift numbers for a few fetch-threads.ts/index.ts locations; where they differ, this document's numbers are the pinned ones.

## Summary
- The shape to unwind is a three-branch, session-conditional acquisition block (src/index.ts:168-256) plus the Phase 7 login/refresh machinery spanning src/linkedin-login.ts, scripts/linkedin-login.ts, and watch.yml:94-146. The shape to build is one token-gated, sequential, warn-and-skip LinkedIn arm injected as an optional WatcherDeps field, with no session state, no temp dirs, and no all-fail throw.
- The Threads side keeps everything: logged-out and authenticated walks, the pool, the all-fail gate, scrollRounds, THREADS_SESSION_STATE, and the Playwright install steps in watch.yml.
- The SDK surface is now documented: a type-keyed error taxonomy (LinkedApiError .type/.message), a queue-by-default working-hours policy (pendingReason "outsideWorkingHours"), searchPosts params (term 1-50 chars, sort latest, datePosted pastWeek, limit max 100), and one undocumented hazard: hashtag-as-term is not documented, and LinkedIn widens narrow queries.
- The deletion blast radius is fully enumerated (5 whole files + 9 partial) including the ripple zone the FRD's list misses: package.json:11 lint path, README sections, threads-session.ts:13 docstring.
- The watch.yml overlap guard is a one-line flip (watch.yml:13) that voids the F023 timeout arithmetic dual-maintained in watch.yml:42-54 and src/judge.ts:95-107; both comments must be rewritten in lockstep.

## Detailed Findings

### The acquisition block today, and what collapses (src/index.ts:168-256)
- Platform split at src/index.ts:174-175 over resolveSurfaces output (src/config-file.ts:220-237); Threads session at :176; LinkedIn session guarded by linkedinSurfaces.length > 0 at :177-178; credential-login fallback (guard :185, call :186-191) into recoverLinkedInSession (defined :365-417, marker path at :376, credential reads :371-372, cooldown check :377-379, marker writes :387/:398, LINKEDIN_REFRESH_PATH hand-off :411-414); skip-warn at :193-197; mixed authenticated dispatch at :199-218 (walkedSurfaces ternary :203, linkedin-only empty guard :207, options ternary :208-211); logged-out Threads walk at :225-228 with early return :229; logged-out LinkedIn append + catch-degrade at :236-248 (warn at :246); paired finally with cleanupSessionDir at :253 (Threads) and :254 (LinkedIn).
- Deleted, not replaced: the whole fallback chain (recoverLinkedInSession + src/linkedin-login.ts import block at src/index.ts:48-54) — "tokens are the session" reduces the resolve → recover → warn chain to resolve-tokens → warn-or-dispatch.
- Collapses to Threads-only: the mixed dispatch (:199-218) — walkedSurfaces becomes plain threadsSurfaces; AuthenticatedFetchOptions loses linkedinSessionPath; the linkedin-only empty guard (:207) dissolves (a LinkedIn-only config no longer routes through this arm).
- Collapses into the new module: the logged-out LinkedIn arm (:236-248) — its outer catch-degrade existed to absorb the walker's all-fail throw; the new arm degrades per-surface inside itself. The belt survives only as defense-in-depth for unanticipated faults (e.g. SDK client construction).
- Dies: cleanupSessionDir for LinkedIn at :254 (tokens mint no filesystem artifact; resolveSession's mkdtemp at src/threads-session.ts:56-59 was the reason it existed). Threads cleanup at :253 stays.
- Warning replacements: the run-level skip-warn (:193-197) re-keys to ENV_NAMES.linkedApiToken ("or invalid" likely drops — an opaque token has no offline-validatable shape, contrast isValidStorageState at src/threads-session.ts:25-31); pinned by tests/index.test.ts:573 and :603. The walk-time warn at :246 is replaced by per-surface warns inside the new module. The Phase 7 regexes at tests/index.test.ts:822/:952 die with their suite.
- New seam: an optional WatcherDeps field joining contextFactory (:121), fetchFn (:123), sleepFn (:131) — production default from the new module, stubbed offline in tests (precedent: dualPlatformContextFactory at tests/index.test.ts:499-544).

### Degradable token resolvers (developer decision: caller warns)
- Canonical degradable contract: resolveSession (src/threads-session.ts:37-60) — unset/blank → silent null (:42); malformed → warn naming the variable + null (:47-54); caller decides policy (docstring :13-17). The token version collapses to ONE exit (unset/blank): an opaque token has no payload stage to validate.
- The contract to avoid: parseLlmAccounts (src/judge.ts:132-178) throws on missing LLM_ACCOUNTS — correct for the judge pool, wrong for the tokens (FR5/D10: a secret lapse must not kill the digest).
- Home: in the new module (resolver-beside-consumer precedent: parseLlmAccounts in judge.ts:132, resolveEmailConfig in email.ts:29, resolveSession in threads-session.ts). ENV_NAMES gains linkedApiToken + linkedApiIdentificationToken in the vacated src/config.ts:16-19 slot.
- DECISION (checkpoint): the resolver returns null silently on unset; runWatcher's skip slot (:193-197 topology) emits the single warn naming LINKED_API_TOKEN, before the fetch span, still inside the acquisition timeStage, gated by the linkedinSurfaces.length > 0 check. The two re-keyed test regexes (tests/index.test.ts:573, :603) pin the message. Resolution happens in runWatcher, not inside the fetcher — which is what lets the stubbed-seam test assert the fetcher was never called (precedent: "never fired" comments at tests/index.test.ts:559, :588).

### The fetch-threads.ts shed (becomes Threads-only)
- Dies: the import at src/fetch-threads.ts:31; AuthenticatedFetchOptions.linkedinSessionPath (:302); the linkedinContext variable + lazy build (:346, :348-350); the walkLinkedInSurface closure + wiring-bug guard "linkedin surface walked without a session path" (:354-366); the platform ternary (:380-383); the linkedin teardown (:412); the D12 lazy-base machinery (:337-344 — it existed solely for linkedin-only dispatches; Threads-only makes context non-null whenever a worker runs, and runPool clamps width to items.length, src/pool.ts:51).
- Becomes provably (not just empirically) unreachable: the mirror guard "threads surface walked without a base context" (:367-375).
- Dead structural-double surface left behind: PageMouseLike (:93-96), PageLike.mouse (:114) + its adapter (:185-191) — existed only for the wheel walk; ContextLike.cookies (:127) + factory cookies (:199) — existed only for linkedin-login.ts:196. Candidates for cleanup once FR7 lands (knip-blind spot: scripts/ is outside lint's knip coverage per TECH_DEBT_AUDIT N6).
- Survives untouched: runPool + FETCH_CONCURRENCY (fetch-threads.ts:41), side arrays (perSurface/failures/emptyLabels :351-353), the per-surface catch (:390-394), the empty-surface side channel (:385-388), the all-fail throw (:397-409 — Threads' pre-existing throw contract), input-order reassembly, the base teardown (:413), scrollRounds (:304).
- Test triage (tests/fetch-threads.test.ts:518-643): "keeps Threads posts when a linkedin surface has no session path" (:547-569) dies as written but its acceptance content mutates into the runWatcher token-seam test; "walks a linkedin surface through a second context" (:571-599) dies outright (the urn-id/permalink minting it pins moves to the new module's tests); "bounds the Threads scroll loop with scrollRounds: 5" (:601-621) survives untouched; "builds one context for a linkedin-only dispatch" (:623-642) dies outright (a linkedin-only dispatch is no longer representable at this layer).

### Sequential semantics (FR4) — what the serial loop borrows
- Borrow verbatim: the catch shape error instanceof Error ? error.message : String(error) (identical at fetch-threads.ts:391, :253-256, src/index.ts:245) — the raw SDK error message reaches the log unmodified, which is what makes working-hours vs limitExceeded vs transport distinguishable.
- Borrow: warn-and-continue per item (failures ride a summary list, never stop the loop — the serial analogue of pool.ts:19-20); the total-worker discipline (the loop never rejects; every outcome is data).
- Do NOT port: the all-fail throw (fetch-threads.ts:397-409) and the empty-surface throw-fodder (:400-405). D1/D5/FR5 invert the gate: every-LinkedIn-surface-failed still returns normally. An empty result set is success + a 0-post log (precedent commit 216a617: the empty-window-as-failure bug took a fix within 12h of the surface landing).
- timeStage wrapping is positional, not structural: the sequential loop must be awaited INSIDE the existing acquisition closure (src/index.ts:168-256) so the multi-minute span inflates the single fetchMs and timing: fetch <N>ms (:257) stays the one stage-level line. Violations: invoking the module outside the closure (splits or hides the timing) or logging stage-level lines from inside (breaks the one-stage-line discipline of the timeStage docstring, src/index.ts:93-98). collected must include the LinkedIn posts through the closure's return — dedupePosts (:258) consumes it.

### Post mapping (TSearchPostResult → Post → funnel)
- Post contract: src/types.ts:10-25 — five non-nullable strings + platform: "threads" | "linkedin". Consumers of platform: src/email.ts:60 (subject " + LinkedIn") and :75-76 ([linkedin] prefix, permalink verbatim).
- Precedent mapping being replaced: mintPost (src/fetch-linkedin.ts:170-180) — id = urn:li:activity:<activityId>, permalink = https://www.linkedin.com/feed/update/<urn>, author = AUTHOR_PLACEHOLDER "linkedin-member" (constant at :60), timestamp = BigInt epoch trick. Under the SDK, activityUrn and url arrive directly; the BigInt epoch trick and AUTHOR_PLACEHOLDER die.
- Non-null pair is only { url, time }. Drop triggers: activityUrn === null, text === null, author.name === null, unparseable time. Guard BEFORE toISOString (it throws RangeError on invalid dates): Number.isFinite(new Date(result.time).getTime()) first — the extract.ts:87-113 shape (normalizeThreadItem returns Post | null, converts epoch→ISO at :111).
- Drop-and-count precedent: extractPosts (src/extract.ts:36-70; dropped counter :52, conditional warn :63-64) — counter + CONDITIONAL warn when non-zero ("extract: dropped N malformed thread item(s)"). The new module mirrors it per surface (e.g. "fetch: linkedin/<value>: dropped N malformed result(s)") so a silent null-field plague stays visible between timing: fetch (:257) and extract: N unique (:259-260).
- Why drops happen before the funnel: dedupePosts keys a Set on post.id (src/index.ts:454-463, seen.has at :458) — null ids leak duplicates into paid LLM calls; filterRecent silently NaN-drops bad timestamps (src/recency.ts:21-22) — the plague-hiding drop; judgePosts burns attempts on null text/author and persistJudged (:330, :346) then stamps those ids into seen-map FOREVER — one malformed row permanently poisons state.
- Test ports (tests/fetch-linkedin.test.ts:241-408): order assertion (:242-279) ports as "results map in SDK result order"; re-mint dedupe (:281-297) ports as a Map accumulator; empty window (:355-373) ports as "empty result → [] + 0-post log"; the three throw cases (:375-406) INVERT to rejection-of-throw assertions (catch, warn, return []) driven by the stubbed client seam. Wheel mechanics (:299-353, :164-239 parseFlightRows describes) do not port — SDK limit: 100 replaces the scroll harvest.

### Surface value plumbing (developer decision: partition raw surfaces)
- ResolvedSurface (src/config-file.ts:21-28) carries only platform/label/url; the raw value survives resolution only inside the log label (:232). The only consumer of the linkedin url is page.goto(surface.url) at src/fetch-linkedin.ts:285.
- DECISION (checkpoint): runWatcher already holds config.surfaces (config destructured at src/index.ts:154; the raw list typed Surface[] per WatcherConfig) alongside the resolved array (:159); resolveSurfaces is an order-preserving 1:1 map (config-file.ts:220-221). The new arm partitions the RAW list by surface.type === "linkedin" and passes surface.value straight to searchPosts. Zero ResolvedSurface change, no label parsing, no knock-on on Threads walkers or their deepEqual literals.
- Consequence: linkedinSearchUrlFor (src/config-file.ts:252-263, docstring :245-251) has NO surviving consumer after cutover (only caller: the resolveSurfaces linkedin arm :229-234, whose url only fetch-linkedin.ts:285 read) → it dies WITH its arm and its byte-exact test (tests/config-file.test.ts:192-203). ResolvedSurface becomes Threads-only in fact (its docstring :20 already says "the URL Playwright loads"); whether platform narrows to "threads" is a design-stage call. tagPageUrlFor (:241-243) survives — Threads walkers keep consuming surface.url (fetchOne goto at fetch-threads.ts:273; fetchOneAuthenticated goto at :450).
- Rejected alternatives (recorded): extending ResolvedSurface with value (one producer line but every resolved-surface deepEqual literal in 3 test files updates; Threads carries a field it never reads); slicing the label (lossless today — the prefix is a fixed 9 chars — but makes a display string load-bearing data; the codebase itself calls label-prefix sniffing a last resort, isTagSurface (fetch-threads.ts:218, whose docstring calls the label prefix the only discriminator)).

### The SDK surface (verified against linkedapi.io/docs + npm, 2026-11-01)
- Errors surface as LinkedApiError with .type/.message, type-keyed: request-level linkedApiTokenRequired / invalidLinkedApiToken / identificationTokenRequired / invalidIdentificationToken (all 401), tooManyRequests (429; >100 req/min/endpoint, 600 for GET result), unexpectedError, httpError. Start errors: invalidWorkflow, subscriptionRequired, plusPlanRequired, linkedinAccountSignedOut, outsideWorkingHours. Workflow failure reasons (thrown): linkedinAccountSignedOut, languageNotSupported, workingHoursWaitExpired, cancelledByUser. Action-level errors arrive in result().errors[] (NOT thrown): limitExceeded, unexpectedError ("any action"); searchPosts-specific: filterNotApplied (permanent — "correct or remove"), searchingNotAllowed (LinkedIn blocked the search — plausibly transient, docs silent).
- Retry guidance is explicit only for tooManyRequests ("wait and retry") and unexpectedError ("retry; if repeated contact support"). The four 401s are permanent until fixed. NO documented retryable-vs-permanent table — the degrade path must classify on .type prefix/name and log the raw message either way.
- Working hours: default policy is QUEUE — workflow accepted and parked (workflowStatus "pending", pendingReason "outsideWorkingHours", message names the reopen time; SDK constant LINKED_API_WORKFLOW_PENDING_REASON.outsideWorkingHours; docs say back off polling). "Reject" policy throws outsideWorkingHours at submission ("nothing is queued"). A workflow parked >7 days fails with workingHoursWaitExpired. Design implication: with default dashboard settings, "outside working hours" is a pending-poll, not an error — the warn-and-skip path must handle BOTH shapes (pending-forever and thrown).
- searchPosts params: term 1-50 chars (term or customSearchUrl required); filter.sort: "topMatch" | "latest"; filter.datePosted: "past24Hours" | "pastWeek" | "pastMonth" (FRD D9's pastWeek is valid); limit default 10, max 100 (max 20 with child actions), may return fewer than limit.
- UNDOCUMENTED hazard: hashtag-as-term is not documented anywhere; hashtags appear only as an OUTPUT field (data[].hashtags, no leading #), and docs warn "LinkedIn widens a narrow query on its own and returns loosely related posts, so a non-empty result does not mean your term matched."
- Package facts: @linkedapi/node 2.3.20 (latest), MIT. Plain CommonJS package (main dist/index.js, types dist/index.d.ts, NO exports/module/type field) — TS default-import interop verified in the FRD's offline probe; engines field absent (Node requirement undocumented). Constructor: new LinkedApi({ linkedApiToken, identificationToken }); exported constants LINKED_API_ERROR and LINKED_API_WORKFLOW_PENDING_REASON. One instance per LinkedIn account.

### Overlap guard and the timeout envelope (watch.yml + judge.ts twin)
- The flip: watch.yml:11-13 concurrency { group: watch, cancel-in-progress: false } — line :13 becomes true. Functional change is exactly one line.
- What false is load-bearing for today (all three must have their comments updated): cron self-serialization ("it dies before the next tick queues", watch.yml:45-46), the Commit-state threat model ("the queue serializes watcher runs", watch.yml:132), de-facto state integrity (run N+1 checks out run N's committed state).
- F023 arithmetic is dual-maintained and voided: watch.yml:42-54 and src/judge.ts:95-107 (WAIT_BUDGET_MS = 180_000 at :107) must be rewritten in LOCKSTEP. The dead term is "71s measured fetch worst case" (:50, judge.ts:101) — the replacement is a serial sum of two remote cloud-browser workflows, each seconds-to-minutes (watcher.config.json:30-31 = the two minimum surfaces). The "alarm lands ~1-2 min inside the cap" claim (:52-54, judge.ts:103-105) becomes fetch-leg-dependent pending a post-cutover measurement. timeout-minutes: 8 (:55) MAY stay — raising it only extends how long a stale run holds the seat before the guard cancels it. The 60-100s prologue term survives (Playwright install stays); the 60s abort tail survives.
- WAIT_BUDGET_MS consumption chain (for the comment rewrite): judgePosts initializes waitBudgetRemainingMs (judge.ts:692) → parkUntilEligible charges-before-sleeps and refuses at zero (judge-rotation.ts:143-167) → exhausted per batch (judge.ts:384) → rotationExhausted per post (judge.ts:644) → entry catch sends ONE alarm + exit(1) (index.ts:475-483) with state never written.
- Playwright cache/install steps (watch.yml:69-87) STAY: the Threads walks still drive chromium (the sole import site fetch-threads.ts:150 with dynamic import("playwright") (factory makeChromiumContextFactory at :148); production dependency package.json:22; ci.yml has no browser step). Deleting them would trip the Threads all-fail gates and kill the run — violating D1.
- Why overlap is double-harm (the rationale the rewritten comments should carry): state is memory-only until the final push — loadState (index.ts:282) → diffNew (:283) → persistJudged (:330/:346) writes the WORKSPACE copy only; it reaches main via Commit state (watch.yml:142-193). A second run checks out stale HEAD, finds the SAME unseen posts, double-judges them (the exact waste the persist rule exists to prevent), and re-emails (watch.yml:157-159 accepts one duplicate digest). Post-cutover the second run's searches also queue behind the first INSIDE Linked API (one account, one browser) — consuming action limits at up to 2x rate and lengthening both runs, the feedback loop cancel-in-progress: true severs. Residual accepted cost: a cancel landing between sendDigest (index.ts:343) and persistJudged (:346) re-sends one digest — same cost class the repo already accepts.

### Demolition enumeration (grep-derived — the demolition agent failed twice on rate limits/timeout, so this section is the main session's literal sweep, not an agent trace)
Deleted wholesale (5 files): src/fetch-linkedin.ts, src/linkedin-login.ts, scripts/linkedin-login.ts, tests/fetch-linkedin.test.ts, tests/linkedin-login.test.ts.
Partial deletions (9 files):
- src/index.ts — import block :48-54 (TRANSIENT_ESCALATION_ATTEMPTS, clearLoginMarker, loginAllowed, writeLoginMarker + fetchLinkedInSurface-adjacent imports), fallback guard :185 + call :186-191, skip-warn re-key :193-197, comments :182 / :361 / :409 (LINKEDIN_REFRESH_PATH mentions), recoverLinkedInSession :365-417 (marker path :376), cleanupSessionDir :254, logged-out LinkedIn arm :236-248.
- src/fetch-threads.ts — :31 import, :324 doc mention, plus the shed list above.
- src/config.ts — :16-19 (four ENV_NAMES entries; linkedApiToken pair takes the slot).
- src/threads-session.ts — :13 docstring still says "serves THREADS_SESSION_STATE and LINKEDIN_SESSION_STATE" (update the sentence; the parameterized envName default itself stays for Threads).
- src/config-file.ts — resolveSurfaces linkedin arm :229-234 + linkedinSearchUrlFor :245-258 + its test tests/config-file.test.ts:192-203.
- package.json — :11 lint path includes scripts/linkedin-login.ts (the FRD's deletion list misses this; the validation precedent shows an undeclared lint-path edit once already blocked a gate).
- README.md — :16-17 (LinkedIn session walkthrough), :66-69 (env table rows for LINKEDIN_SESSION_STATE/EMAIL/PASSWORD/SECRET_WRITER), :101 + :114-118 (linkedin surface docs say "need LINKEDIN_SESSION_STATE"), :106 (scrollRounds "shared by ... LinkedIn pagination" — becomes Threads-only), :242-251 ("Refresh the LinkedIn session" section), :278 (marker mention), :298 (npx tsx scripts/linkedin-login.ts).
- .github/workflows/watch.yml — env lines :94-97, "Refresh LinkedIn session secret" step :103-129 (incl. LINKEDIN_SECRET_WRITER PAT at :110), marker branch in Commit state :140-146 (grep-verified: :124 printf, :142 test -f, :143 git add).
Login-marker traces: state/linkedin-login.json at src/index.ts:376, watch.yml:124/:142/:143, tests/index.test.ts:318 (comment), :774, :827, :841, :945, :963; LoginMarker type import tests/index.test.ts:27 and cast :981.
Test-suite bounds (grep-verified describes): runWatcher :328, "runWatcher — Phase 7 credential-login fallback" :721-1020 (next describe timeStage :1021), helpers loginFallbackContextFactory :656-703 + LOGIN_ENV_CREDS :715-718.
Also dies: tests/session.test.ts:55-85 (LinkedIn-var resolveSession coverage), tests/fetch-threads.test.ts:586/:636 (linkedinSessionPath dispatch assertions).
.gitignore — :8 carries linkedin-state*.b64 (the Phase 7-era local-dev export pattern). The initial sweep missed it because it only matched linkedin-login/fetch-linkedin literals; found on a re-grep for b64/refresh/linkedin and removed with the path.
Untouched by every deletion: THREADS_SESSION_STATE resolution (resolveSession default param, src/threads-session.ts:38-39), the logged-out Threads walk, cleanupSessionDir (:71-85, Threads caller remains), watcher.config.json (byte-identical per acceptance), the funnel stages, judge rotation, digest, heartbeat, state schema.

## Code References
- src/index.ts:115-132 — WatcherDeps seam (the new optional fetchLinkedInApi field joins here)
- src/index.ts:168-256 — acquisition timeStage closure (the rewiring target; loop must be awaited inside)
- src/index.ts:174-175 — platform split (gains a raw-surface partition for the LinkedIn arm)
- src/index.ts:185-192 (guard + call), 365-417 — recoverLinkedInSession fallback (deleted)
- src/index.ts:193-197 — skip-warn slot (re-keys to LINKED_API_TOKEN; the single warn site per decision)
- src/index.ts:236-248 — logged-out LinkedIn arm + catch-degrade (collapses into the new module)
- src/index.ts:254 — LinkedIn cleanupSessionDir (dies)
- src/index.ts:282-283, 330, 344-346 — state snapshot → judge → notify-before-persist (untouched; overlap rationale)
- src/index.ts:454-463 (def; call site :258) — dedupePosts (id-keyed Set; drops must precede)
- src/fetch-threads.ts:300-305, 331-415 — AuthenticatedFetchOptions + fetchSurfacesAuthenticated (shed target)
- src/fetch-threads.ts:337-344, 346-350, 354-366, 380-383, 412 — LinkedIn plumbing (dies)
- src/fetch-threads.ts:390-394, 397-409 — per-surface catch + all-fail throw (catch idiom is the template; throw NOT ported)
- src/fetch-linkedin.ts:170-180 — mintPost (the mapping precedent being replaced)
- src/extract.ts:36-70 (dropped counter :52, warn :63-64), 87-113 — drop-and-count + guarded ISO conversion (the templates)
- src/threads-session.ts:37-60, 71-85 — resolveSession degradable contract + cleanupSessionDir (contract source; Threads survives)
- src/judge.ts:95-107, 132-178 — WAIT_BUDGET_MS F023 twin (rewrite in lockstep) + strict-resolver contrast
- src/judge-rotation.ts:143-167 — parkUntilEligible budget consumption
- src/config-file.ts:15-19, 21-28, 220-237, 241-258 — Surface union, ResolvedSurface, resolveSurfaces, URL builders
- src/config.ts:14-25 — ENV_NAMES (four entries vacated, two added)
- src/state.ts:23-26, 166-174 — AppState generic string keys + diffNew (urn ids safe)
- src/types.ts:10-25 — Post
- src/email.ts:60, 75-76 — platform marking (already handles linkedin)
- src/recency.ts:13-22 (finiteness check :21-22) — silent NaN drop (why mapping drops first)
- watcher.config.json:30-31, 33 — the two linkedin surfaces + recencyHours 72 (byte-identical)
- .github/workflows/watch.yml:11-13, 42-55, 69-87, 94-97, 103-129, 140-146 — guard flip, F023 rewrite, Playwright steps stay, env swap, refresh step delete, marker branch delete
- tests/index.test.ts:546-618 — token-less degradation tests (re-key target), :573/:603 warn regexes
- tests/index.test.ts:721-1020 — Phase 7 suite (deleted)
- tests/fetch-threads.test.ts:518-643 — platform-dispatch triage (see Detailed Findings)
- tests/config-file.test.ts:192-203 — linkedinSearchUrlFor byte-exact test (dies with the builder)

## Integration Points

### Inbound References
- src/index.ts:174-175 — the only place surfaces are partitioned by platform (the new arm's raw-surface partition joins it)
- src/index.ts:258-267 — dedupePosts + filterRecent consume the mapped posts (funnel unchanged)
- src/email.ts:60, 75-76 — digest marking keys off Post.platform (already linkedin-aware)
- src/state.ts:166-174 — diffNew keys off Post.id against generic string keys (urn ids already coexist)

### Outbound Dependencies
- @linkedapi/node 2.3.20 (new production dependency — the doctrine exception with its stated need in the PR description; typed responses + no process boundary over spawning linkedin-cli)
- The new module depends on: ENV_NAMES pair (src/config.ts), degradable contract shape (src/threads-session.ts:37-60 as the model), Post (src/types.ts)

### Infrastructure Wiring
- .github/workflows/watch.yml:94-97 — env swap to LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN (1:1 name mirroring with ENV_NAMES per the workflow guidance)
- .github/workflows/watch.yml:11-13 — overlap guard flip
- .github/workflows/watch.yml:103-129, 140-146 — Phase 7 workflow machinery (deleted; no replacement)
- Operator precondition (blocking, before enabling the workflow): a paid Linked API seat with a connected LinkedIn account at app.linkedapi.io + both secrets stored in GitHub

## Architecture Insights
- Resolver-beside-consumer is the operative rule for where resolvers live (judge.ts, email.ts, threads-session.ts precedents) — the token resolvers belong in the new module, not config.ts (names only) or threads-session.ts (storage-state mechanics).
- The repo's three resolver contracts (required-throw / optional-with-default-throw / degradable-warn-null, per .rpiv/guidance/src/architecture.md) map cleanly: tokens select degradable; the caller-warns split mirrors resolveSession exactly.
- Fail-one-keep-rest and all-fail-throw are separable halves: the catch idiom transplants into the serial loop; the throw gate does not. Threads keeps its throw contract; the LinkedIn arm is total.
- Parse-don't-validate at every edge, with drops counted and CONDITIONALLY warned (extract.ts precedent) — nullable SDK fields make this mandatory, not stylistic.
- timeStage discipline is positional: one stage-level timing line per stage await; inner logs interleave freely.
- Measured-evidence comments: every non-obvious constant needs a run id/date; the F023 pair proves comments drift in lockstep or not at all.
- Structural doubles (ContextFactory/ContextLike) are what keep tests offline; the new module's trailing-SDK-client seam follows the same doctrine (FR8).
- CJS-package interop: the repo is ESM ("type": "module"); @linkedapi/node ships CJS with no exports map — the probe verified TS default-import interop compiles; the design should pin the exact import form.

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: LinkedIn second surface + dispatch (the path now being deleted)
**Commit(s)**: 68c1e2d — "feat: linkedin second surface with configurable scroll rounds" (2026-10-31); main twin via PR #5 (3a61ca5)
**Blast radius**: 27 files across every layer (1707+/87−) — the largest commit in repo history
**Follow-up fixes**:
- 216a617 / 1922f2e — "fix: treat an empty linkedin search window as zero results" (2026-11-01, ~12h later) — empty results misclassified as walk failure
- b5d72f8 / 8b08705 — second linkedin surface appended after live runs
- Pre-landing catches: linkedin-only config fed an empty surfaces array into the all-fail gate (exit 1 instead of degrade); logged-out path discarded Threads posts when the LinkedIn walk threw; idle browser context built for unwalked surfaces
**Takeaway**: expect one live-validation retune after first real runs (93a3f38 precedent, stated in the design doc); plan it as a declared commit, not a hoped-for follow-up.

### Precedent: Phase 7 credential-login fallback + secret refresh
**Commit(s)**: 2b74c61 — "feat: linkedin credential-login fallback with workflow secret refresh" (2026-11-01); main twin 485e0ac
**Blast radius**: 11 files, 1442+ — linkedin-login.ts NEW (315), scripts/linkedin-login.ts NEW (120), watch.yml +41, index.ts +90, 2 test files +753, .gitignore, package.json
**Follow-up fixes / audit defects (TECH_DEBT_AUDIT run #3, same day)**:
- N4: refresh step had no if: always() — a run that logged in then failed skipped the refresh; the fresh session died in runner.temp
- N5: writeLoginMarker used plain writeFile; workflow wrote the marker with printf — both violate atomic-state
- N3: conflict-skip whitelist accepted only state/seen-posts.json — the marker file made conflicted marker commits fail the whole run
- N7: operator script echoed the password prompt to stdout
- Never verified live: the CI leg was never proven before the path was obsoleted by the IP block
**Takeaway**: every GitHub-Actions-side integration shipped a same-day defect offline tests could not see — delete all touchpoints as ONE audited set (the enumeration above).

### Precedent: whole feature-path deletion (keywords → LLM judge)
**Commit(s)**: e316cb5 — "feat: judge posts against configured keywords in bulk" (2026-10-26) — deleted src/keywords.ts + tests wholesale and rewired in one commit (11 files)
**Follow-up fixes**: 7cc7250 (2026-10-27) — the REPLACEMENT's concurrency (8) tripped the endpoint limiter in live runs; fixed to the probe-measured 4 within a day; 5f6a328 built the probe that found the safe width
**Takeaway**: one-commit deletion-with-rewire is the repo's proven pattern; risk concentrates in the new path's live-call behavior — probe-measure Linked API before pinning constants (a scripts/probe-judge.ts-style probe is a suggested follow-up in the FRD).

### Precedent: watch.yml state commit-back machinery
**Commit(s)**: 510ff2a (2026-10-30) + five same-day fixes (89c8bc5, 8b777e6, 45bcbd3, 2e28916, bc760cb) → b779ff7 (2026-11-01) extracted it into scripts/commit-state-rebase.sh + a 342-line test
**Takeaway**: watch.yml is the highest-friction file (6 stabilization commits over 2 days); this branch still carries the INLINE YAML version — origin/main has the tested script (b779ff7, 8f2debd, 31dfe17 are NOT on this branch; local main is stale). Base the change on origin/main's state; verify with a live Actions dispatch.

### Precedent: watch.yml timeout/concurrency adjustments
**Commit(s)**: 73d6786 → 7cc7250 (8→4 after live limiter trips) → 93a3f38 (8-minute budget cut) → 1c8a68c → 485e0ac/2b74c61
**Takeaway**: concurrency/timeout values must come from a measured probe run pasted with its run id; any run-overlap change interacts with the commit-back (canceled runs never persist state).

### Composite Lessons
- The Playwright LinkedIn path failed in production, not in tests: 4 straight CI failures (runs 41262910906, 41263307790, 41263753774, 41264399768) proved datacenter-IP blocking while 47 posts fetched locally minutes later. Complete the operator precondition and run one live verification BEFORE declaring done — this repo has twice shipped fetch paths whose live behavior was unproven.
- Empty results are success (216a617): the SDK fetcher must log "OK — 0 post(s)" and return [], never throw.
- Doc drift is recurring and never self-heals: after LinkedIn landed, all 4 guidance files + AGENTS.md described a nonexistent repo (audit N1/N2; the fix 31dfe17 exists only on origin/main). Deleting 5 modules drifts the same docs in reverse — declare the guidance/README/AGENTS.md sync in the plan.
- Plan file lists under-declare: two validations flagged package.json/.gitignore/watcher.config.json edits missing from phase file lists; one lint violation (NaN in a file the plan never declared) blocked a gate. The ripple zone this time: package.json:11 lint path, README sections, threads-session.ts:13 docstring, tests/config-file.test.ts literals.
- Branch topology hazard: duplicate commits across branches (2b74c61/485e0ac, 216a617/1922f2e), stale local main, origin/main ahead — rebase and check the merge base against origin/main before planning exact line edits.

## Historical Context (from .rpiv/artifacts/)
- .rpiv/artifacts/discover/2026-11-01_18-53-36_linkedin-cli-post-search-surface.md — governing FRD (this research chains from it)
- .rpiv/artifacts/designs/2026-10-31_11-07-47_linkedin-second-surface-dispatch.md — prior Playwright dispatch design (historical; its placeholders-and-retune lesson carries forward)
- .rpiv/artifacts/research/2026-11-01_09-29-22_linkedin-watch-off-my-pc.md — the IP-block evidence + session-jumping account-lock research
- .rpiv/artifacts/solutions/2026-11-01_10-53-22_linkedin-host-and-split.md — host/split options analysis (superseded by the Linked API decision)
- .rpiv/artifacts/TECH_DEBT_AUDIT.md — audit run #3 (N1-N9; several findings land inside this change's blast radius)
- .rpiv/artifacts/validation/2026-11-01_06-11-59_linkedin-second-surface-dispatch.md and .rpiv/artifacts/validation/2026-11-01_08-00-29_linkedin-second-surface-dispatch.md — validation rounds for the path being deleted
- .rpiv/guidance/src/architecture.md, .rpiv/guidance/.github/workflows/architecture.md, .rpiv/guidance/tests/architecture.md — the contracts this change must honor (funnel gates, WatcherDeps, step-scoped secrets, offline test conventions)

## Developer Context
**Q (discover: D1 — Success definition): What does success look like once LinkedIn job watching works again from GitHub Actions?**
A: "Pipeline unblocks" — the scheduled run stops failing on LinkedIn; a clean exit matters more than full coverage.

**Q (discover: D2 — Keep LinkedIn surfaces unchanged in config): Keep the linkedin surfaces as-is in watcher.config.json, or change config as part of the work?**
A: Keep config — zero config migration; {type: "linkedin"} union and resolveSurfaces already exist.

**Q (discover: D3 — Normalize into the existing Post shape): Keep normalizing results into the existing Post shape, or change it?**
A: Reuse Post shape — seen-state keys are generic strings; urn: ids already coexist with Threads digit ids.

**Q (discover: D4 — Swap watch.yml LinkedIn secrets for Linked API tokens): Replace the Playwright LinkedIn secrets with Linked API tokens?**
A: Swap secrets — names fixed to LINKED_API_TOKEN / LINKED_API_IDENTIFICATION_TOKEN in D11.

**Q (discover: D5 — Degrade + exit 0 on LinkedIn failure): When linkedin-cli fails, degrade like the logged-out arm does today?**
A: Degrade, exit 0 — matches the D1 intent (clean exit > coverage).

**Q (discover: D6 — Wrap post search, not jobs search): Which CLI capability should the new fetcher wrap?**
A: Post search — existing surfaces are hashtag post searches; jobs search would silently change what is watched.

**Q (discover: D7 — Delete the Playwright LinkedIn path entirely): What happens to the old path?**
A: Delete it — it never worked from Actions; dead code would linger against the no-silent-fallback doctrine.

**Q (discover: D8 — Drive Linked API via the SDK, not the CLI process): Spawn the CLI or depend on the SDK?**
A: Use the SDK instead — typed responses and no process boundary outweigh the doctrine hit (stated need goes in the PR description).

**Q (discover: D9 — Search window, sort, and limit): Which datePosted window / limit?**
A: pastWeek + sort: latest + limit: 100 — smallest window covering recencyHours: 72; recency.ts trims exactly; freshest first.

**Q (discover: D10 — Missing tokens: skip + warn, exit 0): What when the tokens are missing from the environment?**
A: Skip + warn — degradable-resolver contract; a temporary secret lapse must not kill the digest.

**Q (discover: D11 — Token env names): Names for the two new secrets?**
A: LINKED_API_TOKEN + LINKED_API_IDENTIFICATION_TOKEN.

**Q (discover: D12 — Overlap guard in watch.yml): Add the setting so two runs never overlap?**
A: Add the guard — overlap means double-hitting one LinkedIn account and duplicate digests.

**Q (src/config-file.ts:21-28): ResolvedSurface carries only label+url; where does the new fetcher get the raw surface value ("#hiring react") for the search term?**
A: Read it from config directly — runWatcher partitions the raw config.surfaces by type === "linkedin" and passes surface.value straight to the SDK. ResolvedSurface stays unchanged; linkedinSearchUrlFor and its arm die with no consumer. (First asked with three options; developer asked for plainer words, then chose this.)

**Q (linkedapi.io/docs, st-search-posts): Hashtag-as-term is undocumented and LinkedIn widens narrow queries — how should the fetcher treat terms?**
A: Pass term verbatim — judge + recency already gate relevance; widened results cost bounded extra LLM calls (limit 100); the first-run live check stays in the operator preconditions.

**Q (src/threads-session.ts:42 vs src/index.ts:193-197): Where should the missing-token warn live — resolver or caller?**
A: Caller warns — the resolver returns null silently on unset (mirroring resolveSession exactly); runWatcher's skip slot emits the single warn naming LINKED_API_TOKEN, pinned by the re-keyed test regexes.

## Related Research
- .rpiv/artifacts/research/2026-11-01_09-29-22_linkedin-watch-off-my-pc.md — the blocked-path evidence this feature supersedes

## Open Questions
Carried verbatim from the FRD (both are first-run live-API checks, not design blockers; research partially answers both — see Detailed Findings):
- Hashtag-term semantics: does term: "#hiring react" return the expected post set (hashtag and keyword combined)?
- Degrade-path error shapes: what catchable error shape does the SDK surface outside the account's working hours and on limitExceeded — confirm the warn-and-skip path can distinguish them (logs must name the cause).
  (Research adds: with default dashboard working-hours settings the workflow PARKS with pendingReason "outsideWorkingHours" rather than erroring — the pending-poll shape must be handled alongside the thrown shapes; and the docs carry no retryable-vs-permanent table beyond tooManyRequests/unexpectedError.)
Research-derived residual items for design:
- WAIT_BUDGET_MS (src/judge.ts:107): keep 180s with a rewritten comment that stops citing the dead 71s term, or re-measure after cutover — the FRD's NFR does not mandate a new value.
- timeout-minutes: 8 (watch.yml:55): the number may stay (raising it only extends a stale run's seat time under the guard); its comment rewrite is mandatory either way.
- Measure one real searchPosts workflow's wall-clock (feeds the F023 replacement arithmetic) — requires live tokens.
- Whether ResolvedSurface.platform narrows to "threads" once the linkedin arm dies (fact: Threads-only; decision: design-stage).
- ESM import form for the CJS @linkedapi/node package to pin in code (default-import interop verified in the probe; no exports map on the package).
